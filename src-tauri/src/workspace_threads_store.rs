#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceThreadsReadWorkspace {
    workspace_id: String,
    root_directory: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceThreadsReadRequest {
    workspaces: Vec<WorkspaceThreadsReadWorkspace>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceThreadsReadWorkspaceResult {
    workspace_id: String,
    root_directory: String,
    db_path: String,
    found: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceThreadsReadResult {
    threads: Value,
    workspaces: Vec<WorkspaceThreadsReadWorkspaceResult>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceThreadsPersistWorkspace {
    workspace_id: String,
    root_directory: Option<String>,
    state: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceThreadsPersistRequest {
    workspaces: Vec<WorkspaceThreadsPersistWorkspace>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceThreadsPersistDeltaThread {
    thread_id: String,
    state: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceThreadsPersistDeltaWorkspace {
    workspace_id: String,
    root_directory: Option<String>,
    shell: Option<Value>,
    threads: Option<Vec<WorkspaceThreadsPersistDeltaThread>>,
    archived_threads: Option<Vec<WorkspaceThreadsPersistDeltaThread>>,
    removed_thread_ids: Option<Vec<String>>,
    removed_archived_thread_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceThreadsPersistDeltaRequest {
    workspaces: Vec<WorkspaceThreadsPersistDeltaWorkspace>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceThreadsPersistResult {
    saved: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceAgentSessionHistoryListRequest {
    workspace_id: String,
    root_directory: Option<String>,
    limit: Option<usize>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceAgentSessionHistoryItem {
    id: String,
    workspace_id: String,
    workspace_name: String,
    workspace_root: String,
    coordination_session_id: String,
    provider_session_id: String,
    native_session_id: String,
    agent_id: String,
    provider: String,
    model_id: String,
    model_source: String,
    thread_id: String,
    pane_id: String,
    terminal_instance_id: Option<u64>,
    terminal_index: Option<i64>,
    slot_key: String,
    cwd: String,
    status: String,
    title: String,
    first_user_message: String,
    source: String,
    created_at_ms: u64,
    latest_at_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceAgentSessionHistoryListResult {
    generated_at_ms: u64,
    workspace_id: String,
    root_directory: String,
    db_path: String,
    items: Vec<WorkspaceAgentSessionHistoryItem>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceAgentSessionHistoryRecord {
    id: String,
    workspace_id: String,
    workspace_name: String,
    coordination_session_id: String,
    provider_session_id: String,
    native_session_id: String,
    agent_id: String,
    provider: String,
    model_id: String,
    model_source: String,
    thread_id: String,
    pane_id: String,
    terminal_instance_id: Option<u64>,
    terminal_index: Option<i64>,
    slot_key: String,
    cwd: String,
    status: String,
    title: String,
    source: String,
    observed_at_ms: Option<u64>,
    created_at_ms: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceThreadProviderSessionBinding {
    workspace_id: String,
    thread_id: String,
    agent_id: String,
    provider_session_id: String,
    native_session_id: String,
    native_session_kind: String,
    native_session_source: String,
    pane_id: String,
    instance_id: Option<u64>,
    terminal_index: Option<i64>,
    provider: String,
    session_title: String,
    model_id: String,
    source: String,
    cwd: String,
    observed_at_ms: u64,
}

fn workspace_threads_clean_workspace_id(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Workspace id is required.".to_string());
    }
    if trimmed.len() > 256
        || trimmed
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == b'\x7f')
    {
        return Err("Workspace id is invalid.".to_string());
    }
    Ok(trimmed.to_string())
}

fn workspace_threads_clean_thread_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > 512
        || trimmed
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == b'\x7f')
    {
        return None;
    }
    Some(trimmed.to_string())
}

fn workspace_threads_clean_agent_id(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase().replace(['_', ' '], "-");
    let agent_id = if normalized.contains("claude") {
        "claude"
    } else if normalized.contains("opencode") || normalized.contains("open-code") {
        "opencode"
    } else if normalized.contains("codex")
        || normalized.contains("openai")
        || normalized.contains("open-ai")
    {
        "codex"
    } else {
        normalized.as_str()
    };
    if matches!(agent_id, "codex" | "claude" | "opencode") {
        Some(agent_id.to_string())
    } else {
        None
    }
}

fn workspace_threads_clean_provider_session_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > 256
        || trimmed
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == b'\x7f')
    {
        return None;
    }
    Some(trimmed.to_string())
}

fn workspace_threads_now_millis_u64() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn workspace_threads_clean_optional_text(value: &str, max_len: usize) -> String {
    value
        .trim()
        .chars()
        .filter(|ch| !ch.is_control())
        .take(max_len)
        .collect()
}

fn workspace_threads_store_db_path(root: &Path) -> Result<PathBuf, String> {
    let agents_dir = coordination::db::coordination_workspace_state_root(root);
    fs::create_dir_all(&agents_dir)
        .map_err(|error| format!("Unable to create workspace state directory: {error}"))?;
    if coordination::db::coordination_state_root_is_visible(root, &agents_dir) {
        let _ = ensure_workspace_agents_gitignore(root);
    }
    Ok(agents_dir.join("diffforge_threads.sqlite3"))
}

fn workspace_threads_now_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn workspace_threads_open_store(
    root_directory: Option<&str>,
    create: bool,
) -> Result<(rusqlite::Connection, PathBuf, PathBuf), String> {
    let root = resolve_workspace_root_directory(root_directory)?;
    let db_path = if create {
        workspace_threads_store_db_path(&root)?
    } else {
        coordination::db::coordination_workspace_state_root(&root).join("diffforge_threads.sqlite3")
    };
    let connection = rusqlite::Connection::open(&db_path)
        .map_err(|error| format!("Unable to open workspace threads SQLite store: {error}"))?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS workspace_thread_state (
                workspace_id TEXT PRIMARY KEY NOT NULL,
                workspace_root TEXT NOT NULL,
                state_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_workspace_thread_state_root
                ON workspace_thread_state(workspace_root);
            CREATE TABLE IF NOT EXISTS workspace_thread_workspace_state (
                workspace_id TEXT PRIMARY KEY NOT NULL,
                workspace_root TEXT NOT NULL,
                shell_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_workspace_thread_workspace_state_root
                ON workspace_thread_workspace_state(workspace_root);
            CREATE TABLE IF NOT EXISTS workspace_thread_thread_state (
                workspace_id TEXT NOT NULL,
                bucket TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                workspace_root TEXT NOT NULL,
                thread_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(workspace_id, bucket, thread_id)
            );
            CREATE INDEX IF NOT EXISTS idx_workspace_thread_thread_state_root
                ON workspace_thread_thread_state(workspace_root);
            CREATE INDEX IF NOT EXISTS idx_workspace_thread_thread_state_workspace
                ON workspace_thread_thread_state(workspace_id, bucket);
            CREATE TABLE IF NOT EXISTS workspace_thread_provider_session_binding (
                workspace_id TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                provider_session_id TEXT NOT NULL,
                workspace_root TEXT NOT NULL,
                binding_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(workspace_id, thread_id, agent_id)
            );
            CREATE INDEX IF NOT EXISTS idx_workspace_thread_provider_session_binding_session
                ON workspace_thread_provider_session_binding(provider_session_id);
            CREATE INDEX IF NOT EXISTS idx_workspace_thread_provider_session_binding_workspace
                ON workspace_thread_provider_session_binding(workspace_id);
            CREATE TABLE IF NOT EXISTS workspace_agent_session_history (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL,
                workspace_root TEXT NOT NULL,
                workspace_name TEXT NOT NULL DEFAULT '',
                coordination_session_id TEXT NOT NULL DEFAULT '',
                provider_session_id TEXT NOT NULL DEFAULT '',
                native_session_id TEXT NOT NULL DEFAULT '',
                agent_id TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT '',
                model_id TEXT NOT NULL DEFAULT '',
                model_source TEXT NOT NULL DEFAULT '',
                thread_id TEXT NOT NULL DEFAULT '',
                pane_id TEXT NOT NULL DEFAULT '',
                terminal_instance_id INTEGER,
                terminal_index INTEGER,
                slot_key TEXT NOT NULL DEFAULT '',
                cwd TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT '',
                created_at_ms INTEGER NOT NULL,
                latest_at_ms INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_workspace_agent_session_history_workspace_latest
                ON workspace_agent_session_history(workspace_id, latest_at_ms);
            CREATE INDEX IF NOT EXISTS idx_workspace_agent_session_history_provider_session
                ON workspace_agent_session_history(workspace_id, provider_session_id);
            CREATE INDEX IF NOT EXISTS idx_workspace_agent_session_history_coordination
                ON workspace_agent_session_history(coordination_session_id);
            CREATE INDEX IF NOT EXISTS idx_workspace_agent_session_history_thread_agent
                ON workspace_agent_session_history(workspace_id, thread_id, agent_id);",
        )
        .map_err(|error| {
            format!("Unable to initialize workspace threads SQLite schema: {error}")
        })?;
    Ok((connection, root, db_path))
}

fn workspace_agent_session_history_upsert_blocking(
    root_directory: Option<&str>,
    record: WorkspaceAgentSessionHistoryRecord,
) -> Result<bool, String> {
    let workspace_id = workspace_threads_clean_workspace_id(&record.workspace_id)?;
    let Some(id) = workspace_threads_clean_thread_id(&record.id) else {
        return Ok(false);
    };
    let Some(agent_id) = workspace_threads_clean_agent_id(&record.agent_id) else {
        return Ok(false);
    };
    let provider = workspace_threads_clean_agent_id(&record.provider)
        .unwrap_or_else(|| agent_id.clone());
    let observed_at_ms = record
        .observed_at_ms
        .unwrap_or_else(workspace_threads_now_millis_u64);
    let created_at_ms = record.created_at_ms.unwrap_or(observed_at_ms);
    let now = workspace_threads_now_millis();
    let (connection, root, _) = workspace_threads_open_store(root_directory, true)?;
    let root_display = workspace_path_display(&root);
    let terminal_instance_id = record.terminal_instance_id.map(|value| value as i64);
    let title = workspace_threads_clean_optional_text(&record.title, 240);
    let status = workspace_threads_clean_optional_text(&record.status, 64);

    connection
        .execute(
            "INSERT INTO workspace_agent_session_history (
                id,
                workspace_id,
                workspace_root,
                workspace_name,
                coordination_session_id,
                provider_session_id,
                native_session_id,
                agent_id,
                provider,
                model_id,
                model_source,
                thread_id,
                pane_id,
                terminal_instance_id,
                terminal_index,
                slot_key,
                cwd,
                status,
                title,
                source,
                created_at_ms,
                latest_at_ms,
                created_at,
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?23)
            ON CONFLICT(id) DO UPDATE SET
                workspace_id = excluded.workspace_id,
                workspace_root = excluded.workspace_root,
                workspace_name = CASE WHEN excluded.workspace_name != '' THEN excluded.workspace_name ELSE workspace_agent_session_history.workspace_name END,
                coordination_session_id = CASE WHEN excluded.coordination_session_id != '' THEN excluded.coordination_session_id ELSE workspace_agent_session_history.coordination_session_id END,
                provider_session_id = CASE WHEN excluded.provider_session_id != '' THEN excluded.provider_session_id ELSE workspace_agent_session_history.provider_session_id END,
                native_session_id = CASE WHEN excluded.native_session_id != '' THEN excluded.native_session_id ELSE workspace_agent_session_history.native_session_id END,
                agent_id = excluded.agent_id,
                provider = CASE WHEN excluded.provider != '' THEN excluded.provider ELSE workspace_agent_session_history.provider END,
                model_id = CASE WHEN excluded.model_id != '' THEN excluded.model_id ELSE workspace_agent_session_history.model_id END,
                model_source = CASE WHEN excluded.model_source != '' THEN excluded.model_source ELSE workspace_agent_session_history.model_source END,
                thread_id = CASE WHEN excluded.thread_id != '' THEN excluded.thread_id ELSE workspace_agent_session_history.thread_id END,
                pane_id = CASE WHEN excluded.pane_id != '' THEN excluded.pane_id ELSE workspace_agent_session_history.pane_id END,
                terminal_instance_id = COALESCE(excluded.terminal_instance_id, workspace_agent_session_history.terminal_instance_id),
                terminal_index = COALESCE(excluded.terminal_index, workspace_agent_session_history.terminal_index),
                slot_key = CASE WHEN excluded.slot_key != '' THEN excluded.slot_key ELSE workspace_agent_session_history.slot_key END,
                cwd = CASE WHEN excluded.cwd != '' THEN excluded.cwd ELSE workspace_agent_session_history.cwd END,
                status = CASE WHEN excluded.status != '' THEN excluded.status ELSE workspace_agent_session_history.status END,
                title = CASE WHEN excluded.title != '' THEN excluded.title ELSE workspace_agent_session_history.title END,
                source = CASE WHEN excluded.source != '' THEN excluded.source ELSE workspace_agent_session_history.source END,
                created_at_ms = CASE WHEN workspace_agent_session_history.created_at_ms <= excluded.created_at_ms THEN workspace_agent_session_history.created_at_ms ELSE excluded.created_at_ms END,
                latest_at_ms = CASE WHEN excluded.latest_at_ms >= workspace_agent_session_history.latest_at_ms THEN excluded.latest_at_ms ELSE workspace_agent_session_history.latest_at_ms END,
                updated_at = excluded.updated_at",
            rusqlite::params![
                id,
                workspace_id,
                root_display,
                workspace_threads_clean_optional_text(&record.workspace_name, 256),
                workspace_threads_clean_optional_text(&record.coordination_session_id, 256),
                workspace_threads_clean_provider_session_id(&record.provider_session_id).unwrap_or_default(),
                workspace_threads_clean_provider_session_id(&record.native_session_id).unwrap_or_default(),
                agent_id,
                provider,
                workspace_threads_clean_optional_text(&record.model_id, 160),
                workspace_threads_clean_optional_text(&record.model_source, 80),
                workspace_threads_clean_optional_text(&record.thread_id, 512),
                workspace_threads_clean_optional_text(&record.pane_id, 256),
                terminal_instance_id,
                record.terminal_index,
                workspace_threads_clean_optional_text(&record.slot_key, 128),
                workspace_threads_clean_optional_text(&record.cwd, 2048),
                status,
                title,
                workspace_threads_clean_optional_text(&record.source, 128),
                created_at_ms as i64,
                observed_at_ms as i64,
                now,
            ],
        )
        .map_err(|error| format!("Unable to persist workspace session history: {error}"))?;
    Ok(true)
}

const WORKSPACE_AGENT_SESSION_HISTORY_PREVIEW_CHARS: usize = 96;
const WORKSPACE_AGENT_SESSION_HISTORY_TRANSCRIPT_LIMIT: usize = 160;

fn workspace_agent_session_history_first_user_preview(
    item: &WorkspaceAgentSessionHistoryItem,
) -> String {
    let Some(agent_id) = workspace_threads_clean_agent_id(&item.agent_id)
        .or_else(|| workspace_threads_clean_agent_id(&item.provider))
    else {
        return String::new();
    };
    let Some(provider_session_id) = workspace_threads_clean_provider_session_id(
        if item.provider_session_id.trim().is_empty() {
            &item.native_session_id
        } else {
            &item.provider_session_id
        },
    ) else {
        return String::new();
    };
    let cwd = if item.cwd.trim().is_empty() {
        item.workspace_root.trim()
    } else {
        item.cwd.trim()
    };
    if cwd.is_empty() {
        return String::new();
    }

    read_agent_thread_transcript(
        &agent_id,
        &provider_session_id,
        cwd,
        Some(item.workspace_id.as_str()),
        WORKSPACE_AGENT_SESSION_HISTORY_TRANSCRIPT_LIMIT,
    )
    .ok()
    .and_then(|transcript| {
        transcript
            .messages
            .into_iter()
            .find(|message| message.role.eq_ignore_ascii_case("user") && !message.text.trim().is_empty())
    })
    .map(|message| {
        clean_codex_title(
            message
                .text
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" "),
            "",
        )
    })
    .map(|preview| {
        if preview.chars().count() > WORKSPACE_AGENT_SESSION_HISTORY_PREVIEW_CHARS {
            format!(
                "{}...",
                truncate_chars(&preview, WORKSPACE_AGENT_SESSION_HISTORY_PREVIEW_CHARS - 3).trim()
            )
        } else {
            preview
        }
    })
    .unwrap_or_default()
}

fn workspace_agent_session_history_preview_cache_key(
    item: &WorkspaceAgentSessionHistoryItem,
) -> Option<String> {
    let agent_id = workspace_threads_clean_agent_id(&item.agent_id)
        .or_else(|| workspace_threads_clean_agent_id(&item.provider))?;
    let provider_session_id = workspace_threads_clean_provider_session_id(
        if item.provider_session_id.trim().is_empty() {
            &item.native_session_id
        } else {
            &item.provider_session_id
        },
    )?;
    let cwd = if item.cwd.trim().is_empty() {
        item.workspace_root.trim()
    } else {
        item.cwd.trim()
    };
    if cwd.is_empty() {
        return None;
    }
    Some(format!("{agent_id}\n{provider_session_id}\n{cwd}"))
}

fn workspace_agent_session_history_enrich_previews(
    items: &mut [WorkspaceAgentSessionHistoryItem],
) {
    let mut previews = HashMap::<String, String>::new();
    for item in items.iter_mut() {
        let Some(key) = workspace_agent_session_history_preview_cache_key(item) else {
            continue;
        };
        if let Some(preview) = previews.get(&key) {
            item.first_user_message = preview.clone();
            continue;
        }
        let preview = workspace_agent_session_history_first_user_preview(item);
        item.first_user_message = preview.clone();
        previews.insert(key, preview);
    }
}

fn workspace_agent_session_history_list_blocking(
    request: WorkspaceAgentSessionHistoryListRequest,
) -> Result<WorkspaceAgentSessionHistoryListResult, String> {
    let workspace_id = workspace_threads_clean_workspace_id(&request.workspace_id)?;
    let limit = request.limit.unwrap_or(200).clamp(1, 500);
    let (connection, root, db_path) =
        workspace_threads_open_store(request.root_directory.as_deref(), true)?;
    let root_display = workspace_path_display(&root);
    let db_path_display = workspace_path_display(&db_path);
    let mut statement = connection
        .prepare(
            "SELECT
                id,
                workspace_id,
                workspace_name,
                workspace_root,
                coordination_session_id,
                provider_session_id,
                native_session_id,
                agent_id,
                provider,
                model_id,
                model_source,
                thread_id,
                pane_id,
                terminal_instance_id,
                terminal_index,
                slot_key,
                cwd,
                status,
                title,
                source,
                created_at_ms,
                latest_at_ms
            FROM workspace_agent_session_history
            WHERE workspace_id = ?1
            ORDER BY latest_at_ms DESC, created_at_ms DESC, id DESC
            LIMIT ?2",
        )
        .map_err(|error| format!("Unable to prepare workspace session history read: {error}"))?;
    let rows = statement
        .query_map(rusqlite::params![workspace_id.as_str(), limit as i64], |row| {
            let terminal_instance_id = row
                .get::<_, Option<i64>>(13)?
                .and_then(|value| u64::try_from(value).ok());
            let created_at_ms = row
                .get::<_, i64>(20)
                .ok()
                .and_then(|value| u64::try_from(value).ok())
                .unwrap_or(0);
            let latest_at_ms = row
                .get::<_, i64>(21)
                .ok()
                .and_then(|value| u64::try_from(value).ok())
                .unwrap_or(created_at_ms);
            Ok(WorkspaceAgentSessionHistoryItem {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                workspace_name: row.get(2)?,
                workspace_root: row.get(3)?,
                coordination_session_id: row.get(4)?,
                provider_session_id: row.get(5)?,
                native_session_id: row.get(6)?,
                agent_id: row.get(7)?,
                provider: row.get(8)?,
                model_id: row.get(9)?,
                model_source: row.get(10)?,
                thread_id: row.get(11)?,
                pane_id: row.get(12)?,
                terminal_instance_id,
                terminal_index: row.get(14)?,
                slot_key: row.get(15)?,
                cwd: row.get(16)?,
                status: row.get(17)?,
                title: row.get(18)?,
                first_user_message: String::new(),
                source: row.get(19)?,
                created_at_ms,
                latest_at_ms,
            })
        })
        .map_err(|error| format!("Unable to read workspace session history rows: {error}"))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| format!("Unable to read workspace session history row: {error}"))?);
    }
    workspace_agent_session_history_enrich_previews(&mut items);
    Ok(WorkspaceAgentSessionHistoryListResult {
        generated_at_ms: workspace_threads_now_millis_u64(),
        workspace_id,
        root_directory: root_display,
        db_path: db_path_display,
        items,
    })
}

fn workspace_threads_collect_thread_entries(value: Option<Value>) -> Vec<(String, Value)> {
    let Some(Value::Object(entries)) = value else {
        return Vec::new();
    };

    entries
        .into_iter()
        .filter_map(|(thread_id, thread)| {
            workspace_threads_clean_thread_id(&thread_id)
                .map(|safe_thread_id| (safe_thread_id, thread))
        })
        .collect()
}

fn workspace_threads_split_state(
    state: &Value,
) -> (Value, Vec<(String, Value)>, Vec<(String, Value)>) {
    let mut shell = match state {
        Value::Object(map) => map.clone(),
        _ => serde_json::Map::new(),
    };
    let threads = workspace_threads_collect_thread_entries(shell.remove("threads"));
    let archived_threads =
        workspace_threads_collect_thread_entries(shell.remove("archivedThreads"));
    (Value::Object(shell), threads, archived_threads)
}

fn workspace_threads_insert_thread_rows(
    transaction: &rusqlite::Transaction<'_>,
    workspace_id: &str,
    root_display: &str,
    bucket: &str,
    rows: Vec<(String, Value)>,
    now: &str,
) -> Result<usize, String> {
    let mut saved = 0usize;
    for (thread_id, thread) in rows {
        let thread_text = serde_json::to_string(&thread)
            .map_err(|error| format!("Unable to serialize workspace thread row: {error}"))?;
        transaction
            .execute(
                "INSERT INTO workspace_thread_thread_state (
                    workspace_id,
                    bucket,
                    thread_id,
                    workspace_root,
                    thread_json,
                    created_at,
                    updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
                ON CONFLICT(workspace_id, bucket, thread_id) DO UPDATE SET
                    workspace_root = excluded.workspace_root,
                    thread_json = excluded.thread_json,
                    updated_at = excluded.updated_at",
                rusqlite::params![
                    workspace_id,
                    bucket,
                    thread_id.as_str(),
                    root_display,
                    thread_text,
                    now,
                ],
            )
            .map_err(|error| format!("Unable to persist workspace thread row: {error}"))?;
        saved += 1;
    }

    Ok(saved)
}

fn workspace_threads_write_split_state(
    transaction: &rusqlite::Transaction<'_>,
    workspace_id: &str,
    root_display: &str,
    state: &Value,
    now: &str,
) -> Result<(), String> {
    let (shell, threads, archived_threads) = workspace_threads_split_state(state);
    let shell_text = serde_json::to_string(&shell)
        .map_err(|error| format!("Unable to serialize workspace thread shell: {error}"))?;

    transaction
        .execute(
            "INSERT INTO workspace_thread_workspace_state (
                workspace_id,
                workspace_root,
                shell_json,
                created_at,
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?4)
            ON CONFLICT(workspace_id) DO UPDATE SET
                workspace_root = excluded.workspace_root,
                shell_json = excluded.shell_json,
                updated_at = excluded.updated_at",
            rusqlite::params![workspace_id, root_display, shell_text, now],
        )
        .map_err(|error| format!("Unable to persist workspace thread shell: {error}"))?;

    transaction
        .execute(
            "DELETE FROM workspace_thread_thread_state WHERE workspace_id = ?1",
            rusqlite::params![workspace_id],
        )
        .map_err(|error| format!("Unable to replace workspace thread rows: {error}"))?;

    workspace_threads_insert_thread_rows(
        transaction,
        workspace_id,
        root_display,
        "active",
        threads,
        now,
    )?;
    workspace_threads_insert_thread_rows(
        transaction,
        workspace_id,
        root_display,
        "archived",
        archived_threads,
        now,
    )?;

    Ok(())
}

fn workspace_threads_thread_status_is_closed(thread: &Value) -> bool {
    let status = thread
        .get("status")
        .or_else(|| thread.get("activityStatus"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    matches!(
        status.as_str(),
        "closed" | "closing" | "exited" | "offline" | "terminated"
    )
}

fn workspace_threads_terminal_binding_matches(
    binding_value: Option<&Value>,
    binding: &WorkspaceThreadProviderSessionBinding,
) -> bool {
    let Some(binding_value) = binding_value else {
        return false;
    };
    let pane_matches = !binding.pane_id.trim().is_empty()
        && binding_value
            .get("paneId")
            .or_else(|| binding_value.get("pane_id"))
            .and_then(Value::as_str)
            .is_some_and(|pane_id| pane_id == binding.pane_id);
    let instance_matches = binding.instance_id.is_some_and(|instance_id| {
        binding_value
            .get("instanceId")
            .or_else(|| binding_value.get("instance_id"))
            .and_then(Value::as_u64)
            .is_some_and(|value| value == instance_id)
    });
    pane_matches || instance_matches
}

fn workspace_threads_thread_matches_provider_binding(
    thread: &Value,
    binding: &WorkspaceThreadProviderSessionBinding,
) -> bool {
    if workspace_threads_thread_status_is_closed(thread) {
        return false;
    }
    if workspace_threads_terminal_binding_matches(thread.get("terminalBinding"), binding) {
        return true;
    }
    if let Some(provider_binding) = thread
        .get("providerBindings")
        .and_then(|bindings| bindings.get(binding.agent_id.as_str()))
    {
        if workspace_threads_terminal_binding_matches(
            provider_binding.get("terminalBinding"),
            binding,
        ) {
            return true;
        }
    }
    if let Some(index) = binding.terminal_index {
        return thread
            .get("terminalIndex")
            .or_else(|| thread.get("terminal_index"))
            .and_then(Value::as_i64)
            .is_some_and(|value| value == index);
    }
    false
}

fn workspace_threads_resolve_thread_id_for_provider_binding(
    connection: &rusqlite::Connection,
    workspace_id: &str,
    binding: &WorkspaceThreadProviderSessionBinding,
) -> Result<Option<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT thread_id, thread_json
            FROM workspace_thread_thread_state
            WHERE workspace_id = ?1 AND bucket = 'active'
            ORDER BY updated_at DESC, thread_id DESC",
        )
        .map_err(|error| format!("Unable to prepare provider session thread lookup: {error}"))?;
    let mut rows = statement
        .query(rusqlite::params![workspace_id])
        .map_err(|error| format!("Unable to query provider session thread lookup: {error}"))?;

    while let Some(row) = rows
        .next()
        .map_err(|error| format!("Unable to read provider session thread lookup: {error}"))?
    {
        let thread_id = row
            .get::<_, String>(0)
            .map_err(|error| format!("Unable to read provider session thread id: {error}"))?;
        let thread_json = row
            .get::<_, String>(1)
            .map_err(|error| format!("Unable to read provider session thread JSON: {error}"))?;
        let Ok(thread) = serde_json::from_str::<Value>(&thread_json) else {
            continue;
        };
        if workspace_threads_thread_matches_provider_binding(&thread, binding) {
            if let Some(thread_id) = workspace_threads_clean_thread_id(&thread_id) {
                return Ok(Some(thread_id));
            }
        }
    }

    Ok(None)
}

fn workspace_threads_record_provider_session_binding(
    root_directory: Option<&str>,
    binding: WorkspaceThreadProviderSessionBinding,
) -> Result<bool, String> {
    let workspace_id = workspace_threads_clean_workspace_id(&binding.workspace_id)?;
    let Some(agent_id) = workspace_threads_clean_agent_id(&binding.agent_id) else {
        return Ok(false);
    };
    let Some(provider_session_id) =
        workspace_threads_clean_provider_session_id(&binding.provider_session_id)
    else {
        return Ok(false);
    };
    let (connection, root, _) = workspace_threads_open_store(root_directory, true)?;
    let Some(thread_id) = workspace_threads_clean_thread_id(&binding.thread_id).or_else(|| {
        workspace_threads_resolve_thread_id_for_provider_binding(
            &connection,
            &workspace_id,
            &binding,
        )
        .ok()
        .flatten()
    }) else {
        return Ok(false);
    };
    let native_session_id = workspace_threads_clean_provider_session_id(&binding.native_session_id)
        .unwrap_or_else(|| provider_session_id.clone());
    let mut normalized = binding.clone();
    normalized.workspace_id = workspace_id.clone();
    normalized.thread_id = thread_id.clone();
    normalized.agent_id = agent_id.clone();
    normalized.provider_session_id = provider_session_id.clone();
    normalized.native_session_id = native_session_id;
    normalized.native_session_kind = if normalized.native_session_kind.trim().is_empty() {
        "session".to_string()
    } else {
        normalized.native_session_kind.trim().to_string()
    };
    normalized.native_session_source = if normalized.native_session_source.trim().is_empty() {
        normalized.source.trim().to_string()
    } else {
        normalized.native_session_source.trim().to_string()
    };

    let binding_text = serde_json::to_string(&normalized)
        .map_err(|error| format!("Unable to serialize provider session binding: {error}"))?;
    let now = workspace_threads_now_millis();
    let root_display = workspace_path_display(&root);
    connection
        .execute(
            "INSERT INTO workspace_thread_provider_session_binding (
                workspace_id,
                thread_id,
                agent_id,
                provider_session_id,
                workspace_root,
                binding_json,
                created_at,
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
            ON CONFLICT(workspace_id, thread_id, agent_id) DO UPDATE SET
                provider_session_id = excluded.provider_session_id,
                workspace_root = excluded.workspace_root,
                binding_json = excluded.binding_json,
                updated_at = excluded.updated_at",
            rusqlite::params![
                workspace_id,
                thread_id,
                agent_id,
                provider_session_id,
                root_display,
                binding_text,
                now,
            ],
        )
        .map_err(|error| format!("Unable to persist provider session binding: {error}"))?;
    Ok(true)
}

fn workspace_threads_binding_text(value: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn workspace_threads_apply_provider_session_binding(state: &mut Value, binding: &Value) {
    let workspace_id = workspace_threads_binding_text(binding, &["workspaceId", "workspace_id"]);
    let thread_id = workspace_threads_binding_text(binding, &["threadId", "thread_id"]);
    let agent_id = workspace_threads_binding_text(binding, &["agentId", "agent_id"]);
    let provider_session_id = workspace_threads_binding_text(
        binding,
        &[
            "providerSessionId",
            "provider_session_id",
            "nativeSessionId",
            "native_session_id",
        ],
    );
    if workspace_id.is_empty()
        || thread_id.is_empty()
        || agent_id.is_empty()
        || provider_session_id.is_empty()
    {
        return;
    }
    let Some(state_object) = state.as_object_mut() else {
        return;
    };
    let now = workspace_threads_now_millis();
    let session_title = workspace_threads_binding_text(binding, &["sessionTitle", "session_title"]);
    let source = workspace_threads_binding_text(binding, &["source"]);
    let provider = workspace_threads_binding_text(binding, &["provider"]);
    let model_id = workspace_threads_binding_text(binding, &["modelId", "model_id"]);
    let terminal_index = binding
        .get("terminalIndex")
        .or_else(|| binding.get("terminal_index"))
        .and_then(Value::as_i64);

    if !state_object
        .get("threadOrder")
        .and_then(Value::as_array)
        .is_some_and(|order| {
            order
                .iter()
                .any(|value| value.as_str() == Some(thread_id.as_str()))
        })
    {
        let order_value = state_object
            .entry("threadOrder".to_string())
            .or_insert_with(|| json!([]));
        if let Some(order) = order_value.as_array_mut() {
            order.push(json!(thread_id.clone()));
        }
    }

    if let Some(index) = terminal_index {
        let ids_value = state_object
            .entry("terminalThreadIds".to_string())
            .or_insert_with(|| json!({}));
        if let Some(ids) = ids_value.as_object_mut() {
            ids.insert(index.to_string(), json!(thread_id.clone()));
        }
    }

    let threads_value = state_object
        .entry("threads".to_string())
        .or_insert_with(|| json!({}));
    let Some(threads) = threads_value.as_object_mut() else {
        return;
    };
    let thread_value = threads.entry(thread_id.clone()).or_insert_with(|| {
        json!({
            "activityStatus": "idle",
            "createdAt": now,
            "currentAgent": agent_id,
            "id": thread_id,
            "lastActiveAt": now,
            "lastMessageAt": "",
            "latestTurn": null,
            "materialized": true,
            "messageCount": 0,
            "messages": [],
            "pendingPrompt": null,
            "preferredAgent": agent_id,
            "projectionEvents": [],
            "providerBindings": {},
            "sessionName": if session_title.is_empty() { "Coding agent session" } else { session_title.as_str() },
            "status": "idle",
            "threadId": thread_id,
            "title": if session_title.is_empty() { "Coding agent session" } else { session_title.as_str() },
            "updatedAt": now,
            "workspaceId": workspace_id,
        })
    });
    let Some(thread) = thread_value.as_object_mut() else {
        return;
    };
    thread.insert("id".to_string(), json!(thread_id.clone()));
    thread.insert("workspaceId".to_string(), json!(workspace_id));
    thread.insert("currentAgent".to_string(), json!(agent_id.clone()));
    thread.insert("preferredAgent".to_string(), json!(agent_id.clone()));
    thread.insert("materialized".to_string(), json!(true));
    thread.insert(
        "transcriptSessionId".to_string(),
        json!(provider_session_id.clone()),
    );
    thread.insert("transcriptStatus".to_string(), json!("ready"));
    thread.insert("updatedAt".to_string(), json!(now.clone()));
    if let Some(index) = terminal_index {
        thread.insert("terminalIndex".to_string(), json!(index));
    }
    if !session_title.is_empty() {
        thread.insert("sessionName".to_string(), json!(session_title.clone()));
        thread.insert("title".to_string(), json!(session_title));
    }

    let provider_bindings_value = thread
        .entry("providerBindings".to_string())
        .or_insert_with(|| json!({}));
    let Some(provider_bindings) = provider_bindings_value.as_object_mut() else {
        return;
    };
    let binding_value = provider_bindings
        .entry(agent_id.clone())
        .or_insert_with(|| json!({ "agentId": agent_id.clone() }));
    let Some(binding_object) = binding_value.as_object_mut() else {
        return;
    };
    binding_object.insert("agentId".to_string(), json!(agent_id));
    binding_object.insert(
        "nativeSessionId".to_string(),
        json!(provider_session_id.clone()),
    );
    binding_object.insert("nativeSessionKind".to_string(), json!("session"));
    binding_object.insert(
        "nativeSessionSource".to_string(),
        json!(if source.is_empty() {
            "rust-session-binding"
        } else {
            source.as_str()
        }),
    );
    binding_object.insert("nativeSessionUpdatedAt".to_string(), json!(now));
    binding_object.insert("providerSessionId".to_string(), json!(provider_session_id));
    if !provider.is_empty() {
        binding_object.insert("provider".to_string(), json!(provider));
    }
    if !model_id.is_empty() {
        binding_object.insert("modelId".to_string(), json!(model_id));
        binding_object.insert("modelSource".to_string(), json!("session-binding"));
    }
}

fn workspace_threads_merge_provider_session_bindings(
    connection: &rusqlite::Connection,
    workspace_id: &str,
    state: &mut Value,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(
            "SELECT binding_json
            FROM workspace_thread_provider_session_binding
            WHERE workspace_id = ?1
            ORDER BY updated_at ASC",
        )
        .map_err(|error| format!("Unable to prepare provider session binding read: {error}"))?;
    let mut rows = statement
        .query(rusqlite::params![workspace_id])
        .map_err(|error| format!("Unable to read provider session binding rows: {error}"))?;

    while let Some(row) = rows
        .next()
        .map_err(|error| format!("Unable to read provider session binding row: {error}"))?
    {
        let binding_text = row
            .get::<_, String>(0)
            .map_err(|error| format!("Unable to read provider session binding JSON: {error}"))?;
        let Ok(binding) = serde_json::from_str::<Value>(&binding_text) else {
            continue;
        };
        workspace_threads_apply_provider_session_binding(state, &binding);
    }

    Ok(())
}

fn workspace_threads_read_split_state(
    connection: &rusqlite::Connection,
    workspace_id: &str,
) -> Result<Option<Value>, String> {
    let shell_text = match connection.query_row(
        "SELECT shell_json FROM workspace_thread_workspace_state WHERE workspace_id = ?1",
        rusqlite::params![workspace_id],
        |row| row.get::<_, String>(0),
    ) {
        Ok(value) => Some(value),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(error) => {
            return Err(format!(
                "Unable to read workspace thread shell from SQLite: {error}"
            ));
        }
    };
    let Some(shell_text) = shell_text else {
        return Ok(None);
    };

    let mut state = match serde_json::from_str::<Value>(&shell_text) {
        Ok(Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    };
    let mut threads = serde_json::Map::new();
    let mut archived_threads = serde_json::Map::new();
    let mut statement = connection
        .prepare(
            "SELECT bucket, thread_id, thread_json
            FROM workspace_thread_thread_state
            WHERE workspace_id = ?1
            ORDER BY updated_at ASC, thread_id ASC",
        )
        .map_err(|error| format!("Unable to prepare workspace thread row read: {error}"))?;
    let mut rows = statement
        .query(rusqlite::params![workspace_id])
        .map_err(|error| format!("Unable to read workspace thread rows: {error}"))?;

    while let Some(row) = rows
        .next()
        .map_err(|error| format!("Unable to read workspace thread row: {error}"))?
    {
        let bucket = row
            .get::<_, String>(0)
            .map_err(|error| format!("Unable to read workspace thread bucket: {error}"))?;
        let thread_id = row
            .get::<_, String>(1)
            .map_err(|error| format!("Unable to read workspace thread id: {error}"))?;
        let thread_text = row
            .get::<_, String>(2)
            .map_err(|error| format!("Unable to read workspace thread JSON: {error}"))?;
        let Some(safe_thread_id) = workspace_threads_clean_thread_id(&thread_id) else {
            continue;
        };
        let thread = serde_json::from_str::<Value>(&thread_text)
            .unwrap_or_else(|_| Value::Object(serde_json::Map::new()));
        if bucket == "archived" {
            archived_threads.insert(safe_thread_id, thread);
        } else {
            threads.insert(safe_thread_id, thread);
        }
    }

    state.insert("threads".to_string(), Value::Object(threads));
    state.insert(
        "archivedThreads".to_string(),
        Value::Object(archived_threads),
    );
    let mut state = Value::Object(state);
    workspace_threads_merge_provider_session_bindings(connection, workspace_id, &mut state)?;
    Ok(Some(state))
}

fn workspace_threads_read_blocking(
    request: WorkspaceThreadsReadRequest,
) -> Result<WorkspaceThreadsReadResult, String> {
    let mut threads = serde_json::Map::new();
    let mut results = Vec::new();

    for workspace in request.workspaces {
        let workspace_id = workspace_threads_clean_workspace_id(&workspace.workspace_id)?;
        let (mut connection, root, db_path) =
            workspace_threads_open_store(workspace.root_directory.as_deref(), true)?;
        let split_state = workspace_threads_read_split_state(&connection, &workspace_id)?;
        let state_text = match connection.query_row(
            "SELECT state_json FROM workspace_thread_state WHERE workspace_id = ?1",
            rusqlite::params![workspace_id.as_str()],
            |row| row.get::<_, String>(0),
        ) {
            Ok(value) => Some(value),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(error) => {
                return Err(format!(
                    "Unable to read workspace thread state from SQLite: {error}"
                ));
            }
        };
        let mut found = split_state.is_some() || state_text.is_some();
        if let Some(state) = split_state {
            threads.insert(workspace_id.clone(), state);
        } else if let Some(state_text) = state_text {
            if let Ok(Value::Object(_)) = serde_json::from_str::<Value>(&state_text) {
                let mut state = serde_json::from_str::<Value>(&state_text)
                    .unwrap_or_else(|_| Value::Object(serde_json::Map::new()));
                let now = workspace_threads_now_millis();
                let root_display = workspace_path_display(&root);
                let transaction = connection.transaction().map_err(|error| {
                    format!("Unable to start workspace thread migration transaction: {error}")
                })?;
                workspace_threads_write_split_state(
                    &transaction,
                    &workspace_id,
                    &root_display,
                    &state,
                    &now,
                )?;
                transaction.commit().map_err(|error| {
                    format!("Unable to commit workspace thread migration: {error}")
                })?;
                workspace_threads_merge_provider_session_bindings(
                    &connection,
                    &workspace_id,
                    &mut state,
                )?;
                threads.insert(workspace_id.clone(), state);
            }
        } else {
            let mut state = json!({
                "activeThreadId": "",
                "archivedThreadOrder": [],
                "archivedThreads": {},
                "terminalOrder": [],
                "terminalThreadIds": {},
                "terminals": {},
                "threadOrder": [],
                "threads": {},
                "threadsView": {},
            });
            workspace_threads_merge_provider_session_bindings(
                &connection,
                &workspace_id,
                &mut state,
            )?;
            let has_threads = state
                .get("threads")
                .and_then(Value::as_object)
                .is_some_and(|threads| !threads.is_empty());
            if has_threads {
                if let Some(first_thread_id) = state
                    .get("threadOrder")
                    .and_then(Value::as_array)
                    .and_then(|order| order.iter().find_map(Value::as_str))
                    .map(str::to_string)
                {
                    if let Some(object) = state.as_object_mut() {
                        object.insert("activeThreadId".to_string(), json!(first_thread_id));
                    }
                }
                found = true;
                threads.insert(workspace_id.clone(), state);
            }
        }
        results.push(WorkspaceThreadsReadWorkspaceResult {
            workspace_id,
            root_directory: workspace_path_display(&root),
            db_path: workspace_path_display(&db_path),
            found,
        });
    }

    Ok(WorkspaceThreadsReadResult {
        threads: Value::Object(threads),
        workspaces: results,
    })
}

fn workspace_threads_persist_blocking(
    request: WorkspaceThreadsPersistRequest,
) -> Result<WorkspaceThreadsPersistResult, String> {
    let mut saved = 0usize;

    for workspace in request.workspaces {
        let workspace_id = workspace_threads_clean_workspace_id(&workspace.workspace_id)?;
        let state_text = serde_json::to_string(&workspace.state)
            .map_err(|error| format!("Unable to serialize workspace thread state: {error}"))?;
        let now = workspace_threads_now_millis();
        let (mut connection, root, _) =
            workspace_threads_open_store(workspace.root_directory.as_deref(), true)?;
        let root_display = workspace_path_display(&root);
        let transaction = connection.transaction().map_err(|error| {
            format!("Unable to start workspace thread persist transaction: {error}")
        })?;
        transaction
            .execute(
                "INSERT INTO workspace_thread_state (
                    workspace_id,
                    workspace_root,
                    state_json,
                    created_at,
                    updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?4)
                ON CONFLICT(workspace_id) DO UPDATE SET
                    workspace_root = excluded.workspace_root,
                    state_json = excluded.state_json,
                    updated_at = excluded.updated_at",
                rusqlite::params![
                    workspace_id.as_str(),
                    root_display.as_str(),
                    state_text,
                    now,
                ],
            )
            .map_err(|error| format!("Unable to persist workspace thread state: {error}"))?;
        workspace_threads_write_split_state(
            &transaction,
            &workspace_id,
            &root_display,
            &workspace.state,
            &now,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("Unable to commit workspace thread persist: {error}"))?;
        saved += 1;
    }

    Ok(WorkspaceThreadsPersistResult { saved })
}

fn workspace_threads_apply_removed_thread_ids(
    transaction: &rusqlite::Transaction<'_>,
    workspace_id: &str,
    bucket: &str,
    thread_ids: Option<Vec<String>>,
) -> Result<usize, String> {
    let mut removed = 0usize;
    for thread_id in thread_ids.unwrap_or_default() {
        let Some(safe_thread_id) = workspace_threads_clean_thread_id(&thread_id) else {
            continue;
        };
        removed += transaction
            .execute(
                "DELETE FROM workspace_thread_thread_state
                WHERE workspace_id = ?1 AND bucket = ?2 AND thread_id = ?3",
                rusqlite::params![workspace_id, bucket, safe_thread_id.as_str()],
            )
            .map_err(|error| format!("Unable to remove workspace thread row: {error}"))?;
    }
    Ok(removed)
}

fn workspace_threads_delta_thread_rows(
    rows: Option<Vec<WorkspaceThreadsPersistDeltaThread>>,
) -> Vec<(String, Value)> {
    rows.unwrap_or_default()
        .into_iter()
        .filter_map(|entry| {
            workspace_threads_clean_thread_id(&entry.thread_id)
                .map(|safe_thread_id| (safe_thread_id, entry.state))
        })
        .collect()
}

fn workspace_threads_persist_delta_blocking(
    request: WorkspaceThreadsPersistDeltaRequest,
) -> Result<WorkspaceThreadsPersistResult, String> {
    let mut saved = 0usize;

    for workspace in request.workspaces {
        let workspace_id = workspace_threads_clean_workspace_id(&workspace.workspace_id)?;
        let now = workspace_threads_now_millis();
        let (mut connection, root, _) =
            workspace_threads_open_store(workspace.root_directory.as_deref(), true)?;
        let root_display = workspace_path_display(&root);
        let transaction = connection.transaction().map_err(|error| {
            format!("Unable to start workspace thread delta transaction: {error}")
        })?;

        let mut changed = false;
        if let Some(shell) = workspace.shell {
            let shell_text = serde_json::to_string(&shell)
                .map_err(|error| format!("Unable to serialize workspace thread shell: {error}"))?;
            transaction
                .execute(
                    "INSERT INTO workspace_thread_workspace_state (
                        workspace_id,
                        workspace_root,
                        shell_json,
                        created_at,
                        updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?4)
                    ON CONFLICT(workspace_id) DO UPDATE SET
                        workspace_root = excluded.workspace_root,
                        shell_json = excluded.shell_json,
                        updated_at = excluded.updated_at",
                    rusqlite::params![
                        workspace_id.as_str(),
                        root_display.as_str(),
                        shell_text,
                        now
                    ],
                )
                .map_err(|error| format!("Unable to persist workspace thread shell: {error}"))?;
            changed = true;
        }

        let active_rows = workspace_threads_delta_thread_rows(workspace.threads);
        if !active_rows.is_empty() {
            workspace_threads_insert_thread_rows(
                &transaction,
                &workspace_id,
                &root_display,
                "active",
                active_rows,
                &now,
            )?;
            changed = true;
        }

        let archived_rows = workspace_threads_delta_thread_rows(workspace.archived_threads);
        if !archived_rows.is_empty() {
            workspace_threads_insert_thread_rows(
                &transaction,
                &workspace_id,
                &root_display,
                "archived",
                archived_rows,
                &now,
            )?;
            changed = true;
        }

        if workspace_threads_apply_removed_thread_ids(
            &transaction,
            &workspace_id,
            "active",
            workspace.removed_thread_ids,
        )? > 0
        {
            changed = true;
        }
        if workspace_threads_apply_removed_thread_ids(
            &transaction,
            &workspace_id,
            "archived",
            workspace.removed_archived_thread_ids,
        )? > 0
        {
            changed = true;
        }

        transaction
            .commit()
            .map_err(|error| format!("Unable to commit workspace thread delta: {error}"))?;
        if changed {
            saved += 1;
        }
    }

    Ok(WorkspaceThreadsPersistResult { saved })
}

#[tauri::command]
async fn workspace_threads_read(
    request: WorkspaceThreadsReadRequest,
) -> Result<WorkspaceThreadsReadResult, String> {
    tauri::async_runtime::spawn_blocking(move || workspace_threads_read_blocking(request))
        .await
        .map_err(|error| format!("Workspace threads read worker failed: {error}"))?
}

#[tauri::command]
async fn workspace_threads_persist(
    request: WorkspaceThreadsPersistRequest,
) -> Result<WorkspaceThreadsPersistResult, String> {
    tauri::async_runtime::spawn_blocking(move || workspace_threads_persist_blocking(request))
        .await
        .map_err(|error| format!("Workspace threads persist worker failed: {error}"))?
}

#[tauri::command]
async fn workspace_threads_persist_delta(
    request: WorkspaceThreadsPersistDeltaRequest,
) -> Result<WorkspaceThreadsPersistResult, String> {
    tauri::async_runtime::spawn_blocking(move || workspace_threads_persist_delta_blocking(request))
        .await
        .map_err(|error| format!("Workspace threads delta persist worker failed: {error}"))?
}

#[tauri::command]
async fn workspace_agent_session_history_list(
    request: WorkspaceAgentSessionHistoryListRequest,
) -> Result<WorkspaceAgentSessionHistoryListResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        workspace_agent_session_history_list_blocking(request)
    })
    .await
    .map_err(|error| format!("Workspace session history read worker failed: {error}"))?
}

#[cfg(test)]
mod workspace_threads_store_tests {
    use super::*;

    fn unique_workspace_threads_test_root(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        env::temp_dir().join(format!("diffforge-workspace-threads-{name}-{nanos}"))
    }

    #[test]
    fn provider_session_binding_round_trips_without_prior_thread_state() {
        let root = unique_workspace_threads_test_root("provider-binding");
        fs::create_dir_all(&root).expect("create workspace root");
        let root_text = root.to_string_lossy().to_string();

        let recorded = workspace_threads_record_provider_session_binding(
            Some(root_text.as_str()),
            WorkspaceThreadProviderSessionBinding {
                agent_id: "codex".to_string(),
                cwd: root_text.clone(),
                instance_id: Some(42),
                model_id: "gpt-5.5".to_string(),
                native_session_id: "codex-session-12345678".to_string(),
                native_session_kind: "session".to_string(),
                native_session_source: "terminal-output".to_string(),
                observed_at_ms: 1234,
                pane_id: "pane-session-binding".to_string(),
                provider: "codex".to_string(),
                provider_session_id: "codex-session-12345678".to_string(),
                session_title: "Codex".to_string(),
                source: "terminal-output".to_string(),
                terminal_index: Some(1),
                thread_id: "thread-session-binding".to_string(),
                workspace_id: "workspace-session-binding".to_string(),
            },
        )
        .expect("record provider binding");
        assert!(recorded);

        let result = workspace_threads_read_blocking(WorkspaceThreadsReadRequest {
            workspaces: vec![WorkspaceThreadsReadWorkspace {
                root_directory: Some(root_text.clone()),
                workspace_id: "workspace-session-binding".to_string(),
            }],
        })
        .expect("read workspace threads");
        assert_eq!(result.workspaces.len(), 1);
        assert!(result.workspaces[0].found);

        let state = result
            .threads
            .get("workspace-session-binding")
            .expect("workspace state");
        assert_eq!(
            state
                .pointer("/terminalThreadIds/1")
                .and_then(Value::as_str),
            Some("thread-session-binding")
        );
        assert_eq!(
            state
                .pointer("/threads/thread-session-binding/transcriptSessionId")
                .and_then(Value::as_str),
            Some("codex-session-12345678")
        );
        assert_eq!(
            state
                .pointer("/threads/thread-session-binding/providerBindings/codex/nativeSessionId")
                .and_then(Value::as_str),
            Some("codex-session-12345678")
        );
        assert_eq!(
            state
                .pointer("/threads/thread-session-binding/providerBindings/codex/modelId")
                .and_then(Value::as_str),
            Some("gpt-5.5")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_agent_session_history_round_trips_by_workspace() {
        let root = unique_workspace_threads_test_root("agent-session-history");
        fs::create_dir_all(&root).expect("create workspace root");
        let root_text = root.to_string_lossy().to_string();

        let recorded = workspace_agent_session_history_upsert_blocking(
            Some(root_text.as_str()),
            WorkspaceAgentSessionHistoryRecord {
                agent_id: "openai".to_string(),
                coordination_session_id: "coord-session-1".to_string(),
                created_at_ms: Some(1000),
                cwd: root_text.clone(),
                id: "session-history-1".to_string(),
                model_id: "gpt-5.5".to_string(),
                model_source: "launch".to_string(),
                native_session_id: "".to_string(),
                observed_at_ms: Some(2000),
                pane_id: "pane-session-history".to_string(),
                provider: "openai".to_string(),
                provider_session_id: "".to_string(),
                slot_key: "slot-a".to_string(),
                source: "terminal-open".to_string(),
                status: "starting".to_string(),
                terminal_index: Some(2),
                terminal_instance_id: Some(42),
                thread_id: "thread-session-history".to_string(),
                title: "Ada".to_string(),
                workspace_id: "workspace-session-history".to_string(),
                workspace_name: "Session History".to_string(),
            },
        )
        .expect("record session history");
        assert!(recorded);

        let other_recorded = workspace_agent_session_history_upsert_blocking(
            Some(root_text.as_str()),
            WorkspaceAgentSessionHistoryRecord {
                agent_id: "claude".to_string(),
                coordination_session_id: "coord-other".to_string(),
                created_at_ms: Some(1000),
                cwd: root_text.clone(),
                id: "session-history-other".to_string(),
                model_id: "sonnet".to_string(),
                model_source: "launch".to_string(),
                native_session_id: "".to_string(),
                observed_at_ms: Some(2000),
                pane_id: "pane-other".to_string(),
                provider: "claude".to_string(),
                provider_session_id: "".to_string(),
                slot_key: "slot-b".to_string(),
                source: "terminal-open".to_string(),
                status: "idle".to_string(),
                terminal_index: Some(3),
                terminal_instance_id: Some(43),
                thread_id: "thread-other".to_string(),
                title: "Other".to_string(),
                workspace_id: "workspace-other".to_string(),
                workspace_name: "Other".to_string(),
            },
        )
        .expect("record other workspace session history");
        assert!(other_recorded);

        let result =
            workspace_agent_session_history_list_blocking(WorkspaceAgentSessionHistoryListRequest {
                limit: Some(50),
                root_directory: Some(root_text.clone()),
                workspace_id: "workspace-session-history".to_string(),
            })
            .expect("list session history");
        assert_eq!(result.items.len(), 1);
        let item = &result.items[0];
        assert_eq!(item.id, "session-history-1");
        assert_eq!(item.agent_id, "codex");
        assert_eq!(item.model_id, "gpt-5.5");
        assert_eq!(item.status, "starting");
        assert_eq!(item.created_at_ms, 1000);
        assert_eq!(item.latest_at_ms, 2000);
        assert_eq!(item.terminal_index, Some(2));

        let updated = workspace_agent_session_history_upsert_blocking(
            Some(root_text.as_str()),
            WorkspaceAgentSessionHistoryRecord {
                agent_id: "codex".to_string(),
                coordination_session_id: "coord-session-1".to_string(),
                created_at_ms: None,
                cwd: root_text.clone(),
                id: "session-history-1".to_string(),
                model_id: "".to_string(),
                model_source: "".to_string(),
                native_session_id: "codex-native-123".to_string(),
                observed_at_ms: Some(3000),
                pane_id: "pane-session-history".to_string(),
                provider: "codex".to_string(),
                provider_session_id: "codex-provider-123".to_string(),
                slot_key: "".to_string(),
                source: "provider-session".to_string(),
                status: "idle".to_string(),
                terminal_index: None,
                terminal_instance_id: None,
                thread_id: "thread-session-history".to_string(),
                title: "".to_string(),
                workspace_id: "workspace-session-history".to_string(),
                workspace_name: "".to_string(),
            },
        )
        .expect("update session history");
        assert!(updated);

        let result =
            workspace_agent_session_history_list_blocking(WorkspaceAgentSessionHistoryListRequest {
                limit: Some(50),
                root_directory: Some(root_text.clone()),
                workspace_id: "workspace-session-history".to_string(),
            })
            .expect("list updated session history");
        assert_eq!(result.items.len(), 1);
        let item = &result.items[0];
        assert_eq!(item.model_id, "gpt-5.5");
        assert_eq!(item.provider_session_id, "codex-provider-123");
        assert_eq!(item.native_session_id, "codex-native-123");
        assert_eq!(item.status, "idle");
        assert_eq!(item.title, "Ada");
        assert_eq!(item.created_at_ms, 1000);
        assert_eq!(item.latest_at_ms, 3000);
        assert_eq!(item.terminal_index, Some(2));

        let _ = fs::remove_dir_all(root);
    }
}

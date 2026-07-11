#[derive(Deserialize)]
struct WorkspaceThreadsReadWorkspace {
    workspace_id: String,
    root_directory: Option<String>,
}

#[derive(Deserialize)]
struct WorkspaceThreadsReadRequest {
    workspaces: Vec<WorkspaceThreadsReadWorkspace>,
}

#[derive(Serialize)]
struct WorkspaceThreadsReadWorkspaceResult {
    workspace_id: String,
    root_directory: String,
    db_path: String,
    found: bool,
}

#[derive(Serialize)]
struct WorkspaceThreadsReadResult {
    threads: Value,
    /// Wall-clock stage timings per workspace (open/read/parse), surfaced in
    /// the frontend hydration trace — the read was a 3s black box otherwise.
    timings: Value,
    workspaces: Vec<WorkspaceThreadsReadWorkspaceResult>,
}

#[derive(Deserialize)]
struct WorkspaceThreadsPersistWorkspace {
    workspace_id: String,
    root_directory: Option<String>,
    state: Value,
}

#[derive(Deserialize)]
struct WorkspaceThreadsPersistRequest {
    workspaces: Vec<WorkspaceThreadsPersistWorkspace>,
}

#[derive(Deserialize)]
struct WorkspaceThreadsPersistDeltaThread {
    thread_id: String,
    state: Value,
}

#[derive(Deserialize)]
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
struct WorkspaceThreadsPersistDeltaRequest {
    workspaces: Vec<WorkspaceThreadsPersistDeltaWorkspace>,
}

#[derive(Serialize)]
struct WorkspaceThreadsPersistResult {
    saved: usize,
}

#[derive(Deserialize)]
struct WorkspaceAgentSessionHistoryListRequest {
    workspace_id: String,
    root_directory: Option<String>,
    limit: Option<usize>,
    fast: Option<bool>,
}

#[derive(Clone, Serialize)]
struct WorkspaceAgentSessionHistoryChatSync {
    status: String,
    label: String,
    pending_packet_count: usize,
    syncing_packet_count: usize,
    retrying_packet_count: usize,
    failed_packet_count: usize,
    record_acked_count: usize,
    record_total_count: usize,
    acked_at_ms: u64,
    failed_at_ms: u64,
    updated_at_ms: u64,
    last_enqueued_at_ms: u64,
    last_error: String,
}

impl Default for WorkspaceAgentSessionHistoryChatSync {
    fn default() -> Self {
        Self {
            status: "waiting".to_string(),
            label: "Waiting".to_string(),
            pending_packet_count: 0,
            syncing_packet_count: 0,
            retrying_packet_count: 0,
            failed_packet_count: 0,
            record_acked_count: 0,
            record_total_count: 0,
            acked_at_ms: 0,
            failed_at_ms: 0,
            updated_at_ms: 0,
            last_enqueued_at_ms: 0,
            last_error: String::new(),
        }
    }
}

#[derive(Clone, Serialize)]
struct WorkspaceAgentSessionHistoryItem {
    id: String,
    workspace_id: String,
    workspace_name: String,
    workspace_root: String,
    coordination_session_id: String,
    provider_session_id: String,
    native_session_id: String,
    fork_from_provider_session_id: String,
    shared_history_id: String,
    agent_id: String,
    provider: String,
    model_id: String,
    model_source: String,
    session_mode: String,
    file_authority: String,
    coordination_mode: String,
    thread_id: String,
    pane_id: String,
    terminal_instance_id: Option<u64>,
    terminal_index: Option<i64>,
    slot_key: String,
    cwd: String,
    status: String,
    title: String,
    first_user_message: String,
    chat_sync: WorkspaceAgentSessionHistoryChatSync,
    source: String,
    created_at_ms: u64,
    latest_at_ms: u64,
}

#[derive(Serialize)]
struct WorkspaceAgentSessionHistoryListResult {
    generated_at_ms: u64,
    workspace_id: String,
    root_directory: String,
    db_path: String,
    items: Vec<WorkspaceAgentSessionHistoryItem>,
}

#[derive(Clone, Serialize, Deserialize)]
struct WorkspaceAgentSessionHistoryRecord {
    id: String,
    workspace_id: String,
    workspace_name: String,
    coordination_session_id: String,
    provider_session_id: String,
    native_session_id: String,
    fork_from_provider_session_id: String,
    shared_history_id: String,
    agent_id: String,
    provider: String,
    model_id: String,
    model_source: String,
    session_mode: String,
    file_authority: String,
    coordination_mode: String,
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
struct WorkspaceThreadProviderSessionBinding {
    workspace_id: String,
    thread_id: String,
    agent_id: String,
    provider_session_id: String,
    native_session_id: String,
    fork_from_provider_session_id: String,
    shared_history_id: String,
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

fn workspace_agent_session_history_session_id_is_visible(agent_id: &str, session_id: &str) -> bool {
    let Some(agent_id) = workspace_threads_clean_agent_id(agent_id) else {
        return false;
    };
    let Some(session_id) = workspace_threads_clean_provider_session_id(session_id) else {
        return false;
    };
    if agent_id == "opencode" {
        return session_id.starts_with("ses_");
    }
    true
}

fn workspace_agent_session_history_record_session_id(
    record: &WorkspaceAgentSessionHistoryRecord,
) -> Option<String> {
    workspace_threads_clean_provider_session_id(&record.provider_session_id)
        .or_else(|| workspace_threads_clean_provider_session_id(&record.native_session_id))
}

fn workspace_agent_session_history_shared_history_id(
    workspace_id: &str,
    agent_id: &str,
    provider_session_id: &str,
    fork_from_provider_session_id: &str,
) -> String {
    let Some(workspace_id) = workspace_threads_clean_workspace_id(workspace_id).ok() else {
        return String::new();
    };
    let Some(agent_id) = workspace_threads_clean_agent_id(agent_id) else {
        return String::new();
    };
    let root_session_id = workspace_threads_clean_provider_session_id(fork_from_provider_session_id)
        .or_else(|| workspace_threads_clean_provider_session_id(provider_session_id));
    let Some(root_session_id) = root_session_id else {
        return String::new();
    };
    format!("history:{workspace_id}:{agent_id}:{root_session_id}")
        .chars()
        .take(512)
        .collect()
}

fn workspace_agent_session_history_item_session_id(
    item: &WorkspaceAgentSessionHistoryItem,
) -> Option<String> {
    workspace_threads_clean_provider_session_id(&item.provider_session_id)
        .or_else(|| workspace_threads_clean_provider_session_id(&item.native_session_id))
}

fn workspace_agent_session_history_item_is_visible(
    item: &WorkspaceAgentSessionHistoryItem,
) -> bool {
    let Some(agent_id) = workspace_threads_clean_agent_id(&item.agent_id)
        .or_else(|| workspace_threads_clean_agent_id(&item.provider))
    else {
        return false;
    };
    let Some(session_id) = workspace_agent_session_history_item_session_id(item) else {
        return false;
    };
    workspace_agent_session_history_session_id_is_visible(&agent_id, &session_id)
}

fn workspace_agent_session_history_identity(
    workspace_id: &str,
    agent_id: &str,
    session_id: &str,
) -> Option<String> {
    let workspace_id = workspace_threads_clean_workspace_id(workspace_id).ok()?;
    let agent_id = workspace_threads_clean_agent_id(agent_id)?;
    let session_id = workspace_threads_clean_provider_session_id(session_id)?;
    workspace_agent_session_history_session_id_is_visible(&agent_id, &session_id)
        .then(|| format!("{workspace_id}\n{agent_id}\n{session_id}"))
}

fn workspace_agent_session_history_record_id(
    workspace_id: &str,
    agent_id: &str,
    session_id: &str,
) -> String {
    format!("session:{workspace_id}:{agent_id}:{session_id}")
        .chars()
        .take(512)
        .collect()
}

fn workspace_agent_session_history_item_identity(
    item: &WorkspaceAgentSessionHistoryItem,
) -> Option<String> {
    let agent_id = workspace_threads_clean_agent_id(&item.agent_id)
        .or_else(|| workspace_threads_clean_agent_id(&item.provider))?;
    let session_id = workspace_agent_session_history_item_session_id(item)?;
    workspace_agent_session_history_identity(&item.workspace_id, &agent_id, &session_id)
}

fn workspace_agent_session_history_merge_text(current: &mut String, candidate: String) {
    if current.trim().is_empty() && !candidate.trim().is_empty() {
        *current = candidate;
    }
}

fn workspace_agent_session_history_merge_item(
    current: &mut WorkspaceAgentSessionHistoryItem,
    candidate: WorkspaceAgentSessionHistoryItem,
) {
    current.created_at_ms = current.created_at_ms.min(candidate.created_at_ms);
    current.latest_at_ms = current.latest_at_ms.max(candidate.latest_at_ms);
    workspace_agent_session_history_merge_text(
        &mut current.workspace_name,
        candidate.workspace_name.clone(),
    );
    workspace_agent_session_history_merge_text(
        &mut current.coordination_session_id,
        candidate.coordination_session_id.clone(),
    );
    workspace_agent_session_history_merge_text(
        &mut current.provider_session_id,
        candidate.provider_session_id.clone(),
    );
    workspace_agent_session_history_merge_text(
        &mut current.native_session_id,
        candidate.native_session_id.clone(),
    );
    workspace_agent_session_history_merge_text(
        &mut current.fork_from_provider_session_id,
        candidate.fork_from_provider_session_id.clone(),
    );
    workspace_agent_session_history_merge_text(
        &mut current.shared_history_id,
        candidate.shared_history_id.clone(),
    );
    workspace_agent_session_history_merge_text(&mut current.model_id, candidate.model_id.clone());
    workspace_agent_session_history_merge_text(
        &mut current.model_source,
        candidate.model_source.clone(),
    );
    workspace_agent_session_history_merge_text(
        &mut current.session_mode,
        candidate.session_mode.clone(),
    );
    workspace_agent_session_history_merge_text(
        &mut current.file_authority,
        candidate.file_authority.clone(),
    );
    workspace_agent_session_history_merge_text(
        &mut current.coordination_mode,
        candidate.coordination_mode.clone(),
    );
    workspace_agent_session_history_merge_text(&mut current.thread_id, candidate.thread_id.clone());
    workspace_agent_session_history_merge_text(&mut current.pane_id, candidate.pane_id.clone());
    workspace_agent_session_history_merge_text(&mut current.slot_key, candidate.slot_key.clone());
    workspace_agent_session_history_merge_text(&mut current.cwd, candidate.cwd.clone());
    workspace_agent_session_history_merge_text(&mut current.status, candidate.status.clone());
    workspace_agent_session_history_merge_text(&mut current.title, candidate.title.clone());
    workspace_agent_session_history_merge_text(&mut current.source, candidate.source.clone());
    if current.terminal_instance_id.is_none() {
        current.terminal_instance_id = candidate.terminal_instance_id;
    }
    if current.terminal_index.is_none() {
        current.terminal_index = candidate.terminal_index;
    }
}

fn workspace_agent_session_history_dedupe_items(
    items: Vec<WorkspaceAgentSessionHistoryItem>,
) -> Vec<WorkspaceAgentSessionHistoryItem> {
    let mut deduped = Vec::<WorkspaceAgentSessionHistoryItem>::new();
    let mut positions = HashMap::<String, usize>::new();
    for item in items {
        let Some(identity) = workspace_agent_session_history_item_identity(&item) else {
            continue;
        };
        if let Some(index) = positions.get(&identity).copied() {
            workspace_agent_session_history_merge_item(&mut deduped[index], item);
            continue;
        }
        positions.insert(identity, deduped.len());
        deduped.push(item);
    }
    deduped
}

fn workspace_agent_session_history_limit_with_fork_parents(
    mut items: Vec<WorkspaceAgentSessionHistoryItem>,
    limit: usize,
) -> Vec<WorkspaceAgentSessionHistoryItem> {
    if items.len() <= limit {
        return items;
    }
    let remaining = items.split_off(limit);
    let mut selected = items;
    let mut selected_identities = selected
        .iter()
        .filter_map(workspace_agent_session_history_item_identity)
        .collect::<HashSet<_>>();
    let parent_identities = selected
        .iter()
        .filter_map(|item| {
            let parent_session_id =
                workspace_threads_clean_provider_session_id(&item.fork_from_provider_session_id)?;
            let agent_id = workspace_threads_clean_agent_id(&item.agent_id)
                .or_else(|| workspace_threads_clean_agent_id(&item.provider))?;
            workspace_agent_session_history_identity(
                &item.workspace_id,
                &agent_id,
                &parent_session_id,
            )
        })
        .collect::<HashSet<_>>();
    if parent_identities.is_empty() {
        return selected;
    }
    for item in remaining {
        let Some(identity) = workspace_agent_session_history_item_identity(&item) else {
            continue;
        };
        if parent_identities.contains(&identity) && selected_identities.insert(identity) {
            selected.push(item);
        }
    }
    selected
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

fn workspace_threads_add_column_if_missing(
    connection: &rusqlite::Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("Unable to inspect {table} schema: {error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Unable to read {table} schema: {error}"))?
        .flatten()
        .collect::<Vec<_>>();
    if columns.iter().any(|name| name == column) {
        return Ok(());
    }
    connection
        .execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"), [])
        .map_err(|error| format!("Unable to add {table}.{column}: {error}"))?;
    Ok(())
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
                fork_from_provider_session_id TEXT NOT NULL DEFAULT '',
                shared_history_id TEXT NOT NULL DEFAULT '',
                agent_id TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT '',
                model_id TEXT NOT NULL DEFAULT '',
                model_source TEXT NOT NULL DEFAULT '',
                session_mode TEXT NOT NULL DEFAULT '',
                file_authority TEXT NOT NULL DEFAULT '',
                coordination_mode TEXT NOT NULL DEFAULT '',
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
    workspace_threads_add_column_if_missing(
        &connection,
        "workspace_agent_session_history",
        "fork_from_provider_session_id",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    workspace_threads_add_column_if_missing(
        &connection,
        "workspace_agent_session_history",
        "shared_history_id",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    workspace_threads_add_column_if_missing(
        &connection,
        "workspace_agent_session_history",
        "session_mode",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    workspace_threads_add_column_if_missing(
        &connection,
        "workspace_agent_session_history",
        "file_authority",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    workspace_threads_add_column_if_missing(
        &connection,
        "workspace_agent_session_history",
        "coordination_mode",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    connection
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_workspace_agent_session_history_fork_parent
                ON workspace_agent_session_history(workspace_id, fork_from_provider_session_id);
            CREATE INDEX IF NOT EXISTS idx_workspace_agent_session_history_shared
                ON workspace_agent_session_history(workspace_id, shared_history_id);",
        )
        .map_err(|error| {
            format!("Unable to initialize workspace session fork indexes: {error}")
        })?;
    Ok((connection, root, db_path))
}

fn workspace_agent_session_history_upsert_blocking(
    root_directory: Option<&str>,
    record: WorkspaceAgentSessionHistoryRecord,
) -> Result<bool, String> {
    let workspace_id = workspace_threads_clean_workspace_id(&record.workspace_id)?;
    let Some(agent_id) = workspace_threads_clean_agent_id(&record.agent_id) else {
        return Ok(false);
    };
    let provider =
        workspace_threads_clean_agent_id(&record.provider).unwrap_or_else(|| agent_id.clone());
    let provider_session_id =
        workspace_threads_clean_provider_session_id(&record.provider_session_id)
            .unwrap_or_default();
    let native_session_id =
        workspace_threads_clean_provider_session_id(&record.native_session_id).unwrap_or_default();
    let fork_from_provider_session_id =
        workspace_threads_clean_provider_session_id(&record.fork_from_provider_session_id)
            .unwrap_or_default();
    let visible_session_id = workspace_agent_session_history_record_session_id(&record);
    if !visible_session_id.as_deref().is_some_and(|session_id| {
        workspace_agent_session_history_session_id_is_visible(&provider, session_id)
    }) {
        return Ok(false);
    }
    let id = workspace_agent_session_history_record_id(
        &workspace_id,
        &provider,
        visible_session_id.as_deref().unwrap_or_default(),
    );
    let Some(id) = workspace_threads_clean_thread_id(&id) else {
        return Ok(false);
    };
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
    let shared_history_id = workspace_threads_clean_optional_text(
        if record.shared_history_id.trim().is_empty() {
            workspace_agent_session_history_shared_history_id(
                &workspace_id,
                &provider,
                visible_session_id.as_deref().unwrap_or_default(),
                &fork_from_provider_session_id,
            )
        } else {
            record.shared_history_id.clone()
        }
        .as_str(),
        512,
    );

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
                fork_from_provider_session_id,
                shared_history_id,
                agent_id,
                provider,
                model_id,
                model_source,
                session_mode,
                file_authority,
                coordination_mode,
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
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?28)
            ON CONFLICT(id) DO UPDATE SET
                workspace_id = excluded.workspace_id,
                workspace_root = excluded.workspace_root,
                workspace_name = CASE WHEN excluded.workspace_name != '' THEN excluded.workspace_name ELSE workspace_agent_session_history.workspace_name END,
                coordination_session_id = CASE WHEN excluded.coordination_session_id != '' THEN excluded.coordination_session_id ELSE workspace_agent_session_history.coordination_session_id END,
                provider_session_id = CASE WHEN excluded.provider_session_id != '' THEN excluded.provider_session_id ELSE workspace_agent_session_history.provider_session_id END,
                native_session_id = CASE WHEN excluded.native_session_id != '' THEN excluded.native_session_id ELSE workspace_agent_session_history.native_session_id END,
                fork_from_provider_session_id = CASE WHEN excluded.fork_from_provider_session_id != '' THEN excluded.fork_from_provider_session_id ELSE workspace_agent_session_history.fork_from_provider_session_id END,
                shared_history_id = CASE WHEN excluded.shared_history_id != '' THEN excluded.shared_history_id ELSE workspace_agent_session_history.shared_history_id END,
                agent_id = excluded.agent_id,
                provider = CASE WHEN excluded.provider != '' THEN excluded.provider ELSE workspace_agent_session_history.provider END,
                model_id = CASE WHEN excluded.model_id != '' THEN excluded.model_id ELSE workspace_agent_session_history.model_id END,
                model_source = CASE WHEN excluded.model_source != '' THEN excluded.model_source ELSE workspace_agent_session_history.model_source END,
                session_mode = CASE WHEN excluded.session_mode != '' THEN excluded.session_mode ELSE workspace_agent_session_history.session_mode END,
                file_authority = CASE WHEN excluded.file_authority != '' THEN excluded.file_authority ELSE workspace_agent_session_history.file_authority END,
                coordination_mode = CASE WHEN excluded.coordination_mode != '' THEN excluded.coordination_mode ELSE workspace_agent_session_history.coordination_mode END,
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
                provider_session_id,
                native_session_id,
                fork_from_provider_session_id,
                shared_history_id,
                agent_id,
                provider,
                workspace_threads_clean_optional_text(&record.model_id, 160),
                workspace_threads_clean_optional_text(&record.model_source, 80),
                workspace_threads_clean_optional_text(&record.session_mode, 80),
                workspace_threads_clean_optional_text(&record.file_authority, 80),
                workspace_threads_clean_optional_text(&record.coordination_mode, 80),
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
        transcript.messages.into_iter().find(|message| {
            message.role.eq_ignore_ascii_case("user") && !message.text.trim().is_empty()
        })
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

fn workspace_agent_session_history_enrich_previews(items: &mut [WorkspaceAgentSessionHistoryItem]) {
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

#[derive(Default)]
struct WorkspaceAgentSessionHistoryChatSyncAccumulator {
    pending_packet_count: usize,
    syncing_packet_count: usize,
    retrying_packet_count: usize,
    failed_packet_count: usize,
    record_acked_count: usize,
    record_total_count: usize,
    acked_at_ms: u64,
    failed_at_ms: u64,
    updated_at_ms: u64,
    last_enqueued_at_ms: u64,
    last_error: String,
}

impl WorkspaceAgentSessionHistoryChatSyncAccumulator {
    fn apply_outbox_row(
        &mut self,
        status: &str,
        attempt_count: i64,
        last_error: String,
        created_at_ms: u64,
        updated_at_ms: u64,
        total_record_count: usize,
    ) {
        match status.trim().to_ascii_lowercase().as_str() {
            "in_flight" => {
                self.syncing_packet_count = self.syncing_packet_count.saturating_add(1);
            }
            "retrying" => {
                self.retrying_packet_count = self.retrying_packet_count.saturating_add(1);
            }
            "dead_letter" | "rejected" => {
                self.failed_packet_count = self.failed_packet_count.saturating_add(1);
            }
            "queued" if attempt_count > 0 => {
                self.retrying_packet_count = self.retrying_packet_count.saturating_add(1);
            }
            "queued" => {
                self.pending_packet_count = self.pending_packet_count.saturating_add(1);
            }
            _ => {}
        }
        self.last_enqueued_at_ms = self.last_enqueued_at_ms.max(created_at_ms);
        self.updated_at_ms = self.updated_at_ms.max(updated_at_ms);
        self.record_total_count = self.record_total_count.max(total_record_count);
        if !last_error.trim().is_empty() {
            self.last_error = last_error;
        }
    }

    fn apply_session_state(
        &mut self,
        record_total_count: usize,
        acked_at_ms: u64,
        failed_at_ms: u64,
        updated_at_ms: u64,
        last_error: String,
    ) {
        self.record_total_count = self.record_total_count.max(record_total_count);
        self.acked_at_ms = self.acked_at_ms.max(acked_at_ms);
        self.failed_at_ms = self.failed_at_ms.max(failed_at_ms);
        self.updated_at_ms = self.updated_at_ms.max(updated_at_ms);
        if !last_error.trim().is_empty() {
            self.last_error = last_error;
        }
    }

    fn apply_record_ack_count(&mut self, record_acked_count: usize) {
        self.record_acked_count = self.record_acked_count.max(record_acked_count);
    }

    fn into_chat_sync(self) -> WorkspaceAgentSessionHistoryChatSync {
        let complete = self.acked_at_ms > 0
            && (self.record_total_count == 0 || self.record_acked_count >= self.record_total_count);
        let (status, label) = if self.syncing_packet_count > 0 || self.retrying_packet_count > 0 {
            ("syncing", "Syncing")
        } else if self.pending_packet_count > 0 {
            ("waiting", "Waiting")
        } else if self.failed_packet_count > 0 || self.failed_at_ms > 0 {
            ("failed", "Failed")
        } else if complete {
            ("synced", "Synced")
        } else {
            ("waiting", "Waiting")
        };
        WorkspaceAgentSessionHistoryChatSync {
            status: status.to_string(),
            label: label.to_string(),
            pending_packet_count: self.pending_packet_count,
            syncing_packet_count: self.syncing_packet_count,
            retrying_packet_count: self.retrying_packet_count,
            failed_packet_count: self.failed_packet_count,
            record_acked_count: self.record_acked_count,
            record_total_count: self.record_total_count,
            acked_at_ms: self.acked_at_ms,
            failed_at_ms: self.failed_at_ms,
            updated_at_ms: self.updated_at_ms,
            last_enqueued_at_ms: self.last_enqueued_at_ms,
            last_error: self.last_error,
        }
    }
}

fn workspace_agent_session_history_chat_sync_key(
    workspace_id: &str,
    provider: &str,
    session_id: &str,
) -> Option<String> {
    let workspace_id = workspace_threads_clean_workspace_id(workspace_id).ok()?;
    let provider = workspace_threads_clean_agent_id(provider)?;
    let session_id = workspace_threads_clean_provider_session_id(session_id)?;
    Some(format!("{workspace_id}\n{provider}\n{session_id}"))
}

fn workspace_agent_session_history_item_chat_sync_key(
    item: &WorkspaceAgentSessionHistoryItem,
) -> Option<String> {
    let provider = workspace_threads_clean_agent_id(&item.provider)
        .or_else(|| workspace_threads_clean_agent_id(&item.agent_id))?;
    let session_id = workspace_agent_session_history_item_session_id(item)?;
    workspace_agent_session_history_chat_sync_key(&item.workspace_id, &provider, &session_id)
}

fn workspace_agent_session_history_payload_chat_sync_key(payload: &Value) -> Option<String> {
    let workspace_id = cloud_mcp_payload_text(payload, &["workspace_id"])?;
    let provider = cloud_mcp_payload_text(payload, &["provider", "agent_kind"])?;
    let session_id =
        cloud_mcp_payload_text(payload, &["session_id", "provider_session_id"])?;
    workspace_agent_session_history_chat_sync_key(&workspace_id, &provider, &session_id)
}

fn workspace_agent_session_history_payload_scope_matches(
    payload: &Value,
    scope_key: &str,
    device_id: &str,
) -> bool {
    let payload_scope_key = cloud_mcp_payload_text(payload, &["scope_key"])
        .unwrap_or_default();
    let payload_device_id = cloud_mcp_payload_text(payload, &["device_id"])
        .unwrap_or_default();
    (payload_scope_key.is_empty() || payload_scope_key == scope_key)
        && (payload_device_id.is_empty() || payload_device_id == device_id)
}

fn workspace_agent_session_history_enrich_chat_sync(items: &mut [WorkspaceAgentSessionHistoryItem]) {
    let mut summaries = HashMap::<String, WorkspaceAgentSessionHistoryChatSyncAccumulator>::new();
    for item in items.iter() {
        if let Some(key) = workspace_agent_session_history_item_chat_sync_key(item) {
            summaries.entry(key).or_default();
        }
    }
    if summaries.is_empty() {
        return;
    }

    let scope_key = cloud_mcp_process_account_scope_key();
    let device_profile = cloud_mcp_desktop_device_profile();
    let device_id = cloud_mcp_payload_text(&device_profile, &["device_id"])
        .unwrap_or_else(|| "desktop-primary".to_string());
    let Ok(conn) = cloud_mcp_open_outbox_conn() else {
        return;
    };

    if let Ok(mut statement) = conn.prepare(&format!(
        "SELECT status, attempt_count, last_error, created_at_ms, updated_at_ms, payload_json
         FROM {CLOUD_MCP_OUTBOX_TABLE}
         WHERE event_kind=?1
           AND status IN ('queued', 'retrying', 'in_flight', 'dead_letter', 'rejected')"
    )) {
        if let Ok(rows) = statement.query_map(
            rusqlite::params![CLOUD_MCP_AGENT_CHAT_SESSION_SYNC_EVENT],
            |row| {
                Ok((
                    row.get::<_, String>(0).unwrap_or_default(),
                    row.get::<_, i64>(1).unwrap_or(0),
                    row.get::<_, String>(2).unwrap_or_default(),
                    row.get::<_, i64>(3).unwrap_or(0).max(0) as u64,
                    row.get::<_, i64>(4).unwrap_or(0).max(0) as u64,
                    row.get::<_, String>(5).unwrap_or_default(),
                ))
            },
        ) {
            for row in rows.flatten() {
                let (status, attempt_count, last_error, created_at_ms, updated_at_ms, payload_json) =
                    row;
                let Ok(payload) = serde_json::from_str::<Value>(&payload_json) else {
                    continue;
                };
                if !workspace_agent_session_history_payload_scope_matches(
                    &payload,
                    &scope_key,
                    &device_id,
                ) {
                    continue;
                }
                let Some(key) = workspace_agent_session_history_payload_chat_sync_key(&payload) else {
                    continue;
                };
                let Some(summary) = summaries.get_mut(&key) else {
                    continue;
                };
                let total_record_count = payload
                    .get("total_record_count")
                    .and_then(Value::as_u64)
                    .unwrap_or_else(|| {
                        payload
                            .get("record_count")
                            .and_then(Value::as_u64)
                            .unwrap_or_default()
                    }) as usize;
                summary.apply_outbox_row(
                    &status,
                    attempt_count,
                    last_error,
                    created_at_ms,
                    updated_at_ms,
                    total_record_count,
                );
            }
        }
    }

    if let Ok(mut statement) = conn.prepare(&format!(
        "SELECT workspace_id, provider, session_id, record_count, acked_at_ms, failed_at_ms, updated_at_ms, last_error
         FROM {CLOUD_MCP_AGENT_CHAT_SESSION_SYNC_STATE_TABLE}
         WHERE scope_key=?1 AND device_id=?2"
    )) {
        if let Ok(rows) = statement.query_map(
            rusqlite::params![scope_key.as_str(), device_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0).unwrap_or_default(),
                    row.get::<_, String>(1).unwrap_or_default(),
                    row.get::<_, String>(2).unwrap_or_default(),
                    row.get::<_, i64>(3).unwrap_or(0).max(0) as usize,
                    row.get::<_, i64>(4).unwrap_or(0).max(0) as u64,
                    row.get::<_, i64>(5).unwrap_or(0).max(0) as u64,
                    row.get::<_, i64>(6).unwrap_or(0).max(0) as u64,
                    row.get::<_, String>(7).unwrap_or_default(),
                ))
            },
        ) {
            for row in rows.flatten() {
                let (
                    workspace_id,
                    provider,
                    session_id,
                    record_count,
                    acked_at_ms,
                    failed_at_ms,
                    updated_at_ms,
                    last_error,
                ) = row;
                let Some(key) = workspace_agent_session_history_chat_sync_key(
                    &workspace_id,
                    &provider,
                    &session_id,
                )
                else {
                    continue;
                };
                if let Some(summary) = summaries.get_mut(&key) {
                    summary.apply_session_state(
                        record_count,
                        acked_at_ms,
                        failed_at_ms,
                        updated_at_ms,
                        last_error,
                    );
                }
            }
        }
    }

    if let Ok(mut statement) = conn.prepare(&format!(
        "SELECT workspace_id, provider, session_id, COUNT(*)
         FROM {CLOUD_MCP_AGENT_CHAT_RECORD_SYNC_STATE_TABLE}
         WHERE scope_key=?1 AND device_id=?2 AND acked_at_ms>0
         GROUP BY workspace_id, provider, session_id"
    )) {
        if let Ok(rows) = statement.query_map(
            rusqlite::params![scope_key.as_str(), device_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0).unwrap_or_default(),
                    row.get::<_, String>(1).unwrap_or_default(),
                    row.get::<_, String>(2).unwrap_or_default(),
                    row.get::<_, i64>(3).unwrap_or(0).max(0) as usize,
                ))
            },
        ) {
            for row in rows.flatten() {
                let (workspace_id, provider, session_id, record_acked_count) = row;
                let Some(key) = workspace_agent_session_history_chat_sync_key(
                    &workspace_id,
                    &provider,
                    &session_id,
                )
                else {
                    continue;
                };
                if let Some(summary) = summaries.get_mut(&key) {
                    summary.apply_record_ack_count(record_acked_count);
                }
            }
        }
    }

    for item in items.iter_mut() {
        let Some(key) = workspace_agent_session_history_item_chat_sync_key(item) else {
            continue;
        };
        if let Some(summary) = summaries.remove(&key) {
            item.chat_sync = summary.into_chat_sync();
        }
    }
}

fn workspace_agent_session_history_list_blocking(
    request: WorkspaceAgentSessionHistoryListRequest,
) -> Result<WorkspaceAgentSessionHistoryListResult, String> {
    let workspace_id = workspace_threads_clean_workspace_id(&request.workspace_id)?;
    let limit = request.limit.unwrap_or(200).clamp(1, 500);
    let fast = request.fast.unwrap_or(false);
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
                fork_from_provider_session_id,
                shared_history_id,
                agent_id,
                provider,
                model_id,
                model_source,
                session_mode,
                file_authority,
                coordination_mode,
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
                AND (TRIM(provider_session_id) != '' OR TRIM(native_session_id) != '')
                AND (
                    (
                        LOWER(agent_id) NOT LIKE '%opencode%'
                        AND LOWER(provider) NOT LIKE '%opencode%'
                    )
                    OR COALESCE(NULLIF(TRIM(provider_session_id), ''), TRIM(native_session_id)) LIKE 'ses_%'
                )
            ORDER BY latest_at_ms DESC, created_at_ms DESC, id DESC",
        )
        .map_err(|error| format!("Unable to prepare workspace session history read: {error}"))?;
    let rows = statement
        .query_map(
            rusqlite::params![workspace_id.as_str()],
            |row| {
                let terminal_instance_id = row
                    .get::<_, Option<i64>>(18)?
                    .and_then(|value| u64::try_from(value).ok());
                let created_at_ms = row
                    .get::<_, i64>(25)
                    .ok()
                    .and_then(|value| u64::try_from(value).ok())
                    .unwrap_or(0);
                let latest_at_ms = row
                    .get::<_, i64>(26)
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
                    fork_from_provider_session_id: row.get(7)?,
                    shared_history_id: row.get(8)?,
                    agent_id: row.get(9)?,
                    provider: row.get(10)?,
                    model_id: row.get(11)?,
                    model_source: row.get(12)?,
                    session_mode: row.get(13)?,
                    file_authority: row.get(14)?,
                    coordination_mode: row.get(15)?,
                    thread_id: row.get(16)?,
                    pane_id: row.get(17)?,
                    terminal_instance_id,
                    terminal_index: row.get(19)?,
                    slot_key: row.get(20)?,
                    cwd: row.get(21)?,
                    status: row.get(22)?,
                    title: row.get(23)?,
                    first_user_message: String::new(),
                    chat_sync: WorkspaceAgentSessionHistoryChatSync::default(),
                    source: row.get(24)?,
                    created_at_ms,
                    latest_at_ms,
                })
            },
        )
        .map_err(|error| format!("Unable to read workspace session history rows: {error}"))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(
            row.map_err(|error| format!("Unable to read workspace session history row: {error}"))?,
        );
    }
    items.retain(workspace_agent_session_history_item_is_visible);
    items = workspace_agent_session_history_dedupe_items(items);
    items = workspace_agent_session_history_limit_with_fork_parents(items, limit);
    if !fast {
        workspace_agent_session_history_enrich_chat_sync(&mut items);
        workspace_agent_session_history_enrich_previews(&mut items);
    }
    Ok(WorkspaceAgentSessionHistoryListResult {
        generated_at_ms: workspace_threads_now_millis_u64(),
        workspace_id,
        root_directory: root_display,
        db_path: db_path_display,
        items,
    })
}

const WORKSPACE_THREADS_PERSISTED_CAMEL_KEYS: &[&str] = &[
    "activeThreadId",
    "activityStatus",
    "agentId",
    "agentKind",
    "archivedThreadOrder",
    "archivedThreads",
    "callId",
    "canonicalKind",
    "changedFiles",
    "completedAt",
    "createdAt",
    "currentAgent",
    "deviceId",
    "durationMs",
    "exitCode",
    "fileChange",
    "filePath",
    "forkFromProviderSessionId",
    "forkedFromProviderSessionId",
    "historyGroupId",
    "hookHealthObservedAtMs",
    "instanceId",
    "isTruncated",
    "lastActiveAt",
    "lastMessageAt",
    "latestTurn",
    "legacyKind",
    "messageCount",
    "modelId",
    "modelSource",
    "nativeSessionId",
    "nativeSessionKind",
    "nativeSessionSource",
    "nativeSessionUpdatedAt",
    "openMs",
    "paneId",
    "pendingPrompt",
    "perWorkspace",
    "preferredAgent",
    "projectionEvents",
    "projectionHash",
    "providerBindings",
    "providerSessionId",
    "rawPayload",
    "rawToolPayload",
    "recordCount",
    "recordId",
    "recordSeq",
    "rustTotalMs",
    "scopeKey",
    "sessionId",
    "sessionName",
    "sessionTitle",
    "sharedHistoryId",
    "splitMs",
    "startedAt",
    "subAgent",
    "terminalBinding",
    "terminalIndex",
    "terminalOrder",
    "terminalThreadIds",
    "threadId",
    "threadOrder",
    "threadsView",
    "tokenUsage",
    "toolCall",
    "toolDisplayName",
    "toolError",
    "toolInput",
    "toolName",
    "toolOutput",
    "toolServer",
    "totalMs",
    "totalRecordCount",
    "transcriptSessionId",
    "transcriptStatus",
    "updatedAt",
    "usageReport",
    "workspaceId",
];

fn workspace_threads_camel_to_snake_key(key: &str) -> String {
    let mut output = String::with_capacity(key.len() + 4);
    for character in key.chars() {
        if character.is_ascii_uppercase() {
            output.push('_');
            output.push(character.to_ascii_lowercase());
        } else {
            output.push(character);
        }
    }
    output
}

fn workspace_threads_persisted_key(key: String, to_runtime: bool) -> String {
    if to_runtime {
        if WORKSPACE_THREADS_PERSISTED_CAMEL_KEYS.contains(&key.as_str()) {
            return workspace_threads_camel_to_snake_key(&key);
        }
        return key;
    }
    WORKSPACE_THREADS_PERSISTED_CAMEL_KEYS
        .iter()
        .find(|camel| workspace_threads_camel_to_snake_key(camel) == key)
        .map(|camel| (*camel).to_string())
        .unwrap_or(key)
}

fn workspace_threads_dynamic_schema_map_key(key: &str) -> bool {
    matches!(
        key,
        "archivedThreads"
            | "archived_threads"
            | "providerBindings"
            | "provider_bindings"
            | "terminalThreadIds"
            | "terminal_thread_ids"
            | "threads"
            | "threadsView"
            | "threads_view"
    )
}

fn workspace_threads_opaque_payload_key(key: &str) -> bool {
    matches!(
        key,
        "rawPayload"
            | "raw_payload"
            | "rawToolPayload"
            | "raw_tool_payload"
            | "toolError"
            | "tool_error"
            | "toolInput"
            | "tool_input"
            | "toolOutput"
            | "tool_output"
    )
}

fn workspace_threads_tool_wrapper_key(key: &str) -> bool {
    matches!(key, "tool" | "toolCall" | "tool_call")
}

fn workspace_threads_tool_payload_child_key(key: &str) -> bool {
    matches!(
        key,
        "args"
            | "arguments"
            | "error"
            | "input"
            | "output"
            | "raw"
            | "result"
            | "stderr"
            | "toolError"
            | "tool_error"
            | "toolInput"
            | "tool_input"
            | "toolOutput"
            | "tool_output"
    )
}

fn workspace_threads_map_tool_wrapper_values(value: Value, to_runtime: bool) -> Value {
    match value {
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| workspace_threads_map_tool_wrapper_values(item, to_runtime))
                .collect(),
        ),
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(key, item)| {
                    let opaque = workspace_threads_tool_payload_child_key(&key);
                    let mapped_key = workspace_threads_persisted_key(key, to_runtime);
                    let mapped_item = if opaque {
                        item
                    } else {
                        workspace_threads_map_persisted_keys(item, to_runtime)
                    };
                    (mapped_key, mapped_item)
                })
                .collect(),
        ),
        other => other,
    }
}

fn workspace_threads_map_dynamic_schema_values(value: Value, to_runtime: bool) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(identity, item)| {
                    (
                        identity,
                        workspace_threads_map_persisted_keys(item, to_runtime),
                    )
                })
                .collect(),
        ),
        other => other,
    }
}

fn workspace_threads_map_persisted_keys(value: Value, to_runtime: bool) -> Value {
    match value {
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| workspace_threads_map_persisted_keys(item, to_runtime))
                .collect(),
        ),
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(key, item)| {
                    let dynamic = workspace_threads_dynamic_schema_map_key(&key);
                    let opaque = workspace_threads_opaque_payload_key(&key);
                    let tool_wrapper = workspace_threads_tool_wrapper_key(&key);
                    let mapped_key = workspace_threads_persisted_key(key, to_runtime);
                    let mapped_item = if opaque {
                        item
                    } else if tool_wrapper {
                        workspace_threads_map_tool_wrapper_values(item, to_runtime)
                    } else if dynamic {
                        workspace_threads_map_dynamic_schema_values(item, to_runtime)
                    } else {
                        workspace_threads_map_persisted_keys(item, to_runtime)
                    };
                    (mapped_key, mapped_item)
                })
                .collect(),
        ),
        other => other,
    }
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
        workspace_threads_collect_thread_entries(shell.remove("archived_threads"));
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
        let persisted_thread = workspace_threads_map_persisted_keys(thread, false);
        let thread_text = serde_json::to_string(&persisted_thread)
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
    let persisted_shell = workspace_threads_map_persisted_keys(shell, false);
    let shell_text = serde_json::to_string(&persisted_shell)
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
        .or_else(|| thread.get("activity_status"))
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
            .get("pane_id")
            .and_then(Value::as_str)
            .is_some_and(|pane_id| pane_id == binding.pane_id);
    let instance_matches = binding.instance_id.is_some_and(|instance_id| {
        binding_value
            .get("instance_id")
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
    if workspace_threads_terminal_binding_matches(thread.get("terminal_binding"), binding) {
        return true;
    }
    if let Some(provider_binding) = thread
        .get("provider_bindings")
        .and_then(|bindings| bindings.get(binding.agent_id.as_str()))
    {
        if workspace_threads_terminal_binding_matches(
            provider_binding.get("terminal_binding"),
            binding,
        ) {
            return true;
        }
    }
    if let Some(index) = binding.terminal_index {
        return thread
            .get("terminal_index")
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
        let Ok(thread) = serde_json::from_str::<Value>(&thread_json)
            .map(|value| workspace_threads_map_persisted_keys(value, true))
        else {
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

    let persisted_binding = serde_json::to_value(&normalized)
        .map(|value| workspace_threads_map_persisted_keys(value, false))
        .map_err(|error| format!("Unable to serialize provider session binding: {error}"))?;
    let binding_text = serde_json::to_string(&persisted_binding)
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
    connection
        .execute(
            "DELETE FROM workspace_thread_provider_session_binding
            WHERE workspace_id = ?1
                AND agent_id = ?2
                AND provider_session_id = ?3
                AND thread_id != ?4",
            rusqlite::params![workspace_id, agent_id, provider_session_id, thread_id],
        )
        .map_err(|error| format!("Unable to prune duplicate provider session bindings: {error}"))?;
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
    let workspace_id = workspace_threads_binding_text(binding, &["workspace_id"]);
    let thread_id = workspace_threads_binding_text(binding, &["thread_id"]);
    let agent_id = workspace_threads_binding_text(binding, &["agent_id"]);
    let provider_session_id = workspace_threads_binding_text(
        binding,
        &["provider_session_id", "native_session_id"],
    );
    let fork_from_provider_session_id = workspace_threads_binding_text(
        binding,
        &["fork_from_provider_session_id", "forked_from_provider_session_id"],
    );
    let shared_history_id = workspace_threads_binding_text(
        binding,
        &["shared_history_id", "history_group_id"],
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
    let session_title = workspace_threads_binding_text(binding, &["session_title"]);
    let source = workspace_threads_binding_text(binding, &["source"]);
    let provider = workspace_threads_binding_text(binding, &["provider"]);
    let model_id = workspace_threads_binding_text(binding, &["model_id"]);
    let terminal_index = binding
        .get("terminal_index")
        .and_then(Value::as_i64);

    if !state_object
        .get("thread_order")
        .and_then(Value::as_array)
        .is_some_and(|order| {
            order
                .iter()
                .any(|value| value.as_str() == Some(thread_id.as_str()))
        })
    {
        let order_value = state_object
            .entry("thread_order".to_string())
            .or_insert_with(|| json!([]));
        if let Some(order) = order_value.as_array_mut() {
            order.push(json!(thread_id.clone()));
        }
    }

    if let Some(index) = terminal_index {
        let ids_value = state_object
            .entry("terminal_thread_ids".to_string())
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
            "activity_status": "idle",
            "created_at": now,
            "current_agent": agent_id,
            "id": thread_id,
            "last_active_at": now,
            "last_message_at": "",
            "latest_turn": null,
            "materialized": true,
            "message_count": 0,
            "messages": [],
            "pending_prompt": null,
            "preferred_agent": agent_id,
            "projection_events": [],
            "provider_bindings": {},
            "session_name": if session_title.is_empty() { "Coding agent session" } else { session_title.as_str() },
            "status": "idle",
            "thread_id": thread_id,
            "title": if session_title.is_empty() { "Coding agent session" } else { session_title.as_str() },
            "updated_at": now,
            "workspace_id": workspace_id,
        })
    });
    let Some(thread) = thread_value.as_object_mut() else {
        return;
    };
    thread.insert("id".to_string(), json!(thread_id.clone()));
    thread.insert("workspace_id".to_string(), json!(workspace_id));
    thread.insert("current_agent".to_string(), json!(agent_id.clone()));
    thread.insert("preferred_agent".to_string(), json!(agent_id.clone()));
    thread.insert("materialized".to_string(), json!(true));
    thread.insert(
        "transcript_session_id".to_string(),
        json!(provider_session_id.clone()),
    );
    if !fork_from_provider_session_id.is_empty() {
        thread.insert(
            "fork_from_provider_session_id".to_string(),
            json!(fork_from_provider_session_id.clone()),
        );
    }
    if !shared_history_id.is_empty() {
        thread.insert("shared_history_id".to_string(), json!(shared_history_id.clone()));
    }
    thread.insert("transcript_status".to_string(), json!("ready"));
    thread.insert("updated_at".to_string(), json!(now.clone()));
    if let Some(index) = terminal_index {
        thread.insert("terminal_index".to_string(), json!(index));
    }
    if !session_title.is_empty() {
        thread.insert("session_name".to_string(), json!(session_title.clone()));
        thread.insert("title".to_string(), json!(session_title));
    }

    let provider_bindings_value = thread
        .entry("provider_bindings".to_string())
        .or_insert_with(|| json!({}));
    let Some(provider_bindings) = provider_bindings_value.as_object_mut() else {
        return;
    };
    let binding_value = provider_bindings
        .entry(agent_id.clone())
        .or_insert_with(|| json!({ "agent_id": agent_id.clone() }));
    let Some(binding_object) = binding_value.as_object_mut() else {
        return;
    };
    binding_object.insert("agent_id".to_string(), json!(agent_id));
    binding_object.insert(
        "native_session_id".to_string(),
        json!(provider_session_id.clone()),
    );
    binding_object.insert("native_session_kind".to_string(), json!("session"));
    binding_object.insert(
        "native_session_source".to_string(),
        json!(if source.is_empty() {
            "rust-session-binding"
        } else {
            source.as_str()
        }),
    );
    binding_object.insert("native_session_updated_at".to_string(), json!(now));
    binding_object.insert("provider_session_id".to_string(), json!(provider_session_id));
    if !fork_from_provider_session_id.is_empty() {
        binding_object.insert(
            "fork_from_provider_session_id".to_string(),
            json!(fork_from_provider_session_id),
        );
    }
    if !shared_history_id.is_empty() {
        binding_object.insert("shared_history_id".to_string(), json!(shared_history_id));
    }
    if !provider.is_empty() {
        binding_object.insert("provider".to_string(), json!(provider));
    }
    if !model_id.is_empty() {
        binding_object.insert("model_id".to_string(), json!(model_id));
        binding_object.insert("model_source".to_string(), json!("session-binding"));
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
            ORDER BY updated_at DESC, thread_id DESC",
        )
        .map_err(|error| format!("Unable to prepare provider session binding read: {error}"))?;
    let mut rows = statement
        .query(rusqlite::params![workspace_id])
        .map_err(|error| format!("Unable to read provider session binding rows: {error}"))?;

    let mut seen_provider_sessions = HashMap::<String, bool>::new();
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("Unable to read provider session binding row: {error}"))?
    {
        let binding_text = row
            .get::<_, String>(0)
            .map_err(|error| format!("Unable to read provider session binding JSON: {error}"))?;
        let Ok(binding) = serde_json::from_str::<Value>(&binding_text)
            .map(|value| workspace_threads_map_persisted_keys(value, true))
        else {
            continue;
        };
        let agent_id = workspace_threads_binding_text(&binding, &["agent_id"]);
        let provider_session_id = workspace_threads_binding_text(
            &binding,
            &["provider_session_id", "native_session_id"],
        );
        let identity = format!("{agent_id}\n{provider_session_id}");
        if agent_id.is_empty()
            || provider_session_id.is_empty()
            || seen_provider_sessions.contains_key(&identity)
        {
            continue;
        }
        seen_provider_sessions.insert(identity, true);
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

    let mut state = match serde_json::from_str::<Value>(&shell_text)
        .map(|value| workspace_threads_map_persisted_keys(value, true))
    {
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
            .map(|value| workspace_threads_map_persisted_keys(value, true))
            .unwrap_or_else(|_| Value::Object(serde_json::Map::new()));
        if bucket == "archived" {
            archived_threads.insert(safe_thread_id, thread);
        } else {
            threads.insert(safe_thread_id, thread);
        }
    }

    state.insert("threads".to_string(), Value::Object(threads));
    state.insert(
        "archived_threads".to_string(),
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
    let mut timings = Vec::new();
    let read_started = std::time::Instant::now();

    for workspace in request.workspaces {
        let workspace_started = std::time::Instant::now();
        let workspace_id = workspace_threads_clean_workspace_id(&workspace.workspace_id)?;
        let (mut connection, root, db_path) =
            workspace_threads_open_store(workspace.root_directory.as_deref(), true)?;
        let open_ms = workspace_started.elapsed().as_millis() as u64;
        let split_started = std::time::Instant::now();
        let split_state = workspace_threads_read_split_state(&connection, &workspace_id)?;
        let split_ms = split_started.elapsed().as_millis() as u64;
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
            let parsed_state = serde_json::from_str::<Value>(&state_text)
                .map(|value| workspace_threads_map_persisted_keys(value, true));
            if let Ok(Value::Object(_)) = &parsed_state {
                let mut state = parsed_state
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
                "active_thread_id": "",
                "archived_thread_order": [],
                "archived_threads": {},
                "terminal_order": [],
                "terminal_thread_ids": {},
                "terminals": {},
                "thread_order": [],
                "threads": {},
                "threads_view": {},
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
                    .get("thread_order")
                    .and_then(Value::as_array)
                    .and_then(|order| order.iter().find_map(Value::as_str))
                    .map(str::to_string)
                {
                    if let Some(object) = state.as_object_mut() {
                        object.insert("active_thread_id".to_string(), json!(first_thread_id));
                    }
                }
                found = true;
                threads.insert(workspace_id.clone(), state);
            }
        }
        timings.push(json!({
            "open_ms": open_ms,
            "split_ms": split_ms,
            "total_ms": workspace_started.elapsed().as_millis() as u64,
            "workspace_id": workspace_id.clone(),
        }));
        results.push(WorkspaceThreadsReadWorkspaceResult {
            workspace_id,
            root_directory: workspace_path_display(&root),
            db_path: workspace_path_display(&db_path),
            found,
        });
    }

    Ok(WorkspaceThreadsReadResult {
        threads: Value::Object(threads),
        timings: json!({
            "per_workspace": timings,
            "rust_total_ms": read_started.elapsed().as_millis() as u64,
        }),
        workspaces: results,
    })
}

fn workspace_threads_persist_blocking(
    request: WorkspaceThreadsPersistRequest,
) -> Result<WorkspaceThreadsPersistResult, String> {
    let mut saved = 0usize;

    for workspace in request.workspaces {
        let workspace_id = workspace_threads_clean_workspace_id(&workspace.workspace_id)?;
        let persisted_state = workspace_threads_map_persisted_keys(workspace.state.clone(), false);
        let state_text = serde_json::to_string(&persisted_state)
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
            let persisted_shell = workspace_threads_map_persisted_keys(shell, false);
            let shell_text = serde_json::to_string(&persisted_shell)
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

#[tauri::command(rename_all = "snake_case")]
async fn workspace_threads_read(
    request: WorkspaceThreadsReadRequest,
) -> Result<WorkspaceThreadsReadResult, String> {
    tauri::async_runtime::spawn_blocking(move || workspace_threads_read_blocking(request))
        .await
        .map_err(|error| format!("Workspace threads read worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn workspace_threads_persist(
    request: WorkspaceThreadsPersistRequest,
) -> Result<WorkspaceThreadsPersistResult, String> {
    tauri::async_runtime::spawn_blocking(move || workspace_threads_persist_blocking(request))
        .await
        .map_err(|error| format!("Workspace threads persist worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn workspace_threads_persist_delta(
    request: WorkspaceThreadsPersistDeltaRequest,
) -> Result<WorkspaceThreadsPersistResult, String> {
    tauri::async_runtime::spawn_blocking(move || workspace_threads_persist_delta_blocking(request))
        .await
        .map_err(|error| format!("Workspace threads delta persist worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn workspace_agent_session_history_list(
    app: AppHandle,
    request: WorkspaceAgentSessionHistoryListRequest,
) -> Result<WorkspaceAgentSessionHistoryListResult, String> {
    let fast = request.fast.unwrap_or(false);
    let result = tauri::async_runtime::spawn_blocking(move || {
        workspace_agent_session_history_list_blocking(request)
    })
    .await
    .map_err(|error| format!("Workspace session history read worker failed: {error}"))??;
    if !fast {
        agent_chat_session_sync_spawn_from_history_items(
            app,
            &result.items,
            "workspace_session_history_list",
        );
    }
    Ok(result)
}

#[cfg(test)]
mod workspace_threads_store_tests {
    use super::*;

    #[test]
    fn persisted_key_mapping_preserves_opaque_provider_payloads() {
        let runtime = json!({
            "raw_payload": {
                "filePath": "/tmp/input",
                "nestedPayload": { "toolInput": { "someValue": 1 } }
            },
            "raw_tool_payload": [{ "toolCall": { "callId": "call-1" } }],
            "tool_error": { "errorCode": "E_PROVIDER", "retryAfterMs": 250 },
            "tool_input": { "filePath": "/tmp/tool-input", "workspaceId": "vendor-workspace" },
            "tool_output": { "resultPath": "/tmp/tool-output", "nestedValue": { "rowId": 7 } },
            "tool": {
                "call_id": "call-structured",
                "input": { "filePath": "/tmp/structured-input", "workspaceId": "opaque-workspace" },
                "output": { "resultPath": "/tmp/structured-output" }
            },
            "call_id": "call-top-level",
            "thread_id": "thread-1"
        });
        let persisted = workspace_threads_map_persisted_keys(runtime.clone(), false);

        assert_eq!(
            persisted.pointer("/rawPayload/filePath").and_then(Value::as_str),
            Some("/tmp/input")
        );
        assert_eq!(
            persisted
                .pointer("/rawPayload/nestedPayload/toolInput/someValue")
                .and_then(Value::as_i64),
            Some(1)
        );
        assert_eq!(
            persisted
                .pointer("/rawToolPayload/0/toolCall/callId")
                .and_then(Value::as_str),
            Some("call-1")
        );
        assert_eq!(
            persisted
                .pointer("/toolInput/filePath")
                .and_then(Value::as_str),
            Some("/tmp/tool-input")
        );
        assert_eq!(
            persisted
                .pointer("/toolInput/workspaceId")
                .and_then(Value::as_str),
            Some("vendor-workspace")
        );
        assert_eq!(
            persisted
                .pointer("/toolOutput/nestedValue/rowId")
                .and_then(Value::as_i64),
            Some(7)
        );
        assert_eq!(
            persisted
                .pointer("/toolError/retryAfterMs")
                .and_then(Value::as_i64),
            Some(250)
        );
        assert_eq!(
            persisted.pointer("/tool/callId").and_then(Value::as_str),
            Some("call-structured")
        );
        assert_eq!(
            persisted.get("callId").and_then(Value::as_str),
            Some("call-top-level")
        );
        assert_eq!(
            persisted
                .pointer("/tool/input/filePath")
                .and_then(Value::as_str),
            Some("/tmp/structured-input")
        );
        assert_eq!(
            persisted
                .pointer("/tool/input/workspaceId")
                .and_then(Value::as_str),
            Some("opaque-workspace")
        );
        assert!(persisted.pointer("/tool/input/file_path").is_none());
        assert!(persisted.get("threadId").is_some());

        assert_eq!(
            workspace_threads_map_persisted_keys(persisted, true),
            runtime
        );
    }

    fn unique_workspace_threads_test_root(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        env::temp_dir().join(format!("diffforge-workspace-threads-{name}-{nanos}"))
    }

    fn insert_workspace_agent_session_history_test_row(
        connection: &rusqlite::Connection,
        root_display: &str,
        root_text: &str,
        id: &str,
        provider_session_id: &str,
        fork_from_provider_session_id: &str,
        created_at_ms: i64,
        latest_at_ms: i64,
        title: &str,
    ) {
        let coordination_session_id = format!("coord-{id}");
        let thread_id = format!("thread-{id}");
        let pane_id = format!("pane-{id}");
        let slot_key = format!("slot-{id}");
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
                    fork_from_provider_session_id,
                    shared_history_id,
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
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, '', ?8, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?22)",
                rusqlite::params![
                    id,
                    "workspace-session-history",
                    root_display,
                    "Session History",
                    coordination_session_id,
                    provider_session_id,
                    fork_from_provider_session_id,
                    "codex",
                    "gpt-5.5",
                    "launch",
                    thread_id,
                    pane_id,
                    42i64,
                    2i64,
                    slot_key,
                    root_text,
                    "idle",
                    title,
                    "terminal_activity_hook:provider-session",
                    created_at_ms,
                    latest_at_ms,
                    workspace_threads_now_millis(),
                ],
            )
            .expect("insert session history test row");
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
                fork_from_provider_session_id: "".to_string(),
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
                shared_history_id: "".to_string(),
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
                .pointer("/terminal_thread_ids/1")
                .and_then(Value::as_str),
            Some("thread-session-binding")
        );
        assert_eq!(
            state
                .pointer("/threads/thread-session-binding/transcript_session_id")
                .and_then(Value::as_str),
            Some("codex-session-12345678")
        );
        assert_eq!(
            state
                .pointer("/threads/thread-session-binding/provider_bindings/codex/native_session_id")
                .and_then(Value::as_str),
            Some("codex-session-12345678")
        );
        assert_eq!(
            state
                .pointer("/threads/thread-session-binding/provider_bindings/codex/model_id")
                .and_then(Value::as_str),
            Some("gpt-5.5")
        );

        let duplicate_recorded = workspace_threads_record_provider_session_binding(
            Some(root_text.as_str()),
            WorkspaceThreadProviderSessionBinding {
                agent_id: "codex".to_string(),
                cwd: root_text.clone(),
                fork_from_provider_session_id: "".to_string(),
                instance_id: Some(43),
                model_id: "gpt-5.5".to_string(),
                native_session_id: "codex-session-12345678".to_string(),
                native_session_kind: "session".to_string(),
                native_session_source: "terminal-output".to_string(),
                observed_at_ms: 2234,
                pane_id: "pane-session-binding-next".to_string(),
                provider: "codex".to_string(),
                provider_session_id: "codex-session-12345678".to_string(),
                session_title: "Codex".to_string(),
                shared_history_id: "".to_string(),
                source: "terminal-output".to_string(),
                terminal_index: Some(2),
                thread_id: "thread-session-binding-next".to_string(),
                workspace_id: "workspace-session-binding".to_string(),
            },
        )
        .expect("record duplicate provider binding");
        assert!(duplicate_recorded);
        let (connection, _, _) =
            workspace_threads_open_store(Some(root_text.as_str()), true).expect("open store");
        let binding_count: i64 = connection
            .query_row(
                "SELECT COUNT(*)
                FROM workspace_thread_provider_session_binding
                WHERE workspace_id = ?1 AND agent_id = ?2 AND provider_session_id = ?3",
                rusqlite::params![
                    "workspace-session-binding",
                    "codex",
                    "codex-session-12345678",
                ],
                |row| row.get(0),
            )
            .expect("count provider bindings");
        assert_eq!(binding_count, 1);
        let result = workspace_threads_read_blocking(WorkspaceThreadsReadRequest {
            workspaces: vec![WorkspaceThreadsReadWorkspace {
                root_directory: Some(root_text.clone()),
                workspace_id: "workspace-session-binding".to_string(),
            }],
        })
        .expect("read workspace threads after duplicate binding");
        let state = result
            .threads
            .get("workspace-session-binding")
            .expect("workspace state after duplicate binding");
        assert_eq!(
            state
                .pointer("/terminal_thread_ids/2")
                .and_then(Value::as_str),
            Some("thread-session-binding-next")
        );
        assert_eq!(
            state
                .pointer("/threads/thread-session-binding-next/transcript_session_id")
                .and_then(Value::as_str),
            Some("codex-session-12345678")
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
                fork_from_provider_session_id: "".to_string(),
                id: "session-history-1".to_string(),
                model_id: "gpt-5.5".to_string(),
                model_source: "launch".to_string(),
                session_mode: "general".to_string(),
                file_authority: "task_scoped".to_string(),
                coordination_mode: "bounded_direct_edit".to_string(),
                native_session_id: "".to_string(),
                observed_at_ms: Some(2000),
                pane_id: "pane-session-history".to_string(),
                provider: "openai".to_string(),
                provider_session_id: "".to_string(),
                shared_history_id: "".to_string(),
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
        assert!(
            !recorded,
            "terminal-only rows without provider sessions are not history"
        );

        let other_recorded = workspace_agent_session_history_upsert_blocking(
            Some(root_text.as_str()),
            WorkspaceAgentSessionHistoryRecord {
                agent_id: "claude".to_string(),
                coordination_session_id: "coord-other".to_string(),
                created_at_ms: Some(1000),
                cwd: root_text.clone(),
                fork_from_provider_session_id: "".to_string(),
                id: "session-history-other".to_string(),
                model_id: "sonnet".to_string(),
                model_source: "launch".to_string(),
                session_mode: "general".to_string(),
                file_authority: "task_scoped".to_string(),
                coordination_mode: "bounded_direct_edit".to_string(),
                native_session_id: "".to_string(),
                observed_at_ms: Some(2000),
                pane_id: "pane-other".to_string(),
                provider: "claude".to_string(),
                provider_session_id: "".to_string(),
                shared_history_id: "".to_string(),
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
        assert!(!other_recorded);

        let result = workspace_agent_session_history_list_blocking(
            WorkspaceAgentSessionHistoryListRequest {
                fast: Some(false),
                limit: Some(50),
                root_directory: Some(root_text.clone()),
                workspace_id: "workspace-session-history".to_string(),
            },
        )
        .expect("list session history");
        assert!(result.items.is_empty());

        let updated = workspace_agent_session_history_upsert_blocking(
            Some(root_text.as_str()),
            WorkspaceAgentSessionHistoryRecord {
                agent_id: "codex".to_string(),
                coordination_session_id: "coord-session-1".to_string(),
                created_at_ms: Some(1000),
                cwd: root_text.clone(),
                fork_from_provider_session_id: "".to_string(),
                id: "session-history-1".to_string(),
                model_id: "gpt-5.5".to_string(),
                model_source: "launch".to_string(),
                session_mode: "direct_edit".to_string(),
                file_authority: "bounded_direct_edit".to_string(),
                coordination_mode: "bounded_direct_edit".to_string(),
                native_session_id: "codex-native-123".to_string(),
                observed_at_ms: Some(3000),
                pane_id: "pane-session-history".to_string(),
                provider: "codex".to_string(),
                provider_session_id: "codex-provider-123".to_string(),
                shared_history_id: "".to_string(),
                slot_key: "".to_string(),
                source: "provider-session".to_string(),
                status: "idle".to_string(),
                terminal_index: Some(2),
                terminal_instance_id: Some(42),
                thread_id: "thread-session-history".to_string(),
                title: "Ada".to_string(),
                workspace_id: "workspace-session-history".to_string(),
                workspace_name: "Session History".to_string(),
            },
        )
        .expect("update session history");
        assert!(updated);

        let result = workspace_agent_session_history_list_blocking(
            WorkspaceAgentSessionHistoryListRequest {
                fast: Some(false),
                limit: Some(50),
                root_directory: Some(root_text.clone()),
                workspace_id: "workspace-session-history".to_string(),
            },
        )
        .expect("list updated session history");
        assert_eq!(result.items.len(), 1);
        let item = &result.items[0];
        assert_eq!(item.model_id, "gpt-5.5");
        assert_eq!(item.session_mode, "direct_edit");
        assert_eq!(item.file_authority, "bounded_direct_edit");
        assert_eq!(item.coordination_mode, "bounded_direct_edit");
        assert_eq!(
            item.id,
            workspace_agent_session_history_record_id(
                "workspace-session-history",
                "codex",
                "codex-provider-123"
            )
        );
        assert_eq!(item.provider_session_id, "codex-provider-123");
        assert_eq!(item.native_session_id, "codex-native-123");
        assert_eq!(item.status, "idle");
        assert_eq!(item.title, "Ada");
        assert_eq!(item.created_at_ms, 1000);
        assert_eq!(item.latest_at_ms, 3000);
        assert_eq!(item.terminal_index, Some(2));

        let duplicate_update = workspace_agent_session_history_upsert_blocking(
            Some(root_text.as_str()),
            WorkspaceAgentSessionHistoryRecord {
                agent_id: "openai".to_string(),
                coordination_session_id: "coord-session-duplicate".to_string(),
                created_at_ms: Some(500),
                cwd: root_text.clone(),
                fork_from_provider_session_id: "".to_string(),
                id: "different-history-id-for-same-provider-session".to_string(),
                model_id: "gpt-5.5".to_string(),
                model_source: "launch".to_string(),
                session_mode: "".to_string(),
                file_authority: "".to_string(),
                coordination_mode: "".to_string(),
                native_session_id: "codex-native-123".to_string(),
                observed_at_ms: Some(4000),
                pane_id: "pane-session-history-duplicate".to_string(),
                provider: "openai".to_string(),
                provider_session_id: "codex-provider-123".to_string(),
                shared_history_id: "".to_string(),
                slot_key: "slot-duplicate".to_string(),
                source: "terminal_activity_hook:provider-session".to_string(),
                status: "idle".to_string(),
                terminal_index: Some(7),
                terminal_instance_id: Some(77),
                thread_id: "thread-session-history-duplicate".to_string(),
                title: "Duplicate Ada".to_string(),
                workspace_id: "workspace-session-history".to_string(),
                workspace_name: "Session History".to_string(),
            },
        )
        .expect("dedupe same provider session history");
        assert!(duplicate_update);
        let result = workspace_agent_session_history_list_blocking(
            WorkspaceAgentSessionHistoryListRequest {
                fast: Some(false),
                limit: Some(50),
                root_directory: Some(root_text.clone()),
                workspace_id: "workspace-session-history".to_string(),
            },
        )
        .expect("list deduped session history");
        assert_eq!(result.items.len(), 1);
        let item = &result.items[0];
        assert_eq!(item.provider_session_id, "codex-provider-123");
        assert_eq!(item.created_at_ms, 500);
        assert_eq!(item.latest_at_ms, 4000);

        let invalid_opencode = workspace_agent_session_history_upsert_blocking(
            Some(root_text.as_str()),
            WorkspaceAgentSessionHistoryRecord {
                agent_id: "opencode".to_string(),
                coordination_session_id: "coord-opencode".to_string(),
                created_at_ms: Some(3000),
                cwd: root_text.clone(),
                fork_from_provider_session_id: "".to_string(),
                id: "session-history-opencode-invalid".to_string(),
                model_id: "anthropic/claude-sonnet-4-5".to_string(),
                model_source: "launch".to_string(),
                session_mode: "general".to_string(),
                file_authority: "task_scoped".to_string(),
                coordination_mode: "bounded_direct_edit".to_string(),
                native_session_id: "019f0cd7-1347-7273-b20f-e959c3772a01".to_string(),
                observed_at_ms: Some(4000),
                pane_id: "pane-opencode".to_string(),
                provider: "opencode".to_string(),
                provider_session_id: "019f0cd7-1347-7273-b20f-e959c3772a01".to_string(),
                shared_history_id: "".to_string(),
                slot_key: "slot-opencode".to_string(),
                source: "terminal-open".to_string(),
                status: "starting".to_string(),
                terminal_index: Some(4),
                terminal_instance_id: Some(44),
                thread_id: "thread-opencode".to_string(),
                title: "Mia".to_string(),
                workspace_id: "workspace-session-history".to_string(),
                workspace_name: "Session History".to_string(),
            },
        )
        .expect("reject invalid opencode session history");
        assert!(!invalid_opencode);
        let result = workspace_agent_session_history_list_blocking(
            WorkspaceAgentSessionHistoryListRequest {
                fast: Some(false),
                limit: Some(50),
                root_directory: Some(root_text.clone()),
                workspace_id: "workspace-session-history".to_string(),
            },
        )
        .expect("list after invalid opencode session history");
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].provider_session_id, "codex-provider-123");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_agent_session_history_list_dedupes_legacy_rows_by_session_id() {
        let root = unique_workspace_threads_test_root("agent-session-history-legacy-dedupe");
        fs::create_dir_all(&root).expect("create workspace root");
        let root_text = root.to_string_lossy().to_string();
        let (connection, root_path, _) =
            workspace_threads_open_store(Some(root_text.as_str()), true).expect("open store");
        let root_display = workspace_path_display(&root_path);
        for (id, created_at_ms, latest_at_ms) in [
            ("legacy-history-row-older", 1000i64, 2000i64),
            ("legacy-history-row-newer", 3000i64, 5000i64),
        ] {
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
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?21)",
                    rusqlite::params![
                        id,
                        "workspace-session-history",
                        root_display,
                        "Session History",
                        "coord-legacy",
                        "claude-session-legacy-123",
                        "claude",
                        "sonnet",
                        "launch",
                        format!("thread-{id}"),
                        format!("pane-{id}"),
                        42i64,
                        2i64,
                        "slot-legacy",
                        root_text,
                        "idle",
                        "Second Prompt - Do Nothing",
                        "terminal_activity_hook:provider-session",
                        created_at_ms,
                        latest_at_ms,
                        workspace_threads_now_millis(),
                    ],
                )
                .expect("insert legacy history row");
        }

        let result = workspace_agent_session_history_list_blocking(
            WorkspaceAgentSessionHistoryListRequest {
                fast: Some(false),
                limit: Some(50),
                root_directory: Some(root.to_string_lossy().to_string()),
                workspace_id: "workspace-session-history".to_string(),
            },
        )
        .expect("list legacy session history");
        assert_eq!(result.items.len(), 1);
        let item = &result.items[0];
        assert_eq!(item.provider_session_id, "claude-session-legacy-123");
        assert_eq!(item.created_at_ms, 1000);
        assert_eq!(item.latest_at_ms, 5000);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_agent_session_history_list_limits_after_dedupe_and_keeps_fork_parent() {
        let root = unique_workspace_threads_test_root("agent-session-history-limit-fork-parent");
        fs::create_dir_all(&root).expect("create workspace root");
        let root_text = root.to_string_lossy().to_string();
        let (connection, root_path, _) =
            workspace_threads_open_store(Some(root_text.as_str()), true).expect("open store");
        let root_display = workspace_path_display(&root_path);

        insert_workspace_agent_session_history_test_row(
            &connection,
            &root_display,
            &root_text,
            "legacy-child-row",
            "codex-child-session",
            "codex-parent-session",
            3000,
            9000,
            "Child session",
        );
        insert_workspace_agent_session_history_test_row(
            &connection,
            &root_display,
            &root_text,
            "legacy-top-row-newer",
            "codex-top-session",
            "",
            2000,
            8000,
            "Top session newer",
        );
        insert_workspace_agent_session_history_test_row(
            &connection,
            &root_display,
            &root_text,
            "legacy-top-row-older",
            "codex-top-session",
            "",
            1000,
            7000,
            "Top session older",
        );
        insert_workspace_agent_session_history_test_row(
            &connection,
            &root_display,
            &root_text,
            "legacy-parent-row",
            "codex-parent-session",
            "",
            500,
            1000,
            "Parent session",
        );

        let result = workspace_agent_session_history_list_blocking(
            WorkspaceAgentSessionHistoryListRequest {
                fast: Some(false),
                limit: Some(2),
                root_directory: Some(root.to_string_lossy().to_string()),
                workspace_id: "workspace-session-history".to_string(),
            },
        )
        .expect("list limited fork history");
        let provider_session_ids = result
            .items
            .iter()
            .map(|item| item.provider_session_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            provider_session_ids,
            vec![
                "codex-child-session",
                "codex-top-session",
                "codex-parent-session"
            ]
        );
        assert_eq!(
            result
                .items
                .iter()
                .filter(|item| item.provider_session_id == "codex-top-session")
                .count(),
            1
        );
        let top = result
            .items
            .iter()
            .find(|item| item.provider_session_id == "codex-top-session")
            .expect("top session");
        assert_eq!(top.created_at_ms, 1000);
        assert_eq!(top.latest_at_ms, 8000);
        let child = result
            .items
            .iter()
            .find(|item| item.provider_session_id == "codex-child-session")
            .expect("child session");
        assert_eq!(child.fork_from_provider_session_id, "codex-parent-session");

        let _ = fs::remove_dir_all(root);
    }
}

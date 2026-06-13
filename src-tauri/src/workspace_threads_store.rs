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
                ON workspace_thread_thread_state(workspace_id, bucket);",
        )
        .map_err(|error| format!("Unable to initialize workspace threads SQLite schema: {error}"))?;
    Ok((connection, root, db_path))
}

fn workspace_threads_collect_thread_entries(value: Option<Value>) -> Vec<(String, Value)> {
    let Some(Value::Object(entries)) = value else {
        return Vec::new();
    };

    entries
        .into_iter()
        .filter_map(|(thread_id, thread)| {
            workspace_threads_clean_thread_id(&thread_id).map(|safe_thread_id| (safe_thread_id, thread))
        })
        .collect()
}

fn workspace_threads_split_state(state: &Value) -> (Value, Vec<(String, Value)>, Vec<(String, Value)>) {
    let mut shell = match state {
        Value::Object(map) => map.clone(),
        _ => serde_json::Map::new(),
    };
    let threads = workspace_threads_collect_thread_entries(shell.remove("threads"));
    let archived_threads = workspace_threads_collect_thread_entries(shell.remove("archivedThreads"));
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
    state.insert("archivedThreads".to_string(), Value::Object(archived_threads));
    Ok(Some(Value::Object(state)))
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
        let found = split_state.is_some() || state_text.is_some();
        if let Some(state) = split_state {
            threads.insert(workspace_id.clone(), state);
        } else if let Some(state_text) = state_text {
            if let Ok(Value::Object(_)) = serde_json::from_str::<Value>(&state_text) {
                let state = serde_json::from_str::<Value>(&state_text)
                    .unwrap_or_else(|_| Value::Object(serde_json::Map::new()));
                let now = workspace_threads_now_millis();
                let root_display = workspace_path_display(&root);
                let transaction = connection
                    .transaction()
                    .map_err(|error| {
                        format!("Unable to start workspace thread migration transaction: {error}")
                    })?;
                workspace_threads_write_split_state(
                    &transaction,
                    &workspace_id,
                    &root_display,
                    &state,
                    &now,
                )?;
                transaction
                    .commit()
                    .map_err(|error| format!("Unable to commit workspace thread migration: {error}"))?;
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
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Unable to start workspace thread persist transaction: {error}"))?;
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
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Unable to start workspace thread delta transaction: {error}"))?;

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
                    rusqlite::params![workspace_id.as_str(), root_display.as_str(), shell_text, now],
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

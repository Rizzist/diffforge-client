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

fn workspace_threads_store_db_path(root: &Path) -> Result<PathBuf, String> {
    let agents_dir = root.join(".agents");
    fs::create_dir_all(&agents_dir)
        .map_err(|error| format!("Unable to create workspace .agents directory: {error}"))?;
    let _ = ensure_workspace_agents_gitignore(root);
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
        root.join(".agents").join("diffforge_threads.sqlite3")
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
                ON workspace_thread_state(workspace_root);",
        )
        .map_err(|error| format!("Unable to initialize workspace threads SQLite schema: {error}"))?;
    Ok((connection, root, db_path))
}

fn workspace_threads_read_blocking(
    request: WorkspaceThreadsReadRequest,
) -> Result<WorkspaceThreadsReadResult, String> {
    let mut threads = serde_json::Map::new();
    let mut results = Vec::new();

    for workspace in request.workspaces {
        let workspace_id = workspace_threads_clean_workspace_id(&workspace.workspace_id)?;
        let (connection, root, db_path) =
            workspace_threads_open_store(workspace.root_directory.as_deref(), true)?;
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
        let found = state_text.is_some();
        if let Some(state_text) = state_text {
            if let Ok(Value::Object(_)) = serde_json::from_str::<Value>(&state_text) {
                let state = serde_json::from_str::<Value>(&state_text)
                    .unwrap_or_else(|_| Value::Object(serde_json::Map::new()));
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
        let (connection, root, _) =
            workspace_threads_open_store(workspace.root_directory.as_deref(), true)?;
        connection
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
                    workspace_path_display(&root),
                    state_text,
                    now,
                ],
            )
            .map_err(|error| format!("Unable to persist workspace thread state: {error}"))?;
        saved += 1;
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

const LOCAL_SCRIPTS_ROOT_DIR: &str = "local-scripts";
const LOCAL_SCRIPTS_FILE_DIR: &str = "scripts";
const LOCAL_SCRIPTS_META_SUFFIX: &str = ".diffforge.json";
const LOCAL_SCRIPTS_DEFAULT_RUN_TIMEOUT_MS: u128 = 60 * 60 * 1000;
const LOCAL_SCRIPTS_MAX_RUN_TIMEOUT_MS: u128 = 6 * 60 * 60 * 1000;
const LOCAL_SCRIPTS_RUN_OUTPUT_LIMIT_BYTES: usize = 512 * 1024;
const LOCAL_SCRIPT_RUN_EVENT: &str = "diffforge://local-script-run";
const LOCAL_SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR: &str = "#1f3f7a";
const LOCAL_SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR: &str = "#4b3512";
const LOCAL_SCRIPT_DEFAULT_TEXT_COLOR: &str = "#ffffff";
const LOCAL_SCRIPT_INVENTORY_CONTRACT: &str = "diffforge.account_scripts.v1";
const LOCAL_SCRIPT_INVENTORY_KIND: &str = "script.inventory";
const LOCAL_SCRIPT_RUN_STATE_KIND: &str = "account_script_run_state";
const LOCAL_SCRIPT_RUN_QUEUE_CAPACITY: usize = 512;

struct LocalScriptRunQueueState {
    active: AtomicBool,
    cancellations: StdMutex<HashMap<String, Arc<AtomicBool>>>,
    queue: StdMutex<VecDeque<Value>>,
}

static LOCAL_SCRIPT_RUN_QUEUE: OnceLock<LocalScriptRunQueueState> = OnceLock::new();

fn local_scripts_run_queue() -> &'static LocalScriptRunQueueState {
    LOCAL_SCRIPT_RUN_QUEUE.get_or_init(|| LocalScriptRunQueueState {
        active: AtomicBool::new(false),
        cancellations: StdMutex::new(HashMap::new()),
        queue: StdMutex::new(VecDeque::new()),
    })
}

fn local_scripts_root() -> Result<PathBuf, String> {
    cloud_mcp_local_data_file_path(LOCAL_SCRIPTS_ROOT_DIR)
        .map(|path| path.join(LOCAL_SCRIPTS_FILE_DIR))
        .ok_or_else(|| "Unable to resolve local scripts directory.".to_string())
}

fn local_scripts_now_iso() -> String {
    chrono_like_now_iso()
}

fn local_scripts_text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn local_scripts_slug(value: &str, fallback: &str) -> String {
    let mut slug = String::new();
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if matches!(character, '-' | '_' | ' ' | '.') {
            if !slug.ends_with('_') && !slug.ends_with('-') && !slug.is_empty() {
                slug.push('_');
            }
        }
    }
    let trimmed = slug.trim_matches(['_', '-']).to_string();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed
    }
}

fn local_scripts_normalized_extension(value: &str, shell: &str) -> String {
    let extension = value.trim().trim_start_matches('.').to_ascii_lowercase();
    if !extension.is_empty()
        && extension.len() <= 12
        && extension
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return extension;
    }
    match shell.trim().to_ascii_lowercase().as_str() {
        "python" | "python3" | "py" => "py".to_string(),
        "node" | "javascript" | "js" => "js".to_string(),
        "bash" => "sh".to_string(),
        "powershell" | "pwsh" | "ps1" => "ps1".to_string(),
        "cmd" => "cmd".to_string(),
        "bat" => "bat".to_string(),
        _ => "sh".to_string(),
    }
}

fn local_scripts_normalized_shell(value: &str, extension: &str) -> String {
    let shell = value.trim().to_ascii_lowercase();
    match shell.as_str() {
        "bash" | "zsh" | "sh" | "python" | "python3" | "node" | "powershell" | "pwsh" | "cmd" => {
            shell
        }
        _ => match extension {
            "py" => "python3".to_string(),
            "js" | "mjs" | "cjs" => "node".to_string(),
            "bash" => "bash".to_string(),
            "zsh" => "zsh".to_string(),
            "ps1" => "powershell".to_string(),
            "bat" | "cmd" => "cmd".to_string(),
            _ => "zsh".to_string(),
        },
    }
}

fn local_scripts_rel_path_from_request(request: &Value) -> Result<String, String> {
    let mut rel = local_scripts_text(
        request
            .get("path_key")
            .or_else(|| request.get("file_path"))
            .or_else(|| request.get("path")),
    );
    let shell = local_scripts_text(request.get("shell"));
    let extension = local_scripts_normalized_extension(
        &local_scripts_text(request.get("extension").or_else(|| request.get("ext"))),
        &shell,
    );
    if rel.is_empty() {
        let title = local_scripts_text(request.get("title").or_else(|| request.get("name")));
        let file_name =
            local_scripts_text(request.get("file_name").or_else(|| request.get("fileName")));
        let name = if file_name.is_empty() {
            local_scripts_slug(&title, "script")
        } else {
            file_name
        };
        rel = if name.contains('.') {
            name
        } else {
            format!("{name}.{extension}")
        };
    }
    let rel = rel.replace('\\', "/");
    let mut parts = Vec::new();
    for part in rel.split('/') {
        let part = part.trim();
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." || part.contains('\0') {
            return Err(
                "Script path cannot traverse outside the local scripts folder.".to_string(),
            );
        }
        parts.push(part.to_string());
    }
    if parts.is_empty() {
        return Err("Script path is required.".to_string());
    }
    let last = parts.pop().unwrap_or_else(|| "script".to_string());
    let normalized_leaf = if last.contains('.') {
        last
    } else {
        format!("{last}.{extension}")
    };
    parts.push(normalized_leaf);
    Ok(parts.join("/"))
}

fn local_scripts_resolve_rel_path_from_request(request: &Value) -> Result<String, String> {
    let has_explicit_path = !local_scripts_text(
        request
            .get("path_key")
            .or_else(|| request.get("file_path"))
            .or_else(|| request.get("path")),
    )
    .is_empty();
    if has_explicit_path {
        return local_scripts_rel_path_from_request(request);
    }

    let requested_id = local_scripts_text(request.get("script_id").or_else(|| request.get("id")));
    let requested_name = local_scripts_text(
        request
            .get("script_name")
            .or_else(|| request.get("scriptName"))
            .or_else(|| request.get("name"))
            .or_else(|| request.get("title")),
    );
    if requested_id.is_empty() && requested_name.is_empty() {
        return local_scripts_rel_path_from_request(request);
    }

    let root = local_scripts_root()?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let mut files = Vec::new();
    local_scripts_collect_files(&root, &root, &mut files)?;

    let requested_id_lower = requested_id.to_ascii_lowercase();
    let requested_name_lower = requested_name.to_ascii_lowercase();
    let mut matches = Vec::new();
    for path in files {
        let Some(script) = local_scripts_value_for_path(&root, &path, false) else {
            continue;
        };
        let path_key = local_scripts_text(script.get("path_key").or_else(|| script.get("id")));
        if path_key.is_empty() {
            continue;
        }
        let script_id = local_scripts_text(script.get("script_id"));
        let title = local_scripts_text(script.get("title").or_else(|| script.get("name")));
        let file_name = local_scripts_text(script.get("file_name"));
        let file_stem = Path::new(&file_name)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_string();

        let id_matches = !requested_id.is_empty()
            && [
                script_id.as_str(),
                path_key.as_str(),
                file_name.as_str(),
                file_stem.as_str(),
            ]
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(&requested_id));
        let name_matches = !requested_name.is_empty()
            && [
                title.as_str(),
                file_name.as_str(),
                file_stem.as_str(),
                path_key.as_str(),
            ]
            .iter()
            .any(|candidate| candidate.to_ascii_lowercase() == requested_name_lower);

        if id_matches || name_matches {
            matches.push(path_key);
        }
    }
    matches.sort();
    matches.dedup();
    match matches.len() {
        1 => Ok(matches.remove(0)),
        0 => {
            let label = if !requested_id.is_empty() {
                format!("script_id {requested_id_lower}")
            } else {
                format!("script name {requested_name}")
            };
            Err(format!("No local script matched {label}."))
        }
        _ => Err(
            "Multiple local scripts matched; pass script_id for an exact run target.".to_string(),
        ),
    }
}

fn local_scripts_abs_path(rel_path: &str) -> Result<PathBuf, String> {
    let root = local_scripts_root()?;
    let mut path = root.clone();
    for part in rel_path.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains('\0') {
            return Err("Invalid local script path.".to_string());
        }
        path.push(part);
    }
    if !path.starts_with(&root) {
        return Err("Script path escaped the local scripts directory.".to_string());
    }
    Ok(path)
}

fn local_scripts_reject_symlink_components(root: &Path, path: &Path) -> Result<(), String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "Script path escaped the local scripts directory.".to_string())?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return Err("Invalid local script path.".to_string());
        };
        current.push(part);
        if let Ok(metadata) = fs::symlink_metadata(&current) {
            if metadata.file_type().is_symlink() {
                return Err("Local script paths cannot contain symlinks.".to_string());
            }
        }
    }
    Ok(())
}

fn local_scripts_meta_path(script_path: &Path) -> PathBuf {
    let file_name = script_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("script");
    script_path.with_file_name(format!("{file_name}{LOCAL_SCRIPTS_META_SUFFIX}"))
}

fn local_scripts_read_meta(script_path: &Path) -> Value {
    let meta_path = local_scripts_meta_path(script_path);
    fs::read_to_string(meta_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

fn local_scripts_truncate_output(bytes: &[u8]) -> (String, bool) {
    if bytes.len() <= LOCAL_SCRIPTS_RUN_OUTPUT_LIMIT_BYTES {
        return (String::from_utf8_lossy(bytes).to_string(), false);
    }
    let mut output =
        String::from_utf8_lossy(&bytes[..LOCAL_SCRIPTS_RUN_OUTPUT_LIMIT_BYTES]).to_string();
    output.push_str("\n\n[Diff Forge truncated script output]");
    (output, true)
}

fn local_scripts_timeout_ms_from_value(value: Option<&Value>) -> Option<u128> {
    let timeout_ms = match value {
        Some(Value::Number(number)) => number.as_u64().map(u128::from),
        Some(Value::String(raw)) => raw.trim().parse::<u128>().ok(),
        _ => None,
    }?;
    if timeout_ms == 0 {
        return None;
    }
    Some(timeout_ms.clamp(1_000, LOCAL_SCRIPTS_MAX_RUN_TIMEOUT_MS))
}

fn local_scripts_run_timeout_ms(request: &Value) -> u128 {
    local_scripts_timeout_ms_from_value(
        request
            .get("timeout_ms")
            .or_else(|| request.get("timeoutMs")),
    )
    .unwrap_or(LOCAL_SCRIPTS_DEFAULT_RUN_TIMEOUT_MS)
}

fn local_scripts_emit_run_event(app: &AppHandle, payload: Value) {
    let _ = app.emit(LOCAL_SCRIPT_RUN_EVENT, payload);
}

fn local_scripts_limited_text(value: &str) -> String {
    value.trim().chars().take(2000).collect()
}

fn local_scripts_run_state_token(value: &str) -> String {
    match value
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '-', '.'], "_")
        .as_str()
    {
        "queued" | "pending" => "queued".to_string(),
        "running" | "active" | "started" => "running".to_string(),
        "completed" | "complete" | "success" | "succeeded" | "ready" => "completed".to_string(),
        "failed" | "failure" | "error" | "timed_out" | "timeout" => "failed".to_string(),
        "cancelled" | "canceled" | "interrupted" => "cancelled".to_string(),
        _ => "idle".to_string(),
    }
}

fn local_scripts_run_cause(request: &Value) -> String {
    let value = local_scripts_text(
        request
            .get("cause")
            .or_else(|| request.get("run_cause"))
            .or_else(|| request.get("trigger_cause")),
    )
    .to_ascii_lowercase()
    .replace([' ', '-', '.'], "_");
    if value.contains("loop") {
        "loop".to_string()
    } else if value.contains("voice") {
        "orchestrator_voice".to_string()
    } else if value.contains("terminal") || value.contains("mcp") {
        "orchestrator_terminal".to_string()
    } else if value.contains("orchestrator") || value.contains("remote") {
        "orchestrator".to_string()
    } else {
        "manual".to_string()
    }
}

fn local_scripts_run_source_kind(request: &Value) -> String {
    let value = local_scripts_text(
        request
            .get("source_kind")
            .or_else(|| request.get("source"))
            .or_else(|| request.get("trigger_source")),
    )
    .to_ascii_lowercase()
    .replace([' ', '-', '.'], "_");
    if value.contains("voice") {
        "orchestrator_voice".to_string()
    } else if value.contains("terminal") || value.contains("mcp") || value.contains("app_control") {
        "orchestrator_terminal".to_string()
    } else if value.contains("loop") {
        "loop".to_string()
    } else if value.contains("cloud") || value.contains("remote") {
        "cloud_remote_command".to_string()
    } else if value.contains("global") || value.contains("button") {
        "global_button".to_string()
    } else if value.contains("tools") || value.contains("editor") {
        "tools_editor".to_string()
    } else {
        "manual".to_string()
    }
}

fn local_scripts_request_i64(request: &Value, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|key| request.get(*key))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_u64().map(|next| next.min(i64::MAX as u64) as i64))
                .or_else(|| {
                    value
                        .as_str()
                        .and_then(|text| text.trim().parse::<i64>().ok())
                })
        })
        .unwrap_or(0)
}

fn local_scripts_ensure_run_history_table(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS local_script_run_rows(
           run_id TEXT PRIMARY KEY,
           path_key TEXT NOT NULL DEFAULT '',
           script_id TEXT NOT NULL DEFAULT '',
           script_name TEXT NOT NULL DEFAULT '',
           command_id TEXT NOT NULL DEFAULT '',
           cause TEXT NOT NULL DEFAULT 'manual',
           source_kind TEXT NOT NULL DEFAULT 'manual',
           state TEXT NOT NULL DEFAULT 'idle',
           run_status TEXT NOT NULL DEFAULT '',
           queued_at TEXT NOT NULL DEFAULT '',
           queued_at_ms INTEGER NOT NULL DEFAULT 0,
           started_at TEXT NOT NULL DEFAULT '',
           started_at_ms INTEGER NOT NULL DEFAULT 0,
           ended_at TEXT NOT NULL DEFAULT '',
           ended_at_ms INTEGER NOT NULL DEFAULT 0,
           duration_ms INTEGER,
           exit_code INTEGER,
           timed_out INTEGER NOT NULL DEFAULT 0,
           error TEXT NOT NULL DEFAULT '',
           stdout TEXT NOT NULL DEFAULT '',
           stderr TEXT NOT NULL DEFAULT '',
           stdout_truncated INTEGER NOT NULL DEFAULT 0,
           stderr_truncated INTEGER NOT NULL DEFAULT 0,
           row_json TEXT NOT NULL DEFAULT '{}',
           created_at_ms INTEGER NOT NULL DEFAULT 0,
           updated_at_ms INTEGER NOT NULL DEFAULT 0
         );
         CREATE INDEX IF NOT EXISTS idx_local_script_run_rows_path
           ON local_script_run_rows(path_key, updated_at_ms);
         CREATE INDEX IF NOT EXISTS idx_local_script_run_rows_script
           ON local_script_run_rows(script_id, updated_at_ms);
         CREATE INDEX IF NOT EXISTS idx_local_script_run_rows_state
           ON local_script_run_rows(state, updated_at_ms);",
    )
    .map_err(|error| error.to_string())
}

fn local_scripts_store_run_row(row: &Value) {
    let Ok(conn) = cloud_mcp_open_outbox_conn() else {
        return;
    };
    if local_scripts_ensure_run_history_table(&conn).is_err() {
        return;
    }
    let script = row.get("script").unwrap_or(&Value::Null);
    let run_id = local_scripts_text(row.get("run_id").or_else(|| row.get("runId")));
    if run_id.is_empty() {
        return;
    }
    let path_key = local_scripts_text(row.get("path_key").or_else(|| row.get("pathKey")));
    let script_id = local_scripts_text(row.get("script_id").or_else(|| script.get("script_id")))
        .if_empty(&path_key);
    let script_name = local_scripts_text(
        row.get("script_name")
            .or_else(|| row.get("name"))
            .or_else(|| script.get("title"))
            .or_else(|| script.get("name")),
    )
    .if_empty(&script_id);
    let state =
        local_scripts_run_state_token(&local_scripts_text(row.get("state"))).if_empty("idle");
    let run_status = local_scripts_run_state_token(&local_scripts_text(
        row.get("run_status").or_else(|| row.get("status")),
    ));
    let run_status = if run_status == "idle" {
        state.clone()
    } else {
        run_status
    };
    let now_ms = cloud_mcp_now_ms() as i64;
    let queued_at = local_scripts_text(row.get("queued_at"))
        .if_empty(&local_scripts_text(row.get("started_at")));
    let queued_at_ms = local_scripts_request_i64(row, &["queued_at_ms"])
        .max(local_scripts_request_i64(row, &["started_at_ms"]));
    let mut stored = row.clone();
    if let Some(object) = stored.as_object_mut() {
        object.insert("path_key".to_string(), json!(path_key.clone()));
        object.insert("script_id".to_string(), json!(script_id.clone()));
        object.insert("script_name".to_string(), json!(script_name.clone()));
        object.insert("state".to_string(), json!(state.clone()));
        object.insert("run_status".to_string(), json!(run_status.clone()));
        object.insert("queued_at".to_string(), json!(queued_at.clone()));
        object.insert("queued_at_ms".to_string(), json!(queued_at_ms));
        object.insert("updated_at_ms".to_string(), json!(now_ms));
    }
    let _ = conn.execute(
        "INSERT INTO local_script_run_rows(
           run_id, path_key, script_id, script_name, command_id, cause, source_kind,
           state, run_status, queued_at, queued_at_ms, started_at, started_at_ms,
           ended_at, ended_at_ms, duration_ms, exit_code, timed_out, error,
           stdout, stderr, stdout_truncated, stderr_truncated, row_json,
           created_at_ms, updated_at_ms
         )
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?25)
         ON CONFLICT(run_id) DO UPDATE SET
           path_key=excluded.path_key,
           script_id=excluded.script_id,
           script_name=excluded.script_name,
           command_id=excluded.command_id,
           cause=excluded.cause,
           source_kind=excluded.source_kind,
           state=excluded.state,
           run_status=excluded.run_status,
           queued_at=CASE WHEN excluded.queued_at != '' THEN excluded.queued_at ELSE local_script_run_rows.queued_at END,
           queued_at_ms=CASE WHEN excluded.queued_at_ms > 0 THEN excluded.queued_at_ms ELSE local_script_run_rows.queued_at_ms END,
           started_at=CASE WHEN excluded.started_at != '' THEN excluded.started_at ELSE local_script_run_rows.started_at END,
           started_at_ms=CASE WHEN excluded.started_at_ms > 0 THEN excluded.started_at_ms ELSE local_script_run_rows.started_at_ms END,
           ended_at=CASE WHEN excluded.ended_at != '' THEN excluded.ended_at ELSE local_script_run_rows.ended_at END,
           ended_at_ms=CASE WHEN excluded.ended_at_ms > 0 THEN excluded.ended_at_ms ELSE local_script_run_rows.ended_at_ms END,
           duration_ms=excluded.duration_ms,
           exit_code=excluded.exit_code,
           timed_out=excluded.timed_out,
           error=excluded.error,
           stdout=CASE WHEN excluded.stdout != '' THEN excluded.stdout ELSE local_script_run_rows.stdout END,
           stderr=CASE WHEN excluded.stderr != '' THEN excluded.stderr ELSE local_script_run_rows.stderr END,
           stdout_truncated=excluded.stdout_truncated,
           stderr_truncated=excluded.stderr_truncated,
           row_json=excluded.row_json,
           updated_at_ms=excluded.updated_at_ms",
        rusqlite::params![
            run_id,
            path_key,
            script_id,
            script_name,
            local_scripts_text(row.get("command_id").or_else(|| row.get("commandId"))),
            local_scripts_run_cause(row),
            local_scripts_run_source_kind(row),
            state,
            run_status,
            queued_at,
            queued_at_ms,
            local_scripts_text(row.get("started_at")),
            local_scripts_request_i64(row, &["started_at_ms"]),
            local_scripts_text(row.get("ended_at")),
            local_scripts_request_i64(row, &["ended_at_ms"]),
            row.get("duration_ms").and_then(Value::as_i64),
            row.get("exit_code").and_then(Value::as_i64),
            if row.get("timed_out").and_then(Value::as_bool).unwrap_or(false) { 1 } else { 0 },
            local_scripts_text(row.get("error")),
            String::from(row.get("stdout").and_then(Value::as_str).unwrap_or("")),
            String::from(row.get("stderr").and_then(Value::as_str).unwrap_or("")),
            if row.get("stdout_truncated").and_then(Value::as_bool).unwrap_or(false) { 1 } else { 0 },
            if row.get("stderr_truncated").and_then(Value::as_bool).unwrap_or(false) { 1 } else { 0 },
            stored.to_string(),
            now_ms,
        ],
    );
}

fn local_scripts_read_history_rows(request: &Value) -> Result<Value, String> {
    let conn = cloud_mcp_open_outbox_conn()?;
    local_scripts_ensure_run_history_table(&conn)?;
    let limit = local_scripts_request_i64(request, &["limit"]).clamp(1, 200);
    let path_key = local_scripts_text(request.get("path_key").or_else(|| request.get("pathKey")));
    let mut rows = Vec::new();
    if path_key.is_empty() {
        let mut statement = conn
            .prepare(
                "SELECT row_json FROM local_script_run_rows
                 ORDER BY updated_at_ms DESC, queued_at_ms DESC
                 LIMIT ?1",
            )
            .map_err(|error| error.to_string())?;
        let mapped = statement
            .query_map(rusqlite::params![limit], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        for item in mapped {
            if let Ok(value) = item {
                if let Ok(json) = serde_json::from_str::<Value>(&value) {
                    rows.push(json);
                }
            }
        }
    } else {
        let mut statement = conn
            .prepare(
                "SELECT row_json FROM local_script_run_rows
                 WHERE path_key=?1
                 ORDER BY updated_at_ms DESC, queued_at_ms DESC
                 LIMIT ?2",
            )
            .map_err(|error| error.to_string())?;
        let mapped = statement
            .query_map(rusqlite::params![path_key, limit], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| error.to_string())?;
        for item in mapped {
            if let Ok(value) = item {
                if let Ok(json) = serde_json::from_str::<Value>(&value) {
                    rows.push(json);
                }
            }
        }
    }
    Ok(json!({
        "kind": "local_script_run_history",
        "runs": rows,
    }))
}

fn local_scripts_run_state_payload(
    request: &Value,
    script: &Value,
    rel_path: &str,
    run_id: &str,
    state: &str,
    run_status: &str,
    started_at: &str,
    started_at_ms: u64,
    ended_at: Option<&str>,
    ended_at_ms: Option<u64>,
    duration_ms: Option<u64>,
    exit_code: Option<i32>,
    timed_out: bool,
    error: &str,
) -> Value {
    let device_profile = cloud_mcp_desktop_device_profile();
    let script_id = local_scripts_text(script.get("script_id"));
    let script_name =
        local_scripts_text(script.get("title").or_else(|| script.get("name"))).if_empty(&script_id);
    let queued_at = local_scripts_text(request.get("queued_at")).if_empty(started_at);
    let queued_at_ms =
        local_scripts_request_i64(request, &["queued_at_ms"]).max(started_at_ms as i64);
    json!({
        "account_scoped": true,
        "cause": local_scripts_run_cause(request),
        "command_id": local_scripts_text(
            request
                .get("command_id")
                .or_else(|| request.get("commandId")),
        ),
        "contract": LOCAL_SCRIPT_INVENTORY_CONTRACT,
        "device_id": device_profile.get("device_id").cloned().unwrap_or(Value::Null),
        "duration_ms": duration_ms,
        "ended_at": ended_at.unwrap_or(""),
        "ended_at_ms": ended_at_ms,
        "error": local_scripts_limited_text(error),
        "event_kind": LOCAL_SCRIPT_RUN_STATE_KIND,
        "exit_code": exit_code,
        "kind": LOCAL_SCRIPT_RUN_STATE_KIND,
        "ok": run_status == "completed",
        "owner_device_id": device_profile.get("device_id").cloned().unwrap_or(Value::Null),
        "path_key": rel_path,
        "queued_at": queued_at,
        "queued_at_ms": queued_at_ms,
        "queue_position": local_scripts_request_i64(request, &["queue_position"]),
        "request_id": local_scripts_text(request.get("request_id").or_else(|| request.get("requestId"))),
        "run_id": run_id,
        "run_status": run_status,
        "script_id": script_id,
        "script_name": script_name,
        "source": "rust-diffforge-local-scripts",
        "source_kind": local_scripts_run_source_kind(request),
        "started_at": started_at,
        "started_at_ms": started_at_ms,
        "state": state,
        "terminal_id": local_scripts_text(request.get("terminal_id").or_else(|| request.get("terminalId"))),
        "timed_out": timed_out,
        "loopspace_id": local_scripts_text(request.get("loopspace_id").or_else(|| request.get("loopspaceId"))),
        "loop_runtime_edge_id": local_scripts_text(request.get("loop_runtime_edge_id").or_else(|| request.get("loopRuntimeEdgeId"))),
        "loop_runtime_node_id": local_scripts_text(request.get("loop_runtime_node_id").or_else(|| request.get("loopRuntimeNodeId"))),
        "loop_runtime_run_id": local_scripts_text(request.get("loop_runtime_run_id").or_else(|| request.get("loopRuntimeRunId"))).if_empty(run_id),
        "trigger_id": local_scripts_text(request.get("trigger_id").or_else(|| request.get("triggerId"))),
        "trigger_run_id": local_scripts_text(request.get("trigger_run_id").or_else(|| request.get("triggerRunId"))),
        "updated_at": local_scripts_now_iso(),
        "voice_session_id": local_scripts_text(request.get("voice_session_id").or_else(|| request.get("voiceSessionId"))),
        "workspace_id": local_scripts_text(request.get("workspace_id").or_else(|| request.get("workspaceId"))),
    })
}

fn local_scripts_spawn_run_state_sync(cloud_state: Option<CloudMcpState>, payload: Value) {
    let Some(state) = cloud_state else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        if let Err(error) =
            cloud_mcp_post_event_endpoint(&state, LOCAL_SCRIPT_RUN_STATE_KIND, &payload).await
        {
            log_cloud_sync_event(
                "local_scripts.run_state_sync_failed",
                json!({
                    "error": clean_terminal_telemetry_text(&error),
                    "run_id": local_scripts_text(payload.get("run_id")),
                    "script_id": local_scripts_text(payload.get("script_id")),
                    "state": local_scripts_text(payload.get("state")),
                }),
            );
        }
    });
}

fn local_scripts_append_limited_output(target: &Arc<StdMutex<Vec<u8>>>, chunk: &[u8]) {
    if chunk.is_empty() {
        return;
    }
    if let Ok(mut output) = target.lock() {
        if output.len() >= LOCAL_SCRIPTS_RUN_OUTPUT_LIMIT_BYTES {
            return;
        }
        let remaining = LOCAL_SCRIPTS_RUN_OUTPUT_LIMIT_BYTES - output.len();
        output.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
    }
}

fn local_scripts_output_bytes(target: &Arc<StdMutex<Vec<u8>>>) -> Vec<u8> {
    target
        .lock()
        .map(|output| output.clone())
        .unwrap_or_default()
}

fn local_scripts_spawn_output_reader(
    app: AppHandle,
    run_id: String,
    rel_path: String,
    stream: &'static str,
    reader: impl Read + Send + 'static,
    output: Arc<StdMutex<Vec<u8>>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut reader = std::io::BufReader::new(reader);
        loop {
            let mut chunk = Vec::new();
            match std::io::BufRead::read_until(&mut reader, b'\n', &mut chunk) {
                Ok(0) => break,
                Ok(_) => {
                    local_scripts_append_limited_output(&output, &chunk);
                    local_scripts_emit_run_event(
                        &app,
                        json!({
                            "chunk": String::from_utf8_lossy(&chunk).to_string(),
                            "kind": "local_script_run",
                            "path_key": rel_path,
                            "run_id": run_id,
                            "stage": "output",
                            "stream": stream,
                        }),
                    );
                }
                Err(error) => {
                    local_scripts_emit_run_event(
                        &app,
                        json!({
                            "chunk": format!("[Diff Forge could not read {stream}: {error}]\n"),
                            "kind": "local_script_run",
                            "path_key": rel_path,
                            "run_id": run_id,
                            "stage": "output",
                            "stream": "stderr",
                        }),
                    );
                    break;
                }
            }
        }
    })
}

fn local_scripts_write_meta(script_path: &Path, meta: &Value) -> Result<(), String> {
    let meta_path = local_scripts_meta_path(script_path);
    if let Some(parent) = meta_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let data = serde_json::to_vec_pretty(meta).map_err(|error| error.to_string())?;
    fs::write(meta_path, data).map_err(|error| error.to_string())
}

fn local_scripts_rel_from_abs(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| {
            relative
                .components()
                .filter_map(|component| match component {
                    Component::Normal(value) => Some(value.to_string_lossy().to_string()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("/")
        })
        .filter(|value| !value.is_empty())
}

fn local_scripts_title_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("script")
        .replace(['_', '-'], " ")
}

fn local_scripts_fallback_script_id(rel_path: &str) -> String {
    let digest = format!("{:x}", Sha256::digest(rel_path.as_bytes()));
    let suffix_len = digest.len().min(24);
    format!("script-{}", &digest[..suffix_len])
}

fn local_scripts_script_id_for_meta(rel_path: &str, meta: &Value) -> String {
    local_scripts_text(meta.get("script_id"))
        .if_empty(&local_scripts_text(meta.get("id")))
        .if_empty(&local_scripts_fallback_script_id(rel_path))
}

fn local_scripts_value_for_path(root: &Path, path: &Path, include_content: bool) -> Option<Value> {
    let rel_path = local_scripts_rel_from_abs(root, path)?;
    if rel_path.ends_with(LOCAL_SCRIPTS_META_SUFFIX) {
        return None;
    }
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let meta = local_scripts_read_meta(path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("sh")
        .to_ascii_lowercase();
    let shell = local_scripts_normalized_shell(
        meta.get("shell").and_then(Value::as_str).unwrap_or(""),
        &extension,
    );
    let title = local_scripts_text(meta.get("title").or_else(|| meta.get("name")));
    let content = if include_content {
        fs::read_to_string(path).unwrap_or_default()
    } else {
        String::new()
    };
    let script_id = local_scripts_script_id_for_meta(&rel_path, &meta);
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_default();
    let content_hash = if include_content {
        format!("{:x}", Sha256::digest(content.as_bytes()))
    } else {
        String::new()
    };
    Some(json!({
        "content": if include_content { content } else { String::new() },
        "content_hash": content_hash,
        "created_at": local_scripts_text(meta.get("created_at")),
        "extension": extension,
        "file_name": path.file_name().and_then(|value| value.to_str()).unwrap_or("script.sh"),
        "id": rel_path,
        "local_path": path.to_string_lossy(),
        "loopspace_button_color": local_scripts_text(meta.get("loopspace_button_color")).if_empty(LOCAL_SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR),
        "loopspace_text_color": local_scripts_text(meta.get("loopspace_text_color")).if_empty(LOCAL_SCRIPT_DEFAULT_TEXT_COLOR),
        "modified_at": modified_at,
        "path_key": rel_path,
        "script_id": script_id,
        "shell": shell,
        "size_bytes": metadata.len(),
        "title": if title.is_empty() { local_scripts_title_from_path(path) } else { title },
        "updated_at": local_scripts_text(meta.get("updated_at")),
        "workspace_button_color": local_scripts_text(meta.get("workspace_button_color")).if_empty(LOCAL_SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR),
        "workspace_text_color": local_scripts_text(meta.get("workspace_text_color")).if_empty(LOCAL_SCRIPT_DEFAULT_TEXT_COLOR),
        "working_directory": local_scripts_text(meta.get("working_directory")),
    }))
}

trait LocalScriptsEmptyDefault {
    fn if_empty(self, fallback: &str) -> String;
}

impl LocalScriptsEmptyDefault for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

fn local_scripts_collect_files(
    root: &Path,
    dir: &Path,
    output: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let mut entries = fs::read_dir(dir)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| a.to_string_lossy().cmp(&b.to_string_lossy()));
    for path in entries {
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .starts_with('.')
        {
            continue;
        }
        if metadata.is_dir() {
            local_scripts_collect_files(root, &path, output)?;
            continue;
        }
        if path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .ends_with(LOCAL_SCRIPTS_META_SUFFIX)
        {
            continue;
        }
        if path.starts_with(root) {
            output.push(path);
        }
    }
    Ok(())
}

fn local_scripts_inventory_payload(reason: &str) -> Result<Value, String> {
    let root = local_scripts_root()?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let mut files = Vec::new();
    local_scripts_collect_files(&root, &root, &mut files)?;
    let mut scripts = files
        .iter()
        .filter_map(|path| local_scripts_value_for_path(&root, path, false))
        .filter_map(|script| {
            let script_id = local_scripts_text(script.get("script_id"));
            if script_id.is_empty() {
                return None;
            }
            let name = local_scripts_text(script.get("title")).if_empty(&script_id);
            Some(json!({
                "name": name,
                "script_id": script_id,
            }))
        })
        .collect::<Vec<_>>();
    scripts.sort_by(|left, right| {
        let left_name = local_scripts_text(left.get("name"));
        let right_name = local_scripts_text(right.get("name"));
        left_name.cmp(&right_name).then_with(|| {
            local_scripts_text(left.get("script_id"))
                .cmp(&local_scripts_text(right.get("script_id")))
        })
    });
    scripts.dedup_by(|left, right| {
        local_scripts_text(left.get("script_id")) == local_scripts_text(right.get("script_id"))
    });
    let scripts_json = serde_json::to_vec(&scripts).unwrap_or_default();
    let inventory_hash = format!("{:x}", Sha256::digest(&scripts_json));
    let device_profile = cloud_mcp_desktop_device_profile();
    let device_id = cloud_mcp_payload_text(&device_profile, &["device_id"]).unwrap_or_default();
    Ok(json!({
        "account_scoped": true,
        "authoritative": true,
        "contract": LOCAL_SCRIPT_INVENTORY_CONTRACT,
        "device_id": device_id,
        "event_kind": LOCAL_SCRIPT_INVENTORY_KIND,
        "inventory_hash": inventory_hash,
        "inventory_seq": cloud_mcp_now_ms(),
        "kind": LOCAL_SCRIPT_INVENTORY_KIND,
        "owner_device_id": device_profile.get("device_id").cloned().unwrap_or(Value::Null),
        "reason": reason,
        "script_count": scripts.len(),
        "scripts": scripts,
        "source": "rust-diffforge-local-scripts",
        "updated_at": local_scripts_now_iso(),
    }))
}

async fn cloud_mcp_sync_local_scripts_inventory_now(
    state: &CloudMcpState,
    reason: &str,
) -> Result<Value, String> {
    let reason_owned = reason.to_string();
    let payload = tauri::async_runtime::spawn_blocking(move || {
        local_scripts_inventory_payload(&reason_owned)
    })
    .await
    .map_err(|error| error.to_string())??;
    cloud_mcp_post_event_endpoint(state, LOCAL_SCRIPT_INVENTORY_KIND, &payload).await
}

fn cloud_mcp_spawn_local_scripts_inventory_sync(state: &CloudMcpState, reason: &'static str) {
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = cloud_mcp_sync_local_scripts_inventory_now(&state, reason).await {
            log_cloud_sync_event(
                "local_scripts.inventory_sync_failed",
                json!({
                    "error": clean_terminal_telemetry_text(&error),
                    "reason": reason,
                }),
            );
        }
    });
}

#[tauri::command]
async fn local_scripts_list(request: Option<Value>) -> Result<Value, String> {
    let request = request.unwrap_or_else(|| json!({}));
    let include_content = request
        .get("include_content")
        .or_else(|| request.get("includeContent"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let root = local_scripts_root()?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let mut files = Vec::new();
    local_scripts_collect_files(&root, &root, &mut files)?;
    let scripts = files
        .iter()
        .filter_map(|path| local_scripts_value_for_path(&root, path, include_content))
        .collect::<Vec<_>>();
    Ok(json!({
        "kind": "local_scripts",
        "root": root.to_string_lossy(),
        "scripts": scripts,
    }))
}

#[tauri::command]
async fn local_scripts_read(request: Value) -> Result<Value, String> {
    let rel_path = local_scripts_resolve_rel_path_from_request(&request)?;
    let root = local_scripts_root()?;
    let path = local_scripts_abs_path(&rel_path)?;
    local_scripts_reject_symlink_components(&root, &path)?;
    let script = local_scripts_value_for_path(&root, &path, true)
        .ok_or_else(|| "Local script was not found.".to_string())?;
    Ok(json!({
        "kind": "local_script",
        "script": script,
    }))
}

#[tauri::command]
async fn local_scripts_save(
    state: State<'_, CloudMcpState>,
    request: Value,
) -> Result<Value, String> {
    let rel_path = local_scripts_rel_path_from_request(&request)?;
    let root = local_scripts_root()?;
    let path = local_scripts_abs_path(&rel_path)?;
    local_scripts_reject_symlink_components(&root, &path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let now = local_scripts_now_iso();
    let content = String::from(
        request
            .get("content")
            .or_else(|| request.get("content_md"))
            .and_then(Value::as_str)
            .unwrap_or(""),
    );
    fs::write(&path, content.as_bytes()).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&path)
            .map_err(|error| error.to_string())?
            .permissions();
        permissions.set_mode(0o755);
        let _ = fs::set_permissions(&path, permissions);
    }
    let existing_meta = local_scripts_read_meta(&path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("sh")
        .to_ascii_lowercase();
    let shell = local_scripts_normalized_shell(
        &local_scripts_text(request.get("shell")).if_empty(
            existing_meta
                .get("shell")
                .and_then(Value::as_str)
                .unwrap_or(""),
        ),
        &extension,
    );
    let title = local_scripts_text(request.get("title").or_else(|| request.get("name"))).if_empty(
        &local_scripts_text(existing_meta.get("title"))
            .if_empty(&local_scripts_title_from_path(&path)),
    );
    let created_at = local_scripts_text(existing_meta.get("created_at")).if_empty(&now);
    let script_id = local_scripts_text(request.get("script_id"))
        .if_empty(&local_scripts_text(existing_meta.get("script_id")))
        .if_empty(&local_scripts_fallback_script_id(&rel_path));
    let meta = json!({
        "created_at": created_at,
        "loopspace_button_color": local_scripts_text(request.get("loopspace_button_color")).if_empty(&local_scripts_text(existing_meta.get("loopspace_button_color")).if_empty(LOCAL_SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR)),
        "loopspace_text_color": local_scripts_text(request.get("loopspace_text_color")).if_empty(&local_scripts_text(existing_meta.get("loopspace_text_color")).if_empty(LOCAL_SCRIPT_DEFAULT_TEXT_COLOR)),
        "script_id": script_id,
        "shell": shell,
        "title": title,
        "updated_at": now,
        "workspace_button_color": local_scripts_text(request.get("workspace_button_color")).if_empty(&local_scripts_text(existing_meta.get("workspace_button_color")).if_empty(LOCAL_SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR)),
        "workspace_text_color": local_scripts_text(request.get("workspace_text_color")).if_empty(&local_scripts_text(existing_meta.get("workspace_text_color")).if_empty(LOCAL_SCRIPT_DEFAULT_TEXT_COLOR)),
        "working_directory": local_scripts_text(request.get("working_directory")).if_empty(&local_scripts_text(existing_meta.get("working_directory"))),
    });
    local_scripts_write_meta(&path, &meta)?;
    let script = local_scripts_value_for_path(&root, &path, true)
        .ok_or_else(|| "Local script was saved but could not be read back.".to_string())?;
    let cloud_sync =
        cloud_mcp_sync_local_scripts_inventory_now(state.inner(), "local_scripts_save")
            .await
            .unwrap_or_else(|error| {
                json!({
                    "error": clean_terminal_telemetry_text(&error),
                    "ok": false,
                    "queued": false,
                })
            });
    Ok(json!({
        "cloud_sync": cloud_sync,
        "kind": "local_script_saved",
        "script": script,
    }))
}

#[tauri::command]
async fn local_scripts_delete(
    state: State<'_, CloudMcpState>,
    request: Value,
) -> Result<Value, String> {
    let rel_path = local_scripts_rel_path_from_request(&request)?;
    let root = local_scripts_root()?;
    let path = local_scripts_abs_path(&rel_path)?;
    local_scripts_reject_symlink_components(&root, &path)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    let meta_path = local_scripts_meta_path(&path);
    if meta_path.exists() {
        let _ = fs::remove_file(meta_path);
    }
    let cloud_sync =
        cloud_mcp_sync_local_scripts_inventory_now(state.inner(), "local_scripts_delete")
            .await
            .unwrap_or_else(|error| {
                json!({
                    "error": clean_terminal_telemetry_text(&error),
                    "ok": false,
                    "queued": false,
                })
            });
    Ok(json!({
        "cloud_sync": cloud_sync,
        "kind": "local_script_deleted",
        "path_key": rel_path,
    }))
}

#[tauri::command]
async fn local_scripts_run(app: AppHandle, request: Value) -> Result<Value, String> {
    local_scripts_enqueue_run(app, request).await
}

#[tauri::command]
async fn local_scripts_cancel_run(app: AppHandle, request: Value) -> Result<Value, String> {
    let request = if request.is_object() {
        request
    } else {
        json!({})
    };
    let requested_run_id =
        local_scripts_text(request.get("run_id").or_else(|| request.get("runId")));
    let mut requested_path_key = local_scripts_text(
        request
            .get("path_key")
            .or_else(|| request.get("pathKey"))
            .or_else(|| request.get("file_path"))
            .or_else(|| request.get("path")),
    );
    if requested_path_key.is_empty() {
        requested_path_key =
            local_scripts_resolve_rel_path_from_request(&request).unwrap_or_default();
    }
    if requested_run_id.is_empty() && requested_path_key.is_empty() {
        return Err("Pass run_id or path_key to cancel a local script run.".to_string());
    }

    let queued_run = {
        let queue = local_scripts_run_queue();
        let mut locked = queue
            .queue
            .lock()
            .map_err(|_| "Local script queue is unavailable.".to_string())?;
        let index = locked.iter().position(|candidate| {
            let candidate_run_id =
                local_scripts_text(candidate.get("run_id").or_else(|| candidate.get("runId")));
            let candidate_path_key = local_scripts_text(
                candidate
                    .get("path_key")
                    .or_else(|| candidate.get("pathKey"))
                    .or_else(|| candidate.get("file_path"))
                    .or_else(|| candidate.get("path")),
            );
            (!requested_run_id.is_empty() && candidate_run_id == requested_run_id)
                || (!requested_path_key.is_empty() && candidate_path_key == requested_path_key)
        });
        index.and_then(|position| locked.remove(position))
    };
    if let Some(queued_request) = queued_run {
        return Ok(local_scripts_cancel_queued_run(app, queued_request));
    }

    if !requested_run_id.is_empty() {
        let queue = local_scripts_run_queue();
        if let Some(flag) = queue
            .cancellations
            .lock()
            .map_err(|_| "Local script cancellation registry is unavailable.".to_string())?
            .get(&requested_run_id)
            .cloned()
        {
            flag.store(true, Ordering::SeqCst);
            return Ok(json!({
                "accepted": true,
                "kind": "local_script_run_cancelled",
                "ok": true,
                "path_key": requested_path_key,
                "run_id": requested_run_id,
                "state": "cancelling",
            }));
        }
    }

    Err("No matching queued or running local script run was found.".to_string())
}

#[tauri::command]
async fn local_scripts_run_history(request: Option<Value>) -> Result<Value, String> {
    let request = request.unwrap_or_else(|| json!({}));
    tauri::async_runtime::spawn_blocking(move || local_scripts_read_history_rows(&request))
        .await
        .map_err(|error| error.to_string())?
}

fn local_scripts_prepare_run_request(
    mut request: Value,
) -> Result<(Value, String, String, Value), String> {
    if !request.is_object() {
        request = json!({});
    }
    let rel_path = local_scripts_resolve_rel_path_from_request(&request)?;
    let root = local_scripts_root()?;
    let path = local_scripts_abs_path(&rel_path)?;
    local_scripts_reject_symlink_components(&root, &path)?;
    if !path.exists() {
        return Err("Local script was not found.".to_string());
    }
    let script = local_scripts_value_for_path(&root, &path, false)
        .ok_or_else(|| "Local script was not found.".to_string())?;
    let run_id = local_scripts_text(request.get("run_id").or_else(|| request.get("runId")))
        .if_empty(&format!("script-run-{}", uuid::Uuid::new_v4()));
    if let Some(object) = request.as_object_mut() {
        object.insert("path_key".to_string(), json!(rel_path.clone()));
        object.insert("run_id".to_string(), json!(run_id.clone()));
    }
    Ok((request, rel_path, run_id, script))
}

async fn local_scripts_enqueue_run(app: AppHandle, request: Value) -> Result<Value, String> {
    let cloud_state = Some(app.state::<CloudMcpState>().inner().clone());
    let (mut request, rel_path, run_id, script) = local_scripts_prepare_run_request(request)?;
    let queued_at = local_scripts_now_iso();
    let queued_at_ms = cloud_mcp_now_ms();
    let cause = local_scripts_run_cause(&request);
    let source_kind = local_scripts_run_source_kind(&request);
    let queue = local_scripts_run_queue();
    let queue_position = {
        let mut locked = queue
            .queue
            .lock()
            .map_err(|_| "Local script queue is unavailable.".to_string())?;
        if locked.len() >= LOCAL_SCRIPT_RUN_QUEUE_CAPACITY {
            return Err(
                "Local script queue is full. Wait for a script to finish, then try again."
                    .to_string(),
            );
        }
        let position = locked.len() as i64
            + if queue.active.load(Ordering::SeqCst) {
                1
            } else {
                0
            };
        if let Some(object) = request.as_object_mut() {
            object.insert("cause".to_string(), json!(cause.clone()));
            object.insert("queued_at".to_string(), json!(queued_at.clone()));
            object.insert("queued_at_ms".to_string(), json!(queued_at_ms));
            object.insert("queue_position".to_string(), json!(position));
            object.insert("source_kind".to_string(), json!(source_kind.clone()));
        }
        locked.push_back(request.clone());
        position
    };
    let payload = local_scripts_run_state_payload(
        &request, &script, &rel_path, &run_id, "queued", "queued", "", 0, None, None, None, None,
        false, "",
    );
    local_scripts_store_run_row(&payload);
    local_scripts_emit_run_event(
        &app,
        json!({
            "cause": cause,
            "kind": "local_script_run",
            "loop_runtime_edge_id": local_scripts_text(request.get("loop_runtime_edge_id").or_else(|| request.get("loopRuntimeEdgeId"))),
            "loop_runtime_node_id": local_scripts_text(request.get("loop_runtime_node_id").or_else(|| request.get("loopRuntimeNodeId"))),
            "loop_runtime_run_id": local_scripts_text(request.get("loop_runtime_run_id").or_else(|| request.get("loopRuntimeRunId"))).if_empty(&run_id),
            "loopspace_id": local_scripts_text(request.get("loopspace_id").or_else(|| request.get("loopspaceId"))),
            "path_key": rel_path.clone(),
            "queued_at": queued_at,
            "queued_at_ms": queued_at_ms,
            "queue_position": queue_position,
            "run_id": run_id.clone(),
            "script": script.clone(),
            "source_kind": source_kind,
            "stage": "queued",
            "state": "queued",
            "trigger_id": local_scripts_text(request.get("trigger_id").or_else(|| request.get("triggerId"))),
            "trigger_run_id": local_scripts_text(request.get("trigger_run_id").or_else(|| request.get("triggerRunId"))),
        }),
    );
    local_scripts_spawn_run_state_sync(cloud_state, payload);
    local_scripts_ensure_queue_worker(app.clone());
    Ok(json!({
        "accepted": true,
        "kind": "local_script_run",
        "ok": true,
        "path_key": rel_path,
        "queued": true,
        "queued_at": queued_at,
        "queued_at_ms": queued_at_ms,
        "queue_position": queue_position,
        "run_id": run_id,
        "script": script,
        "state": "queued",
    }))
}

fn local_scripts_ensure_queue_worker(app: AppHandle) {
    let queue = local_scripts_run_queue();
    if queue.active.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            let next = {
                let Ok(mut locked) = local_scripts_run_queue().queue.lock() else {
                    break;
                };
                locked.pop_front()
            };
            let Some(run_request) = next else {
                local_scripts_run_queue()
                    .active
                    .store(false, Ordering::SeqCst);
                let has_more = local_scripts_run_queue()
                    .queue
                    .lock()
                    .map(|locked| !locked.is_empty())
                    .unwrap_or(false);
                if has_more
                    && !local_scripts_run_queue()
                        .active
                        .swap(true, Ordering::SeqCst)
                {
                    continue;
                }
                break;
            };
            if let Err(error) = local_scripts_prepare_run_request(run_request.clone()) {
                local_scripts_fail_queued_run(app.clone(), run_request, error);
                continue;
            }
            let _ = local_scripts_run_request(app.clone(), run_request).await;
        }
    });
}

fn local_scripts_fail_queued_run(app: AppHandle, request: Value, error: String) {
    let cloud_state = Some(app.state::<CloudMcpState>().inner().clone());
    let rel_path = local_scripts_text(
        request
            .get("path_key")
            .or_else(|| request.get("pathKey"))
            .or_else(|| request.get("file_path"))
            .or_else(|| request.get("path")),
    )
    .if_empty("unknown");
    let run_id = local_scripts_text(request.get("run_id").or_else(|| request.get("runId")))
        .if_empty(&format!("script-run-{}", uuid::Uuid::new_v4()));
    let script_id = local_scripts_text(request.get("script_id").or_else(|| request.get("id")))
        .if_empty(&rel_path);
    let script_name = local_scripts_text(
        request
            .get("script_name")
            .or_else(|| request.get("scriptName"))
            .or_else(|| request.get("name"))
            .or_else(|| request.get("title")),
    )
    .if_empty(&script_id);
    let script = json!({
        "path_key": rel_path.clone(),
        "script_id": script_id.clone(),
        "title": script_name,
    });
    let ended_at_iso = local_scripts_now_iso();
    let failed_payload = local_scripts_run_state_payload(
        &request,
        &script,
        &rel_path,
        &run_id,
        "failed",
        "failed",
        "",
        0,
        Some(&ended_at_iso),
        Some(cloud_mcp_now_ms()),
        Some(0),
        None,
        false,
        &error,
    );
    local_scripts_store_run_row(&failed_payload);
    local_scripts_emit_run_event(
        &app,
        json!({
            "cause": local_scripts_run_cause(&request),
            "duration_ms": 0,
            "ended_at": ended_at_iso,
            "error": error,
            "exit_code": Value::Null,
            "kind": "local_script_run",
            "loop_runtime_edge_id": local_scripts_text(request.get("loop_runtime_edge_id").or_else(|| request.get("loopRuntimeEdgeId"))),
            "loop_runtime_node_id": local_scripts_text(request.get("loop_runtime_node_id").or_else(|| request.get("loopRuntimeNodeId"))),
            "loop_runtime_run_id": local_scripts_text(request.get("loop_runtime_run_id").or_else(|| request.get("loopRuntimeRunId"))).if_empty(&run_id),
            "loopspace_id": local_scripts_text(request.get("loopspace_id").or_else(|| request.get("loopspaceId"))),
            "ok": false,
            "path_key": rel_path,
            "run_id": run_id,
            "script": script,
            "source_kind": local_scripts_run_source_kind(&request),
            "stage": "finish",
            "state": "failed",
            "stderr": "",
            "stdout": "",
            "timed_out": false,
            "trigger_id": local_scripts_text(request.get("trigger_id").or_else(|| request.get("triggerId"))),
            "trigger_run_id": local_scripts_text(request.get("trigger_run_id").or_else(|| request.get("triggerRunId"))),
        }),
    );
    local_scripts_spawn_run_state_sync(cloud_state, failed_payload);
}

fn local_scripts_cancel_queued_run(app: AppHandle, request: Value) -> Value {
    let cloud_state = Some(app.state::<CloudMcpState>().inner().clone());
    let prepared = local_scripts_prepare_run_request(request.clone());
    let (rel_path, run_id, script) = match prepared {
        Ok((_, rel_path, run_id, script)) => (rel_path, run_id, script),
        Err(_) => {
            let rel_path = local_scripts_text(
                request
                    .get("path_key")
                    .or_else(|| request.get("pathKey"))
                    .or_else(|| request.get("file_path"))
                    .or_else(|| request.get("path")),
            )
            .if_empty("unknown");
            let run_id = local_scripts_text(request.get("run_id").or_else(|| request.get("runId")))
                .if_empty(&format!("script-run-{}", uuid::Uuid::new_v4()));
            let script_id =
                local_scripts_text(request.get("script_id").or_else(|| request.get("id")))
                    .if_empty(&rel_path);
            let script_name = local_scripts_text(
                request
                    .get("script_name")
                    .or_else(|| request.get("scriptName"))
                    .or_else(|| request.get("name"))
                    .or_else(|| request.get("title")),
            )
            .if_empty(&script_id);
            (
                rel_path.clone(),
                run_id,
                json!({
                    "path_key": rel_path,
                    "script_id": script_id,
                    "title": script_name,
                }),
            )
        }
    };
    let ended_at_iso = local_scripts_now_iso();
    let ended_at_ms = cloud_mcp_now_ms();
    let error_text = "Script cancelled before starting.";
    let result = json!({
        "cancelled": true,
        "cause": local_scripts_run_cause(&request),
        "duration_ms": 0,
        "ended_at": ended_at_iso,
        "ended_at_ms": ended_at_ms,
        "error": error_text,
        "exit_code": Value::Null,
        "kind": "local_script_run",
        "loop_runtime_edge_id": local_scripts_text(request.get("loop_runtime_edge_id").or_else(|| request.get("loopRuntimeEdgeId"))),
        "loop_runtime_node_id": local_scripts_text(request.get("loop_runtime_node_id").or_else(|| request.get("loopRuntimeNodeId"))),
        "loop_runtime_run_id": local_scripts_text(request.get("loop_runtime_run_id").or_else(|| request.get("loopRuntimeRunId"))).if_empty(&run_id),
        "loopspace_id": local_scripts_text(request.get("loopspace_id").or_else(|| request.get("loopspaceId"))),
        "ok": false,
        "path_key": rel_path.clone(),
        "queued_at": local_scripts_text(request.get("queued_at")),
        "queued_at_ms": local_scripts_request_i64(&request, &["queued_at_ms"]),
        "run_id": run_id.clone(),
        "run_status": "cancelled",
        "script": script.clone(),
        "source_kind": local_scripts_run_source_kind(&request),
        "stage": "finish",
        "state": "cancelled",
        "stderr": "",
        "stdout": "",
        "timed_out": false,
        "trigger_id": local_scripts_text(request.get("trigger_id").or_else(|| request.get("triggerId"))),
        "trigger_run_id": local_scripts_text(request.get("trigger_run_id").or_else(|| request.get("triggerRunId"))),
    });
    local_scripts_store_run_row(&result);
    local_scripts_emit_run_event(&app, result.clone());
    local_scripts_spawn_run_state_sync(
        cloud_state,
        local_scripts_run_state_payload(
            &request,
            &script,
            &rel_path,
            &run_id,
            "cancelled",
            "cancelled",
            "",
            0,
            Some(&ended_at_iso),
            Some(ended_at_ms),
            Some(0),
            None,
            false,
            error_text,
        ),
    );
    result
}

async fn local_scripts_run_request(app: AppHandle, request: Value) -> Result<Value, String> {
    let cloud_state = Some(app.state::<CloudMcpState>().inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        let (request, rel_path, run_id, script) = local_scripts_prepare_run_request(request)?;
        let path = local_scripts_abs_path(&rel_path)?;
        let extension = script
            .get("extension")
            .and_then(Value::as_str)
            .unwrap_or("sh")
            .to_ascii_lowercase();
        let shell = local_scripts_normalized_shell(
            request
                .get("shell")
                .and_then(Value::as_str)
                .or_else(|| script.get("shell").and_then(Value::as_str))
                .unwrap_or(""),
            &extension,
        );
        let interpreter = match shell.as_str() {
            "python" | "python3" => "python3",
            "node" => "node",
            "bash" => "bash",
            "sh" => "sh",
            "powershell" => {
                if cfg!(target_os = "windows") {
                    "powershell"
                } else {
                    "pwsh"
                }
            }
            "pwsh" => "pwsh",
            "cmd" => "cmd",
            _ => "zsh",
        };
        let explicit_cwd = local_scripts_text(
            request
                .get("working_directory")
                .or_else(|| request.get("cwd")),
        );
        let default_cwd = local_scripts_text(
            request
                .get("default_working_directory")
                .or_else(|| request.get("defaultWorkingDirectory")),
        );
        let cwd = explicit_cwd
            .if_empty(
                script
                    .get("working_directory")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
            )
            .if_empty(&default_cwd);
        let timeout_ms = local_scripts_run_timeout_ms(&request);
        let started_at_iso = local_scripts_now_iso();
        let started_at_ms = cloud_mcp_now_ms();
        let started_at = Instant::now();
        let mut command = Command::new(interpreter);
        match shell.as_str() {
            "cmd" => {
                command.arg("/C").arg(&path);
            }
            "powershell" | "pwsh" => {
                command
                    .arg("-NoProfile")
                    .arg("-ExecutionPolicy")
                    .arg("Bypass")
                    .arg("-File")
                    .arg(&path);
            }
            _ => {
                command.arg(&path);
            }
        }
        if !cwd.is_empty() {
            command.current_dir(&cwd);
        }
        let mut child = match command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => {
                let ended_at_iso = local_scripts_now_iso();
                let failed_payload = local_scripts_run_state_payload(
                    &request,
                    &script,
                    &rel_path,
                    &run_id,
                    "failed",
                    "failed",
                    &started_at_iso,
                    started_at_ms,
                    Some(&ended_at_iso),
                    Some(cloud_mcp_now_ms()),
                    Some(started_at.elapsed().as_millis() as u64),
                    None,
                    false,
                    &error.to_string(),
                );
                local_scripts_store_run_row(&failed_payload);
                local_scripts_emit_run_event(
                    &app,
                    json!({
                        "cwd": cwd.clone(),
                        "duration_ms": started_at.elapsed().as_millis() as u64,
                        "ended_at": ended_at_iso,
                        "error": error.to_string(),
                        "exit_code": Value::Null,
                        "kind": "local_script_run",
                        "ok": false,
                        "path_key": rel_path.clone(),
                        "run_id": run_id.clone(),
                        "script": script.clone(),
                        "stage": "finish",
                        "state": "failed",
                        "stderr": "",
                        "stdout": "",
                        "timed_out": false,
                    }),
                );
                local_scripts_spawn_run_state_sync(cloud_state, failed_payload);
                return Err(error.to_string());
            }
        };
        let cancel_flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut cancellations) = local_scripts_run_queue().cancellations.lock() {
            cancellations.insert(run_id.clone(), cancel_flag.clone());
        }
        let running_payload = local_scripts_run_state_payload(
            &request,
            &script,
            &rel_path,
            &run_id,
            "running",
            "running",
            &started_at_iso,
            started_at_ms,
            None,
            None,
            None,
            None,
            false,
            "",
        );
        local_scripts_store_run_row(&running_payload);
        local_scripts_emit_run_event(
            &app,
            json!({
                "cwd": cwd.clone(),
                "cause": local_scripts_run_cause(&request),
                "kind": "local_script_run",
                "loop_runtime_edge_id": local_scripts_text(request.get("loop_runtime_edge_id").or_else(|| request.get("loopRuntimeEdgeId"))),
                "loop_runtime_node_id": local_scripts_text(request.get("loop_runtime_node_id").or_else(|| request.get("loopRuntimeNodeId"))),
                "loop_runtime_run_id": local_scripts_text(request.get("loop_runtime_run_id").or_else(|| request.get("loopRuntimeRunId"))).if_empty(&run_id),
                "loopspace_id": local_scripts_text(request.get("loopspace_id").or_else(|| request.get("loopspaceId"))),
                "path_key": rel_path.clone(),
                "queued_at": local_scripts_text(request.get("queued_at")),
                "queued_at_ms": local_scripts_request_i64(&request, &["queued_at_ms"]),
                "run_id": run_id.clone(),
                "script": script.clone(),
                "source_kind": local_scripts_run_source_kind(&request),
                "stage": "start",
                "started_at": started_at_iso,
                "started_at_ms": started_at_ms,
                "state": "running",
                "trigger_id": local_scripts_text(request.get("trigger_id").or_else(|| request.get("triggerId"))),
                "trigger_run_id": local_scripts_text(request.get("trigger_run_id").or_else(|| request.get("triggerRunId"))),
            }),
        );
        local_scripts_spawn_run_state_sync(cloud_state.clone(), running_payload);
        let stdout_output = Arc::new(StdMutex::new(Vec::new()));
        let stderr_output = Arc::new(StdMutex::new(Vec::new()));
        let mut readers = Vec::new();
        if let Some(stdout) = child.stdout.take() {
            readers.push(local_scripts_spawn_output_reader(
                app.clone(),
                run_id.clone(),
                rel_path.clone(),
                "stdout",
                stdout,
                stdout_output.clone(),
            ));
        }
        if let Some(stderr) = child.stderr.take() {
            readers.push(local_scripts_spawn_output_reader(
                app.clone(),
                run_id.clone(),
                rel_path.clone(),
                "stderr",
                stderr,
                stderr_output.clone(),
            ));
        }
        let (status, timed_out, cancelled) = loop {
            if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                break (status, false, false);
            }
            if cancel_flag.load(Ordering::SeqCst) {
                let _ = child.kill();
                let status = child.wait().map_err(|error| error.to_string())?;
                break (status, false, true);
            }
            if started_at.elapsed().as_millis() > timeout_ms {
                let _ = child.kill();
                let status = child.wait().map_err(|error| error.to_string())?;
                break (status, true, false);
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        for reader in readers {
            let _ = reader.join();
        }
        if let Ok(mut cancellations) = local_scripts_run_queue().cancellations.lock() {
            cancellations.remove(&run_id);
        }
        let duration_ms = started_at.elapsed().as_millis() as u64;
        let ended_at_iso = local_scripts_now_iso();
        let stdout_bytes = local_scripts_output_bytes(&stdout_output);
        let stderr_bytes = local_scripts_output_bytes(&stderr_output);
        let (stdout, stdout_truncated) = local_scripts_truncate_output(&stdout_bytes);
        let (stderr, stderr_truncated) = local_scripts_truncate_output(&stderr_bytes);
        let ok = status.success() && !timed_out && !cancelled;
        let error_text = if cancelled {
            "Script cancelled.".to_string()
        } else if timed_out {
            format!("Script timed out after {} seconds.", timeout_ms / 1000)
        } else if ok {
            String::new()
        } else {
            stderr.chars().take(2000).collect()
        };
        let final_state = if cancelled {
            "cancelled"
        } else if ok {
            "completed"
        } else {
            "failed"
        };
        let result = json!({
            "cancelled": cancelled,
            "cause": local_scripts_run_cause(&request),
            "duration_ms": duration_ms,
            "ended_at": ended_at_iso,
            "ended_at_ms": cloud_mcp_now_ms(),
            "error": error_text,
            "exit_code": status.code(),
            "kind": "local_script_run",
            "loop_runtime_edge_id": local_scripts_text(request.get("loop_runtime_edge_id").or_else(|| request.get("loopRuntimeEdgeId"))),
            "loop_runtime_node_id": local_scripts_text(request.get("loop_runtime_node_id").or_else(|| request.get("loopRuntimeNodeId"))),
            "loop_runtime_run_id": local_scripts_text(request.get("loop_runtime_run_id").or_else(|| request.get("loopRuntimeRunId"))).if_empty(&run_id),
            "loopspace_id": local_scripts_text(request.get("loopspace_id").or_else(|| request.get("loopspaceId"))),
            "ok": ok,
            "path_key": rel_path.clone(),
            "queued_at": local_scripts_text(request.get("queued_at")),
            "queued_at_ms": local_scripts_request_i64(&request, &["queued_at_ms"]),
            "run_id": run_id.clone(),
            "run_status": final_state,
            "script": script.clone(),
            "source_kind": local_scripts_run_source_kind(&request),
            "started_at": started_at_iso,
            "started_at_ms": started_at_ms,
            "state": final_state,
            "stderr": stderr,
            "stderr_truncated": stderr_truncated,
            "stdout": stdout,
            "stdout_truncated": stdout_truncated,
            "timed_out": timed_out,
            "trigger_id": local_scripts_text(request.get("trigger_id").or_else(|| request.get("triggerId"))),
            "trigger_run_id": local_scripts_text(request.get("trigger_run_id").or_else(|| request.get("triggerRunId"))),
        });
        local_scripts_store_run_row(&result);
        local_scripts_emit_run_event(&app, {
            let mut payload = result.clone();
            if let Some(object) = payload.as_object_mut() {
                object.insert("stage".to_string(), json!("finish"));
            }
            payload
        });
        local_scripts_spawn_run_state_sync(
            cloud_state,
            local_scripts_run_state_payload(
                &request,
                &script,
                &rel_path,
                &run_id,
                final_state,
                final_state,
                &started_at_iso,
                started_at_ms,
                Some(&ended_at_iso),
                Some(cloud_mcp_now_ms()),
                Some(duration_ms),
                status.code(),
                timed_out,
                &error_text,
            ),
        );
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

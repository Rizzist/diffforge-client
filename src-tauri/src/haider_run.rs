// Headless Haider run manager for the session UI. This file is include!d from
// lib.rs and intentionally shares the sessions and projection helpers.

const HAIDER_RUN_CAPABILITY_TIMEOUT: Duration = Duration::from_secs(3);
const HAIDER_RUN_CAPABILITY_BYTES: u64 = 1024 * 1024;
const HAIDER_RUN_BIND_TIMEOUT: Duration = Duration::from_secs(10);

struct HaiderRunChild {
    child: Arc<StdMutex<std::process::Child>>,
    generation: u64,
}

static HAIDER_RUN_STOPPING: AtomicBool = AtomicBool::new(false);
static HAIDER_RUN_GENERATION: AtomicU64 = AtomicU64::new(1);

fn haider_run_children() -> &'static StdMutex<HashMap<String, HaiderRunChild>> {
    static CHILDREN: OnceLock<StdMutex<HashMap<String, HaiderRunChild>>> = OnceLock::new();
    CHILDREN.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn haider_run_prompt(prompt: String) -> Result<String, String> {
    if prompt.trim().is_empty() {
        return Err("Prompt must not be empty.".to_string());
    }
    if prompt.chars().count() > MAX_FORGE_PROMPT_LENGTH {
        return Err(format!(
            "Prompt exceeds the {MAX_FORGE_PROMPT_LENGTH}-character limit."
        ));
    }
    Ok(prompt)
}

fn haider_run_title(prompt: &str) -> String {
    let compact = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    let title = compact.chars().take(48).collect::<String>();
    if title.is_empty() {
        "New session".to_string()
    } else {
        title
    }
}

fn haider_run_working_directory(row: &SessionRow) -> PathBuf {
    let directory = PathBuf::from(&row.dir);
    if row.kind == "generated" {
        directory.join("work")
    } else {
        directory
    }
}

fn haider_run_extract_provider_session_id(value: &Value) -> Option<String> {
    fn from_object(object: &serde_json::Map<String, Value>) -> Option<String> {
        for key in ["session_id", "sessionId", "provider_session_id"] {
            if let Some(id) = haider_projection_text(object.get(key)) {
                return Some(id);
            }
        }
        for key in ["envelope", "event", "data", "result", "session"] {
            if let Some(id) = object
                .get(key)
                .and_then(Value::as_object)
                .and_then(from_object)
            {
                return Some(id);
            }
        }
        None
    }

    value
        .as_object()
        .and_then(from_object)
        .filter(|id| !id.trim().is_empty())
}

fn haider_run_capture(mut command: Command) -> Option<(bool, Vec<u8>, Vec<u8>)> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let stdout = child.stdout.take()?;
    let stderr = child.stderr.take()?;
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout
            .take(HAIDER_RUN_CAPABILITY_BYTES.saturating_add(1))
            .read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr
            .take(HAIDER_RUN_CAPABILITY_BYTES.saturating_add(1))
            .read_to_end(&mut bytes);
        bytes
    });
    let started_at = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status.success()),
            Ok(None) if started_at.elapsed() < HAIDER_RUN_CAPABILITY_TIMEOUT => {
                thread::sleep(Duration::from_millis(20));
            }
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    }?;
    let stdout = stdout_reader.join().ok()?;
    let stderr = stderr_reader.join().ok()?;
    if stdout.len() as u64 > HAIDER_RUN_CAPABILITY_BYTES
        || stderr.len() as u64 > HAIDER_RUN_CAPABILITY_BYTES
    {
        return None;
    }
    Some((status, stdout, stderr))
}

fn haider_run_status_has_session_feature(value: &Value) -> bool {
    fn feature_matches(feature: &str) -> bool {
        matches!(
            feature.trim().to_ascii_lowercase().as_str(),
            "run_session"
                | "run_session_v1"
                | "run-session"
                | "headless_run_session"
                | "headless_run_session_v1"
                | "headless-session-resume"
                | "headless_session_resume_v1"
        )
    }

    match value {
        Value::String(feature) => feature_matches(feature),
        Value::Array(values) => values.iter().any(haider_run_status_has_session_feature),
        Value::Object(object) => object
            .get("features")
            .is_some_and(|features| match features {
                Value::Array(values) => values.iter().any(haider_run_status_has_session_feature),
                Value::Object(features) => features.iter().any(|(name, enabled)| {
                    feature_matches(name) && enabled.as_bool().unwrap_or(true)
                }),
                Value::String(feature) => feature_matches(feature),
                _ => false,
            }),
        _ => false,
    }
}

fn haider_run_status_supports_session() -> bool {
    let mut command = Command::new("haider");
    command.args(["status", "--json", "--no-spawn"]);
    let Some((true, stdout, _)) = haider_run_capture(command) else {
        return false;
    };
    serde_json::from_slice::<Value>(&stdout)
        .ok()
        .is_some_and(|value| haider_run_status_has_session_feature(&value))
}

fn haider_run_parser_supports_session() -> Option<bool> {
    // Supplying a session id but no prompt is side-effect free. A supporting
    // CLI reaches prompt validation; v0.0.928 rejects --session itself.
    let mut command = Command::new("haider");
    command.args(["run", "--session", "diffforge-capability-probe"]);
    let (_, stdout, stderr) = haider_run_capture(command)?;
    let output = format!(
        "{}\n{}",
        String::from_utf8_lossy(&stdout),
        String::from_utf8_lossy(&stderr)
    )
    .to_ascii_lowercase();
    if output.contains("unknown flag") && output.contains("--session") {
        return Some(false);
    }
    if output.contains("prompt argument is required")
        || output.contains("exactly one prompt argument is required")
        || output.contains("--session requires")
    {
        return Some(true);
    }
    None
}

fn haider_run_supports_session() -> bool {
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    *SUPPORTED.get_or_init(|| {
        let status_support = haider_run_status_supports_session();
        haider_run_parser_supports_session().unwrap_or(status_support)
    })
}

fn haider_run_is_active(session_id: &str) -> Result<bool, String> {
    haider_run_children()
        .lock()
        .map(|children| children.contains_key(session_id))
        .map_err(|_| "Haider run child tracker is unavailable.".to_string())
}

fn haider_run_is_current(session_id: &str, generation: u64) -> bool {
    haider_run_children().lock().is_ok_and(|children| {
        children
            .get(session_id)
            .is_some_and(|run| run.generation == generation)
    })
}

fn haider_run_remove_current(session_id: &str, generation: u64) {
    if let Ok(mut children) = haider_run_children().lock() {
        if children
            .get(session_id)
            .is_some_and(|run| run.generation == generation)
        {
            children.remove(session_id);
        }
    }
}

fn haider_run_kill_active(session_id: &str) {
    let child = haider_run_children()
        .lock()
        .ok()
        .and_then(|children| children.get(session_id).map(|run| run.child.clone()));
    if let Some(child) = child {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    }
}

fn haider_run_update_session(
    app: &AppHandle,
    session_id: &str,
    status: Option<&str>,
    provider_session_id: Option<String>,
    first_user_message: Option<String>,
) -> Result<SessionRow, String> {
    let row = session_update_blocking(SessionUpdateArgs {
        id: session_id.to_string(),
        title: None,
        status: status.map(str::to_string),
        provider_session_id,
        first_user_message,
        touch: Some(true),
    })?;
    sessions_emit_changed(app);
    Ok(row)
}

fn haider_run_spawn(
    app: AppHandle,
    local_session_id: String,
    provider_session_id: Option<String>,
    prompt: String,
    cwd: PathBuf,
    binding_sender: Option<std::sync::mpsc::SyncSender<Result<SessionRow, String>>>,
) -> Result<(), String> {
    if haider_run_is_active(&local_session_id)? {
        return Err("A Haider run is already active for this session.".to_string());
    }
    HAIDER_RUN_STOPPING.store(false, Ordering::Release);

    let mut command = Command::new("haider");
    command.arg("run");
    // v0.0.928 documents the prompt first, accepts trailing flags, and rejects
    // a `--` separator. arg() keeps the complete prompt in one argv slot.
    command.arg(&prompt);
    if let Some(provider_session_id) = provider_session_id.as_deref() {
        command.args(["--session", provider_session_id]);
    }
    command.args(["--output", "jsonl"]);
    command
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Unable to start Haider run: {error}"))?;
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Haider run stdout was unavailable.".to_string());
        }
    };
    let child = Arc::new(StdMutex::new(child));
    let generation = HAIDER_RUN_GENERATION.fetch_add(1, Ordering::Relaxed);
    {
        let mut children = match haider_run_children().lock() {
            Ok(children) => children,
            Err(_) => {
                if let Ok(mut child) = child.lock() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                return Err("Haider run child tracker is unavailable.".to_string());
            }
        };
        if children.contains_key(&local_session_id) {
            if let Ok(mut child) = child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
            return Err("A Haider run is already active for this session.".to_string());
        }
        children.insert(
            local_session_id.clone(),
            HaiderRunChild {
                child: child.clone(),
                generation,
            },
        );
    }

    thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stdout);
        let mut line = Vec::new();
        let mut bound_provider_session_id = provider_session_id;
        let mut binding_sender = binding_sender;
        let mut pending_bound_row = None;
        while !HAIDER_RUN_STOPPING.load(Ordering::Acquire) {
            match haider_projection_read_capped_line(&mut reader, &mut line) {
                Ok(Some(true)) => {
                    let Ok(value) = serde_json::from_slice::<Value>(&line) else {
                        continue;
                    };
                    if bound_provider_session_id.is_none() {
                        if let Some(provider_id) = haider_run_extract_provider_session_id(&value) {
                            if haider_run_is_current(&local_session_id, generation) {
                                match haider_run_update_session(
                                    &app,
                                    &local_session_id,
                                    Some("running"),
                                    Some(provider_id.clone()),
                                    None,
                                ) {
                                    Ok(row) => {
                                        bound_provider_session_id = Some(provider_id);
                                        pending_bound_row = Some(row);
                                    }
                                    Err(error) => {
                                        if let Some(sender) = binding_sender.take() {
                                            let _ = sender.send(Err(error.clone()));
                                        }
                                        eprintln!("Unable to bind Haider provider session: {error}")
                                    }
                                }
                            }
                        }
                    }
                    haider_projection_ingest_and_emit(&app, &local_session_id, &value);
                    let projection_started = haider_projection_database_stats(&local_session_id)
                        .is_ok_and(|(total_rows, _)| total_rows > 0);
                    if projection_started {
                        if let Some(row) = pending_bound_row.take() {
                            if let Some(sender) = binding_sender.take() {
                                let _ = sender.send(Ok(row));
                            }
                        }
                    }
                }
                Ok(Some(false)) => continue,
                Ok(None) | Err(_) => break,
            }
        }

        let status = child.lock().ok().and_then(|mut child| {
            if HAIDER_RUN_STOPPING.load(Ordering::Acquire) {
                let _ = child.kill();
            }
            child.wait().ok()
        });
        if haider_run_is_current(&local_session_id, generation) {
            let store_status = if HAIDER_RUN_STOPPING.load(Ordering::Acquire)
                || status.is_some_and(|status| status.success())
            {
                "idle"
            } else {
                "error"
            };
            if let Err(error) =
                haider_run_update_session(&app, &local_session_id, Some(store_status), None, None)
            {
                eprintln!("Unable to finalize Haider run session: {error}");
            }
        }
        if let Some(sender) = binding_sender.take() {
            let _ = sender.send(Err(
                "Haider run exited before its provider session id was available.".to_string(),
            ));
        }
        haider_run_remove_current(&local_session_id, generation);
    });
    Ok(())
}

fn haider_run_stop() {
    HAIDER_RUN_STOPPING.store(true, Ordering::Release);
    let children = haider_run_children()
        .lock()
        .ok()
        .map(|mut children| {
            children
                .drain()
                .map(|(_, run)| run.child)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for child in children {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    }
}

#[tauri::command]
async fn session_start_with_prompt(
    app: AppHandle,
    prompt: String,
    pinned_dir: Option<String>,
) -> Result<SessionRow, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prompt = haider_run_prompt(prompt)?;
        let created = session_create_blocking(SessionCreateArgs {
            title: Some(haider_run_title(&prompt)),
            pinned_dir,
        })?;
        let row = haider_run_update_session(
            &app,
            &created.id,
            Some("running"),
            None,
            Some(prompt.clone()),
        )?;
        let cwd = haider_run_working_directory(&row);
        let (binding_sender, binding_receiver) = std::sync::mpsc::sync_channel(1);
        if let Err(error) = haider_run_spawn(
            app.clone(),
            row.id.clone(),
            None,
            prompt,
            cwd,
            Some(binding_sender),
        ) {
            let _ = haider_run_update_session(&app, &row.id, Some("error"), None, None);
            return Err(error);
        }
        match binding_receiver.recv_timeout(HAIDER_RUN_BIND_TIMEOUT) {
            Ok(Ok(bound_row)) => Ok(bound_row),
            Ok(Err(error)) => {
                haider_run_kill_active(&row.id);
                let _ = haider_run_update_session(&app, &row.id, Some("error"), None, None);
                Err(error)
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                haider_run_kill_active(&row.id);
                let _ = haider_run_update_session(&app, &row.id, Some("error"), None, None);
                Err("Timed out waiting for Haider to create the provider session.".to_string())
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                Err("Haider run ended before creating the provider session.".to_string())
            }
        }
    })
    .await
    .map_err(|error| format!("Session start worker failed: {error}"))?
}

#[tauri::command]
async fn session_submit_prompt(
    app: AppHandle,
    session_id: String,
    prompt: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prompt = haider_run_prompt(prompt)?;
        if !haider_run_supports_session() {
            return Err("haider_run_session_unsupported".to_string());
        }
        let connection = sessions_open_database()?;
        let row = sessions_row_by_id(&connection, session_id.trim())?;
        drop(connection);
        let active = haider_run_is_active(&row.id)?;
        if row.provider_session_id.trim().is_empty() {
            return Err(if active {
                "Haider session is still starting; its provider session id is not bound yet."
                    .to_string()
            } else {
                "Haider session id is not bound yet.".to_string()
            });
        }
        if active {
            return Err("A Haider run is already active for this session.".to_string());
        }
        let row = haider_run_update_session(&app, &row.id, Some("running"), None, None)?;
        let cwd = haider_run_working_directory(&row);
        if let Err(error) = haider_run_spawn(
            app.clone(),
            row.id.clone(),
            Some(row.provider_session_id.clone()),
            prompt,
            cwd,
            None,
        ) {
            let _ = haider_run_update_session(&app, &row.id, Some("error"), None, None);
            return Err(error);
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Session submit worker failed: {error}"))?
}

#[cfg(test)]
mod haider_run_tests {
    use super::*;

    #[test]
    fn haider_run_title_is_whitespace_compacted_and_bounded() {
        assert_eq!(haider_run_title("  hello\n  world  "), "hello world");
        assert_eq!(haider_run_title(&"x".repeat(80)).chars().count(), 48);
    }

    #[test]
    fn haider_run_extracts_provider_session_id_defensively() {
        assert_eq!(
            haider_run_extract_provider_session_id(&json!({
                "event": {"session_id": "session-observed"}
            }))
            .as_deref(),
            Some("session-observed")
        );
    }

    #[test]
    fn haider_run_sniffs_explicit_status_features_only() {
        assert!(haider_run_status_has_session_feature(&json!({
            "features": ["session_observe_v1", "run_session_v1"]
        })));
        assert!(!haider_run_status_has_session_feature(&json!({
            "features": ["session_observe_v1", "turn_control_v1"]
        })));
    }
}

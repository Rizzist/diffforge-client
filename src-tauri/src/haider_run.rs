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

#[derive(Clone, Debug, PartialEq, Eq)]
struct HaiderRunAccepted {
    session_id: String,
    head_seq: i64,
}

struct HaiderRunSubmitRequest {
    row: SessionRow,
    prompt: String,
    attachments: Vec<String>,
    config: Option<RunConfig>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HaiderRunSubmitRoute {
    RejectUnbound,
    ResidentRpc,
    Spawn,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(default)]
struct RunConfig {
    model: Option<String>,
    effort: Option<String>,
    speed: Option<String>,
    account: Option<String>,
}

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

fn haider_run_has_path_attachments(attachments: &[String]) -> bool {
    attachments
        .iter()
        .any(|attachment| !attachment.trim().is_empty())
}

fn haider_run_select_session_submit_route(
    is_bound: bool,
    resident_turn_submit_available: bool,
    attachments: &[String],
) -> HaiderRunSubmitRoute {
    if !is_bound {
        HaiderRunSubmitRoute::RejectUnbound
    } else if resident_turn_submit_available && !haider_run_has_path_attachments(attachments) {
        HaiderRunSubmitRoute::ResidentRpc
    } else {
        HaiderRunSubmitRoute::Spawn
    }
}

fn haider_run_config_has_overrides(config: Option<&RunConfig>) -> bool {
    config.is_some_and(|config| {
        config.model.is_some()
            || config.effort.is_some()
            || config.speed.is_some()
            || config.account.is_some()
    })
}

fn haider_run_validate_config_value(field: &str, value: &str) -> Result<(), String> {
    if !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._/-".contains(character))
    {
        Ok(())
    } else {
        Err(format!(
            "Haider {field} must contain only letters, numbers, '.', '_', '/', or '-'."
        ))
    }
}

fn haider_run_validate_config(config: &RunConfig) -> Result<(), String> {
    for (field, value) in [
        ("model", config.model.as_deref()),
        ("effort", config.effort.as_deref()),
        ("speed", config.speed.as_deref()),
        ("account", config.account.as_deref()),
    ] {
        if let Some(value) = value {
            haider_run_validate_config_value(field, value)?;
        }
    }
    Ok(())
}

fn haider_run_append_config(command: &mut Command, config: &RunConfig) -> Result<(), String> {
    haider_run_validate_config(config)?;
    for (flag, value) in [
        ("--model", config.model.as_deref()),
        ("--effort", config.effort.as_deref()),
        ("--speed", config.speed.as_deref()),
        ("--account", config.account.as_deref()),
    ] {
        if let Some(value) = value {
            command.arg(flag).arg(value);
        }
    }
    Ok(())
}

fn haider_session_config_get_command(provider_session_id: &str) -> Command {
    let mut command = Command::new("haider");
    command.args(["session", provider_session_id, "config", "--json"]);
    command
}

fn haider_session_item_command(provider_session_id: &str, seq: i64) -> Command {
    let mut command = Command::new("haider");
    let seq = seq.to_string();
    command.args(["session", provider_session_id, "item", &seq, "--json"]);
    command
}

fn haider_session_config_set_command(
    provider_session_id: &str,
    config: &RunConfig,
) -> Result<Command, String> {
    let mut command = Command::new("haider");
    command.args(["session", provider_session_id, "config"]);
    haider_run_append_config(&mut command, config)?;
    Ok(command)
}

fn haider_run_capture_json(command: Command) -> Result<Value, String> {
    let Some((success, stdout, stderr)) = haider_run_capture(command) else {
        return Err("Haider command was unavailable or timed out.".to_string());
    };
    if !success {
        let detail = String::from_utf8_lossy(&stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "Haider command was not supported.".to_string()
        } else {
            detail
        });
    }
    serde_json::from_slice(&stdout)
        .ok()
        .or_else(|| {
            stdout
                .split(|byte| *byte == b'\n')
                .rev()
                .find_map(|line| serde_json::from_slice(line).ok())
        })
        .ok_or_else(|| "Haider returned an invalid JSON response.".to_string())
}

fn haider_run_execute(command: Command) -> Result<(), String> {
    let Some((success, _, stderr)) = haider_run_capture(command) else {
        return Err("Haider command was unavailable or timed out.".to_string());
    };
    if success {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&stderr).trim().to_string();
        Err(if detail.is_empty() {
            "Haider command was not supported.".to_string()
        } else {
            detail
        })
    }
}

fn haider_run_config_or_cli<T>(
    rpc: Option<Result<T, String>>,
    cli: impl FnOnce() -> Result<T, String>,
) -> (Result<T, String>, bool) {
    match rpc {
        Some(result) => (result, false),
        None => (cli(), true),
    }
}

fn haider_run_provider_session_id(session_id: &str) -> Result<String, String> {
    let connection = sessions_open_database()?;
    let row = sessions_row_by_id(&connection, session_id.trim())?;
    let provider_session_id = row.provider_session_id.trim();
    if provider_session_id.is_empty() {
        Err("Haider session id is not bound yet.".to_string())
    } else {
        Ok(provider_session_id.to_string())
    }
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

fn haider_run_accepted(value: &Value) -> Option<HaiderRunAccepted> {
    let object = value.as_object()?;
    (object.get("event").and_then(Value::as_str) == Some("accepted")).then_some(())?;
    let session_id = object
        .get("session_id")
        .and_then(Value::as_str)
        .filter(|session_id| !session_id.trim().is_empty())?
        .to_string();
    let head_seq = haider_projection_json_i64(object.get("head_seq"))?;
    Some(HaiderRunAccepted {
        session_id,
        head_seq,
    })
}

fn haider_run_accepts_session(
    accepted: &HaiderRunAccepted,
    expected_session_id: &str,
) -> Result<(), String> {
    if accepted.session_id == expected_session_id {
        Ok(())
    } else {
        Err("Haider accepted a different provider session than requested.".to_string())
    }
}

fn haider_run_fallback_provider_session_id(value: &Value) -> Option<String> {
    // Announcement-like records may arrive before identity refinement. Older
    // harness envelopes may use an object-valued event, so those remain scrapeable.
    if value
        .as_object()
        .and_then(|object| object.get("event"))
        .is_some_and(Value::is_string)
    {
        return None;
    }
    haider_run_extract_provider_session_id(value)
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
        haider_run_selects_session_submit(status_support, haider_run_parser_supports_session())
    })
}

fn haider_run_selects_session_submit(status_support: bool, parser_support: Option<bool>) -> bool {
    status_support || parser_support.unwrap_or(false)
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

fn haider_run_state_raw(status: &str) -> &str {
    if status == "running" {
        "streaming"
    } else {
        status
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
        state_raw: status.map(haider_run_state_raw).map(str::to_string),
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
    attachments: Vec<String>,
    config: Option<RunConfig>,
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
    // ADE sessions run full auto-accept: without auto_allow in the session's
    // permission overrides, Network/computer effects park a menu that the
    // HEADLESS reducer answers with deny (~1s) — a phantom rejection no ADE
    // surface ever shows. Deny rules still win; everything stays journaled.
    command.arg("--auto-allow");
    if let Some(config) = config.as_ref() {
        haider_run_append_config(&mut command, config)?;
    }
    // `haider run --attach <path>` is repeatable; only existing files ride.
    for attachment in &attachments {
        let path = attachment.trim();
        if !path.is_empty() && std::path::Path::new(path).exists() {
            command.args(["--attach", path]);
        }
    }
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
        let mut accepted_bound = false;
        while !HAIDER_RUN_STOPPING.load(Ordering::Acquire) {
            match haider_projection_read_capped_line(&mut reader, &mut line) {
                Ok(Some(true)) => {
                    let Ok(value) = serde_json::from_slice::<Value>(&line) else {
                        continue;
                    };
                    let accepted = haider_run_accepted(&value);
                    if let Some(accepted) = accepted.as_ref() {
                        haider_bridge_note_head_seq(&accepted.session_id, accepted.head_seq);
                        if let Some(expected_session_id) = bound_provider_session_id.as_deref() {
                            if !accepted_bound {
                                accepted_bound = true;
                                match haider_run_accepts_session(accepted, expected_session_id) {
                                    Ok(()) => {
                                        let row = pending_bound_row.take().map(Ok).or_else(|| {
                                            binding_sender.as_ref()?;
                                            Some(haider_run_update_session(
                                                &app,
                                                &local_session_id,
                                                Some("running"),
                                                Some(accepted.session_id.clone()),
                                                None,
                                            ))
                                        });
                                        if let (Some(sender), Some(row)) =
                                            (binding_sender.take(), row)
                                        {
                                            let _ = sender.send(row);
                                        }
                                    }
                                    Err(error) => {
                                        if let Some(sender) = binding_sender.take() {
                                            let _ = sender.send(Err(error));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if bound_provider_session_id.is_none() {
                        let provider_id = accepted
                            .as_ref()
                            .map(|accepted| accepted.session_id.clone())
                            .or_else(|| haider_run_fallback_provider_session_id(&value));
                        if let Some(provider_id) = provider_id {
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
                                        if accepted.is_some() {
                                            accepted_bound = true;
                                            if let Some(sender) = binding_sender.take() {
                                                let _ = sender.send(Ok(row));
                                            }
                                        } else {
                                            pending_bound_row = Some(row);
                                        }
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

#[tauri::command(rename_all = "snake_case")]
async fn session_start_with_prompt(
    app: AppHandle,
    prompt: String,
    pinned_dir: Option<String>,
    attachments: Option<Vec<String>>,
    config: Option<RunConfig>,
) -> Result<SessionRow, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prompt = haider_run_prompt(prompt)?;
        if let Some(config) = config.as_ref() {
            haider_run_validate_config(config)?;
        }
        // Harness-first doctrine: the rail must never show an ADE-created
        // session. The store row exists silently (create/delete emit nothing)
        // until Haider reports the provider session id — the binding update
        // is the first emit, so the first thing the rail sees is a real,
        // bound harness session. Every failure path hard-deletes row + dir.
        let created = session_create_blocking(SessionCreateArgs {
            title: Some(haider_run_title(&prompt)),
            pinned_dir,
        })?;
        let discard_created = |app: &AppHandle| {
            let _ = app;
            let _ = session_delete_blocking(SessionDeleteArgs {
                id: created.id.clone(),
                delete_dir: created.kind == "generated",
            });
        };
        let cwd = haider_run_working_directory(&created);
        let (binding_sender, binding_receiver) = std::sync::mpsc::sync_channel(1);
        if let Err(error) = haider_run_spawn(
            app.clone(),
            created.id.clone(),
            None,
            prompt.clone(),
            cwd,
            attachments.clone().unwrap_or_default(),
            config,
            Some(binding_sender),
        ) {
            discard_created(&app);
            return Err(error);
        }
        match binding_receiver.recv_timeout(HAIDER_RUN_BIND_TIMEOUT) {
            Ok(Ok(_bound_row)) => {
                haider_run_update_session(&app, &created.id, Some("running"), None, Some(prompt))
            }
            Ok(Err(error)) => {
                haider_run_kill_active(&created.id);
                discard_created(&app);
                Err(error)
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                haider_run_kill_active(&created.id);
                discard_created(&app);
                Err("Timed out waiting for Haider to create the provider session.".to_string())
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                haider_run_kill_active(&created.id);
                discard_created(&app);
                Err("Haider run ended before creating the provider session.".to_string())
            }
        }
    })
    .await
    .map_err(|error| format!("Session start worker failed: {error}"))?
}

fn haider_run_prepare_session_submit(
    session_id: String,
    prompt: String,
    attachments: Option<Vec<String>>,
    config: Option<RunConfig>,
) -> Result<HaiderRunSubmitRequest, String> {
    let prompt = haider_run_prompt(prompt)?;
    if let Some(config) = config.as_ref() {
        haider_run_validate_config(config)?;
    }
    let connection = sessions_open_database()?;
    let row = sessions_row_by_id(&connection, session_id.trim())?;
    drop(connection);
    let active = haider_run_is_active(&row.id)?;
    if row.provider_session_id.trim().is_empty() {
        return Err(if active {
            "Haider session is still starting; its provider session id is not bound yet.".to_string()
        } else {
            "Haider session id is not bound yet.".to_string()
        });
    }
    if active {
        return Err("A Haider run is already active for this session.".to_string());
    }
    Ok(HaiderRunSubmitRequest {
        row,
        prompt,
        attachments: attachments.unwrap_or_default(),
        config,
    })
}

#[tauri::command(rename_all = "snake_case")]
async fn session_submit_prompt(
    app: AppHandle,
    session_id: String,
    prompt: String,
    attachments: Option<Vec<String>>,
    config: Option<RunConfig>,
) -> Result<(), String> {
    let submit = tauri::async_runtime::spawn_blocking(move || {
        haider_run_prepare_session_submit(session_id, prompt, attachments, config)
    })
    .await
    .map_err(|error| format!("Session submit worker failed: {error}"))??;

    let try_resident = matches!(
        haider_run_select_session_submit_route(true, true, &submit.attachments),
        HaiderRunSubmitRoute::ResidentRpc
    ) && !haider_run_config_has_overrides(submit.config.as_ref());
    if try_resident {
        if let Some(Ok(receipt)) = haider_rpc_ade::resident_turn_submit_rpc(
            submit.row.provider_session_id.clone(),
            submit.prompt.clone(),
            submit.attachments.clone(),
        )
        .await
        {
            if let Ok(head_seq) = i64::try_from(receipt.accepted_seq) {
                haider_bridge_note_head_seq(&receipt.session_id, head_seq);
            }
            let app = app.clone();
            let local_session_id = submit.row.id.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                haider_run_update_session(&app, &local_session_id, Some("running"), None, None)
            })
            .await;
            return Ok(());
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        if !haider_run_supports_session() {
            return Err("haider_run_session_unsupported".to_string());
        }
        let cwd = haider_run_working_directory(&submit.row);
        let (binding_sender, binding_receiver) = std::sync::mpsc::sync_channel(1);
        if let Err(error) = haider_run_spawn(
            app.clone(),
            submit.row.id.clone(),
            Some(submit.row.provider_session_id.clone()),
            submit.prompt,
            cwd,
            submit.attachments,
            submit.config,
            Some(binding_sender),
        ) {
            let _ = haider_run_update_session(&app, &submit.row.id, Some("error"), None, None);
            return Err(error);
        }
        match binding_receiver.recv_timeout(HAIDER_RUN_BIND_TIMEOUT) {
            Ok(Ok(_bound_row)) => Ok(()),
            Ok(Err(error)) => {
                haider_run_kill_active(&submit.row.id);
                let _ = haider_run_update_session(&app, &submit.row.id, Some("error"), None, None);
                Err(error)
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                haider_run_kill_active(&submit.row.id);
                let _ = haider_run_update_session(&app, &submit.row.id, Some("error"), None, None);
                Err("Timed out waiting for Haider to accept the session prompt.".to_string())
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                haider_run_kill_active(&submit.row.id);
                let _ = haider_run_update_session(&app, &submit.row.id, Some("error"), None, None);
                Err("Haider run ended before accepting the session prompt.".to_string())
            }
        }
    })
    .await
    .map_err(|error| format!("Session submit worker failed: {error}"))?
}

fn haider_run_store_seen_at_ms(session_id: String, seen_at_ms: i64) -> Result<(), String> {
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    let connection = sessions_open_database()?;
    connection
        .execute(
            "UPDATE sessions SET seen_at_ms = CASE WHEN seen_at_ms IS NULL OR seen_at_ms < ?2 THEN ?2 ELSE seen_at_ms END WHERE id = ?1",
            rusqlite::params![session_id, seen_at_ms],
        )
        .map_err(|error| format!("Unable to store session seen state: {error}"))?;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
async fn session_mark_seen(app: AppHandle, session_id: String) -> Result<(), String> {
    let local_session_id = session_id.clone();
    let provider_session_id =
        tauri::async_runtime::spawn_blocking(move || haider_run_provider_session_id(&session_id))
            .await
            .map_err(|error| format!("Session seen worker failed: {error}"))??;
    let Some(receipt) = haider_rpc_ade::session_seen_rpc(provider_session_id).await else {
        return Ok(());
    };
    let receipt = receipt?;
    let seen_at_ms = i64::try_from(receipt.seen_at_ms)
        .map_err(|_| "Session seen receipt timestamp exceeded SQLite range.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        haider_run_store_seen_at_ms(local_session_id, seen_at_ms)
    })
    .await
    .map_err(|error| format!("Session seen worker failed: {error}"))??;
    sessions_emit_changed(&app);
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
async fn session_config_get(session_id: String) -> Value {
    let provider_session_id = match tauri::async_runtime::spawn_blocking(move || {
        haider_run_provider_session_id(&session_id)
    })
    .await
    {
        Ok(Ok(provider_session_id)) => provider_session_id,
        Ok(Err(error)) => return json!({"ok": false, "error": error}),
        Err(error) => {
            return json!({"ok": false, "error": format!("Session config worker failed: {error}")})
        }
    };
    let rpc = haider_rpc_ade::session_config_get_rpc(provider_session_id.clone()).await;
    tauri::async_runtime::spawn_blocking(move || {
        let (result, _) = haider_run_config_or_cli(rpc, || {
            haider_run_capture_json(haider_session_config_get_command(&provider_session_id))
        });
        result.unwrap_or_else(|error| json!({"ok": false, "error": error}))
    })
    .await
    .unwrap_or_else(
        |error| json!({"ok": false, "error": format!("Session config worker failed: {error}")}),
    )
}

/// Discard a staged paste file. Guarded to OUR staging prefix inside the
/// temp dir — this command can never delete anything else.
#[tauri::command(rename_all = "snake_case")]
fn discard_staged_attachment(path: String) -> Result<(), String> {
    // Canonical-path law: the file must resolve to a DIRECT child of the
    // canonical temp dir with our staging prefix — lexical prefix checks
    // fall to `..` traversal and symlinked directories.
    let candidate = std::path::PathBuf::from(&path);
    let canonical = match candidate.canonicalize() {
        Ok(canonical) => canonical,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Staged paste could not be resolved: {error}")),
    };
    let temp_root = std::env::temp_dir()
        .canonicalize()
        .map_err(|error| format!("Temp dir could not be resolved: {error}"))?;
    let name = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if canonical.parent() != Some(temp_root.as_path()) || !name.starts_with("diffforge-paste-") {
        return Err("Path is not a staged paste file.".to_string());
    }
    match std::fs::remove_file(&canonical) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Staged paste could not be discarded: {error}")),
    }
}

/// Stage a pasted clipboard image as a temp file so it can ride the run's
/// --attach lane like any picked file. Returns the staged path.
#[tauri::command(rename_all = "snake_case")]
fn stage_pasted_image(bytes: String, mime: String) -> Result<String, String> {
    use base64::Engine as _;
    // The UI caps/allowlists too, but the server enforces its own limits —
    // the frontend is not a trust boundary.
    const STAGE_MAX_BYTES: usize = 12 * 1024 * 1024;
    let extension = match mime.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        other => return Err(format!("Unsupported pasted image type: {other}")),
    };
    if bytes.len() > STAGE_MAX_BYTES.saturating_mul(4) / 3 + 4 {
        return Err("Pasted image is too large.".to_string());
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(bytes.as_bytes())
        .map_err(|error| format!("Pasted image could not be decoded: {error}"))?;
    if decoded.is_empty() {
        return Err("Pasted image was empty.".to_string());
    }
    if decoded.len() > STAGE_MAX_BYTES {
        return Err("Pasted image is too large.".to_string());
    }
    let path = std::env::temp_dir().join(format!(
        "diffforge-paste-{}.{extension}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&path, decoded)
        .map_err(|error| format!("Pasted image could not be staged: {error}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// Item detail door (0.0.934, `haider.item.v1`): fetch ONE full journal item
/// for the chat drawer — cold sidecar rows carry only the envelope; the door
/// has the joined args/result.
#[tauri::command(rename_all = "snake_case")]
async fn session_item_get(session_id: String, seq: i64) -> Value {
    tauri::async_runtime::spawn_blocking(move || {
        let provider_session_id = haider_run_provider_session_id(&session_id)?;
        haider_run_capture_json(haider_session_item_command(&provider_session_id, seq))
    })
    .await
    .unwrap_or_else(|error| Err(format!("Session item worker failed: {error}")))
    .unwrap_or_else(|error| json!({"ok": false, "error": error}))
}

#[tauri::command(rename_all = "snake_case")]
async fn session_config_set(
    app: AppHandle,
    session_id: String,
    model: Option<String>,
    effort: Option<String>,
    speed: Option<String>,
    account: Option<String>,
) -> Result<Value, String> {
    let config = RunConfig {
        model,
        effort,
        speed,
        account,
    };
    haider_run_validate_config(&config)?;
    let provider_session_id =
        tauri::async_runtime::spawn_blocking(move || haider_run_provider_session_id(&session_id))
            .await
            .map_err(|error| format!("Session config worker failed: {error}"))??;
    let rpc = haider_rpc_ade::session_config_set_rpc(
        provider_session_id.clone(),
        config.model.clone(),
        config.effort.clone(),
        config.speed.clone(),
        config.account.clone(),
    )
    .await;
    let (result, used_cli) = tauri::async_runtime::spawn_blocking(move || {
        haider_run_config_or_cli(rpc, || {
            let command = haider_session_config_set_command(&provider_session_id, &config)?;
            haider_run_execute(command)?;
            Ok(json!({"ok": true}))
        })
    })
    .await
    .map_err(|error| format!("Session config worker failed: {error}"))?;
    let result = result?;
    if used_cli {
        haider_bridge_sync_once(&app).await;
    }
    Ok(result)
}

#[cfg(test)]
mod haider_run_tests {
    use super::*;

    fn haider_run_test_args(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn haider_run_title_is_whitespace_compacted_and_bounded() {
        assert_eq!(haider_run_title("  hello\n  world  "), "hello world");
        assert_eq!(haider_run_title(&"x".repeat(80)).chars().count(), 48);
    }

    #[test]
    fn haider_run_records_raw_lifecycle_state() {
        assert_eq!(haider_run_state_raw("running"), "streaming");
        assert_eq!(haider_run_state_raw("idle"), "idle");
        assert_eq!(haider_run_state_raw("error"), "error");
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
    fn haider_run_parses_first_accepted_announce() {
        assert_eq!(
            haider_run_accepted(&json!({
                "event":"accepted",
                "session_id":"session-observed",
                "head_seq":17
            })),
            Some(HaiderRunAccepted {
                session_id: "session-observed".to_string(),
                head_seq: 17,
            })
        );
        assert!(haider_run_accepted(&json!({
            "event":"accepted",
            "session_id":"session-observed"
        }))
        .is_none());
    }

    #[test]
    fn haider_run_out_of_order_refinement_cannot_win_fallback_binding() {
        let refinement = json!({
            "event":"accepted_refinement",
            "session_id":"session-refinement",
            "head_seq":29
        });
        let accepted = json!({
            "event":"accepted",
            "session_id":"session-identity",
            "head_seq":4
        });
        assert!(haider_run_accepted(&refinement).is_none());
        assert!(haider_run_fallback_provider_session_id(&refinement).is_none());
        assert_eq!(
            [refinement, accepted]
                .iter()
                .find_map(haider_run_accepted)
                .unwrap()
                .session_id,
            "session-identity"
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
        assert!(!haider_run_status_has_session_feature(&json!({
            "features": ["session_observe_v1", "session_mutation_v1"]
        })));
    }

    #[test]
    fn haider_run_selects_modern_session_submit_over_legacy_parser_sniff() {
        assert!(haider_run_selects_session_submit(true, Some(false)));
        assert!(haider_run_selects_session_submit(true, None));
        assert!(haider_run_selects_session_submit(false, Some(true)));
        assert!(!haider_run_selects_session_submit(false, Some(false)));
        assert!(!haider_run_selects_session_submit(false, None));
    }

    #[test]
    fn haider_run_routes_resident_submit_only_for_bound_text_turns() {
        assert_eq!(
            haider_run_select_session_submit_route(true, true, &[]),
            HaiderRunSubmitRoute::ResidentRpc
        );
        assert_eq!(
            haider_run_select_session_submit_route(true, false, &[]),
            HaiderRunSubmitRoute::Spawn
        );
        assert_eq!(
            haider_run_select_session_submit_route(true, true, &["/tmp/image.png".to_string()]),
            HaiderRunSubmitRoute::Spawn
        );
        assert_eq!(
            haider_run_select_session_submit_route(false, true, &[]),
            HaiderRunSubmitRoute::RejectUnbound
        );
        assert_eq!(
            haider_run_select_session_submit_route(true, true, &["  ".to_string()]),
            HaiderRunSubmitRoute::ResidentRpc
        );
    }

    #[test]
    fn haider_run_binds_submit_to_the_accepted_session() {
        let accepted = HaiderRunAccepted {
            session_id: "session-requested".to_string(),
            head_seq: 8,
        };
        assert!(haider_run_accepts_session(&accepted, "session-requested").is_ok());
        assert!(haider_run_accepts_session(&accepted, "session-other").is_err());
    }

    #[test]
    fn haider_session_config_builds_get_and_sparse_set_args() {
        assert_eq!(
            haider_run_test_args(&haider_session_config_get_command("session-provider")),
            ["session", "session-provider", "config", "--json"]
        );

        let config = RunConfig {
            model: Some("openai/gpt-5.4".to_string()),
            effort: None,
            speed: Some("fast".to_string()),
            account: Some("work_account-1".to_string()),
        };
        let command = haider_session_config_set_command("session-provider", &config).unwrap();
        assert_eq!(
            haider_run_test_args(&command),
            [
                "session",
                "session-provider",
                "config",
                "--model",
                "openai/gpt-5.4",
                "--speed",
                "fast",
                "--account",
                "work_account-1",
            ]
        );
    }

    #[test]
    fn haider_session_config_rejects_unsafe_values() {
        for unsafe_value in ["", "high power", "x;touch", "$(command)", "name@host"] {
            let config = RunConfig {
                model: Some(unsafe_value.to_string()),
                ..RunConfig::default()
            };
            assert!(haider_session_config_set_command("session-provider", &config).is_err());
        }
        let config = RunConfig {
            effort: Some("xhigh".to_string()),
            ..RunConfig::default()
        };
        assert!(haider_session_config_set_command("session-provider", &config).is_ok());
    }

    #[test]
    fn haider_session_config_uses_cli_fallback_without_rpc_socket() {
        let cli_calls = std::cell::Cell::new(0);
        let (result, used_cli) = haider_run_config_or_cli(None::<Result<Value, String>>, || {
            cli_calls.set(cli_calls.get() + 1);
            Ok(json!({"schema":"haider.session_config.v1"}))
        });
        assert!(used_cli);
        assert_eq!(cli_calls.get(), 1);
        assert_eq!(result.unwrap()["schema"], "haider.session_config.v1");

        let (result, used_cli) =
            haider_run_config_or_cli(Some(Ok(json!({"ok":true}))), || -> Result<Value, String> {
                panic!("CLI must not run while RPC is available")
            });
        assert!(!used_cli);
        assert_eq!(result.unwrap(), json!({"ok":true}));
    }

    #[test]
    fn discard_staged_attachment_guards_prefix_and_traversal() {
        // A real staged file (direct temp child, right prefix) is removed.
        let staged = std::env::temp_dir().join(format!(
            "diffforge-paste-{}.png",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::write(&staged, b"x").unwrap();
        discard_staged_attachment(staged.to_string_lossy().to_string()).unwrap();
        assert!(!staged.exists());
        // Wrong prefix in a nested dir is refused even when the path string
        // routes through temp with traversal.
        let nested = std::env::temp_dir().join(format!(
            "dfp-nest-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&nested).unwrap();
        let victim = nested.join("diffforge-paste-victim.png");
        std::fs::write(&victim, b"x").unwrap();
        let sneaky = std::env::temp_dir()
            .join("..")
            .join(
                std::env::temp_dir()
                    .file_name()
                    .map(|name| name.to_os_string())
                    .unwrap_or_default(),
            )
            .join(nested.file_name().unwrap())
            .join("diffforge-paste-victim.png");
        assert!(discard_staged_attachment(sneaky.to_string_lossy().to_string()).is_err());
        assert!(victim.exists());
        std::fs::remove_dir_all(&nested).unwrap();
        // Missing files are a quiet Ok.
        discard_staged_attachment(
            std::env::temp_dir()
                .join("diffforge-paste-never-existed.png")
                .to_string_lossy()
                .to_string(),
        )
        .unwrap();
    }

    #[test]
    fn stage_pasted_image_enforces_mime_and_size() {
        assert!(stage_pasted_image("aGk=".to_string(), "image/tiff".to_string()).is_err());
        assert!(stage_pasted_image(String::new(), "image/png".to_string()).is_err());
        // Encoded-length precheck rejects oversized input without decoding.
        let oversized = "A".repeat(17 * 1024 * 1024);
        assert!(stage_pasted_image(oversized, "image/png".to_string()).is_err());
        let path = stage_pasted_image("aGk=".to_string(), "image/png".to_string()).unwrap();
        assert!(path.ends_with(".png"));
        assert_eq!(std::fs::read(&path).unwrap(), b"hi");
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn haider_session_item_command_matches_the_934_door() {
        let command = haider_session_item_command("session-abc", 221);
        assert_eq!(
            haider_run_test_args(&command),
            ["session", "session-abc", "item", "221", "--json"]
        );
    }

    #[test]
    fn haider_run_appends_all_config_flags() {
        let mut command = Command::new("haider");
        command.args(["run", "test prompt", "--output", "jsonl"]);
        haider_run_append_config(
            &mut command,
            &RunConfig {
                model: Some("anthropic/claude-sonnet".to_string()),
                effort: Some("high".to_string()),
                speed: Some("normal".to_string()),
                account: Some("personal".to_string()),
            },
        )
        .unwrap();
        assert_eq!(
            haider_run_test_args(&command),
            [
                "run",
                "test prompt",
                "--output",
                "jsonl",
                "--model",
                "anthropic/claude-sonnet",
                "--effort",
                "high",
                "--speed",
                "normal",
                "--account",
                "personal",
            ]
        );
    }
}

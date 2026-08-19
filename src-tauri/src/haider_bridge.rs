const HAIDER_BRIDGE_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const HAIDER_BRIDGE_INITIAL_SYNC_DELAY: Duration = Duration::from_secs(3);
const HAIDER_BRIDGE_EVENT_DEBOUNCE: Duration = Duration::from_millis(750);
const HAIDER_BRIDGE_RETRY_MIN: Duration = Duration::from_secs(5);
const HAIDER_BRIDGE_RETRY_MAX: Duration = Duration::from_secs(120);
const HAIDER_BRIDGE_STABLE_FOLLOW: Duration = Duration::from_secs(30);
const HAIDER_BRIDGE_MAX_JSON_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
struct HaiderBridgeSession {
    id: String,
    title: Option<String>,
    model: Option<String>,
    cwd: Option<PathBuf>,
    state: Option<String>,
    latest_at_ms: Option<i64>,
}

static HAIDER_BRIDGE_STARTED: AtomicBool = AtomicBool::new(false);
static HAIDER_BRIDGE_STOPPING: AtomicBool = AtomicBool::new(false);

fn haider_bridge_head_sequences() -> &'static StdMutex<HashMap<String, i64>> {
    static HEADS: OnceLock<StdMutex<HashMap<String, i64>>> = OnceLock::new();
    HEADS.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn haider_bridge_note_head_seq(session_id: &str, head_seq: i64) {
    if session_id.trim().is_empty() || head_seq < 0 {
        return;
    }
    if let Ok(mut heads) = haider_bridge_head_sequences().lock() {
        heads
            .entry(session_id.to_string())
            .and_modify(|head| *head = (*head).max(head_seq))
            .or_insert(head_seq);
    }
}

fn haider_bridge_head_seq(session_id: &str) -> Option<i64> {
    haider_bridge_head_sequences()
        .lock()
        .ok()
        .and_then(|heads| heads.get(session_id).copied())
}

fn haider_bridge_child_slot() -> &'static StdMutex<Option<Arc<StdMutex<std::process::Child>>>> {
    static CHILD: OnceLock<StdMutex<Option<Arc<StdMutex<std::process::Child>>>>> = OnceLock::new();
    CHILD.get_or_init(|| StdMutex::new(None))
}

fn haider_bridge_json_command(subcommand: &str) -> Option<Value> {
    let mut child = Command::new("haider")
        .args([subcommand, "--json", "--no-spawn"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let stdout = child.stdout.take()?;
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout
            .take(HAIDER_BRIDGE_MAX_JSON_BYTES)
            .read_to_end(&mut bytes);
        bytes
    });
    let started_at = Instant::now();

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started_at.elapsed() < HAIDER_BRIDGE_COMMAND_TIMEOUT => {
                thread::sleep(Duration::from_millis(25));
            }
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let bytes = reader.join().ok()?;
    if !status.is_some_and(|status| status.success()) {
        return None;
    }

    serde_json::from_slice(&bytes).ok().or_else(|| {
        bytes
            .split(|byte| *byte == b'\n')
            .rev()
            .find_map(|line| serde_json::from_slice(line).ok())
    })
}

fn haider_bridge_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let text = text.trim();
            (!text.is_empty()).then(|| text.to_string())
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn haider_bridge_object_value<'a>(
    object: &'a serde_json::Map<String, Value>,
    keys: &[&str],
    wrappers: &[&str],
) -> Option<&'a Value> {
    keys.iter().find_map(|key| object.get(*key)).or_else(|| {
        wrappers.iter().find_map(|wrapper| {
            object
                .get(*wrapper)
                .and_then(Value::as_object)
                .and_then(|nested| keys.iter().find_map(|key| nested.get(*key)))
        })
    })
}

fn haider_bridge_state_text(value: &Value) -> Option<String> {
    if let Some(text) = haider_bridge_text(value) {
        return Some(text);
    }
    let object = value.as_object()?;
    for key in ["status", "state", "kind", "type", "name"] {
        if let Some(text) = object.get(key).and_then(haider_bridge_text) {
            return Some(text);
        }
    }
    (object.len() == 1)
        .then(|| object.keys().next().cloned())
        .flatten()
}

fn haider_bridge_timestamp(value: &Value) -> Option<i64> {
    let raw = match value {
        Value::Number(number) => number.as_i64().or_else(|| {
            number
                .as_f64()
                .filter(|value| value.is_finite())
                .map(|value| value as i64)
        }),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    }?;
    Some(if raw.abs() < 100_000_000_000 {
        raw.saturating_mul(1_000)
    } else {
        raw
    })
}

fn haider_bridge_sequence(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64().or_else(|| {
            number
                .as_u64()
                .map(|value| value.min(i64::MAX as u64) as i64)
        }),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    }
    .map(|value| value.max(0))
}

fn haider_bridge_parse_session(
    value: &Value,
    inherited_id: Option<&str>,
) -> Option<HaiderBridgeSession> {
    let object = value.as_object()?;
    let id = haider_bridge_object_value(
        object,
        &["session_id", "sessionId", "id"],
        &["session", "summary"],
    )
    .and_then(haider_bridge_text)
    .or_else(|| inherited_id.map(str::to_string))?;
    if id.trim().is_empty() {
        return None;
    }

    let title = haider_bridge_object_value(
        object,
        &["title", "name"],
        &["metadata", "session", "summary"],
    )
    .and_then(haider_bridge_text);
    let model = haider_bridge_object_value(object, &["model"], &["summary", "metadata", "session"])
        .and_then(haider_bridge_text)
        .or_else(|| {
            haider_bridge_object_value(object, &["last_model"], &["summary", "metadata", "session"])
                .and_then(haider_bridge_text)
        });
    let cwd = haider_bridge_object_value(
        object,
        &[
            "workspace_cwd",
            "cwd",
            "dir",
            "directory",
            "working_directory",
            "workingDirectory",
            "workspace_root",
            "workspaceRoot",
        ],
        &["summary", "workspace", "metadata", "session"],
    )
    .and_then(haider_bridge_text)
    .map(PathBuf::from);
    let state = haider_bridge_object_value(
        object,
        &[
            "run_state",
            "runState",
            "state",
            "status",
            "session_state",
            "sessionState",
        ],
        &["runtime", "summary", "session"],
    )
    .and_then(haider_bridge_state_text);

    let timestamp_keys = [
        "updated_at_ms",
        "latest_at_ms",
        "last_activity_at_ms",
        "last_event_at_ms",
        "activity_at_ms",
        "terminal_at_ms",
        "updated_at",
        "latest_at",
        "last_activity_at",
    ];
    let latest_at_ms = [None, Some("summary"), Some("activity"), Some("runtime")]
        .into_iter()
        .filter_map(|wrapper| {
            let candidate = match wrapper {
                Some(wrapper) => object.get(wrapper)?.as_object()?,
                None => object,
            };
            timestamp_keys
                .iter()
                .filter_map(|key| candidate.get(*key).and_then(haider_bridge_timestamp))
                .max()
        })
        .max();
    let has_session_shape = title.is_some()
        || model.is_some()
        || cwd.is_some()
        || state.is_some()
        || latest_at_ms.is_some()
        || object.contains_key("head_seq")
        || object.contains_key("summary");
    has_session_shape.then_some(HaiderBridgeSession {
        id,
        title,
        model,
        cwd,
        state,
        latest_at_ms,
    })
}

fn haider_bridge_collect_head_sequences(value: &Value) {
    match value {
        Value::Array(values) => {
            for value in values {
                haider_bridge_collect_head_sequences(value);
            }
        }
        Value::Object(object) => {
            let session_id = haider_bridge_object_value(
                object,
                &["session_id", "sessionId", "id"],
                &["session", "summary"],
            )
            .and_then(haider_bridge_text);
            let head_seq = haider_bridge_object_value(
                object,
                &["head_seq", "headSeq"],
                &["session", "summary"],
            )
            .and_then(haider_bridge_sequence);
            if let (Some(session_id), Some(head_seq)) = (session_id, head_seq) {
                haider_bridge_note_head_seq(&session_id, head_seq);
            }
            for value in object.values() {
                haider_bridge_collect_head_sequences(value);
            }
        }
        _ => {}
    }
}

fn haider_bridge_collect_sessions(
    value: &Value,
    inherited_id: Option<&str>,
    sessions: &mut Vec<HaiderBridgeSession>,
) {
    if let Some(session) = haider_bridge_parse_session(value, inherited_id) {
        sessions.push(session);
        return;
    }

    match value {
        Value::Array(values) => {
            if let [Value::String(id), session] = values.as_slice() {
                haider_bridge_collect_sessions(session, Some(id), sessions);
            } else {
                for value in values {
                    haider_bridge_collect_sessions(value, None, sessions);
                }
            }
        }
        Value::Object(object) => {
            for key in ["sessions", "items", "entries"] {
                let Some(container) = object.get(key) else {
                    continue;
                };
                if let Value::Object(keyed_sessions) = container {
                    for (id, value) in keyed_sessions {
                        haider_bridge_collect_sessions(value, Some(id), sessions);
                    }
                } else {
                    haider_bridge_collect_sessions(container, None, sessions);
                }
            }
            for key in ["data", "result", "response", "body"] {
                if let Some(container) = object.get(key) {
                    haider_bridge_collect_sessions(container, None, sessions);
                }
            }
        }
        _ => {}
    }
}

fn haider_bridge_parse_session_list(value: &Value) -> Vec<HaiderBridgeSession> {
    let mut sessions = Vec::new();
    haider_bridge_collect_sessions(value, None, &mut sessions);
    sessions.sort_by(|left, right| left.id.cmp(&right.id));
    sessions.dedup_by(|left, right| left.id == right.id);
    sessions
}

fn haider_bridge_store_status(state: Option<&str>) -> &'static str {
    let normalized = state
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' ', '.'], "_");
    if ["error", "errored", "failed", "failure", "fatal"]
        .iter()
        .any(|needle| normalized.contains(needle))
    {
        "error"
    } else if [
        "waiting",
        "input_required",
        "permission_required",
        "needs_input",
        "awaiting_input",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
    {
        "waiting"
    } else if [
        "active",
        "running",
        "streaming",
        "tool",
        "thinking",
        "queued",
        "compacting",
        "verifying",
        "concluding",
        "cancelling",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
    {
        "running"
    } else {
        "idle"
    }
}

fn haider_bridge_canonical_path(path: &Path) -> Option<PathBuf> {
    path.canonicalize().ok()
}

fn haider_bridge_session_matches_dir(session: &HaiderBridgeSession, row: &SessionRow) -> bool {
    let Some(cwd) = session
        .cwd
        .as_deref()
        .and_then(haider_bridge_canonical_path)
    else {
        return false;
    };
    let directory = PathBuf::from(&row.dir);
    haider_bridge_canonical_path(&directory).is_some_and(|path| path == cwd)
        || haider_bridge_canonical_path(&directory.join("work")).is_some_and(|path| path == cwd)
}

fn haider_bridge_reconcile(sessions: &[HaiderBridgeSession]) -> Result<bool, String> {
    if sessions.is_empty() {
        return Ok(false);
    }
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    let mut connection = sessions_open_database()?;
    let query = format!("SELECT {SESSIONS_SELECT_COLUMNS} FROM sessions WHERE provider = 'haider'");
    let mut rows = {
        let mut statement = connection
            .prepare(&query)
            .map_err(|error| format!("Unable to prepare Haider reconciliation: {error}"))?;
        let decoded = statement
            .query_map([], sessions_sqlite_row)
            .map_err(|error| format!("Unable to query Haider sessions: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Unable to decode Haider session row: {error}"))?;
        decoded
    };
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Unable to begin Haider reconciliation: {error}"))?;
    let mut changed = false;

    for row in &mut rows {
        let matched = if row.provider_session_id.trim().is_empty() {
            sessions
                .iter()
                .find(|session| haider_bridge_session_matches_dir(session, row))
        } else {
            sessions
                .iter()
                .find(|session| session.id == row.provider_session_id)
        };
        let Some(session) = matched else {
            continue;
        };

        let mut row_changed = false;
        if row.provider_session_id.trim().is_empty() {
            row.provider_session_id = session.id.clone();
            row_changed = true;
        }
        if !row.title_locked
            && (row.first_user_message.trim().is_empty() || row.title == "New session")
            && session
                .title
                .as_ref()
                .is_some_and(|title| !title.is_empty())
            && session.title.as_deref() != Some(row.title.as_str())
        {
            row.title = session.title.clone().unwrap_or_default();
            row_changed = true;
        }
        let model = session.model.clone().unwrap_or_default();
        if row.model != model {
            row.model = model;
            row_changed = true;
        }
        let status = haider_bridge_store_status(session.state.as_deref());
        if row.status != status {
            row.status = status.to_string();
            row_changed = true;
        }
        if session
            .latest_at_ms
            .is_some_and(|latest_at_ms| latest_at_ms > row.latest_at_ms)
        {
            row.latest_at_ms = session.latest_at_ms.unwrap_or(row.latest_at_ms);
            row_changed = true;
        }
        if !row_changed {
            continue;
        }

        transaction
            .execute(
                "UPDATE sessions SET title = ?2, provider_session_id = ?3, latest_at_ms = ?4, status = ?5, model = ?6 WHERE id = ?1",
                rusqlite::params![
                    row.id,
                    row.title,
                    row.provider_session_id,
                    row.latest_at_ms,
                    row.status,
                    row.model,
                ],
            )
            .map_err(|error| format!("Unable to reconcile Haider session: {error}"))?;
        changed = true;
    }
    // Import daemon sessions the store doesn't know (created directly in the
    // haider CLI/TUI) so the home view can continue them. No directory is
    // known until the harness exposes cwd, so they land as pinned rows with
    // an empty dir and attach at the default working directory.
    let bound: std::collections::HashSet<&str> = rows
        .iter()
        .filter(|row| !row.provider_session_id.trim().is_empty())
        .map(|row| row.provider_session_id.as_str())
        .collect();
    for session in sessions {
        if session.id.trim().is_empty() || bound.contains(session.id.as_str()) {
            continue;
        }
        let now_ms = sessions_now_ms();
        let latest = session.latest_at_ms.unwrap_or(now_ms);
        let title = session
            .title
            .clone()
            .filter(|title| !title.trim().is_empty())
            .unwrap_or_else(|| "Haider session".to_string());
        let status = haider_bridge_store_status(session.state.as_deref());
        transaction
            .execute(
                "INSERT INTO sessions (
                    id, title, slug, dir, kind, provider, provider_session_id,
                    created_at_ms, latest_at_ms, status, first_user_message, model
                 ) VALUES (?1, ?2, '', '', 'pinned', 'haider', ?3, ?4, ?5, ?6, '', ?7)",
                rusqlite::params![
                    sessions_new_id(now_ms),
                    title,
                    session.id,
                    latest,
                    latest,
                    status,
                    session.model.clone().unwrap_or_default(),
                ],
            )
            .map_err(|error| format!("Unable to import Haider session: {error}"))?;
        changed = true;
    }
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit Haider reconciliation: {error}"))?;
    Ok(changed)
}

async fn haider_bridge_sync_once(app: &AppHandle) {
    let changed = tauri::async_runtime::spawn_blocking(|| {
        let Some(value) = haider_bridge_json_command("sessions") else {
            return Ok(false);
        };
        haider_bridge_collect_head_sequences(&value);
        let sessions = haider_bridge_parse_session_list(&value);
        haider_bridge_reconcile(&sessions)
    })
    .await;
    match changed {
        Ok(Ok(true)) => sessions_emit_changed(app),
        Ok(Ok(false)) => {}
        Ok(Err(error)) => eprintln!("Haider session reconciliation failed: {error}"),
        Err(error) => eprintln!("Haider session reconciliation worker failed: {error}"),
    }
}

fn haider_bridge_follow_once(events: tokio::sync::mpsc::UnboundedSender<()>) -> bool {
    let started_at = Instant::now();
    let mut child = match Command::new("haider")
        .args(["events", "--follow"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return false,
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return false;
    };
    let child = Arc::new(StdMutex::new(child));
    if let Ok(mut slot) = haider_bridge_child_slot().lock() {
        *slot = Some(child.clone());
    }
    let mut saw_event = false;
    for line in std::io::BufReader::new(stdout).lines() {
        if HAIDER_BRIDGE_STOPPING.load(Ordering::Acquire) {
            break;
        }
        let Ok(line) = line else {
            break;
        };
        if serde_json::from_str::<Value>(line.trim()).is_ok() {
            saw_event = true;
            let _ = events.send(());
        }
    }
    if let Ok(mut child) = child.lock() {
        if HAIDER_BRIDGE_STOPPING.load(Ordering::Acquire) {
            let _ = child.kill();
        }
        let _ = child.wait();
    }
    if let Ok(mut slot) = haider_bridge_child_slot().lock() {
        if slot
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &child))
        {
            *slot = None;
        }
    }
    saw_event || started_at.elapsed() >= HAIDER_BRIDGE_STABLE_FOLLOW
}

fn haider_bridge_stop() {
    HAIDER_BRIDGE_STOPPING.store(true, Ordering::Release);
    let child = haider_bridge_child_slot()
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().cloned());
    if let Some(child) = child {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    }
}

fn haider_bridge_start(app: AppHandle) {
    if HAIDER_BRIDGE_STARTED.swap(true, Ordering::AcqRel) {
        return;
    }
    HAIDER_BRIDGE_STOPPING.store(false, Ordering::Release);
    let (event_sender, mut event_receiver) = tokio::sync::mpsc::unbounded_channel();

    let sync_app = app.clone();
    tauri::async_runtime::spawn(async move {
        sleep(HAIDER_BRIDGE_INITIAL_SYNC_DELAY).await;
        if !HAIDER_BRIDGE_STOPPING.load(Ordering::Acquire) {
            haider_bridge_sync_once(&sync_app).await;
        }
    });

    let debounce_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while event_receiver.recv().await.is_some() {
            while timeout(HAIDER_BRIDGE_EVENT_DEBOUNCE, event_receiver.recv())
                .await
                .is_ok_and(|event| event.is_some())
            {}
            if HAIDER_BRIDGE_STOPPING.load(Ordering::Acquire) {
                return;
            }
            haider_bridge_sync_once(&debounce_app).await;
        }
    });

    tauri::async_runtime::spawn(async move {
        let mut backoff = HAIDER_BRIDGE_RETRY_MIN;
        while !HAIDER_BRIDGE_STOPPING.load(Ordering::Acquire) {
            let sender = event_sender.clone();
            let stable =
                tauri::async_runtime::spawn_blocking(move || haider_bridge_follow_once(sender))
                    .await
                    .unwrap_or(false);
            if HAIDER_BRIDGE_STOPPING.load(Ordering::Acquire) {
                return;
            }
            sleep(backoff).await;
            backoff = if stable {
                HAIDER_BRIDGE_RETRY_MIN
            } else {
                backoff.saturating_mul(2).min(HAIDER_BRIDGE_RETRY_MAX)
            };
        }
    });
}

#[tauri::command]
async fn haider_usage_snapshot() -> Value {
    tauri::async_runtime::spawn_blocking(|| haider_bridge_json_command("status"))
        .await
        .ok()
        .flatten()
        .unwrap_or(Value::Null)
}

#[cfg(test)]
mod haider_bridge_tests {
    use super::*;

    #[test]
    fn haider_bridge_maps_run_states_defensively() {
        for state in [
            "active_run",
            "running",
            "streaming",
            "running_tool",
            "tool-call",
        ] {
            assert_eq!(haider_bridge_store_status(Some(state)), "running");
        }
        for state in ["waiting", "input_required", "permission-required"] {
            assert_eq!(haider_bridge_store_status(Some(state)), "waiting");
        }
        for state in ["errored", "run_failed", "fatal"] {
            assert_eq!(haider_bridge_store_status(Some(state)), "error");
        }
        for state in ["idle", "paused", "closed", "future_unknown_state"] {
            assert_eq!(haider_bridge_store_status(Some(state)), "idle");
        }
        assert_eq!(haider_bridge_store_status(None), "idle");
    }

    #[test]
    fn haider_bridge_parses_observed_session_summary_shape() {
        // The live daemon was unavailable during capture. These keys come from
        // v0.0.925's SessionSummary/SessionFleetSnapshot wire metadata.
        let sample = json!({
            "sessions": [{
                "session_id": "sess_01JTEST",
                "title": "Review the parser",
                "workspace_cwd": "/tmp/diffforge-project/work",
                "run_state": { "status": "running_tool", "tool": "cargo" },
                "updated_at_ms": 1_777_777_777_123_i64,
                "head_seq": 42,
                "last_model": "test-model",
                "turn_count": 3,
                "footprint_tokens": 12_345,
                "footprint_truth": "metered",
                "agent_metrics": null,
                "unknown_future_field": { "safe": true }
            }]
        });
        assert_eq!(
            haider_bridge_parse_session_list(&sample),
            vec![HaiderBridgeSession {
                id: "sess_01JTEST".to_string(),
                title: Some("Review the parser".to_string()),
                model: Some("test-model".to_string()),
                cwd: Some(PathBuf::from("/tmp/diffforge-project/work")),
                state: Some("running_tool".to_string()),
                latest_at_ms: Some(1_777_777_777_123),
            }]
        );
    }

    #[test]
    fn haider_bridge_parses_keyed_sessions_and_numeric_activity() {
        let sample = json!({
            "result": {
                "sessions": {
                    "session-from-map-key": {
                        "metadata": { "name": "Nested session" },
                        "summary": {
                            "workspace_cwd": "/tmp/nested",
                            "updated_at": 1_776_582_489,
                            "model": "current-model"
                        },
                        "runtime": { "state": "input-required" }
                    }
                }
            }
        });
        let parsed = haider_bridge_parse_session_list(&sample);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "session-from-map-key");
        assert_eq!(parsed[0].title.as_deref(), Some("Nested session"));
        assert_eq!(parsed[0].model.as_deref(), Some("current-model"));
        assert_eq!(parsed[0].state.as_deref(), Some("input-required"));
        assert_eq!(parsed[0].latest_at_ms, Some(1_776_582_489_000));
    }
}

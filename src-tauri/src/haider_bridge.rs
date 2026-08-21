const HAIDER_BRIDGE_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const HAIDER_BRIDGE_INITIAL_SYNC_DELAY: Duration = Duration::from_secs(3);
const HAIDER_BRIDGE_FULL_RECONCILE_INTERVAL: Duration = Duration::from_secs(5 * 60);
const HAIDER_BRIDGE_WATCH_RECONCILE_INTERVAL: Duration = Duration::from_secs(30 * 60);
const HAIDER_BRIDGE_MAX_JSON_BYTES: u64 = 16 * 1024 * 1024;
const HAIDER_BRIDGE_GHOST_MAX_AGE_MS: i64 = 10 * 60 * 1_000;
const HAIDER_LIBRARY_CACHE_TTL: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, PartialEq, Eq)]
struct HaiderBridgeSession {
    id: String,
    title: Option<String>,
    model: Option<String>,
    provider: Option<String>,
    cwd: Option<PathBuf>,
    state_raw: Option<String>,
    effort: Option<String>,
    fast: Option<bool>,
    seen_at_ms: Option<i64>,
    last_activity_ms: Option<i64>,
    waiting_kind: Option<String>,
    waiting_menu_id: Option<String>,
    latest_at_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct HaiderBridgeReconcileStamp {
    head_seq: Option<i64>,
    state_raw: Option<String>,
    title: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    fast: Option<bool>,
    seen_at_ms: Option<i64>,
    last_activity_ms: Option<i64>,
    waiting_kind: Option<String>,
    waiting_menu_id: Option<String>,
}

impl HaiderBridgeReconcileStamp {
    fn new(session: &HaiderBridgeSession, head_seq: Option<i64>) -> Self {
        Self {
            head_seq,
            state_raw: session.state_raw.clone(),
            title: session.title.clone(),
            model: session.model.clone(),
            effort: session.effort.clone(),
            fast: session.fast,
            seen_at_ms: session.seen_at_ms,
            last_activity_ms: session.last_activity_ms,
            waiting_kind: session.waiting_kind.clone(),
            waiting_menu_id: session.waiting_menu_id.clone(),
        }
    }
}

#[derive(Default)]
struct HaiderBridgeReconcileTracker {
    initialized: bool,
    sessions: HashMap<String, HaiderBridgeReconcileStamp>,
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

fn haider_bridge_reconcile_tracker() -> &'static StdMutex<HaiderBridgeReconcileTracker> {
    static TRACKER: OnceLock<StdMutex<HaiderBridgeReconcileTracker>> = OnceLock::new();
    TRACKER.get_or_init(|| StdMutex::new(HaiderBridgeReconcileTracker::default()))
}

fn haider_library_cache() -> &'static StdMutex<Option<(Instant, Value)>> {
    static CACHE: OnceLock<StdMutex<Option<(Instant, Value)>>> = OnceLock::new();
    CACHE.get_or_init(|| StdMutex::new(None))
}

fn haider_bridge_sync_lock() -> &'static StdMutex<()> {
    static LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| StdMutex::new(()))
}

fn haider_bridge_json_args(args: &[&str]) -> Option<Value> {
    let mut child = Command::new("haider")
        .args(args)
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

fn haider_bridge_json_command(subcommand: &str) -> Option<Value> {
    haider_bridge_json_args(&[subcommand, "--json", "--no-spawn"])
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

fn haider_bridge_bool(value: &Value) -> Option<bool> {
    value.as_bool()
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

fn haider_bridge_state_raw(value: &Value) -> Option<String> {
    if let Some(text) = haider_bridge_text(value) {
        return Some(text);
    }
    let object = value.as_object()?;
    let mut state = None;
    for key in ["status", "state", "kind", "type", "name"] {
        if let Some(text) = object.get(key).and_then(haider_bridge_text) {
            state = Some(text);
            break;
        }
    }
    if let (Some(state), Some(tool)) = (
        state.as_deref(),
        object.get("tool").and_then(haider_bridge_text),
    ) {
        return Some(format!("{state}: {tool}"));
    }
    state.or_else(|| {
        (object.len() == 1)
            .then(|| object.keys().next().cloned())
            .flatten()
    })
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

fn haider_bridge_milliseconds(value: &Value) -> Option<i64> {
    let raw = match value {
        Value::Number(number) => number.as_u64(),
        Value::String(text) => text.trim().parse::<u64>().ok(),
        _ => None,
    }?;
    i64::try_from(raw).ok()
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
    let model_value = haider_bridge_object_value(
        object,
        &["model", "last_model"],
        &["summary", "metadata", "session"],
    );
    let model = model_value.and_then(haider_bridge_text).or_else(|| {
        model_value.and_then(Value::as_object).and_then(|model| {
            ["model", "id", "name"]
                .iter()
                .find_map(|key| model.get(*key).and_then(haider_bridge_text))
        })
    });
    let provider = haider_bridge_object_value(
        object,
        &["provider", "model_provider", "last_provider"],
        &["summary", "metadata", "session"],
    )
    .and_then(haider_bridge_text)
    .or_else(|| {
        model_value
            .and_then(Value::as_object)
            .and_then(|model| model.get("provider"))
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
    let run_state = haider_bridge_object_value(
        object,
        &["run_state", "runState"],
        &["runtime", "summary", "session"],
    );
    let state_raw = run_state
        .or_else(|| {
            haider_bridge_object_value(
                object,
                &[
                    "state_raw",
                    "stateRaw",
                    "state",
                    "status",
                    "session_state",
                    "sessionState",
                ],
                &["runtime", "summary", "session"],
            )
        })
        .and_then(haider_bridge_state_raw);
    let effort = haider_bridge_object_value(
        object,
        &["effort"],
        &["runtime", "summary", "metadata", "session"],
    )
    .and_then(haider_bridge_text);
    let fast = haider_bridge_object_value(
        object,
        &["fast"],
        &["runtime", "summary", "metadata", "session"],
    )
    .and_then(haider_bridge_bool);
    let seen_at_ms = haider_bridge_object_value(
        object,
        &["seen_at_ms", "seenAtMs"],
        &["runtime", "summary", "metadata", "session"],
    )
    .and_then(haider_bridge_milliseconds);
    let last_activity_ms = haider_bridge_object_value(
        object,
        &["last_activity_ms", "lastActivityMs"],
        &["runtime", "summary", "metadata", "session"],
    )
    .and_then(haider_bridge_milliseconds);
    let waiting_why = haider_bridge_object_value(
        object,
        &["waiting_why", "waitingWhy"],
        &["runtime", "summary", "metadata", "session"],
    )
    .and_then(Value::as_object);
    let waiting_kind = waiting_why
        .and_then(|waiting_why| waiting_why.get("kind"))
        .and_then(haider_bridge_text);
    let waiting_menu_id = waiting_why
        .and_then(|waiting_why| {
            waiting_why
                .get("pending_menu_id")
                .or_else(|| waiting_why.get("pendingMenuId"))
        })
        .and_then(haider_bridge_text);

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
    let has_lineage = haider_bridge_object_value(
        object,
        &["kind", "parent_session_id", "parentSessionId"],
        &["summary", "metadata", "session"],
    )
    .is_some();
    let has_session_shape = title.is_some()
        || model.is_some()
        || provider.is_some()
        || cwd.is_some()
        || state_raw.is_some()
        || effort.is_some()
        || fast.is_some()
        || seen_at_ms.is_some()
        || last_activity_ms.is_some()
        || waiting_kind.is_some()
        || waiting_menu_id.is_some()
        || latest_at_ms.is_some()
        || has_lineage
        || object.contains_key("head_seq")
        || object.contains_key("summary");
    has_session_shape.then_some(HaiderBridgeSession {
        id,
        title,
        model,
        provider,
        cwd,
        state_raw,
        effort,
        fast,
        seen_at_ms,
        last_activity_ms,
        waiting_kind,
        waiting_menu_id,
        latest_at_ms,
    })
}

fn haider_bridge_collect_head_sequences(
    value: &Value,
    inherited_id: Option<&str>,
    observed: &mut HashMap<String, i64>,
) {
    match value {
        Value::Array(values) => {
            if let [Value::String(id), session] = values.as_slice() {
                haider_bridge_collect_head_sequences(session, Some(id), observed);
            } else {
                for value in values {
                    haider_bridge_collect_head_sequences(value, inherited_id, observed);
                }
            }
        }
        Value::Object(object) => {
            let session_id = haider_bridge_object_value(
                object,
                &["session_id", "sessionId", "id"],
                &["session", "summary"],
            )
            .and_then(haider_bridge_text)
            .or_else(|| inherited_id.map(str::to_string));
            let head_seq = haider_bridge_object_value(
                object,
                &["head_seq", "headSeq"],
                &["session", "summary"],
            )
            .and_then(haider_bridge_sequence);
            if let (Some(session_id), Some(head_seq)) = (session_id, head_seq) {
                haider_bridge_note_head_seq(&session_id, head_seq);
                observed
                    .entry(session_id)
                    .and_modify(|head| *head = (*head).max(head_seq))
                    .or_insert(head_seq);
            }
            for key in ["sessions", "items", "entries"] {
                let Some(container) = object.get(key) else {
                    continue;
                };
                if let Value::Object(keyed_sessions) = container {
                    for (id, value) in keyed_sessions {
                        haider_bridge_collect_head_sequences(value, Some(id), observed);
                    }
                } else {
                    haider_bridge_collect_head_sequences(container, None, observed);
                }
            }
            for key in ["data", "result", "response", "body"] {
                if let Some(container) = object.get(key) {
                    haider_bridge_collect_head_sequences(container, None, observed);
                }
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
        if !haider_bridge_is_subagent_session(value, &session.id) {
            sessions.push(session);
        }
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

/// New harnesses describe lineage directly. A present typed kind wins over
/// the legacy id convention, while a non-empty parent is independently
/// sufficient to identify a child. Old summaries still use the daemon's
/// `session-child-…` marker.
fn haider_bridge_is_subagent_session(value: &Value, id: &str) -> bool {
    let Some(object) = value.as_object() else {
        return id.starts_with("session-child-");
    };
    let kind = haider_bridge_object_value(object, &["kind"], &["summary", "metadata", "session"])
        .and_then(Value::as_str)
        .map(str::trim);
    let parent_session_id = haider_bridge_object_value(
        object,
        &["parent_session_id", "parentSessionId"],
        &["summary", "metadata", "session"],
    )
    .and_then(Value::as_str)
    .map(str::trim)
    .filter(|parent| !parent.is_empty());

    match kind {
        Some(kind) => kind == "subagent" || parent_session_id.is_some(),
        None if parent_session_id.is_some() => true,
        None => id.starts_with("session-child-"),
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

fn haider_bridge_reconcile_store(
    roster: Option<&[HaiderBridgeSession]>,
    sessions: &[HaiderBridgeSession],
) -> Result<bool, String> {
    if roster.is_some_and(<[HaiderBridgeSession]>::is_empty)
        || (roster.is_none() && sessions.is_empty())
    {
        return Ok(false);
    }
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    let mut connection = sessions_open_database()?;
    let query = format!("SELECT {SESSIONS_SELECT_COLUMNS} FROM sessions WHERE provider = 'haider'");
    let rows = {
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

    let roster_ids = roster.map(|roster| {
        roster
            .iter()
            .map(|session| session.id.as_str())
            .collect::<HashSet<_>>()
    });
    let ghost_cutoff_ms = sessions_now_ms().saturating_sub(HAIDER_BRIDGE_GHOST_MAX_AGE_MS);
    let mut kept_rows = Vec::with_capacity(rows.len());
    for row in rows {
        let prune = roster.is_some_and(|roster| {
            let prune = if row.provider_session_id.trim().is_empty() {
                row.created_at_ms < ghost_cutoff_ms
                    && !roster
                        .iter()
                        .any(|session| haider_bridge_session_matches_dir(session, &row))
            } else {
                !roster_ids
                    .as_ref()
                    .is_some_and(|ids| ids.contains(row.provider_session_id.as_str()))
            };
            prune
        });
        if prune {
            // Reconcile only removes the rail row; session directories stay intact.
            transaction
                .execute("DELETE FROM sessions WHERE id = ?1", [&row.id])
                .map_err(|error| format!("Unable to prune stale Haider session: {error}"))?;
            changed = true;
        } else {
            kept_rows.push(row);
        }
    }
    let mut rows = kept_rows;

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
        if let Some(model) = session
            .model
            .clone()
            .or_else(|| roster.is_some().then(String::new))
        {
            if row.model != model {
                row.model = model;
                row_changed = true;
            }
        }
        if let Some(state_raw) = session
            .state_raw
            .clone()
            .or_else(|| roster.is_some().then(String::new))
        {
            let status = haider_bridge_store_status(Some(&state_raw));
            if row.status != status {
                row.status = status.to_string();
                row_changed = true;
            }
            if row.state_raw != state_raw {
                row.state_raw = state_raw;
                row_changed = true;
            }
        }
        if let Some(effort) = session.effort.clone() {
            if row.effort.as_deref() != Some(effort.as_str()) {
                row.effort = Some(effort);
                row_changed = true;
            }
        }
        if let Some(fast) = session.fast {
            let fast = i64::from(fast);
            if row.speed_fast != Some(fast) {
                row.speed_fast = Some(fast);
                row_changed = true;
            }
        }
        if row.seen_at_ms != session.seen_at_ms {
            row.seen_at_ms = session.seen_at_ms;
            row_changed = true;
        }
        if row.last_activity_ms != session.last_activity_ms {
            row.last_activity_ms = session.last_activity_ms;
            row_changed = true;
        }
        if row.waiting_kind != session.waiting_kind {
            row.waiting_kind = session.waiting_kind.clone();
            row_changed = true;
        }
        if row.waiting_menu_id != session.waiting_menu_id {
            row.waiting_menu_id = session.waiting_menu_id.clone();
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
                "UPDATE sessions SET title = ?2, provider_session_id = ?3, latest_at_ms = ?4, status = ?5, state_raw = ?6, model = ?7, effort = ?8, speed_fast = ?9, seen_at_ms = ?10, last_activity_ms = ?11, waiting_kind = ?12, waiting_menu_id = ?13 WHERE id = ?1",
                rusqlite::params![
                    row.id,
                    row.title,
                    row.provider_session_id,
                    row.latest_at_ms,
                    row.status,
                    row.state_raw,
                    row.model,
                    row.effort,
                    row.speed_fast,
                    row.seen_at_ms,
                    row.last_activity_ms,
                    row.waiting_kind,
                    row.waiting_menu_id,
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
    for session in roster.unwrap_or(sessions) {
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
        let state_raw = session.state_raw.clone().unwrap_or_default();
        let status = haider_bridge_store_status(Some(&state_raw));
        transaction
            .execute(
                "INSERT INTO sessions (
                    id, title, slug, dir, kind, provider, provider_session_id,
                    created_at_ms, latest_at_ms, status, state_raw,
                    first_user_message, model, effort, speed_fast, seen_at_ms,
                    last_activity_ms, waiting_kind, waiting_menu_id
                 ) VALUES (?1, ?2, '', '', 'pinned', 'haider', ?3, ?4, ?5, ?6, ?7, '', ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                rusqlite::params![
                    sessions_new_id(now_ms),
                    title,
                    session.id,
                    latest,
                    latest,
                    status,
                    state_raw,
                    session.model.clone().unwrap_or_default(),
                    session.effort.clone(),
                    session.fast.map(i64::from),
                    session.seen_at_ms,
                    session.last_activity_ms,
                    session.waiting_kind.clone(),
                    session.waiting_menu_id.clone(),
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

fn haider_bridge_reconcile_tracked(
    tracker: &mut HaiderBridgeReconcileTracker,
    sessions: &[HaiderBridgeSession],
    head_sequences: &HashMap<String, i64>,
    complete: bool,
    reconcile: impl FnOnce(
        Option<&[HaiderBridgeSession]>,
        &[HaiderBridgeSession],
    ) -> Result<bool, String>,
) -> Result<bool, String> {
    let mut snapshot = sessions
        .iter()
        .map(|session| {
            (
                session.id.clone(),
                HaiderBridgeReconcileStamp::new(session, head_sequences.get(&session.id).copied()),
            )
        })
        .collect::<HashMap<_, _>>();
    if !complete && tracker.initialized {
        snapshot.retain(|session_id, incoming| {
            !incoming
                .head_seq
                .zip(
                    tracker
                        .sessions
                        .get(session_id)
                        .and_then(|previous| previous.head_seq),
                )
                .is_some_and(|(incoming, previous)| incoming < previous)
        });
    }
    let roster_changed = complete
        && tracker.initialized
        && (snapshot.len() != tracker.sessions.len()
            || snapshot
                .keys()
                .any(|session_id| !tracker.sessions.contains_key(session_id)));
    let observed_at_ms = sessions_now_ms();
    let candidates = if tracker.initialized {
        sessions
            .iter()
            .filter_map(|session| {
                (snapshot.contains_key(&session.id)
                    && (!head_sequences.contains_key(&session.id)
                        || snapshot.get(&session.id) != tracker.sessions.get(&session.id)))
                .then(|| {
                    let mut session = session.clone();
                    let head_advanced = snapshot
                        .get(&session.id)
                        .and_then(|stamp| stamp.head_seq)
                        .zip(
                            tracker
                                .sessions
                                .get(&session.id)
                                .and_then(|stamp| stamp.head_seq),
                        )
                        .is_some_and(|(incoming, previous)| incoming > previous);
                    if !complete && head_advanced && session.latest_at_ms.is_none() {
                        session.latest_at_ms = Some(observed_at_ms);
                    }
                    session
                })
            })
            .collect::<Vec<_>>()
    } else {
        sessions.to_vec()
    };
    if candidates.is_empty() && !roster_changed {
        tracker.initialized = true;
        if complete {
            tracker.sessions = snapshot;
        } else {
            tracker.sessions.extend(snapshot);
        }
        return Ok(false);
    }
    let changed = reconcile(complete.then_some(sessions), &candidates)?;
    tracker.initialized = true;
    if complete {
        tracker.sessions = snapshot;
    } else {
        tracker.sessions.extend(snapshot);
    }
    Ok(changed)
}

#[cfg(test)]
fn haider_bridge_reconcile(sessions: &[HaiderBridgeSession]) -> Result<bool, String> {
    haider_bridge_reconcile_store(Some(sessions), sessions)
}

fn haider_bridge_reconcile_summary_values_tracked(
    tracker: &mut HaiderBridgeReconcileTracker,
    summaries: Vec<Value>,
    complete: bool,
    reconcile: impl FnOnce(
        Option<&[HaiderBridgeSession]>,
        &[HaiderBridgeSession],
    ) -> Result<bool, String>,
) -> Result<bool, String> {
    let value = Value::Array(summaries);
    let mut head_sequences = HashMap::new();
    haider_bridge_collect_head_sequences(&value, None, &mut head_sequences);
    let sessions = haider_bridge_parse_session_list(&value);
    haider_bridge_reconcile_tracked(tracker, &sessions, &head_sequences, complete, reconcile)
}

fn haider_bridge_reconcile_summary_values_prefold(
    tracker: &mut HaiderBridgeReconcileTracker,
    summaries: Vec<Value>,
    complete: bool,
    reconcile: impl FnOnce(
        Option<&[HaiderBridgeSession]>,
        &[HaiderBridgeSession],
    ) -> Result<bool, String>,
    mut enqueue: impl FnMut(Vec<String>),
) -> Result<bool, String> {
    let mut prefold = Vec::new();
    let changed = haider_bridge_reconcile_summary_values_tracked(
        tracker,
        summaries,
        complete,
        |roster, candidates| {
            let changed = reconcile(roster, candidates)?;
            prefold.extend(candidates.iter().map(|session| session.id.clone()));
            Ok(changed)
        },
    )?;
    if !prefold.is_empty() {
        enqueue(prefold);
    }
    Ok(changed)
}

fn haider_bridge_reconcile_summary_values(
    summaries: Vec<Value>,
    complete: bool,
) -> Result<bool, String> {
    let mut tracker = haider_bridge_reconcile_tracker()
        .lock()
        .map_err(|_| "Haider reconciliation tracker is unavailable.".to_string())?;
    haider_bridge_reconcile_summary_values_prefold(
        &mut tracker,
        summaries,
        complete,
        haider_bridge_reconcile_store,
        haider_projection_prefold_enqueue_provider_sessions,
    )
}

fn haider_bridge_reconcile_from_summaries(app: AppHandle, summaries: Vec<Value>) {
    tauri::async_runtime::spawn(async move {
        let changed = tauri::async_runtime::spawn_blocking(move || {
            let _sync_guard = haider_bridge_sync_lock()
                .lock()
                .map_err(|_| "Haider bridge sync lock is unavailable.".to_string())?;
            haider_bridge_reconcile_summary_values(summaries, false)
        })
        .await;
        match changed {
            Ok(Ok(true)) => sessions_emit_changed(&app),
            Ok(Ok(false)) => {}
            Ok(Err(error)) => eprintln!("Haider session reconciliation failed: {error}"),
            Err(error) => eprintln!("Haider session reconciliation worker failed: {error}"),
        }
    });
}

async fn haider_bridge_sync_once(app: &AppHandle) {
    let changed = tauri::async_runtime::spawn_blocking(|| {
        let _sync_guard = haider_bridge_sync_lock()
            .lock()
            .map_err(|_| "Haider bridge sync lock is unavailable.".to_string())?;
        let Some(value) = haider_bridge_json_command("sessions") else {
            return Ok(false);
        };
        haider_bridge_reconcile_summary_values(vec![value], true)
    })
    .await;
    match changed {
        Ok(Ok(true)) => sessions_emit_changed(app),
        Ok(Ok(false)) => {}
        Ok(Err(error)) => eprintln!("Haider session reconciliation failed: {error}"),
        Err(error) => eprintln!("Haider session reconciliation worker failed: {error}"),
    }
}

fn haider_bridge_stop() {
    HAIDER_BRIDGE_STOPPING.store(true, Ordering::Release);
}

fn haider_bridge_full_reconcile_interval(roster_watch_healthy: bool) -> Duration {
    if roster_watch_healthy {
        HAIDER_BRIDGE_WATCH_RECONCILE_INTERVAL
    } else {
        HAIDER_BRIDGE_FULL_RECONCILE_INTERVAL
    }
}

fn haider_bridge_start(app: AppHandle) {
    if HAIDER_BRIDGE_STARTED.swap(true, Ordering::AcqRel) {
        return;
    }
    HAIDER_BRIDGE_STOPPING.store(false, Ordering::Release);
    if let Ok(mut tracker) = haider_bridge_reconcile_tracker().lock() {
        *tracker = HaiderBridgeReconcileTracker::default();
    }
    haider_rpc_ade::roster_watch_start(app.clone());

    let sync_app = app.clone();
    tauri::async_runtime::spawn(async move {
        sleep(HAIDER_BRIDGE_INITIAL_SYNC_DELAY).await;
        while !HAIDER_BRIDGE_STOPPING.load(Ordering::Acquire) {
            haider_bridge_sync_once(&sync_app).await;
            sleep(haider_bridge_full_reconcile_interval(
                haider_rpc_ade::roster_watch_healthy(),
            ))
            .await;
        }
    });
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct HaiderLibraryModel {
    model: String,
    provider: String,
    available: bool,
    auth_state: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct HaiderLibraryAccount {
    alias: String,
    provider: String,
}

fn haider_library_observed_models(value: &Value) -> Vec<HaiderLibraryModel> {
    let mut models = haider_bridge_parse_session_list(value)
        .into_iter()
        .filter_map(|session| {
            Some(HaiderLibraryModel {
                model: session.model?.trim().to_string(),
                provider: session.provider.unwrap_or_default().trim().to_string(),
                available: true,
                auth_state: None,
            })
        })
        .filter(|entry| !entry.model.is_empty())
        .collect::<Vec<_>>();
    models.sort_by(|left, right| {
        left.model
            .cmp(&right.model)
            .then_with(|| left.provider.cmp(&right.provider))
    });
    models.dedup();
    models
}

fn haider_library_catalog_models(value: &Value) -> Option<Vec<HaiderLibraryModel>> {
    let providers = value.get("providers")?.as_array()?;
    let mut flattened = Vec::new();
    for provider in providers {
        let Some(provider) = provider.as_object() else {
            continue;
        };
        let provider_id = provider
            .get("provider")
            .and_then(haider_bridge_text)
            .unwrap_or_default();
        let available = provider
            .get("availability")
            .and_then(Value::as_str)
            .is_some_and(|availability| availability.trim() == "available")
            || provider
                .get("has_credential")
                .and_then(Value::as_bool)
                .unwrap_or(false);
        let auth_state = provider.get("auth_state").and_then(haider_bridge_text);
        let Some(models) = provider.get("models").and_then(Value::as_array) else {
            continue;
        };
        for model in models {
            let model = haider_bridge_text(model).or_else(|| {
                let model = model.as_object()?;
                ["model", "id", "name"]
                    .iter()
                    .find_map(|key| model.get(*key).and_then(haider_bridge_text))
            });
            let Some(model) = model else {
                continue;
            };
            flattened.push(HaiderLibraryModel {
                model,
                provider: provider_id.clone(),
                available,
                auth_state: auth_state.clone(),
            });
        }
    }
    Some(flattened)
}

fn haider_library_catalog_accounts(value: &Value) -> Vec<String> {
    let mut aliases = HashSet::new();
    value
        .get("providers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .filter(|provider| {
            provider
                .get("has_credential")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .filter_map(|provider| {
            let alias = ["account_alias", "alias"]
                .iter()
                .find_map(|key| provider.get(*key).and_then(haider_bridge_text))?;
            aliases.insert(alias.clone()).then_some(alias)
        })
        .collect()
}

fn haider_library_status_has_session_config(value: &Value) -> bool {
    fn matches(value: &Value) -> bool {
        match value {
            Value::String(feature) => feature.trim() == "session_config_v1",
            Value::Array(features) => features.iter().any(matches),
            Value::Object(features) => features.iter().any(|(feature, enabled)| {
                feature.trim() == "session_config_v1" && enabled.as_bool().unwrap_or(true)
            }),
            _ => false,
        }
    }

    value
        .as_object()
        .and_then(|status| status.get("features"))
        .is_some_and(matches)
}

fn haider_library_account(value: &Value) -> Option<HaiderLibraryAccount> {
    fn visit(value: &Value, active_only: bool) -> Option<HaiderLibraryAccount> {
        match value {
            Value::Object(object) => {
                let active = object.get("active").and_then(Value::as_bool);
                let alias = ["alias", "account_alias"]
                    .iter()
                    .find_map(|key| object.get(*key).and_then(haider_bridge_text));
                let provider = ["provider", "provider_id"]
                    .iter()
                    .find_map(|key| object.get(*key).and_then(haider_bridge_text));
                if (!active_only || active == Some(true)) && alias.is_some() && provider.is_some() {
                    return Some(HaiderLibraryAccount {
                        alias: alias.unwrap_or_default(),
                        provider: provider.unwrap_or_default(),
                    });
                }
                object.values().find_map(|value| visit(value, active_only))
            }
            Value::Array(values) => values.iter().find_map(|value| visit(value, active_only)),
            _ => None,
        }
    }

    visit(value, true).or_else(|| visit(value, false))
}

fn haider_library_snapshot_blocking() -> Value {
    if let Ok(cache) = haider_library_cache().lock() {
        if let Some((cached_at, snapshot)) = cache.as_ref() {
            if cached_at.elapsed() < HAIDER_LIBRARY_CACHE_TTL {
                return snapshot.clone();
            }
        }
    }

    let catalog = haider_bridge_json_args(&["models", "--json"]);
    let sessions = catalog
        .is_none()
        .then(|| haider_bridge_json_command("sessions").unwrap_or(Value::Null));
    let status = haider_bridge_json_command("status").unwrap_or(Value::Null);
    let models = catalog
        .as_ref()
        .and_then(haider_library_catalog_models)
        .unwrap_or_else(|| {
            haider_library_observed_models(sessions.as_ref().unwrap_or(&Value::Null))
        });
    let accounts = catalog
        .as_ref()
        .map(haider_library_catalog_accounts)
        .unwrap_or_default();
    let session_config = haider_library_status_has_session_config(&status);
    let snapshot = json!({
        "version": 2,
        "models": models,
        "account": haider_library_account(&status),
        "accounts": accounts,
        "efforts": ["default", "low", "medium", "high", "xhigh"],
        "speeds": ["default", "fast"],
        "capabilities": {
            "model_switch": session_config,
            "effort_switch": session_config,
            "speed_switch": session_config,
            "account_switch": session_config,
        },
    });
    if let Ok(mut cache) = haider_library_cache().lock() {
        *cache = Some((Instant::now(), snapshot.clone()));
    }
    snapshot
}

#[tauri::command(rename_all = "snake_case")]
async fn haider_library_snapshot() -> Value {
    tauri::async_runtime::spawn_blocking(haider_library_snapshot_blocking)
        .await
        .unwrap_or(Value::Null)
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
        assert_eq!(
            haider_bridge_state_raw(&json!({
                "status": "running_tool",
                "tool": "cargo"
            }))
            .as_deref(),
            Some("running_tool: cargo")
        );
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
                provider: None,
                cwd: Some(PathBuf::from("/tmp/diffforge-project/work")),
                state_raw: Some("running_tool: cargo".to_string()),
                effort: None,
                fast: None,
                seen_at_ms: None,
                last_activity_ms: None,
                waiting_kind: None,
                waiting_menu_id: None,
                latest_at_ms: Some(1_777_777_777_123),
            }]
        );
    }

    #[test]
    fn haider_bridge_extracts_roster_scalars_without_storing_account_alias() {
        let with_scalars = json!({
            "session_id": "session-935",
            "run_state": "running",
            "state_raw": "idle",
            "effort": "xhigh",
            "fast": true,
            "seen_at_ms": 1_234_i64,
            "last_activity_ms": "2345",
            "waiting_why": {
                "kind": "permission",
                "pending_menu_id": "menu-935"
            },
            "account_alias": null
        });
        let parsed = haider_bridge_parse_session(&with_scalars, None).unwrap();
        assert_eq!(parsed.state_raw.as_deref(), Some("running"));
        assert_eq!(parsed.effort.as_deref(), Some("xhigh"));
        assert_eq!(parsed.fast, Some(true));
        assert_eq!(parsed.seen_at_ms, Some(1_234));
        assert_eq!(parsed.last_activity_ms, Some(2_345));
        assert_eq!(parsed.waiting_kind.as_deref(), Some("permission"));
        assert_eq!(parsed.waiting_menu_id.as_deref(), Some("menu-935"));

        let without_scalars = haider_bridge_parse_session(
            &json!({"session_id":"session-934", "state_raw":"idle"}),
            None,
        )
        .unwrap();
        assert_eq!(without_scalars.effort, None);
        assert_eq!(without_scalars.fast, None);
        assert_eq!(without_scalars.seen_at_ms, None);
        assert_eq!(without_scalars.last_activity_ms, None);
        assert_eq!(without_scalars.waiting_kind, None);
        assert_eq!(without_scalars.waiting_menu_id, None);
    }

    #[test]
    fn haider_bridge_reconcile_stamp_tracks_effort_and_fast_changes() {
        let session = HaiderBridgeSession {
            id: "session-stamp".to_string(),
            title: None,
            model: None,
            provider: None,
            cwd: None,
            state_raw: None,
            effort: Some("medium".to_string()),
            fast: Some(false),
            seen_at_ms: None,
            last_activity_ms: None,
            waiting_kind: None,
            waiting_menu_id: None,
            latest_at_ms: None,
        };
        let baseline = HaiderBridgeReconcileStamp::new(&session, Some(4));
        let mut effort_changed = session.clone();
        effort_changed.effort = Some("high".to_string());
        assert_ne!(
            baseline,
            HaiderBridgeReconcileStamp::new(&effort_changed, Some(4))
        );
        let mut fast_changed = session;
        fast_changed.fast = Some(true);
        assert_ne!(
            baseline,
            HaiderBridgeReconcileStamp::new(&fast_changed, Some(4))
        );
        let mut attention_changed = fast_changed;
        attention_changed.seen_at_ms = Some(50);
        assert_ne!(
            baseline,
            HaiderBridgeReconcileStamp::new(&attention_changed, Some(4))
        );
    }

    #[test]
    fn haider_bridge_reconcile_interval_follows_roster_watch_health() {
        assert_eq!(
            haider_bridge_full_reconcile_interval(false),
            HAIDER_BRIDGE_FULL_RECONCILE_INTERVAL
        );
        assert_eq!(
            haider_bridge_full_reconcile_interval(true),
            HAIDER_BRIDGE_WATCH_RECONCILE_INTERVAL
        );
    }

    #[test]
    fn haider_bridge_subagent_sessions_never_reach_the_rail() {
        let sample = json!({
            "sessions": [
                {"id": "session-abc123", "title": "Real work", "updated_at": 5_i64},
                {"id": "session-child-deadbeef", "title": "Delegated task: pick", "updated_at": 6_i64},
            ]
        });
        let parsed = haider_bridge_parse_session_list(&sample);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "session-abc123");
        // Excluded from the parsed roster ⇒ the roster-absence prune removes
        // any child row an older build already imported.
        assert!(haider_bridge_is_subagent_session(
            &json!({}),
            "session-child-deadbeef"
        ));
        assert!(!haider_bridge_is_subagent_session(
            &json!({}),
            "session-abc123"
        ));
    }

    #[test]
    fn haider_bridge_typed_lineage_wins_over_prefix_fallback() {
        let sample = json!({
            "sessions": [
                {
                    "id": "session-child-direct",
                    "kind": "direct",
                    "title": "Typed direct session"
                },
                {
                    "id": "session-ordinary-subagent",
                    "kind": "subagent",
                    "title": "Typed child session"
                }
            ]
        });
        let parsed = haider_bridge_parse_session_list(&sample);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "session-child-direct");
    }

    #[test]
    fn haider_bridge_parent_only_lineage_marks_subagent() {
        let sample = json!({
            "sessions": [{
                "id": "session-no-child-prefix",
                "parent_session_id": "session-parent",
                "title": "Child by parent"
            }]
        });
        assert!(haider_bridge_parse_session_list(&sample).is_empty());
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
                            "model": "current-model",
                            "head_seq": 12
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
        assert_eq!(parsed[0].state_raw.as_deref(), Some("input-required"));
        assert_eq!(parsed[0].latest_at_ms, Some(1_776_582_489_000));
        let mut heads = HashMap::new();
        haider_bridge_collect_head_sequences(&sample, None, &mut heads);
        assert_eq!(heads.get("session-from-map-key"), Some(&12));
    }

    #[test]
    fn haider_bridge_unchanged_head_skips_store_reconcile() {
        let session = HaiderBridgeSession {
            id: "session-test".to_string(),
            title: Some("Test".to_string()),
            model: Some("model".to_string()),
            provider: Some("openai".to_string()),
            cwd: None,
            state_raw: Some("idle".to_string()),
            effort: None,
            fast: None,
            seen_at_ms: None,
            last_activity_ms: None,
            waiting_kind: None,
            waiting_menu_id: None,
            latest_at_ms: Some(100),
        };
        let mut tracker = HaiderBridgeReconcileTracker::default();
        let mut heads = HashMap::from([(session.id.clone(), 7)]);
        let writes = std::cell::Cell::new(0);
        let mut reconcile = |_: Option<&[HaiderBridgeSession]>, _: &[HaiderBridgeSession]| {
            writes.set(writes.get() + 1);
            Ok(false)
        };

        assert!(!haider_bridge_reconcile_tracked(
            &mut tracker,
            std::slice::from_ref(&session),
            &heads,
            true,
            &mut reconcile,
        )
        .unwrap());
        assert_eq!(writes.get(), 1);
        assert!(!haider_bridge_reconcile_tracked(
            &mut tracker,
            std::slice::from_ref(&session),
            &heads,
            true,
            &mut reconcile,
        )
        .unwrap());
        assert_eq!(writes.get(), 1);

        heads.insert(session.id.clone(), 8);
        haider_bridge_reconcile_tracked(
            &mut tracker,
            std::slice::from_ref(&session),
            &heads,
            true,
            &mut reconcile,
        )
        .unwrap();
        assert_eq!(writes.get(), 2);

        let mut raw_changed = session.clone();
        raw_changed.state_raw = Some("running_tool: cargo".to_string());
        haider_bridge_reconcile_tracked(
            &mut tracker,
            std::slice::from_ref(&raw_changed),
            &heads,
            true,
            &mut reconcile,
        )
        .unwrap();
        assert_eq!(writes.get(), 3);

        heads.clear();
        for _ in 0..2 {
            haider_bridge_reconcile_tracked(
                &mut tracker,
                std::slice::from_ref(&raw_changed),
                &heads,
                true,
                &mut reconcile,
            )
            .unwrap();
        }
        assert_eq!(writes.get(), 5);
    }

    #[test]
    fn haider_bridge_push_and_full_summaries_share_apply_and_skip_logic() {
        let mut full_tracker = HaiderBridgeReconcileTracker::default();
        let mut push_tracker = HaiderBridgeReconcileTracker::default();
        let full_calls = std::cell::RefCell::new(Vec::new());
        let push_calls = std::cell::RefCell::new(Vec::new());

        for head_seq in [4, 4, 5] {
            let full = json!({
                "sessions": [{
                    "session_id":"session-shared",
                    "head_seq":head_seq,
                    "title":"Shared",
                    "model":"model",
                    "state":"idle",
                    "updated_at_ms":100
                }]
            });
            let push = json!({
                "session_id":"session-shared",
                "head_seq":head_seq,
                "title":"Shared",
                "last_model":"model"
            });
            haider_bridge_reconcile_summary_values_tracked(
                &mut full_tracker,
                vec![full],
                true,
                |_, candidates| {
                    full_calls.borrow_mut().push(
                        candidates
                            .iter()
                            .map(|session| session.id.clone())
                            .collect::<Vec<_>>(),
                    );
                    Ok(false)
                },
            )
            .unwrap();
            haider_bridge_reconcile_summary_values_tracked(
                &mut push_tracker,
                vec![push],
                false,
                |_, candidates| {
                    push_calls.borrow_mut().push(
                        candidates
                            .iter()
                            .map(|session| (session.id.clone(), session.latest_at_ms))
                            .collect::<Vec<_>>(),
                    );
                    Ok(false)
                },
            )
            .unwrap();
        }
        haider_bridge_reconcile_summary_values_tracked(
            &mut push_tracker,
            vec![json!({
                "session_id":"session-shared",
                "head_seq":3,
                "title":"stale title",
                "last_model":"stale-model"
            })],
            false,
            |_, candidates| {
                push_calls.borrow_mut().push(
                    candidates
                        .iter()
                        .map(|session| (session.id.clone(), session.latest_at_ms))
                        .collect::<Vec<_>>(),
                );
                Ok(false)
            },
        )
        .unwrap();

        assert_eq!(
            full_calls.borrow().as_slice(),
            &[
                vec!["session-shared".to_string()],
                vec!["session-shared".to_string()]
            ]
        );
        let push_calls = push_calls.borrow();
        assert_eq!(push_calls.len(), 2);
        assert_eq!(push_calls[0][0].0, "session-shared");
        assert!(push_calls[0][0].1.is_none());
        assert!(push_calls[1][0].1.is_some());
        assert_eq!(push_tracker.sessions["session-shared"].head_seq, Some(5));
    }

    #[test]
    fn haider_bridge_reconcile_enqueues_changed_sessions_deduped() {
        let mut tracker = HaiderBridgeReconcileTracker::default();
        let enqueued = std::cell::RefCell::new(Vec::new());
        let initial = json!({
            "sessions": [
                {"session_id":"a", "head_seq":1},
                {"session_id":"a", "head_seq":1},
                {"session_id":"b", "head_seq":1},
                {"session_id":"c", "head_seq":1}
            ]
        });
        haider_bridge_reconcile_summary_values_prefold(
            &mut tracker,
            vec![initial.clone()],
            true,
            |_, _| Ok(true),
            |sessions| enqueued.borrow_mut().push(sessions),
        )
        .unwrap();
        haider_bridge_reconcile_summary_values_prefold(
            &mut tracker,
            vec![initial],
            true,
            |_, _| Ok(false),
            |sessions| enqueued.borrow_mut().push(sessions),
        )
        .unwrap();
        haider_bridge_reconcile_summary_values_prefold(
            &mut tracker,
            vec![json!({
                "sessions": [
                    {"session_id":"a", "head_seq":2},
                    {"session_id":"c", "head_seq":2}
                ]
            })],
            false,
            |_, _| Ok(true),
            |sessions| enqueued.borrow_mut().push(sessions),
        )
        .unwrap();

        assert_eq!(
            enqueued.into_inner(),
            vec![
                vec!["a".to_string(), "b".to_string(), "c".to_string()],
                vec!["a".to_string(), "c".to_string()]
            ]
        );
    }

    #[test]
    fn haider_library_observed_models_are_sorted_and_deduplicated() {
        let sample = json!({
            "sessions": [
                {"id":"3", "model":"zeta", "provider":"openai", "head_seq":3},
                {"id":"1", "model":"alpha", "provider":"anthropic", "head_seq":1},
                {"id":"2", "last_model":{"model":"alpha", "provider":"anthropic"}, "head_seq":2},
                {"id":"4", "model":"alpha", "provider":"openai", "head_seq":4}
            ]
        });
        assert_eq!(
            haider_library_observed_models(&sample),
            vec![
                HaiderLibraryModel {
                    model: "alpha".to_string(),
                    provider: "anthropic".to_string(),
                    available: true,
                    auth_state: None,
                },
                HaiderLibraryModel {
                    model: "alpha".to_string(),
                    provider: "openai".to_string(),
                    available: true,
                    auth_state: None,
                },
                HaiderLibraryModel {
                    model: "zeta".to_string(),
                    provider: "openai".to_string(),
                    available: true,
                    auth_state: None,
                },
            ]
        );
    }

    #[test]
    fn haider_library_catalog_flattens_models_in_provider_order() {
        let sample = json!({
            "schema": "haider.models.v1",
            "providers": [
                {
                    "provider": "anthropic",
                    "availability": "unavailable",
                    "auth_state": "missing",
                    "has_credential": false,
                    "models": ["claude-a", "claude-b"]
                },
                {
                    "provider": "openai",
                    "availability": "unavailable",
                    "auth_state": "authenticated",
                    "has_credential": true,
                    "account_alias": "work",
                    "models": ["gpt-z"]
                },
                {
                    "provider": "local",
                    "availability": "available",
                    "auth_state": "not_required",
                    "has_credential": false,
                    "account_alias": "ignored-without-credential",
                    "models": [{"model": "local-model"}]
                }
            ]
        });
        assert_eq!(
            haider_library_catalog_models(&sample).unwrap(),
            vec![
                HaiderLibraryModel {
                    model: "claude-a".to_string(),
                    provider: "anthropic".to_string(),
                    available: false,
                    auth_state: Some("missing".to_string()),
                },
                HaiderLibraryModel {
                    model: "claude-b".to_string(),
                    provider: "anthropic".to_string(),
                    available: false,
                    auth_state: Some("missing".to_string()),
                },
                HaiderLibraryModel {
                    model: "gpt-z".to_string(),
                    provider: "openai".to_string(),
                    available: true,
                    auth_state: Some("authenticated".to_string()),
                },
                HaiderLibraryModel {
                    model: "local-model".to_string(),
                    provider: "local".to_string(),
                    available: true,
                    auth_state: Some("not_required".to_string()),
                },
            ]
        );
        assert_eq!(
            haider_library_catalog_accounts(&sample),
            vec!["work".to_string()]
        );
    }

    #[test]
    fn haider_library_capabilities_follow_session_config_feature() {
        assert!(haider_library_status_has_session_config(&json!({
            "features": ["session_observe_v1", "session_config_v1"]
        })));
        assert!(haider_library_status_has_session_config(&json!({
            "features": {"session_config_v1": true}
        })));
        assert!(!haider_library_status_has_session_config(&json!({
            "features": ["session_observe_v1", "models_list_v1"]
        })));
        assert!(!haider_library_status_has_session_config(&json!({
            "features": {"session_config_v1": false}
        })));
    }
}

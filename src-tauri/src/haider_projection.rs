// Render projection for Haider-backed session views. This file is include!d
// into lib.rs so it intentionally reuses the sessions database, write lock,
// clock, status reducer, and Tauri imports from the crate root.

const HAIDER_PROJECTION_EXPORT_TIMEOUT: Duration = Duration::from_secs(10);
const HAIDER_PROJECTION_MAX_EXPORT_BYTES: u64 = 32 * 1024 * 1024;
const HAIDER_PROJECTION_MAX_LINE_BYTES: usize = 2 * 1024 * 1024;
const HAIDER_PROJECTION_MAX_WINDOW_ROWS: i64 = 1_000;
const HAIDER_PROJECTION_WATCH_LIMIT: usize = 6;
const HAIDER_PROJECTION_SCHEMA_VERSION: i64 = 2;
const HAIDER_PROJECTION_PIPE_BATCH_LINES: usize = 256;
const HAIDER_PROJECTION_PIPE_SAFETY_POLL: Duration = Duration::from_secs(2);
const HAIDER_PROJECTION_PIPE_STOP_POLL: Duration = Duration::from_millis(100);
const HAIDER_PROJECTION_RPC_TIMEOUT: Duration = Duration::from_secs(2);
const HAIDER_PROJECTION_FRAME_TIME: Duration = Duration::from_millis(50);
const HAIDER_PROJECTION_ROWS_EVENT: &str = "session-rows-appended";

#[derive(Clone, Debug, PartialEq, Serialize)]
struct SessionProjectionRow {
    #[serde(skip_serializing)]
    session_id: String,
    seq: i64,
    ordinal: i64,
    branch_id: String,
    kind: String,
    role: String,
    text: String,
    meta: Value,
    at_ms: i64,
}

#[derive(Debug, Serialize)]
struct SessionProjectionWindow {
    total_rows: i64,
    start_index: i64,
    rows: Vec<SessionProjectionRow>,
    live_tail: Option<SessionProjectionRow>,
    covered_through_seq: Option<i64>,
    head_seq: Option<i64>,
    caught_up: bool,
}

#[derive(Clone, Debug)]
struct HaiderProjectionTail {
    item_id: String,
    row: SessionProjectionRow,
}

#[derive(Debug)]
struct HaiderProjectionFoldState {
    next_fallback_seq: i64,
    total_rows: i64,
    tail: Option<HaiderProjectionTail>,
    metadata: serde_json::Map<String, Value>,
    effect_summaries: HashMap<String, String>,
    seen_sequences: HashSet<(i64, i64)>,
    pipe_eof_max_seq: Option<i64>,
}

impl Default for HaiderProjectionFoldState {
    fn default() -> Self {
        Self {
            next_fallback_seq: 1,
            total_rows: 0,
            tail: None,
            metadata: serde_json::Map::new(),
            effect_summaries: HashMap::new(),
            seen_sequences: HashSet::new(),
            pipe_eof_max_seq: None,
        }
    }
}

#[derive(Debug, Default)]
struct HaiderProjectionFoldStep {
    rows: Vec<SessionProjectionRow>,
    status: Option<String>,
    state_raw: Option<String>,
    tail_changed: bool,
}

#[derive(Clone, Debug)]
struct HaiderProjectionFrame {
    session_id: String,
    from_seq: Option<i64>,
    appended: usize,
    total_rows: i64,
    live_tail: Option<SessionProjectionRow>,
    tail_changed: bool,
    covered_through_seq: Option<i64>,
    head_seq: Option<i64>,
    caught_up: bool,
    sync_changed: bool,
}

#[derive(Clone, Serialize)]
struct HaiderProjectionEvent {
    session_id: String,
    from_seq: Option<i64>,
    appended: usize,
    total_rows: i64,
    live_tail: Option<SessionProjectionRow>,
    covered_through_seq: Option<i64>,
    head_seq: Option<i64>,
    caught_up: bool,
}

struct HaiderProjectionWatch {
    child: Arc<StdMutex<std::process::Child>>,
    metadata_only: Arc<AtomicBool>,
    generation: u64,
    touched: u64,
}

struct HaiderProjectionPipeTail {
    stop: Arc<AtomicBool>,
    generation: u64,
}

#[derive(Default)]
struct HaiderProjectionWatchManager {
    watches: HashMap<String, HaiderProjectionWatch>,
    clock: u64,
}

#[derive(Default)]
struct HaiderProjectionPipeManager {
    tails: HashMap<String, HaiderProjectionPipeTail>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct HaiderProjectionPipeHeader {
    session_id: String,
    generation: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct HaiderProjectionPipeCursor {
    session_id: String,
    byte_offset: i64,
    last_seq: i64,
    last_ordinal: i64,
    generation: i64,
    covered_through_seq: i64,
    coverage_known: bool,
}

#[derive(Clone, Debug)]
struct HaiderProjectionPipeRoute {
    path: PathBuf,
    head_seq: Option<i64>,
}

#[derive(Clone, Copy, Debug, Default)]
struct HaiderProjectionSync {
    covered_through_seq: Option<i64>,
    head_seq: Option<i64>,
    caught_up: bool,
}

enum HaiderProjectionPipeLine {
    Complete { consumed: i64, within_limit: bool },
    Torn,
    Eof,
}

static HAIDER_PROJECTION_STOPPING: AtomicBool = AtomicBool::new(false);
static HAIDER_PROJECTION_WATCH_GENERATION: AtomicU64 = AtomicU64::new(1);

fn haider_projection_states() -> &'static StdMutex<HashMap<String, HaiderProjectionFoldState>> {
    static STATES: OnceLock<StdMutex<HashMap<String, HaiderProjectionFoldState>>> = OnceLock::new();
    STATES.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn haider_projection_watch_manager() -> &'static StdMutex<HaiderProjectionWatchManager> {
    static MANAGER: OnceLock<StdMutex<HaiderProjectionWatchManager>> = OnceLock::new();
    MANAGER.get_or_init(|| StdMutex::new(HaiderProjectionWatchManager::default()))
}

fn haider_projection_pipe_manager() -> &'static StdMutex<HaiderProjectionPipeManager> {
    static MANAGER: OnceLock<StdMutex<HaiderProjectionPipeManager>> = OnceLock::new();
    MANAGER.get_or_init(|| StdMutex::new(HaiderProjectionPipeManager::default()))
}

fn haider_projection_schema_lock() -> &'static StdMutex<()> {
    static LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| StdMutex::new(()))
}

fn haider_projection_ensure_lock() -> &'static StdMutex<()> {
    static LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| StdMutex::new(()))
}

fn haider_projection_attach_lock() -> &'static StdMutex<()> {
    static LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| StdMutex::new(()))
}

fn haider_projection_migrate_database(connection: &mut rusqlite::Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS session_projection_schema (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                version INTEGER NOT NULL
             );",
        )
        .map_err(|error| format!("Unable to initialize session projection schema: {error}"))?;
    let version = connection.query_row(
        "SELECT version FROM session_projection_schema WHERE singleton = 1",
        [],
        |row| row.get::<_, i64>(0),
    );
    if !matches!(version, Ok(HAIDER_PROJECTION_SCHEMA_VERSION)) {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Unable to begin session projection migration: {error}"))?;
        transaction
            .execute_batch(
                "DROP TABLE IF EXISTS session_projection_rows;
                 DROP TABLE IF EXISTS session_pipe_cursors;
                 DELETE FROM session_projection_schema;",
            )
            .map_err(|error| format!("Unable to migrate session projection store: {error}"))?;
        transaction
            .execute(
                "INSERT INTO session_projection_schema(singleton, version) VALUES (1, ?1)",
                [HAIDER_PROJECTION_SCHEMA_VERSION],
            )
            .map_err(|error| format!("Unable to version session projection store: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Unable to commit session projection migration: {error}"))?;
    }
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS session_projection_rows (
                session_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                ordinal INTEGER NOT NULL DEFAULT 0,
                branch_id TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL,
                role TEXT NOT NULL,
                text TEXT NOT NULL,
                meta TEXT NOT NULL,
                at_ms INTEGER NOT NULL,
                PRIMARY KEY (session_id, seq, ordinal)
             );
             CREATE INDEX IF NOT EXISTS idx_session_projection_rows_order
                ON session_projection_rows(session_id, seq, ordinal);
             CREATE TABLE IF NOT EXISTS session_pipe_cursors (
                session_id TEXT PRIMARY KEY,
                byte_offset INTEGER NOT NULL,
                last_seq INTEGER NOT NULL,
                last_ordinal INTEGER NOT NULL,
                generation INTEGER NOT NULL,
                covered_through_seq INTEGER NOT NULL,
                coverage_known INTEGER NOT NULL DEFAULT 0
             );",
        )
        .map_err(|error| format!("Unable to initialize session projection store: {error}"))?;
    let cursor_columns = {
        let mut statement = connection
            .prepare("PRAGMA table_info(session_pipe_cursors)")
            .map_err(|error| format!("Unable to inspect session pipe cursor schema: {error}"))?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| format!("Unable to query session pipe cursor schema: {error}"))?
            .collect::<Result<HashSet<_>, _>>()
            .map_err(|error| format!("Unable to decode session pipe cursor schema: {error}"))?;
        columns
    };
    if !cursor_columns.contains("coverage_known") {
        connection
            .execute(
                "ALTER TABLE session_pipe_cursors ADD COLUMN coverage_known INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|error| format!("Unable to migrate session pipe cursor schema: {error}"))?;
    }
    Ok(())
}

fn haider_projection_open_database() -> Result<rusqlite::Connection, String> {
    let _schema_guard = haider_projection_schema_lock()
        .lock()
        .map_err(|_| "Session projection schema lock is unavailable.".to_string())?;
    #[cfg(not(test))]
    let mut connection = sessions_open_database()?;
    #[cfg(test)]
    let mut connection = {
        static TEST_DATABASE: OnceLock<PathBuf> = OnceLock::new();
        let path = TEST_DATABASE.get_or_init(|| {
            std::env::temp_dir().join(format!(
                "rust-diffforge-haider-projection-{}.sqlite",
                uuid::Uuid::new_v4().simple()
            ))
        });
        let mut connection = rusqlite::Connection::open(path)
            .map_err(|error| format!("Unable to open test projection store: {error}"))?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| format!("Unable to configure test projection store: {error}"))?;
        sessions_initialize_database(&mut connection)?;
        connection
    };
    haider_projection_migrate_database(&mut connection)?;
    Ok(connection)
}

fn haider_projection_database_stats(session_id: &str) -> Result<(i64, i64), String> {
    let connection = haider_projection_open_database()?;
    connection
        .query_row(
            "SELECT COUNT(*), COALESCE(MAX(seq), 0)
             FROM session_projection_rows WHERE session_id = ?1",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("Unable to inspect session projection: {error}"))
}

fn haider_projection_initialize_state(session_id: &str) -> Result<(), String> {
    if haider_projection_states()
        .lock()
        .map_err(|_| "Session projection state is unavailable.".to_string())?
        .contains_key(session_id)
    {
        return Ok(());
    }
    let (total_rows, max_seq) = haider_projection_database_stats(session_id)?;
    let mut states = haider_projection_states()
        .lock()
        .map_err(|_| "Session projection state is unavailable.".to_string())?;
    states
        .entry(session_id.to_string())
        .or_insert_with(|| HaiderProjectionFoldState {
            next_fallback_seq: max_seq.saturating_add(1).max(1),
            total_rows,
            ..HaiderProjectionFoldState::default()
        });
    Ok(())
}

fn haider_projection_json_i64(value: Option<&Value>) -> Option<i64> {
    let raw = match value? {
        Value::Number(number) => number.as_i64().or_else(|| {
            number
                .as_u64()
                .map(|value| value.min(i64::MAX as u64) as i64)
        }),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    }?;
    Some(raw.max(0))
}

fn haider_projection_text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) if !text.trim().is_empty() => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn haider_projection_extract_text(value: &Value) -> Option<String> {
    if let Some(text) = haider_projection_text(Some(value)) {
        return Some(text);
    }
    if let Some(values) = value.as_array() {
        let joined = values
            .iter()
            .filter_map(haider_projection_extract_text)
            .collect::<Vec<_>>()
            .join("");
        return (!joined.trim().is_empty()).then_some(joined);
    }
    let object = value.as_object()?;
    for key in [
        "text",
        "message",
        "summary",
        "content",
        "output_text",
        "reason",
        "report",
        "items",
    ] {
        if let Some(text) = object.get(key).and_then(haider_projection_extract_text) {
            return Some(text);
        }
    }
    None
}

fn haider_projection_compact(value: &str, limit: usize) -> String {
    let flattened = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if flattened.chars().count() <= limit {
        return flattened;
    }
    let mut text = flattened
        .chars()
        .take(limit.saturating_sub(1))
        .collect::<String>();
    text.push('…');
    text
}

fn haider_projection_payload(value: &Value) -> &Value {
    value
        .as_object()
        .and_then(|object| object.get("payload"))
        .unwrap_or(value)
}

fn haider_projection_kind(value: &Value, key: &str) -> Option<String> {
    let candidate = value.as_object()?.get(key)?;
    haider_projection_text(Some(candidate)).or_else(|| {
        candidate.as_object().and_then(|object| {
            [key, "kind", "type", "state", "status", "outcome"]
                .iter()
                .find_map(|nested| haider_projection_text(object.get(*nested)))
        })
    })
}

fn haider_projection_seq(
    state: &mut HaiderProjectionFoldState,
    envelope: &Value,
    item: &Value,
) -> i64 {
    let explicit = envelope
        .as_object()
        .and_then(|object| haider_projection_json_i64(object.get("seq")))
        .or_else(|| {
            item.as_object()
                .and_then(|object| haider_projection_json_i64(object.get("seq")))
        });
    if let Some(seq) = explicit {
        state.next_fallback_seq = state.next_fallback_seq.max(seq.saturating_add(1));
        return seq;
    }
    let seq = state.next_fallback_seq.max(1);
    state.next_fallback_seq = seq.saturating_add(1);
    seq
}

fn haider_projection_ordinal(envelope: &Value, item: &Value) -> i64 {
    [envelope, item]
        .into_iter()
        .find_map(|value| {
            value
                .as_object()
                .and_then(|object| haider_projection_json_i64(object.get("ordinal")))
        })
        .unwrap_or(0)
}

fn haider_projection_branch_id(envelope: &Value, item: &Value) -> String {
    [envelope, item]
        .into_iter()
        .find_map(|value| {
            value
                .as_object()
                .and_then(|object| haider_projection_text(object.get("branch_id")))
        })
        .unwrap_or_default()
}

fn haider_projection_at_ms(envelope: &Value, item: &Value) -> i64 {
    for value in [envelope, item] {
        let Some(object) = value.as_object() else {
            continue;
        };
        for key in ["committed_at_ms", "at_ms", "created_at_ms", "timestamp_ms"] {
            if let Some(timestamp) = haider_projection_json_i64(object.get(key)) {
                return timestamp;
            }
        }
    }
    sessions_now_ms()
}

fn haider_projection_row(
    session_id: &str,
    seq: i64,
    ordinal: i64,
    branch_id: String,
    kind: &str,
    role: &str,
    text: String,
    meta: Value,
    at_ms: i64,
) -> SessionProjectionRow {
    SessionProjectionRow {
        session_id: session_id.to_string(),
        seq,
        ordinal,
        branch_id,
        kind: kind.to_string(),
        role: role.to_string(),
        text,
        meta,
        at_ms,
    }
}

fn haider_projection_tool_summary(item: &Value) -> String {
    let object = item.as_object();
    let kind = object
        .and_then(|object| haider_projection_text(object.get("item")))
        .or_else(|| object.and_then(|object| haider_projection_text(object.get("type"))))
        .unwrap_or_else(|| "tool".to_string());
    let name = object.and_then(|object| {
        ["name", "tool", "command", "path", "call_id"]
            .iter()
            .find_map(|key| haider_projection_text(object.get(*key)))
    });
    let status = object.and_then(|_| {
        ["status", "phase", "outcome"]
            .iter()
            .find_map(|key| haider_projection_kind(item, key))
    });
    let summary = object.and_then(|object| {
        ["summary", "preview", "result", "report"]
            .iter()
            .find_map(|key| object.get(*key).and_then(haider_projection_extract_text))
    });
    let mut parts = vec![name.unwrap_or(kind)];
    if let Some(status) = status {
        parts.push(status);
    }
    if let Some(summary) = summary {
        parts.push(haider_projection_compact(&summary, 160));
    }
    haider_projection_compact(&parts.join(" · "), 240)
}

fn haider_projection_item_class(item: &Value) -> (&'static str, &'static str) {
    let kind = item
        .as_object()
        .and_then(|object| {
            haider_projection_text(object.get("item"))
                .or_else(|| haider_projection_text(object.get("type")))
        })
        .unwrap_or_default()
        .to_ascii_lowercase();
    match kind.as_str() {
        "agent_message" | "assistant" | "assistant_message" | "output_text" => {
            ("message", "assistant")
        }
        "incomplete_agent_message" => ("message", "assistant"),
        "reasoning" | "plan" => ("message", "assistant"),
        "refusal" => ("error", "assistant"),
        "tool_call" | "command_execution" | "file_change" | "child_spawn" | "child_result"
        | "context_compaction" | "extension" => ("tool", "tool"),
        _ => ("", ""),
    }
}

fn haider_projection_row_from_item(
    state: &mut HaiderProjectionFoldState,
    session_id: &str,
    envelope: &Value,
    item: &Value,
    fallback_text: Option<String>,
) -> Option<SessionProjectionRow> {
    let (kind, role) = haider_projection_item_class(item);
    if kind.is_empty() {
        return None;
    }
    let seq = haider_projection_seq(state, envelope, item);
    let at_ms = haider_projection_at_ms(envelope, item);
    let text = if kind == "tool" {
        haider_projection_tool_summary(item)
    } else {
        haider_projection_extract_text(item)
            .or(fallback_text)
            .unwrap_or_default()
    };
    Some(haider_projection_row(
        session_id,
        seq,
        haider_projection_ordinal(envelope, item),
        haider_projection_branch_id(envelope, item),
        kind,
        role,
        text,
        item.clone(),
        at_ms,
    ))
}

fn haider_projection_export_row(
    state: &mut HaiderProjectionFoldState,
    session_id: &str,
    item: &Value,
) -> Option<SessionProjectionRow> {
    let object = item.as_object()?;
    let role = haider_projection_text(object.get("role"))?.to_ascii_lowercase();
    let (kind, rendered_role, text) = match role.as_str() {
        "user" => (
            "message",
            "user",
            haider_projection_extract_text(item).unwrap_or_default(),
        ),
        "assistant" => (
            "message",
            "assistant",
            haider_projection_extract_text(item).unwrap_or_default(),
        ),
        "tool" | "effect" => (
            "tool",
            "tool",
            object
                .get("summary")
                .and_then(haider_projection_extract_text)
                .unwrap_or_else(|| haider_projection_tool_summary(item)),
        ),
        "error" => (
            "error",
            "assistant",
            object
                .get("presentation")
                .and_then(haider_projection_extract_text)
                .unwrap_or_else(|| "Haider run failed".to_string()),
        ),
        "usage" => ("usage", "meta", String::new()),
        _ => return None,
    };
    let seq = haider_projection_seq(state, item, item);
    Some(haider_projection_row(
        session_id,
        seq,
        haider_projection_ordinal(item, item),
        haider_projection_branch_id(item, item),
        kind,
        rendered_role,
        text,
        item.clone(),
        haider_projection_at_ms(item, item),
    ))
}

fn haider_projection_fold_item_event(
    state: &mut HaiderProjectionFoldState,
    session_id: &str,
    envelope: &Value,
    payload: &Value,
    step: &mut HaiderProjectionFoldStep,
) {
    let Some(object) = payload.as_object() else {
        return;
    };
    let event = haider_projection_text(object.get("event"))
        .unwrap_or_default()
        .to_ascii_lowercase();
    let item_id = haider_projection_text(object.get("item_id")).unwrap_or_default();
    match event.as_str() {
        "started" => {
            let Some(item) = object.get("item") else {
                return;
            };
            if let Some(row) =
                haider_projection_row_from_item(state, session_id, envelope, item, None)
            {
                state.tail = Some(HaiderProjectionTail { item_id, row });
                step.tail_changed = true;
            }
        }
        "delta" => {
            let Some(delta) = object.get("delta") else {
                return;
            };
            let delta_kind = haider_projection_kind(delta, "delta")
                .unwrap_or_default()
                .to_ascii_lowercase();
            if state
                .tail
                .as_ref()
                .is_none_or(|tail| tail.item_id != item_id)
            {
                let seq = haider_projection_seq(state, envelope, delta);
                state.tail = Some(HaiderProjectionTail {
                    item_id: item_id.clone(),
                    row: haider_projection_row(
                        session_id,
                        seq,
                        haider_projection_ordinal(envelope, delta),
                        haider_projection_branch_id(envelope, delta),
                        if matches!(delta_kind.as_str(), "tool_args" | "command_output") {
                            "tool"
                        } else {
                            "message"
                        },
                        if matches!(delta_kind.as_str(), "tool_args" | "command_output") {
                            "tool"
                        } else {
                            "assistant"
                        },
                        String::new(),
                        json!({"deltas": []}),
                        haider_projection_at_ms(envelope, delta),
                    ),
                });
            }
            let Some(tail) = state.tail.as_mut() else {
                return;
            };
            match delta_kind.as_str() {
                "text" | "reasoning" => {
                    if let Some(chunk) = delta
                        .as_object()
                        .and_then(|object| haider_projection_text(object.get("text")))
                    {
                        tail.row.text.push_str(&chunk);
                    }
                }
                "tool_args" => {
                    if let Some(fragment) = delta
                        .as_object()
                        .and_then(|object| haider_projection_text(object.get("fragment")))
                    {
                        tail.row.text =
                            haider_projection_compact(&format!("tool arguments · {fragment}"), 240);
                    }
                }
                "command_output" => {
                    let stream = haider_projection_kind(delta, "stream")
                        .unwrap_or_else(|| "output".to_string());
                    tail.row.text = format!("command output · {stream}");
                }
                _ => {}
            }
            if let Some(deltas) = tail
                .row
                .meta
                .as_object_mut()
                .and_then(|meta| meta.get_mut("deltas"))
                .and_then(Value::as_array_mut)
            {
                if deltas.len() < 256 {
                    deltas.push(delta.clone());
                }
            }
            step.tail_changed = true;
        }
        "completed" => {
            let tail_text = state
                .tail
                .as_ref()
                .filter(|tail| tail.item_id == item_id)
                .map(|tail| tail.row.text.clone());
            if let Some(item) = object.get("item") {
                if let Some(row) =
                    haider_projection_row_from_item(state, session_id, envelope, item, tail_text)
                {
                    step.rows.push(row);
                }
            }
            if state
                .tail
                .as_ref()
                .is_some_and(|tail| tail.item_id == item_id)
            {
                state.tail = None;
                step.tail_changed = true;
            }
        }
        _ => {
            if let Some(item) = object.get("item") {
                if let Some(row) =
                    haider_projection_row_from_item(state, session_id, envelope, item, None)
                {
                    step.rows.push(row);
                }
            }
        }
    }
}

fn haider_projection_fold_value_locked(
    state: &mut HaiderProjectionFoldState,
    session_id: &str,
    value: &Value,
) -> HaiderProjectionFoldStep {
    let mut step = HaiderProjectionFoldStep::default();
    if value
        .as_object()
        .is_some_and(|object| object.contains_key("payload"))
    {
        if let Some(seq) = value
            .as_object()
            .and_then(|object| haider_projection_json_i64(object.get("seq")))
        {
            let identity = (seq, haider_projection_ordinal(value, value));
            if !state.seen_sequences.insert(identity) {
                return step;
            }
            if state.seen_sequences.len() > 16_384 {
                let floor = seq.saturating_sub(8_192);
                state.seen_sequences.retain(|(seen, _)| *seen >= floor);
            }
        }
    }
    let payload = haider_projection_payload(value);
    let payload_object = payload.as_object();

    if haider_projection_pipe_usage_value(value)
        && payload_object.is_some_and(|object| {
            object.get("type").and_then(Value::as_str) != Some("usage")
                && object.get("role").and_then(Value::as_str) != Some("usage")
        })
    {
        let seq = haider_projection_seq(state, value, payload);
        state.metadata.insert("usage".to_string(), payload.clone());
        step.rows.push(haider_projection_row(
            session_id,
            seq,
            haider_projection_ordinal(value, payload),
            haider_projection_branch_id(value, payload),
            "usage",
            "meta",
            String::new(),
            payload.clone(),
            haider_projection_at_ms(value, payload),
        ));
        return step;
    }

    if payload_object.is_some_and(|object| object.contains_key("role")) {
        if let Some(row) = haider_projection_export_row(state, session_id, payload) {
            step.rows.push(row);
        }
        return step;
    }

    let payload_type = payload_object
        .and_then(|object| haider_projection_text(object.get("type")))
        .unwrap_or_default()
        .to_ascii_lowercase();
    match payload_type.as_str() {
        "user_message" => {
            let seq = haider_projection_seq(state, value, payload);
            let text = haider_projection_extract_text(payload).unwrap_or_default();
            step.rows.push(haider_projection_row(
                session_id,
                seq,
                haider_projection_ordinal(value, payload),
                haider_projection_branch_id(value, payload),
                "message",
                "user",
                text,
                payload.clone(),
                haider_projection_at_ms(value, payload),
            ));
        }
        "item" => {
            haider_projection_fold_item_event(state, session_id, value, payload, &mut step);
        }
        "tool_result" => {
            let seq = haider_projection_seq(state, value, payload);
            step.rows.push(haider_projection_row(
                session_id,
                seq,
                haider_projection_ordinal(value, payload),
                haider_projection_branch_id(value, payload),
                "tool",
                "tool",
                haider_projection_tool_summary(payload),
                payload.clone(),
                haider_projection_at_ms(value, payload),
            ));
        }
        "run_failed" => {
            let seq = haider_projection_seq(state, value, payload);
            let text = payload_object
                .and_then(|object| {
                    ["presentation", "message", "code"]
                        .iter()
                        .find_map(|key| object.get(*key).and_then(haider_projection_extract_text))
                })
                .unwrap_or_else(|| "Haider run failed".to_string());
            step.rows.push(haider_projection_row(
                session_id,
                seq,
                haider_projection_ordinal(value, payload),
                haider_projection_branch_id(value, payload),
                "error",
                "assistant",
                text,
                payload.clone(),
                haider_projection_at_ms(value, payload),
            ));
            step.status = Some("error".to_string());
        }
        "effect" => {
            let effect_id = payload_object
                .and_then(|object| haider_projection_text(object.get("effect")))
                .unwrap_or_default();
            let phase = haider_projection_kind(payload, "phase")
                .unwrap_or_default()
                .to_ascii_lowercase();
            if phase == "intent" {
                if let Some(summary) =
                    payload_object.and_then(|object| haider_projection_text(object.get("summary")))
                {
                    state.effect_summaries.insert(effect_id, summary);
                }
            } else if phase == "outcome" {
                let summary = state
                    .effect_summaries
                    .remove(&effect_id)
                    .unwrap_or_else(|| "effect completed".to_string());
                let outcome = haider_projection_kind(payload, "outcome")
                    .unwrap_or_else(|| "unknown".to_string());
                let seq = haider_projection_seq(state, value, payload);
                step.rows.push(haider_projection_row(
                    session_id,
                    seq,
                    haider_projection_ordinal(value, payload),
                    haider_projection_branch_id(value, payload),
                    "tool",
                    "tool",
                    haider_projection_compact(&format!("{summary} · {outcome}"), 240),
                    payload.clone(),
                    haider_projection_at_ms(value, payload),
                ));
            }
        }
        "usage" | "run_state" | "session_state" => {
            state.metadata.insert(payload_type.clone(), payload.clone());
            if payload_type == "usage" {
                // Usage snapshots become rows so the trajectory view gets
                // per-turn token/cache points; the transcript skips the kind.
                let seq = haider_projection_seq(state, value, payload);
                step.rows.push(haider_projection_row(
                    session_id,
                    seq,
                    haider_projection_ordinal(value, payload),
                    haider_projection_branch_id(value, payload),
                    "usage",
                    "meta",
                    String::new(),
                    payload.clone(),
                    haider_projection_at_ms(value, payload),
                ));
            }
            if matches!(payload_type.as_str(), "run_state" | "session_state") {
                let state_raw = payload_object
                    .and_then(|object| object.get("state"))
                    .and_then(haider_bridge_state_raw);
                step.status = Some(haider_bridge_store_status(state_raw.as_deref()).to_string());
                step.state_raw = state_raw;
            }
        }
        _ => {
            // Some export harnesses emit flat assistant/tool items without the
            // item lifecycle wrapper. Unknown shapes remain harmless.
            if let Some(row) =
                haider_projection_row_from_item(state, session_id, value, payload, None)
            {
                step.rows.push(row);
            }
        }
    }
    step
}

fn haider_projection_input_items(value: &Value) -> Vec<&Value> {
    if let Some(object) = value.as_object() {
        for key in ["turns", "items", "events", "rows"] {
            if let Some(values) = object.get(key).and_then(Value::as_array) {
                return values.iter().collect();
            }
        }
    }
    if let Some(values) = value.as_array() {
        return values.iter().collect();
    }
    vec![value]
}

fn haider_projection_persist_batch(
    session_id: &str,
    rows: &[SessionProjectionRow],
    cursor: Option<&HaiderProjectionPipeCursor>,
) -> Result<(usize, i64), String> {
    if rows.is_empty() && cursor.is_none() {
        return Ok((0, 0));
    }
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    let mut connection = haider_projection_open_database()?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Unable to begin session projection write: {error}"))?;
    let mut appended = 0usize;
    for row in rows {
        appended = appended.saturating_add(
            transaction
                .execute(
                    "INSERT OR IGNORE INTO session_projection_rows
                     (session_id, seq, ordinal, branch_id, kind, role, text, meta, at_ms)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    rusqlite::params![
                        row.session_id,
                        row.seq,
                        row.ordinal,
                        row.branch_id,
                        row.kind,
                        row.role,
                        row.text,
                        serde_json::to_string(&row.meta).unwrap_or_else(|_| "null".to_string()),
                        row.at_ms,
                    ],
                )
                .map_err(|error| format!("Unable to append session projection row: {error}"))?,
        );
    }
    if let Some(cursor) = cursor {
        transaction
            .execute(
                "INSERT INTO session_pipe_cursors (
                    session_id, byte_offset, last_seq, last_ordinal, generation,
                    covered_through_seq, coverage_known
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(session_id) DO UPDATE SET
                    byte_offset = excluded.byte_offset,
                    last_seq = excluded.last_seq,
                    last_ordinal = excluded.last_ordinal,
                    generation = excluded.generation,
                    covered_through_seq = excluded.covered_through_seq,
                    coverage_known = excluded.coverage_known",
                rusqlite::params![
                    cursor.session_id,
                    cursor.byte_offset,
                    cursor.last_seq,
                    cursor.last_ordinal,
                    cursor.generation,
                    cursor.covered_through_seq,
                    cursor.coverage_known,
                ],
            )
            .map_err(|error| format!("Unable to persist session pipe cursor: {error}"))?;
    }
    let total_rows = transaction
        .query_row(
            "SELECT COUNT(*) FROM session_projection_rows WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Unable to count session projection rows: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit session projection rows: {error}"))?;
    Ok((appended, total_rows))
}

fn haider_projection_persist_rows(rows: &[SessionProjectionRow]) -> Result<(usize, i64), String> {
    if rows.is_empty() {
        return Ok((0, 0));
    }
    haider_projection_persist_batch(&rows[0].session_id, rows, None)
}

fn haider_projection_load_pipe_cursor(
    session_id: &str,
) -> Result<Option<HaiderProjectionPipeCursor>, String> {
    let connection = haider_projection_open_database()?;
    match connection.query_row(
        "SELECT session_id, byte_offset, last_seq, last_ordinal, generation,
                covered_through_seq, coverage_known
         FROM session_pipe_cursors WHERE session_id = ?1",
        [session_id],
        |row| {
            Ok(HaiderProjectionPipeCursor {
                session_id: row.get(0)?,
                byte_offset: row.get(1)?,
                last_seq: row.get(2)?,
                last_ordinal: row.get(3)?,
                generation: row.get(4)?,
                covered_through_seq: row.get(5)?,
                coverage_known: row.get(6)?,
            })
        },
    ) {
        Ok(cursor) => Ok(Some(cursor)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Unable to read session pipe cursor: {error}")),
    }
}

fn haider_projection_reset_pipe_session(
    session_id: &str,
    cursor: &HaiderProjectionPipeCursor,
) -> Result<(), String> {
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    let mut connection = haider_projection_open_database()?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Unable to begin session pipe refold: {error}"))?;
    transaction
        .execute(
            "DELETE FROM session_projection_rows WHERE session_id = ?1",
            [session_id],
        )
        .map_err(|error| format!("Unable to reset session projection rows: {error}"))?;
    transaction
        .execute(
            "DELETE FROM session_pipe_cursors WHERE session_id = ?1",
            [session_id],
        )
        .map_err(|error| format!("Unable to reset session pipe cursor: {error}"))?;
    transaction
        .execute(
            "INSERT INTO session_pipe_cursors (
                session_id, byte_offset, last_seq, last_ordinal, generation,
                covered_through_seq, coverage_known
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                cursor.session_id,
                cursor.byte_offset,
                cursor.last_seq,
                cursor.last_ordinal,
                cursor.generation,
                cursor.covered_through_seq,
                cursor.coverage_known,
            ],
        )
        .map_err(|error| format!("Unable to initialize session pipe cursor: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit session pipe refold: {error}"))?;
    if let Ok(mut states) = haider_projection_states().lock() {
        states.remove(session_id);
    }
    Ok(())
}

fn haider_projection_caught_up(
    head_seq: Option<i64>,
    covered_through_seq: Option<i64>,
    pipe_eof_max_seq: Option<i64>,
) -> bool {
    let Some(head_seq) = head_seq else {
        return true;
    };
    if let Some(covered_through_seq) = covered_through_seq {
        return covered_through_seq >= head_seq;
    }
    pipe_eof_max_seq.is_none_or(|max_seq| max_seq >= head_seq)
}

fn haider_projection_sync(
    session_id: &str,
    provider_session_id: Option<&str>,
) -> Result<HaiderProjectionSync, String> {
    let cursor = haider_projection_load_pipe_cursor(session_id)?;
    let covered_through_seq = cursor
        .as_ref()
        .filter(|cursor| cursor.coverage_known)
        .map(|cursor| cursor.covered_through_seq);
    let head_seq = provider_session_id.and_then(haider_bridge_head_seq);
    let pipe_eof_max_seq = haider_projection_states().lock().ok().and_then(|states| {
        states
            .get(session_id)
            .and_then(|state| state.pipe_eof_max_seq)
    });
    Ok(HaiderProjectionSync {
        covered_through_seq,
        head_seq,
        caught_up: haider_projection_caught_up(head_seq, covered_through_seq, pipe_eof_max_seq),
    })
}

fn haider_projection_apply_status(
    app: Option<&AppHandle>,
    session_id: &str,
    status: Option<String>,
    state_raw: Option<String>,
) {
    if status.is_none() && state_raw.is_none() {
        return;
    }
    let result = session_update_blocking(SessionUpdateArgs {
        id: session_id.to_string(),
        title: None,
        status,
        state_raw,
        provider_session_id: None,
        first_user_message: None,
        // Recency is DAEMON-owned (reconcile mirrors updated_at). Touching
        // here made merely OPENING a session jump to the top of Recent —
        // status/state writes must never move the clock.
        touch: None,
    });
    if result.is_ok() {
        if let Some(app) = app {
            sessions_emit_changed(app);
        }
    }
}

fn haider_projection_ingest_value(
    app: Option<&AppHandle>,
    session_id: &str,
    value: &Value,
) -> Result<HaiderProjectionFrame, String> {
    haider_projection_initialize_state(session_id)?;
    let mut all_rows = Vec::new();
    let mut status = None;
    let mut state_raw = None;
    let mut tail_changed = false;
    {
        let mut states = haider_projection_states()
            .lock()
            .map_err(|_| "Session projection state is unavailable.".to_string())?;
        let state = states
            .get_mut(session_id)
            .ok_or_else(|| "Session projection state was not initialized.".to_string())?;
        for item in haider_projection_input_items(value) {
            let step = haider_projection_fold_value_locked(state, session_id, item);
            all_rows.extend(step.rows);
            status = step.status.or(status);
            state_raw = step.state_raw.or(state_raw);
            tail_changed |= step.tail_changed;
        }
    }
    let (appended, persisted_total) = haider_projection_persist_rows(&all_rows)?;
    let mut states = haider_projection_states()
        .lock()
        .map_err(|_| "Session projection state is unavailable.".to_string())?;
    let state = states
        .get_mut(session_id)
        .ok_or_else(|| "Session projection state was not initialized.".to_string())?;
    if !all_rows.is_empty() {
        state.total_rows = persisted_total;
    }
    let live_tail = state.tail.as_ref().map(|tail| tail.row.clone());
    let total_rows = state.total_rows;
    drop(states);
    haider_projection_apply_status(app, session_id, status, state_raw);
    let provider_session_id = haider_projection_resolve_provider_session(session_id)
        .ok()
        .map(|(_, provider_session_id)| provider_session_id);
    let sync = haider_projection_sync(session_id, provider_session_id.as_deref()).unwrap_or(
        HaiderProjectionSync {
            caught_up: true,
            ..HaiderProjectionSync::default()
        },
    );
    let from_seq = (appended > 0)
        .then(|| all_rows.iter().map(|row| row.seq).min())
        .flatten();
    Ok(HaiderProjectionFrame {
        session_id: session_id.to_string(),
        from_seq,
        appended,
        total_rows,
        live_tail,
        tail_changed,
        covered_through_seq: sync.covered_through_seq,
        head_seq: sync.head_seq,
        caught_up: sync.caught_up,
        sync_changed: false,
    })
}

fn haider_projection_frame_sender(
    app: &AppHandle,
) -> tokio::sync::mpsc::UnboundedSender<HaiderProjectionFrame> {
    static SENDER: OnceLock<tokio::sync::mpsc::UnboundedSender<HaiderProjectionFrame>> =
        OnceLock::new();
    SENDER
        .get_or_init(|| {
            let (sender, mut receiver) =
                tokio::sync::mpsc::unbounded_channel::<HaiderProjectionFrame>();
            let emit_app = app.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(first) = receiver.recv().await {
                    let mut frames = HashMap::new();
                    frames.insert(first.session_id.clone(), first);
                    sleep(HAIDER_PROJECTION_FRAME_TIME).await;
                    while let Ok(next) = receiver.try_recv() {
                        frames
                            .entry(next.session_id.clone())
                            .and_modify(|frame: &mut HaiderProjectionFrame| {
                                frame.from_seq = match (frame.from_seq, next.from_seq) {
                                    (Some(left), Some(right)) => Some(left.min(right)),
                                    (None, value) | (value, None) => value,
                                };
                                frame.appended = frame.appended.saturating_add(next.appended);
                                frame.total_rows = next.total_rows;
                                if next.tail_changed {
                                    frame.live_tail = next.live_tail.clone();
                                    frame.tail_changed = true;
                                }
                                if next.sync_changed {
                                    frame.covered_through_seq = next.covered_through_seq;
                                    frame.head_seq = next.head_seq;
                                    frame.caught_up = next.caught_up;
                                    frame.sync_changed = true;
                                }
                            })
                            .or_insert(next);
                    }
                    for (_, frame) in frames {
                        let _ = emit_app.emit_to(
                            "main",
                            HAIDER_PROJECTION_ROWS_EVENT,
                            HaiderProjectionEvent {
                                session_id: frame.session_id,
                                from_seq: frame.from_seq,
                                appended: frame.appended,
                                total_rows: frame.total_rows,
                                live_tail: frame.live_tail,
                                covered_through_seq: frame.covered_through_seq,
                                head_seq: frame.head_seq,
                                caught_up: frame.caught_up,
                            },
                        );
                    }
                }
            });
            sender
        })
        .clone()
}

fn haider_projection_ingest_and_emit(app: &AppHandle, session_id: &str, value: &Value) {
    match haider_projection_ingest_value(Some(app), session_id, value) {
        Ok(frame) if frame.appended > 0 || frame.tail_changed || frame.sync_changed => {
            let _ = haider_projection_frame_sender(app).send(frame);
        }
        Ok(_) => {}
        Err(error) => eprintln!("Haider projection fold failed: {error}"),
    }
}

fn haider_projection_read_capped_line(
    reader: &mut impl BufRead,
    output: &mut Vec<u8>,
) -> std::io::Result<Option<bool>> {
    output.clear();
    let mut overflow = false;
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return Ok((!output.is_empty() || overflow).then_some(!overflow));
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(buffer.len(), |index| index + 1);
        let content = &buffer[..newline.unwrap_or(buffer.len())];
        if !overflow {
            let available = HAIDER_PROJECTION_MAX_LINE_BYTES.saturating_sub(output.len());
            output.extend_from_slice(&content[..content.len().min(available)]);
            overflow = content.len() > available;
        }
        reader.consume(consumed);
        if newline.is_some() {
            return Ok(Some(!overflow));
        }
    }
}

fn haider_projection_pipe_feature(value: &Value) -> bool {
    match value {
        Value::String(feature) => feature == "pipe_native_v2",
        Value::Array(values) => values.iter().any(haider_projection_pipe_feature),
        Value::Object(object) => object
            .get("features")
            .is_some_and(haider_projection_pipe_feature),
        _ => false,
    }
}

fn haider_projection_pipe_supported() -> bool {
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    *SUPPORTED.get_or_init(|| {
        haider_bridge_json_command("status")
            .is_some_and(|value| haider_projection_pipe_feature(&value))
    })
}

fn haider_projection_pipe_usage_capability() -> &'static OnceLock<bool> {
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    &SUPPORTED
}

fn haider_projection_cached_pipe_usage(
    cache: &OnceLock<bool>,
    probe: impl FnOnce() -> bool,
) -> bool {
    *cache.get_or_init(probe)
}

fn haider_projection_pipe_usage_value(value: &Value) -> bool {
    let payload = haider_projection_payload(value);
    let Some(object) = payload.as_object() else {
        return false;
    };
    if object.get("type").and_then(Value::as_str) == Some("usage")
        || object.get("role").and_then(Value::as_str) == Some("usage")
    {
        return true;
    }
    if object.contains_key("role") {
        return false;
    }
    object.get("usage").is_some_and(Value::is_object)
        || object.keys().any(|key| {
            matches!(
                key.as_str(),
                "input_tokens"
                    | "output_tokens"
                    | "prompt_tokens"
                    | "completion_tokens"
                    | "cached_tokens"
                    | "cache_read"
                    | "cache_read_input_tokens"
                    | "cached_input_tokens"
            )
        })
}

fn haider_projection_probe_pipe_usage(path: &Path) -> bool {
    let Ok(file) = fs::File::open(path) else {
        return false;
    };
    let mut reader = std::io::BufReader::new(file);
    let mut line = Vec::new();
    loop {
        match haider_projection_read_pipe_line(&mut reader, &mut line) {
            Ok(HaiderProjectionPipeLine::Complete {
                within_limit: true, ..
            }) => {
                if serde_json::from_slice::<Value>(&line)
                    .ok()
                    .is_some_and(|value| haider_projection_pipe_usage_value(&value))
                {
                    return true;
                }
            }
            Ok(HaiderProjectionPipeLine::Complete {
                within_limit: false,
                ..
            }) => {}
            Ok(HaiderProjectionPipeLine::Torn | HaiderProjectionPipeLine::Eof) | Err(_) => {
                return false;
            }
        }
    }
}

fn haider_projection_pipe_has_usage(path: &Path) -> bool {
    haider_projection_cached_pipe_usage(haider_projection_pipe_usage_capability(), || {
        haider_projection_probe_pipe_usage(path)
    })
}

fn haider_projection_ready_endpoint(output: &str) -> Option<PathBuf> {
    let (_, suffix) = output.trim().split_once(" at ")?;
    let (path, _) = suffix.split_once(" (daemon v")?;
    let path = PathBuf::from(path.trim());
    path.is_absolute().then_some(path)
}

fn haider_projection_daemon_endpoint() -> Result<PathBuf, String> {
    let mut command = Command::new("haider");
    command.arg("--ready");
    let Some((true, stdout, _)) = haider_run_capture(command) else {
        return Err("Haider daemon endpoint was unavailable.".to_string());
    };
    haider_projection_ready_endpoint(&String::from_utf8_lossy(&stdout))
        .ok_or_else(|| "Haider daemon endpoint announcement was invalid.".to_string())
}

#[cfg(unix)]
fn haider_projection_rpc_write(
    stream: &mut std::os::unix::net::UnixStream,
    value: &Value,
) -> Result<(), String> {
    let body = serde_json::to_vec(value)
        .map_err(|error| format!("Unable to encode Haider RPC frame: {error}"))?;
    let length =
        u32::try_from(body.len()).map_err(|_| "Haider RPC frame was too large.".to_string())?;
    stream
        .write_all(&length.to_be_bytes())
        .and_then(|_| stream.write_all(&body))
        .map_err(|error| format!("Unable to write Haider RPC frame: {error}"))
}

#[cfg(unix)]
fn haider_projection_rpc_read(
    stream: &mut std::os::unix::net::UnixStream,
) -> Result<Value, String> {
    let mut prefix = [0_u8; 4];
    stream
        .read_exact(&mut prefix)
        .map_err(|error| format!("Unable to read Haider RPC frame: {error}"))?;
    let length = u32::from_be_bytes(prefix) as usize;
    if length == 0 || length > HAIDER_BRIDGE_MAX_JSON_BYTES as usize {
        return Err("Haider RPC frame length was invalid.".to_string());
    }
    let mut body = vec![0_u8; length];
    stream
        .read_exact(&mut body)
        .map_err(|error| format!("Unable to read Haider RPC body: {error}"))?;
    serde_json::from_slice(&body)
        .map_err(|error| format!("Unable to decode Haider RPC frame: {error}"))
}

#[cfg(unix)]
fn haider_projection_rpc_response(
    stream: &mut std::os::unix::net::UnixStream,
    request_id: &str,
    method: &str,
) -> Result<Value, String> {
    for _ in 0..8 {
        let value = haider_projection_rpc_read(stream)?;
        let Some(object) = value.as_object() else {
            continue;
        };
        if object.get("kind").and_then(Value::as_str) != Some("response")
            || object.get("request_id").and_then(Value::as_str) != Some(request_id)
        {
            continue;
        }
        let body = object
            .get("body")
            .and_then(Value::as_object)
            .ok_or_else(|| "Haider RPC response body was missing.".to_string())?;
        if body.get("method").and_then(Value::as_str) == Some("error") {
            return Err("Haider RPC rejected the request.".to_string());
        }
        if body.get("method").and_then(Value::as_str) != Some(method) {
            return Err("Haider RPC response method did not match.".to_string());
        }
        return Ok(Value::Object(body.clone()));
    }
    Err("Haider RPC response was unavailable.".to_string())
}

#[cfg(unix)]
fn haider_projection_resolve_pipe_route_rpc(
    provider_session_id: &str,
) -> Result<HaiderProjectionPipeRoute, String> {
    let endpoint = haider_projection_daemon_endpoint()?;
    let mut stream = std::os::unix::net::UnixStream::connect(endpoint)
        .map_err(|error| format!("Unable to connect to Haider RPC: {error}"))?;
    stream
        .set_read_timeout(Some(HAIDER_PROJECTION_RPC_TIMEOUT))
        .and_then(|_| stream.set_write_timeout(Some(HAIDER_PROJECTION_RPC_TIMEOUT)))
        .map_err(|error| format!("Unable to configure Haider RPC: {error}"))?;
    haider_projection_rpc_write(
        &mut stream,
        &json!({
            "v": 1,
            "kind": "hello",
            "protocol_min": 1,
            "protocol_max": 1,
            "client_name": "rust-diffforge",
            "client_version": env!("CARGO_PKG_VERSION"),
            "client_instance_id": format!("projection-{}", std::process::id()),
            "client_kind": "gui",
            "capabilities_requested": ["view"],
            "max_receive_frame": HAIDER_BRIDGE_MAX_JSON_BYTES,
        }),
    )?;
    let welcome = haider_projection_rpc_read(&mut stream)?;
    if welcome.get("kind").and_then(Value::as_str) != Some("welcome")
        || !haider_projection_pipe_feature(&welcome)
    {
        return Err("Haider daemon does not advertise pipe_native_v2.".to_string());
    }

    let path_request_id = "diffforge-pipe-path";
    haider_projection_rpc_write(
        &mut stream,
        &json!({
            "v": 1,
            "kind": "request",
            "request_id": path_request_id,
            "body": {
                "method": "session.pipe_path",
                "session_id": provider_session_id,
            },
        }),
    )?;
    let path_response =
        haider_projection_rpc_response(&mut stream, path_request_id, "session.pipe_path")?;
    let path = path_response
        .get("path")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| "Haider pipe path response was invalid.".to_string())?;

    let head_request_id = "diffforge-session-head";
    haider_projection_rpc_write(
        &mut stream,
        &json!({
            "v": 1,
            "kind": "request",
            "request_id": head_request_id,
            "body": {
                "method": "session.observe",
                "session_id": provider_session_id,
                "last_event_limit": 0,
            },
        }),
    )?;
    let head_response =
        haider_projection_rpc_response(&mut stream, head_request_id, "session.observe")?;
    let head_seq = head_response
        .get("digest")
        .and_then(Value::as_object)
        .and_then(|digest| haider_projection_json_i64(digest.get("head_seq")));
    if let Some(head_seq) = head_seq {
        haider_bridge_note_head_seq(provider_session_id, head_seq);
    }
    Ok(HaiderProjectionPipeRoute { path, head_seq })
}

#[cfg(not(unix))]
fn haider_projection_resolve_pipe_route_rpc(
    _provider_session_id: &str,
) -> Result<HaiderProjectionPipeRoute, String> {
    Err("Haider pipe RPC is unavailable on this platform.".to_string())
}

fn haider_projection_resolve_pipe_route(
    provider_session_id: &str,
) -> Result<HaiderProjectionPipeRoute, String> {
    if !haider_projection_pipe_supported() {
        return Err("Haider native pipe capability is unavailable.".to_string());
    }
    haider_projection_resolve_pipe_route_rpc(provider_session_id)
}

fn haider_projection_parse_pipe_header(
    value: &Value,
    provider_session_id: &str,
) -> Result<HaiderProjectionPipeHeader, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "Haider pipe header was not an object.".to_string())?;
    if object.get("pipe").and_then(Value::as_str) != Some("haider.session.jsonl") {
        return Err("Haider pipe header magic was invalid.".to_string());
    }
    let version = haider_projection_json_i64(object.get("version"))
        .ok_or_else(|| "Haider pipe header version was missing.".to_string())?;
    if version != 2 {
        return Err(format!("Unsupported Haider pipe version {version}."));
    }
    let session_id = object
        .get("session_id")
        .and_then(Value::as_str)
        .filter(|session_id| *session_id == provider_session_id)
        .ok_or_else(|| "Haider pipe header session id did not match.".to_string())?;
    let generation = haider_projection_json_i64(object.get("generation"))
        .filter(|generation| *generation > 0)
        .ok_or_else(|| "Haider pipe header generation was invalid.".to_string())?;
    Ok(HaiderProjectionPipeHeader {
        session_id: session_id.to_string(),
        generation,
    })
}

fn haider_projection_read_pipe_line(
    reader: &mut impl BufRead,
    output: &mut Vec<u8>,
) -> std::io::Result<HaiderProjectionPipeLine> {
    output.clear();
    let mut consumed = 0_i64;
    let mut overflow = false;
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return Ok(if consumed == 0 {
                HaiderProjectionPipeLine::Eof
            } else {
                HaiderProjectionPipeLine::Torn
            });
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(buffer.len(), |index| index + 1);
        let content = &buffer[..newline.unwrap_or(buffer.len())];
        if !overflow {
            let available = HAIDER_PROJECTION_MAX_LINE_BYTES.saturating_sub(output.len());
            output.extend_from_slice(&content[..content.len().min(available)]);
            overflow = content.len() > available;
        }
        reader.consume(take);
        consumed = consumed.saturating_add(i64::try_from(take).unwrap_or(i64::MAX));
        if newline.is_some() {
            return Ok(HaiderProjectionPipeLine::Complete {
                consumed,
                within_limit: !overflow,
            });
        }
    }
}

fn haider_projection_pipe_requires_refold(
    cursor: Option<&HaiderProjectionPipeCursor>,
    header: &HaiderProjectionPipeHeader,
    header_end: i64,
    file_len: i64,
) -> bool {
    cursor.is_none_or(|cursor| {
        cursor.generation != header.generation
            || cursor.byte_offset < header_end
            || cursor.byte_offset > file_len
    })
}

fn haider_projection_pipe_coverage(
    covered_through_seq: i64,
    value: &Value,
    generation: i64,
) -> Result<Option<i64>, String> {
    let Some(object) = value.as_object() else {
        return Ok(None);
    };
    let Some(coverage) = haider_projection_json_i64(object.get("coverage")) else {
        return Ok(None);
    };
    let line_generation = haider_projection_json_i64(object.get("generation"))
        .ok_or_else(|| "Haider pipe coverage generation was missing.".to_string())?;
    if line_generation != generation {
        return Err("Haider pipe coverage generation changed mid-file.".to_string());
    }
    Ok(Some(covered_through_seq.max(coverage)))
}

fn haider_projection_pipe_row_identity(value: &Value) -> Result<Option<(i64, i64)>, String> {
    let Some(object) = value.as_object() else {
        return Ok(None);
    };
    let projected_role = object
        .get("role")
        .and_then(Value::as_str)
        .is_some_and(|role| matches!(role, "user" | "assistant" | "tool" | "error"));
    if !projected_role && !haider_projection_pipe_usage_value(value) {
        return Ok(None);
    }
    let seq = haider_projection_json_i64(object.get("seq"))
        .ok_or_else(|| "Haider pipe row seq was missing.".to_string())?;
    let ordinal = haider_projection_json_i64(object.get("ordinal"))
        .ok_or_else(|| "Haider pipe row ordinal was missing.".to_string())?;
    Ok(Some((seq, ordinal)))
}

fn haider_projection_ingest_pipe(
    session_id: &str,
    provider_session_id: &str,
    route: &HaiderProjectionPipeRoute,
) -> Result<HaiderProjectionFrame, String> {
    if let Some(head_seq) = route.head_seq {
        haider_bridge_note_head_seq(provider_session_id, head_seq);
    }
    let file = fs::File::open(&route.path)
        .map_err(|error| format!("Unable to open Haider session pipe: {error}"))?;
    let file_len = i64::try_from(
        file.metadata()
            .map_err(|error| format!("Unable to inspect Haider session pipe: {error}"))?
            .len(),
    )
    .unwrap_or(i64::MAX);
    let mut reader = std::io::BufReader::new(file);
    let mut line = Vec::new();
    let header_end = match haider_projection_read_pipe_line(&mut reader, &mut line)
        .map_err(|error| format!("Unable to read Haider pipe header: {error}"))?
    {
        HaiderProjectionPipeLine::Complete {
            consumed,
            within_limit: true,
        } => consumed,
        _ => return Err("Haider pipe header was absent or incomplete.".to_string()),
    };
    let header_value: Value = serde_json::from_slice(&line)
        .map_err(|error| format!("Unable to decode Haider pipe header: {error}"))?;
    let header = haider_projection_parse_pipe_header(&header_value, provider_session_id)?;

    let existing = haider_projection_load_pipe_cursor(session_id)?;
    let reset =
        haider_projection_pipe_requires_refold(existing.as_ref(), &header, header_end, file_len);
    let mut cursor = if reset {
        let cursor = HaiderProjectionPipeCursor {
            session_id: session_id.to_string(),
            byte_offset: header_end,
            generation: header.generation,
            ..HaiderProjectionPipeCursor::default()
        };
        haider_projection_reset_pipe_session(session_id, &cursor)?;
        cursor
    } else {
        existing.unwrap_or_default()
    };
    reader
        .seek(SeekFrom::Start(cursor.byte_offset.max(0) as u64))
        .map_err(|error| format!("Unable to resume Haider session pipe: {error}"))?;
    haider_projection_initialize_state(session_id)?;

    let mut rows = Vec::new();
    let mut line_count = 0usize;
    let mut appended = 0usize;
    let mut total_rows = haider_projection_database_stats(session_id)?.0;
    let mut from_seq = None;
    let mut advanced = false;
    let mut consumed_to_eof = false;

    loop {
        let consumed = match haider_projection_read_pipe_line(&mut reader, &mut line)
            .map_err(|error| format!("Unable to read Haider session pipe: {error}"))?
        {
            HaiderProjectionPipeLine::Complete {
                consumed,
                within_limit: true,
            } => consumed,
            HaiderProjectionPipeLine::Complete {
                within_limit: false,
                ..
            } => return Err("Haider pipe line exceeded the projection read cap.".to_string()),
            HaiderProjectionPipeLine::Torn => break,
            HaiderProjectionPipeLine::Eof => {
                consumed_to_eof = true;
                break;
            }
        };
        let value: Value = serde_json::from_slice(&line)
            .map_err(|error| format!("Unable to decode Haider pipe line: {error}"))?;
        if let Some(coverage) =
            haider_projection_pipe_coverage(cursor.covered_through_seq, &value, header.generation)?
        {
            cursor.covered_through_seq = coverage;
            cursor.coverage_known = true;
        } else if let Some((seq, ordinal)) = haider_projection_pipe_row_identity(&value)? {
            // Observed v2: text rows carry role/text/at_ms/seq/ordinal;
            // tool rows use name/summary; branch_id is present only off-main.
            let step = {
                let mut states = haider_projection_states()
                    .lock()
                    .map_err(|_| "Session projection state is unavailable.".to_string())?;
                let state = states
                    .get_mut(session_id)
                    .ok_or_else(|| "Session projection state was not initialized.".to_string())?;
                haider_projection_fold_value_locked(state, session_id, &value)
            };
            rows.extend(step.rows);
            cursor.last_seq = cursor.last_seq.max(seq);
            cursor.last_ordinal = ordinal;
        }
        cursor.byte_offset = cursor.byte_offset.saturating_add(consumed);
        advanced = true;
        line_count = line_count.saturating_add(1);

        if line_count >= HAIDER_PROJECTION_PIPE_BATCH_LINES {
            let batch_from = rows.iter().map(|row| row.seq).min();
            let (batch_appended, persisted_total) =
                haider_projection_persist_batch(session_id, &rows, Some(&cursor))?;
            appended = appended.saturating_add(batch_appended);
            total_rows = persisted_total;
            from_seq = match (from_seq, batch_from.filter(|_| batch_appended > 0)) {
                (Some(left), Some(right)) => Some(left.min(right)),
                (None, value) | (value, None) => value,
            };
            rows.clear();
            line_count = 0;
        }
    }

    if advanced && (line_count > 0 || !rows.is_empty()) {
        let batch_from = rows.iter().map(|row| row.seq).min();
        let (batch_appended, persisted_total) =
            haider_projection_persist_batch(session_id, &rows, Some(&cursor))?;
        appended = appended.saturating_add(batch_appended);
        total_rows = persisted_total;
        from_seq = match (from_seq, batch_from.filter(|_| batch_appended > 0)) {
            (Some(left), Some(right)) => Some(left.min(right)),
            (None, value) | (value, None) => value,
        };
    }
    if let Ok(mut states) = haider_projection_states().lock() {
        if let Some(state) = states.get_mut(session_id) {
            state.total_rows = total_rows;
            state.pipe_eof_max_seq = consumed_to_eof.then_some(cursor.last_seq);
        }
    }
    let sync = haider_projection_sync(session_id, Some(provider_session_id))?;
    Ok(HaiderProjectionFrame {
        session_id: session_id.to_string(),
        from_seq,
        appended,
        total_rows,
        live_tail: None,
        tail_changed: reset,
        covered_through_seq: sync.covered_through_seq,
        head_seq: sync.head_seq,
        caught_up: sync.caught_up,
        sync_changed: reset || advanced,
    })
}

fn haider_projection_export_json(provider_session_id: &str) -> Result<Value, String> {
    let mut child = Command::new("haider")
        .args(["export", provider_session_id, "--format", "json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Unable to start Haider export: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Haider export stdout was unavailable.".to_string())?;
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout
            .take(HAIDER_PROJECTION_MAX_EXPORT_BYTES.saturating_add(1))
            .read_to_end(&mut bytes);
        bytes
    });
    let started_at = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if started_at.elapsed() < HAIDER_PROJECTION_EXPORT_TIMEOUT => {
                thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("Haider export timed out.".to_string());
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(format!("Unable to wait for Haider export: {error}"));
            }
        }
    }?;
    let bytes = reader
        .join()
        .map_err(|_| "Haider export reader failed.".to_string())?;
    if !status.success() {
        return Err(format!("Haider export failed with status {status}."));
    }
    if bytes.len() as u64 > HAIDER_PROJECTION_MAX_EXPORT_BYTES {
        return Err("Haider export exceeded the projection read cap.".to_string());
    }
    serde_json::from_slice(&bytes)
        .or_else(|_| {
            let values = bytes
                .split(|byte| *byte == b'\n')
                .filter(|line| !line.iter().all(u8::is_ascii_whitespace))
                .map(serde_json::from_slice)
                .collect::<Result<Vec<Value>, _>>()?;
            Ok::<Value, serde_json::Error>(Value::Array(values))
        })
        .map_err(|error| format!("Unable to decode Haider export JSON: {error}"))
}

fn haider_projection_resolve_provider_session(
    session_id: &str,
) -> Result<(SessionRow, String), String> {
    let connection = sessions_open_database()?;
    let row = sessions_row_by_id(&connection, session_id.trim())?;
    let provider_session_id = row.provider_session_id.trim().to_string();
    if provider_session_id.is_empty() {
        return Err("Haider session id is not bound yet.".to_string());
    }
    Ok((row, provider_session_id))
}

fn haider_projection_watch_finished(session_id: &str, generation: u64) {
    if let Ok(mut manager) = haider_projection_watch_manager().lock() {
        if manager
            .watches
            .get(session_id)
            .is_some_and(|watch| watch.generation == generation)
        {
            manager.watches.remove(session_id);
        }
    }
}

fn haider_projection_stop_session_watch(session_id: &str) -> Result<(), String> {
    let child = haider_projection_watch_manager()
        .lock()
        .map_err(|_| "Haider projection watch manager is unavailable.".to_string())?
        .watches
        .remove(session_id)
        .map(|watch| watch.child);
    if let Some(child) = child {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    }
    Ok(())
}

fn haider_projection_watch_metadata(value: &Value) -> bool {
    let payload = haider_projection_payload(value);
    payload
        .as_object()
        .and_then(|object| haider_projection_text(object.get("type")))
        .is_some_and(|kind| matches!(kind.as_str(), "usage" | "run_state" | "session_state"))
}

fn haider_projection_start_watch(
    app: AppHandle,
    session_id: String,
    provider_session_id: String,
    baseline_seq: i64,
    metadata_only: bool,
) -> Result<(), String> {
    if haider_projection_pipe_usage_capability()
        .get()
        .copied()
        .unwrap_or(false)
        && haider_projection_pipe_manager()
            .lock()
            .is_ok_and(|manager| manager.tails.contains_key(&session_id))
    {
        return Ok(());
    }
    if let Ok(mut manager) = haider_projection_watch_manager().lock() {
        manager.clock = manager.clock.saturating_add(1);
        let touched = manager.clock;
        if let Some(watch) = manager.watches.get_mut(&session_id) {
            watch.touched = touched;
            watch.metadata_only.store(metadata_only, Ordering::Release);
            return Ok(());
        }
    }

    // Per-session watch was selected over `events --follow`: v0.0.928 emits
    // the same lossless raw envelopes (including ItemDelta payloads) while
    // avoiding a global replay/filter process for every attached UI view.
    let mut child = Command::new("haider")
        .args(["session", &provider_session_id, "--watch"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Unable to start Haider session watch: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Haider session watch stdout was unavailable.".to_string())?;
    let child = Arc::new(StdMutex::new(child));
    let metadata_only = Arc::new(AtomicBool::new(metadata_only));
    let generation = HAIDER_PROJECTION_WATCH_GENERATION.fetch_add(1, Ordering::Relaxed);
    let (duplicate, evicted) = {
        let mut manager = match haider_projection_watch_manager().lock() {
            Ok(manager) => manager,
            Err(_) => {
                if let Ok(mut child) = child.lock() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                return Err("Haider projection watch manager is unavailable.".to_string());
            }
        };
        manager.clock = manager.clock.saturating_add(1);
        let touched = manager.clock;
        if let Some(watch) = manager.watches.get_mut(&session_id) {
            watch.touched = touched;
            watch
                .metadata_only
                .store(metadata_only.load(Ordering::Acquire), Ordering::Release);
            (true, None)
        } else {
            let evicted = if manager.watches.len() >= HAIDER_PROJECTION_WATCH_LIMIT {
                manager
                    .watches
                    .iter()
                    .min_by_key(|(_, watch)| watch.touched)
                    .map(|(id, _)| id.clone())
                    .and_then(|id| manager.watches.remove(&id))
            } else {
                None
            };
            manager.watches.insert(
                session_id.clone(),
                HaiderProjectionWatch {
                    child: child.clone(),
                    metadata_only: metadata_only.clone(),
                    generation,
                    touched,
                },
            );
            (false, evicted)
        }
    };
    if duplicate {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        return Ok(());
    }
    if let Some(evicted) = evicted {
        if let Ok(mut child) = evicted.child.lock() {
            let _ = child.kill();
        }
    }

    thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stdout);
        let mut line = Vec::new();
        while !HAIDER_PROJECTION_STOPPING.load(Ordering::Acquire) {
            match haider_projection_read_capped_line(&mut reader, &mut line) {
                Ok(Some(true)) => {
                    let Ok(value) = serde_json::from_slice::<Value>(&line) else {
                        continue;
                    };
                    let seq = value
                        .as_object()
                        .and_then(|object| haider_projection_json_i64(object.get("seq")))
                        .unwrap_or(0);
                    if seq > 0 {
                        haider_bridge_note_head_seq(&provider_session_id, seq);
                    }
                    let metadata_mode = metadata_only.load(Ordering::Acquire);
                    if metadata_mode && !haider_projection_watch_metadata(&value) {
                        continue;
                    }
                    if !metadata_mode && seq > 0 && seq <= baseline_seq {
                        continue;
                    }
                    haider_projection_ingest_and_emit(&app, &session_id, &value);
                }
                Ok(Some(false)) => continue,
                Ok(None) | Err(_) => break,
            }
        }
        if let Ok(mut child) = child.lock() {
            if HAIDER_PROJECTION_STOPPING.load(Ordering::Acquire) {
                let _ = child.kill();
            }
            let _ = child.wait();
        }
        haider_projection_watch_finished(&session_id, generation);
    });
    Ok(())
}

fn haider_projection_pipe_finished(session_id: &str, generation: u64) {
    if let Ok(mut manager) = haider_projection_pipe_manager().lock() {
        if manager
            .tails
            .get(session_id)
            .is_some_and(|tail| tail.generation == generation)
        {
            manager.tails.remove(session_id);
        }
    }
}

#[cfg(target_os = "macos")]
struct HaiderProjectionPipeWatcher {
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

#[cfg(target_os = "macos")]
impl Drop for HaiderProjectionPipeWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(not(target_os = "macos"))]
struct HaiderProjectionPipeWatcher {
    _watcher: notify::RecommendedWatcher,
}

#[cfg(target_os = "macos")]
fn haider_projection_pipe_open(path: &Path) -> Option<libc::c_int> {
    use std::os::unix::ffi::OsStrExt as _;

    let path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    // SAFETY: `path` is NUL-terminated and remains live for the call.
    let fd = unsafe { libc::open(path.as_ptr(), libc::O_EVTONLY | libc::O_CLOEXEC) };
    (fd >= 0).then_some(fd)
}

#[cfg(target_os = "macos")]
fn haider_projection_pipe_kqueue_register(kqueue: libc::c_int, fd: libc::c_int) -> bool {
    let change = libc::kevent {
        ident: fd as libc::uintptr_t,
        filter: libc::EVFILT_VNODE,
        flags: libc::EV_ADD | libc::EV_ENABLE | libc::EV_CLEAR,
        fflags: libc::NOTE_WRITE
            | libc::NOTE_EXTEND
            | libc::NOTE_ATTRIB
            | libc::NOTE_RENAME
            | libc::NOTE_DELETE
            | libc::NOTE_REVOKE,
        data: 0,
        udata: std::ptr::null_mut(),
    };
    // SAFETY: `change` is initialized and no output buffer is requested.
    unsafe {
        libc::kevent(
            kqueue,
            &change,
            1,
            std::ptr::null_mut(),
            0,
            std::ptr::null(),
        ) == 0
    }
}

#[cfg(target_os = "macos")]
fn haider_projection_pipe_watcher(
    path: &Path,
) -> Option<(HaiderProjectionPipeWatcher, std::sync::mpsc::Receiver<()>)> {
    let file_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let parent_path = file_path.parent()?.to_path_buf();
    let parent_fd = haider_projection_pipe_open(&parent_path)?;
    let mut file_fd = haider_projection_pipe_open(&file_path);
    // SAFETY: `kqueue` has no preconditions.
    let kqueue = unsafe { libc::kqueue() };
    if kqueue < 0 || !haider_projection_pipe_kqueue_register(kqueue, parent_fd) {
        // SAFETY: descriptors were opened above and are owned here.
        unsafe {
            libc::close(parent_fd);
            if kqueue >= 0 {
                libc::close(kqueue);
            }
        }
        return None;
    }
    if file_fd.is_some_and(|fd| !haider_projection_pipe_kqueue_register(kqueue, fd)) {
        if let Some(fd) = file_fd.take() {
            // SAFETY: `fd` is owned here and will not be reused.
            unsafe { libc::close(fd) };
        }
    }

    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    let watcher_thread = thread::spawn(move || {
        while !thread_stop.load(Ordering::Acquire) {
            // SAFETY: zero is a valid empty event output buffer.
            let mut event: libc::kevent = unsafe { std::mem::zeroed() };
            let timeout = libc::timespec {
                tv_sec: 0,
                tv_nsec: 100_000_000,
            };
            // SAFETY: output and timeout pointers remain valid for the call.
            let count =
                unsafe { libc::kevent(kqueue, std::ptr::null(), 0, &mut event, 1, &timeout) };
            if count < 0 {
                break;
            }
            if count == 0 {
                continue;
            }
            // `kevent` is packed on macOS; copy fields without references.
            let ident = unsafe { std::ptr::addr_of!(event.ident).read_unaligned() };
            let flags = unsafe { std::ptr::addr_of!(event.fflags).read_unaligned() };
            let file_replaced = file_fd.is_some_and(|fd| {
                ident == fd as libc::uintptr_t
                    && flags & (libc::NOTE_RENAME | libc::NOTE_DELETE | libc::NOTE_REVOKE) != 0
            });
            if ident == parent_fd as libc::uintptr_t || file_replaced {
                if let Some(fd) = file_fd.take() {
                    // SAFETY: the watcher thread owns the descriptor.
                    unsafe { libc::close(fd) };
                }
                file_fd = haider_projection_pipe_open(&file_path).and_then(|fd| {
                    if haider_projection_pipe_kqueue_register(kqueue, fd) {
                        Some(fd)
                    } else {
                        // SAFETY: registration failed and the descriptor is unused.
                        unsafe { libc::close(fd) };
                        None
                    }
                });
            }
            if sender.send(()).is_err() {
                break;
            }
        }
        // SAFETY: the watcher thread owns each remaining descriptor.
        unsafe {
            if let Some(fd) = file_fd {
                libc::close(fd);
            }
            libc::close(parent_fd);
            libc::close(kqueue);
        }
    });
    Some((
        HaiderProjectionPipeWatcher {
            stop,
            thread: Some(watcher_thread),
        },
        receiver,
    ))
}

#[cfg(not(target_os = "macos"))]
fn haider_projection_pipe_watcher(
    path: &Path,
) -> Option<(HaiderProjectionPipeWatcher, std::sync::mpsc::Receiver<()>)> {
    use notify::Watcher as _;

    let (sender, receiver) = std::sync::mpsc::channel();
    let event_path = path.to_path_buf();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event
            .as_ref()
            .is_ok_and(|event| haider_projection_pipe_event_matches(event, &event_path))
        {
            let _ = sender.send(());
        }
    })
    .ok()?;
    let watched_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let watched_file = watcher
        .watch(&watched_path, notify::RecursiveMode::NonRecursive)
        .is_ok();
    let watched_parent = watched_path.parent().is_some_and(|parent| {
        watcher
            .watch(parent, notify::RecursiveMode::NonRecursive)
            .is_ok()
    });
    (watched_file || watched_parent)
        .then_some((HaiderProjectionPipeWatcher { _watcher: watcher }, receiver))
}

#[cfg(not(target_os = "macos"))]
fn haider_projection_pipe_event_matches(event: &notify::Event, path: &Path) -> bool {
    let watched_name = path.file_name();
    matches!(
        event.kind,
        notify::EventKind::Any
            | notify::EventKind::Create(_)
            | notify::EventKind::Modify(_)
            | notify::EventKind::Remove(_)
    ) && (event.paths.is_empty()
        || event.paths.iter().any(|changed| {
            changed == path || watched_name.is_some_and(|name| changed.file_name() == Some(name))
        }))
}

#[cfg(test)]
fn haider_projection_wait_for_pipe_event(
    receiver: &std::sync::mpsc::Receiver<()>,
    _path: &Path,
    timeout: Duration,
) -> bool {
    receiver.recv_timeout(timeout).is_ok()
}

fn haider_projection_start_pipe_tail(
    app: AppHandle,
    session_id: String,
    provider_session_id: String,
    route: HaiderProjectionPipeRoute,
) -> Result<(), String> {
    let generation = HAIDER_PROJECTION_WATCH_GENERATION.fetch_add(1, Ordering::Relaxed);
    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut manager = haider_projection_pipe_manager()
            .lock()
            .map_err(|_| "Haider projection pipe manager is unavailable.".to_string())?;
        if manager.tails.contains_key(&session_id) {
            return Ok(());
        }
        manager.tails.insert(
            session_id.clone(),
            HaiderProjectionPipeTail {
                stop: stop.clone(),
                generation,
            },
        );
    }
    thread::spawn(move || {
        let watcher = haider_projection_pipe_watcher(&route.path);
        let (_watcher, mut receiver) = match watcher {
            Some((watcher, receiver)) => (Some(watcher), Some(receiver)),
            None => (None, None),
        };
        // Fold once immediately so startup events cannot fall into watcher setup.
        let mut next_safety_poll = Instant::now();
        while !HAIDER_PROJECTION_STOPPING.load(Ordering::Acquire) && !stop.load(Ordering::Acquire) {
            let wait = next_safety_poll
                .saturating_duration_since(Instant::now())
                .min(HAIDER_PROJECTION_PIPE_STOP_POLL);
            let event_fired = match receiver.as_ref() {
                Some(events) => match events.recv_timeout(wait) {
                    Ok(()) => true,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => false,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        receiver = None;
                        false
                    }
                },
                None => {
                    thread::sleep(wait);
                    false
                }
            };
            if HAIDER_PROJECTION_STOPPING.load(Ordering::Acquire) || stop.load(Ordering::Acquire) {
                break;
            }
            let safety_poll = Instant::now() >= next_safety_poll;
            if !event_fired && !safety_poll {
                continue;
            }
            next_safety_poll = Instant::now() + HAIDER_PROJECTION_PIPE_SAFETY_POLL;
            match haider_projection_ingest_pipe(&session_id, &provider_session_id, &route) {
                Ok(frame) if frame.appended > 0 || frame.tail_changed || frame.sync_changed => {
                    let _ = haider_projection_frame_sender(&app).send(frame);
                }
                Ok(_) => {}
                Err(error) => eprintln!("Haider projection pipe tail failed: {error}"),
            }
        }
        haider_projection_pipe_finished(&session_id, generation);
    });
    Ok(())
}

fn haider_projection_attach_blocking(app: AppHandle, session_id: String) -> Result<(), String> {
    let _attach_guard = haider_projection_attach_lock()
        .lock()
        .map_err(|_| "Haider projection attach lock is unavailable.".to_string())?;
    let (_, provider_session_id) = haider_projection_resolve_provider_session(&session_id)?;
    let (_, baseline_seq) = haider_projection_database_stats(&session_id)?;
    HAIDER_PROJECTION_STOPPING.store(false, Ordering::Release);

    if let Ok(manager) = haider_projection_pipe_manager().lock() {
        if manager.tails.contains_key(&session_id) {
            drop(manager);
            if haider_projection_pipe_usage_capability()
                .get()
                .copied()
                .unwrap_or(false)
            {
                haider_projection_stop_session_watch(&session_id)?;
                return Ok(());
            }
            return haider_projection_start_watch(
                app,
                session_id,
                provider_session_id,
                baseline_seq,
                true,
            );
        }
    }
    if let Ok(route) = haider_projection_resolve_pipe_route(&provider_session_id) {
        let pipe_has_usage = haider_projection_pipe_has_usage(&route.path);
        if let Ok(frame) = haider_projection_ingest_pipe(&session_id, &provider_session_id, &route)
        {
            if frame.appended > 0 || frame.tail_changed || frame.sync_changed {
                let _ = haider_projection_frame_sender(&app).send(frame);
            }
            haider_projection_start_pipe_tail(
                app.clone(),
                session_id.clone(),
                provider_session_id.clone(),
                route,
            )?;
            if pipe_has_usage {
                haider_projection_stop_session_watch(&session_id)?;
                return Ok(());
            }
            // v2 sidecars have no usage/run-state rows. Keep one filtered watch
            // for trajectory lanes and status, never transcript projection.
            return haider_projection_start_watch(
                app,
                session_id,
                provider_session_id,
                baseline_seq,
                true,
            );
        }
    }

    haider_projection_start_watch(app, session_id, provider_session_id, baseline_seq, false)
}

fn haider_projection_stop() {
    HAIDER_PROJECTION_STOPPING.store(true, Ordering::Release);
    if let Ok(mut manager) = haider_projection_pipe_manager().lock() {
        for (_, tail) in manager.tails.drain() {
            tail.stop.store(true, Ordering::Release);
        }
    }
    let children = haider_projection_watch_manager()
        .lock()
        .ok()
        .map(|mut manager| {
            manager
                .watches
                .drain()
                .map(|(_, watch)| watch.child)
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
async fn session_projection_window(
    session_id: String,
    start_index: i64,
    count: i64,
) -> Result<SessionProjectionWindow, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session_id = session_id.trim();
        let start_index = start_index.max(0);
        let count = count.clamp(0, HAIDER_PROJECTION_MAX_WINDOW_ROWS);
        let connection = haider_projection_open_database()?;
        let total_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM session_projection_rows WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Unable to count session projection rows: {error}"))?;
        let mut statement = connection
            .prepare(
                "SELECT session_id, seq, ordinal, branch_id, kind, role, text, meta, at_ms
                 FROM session_projection_rows WHERE session_id = ?1
                 ORDER BY seq, ordinal LIMIT ?2 OFFSET ?3",
            )
            .map_err(|error| format!("Unable to prepare session projection window: {error}"))?;
        let rows = statement
            .query_map(rusqlite::params![session_id, count, start_index], |row| {
                let meta: String = row.get(7)?;
                Ok(SessionProjectionRow {
                    session_id: row.get(0)?,
                    seq: row.get(1)?,
                    ordinal: row.get(2)?,
                    branch_id: row.get(3)?,
                    kind: row.get(4)?,
                    role: row.get(5)?,
                    text: row.get(6)?,
                    meta: serde_json::from_str(&meta).unwrap_or_else(|_| json!({"raw": meta})),
                    at_ms: row.get(8)?,
                })
            })
            .map_err(|error| format!("Unable to read session projection window: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Unable to decode session projection row: {error}"))?;
        let live_tail = haider_projection_states().lock().ok().and_then(|states| {
            states
                .get(session_id)
                .and_then(|state| state.tail.as_ref())
                .map(|tail| tail.row.clone())
        });
        let provider_session_id = haider_projection_resolve_provider_session(session_id)
            .ok()
            .map(|(_, provider_session_id)| provider_session_id);
        let sync = haider_projection_sync(session_id, provider_session_id.as_deref())?;
        Ok(SessionProjectionWindow {
            total_rows,
            start_index,
            rows,
            live_tail,
            covered_through_seq: sync.covered_through_seq,
            head_seq: sync.head_seq,
            caught_up: sync.caught_up,
        })
    })
    .await
    .map_err(|error| format!("Session projection window worker failed: {error}"))?
}

/// Alias-tolerant token count: usage payload shapes differ across harness
/// versions and providers; nested "usage" objects are searched too.
fn haider_projection_usage_number(meta: &Value, keys: &[&str]) -> Option<i64> {
    let object = meta.as_object()?;
    for key in keys {
        if let Some(value) = object.get(*key).and_then(haider_projection_json_i64_value) {
            return Some(value);
        }
    }
    let nested = object.get("usage")?;
    let nested_object = nested.as_object()?;
    for key in keys {
        if let Some(value) = nested_object
            .get(*key)
            .and_then(haider_projection_json_i64_value)
        {
            return Some(value);
        }
    }
    None
}

fn haider_projection_json_i64_value(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_f64().map(|number| number as i64))
}

/// Lean full-session feed for the trajectory strip: one small point per row,
/// token/cache stats extracted server-side so the wire never carries payloads.
#[tauri::command(rename_all = "snake_case")]
async fn session_projection_trajectory(session_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session_id = session_id.trim().to_string();
        let connection = haider_projection_open_database()?;
        let mut statement = connection
            .prepare(
                "SELECT seq, ordinal, branch_id, kind, role, text, meta, at_ms
                 FROM session_projection_rows WHERE session_id = ?1
                 ORDER BY seq, ordinal",
            )
            .map_err(|error| format!("Unable to prepare session trajectory read: {error}"))?;
        let points = statement
            .query_map([&session_id], |row| {
                let seq: i64 = row.get(0)?;
                let ordinal: i64 = row.get(1)?;
                let branch_id: String = row.get(2)?;
                let kind: String = row.get(3)?;
                let role: String = row.get(4)?;
                let text: String = row.get(5)?;
                let meta_text: String = row.get(6)?;
                let at_ms: i64 = row.get(7)?;
                Ok((seq, ordinal, branch_id, kind, role, text, meta_text, at_ms))
            })
            .map_err(|error| format!("Unable to read session trajectory rows: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Unable to decode session trajectory row: {error}"))?
            .into_iter()
            .map(
                |(seq, ordinal, branch_id, kind, role, text, meta_text, at_ms)| {
                    let mut point = json!({
                        "seq": seq,
                        "ordinal": ordinal,
                        "branch_id": branch_id,
                        "kind": kind,
                        "role": role,
                        "at_ms": at_ms,
                        "label": haider_projection_compact(&text, 140),
                    });
                    if kind == "usage" {
                        let meta: Value = serde_json::from_str(&meta_text).unwrap_or(Value::Null);
                        let input = haider_projection_usage_number(
                            &meta,
                            &["input", "input_tokens", "prompt_tokens"],
                        );
                        let output = haider_projection_usage_number(
                            &meta,
                            &["output", "output_tokens", "completion_tokens"],
                        );
                        let cached = haider_projection_usage_number(
                            &meta,
                            &[
                                "cached",
                                "cached_tokens",
                                "cache_read",
                                "cache_read_input_tokens",
                                "cached_input",
                                "cached_input_tokens",
                            ],
                        );
                        if let Some(object) = point.as_object_mut() {
                            object.insert("input".to_string(), json!(input));
                            object.insert("output".to_string(), json!(output));
                            object.insert("cached".to_string(), json!(cached));
                        }
                    }
                    point
                },
            )
            .collect::<Vec<_>>();
        Ok(json!({ "points": points }))
    })
    .await
    .map_err(|error| format!("Session trajectory worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn session_projection_ensure(session_id: String) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _ensure_guard = haider_projection_ensure_lock()
            .lock()
            .map_err(|_| "Session projection ensure lock is unavailable.".to_string())?;
        let session_id = session_id.trim().to_string();
        let (total_rows, _) = haider_projection_database_stats(&session_id)?;
        let provider = haider_projection_resolve_provider_session(&session_id).ok();
        if let Some((_, provider_session_id)) = provider.as_ref() {
            if let Ok(route) = haider_projection_resolve_pipe_route(provider_session_id) {
                if haider_projection_ingest_pipe(&session_id, provider_session_id, &route).is_ok() {
                    return haider_projection_database_stats(&session_id).map(|(total, _)| total);
                }
            }
        }
        if total_rows > 0 {
            haider_projection_initialize_state(&session_id)?;
            return Ok(total_rows);
        }
        let (_, provider_session_id) =
            provider.ok_or_else(|| "Haider session id is not bound yet.".to_string())?;
        let export = haider_projection_export_json(&provider_session_id)?;
        let _ = haider_projection_ingest_value(None, &session_id, &export)?;
        haider_projection_database_stats(&session_id).map(|(total, _)| total)
    })
    .await
    .map_err(|error| format!("Session projection ensure worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn session_projection_attach(app: AppHandle, session_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        haider_projection_attach_blocking(app, session_id.trim().to_string())
    })
    .await
    .map_err(|error| format!("Session projection attach worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn session_projection_detach(session_id: String) -> Result<(), String> {
    if let Some(tail) = haider_projection_pipe_manager()
        .lock()
        .map_err(|_| "Haider projection pipe manager is unavailable.".to_string())?
        .tails
        .remove(session_id.trim())
    {
        tail.stop.store(true, Ordering::Release);
    }
    haider_projection_stop_session_watch(session_id.trim())
}

#[cfg(test)]
mod haider_projection_tests {
    use super::*;

    struct HaiderProjectionTestSession {
        session_id: String,
        provider_session_id: String,
    }

    impl Drop for HaiderProjectionTestSession {
        fn drop(&mut self) {
            if let Ok(connection) = haider_projection_open_database() {
                let _ = connection.execute(
                    "DELETE FROM session_projection_rows WHERE session_id = ?1",
                    [&self.session_id],
                );
                let _ = connection.execute(
                    "DELETE FROM session_pipe_cursors WHERE session_id = ?1",
                    [&self.session_id],
                );
            }
            if let Ok(mut states) = haider_projection_states().lock() {
                states.remove(&self.session_id);
            }
            if let Ok(mut heads) = haider_bridge_head_sequences().lock() {
                heads.remove(&self.provider_session_id);
            }
        }
    }

    fn haider_projection_test_session() -> HaiderProjectionTestSession {
        let suffix = uuid::Uuid::new_v4().simple().to_string();
        HaiderProjectionTestSession {
            session_id: format!("projection-test-{suffix}"),
            provider_session_id: format!("provider-test-{suffix}"),
        }
    }

    fn haider_projection_test_pipe_header(provider_session_id: &str, generation: i64) -> String {
        format!(
            "{}\n",
            json!({
                "pipe":"haider.session.jsonl",
                "version":2,
                "session_id":provider_session_id,
                "generation":generation
            })
        )
    }

    #[test]
    fn haider_projection_unknown_head_is_caught_up() {
        assert!(haider_projection_caught_up(None, Some(0), Some(0)));
    }

    #[test]
    fn haider_projection_unknown_coverage_is_honest() {
        assert!(haider_projection_caught_up(Some(9), None, None));
        assert!(haider_projection_caught_up(Some(9), None, Some(9)));
        assert!(!haider_projection_caught_up(Some(9), None, Some(8)));
    }

    #[test]
    fn haider_projection_known_coverage_reports_only_real_gaps() {
        assert!(haider_projection_caught_up(Some(9), Some(9), None));
        assert!(!haider_projection_caught_up(Some(9), Some(8), None));
    }

    #[test]
    fn haider_projection_folds_observed_export_shape_and_missing_seq() {
        // Shape captured from `haider export <id> --format json` v1. The
        // sandboxed test runner cannot connect to the user's daemon, so the
        // text is shortened while the observed public keys stay exact.
        let export = json!({
            "schema": "haider.export.v1",
            "session_id": "session-observed",
            "head_seq": 44,
            "turns": [
                {"role":"user", "text":"Review the parser", "at_ms":1700000000001_i64, "seq":7},
                {"role":"assistant", "text":"I found the issue.", "at_ms":1700000000002_i64, "seq":19},
                {"role":"tool", "name":"fs_read", "summary":"read src/parser.rs", "at_ms":1700000000003_i64}
            ]
        });
        let mut state = HaiderProjectionFoldState::default();
        let mut rows = Vec::new();
        for item in haider_projection_input_items(&export) {
            rows.extend(
                haider_projection_fold_value_locked(&mut state, "local-session", item).rows,
            );
        }
        assert_eq!(rows.len(), 3);
        assert_eq!((rows[0].seq, rows[0].role.as_str()), (7, "user"));
        assert_eq!((rows[1].seq, rows[1].role.as_str()), (19, "assistant"));
        assert_eq!((rows[2].seq, rows[2].kind.as_str()), (20, "tool"));
        assert_eq!(rows[2].text, "read src/parser.rs");
    }

    #[test]
    fn haider_projection_streaming_tail_is_mutable_until_completion() {
        // Raw envelope keys and item lifecycle captured from v0.0.928's real
        // store/watch wire shape; additive fields are deliberately omitted.
        let started = json!({
            "seq": 40,
            "committed_at_ms": 1700000000040_i64,
            "payload": {"type":"item", "event":"started", "item_id":"item-1",
                "item":{"item":"agent_message", "text":""}}
        });
        let delta = json!({
            "seq": 41,
            "committed_at_ms": 1700000000041_i64,
            "payload": {"type":"item", "event":"delta", "item_id":"item-1",
                "delta":{"delta":"text", "text":"Hello"}}
        });
        let completed = json!({
            "seq": 42,
            "committed_at_ms": 1700000000042_i64,
            "payload": {"type":"item", "event":"completed", "item_id":"item-1",
                "item":{"item":"agent_message", "text":"Hello world"}}
        });
        let mut state = HaiderProjectionFoldState::default();
        assert!(
            haider_projection_fold_value_locked(&mut state, "local", &started)
                .rows
                .is_empty()
        );
        assert!(
            haider_projection_fold_value_locked(&mut state, "local", &delta)
                .rows
                .is_empty()
        );
        assert_eq!(state.tail.as_ref().unwrap().row.text, "Hello");
        let sealed = haider_projection_fold_value_locked(&mut state, "local", &completed);
        assert_eq!(sealed.rows.len(), 1);
        assert_eq!(sealed.rows[0].seq, 42);
        assert_eq!(sealed.rows[0].text, "Hello world");
        assert!(state.tail.is_none());
    }

    #[test]
    fn haider_projection_usage_creates_trajectory_row_only() {
        let mut state = HaiderProjectionFoldState::default();
        let usage = haider_projection_fold_value_locked(
            &mut state,
            "local",
            &json!({"payload":{"type":"usage", "input":10, "output":3}}),
        );
        assert_eq!(usage.rows.len(), 1);
        assert_eq!(usage.rows[0].kind, "usage");
        for payload in [
            json!({"payload":{"type":"run_state", "state":"streaming"}}),
            json!({"payload":{"type":"session_state", "state":"idle"}}),
        ] {
            assert!(
                haider_projection_fold_value_locked(&mut state, "local", &payload)
                    .rows
                    .is_empty()
            );
        }
        assert!(state.metadata.contains_key("usage"));
        assert!(state.metadata.contains_key("run_state"));
        assert!(state.metadata.contains_key("session_state"));

        let object_state = haider_projection_fold_value_locked(
            &mut state,
            "local",
            &json!({"payload":{"type":"run_state", "state":{
                "status":"running_tool", "tool":"cargo"
            }}}),
        );
        assert_eq!(object_state.status.as_deref(), Some("running"));
        assert_eq!(
            object_state.state_raw.as_deref(),
            Some("running_tool: cargo")
        );
    }

    #[test]
    fn haider_projection_pipe_usage_probe_is_cached() {
        let cache = OnceLock::new();
        let probes = AtomicUsize::new(0);
        for _ in 0..2 {
            assert!(!haider_projection_cached_pipe_usage(&cache, || {
                probes.fetch_add(1, Ordering::Relaxed);
                false
            }));
        }
        assert_eq!(probes.load(Ordering::Relaxed), 1);
        assert!(haider_projection_pipe_usage_value(&json!({
            "payload": {"type":"usage", "input":10, "output":3, "cached":2}
        })));
        assert!(!haider_projection_pipe_usage_value(&json!({
            "role":"assistant", "text":"done", "seq":4, "ordinal":0
        })));
        let pipe_usage = json!({
            "seq":5, "ordinal":0,
            "usage":{"input_tokens":10, "output_tokens":3, "cached_tokens":2}
        });
        assert_eq!(
            haider_projection_pipe_row_identity(&pipe_usage).unwrap(),
            Some((5, 0))
        );
        let mut state = HaiderProjectionFoldState::default();
        let folded = haider_projection_fold_value_locked(&mut state, "local", &pipe_usage);
        assert_eq!(folded.rows.len(), 1);
        assert_eq!(folded.rows[0].kind, "usage");
    }

    #[test]
    fn haider_projection_boot_paths_do_not_cold_fold() {
        for source in [
            include_str!("haider_bridge.rs"),
            include_str!("haider_run.rs"),
        ] {
            assert!(!source.contains("session_projection_ensure("));
            assert!(!source.contains("haider_projection_export_json("));
        }
        assert!(!include_str!("lib.rs").contains("session_projection_ensure("));
    }

    #[test]
    fn haider_projection_rows_match_the_webview_contract() {
        let row = haider_projection_row(
            "local-only",
            7,
            2,
            "branch-test".to_string(),
            "message",
            "assistant",
            "Hello".to_string(),
            json!({"source":"test"}),
            1_700_000_000_000,
        );
        let value = serde_json::to_value(row).unwrap();
        assert_eq!(
            value
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<HashSet<_>>(),
            [
                "seq",
                "ordinal",
                "branch_id",
                "kind",
                "role",
                "text",
                "meta",
                "at_ms",
            ]
            .into_iter()
            .map(str::to_string)
            .collect()
        );
    }

    #[test]
    fn haider_projection_run_failure_is_visible_and_marks_error() {
        let mut state = HaiderProjectionFoldState::default();
        let event = json!({
            "seq": 9,
            "payload": {
                "type": "run_failed",
                "code": "provider_error",
                "presentation": "Provider is unavailable"
            }
        });
        let step = haider_projection_fold_value_locked(&mut state, "local", &event);
        assert_eq!(step.rows.len(), 1);
        assert_eq!(step.rows[0].kind, "error");
        assert_eq!(step.rows[0].text, "Provider is unavailable");
        assert_eq!(step.status.as_deref(), Some("error"));
    }

    #[test]
    fn haider_projection_parses_v2_header_and_rejects_future_version() {
        let header = haider_projection_parse_pipe_header(
            &json!({
                "pipe":"haider.session.jsonl",
                "version":2,
                "session_id":"session-test",
                "generation":7
            }),
            "session-test",
        )
        .unwrap();
        assert_eq!(header.generation, 7);
        assert!(haider_projection_parse_pipe_header(
            &json!({
                "pipe":"haider.session.jsonl",
                "version":3,
                "session_id":"session-test",
                "generation":8
            }),
            "session-test",
        )
        .unwrap_err()
        .contains("Unsupported"));
    }

    #[test]
    fn haider_projection_torn_pipe_tail_does_not_advance_cursor() {
        let bytes = b"{\"coverage\":4,\"generation\":1}\n{\"coverage\":9";
        let mut reader = std::io::BufReader::new(std::io::Cursor::new(bytes));
        let mut line = Vec::new();
        let mut offset = 0_i64;
        match haider_projection_read_pipe_line(&mut reader, &mut line).unwrap() {
            HaiderProjectionPipeLine::Complete { consumed, .. } => offset += consumed,
            _ => panic!("complete coverage line expected"),
        }
        let committed = offset;
        assert!(matches!(
            haider_projection_read_pipe_line(&mut reader, &mut line).unwrap(),
            HaiderProjectionPipeLine::Torn
        ));
        assert_eq!(offset, committed);
    }

    #[test]
    fn haider_projection_pipe_cursor_resume_math_is_byte_exact() {
        let first = b"{\"seq\":4,\"ordinal\":0}\n";
        let second = b"{\"seq\":8,\"ordinal\":1}\n";
        let bytes = [first.as_slice(), second.as_slice()].concat();
        let mut reader = std::io::BufReader::new(std::io::Cursor::new(bytes.clone()));
        let mut line = Vec::new();
        let consumed = match haider_projection_read_pipe_line(&mut reader, &mut line).unwrap() {
            HaiderProjectionPipeLine::Complete { consumed, .. } => consumed,
            _ => panic!("first complete line expected"),
        };
        assert_eq!(consumed as usize, first.len());
        let mut resumed = std::io::BufReader::new(std::io::Cursor::new(bytes));
        resumed.seek(SeekFrom::Start(consumed as u64)).unwrap();
        assert!(matches!(
            haider_projection_read_pipe_line(&mut resumed, &mut line).unwrap(),
            HaiderProjectionPipeLine::Complete { .. }
        ));
        assert_eq!(line, &second[..second.len() - 1]);
    }

    #[test]
    fn haider_projection_generation_change_requires_refold() {
        let cursor = HaiderProjectionPipeCursor {
            generation: 4,
            byte_offset: 120,
            ..HaiderProjectionPipeCursor::default()
        };
        let same = HaiderProjectionPipeHeader {
            session_id: "session-test".to_string(),
            generation: 4,
        };
        let changed = HaiderProjectionPipeHeader {
            generation: 5,
            ..same.clone()
        };
        assert!(!haider_projection_pipe_requires_refold(
            Some(&cursor),
            &same,
            100,
            140
        ));
        assert!(haider_projection_pipe_requires_refold(
            Some(&cursor),
            &changed,
            100,
            140
        ));
    }

    #[test]
    fn haider_projection_pipe_append_fires_filesystem_ingest_wake() {
        let test_session = haider_projection_test_session();
        let root = std::env::temp_dir().join(format!(
            "haider-pipe-event-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("session.jsonl");
        fs::write(
            &path,
            haider_projection_test_pipe_header(&test_session.provider_session_id, 1),
        )
        .unwrap();
        let (watcher, receiver) =
            haider_projection_pipe_watcher(&path).expect("filesystem pipe watcher");

        let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(b"{\"seq\":1,\"ordinal\":0,\"role\":\"assistant\",\"text\":\"ready\"}\n")
            .unwrap();
        file.sync_all().unwrap();
        assert!(haider_projection_wait_for_pipe_event(
            &receiver,
            &path,
            Duration::from_secs(2)
        ));
        let frame = haider_projection_ingest_pipe(
            &test_session.session_id,
            &test_session.provider_session_id,
            &HaiderProjectionPipeRoute {
                path: path.clone(),
                head_seq: Some(1),
            },
        )
        .unwrap();
        assert_eq!(frame.appended, 1);
        assert_eq!(frame.from_seq, Some(1));

        drop(watcher);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn haider_projection_pipe_rename_swap_wakes_and_requires_refold() {
        let test_session = haider_projection_test_session();
        let root = std::env::temp_dir().join(format!(
            "haider-pipe-swap-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("session.jsonl");
        let replacement = root.join("session.next");
        let old = root.join("session.old");
        fs::write(
            &path,
            haider_projection_test_pipe_header(&test_session.provider_session_id, 1),
        )
        .unwrap();
        fs::write(
            &replacement,
            format!(
                "{}{}\n",
                haider_projection_test_pipe_header(&test_session.provider_session_id, 2),
                json!({
                    "seq":2,
                    "ordinal":0,
                    "role":"assistant",
                    "text":"replacement"
                })
            ),
        )
        .unwrap();
        let (watcher, receiver) =
            haider_projection_pipe_watcher(&path).expect("filesystem pipe watcher");
        let route = HaiderProjectionPipeRoute {
            path: path.clone(),
            head_seq: Some(2),
        };
        let initial = haider_projection_ingest_pipe(
            &test_session.session_id,
            &test_session.provider_session_id,
            &route,
        )
        .unwrap();
        assert!(initial.tail_changed);

        fs::rename(&path, &old).unwrap();
        fs::rename(&replacement, &path).unwrap();
        assert!(haider_projection_wait_for_pipe_event(
            &receiver,
            &path,
            Duration::from_secs(2)
        ));
        let replaced = haider_projection_ingest_pipe(
            &test_session.session_id,
            &test_session.provider_session_id,
            &route,
        )
        .unwrap();
        assert!(replaced.tail_changed);
        assert_eq!(replaced.appended, 1);
        assert_eq!(
            haider_projection_load_pipe_cursor(&test_session.session_id)
                .unwrap()
                .unwrap()
                .generation,
            2
        );

        drop(watcher);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn haider_projection_tracks_coverage_by_generation() {
        assert_eq!(
            haider_projection_pipe_coverage(10, &json!({"coverage":42,"generation":3}), 3).unwrap(),
            Some(42)
        );
        assert_eq!(
            haider_projection_pipe_coverage(42, &json!({"coverage":20,"generation":3}), 3).unwrap(),
            Some(42)
        );
        assert!(
            haider_projection_pipe_coverage(42, &json!({"coverage":44,"generation":4}), 3).is_err()
        );
    }

    #[test]
    fn haider_projection_version_wipes_cache_and_migrates_row_identity() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE session_projection_schema (
                    singleton INTEGER PRIMARY KEY, version INTEGER NOT NULL
                 );
                 INSERT INTO session_projection_schema VALUES (1, 1);
                 CREATE TABLE session_projection_rows (
                    session_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL,
                    role TEXT NOT NULL, text TEXT NOT NULL, meta TEXT NOT NULL,
                    at_ms INTEGER NOT NULL, PRIMARY KEY(session_id, seq)
                 );
                 INSERT INTO session_projection_rows VALUES
                    ('local', 7, 'message', 'user', 'old', '{}', 1);
                 CREATE TABLE session_pipe_cursors (
                    session_id TEXT PRIMARY KEY, byte_offset INTEGER NOT NULL,
                    last_seq INTEGER NOT NULL, last_ordinal INTEGER NOT NULL,
                    generation INTEGER NOT NULL, covered_through_seq INTEGER NOT NULL
                 );
                 INSERT INTO session_pipe_cursors VALUES ('local', 5, 7, 0, 1, 7);",
            )
            .unwrap();
        haider_projection_migrate_database(&mut connection).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM session_projection_rows", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM session_pipe_cursors", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            0
        );
        let columns = connection
            .prepare("PRAGMA table_info(session_projection_rows)")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get::<_, String>(1)?, row.get::<_, i64>(5)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(columns.contains(&("ordinal".to_string(), 3)));
        assert!(columns.contains(&("branch_id".to_string(), 0)));
        connection
            .execute(
                "INSERT INTO session_projection_rows
                 (session_id, seq, ordinal, branch_id, kind, role, text, meta, at_ms)
                 VALUES ('local', 7, 0, '', 'message', 'user', 'main', '{}', 1),
                        ('local', 7, 1, 'branch-a', 'message', 'assistant', 'branch', '{}', 2)",
                [],
            )
            .unwrap();
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM session_projection_rows", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            2
        );
    }

    #[test]
    fn haider_projection_pipe_and_export_fold_match_when_live_probe_is_enabled() {
        let Ok(provider_session_id) = std::env::var("HAIDER_LIVE_PARITY_SESSION") else {
            return;
        };
        let route = haider_projection_resolve_pipe_route(&provider_session_id).unwrap();
        let file = fs::File::open(route.path).unwrap();
        let mut reader = std::io::BufReader::new(file);
        let mut line = Vec::new();
        let mut pipe_values = Vec::new();
        while let HaiderProjectionPipeLine::Complete {
            within_limit: true, ..
        } = haider_projection_read_pipe_line(&mut reader, &mut line).unwrap()
        {
            let value: Value = serde_json::from_slice(&line).unwrap();
            if haider_projection_pipe_row_identity(&value)
                .unwrap()
                .is_some()
            {
                pipe_values.push(value);
            }
        }
        let export = haider_projection_export_json(&provider_session_id).unwrap();
        let fold = |items: Vec<&Value>| {
            let mut state = HaiderProjectionFoldState::default();
            items
                .into_iter()
                .flat_map(|value| {
                    haider_projection_fold_value_locked(&mut state, "local", value).rows
                })
                .map(|row| {
                    (
                        row.seq,
                        row.ordinal,
                        row.branch_id,
                        row.kind,
                        row.role,
                        row.text,
                        row.at_ms,
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(
            fold(pipe_values.iter().collect()),
            fold(haider_projection_input_items(&export))
        );
    }
}

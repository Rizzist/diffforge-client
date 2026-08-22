// Render projection for Haider-backed session views. This file is include!d
// into lib.rs so it intentionally reuses the sessions database, write lock,
// clock, status reducer, and Tauri imports from the crate root.

const HAIDER_PROJECTION_EXPORT_TIMEOUT: Duration = Duration::from_secs(10);
const HAIDER_PROJECTION_MAX_EXPORT_BYTES: u64 = 32 * 1024 * 1024;
const HAIDER_PROJECTION_MAX_LINE_BYTES: usize = 2 * 1024 * 1024;
const HAIDER_PROJECTION_MAX_WINDOW_ROWS: i64 = 1_000;
const HAIDER_PROJECTION_WATCH_LIMIT: usize = 6;
const HAIDER_PROJECTION_SCHEMA_VERSION: i64 = 5;
const HAIDER_PROJECTION_PIPE_BATCH_LINES: usize = 256;
const HAIDER_PROJECTION_PIPE_SAFETY_POLL: Duration = Duration::from_secs(2);
const HAIDER_PROJECTION_PIPE_STOP_POLL: Duration = Duration::from_millis(100);
const HAIDER_PROJECTION_RPC_TIMEOUT: Duration = Duration::from_secs(2);
const HAIDER_PROJECTION_FRAME_TIME: Duration = Duration::from_millis(50);
const HAIDER_PROJECTION_IMMEDIATE_IDLE: Duration = Duration::from_millis(300);
const HAIDER_PROJECTION_EVENT_ROWS_LIMIT: usize = 32;
const HAIDER_PROJECTION_ROWS_EVENT: &str = "session-rows-appended";
const HAIDER_PROJECTION_PREFOLD_QUEUE_LIMIT: usize = 32;

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

#[derive(Clone, Debug)]
struct HaiderProjectionFoldState {
    next_fallback_seq: i64,
    total_rows: i64,
    persisted_max_key: Option<(i64, i64)>,
    window_anchors: HashMap<i64, (i64, i64)>,
    tail: Option<HaiderProjectionTail>,
    metadata: serde_json::Map<String, Value>,
    effect_summaries: HashMap<String, String>,
    seen_sequences: HashSet<(i64, i64)>,
    pipe_eof_max_seq: Option<i64>,
    /* Enveloped watch/run items are canonical over compat records from those
    same sources. Native pipes have a separate fold door because their
    role-shaped rows are the canonical stream. */
    saw_item_stream: bool,
}

impl Default for HaiderProjectionFoldState {
    fn default() -> Self {
        Self {
            next_fallback_seq: 1,
            total_rows: 0,
            persisted_max_key: None,
            window_anchors: HashMap::new(),
            tail: None,
            metadata: serde_json::Map::new(),
            effect_summaries: HashMap::new(),
            seen_sequences: HashSet::new(),
            pipe_eof_max_seq: None,
            saw_item_stream: false,
        }
    }
}

#[derive(Debug, Default)]
struct HaiderProjectionFoldStep {
    rows: Vec<SessionProjectionRow>,
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
    pipe_max_seq: Option<i64>,
    caught_up: bool,
    sync_changed: bool,
    rows: Vec<SessionProjectionRow>,
    start_total: Option<i64>,
    rows_overflow: bool,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    rows: Option<Vec<SessionProjectionRow>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    start_total: Option<i64>,
}

#[derive(Debug, Default)]
struct HaiderProjectionPersistedRows {
    rows: Vec<SessionProjectionRow>,
    total_rows: i64,
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

struct HaiderProjectionJournalTail {
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

#[derive(Default)]
struct HaiderProjectionJournalManager {
    tails: HashMap<String, HaiderProjectionJournalTail>,
}

#[derive(Default)]
struct HaiderProjectionPrefoldManager {
    queue: VecDeque<String>,
    queued: HashSet<String>,
    active: HashSet<String>,
    attached: HashSet<String>,
    in_flight: Option<(String, String)>,
    worker_running: bool,
}

struct HaiderProjectionForeground {
    ids: HashSet<String>,
}

impl HaiderProjectionForeground {
    fn add(&mut self, id: &str) {
        let id = id.trim();
        if id.is_empty() || !self.ids.insert(id.to_string()) {
            return;
        }
        if let Ok(mut manager) = haider_projection_prefold_manager().lock() {
            manager.active.insert(id.to_string());
            manager.queue.retain(|queued| queued != id);
            manager.queued.remove(id);
        }
    }

    fn mark_attached(self) {
        if let Ok(mut manager) = haider_projection_prefold_manager().lock() {
            manager.attached.extend(self.ids.iter().cloned());
        }
    }
}

impl Drop for HaiderProjectionForeground {
    fn drop(&mut self) {
        if let Ok(mut manager) = haider_projection_prefold_manager().lock() {
            for id in &self.ids {
                manager.active.remove(id);
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct HaiderProjectionPipeHeader {
    session_id: String,
    generation: i64,
    segment_index: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct HaiderProjectionPipeCursor {
    session_id: String,
    segment_name: String,
    segment_index: i64,
    byte_offset: i64,
    last_seq: i64,
    last_ordinal: i64,
    generation: i64,
    covered_through_seq: i64,
    coverage_known: bool,
    /* Retained in the cursor schema for compatibility with v2 stores. Native
    pipe folding no longer reads this cross-source bit. */
    saw_item_stream: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct HaiderProjectionJournalCursor {
    session_id: String,
    covered_through_seq: i64,
}

#[derive(Clone, Debug)]
struct HaiderProjectionJournalCommit {
    covered_through_seq: i64,
}

enum HaiderProjectionJournalIngest {
    Connected(HaiderProjectionFrame),
    Unavailable,
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

fn haider_projection_journal_manager() -> &'static StdMutex<HaiderProjectionJournalManager> {
    static MANAGER: OnceLock<StdMutex<HaiderProjectionJournalManager>> = OnceLock::new();
    MANAGER.get_or_init(|| StdMutex::new(HaiderProjectionJournalManager::default()))
}

fn haider_projection_ingest_locks() -> &'static StdMutex<HashMap<String, Arc<StdMutex<()>>>> {
    static LOCKS: OnceLock<StdMutex<HashMap<String, Arc<StdMutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn haider_projection_ingest_lock(session_id: &str) -> Result<Arc<StdMutex<()>>, String> {
    let mut locks = haider_projection_ingest_locks()
        .lock()
        .map_err(|_| "Haider projection ingest locks are unavailable.".to_string())?;
    locks.retain(|_, lock| Arc::strong_count(lock) > 1);
    Ok(locks
        .entry(session_id.to_string())
        .or_insert_with(|| Arc::new(StdMutex::new(())))
        .clone())
}

fn haider_projection_prefold_manager() -> &'static StdMutex<HaiderProjectionPrefoldManager> {
    static MANAGER: OnceLock<StdMutex<HaiderProjectionPrefoldManager>> = OnceLock::new();
    MANAGER.get_or_init(|| StdMutex::new(HaiderProjectionPrefoldManager::default()))
}

fn haider_projection_foreground(session_id: &str) -> HaiderProjectionForeground {
    let mut foreground = HaiderProjectionForeground {
        ids: HashSet::new(),
    };
    foreground.add(session_id);
    foreground
}

fn haider_projection_pipe_routes() -> &'static StdMutex<HashMap<String, HaiderProjectionPipeRoute>>
{
    static ROUTES: OnceLock<StdMutex<HashMap<String, HaiderProjectionPipeRoute>>> = OnceLock::new();
    ROUTES.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn haider_projection_database_cache() -> &'static StdMutex<Option<rusqlite::Connection>> {
    static DATABASE: OnceLock<StdMutex<Option<rusqlite::Connection>>> = OnceLock::new();
    DATABASE.get_or_init(|| StdMutex::new(None))
}

fn haider_projection_database_open_count() -> &'static AtomicUsize {
    static COUNT: AtomicUsize = AtomicUsize::new(0);
    &COUNT
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
                 DROP TABLE IF EXISTS session_journal_cursors;
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
                segment_name TEXT NOT NULL DEFAULT '',
                segment_index INTEGER NOT NULL DEFAULT 0,
                byte_offset INTEGER NOT NULL,
                last_seq INTEGER NOT NULL,
                last_ordinal INTEGER NOT NULL,
                generation INTEGER NOT NULL,
                covered_through_seq INTEGER NOT NULL,
                coverage_known INTEGER NOT NULL DEFAULT 0,
                saw_item_stream INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS session_journal_cursors (
                session_id TEXT PRIMARY KEY,
                covered_through_seq INTEGER NOT NULL
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
    if !cursor_columns.contains("saw_item_stream") {
        connection
            .execute(
                "ALTER TABLE session_pipe_cursors ADD COLUMN saw_item_stream INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|error| format!("Unable to migrate session pipe cursor schema: {error}"))?;
    }
    Ok(())
}

fn haider_projection_new_database() -> Result<rusqlite::Connection, String> {
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

fn haider_projection_with_database_cache<T>(
    cache: &StdMutex<Option<rusqlite::Connection>>,
    open_count: &AtomicUsize,
    mut open: impl FnMut() -> Result<rusqlite::Connection, String>,
    mut validate: impl FnMut(&mut rusqlite::Connection) -> Result<bool, String>,
    operation: impl FnOnce(&mut rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut connection = match cache.lock() {
        Ok(connection) => connection,
        Err(poisoned) => {
            let mut connection = poisoned.into_inner();
            *connection = None;
            cache.clear_poison();
            connection
        }
    };
    if let Some(cached) = connection.as_mut() {
        if !validate(cached)? {
            *connection = None;
        }
    }
    if connection.is_none() {
        *connection = Some(open()?);
        open_count.fetch_add(1, Ordering::Relaxed);
    }
    operation(
        connection
            .as_mut()
            .expect("projection database initialized"),
    )
}

fn haider_projection_database_connection_valid(
    connection: &mut rusqlite::Connection,
) -> Result<bool, String> {
    match connection.query_row("SELECT 1", [], |_| Ok(())) {
        Ok(()) => Ok(true),
        Err(error) if error.sqlite_error_code() == Some(rusqlite::ErrorCode::ApiMisuse) => {
            Ok(false)
        }
        Err(error) => Err(format!(
            "Unable to validate cached session projection store: {error}"
        )),
    }
}

fn haider_projection_with_database<T>(
    operation: impl FnMut(&mut rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    haider_projection_with_database_cache(
        haider_projection_database_cache(),
        haider_projection_database_open_count(),
        haider_projection_new_database,
        haider_projection_database_connection_valid,
        operation,
    )
}

fn haider_projection_database_stats_with_connection(
    connection: &mut rusqlite::Connection,
    session_id: &str,
) -> Result<(i64, i64, i64), String> {
    connection
        .prepare_cached(
            "SELECT COUNT(*),
                        COALESCE((SELECT seq FROM session_projection_rows
                                  WHERE session_id = ?1
                                  ORDER BY seq DESC, ordinal DESC LIMIT 1), 0),
                        COALESCE((SELECT ordinal FROM session_projection_rows
                                  WHERE session_id = ?1
                                  ORDER BY seq DESC, ordinal DESC LIMIT 1), 0)
                 FROM session_projection_rows WHERE session_id = ?1",
        )
        .and_then(|mut statement| {
            statement.query_row([session_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
        })
        .map_err(|error| format!("Unable to inspect session projection: {error}"))
}

fn haider_projection_database_stats(session_id: &str) -> Result<(i64, i64), String> {
    haider_projection_with_database(|connection| {
        haider_projection_database_stats_with_connection(connection, session_id)
            .map(|(total_rows, max_seq, _)| (total_rows, max_seq))
    })
}

fn haider_projection_initialize_state_with_connection(
    connection: &mut rusqlite::Connection,
    session_id: &str,
) -> Result<(), String> {
    if haider_projection_states()
        .lock()
        .map_err(|_| "Session projection state is unavailable.".to_string())?
        .contains_key(session_id)
    {
        return Ok(());
    }
    let (total_rows, max_seq, max_ordinal) =
        haider_projection_database_stats_with_connection(connection, session_id)?;
    let mut states = haider_projection_states()
        .lock()
        .map_err(|_| "Session projection state is unavailable.".to_string())?;
    states
        .entry(session_id.to_string())
        .or_insert_with(|| HaiderProjectionFoldState {
            next_fallback_seq: max_seq.saturating_add(1).max(1),
            total_rows,
            persisted_max_key: (total_rows > 0).then_some((max_seq, max_ordinal)),
            ..HaiderProjectionFoldState::default()
        });
    Ok(())
}

fn haider_projection_initialize_state(session_id: &str) -> Result<(), String> {
    if haider_projection_states()
        .lock()
        .map_err(|_| "Session projection state is unavailable.".to_string())?
        .contains_key(session_id)
    {
        return Ok(());
    }
    haider_projection_with_database(|connection| {
        haider_projection_initialize_state_with_connection(connection, session_id)
    })
}

fn haider_projection_state_total_rows(session_id: &str) -> Result<i64, String> {
    haider_projection_initialize_state(session_id)?;
    haider_projection_states()
        .lock()
        .map_err(|_| "Session projection state is unavailable.".to_string())?
        .get(session_id)
        .map(|state| state.total_rows)
        .ok_or_else(|| "Session projection state was not initialized.".to_string())
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
        /* Reasoning renders as its own collapsed block, never as the answer —
        DeepSeek-style open chains of thought otherwise read as the reply. */
        "reasoning" | "plan" => ("thinking", "assistant"),
        "refusal" => ("error", "assistant"),
        "tool_call" | "command_execution" | "file_change" | "child_spawn" | "child_result"
        | "context_compaction" | "extension" => ("tool", "tool"),
        /* The item vocabulary is OPEN and already wider than this list. An
        unrecognised but NAMED kind renders in the tool cluster — the
        neutral container — because dropping it means a future item type
        silently disappears from the transcript instead of degrading. A
        payload with no kind at all is not an item and is still skipped. */
        "" => ("", ""),
        _ => ("tool", "tool"),
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
        /* The role vocabulary is OPEN — it already grew past user/assistant/
        tool once. An unrecognised role keeps its own name rather than
        borrowing "assistant", so its text is shown without the transcript
        claiming the MODEL said it; dropping it would make a future role
        disappear with nothing to notice. A row with no role at all is not
        a row. */
        "" => return None,
        other => (
            "message",
            other,
            haider_projection_extract_text(item).unwrap_or_default(),
        ),
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
                        match delta_kind.as_str() {
                            "tool_args" | "command_output" => "tool",
                            "reasoning" => "thinking",
                            _ => "message",
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
                    // Args deltas are proof this is a tool call: a tail that
                    // opened as prose must re-home into the tool cluster, or
                    // the raw fallback text leaks into the chat column.
                    tail.row.kind = "tool".to_string();
                    tail.row.role = "tool".to_string();
                    if let Some(fragment) = delta
                        .as_object()
                        .and_then(|object| haider_projection_text(object.get("fragment")))
                    {
                        tail.row.text =
                            haider_projection_compact(&format!("tool arguments · {fragment}"), 240);
                    }
                }
                "command_output" => {
                    tail.row.kind = "tool".to_string();
                    tail.row.role = "tool".to_string();
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
    // The daemon owns display-safety policy. An explicit false is a redaction
    // decision for this envelope; no payload shape may override it locally.
    if value
        .get("render")
        .and_then(|render| render.get("ui"))
        .and_then(Value::as_bool)
        == Some(false)
    {
        return step;
    }
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
        /* Once the enveloped item stream is live it is canonical: bare
        role-shaped compat records would duplicate its content at fresh
        seqs (and add empty turn-start markers). Cold export folds and
        pre-item pipes never set the flag, so their rows all land. */
        if !state.saw_item_stream {
            if let Some(row) = haider_projection_export_row(state, session_id, payload) {
                step.rows.push(row);
            }
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
            state.saw_item_stream = true;
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

fn haider_projection_fold_pipe_value_locked(
    state: &mut HaiderProjectionFoldState,
    session_id: &str,
    value: &Value,
) -> HaiderProjectionFoldStep {
    let payload = haider_projection_payload(value);

    /* v4 introduced rows discriminated by `kind` that carry NO role at all.
    They have to be recognised before the role check below, which treats a
    roleless row as not-a-row. */
    if let Some(row) = haider_projection_pipe_kind_row(state, session_id, payload) {
        let mut step = HaiderProjectionFoldStep::default();
        step.rows.push(row);
        return step;
    }

    let compat_role = payload
        .as_object()
        .and_then(|object| object.get("role"))
        .and_then(Value::as_str)
        .is_some_and(|role| matches!(role, "user" | "assistant" | "tool" | "error"));
    if !compat_role {
        let mut step = haider_projection_fold_value_locked(state, session_id, value);
        let ordinal = haider_projection_pipe_projection_ordinal(payload, 0);
        for row in &mut step.rows {
            row.ordinal = ordinal;
        }
        return step;
    }

    /* 0.0.937 native pipes contain only bare compat rows. An item envelope
    observed through run/watch/export must not suppress later pipe growth:
    doing so advanced the byte cursor while silently dropping the row.

    This also carries v4's reasoning, and it is why compat rows must never be
    dropped on this path: EVERY reasoning row the daemon writes is marked
    compat: true, so the documented "safe to drop" reading of that flag costs
    100% of the thinking. */
    let mut step = HaiderProjectionFoldStep::default();
    let reasoning = haider_projection_pipe_reasoning_row(state, session_id, payload);
    let has_reasoning = reasoning.is_some();
    let carried_only_reasoning = has_reasoning
        && haider_projection_extract_text(payload)
            .filter(|text| !text.trim().is_empty())
            .is_none();
    if let Some(row) = reasoning {
        step.rows.push(row);
    }
    /* Reasoning rides the row where the thinking HAPPENED — before the tool
    calls — not the answer row, and 57% of those rows carry no text. Emitting
    the message row anyway would put an empty assistant bubble under every
    thinking fold. */
    if !carried_only_reasoning {
        if let Some(mut row) = haider_projection_export_row(state, session_id, payload) {
            row.ordinal =
                haider_projection_pipe_projection_ordinal(payload, i64::from(has_reasoning));
            step.rows.push(row);
        }
    }
    step
}

/* A v4 row named by `kind` rather than `role`. Kept open-vocabulary on purpose:
an unfamiliar kind is passed to the generic fold rather than recognised here,
so this function only claims the kinds it can actually render. */
fn haider_projection_pipe_kind_row(
    state: &mut HaiderProjectionFoldState,
    session_id: &str,
    payload: &Value,
) -> Option<SessionProjectionRow> {
    let object = payload.as_object()?;
    let kind = haider_projection_text(object.get("kind"))?;
    if kind != "compaction_boundary" {
        return None;
    }
    Some(haider_projection_row(
        session_id,
        haider_projection_seq(state, payload, payload),
        haider_projection_pipe_projection_ordinal(payload, 0),
        String::new(),
        "compaction_boundary",
        "meta",
        String::new(),
        // run_id and branch_id ride in meta verbatim rather than being lifted
        // into named fields; the daemon owns that vocabulary.
        payload.clone(),
        haider_projection_at_ms(payload, payload),
    ))
}

/* v4 seals reasoning onto the row where it happened. Deliberately NOT folded
into export_row: that function returns one row, and a single assistant row
can now produce both a thinking fold and a reply. */
fn haider_projection_pipe_reasoning_row(
    state: &mut HaiderProjectionFoldState,
    session_id: &str,
    payload: &Value,
) -> Option<SessionProjectionRow> {
    let object = payload.as_object()?;
    if object.get("role").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let reasoning = haider_projection_text(object.get("reasoning"))?;
    Some(haider_projection_row(
        session_id,
        haider_projection_seq(state, payload, payload),
        haider_projection_pipe_projection_ordinal(payload, 0),
        haider_projection_branch_id(payload, payload),
        "thinking",
        "assistant",
        reasoning,
        payload.clone(),
        haider_projection_at_ms(payload, payload),
    ))
}

/* One wire row can project into a thinking row followed by assistant text.
Reserve two adjacent projection ordinals per wire ordinal so both survive
the `(session_id, seq, ordinal)` primary key without colliding with a later
wire row at the same sequence. */
fn haider_projection_pipe_projection_ordinal(payload: &Value, phase: i64) -> i64 {
    haider_projection_ordinal(payload, payload)
        .saturating_mul(2)
        .saturating_add(phase.clamp(0, 1))
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
    journal: Option<&HaiderProjectionJournalCommit>,
) -> Result<HaiderProjectionPersistedRows, String> {
    if rows.is_empty() && cursor.is_none() && journal.is_none() {
        return Ok(HaiderProjectionPersistedRows::default());
    }
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    haider_projection_initialize_state(session_id)?;
    haider_projection_with_database(|connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Unable to begin session projection write: {error}"))?;
        let mut appended = 0usize;
        let mut persisted_rows = Vec::new();
        let mut min_inserted = None::<(i64, i64)>;
        let mut max_inserted = None::<(i64, i64)>;
        {
            let mut statement = transaction
                .prepare_cached(
                    "INSERT OR IGNORE INTO session_projection_rows
                     (session_id, seq, ordinal, branch_id, kind, role, text, meta, at_ms)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                )
                .map_err(|error| format!("Unable to prepare session projection row: {error}"))?;
            for row in rows {
                let inserted = statement
                    .execute(rusqlite::params![
                        row.session_id,
                        row.seq,
                        row.ordinal,
                        row.branch_id,
                        row.kind,
                        row.role,
                        row.text,
                        serde_json::to_string(&row.meta).unwrap_or_else(|_| "null".to_string()),
                        row.at_ms,
                    ])
                    .map_err(|error| format!("Unable to append session projection row: {error}"))?;
                appended = appended.saturating_add(inserted);
                if inserted > 0 {
                    persisted_rows.push(row.clone());
                    let key = (row.seq, row.ordinal);
                    min_inserted = Some(min_inserted.map_or(key, |current| current.min(key)));
                    max_inserted = Some(max_inserted.map_or(key, |current| current.max(key)));
                }
            }
        }
        if let Some(cursor) = cursor {
            transaction
                .prepare_cached(
                    "INSERT INTO session_pipe_cursors (
                    session_id, segment_name, segment_index, byte_offset,
                    last_seq, last_ordinal, generation, covered_through_seq,
                    coverage_known, saw_item_stream
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(session_id) DO UPDATE SET
                    segment_name = excluded.segment_name,
                    segment_index = excluded.segment_index,
                    byte_offset = excluded.byte_offset,
                    last_seq = CASE
                        WHEN (excluded.last_seq, excluded.last_ordinal) >=
                             (session_pipe_cursors.last_seq, session_pipe_cursors.last_ordinal)
                        THEN excluded.last_seq ELSE session_pipe_cursors.last_seq END,
                    last_ordinal = CASE
                        WHEN (excluded.last_seq, excluded.last_ordinal) >=
                             (session_pipe_cursors.last_seq, session_pipe_cursors.last_ordinal)
                        THEN excluded.last_ordinal ELSE session_pipe_cursors.last_ordinal END,
                    covered_through_seq = MAX(
                        session_pipe_cursors.covered_through_seq,
                        excluded.covered_through_seq
                    ),
                    coverage_known = MAX(
                        session_pipe_cursors.coverage_known,
                        excluded.coverage_known
                    ),
                    saw_item_stream = MAX(
                        session_pipe_cursors.saw_item_stream,
                        excluded.saw_item_stream
                    )
                 WHERE session_pipe_cursors.generation = excluded.generation
                   AND (session_pipe_cursors.segment_index < excluded.segment_index
                        OR (session_pipe_cursors.segment_index = excluded.segment_index
                            AND session_pipe_cursors.byte_offset <= excluded.byte_offset))",
                )
                .and_then(|mut statement| {
                    statement.execute(rusqlite::params![
                        cursor.session_id,
                        cursor.segment_name,
                        cursor.segment_index,
                        cursor.byte_offset,
                        cursor.last_seq,
                        cursor.last_ordinal,
                        cursor.generation,
                        cursor.covered_through_seq,
                        cursor.coverage_known,
                        cursor.saw_item_stream,
                    ])
                })
                .map_err(|error| format!("Unable to persist session pipe cursor: {error}"))?;
        }
        if let Some(journal) = journal {
            transaction
                .prepare_cached(
                    "INSERT INTO session_journal_cursors (session_id, covered_through_seq)
                     VALUES (?1, ?2)
                     ON CONFLICT(session_id) DO UPDATE SET covered_through_seq =
                        MAX(session_journal_cursors.covered_through_seq,
                            excluded.covered_through_seq)",
                )
                .and_then(|mut statement| {
                    statement.execute(rusqlite::params![session_id, journal.covered_through_seq,])
                })
                .map_err(|error| format!("Unable to persist session journal cursor: {error}"))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("Unable to commit session projection rows: {error}"))?;
        let mut states = haider_projection_states()
            .lock()
            .map_err(|_| "Session projection state is unavailable.".to_string())?;
        let state = states
            .get_mut(session_id)
            .ok_or_else(|| "Session projection state was not initialized.".to_string())?;
        state.total_rows = state
            .total_rows
            .saturating_add(i64::try_from(appended).unwrap_or(i64::MAX));
        if appended > 0 {
            if min_inserted.is_some_and(|key| state.persisted_max_key.is_some_and(|max| key <= max))
            {
                state.window_anchors.clear();
            }
            state.persisted_max_key = match (state.persisted_max_key, max_inserted) {
                (Some(left), Some(right)) => Some(left.max(right)),
                (None, value) | (value, None) => value,
            };
        }
        Ok(HaiderProjectionPersistedRows {
            rows: persisted_rows,
            total_rows: state.total_rows,
        })
    })
}

fn haider_projection_persist_rows(
    rows: &[SessionProjectionRow],
) -> Result<HaiderProjectionPersistedRows, String> {
    if rows.is_empty() {
        return Ok(HaiderProjectionPersistedRows::default());
    }
    haider_projection_persist_batch(&rows[0].session_id, rows, None, None)
}

fn haider_projection_load_pipe_cursor(
    session_id: &str,
) -> Result<Option<HaiderProjectionPipeCursor>, String> {
    haider_projection_with_database(|connection| {
        let result = connection
            .prepare_cached(
                "SELECT session_id, segment_name, segment_index, byte_offset,
                        last_seq, last_ordinal, generation, covered_through_seq,
                        coverage_known, saw_item_stream
                 FROM session_pipe_cursors WHERE session_id = ?1",
            )
            .and_then(|mut statement| {
                statement.query_row([session_id], |row| {
                    Ok(HaiderProjectionPipeCursor {
                        session_id: row.get(0)?,
                        segment_name: row.get(1)?,
                        segment_index: row.get(2)?,
                        byte_offset: row.get(3)?,
                        last_seq: row.get(4)?,
                        last_ordinal: row.get(5)?,
                        generation: row.get(6)?,
                        covered_through_seq: row.get(7)?,
                        coverage_known: row.get(8)?,
                        saw_item_stream: row.get(9)?,
                    })
                })
            });
        match result {
            Ok(cursor) => Ok(Some(cursor)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(format!("Unable to read session pipe cursor: {error}")),
        }
    })
}

fn haider_projection_load_journal_cursor(
    session_id: &str,
) -> Result<Option<HaiderProjectionJournalCursor>, String> {
    haider_projection_with_database(|connection| {
        let result = connection
            .prepare_cached(
                "SELECT session_id, covered_through_seq
                 FROM session_journal_cursors WHERE session_id = ?1",
            )
            .and_then(|mut statement| {
                statement.query_row([session_id], |row| {
                    Ok(HaiderProjectionJournalCursor {
                        session_id: row.get(0)?,
                        covered_through_seq: row.get(1)?,
                    })
                })
            });
        match result {
            Ok(cursor) => Ok(Some(cursor)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(format!("Unable to read session journal cursor: {error}")),
        }
    })
}

fn haider_projection_reset_journal_session(session_id: &str) -> Result<(), String> {
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    haider_projection_with_database(|connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Unable to begin session journal refold: {error}"))?;
        for table in [
            "session_projection_rows",
            "session_pipe_cursors",
            "session_journal_cursors",
        ] {
            transaction
                .execute(
                    &format!("DELETE FROM {table} WHERE session_id = ?1"),
                    [session_id],
                )
                .map_err(|error| format!("Unable to reset session journal projection: {error}"))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("Unable to commit session journal refold: {error}"))?;
        if let Ok(mut states) = haider_projection_states().lock() {
            states.remove(session_id);
        }
        Ok(())
    })
}

fn haider_projection_reset_pipe_session(
    session_id: &str,
    cursor: &HaiderProjectionPipeCursor,
) -> Result<(), String> {
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    haider_projection_with_database(|connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Unable to begin session pipe refold: {error}"))?;
        transaction
            .prepare_cached("DELETE FROM session_projection_rows WHERE session_id = ?1")
            .and_then(|mut statement| statement.execute([session_id]))
            .map_err(|error| format!("Unable to reset session projection rows: {error}"))?;
        transaction
            .prepare_cached("DELETE FROM session_pipe_cursors WHERE session_id = ?1")
            .and_then(|mut statement| statement.execute([session_id]))
            .map_err(|error| format!("Unable to reset session pipe cursor: {error}"))?;
        transaction
            .prepare_cached(
                "INSERT INTO session_pipe_cursors (
                session_id, segment_name, segment_index, byte_offset,
                last_seq, last_ordinal, generation, covered_through_seq,
                coverage_known, saw_item_stream
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )
            .and_then(|mut statement| {
                statement.execute(rusqlite::params![
                    cursor.session_id,
                    cursor.segment_name,
                    cursor.segment_index,
                    cursor.byte_offset,
                    cursor.last_seq,
                    cursor.last_ordinal,
                    cursor.generation,
                    cursor.covered_through_seq,
                    cursor.coverage_known,
                    cursor.saw_item_stream,
                ])
            })
            .map_err(|error| format!("Unable to initialize session pipe cursor: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Unable to commit session pipe refold: {error}"))?;
        if let Ok(mut states) = haider_projection_states().lock() {
            states.remove(session_id);
        }
        Ok(())
    })?;
    Ok(())
}

fn haider_projection_caught_up(
    head_seq: Option<i64>,
    journal_covered_through_seq: Option<i64>,
    pipe_eof_max_seq: Option<i64>,
) -> bool {
    let Some(head_seq) = head_seq else {
        return true;
    };
    journal_covered_through_seq.is_some_and(|coverage| coverage >= head_seq)
        || pipe_eof_max_seq.is_some_and(|max_seq| max_seq >= head_seq)
}

fn haider_projection_sync(
    session_id: &str,
    provider_session_id: Option<&str>,
) -> Result<HaiderProjectionSync, String> {
    let pipe_cursor = haider_projection_load_pipe_cursor(session_id)?;
    let pipe_coverage = pipe_cursor
        .as_ref()
        .filter(|cursor| cursor.coverage_known)
        .map(|cursor| cursor.covered_through_seq);
    let journal_coverage =
        haider_projection_load_journal_cursor(session_id)?.map(|cursor| cursor.covered_through_seq);
    let covered_through_seq = match (journal_coverage, pipe_coverage) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    };
    let head_seq = provider_session_id.and_then(haider_bridge_head_seq);
    let pipe_eof_max_seq = haider_projection_states().lock().ok().and_then(|states| {
        states
            .get(session_id)
            .and_then(|state| state.pipe_eof_max_seq)
    });
    Ok(HaiderProjectionSync {
        covered_through_seq,
        head_seq,
        caught_up: haider_projection_caught_up(head_seq, journal_coverage, pipe_eof_max_seq),
    })
}

fn haider_projection_ingest_value(
    _app: Option<&AppHandle>,
    session_id: &str,
    value: &Value,
) -> Result<HaiderProjectionFrame, String> {
    // Same serialization law as the pipe path: the metadata watch fold must
    // never interleave with a pipe ingest — an unlocked fold here could
    // persist N+2 then be overwritten in memory by a concurrent N+1
    // (rev-2 P1), undercounting totals for the session's lifetime.
    let ingest_lock = haider_projection_ingest_lock(session_id)?;
    let _ingest_guard = match ingest_lock.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            ingest_lock.clear_poison();
            poisoned.into_inner()
        }
    };
    haider_projection_initialize_state(session_id)?;
    let mut all_rows = Vec::new();
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
            tail_changed |= step.tail_changed;
        }
    }
    let persisted = haider_projection_persist_rows(&all_rows)?;
    let appended = persisted.rows.len();
    let start_total = (appended > 0).then(|| {
        persisted
            .total_rows
            .saturating_sub(i64::try_from(appended).unwrap_or(i64::MAX))
    });
    let mut states = haider_projection_states()
        .lock()
        .map_err(|_| "Session projection state is unavailable.".to_string())?;
    let state = states
        .get_mut(session_id)
        .ok_or_else(|| "Session projection state was not initialized.".to_string())?;
    if !all_rows.is_empty() {
        state.total_rows = persisted.total_rows;
    }
    let live_tail = state.tail.as_ref().map(|tail| tail.row.clone());
    let total_rows = state.total_rows;
    drop(states);
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
        pipe_max_seq: None,
        caught_up: sync.caught_up,
        sync_changed: false,
        rows: persisted.rows,
        start_total,
        rows_overflow: appended > HAIDER_PROJECTION_EVENT_ROWS_LIMIT,
    })
}

fn haider_projection_ingest_journal_page(
    _app: Option<&AppHandle>,
    session_id: &str,
    provider_session_id: &str,
    mut result: haider_rpc_ade::SessionReadResult,
    covered_through_seq: i64,
    reset: bool,
) -> Result<HaiderProjectionFrame, String> {
    let ingest_lock = haider_projection_ingest_lock(session_id)?;
    let _ingest_guard = match ingest_lock.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            ingest_lock.clear_poison();
            poisoned.into_inner()
        }
    };
    let prior_coverage =
        haider_projection_load_journal_cursor(session_id)?.map(|cursor| cursor.covered_through_seq);
    let prior_head = haider_bridge_head_seq(provider_session_id);
    if reset {
        haider_projection_reset_journal_session(session_id)?;
    }
    haider_projection_initialize_state(session_id)?;
    result.envelopes.sort_by_key(|envelope| {
        envelope
            .as_object()
            .and_then(|object| haider_projection_json_i64(object.get("seq")))
            .unwrap_or_default()
    });
    let mut all_rows = Vec::new();
    let mut tail_changed = reset;
    {
        let mut states = haider_projection_states()
            .lock()
            .map_err(|_| "Session projection state is unavailable.".to_string())?;
        let state = states
            .get_mut(session_id)
            .ok_or_else(|| "Session projection state was not initialized.".to_string())?;
        for envelope in &result.envelopes {
            let step = haider_projection_fold_value_locked(state, session_id, envelope);
            all_rows.extend(step.rows);
            tail_changed |= step.tail_changed;
        }
    }
    let journal = HaiderProjectionJournalCommit {
        covered_through_seq,
    };
    let persisted = haider_projection_persist_batch(session_id, &all_rows, None, Some(&journal))?;
    let appended = persisted.rows.len();
    let start_total = (appended > 0).then(|| {
        persisted
            .total_rows
            .saturating_sub(i64::try_from(appended).unwrap_or(i64::MAX))
    });
    let mut states = haider_projection_states()
        .lock()
        .map_err(|_| "Session projection state is unavailable.".to_string())?;
    let state = states
        .get_mut(session_id)
        .ok_or_else(|| "Session projection state was not initialized.".to_string())?;
    state.total_rows = persisted.total_rows;
    let live_tail = state.tail.as_ref().map(|tail| tail.row.clone());
    let total_rows = state.total_rows;
    drop(states);
    let head_seq = result.head_seq.min(i64::MAX as u64) as i64;
    haider_bridge_note_head_seq(provider_session_id, head_seq);
    let sync = haider_projection_sync(session_id, Some(provider_session_id))?;
    let from_seq = (appended > 0)
        .then(|| persisted.rows.iter().map(|row| row.seq).min())
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
        pipe_max_seq: None,
        caught_up: sync.caught_up,
        sync_changed: reset
            || prior_coverage.is_none_or(|coverage| covered_through_seq > coverage)
            || prior_head.is_none_or(|head| head_seq > head),
        rows: persisted.rows,
        start_total,
        rows_overflow: appended > HAIDER_PROJECTION_EVENT_ROWS_LIMIT,
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
                let mut last_emitted = HashMap::<String, Instant>::new();
                while let Some(first) = receiver.recv().await {
                    let immediate = haider_projection_should_emit_immediately(
                        last_emitted.get(&first.session_id).copied(),
                        Instant::now(),
                    );
                    if immediate {
                        let session_id = first.session_id.clone();
                        haider_projection_emit_frame(&emit_app, first);
                        last_emitted.insert(session_id, Instant::now());
                        continue;
                    }

                    let mut frames = HashMap::from([(first.session_id.clone(), first)]);
                    sleep(HAIDER_PROJECTION_FRAME_TIME).await;
                    while let Ok(next) = receiver.try_recv() {
                        match frames.entry(next.session_id.clone()) {
                            std::collections::hash_map::Entry::Occupied(mut entry) => {
                                haider_projection_merge_frame(entry.get_mut(), next);
                            }
                            std::collections::hash_map::Entry::Vacant(entry) => {
                                entry.insert(next);
                            }
                        }
                    }
                    for (_, frame) in frames {
                        let session_id = frame.session_id.clone();
                        haider_projection_emit_frame(&emit_app, frame);
                        last_emitted.insert(session_id, Instant::now());
                    }
                }
            });
            sender
        })
        .clone()
}

fn haider_projection_should_emit_immediately(last_emitted: Option<Instant>, now: Instant) -> bool {
    last_emitted.is_none_or(|last| now.duration_since(last) > HAIDER_PROJECTION_IMMEDIATE_IDLE)
}

fn haider_projection_merge_frame(frame: &mut HaiderProjectionFrame, next: HaiderProjectionFrame) {
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
    frame.rows_overflow |= next.rows_overflow
        || frame.rows.len().saturating_add(next.rows.len()) > HAIDER_PROJECTION_EVENT_ROWS_LIMIT;
    if frame.rows_overflow {
        frame.rows.clear();
        frame.start_total = None;
    } else {
        frame.rows.extend(next.rows);
        frame.start_total = frame.start_total.or(next.start_total);
    }
}

fn haider_projection_emit_frame(app: &AppHandle, frame: HaiderProjectionFrame) {
    let rows = (!frame.rows_overflow && !frame.rows.is_empty()).then_some(frame.rows);
    let _ = app.emit_to(
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
            start_total: rows.as_ref().and(frame.start_total),
            rows,
        },
    );
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

fn haider_projection_stop_pipe_tail(session_id: &str) -> Result<bool, String> {
    let tail = haider_projection_pipe_manager()
        .lock()
        .map_err(|_| "Haider projection pipe manager is unavailable.".to_string())?
        .tails
        .remove(session_id);
    if let Some(tail) = tail {
        tail.stop.store(true, Ordering::Release);
        Ok(true)
    } else {
        Ok(false)
    }
}

async fn haider_projection_ingest_journal(
    app: Option<AppHandle>,
    session_id: String,
    provider_session_id: String,
) -> Result<HaiderProjectionJournalIngest, String> {
    let inspect_session_id = session_id.clone();
    let (journal_cursor, pipe_cursor, pipe_active) =
        tauri::async_runtime::spawn_blocking(move || {
            Ok::<_, String>((
                haider_projection_load_journal_cursor(&inspect_session_id)?,
                haider_projection_load_pipe_cursor(&inspect_session_id)?,
                haider_projection_pipe_manager()
                    .lock()
                    .is_ok_and(|manager| manager.tails.contains_key(&inspect_session_id)),
            ))
        })
        .await
        .map_err(|error| format!("Session journal cursor worker failed: {error}"))??;
    // Any pipe cursor beside journal coverage proves an offline fallback has
    // appended since the last canonical page. Rebuild from sequence one so
    // richer item metadata always wins when ADE comes back.
    let rebuild = journal_cursor.is_none() || pipe_cursor.is_some() || pipe_active;
    let mut start_seq = if rebuild {
        1
    } else {
        u64::try_from(
            journal_cursor
                .as_ref()
                .map_or(0, |cursor| cursor.covered_through_seq)
                .saturating_add(1),
        )
        .unwrap_or(u64::MAX)
    };
    let page_size = u64::try_from(HAIDER_PROJECTION_MAX_WINDOW_ROWS.max(1)).unwrap_or(1);
    let mut end_seq = start_seq.saturating_add(page_size.saturating_sub(1));
    let Some(first) =
        haider_rpc_ade::session_read_rpc(provider_session_id.clone(), start_seq, end_seq).await
    else {
        return Ok(HaiderProjectionJournalIngest::Unavailable);
    };
    let mut response = first?;
    let target_head = response.head_seq;
    let _ = haider_projection_stop_pipe_tail(&session_id)?;
    haider_projection_stop_session_watch(&session_id)?;

    let mut aggregate = None::<HaiderProjectionFrame>;
    let mut reset = rebuild;
    loop {
        if response.session_id != provider_session_id {
            return Err("session.read response session id did not match".to_string());
        }
        if response.range.start_seq != start_seq || response.range.end_seq != end_seq {
            return Err("session.read response range did not match".to_string());
        }
        let covered = end_seq.min(target_head).min(i64::MAX as u64) as i64;
        let page_app = app.clone();
        let page_session_id = session_id.clone();
        let page_provider_session_id = provider_session_id.clone();
        let page = tauri::async_runtime::spawn_blocking(move || {
            haider_projection_ingest_journal_page(
                page_app.as_ref(),
                &page_session_id,
                &page_provider_session_id,
                response,
                covered,
                reset,
            )
        })
        .await
        .map_err(|error| format!("Session journal fold worker failed: {error}"))??;
        match aggregate.as_mut() {
            Some(aggregate) => haider_projection_merge_frame(aggregate, page),
            None => aggregate = Some(page),
        }
        reset = false;
        if end_seq >= target_head {
            break;
        }
        start_seq = end_seq.saturating_add(1);
        end_seq = start_seq
            .saturating_add(page_size.saturating_sub(1))
            .min(target_head);
        let Some(next) =
            haider_rpc_ade::session_read_rpc(provider_session_id.clone(), start_seq, end_seq).await
        else {
            // The committed prefix remains valid. The tail will retry from
            // its cursor and activate the pipe only if the connection stays
            // unavailable.
            break;
        };
        response = next?;
    }
    Ok(HaiderProjectionJournalIngest::Connected(
        aggregate.expect("session.read always folds its first response"),
    ))
}

fn haider_projection_journal_finished(session_id: &str, generation: u64) {
    if let Ok(mut manager) = haider_projection_journal_manager().lock() {
        if manager
            .tails
            .get(session_id)
            .is_some_and(|tail| tail.generation == generation)
        {
            manager.tails.remove(session_id);
        }
    }
}

fn haider_projection_start_journal_tail(
    app: AppHandle,
    session_id: String,
    provider_session_id: String,
) -> Result<(), String> {
    let generation = HAIDER_PROJECTION_WATCH_GENERATION.fetch_add(1, Ordering::Relaxed);
    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut manager = haider_projection_journal_manager()
            .lock()
            .map_err(|_| "Haider projection journal manager is unavailable.".to_string())?;
        if manager.tails.contains_key(&session_id) {
            return Ok(());
        }
        manager.tails.insert(
            session_id.clone(),
            HaiderProjectionJournalTail {
                stop: stop.clone(),
                generation,
            },
        );
    }
    tauri::async_runtime::spawn(async move {
        while !HAIDER_PROJECTION_STOPPING.load(Ordering::Acquire) && !stop.load(Ordering::Acquire) {
            sleep(HAIDER_PROJECTION_PIPE_SAFETY_POLL).await;
            if HAIDER_PROJECTION_STOPPING.load(Ordering::Acquire) || stop.load(Ordering::Acquire) {
                break;
            }
            match haider_projection_ingest_journal(
                Some(app.clone()),
                session_id.clone(),
                provider_session_id.clone(),
            )
            .await
            {
                Ok(HaiderProjectionJournalIngest::Connected(frame))
                    if frame.appended > 0 || frame.tail_changed || frame.sync_changed =>
                {
                    let _ = haider_projection_frame_sender(&app).send(frame);
                }
                Ok(HaiderProjectionJournalIngest::Connected(_)) => {}
                Ok(HaiderProjectionJournalIngest::Unavailable) => {
                    let fallback_app = app.clone();
                    let fallback_session_id = session_id.clone();
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        let mut foreground = haider_projection_foreground(&fallback_session_id);
                        if haider_projection_attach_blocking(
                            fallback_app,
                            fallback_session_id,
                            &mut foreground,
                        )
                        .is_ok()
                        {
                            foreground.mark_attached();
                        }
                    })
                    .await;
                }
                Err(error) => eprintln!("Haider projection journal tail failed: {error}"),
            }
        }
        haider_projection_journal_finished(&session_id, generation);
    });
    Ok(())
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
    haider_projection_pipe_status()
        .get_or_init(|| haider_bridge_json_command("status"))
        .as_ref()
        .is_some_and(haider_projection_pipe_feature)
}

fn haider_projection_pipe_status() -> &'static OnceLock<Option<Value>> {
    static STATUS: OnceLock<Option<Value>> = OnceLock::new();
    &STATUS
}

fn haider_projection_pipe_route_from_status(
    status: &Value,
    provider_session_id: &str,
) -> Option<HaiderProjectionPipeRoute> {
    let pipe_dir = status
        .as_object()
        .and_then(|object| object.get("pipe_dir"))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())?;
    Some(HaiderProjectionPipeRoute {
        path: pipe_dir.join(format!("{provider_session_id}.pipe")),
        head_seq: haider_bridge_head_seq(provider_session_id),
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
    haider_projection_resolve_pipe_route_cached_with(
        haider_projection_pipe_routes(),
        provider_session_id,
        |provider_session_id| {
            haider_projection_pipe_status()
                .get_or_init(|| haider_bridge_json_command("status"))
                .as_ref()
                .and_then(|status| {
                    haider_projection_pipe_route_from_status(status, provider_session_id)
                })
                .map(Ok)
                .unwrap_or_else(|| haider_projection_resolve_pipe_route_rpc(provider_session_id))
        },
    )
}

fn haider_projection_resolve_pipe_route_cached_with(
    routes: &StdMutex<HashMap<String, HaiderProjectionPipeRoute>>,
    provider_session_id: &str,
    mut resolve: impl FnMut(&str) -> Result<HaiderProjectionPipeRoute, String>,
) -> Result<HaiderProjectionPipeRoute, String> {
    {
        let mut routes = routes
            .lock()
            .map_err(|_| "Haider pipe route cache is unavailable.".to_string())?;
        if let Some(route) = routes.get(provider_session_id) {
            if route.path.exists() {
                return Ok(route.clone());
            }
        }
        routes.remove(provider_session_id);
    }
    let route = resolve(provider_session_id)?;
    let mut routes = routes
        .lock()
        .map_err(|_| "Haider pipe route cache is unavailable.".to_string())?;
    if let Some(cached) = routes.get(provider_session_id) {
        if cached.path.exists() {
            return Ok(cached.clone());
        }
    }
    routes.insert(provider_session_id.to_string(), route.clone());
    Ok(route)
}

fn haider_projection_refresh_pipe_route_with(
    routes: &StdMutex<HashMap<String, HaiderProjectionPipeRoute>>,
    provider_session_id: &str,
    resolve: impl FnMut(&str) -> Result<HaiderProjectionPipeRoute, String>,
) -> Result<HaiderProjectionPipeRoute, String> {
    routes
        .lock()
        .map_err(|_| "Haider pipe route cache is unavailable.".to_string())?
        .remove(provider_session_id);
    haider_projection_resolve_pipe_route_cached_with(routes, provider_session_id, resolve)
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
    // v2 = 0.0.932 baseline; v3 (0.0.934) adds args_preview/result_preview on
    // tool rows — additive, and they ride into row meta untouched. v4 (0.0.939)
    // adds sealed `reasoning` on assistant rows, a `compaction_boundary` row
    // kind carrying no role, and a `segment_end` terminator.
    //
    // The v4 bump REBUILDS every sidecar on disk rather than leaving old files
    // on the old format, so refusing a version here is not a graceful
    // degradation — it takes the whole transcript offline for every session at
    // once. That is what happened when 939 landed against a 2..=3 gate.
    if !(2..=4).contains(&version) {
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
    let segment_index = match haider_projection_json_i64(object.get("segment")) {
        Some(segment) if segment >= 0 => segment,
        Some(_) => return Err("Haider pipe header segment was invalid.".to_string()),
        None => 0,
    };
    Ok(HaiderProjectionPipeHeader {
        session_id: session_id.to_string(),
        generation,
        segment_index,
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
            || cursor.segment_index < header.segment_index
            || (cursor.segment_index == header.segment_index
                && (cursor.byte_offset < header_end || cursor.byte_offset > file_len))
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
    let projected_kind = object.get("kind").and_then(Value::as_str) == Some("compaction_boundary");
    if !projected_role && !projected_kind && !haider_projection_pipe_usage_value(value) {
        return Ok(None);
    }
    let seq = haider_projection_json_i64(object.get("seq"))
        .ok_or_else(|| "Haider pipe row seq was missing.".to_string())?;
    let ordinal = haider_projection_json_i64(object.get("ordinal"))
        .ok_or_else(|| "Haider pipe row ordinal was missing.".to_string())?;
    Ok(Some((seq, ordinal)))
}

fn haider_projection_pipe_segment_successor(value: &Value) -> Result<Option<&str>, String> {
    let Some(object) = value.as_object() else {
        return Ok(None);
    };
    if object.get("segment_end").and_then(Value::as_str) != Some("sealed") {
        return Ok(None);
    }
    object
        .get("successor")
        .and_then(Value::as_str)
        .map(Some)
        .ok_or_else(|| "Haider pipe segment successor was missing.".to_string())
}

fn haider_projection_validate_pipe_successor(successor: &str) -> Result<&str, String> {
    let path = Path::new(successor);
    let mut components = path.components();
    let plain_basename = !successor.is_empty()
        && !successor.contains('/')
        && !successor.contains('\\')
        && !successor.contains("..")
        && !path.is_absolute()
        && matches!(components.next(), Some(Component::Normal(_)))
        && components.next().is_none();
    plain_basename
        .then_some(successor)
        .ok_or_else(|| "Haider pipe segment successor was not a plain basename.".to_string())
}

#[cfg(unix)]
fn haider_projection_open_pipe_successor(
    pipe_directory: &Path,
    successor: &str,
) -> Result<(fs::File, PathBuf), String> {
    use std::{
        ffi::CString,
        os::unix::io::{AsRawFd as _, FromRawFd as _},
    };

    let successor = haider_projection_validate_pipe_successor(successor)?;
    let directory = fs::File::open(pipe_directory)
        .map_err(|error| format!("Unable to open Haider pipe directory: {error}"))?;
    let name = CString::new(successor)
        .map_err(|_| "Haider pipe segment successor was not a plain basename.".to_string())?;
    // SAFETY: the directory descriptor and NUL-terminated basename remain
    // valid for this call. `openat` binds lookup to the pipe directory while
    // O_NOFOLLOW refuses a symlink at the hostile producer-controlled name.
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    if fd < 0 {
        return Err(format!(
            "Unable to open Haider pipe segment successor: {}",
            std::io::Error::last_os_error()
        ));
    }
    // SAFETY: `fd` was freshly returned by openat and ownership moves here.
    let file = unsafe { fs::File::from_raw_fd(fd) };
    if !file
        .metadata()
        .map_err(|error| format!("Unable to inspect Haider pipe segment successor: {error}"))?
        .is_file()
    {
        return Err("Haider pipe segment successor was not a regular file.".to_string());
    }
    Ok((file, pipe_directory.join(successor)))
}

#[cfg(not(unix))]
fn haider_projection_open_pipe_successor(
    pipe_directory: &Path,
    successor: &str,
) -> Result<(fs::File, PathBuf), String> {
    let successor = haider_projection_validate_pipe_successor(successor)?;
    let path = pipe_directory.join(successor);
    let file = fs::File::open(&path)
        .map_err(|error| format!("Unable to open Haider pipe segment successor: {error}"))?;
    if !file
        .metadata()
        .map_err(|error| format!("Unable to inspect Haider pipe segment successor: {error}"))?
        .is_file()
    {
        return Err("Haider pipe segment successor was not a regular file.".to_string());
    }
    Ok((file, path))
}

fn haider_projection_prepare_pipe_file(
    file: fs::File,
    provider_session_id: &str,
) -> Result<
    (
        std::io::BufReader<fs::File>,
        HaiderProjectionPipeHeader,
        i64,
        i64,
    ),
    String,
> {
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
    Ok((reader, header, header_end, file_len))
}

fn haider_projection_ingest_pipe(
    session_id: &str,
    provider_session_id: &str,
    route: &HaiderProjectionPipeRoute,
) -> Result<HaiderProjectionFrame, String> {
    haider_projection_ingest_pipe_cancellable(session_id, provider_session_id, route, &|| false)
}

fn haider_projection_state_snapshot(session_id: &str) -> Result<HaiderProjectionFoldState, String> {
    haider_projection_states()
        .lock()
        .map_err(|_| "Session projection state is unavailable.".to_string())?
        .get(session_id)
        .cloned()
        .ok_or_else(|| "Session projection state was not initialized.".to_string())
}

fn haider_projection_cancel_owned_pipe_ingest(
    session_id: &str,
    committed_state: &HaiderProjectionFoldState,
) -> String {
    if let Ok(mut states) = haider_projection_states().lock() {
        states.insert(session_id.to_string(), committed_state.clone());
    }
    "Haider projection prefold was cancelled.".to_string()
}

fn haider_projection_ingest_pipe_cancellable(
    session_id: &str,
    provider_session_id: &str,
    route: &HaiderProjectionPipeRoute,
    should_cancel: &dyn Fn() -> bool,
) -> Result<HaiderProjectionFrame, String> {
    let ingest_lock = haider_projection_ingest_lock(session_id)?;
    let _ingest_guard = match ingest_lock.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            ingest_lock.clear_poison();
            poisoned.into_inner()
        }
    };
    haider_projection_ingest_pipe_owned(session_id, provider_session_id, route, should_cancel)
}

fn haider_projection_ingest_pipe_owned(
    session_id: &str,
    provider_session_id: &str,
    route: &HaiderProjectionPipeRoute,
    should_cancel: &dyn Fn() -> bool,
) -> Result<HaiderProjectionFrame, String> {
    if let Some(head_seq) = route.head_seq {
        haider_bridge_note_head_seq(provider_session_id, head_seq);
    }
    let root_file = fs::File::open(&route.path)
        .map_err(|error| format!("Unable to open Haider session pipe: {error}"))?;
    let (mut reader, root_header, root_header_end, root_file_len) =
        haider_projection_prepare_pipe_file(root_file, provider_session_id)?;
    let pipe_directory = route
        .path
        .parent()
        .ok_or_else(|| "Haider pipe path had no parent directory.".to_string())?;
    if should_cancel() {
        return Err("Haider projection prefold was cancelled.".to_string());
    }

    let existing = haider_projection_load_pipe_cursor(session_id)?;
    let journal_coverage =
        haider_projection_load_journal_cursor(session_id)?.map(|cursor| cursor.covered_through_seq);
    if existing
        .as_ref()
        .is_some_and(|cursor| cursor.generation > root_header.generation)
    {
        return Err("Haider pipe generation was stale.".to_string());
    }
    if existing.as_ref().is_some_and(|cursor| {
        cursor.generation == root_header.generation
            && cursor.segment_index == root_header.segment_index
            && cursor.byte_offset > root_file_len
    }) {
        return Err("Haider pipe route was stale.".to_string());
    }
    // A pipe opened only because the ADE connection disappeared is an
    // incremental fallback over the already-folded journal. Do not erase the
    // richer canonical rows merely because no byte cursor exists yet.
    let preserve_journal = existing.is_none() && journal_coverage.is_some();
    let reset = !preserve_journal
        && haider_projection_pipe_requires_refold(
            existing.as_ref(),
            &root_header,
            root_header_end,
            root_file_len,
        );
    if should_cancel() {
        return Err("Haider projection prefold was cancelled.".to_string());
    }
    let mut cursor = if reset {
        let cursor = HaiderProjectionPipeCursor {
            session_id: session_id.to_string(),
            segment_index: root_header.segment_index,
            byte_offset: root_header_end,
            generation: root_header.generation,
            ..HaiderProjectionPipeCursor::default()
        };
        haider_projection_reset_pipe_session(session_id, &cursor)?;
        cursor
    } else if let Some(existing) = existing {
        existing
    } else {
        HaiderProjectionPipeCursor {
            session_id: session_id.to_string(),
            segment_index: root_header.segment_index,
            byte_offset: root_header_end,
            generation: root_header.generation,
            covered_through_seq: journal_coverage.unwrap_or_default(),
            coverage_known: journal_coverage.is_some(),
            ..HaiderProjectionPipeCursor::default()
        }
    };
    let mut header = root_header;
    let mut current_file_len = root_file_len;
    let mut visited_segments = HashSet::new();
    if let Some(root_name) = route.path.file_name().and_then(|name| name.to_str()) {
        visited_segments.insert(root_name.to_string());
    }
    if !cursor.segment_name.is_empty() {
        let segment_name = haider_projection_validate_pipe_successor(&cursor.segment_name)?;
        if !visited_segments.insert(segment_name.to_string()) {
            return Err("Haider pipe segment successor cycle was detected.".to_string());
        }
        let (file, _) = haider_projection_open_pipe_successor(pipe_directory, segment_name)?;
        let (segment_reader, segment_header, segment_header_end, segment_file_len) =
            haider_projection_prepare_pipe_file(file, provider_session_id)?;
        if segment_header.generation != header.generation
            || segment_header.segment_index != cursor.segment_index
            || cursor.byte_offset < segment_header_end
            || cursor.byte_offset > segment_file_len
        {
            return Err("Haider pipe segment cursor was stale.".to_string());
        }
        reader = segment_reader;
        header = segment_header;
        current_file_len = segment_file_len;
    }
    if cursor.byte_offset > current_file_len {
        return Err("Haider pipe route was stale.".to_string());
    }
    reader
        .seek(SeekFrom::Start(cursor.byte_offset.max(0) as u64))
        .map_err(|error| format!("Unable to resume Haider session pipe: {error}"))?;
    haider_projection_initialize_state(session_id)?;
    let mut committed_state = haider_projection_state_snapshot(session_id)?;

    let mut line = Vec::new();
    let mut rows = Vec::new();
    let mut line_count = 0usize;
    let mut appended = 0usize;
    let mut total_rows = haider_projection_state_total_rows(session_id)?;
    let mut from_seq = None;
    let mut event_rows = Vec::new();
    let mut event_rows_overflow = false;
    let mut start_total = None;
    let mut advanced = false;
    let mut consumed_to_final_eof = false;

    loop {
        if should_cancel() {
            return Err(haider_projection_cancel_owned_pipe_ingest(
                session_id,
                &committed_state,
            ));
        }
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
                consumed_to_final_eof = true;
                break;
            }
        };
        // Any complete growth invalidates an earlier final-EOF proof until we
        // reach EOF again. In particular, consuming a new segment terminator
        // must clear the proof before successor validation/open can fail.
        if let Ok(mut states) = haider_projection_states().lock() {
            if let Some(state) = states.get_mut(session_id) {
                state.pipe_eof_max_seq = None;
            }
        }
        let value: Value = serde_json::from_slice(&line)
            .map_err(|error| format!("Unable to decode Haider pipe line: {error}"))?;
        let successor = haider_projection_pipe_segment_successor(&value)?;
        if let Some(coverage) =
            haider_projection_pipe_coverage(cursor.covered_through_seq, &value, header.generation)?
        {
            cursor.covered_through_seq = coverage;
            cursor.coverage_known = true;
        } else if let Some((seq, ordinal)) = haider_projection_pipe_row_identity(&value)? {
            // Observed v2: text rows carry role/text/at_ms/seq/ordinal;
            // tool rows use name/summary; branch_id is present only off-main.
            if journal_coverage.is_none_or(|coverage| seq > coverage) {
                let step = {
                    let mut states = haider_projection_states()
                        .lock()
                        .map_err(|_| "Session projection state is unavailable.".to_string())?;
                    let state = states.get_mut(session_id).ok_or_else(|| {
                        "Session projection state was not initialized.".to_string()
                    })?;
                    haider_projection_fold_pipe_value_locked(state, session_id, &value)
                };
                rows.extend(step.rows);
            }
            if (seq, ordinal) > (cursor.last_seq, cursor.last_ordinal) {
                cursor.last_seq = seq;
                cursor.last_ordinal = ordinal;
            }
        }
        cursor.byte_offset = cursor.byte_offset.saturating_add(consumed);
        advanced = true;
        line_count = line_count.saturating_add(1);

        if let Some(successor) = successor {
            let successor = haider_projection_validate_pipe_successor(successor)?;
            if !visited_segments.insert(successor.to_string()) {
                return Err("Haider pipe segment successor cycle was detected.".to_string());
            }
            let (file, _) = haider_projection_open_pipe_successor(pipe_directory, successor)?;
            let (next_reader, next_header, next_header_end, _) =
                haider_projection_prepare_pipe_file(file, provider_session_id)?;
            if next_header.generation != header.generation {
                return Err("Haider pipe coverage generation changed between segments.".to_string());
            }
            if next_header.segment_index <= header.segment_index {
                return Err("Haider pipe successor segment did not advance.".to_string());
            }
            cursor.segment_name = successor.to_string();
            cursor.segment_index = next_header.segment_index;
            cursor.byte_offset = next_header_end;
            reader = next_reader;
            header = next_header;
        }

        if line_count >= HAIDER_PROJECTION_PIPE_BATCH_LINES {
            if should_cancel() {
                return Err(haider_projection_cancel_owned_pipe_ingest(
                    session_id,
                    &committed_state,
                ));
            }
            let batch_from = rows.iter().map(|row| row.seq).min();
            let persisted =
                haider_projection_persist_batch(session_id, &rows, Some(&cursor), None)?;
            let batch_appended = persisted.rows.len();
            if batch_appended > 0 {
                start_total.get_or_insert_with(|| {
                    persisted
                        .total_rows
                        .saturating_sub(i64::try_from(batch_appended).unwrap_or(i64::MAX))
                });
                if event_rows.len().saturating_add(batch_appended)
                    > HAIDER_PROJECTION_EVENT_ROWS_LIMIT
                {
                    event_rows_overflow = true;
                    event_rows.clear();
                } else if !event_rows_overflow {
                    event_rows.extend(persisted.rows);
                }
            }
            appended = appended.saturating_add(batch_appended);
            total_rows = persisted.total_rows;
            from_seq = match (from_seq, batch_from.filter(|_| batch_appended > 0)) {
                (Some(left), Some(right)) => Some(left.min(right)),
                (None, value) | (value, None) => value,
            };
            rows.clear();
            line_count = 0;
            committed_state = haider_projection_state_snapshot(session_id)?;
        }
    }

    if should_cancel() {
        return Err(haider_projection_cancel_owned_pipe_ingest(
            session_id,
            &committed_state,
        ));
    }
    if advanced && (line_count > 0 || !rows.is_empty()) {
        let batch_from = rows.iter().map(|row| row.seq).min();
        let persisted = haider_projection_persist_batch(session_id, &rows, Some(&cursor), None)?;
        let batch_appended = persisted.rows.len();
        if batch_appended > 0 {
            start_total.get_or_insert_with(|| {
                persisted
                    .total_rows
                    .saturating_sub(i64::try_from(batch_appended).unwrap_or(i64::MAX))
            });
            if event_rows.len().saturating_add(batch_appended) > HAIDER_PROJECTION_EVENT_ROWS_LIMIT
            {
                event_rows_overflow = true;
                event_rows.clear();
            } else if !event_rows_overflow {
                event_rows.extend(persisted.rows);
            }
        }
        appended = appended.saturating_add(batch_appended);
        total_rows = persisted.total_rows;
        from_seq = match (from_seq, batch_from.filter(|_| batch_appended > 0)) {
            (Some(left), Some(right)) => Some(left.min(right)),
            (None, value) | (value, None) => value,
        };
        committed_state = haider_projection_state_snapshot(session_id)?;
    }
    if let Ok(mut states) = haider_projection_states().lock() {
        if let Some(state) = states.get_mut(session_id) {
            state.total_rows = total_rows;
            if consumed_to_final_eof {
                state.pipe_eof_max_seq = Some(cursor.last_seq.max(cursor.covered_through_seq));
            }
            committed_state = state.clone();
        }
    }
    if should_cancel() {
        return Err(haider_projection_cancel_owned_pipe_ingest(
            session_id,
            &committed_state,
        ));
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
        pipe_max_seq: Some(cursor.last_seq),
        caught_up: sync.caught_up,
        sync_changed: reset || advanced,
        rows: event_rows,
        start_total: (!event_rows_overflow).then_some(start_total).flatten(),
        rows_overflow: event_rows_overflow,
    })
}

fn haider_projection_ingest_pipe_route_retry(
    session_id: &str,
    provider_session_id: &str,
    route: HaiderProjectionPipeRoute,
) -> Result<(HaiderProjectionFrame, HaiderProjectionPipeRoute), String> {
    haider_projection_ingest_pipe_route_retry_cancellable(
        session_id,
        provider_session_id,
        route,
        &|| false,
    )
}

fn haider_projection_ingest_pipe_route_retry_cancellable(
    session_id: &str,
    provider_session_id: &str,
    route: HaiderProjectionPipeRoute,
    should_cancel: &dyn Fn() -> bool,
) -> Result<(HaiderProjectionFrame, HaiderProjectionPipeRoute), String> {
    let ingest_lock = haider_projection_ingest_lock(session_id)?;
    let _ingest_guard = match ingest_lock.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            ingest_lock.clear_poison();
            poisoned.into_inner()
        }
    };
    haider_projection_ingest_pipe_route_retry_owned_with(
        session_id,
        provider_session_id,
        route,
        should_cancel,
        || {
            haider_projection_refresh_pipe_route_with(
                haider_projection_pipe_routes(),
                provider_session_id,
                haider_projection_resolve_pipe_route_rpc,
            )
        },
    )
}

fn haider_projection_head_advanced_without_pipe_progress(frame: &HaiderProjectionFrame) -> bool {
    !frame.sync_changed
        && frame.head_seq.is_some_and(|head_seq| {
            frame
                .covered_through_seq
                .or(frame.pipe_max_seq)
                .is_some_and(|pipe_seq| pipe_seq < head_seq)
        })
}

fn haider_projection_ingest_pipe_route_retry_owned_with(
    session_id: &str,
    provider_session_id: &str,
    route: HaiderProjectionPipeRoute,
    should_cancel: &dyn Fn() -> bool,
    mut refresh: impl FnMut() -> Result<HaiderProjectionPipeRoute, String>,
) -> Result<(HaiderProjectionFrame, HaiderProjectionPipeRoute), String> {
    match haider_projection_ingest_pipe_owned(
        session_id,
        provider_session_id,
        &route,
        should_cancel,
    ) {
        Ok(frame) if haider_projection_head_advanced_without_pipe_progress(&frame) => {
            let route = refresh()?;
            let frame = haider_projection_ingest_pipe_owned(
                session_id,
                provider_session_id,
                &route,
                should_cancel,
            )?;
            Ok((frame, route))
        }
        Ok(frame) => Ok((frame, route)),
        Err(error)
            if !route.path.exists()
                || error.contains("Haider pipe header session id did not match.")
                || error.contains("Haider pipe generation was stale.")
                || error.contains("Haider pipe route was stale.") =>
        {
            let route = refresh()?;
            let frame = haider_projection_ingest_pipe_owned(
                session_id,
                provider_session_id,
                &route,
                should_cancel,
            )?;
            Ok((frame, route))
        }
        Err(error) => Err(error),
    }
}

fn haider_projection_ingest_resolved_pipe(
    session_id: &str,
    provider_session_id: &str,
) -> Result<(HaiderProjectionFrame, HaiderProjectionPipeRoute), String> {
    let route = haider_projection_resolve_pipe_route(provider_session_id)?;
    haider_projection_ingest_pipe_route_retry(session_id, provider_session_id, route)
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
    let row = haider_projection_with_database(|connection| {
        sessions_row_by_id(connection, session_id.trim())
    })?;
    let provider_session_id = row.provider_session_id.trim().to_string();
    if provider_session_id.is_empty() {
        return Err("Haider session id is not bound yet.".to_string());
    }
    Ok((row, provider_session_id))
}

fn haider_projection_local_session_for_provider(provider_session_id: &str) -> Option<String> {
    haider_projection_with_database(|connection| {
        match connection
            .prepare_cached(
                "SELECT id FROM sessions
                 WHERE provider_session_id = ?1 LIMIT 1",
            )
            .and_then(|mut statement| {
                statement.query_row([provider_session_id], |row| row.get::<_, String>(0))
            }) {
            Ok(session_id) => Ok(Some(session_id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(format!("Unable to resolve prefold session: {error}")),
        }
    })
    .ok()
    .flatten()
}

fn haider_projection_prefold_cancelled(session_id: &str, provider_session_id: &str) -> bool {
    if HAIDER_PROJECTION_STOPPING.load(Ordering::Acquire) {
        return true;
    }
    match haider_projection_prefold_manager().lock() {
        Ok(manager) => {
            !manager.active.is_empty()
                || manager.attached.contains(session_id)
                || manager.attached.contains(provider_session_id)
        }
        Err(_) => true,
    }
}

fn haider_projection_prefold_one(session_id: &str, provider_session_id: &str) {
    if haider_projection_prefold_cancelled(session_id, provider_session_id) {
        return;
    }
    let Ok(route) = haider_projection_resolve_pipe_route(provider_session_id) else {
        return;
    };
    if haider_projection_prefold_cancelled(session_id, provider_session_id) {
        return;
    }
    let cancelled = || haider_projection_prefold_cancelled(session_id, provider_session_id);
    let _ = haider_projection_ingest_pipe_route_retry_cancellable(
        session_id,
        provider_session_id,
        route,
        &cancelled,
    );
}

fn haider_projection_prefold_enqueue_with(
    manager: &StdMutex<HaiderProjectionPrefoldManager>,
    provider_session_ids: impl IntoIterator<Item = String>,
) -> bool {
    let Ok(mut manager) = manager.lock() else {
        return false;
    };
    for provider_session_id in provider_session_ids {
        let provider_session_id = provider_session_id.trim();
        if provider_session_id.is_empty()
            || manager.active.contains(provider_session_id)
            || manager.attached.contains(provider_session_id)
            || !manager.queued.insert(provider_session_id.to_string())
        {
            continue;
        }
        if manager.queue.len() >= HAIDER_PROJECTION_PREFOLD_QUEUE_LIMIT {
            if let Some(evicted) = manager.queue.pop_front() {
                manager.queued.remove(&evicted);
            }
        }
        manager.queue.push_back(provider_session_id.to_string());
    }
    if manager.queue.is_empty() || manager.worker_running {
        return false;
    }
    manager.worker_running = true;
    true
}

fn haider_projection_prefold_drain_with(
    manager: &StdMutex<HaiderProjectionPrefoldManager>,
    mut resolve_local: impl FnMut(&str) -> Option<String>,
    mut fold: impl FnMut(&str, &str),
) {
    loop {
        let provider_session_id = {
            let Ok(mut manager) = manager.lock() else {
                return;
            };
            let Some(provider_session_id) = manager.queue.pop_front() else {
                manager.worker_running = false;
                return;
            };
            manager.queued.remove(&provider_session_id);
            if manager.active.contains(&provider_session_id)
                || manager.attached.contains(&provider_session_id)
            {
                continue;
            }
            provider_session_id
        };
        let Some(session_id) = resolve_local(&provider_session_id) else {
            continue;
        };
        {
            let Ok(mut manager) = manager.lock() else {
                return;
            };
            if manager.active.contains(&provider_session_id)
                || manager.active.contains(&session_id)
                || manager.attached.contains(&provider_session_id)
                || manager.attached.contains(&session_id)
            {
                continue;
            }
            manager.in_flight = Some((provider_session_id.clone(), session_id.clone()));
        }
        fold(&session_id, &provider_session_id);
        if let Ok(mut manager) = manager.lock() {
            if manager.in_flight.as_ref()
                == Some(&(provider_session_id.clone(), session_id.clone()))
            {
                manager.in_flight = None;
            }
        }
        thread::yield_now();
    }
}

fn haider_projection_prefold_enqueue_provider_sessions(provider_session_ids: Vec<String>) {
    if !haider_projection_prefold_enqueue_with(
        haider_projection_prefold_manager(),
        provider_session_ids,
    ) {
        return;
    }
    #[cfg(not(test))]
    thread::spawn(|| {
        haider_projection_prefold_drain_with(
            haider_projection_prefold_manager(),
            haider_projection_local_session_for_provider,
            |session_id, provider_session_id| {
                thread::sleep(Duration::from_millis(10));
                haider_projection_prefold_one(session_id, provider_session_id);
            },
        );
    });
}

fn haider_projection_prefold_detach(ids: &[String]) {
    if let Ok(mut manager) = haider_projection_prefold_manager().lock() {
        for id in ids {
            manager.attached.remove(id);
        }
    }
}

fn haider_projection_decode_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionProjectionRow> {
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
}

fn haider_projection_window_rows_keyset(
    connection: &mut rusqlite::Connection,
    session_id: &str,
    start_index: i64,
    count: i64,
    total_rows: i64,
) -> Result<Vec<SessionProjectionRow>, String> {
    if count == 0 || start_index >= total_rows {
        return Ok(Vec::new());
    }
    let (base_index, base_anchor, following) = {
        let states = haider_projection_states()
            .lock()
            .map_err(|_| "Session projection state is unavailable.".to_string())?;
        let anchors = states.get(session_id).map(|state| &state.window_anchors);
        let preceding = anchors
            .and_then(|anchors| {
                anchors
                    .iter()
                    .filter(|(index, _)| **index <= start_index)
                    .max_by_key(|(index, _)| *index)
                    .map(|(index, anchor)| (*index, *anchor))
            })
            .unwrap_or((0, (-1, -1)));
        let following = anchors.and_then(|anchors| {
            anchors
                .iter()
                .filter(|(index, _)| **index > start_index)
                .min_by_key(|(index, _)| *index)
                .map(|(index, anchor)| (*index, *anchor))
        });
        (preceding.0, preceding.1, following)
    };
    let forward_distance = start_index - base_index;
    let reverse_index = following.map_or(total_rows.saturating_add(1), |(index, _)| index);
    let reverse_distance = reverse_index - start_index;
    let mut anchor = base_anchor;
    if reverse_distance < forward_distance {
        let skipped = if let Some((_, following_anchor)) = following {
            connection
                .prepare_cached(
                    "SELECT seq, ordinal FROM session_projection_rows
                     WHERE session_id = ?1 AND (seq, ordinal) < (?2, ?3)
                     ORDER BY seq DESC, ordinal DESC LIMIT ?4",
                )
                .and_then(|mut statement| {
                    statement
                        .query_map(
                            rusqlite::params![
                                session_id,
                                following_anchor.0,
                                following_anchor.1,
                                reverse_distance
                            ],
                            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                        )?
                        .collect::<Result<Vec<_>, _>>()
                })
        } else {
            connection
                .prepare_cached(
                    "SELECT seq, ordinal FROM session_projection_rows
                     WHERE session_id = ?1
                     ORDER BY seq DESC, ordinal DESC LIMIT ?2",
                )
                .and_then(|mut statement| {
                    statement
                        .query_map(rusqlite::params![session_id, reverse_distance], |row| {
                            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
                        })?
                        .collect::<Result<Vec<_>, _>>()
                })
        }
        .map_err(|error| format!("Unable to reverse-seek session projection window: {error}"))?;
        if i64::try_from(skipped.len()).unwrap_or(i64::MAX) < reverse_distance {
            return Ok(Vec::new());
        }
        let mut states = haider_projection_states()
            .lock()
            .map_err(|_| "Session projection state is unavailable.".to_string())?;
        if let Some(state) = states.get_mut(session_id) {
            for (offset, key) in skipped.iter().copied().enumerate() {
                state.window_anchors.insert(
                    reverse_index - i64::try_from(offset).unwrap_or(i64::MAX) - 1,
                    key,
                );
            }
        }
        anchor = skipped.last().copied().unwrap_or(anchor);
    } else if base_index < start_index {
        let skipped = connection
            .prepare_cached(
                "SELECT seq, ordinal FROM session_projection_rows
                 WHERE session_id = ?1 AND (seq, ordinal) > (?2, ?3)
                 ORDER BY seq, ordinal LIMIT ?4",
            )
            .and_then(|mut statement| {
                statement
                    .query_map(
                        rusqlite::params![session_id, anchor.0, anchor.1, start_index - base_index],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                    )?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(|error| format!("Unable to seek session projection window: {error}"))?;
        if i64::try_from(skipped.len()).unwrap_or(i64::MAX) < start_index - base_index {
            return Ok(Vec::new());
        }
        let mut states = haider_projection_states()
            .lock()
            .map_err(|_| "Session projection state is unavailable.".to_string())?;
        if let Some(state) = states.get_mut(session_id) {
            for (offset, key) in skipped.iter().copied().enumerate() {
                state.window_anchors.insert(
                    base_index + i64::try_from(offset).unwrap_or(i64::MAX) + 1,
                    key,
                );
            }
        }
        anchor = skipped.last().copied().unwrap_or(anchor);
    }
    let rows = connection
        .prepare_cached(
            "SELECT session_id, seq, ordinal, branch_id, kind, role, text, meta, at_ms
             FROM session_projection_rows
             WHERE session_id = ?1 AND (seq, ordinal) > (?2, ?3)
             ORDER BY seq, ordinal LIMIT ?4",
        )
        .and_then(|mut statement| {
            statement
                .query_map(
                    rusqlite::params![session_id, anchor.0, anchor.1, count],
                    haider_projection_decode_row,
                )?
                .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|error| format!("Unable to read session projection window: {error}"))?;
    let mut states = haider_projection_states()
        .lock()
        .map_err(|_| "Session projection state is unavailable.".to_string())?;
    if let Some(state) = states.get_mut(session_id) {
        for (offset, row) in rows.iter().enumerate() {
            state.window_anchors.insert(
                start_index + i64::try_from(offset).unwrap_or(i64::MAX) + 1,
                (row.seq, row.ordinal),
            );
        }
    }
    Ok(rows)
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

fn haider_projection_rebuild_pipe_watcher(
    watched_path: &mut PathBuf,
    watcher: &mut Option<HaiderProjectionPipeWatcher>,
    receiver: &mut Option<std::sync::mpsc::Receiver<()>>,
    route: &HaiderProjectionPipeRoute,
) -> bool {
    if *watched_path == route.path {
        return false;
    }
    let replacement = haider_projection_pipe_watcher(&route.path);
    let (next_watcher, next_receiver) = match replacement {
        Some((watcher, receiver)) => (Some(watcher), Some(receiver)),
        None => (None, None),
    };
    *watcher = next_watcher;
    *receiver = next_receiver;
    *watched_path = route.path.clone();
    true
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
        let mut route = route;
        let mut watched_path = route.path.clone();
        let watcher = haider_projection_pipe_watcher(&watched_path);
        let (mut watcher, mut receiver) = match watcher {
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
            match haider_projection_ingest_pipe_route_retry(
                &session_id,
                &provider_session_id,
                route.clone(),
            ) {
                Ok((frame, refreshed_route))
                    if frame.appended > 0 || frame.tail_changed || frame.sync_changed =>
                {
                    haider_projection_rebuild_pipe_watcher(
                        &mut watched_path,
                        &mut watcher,
                        &mut receiver,
                        &refreshed_route,
                    );
                    route = refreshed_route;
                    let _ = haider_projection_frame_sender(&app).send(frame);
                }
                Ok((_, refreshed_route)) => {
                    haider_projection_rebuild_pipe_watcher(
                        &mut watched_path,
                        &mut watcher,
                        &mut receiver,
                        &refreshed_route,
                    );
                    route = refreshed_route;
                }
                Err(error) => eprintln!("Haider projection pipe tail failed: {error}"),
            }
        }
        haider_projection_pipe_finished(&session_id, generation);
    });
    Ok(())
}

fn haider_projection_attach_blocking(
    app: AppHandle,
    session_id: String,
    foreground: &mut HaiderProjectionForeground,
) -> Result<(), String> {
    let _attach_guard = haider_projection_attach_lock()
        .lock()
        .map_err(|_| "Haider projection attach lock is unavailable.".to_string())?;
    let (_, provider_session_id) = haider_projection_resolve_provider_session(&session_id)?;
    foreground.add(&provider_session_id);
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
    if let Ok((frame, route)) =
        haider_projection_ingest_resolved_pipe(&session_id, &provider_session_id)
    {
        let pipe_has_usage = haider_projection_pipe_has_usage(&route.path);
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

    haider_projection_start_watch(app, session_id, provider_session_id, baseline_seq, false)
}

fn haider_projection_stop() {
    HAIDER_PROJECTION_STOPPING.store(true, Ordering::Release);
    if let Ok(mut manager) = haider_projection_journal_manager().lock() {
        for (_, tail) in manager.tails.drain() {
            tail.stop.store(true, Ordering::Release);
        }
    }
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
    if let Ok(mut manager) = haider_projection_prefold_manager().lock() {
        manager.queue.clear();
        manager.queued.clear();
        manager.active.clear();
        manager.attached.clear();
        manager.in_flight = None;
        manager.worker_running = false;
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn session_projection_window(
    session_id: String,
    start_index: i64,
    count: i64,
) -> Result<SessionProjectionWindow, String> {
    #[cfg(debug_assertions)]
    let timed_at = Instant::now();
    #[cfg(debug_assertions)]
    let timed_session = session_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let session_id = session_id.trim();
        let start_index = start_index.max(0);
        let count = count.clamp(0, HAIDER_PROJECTION_MAX_WINDOW_ROWS);
        let (total_rows, rows) = haider_projection_with_database(|connection| {
            haider_projection_initialize_state_with_connection(connection, session_id)?;
            let total_rows = haider_projection_states()
                .lock()
                .map_err(|_| "Session projection state is unavailable.".to_string())?
                .get(session_id)
                .map(|state| state.total_rows)
                .ok_or_else(|| "Session projection state was not initialized.".to_string())?;
            let rows = haider_projection_window_rows_keyset(
                connection,
                session_id,
                start_index,
                count,
                total_rows,
            )?;
            Ok((total_rows, rows))
        })?;
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
    .map_err(|error| format!("Session projection window worker failed: {error}"))
    .map(|result| {
        // Dev-build click-path telemetry: stderr lands in the detached
        // launch log, so real clicks produce real numbers. Never in release.
        #[cfg(debug_assertions)]
        eprintln!(
            "[ade-timing] window {}ms session={timed_session}",
            timed_at.elapsed().as_millis()
        );
        result
    })?
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
        haider_projection_with_database(|connection| {
            let mut statement = connection
                .prepare_cached(
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
                            let meta: Value =
                                serde_json::from_str(&meta_text).unwrap_or(Value::Null);
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
    })
    .await
    .map_err(|error| format!("Session trajectory worker failed: {error}"))?
}

fn haider_projection_ensure_blocking(
    session_id: &str,
    foreground: &mut HaiderProjectionForeground,
) -> Result<i64, String> {
    let total_rows = haider_projection_state_total_rows(session_id)?;
    let provider = haider_projection_resolve_provider_session(session_id).ok();
    if let Some((_, provider_session_id)) = provider.as_ref() {
        foreground.add(provider_session_id);
        if haider_projection_ingest_resolved_pipe(session_id, provider_session_id).is_ok() {
            return haider_projection_state_total_rows(session_id);
        }
    }
    if total_rows > 0 {
        return Ok(total_rows);
    }
    let (_, provider_session_id) =
        provider.ok_or_else(|| "Haider session id is not bound yet.".to_string())?;
    let export = haider_projection_export_json(&provider_session_id)?;
    let _ = haider_projection_ingest_value(None, session_id, &export)?;
    haider_projection_state_total_rows(session_id)
}

#[tauri::command(rename_all = "snake_case")]
async fn session_projection_ensure(session_id: String) -> Result<i64, String> {
    #[cfg(debug_assertions)]
    let timed_at = Instant::now();
    #[cfg(debug_assertions)]
    let timed_session = session_id.clone();
    let session_id = session_id.trim().to_string();
    let mut foreground = haider_projection_foreground(&session_id);
    let resolve_session_id = session_id.clone();
    let provider = tauri::async_runtime::spawn_blocking(move || {
        haider_projection_resolve_provider_session(&resolve_session_id)
    })
    .await
    .map_err(|error| format!("Session projection resolve worker failed: {error}"))
    .ok()
    .and_then(Result::ok);
    /* The PIPE is the hot path and stays that way: the daemon writes it for
    this client specifically, it is a compact transcript projection, and
    tailing it costs a seek and a few KB. The JOURNAL is richer but 2-4x
    the bytes per event, so it earns its place on a COLD load — where it
    replaces a `haider export` PROCESS SPAWN measured at a ~25ms floor —
    and never on the incremental path a pipe already serves cheaply. */
    let already_projected = {
        let warm_session_id = session_id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            haider_projection_state_total_rows(&warm_session_id).unwrap_or(0) > 0
        })
        .await
        .unwrap_or(false)
    };
    if already_projected {
        if let Some((_, provider_session_id)) = provider.clone() {
            let pipe_session_id = session_id.clone();
            let warmed = tauri::async_runtime::spawn_blocking(move || {
                haider_projection_ingest_resolved_pipe(&pipe_session_id, &provider_session_id)
                    .is_ok()
            })
            .await
            .unwrap_or(false);
            if warmed {
                let total_session_id = session_id.clone();
                let total = tauri::async_runtime::spawn_blocking(move || {
                    haider_projection_state_total_rows(&total_session_id)
                })
                .await
                .map_err(|error| format!("Session projection total worker failed: {error}"))?;
                #[cfg(debug_assertions)]
                eprintln!(
                    "[ade-timing] ensure {}ms session={timed_session} (pipe)",
                    timed_at.elapsed().as_millis()
                );
                return total;
            }
        }
    }
    let result = if let Some((_, provider_session_id)) = provider {
        foreground.add(&provider_session_id);
        match haider_projection_ingest_journal(None, session_id.clone(), provider_session_id)
            .await?
        {
            HaiderProjectionJournalIngest::Connected(frame) => Ok(frame.total_rows),
            HaiderProjectionJournalIngest::Unavailable => {
                let fallback_session_id = session_id.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ensure_guard = haider_projection_ensure_lock().lock().map_err(|_| {
                        "Session projection ensure lock is unavailable.".to_string()
                    })?;
                    haider_projection_ensure_blocking(&fallback_session_id, &mut foreground)
                })
                .await
                .map_err(|error| format!("Session projection ensure worker failed: {error}"))?
            }
        }
    } else {
        let fallback_session_id = session_id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _ensure_guard = haider_projection_ensure_lock()
                .lock()
                .map_err(|_| "Session projection ensure lock is unavailable.".to_string())?;
            haider_projection_ensure_blocking(&fallback_session_id, &mut foreground)
        })
        .await
        .map_err(|error| format!("Session projection ensure worker failed: {error}"))?
    };
    #[cfg(debug_assertions)]
    eprintln!(
        "[ade-timing] ensure {}ms session={timed_session}",
        timed_at.elapsed().as_millis()
    );
    result
}

#[tauri::command(rename_all = "snake_case")]
async fn session_projection_attach(app: AppHandle, session_id: String) -> Result<(), String> {
    let session_id = session_id.trim().to_string();
    let mut foreground = haider_projection_foreground(&session_id);
    let resolve_session_id = session_id.clone();
    let (_, provider_session_id) = tauri::async_runtime::spawn_blocking(move || {
        haider_projection_resolve_provider_session(&resolve_session_id)
    })
    .await
    .map_err(|error| format!("Session projection resolve worker failed: {error}"))??;
    foreground.add(&provider_session_id);
    HAIDER_PROJECTION_STOPPING.store(false, Ordering::Release);
    match haider_projection_ingest_journal(
        Some(app.clone()),
        session_id.clone(),
        provider_session_id.clone(),
    )
    .await?
    {
        HaiderProjectionJournalIngest::Connected(frame) => {
            if frame.appended > 0 || frame.tail_changed || frame.sync_changed {
                let _ = haider_projection_frame_sender(&app).send(frame);
            }
        }
        HaiderProjectionJournalIngest::Unavailable => {
            let fallback_app = app.clone();
            let fallback_session_id = session_id.clone();
            tauri::async_runtime::spawn_blocking(move || {
                haider_projection_attach_blocking(
                    fallback_app,
                    fallback_session_id,
                    &mut foreground,
                )?;
                foreground.mark_attached();
                Ok::<_, String>(())
            })
            .await
            .map_err(|error| format!("Session projection attach worker failed: {error}"))??;
            haider_projection_start_journal_tail(app, session_id, provider_session_id)?;
            return Ok(());
        }
    }
    haider_projection_start_journal_tail(app, session_id, provider_session_id)?;
    foreground.mark_attached();
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
async fn session_projection_detach(session_id: String) -> Result<(), String> {
    let session_id = session_id.trim().to_string();
    let mut detached = vec![session_id.clone()];
    if let Ok((_, provider_session_id)) = haider_projection_resolve_provider_session(&session_id) {
        detached.push(provider_session_id);
    }
    if let Some(tail) = haider_projection_journal_manager()
        .lock()
        .map_err(|_| "Haider projection journal manager is unavailable.".to_string())?
        .tails
        .remove(&session_id)
    {
        tail.stop.store(true, Ordering::Release);
    }
    if let Some(tail) = haider_projection_pipe_manager()
        .lock()
        .map_err(|_| "Haider projection pipe manager is unavailable.".to_string())?
        .tails
        .remove(&session_id)
    {
        tail.stop.store(true, Ordering::Release);
    }
    let result = haider_projection_stop_session_watch(&session_id);
    if result.is_ok() {
        haider_projection_prefold_detach(&detached);
    }
    result
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
            let _ = haider_projection_with_database(|connection| {
                let _ = connection.execute(
                    "DELETE FROM session_projection_rows WHERE session_id = ?1",
                    [&self.session_id],
                );
                let _ = connection.execute(
                    "DELETE FROM session_pipe_cursors WHERE session_id = ?1",
                    [&self.session_id],
                );
                let _ = connection.execute(
                    "DELETE FROM session_journal_cursors WHERE session_id = ?1",
                    [&self.session_id],
                );
                let _ =
                    connection.execute("DELETE FROM sessions WHERE id = ?1", [&self.session_id]);
                Ok(())
            });
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

    fn haider_projection_test_row(
        session_id: &str,
        seq: i64,
        ordinal: i64,
    ) -> SessionProjectionRow {
        haider_projection_row(
            session_id,
            seq,
            ordinal,
            String::new(),
            "message",
            if seq % 2 == 0 { "assistant" } else { "user" },
            format!("row-{seq}-{ordinal}"),
            json!({"seq":seq,"ordinal":ordinal}),
            1_700_000_000_000 + seq * 10 + ordinal,
        )
    }

    fn haider_projection_test_frame(
        session_id: &str,
        start_total: i64,
        rows: Vec<SessionProjectionRow>,
    ) -> HaiderProjectionFrame {
        HaiderProjectionFrame {
            session_id: session_id.to_string(),
            from_seq: rows.first().map(|row| row.seq),
            appended: rows.len(),
            total_rows: start_total + i64::try_from(rows.len()).unwrap(),
            live_tail: None,
            tail_changed: false,
            covered_through_seq: None,
            head_seq: None,
            pipe_max_seq: None,
            caught_up: true,
            sync_changed: false,
            start_total: (!rows.is_empty()).then_some(start_total),
            rows,
            rows_overflow: false,
        }
    }

    #[test]
    fn haider_projection_emits_immediately_after_idle_then_batches_a_burst() {
        let now = Instant::now();
        assert!(haider_projection_should_emit_immediately(None, now));
        assert!(!haider_projection_should_emit_immediately(
            Some(now),
            now + HAIDER_PROJECTION_IMMEDIATE_IDLE - Duration::from_millis(1),
        ));
        assert!(haider_projection_should_emit_immediately(
            Some(now),
            now + HAIDER_PROJECTION_IMMEDIATE_IDLE + Duration::from_millis(1),
        ));
        assert_eq!(HAIDER_PROJECTION_FRAME_TIME, Duration::from_millis(50));
    }

    #[test]
    fn haider_projection_merged_event_rows_keep_order_and_start_total() {
        let session_id = "projection-coalesce";
        let mut first = haider_projection_test_frame(
            session_id,
            7,
            vec![haider_projection_test_row(session_id, 8, 0)],
        );
        let next = haider_projection_test_frame(
            session_id,
            8,
            vec![haider_projection_test_row(session_id, 9, 0)],
        );
        haider_projection_merge_frame(&mut first, next);
        assert_eq!(first.appended, 2);
        assert_eq!(first.start_total, Some(7));
        assert_eq!(
            first.rows.iter().map(|row| row.seq).collect::<Vec<_>>(),
            vec![8, 9]
        );
    }

    #[test]
    fn haider_projection_merged_event_omits_rows_above_limit() {
        let session_id = "projection-overflow";
        let mut first = haider_projection_test_frame(
            session_id,
            0,
            (0..HAIDER_PROJECTION_EVENT_ROWS_LIMIT)
                .map(|seq| haider_projection_test_row(session_id, seq as i64, 0))
                .collect(),
        );
        let next = haider_projection_test_frame(
            session_id,
            HAIDER_PROJECTION_EVENT_ROWS_LIMIT as i64,
            vec![haider_projection_test_row(
                session_id,
                HAIDER_PROJECTION_EVENT_ROWS_LIMIT as i64,
                0,
            )],
        );
        haider_projection_merge_frame(&mut first, next);
        assert!(first.rows_overflow);
        assert!(first.rows.is_empty());
        assert_eq!(first.start_total, None);
    }

    #[test]
    fn haider_projection_pipe_dir_short_circuits_route_probe() {
        let status = json!({"features":["pipe_native_v2"], "pipe_dir":"/tmp/haider-pipes"});
        let route = haider_projection_pipe_route_from_status(&status, "provider-1").unwrap();
        assert_eq!(
            route.path,
            PathBuf::from("/tmp/haider-pipes/provider-1.pipe")
        );
        assert!(haider_projection_pipe_route_from_status(&json!({}), "provider-1").is_none());
    }

    #[test]
    fn haider_projection_pipe_route_cache_reuses_and_invalidates_missing_path() {
        let root = std::env::temp_dir().join(format!(
            "haider-route-cache-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).unwrap();
        let first_path = root.join("first.jsonl");
        let second_path = root.join("second.jsonl");
        fs::write(&first_path, b"first").unwrap();
        fs::write(&second_path, b"second").unwrap();
        let routes = StdMutex::new(HashMap::new());
        let calls = std::cell::Cell::new(0usize);
        let mut resolver = |_: &str| {
            calls.set(calls.get() + 1);
            Ok(HaiderProjectionPipeRoute {
                path: if calls.get() == 1 {
                    first_path.clone()
                } else {
                    second_path.clone()
                },
                head_seq: Some(calls.get() as i64),
            })
        };

        let first =
            haider_projection_resolve_pipe_route_cached_with(&routes, "provider", &mut resolver)
                .unwrap();
        let cached =
            haider_projection_resolve_pipe_route_cached_with(&routes, "provider", &mut resolver)
                .unwrap();
        assert_eq!(first.path, cached.path);
        assert_eq!(calls.get(), 1);

        fs::remove_file(&first_path).unwrap();
        let refreshed =
            haider_projection_resolve_pipe_route_cached_with(&routes, "provider", &mut resolver)
                .unwrap();
        assert_eq!(refreshed.path, second_path);
        assert_eq!(calls.get(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn haider_projection_prefold_hands_ingest_to_foreground_without_state_loss() {
        let test_session = haider_projection_test_session();
        let root = std::env::temp_dir().join(format!(
            "haider-prefold-handoff-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("session.jsonl");
        let rows = (1..=257)
            .map(|seq| {
                let value = if seq == 1 {
                    json!({"seq":seq,"ordinal":0,"usage":{"input_tokens":10}})
                } else {
                    json!({
                        "seq":seq,
                        "ordinal":0,
                        "role":if seq % 2 == 0 { "assistant" } else { "user" },
                        "text":format!("row-{seq}")
                    })
                };
                format!("{value}\n")
            })
            .collect::<String>();
        let contents = format!(
            "{}{}",
            haider_projection_test_pipe_header(&test_session.provider_session_id, 1),
            rows
        );
        fs::write(&path, &contents).unwrap();
        let route = HaiderProjectionPipeRoute {
            path: path.clone(),
            head_seq: Some(257),
        };
        let checks = Arc::new(AtomicUsize::new(0));
        let foreground_started = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(std::sync::Barrier::new(2));
        let resume = Arc::new(std::sync::Barrier::new(2));

        let prefold_session_id = test_session.session_id.clone();
        let prefold_provider_id = test_session.provider_session_id.clone();
        let prefold_route = route.clone();
        let prefold_checks = checks.clone();
        let prefold_started = foreground_started.clone();
        let prefold_paused = paused.clone();
        let prefold_resume = resume.clone();
        let prefold = thread::spawn(move || {
            let cancelled = || {
                if prefold_checks.fetch_add(1, Ordering::SeqCst) == 259 {
                    prefold_paused.wait();
                    prefold_resume.wait();
                }
                prefold_started.load(Ordering::SeqCst)
            };
            haider_projection_ingest_pipe_cancellable(
                &prefold_session_id,
                &prefold_provider_id,
                &prefold_route,
                &cancelled,
            )
        });
        paused.wait();

        let foreground_session_id = test_session.session_id.clone();
        let foreground_provider_id = test_session.provider_session_id.clone();
        let foreground_route = route.clone();
        let foreground_started_thread = foreground_started.clone();
        let foreground = thread::spawn(move || {
            let _foreground = haider_projection_foreground(&foreground_session_id);
            foreground_started_thread.store(true, Ordering::SeqCst);
            haider_projection_ingest_pipe(
                &foreground_session_id,
                &foreground_provider_id,
                &foreground_route,
            )
        });
        while !foreground_started.load(Ordering::SeqCst) {
            thread::yield_now();
        }
        resume.wait();

        assert!(prefold
            .join()
            .unwrap()
            .unwrap_err()
            .contains("prefold was cancelled"));
        assert_eq!(foreground.join().unwrap().unwrap().appended, 1);
        assert_eq!(
            haider_projection_database_stats(&test_session.session_id)
                .unwrap()
                .0,
            257
        );
        let states = haider_projection_states().lock().unwrap();
        let state = states.get(&test_session.session_id).unwrap();
        assert_eq!(state.total_rows, 257);
        assert!(state.metadata.contains_key("usage"));
        drop(states);
        let cursor = haider_projection_load_pipe_cursor(&test_session.session_id)
            .unwrap()
            .unwrap();
        assert_eq!(cursor.byte_offset, contents.len() as i64);
        assert_eq!((cursor.last_seq, cursor.last_ordinal), (257, 0));

        let stale = HaiderProjectionPipeCursor {
            session_id: test_session.session_id.clone(),
            byte_offset: cursor.byte_offset - 1,
            last_seq: 256,
            generation: 1,
            ..HaiderProjectionPipeCursor::default()
        };
        haider_projection_persist_batch(&test_session.session_id, &[], Some(&stale), None).unwrap();
        assert_eq!(
            haider_projection_load_pipe_cursor(&test_session.session_id)
                .unwrap()
                .unwrap(),
            cursor
        );

        let next_path = root.join("session-next.jsonl");
        let next_contents = format!(
            "{}{}\n",
            haider_projection_test_pipe_header(&test_session.provider_session_id, 2),
            json!({"seq":3,"ordinal":0,"role":"assistant","text":"three"})
        );
        fs::write(&next_path, &next_contents).unwrap();
        haider_projection_ingest_pipe(
            &test_session.session_id,
            &test_session.provider_session_id,
            &HaiderProjectionPipeRoute {
                path: next_path,
                head_seq: Some(3),
            },
        )
        .unwrap();
        let generation_two = haider_projection_load_pipe_cursor(&test_session.session_id)
            .unwrap()
            .unwrap();
        let truncated_path = root.join("session-truncated.jsonl");
        fs::write(
            &truncated_path,
            haider_projection_test_pipe_header(&test_session.provider_session_id, 2),
        )
        .unwrap();
        assert!(haider_projection_ingest_pipe(
            &test_session.session_id,
            &test_session.provider_session_id,
            &HaiderProjectionPipeRoute {
                path: truncated_path,
                head_seq: Some(3),
            },
        )
        .unwrap_err()
        .contains("route was stale"));
        assert!(haider_projection_ingest_pipe(
            &test_session.session_id,
            &test_session.provider_session_id,
            &route,
        )
        .unwrap_err()
        .contains("generation was stale"));
        assert_eq!(
            haider_projection_load_pipe_cursor(&test_session.session_id)
                .unwrap()
                .unwrap(),
            generation_two
        );
        assert_eq!(
            haider_projection_database_stats(&test_session.session_id).unwrap(),
            (1, 3)
        );
        let old_generation = HaiderProjectionPipeCursor {
            session_id: test_session.session_id.clone(),
            byte_offset: i64::MAX,
            last_seq: i64::MAX,
            generation: 1,
            ..HaiderProjectionPipeCursor::default()
        };
        haider_projection_persist_batch(&test_session.session_id, &[], Some(&old_generation), None)
            .unwrap();
        assert_eq!(
            haider_projection_load_pipe_cursor(&test_session.session_id)
                .unwrap()
                .unwrap(),
            generation_two
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn haider_projection_head_advance_refreshes_route_and_rebuilds_watcher() {
        let test_session = haider_projection_test_session();
        let root = std::env::temp_dir().join(format!(
            "haider-route-rotation-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).unwrap();
        let old_path = root.join("session-old.jsonl");
        let new_path = root.join("session-new.jsonl");
        let first_line = format!(
            "{}\n",
            json!({"seq":1,"ordinal":0,"role":"user","text":"one"})
        );
        fs::write(
            &old_path,
            format!(
                "{}{}",
                haider_projection_test_pipe_header(&test_session.provider_session_id, 1),
                first_line
            ),
        )
        .unwrap();
        fs::write(
            &new_path,
            format!(
                "{}{}{}\n",
                haider_projection_test_pipe_header(&test_session.provider_session_id, 1),
                first_line,
                json!({"seq":2,"ordinal":0,"role":"assistant","text":"two"})
            ),
        )
        .unwrap();
        let old_route = HaiderProjectionPipeRoute {
            path: old_path.clone(),
            head_seq: Some(1),
        };
        haider_projection_ingest_pipe(
            &test_session.session_id,
            &test_session.provider_session_id,
            &old_route,
        )
        .unwrap();
        let mut old_pipe = fs::OpenOptions::new().append(true).open(&old_path).unwrap();
        old_pipe.write_all(b"{\"seq\":2").unwrap();
        old_pipe.sync_all().unwrap();
        haider_bridge_note_head_seq(&test_session.provider_session_id, 2);
        let stale_route = HaiderProjectionPipeRoute {
            path: old_path.clone(),
            head_seq: Some(2),
        };

        let routes = StdMutex::new(HashMap::from([(
            test_session.provider_session_id.clone(),
            stale_route.clone(),
        )]));
        let resolves = std::cell::Cell::new(0usize);
        let ingest_lock = haider_projection_ingest_lock(&test_session.session_id).unwrap();
        let _ingest_guard = ingest_lock.lock().unwrap();
        let (frame, refreshed_route) = haider_projection_ingest_pipe_route_retry_owned_with(
            &test_session.session_id,
            &test_session.provider_session_id,
            stale_route,
            &|| false,
            || {
                haider_projection_refresh_pipe_route_with(
                    &routes,
                    &test_session.provider_session_id,
                    |_| {
                        resolves.set(resolves.get() + 1);
                        Ok(HaiderProjectionPipeRoute {
                            path: new_path.clone(),
                            head_seq: Some(2),
                        })
                    },
                )
            },
        )
        .unwrap();
        drop(_ingest_guard);
        assert_eq!(resolves.get(), 1);
        assert_eq!(refreshed_route.path, new_path);
        assert_eq!(frame.appended, 1);
        assert_eq!(
            routes
                .lock()
                .unwrap()
                .get(&test_session.provider_session_id)
                .unwrap()
                .path,
            new_path
        );

        let (initial_watcher, initial_receiver) =
            haider_projection_pipe_watcher(&old_path).expect("old pipe watcher");
        let mut watched_path = old_path;
        let mut watcher = Some(initial_watcher);
        let mut receiver = Some(initial_receiver);
        assert!(haider_projection_rebuild_pipe_watcher(
            &mut watched_path,
            &mut watcher,
            &mut receiver,
            &refreshed_route,
        ));
        assert_eq!(watched_path, new_path);
        let mut file = fs::OpenOptions::new().append(true).open(&new_path).unwrap();
        file.write_all(b"{\"coverage\":2,\"generation\":1}\n")
            .unwrap();
        file.sync_all().unwrap();
        assert!(haider_projection_wait_for_pipe_event(
            receiver.as_ref().unwrap(),
            &new_path,
            Duration::from_secs(2),
        ));

        drop(watcher);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn haider_projection_cached_database_reopens_only_invalid_connection() {
        let path = std::env::temp_dir().join(format!(
            "haider-db-cache-{}.sqlite",
            uuid::Uuid::new_v4().simple()
        ));
        let cache = StdMutex::new(None);
        let opens = AtomicUsize::new(0);
        let open = || {
            let connection = rusqlite::Connection::open(&path)
                .map_err(|error| format!("test open failed: {error}"))?;
            connection
                .execute("CREATE TABLE IF NOT EXISTS values_test(value INTEGER)", [])
                .map_err(|error| format!("test schema failed: {error}"))?;
            Ok(connection)
        };
        for value in [1_i64, 2] {
            haider_projection_with_database_cache(
                &cache,
                &opens,
                open,
                |_| Ok(true),
                |connection| {
                    connection
                        .execute("INSERT INTO values_test(value) VALUES (?1)", [value])
                        .map(|_| ())
                        .map_err(|error| format!("test persist failed: {error}"))
                },
            )
            .unwrap();
        }
        assert_eq!(opens.load(Ordering::Relaxed), 1);

        let invalid = std::cell::Cell::new(true);
        haider_projection_with_database_cache(
            &cache,
            &opens,
            open,
            |_| Ok(!invalid.replace(false)),
            |connection| {
                connection
                    .execute("INSERT INTO values_test(value) VALUES (3)", [])
                    .map(|_| ())
                    .map_err(|error| format!("test fallback persist failed: {error}"))
            },
        )
        .unwrap();
        assert_eq!(opens.load(Ordering::Relaxed), 2);
        let count = haider_projection_with_database_cache(
            &cache,
            &opens,
            open,
            |_| Ok(true),
            |connection| {
                connection
                    .query_row("SELECT COUNT(*) FROM values_test", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .map_err(|error| format!("test count failed: {error}"))
            },
        )
        .unwrap();
        assert_eq!(count, 3);
        drop(cache);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn haider_projection_cached_database_never_reexecutes_committed_operation() {
        let path = std::env::temp_dir().join(format!(
            "haider-db-no-replay-{}.sqlite",
            uuid::Uuid::new_v4().simple()
        ));
        let cache = StdMutex::new(None);
        let opens = AtomicUsize::new(0);
        let executions = std::cell::Cell::new(0usize);
        let open = || {
            let connection = rusqlite::Connection::open(&path)
                .map_err(|error| format!("test open failed: {error}"))?;
            connection
                .execute("CREATE TABLE IF NOT EXISTS values_test(value INTEGER)", [])
                .map_err(|error| format!("test schema failed: {error}"))?;
            Ok(connection)
        };

        let error = haider_projection_with_database_cache(
            &cache,
            &opens,
            open,
            |_| Ok(true),
            |connection| {
                executions.set(executions.get() + 1);
                connection
                    .execute("INSERT INTO values_test(value) VALUES (1)", [])
                    .map_err(|error| format!("test persist failed: {error}"))?;
                Err::<(), _>("forced post-commit state error".to_string())
            },
        )
        .unwrap_err();

        assert_eq!(error, "forced post-commit state error");
        assert_eq!(executions.get(), 1);
        assert_eq!(opens.load(Ordering::Relaxed), 1);
        let count = haider_projection_with_database_cache(
            &cache,
            &opens,
            open,
            |_| Ok(true),
            |connection| {
                connection
                    .query_row("SELECT COUNT(*) FROM values_test", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .map_err(|error| format!("test count failed: {error}"))
            },
        )
        .unwrap();
        assert_eq!(count, 1);
        assert_eq!(opens.load(Ordering::Relaxed), 1);
        drop(cache);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn haider_projection_incremental_total_matches_database_count() {
        let test_session = haider_projection_test_session();
        haider_projection_initialize_state(&test_session.session_id).unwrap();
        let database_opens = haider_projection_database_open_count().load(Ordering::Relaxed);
        let first = vec![
            haider_projection_test_row(&test_session.session_id, 1, 0),
            haider_projection_test_row(&test_session.session_id, 2, 0),
            haider_projection_test_row(&test_session.session_id, 2, 0),
        ];
        let second = vec![
            haider_projection_test_row(&test_session.session_id, 2, 0),
            haider_projection_test_row(&test_session.session_id, 3, 0),
            haider_projection_test_row(&test_session.session_id, 3, 1),
        ];
        for (rows, expected) in [(&first[..], 2_i64), (&second[..], 4_i64)] {
            let total = haider_projection_persist_rows(rows).unwrap().total_rows;
            let ground_truth = haider_projection_with_database(|connection| {
                connection
                    .query_row(
                        "SELECT COUNT(*) FROM session_projection_rows WHERE session_id = ?1",
                        [&test_session.session_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(|error| format!("test projection count failed: {error}"))
            })
            .unwrap();
            assert_eq!(total, expected);
            assert_eq!(total, ground_truth);
        }
        assert_eq!(
            haider_projection_database_open_count().load(Ordering::Relaxed),
            database_opens
        );
        let cursor = HaiderProjectionPipeCursor {
            session_id: test_session.session_id.clone(),
            generation: 1,
            ..HaiderProjectionPipeCursor::default()
        };
        let total =
            haider_projection_persist_batch(&test_session.session_id, &[], Some(&cursor), None)
                .unwrap()
                .total_rows;
        assert_eq!(total, 4);
    }

    #[test]
    fn haider_projection_keyset_window_matches_offset_golden() {
        let test_session = haider_projection_test_session();
        let rows = [
            (1, 0),
            (1, 1),
            (2, 0),
            (4, 0),
            (4, 2),
            (5, 0),
            (8, 0),
            (8, 1),
        ]
        .into_iter()
        .map(|(seq, ordinal)| haider_projection_test_row(&test_session.session_id, seq, ordinal))
        .collect::<Vec<_>>();
        let total_rows = haider_projection_persist_rows(&rows).unwrap().total_rows;
        for (start_index, count) in [(0, 3), (2, 4), (5, 10), (7, 1), (8, 2), (3, 0)] {
            let (offset_rows, keyset_rows) = haider_projection_with_database(|connection| {
                let offset_rows = connection
                    .prepare_cached(
                        "SELECT session_id, seq, ordinal, branch_id, kind, role, text, meta, at_ms
                             FROM session_projection_rows WHERE session_id = ?1
                             ORDER BY seq, ordinal LIMIT ?2 OFFSET ?3",
                    )
                    .and_then(|mut statement| {
                        statement
                            .query_map(
                                rusqlite::params![test_session.session_id, count, start_index],
                                haider_projection_decode_row,
                            )?
                            .collect::<Result<Vec<_>, _>>()
                    })
                    .map_err(|error| format!("test offset window failed: {error}"))?;
                let keyset_rows = haider_projection_window_rows_keyset(
                    connection,
                    &test_session.session_id,
                    start_index,
                    count,
                    total_rows,
                )?;
                Ok((offset_rows, keyset_rows))
            })
            .unwrap();
            assert_eq!(
                serde_json::to_vec(&keyset_rows).unwrap(),
                serde_json::to_vec(&offset_rows).unwrap()
            );
        }
    }

    #[test]
    fn haider_projection_prefold_queue_dedupes_skips_active_and_drains() {
        let manager = StdMutex::new(HaiderProjectionPrefoldManager::default());
        assert!(haider_projection_prefold_enqueue_with(
            &manager,
            ["a", "a", "b", "c"].into_iter().map(str::to_string),
        ));
        assert!(!haider_projection_prefold_enqueue_with(
            &manager,
            ["c", "d"].into_iter().map(str::to_string),
        ));
        {
            let mut manager = manager.lock().unwrap();
            manager.attached.insert("local-b".to_string());
            manager.active.insert("c".to_string());
        }
        let mut folded = Vec::new();
        haider_projection_prefold_drain_with(
            &manager,
            |provider| Some(format!("local-{provider}")),
            |_, provider| folded.push(provider.to_string()),
        );
        assert_eq!(folded, vec!["a", "d"]);
        {
            let manager = manager.lock().unwrap();
            assert!(manager.queue.is_empty());
            assert!(manager.queued.is_empty());
            assert!(manager.in_flight.is_none());
            assert!(!manager.worker_running);
        }

        {
            let mut manager = manager.lock().unwrap();
            manager.in_flight = Some(("e".to_string(), "local-e".to_string()));
            manager.worker_running = true;
        }
        assert!(!haider_projection_prefold_enqueue_with(
            &manager,
            ["e", "e"].into_iter().map(str::to_string),
        ));
        manager.lock().unwrap().in_flight = None;
        haider_projection_prefold_drain_with(
            &manager,
            |provider| Some(format!("local-{provider}")),
            |_, provider| folded.push(provider.to_string()),
        );
        assert_eq!(folded, vec!["a", "d", "e"]);
        assert!(manager.lock().unwrap().queue.is_empty());
    }

    #[test]
    fn haider_projection_unknown_head_is_caught_up() {
        assert!(haider_projection_caught_up(None, Some(0), Some(0)));
    }

    #[test]
    fn haider_projection_final_unterminated_eof_is_required_for_pipe_head() {
        assert!(!haider_projection_caught_up(Some(9), None, None));
        assert!(haider_projection_caught_up(Some(9), None, Some(9)));
        assert!(!haider_projection_caught_up(Some(9), None, Some(8)));
    }

    #[test]
    fn haider_projection_journal_coverage_can_independently_prove_head() {
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
    fn haider_projection_keeps_roles_it_has_never_seen() {
        /* The pipe's role set already grew beyond user/assistant/tool to
        include error; assuming a closed set is how a future role vanishes.
        An unknown role must render its text WITHOUT being attributed to
        the model. */
        let mut state = HaiderProjectionFoldState::default();
        let row = haider_projection_export_row(
            &mut state,
            "local-session",
            &json!({"role": "annotation", "text": "moved to branch b", "seq": 12}),
        )
        .expect("an unknown role must still produce a row");
        assert_eq!(row.kind, "message");
        assert_eq!(row.role, "annotation");
        assert_eq!(row.text, "moved to branch b");

        // The known roles keep their exact homes, error included.
        let mut state = HaiderProjectionFoldState::default();
        let error_row = haider_projection_export_row(
            &mut state,
            "local-session",
            &json!({"role": "error", "presentation": "run failed", "seq": 13}),
        )
        .expect("error is a real role");
        assert_eq!(error_row.kind, "error");
    }

    #[test]
    fn haider_projection_keeps_item_kinds_it_has_never_seen() {
        /* The daemon's item vocabulary is open — `extension` items already
        flow and were never in our list. An unrecognised kind must land
        SOMEWHERE, because dropping it means a future item type vanishes
        from the transcript with nothing to notice. */
        let (kind, role) = haider_projection_item_class(&json!({"item": "quantum_widget"}));
        assert_eq!((kind, role), ("tool", "tool"));

        // A payload carrying no kind at all is genuinely not an item.
        let (empty_kind, _) = haider_projection_item_class(&json!({"text": "hi"}));
        assert!(empty_kind.is_empty());

        // Known kinds keep their exact homes.
        assert_eq!(
            haider_projection_item_class(&json!({"item": "reasoning"})).0,
            "thinking"
        );
        assert_eq!(
            haider_projection_item_class(&json!({"item": "agent_message"})).0,
            "message"
        );
        assert_eq!(
            haider_projection_item_class(&json!({"item": "extension"})).0,
            "tool"
        );

        let mut state = HaiderProjectionFoldState::default();
        let folded = haider_projection_fold_value_locked(
            &mut state,
            "local-session",
            &json!({
                "seq": 12,
                "render": {"ui": true, "durable": true, "prompt": "verbatim"},
                "payload": {"type":"item", "event":"completed", "item_id":"future-1",
                    "item":{"item":"quantum_widget", "summary":"future item landed"}}
            }),
        );
        assert_eq!(folded.rows.len(), 1);
        assert_eq!(folded.rows[0].kind, "tool");
        assert_eq!(folded.rows[0].text, "quantum_widget · future item landed");
    }

    #[test]
    fn haider_projection_skips_watch_compat_records_once_items_stream() {
        // Watch/run streams can carry a bare export-shaped compatibility row
        // after the richer enveloped item. The item stream is canonical for
        // those sources, so their later compat record lands nothing. Native
        // pipes use haider_projection_fold_pipe_value_locked instead.
        let user_record =
            json!({"role":"user", "text":"what?", "at_ms":1700000000004_i64, "seq":4, "ordinal":0});
        let completed = json!({
            "seq": 295,
            "committed_at_ms": 1700000000295_i64,
            "payload": {"type":"item", "event":"completed", "item_id":"item-9",
                "item":{"item":"agent_message", "text":"Possibly the answer."}}
        });
        let empty_marker = json!({"role":"assistant", "text":"", "at_ms":1700000000162_i64, "seq":296, "ordinal":0});
        let duplicate = json!({"role":"assistant", "text":"Possibly the answer.",
            "at_ms":1700000000296_i64, "seq":297, "ordinal":0});
        let mut state = HaiderProjectionFoldState::default();
        let mut rows = Vec::new();
        for value in [&user_record, &completed, &empty_marker, &duplicate] {
            rows.extend(
                haider_projection_fold_value_locked(&mut state, "local-session", value).rows,
            );
        }
        // Pre-item role records fold (cold export / pre-item pipes); once the
        // item stream is live, compat records land nothing.
        assert_eq!(rows.len(), 2);
        assert_eq!((rows[0].seq, rows[0].role.as_str()), (4, "user"));
        assert_eq!(
            (rows[1].seq, rows[1].text.as_str()),
            (295, "Possibly the answer.")
        );
        assert!(state.saw_item_stream);
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
    fn haider_projection_reasoning_lifecycle_seals_one_accumulated_thinking_row() {
        let values = [
            json!({
                "seq": 50,
                "render": {"ui": true, "durable": true, "prompt": "verbatim"},
                "payload": {"type":"item", "event":"started", "item_id":"reasoning-1",
                    "item":{"item":"reasoning", "summary":""}}
            }),
            json!({
                "seq": 51,
                "render": {"ui": true, "durable": true, "prompt": "verbatim"},
                "payload": {"type":"item", "event":"delta", "item_id":"reasoning-1",
                    "delta":{"delta":"reasoning", "text":"The user is asking "}}
            }),
            json!({
                "seq": 52,
                "render": {"ui": true, "durable": true, "prompt": "verbatim"},
                "payload": {"type":"item", "event":"delta", "item_id":"reasoning-1",
                    "delta":{"delta":"reasoning", "text":"me to inspect the journal."}}
            }),
            json!({
                "seq": 53,
                "render": {"ui": true, "durable": true, "prompt": "verbatim"},
                "payload": {"type":"item", "event":"completed", "item_id":"reasoning-1",
                    "item":{"item":"reasoning", "summary":""}}
            }),
        ];
        let mut state = HaiderProjectionFoldState::default();
        let rows = values
            .iter()
            .flat_map(|value| haider_projection_fold_value_locked(&mut state, "local", value).rows)
            .collect::<Vec<_>>();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].kind, "thinking");
        assert_eq!(
            rows[0].text,
            "The user is asking me to inspect the journal."
        );
        assert!(state.tail.is_none());
    }

    #[test]
    fn haider_projection_honors_daemon_ui_redaction() {
        let mut state = HaiderProjectionFoldState::default();
        let hidden = json!({
            "seq": 60,
            "render": {"ui": false, "durable": true, "prompt": "verbatim"},
            "payload": {"type":"item", "event":"completed", "item_id":"hidden-1",
                "item":{"item":"agent_message", "text":"must stay hidden"}}
        });
        let folded = haider_projection_fold_value_locked(&mut state, "local", &hidden);
        assert!(folded.rows.is_empty());
        assert!(state.tail.is_none());
        assert!(!state.saw_item_stream);
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
        assert!(object_state.rows.is_empty());
        assert_eq!(state.metadata["run_state"]["state"]["tool"], "cargo");
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
    fn haider_projection_run_failure_is_visible() {
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
    }

    /* The 57% case, measured on the live daemon: of 93 reasoning rows across 46
    files, 53 carry NO text at all. A reader that skips empty-text rows loses
    every one of them, and the daemon looks broken while being correct. */
    #[test]
    fn v4_reasoning_survives_a_row_whose_text_is_empty() {
        let mut state = HaiderProjectionFoldState::default();
        let step = haider_projection_fold_pipe_value_locked(
            &mut state,
            "session-v4",
            &json!({
                "role": "assistant",
                "text": "",
                "reasoning": "weighing two options",
                "at_ms": 10,
                "seq": 15,
                "ordinal": 0,
                "compat": true
            }),
        );

        assert_eq!(
            step.rows.len(),
            1,
            "the thinking must survive an empty text"
        );
        assert_eq!(step.rows[0].kind, "thinking");
        assert_eq!(step.rows[0].text, "weighing two options");
        assert_eq!(step.rows[0].seq, 15);
    }

    /* The 100% case. EVERY reasoning row the daemon writes is compat: true, and
    compat is documented as "safe to drop" — true for an item-canonical
    client, false for a pipe-primary one, which is what we are. */
    #[test]
    fn a_compat_row_is_never_dropped_on_the_pipe_path() {
        let mut state = HaiderProjectionFoldState::default();
        let step = haider_projection_fold_pipe_value_locked(
            &mut state,
            "session-v4",
            &json!({
                "role": "assistant",
                "text": "the answer",
                "at_ms": 20,
                "seq": 211,
                "ordinal": 0,
                "compat": true
            }),
        );

        assert_eq!(step.rows.len(), 1);
        assert_eq!(step.rows[0].text, "the answer");
    }

    /* Reasoning rides the row where thinking HAPPENED, before the tool calls —
    not the answer row. Rendering it attached to the answer would find no
    reasoning there at all, and would also put the fold below the reply it
    produced instead of above it. */
    #[test]
    fn v4_reasoning_keeps_its_own_sequence_position_ahead_of_the_answer() {
        let mut state = HaiderProjectionFoldState::default();
        let thinking = haider_projection_fold_pipe_value_locked(
            &mut state,
            "session-v4",
            &json!({"role":"assistant","text":"","reasoning":"first, plan",
                    "at_ms":10,"seq":15,"ordinal":0,"compat":true}),
        );
        let answer = haider_projection_fold_pipe_value_locked(
            &mut state,
            "session-v4",
            &json!({"role":"assistant","text":"the answer",
                    "at_ms":30,"seq":211,"ordinal":0,"compat":true}),
        );

        assert_eq!(thinking.rows[0].kind, "thinking");
        assert_eq!(answer.rows[0].kind, "message");
        assert!(
            thinking.rows[0].seq < answer.rows[0].seq,
            "the thinking must sit ahead of the reply it produced"
        );
    }

    /* Discriminated on `kind`. This row has no role at all, and the role path
    treats a roleless row as not-a-row — so it has to be caught first. */
    #[test]
    fn a_compaction_boundary_is_recognised_without_any_role() {
        let mut state = HaiderProjectionFoldState::default();
        let value = json!({
            "kind": "compaction_boundary",
            "at_ms": 40,
            "seq": 300,
            "run_id": "run-77",
            "branch_id": "branch-a",
            "ordinal": 0
        });
        let step = haider_projection_fold_pipe_value_locked(&mut state, "session-v4", &value);

        assert_eq!(step.rows.len(), 1);
        assert_eq!(step.rows[0].kind, "compaction_boundary");
        // The daemon owns this vocabulary; it rides in meta rather than being
        // lifted into named fields we would then have to keep in step.
        assert_eq!(step.rows[0].meta, value);
        assert_eq!(step.rows[0].branch_id, "");
        assert_eq!(
            haider_projection_pipe_row_identity(&step.rows[0].meta).unwrap(),
            Some((300, 0))
        );
    }

    #[test]
    fn v4_reasoning_and_text_have_distinct_ordered_projection_keys() {
        let mut state = HaiderProjectionFoldState::default();
        let step = haider_projection_fold_pipe_value_locked(
            &mut state,
            "session-v4",
            &json!({
                "role":"assistant",
                "text":"the answer",
                "reasoning":"thinking first",
                "at_ms":50,
                "seq":25,
                "ordinal":3,
                "compat":true
            }),
        );

        assert_eq!(step.rows.len(), 2);
        assert_eq!(step.rows[0].kind, "thinking");
        assert_eq!(step.rows[1].kind, "message");
        assert_eq!(step.rows[0].seq, step.rows[1].seq);
        assert!(step.rows[0].ordinal < step.rows[1].ordinal);
    }

    #[test]
    fn v4_reasoning_and_text_both_survive_projection_persistence() {
        let test_session = haider_projection_test_session();
        let root = std::env::temp_dir().join(format!(
            "haider-reasoning-persist-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("session.pipe");
        fs::write(
            &path,
            format!(
                "{}\n{}\n",
                json!({
                    "pipe":"haider.session.jsonl",
                    "version":4,
                    "session_id":test_session.provider_session_id,
                    "generation":1
                }),
                json!({
                    "role":"assistant",
                    "text":"the answer",
                    "reasoning":"thinking first",
                    "at_ms":50,
                    "seq":25,
                    "ordinal":3,
                    "compat":true
                })
            ),
        )
        .unwrap();

        let frame = haider_projection_ingest_pipe(
            &test_session.session_id,
            &test_session.provider_session_id,
            &HaiderProjectionPipeRoute {
                path: path.clone(),
                head_seq: Some(25),
            },
        )
        .unwrap();
        assert_eq!(frame.appended, 2);
        assert_eq!(
            frame
                .rows
                .iter()
                .map(|row| (row.kind.as_str(), row.ordinal, row.text.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("thinking", 6, "thinking first"),
                ("message", 7, "the answer")
            ]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn haider_projection_parses_v2_v3_v4_headers_and_rejects_future_version() {
        // v4 moved from "future" to "current" when 0.0.939 shipped. The bump
        // rebuilds every sidecar at once, so a gate that refuses the live
        // version takes every session's transcript offline together — which is
        // exactly what it did. Keep the rejection for genuinely unknown
        // versions; it is the only thing standing between us and folding a
        // format nobody has read.
        for (version, generation) in [(2, 7), (3, 8), (4, 9)] {
            let header = haider_projection_parse_pipe_header(
                &json!({
                    "pipe":"haider.session.jsonl",
                    "version":version,
                    "session_id":"session-test",
                    "generation":generation
                }),
                "session-test",
            )
            .unwrap();
            assert_eq!(header.generation, generation);
        }
        assert!(haider_projection_parse_pipe_header(
            &json!({
                "pipe":"haider.session.jsonl",
                "version":5,
                "session_id":"session-test",
                "generation":9
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
            segment_index: 0,
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
    fn haider_projection_pipe_growth_survives_non_pipe_item_state() {
        let test_session = haider_projection_test_session();
        let root = std::env::temp_dir().join(format!(
            "haider-pipe-compat-growth-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("session.jsonl");
        fs::write(
            &path,
            format!(
                "{}{}\n",
                haider_projection_test_pipe_header(&test_session.provider_session_id, 1),
                json!({
                    "seq":4,
                    "ordinal":0,
                    "role":"user",
                    "text":"first turn"
                })
            ),
        )
        .unwrap();
        let route = HaiderProjectionPipeRoute {
            path: path.clone(),
            head_seq: None,
        };
        let first = haider_projection_ingest_pipe(
            &test_session.session_id,
            &test_session.provider_session_id,
            &route,
        )
        .unwrap();
        assert_eq!(first.appended, 1);

        let item = json!({
            "seq":10,
            "committed_at_ms":1700000000010_i64,
            "payload": {"type":"item", "event":"completed", "item_id":"item-10",
                "item":{"item":"agent_message", "text":"richer first answer"}}
        });
        assert_eq!(
            haider_projection_ingest_value(None, &test_session.session_id, &item)
                .unwrap()
                .appended,
            1
        );
        assert!(haider_projection_states()
            .lock()
            .unwrap()
            .get(&test_session.session_id)
            .is_some_and(|state| state.saw_item_stream));

        let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(
            file,
            "{}",
            json!({"seq":11,"ordinal":0,"role":"user","text":"second turn"})
        )
        .unwrap();
        writeln!(
            file,
            "{}",
            json!({"seq":12,"ordinal":0,"role":"assistant","text":"second answer"})
        )
        .unwrap();
        file.sync_all().unwrap();

        let growth = haider_projection_ingest_pipe(
            &test_session.session_id,
            &test_session.provider_session_id,
            &route,
        )
        .unwrap();
        assert_eq!(growth.appended, 2);
        assert_eq!(
            growth
                .rows
                .iter()
                .map(|row| (row.seq, row.role.as_str(), row.text.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (11, "user", "second turn"),
                (12, "assistant", "second answer")
            ]
        );
        let cursor = haider_projection_load_pipe_cursor(&test_session.session_id)
            .unwrap()
            .unwrap();
        assert_eq!(cursor.last_seq, 12);
        assert_eq!(
            cursor.byte_offset,
            fs::metadata(&path).unwrap().len() as i64
        );

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
    fn haider_projection_rejects_hostile_segment_successors() {
        let root = std::env::temp_dir().join(format!(
            "haider-successor-safety-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).unwrap();

        for successor in ["../escape", "/etc/passwd", "a/b", ""] {
            assert!(
                haider_projection_validate_pipe_successor(successor).is_err(),
                "{successor:?} unexpectedly passed basename validation"
            );
            let error = haider_projection_open_pipe_successor(&root, successor).unwrap_err();
            assert!(
                error.contains("plain basename"),
                "{successor:?} failed for the wrong reason: {error}"
            );
        }
        // The brief says any `..` and any path separator; cover Windows-style
        // input even when this test runs on Unix.
        for successor in ["a\\b", "a..b"] {
            assert!(haider_projection_validate_pipe_successor(successor).is_err());
        }

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn haider_projection_segment_successor_refuses_symlinks() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "haider-successor-symlink-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).unwrap();
        let outside = root.with_extension("outside");
        fs::write(&outside, b"outside").unwrap();
        symlink(&outside, root.join("next.pipe")).unwrap();

        assert!(haider_projection_open_pipe_successor(&root, "next.pipe").is_err());

        fs::remove_dir_all(root).unwrap();
        fs::remove_file(outside).unwrap();
    }

    /* Prove at-head on an unterminated segment, THEN receive a seal whose
       successor is not on disk. A daemon that seals before its successor is
       durable makes this a race, not an exotic case.

       What this pins is that the failure is LOUD: the ingest errors instead of
       inheriting the earlier "caught up" and reporting a frozen transcript as
       complete. Measured, not assumed — the error arm is the one that fires
       ("Unable to open Haider pipe segment successor"). It does NOT reach the
       stale-proof clearing at the top of the read loop, which sits behind this
       error path; removing that line leaves every test green. It is kept as
       defence for paths that return Ok, not because this test covers it. */
    #[test]
    fn a_seal_whose_successor_cannot_be_opened_never_reports_at_head() {
        let test_session = haider_projection_test_session();
        let root = std::env::temp_dir().join(format!(
            "haider-segment-missing-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("session.pipe");
        let header = json!({
            "pipe":"haider.session.jsonl",
            "version":4,
            "session_id":test_session.provider_session_id,
            "generation":1
        });
        let row = json!({
            "role":"assistant","text":"answer","at_ms":1,"seq":9,"ordinal":0,"compat":true
        });
        fs::write(&path, format!("{header}\n{row}\n")).unwrap();
        let route = HaiderProjectionPipeRoute {
            path: path.clone(),
            head_seq: Some(9),
        };

        // First ingest reaches EOF of an unterminated segment: at-head is real.
        let first = haider_projection_ingest_pipe(
            &test_session.session_id,
            &test_session.provider_session_id,
            &route,
        )
        .unwrap();
        assert!(first.caught_up, "an unterminated EOF does prove head");

        // Now the segment seals, naming a successor that is not on disk yet.
        let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(
            format!(
                "{}\n",
                json!({
                    "segment_end":"sealed",
                    "coverage":9,
                    "generation":1,
                    "successor":"session.g1.s1.pipe"
                })
            )
            .as_bytes(),
        )
        .unwrap();
        file.sync_all().unwrap();

        match haider_projection_ingest_pipe(
            &test_session.session_id,
            &test_session.provider_session_id,
            &route,
        ) {
            // Loud failure is acceptable — it is visible and recoverable.
            Err(_) => {}
            Ok(sealed) => assert!(
                !sealed.caught_up,
                "a seal whose successor is missing must not inherit the earlier at-head proof"
            ),
        }

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn haider_projection_sealed_segment_coverage_equal_to_head_is_not_at_head() {
        let test_session = haider_projection_test_session();
        let root = std::env::temp_dir().join(format!(
            "haider-segment-head-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("session.pipe");
        let successor_name = "session.g1.s1.pipe";
        let successor_path = root.join(successor_name);
        let root_header = json!({
            "pipe":"haider.session.jsonl",
            "version":4,
            "session_id":test_session.provider_session_id,
            "generation":1
        });
        let successor_header = json!({
            "pipe":"haider.session.jsonl",
            "version":4,
            "session_id":test_session.provider_session_id,
            "generation":1,
            "segment":1,
            "starts_after":9
        });
        fs::write(
            &path,
            format!(
                "{root_header}\n{}\n",
                json!({
                    "segment_end":"sealed",
                    "coverage":9,
                    "generation":1,
                    "successor":successor_name
                })
            ),
        )
        .unwrap();
        // A torn tail is deliberately not EOF of the final segment. It lets
        // this regression isolate the sealed-root EOF trap even though the
        // successor already exists and is followed securely.
        fs::write(
            &successor_path,
            format!("{successor_header}\n{{\"coverage\":9"),
        )
        .unwrap();
        let route = HaiderProjectionPipeRoute {
            path: path.clone(),
            head_seq: Some(9),
        };

        let sealed = haider_projection_ingest_pipe(
            &test_session.session_id,
            &test_session.provider_session_id,
            &route,
        )
        .unwrap();
        assert_eq!(sealed.covered_through_seq, Some(9));
        assert!(!sealed.caught_up);
        let cursor = haider_projection_load_pipe_cursor(&test_session.session_id)
            .unwrap()
            .unwrap();
        assert_eq!(cursor.segment_name, successor_name);
        assert_eq!(cursor.segment_index, 1);

        let mut successor = fs::OpenOptions::new()
            .append(true)
            .open(&successor_path)
            .unwrap();
        successor.write_all(b",\"generation\":1}\n").unwrap();
        successor.sync_all().unwrap();
        let final_segment = haider_projection_ingest_pipe(
            &test_session.session_id,
            &test_session.provider_session_id,
            &route,
        )
        .unwrap();
        assert!(final_segment.caught_up);

        fs::remove_dir_all(root).unwrap();
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

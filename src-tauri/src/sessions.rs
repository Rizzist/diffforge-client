const SESSIONS_HOME_ENV: &str = "RUST_DIFFFORGE_SESSIONS_HOME";
const SESSIONS_CHANGED_EVENT: &str = "sessions-changed";

#[derive(Clone, Debug)]
struct SessionRow {
    id: String,
    slug: String,
    dir: String,
    kind: String,
    provider_session_id: String,
    created_at_ms: i64,
    // ADE derives this locally for rail search and the pre-auto-title fallback;
    // it is deliberately not presented as harness truth.
    first_user_message: String,
    harness: Value,
    pinned: bool,
    // The column named title_locked owns the locked title itself. Keeping the
    // override outside harness_json lets every bridge write remain verbatim;
    // the frontend still receives title_locked as a boolean.
    title_override: Option<String>,
}

fn sessions_harness_object(row: &SessionRow) -> Option<&serde_json::Map<String, Value>> {
    row.harness.as_object()
}

fn sessions_harness_value<'a>(row: &'a SessionRow, key: &str) -> Option<&'a Value> {
    sessions_harness_object(row).and_then(|object| object.get(key))
}

fn sessions_harness_text(row: &SessionRow, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        let value = sessions_harness_value(row, key)?;
        match value {
            Value::String(text) => Some(text.clone()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        }
    })
}

fn sessions_run_state_text(run_state: Option<&Value>) -> String {
    let Some(run_state) = run_state else {
        return String::new();
    };
    if let Some(text) = run_state.as_str() {
        return text.to_string();
    }
    let Some(object) = run_state.as_object() else {
        return String::new();
    };
    let state = ["status", "state", "kind", "type", "name"]
        .iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .unwrap_or_default();
    match (state, object.get("tool").and_then(Value::as_str)) {
        ("", _) => String::new(),
        (state, Some(tool)) if !tool.trim().is_empty() => format!("{state}: {tool}"),
        (state, _) => state.to_string(),
    }
}

// This is the one intentional harness derivation: the UI groups the daemon's
// detailed run_state vocabulary into four coarse rail buckets.
fn sessions_status_from_run_state(run_state: Option<&Value>) -> &'static str {
    let normalized = sessions_run_state_text(run_state)
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
    } else if normalized.is_empty()
        || [
            "idle",
            "ready",
            "paused",
            "done",
            "complete",
            "completed",
            "finished",
            "stopped",
            "interrupted",
            "cancelled",
            "canceled",
            "closed",
            "offline",
        ]
        .iter()
        .any(|needle| normalized.contains(needle))
    {
        "idle"
    } else {
        // A state this list has never seen is the daemon naming something it is
        // DOING — it does not invent vocabulary for sitting still. Bucketing it
        // as idle would tell the user a working session is quiet, which is the
        // failure that hides work. Over-reporting activity is visible and
        // dismissable; under-reporting it is not. Degrade toward being seen.
        "running"
    }
}

impl SessionRow {
    fn title(&self) -> String {
        self.title_override
            .clone()
            .or_else(|| sessions_harness_text(self, &["title"]))
            .filter(|title| !title.trim().is_empty())
            .unwrap_or_else(|| "New session".to_string())
    }

    fn latest_at_ms(&self) -> i64 {
        ["latest_at_ms", "updated_at_ms"]
            .iter()
            .find_map(|key| sessions_harness_value(self, key).and_then(Value::as_i64))
            .unwrap_or(self.created_at_ms)
    }

    fn needs_input(&self) -> Value {
        sessions_harness_value(self, "needs_input")
            .cloned()
            .unwrap_or(Value::Null)
    }

    fn serialized_value(&self) -> Value {
        let mut object = sessions_harness_object(self).cloned().unwrap_or_default();
        let run_state = object.get("run_state");
        let state_raw = if run_state.is_some() {
            sessions_run_state_text(run_state)
        } else {
            sessions_harness_text(self, &["state_raw"]).unwrap_or_default()
        };
        let status = sessions_status_from_run_state(run_state).to_string();
        let model = sessions_harness_text(self, &["model", "last_model"])
            .or_else(|| {
                ["model", "last_model"]
                    .iter()
                    .find_map(|key| sessions_harness_value(self, key))
                    .and_then(Value::as_object)
                    .and_then(|model| {
                        ["model", "id", "name"]
                            .iter()
                            .find_map(|key| model.get(*key).and_then(Value::as_str))
                    })
                    .map(str::to_string)
            })
            .unwrap_or_default();
        let provider = sessions_harness_text(self, &["provider", "last_provider"])
            .or_else(|| {
                sessions_harness_value(self, "metadata")
                    .and_then(Value::as_object)
                    .and_then(|metadata| metadata.get("provider"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .or_else(|| {
                ["model", "last_model"]
                    .iter()
                    .find_map(|key| sessions_harness_value(self, key))
                    .and_then(Value::as_object)
                    .and_then(|model| model.get("provider"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
        let speed = object.get("speed").cloned().unwrap_or_else(|| {
            if object.get("fast").and_then(Value::as_bool) == Some(true) {
                Value::String("fast".to_string())
            } else {
                Value::Null
            }
        });
        let waiting_why = object.get("waiting_why").and_then(Value::as_object);
        let waiting_kind = object
            .get("waiting_kind")
            .cloned()
            .or_else(|| waiting_why.and_then(|why| why.get("kind")).cloned())
            .unwrap_or(Value::Null);
        let waiting_menu_id = object
            .get("waiting_menu_id")
            .cloned()
            .or_else(|| {
                waiting_why
                    .and_then(|why| why.get("pending_menu_id"))
                    .cloned()
            })
            .unwrap_or(Value::Null);

        // Stable frontend aliases are projected at read time. The source
        // object remains the base, so additive daemon fields pass through.
        object.insert("title".to_string(), Value::String(self.title()));
        object.insert(
            "provider".to_string(),
            provider.map(Value::String).unwrap_or(Value::Null),
        );
        object.insert("model".to_string(), Value::String(model));
        object.insert("status".to_string(), Value::String(status));
        object.insert("state_raw".to_string(), Value::String(state_raw));
        object.insert("latest_at_ms".to_string(), json!(self.latest_at_ms()));
        object.entry("effort".to_string()).or_insert(Value::Null);
        object.insert("speed".to_string(), speed);
        for key in [
            "seen_at_ms",
            "last_activity_ms",
            "run_id",
            "worker_generation",
        ] {
            object.entry(key.to_string()).or_insert(Value::Null);
        }
        object.insert("waiting_kind".to_string(), waiting_kind);
        object.insert("waiting_menu_id".to_string(), waiting_menu_id);
        object
            .entry("needs_input".to_string())
            .or_insert(Value::Null);

        // ADE-owned fields win name collisions with the opaque harness object.
        object.insert("id".to_string(), Value::String(self.id.clone()));
        object.insert("slug".to_string(), Value::String(self.slug.clone()));
        object.insert("dir".to_string(), Value::String(self.dir.clone()));
        object.insert("kind".to_string(), Value::String(self.kind.clone()));
        object.insert(
            "provider_session_id".to_string(),
            Value::String(self.provider_session_id.clone()),
        );
        object.insert("created_at_ms".to_string(), json!(self.created_at_ms));
        object.insert(
            "first_user_message".to_string(),
            Value::String(self.first_user_message.clone()),
        );
        object.insert("pinned".to_string(), Value::Bool(self.pinned));
        object.insert(
            "title_locked".to_string(),
            Value::Bool(self.title_override.is_some()),
        );
        Value::Object(object)
    }
}

impl Serialize for SessionRow {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.serialized_value().serialize(serializer)
    }
}

#[derive(Debug, Deserialize)]
struct SessionCreateArgs {
    title: Option<String>,
    pinned_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SessionUpdateArgs {
    id: String,
    title: Option<String>,
    provider_session_id: Option<String>,
    first_user_message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SessionDeleteArgs {
    id: String,
    delete_dir: bool,
}

fn sessions_write_lock() -> &'static StdMutex<()> {
    static LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| StdMutex::new(()))
}

fn sessions_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

fn sessions_new_id(now_ms: i64) -> String {
    let random = uuid::Uuid::new_v4().simple().to_string();
    format!("{now_ms:013}-{}", &random[..8])
}

fn sessions_slug(value: &str) -> String {
    let mut slug = String::with_capacity(24);
    let mut pending_dash = false;

    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            if pending_dash && !slug.is_empty() && slug.len() < 24 {
                slug.push('-');
            }
            pending_dash = false;
            if slug.len() >= 24 {
                break;
            }
            slug.push(character.to_ascii_lowercase());
        } else if !slug.is_empty() {
            pending_dash = true;
        }
    }

    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "chat".to_string()
    } else {
        slug
    }
}

fn sessions_dedupe_slug(base: &str, mut candidate_exists: impl FnMut(&str) -> bool) -> String {
    if !candidate_exists(base) {
        return base.to_string();
    }

    for suffix in 2u64.. {
        let candidate = format!("{base}-{suffix}");
        if !candidate_exists(&candidate) {
            return candidate;
        }
    }
    unreachable!("the session slug suffix space is unbounded")
}

fn sessions_unique_slug(parent: &Path, base: &str, ignore: Option<&Path>) -> String {
    sessions_dedupe_slug(base, |candidate| {
        let path = parent.join(candidate);
        path.exists() && ignore.is_none_or(|ignored| path != ignored)
    })
}

// Howard Hinnant's civil-from-days algorithm. The input is a signed count of
// days from the Unix epoch and the output is deliberately filesystem-safe.
fn sessions_format_civil_date(days_since_unix_epoch: i64) -> String {
    let shifted = days_since_unix_epoch + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

fn sessions_local_date_for_unix_seconds(unix_seconds: i64) -> Option<String> {
    #[cfg(unix)]
    unsafe {
        let timestamp = unix_seconds as libc::time_t;
        let mut local: libc::tm = std::mem::zeroed();
        if libc::localtime_r(&timestamp, &mut local).is_null() {
            return None;
        }
        return Some(format!(
            "{:04}-{:02}-{:02}",
            local.tm_year + 1900,
            local.tm_mon + 1,
            local.tm_mday
        ));
    }

    #[cfg(windows)]
    unsafe {
        let timestamp = unix_seconds as libc::time_t;
        let mut local: libc::tm = std::mem::zeroed();
        if libc::localtime_s(&mut local, &timestamp) != 0 {
            return None;
        }
        return Some(format!(
            "{:04}-{:02}-{:02}",
            local.tm_year + 1900,
            local.tm_mon + 1,
            local.tm_mday
        ));
    }

    #[allow(unreachable_code)]
    None
}

fn sessions_current_local_date() -> String {
    let unix_seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().min(i64::MAX as u64) as i64)
        .unwrap_or(0);
    sessions_local_date_for_unix_seconds(unix_seconds)
        .unwrap_or_else(|| sessions_format_civil_date(unix_seconds.div_euclid(86_400)))
}

fn sessions_home_path() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os(SESSIONS_HOME_ENV)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        return Ok(path);
    }
    user_home_dir()
        .map(|home| home.join("Documents").join("DiffForge"))
        .ok_or_else(|| "Unable to locate the user home for DiffForge sessions.".to_string())
}

fn sessions_database_path() -> Result<PathBuf, String> {
    let root = cloud_mcp_native_data_root()
        .ok_or_else(|| "Unable to locate the DiffForge device data directory.".to_string())?;
    fs::create_dir_all(&root).map_err(|error| {
        format!("Unable to create the DiffForge device data directory: {error}")
    })?;
    Ok(root.join("sessions.sqlite"))
}

fn sessions_table_columns(connection: &rusqlite::Connection) -> Result<HashSet<String>, String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(sessions)")
        .map_err(|error| format!("Unable to inspect sessions SQLite schema: {error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Unable to query sessions SQLite schema: {error}"))?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(|error| format!("Unable to decode sessions SQLite schema: {error}"))?;
    Ok(columns)
}

fn sessions_initialize_database(connection: &mut rusqlite::Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL,
                dir TEXT NOT NULL,
                kind TEXT NOT NULL CHECK (kind IN ('generated', 'pinned')),
                provider_session_id TEXT NOT NULL DEFAULT '',
                created_at_ms INTEGER NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0,
                title_locked TEXT,
                harness_json TEXT NOT NULL DEFAULT '{}',
                first_user_message TEXT NOT NULL DEFAULT ''
             );",
        )
        .map_err(|error| format!("Unable to initialize sessions SQLite store: {error}"))?;

    let columns = sessions_table_columns(connection)?;
    let retired_columns = [
        "title",
        "provider",
        "model",
        "status",
        "state_raw",
        "latest_at_ms",
        "effort",
        "speed_fast",
        "seen_at_ms",
        "last_activity_ms",
        "waiting_kind",
        "waiting_menu_id",
        "run_id",
        "worker_generation",
        "needs_input_json",
    ];
    if columns.contains("harness_json")
        && retired_columns
            .iter()
            .all(|column| !columns.contains(*column))
    {
        return Ok(());
    }

    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin sessions SQLite migration: {error}"))?;
    let mut columns = sessions_table_columns(&transaction)?;
    if !columns.contains("harness_json") {
        transaction
            .execute(
                "ALTER TABLE sessions ADD COLUMN harness_json TEXT NOT NULL DEFAULT '{}'",
                [],
            )
            .map_err(|error| format!("Unable to add sessions harness payload: {error}"))?;
        columns.insert("harness_json".to_string());
    }

    // Older additive schemas may predate some of the mirror columns. Add
    // neutral defaults only long enough to make the one-time reconstruction
    // uniform; the replacement table below removes the entire mirror.
    let legacy_additions = [
        ("model", "TEXT NOT NULL DEFAULT ''"),
        ("pinned", "INTEGER NOT NULL DEFAULT 0"),
        ("title_locked", "INTEGER NOT NULL DEFAULT 0"),
        ("state_raw", "TEXT NOT NULL DEFAULT ''"),
        ("effort", "TEXT"),
        ("speed_fast", "INTEGER"),
        ("seen_at_ms", "INTEGER"),
        ("last_activity_ms", "INTEGER"),
        ("waiting_kind", "TEXT"),
        ("waiting_menu_id", "TEXT"),
        ("needs_input_json", "TEXT"),
        ("run_id", "TEXT"),
        ("worker_generation", "INTEGER"),
    ];
    for (column, definition) in legacy_additions {
        if !columns.contains(column) {
            transaction
                .execute(
                    &format!("ALTER TABLE sessions ADD COLUMN {column} {definition}"),
                    [],
                )
                .map_err(|error| format!("Unable to migrate sessions SQLite schema: {error}"))?;
            columns.insert(column.to_string());
        }
    }

    let reconstructed = {
        let mut statement = transaction
            .prepare(
                "SELECT id, title, provider, model, status, state_raw,
                        latest_at_ms, effort, speed_fast, seen_at_ms,
                        last_activity_ms, waiting_kind, waiting_menu_id,
                        run_id, worker_generation, needs_input_json
                 FROM sessions",
            )
            .map_err(|error| format!("Unable to prepare sessions payload migration: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                let state_raw = row.get::<_, String>(5)?;
                let status = row.get::<_, String>(4)?;
                let needs_input = row
                    .get::<_, Option<String>>(15)?
                    .and_then(|payload| serde_json::from_str::<Value>(&payload).ok())
                    .unwrap_or(Value::Null);
                let mut harness = serde_json::Map::new();
                harness.insert("title".to_string(), json!(row.get::<_, String>(1)?));
                harness.insert("provider".to_string(), json!(row.get::<_, String>(2)?));
                harness.insert("model".to_string(), json!(row.get::<_, String>(3)?));
                harness.insert(
                    "run_state".to_string(),
                    json!(if state_raw.trim().is_empty() {
                        status
                    } else {
                        state_raw
                    }),
                );
                harness.insert("latest_at_ms".to_string(), json!(row.get::<_, i64>(6)?));
                harness.insert(
                    "effort".to_string(),
                    json!(row.get::<_, Option<String>>(7)?),
                );
                harness.insert(
                    "fast".to_string(),
                    row.get::<_, Option<i64>>(8)?
                        .map(|fast| Value::Bool(fast != 0))
                        .unwrap_or(Value::Null),
                );
                for (key, index) in [
                    ("seen_at_ms", 9),
                    ("last_activity_ms", 10),
                    ("worker_generation", 14),
                ] {
                    harness.insert(key.to_string(), json!(row.get::<_, Option<i64>>(index)?));
                }
                for (key, index) in [
                    ("waiting_kind", 11),
                    ("waiting_menu_id", 12),
                    ("run_id", 13),
                ] {
                    harness.insert(key.to_string(), json!(row.get::<_, Option<String>>(index)?));
                }
                harness.insert("needs_input".to_string(), needs_input);
                Ok((row.get::<_, String>(0)?, Value::Object(harness)))
            })
            .map_err(|error| format!("Unable to read sessions payload migration: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Unable to decode sessions payload migration: {error}"))?;
        rows
    };
    for (id, harness) in reconstructed {
        let harness_json = serde_json::to_string(&harness)
            .map_err(|error| format!("Unable to encode migrated harness payload: {error}"))?;
        transaction
            .execute(
                "UPDATE sessions SET harness_json = ?2 WHERE id = ?1",
                rusqlite::params![id, harness_json],
            )
            .map_err(|error| format!("Unable to store migrated harness payload: {error}"))?;
    }

    transaction
        .execute_batch(
            "DROP INDEX IF EXISTS idx_sessions_latest_at_ms;
             DROP TABLE IF EXISTS sessions_harness_migration;
             CREATE TABLE sessions_harness_migration (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL,
                dir TEXT NOT NULL,
                kind TEXT NOT NULL CHECK (kind IN ('generated', 'pinned')),
                provider_session_id TEXT NOT NULL DEFAULT '',
                created_at_ms INTEGER NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0,
                title_locked TEXT,
                harness_json TEXT NOT NULL DEFAULT '{}',
                first_user_message TEXT NOT NULL DEFAULT ''
             );
             INSERT INTO sessions_harness_migration (
                id, slug, dir, kind, provider_session_id, created_at_ms,
                pinned, title_locked, harness_json, first_user_message
             )
             SELECT id, slug, dir, kind, provider_session_id, created_at_ms,
                    pinned,
                    CASE WHEN title_locked != 0 THEN title ELSE NULL END,
                    harness_json, first_user_message
             FROM sessions;
             DROP TABLE sessions;
             ALTER TABLE sessions_harness_migration RENAME TO sessions;",
        )
        .map_err(|error| format!("Unable to replace sessions mirror schema: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit sessions SQLite migration: {error}"))?;
    Ok(())
}

fn sessions_open_database() -> Result<rusqlite::Connection, String> {
    let path = sessions_database_path()?;
    let mut connection = rusqlite::Connection::open(&path)
        .map_err(|error| format!("Unable to open sessions SQLite store: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Unable to configure sessions SQLite timeout: {error}"))?;
    sessions_initialize_database(&mut connection)?;
    Ok(connection)
}

fn sessions_sqlite_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id: row.get(0)?,
        slug: row.get(1)?,
        dir: row.get(2)?,
        kind: row.get(3)?,
        provider_session_id: row.get(4)?,
        created_at_ms: row.get(5)?,
        pinned: row.get(6)?,
        title_override: row.get(7)?,
        harness: row
            .get::<_, Option<String>>(8)?
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_else(|| json!({})),
        first_user_message: row.get(9)?,
    })
}

const SESSIONS_SELECT_COLUMNS: &str =
    "id, slug, dir, kind, provider_session_id, created_at_ms, pinned, title_locked, harness_json, first_user_message";

fn sessions_row_by_id(connection: &rusqlite::Connection, id: &str) -> Result<SessionRow, String> {
    let query = format!("SELECT {SESSIONS_SELECT_COLUMNS} FROM sessions WHERE id = ?1");
    match connection.query_row(&query, [id], sessions_sqlite_row) {
        Ok(row) => Ok(row),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err("Session was not found.".to_string()),
        Err(error) => Err(format!("Unable to read session: {error}")),
    }
}

fn sessions_list_blocking() -> Result<Vec<SessionRow>, String> {
    let connection = sessions_open_database()?;
    let query = format!("SELECT {SESSIONS_SELECT_COLUMNS} FROM sessions");
    let mut statement = connection
        .prepare(&query)
        .map_err(|error| format!("Unable to prepare sessions list: {error}"))?;
    let mut rows = statement
        .query_map([], sessions_sqlite_row)
        .map_err(|error| format!("Unable to list sessions: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to decode session row: {error}"))?;
    rows.sort_by(|left, right| {
        right
            .latest_at_ms()
            .cmp(&left.latest_at_ms())
            .then_with(|| right.id.cmp(&left.id))
    });
    Ok(rows)
}

fn session_create_blocking(args: SessionCreateArgs) -> Result<SessionRow, String> {
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    let title = args.title.unwrap_or_else(|| "New session".to_string());
    let base_slug = sessions_slug(&title);
    let (kind, slug, directory) = if let Some(pinned_dir) = args.pinned_dir {
        let path = PathBuf::from(pinned_dir)
            .canonicalize()
            .map_err(|error| format!("Pinned session directory must exist: {error}"))?;
        if !path.is_dir() {
            return Err("Pinned session path must be a directory.".to_string());
        }
        ("pinned", base_slug, path)
    } else {
        let home = sessions_home_path()?;
        let date_directory = home.join(sessions_current_local_date());
        fs::create_dir_all(&date_directory)
            .map_err(|error| format!("Unable to create session date directory: {error}"))?;
        let slug = sessions_unique_slug(&date_directory, &base_slug, None);
        let directory = date_directory.join(&slug);
        fs::create_dir_all(directory.join("work"))
            .and_then(|_| fs::create_dir_all(directory.join("outputs")))
            .map_err(|error| format!("Unable to create session directory: {error}"))?;
        let directory = directory.canonicalize().unwrap_or(directory);
        ("generated", slug, directory)
    };

    let now_ms = sessions_now_ms();
    let row = SessionRow {
        id: sessions_new_id(now_ms),
        slug,
        dir: directory.to_string_lossy().to_string(),
        kind: kind.to_string(),
        provider_session_id: String::new(),
        created_at_ms: now_ms,
        first_user_message: String::new(),
        // A local draft has no daemon summary yet. Reconcile replaces this
        // bootstrap object wholesale as soon as the provider session binds.
        harness: json!({
            "title": title,
            "provider": "haider",
            "run_state": "idle",
            "updated_at_ms": now_ms,
        }),
        pinned: false,
        title_override: None,
    };
    let harness_json = serde_json::to_string(&row.harness)
        .map_err(|error| format!("Unable to encode new session harness payload: {error}"))?;
    let connection = sessions_open_database()?;
    connection
        .execute(
            "INSERT INTO sessions (
                id, slug, dir, kind, provider_session_id, created_at_ms,
                pinned, title_locked, harness_json, first_user_message
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                row.id,
                row.slug,
                row.dir,
                row.kind,
                row.provider_session_id,
                row.created_at_ms,
                row.pinned,
                row.title_override,
                harness_json,
                row.first_user_message,
            ],
        )
        .map_err(|error| format!("Unable to store session: {error}"))?;
    Ok(row)
}

fn session_update_blocking(args: SessionUpdateArgs) -> Result<SessionRow, String> {
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    let connection = sessions_open_database()?;
    let mut row = sessions_row_by_id(&connection, args.id.trim())?;

    if row.title_override.is_none() {
        if let Some(title) = args.title {
            if !row.harness.is_object() {
                row.harness = json!({});
            }
            if let Some(object) = row.harness.as_object_mut() {
                object.insert("title".to_string(), Value::String(title));
            }
        }
    }
    if let Some(provider_session_id) = args.provider_session_id {
        row.provider_session_id = provider_session_id;
    }
    if let Some(first_user_message) = args.first_user_message {
        let should_reslug = row.kind == "generated"
            && row.title_override.is_none()
            && row.first_user_message.trim().is_empty()
            && !first_user_message.trim().is_empty();
        if should_reslug {
            let old_directory = PathBuf::from(&row.dir);
            if let Some(parent) = old_directory.parent() {
                let base_slug = sessions_slug(&first_user_message);
                let slug = sessions_unique_slug(parent, &base_slug, Some(&old_directory));
                let new_directory = parent.join(&slug);
                if new_directory == old_directory {
                    row.slug = slug;
                } else if fs::rename(&old_directory, &new_directory).is_ok() {
                    row.slug = slug;
                    row.dir = new_directory.to_string_lossy().to_string();
                }
            }
        }
        row.first_user_message = first_user_message;
    }
    let harness_json = serde_json::to_string(&row.harness)
        .map_err(|error| format!("Unable to encode session harness payload: {error}"))?;

    connection
        .execute(
            "UPDATE sessions SET
                slug = ?2, dir = ?3, kind = ?4, provider_session_id = ?5,
                first_user_message = ?6, harness_json = ?7
             WHERE id = ?1",
            rusqlite::params![
                row.id,
                row.slug,
                row.dir,
                row.kind,
                row.provider_session_id,
                row.first_user_message,
                harness_json,
            ],
        )
        .map_err(|error| format!("Unable to update session: {error}"))?;
    Ok(row)
}

fn session_rename_blocking(session_id: String, title: String) -> Result<SessionRow, String> {
    if title.trim().is_empty() {
        return Err("Session title must not be empty.".to_string());
    }
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    let connection = sessions_open_database()?;
    let row = sessions_row_by_id(&connection, session_id.trim())?;
    connection
        .execute(
            "UPDATE sessions SET title_locked = ?2 WHERE id = ?1",
            rusqlite::params![row.id, title],
        )
        .map_err(|error| format!("Unable to rename session: {error}"))?;
    sessions_row_by_id(&connection, &row.id)
}

fn session_set_pinned_blocking(session_id: String, pinned: bool) -> Result<SessionRow, String> {
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    let connection = sessions_open_database()?;
    let row = sessions_row_by_id(&connection, session_id.trim())?;
    connection
        .execute(
            "UPDATE sessions SET pinned = ?2 WHERE id = ?1",
            rusqlite::params![row.id, pinned],
        )
        .map_err(|error| format!("Unable to update session pin: {error}"))?;
    sessions_row_by_id(&connection, &row.id)
}

fn session_delete_blocking(args: SessionDeleteArgs) -> Result<(), String> {
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    let connection = sessions_open_database()?;
    let row = sessions_row_by_id(&connection, args.id.trim())?;

    if args.delete_dir && row.kind == "generated" {
        let canonical_home = sessions_home_path()
            .ok()
            .and_then(|path| path.canonicalize().ok());
        let canonical_directory = PathBuf::from(&row.dir).canonicalize().ok();
        if let (Some(home), Some(directory)) = (canonical_home, canonical_directory) {
            if directory != home && directory.starts_with(&home) {
                if let Err(error) = fs::remove_dir_all(&directory) {
                    eprintln!("Unable to remove generated session directory: {error}");
                }
            }
        }
    }

    connection
        .execute("DELETE FROM sessions WHERE id = ?1", [&row.id])
        .map_err(|error| format!("Unable to delete session: {error}"))?;
    Ok(())
}

fn sessions_emit_changed(app: &AppHandle) {
    let _ = app.emit_to("main", SESSIONS_CHANGED_EVENT, ());
}

#[tauri::command]
async fn sessions_list() -> Result<Vec<SessionRow>, String> {
    tauri::async_runtime::spawn_blocking(sessions_list_blocking)
        .await
        .map_err(|error| format!("Sessions list worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn session_create(app: AppHandle, args: SessionCreateArgs) -> Result<SessionRow, String> {
    let row = tauri::async_runtime::spawn_blocking(move || session_create_blocking(args))
        .await
        .map_err(|error| format!("Session create worker failed: {error}"))??;
    sessions_emit_changed(&app);
    Ok(row)
}

#[tauri::command(rename_all = "snake_case")]
async fn session_update(app: AppHandle, args: SessionUpdateArgs) -> Result<SessionRow, String> {
    let row = tauri::async_runtime::spawn_blocking(move || session_update_blocking(args))
        .await
        .map_err(|error| format!("Session update worker failed: {error}"))??;
    sessions_emit_changed(&app);
    Ok(row)
}

#[tauri::command(rename_all = "snake_case")]
async fn session_rename(
    app: AppHandle,
    session_id: String,
    title: String,
) -> Result<SessionRow, String> {
    let row =
        tauri::async_runtime::spawn_blocking(move || session_rename_blocking(session_id, title))
            .await
            .map_err(|error| format!("Session rename worker failed: {error}"))??;
    sessions_emit_changed(&app);
    Ok(row)
}

#[tauri::command(rename_all = "snake_case")]
async fn session_set_pinned(
    app: AppHandle,
    session_id: String,
    pinned: bool,
) -> Result<SessionRow, String> {
    let row = tauri::async_runtime::spawn_blocking(move || {
        session_set_pinned_blocking(session_id, pinned)
    })
    .await
    .map_err(|error| format!("Session pin worker failed: {error}"))??;
    sessions_emit_changed(&app);
    Ok(row)
}

#[tauri::command(rename_all = "snake_case")]
async fn session_delete(app: AppHandle, args: SessionDeleteArgs) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || session_delete_blocking(args))
        .await
        .map_err(|error| format!("Session delete worker failed: {error}"))??;
    sessions_emit_changed(&app);
    Ok(())
}

#[tauri::command]
async fn sessions_home_dir() -> String {
    sessions_home_path()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod sessions_tests {
    use super::*;

    static ENV_LOCK: StdMutex<()> = StdMutex::new(());

    struct SessionsEnvGuard {
        key: &'static str,
        previous: Option<std::ffi::OsString>,
    }

    impl Drop for SessionsEnvGuard {
        fn drop(&mut self) {
            match self.previous.as_ref() {
                Some(value) => env::set_var(self.key, value),
                None => env::remove_var(self.key),
            }
        }
    }

    fn set_sessions_env(key: &'static str, path: &Path) -> SessionsEnvGuard {
        let previous = env::var_os(key);
        env::set_var(key, path);
        SessionsEnvGuard { key, previous }
    }

    fn set_sessions_home(path: &Path) -> SessionsEnvGuard {
        set_sessions_env(SESSIONS_HOME_ENV, path)
    }

    fn sessions_test_directory(label: &str) -> PathBuf {
        env::temp_dir().join(format!(
            "diffforge-sessions-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ))
    }

    fn sessions_test_row(id: &str, dir: &Path, kind: &str) -> SessionRow {
        SessionRow {
            id: id.to_string(),
            slug: "original-title".to_string(),
            dir: dir.to_string_lossy().to_string(),
            kind: kind.to_string(),
            provider_session_id: format!("provider-{id}"),
            created_at_ms: 10,
            first_user_message: String::new(),
            harness: json!({
                "session_id": format!("provider-{id}"),
                "title": "Original title",
                "run_state": "idle",
                "updated_at_ms": 10,
            }),
            pinned: false,
            title_override: None,
        }
    }

    fn sessions_test_insert_row(connection: &rusqlite::Connection, row: &SessionRow) {
        let harness_json = serde_json::to_string(&row.harness).unwrap();
        connection
            .execute(
                "INSERT INTO sessions (
                    id, slug, dir, kind, provider_session_id, created_at_ms,
                    pinned, title_locked, harness_json, first_user_message
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![
                    row.id,
                    row.slug,
                    row.dir,
                    row.kind,
                    row.provider_session_id,
                    row.created_at_ms,
                    row.pinned,
                    row.title_override,
                    harness_json,
                    row.first_user_message,
                ],
            )
            .unwrap();
    }

    #[test]
    fn sessions_serialized_provider_reads_metadata_provider() {
        let mut row = sessions_test_row("nested-provider", Path::new(""), "pinned");
        row.harness = json!({
            "session_id": "provider-nested-provider",
            "metadata": {"provider": "openai-oauth"},
        });

        assert_eq!(row.serialized_value()["provider"], "openai-oauth");
    }

    #[test]
    fn sessions_serialized_provider_prefers_top_level_provider() {
        let mut row = sessions_test_row("preferred-provider", Path::new(""), "pinned");
        row.harness = json!({
            "session_id": "provider-preferred-provider",
            "provider": "anthropic-oauth",
            "metadata": {"provider": "openai-oauth"},
        });

        assert_eq!(row.serialized_value()["provider"], "anthropic-oauth");
    }

    #[test]
    fn sessions_serialized_provider_is_null_when_unknown() {
        let mut row = sessions_test_row("unknown-provider", Path::new(""), "pinned");
        row.harness = json!({"session_id": "provider-unknown-provider"});

        let provider = &row.serialized_value()["provider"];
        assert_eq!(provider, &Value::Null);
        assert_ne!(provider, "haider");
    }

    #[test]
    fn session_slug_derivation_is_bounded_and_stable() {
        assert_eq!(
            sessions_slug("  Hello, WORLD! -- Rust  "),
            "hello-world-rust"
        );
        assert_eq!(sessions_slug("alpha___beta"), "alpha-beta");
        assert_eq!(sessions_slug("你好"), "chat");
        assert_eq!(
            sessions_slug("This title is deliberately much too long"),
            "this-title-is-deliberate"
        );
    }

    #[test]
    fn session_slug_dedupe_uses_incrementing_suffixes() {
        let occupied = ["chat", "chat-2", "chat-3"]
            .into_iter()
            .collect::<HashSet<_>>();
        assert_eq!(
            sessions_dedupe_slug("chat", |candidate| occupied.contains(candidate)),
            "chat-4"
        );
        assert_eq!(sessions_dedupe_slug("fresh", |_| false), "fresh");
    }

    #[test]
    fn session_civil_date_formatting_handles_epoch_and_leap_days() {
        assert_eq!(sessions_format_civil_date(-1), "1969-12-31");
        assert_eq!(sessions_format_civil_date(0), "1970-01-01");
        assert_eq!(sessions_format_civil_date(11_016), "2000-02-29");
        assert_eq!(sessions_format_civil_date(19_782), "2024-02-29");
    }

    #[test]
    fn sessions_home_honors_test_override() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("home");
        fs::create_dir_all(&directory).unwrap();
        let _guard = set_sessions_home(&directory);
        assert_eq!(sessions_home_path().unwrap(), directory);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn sessions_database_migration_is_idempotent_for_existing_store() {
        let directory = sessions_test_directory("migration");
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("sessions.sqlite");
        let mut connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    slug TEXT NOT NULL,
                    dir TEXT NOT NULL,
                    kind TEXT NOT NULL CHECK (kind IN ('generated', 'pinned')),
                    provider TEXT NOT NULL DEFAULT 'haider',
                    provider_session_id TEXT NOT NULL DEFAULT '',
                    created_at_ms INTEGER NOT NULL,
                    latest_at_ms INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'idle',
                    first_user_message TEXT NOT NULL DEFAULT ''
                 );
                 INSERT INTO sessions (
                    id, title, slug, dir, kind, provider_session_id,
                    created_at_ms, latest_at_ms
                 ) VALUES ('old-row', 'Old row', 'old-row', '', 'pinned', 'provider-old', 1, 2);",
            )
            .unwrap();

        sessions_initialize_database(&mut connection).unwrap();
        sessions_initialize_database(&mut connection).unwrap();

        let columns = {
            let mut statement = connection.prepare("PRAGMA table_info(sessions)").unwrap();
            let columns = statement
                .query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            columns
        };
        assert_eq!(
            columns.into_iter().collect::<HashSet<_>>(),
            [
                "id",
                "slug",
                "dir",
                "kind",
                "provider_session_id",
                "created_at_ms",
                "pinned",
                "title_locked",
                "harness_json",
                "first_user_message",
            ]
            .into_iter()
            .map(str::to_string)
            .collect::<HashSet<_>>()
        );
        let row = sessions_row_by_id(&connection, "old-row").unwrap();
        assert_eq!(row.harness["title"], "Old row");
        assert_eq!(row.harness["latest_at_ms"], 2);
        assert_eq!(row.harness["run_state"], "idle");
        let row_json = serde_json::to_value(&row).unwrap();
        assert_eq!(row_json["title"], "Old row");
        assert_eq!(row_json["latest_at_ms"], 2);
        assert_eq!(row_json["status"], "idle");
        assert_eq!(row_json["effort"], Value::Null);
        assert_eq!(row_json["speed"], Value::Null);
        assert_eq!(row_json["seen_at_ms"], Value::Null);
        assert_eq!(row_json["last_activity_ms"], Value::Null);
        assert_eq!(row_json["waiting_kind"], Value::Null);
        assert_eq!(row_json["waiting_menu_id"], Value::Null);
        assert_eq!(row_json["needs_input"], Value::Null);
        assert_eq!(row_json["run_id"], Value::Null);
        assert_eq!(row_json["worker_generation"], Value::Null);
        assert!(!row.pinned);
        assert!(row.title_override.is_none());

        drop(connection);
        fs::remove_dir_all(directory).unwrap();
    }

    // title_locked changed meaning in this migration: it was a boolean beside a
    // `title` column, and it now holds the locked title itself. A row that was
    // renamed by hand before the upgrade is the only place that rename exists,
    // so the rebuild has to carry it across rather than reconstruct it.
    // A fallback that asserts a REAL STATE is the dangerous kind. Bucketing an
    // unrecognised run_state as idle would report a working session as quiet,
    // which is the direction that hides work from the person watching.
    #[test]
    fn an_unrecognised_run_state_is_never_reported_as_idle() {
        let invented = json!({"status": "summarising_for_handoff"});
        assert_eq!(sessions_status_from_run_state(Some(&invented)), "running");

        // Saying nothing still means idle — absent is not the same as unknown.
        assert_eq!(sessions_status_from_run_state(None), "idle");
        assert_eq!(sessions_status_from_run_state(Some(&json!(""))), "idle");

        // And a state the daemon names that genuinely IS quiet stays idle.
        for quiet in ["idle", "done", "completed", "interrupted", "offline"] {
            assert_eq!(
                sessions_status_from_run_state(Some(&json!(quiet))),
                "idle",
                "{quiet} should bucket as idle"
            );
        }

        // The listed vocabularies keep their meaning.
        assert_eq!(sessions_status_from_run_state(Some(&json!("failed"))), "error");
        assert_eq!(sessions_status_from_run_state(Some(&json!("waiting"))), "waiting");
        assert_eq!(sessions_status_from_run_state(Some(&json!("thinking"))), "running");
    }

    #[test]
    fn sessions_migration_preserves_a_locked_legacy_title() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("migration-locked");
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("sessions.sqlite");
        let mut connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    slug TEXT NOT NULL,
                    dir TEXT NOT NULL,
                    kind TEXT NOT NULL CHECK (kind IN ('generated', 'pinned')),
                    provider TEXT NOT NULL DEFAULT 'haider',
                    provider_session_id TEXT NOT NULL DEFAULT '',
                    created_at_ms INTEGER NOT NULL,
                    latest_at_ms INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'idle',
                    first_user_message TEXT NOT NULL DEFAULT '',
                    title_locked INTEGER NOT NULL DEFAULT 0
                 );
                 INSERT INTO sessions (
                    id, title, slug, dir, kind, provider_session_id,
                    created_at_ms, latest_at_ms, title_locked
                 ) VALUES
                    ('locked', 'Hand written', 'locked', '', 'pinned', 'p-locked', 1, 2, 1),
                    ('auto', 'Model written', 'auto', '', 'pinned', 'p-auto', 1, 2, 0);",
            )
            .unwrap();

        sessions_initialize_database(&mut connection).unwrap();

        let locked = sessions_row_by_id(&connection, "locked").unwrap();
        assert_eq!(locked.title_override.as_deref(), Some("Hand written"));
        assert_eq!(locked.title(), "Hand written");
        assert_eq!(
            serde_json::to_value(&locked).unwrap()["title_locked"],
            Value::Bool(true)
        );

        // An auto-titled row must NOT come back locked, or the daemon could
        // never retitle it again.
        let auto = sessions_row_by_id(&connection, "auto").unwrap();
        assert!(auto.title_override.is_none());
        assert_eq!(auto.title(), "Model written");
        assert_eq!(
            serde_json::to_value(&auto).unwrap()["title_locked"],
            Value::Bool(false)
        );

        drop(connection);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn session_rename_locks_title_against_reconcile() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("rename");
        fs::create_dir_all(&directory).unwrap();
        let _data_guard = set_sessions_env(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &directory);
        let connection = sessions_open_database().unwrap();
        let row = sessions_test_row("rename", Path::new(""), "pinned");
        sessions_test_insert_row(&connection, &row);
        drop(connection);

        assert!(session_rename_blocking("rename".to_string(), "  \n".to_string()).is_err());
        let renamed =
            session_rename_blocking("rename".to_string(), "User title".to_string()).unwrap();
        assert_eq!(renamed.title(), "User title");
        assert_eq!(renamed.slug, "original-title");
        assert_eq!(renamed.dir, "");
        assert!(renamed.title_override.is_some());

        assert!(haider_bridge_reconcile(&[HaiderBridgeSession {
            id: "provider-rename".to_string(),
            harness: json!({
                "session_id": "provider-rename",
                "title": "Daemon title",
                "model": "daemon-model",
                "provider": "openai",
                "run_state": "running",
                "updated_at_ms": 20,
            }),
        }])
        .unwrap());
        let connection = sessions_open_database().unwrap();
        let reconciled = sessions_row_by_id(&connection, "rename").unwrap();
        assert_eq!(reconciled.title(), "User title");
        assert!(reconciled.title_override.is_some());
        assert_eq!(reconciled.harness["title"], "Daemon title");
        let serialized = reconciled.serialized_value();
        assert_eq!(serialized["title"], "User title");
        assert_eq!(serialized["model"], "daemon-model");
        assert_eq!(serialized["status"], "running");
        assert_eq!(serialized["state_raw"], "running");
        assert_eq!(serialized["latest_at_ms"], 20);
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn session_pinned_toggle_round_trips() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("pinned");
        fs::create_dir_all(&directory).unwrap();
        let _data_guard = set_sessions_env(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &directory);
        let connection = sessions_open_database().unwrap();
        let row = sessions_test_row("pinned", Path::new(""), "pinned");
        sessions_test_insert_row(&connection, &row);
        drop(connection);

        assert!(
            session_set_pinned_blocking("pinned".to_string(), true)
                .unwrap()
                .pinned
        );
        assert!(
            !session_set_pinned_blocking("pinned".to_string(), false)
                .unwrap()
                .pinned
        );
        let connection = sessions_open_database().unwrap();
        assert!(!sessions_row_by_id(&connection, "pinned").unwrap().pinned);
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn first_user_message_reslug_skips_locked_rows() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("locked-reslug");
        let session_directory = directory.join("home").join("original-title");
        fs::create_dir_all(session_directory.join("work")).unwrap();
        let session_directory = session_directory.canonicalize().unwrap();
        let _data_guard = set_sessions_env(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &directory);
        let connection = sessions_open_database().unwrap();
        let row = sessions_test_row("locked-reslug", &session_directory, "generated");
        sessions_test_insert_row(&connection, &row);
        drop(connection);

        session_rename_blocking("locked-reslug".to_string(), "User title".to_string()).unwrap();
        let updated = session_update_blocking(SessionUpdateArgs {
            id: "locked-reslug".to_string(),
            title: Some("Automatic title".to_string()),
            provider_session_id: None,
            first_user_message: Some("Automatic title".to_string()),
        })
        .unwrap();
        assert_eq!(updated.title(), "User title");
        assert_eq!(updated.slug, "original-title");
        assert_eq!(updated.dir, session_directory.to_string_lossy());
        assert_eq!(updated.first_user_message, "Automatic title");
        assert!(session_directory.exists());
        assert!(!session_directory
            .parent()
            .unwrap()
            .join("automatic-title")
            .exists());

        fs::remove_dir_all(directory).unwrap();
    }

    fn haider_bridge_test_roster(id: &str) -> HaiderBridgeSession {
        HaiderBridgeSession {
            id: id.to_string(),
            harness: json!({
                "session_id": id,
                "title": "Daemon session",
                "model": "model",
                "provider": "openai",
                "run_state": "idle",
                "updated_at_ms": sessions_now_ms(),
            }),
        }
    }

    fn haider_bridge_test_rpc_summary(id: &str, head_seq: i64) -> Value {
        json!({
            "session_id": id,
            "head_seq": head_seq,
            "title": "RPC session",
            "last_model": "gpt-5.6-sol",
            "run_state": "idle",
            "footprint_tokens": 42_001,
            "footprint_truth": "exact",
            "agent_metrics": {
                "usage": {
                    "cache_reread_hit_basis_points": 8125,
                    "cache_hit_basis_points": 8750
                }
            },
            "workspace_cwd": "/daemon/workspace"
        })
    }

    fn haider_bridge_test_cli_summary(id: &str, title: &str) -> Value {
        json!({
            "active_branch": "main",
            "branches": ["main"],
            "footprint": {"tokens": 40_000, "truth": "exact"},
            "id": id,
            "last_activity_ms": 30,
            "model": "gpt-5.6-sol",
            "provider": "openai-oauth",
            "run_id": "run-cli",
            "run_state": "idle",
            "seen_at_ms": 31,
            "session_id": id,
            "subagent_count": 0,
            "title": title,
            "updated_at": 32,
            "worker_generation": 4
        })
    }

    #[test]
    fn haider_bridge_cli_payload_cannot_downgrade_stored_rpc_payload() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("rpc-precedence");
        fs::create_dir_all(&directory).unwrap();
        let _data_guard = set_sessions_env(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &directory);
        let connection = sessions_open_database().unwrap();
        let mut row = sessions_test_row("rpc-precedence", Path::new(""), "pinned");
        row.harness = haider_bridge_test_rpc_summary(&row.provider_session_id, 17);
        let rich = row.harness.clone();
        sessions_test_insert_row(&connection, &row);
        drop(connection);

        let cli = HaiderBridgeSession {
            id: row.provider_session_id.clone(),
            harness: haider_bridge_test_cli_summary(&row.provider_session_id, "CLI downgrade"),
        };
        assert!(!haider_bridge_reconcile_store_with_policy(
            HaiderBridgeReconcilePolicy::cli(false),
            None,
            &[cli],
        )
        .unwrap());

        let connection = sessions_open_database().unwrap();
        let stored = sessions_row_by_id(&connection, &row.id).unwrap();
        assert_eq!(stored.harness, rich);
        assert_eq!(
            stored.harness["agent_metrics"]["usage"]["cache_reread_hit_basis_points"],
            8125
        );
        assert!(stored.harness.get("footprint").is_none());
        drop(connection);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn haider_bridge_live_cli_sync_preserves_idle_rpc_payload() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("live-cli-cycle");
        fs::create_dir_all(&directory).unwrap();
        let _data_guard = set_sessions_env(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &directory);
        let connection = sessions_open_database().unwrap();
        let row = sessions_test_row("live-cli-cycle", Path::new(""), "pinned");
        sessions_test_insert_row(&connection, &row);
        drop(connection);

        *haider_bridge_reconcile_trackers().lock().unwrap() =
            HaiderBridgeReconcileTrackers::default();
        let rpc_summary = haider_bridge_test_rpc_summary(&row.provider_session_id, 21);
        assert!(haider_bridge_reconcile_summary_values(
            vec![rpc_summary.clone()],
            false,
            HaiderBridgeReconcilePolicy::rpc(),
        )
        .unwrap());

        assert!(!haider_bridge_reconcile_summary_values(
            vec![json!({
                "sessions": [haider_bridge_test_cli_summary(
                    &row.provider_session_id,
                    "CLI cycle"
                )]
            })],
            true,
            HaiderBridgeReconcilePolicy::cli(true),
        )
        .unwrap());

        let connection = sessions_open_database().unwrap();
        let stored = sessions_row_by_id(&connection, &row.id).unwrap();
        assert_eq!(stored.harness, rpc_summary);
        assert!(stored.harness.get("agent_metrics").is_some());
        assert!(stored.harness.get("footprint").is_none());
        drop(connection);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn haider_bridge_cli_fallback_reconciles_without_rpc() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("cli-fallback");
        fs::create_dir_all(&directory).unwrap();
        let _data_guard = set_sessions_env(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &directory);
        let connection = sessions_open_database().unwrap();
        let row = sessions_test_row("cli-fallback", Path::new(""), "pinned");
        sessions_test_insert_row(&connection, &row);
        drop(connection);

        let cli_summary = haider_bridge_test_cli_summary(&row.provider_session_id, "CLI fallback");
        let imported_summary =
            haider_bridge_test_cli_summary("provider-daemon-created", "Daemon-created session");
        let roster = vec![
            HaiderBridgeSession {
                id: row.provider_session_id.clone(),
                harness: cli_summary.clone(),
            },
            HaiderBridgeSession {
                id: "provider-daemon-created".to_string(),
                harness: imported_summary.clone(),
            },
        ];
        let summary = json!({
            "sessions": roster
                .iter()
                .map(|session| session.harness.clone())
                .collect::<Vec<_>>()
        });
        *haider_bridge_reconcile_trackers().lock().unwrap() =
            HaiderBridgeReconcileTrackers::default();
        assert!(haider_bridge_reconcile_summary_values(
            vec![summary.clone()],
            true,
            HaiderBridgeReconcilePolicy::cli(false),
        )
        .unwrap());

        let connection = sessions_open_database().unwrap();
        assert_eq!(
            sessions_row_by_id(&connection, &row.id).unwrap().harness,
            cli_summary
        );
        let imported_json = connection
            .query_row(
                "SELECT harness_json FROM sessions WHERE provider_session_id = ?1",
                ["provider-daemon-created"],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&imported_json).unwrap(),
            imported_summary
        );
        drop(connection);

        // An unchanged complete fallback roster is still maintenance
        // evidence. A ghost introduced after the first cycle must be pruned.
        let connection = sessions_open_database().unwrap();
        let ghost = sessions_test_row("fallback-ghost", Path::new(""), "pinned");
        sessions_test_insert_row(&connection, &ghost);
        drop(connection);
        assert!(haider_bridge_reconcile_summary_values(
            vec![summary],
            true,
            HaiderBridgeReconcilePolicy::cli(false),
        )
        .unwrap());
        let connection = sessions_open_database().unwrap();
        assert!(sessions_row_by_id(&connection, &ghost.id).is_err());
        drop(connection);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn haider_bridge_live_cli_sync_still_prunes_ghosts() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("live-cli-prune");
        fs::create_dir_all(&directory).unwrap();
        let _data_guard = set_sessions_env(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &directory);
        let connection = sessions_open_database().unwrap();
        let mut kept = sessions_test_row("live-kept", Path::new(""), "pinned");
        kept.harness = haider_bridge_test_rpc_summary(&kept.provider_session_id, 33);
        let ghost = sessions_test_row("live-ghost", Path::new(""), "pinned");
        sessions_test_insert_row(&connection, &kept);
        sessions_test_insert_row(&connection, &ghost);
        drop(connection);

        assert!(haider_bridge_reconcile_summary_values(
            vec![json!({
                "sessions": [haider_bridge_test_cli_summary(
                    &kept.provider_session_id,
                    "CLI roster"
                )]
            })],
            true,
            HaiderBridgeReconcilePolicy::cli(true),
        )
        .unwrap());

        let connection = sessions_open_database().unwrap();
        assert!(sessions_row_by_id(&connection, &ghost.id).is_err());
        let stored = sessions_row_by_id(&connection, &kept.id).unwrap();
        assert!(stored.harness.get("agent_metrics").is_some());
        assert!(stored.harness.get("footprint").is_none());
        drop(connection);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn haider_bridge_empty_roster_does_not_prune() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("empty-roster");
        let session_directory = directory.join("kept-session");
        fs::create_dir_all(&session_directory).unwrap();
        let _data_guard = set_sessions_env(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &directory);
        let connection = sessions_open_database().unwrap();
        let row = sessions_test_row("kept", &session_directory, "generated");
        sessions_test_insert_row(&connection, &row);
        drop(connection);

        assert!(!haider_bridge_reconcile(&[]).unwrap());
        let connection = sessions_open_database().unwrap();
        assert!(sessions_row_by_id(&connection, "kept").is_ok());
        assert!(session_directory.exists());
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn haider_bridge_store_serialize_round_trip_preserves_full_and_unknown_harness_payload() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("opaque-harness");
        fs::create_dir_all(&directory).unwrap();
        let _data_guard = set_sessions_env(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &directory);
        let connection = sessions_open_database().unwrap();
        let mut row = sessions_test_row("opaque", Path::new("/ade-owned-dir"), "pinned");
        row.pinned = true;
        row.first_user_message = "ADE search text".to_string();
        sessions_test_insert_row(&connection, &row);
        drop(connection);

        let needs_input = json!({"kind": "permission", "future_card_field": [1, 2, 3]});
        let summary = json!({
            "session_id": "provider-opaque",
            "title": "Opaque daemon title",
            "last_model": "gpt-future",
            "provider": "openai",
            "run_state": {"status": "running_tool", "tool": "cargo"},
            "updated_at_ms": 1_777_777_777_123_i64,
            "effort": "xhigh",
            "fast": true,
            "seen_at_ms": 20,
            "last_activity_ms": 30,
            "waiting_why": {"kind": "permission", "pending_menu_id": "menu-936"},
            "run_id": "run-live",
            "worker_generation": 97,
            "needs_input": needs_input,
            "turn_count": 8,
            "footprint_tokens": 42_001,
            "agent_metrics": {"tool_calls": 17},
            "agent_type": "direct",
            "account_alias": "work",
            "parent_session_id": null,
            "workspace_cwd": "/daemon/workspace",
            "daemon_field_added_after_ade_had_shipped": {"nested": [true, "intact"]}
        });
        assert!(haider_bridge_reconcile(&[HaiderBridgeSession {
            id: "provider-opaque".to_string(),
            harness: summary.clone(),
        }])
        .unwrap());

        let connection = sessions_open_database().unwrap();
        let reconciled = sessions_row_by_id(&connection, "opaque").unwrap();
        assert_eq!(reconciled.harness, summary);
        let serialized = serde_json::to_value(&reconciled).unwrap();
        assert_eq!(serialized["title"], "Opaque daemon title");
        assert_eq!(serialized["model"], "gpt-future");
        assert_eq!(serialized["status"], "running");
        assert_eq!(serialized["state_raw"], "running_tool: cargo");
        assert_eq!(serialized["latest_at_ms"], 1_777_777_777_123_i64);
        assert_eq!(serialized["speed"], "fast");
        assert_eq!(serialized["waiting_kind"], "permission");
        assert_eq!(serialized["waiting_menu_id"], "menu-936");
        assert_eq!(serialized["needs_input"], needs_input);
        assert_eq!(serialized["turn_count"], 8);
        assert_eq!(serialized["footprint_tokens"], 42_001);
        assert_eq!(
            serialized["daemon_field_added_after_ade_had_shipped"],
            json!({"nested": [true, "intact"]})
        );
        // Reconcile mentioned none of these ADE-owned values.
        assert_eq!(reconciled.slug, "original-title");
        assert_eq!(reconciled.dir, "/ade-owned-dir");
        assert_eq!(reconciled.kind, "pinned");
        assert_eq!(reconciled.created_at_ms, 10);
        assert!(reconciled.pinned);
        assert_eq!(reconciled.first_user_message, "ADE search text");
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn haider_bridge_summary_needs_input_round_trips_and_clears_sql_null() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("needs-input-state");
        fs::create_dir_all(&directory).unwrap();
        let _data_guard = set_sessions_env(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &directory);
        let connection = sessions_open_database().unwrap();
        let mut row = sessions_test_row("needs-input", Path::new(""), "pinned");
        row.provider_session_id = "provider-needs-input".to_string();
        sessions_test_insert_row(&connection, &row);
        drop(connection);

        let card = json!({
            "kind": "recovery",
            "title": "Effect outcome unknown",
            "safe_body": [
                "Dispatched effect: effect test",
                "probe: no result committed"
            ],
            "menu_id": "effect-recovery-test",
            "request_seq": 1843_u64,
            "worker_generation": 122_u64,
            "since_ms": 1_777_777_777_123_i64,
            "options": [{
                "key": "probe",
                "label": "Probe",
                "detail": "Re-check whether the effect completed."
            }]
        });
        let mut tracker = HaiderBridgeReconcileTracker::default();
        assert!(haider_bridge_reconcile_summary_values_tracked(
            &mut tracker,
            vec![json!({
                "session_id": "provider-needs-input",
                "head_seq": 17,
                "run_state": "waiting",
                "needs_input": card.clone()
            })],
            false,
            haider_bridge_reconcile_store,
        )
        .unwrap());

        let connection = sessions_open_database().unwrap();
        let stored_json = connection
            .query_row(
                "SELECT harness_json FROM sessions WHERE id = ?1",
                ["needs-input"],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&stored_json).unwrap()["needs_input"],
            card
        );
        let reconciled = sessions_row_by_id(&connection, "needs-input").unwrap();
        assert_eq!(reconciled.needs_input(), card);
        assert!(reconciled.needs_input().get("secret_answer").is_none());
        drop(connection);

        assert!(haider_bridge_reconcile_summary_values_tracked(
            &mut tracker,
            vec![json!({
                "session_id": "provider-needs-input",
                "head_seq": 17,
                "run_state": "waiting"
            })],
            false,
            haider_bridge_reconcile_store,
        )
        .unwrap());

        let connection = sessions_open_database().unwrap();
        let stored_json = connection
            .query_row(
                "SELECT harness_json FROM sessions WHERE id = ?1",
                ["needs-input"],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        assert!(serde_json::from_str::<Value>(&stored_json).unwrap()["needs_input"].is_null());
        let reconciled = sessions_row_by_id(&connection, "needs-input").unwrap();
        assert_eq!(reconciled.needs_input(), Value::Null);
        assert_eq!(
            serde_json::to_value(&reconciled).unwrap()["needs_input"],
            Value::Null
        );
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn haider_bridge_ghost_prune_observes_age_guard() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("ghost-age");
        fs::create_dir_all(&directory).unwrap();
        let _data_guard = set_sessions_env(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &directory);
        let connection = sessions_open_database().unwrap();
        let mut old = sessions_test_row("old-ghost", Path::new(""), "pinned");
        old.provider_session_id.clear();
        old.created_at_ms = sessions_now_ms().saturating_sub(HAIDER_BRIDGE_GHOST_MAX_AGE_MS + 1);
        let mut young = sessions_test_row("young-draft", Path::new(""), "pinned");
        young.provider_session_id.clear();
        young.created_at_ms = sessions_now_ms().saturating_sub(60_000);
        sessions_test_insert_row(&connection, &old);
        sessions_test_insert_row(&connection, &young);
        drop(connection);

        assert!(haider_bridge_reconcile(&[haider_bridge_test_roster("live")]).unwrap());
        let connection = sessions_open_database().unwrap();
        assert!(sessions_row_by_id(&connection, "old-ghost").is_err());
        assert!(sessions_row_by_id(&connection, "young-draft").is_ok());
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn haider_bridge_absent_id_prune_keeps_directory() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("absent-id");
        let session_directory = directory.join("generated-session");
        fs::create_dir_all(&session_directory).unwrap();
        fs::write(session_directory.join("marker.txt"), b"keep").unwrap();
        let _data_guard = set_sessions_env(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &directory);
        let connection = sessions_open_database().unwrap();
        let row = sessions_test_row("absent", &session_directory, "generated");
        sessions_test_insert_row(&connection, &row);
        drop(connection);

        assert!(haider_bridge_reconcile(&[haider_bridge_test_roster("live")]).unwrap());
        let connection = sessions_open_database().unwrap();
        assert!(sessions_row_by_id(&connection, "absent").is_err());
        assert_eq!(
            fs::read(session_directory.join("marker.txt")).unwrap(),
            b"keep"
        );
        drop(connection);

        fs::remove_dir_all(directory).unwrap();
    }
}

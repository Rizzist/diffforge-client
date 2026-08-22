const SESSIONS_HOME_ENV: &str = "RUST_DIFFFORGE_SESSIONS_HOME";
const SESSIONS_CHANGED_EVENT: &str = "sessions-changed";

#[derive(Clone, Debug, Serialize)]
struct SessionRow {
    id: String,
    title: String,
    slug: String,
    dir: String,
    kind: String,
    provider: String,
    provider_session_id: String,
    run_id: Option<String>,
    worker_generation: Option<i64>,
    created_at_ms: i64,
    latest_at_ms: i64,
    status: String,
    state_raw: String,
    first_user_message: String,
    model: String,
    effort: Option<String>,
    #[serde(rename = "speed", serialize_with = "sessions_serialize_speed")]
    speed_fast: Option<i64>,
    seen_at_ms: Option<i64>,
    last_activity_ms: Option<i64>,
    waiting_kind: Option<String>,
    waiting_menu_id: Option<String>,
    needs_input: Value,
    pinned: bool,
    title_locked: bool,
}

fn sessions_serialize_speed<S>(speed_fast: &Option<i64>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    if speed_fast == &Some(1) {
        serializer.serialize_some("fast")
    } else {
        serializer.serialize_none()
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
    status: Option<String>,
    state_raw: Option<String>,
    provider_session_id: Option<String>,
    first_user_message: Option<String>,
    touch: Option<bool>,
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
                title TEXT NOT NULL,
                slug TEXT NOT NULL,
                dir TEXT NOT NULL,
                kind TEXT NOT NULL CHECK (kind IN ('generated', 'pinned')),
                provider TEXT NOT NULL DEFAULT 'haider',
                provider_session_id TEXT NOT NULL DEFAULT '',
                run_id TEXT,
                worker_generation INTEGER,
                created_at_ms INTEGER NOT NULL,
                latest_at_ms INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                state_raw TEXT NOT NULL DEFAULT '',
                first_user_message TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                effort TEXT,
                speed_fast INTEGER,
                seen_at_ms INTEGER,
                last_activity_ms INTEGER,
                waiting_kind TEXT,
                waiting_menu_id TEXT,
                needs_input_json TEXT,
                pinned INTEGER NOT NULL DEFAULT 0,
                title_locked INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS idx_sessions_latest_at_ms
                ON sessions(latest_at_ms DESC);",
        )
        .map_err(|error| format!("Unable to initialize sessions SQLite store: {error}"))?;
    let migrations = [
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
    let columns = sessions_table_columns(connection)?;
    if migrations
        .iter()
        .all(|(column, _)| columns.contains(*column))
    {
        return Ok(());
    }
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| format!("Unable to begin sessions SQLite migration: {error}"))?;
    let columns = sessions_table_columns(&transaction)?;
    for (column, definition) in migrations {
        if !columns.contains(column) {
            transaction
                .execute(
                    &format!("ALTER TABLE sessions ADD COLUMN {column} {definition}"),
                    [],
                )
                .map_err(|error| format!("Unable to migrate sessions SQLite schema: {error}"))?;
        }
    }
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
        title: row.get(1)?,
        slug: row.get(2)?,
        dir: row.get(3)?,
        kind: row.get(4)?,
        provider: row.get(5)?,
        provider_session_id: row.get(6)?,
        run_id: row.get(7)?,
        worker_generation: row.get(8)?,
        created_at_ms: row.get(9)?,
        latest_at_ms: row.get(10)?,
        status: row.get(11)?,
        state_raw: row.get(12)?,
        first_user_message: row.get(13)?,
        model: row.get(14)?,
        effort: row.get(15)?,
        speed_fast: row.get(16)?,
        seen_at_ms: row.get(17)?,
        last_activity_ms: row.get(18)?,
        waiting_kind: row.get(19)?,
        waiting_menu_id: row.get(20)?,
        needs_input: row
            .get::<_, Option<String>>(21)?
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or(Value::Null),
        pinned: row.get(22)?,
        title_locked: row.get(23)?,
    })
}

const SESSIONS_SELECT_COLUMNS: &str =
    "id, title, slug, dir, kind, provider, provider_session_id, run_id, worker_generation, created_at_ms, latest_at_ms, status, state_raw, first_user_message, model, effort, speed_fast, seen_at_ms, last_activity_ms, waiting_kind, waiting_menu_id, needs_input_json, pinned, title_locked";

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
    let query = format!(
        "SELECT {SESSIONS_SELECT_COLUMNS} FROM sessions ORDER BY latest_at_ms DESC, id DESC"
    );
    let mut statement = connection
        .prepare(&query)
        .map_err(|error| format!("Unable to prepare sessions list: {error}"))?;
    let rows = statement
        .query_map([], sessions_sqlite_row)
        .map_err(|error| format!("Unable to list sessions: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Unable to decode session row: {error}"))?;
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
        title,
        slug,
        dir: directory.to_string_lossy().to_string(),
        kind: kind.to_string(),
        provider: "haider".to_string(),
        provider_session_id: String::new(),
        run_id: None,
        worker_generation: None,
        created_at_ms: now_ms,
        latest_at_ms: now_ms,
        status: "idle".to_string(),
        state_raw: String::new(),
        first_user_message: String::new(),
        model: String::new(),
        effort: None,
        speed_fast: None,
        seen_at_ms: None,
        last_activity_ms: None,
        waiting_kind: None,
        waiting_menu_id: None,
        needs_input: Value::Null,
        pinned: false,
        title_locked: false,
    };
    let connection = sessions_open_database()?;
    connection
        .execute(
            "INSERT INTO sessions (
                id, title, slug, dir, kind, provider, provider_session_id,
                created_at_ms, latest_at_ms, status, state_raw, first_user_message,
                model, pinned, title_locked
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            rusqlite::params![
                row.id,
                row.title,
                row.slug,
                row.dir,
                row.kind,
                row.provider,
                row.provider_session_id,
                row.created_at_ms,
                row.latest_at_ms,
                row.status,
                row.state_raw,
                row.first_user_message,
                row.model,
                row.pinned,
                row.title_locked,
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

    if !row.title_locked {
        if let Some(title) = args.title {
            row.title = title;
        }
    }
    if let Some(status) = args.status {
        row.status = status;
    }
    if let Some(state_raw) = args.state_raw {
        row.state_raw = state_raw;
    }
    if let Some(provider_session_id) = args.provider_session_id {
        row.provider_session_id = provider_session_id;
    }
    if let Some(first_user_message) = args.first_user_message {
        let should_reslug = row.kind == "generated"
            && !row.title_locked
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
    if args.touch.unwrap_or(false) {
        row.latest_at_ms = sessions_now_ms();
    }

    connection
        .execute(
            "UPDATE sessions SET
                title = ?2, slug = ?3, dir = ?4, kind = ?5, provider = ?6,
                provider_session_id = ?7, created_at_ms = ?8, latest_at_ms = ?9,
                status = ?10, state_raw = ?11, first_user_message = ?12,
                model = ?13, pinned = ?14, title_locked = ?15
             WHERE id = ?1",
            rusqlite::params![
                row.id,
                row.title,
                row.slug,
                row.dir,
                row.kind,
                row.provider,
                row.provider_session_id,
                row.created_at_ms,
                row.latest_at_ms,
                row.status,
                row.state_raw,
                row.first_user_message,
                row.model,
                row.pinned,
                row.title_locked,
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
            "UPDATE sessions SET title = ?2, title_locked = 1 WHERE id = ?1",
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
            title: "Original title".to_string(),
            slug: "original-title".to_string(),
            dir: dir.to_string_lossy().to_string(),
            kind: kind.to_string(),
            provider: "haider".to_string(),
            provider_session_id: format!("provider-{id}"),
            run_id: None,
            worker_generation: None,
            created_at_ms: 10,
            latest_at_ms: 10,
            status: "idle".to_string(),
            state_raw: "idle".to_string(),
            first_user_message: String::new(),
            model: String::new(),
            effort: None,
            speed_fast: None,
            seen_at_ms: None,
            last_activity_ms: None,
            waiting_kind: None,
            waiting_menu_id: None,
            needs_input: Value::Null,
            pinned: false,
            title_locked: false,
        }
    }

    fn sessions_test_insert_row(connection: &rusqlite::Connection, row: &SessionRow) {
        connection
            .execute(
                "INSERT INTO sessions (
                    id, title, slug, dir, kind, provider, provider_session_id,
                    run_id, worker_generation, created_at_ms, latest_at_ms,
                    status, state_raw, first_user_message, model, pinned, title_locked
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                rusqlite::params![
                    row.id,
                    row.title,
                    row.slug,
                    row.dir,
                    row.kind,
                    row.provider,
                    row.provider_session_id,
                    row.run_id,
                    row.worker_generation,
                    row.created_at_ms,
                    row.latest_at_ms,
                    row.status,
                    row.state_raw,
                    row.first_user_message,
                    row.model,
                    row.pinned,
                    row.title_locked,
                ],
            )
            .unwrap();
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
        for column in [
            "model",
            "pinned",
            "title_locked",
            "state_raw",
            "effort",
            "speed_fast",
            "seen_at_ms",
            "last_activity_ms",
            "waiting_kind",
            "waiting_menu_id",
            "needs_input_json",
            "run_id",
            "worker_generation",
        ] {
            assert_eq!(columns.iter().filter(|name| *name == column).count(), 1);
        }
        let row = sessions_row_by_id(&connection, "old-row").unwrap();
        assert_eq!(row.model, "");
        assert_eq!(row.state_raw, "");
        assert_eq!(row.effort, None);
        assert_eq!(row.speed_fast, None);
        assert_eq!(row.seen_at_ms, None);
        assert_eq!(row.last_activity_ms, None);
        assert_eq!(row.waiting_kind, None);
        assert_eq!(row.waiting_menu_id, None);
        assert_eq!(row.needs_input, Value::Null);
        assert_eq!(row.run_id, None);
        assert_eq!(row.worker_generation, None);
        let row_json = serde_json::to_value(&row).unwrap();
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
        assert!(!row.title_locked);

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
        assert_eq!(renamed.title, "User title");
        assert_eq!(renamed.slug, "original-title");
        assert_eq!(renamed.dir, "");
        assert!(renamed.title_locked);

        assert!(haider_bridge_reconcile(&[HaiderBridgeSession {
            id: "provider-rename".to_string(),
            title: Some("Daemon title".to_string()),
            model: Some("daemon-model".to_string()),
            provider: Some("openai".to_string()),
            cwd: None,
            state_raw: Some("running".to_string()),
            effort: None,
            fast: None,
            seen_at_ms: None,
            last_activity_ms: None,
            waiting_kind: None,
            waiting_menu_id: None,
            run_id: None,
            worker_generation: None,
            needs_input: Value::Null,
            latest_at_ms: Some(20),
        }])
        .unwrap());
        let connection = sessions_open_database().unwrap();
        let reconciled = sessions_row_by_id(&connection, "rename").unwrap();
        assert_eq!(reconciled.title, "User title");
        assert!(reconciled.title_locked);
        assert_eq!(reconciled.model, "daemon-model");
        assert_eq!(reconciled.status, "running");
        assert_eq!(reconciled.state_raw, "running");
        assert_eq!(reconciled.latest_at_ms, 20);
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
            status: None,
            state_raw: None,
            provider_session_id: None,
            first_user_message: Some("Automatic title".to_string()),
            touch: None,
        })
        .unwrap();
        assert_eq!(updated.title, "User title");
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
            title: Some("Daemon session".to_string()),
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
            run_id: None,
            worker_generation: None,
            needs_input: Value::Null,
            latest_at_ms: Some(sessions_now_ms()),
        }
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
    fn haider_bridge_reconcile_round_trips_and_clears_attention_state() {
        let _lock = ENV_LOCK.lock().unwrap();
        let directory = sessions_test_directory("attention-state");
        fs::create_dir_all(&directory).unwrap();
        let _data_guard = set_sessions_env(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &directory);
        let connection = sessions_open_database().unwrap();
        let mut row = sessions_test_row("attention", Path::new(""), "pinned");
        row.run_id = Some("run-live".to_string());
        row.worker_generation = Some(97);
        sessions_test_insert_row(&connection, &row);
        drop(connection);

        let mut roster = haider_bridge_test_roster("provider-attention");
        roster.seen_at_ms = Some(20);
        roster.last_activity_ms = Some(30);
        roster.waiting_kind = Some("permission".to_string());
        roster.waiting_menu_id = Some("menu-936".to_string());
        assert!(haider_bridge_reconcile(&[roster.clone()]).unwrap());

        let connection = sessions_open_database().unwrap();
        let reconciled = sessions_row_by_id(&connection, "attention").unwrap();
        assert_eq!(reconciled.seen_at_ms, Some(20));
        assert_eq!(reconciled.last_activity_ms, Some(30));
        assert_eq!(reconciled.waiting_kind.as_deref(), Some("permission"));
        assert_eq!(reconciled.waiting_menu_id.as_deref(), Some("menu-936"));
        assert_eq!(reconciled.run_id.as_deref(), Some("run-live"));
        assert_eq!(reconciled.worker_generation, Some(97));
        drop(connection);

        roster.seen_at_ms = None;
        roster.last_activity_ms = None;
        roster.waiting_kind = None;
        roster.waiting_menu_id = None;
        assert!(haider_bridge_reconcile(&[roster]).unwrap());

        let connection = sessions_open_database().unwrap();
        let reconciled = sessions_row_by_id(&connection, "attention").unwrap();
        assert_eq!(reconciled.seen_at_ms, None);
        assert_eq!(reconciled.last_activity_ms, None);
        assert_eq!(reconciled.waiting_kind, None);
        assert_eq!(reconciled.waiting_menu_id, None);
        assert_eq!(reconciled.run_id.as_deref(), Some("run-live"));
        assert_eq!(reconciled.worker_generation, Some(97));
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
                "state_raw": "waiting",
                "needs_input": card.clone()
            })],
            false,
            haider_bridge_reconcile_store,
        )
        .unwrap());

        let connection = sessions_open_database().unwrap();
        let stored_json = connection
            .query_row(
                "SELECT needs_input_json FROM sessions WHERE id = ?1",
                ["needs-input"],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap()
            .expect("needs_input JSON text");
        assert_eq!(serde_json::from_str::<Value>(&stored_json).unwrap(), card);
        let reconciled = sessions_row_by_id(&connection, "needs-input").unwrap();
        assert_eq!(reconciled.needs_input, card);
        assert!(reconciled.needs_input.get("secret_answer").is_none());
        drop(connection);

        assert!(haider_bridge_reconcile_summary_values_tracked(
            &mut tracker,
            vec![json!({
                "session_id": "provider-needs-input",
                "head_seq": 17,
                "state_raw": "waiting"
            })],
            false,
            haider_bridge_reconcile_store,
        )
        .unwrap());

        let connection = sessions_open_database().unwrap();
        let stored_json = connection
            .query_row(
                "SELECT needs_input_json FROM sessions WHERE id = ?1",
                ["needs-input"],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap();
        assert_eq!(stored_json, None);
        let reconciled = sessions_row_by_id(&connection, "needs-input").unwrap();
        assert_eq!(reconciled.needs_input, Value::Null);
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

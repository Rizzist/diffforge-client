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
    created_at_ms: i64,
    latest_at_ms: i64,
    status: String,
    first_user_message: String,
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

fn sessions_open_database() -> Result<rusqlite::Connection, String> {
    let path = sessions_database_path()?;
    let connection = rusqlite::Connection::open(&path)
        .map_err(|error| format!("Unable to open sessions SQLite store: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Unable to configure sessions SQLite timeout: {error}"))?;
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
                created_at_ms INTEGER NOT NULL,
                latest_at_ms INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                first_user_message TEXT NOT NULL DEFAULT ''
             );
             CREATE INDEX IF NOT EXISTS idx_sessions_latest_at_ms
                ON sessions(latest_at_ms DESC);",
        )
        .map_err(|error| format!("Unable to initialize sessions SQLite store: {error}"))?;
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
        created_at_ms: row.get(7)?,
        latest_at_ms: row.get(8)?,
        status: row.get(9)?,
        first_user_message: row.get(10)?,
    })
}

const SESSIONS_SELECT_COLUMNS: &str =
    "id, title, slug, dir, kind, provider, provider_session_id, created_at_ms, latest_at_ms, status, first_user_message";

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
        created_at_ms: now_ms,
        latest_at_ms: now_ms,
        status: "idle".to_string(),
        first_user_message: String::new(),
    };
    let connection = sessions_open_database()?;
    connection
        .execute(
            "INSERT INTO sessions (
                id, title, slug, dir, kind, provider, provider_session_id,
                created_at_ms, latest_at_ms, status, first_user_message
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
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

    if let Some(title) = args.title {
        row.title = title;
    }
    if let Some(status) = args.status {
        row.status = status;
    }
    if let Some(provider_session_id) = args.provider_session_id {
        row.provider_session_id = provider_session_id;
    }
    if let Some(first_user_message) = args.first_user_message {
        let should_reslug = row.kind == "generated"
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
                status = ?10, first_user_message = ?11
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
                row.first_user_message,
            ],
        )
        .map_err(|error| format!("Unable to update session: {error}"))?;
    Ok(row)
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

#[tauri::command]
async fn session_create(app: AppHandle, args: SessionCreateArgs) -> Result<SessionRow, String> {
    let row = tauri::async_runtime::spawn_blocking(move || session_create_blocking(args))
        .await
        .map_err(|error| format!("Session create worker failed: {error}"))??;
    sessions_emit_changed(&app);
    Ok(row)
}

#[tauri::command]
async fn session_update(app: AppHandle, args: SessionUpdateArgs) -> Result<SessionRow, String> {
    let row = tauri::async_runtime::spawn_blocking(move || session_update_blocking(args))
        .await
        .map_err(|error| format!("Session update worker failed: {error}"))??;
    sessions_emit_changed(&app);
    Ok(row)
}

#[tauri::command]
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
        previous: Option<std::ffi::OsString>,
    }

    impl Drop for SessionsEnvGuard {
        fn drop(&mut self) {
            match self.previous.as_ref() {
                Some(value) => env::set_var(SESSIONS_HOME_ENV, value),
                None => env::remove_var(SESSIONS_HOME_ENV),
            }
        }
    }

    fn set_sessions_home(path: &Path) -> SessionsEnvGuard {
        let previous = env::var_os(SESSIONS_HOME_ENV);
        env::set_var(SESSIONS_HOME_ENV, path);
        SessionsEnvGuard { previous }
    }

    fn sessions_test_directory(label: &str) -> PathBuf {
        env::temp_dir().join(format!(
            "diffforge-sessions-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ))
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
}

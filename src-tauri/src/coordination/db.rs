use std::{
    fs,
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

use rusqlite::{Connection, Error as SqliteError, ErrorCode};

use super::schema::{CREATE_SCHEMA_SQL, MIGRATION_NAME, MIGRATION_VERSION};

pub const REPO_ID: &str = "local";

#[derive(Debug, Clone)]
pub struct StoragePaths {
    pub repo_path: PathBuf,
    pub agents_root: PathBuf,
    pub db_path: PathBuf,
    pub artifacts_root: PathBuf,
    pub memory_root: PathBuf,
    pub worktrees_root: PathBuf,
    pub mcp_root: PathBuf,
    pub cloud_root: PathBuf,
}

impl StoragePaths {
    pub fn new(repo_path: PathBuf, db_path: Option<PathBuf>) -> Self {
        let agents_root = repo_path.join(".agents");
        Self {
            db_path: db_path.unwrap_or_else(|| agents_root.join("kernel.sqlite")),
            artifacts_root: agents_root.join("artifacts"),
            memory_root: agents_root.join("memory"),
            worktrees_root: agents_root.join("worktrees"),
            mcp_root: agents_root.join("mcp"),
            cloud_root: agents_root.join("cloud"),
            agents_root,
            repo_path,
        }
    }

    pub fn ensure(&self) -> Result<(), String> {
        for path in [
            &self.agents_root,
            &self.artifacts_root,
            &self.memory_root,
            &self.memory_root.join("decisions"),
            &self.memory_root.join("contracts"),
            &self.memory_root.join("handoffs"),
            &self.memory_root.join("bugs"),
            &self.memory_root.join("migrations"),
            &self.memory_root.join("qa"),
            &self.memory_root.join("runs"),
            &self.worktrees_root,
            &self.mcp_root,
            &self.cloud_root,
            &self.cloud_root.join("mock-plans"),
            &self.cloud_root.join("context-exports"),
            &self.cloud_root.join("received-plans"),
            &self.cloud_root.join("sync"),
            &self.agents_root.join("db").join("sandboxes"),
            &self.agents_root.join("db").join("schema-fingerprints"),
        ] {
            fs::create_dir_all(path)
                .map_err(|error| format!("Unable to create {}: {error}", path.display()))?;
        }

        Ok(())
    }
}

pub fn canonical_repo_path(repo_path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = repo_path.as_ref();

    if path.as_os_str().is_empty() {
        return std::env::current_dir()
            .map_err(|error| format!("Unable to resolve current directory: {error}"));
    }

    if path.exists() {
        path.canonicalize()
            .map(|path| PathBuf::from(process_path_text(&path)))
            .map_err(|error| {
                format!(
                    "Unable to canonicalize repo path {}: {error}",
                    path.display()
                )
            })
    } else {
        Ok(path.to_path_buf())
    }
}

pub fn process_path_text(path: &Path) -> String {
    #[cfg(windows)]
    {
        let path_text = path.to_string_lossy();

        if let Some(rest) = path_text.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{rest}");
        }

        if let Some(rest) = path_text.strip_prefix(r"\\?\") {
            return rest.to_string();
        }

        path_text.to_string()
    }

    #[cfg(not(windows))]
    {
        path.to_string_lossy().to_string()
    }
}

pub fn open_connection(paths: &StoragePaths) -> Result<(Connection, bool), String> {
    paths.ensure()?;
    let existed = paths.db_path.exists();
    let connection = Connection::open(&paths.db_path)
        .map_err(|error| format!("Unable to open {}: {error}", paths.db_path.display()))?;

    connection
        .busy_timeout(Duration::from_millis(30_000))
        .map_err(|error| format!("Unable to set SQLite busy timeout: {error}"))?;

    with_sqlite_lock_retry("Unable to enable SQLite WAL mode", || {
        connection.pragma_update(None, "journal_mode", "WAL")
    })?;
    with_sqlite_lock_retry("Unable to enable SQLite foreign keys", || {
        connection.pragma_update(None, "foreign_keys", "ON")
    })?;
    run_migrations(&connection)?;

    Ok((connection, existed))
}

fn run_migrations(connection: &Connection) -> Result<(), String> {
    with_sqlite_lock_retry("Unable to initialize coordination schema", || {
        connection.execute_batch(CREATE_SCHEMA_SQL)
    })?;

    let applied: i64 =
        with_sqlite_lock_retry("Unable to inspect coordination schema migrations", || {
            connection.query_row(
                "SELECT COUNT(1) FROM schema_migrations WHERE version = ?1",
                [MIGRATION_VERSION],
                |row| row.get(0),
            )
        })?;

    if applied == 0 {
        with_sqlite_lock_retry("Unable to record coordination schema migration", || {
            connection.execute(
                "INSERT INTO schema_migrations(version, name, applied_at) VALUES(?1, ?2, ?3)",
                rusqlite::params![
                    MIGRATION_VERSION,
                    MIGRATION_NAME,
                    super::kernel::now_rfc3339()
                ],
            )
        })?;
    }

    Ok(())
}

fn with_sqlite_lock_retry<T>(
    label: &str,
    mut operation: impl FnMut() -> rusqlite::Result<T>,
) -> Result<T, String> {
    let mut last_error = None;
    for attempt in 0..40 {
        match operation() {
            Ok(value) => return Ok(value),
            Err(error) if is_lock_error(&error) && attempt < 39 => {
                let delay = 40 + (attempt as u64 * 25).min(500);
                last_error = Some(error);
                thread::sleep(Duration::from_millis(delay));
            }
            Err(error) => return Err(format!("{label}: {error}")),
        }
    }

    Err(format!(
        "{label}: {}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "database remained locked".to_string())
    ))
}

fn is_lock_error(error: &SqliteError) -> bool {
    matches!(
        error,
        SqliteError::SqliteFailure(inner, _)
            if matches!(inner.code, ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
    )
}

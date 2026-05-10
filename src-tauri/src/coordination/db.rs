use std::{
    fs,
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

use rusqlite::{Connection, Error as SqliteError, ErrorCode};

use super::schema::{
    CREATE_SCHEMA_SQL, INITIAL_MIGRATION_NAME, INITIAL_MIGRATION_VERSION, MIGRATION_NAME,
    MIGRATION_VERSION, RUNTIME_GUARD_MIGRATION_NAME, RUNTIME_GUARD_MIGRATION_VERSION,
    RUNTIME_GUARD_SCHEMA_SQL, SLOT_MIGRATION_NAME, SLOT_MIGRATION_VERSION, SLOT_SCHEMA_SQL,
};

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
            &self.artifacts_root.join("db-change-requests"),
            &self.artifacts_root.join("migrations"),
            &self.artifacts_root.join("cloud"),
            &self.artifacts_root.join("repo-sketches"),
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
            &self.mcp_root.join("agents"),
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

        crate::ensure_workspace_agents_gitignore(&self.repo_path)?;
        clean_stale_mcp_temp_files(&self.mcp_root)?;

        Ok(())
    }
}

pub fn canonical_repo_path(repo_path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = repo_path.as_ref();

    if path.as_os_str().is_empty() {
        return crate::default_working_directory();
    }

    if path.exists() {
        let canonical = path
            .canonicalize()
            .map(|path| PathBuf::from(process_path_text(&path)))
            .map_err(|error| {
                format!(
                    "Unable to canonicalize repo path {}: {error}",
                    path.display()
                )
            })?;

        if crate::is_filesystem_root_directory(&canonical) {
            return Err("Workspace root directory cannot be the filesystem root.".to_string());
        }

        Ok(canonical)
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

    record_migration_if_missing(
        connection,
        INITIAL_MIGRATION_VERSION,
        INITIAL_MIGRATION_NAME,
    )?;
    apply_slot_migration(connection)?;
    apply_runtime_guard_migration(connection)?;
    record_migration_if_missing(connection, MIGRATION_VERSION, MIGRATION_NAME)?;

    Ok(())
}

fn apply_slot_migration(connection: &Connection) -> Result<(), String> {
    if migration_applied(connection, SLOT_MIGRATION_VERSION)? {
        return Ok(());
    }

    with_sqlite_lock_retry("Unable to initialize stable slot schema", || {
        connection.execute_batch(SLOT_SCHEMA_SQL)
    })?;
    ensure_column(connection, "agent_sessions", "agent_slot_id", "TEXT")?;
    ensure_column(connection, "leases", "agent_slot_id", "TEXT")?;
    ensure_column(
        connection,
        "lease_conflicts",
        "requested_by_slot_id",
        "TEXT",
    )?;
    ensure_column(connection, "events", "agent_slot_id", "TEXT")?;
    ensure_column(connection, "worktrees", "agent_slot_id", "TEXT")?;
    ensure_column(connection, "patches", "agent_slot_id", "TEXT")?;
    ensure_column(connection, "artifacts", "agent_slot_id", "TEXT")?;
    ensure_column(connection, "memories", "db_change_request_id", "TEXT")?;
    ensure_column(connection, "memories", "created_by_slot_id", "TEXT")?;
    record_migration_if_missing(connection, SLOT_MIGRATION_VERSION, SLOT_MIGRATION_NAME)
}

fn apply_runtime_guard_migration(connection: &Connection) -> Result<(), String> {
    if migration_applied(connection, RUNTIME_GUARD_MIGRATION_VERSION)? {
        return Ok(());
    }

    interrupt_duplicate_active_sessions_for_guard_indexes(connection)?;
    with_sqlite_lock_retry("Unable to initialize coordination runtime guards", || {
        connection.execute_batch(RUNTIME_GUARD_SCHEMA_SQL)
    })?;
    record_migration_if_missing(
        connection,
        RUNTIME_GUARD_MIGRATION_VERSION,
        RUNTIME_GUARD_MIGRATION_NAME,
    )
}

fn interrupt_duplicate_active_sessions_for_guard_indexes(
    connection: &Connection,
) -> Result<(), String> {
    let now = super::kernel::now_rfc3339();
    with_sqlite_lock_retry("Unable to normalize active slot sessions", || {
        connection.execute(
            "WITH ranked AS (
                SELECT id,
                       ROW_NUMBER() OVER (
                         PARTITION BY agent_slot_id
                         ORDER BY updated_at DESC, created_at DESC, id DESC
                       ) AS rank
                FROM agent_sessions
                WHERE status='active' AND agent_slot_id IS NOT NULL
             )
             UPDATE agent_sessions
             SET status='interrupted', updated_at=?1
             WHERE id IN (SELECT id FROM ranked WHERE rank > 1)",
            [&now],
        )
    })?;
    with_sqlite_lock_retry("Unable to normalize active PTY sessions", || {
        connection.execute(
            "WITH ranked AS (
                SELECT id,
                       ROW_NUMBER() OVER (
                         PARTITION BY pty_id
                         ORDER BY updated_at DESC, created_at DESC, id DESC
                       ) AS rank
                FROM agent_sessions
                WHERE status='active' AND pty_id IS NOT NULL AND pty_id <> ''
             )
             UPDATE agent_sessions
             SET status='interrupted', updated_at=?1
             WHERE id IN (SELECT id FROM ranked WHERE rank > 1)",
            [&now],
        )
    })?;
    Ok(())
}

fn migration_applied(connection: &Connection, version: i64) -> Result<bool, String> {
    let applied: i64 =
        with_sqlite_lock_retry("Unable to inspect coordination schema migrations", || {
            connection.query_row(
                "SELECT COUNT(1) FROM schema_migrations WHERE version = ?1",
                [version],
                |row| row.get(0),
            )
        })?;
    Ok(applied > 0)
}

fn record_migration_if_missing(
    connection: &Connection,
    version: i64,
    name: &str,
) -> Result<(), String> {
    if migration_applied(connection, version)? {
        return Ok(());
    }
    with_sqlite_lock_retry("Unable to record coordination schema migration", || {
        connection.execute(
            "INSERT INTO schema_migrations(version, name, applied_at) VALUES(?1, ?2, ?3)",
            rusqlite::params![version, name, super::kernel::now_rfc3339()],
        )
    })?;
    Ok(())
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("Unable to inspect {table} columns: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Unable to read {table} columns: {error}"))?;
    for row in rows {
        if row.map_err(|error| format!("Unable to read {table} column row: {error}"))? == column {
            return Ok(());
        }
    }

    with_sqlite_lock_retry("Unable to add coordination schema column", || {
        connection.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )
    })?;
    Ok(())
}

fn clean_stale_mcp_temp_files(mcp_root: &Path) -> Result<(), String> {
    for directory in [mcp_root.to_path_buf(), mcp_root.join("agents")] {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries {
            let entry = entry.map_err(|error| {
                format!(
                    "Unable to inspect MCP temp files in {}: {error}",
                    directory.display()
                )
            })?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) == Some("tmp") {
                fs::remove_file(&path).map_err(|error| {
                    format!(
                        "Unable to remove stale MCP temp file {}: {error}",
                        path.display()
                    )
                })?;
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(windows))]
    #[test]
    fn canonical_repo_path_rejects_filesystem_root() {
        let error = canonical_repo_path("/").unwrap_err();
        assert!(error.contains("filesystem root"));
    }
}

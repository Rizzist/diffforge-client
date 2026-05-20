use std::{
    fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, SystemTime},
};

use rusqlite::{Connection, Error as SqliteError, ErrorCode};
use serde_json::{json, Value};

use super::schema::{
    APPROVAL_SQL_ORCHESTRATION_MIGRATION_NAME, APPROVAL_SQL_ORCHESTRATION_MIGRATION_VERSION,
    CREATE_SCHEMA_SQL, DEPENDENCY_GRAPH_MIGRATION_NAME, DEPENDENCY_GRAPH_MIGRATION_VERSION,
    DEPENDENCY_GRAPH_SCHEMA_SQL, INITIAL_MIGRATION_NAME, INITIAL_MIGRATION_VERSION,
    INTEGRATOR_POLICY_MIGRATION_NAME, INTEGRATOR_POLICY_MIGRATION_VERSION, MIGRATION_NAME,
    MIGRATION_VERSION, RUNTIME_GUARD_MIGRATION_NAME, RUNTIME_GUARD_MIGRATION_VERSION,
    RUNTIME_GUARD_SCHEMA_SQL, SLOT_MIGRATION_NAME, SLOT_MIGRATION_VERSION, SLOT_SCHEMA_SQL,
    TASK_LIFECYCLE_MIGRATION_NAME, TASK_LIFECYCLE_MIGRATION_VERSION,
    TERMINAL_LAUNCH_EPOCH_MIGRATION_NAME, TERMINAL_LAUNCH_EPOCH_MIGRATION_VERSION,
};

pub const REPO_ID: &str = "local";

#[derive(Debug, Clone, Default)]
pub struct StorageEnsureDiagnostics {
    pub ensured_directories: Vec<String>,
    pub created_directories: Vec<String>,
    pub removed_mcp_temp_files: Vec<String>,
}

impl StorageEnsureDiagnostics {
    pub fn to_json(&self) -> Value {
        json!({
            "ensured_directories": self.ensured_directories,
            "created_directories": self.created_directories,
            "removed_mcp_temp_files": self.removed_mcp_temp_files,
            "ensured_directory_count": self.ensured_directories.len(),
            "created_directory_count": self.created_directories.len(),
            "removed_mcp_temp_file_count": self.removed_mcp_temp_files.len(),
        })
    }
}

#[derive(Debug, Clone)]
pub struct SchemaMigrationDiagnostics {
    pub version: i64,
    pub name: String,
    pub status: String,
    pub details: Vec<String>,
}

impl SchemaMigrationDiagnostics {
    fn new(version: i64, name: &str, status: &str, details: Vec<String>) -> Self {
        Self {
            version,
            name: name.to_string(),
            status: status.to_string(),
            details,
        }
    }

    pub fn to_json(&self) -> Value {
        json!({
            "version": self.version,
            "name": self.name,
            "status": self.status,
            "details": self.details,
        })
    }
}

#[derive(Debug, Clone)]
pub struct StorageOpenDiagnostics {
    pub db_path: String,
    pub db_existed: bool,
    pub busy_timeout_ms: i64,
    pub journal_mode: String,
    pub wal_enabled: bool,
    pub foreign_keys_enabled: bool,
    pub path_diagnostics: StorageEnsureDiagnostics,
    pub migrations: Vec<SchemaMigrationDiagnostics>,
}

impl StorageOpenDiagnostics {
    pub fn to_json(&self) -> Value {
        json!({
            "db_path": self.db_path,
            "db_existed": self.db_existed,
            "busy_timeout_ms": self.busy_timeout_ms,
            "journal_mode": self.journal_mode,
            "wal_enabled": self.wal_enabled,
            "foreign_keys_enabled": self.foreign_keys_enabled,
            "paths": self.path_diagnostics.to_json(),
            "migrations": self
                .migrations
                .iter()
                .map(SchemaMigrationDiagnostics::to_json)
                .collect::<Vec<_>>(),
        })
    }
}

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

    pub fn ensure(&self) -> Result<StorageEnsureDiagnostics, String> {
        let mut diagnostics = StorageEnsureDiagnostics::default();
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
            let existed = path.exists();
            fs::create_dir_all(path)
                .map_err(|error| format!("Unable to create {}: {error}", path.display()))?;
            diagnostics
                .ensured_directories
                .push(process_path_text(path));
            if !existed {
                diagnostics
                    .created_directories
                    .push(process_path_text(path));
            }
        }

        crate::ensure_workspace_agents_gitignore(&self.repo_path)?;
        diagnostics.removed_mcp_temp_files = clean_stale_mcp_temp_files(&self.mcp_root)?;

        Ok(diagnostics)
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

pub fn open_connection(
    paths: &StoragePaths,
) -> Result<(Connection, bool, StorageOpenDiagnostics), String> {
    let path_diagnostics = paths.ensure()?;
    let existed = paths.db_path.exists();
    let connection = Connection::open(&paths.db_path)
        .map_err(|error| format!("Unable to open {}: {error}", paths.db_path.display()))?;

    let busy_timeout_ms = 30_000;
    connection
        .busy_timeout(Duration::from_millis(busy_timeout_ms as u64))
        .map_err(|error| format!("Unable to set SQLite busy timeout: {error}"))?;

    with_sqlite_lock_retry("Unable to enable SQLite WAL mode", || {
        connection.pragma_update(None, "journal_mode", "WAL")
    })?;
    with_sqlite_lock_retry("Unable to enable SQLite foreign keys", || {
        connection.pragma_update(None, "foreign_keys", "ON")
    })?;
    let journal_mode: String =
        with_sqlite_lock_retry("Unable to inspect SQLite journal mode", || {
            connection.query_row("PRAGMA journal_mode", [], |row| row.get(0))
        })?;
    let foreign_keys_enabled: i64 =
        with_sqlite_lock_retry("Unable to inspect SQLite foreign key mode", || {
            connection.query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        })?;
    let migrations = run_migrations(&connection)?;
    let diagnostics = StorageOpenDiagnostics {
        db_path: process_path_text(&paths.db_path),
        db_existed: existed,
        busy_timeout_ms,
        journal_mode: journal_mode.clone(),
        wal_enabled: journal_mode.eq_ignore_ascii_case("wal"),
        foreign_keys_enabled: foreign_keys_enabled == 1,
        path_diagnostics,
        migrations,
    };

    Ok((connection, existed, diagnostics))
}

fn run_migrations(connection: &Connection) -> Result<Vec<SchemaMigrationDiagnostics>, String> {
    let mut diagnostics = Vec::new();
    with_sqlite_lock_retry("Unable to initialize coordination schema", || {
        connection.execute_batch(CREATE_SCHEMA_SQL)
    })?;
    diagnostics.push(SchemaMigrationDiagnostics::new(
        0,
        "coordination_schema_bootstrap",
        "ensured",
        vec!["CREATE_SCHEMA_SQL executed idempotently".to_string()],
    ));

    diagnostics.push(record_migration_if_missing(
        connection,
        INITIAL_MIGRATION_VERSION,
        INITIAL_MIGRATION_NAME,
    )?);
    diagnostics.push(apply_slot_migration(connection)?);
    diagnostics.push(apply_runtime_guard_migration(connection)?);
    if APPROVAL_SQL_ORCHESTRATION_MIGRATION_VERSION != RUNTIME_GUARD_MIGRATION_VERSION {
        diagnostics.push(record_migration_if_missing(
            connection,
            APPROVAL_SQL_ORCHESTRATION_MIGRATION_VERSION,
            APPROVAL_SQL_ORCHESTRATION_MIGRATION_NAME,
        )?);
    }
    if MIGRATION_VERSION != APPROVAL_SQL_ORCHESTRATION_MIGRATION_VERSION {
        diagnostics.push(record_migration_if_missing(
            connection,
            MIGRATION_VERSION,
            MIGRATION_NAME,
        )?);
    }
    diagnostics.push(apply_dependency_graph_migration(connection)?);
    diagnostics.push(apply_task_lifecycle_migration(connection)?);
    diagnostics.push(apply_integrator_policy_migration(connection)?);
    diagnostics.push(apply_terminal_launch_epoch_migration(connection)?);

    Ok(diagnostics)
}

fn apply_slot_migration(connection: &Connection) -> Result<SchemaMigrationDiagnostics, String> {
    if migration_applied(connection, SLOT_MIGRATION_VERSION)? {
        return Ok(SchemaMigrationDiagnostics::new(
            SLOT_MIGRATION_VERSION,
            SLOT_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        ));
    }

    with_sqlite_lock_retry("Unable to initialize stable slot schema", || {
        connection.execute_batch(SLOT_SCHEMA_SQL)
    })?;
    let mut details = vec!["SLOT_SCHEMA_SQL executed idempotently".to_string()];
    for (table, column, definition) in [
        ("agent_sessions", "agent_slot_id", "TEXT"),
        ("leases", "agent_slot_id", "TEXT"),
        ("lease_conflicts", "requested_by_slot_id", "TEXT"),
        ("events", "agent_slot_id", "TEXT"),
        ("worktrees", "agent_slot_id", "TEXT"),
        ("patches", "agent_slot_id", "TEXT"),
        ("artifacts", "agent_slot_id", "TEXT"),
        ("memories", "db_change_request_id", "TEXT"),
        ("memories", "created_by_slot_id", "TEXT"),
    ] {
        let added = ensure_column(connection, table, column, definition)?;
        details.push(format!(
            "{}.{} {}",
            table,
            column,
            if added { "added" } else { "already_present" }
        ));
    }
    let mut migration =
        record_migration_if_missing(connection, SLOT_MIGRATION_VERSION, SLOT_MIGRATION_NAME)?;
    migration.details.splice(0..0, details);
    Ok(migration)
}

fn apply_runtime_guard_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    if migration_applied(connection, RUNTIME_GUARD_MIGRATION_VERSION)? {
        return Ok(SchemaMigrationDiagnostics::new(
            RUNTIME_GUARD_MIGRATION_VERSION,
            RUNTIME_GUARD_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        ));
    }

    let (interrupted_slots, interrupted_ptys) =
        interrupt_duplicate_active_sessions_for_guard_indexes(connection)?;
    with_sqlite_lock_retry("Unable to initialize coordination runtime guards", || {
        connection.execute_batch(RUNTIME_GUARD_SCHEMA_SQL)
    })?;
    let mut migration = record_migration_if_missing(
        connection,
        RUNTIME_GUARD_MIGRATION_VERSION,
        RUNTIME_GUARD_MIGRATION_NAME,
    )?;
    migration.details.splice(
        0..0,
        [
            format!("duplicate_active_slot_sessions_interrupted={interrupted_slots}"),
            format!("duplicate_active_pty_sessions_interrupted={interrupted_ptys}"),
            "RUNTIME_GUARD_SCHEMA_SQL executed idempotently".to_string(),
        ],
    );
    Ok(migration)
}

fn interrupt_duplicate_active_sessions_for_guard_indexes(
    connection: &Connection,
) -> Result<(usize, usize), String> {
    let now = super::kernel::now_rfc3339();
    let interrupted_slots =
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
    let interrupted_ptys =
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
    Ok((interrupted_slots, interrupted_ptys))
}

fn apply_dependency_graph_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    if migration_applied(connection, DEPENDENCY_GRAPH_MIGRATION_VERSION)? {
        return Ok(SchemaMigrationDiagnostics::new(
            DEPENDENCY_GRAPH_MIGRATION_VERSION,
            DEPENDENCY_GRAPH_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        ));
    }

    with_sqlite_lock_retry(
        "Unable to initialize predicate dependency graph schema",
        || connection.execute_batch(DEPENDENCY_GRAPH_SCHEMA_SQL),
    )?;
    let mut migration = record_migration_if_missing(
        connection,
        DEPENDENCY_GRAPH_MIGRATION_VERSION,
        DEPENDENCY_GRAPH_MIGRATION_NAME,
    )?;
    migration.details.splice(
        0..0,
        ["DEPENDENCY_GRAPH_SCHEMA_SQL executed idempotently".to_string()],
    );
    Ok(migration)
}

fn apply_task_lifecycle_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    if migration_applied(connection, TASK_LIFECYCLE_MIGRATION_VERSION)? {
        return Ok(SchemaMigrationDiagnostics::new(
            TASK_LIFECYCLE_MIGRATION_VERSION,
            TASK_LIFECYCLE_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        ));
    }

    let mut details = Vec::new();
    for (table, column, definition) in [
        ("tasks", "started_at", "TEXT"),
        ("tasks", "finished_at", "TEXT"),
    ] {
        let added = ensure_column(connection, table, column, definition)?;
        details.push(format!(
            "{}.{} {}",
            table,
            column,
            if added { "added" } else { "already_present" }
        ));
    }
    let mut migration = record_migration_if_missing(
        connection,
        TASK_LIFECYCLE_MIGRATION_VERSION,
        TASK_LIFECYCLE_MIGRATION_NAME,
    )?;
    migration.details.splice(0..0, details);
    Ok(migration)
}

fn apply_integrator_policy_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    if migration_applied(connection, INTEGRATOR_POLICY_MIGRATION_VERSION)? {
        return Ok(SchemaMigrationDiagnostics::new(
            INTEGRATOR_POLICY_MIGRATION_VERSION,
            INTEGRATOR_POLICY_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        ));
    }

    let mut details = Vec::new();
    for (table, column, definition) in [
        (
            "repo_policies",
            "integrator_enabled",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "repo_policies",
            "integrator_agent_id",
            "TEXT NOT NULL DEFAULT 'codex'",
        ),
        (
            "repo_policies",
            "integrator_model",
            "TEXT NOT NULL DEFAULT 'gpt-5.5'",
        ),
        (
            "repo_policies",
            "integrator_reasoning_effort",
            "TEXT NOT NULL DEFAULT 'xhigh'",
        ),
    ] {
        let added = ensure_column(connection, table, column, definition)?;
        details.push(format!(
            "{}.{} {}",
            table,
            column,
            if added { "added" } else { "already_present" }
        ));
    }
    let mut migration = record_migration_if_missing(
        connection,
        INTEGRATOR_POLICY_MIGRATION_VERSION,
        INTEGRATOR_POLICY_MIGRATION_NAME,
    )?;
    migration.details.splice(0..0, details);
    Ok(migration)
}

fn apply_terminal_launch_epoch_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    if migration_applied(connection, TERMINAL_LAUNCH_EPOCH_MIGRATION_VERSION)? {
        return Ok(SchemaMigrationDiagnostics::new(
            TERMINAL_LAUNCH_EPOCH_MIGRATION_VERSION,
            TERMINAL_LAUNCH_EPOCH_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        ));
    }

    let mut details = Vec::new();
    let added = ensure_column(
        connection,
        "agent_sessions",
        "terminal_launch_epoch",
        "TEXT",
    )?;
    details.push(format!(
        "agent_sessions.terminal_launch_epoch {}",
        if added { "added" } else { "already_present" }
    ));
    let mut migration = record_migration_if_missing(
        connection,
        TERMINAL_LAUNCH_EPOCH_MIGRATION_VERSION,
        TERMINAL_LAUNCH_EPOCH_MIGRATION_NAME,
    )?;
    migration.details.splice(0..0, details);
    Ok(migration)
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
) -> Result<SchemaMigrationDiagnostics, String> {
    if migration_applied(connection, version)? {
        return Ok(SchemaMigrationDiagnostics::new(
            version,
            name,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        ));
    }
    with_sqlite_lock_retry("Unable to record coordination schema migration", || {
        connection.execute(
            "INSERT INTO schema_migrations(version, name, applied_at) VALUES(?1, ?2, ?3)",
            rusqlite::params![version, name, super::kernel::now_rfc3339()],
        )
    })?;
    Ok(SchemaMigrationDiagnostics::new(
        version,
        name,
        "applied",
        vec!["schema_migrations row inserted".to_string()],
    ))
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("Unable to inspect {table} columns: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Unable to read {table} columns: {error}"))?;
    for row in rows {
        if row.map_err(|error| format!("Unable to read {table} column row: {error}"))? == column {
            return Ok(false);
        }
    }

    with_sqlite_lock_retry("Unable to add coordination schema column", || {
        connection.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )
    })?;
    Ok(true)
}

fn clean_stale_mcp_temp_files(mcp_root: &Path) -> Result<Vec<String>, String> {
    const MCP_TEMP_FILE_STALE_AFTER: Duration = Duration::from_secs(10 * 60);

    let mut removed = Vec::new();
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
                let modified_at = entry
                    .metadata()
                    .and_then(|metadata| metadata.modified())
                    .map_err(|error| {
                        format!(
                            "Unable to inspect MCP temp file {} metadata: {error}",
                            path.display()
                        )
                    })?;
                let age = SystemTime::now()
                    .duration_since(modified_at)
                    .unwrap_or_else(|_| Duration::from_secs(0));
                if age < MCP_TEMP_FILE_STALE_AFTER {
                    continue;
                }
                fs::remove_file(&path).map_err(|error| {
                    format!(
                        "Unable to remove stale MCP temp file {}: {error}",
                        path.display()
                    )
                })?;
                removed.push(process_path_text(&path));
            }
        }
    }
    Ok(removed)
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
    #[cfg(not(windows))]
    use super::*;
    #[cfg(not(windows))]
    use std::fs;

    #[cfg(not(windows))]
    #[test]
    fn canonical_repo_path_rejects_filesystem_root() {
        let error = canonical_repo_path("/").unwrap_err();
        assert!(error.contains("filesystem root"));
    }

    #[cfg(not(windows))]
    #[test]
    fn mcp_temp_cleanup_leaves_fresh_temp_files_alone() {
        let root = std::env::temp_dir().join(format!(
            "diffforge_mcp_temp_cleanup_{}",
            SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let agents = root.join("agents");
        fs::create_dir_all(&agents).unwrap();
        let root_temp = root.join("coordination.codex.toml.123.fresh.tmp");
        let agent_temp = agents.join("agent.json.123.fresh.tmp");
        fs::write(&root_temp, "active").unwrap();
        fs::write(&agent_temp, "active").unwrap();

        let removed = clean_stale_mcp_temp_files(&root).unwrap();

        assert!(removed.is_empty());
        assert!(root_temp.exists());
        assert!(agent_temp.exists());
        fs::remove_dir_all(root).unwrap();
    }
}

use std::{
    env, fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
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
    SUBMIT_JOB_MIGRATION_NAME, SUBMIT_JOB_MIGRATION_VERSION, SUBMIT_JOB_SCHEMA_SQL,
    TASK_LIFECYCLE_MIGRATION_NAME, TASK_LIFECYCLE_MIGRATION_VERSION,
    TASK_SOURCE_TODO_REFS_MIGRATION_NAME, TASK_SOURCE_TODO_REFS_MIGRATION_VERSION,
    TERMINAL_LAUNCH_EPOCH_MIGRATION_NAME, TERMINAL_LAUNCH_EPOCH_MIGRATION_VERSION,
    TERMINAL_TASK_PLAN_MIGRATION_NAME, TERMINAL_TASK_PLAN_MIGRATION_VERSION,
    TERMINAL_TASK_PLAN_SCHEMA_SQL, WORKSPACE_MCP_AGENT_CONFIG_ACCESS_MIGRATION_NAME,
    WORKSPACE_MCP_AGENT_CONFIG_ACCESS_MIGRATION_VERSION,
    WORKSPACE_MCP_APPROVAL_POLICY_MIGRATION_NAME, WORKSPACE_MCP_APPROVAL_POLICY_MIGRATION_VERSION,
    WORKSPACE_MCP_EXPOSURE_MODE_MIGRATION_NAME, WORKSPACE_MCP_EXPOSURE_MODE_MIGRATION_VERSION,
    WORKSPACE_MCP_INDEX_MIGRATION_NAME, WORKSPACE_MCP_INDEX_MIGRATION_VERSION,
    WORKSPACE_MCP_INDEX_SCHEMA_SQL, WORKSPACE_MCP_REGISTRY_MIGRATION_NAME,
    WORKSPACE_MCP_REGISTRY_MIGRATION_VERSION, WORKSPACE_MCP_REGISTRY_SCHEMA_SQL,
    WORKSPACE_MCP_SECRETS_MIGRATION_NAME, WORKSPACE_MCP_SECRETS_MIGRATION_VERSION,
    WORKSPACE_MCP_SECRETS_SCHEMA_SQL, WORKTREE_TASK_BINDING_MIGRATION_NAME,
    WORKTREE_TASK_BINDING_MIGRATION_VERSION,
};

pub const REPO_ID: &str = "local";
const INITIALIZED_KERNELS_REGISTRY_FILE: &str = "initialized-kernels.json";

#[derive(Debug, Clone, Default)]
pub struct StorageEnsureDiagnostics {
    pub ensured_directories: Vec<String>,
    pub created_directories: Vec<String>,
    pub migrated_private_state_paths: Vec<String>,
    pub removed_mcp_temp_files: Vec<String>,
}

impl StorageEnsureDiagnostics {
    pub fn to_json(&self) -> Value {
        json!({
            "ensured_directories": self.ensured_directories,
            "created_directories": self.created_directories,
            "migrated_private_state_paths": self.migrated_private_state_paths,
            "removed_mcp_temp_files": self.removed_mcp_temp_files,
            "ensured_directory_count": self.ensured_directories.len(),
            "created_directory_count": self.created_directories.len(),
            "migrated_private_state_path_count": self.migrated_private_state_paths.len(),
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

#[derive(Debug, Clone)]
pub struct RememberedKernelStorage {
    pub repo_path: PathBuf,
    pub db_path: PathBuf,
}

impl StoragePaths {
    pub fn new(repo_path: PathBuf, db_path: Option<PathBuf>) -> Self {
        let agents_root = repo_path.join(".agents");
        let worktrees_root = agents_root.join("worktrees");
        Self {
            db_path: db_path.unwrap_or_else(|| agents_root.join("kernel.sqlite")),
            artifacts_root: agents_root.join("artifacts"),
            memory_root: agents_root.join("memory"),
            worktrees_root,
            mcp_root: agents_root.join("mcp"),
            cloud_root: agents_root.join("cloud"),
            agents_root,
            repo_path,
        }
    }

    pub fn ensure(&self) -> Result<StorageEnsureDiagnostics, String> {
        let mut diagnostics = StorageEnsureDiagnostics::default();
        diagnostics.migrated_private_state_paths = migrate_legacy_private_state(self)?;
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

fn migrate_legacy_private_state(paths: &StoragePaths) -> Result<Vec<String>, String> {
    let default_visible_db_path = paths.agents_root.join("kernel.sqlite");
    if process_path_text(&paths.db_path) != process_path_text(&default_visible_db_path) {
        return Ok(Vec::new());
    }
    if paths.db_path.exists() {
        return Ok(Vec::new());
    }

    let legacy_root = coordination_repo_state_root(&paths.repo_path);
    if process_path_text(&legacy_root) == process_path_text(&paths.agents_root) {
        return Ok(Vec::new());
    }

    let legacy_db_path = legacy_root.join("kernel.sqlite");
    if !legacy_db_path.exists() {
        return Ok(Vec::new());
    }

    fs::create_dir_all(&paths.agents_root).map_err(|error| {
        format!(
            "Unable to create visible coordination root {}: {error}",
            paths.agents_root.display()
        )
    })?;

    let mut migrated = Vec::new();
    for name in [
        "kernel.sqlite",
        "kernel.sqlite-wal",
        "kernel.sqlite-shm",
        "artifacts",
        "memory",
        "mcp",
        "cloud",
        "db",
    ] {
        let source = legacy_root.join(name);
        if !source.exists() {
            continue;
        }
        copy_legacy_private_state_path(&source, &paths.agents_root.join(name), &mut migrated)?;
    }

    Ok(migrated)
}

fn copy_legacy_private_state_path(
    source: &Path,
    destination: &Path,
    migrated: &mut Vec<String>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| {
        format!(
            "Unable to inspect legacy coordination state {}: {error}",
            source.display()
        )
    })?;

    if metadata.file_type().is_symlink() {
        return Ok(());
    }

    if metadata.is_dir() {
        fs::create_dir_all(destination).map_err(|error| {
            format!(
                "Unable to create migrated coordination directory {}: {error}",
                destination.display()
            )
        })?;
        for entry in fs::read_dir(source).map_err(|error| {
            format!(
                "Unable to read legacy coordination directory {}: {error}",
                source.display()
            )
        })? {
            let entry = entry.map_err(|error| {
                format!(
                    "Unable to read legacy coordination directory entry {}: {error}",
                    source.display()
                )
            })?;
            copy_legacy_private_state_path(
                &entry.path(),
                &destination.join(entry.file_name()),
                migrated,
            )?;
        }
        return Ok(());
    }

    if !metadata.is_file() || destination.exists() {
        return Ok(());
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Unable to create migrated coordination parent {}: {error}",
                parent.display()
            )
        })?;
    }
    fs::copy(source, destination).map_err(|error| {
        format!(
            "Unable to migrate coordination state from {} to {}: {error}",
            source.display(),
            destination.display()
        )
    })?;
    migrated.push(process_path_text(destination));
    Ok(())
}

pub fn coordination_repo_state_root(repo_path: &Path) -> PathBuf {
    coordination_private_state_root()
        .join("repos")
        .join(coordination_repo_state_id(repo_path))
}

pub fn coordination_daemon_info_path(repo_path: &Path) -> PathBuf {
    coordination_repo_state_root(repo_path)
        .join("mcp")
        .join("coordination.daemon.json")
}

fn coordination_private_state_root() -> PathBuf {
    if let Some(path) = env::var_os("DIFFFORGE_COORDINATION_STATE_ROOT").map(PathBuf::from) {
        return path;
    }
    if cfg!(test) {
        return env::temp_dir().join("diffforge-test-coordination");
    }
    if cfg!(target_os = "macos") {
        if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
            return home
                .join("Library")
                .join("Application Support")
                .join("Diff Forge AI")
                .join("coordination");
        }
    }
    if cfg!(windows) {
        if let Some(app_data) = env::var_os("APPDATA").map(PathBuf::from) {
            return app_data.join("Diff Forge AI").join("coordination");
        }
    }
    if let Some(data_home) = env::var_os("XDG_DATA_HOME").map(PathBuf::from) {
        return data_home.join("diffforge").join("coordination");
    }
    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        return home
            .join(".local")
            .join("share")
            .join("diffforge")
            .join("coordination");
    }
    env::temp_dir().join("diffforge").join("coordination")
}

fn initialized_kernels_registry_path() -> PathBuf {
    coordination_private_state_root().join(INITIALIZED_KERNELS_REGISTRY_FILE)
}

fn initialized_kernel_registry_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn read_initialized_kernel_registry_entries(path: &Path) -> Result<Vec<Value>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let text = fs::read_to_string(path)
        .map_err(|error| format!("Unable to read initialized kernel registry: {error}"))?;
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }

    let parsed = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!([]));
    Ok(parsed.as_array().cloned().unwrap_or_default())
}

pub fn remember_initialized_kernel_storage(paths: &StoragePaths) -> Result<(), String> {
    let registry_path = initialized_kernels_registry_path();
    if let Some(parent) = registry_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Unable to create initialized kernel registry directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let repo_path = process_path_text(&paths.repo_path);
    let db_path = process_path_text(&paths.db_path);
    let mut entries = read_initialized_kernel_registry_entries(&registry_path)?;
    entries.retain(|entry| {
        entry
            .get("db_path")
            .and_then(Value::as_str)
            .map(|value| value != db_path)
            .unwrap_or(true)
    });
    entries.push(json!({
        "repo_path": repo_path,
        "db_path": db_path,
        "updated_at_ms": initialized_kernel_registry_now_ms(),
    }));
    if entries.len() > 256 {
        entries.drain(0..entries.len() - 256);
    }

    let text = serde_json::to_string_pretty(&entries)
        .map_err(|error| format!("Unable to serialize initialized kernel registry: {error}"))?;
    fs::write(&registry_path, text).map_err(|error| {
        format!(
            "Unable to write initialized kernel registry {}: {error}",
            registry_path.display()
        )
    })?;
    Ok(())
}

pub fn remembered_initialized_kernel_storages() -> Result<Vec<RememberedKernelStorage>, String> {
    let registry_path = initialized_kernels_registry_path();
    let entries = read_initialized_kernel_registry_entries(&registry_path)?;
    let mut storages = Vec::new();
    let mut seen_db_paths = Vec::new();

    for entry in entries {
        let Some(repo_path) = entry
            .get("repo_path")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(db_path) = entry
            .get("db_path")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if seen_db_paths.iter().any(|seen| seen == db_path) {
            continue;
        }
        seen_db_paths.push(db_path.to_string());
        storages.push(RememberedKernelStorage {
            repo_path: PathBuf::from(repo_path),
            db_path: PathBuf::from(db_path),
        });
    }

    Ok(storages)
}

fn coordination_repo_state_id(repo_path: &Path) -> String {
    let path_text = process_path_text(repo_path);
    let name = repo_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("workspace")
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let mut hash = 0xcbf29ce484222325u64;
    for byte in path_text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    let slug = if name.is_empty() { "workspace" } else { &name };
    format!("{slug}-{hash:016x}")
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
    diagnostics.push(apply_submit_job_migration(connection)?);
    diagnostics.push(apply_workspace_mcp_registry_migration(connection)?);
    diagnostics.push(apply_workspace_mcp_index_migration(connection)?);
    diagnostics.push(apply_workspace_mcp_approval_policy_migration(connection)?);
    diagnostics.push(apply_workspace_mcp_agent_config_access_migration(
        connection,
    )?);
    diagnostics.push(apply_worktree_task_binding_migration(connection)?);
    diagnostics.push(apply_terminal_task_plan_migration(connection)?);
    diagnostics.push(apply_task_source_todo_refs_migration(connection)?);
    diagnostics.push(apply_workspace_mcp_secrets_migration(connection)?);
    diagnostics.push(apply_workspace_mcp_exposure_mode_migration(connection)?);

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

fn apply_submit_job_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    if migration_applied(connection, SUBMIT_JOB_MIGRATION_VERSION)? {
        return Ok(SchemaMigrationDiagnostics::new(
            SUBMIT_JOB_MIGRATION_VERSION,
            SUBMIT_JOB_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        ));
    }

    with_sqlite_lock_retry("Unable to initialize async submit job schema", || {
        connection.execute_batch(SUBMIT_JOB_SCHEMA_SQL)
    })?;
    let mut migration = record_migration_if_missing(
        connection,
        SUBMIT_JOB_MIGRATION_VERSION,
        SUBMIT_JOB_MIGRATION_NAME,
    )?;
    migration.details.splice(
        0..0,
        ["SUBMIT_JOB_SCHEMA_SQL executed idempotently".to_string()],
    );
    Ok(migration)
}

fn apply_workspace_mcp_registry_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    if migration_applied(connection, WORKSPACE_MCP_REGISTRY_MIGRATION_VERSION)? {
        return Ok(SchemaMigrationDiagnostics::new(
            WORKSPACE_MCP_REGISTRY_MIGRATION_VERSION,
            WORKSPACE_MCP_REGISTRY_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        ));
    }

    with_sqlite_lock_retry("Unable to initialize workspace MCP registry schema", || {
        connection.execute_batch(WORKSPACE_MCP_REGISTRY_SCHEMA_SQL)
    })?;
    let mut migration = record_migration_if_missing(
        connection,
        WORKSPACE_MCP_REGISTRY_MIGRATION_VERSION,
        WORKSPACE_MCP_REGISTRY_MIGRATION_NAME,
    )?;
    migration.details.splice(
        0..0,
        ["WORKSPACE_MCP_REGISTRY_SCHEMA_SQL executed idempotently".to_string()],
    );
    Ok(migration)
}

fn apply_workspace_mcp_index_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    if migration_applied(connection, WORKSPACE_MCP_INDEX_MIGRATION_VERSION)? {
        return Ok(SchemaMigrationDiagnostics::new(
            WORKSPACE_MCP_INDEX_MIGRATION_VERSION,
            WORKSPACE_MCP_INDEX_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        ));
    }

    with_sqlite_lock_retry("Unable to initialize workspace MCP index schema", || {
        connection.execute_batch(WORKSPACE_MCP_INDEX_SCHEMA_SQL)
    })?;
    let mut migration = record_migration_if_missing(
        connection,
        WORKSPACE_MCP_INDEX_MIGRATION_VERSION,
        WORKSPACE_MCP_INDEX_MIGRATION_NAME,
    )?;
    migration.details.splice(
        0..0,
        ["WORKSPACE_MCP_INDEX_SCHEMA_SQL executed idempotently".to_string()],
    );
    Ok(migration)
}

fn apply_workspace_mcp_approval_policy_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    if migration_applied(connection, WORKSPACE_MCP_APPROVAL_POLICY_MIGRATION_VERSION)? {
        return Ok(SchemaMigrationDiagnostics::new(
            WORKSPACE_MCP_APPROVAL_POLICY_MIGRATION_VERSION,
            WORKSPACE_MCP_APPROVAL_POLICY_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        ));
    }

    let added = ensure_column(
        connection,
        "workspace_mcp_servers",
        "approval_policy",
        "TEXT NOT NULL DEFAULT 'always_allow'",
    )?;
    let mut migration = record_migration_if_missing(
        connection,
        WORKSPACE_MCP_APPROVAL_POLICY_MIGRATION_VERSION,
        WORKSPACE_MCP_APPROVAL_POLICY_MIGRATION_NAME,
    )?;
    migration.details.splice(
        0..0,
        [format!(
            "workspace_mcp_servers.approval_policy {}",
            if added { "added" } else { "already_present" }
        )],
    );
    Ok(migration)
}

fn apply_workspace_mcp_agent_config_access_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    if migration_applied(
        connection,
        WORKSPACE_MCP_AGENT_CONFIG_ACCESS_MIGRATION_VERSION,
    )? {
        return Ok(SchemaMigrationDiagnostics::new(
            WORKSPACE_MCP_AGENT_CONFIG_ACCESS_MIGRATION_VERSION,
            WORKSPACE_MCP_AGENT_CONFIG_ACCESS_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        ));
    }

    let columns = [
        ("agent_config_access_enabled", "INTEGER NOT NULL DEFAULT 1"),
        (
            "agent_secret_config_access_enabled",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        ("agent_env_file_write_enabled", "INTEGER NOT NULL DEFAULT 1"),
    ];
    let mut details = Vec::new();
    for (column, definition) in columns {
        let added = ensure_column(connection, "workspace_mcp_servers", column, definition)?;
        details.push(format!(
            "workspace_mcp_servers.{column} {}",
            if added { "added" } else { "already_present" }
        ));
    }
    let mut migration = record_migration_if_missing(
        connection,
        WORKSPACE_MCP_AGENT_CONFIG_ACCESS_MIGRATION_VERSION,
        WORKSPACE_MCP_AGENT_CONFIG_ACCESS_MIGRATION_NAME,
    )?;
    migration.details.splice(0..0, details);
    Ok(migration)
}

fn apply_workspace_mcp_exposure_mode_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    if migration_applied(connection, WORKSPACE_MCP_EXPOSURE_MODE_MIGRATION_VERSION)? {
        return Ok(SchemaMigrationDiagnostics::new(
            WORKSPACE_MCP_EXPOSURE_MODE_MIGRATION_VERSION,
            WORKSPACE_MCP_EXPOSURE_MODE_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        ));
    }

    with_sqlite_lock_retry("Unable to initialize workspace MCP registry schema", || {
        connection.execute_batch(WORKSPACE_MCP_REGISTRY_SCHEMA_SQL)
    })?;
    let added = ensure_column(
        connection,
        "workspace_mcp_servers",
        "exposure_mode",
        "TEXT NOT NULL DEFAULT 'lazy'",
    )?;
    let mut migration = record_migration_if_missing(
        connection,
        WORKSPACE_MCP_EXPOSURE_MODE_MIGRATION_VERSION,
        WORKSPACE_MCP_EXPOSURE_MODE_MIGRATION_NAME,
    )?;
    migration.details.splice(
        0..0,
        [
            "WORKSPACE_MCP_REGISTRY_SCHEMA_SQL executed idempotently".to_string(),
            format!(
                "workspace_mcp_servers.exposure_mode {}",
                if added { "added" } else { "already_present" }
            ),
        ],
    );
    Ok(migration)
}

fn apply_worktree_task_binding_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    let added = ensure_column(connection, "worktrees", "task_id", "TEXT")?;
    with_sqlite_lock_retry("Unable to initialize worktree task index", || {
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_worktrees_task ON worktrees(task_id, status, updated_at)",
            [],
        )
    })?;
    let mut migration = if migration_applied(connection, WORKTREE_TASK_BINDING_MIGRATION_VERSION)? {
        SchemaMigrationDiagnostics::new(
            WORKTREE_TASK_BINDING_MIGRATION_VERSION,
            WORKTREE_TASK_BINDING_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        )
    } else {
        record_migration_if_missing(
            connection,
            WORKTREE_TASK_BINDING_MIGRATION_VERSION,
            WORKTREE_TASK_BINDING_MIGRATION_NAME,
        )?
    };
    migration.details.splice(
        0..0,
        [
            format!(
                "worktrees.task_id {}",
                if added { "added" } else { "already_present" }
            ),
            "idx_worktrees_task ensured".to_string(),
        ],
    );
    Ok(migration)
}

fn apply_terminal_task_plan_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    with_sqlite_lock_retry("Unable to initialize terminal task plan schema", || {
        connection.execute_batch(TERMINAL_TASK_PLAN_SCHEMA_SQL)
    })?;
    let mut migration = if migration_applied(connection, TERMINAL_TASK_PLAN_MIGRATION_VERSION)? {
        SchemaMigrationDiagnostics::new(
            TERMINAL_TASK_PLAN_MIGRATION_VERSION,
            TERMINAL_TASK_PLAN_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        )
    } else {
        record_migration_if_missing(
            connection,
            TERMINAL_TASK_PLAN_MIGRATION_VERSION,
            TERMINAL_TASK_PLAN_MIGRATION_NAME,
        )?
    };
    migration.details.splice(
        0..0,
        ["TERMINAL_TASK_PLAN_SCHEMA_SQL executed idempotently".to_string()],
    );
    Ok(migration)
}

fn apply_task_source_todo_refs_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    let mut details = Vec::new();
    for (column, definition) in [
        ("source_todo_id", "TEXT"),
        ("source_todo_dispatch_id", "TEXT"),
        ("source_prompt_event_id", "TEXT"),
        ("source_command_id", "TEXT"),
    ] {
        let added = ensure_column(connection, "tasks", column, definition)?;
        details.push(format!(
            "tasks.{column} {}",
            if added { "added" } else { "already_present" }
        ));
    }
    with_sqlite_lock_retry("Unable to initialize task source todo indexes", || {
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_tasks_source_todo ON tasks(source_todo_id, updated_at)",
            [],
        )
    })?;
    details.push("idx_tasks_source_todo ensured".to_string());
    let mut migration = if migration_applied(connection, TASK_SOURCE_TODO_REFS_MIGRATION_VERSION)? {
        SchemaMigrationDiagnostics::new(
            TASK_SOURCE_TODO_REFS_MIGRATION_VERSION,
            TASK_SOURCE_TODO_REFS_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        )
    } else {
        record_migration_if_missing(
            connection,
            TASK_SOURCE_TODO_REFS_MIGRATION_VERSION,
            TASK_SOURCE_TODO_REFS_MIGRATION_NAME,
        )?
    };
    migration.details.splice(0..0, details);
    Ok(migration)
}

fn apply_workspace_mcp_secrets_migration(
    connection: &Connection,
) -> Result<SchemaMigrationDiagnostics, String> {
    if migration_applied(connection, WORKSPACE_MCP_SECRETS_MIGRATION_VERSION)? {
        return Ok(SchemaMigrationDiagnostics::new(
            WORKSPACE_MCP_SECRETS_MIGRATION_VERSION,
            WORKSPACE_MCP_SECRETS_MIGRATION_NAME,
            "already_applied",
            vec!["schema_migrations row already exists".to_string()],
        ));
    }

    with_sqlite_lock_retry("Unable to initialize workspace MCP secrets schema", || {
        connection.execute_batch(WORKSPACE_MCP_SECRETS_SCHEMA_SQL)
    })?;
    let mut migration = record_migration_if_missing(
        connection,
        WORKSPACE_MCP_SECRETS_MIGRATION_VERSION,
        WORKSPACE_MCP_SECRETS_MIGRATION_NAME,
    )?;
    migration.details.splice(
        0..0,
        ["WORKSPACE_MCP_SECRETS_SCHEMA_SQL executed idempotently".to_string()],
    );
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
    use super::*;
    use std::fs;

    fn temp_repo(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "diffforge_db_test_{name}_{}",
            SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[cfg(not(windows))]
    #[test]
    fn canonical_repo_path_rejects_filesystem_root() {
        let error = canonical_repo_path("/").unwrap_err();
        assert!(error.contains("filesystem root"));
    }

    #[test]
    fn mcp_temp_cleanup_leaves_fresh_temp_files_alone() {
        let root = temp_repo("mcp_temp_cleanup");
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

    #[test]
    fn old_worktrees_schema_without_task_id_migrates_to_v15() {
        let repo = temp_repo("worktrees_task_id_migration");
        let paths = StoragePaths::new(repo.clone(), None);
        fs::create_dir_all(paths.db_path.parent().unwrap()).unwrap();
        let legacy = Connection::open(&paths.db_path).unwrap();
        legacy
            .execute_batch(
                r#"
                CREATE TABLE schema_migrations(
                  version INTEGER PRIMARY KEY,
                  name TEXT NOT NULL,
                  applied_at TEXT NOT NULL
                );
                CREATE TABLE worktrees(
                  id TEXT PRIMARY KEY,
                  agent_slot_id TEXT,
                  agent_id TEXT NOT NULL,
                  session_id TEXT,
                  path TEXT NOT NULL,
                  branch_name TEXT NOT NULL,
                  base_sha TEXT NOT NULL,
                  current_sha TEXT,
                  status TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                "#,
            )
            .unwrap();
        for version in 1..WORKTREE_TASK_BINDING_MIGRATION_VERSION {
            legacy
                .execute(
                    "INSERT INTO schema_migrations(version, name, applied_at) VALUES(?1, ?2, 'legacy')",
                    rusqlite::params![version, format!("legacy_{version}")],
                )
                .unwrap();
        }
        drop(legacy);

        let (connection, existed, _diagnostics) = open_connection(&paths).unwrap();

        assert!(existed);
        let columns = connection
            .prepare("PRAGMA table_info(worktrees)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(columns.iter().any(|column| column == "task_id"));

        let indexes = connection
            .prepare("PRAGMA index_list(worktrees)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(indexes.iter().any(|index| index == "idx_worktrees_task"));

        let migration_count: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM schema_migrations WHERE version=?1",
                [WORKTREE_TASK_BINDING_MIGRATION_VERSION],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(migration_count, 1);

        drop(connection);
        let _ = fs::remove_dir_all(paths.agents_root);
        let _ = fs::remove_dir_all(repo);
    }
}

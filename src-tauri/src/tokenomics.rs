const TOKENOMICS_DB_FILE: &str = "tokenomics.sqlite3";
const TOKENOMICS_SYNC_ROLLUP_LIMIT: usize = 5000;
const TOKENOMICS_PROVIDER_LIMIT_SAMPLE_SYNC_LIMIT: usize = 2048;
const TOKENOMICS_PROVIDER_LIMIT_SAMPLE_BUCKET_SECS: u64 = 15 * 60;
const TOKENOMICS_PROVIDER_LIMIT_SAMPLE_5H_RETENTION_SECS: u64 = 48 * 60 * 60;
const TOKENOMICS_PROVIDER_LIMIT_SAMPLE_WEEKLY_RETENTION_SECS: u64 = 45 * 24 * 60 * 60;
const TOKENOMICS_USAGE_EVENT_RETENTION_DAYS: u64 = 14;
const TOKENOMICS_USAGE_EVENT_PRUNE_CHUNK_ROWS: usize = 5_000;
const TOKENOMICS_USAGE_EVENT_PRUNE_INTERVAL_SECS: u64 = 24 * 60 * 60;
const TOKENOMICS_USAGE_EVENT_VACUUM_MIN_DELETED_ROWS: usize = 50_000;
const TOKENOMICS_USAGE_EVENT_VACUUM_MIN_DB_BYTES: u64 = 200 * 1024 * 1024;
const TOKENOMICS_USAGE_EVENT_VACUUM_STARTUP_GRACE_SECS: u64 = 3 * 60;
const TOKENOMICS_SQLITE_BUSY_TIMEOUT_MS: u64 = 30_000;
const TOKENOMICS_LEGACY_CODEX_SCANNER_VERSION: &str = "codex-token-count-v8-uncached-input-30d";
const TOKENOMICS_LEGACY_GENERIC_SCANNER_VERSION: &str = "generic-tokenomics-v7-large-jsonl-30d";
const TOKENOMICS_ROLLUP_ID_VERSION: &str = "tokenomics-v2-utc-hour-rollups-v2";
const TOKENOMICS_CODEX_IMPORT_LEDGER_REPAIR_VERSION: &str = "codex-import-ledger-orphan-prune-v1";
const TOKENOMICS_CODEX_UNCACHED_INPUT_VERSION: &str = "codex-uncached-input-v1";
const TOKENOMICS_PROVIDER_API_PRICING_VERSION: &str = "claude-api-pricing-v1";
const TOKENOMICS_PRUNED_ROLLUP_REKEY_VERSION: &str = "pruned-rollup-rekey-v2-atomic";
const TOKENOMICS_FINALIZATION_SETTLEMENT_SECS: u64 = 48 * 60 * 60;
const TOKENOMICS_UNKNOWN_OFFSET_COVERAGE_START_UNIX: u64 = i64::MAX as u64;
const TOKENOMICS_CODEX_USAGE_CACHE_KEY_PREFIX: &str = "codex_usage_api_cache:";
const TOKENOMICS_CODEX_USAGE_CACHE_TTL_SECS: u64 = 5 * 60;
const TOKENOMICS_CODEX_USAGE_CACHE_STALE_SECS: u64 = 7 * 24 * 60 * 60;
const TOKENOMICS_SUMMARY_CACHE_TTL_MS: u64 = 5 * 60 * 1000;
const TOKENOMICS_LIVE_LIMITS_CACHE_TTL_MS: u64 = 60_000;
const TOKENOMICS_PERIODIC_SAMPLE_INTERVAL_MS: u64 = 15 * 60 * 1000;
const TOKENOMICS_SUMMARY_SNAPSHOT_CACHE_KEY_PREFIX: &str = "summary_snapshot_cache:";
const TOKENOMICS_UPDATED_EVENT: &str = "diffforge://tokenomics-updated";
const TOKENOMICS_LOCAL_DEVICE_ALIASES_KEY: &str = "local_device_aliases";
const TOKENOMICS_CLOUD_PROVIDER_LIMITS_KEY: &str = "cloud_provider_limits";
const TOKENOMICS_USAGE_EVENT_PRUNE_LAST_CHECKED_META_KEY: &str =
    "usage_event_prune_last_checked_unix_v1";
const TOKENOMICS_USAGE_EVENT_PRUNE_VACUUM_DONE_META_KEY: &str = "usage_event_prune_vacuum_done_v1";
const TOKENOMICS_USAGE_EVENT_PRUNE_VACUUM_PENDING_META_KEY: &str =
    "usage_event_prune_vacuum_pending_v1";
const TOKENOMICS_USAGE_EVENT_PRUNE_DELETED_SINCE_VACUUM_META_KEY: &str =
    "usage_event_prune_deleted_since_vacuum_v1";
const TOKENOMICS_USAGE_EVENT_PRUNE_ACK_DAY_META_PREFIX: &str = "usage_event_prune_acked_day_v1:";
const TOKENOMICS_LIMITS_CHANGED_SYNC_REASON: &str = "tokenomics_limits_changed";
/// Invisible sync reason for baseline republishes of the provider windows:
/// no new usage rows exist, but the current window content differs from the
/// last republished `aus` packet, so the web Billing tab needs a fresh copy.
const TOKENOMICS_WINDOW_REPUBLISH_SYNC_REASON: &str = "tokenomics_window_republish";
const TOKENOMICS_DEVICE_IDENTITIES_KEY: &str = "device_identities";
const TOKENOMICS_CLOUD_ACCOUNT_SYNC_CURSOR_KEY_PREFIX: &str = "cloud_account_sync_cursor:";
const TOKENOMICS_CODEX_USAGE_CACHE_ALIAS_KEY_PREFIX: &str = "codex_usage_api_cache_alias:";
const TOKENOMICS_DAEMON_USAGE_AUTHORITY_KEY: &str = "daemon_usage_authority_v1";
const TOKENOMICS_DAEMON_METER_STATES_KEY: &str = "daemon_meter_states_v1";
const TOKENOMICS_DAEMON_PROVIDER_LIMITS_KEY: &str = "daemon_provider_limits_v1";
const TOKENOMICS_HAIDER_CODE_PLAN_STATUS_KEY: &str = "haider_code_plan_status_v1";
const TOKENOMICS_DAEMON_USAGE_BASELINE_KEY: &str = "daemon_usage_baseline_v1";
static TOKENOMICS_MAINTENANCE_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static TOKENOMICS_DB_WRITE_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static TOKENOMICS_SUMMARY_CACHE: OnceLock<StdMutex<Option<TokenomicsSummaryCacheEntry>>> =
    OnceLock::new();
static TOKENOMICS_LIVE_LIMITS_CACHE: OnceLock<StdMutex<Option<TokenomicsLiveLimitsCacheEntry>>> =
    OnceLock::new();
static TOKENOMICS_PROVIDER_ACCOUNT_RECONCILE_FINGERPRINT: OnceLock<StdMutex<Option<String>>> =
    OnceLock::new();
static TOKENOMICS_USAGE_EVENT_PRUNE_LAST_ATTEMPT_UNIX: AtomicU64 = AtomicU64::new(0);
static TOKENOMICS_USAGE_EVENT_RETENTION_START: OnceLock<Instant> = OnceLock::new();

thread_local! {
    static TOKENOMICS_DB_WRITE_LOCK_DEPTH: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[derive(Clone)]
struct TokenomicsSummaryCacheEntry {
    include_rollups: bool,
    include_cloud: bool,
    cached_at: Instant,
    summary: Value,
}

#[derive(Clone)]
struct TokenomicsLiveLimitsCacheEntry {
    cached_at: Instant,
    summary: Value,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct TokenomicsScopedRollupKey {
    device_id: String,
    model: Option<String>,
    subscription_key: Option<String>,
    provider_account_key: Option<String>,
    billing_scope_type: String,
    billing_team_id: Option<String>,
    workspace_id: Option<String>,
    bucket_start: String,
}

#[tauri::command(rename_all = "snake_case")]
async fn tokenomics_get_summary(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _span = BackendCpuSpan::new("tokenomics.command.get_summary");
        tokenomics_cached_read_only_summary_for(&app, false, true)
    })
    .await
    .map_err(|error| format!("Unable to join Tokenomics summary: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn tokenomics_get_live_limits(
    app: AppHandle,
    state: State<'_, CloudMcpState>,
) -> Result<Value, String> {
    let summary = tokenomics_refresh_from_daemon(&app).await?;
    tokenomics_enqueue_usage_sync_if_needed(
        app,
        state.inner(),
        &summary,
        TOKENOMICS_LIMITS_CHANGED_SYNC_REASON,
        false,
        true,
    )
    .await;
    Ok(summary)
}

#[tauri::command(rename_all = "snake_case")]
async fn tokenomics_get_sync_payload(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _span = BackendCpuSpan::new("tokenomics.command.get_sync_payload");
        tokenomics_summary_for(&app, true, false)
    })
    .await
    .map_err(|error| format!("Unable to join Tokenomics sync payload: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn tokenomics_get_sync_delta(
    app: AppHandle,
    since_updated_at: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _span = BackendCpuSpan::new("tokenomics.command.get_sync_delta");
        let conn = tokenomics_open_db(&app)?;
        tokenomics_reconcile_current_provider_accounts(&conn)?;
        let scope = tokenomics_current_billing_scope();
        tokenomics_sync_delta_from_conn(&conn, since_updated_at.as_deref(), Some(&scope))
    })
    .await
    .map_err(|error| format!("Unable to join Tokenomics sync delta: {error}"))?
}

fn tokenomics_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Unable to create app data directory: {error}"))?;
    Ok(app_data_dir.join(TOKENOMICS_DB_FILE))
}

fn tokenomics_home_dir() -> Option<PathBuf> {
    user_home_dir()
}

fn tokenomics_title_case(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
        None => String::new(),
    }
}

fn tokenomics_limit_default_window_seconds(window_kind: &str) -> i64 {
    if window_kind == "weekly" {
        7 * 24 * 60 * 60
    } else {
        5 * 60 * 60
    }
}

fn tokenomics_limit_effective_window_seconds(window_kind: &str, seconds: Option<i64>) -> i64 {
    seconds
        .filter(|value| *value > 0)
        .unwrap_or_else(|| tokenomics_limit_default_window_seconds(window_kind))
}

fn tokenomics_open_db(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let db_path = tokenomics_db_path(app)?;
    let conn = rusqlite::Connection::open(&db_path).map_err(|error| {
        format!(
            "Unable to open Tokenomics database {}: {error}",
            db_path.display()
        )
    })?;
    conn.busy_timeout(Duration::from_millis(TOKENOMICS_SQLITE_BUSY_TIMEOUT_MS))
        .map_err(|error| format!("Unable to set Tokenomics database busy timeout: {error}"))?;
    tokenomics_with_db_write_lock(&conn, || tokenomics_prepare_db(&conn))?;
    Ok(conn)
}

fn tokenomics_db_write_lock() -> &'static StdMutex<()> {
    TOKENOMICS_DB_WRITE_LOCK.get_or_init(|| StdMutex::new(()))
}

fn tokenomics_with_db_write_lock<T>(
    conn: &rusqlite::Connection,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if !conn.is_autocommit() {
        return operation();
    }
    if TOKENOMICS_DB_WRITE_LOCK_DEPTH.with(|depth| depth.get() > 0) {
        return operation();
    }
    let _guard = match tokenomics_db_write_lock().lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    };
    struct TokenomicsDbWriteLockDepthGuard;
    impl Drop for TokenomicsDbWriteLockDepthGuard {
        fn drop(&mut self) {
            TOKENOMICS_DB_WRITE_LOCK_DEPTH.with(|depth| {
                depth.set(depth.get().saturating_sub(1));
            });
        }
    }
    TOKENOMICS_DB_WRITE_LOCK_DEPTH.with(|depth| {
        depth.set(depth.get().saturating_add(1));
    });
    let _depth_guard = TokenomicsDbWriteLockDepthGuard;
    operation()
}

fn tokenomics_db_write_lock_held_by_thread() -> bool {
    TOKENOMICS_DB_WRITE_LOCK_DEPTH.with(|depth| depth.get() > 0)
}

fn tokenomics_with_db_write_transaction<T>(
    conn: &mut rusqlite::Connection,
    context: &str,
    operation: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = if conn.is_autocommit() {
        Some(match tokenomics_db_write_lock().lock() {
            Ok(guard) => guard,
            Err(error) => error.into_inner(),
        })
    } else {
        None
    };
    let transaction = conn
        .transaction()
        .map_err(|error| format!("Unable to start {context}: {error}"))?;
    match operation(&transaction) {
        Ok(value) => {
            transaction
                .commit()
                .map_err(|error| format!("Unable to commit {context}: {error}"))?;
            Ok(value)
        }
        Err(error) => {
            let _ = transaction.rollback();
            Err(error)
        }
    }
}

fn tokenomics_sqlite_error_is_locked(error: &rusqlite::Error) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)
    )
}

fn tokenomics_retry_sqlite_write<T>(
    context: &str,
    mut operation: impl FnMut() -> rusqlite::Result<T>,
) -> Result<T, String> {
    let started_at = Instant::now();
    let mut sleep_ms = 25u64;
    loop {
        match operation() {
            Ok(value) => return Ok(value),
            Err(error)
                if tokenomics_sqlite_error_is_locked(&error)
                    && started_at.elapsed()
                        < Duration::from_millis(TOKENOMICS_SQLITE_BUSY_TIMEOUT_MS * 4) =>
            {
                thread::sleep(Duration::from_millis(sleep_ms));
                sleep_ms = (sleep_ms.saturating_mul(2)).min(500);
            }
            Err(error) => return Err(format!("{context}: {error}")),
        }
    }
}

fn tokenomics_reset_prune_candidates(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS tokenomics_prune_candidate_rowids(rowid INTEGER PRIMARY KEY)",
        [],
    )
    .map_err(|error| format!("Unable to prepare Tokenomics rebuild candidates: {error}"))?;
    conn.execute("DELETE FROM tokenomics_prune_candidate_rowids", [])
        .map_err(|error| format!("Unable to clear Tokenomics rebuild candidates: {error}"))?;
    Ok(())
}

fn tokenomics_prepare_db(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA journal_size_limit=67108864;
         CREATE TABLE IF NOT EXISTS tokenomics_usage_events(
           id TEXT PRIMARY KEY,
           device_id TEXT NOT NULL DEFAULT 'desktop-primary',
           provider TEXT NOT NULL,
           agent_kind TEXT NOT NULL,
           model TEXT,
	           subscription_key TEXT,
	           provider_account_key TEXT,
	           provider_account_label TEXT,
	           billing_scope_type TEXT NOT NULL DEFAULT 'unknown',
	           billing_team_id TEXT,
	           billing_scope_source TEXT NOT NULL DEFAULT 'unknown',
	           workspace_id TEXT,
	           repo_path TEXT,
           source_kind TEXT NOT NULL,
           source_path TEXT,
           bucket_day TEXT NOT NULL,
           bucket_hour TEXT NOT NULL,
           input_tokens INTEGER NOT NULL DEFAULT 0,
           output_tokens INTEGER NOT NULL DEFAULT 0,
           cache_read_tokens INTEGER NOT NULL DEFAULT 0,
           cache_write_tokens INTEGER NOT NULL DEFAULT 0,
           total_tokens INTEGER NOT NULL DEFAULT 0,
	           estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
	           created_at TEXT,
	           observed_at TEXT NOT NULL
	         );
         CREATE TABLE IF NOT EXISTS tokenomics_usage_event_tombstones(
           id TEXT PRIMARY KEY,
           provider TEXT NOT NULL DEFAULT '',
           agent_kind TEXT NOT NULL DEFAULT '',
           bucket_day TEXT NOT NULL DEFAULT '',
           bucket_hour TEXT NOT NULL DEFAULT '',
           pruned_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS tokenomics_frozen_source_hours(
           provider TEXT NOT NULL,
           agent_kind TEXT NOT NULL,
           source_path TEXT NOT NULL,
           bucket_hour TEXT NOT NULL,
           folded_at TEXT NOT NULL,
           PRIMARY KEY(provider, agent_kind, source_path, bucket_hour)
         );
	         CREATE TABLE IF NOT EXISTS tokenomics_rollups(
	           id TEXT PRIMARY KEY,
	           device_id TEXT NOT NULL DEFAULT 'desktop-primary',
           provider TEXT NOT NULL,
           agent_kind TEXT NOT NULL,
           model TEXT,
	           subscription_key TEXT,
	           provider_account_key TEXT,
	           provider_account_label TEXT,
	           billing_scope_type TEXT NOT NULL DEFAULT 'unknown',
	           billing_team_id TEXT,
	           billing_scope_source TEXT NOT NULL DEFAULT 'unknown',
	           workspace_id TEXT,
	           repo_path TEXT,
           bucket_width TEXT NOT NULL,
           bucket_start TEXT NOT NULL,
           input_tokens INTEGER NOT NULL DEFAULT 0,
           output_tokens INTEGER NOT NULL DEFAULT 0,
           cache_read_tokens INTEGER NOT NULL DEFAULT 0,
           cache_write_tokens INTEGER NOT NULL DEFAULT 0,
           total_tokens INTEGER NOT NULL DEFAULT 0,
           estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
	           event_count INTEGER NOT NULL DEFAULT 0,
	           updated_at TEXT NOT NULL
	         );
         CREATE TABLE IF NOT EXISTS tokenomics_pruned_usage_rollups(
           id TEXT PRIMARY KEY,
           device_id TEXT NOT NULL DEFAULT 'desktop-primary',
           provider TEXT NOT NULL,
           agent_kind TEXT NOT NULL,
           model TEXT,
	           subscription_key TEXT,
	           provider_account_key TEXT,
	           provider_account_label TEXT,
	           billing_scope_type TEXT NOT NULL DEFAULT 'unknown',
	           billing_team_id TEXT,
	           billing_scope_source TEXT NOT NULL DEFAULT 'unknown',
	           workspace_id TEXT,
	           repo_path TEXT,
           bucket_width TEXT NOT NULL,
           bucket_start TEXT NOT NULL,
           input_tokens INTEGER NOT NULL DEFAULT 0,
           output_tokens INTEGER NOT NULL DEFAULT 0,
           cache_read_tokens INTEGER NOT NULL DEFAULT 0,
           cache_write_tokens INTEGER NOT NULL DEFAULT 0,
           total_tokens INTEGER NOT NULL DEFAULT 0,
           estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
           event_count INTEGER NOT NULL DEFAULT 0,
           updated_at TEXT NOT NULL
         );
	         CREATE TABLE IF NOT EXISTS tokenomics_cloud_rollups(
	           id TEXT PRIMARY KEY,
           device_id TEXT NOT NULL,
           provider TEXT NOT NULL,
           agent_kind TEXT NOT NULL,
           model TEXT,
	           subscription_key TEXT,
	           provider_account_key TEXT,
	           provider_account_label TEXT,
	           billing_scope_type TEXT NOT NULL DEFAULT 'unknown',
	           billing_team_id TEXT,
	           billing_scope_source TEXT NOT NULL DEFAULT 'unknown',
	           workspace_id TEXT,
	           repo_path TEXT,
           bucket_width TEXT NOT NULL,
           bucket_start TEXT NOT NULL,
           input_tokens INTEGER NOT NULL DEFAULT 0,
           output_tokens INTEGER NOT NULL DEFAULT 0,
           cache_read_tokens INTEGER NOT NULL DEFAULT 0,
           cache_write_tokens INTEGER NOT NULL DEFAULT 0,
           total_tokens INTEGER NOT NULL DEFAULT 0,
           estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
           event_count INTEGER NOT NULL DEFAULT 0,
           updated_at TEXT NOT NULL,
           received_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS tokenomics_provider_limit_samples(
           id TEXT PRIMARY KEY,
           device_id TEXT NOT NULL,
           provider TEXT NOT NULL,
           agent_kind TEXT NOT NULL,
           provider_account_key TEXT NOT NULL,
           provider_account_label TEXT,
           billing_scope_type TEXT NOT NULL DEFAULT 'unknown',
           billing_team_id TEXT,
           billing_scope_source TEXT NOT NULL DEFAULT 'unknown',
           window_kind TEXT NOT NULL,
           sample_bucket_start TEXT NOT NULL,
           sample_bucket_unix INTEGER NOT NULL DEFAULT 0,
           sample_at TEXT NOT NULL,
           sample_at_unix INTEGER NOT NULL DEFAULT 0,
           used_percent INTEGER,
           remaining_percent INTEGER,
           reset_at TEXT,
           reset_after_seconds INTEGER,
           limit_window_seconds INTEGER,
           pace_status TEXT,
           pace_delta_percent INTEGER,
           source TEXT NOT NULL DEFAULT 'local',
           confidence TEXT NOT NULL DEFAULT 'unknown',
           updated_at TEXT NOT NULL,
           updated_at_unix INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS tokenomics_provider_accounts(
           id TEXT PRIMARY KEY,
           device_id TEXT NOT NULL,
           provider TEXT NOT NULL,
           agent_kind TEXT NOT NULL,
           provider_account_key TEXT NOT NULL,
           provider_account_label TEXT,
           billing_scope_type TEXT NOT NULL DEFAULT 'unknown',
           billing_team_id TEXT,
           billing_scope_source TEXT NOT NULL DEFAULT 'unknown',
           attribution_source TEXT NOT NULL DEFAULT 'unknown',
           first_seen_at TEXT NOT NULL,
           last_seen_at TEXT NOT NULL,
           updated_at TEXT NOT NULL,
           updated_at_unix INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS tokenomics_latest_windows(
           id TEXT PRIMARY KEY,
           device_id TEXT NOT NULL,
           provider TEXT NOT NULL,
           agent_kind TEXT NOT NULL,
           provider_account_key TEXT NOT NULL,
           provider_account_label TEXT,
           billing_scope_type TEXT NOT NULL DEFAULT 'unknown',
           billing_team_id TEXT,
           billing_scope_source TEXT NOT NULL DEFAULT 'unknown',
           window_kind TEXT NOT NULL,
           provider_window_kind TEXT,
           sample_at TEXT NOT NULL,
           sample_at_unix INTEGER NOT NULL DEFAULT 0,
           used_percent INTEGER,
           remaining_percent INTEGER,
           reset_at TEXT,
           reset_after_seconds INTEGER,
           limit_window_seconds INTEGER,
           pace_status TEXT,
           pace_delta_percent INTEGER,
           source TEXT NOT NULL DEFAULT 'local',
           confidence TEXT NOT NULL DEFAULT 'unknown',
           updated_at TEXT NOT NULL,
           updated_at_unix INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS tokenomics_usage_regions(
           id TEXT PRIMARY KEY,
           device_id TEXT NOT NULL,
           provider TEXT NOT NULL,
           agent_kind TEXT NOT NULL,
           source_id TEXT NOT NULL,
           region_kind TEXT NOT NULL,
           region_start_unix INTEGER NOT NULL DEFAULT 0,
           region_end_unix INTEGER NOT NULL DEFAULT 0,
           status TEXT NOT NULL DEFAULT 'unknown',
           last_event_timestamp INTEGER NOT NULL DEFAULT 0,
           updated_at TEXT NOT NULL
         );
	         CREATE TABLE IF NOT EXISTS tokenomics_daemon_usage_counters(
	           counter_key TEXT PRIMARY KEY,
	           device_id TEXT NOT NULL,
	           provider TEXT NOT NULL,
	           agent_kind TEXT NOT NULL,
	           provider_account_key TEXT NOT NULL,
	           provider_account_label TEXT,
	           model TEXT,
	           input_tokens INTEGER NOT NULL DEFAULT 0,
	           output_tokens INTEGER NOT NULL DEFAULT 0,
	           cache_read_tokens INTEGER NOT NULL DEFAULT 0,
	           cache_write_tokens INTEGER NOT NULL DEFAULT 0,
	           total_tokens INTEGER NOT NULL DEFAULT 0,
	           estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
	           generated_at_ms INTEGER NOT NULL DEFAULT 0,
	           updated_at TEXT NOT NULL
	         );
		         CREATE TABLE IF NOT EXISTS tokenomics_meta(
		           key TEXT PRIMARY KEY,
		           value TEXT NOT NULL
	         );
         CREATE TABLE IF NOT EXISTS tokenomics_scan_state(
           provider TEXT NOT NULL,
           agent_kind TEXT NOT NULL,
           source_id TEXT NOT NULL,
           scanner_version TEXT NOT NULL,
           initial_backfill_done INTEGER NOT NULL DEFAULT 0,
           last_event_timestamp INTEGER NOT NULL DEFAULT 0,
           last_scanned_at TEXT,
           updated_at TEXT NOT NULL,
           PRIMARY KEY(provider, agent_kind, source_id)
         );
	         CREATE TABLE IF NOT EXISTS tokenomics_source_offsets(
	           provider TEXT NOT NULL,
	           agent_kind TEXT NOT NULL,
	           source_path TEXT NOT NULL,
	           scanner_version TEXT NOT NULL,
	           last_line_index INTEGER NOT NULL DEFAULT -1,
	           last_byte_offset INTEGER NOT NULL DEFAULT 0,
		           resume_fingerprint TEXT NOT NULL DEFAULT '',
		           last_seen_mtime INTEGER NOT NULL DEFAULT 0,
		           last_seen_size INTEGER NOT NULL DEFAULT 0,
		           last_seen_file_dev INTEGER,
		           last_seen_file_ino INTEGER,
		           last_event_timestamp INTEGER NOT NULL DEFAULT 0,
		           coverage_start_unix INTEGER NOT NULL DEFAULT 9223372036854775807,
		           updated_at TEXT NOT NULL,
	           PRIMARY KEY(provider, agent_kind, source_path)
	         );
	         CREATE TABLE IF NOT EXISTS tokenomics_source_imports(
	           provider TEXT NOT NULL,
	           agent_kind TEXT NOT NULL,
	           source_path TEXT NOT NULL,
	           source_id TEXT NOT NULL DEFAULT '',
	           source_session_id TEXT,
	           source_kind TEXT NOT NULL DEFAULT 'jsonl',
	           scanner_version TEXT NOT NULL,
	           first_event_timestamp INTEGER NOT NULL DEFAULT 0,
	           last_event_timestamp INTEGER NOT NULL DEFAULT 0,
	           last_line_index INTEGER NOT NULL DEFAULT -1,
	           last_byte_offset INTEGER NOT NULL DEFAULT 0,
		           resume_fingerprint TEXT NOT NULL DEFAULT '',
		           last_seen_mtime INTEGER NOT NULL DEFAULT 0,
		           last_seen_size INTEGER NOT NULL DEFAULT 0,
		           last_seen_file_dev INTEGER,
		           last_seen_file_ino INTEGER,
		           coverage_start_unix INTEGER NOT NULL DEFAULT 9223372036854775807,
		           event_count INTEGER NOT NULL DEFAULT 0,
		           provider_account_key TEXT,
		           provider_account_label TEXT,
		           billing_scope_type TEXT NOT NULL DEFAULT 'unknown',
		           billing_team_id TEXT,
		           billing_scope_source TEXT NOT NULL DEFAULT 'unknown',
		           raw_available INTEGER NOT NULL DEFAULT 1,
		           raw_deleted_at TEXT,
		           import_status TEXT NOT NULL DEFAULT 'unknown',
	           updated_at TEXT NOT NULL,
	           PRIMARY KEY(provider, agent_kind, source_path)
	         );
         CREATE TABLE IF NOT EXISTS tokenomics_retired_provider_accounts(
           provider TEXT NOT NULL,
           agent_kind TEXT NOT NULL,
           provider_account_key TEXT NOT NULL,
           canonical_key TEXT,
           retired_at TEXT NOT NULL,
           PRIMARY KEY(provider, agent_kind, provider_account_key)
         );
	         CREATE TABLE IF NOT EXISTS tokenomics_scan_days(
           provider TEXT NOT NULL,
           agent_kind TEXT NOT NULL,
           source_id TEXT NOT NULL,
           day_start_unix INTEGER NOT NULL,
           scanner_version TEXT NOT NULL,
           status TEXT NOT NULL DEFAULT 'unknown',
           candidate_count INTEGER NOT NULL DEFAULT 0,
           files_scanned INTEGER NOT NULL DEFAULT 0,
           inserted_events INTEGER NOT NULL DEFAULT 0,
           completed_at TEXT,
           updated_at TEXT NOT NULL,
           PRIMARY KEY(provider, agent_kind, source_id, day_start_unix)
         );
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_source_offsets_provider ON tokenomics_source_offsets(provider, agent_kind, updated_at);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_source_imports_provider ON tokenomics_source_imports(provider, agent_kind, updated_at);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_source_imports_raw ON tokenomics_source_imports(raw_available, import_status, event_count);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_scan_state_provider ON tokenomics_scan_state(provider, agent_kind, updated_at);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_scan_days_source ON tokenomics_scan_days(provider, agent_kind, source_id, scanner_version, day_start_unix);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_limit_samples_updated ON tokenomics_provider_limit_samples(updated_at);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_limit_samples_match ON tokenomics_provider_limit_samples(billing_scope_type, billing_team_id, provider, agent_kind, provider_account_key, window_kind, sample_bucket_unix);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_limit_samples_device_match ON tokenomics_provider_limit_samples(device_id, billing_scope_type, billing_team_id, provider, agent_kind, provider_account_key, window_kind, sample_bucket_unix);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_provider_accounts_updated ON tokenomics_provider_accounts(updated_at);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_provider_accounts_match ON tokenomics_provider_accounts(device_id, billing_scope_type, billing_team_id, provider, agent_kind, provider_account_key);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_latest_windows_updated ON tokenomics_latest_windows(updated_at);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_latest_windows_match ON tokenomics_latest_windows(device_id, billing_scope_type, billing_team_id, provider, agent_kind, provider_account_key, window_kind);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_observed ON tokenomics_usage_events(observed_at);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_bucket_account ON tokenomics_usage_events(bucket_hour, provider, agent_kind, provider_account_key, subscription_key);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_source_path ON tokenomics_usage_events(provider, agent_kind, source_path);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_account_label ON tokenomics_usage_events(provider, agent_kind, provider_account_key, provider_account_label);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_subscription_label ON tokenomics_usage_events(provider, agent_kind, subscription_key, provider_account_label);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_provider_created ON tokenomics_usage_events(provider, agent_kind, created_at);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_provider_source_kind ON tokenomics_usage_events(provider, agent_kind, source_kind);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_retention ON tokenomics_usage_events(bucket_hour, bucket_day, billing_scope_type, billing_team_id);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_event_tombstones_provider ON tokenomics_usage_event_tombstones(provider, agent_kind, bucket_hour);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_frozen_source_hours_lookup ON tokenomics_frozen_source_hours(provider, agent_kind, source_path, bucket_hour);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_pruned_rollups_provider ON tokenomics_pruned_usage_rollups(provider, agent_kind, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_pruned_rollups_account ON tokenomics_pruned_usage_rollups(provider, agent_kind, provider_account_key, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_pruned_rollups_subscription ON tokenomics_pruned_usage_rollups(provider, agent_kind, subscription_key, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_regions_source ON tokenomics_usage_regions(provider, agent_kind, source_id, updated_at);",
    )
    .map_err(|error| format!("Unable to prepare Tokenomics database: {error}"))?;
    for table in [
        "tokenomics_usage_events",
        "tokenomics_rollups",
        "tokenomics_pruned_usage_rollups",
        "tokenomics_cloud_rollups",
    ] {
        tokenomics_ensure_column(
            conn,
            table,
            "device_id",
            "TEXT NOT NULL DEFAULT 'desktop-primary'",
        )?;
        tokenomics_ensure_column(conn, table, "subscription_key", "TEXT")?;
        tokenomics_ensure_column(conn, table, "provider_account_key", "TEXT")?;
        tokenomics_ensure_column(conn, table, "provider_account_label", "TEXT")?;
        tokenomics_ensure_column(
            conn,
            table,
            "billing_scope_type",
            "TEXT NOT NULL DEFAULT 'unknown'",
        )?;
        tokenomics_ensure_column(conn, table, "billing_team_id", "TEXT")?;
        tokenomics_ensure_column(
            conn,
            table,
            "billing_scope_source",
            "TEXT NOT NULL DEFAULT 'unknown'",
        )?;
        tokenomics_ensure_column(conn, table, "workspace_id", "TEXT")?;
        tokenomics_ensure_column(conn, table, "repo_path", "TEXT")?;
    }
    tokenomics_ensure_column(
        conn,
        "tokenomics_source_offsets",
        "last_byte_offset",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    tokenomics_ensure_column(
        conn,
        "tokenomics_source_offsets",
        "resume_fingerprint",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    tokenomics_ensure_column(
        conn,
        "tokenomics_source_offsets",
        "coverage_start_unix",
        "INTEGER NOT NULL DEFAULT 9223372036854775807",
    )?;
    for (column, column_type) in [
        ("provider", "TEXT NOT NULL DEFAULT ''"),
        ("agent_kind", "TEXT NOT NULL DEFAULT ''"),
        ("bucket_day", "TEXT NOT NULL DEFAULT ''"),
        ("bucket_hour", "TEXT NOT NULL DEFAULT ''"),
        ("pruned_at", "TEXT NOT NULL DEFAULT ''"),
    ] {
        tokenomics_ensure_column(
            conn,
            "tokenomics_usage_event_tombstones",
            column,
            column_type,
        )?;
    }
    for (column, column_type) in [
        ("last_seen_file_dev", "INTEGER"),
        ("last_seen_file_ino", "INTEGER"),
    ] {
        tokenomics_ensure_column(conn, "tokenomics_source_offsets", column, column_type)?;
    }
    for (column, column_type) in [
        ("source_id", "TEXT NOT NULL DEFAULT ''"),
        ("source_session_id", "TEXT"),
        ("source_kind", "TEXT NOT NULL DEFAULT 'jsonl'"),
        ("first_event_timestamp", "INTEGER NOT NULL DEFAULT 0"),
        ("last_event_timestamp", "INTEGER NOT NULL DEFAULT 0"),
        ("last_line_index", "INTEGER NOT NULL DEFAULT -1"),
        ("last_byte_offset", "INTEGER NOT NULL DEFAULT 0"),
        ("resume_fingerprint", "TEXT NOT NULL DEFAULT ''"),
        ("last_seen_mtime", "INTEGER NOT NULL DEFAULT 0"),
        ("last_seen_size", "INTEGER NOT NULL DEFAULT 0"),
        ("last_seen_file_dev", "INTEGER"),
        ("last_seen_file_ino", "INTEGER"),
        (
            "coverage_start_unix",
            "INTEGER NOT NULL DEFAULT 9223372036854775807",
        ),
        ("event_count", "INTEGER NOT NULL DEFAULT 0"),
        ("provider_account_key", "TEXT"),
        ("provider_account_label", "TEXT"),
        ("billing_scope_type", "TEXT NOT NULL DEFAULT 'unknown'"),
        ("billing_team_id", "TEXT"),
        ("billing_scope_source", "TEXT NOT NULL DEFAULT 'unknown'"),
        ("raw_available", "INTEGER NOT NULL DEFAULT 1"),
        ("raw_deleted_at", "TEXT"),
        ("import_status", "TEXT NOT NULL DEFAULT 'unknown'"),
        ("updated_at", "TEXT NOT NULL DEFAULT ''"),
    ] {
        tokenomics_ensure_column(conn, "tokenomics_source_imports", column, column_type)?;
    }
    tokenomics_ensure_column(
        conn,
        "tokenomics_scan_days",
        "candidate_count",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    tokenomics_ensure_column(
        conn,
        "tokenomics_scan_days",
        "files_scanned",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    tokenomics_ensure_column(
        conn,
        "tokenomics_scan_days",
        "inserted_events",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    let device_id = tokenomics_local_device_id();
    tokenomics_backfill_legacy_device_ids(conn, &device_id)?;
    tokenomics_reconcile_local_device_id(conn)?;
    tokenomics_rekey_all_pruned_usage_rollups(conn)?;
    tokenomics_prune_local_cloud_relay_rows(conn)?;
    tokenomics_backfill_legacy_billing_scopes(conn)?;
    tokenomics_repair_codex_mislabeled_session_windows(conn)?;
    tokenomics_prune_unknown_provider_account_rows(conn)?;
    // The display views are rebuilt ONLY when their stored schema version is
    // stale, and the whole DDL batch runs inside one IMMEDIATE transaction.
    // Rebuilding them unconditionally on every open (the old behavior) raced:
    // each DDL statement auto-commits, this database is opened concurrently
    // by the summary view, daemon refresh worker, and cloud handlers, so a
    // reader could land in the gap between
    // DROP VIEW and CREATE VIEW and fail with "no such table:
    // tokenomics_display_daily_rollups". Bump the version whenever any view
    // definition below changes (including when a new column must surface
    // through the views).
    const TOKENOMICS_VIEW_SCHEMA_VERSION: i64 = 3;
    let view_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| format!("Unable to read Tokenomics schema version: {error}"))?;
    if view_version == TOKENOMICS_VIEW_SCHEMA_VERSION {
        // Keep prepare_db free of unbounded usage-event migrations while the
        // process-global Tokenomics write lock is held. Only cheap meta-gated
        // repair hooks belong here; retention work runs from the prune path.
        tokenomics_repair_codex_orphaned_import_rows(conn)?;
        tokenomics_rebuild_rollups_for_identity_version(conn)?;
        tokenomics_repair_provider_api_costs(conn)?;
        return Ok(());
    }
    let current_device_id_sql = tokenomics_sql_string_literal(&device_id);
    conn.execute_batch(&format!(
        "BEGIN IMMEDIATE;
         DROP VIEW IF EXISTS tokenomics_display_daily_rollups;
         DROP VIEW IF EXISTS tokenomics_display_hourly_rollups;
         DROP VIEW IF EXISTS tokenomics_daily_rollups;
         DROP VIEW IF EXISTS tokenomics_hourly_rollups;
         DROP VIEW IF EXISTS tokenomics_display_rollups;
         CREATE VIEW tokenomics_display_rollups AS
           SELECT id, device_id, provider, agent_kind, model, subscription_key,
                  provider_account_key, provider_account_label,
                  billing_scope_type, billing_team_id, billing_scope_source,
                  workspace_id, repo_path,
                  bucket_width, bucket_start, input_tokens, output_tokens,
                  cache_read_tokens, cache_write_tokens, total_tokens,
                  estimated_cost_microusd, event_count, updated_at
           FROM tokenomics_rollups
           UNION ALL
           SELECT id, device_id, provider, agent_kind, model, subscription_key,
                  provider_account_key, provider_account_label,
                  billing_scope_type, billing_team_id, billing_scope_source,
                  workspace_id, repo_path,
                  bucket_width, bucket_start, input_tokens, output_tokens,
                  cache_read_tokens, cache_write_tokens, total_tokens,
                  estimated_cost_microusd, event_count, updated_at
           FROM tokenomics_cloud_rollups
           WHERE TRIM(COALESCE(device_id, ''))!=''
             AND device_id!={current_device_id_sql}
             AND LOWER(TRIM(device_id)) NOT IN (
               'desktop-primary', 'cloud', 'account', 'all', 'all-device',
               'all-devices', 'all_device', 'all_devices',
               'unknown-device', 'unknown_device'
             );
         CREATE VIEW tokenomics_hourly_rollups AS
           SELECT id, device_id, provider, agent_kind, model, subscription_key,
                  provider_account_key, provider_account_label,
                  billing_scope_type, billing_team_id, billing_scope_source,
                  workspace_id, repo_path,
                  bucket_width, bucket_start, input_tokens, output_tokens,
                  cache_read_tokens, cache_write_tokens, total_tokens,
                  estimated_cost_microusd, event_count, updated_at
           FROM tokenomics_rollups
           WHERE bucket_width='hour';
         CREATE VIEW tokenomics_display_hourly_rollups AS
           SELECT id, device_id, provider, agent_kind, model, subscription_key,
                  provider_account_key, provider_account_label,
                  billing_scope_type, billing_team_id, billing_scope_source,
                  workspace_id, repo_path,
                  bucket_width, bucket_start, input_tokens, output_tokens,
                  cache_read_tokens, cache_write_tokens, total_tokens,
                  estimated_cost_microusd, event_count, updated_at
           FROM tokenomics_display_rollups
           WHERE bucket_width='hour';
         CREATE VIEW tokenomics_daily_rollups AS
           SELECT
                  'daily-from-hour:' || MIN(id) AS id,
                  device_id, provider, agent_kind, model, subscription_key,
                  provider_account_key, MAX(provider_account_label) AS provider_account_label,
                  billing_scope_type, billing_team_id, MAX(billing_scope_source) AS billing_scope_source,
                  workspace_id, MAX(repo_path) AS repo_path,
                  'day' AS bucket_width, substr(bucket_start, 1, 10) AS bucket_start,
                  COALESCE(SUM(input_tokens), 0) AS input_tokens,
                  COALESCE(SUM(output_tokens), 0) AS output_tokens,
                  COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                  COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
                  COALESCE(SUM(total_tokens), 0) AS total_tokens,
                  COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd,
                  COALESCE(SUM(event_count), 0) AS event_count,
                  MAX(updated_at) AS updated_at
           FROM tokenomics_hourly_rollups
           WHERE LENGTH(substr(bucket_start, 1, 10)) = 10
           GROUP BY device_id, provider, agent_kind, model, subscription_key,
                    provider_account_key, billing_scope_type, billing_team_id,
                    workspace_id, substr(bucket_start, 1, 10)
           UNION ALL
           SELECT day.id, day.device_id, day.provider, day.agent_kind, day.model, day.subscription_key,
                  day.provider_account_key, day.provider_account_label,
                  day.billing_scope_type, day.billing_team_id, day.billing_scope_source,
                  day.workspace_id, day.repo_path,
                  day.bucket_width, day.bucket_start, day.input_tokens, day.output_tokens,
                  day.cache_read_tokens, day.cache_write_tokens, day.total_tokens,
                  day.estimated_cost_microusd, day.event_count, day.updated_at
           FROM tokenomics_rollups day
           WHERE day.bucket_width='day'
             AND NOT EXISTS (
               SELECT 1
               FROM tokenomics_hourly_rollups hour
               WHERE hour.device_id=day.device_id
                 AND hour.provider=day.provider
                 AND hour.agent_kind=day.agent_kind
                 AND COALESCE(hour.model, '')=COALESCE(day.model, '')
                 AND COALESCE(hour.subscription_key, '')=COALESCE(day.subscription_key, '')
                 AND COALESCE(hour.provider_account_key, '')=COALESCE(day.provider_account_key, '')
                 AND COALESCE(hour.billing_scope_type, '')=COALESCE(day.billing_scope_type, '')
                 AND COALESCE(hour.billing_team_id, '')=COALESCE(day.billing_team_id, '')
                 AND COALESCE(hour.workspace_id, '')=COALESCE(day.workspace_id, '')
                 AND substr(hour.bucket_start, 1, 10)=day.bucket_start
             );
         CREATE VIEW tokenomics_display_daily_rollups AS
           SELECT
                  'daily-from-hour:' || MIN(id) AS id,
                  device_id, provider, agent_kind, model, subscription_key,
                  provider_account_key, MAX(provider_account_label) AS provider_account_label,
                  billing_scope_type, billing_team_id, MAX(billing_scope_source) AS billing_scope_source,
                  workspace_id, MAX(repo_path) AS repo_path,
                  'day' AS bucket_width, substr(bucket_start, 1, 10) AS bucket_start,
                  COALESCE(SUM(input_tokens), 0) AS input_tokens,
                  COALESCE(SUM(output_tokens), 0) AS output_tokens,
                  COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                  COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
                  COALESCE(SUM(total_tokens), 0) AS total_tokens,
                  COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd,
                  COALESCE(SUM(event_count), 0) AS event_count,
                  MAX(updated_at) AS updated_at
           FROM tokenomics_display_hourly_rollups
           WHERE LENGTH(substr(bucket_start, 1, 10)) = 10
           GROUP BY device_id, provider, agent_kind, model, subscription_key,
                    provider_account_key, billing_scope_type, billing_team_id,
                    workspace_id, substr(bucket_start, 1, 10)
           UNION ALL
           SELECT day.id, day.device_id, day.provider, day.agent_kind, day.model, day.subscription_key,
                  day.provider_account_key, day.provider_account_label,
                  day.billing_scope_type, day.billing_team_id, day.billing_scope_source,
                  day.workspace_id, day.repo_path,
                  day.bucket_width, day.bucket_start, day.input_tokens, day.output_tokens,
                  day.cache_read_tokens, day.cache_write_tokens, day.total_tokens,
                  day.estimated_cost_microusd, day.event_count, day.updated_at
           FROM tokenomics_display_rollups day
           WHERE day.bucket_width='day'
             AND NOT EXISTS (
               SELECT 1
               FROM tokenomics_display_hourly_rollups hour
               WHERE hour.device_id=day.device_id
                 AND hour.provider=day.provider
                 AND hour.agent_kind=day.agent_kind
                 AND COALESCE(hour.model, '')=COALESCE(day.model, '')
                 AND COALESCE(hour.subscription_key, '')=COALESCE(day.subscription_key, '')
                 AND COALESCE(hour.provider_account_key, '')=COALESCE(day.provider_account_key, '')
                 AND COALESCE(hour.billing_scope_type, '')=COALESCE(day.billing_scope_type, '')
                 AND COALESCE(hour.billing_team_id, '')=COALESCE(day.billing_team_id, '')
                 AND COALESCE(hour.workspace_id, '')=COALESCE(day.workspace_id, '')
                 AND substr(hour.bucket_start, 1, 10)=day.bucket_start
             );
         CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_provider ON tokenomics_rollups(provider, agent_kind, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_width_start ON tokenomics_rollups(bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_workspace ON tokenomics_rollups(workspace_id, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_account ON tokenomics_rollups(provider, agent_kind, provider_account_key, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_account_label ON tokenomics_rollups(provider, agent_kind, provider_account_key, provider_account_label);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_subscription_label ON tokenomics_rollups(provider, agent_kind, subscription_key, provider_account_label);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_device ON tokenomics_rollups(device_id, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_device_account ON tokenomics_rollups(device_id, provider, agent_kind, provider_account_key, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_scope ON tokenomics_rollups(billing_scope_type, billing_team_id, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_cloud_rollups_device ON tokenomics_cloud_rollups(device_id, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_cloud_rollups_account ON tokenomics_cloud_rollups(provider, agent_kind, provider_account_key, device_id, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_cloud_rollups_account_label ON tokenomics_cloud_rollups(provider, agent_kind, provider_account_key, provider_account_label);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_cloud_rollups_subscription_label ON tokenomics_cloud_rollups(provider, agent_kind, subscription_key, provider_account_label);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_cloud_rollups_scope ON tokenomics_cloud_rollups(billing_scope_type, billing_team_id, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_observed ON tokenomics_usage_events(observed_at);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_bucket_account ON tokenomics_usage_events(bucket_hour, provider, agent_kind, provider_account_key, subscription_key);
			         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_source_path ON tokenomics_usage_events(provider, agent_kind, source_path);
			         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_account_label ON tokenomics_usage_events(provider, agent_kind, provider_account_key, provider_account_label);
			         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_subscription_label ON tokenomics_usage_events(provider, agent_kind, subscription_key, provider_account_label);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_provider_created ON tokenomics_usage_events(provider, agent_kind, created_at);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_provider_source_kind ON tokenomics_usage_events(provider, agent_kind, source_kind);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_retention ON tokenomics_usage_events(bucket_hour, bucket_day, billing_scope_type, billing_team_id);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_event_tombstones_provider ON tokenomics_usage_event_tombstones(provider, agent_kind, bucket_hour);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_frozen_source_hours_lookup ON tokenomics_frozen_source_hours(provider, agent_kind, source_path, bucket_hour);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_pruned_rollups_provider ON tokenomics_pruned_usage_rollups(provider, agent_kind, bucket_width, bucket_start);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_pruned_rollups_account ON tokenomics_pruned_usage_rollups(provider, agent_kind, provider_account_key, bucket_width, bucket_start);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_pruned_rollups_subscription ON tokenomics_pruned_usage_rollups(provider, agent_kind, subscription_key, bucket_width, bucket_start);
		         CREATE INDEX IF NOT EXISTS idx_tokenomics_source_offsets_provider ON tokenomics_source_offsets(provider, agent_kind, updated_at);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_source_imports_provider ON tokenomics_source_imports(provider, agent_kind, updated_at);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_source_imports_raw ON tokenomics_source_imports(raw_available, import_status, event_count);
	         CREATE INDEX IF NOT EXISTS idx_tokenomics_scan_state_provider ON tokenomics_scan_state(provider, agent_kind, updated_at);
         PRAGMA user_version={TOKENOMICS_VIEW_SCHEMA_VERSION};
         COMMIT;",
    ))
    .map_err(|error| format!("Unable to finalize Tokenomics database schema: {error}"))?;
    // Keep prepare_db free of unbounded usage-event migrations while the
    // process-global Tokenomics write lock is held. Only cheap meta-gated
    // repair hooks belong here; retention work runs from the prune path.
    tokenomics_repair_codex_orphaned_import_rows(conn)?;
    tokenomics_normalize_codex_cached_input(conn)?;
    tokenomics_rebuild_rollups_for_identity_version(conn)?;
    tokenomics_repair_provider_api_costs(conn)?;
    Ok(())
}

fn tokenomics_backfill_legacy_device_ids(
    conn: &rusqlite::Connection,
    device_id: &str,
) -> Result<(), String> {
    let meta_key = format!("legacy_device_id_backfill_v1:{device_id}");
    if tokenomics_meta_string(conn, &meta_key).is_some() {
        return Ok(());
    }
    for table in [
        "tokenomics_usage_events",
        "tokenomics_rollups",
        "tokenomics_pruned_usage_rollups",
        "tokenomics_cloud_rollups",
    ] {
        conn.execute(
            &format!(
                "UPDATE {table}
                 SET device_id=?1
                 WHERE device_id IS NULL OR device_id='' OR device_id='desktop-primary'"
            ),
            rusqlite::params![device_id],
        )
        .map_err(|error| format!("Unable to backfill Tokenomics device id: {error}"))?;
    }
    tokenomics_store_meta_value(conn, &meta_key, "done")
}

fn tokenomics_backfill_legacy_billing_scopes(conn: &rusqlite::Connection) -> Result<(), String> {
    const META_KEY: &str = "legacy_billing_scope_backfill_v1";
    if tokenomics_meta_string(conn, META_KEY).is_some() {
        return Ok(());
    }
    for table in [
        "tokenomics_usage_events",
        "tokenomics_rollups",
        "tokenomics_pruned_usage_rollups",
        "tokenomics_cloud_rollups",
    ] {
        conn.execute(
            &format!(
                "UPDATE {table}
                 SET billing_scope_type='unknown'
                 WHERE billing_scope_type IS NULL OR billing_scope_type=''"
            ),
            [],
        )
        .map_err(|error| format!("Unable to backfill Tokenomics billing scope: {error}"))?;
        conn.execute(
            &format!(
                "UPDATE {table}
                 SET billing_scope_source='unknown'
                 WHERE billing_scope_source IS NULL OR billing_scope_source=''"
            ),
            [],
        )
        .map_err(|error| format!("Unable to backfill Tokenomics billing scope source: {error}"))?;
    }
    tokenomics_store_meta_value(conn, META_KEY, "done")
}

fn tokenomics_repair_codex_mislabeled_session_windows(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    const META_KEY: &str = "codex_session_window_kind_repair_v1";
    if tokenomics_meta_string(conn, META_KEY).is_some() {
        return Ok(());
    }
    // Positional window classification (primary=5h) stored week/month-long
    // codex windows under window_kind='session_5h', which made the 5-hour
    // gauge and usage-rate graph render the weekly window. These rows are
    // live-limit snapshots, not usage history: deleting them is safe — the
    // next usage-api poll rewrites them under the duration-derived kind.
    for table in [
        "tokenomics_latest_windows",
        "tokenomics_provider_limit_samples",
    ] {
        conn.execute(
            &format!(
                "DELETE FROM {table}
                 WHERE provider='openai'
                   AND window_kind='session_5h'
                   AND COALESCE(limit_window_seconds, 0) > 86400"
            ),
            [],
        )
        .map_err(|error| format!("Unable to repair mislabeled codex session windows: {error}"))?;
    }
    tokenomics_store_meta_value(conn, META_KEY, "done")
}

fn tokenomics_ensure_column(
    conn: &rusqlite::Connection,
    table: &str,
    column: &str,
    column_type: &str,
) -> Result<(), String> {
    let mut statement = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("Unable to inspect Tokenomics table {table}: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Unable to inspect Tokenomics table {table}: {error}"))?;
    for row in rows {
        if row.map_err(|error| format!("Unable to inspect Tokenomics column: {error}"))? == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {column_type}"),
        [],
    )
    .map_err(|error| format!("Unable to migrate Tokenomics table {table}: {error}"))?;
    Ok(())
}

fn tokenomics_live_limits_snapshot_from_conn(conn: &rusqlite::Connection) -> Result<Value, String> {
    let limits = tokenomics_daemon_provider_limits(conn)?;
    let scope = tokenomics_current_billing_scope();
    let retired_account_keys = tokenomics_retired_provider_account_keys(conn);
    let mut latest_windows = tokenomics_latest_window_rows(conn, None, Some(&scope))?;
    tokenomics_retain_active_account_rows(&mut latest_windows, &retired_account_keys);
    let mut limit_samples = tokenomics_provider_limit_sample_sync_rows(conn, None, Some(&scope))?;
    tokenomics_retain_active_account_rows(&mut limit_samples, &retired_account_keys);
    let scan_index = tokenomics_scan_index_status(conn)?;
    let usage_authority = tokenomics_meta_json(conn, TOKENOMICS_DAEMON_USAGE_AUTHORITY_KEY)
        .unwrap_or_else(|| tokenomics_unknown_usage_authority("report_not_requested"));
    let meter_states = tokenomics_meta_json(conn, TOKENOMICS_DAEMON_METER_STATES_KEY)
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    let haider_code_plan_status =
        tokenomics_meta_json(conn, TOKENOMICS_HAIDER_CODE_PLAN_STATUS_KEY).unwrap_or_else(|| {
            json!({
                "supported": Value::Null,
                "known": false,
                "authority_state": "unknown",
            })
        });
    Ok(json!({
        "known": usage_authority.get("state").and_then(Value::as_str) == Some("available"),
        "source": "haider_usage_report",
        "updated_at": tokenomics_now_iso_like(),
        "recorded_samples": 0,
        "recorded_windows": 0,
        "inserted_events": 0,
        "limit_sample_count": limit_samples.len(),
        "latest_window_count": latest_windows.len(),
        "limit_samples": limit_samples,
        "latest_windows": latest_windows,
        "limits": limits,
        "usage_authority": usage_authority,
        "meter_states": meter_states,
        "haider_code_plan_status": haider_code_plan_status,
        "scan_index": scan_index,
    }))
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct TokenomicsDaemonCounter {
    counter_key: String,
    device_id: String,
    provider: String,
    agent_kind: String,
    provider_account_key: String,
    provider_account_label: Option<String>,
    model: Option<String>,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    total_tokens: i64,
    estimated_cost_microusd: i64,
    generated_at_ms: u64,
}

#[derive(Clone, Debug)]
struct TokenomicsDaemonProjection {
    authority: Value,
    meter_states: Vec<Value>,
    limits: Vec<Value>,
    counters: Vec<TokenomicsDaemonCounter>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct TokenomicsDaemonIngestResult {
    inserted_events: usize,
    counter_resets: usize,
    baseline_seeded: bool,
    preserved_existing_history: bool,
}

fn tokenomics_unknown_usage_authority(reason: &str) -> Value {
    json!({
        "state": "unknown",
        "reason": reason,
        "source": "haider_usage_report",
    })
}

fn tokenomics_unavailable_usage_authority(reason: &str) -> Value {
    json!({
        "state": "unavailable",
        "reason": reason,
        "source": "haider_usage_report",
    })
}

fn tokenomics_usage_authority_available(authority: &Value) -> bool {
    authority.get("state").and_then(Value::as_str) == Some("available")
}

fn tokenomics_meta_json(conn: &rusqlite::Connection, key: &str) -> Option<Value> {
    tokenomics_meta_string(conn, key).and_then(|text| serde_json::from_str(&text).ok())
}

fn tokenomics_store_meta_json(
    conn: &rusqlite::Connection,
    key: &str,
    value: &Value,
) -> Result<(), String> {
    tokenomics_store_meta_value(conn, key, &value.to_string())
}

fn tokenomics_u64(value: Option<&Value>) -> u64 {
    value
        .and_then(|value| {
            value.as_u64().or_else(|| {
                value
                    .as_i64()
                    .and_then(|number| (number >= 0).then_some(number as u64))
            })
        })
        .unwrap_or(0)
}

fn tokenomics_i64_from_u64(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

fn tokenomics_usd_microusd(value: Option<&Value>) -> i64 {
    value
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite() && *number >= 0.0)
        .map(|number| (number * 1_000_000.0).round().min(i64::MAX as f64) as i64)
        .unwrap_or(0)
}

fn tokenomics_daemon_agent_kind(provider: &str) -> String {
    let provider = provider.trim().to_ascii_lowercase();
    if provider.contains("openai") || provider.contains("codex") {
        "codex".to_string()
    } else if provider.contains("anthropic") || provider.contains("claude") {
        "claude".to_string()
    } else if provider.contains("opencode") {
        "opencode".to_string()
    } else {
        provider
    }
}

fn tokenomics_daemon_account_key(provider: &str, agent_kind: &str, alias: &str) -> String {
    let alias = alias.trim();
    if alias.is_empty() {
        format!("{provider}:{agent_kind}:haider-account-unknown")
    } else {
        format!("{provider}:{agent_kind}:haider:{alias}")
    }
}

fn tokenomics_daemon_account_label(account: &Value, alias: &str) -> Option<String> {
    tokenomics_value_string(account, &["identity"])
        .or_else(|| (!alias.trim().is_empty()).then(|| alias.trim().to_string()))
}

fn tokenomics_daemon_counter_key(
    device_id: &str,
    provider: &str,
    agent_kind: &str,
    account_key: &str,
    model: Option<&str>,
) -> String {
    tokenomics_hash(&format!(
        "haider-usage-report-v1\u{1f}{device_id}\u{1f}{provider}\u{1f}{agent_kind}\u{1f}{account_key}\u{1f}{}",
        model.unwrap_or_default()
    ))
}

fn tokenomics_counter_from_breakdown(
    breakdown: &Value,
    generated_at_ms: u64,
    device_id: &str,
    account_provider: &str,
    account_agent_kind: &str,
    account_key: &str,
    account_label: Option<&str>,
) -> TokenomicsDaemonCounter {
    let provider = tokenomics_value_string(breakdown, &["provider"])
        .filter(|provider| !provider.trim().is_empty())
        .unwrap_or_else(|| account_provider.to_string());
    let agent_kind = tokenomics_daemon_agent_kind(&provider);
    let model = tokenomics_value_string(breakdown, &["model"])
        .filter(|model| !model.trim().is_empty());
    let logical_input = tokenomics_u64(breakdown.get("logical_input_tokens"));
    let uncached_input = tokenomics_u64(breakdown.get("uncached_input_tokens"));
    let cache_read = tokenomics_u64(breakdown.get("cache_read_tokens"));
    let cache_write = tokenomics_u64(breakdown.get("cache_write_tokens"));
    let output = tokenomics_u64(breakdown.get("billed_output_tokens"));
    let input = if uncached_input == 0 && cache_read == 0 && cache_write == 0 {
        logical_input
    } else {
        uncached_input
    };
    let total = logical_input.saturating_add(output);
    let cost = tokenomics_usd_microusd(breakdown.get("input_with_cache_usd"));
    let counter_key = tokenomics_daemon_counter_key(
        device_id,
        &provider,
        &agent_kind,
        account_key,
        model.as_deref(),
    );
    TokenomicsDaemonCounter {
        counter_key,
        device_id: device_id.to_string(),
        provider,
        agent_kind: if agent_kind.is_empty() {
            account_agent_kind.to_string()
        } else {
            agent_kind
        },
        provider_account_key: account_key.to_string(),
        provider_account_label: account_label.map(str::to_string),
        model,
        input_tokens: tokenomics_i64_from_u64(input),
        output_tokens: tokenomics_i64_from_u64(output),
        cache_read_tokens: tokenomics_i64_from_u64(cache_read),
        cache_write_tokens: tokenomics_i64_from_u64(cache_write),
        total_tokens: tokenomics_i64_from_u64(total),
        estimated_cost_microusd: cost,
        generated_at_ms,
    }
}

fn tokenomics_counter_from_account_totals(
    local: &Value,
    generated_at_ms: u64,
    device_id: &str,
    provider: &str,
    agent_kind: &str,
    account_key: &str,
    account_label: Option<&str>,
) -> TokenomicsDaemonCounter {
    let input = tokenomics_u64(local.get("input_tokens"));
    let output = tokenomics_u64(local.get("output_tokens"));
    let cost = tokenomics_usd_microusd(local.get("est_cost_usd"));
    TokenomicsDaemonCounter {
        counter_key: tokenomics_daemon_counter_key(
            device_id,
            provider,
            agent_kind,
            account_key,
            None,
        ),
        device_id: device_id.to_string(),
        provider: provider.to_string(),
        agent_kind: agent_kind.to_string(),
        provider_account_key: account_key.to_string(),
        provider_account_label: account_label.map(str::to_string),
        model: None,
        input_tokens: tokenomics_i64_from_u64(input),
        output_tokens: tokenomics_i64_from_u64(output),
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: tokenomics_i64_from_u64(input.saturating_add(output)),
        estimated_cost_microusd: cost,
        generated_at_ms,
    }
}

fn tokenomics_aggregate_daemon_counters(
    counters: Vec<TokenomicsDaemonCounter>,
) -> Vec<TokenomicsDaemonCounter> {
    let mut by_key = HashMap::<String, TokenomicsDaemonCounter>::new();
    for counter in counters {
        let key = counter.counter_key.clone();
        if let Some(existing) = by_key.get_mut(&key) {
            existing.input_tokens = existing.input_tokens.saturating_add(counter.input_tokens);
            existing.output_tokens = existing.output_tokens.saturating_add(counter.output_tokens);
            existing.cache_read_tokens = existing
                .cache_read_tokens
                .saturating_add(counter.cache_read_tokens);
            existing.cache_write_tokens = existing
                .cache_write_tokens
                .saturating_add(counter.cache_write_tokens);
            existing.total_tokens = existing.total_tokens.saturating_add(counter.total_tokens);
            existing.estimated_cost_microusd = existing
                .estimated_cost_microusd
                .saturating_add(counter.estimated_cost_microusd);
            existing.generated_at_ms = existing.generated_at_ms.max(counter.generated_at_ms);
            if existing.provider_account_label.is_none() {
                existing.provider_account_label = counter.provider_account_label;
            }
        } else {
            by_key.insert(key, counter);
        }
    }
    let mut counters = by_key.into_values().collect::<Vec<_>>();
    counters.sort_by(|left, right| left.counter_key.cmp(&right.counter_key));
    counters
}

fn tokenomics_display_window_kind(window: &str) -> String {
    match window.trim().to_ascii_lowercase().as_str() {
        "primary" | "five_hour" | "five-hour" | "5_hour" | "5h" | "session_5h" => {
            "5_hour".to_string()
        }
        "secondary" | "weekly" | "seven_day" | "seven-day" | "7_day" | "7d" => {
            "weekly".to_string()
        }
        other => other.to_string(),
    }
}

fn tokenomics_reset_at_from_ms(value: Option<u64>) -> Option<String> {
    value.map(|value| tokenomics_unix_iso_like(value / 1000))
}

fn tokenomics_daemon_meter_limit(
    account: &Value,
    window: &Value,
    generated_at_ms: u64,
    device_id: &str,
    provider: &str,
    agent_kind: &str,
    account_key: &str,
    account_label: Option<&str>,
) -> Option<Value> {
    let provider_window_kind = tokenomics_value_string(window, &["window"])?;
    let utilization = window.get("utilization")?.as_f64()?;
    if !utilization.is_finite() {
        return None;
    }
    let used_percent = (utilization * 100.0).clamp(0.0, 100.0);
    let remaining_percent = 100.0 - used_percent;
    let sample_at = tokenomics_unix_iso_like(generated_at_ms / 1000);
    let reset_at_ms = window.get("resets_at_ms").and_then(Value::as_u64);
    let plan = tokenomics_value_string(account, &["plan"]);
    Some(json!({
        "provider": provider,
        "agent_kind": agent_kind,
        "device_id": device_id,
        "provider_account_key": account_key,
        "provider_account_label": account_label,
        "window_kind": tokenomics_display_window_kind(&provider_window_kind),
        "provider_window_kind": provider_window_kind,
        "label": tokenomics_value_string(window, &["label"]),
        "utilization": utilization,
        "used_percent": used_percent.round() as i64,
        "remaining_percent": remaining_percent.round() as i64,
        "display_percent": remaining_percent.round() as i64,
        "display_percent_kind": "remaining",
        "reset_at": tokenomics_reset_at_from_ms(reset_at_ms),
        "sample_at": sample_at,
        "sample_at_unix": generated_at_ms / 1000,
        "updated_at": sample_at,
        "updated_at_unix": generated_at_ms / 1000,
        "limit_source": "haider_usage_report",
        "limit_source_kind": "daemon_authority",
        "confidence": "live",
        "meter_state": "metered",
        "plan_detected": plan.is_some(),
        "plan_name": plan,
        "status_label": "Provider meter reading",
        "pace_status": "unknown",
    }))
}

fn tokenomics_project_daemon_usage(
    result: &Result<haider_rpc_ade::UsageReportResult, String>,
) -> TokenomicsDaemonProjection {
    let Ok(snapshot) = result else {
        let reason = result
            .as_ref()
            .err()
            .cloned()
            .unwrap_or_else(|| "usage.report failed".to_string());
        return TokenomicsDaemonProjection {
            authority: tokenomics_unavailable_usage_authority(&reason),
            meter_states: Vec::new(),
            limits: Vec::new(),
            counters: Vec::new(),
        };
    };
    let authority = match snapshot.availability.as_ref() {
        Some(haider_rpc_ade::SnapshotAvailabilityWire::Unavailable { reason }) => {
            tokenomics_unavailable_usage_authority(reason)
        }
        Some(haider_rpc_ade::SnapshotAvailabilityWire::Unknown) => {
            tokenomics_unknown_usage_authority("daemon_report_unknown")
        }
        Some(haider_rpc_ade::SnapshotAvailabilityWire::Available) => {
            if snapshot.report.is_object() {
                json!({
                    "state": "available",
                    "source": "haider_usage_report",
                    "generated_at_ms": snapshot.report.get("generated_at_ms").and_then(Value::as_u64),
                })
            } else {
                tokenomics_unknown_usage_authority("report_missing")
            }
        }
        None => tokenomics_unknown_usage_authority("availability_missing"),
    };
    if !tokenomics_usage_authority_available(&authority) {
        return TokenomicsDaemonProjection {
            authority,
            meter_states: Vec::new(),
            limits: Vec::new(),
            counters: Vec::new(),
        };
    }

    let Some(generated_at_ms) = snapshot
        .report
        .get("generated_at_ms")
        .and_then(Value::as_u64)
    else {
        return TokenomicsDaemonProjection {
            authority: tokenomics_unknown_usage_authority("daemon_report_missing_generated_at"),
            meter_states: Vec::new(),
            limits: Vec::new(),
            counters: Vec::new(),
        };
    };
    let device_id = tokenomics_local_device_id();
    let mut meter_states = Vec::new();
    let mut limits = Vec::new();
    let mut counters = Vec::new();
    for account in snapshot
        .report
        .get("accounts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(provider) = tokenomics_value_string(account, &["provider"])
            .filter(|value| !value.trim().is_empty())
        else {
            continue;
        };
        let alias = tokenomics_value_string(account, &["alias"]).unwrap_or_default();
        let agent_kind = tokenomics_daemon_agent_kind(&provider);
        let account_key = tokenomics_daemon_account_key(&provider, &agent_kind, &alias);
        let account_label = tokenomics_daemon_account_label(account, &alias);
        let meter = account.get("meter").unwrap_or(&Value::Null);
        let meter_state = tokenomics_value_string(meter, &["state"])
            .unwrap_or_else(|| "unknown".to_string());
        let reason = tokenomics_value_string(meter, &["reason"]);
        meter_states.push(json!({
            "provider": provider,
            "agent_kind": agent_kind,
            "device_id": device_id,
            "account_alias": alias,
            "provider_account_key": account_key,
            "provider_account_label": account_label,
            "state": meter_state,
            "reason": reason,
            "local": account.get("local").cloned().unwrap_or(Value::Null),
        }));
        if meter_state == "metered" {
            for window in meter
                .get("windows")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if let Some(limit) = tokenomics_daemon_meter_limit(
                    account,
                    window,
                    generated_at_ms,
                    &device_id,
                    &provider,
                    &agent_kind,
                    &account_key,
                    account_label.as_deref(),
                ) {
                    limits.push(limit);
                }
            }
        }

        let local = account.get("local").unwrap_or(&Value::Null);
        let breakdowns = local
            .get("cache")
            .and_then(|cache| cache.get("breakdowns"))
            .and_then(Value::as_array);
        if let Some(breakdowns) = breakdowns.filter(|rows| !rows.is_empty()) {
            counters.extend(breakdowns.iter().map(|breakdown| {
                tokenomics_counter_from_breakdown(
                    breakdown,
                    generated_at_ms,
                    &device_id,
                    &provider,
                    &agent_kind,
                    &account_key,
                    account_label.as_deref(),
                )
            }));
        } else {
            counters.push(tokenomics_counter_from_account_totals(
                local,
                generated_at_ms,
                &device_id,
                &provider,
                &agent_kind,
                &account_key,
                account_label.as_deref(),
            ));
        }
    }
    TokenomicsDaemonProjection {
        authority,
        meter_states,
        limits,
        counters: tokenomics_aggregate_daemon_counters(counters),
    }
}

fn tokenomics_plan_status_value(
    snapshot: &haider_rpc_ade::HaiderCodePlanStatusSnapshot,
) -> Value {
    let authority_state = if snapshot.known {
        "available"
    } else {
        "unknown"
    };
    json!({
        "supported": snapshot.supported,
        "known": snapshot.known,
        "provider": snapshot.provider,
        "account_alias": snapshot.account_alias,
        "outcome": snapshot.outcome,
        "received_at_ms": snapshot.received_at_ms,
        "authority_state": authority_state,
    })
}

fn tokenomics_plan_status_limit(
    snapshot: &haider_rpc_ade::HaiderCodePlanStatusSnapshot,
) -> Option<Value> {
    if !snapshot.known {
        return None;
    }
    let outcome = snapshot.outcome.as_ref()?;
    let outcome_state = tokenomics_value_string(outcome, &["state"])
        .unwrap_or_else(|| "unknown".to_string());
    let provider = snapshot
        .provider
        .as_deref()
        .filter(|provider| !provider.trim().is_empty())
        .unwrap_or("haider-code");
    let alias = snapshot.account_alias.as_deref().unwrap_or_default();
    let agent_kind = tokenomics_daemon_agent_kind(provider);
    let account_key = tokenomics_daemon_account_key(provider, &agent_kind, alias);
    let snapshot_value = outcome.get("snapshot");
    let allowance = snapshot_value.and_then(|value| value.get("weekly_allowance"));
    let percent_remaining = allowance
        .and_then(|value| value.get("percent_remaining"))
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite());
    let allowance_state = allowance
        .and_then(|value| tokenomics_value_string(value, &["state"]));
    let resets_at_ms = allowance
        .and_then(|value| value.get("resets_at_ms"))
        .and_then(Value::as_u64);
    let grace_until_ms = allowance
        .and_then(|value| value.get("grace_until_ms"))
        .and_then(Value::as_u64);
    let received_at_ms = snapshot.received_at_ms.unwrap_or(0);
    let sample_at = tokenomics_unix_iso_like(received_at_ms / 1000);
    let used_percent = percent_remaining.map(|remaining| (100.0 - remaining).clamp(0.0, 100.0));
    let status_label = if percent_remaining.is_none() {
        "Allowance percentage unavailable"
    } else if outcome_state == "halted" {
        "Account halted"
    } else if outcome_state == "indeterminate" {
        "Allowance state indeterminate"
    } else {
        "Provider allowance reading"
    };
    Some(json!({
        "provider": provider,
        "agent_kind": agent_kind,
        "device_id": tokenomics_local_device_id(),
        "provider_account_key": account_key,
        "provider_account_label": alias,
        "window_kind": "weekly",
        "provider_window_kind": "weekly_allowance",
        "remaining_percent": percent_remaining,
        "used_percent": used_percent,
        "display_percent": percent_remaining,
        "display_percent_kind": "remaining",
        "allowance_state": allowance_state,
        "outcome_state": outcome_state,
        "reset_at": tokenomics_reset_at_from_ms(resets_at_ms),
        "grace_until": tokenomics_reset_at_from_ms(grace_until_ms),
        "sample_at": sample_at,
        "sample_at_unix": received_at_ms / 1000,
        "updated_at": sample_at,
        "updated_at_unix": received_at_ms / 1000,
        "limit_source": "haider_code_plan_status",
        "limit_source_kind": "daemon_authority",
        "confidence": if percent_remaining.is_some() { "live" } else { "unknown" },
        "meter_state": if percent_remaining.is_some() { "metered" } else { "unknown" },
        "plan_detected": snapshot_value.is_some(),
        "plan_name": snapshot_value.and_then(|value| {
            tokenomics_value_string(value, &["plan_label", "plan"])
        }),
        "status_label": status_label,
        "pace_status": "unknown",
    }))
}

fn tokenomics_counter_previous(
    conn: &rusqlite::Connection,
    counter_key: &str,
) -> Result<Option<TokenomicsDaemonCounter>, String> {
    match conn.query_row(
        "SELECT counter_key, device_id, provider, agent_kind, provider_account_key,
                provider_account_label, model, input_tokens, output_tokens,
                cache_read_tokens, cache_write_tokens, total_tokens,
                estimated_cost_microusd, generated_at_ms
         FROM tokenomics_daemon_usage_counters WHERE counter_key=?1",
        rusqlite::params![counter_key],
        |row| {
            Ok(TokenomicsDaemonCounter {
                counter_key: row.get(0)?,
                device_id: row.get(1)?,
                provider: row.get(2)?,
                agent_kind: row.get(3)?,
                provider_account_key: row.get(4)?,
                provider_account_label: row.get(5)?,
                model: row.get(6)?,
                input_tokens: row.get(7)?,
                output_tokens: row.get(8)?,
                cache_read_tokens: row.get(9)?,
                cache_write_tokens: row.get(10)?,
                total_tokens: row.get(11)?,
                estimated_cost_microusd: row.get(12)?,
                generated_at_ms: row.get::<_, i64>(13)?.max(0) as u64,
            })
        },
    ) {
        Ok(counter) => Ok(Some(counter)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Unable to read daemon usage baseline: {error}")),
    }
}

fn tokenomics_upsert_daemon_counter(
    conn: &rusqlite::Connection,
    counter: &TokenomicsDaemonCounter,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO tokenomics_daemon_usage_counters(
           counter_key, device_id, provider, agent_kind, provider_account_key,
           provider_account_label, model, input_tokens, output_tokens,
           cache_read_tokens, cache_write_tokens, total_tokens,
           estimated_cost_microusd, generated_at_ms, updated_at
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
         ON CONFLICT(counter_key) DO UPDATE SET
           provider_account_label=excluded.provider_account_label,
           input_tokens=excluded.input_tokens,
           output_tokens=excluded.output_tokens,
           cache_read_tokens=excluded.cache_read_tokens,
           cache_write_tokens=excluded.cache_write_tokens,
           total_tokens=excluded.total_tokens,
           estimated_cost_microusd=excluded.estimated_cost_microusd,
           generated_at_ms=excluded.generated_at_ms,
           updated_at=excluded.updated_at",
        rusqlite::params![
            counter.counter_key.as_str(),
            counter.device_id.as_str(),
            counter.provider.as_str(),
            counter.agent_kind.as_str(),
            counter.provider_account_key.as_str(),
            counter.provider_account_label.as_deref(),
            counter.model.as_deref(),
            counter.input_tokens,
            counter.output_tokens,
            counter.cache_read_tokens,
            counter.cache_write_tokens,
            counter.total_tokens,
            counter.estimated_cost_microusd,
            tokenomics_i64_from_u64(counter.generated_at_ms),
            tokenomics_now_iso_like(),
        ],
    )
    .map_err(|error| format!("Unable to store daemon usage baseline: {error}"))?;
    Ok(())
}

fn tokenomics_counter_delta(
    current: &TokenomicsDaemonCounter,
    previous: Option<&TokenomicsDaemonCounter>,
) -> Option<TokenomicsDaemonCounter> {
    let Some(previous) = previous else {
        return Some(current.clone());
    };
    let current_values = [
        current.input_tokens,
        current.output_tokens,
        current.cache_read_tokens,
        current.cache_write_tokens,
        current.total_tokens,
        current.estimated_cost_microusd,
    ];
    let previous_values = [
        previous.input_tokens,
        previous.output_tokens,
        previous.cache_read_tokens,
        previous.cache_write_tokens,
        previous.total_tokens,
        previous.estimated_cost_microusd,
    ];
    if current_values
        .iter()
        .zip(previous_values.iter())
        .any(|(current, previous)| current < previous)
    {
        return None;
    }
    let mut delta = current.clone();
    delta.input_tokens -= previous.input_tokens;
    delta.output_tokens -= previous.output_tokens;
    delta.cache_read_tokens -= previous.cache_read_tokens;
    delta.cache_write_tokens -= previous.cache_write_tokens;
    delta.total_tokens -= previous.total_tokens;
    delta.estimated_cost_microusd -= previous.estimated_cost_microusd;
    Some(delta)
}

fn tokenomics_counter_has_usage(counter: &TokenomicsDaemonCounter) -> bool {
    counter.total_tokens > 0
        || counter.input_tokens > 0
        || counter.output_tokens > 0
        || counter.cache_read_tokens > 0
        || counter.cache_write_tokens > 0
        || counter.estimated_cost_microusd > 0
}

fn tokenomics_daemon_event(counter: &TokenomicsDaemonCounter) -> TokenomicsUsageEvent {
    let observed_at = tokenomics_now_iso_like();
    let created_at = tokenomics_unix_iso_like(counter.generated_at_ms / 1000);
    let (bucket_day, bucket_hour) = tokenomics_buckets(&created_at);
    let id = tokenomics_hash(&format!(
        "haider-usage-report-delta-v1\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
        counter.counter_key,
        counter.generated_at_ms,
        counter.input_tokens,
        counter.output_tokens,
        counter.cache_read_tokens,
        counter.cache_write_tokens,
        counter.total_tokens,
    ));
    TokenomicsUsageEvent {
        id,
        device_id: counter.device_id.clone(),
        provider: counter.provider.clone(),
        agent_kind: counter.agent_kind.clone(),
        model: counter.model.clone(),
        subscription_key: Some(counter.provider_account_key.clone()),
        provider_account_key: Some(counter.provider_account_key.clone()),
        provider_account_label: counter.provider_account_label.clone(),
        source_request_id: None,
        billing_scope_type: "unknown".to_string(),
        billing_team_id: None,
        billing_scope_source: "haider_usage_report".to_string(),
        workspace_id: None,
        repo_path: None,
        source_kind: "haider_usage_report".to_string(),
        source_path: None,
        bucket_day,
        bucket_hour,
        input_tokens: counter.input_tokens,
        output_tokens: counter.output_tokens,
        cache_read_tokens: counter.cache_read_tokens,
        cache_write_tokens: counter.cache_write_tokens,
        total_tokens: counter.total_tokens,
        estimated_cost_microusd: counter.estimated_cost_microusd,
        created_at: Some(created_at),
        observed_at,
    }
}

fn tokenomics_ingest_daemon_counters(
    conn: &mut rusqlite::Connection,
    counters: &[TokenomicsDaemonCounter],
) -> Result<TokenomicsDaemonIngestResult, String> {
    let baseline_exists = tokenomics_meta_string(conn, TOKENOMICS_DAEMON_USAGE_BASELINE_KEY)
        .is_some();
    let existing_history: i64 = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM tokenomics_rollups LIMIT 1)
                    OR EXISTS(SELECT 1 FROM tokenomics_pruned_usage_rollups LIMIT 1)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Unable to inspect retained Tokenomics history: {error}"))?;
    let seed_only = !baseline_exists && existing_history != 0;
    let scope = TokenomicsBillingScope {
        scope_type: "unknown".to_string(),
        team_id: None,
        source: "haider_usage_report".to_string(),
    };
    let result = tokenomics_with_db_write_transaction(
        conn,
        "Tokenomics daemon usage report batch",
        |transaction| {
            let mut result = TokenomicsDaemonIngestResult {
                baseline_seeded: !baseline_exists,
                preserved_existing_history: seed_only,
                ..TokenomicsDaemonIngestResult::default()
            };
            for counter in counters {
                let previous = tokenomics_counter_previous(transaction, &counter.counter_key)?;
                // A missing per-counter baseline is absence, not a published
                // zero. Once any daemon baseline or retained history exists,
                // seed a newly observed account/model at its current lifetime
                // value instead of importing that lifetime value as new usage.
                let seed_counter = previous.is_none() && (baseline_exists || existing_history != 0);
                let delta = if seed_counter {
                    None
                } else {
                    tokenomics_counter_delta(counter, previous.as_ref())
                };
                if previous.is_some() && delta.is_none() {
                    result.counter_resets += 1;
                }
                if !seed_only {
                    if let Some(delta) = delta.filter(tokenomics_counter_has_usage) {
                        let event = tokenomics_daemon_event(&delta);
                        if tokenomics_insert_event_in_transaction(transaction, &event)
                            .map_err(|error| {
                                format!("Unable to record daemon Tokenomics delta: {error}")
                            })?
                        {
                            result.inserted_events += 1;
                        }
                    }
                }
                tokenomics_upsert_daemon_counter(transaction, counter)?;
                tokenomics_upsert_provider_account(
                    transaction,
                    &counter.device_id,
                    &counter.provider,
                    &counter.agent_kind,
                    &counter.provider_account_key,
                    counter.provider_account_label.as_deref(),
                    &scope,
                    "haider_usage_report",
                )?;
            }
            if !baseline_exists {
                tokenomics_store_meta_json(
                    transaction,
                    TOKENOMICS_DAEMON_USAGE_BASELINE_KEY,
                    &json!({
                        "initialized_at": tokenomics_now_iso_like(),
                        "preserved_existing_history": seed_only,
                    }),
                )?;
            }
            Ok(result)
        },
    )?;
    if result.inserted_events > 0 {
        let mut provider_pairs = counters
            .iter()
            .map(|counter| (counter.provider.clone(), counter.agent_kind.clone()))
            .collect::<Vec<_>>();
        provider_pairs.sort();
        provider_pairs.dedup();
        for (provider, agent_kind) in provider_pairs {
            tokenomics_rebuild_provider_rollups_from_events(conn, &provider, &agent_kind)?;
        }
    }
    Ok(result)
}

fn tokenomics_daemon_provider_limits(conn: &rusqlite::Connection) -> Result<Vec<Value>, String> {
    let local = tokenomics_meta_json(conn, TOKENOMICS_DAEMON_PROVIDER_LIMITS_KEY)
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    Ok(tokenomics_merge_provider_limits(
        tokenomics_cloud_provider_limits(conn)?,
        local,
    ))
}

async fn tokenomics_refresh_from_daemon(app: &AppHandle) -> Result<Value, String> {
    let usage_result = haider_rpc_ade::usage_report_rpc().await;
    let plan_status = haider_rpc_ade::haider_code_plan_status_snapshot();
    let refresh_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _span = BackendCpuSpan::new("tokenomics.daemon_usage_refresh");
        let mut conn = tokenomics_open_db(&refresh_app)?;
        let mut projection = tokenomics_project_daemon_usage(&usage_result);
        let plan_status_value = tokenomics_plan_status_value(&plan_status);
        if let Some(plan_limit) = tokenomics_plan_status_limit(&plan_status) {
            projection.limits.push(plan_limit);
        }
        tokenomics_store_meta_json(
            &conn,
            TOKENOMICS_DAEMON_USAGE_AUTHORITY_KEY,
            &projection.authority,
        )?;
        tokenomics_store_meta_json(
            &conn,
            TOKENOMICS_DAEMON_METER_STATES_KEY,
            &json!(projection.meter_states),
        )?;
        tokenomics_store_meta_json(
            &conn,
            TOKENOMICS_DAEMON_PROVIDER_LIMITS_KEY,
            &json!(projection.limits),
        )?;
        tokenomics_store_meta_json(
            &conn,
            TOKENOMICS_HAIDER_CODE_PLAN_STATUS_KEY,
            &plan_status_value,
        )?;

        let ingest = if tokenomics_usage_authority_available(&projection.authority) {
            tokenomics_ingest_daemon_counters(&mut conn, &projection.counters)?
        } else {
            TokenomicsDaemonIngestResult::default()
        };
        let mut limits = projection.limits;
        let recorded_samples = tokenomics_record_provider_limit_samples(&conn, &limits)?;
        tokenomics_apply_provider_limit_sample_pacing(&conn, &mut limits)?;
        let recorded_windows = tokenomics_record_latest_windows(&conn, &limits)?;
        if ingest.inserted_events > 0 || recorded_samples > 0 || recorded_windows > 0 {
            tokenomics_invalidate_summary_snapshots(&conn)?;
            tokenomics_clear_summary_cache();
        }
        let scope = tokenomics_current_billing_scope();
        let mut latest_windows = tokenomics_latest_window_rows(&conn, None, Some(&scope))?;
        let mut limit_samples =
            tokenomics_provider_limit_sample_sync_rows(&conn, None, Some(&scope))?;
        let retired_keys = tokenomics_retired_provider_account_keys(&conn);
        tokenomics_retain_active_account_rows(&mut latest_windows, &retired_keys);
        tokenomics_retain_active_account_rows(&mut limit_samples, &retired_keys);
        let summary = json!({
            "known": tokenomics_usage_authority_available(&projection.authority),
            "source": "haider_usage_report",
            "updated_at": tokenomics_now_iso_like(),
            "current_device_id": tokenomics_local_device_id(),
            "inserted_events": ingest.inserted_events,
            "counter_resets": ingest.counter_resets,
            "baseline_seeded": ingest.baseline_seeded,
            "preserved_existing_history": ingest.preserved_existing_history,
            "recorded_samples": recorded_samples,
            "recorded_windows": recorded_windows,
            "limits": limits,
            "latest_windows": latest_windows,
            "limit_samples": limit_samples,
            "usage_authority": projection.authority,
            "meter_states": projection.meter_states,
            "haider_code_plan_status": plan_status_value,
            "scan_index": tokenomics_scan_index_status(&conn)?,
        });
        tokenomics_store_summary_snapshot_for_app(&refresh_app, false, true, &summary);
        Ok(summary)
    })
    .await
    .map_err(|error| format!("Unable to join daemon Tokenomics refresh: {error}"))?
}

fn tokenomics_summary_inserted_events(summary: &Value) -> usize {
    summary
        .get("scan")
        .and_then(|scan| scan.get("inserted_events"))
        .or_else(|| summary.get("inserted_events"))
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or_default()
}

fn tokenomics_summary_recorded_limit_rows(summary: &Value) -> usize {
    let recorded_samples = summary
        .get("recorded_samples")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let recorded_windows = summary
        .get("recorded_windows")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    recorded_samples.saturating_add(recorded_windows) as usize
}

fn tokenomics_summary_cache() -> &'static StdMutex<Option<TokenomicsSummaryCacheEntry>> {
    TOKENOMICS_SUMMARY_CACHE.get_or_init(|| StdMutex::new(None))
}

fn tokenomics_live_limits_cache() -> &'static StdMutex<Option<TokenomicsLiveLimitsCacheEntry>> {
    TOKENOMICS_LIVE_LIMITS_CACHE.get_or_init(|| StdMutex::new(None))
}

fn tokenomics_clear_summary_cache() {
    if let Ok(mut cache) = tokenomics_summary_cache().lock() {
        *cache = None;
    }
    if let Ok(mut cache) = tokenomics_live_limits_cache().lock() {
        *cache = None;
    }
}

fn tokenomics_summary_snapshot_cache_key(include_rollups: bool, include_cloud: bool) -> String {
    format!(
        "{TOKENOMICS_SUMMARY_SNAPSHOT_CACHE_KEY_PREFIX}rollups={}:cloud={}",
        include_rollups as u8, include_cloud as u8
    )
}

fn tokenomics_read_summary_snapshot(
    conn: &rusqlite::Connection,
    include_rollups: bool,
    include_cloud: bool,
) -> Option<Value> {
    let key = tokenomics_summary_snapshot_cache_key(include_rollups, include_cloud);
    let text: String = conn
        .query_row(
            "SELECT value FROM tokenomics_meta WHERE key=?1",
            rusqlite::params![key],
            |row| row.get(0),
        )
        .ok()?;
    let payload = serde_json::from_str::<Value>(&text).ok()?;
    payload
        .get("summary")
        .filter(|summary| summary.is_object())
        .cloned()
}

fn tokenomics_store_summary_snapshot(
    conn: &rusqlite::Connection,
    include_rollups: bool,
    include_cloud: bool,
    summary: &Value,
) -> Result<(), String> {
    let key = tokenomics_summary_snapshot_cache_key(include_rollups, include_cloud);
    let payload = json!({
        "cached_at": tokenomics_now_iso_like(),
        "include_rollups": include_rollups,
        "include_cloud": include_cloud,
        "summary": summary,
    });
    let payload_text = payload.to_string();
    tokenomics_with_db_write_lock(conn, || {
        tokenomics_retry_sqlite_write("Unable to store Tokenomics summary snapshot", || {
            conn.execute(
                "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES(?1, ?2)",
                rusqlite::params![key.as_str(), payload_text.as_str()],
            )
        })
    })?;
    Ok(())
}

fn tokenomics_store_summary_snapshot_for_app(
    app: &AppHandle,
    include_rollups: bool,
    include_cloud: bool,
    summary: &Value,
) {
    if let Ok(conn) = tokenomics_open_db(app) {
        let _ = tokenomics_store_summary_snapshot(&conn, include_rollups, include_cloud, summary);
    }
}

fn tokenomics_cached_read_only_summary_for(
    app: &AppHandle,
    include_rollups: bool,
    include_cloud: bool,
) -> Result<Value, String> {
    if let Ok(cache) = tokenomics_summary_cache().lock() {
        if let Some(entry) = cache.as_ref() {
            if entry.include_rollups == include_rollups
                && entry.include_cloud == include_cloud
                && entry.cached_at.elapsed()
                    < Duration::from_millis(TOKENOMICS_SUMMARY_CACHE_TTL_MS)
            {
                return Ok(entry.summary.clone());
            }
        }
    }

    let conn = tokenomics_open_db(app)?;
    if let Some(summary) = tokenomics_read_summary_snapshot(&conn, include_rollups, include_cloud) {
        if let Ok(mut cache) = tokenomics_summary_cache().lock() {
            *cache = Some(TokenomicsSummaryCacheEntry {
                include_rollups,
                include_cloud,
                cached_at: Instant::now(),
                summary: summary.clone(),
            });
        }
        return Ok(summary);
    }

    let summary = tokenomics_summary_from_conn_with_cloud_read_only(
        &conn,
        include_rollups,
        None,
        include_cloud,
    )?;
    let _ = tokenomics_store_summary_snapshot(&conn, include_rollups, include_cloud, &summary);
    if let Ok(mut cache) = tokenomics_summary_cache().lock() {
        *cache = Some(TokenomicsSummaryCacheEntry {
            include_rollups,
            include_cloud,
            cached_at: Instant::now(),
            summary: summary.clone(),
        });
    }
    Ok(summary)
}

fn tokenomics_cached_live_limits_for(
    app: &AppHandle,
    bypass_cache: bool,
) -> Result<Value, String> {
    if !bypass_cache {
        if let Ok(cache) = tokenomics_live_limits_cache().lock() {
            if let Some(entry) = cache.as_ref() {
                if entry.cached_at.elapsed()
                    < Duration::from_millis(TOKENOMICS_LIVE_LIMITS_CACHE_TTL_MS)
                {
                    let mut summary = entry.summary.clone();
                    if let Some(object) = summary.as_object_mut() {
                        object.insert("cached".to_string(), json!(true));
                        object.insert("recorded_samples".to_string(), json!(0));
                        object.insert("recorded_windows".to_string(), json!(0));
                    }
                    return Ok(summary);
                }
            }
        }
    }

    let conn = tokenomics_open_db(app)?;
    let summary = tokenomics_live_limits_snapshot_from_conn(&conn)?;
    if let Ok(mut cache) = tokenomics_live_limits_cache().lock() {
        *cache = Some(TokenomicsLiveLimitsCacheEntry {
            cached_at: Instant::now(),
            summary: summary.clone(),
        });
    }
    Ok(summary)
}

/// One periodic Tokenomics refresh cycle. The daemon-published usage report is
/// the per-device input; its deltas and provider windows flow through the
/// existing device-keyed rollup, retention, and cloud-sync layers.
async fn tokenomics_run_periodic_sample_cycle(app: &AppHandle) -> Result<Value, String> {
    let summary = tokenomics_refresh_from_daemon(app).await?;
    let _ = tokenomics_maybe_prune_usage_events_for_app(app);
    if tokenomics_summary_inserted_events(&summary) > 0
        || tokenomics_summary_recorded_limit_rows(&summary) > 0
    {
        tokenomics_emit_updated(app, summary.clone());
    }
    Ok(summary)
}
fn tokenomics_invalidate_summary_snapshots(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM tokenomics_meta WHERE key LIKE ?1",
        rusqlite::params![format!("{TOKENOMICS_SUMMARY_SNAPSHOT_CACHE_KEY_PREFIX}%")],
    )
    .map_err(|error| format!("Unable to invalidate Tokenomics summary snapshot: {error}"))?;
    Ok(())
}

fn tokenomics_meta_string(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM tokenomics_meta WHERE key=?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn tokenomics_meta_u64(conn: &rusqlite::Connection, key: &str) -> Option<u64> {
    tokenomics_meta_string(conn, key).and_then(|value| value.parse::<u64>().ok())
}

fn tokenomics_store_meta_value(
    conn: &rusqlite::Connection,
    key: &str,
    value: &str,
) -> Result<(), String> {
    tokenomics_with_db_write_lock(conn, || {
        tokenomics_retry_sqlite_write("Unable to store Tokenomics metadata", || {
            conn.execute(
                "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES(?1, ?2)",
                rusqlite::params![key, value],
            )
        })
    })
    .map_err(|error| format!("{error}: {key}"))?;
    Ok(())
}

#[cfg_attr(not(test), allow(dead_code))]
fn tokenomics_usage_event_prune_policy_allows(
    event_bucket_unix: u64,
    now_unix: u64,
    has_day_ack: bool,
    rollup_covered: bool,
) -> bool {
    if !rollup_covered {
        return false;
    }
    let retention_cutoff = now_unix.saturating_sub(TOKENOMICS_USAGE_EVENT_RETENTION_DAYS * 86_400);
    if event_bucket_unix >= retention_cutoff {
        return false;
    }
    has_day_ack
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct TokenomicsUsageEventPruneCloudAckSeed {
    billing_scope_key: String,
    day_start_ms: i64,
    local_cursor: String,
}

fn tokenomics_usage_event_prune_cloud_ack_seed(
    billing_scope_key: &str,
    day_start_ms: i64,
    local_cursor: &str,
) -> Option<TokenomicsUsageEventPruneCloudAckSeed> {
    let billing_scope_key = billing_scope_key.trim();
    let local_cursor = local_cursor.trim();
    if billing_scope_key.is_empty() || day_start_ms < 0 || local_cursor.is_empty() {
        return None;
    }
    Some(TokenomicsUsageEventPruneCloudAckSeed {
        billing_scope_key: billing_scope_key.to_string(),
        day_start_ms,
        local_cursor: local_cursor.to_string(),
    })
}

fn tokenomics_usage_event_prune_cloud_ack_cursor(
    idempotency_key: &str,
    acked_at_ms: i64,
) -> String {
    let _ = idempotency_key;
    if acked_at_ms > 0 {
        tokenomics_unix_iso_like((acked_at_ms as u64) / 1000)
    } else {
        // No ack time means no proof the rollup predates the ack. The prune
        // guard compares `updated_at <= cursor` as ISO strings, so a non-ISO
        // fallback (like an idempotency key sorting after every date) would
        // silently DISABLE that guard. Epoch keeps it maximally strict:
        // nothing qualifies, nothing is pruned on this seed.
        "1970-01-01T00:00:00Z".to_string()
    }
}

fn tokenomics_record_usage_event_prune_cloud_acks(
    conn: &rusqlite::Connection,
    seeds: &[TokenomicsUsageEventPruneCloudAckSeed],
) -> Result<usize, String> {
    if seeds.is_empty() {
        return Ok(0);
    }
    tokenomics_with_db_write_lock(conn, || {
        let mut stored = 0usize;
        let mut newly_acked_days = 0usize;
        for seed in seeds {
            let day_start_unix = (seed.day_start_ms as u64) / 1000;
            let (bucket_day, _) = tokenomics_utc_hour_bucket_from_unix(day_start_unix);
            if bucket_day.is_empty() {
                continue;
            }
            let key = format!(
                "{TOKENOMICS_USAGE_EVENT_PRUNE_ACK_DAY_META_PREFIX}{}:{bucket_day}",
                seed.billing_scope_key
            );
            if tokenomics_meta_string(conn, &key).is_none() {
                newly_acked_days = newly_acked_days.saturating_add(1);
            }
            tokenomics_retry_sqlite_write("Unable to store Tokenomics prune day cursor", || {
                conn.execute(
                    "INSERT INTO tokenomics_meta(key, value) VALUES(?1, ?2)
                     ON CONFLICT(key) DO UPDATE SET
                       value=CASE
                         WHEN tokenomics_meta.value GLOB '????-??-??T??:??:??Z'
                              AND excluded.value GLOB '????-??-??T??:??:??Z'
                              AND tokenomics_meta.value > excluded.value
                         THEN tokenomics_meta.value
                         ELSE excluded.value
                       END",
                    rusqlite::params![key.as_str(), seed.local_cursor.as_str()],
                )
            })?;
            stored = stored.saturating_add(1);
        }
        if newly_acked_days > 0 {
            // A day just became prune-eligible for the first time; drop the 24h
            // gate so the next periodic cycle prunes it instead of waiting out
            // the interval (acks routinely land seconds after a prune check).
            tokenomics_retry_sqlite_write("Unable to reset Tokenomics prune check gate", || {
                conn.execute(
                    "DELETE FROM tokenomics_meta WHERE key=?1",
                    rusqlite::params![TOKENOMICS_USAGE_EVENT_PRUNE_LAST_CHECKED_META_KEY],
                )
            })?;
            TOKENOMICS_USAGE_EVENT_PRUNE_LAST_ATTEMPT_UNIX.store(0, Ordering::Release);
        }
        Ok(stored)
    })
}

fn tokenomics_record_usage_event_prune_cloud_ack(
    app: &AppHandle,
    billing_scope_key: &str,
    day_start_ms: Option<i64>,
    local_cursor: &str,
) -> Result<(), String> {
    let Some(day_start_ms) = day_start_ms else {
        return Ok(());
    };
    let Some(seed) =
        tokenomics_usage_event_prune_cloud_ack_seed(billing_scope_key, day_start_ms, local_cursor)
    else {
        return Ok(());
    };
    let conn = tokenomics_open_db(app)?;
    let _ = tokenomics_record_usage_event_prune_cloud_acks(&conn, &[seed])?;
    Ok(())
}

fn tokenomics_maybe_prune_usage_events_for_app(app: &AppHandle) -> Result<Value, String> {
    let now_unix = tokenomics_unix_now();
    let last_attempt = TOKENOMICS_USAGE_EVENT_PRUNE_LAST_ATTEMPT_UNIX.load(Ordering::Acquire);
    if last_attempt > 0
        && now_unix.saturating_sub(last_attempt) < TOKENOMICS_USAGE_EVENT_PRUNE_INTERVAL_SECS
    {
        return Ok(json!({ "status": "skipped", "reason": "process_interval" }));
    }
    if TOKENOMICS_USAGE_EVENT_PRUNE_LAST_ATTEMPT_UNIX
        .compare_exchange(last_attempt, now_unix, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok(json!({ "status": "skipped", "reason": "already_attempted" }));
    }

    let db_path = tokenomics_db_path(app)?;
    let mut conn = tokenomics_open_db(app)?;
    let vacuum_pending =
        tokenomics_meta_string(&conn, TOKENOMICS_USAGE_EVENT_PRUNE_VACUUM_PENDING_META_KEY)
            .is_some();
    if !vacuum_pending {
        if let Some(last_checked) =
            tokenomics_meta_u64(&conn, TOKENOMICS_USAGE_EVENT_PRUNE_LAST_CHECKED_META_KEY)
        {
            if now_unix.saturating_sub(last_checked) < TOKENOMICS_USAGE_EVENT_PRUNE_INTERVAL_SECS {
                return Ok(json!({ "status": "skipped", "reason": "meta_interval" }));
            }
        }
    }

    tokenomics_prune_usage_events(&mut conn, &db_path, now_unix, vacuum_pending)
}

fn tokenomics_prune_usage_events(
    conn: &mut rusqlite::Connection,
    db_path: &Path,
    now_unix: u64,
    vacuum_pending: bool,
) -> Result<Value, String> {
    let _retention_start = TOKENOMICS_USAGE_EVENT_RETENTION_START.get_or_init(Instant::now);
    let _maintenance_guard = match TOKENOMICS_MAINTENANCE_LOCK
        .get_or_init(|| StdMutex::new(()))
        .try_lock()
    {
        Ok(guard) => guard,
        Err(std::sync::TryLockError::WouldBlock) => {
            TOKENOMICS_USAGE_EVENT_PRUNE_LAST_ATTEMPT_UNIX.store(0, Ordering::Release);
            return Ok(json!({ "status": "skipped", "reason": "maintenance_active" }));
        }
        Err(std::sync::TryLockError::Poisoned(error)) => error.into_inner(),
    };

    let retention_cutoff_unix =
        now_unix.saturating_sub(TOKENOMICS_USAGE_EVENT_RETENTION_DAYS * 86_400);
    let (_, retention_cutoff_hour) = tokenomics_utc_hour_bucket_from_unix(retention_cutoff_unix);

    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS tokenomics_prune_candidate_rowids(rowid INTEGER PRIMARY KEY)",
        [],
    )
    .map_err(|error| format!("Unable to prepare Tokenomics prune candidates: {error}"))?;
    conn.execute("DELETE FROM tokenomics_prune_candidate_rowids", [])
        .map_err(|error| format!("Unable to clear Tokenomics prune candidates: {error}"))?;

    // Iterate day by day: one day whose ack cursor is stale must not occupy
    // the candidate window forever and starve prunable days behind it.
    let prune_days: Vec<String> = {
        let mut statement = conn
            .prepare(
                "SELECT DISTINCT bucket_day FROM tokenomics_usage_events
                 WHERE bucket_hour < ?1 AND bucket_day GLOB '????-??-??'
                 ORDER BY bucket_day ASC",
            )
            .map_err(|error| format!("Unable to list Tokenomics prune days: {error}"))?;
        let rows = statement
            .query_map(rusqlite::params![retention_cutoff_hour], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| format!("Unable to list Tokenomics prune days: {error}"))?;
        rows.filter_map(Result::ok).collect()
    };

    let mut deleted_total = 0usize;
    for prune_day in &prune_days {
        loop {
            let deleted =
                tokenomics_prune_usage_event_chunk(conn, &retention_cutoff_hour, prune_day)?;
            if deleted == 0 {
                break;
            }
            deleted_total = deleted_total.saturating_add(deleted);
            thread::sleep(Duration::from_millis(25));
            if deleted < TOKENOMICS_USAGE_EVENT_PRUNE_CHUNK_ROWS {
                break;
            }
        }
    }

    // Rows past retention with a day ack can still be rejected by the
    // rollup-coverage guard when the ack cursor predates a rollup rebuild.
    // Those cursors refresh on the next cloud sync cycle, so a blocked run
    // backdates its check gate to retry in ~1h instead of a full interval.
    let blocked = deleted_total == 0
        && conn
            .query_row(
                "SELECT EXISTS(
                   SELECT 1
                   FROM tokenomics_usage_events e
                   JOIN tokenomics_meta day_ack
                     ON day_ack.key=?2 ||
                       CASE
                         WHEN COALESCE(NULLIF(e.billing_scope_type, ''), 'unknown')='team'
                           AND NULLIF(e.billing_team_id, '') IS NOT NULL
                         THEN 'team:' || e.billing_team_id
                         WHEN COALESCE(NULLIF(e.billing_scope_type, ''), 'unknown')='personal'
                         THEN 'personal'
                         ELSE 'unknown'
                       END || ':' || e.bucket_day
                    AND NULLIF(day_ack.value, '') IS NOT NULL
                   WHERE e.bucket_hour < ?1
                   LIMIT 1
                 )",
                rusqlite::params![
                    retention_cutoff_hour,
                    TOKENOMICS_USAGE_EVENT_PRUNE_ACK_DAY_META_PREFIX
                ],
                |row| row.get::<_, bool>(0),
            )
            .unwrap_or(false);
    let recheck_gate_unix = if blocked {
        now_unix.saturating_sub(TOKENOMICS_USAGE_EVENT_PRUNE_INTERVAL_SECS.saturating_sub(3_600))
    } else {
        now_unix
    };
    if blocked {
        TOKENOMICS_USAGE_EVENT_PRUNE_LAST_ATTEMPT_UNIX.store(recheck_gate_unix, Ordering::Release);
        // Blocked rows usually mean stale ack cursors on days outside the
        // cloud sync window. Re-open the one-time historical seeding pass so
        // the next sync cycle re-verifies those days' content hashes and
        // reseeds fresh cursors.
        let _ = conn.execute(
            "DELETE FROM tokenomics_meta
             WHERE key LIKE 'usage_event_prune_historical_day_ack_seed_done_v1:%'
                OR key LIKE 'usage_event_prune_historical_day_ack_seed_progress_v1:%'",
            [],
        );
    }

    tokenomics_store_meta_value(
        conn,
        TOKENOMICS_USAGE_EVENT_PRUNE_LAST_CHECKED_META_KEY,
        &recheck_gate_unix.to_string(),
    )?;

    let vacuum = tokenomics_maybe_vacuum_after_usage_event_prune(
        conn,
        db_path,
        deleted_total,
        vacuum_pending,
    )?;
    let vacuum_ran = vacuum.get("status").and_then(Value::as_str) == Some("ok");
    if deleted_total > 0 && !vacuum_ran {
        // Long-lived headless processes otherwise accumulate a large WAL
        // between the rare vacuums; the daily prune is the natural point to
        // fold it back. Best-effort with a short busy window: a busy reader
        // makes this round skip instead of stalling the prune thread for the
        // full 30s connection busy timeout.
        let _ = conn.busy_timeout(Duration::from_millis(100));
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
        let _ = conn.busy_timeout(Duration::from_millis(TOKENOMICS_SQLITE_BUSY_TIMEOUT_MS));
    }

    Ok(json!({
        "status": "ok",
        "deleted_usage_events": deleted_total,
        "retention_days": TOKENOMICS_USAGE_EVENT_RETENTION_DAYS,
        "vacuum": vacuum,
    }))
}

struct TokenomicsPruneSourceIdentityCapture {
    provider: String,
    agent_kind: String,
    source_path: String,
    source_kind: String,
    account_key: String,
    account_label: Option<String>,
    billing_scope_type: String,
    billing_team_id: Option<String>,
    billing_scope_source: String,
    event_count: i64,
}

fn tokenomics_capture_prune_source_import_identities(
    conn: &rusqlite::Connection,
    now: &str,
) -> Result<(), String> {
    let mut statement = conn
        .prepare(
            "WITH candidate_identity_rows AS (
               SELECT
                 e.provider,
                 e.agent_kind,
                 CASE
                   WHEN instr(COALESCE(e.source_path, ''), '.jsonl:') > 0
                   THEN substr(e.source_path, 1, instr(e.source_path, '.jsonl:') + 5)
                   ELSE e.source_path
                 END AS source_path,
                 COALESCE(NULLIF(e.source_kind, ''), 'jsonl') AS source_kind,
                 COALESCE(NULLIF(e.provider_account_key, ''), NULLIF(e.subscription_key, '')) AS account_key,
                 NULLIF(e.provider_account_label, '') AS account_label,
                 COALESCE(NULLIF(e.billing_scope_type, ''), 'unknown') AS billing_scope_type,
                 NULLIF(e.billing_team_id, '') AS billing_team_id,
                 COALESCE(NULLIF(e.billing_scope_source, ''), 'unknown') AS billing_scope_source,
                 COALESCE(e.observed_at, '') AS observed_at
               FROM tokenomics_prune_candidate_rowids c
               CROSS JOIN tokenomics_usage_events e ON e.rowid=c.rowid
               WHERE TRIM(COALESCE(e.source_path, ''))!=''
             )
             SELECT
               provider,
               agent_kind,
               source_path,
               MAX(source_kind) AS source_kind,
               account_key,
               NULLIF(MAX(account_label), '') AS account_label,
               billing_scope_type,
               billing_team_id,
               MAX(billing_scope_source) AS billing_scope_source,
               COUNT(*) AS event_count,
               MAX(observed_at) AS latest_observed_at
             FROM candidate_identity_rows
             WHERE account_key IS NOT NULL
               AND TRIM(account_key)!=''
               AND TRIM(COALESCE(source_path, ''))!=''
             GROUP BY provider, agent_kind, source_path, account_key, billing_scope_type, billing_team_id
             ORDER BY provider, agent_kind, source_path, event_count DESC, latest_observed_at DESC",
        )
        .map_err(|error| {
            format!("Unable to prepare pruned Tokenomics source identity capture: {error}")
        })?;
    let rows = statement
        .query_map([], |row| {
            Ok(TokenomicsPruneSourceIdentityCapture {
                provider: row.get(0)?,
                agent_kind: row.get(1)?,
                source_path: row.get(2)?,
                source_kind: row.get(3)?,
                account_key: row.get(4)?,
                account_label: row.get(5)?,
                billing_scope_type: row.get(6)?,
                billing_team_id: row.get(7)?,
                billing_scope_source: row.get(8)?,
                event_count: row.get(9)?,
            })
        })
        .map_err(|error| {
            format!("Unable to query pruned Tokenomics source identity capture: {error}")
        })?;
    let mut captures = Vec::new();
    let mut seen = HashSet::<String>::new();
    for row in rows {
        let capture = row.map_err(|error| {
            format!("Unable to read pruned Tokenomics source identity capture: {error}")
        })?;
        let key = format!(
            "{}\u{1f}{}\u{1f}{}",
            capture.provider.as_str(),
            capture.agent_kind.as_str(),
            capture.source_path.as_str()
        );
        if seen.insert(key) {
            captures.push(capture);
        }
    }
    drop(statement);

    for capture in captures {
        conn.execute(
            "INSERT INTO tokenomics_source_imports(
                   provider, agent_kind, source_path, source_id, source_kind, scanner_version,
                   event_count, provider_account_key, provider_account_label, billing_scope_type,
                   billing_team_id, billing_scope_source, raw_available, raw_deleted_at,
                   import_status, updated_at
                 ) VALUES(?1, ?2, ?3, '', ?4, 'prune-identity-capture-v1',
                   ?5, ?6, ?7, ?8, ?9, ?10, 1, NULL, 'complete', ?11)
                 ON CONFLICT(provider, agent_kind, source_path)
                 DO UPDATE SET
                   provider_account_key=CASE
                     WHEN TRIM(COALESCE(tokenomics_source_imports.provider_account_key, ''))=''
                     THEN excluded.provider_account_key
                     ELSE tokenomics_source_imports.provider_account_key
                   END,
                   provider_account_label=CASE
                     WHEN TRIM(COALESCE(tokenomics_source_imports.provider_account_label, ''))=''
                     THEN excluded.provider_account_label
                     ELSE tokenomics_source_imports.provider_account_label
                   END,
                   billing_scope_type=CASE
                     WHEN TRIM(COALESCE(tokenomics_source_imports.billing_scope_type, ''))=''
                       OR tokenomics_source_imports.billing_scope_type='unknown'
                     THEN excluded.billing_scope_type
                     ELSE tokenomics_source_imports.billing_scope_type
                   END,
                   billing_team_id=CASE
                     WHEN TRIM(COALESCE(tokenomics_source_imports.billing_team_id, ''))=''
                     THEN excluded.billing_team_id
                     ELSE tokenomics_source_imports.billing_team_id
                   END,
                   billing_scope_source=CASE
                     WHEN TRIM(COALESCE(tokenomics_source_imports.billing_scope_source, ''))=''
                       OR tokenomics_source_imports.billing_scope_source='unknown'
                     THEN excluded.billing_scope_source
                     ELSE tokenomics_source_imports.billing_scope_source
                   END",
            rusqlite::params![
                capture.provider.as_str(),
                capture.agent_kind.as_str(),
                capture.source_path.as_str(),
                capture.source_kind.as_str(),
                capture.event_count,
                capture.account_key.as_str(),
                capture.account_label.as_deref(),
                capture.billing_scope_type.as_str(),
                capture.billing_team_id.as_deref(),
                capture.billing_scope_source.as_str(),
                now,
            ],
        )
        .map_err(|error| format!("Unable to capture pruned Tokenomics source identity: {error}"))?;
    }
    Ok(())
}

struct TokenomicsFoldedUsageGroup {
    device_id: String,
    provider: String,
    agent_kind: String,
    model: Option<String>,
    subscription_key: Option<String>,
    provider_account_key: Option<String>,
    provider_account_label: Option<String>,
    billing_scope_type: String,
    billing_team_id: Option<String>,
    billing_scope_source: String,
    workspace_id: Option<String>,
    repo_path: Option<String>,
    bucket_hour: String,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    total_tokens: i64,
    estimated_cost_microusd: i64,
    event_count: i64,
}

impl TokenomicsFoldedUsageGroup {
    fn scoped_key(&self) -> TokenomicsScopedRollupKey {
        TokenomicsScopedRollupKey {
            device_id: self.device_id.clone(),
            model: self.model.clone(),
            subscription_key: self.subscription_key.clone(),
            provider_account_key: self.provider_account_key.clone(),
            billing_scope_type: self.billing_scope_type.clone(),
            billing_team_id: self.billing_team_id.clone(),
            workspace_id: self.workspace_id.clone(),
            bucket_start: self.bucket_hour.clone(),
        }
    }
}

fn tokenomics_fold_prune_candidates_into_tombstones(
    conn: &rusqlite::Connection,
    now: &str,
) -> Result<usize, String> {
    tokenomics_capture_prune_source_import_identities(conn, now)?;

    let mut statement = conn
        .prepare(
            "SELECT
               e.device_id, e.provider, e.agent_kind,
               NULLIF(e.model, ''), NULLIF(e.subscription_key, ''),
               NULLIF(e.provider_account_key, ''), MAX(NULLIF(e.provider_account_label, '')),
               COALESCE(NULLIF(e.billing_scope_type, ''), 'unknown'),
               NULLIF(e.billing_team_id, ''),
               MAX(COALESCE(NULLIF(e.billing_scope_source, ''), 'unknown')),
               NULLIF(e.workspace_id, ''), MAX(NULLIF(e.repo_path, '')),
               e.bucket_hour,
               COALESCE(SUM(e.input_tokens), 0),
               COALESCE(SUM(e.output_tokens), 0),
               COALESCE(SUM(e.cache_read_tokens), 0),
               COALESCE(SUM(e.cache_write_tokens), 0),
               COALESCE(SUM(e.total_tokens), 0),
               COALESCE(SUM(e.estimated_cost_microusd), 0),
               COUNT(*)
             FROM tokenomics_usage_events e
             JOIN tokenomics_prune_candidate_rowids c ON c.rowid=e.rowid
             GROUP BY e.device_id, e.provider, e.agent_kind,
               NULLIF(e.model, ''), NULLIF(e.subscription_key, ''),
               NULLIF(e.provider_account_key, ''),
               COALESCE(NULLIF(e.billing_scope_type, ''), 'unknown'),
               NULLIF(e.billing_team_id, ''), NULLIF(e.workspace_id, ''), e.bucket_hour",
        )
        .map_err(|error| format!("Unable to prepare pruned Tokenomics event fold: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(TokenomicsFoldedUsageGroup {
                device_id: row.get(0)?,
                provider: row.get(1)?,
                agent_kind: row.get(2)?,
                model: row.get(3)?,
                subscription_key: row.get(4)?,
                provider_account_key: row.get(5)?,
                provider_account_label: row.get(6)?,
                billing_scope_type: row.get(7)?,
                billing_team_id: row.get(8)?,
                billing_scope_source: row.get(9)?,
                workspace_id: row.get(10)?,
                repo_path: row.get(11)?,
                bucket_hour: row.get(12)?,
                input_tokens: row.get(13)?,
                output_tokens: row.get(14)?,
                cache_read_tokens: row.get(15)?,
                cache_write_tokens: row.get(16)?,
                total_tokens: row.get(17)?,
                estimated_cost_microusd: row.get(18)?,
                event_count: row.get(19)?,
            })
        })
        .map_err(|error| format!("Unable to query pruned Tokenomics event fold: {error}"))?;
    let mut groups = Vec::new();
    for row in rows {
        groups.push(
            row.map_err(|error| format!("Unable to read pruned Tokenomics event fold: {error}"))?,
        );
    }
    drop(statement);

    for group in &groups {
        let id = tokenomics_rollup_id(
            &group.device_id,
            &group.provider,
            &group.agent_kind,
            group.model.as_deref(),
            group.subscription_key.as_deref(),
            group.provider_account_key.as_deref(),
            &group.billing_scope_type,
            group.billing_team_id.as_deref(),
            group.workspace_id.as_deref(),
            "hour",
            &group.bucket_hour,
        );
        conn.execute(
            "INSERT INTO tokenomics_pruned_usage_rollups(
               id, device_id, provider, agent_kind, model, subscription_key,
               provider_account_key, provider_account_label,
               billing_scope_type, billing_team_id, billing_scope_source,
               workspace_id, repo_path, bucket_width, bucket_start,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
               total_tokens, estimated_cost_microusd, event_count, updated_at
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
               'hour', ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
             ON CONFLICT(id) DO UPDATE SET
               input_tokens=tokenomics_pruned_usage_rollups.input_tokens+excluded.input_tokens,
               output_tokens=tokenomics_pruned_usage_rollups.output_tokens+excluded.output_tokens,
               cache_read_tokens=tokenomics_pruned_usage_rollups.cache_read_tokens+excluded.cache_read_tokens,
               cache_write_tokens=tokenomics_pruned_usage_rollups.cache_write_tokens+excluded.cache_write_tokens,
               total_tokens=tokenomics_pruned_usage_rollups.total_tokens+excluded.total_tokens,
               estimated_cost_microusd=tokenomics_pruned_usage_rollups.estimated_cost_microusd+excluded.estimated_cost_microusd,
               event_count=tokenomics_pruned_usage_rollups.event_count+excluded.event_count,
               provider_account_label=COALESCE(excluded.provider_account_label, tokenomics_pruned_usage_rollups.provider_account_label),
               billing_scope_source=COALESCE(excluded.billing_scope_source, tokenomics_pruned_usage_rollups.billing_scope_source),
               repo_path=COALESCE(excluded.repo_path, tokenomics_pruned_usage_rollups.repo_path),
               updated_at=excluded.updated_at",
            rusqlite::params![
                id,
                group.device_id.as_str(),
                group.provider.as_str(),
                group.agent_kind.as_str(),
                group.model.as_deref(),
                group.subscription_key.as_deref(),
                group.provider_account_key.as_deref(),
                group.provider_account_label.as_deref(),
                group.billing_scope_type.as_str(),
                group.billing_team_id.as_deref(),
                group.billing_scope_source.as_str(),
                group.workspace_id.as_deref(),
                group.repo_path.as_deref(),
                group.bucket_hour.as_str(),
                group.input_tokens,
                group.output_tokens,
                group.cache_read_tokens,
                group.cache_write_tokens,
                group.total_tokens,
                group.estimated_cost_microusd,
                group.event_count,
                now,
            ],
        )
        .map_err(|error| format!("Unable to preserve pruned Tokenomics rollups: {error}"))?;
    }

    conn.execute(
        "INSERT OR IGNORE INTO tokenomics_frozen_source_hours(
           provider, agent_kind, source_path, bucket_hour, folded_at
         )
         SELECT DISTINCT e.provider, e.agent_kind,
           CASE
             WHEN instr(e.source_path, '.jsonl:') > 0
             THEN substr(e.source_path, 1, instr(e.source_path, '.jsonl:') + 5)
             ELSE e.source_path
           END,
           e.bucket_hour, ?1
         FROM tokenomics_usage_events e
         JOIN tokenomics_prune_candidate_rowids c ON c.rowid=e.rowid
         WHERE TRIM(COALESCE(e.source_path, ''))!=''",
        rusqlite::params![now],
    )
    .map_err(|error| format!("Unable to freeze pruned Tokenomics source hours: {error}"))?;

    conn.execute(
        "INSERT OR IGNORE INTO tokenomics_usage_event_tombstones(
               id, provider, agent_kind, bucket_day, bucket_hour, pruned_at
             )
             SELECT id, provider, agent_kind, bucket_day, bucket_hour, ?1
             FROM tokenomics_usage_events
             WHERE rowid IN (SELECT rowid FROM tokenomics_prune_candidate_rowids)",
        rusqlite::params![now],
    )
    .map_err(|error| format!("Unable to store Tokenomics prune tombstones: {error}"))?;

    let deleted = conn
        .execute(
            "DELETE FROM tokenomics_usage_events
             WHERE rowid IN (SELECT rowid FROM tokenomics_prune_candidate_rowids)",
            [],
        )
        .map_err(|error| format!("Unable to prune Tokenomics usage events: {error}"))?;

    let mut scoped_by_provider = HashMap::<(String, String), Vec<TokenomicsScopedRollupKey>>::new();
    for group in &groups {
        scoped_by_provider
            .entry((group.provider.clone(), group.agent_kind.clone()))
            .or_default()
            .push(group.scoped_key());
    }
    for ((provider, agent_kind), keys) in scoped_by_provider {
        tokenomics_rebuild_provider_rollups_for_scoped_hours(conn, &provider, &agent_kind, keys)?;
    }
    Ok(deleted)
}

fn tokenomics_prune_usage_event_chunk(
    conn: &mut rusqlite::Connection,
    retention_cutoff_hour: &str,
    bucket_day: &str,
) -> Result<usize, String> {
    let Some(settlement_day) = tokenomics_finalization_settlement_day(conn)? else {
        return Ok(0);
    };
    if bucket_day >= settlement_day.as_str() {
        return Ok(0);
    }
    let now = tokenomics_now_iso_like();
    let chunk_limit = TOKENOMICS_USAGE_EVENT_PRUNE_CHUNK_ROWS as i64;
    conn.execute("DELETE FROM tokenomics_prune_candidate_rowids", [])
        .map_err(|error| format!("Unable to reset Tokenomics prune chunk: {error}"))?;
    conn.execute(
            "INSERT OR IGNORE INTO tokenomics_prune_candidate_rowids(rowid)
             WITH candidate_window AS (
               SELECT
                 e.rowid,
                 e.device_id,
                 e.provider,
                 e.agent_kind,
                 COALESCE(NULLIF(e.model, ''), '') AS model_key,
                 COALESCE(NULLIF(e.subscription_key, ''), '') AS subscription_key,
                 COALESCE(NULLIF(e.provider_account_key, ''), '') AS provider_account_key,
                 COALESCE(NULLIF(e.billing_scope_type, ''), 'unknown') AS billing_scope_type,
                 COALESCE(NULLIF(e.billing_team_id, ''), '') AS billing_team_id,
                 COALESCE(NULLIF(e.workspace_id, ''), '') AS workspace_id,
                 e.bucket_day,
                 e.bucket_hour,
                 day_ack.value AS sync_cursor
               FROM tokenomics_usage_events e
               JOIN tokenomics_meta day_ack
                 ON day_ack.key=?2 ||
                   CASE
                     WHEN COALESCE(NULLIF(e.billing_scope_type, ''), 'unknown')='team'
                       AND NULLIF(e.billing_team_id, '') IS NOT NULL
                     THEN 'team:' || e.billing_team_id
                     WHEN COALESCE(NULLIF(e.billing_scope_type, ''), 'unknown')='personal'
                     THEN 'personal'
                     ELSE 'unknown'
                   END || ':' || e.bucket_day
                AND NULLIF(day_ack.value, '') IS NOT NULL
               WHERE e.bucket_hour < ?1
                 AND e.bucket_hour>=?4 || 'T00:00:00Z'
                 AND e.bucket_hour<=?4 || 'T23:59:59Z'
                 AND e.bucket_day=?4
                 AND e.bucket_hour GLOB '????-??-??T??:00:00Z'
                 AND e.bucket_day GLOB '????-??-??'
               ORDER BY e.bucket_hour ASC, e.rowid ASC
               LIMIT ?3
             ),
             candidate_groups AS (
               SELECT DISTINCT
                 device_id, provider, agent_kind, model_key, subscription_key,
                 provider_account_key, billing_scope_type, billing_team_id,
                 workspace_id, bucket_hour, sync_cursor
               FROM candidate_window
             ),
             event_groups AS (
               SELECT
                 e.device_id,
                 e.provider,
                 e.agent_kind,
                 COALESCE(NULLIF(e.model, ''), '') AS model_key,
                 COALESCE(NULLIF(e.subscription_key, ''), '') AS subscription_key,
                 COALESCE(NULLIF(e.provider_account_key, ''), '') AS provider_account_key,
                 COALESCE(NULLIF(e.billing_scope_type, ''), 'unknown') AS billing_scope_type,
                 COALESCE(NULLIF(e.billing_team_id, ''), '') AS billing_team_id,
                 COALESCE(NULLIF(e.workspace_id, ''), '') AS workspace_id,
                 e.bucket_hour,
                 g.sync_cursor,
                 COALESCE(SUM(e.input_tokens), 0) AS input_tokens,
                 COALESCE(SUM(e.output_tokens), 0) AS output_tokens,
                 COALESCE(SUM(e.cache_read_tokens), 0) AS cache_read_tokens,
                 COALESCE(SUM(e.cache_write_tokens), 0) AS cache_write_tokens,
                 COALESCE(SUM(e.total_tokens), 0) AS total_tokens,
                 COALESCE(SUM(e.estimated_cost_microusd), 0) AS estimated_cost_microusd,
                 COUNT(*) AS event_count
               FROM tokenomics_usage_events e
               JOIN candidate_groups g
                 ON g.device_id=e.device_id
                AND g.provider=e.provider
                AND g.agent_kind=e.agent_kind
                AND g.model_key=COALESCE(NULLIF(e.model, ''), '')
                AND g.subscription_key=COALESCE(NULLIF(e.subscription_key, ''), '')
                AND g.provider_account_key=COALESCE(NULLIF(e.provider_account_key, ''), '')
                AND g.billing_scope_type=COALESCE(NULLIF(e.billing_scope_type, ''), 'unknown')
                AND g.billing_team_id=COALESCE(NULLIF(e.billing_team_id, ''), '')
                AND g.workspace_id=COALESCE(NULLIF(e.workspace_id, ''), '')
                AND g.bucket_hour=e.bucket_hour
               GROUP BY e.device_id, e.provider, e.agent_kind,
                 COALESCE(NULLIF(e.model, ''), ''), COALESCE(NULLIF(e.subscription_key, ''), ''),
                 COALESCE(NULLIF(e.provider_account_key, ''), ''),
                 COALESCE(NULLIF(e.billing_scope_type, ''), 'unknown'),
                 COALESCE(NULLIF(e.billing_team_id, ''), ''), COALESCE(NULLIF(e.workspace_id, ''), ''),
                 e.bucket_hour, g.sync_cursor
             )
             SELECT e.rowid
             FROM candidate_window e
             JOIN event_groups g
               ON g.device_id=e.device_id
              AND g.provider=e.provider
              AND g.agent_kind=e.agent_kind
              AND g.model_key=e.model_key
              AND g.subscription_key=e.subscription_key
              AND g.provider_account_key=e.provider_account_key
              AND g.billing_scope_type=e.billing_scope_type
              AND g.billing_team_id=e.billing_team_id
              AND g.workspace_id=e.workspace_id
              AND g.bucket_hour=e.bucket_hour
              AND g.sync_cursor=e.sync_cursor
             JOIN tokenomics_rollups r
               ON r.bucket_width='hour'
              AND r.device_id=g.device_id
              AND r.provider=g.provider
              AND r.agent_kind=g.agent_kind
              AND COALESCE(r.model, '')=g.model_key
              AND COALESCE(r.subscription_key, '')=g.subscription_key
              AND COALESCE(r.provider_account_key, '')=g.provider_account_key
              AND COALESCE(NULLIF(r.billing_scope_type, ''), 'unknown')=g.billing_scope_type
              AND COALESCE(r.billing_team_id, '')=g.billing_team_id
              AND COALESCE(r.workspace_id, '')=g.workspace_id
              AND r.bucket_start=g.bucket_hour
             LEFT JOIN tokenomics_pruned_usage_rollups p
               ON p.id=r.id
             WHERE r.updated_at <= g.sync_cursor
               AND r.input_tokens=g.input_tokens+COALESCE(p.input_tokens, 0)
               AND r.output_tokens=g.output_tokens+COALESCE(p.output_tokens, 0)
               AND r.cache_read_tokens=g.cache_read_tokens+COALESCE(p.cache_read_tokens, 0)
               AND r.cache_write_tokens=g.cache_write_tokens+COALESCE(p.cache_write_tokens, 0)
               AND r.total_tokens=g.total_tokens+COALESCE(p.total_tokens, 0)
               AND r.estimated_cost_microusd=g.estimated_cost_microusd+COALESCE(p.estimated_cost_microusd, 0)
               AND r.event_count=g.event_count+COALESCE(p.event_count, 0)
             ORDER BY e.bucket_hour ASC, e.rowid ASC",
        rusqlite::params![
            retention_cutoff_hour,
            TOKENOMICS_USAGE_EVENT_PRUNE_ACK_DAY_META_PREFIX,
            chunk_limit,
            bucket_day
        ],
    )
    .map_err(|error| format!("Unable to select Tokenomics prune chunk: {error}"))?;
    let inserted: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM tokenomics_prune_candidate_rowids",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        .max(0) as usize;
    if inserted == 0 {
        return Ok(0);
    }
    let deleted = tokenomics_with_db_write_transaction(
        conn,
        "Tokenomics usage event prune chunk",
        |transaction| {
            let deleted =
                tokenomics_fold_prune_candidates_into_tombstones(transaction, now.as_str())?;
            transaction
                .execute("DELETE FROM tokenomics_prune_candidate_rowids", [])
                .map_err(|error| format!("Unable to clear Tokenomics prune chunk: {error}"))?;
            Ok(deleted)
        },
    )?;
    Ok(deleted)
}

fn tokenomics_maybe_vacuum_after_usage_event_prune(
    conn: &rusqlite::Connection,
    db_path: &Path,
    deleted_total: usize,
    vacuum_pending: bool,
) -> Result<Value, String> {
    // Deletes accumulate across prune runs; vacuum whenever enough rows have
    // been reclaimed since the last vacuum, not just once ever. The DB-size
    // trigger stays first-vacuum-only so a large-but-stable file does not
    // re-vacuum on every small prune.
    let deleted_since_vacuum = tokenomics_meta_u64(
        conn,
        TOKENOMICS_USAGE_EVENT_PRUNE_DELETED_SINCE_VACUUM_META_KEY,
    )
    .unwrap_or(0)
    .saturating_add(deleted_total as u64);
    if deleted_total > 0 {
        tokenomics_store_meta_value(
            conn,
            TOKENOMICS_USAGE_EVENT_PRUNE_DELETED_SINCE_VACUUM_META_KEY,
            &deleted_since_vacuum.to_string(),
        )?;
    }
    let first_vacuum_done =
        tokenomics_meta_string(conn, TOKENOMICS_USAGE_EVENT_PRUNE_VACUUM_DONE_META_KEY).is_some();
    let db_size = fs::metadata(db_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let should_vacuum = vacuum_pending
        || deleted_since_vacuum >= TOKENOMICS_USAGE_EVENT_VACUUM_MIN_DELETED_ROWS as u64
        || (!first_vacuum_done
            && deleted_total > 0
            && db_size >= TOKENOMICS_USAGE_EVENT_VACUUM_MIN_DB_BYTES);
    if !should_vacuum {
        return Ok(json!({ "status": "skipped", "reason": "below_threshold" }));
    }
    if TOKENOMICS_USAGE_EVENT_RETENTION_START
        .get_or_init(Instant::now)
        .elapsed()
        < Duration::from_secs(TOKENOMICS_USAGE_EVENT_VACUUM_STARTUP_GRACE_SECS)
    {
        tokenomics_store_meta_value(
            conn,
            TOKENOMICS_USAGE_EVENT_PRUNE_VACUUM_PENDING_META_KEY,
            &tokenomics_unix_now().to_string(),
        )?;
        TOKENOMICS_USAGE_EVENT_PRUNE_LAST_ATTEMPT_UNIX.store(0, Ordering::Release);
        return Ok(json!({ "status": "deferred", "reason": "startup_grace" }));
    }

    tokenomics_store_meta_value(
        conn,
        TOKENOMICS_USAGE_EVENT_PRUNE_VACUUM_PENDING_META_KEY,
        &tokenomics_unix_now().to_string(),
    )?;
    log_terminal_status_event(
        "backend.tokenomics.usage_event_vacuum_start",
        json!({
            "deleted_usage_events": deleted_total,
            "db_size_bytes": db_size,
        }),
    );
    if let Err(error) = tokenomics_with_db_write_lock(conn, || {
        tokenomics_retry_sqlite_write("Unable to vacuum Tokenomics database", || {
            conn.execute_batch("VACUUM")
        })
    }) {
        TOKENOMICS_USAGE_EVENT_PRUNE_LAST_ATTEMPT_UNIX.store(0, Ordering::Release);
        return Err(error);
    }
    tokenomics_with_db_write_lock(conn, || {
        tokenomics_retry_sqlite_write("Unable to record Tokenomics vacuum", || {
            conn.execute(
                "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES(?1, ?2)",
                rusqlite::params![
                    TOKENOMICS_USAGE_EVENT_PRUNE_VACUUM_DONE_META_KEY,
                    tokenomics_unix_now().to_string()
                ],
            )
        })?;
        tokenomics_retry_sqlite_write("Unable to clear Tokenomics vacuum pending flag", || {
            conn.execute(
                "DELETE FROM tokenomics_meta WHERE key=?1",
                rusqlite::params![TOKENOMICS_USAGE_EVENT_PRUNE_VACUUM_PENDING_META_KEY],
            )
        })?;
        tokenomics_retry_sqlite_write("Unable to reset Tokenomics vacuum delete counter", || {
            conn.execute(
                "DELETE FROM tokenomics_meta WHERE key=?1",
                rusqlite::params![TOKENOMICS_USAGE_EVENT_PRUNE_DELETED_SINCE_VACUUM_META_KEY],
            )
        })?;
        Ok(())
    })?;
    let final_size = fs::metadata(db_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    log_terminal_status_event(
        "backend.tokenomics.usage_event_vacuum_complete",
        json!({
            "deleted_usage_events": deleted_total,
            "db_size_before_bytes": db_size,
            "db_size_after_bytes": final_size,
        }),
    );
    Ok(json!({
        "status": "ok",
        "db_size_before_bytes": db_size,
        "db_size_after_bytes": final_size,
    }))
}

async fn tokenomics_enqueue_usage_sync_if_needed(
    app: AppHandle,
    state: &CloudMcpState,
    summary: &Value,
    reason: &str,
    force_full: bool,
    allow_window_republish: bool,
) {
    let inserted_events = tokenomics_summary_inserted_events(summary);
    let recorded_limit_rows = tokenomics_summary_recorded_limit_rows(summary);
    if inserted_events == 0 && recorded_limit_rows == 0 && !force_full {
        // The ordinary 60s live-limits poll keeps the old skip-on-no-rows
        // behavior. Only an explicitly forced provider refresh may republish
        // the provider-window baseline without new rows, and only through the
        // cheap hash pre-check below — never through the heavy sync job.
        if !(allow_window_republish && reason == TOKENOMICS_LIMITS_CHANGED_SYNC_REASON) {
            return;
        }
        tokenomics_enqueue_window_republish_sync_if_dirty(
            app,
            state,
            TOKENOMICS_WINDOW_REPUBLISH_SYNC_REASON,
            Some(summary),
        )
        .await;
        return;
    }
    let _ =
        cloud_mcp_enqueue_tokenomics_sync(app, state, reason.to_string(), force_full, false).await;
    log_terminal_status_event(
        "backend.tokenomics.sync_queued",
        json!({
            "reason": reason,
            "force_full": force_full,
            "inserted_events": inserted_events,
            "recorded_limit_rows": recorded_limit_rows,
        }),
    );
}

/// Enqueue an invisible provider-window republish sync when the current window
/// content differs from the last republished baseline. The dirtiness pre-check
/// is cheap — it hashes an existing (or cached) live-limits snapshot and reads
/// one meta row — so startup-adjacent triggers (websocket reconnect, forced
/// limit refresh) can call this without scheduling the heavy sync-job summary
/// build when nothing changed.
async fn tokenomics_enqueue_window_republish_sync_if_dirty(
    app: AppHandle,
    state: &CloudMcpState,
    reason: &str,
    live_limits_summary: Option<&Value>,
) {
    let dirty = match live_limits_summary {
        Some(summary) => cloud_mcp_tokenomics_window_republish_dirty(&app, state, summary).await,
        None => {
            let limits_app = app.clone();
            let loaded = tauri::async_runtime::spawn_blocking(move || {
                let _span = BackendCpuSpan::new("tokenomics.window_republish_precheck");
                tokenomics_cached_live_limits_for(&limits_app, false)
            })
            .await
            .map_err(|error| format!("Unable to join window republish pre-check: {error}"))
            .and_then(|result| result);
            match loaded {
                Ok(summary) => {
                    cloud_mcp_tokenomics_window_republish_dirty(&app, state, &summary).await
                }
                Err(error) => {
                    log_terminal_status_event(
                        "backend.tokenomics.window_republish_precheck_error",
                        json!({ "reason": reason, "error": error }),
                    );
                    return;
                }
            }
        }
    };
    if !dirty {
        log_terminal_status_event(
            "backend.tokenomics.window_republish_skipped",
            json!({ "reason": reason, "skipped": "window_content_unchanged" }),
        );
        return;
    }
    let _ = cloud_mcp_enqueue_tokenomics_sync(app, state, reason.to_string(), false, false).await;
    log_terminal_status_event(
        "backend.tokenomics.sync_queued",
        json!({
            "reason": reason,
            "force_full": false,
            "window_republish": true,
        }),
    );
}

fn tokenomics_retired_provider_account_keys(conn: &rusqlite::Connection) -> Vec<String> {
    let mut keys = conn
        .prepare(
            "SELECT provider_account_key
             FROM tokenomics_retired_provider_accounts
             ORDER BY provider, agent_kind, provider_account_key",
        )
        .and_then(|mut statement| {
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })
        .unwrap_or_default();
    for profile_id in agent_accounts_duplicate_profile_ids("claude") {
        keys.push(format!("anthropic:claude:profile:{profile_id}"));
    }
    for profile_id in agent_accounts_duplicate_profile_ids("codex") {
        keys.push(format!("openai:codex:profile:{profile_id}"));
    }
    keys.sort();
    keys.dedup();
    keys
}

fn tokenomics_value_account_key(value: &Value) -> String {
    value
        .get("provider_account_key")
        .or_else(|| value.get("subscription_key"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

fn tokenomics_provider_account_key_is_unknown(key: &str) -> bool {
    let clean = key.trim().to_ascii_lowercase();
    clean.is_empty() || clean.ends_with(":unknown")
}

fn tokenomics_retain_active_account_rows(rows: &mut Vec<Value>, retired_keys: &[String]) {
    rows.retain(|row| {
        let key = tokenomics_value_account_key(row);
        !tokenomics_provider_account_key_is_unknown(&key)
            && !retired_keys.iter().any(|retired| retired == &key)
    });
}

fn tokenomics_prune_unknown_provider_account_rows(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    for table in [
        "tokenomics_provider_accounts",
        "tokenomics_latest_windows",
        "tokenomics_provider_limit_samples",
    ] {
        conn.execute(
            &format!(
                "DELETE FROM {table}
                 WHERE TRIM(COALESCE(provider_account_key, ''))=''
                    OR LOWER(TRIM(provider_account_key)) LIKE '%:unknown'"
            ),
            [],
        )
        .map_err(|error| {
            format!("Unable to prune unknown Tokenomics provider accounts: {error}")
        })?;
    }
    Ok(())
}

fn tokenomics_purge_retired_limit_samples(
    conn: &rusqlite::Connection,
    retired_keys: &[String],
) -> Result<(), String> {
    for key in retired_keys {
        conn.execute(
            "DELETE FROM tokenomics_provider_limit_samples WHERE provider_account_key=?1",
            rusqlite::params![key],
        )
        .map_err(|error| format!("Unable to purge retired limit samples: {error}"))?;
    }
    Ok(())
}

#[derive(Clone)]
struct TokenomicsProviderAccount {
    key: String,
    label: String,
}

fn tokenomics_provider_account(provider: &str, agent_kind: &str) -> TokenomicsProviderAccount {
    let normalized_provider = provider.trim().to_ascii_lowercase();
    let normalized_agent = agent_kind.trim().to_ascii_lowercase();
    let (auth_value, scoped_stable_identity) = match normalized_agent.as_str() {
        "codex" => (tokenomics_home_dir()
            .map(|home| home.join(".codex").join("auth.json"))
            .and_then(tokenomics_read_json_file), None),
        "claude" => (tokenomics_claude_auth_value(), None),
        "opencode" => {
            // LAUNCH authority, not the raw registry selector: the Default
            // selector resolves to None while the launched process can be
            // bound to a CAPTURED effective profile. Session ingestion
            // (`opencode_data_home`) already resolves via the launch
            // authority; using the raw selector here parked the identity
            // sidecar at `<profile>/opencode` instead of the canonical
            // `<profile>` root and minted a second random first-seen
            // identity — splitting usage across phantom accounts.
            let active_root = agent_accounts_profile_home_for_launch("opencode");
            let found = opencode_data_home().into_iter().find_map(|home| {
                let auth = tokenomics_read_json_file(home.join("auth.json"))?;
                let identity_home = active_root
                    .as_ref()
                    .filter(|root| root.join("opencode") == home)
                    .cloned()
                    .unwrap_or_else(|| home.clone());
                let identity =
                    agent_accounts_opencode_identity_with_first_seen(&auth, &identity_home);
                Some((auth, (!identity.is_empty()).then_some(identity)))
            });
            found
                .map(|(auth, identity)| (Some(auth), identity))
                .unwrap_or((None, None))
        }
        _ => (None, None),
    };
    tokenomics_provider_account_from_auth_scoped(
        &normalized_provider,
        &normalized_agent,
        auth_value.as_ref(),
        scoped_stable_identity.as_deref(),
    )
}

fn tokenomics_provider_account_from_auth(
    provider: &str,
    agent_kind: &str,
    auth_value: Option<&Value>,
) -> TokenomicsProviderAccount {
    tokenomics_provider_account_from_auth_scoped(provider, agent_kind, auth_value, None)
}

fn tokenomics_provider_account_from_auth_scoped(
    provider: &str,
    agent_kind: &str,
    auth_value: Option<&Value>,
    opencode_stable_identity: Option<&str>,
) -> TokenomicsProviderAccount {
    let base_label = tokenomics_provider_account_base_label(provider, agent_kind);
    let Some(auth_value) = auth_value else {
        return TokenomicsProviderAccount {
            key: format!("{provider}:{agent_kind}:unknown"),
            label: base_label,
        };
    };
    let mut identifiers = tokenomics_provider_account_key_identifiers(
        provider,
        agent_kind,
        auth_value,
        opencode_stable_identity,
    );
    if identifiers.is_empty() && !matches!(agent_kind, "codex" | "opencode") {
        tokenomics_collect_json_values_for_keys(
            auth_value,
            &[
                "refresh_token",
                "refreshToken",
                "access_token",
                "accessToken",
                "id_token",
                "idToken",
                "session_token",
                "sessionToken",
            ],
            &mut identifiers,
        );
    }
    identifiers.sort();
    identifiers.dedup();
    if identifiers.is_empty() && matches!(agent_kind, "codex" | "opencode") {
        return TokenomicsProviderAccount {
            key: format!("{provider}:{agent_kind}:unknown"),
            label: base_label,
        };
    }
    let fingerprint = if identifiers.is_empty() {
        serde_json::to_string(auth_value).unwrap_or_default()
    } else {
        identifiers.join("|")
    };
    if fingerprint.trim().is_empty() {
        return TokenomicsProviderAccount {
            key: format!("{provider}:{agent_kind}:unknown"),
            label: base_label,
        };
    }
    let hash = tokenomics_hash(&format!("{provider}:{agent_kind}:{fingerprint}"));
    let key_suffix = hash.get(0..32).unwrap_or(hash.as_str());
    let label_suffix = hash.get(0..8).unwrap_or(hash.as_str());
    let label = tokenomics_provider_account_display_label(
        provider,
        agent_kind,
        auth_value,
        label_suffix,
        opencode_stable_identity,
    )
    .unwrap_or_else(|| format!("{base_label} {label_suffix}"));
    TokenomicsProviderAccount {
        key: format!("{provider}:{agent_kind}:{key_suffix}"),
        label,
    }
}

fn tokenomics_tag_limit_agent_profile(
    limits: &mut [Value],
    profile_id: &str,
    active_profile_id: &str,
) {
    let active = profile_id == active_profile_id;
    for limit in limits {
        let Some(object) = limit.as_object_mut() else {
            continue;
        };
        object.insert("agent_profile_id".to_string(), json!(profile_id));
        object.insert("active_agent_profile".to_string(), json!(active));
        object.insert("active_provider_account".to_string(), json!(active));
    }
}

fn tokenomics_tag_dormant_cached_provider_limits(limits: &mut [Value]) {
    for limit in limits {
        let Some(object) = limit.as_object_mut() else {
            continue;
        };
        object.insert(
            "provider_limit_refresh_mode".to_string(),
            json!("cached_dormant"),
        );
    }
}

fn tokenomics_provider_limit_is_dormant_cached(limit: &Value) -> bool {
    tokenomics_value_string(limit, &["provider_limit_refresh_mode"])
        .is_some_and(|value| value == "cached_dormant")
}

fn tokenomics_strip_provider_limit_refresh_mode(limits: &mut [Value]) {
    for limit in limits {
        let Some(object) = limit.as_object_mut() else {
            continue;
        };
        object.remove("provider_limit_refresh_mode");
    }
}

fn tokenomics_active_provider_account_key_map(limits: &[Value]) -> HashMap<String, String> {
    let mut keys = HashMap::new();
    for limit in limits {
        let active = limit
            .get("active_provider_account")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !active {
            continue;
        }
        let provider =
            tokenomics_value_string(limit, &["provider"]).unwrap_or_else(|| "unknown".to_string());
        let agent_kind =
            tokenomics_value_string(limit, &["agent_kind"]).unwrap_or_else(|| provider.clone());
        let account_key =
            tokenomics_value_string(limit, &["provider_account_key", "subscription_key"])
                .unwrap_or_default();
        if provider == "unknown" || account_key.is_empty() {
            continue;
        }
        keys.insert(format!("{provider}\u{1f}{agent_kind}"), account_key);
    }
    keys
}

fn tokenomics_retag_active_provider_accounts(
    limits: &mut [Value],
    active_account_keys: &HashMap<String, String>,
) {
    if active_account_keys.is_empty() {
        return;
    }
    for limit in limits {
        let provider =
            tokenomics_value_string(limit, &["provider"]).unwrap_or_else(|| "unknown".to_string());
        let agent_kind =
            tokenomics_value_string(limit, &["agent_kind"]).unwrap_or_else(|| provider.clone());
        let account_key =
            tokenomics_value_string(limit, &["provider_account_key", "subscription_key"])
                .unwrap_or_default();
        let active = active_account_keys
            .get(&format!("{provider}\u{1f}{agent_kind}"))
            .map(|active_key| active_key == &account_key)
            .unwrap_or(false);
        let Some(object) = limit.as_object_mut() else {
            continue;
        };
        object.insert("active_provider_account".to_string(), json!(active));
    }
}

fn tokenomics_provider_account_base_label(provider: &str, agent_kind: &str) -> String {
    match agent_kind {
        "codex" => "Codex account".to_string(),
        "claude" => "Claude account".to_string(),
        "opencode" => "OpenCode account".to_string(),
        _ => format!("{} account", tokenomics_title_case(provider)),
    }
}

fn tokenomics_provider_account_display_label(
    provider: &str,
    agent_kind: &str,
    auth_value: &Value,
    account_suffix: &str,
    opencode_stable_identity: Option<&str>,
) -> Option<String> {
    match (provider, agent_kind) {
        ("openai", "codex") => tokenomics_codex_account_display_label(auth_value, account_suffix),
        ("anthropic", "claude") => {
            tokenomics_claude_account_display_label(auth_value, account_suffix)
        }
        ("opencode", "opencode") => {
            tokenomics_opencode_account_display_label(
                auth_value,
                account_suffix,
                opencode_stable_identity,
            )
        }
        _ => None,
    }
}

fn tokenomics_opencode_api_key_material(auth_value: &Value) -> Option<String> {
    let providers = auth_value.as_object()?;
    let material = |entry: &Value| {
        let object = entry.as_object()?;
        let first = |keys: &[&str]| {
            keys.iter().find_map(|key| {
                object
                    .get(*key)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            })
        };
        first(&["key"]).map(str::to_string)
    };
    providers.get("opencode-go").and_then(material).or_else(|| {
        let mut names = providers.keys().collect::<Vec<_>>();
        names.sort();
        names
            .into_iter()
            .find_map(|name| providers.get(name).and_then(material))
    })
}

// OpenCode has no email, so tag the account with the same short credential
// fingerprint the account card shows — e.g.
// "OpenCode dd384c077918" — so the usage filter chip and the account card line up.
fn tokenomics_opencode_account_display_label(
    auth_value: &Value,
    account_suffix: &str,
    stable_identity: Option<&str>,
) -> Option<String> {
    let stable_oauth = stable_identity
        .filter(|identity| !identity.starts_with("opencode-go-"));
    let tag = stable_oauth
        .map(cloud_mcp_short_hash)
        .or_else(|| {
            tokenomics_opencode_api_key_material(auth_value)
                .as_deref()
                .map(cloud_mcp_short_hash)
        })
        .or_else(|| stable_identity.map(cloud_mcp_short_hash))
        .or_else(|| {
            let identity = agent_accounts_opencode_identity_from_auth(auth_value);
            (!identity.is_empty()).then(|| cloud_mcp_short_hash(&identity))
        })
        .filter(|tag| !tag.is_empty())
        .unwrap_or_else(|| account_suffix.to_string());
    Some(format!("OpenCode {tag}"))
}

fn tokenomics_codex_account_display_label(
    auth_value: &Value,
    account_suffix: &str,
) -> Option<String> {
    let mut jwt_payloads = Vec::new();
    tokenomics_collect_jwt_payloads(auth_value, &mut jwt_payloads);

    for payload in &jwt_payloads {
        if let Some(label) =
            tokenomics_text_field(payload, &["name", "display_name", "displayName"])
        {
            return Some(label);
        }
    }

    for payload in &jwt_payloads {
        if let Some(profile) = payload.get("https://api.openai.com/profile") {
            if let Some(label) =
                tokenomics_text_field(profile, &["name", "display_name", "displayName"])
            {
                return Some(label);
            }
            if tokenomics_text_field(profile, &["email"]).is_some() {
                return Some(tokenomics_account_letter_label(account_suffix));
            }
        }
        if tokenomics_text_field(payload, &["email", "preferred_username"]).is_some() {
            return Some(tokenomics_account_letter_label(account_suffix));
        }
    }

    if let Some(label) = tokenomics_text_field(auth_value, &["name", "display_name", "displayName"])
    {
        return Some(label);
    }
    if tokenomics_text_field(auth_value, &["email", "login", "username"]).is_some() {
        return Some(tokenomics_account_letter_label(account_suffix));
    }
    None
}

fn tokenomics_claude_account_display_label(
    auth_value: &Value,
    account_suffix: &str,
) -> Option<String> {
    let account = tokenomics_claude_oauth_account(auth_value).unwrap_or(auth_value);
    // A registered agent-accounts profile with this login's email names the
    // account exactly as the accounts settings UI does — prefer that over the
    // oauth display name (whatever personal name Anthropic has on file, which
    // reads as a stranger in the filter chips) and over the letter fallback.
    if let Some(email) = tokenomics_text_field(account, &["emailAddress", "email"]) {
        if let Some(label) = agent_accounts_profile_label_for_email("claude", &email) {
            return Some(label);
        }
    }
    if let Some(label) = tokenomics_text_field(account, &["displayName", "display_name", "name"]) {
        return Some(label);
    }
    if tokenomics_text_field(account, &["emailAddress", "email"]).is_some() {
        return Some(tokenomics_account_letter_label(account_suffix));
    }
    tokenomics_text_field(account, &["organizationName", "organization_name"])
}

fn tokenomics_text_field(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    for key in keys {
        if let Some(text) = object
            .get(*key)
            .and_then(tokenomics_json_scalar_text)
            .and_then(tokenomics_account_label_text)
        {
            return Some(text);
        }
    }
    None
}

fn tokenomics_account_label_text(value: String) -> Option<String> {
    let clean = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if clean.is_empty() || clean.chars().any(char::is_control) {
        return None;
    }
    Some(clean.chars().take(96).collect())
}

fn tokenomics_account_letter_label(seed: &str) -> String {
    let hash = tokenomics_hash(seed);
    let index = hash
        .get(0..2)
        .and_then(|value| u8::from_str_radix(value, 16).ok())
        .unwrap_or(0);
    char::from(b'A' + (index % 26)).to_string()
}

fn tokenomics_provider_account_key_identifiers(
    provider: &str,
    agent_kind: &str,
    auth_value: &Value,
    opencode_stable_identity: Option<&str>,
) -> Vec<String> {
    match (provider, agent_kind) {
        ("openai", "codex") => tokenomics_codex_account_key_identifiers(auth_value),
        ("anthropic", "claude") => tokenomics_claude_account_key_identifiers(auth_value),
        ("opencode", "opencode") => tokenomics_opencode_account_key_identifiers_with_stable(
            auth_value,
            opencode_stable_identity,
        ),
        _ => tokenomics_generic_account_key_identifiers(auth_value),
    }
}

fn tokenomics_opencode_account_key_identifiers(auth_value: &Value) -> Vec<String> {
    // Preserve the historical API-key fingerprint. OAuth uses provider plus
    // stable accountId/JWT claims; if the provider exposes neither, capture
    // persists a first-seen identity in the active profile and tokenomics uses
    // that immutable registry identity instead of rotating secrets.
    tokenomics_opencode_account_key_identifiers_with_stable(auth_value, None)
}

fn tokenomics_opencode_account_key_identifiers_with_stable(
    auth_value: &Value,
    stable_identity: Option<&str>,
) -> Vec<String> {
    let stable_identity = stable_identity
        .map(str::trim)
        .filter(|identity| !identity.is_empty());
    // A persisted OAuth/first-seen identity is authoritative even if later
    // credentials gain direct JWT claims or an API-key entry. API-only
    // profiles retain their historical raw-key fingerprint.
    if let Some(stable) = stable_identity.filter(|identity| !identity.starts_with("opencode-go-"))
    {
        return vec![stable.to_string()];
    }
    if let Some(material) = tokenomics_opencode_api_key_material(auth_value) {
        return vec![tokenomics_hash(&material)];
    }
    if let Some(stable) = stable_identity {
        return vec![stable.to_string()];
    }
    let direct = agent_accounts_opencode_identity_from_auth(auth_value);
    (!direct.is_empty())
        .then_some(direct)
        .into_iter()
        .collect()
}

fn tokenomics_generic_account_key_identifiers(auth_value: &Value) -> Vec<String> {
    let mut identifiers = Vec::new();
    tokenomics_collect_json_values_for_keys(
        auth_value,
        &[
            "account_id",
            "accountId",
            "user_id",
            "userId",
            "userid",
            "sub",
            "email",
            "login",
            "username",
            "organization_id",
            "organizationId",
        ],
        &mut identifiers,
    );
    if identifiers.is_empty() {
        tokenomics_collect_jwt_account_identifiers(auth_value, &mut identifiers);
    }
    identifiers
}

fn tokenomics_codex_account_key_identifiers(auth_value: &Value) -> Vec<String> {
    let identity = agent_accounts_codex_stable_identity_from_auth(auth_value);
    (!identity.is_empty())
        .then_some(identity)
        .into_iter()
        .collect()
}

fn tokenomics_claude_account_key_identifiers(auth_value: &Value) -> Vec<String> {
    let Some(account) = tokenomics_claude_oauth_account(auth_value) else {
        return tokenomics_text_field(
            auth_value,
            &[
                "accountUuid",
                "account_uuid",
                "userID",
                "userId",
                "user_id",
                "emailAddress",
                "email",
            ],
        )
        .into_iter()
        .collect();
    };
    for keys in [
        &["accountUuid", "account_uuid"][..],
        &["userID", "userId", "user_id", "userid"][..],
        &["emailAddress", "email"][..],
        &[
            "organizationUuid",
            "organization_uuid",
            "organizationId",
            "organization_id",
        ][..],
    ] {
        let mut identifiers = Vec::new();
        tokenomics_collect_json_values_for_keys(account, keys, &mut identifiers);
        if identifiers.is_empty()
            && !keys
                .iter()
                .any(|key| key.to_ascii_lowercase().contains("organization"))
        {
            tokenomics_collect_json_values_for_keys(auth_value, keys, &mut identifiers);
        }
        identifiers.sort();
        identifiers.dedup();
        if !identifiers.is_empty() {
            return identifiers;
        }
    }
    Vec::new()
}

fn tokenomics_claude_oauth_account(value: &Value) -> Option<&Value> {
    value
        .get("oauthAccount")
        .or_else(|| value.get("oauth_account"))
        .or_else(|| {
            value
                .get("claude_config")
                .and_then(|config| config.get("oauthAccount"))
        })
        .or_else(|| {
            value
                .get("claudeConfig")
                .and_then(|config| config.get("oauthAccount"))
        })
}

fn tokenomics_claude_auth_value() -> Option<Value> {
    let home = tokenomics_home_dir()?;
    let credentials = tokenomics_read_json_file(home.join(".claude").join(".credentials.json"));
    let claude_config = tokenomics_read_json_file(home.join(".claude.json"));
    if credentials.is_none() && claude_config.is_none() {
        return None;
    }
    Some(json!({
        "credentials": credentials,
        "claude_config": claude_config,
    }))
}

/// A captured profile dir IS a CLAUDE_CONFIG_DIR: the CLI keeps that login's
/// `.claude.json` (and file-based `.credentials.json`, where the platform
/// uses one) inside it — the same shape the default-home auth value carries.
fn tokenomics_claude_profile_auth_value(profile_dir: &Path) -> Option<Value> {
    let credentials = tokenomics_read_json_file(profile_dir.join(".credentials.json"));
    let claude_config = tokenomics_read_json_file(profile_dir.join(".claude.json"));
    if credentials.is_none() && claude_config.is_none() {
        return None;
    }
    Some(json!({
        "credentials": credentials,
        "claude_config": claude_config,
    }))
}

/// Resolve the Claude identity visible to the hook process at SessionStart.
/// Hooks inherit the CLI's effective CLAUDE_CONFIG_DIR, including an inline
/// binding used to relaunch Claude inside an existing PTY. Only the opaque
/// Tokenomics key is attached to the local activity record.
fn tokenomics_process_provider_account_identity(provider_id: &str) -> Option<Value> {
    if agent_accounts_supported_kind(provider_id) != Some("claude") {
        return None;
    }
    let auth_value = match env::var_os("CLAUDE_CONFIG_DIR") {
        Some(config_dir) => tokenomics_claude_profile_auth_value(&PathBuf::from(config_dir)),
        None => tokenomics_claude_auth_value(),
    }?;
    let account = tokenomics_provider_account_from_auth("anthropic", "claude", Some(&auth_value));
    (!tokenomics_provider_account_key_is_unknown(&account.key)).then(|| {
        json!({
            "provider": "anthropic",
            "agent_kind": "claude",
            "provider_account_key": account.key,
        })
    })
}

/// Identity-first account for a captured Claude profile, mirroring the Codex
/// profile path: resolve the profile dir's own oauth identity so usage keys
/// to the SAME account hash wherever that login runs (default home or
/// profile) instead of splitting one account into an oauth-keyed and a
/// profile-keyed chip. The synthetic `profile:` key survives only as the
/// no-identity fallback (profile registered but never logged in).
pub(crate) fn tokenomics_claude_profile_provider_account(
    profile_id: &str,
    profile_label: &str,
    stored_email: Option<&str>,
    profile_dir: &Path,
) -> TokenomicsProviderAccount {
    let auth_value = tokenomics_claude_profile_auth_value(profile_dir);
    let stored_email = stored_email
        .map(agent_accounts_email_key)
        .filter(|email| !email.is_empty());
    let identity_email = auth_value
        .as_ref()
        .and_then(tokenomics_claude_oauth_account)
        .and_then(|account| tokenomics_text_field(account, &["emailAddress", "email"]))
        .map(|email| agent_accounts_email_key(&email));
    let identity_matches_registry = stored_email
        .as_ref()
        .is_none_or(|stored| identity_email.as_ref() == Some(stored));
    // Require real oauth identifiers before trusting the identity path: a
    // credential-only dir (tokens without an oauthAccount) would fall through
    // to token-hash keys that churn on every refresh and that the retirement
    // machinery can never match — the stable profile key is strictly better.
    let identity_ready = auth_value
        .as_ref()
        .is_some_and(|auth| !tokenomics_claude_account_key_identifiers(auth).is_empty());
    if !identity_ready || !identity_matches_registry {
        return TokenomicsProviderAccount {
            key: format!("anthropic:claude:profile:{profile_id}"),
            label: format!("Claude · {profile_label}"),
        };
    }
    let account = tokenomics_provider_account_from_auth("anthropic", "claude", auth_value.as_ref());
    if tokenomics_provider_account_key_is_unknown(&account.key) {
        return TokenomicsProviderAccount {
            key: format!("anthropic:claude:profile:{profile_id}"),
            label: format!("Claude · {profile_label}"),
        };
    }
    // The registry label ("syedmraza99", "admin") matches the accounts
    // settings UI; the oauth display name is whatever name Anthropic has on
    // the account and reads as a stranger in the filter chips.
    let label =
        tokenomics_clean_non_profile_provider_account_label(profile_label).unwrap_or(account.label);
    TokenomicsProviderAccount {
        key: account.key,
        label,
    }
}

/// The stable tokenomics account key for a Claude config state (`.claude.json`
/// contents), for the agent-accounts identity payload. Only oauth-derived
/// identities count: without them the generic fallback would fingerprint the
/// whole config JSON, which is unstable and never matches scanner keys.
/// Deliberately label-free: the full `tokenomics_provider_account_from_auth`
/// resolves a display label, which consults the agent-accounts registry,
/// which (for profiles without a stored email) live-probes identity, which
/// computes this key — calling it here would recurse.
pub(crate) fn tokenomics_claude_account_key_for_claude_config(
    claude_config: &Value,
) -> Option<String> {
    let auth_value = json!({ "claude_config": claude_config });
    let identifiers = tokenomics_claude_account_key_identifiers(&auth_value);
    if identifiers.is_empty() {
        return None;
    }
    // Mirrors the key arm of tokenomics_provider_account_from_auth (the
    // identifiers list arrives sorted + deduped); the paired unit test pins
    // the two derivations together.
    let fingerprint = identifiers.join("|");
    let hash = tokenomics_hash(&format!("anthropic:claude:{fingerprint}"));
    Some(format!(
        "anthropic:claude:{}",
        hash.get(0..32).unwrap_or(hash.as_str())
    ))
}

fn tokenomics_read_json_file(path: PathBuf) -> Option<Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
}

#[derive(Clone)]
struct TokenomicsBillingScope {
    scope_type: String,
    team_id: Option<String>,
    source: String,
}

fn tokenomics_unknown_billing_scope() -> TokenomicsBillingScope {
    TokenomicsBillingScope {
        scope_type: "unknown".to_string(),
        team_id: None,
        source: "unknown".to_string(),
    }
}

fn tokenomics_clean_billing_scope_source(value: &str) -> String {
    let clean = value
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(64)
        .collect::<String>();
    if clean.is_empty() {
        "unknown".to_string()
    } else {
        clean
    }
}

fn tokenomics_billing_scope_from_parts(
    scope_type: Option<&str>,
    team_id: Option<&str>,
    source: &str,
) -> TokenomicsBillingScope {
    let normalized_type = scope_type
        .unwrap_or("unknown")
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>()
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' '], "_");
    let clean_team_id = team_id
        .unwrap_or_default()
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(96)
        .collect::<String>();
    let source = tokenomics_clean_billing_scope_source(source);

    if normalized_type == "team" && !clean_team_id.is_empty() {
        return TokenomicsBillingScope {
            scope_type: "team".to_string(),
            team_id: Some(clean_team_id),
            source,
        };
    }
    if normalized_type == "personal" {
        return TokenomicsBillingScope {
            scope_type: "personal".to_string(),
            team_id: None,
            source,
        };
    }
    tokenomics_unknown_billing_scope()
}

fn tokenomics_billing_scope_from_value(
    value: &Value,
    fallback: &TokenomicsBillingScope,
) -> TokenomicsBillingScope {
    let scope_type = tokenomics_value_string(
        value,
        &["billing_scope_type", "account_scope_type", "scope_type"],
    );
    let team_id =
        tokenomics_value_string(value, &["billing_team_id", "account_team_id", "team_id"]);
    if scope_type.is_none() && team_id.is_none() {
        return fallback.clone();
    }
    let source = tokenomics_value_string(
        value,
        &[
            "billing_scope_source",
            "account_scope_source",
            "scope_source",
        ],
    )
    .unwrap_or_else(|| "usage_payload".to_string());
    tokenomics_billing_scope_from_parts(scope_type.as_deref(), team_id.as_deref(), &source)
}

fn tokenomics_current_billing_scope() -> TokenomicsBillingScope {
    cloud_mcp_process_known_account_scope()
        .map(|(scope_type, team_id)| {
            tokenomics_billing_scope_from_parts(
                Some(scope_type.as_str()),
                team_id.as_deref(),
                "desktop_active_scope",
            )
        })
        .unwrap_or_else(tokenomics_unknown_billing_scope)
}

fn tokenomics_billing_scope_key(scope_type: &str, team_id: Option<&str>) -> String {
    if scope_type == "team" {
        if let Some(team_id) = team_id.map(str::trim).filter(|value| !value.is_empty()) {
            return format!("team:{team_id}");
        }
    }
    if scope_type == "personal" {
        return "personal".to_string();
    }
    "unknown".to_string()
}

fn tokenomics_collect_json_values_for_keys(value: &Value, keys: &[&str], output: &mut Vec<String>) {
    if let Some(object) = value.as_object() {
        for (key, item) in object {
            if keys
                .iter()
                .any(|candidate| key.eq_ignore_ascii_case(candidate))
            {
                if let Some(text) = tokenomics_json_scalar_text(item) {
                    output.push(text);
                }
            }
            tokenomics_collect_json_values_for_keys(item, keys, output);
        }
    } else if let Some(array) = value.as_array() {
        for item in array {
            tokenomics_collect_json_values_for_keys(item, keys, output);
        }
    }
}

fn tokenomics_json_scalar_text(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| value.as_i64().map(|number| number.to_string()))
        .or_else(|| value.as_u64().map(|number| number.to_string()))
        .or_else(|| value.as_bool().map(|flag| flag.to_string()))
}

fn tokenomics_local_device_id() -> String {
    cloud_mcp_desktop_device_profile()
        .get("device_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("desktop-primary")
        .to_string()
}

fn tokenomics_local_device_name() -> String {
    let profile = cloud_mcp_desktop_device_profile();
    tokenomics_text_field(
        &profile,
        &["display_name", "device_name", "machine_name", "hostname"],
    )
    .unwrap_or_else(|| "This Device".to_string())
}

fn tokenomics_clean_device_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "desktop-primary" {
        return None;
    }
    Some(trimmed.to_string())
}

fn tokenomics_local_device_aliases(conn: &rusqlite::Connection) -> Result<Vec<String>, String> {
    let current_device_id = tokenomics_local_device_id();
    let stored = conn
        .query_row(
            "SELECT value FROM tokenomics_meta WHERE key=?1",
            rusqlite::params![TOKENOMICS_LOCAL_DEVICE_ALIASES_KEY],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let mut aliases = Vec::new();
    if let Some(stored) = stored {
        if let Ok(value) = serde_json::from_str::<Value>(&stored) {
            if let Some(array) = value.as_array() {
                for item in array {
                    if let Some(alias) = item.as_str().and_then(tokenomics_clean_device_id) {
                        if alias != current_device_id && !aliases.contains(&alias) {
                            aliases.push(alias);
                        }
                    }
                }
            }
        } else {
            for item in stored.split(',') {
                if let Some(alias) = tokenomics_clean_device_id(item) {
                    if alias != current_device_id && !aliases.contains(&alias) {
                        aliases.push(alias);
                    }
                }
            }
        }
    }
    Ok(aliases)
}

fn tokenomics_local_device_id_set(conn: &rusqlite::Connection) -> Result<HashSet<String>, String> {
    let mut ids = HashSet::new();
    let current_device_id = tokenomics_local_device_id();
    if !current_device_id.trim().is_empty() {
        ids.insert(current_device_id);
    }
    ids.insert("desktop-primary".to_string());
    for alias in tokenomics_local_device_aliases(conn)? {
        if !alias.trim().is_empty() {
            ids.insert(alias);
        }
    }
    Ok(ids)
}

fn tokenomics_cloud_relay_placeholder_device_id(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "" | "desktop-primary"
            | "cloud"
            | "account"
            | "all"
            | "all-device"
            | "all-devices"
            | "all_device"
            | "all_devices"
            | "unknown-device"
            | "unknown_device"
    )
}

fn tokenomics_is_remote_cloud_device_id(
    device_id: &str,
    local_device_ids: &HashSet<String>,
) -> bool {
    let clean = device_id.trim();
    !tokenomics_cloud_relay_placeholder_device_id(clean) && !local_device_ids.contains(clean)
}

fn tokenomics_remote_cloud_device_id_from_value(
    value: &Value,
    inherited_device_id: Option<&str>,
    local_device_ids: &HashSet<String>,
) -> Option<String> {
    let device_id = tokenomics_text_field(value, &["device_id", "machine_id"])
        .or_else(|| inherited_device_id.map(str::to_string))?;
    let device_id = device_id.trim().to_string();
    if tokenomics_is_remote_cloud_device_id(&device_id, local_device_ids) {
        Some(device_id)
    } else {
        None
    }
}

fn tokenomics_store_local_device_aliases(
    conn: &rusqlite::Connection,
    aliases: &[String],
) -> Result<(), String> {
    let current_device_id = tokenomics_local_device_id();
    let mut merged = tokenomics_local_device_aliases(conn)?;
    for alias in aliases {
        if let Some(alias) = tokenomics_clean_device_id(alias) {
            if alias != current_device_id && !merged.contains(&alias) {
                merged.push(alias);
            }
        }
    }
    merged.sort();
    conn.execute(
        "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES(?1, ?2)",
        rusqlite::params![
            TOKENOMICS_LOCAL_DEVICE_ALIASES_KEY,
            json!(merged).to_string()
        ],
    )
    .map_err(|error| format!("Unable to store Tokenomics device aliases: {error}"))?;
    Ok(())
}

fn tokenomics_device_identity_ids(identity: &Value) -> Vec<String> {
    [
        tokenomics_text_field(identity, &["device_id"]),
        tokenomics_text_field(identity, &["machine_id"]),
        tokenomics_text_field(identity, &["native_device_id"]),
        tokenomics_text_field(identity, &["target_device_id"]),
        tokenomics_text_field(identity, &["id"]),
    ]
    .into_iter()
    .flatten()
    .filter_map(|value| tokenomics_clean_device_id(&value))
    .collect::<std::collections::BTreeSet<_>>()
    .into_iter()
    .collect()
}

fn tokenomics_device_identity_label(identity: &Value) -> Option<String> {
    tokenomics_text_field(
        identity,
        &[
            "display_name",
            "label",
            "device_name",
            "machine_name",
            "hostname",
            "name",
        ],
    )
}

fn tokenomics_generic_device_label(device_id: &str) -> String {
    let lower = device_id.to_ascii_lowercase();
    if lower.contains("windows") || lower.starts_with("win") {
        "Windows PC".to_string()
    } else if lower.contains("macos") || lower.contains("macbook") || lower.starts_with("mac") {
        "Mac device".to_string()
    } else if lower.contains("linux") {
        "Linux device".to_string()
    } else {
        let char_count = device_id.chars().count();
        let suffix = if char_count > 10 {
            let prefix = device_id.chars().take(6).collect::<String>();
            let tail = device_id
                .chars()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<String>();
            format!("{prefix}...{tail}")
        } else if device_id.is_empty() {
            "unknown".to_string()
        } else {
            device_id.to_string()
        };
        format!("Device {suffix}")
    }
}

fn tokenomics_cached_device_identities(conn: &rusqlite::Connection) -> Result<Vec<Value>, String> {
    let stored: String = match conn.query_row(
        "SELECT value FROM tokenomics_meta WHERE key=?1",
        rusqlite::params![TOKENOMICS_DEVICE_IDENTITIES_KEY],
        |row| row.get(0),
    ) {
        Ok(text) => text,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!(
                "Unable to read Tokenomics device identities: {error}"
            ));
        }
    };
    let parsed = serde_json::from_str::<Value>(&stored).unwrap_or_else(|_| json!([]));
    Ok(parsed.as_array().cloned().unwrap_or_default())
}

fn tokenomics_store_cloud_device_identities(
    conn: &rusqlite::Connection,
    summary: &Value,
) -> Result<usize, String> {
    let incoming = summary
        .get("device_identities")
        .or_else(|| summary.get("devices"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if incoming.is_empty() {
        return Ok(0);
    }

    let mut by_id = std::collections::BTreeMap::<String, Value>::new();
    for identity in tokenomics_cached_device_identities(conn)?
        .into_iter()
        .chain(incoming.into_iter())
    {
        let ids = tokenomics_device_identity_ids(&identity);
        if ids.is_empty() {
            continue;
        }
        let primary_id = ids[0].clone();
        let label = tokenomics_device_identity_label(&identity);
        let updated_at = tokenomics_text_field(&identity, &["updated_at", "last_seen_at"])
            .unwrap_or_else(tokenomics_now_iso_like);
        let mut object = identity.as_object().cloned().unwrap_or_default();
        object.insert("device_id".to_string(), json!(primary_id.as_str()));
        object.insert("machine_id".to_string(), json!(primary_id.as_str()));
        object.insert("updated_at".to_string(), json!(updated_at.as_str()));
        object.insert("last_seen_at".to_string(), json!(updated_at.as_str()));
        if let Some(label) = label {
            object.insert("display_name".to_string(), json!(label.as_str()));
            object.insert("device_name".to_string(), json!(label.as_str()));
        }
        let value = Value::Object(object);
        for id in ids {
            let replace = by_id
                .get(&id)
                .and_then(|existing| tokenomics_text_field(existing, &["updated_at"]))
                .map(|existing_updated_at| updated_at.as_str() >= existing_updated_at.as_str())
                .unwrap_or(true);
            if replace {
                by_id.insert(id, value.clone());
            }
        }
    }
    let rows = by_id.into_values().collect::<Vec<_>>();
    conn.execute(
        "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES(?1, ?2)",
        rusqlite::params![TOKENOMICS_DEVICE_IDENTITIES_KEY, json!(rows).to_string()],
    )
    .map_err(|error| format!("Unable to store Tokenomics device identities: {error}"))?;
    Ok(rows.len())
}

fn tokenomics_summary_device_identities(
    conn: &rusqlite::Connection,
    include_cloud: bool,
) -> Result<Vec<Value>, String> {
    let mut by_id = std::collections::BTreeMap::<String, Value>::new();
    let current_device_id = tokenomics_local_device_id();
    let current_device_name = tokenomics_local_device_name();
    by_id.insert(
        current_device_id.clone(),
        json!({
            "device_id": current_device_id.as_str(),
            "machine_id": current_device_id.as_str(),
            "display_name": current_device_name.as_str(),
            "device_name": current_device_name.as_str(),
            "source": "local_device_profile",
            "current": true,
            "updated_at": tokenomics_now_iso_like(),
        }),
    );
    for identity in tokenomics_cached_device_identities(conn)? {
        for id in tokenomics_device_identity_ids(&identity) {
            by_id.entry(id).or_insert_with(|| identity.clone());
        }
    }

    let table = if include_cloud {
        "tokenomics_display_rollups"
    } else {
        "tokenomics_rollups"
    };
    let mut statement = conn
        .prepare(&format!(
            "SELECT device_id, MAX(updated_at) AS updated_at
             FROM {table}
             WHERE device_id IS NOT NULL AND device_id!=''
             GROUP BY device_id"
        ))
        .map_err(|error| format!("Unable to prepare Tokenomics device identity query: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Unable to query Tokenomics device identities: {error}"))?;
    for row in rows {
        let (device_id, updated_at) =
            row.map_err(|error| format!("Unable to read Tokenomics device identity: {error}"))?;
        let Some(device_id) = tokenomics_clean_device_id(&device_id) else {
            continue;
        };
        by_id.entry(device_id.clone()).or_insert_with(|| {
            let label = tokenomics_generic_device_label(&device_id);
            json!({
                "device_id": device_id.as_str(),
                "machine_id": device_id.as_str(),
                "display_name": label.as_str(),
                "device_name": label.as_str(),
                "source": "usage_rollups",
                "updated_at": updated_at.as_str(),
                "last_seen_at": updated_at.as_str(),
            })
        });
    }
    Ok(by_id.into_values().collect())
}

fn tokenomics_reconcile_local_device_id(conn: &rusqlite::Connection) -> Result<(), String> {
    let current_device_id = tokenomics_local_device_id();
    let meta_key = format!("local_device_id_reconcile_v1:{current_device_id}");
    if tokenomics_meta_string(conn, &meta_key).is_some() {
        return Ok(());
    }
    let mut statement = conn
        .prepare(
            "SELECT DISTINCT device_id
             FROM (
               SELECT device_id FROM tokenomics_usage_events
               UNION
               SELECT device_id FROM tokenomics_rollups
             )
             WHERE device_id IS NOT NULL
               AND device_id!=''
               AND device_id!='desktop-primary'
               AND device_id!=?1",
        )
        .map_err(|error| format!("Unable to prepare Tokenomics device alias query: {error}"))?;
    let rows = statement
        .query_map(rusqlite::params![current_device_id.as_str()], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| format!("Unable to query Tokenomics device aliases: {error}"))?;
    let mut aliases = Vec::new();
    for row in rows {
        let alias =
            row.map_err(|error| format!("Unable to read Tokenomics device alias: {error}"))?;
        if let Some(alias) = tokenomics_clean_device_id(&alias) {
            if alias != current_device_id && !aliases.contains(&alias) {
                aliases.push(alias);
            }
        }
    }
    if aliases.is_empty() {
        tokenomics_store_meta_value(conn, &meta_key, "done")?;
        return Ok(());
    }
    for alias in &aliases {
        for table in [
            "tokenomics_usage_events",
            "tokenomics_rollups",
            "tokenomics_pruned_usage_rollups",
        ] {
            conn.execute(
                &format!("UPDATE {table} SET device_id=?1 WHERE device_id=?2"),
                rusqlite::params![current_device_id.as_str(), alias.as_str()],
            )
            .map_err(|error| format!("Unable to collapse Tokenomics device alias: {error}"))?;
        }
    }
    tokenomics_rekey_all_pruned_usage_rollups_force(conn)?;
    tokenomics_store_local_device_aliases(conn, &aliases)?;
    tokenomics_rebuild_all_rollups_from_events(conn)?;
    conn.execute(
        "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES('rollup_identity_version', ?1)",
        rusqlite::params![TOKENOMICS_ROLLUP_ID_VERSION],
    )
    .map_err(|error| format!("Unable to record Tokenomics rollup version: {error}"))?;
    tokenomics_store_meta_value(conn, &meta_key, "done")?;
    Ok(())
}

#[derive(Clone)]
struct TokenomicsSourceIdentity {
    provider_account: TokenomicsProviderAccount,
    billing_scope: TokenomicsBillingScope,
}

struct TokenomicsSourceIdentityUsageCandidate {
    account_key: String,
    account_label: Option<String>,
    billing_scope_type: String,
    billing_team_id: Option<String>,
    billing_scope_source: String,
    event_count: i64,
    latest_observed_at: String,
}

fn tokenomics_source_identity_from_row(
    key: String,
    label: Option<String>,
    scope_type: Option<String>,
    team_id: Option<String>,
    scope_source: Option<String>,
) -> TokenomicsSourceIdentity {
    let label = label
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| key.clone());
    let scope_source = scope_source.unwrap_or_else(|| "existing_source_identity".to_string());
    TokenomicsSourceIdentity {
        provider_account: TokenomicsProviderAccount { key, label },
        billing_scope: tokenomics_billing_scope_from_parts(
            scope_type.as_deref(),
            team_id.as_deref(),
            &scope_source,
        ),
    }
}

fn tokenomics_source_identity_from_import_ledger(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    path: &Path,
) -> Result<Option<TokenomicsSourceIdentity>, String> {
    let source_path = path.display().to_string();
    match conn.query_row(
        "SELECT
           provider_account_key,
           provider_account_label,
           billing_scope_type,
           billing_team_id,
           billing_scope_source
         FROM tokenomics_source_imports
         WHERE provider=?1 AND agent_kind=?2
           AND source_path=?3
           AND TRIM(COALESCE(provider_account_key, ''))!=''
         LIMIT 1",
        rusqlite::params![provider, agent_kind, source_path],
        |row| {
            let key: String = row.get(0)?;
            let label = row.get::<_, Option<String>>(1)?;
            let scope_type = row.get::<_, Option<String>>(2)?;
            let team_id = row.get::<_, Option<String>>(3)?;
            let scope_source = row.get::<_, Option<String>>(4)?;
            Ok(tokenomics_source_identity_from_row(
                key,
                label,
                scope_type,
                team_id,
                scope_source,
            ))
        },
    ) {
        Ok(identity) => Ok(Some(identity)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!(
            "Unable to read Tokenomics source import identity for {}: {error}",
            path.display()
        )),
    }
}

fn tokenomics_source_identity_usage_event_candidates_for_match(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    source_path_predicate: &str,
    params: &[&dyn rusqlite::ToSql],
) -> Result<Vec<TokenomicsSourceIdentityUsageCandidate>, String> {
    // EXPLAIN QUERY PLAN on both callers reports SEARCH tokenomics_usage_events
    // USING INDEX idx_tokenomics_usage_events_source_path with provider,
    // agent_kind, and either source_path equality or source_path range bounds.
    // Keeping exact and prefixed paths split avoids the old OR/LIKE provider scan.
    let query = format!(
        "SELECT
           COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, '')) AS account_key,
           NULLIF(MAX(NULLIF(provider_account_label, '')), '') AS account_label,
           COALESCE(NULLIF(billing_scope_type, ''), 'unknown') AS billing_scope_type,
           NULLIF(billing_team_id, '') AS billing_team_id,
           COALESCE(MAX(NULLIF(billing_scope_source, '')), 'unknown') AS billing_scope_source,
           COUNT(*) AS event_count,
           MAX(COALESCE(observed_at, '')) AS latest_observed_at
         FROM tokenomics_usage_events
         WHERE provider=?1 AND agent_kind=?2
           AND COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, '')) IS NOT NULL
           AND {source_path_predicate}
         GROUP BY account_key, billing_scope_type, billing_team_id"
    );
    let mut statement = conn
        .prepare(&query)
        .map_err(|error| format!("Unable to prepare Tokenomics source identity query: {error}"))?;
    let mut query_params: Vec<&dyn rusqlite::ToSql> = vec![&provider, &agent_kind];
    query_params.extend(params.iter().copied());
    let rows = statement
        .query_map(rusqlite::params_from_iter(query_params), |row| {
            Ok(TokenomicsSourceIdentityUsageCandidate {
                account_key: row.get(0)?,
                account_label: row.get(1)?,
                billing_scope_type: row.get(2)?,
                billing_team_id: row.get(3)?,
                billing_scope_source: row.get(4)?,
                event_count: row.get(5)?,
                latest_observed_at: row.get(6)?,
            })
        })
        .map_err(|error| format!("Unable to query Tokenomics source identity: {error}"))?;
    let mut candidates = Vec::new();
    for row in rows {
        candidates.push(
            row.map_err(|error| format!("Unable to read Tokenomics source identity: {error}"))?,
        );
    }
    Ok(candidates)
}

fn tokenomics_merge_source_identity_usage_candidate(
    candidates: &mut HashMap<
        (String, String, Option<String>),
        TokenomicsSourceIdentityUsageCandidate,
    >,
    candidate: TokenomicsSourceIdentityUsageCandidate,
) {
    let key = (
        candidate.account_key.clone(),
        candidate.billing_scope_type.clone(),
        candidate.billing_team_id.clone(),
    );
    let Some(existing) = candidates.get_mut(&key) else {
        candidates.insert(key, candidate);
        return;
    };
    existing.event_count = existing.event_count.saturating_add(candidate.event_count);
    if candidate.latest_observed_at > existing.latest_observed_at {
        existing.latest_observed_at = candidate.latest_observed_at.clone();
    }
    if candidate.account_label.as_deref().unwrap_or_default()
        > existing.account_label.as_deref().unwrap_or_default()
    {
        existing.account_label = candidate.account_label.clone();
    }
    if candidate.billing_scope_source > existing.billing_scope_source {
        existing.billing_scope_source = candidate.billing_scope_source;
    }
}

fn tokenomics_source_identity_from_usage_events(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    path: &Path,
) -> Result<Option<TokenomicsSourceIdentity>, String> {
    let source_path = path.display().to_string();
    let prefixed = format!("{source_path}:");
    let prefixed_upper_bound =
        tokenomics_prefix_upper_bound(&prefixed).unwrap_or_else(|| format!("{prefixed}\u{10ffff}"));
    let exact_candidates = tokenomics_source_identity_usage_event_candidates_for_match(
        conn,
        provider,
        agent_kind,
        "source_path=?3",
        &[&source_path as &dyn rusqlite::ToSql],
    )?;
    let prefixed_candidates = tokenomics_source_identity_usage_event_candidates_for_match(
        conn,
        provider,
        agent_kind,
        "source_path>=?3 AND source_path<?4",
        &[
            &prefixed as &dyn rusqlite::ToSql,
            &prefixed_upper_bound as &dyn rusqlite::ToSql,
        ],
    )?;
    let mut candidates =
        HashMap::<(String, String, Option<String>), TokenomicsSourceIdentityUsageCandidate>::new();
    for candidate in exact_candidates.into_iter().chain(prefixed_candidates) {
        tokenomics_merge_source_identity_usage_candidate(&mut candidates, candidate);
    }
    let Some(candidate) = candidates.into_values().max_by(|left, right| {
        left.event_count
            .cmp(&right.event_count)
            .then_with(|| left.latest_observed_at.cmp(&right.latest_observed_at))
    }) else {
        return Ok(None);
    };
    Ok(Some(tokenomics_source_identity_from_row(
        candidate.account_key,
        candidate.account_label,
        Some(candidate.billing_scope_type),
        candidate.billing_team_id,
        Some(candidate.billing_scope_source),
    )))
}

fn tokenomics_existing_source_identity(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    path: &Path,
) -> Result<Option<TokenomicsSourceIdentity>, String> {
    if let Some(identity) =
        tokenomics_source_identity_from_import_ledger(conn, provider, agent_kind, path)?
    {
        return Ok(Some(identity));
    }
    tokenomics_source_identity_from_usage_events(conn, provider, agent_kind, path)
}

fn tokenomics_collect_jwt_account_identifiers(value: &Value, output: &mut Vec<String>) {
    tokenomics_collect_jwt_values_for_keys(
        value,
        &[
            "account_id",
            "accountId",
            "user_id",
            "userId",
            "sub",
            "email",
            "organization_id",
            "organizationId",
        ],
        output,
    );
}

fn tokenomics_collect_jwt_values_for_keys(value: &Value, keys: &[&str], output: &mut Vec<String>) {
    if let Some(text) = value.as_str() {
        if let Some(payload) = tokenomics_decode_jwt_payload(text) {
            tokenomics_collect_json_values_for_keys(&payload, keys, output);
        }
    } else if let Some(object) = value.as_object() {
        for item in object.values() {
            tokenomics_collect_jwt_values_for_keys(item, keys, output);
        }
    } else if let Some(array) = value.as_array() {
        for item in array {
            tokenomics_collect_jwt_values_for_keys(item, keys, output);
        }
    }
}

fn tokenomics_collect_jwt_payloads(value: &Value, output: &mut Vec<Value>) {
    if let Some(text) = value.as_str() {
        if let Some(payload) = tokenomics_decode_jwt_payload(text) {
            output.push(payload);
        }
    } else if let Some(object) = value.as_object() {
        for item in object.values() {
            tokenomics_collect_jwt_payloads(item, output);
        }
    } else if let Some(array) = value.as_array() {
        for item in array {
            tokenomics_collect_jwt_payloads(item, output);
        }
    }
}

fn tokenomics_decode_jwt_payload(token: &str) -> Option<Value> {
    let mut parts = token.split('.');
    let _header = parts.next()?;
    let payload = parts.next()?;
    let bytes = general_purpose::URL_SAFE_NO_PAD.decode(payload).ok()?;
    serde_json::from_slice::<Value>(&bytes).ok()
}

struct TokenomicsPrunedRollupRekeyRow {
    old_id: String,
    device_id: String,
    provider: String,
    agent_kind: String,
    model: Option<String>,
    subscription_key: Option<String>,
    provider_account_key: Option<String>,
    provider_account_label: Option<String>,
    billing_scope_type: String,
    billing_team_id: Option<String>,
    billing_scope_source: String,
    workspace_id: Option<String>,
    repo_path: Option<String>,
    bucket_width: String,
    bucket_start: String,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    total_tokens: i64,
    estimated_cost_microusd: i64,
    event_count: i64,
}

fn tokenomics_pruned_rollup_expected_id(row: &TokenomicsPrunedRollupRekeyRow) -> String {
    tokenomics_hash(&format!(
        "{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}",
        row.device_id,
        row.provider,
        row.agent_kind,
        row.model.as_deref().unwrap_or_default(),
        row.subscription_key.as_deref().unwrap_or_default(),
        row.provider_account_key.as_deref().unwrap_or_default(),
        row.billing_scope_type.as_str(),
        row.billing_team_id.as_deref().unwrap_or_default(),
        row.workspace_id.as_deref().unwrap_or_default(),
        row.bucket_width,
        row.bucket_start,
    ))
}

fn tokenomics_rekey_all_pruned_usage_rollups(conn: &rusqlite::Connection) -> Result<(), String> {
    if tokenomics_meta_string(conn, "pruned_rollup_rekey_version").as_deref()
        == Some(TOKENOMICS_PRUNED_ROLLUP_REKEY_VERSION)
    {
        return Ok(());
    }
    let operation = || {
        tokenomics_rekey_all_pruned_usage_rollups_force(conn)?;
        tokenomics_store_meta_value(
            conn,
            "pruned_rollup_rekey_version",
            TOKENOMICS_PRUNED_ROLLUP_REKEY_VERSION,
        )
    };
    if conn.is_autocommit() {
        tokenomics_run_write_batch(conn, operation)
    } else {
        operation()
    }
}

fn tokenomics_rekey_all_pruned_usage_rollups_force(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let mut statement = conn
        .prepare(
            "SELECT DISTINCT provider, agent_kind
             FROM tokenomics_pruned_usage_rollups",
        )
        .map_err(|error| format!("Unable to prepare pruned Tokenomics rekey scan: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Unable to query pruned Tokenomics rekey scan: {error}"))?;
    let mut pairs = Vec::new();
    for row in rows {
        pairs.push(
            row.map_err(|error| format!("Unable to read pruned Tokenomics rekey scan: {error}"))?,
        );
    }
    drop(statement);
    for (provider, agent_kind) in pairs {
        tokenomics_rekey_pruned_usage_rollups(conn, &provider, &agent_kind)?;
    }
    Ok(())
}

fn tokenomics_rekey_pruned_usage_rollups(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
) -> Result<usize, String> {
    let operation = || tokenomics_rekey_pruned_usage_rollups_inner(conn, provider, agent_kind);
    if conn.is_autocommit() {
        tokenomics_run_write_batch(conn, operation)
    } else {
        operation()
    }
}

fn tokenomics_rekey_pruned_usage_rollups_inner(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
) -> Result<usize, String> {
    tokenomics_rekey_usage_rollup_table_inner(
        conn,
        "tokenomics_pruned_usage_rollups",
        provider,
        agent_kind,
    )
}

fn tokenomics_rekey_usage_rollup_table_inner(
    conn: &rusqlite::Connection,
    table: &str,
    provider: &str,
    agent_kind: &str,
) -> Result<usize, String> {
    let mut statement = conn
        .prepare(&format!(
            "SELECT id, device_id, provider, agent_kind,
                    NULLIF(model, ''), NULLIF(subscription_key, ''),
                    NULLIF(provider_account_key, ''), NULLIF(provider_account_label, ''),
                    COALESCE(NULLIF(billing_scope_type, ''), 'unknown'),
                    NULLIF(billing_team_id, ''),
                    COALESCE(NULLIF(billing_scope_source, ''), 'unknown'),
                    NULLIF(workspace_id, ''), NULLIF(repo_path, ''),
                    bucket_width, bucket_start,
                    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                    total_tokens, estimated_cost_microusd, event_count
             FROM {table}
             WHERE provider=?1 AND agent_kind=?2"
        ))
        .map_err(|error| format!("Unable to prepare Tokenomics rollup rekey: {error}"))?;
    let rows = statement
        .query_map(rusqlite::params![provider, agent_kind], |row| {
            Ok(TokenomicsPrunedRollupRekeyRow {
                old_id: row.get(0)?,
                device_id: row.get(1)?,
                provider: row.get(2)?,
                agent_kind: row.get(3)?,
                model: row.get(4)?,
                subscription_key: row.get(5)?,
                provider_account_key: row.get(6)?,
                provider_account_label: row.get(7)?,
                billing_scope_type: row.get(8)?,
                billing_team_id: row.get(9)?,
                billing_scope_source: row.get(10)?,
                workspace_id: row.get(11)?,
                repo_path: row.get(12)?,
                bucket_width: row.get(13)?,
                bucket_start: row.get(14)?,
                input_tokens: row.get(15)?,
                output_tokens: row.get(16)?,
                cache_read_tokens: row.get(17)?,
                cache_write_tokens: row.get(18)?,
                total_tokens: row.get(19)?,
                estimated_cost_microusd: row.get(20)?,
                event_count: row.get(21)?,
            })
        })
        .map_err(|error| format!("Unable to query Tokenomics rollup rekey: {error}"))?;
    let mut rekey_rows = Vec::new();
    for row in rows {
        rekey_rows
            .push(row.map_err(|error| format!("Unable to read Tokenomics rollup rekey: {error}"))?);
    }
    drop(statement);

    let mut changed = 0usize;
    let now = tokenomics_now_iso_like();
    for row in rekey_rows {
        let new_id = tokenomics_pruned_rollup_expected_id(&row);
        if new_id == row.old_id {
            continue;
        }
        let updated = conn
            .execute(
                &format!(
                    "UPDATE {table}
                 SET id=?1
                 WHERE id=?2
                   AND NOT EXISTS (
                     SELECT 1 FROM {table} existing
                     WHERE existing.id=?1
                   )"
                ),
                rusqlite::params![new_id.as_str(), row.old_id.as_str()],
            )
            .map_err(|error| format!("Unable to rekey Tokenomics rollup id: {error}"))?;
        if updated > 0 {
            changed = changed.saturating_add(updated);
            continue;
        }

        conn.execute(
            &format!(
                "UPDATE {table}
             SET input_tokens=input_tokens+?2,
                 output_tokens=output_tokens+?3,
                 cache_read_tokens=cache_read_tokens+?4,
                 cache_write_tokens=cache_write_tokens+?5,
                 total_tokens=total_tokens+?6,
                 estimated_cost_microusd=estimated_cost_microusd+?7,
                 event_count=event_count+?8,
                 provider_account_label=COALESCE(NULLIF(?9, ''), provider_account_label),
                 billing_scope_source=COALESCE(NULLIF(?10, ''), billing_scope_source),
                 repo_path=COALESCE(NULLIF(?11, ''), repo_path),
                 updated_at=?12
             WHERE id=?1"
            ),
            rusqlite::params![
                new_id.as_str(),
                row.input_tokens,
                row.output_tokens,
                row.cache_read_tokens,
                row.cache_write_tokens,
                row.total_tokens,
                row.estimated_cost_microusd,
                row.event_count,
                row.provider_account_label.as_deref().unwrap_or_default(),
                row.billing_scope_source.as_str(),
                row.repo_path.as_deref().unwrap_or_default(),
                now.as_str(),
            ],
        )
        .map_err(|error| format!("Unable to merge Tokenomics rollup rekey: {error}"))?;
        conn.execute(
            &format!("DELETE FROM {table} WHERE id=?1"),
            rusqlite::params![row.old_id.as_str()],
        )
        .map_err(|error| format!("Unable to remove stale Tokenomics rollup id: {error}"))?;
        changed = changed.saturating_add(1);
    }
    Ok(changed)
}

fn tokenomics_reconcile_provider_account_label(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    provider_account: &TokenomicsProviderAccount,
) -> Result<(), String> {
    if provider_account.key.ends_with(":unknown") || provider_account.label.trim().is_empty() {
        return Ok(());
    }

    conn.execute(
        "UPDATE tokenomics_usage_events
         SET provider_account_label=?1
         WHERE provider=?2 AND agent_kind=?3 AND provider_account_key=?4
           AND COALESCE(provider_account_label, '') != ?1",
        rusqlite::params![
            provider_account.label.as_str(),
            provider,
            agent_kind,
            provider_account.key.as_str()
        ],
    )
    .map_err(|error| format!("Unable to reconcile Tokenomics account event labels: {error}"))?;

    let now = tokenomics_now_iso_like();
    conn.execute(
        "UPDATE tokenomics_rollups
         SET provider_account_label=?1, updated_at=?5
         WHERE provider=?2 AND agent_kind=?3 AND provider_account_key=?4
           AND COALESCE(provider_account_label, '') != ?1",
        rusqlite::params![
            provider_account.label.as_str(),
            provider,
            agent_kind,
            provider_account.key.as_str(),
            now.as_str()
        ],
    )
    .map_err(|error| format!("Unable to reconcile Tokenomics account rollup labels: {error}"))?;
    conn.execute(
        "UPDATE tokenomics_pruned_usage_rollups
         SET provider_account_label=?1, updated_at=?5
         WHERE provider=?2 AND agent_kind=?3 AND provider_account_key=?4
           AND COALESCE(provider_account_label, '') != ?1",
        rusqlite::params![
            provider_account.label.as_str(),
            provider,
            agent_kind,
            provider_account.key.as_str(),
            now.as_str()
        ],
    )
    .map_err(|error| format!("Unable to reconcile pruned Tokenomics account labels: {error}"))?;

    Ok(())
}

fn tokenomics_account_key_exists_in_column(
    conn: &rusqlite::Connection,
    table: &str,
    column: &str,
    provider: &str,
    agent_kind: &str,
    account_key: &str,
) -> Result<bool, String> {
    let sql = format!(
        "SELECT 1 FROM {table}
         WHERE provider=?1 AND agent_kind=?2 AND {column}=?3
         LIMIT 1"
    );
    match conn.query_row(
        &sql,
        rusqlite::params![provider, agent_kind, account_key],
        |_| Ok(()),
    ) {
        Ok(()) => Ok(true),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(error) => Err(format!(
            "Unable to probe Tokenomics account key in {table}.{column}: {error}"
        )),
    }
}

fn tokenomics_like_contains_pattern(value: &str) -> String {
    let mut pattern = String::with_capacity(value.len().saturating_add(2));
    pattern.push('%');
    for character in value.chars() {
        match character {
            '\\' | '%' | '_' => {
                pattern.push('\\');
                pattern.push(character);
            }
            _ => pattern.push(character),
        }
    }
    pattern.push('%');
    pattern
}

fn tokenomics_cached_cloud_limits_may_reference_account_key(
    conn: &rusqlite::Connection,
    account_key: &str,
) -> Result<bool, String> {
    let needle = serde_json::to_string(account_key)
        .map_err(|error| format!("Unable to encode Tokenomics account key probe: {error}"))?;
    let pattern = tokenomics_like_contains_pattern(&needle);
    match conn.query_row(
        "SELECT 1 FROM tokenomics_meta
         WHERE key=?1 AND value LIKE ?2 ESCAPE '\\'
         LIMIT 1",
        rusqlite::params![TOKENOMICS_CLOUD_PROVIDER_LIMITS_KEY, pattern.as_str()],
        |_| Ok(()),
    ) {
        Ok(()) => Ok(true),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(error) => Err(format!(
            "Unable to probe cached cloud Tokenomics limits for account key: {error}"
        )),
    }
}

fn tokenomics_migrate_provider_account_key(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    old_key: &str,
    provider_account: &TokenomicsProviderAccount,
) -> Result<(), String> {
    tokenomics_migrate_provider_account_key_with_options(
        conn,
        provider,
        agent_kind,
        old_key,
        provider_account,
        false,
    )
}

fn tokenomics_migrate_provider_account_key_with_options(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    old_key: &str,
    provider_account: &TokenomicsProviderAccount,
    preserve_rollup_only_history: bool,
) -> Result<(), String> {
    if old_key.trim().is_empty()
        || old_key == provider_account.key
        || provider_account.key.ends_with(":unknown")
    {
        return Ok(());
    }

    let events_by_account = tokenomics_account_key_exists_in_column(
        conn,
        "tokenomics_usage_events",
        "provider_account_key",
        provider,
        agent_kind,
        old_key,
    )?;
    let events_by_subscription = tokenomics_account_key_exists_in_column(
        conn,
        "tokenomics_usage_events",
        "subscription_key",
        provider,
        agent_kind,
        old_key,
    )?;
    let pruned_by_account = tokenomics_account_key_exists_in_column(
        conn,
        "tokenomics_pruned_usage_rollups",
        "provider_account_key",
        provider,
        agent_kind,
        old_key,
    )?;
    let pruned_by_subscription = tokenomics_account_key_exists_in_column(
        conn,
        "tokenomics_pruned_usage_rollups",
        "subscription_key",
        provider,
        agent_kind,
        old_key,
    )?;
    let rollups_by_account = tokenomics_account_key_exists_in_column(
        conn,
        "tokenomics_rollups",
        "provider_account_key",
        provider,
        agent_kind,
        old_key,
    )?;
    let rollups_by_subscription = tokenomics_account_key_exists_in_column(
        conn,
        "tokenomics_rollups",
        "subscription_key",
        provider,
        agent_kind,
        old_key,
    )?;
    let limit_samples_exist = tokenomics_account_key_exists_in_column(
        conn,
        "tokenomics_provider_limit_samples",
        "provider_account_key",
        provider,
        agent_kind,
        old_key,
    )?;
    let latest_windows_exist = tokenomics_account_key_exists_in_column(
        conn,
        "tokenomics_latest_windows",
        "provider_account_key",
        provider,
        agent_kind,
        old_key,
    )?;
    let provider_accounts_exist = tokenomics_account_key_exists_in_column(
        conn,
        "tokenomics_provider_accounts",
        "provider_account_key",
        provider,
        agent_kind,
        old_key,
    )?;
    let cloud_by_account = tokenomics_account_key_exists_in_column(
        conn,
        "tokenomics_cloud_rollups",
        "provider_account_key",
        provider,
        agent_kind,
        old_key,
    )?;
    let cloud_by_subscription = tokenomics_account_key_exists_in_column(
        conn,
        "tokenomics_cloud_rollups",
        "subscription_key",
        provider,
        agent_kind,
        old_key,
    )?;
    let cloud_limits_exist =
        tokenomics_cached_cloud_limits_may_reference_account_key(conn, old_key)?;

    if !(events_by_account
        || events_by_subscription
        || pruned_by_account
        || pruned_by_subscription
        || rollups_by_account
        || rollups_by_subscription
        || limit_samples_exist
        || latest_windows_exist
        || provider_accounts_exist
        || cloud_by_account
        || cloud_by_subscription
        || cloud_limits_exist)
    {
        return Ok(());
    }

    let mut changed_events = 0usize;
    if events_by_account {
        changed_events = changed_events.saturating_add(
            conn.execute(
                "UPDATE tokenomics_usage_events
                 SET subscription_key=?1, provider_account_key=?1, provider_account_label=?2
                 WHERE provider=?3 AND agent_kind=?4 AND provider_account_key=?5",
                rusqlite::params![
                    provider_account.key.as_str(),
                    provider_account.label.as_str(),
                    provider,
                    agent_kind,
                    old_key
                ],
            )
            .map_err(|error| format!("Unable to migrate Tokenomics account events: {error}"))?,
        );
    }
    if events_by_subscription {
        changed_events = changed_events.saturating_add(
            conn.execute(
                "UPDATE tokenomics_usage_events
                 SET subscription_key=?1, provider_account_key=?1, provider_account_label=?2
                 WHERE provider=?3 AND agent_kind=?4 AND subscription_key=?5",
                rusqlite::params![
                    provider_account.key.as_str(),
                    provider_account.label.as_str(),
                    provider,
                    agent_kind,
                    old_key
                ],
            )
            .map_err(|error| {
                format!("Unable to migrate Tokenomics subscription events: {error}")
            })?,
        );
    }

    let mut changed_pruned = 0usize;
    if pruned_by_account {
        changed_pruned = changed_pruned.saturating_add(
            conn.execute(
                "UPDATE tokenomics_pruned_usage_rollups
                 SET subscription_key=?1, provider_account_key=?1, provider_account_label=?2
                 WHERE provider=?3 AND agent_kind=?4 AND provider_account_key=?5",
                rusqlite::params![
                    provider_account.key.as_str(),
                    provider_account.label.as_str(),
                    provider,
                    agent_kind,
                    old_key
                ],
            )
            .map_err(|error| {
                format!("Unable to migrate pruned Tokenomics account rollups: {error}")
            })?,
        );
    }
    if pruned_by_subscription {
        changed_pruned = changed_pruned.saturating_add(
            conn.execute(
                "UPDATE tokenomics_pruned_usage_rollups
                 SET subscription_key=?1, provider_account_key=?1, provider_account_label=?2
                 WHERE provider=?3 AND agent_kind=?4 AND subscription_key=?5",
                rusqlite::params![
                    provider_account.key.as_str(),
                    provider_account.label.as_str(),
                    provider,
                    agent_kind,
                    old_key
                ],
            )
            .map_err(|error| {
                format!("Unable to migrate pruned Tokenomics subscription rollups: {error}")
            })?,
        );
    }

    if changed_pruned > 0 {
        tokenomics_rekey_pruned_usage_rollups(conn, provider, agent_kind)?;
    }
    if preserve_rollup_only_history {
        let mut changed_rollups = 0usize;
        if rollups_by_account {
            changed_rollups = changed_rollups.saturating_add(
                conn.execute(
                    "UPDATE tokenomics_rollups
                 SET subscription_key=?1, provider_account_key=?1, provider_account_label=?2
                 WHERE provider=?3 AND agent_kind=?4 AND provider_account_key=?5",
                    rusqlite::params![
                        provider_account.key.as_str(),
                        provider_account.label.as_str(),
                        provider,
                        agent_kind,
                        old_key,
                    ],
                )
                .map_err(|error| {
                    format!("Unable to migrate Tokenomics account rollups: {error}")
                })?,
            );
        }
        if rollups_by_subscription {
            changed_rollups = changed_rollups.saturating_add(
                conn.execute(
                    "UPDATE tokenomics_rollups
                 SET subscription_key=?1, provider_account_key=?1, provider_account_label=?2
                 WHERE provider=?3 AND agent_kind=?4 AND subscription_key=?5",
                    rusqlite::params![
                        provider_account.key.as_str(),
                        provider_account.label.as_str(),
                        provider,
                        agent_kind,
                        old_key,
                    ],
                )
                .map_err(|error| {
                    format!("Unable to migrate Tokenomics subscription rollups: {error}")
                })?,
            );
        }
        if changed_rollups > 0 {
            tokenomics_rekey_usage_rollup_table_inner(
                conn,
                "tokenomics_rollups",
                provider,
                agent_kind,
            )?;
        }
    } else if changed_events > 0
        || changed_pruned > 0
        || rollups_by_account
        || rollups_by_subscription
    {
        tokenomics_rebuild_provider_rollups_from_events(conn, provider, agent_kind)?;
    }
    if provider == "openai" && agent_kind == "codex" {
        tokenomics_store_codex_usage_cache_alias(conn, old_key, provider_account.key.as_str())?;
    }

    let now = tokenomics_now_iso_like();
    let now_unix = tokenomics_unix_now() as i64;
    if limit_samples_exist {
        conn.execute(
            "UPDATE tokenomics_provider_limit_samples
             SET provider_account_key=?1, provider_account_label=?2, updated_at=?6, updated_at_unix=?7
             WHERE provider=?3 AND agent_kind=?4 AND provider_account_key=?5",
            rusqlite::params![
                provider_account.key.as_str(),
                provider_account.label.as_str(),
                provider,
                agent_kind,
                old_key,
                now.as_str(),
                now_unix
            ],
        )
        .map_err(|error| format!("Unable to migrate Tokenomics account limit samples: {error}"))?;
    }

    if latest_windows_exist {
        conn.execute(
            "UPDATE tokenomics_latest_windows
             SET provider_account_key=?1, provider_account_label=?2, updated_at=?6, updated_at_unix=?7
             WHERE provider=?3 AND agent_kind=?4 AND provider_account_key=?5",
            rusqlite::params![
                provider_account.key.as_str(),
                provider_account.label.as_str(),
                provider,
                agent_kind,
                old_key,
                now.as_str(),
                now_unix
            ],
        )
        .map_err(|error| format!("Unable to migrate Tokenomics account live windows: {error}"))?;
    }

    let mut migrated_account_rows = Vec::new();
    if provider_accounts_exist {
        let mut account_statement = conn
            .prepare(
                "SELECT device_id,
                        COALESCE(NULLIF(billing_scope_type, ''), 'unknown') AS billing_scope_type,
                        NULLIF(billing_team_id, '') AS billing_team_id,
                        COALESCE(NULLIF(billing_scope_source, ''), 'unknown') AS billing_scope_source,
                        COALESCE(NULLIF(attribution_source, ''), 'account_migration') AS attribution_source,
                        first_seen_at, last_seen_at, updated_at, updated_at_unix
                 FROM tokenomics_provider_accounts
                 WHERE provider=?1 AND agent_kind=?2 AND provider_account_key=?3",
            )
            .map_err(|error| format!("Unable to inspect Tokenomics account badges: {error}"))?;
        let account_rows = account_statement
            .query_map(rusqlite::params![provider, agent_kind, old_key], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    TokenomicsBillingScope {
                        scope_type: row.get::<_, String>(1)?,
                        team_id: row.get::<_, Option<String>>(2)?,
                        source: row.get::<_, String>(3)?,
                    },
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, i64>(8)?,
                ))
            })
            .map_err(|error| format!("Unable to query Tokenomics account badges: {error}"))?;
        for row in account_rows {
            migrated_account_rows.push(
                row.map_err(|error| format!("Unable to read Tokenomics account badge: {error}"))?,
            );
        }
        drop(account_statement);
    }
    for (
        device_id,
        scope,
        attribution_source,
        first_seen_at,
        last_seen_at,
        updated_at,
        updated_at_unix,
    ) in migrated_account_rows
    {
        let id = tokenomics_provider_account_row_id(
            &device_id,
            provider,
            agent_kind,
            &provider_account.key,
            &scope,
        );
        conn.execute(
            "INSERT INTO tokenomics_provider_accounts(
               id, device_id, provider, agent_kind, provider_account_key,
               provider_account_label, billing_scope_type, billing_team_id,
               billing_scope_source, attribution_source, first_seen_at,
               last_seen_at, updated_at, updated_at_unix
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(id) DO UPDATE SET
               provider_account_label=CASE
                 WHEN TRIM(COALESCE(tokenomics_provider_accounts.provider_account_label, ''))!=''
                 THEN tokenomics_provider_accounts.provider_account_label
                 ELSE excluded.provider_account_label
               END,
               billing_scope_source=CASE
                 WHEN TRIM(COALESCE(tokenomics_provider_accounts.billing_scope_source, '')) NOT IN ('', 'unknown')
                 THEN tokenomics_provider_accounts.billing_scope_source
                 ELSE excluded.billing_scope_source
               END,
               attribution_source=CASE
                 WHEN TRIM(COALESCE(tokenomics_provider_accounts.attribution_source, '')) NOT IN ('', 'unknown')
                 THEN tokenomics_provider_accounts.attribution_source
                 ELSE excluded.attribution_source
               END,
               first_seen_at=MIN(tokenomics_provider_accounts.first_seen_at, excluded.first_seen_at),
               last_seen_at=MAX(tokenomics_provider_accounts.last_seen_at, excluded.last_seen_at),
               updated_at=MAX(tokenomics_provider_accounts.updated_at, excluded.updated_at),
               updated_at_unix=MAX(tokenomics_provider_accounts.updated_at_unix, excluded.updated_at_unix)",
            rusqlite::params![
                id,
                device_id,
                provider,
                agent_kind,
                provider_account.key.as_str(),
                provider_account.label.as_str(),
                scope.scope_type.as_str(),
                scope.team_id.as_deref(),
                scope.source.as_str(),
                attribution_source,
                first_seen_at,
                last_seen_at,
                updated_at,
                updated_at_unix,
            ],
        )
        .map_err(|error| format!("Unable to merge Tokenomics account badges: {error}"))?;
    }
    if provider_accounts_exist {
        conn.execute(
            "DELETE FROM tokenomics_provider_accounts
             WHERE provider=?1 AND agent_kind=?2 AND provider_account_key=?3",
            rusqlite::params![provider, agent_kind, old_key],
        )
        .map_err(|error| format!("Unable to remove stale Tokenomics account badges: {error}"))?;
    }

    if cloud_by_account {
        conn.execute(
            "UPDATE tokenomics_cloud_rollups
             SET provider_account_key=?1,
                 subscription_key=CASE WHEN subscription_key=?5 THEN ?1 ELSE subscription_key END,
                 provider_account_label=?2,
                 updated_at=?6
             WHERE provider=?3 AND agent_kind=?4 AND provider_account_key=?5",
            rusqlite::params![
                provider_account.key.as_str(),
                provider_account.label.as_str(),
                provider,
                agent_kind,
                old_key,
                now.as_str()
            ],
        )
        .map_err(|error| {
            format!("Unable to migrate cached cloud Tokenomics account rollups: {error}")
        })?;
    }
    if cloud_by_subscription {
        conn.execute(
            "UPDATE tokenomics_cloud_rollups
             SET subscription_key=?1,
                 provider_account_key=CASE WHEN provider_account_key=?5 THEN ?1 ELSE provider_account_key END,
                 provider_account_label=?2,
                 updated_at=?6
             WHERE provider=?3 AND agent_kind=?4 AND subscription_key=?5",
            rusqlite::params![
                provider_account.key.as_str(),
                provider_account.label.as_str(),
                provider,
                agent_kind,
                old_key,
                now.as_str()
            ],
        )
        .map_err(|error| {
            format!("Unable to migrate cached cloud Tokenomics subscription rollups: {error}")
        })?;
    }
    if cloud_by_account || cloud_by_subscription || cloud_limits_exist {
        tokenomics_rewrite_cloud_provider_limits_for_account_key(
            conn,
            provider,
            agent_kind,
            old_key,
            provider_account,
        )?;
    }

    Ok(())
}

/// Durably retires a synthetic profile account key. When `canonical_key` is
/// present, all local usage history is migrated in the same transaction before
/// the retirement marker becomes visible.
pub(crate) fn tokenomics_persist_retired_provider_account_key(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    account_key: &str,
    canonical_key: Option<&str>,
) -> Result<(), String> {
    let provider = provider.trim();
    let agent_kind = agent_kind.trim();
    let account_key = account_key.trim();
    if provider.is_empty() || agent_kind.is_empty() || account_key.is_empty() {
        return Err("Unable to retire an empty Tokenomics provider account key".to_string());
    }
    let canonical_key = canonical_key
        .map(str::trim)
        .filter(|key| !key.is_empty() && *key != account_key);
    tokenomics_run_write_batch(conn, || {
        if let Some(canonical_key) = canonical_key {
            let label = tokenomics_existing_provider_account_label_for_key(
                conn,
                provider,
                agent_kind,
                canonical_key,
            )
            .or_else(|| {
                tokenomics_existing_provider_account_label_for_key(
                    conn,
                    provider,
                    agent_kind,
                    account_key,
                )
            })
            .unwrap_or_else(|| canonical_key.to_string());
            let canonical_account = TokenomicsProviderAccount {
                key: canonical_key.to_string(),
                label,
            };
            tokenomics_migrate_provider_account_key_with_options(
                conn,
                provider,
                agent_kind,
                account_key,
                &canonical_account,
                true,
            )?;
        }
        conn.execute(
            "INSERT INTO tokenomics_retired_provider_accounts(
               provider, agent_kind, provider_account_key, canonical_key, retired_at
             ) VALUES(?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(provider, agent_kind, provider_account_key)
             DO UPDATE SET canonical_key=excluded.canonical_key,
                           retired_at=excluded.retired_at",
            rusqlite::params![
                provider,
                agent_kind,
                account_key,
                canonical_key,
                tokenomics_now_iso_like(),
            ],
        )
        .map_err(|error| format!("Unable to persist retired Tokenomics account: {error}"))?;
        Ok(())
    })?;
    if let Ok(mut cache) = tokenomics_provider_account_reconcile_cache().lock() {
        *cache = None;
    }
    tokenomics_clear_summary_cache();
    Ok(())
}

pub(crate) fn tokenomics_persist_retired_provider_account_key_for_app(
    app: &AppHandle,
    provider: &str,
    agent_kind: &str,
    account_key: &str,
    canonical_key: Option<&str>,
) -> Result<(), String> {
    let conn = tokenomics_open_db(app)?;
    tokenomics_persist_retired_provider_account_key(
        &conn,
        provider,
        agent_kind,
        account_key,
        canonical_key,
    )
}

fn tokenomics_provider_account_label_is_profile(label: &str) -> bool {
    let clean = label.trim();
    clean.starts_with("Codex · ")
        || clean.starts_with("Codex • ")
        || clean.starts_with("Claude · ")
        || clean.starts_with("Claude • ")
}

fn tokenomics_clean_non_profile_provider_account_label(label: &str) -> Option<String> {
    tokenomics_account_label_text(label.to_string())
        .filter(|clean| !tokenomics_provider_account_label_is_profile(clean))
}

fn tokenomics_normalized_provider_account_identity_label(
    provider: &str,
    agent_kind: &str,
    label: &str,
) -> Option<String> {
    let clean = tokenomics_clean_non_profile_provider_account_label(label)?;
    if clean.chars().count() <= 1 {
        return None;
    }
    let normalized = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let normalized_lower = normalized.to_lowercase();
    let base_lower = tokenomics_provider_account_base_label(provider, agent_kind).to_lowercase();
    if normalized_lower == base_lower || normalized_lower.starts_with(&format!("{base_lower} ")) {
        return None;
    }
    Some(normalized_lower)
}

#[derive(Clone, Debug)]
struct TokenomicsProviderAccountIdentityCandidate {
    provider: String,
    agent_kind: String,
    provider_account_key: String,
    provider_account_label: String,
    normalized_label: String,
    usage_total: i64,
    rollup_total: i64,
    cloud_total: i64,
    limit_rows: i64,
    latest_rows: i64,
    account_rows: i64,
    updated_at_unix: i64,
}

impl TokenomicsProviderAccountIdentityCandidate {
    fn authoritative_rows(&self) -> i64 {
        self.limit_rows + self.latest_rows
    }

    fn authoritative_tokens(&self) -> i64 {
        self.usage_total + self.rollup_total + self.cloud_total
    }

    fn has_authoritative_data(&self) -> bool {
        self.authoritative_tokens() > 0 || self.authoritative_rows() > 0
    }
}

fn tokenomics_provider_account_identity_candidates(
    conn: &rusqlite::Connection,
) -> Result<Vec<TokenomicsProviderAccountIdentityCandidate>, String> {
    let mut statement = conn
        .prepare(
            "SELECT
               provider,
               agent_kind,
               provider_account_key,
               provider_account_label,
               SUM(usage_total) AS usage_total,
               SUM(rollup_total) AS rollup_total,
               SUM(cloud_total) AS cloud_total,
               SUM(limit_rows) AS limit_rows,
               SUM(latest_rows) AS latest_rows,
               SUM(account_rows) AS account_rows,
               MAX(updated_at_unix) AS updated_at_unix
             FROM (
               SELECT
                 provider,
                 agent_kind,
                 COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, '')) AS provider_account_key,
                 provider_account_label,
                 COALESCE(SUM(total_tokens), 0) AS usage_total,
                 0 AS rollup_total,
                 0 AS cloud_total,
                 0 AS limit_rows,
                 0 AS latest_rows,
                 0 AS account_rows,
                 0 AS updated_at_unix
	               FROM tokenomics_usage_events
	               WHERE COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, ''), '') != ''
	                 AND COALESCE(provider_account_label, '') != ''
	               GROUP BY provider, agent_kind, provider_account_key, provider_account_label
	               UNION ALL
	               SELECT
	                 provider,
	                 agent_kind,
	                 COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, '')) AS provider_account_key,
	                 provider_account_label,
	                 COALESCE(SUM(total_tokens), 0) AS usage_total,
	                 0 AS rollup_total,
	                 0 AS cloud_total,
	                 0 AS limit_rows,
	                 0 AS latest_rows,
	                 0 AS account_rows,
	                 0 AS updated_at_unix
	               FROM tokenomics_pruned_usage_rollups
	               WHERE bucket_width='hour'
	                 AND COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, ''), '') != ''
	                 AND COALESCE(provider_account_label, '') != ''
	               GROUP BY provider, agent_kind, provider_account_key, provider_account_label
	               UNION ALL
	               SELECT
	                 provider,
	                 agent_kind,
                 COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, '')) AS provider_account_key,
                 provider_account_label,
                 0 AS usage_total,
                 COALESCE(SUM(total_tokens), 0) AS rollup_total,
                 0 AS cloud_total,
                 0 AS limit_rows,
                 0 AS latest_rows,
                 0 AS account_rows,
                 0 AS updated_at_unix
               FROM tokenomics_rollups
               WHERE bucket_width='hour'
                 AND COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, ''), '') != ''
                 AND COALESCE(provider_account_label, '') != ''
               GROUP BY provider, agent_kind, provider_account_key, provider_account_label
               UNION ALL
               SELECT
                 provider,
                 agent_kind,
                 COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, '')) AS provider_account_key,
                 provider_account_label,
                 0 AS usage_total,
                 0 AS rollup_total,
                 COALESCE(SUM(total_tokens), 0) AS cloud_total,
                 0 AS limit_rows,
                 0 AS latest_rows,
                 0 AS account_rows,
                 0 AS updated_at_unix
               FROM tokenomics_cloud_rollups
               WHERE bucket_width='hour'
                 AND COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, ''), '') != ''
                 AND COALESCE(provider_account_label, '') != ''
               GROUP BY provider, agent_kind, provider_account_key, provider_account_label
               UNION ALL
               SELECT
                 provider,
                 agent_kind,
                 provider_account_key,
                 provider_account_label,
                 0 AS usage_total,
                 0 AS rollup_total,
                 0 AS cloud_total,
                 COUNT(*) AS limit_rows,
                 0 AS latest_rows,
                 0 AS account_rows,
                 MAX(updated_at_unix) AS updated_at_unix
               FROM tokenomics_provider_limit_samples
               WHERE COALESCE(provider_account_key, '') != ''
                 AND COALESCE(provider_account_label, '') != ''
               GROUP BY provider, agent_kind, provider_account_key, provider_account_label
               UNION ALL
               SELECT
                 provider,
                 agent_kind,
                 provider_account_key,
                 provider_account_label,
                 0 AS usage_total,
                 0 AS rollup_total,
                 0 AS cloud_total,
                 0 AS limit_rows,
                 COUNT(*) AS latest_rows,
                 0 AS account_rows,
                 MAX(updated_at_unix) AS updated_at_unix
               FROM tokenomics_latest_windows
               WHERE COALESCE(provider_account_key, '') != ''
                 AND COALESCE(provider_account_label, '') != ''
               GROUP BY provider, agent_kind, provider_account_key, provider_account_label
               UNION ALL
               SELECT
                 provider,
                 agent_kind,
                 provider_account_key,
                 provider_account_label,
                 0 AS usage_total,
                 0 AS rollup_total,
                 0 AS cloud_total,
                 0 AS limit_rows,
                 0 AS latest_rows,
                 COUNT(*) AS account_rows,
                 MAX(updated_at_unix) AS updated_at_unix
               FROM tokenomics_provider_accounts
               WHERE COALESCE(provider_account_key, '') != ''
                 AND COALESCE(provider_account_label, '') != ''
               GROUP BY provider, agent_kind, provider_account_key, provider_account_label
             )
             GROUP BY provider, agent_kind, provider_account_key, provider_account_label",
        )
        .map_err(|error| {
            format!("Unable to prepare Tokenomics provider account identity query: {error}")
        })?;
    let mapped = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, i64>(10)?,
            ))
        })
        .map_err(|error| {
            format!("Unable to query Tokenomics provider account identities: {error}")
        })?;
    let mut candidates_by_key = HashMap::<
        (String, String, String, String),
        TokenomicsProviderAccountIdentityCandidate,
    >::new();
    for row in mapped {
        let (
            provider,
            agent_kind,
            provider_account_key,
            provider_account_label,
            usage_total,
            rollup_total,
            cloud_total,
            limit_rows,
            latest_rows,
            account_rows,
            updated_at_unix,
        ) = row.map_err(|error| {
            format!("Unable to read Tokenomics provider account identity row: {error}")
        })?;
        let provider = provider.trim().to_ascii_lowercase();
        let agent_kind = agent_kind.trim().to_ascii_lowercase();
        let provider_account_key = provider_account_key.trim().to_string();
        if provider.is_empty()
            || agent_kind.is_empty()
            || provider_account_key.is_empty()
            || provider_account_key.ends_with(":unknown")
        {
            continue;
        }
        let Some(provider_account_label) =
            tokenomics_clean_non_profile_provider_account_label(&provider_account_label)
        else {
            continue;
        };
        let Some(normalized_label) = tokenomics_normalized_provider_account_identity_label(
            &provider,
            &agent_kind,
            &provider_account_label,
        ) else {
            continue;
        };
        let key = (
            provider.clone(),
            agent_kind.clone(),
            normalized_label.clone(),
            provider_account_key.clone(),
        );
        let entry = candidates_by_key.entry(key).or_insert_with(|| {
            TokenomicsProviderAccountIdentityCandidate {
                provider,
                agent_kind,
                provider_account_key,
                provider_account_label,
                normalized_label,
                usage_total: 0,
                rollup_total: 0,
                cloud_total: 0,
                limit_rows: 0,
                latest_rows: 0,
                account_rows: 0,
                updated_at_unix: 0,
            }
        });
        entry.usage_total += usage_total;
        entry.rollup_total += rollup_total;
        entry.cloud_total += cloud_total;
        entry.limit_rows += limit_rows;
        entry.latest_rows += latest_rows;
        entry.account_rows += account_rows;
        entry.updated_at_unix = entry.updated_at_unix.max(updated_at_unix);
    }
    Ok(candidates_by_key.into_values().collect())
}

fn tokenomics_compact_provider_account_rows(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM tokenomics_provider_accounts
         WHERE NOT EXISTS (
           SELECT 1 FROM tokenomics_usage_events events
           WHERE events.provider=tokenomics_provider_accounts.provider
             AND events.agent_kind=tokenomics_provider_accounts.agent_kind
             AND (events.provider_account_key=tokenomics_provider_accounts.provider_account_key
               OR events.subscription_key=tokenomics_provider_accounts.provider_account_key)
         )
         AND NOT EXISTS (
           SELECT 1 FROM tokenomics_rollups rollups
           WHERE rollups.provider=tokenomics_provider_accounts.provider
             AND rollups.agent_kind=tokenomics_provider_accounts.agent_kind
             AND (rollups.provider_account_key=tokenomics_provider_accounts.provider_account_key
               OR rollups.subscription_key=tokenomics_provider_accounts.provider_account_key)
         )
         AND NOT EXISTS (
           SELECT 1 FROM tokenomics_pruned_usage_rollups pruned_rollups
           WHERE pruned_rollups.provider=tokenomics_provider_accounts.provider
             AND pruned_rollups.agent_kind=tokenomics_provider_accounts.agent_kind
             AND (pruned_rollups.provider_account_key=tokenomics_provider_accounts.provider_account_key
               OR pruned_rollups.subscription_key=tokenomics_provider_accounts.provider_account_key)
         )
         AND NOT EXISTS (
           SELECT 1 FROM tokenomics_cloud_rollups cloud_rollups
           WHERE cloud_rollups.provider=tokenomics_provider_accounts.provider
             AND cloud_rollups.agent_kind=tokenomics_provider_accounts.agent_kind
             AND (cloud_rollups.provider_account_key=tokenomics_provider_accounts.provider_account_key
               OR cloud_rollups.subscription_key=tokenomics_provider_accounts.provider_account_key)
         )
         AND NOT EXISTS (
           SELECT 1 FROM tokenomics_provider_limit_samples samples
           WHERE samples.provider=tokenomics_provider_accounts.provider
             AND samples.agent_kind=tokenomics_provider_accounts.agent_kind
             AND samples.provider_account_key=tokenomics_provider_accounts.provider_account_key
         )
         AND NOT EXISTS (
           SELECT 1 FROM tokenomics_latest_windows windows
           WHERE windows.provider=tokenomics_provider_accounts.provider
             AND windows.agent_kind=tokenomics_provider_accounts.agent_kind
             AND windows.provider_account_key=tokenomics_provider_accounts.provider_account_key
         )",
        [],
    )
    .map_err(|error| format!("Unable to prune stale Tokenomics account badges: {error}"))?;
    conn.execute(
        "DELETE FROM tokenomics_provider_accounts
         WHERE EXISTS (
           SELECT 1 FROM tokenomics_provider_accounts newer
           WHERE newer.device_id=tokenomics_provider_accounts.device_id
             AND newer.provider=tokenomics_provider_accounts.provider
             AND newer.agent_kind=tokenomics_provider_accounts.agent_kind
             AND newer.provider_account_key=tokenomics_provider_accounts.provider_account_key
             AND COALESCE(newer.billing_scope_type, 'unknown')=COALESCE(tokenomics_provider_accounts.billing_scope_type, 'unknown')
             AND COALESCE(newer.billing_team_id, '')=COALESCE(tokenomics_provider_accounts.billing_team_id, '')
             AND (
               COALESCE(newer.updated_at_unix, 0) > COALESCE(tokenomics_provider_accounts.updated_at_unix, 0)
               OR (
                 COALESCE(newer.updated_at_unix, 0)=COALESCE(tokenomics_provider_accounts.updated_at_unix, 0)
                 AND newer.rowid > tokenomics_provider_accounts.rowid
               )
             )
         )",
        [],
    )
    .map_err(|error| format!("Unable to compact Tokenomics account badges: {error}"))?;
    Ok(())
}

fn tokenomics_compact_provider_account_fact_rows(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM tokenomics_latest_windows
         WHERE EXISTS (
           SELECT 1 FROM tokenomics_latest_windows newer
           WHERE newer.device_id=tokenomics_latest_windows.device_id
             AND newer.provider=tokenomics_latest_windows.provider
             AND newer.agent_kind=tokenomics_latest_windows.agent_kind
             AND newer.provider_account_key=tokenomics_latest_windows.provider_account_key
             AND COALESCE(newer.billing_scope_type, 'unknown')=COALESCE(tokenomics_latest_windows.billing_scope_type, 'unknown')
             AND COALESCE(newer.billing_team_id, '')=COALESCE(tokenomics_latest_windows.billing_team_id, '')
             AND newer.window_kind=tokenomics_latest_windows.window_kind
             AND (
               COALESCE(newer.sample_at_unix, 0) > COALESCE(tokenomics_latest_windows.sample_at_unix, 0)
               OR (
                 COALESCE(newer.sample_at_unix, 0)=COALESCE(tokenomics_latest_windows.sample_at_unix, 0)
                 AND newer.rowid > tokenomics_latest_windows.rowid
               )
             )
         )",
        [],
    )
    .map_err(|error| format!("Unable to compact Tokenomics account windows: {error}"))?;
    conn.execute(
        "DELETE FROM tokenomics_provider_limit_samples
         WHERE EXISTS (
           SELECT 1 FROM tokenomics_provider_limit_samples newer
           WHERE newer.device_id=tokenomics_provider_limit_samples.device_id
             AND newer.provider=tokenomics_provider_limit_samples.provider
             AND newer.agent_kind=tokenomics_provider_limit_samples.agent_kind
             AND newer.provider_account_key=tokenomics_provider_limit_samples.provider_account_key
             AND COALESCE(newer.billing_scope_type, 'unknown')=COALESCE(tokenomics_provider_limit_samples.billing_scope_type, 'unknown')
             AND COALESCE(newer.billing_team_id, '')=COALESCE(tokenomics_provider_limit_samples.billing_team_id, '')
             AND newer.window_kind=tokenomics_provider_limit_samples.window_kind
             AND newer.sample_bucket_unix=tokenomics_provider_limit_samples.sample_bucket_unix
             AND (
               COALESCE(newer.sample_at_unix, 0) > COALESCE(tokenomics_provider_limit_samples.sample_at_unix, 0)
               OR (
                 COALESCE(newer.sample_at_unix, 0)=COALESCE(tokenomics_provider_limit_samples.sample_at_unix, 0)
                 AND newer.rowid > tokenomics_provider_limit_samples.rowid
               )
             )
         )",
        [],
    )
    .map_err(|error| format!("Unable to compact Tokenomics account limit samples: {error}"))?;
    tokenomics_compact_provider_account_rows(conn)?;
    Ok(())
}

fn tokenomics_reconcile_duplicate_provider_account_identities(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    // Display labels are not identities. Two unrelated accounts can both be
    // named "support" (or share a person's display name), so label-only
    // reconciliation must never rewrite provider_account_key on historical
    // facts. Identity-specific legacy migrations happen in their dedicated
    // provider paths; presentation aliases are folded only in the frontend.
    tokenomics_compact_provider_account_rows(conn)?;
    Ok(())
}

fn tokenomics_existing_provider_account_label_for_key(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    provider_account_key: &str,
) -> Option<String> {
    let provider_account_key = provider_account_key.trim();
    if provider_account_key.is_empty() {
        return None;
    }
    if let Ok(label) = conn.query_row(
        "SELECT provider_account_label
         FROM tokenomics_provider_accounts
         WHERE provider=?1 AND agent_kind=?2 AND provider_account_key=?3
           AND TRIM(COALESCE(provider_account_label, ''))!=''
         ORDER BY updated_at_unix DESC
         LIMIT 1",
        rusqlite::params![provider, agent_kind, provider_account_key],
        |row| row.get::<_, String>(0),
    ) {
        if let Some(label) = tokenomics_clean_non_profile_provider_account_label(&label) {
            return Some(label);
        }
    }
    for table in [
        "tokenomics_rollups",
        "tokenomics_usage_events",
        "tokenomics_pruned_usage_rollups",
        "tokenomics_cloud_rollups",
    ] {
        for (column, duplicate_guard) in [
            ("provider_account_key", ""),
            (
                "subscription_key",
                "AND COALESCE(provider_account_key, '')!=?3",
            ),
        ] {
            let sql = format!(
                "SELECT provider_account_label
                 FROM {table}
                 WHERE provider=?1 AND agent_kind=?2
                   AND {column}=?3
                   AND COALESCE(provider_account_label, '')!=''
                   {duplicate_guard}
                 GROUP BY provider_account_label
                 ORDER BY COALESCE(SUM(total_tokens), 0) DESC, COUNT(*) DESC
                 LIMIT 1"
            );
            if let Ok(label) = conn.query_row(
                &sql,
                rusqlite::params![provider, agent_kind, provider_account_key],
                |row| row.get::<_, String>(0),
            ) {
                if let Some(label) = tokenomics_clean_non_profile_provider_account_label(&label) {
                    return Some(label);
                }
            }
        }
    }
    None
}

fn tokenomics_preferred_provider_account_label(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    provider_account_keys: &[&str],
    fallback_label: &str,
) -> String {
    for key in provider_account_keys {
        if let Some(label) =
            tokenomics_existing_provider_account_label_for_key(conn, provider, agent_kind, key)
        {
            return label;
        }
    }
    if let Some(label) = tokenomics_clean_non_profile_provider_account_label(fallback_label) {
        return label;
    }
    let fallback_key = provider_account_keys
        .iter()
        .map(|key| key.trim())
        .find(|key| !key.is_empty())
        .unwrap_or_default();
    let suffix = fallback_key
        .rsplit(':')
        .next()
        .unwrap_or(fallback_key)
        .chars()
        .take(8)
        .collect::<String>();
    let base_label = tokenomics_provider_account_base_label(provider, agent_kind);
    if suffix.is_empty() {
        base_label
    } else {
        format!("{base_label} {suffix}")
    }
}

fn tokenomics_codex_usage_account_id(usage: &Value) -> Option<String> {
    for keys in [
        &["account_id", "accountId"][..],
        &["chatgpt_account_id", "chatgptAccountId"][..],
    ] {
        if let Some(identifier) = tokenomics_value_string(usage, keys)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            return Some(identifier);
        }
        let mut identifiers = Vec::new();
        tokenomics_collect_json_values_for_keys(usage, keys, &mut identifiers);
        identifiers.sort();
        identifiers.dedup();
        if let Some(identifier) = identifiers
            .into_iter()
            .map(|value| value.trim().to_string())
            .find(|value| !value.is_empty())
        {
            return Some(identifier);
        }
    }
    None
}

fn tokenomics_codex_provider_account_key_from_usage_account_id(account_id: &str) -> String {
    let hash = tokenomics_hash(&format!("openai:codex:{}", account_id.trim()));
    let key_suffix = hash.get(0..32).unwrap_or(hash.as_str());
    format!("openai:codex:{key_suffix}")
}

fn tokenomics_codex_canonical_provider_account_from_usage(
    conn: &rusqlite::Connection,
    usage: &Value,
    fallback_account: &TokenomicsProviderAccount,
) -> TokenomicsProviderAccount {
    let Some(account_id) = tokenomics_codex_usage_account_id(usage) else {
        return fallback_account.clone();
    };
    let canonical_key = tokenomics_codex_provider_account_key_from_usage_account_id(&account_id);
    let label = tokenomics_preferred_provider_account_label(
        conn,
        "openai",
        "codex",
        &[canonical_key.as_str(), fallback_account.key.as_str()],
        fallback_account.label.as_str(),
    );
    TokenomicsProviderAccount {
        key: canonical_key,
        label,
    }
}

fn tokenomics_codex_light_provider_account_from_usage(
    usage: &Value,
    fallback_account: &TokenomicsProviderAccount,
) -> TokenomicsProviderAccount {
    let Some(account_id) = tokenomics_codex_usage_account_id(usage) else {
        return fallback_account.clone();
    };
    let key = tokenomics_codex_provider_account_key_from_usage_account_id(&account_id);
    let label = tokenomics_clean_non_profile_provider_account_label(&fallback_account.label)
        .unwrap_or_else(|| fallback_account.label.clone());
    TokenomicsProviderAccount { key, label }
}

fn tokenomics_rewrite_cloud_provider_limits_for_account_key(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    old_key: &str,
    provider_account: &TokenomicsProviderAccount,
) -> Result<(), String> {
    let mut limits = tokenomics_cloud_provider_limits_raw(conn)?;
    let inferred_device_id = tokenomics_cloud_rollup_device_for_account(
        conn,
        provider,
        agent_kind,
        &[provider_account.key.as_str(), old_key],
    )?;
    let mut changed = false;
    for limit in &mut limits {
        let row_provider =
            tokenomics_value_string(limit, &["provider"]).unwrap_or_else(|| "unknown".to_string());
        let row_agent =
            tokenomics_value_string(limit, &["agent_kind"]).unwrap_or_else(|| row_provider.clone());
        let row_account_key =
            tokenomics_value_string(limit, &["provider_account_key", "subscription_key"])
                .unwrap_or_default();
        if row_provider != provider || row_agent != agent_kind || row_account_key != old_key {
            continue;
        }
        if let Some(object) = limit.as_object_mut() {
            object.insert(
                "provider_account_key".to_string(),
                json!(provider_account.key.as_str()),
            );
            object.insert(
                "subscription_key".to_string(),
                json!(provider_account.key.as_str()),
            );
            object.insert(
                "provider_account_label".to_string(),
                json!(provider_account.label.as_str()),
            );
            let has_relay_device = tokenomics_value_string(
                &Value::Object(object.clone()),
                &["device_id", "machine_id"],
            )
            .is_some_and(|device_id| !tokenomics_cloud_relay_placeholder_device_id(&device_id));
            if !has_relay_device {
                if let Some(device_id) = inferred_device_id.as_deref() {
                    object.insert("device_id".to_string(), json!(device_id));
                }
            }
            changed = true;
        }
    }
    if changed {
        let value = serde_json::to_string(&limits)
            .map_err(|error| format!("Unable to encode cached cloud Tokenomics limits: {error}"))?;
        conn.execute(
            "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES(?1, ?2)",
            rusqlite::params![TOKENOMICS_CLOUD_PROVIDER_LIMITS_KEY, value],
        )
        .map_err(|error| format!("Unable to rewrite cached cloud Tokenomics limits: {error}"))?;
    }
    Ok(())
}

fn tokenomics_cloud_rollup_device_for_account(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    account_keys: &[&str],
) -> Result<Option<String>, String> {
    let local_device_ids = tokenomics_local_device_id_set(conn)?;
    let mut devices = Vec::new();
    for account_key in account_keys {
        let account_key = account_key.trim();
        if account_key.is_empty() {
            continue;
        }
        let mut statement = conn
            .prepare(
                "SELECT DISTINCT device_id
                 FROM tokenomics_cloud_rollups
                 WHERE provider=?1 AND agent_kind=?2
                   AND (provider_account_key=?3 OR subscription_key=?3)
                   AND device_id IS NOT NULL AND device_id!=''
                 ORDER BY device_id
                 LIMIT 2",
            )
            .map_err(|error| {
                format!("Unable to prepare cloud Tokenomics account device query: {error}")
            })?;
        let rows = statement
            .query_map(
                rusqlite::params![provider, agent_kind, account_key],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| {
                format!("Unable to query cloud Tokenomics account devices: {error}")
            })?;
        for row in rows {
            let device_id = row.map_err(|error| {
                format!("Unable to read cloud Tokenomics account device: {error}")
            })?;
            if tokenomics_is_remote_cloud_device_id(&device_id, &local_device_ids)
                && !devices.contains(&device_id)
            {
                devices.push(device_id);
            }
        }
    }
    Ok(if devices.len() == 1 {
        devices.into_iter().next()
    } else {
        None
    })
}

fn tokenomics_reconcile_codex_provider_account_from_usage(
    conn: &rusqlite::Connection,
    provider_account: &TokenomicsProviderAccount,
    usage: &Value,
) -> Result<TokenomicsProviderAccount, String> {
    let canonical_account =
        tokenomics_codex_canonical_provider_account_from_usage(conn, usage, provider_account);
    let alias_cache_key = if canonical_account.key != provider_account.key {
        Some(tokenomics_codex_usage_cache_key(provider_account))
    } else {
        None
    };
    if canonical_account.key != provider_account.key {
        tokenomics_migrate_provider_account_key(
            conn,
            "openai",
            "codex",
            provider_account.key.as_str(),
            &canonical_account,
        )?;
        tokenomics_store_codex_usage_cache_alias(
            conn,
            provider_account.key.as_str(),
            canonical_account.key.as_str(),
        )?;
    }
    tokenomics_reconcile_provider_account_label(conn, "openai", "codex", &canonical_account)?;
    let canonical_cache_key = tokenomics_codex_usage_cache_key(&canonical_account);
    tokenomics_store_codex_usage_cache(conn, &canonical_cache_key, usage)?;
    if let Some(alias_cache_key) = alias_cache_key {
        tokenomics_delete_codex_usage_cache(conn, &alias_cache_key)?;
    }
    Ok(canonical_account)
}

fn tokenomics_reconcile_codex_cached_usage_aliases(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let like_prefix = format!("{TOKENOMICS_CODEX_USAGE_CACHE_KEY_PREFIX}%");
    let mut statement = conn
        .prepare("SELECT key, value FROM tokenomics_meta WHERE key LIKE ?1")
        .map_err(|error| format!("Unable to inspect Codex usage caches: {error}"))?;
    let mapped = statement
        .query_map(rusqlite::params![like_prefix], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Unable to query Codex usage caches: {error}"))?;
    let mut rows = Vec::new();
    for row in mapped {
        rows.push(row.map_err(|error| format!("Unable to read Codex usage cache row: {error}"))?);
    }
    drop(statement);

    for (cache_key, cache_value) in rows {
        let Some(old_key) = cache_key.strip_prefix(TOKENOMICS_CODEX_USAGE_CACHE_KEY_PREFIX) else {
            continue;
        };
        if old_key.trim().is_empty() {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<Value>(&cache_value) else {
            continue;
        };
        let Some(usage) = parsed
            .get("usage")
            .filter(|value| value.is_object())
            .or_else(|| parsed.as_object().map(|_| &parsed))
        else {
            continue;
        };
        if tokenomics_codex_usage_account_id(usage).is_none() {
            continue;
        }
        let fallback_label =
            tokenomics_existing_provider_account_label_for_key(conn, "openai", "codex", old_key)
                .unwrap_or_else(|| tokenomics_provider_account_base_label("openai", "codex"));
        let fallback_account = TokenomicsProviderAccount {
            key: old_key.to_string(),
            label: fallback_label,
        };
        let canonical_account =
            tokenomics_reconcile_codex_provider_account_from_usage(conn, &fallback_account, usage)?;
        if canonical_account.key != old_key {
            let canonical_cache_key = tokenomics_codex_usage_cache_key(&canonical_account);
            tokenomics_store_codex_usage_cache(conn, &canonical_cache_key, usage)?;
            tokenomics_delete_codex_usage_cache(conn, &cache_key)?;
        }
    }
    Ok(())
}

fn tokenomics_migrate_provider_account_legacy_short_key(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    provider_account: &TokenomicsProviderAccount,
) -> Result<(), String> {
    if let Some(old_key) =
        tokenomics_legacy_short_provider_account_key(provider, agent_kind, &provider_account.key)
    {
        tokenomics_migrate_provider_account_key(
            conn,
            provider,
            agent_kind,
            &old_key,
            provider_account,
        )?;
    }
    Ok(())
}

fn tokenomics_reconcile_fingerprint_stat(
    conn: &rusqlite::Connection,
    table: &str,
    updated_column: Option<&str>,
) -> String {
    let sql = match updated_column {
        Some(column) => format!("SELECT COUNT(*), COALESCE(MAX({column}), 0) FROM {table}"),
        None => format!("SELECT COUNT(*), '' FROM {table}"),
    };
    conn.query_row(&sql, [], |row| {
        let count: i64 = row.get(0)?;
        let max_value: String =
            row.get::<_, rusqlite::types::Value>(1)
                .map(|value| match value {
                    rusqlite::types::Value::Null => String::new(),
                    rusqlite::types::Value::Integer(value) => value.to_string(),
                    rusqlite::types::Value::Real(value) => value.to_string(),
                    rusqlite::types::Value::Text(value) => value,
                    rusqlite::types::Value::Blob(value) => {
                        tokenomics_hash(&String::from_utf8_lossy(&value))
                    }
                })?;
        Ok(format!("{table}:{count}:{max_value}"))
    })
    .unwrap_or_else(|_| format!("{table}:unavailable"))
}

fn tokenomics_current_provider_accounts_reconcile_fingerprint(
    conn: &rusqlite::Connection,
) -> String {
    let codex_account = tokenomics_provider_account("openai", "codex");
    let claude_account = tokenomics_provider_account("anthropic", "claude");
    let codex_alias =
        tokenomics_read_codex_usage_cache_alias(conn, &codex_account.key).unwrap_or_default();
    let mut claude_legacy_keys = tokenomics_claude_legacy_account_keys();
    claude_legacy_keys.sort();
    claude_legacy_keys.dedup();
    let parts = vec![
        format!(
            "codex:{}:{}:{}",
            codex_account.key, codex_account.label, codex_alias
        ),
        format!(
            "claude:{}:{}:{}",
            claude_account.key,
            claude_account.label,
            claude_legacy_keys.join(",")
        ),
        tokenomics_reconcile_fingerprint_stat(conn, "tokenomics_rollups", Some("updated_at")),
        tokenomics_reconcile_fingerprint_stat(
            conn,
            "tokenomics_pruned_usage_rollups",
            Some("updated_at"),
        ),
        tokenomics_reconcile_fingerprint_stat(
            conn,
            "tokenomics_provider_accounts",
            Some("updated_at_unix"),
        ),
        tokenomics_reconcile_fingerprint_stat(
            conn,
            "tokenomics_provider_limit_samples",
            Some("updated_at_unix"),
        ),
        tokenomics_reconcile_fingerprint_stat(
            conn,
            "tokenomics_latest_windows",
            Some("updated_at_unix"),
        ),
    ];
    tokenomics_hash(&parts.join("\n"))
}

fn tokenomics_provider_account_reconcile_cache() -> &'static StdMutex<Option<String>> {
    TOKENOMICS_PROVIDER_ACCOUNT_RECONCILE_FINGERPRINT.get_or_init(|| StdMutex::new(None))
}

fn tokenomics_codex_account_from_alias(
    conn: &rusqlite::Connection,
    account: TokenomicsProviderAccount,
) -> TokenomicsProviderAccount {
    let Some(canonical_key) = tokenomics_read_codex_usage_cache_alias(conn, &account.key) else {
        return account;
    };
    if canonical_key == account.key {
        return account;
    }
    let label =
        tokenomics_existing_provider_account_label_for_key(conn, "openai", "codex", &canonical_key)
            .unwrap_or(account.label);
    TokenomicsProviderAccount {
        key: canonical_key,
        label,
    }
}

fn tokenomics_reconcile_current_codex_account_label(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    tokenomics_reconcile_codex_cached_usage_aliases(conn)?;
    let codex_account =
        tokenomics_codex_account_from_alias(conn, tokenomics_provider_account("openai", "codex"));
    tokenomics_migrate_provider_account_legacy_short_key(conn, "openai", "codex", &codex_account)?;
    tokenomics_reconcile_provider_account_label(conn, "openai", "codex", &codex_account)
}

fn tokenomics_reconcile_current_claude_account_identity(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let claude_auth = tokenomics_claude_auth_value();
    let claude_account =
        tokenomics_provider_account_from_auth("anthropic", "claude", claude_auth.as_ref());
    let has_user_identity = claude_auth
        .as_ref()
        .and_then(tokenomics_claude_oauth_account)
        .and_then(|account| {
            tokenomics_text_field(
                account,
                &[
                    "accountUuid",
                    "account_uuid",
                    "userID",
                    "userId",
                    "user_id",
                    "emailAddress",
                    "email",
                ],
            )
        })
        .is_some();
    if has_user_identity {
        for legacy_key in tokenomics_claude_legacy_account_keys() {
            tokenomics_migrate_provider_account_key(
                conn,
                "anthropic",
                "claude",
                &legacy_key,
                &claude_account,
            )?;
        }
    }
    tokenomics_migrate_provider_account_legacy_short_key(
        conn,
        "anthropic",
        "claude",
        &claude_account,
    )?;
    tokenomics_reconcile_provider_account_label(conn, "anthropic", "claude", &claude_account)
}

fn tokenomics_reconcile_current_provider_accounts(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let fingerprint = tokenomics_current_provider_accounts_reconcile_fingerprint(conn);
    if tokenomics_provider_account_reconcile_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.clone())
        .as_deref()
        == Some(fingerprint.as_str())
    {
        return Ok(());
    }
    tokenomics_reconcile_current_codex_account_label(conn)?;
    tokenomics_reconcile_current_claude_account_identity(conn)?;
    tokenomics_reconcile_duplicate_provider_account_identities(conn)?;
    let next_fingerprint = tokenomics_current_provider_accounts_reconcile_fingerprint(conn);
    if let Ok(mut cache) = tokenomics_provider_account_reconcile_cache().lock() {
        *cache = Some(next_fingerprint);
    }
    Ok(())
}

fn tokenomics_claude_legacy_account_keys() -> Vec<String> {
    let Some(home) = tokenomics_home_dir() else {
        return Vec::new();
    };
    let Some(credentials) =
        tokenomics_read_json_file(home.join(".claude").join(".credentials.json"))
    else {
        return Vec::new();
    };
    tokenomics_legacy_provider_account_key_from_auth("anthropic", "claude", &credentials)
        .into_iter()
        .collect()
}

fn tokenomics_legacy_provider_account_key_from_auth(
    provider: &str,
    agent_kind: &str,
    auth_value: &Value,
) -> Option<String> {
    let mut identifiers = Vec::new();
    tokenomics_collect_json_values_for_keys(
        auth_value,
        &[
            "account_id",
            "accountId",
            "user_id",
            "userId",
            "userid",
            "sub",
            "email",
            "login",
            "username",
            "organization_id",
            "organizationId",
        ],
        &mut identifiers,
    );
    if identifiers.is_empty() {
        tokenomics_collect_jwt_account_identifiers(auth_value, &mut identifiers);
    }
    if identifiers.is_empty() {
        tokenomics_collect_json_values_for_keys(
            auth_value,
            &[
                "refresh_token",
                "refreshToken",
                "access_token",
                "accessToken",
                "id_token",
                "idToken",
                "session_token",
                "sessionToken",
            ],
            &mut identifiers,
        );
    }
    identifiers.sort();
    identifiers.dedup();
    let fingerprint = if identifiers.is_empty() {
        serde_json::to_string(auth_value).unwrap_or_default()
    } else {
        identifiers.join("|")
    };
    if fingerprint.trim().is_empty() {
        return None;
    }
    let hash = tokenomics_hash(&format!("{provider}:{agent_kind}:{fingerprint}"));
    let suffix = hash.get(0..8).unwrap_or(hash.as_str());
    Some(format!("{provider}:{agent_kind}:{suffix}"))
}

fn tokenomics_unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn tokenomics_unix_iso_like(seconds: u64) -> String {
    format!("unix:{seconds}")
}

fn tokenomics_utc_datetime_from_unix(seconds: u64) -> (i64, i64, i64, i64, i64, i64) {
    let days = (seconds / 86_400) as i64;
    let seconds_of_day = (seconds % 86_400) as i64;
    let (year, month, day) = tokenomics_civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    (year, month, day, hour, minute, second)
}

fn tokenomics_utc_hour_bucket_from_unix(seconds: u64) -> (String, String) {
    let hour_start = seconds
        .checked_div(3_600)
        .unwrap_or(0)
        .saturating_mul(3_600);
    let (year, month, day, hour, _, _) = tokenomics_utc_datetime_from_unix(hour_start);
    (
        format!("{year:04}-{month:02}-{day:02}"),
        format!("{year:04}-{month:02}-{day:02}T{hour:02}:00:00Z"),
    )
}

fn tokenomics_utc_hour_bucket_start_unix(bucket_start: &str) -> Option<u64> {
    tokenomics_timestamp_unix(bucket_start).map(|seconds| {
        seconds
            .checked_div(3_600)
            .unwrap_or(0)
            .saturating_mul(3_600)
    })
}

fn tokenomics_strict_utc_hour_bucket_start_unix(bucket_start: &str) -> Option<u64> {
    let clean = bucket_start.trim();
    let seconds = tokenomics_utc_hour_bucket_start_unix(clean)?;
    let (_, canonical) = tokenomics_utc_hour_bucket_from_unix(seconds);
    if clean == canonical {
        Some(seconds)
    } else {
        None
    }
}

fn tokenomics_emit_updated(app: &AppHandle, payload: Value) {
    let _ = app.emit(TOKENOMICS_UPDATED_EVENT, payload);
}

fn tokenomics_normalize_unix_timestamp(value: i64) -> u64 {
    let value = value.max(0) as u64;
    if value > 10_000_000_000 {
        value / 1000
    } else {
        value
    }
}

fn tokenomics_timestamp_unix(timestamp: &str) -> Option<u64> {
    let clean = timestamp.trim();
    if let Some(value) = clean.strip_prefix("unix:") {
        return value
            .parse::<i64>()
            .ok()
            .map(tokenomics_normalize_unix_timestamp);
    }
    if clean.chars().all(|character| character.is_ascii_digit()) {
        return clean
            .parse::<i64>()
            .ok()
            .map(tokenomics_normalize_unix_timestamp);
    }
    tokenomics_iso_timestamp_unix(clean)
}

fn tokenomics_iso_timestamp_unix(timestamp: &str) -> Option<u64> {
    let clean = timestamp.trim();
    if clean.len() < 13 {
        return None;
    }
    let year = clean.get(0..4)?.parse::<i64>().ok()?;
    let month = clean.get(5..7)?.parse::<i64>().ok()?;
    let day = clean.get(8..10)?.parse::<i64>().ok()?;
    let hour = clean.get(11..13)?.parse::<i64>().ok()?;
    let (minute, second) = if clean.len() >= 19 {
        (
            clean.get(14..16)?.parse::<i64>().ok()?,
            clean.get(17..19)?.parse::<i64>().ok()?,
        )
    } else if clean.len() == 16 {
        (clean.get(14..16)?.parse::<i64>().ok()?, 0)
    } else if clean.len() == 13 {
        (0, 0)
    } else {
        return None;
    };
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=60).contains(&second)
    {
        return None;
    }
    let days = tokenomics_days_from_civil(year, month, day)?;
    let seconds = days
        .checked_mul(86_400)?
        .checked_add(hour.checked_mul(3_600)?)?
        .checked_add(minute.checked_mul(60)?)?
        .checked_add(second)?;
    if seconds < 0 {
        None
    } else {
        let offset_seconds = tokenomics_iso_timezone_offset_seconds(clean)?;
        let adjusted = seconds.checked_sub(offset_seconds)?;
        if adjusted < 0 {
            None
        } else {
            Some(adjusted as u64)
        }
    }
}

fn tokenomics_iso_timezone_offset_seconds(timestamp: &str) -> Option<i64> {
    let mut suffix = timestamp.get(19..).unwrap_or("").trim();
    if suffix.is_empty() {
        return Some(0);
    }
    if let Some(rest) = suffix.strip_prefix('.') {
        let digit_count = rest
            .as_bytes()
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count();
        suffix = rest.get(digit_count..).unwrap_or("").trim();
    }
    if suffix.is_empty() || suffix.starts_with('Z') || suffix.starts_with('z') {
        return Some(0);
    }
    let sign = if suffix.starts_with('+') {
        1_i64
    } else if suffix.starts_with('-') {
        -1_i64
    } else {
        return Some(0);
    };
    let offset = suffix.get(1..)?;
    let hour = offset.get(0..2)?.parse::<i64>().ok()?;
    let minute = if offset.as_bytes().get(2) == Some(&b':') {
        offset.get(3..5)?.parse::<i64>().ok()?
    } else {
        offset.get(2..4).unwrap_or("0").parse::<i64>().ok()?
    };
    if !(0..=23).contains(&hour) || !(0..=59).contains(&minute) {
        return None;
    }
    Some(sign * (hour * 3_600 + minute * 60))
}

fn tokenomics_days_from_civil(year: i64, month: i64, day: i64) -> Option<i64> {
    let year = year - if month <= 2 { 1 } else { 0 };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month_adjusted = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * month_adjusted + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

fn tokenomics_civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

fn tokenomics_prefix_upper_bound(prefix: &str) -> Option<String> {
    let (last_index, last_character) = prefix.char_indices().last()?;
    let mut next_codepoint = last_character as u32 + 1;
    while next_codepoint <= char::MAX as u32 {
        if let Some(next_character) = char::from_u32(next_codepoint) {
            let mut upper_bound = prefix[..last_index].to_string();
            upper_bound.push(next_character);
            return Some(upper_bound);
        }
        next_codepoint += 1;
    }
    None
}

fn tokenomics_run_write_batch<T>(
    conn: &rusqlite::Connection,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    tokenomics_with_db_write_lock(conn, || {
        tokenomics_retry_sqlite_write("Unable to begin Tokenomics write batch", || {
            conn.execute_batch("BEGIN")
        })?;
        match operation() {
            Ok(value) => {
                tokenomics_retry_sqlite_write("Unable to commit Tokenomics write batch", || {
                    conn.execute_batch("COMMIT")
                })?;
                Ok(value)
            }
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    })
}

fn tokenomics_finalization_settlement_day_from_sample_unix(
    latest_sample_unix: u64,
) -> Option<String> {
    if latest_sample_unix < TOKENOMICS_FINALIZATION_SETTLEMENT_SECS {
        return None;
    }
    let settled_unix = latest_sample_unix.saturating_sub(TOKENOMICS_FINALIZATION_SETTLEMENT_SECS);
    Some(tokenomics_utc_hour_bucket_from_unix(settled_unix).0)
}

fn tokenomics_finalization_settlement_day(
    conn: &rusqlite::Connection,
) -> Result<Option<String>, String> {
    let latest_sample_unix = conn
        .query_row(
            "SELECT COALESCE(MAX(sample_unix), 0)
             FROM (
               SELECT CAST(strftime('%s', bucket_hour) AS INTEGER) AS sample_unix
               FROM tokenomics_usage_events
               WHERE bucket_hour GLOB '????-??-??T??:00:00Z'
               UNION ALL
               SELECT last_event_timestamp AS sample_unix
               FROM tokenomics_source_imports
               WHERE last_event_timestamp > 0
             )",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Unable to read Tokenomics settlement watermark: {error}"))?
        .max(0) as u64;
    Ok(tokenomics_finalization_settlement_day_from_sample_unix(
        latest_sample_unix,
    ))
}

fn tokenomics_codex_credit_rates_per_million(model: Option<&str>) -> Option<(f64, f64, f64)> {
    let normalized = model.unwrap_or_default().trim().to_ascii_lowercase();
    if normalized.contains("gpt-5.5") {
        Some((125.0, 12.5, 750.0))
    } else if normalized.contains("gpt-5.4") {
        Some((62.5, 6.25, 375.0))
    } else {
        None
    }
}

fn tokenomics_codex_estimated_api_microusd(
    model: Option<&str>,
    input_tokens: i64,
    cache_read_tokens: i64,
    output_tokens: i64,
) -> i64 {
    let Some((input_rate, cache_rate, output_rate)) =
        tokenomics_codex_credit_rates_per_million(model)
    else {
        return 0;
    };
    let uncached_input = input_tokens.saturating_sub(cache_read_tokens).max(0) as f64;
    let cached_input = cache_read_tokens.max(0) as f64;
    let output = output_tokens.max(0) as f64;
    let credits = (uncached_input * input_rate + cached_input * cache_rate + output * output_rate)
        / 1_000_000.0;
    (credits * 0.04 * 1_000_000.0).round() as i64
}

#[derive(Clone, Copy)]
struct TokenomicsApiRatesPerMillion {
    input: f64,
    cache_read: f64,
    cache_write: f64,
    output: f64,
}

fn tokenomics_estimated_api_microusd(
    provider: &str,
    agent_kind: &str,
    model: Option<&str>,
    input_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    output_tokens: i64,
) -> i64 {
    let provider_key = provider.trim().to_ascii_lowercase();
    let agent_key = agent_kind.trim().to_ascii_lowercase();
    if provider_key.contains("anthropic")
        || provider_key.contains("claude")
        || agent_key.contains("claude")
    {
        return tokenomics_claude_estimated_api_microusd(
            model,
            input_tokens,
            cache_read_tokens,
            cache_write_tokens,
            output_tokens,
        );
    }
    if provider_key.contains("openai")
        || provider_key.contains("codex")
        || agent_key.contains("codex")
    {
        // Stored Codex rows keep uncached input (Claude convention); the
        // credit estimator expects the OpenAI-style inclusive input, so
        // reconstruct it before pricing.
        return tokenomics_codex_estimated_api_microusd(
            model,
            input_tokens.saturating_add(cache_read_tokens),
            cache_read_tokens,
            output_tokens,
        );
    }
    0
}

fn tokenomics_claude_estimated_api_microusd(
    model: Option<&str>,
    input_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    output_tokens: i64,
) -> i64 {
    let Some(rates) = tokenomics_claude_api_rates_per_million(model) else {
        return 0;
    };
    tokenomics_api_cost_microusd(
        rates,
        input_tokens,
        cache_read_tokens,
        cache_write_tokens,
        output_tokens,
    )
}

fn tokenomics_api_cost_microusd(
    rates: TokenomicsApiRatesPerMillion,
    input_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    output_tokens: i64,
) -> i64 {
    let input = input_tokens.max(0) as f64;
    let cache_read = cache_read_tokens.max(0) as f64;
    let cache_write = cache_write_tokens.max(0) as f64;
    let output = output_tokens.max(0) as f64;
    (input * rates.input
        + cache_read * rates.cache_read
        + cache_write * rates.cache_write
        + output * rates.output)
        .round() as i64
}

fn tokenomics_claude_api_rates_per_million(
    model: Option<&str>,
) -> Option<TokenomicsApiRatesPerMillion> {
    let normalized = tokenomics_normalized_model_key(model);
    if normalized.is_empty() {
        return None;
    }
    if normalized.contains("fable-5") || normalized.contains("mythos-5") {
        return Some(TokenomicsApiRatesPerMillion {
            input: 10.0,
            cache_read: 1.0,
            cache_write: 12.5,
            output: 50.0,
        });
    }
    if normalized.contains("opus-4-8")
        || normalized.contains("opus-4-7")
        || normalized.contains("opus-4-6")
        || normalized.contains("opus-4-5")
    {
        return Some(TokenomicsApiRatesPerMillion {
            input: 5.0,
            cache_read: 0.5,
            cache_write: 6.25,
            output: 25.0,
        });
    }
    if normalized.contains("opus-4-1")
        || normalized.contains("opus-4.1")
        || normalized.contains("opus-4")
    {
        return Some(TokenomicsApiRatesPerMillion {
            input: 15.0,
            cache_read: 1.5,
            cache_write: 18.75,
            output: 75.0,
        });
    }
    if normalized.contains("sonnet-4-6")
        || normalized.contains("sonnet-4-5")
        || normalized.contains("sonnet-4")
        || normalized.contains("sonnet-3-7")
        || normalized.contains("sonnet-3.7")
    {
        return Some(TokenomicsApiRatesPerMillion {
            input: 3.0,
            cache_read: 0.3,
            cache_write: 3.75,
            output: 15.0,
        });
    }
    if normalized.contains("haiku-4-5") {
        return Some(TokenomicsApiRatesPerMillion {
            input: 1.0,
            cache_read: 0.1,
            cache_write: 1.25,
            output: 5.0,
        });
    }
    if normalized.contains("haiku-3-5") || normalized.contains("haiku-3.5") {
        return Some(TokenomicsApiRatesPerMillion {
            input: 0.8,
            cache_read: 0.08,
            cache_write: 1.0,
            output: 4.0,
        });
    }
    None
}

fn tokenomics_normalized_model_key(model: Option<&str>) -> String {
    model
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|character| match character {
            '_' | '/' | ' ' | ':' => '-',
            other => other,
        })
        .collect()
}

#[derive(Clone)]
struct TokenomicsUsageEvent {
    id: String,
    device_id: String,
    provider: String,
    agent_kind: String,
    model: Option<String>,
    subscription_key: Option<String>,
    provider_account_key: Option<String>,
    provider_account_label: Option<String>,
    source_request_id: Option<String>,
    billing_scope_type: String,
    billing_team_id: Option<String>,
    billing_scope_source: String,
    workspace_id: Option<String>,
    repo_path: Option<String>,
    source_kind: String,
    source_path: Option<String>,
    bucket_day: String,
    bucket_hour: String,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    total_tokens: i64,
    estimated_cost_microusd: i64,
    created_at: Option<String>,
    observed_at: String,
}

fn tokenomics_buckets(timestamp: &str) -> (String, String) {
    let seconds = tokenomics_timestamp_unix(timestamp).unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0)
    });
    tokenomics_utc_hour_bucket_from_unix(seconds)
}

fn tokenomics_now_iso_like() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    tokenomics_unix_iso_like(seconds)
}

fn tokenomics_hash(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn tokenomics_legacy_short_provider_account_key(
    provider: &str,
    agent_kind: &str,
    provider_account_key: &str,
) -> Option<String> {
    let prefix = format!("{provider}:{agent_kind}:");
    let suffix = provider_account_key.strip_prefix(&prefix)?;
    if suffix.len() <= 8 || suffix == "unknown" {
        return None;
    }
    Some(format!("{prefix}{}", suffix.get(0..8).unwrap_or(suffix)))
}

fn tokenomics_event_identity_account_key(
    provider: &str,
    agent_kind: &str,
    provider_account_key: Option<&str>,
) -> String {
    let Some(provider_account_key) = provider_account_key else {
        return String::new();
    };
    tokenomics_legacy_short_provider_account_key(provider, agent_kind, provider_account_key)
        .unwrap_or_else(|| provider_account_key.to_string())
}

fn tokenomics_frozen_source_identity(source_path: &str) -> &str {
    source_path
        .find(".jsonl:")
        .map(|index| &source_path[..index + ".jsonl".len()])
        .unwrap_or(source_path)
}

fn tokenomics_insert_event(
    conn: &rusqlite::Connection,
    event: &TokenomicsUsageEvent,
) -> Result<bool, String> {
    if !conn.is_autocommit() {
        return tokenomics_insert_event_in_transaction(conn, event)
            .map_err(|error| format!("Unable to record Tokenomics usage event: {error}"));
    }

    tokenomics_with_db_write_lock(conn, || {
        let started_at = Instant::now();
        let mut sleep_ms = 25u64;
        loop {
            if let Err(error) = conn.execute_batch("BEGIN IMMEDIATE") {
                if tokenomics_sqlite_error_is_locked(&error)
                    && started_at.elapsed()
                        < Duration::from_millis(TOKENOMICS_SQLITE_BUSY_TIMEOUT_MS * 4)
                {
                    thread::sleep(Duration::from_millis(sleep_ms));
                    sleep_ms = (sleep_ms.saturating_mul(2)).min(500);
                    continue;
                }
                return Err(format!(
                    "Unable to begin Tokenomics event transaction: {error}"
                ));
            }

            let operation = tokenomics_insert_event_in_transaction(conn, event);
            let result = match operation {
                Ok(inserted) => conn.execute_batch("COMMIT").map(|_| inserted),
                Err(error) => Err(error),
            };
            match result {
                Ok(inserted) => return Ok(inserted),
                Err(error) => {
                    let _ = conn.execute_batch("ROLLBACK");
                    if tokenomics_sqlite_error_is_locked(&error)
                        && started_at.elapsed()
                            < Duration::from_millis(TOKENOMICS_SQLITE_BUSY_TIMEOUT_MS * 4)
                    {
                        thread::sleep(Duration::from_millis(sleep_ms));
                        sleep_ms = (sleep_ms.saturating_mul(2)).min(500);
                        continue;
                    }
                    return Err(format!("Unable to record Tokenomics usage event: {error}"));
                }
            }
        }
    })
}

fn tokenomics_insert_event_in_transaction(
    conn: &rusqlite::Connection,
    event: &TokenomicsUsageEvent,
) -> rusqlite::Result<bool> {
    let frozen_source_path = event
        .source_path
        .as_deref()
        .map(tokenomics_frozen_source_identity);
    let pruned: i64 = conn.query_row(
        "SELECT EXISTS(
               SELECT 1 FROM tokenomics_usage_event_tombstones WHERE id=?1
             ) OR EXISTS(
               SELECT 1
               FROM tokenomics_frozen_source_hours
               WHERE provider=?2 AND agent_kind=?3
                 AND source_path=?4 AND bucket_hour=?5
             )",
        rusqlite::params![
            event.id.as_str(),
            event.provider.as_str(),
            event.agent_kind.as_str(),
            frozen_source_path,
            event.bucket_hour.as_str(),
        ],
        |row| row.get(0),
    )?;
    if pruned > 0 {
        return Ok(false);
    }
    let changed = conn
        .execute(
	            "INSERT OR IGNORE INTO tokenomics_usage_events(
	               id, device_id, provider, agent_kind, model, subscription_key,
	               provider_account_key, provider_account_label,
	               billing_scope_type, billing_team_id, billing_scope_source,
	               workspace_id, repo_path,
	               source_kind, source_path, bucket_day, bucket_hour,
	               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
	               total_tokens, estimated_cost_microusd, created_at, observed_at
	             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)",
	            rusqlite::params![
	                event.id.as_str(),
	                event.device_id.as_str(),
                event.provider.as_str(),
                event.agent_kind.as_str(),
                event.model.as_deref(),
	                event.subscription_key.as_deref(),
	                event.provider_account_key.as_deref(),
	                event.provider_account_label.as_deref(),
	                event.billing_scope_type.as_str(),
	                event.billing_team_id.as_deref(),
	                event.billing_scope_source.as_str(),
	                event.workspace_id.as_deref(),
	                event.repo_path.as_deref(),
                event.source_kind.as_str(),
                event.source_path.as_deref(),
                event.bucket_day.as_str(),
                event.bucket_hour.as_str(),
                event.input_tokens,
                event.output_tokens,
                event.cache_read_tokens,
                event.cache_write_tokens,
                event.total_tokens,
                event.estimated_cost_microusd,
                event.created_at.as_deref(),
                event.observed_at.as_str(),
            ],
        )
        ?;
    if changed == 0 {
        return Ok(false);
    }
    tokenomics_increment_rollup(conn, event, "hour", &event.bucket_hour)?;
    Ok(true)
}

fn tokenomics_increment_rollup(
    conn: &rusqlite::Connection,
    event: &TokenomicsUsageEvent,
    bucket_width: &str,
    bucket_start: &str,
) -> rusqlite::Result<()> {
    let rollup_id = tokenomics_hash(&format!(
        "{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}",
        event.device_id,
        event.provider,
        event.agent_kind,
        event.model.as_deref().unwrap_or_default(),
        event.subscription_key.as_deref().unwrap_or_default(),
        event.provider_account_key.as_deref().unwrap_or_default(),
        event.billing_scope_type.as_str(),
        event.billing_team_id.as_deref().unwrap_or_default(),
        event.workspace_id.as_deref().unwrap_or_default(),
        bucket_width,
        bucket_start,
    ));
    let now = tokenomics_now_iso_like();
    conn.execute(
	        "INSERT INTO tokenomics_rollups(
	           id, device_id, provider, agent_kind, model, subscription_key,
	           provider_account_key, provider_account_label,
	           billing_scope_type, billing_team_id, billing_scope_source,
	           workspace_id, repo_path,
	           bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
	           cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
	         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, 1, ?22)
	         ON CONFLICT(id)
	         DO UPDATE SET
           input_tokens=tokenomics_rollups.input_tokens+excluded.input_tokens,
           output_tokens=tokenomics_rollups.output_tokens+excluded.output_tokens,
           cache_read_tokens=tokenomics_rollups.cache_read_tokens+excluded.cache_read_tokens,
           cache_write_tokens=tokenomics_rollups.cache_write_tokens+excluded.cache_write_tokens,
	           total_tokens=tokenomics_rollups.total_tokens+excluded.total_tokens,
	           estimated_cost_microusd=tokenomics_rollups.estimated_cost_microusd+excluded.estimated_cost_microusd,
	           event_count=tokenomics_rollups.event_count+1,
	           provider_account_label=COALESCE(excluded.provider_account_label, tokenomics_rollups.provider_account_label),
	           billing_scope_source=COALESCE(excluded.billing_scope_source, tokenomics_rollups.billing_scope_source),
	           updated_at=excluded.updated_at",
        rusqlite::params![
            rollup_id,
            event.device_id.as_str(),
            event.provider.as_str(),
            event.agent_kind.as_str(),
            event.model.as_deref(),
	            event.subscription_key.as_deref(),
	            event.provider_account_key.as_deref(),
	            event.provider_account_label.as_deref(),
	            event.billing_scope_type.as_str(),
	            event.billing_team_id.as_deref(),
	            event.billing_scope_source.as_str(),
	            event.workspace_id.as_deref(),
	            event.repo_path.as_deref(),
            bucket_width,
            bucket_start,
            event.input_tokens,
            event.output_tokens,
            event.cache_read_tokens,
            event.cache_write_tokens,
            event.total_tokens,
            event.estimated_cost_microusd,
            now.as_str(),
        ],
    )?;
    Ok(())
}

fn tokenomics_rebuild_provider_rollups_from_events(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
) -> Result<(), String> {
    let _heavy_permit = if tokenomics_db_write_lock_held_by_thread() {
        None
    } else {
        Some(backend_heavy_job_acquire("tokenomics.rollups.full_rebuild"))
    };
    let _span = BackendCpuSpan::new("tokenomics.rollups.full_rebuild");
    conn.execute(
        "DELETE FROM tokenomics_rollups WHERE provider=?1 AND agent_kind=?2",
        rusqlite::params![provider, agent_kind],
    )
    .map_err(|error| format!("Unable to clear Tokenomics provider rollups: {error}"))?;
    tokenomics_rebuild_provider_rollups_for_width(
        conn,
        provider,
        agent_kind,
        "hour",
        "bucket_hour",
    )?;
    Ok(())
}

fn tokenomics_rollup_id(
    device_id: &str,
    provider: &str,
    agent_kind: &str,
    model: Option<&str>,
    subscription_key: Option<&str>,
    provider_account_key: Option<&str>,
    billing_scope_type: &str,
    billing_team_id: Option<&str>,
    workspace_id: Option<&str>,
    bucket_width: &str,
    bucket_start: &str,
) -> String {
    tokenomics_hash(&format!(
        "{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}",
        device_id,
        provider,
        agent_kind,
        model.unwrap_or_default(),
        subscription_key.unwrap_or_default(),
        provider_account_key.unwrap_or_default(),
        billing_scope_type,
        billing_team_id.unwrap_or_default(),
        workspace_id.unwrap_or_default(),
        bucket_width,
        bucket_start,
    ))
}

fn tokenomics_rebuild_provider_rollups_for_scoped_hours(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    keys: Vec<TokenomicsScopedRollupKey>,
) -> Result<usize, String> {
    let mut keys = keys
        .into_iter()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if keys.is_empty() {
        return Ok(0);
    }
    keys.sort_by(|left, right| {
        left.bucket_start
            .cmp(&right.bucket_start)
            .then_with(|| left.device_id.cmp(&right.device_id))
            .then_with(|| left.provider_account_key.cmp(&right.provider_account_key))
            .then_with(|| left.subscription_key.cmp(&right.subscription_key))
    });
    let _heavy_permit = if tokenomics_db_write_lock_held_by_thread() {
        None
    } else {
        Some(backend_heavy_job_acquire(
            "tokenomics.rollups.scoped_rebuild",
        ))
    };
    let _span = BackendCpuSpan::new("tokenomics.rollups.scoped_rebuild");
    let now = tokenomics_now_iso_like();
    let mut rebuilt_count = 0usize;
    for key in keys {
        let model_key = key.model.as_deref().unwrap_or_default();
        let subscription_key = key.subscription_key.as_deref().unwrap_or_default();
        let provider_account_key = key.provider_account_key.as_deref().unwrap_or_default();
        let billing_team_id = key.billing_team_id.as_deref().unwrap_or_default();
        let workspace_id = key.workspace_id.as_deref().unwrap_or_default();
        conn.execute(
            "DELETE FROM tokenomics_rollups
             WHERE provider=?1 AND agent_kind=?2 AND bucket_width='hour'
               AND device_id=?3
               AND COALESCE(model, '')=?4
               AND COALESCE(subscription_key, '')=?5
               AND COALESCE(provider_account_key, '')=?6
               AND COALESCE(NULLIF(billing_scope_type, ''), 'unknown')=?7
               AND COALESCE(billing_team_id, '')=?8
               AND COALESCE(workspace_id, '')=?9
               AND bucket_start=?10",
            rusqlite::params![
                provider,
                agent_kind,
                key.device_id.as_str(),
                model_key,
                subscription_key,
                provider_account_key,
                key.billing_scope_type.as_str(),
                billing_team_id,
                workspace_id,
                key.bucket_start.as_str(),
            ],
        )
        .map_err(|error| format!("Unable to clear scoped Tokenomics rollup: {error}"))?;

        let mut statement = conn
            .prepare(
                "SELECT
                   device_id, provider, agent_kind,
                   NULLIF(model, '') AS model,
                   NULLIF(subscription_key, '') AS subscription_key,
                   NULLIF(provider_account_key, '') AS provider_account_key,
                   MAX(provider_account_label) AS provider_account_label,
                   COALESCE(NULLIF(billing_scope_type, ''), 'unknown') AS billing_scope_type,
                   NULLIF(billing_team_id, '') AS billing_team_id,
                   MAX(COALESCE(NULLIF(billing_scope_source, ''), 'unknown')) AS billing_scope_source,
                   NULLIF(workspace_id, '') AS workspace_id,
                   MAX(repo_path) AS repo_path,
                   bucket_start,
                   COALESCE(SUM(input_tokens), 0) AS input_tokens,
                   COALESCE(SUM(output_tokens), 0) AS output_tokens,
                   COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                   COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
                   COALESCE(SUM(total_tokens), 0) AS total_tokens,
                   COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd,
                   COALESCE(SUM(event_count), 0) AS event_count
                 FROM (
                   SELECT
                     device_id, provider, agent_kind, model, subscription_key,
                     provider_account_key, provider_account_label,
                     billing_scope_type, billing_team_id, billing_scope_source,
                     workspace_id, repo_path, bucket_hour AS bucket_start,
                     input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                     total_tokens, estimated_cost_microusd, 1 AS event_count
                   FROM tokenomics_usage_events
                   WHERE provider=?1 AND agent_kind=?2
                     AND device_id=?3
                     AND COALESCE(model, '')=?4
                     AND COALESCE(subscription_key, '')=?5
                     AND COALESCE(provider_account_key, '')=?6
                     AND COALESCE(NULLIF(billing_scope_type, ''), 'unknown')=?7
                     AND COALESCE(billing_team_id, '')=?8
                     AND COALESCE(workspace_id, '')=?9
                     AND bucket_hour=?10
                   UNION ALL
                   SELECT
                     device_id, provider, agent_kind, model, subscription_key,
                     provider_account_key, provider_account_label,
                     billing_scope_type, billing_team_id, billing_scope_source,
                     workspace_id, repo_path, bucket_start,
                     input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                     total_tokens, estimated_cost_microusd, event_count
                   FROM tokenomics_pruned_usage_rollups
                   WHERE provider=?1 AND agent_kind=?2 AND bucket_width='hour'
                     AND device_id=?3
                     AND COALESCE(model, '')=?4
                     AND COALESCE(subscription_key, '')=?5
                     AND COALESCE(provider_account_key, '')=?6
                     AND COALESCE(NULLIF(billing_scope_type, ''), 'unknown')=?7
                     AND COALESCE(billing_team_id, '')=?8
                     AND COALESCE(workspace_id, '')=?9
                     AND bucket_start=?10
                 )
                 GROUP BY device_id, provider, agent_kind,
                          NULLIF(model, ''), NULLIF(subscription_key, ''),
                          NULLIF(provider_account_key, ''),
                          COALESCE(NULLIF(billing_scope_type, ''), 'unknown'),
                          NULLIF(billing_team_id, ''), NULLIF(workspace_id, ''),
                          bucket_start",
            )
            .map_err(|error| format!("Unable to prepare scoped Tokenomics rollup rebuild: {error}"))?;
        let rows = statement
            .query_map(
                rusqlite::params![
                    provider,
                    agent_kind,
                    key.device_id.as_str(),
                    model_key,
                    subscription_key,
                    provider_account_key,
                    key.billing_scope_type.as_str(),
                    billing_team_id,
                    workspace_id,
                    key.bucket_start.as_str(),
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, Option<String>>(8)?,
                        row.get::<_, String>(9)?,
                        row.get::<_, Option<String>>(10)?,
                        row.get::<_, Option<String>>(11)?,
                        row.get::<_, String>(12)?,
                        row.get::<_, i64>(13)?,
                        row.get::<_, i64>(14)?,
                        row.get::<_, i64>(15)?,
                        row.get::<_, i64>(16)?,
                        row.get::<_, i64>(17)?,
                        row.get::<_, i64>(18)?,
                        row.get::<_, i64>(19)?,
                    ))
                },
            )
            .map_err(|error| {
                format!("Unable to query scoped Tokenomics rollup rebuild: {error}")
            })?;
        let mut rebuilt = Vec::new();
        for row in rows {
            rebuilt.push(row.map_err(|error| {
                format!("Unable to read scoped Tokenomics rollup rebuild: {error}")
            })?);
        }
        drop(statement);
        for (
            device_id,
            row_provider,
            row_agent_kind,
            model,
            subscription_key,
            provider_account_key,
            provider_account_label,
            billing_scope_type,
            billing_team_id,
            billing_scope_source,
            workspace_id,
            repo_path,
            bucket_start,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_write_tokens,
            total_tokens,
            estimated_cost_microusd,
            event_count,
        ) in rebuilt
        {
            let rollup_id = tokenomics_rollup_id(
                &device_id,
                &row_provider,
                &row_agent_kind,
                model.as_deref(),
                subscription_key.as_deref(),
                provider_account_key.as_deref(),
                billing_scope_type.as_str(),
                billing_team_id.as_deref(),
                workspace_id.as_deref(),
                "hour",
                &bucket_start,
            );
            conn.execute(
                "INSERT INTO tokenomics_rollups(
                   id, device_id, provider, agent_kind, model, subscription_key,
                   provider_account_key, provider_account_label,
                   billing_scope_type, billing_team_id, billing_scope_source,
                   workspace_id, repo_path,
                   bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
                   cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'hour', ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
                rusqlite::params![
                    rollup_id,
                    device_id,
                    row_provider,
                    row_agent_kind,
                    model,
                    subscription_key,
                    provider_account_key,
                    provider_account_label,
                    billing_scope_type,
                    billing_team_id,
                    billing_scope_source,
                    workspace_id,
                    repo_path,
                    bucket_start,
                    input_tokens,
                    output_tokens,
                    cache_read_tokens,
                    cache_write_tokens,
                    total_tokens,
                    estimated_cost_microusd,
                    event_count,
                    now.as_str(),
                ],
            )
            .map_err(|error| format!("Unable to insert scoped Tokenomics rollup: {error}"))?;
            rebuilt_count = rebuilt_count.saturating_add(1);
        }
    }
    Ok(rebuilt_count)
}

fn tokenomics_normalize_usage_event_buckets(conn: &rusqlite::Connection) -> Result<(), String> {
    let mut statement = conn
        .prepare(
            "SELECT id, bucket_day, bucket_hour, created_at
             FROM tokenomics_usage_events
             WHERE bucket_hour NOT GLOB '????-??-??T??:00:00Z'
                OR bucket_day NOT GLOB '????-??-??'",
        )
        .map_err(|error| format!("Unable to prepare Tokenomics bucket normalization: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|error| format!("Unable to query Tokenomics bucket normalization: {error}"))?;
    let mut updates = Vec::new();
    for row in rows {
        let (id, bucket_day, bucket_hour, created_at) =
            row.map_err(|error| format!("Unable to read Tokenomics bucket row: {error}"))?;
        let source = if tokenomics_utc_hour_bucket_start_unix(&bucket_hour).is_some() {
            bucket_hour.as_str()
        } else {
            created_at.as_deref().unwrap_or(bucket_hour.as_str())
        };
        let Some(seconds) = tokenomics_utc_hour_bucket_start_unix(source) else {
            continue;
        };
        let (canonical_day, canonical_hour) = tokenomics_utc_hour_bucket_from_unix(seconds);
        if canonical_day != bucket_day || canonical_hour != bucket_hour {
            updates.push((id, canonical_day, canonical_hour));
        }
    }
    drop(statement);

    for (id, bucket_day, bucket_hour) in updates {
        conn.execute(
            "UPDATE tokenomics_usage_events
             SET bucket_day=?1, bucket_hour=?2
             WHERE id=?3",
            rusqlite::params![bucket_day, bucket_hour, id],
        )
        .map_err(|error| format!("Unable to normalize Tokenomics event bucket: {error}"))?;
    }
    Ok(())
}

fn tokenomics_rebuild_all_rollups_from_events(conn: &rusqlite::Connection) -> Result<(), String> {
    tokenomics_normalize_usage_event_buckets(conn)?;
    conn.execute("DELETE FROM tokenomics_rollups", [])
        .map_err(|error| format!("Unable to clear Tokenomics rollups: {error}"))?;
    let mut statement = conn
        .prepare(
            "SELECT DISTINCT provider, agent_kind
             FROM (
               SELECT provider, agent_kind FROM tokenomics_usage_events
               UNION
               SELECT provider, agent_kind FROM tokenomics_pruned_usage_rollups
             )
             ORDER BY provider, agent_kind",
        )
        .map_err(|error| format!("Unable to prepare Tokenomics provider rebuild list: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Unable to query Tokenomics provider rebuild list: {error}"))?;
    let mut providers = Vec::new();
    for row in rows {
        providers.push(row.map_err(|error| {
            format!("Unable to read Tokenomics provider rebuild list: {error}")
        })?);
    }
    for (provider, agent_kind) in providers {
        tokenomics_rebuild_provider_rollups_for_width(
            conn,
            &provider,
            &agent_kind,
            "hour",
            "bucket_hour",
        )?;
    }
    Ok(())
}

fn tokenomics_rebuild_rollups_for_identity_version(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let current = conn
        .query_row(
            "SELECT value FROM tokenomics_meta WHERE key='rollup_identity_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    if current.as_deref() == Some(TOKENOMICS_ROLLUP_ID_VERSION) {
        return Ok(());
    }
    tokenomics_rebuild_all_rollups_from_events(conn)?;
    conn.execute(
        "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES('rollup_identity_version', ?1)",
        rusqlite::params![TOKENOMICS_ROLLUP_ID_VERSION],
    )
    .map_err(|error| format!("Unable to record Tokenomics rollup version: {error}"))?;
    Ok(())
}

fn tokenomics_repair_codex_orphaned_import_rows(conn: &rusqlite::Connection) -> Result<(), String> {
    let current = conn
        .query_row(
            "SELECT value FROM tokenomics_meta WHERE key='codex_import_ledger_repair_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    if current.as_deref() == Some(TOKENOMICS_CODEX_IMPORT_LEDGER_REPAIR_VERSION) {
        return Ok(());
    }

    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS tokenomics_prune_candidate_rowids(rowid INTEGER PRIMARY KEY)",
        [],
    )
    .map_err(|error| format!("Unable to prepare Codex Tokenomics import repair: {error}"))?;
    conn.execute("DELETE FROM tokenomics_prune_candidate_rowids", [])
        .map_err(|error| format!("Unable to reset Codex Tokenomics import repair: {error}"))?;
    let finalized_day = tokenomics_finalization_settlement_day(conn)?;
    conn.execute(
        "INSERT OR IGNORE INTO tokenomics_prune_candidate_rowids(rowid)
             SELECT rowid FROM tokenomics_usage_events
             WHERE provider='openai'
               AND agent_kind='codex'
               AND source_kind='codex_token_count_jsonl'
               AND TRIM(COALESCE(source_path, ''))!=''
               AND ?1 IS NOT NULL
               AND bucket_day < ?1
               AND NOT EXISTS (
                 SELECT 1
                 FROM tokenomics_source_imports imported
                 WHERE imported.provider=tokenomics_usage_events.provider
                   AND imported.agent_kind=tokenomics_usage_events.agent_kind
                   AND imported.source_kind='codex_token_count_jsonl'
                   AND imported.import_status IN (
                     'complete',
                     'indexed_empty',
                     'raw_deleted_imported'
                   )
                   AND imported.source_path=CASE
                     WHEN instr(tokenomics_usage_events.source_path, '.jsonl:') > 0
                     THEN substr(
                       tokenomics_usage_events.source_path,
                       1,
                       instr(tokenomics_usage_events.source_path, '.jsonl:') + 5
                     )
                     ELSE tokenomics_usage_events.source_path
                   END
               )",
        rusqlite::params![finalized_day.as_deref()],
    )
    .map_err(|error| format!("Unable to select orphaned Codex Tokenomics rows: {error}"))?;
    let now = tokenomics_now_iso_like();
    tokenomics_with_db_write_lock(conn, || {
        conn.execute_batch("SAVEPOINT codex_import_ledger_repair")
            .map_err(|error| format!("Unable to begin Codex Tokenomics import repair: {error}"))?;
        let result = (|| {
            tokenomics_rebuild_provider_rollups_from_events(conn, "openai", "codex")?;
            tokenomics_fold_prune_candidates_into_tombstones(conn, now.as_str())?;
            tokenomics_rebuild_provider_rollups_from_events(conn, "openai", "codex")?;
            conn.execute(
                "INSERT OR REPLACE INTO tokenomics_meta(key, value)
                 VALUES('codex_import_ledger_repair_version', ?1)",
                rusqlite::params![TOKENOMICS_CODEX_IMPORT_LEDGER_REPAIR_VERSION],
            )
            .map_err(|error| format!("Unable to record Codex Tokenomics import repair: {error}"))?;
            conn.execute("DELETE FROM tokenomics_prune_candidate_rowids", [])
                .map_err(|error| {
                    format!("Unable to clear Codex Tokenomics import repair: {error}")
                })?;
            Ok(())
        })();
        match result {
            Ok(()) => conn
                .execute_batch("RELEASE SAVEPOINT codex_import_ledger_repair")
                .map_err(|error| {
                    format!("Unable to commit Codex Tokenomics import repair: {error}")
                }),
            Err(error) => {
                let _ = conn.execute_batch(
                    "ROLLBACK TO SAVEPOINT codex_import_ledger_repair;
                     RELEASE SAVEPOINT codex_import_ledger_repair",
                );
                Err(error)
            }
        }
    })
}

fn tokenomics_normalize_codex_cached_input(conn: &rusqlite::Connection) -> Result<(), String> {
    let current = conn
        .query_row(
            "SELECT value FROM tokenomics_meta WHERE key='codex_uncached_input_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    if current.as_deref() == Some(TOKENOMICS_CODEX_UNCACHED_INPUT_VERSION) {
        return Ok(());
    }

    // Codex rows historically stored input_tokens INCLUDING cached input
    // (OpenAI usage convention), while Claude rows store uncached input only,
    // so cross-provider "Input" sums double-displayed every cache read.
    // Rewrite stored rows to the uncached convention. total_tokens already
    // equals uncached + cache_read + output for these rows, and costs were
    // computed from the uncached split at ingest, so neither changes.
    //
    // The subtraction is not data-idempotent, so the rewrite, rollup rebuild,
    // and meta marker must land atomically: a crash between them would
    // double-subtract on the next startup.
    conn.execute_batch("SAVEPOINT codex_uncached_input")
        .map_err(|error| {
            format!("Unable to begin Codex Tokenomics input normalization: {error}")
        })?;
    let result = (|| {
        let mut changed = 0usize;
        for table in ["tokenomics_usage_events", "tokenomics_pruned_usage_rollups"] {
            changed += conn
                .execute(
                    &format!(
                        "UPDATE {table}
                         SET input_tokens=input_tokens - MIN(cache_read_tokens, input_tokens)
                         WHERE provider='openai' AND agent_kind='codex'
                           AND cache_read_tokens>0 AND input_tokens>0"
                    ),
                    [],
                )
                .map_err(|error| format!("Unable to normalize Codex Tokenomics input: {error}"))?;
        }
        if changed > 0 {
            tokenomics_rebuild_provider_rollups_from_events(conn, "openai", "codex")?;
        }
        conn.execute(
            "INSERT OR REPLACE INTO tokenomics_meta(key, value)
             VALUES('codex_uncached_input_version', ?1)",
            rusqlite::params![TOKENOMICS_CODEX_UNCACHED_INPUT_VERSION],
        )
        .map_err(|error| {
            format!("Unable to record Codex Tokenomics input normalization: {error}")
        })?;
        Ok(())
    })();
    match result {
        Ok(()) => conn
            .execute_batch("RELEASE SAVEPOINT codex_uncached_input")
            .map_err(|error| {
                format!("Unable to commit Codex Tokenomics input normalization: {error}")
            }),
        Err(error) => {
            let _ = conn.execute_batch(
                "ROLLBACK TO SAVEPOINT codex_uncached_input;
                 RELEASE SAVEPOINT codex_uncached_input",
            );
            Err(error)
        }
    }
}

fn tokenomics_repair_provider_api_costs(conn: &rusqlite::Connection) -> Result<(), String> {
    let current = conn
        .query_row(
            "SELECT value FROM tokenomics_meta WHERE key='provider_api_pricing_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    if current.as_deref() == Some(TOKENOMICS_PROVIDER_API_PRICING_VERSION) {
        return Ok(());
    }

    let mut statement = conn
        .prepare(
            "SELECT id, provider, agent_kind, model, input_tokens, output_tokens,
                    cache_read_tokens, cache_write_tokens
             FROM tokenomics_usage_events
             WHERE estimated_cost_microusd=0",
        )
        .map_err(|error| format!("Unable to prepare Tokenomics cost repair: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
            ))
        })
        .map_err(|error| format!("Unable to query Tokenomics cost repair rows: {error}"))?;
    let mut updates = Vec::new();
    for row in rows {
        let (
            id,
            provider,
            agent_kind,
            model,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_write_tokens,
        ) = row.map_err(|error| format!("Unable to read Tokenomics cost repair row: {error}"))?;
        let estimated_cost_microusd = tokenomics_estimated_api_microusd(
            &provider,
            &agent_kind,
            model.as_deref(),
            input_tokens,
            cache_read_tokens,
            cache_write_tokens,
            output_tokens,
        );
        if estimated_cost_microusd > 0 {
            updates.push((id, provider, agent_kind, estimated_cost_microusd));
        }
    }
    drop(statement);

    let mut changed_pairs = Vec::<(String, String)>::new();
    for (id, provider, agent_kind, estimated_cost_microusd) in updates {
        let changed = conn
            .execute(
                "UPDATE tokenomics_usage_events
                 SET estimated_cost_microusd=?1
                 WHERE id=?2 AND estimated_cost_microusd=0",
                rusqlite::params![estimated_cost_microusd, id],
            )
            .map_err(|error| format!("Unable to repair Tokenomics event cost: {error}"))?;
        if changed > 0
            && !changed_pairs.iter().any(|(row_provider, row_agent)| {
                row_provider == &provider && row_agent == &agent_kind
            })
        {
            changed_pairs.push((provider, agent_kind));
        }
    }
    let mut statement = conn
        .prepare(
            "SELECT id, provider, agent_kind, model, input_tokens, output_tokens,
                    cache_read_tokens, cache_write_tokens
             FROM tokenomics_pruned_usage_rollups
             WHERE estimated_cost_microusd=0",
        )
        .map_err(|error| format!("Unable to prepare pruned Tokenomics cost repair: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
            ))
        })
        .map_err(|error| format!("Unable to query pruned Tokenomics cost repair rows: {error}"))?;
    let mut pruned_updates = Vec::new();
    for row in rows {
        let (
            id,
            provider,
            agent_kind,
            model,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_write_tokens,
        ) = row.map_err(|error| {
            format!("Unable to read pruned Tokenomics cost repair row: {error}")
        })?;
        let estimated_cost_microusd = tokenomics_estimated_api_microusd(
            &provider,
            &agent_kind,
            model.as_deref(),
            input_tokens,
            cache_read_tokens,
            cache_write_tokens,
            output_tokens,
        );
        if estimated_cost_microusd > 0 {
            pruned_updates.push((id, provider, agent_kind, estimated_cost_microusd));
        }
    }
    drop(statement);

    for (id, provider, agent_kind, estimated_cost_microusd) in pruned_updates {
        let changed = conn
            .execute(
                "UPDATE tokenomics_pruned_usage_rollups
                 SET estimated_cost_microusd=?1
                 WHERE id=?2 AND estimated_cost_microusd=0",
                rusqlite::params![estimated_cost_microusd, id],
            )
            .map_err(|error| format!("Unable to repair pruned Tokenomics rollup cost: {error}"))?;
        if changed > 0
            && !changed_pairs.iter().any(|(row_provider, row_agent)| {
                row_provider == &provider && row_agent == &agent_kind
            })
        {
            changed_pairs.push((provider, agent_kind));
        }
    }
    for (provider, agent_kind) in changed_pairs {
        tokenomics_rebuild_provider_rollups_from_events(conn, &provider, &agent_kind)?;
    }

    conn.execute(
        "INSERT OR REPLACE INTO tokenomics_meta(key, value)
         VALUES('provider_api_pricing_version', ?1)",
        rusqlite::params![TOKENOMICS_PROVIDER_API_PRICING_VERSION],
    )
    .map_err(|error| format!("Unable to record Tokenomics provider pricing version: {error}"))?;
    Ok(())
}

fn tokenomics_rebuild_provider_rollups_for_width(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    bucket_width: &str,
    bucket_column: &str,
) -> Result<(), String> {
    let query = format!(
        "SELECT
			           device_id, provider, agent_kind,
		           NULLIF(model, '') AS model,
		           NULLIF(subscription_key, '') AS subscription_key,
		           NULLIF(provider_account_key, '') AS provider_account_key,
		           MAX(provider_account_label) AS provider_account_label,
		           COALESCE(NULLIF(billing_scope_type, ''), 'unknown') AS billing_scope_type,
		           NULLIF(billing_team_id, '') AS billing_team_id,
		           MAX(COALESCE(NULLIF(billing_scope_source, ''), 'unknown')) AS billing_scope_source,
		           NULLIF(workspace_id, '') AS workspace_id,
		           MAX(repo_path) AS repo_path, bucket_start,
		           COALESCE(SUM(input_tokens), 0) AS input_tokens,
	           COALESCE(SUM(output_tokens), 0) AS output_tokens,
	           COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
           COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
           COALESCE(SUM(total_tokens), 0) AS total_tokens,
	           COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd,
	           COALESCE(SUM(event_count), 0) AS event_count
			         FROM (
			           SELECT
			             device_id, provider, agent_kind, model, subscription_key,
			             provider_account_key, provider_account_label,
			             billing_scope_type, billing_team_id, billing_scope_source,
			             workspace_id, repo_path, {bucket_column} AS bucket_start,
			             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
			             total_tokens, estimated_cost_microusd, 1 AS event_count
			           FROM tokenomics_usage_events
			           WHERE provider=?1 AND agent_kind=?2
			           UNION ALL
			           SELECT
			             device_id, provider, agent_kind, model, subscription_key,
			             provider_account_key, provider_account_label,
			             billing_scope_type, billing_team_id, billing_scope_source,
			             workspace_id, repo_path, bucket_start,
			             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
			             total_tokens, estimated_cost_microusd, event_count
			           FROM tokenomics_pruned_usage_rollups
			           WHERE provider=?1 AND agent_kind=?2 AND bucket_width=?3
			         )
			         GROUP BY device_id, provider, agent_kind,
			                  NULLIF(model, ''), NULLIF(subscription_key, ''), NULLIF(provider_account_key, ''),
			                  COALESCE(NULLIF(billing_scope_type, ''), 'unknown'),
			                  NULLIF(billing_team_id, ''), NULLIF(workspace_id, ''), bucket_start"
    );
    let mut statement = conn
        .prepare(&query)
        .map_err(|error| format!("Unable to prepare Tokenomics rollup rebuild: {error}"))?;
    let rows = statement
        .query_map(
            rusqlite::params![provider, agent_kind, bucket_width],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, String>(12)?,
                    row.get::<_, i64>(13)?,
                    row.get::<_, i64>(14)?,
                    row.get::<_, i64>(15)?,
                    row.get::<_, i64>(16)?,
                    row.get::<_, i64>(17)?,
                    row.get::<_, i64>(18)?,
                    row.get::<_, i64>(19)?,
                ))
            },
        )
        .map_err(|error| format!("Unable to query Tokenomics rollup rebuild: {error}"))?;
    let mut rebuilt = Vec::new();
    for row in rows {
        rebuilt.push(
            row.map_err(|error| format!("Unable to read Tokenomics rollup rebuild: {error}"))?,
        );
    }
    let now = tokenomics_now_iso_like();
    for (
        device_id,
        row_provider,
        row_agent_kind,
        model,
        subscription_key,
        provider_account_key,
        provider_account_label,
        billing_scope_type,
        billing_team_id,
        billing_scope_source,
        workspace_id,
        repo_path,
        bucket_start,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        total_tokens,
        estimated_cost_microusd,
        event_count,
    ) in rebuilt
    {
        let rollup_id = tokenomics_hash(&format!(
            "{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}",
            device_id,
            row_provider,
            row_agent_kind,
            model.as_deref().unwrap_or_default(),
            subscription_key.as_deref().unwrap_or_default(),
            provider_account_key.as_deref().unwrap_or_default(),
            billing_scope_type.as_str(),
            billing_team_id.as_deref().unwrap_or_default(),
            workspace_id.as_deref().unwrap_or_default(),
            bucket_width,
            bucket_start,
        ));
        conn.execute(
	            "INSERT INTO tokenomics_rollups(
	               id, device_id, provider, agent_kind, model, subscription_key,
	               provider_account_key, provider_account_label,
	               billing_scope_type, billing_team_id, billing_scope_source,
	               workspace_id, repo_path,
	               bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
	               cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
		             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
		             ON CONFLICT(id)
		             DO UPDATE SET
		               input_tokens=tokenomics_rollups.input_tokens+excluded.input_tokens,
		               output_tokens=tokenomics_rollups.output_tokens+excluded.output_tokens,
		               cache_read_tokens=tokenomics_rollups.cache_read_tokens+excluded.cache_read_tokens,
		               cache_write_tokens=tokenomics_rollups.cache_write_tokens+excluded.cache_write_tokens,
		               total_tokens=tokenomics_rollups.total_tokens+excluded.total_tokens,
		               estimated_cost_microusd=tokenomics_rollups.estimated_cost_microusd+excluded.estimated_cost_microusd,
		               event_count=tokenomics_rollups.event_count+excluded.event_count,
		               provider_account_label=COALESCE(excluded.provider_account_label, tokenomics_rollups.provider_account_label),
		               billing_scope_source=COALESCE(excluded.billing_scope_source, tokenomics_rollups.billing_scope_source),
		               repo_path=COALESCE(excluded.repo_path, tokenomics_rollups.repo_path),
		               updated_at=excluded.updated_at",
	            rusqlite::params![
	                rollup_id,
	                device_id,
                row_provider,
                row_agent_kind,
                model,
	                subscription_key,
	                provider_account_key,
	                provider_account_label,
	                billing_scope_type,
	                billing_team_id,
	                billing_scope_source,
	                workspace_id,
	                repo_path,
                bucket_width,
                bucket_start,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_write_tokens,
                total_tokens,
                estimated_cost_microusd,
                event_count,
                now.as_str(),
            ],
        )
        .map_err(|error| format!("Unable to insert rebuilt Tokenomics rollup: {error}"))?;
    }
    Ok(())
}

fn tokenomics_summary_for(
    app: &AppHandle,
    include_rollups: bool,
    include_cloud: bool,
) -> Result<Value, String> {
    let conn = tokenomics_open_db(app)?;
    tokenomics_reconcile_current_provider_accounts(&conn)?;
    tokenomics_summary_from_conn_with_cloud(&conn, include_rollups, None, include_cloud)
}

fn tokenomics_summary_from_conn(
    conn: &rusqlite::Connection,
    include_rollups: bool,
    inserted_events: Option<usize>,
) -> Result<Value, String> {
    tokenomics_summary_from_conn_with_cloud(conn, include_rollups, inserted_events, false)
}

fn tokenomics_summary_from_conn_with_cloud(
    conn: &rusqlite::Connection,
    include_rollups: bool,
    inserted_events: Option<usize>,
    include_cloud: bool,
) -> Result<Value, String> {
    tokenomics_summary_from_conn_with_cloud_for_scope(
        conn,
        include_rollups,
        inserted_events,
        include_cloud,
        None,
        true,
    )
}

fn tokenomics_summary_from_conn_with_cloud_read_only(
    conn: &rusqlite::Connection,
    include_rollups: bool,
    inserted_events: Option<usize>,
    include_cloud: bool,
) -> Result<Value, String> {
    tokenomics_summary_from_conn_with_cloud_for_scope(
        conn,
        include_rollups,
        inserted_events,
        include_cloud,
        None,
        false,
    )
}

fn tokenomics_summary_from_conn_with_cloud_for_scope(
    conn: &rusqlite::Connection,
    include_rollups: bool,
    inserted_events: Option<usize>,
    include_cloud: bool,
    scope_filter: Option<&TokenomicsBillingScope>,
    refresh_account_rows: bool,
) -> Result<Value, String> {
    if refresh_account_rows {
        let _span = BackendCpuSpan::new("tokenomics.summary.provider_accounts_refresh");
        tokenomics_reconcile_duplicate_provider_account_identities(conn)?;
        tokenomics_refresh_provider_accounts_from_usage(conn)?;
    }
    let scope_filter_sql = tokenomics_billing_scope_filter_sql(scope_filter, true);
    let total = tokenomics_query_one(
        conn,
        &format!(
            "SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM tokenomics_rollups WHERE bucket_width='hour' {scope_filter_sql}"
        ),
    )?;
    let retired_account_keys = tokenomics_retired_provider_account_keys(conn);
    let mut provider_accounts = tokenomics_provider_account_rows(conn, None, scope_filter)?;
    tokenomics_retain_active_account_rows(&mut provider_accounts, &retired_account_keys);
    let mut latest_windows = tokenomics_latest_window_rows(conn, None, scope_filter)?;
    tokenomics_retain_active_account_rows(&mut latest_windows, &retired_account_keys);
    let daemon_limits = tokenomics_meta_json(conn, TOKENOMICS_DAEMON_PROVIDER_LIMITS_KEY)
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    let local_limits = tokenomics_merge_provider_limits(latest_windows.clone(), daemon_limits);
    let mut limits = if include_cloud {
        tokenomics_merge_provider_limits(tokenomics_cloud_provider_limits(conn)?, local_limits)
    } else {
        local_limits
    };
    if include_cloud {
        tokenomics_apply_provider_limit_sample_pacing(conn, &mut limits)?;
    }
    tokenomics_retain_active_account_rows(&mut limits, &retired_account_keys);
    let hourly = if include_rollups {
        tokenomics_account_hourly_display_rollups(conn, None, scope_filter, include_cloud)?
    } else {
        tokenomics_account_hourly_display_rollups(conn, None, scope_filter, include_cloud)?
    };
    let daily_by_device_provider =
        tokenomics_account_daily_display_rollups(conn, None, scope_filter, include_cloud, None)?;
    let mut limit_samples =
        tokenomics_provider_limit_sample_rows(conn, None, scope_filter, include_cloud)?;
    tokenomics_retain_active_account_rows(&mut limit_samples, &retired_account_keys);
    let device_identities = tokenomics_summary_device_identities(conn, include_cloud)?;
    let scan_index = tokenomics_scan_index_status(conn)?;
    let usage_authority = tokenomics_meta_json(conn, TOKENOMICS_DAEMON_USAGE_AUTHORITY_KEY)
        .unwrap_or_else(|| tokenomics_unknown_usage_authority("report_not_requested"));
    let meter_states = tokenomics_meta_json(conn, TOKENOMICS_DAEMON_METER_STATES_KEY)
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    let haider_code_plan_status =
        tokenomics_meta_json(conn, TOKENOMICS_HAIDER_CODE_PLAN_STATUS_KEY).unwrap_or_else(|| {
            json!({
                "supported": Value::Null,
                "known": false,
                "authority_state": "unknown",
            })
        });
    Ok(json!({
    "known": total.get("total_tokens").and_then(Value::as_i64).unwrap_or(0) > 0 || !hourly.is_empty() || !daily_by_device_provider.is_empty(),
    "source": "rust_local_tokenomics_sqlite_v2",
    "schema_version": "tokenomics_v2",
    "updated_at": tokenomics_now_iso_like(),
    "current_device_id": tokenomics_local_device_id(),
    "current_device_name": tokenomics_local_device_name(),
    "inserted_events": inserted_events.unwrap_or(0),
    "total": total,
    "hourly_count": hourly.len(),
    "daily_by_device_provider_count": daily_by_device_provider.len(),
    "provider_account_count": provider_accounts.len(),
    "latest_window_count": latest_windows.len(),
    "limit_sample_count": limit_samples.len(),
    "hourly": hourly,
    // UI summary payload diet: the big arrays used to ship in BOTH snake and
    // camel case, doubling a multi-MB response that the webview parses on the
    // main thread mid-workspace-open (measured 5.5MB → native parse + GC was
    // a top open-lag component). snake_case is the only casing emitted now.
    "daily_by_device_provider": daily_by_device_provider,
    "provider_accounts": provider_accounts,
    "latest_windows": latest_windows,
    "limit_samples": limit_samples,
    "sources": [
        {"provider": "anthropic", "agent_kind": "claude", "label": "Claude Code"},
        {"provider": "openai", "agent_kind": "codex", "label": "Codex"},
        {"provider": "opencode", "agent_kind": "opencode", "label": "OpenCode"}
    ],
    "limits": limits,
    "usage_authority": usage_authority,
    "meter_states": meter_states,
    "haider_code_plan_status": haider_code_plan_status,
    "scan_index": scan_index,
    "retired_account_keys": retired_account_keys,
    "device_identities": device_identities,
    }))
}

fn tokenomics_sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn tokenomics_scan_index_status(conn: &rusqlite::Connection) -> Result<Value, String> {
    let scanner_versions = format!(
        "{}, {}",
        tokenomics_sql_string_literal(TOKENOMICS_LEGACY_CODEX_SCANNER_VERSION),
        tokenomics_sql_string_literal(TOKENOMICS_LEGACY_GENERIC_SCANNER_VERSION)
    );
    let count_query = |sql: &str| -> Result<i64, String> {
        conn.query_row(sql, [], |row| row.get::<_, i64>(0))
            .map_err(|error| format!("Unable to read Tokenomics scan index: {error}"))
    };
    let text_query = |sql: &str| -> Result<String, String> {
        conn.query_row(sql, [], |row| row.get::<_, String>(0))
            .map_err(|error| format!("Unable to read Tokenomics scan index text: {error}"))
    };

    let scan_state_count = count_query(&format!(
        "SELECT COUNT(*) FROM tokenomics_scan_state WHERE scanner_version IN ({scanner_versions})"
    ))?;
    let complete_scan_state_count = count_query(&format!(
        "SELECT COUNT(*) FROM tokenomics_scan_state WHERE initial_backfill_done != 0 AND scanner_version IN ({scanner_versions})"
    ))?;
    let source_offset_count = count_query(&format!(
        "SELECT COUNT(*) FROM tokenomics_source_offsets WHERE scanner_version IN ({scanner_versions})"
    ))?;
    let source_import_count = count_query("SELECT COUNT(*) FROM tokenomics_source_imports")?;
    let raw_available_count =
        count_query("SELECT COUNT(*) FROM tokenomics_source_imports WHERE raw_available != 0")?;
    let raw_deleted_count =
        count_query("SELECT COUNT(*) FROM tokenomics_source_imports WHERE raw_available = 0")?;
    let safe_to_delete_count = count_query(
        "SELECT COUNT(*) FROM tokenomics_source_imports
         WHERE raw_available != 0
           AND event_count > 0
           AND import_status IN ('complete', 'indexed_empty')",
    )?;
    let complete_scan_day_count = count_query(&format!(
        "SELECT COUNT(*) FROM tokenomics_scan_days WHERE status='complete' AND scanner_version IN ({scanner_versions})"
    ))?;
    let last_event_timestamp = count_query(&format!(
        "SELECT COALESCE(MAX(last_event_timestamp), 0) FROM (
           SELECT last_event_timestamp FROM tokenomics_scan_state WHERE scanner_version IN ({scanner_versions})
           UNION ALL
           SELECT last_event_timestamp FROM tokenomics_source_offsets WHERE scanner_version IN ({scanner_versions})
           UNION ALL
           SELECT last_event_timestamp FROM tokenomics_source_imports
         )"
    ))?;
    let covered_since_unix = count_query(&format!(
        "SELECT COALESCE(MIN(NULLIF(coverage_start_unix, {TOKENOMICS_UNKNOWN_OFFSET_COVERAGE_START_UNIX})), 0)
         FROM (
           SELECT coverage_start_unix FROM tokenomics_source_offsets WHERE scanner_version IN ({scanner_versions})
           UNION ALL
           SELECT coverage_start_unix FROM tokenomics_source_imports
         )"
    ))?;
    let last_indexed_at = text_query(&format!(
        "SELECT COALESCE(MAX(updated_at), '') FROM (
           SELECT updated_at FROM tokenomics_scan_state WHERE scanner_version IN ({scanner_versions})
           UNION ALL
           SELECT updated_at FROM tokenomics_source_offsets WHERE scanner_version IN ({scanner_versions})
           UNION ALL
           SELECT updated_at FROM tokenomics_scan_days WHERE scanner_version IN ({scanner_versions})
           UNION ALL
           SELECT updated_at FROM tokenomics_source_imports
         )"
    ))?;
    let status = if scan_state_count == 0
        && source_offset_count == 0
        && source_import_count == 0
        && complete_scan_day_count == 0
    {
        "not_started"
    } else if scan_state_count > 0 && complete_scan_state_count >= scan_state_count {
        "indexed"
    } else {
        "partial"
    };
    let covered_since_value = if covered_since_unix > 0 {
        json!(covered_since_unix)
    } else {
        Value::Null
    };
    let last_event_value = if last_event_timestamp > 0 {
        json!(last_event_timestamp)
    } else {
        Value::Null
    };

    Ok(json!({
        "status": status,
        "cache": "sqlite_retained_history_and_device_rollups",
        "historical_import": {
            "status": status,
            "retained_read_only": true,
            "initial_backfill_done": complete_scan_state_count > 0,
            "scan_state_count": scan_state_count,
            "complete_scan_state_count": complete_scan_state_count,
            "source_offset_count": source_offset_count,
            "source_import_count": source_import_count,
            "raw_available_count": raw_available_count,
            "raw_deleted_count": raw_deleted_count,
            "safe_to_delete_count": safe_to_delete_count,
            "complete_scan_day_count": complete_scan_day_count,
            "covered_since_unix": covered_since_value,
            "last_event_timestamp": last_event_value,
            "last_indexed_at": last_indexed_at,
        },
        "live_input": {
            "source": "haider_usage_report",
            "authority": "daemon",
            "local_disk_scanning": false,
        },
        "retired_scanner_versions": {
            "codex": TOKENOMICS_LEGACY_CODEX_SCANNER_VERSION,
            "generic": TOKENOMICS_LEGACY_GENERIC_SCANNER_VERSION,
        },
    }))
}

fn tokenomics_billing_scope_filter_sql(
    scope_filter: Option<&TokenomicsBillingScope>,
    include_unknown: bool,
) -> String {
    let Some(scope_filter) = scope_filter else {
        return String::new();
    };
    let scope_type_sql = "COALESCE(NULLIF(billing_scope_type, ''), 'unknown')";
    let scope_team_sql = "COALESCE(NULLIF(billing_team_id, ''), '')";
    let scope_match = if scope_filter.scope_type == "team" {
        let team_id = scope_filter.team_id.as_deref().unwrap_or_default();
        format!(
            "({scope_type_sql}='team' AND {scope_team_sql}={})",
            tokenomics_sql_string_literal(team_id)
        )
    } else if scope_filter.scope_type == "personal" {
        format!("{scope_type_sql}='personal'")
    } else {
        format!("{scope_type_sql}='unknown'")
    };
    if include_unknown && scope_filter.scope_type != "unknown" {
        format!(" AND ({scope_match} OR {scope_type_sql}='unknown')")
    } else {
        format!(" AND ({scope_match})")
    }
}

fn tokenomics_cloud_relay_sample_filter_sql(conn: &rusqlite::Connection) -> Result<String, String> {
    let mut excluded = tokenomics_local_device_id_set(conn)?
        .into_iter()
        .collect::<Vec<_>>();
    excluded.extend(
        [
            "desktop-primary",
            "cloud",
            "account",
            "all",
            "all-device",
            "all-devices",
            "all_device",
            "all_devices",
            "unknown-device",
            "unknown_device",
        ]
        .into_iter()
        .map(str::to_string),
    );
    excluded.sort();
    excluded.dedup();
    let excluded_sql = excluded
        .iter()
        .map(|value| tokenomics_sql_string_literal(value))
        .collect::<Vec<_>>()
        .join(", ");
    Ok(format!(
        " AND (source!='cloud' OR (TRIM(COALESCE(device_id, ''))!='' AND device_id NOT IN ({excluded_sql})))"
    ))
}

fn tokenomics_provider_account_row_id(
    device_id: &str,
    provider: &str,
    agent_kind: &str,
    provider_account_key: &str,
    billing_scope: &TokenomicsBillingScope,
) -> String {
    let raw = format!(
        "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
        device_id,
        billing_scope.scope_type,
        billing_scope.team_id.as_deref().unwrap_or_default(),
        provider,
        agent_kind,
        provider_account_key,
    );
    format!("provider-account-{}", tokenomics_hash(&raw))
}

fn tokenomics_upsert_provider_account(
    conn: &rusqlite::Connection,
    device_id: &str,
    provider: &str,
    agent_kind: &str,
    provider_account_key: &str,
    provider_account_label: Option<&str>,
    billing_scope: &TokenomicsBillingScope,
    attribution_source: &str,
) -> Result<(), String> {
    let provider = provider.trim().to_ascii_lowercase();
    let agent_kind = agent_kind.trim().to_ascii_lowercase();
    if provider.is_empty() || agent_kind.is_empty() {
        return Ok(());
    }
    let provider_account_key = provider_account_key.trim();
    let provider_account_key = if provider_account_key.is_empty() {
        format!("{provider}:{agent_kind}:unknown")
    } else {
        provider_account_key.to_string()
    };
    if tokenomics_provider_account_key_is_unknown(&provider_account_key) {
        return Ok(());
    }
    let provider_account_label = provider_account_label
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| tokenomics_provider_account_base_label(&provider, &agent_kind));
    let clean_device_id =
        tokenomics_clean_device_id(device_id).unwrap_or_else(tokenomics_local_device_id);
    let id = tokenomics_provider_account_row_id(
        &clean_device_id,
        &provider,
        &agent_kind,
        &provider_account_key,
        billing_scope,
    );
    let now_unix = tokenomics_unix_now();
    let now = tokenomics_unix_iso_like(now_unix);
    let attribution_source = tokenomics_clean_billing_scope_source(attribution_source);
    tokenomics_with_db_write_lock(conn, || {
        tokenomics_retry_sqlite_write("Unable to upsert Tokenomics provider account", || {
            conn.execute(
                "INSERT INTO tokenomics_provider_accounts(
                   id, device_id, provider, agent_kind, provider_account_key, provider_account_label,
                   billing_scope_type, billing_team_id, billing_scope_source, attribution_source,
                   first_seen_at, last_seen_at, updated_at, updated_at_unix
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?11, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                   provider_account_label=excluded.provider_account_label,
                   billing_scope_source=excluded.billing_scope_source,
                   attribution_source=excluded.attribution_source,
                   last_seen_at=excluded.last_seen_at,
                   updated_at=CASE
                     WHEN COALESCE(tokenomics_provider_accounts.provider_account_label, '') != COALESCE(excluded.provider_account_label, '')
                       OR COALESCE(tokenomics_provider_accounts.billing_scope_source, '') != COALESCE(excluded.billing_scope_source, '')
                       OR COALESCE(tokenomics_provider_accounts.attribution_source, '') != COALESCE(excluded.attribution_source, '')
                     THEN excluded.updated_at
                     ELSE tokenomics_provider_accounts.updated_at
                   END,
                   updated_at_unix=CASE
                     WHEN COALESCE(tokenomics_provider_accounts.provider_account_label, '') != COALESCE(excluded.provider_account_label, '')
                       OR COALESCE(tokenomics_provider_accounts.billing_scope_source, '') != COALESCE(excluded.billing_scope_source, '')
                       OR COALESCE(tokenomics_provider_accounts.attribution_source, '') != COALESCE(excluded.attribution_source, '')
                     THEN excluded.updated_at_unix
                     ELSE tokenomics_provider_accounts.updated_at_unix
                   END",
                rusqlite::params![
                    id.as_str(),
                    clean_device_id.as_str(),
                    provider.as_str(),
                    agent_kind.as_str(),
                    provider_account_key.as_str(),
                    provider_account_label.as_str(),
                    billing_scope.scope_type.as_str(),
                    billing_scope.team_id.as_deref(),
                    billing_scope.source.as_str(),
                    attribution_source.as_str(),
                    now.as_str(),
                    now_unix as i64,
                ],
            )
        })
    })?;
    Ok(())
}

fn tokenomics_refresh_provider_accounts_from_usage(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let mut statement = conn
        .prepare(
            "SELECT
               device_id,
               provider,
               agent_kind,
               COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, ''), provider || ':' || agent_kind || ':unknown') AS provider_account_key,
               MAX(provider_account_label) AS provider_account_label,
               COALESCE(NULLIF(billing_scope_type, ''), 'unknown') AS billing_scope_type,
               NULLIF(billing_team_id, '') AS billing_team_id,
               MAX(COALESCE(NULLIF(billing_scope_source, ''), 'unknown')) AS billing_scope_source
             FROM tokenomics_rollups
             WHERE bucket_width='hour'
               AND TRIM(COALESCE(provider_account_key, subscription_key, ''))!=''
               AND LOWER(TRIM(COALESCE(provider_account_key, subscription_key, ''))) NOT LIKE '%:unknown'
             GROUP BY device_id, provider, agent_kind, provider_account_key, billing_scope_type, billing_team_id",
        )
        .map_err(|error| format!("Unable to prepare Tokenomics provider account refresh: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                TokenomicsBillingScope {
                    scope_type: row.get::<_, String>(5)?,
                    team_id: row.get::<_, Option<String>>(6)?,
                    source: row.get::<_, String>(7)?,
                },
            ))
        })
        .map_err(|error| format!("Unable to query Tokenomics provider account refresh: {error}"))?;
    let mut accounts = Vec::new();
    for row in rows {
        accounts.push(row.map_err(|error| {
            format!("Unable to read Tokenomics provider account refresh row: {error}")
        })?);
    }
    drop(statement);
    for (device_id, provider, agent_kind, key, label, scope) in accounts {
        tokenomics_upsert_provider_account(
            conn,
            &device_id,
            &provider,
            &agent_kind,
            &key,
            label.as_deref(),
            &scope,
            "usage_hour",
        )?;
    }
    tokenomics_compact_provider_account_rows(conn)?;
    Ok(())
}

fn tokenomics_provider_account_rows(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
    scope_filter: Option<&TokenomicsBillingScope>,
) -> Result<Vec<Value>, String> {
    let clean_since = since_updated_at
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let scope_filter_sql = tokenomics_billing_scope_filter_sql(scope_filter, true);
    let scope_type_sql = "COALESCE(NULLIF(billing_scope_type, ''), 'unknown')";
    let scope_team_sql = "NULLIF(billing_team_id, '')";
    let scope_key_sql = "CASE WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='team' AND NULLIF(billing_team_id, '') IS NOT NULL THEN 'team:' || billing_team_id WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='personal' THEN 'personal' ELSE 'unknown' END";
    let scope_label_sql = "CASE WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='team' THEN 'Team' WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='personal' THEN 'Personal' ELSE 'Unknown scope' END";
    let mut statement = conn
        .prepare(&format!(
            "SELECT
               id,
               'provider_account' AS row_kind,
               1 AS replacement,
               'replace' AS operation,
               device_id,
               provider,
               agent_kind,
               provider_account_key AS subscription_key,
               provider_account_key,
               provider_account_label,
               {scope_type_sql} AS billing_scope_type,
               {scope_team_sql} AS billing_team_id,
               {scope_key_sql} AS billing_scope_key,
               {scope_label_sql} AS billing_scope_label,
               COALESCE(NULLIF(billing_scope_source, ''), 'unknown') AS billing_scope_source,
               attribution_source,
               first_seen_at,
               last_seen_at,
               updated_at
             FROM tokenomics_provider_accounts
             WHERE (?1 IS NULL OR updated_at >= ?1)
               AND TRIM(COALESCE(provider_account_key, ''))!=''
               AND LOWER(TRIM(provider_account_key)) NOT LIKE '%:unknown'
               {scope_filter_sql}
             ORDER BY updated_at DESC, provider, agent_kind, provider_account_label
             LIMIT ?2"
        ))
        .map_err(|error| format!("Unable to prepare provider account query: {error}"))?;
    let columns = statement
        .column_names()
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let mapped = statement
        .query_map(
            rusqlite::params![clean_since, TOKENOMICS_SYNC_ROLLUP_LIMIT as i64],
            |row| {
                let mut object = serde_json::Map::new();
                for (index, column) in columns.iter().enumerate() {
                    let value = match row.get_ref(index)? {
                        rusqlite::types::ValueRef::Null => Value::Null,
                        rusqlite::types::ValueRef::Integer(value) => json!(value),
                        rusqlite::types::ValueRef::Real(value) => json!(value),
                        rusqlite::types::ValueRef::Text(value) => {
                            Value::String(String::from_utf8_lossy(value).to_string())
                        }
                        rusqlite::types::ValueRef::Blob(value) => {
                            Value::String(tokenomics_hash(&String::from_utf8_lossy(value)))
                        }
                    };
                    object.insert(column.to_string(), value);
                }
                object.insert("replacement".to_string(), json!(true));
                object.insert("operation".to_string(), json!("replace"));
                Ok(Value::Object(object))
            },
        )
        .map_err(|error| format!("Unable to query provider account rows: {error}"))?;
    let mut rows = Vec::new();
    for row in mapped {
        rows.push(row.map_err(|error| format!("Unable to read provider account row: {error}"))?);
    }
    Ok(rows)
}

fn tokenomics_provider_account_identity_summary_from_conn(
    conn: &rusqlite::Connection,
    scope_filter: Option<&TokenomicsBillingScope>,
) -> Result<Value, String> {
    {
        let _span = BackendCpuSpan::new("tokenomics.provider_identity.provider_accounts_refresh");
        tokenomics_refresh_provider_accounts_from_usage(conn)?;
    }
    let retired_account_keys = tokenomics_retired_provider_account_keys(conn);
    let mut provider_accounts = {
        let _span = BackendCpuSpan::new("tokenomics.provider_identity.provider_account_rows");
        tokenomics_provider_account_rows(conn, None, scope_filter)?
    };
    tokenomics_retain_active_account_rows(&mut provider_accounts, &retired_account_keys);
    let provider_account_count = provider_accounts.len();
    Ok(json!({
        "known": provider_account_count > 0,
        "source": "rust_local_tokenomics_provider_identity_v1",
        "schema_version": "tokenomics_v2",
        "updated_at": tokenomics_now_iso_like(),
        "provider_account_count": provider_account_count,
        "provider_accounts": provider_accounts,
        "hourly": [],
        "limits": [],
    }))
}

fn tokenomics_sync_window_kind(window_kind: &str) -> String {
    match window_kind.trim().to_ascii_lowercase().as_str() {
        "5_hour" | "5-hour" | "5h" | "five_hour" | "five-hour" | "session" | "session_5h" => {
            "session_5h".to_string()
        }
        "weekly" | "week" | "7_day" | "seven_day" => "weekly".to_string(),
        other => other.to_string(),
    }
}

fn tokenomics_latest_window_id(
    device_id: &str,
    provider: &str,
    agent_kind: &str,
    provider_account_key: &str,
    billing_scope: &TokenomicsBillingScope,
    window_kind: &str,
) -> String {
    let raw = format!(
        "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
        device_id,
        billing_scope.scope_type,
        billing_scope.team_id.as_deref().unwrap_or_default(),
        provider,
        agent_kind,
        provider_account_key,
        window_kind,
    );
    format!("latest-window-{}", tokenomics_hash(&raw))
}

fn tokenomics_upsert_latest_window(
    conn: &rusqlite::Connection,
    value: &Value,
    fallback_scope: &TokenomicsBillingScope,
    fallback_device_id: &str,
    source_override: Option<&str>,
) -> Result<bool, String> {
    let provider =
        tokenomics_value_string(value, &["provider"]).unwrap_or_else(|| "unknown".to_string());
    let agent_kind =
        tokenomics_value_string(value, &["agent_kind"]).unwrap_or_else(|| provider.clone());
    if provider == "unknown" || agent_kind == "unknown" {
        return Ok(false);
    }
    let fallback_account = tokenomics_provider_account(&provider, &agent_kind);
    let provider_account_key =
        tokenomics_value_string(value, &["provider_account_key", "subscription_key"])
            .unwrap_or_else(|| fallback_account.key.clone());
    if tokenomics_provider_account_key_is_unknown(&provider_account_key) {
        return Ok(false);
    }
    let provider_account_label = tokenomics_value_string(value, &["provider_account_label"])
        .unwrap_or_else(|| fallback_account.label.clone());
    let billing_scope = tokenomics_billing_scope_from_value(value, fallback_scope);
    let provider_window_kind = tokenomics_value_string(value, &["window_kind", "limit_kind"])
        .unwrap_or_else(|| "5_hour".to_string());
    let window_kind = tokenomics_sync_window_kind(&provider_window_kind);
    if !matches!(window_kind.as_str(), "session_5h" | "weekly") {
        return Ok(false);
    }
    let now_unix = tokenomics_unix_now();
    let sample_at = tokenomics_value_string(value, &["sample_at", "updated_at", "last_known_at"])
        .unwrap_or_else(|| tokenomics_unix_iso_like(now_unix));
    let sample_at_unix = tokenomics_value_i64(value, &["sample_at_unix"])
        .map(tokenomics_normalize_unix_timestamp)
        .or_else(|| tokenomics_timestamp_unix(&sample_at))
        .unwrap_or(now_unix);
    let (used_percent, remaining_percent) = tokenomics_limit_percent_pair(value)
        .map(|(used, remaining)| (Some(used), Some(remaining)))
        .unwrap_or((None, None));
    let reset_at = tokenomics_provider_limit_sample_reset_at(value, sample_at_unix);
    let reset_after_seconds = tokenomics_value_i64(value, &["reset_after_seconds"]);
    let limit_window_seconds = tokenomics_limit_effective_window_seconds(
        &provider_window_kind,
        tokenomics_value_i64(value, &["limit_window_seconds"]),
    );
    let pace_status = tokenomics_value_string(value, &["pace_status"]).unwrap_or_default();
    let pace_delta_percent = tokenomics_value_i64(value, &["pace_delta_percent"]);
    let source = source_override
        .map(ToOwned::to_owned)
        .or_else(|| tokenomics_value_string(value, &["source", "limit_source"]))
        .unwrap_or_else(|| "local".to_string());
    let confidence =
        tokenomics_value_string(value, &["confidence"]).unwrap_or_else(|| "unknown".to_string());
    let device_id = tokenomics_value_string(value, &["device_id", "machine_id"])
        .unwrap_or_else(|| fallback_device_id.to_string());
    tokenomics_upsert_provider_account(
        conn,
        &device_id,
        &provider,
        &agent_kind,
        &provider_account_key,
        Some(&provider_account_label),
        &billing_scope,
        "latest_window",
    )?;
    let id = tokenomics_latest_window_id(
        &device_id,
        &provider,
        &agent_kind,
        &provider_account_key,
        &billing_scope,
        &window_kind,
    );
    let updated_at_unix = now_unix;
    let updated_at = tokenomics_unix_iso_like(updated_at_unix);
    let material_changed = match conn.query_row(
        "SELECT provider_account_label, billing_scope_source, provider_window_kind,
                sample_at, sample_at_unix,
                used_percent, remaining_percent, reset_at, reset_after_seconds,
                limit_window_seconds, pace_status, pace_delta_percent, source, confidence
         FROM tokenomics_latest_windows
         WHERE id=?1",
        rusqlite::params![id.as_str()],
        |row| {
            Ok(
                row.get::<_, Option<String>>(0)? != Some(provider_account_label.clone())
                    || row.get::<_, Option<String>>(1)? != Some(billing_scope.source.clone())
                    || row.get::<_, Option<String>>(2)? != Some(provider_window_kind.clone())
                    || row.get::<_, Option<String>>(3)? != Some(sample_at.clone())
                    || row.get::<_, Option<i64>>(4)? != Some(sample_at_unix as i64)
                    || row.get::<_, Option<i64>>(5)? != used_percent
                    || row.get::<_, Option<i64>>(6)? != remaining_percent
                    || row.get::<_, Option<String>>(7)? != reset_at.clone()
                    || row.get::<_, Option<i64>>(8)? != reset_after_seconds
                    || row.get::<_, Option<i64>>(9)? != Some(limit_window_seconds)
                    || row.get::<_, Option<String>>(10)? != Some(pace_status.clone())
                    || row.get::<_, Option<i64>>(11)? != pace_delta_percent
                    || row.get::<_, Option<String>>(12)? != Some(source.clone())
                    || row.get::<_, Option<String>>(13)? != Some(confidence.clone()),
            )
        },
    ) {
        Ok(changed) => changed,
        Err(rusqlite::Error::QueryReturnedNoRows) => true,
        Err(error) => {
            return Err(format!(
                "Unable to inspect existing Tokenomics latest window: {error}"
            ));
        }
    };
    conn.execute(
        "INSERT INTO tokenomics_latest_windows(
           id, device_id, provider, agent_kind, provider_account_key, provider_account_label,
           billing_scope_type, billing_team_id, billing_scope_source,
           window_kind, provider_window_kind, sample_at, sample_at_unix,
           used_percent, remaining_percent, reset_at, reset_after_seconds, limit_window_seconds,
           pace_status, pace_delta_percent, source, confidence, updated_at, updated_at_unix
         ) VALUES(
           ?1, ?2, ?3, ?4, ?5, ?6,
           ?7, ?8, ?9,
           ?10, ?11, ?12, ?13,
           ?14, ?15, ?16, ?17, ?18,
           ?19, ?20, ?21, ?22, ?23, ?24
         )
         ON CONFLICT(id) DO UPDATE SET
           provider_account_label=excluded.provider_account_label,
           billing_scope_source=excluded.billing_scope_source,
           provider_window_kind=excluded.provider_window_kind,
           sample_at=excluded.sample_at,
           sample_at_unix=excluded.sample_at_unix,
           used_percent=excluded.used_percent,
           remaining_percent=excluded.remaining_percent,
           reset_at=excluded.reset_at,
           reset_after_seconds=excluded.reset_after_seconds,
           limit_window_seconds=excluded.limit_window_seconds,
           pace_status=excluded.pace_status,
           pace_delta_percent=excluded.pace_delta_percent,
           source=excluded.source,
           confidence=excluded.confidence,
           updated_at=CASE
             WHEN COALESCE(tokenomics_latest_windows.provider_account_label, '') != COALESCE(excluded.provider_account_label, '')
               OR COALESCE(tokenomics_latest_windows.provider_window_kind, '') != COALESCE(excluded.provider_window_kind, '')
               OR COALESCE(tokenomics_latest_windows.used_percent, -1) != COALESCE(excluded.used_percent, -1)
               OR COALESCE(tokenomics_latest_windows.remaining_percent, -1) != COALESCE(excluded.remaining_percent, -1)
               OR COALESCE(tokenomics_latest_windows.reset_at, '') != COALESCE(excluded.reset_at, '')
               OR COALESCE(tokenomics_latest_windows.reset_after_seconds, -1) != COALESCE(excluded.reset_after_seconds, -1)
               OR COALESCE(tokenomics_latest_windows.source, '') != COALESCE(excluded.source, '')
               OR COALESCE(tokenomics_latest_windows.confidence, '') != COALESCE(excluded.confidence, '')
             THEN excluded.updated_at
             ELSE tokenomics_latest_windows.updated_at
           END,
           updated_at_unix=CASE
             WHEN COALESCE(tokenomics_latest_windows.provider_account_label, '') != COALESCE(excluded.provider_account_label, '')
               OR COALESCE(tokenomics_latest_windows.provider_window_kind, '') != COALESCE(excluded.provider_window_kind, '')
               OR COALESCE(tokenomics_latest_windows.used_percent, -1) != COALESCE(excluded.used_percent, -1)
               OR COALESCE(tokenomics_latest_windows.remaining_percent, -1) != COALESCE(excluded.remaining_percent, -1)
               OR COALESCE(tokenomics_latest_windows.reset_at, '') != COALESCE(excluded.reset_at, '')
               OR COALESCE(tokenomics_latest_windows.reset_after_seconds, -1) != COALESCE(excluded.reset_after_seconds, -1)
               OR COALESCE(tokenomics_latest_windows.source, '') != COALESCE(excluded.source, '')
               OR COALESCE(tokenomics_latest_windows.confidence, '') != COALESCE(excluded.confidence, '')
             THEN excluded.updated_at_unix
             ELSE tokenomics_latest_windows.updated_at_unix
           END
         WHERE excluded.sample_at_unix >= tokenomics_latest_windows.sample_at_unix",
        rusqlite::params![
            id,
            device_id,
            provider,
            agent_kind,
            provider_account_key,
            provider_account_label,
            billing_scope.scope_type.as_str(),
            billing_scope.team_id.as_deref(),
            billing_scope.source.as_str(),
            window_kind,
            provider_window_kind,
            sample_at,
            sample_at_unix as i64,
            used_percent,
            remaining_percent,
            reset_at.as_deref(),
            reset_after_seconds,
            limit_window_seconds,
            pace_status,
            pace_delta_percent,
            source,
            confidence,
            updated_at,
            updated_at_unix as i64,
        ],
    )
    .map_err(|error| format!("Unable to upsert Tokenomics latest window: {error}"))?;
    Ok(material_changed)
}

fn tokenomics_record_latest_windows(
    conn: &rusqlite::Connection,
    limits: &[Value],
) -> Result<usize, String> {
    let fallback_scope = tokenomics_current_billing_scope();
    let device_id = tokenomics_local_device_id();
    let mut count = 0usize;
    for limit in limits.iter().take(128) {
        if tokenomics_provider_limit_is_unknown(limit)
            || tokenomics_provider_limit_is_dormant_cached(limit)
        {
            continue;
        }
        if tokenomics_upsert_latest_window(conn, limit, &fallback_scope, &device_id, Some("local"))?
        {
            count += 1;
        }
    }
    Ok(count)
}

fn tokenomics_latest_window_rows(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
    scope_filter: Option<&TokenomicsBillingScope>,
) -> Result<Vec<Value>, String> {
    let clean_since = since_updated_at
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let scope_filter_sql = tokenomics_billing_scope_filter_sql(scope_filter, true);
    let scope_type_sql = "COALESCE(NULLIF(billing_scope_type, ''), 'unknown')";
    let scope_team_sql = "NULLIF(billing_team_id, '')";
    let scope_key_sql = "CASE WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='team' AND NULLIF(billing_team_id, '') IS NOT NULL THEN 'team:' || billing_team_id WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='personal' THEN 'personal' ELSE 'unknown' END";
    let scope_label_sql = "CASE WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='team' THEN 'Team' WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='personal' THEN 'Personal' ELSE 'Unknown scope' END";
    let mut statement = conn
        .prepare(&format!(
            "SELECT
               id,
               'latest_window' AS row_kind,
               1 AS replacement,
               'replace' AS operation,
               device_id,
               provider,
               agent_kind,
               provider_account_key AS subscription_key,
               provider_account_key,
               provider_account_label,
               {scope_type_sql} AS billing_scope_type,
               {scope_team_sql} AS billing_team_id,
               {scope_key_sql} AS billing_scope_key,
               {scope_label_sql} AS billing_scope_label,
               COALESCE(NULLIF(billing_scope_source, ''), 'unknown') AS billing_scope_source,
               window_kind,
               provider_window_kind,
               sample_at,
               sample_at_unix,
               used_percent,
               remaining_percent,
               reset_at,
               reset_after_seconds,
               limit_window_seconds,
               pace_status,
               pace_delta_percent,
               source,
               confidence,
               updated_at
             FROM tokenomics_latest_windows
             WHERE (?1 IS NULL OR updated_at >= ?1)
               AND TRIM(COALESCE(provider_account_key, ''))!=''
               AND LOWER(TRIM(provider_account_key)) NOT LIKE '%:unknown'
               {scope_filter_sql}
             ORDER BY updated_at DESC, provider, agent_kind, provider_account_label, window_kind
             LIMIT ?2"
        ))
        .map_err(|error| format!("Unable to prepare latest window query: {error}"))?;
    let columns = statement
        .column_names()
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let mapped = statement
        .query_map(
            rusqlite::params![
                clean_since,
                TOKENOMICS_PROVIDER_LIMIT_SAMPLE_SYNC_LIMIT as i64
            ],
            |row| {
                let mut object = serde_json::Map::new();
                for (index, column) in columns.iter().enumerate() {
                    let value = match row.get_ref(index)? {
                        rusqlite::types::ValueRef::Null => Value::Null,
                        rusqlite::types::ValueRef::Integer(value) => json!(value),
                        rusqlite::types::ValueRef::Real(value) => json!(value),
                        rusqlite::types::ValueRef::Text(value) => {
                            Value::String(String::from_utf8_lossy(value).to_string())
                        }
                        rusqlite::types::ValueRef::Blob(value) => {
                            Value::String(tokenomics_hash(&String::from_utf8_lossy(value)))
                        }
                    };
                    object.insert(column.to_string(), value);
                }
                object.insert("replacement".to_string(), json!(true));
                object.insert("operation".to_string(), json!("replace"));
                Ok(Value::Object(object))
            },
        )
        .map_err(|error| format!("Unable to query latest window rows: {error}"))?;
    let mut rows = Vec::new();
    for row in mapped {
        rows.push(row.map_err(|error| format!("Unable to read latest window row: {error}"))?);
    }
    Ok(rows)
}

fn tokenomics_account_hourly_sync_rollups(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
    scope_filter: Option<&TokenomicsBillingScope>,
) -> Result<Vec<Value>, String> {
    tokenomics_account_hourly_display_rollups(conn, since_updated_at, scope_filter, false)
}

fn tokenomics_account_daily_display_rollups(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
    scope_filter: Option<&TokenomicsBillingScope>,
    include_cloud: bool,
    day_start: Option<&str>,
) -> Result<Vec<Value>, String> {
    let clean_since = since_updated_at
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let clean_day_start = day_start.map(str::trim).filter(|value| !value.is_empty());
    let table = if include_cloud {
        "tokenomics_display_daily_rollups"
    } else {
        "tokenomics_daily_rollups"
    };
    let account_key_sql = "COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, ''), provider || ':' || agent_kind || ':unknown')";
    let account_label_sql = "COALESCE(NULLIF(provider_account_label, ''), CASE WHEN agent_kind='codex' THEN 'Codex account' WHEN agent_kind='claude' THEN 'Claude account' WHEN agent_kind='opencode' THEN 'OpenCode account' ELSE agent_kind || ' account' END)";
    let model_sql = "COALESCE(NULLIF(model, ''), agent_kind)";
    let scope_type_sql = "COALESCE(NULLIF(billing_scope_type, ''), 'unknown')";
    let scope_team_sql = "NULLIF(billing_team_id, '')";
    let scope_key_sql = "CASE WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='team' AND NULLIF(billing_team_id, '') IS NOT NULL THEN 'team:' || billing_team_id WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='personal' THEN 'personal' ELSE 'unknown' END";
    let scope_label_sql = "CASE WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='team' THEN 'Team' WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='personal' THEN 'Personal' ELSE 'Unknown scope' END";
    let scope_source_sql = "COALESCE(NULLIF(billing_scope_source, ''), 'unknown')";
    let scope_filter_sql = tokenomics_billing_scope_filter_sql(scope_filter, true);
    let mut statement = conn
        .prepare(
            &format!("SELECT
                   'usage-day:' || hex(device_id || '|' || provider || '|' || agent_kind || '|' || {model_sql} || '|' || {account_key_sql} || '|' || {scope_key_sql} || '|' || bucket_start) AS id,
                   'usage_day' AS row_kind,
                   device_id,
                   provider,
                   agent_kind,
                   {model_sql} AS model,
                   {account_key_sql} AS subscription_key,
                   {account_key_sql} AS provider_account_key,
                   {account_label_sql} AS provider_account_label,
                   {scope_type_sql} AS billing_scope_type,
                   {scope_team_sql} AS billing_team_id,
                   {scope_key_sql} AS billing_scope_key,
                   {scope_label_sql} AS billing_scope_label,
                   MAX({scope_source_sql}) AS billing_scope_source,
                   NULL AS workspace_id,
                   NULL AS repo_path,
                   'day' AS bucket_width,
                   'UTC' AS bucket_timezone,
                   bucket_start,
                   COALESCE(SUM(input_tokens), 0) AS input_tokens,
                   COALESCE(SUM(output_tokens), 0) AS output_tokens,
                   COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                   COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
                   COALESCE(SUM(CASE WHEN COALESCE(total_tokens, 0) > 0 THEN total_tokens ELSE COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) + COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0) END), 0) AS total_tokens,
                   COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd,
                   COALESCE(SUM(event_count), 0) AS event_count,
                   MAX(updated_at) AS updated_at
                 FROM {table}
                 WHERE bucket_width='day'
                   AND TRIM({account_key_sql})!=''
                   AND LOWER(TRIM({account_key_sql})) NOT LIKE '%:unknown'
                   AND bucket_start GLOB '????-??-??'
                   AND bucket_start >= date('now', '-29 days')
                   {scope_filter_sql}
                   AND (?1 IS NULL OR updated_at >= ?1)
                   AND (?2 IS NULL OR bucket_start = ?2)
                 GROUP BY device_id, provider, agent_kind, {model_sql}, subscription_key, provider_account_key, billing_scope_key, bucket_start
                 ORDER BY bucket_start DESC, updated_at DESC, provider, agent_kind
                 LIMIT ?3"),
        )
        .map_err(|error| format!("Unable to prepare Tokenomics account daily query: {error}"))?;
    let columns = statement
        .column_names()
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let mapped = statement
        .query_map(
            rusqlite::params![
                clean_since,
                clean_day_start,
                TOKENOMICS_SYNC_ROLLUP_LIMIT as i64
            ],
            |row| {
                let mut object = serde_json::Map::new();
                for (index, column) in columns.iter().enumerate() {
                    let value = match row.get_ref(index)? {
                        rusqlite::types::ValueRef::Null => Value::Null,
                        rusqlite::types::ValueRef::Integer(value) => json!(value),
                        rusqlite::types::ValueRef::Real(value) => json!(value),
                        rusqlite::types::ValueRef::Text(value) => {
                            Value::String(String::from_utf8_lossy(value).to_string())
                        }
                        rusqlite::types::ValueRef::Blob(value) => {
                            Value::String(tokenomics_hash(&String::from_utf8_lossy(value)))
                        }
                    };
                    object.insert(column.to_string(), value);
                }
                object.insert("replacement".to_string(), json!(true));
                object.insert("operation".to_string(), json!("replace"));
                Ok(Value::Object(object))
            },
        )
        .map_err(|error| format!("Unable to query Tokenomics account daily rows: {error}"))?;
    let mut rollups = Vec::new();
    for row in mapped {
        let mut row =
            row.map_err(|error| format!("Unable to read Tokenomics account daily row: {error}"))?;
        let Some(bucket_start) = row.get("bucket_start").and_then(Value::as_str) else {
            continue;
        };
        let bucket_start_unix =
            tokenomics_timestamp_unix(&format!("{bucket_start}T00:00:00Z")).unwrap_or(0);
        if let Some(object) = row.as_object_mut() {
            object.insert(
                "bucket_start_unix".to_string(),
                json!(bucket_start_unix as i64),
            );
        }
        rollups.push(row);
    }
    Ok(rollups)
}

fn tokenomics_account_hourly_display_rollups(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
    scope_filter: Option<&TokenomicsBillingScope>,
    include_cloud: bool,
) -> Result<Vec<Value>, String> {
    tokenomics_account_hourly_display_rollups_for_range(
        conn,
        since_updated_at,
        scope_filter,
        include_cloud,
        None,
        None,
        TOKENOMICS_SYNC_ROLLUP_LIMIT,
    )
}

fn tokenomics_account_hourly_display_rollups_for_range(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
    scope_filter: Option<&TokenomicsBillingScope>,
    include_cloud: bool,
    start_bucket_hour: Option<&str>,
    end_bucket_hour: Option<&str>,
    limit: usize,
) -> Result<Vec<Value>, String> {
    let clean_since = since_updated_at
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let clean_start_bucket_hour = start_bucket_hour
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let clean_end_bucket_hour = end_bucket_hour
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let table = if include_cloud {
        "tokenomics_display_rollups"
    } else {
        "tokenomics_rollups"
    };
    let account_key_sql = "COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, ''), provider || ':' || agent_kind || ':unknown')";
    let account_label_sql = "COALESCE(NULLIF(provider_account_label, ''), CASE WHEN agent_kind='codex' THEN 'Codex account' WHEN agent_kind='claude' THEN 'Claude account' WHEN agent_kind='opencode' THEN 'OpenCode account' ELSE agent_kind || ' account' END)";
    let model_sql = "COALESCE(NULLIF(model, ''), agent_kind)";
    let scope_type_sql = "COALESCE(NULLIF(billing_scope_type, ''), 'unknown')";
    let scope_team_sql = "NULLIF(billing_team_id, '')";
    let scope_key_sql = "CASE WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='team' AND NULLIF(billing_team_id, '') IS NOT NULL THEN 'team:' || billing_team_id WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='personal' THEN 'personal' ELSE 'unknown' END";
    let scope_label_sql = "CASE WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='team' THEN 'Team' WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='personal' THEN 'Personal' ELSE 'Unknown scope' END";
    let scope_source_sql = "COALESCE(NULLIF(billing_scope_source, ''), 'unknown')";
    let scope_filter_sql = tokenomics_billing_scope_filter_sql(scope_filter, true);
    let mut statement = conn
        .prepare(
            &format!("SELECT
	               'usage-hour:' || hex(device_id || '|' || provider || '|' || agent_kind || '|' || {model_sql} || '|' || {account_key_sql} || '|' || {scope_key_sql} || '|' || bucket_start) AS id,
	               'usage_hour' AS row_kind,
	               device_id,
	               provider,
	               agent_kind,
               {model_sql} AS model,
	               {account_key_sql} AS subscription_key,
	               {account_key_sql} AS provider_account_key,
	               {account_label_sql} AS provider_account_label,
	               {scope_type_sql} AS billing_scope_type,
	               {scope_team_sql} AS billing_team_id,
	               {scope_key_sql} AS billing_scope_key,
	               {scope_label_sql} AS billing_scope_label,
	               MAX({scope_source_sql}) AS billing_scope_source,
	               NULL AS workspace_id,
	               NULL AS repo_path,
	               'hour' AS bucket_width,
	               'UTC' AS bucket_timezone,
	               bucket_start,
	               COALESCE(SUM(input_tokens), 0) AS input_tokens,
               COALESCE(SUM(output_tokens), 0) AS output_tokens,
               COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
               COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
               COALESCE(SUM(CASE WHEN COALESCE(total_tokens, 0) > 0 THEN total_tokens ELSE COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) + COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0) END), 0) AS total_tokens,
               COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd,
               COALESCE(SUM(event_count), 0) AS event_count,
               MAX(updated_at) AS updated_at
		             FROM {table}
			             WHERE bucket_width='hour'
	                   AND TRIM({account_key_sql})!=''
	                   AND LOWER(TRIM({account_key_sql})) NOT LIKE '%:unknown'
			               AND bucket_start GLOB '????-??-??T??:00:00Z'
			               AND (?2 IS NOT NULL OR bucket_start >= strftime('%Y-%m-%dT00:00:00Z', 'now', '-29 days'))
			               AND (?2 IS NULL OR bucket_start >= ?2)
			               AND (?3 IS NULL OR bucket_start < ?3)
			               {scope_filter_sql}
			               AND (?1 IS NULL OR updated_at >= ?1)
		             GROUP BY device_id, provider, agent_kind, {model_sql}, subscription_key, provider_account_key, billing_scope_key, bucket_start
		             ORDER BY updated_at DESC, bucket_start DESC, provider, agent_kind
		             LIMIT ?4"),
        )
        .map_err(|error| format!("Unable to prepare Tokenomics account sync query: {error}"))?;
    let columns = statement
        .column_names()
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let mapped = statement
        .query_map(
            rusqlite::params![
                clean_since,
                clean_start_bucket_hour,
                clean_end_bucket_hour,
                limit as i64
            ],
            |row| {
                let mut object = serde_json::Map::new();
                for (index, column) in columns.iter().enumerate() {
                    let value = match row.get_ref(index)? {
                        rusqlite::types::ValueRef::Null => Value::Null,
                        rusqlite::types::ValueRef::Integer(value) => json!(value),
                        rusqlite::types::ValueRef::Real(value) => json!(value),
                        rusqlite::types::ValueRef::Text(value) => {
                            Value::String(String::from_utf8_lossy(value).to_string())
                        }
                        rusqlite::types::ValueRef::Blob(value) => {
                            Value::String(tokenomics_hash(&String::from_utf8_lossy(value)))
                        }
                    };
                    object.insert(column.to_string(), value);
                }
                object.insert("replacement".to_string(), json!(true));
                object.insert("operation".to_string(), json!("replace"));
                Ok(Value::Object(object))
            },
        )
        .map_err(|error| format!("Unable to query Tokenomics account sync rows: {error}"))?;
    let mut rollups = Vec::new();
    for row in mapped {
        let mut row =
            row.map_err(|error| format!("Unable to read Tokenomics account sync row: {error}"))?;
        let Some(bucket_start) = row.get("bucket_start").and_then(Value::as_str) else {
            continue;
        };
        let Some(bucket_start_unix) = tokenomics_strict_utc_hour_bucket_start_unix(bucket_start)
        else {
            continue;
        };
        if let Some(object) = row.as_object_mut() {
            object.insert(
                "bucket_start_unix".to_string(),
                json!(bucket_start_unix as i64),
            );
        }
        rollups.push(row);
    }
    Ok(rollups)
}

fn tokenomics_provider_limit_sample_bucket_unix(sample_at_unix: u64) -> u64 {
    sample_at_unix
        .checked_div(TOKENOMICS_PROVIDER_LIMIT_SAMPLE_BUCKET_SECS)
        .unwrap_or(0)
        .saturating_mul(TOKENOMICS_PROVIDER_LIMIT_SAMPLE_BUCKET_SECS)
}

fn tokenomics_provider_limit_sample_id(
    device_id: &str,
    provider: &str,
    agent_kind: &str,
    provider_account_key: &str,
    billing_scope: &TokenomicsBillingScope,
    window_kind: &str,
    sample_bucket_unix: u64,
) -> String {
    let raw = format!(
        "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
        device_id,
        billing_scope.scope_type,
        billing_scope.team_id.as_deref().unwrap_or_default(),
        provider,
        agent_kind,
        provider_account_key,
        window_kind,
        sample_bucket_unix
    );
    format!("provider-limit-sample-{}", tokenomics_hash(&raw))
}

fn tokenomics_limit_percent_pair(value: &Value) -> Option<(i64, i64)> {
    let used = tokenomics_value_i64(value, &["used_percent", "limit_used_percent", "used"])
        .map(|percent| percent.clamp(0, 100));
    let remaining = tokenomics_value_i64(
        value,
        &["remaining_percent", "limit_remaining_percent", "remaining"],
    )
    .map(|percent| percent.clamp(0, 100));
    match (used, remaining) {
        (Some(used), Some(remaining)) => Some((used, remaining)),
        (Some(used), None) => Some((used, (100 - used).clamp(0, 100))),
        (None, Some(remaining)) => Some(((100 - remaining).clamp(0, 100), remaining)),
        (None, None) => None,
    }
}

fn tokenomics_provider_limit_sample_reset_at(value: &Value, sample_at_unix: u64) -> Option<String> {
    if let Some(reset_at) =
        tokenomics_value_string(value, &["reset_at", "limit_resets_at", "pace_reset_at"])
            .filter(|text| !text.trim().is_empty())
    {
        return Some(reset_at);
    }
    tokenomics_value_i64(value, &["reset_after_seconds"])
        .filter(|seconds| *seconds >= 0)
        .map(|seconds| tokenomics_unix_iso_like(sample_at_unix.saturating_add(seconds as u64)))
}

fn tokenomics_upsert_provider_limit_sample(
    conn: &rusqlite::Connection,
    value: &Value,
    fallback_scope: &TokenomicsBillingScope,
    fallback_device_id: &str,
    source_override: Option<&str>,
) -> Result<bool, String> {
    let Some((used_percent, remaining_percent)) = tokenomics_limit_percent_pair(value) else {
        return Ok(false);
    };
    let provider =
        tokenomics_value_string(value, &["provider"]).unwrap_or_else(|| "unknown".to_string());
    let agent_kind =
        tokenomics_value_string(value, &["agent_kind"]).unwrap_or_else(|| provider.clone());
    if provider == "unknown" || agent_kind == "unknown" {
        return Ok(false);
    }
    let fallback_account = tokenomics_provider_account(&provider, &agent_kind);
    let provider_account_key =
        tokenomics_value_string(value, &["provider_account_key", "subscription_key"])
            .unwrap_or_else(|| fallback_account.key.clone());
    if tokenomics_provider_account_key_is_unknown(&provider_account_key) {
        return Ok(false);
    }
    let provider_account_label = tokenomics_value_string(value, &["provider_account_label"])
        .unwrap_or_else(|| fallback_account.label.clone());
    let billing_scope = tokenomics_billing_scope_from_value(value, fallback_scope);
    let window_kind = tokenomics_value_string(value, &["window_kind", "limit_kind"])
        .unwrap_or_else(|| "5_hour".to_string());
    let now_unix = tokenomics_unix_now();
    let sample_at = tokenomics_value_string(value, &["sample_at", "updated_at", "last_known_at"])
        .unwrap_or_else(|| tokenomics_unix_iso_like(now_unix));
    let sample_at_unix = tokenomics_value_i64(value, &["sample_at_unix"])
        .map(tokenomics_normalize_unix_timestamp)
        .or_else(|| tokenomics_timestamp_unix(&sample_at))
        .unwrap_or(now_unix);
    let sample_bucket_unix = tokenomics_value_i64(value, &["sample_bucket_unix", "bucket_unix"])
        .map(tokenomics_normalize_unix_timestamp)
        .unwrap_or_else(|| tokenomics_provider_limit_sample_bucket_unix(sample_at_unix));
    let sample_bucket_start =
        tokenomics_value_string(value, &["sample_bucket_start", "bucket_start"])
            .unwrap_or_else(|| tokenomics_unix_iso_like(sample_bucket_unix));
    let updated_at_unix = now_unix;
    let updated_at = tokenomics_unix_iso_like(updated_at_unix);
    let reset_at = tokenomics_provider_limit_sample_reset_at(value, sample_at_unix);
    let reset_after_seconds = tokenomics_value_i64(value, &["reset_after_seconds"]);
    let limit_window_seconds = tokenomics_limit_effective_window_seconds(
        &window_kind,
        tokenomics_value_i64(value, &["limit_window_seconds"]),
    );
    let pace_status = tokenomics_value_string(value, &["pace_status"]).unwrap_or_default();
    let pace_delta_percent = tokenomics_value_i64(value, &["pace_delta_percent"]);
    let source = source_override
        .map(ToOwned::to_owned)
        .or_else(|| tokenomics_value_string(value, &["source", "limit_source"]))
        .unwrap_or_else(|| "local".to_string());
    let confidence =
        tokenomics_value_string(value, &["confidence"]).unwrap_or_else(|| "unknown".to_string());
    let device_id = tokenomics_value_string(value, &["device_id", "machine_id"])
        .unwrap_or_else(|| fallback_device_id.to_string());
    let id = tokenomics_provider_limit_sample_id(
        &device_id,
        &provider,
        &agent_kind,
        &provider_account_key,
        &billing_scope,
        &window_kind,
        sample_bucket_unix,
    );
    let material_changed = match conn.query_row(
        "SELECT provider_account_label, billing_scope_source, sample_bucket_start,
                sample_at, sample_at_unix,
                used_percent, remaining_percent, reset_at, reset_after_seconds,
                limit_window_seconds, pace_status, pace_delta_percent, source, confidence
         FROM tokenomics_provider_limit_samples
         WHERE id=?1",
        rusqlite::params![id.as_str()],
        |row| {
            Ok(
                row.get::<_, Option<String>>(0)? != Some(provider_account_label.clone())
                    || row.get::<_, Option<String>>(1)? != Some(billing_scope.source.clone())
                    || row.get::<_, Option<String>>(2)? != Some(sample_bucket_start.clone())
                    || row.get::<_, Option<String>>(3)? != Some(sample_at.clone())
                    || row.get::<_, Option<i64>>(4)? != Some(sample_at_unix as i64)
                    || row.get::<_, Option<i64>>(5)? != Some(used_percent)
                    || row.get::<_, Option<i64>>(6)? != Some(remaining_percent)
                    || row.get::<_, Option<String>>(7)? != reset_at.clone()
                    || row.get::<_, Option<i64>>(8)? != reset_after_seconds
                    || row.get::<_, Option<i64>>(9)? != Some(limit_window_seconds)
                    || row.get::<_, Option<String>>(10)? != Some(pace_status.clone())
                    || row.get::<_, Option<i64>>(11)? != pace_delta_percent
                    || row.get::<_, Option<String>>(12)? != Some(source.clone())
                    || row.get::<_, Option<String>>(13)? != Some(confidence.clone()),
            )
        },
    ) {
        Ok(changed) => changed,
        Err(rusqlite::Error::QueryReturnedNoRows) => true,
        Err(error) => {
            return Err(format!(
                "Unable to inspect existing Tokenomics provider limit sample: {error}"
            ));
        }
    };

    conn.execute(
        "INSERT INTO tokenomics_provider_limit_samples(
           id, device_id, provider, agent_kind, provider_account_key, provider_account_label,
           billing_scope_type, billing_team_id, billing_scope_source,
           window_kind, sample_bucket_start, sample_bucket_unix, sample_at, sample_at_unix,
           used_percent, remaining_percent, reset_at, reset_after_seconds, limit_window_seconds,
           pace_status, pace_delta_percent, source, confidence, updated_at, updated_at_unix
         ) VALUES(
           ?1, ?2, ?3, ?4, ?5, ?6,
           ?7, ?8, ?9,
           ?10, ?11, ?12, ?13, ?14,
           ?15, ?16, ?17, ?18, ?19,
           ?20, ?21, ?22, ?23, ?24, ?25
         )
         ON CONFLICT(id) DO UPDATE SET
           device_id=excluded.device_id,
           provider_account_label=excluded.provider_account_label,
           billing_scope_source=excluded.billing_scope_source,
           sample_bucket_start=excluded.sample_bucket_start,
           sample_bucket_unix=excluded.sample_bucket_unix,
           sample_at=excluded.sample_at,
           sample_at_unix=excluded.sample_at_unix,
           used_percent=excluded.used_percent,
           remaining_percent=excluded.remaining_percent,
           reset_at=excluded.reset_at,
           reset_after_seconds=excluded.reset_after_seconds,
           limit_window_seconds=excluded.limit_window_seconds,
           pace_status=excluded.pace_status,
           pace_delta_percent=excluded.pace_delta_percent,
           source=excluded.source,
           confidence=excluded.confidence,
           updated_at=excluded.updated_at,
           updated_at_unix=excluded.updated_at_unix
         WHERE excluded.sample_at_unix >= tokenomics_provider_limit_samples.sample_at_unix",
        rusqlite::params![
            id,
            device_id,
            provider,
            agent_kind,
            provider_account_key,
            provider_account_label,
            billing_scope.scope_type.as_str(),
            billing_scope.team_id.as_deref(),
            billing_scope.source.as_str(),
            window_kind,
            sample_bucket_start,
            sample_bucket_unix as i64,
            sample_at,
            sample_at_unix as i64,
            used_percent,
            remaining_percent,
            reset_at.as_deref(),
            reset_after_seconds,
            limit_window_seconds,
            pace_status,
            pace_delta_percent,
            source,
            confidence,
            updated_at,
            updated_at_unix as i64,
        ],
    )
    .map_err(|error| format!("Unable to store provider limit sample: {error}"))?;
    Ok(material_changed)
}

fn tokenomics_prune_provider_limit_samples(
    conn: &rusqlite::Connection,
    now_unix: u64,
) -> Result<(), String> {
    let five_hour_cutoff =
        now_unix.saturating_sub(TOKENOMICS_PROVIDER_LIMIT_SAMPLE_5H_RETENTION_SECS);
    let weekly_cutoff =
        now_unix.saturating_sub(TOKENOMICS_PROVIDER_LIMIT_SAMPLE_WEEKLY_RETENTION_SECS);
    conn.execute(
        "DELETE FROM tokenomics_provider_limit_samples
         WHERE (window_kind='5_hour' AND sample_at_unix < ?1)
            OR (window_kind!='5_hour' AND sample_at_unix < ?2)",
        rusqlite::params![five_hour_cutoff as i64, weekly_cutoff as i64],
    )
    .map_err(|error| format!("Unable to prune provider limit samples: {error}"))?;
    Ok(())
}

fn tokenomics_record_provider_limit_samples(
    conn: &rusqlite::Connection,
    limits: &[Value],
) -> Result<usize, String> {
    let fallback_scope = tokenomics_current_billing_scope();
    let device_id = tokenomics_local_device_id();
    let mut count = 0usize;
    for limit in limits.iter().take(32) {
        if tokenomics_provider_limit_is_unknown(limit)
            || tokenomics_provider_limit_is_dormant_cached(limit)
        {
            continue;
        }
        if tokenomics_upsert_provider_limit_sample(
            conn,
            limit,
            &fallback_scope,
            &device_id,
            Some("local"),
        )? {
            count += 1;
        }
    }
    tokenomics_prune_provider_limit_samples(conn, tokenomics_unix_now())?;
    Ok(count)
}

fn tokenomics_provider_limit_sample_sync_rows(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
    scope_filter: Option<&TokenomicsBillingScope>,
) -> Result<Vec<Value>, String> {
    tokenomics_provider_limit_sample_rows(conn, since_updated_at, scope_filter, false)
}

fn tokenomics_provider_limit_sample_sync_rows_for_range(
    conn: &rusqlite::Connection,
    scope_filter: Option<&TokenomicsBillingScope>,
    start_unix: u64,
    end_unix: u64,
) -> Result<Vec<Value>, String> {
    tokenomics_provider_limit_sample_rows_for_range(
        conn,
        None,
        scope_filter,
        false,
        Some(start_unix),
        Some(end_unix),
        TOKENOMICS_PROVIDER_LIMIT_SAMPLE_SYNC_LIMIT,
    )
}

fn tokenomics_provider_limit_sample_rows(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
    scope_filter: Option<&TokenomicsBillingScope>,
    include_cloud: bool,
) -> Result<Vec<Value>, String> {
    tokenomics_provider_limit_sample_rows_for_range(
        conn,
        since_updated_at,
        scope_filter,
        include_cloud,
        None,
        None,
        TOKENOMICS_PROVIDER_LIMIT_SAMPLE_SYNC_LIMIT,
    )
}

fn tokenomics_provider_limit_sample_rows_for_range(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
    scope_filter: Option<&TokenomicsBillingScope>,
    include_cloud: bool,
    start_unix: Option<u64>,
    end_unix: Option<u64>,
    limit: usize,
) -> Result<Vec<Value>, String> {
    let clean_since = since_updated_at
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let scope_filter_sql = tokenomics_billing_scope_filter_sql(scope_filter, true);
    let cloud_filter_sql = if include_cloud {
        tokenomics_cloud_relay_sample_filter_sql(conn)?
    } else {
        " AND source!='cloud'".to_string()
    };
    let scope_type_sql = "COALESCE(NULLIF(billing_scope_type, ''), 'unknown')";
    let scope_team_sql = "NULLIF(billing_team_id, '')";
    let scope_key_sql = "CASE WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='team' AND NULLIF(billing_team_id, '') IS NOT NULL THEN 'team:' || billing_team_id WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='personal' THEN 'personal' ELSE 'unknown' END";
    let scope_label_sql = "CASE WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='team' THEN 'Team' WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='personal' THEN 'Personal' ELSE 'Unknown scope' END";
    let mut statement = conn
        .prepare(&format!(
            "SELECT
               id,
               device_id,
               provider,
               agent_kind,
               provider_account_key AS subscription_key,
               provider_account_key,
               provider_account_label,
               {scope_type_sql} AS billing_scope_type,
               {scope_team_sql} AS billing_team_id,
               {scope_key_sql} AS billing_scope_key,
               {scope_label_sql} AS billing_scope_label,
               COALESCE(NULLIF(billing_scope_source, ''), 'unknown') AS billing_scope_source,
               window_kind,
               sample_bucket_start,
               sample_bucket_unix,
               sample_at,
               sample_at_unix,
               used_percent,
               remaining_percent,
               reset_at,
               reset_after_seconds,
               limit_window_seconds,
               pace_status,
               pace_delta_percent,
               source,
               confidence,
               updated_at
             FROM tokenomics_provider_limit_samples
	             WHERE (?1 IS NULL OR updated_at >= ?1)
	               AND TRIM(COALESCE(provider_account_key, ''))!=''
	               AND LOWER(TRIM(provider_account_key)) NOT LIKE '%:unknown'
	               AND (?2 IS NULL OR sample_at_unix >= ?2)
	               AND (?3 IS NULL OR sample_at_unix < ?3)
	               {scope_filter_sql}
	               {cloud_filter_sql}
	             ORDER BY updated_at DESC, sample_bucket_unix DESC
	             LIMIT ?4"
        ))
        .map_err(|error| format!("Unable to prepare provider limit sample query: {error}"))?;
    let columns = statement
        .column_names()
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let mapped = statement
        .query_map(
            rusqlite::params![
                clean_since,
                start_unix.map(|value| value.min(i64::MAX as u64) as i64),
                end_unix.map(|value| value.min(i64::MAX as u64) as i64),
                limit as i64
            ],
            |row| {
                let mut object = serde_json::Map::new();
                for (index, column) in columns.iter().enumerate() {
                    let value = match row.get_ref(index)? {
                        rusqlite::types::ValueRef::Null => Value::Null,
                        rusqlite::types::ValueRef::Integer(value) => json!(value),
                        rusqlite::types::ValueRef::Real(value) => json!(value),
                        rusqlite::types::ValueRef::Text(value) => {
                            Value::String(String::from_utf8_lossy(value).to_string())
                        }
                        rusqlite::types::ValueRef::Blob(value) => {
                            Value::String(tokenomics_hash(&String::from_utf8_lossy(value)))
                        }
                    };
                    object.insert(column.to_string(), value);
                }
                Ok(Value::Object(object))
            },
        )
        .map_err(|error| format!("Unable to query provider limit samples: {error}"))?;
    let mut rows = Vec::new();
    for row in mapped {
        rows.push(
            row.map_err(|error| format!("Unable to read provider limit sample row: {error}"))?,
        );
    }
    Ok(rows)
}

fn tokenomics_recent_provider_limit_samples_for_limit(
    conn: &rusqlite::Connection,
    limit: &Value,
) -> Result<Vec<Value>, String> {
    let fallback_scope = tokenomics_current_billing_scope();
    let billing_scope = tokenomics_billing_scope_from_value(limit, &fallback_scope);
    let provider =
        tokenomics_value_string(limit, &["provider"]).unwrap_or_else(|| "unknown".to_string());
    let agent_kind =
        tokenomics_value_string(limit, &["agent_kind"]).unwrap_or_else(|| provider.clone());
    let fallback_account = tokenomics_provider_account(&provider, &agent_kind);
    let provider_account_key =
        tokenomics_value_string(limit, &["provider_account_key", "subscription_key"])
            .unwrap_or_else(|| fallback_account.key);
    if tokenomics_provider_account_key_is_unknown(&provider_account_key) {
        return Ok(Vec::new());
    }
    let window_kind = tokenomics_value_string(limit, &["window_kind", "limit_kind"])
        .unwrap_or_else(|| "5_hour".to_string());
    let device_id =
        tokenomics_value_string(limit, &["device_id", "machine_id"]).unwrap_or_default();
    let now_unix = tokenomics_unix_now();
    let retention = if window_kind == "weekly" {
        TOKENOMICS_PROVIDER_LIMIT_SAMPLE_WEEKLY_RETENTION_SECS
    } else {
        TOKENOMICS_PROVIDER_LIMIT_SAMPLE_5H_RETENTION_SECS
    };
    let cutoff = now_unix.saturating_sub(retention);
    let mut statement = conn
        .prepare(
            "SELECT
               id,
               device_id,
               provider,
               agent_kind,
               provider_account_key,
               provider_account_label,
               billing_scope_type,
               billing_team_id,
               billing_scope_source,
               window_kind,
               sample_bucket_start,
               sample_bucket_unix,
               sample_at,
               sample_at_unix,
               used_percent,
               remaining_percent,
               reset_at,
               reset_after_seconds,
               limit_window_seconds,
               pace_status,
               pace_delta_percent,
               source,
               confidence,
               updated_at
             FROM tokenomics_provider_limit_samples
             WHERE billing_scope_type=?1
               AND COALESCE(billing_team_id, '')=?2
               AND provider=?3
               AND agent_kind=?4
               AND provider_account_key=?5
               AND window_kind=?6
               AND (?7 = '' OR device_id=?7)
               AND sample_at_unix >= ?8
             ORDER BY sample_at_unix ASC
             LIMIT 384",
        )
        .map_err(|error| format!("Unable to prepare provider limit trajectory query: {error}"))?;
    let columns = statement
        .column_names()
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let mapped = statement
        .query_map(
            rusqlite::params![
                billing_scope.scope_type.as_str(),
                billing_scope.team_id.as_deref().unwrap_or_default(),
                provider,
                agent_kind,
                provider_account_key,
                window_kind,
                device_id,
                cutoff as i64,
            ],
            |row| {
                let mut object = serde_json::Map::new();
                for (index, column) in columns.iter().enumerate() {
                    let value = match row.get_ref(index)? {
                        rusqlite::types::ValueRef::Null => Value::Null,
                        rusqlite::types::ValueRef::Integer(value) => json!(value),
                        rusqlite::types::ValueRef::Real(value) => json!(value),
                        rusqlite::types::ValueRef::Text(value) => {
                            Value::String(String::from_utf8_lossy(value).to_string())
                        }
                        rusqlite::types::ValueRef::Blob(value) => {
                            Value::String(tokenomics_hash(&String::from_utf8_lossy(value)))
                        }
                    };
                    object.insert(column.to_string(), value);
                }
                Ok(Value::Object(object))
            },
        )
        .map_err(|error| format!("Unable to query provider limit trajectory rows: {error}"))?;
    let mut rows = Vec::new();
    for row in mapped {
        rows.push(
            row.map_err(|error| format!("Unable to read provider limit trajectory row: {error}"))?,
        );
    }
    Ok(rows)
}

fn tokenomics_apply_provider_limit_sample_pacing(
    conn: &rusqlite::Connection,
    limits: &mut [Value],
) -> Result<(), String> {
    for limit in limits {
        let samples = tokenomics_recent_provider_limit_samples_for_limit(conn, limit)?;
        tokenomics_apply_provider_limit_sample_pacing_from_rows(limit, &samples);
    }
    Ok(())
}

fn tokenomics_apply_provider_limit_sample_pacing_from_rows(limit: &mut Value, samples: &[Value]) {
    if samples.is_empty() {
        return;
    }
    let latest = samples
        .iter()
        .rev()
        .find(|sample| tokenomics_limit_percent_pair(sample).is_some());
    let Some(latest) = latest else {
        return;
    };
    let Some((latest_used, latest_remaining)) = tokenomics_limit_percent_pair(latest) else {
        return;
    };
    let latest_sample_at_unix = tokenomics_value_i64(latest, &["sample_at_unix"])
        .map(tokenomics_normalize_unix_timestamp)
        .or_else(|| {
            tokenomics_value_string(latest, &["sample_at"])
                .and_then(|value| tokenomics_timestamp_unix(&value))
        })
        .unwrap_or_else(tokenomics_unix_now);
    let window_kind = tokenomics_value_string(limit, &["window_kind", "limit_kind"])
        .unwrap_or_else(|| "5_hour".to_string());
    let window_seconds = tokenomics_limit_effective_window_seconds(
        &window_kind,
        tokenomics_value_i64(latest, &["limit_window_seconds"])
            .or_else(|| tokenomics_value_i64(limit, &["limit_window_seconds"])),
    )
    .max(1) as u64;
    let reset_at_text = tokenomics_value_string(latest, &["reset_at"])
        .or_else(|| tokenomics_provider_limit_sample_reset_at(latest, latest_sample_at_unix))
        .or_else(|| {
            tokenomics_value_string(limit, &["reset_at"])
                .or_else(|| tokenomics_provider_limit_sample_reset_at(limit, latest_sample_at_unix))
        });
    let reset_at_unix = reset_at_text
        .as_deref()
        .and_then(tokenomics_timestamp_unix)
        .or_else(|| {
            tokenomics_value_i64(latest, &["reset_after_seconds"])
                .filter(|seconds| *seconds >= 0)
                .map(|seconds| latest_sample_at_unix.saturating_add(seconds as u64))
        });
    let remaining_seconds_at_sample = reset_at_unix
        .map(|reset_at| {
            reset_at
                .saturating_sub(latest_sample_at_unix)
                .min(window_seconds)
        })
        .or_else(|| {
            tokenomics_value_i64(latest, &["reset_after_seconds"])
                .filter(|seconds| *seconds >= 0)
                .map(|seconds| (seconds as u64).min(window_seconds))
        });
    let now_unix = tokenomics_unix_now();
    if reset_at_unix
        .map(|reset_at| reset_at <= now_unix)
        .unwrap_or(false)
        || remaining_seconds_at_sample == Some(0)
    {
        return;
    }
    let live_updated_at_unix = tokenomics_value_string(limit, &["updated_at", "last_known_at"])
        .and_then(|value| tokenomics_timestamp_unix(&value))
        .unwrap_or(latest_sample_at_unix);
    let live_age_seconds = now_unix.saturating_sub(live_updated_at_unix);
    let mut status = "unknown".to_string();
    let mut projected_used_percent = None::<i64>;
    let mut projected_exhaustion_seconds = None::<i64>;
    let mut projected_exhaustion_at = None::<String>;
    let mut pace_delta_percent = None::<i64>;
    let mut sample_window_seconds = 0_i64;
    let mut trajectory_sample_count = 1_i64;

    if let Some(remaining_seconds) = remaining_seconds_at_sample {
        let reset_at_matches = |sample: &Value| {
            if let Some(latest_reset) = reset_at_text.as_deref().filter(|text| !text.is_empty()) {
                tokenomics_value_string(sample, &["reset_at"])
                    .map(|value| value == latest_reset)
                    .unwrap_or(false)
            } else {
                true
            }
        };
        let earliest = samples
            .iter()
            .filter(|sample| reset_at_matches(sample))
            .filter_map(|sample| {
                let (used, _) = tokenomics_limit_percent_pair(sample)?;
                let sample_at = tokenomics_value_i64(sample, &["sample_at_unix"])
                    .map(tokenomics_normalize_unix_timestamp)
                    .or_else(|| {
                        tokenomics_value_string(sample, &["sample_at"])
                            .and_then(|value| tokenomics_timestamp_unix(&value))
                    })?;
                if sample_at >= latest_sample_at_unix {
                    return None;
                }
                let elapsed = latest_sample_at_unix.saturating_sub(sample_at);
                if elapsed < 60 || elapsed > window_seconds {
                    return None;
                }
                Some((sample_at, used))
            })
            .next();
        if let Some((earliest_at, earliest_used)) = earliest {
            let elapsed = latest_sample_at_unix.saturating_sub(earliest_at).max(1);
            let gained_percent = (latest_used - earliest_used).max(0) as f64;
            let percent_per_second = gained_percent / elapsed as f64;
            let projected = latest_used as f64 + percent_per_second * remaining_seconds as f64;
            let projected = projected.round().clamp(0.0, 999.0) as i64;
            projected_used_percent = Some(projected);
            pace_delta_percent = Some(projected - 100);
            status = if projected >= 100 {
                "over_pace".to_string()
            } else {
                "on_pace".to_string()
            };
            sample_window_seconds = elapsed.min(i64::MAX as u64) as i64;
            trajectory_sample_count = samples
                .iter()
                .filter(|sample| reset_at_matches(sample))
                .filter(|sample| {
                    tokenomics_value_i64(sample, &["sample_at_unix"])
                        .map(tokenomics_normalize_unix_timestamp)
                        .map(|sample_at| {
                            sample_at >= earliest_at && sample_at <= latest_sample_at_unix
                        })
                        .unwrap_or(false)
                })
                .count()
                .max(2) as i64;
            if projected >= 100 && percent_per_second > 0.0 && latest_used < 100 {
                let seconds_to_full =
                    ((100 - latest_used) as f64 / percent_per_second).ceil() as u64;
                projected_exhaustion_seconds = Some(seconds_to_full.min(i64::MAX as u64) as i64);
                projected_exhaustion_at = Some(tokenomics_unix_iso_like(
                    latest_sample_at_unix.saturating_add(seconds_to_full),
                ));
            } else if latest_used >= 100 {
                projected_exhaustion_seconds = Some(0);
                projected_exhaustion_at = Some(tokenomics_unix_iso_like(latest_sample_at_unix));
            }
        }
    }

    let Some(object) = limit.as_object_mut() else {
        return;
    };
    if tokenomics_limit_percent_pair(&Value::Object(object.clone())).is_none()
        || tokenomics_provider_limit_is_unknown(&Value::Object(object.clone()))
    {
        object.insert("used".to_string(), json!(latest_used));
        object.insert("allowance".to_string(), json!(100));
        object.insert("remaining".to_string(), json!(latest_remaining));
        object.insert("used_percent".to_string(), json!(latest_used));
        object.insert("limit_used_percent".to_string(), json!(latest_used));
        object.insert("remaining_percent".to_string(), json!(latest_remaining));
        object.insert("last_known_at".to_string(), latest["sample_at"].clone());
        object.insert("confidence".to_string(), json!("sampled_stale"));
        object.insert(
            "limit_source_kind".to_string(),
            json!("provider_limit_sample"),
        );
        if object
            .get("limit_source")
            .and_then(Value::as_str)
            .unwrap_or("")
            .contains("unavailable")
        {
            object.insert("limit_source".to_string(), json!("provider_limit_sample"));
        }
        if let Some(reset_at) = reset_at_text.as_deref() {
            object.insert("reset_at".to_string(), json!(reset_at));
        }
        if let Some(remaining_seconds) = remaining_seconds_at_sample {
            object.insert(
                "reset_after_seconds".to_string(),
                json!(remaining_seconds as i64),
            );
        }
        object.insert(
            "limit_window_seconds".to_string(),
            json!(window_seconds.min(i64::MAX as u64) as i64),
        );
    }

    object.insert("pace_strategy".to_string(), json!("live_10s_with_samples"));
    object.insert(
        "pace_confidence".to_string(),
        json!(if live_age_seconds <= 30 {
            "live"
        } else if live_age_seconds <= 300 {
            "recent"
        } else {
            "stale"
        }),
    );
    object.insert(
        "pace_sample_count".to_string(),
        json!(trajectory_sample_count),
    );
    object.insert(
        "pace_sample_window_seconds".to_string(),
        json!(sample_window_seconds),
    );
    object.insert(
        "pace_last_sample_at".to_string(),
        latest["sample_at"].clone(),
    );
    object.insert(
        "pace_last_sample_used_percent".to_string(),
        json!(latest_used),
    );
    if let Some(projected) = projected_used_percent {
        let delta = pace_delta_percent.unwrap_or(projected - 100);
        object.insert("pace_trajectory_status".to_string(), json!(status.clone()));
        object.insert("pace_trajectory_delta_percent".to_string(), json!(delta));
        object.insert(
            "pace_trajectory_projected_used_percent".to_string(),
            json!(projected),
        );
        object.insert(
            "pace_trajectory_projected_exhaustion_seconds".to_string(),
            json!(projected_exhaustion_seconds),
        );
        object.insert(
            "pace_trajectory_projected_exhaustion_at".to_string(),
            json!(projected_exhaustion_at),
        );
        let current_projected = tokenomics_value_i64(
            &Value::Object(object.clone()),
            &["pace_projected_used_percent"],
        )
        .unwrap_or(-1);
        let current_status =
            tokenomics_value_string(&Value::Object(object.clone()), &["pace_status"])
                .unwrap_or_else(|| "unknown".to_string());
        if live_age_seconds > 30
            || status == "over_pace"
            || projected > current_projected
            || current_status == "unknown"
        {
            object.insert("pace_strategy".to_string(), json!("sample_trajectory"));
            object.insert("pace_status".to_string(), json!(status.clone()));
            object.insert("pace_delta_percent".to_string(), json!(delta));
            object.insert("pace_projected_used_percent".to_string(), json!(projected));
            object.insert(
                "pace_projected_exhaustion_seconds".to_string(),
                json!(projected_exhaustion_seconds),
            );
            object.insert(
                "pace_projected_exhaustion_at".to_string(),
                json!(projected_exhaustion_at),
            );
        }
    }
}

fn tokenomics_sync_delta_from_conn(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
    scope_filter: Option<&TokenomicsBillingScope>,
) -> Result<Value, String> {
    tokenomics_sync_delta_from_conn_with_limit_sampling(conn, since_updated_at, scope_filter, true)
}

fn tokenomics_sync_delta_from_conn_with_limit_sampling(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
    scope_filter: Option<&TokenomicsBillingScope>,
    record_limit_samples: bool,
) -> Result<Value, String> {
    let clean_since = since_updated_at
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let hourly = {
        let _span = BackendCpuSpan::new("tokenomics.sync_delta.hourly_sync_rollups");
        tokenomics_account_hourly_sync_rollups(conn, clean_since, scope_filter)?
    };
    let mut limits = {
        let _span = BackendCpuSpan::new("tokenomics.sync_delta.provider_limits");
        tokenomics_meta_json(conn, TOKENOMICS_DAEMON_PROVIDER_LIMITS_KEY)
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default()
    };
    if record_limit_samples {
        let _span = BackendCpuSpan::new("tokenomics.sync_delta.record_samples");
        let _ = tokenomics_record_provider_limit_samples(conn, &limits);
        tokenomics_apply_provider_limit_sample_pacing(conn, &mut limits)?;
        tokenomics_record_latest_windows(conn, &limits)?;
    } else {
        let _span = BackendCpuSpan::new("tokenomics.sync_delta.record_samples");
        tokenomics_apply_provider_limit_sample_pacing(conn, &mut limits)?;
        tokenomics_record_latest_windows(conn, &limits)?;
    }
    {
        let _span = BackendCpuSpan::new("tokenomics.sync_delta.provider_accounts_refresh");
        tokenomics_refresh_provider_accounts_from_usage(conn)?;
    }
    let retired_account_keys = tokenomics_retired_provider_account_keys(conn);
    let mut provider_accounts = {
        let _span = BackendCpuSpan::new("tokenomics.sync_delta.provider_account_rows");
        tokenomics_provider_account_rows(conn, clean_since, scope_filter)?
    };
    tokenomics_retain_active_account_rows(&mut provider_accounts, &retired_account_keys);
    let mut latest_windows = {
        let _span = BackendCpuSpan::new("tokenomics.sync_delta.latest_window_rows");
        tokenomics_latest_window_rows(conn, clean_since, scope_filter)?
    };
    tokenomics_retain_active_account_rows(&mut latest_windows, &retired_account_keys);
    let mut limit_samples = {
        let _span = BackendCpuSpan::new("tokenomics.sync_delta.limit_sample_sync_rows");
        tokenomics_provider_limit_sample_sync_rows(conn, clean_since, scope_filter)?
    };
    tokenomics_retain_active_account_rows(&mut limit_samples, &retired_account_keys);
    let sync_cursor = hourly
        .iter()
        .chain(provider_accounts.iter())
        .chain(latest_windows.iter())
        .chain(limit_samples.iter())
        .filter_map(|row| row.get("updated_at").and_then(Value::as_str))
        .max()
        .map(ToOwned::to_owned)
        .or_else(|| clean_since.map(ToOwned::to_owned));
    let hourly_count = hourly.len();
    let provider_account_count = provider_accounts.len();
    let latest_window_count = latest_windows.len();
    let limit_sample_count = limit_samples.len();
    let aliases = tokenomics_local_device_aliases(conn)?;
    Ok(json!({
      "known": hourly_count > 0 || provider_account_count > 0 || latest_window_count > 0 || limit_sample_count > 0,
      "source": "rust_local_tokenomics_sqlite_delta_v2",
    "schema_version": "tokenomics_v2",
    "updated_at": tokenomics_now_iso_like(),
    "current_device_id": tokenomics_local_device_id(),
    "current_device_name": tokenomics_local_device_name(),
    "sync_cursor": sync_cursor,
    "device_aliases": aliases,
    "hourly_count": hourly_count,
      "provider_account_count": provider_account_count,
      "latest_window_count": latest_window_count,
      "limit_sample_count": limit_sample_count,
      "hourly": hourly,
      "provider_accounts": provider_accounts,
      "latest_windows": latest_windows,
      "limit_samples": limit_samples,
      "limits": limits,
      }))
}

fn tokenomics_sync_delta_for_day_from_conn(
    conn: &rusqlite::Connection,
    scope_filter: Option<&TokenomicsBillingScope>,
    day_start_ms: i64,
) -> Result<Value, String> {
    let day_start_unix = ((day_start_ms.max(0) as u64) / 1000)
        .checked_div(86_400)
        .unwrap_or(0)
        .saturating_mul(86_400);
    let next_day_unix = day_start_unix.saturating_add(86_400);
    let (_, start_bucket_hour) = tokenomics_utc_hour_bucket_from_unix(day_start_unix);
    let (_, end_bucket_hour) = tokenomics_utc_hour_bucket_from_unix(next_day_unix);
    let hourly = tokenomics_account_hourly_display_rollups_for_range(
        conn,
        None,
        scope_filter,
        false,
        Some(&start_bucket_hour),
        Some(&end_bucket_hour),
        TOKENOMICS_SYNC_ROLLUP_LIMIT,
    )?;
    let mut limit_samples = tokenomics_provider_limit_sample_sync_rows_for_range(
        conn,
        scope_filter,
        day_start_unix,
        next_day_unix,
    )?;
    let retired_account_keys = tokenomics_retired_provider_account_keys(conn);
    tokenomics_retain_active_account_rows(&mut limit_samples, &retired_account_keys);
    let sync_cursor = hourly
        .iter()
        .chain(limit_samples.iter())
        .filter_map(|row| row.get("updated_at").and_then(Value::as_str))
        .max()
        .map(ToOwned::to_owned);
    let hourly_count = hourly.len();
    let limit_sample_count = limit_samples.len();
    Ok(json!({
        "known": hourly_count > 0 || limit_sample_count > 0,
        "source": "rust_local_tokenomics_sqlite_day_delta_v1",
        "schema_version": "tokenomics_v2",
        "updated_at": tokenomics_now_iso_like(),
        "current_device_id": tokenomics_local_device_id(),
        "current_device_name": tokenomics_local_device_name(),
        "sync_cursor": sync_cursor,
        "hourly_count": hourly_count,
        "limit_sample_count": limit_sample_count,
        "hourly": hourly,
        "latest_windows": [],
        "limit_samples": limit_samples,
        "limits": [],
    }))
}

fn tokenomics_historical_prune_ack_candidate_days(
    conn: &rusqlite::Connection,
    scope_filter: &TokenomicsBillingScope,
    older_than_day_start_ms: i64,
    after_day_start_ms: Option<i64>,
    limit: usize,
) -> Result<Vec<i64>, String> {
    let older_than_unix = ((older_than_day_start_ms.max(0) as u64) / 1000)
        .checked_div(86_400)
        .unwrap_or(0)
        .saturating_mul(86_400);
    let (_, older_than_hour) = tokenomics_utc_hour_bucket_from_unix(older_than_unix);
    let after_hour = after_day_start_ms.filter(|value| *value >= 0).map(|value| {
        let after_unix = ((value as u64) / 1000)
            .checked_div(86_400)
            .unwrap_or(0)
            .saturating_mul(86_400)
            .saturating_add(86_400);
        let (_, hour) = tokenomics_utc_hour_bucket_from_unix(after_unix);
        hour
    });
    let scope_key = tokenomics_billing_scope_key(
        scope_filter.scope_type.as_str(),
        scope_filter.team_id.as_deref(),
    );
    let mut statement = conn
        .prepare(
            "SELECT substr(r.bucket_start, 1, 10) AS bucket_day
             FROM tokenomics_rollups r
             LEFT JOIN tokenomics_meta day_ack
               ON day_ack.key=?1 || ?2 || ':' || substr(r.bucket_start, 1, 10)
              AND NULLIF(day_ack.value, '') IS NOT NULL
             WHERE r.bucket_width='hour'
               AND r.bucket_start GLOB '????-??-??T??:00:00Z'
               AND r.bucket_start < ?3
               AND (?4 IS NULL OR r.bucket_start >= ?4)
               AND COALESCE(NULLIF(r.billing_scope_type, ''), 'unknown')=?5
               AND COALESCE(r.billing_team_id, '')=?6
               AND day_ack.key IS NULL
             GROUP BY bucket_day
             ORDER BY bucket_day ASC
             LIMIT ?7",
        )
        .map_err(|error| {
            format!("Unable to prepare historical Tokenomics prune ack days: {error}")
        })?;
    let rows = statement
        .query_map(
            rusqlite::params![
                TOKENOMICS_USAGE_EVENT_PRUNE_ACK_DAY_META_PREFIX,
                scope_key.as_str(),
                older_than_hour.as_str(),
                after_hour.as_deref(),
                scope_filter.scope_type.as_str(),
                scope_filter.team_id.as_deref().unwrap_or_default(),
                limit as i64,
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| {
            format!("Unable to query historical Tokenomics prune ack days: {error}")
        })?;
    let mut days = Vec::new();
    for row in rows {
        let day = row.map_err(|error| {
            format!("Unable to read historical Tokenomics prune ack day: {error}")
        })?;
        if let Some(day_unix) = tokenomics_timestamp_unix(&format!("{day}T00:00:00Z")) {
            days.push(day_unix.min((i64::MAX as u64) / 1000).saturating_mul(1000) as i64);
        }
    }
    Ok(days)
}

/// Every UTC day (oldest first) that has hourly rollup rows for the scope,
/// as (day_key, day_start_ms). Unlike the historical prune-ack candidates
/// this does NOT exclude days with local ack metadata: cloud-coverage
/// reconciliation must see every day the device can republish, because a
/// local ack can outlive cloud facts that were never durably checkpointed
/// (the post-B2-refactor deploy wipe).
fn tokenomics_all_rollup_day_starts(
    conn: &rusqlite::Connection,
    scope_filter: &TokenomicsBillingScope,
    older_than_day_start_ms: i64,
) -> Result<Vec<(String, i64)>, String> {
    let older_than_unix = ((older_than_day_start_ms.max(0) as u64) / 1000)
        .checked_div(86_400)
        .unwrap_or(0)
        .saturating_mul(86_400);
    let (_, older_than_hour) = tokenomics_utc_hour_bucket_from_unix(older_than_unix);
    let mut statement = conn
        .prepare(
            "SELECT substr(bucket_start, 1, 10) AS bucket_day
             FROM tokenomics_rollups
             WHERE bucket_width='hour'
               AND bucket_start GLOB '????-??-??T??:00:00Z'
               AND bucket_start < ?1
               AND COALESCE(NULLIF(billing_scope_type, ''), 'unknown')=?2
               AND COALESCE(billing_team_id, '')=?3
             GROUP BY bucket_day
             ORDER BY bucket_day ASC",
        )
        .map_err(|error| format!("Unable to prepare Tokenomics rollup day listing: {error}"))?;
    let rows = statement
        .query_map(
            rusqlite::params![
                older_than_hour.as_str(),
                scope_filter.scope_type.as_str(),
                scope_filter.team_id.as_deref().unwrap_or_default(),
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| format!("Unable to query Tokenomics rollup days: {error}"))?;
    let mut days = Vec::new();
    for row in rows {
        let day = row.map_err(|error| format!("Unable to read Tokenomics rollup day: {error}"))?;
        if let Some(day_unix) = tokenomics_timestamp_unix(&format!("{day}T00:00:00Z")) {
            days.push((
                day,
                day_unix.min((i64::MAX as u64) / 1000).saturating_mul(1000) as i64,
            ));
        }
    }
    Ok(days)
}

fn tokenomics_store_cloud_provider_limits(
    conn: &rusqlite::Connection,
    summary: &Value,
    inherited_billing_scope: &TokenomicsBillingScope,
    inherited_device_id: Option<&str>,
    local_device_ids: &HashSet<String>,
) -> Result<usize, String> {
    let incoming = summary
        .get("limits")
        .or_else(|| summary.get("provider_limits"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if incoming.is_empty() {
        return Ok(0);
    }

    let mut hydrated = Vec::new();
    for limit in incoming.into_iter().take(128) {
        let mut limit = tokenomics_account_usage_fields_stripped(&limit);
        let Some(device_id) = tokenomics_remote_cloud_device_id_from_value(
            &limit,
            inherited_device_id,
            local_device_ids,
        ) else {
            continue;
        };
        if let Some(object) = limit.as_object_mut() {
            object
                .entry("billing_scope_type".to_string())
                .or_insert_with(|| json!(inherited_billing_scope.scope_type.as_str()));
            if let Some(team_id) = inherited_billing_scope.team_id.as_deref() {
                object
                    .entry("billing_team_id".to_string())
                    .or_insert_with(|| json!(team_id));
                object
                    .entry("team_id".to_string())
                    .or_insert_with(|| json!(team_id));
            }
            object
                .entry("billing_scope_source".to_string())
                .or_insert_with(|| json!(inherited_billing_scope.source.as_str()));
            object
                .entry("limit_source_kind".to_string())
                .or_insert_with(|| json!("cloud_last_known"));
            object.insert("device_id".to_string(), json!(device_id.as_str()));
        }
        hydrated.push(limit);
    }
    if hydrated.is_empty() {
        return Ok(0);
    }

    let previous = tokenomics_cloud_provider_limits(conn)?;
    let merged = tokenomics_merge_provider_limits(previous, hydrated);
    let stored_count = merged.len();
    tokenomics_store_cloud_provider_limits_raw(conn, &merged)?;
    Ok(stored_count)
}

fn tokenomics_store_cloud_provider_limit_samples(
    conn: &rusqlite::Connection,
    summary: &Value,
    inherited_billing_scope: &TokenomicsBillingScope,
    inherited_device_id: Option<&str>,
    local_device_ids: &HashSet<String>,
) -> Result<usize, String> {
    let incoming = summary
        .get("limit_samples")
        .or_else(|| summary.get("provider_limit_samples"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if incoming.is_empty() {
        return Ok(0);
    }
    let mut stored_count = 0usize;
    for sample in incoming
        .iter()
        .take(TOKENOMICS_PROVIDER_LIMIT_SAMPLE_SYNC_LIMIT)
    {
        let Some(device_id) = tokenomics_remote_cloud_device_id_from_value(
            sample,
            inherited_device_id,
            local_device_ids,
        ) else {
            continue;
        };
        let mut sample = sample.clone();
        if let Some(object) = sample.as_object_mut() {
            object.insert("device_id".to_string(), json!(device_id.as_str()));
        }
        if tokenomics_upsert_provider_limit_sample(
            conn,
            &sample,
            inherited_billing_scope,
            &device_id,
            Some("cloud"),
        )? {
            stored_count += 1;
        }
    }
    tokenomics_prune_provider_limit_samples(conn, tokenomics_unix_now())?;
    Ok(stored_count)
}

fn tokenomics_cloud_summary_payload(event: &Value) -> Value {
    if let Some(account_state) = tokenomics_account_device_live_state_payload(event) {
        if let Some(summary) = tokenomics_flatten_account_devices_usage(account_state) {
            return summary;
        }
    }
    let summary = event
        .get("summary")
        .or_else(|| event.get("tokenomics_delta"))
        .or_else(|| event.get("snapshot"))
        .or_else(|| event.get("delta").filter(|value| value.is_object()))
        .or_else(|| {
            event
                .get("payload")
                .and_then(|payload| payload.get("summary"))
        })
        .or_else(|| {
            event
                .get("payload")
                .and_then(|payload| payload.get("tokenomics_delta"))
        })
        .or_else(|| {
            event
                .get("payload")
                .and_then(|payload| payload.get("snapshot"))
        })
        .or_else(|| {
            event
                .get("payload")
                .and_then(|payload| payload.get("delta"))
                .filter(|value| value.is_object())
        })
        .or_else(|| event.get("data").and_then(|data| data.get("summary")))
        .or_else(|| {
            event
                .get("data")
                .and_then(|data| data.get("tokenomics_delta"))
        })
        .or_else(|| event.get("data").and_then(|data| data.get("snapshot")))
        .or_else(|| {
            event
                .get("data")
                .and_then(|data| data.get("delta"))
                .filter(|value| value.is_object())
        })
        .or_else(|| {
            event
                .get("payload")
                .filter(|payload| tokenomics_cloud_relay_summary_like(payload))
        })
        .or_else(|| {
            event
                .get("data")
                .filter(|data| tokenomics_cloud_relay_summary_like(data))
        })
        .cloned()
        .unwrap_or_else(|| event.clone());
    if let Some(flattened) = tokenomics_flatten_account_devices_usage(&summary) {
        return flattened;
    }
    tokenomics_normalize_cloud_relay_summary(&summary)
}

fn tokenomics_cloud_relay_summary_like(value: &Value) -> bool {
    value.get("hourly").is_some()
        || value.get("devices").is_some()
        || value.get("hourly_groups").is_some()
        || value.get("windows").is_some()
        || value.get("limits").is_some()
        || value.get("provider_accounts").is_some()
}

fn tokenomics_normalize_cloud_relay_summary(summary: &Value) -> Value {
    let has_hourly_groups = summary.get("hourly_groups").is_some();
    let has_windows = summary.get("windows").is_some();
    if !has_hourly_groups && !has_windows {
        return tokenomics_account_usage_fields_stripped(summary);
    }

    let mut normalized = summary.as_object().cloned().unwrap_or_default();
    for key in [
        "credits",
        "crediting",
        "credit_sources",
        "creditSources",
        "credit_source_rows",
        "creditSourceRows",
        "wallet",
        "billingStatus",
        "billing_status",
        "accountUsage",
        "account_usage",
        "storage",
        "storage_usage",
        "storageUsage",
    ] {
        normalized.remove(key);
    }
    let inherited_device_id = tokenomics_text_field(summary, &["device_id", "machine_id"]);
    let account_labels = tokenomics_cloud_relay_provider_account_labels(summary);

    let mut hourly = summary
        .get("hourly")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut hourly_group_replacements = summary
        .get("hourly_group_replacements")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for group in tokenomics_v2_collection_values(summary.get("hourly_groups")) {
        let Some(bucket_ms) = tokenomics_value_i64(group, &["bucket_start_ms"]) else {
            continue;
        };
        let Some(bucket_start) = tokenomics_hour_bucket_from_ms(bucket_ms) else {
            continue;
        };
        if let Some(device_id) = inherited_device_id.as_deref() {
            hourly_group_replacements.push(json!({
                "device_id": device_id,
                "bucket_start": bucket_start,
                "bucket_start_ms": bucket_ms,
                "updated_at": tokenomics_v2_ms_value_to_iso(
                    group,
                    &["observed_at_ms", "group_generation"],
                ).unwrap_or_else(tokenomics_now_iso_like),
            }));
        }
        let updated_at =
            tokenomics_v2_ms_value_to_iso(group, &["observed_at_ms", "group_generation"])
                .unwrap_or_else(tokenomics_now_iso_like);
        let rows = group
            .get("rows")
            .or_else(|| group.get("items"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for row in rows {
            if let Some(flat) = tokenomics_cloud_relay_hourly_group_row(
                &row,
                inherited_device_id.as_deref(),
                &bucket_start,
                &updated_at,
                &account_labels,
            ) {
                hourly.push(flat);
            }
        }
    }

    let mut limits = summary
        .get("limits")
        .or_else(|| summary.get("provider_limits"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut limit_samples = summary
        .get("limit_samples")
        .or_else(|| summary.get("provider_limit_samples"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for window in tokenomics_v2_collection_values(summary.get("windows")) {
        if let Some(row) = tokenomics_cloud_relay_window_row(
            window,
            inherited_device_id.as_deref(),
            &account_labels,
        ) {
            limits.push(row.clone());
            limit_samples.push(row);
        }
    }

    normalized.insert("hourly".to_string(), json!(hourly));
    normalized.insert(
        "hourly_group_replacements".to_string(),
        json!(hourly_group_replacements),
    );
    normalized.insert("limits".to_string(), json!(limits));
    normalized.insert("limit_samples".to_string(), json!(limit_samples));
    Value::Object(normalized)
}

fn tokenomics_cloud_relay_provider_account_labels(summary: &Value) -> HashMap<String, String> {
    let mut labels = HashMap::new();
    let Some(accounts) = summary.get("provider_accounts") else {
        return labels;
    };
    match accounts {
        Value::Object(map) => {
            for (key, account) in map {
                if let Some(label) = tokenomics_text_field(
                    account,
                    &["provider_account_label", "label", "display_name"],
                ) {
                    labels.insert(key.clone(), label);
                }
            }
        }
        Value::Array(items) => {
            for account in items {
                let Some(key) = tokenomics_text_field(
                    account,
                    &["provider_account_key", "subscription_key", "key"],
                ) else {
                    continue;
                };
                if let Some(label) = tokenomics_text_field(
                    account,
                    &["provider_account_label", "label", "display_name"],
                ) {
                    labels.insert(key, label);
                }
            }
        }
        _ => {}
    }
    labels
}

fn tokenomics_cloud_relay_account_label(
    row: &Value,
    account_key: &str,
    provider: &str,
    agent_kind: &str,
    account_labels: &HashMap<String, String>,
) -> String {
    tokenomics_text_field(row, &["provider_account_label", "label", "display_name"])
        .or_else(|| account_labels.get(account_key).cloned())
        .unwrap_or_else(|| tokenomics_provider_account(provider, agent_kind).label)
}

fn tokenomics_cloud_relay_hourly_group_row(
    row: &Value,
    inherited_device_id: Option<&str>,
    bucket_start: &str,
    updated_at: &str,
    account_labels: &HashMap<String, String>,
) -> Option<Value> {
    let device_id = tokenomics_text_field(row, &["device_id", "machine_id"])
        .or_else(|| inherited_device_id.map(str::to_string));
    let provider =
        tokenomics_value_string(row, &["provider"]).unwrap_or_else(|| "unknown".to_string());
    let agent_kind =
        tokenomics_value_string(row, &["agent_kind"]).unwrap_or_else(|| provider.clone());
    let account_key = tokenomics_value_string(
        row,
        &["provider_account_key", "subscription_key", "account_key"],
    )
    .unwrap_or_else(|| tokenomics_provider_account(&provider, &agent_kind).key);
    let label = tokenomics_cloud_relay_account_label(
        row,
        &account_key,
        &provider,
        &agent_kind,
        account_labels,
    );
    let input_tokens = tokenomics_value_i64(row, &["input", "input_tokens"])
        .unwrap_or(0)
        .max(0);
    let output_tokens = tokenomics_value_i64(row, &["output", "output_tokens"])
        .unwrap_or(0)
        .max(0);
    let cache_read_tokens = tokenomics_value_i64(row, &["cache_read", "cache_read_tokens"])
        .unwrap_or(0)
        .max(0);
    let cache_write_tokens = tokenomics_value_i64(row, &["cache_write", "cache_write_tokens"])
        .unwrap_or(0)
        .max(0);
    let reported_total = tokenomics_value_i64(row, &["total", "total_tokens"])
        .unwrap_or(0)
        .max(0);
    let total_tokens = if reported_total > 0 {
        reported_total
    } else {
        input_tokens
            .saturating_add(output_tokens)
            .saturating_add(cache_read_tokens)
            .saturating_add(cache_write_tokens)
    };
    let estimated_cost_microusd = tokenomics_value_i64(
        row,
        &[
            "estimated_cost_microusd",
            "provider_cost_microusd",
            "cost_microusd",
            "cost",
        ],
    )
    .unwrap_or(0)
    .max(0);
    let model = tokenomics_value_string(row, &["model"]).unwrap_or_else(|| agent_kind.clone());
    Some(json!({
        "device_id": device_id,
        "provider": provider,
        "agent_kind": agent_kind,
        "model": model,
        "provider_account_key": account_key.clone(),
        "subscription_key": account_key,
        "provider_account_label": label,
        "bucket_width": "hour",
        "bucket_start": bucket_start,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_read_tokens": cache_read_tokens,
        "cache_write_tokens": cache_write_tokens,
        "total_tokens": total_tokens,
        "estimated_cost_microusd": estimated_cost_microusd,
        "provider_cost_microusd": estimated_cost_microusd,
        "cost": estimated_cost_microusd,
        "event_count": tokenomics_value_i64(row, &["events", "event_count"]).unwrap_or(0).max(0),
        "updated_at": updated_at,
    }))
}

fn tokenomics_cloud_relay_window_row(
    window: &Value,
    inherited_device_id: Option<&str>,
    account_labels: &HashMap<String, String>,
) -> Option<Value> {
    let device_id = tokenomics_text_field(window, &["device_id", "machine_id"])
        .or_else(|| inherited_device_id.map(str::to_string));
    let provider =
        tokenomics_value_string(window, &["provider"]).unwrap_or_else(|| "unknown".to_string());
    let agent_kind =
        tokenomics_value_string(window, &["agent_kind"]).unwrap_or_else(|| provider.clone());
    let account_key = tokenomics_value_string(
        window,
        &["provider_account_key", "subscription_key", "account_key"],
    )
    .unwrap_or_else(|| tokenomics_provider_account(&provider, &agent_kind).key);
    let label = tokenomics_cloud_relay_account_label(
        window,
        &account_key,
        &provider,
        &agent_kind,
        account_labels,
    );
    let window_kind = tokenomics_value_string(window, &["window_kind", "limit_kind", "window"])
        .unwrap_or_else(|| "5_hour".to_string());
    let mut row = tokenomics_v2_window_row(
        window,
        &window_kind,
        device_id.as_deref().unwrap_or_default(),
        &provider,
        &agent_kind,
        &account_key,
        &label,
    )?;
    if let Some(object) = row.as_object_mut() {
        if let Some(device_id) = device_id {
            object.insert("device_id".to_string(), json!(device_id.as_str()));
        }
    }
    Some(row)
}

fn tokenomics_cloud_account_sync_cursor_key(scope_key: &str) -> String {
    let scope_key = scope_key.trim();
    let scope_key = if scope_key.is_empty() {
        "personal"
    } else {
        scope_key
    };
    format!("{TOKENOMICS_CLOUD_ACCOUNT_SYNC_CURSOR_KEY_PREFIX}{scope_key}")
}

fn tokenomics_cloud_account_scope_key(
    event: &Value,
    summary: &Value,
    fallback: &TokenomicsBillingScope,
) -> String {
    tokenomics_value_string(summary, &["scope_key", "billing_scope_key"])
        .or_else(|| tokenomics_value_string(event, &["scope_key", "billing_scope_key"]))
        .unwrap_or_else(|| {
            tokenomics_billing_scope_key(&fallback.scope_type, fallback.team_id.as_deref())
        })
}

fn tokenomics_cloud_summary_sync_cursor(event: &Value, summary: &Value) -> Option<String> {
    tokenomics_value_string(summary, &["server_cursor", "sync_cursor", "cursor"])
        .or_else(|| tokenomics_value_string(event, &["server_cursor", "sync_cursor", "cursor"]))
}

fn tokenomics_store_cloud_account_sync_cursor(
    conn: &rusqlite::Connection,
    scope_key: &str,
    cursor: &str,
) -> Result<(), String> {
    let cursor = cursor.trim();
    if cursor.is_empty() {
        return Ok(());
    }
    conn.execute(
        "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES(?1, ?2)",
        rusqlite::params![tokenomics_cloud_account_sync_cursor_key(scope_key), cursor],
    )
    .map_err(|error| format!("Unable to store cloud Tokenomics sync cursor: {error}"))?;
    Ok(())
}

fn tokenomics_account_device_live_state_payload(event: &Value) -> Option<&Value> {
    let event_kind = tokenomics_text_field(event, &["event_kind", "kind"]).unwrap_or_default();
    let payload = event.get("payload");
    let data = event.get("data");
    let candidates = [
        event.get("summary"),
        data.and_then(|value| value.get("summary")),
        payload.and_then(|value| value.get("summary")),
        data,
        event.get("account_live_state"),
        payload.and_then(|value| value.get("data")),
        payload.and_then(|value| value.get("account_live_state")),
        Some(event),
    ];
    for candidate in candidates.into_iter().flatten() {
        let has_device_usage = tokenomics_account_device_usage_entries(candidate)
            .into_iter()
            .next()
            .is_some();
        if has_device_usage {
            return Some(candidate);
        }
    }
    if event_kind == "account_device_live_state_snapshot" {
        event
            .get("summary")
            .or(data)
            .or_else(|| event.get("account_live_state"))
            .or(Some(event))
    } else {
        None
    }
}

fn tokenomics_flatten_account_devices_usage(account_state: &Value) -> Option<Value> {
    let local_device_id = tokenomics_local_device_id();
    let mut hourly = Vec::new();
    let mut hourly_group_replacements = Vec::new();
    let mut limits = Vec::new();
    let mut limit_samples = Vec::new();
    let mut device_identities = Vec::new();
    let mut device_count = 0usize;
    for (device_id, tokenomics) in tokenomics_account_device_usage_entries(account_state) {
        if device_id == local_device_id || tokenomics_cloud_relay_placeholder_device_id(&device_id)
        {
            continue;
        }
        if tokenomics_account_device_is_removed(account_state, &device_id, &tokenomics) {
            continue;
        }
        device_count += 1;
        if let Some(identity) =
            tokenomics_account_device_identity(account_state, &device_id, &tokenomics)
        {
            device_identities.push(identity);
        }
        let summary = tokenomics
            .get("summary")
            .filter(|value| value.is_object())
            .unwrap_or(&tokenomics);
        let added_v2 = tokenomics_extend_v2_device_usage(
            &mut hourly,
            &mut hourly_group_replacements,
            &mut limits,
            &mut limit_samples,
            account_state,
            summary,
            &device_id,
        );
        if !added_v2 {
            tokenomics_extend_device_rows(&mut hourly, summary.get("hourly"), &device_id);
            tokenomics_extend_device_rows(&mut limits, summary.get("limits"), &device_id);
            if let Some(value) = summary.get("limit_samples") {
                tokenomics_extend_device_rows(&mut limit_samples, Some(value), &device_id);
            }
            tokenomics_extend_device_rows(
                &mut device_identities,
                summary.get("device_identities"),
                &device_id,
            );
        }
    }
    if device_count == 0 && hourly.is_empty() && limits.is_empty() && limit_samples.is_empty() {
        return None;
    }
    let mut result = json!({
        "known": true,
        "source": "account_device_live_state_snapshot",
        "updated_at": tokenomics_now_iso_like(),
        "remote_device_count": device_count,
        "hourly": hourly,
        "hourly_group_replacements": hourly_group_replacements,
        "limits": limits,
        "limit_samples": limit_samples,
        "device_identities": device_identities,
    });
    if let Some(object) = result.as_object_mut() {
        for key in [
            "server_cursor",
            "sync_cursor",
            "scope_key",
            "billing_scope_type",
            "team_id",
            "is_delta",
        ] {
            if let Some(value) = account_state.get(key) {
                object.insert(key.to_string(), value.clone());
            }
        }
    }
    Some(result)
}

fn tokenomics_tombstoned_cloud_account_device_ids(
    event: &Value,
    local_device_ids: &HashSet<String>,
) -> HashSet<String> {
    let mut tombstoned = HashSet::new();
    let Some(account_state) = tokenomics_account_device_live_state_payload(event) else {
        return tombstoned;
    };
    for (device_id, tokenomics) in tokenomics_account_device_usage_entries(account_state) {
        if !tokenomics_is_remote_cloud_device_id(&device_id, local_device_ids) {
            continue;
        }
        if tokenomics_account_device_is_removed(account_state, &device_id, &tokenomics) {
            tombstoned.insert(device_id);
        }
    }
    tombstoned
}

fn tokenomics_account_device_is_removed(
    account_state: &Value,
    device_id: &str,
    tokenomics: &Value,
) -> bool {
    let removed_fields = ["removed_at", "deleted_at", "tombstoned_at"];
    if removed_fields.iter().any(|key| {
        tokenomics
            .get(*key)
            .and_then(tokenomics_json_scalar_text)
            .is_some_and(|value| !value.trim().is_empty())
    }) {
        return true;
    }
    if let Some(device) = tokenomics_account_state_device(account_state, device_id) {
        if removed_fields.iter().any(|key| {
            device
                .get(*key)
                .and_then(tokenomics_json_scalar_text)
                .is_some_and(|value| !value.trim().is_empty())
        }) {
            return true;
        }
        let status = tokenomics_text_field(device, &["status", "state"]).unwrap_or_default();
        if matches!(status.as_str(), "removed" | "deleted" | "tombstoned") {
            return true;
        }
    }
    false
}

fn tokenomics_extend_v2_device_usage(
    hourly: &mut Vec<Value>,
    hourly_group_replacements: &mut Vec<Value>,
    limits: &mut Vec<Value>,
    limit_samples: &mut Vec<Value>,
    account_state: &Value,
    summary: &Value,
    device_id: &str,
) -> bool {
    let account_labels = tokenomics_cloud_relay_provider_account_labels(summary);
    let mut added = tokenomics_extend_v2_device_hourly_groups(
        hourly,
        hourly_group_replacements,
        summary,
        device_id,
        &account_labels,
    );
    let has_hourly_groups = added;
    let Some(accounts) = summary.get("provider_accounts") else {
        return added;
    };
    match accounts {
        Value::Object(map) => {
            for (account_key, account) in map {
                added |= tokenomics_extend_v2_provider_account_usage(
                    hourly,
                    limits,
                    limit_samples,
                    account_state,
                    account_key,
                    account,
                    device_id,
                    !has_hourly_groups,
                );
            }
        }
        Value::Array(items) => {
            for account in items {
                let account_key = tokenomics_text_field(
                    account,
                    &["provider_account_key", "subscription_key", "account_key"],
                )
                .unwrap_or_else(|| "unknown".to_string());
                added |= tokenomics_extend_v2_provider_account_usage(
                    hourly,
                    limits,
                    limit_samples,
                    account_state,
                    &account_key,
                    account,
                    device_id,
                    !has_hourly_groups,
                );
            }
        }
        _ => {}
    }
    added
}

fn tokenomics_extend_v2_device_hourly_groups(
    hourly: &mut Vec<Value>,
    hourly_group_replacements: &mut Vec<Value>,
    summary: &Value,
    device_id: &str,
    account_labels: &HashMap<String, String>,
) -> bool {
    let mut added = false;
    for group in tokenomics_v2_collection_values(summary.get("hourly_groups")) {
        let Some(bucket_ms) = tokenomics_value_i64(group, &["bucket_start_ms"]) else {
            continue;
        };
        let Some(bucket_start) = tokenomics_hour_bucket_from_ms(bucket_ms) else {
            continue;
        };
        let updated_at =
            tokenomics_v2_ms_value_to_iso(group, &["observed_at_ms", "group_generation"])
                .unwrap_or_else(tokenomics_now_iso_like);
        hourly_group_replacements.push(json!({
            "device_id": device_id,
            "bucket_start": bucket_start,
            "bucket_start_ms": bucket_ms,
            "updated_at": updated_at,
        }));
        let rows = group
            .get("rows")
            .or_else(|| group.get("items"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for row in rows {
            if let Some(flat) = tokenomics_cloud_relay_hourly_group_row(
                &row,
                Some(device_id),
                &bucket_start,
                &updated_at,
                account_labels,
            ) {
                hourly.push(flat);
            }
        }
        added = true;
    }
    added
}

fn tokenomics_extend_v2_provider_account_usage(
    hourly: &mut Vec<Value>,
    limits: &mut Vec<Value>,
    limit_samples: &mut Vec<Value>,
    account_state: &Value,
    account_key: &str,
    account: &Value,
    device_id: &str,
    include_hourly: bool,
) -> bool {
    let root_account = tokenomics_v2_root_provider_account(account_state, account_key);
    let (fallback_provider, fallback_agent) =
        tokenomics_provider_agent_from_account_key(account_key);
    let provider = tokenomics_v2_account_text(account, root_account, &["provider"])
        .unwrap_or(fallback_provider);
    let agent_kind = tokenomics_v2_account_text(account, root_account, &["agent_kind"])
        .unwrap_or_else(|| fallback_agent.unwrap_or_else(|| provider.clone()));
    let provider_account_label = tokenomics_v2_account_text(
        account,
        root_account,
        &["provider_account_label", "label", "display_name"],
    )
    .unwrap_or_else(|| tokenomics_provider_account(&provider, &agent_kind).label);
    let provider_account_key = if account_key.trim().is_empty() {
        tokenomics_v2_account_text(account, root_account, &["provider_account_key"])
            .unwrap_or_else(|| tokenomics_provider_account(&provider, &agent_kind).key)
    } else {
        account_key.trim().to_string()
    };

    let mut added = false;
    if include_hourly {
        for row in tokenomics_v2_collection_values(account.get("hourly")) {
            if let Some(row) = tokenomics_v2_hourly_row(
                row,
                device_id,
                &provider,
                &agent_kind,
                &provider_account_key,
                &provider_account_label,
            ) {
                hourly.push(row);
                added = true;
            }
        }
    }

    if let Some(windows) = account.get("windows").or_else(|| account.get("latest")) {
        match windows {
            Value::Object(map) => {
                for (window_kind, window) in map {
                    if let Some(row) = tokenomics_v2_window_row(
                        window,
                        window_kind,
                        device_id,
                        &provider,
                        &agent_kind,
                        &provider_account_key,
                        &provider_account_label,
                    ) {
                        limit_samples.push(row.clone());
                        limits.push(row);
                        added = true;
                    }
                }
            }
            Value::Array(items) => {
                for window in items {
                    let window_kind = tokenomics_text_field(window, &["window_kind", "limit_kind"])
                        .unwrap_or_else(|| "5_hour".to_string());
                    if let Some(row) = tokenomics_v2_window_row(
                        window,
                        &window_kind,
                        device_id,
                        &provider,
                        &agent_kind,
                        &provider_account_key,
                        &provider_account_label,
                    ) {
                        limit_samples.push(row.clone());
                        limits.push(row);
                        added = true;
                    }
                }
            }
            _ => {}
        }
    }
    added
}

fn tokenomics_v2_root_provider_account<'a>(
    account_state: &'a Value,
    account_key: &str,
) -> Option<&'a Value> {
    let root = account_state.get("provider_accounts")?;
    match root {
        Value::Object(map) => map.get(account_key),
        Value::Array(items) => items.iter().find(|item| {
            tokenomics_text_field(
                item,
                &["provider_account_key", "subscription_key", "account_key"],
            )
            .as_deref()
                == Some(account_key)
        }),
        _ => None,
    }
}

fn tokenomics_v2_account_text(
    account: &Value,
    root_account: Option<&Value>,
    keys: &[&str],
) -> Option<String> {
    tokenomics_text_field(account, keys)
        .or_else(|| root_account.and_then(|root| tokenomics_text_field(root, keys)))
}

fn tokenomics_provider_agent_from_account_key(account_key: &str) -> (String, Option<String>) {
    let mut parts = account_key
        .split(':')
        .map(str::trim)
        .filter(|part| !part.is_empty());
    let provider = parts.next().unwrap_or("unknown").to_string();
    let agent = parts.next().map(ToOwned::to_owned);
    (provider, agent)
}

fn tokenomics_v2_collection_values(value: Option<&Value>) -> Vec<&Value> {
    match value {
        Some(Value::Array(items)) => items.iter().collect(),
        Some(Value::Object(map)) => map.values().collect(),
        _ => Vec::new(),
    }
}

fn tokenomics_v2_hourly_row(
    row: &Value,
    device_id: &str,
    provider: &str,
    agent_kind: &str,
    provider_account_key: &str,
    provider_account_label: &str,
) -> Option<Value> {
    let bucket_ms = tokenomics_value_i64(row, &["bucket_start_ms"]).or_else(|| {
        tokenomics_value_string(row, &["bucket_start"])
            .and_then(|value| tokenomics_timestamp_unix(&value))
            .map(|seconds| seconds.saturating_mul(1000) as i64)
    })?;
    let bucket_start = tokenomics_hour_bucket_from_ms(bucket_ms)?;
    let input_tokens = tokenomics_value_i64(row, &["input", "input_tokens"])
        .unwrap_or(0)
        .max(0);
    let output_tokens = tokenomics_value_i64(row, &["output", "output_tokens"])
        .unwrap_or(0)
        .max(0);
    let cache_read_tokens = tokenomics_value_i64(row, &["cache_read", "cache_read_tokens"])
        .unwrap_or(0)
        .max(0);
    let cache_write_tokens = tokenomics_value_i64(row, &["cache_write", "cache_write_tokens"])
        .unwrap_or(0)
        .max(0);
    let total_tokens = tokenomics_value_i64(row, &["total", "total_tokens"])
        .unwrap_or_else(|| {
            input_tokens
                .saturating_add(output_tokens)
                .saturating_add(cache_read_tokens)
                .saturating_add(cache_write_tokens)
        })
        .max(0);
    let estimated_cost_microusd = tokenomics_value_i64(
        row,
        &[
            "estimated_cost_microusd",
            "provider_cost_microusd",
            "cost_microusd",
            "cost",
        ],
    )
    .unwrap_or(0)
    .max(0);
    let updated_at = tokenomics_v2_ms_value_to_iso(row, &["server_seq", "observed_at_ms"])
        .unwrap_or_else(tokenomics_now_iso_like);
    Some(json!({
        "device_id": device_id,
        "provider": provider,
        "agent_kind": agent_kind,
        "model": tokenomics_value_string(row, &["model"]).unwrap_or_else(|| agent_kind.to_string()),
        "provider_account_key": provider_account_key,
        "subscription_key": provider_account_key,
        "provider_account_label": provider_account_label,
        "bucket_width": "hour",
        "bucket_start": bucket_start,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_read_tokens": cache_read_tokens,
        "cache_write_tokens": cache_write_tokens,
        "total_tokens": total_tokens,
        "estimated_cost_microusd": estimated_cost_microusd,
        "provider_cost_microusd": estimated_cost_microusd,
        "cost": estimated_cost_microusd,
        "event_count": tokenomics_value_i64(row, &["events", "event_count"]).unwrap_or(0).max(0),
        "attribution_kind": tokenomics_value_string(row, &["attribution", "attribution_kind"]).unwrap_or_else(|| "token_based".to_string()),
        "updated_at": updated_at,
    }))
}

fn tokenomics_v2_window_row(
    window: &Value,
    raw_window_kind: &str,
    device_id: &str,
    provider: &str,
    agent_kind: &str,
    provider_account_key: &str,
    provider_account_label: &str,
) -> Option<Value> {
    let used_percent =
        tokenomics_value_i64(window, &["used_percent", "used"]).map(|value| value.clamp(0, 100));
    let remaining_percent = tokenomics_value_i64(window, &["remaining_percent", "remaining"])
        .map(|value| value.clamp(0, 100));
    if used_percent.is_none() && remaining_percent.is_none() {
        return None;
    }
    let window_kind = tokenomics_v2_display_window_kind(
        tokenomics_value_string(window, &["window_kind", "limit_kind"])
            .as_deref()
            .unwrap_or(raw_window_kind),
    );
    let observed_ms = tokenomics_value_i64(window, &["observed_at_ms", "server_seq"])
        .unwrap_or_else(|| (tokenomics_unix_now().saturating_mul(1000)) as i64);
    let sample_at_unix = tokenomics_normalize_unix_timestamp(observed_ms);
    let sample_at = tokenomics_iso_from_unix(sample_at_unix);
    let reset_at_ms = tokenomics_value_i64(window, &["reset_at_ms"]);
    let reset_at = reset_at_ms
        .map(tokenomics_normalize_unix_timestamp)
        .filter(|seconds| *seconds > 0)
        .map(tokenomics_iso_from_unix);
    let reset_after_seconds =
        reset_at_ms.map(|reset| reset.saturating_sub(observed_ms).max(0) / 1000);
    let limit_window_seconds = tokenomics_limit_effective_window_seconds(&window_kind, None);
    Some(json!({
        "device_id": device_id,
        "source_device_id": tokenomics_value_string(window, &["source_device_id"]).unwrap_or_else(|| device_id.to_string()),
        "provider": provider,
        "agent_kind": agent_kind,
        "provider_account_key": provider_account_key,
        "subscription_key": provider_account_key,
        "provider_account_label": provider_account_label,
        "window_kind": window_kind,
        "limit_kind": window_kind,
        "used_percent": used_percent,
        "remaining_percent": remaining_percent,
        "sample_at": sample_at,
        "sample_at_unix": sample_at_unix as i64,
        "updated_at": sample_at,
        "reset_at": reset_at,
        "reset_after_seconds": reset_after_seconds,
        "limit_window_seconds": limit_window_seconds,
        "source": tokenomics_value_string(window, &["source", "limit_source"]).unwrap_or_else(|| "cloud_v2".to_string()),
        "limit_source": tokenomics_value_string(window, &["source", "limit_source"]).unwrap_or_else(|| "cloud_v2".to_string()),
        "confidence": tokenomics_value_string(window, &["confidence"]).unwrap_or_else(|| "cloud".to_string()),
    }))
}

fn tokenomics_v2_display_window_kind(window_kind: &str) -> String {
    match window_kind.trim().to_ascii_lowercase().as_str() {
        "session_5h" | "5-hour" | "5h" | "five_hour" | "five-hour" => "5_hour".to_string(),
        "weekly" | "week" | "7_day" | "seven_day" => "weekly".to_string(),
        other => other.to_string(),
    }
}

fn tokenomics_v2_ms_value_to_iso(value: &Value, keys: &[&str]) -> Option<String> {
    tokenomics_value_i64(value, keys)
        .map(tokenomics_normalize_unix_timestamp)
        .filter(|seconds| *seconds > 0)
        .map(tokenomics_iso_from_unix)
}

fn tokenomics_hour_bucket_from_ms(value: i64) -> Option<String> {
    let seconds = tokenomics_normalize_unix_timestamp(value);
    (seconds > 0).then(|| tokenomics_utc_hour_bucket_from_unix(seconds).1)
}

fn tokenomics_iso_from_unix(seconds: u64) -> String {
    let (year, month, day, hour, minute, second) = tokenomics_utc_datetime_from_unix(seconds);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn tokenomics_account_device_usage_entries(account_state: &Value) -> Vec<(String, Value)> {
    let mut entries = Vec::new();
    let Some(value) = account_state.get("devices") else {
        return entries;
    };
    match value {
        Value::Object(devices) => {
            for (device_id, device) in devices {
                let clean_device_id = tokenomics_clean_device_id(device_id)
                    .or_else(|| tokenomics_device_id_from_tokenomics_payload(device));
                if let (Some(device_id), Some(tokenomics)) =
                    (clean_device_id, device.get("tokenomics"))
                {
                    entries.push((device_id, tokenomics.clone()));
                }
            }
        }
        Value::Array(devices) => {
            for device in devices {
                if let (Some(device_id), Some(tokenomics)) = (
                    tokenomics_device_id_from_tokenomics_payload(device),
                    device.get("tokenomics"),
                ) {
                    entries.push((device_id, tokenomics.clone()));
                }
            }
        }
        _ => {}
    }
    entries
}

fn tokenomics_device_id_from_tokenomics_payload(value: &Value) -> Option<String> {
    tokenomics_text_field(value, &["device_id", "machine_id"])
        .or_else(|| {
            value
                .get("device")
                .and_then(|device| tokenomics_text_field(device, &["device_id", "machine_id"]))
        })
        .or_else(|| {
            value.get("summary").and_then(|summary| {
                tokenomics_text_field(summary, &["current_device_id", "device_id"])
            })
        })
        .and_then(|device_id| tokenomics_clean_device_id(&device_id))
}

fn tokenomics_account_device_identity(
    account_state: &Value,
    device_id: &str,
    tokenomics: &Value,
) -> Option<Value> {
    let mut object = serde_json::Map::new();
    object.insert("device_id".to_string(), json!(device_id));
    object.insert("machine_id".to_string(), json!(device_id));
    if let Some(device) = tokenomics.get("device").filter(|value| value.is_object()) {
        if let Some(device_object) = device.as_object() {
            for (key, value) in device_object {
                object.entry(key.clone()).or_insert_with(|| value.clone());
            }
        }
    }
    if let Some(device) = tokenomics_account_state_device(account_state, device_id) {
        if let Some(device_object) = device.as_object() {
            for (key, value) in device_object {
                object.entry(key.clone()).or_insert_with(|| value.clone());
            }
        }
    }
    let summary = tokenomics
        .get("summary")
        .filter(|value| value.is_object())
        .unwrap_or(tokenomics);
    for key in [
        "current_device_name",
        "device_name",
        "machine_name",
        "platform",
        "form_factor",
    ] {
        if let Some(value) = summary.get(key) {
            object
                .entry(key.to_string())
                .or_insert_with(|| value.clone());
        }
    }
    let display_name = tokenomics_device_identity_label(&Value::Object(object.clone()))
        .unwrap_or_else(|| tokenomics_generic_device_label(device_id));
    object
        .entry("display_name".to_string())
        .or_insert_with(|| Value::String(display_name.clone()));
    let device_name = object
        .get("display_name")
        .cloned()
        .unwrap_or_else(|| Value::String(display_name));
    object
        .entry("device_name".to_string())
        .or_insert(device_name);
    object
        .entry("source".to_string())
        .or_insert_with(|| json!("account_device_live_state"));
    object
        .entry("updated_at".to_string())
        .or_insert_with(tokenomics_now_iso_like_value);
    Some(Value::Object(object))
}

fn tokenomics_account_state_device<'a>(
    account_state: &'a Value,
    device_id: &str,
) -> Option<&'a Value> {
    let devices = account_state.get("devices")?;
    match devices {
        Value::Object(items) => items.get(device_id),
        Value::Array(items) => items.iter().find(|device| {
            tokenomics_device_id_from_tokenomics_payload(device).as_deref() == Some(device_id)
        }),
        _ => None,
    }
}

fn tokenomics_now_iso_like_value() -> Value {
    Value::String(tokenomics_now_iso_like())
}

fn tokenomics_extend_device_rows(rows: &mut Vec<Value>, value: Option<&Value>, device_id: &str) {
    let Some(value) = value else {
        return;
    };
    match value {
        Value::Array(items) => {
            for item in items {
                if let Some(row) = tokenomics_hydrate_device_row(item, device_id) {
                    rows.push(row);
                }
            }
        }
        Value::Object(items) => {
            for item in items.values() {
                if let Some(row) = tokenomics_hydrate_device_row(item, device_id) {
                    rows.push(row);
                }
            }
        }
        _ => {}
    }
}

fn tokenomics_hydrate_device_row(row: &Value, device_id: &str) -> Option<Value> {
    let mut object = row.as_object().cloned()?;
    for key in [
        "credits",
        "crediting",
        "credit_sources",
        "creditSources",
        "credit_source_rows",
        "creditSourceRows",
        "wallet",
        "billingStatus",
        "billing_status",
        "accountUsage",
        "account_usage",
        "storage",
        "storage_usage",
        "storageUsage",
    ] {
        object.remove(key);
    }
    object
        .entry("device_id".to_string())
        .or_insert_with(|| json!(device_id));
    Some(Value::Object(object))
}

fn tokenomics_cloud_rollup_id(
    device_id: &str,
    provider: &str,
    agent_kind: &str,
    model: Option<&str>,
    provider_account_key: &str,
    billing_scope_type: &str,
    billing_team_id: Option<&str>,
    bucket_width: &str,
    bucket_start: &str,
) -> String {
    let raw = format!(
        "{device_id}\u{1f}{provider}\u{1f}{agent_kind}\u{1f}{}\u{1f}{provider_account_key}\u{1f}{billing_scope_type}\u{1f}{}\u{1f}{bucket_width}\u{1f}{bucket_start}",
        model.unwrap_or("agent"),
        billing_team_id.unwrap_or_default()
    );
    format!("cloud-tokenomics-{}", tokenomics_hash(&raw))
}

fn tokenomics_refresh_cloud_daily_rollups(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM tokenomics_cloud_rollups WHERE bucket_width='day'",
        [],
    )
    .map_err(|error| format!("Unable to clear cached cloud Tokenomics day rows: {error}"))?;
    Ok(())
}

fn tokenomics_remove_cloud_provider_limits_for_devices(
    conn: &rusqlite::Connection,
    device_ids: &HashSet<String>,
) -> Result<(), String> {
    if device_ids.is_empty() {
        return Ok(());
    }
    let previous = tokenomics_cloud_provider_limits_raw(conn)?;
    if previous.is_empty() {
        return Ok(());
    }
    let filtered = previous
        .into_iter()
        .filter(|row| {
            tokenomics_value_string(row, &["device_id", "machine_id"])
                .map(|device_id| !device_ids.contains(device_id.trim()))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    tokenomics_store_cloud_provider_limits_raw(conn, &filtered)
}

fn tokenomics_delete_cloud_device_facts(
    conn: &rusqlite::Connection,
    device_id: &str,
) -> Result<(), String> {
    let device_id = device_id.trim();
    if device_id.is_empty() {
        return Ok(());
    }
    conn.execute(
        "DELETE FROM tokenomics_cloud_rollups WHERE device_id=?1",
        rusqlite::params![device_id],
    )
    .map_err(|error| format!("Unable to clear cached cloud Tokenomics rows: {error}"))?;
    conn.execute(
        "DELETE FROM tokenomics_provider_limit_samples WHERE source='cloud' AND device_id=?1",
        rusqlite::params![device_id],
    )
    .map_err(|error| format!("Unable to clear cached cloud Tokenomics limit samples: {error}"))?;
    conn.execute(
        "DELETE FROM tokenomics_latest_windows WHERE source='cloud' AND device_id=?1",
        rusqlite::params![device_id],
    )
    .map_err(|error| format!("Unable to clear cached cloud Tokenomics windows: {error}"))?;
    let mut ids = HashSet::new();
    ids.insert(device_id.to_string());
    tokenomics_remove_cloud_provider_limits_for_devices(conn, &ids)
}

fn tokenomics_prune_local_cloud_relay_rows(conn: &rusqlite::Connection) -> Result<(), String> {
    let mut invalid_device_ids = tokenomics_local_device_id_set(conn)?;
    for placeholder in [
        "",
        "desktop-primary",
        "cloud",
        "account",
        "all",
        "all-device",
        "all-devices",
        "all_device",
        "all_devices",
        "unknown-device",
        "unknown_device",
    ] {
        invalid_device_ids.insert(placeholder.to_string());
    }
    for device_id in &invalid_device_ids {
        conn.execute(
            "DELETE FROM tokenomics_cloud_rollups WHERE device_id=?1",
            rusqlite::params![device_id.as_str()],
        )
        .map_err(|error| format!("Unable to prune local cloud Tokenomics rows: {error}"))?;
        conn.execute(
            "DELETE FROM tokenomics_provider_limit_samples WHERE source='cloud' AND device_id=?1",
            rusqlite::params![device_id.as_str()],
        )
        .map_err(|error| {
            format!("Unable to prune local cloud Tokenomics limit samples: {error}")
        })?;
        conn.execute(
            "DELETE FROM tokenomics_latest_windows WHERE source='cloud' AND device_id=?1",
            rusqlite::params![device_id.as_str()],
        )
        .map_err(|error| format!("Unable to prune local cloud Tokenomics windows: {error}"))?;
    }

    let local_device_ids = tokenomics_local_device_id_set(conn)?;
    let previous = tokenomics_cloud_provider_limits_raw(conn)?;
    let filtered = previous
        .iter()
        .filter(|row| {
            tokenomics_remote_cloud_device_id_from_value(row, None, &local_device_ids).is_some()
        })
        .cloned()
        .collect::<Vec<_>>();
    if filtered.len() != previous.len() {
        tokenomics_store_cloud_provider_limits_raw(conn, &filtered)?;
    }
    Ok(())
}

fn tokenomics_cloud_provider_limits_raw(conn: &rusqlite::Connection) -> Result<Vec<Value>, String> {
    let text: String = match conn.query_row(
        "SELECT value FROM tokenomics_meta WHERE key=?1",
        rusqlite::params![TOKENOMICS_CLOUD_PROVIDER_LIMITS_KEY],
        |row| row.get(0),
    ) {
        Ok(text) => text,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!(
                "Unable to read cached cloud Tokenomics provider limits: {error}"
            ));
        }
    };
    let parsed = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!([]));
    Ok(parsed.as_array().cloned().unwrap_or_default())
}

fn tokenomics_store_cloud_provider_limits_raw(
    conn: &rusqlite::Connection,
    limits: &[Value],
) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES(?1, ?2)",
        rusqlite::params![
            TOKENOMICS_CLOUD_PROVIDER_LIMITS_KEY,
            json!(limits).to_string()
        ],
    )
    .map_err(|error| format!("Unable to store cloud Tokenomics provider limits: {error}"))?;
    Ok(())
}

fn tokenomics_cloud_provider_limits(conn: &rusqlite::Connection) -> Result<Vec<Value>, String> {
    let local_device_ids = tokenomics_local_device_id_set(conn)?;
    Ok(tokenomics_cloud_provider_limits_raw(conn)?
        .into_iter()
        .filter(|row| {
            tokenomics_remote_cloud_device_id_from_value(row, None, &local_device_ids).is_some()
        })
        .collect())
}

fn tokenomics_merge_provider_limits(first: Vec<Value>, second: Vec<Value>) -> Vec<Value> {
    let mut merged = std::collections::BTreeMap::<String, Value>::new();
    for row in first.into_iter().chain(second.into_iter()) {
        let key = tokenomics_provider_limit_key(&row);
        let replace = merged
            .get(&key)
            .map(|existing| tokenomics_should_replace_provider_limit(existing, &row))
            .unwrap_or(true);
        if replace {
            merged.insert(key, row);
        }
    }
    merged.into_values().collect()
}

fn tokenomics_should_replace_provider_limit(existing: &Value, incoming: &Value) -> bool {
    let incoming_updated_at = tokenomics_provider_limit_updated_at_unix(incoming);
    let existing_updated_at = tokenomics_provider_limit_updated_at_unix(existing);
    let existing_unknown = tokenomics_provider_limit_is_unknown(existing);
    let incoming_unknown = tokenomics_provider_limit_is_unknown(incoming);
    if existing_unknown && !incoming_unknown {
        return true;
    }
    if !existing_unknown && incoming_unknown {
        return false;
    }
    incoming_updated_at >= existing_updated_at
}

fn tokenomics_provider_limit_key(limit: &Value) -> String {
    let device_id = tokenomics_value_string(limit, &["device_id", "machine_id"])
        .unwrap_or_else(|| "unknown-device".to_string());
    let provider =
        tokenomics_value_string(limit, &["provider"]).unwrap_or_else(|| "unknown".to_string());
    let agent_kind =
        tokenomics_value_string(limit, &["agent_kind"]).unwrap_or_else(|| provider.clone());
    let account_key = tokenomics_value_string(limit, &["provider_account_key", "subscription_key"])
        .unwrap_or_else(|| format!("{provider}:{agent_kind}:unknown"));
    let scope_type = tokenomics_value_string(limit, &["billing_scope_type", "scope_type"])
        .unwrap_or_else(|| "unknown".to_string());
    let team_id =
        tokenomics_value_string(limit, &["billing_team_id", "team_id"]).unwrap_or_default();
    let window_kind = tokenomics_value_string(limit, &["window_kind", "limit_kind"])
        .unwrap_or_else(|| "provider_limit".to_string());
    format!(
        "{scope_type}\u{1f}{team_id}\u{1f}{device_id}\u{1f}{provider}\u{1f}{agent_kind}\u{1f}{account_key}\u{1f}{window_kind}"
    )
}

fn tokenomics_provider_limit_is_unknown(limit: &Value) -> bool {
    let source = tokenomics_value_string(limit, &["limit_source"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    let confidence = tokenomics_value_string(limit, &["confidence"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    let status = tokenomics_value_string(limit, &["status_label"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    let has_percent = tokenomics_provider_limit_has_percent(limit);
    source == "not_exposed"
        || source == "claude_statusline_unavailable"
        || confidence == "unknown"
        || status.contains("not exposed")
        || status.contains("unavailable")
        || !has_percent
}

fn tokenomics_provider_limit_has_percent(limit: &Value) -> bool {
    tokenomics_value_i64(
        limit,
        &["remaining_percent", "used_percent", "limit_used_percent"],
    )
    .is_some()
}

fn tokenomics_provider_limit_updated_at_unix(limit: &Value) -> u64 {
    tokenomics_value_string(
        limit,
        &[
            "limit_observed_at",
            "sample_observed_at",
            "sample_at",
            "updated_at",
            "last_known_at",
        ],
    )
    .and_then(|value| tokenomics_timestamp_unix(&value))
    .unwrap_or(0)
}

fn tokenomics_codex_usage_cache_key(provider_account: &TokenomicsProviderAccount) -> String {
    format!(
        "{TOKENOMICS_CODEX_USAGE_CACHE_KEY_PREFIX}{}",
        provider_account.key
    )
}

fn tokenomics_codex_usage_cache_key_from_account_key(provider_account_key: &str) -> String {
    format!("{TOKENOMICS_CODEX_USAGE_CACHE_KEY_PREFIX}{provider_account_key}")
}

fn tokenomics_codex_usage_cache_alias_key(provider_account_key: &str) -> String {
    format!("{TOKENOMICS_CODEX_USAGE_CACHE_ALIAS_KEY_PREFIX}{provider_account_key}")
}

fn tokenomics_read_codex_usage_cache_alias(
    conn: &rusqlite::Connection,
    provider_account_key: &str,
) -> Option<String> {
    conn.query_row(
        "SELECT value FROM tokenomics_meta WHERE key=?1",
        rusqlite::params![tokenomics_codex_usage_cache_alias_key(provider_account_key)],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn tokenomics_store_codex_usage_cache_alias(
    conn: &rusqlite::Connection,
    alias_account_key: &str,
    canonical_account_key: &str,
) -> Result<(), String> {
    if alias_account_key.trim().is_empty()
        || canonical_account_key.trim().is_empty()
        || alias_account_key == canonical_account_key
    {
        return Ok(());
    }
    conn.execute(
        "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES(?1, ?2)",
        rusqlite::params![
            tokenomics_codex_usage_cache_alias_key(alias_account_key),
            canonical_account_key
        ],
    )
    .map_err(|error| format!("Unable to store Codex usage cache alias: {error}"))?;
    Ok(())
}

fn tokenomics_codex_usage_cache_keys(
    conn: &rusqlite::Connection,
    provider_account: &TokenomicsProviderAccount,
) -> Vec<String> {
    let mut keys = vec![tokenomics_codex_usage_cache_key(provider_account)];
    if let Some(canonical_account_key) =
        tokenomics_read_codex_usage_cache_alias(conn, &provider_account.key)
    {
        let canonical_cache_key =
            tokenomics_codex_usage_cache_key_from_account_key(&canonical_account_key);
        if !keys.iter().any(|key| key == &canonical_cache_key) {
            keys.push(canonical_cache_key);
        }
    }
    keys
}

fn tokenomics_provider_account_refresh_keys(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    provider_account: &TokenomicsProviderAccount,
) -> Vec<String> {
    let mut keys = vec![provider_account.key.clone()];
    if provider == "openai" && agent_kind == "codex" {
        if let Some(canonical_account_key) =
            tokenomics_read_codex_usage_cache_alias(conn, &provider_account.key)
        {
            if !keys.iter().any(|key| key == &canonical_account_key) {
                keys.push(canonical_account_key);
            }
        }
    }
    keys
}

fn tokenomics_strip_account_usage_fields(value: &mut Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    for key in [
        "credits",
        "crediting",
        "credit_sources",
        "creditSources",
        "credit_source_rows",
        "creditSourceRows",
        "wallet",
        "billingStatus",
        "billing_status",
        "accountUsage",
        "account_usage",
        "storage",
        "storage_usage",
        "storageUsage",
    ] {
        object.remove(key);
    }
}

fn tokenomics_account_usage_fields_stripped(value: &Value) -> Value {
    let mut value = value.clone();
    tokenomics_strip_account_usage_fields(&mut value);
    value
}

fn tokenomics_cached_codex_usage(
    conn: &rusqlite::Connection,
    cache_key: &str,
    now_unix: u64,
    max_age_secs: u64,
) -> Result<Option<Value>, String> {
    let text: String = match conn.query_row(
        "SELECT value FROM tokenomics_meta WHERE key=?1",
        rusqlite::params![cache_key],
        |row| row.get(0),
    ) {
        Ok(text) => text,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(error) => return Err(format!("Unable to read Codex usage cache: {error}")),
    };
    let cached = serde_json::from_str::<Value>(&text)
        .map_err(|error| format!("Unable to parse Codex usage cache: {error}"))?;
    let fetched_at = tokenomics_value_i64(&cached, &["fetched_at_unix"])
        .unwrap_or(0)
        .max(0) as u64;
    if fetched_at == 0 || now_unix.saturating_sub(fetched_at) >= max_age_secs {
        return Ok(None);
    }
    let Some(usage) = cached.get("usage").filter(|value| value.is_object()) else {
        return Ok(None);
    };
    tokenomics_rewrite_codex_usage_cache_alias(conn, cache_key, usage, fetched_at)?;
    let mut usage =
        tokenomics_adjust_cached_codex_usage(usage, now_unix.saturating_sub(fetched_at));
    tokenomics_mark_usage_updated_at(&mut usage, tokenomics_unix_iso_like(fetched_at));
    tokenomics_strip_account_usage_fields(&mut usage);
    Ok(Some(usage))
}

fn tokenomics_store_codex_usage_cache(
    conn: &rusqlite::Connection,
    cache_key: &str,
    usage: &Value,
) -> Result<(), String> {
    tokenomics_store_codex_usage_cache_at(conn, cache_key, usage, tokenomics_unix_now())
}

fn tokenomics_store_codex_usage_cache_at(
    conn: &rusqlite::Connection,
    cache_key: &str,
    usage: &Value,
    fetched_at_unix: u64,
) -> Result<(), String> {
    let usage = tokenomics_account_usage_fields_stripped(usage);
    let payload = json!({
        "fetched_at_unix": fetched_at_unix,
        "usage": usage,
    });
    conn.execute(
        "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES(?1, ?2)",
        rusqlite::params![cache_key, payload.to_string()],
    )
    .map_err(|error| format!("Unable to write Codex usage cache: {error}"))?;
    Ok(())
}

fn tokenomics_delete_codex_usage_cache(
    conn: &rusqlite::Connection,
    cache_key: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM tokenomics_meta WHERE key=?1",
        rusqlite::params![cache_key],
    )
    .map_err(|error| format!("Unable to remove stale Codex usage cache: {error}"))?;
    Ok(())
}

fn tokenomics_rewrite_codex_usage_cache_alias(
    conn: &rusqlite::Connection,
    cache_key: &str,
    usage: &Value,
    fetched_at_unix: u64,
) -> Result<(), String> {
    let Some(account_id) = tokenomics_codex_usage_account_id(usage) else {
        return Ok(());
    };
    let canonical_account_key =
        tokenomics_codex_provider_account_key_from_usage_account_id(&account_id);
    let canonical_cache_key =
        tokenomics_codex_usage_cache_key_from_account_key(&canonical_account_key);
    if canonical_cache_key == cache_key {
        return Ok(());
    }
    if let Some(alias_account_key) = cache_key.strip_prefix(TOKENOMICS_CODEX_USAGE_CACHE_KEY_PREFIX)
    {
        tokenomics_store_codex_usage_cache_alias(conn, alias_account_key, &canonical_account_key)?;
    }
    tokenomics_store_codex_usage_cache_at(conn, &canonical_cache_key, usage, fetched_at_unix)?;
    tokenomics_delete_codex_usage_cache(conn, cache_key)
}

fn tokenomics_adjust_cached_codex_usage(usage: &Value, elapsed_seconds: u64) -> Value {
    let mut usage = usage.clone();
    if elapsed_seconds == 0 {
        return usage;
    }
    let elapsed_seconds = elapsed_seconds.min(i64::MAX as u64) as i64;
    let Some(rate_limit) = usage.get_mut("rate_limit").and_then(Value::as_object_mut) else {
        return usage;
    };
    for window_key in ["primary_window", "secondary_window"] {
        let Some(window) = rate_limit
            .get_mut(window_key)
            .and_then(Value::as_object_mut)
        else {
            continue;
        };
        for reset_key in ["reset_after_seconds", "resetAfterSeconds"] {
            let Some(value) = window.get(reset_key).and_then(Value::as_i64) else {
                continue;
            };
            window.insert(
                reset_key.to_string(),
                json!(value.saturating_sub(elapsed_seconds).max(0)),
            );
        }
    }
    usage
}

fn tokenomics_mark_usage_updated_at(usage: &mut Value, updated_at: String) {
    let Some(object) = usage.as_object_mut() else {
        return;
    };
    object.insert("updated_at".to_string(), json!(updated_at.clone()));
    object.insert("last_known_at".to_string(), json!(updated_at));
}

fn tokenomics_value_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| {
        value.get(*key).and_then(|item| {
            item.as_i64()
                .or_else(|| {
                    item.as_f64()
                        .filter(|number| number.is_finite())
                        .map(|number| number.round() as i64)
                })
                .or_else(|| item.as_str().and_then(|text| text.parse::<i64>().ok()))
        })
    })
}

fn tokenomics_value_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value.get(*key).and_then(|item| {
            item.as_str()
                .map(ToString::to_string)
                .or_else(|| item.as_i64().map(|number| number.to_string()))
                .or_else(|| item.as_f64().map(|number| number.to_string()))
        })
    })
}

fn tokenomics_query_one(conn: &rusqlite::Connection, sql: &str) -> Result<Value, String> {
    tokenomics_query_rows(conn, sql).map(|mut rows| rows.pop().unwrap_or_else(|| json!({})))
}

fn tokenomics_query_rows(conn: &rusqlite::Connection, sql: &str) -> Result<Vec<Value>, String> {
    let mut statement = conn
        .prepare(sql)
        .map_err(|error| format!("Unable to prepare Tokenomics query: {error}"))?;
    let columns = statement
        .column_names()
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let mapped = statement
        .query_map([], |row| {
            let mut object = serde_json::Map::new();
            for (index, column) in columns.iter().enumerate() {
                let value = match row.get_ref(index)? {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(value) => json!(value),
                    rusqlite::types::ValueRef::Real(value) => json!(value),
                    rusqlite::types::ValueRef::Text(value) => {
                        Value::String(String::from_utf8_lossy(value).to_string())
                    }
                    rusqlite::types::ValueRef::Blob(value) => {
                        Value::String(tokenomics_hash(&String::from_utf8_lossy(value)))
                    }
                };
                object.insert(column.to_string(), value);
            }
            Ok(Value::Object(object))
        })
        .map_err(|error| format!("Unable to query Tokenomics rows: {error}"))?;
    let mut rows = Vec::new();
    for row in mapped {
        rows.push(row.map_err(|error| format!("Unable to read Tokenomics row: {error}"))?);
    }
    Ok(rows)
}

#[cfg(test)]
mod tokenomics_tests {
    use super::*;

    use super::OPENCODE_DB_TEST_LOCK as TOKENOMICS_OPENCODE_TEST_LOCK;

    fn tokenomics_test_event(
        id: &str,
        source_path: &str,
        bucket_unix: u64,
        account_key: Option<&str>,
        total_tokens: i64,
    ) -> TokenomicsUsageEvent {
        let (bucket_day, bucket_hour) = tokenomics_utc_hour_bucket_from_unix(bucket_unix);
        TokenomicsUsageEvent {
            id: id.to_string(),
            device_id: "device-test".to_string(),
            provider: "anthropic".to_string(),
            agent_kind: "claude".to_string(),
            model: Some("claude-test".to_string()),
            subscription_key: account_key.map(str::to_string),
            provider_account_key: account_key.map(str::to_string),
            provider_account_label: account_key.map(|key| format!("Label {key}")),
            source_request_id: None,
            billing_scope_type: "personal".to_string(),
            billing_team_id: None,
            billing_scope_source: "test".to_string(),
            workspace_id: None,
            repo_path: None,
            source_kind: "jsonl".to_string(),
            source_path: Some(source_path.to_string()),
            bucket_day,
            bucket_hour: bucket_hour.clone(),
            input_tokens: total_tokens,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            total_tokens,
            estimated_cost_microusd: total_tokens,
            created_at: Some(bucket_hour.clone()),
            observed_at: bucket_hour,
        }
    }

    fn daemon_usage_result(accounts: Value) -> Result<haider_rpc_ade::UsageReportResult, String> {
        Ok(haider_rpc_ade::UsageReportResult {
            report: json!({
                "generated_at_ms": 1_800_000_u64,
                "accounts": accounts,
            }),
            availability: Some(haider_rpc_ade::SnapshotAvailabilityWire::Available),
        })
    }

    #[test]
    fn daemon_unavailable_meter_preserves_reason_without_numeric_limit() {
        let _storage = process_test_storage_isolation(stringify!(
            daemon_unavailable_meter_preserves_reason_without_numeric_limit
        ));
        let projection = tokenomics_project_daemon_usage(&daemon_usage_result(json!([{
            "provider": "openai",
            "alias": "default",
            "meter": { "state": "unavailable", "reason": "oauth refresh failed" },
            "local": { "input_tokens": 7, "output_tokens": 3 }
        }])));

        assert_eq!(projection.authority["state"], json!("available"));
        assert_eq!(projection.meter_states[0]["state"], json!("unavailable"));
        assert_eq!(projection.meter_states[0]["reason"], json!("oauth refresh failed"));
        assert!(projection.limits.is_empty(), "Unavailable must not become a numeric limit");
    }

    #[test]
    fn daemon_local_only_stays_distinct_from_server_meter_reading() {
        let _storage = process_test_storage_isolation(stringify!(
            daemon_local_only_stays_distinct_from_server_meter_reading
        ));
        let projection = tokenomics_project_daemon_usage(&daemon_usage_result(json!([{
            "provider": "opencode",
            "alias": "api-key",
            "meter": { "state": "local_only" },
            "local": { "input_tokens": 7, "output_tokens": 3 }
        }])));

        assert_eq!(projection.meter_states[0]["state"], json!("local_only"));
        assert!(projection.limits.is_empty(), "LocalOnly must not become a server reading");
        assert_eq!(projection.counters[0].total_tokens, 10);
    }

    #[test]
    fn absent_daemon_report_is_unknown_not_healthy_zero() {
        let result = Ok(haider_rpc_ade::UsageReportResult {
            report: Value::Null,
            availability: Some(haider_rpc_ade::SnapshotAvailabilityWire::Available),
        });
        let projection = tokenomics_project_daemon_usage(&result);

        assert_eq!(projection.authority["state"], json!("unknown"));
        assert_eq!(projection.authority["reason"], json!("report_missing"));
        assert!(projection.meter_states.is_empty());
        assert!(projection.limits.is_empty());
        assert!(projection.counters.is_empty());
    }

    #[test]
    fn absent_daemon_availability_is_unknown_even_with_report_object() {
        let _storage = process_test_storage_isolation(stringify!(
            absent_daemon_availability_is_unknown_even_with_report_object
        ));
        let result = Ok(haider_rpc_ade::UsageReportResult {
            report: json!({
                "generated_at_ms": 1_800_000_u64,
                "accounts": [],
            }),
            availability: None,
        });
        let projection = tokenomics_project_daemon_usage(&result);

        assert_eq!(projection.authority["state"], json!("unknown"));
        assert_eq!(projection.authority["reason"], json!("availability_missing"));
        assert!(projection.meter_states.is_empty());
        assert!(projection.limits.is_empty());
        assert!(projection.counters.is_empty());
    }

    #[test]
    fn daemon_breakdowns_aggregate_all_cache_lanes_per_model() {
        let _storage = process_test_storage_isolation(stringify!(
            daemon_breakdowns_aggregate_all_cache_lanes_per_model
        ));
        let projection = tokenomics_project_daemon_usage(&daemon_usage_result(json!([{
            "provider": "anthropic",
            "alias": "team",
            "meter": { "state": "local_only" },
            "local": {
                "cache": { "breakdowns": [
                    {
                        "provider": "anthropic", "model": "claude-sonnet", "cache_epoch": "a",
                        "logical_input_tokens": 10, "uncached_input_tokens": 8,
                        "cache_read_tokens": 2, "cache_write_tokens": 0,
                        "billed_output_tokens": 3, "input_with_cache_usd": 0.01
                    },
                    {
                        "provider": "anthropic", "model": "claude-sonnet", "cache_epoch": "b",
                        "logical_input_tokens": 20, "uncached_input_tokens": 15,
                        "cache_read_tokens": 4, "cache_write_tokens": 1,
                        "billed_output_tokens": 6, "input_with_cache_usd": 0.02
                    }
                ]}
            }
        }])));

        assert_eq!(projection.counters.len(), 1);
        let counter = &projection.counters[0];
        assert_eq!(counter.model.as_deref(), Some("claude-sonnet"));
        assert_eq!(counter.input_tokens, 23);
        assert_eq!(counter.output_tokens, 9);
        assert_eq!(counter.cache_read_tokens, 6);
        assert_eq!(counter.cache_write_tokens, 1);
        assert_eq!(counter.total_tokens, 39);
        assert_eq!(counter.estimated_cost_microusd, 30_000);
    }

    #[test]
    fn daemon_api_equivalent_cost_is_not_flattened_into_estimated_spend() {
        let _storage = process_test_storage_isolation(stringify!(
            daemon_api_equivalent_cost_is_not_flattened_into_estimated_spend
        ));
        let projection = tokenomics_project_daemon_usage(&daemon_usage_result(json!([{
            "provider": "anthropic",
            "alias": "subscription",
            "meter": { "state": "local_only" },
            "local": {
                "cache": { "breakdowns": [{
                    "provider": "anthropic", "model": "claude-sonnet", "cache_epoch": "a",
                    "logical_input_tokens": 10, "uncached_input_tokens": 10,
                    "billed_output_tokens": 3,
                    "api_equivalent_input_with_cache_usd": 0.03
                }]}
            }
        }])));

        assert_eq!(projection.counters.len(), 1);
        assert_eq!(projection.counters[0].estimated_cost_microusd, 0);
        assert_eq!(
            projection.meter_states[0]["local"]["cache"]["breakdowns"][0]
                ["api_equivalent_input_with_cache_usd"],
            json!(0.03),
            "the daemon's separate hypothetical figure remains available without becoming spend"
        );
    }

    #[test]
    fn absent_plan_percentage_remains_unknown_with_optional_fields_preserved() {
        let _storage = process_test_storage_isolation(stringify!(
            absent_plan_percentage_remains_unknown_with_optional_fields_preserved
        ));
        let snapshot = haider_rpc_ade::HaiderCodePlanStatusSnapshot {
            supported: Some(true),
            known: true,
            provider: Some("haider-code".to_string()),
            account_alias: Some("default".to_string()),
            outcome: Some(json!({
                "state": "available",
                "snapshot": {
                    "weekly_allowance": {
                        "state": "ok",
                        "resets_at_ms": 0_u64,
                        "grace_until_ms": 2_100_000_u64
                    }
                }
            })),
            received_at_ms: Some(1_800_000),
        };
        let limit = tokenomics_plan_status_limit(&snapshot).expect("known plan frame");

        assert!(limit["remaining_percent"].is_null());
        assert!(limit["used_percent"].is_null());
        assert_eq!(limit["allowance_state"], json!("ok"));
        assert_eq!(limit["reset_at"], json!("unix:0"));
        assert_eq!(limit["grace_until"], json!("unix:2100"));
        assert_eq!(limit["meter_state"], json!("unknown"));
    }

    #[test]
    fn first_daemon_baseline_preserves_existing_history_without_double_counting() {
        let _storage = process_test_storage_isolation(stringify!(
            first_daemon_baseline_preserves_existing_history_without_double_counting
        ));
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let existing = tokenomics_test_event(
            "retained-history",
            "legacy.jsonl",
            1_700_000_000,
            Some("anthropic:claude:retained"),
            50,
        );
        assert!(tokenomics_insert_event(&conn, &existing).unwrap());
        tokenomics_rebuild_provider_rollups_from_events(&conn, "anthropic", "claude").unwrap();
        let before_events: i64 = conn
            .query_row("SELECT COUNT(*) FROM tokenomics_usage_events", [], |row| row.get(0))
            .unwrap();
        let before_total: i64 = conn
            .query_row("SELECT COALESCE(SUM(total_tokens), 0) FROM tokenomics_rollups", [], |row| row.get(0))
            .unwrap();
        let counter = TokenomicsDaemonCounter {
            counter_key: "daemon-baseline".to_string(),
            device_id: "device-test".to_string(),
            provider: "openai".to_string(),
            agent_kind: "codex".to_string(),
            provider_account_key: "openai:codex:haider:default".to_string(),
            provider_account_label: Some("default".to_string()),
            model: Some("gpt-5".to_string()),
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
            generated_at_ms: 1_800_000,
            ..TokenomicsDaemonCounter::default()
        };

        let ingest = tokenomics_ingest_daemon_counters(&mut conn, &[counter]).unwrap();
        let after_events: i64 = conn
            .query_row("SELECT COUNT(*) FROM tokenomics_usage_events", [], |row| row.get(0))
            .unwrap();
        let after_total: i64 = conn
            .query_row("SELECT COALESCE(SUM(total_tokens), 0) FROM tokenomics_rollups", [], |row| row.get(0))
            .unwrap();

        assert!(ingest.baseline_seeded);
        assert!(ingest.preserved_existing_history);
        assert_eq!(ingest.inserted_events, 0);
        assert_eq!(after_events, before_events);
        assert_eq!(after_total, before_total);
    }

    #[test]
    fn late_daemon_counter_seeds_without_importing_lifetime_usage() {
        let _storage = process_test_storage_isolation(stringify!(
            late_daemon_counter_seeds_without_importing_lifetime_usage
        ));
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let existing = tokenomics_test_event(
            "retained-history",
            "legacy.jsonl",
            1_700_000_000,
            Some("anthropic:claude:retained"),
            50,
        );
        assert!(tokenomics_insert_event(&conn, &existing).unwrap());
        tokenomics_rebuild_provider_rollups_from_events(&conn, "anthropic", "claude").unwrap();

        let first_counter = TokenomicsDaemonCounter {
            counter_key: "daemon-first-baseline".to_string(),
            device_id: "device-test".to_string(),
            provider: "openai".to_string(),
            agent_kind: "codex".to_string(),
            provider_account_key: "openai:codex:haider:first".to_string(),
            provider_account_label: Some("first".to_string()),
            model: Some("gpt-5".to_string()),
            input_tokens: 10,
            output_tokens: 2,
            total_tokens: 12,
            generated_at_ms: 1_800_000,
            ..TokenomicsDaemonCounter::default()
        };
        let first_ingest =
            tokenomics_ingest_daemon_counters(&mut conn, &[first_counter]).unwrap();
        assert_eq!(first_ingest.inserted_events, 0);

        let late_counter = TokenomicsDaemonCounter {
            counter_key: "daemon-late-baseline".to_string(),
            device_id: "device-test".to_string(),
            provider: "openai".to_string(),
            agent_kind: "codex".to_string(),
            provider_account_key: "openai:codex:haider:late".to_string(),
            provider_account_label: Some("late".to_string()),
            model: Some("gpt-5-new".to_string()),
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
            generated_at_ms: 1_900_000,
            ..TokenomicsDaemonCounter::default()
        };
        let late_ingest =
            tokenomics_ingest_daemon_counters(&mut conn, &[late_counter]).unwrap();
        let stored_total: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(total_tokens), 0) FROM tokenomics_rollups",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(
            late_ingest.inserted_events, 0,
            "a never-baselined counter must seed instead of importing its lifetime total"
        );
        assert_eq!(stored_total, 50, "late counter seeding must preserve retained history");
    }

    #[test]
    fn daemon_counter_input_flows_into_device_keyed_rollups() {
        let _storage = process_test_storage_isolation(stringify!(
            daemon_counter_input_flows_into_device_keyed_rollups
        ));
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let counter = TokenomicsDaemonCounter {
            counter_key: "fresh-daemon-counter".to_string(),
            device_id: "device-authority".to_string(),
            provider: "openai".to_string(),
            agent_kind: "codex".to_string(),
            provider_account_key: "openai:codex:haider:default".to_string(),
            provider_account_label: Some("default".to_string()),
            model: Some("gpt-5".to_string()),
            input_tokens: 10,
            output_tokens: 2,
            total_tokens: 12,
            generated_at_ms: 1_800_000,
            ..TokenomicsDaemonCounter::default()
        };

        let ingest = tokenomics_ingest_daemon_counters(&mut conn, &[counter]).unwrap();
        let rollup: (String, String, i64) = conn
            .query_row(
                "SELECT device_id, billing_scope_type, total_tokens FROM tokenomics_rollups
                 WHERE provider='openai' AND agent_kind='codex'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();

        assert_eq!(ingest.inserted_events, 1);
        assert_eq!(
            rollup,
            ("device-authority".to_string(), "unknown".to_string(), 12)
        );
    }

    #[test]
    fn tokenomics_usage_event_prune_policy_requires_age_sync_and_rollup_coverage() {
        assert_eq!(TOKENOMICS_USAGE_EVENT_RETENTION_DAYS, 14);
        let now = 20_000_000;
        let young = now - (TOKENOMICS_USAGE_EVENT_RETENTION_DAYS - 1) * 86_400;
        let old = now - (TOKENOMICS_USAGE_EVENT_RETENTION_DAYS + 1) * 86_400;
        let very_old = now - (TOKENOMICS_USAGE_EVENT_RETENTION_DAYS + 40) * 86_400;

        assert!(!tokenomics_usage_event_prune_policy_allows(
            young, now, true, true
        ));
        assert!(tokenomics_usage_event_prune_policy_allows(
            old, now, true, true
        ));
        assert!(!tokenomics_usage_event_prune_policy_allows(
            now - 13 * 86_400,
            now,
            true,
            true
        ));
        assert!(tokenomics_usage_event_prune_policy_allows(
            now - 15 * 86_400,
            now,
            true,
            true
        ));
        assert!(!tokenomics_usage_event_prune_policy_allows(
            old, now, false, true
        ));
        assert!(!tokenomics_usage_event_prune_policy_allows(
            very_old, now, false, true
        ));
        assert!(!tokenomics_usage_event_prune_policy_allows(
            very_old, now, true, false
        ));
    }

    #[test]
    fn tokenomics_usage_event_prune_chunk_preserves_rollup_and_tombstone() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_usage_event_prune_chunk_preserves_rollup_and_tombstone));
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        conn.execute(
            "CREATE TEMP TABLE IF NOT EXISTS tokenomics_prune_candidate_rowids(rowid INTEGER PRIMARY KEY)",
            [],
        )
        .unwrap();

        let (bucket_day, bucket_hour) = tokenomics_utc_hour_bucket_from_unix(1_600_000_000);
        let ledger_source_path = "/tmp/tokenomics-prune-test.jsonl";
        let base_event = TokenomicsUsageEvent {
            id: "prune-test-personal".to_string(),
            device_id: "device-prune-test".to_string(),
            provider: "openai".to_string(),
            agent_kind: "codex".to_string(),
            model: Some("gpt-test".to_string()),
            subscription_key: Some("openai:codex:test".to_string()),
            provider_account_key: Some("openai:codex:test".to_string()),
            provider_account_label: Some("Test Account".to_string()),
            source_request_id: Some("request-prune-test".to_string()),
            billing_scope_type: "personal".to_string(),
            billing_team_id: None,
            billing_scope_source: "test".to_string(),
            workspace_id: None,
            repo_path: None,
            source_kind: "codex_token_count_jsonl".to_string(),
            source_path: Some(format!("{ledger_source_path}:codex")),
            bucket_day: bucket_day.clone(),
            bucket_hour: bucket_hour.clone(),
            input_tokens: 10,
            output_tokens: 5,
            cache_read_tokens: 2,
            cache_write_tokens: 1,
            total_tokens: 18,
            estimated_cost_microusd: 123,
            created_at: Some(bucket_hour.clone()),
            observed_at: bucket_hour.clone(),
        };
        assert!(tokenomics_insert_event(&conn, &base_event).unwrap());
        conn.execute(
            "INSERT INTO tokenomics_source_imports(
               provider, agent_kind, source_path, source_id, source_kind, scanner_version,
               event_count, raw_available, import_status, updated_at
             ) VALUES(
               'openai', 'codex', ?1, '/tmp/state_5.sqlite',
               'codex_token_count_jsonl', ?2, 1, 1, 'complete', '2026-06-01T00:00:00Z'
             )",
            rusqlite::params![ledger_source_path, TOKENOMICS_LEGACY_CODEX_SCANNER_VERSION],
        )
        .unwrap();
        conn.execute(
            "UPDATE tokenomics_source_imports
             SET last_event_timestamp=?1
             WHERE source_path=?2",
            rusqlite::params![1_600_000_000_i64 + 3 * 86_400, ledger_source_path],
        )
        .unwrap();

        let mut unsynced_team_event = base_event.clone();
        unsynced_team_event.id = "prune-test-team-unsynced".to_string();
        unsynced_team_event.billing_scope_type = "team".to_string();
        unsynced_team_event.billing_team_id = Some("team-prune-test".to_string());
        assert!(tokenomics_insert_event(&conn, &unsynced_team_event).unwrap());

        let day_ack_key =
            format!("{TOKENOMICS_USAGE_EVENT_PRUNE_ACK_DAY_META_PREFIX}personal:{bucket_day}");
        conn.execute(
            "INSERT INTO tokenomics_meta(key, value) VALUES(?1, ?2)",
            rusqlite::params![day_ack_key, "zzzz"],
        )
        .unwrap();

        let deleted =
            tokenomics_prune_usage_event_chunk(&mut conn, "9999-12-31T23:00:00Z", &bucket_day)
                .unwrap();
        assert_eq!(deleted, 1);
        let raw_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tokenomics_usage_events", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(raw_count, 1, "unsynced team row must remain raw");
        let pruned_total: (i64, i64) = conn
            .query_row(
                "SELECT COALESCE(SUM(total_tokens), 0), COALESCE(SUM(event_count), 0)
                 FROM tokenomics_pruned_usage_rollups",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(pruned_total, (18, 1));
        let source_identity = tokenomics_source_identity_from_import_ledger(
            &conn,
            "openai",
            "codex",
            Path::new(ledger_source_path),
        )
        .unwrap()
        .expect("prune captures source identity before raw event deletion");
        assert_eq!(source_identity.provider_account.key, "openai:codex:test");
        assert_eq!(source_identity.provider_account.label, "Test Account");
        assert_eq!(source_identity.billing_scope.scope_type, "personal");
        assert_eq!(source_identity.billing_scope.team_id, None);
        assert_eq!(source_identity.billing_scope.source, "test");
        let tombstone_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_usage_event_tombstones WHERE id=?1",
                rusqlite::params![base_event.id.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tombstone_count, 1);
        assert!(!tokenomics_insert_event(&conn, &base_event).unwrap());
    }

    #[test]
    fn tokenomics_fold_preserves_event_when_live_rollup_is_missing() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_fold_preserves_event_when_live_rollup_is_missing));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let event = tokenomics_test_event(
            "missing-rollup-event",
            "/tmp/missing-rollup.jsonl",
            1_600_000_000,
            Some("anthropic:claude:missing-rollup"),
            41,
        );
        assert!(tokenomics_insert_event(&conn, &event).unwrap());
        conn.execute("DELETE FROM tokenomics_rollups", []).unwrap();
        tokenomics_reset_prune_candidates(&conn).unwrap();
        conn.execute(
            "INSERT INTO tokenomics_prune_candidate_rowids(rowid)
             SELECT rowid FROM tokenomics_usage_events WHERE id=?1",
            rusqlite::params![event.id.as_str()],
        )
        .unwrap();
        tokenomics_run_write_batch(&conn, || {
            assert_eq!(
                tokenomics_fold_prune_candidates_into_tombstones(&conn, "2026-07-12T00:00:00Z")?,
                1
            );
            Ok(())
        })
        .unwrap();

        let preserved: (i64, i64) = conn
            .query_row(
                "SELECT total_tokens, event_count FROM tokenomics_pruned_usage_rollups",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(preserved, (41, 1));
        let live_rollup: (i64, i64) = conn
            .query_row(
                "SELECT total_tokens, event_count FROM tokenomics_rollups",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(live_rollup, preserved);
    }

    #[test]
    fn tokenomics_all_rollup_day_starts_includes_acked_days_and_filters_scope() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_all_rollup_day_starts_includes_acked_days_and_filters_scope));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        // 2026-06-01 and 2026-06-03 for the personal scope; 2026-06-02 for a
        // team scope that must not leak in.
        for (id, unix) in [("day-a", 1_780_290_000u64), ("day-b", 1_780_470_000u64)] {
            let event = tokenomics_test_event(
                id,
                "/tmp/all-days.jsonl",
                unix,
                Some("anthropic:claude:acct"),
                10,
            );
            assert!(tokenomics_insert_event(&conn, &event).unwrap());
        }
        let mut team_event = tokenomics_test_event(
            "day-team",
            "/tmp/all-days-team.jsonl",
            1_780_380_000,
            Some("anthropic:claude:acct"),
            10,
        );
        team_event.billing_scope_type = "team".to_string();
        team_event.billing_team_id = Some("team-1".to_string());
        assert!(tokenomics_insert_event(&conn, &team_event).unwrap());

        // Mark 2026-06-01 as prune-acked: the historical prune-ack candidate
        // listing excludes it, but cloud-coverage reconciliation must NOT —
        // an ack can outlive cloud facts that were never durably published.
        let scope = TokenomicsBillingScope {
            scope_type: "personal".to_string(),
            team_id: None,
            source: "test".to_string(),
        };
        let scope_key = tokenomics_billing_scope_key("personal", None);
        tokenomics_store_meta_value(
            &conn,
            &format!("{TOKENOMICS_USAGE_EVENT_PRUNE_ACK_DAY_META_PREFIX}{scope_key}:2026-06-01"),
            "unix:1780500000",
        )
        .unwrap();

        let older_than_day_start_ms = 1_780_617_600_000i64; // 2026-06-05
        let days =
            tokenomics_all_rollup_day_starts(&conn, &scope, older_than_day_start_ms).unwrap();
        assert_eq!(
            days,
            vec![
                ("2026-06-01".to_string(), 1_780_272_000_000i64),
                ("2026-06-03".to_string(), 1_780_444_800_000i64),
            ],
            "ack state and foreign scopes must not affect the listing"
        );

        let candidates = tokenomics_historical_prune_ack_candidate_days(
            &conn,
            &scope,
            older_than_day_start_ms,
            None,
            10,
        )
        .unwrap();
        assert_eq!(
            candidates,
            vec![1_780_444_800_000i64],
            "prune-ack candidates still exclude acked days"
        );

        let bounded = tokenomics_all_rollup_day_starts(&conn, &scope, 1_780_444_800_000).unwrap();
        assert_eq!(
            bounded,
            vec![("2026-06-01".to_string(), 1_780_272_000_000i64)],
            "the older-than bound is exclusive"
        );
    }

    #[test]
    fn tokenomics_insert_waiting_on_fold_rechecks_source_hour_tombstone() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_insert_waiting_on_fold_rechecks_source_hour_tombstone));
        let db_path = tokenomics_test_temp_path("insert-fold-race", "sqlite");
        let _ = fs::remove_file(&db_path);
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.busy_timeout(Duration::from_secs(2)).unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let other = rusqlite::Connection::open(&db_path).unwrap();
        other.busy_timeout(Duration::from_secs(2)).unwrap();
        tokenomics_prepare_db(&other).unwrap();
        let base = tokenomics_test_event(
            "race-base",
            "/tmp/race-source.jsonl",
            1_600_000_000,
            Some("anthropic:claude:race"),
            10,
        );
        assert!(tokenomics_insert_event(&conn, &base).unwrap());
        tokenomics_reset_prune_candidates(&conn).unwrap();
        conn.execute(
            "INSERT INTO tokenomics_prune_candidate_rowids(rowid)
             SELECT rowid FROM tokenomics_usage_events WHERE id=?1",
            rusqlite::params![base.id.as_str()],
        )
        .unwrap();
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();

        let mut late = base.clone();
        late.id = "race-late".to_string();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let writer = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            tokenomics_insert_event(&other, &late)
        });
        started_rx.recv().unwrap();
        std::thread::sleep(Duration::from_millis(50));
        tokenomics_fold_prune_candidates_into_tombstones(&conn, "2026-07-12T00:00:00Z").unwrap();
        conn.execute_batch("COMMIT").unwrap();
        assert!(!writer.join().unwrap().unwrap());

        let totals: (i64, i64) = conn
            .query_row(
                "SELECT total_tokens, event_count FROM tokenomics_rollups",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(totals, (10, 1));
        let _ = fs::remove_file(&db_path);
    }

    #[test]
    fn tokenomics_persisted_retirement_survives_registry_absence() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_persisted_retirement_survives_registry_absence));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let retired = "anthropic:claude:profile:deleted-profile";
        tokenomics_persist_retired_provider_account_key(
            &conn,
            "anthropic",
            "claude",
            retired,
            None,
        )
        .unwrap();
        assert!(tokenomics_retired_provider_account_keys(&conn)
            .iter()
            .any(|key| key == retired));
    }

    #[test]
    fn tokenomics_retirement_migration_preserves_and_merges_totals() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_retirement_migration_preserves_and_merges_totals));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let old_key = "anthropic:claude:profile:synthetic";
        let canonical_key = "anthropic:claude:canonical";
        let bucket_unix = 1_600_000_000;
        let old_event = tokenomics_test_event(
            "retire-old-event",
            "/profiles/synthetic/projects/a.jsonl",
            bucket_unix,
            Some(old_key),
            11,
        );
        let canonical_event = tokenomics_test_event(
            "retire-canonical-event",
            "/profiles/default/projects/a.jsonl",
            bucket_unix,
            Some(canonical_key),
            13,
        );
        assert!(tokenomics_insert_event(&conn, &old_event).unwrap());
        assert!(tokenomics_insert_event(&conn, &canonical_event).unwrap());
        for (key, total) in [(old_key, 5_i64), (canonical_key, 7_i64)] {
            let id = tokenomics_rollup_id(
                "device-test",
                "anthropic",
                "claude",
                Some("claude-test"),
                Some(key),
                Some(key),
                "personal",
                None,
                None,
                "hour",
                &old_event.bucket_hour,
            );
            conn.execute(
                "INSERT INTO tokenomics_pruned_usage_rollups(
                   id, device_id, provider, agent_kind, model, subscription_key,
                   provider_account_key, provider_account_label, billing_scope_type,
                   billing_scope_source, bucket_width, bucket_start, input_tokens,
                   total_tokens, event_count, updated_at
                 ) VALUES(?1, 'device-test', 'anthropic', 'claude', 'claude-test',
                   ?2, ?2, ?2, 'personal', 'test', 'hour', ?3, ?4, ?4, 1,
                   '2026-07-01T00:00:00Z')",
                rusqlite::params![id, key, old_event.bucket_hour.as_str(), total],
            )
            .unwrap();
        }
        tokenomics_rebuild_provider_rollups_from_events(&conn, "anthropic", "claude").unwrap();
        let (_, rollup_only_hour) = tokenomics_utc_hour_bucket_from_unix(bucket_unix + 3_600);
        let rollup_only_id = tokenomics_rollup_id(
            "device-test",
            "anthropic",
            "claude",
            Some("claude-test"),
            Some(old_key),
            Some(old_key),
            "personal",
            None,
            None,
            "hour",
            &rollup_only_hour,
        );
        conn.execute(
            "INSERT INTO tokenomics_rollups(
               id, device_id, provider, agent_kind, model, subscription_key,
               provider_account_key, provider_account_label, billing_scope_type,
               billing_scope_source, bucket_width, bucket_start, input_tokens,
               total_tokens, event_count, updated_at
             ) VALUES(?1, 'device-test', 'anthropic', 'claude', 'claude-test',
               ?2, ?2, ?2, 'personal', 'test', 'hour', ?3, 19, 19, 1,
               '2026-07-01T00:00:00Z')",
            rusqlite::params![rollup_only_id, old_key, rollup_only_hour],
        )
        .unwrap();
        let before: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(total_tokens), 0) FROM tokenomics_usage_events",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let pruned_before: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(total_tokens), 0) FROM tokenomics_pruned_usage_rollups",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let rollup_before: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(total_tokens), 0) FROM tokenomics_rollups",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let scope = TokenomicsBillingScope {
            scope_type: "personal".to_string(),
            team_id: None,
            source: "test".to_string(),
        };
        for (key, label, attribution, first_seen, last_seen, updated_unix) in [
            (
                old_key,
                "Synthetic Badge",
                "synthetic_source",
                "2020-01-01T00:00:00Z",
                "2021-01-01T00:00:00Z",
                1_i64,
            ),
            (
                canonical_key,
                "Canonical Badge",
                "canonical_source",
                "2022-01-01T00:00:00Z",
                "2023-01-01T00:00:00Z",
                2_i64,
            ),
        ] {
            let id = tokenomics_provider_account_row_id(
                "device-test",
                "anthropic",
                "claude",
                key,
                &scope,
            );
            conn.execute(
                "INSERT INTO tokenomics_provider_accounts(
                   id, device_id, provider, agent_kind, provider_account_key,
                   provider_account_label, billing_scope_type, billing_scope_source,
                   attribution_source, first_seen_at, last_seen_at, updated_at,
                   updated_at_unix
                 ) VALUES(?1, 'device-test', 'anthropic', 'claude', ?2, ?3,
                   'personal', 'test', ?4, ?5, ?6, ?6, ?7)",
                rusqlite::params![
                    id,
                    key,
                    label,
                    attribution,
                    first_seen,
                    last_seen,
                    updated_unix,
                ],
            )
            .unwrap();
        }

        tokenomics_persist_retired_provider_account_key(
            &conn,
            "anthropic",
            "claude",
            old_key,
            Some(canonical_key),
        )
        .unwrap();

        let after: (i64, i64) = conn
            .query_row(
                "SELECT COALESCE(SUM(total_tokens), 0),
                        SUM(CASE WHEN provider_account_key=?1 THEN 1 ELSE 0 END)
                 FROM tokenomics_usage_events",
                rusqlite::params![old_key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(after, (before, 0));
        let pruned_after: (i64, i64, i64) = conn
            .query_row(
                "SELECT COALESCE(SUM(total_tokens), 0), COUNT(*),
                        SUM(CASE WHEN provider_account_key=?1 THEN 1 ELSE 0 END)
                 FROM tokenomics_pruned_usage_rollups",
                rusqlite::params![old_key],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(pruned_after, (pruned_before, 1, 0));
        let rollup_total: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(total_tokens), 0) FROM tokenomics_rollups",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rollup_total, rollup_before);
        let account_metadata: (String, String, String, String) = conn
            .query_row(
                "SELECT provider_account_label, attribution_source,
                        first_seen_at, last_seen_at
                 FROM tokenomics_provider_accounts
                 WHERE provider_account_key=?1",
                rusqlite::params![canonical_key],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            account_metadata,
            (
                "Canonical Badge".to_string(),
                "canonical_source".to_string(),
                "2020-01-01T00:00:00Z".to_string(),
                "2023-01-01T00:00:00Z".to_string(),
            )
        );
        assert!(tokenomics_retired_provider_account_keys(&conn)
            .iter()
            .any(|key| key == old_key));
    }

    #[test]
    fn opencode_account_label_uses_short_key_fingerprint_tag() {
        let _storage = process_test_storage_isolation(stringify!(opencode_account_label_uses_short_key_fingerprint_tag));
        let _guard = TOKENOMICS_OPENCODE_TEST_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());

        let dir = tokenomics_test_temp_path("opencode-label", "dir");
        let _ = fs::remove_dir_all(&dir);
        let data_dir = dir.join("opencode");
        fs::create_dir_all(&data_dir).unwrap();
        fs::write(
            data_dir.join("auth.json"),
            r#"{"opencode-go":{"type":"api","key":"sk-label-key"}}"#,
        )
        .unwrap();

        let _data_env = ProcessTestEnvVarGuard::set("XDG_DATA_HOME", &dir);

        // The account's display label is a short tag of the key fingerprint
        // (same hash the accounts panel shows) so the usage filter chip and the
        // account card line up — not the generic "OpenCode account <suffix>".
        let account = tokenomics_provider_account("opencode", "opencode");
        assert!(account.key.starts_with("opencode:opencode:"));
        assert!(!account.key.ends_with(":unknown"));
        let expected_tag = cloud_mcp_short_hash("sk-label-key");
        assert_eq!(account.label, format!("OpenCode {expected_tag}"));
        assert_ne!(account.label, "OpenCode account");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn opencode_oauth_account_key_survives_access_and_refresh_rotation() {
        let before = json!({
            "provider-oauth": {
                "type": "oauth",
                "accountId": "stable-account",
                "access": "access-before",
                "refresh": "refresh-before"
            }
        });
        let after = json!({
            "provider-oauth": {
                "type": "oauth",
                "accountId": "stable-account",
                "access": "access-after",
                "refresh": "refresh-after"
            }
        });
        let before_account =
            tokenomics_provider_account_from_auth("opencode", "opencode", Some(&before));
        let after_account =
            tokenomics_provider_account_from_auth("opencode", "opencode", Some(&after));
        assert_eq!(before_account.key, after_account.key);
        assert_eq!(before_account.label, after_account.label);
        assert!(!before_account.key.ends_with(":unknown"));
    }

    #[test]
    fn codex_account_key_separates_same_email_workspaces_and_rejects_subject() {
        let encode = |claims: Value| {
            let claims =
                general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap());
            json!({ "tokens": { "id_token": format!("h.{claims}.s") } })
        };
        let personal = encode(json!({
            "email": "shared@example.com",
            "sub": "same-person",
            "chatgpt_account_id": "workspace-personal"
        }));
        let organization = encode(json!({
            "email": "shared@example.com",
            "sub": "same-person",
            "chatgpt_account_id": "workspace-org"
        }));
        let subject_only = encode(json!({
            "email": "shared@example.com",
            "sub": "same-person"
        }));
        let personal = tokenomics_provider_account_from_auth("openai", "codex", Some(&personal));
        let organization =
            tokenomics_provider_account_from_auth("openai", "codex", Some(&organization));
        let subject_only =
            tokenomics_provider_account_from_auth("openai", "codex", Some(&subject_only));
        assert_ne!(personal.key, organization.key);
        assert!(subject_only.key.ends_with(":unknown"));
    }

    fn tokenomics_test_current_hour_bucket() -> String {
        tokenomics_utc_hour_bucket_from_unix(tokenomics_unix_now()).1
    }

    fn tokenomics_test_temp_path(label: &str, extension: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let mut path = std::env::temp_dir();
        path.push(format!(
            "diffforge-tokenomics-{label}-{}-{nanos}.{extension}",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);
        path
    }

    #[test]
    fn tokenomics_buckets_parse_legacy_hour_only_timestamp() {
        let (day, hour) = tokenomics_buckets("2026-05-17T05");
        assert_eq!(day, "2026-05-17");
        assert_eq!(hour, "2026-05-17T05:00:00Z");
    }

    #[test]
    fn tokenomics_rollup_rebuild_normalizes_legacy_event_buckets() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_rollup_rebuild_normalizes_legacy_event_buckets));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        conn.execute(
            "INSERT INTO tokenomics_usage_events(
               id, provider, agent_kind, model, subscription_key,
               provider_account_key, source_kind, source_path, bucket_day, bucket_hour,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
               total_tokens, estimated_cost_microusd, created_at, observed_at
             ) VALUES(
               'legacy-hour-event', 'openai', 'codex', 'gpt-5.4', 'openai:codex:test',
               'openai:codex:test', 'test', '/tmp/session.jsonl', '2026-05-17',
               '2026-05-17T05', 10, 2, 3, 0, 12, 0,
               '2026-05-17T05:42:00Z', '2026-05-17T05:42:00Z'
             )",
            [],
        )
        .unwrap();

        tokenomics_rebuild_all_rollups_from_events(&conn).unwrap();

        let event = tokenomics_query_one(
            &conn,
            "SELECT bucket_day, bucket_hour FROM tokenomics_usage_events WHERE id='legacy-hour-event'",
        )
        .unwrap();
        assert_eq!(event["bucket_day"], json!("2026-05-17"));
        assert_eq!(event["bucket_hour"], json!("2026-05-17T05:00:00Z"));

        let rollup = tokenomics_query_one(
            &conn,
            "SELECT bucket_start, total_tokens FROM tokenomics_rollups WHERE id IS NOT NULL",
        )
        .unwrap();
        assert_eq!(rollup["bucket_start"], json!("2026-05-17T05:00:00Z"));
        assert_eq!(rollup["total_tokens"], json!(12));
    }

    #[test]
    fn tokenomics_rollup_rebuild_coalesces_legacy_identity_duplicates() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_rollup_rebuild_coalesces_legacy_identity_duplicates));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO tokenomics_usage_events(
               id, device_id, provider, agent_kind, model, subscription_key,
               provider_account_key, billing_scope_type, billing_team_id, workspace_id,
               source_kind, bucket_day, bucket_hour,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
               total_tokens, estimated_cost_microusd, observed_at
             ) VALUES
             (
               'legacy-empty-identity', 'desktop-primary', 'openai', 'codex', '', '',
               '', '', '', '', 'test', '2026-05-17', '2026-05-17T05:00:00Z',
               10, 2, 3, 0, 15, 0, '2026-05-17T05:42:00Z'
             ),
             (
               'legacy-null-identity', 'desktop-primary', 'openai', 'codex', NULL, NULL,
               NULL, 'unknown', NULL, NULL, 'test', '2026-05-17', '2026-05-17T05:00:00Z',
               20, 4, 6, 0, 30, 0, '2026-05-17T05:43:00Z'
             )",
        )
        .unwrap();

        tokenomics_rebuild_all_rollups_from_events(&conn).unwrap();

        let rollup = tokenomics_query_one(
            &conn,
            "SELECT COUNT(*) AS count, SUM(total_tokens) AS total_tokens
             FROM tokenomics_rollups
             WHERE provider='openai' AND agent_kind='codex'",
        )
        .unwrap();
        assert_eq!(rollup["count"], json!(1));
        assert_eq!(rollup["total_tokens"], json!(45));
    }

    #[test]
    fn tokenomics_prepare_db_migrates_legacy_cloud_rollups_before_indexes() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_prepare_db_migrates_legacy_cloud_rollups_before_indexes));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tokenomics_cloud_rollups(
               id TEXT PRIMARY KEY,
               device_id TEXT NOT NULL,
               provider TEXT NOT NULL,
               agent_kind TEXT NOT NULL,
               model TEXT,
               bucket_width TEXT NOT NULL,
               bucket_start TEXT NOT NULL,
               input_tokens INTEGER NOT NULL DEFAULT 0,
               output_tokens INTEGER NOT NULL DEFAULT 0,
               cache_read_tokens INTEGER NOT NULL DEFAULT 0,
               cache_write_tokens INTEGER NOT NULL DEFAULT 0,
               total_tokens INTEGER NOT NULL DEFAULT 0,
               estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
               event_count INTEGER NOT NULL DEFAULT 0,
               updated_at TEXT NOT NULL,
               received_at TEXT NOT NULL
             );
             INSERT INTO tokenomics_cloud_rollups(
               id, device_id, provider, agent_kind, model, bucket_width, bucket_start,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
               total_tokens, estimated_cost_microusd, event_count, updated_at, received_at
             ) VALUES(
               'legacy-cloud', 'remote-device', 'openai', 'codex', 'gpt-5.5',
               'hour', '2026-05-30T05', 1, 2, 0, 0, 3, 0, 1,
               '2026-05-30T05:00:00Z', '2026-05-30T05:00:00Z'
             );",
        )
        .unwrap();

        tokenomics_prepare_db(&conn).unwrap();

        let mut statement = conn
            .prepare("PRAGMA table_info(tokenomics_cloud_rollups)")
            .unwrap();
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(Result::unwrap)
            .collect::<Vec<_>>();
        assert!(columns.iter().any(|column| column == "billing_scope_type"));
        assert!(columns
            .iter()
            .any(|column| column == "provider_account_key"));
        assert!(columns.iter().any(|column| column == "workspace_id"));

        let (scope_type, provider_account_key, workspace_id): (
            String,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT billing_scope_type, provider_account_key, workspace_id
                 FROM tokenomics_display_rollups
                 WHERE id='legacy-cloud'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(scope_type, "unknown");
        assert!(provider_account_key.is_none());
        assert!(workspace_id.is_none());

        let index_count: i64 = conn
            .query_row(
                "SELECT COUNT(*)
                 FROM sqlite_master
                 WHERE type='index'
                   AND name='idx_tokenomics_cloud_rollups_scope'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(index_count, 1);
    }

    #[test]
    fn tokenomics_codex_usage_cache_reuses_fresh_weekly_snapshot() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_codex_usage_cache_reuses_fresh_weekly_snapshot));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let usage = json!({
            "rate_limit": {
                "primary_window": {
                    "used_percent": 20,
                    "reset_after_seconds": 300
                },
                "secondary_window": {
                    "used_percent": 60,
                    "reset_after_seconds": 604_800
                }
            }
        });
        tokenomics_store_codex_usage_cache_at(&conn, "codex-usage-cache-test", &usage, 1_000)
            .unwrap();

        let cached = tokenomics_cached_codex_usage(
            &conn,
            "codex-usage-cache-test",
            1_005,
            TOKENOMICS_CODEX_USAGE_CACHE_TTL_SECS,
        )
        .unwrap()
        .expect("fresh cache");

        assert_eq!(
            cached["rate_limit"]["primary_window"]["reset_after_seconds"],
            json!(295)
        );
        assert_eq!(
            cached["rate_limit"]["secondary_window"]["reset_after_seconds"],
            json!(604_795)
        );
        assert_eq!(cached["updated_at"], json!("unix:1000"));
    }

    #[test]
    fn tokenomics_repair_deletes_mislabeled_codex_session_windows() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_repair_deletes_mislabeled_codex_session_windows));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        conn.execute(
            "DELETE FROM tokenomics_meta WHERE key='codex_session_window_kind_repair_v1'",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tokenomics_latest_windows(
               id, device_id, provider, agent_kind, provider_account_key,
               window_kind, sample_at, sample_at_unix, limit_window_seconds,
               updated_at, updated_at_unix
             ) VALUES
               ('bad-5h', 'device-a', 'openai', 'codex', 'acct', 'session_5h', 'unix:1000', 1000, 604800, 'unix:1000', 1000),
               ('good-5h', 'device-a', 'openai', 'codex', 'acct', 'session_5h', 'unix:1000', 1000, 18000, 'unix:1000', 1000),
               ('good-weekly', 'device-a', 'openai', 'codex', 'acct', 'weekly', 'unix:1000', 1000, 604800, 'unix:1000', 1000),
               ('claude-5h', 'device-a', 'anthropic', 'claude', 'acct', 'session_5h', 'unix:1000', 1000, 18000, 'unix:1000', 1000)",
            [],
        )
        .unwrap();

        tokenomics_repair_codex_mislabeled_session_windows(&conn).unwrap();

        let ids: Vec<String> = conn
            .prepare("SELECT id FROM tokenomics_latest_windows ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(ids, vec!["claude-5h", "good-5h", "good-weekly"]);

        // Meta-gated: reinserting the bad row and re-running is a no-op.
        conn.execute(
            "INSERT INTO tokenomics_latest_windows(
               id, device_id, provider, agent_kind, provider_account_key,
               window_kind, sample_at, sample_at_unix, limit_window_seconds,
               updated_at, updated_at_unix
             ) VALUES
               ('bad-again', 'device-a', 'openai', 'codex', 'acct', 'session_5h', 'unix:1000', 1000, 604800, 'unix:1000', 1000)",
            [],
        )
        .unwrap();
        tokenomics_repair_codex_mislabeled_session_windows(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_latest_windows WHERE id='bad-again'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn tokenomics_codex_usage_cache_expires_after_stale_window() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_codex_usage_cache_expires_after_stale_window));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        tokenomics_store_codex_usage_cache_at(
            &conn,
            "codex-usage-cache-test",
            &json!({"rate_limit": {"secondary_window": {"reset_after_seconds": 604_800}}}),
            1_000,
        )
        .unwrap();

        let expired = tokenomics_cached_codex_usage(
            &conn,
            "codex-usage-cache-test",
            1_000 + TOKENOMICS_CODEX_USAGE_CACHE_STALE_SECS + 1,
            TOKENOMICS_CODEX_USAGE_CACHE_STALE_SECS,
        )
        .unwrap();

        assert!(expired.is_none());
    }

    #[test]
    fn tokenomics_buckets_normalize_iso_offsets_to_utc_hours() {
        let (day, hour) = tokenomics_buckets("2026-05-30T23:30:00-02:00");

        assert_eq!(day, "2026-05-31");
        assert_eq!(hour, "2026-05-31T01:00:00Z");

        let (day, hour) = tokenomics_buckets("2026-05-31T00:15:00+05:30");
        assert_eq!(day, "2026-05-30");
        assert_eq!(hour, "2026-05-30T18:00:00Z");
    }

    #[test]
    fn tokenomics_latest_windows_use_v2_session_replacement_rows() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_latest_windows_use_v2_session_replacement_rows));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let scope = tokenomics_unknown_billing_scope();
        let limits = vec![json!({
            "device_id": "device-a",
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": "openai:codex:acct-a",
            "provider_account_label": "Codex A",
            "window_kind": "5_hour",
            "updated_at": "unix:1000",
            "used_percent": 40,
            "remaining_percent": 60,
            "reset_after_seconds": 3600,
            "confidence": "live",
        })];

        assert_eq!(tokenomics_record_latest_windows(&conn, &limits).unwrap(), 1);
        let windows = tokenomics_latest_window_rows(&conn, None, Some(&scope)).unwrap();
        let accounts = tokenomics_provider_account_rows(&conn, None, Some(&scope)).unwrap();

        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0]["window_kind"], json!("session_5h"));
        assert_eq!(windows[0]["provider_window_kind"], json!("5_hour"));
        assert_eq!(windows[0]["replacement"], json!(true));
        assert_eq!(windows[0]["used_percent"], json!(40));
        assert!(accounts
            .iter()
            .any(|row| row["provider_account_key"] == json!("openai:codex:acct-a")));
    }

    #[test]
    fn tokenomics_compaction_keeps_accounts_referenced_only_by_pruned_rollups() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_compaction_keeps_accounts_referenced_only_by_pruned_rollups));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let account_key = "openai:codex:pruned-only";
        tokenomics_upsert_provider_account(
            &conn,
            "device-pruned-only",
            "openai",
            "codex",
            account_key,
            Some("Pruned Only"),
            &TokenomicsBillingScope {
                scope_type: "personal".to_string(),
                team_id: None,
                source: "test".to_string(),
            },
            "test",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tokenomics_pruned_usage_rollups(
               id, device_id, provider, agent_kind, subscription_key,
               provider_account_key, provider_account_label, billing_scope_type,
               billing_scope_source, bucket_width, bucket_start, total_tokens,
               event_count, updated_at
             ) VALUES(
               'pruned-only-rollup', 'device-pruned-only', 'openai', 'codex', ?1,
               ?1, 'Pruned Only', 'personal', 'test', 'hour',
               '2026-05-30T04:00:00Z', 21, 1, '2026-05-30T05:00:00Z'
             )",
            rusqlite::params![account_key],
        )
        .unwrap();

        tokenomics_compact_provider_account_rows(&conn).unwrap();

        let account_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_provider_accounts
                 WHERE provider='openai' AND agent_kind='codex'
                   AND provider_account_key=?1",
                rusqlite::params![account_key],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(account_count, 1);
    }

    #[test]
    fn tokenomics_account_sync_rollups_collapse_workspace_metadata() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_account_sync_rollups_collapse_workspace_metadata));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let bucket_start = tokenomics_test_current_hour_bucket();
        for (id, workspace_id, repo_path, input_tokens, output_tokens, total_tokens) in [
            (
                "rollup-a",
                "workspace-a",
                "/tmp/repo-a",
                2_i64,
                3_i64,
                5_i64,
            ),
            (
                "rollup-b",
                "workspace-b",
                "/tmp/repo-b",
                4_i64,
                3_i64,
                7_i64,
            ),
        ] {
            conn.execute(
                "INSERT INTO tokenomics_rollups(
                   id, provider, agent_kind, model, subscription_key, workspace_id, repo_path,
                   bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
                   cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
	                 ) VALUES(
	                   ?1, 'openai', 'codex', NULL, 'openai:codex', ?2, ?3,
	                   'hour', ?7, ?4, ?5, 0,
	                   0, ?6, 0, 1, '2026-05-30T05:00:00Z'
	                 )",
                rusqlite::params![
                    id,
                    workspace_id,
                    repo_path,
                    input_tokens,
                    output_tokens,
                    total_tokens,
                    bucket_start.as_str(),
                ],
            )
            .unwrap();
        }

        let rollups = tokenomics_account_hourly_sync_rollups(&conn, None, None).unwrap();

        assert_eq!(rollups.len(), 1);
        assert!(rollups[0]["workspace_id"].is_null());
        assert!(rollups[0]["repo_path"].is_null());
        assert_eq!(rollups[0]["input_tokens"], json!(6));
        assert_eq!(rollups[0]["output_tokens"], json!(6));
        assert_eq!(rollups[0]["total_tokens"], json!(12));
        assert_eq!(rollups[0]["event_count"], json!(2));
        assert_eq!(rollups[0]["model"], json!("codex"));
    }

    #[test]
    fn tokenomics_account_sync_rollups_fall_back_to_component_totals() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_account_sync_rollups_fall_back_to_component_totals));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let bucket_start = tokenomics_test_current_hour_bucket();
        conn.execute(
            "INSERT INTO tokenomics_rollups(
	               id, provider, agent_kind, model, subscription_key,
	               bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
	               cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
	             ) VALUES(
	               'rollup-component-total', 'anthropic', 'claude', 'fable-5', 'anthropic:claude',
	               'hour', ?1, 2, 3, 5,
	               7, 0, 0, 1, '2026-05-30T05:00:00Z'
	             )",
            rusqlite::params![bucket_start],
        )
        .unwrap();

        let rollups = tokenomics_account_hourly_sync_rollups(&conn, None, None).unwrap();

        assert_eq!(rollups.len(), 1);
        assert_eq!(rollups[0]["total_tokens"], json!(17));
        assert_eq!(rollups[0]["input_tokens"], json!(2));
        assert_eq!(rollups[0]["output_tokens"], json!(3));
        assert_eq!(rollups[0]["cache_read_tokens"], json!(5));
        assert_eq!(rollups[0]["cache_write_tokens"], json!(7));
    }

    #[test]
    fn tokenomics_account_sync_rollups_skip_legacy_unix_hour_buckets() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_account_sync_rollups_skip_legacy_unix_hour_buckets));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let bucket_start = tokenomics_test_current_hour_bucket();
        for (id, bucket_start, total_tokens) in [
            ("rollup-canonical", bucket_start.as_str(), 5_i64),
            ("rollup-legacy", "unix-hour-legacy", 7_i64),
        ] {
            conn.execute(
                "INSERT INTO tokenomics_rollups(
	               id, provider, agent_kind, model, subscription_key,
	               bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
	               cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
	             ) VALUES(
	               ?1, 'openai', 'codex', 'gpt-5.5', 'openai:codex',
	               'hour', ?2, 0, 0, 0,
	               0, ?3, 0, 1, '2026-05-30T05:00:00Z'
	             )",
                rusqlite::params![id, bucket_start, total_tokens],
            )
            .unwrap();
        }

        let rollups = tokenomics_account_hourly_sync_rollups(&conn, None, None).unwrap();

        assert_eq!(rollups.len(), 1);
        assert_eq!(rollups[0]["bucket_start"], json!(bucket_start));
        assert_eq!(rollups[0]["total_tokens"], json!(5));
    }

    #[test]
    fn tokenomics_existing_source_identity_reuses_historical_codex_provider() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_existing_source_identity_reuses_historical_codex_provider));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();

        tokenomics_insert_event(
            &conn,
            &TokenomicsUsageEvent {
                id: "historical-codex-event".to_string(),
                device_id: "macos-history".to_string(),
                provider: "openai".to_string(),
                agent_kind: "codex".to_string(),
                model: Some("gpt-5.5".to_string()),
                subscription_key: Some("openai:codex:d9b6c65b".to_string()),
                provider_account_key: Some("openai:codex:d9b6c65b".to_string()),
                provider_account_label: Some("Digital Agency".to_string()),
                source_request_id: None,
                billing_scope_type: "personal".to_string(),
                billing_team_id: None,
                billing_scope_source: "legacy_provider_restore".to_string(),
                workspace_id: None,
                repo_path: None,
                source_kind: "codex_token_count_jsonl".to_string(),
                source_path: Some("/tmp/history.jsonl:codex".to_string()),
                bucket_day: "2026-05-31".to_string(),
                bucket_hour: "2026-05-31T00".to_string(),
                input_tokens: 10,
                output_tokens: 2,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
                total_tokens: 12,
                estimated_cost_microusd: 0,
                created_at: Some("2026-05-31T00:00:00Z".to_string()),
                observed_at: "2026-05-31T00:00:00Z".to_string(),
            },
        )
        .unwrap();

        let identity = tokenomics_existing_source_identity(
            &conn,
            "openai",
            "codex",
            Path::new("/tmp/history.jsonl"),
        )
        .unwrap()
        .unwrap();

        assert_eq!(identity.provider_account.key, "openai:codex:d9b6c65b");
        assert_eq!(identity.provider_account.label, "Digital Agency");
        assert_eq!(identity.billing_scope.scope_type, "personal");
        assert_eq!(identity.billing_scope.source, "legacy_provider_restore");
    }

    #[test]
    fn tokenomics_summary_uses_hourly_replacements_without_day_double_counting() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_summary_uses_hourly_replacements_without_day_double_counting));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let bucket_start = tokenomics_test_current_hour_bucket();
        let day_start = bucket_start.get(0..10).unwrap_or("1970-01-01").to_string();

        for (id, bucket_width, bucket_start, total_tokens) in [
            ("hour-rollup", "hour", bucket_start.as_str(), 12_i64),
            ("day-rollup", "day", day_start.as_str(), 999_i64),
        ] {
            conn.execute(
                "INSERT INTO tokenomics_rollups(
                   id, device_id, provider, agent_kind, model, subscription_key,
                   provider_account_key, provider_account_label,
                   billing_scope_type, billing_team_id, billing_scope_source,
                   workspace_id, repo_path,
                   bucket_width, bucket_start, input_tokens, output_tokens,
                   cache_read_tokens, cache_write_tokens, total_tokens,
                   estimated_cost_microusd, event_count, updated_at
                 ) VALUES(
                   ?1, 'device-a', 'openai', 'codex', 'gpt-5.5', 'openai:codex:work',
                   'openai:codex:work', 'Work',
                   'personal', NULL, 'test',
                   NULL, NULL,
                   ?2, ?3, ?4, 0,
                   0, 0, ?4,
                   0, 1, '2026-05-31T00:00:00Z'
                 )",
                rusqlite::params![id, bucket_width, bucket_start, total_tokens],
            )
            .unwrap();
        }

        let summary = tokenomics_summary_from_conn(&conn, false, None).unwrap();

        assert_eq!(summary["total"]["total_tokens"], json!(12));
        assert_eq!(summary["hourly"][0]["total_tokens"], json!(12));
        assert_eq!(
            summary["daily_by_device_provider"][0]["total_tokens"],
            json!(12)
        );
        assert_eq!(
            summary["hourly"][0]["provider_account_key"],
            json!("openai:codex:work")
        );
        assert_eq!(summary["hourly"][0]["replacement"], json!(true));
        assert!(summary.get("daily").is_none());
    }

    #[test]
    fn tokenomics_codex_import_ledger_repair_tombstones_orphaned_event_rows() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_codex_import_ledger_repair_tombstones_orphaned_event_rows));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let (_, bucket_start) =
            tokenomics_utc_hour_bucket_from_unix(tokenomics_unix_now().saturating_sub(3 * 86_400));
        let day_start = bucket_start.get(0..10).unwrap_or("1970-01-01").to_string();

        for (id, source_path, input_tokens, output_tokens) in [
            (
                "orphan-event",
                "/tmp/orphan-codex-session.jsonl:vscode",
                100_i64,
                2_i64,
            ),
            (
                "ledger-event",
                "/tmp/ledger-codex-session.jsonl:vscode",
                5_i64,
                1_i64,
            ),
        ] {
            conn.execute(
                "INSERT INTO tokenomics_usage_events(
                   id, provider, agent_kind, model, subscription_key,
                   provider_account_key, provider_account_label, source_kind, source_path,
                   bucket_day, bucket_hour, input_tokens, output_tokens,
                   cache_read_tokens, cache_write_tokens, total_tokens,
                   estimated_cost_microusd, created_at, observed_at
                 ) VALUES(
                   ?1, 'openai', 'codex', 'gpt-5.5', 'openai:codex:work',
                   'openai:codex:work', 'Work', 'codex_token_count_jsonl', ?2,
                   ?3, ?4, ?5, ?6,
                   0, 0, ?7,
                   0, ?4, '2026-06-01T00:00:00Z'
                 )",
                rusqlite::params![
                    id,
                    source_path,
                    day_start.as_str(),
                    bucket_start.as_str(),
                    input_tokens,
                    output_tokens,
                    input_tokens + output_tokens,
                ],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO tokenomics_source_imports(
               provider, agent_kind, source_path, source_id, source_session_id,
               source_kind, scanner_version, event_count, raw_available,
               import_status, updated_at
             ) VALUES(
               'openai', 'codex', '/tmp/ledger-codex-session.jsonl',
               '/tmp/state_5.sqlite', 'thread-ledger',
               'codex_token_count_jsonl', ?1, 1, 1,
               'complete', '2026-06-01T00:00:00Z'
             )",
            rusqlite::params![TOKENOMICS_LEGACY_CODEX_SCANNER_VERSION],
        )
        .unwrap();
        conn.execute(
            "UPDATE tokenomics_source_imports
             SET last_event_timestamp=?1
             WHERE source_path='/tmp/ledger-codex-session.jsonl'",
            rusqlite::params![tokenomics_unix_now() as i64],
        )
        .unwrap();
        tokenomics_rebuild_provider_rollups_from_events(&conn, "openai", "codex").unwrap();
        conn.execute(
            "DELETE FROM tokenomics_meta WHERE key='codex_import_ledger_repair_version'",
            [],
        )
        .unwrap();

        tokenomics_repair_codex_orphaned_import_rows(&conn).unwrap();

        let totals = tokenomics_query_one(
            &conn,
            "SELECT COUNT(*) AS events, COALESCE(SUM(input_tokens), 0) AS input_tokens,
                    COALESCE(SUM(total_tokens), 0) AS total_tokens
             FROM tokenomics_usage_events
             WHERE provider='openai' AND agent_kind='codex'",
        )
        .unwrap();
        assert_eq!(totals["events"], json!(1));
        assert_eq!(totals["input_tokens"], json!(5));
        assert_eq!(totals["total_tokens"], json!(6));

        let pruned = tokenomics_query_one(
            &conn,
            "SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
                    COALESCE(SUM(total_tokens), 0) AS total_tokens,
                    COALESCE(SUM(event_count), 0) AS event_count
             FROM tokenomics_pruned_usage_rollups
             WHERE provider='openai' AND agent_kind='codex'",
        )
        .unwrap();
        assert_eq!(pruned["input_tokens"], json!(100));
        assert_eq!(pruned["total_tokens"], json!(102));
        assert_eq!(pruned["event_count"], json!(1));

        let rollup = tokenomics_query_one(
            &conn,
            "SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
                    COALESCE(SUM(total_tokens), 0) AS total_tokens
             FROM tokenomics_rollups
             WHERE provider='openai' AND agent_kind='codex' AND bucket_width='hour'",
        )
        .unwrap();
        assert_eq!(rollup["input_tokens"], json!(105));
        assert_eq!(rollup["total_tokens"], json!(108));
    }

    #[test]
    fn tokenomics_summary_v2_includes_rolling_daily_rows_without_legacy_monthly() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_summary_v2_includes_rolling_daily_rows_without_legacy_monthly));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();

        for day_offset in 0..35_i64 {
            let modifier = format!("-{day_offset} days");
            let bucket_start: String = conn
                .query_row(
                    "SELECT date('now', ?1)",
                    rusqlite::params![modifier.as_str()],
                    |row| row.get(0),
                )
                .unwrap();
            conn.execute(
                "INSERT INTO tokenomics_rollups(
                   id, provider, agent_kind, model, subscription_key,
                   provider_account_key, provider_account_label, workspace_id, repo_path,
                   bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
                   cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
                 ) VALUES(
                   ?1, 'openai', 'codex', 'gpt-5.5', 'openai:codex:personal',
                   'openai:codex:personal', 'Personal', NULL, NULL,
                   'day', ?2, ?3, 0, 0,
                   0, ?3, 0, 1, '2026-05-30T05:00:00Z'
                 )",
                rusqlite::params![
                    format!("rollup-day-{day_offset}"),
                    bucket_start,
                    day_offset + 1,
                ],
            )
            .unwrap();
        }

        let summary = tokenomics_summary_from_conn(&conn, false, None).unwrap();
        assert_eq!(summary["schema_version"], json!("tokenomics_v2"));
        let daily = summary["daily_by_device_provider"].as_array().unwrap();
        assert_eq!(daily.len(), 30);
        assert!(summary.get("daily").is_none());
        assert!(summary.get("monthly").is_none());
        assert!(summary.get("monthly_by_device_provider").is_none());
        assert_eq!(summary["total"]["total_tokens"], json!(0));
    }

    #[test]
    fn tokenomics_account_sync_rollups_preserve_provider_accounts() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_account_sync_rollups_preserve_provider_accounts));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let bucket_start = tokenomics_test_current_hour_bucket();
        for (id, account_key, account_label, total_tokens) in [
            (
                "rollup-personal",
                "openai:codex:personal",
                "Codex personal",
                5_i64,
            ),
            ("rollup-work", "openai:codex:work", "Codex work", 7_i64),
        ] {
            conn.execute(
                "INSERT INTO tokenomics_rollups(
                   id, provider, agent_kind, model, subscription_key,
                   provider_account_key, provider_account_label, workspace_id, repo_path,
                   bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
                   cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
	                 ) VALUES(
	                   ?1, 'openai', 'codex', NULL, ?2,
	                   ?2, ?3, NULL, NULL,
	                   'hour', ?5, 0, 0, 0,
	                   0, ?4, 0, 1, '2026-05-30T05:00:00Z'
	                 )",
                rusqlite::params![
                    id,
                    account_key,
                    account_label,
                    total_tokens,
                    bucket_start.as_str(),
                ],
            )
            .unwrap();
        }

        let rollups = tokenomics_account_hourly_sync_rollups(&conn, None, None).unwrap();

        assert_eq!(rollups.len(), 2);
        assert!(rollups.iter().any(|row| row["provider_account_key"]
            == json!("openai:codex:personal")
            && row["total_tokens"] == json!(5)));
        assert!(rollups.iter().any(|row| row["provider_account_key"]
            == json!("openai:codex:work")
            && row["total_tokens"] == json!(7)));
    }

    #[test]
    fn tokenomics_account_sync_rollups_preserve_models_for_same_account() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_account_sync_rollups_preserve_models_for_same_account));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let bucket_start = tokenomics_test_current_hour_bucket();
        for (id, model, total_tokens) in [
            ("rollup-gpt-55", "gpt-5.5", 5_i64),
            ("rollup-spark", "gpt-5.3-codex-spark", 7_i64),
        ] {
            conn.execute(
                "INSERT INTO tokenomics_rollups(
                   id, provider, agent_kind, model, subscription_key,
                   provider_account_key, provider_account_label, workspace_id, repo_path,
                   bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
                   cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
	                 ) VALUES(
	                   ?1, 'openai', 'codex', ?2, 'openai:codex:personal',
	                   'openai:codex:personal', 'Codex personal', NULL, NULL,
	                   'hour', ?4, 0, 0, 0,
	                   0, ?3, 0, 1, '2026-05-30T05:00:00Z'
	                 )",
                rusqlite::params![id, model, total_tokens, bucket_start.as_str()],
            )
            .unwrap();
        }

        let rollups = tokenomics_account_hourly_sync_rollups(&conn, None, None).unwrap();

        assert_eq!(rollups.len(), 2);
        assert!(rollups.iter().any(|row| {
            row["model"] == json!("gpt-5.5")
                && row["provider_account_key"] == json!("openai:codex:personal")
                && row["total_tokens"] == json!(5)
        }));
        assert!(rollups.iter().any(|row| {
            row["model"] == json!("gpt-5.3-codex-spark")
                && row["provider_account_key"] == json!("openai:codex:personal")
                && row["total_tokens"] == json!(7)
        }));
    }

    #[test]
    fn tokenomics_account_sync_rollups_preserve_device_ids() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_account_sync_rollups_preserve_device_ids));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let bucket_start = tokenomics_test_current_hour_bucket();
        for (id, device_id, total_tokens) in [
            ("rollup-device-a", "device-a", 5_i64),
            ("rollup-device-b", "device-b", 7_i64),
        ] {
            conn.execute(
                "INSERT INTO tokenomics_rollups(
                   id, device_id, provider, agent_kind, model, subscription_key,
                   provider_account_key, provider_account_label, workspace_id, repo_path,
                   bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
                   cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
	                 ) VALUES(
	                   ?1, ?2, 'openai', 'codex', 'gpt-5.5', 'openai:codex:personal',
	                   'openai:codex:personal', 'Codex personal', NULL, NULL,
	                   'hour', ?4, 0, 0, 0,
	                   0, ?3, 0, 1, '2026-05-30T05:00:00Z'
	                 )",
                rusqlite::params![id, device_id, total_tokens, bucket_start.as_str()],
            )
            .unwrap();
        }

        let rollups = tokenomics_account_hourly_sync_rollups(&conn, None, None).unwrap();

        assert_eq!(rollups.len(), 2);
        assert!(rollups
            .iter()
            .any(|row| row["device_id"] == json!("device-a") && row["total_tokens"] == json!(5)));
        assert!(rollups
            .iter()
            .any(|row| row["device_id"] == json!("device-b") && row["total_tokens"] == json!(7)));
    }

    #[test]
    fn tokenomics_cloud_cache_is_display_only_and_device_aware() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_cloud_cache_is_display_only_and_device_aware));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let bucket_start = tokenomics_test_current_hour_bucket();
        let day_start = bucket_start.get(0..10).unwrap_or("1970-01-01").to_string();
        for (id, bucket_width, bucket_start) in [
            ("local-hour", "hour", bucket_start.as_str()),
            ("local-day", "day", day_start.as_str()),
        ] {
            conn.execute(
                "INSERT INTO tokenomics_rollups(
                   id, device_id, provider, agent_kind, model, subscription_key,
                   provider_account_key, provider_account_label, workspace_id, repo_path,
                   bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
                   cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
                 ) VALUES(
                   ?1, 'local-device', 'openai', 'codex', 'gpt-5.5', 'openai:codex:personal',
                   'openai:codex:personal', 'Codex personal', NULL, NULL,
                   ?2, ?3, 0, 0, 0,
                   0, 5, 0, 1, '2026-05-30T05:00:00Z'
                 )",
                rusqlite::params![id, bucket_width, bucket_start],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO tokenomics_cloud_rollups(
               id, device_id, provider, agent_kind, model, subscription_key,
               provider_account_key, provider_account_label, workspace_id, repo_path,
               bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
               cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at, received_at
             ) VALUES(
               'remote-hour', 'remote-device', 'openai', 'codex', 'gpt-5.5', 'openai:codex:personal',
               'openai:codex:personal', 'Codex personal', NULL, NULL,
               'hour', ?1, 0, 0, 0,
               0, 7, 0, 1, '2026-05-30T05:00:00Z', '2026-05-30T05:00:00Z'
             )",
            rusqlite::params![bucket_start.as_str()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tokenomics_cloud_rollups(
               id, device_id, provider, agent_kind, model, subscription_key,
               provider_account_key, provider_account_label, workspace_id, repo_path,
               bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
               cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at, received_at
             ) VALUES(
               'local-cloud-echo', ?1, 'openai', 'codex', 'gpt-5.5', 'openai:codex:personal',
               'openai:codex:personal', 'Codex personal', NULL, NULL,
               'hour', ?2, 0, 0, 0,
               0, 99, 0, 1, '2026-05-30T05:00:00Z', '2026-05-30T05:00:00Z'
             )",
            rusqlite::params![tokenomics_local_device_id(), bucket_start.as_str()],
        )
        .unwrap();
        tokenomics_refresh_cloud_daily_rollups(&conn).unwrap();

        let display = tokenomics_summary_from_conn_with_cloud(&conn, false, None, true).unwrap();
        let local_only =
            tokenomics_summary_from_conn_with_cloud(&conn, false, None, false).unwrap();
        let sync_rollups = tokenomics_account_hourly_sync_rollups(&conn, None, None).unwrap();
        let display_hourly = display["hourly"].as_array().unwrap();
        let local_hourly = local_only["hourly"].as_array().unwrap();

        assert_eq!(display["total"]["total_tokens"], json!(5));
        assert_eq!(local_only["total"]["total_tokens"], json!(5));
        assert!(display.get("by_device").is_none());
        assert_eq!(display_hourly.len(), 2);
        assert!(display_hourly.iter().any(|row| {
            row["device_id"] == json!("local-device") && row["total_tokens"] == json!(5)
        }));
        assert!(display_hourly.iter().any(|row| {
            row["device_id"] == json!("remote-device") && row["total_tokens"] == json!(7)
        }));
        assert!(!display_hourly
            .iter()
            .any(|row| row["id"] == json!("usage-hour:local-cloud-echo")
                || row["total_tokens"] == json!(99)));
        assert_eq!(local_hourly.len(), 1);
        assert_eq!(local_hourly[0]["device_id"], json!("local-device"));
        assert_eq!(sync_rollups.len(), 1);
        assert_eq!(sync_rollups[0]["device_id"], json!("local-device"));
    }

    #[test]
    fn tokenomics_cloud_cache_rejects_local_and_account_level_limit_facts() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_cloud_cache_rejects_local_and_account_level_limit_facts));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let local_device_id = tokenomics_local_device_id();
        let local_device_ids = tokenomics_local_device_id_set(&conn).unwrap();
        let scope = tokenomics_billing_scope_from_parts(Some("personal"), None, "test");
        let observed_at = tokenomics_now_iso_like();
        let summary = json!({
            "limits": [
                {
                    "device_id": local_device_id,
                    "provider": "openai",
                    "agent_kind": "codex",
                    "provider_account_key": "openai:codex:personal",
                    "window_kind": "weekly",
                    "used_percent": 80,
                    "remaining_percent": 20,
                    "updated_at": observed_at
                },
                {
                    "provider": "openai",
                    "agent_kind": "codex",
                    "provider_account_key": "openai:codex:personal",
                    "window_kind": "weekly",
                    "used_percent": 70,
                    "remaining_percent": 30,
                    "updated_at": observed_at
                },
                {
                    "device_id": "remote-device",
                    "provider": "openai",
                    "agent_kind": "codex",
                    "provider_account_key": "openai:codex:personal",
                    "window_kind": "weekly",
                    "used_percent": 35,
                    "remaining_percent": 65,
                    "updated_at": observed_at
                }
            ],
            "limit_samples": [
                {
                    "device_id": local_device_id,
                    "provider": "openai",
                    "agent_kind": "codex",
                    "provider_account_key": "openai:codex:personal",
                    "window_kind": "weekly",
                    "used_percent": 80,
                    "remaining_percent": 20,
                    "sample_at": observed_at
                },
                {
                    "provider": "openai",
                    "agent_kind": "codex",
                    "provider_account_key": "openai:codex:personal",
                    "window_kind": "weekly",
                    "used_percent": 70,
                    "remaining_percent": 30,
                    "sample_at": observed_at
                },
                {
                    "device_id": "remote-device",
                    "provider": "openai",
                    "agent_kind": "codex",
                    "provider_account_key": "openai:codex:personal",
                    "window_kind": "weekly",
                    "used_percent": 35,
                    "remaining_percent": 65,
                    "sample_at": observed_at
                }
            ]
        });

        let stored_limits = tokenomics_store_cloud_provider_limits(
            &conn,
            &summary,
            &scope,
            None,
            &local_device_ids,
        )
        .unwrap();
        let stored_samples = tokenomics_store_cloud_provider_limit_samples(
            &conn,
            &summary,
            &scope,
            None,
            &local_device_ids,
        )
        .unwrap();
        let cloud_limits = tokenomics_cloud_provider_limits(&conn).unwrap();
        let display_samples =
            tokenomics_provider_limit_sample_rows(&conn, None, None, true).unwrap();
        let sync_samples = tokenomics_provider_limit_sample_sync_rows(&conn, None, None).unwrap();

        assert_eq!(stored_limits, 1);
        assert_eq!(stored_samples, 1);
        assert_eq!(cloud_limits.len(), 1);
        assert_eq!(cloud_limits[0]["device_id"], json!("remote-device"));
        assert_eq!(display_samples.len(), 1);
        assert_eq!(display_samples[0]["device_id"], json!("remote-device"));
        assert!(sync_samples.is_empty());
    }

    #[test]
    fn tokenomics_cloud_relay_summary_flattens_hourly_groups_and_windows() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_cloud_relay_summary_flattens_hourly_groups_and_windows));
        let bucket_start = tokenomics_test_current_hour_bucket();
        let bucket_ms = tokenomics_timestamp_unix(&bucket_start)
            .unwrap()
            .saturating_mul(1000);
        let payload = json!({
            "kind": "tokenomics_device_delta",
            "device_id": "remote-device",
            "provider_accounts": [
                {
                    "provider_account_key": "openai:codex:personal",
                    "provider": "openai",
                    "agent_kind": "codex",
                    "label": "Codex remote"
                }
            ],
            "hourly_groups": [
                {
                    "bucket_start_ms": bucket_ms,
                    "observed_at_ms": bucket_ms + 60_000,
                    "rows": [
                        {
                            "provider_account_key": "openai:codex:personal",
                            "provider": "openai",
                            "agent_kind": "codex",
                            "model": "gpt-5.5",
                            "input": 10,
                            "output": 5,
                            "cache_read": 2,
                            "total": 17,
                            "events": 3
                        }
                    ]
                }
            ],
            "windows": [
                {
                    "provider_account_key": "openai:codex:personal",
                    "provider": "openai",
                    "agent_kind": "codex",
                    "window": "session_5h",
                    "used_percent": 44,
                    "remaining_percent": 56,
                    "observed_at_ms": bucket_ms + 60_000,
                    "reset_at_ms": bucket_ms + 3_600_000
                }
            ]
        });

        let summary = tokenomics_cloud_summary_payload(&payload);
        let hourly = summary["hourly"].as_array().unwrap();
        let limits = summary["limits"].as_array().unwrap();
        let limit_samples = summary["limit_samples"].as_array().unwrap();

        assert_eq!(hourly.len(), 1);
        assert_eq!(hourly[0]["device_id"], json!("remote-device"));
        assert_eq!(hourly[0]["bucket_start"], json!(bucket_start));
        assert_eq!(hourly[0]["provider_account_label"], json!("Codex remote"));
        assert_eq!(hourly[0]["total_tokens"], json!(17));
        assert_eq!(limits.len(), 1);
        assert_eq!(limits[0]["device_id"], json!("remote-device"));
        assert_eq!(limits[0]["window_kind"], json!("5_hour"));
        assert_eq!(limits[0]["used_percent"], json!(44));
        assert_eq!(limit_samples.len(), 1);
        assert_eq!(limit_samples[0]["remaining_percent"], json!(56));
    }

    #[test]
    fn tokenomics_cloud_status_summary_devices_flatten_to_remote_facts_and_preserve_cursor() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_cloud_status_summary_devices_flatten_to_remote_facts_and_preserve_cursor));
        let bucket_start = tokenomics_test_current_hour_bucket();
        let bucket_ms = tokenomics_timestamp_unix(&bucket_start)
            .unwrap()
            .saturating_mul(1000);
        let payload = json!({
            "kind": "tokenomics_status",
            "summary": {
                "contract": "diffforge.tokenomics.v2",
                "server_cursor": "0001780000000000",
                "sync_cursor": "0001780000000000",
                "scope_key": "personal",
                "devices": [
                    {
                        "device_id": "remote-device",
                        "device_name": "Remote Mac",
                        "tokenomics": {
                            "hourly_groups": [
                                {
                                    "bucket_start_ms": bucket_ms,
                                    "observed_at_ms": bucket_ms + 60_000,
                                    "replacement": true,
                                    "rows": [
                                        {
                                            "provider_account_key": "openai:codex:personal",
                                            "provider": "openai",
                                            "agent_kind": "codex",
                                            "model": "gpt-5.5",
                                            "input": 8,
                                            "output": 4,
                                            "total": 12
                                        }
                                    ]
                                }
                            ],
                            "provider_accounts": {
                                "openai:codex:personal": {
                                    "provider": "openai",
                                    "agent_kind": "codex",
                                    "provider_account_label": "Remote Codex",
                                    "windows": {
                                        "weekly": {
                                            "used_percent": 22,
                                            "remaining_percent": 78,
                                            "observed_at_ms": bucket_ms + 60_000
                                        }
                                    }
                                }
                            }
                        }
                    }
                ]
            }
        });

        let summary = tokenomics_cloud_summary_payload(&payload);
        let hourly = summary["hourly"].as_array().unwrap();
        let replacements = summary["hourly_group_replacements"].as_array().unwrap();
        let limits = summary["limits"].as_array().unwrap();

        assert_eq!(summary["server_cursor"], json!("0001780000000000"));
        assert_eq!(hourly.len(), 1);
        assert_eq!(hourly[0]["device_id"], json!("remote-device"));
        assert_eq!(hourly[0]["bucket_start"], json!(bucket_start));
        assert_eq!(hourly[0]["provider_account_label"], json!("Remote Codex"));
        assert_eq!(hourly[0]["total_tokens"], json!(12));
        assert_eq!(replacements.len(), 1);
        assert_eq!(replacements[0]["device_id"], json!("remote-device"));
        assert_eq!(replacements[0]["bucket_start"], json!(bucket_start));
        assert_eq!(limits.len(), 1);
        assert_eq!(limits[0]["window_kind"], json!("weekly"));
        assert_eq!(limits[0]["used_percent"], json!(22));
    }

    #[test]
    fn tokenomics_account_sync_rollups_include_rolling_30_day_boundary() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_account_sync_rollups_include_rolling_30_day_boundary));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let window_start: String = conn
            .query_row(
                "SELECT strftime('%Y-%m-%dT00:00:00Z', 'now', '-29 days')",
                [],
                |row| row.get(0),
            )
            .unwrap();

        conn.execute(
            "INSERT INTO tokenomics_rollups(
               id, provider, agent_kind, model, subscription_key,
               provider_account_key, provider_account_label, workspace_id, repo_path,
               bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
               cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
             ) VALUES(
               'current-month-start', 'openai', 'codex', 'gpt-5.5', 'openai:codex:personal',
               'openai:codex:personal', 'Personal', NULL, NULL,
               'hour', ?1, 7, 0, 0,
               0, 7, 0, 1, '2026-05-01T00:00:00Z'
             )",
            rusqlite::params![window_start],
        )
        .unwrap();

        let rollups = tokenomics_account_hourly_sync_rollups(&conn, None, None).unwrap();

        assert!(rollups.iter().any(
            |row| row["bucket_start"] == json!(window_start) && row["total_tokens"] == json!(7)
        ));
    }

    #[test]
    fn tokenomics_provider_account_rejects_jwt_subject_without_workspace_identity() {
        let payload = general_purpose::URL_SAFE_NO_PAD.encode(r#"{"sub":"user-123"}"#);
        let auth_a = json!({
            "tokens": {
                "access_token": format!("header.{payload}.signature-a")
            }
        });
        let auth_b = json!({
            "tokens": {
                "access_token": format!("header.{payload}.signature-b")
            }
        });

        let account_a = tokenomics_provider_account_from_auth("openai", "codex", Some(&auth_a));
        let account_b = tokenomics_provider_account_from_auth("openai", "codex", Some(&auth_b));

        assert_eq!(account_a.key, "openai:codex:unknown");
        assert_eq!(account_b.key, "openai:codex:unknown");
        assert_eq!(account_a.label, "Codex account");
    }

    #[test]
    fn tokenomics_provider_account_uses_codex_jwt_name_as_label() {
        let payload_a = general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"sub":"user-123","name":"Syed Rizvi","email":"syed@example.test"}"#);
        let payload_b = general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"sub":"user-123","name":"Syed Renamed","email":"renamed@example.test"}"#);
        let auth_a = json!({
            "tokens": {
                "account_id": "stable-account-id",
                "id_token": format!("header.{payload_a}.signature-a")
            }
        });
        let auth_b = json!({
            "tokens": {
                "account_id": "stable-account-id",
                "id_token": format!("header.{payload_b}.signature-b")
            }
        });

        let account_a = tokenomics_provider_account_from_auth("openai", "codex", Some(&auth_a));
        let account_b = tokenomics_provider_account_from_auth("openai", "codex", Some(&auth_b));

        assert_eq!(account_a.key, account_b.key);
        assert_eq!(account_a.label, "Syed Rizvi");
        assert_eq!(account_b.label, "Syed Renamed");
    }

    #[test]
    fn tokenomics_provider_account_uses_letter_for_codex_email_fallback() {
        let payload = general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"sub":"user-123","email":"syed@example.test"}"#);
        let auth = json!({
            "tokens": {
                "account_id": "stable-account-id",
                "id_token": format!("header.{payload}.signature")
            }
        });

        let account = tokenomics_provider_account_from_auth("openai", "codex", Some(&auth));

        assert_eq!(account.label.len(), 1);
        assert!(account
            .label
            .chars()
            .all(|character| character.is_ascii_uppercase()));
        assert!(!account.label.contains('@'));
    }

    #[test]
    fn tokenomics_reconcile_provider_account_label_updates_existing_rows() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_reconcile_provider_account_label_updates_existing_rows));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let account = TokenomicsProviderAccount {
            key: "openai:codex:stable".to_string(),
            label: "Syed Rizvi".to_string(),
        };
        conn.execute(
            "INSERT INTO tokenomics_usage_events(
               id, provider, agent_kind, model, subscription_key, provider_account_key,
               provider_account_label, workspace_id, repo_path, source_kind, source_path,
               bucket_day, bucket_hour, input_tokens, output_tokens, cache_read_tokens,
               cache_write_tokens, total_tokens, estimated_cost_microusd, created_at, observed_at
             ) VALUES(
               'event-a', 'openai', 'codex', NULL, ?1, ?1,
               'Codex account stable', NULL, NULL, 'codex_token_count_jsonl', NULL,
               '2026-05-30', '2026-05-30T04', 1, 1, 0,
               0, 2, 0, '2026-05-30T04:00:00Z', '2026-05-30T04:00:00Z'
             )",
            rusqlite::params![account.key.as_str()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tokenomics_rollups(
               id, provider, agent_kind, model, subscription_key, provider_account_key,
               provider_account_label, workspace_id, repo_path, bucket_width, bucket_start,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
               estimated_cost_microusd, event_count, updated_at
             ) VALUES(
               'rollup-a', 'openai', 'codex', NULL, ?1, ?1,
               'Codex account stable', NULL, NULL, 'hour', '2026-05-30T04',
               1, 1, 0, 0, 2, 0, 1, '2026-05-30T04:00:00Z'
             )",
            rusqlite::params![account.key.as_str()],
        )
        .unwrap();

        tokenomics_reconcile_provider_account_label(&conn, "openai", "codex", &account).unwrap();

        let event_label: String = conn
            .query_row(
                "SELECT provider_account_label FROM tokenomics_usage_events WHERE id='event-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let rollup_label: String = conn
            .query_row(
                "SELECT provider_account_label FROM tokenomics_rollups WHERE id='rollup-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(event_label, "Syed Rizvi");
        assert_eq!(rollup_label, "Syed Rizvi");
    }

    #[test]
    fn tokenomics_reconcile_duplicate_provider_account_identities_preserves_badge_windows() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_reconcile_duplicate_provider_account_identities_preserves_badge_windows));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let canonical_key = "openai:codex:canonical-agency";
        let old_key = "openai:codex:old-agency";
        conn.execute(
            "INSERT INTO tokenomics_usage_events(
               id, provider, agent_kind, model, subscription_key, provider_account_key,
               provider_account_label, source_kind, source_path, bucket_day, bucket_hour,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
               total_tokens, estimated_cost_microusd, created_at, observed_at
             ) VALUES(
               'agency-event-canonical', 'openai', 'codex', 'gpt-5.4', ?1, ?1,
               'Digital Agency', 'codex_token_count_jsonl', '/tmp/session.jsonl',
               '2026-06-16', '2026-06-16T10:00:00Z', 100, 20, 5, 0,
               120, 0, '2026-06-16T10:00:00Z', '2026-06-16T10:00:00Z'
             )",
            rusqlite::params![canonical_key],
        )
        .unwrap();
        let scope = TokenomicsBillingScope {
            scope_type: "personal".to_string(),
            team_id: None,
            source: "test".to_string(),
        };
        tokenomics_upsert_latest_window(
            &conn,
            &json!({
                "provider": "openai",
                "agent_kind": "codex",
                "provider_account_key": old_key,
                "provider_account_label": "Digital Agency",
                "window_kind": "weekly",
                "sample_at": "2026-06-16T10:05:00Z",
                "used_percent": 42
            }),
            &scope,
            "device-a",
            Some("test"),
        )
        .unwrap();

        tokenomics_reconcile_duplicate_provider_account_identities(&conn).unwrap();

        let old_badges: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_provider_accounts WHERE provider_account_key=?1",
                rusqlite::params![old_key],
                |row| row.get(0),
            )
            .unwrap();
        let old_windows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_latest_windows WHERE provider_account_key=?1",
                rusqlite::params![old_key],
                |row| row.get(0),
            )
            .unwrap();
        let distinct_badge_keys: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT provider_account_key)
                 FROM tokenomics_provider_accounts
                 WHERE provider='openai' AND agent_kind='codex'
                   AND provider_account_label='Digital Agency'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let migrated_windows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_latest_windows
                 WHERE provider_account_key=?1 AND provider_account_label='Digital Agency'",
                rusqlite::params![canonical_key],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(old_badges, 1);
        assert_eq!(old_windows, 1);
        assert_eq!(distinct_badge_keys, 1);
        assert_eq!(migrated_windows, 0);
    }

    #[test]
    fn tokenomics_reconcile_duplicate_provider_account_identities_preserves_claude_usage_keys() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_reconcile_duplicate_provider_account_identities_preserves_claude_usage_keys));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let canonical_key = "anthropic:claude:support-splutter";
        let old_key = "anthropic:claude:support-diffforge";
        for (id, key, input_tokens, output_tokens) in [
            ("rizzist-event-canonical", canonical_key, 90, 10),
            ("rizzist-event-old", old_key, 9, 1),
        ] {
            conn.execute(
                "INSERT INTO tokenomics_usage_events(
                   id, provider, agent_kind, model, subscription_key, provider_account_key,
                   provider_account_label, source_kind, source_path, bucket_day, bucket_hour,
                   input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                   total_tokens, estimated_cost_microusd, created_at, observed_at
                 ) VALUES(
                   ?1, 'anthropic', 'claude', 'sonnet', ?2, ?2,
                   'support', 'claude_transcript_jsonl', '/tmp/session.jsonl',
                   '2026-06-16', '2026-06-16T11:00:00Z', ?3, ?4, 0, 0,
                   ?5, 0, '2026-06-16T11:00:00Z', '2026-06-16T11:00:00Z'
                 )",
                rusqlite::params![
                    id,
                    key,
                    input_tokens,
                    output_tokens,
                    input_tokens + output_tokens
                ],
            )
            .unwrap();
            tokenomics_upsert_provider_account(
                &conn,
                "device-a",
                "anthropic",
                "claude",
                key,
                Some("support"),
                &TokenomicsBillingScope {
                    scope_type: "personal".to_string(),
                    team_id: None,
                    source: "test".to_string(),
                },
                "test",
            )
            .unwrap();
        }

        tokenomics_reconcile_duplicate_provider_account_identities(&conn).unwrap();

        let old_events: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_usage_events WHERE provider_account_key=?1",
                rusqlite::params![old_key],
                |row| row.get(0),
            )
            .unwrap();
        let distinct_event_keys: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT provider_account_key)
                 FROM tokenomics_usage_events
                 WHERE provider='anthropic' AND agent_kind='claude' AND provider_account_label='support'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let rollup_total: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(total_tokens), 0)
                 FROM tokenomics_rollups
                 WHERE provider='anthropic' AND agent_kind='claude'
                   AND provider_account_key=?1 AND bucket_width='hour'",
                rusqlite::params![canonical_key],
                |row| row.get(0),
            )
            .unwrap();
        let old_badges: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_provider_accounts WHERE provider_account_key=?1",
                rusqlite::params![old_key],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(old_events, 1);
        assert_eq!(distinct_event_keys, 2);
        assert_eq!(rollup_total, 0);
        assert_eq!(old_badges, 1);
    }

    #[test]
    fn tokenomics_provider_account_uses_claude_oauth_account_identity() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_provider_account_uses_claude_oauth_account_identity));
        let auth_a = json!({
            "credentials": {
                "claudeAiOauth": {
                    "accessToken": "access-a",
                    "refreshToken": "refresh-a"
                }
            },
            "claude_config": {
                "oauthAccount": {
                    "accountUuid": "stable-claude-account",
                    "displayName": "Claude Syed",
                    "emailAddress": "syed@example.test",
                    "organizationUuid": "org-a"
                }
            }
        });
        let auth_b = json!({
            "credentials": {
                "claudeAiOauth": {
                    "accessToken": "access-b",
                    "refreshToken": "refresh-b"
                }
            },
            "claude_config": {
                "oauthAccount": {
                    "accountUuid": "stable-claude-account",
                    "displayName": "Claude Renamed",
                    "emailAddress": "renamed@example.test",
                    "organizationUuid": "org-b"
                }
            }
        });

        let account_a = tokenomics_provider_account_from_auth("anthropic", "claude", Some(&auth_a));
        let account_b = tokenomics_provider_account_from_auth("anthropic", "claude", Some(&auth_b));

        assert_eq!(account_a.key, account_b.key);
        assert_eq!(account_a.label, "Claude Syed");
        assert_eq!(account_b.label, "Claude Renamed");
    }

    #[test]
    fn claude_profile_provider_account_resolves_profile_dir_identity() {
        let _storage = process_test_storage_isolation(stringify!(claude_profile_provider_account_resolves_profile_dir_identity));
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let profile_dir = std::env::temp_dir().join(format!(
            "diffforge-tokenomics-claude-profile-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&profile_dir).unwrap();
        fs::write(
            profile_dir.join(".claude.json"),
            serde_json::to_vec(&json!({
                "oauthAccount": {
                    "accountUuid": "profile-account-uuid",
                    "displayName": "Provider Side Name",
                    "emailAddress": "profile@example.test"
                }
            }))
            .unwrap(),
        )
        .unwrap();

        let account = tokenomics_claude_profile_provider_account(
            "cap-profile-1234",
            "profileuser",
            Some("profile@example.test"),
            &profile_dir,
        );
        // Same key as the default-home path for the same login: one account,
        // one chip, wherever the login runs.
        let default_shaped = tokenomics_provider_account_from_auth(
            "anthropic",
            "claude",
            Some(&json!({
                "claude_config": {
                    "oauthAccount": { "accountUuid": "profile-account-uuid" }
                }
            })),
        );
        assert_eq!(account.key, default_shaped.key);
        assert!(!account.key.contains(":profile:"));
        // Registry label wins over the provider-side display name.
        assert_eq!(account.label, "profileuser");

        let config_key = tokenomics_claude_account_key_for_claude_config(&json!({
            "oauthAccount": { "accountUuid": "profile-account-uuid" }
        }));
        assert_eq!(config_key.as_deref(), Some(account.key.as_str()));

        let _ = fs::remove_dir_all(&profile_dir);
    }

    #[test]
    fn claude_profile_provider_account_rejects_registry_email_mismatch() {
        let profile_dir = std::env::temp_dir().join(format!(
            "diffforge-tokenomics-claude-profile-mismatch-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&profile_dir).unwrap();
        fs::write(
            profile_dir.join(".claude.json"),
            serde_json::to_vec(&json!({
                "oauthAccount": {
                    "accountUuid": "admin-account-uuid",
                    "displayName": "Admin",
                    "emailAddress": "ADMIN@example.test"
                }
            }))
            .unwrap(),
        )
        .unwrap();

        let account = tokenomics_claude_profile_provider_account(
            "cap-support-1234",
            "support",
            Some("support@example.test"),
            &profile_dir,
        );

        assert_eq!(account.key, "anthropic:claude:profile:cap-support-1234");
        assert_eq!(account.label, "Claude · support");

        let _ = fs::remove_dir_all(&profile_dir);
    }

    #[test]
    fn claude_profile_provider_account_falls_back_to_profile_key_without_identity() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let profile_dir = std::env::temp_dir().join(format!(
            "diffforge-tokenomics-claude-profile-empty-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&profile_dir).unwrap();

        let account = tokenomics_claude_profile_provider_account(
            "cap-empty-1234",
            "pending",
            None,
            &profile_dir,
        );
        assert_eq!(account.key, "anthropic:claude:profile:cap-empty-1234");
        assert_eq!(account.label, "Claude · pending");

        // Credential-only dir (tokens, no oauthAccount): token-hash keys
        // churn on refresh, so the stable profile key must win here too.
        fs::write(
            profile_dir.join(".credentials.json"),
            serde_json::to_vec(&json!({
                "claudeAiOauth": {
                    "accessToken": "access-token-1",
                    "refreshToken": "refresh-token-1"
                }
            }))
            .unwrap(),
        )
        .unwrap();
        let credential_only = tokenomics_claude_profile_provider_account(
            "cap-empty-1234",
            "pending",
            None,
            &profile_dir,
        );
        assert_eq!(
            credential_only.key,
            "anthropic:claude:profile:cap-empty-1234"
        );

        assert_eq!(
            tokenomics_claude_account_key_for_claude_config(
                &json!({ "hasCompletedOnboarding": true })
            ),
            None
        );

        let _ = fs::remove_dir_all(&profile_dir);
    }

    #[test]
    fn tokenomics_provider_account_uses_letter_for_claude_email_fallback() {
        let auth = json!({
            "claude_config": {
                "oauthAccount": {
                    "accountUuid": "stable-claude-account",
                    "emailAddress": "syed@example.test",
                    "organizationName": "Fallback Org"
                }
            }
        });

        let account = tokenomics_provider_account_from_auth("anthropic", "claude", Some(&auth));

        assert_eq!(account.label.len(), 1);
        assert!(account
            .label
            .chars()
            .all(|character| character.is_ascii_uppercase()));
        assert!(!account.label.contains('@'));
    }

    #[test]
    fn tokenomics_provider_account_keeps_claude_credential_only_token_key() {
        let auth = json!({
            "credentials": {
                "organizationUuid": "shared-org",
                "claudeAiOauth": {
                    "accessToken": "access-a",
                    "refreshToken": "refresh-a"
                }
            }
        });

        let account = tokenomics_provider_account_from_auth("anthropic", "claude", Some(&auth));
        let legacy_key =
            tokenomics_legacy_provider_account_key_from_auth("anthropic", "claude", &auth).unwrap();

        assert_ne!(account.key, legacy_key);
        assert_eq!(
            tokenomics_legacy_short_provider_account_key("anthropic", "claude", &account.key)
                .as_deref(),
            Some(legacy_key.as_str())
        );
        assert_eq!(account.key.rsplit(':').next().unwrap_or_default().len(), 32);
        assert!(account.label.starts_with("Claude account "));
    }

    #[test]
    fn tokenomics_migrate_provider_account_key_rebuilds_claude_rollups() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_migrate_provider_account_key_rebuilds_claude_rollups));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let old_credentials = json!({
            "claudeAiOauth": {
                "accessToken": "legacy-access",
                "refreshToken": "legacy-refresh"
            }
        });
        let old_key = tokenomics_legacy_provider_account_key_from_auth(
            "anthropic",
            "claude",
            &old_credentials,
        )
        .unwrap();
        let account = TokenomicsProviderAccount {
            key: "anthropic:claude:stable".to_string(),
            label: "Claude Syed".to_string(),
        };
        conn.execute(
            "INSERT INTO tokenomics_usage_events(
               id, provider, agent_kind, model, subscription_key, provider_account_key,
               provider_account_label, workspace_id, repo_path, source_kind, source_path,
               bucket_day, bucket_hour, input_tokens, output_tokens, cache_read_tokens,
               cache_write_tokens, total_tokens, estimated_cost_microusd, created_at, observed_at
             ) VALUES(
               'claude-event-a', 'anthropic', 'claude', 'sonnet', ?1, ?1,
               'Claude account legacy', NULL, '/tmp/repo', 'jsonl', '/tmp/session.jsonl',
               '2026-05-30', '2026-05-30T04', 3, 4, 1,
               2, 10, 0, '2026-05-30T04:00:00Z', '2026-05-30T04:00:00Z'
             )",
            rusqlite::params![old_key.as_str()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tokenomics_rollups(
               id, provider, agent_kind, model, subscription_key, provider_account_key,
               provider_account_label, workspace_id, repo_path, bucket_width, bucket_start,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
               estimated_cost_microusd, event_count, updated_at
             ) VALUES(
               'legacy-rollup-a', 'anthropic', 'claude', 'sonnet', ?1, ?1,
               'Claude account legacy', NULL, '/tmp/repo', 'day', '2026-05-30',
               3, 4, 1, 2, 10, 0, 1, '2026-05-30T04:00:00Z'
             )",
            rusqlite::params![old_key.as_str()],
        )
        .unwrap();

        tokenomics_migrate_provider_account_key(&conn, "anthropic", "claude", &old_key, &account)
            .unwrap();

        let migrated = tokenomics_query_one(
            &conn,
            "SELECT provider_account_key, provider_account_label, subscription_key
             FROM tokenomics_usage_events WHERE id='claude-event-a'",
        )
        .unwrap();
        assert_eq!(
            migrated["provider_account_key"],
            json!("anthropic:claude:stable")
        );
        assert_eq!(migrated["provider_account_label"], json!("Claude Syed"));
        assert_eq!(
            migrated["subscription_key"],
            json!("anthropic:claude:stable")
        );

        let stale_provider_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_rollups WHERE provider_account_key=?1",
                rusqlite::params![old_key.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        let new_rollups = tokenomics_query_rows(
            &conn,
            "SELECT bucket_width, provider_account_key, provider_account_label, total_tokens, event_count
             FROM tokenomics_rollups ORDER BY bucket_width",
        )
        .unwrap();

        assert_eq!(stale_provider_rows, 0);
        assert_eq!(new_rollups.len(), 1);
        assert!(new_rollups.iter().all(|row| {
            row["bucket_width"] == json!("hour")
                && row["provider_account_key"] == json!("anthropic:claude:stable")
                && row["provider_account_label"] == json!("Claude Syed")
                && row["total_tokens"] == json!(10)
                && row["event_count"] == json!(1)
        }));
    }

    #[test]
    fn tokenomics_codex_usage_account_id_canonicalizes_auth_alias_rows() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_codex_usage_account_id_canonicalizes_auth_alias_rows));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();

        let old_key = "openai:codex:aab1026b325e96ceac50137608801027";
        let usage = json!({
            "account_id": "user-stable-chatgpt-account",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 12,
                    "reset_after_seconds": 1200
                }
            }
        });
        let canonical_key = tokenomics_codex_provider_account_key_from_usage_account_id(
            "user-stable-chatgpt-account",
        );
        assert_ne!(canonical_key, old_key);

        conn.execute(
            "INSERT INTO tokenomics_usage_events(
               id, provider, agent_kind, model, subscription_key, provider_account_key,
               provider_account_label, workspace_id, repo_path, source_kind, source_path,
               bucket_day, bucket_hour, input_tokens, output_tokens, cache_read_tokens,
               cache_write_tokens, total_tokens, estimated_cost_microusd, created_at, observed_at
             ) VALUES(
               'codex-event-a', 'openai', 'codex', 'gpt-5.5', ?1, ?1,
               'Rizzist', NULL, '/tmp/repo', 'codex_token_count_jsonl', '/tmp/session.jsonl',
               '2026-06-13', '2026-06-13T04', 3, 4, 1,
               2, 10, 0, '2026-06-13T04:00:00Z', '2026-06-13T04:00:00Z'
             )",
            rusqlite::params![old_key],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tokenomics_rollups(
               id, provider, agent_kind, model, subscription_key, provider_account_key,
               provider_account_label, workspace_id, repo_path, bucket_width, bucket_start,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
               estimated_cost_microusd, event_count, updated_at
             ) VALUES(
               'codex-rollup-a', 'openai', 'codex', 'gpt-5.5', ?1, ?1,
               'Rizzist', NULL, '/tmp/repo', 'day', '2026-06-13',
               3, 4, 1, 2, 10, 0, 1, '2026-06-13T04:00:00Z'
             )",
            rusqlite::params![old_key],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tokenomics_provider_limit_samples(
               id, device_id, provider, agent_kind, provider_account_key, provider_account_label,
               window_kind, sample_bucket_start, sample_bucket_unix, sample_at, sample_at_unix,
               used_percent, remaining_percent, source, confidence, updated_at, updated_at_unix
             ) VALUES(
               'codex-sample-a', 'device-a', 'openai', 'codex', ?1, 'Codex · support',
               '5_hour', '2026-06-13T04:00:00Z', 1780000000, '2026-06-13T04:00:00Z',
               1780000000, 12, 88, 'cloud', 'live', '2026-06-13T04:00:00Z', 1780000000
             )",
            rusqlite::params![old_key],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tokenomics_cloud_rollups(
               id, device_id, provider, agent_kind, model, subscription_key,
               provider_account_key, provider_account_label, workspace_id, repo_path,
               bucket_width, bucket_start, total_tokens, event_count, updated_at, received_at
             ) VALUES(
               'codex-cloud-a', 'device-b', 'openai', 'codex', 'gpt-5.5', ?1,
               ?1, 'Codex · support', NULL, NULL,
               'hour', '2026-06-13T04', 5, 1, '2026-06-13T04:00:00Z', '2026-06-13T04:00:00Z'
             )",
            rusqlite::params![old_key],
        )
        .unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES(?1, ?2)",
            rusqlite::params![
                TOKENOMICS_CLOUD_PROVIDER_LIMITS_KEY,
                json!([{
                    "provider": "openai",
                    "agent_kind": "codex",
                    "provider_account_key": old_key,
                    "provider_account_label": "Codex · support",
                    "window_kind": "5_hour",
                    "used_percent": 12
                }])
                .to_string()
            ],
        )
        .unwrap();

        let old_account = TokenomicsProviderAccount {
            key: old_key.to_string(),
            label: "Codex · support".to_string(),
        };
        let old_cache_key = tokenomics_codex_usage_cache_key(&old_account);
        tokenomics_store_codex_usage_cache_at(&conn, &old_cache_key, &usage, 1_780_000_000)
            .unwrap();
        let account =
            tokenomics_reconcile_codex_provider_account_from_usage(&conn, &old_account, &usage)
                .unwrap();

        assert_eq!(account.key, canonical_key);
        assert_eq!(account.label, "Rizzist");

        let event = tokenomics_query_one(
            &conn,
            "SELECT provider_account_key, provider_account_label, subscription_key
             FROM tokenomics_usage_events WHERE id='codex-event-a'",
        )
        .unwrap();
        assert_eq!(event["provider_account_key"], json!(canonical_key));
        assert_eq!(event["provider_account_label"], json!("Rizzist"));
        assert_eq!(event["subscription_key"], json!(canonical_key));

        let old_rollups: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_rollups WHERE provider_account_key=?1",
                rusqlite::params![old_key],
                |row| row.get(0),
            )
            .unwrap();
        let old_samples: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_provider_limit_samples WHERE provider_account_key=?1",
                rusqlite::params![old_key],
                |row| row.get(0),
            )
            .unwrap();
        let old_cloud_rollups: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_cloud_rollups WHERE provider_account_key=?1 OR subscription_key=?1",
                rusqlite::params![old_key],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_rollups, 0);
        assert_eq!(old_samples, 0);
        assert_eq!(old_cloud_rollups, 0);

        let sample_label: String = conn
            .query_row(
                "SELECT provider_account_label FROM tokenomics_provider_limit_samples WHERE provider_account_key=?1",
                rusqlite::params![canonical_key.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(sample_label, "Rizzist");

        let cloud_limits = tokenomics_cloud_provider_limits(&conn).unwrap();
        assert_eq!(cloud_limits.len(), 1);
        assert_eq!(
            cloud_limits[0]["provider_account_key"],
            json!(canonical_key)
        );
        assert_eq!(cloud_limits[0]["provider_account_label"], json!("Rizzist"));

        let cache_key = tokenomics_codex_usage_cache_key(&account);
        let cached_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_meta WHERE key=?1",
                rusqlite::params![cache_key],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(cached_count, 1);
        let old_cached_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_meta WHERE key=?1",
                rusqlite::params![old_cache_key],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_cached_count, 0);
    }

    #[test]
    fn tokenomics_cached_codex_usage_rewrites_alias_cache_key() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_cached_codex_usage_rewrites_alias_cache_key));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();

        let old_account = TokenomicsProviderAccount {
            key: "openai:codex:legacy-auth-hash".to_string(),
            label: "Rizzist".to_string(),
        };
        let usage = json!({
            "account_id": "user-stable-cache-account",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 25,
                    "reset_after_seconds": 600
                }
            }
        });
        let old_cache_key = tokenomics_codex_usage_cache_key(&old_account);
        tokenomics_store_codex_usage_cache_at(&conn, &old_cache_key, &usage, 1_780_000_000)
            .unwrap();

        let loaded = tokenomics_cached_codex_usage(&conn, &old_cache_key, 1_780_000_100, 3_600)
            .unwrap()
            .unwrap();
        assert_eq!(
            tokenomics_value_string(&loaded, &["account_id"]),
            Some("user-stable-cache-account".to_string())
        );

        let canonical_key = tokenomics_codex_provider_account_key_from_usage_account_id(
            "user-stable-cache-account",
        );
        let canonical_cache_key = tokenomics_codex_usage_cache_key_from_account_key(&canonical_key);
        let canonical_cached_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_meta WHERE key=?1",
                rusqlite::params![canonical_cache_key],
                |row| row.get(0),
            )
            .unwrap();
        let old_cached_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_meta WHERE key=?1",
                rusqlite::params![old_cache_key],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(canonical_cached_count, 1);
        assert_eq!(old_cached_count, 0);
    }

    #[test]
    fn tokenomics_claude_fable_5_estimated_api_cost_uses_current_rates() {
        assert_eq!(
            tokenomics_estimated_api_microusd(
                "anthropic",
                "claude",
                Some("claude-fable-5"),
                1_000_000,
                100_000,
                100_000,
                2_000_000,
            ),
            111_350_000
        );
    }

    #[test]
    fn tokenomics_repair_provider_api_costs_rebuilds_claude_rollups() {
        let _storage = process_test_storage_isolation(stringify!(tokenomics_repair_provider_api_costs_rebuilds_claude_rollups));
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        conn.execute(
            "DELETE FROM tokenomics_meta WHERE key='provider_api_pricing_version'",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tokenomics_usage_events(
               id, provider, agent_kind, model, subscription_key, provider_account_key,
               provider_account_label, source_kind, source_path, bucket_day, bucket_hour,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
               total_tokens, estimated_cost_microusd, created_at, observed_at
             ) VALUES(
               'fable-event-zero-cost', 'anthropic', 'claude', 'claude-fable-5',
               'anthropic:claude:fable-test', 'anthropic:claude:fable-test',
               'Claude Fable Test', 'jsonl', '/tmp/claude.jsonl', '2026-06-10',
               '2026-06-10T10', 1000000, 2000000, 100000, 100000,
               3200000, 0, '2026-06-10T10:00:00Z', '2026-06-10T10:00:00Z'
             )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tokenomics_rollups(
               id, provider, agent_kind, model, subscription_key, provider_account_key,
               provider_account_label, bucket_width, bucket_start, input_tokens, output_tokens,
               cache_read_tokens, cache_write_tokens, total_tokens, estimated_cost_microusd,
               event_count, updated_at
             ) VALUES(
               'fable-rollup-zero-cost', 'anthropic', 'claude', 'claude-fable-5',
               'anthropic:claude:fable-test', 'anthropic:claude:fable-test',
               'Claude Fable Test', 'hour', '2026-06-10T10', 1000000, 2000000,
               100000, 100000, 3200000, 0, 1, '2026-06-10T10:00:00Z'
             )",
            [],
        )
        .unwrap();

        tokenomics_repair_provider_api_costs(&conn).unwrap();

        let event_cost: i64 = conn
            .query_row(
                "SELECT estimated_cost_microusd
                 FROM tokenomics_usage_events WHERE id='fable-event-zero-cost'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let rollup_cost: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(estimated_cost_microusd), 0)
                 FROM tokenomics_rollups WHERE provider='anthropic' AND agent_kind='claude'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let meta_value: String = conn
            .query_row(
                "SELECT value FROM tokenomics_meta WHERE key='provider_api_pricing_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(event_cost, 111_350_000);
        assert_eq!(rollup_cost, 111_350_000);
        assert_eq!(meta_value, TOKENOMICS_PROVIDER_API_PRICING_VERSION);
    }

    #[test]
    fn tokenomics_provider_limit_merge_keeps_cloud_last_known_over_local_unknown() {
        let cloud_known = json!({
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": "openai:codex:personal",
            "window_kind": "weekly",
            "limit_source": "codex_usage_api",
            "confidence": "live",
            "used_percent": 42,
            "remaining_percent": 58,
            "updated_at": "2026-06-09T10:00:00Z"
        });
        let local_unknown = json!({
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": "openai:codex:personal",
            "window_kind": "weekly",
            "limit_source": "not_exposed",
            "confidence": "unknown",
            "status_label": "Plan limit not exposed",
            "updated_at": "2026-06-09T11:00:00Z"
        });

        let merged = tokenomics_merge_provider_limits(vec![cloud_known], vec![local_unknown]);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0]["used_percent"], json!(42));
        assert_eq!(merged[0]["remaining_percent"], json!(58));
    }

    #[test]
    fn tokenomics_provider_limit_merge_keeps_known_percent_over_live_no_data() {
        let cloud_known = json!({
            "provider": "anthropic",
            "agent_kind": "claude",
            "provider_account_key": "anthropic:claude:personal",
            "window_kind": "5_hour",
            "limit_source": "claude_statusline",
            "confidence": "live",
            "used_percent": 84,
            "remaining_percent": 16,
            "pace_status": "over_pace",
            "pace_delta_percent": 497,
            "updated_at": "unix:1000"
        });
        let live_no_data = json!({
            "provider": "anthropic",
            "agent_kind": "claude",
            "provider_account_key": "anthropic:claude:personal",
            "window_kind": "5_hour",
            "limit_source": "claude_statusline",
            "confidence": "live",
            "used_percent": Value::Null,
            "remaining_percent": Value::Null,
            "pace_status": "unknown",
            "pace_delta_percent": Value::Null,
            "updated_at": "unix:1010"
        });

        let merged =
            tokenomics_merge_provider_limits(vec![cloud_known.clone()], vec![live_no_data.clone()]);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0]["used_percent"], json!(84));
        assert_eq!(merged[0]["remaining_percent"], json!(16));
        assert_eq!(merged[0]["pace_status"], json!("over_pace"));
        assert_eq!(merged[0]["pace_delta_percent"], json!(497));

        let reversed = tokenomics_merge_provider_limits(vec![live_no_data], vec![cloud_known]);

        assert_eq!(reversed.len(), 1);
        assert_eq!(reversed[0]["used_percent"], json!(84));
        assert_eq!(reversed[0]["remaining_percent"], json!(16));
        assert_eq!(reversed[0]["pace_status"], json!("over_pace"));
        assert_eq!(reversed[0]["pace_delta_percent"], json!(497));
    }

    #[test]
    fn tokenomics_provider_limit_merge_prefers_fresher_local_live_snapshot() {
        let cloud_known = json!({
            "provider": "anthropic",
            "agent_kind": "claude",
            "provider_account_key": "anthropic:claude:personal",
            "window_kind": "5_hour",
            "limit_source": "claude_statusline",
            "confidence": "live",
            "used_percent": 95,
            "remaining_percent": 5,
            "updated_at": "unix:2000"
        });
        let local_live = json!({
            "provider": "anthropic",
            "agent_kind": "claude",
            "provider_account_key": "anthropic:claude:personal",
            "window_kind": "5_hour",
            "limit_source": "claude_statusline",
            "confidence": "live",
            "used_percent": 98,
            "remaining_percent": 2,
            "updated_at": "unix:2010"
        });

        let merged = tokenomics_merge_provider_limits(vec![cloud_known], vec![local_live]);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0]["used_percent"], json!(98));
        assert_eq!(merged[0]["remaining_percent"], json!(2));
    }

    #[test]
    fn tokenomics_provider_limit_merge_prefers_fresher_codex_usage_snapshot() {
        let cloud_known = json!({
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": "openai:codex:pro",
            "window_kind": "weekly",
            "limit_source": "codex_usage_api",
            "confidence": "live",
            "used_percent": 84,
            "remaining_percent": 16,
            "updated_at": "unix:2000"
        });
        let local_live = json!({
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": "openai:codex:pro",
            "window_kind": "weekly",
            "limit_source": "codex_usage_api",
            "confidence": "live",
            "used_percent": 88,
            "remaining_percent": 12,
            "updated_at": "unix:2010"
        });

        let merged = tokenomics_merge_provider_limits(vec![cloud_known], vec![local_live]);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0]["used_percent"], json!(88));
        assert_eq!(merged[0]["remaining_percent"], json!(12));
    }

    #[test]
    fn tokenomics_provider_limit_merge_rejects_codex_no_data_over_known_percent() {
        let cloud_known = json!({
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": "openai:codex:pro",
            "window_kind": "weekly",
            "limit_source": "codex_usage_api",
            "confidence": "live",
            "used_percent": 84,
            "remaining_percent": 16,
            "updated_at": "unix:2000"
        });
        let live_no_data = json!({
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": "openai:codex:pro",
            "window_kind": "weekly",
            "limit_source": "codex_usage_api",
            "confidence": "live",
            "used_percent": Value::Null,
            "remaining_percent": Value::Null,
            "updated_at": "unix:2010"
        });

        let merged = tokenomics_merge_provider_limits(vec![cloud_known], vec![live_no_data]);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0]["used_percent"], json!(84));
        assert_eq!(merged[0]["remaining_percent"], json!(16));
    }

    #[test]
    fn tokenomics_provider_limit_merge_normalizes_timestamp_formats() {
        let cloud_known = json!({
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": "openai:codex:personal",
            "window_kind": "weekly",
            "limit_source": "codex_usage_api",
            "confidence": "live",
            "used_percent": 42,
            "remaining_percent": 58,
            "updated_at": "2026-06-14T12:00:00Z"
        });
        let stale_local = json!({
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": "openai:codex:personal",
            "window_kind": "weekly",
            "limit_source": "codex_usage_api",
            "confidence": "live",
            "used_percent": 88,
            "remaining_percent": 12,
            "updated_at": "unix:1000"
        });

        let merged = tokenomics_merge_provider_limits(vec![cloud_known], vec![stale_local]);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0]["used_percent"], json!(42));
        assert_eq!(merged[0]["remaining_percent"], json!(58));
    }

    #[test]
    fn tokenomics_limit_sample_pacing_ignores_samples_after_reset() {
        let mut limit = json!({
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": "openai:codex:test",
            "window_kind": "5_hour",
            "limit_window_seconds": 5 * 60 * 60,
        });
        let samples = vec![json!({
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": "openai:codex:test",
            "window_kind": "5_hour",
            "used_percent": 90,
            "remaining_percent": 10,
            "sample_at": "unix:1",
            "sample_at_unix": 1,
            "reset_at": "unix:2",
            "limit_window_seconds": 5 * 60 * 60,
        })];

        tokenomics_apply_provider_limit_sample_pacing_from_rows(&mut limit, &samples);

        assert!(limit["used_percent"].is_null());
        assert!(limit["pace_strategy"].is_null());
        assert!(limit["pace_status"].is_null());
    }
}

const TOKENOMICS_DB_FILE: &str = "tokenomics.sqlite3";
const TOKENOMICS_SCAN_MAX_FILES_PER_PROVIDER: usize = 120;
const TOKENOMICS_SCAN_MAX_LINE_BYTES: usize = 256 * 1024;
const TOKENOMICS_SCAN_MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
const TOKENOMICS_SYNC_ROLLUP_LIMIT: usize = 5000;
const TOKENOMICS_PROVIDER_LIMIT_SAMPLE_SYNC_LIMIT: usize = 2048;
const TOKENOMICS_PROVIDER_LIMIT_SAMPLE_BUCKET_SECS: u64 = 15 * 60;
const TOKENOMICS_PROVIDER_LIMIT_SAMPLE_5H_RETENTION_SECS: u64 = 48 * 60 * 60;
const TOKENOMICS_PROVIDER_LIMIT_SAMPLE_WEEKLY_RETENTION_SECS: u64 = 45 * 24 * 60 * 60;
const TOKENOMICS_SQLITE_BUSY_TIMEOUT_MS: u64 = 30_000;
const TOKENOMICS_CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/codex/usage";
const TOKENOMICS_CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const TOKENOMICS_CODEX_SCANNER_VERSION: &str = "codex-token-count-v6-device-aware-30d";
const TOKENOMICS_GENERIC_SCANNER_VERSION: &str = "generic-tokenomics-v4-device-aware-30d";
const TOKENOMICS_ROLLUP_ID_VERSION: &str = "tokenomics-v2-utc-hour-rollups-v2";
const TOKENOMICS_PROVIDER_API_PRICING_VERSION: &str = "claude-api-pricing-v1";
const TOKENOMICS_INITIAL_BACKFILL_DAYS: u64 = 30;
const TOKENOMICS_UNKNOWN_OFFSET_COVERAGE_START_UNIX: u64 = i64::MAX as u64;
const TOKENOMICS_CODEX_USAGE_CACHE_KEY_PREFIX: &str = "codex_usage_api_cache:";
const TOKENOMICS_CODEX_USAGE_CACHE_TTL_SECS: u64 = 10;
const TOKENOMICS_CODEX_USAGE_CACHE_STALE_SECS: u64 = 7 * 24 * 60 * 60;
const TOKENOMICS_CLAUDE_USAGE_CACHE_KEY_PREFIX: &str = "claude_usage_api_cache:";
const TOKENOMICS_CLAUDE_USAGE_CACHE_TTL_SECS: u64 = 180;
const TOKENOMICS_CLAUDE_USAGE_CACHE_STALE_SECS: u64 = 30 * 60;
const TOKENOMICS_SCAN_PROGRESS_EVENT: &str = "diffforge://tokenomics-scan-progress";
const TOKENOMICS_LOCAL_DEVICE_ALIASES_KEY: &str = "local_device_aliases";
const TOKENOMICS_CLOUD_PROVIDER_LIMITS_KEY: &str = "cloud_provider_limits";
const TOKENOMICS_DEVICE_IDENTITIES_KEY: &str = "device_identities";
const TOKENOMICS_CLOUD_ACCOUNT_SYNC_CURSOR_KEY_PREFIX: &str = "cloud_account_sync_cursor:";
static TOKENOMICS_SCAN_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static TOKENOMICS_REALTIME_SCAN_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();

use std::io::BufRead as _;

#[tauri::command]
async fn tokenomics_scan_usage(
    app: AppHandle,
    state: State<'_, CloudMcpState>,
) -> Result<Value, String> {
    let scan_app = app.clone();
    let summary = tauri::async_runtime::spawn_blocking(move || {
        tokenomics_scan_usage_for(&scan_app, true, false)
    })
    .await
    .map_err(|error| format!("Unable to join Tokenomics scan: {error}"))??;
    tokenomics_enqueue_usage_sync_if_inserted(app, state.inner(), &summary).await;
    Ok(summary)
}

#[tauri::command]
async fn tokenomics_scan_usage_silent(
    app: AppHandle,
    state: State<'_, CloudMcpState>,
) -> Result<Value, String> {
    let scan_app = app.clone();
    let summary = tauri::async_runtime::spawn_blocking(move || {
        tokenomics_scan_usage_for(&scan_app, false, false)
    })
    .await
    .map_err(|error| format!("Unable to join Tokenomics scan: {error}"))??;
    tokenomics_enqueue_usage_sync_if_inserted(app, state.inner(), &summary).await;
    Ok(summary)
}

#[tauri::command]
async fn tokenomics_resync_last_30_days(
    app: AppHandle,
    state: State<'_, CloudMcpState>,
) -> Result<Value, String> {
    let scan_app = app.clone();
    let summary = tauri::async_runtime::spawn_blocking(move || {
        tokenomics_scan_usage_for(&scan_app, true, true)
    })
    .await
    .map_err(|error| format!("Unable to join Tokenomics resync: {error}"))??;
    tokenomics_enqueue_usage_sync_if_inserted(app, state.inner(), &summary).await;
    Ok(summary)
}

#[tauri::command]
async fn tokenomics_get_summary(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || tokenomics_summary_for(&app, false, true))
        .await
        .map_err(|error| format!("Unable to join Tokenomics summary: {error}"))?
}

#[tauri::command]
async fn tokenomics_get_live_limits(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = tokenomics_open_db(&app)?;
        tokenomics_live_limits_snapshot_from_conn(&conn)
    })
    .await
    .map_err(|error| format!("Unable to join Tokenomics live limits: {error}"))?
}

#[tauri::command]
async fn tokenomics_get_sync_payload(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || tokenomics_summary_for(&app, true, false))
        .await
        .map_err(|error| format!("Unable to join Tokenomics sync payload: {error}"))?
}

#[tauri::command]
async fn tokenomics_get_sync_delta(
    app: AppHandle,
    since_updated_at: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = tokenomics_open_db(&app)?;
        tokenomics_reconcile_current_provider_accounts(&conn)?;
        let scope = tokenomics_current_billing_scope();
        tokenomics_sync_delta_from_conn(&conn, since_updated_at.as_deref(), Some(&scope))
    })
    .await
    .map_err(|error| format!("Unable to join Tokenomics sync delta: {error}"))?
}

#[tauri::command]
async fn tokenomics_record_usage(
    app: AppHandle,
    state: State<'_, CloudMcpState>,
    usage: Value,
) -> Result<Value, String> {
    let record_app = app.clone();
    let summary = tauri::async_runtime::spawn_blocking(move || {
        let conn = tokenomics_open_db(&record_app)?;
        let inserted = tokenomics_record_usage_value(&conn, &usage, "manual")?;
        tokenomics_summary_from_conn(&conn, true, Some(inserted))
    })
    .await
    .map_err(|error| format!("Unable to join Tokenomics record: {error}"))??;
    tokenomics_enqueue_usage_sync_if_inserted(app, state.inner(), &summary).await;
    Ok(summary)
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
    tokenomics_prepare_db(&conn)?;
    Ok(conn)
}

fn tokenomics_prepare_db(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
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
           last_seen_mtime INTEGER NOT NULL DEFAULT 0,
           last_seen_size INTEGER NOT NULL DEFAULT 0,
           last_event_timestamp INTEGER NOT NULL DEFAULT 0,
           coverage_start_unix INTEGER NOT NULL DEFAULT 9223372036854775807,
           updated_at TEXT NOT NULL,
           PRIMARY KEY(provider, agent_kind, source_path)
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
         CREATE INDEX IF NOT EXISTS idx_tokenomics_scan_state_provider ON tokenomics_scan_state(provider, agent_kind, updated_at);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_scan_days_source ON tokenomics_scan_days(provider, agent_kind, source_id, scanner_version, day_start_unix);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_limit_samples_updated ON tokenomics_provider_limit_samples(updated_at);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_limit_samples_match ON tokenomics_provider_limit_samples(billing_scope_type, billing_team_id, provider, agent_kind, provider_account_key, window_kind, sample_bucket_unix);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_limit_samples_device_match ON tokenomics_provider_limit_samples(device_id, billing_scope_type, billing_team_id, provider, agent_kind, provider_account_key, window_kind, sample_bucket_unix);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_provider_accounts_updated ON tokenomics_provider_accounts(updated_at);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_provider_accounts_match ON tokenomics_provider_accounts(device_id, billing_scope_type, billing_team_id, provider, agent_kind, provider_account_key);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_latest_windows_updated ON tokenomics_latest_windows(updated_at);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_latest_windows_match ON tokenomics_latest_windows(device_id, billing_scope_type, billing_team_id, provider, agent_kind, provider_account_key, window_kind);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_regions_source ON tokenomics_usage_regions(provider, agent_kind, source_id, updated_at);",
    )
    .map_err(|error| format!("Unable to prepare Tokenomics database: {error}"))?;
    for table in [
        "tokenomics_usage_events",
        "tokenomics_rollups",
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
        "coverage_start_unix",
        "INTEGER NOT NULL DEFAULT 9223372036854775807",
    )?;
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
    for table in [
        "tokenomics_usage_events",
        "tokenomics_rollups",
        "tokenomics_cloud_rollups",
    ] {
        conn.execute(
            &format!(
                "UPDATE {table}
                 SET device_id=?1
                 WHERE device_id IS NULL OR device_id='' OR device_id='desktop-primary'"
            ),
            rusqlite::params![device_id.as_str()],
        )
        .map_err(|error| format!("Unable to backfill Tokenomics device id: {error}"))?;
    }
    tokenomics_reconcile_local_device_id(conn)?;
    tokenomics_prune_local_cloud_relay_rows(conn)?;
    for table in [
        "tokenomics_usage_events",
        "tokenomics_rollups",
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
    // The display views are rebuilt ONLY when their stored schema version is
    // stale, and the whole DDL batch runs inside one IMMEDIATE transaction.
    // Rebuilding them unconditionally on every open (the old behavior) raced:
    // each DDL statement auto-commits, this database is opened concurrently
    // by the summary view, the scan scheduler, the Claude statusline
    // collector and cloud handlers, so a reader could land in the gap between
    // DROP VIEW and CREATE VIEW and fail with "no such table:
    // tokenomics_display_daily_rollups". Bump the version whenever any view
    // definition below changes (including when a new column must surface
    // through the views).
    const TOKENOMICS_VIEW_SCHEMA_VERSION: i64 = 3;
    let view_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| format!("Unable to read Tokenomics schema version: {error}"))?;
    if view_version == TOKENOMICS_VIEW_SCHEMA_VERSION {
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
         CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_device ON tokenomics_rollups(device_id, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_device_account ON tokenomics_rollups(device_id, provider, agent_kind, provider_account_key, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_scope ON tokenomics_rollups(billing_scope_type, billing_team_id, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_cloud_rollups_device ON tokenomics_cloud_rollups(device_id, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_cloud_rollups_account ON tokenomics_cloud_rollups(provider, agent_kind, provider_account_key, device_id, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_cloud_rollups_scope ON tokenomics_cloud_rollups(billing_scope_type, billing_team_id, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_observed ON tokenomics_usage_events(observed_at);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_source_offsets_provider ON tokenomics_source_offsets(provider, agent_kind, updated_at);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_scan_state_provider ON tokenomics_scan_state(provider, agent_kind, updated_at);
         PRAGMA user_version={TOKENOMICS_VIEW_SCHEMA_VERSION};
         COMMIT;",
    ))
    .map_err(|error| format!("Unable to finalize Tokenomics database schema: {error}"))?;
    tokenomics_rebuild_rollups_for_identity_version(conn)?;
    tokenomics_repair_provider_api_costs(conn)?;
    Ok(())
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
    let mut limits = tokenomics_provider_limits(conn, false, false)?;
    let sample_count = tokenomics_record_provider_limit_samples(conn, &limits)?;
    tokenomics_apply_provider_limit_sample_pacing(conn, &mut limits)?;
    let latest_window_count = tokenomics_record_latest_windows(conn, &limits)?;
    let limit_samples = tokenomics_provider_limit_sample_sync_rows(conn, None, None)?;
    let latest_windows = tokenomics_latest_window_rows(conn, None, None)?;
    Ok(json!({
        "known": false,
        "source": "rust_live_provider_limits",
        "updated_at": tokenomics_now_iso_like(),
        "limit_sample_count": sample_count,
        "latest_window_count": latest_window_count,
        "latestWindowCount": latest_window_count,
        "limit_samples": limit_samples.clone(),
        "limitSamples": limit_samples,
        "latest_windows": latest_windows.clone(),
        "latestWindows": latest_windows,
        "limits": limits,
    }))
}

fn tokenomics_scan_usage_for(
    app: &AppHandle,
    emit_progress: bool,
    force_resync_last_30_days: bool,
) -> Result<Value, String> {
    tokenomics_scan_usage_for_mode(
        app,
        emit_progress,
        force_resync_last_30_days,
        TokenomicsScanMode::Backfill,
    )
}

fn tokenomics_scan_realtime_usage_for(app: &AppHandle) -> Result<Value, String> {
    tokenomics_scan_usage_for_mode(app, false, false, TokenomicsScanMode::Realtime)
}

fn tokenomics_scan_usage_for_mode(
    app: &AppHandle,
    emit_progress: bool,
    force_resync_last_30_days: bool,
    scan_mode: TokenomicsScanMode,
) -> Result<Value, String> {
    let scan_lock = scan_mode.lock();
    let _scan_guard = match scan_lock.try_lock() {
        Ok(guard) => guard,
        Err(std::sync::TryLockError::WouldBlock) => {
            let conn = tokenomics_open_db(app)?;
            let mut summary = tokenomics_summary_from_conn(&conn, true, Some(0))?;
            summary["scan"] = json!({
                "status": "already_running",
                "files_scanned": 0,
                "inserted_events": 0,
                "sources": [],
                "forced_resync": force_resync_last_30_days,
                "mode": scan_mode.label(),
            });
            return Ok(summary);
        }
        Err(std::sync::TryLockError::Poisoned(error)) => error.into_inner(),
    };
    let conn = tokenomics_open_db(app)?;
    let mut scanned_files = 0usize;
    let mut inserted_events = 0usize;
    let mut sources = Vec::new();

    tokenomics_reconcile_current_provider_accounts(&conn)?;
    if force_resync_last_30_days {
        tokenomics_reset_scan_caches_for_resync(&conn)?;
    }
    tokenomics_reconcile_codex_provider_before_scan(&conn)?;
    if let Ok(limits_summary) = tokenomics_live_limits_snapshot_from_conn(&conn) {
        tokenomics_emit_scan_progress(
            app,
            emit_progress,
            json!({
                "phase": "limits_ready",
                "day_index": 0,
                "day_total": if scan_mode.is_realtime() { 1 } else { TOKENOMICS_INITIAL_BACKFILL_DAYS },
                "day_label": "latest limits",
                "files_scanned": 0,
                "inserted_events": 0,
                "mode": scan_mode.label(),
                "summary": limits_summary,
            }),
        );
    }
    let codex_result = tokenomics_scan_codex_state_db(app, &conn, emit_progress, scan_mode)?;
    scanned_files += codex_result.files_scanned;
    inserted_events += codex_result.inserted_events;
    sources.push(json!({
        "provider": "openai",
        "agent_kind": "codex",
        "files_scanned": codex_result.files_scanned,
        "inserted_events": codex_result.inserted_events,
        "status": codex_result.status,
        "source": "codex_token_count_jsonl",
    }));

    for source in tokenomics_sources() {
        tokenomics_reconcile_provider_scanner_version(
            &conn,
            source.provider,
            source.agent_kind,
            TOKENOMICS_GENERIC_SCANNER_VERSION,
        )?;
        let provider_account = source
            .account
            .clone()
            .unwrap_or_else(|| tokenomics_provider_account(source.provider, source.agent_kind));
        tokenomics_upsert_provider_account(
            &conn,
            tokenomics_local_device_id().as_str(),
            source.provider,
            source.agent_kind,
            &provider_account.key,
            Some(&provider_account.label),
            &tokenomics_current_billing_scope(),
            "source_scan",
        )?;
        let mut source_files = 0usize;
        let mut source_inserted = 0usize;
        let mut found_roots = 0usize;
        let source_now_unix = tokenomics_unix_now();
        let realtime_day_start = tokenomics_utc_day_start_unix(source_now_unix);
        let source_last_event =
            tokenomics_latest_source_offset_timestamp(&conn, source.provider, source.agent_kind)?;
        let source_region_kind = if scan_mode.is_realtime() {
            "realtime_current_day"
        } else if source_last_event > 0 && !force_resync_last_30_days {
            "catch_up"
        } else {
            "initial_backfill"
        };
        let source_region_start = if scan_mode.is_realtime() {
            realtime_day_start
        } else if source_region_kind == "catch_up" {
            source_last_event.saturating_sub(3_600)
        } else {
            source_now_unix.saturating_sub(TOKENOMICS_INITIAL_BACKFILL_DAYS * 86_400)
        };
        let mut newest_source_event = source_last_event;
        for root in source.roots {
            if !root.exists() {
                continue;
            }
            found_roots += 1;
            let source_id = root.display().to_string();
            tokenomics_upsert_usage_region(
                &conn,
                source.provider,
                source.agent_kind,
                &source_id,
                source_region_kind,
                source_region_start,
                source_now_unix,
                "running",
                newest_source_event,
            )?;
            let source_day_total = if scan_mode.is_realtime() {
                1
            } else {
                TOKENOMICS_INITIAL_BACKFILL_DAYS
            };
            let scan_file_limit = TOKENOMICS_SCAN_MAX_FILES_PER_PROVIDER
                .saturating_mul(source_day_total.max(1) as usize);
            let files = tokenomics_collect_candidate_files_with_min_mtime(
                &root,
                scan_file_limit,
                scan_mode.is_realtime().then_some(realtime_day_start),
            );
            for day_offset in 0..source_day_total {
                let day_start_unix = tokenomics_scan_day_start_from_offset(source_now_unix, day_offset);
                let day_files = files
                    .iter()
                    .filter(|file| {
                        let (modified, _) = tokenomics_file_mtime_size(file);
                        tokenomics_scan_day_offset_from_now(modified, source_now_unix)
                            == day_offset
                    })
                    .collect::<Vec<_>>();
                let day_candidate_count = day_files.len();
                let day_index = day_offset + 1;
                let day_label = tokenomics_scan_day_label_from_offset(day_offset);
                let day_complete = tokenomics_scan_day_is_complete(
                    &conn,
                    source.provider,
                    source.agent_kind,
                    &source_id,
                    TOKENOMICS_GENERIC_SCANNER_VERSION,
                    day_start_unix,
                )?;
                let day_offsets_current = day_files.iter().try_fold(true, |current, file| {
                    if !current {
                        return Ok::<bool, String>(false);
                    }
                    let Some(offset) =
                        tokenomics_get_source_offset(&conn, source.provider, source.agent_kind, file)?
                    else {
                        return Ok(false);
                    };
                    Ok(tokenomics_source_offset_is_current_for_range(
                        &offset,
                        file,
                        TOKENOMICS_GENERIC_SCANNER_VERSION,
                        day_start_unix,
                    ))
                })?;
                if day_complete && day_offsets_current {
                    tokenomics_emit_scan_progress(
                        app,
                        emit_progress,
                        json!({
                            "provider": source.provider,
                            "agent_kind": source.agent_kind,
                            "provider_account_key": provider_account.key.as_str(),
                            "provider_account_label": provider_account.label.as_str(),
                            "phase": "day_complete",
                            "day_index": day_index,
                            "day_total": source_day_total,
                            "day_label": day_label,
                            "files_scanned": scanned_files,
                            "inserted_events": inserted_events + source_inserted,
                            "day_files_scanned": 0,
                            "day_inserted_events": 0,
                            "candidate_count": files.len(),
                            "day_candidate_count": day_candidate_count,
                            "cached": true,
                            "mode": scan_mode.label(),
                        }),
                    );
                    continue;
                }
                tokenomics_emit_scan_progress(
                    app,
                    emit_progress,
                    json!({
                        "provider": source.provider,
                        "agent_kind": source.agent_kind,
                        "provider_account_key": provider_account.key.as_str(),
                        "provider_account_label": provider_account.label.as_str(),
                        "phase": if scan_mode.is_realtime() { "realtime_current_day" } else { "day_start" },
                        "day_index": day_index,
                        "day_total": source_day_total,
                        "day_label": day_label.as_str(),
                        "files_scanned": scanned_files,
                        "inserted_events": inserted_events + source_inserted,
                        "candidate_count": files.len(),
                        "day_candidate_count": day_candidate_count,
                        "mode": scan_mode.label(),
                    }),
                );
                let day_files_before = scanned_files;
                let day_inserted_before = inserted_events + source_inserted;
                for file in day_files {
                    if let Some(offset) =
                        tokenomics_get_source_offset(&conn, source.provider, source.agent_kind, file)?
                    {
                        if tokenomics_source_offset_is_current_for_range(
                            &offset,
                            file,
                            TOKENOMICS_GENERIC_SCANNER_VERSION,
                            day_start_unix,
                        ) {
                            continue;
                        }
                    }
                    source_files += 1;
                    scanned_files += 1;
                    let scan = tokenomics_scan_file(
                        &conn,
                        source.provider,
                        source.agent_kind,
                        &provider_account,
                        file,
                    )?;
                    source_inserted += scan.inserted_events;
                    newest_source_event = newest_source_event.max(scan.last_event_timestamp);
                    tokenomics_upsert_source_offset(
                        &conn,
                        source.provider,
                        source.agent_kind,
                        file,
                        TOKENOMICS_GENERIC_SCANNER_VERSION,
                        scan.last_line_index,
                        scan.last_event_timestamp,
                        day_start_unix,
                    )?;
                }
                let day_files_scanned = scanned_files.saturating_sub(day_files_before);
                let day_inserted_events =
                    (inserted_events + source_inserted).saturating_sub(day_inserted_before);
                tokenomics_upsert_scan_day(
                    &conn,
                    source.provider,
                    source.agent_kind,
                    &source_id,
                    TOKENOMICS_GENERIC_SCANNER_VERSION,
                    day_start_unix,
                    day_candidate_count,
                    day_files_scanned,
                    day_inserted_events,
                )?;
                let mut progress = json!({
                    "provider": source.provider,
                    "agent_kind": source.agent_kind,
                    "provider_account_key": provider_account.key.as_str(),
                    "provider_account_label": provider_account.label.as_str(),
                    "phase": "day_complete",
                    "day_index": day_index,
                    "day_total": source_day_total,
                    "day_label": day_label,
                    "files_scanned": scanned_files,
                    "inserted_events": inserted_events + source_inserted,
                    "day_files_scanned": day_files_scanned,
                    "day_inserted_events": day_inserted_events,
                    "candidate_count": files.len(),
                    "day_candidate_count": day_candidate_count,
                    "mode": scan_mode.label(),
                });
                if day_files_scanned > 0 || day_inserted_events > 0 {
                    if let Ok(summary) = tokenomics_summary_from_conn(
                        &conn,
                        true,
                        Some(inserted_events + source_inserted),
                    ) {
                        progress["summary"] = summary;
                    }
                }
                tokenomics_emit_scan_progress(app, emit_progress, progress);
            }
            tokenomics_upsert_usage_region(
                &conn,
                source.provider,
                source.agent_kind,
                &source_id,
                source_region_kind,
                source_region_start,
                source_now_unix,
                "complete",
                newest_source_event,
            )?;
        }
        inserted_events += source_inserted;
        sources.push(json!({
            "provider": source.provider,
            "agent_kind": source.agent_kind,
            "provider_account_key": provider_account.key.as_str(),
            "provider_account_label": provider_account.label.as_str(),
            "files_scanned": source_files,
            "inserted_events": source_inserted,
            "status": if source_files > 0 { "scanned" } else if found_roots > 0 { "current" } else { "not_found" },
        }));
    }

    let mut summary = tokenomics_summary_from_conn(&conn, true, Some(inserted_events))?;
    summary["scan"] = json!({
        "files_scanned": scanned_files,
        "inserted_events": inserted_events,
        "sources": sources,
        "forced_resync": force_resync_last_30_days,
        "mode": scan_mode.label(),
    });
    if force_resync_last_30_days {
        summary["forced_resync"] = json!(true);
    }
    Ok(summary)
}

fn tokenomics_reset_scan_caches_for_resync(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute("DELETE FROM tokenomics_scan_state", [])
        .map_err(|error| format!("Unable to reset Tokenomics scan state: {error}"))?;
    conn.execute("DELETE FROM tokenomics_source_offsets", [])
        .map_err(|error| format!("Unable to reset Tokenomics source offsets: {error}"))?;
    conn.execute("DELETE FROM tokenomics_scan_days", [])
        .map_err(|error| format!("Unable to reset Tokenomics scan days: {error}"))?;
    Ok(())
}

fn tokenomics_latest_source_offset_timestamp(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
) -> Result<u64, String> {
    let latest: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(last_event_timestamp), 0)
             FROM tokenomics_source_offsets
             WHERE provider=?1 AND agent_kind=?2",
            rusqlite::params![provider, agent_kind],
            |row| row.get(0),
        )
        .map_err(|error| format!("Unable to read Tokenomics source offset timestamp: {error}"))?;
    Ok(latest.max(0) as u64)
}

fn tokenomics_summary_inserted_events(summary: &Value) -> usize {
    summary
        .get("scan")
        .and_then(|scan| {
            scan.get("inserted_events")
                .or_else(|| scan.get("insertedEvents"))
        })
        .or_else(|| summary.get("inserted_events"))
        .or_else(|| summary.get("insertedEvents"))
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or_default()
}

async fn tokenomics_enqueue_usage_sync_if_inserted(
    app: AppHandle,
    state: &CloudMcpState,
    summary: &Value,
) {
    if tokenomics_summary_inserted_events(summary) == 0 {
        return;
    }
    let signed_in = cloud_mcp_authorization_bearer(state)
        .await
        .ok()
        .flatten()
        .is_some();
    if !signed_in {
        return;
    }
    let _ = cloud_mcp_enqueue_tokenomics_sync(
        app,
        state,
        "tokenomics_usage_changed".to_string(),
        false,
        false,
    )
    .await;
}

struct TokenomicsSource {
    provider: &'static str,
    agent_kind: &'static str,
    roots: Vec<PathBuf>,
    /// Per-source account override: agent-account profiles attribute their
    /// transcripts to their own account key instead of the default identity.
    account: Option<TokenomicsProviderAccount>,
}

fn tokenomics_sources() -> Vec<TokenomicsSource> {
    let home = tokenomics_home_dir();
    let mut sources = Vec::new();
    if let Some(home) = home {
        sources.push(TokenomicsSource {
            provider: "anthropic",
            agent_kind: "claude",
            roots: vec![home.join(".claude").join("projects")],
            account: None,
        });
        sources.push(TokenomicsSource {
            provider: "opencode",
            agent_kind: "opencode",
            roots: vec![
                home.join(".local").join("share").join("opencode"),
                home.join(".config").join("opencode"),
                home.join(".opencode"),
            ],
            account: None,
        });
    }
    // Additional Claude account profiles: each isolated CLAUDE_CONFIG_DIR
    // keeps its own transcript tree, so without these roots every non-default
    // account's usage would be invisible to tokenomics.
    for (profile_id, profile_label, profile_dir) in agent_accounts_profiles_for_tokenomics("claude")
    {
        sources.push(TokenomicsSource {
            provider: "anthropic",
            agent_kind: "claude",
            roots: vec![profile_dir.join("projects")],
            account: Some(TokenomicsProviderAccount {
                key: format!("anthropic:claude:profile:{profile_id}"),
                label: format!("Claude · {profile_label}"),
            }),
        });
    }
    sources
}

fn tokenomics_home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Account keys whose per-profile sources are suppressed because the
/// captured profile duplicates the Default login. Rows recorded under these
/// keys before the dedupe (limit gauges above all) made one login render as
/// two usage accounts; they are filtered from every limits payload, purged
/// from the local sample store, and published as retractions so the cloud
/// deletes its copies too.
fn tokenomics_retired_provider_account_keys() -> Vec<String> {
    let mut keys = Vec::new();
    for profile_id in agent_accounts_duplicate_profile_ids("claude") {
        keys.push(format!("anthropic:claude:profile:{profile_id}"));
    }
    for profile_id in agent_accounts_duplicate_profile_ids("codex") {
        keys.push(format!("openai:codex:profile:{profile_id}"));
    }
    keys
}

fn tokenomics_value_account_key(value: &Value) -> String {
    value
        .get("provider_account_key")
        .or_else(|| value.get("providerAccountKey"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

fn tokenomics_retain_active_account_rows(rows: &mut Vec<Value>, retired_keys: &[String]) {
    if retired_keys.is_empty() {
        return;
    }
    rows.retain(|row| {
        let key = tokenomics_value_account_key(row);
        key.is_empty() || !retired_keys.iter().any(|retired| retired == &key)
    });
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
    let auth_value = match normalized_agent.as_str() {
        "codex" => tokenomics_home_dir()
            .map(|home| home.join(".codex").join("auth.json"))
            .and_then(tokenomics_read_json_file),
        "claude" => tokenomics_claude_auth_value(),
        _ => None,
    };
    tokenomics_provider_account_from_auth(
        &normalized_provider,
        &normalized_agent,
        auth_value.as_ref(),
    )
}

fn tokenomics_provider_account_from_auth(
    provider: &str,
    agent_kind: &str,
    auth_value: Option<&Value>,
) -> TokenomicsProviderAccount {
    let base_label = tokenomics_provider_account_base_label(provider, agent_kind);
    let Some(auth_value) = auth_value else {
        return TokenomicsProviderAccount {
            key: format!("{provider}:{agent_kind}:unknown"),
            label: base_label,
        };
    };
    let mut identifiers =
        tokenomics_provider_account_key_identifiers(provider, agent_kind, auth_value);
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
        return TokenomicsProviderAccount {
            key: format!("{provider}:{agent_kind}:unknown"),
            label: base_label,
        };
    }
    let hash = tokenomics_hash(&format!("{provider}:{agent_kind}:{fingerprint}"));
    let key_suffix = hash.get(0..32).unwrap_or(hash.as_str());
    let label_suffix = hash.get(0..8).unwrap_or(hash.as_str());
    let label =
        tokenomics_provider_account_display_label(provider, agent_kind, auth_value, label_suffix)
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
        object.insert("agentProfileId".to_string(), json!(profile_id));
        object.insert("active_agent_profile".to_string(), json!(active));
        object.insert("activeAgentProfile".to_string(), json!(active));
        object.insert("active_provider_account".to_string(), json!(active));
        object.insert("activeProviderAccount".to_string(), json!(active));
    }
}

fn tokenomics_active_provider_account_key_map(limits: &[Value]) -> HashMap<String, String> {
    let mut keys = HashMap::new();
    for limit in limits {
        let active = limit
            .get("active_provider_account")
            .or_else(|| limit.get("activeProviderAccount"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !active {
            continue;
        }
        let provider =
            tokenomics_value_string(limit, &["provider"]).unwrap_or_else(|| "unknown".to_string());
        let agent_kind = tokenomics_value_string(limit, &["agent_kind", "agentKind"])
            .unwrap_or_else(|| provider.clone());
        let account_key = tokenomics_value_string(
            limit,
            &[
                "provider_account_key",
                "providerAccountKey",
                "subscription_key",
                "subscriptionKey",
            ],
        )
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
        let agent_kind = tokenomics_value_string(limit, &["agent_kind", "agentKind"])
            .unwrap_or_else(|| provider.clone());
        let account_key = tokenomics_value_string(
            limit,
            &[
                "provider_account_key",
                "providerAccountKey",
                "subscription_key",
                "subscriptionKey",
            ],
        )
        .unwrap_or_default();
        let active = active_account_keys
            .get(&format!("{provider}\u{1f}{agent_kind}"))
            .map(|active_key| active_key == &account_key)
            .unwrap_or(false);
        let Some(object) = limit.as_object_mut() else {
            continue;
        };
        object.insert("active_provider_account".to_string(), json!(active));
        object.insert("activeProviderAccount".to_string(), json!(active));
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
) -> Option<String> {
    match (provider, agent_kind) {
        ("openai", "codex") => tokenomics_codex_account_display_label(auth_value, account_suffix),
        ("anthropic", "claude") => {
            tokenomics_claude_account_display_label(auth_value, account_suffix)
        }
        _ => None,
    }
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
) -> Vec<String> {
    match (provider, agent_kind) {
        ("openai", "codex") => tokenomics_codex_account_key_identifiers(auth_value),
        ("anthropic", "claude") => tokenomics_claude_account_key_identifiers(auth_value),
        _ => tokenomics_generic_account_key_identifiers(auth_value),
    }
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
    for keys in [
        &["account_id", "accountId"][..],
        &["chatgpt_account_id", "chatgptAccountId"][..],
        &[
            "chatgpt_account_user_id",
            "chatgptAccountUserId",
            "chatgpt_user_id",
            "chatgptUserId",
            "user_id",
            "userId",
            "userid",
        ][..],
        &["sub"][..],
        &["email", "login", "username"][..],
    ] {
        let mut identifiers = Vec::new();
        tokenomics_collect_json_values_for_keys(auth_value, keys, &mut identifiers);
        if identifiers.is_empty() {
            tokenomics_collect_jwt_values_for_keys(auth_value, keys, &mut identifiers);
        }
        identifiers.sort();
        identifiers.dedup();
        if !identifiers.is_empty() {
            return identifiers;
        }
    }
    Vec::new()
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
        &[
            "billing_scope_type",
            "billingScopeType",
            "account_scope_type",
            "accountScopeType",
            "scope_type",
            "scopeType",
        ],
    );
    let team_id = tokenomics_value_string(
        value,
        &[
            "billing_team_id",
            "billingTeamId",
            "account_team_id",
            "accountTeamId",
            "team_id",
            "teamId",
        ],
    );
    if scope_type.is_none() && team_id.is_none() {
        return fallback.clone();
    }
    let source = tokenomics_value_string(
        value,
        &[
            "billing_scope_source",
            "billingScopeSource",
            "account_scope_source",
            "accountScopeSource",
            "scope_source",
            "scopeSource",
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
        &[
            "display_name",
            "displayName",
            "device_name",
            "deviceName",
            "machine_name",
            "machineName",
            "hostname",
        ],
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

fn tokenomics_local_device_id_set(
    conn: &rusqlite::Connection,
) -> Result<HashSet<String>, String> {
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
        "" | "desktop-primary" | "cloud" | "account" | "all" | "all-device" | "all-devices"
            | "all_device" | "all_devices" | "unknown-device" | "unknown_device"
    )
}

fn tokenomics_is_remote_cloud_device_id(device_id: &str, local_device_ids: &HashSet<String>) -> bool {
    let clean = device_id.trim();
    !tokenomics_cloud_relay_placeholder_device_id(clean) && !local_device_ids.contains(clean)
}

fn tokenomics_remote_cloud_device_id_from_value(
    value: &Value,
    inherited_device_id: Option<&str>,
    local_device_ids: &HashSet<String>,
) -> Option<String> {
    let device_id = tokenomics_text_field(value, &["device_id", "deviceId", "machine_id", "machineId"])
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
        tokenomics_text_field(identity, &["device_id", "deviceId"]),
        tokenomics_text_field(identity, &["machine_id", "machineId"]),
        tokenomics_text_field(identity, &["native_device_id", "nativeDeviceId"]),
        tokenomics_text_field(identity, &["target_device_id", "targetDeviceId"]),
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
            "displayName",
            "label",
            "device_name",
            "deviceName",
            "machine_name",
            "machineName",
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
        .or_else(|| summary.get("deviceIdentities"))
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
        let updated_at = tokenomics_text_field(
            &identity,
            &["updated_at", "updatedAt", "last_seen_at", "lastSeenAt"],
        )
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
                .and_then(|existing| tokenomics_text_field(existing, &["updated_at", "updatedAt"]))
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
        return Ok(());
    }
    for alias in &aliases {
        for table in ["tokenomics_usage_events", "tokenomics_rollups"] {
            conn.execute(
                &format!("UPDATE {table} SET device_id=?1 WHERE device_id=?2"),
                rusqlite::params![current_device_id.as_str(), alias.as_str()],
            )
            .map_err(|error| format!("Unable to collapse Tokenomics device alias: {error}"))?;
        }
    }
    tokenomics_store_local_device_aliases(conn, &aliases)?;
    tokenomics_rebuild_all_rollups_from_events(conn)?;
    conn.execute(
        "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES('rollup_identity_version', ?1)",
        rusqlite::params![TOKENOMICS_ROLLUP_ID_VERSION],
    )
    .map_err(|error| format!("Unable to record Tokenomics rollup version: {error}"))?;
    Ok(())
}

#[derive(Clone)]
struct TokenomicsSourceIdentity {
    provider_account: TokenomicsProviderAccount,
    billing_scope: TokenomicsBillingScope,
}

fn tokenomics_existing_source_identity(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    path: &Path,
) -> Result<Option<TokenomicsSourceIdentity>, String> {
    let source_path = path.display().to_string();
    let source_path_with_suffix = format!("{source_path}:%");
    match conn.query_row(
        "SELECT
           COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, '')) AS account_key,
           COALESCE(MAX(NULLIF(provider_account_label, '')), '') AS account_label,
           COALESCE(NULLIF(billing_scope_type, ''), 'unknown') AS billing_scope_type,
           NULLIF(billing_team_id, '') AS billing_team_id,
           COALESCE(MAX(NULLIF(billing_scope_source, '')), 'unknown') AS billing_scope_source
         FROM tokenomics_usage_events
         WHERE provider=?1 AND agent_kind=?2
           AND COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, '')) IS NOT NULL
           AND (source_path=?3 OR source_path LIKE ?4)
         GROUP BY account_key, billing_scope_type, billing_team_id
         ORDER BY COUNT(*) DESC, MAX(COALESCE(observed_at, '')) DESC
         LIMIT 1",
        rusqlite::params![provider, agent_kind, source_path, source_path_with_suffix],
        |row| {
            let key: String = row.get(0)?;
            let label = row
                .get::<_, Option<String>>(1)?
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| key.clone());
            let scope_type = row.get::<_, Option<String>>(2)?;
            let team_id = row.get::<_, Option<String>>(3)?;
            let scope_source = row
                .get::<_, Option<String>>(4)?
                .unwrap_or_else(|| "existing_source_identity".to_string());
            Ok(TokenomicsSourceIdentity {
                provider_account: TokenomicsProviderAccount { key, label },
                billing_scope: tokenomics_billing_scope_from_parts(
                    scope_type.as_deref(),
                    team_id.as_deref(),
                    &scope_source,
                ),
            })
        },
    ) {
        Ok(identity) => Ok(Some(identity)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!(
            "Unable to read Tokenomics source identity for {}: {error}",
            path.display()
        )),
    }
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

struct TokenomicsScanResult {
    files_scanned: usize,
    inserted_events: usize,
    status: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TokenomicsScanMode {
    Backfill,
    Realtime,
}

impl TokenomicsScanMode {
    fn is_realtime(self) -> bool {
        matches!(self, Self::Realtime)
    }

    fn lock(self) -> &'static StdMutex<()> {
        if self.is_realtime() {
            TOKENOMICS_REALTIME_SCAN_LOCK.get_or_init(|| StdMutex::new(()))
        } else {
            TOKENOMICS_SCAN_LOCK.get_or_init(|| StdMutex::new(()))
        }
    }

    fn label(self) -> &'static str {
        if self.is_realtime() {
            "realtime"
        } else {
            "backfill"
        }
    }
}

struct TokenomicsCodexThreadCandidate {
    thread_id: String,
    rollout_path: PathBuf,
    source: String,
    model_provider: String,
    model: Option<String>,
    cwd: Option<String>,
    updated_at_unix: u64,
}

struct TokenomicsFileScanResult {
    inserted_events: usize,
    last_line_index: i64,
    last_event_timestamp: u64,
}

struct TokenomicsScanState {
    scanner_version: String,
    initial_backfill_done: bool,
    last_event_timestamp: u64,
}

struct TokenomicsSourceOffset {
    scanner_version: String,
    last_line_index: i64,
    last_seen_mtime: u64,
    last_seen_size: u64,
    last_event_timestamp: u64,
    coverage_start_unix: u64,
}

fn tokenomics_delete_provider_rows(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM tokenomics_usage_events WHERE provider=?1 AND agent_kind=?2",
        rusqlite::params![provider, agent_kind],
    )
    .map_err(|error| format!("Unable to clear Tokenomics provider events: {error}"))?;
    conn.execute(
        "DELETE FROM tokenomics_rollups WHERE provider=?1 AND agent_kind=?2",
        rusqlite::params![provider, agent_kind],
    )
    .map_err(|error| format!("Unable to clear Tokenomics provider rollups: {error}"))?;
    Ok(())
}

fn tokenomics_delete_provider_scan_cache(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM tokenomics_scan_state WHERE provider=?1 AND agent_kind=?2",
        rusqlite::params![provider, agent_kind],
    )
    .map_err(|error| format!("Unable to clear Tokenomics scan state: {error}"))?;
    conn.execute(
        "DELETE FROM tokenomics_source_offsets WHERE provider=?1 AND agent_kind=?2",
        rusqlite::params![provider, agent_kind],
    )
    .map_err(|error| format!("Unable to clear Tokenomics source offsets: {error}"))?;
    conn.execute(
        "DELETE FROM tokenomics_scan_days WHERE provider=?1 AND agent_kind=?2",
        rusqlite::params![provider, agent_kind],
    )
    .map_err(|error| format!("Unable to clear Tokenomics scan days: {error}"))?;
    Ok(())
}

fn tokenomics_reconcile_provider_scanner_version(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    scanner_version: &str,
) -> Result<(), String> {
    let outdated_offsets: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tokenomics_source_offsets
             WHERE provider=?1 AND agent_kind=?2 AND scanner_version!=?3",
            rusqlite::params![provider, agent_kind, scanner_version],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let accountless_events: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tokenomics_usage_events
             WHERE provider=?1 AND agent_kind=?2
               AND (provider_account_key IS NULL OR provider_account_key='')",
            rusqlite::params![provider, agent_kind],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if outdated_offsets > 0 || accountless_events > 0 {
        tokenomics_delete_provider_rows(conn, provider, agent_kind)?;
        tokenomics_delete_provider_scan_cache(conn, provider, agent_kind)?;
    }
    Ok(())
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
            now
        ],
    )
    .map_err(|error| format!("Unable to reconcile Tokenomics account rollup labels: {error}"))?;

    Ok(())
}

fn tokenomics_migrate_provider_account_key(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    old_key: &str,
    provider_account: &TokenomicsProviderAccount,
) -> Result<(), String> {
    if old_key.trim().is_empty()
        || old_key == provider_account.key
        || provider_account.key.ends_with(":unknown")
    {
        return Ok(());
    }

    let old_rollups: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tokenomics_rollups
             WHERE provider=?1 AND agent_kind=?2
               AND (provider_account_key=?3 OR subscription_key=?3)",
            rusqlite::params![provider, agent_kind, old_key],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let changed_events = conn
        .execute(
            "UPDATE tokenomics_usage_events
             SET subscription_key=?1, provider_account_key=?1, provider_account_label=?2
             WHERE provider=?3 AND agent_kind=?4
               AND (provider_account_key=?5 OR subscription_key=?5)",
            rusqlite::params![
                provider_account.key.as_str(),
                provider_account.label.as_str(),
                provider,
                agent_kind,
                old_key
            ],
        )
        .map_err(|error| format!("Unable to migrate Tokenomics account events: {error}"))?;

    if changed_events > 0 || old_rollups > 0 {
        tokenomics_rebuild_provider_rollups_from_events(conn, provider, agent_kind)?;
    }

    let now = tokenomics_now_iso_like();
    let now_unix = tokenomics_unix_now() as i64;
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

    let mut account_statement = conn
        .prepare(
            "SELECT device_id,
                    COALESCE(NULLIF(billing_scope_type, ''), 'unknown') AS billing_scope_type,
                    NULLIF(billing_team_id, '') AS billing_team_id,
                    COALESCE(NULLIF(billing_scope_source, ''), 'unknown') AS billing_scope_source,
                    COALESCE(NULLIF(attribution_source, ''), 'account_migration') AS attribution_source
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
            ))
        })
        .map_err(|error| format!("Unable to query Tokenomics account badges: {error}"))?;
    let mut migrated_account_rows = Vec::new();
    for row in account_rows {
        migrated_account_rows
            .push(row.map_err(|error| format!("Unable to read Tokenomics account badge: {error}"))?);
    }
    drop(account_statement);
    for (device_id, scope, attribution_source) in migrated_account_rows {
        tokenomics_upsert_provider_account(
            conn,
            &device_id,
            provider,
            agent_kind,
            &provider_account.key,
            Some(&provider_account.label),
            &scope,
            &attribution_source,
        )?;
    }
    conn.execute(
        "DELETE FROM tokenomics_provider_accounts
         WHERE provider=?1 AND agent_kind=?2 AND provider_account_key=?3",
        rusqlite::params![provider, agent_kind, old_key],
    )
    .map_err(|error| format!("Unable to remove stale Tokenomics account badges: {error}"))?;

    conn.execute(
        "UPDATE tokenomics_cloud_rollups
         SET subscription_key=CASE WHEN subscription_key=?5 THEN ?1 ELSE subscription_key END,
             provider_account_key=CASE WHEN provider_account_key=?5 THEN ?1 ELSE provider_account_key END,
             provider_account_label=?2,
             updated_at=?6
         WHERE provider=?3 AND agent_kind=?4
           AND (provider_account_key=?5 OR subscription_key=?5)",
        rusqlite::params![
            provider_account.key.as_str(),
            provider_account.label.as_str(),
            provider,
            agent_kind,
            old_key,
            now.as_str()
        ],
    )
    .map_err(|error| format!("Unable to migrate cached cloud Tokenomics account rollups: {error}"))?;
    tokenomics_rewrite_cloud_provider_limits_for_account_key(
        conn,
        provider,
        agent_kind,
        old_key,
        provider_account,
    )?;

    Ok(())
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
    let mut candidates_by_key =
        HashMap::<(String, String, String, String), TokenomicsProviderAccountIdentityCandidate>::new();
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
        let entry =
            candidates_by_key
                .entry(key)
                .or_insert_with(|| TokenomicsProviderAccountIdentityCandidate {
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
    let candidates = tokenomics_provider_account_identity_candidates(conn)?;
    let mut groups =
        HashMap::<(String, String, String), Vec<TokenomicsProviderAccountIdentityCandidate>>::new();
    for candidate in candidates {
        groups
            .entry((
                candidate.provider.clone(),
                candidate.agent_kind.clone(),
                candidate.normalized_label.clone(),
            ))
            .or_default()
            .push(candidate);
    }

    let mut changed = false;
    for ((provider, agent_kind, _label), mut accounts) in groups {
        accounts.sort_by(|left, right| {
            right
                .usage_total
                .cmp(&left.usage_total)
                .then_with(|| right.rollup_total.cmp(&left.rollup_total))
                .then_with(|| right.cloud_total.cmp(&left.cloud_total))
                .then_with(|| right.authoritative_rows().cmp(&left.authoritative_rows()))
                .then_with(|| right.account_rows.cmp(&left.account_rows))
                .then_with(|| right.updated_at_unix.cmp(&left.updated_at_unix))
                .then_with(|| left.provider_account_key.cmp(&right.provider_account_key))
        });
        accounts.dedup_by(|left, right| left.provider_account_key == right.provider_account_key);
        if accounts.len() < 2 || !accounts.iter().any(|account| account.has_authoritative_data()) {
            continue;
        }
        let canonical = accounts[0].clone();
        if !canonical.has_authoritative_data() {
            continue;
        }
        let canonical_account = TokenomicsProviderAccount {
            key: canonical.provider_account_key.clone(),
            label: canonical.provider_account_label.clone(),
        };
        for alias in accounts.iter().skip(1) {
            if alias.provider_account_key == canonical_account.key {
                continue;
            }
            tokenomics_migrate_provider_account_key(
                conn,
                &provider,
                &agent_kind,
                &alias.provider_account_key,
                &canonical_account,
            )?;
            changed = true;
        }
    }

    if changed {
        tokenomics_compact_provider_account_fact_rows(conn)?;
    }
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
    for table in [
        "tokenomics_rollups",
        "tokenomics_usage_events",
        "tokenomics_cloud_rollups",
    ] {
        let sql = format!(
            "SELECT provider_account_label
             FROM {table}
             WHERE provider=?1 AND agent_kind=?2
               AND (provider_account_key=?3 OR subscription_key=?3)
               AND COALESCE(provider_account_label, '')!=''
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
        let row_agent = tokenomics_value_string(limit, &["agent_kind", "agentKind"])
            .unwrap_or_else(|| row_provider.clone());
        let row_account_key = tokenomics_value_string(
            limit,
            &[
                "provider_account_key",
                "providerAccountKey",
                "subscription_key",
                "subscriptionKey",
            ],
        )
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
                "providerAccountKey".to_string(),
                json!(provider_account.key.as_str()),
            );
            object.insert(
                "subscription_key".to_string(),
                json!(provider_account.key.as_str()),
            );
            object.insert(
                "subscriptionKey".to_string(),
                json!(provider_account.key.as_str()),
            );
            object.insert(
                "provider_account_label".to_string(),
                json!(provider_account.label.as_str()),
            );
            object.insert(
                "providerAccountLabel".to_string(),
                json!(provider_account.label.as_str()),
            );
            let has_relay_device = tokenomics_value_string(
                &Value::Object(object.clone()),
                &["device_id", "deviceId", "machine_id", "machineId"],
            )
            .is_some_and(|device_id| {
                !tokenomics_cloud_relay_placeholder_device_id(&device_id)
            });
            if !has_relay_device {
                if let Some(device_id) = inferred_device_id.as_deref() {
                    object.insert("device_id".to_string(), json!(device_id));
                    object.insert("deviceId".to_string(), json!(device_id));
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
            .query_map(rusqlite::params![provider, agent_kind, account_key], |row| {
                row.get::<_, String>(0)
            })
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
    if canonical_account.key != provider_account.key {
        tokenomics_migrate_provider_account_key(
            conn,
            "openai",
            "codex",
            provider_account.key.as_str(),
            &canonical_account,
        )?;
    }
    tokenomics_reconcile_provider_account_label(conn, "openai", "codex", &canonical_account)?;
    let canonical_cache_key = tokenomics_codex_usage_cache_key(&canonical_account);
    let _ = tokenomics_store_codex_usage_cache(conn, &canonical_cache_key, usage);
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

fn tokenomics_reconcile_current_codex_account_label(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let codex_account = tokenomics_provider_account("openai", "codex");
    tokenomics_reconcile_codex_cached_usage_aliases(conn)?;
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
    tokenomics_reconcile_current_codex_account_label(conn)?;
    tokenomics_reconcile_current_claude_account_identity(conn)?;
    tokenomics_reconcile_duplicate_provider_account_identities(conn)?;
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

fn tokenomics_emit_scan_progress(app: &AppHandle, emit_progress: bool, payload: Value) {
    if !emit_progress {
        return;
    }
    let _ = app.emit(TOKENOMICS_SCAN_PROGRESS_EVENT, payload);
}

fn tokenomics_utc_day_start_unix(seconds: u64) -> u64 {
    seconds
        .checked_div(86_400)
        .unwrap_or(0)
        .saturating_mul(86_400)
}

fn tokenomics_scan_day_offset_from_now(updated_at_unix: u64, now_unix: u64) -> u64 {
    let now_day = tokenomics_utc_day_start_unix(now_unix)
        .checked_div(86_400)
        .unwrap_or(0);
    let updated_day = tokenomics_utc_day_start_unix(updated_at_unix)
        .checked_div(86_400)
        .unwrap_or(0);
    now_day.saturating_sub(updated_day)
}

fn tokenomics_scan_day_start_from_offset(now_unix: u64, day_offset: u64) -> u64 {
    tokenomics_utc_day_start_unix(now_unix).saturating_sub(day_offset.saturating_mul(86_400))
}

fn tokenomics_scan_day_label_from_offset(day_offset: u64) -> String {
    if day_offset == 0 {
        "today".to_string()
    } else if day_offset == 1 {
        "yesterday".to_string()
    } else {
        format!("{day_offset} days ago")
    }
}

#[cfg(test)]
fn tokenomics_scan_day_progress(
    updated_at_unix: u64,
    backfill_cutoff: u64,
    now_unix: u64,
) -> (u64, u64, String) {
    let total_days = TOKENOMICS_INITIAL_BACKFILL_DAYS.max(1);
    let clamped = updated_at_unix.clamp(backfill_cutoff, now_unix.max(backfill_cutoff));
    let day_index = clamped
        .saturating_sub(backfill_cutoff)
        .checked_div(86_400)
        .unwrap_or(0)
        .min(total_days.saturating_sub(1));
    let remaining_days = now_unix
        .saturating_sub(clamped)
        .checked_div(86_400)
        .unwrap_or(0);
    let label = if remaining_days == 0 {
        "today".to_string()
    } else if remaining_days == 1 {
        "yesterday".to_string()
    } else {
        format!("{remaining_days} days ago")
    };
    (day_index + 1, total_days, label)
}

fn tokenomics_normalize_unix_timestamp(value: i64) -> u64 {
    let value = value.max(0) as u64;
    if value > 10_000_000_000 {
        value / 1000
    } else {
        value
    }
}

fn tokenomics_file_mtime_size(path: &Path) -> (u64, u64) {
    let Ok(metadata) = fs::metadata(path) else {
        return (0, 0);
    };
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    (modified, metadata.len())
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

fn tokenomics_get_scan_state(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    source_id: &str,
) -> Result<Option<TokenomicsScanState>, String> {
    match conn.query_row(
        "SELECT scanner_version, initial_backfill_done, last_event_timestamp
         FROM tokenomics_scan_state
         WHERE provider=?1 AND agent_kind=?2 AND source_id=?3",
        rusqlite::params![provider, agent_kind, source_id],
        |row| {
            Ok(TokenomicsScanState {
                scanner_version: row.get(0)?,
                initial_backfill_done: row.get::<_, i64>(1)? != 0,
                last_event_timestamp: row.get::<_, i64>(2).unwrap_or(0).max(0) as u64,
            })
        },
    ) {
        Ok(state) => Ok(Some(state)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Unable to read Tokenomics scan state: {error}")),
    }
}

fn tokenomics_upsert_scan_state(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    source_id: &str,
    scanner_version: &str,
    initial_backfill_done: bool,
    last_event_timestamp: u64,
) -> Result<(), String> {
    let now = tokenomics_now_iso_like();
    conn.execute(
        "INSERT INTO tokenomics_scan_state(
           provider, agent_kind, source_id, scanner_version, initial_backfill_done,
           last_event_timestamp, last_scanned_at, updated_at
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(provider, agent_kind, source_id)
         DO UPDATE SET
           scanner_version=excluded.scanner_version,
           initial_backfill_done=excluded.initial_backfill_done,
           last_event_timestamp=excluded.last_event_timestamp,
           last_scanned_at=excluded.last_scanned_at,
           updated_at=excluded.updated_at",
        rusqlite::params![
            provider,
            agent_kind,
            source_id,
            scanner_version,
            if initial_backfill_done { 1 } else { 0 },
            last_event_timestamp as i64,
            now,
        ],
    )
    .map_err(|error| format!("Unable to write Tokenomics scan state: {error}"))?;
    Ok(())
}

fn tokenomics_usage_region_id(
    device_id: &str,
    provider: &str,
    agent_kind: &str,
    source_id: &str,
    region_kind: &str,
) -> String {
    let raw = format!(
        "{device_id}\u{1f}{provider}\u{1f}{agent_kind}\u{1f}{source_id}\u{1f}{region_kind}"
    );
    format!("usage-region-{}", tokenomics_hash(&raw))
}

fn tokenomics_upsert_usage_region(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    source_id: &str,
    region_kind: &str,
    region_start_unix: u64,
    region_end_unix: u64,
    status: &str,
    last_event_timestamp: u64,
) -> Result<(), String> {
    let device_id = tokenomics_local_device_id();
    let id = tokenomics_usage_region_id(&device_id, provider, agent_kind, source_id, region_kind);
    let now = tokenomics_now_iso_like();
    conn.execute(
        "INSERT INTO tokenomics_usage_regions(
           id, device_id, provider, agent_kind, source_id, region_kind,
           region_start_unix, region_end_unix, status, last_event_timestamp, updated_at
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET
           region_start_unix=excluded.region_start_unix,
           region_end_unix=excluded.region_end_unix,
           status=excluded.status,
           last_event_timestamp=excluded.last_event_timestamp,
           updated_at=excluded.updated_at",
        rusqlite::params![
            id,
            device_id,
            provider,
            agent_kind,
            source_id,
            region_kind,
            region_start_unix as i64,
            region_end_unix as i64,
            status,
            last_event_timestamp as i64,
            now,
        ],
    )
    .map_err(|error| format!("Unable to upsert Tokenomics usage region: {error}"))?;
    Ok(())
}

fn tokenomics_get_source_offset(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    path: &Path,
) -> Result<Option<TokenomicsSourceOffset>, String> {
    let source_path = path.display().to_string();
    match conn.query_row(
        "SELECT scanner_version, last_line_index, last_seen_mtime, last_seen_size, last_event_timestamp, coverage_start_unix
         FROM tokenomics_source_offsets
         WHERE provider=?1 AND agent_kind=?2 AND source_path=?3",
        rusqlite::params![provider, agent_kind, source_path],
        |row| {
            Ok(TokenomicsSourceOffset {
                scanner_version: row.get(0)?,
                last_line_index: row.get::<_, i64>(1).unwrap_or(-1),
                last_seen_mtime: row.get::<_, i64>(2).unwrap_or(0).max(0) as u64,
                last_seen_size: row.get::<_, i64>(3).unwrap_or(0).max(0) as u64,
                last_event_timestamp: row.get::<_, i64>(4).unwrap_or(0).max(0) as u64,
                coverage_start_unix: row
                    .get::<_, i64>(5)
                    .unwrap_or(TOKENOMICS_UNKNOWN_OFFSET_COVERAGE_START_UNIX as i64)
                    .max(0) as u64,
            })
        },
    ) {
        Ok(offset) => Ok(Some(offset)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Unable to read Tokenomics source offset: {error}")),
    }
}

fn tokenomics_upsert_source_offset(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    path: &Path,
    scanner_version: &str,
    last_line_index: i64,
    last_event_timestamp: u64,
    coverage_start_unix: u64,
) -> Result<(), String> {
    let (last_seen_mtime, last_seen_size) = tokenomics_file_mtime_size(path);
    let now = tokenomics_now_iso_like();
    conn.execute(
        "INSERT INTO tokenomics_source_offsets(
           provider, agent_kind, source_path, scanner_version, last_line_index,
           last_seen_mtime, last_seen_size, last_event_timestamp, coverage_start_unix, updated_at
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(provider, agent_kind, source_path)
         DO UPDATE SET
           scanner_version=excluded.scanner_version,
           last_line_index=excluded.last_line_index,
           last_seen_mtime=excluded.last_seen_mtime,
           last_seen_size=excluded.last_seen_size,
           last_event_timestamp=excluded.last_event_timestamp,
           coverage_start_unix=CASE
             WHEN tokenomics_source_offsets.scanner_version=excluded.scanner_version
             THEN MIN(tokenomics_source_offsets.coverage_start_unix, excluded.coverage_start_unix)
             ELSE excluded.coverage_start_unix
           END,
           updated_at=excluded.updated_at",
        rusqlite::params![
            provider,
            agent_kind,
            path.display().to_string(),
            scanner_version,
            last_line_index,
            last_seen_mtime as i64,
            last_seen_size as i64,
            last_event_timestamp as i64,
            coverage_start_unix.min(TOKENOMICS_UNKNOWN_OFFSET_COVERAGE_START_UNIX) as i64,
            now,
        ],
    )
    .map_err(|error| format!("Unable to write Tokenomics source offset: {error}"))?;
    Ok(())
}

fn tokenomics_source_offset_is_current_for_range(
    offset: &TokenomicsSourceOffset,
    path: &Path,
    scanner_version: &str,
    required_coverage_start_unix: u64,
) -> bool {
    let (mtime, size) = tokenomics_file_mtime_size(path);
    offset.scanner_version == scanner_version
        && offset.last_seen_mtime == mtime
        && offset.last_seen_size == size
        && offset.coverage_start_unix <= required_coverage_start_unix
}

fn tokenomics_scan_day_is_complete(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    source_id: &str,
    scanner_version: &str,
    day_start_unix: u64,
) -> Result<bool, String> {
    let status = conn.query_row(
        "SELECT status
         FROM tokenomics_scan_days
         WHERE provider=?1
           AND agent_kind=?2
           AND source_id=?3
           AND day_start_unix=?4
           AND scanner_version=?5",
        rusqlite::params![
            provider,
            agent_kind,
            source_id,
            day_start_unix.min(i64::MAX as u64) as i64,
            scanner_version,
        ],
        |row| row.get::<_, String>(0),
    );
    match status {
        Ok(status) => Ok(status == "complete"),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(error) => Err(format!("Unable to read Tokenomics scan day: {error}")),
    }
}

fn tokenomics_upsert_scan_day(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    source_id: &str,
    scanner_version: &str,
    day_start_unix: u64,
    candidate_count: usize,
    files_scanned: usize,
    inserted_events: usize,
) -> Result<(), String> {
    let now = tokenomics_now_iso_like();
    conn.execute(
        "INSERT INTO tokenomics_scan_days(
           provider, agent_kind, source_id, day_start_unix, scanner_version,
           status, candidate_count, files_scanned, inserted_events, completed_at, updated_at
         ) VALUES(?1, ?2, ?3, ?4, ?5, 'complete', ?6, ?7, ?8, ?9, ?9)
         ON CONFLICT(provider, agent_kind, source_id, day_start_unix)
         DO UPDATE SET
           scanner_version=excluded.scanner_version,
           status='complete',
           candidate_count=excluded.candidate_count,
           files_scanned=excluded.files_scanned,
           inserted_events=excluded.inserted_events,
           completed_at=excluded.completed_at,
           updated_at=excluded.updated_at",
        rusqlite::params![
            provider,
            agent_kind,
            source_id,
            day_start_unix.min(i64::MAX as u64) as i64,
            scanner_version,
            candidate_count as i64,
            files_scanned as i64,
            inserted_events as i64,
            now,
        ],
    )
    .map_err(|error| format!("Unable to write Tokenomics scan day: {error}"))?;
    Ok(())
}

fn tokenomics_scan_codex_state_db(
    app: &AppHandle,
    conn: &rusqlite::Connection,
    emit_progress: bool,
    scan_mode: TokenomicsScanMode,
) -> Result<TokenomicsScanResult, String> {
    let Some(home) = tokenomics_home_dir() else {
        return Ok(TokenomicsScanResult {
            files_scanned: 0,
            inserted_events: 0,
            status: "home_not_found",
        });
    };
    let db_path = home.join(".codex").join("state_5.sqlite");
    if !db_path.exists() {
        return Ok(TokenomicsScanResult {
            files_scanned: 0,
            inserted_events: 0,
            status: "not_found",
        });
    }
    let source_id = db_path.display().to_string();
    let provider_account = tokenomics_provider_account("openai", "codex");
    tokenomics_reconcile_provider_account_label(conn, "openai", "codex", &provider_account)?;
    let mut scan_state = tokenomics_get_scan_state(conn, "openai", "codex", &source_id)?;
    let needs_scanner_reset = scan_state
        .as_ref()
        .map(|state| state.scanner_version.as_str() != TOKENOMICS_CODEX_SCANNER_VERSION)
        .unwrap_or(false);
    let accountless_events: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tokenomics_usage_events
             WHERE provider='openai' AND agent_kind='codex'
               AND (provider_account_key IS NULL OR provider_account_key='')",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if accountless_events > 0 {
        tokenomics_delete_provider_rows(conn, "openai", "codex")?;
        tokenomics_delete_provider_scan_cache(conn, "openai", "codex")?;
        scan_state = None;
    } else if needs_scanner_reset || (!scan_mode.is_realtime() && scan_state.is_none()) {
        tokenomics_delete_provider_scan_cache(conn, "openai", "codex")?;
        scan_state = None;
    }
    let initial_backfill_done = scan_state
        .as_ref()
        .map(|state| state.initial_backfill_done)
        .unwrap_or(false);
    let now_unix = tokenomics_unix_now();
    let realtime_day_start = tokenomics_utc_day_start_unix(now_unix);
    let backfill_cutoff = now_unix.saturating_sub(TOKENOMICS_INITIAL_BACKFILL_DAYS * 86_400);
    let min_thread_updated_at = if scan_mode.is_realtime() {
        realtime_day_start
    } else {
        backfill_cutoff
    };
    let scan_region_kind = if scan_mode.is_realtime() {
        "realtime_current_day"
    } else if initial_backfill_done {
        "catch_up"
    } else {
        "initial_backfill"
    };
    let scan_day_total = if scan_mode.is_realtime() {
        1
    } else {
        TOKENOMICS_INITIAL_BACKFILL_DAYS
    };
    tokenomics_upsert_provider_account(
        conn,
        tokenomics_local_device_id().as_str(),
        "openai",
        "codex",
        &provider_account.key,
        Some(&provider_account.label),
        &tokenomics_current_billing_scope(),
        "current_auth",
    )?;
    tokenomics_upsert_usage_region(
        conn,
        "openai",
        "codex",
        &source_id,
        scan_region_kind,
        min_thread_updated_at,
        now_unix,
        "running",
        scan_state
            .as_ref()
            .map(|state| state.last_event_timestamp)
            .unwrap_or(0),
    )?;

    tokenomics_emit_scan_progress(
        app,
        emit_progress,
        json!({
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": provider_account.key.as_str(),
            "provider_account_label": provider_account.label.as_str(),
            "phase": if scan_mode.is_realtime() { "realtime_current_day" } else if initial_backfill_done { "catch_up" } else { "backfill_start" },
            "day_index": 0,
            "day_total": scan_day_total,
            "day_label": if scan_mode.is_realtime() { "today" } else if initial_backfill_done { "latest usage" } else { "preparing 30-day scan" },
            "files_scanned": 0,
            "inserted_events": 0,
            "mode": scan_mode.label(),
        }),
    );

    let candidates = {
        let codex_conn = rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|error| {
            format!(
                "Unable to open Codex Tokenomics database {}: {error}",
                db_path.display()
            )
        })?;
        let mut statement = codex_conn
            .prepare(
                "SELECT
                   id,
                   rollout_path,
                   source,
                   model_provider,
                   model,
                   cwd,
                   updated_at
                 FROM threads
                 WHERE COALESCE(rollout_path, '') != ''
                   AND (?1 = 0 OR updated_at >= ?1 OR updated_at >= ?2)
                 ORDER BY updated_at DESC",
            )
            .map_err(|error| format!("Unable to prepare Codex Tokenomics query: {error}"))?;
        let mut rows = statement
            .query(rusqlite::params![
                min_thread_updated_at as i64,
                (min_thread_updated_at as i64).saturating_mul(1000)
            ])
            .map_err(|error| format!("Unable to query Codex Tokenomics database: {error}"))?;
        let mut candidates = Vec::new();
        while let Some(row) = rows
            .next()
            .map_err(|error| format!("Unable to read Codex Tokenomics row: {error}"))?
        {
            let thread_id: String = row.get(0).unwrap_or_default();
            let rollout_path: String = row.get(1).unwrap_or_default();
            let path = PathBuf::from(&rollout_path);
            if thread_id.is_empty() || !path.exists() {
                continue;
            }
            let updated_at: i64 = row.get::<_, i64>(6).unwrap_or(0).max(0);
            candidates.push(TokenomicsCodexThreadCandidate {
                thread_id,
                rollout_path: path,
                source: row.get(2).unwrap_or_else(|_| "codex".to_string()),
                model_provider: row.get(3).unwrap_or_else(|_| "openai".to_string()),
                model: row.get(4).ok(),
                cwd: row.get(5).ok(),
                updated_at_unix: tokenomics_normalize_unix_timestamp(updated_at),
            });
        }
        candidates
    };

    let mut inserted_events = 0usize;
    let mut files_scanned = 0usize;
    let mut skipped_cached = 0usize;
    let mut newest_event_timestamp = scan_state
        .as_ref()
        .map(|state| state.last_event_timestamp)
        .unwrap_or(backfill_cutoff);

    for day_offset in 0..scan_day_total {
        let day_start_unix = tokenomics_scan_day_start_from_offset(now_unix, day_offset);
        let day_candidates = candidates
            .iter()
            .filter(|candidate| {
                tokenomics_scan_day_offset_from_now(candidate.updated_at_unix, now_unix)
                    == day_offset
            })
            .collect::<Vec<_>>();
        let day_candidate_count = day_candidates.len();
        let day_index = day_offset + 1;
        let day_label = tokenomics_scan_day_label_from_offset(day_offset);
        let required_coverage_start = if scan_mode.is_realtime() {
            realtime_day_start
        } else {
            backfill_cutoff
        };
        let day_complete = tokenomics_scan_day_is_complete(
            conn,
            "openai",
            "codex",
            &source_id,
            TOKENOMICS_CODEX_SCANNER_VERSION,
            day_start_unix,
        )?;
        let day_offsets_current = day_candidates.iter().try_fold(true, |current, candidate| {
            if !current {
                return Ok::<bool, String>(false);
            }
            let Some(offset) =
                tokenomics_get_source_offset(conn, "openai", "codex", &candidate.rollout_path)?
            else {
                return Ok(false);
            };
            Ok(tokenomics_source_offset_is_current_for_range(
                &offset,
                &candidate.rollout_path,
                TOKENOMICS_CODEX_SCANNER_VERSION,
                required_coverage_start,
            ))
        })?;
        if day_complete && day_offsets_current {
            tokenomics_emit_scan_progress(
                app,
                emit_progress,
                json!({
                    "provider": "openai",
                    "agent_kind": "codex",
                    "provider_account_key": provider_account.key.as_str(),
                    "provider_account_label": provider_account.label.as_str(),
                    "phase": "day_complete",
                    "day_index": day_index,
                    "day_total": scan_day_total,
                    "day_label": day_label,
                    "files_scanned": files_scanned,
                    "inserted_events": inserted_events,
                    "day_files_scanned": 0,
                    "day_inserted_events": 0,
                    "candidate_count": candidates.len(),
                    "day_candidate_count": day_candidate_count,
                    "cached": true,
                    "mode": scan_mode.label(),
                }),
            );
            continue;
        }
        tokenomics_emit_scan_progress(
            app,
            emit_progress,
            json!({
                "provider": "openai",
                "agent_kind": "codex",
                "provider_account_key": provider_account.key.as_str(),
                "provider_account_label": provider_account.label.as_str(),
                "phase": if scan_mode.is_realtime() { "realtime_current_day" } else if initial_backfill_done { "catch_up" } else { "day_start" },
                "day_index": day_index,
                "day_total": scan_day_total,
                "day_label": day_label.as_str(),
                "files_scanned": files_scanned,
                "inserted_events": inserted_events,
                "candidate_count": candidates.len(),
                "day_candidate_count": day_candidate_count,
                "mode": scan_mode.label(),
            }),
        );

        let day_files_before = files_scanned;
        let day_inserted_before = inserted_events;
        for candidate in day_candidates {
            let (_, size) = tokenomics_file_mtime_size(&candidate.rollout_path);
            let offset =
                tokenomics_get_source_offset(conn, "openai", "codex", &candidate.rollout_path)?;
            let offset_is_current = offset.as_ref().is_some_and(|offset| {
                tokenomics_source_offset_is_current_for_range(
                    offset,
                    &candidate.rollout_path,
                    TOKENOMICS_CODEX_SCANNER_VERSION,
                    required_coverage_start,
                )
            });
            if offset_is_current {
                skipped_cached += 1;
                if let Some(offset) = offset.as_ref() {
                    newest_event_timestamp = newest_event_timestamp.max(offset.last_event_timestamp);
                }
                continue;
            }
            let can_resume_from_offset = offset.as_ref().is_some_and(|offset| {
                offset.scanner_version == TOKENOMICS_CODEX_SCANNER_VERSION
                    && offset.coverage_start_unix <= required_coverage_start
                    && size >= offset.last_seen_size
            });
            let start_after_line = if can_resume_from_offset {
                offset
                    .as_ref()
                    .filter(|offset| {
                        offset.scanner_version == TOKENOMICS_CODEX_SCANNER_VERSION
                            && size >= offset.last_seen_size
                    })
                    .map(|offset| offset.last_line_index)
                    .unwrap_or(-1)
            } else {
                -1
            };
            files_scanned += 1;
            let file_scan = tokenomics_scan_codex_session_file(
                conn,
                &candidate.thread_id,
                &candidate.rollout_path,
                &candidate.source,
                &candidate.model_provider,
                candidate.model.as_deref(),
                &provider_account,
                candidate.cwd.as_deref(),
                candidate.updated_at_unix,
                start_after_line,
                required_coverage_start,
            )?;
            inserted_events += file_scan.inserted_events;
            newest_event_timestamp = newest_event_timestamp.max(
                file_scan
                    .last_event_timestamp
                    .max(candidate.updated_at_unix),
            );
            tokenomics_upsert_source_offset(
                conn,
                "openai",
                "codex",
                &candidate.rollout_path,
                TOKENOMICS_CODEX_SCANNER_VERSION,
                file_scan.last_line_index,
                file_scan
                    .last_event_timestamp
                    .max(candidate.updated_at_unix),
                required_coverage_start,
            )?;
        }

        let day_files_scanned = files_scanned.saturating_sub(day_files_before);
        let day_inserted_events = inserted_events.saturating_sub(day_inserted_before);
        tokenomics_upsert_scan_day(
            conn,
            "openai",
            "codex",
            &source_id,
            TOKENOMICS_CODEX_SCANNER_VERSION,
            day_start_unix,
            day_candidate_count,
            day_files_scanned,
            day_inserted_events,
        )?;
        let mut progress = json!({
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": provider_account.key.as_str(),
            "provider_account_label": provider_account.label.as_str(),
            "phase": "day_complete",
            "day_index": day_index,
            "day_total": scan_day_total,
            "day_label": day_label,
            "files_scanned": files_scanned,
            "inserted_events": inserted_events,
            "day_files_scanned": day_files_scanned,
            "day_inserted_events": day_inserted_events,
            "candidate_count": candidates.len(),
            "day_candidate_count": day_candidate_count,
            "mode": scan_mode.label(),
        });
        if day_files_scanned > 0 || day_inserted_events > 0 {
            if let Ok(summary) = tokenomics_summary_from_conn(conn, true, Some(inserted_events)) {
                progress["summary"] = summary;
            }
        }
        tokenomics_emit_scan_progress(app, emit_progress, progress);
    }

    let mut complete_progress = json!({
        "provider": "openai",
        "agent_kind": "codex",
        "provider_account_key": provider_account.key.as_str(),
        "provider_account_label": provider_account.label.as_str(),
        "phase": "complete",
        "day_index": scan_day_total,
        "day_total": scan_day_total,
        "day_label": "complete",
        "files_scanned": files_scanned,
        "inserted_events": inserted_events,
        "candidate_count": candidates.len(),
        "mode": scan_mode.label(),
    });
    if let Ok(summary) = tokenomics_summary_from_conn(conn, true, Some(inserted_events)) {
        complete_progress["summary"] = summary;
    }
    tokenomics_emit_scan_progress(app, emit_progress, complete_progress);

    tokenomics_upsert_scan_state(
        conn,
        "openai",
        "codex",
        &source_id,
        TOKENOMICS_CODEX_SCANNER_VERSION,
        if scan_mode.is_realtime() {
            initial_backfill_done
        } else {
            true
        },
        newest_event_timestamp.max(backfill_cutoff),
    )?;
    tokenomics_upsert_usage_region(
        conn,
        "openai",
        "codex",
        &source_id,
        scan_region_kind,
        min_thread_updated_at,
        now_unix,
        "complete",
        newest_event_timestamp.max(backfill_cutoff),
    )?;

    Ok(TokenomicsScanResult {
        files_scanned,
        inserted_events,
        status: if scan_mode.is_realtime() {
            "realtime"
        } else if !initial_backfill_done {
            "backfilled_30d"
        } else if files_scanned == 0 && skipped_cached > 0 {
            "cached"
        } else if inserted_events > 0 {
            "incremental"
        } else {
            "checked"
        },
    })
}

fn tokenomics_scan_codex_session_file(
    conn: &rusqlite::Connection,
    thread_id: &str,
    path: &Path,
    source: &str,
    model_provider: &str,
    model: Option<&str>,
    provider_account: &TokenomicsProviderAccount,
    cwd: Option<&str>,
    updated_at_unix: u64,
    start_after_line: i64,
    min_event_timestamp: u64,
) -> Result<TokenomicsFileScanResult, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("Unable to open Codex session {}: {error}", path.display()))?;
    let reader = std::io::BufReader::new(file);
    let provider = if model_provider.trim().is_empty() {
        "openai"
    } else {
        model_provider
    };
    let model = model.filter(|value| !value.trim().is_empty());
    let source_identity = tokenomics_existing_source_identity(conn, provider, "codex", path)?;
    let source_provider_account = source_identity
        .as_ref()
        .map(|identity| identity.provider_account.clone())
        .unwrap_or_else(|| provider_account.clone());
    let device_id = tokenomics_local_device_id();
    let billing_scope = source_identity
        .as_ref()
        .map(|identity| identity.billing_scope.clone())
        .unwrap_or_else(tokenomics_current_billing_scope);
    let mut inserted = 0usize;
    let mut last_line_index = start_after_line.max(-1);
    let mut newest_event_timestamp = updated_at_unix;
    for (line_index, line) in reader.lines().enumerate() {
        let line_index = line_index as i64;
        if line_index <= start_after_line {
            continue;
        }
        last_line_index = line_index;
        let line = line.map_err(|error| {
            format!(
                "Unable to read Codex session {} line {}: {error}",
                path.display(),
                line_index + 1
            )
        })?;
        if !line.contains("\"token_count\"") || !line.contains("\"last_token_usage\"") {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(payload) = value.get("payload") else {
            continue;
        };
        if payload.get("type").and_then(Value::as_str) != Some("token_count") {
            continue;
        }
        let Some(last_usage) = payload.get("info").and_then(|info| {
            info.get("last_token_usage")
                .or_else(|| info.get("lastTokenUsage"))
        }) else {
            continue;
        };
        let input_tokens =
            tokenomics_value_i64(last_usage, &["input_tokens", "inputTokens"]).unwrap_or(0);
        let cache_read_tokens = tokenomics_value_i64(
            last_usage,
            &[
                "cached_input_tokens",
                "cachedInputTokens",
                "cache_read_tokens",
                "cacheReadTokens",
            ],
        )
        .unwrap_or(0)
        .min(input_tokens)
        .max(0);
        let output_tokens =
            tokenomics_value_i64(last_usage, &["output_tokens", "outputTokens"]).unwrap_or(0);
        if input_tokens <= 0 && cache_read_tokens <= 0 && output_tokens <= 0 {
            continue;
        }
        let total_tokens = input_tokens.saturating_add(output_tokens);
        let timestamp = value
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| {
                if updated_at_unix > 0 {
                    format!("unix:{updated_at_unix}")
                } else {
                    tokenomics_now_iso_like()
                }
            });
        let timestamp_unix = tokenomics_timestamp_unix(&timestamp).unwrap_or(updated_at_unix);
        if min_event_timestamp > 0 && timestamp_unix > 0 && timestamp_unix < min_event_timestamp {
            continue;
        }
        newest_event_timestamp = newest_event_timestamp.max(timestamp_unix);
        let (bucket_day, bucket_hour) = tokenomics_buckets(&timestamp);
        let identity = format!(
            "codex-token-count:{thread_id}:{}:{}:{line_index}:{input_tokens}:{cache_read_tokens}:{output_tokens}",
            tokenomics_event_identity_account_key(
                provider,
                "codex",
                Some(source_provider_account.key.as_str())
            ),
            path.display()
        );
        let event = TokenomicsUsageEvent {
            id: tokenomics_hash(&identity),
            device_id: device_id.clone(),
            provider: provider.to_string(),
            agent_kind: "codex".to_string(),
            model: model.map(str::to_string),
            subscription_key: Some(source_provider_account.key.clone()),
            provider_account_key: Some(source_provider_account.key.clone()),
            provider_account_label: Some(source_provider_account.label.clone()),
            billing_scope_type: billing_scope.scope_type.clone(),
            billing_team_id: billing_scope.team_id.clone(),
            billing_scope_source: billing_scope.source.clone(),
            workspace_id: None,
            repo_path: cwd.map(str::to_string),
            source_kind: "codex_token_count_jsonl".to_string(),
            source_path: Some(format!("{}:{source}", path.display())),
            bucket_day,
            bucket_hour,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_write_tokens: 0,
            total_tokens,
            estimated_cost_microusd: tokenomics_codex_estimated_api_microusd(
                model,
                input_tokens,
                cache_read_tokens,
                output_tokens,
            ),
            created_at: Some(timestamp),
            observed_at: tokenomics_now_iso_like(),
        };
        tokenomics_upsert_provider_account(
            conn,
            &event.device_id,
            &event.provider,
            &event.agent_kind,
            event.provider_account_key.as_deref().unwrap_or_default(),
            event.provider_account_label.as_deref(),
            &billing_scope,
            "codex_state_db",
        )?;
        if tokenomics_insert_event(conn, &event)? {
            inserted += 1;
        }
    }
    Ok(TokenomicsFileScanResult {
        inserted_events: inserted,
        last_line_index,
        last_event_timestamp: newest_event_timestamp,
    })
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
        return tokenomics_codex_estimated_api_microusd(
            model,
            input_tokens,
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

fn tokenomics_collect_candidate_files_with_min_mtime(
    root: &Path,
    limit: usize,
    min_modified_unix: Option<u64>,
) -> Vec<PathBuf> {
    let mut files = Vec::<(u64, PathBuf)>::new();
    tokenomics_collect_candidate_files_inner(root, 0, limit, min_modified_unix, &mut files);
    files.sort_by(|left, right| right.0.cmp(&left.0));
    files
        .into_iter()
        .take(limit)
        .map(|(_, path)| path)
        .collect()
}

fn tokenomics_collect_candidate_files_inner(
    root: &Path,
    depth: usize,
    limit: usize,
    min_modified_unix: Option<u64>,
    files: &mut Vec<(u64, PathBuf)>,
) {
    if depth > 8 || files.len() > limit.saturating_mul(8) {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            tokenomics_collect_candidate_files_inner(
                &path,
                depth + 1,
                limit,
                min_modified_unix,
                files,
            );
            continue;
        }
        if !metadata.is_file() || metadata.len() > TOKENOMICS_SCAN_MAX_FILE_BYTES {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(extension.as_str(), "jsonl" | "json" | "ndjson") {
            continue;
        }
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        if min_modified_unix.is_some_and(|minimum| modified < minimum) {
            continue;
        }
        files.push((modified, path));
    }
}

fn tokenomics_scan_file(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    provider_account: &TokenomicsProviderAccount,
    path: &Path,
) -> Result<TokenomicsFileScanResult, String> {
    let content = fs::read_to_string(path).map_err(|error| {
        format!(
            "Unable to read Tokenomics source file {}: {error}",
            path.display()
        )
    })?;
    let mut inserted = 0usize;
    let mut last_line_index = -1i64;
    let mut newest_event_timestamp = 0u64;
    let is_jsonl = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("jsonl") || value.eq_ignore_ascii_case("ndjson"))
        .unwrap_or(false);
    if is_jsonl {
        for (line_index, line) in content.lines().enumerate() {
            last_line_index = line_index as i64;
            if line.trim().is_empty() || line.len() > TOKENOMICS_SCAN_MAX_LINE_BYTES {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                inserted += tokenomics_record_usage_json_tree(
                    conn,
                    provider,
                    agent_kind,
                    provider_account,
                    Some(path),
                    Some(line_index),
                    &value,
                )?;
                newest_event_timestamp = newest_event_timestamp.max(tokenomics_unix_now());
            }
        }
    } else if let Ok(value) = serde_json::from_str::<Value>(&content) {
        inserted += tokenomics_record_usage_json_tree(
            conn,
            provider,
            agent_kind,
            provider_account,
            Some(path),
            None,
            &value,
        )?;
        newest_event_timestamp = newest_event_timestamp.max(tokenomics_unix_now());
    }
    Ok(TokenomicsFileScanResult {
        inserted_events: inserted,
        last_line_index,
        last_event_timestamp: newest_event_timestamp,
    })
}

fn tokenomics_record_usage_json_tree(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    provider_account: &TokenomicsProviderAccount,
    path: Option<&Path>,
    line_index: Option<usize>,
    value: &Value,
) -> Result<usize, String> {
    let mut extracted = Vec::new();
    tokenomics_extract_usage_events(
        value,
        provider,
        agent_kind,
        provider_account,
        tokenomics_current_billing_scope(),
        None,
        None,
        Some(tokenomics_local_device_id()),
        &mut extracted,
    );
    let mut inserted = 0usize;
    for mut event in extracted {
        if event.total_tokens == 0 {
            continue;
        }
        event.source_path = path.map(|path| path.display().to_string());
        event.source_kind = path
            .and_then(|path| path.extension().and_then(|value| value.to_str()))
            .unwrap_or("manual")
            .to_string();
        let raw_identity = json!({
            "provider": event.provider,
            "agent_kind": event.agent_kind,
            "model": event.model,
            "created_at": event.created_at,
            "input_tokens": event.input_tokens,
            "output_tokens": event.output_tokens,
            "cache_read_tokens": event.cache_read_tokens,
            "cache_write_tokens": event.cache_write_tokens,
            "provider_account_key": tokenomics_event_identity_account_key(
                event.provider.as_str(),
                event.agent_kind.as_str(),
                event.provider_account_key.as_deref(),
            ),
            "source_path": event.source_path,
            "line_index": line_index,
        });
        event.id = tokenomics_hash(&raw_identity.to_string());
        let billing_scope = TokenomicsBillingScope {
            scope_type: event.billing_scope_type.clone(),
            team_id: event.billing_team_id.clone(),
            source: event.billing_scope_source.clone(),
        };
        tokenomics_upsert_provider_account(
            conn,
            &event.device_id,
            &event.provider,
            &event.agent_kind,
            event.provider_account_key.as_deref().unwrap_or_default(),
            event.provider_account_label.as_deref(),
            &billing_scope,
            "usage_event",
        )?;
        if tokenomics_insert_event(conn, &event)? {
            inserted += 1;
        }
    }
    Ok(inserted)
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

fn tokenomics_extract_usage_events(
    value: &Value,
    provider: &str,
    agent_kind: &str,
    provider_account: &TokenomicsProviderAccount,
    inherited_billing_scope: TokenomicsBillingScope,
    inherited_model: Option<String>,
    inherited_timestamp: Option<String>,
    inherited_device_id: Option<String>,
    output: &mut Vec<TokenomicsUsageEvent>,
) {
    let mut model = inherited_model;
    let mut timestamp = inherited_timestamp;
    let device_id = inherited_device_id;
    let mut billing_scope = inherited_billing_scope;
    if let Some(object) = value.as_object() {
        if let Some(next_model) = object
            .get("model")
            .or_else(|| object.get("model_id"))
            .or_else(|| object.get("modelId"))
            .and_then(Value::as_str)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            model = Some(next_model);
        }
        if let Some(next_timestamp) = object
            .get("timestamp")
            .or_else(|| object.get("created_at"))
            .or_else(|| object.get("createdAt"))
            .or_else(|| object.get("time"))
            .and_then(Value::as_str)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            timestamp = Some(next_timestamp);
        }
        billing_scope = tokenomics_billing_scope_from_value(value, &billing_scope);
        if let Some(usage_value) = object
            .get("usage")
            .or_else(|| object.get("token_usage"))
            .or_else(|| object.get("tokenUsage"))
            .or_else(|| object.get("tokens"))
            .or_else(|| tokenomics_object_looks_like_usage(object).then_some(value))
        {
            if let Some(event) = tokenomics_usage_event_from_value(
                usage_value,
                provider,
                agent_kind,
                provider_account,
                tokenomics_billing_scope_from_value(usage_value, &billing_scope),
                model.clone(),
                timestamp.clone(),
                device_id.clone().unwrap_or_else(tokenomics_local_device_id),
            ) {
                output.push(event);
            }
        }
        for child in object.values() {
            tokenomics_extract_usage_events(
                child,
                provider,
                agent_kind,
                provider_account,
                billing_scope.clone(),
                model.clone(),
                timestamp.clone(),
                device_id.clone(),
                output,
            );
        }
    } else if let Some(array) = value.as_array() {
        for child in array {
            tokenomics_extract_usage_events(
                child,
                provider,
                agent_kind,
                provider_account,
                billing_scope.clone(),
                model.clone(),
                timestamp.clone(),
                device_id.clone(),
                output,
            );
        }
    }
}

fn tokenomics_object_looks_like_usage(object: &serde_json::Map<String, Value>) -> bool {
    [
        "input_tokens",
        "inputTokens",
        "prompt_tokens",
        "promptTokens",
        "output_tokens",
        "outputTokens",
        "completion_tokens",
        "completionTokens",
    ]
    .iter()
    .any(|key| object.get(*key).and_then(Value::as_i64).unwrap_or(0) > 0)
}

fn tokenomics_usage_event_from_value(
    value: &Value,
    provider: &str,
    agent_kind: &str,
    provider_account: &TokenomicsProviderAccount,
    billing_scope: TokenomicsBillingScope,
    model: Option<String>,
    timestamp: Option<String>,
    device_id: String,
) -> Option<TokenomicsUsageEvent> {
    let input_tokens = tokenomics_usage_number(
        value,
        &[
            "input_tokens",
            "inputTokens",
            "prompt_tokens",
            "promptTokens",
            "input",
            "prompt",
        ],
    );
    let output_tokens = tokenomics_usage_number(
        value,
        &[
            "output_tokens",
            "outputTokens",
            "completion_tokens",
            "completionTokens",
            "output",
            "completion",
        ],
    );
    let cache_read_tokens = tokenomics_usage_number(
        value,
        &[
            "cache_read_tokens",
            "cacheReadTokens",
            "cache_read_input_tokens",
            "cacheReadInputTokens",
            "cached_tokens",
            "cachedTokens",
        ],
    );
    let cache_write_tokens = tokenomics_usage_number(
        value,
        &[
            "cache_write_tokens",
            "cacheWriteTokens",
            "cache_creation_input_tokens",
            "cacheCreationInputTokens",
        ],
    );
    let total_tokens = tokenomics_usage_number(value, &["total_tokens", "totalTokens", "total"])
        .max(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens);
    if total_tokens <= 0 {
        return None;
    }
    let observed_at = tokenomics_now_iso_like();
    let created_at = timestamp
        .filter(|value| !value.is_empty())
        .or_else(|| Some(observed_at.clone()));
    let (bucket_day, bucket_hour) =
        tokenomics_buckets(created_at.as_deref().unwrap_or(&observed_at));
    let estimated_cost_microusd = tokenomics_estimated_api_microusd(
        provider,
        agent_kind,
        model.as_deref(),
        input_tokens,
        cache_read_tokens,
        cache_write_tokens,
        output_tokens,
    );
    Some(TokenomicsUsageEvent {
        id: String::new(),
        device_id,
        provider: provider.to_string(),
        agent_kind: agent_kind.to_string(),
        model,
        subscription_key: Some(provider_account.key.clone()),
        provider_account_key: Some(provider_account.key.clone()),
        provider_account_label: Some(provider_account.label.clone()),
        billing_scope_type: billing_scope.scope_type,
        billing_team_id: billing_scope.team_id,
        billing_scope_source: billing_scope.source,
        workspace_id: None,
        repo_path: None,
        source_kind: "json".to_string(),
        source_path: None,
        bucket_day,
        bucket_hour,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        total_tokens,
        estimated_cost_microusd,
        created_at,
        observed_at,
    })
}

fn tokenomics_usage_number(value: &Value, keys: &[&str]) -> i64 {
    for key in keys {
        if let Some(number) = value.get(*key).and_then(Value::as_i64) {
            return number.max(0);
        }
        if let Some(number) = value.get(*key).and_then(Value::as_u64) {
            return number.min(i64::MAX as u64) as i64;
        }
        if let Some(number) = value.get(*key).and_then(Value::as_f64) {
            if number.is_finite() && number > 0.0 {
                return number.round().min(i64::MAX as f64) as i64;
            }
        }
    }
    0
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

fn tokenomics_insert_event(
    conn: &rusqlite::Connection,
    event: &TokenomicsUsageEvent,
) -> Result<bool, String> {
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
        .map_err(|error| format!("Unable to insert Tokenomics usage event: {error}"))?;
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
) -> Result<(), String> {
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
    )
    .map_err(|error| format!("Unable to update Tokenomics rollup: {error}"))?;
    Ok(())
}

fn tokenomics_rebuild_provider_rollups_from_events(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
) -> Result<(), String> {
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
             FROM tokenomics_usage_events
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
		           MAX(repo_path) AS repo_path, {bucket_column} AS bucket_start,
		           COALESCE(SUM(input_tokens), 0) AS input_tokens,
	           COALESCE(SUM(output_tokens), 0) AS output_tokens,
	           COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
           COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
           COALESCE(SUM(total_tokens), 0) AS total_tokens,
           COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd,
           COUNT(*) AS event_count
		         FROM tokenomics_usage_events
		         WHERE provider=?1 AND agent_kind=?2
		         GROUP BY device_id, provider, agent_kind,
		                  NULLIF(model, ''), NULLIF(subscription_key, ''), NULLIF(provider_account_key, ''),
		                  COALESCE(NULLIF(billing_scope_type, ''), 'unknown'),
		                  NULLIF(billing_team_id, ''), NULLIF(workspace_id, ''), {bucket_column}"
    );
    let mut statement = conn
        .prepare(&query)
        .map_err(|error| format!("Unable to prepare Tokenomics rollup rebuild: {error}"))?;
    let rows = statement
        .query_map(rusqlite::params![provider, agent_kind], |row| {
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
        })
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

fn tokenomics_record_usage_value(
    conn: &rusqlite::Connection,
    usage: &Value,
    source_kind: &str,
) -> Result<usize, String> {
    let provider = usage
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .trim()
        .to_ascii_lowercase();
    let agent_kind = usage
        .get("agent_kind")
        .or_else(|| usage.get("agentKind"))
        .and_then(Value::as_str)
        .unwrap_or(provider.as_str())
        .trim()
        .to_ascii_lowercase();
    let fallback_account = tokenomics_provider_account(&provider, &agent_kind);
    let explicit_account_key = usage
        .get("provider_account_key")
        .or_else(|| usage.get("providerAccountKey"))
        .or_else(|| usage.get("subscription_key"))
        .or_else(|| usage.get("subscriptionKey"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let explicit_account_label = usage
        .get("provider_account_label")
        .or_else(|| usage.get("providerAccountLabel"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let provider_account = TokenomicsProviderAccount {
        key: explicit_account_key.unwrap_or_else(|| fallback_account.key.clone()),
        label: explicit_account_label.unwrap_or_else(|| fallback_account.label.clone()),
    };
    let usage_billing_scope =
        tokenomics_billing_scope_from_value(usage, &tokenomics_current_billing_scope());
    tokenomics_upsert_provider_account(
        conn,
        tokenomics_local_device_id().as_str(),
        &provider,
        &agent_kind,
        &provider_account.key,
        Some(&provider_account.label),
        &usage_billing_scope,
        source_kind,
    )?;
    let Some(mut event) = tokenomics_usage_event_from_value(
        usage,
        &provider,
        &agent_kind,
        &provider_account,
        usage_billing_scope,
        usage
            .get("model")
            .and_then(Value::as_str)
            .map(|value| value.to_string()),
        usage
            .get("created_at")
            .or_else(|| usage.get("createdAt"))
            .and_then(Value::as_str)
            .map(|value| value.to_string()),
        tokenomics_local_device_id(),
    ) else {
        return Ok(0);
    };
    event.source_kind = source_kind.to_string();
    event.subscription_key = usage
        .get("subscription_key")
        .or_else(|| usage.get("subscriptionKey"))
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .or_else(|| event.provider_account_key.clone())
        .or(event.subscription_key);
    event.provider_account_key = Some(provider_account.key);
    event.provider_account_label = Some(provider_account.label);
    event.workspace_id = usage
        .get("workspace_id")
        .or_else(|| usage.get("workspaceId"))
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    event.repo_path = usage
        .get("repo_path")
        .or_else(|| usage.get("repoPath"))
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    event.id = tokenomics_hash(&usage.to_string());
    tokenomics_insert_event(conn, &event).map(|inserted| usize::from(inserted))
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

fn tokenomics_sync_summary_for_scope(
    app: &AppHandle,
    scope_filter: &TokenomicsBillingScope,
) -> Result<Value, String> {
    let conn = tokenomics_open_db(app)?;
    tokenomics_reconcile_current_provider_accounts(&conn)?;
    let mut summary = tokenomics_summary_from_conn_with_cloud_for_scope(
        &conn,
        true,
        None,
        false,
        Some(scope_filter),
    )?;
    let aliases = tokenomics_local_device_aliases(&conn)?;
    if !aliases.is_empty() {
        if let Some(object) = summary.as_object_mut() {
            let aliases = json!(aliases);
            object.insert("device_aliases".to_string(), aliases.clone());
            object.insert("deviceAliases".to_string(), aliases);
        }
    }
    Ok(summary)
}

fn tokenomics_reconcile_codex_provider_before_scan(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let non_state_event_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tokenomics_usage_events WHERE provider='openai' AND agent_kind='codex' AND source_kind!='codex_token_count_jsonl'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if non_state_event_count > 0 {
        tokenomics_delete_provider_rows(conn, "openai", "codex")?;
        tokenomics_delete_provider_scan_cache(conn, "openai", "codex")?;
    }
    Ok(())
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
    )
}

fn tokenomics_summary_from_conn_with_cloud_for_scope(
    conn: &rusqlite::Connection,
    include_rollups: bool,
    inserted_events: Option<usize>,
    include_cloud: bool,
    scope_filter: Option<&TokenomicsBillingScope>,
) -> Result<Value, String> {
    tokenomics_reconcile_duplicate_provider_account_identities(conn)?;
    tokenomics_refresh_provider_accounts_from_usage(conn)?;
    let scope_filter_sql = tokenomics_billing_scope_filter_sql(scope_filter, true);
    let total = tokenomics_query_one(
        conn,
        &format!(
            "SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM tokenomics_rollups WHERE bucket_width='hour' {scope_filter_sql}"
        ),
    )?;
    let mut local_limits = tokenomics_provider_limits(conn, false, false)?;
    tokenomics_apply_provider_limit_sample_pacing(conn, &mut local_limits)?;
    tokenomics_record_latest_windows(conn, &local_limits)?;
    tokenomics_refresh_provider_accounts_from_usage(conn)?;
    let retired_account_keys = tokenomics_retired_provider_account_keys();
    let mut limits = if include_cloud {
        tokenomics_merge_provider_limits(tokenomics_cloud_provider_limits(conn)?, local_limits)
    } else {
        local_limits
    };
    if include_cloud {
        tokenomics_apply_provider_limit_sample_pacing(conn, &mut limits)?;
    }
    tokenomics_retain_active_account_rows(&mut limits, &retired_account_keys);
    let mut provider_accounts = tokenomics_provider_account_rows(conn, None, scope_filter)?;
    tokenomics_retain_active_account_rows(&mut provider_accounts, &retired_account_keys);
    let mut latest_windows = tokenomics_latest_window_rows(conn, None, scope_filter)?;
    tokenomics_retain_active_account_rows(&mut latest_windows, &retired_account_keys);
    let hourly = if include_rollups {
        tokenomics_account_hourly_display_rollups(conn, None, scope_filter, include_cloud)?
    } else {
        tokenomics_account_hourly_display_rollups(conn, None, scope_filter, include_cloud)?
    };
    let daily_by_device_provider =
        tokenomics_account_daily_display_rollups(conn, None, scope_filter, include_cloud)?;
    let mut limit_samples = tokenomics_provider_limit_sample_rows(conn, None, scope_filter, include_cloud)?;
    tokenomics_retain_active_account_rows(&mut limit_samples, &retired_account_keys);
    let device_identities = tokenomics_summary_device_identities(conn, include_cloud)?;
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
        "dailyByDeviceProviderCount": daily_by_device_provider.len(),
        "provider_account_count": provider_accounts.len(),
        "providerAccountCount": provider_accounts.len(),
        "latest_window_count": latest_windows.len(),
        "latestWindowCount": latest_windows.len(),
        "limit_sample_count": limit_samples.len(),
        "limitSampleCount": limit_samples.len(),
        "hourly": hourly,
        "daily_by_device_provider": daily_by_device_provider.clone(),
        "dailyByDeviceProvider": daily_by_device_provider,
        "provider_accounts": provider_accounts.clone(),
        "providerAccounts": provider_accounts,
        "latest_windows": latest_windows.clone(),
        "latestWindows": latest_windows,
        "limit_samples": limit_samples.clone(),
        "limitSamples": limit_samples,
        "sources": [
            {"provider": "anthropic", "agent_kind": "claude", "label": "Claude Code"},
            {"provider": "openai", "agent_kind": "codex", "label": "Codex"},
            {"provider": "opencode", "agent_kind": "opencode", "label": "OpenCode"}
        ],
        "limits": limits,
        "retired_account_keys": retired_account_keys.clone(),
        "retiredAccountKeys": retired_account_keys,
        "device_identities": device_identities.clone(),
        "deviceIdentities": device_identities,
        }))
}

fn tokenomics_sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
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

fn tokenomics_cloud_relay_sample_filter_sql(
    conn: &rusqlite::Connection,
) -> Result<String, String> {
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
            id,
            clean_device_id,
            provider,
            agent_kind,
            provider_account_key,
            provider_account_label,
            billing_scope.scope_type.as_str(),
            billing_scope.team_id.as_deref(),
            billing_scope.source.as_str(),
            attribution_source,
            now,
            now_unix as i64,
        ],
    )
    .map_err(|error| format!("Unable to upsert Tokenomics provider account: {error}"))?;
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
    let agent_kind = tokenomics_value_string(value, &["agent_kind", "agentKind"])
        .unwrap_or_else(|| provider.clone());
    if provider == "unknown" || agent_kind == "unknown" {
        return Ok(false);
    }
    let fallback_account = tokenomics_provider_account(&provider, &agent_kind);
    let provider_account_key = tokenomics_value_string(
        value,
        &[
            "provider_account_key",
            "providerAccountKey",
            "subscription_key",
            "subscriptionKey",
        ],
    )
    .unwrap_or_else(|| fallback_account.key.clone());
    let provider_account_label =
        tokenomics_value_string(value, &["provider_account_label", "providerAccountLabel"])
            .unwrap_or_else(|| fallback_account.label.clone());
    let billing_scope = tokenomics_billing_scope_from_value(value, fallback_scope);
    let provider_window_kind = tokenomics_value_string(
        value,
        &["window_kind", "windowKind", "limit_kind", "limitKind"],
    )
    .unwrap_or_else(|| "5_hour".to_string());
    let window_kind = tokenomics_sync_window_kind(&provider_window_kind);
    if !matches!(window_kind.as_str(), "session_5h" | "weekly") {
        return Ok(false);
    }
    let now_unix = tokenomics_unix_now();
    let sample_at = tokenomics_value_string(
        value,
        &[
            "sample_at",
            "sampleAt",
            "updated_at",
            "updatedAt",
            "last_known_at",
            "lastKnownAt",
        ],
    )
    .unwrap_or_else(|| tokenomics_unix_iso_like(now_unix));
    let sample_at_unix = tokenomics_value_i64(value, &["sample_at_unix", "sampleAtUnix"])
        .map(tokenomics_normalize_unix_timestamp)
        .or_else(|| tokenomics_timestamp_unix(&sample_at))
        .unwrap_or(now_unix);
    let (used_percent, remaining_percent) = tokenomics_limit_percent_pair(value)
        .map(|(used, remaining)| (Some(used), Some(remaining)))
        .unwrap_or((None, None));
    let reset_at = tokenomics_provider_limit_sample_reset_at(value, sample_at_unix);
    let reset_after_seconds =
        tokenomics_value_i64(value, &["reset_after_seconds", "resetAfterSeconds"]);
    let limit_window_seconds = tokenomics_limit_effective_window_seconds(
        &provider_window_kind,
        tokenomics_value_i64(value, &["limit_window_seconds", "limitWindowSeconds"]),
    );
    let pace_status =
        tokenomics_value_string(value, &["pace_status", "paceStatus"]).unwrap_or_default();
    let pace_delta_percent =
        tokenomics_value_i64(value, &["pace_delta_percent", "paceDeltaPercent"]);
    let source = source_override
        .map(ToOwned::to_owned)
        .or_else(|| tokenomics_value_string(value, &["source", "limit_source", "limitSource"]))
        .unwrap_or_else(|| "local".to_string());
    let confidence =
        tokenomics_value_string(value, &["confidence"]).unwrap_or_else(|| "unknown".to_string());
    let device_id =
        tokenomics_value_string(value, &["device_id", "deviceId", "machine_id", "machineId"])
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
    Ok(true)
}

fn tokenomics_record_latest_windows(
    conn: &rusqlite::Connection,
    limits: &[Value],
) -> Result<usize, String> {
    let fallback_scope = tokenomics_current_billing_scope();
    let device_id = tokenomics_local_device_id();
    let mut count = 0usize;
    for limit in limits.iter().take(128) {
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
) -> Result<Vec<Value>, String> {
    let clean_since = since_updated_at
        .map(str::trim)
        .filter(|value| !value.is_empty());
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
                   AND bucket_start GLOB '????-??-??'
                   AND bucket_start >= date('now', '-29 days')
                   {scope_filter_sql}
                   AND (?1 IS NULL OR updated_at >= ?1)
                 GROUP BY device_id, provider, agent_kind, {model_sql}, subscription_key, provider_account_key, billing_scope_key, bucket_start
                 ORDER BY bucket_start DESC, updated_at DESC, provider, agent_kind
                 LIMIT ?2"),
        )
        .map_err(|error| format!("Unable to prepare Tokenomics account daily query: {error}"))?;
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
            object.insert(
                "bucketStartUnix".to_string(),
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
    let clean_since = since_updated_at
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
		               AND bucket_start GLOB '????-??-??T??:00:00Z'
		               AND bucket_start >= strftime('%Y-%m-%dT00:00:00Z', 'now', '-29 days')
		               {scope_filter_sql}
		               AND (?1 IS NULL OR updated_at >= ?1)
	             GROUP BY device_id, provider, agent_kind, {model_sql}, subscription_key, provider_account_key, billing_scope_key, bucket_start
	             ORDER BY updated_at DESC, bucket_start DESC, provider, agent_kind
	             LIMIT ?2"),
        )
        .map_err(|error| format!("Unable to prepare Tokenomics account sync query: {error}"))?;
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
            object.insert(
                "bucketStartUnix".to_string(),
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
    let used = tokenomics_value_i64(
        value,
        &[
            "used_percent",
            "usedPercent",
            "limit_used_percent",
            "limitUsedPercent",
            "used",
        ],
    )
    .map(|percent| percent.clamp(0, 100));
    let remaining = tokenomics_value_i64(
        value,
        &[
            "remaining_percent",
            "remainingPercent",
            "limit_remaining_percent",
            "limitRemainingPercent",
            "remaining",
        ],
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
    if let Some(reset_at) = tokenomics_value_string(
        value,
        &[
            "reset_at",
            "resetAt",
            "limit_resets_at",
            "limitResetsAt",
            "pace_reset_at",
            "paceResetAt",
        ],
    )
    .filter(|text| !text.trim().is_empty())
    {
        return Some(reset_at);
    }
    tokenomics_value_i64(value, &["reset_after_seconds", "resetAfterSeconds"])
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
    let agent_kind = tokenomics_value_string(value, &["agent_kind", "agentKind"])
        .unwrap_or_else(|| provider.clone());
    if provider == "unknown" || agent_kind == "unknown" {
        return Ok(false);
    }
    let fallback_account = tokenomics_provider_account(&provider, &agent_kind);
    let provider_account_key = tokenomics_value_string(
        value,
        &[
            "provider_account_key",
            "providerAccountKey",
            "subscription_key",
            "subscriptionKey",
        ],
    )
    .unwrap_or_else(|| fallback_account.key.clone());
    let provider_account_label =
        tokenomics_value_string(value, &["provider_account_label", "providerAccountLabel"])
            .unwrap_or_else(|| fallback_account.label.clone());
    let billing_scope = tokenomics_billing_scope_from_value(value, fallback_scope);
    let window_kind = tokenomics_value_string(
        value,
        &["window_kind", "windowKind", "limit_kind", "limitKind"],
    )
    .unwrap_or_else(|| "5_hour".to_string());
    let now_unix = tokenomics_unix_now();
    let sample_at = tokenomics_value_string(
        value,
        &[
            "sample_at",
            "sampleAt",
            "updated_at",
            "updatedAt",
            "last_known_at",
            "lastKnownAt",
        ],
    )
    .unwrap_or_else(|| tokenomics_unix_iso_like(now_unix));
    let sample_at_unix = tokenomics_value_i64(value, &["sample_at_unix", "sampleAtUnix"])
        .map(tokenomics_normalize_unix_timestamp)
        .or_else(|| tokenomics_timestamp_unix(&sample_at))
        .unwrap_or(now_unix);
    let sample_bucket_unix = tokenomics_value_i64(
        value,
        &[
            "sample_bucket_unix",
            "sampleBucketUnix",
            "bucket_unix",
            "bucketUnix",
        ],
    )
    .map(tokenomics_normalize_unix_timestamp)
    .unwrap_or_else(|| tokenomics_provider_limit_sample_bucket_unix(sample_at_unix));
    let sample_bucket_start = tokenomics_value_string(
        value,
        &[
            "sample_bucket_start",
            "sampleBucketStart",
            "bucket_start",
            "bucketStart",
        ],
    )
    .unwrap_or_else(|| tokenomics_unix_iso_like(sample_bucket_unix));
    let updated_at_unix = now_unix;
    let updated_at = tokenomics_unix_iso_like(updated_at_unix);
    let reset_at = tokenomics_provider_limit_sample_reset_at(value, sample_at_unix);
    let reset_after_seconds =
        tokenomics_value_i64(value, &["reset_after_seconds", "resetAfterSeconds"]);
    let limit_window_seconds = tokenomics_limit_effective_window_seconds(
        &window_kind,
        tokenomics_value_i64(value, &["limit_window_seconds", "limitWindowSeconds"]),
    );
    let pace_status =
        tokenomics_value_string(value, &["pace_status", "paceStatus"]).unwrap_or_default();
    let pace_delta_percent =
        tokenomics_value_i64(value, &["pace_delta_percent", "paceDeltaPercent"]);
    let source = source_override
        .map(ToOwned::to_owned)
        .or_else(|| tokenomics_value_string(value, &["source", "limit_source", "limitSource"]))
        .unwrap_or_else(|| "local".to_string());
    let confidence =
        tokenomics_value_string(value, &["confidence"]).unwrap_or_else(|| "unknown".to_string());
    let device_id =
        tokenomics_value_string(value, &["device_id", "deviceId", "machine_id", "machineId"])
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
    Ok(true)
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
        if tokenomics_provider_limit_is_unknown(limit) {
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

fn tokenomics_provider_limit_sample_rows(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
    scope_filter: Option<&TokenomicsBillingScope>,
    include_cloud: bool,
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
               {scope_filter_sql}
               {cloud_filter_sql}
             ORDER BY updated_at DESC, sample_bucket_unix DESC
             LIMIT ?2"
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
    let agent_kind = tokenomics_value_string(limit, &["agent_kind", "agentKind"])
        .unwrap_or_else(|| provider.clone());
    let fallback_account = tokenomics_provider_account(&provider, &agent_kind);
    let provider_account_key = tokenomics_value_string(
        limit,
        &[
            "provider_account_key",
            "providerAccountKey",
            "subscription_key",
            "subscriptionKey",
        ],
    )
    .unwrap_or_else(|| fallback_account.key);
    let window_kind = tokenomics_value_string(
        limit,
        &["window_kind", "windowKind", "limit_kind", "limitKind"],
    )
    .unwrap_or_else(|| "5_hour".to_string());
    let device_id =
        tokenomics_value_string(limit, &["device_id", "deviceId", "machine_id", "machineId"])
            .unwrap_or_default();
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
    let latest_sample_at_unix = tokenomics_value_i64(latest, &["sample_at_unix", "sampleAtUnix"])
        .map(tokenomics_normalize_unix_timestamp)
        .or_else(|| {
            tokenomics_value_string(latest, &["sample_at", "sampleAt"])
                .and_then(|value| tokenomics_timestamp_unix(&value))
        })
        .unwrap_or_else(tokenomics_unix_now);
    let window_kind = tokenomics_value_string(
        limit,
        &["window_kind", "windowKind", "limit_kind", "limitKind"],
    )
    .unwrap_or_else(|| "5_hour".to_string());
    let window_seconds = tokenomics_limit_effective_window_seconds(
        &window_kind,
        tokenomics_value_i64(latest, &["limit_window_seconds", "limitWindowSeconds"]).or_else(
            || tokenomics_value_i64(limit, &["limit_window_seconds", "limitWindowSeconds"]),
        ),
    )
    .max(1) as u64;
    let reset_at_text = tokenomics_value_string(latest, &["reset_at", "resetAt"])
        .or_else(|| tokenomics_provider_limit_sample_reset_at(latest, latest_sample_at_unix))
        .or_else(|| {
            tokenomics_value_string(limit, &["reset_at", "resetAt"])
                .or_else(|| tokenomics_provider_limit_sample_reset_at(limit, latest_sample_at_unix))
        });
    let reset_at_unix = reset_at_text
        .as_deref()
        .and_then(tokenomics_timestamp_unix)
        .or_else(|| {
            tokenomics_value_i64(latest, &["reset_after_seconds", "resetAfterSeconds"])
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
            tokenomics_value_i64(latest, &["reset_after_seconds", "resetAfterSeconds"])
                .filter(|seconds| *seconds >= 0)
                .map(|seconds| (seconds as u64).min(window_seconds))
        });
    let now_unix = tokenomics_unix_now();
    let live_updated_at_unix = tokenomics_value_string(
        limit,
        &["updated_at", "updatedAt", "last_known_at", "lastKnownAt"],
    )
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
                tokenomics_value_string(sample, &["reset_at", "resetAt"])
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
                let sample_at = tokenomics_value_i64(sample, &["sample_at_unix", "sampleAtUnix"])
                    .map(tokenomics_normalize_unix_timestamp)
                    .or_else(|| {
                        tokenomics_value_string(sample, &["sample_at", "sampleAt"])
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
                    tokenomics_value_i64(sample, &["sample_at_unix", "sampleAtUnix"])
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
        object.insert("usedPercent".to_string(), json!(latest_used));
        object.insert("limit_used_percent".to_string(), json!(latest_used));
        object.insert("limitUsedPercent".to_string(), json!(latest_used));
        object.insert("remaining_percent".to_string(), json!(latest_remaining));
        object.insert("remainingPercent".to_string(), json!(latest_remaining));
        object.insert("last_known_at".to_string(), latest["sample_at"].clone());
        object.insert("lastKnownAt".to_string(), latest["sample_at"].clone());
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
            object.insert("resetAt".to_string(), json!(reset_at));
        }
        if let Some(remaining_seconds) = remaining_seconds_at_sample {
            object.insert(
                "reset_after_seconds".to_string(),
                json!(remaining_seconds as i64),
            );
            object.insert(
                "resetAfterSeconds".to_string(),
                json!(remaining_seconds as i64),
            );
        }
        object.insert(
            "limit_window_seconds".to_string(),
            json!(window_seconds.min(i64::MAX as u64) as i64),
        );
        object.insert(
            "limitWindowSeconds".to_string(),
            json!(window_seconds.min(i64::MAX as u64) as i64),
        );
    }

    object.insert("pace_strategy".to_string(), json!("live_10s_with_samples"));
    object.insert("paceStrategy".to_string(), json!("live_10s_with_samples"));
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
        "paceConfidence".to_string(),
        object
            .get("pace_confidence")
            .cloned()
            .unwrap_or_else(|| json!("unknown")),
    );
    object.insert(
        "pace_sample_count".to_string(),
        json!(trajectory_sample_count),
    );
    object.insert(
        "paceSampleCount".to_string(),
        json!(trajectory_sample_count),
    );
    object.insert(
        "pace_sample_window_seconds".to_string(),
        json!(sample_window_seconds),
    );
    object.insert(
        "paceSampleWindowSeconds".to_string(),
        json!(sample_window_seconds),
    );
    object.insert(
        "pace_last_sample_at".to_string(),
        latest["sample_at"].clone(),
    );
    object.insert("paceLastSampleAt".to_string(), latest["sample_at"].clone());
    object.insert(
        "pace_last_sample_used_percent".to_string(),
        json!(latest_used),
    );
    object.insert("paceLastSampleUsedPercent".to_string(), json!(latest_used));
    if let Some(projected) = projected_used_percent {
        let delta = pace_delta_percent.unwrap_or(projected - 100);
        object.insert("pace_trajectory_status".to_string(), json!(status.clone()));
        object.insert("paceTrajectoryStatus".to_string(), json!(status.clone()));
        object.insert("pace_trajectory_delta_percent".to_string(), json!(delta));
        object.insert("paceTrajectoryDeltaPercent".to_string(), json!(delta));
        object.insert(
            "pace_trajectory_projected_used_percent".to_string(),
            json!(projected),
        );
        object.insert(
            "paceTrajectoryProjectedUsedPercent".to_string(),
            json!(projected),
        );
        object.insert(
            "pace_trajectory_projected_exhaustion_seconds".to_string(),
            json!(projected_exhaustion_seconds),
        );
        object.insert(
            "paceTrajectoryProjectedExhaustionSeconds".to_string(),
            json!(projected_exhaustion_seconds),
        );
        object.insert(
            "pace_trajectory_projected_exhaustion_at".to_string(),
            json!(projected_exhaustion_at),
        );
        object.insert(
            "paceTrajectoryProjectedExhaustionAt".to_string(),
            json!(projected_exhaustion_at),
        );
        let current_projected = tokenomics_value_i64(
            &Value::Object(object.clone()),
            &["pace_projected_used_percent", "paceProjectedUsedPercent"],
        )
        .unwrap_or(-1);
        let current_status = tokenomics_value_string(
            &Value::Object(object.clone()),
            &["pace_status", "paceStatus"],
        )
        .unwrap_or_else(|| "unknown".to_string());
        if live_age_seconds > 30
            || status == "over_pace"
            || projected > current_projected
            || current_status == "unknown"
        {
            object.insert("pace_strategy".to_string(), json!("sample_trajectory"));
            object.insert("paceStrategy".to_string(), json!("sample_trajectory"));
            object.insert("pace_status".to_string(), json!(status.clone()));
            object.insert("paceStatus".to_string(), json!(status.clone()));
            object.insert("pace_delta_percent".to_string(), json!(delta));
            object.insert("paceDeltaPercent".to_string(), json!(delta));
            object.insert("pace_projected_used_percent".to_string(), json!(projected));
            object.insert("paceProjectedUsedPercent".to_string(), json!(projected));
            object.insert(
                "pace_projected_exhaustion_seconds".to_string(),
                json!(projected_exhaustion_seconds),
            );
            object.insert(
                "paceProjectedExhaustionSeconds".to_string(),
                json!(projected_exhaustion_seconds),
            );
            object.insert(
                "pace_projected_exhaustion_at".to_string(),
                json!(projected_exhaustion_at),
            );
            object.insert(
                "paceProjectedExhaustionAt".to_string(),
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
    tokenomics_refresh_provider_accounts_from_usage(conn)?;
    let hourly = tokenomics_account_hourly_sync_rollups(conn, clean_since, scope_filter)?;
    let mut limits = tokenomics_provider_limits(conn, false, false)?;
    if record_limit_samples {
        let _ = tokenomics_record_provider_limit_samples(conn, &limits);
    }
    tokenomics_apply_provider_limit_sample_pacing(conn, &mut limits)?;
    tokenomics_record_latest_windows(conn, &limits)?;
    tokenomics_refresh_provider_accounts_from_usage(conn)?;
    let retired_account_keys = tokenomics_retired_provider_account_keys();
    let mut provider_accounts = tokenomics_provider_account_rows(conn, clean_since, scope_filter)?;
    tokenomics_retain_active_account_rows(&mut provider_accounts, &retired_account_keys);
    let mut latest_windows = tokenomics_latest_window_rows(conn, clean_since, scope_filter)?;
    tokenomics_retain_active_account_rows(&mut latest_windows, &retired_account_keys);
    let sync_cursor = hourly
        .iter()
        .chain(provider_accounts.iter())
        .chain(latest_windows.iter())
        .filter_map(|row| row.get("updated_at").and_then(Value::as_str))
        .max()
        .map(ToOwned::to_owned)
        .or_else(|| clean_since.map(ToOwned::to_owned));
    let hourly_count = hourly.len();
    let provider_account_count = provider_accounts.len();
    let latest_window_count = latest_windows.len();
    Ok(json!({
        "known": hourly_count > 0 || provider_account_count > 0 || latest_window_count > 0,
        "source": "rust_local_tokenomics_sqlite_delta_v2",
        "schema_version": "tokenomics_v2",
        "updated_at": tokenomics_now_iso_like(),
        "sync_cursor": sync_cursor,
        "hourly_count": hourly_count,
        "provider_account_count": provider_account_count,
        "providerAccountCount": provider_account_count,
        "latest_window_count": latest_window_count,
        "latestWindowCount": latest_window_count,
        "hourly": hourly,
        "provider_accounts": provider_accounts.clone(),
        "providerAccounts": provider_accounts,
        "latest_windows": latest_windows.clone(),
        "latestWindows": latest_windows,
        "limits": limits,
    }))
}

fn tokenomics_record_cloud_account_state(app: &AppHandle, event: &Value) -> Result<Value, String> {
    let conn = tokenomics_open_db(app)?;
    let local_device_ids = tokenomics_local_device_id_set(&conn)?;
    let inherited_device_id =
        tokenomics_text_field(event, &["device_id", "deviceId", "machine_id", "machineId"])
            .or_else(|| {
                event.get("payload").and_then(|payload| {
                    tokenomics_text_field(
                        payload,
                        &["device_id", "deviceId", "machine_id", "machineId"],
                    )
                })
            });
    let event_kind = tokenomics_text_field(event, &["event_kind", "eventKind", "kind"])
        .unwrap_or_else(|| "tokenomics_cloud_update".to_string());
    let inherited_billing_scope =
        tokenomics_billing_scope_from_value(event, &tokenomics_unknown_billing_scope());
    let summary = tokenomics_cloud_summary_payload(event);
    let account_scope_key =
        tokenomics_cloud_account_scope_key(event, &summary, &inherited_billing_scope);
    let sync_cursor = tokenomics_cloud_summary_sync_cursor(event, &summary);
    if let Some(cursor) = sync_cursor.as_deref() {
        tokenomics_store_cloud_account_sync_cursor(&conn, &account_scope_key, cursor)?;
    }
    let tombstoned_devices =
        tokenomics_tombstoned_cloud_account_device_ids(event, &local_device_ids);
    for device_id in &tombstoned_devices {
        tokenomics_delete_cloud_device_facts(&conn, device_id)?;
    }
    let stored_limit_count = tokenomics_store_cloud_provider_limits(
        &conn,
        &summary,
        &inherited_billing_scope,
        inherited_device_id.as_deref(),
        &local_device_ids,
    )?;
    let stored_limit_sample_count = tokenomics_store_cloud_provider_limit_samples(
        &conn,
        &summary,
        &inherited_billing_scope,
        inherited_device_id.as_deref(),
        &local_device_ids,
    )?;
    let stored_device_identity_count = tokenomics_store_cloud_device_identities(&conn, &summary)?;
    let hourly = summary
        .get("hourly")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let hourly_group_replacements = summary
        .get("hourly_group_replacements")
        .or_else(|| summary.get("hourlyGroupReplacements"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut replacement_count = 0usize;
    for replacement in &hourly_group_replacements {
        let Some(device_id) = tokenomics_remote_cloud_device_id_from_value(
            replacement,
            inherited_device_id.as_deref(),
            &local_device_ids,
        ) else {
            continue;
        };
        let bucket_start = tokenomics_value_string(replacement, &["bucket_start", "bucketStart"])
            .or_else(|| {
                tokenomics_value_i64(replacement, &["bucket_start_ms", "bucketStartMs"])
                    .and_then(tokenomics_hour_bucket_from_ms)
            })
            .unwrap_or_default();
        if bucket_start.is_empty() {
            continue;
        }
        replacement_count += conn
            .execute(
                "DELETE FROM tokenomics_cloud_rollups
                 WHERE device_id=?1 AND bucket_width='hour' AND bucket_start=?2",
                rusqlite::params![device_id.as_str(), bucket_start.as_str()],
            )
            .map_err(|error| {
                format!("Unable to replace cached cloud Tokenomics hour group: {error}")
            })?;
    }
    if hourly.is_empty() && hourly_group_replacements.is_empty() {
        return Ok(json!({
            "ok": true,
            "stored_count": 0,
            "stored_replacement_count": replacement_count,
            "stored_limit_count": stored_limit_count,
            "stored_limit_sample_count": stored_limit_sample_count,
            "stored_device_identity_count": stored_device_identity_count,
            "event_kind": event_kind,
        }));
    }

    let now = tokenomics_now_iso_like();
    let is_snapshot =
        event_kind.ends_with("_snapshot") || event_kind == "tokenomics_account_snapshot";
    let mut incoming_devices = HashSet::<String>::new();
    for rollup in &hourly {
        if let Some(device_id) = tokenomics_remote_cloud_device_id_from_value(
            rollup,
            inherited_device_id.as_deref(),
            &local_device_ids,
        ) {
            incoming_devices.insert(device_id);
        }
    }
    if is_snapshot {
        for device_id in &incoming_devices {
            conn.execute(
                "DELETE FROM tokenomics_cloud_rollups WHERE device_id=?1",
                rusqlite::params![device_id.as_str()],
            )
            .map_err(|error| format!("Unable to clear cached cloud Tokenomics rows: {error}"))?;
        }
    }

    let mut stored_count = 0usize;
    for rollup in hourly.iter().take(TOKENOMICS_SYNC_ROLLUP_LIMIT) {
        let Some(device_id) = tokenomics_remote_cloud_device_id_from_value(
            rollup,
            inherited_device_id.as_deref(),
            &local_device_ids,
        ) else {
            continue;
        };
        let provider =
            tokenomics_value_string(rollup, &["provider"]).unwrap_or_else(|| "unknown".to_string());
        let agent_kind = tokenomics_value_string(rollup, &["agent_kind", "agentKind"])
            .unwrap_or_else(|| provider.clone());
        let fallback_account = tokenomics_provider_account(&provider, &agent_kind);
        let provider_account_key = tokenomics_value_string(
            rollup,
            &[
                "provider_account_key",
                "providerAccountKey",
                "subscription_key",
                "subscriptionKey",
            ],
        )
        .unwrap_or_else(|| fallback_account.key.clone());
        let provider_account_label =
            tokenomics_value_string(rollup, &["provider_account_label", "providerAccountLabel"])
                .unwrap_or_else(|| fallback_account.label.clone());
        let billing_scope = tokenomics_billing_scope_from_value(rollup, &inherited_billing_scope);
        let subscription_key = Some(provider_account_key.clone());
        let model = tokenomics_value_string(rollup, &["model"]);
        let bucket_width = tokenomics_value_string(rollup, &["bucket_width", "bucketWidth"])
            .unwrap_or_else(|| "hour".to_string());
        let bucket_start = tokenomics_value_string(rollup, &["bucket_start", "bucketStart"])
            .unwrap_or_else(tokenomics_now_iso_like);
        let updated_at = tokenomics_value_string(rollup, &["updated_at", "updatedAt"])
            .unwrap_or_else(|| now.clone());
        let input_tokens = tokenomics_value_i64(rollup, &["input_tokens", "inputTokens"])
            .unwrap_or(0)
            .max(0);
        let output_tokens = tokenomics_value_i64(rollup, &["output_tokens", "outputTokens"])
            .unwrap_or(0)
            .max(0);
        let cache_read_tokens =
            tokenomics_value_i64(rollup, &["cache_read_tokens", "cacheReadTokens"])
                .unwrap_or(0)
                .max(0);
        let cache_write_tokens =
            tokenomics_value_i64(rollup, &["cache_write_tokens", "cacheWriteTokens"])
                .unwrap_or(0)
                .max(0);
        let reported_total_tokens = tokenomics_value_i64(rollup, &["total_tokens", "totalTokens"])
            .unwrap_or(0)
            .max(0);
        let total_tokens = if reported_total_tokens > 0 {
            reported_total_tokens
        } else {
            input_tokens
                .saturating_add(output_tokens)
                .saturating_add(cache_read_tokens)
                .saturating_add(cache_write_tokens)
        };
        let id = tokenomics_cloud_rollup_id(
            &device_id,
            &provider,
            &agent_kind,
            model.as_deref(),
            &provider_account_key,
            billing_scope.scope_type.as_str(),
            billing_scope.team_id.as_deref(),
            &bucket_width,
            &bucket_start,
        );
        conn.execute(
	            "INSERT OR REPLACE INTO tokenomics_cloud_rollups(
	               id, device_id, provider, agent_kind, model, subscription_key,
	               provider_account_key, provider_account_label,
	               billing_scope_type, billing_team_id, billing_scope_source,
	               workspace_id, repo_path,
	               bucket_width, bucket_start, input_tokens, output_tokens,
	               cache_read_tokens, cache_write_tokens, total_tokens,
	               estimated_cost_microusd, event_count, updated_at, received_at
	             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, NULL, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
	            rusqlite::params![
	                id,
	                device_id,
                provider,
                agent_kind,
                model.as_deref(),
	                subscription_key.as_deref(),
	                provider_account_key,
	                provider_account_label,
	                billing_scope.scope_type.as_str(),
	                billing_scope.team_id.as_deref(),
	                billing_scope.source.as_str(),
	                bucket_width,
                bucket_start,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_write_tokens,
                total_tokens,
                tokenomics_value_i64(rollup, &["estimated_cost_microusd", "estimatedCostMicrousd"]).unwrap_or(0).max(0),
                tokenomics_value_i64(rollup, &["event_count", "eventCount"]).unwrap_or(0).max(0),
                updated_at,
                now.as_str(),
            ],
        )
        .map_err(|error| format!("Unable to cache cloud Tokenomics row: {error}"))?;
        stored_count += 1;
    }
    tokenomics_refresh_cloud_daily_rollups(&conn)?;
    Ok(json!({
        "ok": true,
        "stored_count": stored_count,
        "stored_replacement_count": replacement_count,
        "stored_limit_count": stored_limit_count,
        "stored_limit_sample_count": stored_limit_sample_count,
        "stored_device_identity_count": stored_device_identity_count,
        "event_kind": event_kind,
        "device_count": incoming_devices.len(),
    }))
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
        .or_else(|| summary.get("providerLimits"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if incoming.is_empty() {
        return Ok(0);
    }

    let mut hydrated = Vec::new();
    for limit in incoming.into_iter().take(128) {
        let mut limit = tokenomics_account_usage_fields_stripped(&limit);
        let Some(device_id) =
            tokenomics_remote_cloud_device_id_from_value(&limit, inherited_device_id, local_device_ids)
        else {
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
            object.insert("deviceId".to_string(), json!(device_id.as_str()));
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
        .or_else(|| summary.get("limitSamples"))
        .or_else(|| summary.get("provider_limit_samples"))
        .or_else(|| summary.get("providerLimitSamples"))
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
            object.insert("deviceId".to_string(), json!(device_id.as_str()));
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
        .or_else(|| event.get("tokenomicsDelta"))
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
                .and_then(|payload| payload.get("tokenomicsDelta"))
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
        .or_else(|| {
            event
                .get("data")
                .and_then(|data| data.get("summary"))
        })
        .or_else(|| {
            event
                .get("data")
                .and_then(|data| data.get("tokenomics_delta"))
        })
        .or_else(|| {
            event
                .get("data")
                .and_then(|data| data.get("tokenomicsDelta"))
        })
        .or_else(|| {
            event
                .get("data")
                .and_then(|data| data.get("snapshot"))
        })
        .or_else(|| {
            event
                .get("data")
                .and_then(|data| data.get("delta"))
                .filter(|value| value.is_object())
        })
        .or_else(|| event.get("payload").filter(|payload| tokenomics_cloud_relay_summary_like(payload)))
        .or_else(|| event.get("data").filter(|data| tokenomics_cloud_relay_summary_like(data)))
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
        || value.get("hourlyGroups").is_some()
        || value.get("windows").is_some()
        || value.get("limits").is_some()
        || value.get("provider_accounts").is_some()
        || value.get("providerAccounts").is_some()
}

fn tokenomics_normalize_cloud_relay_summary(summary: &Value) -> Value {
    let has_hourly_groups = summary
        .get("hourly_groups")
        .or_else(|| summary.get("hourlyGroups"))
        .is_some();
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
    let inherited_device_id =
        tokenomics_text_field(summary, &["device_id", "deviceId", "machine_id", "machineId"]);
    let account_labels = tokenomics_cloud_relay_provider_account_labels(summary);

    let mut hourly = summary
        .get("hourly")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut hourly_group_replacements = summary
        .get("hourly_group_replacements")
        .or_else(|| summary.get("hourlyGroupReplacements"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for group in tokenomics_v2_collection_values(
        summary
            .get("hourly_groups")
            .or_else(|| summary.get("hourlyGroups")),
    ) {
        let Some(bucket_ms) = tokenomics_value_i64(group, &["bucket_start_ms", "bucketStartMs"])
        else {
            continue;
        };
        let Some(bucket_start) = tokenomics_hour_bucket_from_ms(bucket_ms) else {
            continue;
        };
        if let Some(device_id) = inherited_device_id.as_deref() {
            hourly_group_replacements.push(json!({
                "device_id": device_id,
                "deviceId": device_id,
                "bucket_start": bucket_start,
                "bucketStart": bucket_start,
                "bucket_start_ms": bucket_ms,
                "bucketStartMs": bucket_ms,
                "updated_at": tokenomics_v2_ms_value_to_iso(
                    group,
                    &["observed_at_ms", "observedAtMs", "group_generation", "groupGeneration"],
                ).unwrap_or_else(tokenomics_now_iso_like),
            }));
        }
        let updated_at = tokenomics_v2_ms_value_to_iso(
            group,
            &["observed_at_ms", "observedAtMs", "group_generation", "groupGeneration"],
        )
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
        .or_else(|| summary.get("providerLimits"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut limit_samples = summary
        .get("limit_samples")
        .or_else(|| summary.get("limitSamples"))
        .or_else(|| summary.get("provider_limit_samples"))
        .or_else(|| summary.get("providerLimitSamples"))
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
        json!(hourly_group_replacements.clone()),
    );
    normalized.insert(
        "hourlyGroupReplacements".to_string(),
        json!(hourly_group_replacements),
    );
    normalized.insert("limits".to_string(), json!(limits));
    normalized.insert("limit_samples".to_string(), json!(limit_samples.clone()));
    normalized.insert("limitSamples".to_string(), json!(limit_samples));
    Value::Object(normalized)
}

fn tokenomics_cloud_relay_provider_account_labels(summary: &Value) -> HashMap<String, String> {
    let mut labels = HashMap::new();
    let Some(accounts) = summary
        .get("provider_accounts")
        .or_else(|| summary.get("providerAccounts"))
    else {
        return labels;
    };
    match accounts {
        Value::Object(map) => {
            for (key, account) in map {
                if let Some(label) = tokenomics_text_field(
                    account,
                    &[
                        "provider_account_label",
                        "providerAccountLabel",
                        "label",
                        "display_name",
                        "displayName",
                    ],
                ) {
                    labels.insert(key.clone(), label);
                }
            }
        }
        Value::Array(items) => {
            for account in items {
                let Some(key) = tokenomics_text_field(
                    account,
                    &[
                        "provider_account_key",
                        "providerAccountKey",
                        "subscription_key",
                        "subscriptionKey",
                        "key",
                    ],
                ) else {
                    continue;
                };
                if let Some(label) = tokenomics_text_field(
                    account,
                    &[
                        "provider_account_label",
                        "providerAccountLabel",
                        "label",
                        "display_name",
                        "displayName",
                    ],
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
    tokenomics_text_field(
        row,
        &[
            "provider_account_label",
            "providerAccountLabel",
            "label",
            "display_name",
            "displayName",
        ],
    )
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
    let device_id = tokenomics_text_field(row, &["device_id", "deviceId", "machine_id", "machineId"])
        .or_else(|| inherited_device_id.map(str::to_string));
    let provider =
        tokenomics_value_string(row, &["provider"]).unwrap_or_else(|| "unknown".to_string());
    let agent_kind = tokenomics_value_string(row, &["agent_kind", "agentKind"])
        .unwrap_or_else(|| provider.clone());
    let account_key = tokenomics_value_string(
        row,
        &[
            "provider_account_key",
            "providerAccountKey",
            "subscription_key",
            "subscriptionKey",
            "account_key",
            "accountKey",
        ],
    )
    .unwrap_or_else(|| tokenomics_provider_account(&provider, &agent_kind).key);
    let label =
        tokenomics_cloud_relay_account_label(row, &account_key, &provider, &agent_kind, account_labels);
    let input_tokens = tokenomics_value_i64(row, &["input", "input_tokens", "inputTokens"])
        .unwrap_or(0)
        .max(0);
    let output_tokens = tokenomics_value_i64(row, &["output", "output_tokens", "outputTokens"])
        .unwrap_or(0)
        .max(0);
    let cache_read_tokens =
        tokenomics_value_i64(row, &["cache_read", "cacheRead", "cache_read_tokens", "cacheReadTokens"])
            .unwrap_or(0)
            .max(0);
    let cache_write_tokens = tokenomics_value_i64(
        row,
        &[
            "cache_write",
            "cacheWrite",
            "cache_write_tokens",
            "cacheWriteTokens",
        ],
    )
    .unwrap_or(0)
    .max(0);
    let reported_total = tokenomics_value_i64(row, &["total", "total_tokens", "totalTokens"])
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
            "estimatedCostMicrousd",
            "provider_cost_microusd",
            "providerCostMicrousd",
            "cost_microusd",
            "costMicrousd",
            "cost",
        ],
    )
    .unwrap_or(0)
    .max(0);
    let model = tokenomics_value_string(row, &["model"]).unwrap_or_else(|| agent_kind.clone());
    Some(json!({
        "device_id": device_id.clone(),
        "deviceId": device_id,
        "provider": provider,
        "agent_kind": agent_kind.clone(),
        "agentKind": agent_kind,
        "model": model,
        "provider_account_key": account_key.clone(),
        "providerAccountKey": account_key.clone(),
        "subscription_key": account_key.clone(),
        "subscriptionKey": account_key,
        "provider_account_label": label.clone(),
        "providerAccountLabel": label,
        "bucket_width": "hour",
        "bucketWidth": "hour",
        "bucket_start": bucket_start,
        "bucketStart": bucket_start,
        "input_tokens": input_tokens,
        "inputTokens": input_tokens,
        "output_tokens": output_tokens,
        "outputTokens": output_tokens,
        "cache_read_tokens": cache_read_tokens,
        "cacheReadTokens": cache_read_tokens,
        "cache_write_tokens": cache_write_tokens,
        "cacheWriteTokens": cache_write_tokens,
        "total_tokens": total_tokens,
        "totalTokens": total_tokens,
        "estimated_cost_microusd": estimated_cost_microusd,
        "estimatedCostMicrousd": estimated_cost_microusd,
        "provider_cost_microusd": estimated_cost_microusd,
        "providerCostMicrousd": estimated_cost_microusd,
        "cost": estimated_cost_microusd,
        "event_count": tokenomics_value_i64(row, &["events", "event_count", "eventCount"]).unwrap_or(0).max(0),
        "eventCount": tokenomics_value_i64(row, &["events", "event_count", "eventCount"]).unwrap_or(0).max(0),
        "updated_at": updated_at,
        "updatedAt": updated_at,
    }))
}

fn tokenomics_cloud_relay_window_row(
    window: &Value,
    inherited_device_id: Option<&str>,
    account_labels: &HashMap<String, String>,
) -> Option<Value> {
    let device_id =
        tokenomics_text_field(window, &["device_id", "deviceId", "machine_id", "machineId"])
            .or_else(|| inherited_device_id.map(str::to_string));
    let provider =
        tokenomics_value_string(window, &["provider"]).unwrap_or_else(|| "unknown".to_string());
    let agent_kind = tokenomics_value_string(window, &["agent_kind", "agentKind"])
        .unwrap_or_else(|| provider.clone());
    let account_key = tokenomics_value_string(
        window,
        &[
            "provider_account_key",
            "providerAccountKey",
            "subscription_key",
            "subscriptionKey",
            "account_key",
            "accountKey",
        ],
    )
    .unwrap_or_else(|| tokenomics_provider_account(&provider, &agent_kind).key);
    let label = tokenomics_cloud_relay_account_label(
        window,
        &account_key,
        &provider,
        &agent_kind,
        account_labels,
    );
    let window_kind = tokenomics_value_string(
        window,
        &["window_kind", "windowKind", "limit_kind", "limitKind", "window"],
    )
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
            object.insert("deviceId".to_string(), json!(device_id.as_str()));
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
    tokenomics_value_string(
        summary,
        &[
            "scope_key",
            "scopeKey",
            "billing_scope_key",
            "billingScopeKey",
        ],
    )
    .or_else(|| {
        tokenomics_value_string(
            event,
            &[
                "scope_key",
                "scopeKey",
                "billing_scope_key",
                "billingScopeKey",
            ],
        )
    })
    .unwrap_or_else(|| tokenomics_billing_scope_key(&fallback.scope_type, fallback.team_id.as_deref()))
}

fn tokenomics_cloud_summary_sync_cursor(event: &Value, summary: &Value) -> Option<String> {
    tokenomics_value_string(
        summary,
        &[
            "server_cursor",
            "serverCursor",
            "sync_cursor",
            "syncCursor",
            "cursor",
        ],
    )
    .or_else(|| {
        tokenomics_value_string(
            event,
            &[
                "server_cursor",
                "serverCursor",
                "sync_cursor",
                "syncCursor",
                "cursor",
            ],
        )
    })
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

fn tokenomics_cloud_account_sync_cursor(
    app: &AppHandle,
    scope_type: &str,
    team_id: Option<&str>,
) -> Result<Option<String>, String> {
    let conn = tokenomics_open_db(app)?;
    let scope_key = tokenomics_billing_scope_key(scope_type, team_id);
    match conn.query_row(
        "SELECT value FROM tokenomics_meta WHERE key=?1",
        rusqlite::params![tokenomics_cloud_account_sync_cursor_key(&scope_key)],
        |row| row.get::<_, String>(0),
    ) {
        Ok(value) => Ok(Some(value.trim().to_string()).filter(|value| !value.is_empty())),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!(
            "Unable to read cloud Tokenomics sync cursor: {error}"
        )),
    }
}

fn tokenomics_account_device_live_state_payload(event: &Value) -> Option<&Value> {
    let event_kind =
        tokenomics_text_field(event, &["event_kind", "eventKind", "kind"]).unwrap_or_default();
    let payload = event.get("payload");
    let data = event.get("data");
    let candidates = [
        event.get("summary"),
        data.and_then(|value| value.get("summary")),
        payload.and_then(|value| value.get("summary")),
        data,
        event.get("account_live_state"),
        event.get("accountLiveState"),
        payload.and_then(|value| value.get("data")),
        payload.and_then(|value| value.get("account_live_state")),
        payload.and_then(|value| value.get("accountLiveState")),
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
            .or_else(|| event.get("accountLiveState"))
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
        if device_id == local_device_id || tokenomics_cloud_relay_placeholder_device_id(&device_id) {
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
            if let Some(value) = summary
                .get("limit_samples")
                .or_else(|| summary.get("limitSamples"))
            {
                tokenomics_extend_device_rows(&mut limit_samples, Some(value), &device_id);
            }
            tokenomics_extend_device_rows(
                &mut device_identities,
                summary.get("device_identities"),
                &device_id,
            );
            tokenomics_extend_device_rows(
                &mut device_identities,
                summary.get("deviceIdentities"),
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
        "hourly_group_replacements": hourly_group_replacements.clone(),
        "hourlyGroupReplacements": hourly_group_replacements,
        "limits": limits,
        "limit_samples": limit_samples.clone(),
        "limitSamples": limit_samples,
        "device_identities": device_identities.clone(),
        "deviceIdentities": device_identities,
    });
    if let Some(object) = result.as_object_mut() {
        for key in [
            "server_cursor",
            "serverCursor",
            "sync_cursor",
            "syncCursor",
            "scope_key",
            "scopeKey",
            "billing_scope_type",
            "billingScopeType",
            "team_id",
            "teamId",
            "is_delta",
            "isDelta",
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
    let removed_fields = [
        "removed_at",
        "removedAt",
        "deleted_at",
        "deletedAt",
        "tombstoned_at",
        "tombstonedAt",
    ];
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
    let Some(accounts) = summary
        .get("provider_accounts")
        .or_else(|| summary.get("providerAccounts"))
    else {
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
                    &[
                        "provider_account_key",
                        "providerAccountKey",
                        "subscription_key",
                        "subscriptionKey",
                        "account_key",
                        "accountKey",
                    ],
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
    for group in tokenomics_v2_collection_values(
        summary
            .get("hourly_groups")
            .or_else(|| summary.get("hourlyGroups")),
    ) {
        let Some(bucket_ms) = tokenomics_value_i64(group, &["bucket_start_ms", "bucketStartMs"])
        else {
            continue;
        };
        let Some(bucket_start) = tokenomics_hour_bucket_from_ms(bucket_ms) else {
            continue;
        };
        let updated_at = tokenomics_v2_ms_value_to_iso(
            group,
            &[
                "observed_at_ms",
                "observedAtMs",
                "group_generation",
                "groupGeneration",
            ],
        )
        .unwrap_or_else(tokenomics_now_iso_like);
        hourly_group_replacements.push(json!({
            "device_id": device_id,
            "deviceId": device_id,
            "bucket_start": bucket_start,
            "bucketStart": bucket_start,
            "bucket_start_ms": bucket_ms,
            "bucketStartMs": bucket_ms,
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
    let agent_kind =
        tokenomics_v2_account_text(account, root_account, &["agent_kind", "agentKind"])
            .unwrap_or_else(|| fallback_agent.unwrap_or_else(|| provider.clone()));
    let provider_account_label = tokenomics_v2_account_text(
        account,
        root_account,
        &[
            "provider_account_label",
            "providerAccountLabel",
            "label",
            "display_name",
            "displayName",
        ],
    )
    .unwrap_or_else(|| tokenomics_provider_account(&provider, &agent_kind).label);
    let provider_account_key = if account_key.trim().is_empty() {
        tokenomics_v2_account_text(
            account,
            root_account,
            &["provider_account_key", "providerAccountKey"],
        )
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
                    let window_kind = tokenomics_text_field(
                        window,
                        &["window_kind", "windowKind", "limit_kind", "limitKind"],
                    )
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
    let root = account_state
        .get("provider_accounts")
        .or_else(|| account_state.get("providerAccounts"))?;
    match root {
        Value::Object(map) => map.get(account_key),
        Value::Array(items) => items.iter().find(|item| {
            tokenomics_text_field(
                item,
                &[
                    "provider_account_key",
                    "providerAccountKey",
                    "subscription_key",
                    "subscriptionKey",
                    "account_key",
                    "accountKey",
                ],
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
    let bucket_ms =
        tokenomics_value_i64(row, &["bucket_start_ms", "bucketStartMs"]).or_else(|| {
            tokenomics_value_string(row, &["bucket_start", "bucketStart"])
                .and_then(|value| tokenomics_timestamp_unix(&value))
                .map(|seconds| seconds.saturating_mul(1000) as i64)
        })?;
    let bucket_start = tokenomics_hour_bucket_from_ms(bucket_ms)?;
    let input_tokens = tokenomics_value_i64(row, &["input", "input_tokens", "inputTokens"])
        .unwrap_or(0)
        .max(0);
    let output_tokens = tokenomics_value_i64(row, &["output", "output_tokens", "outputTokens"])
        .unwrap_or(0)
        .max(0);
    let cache_read_tokens = tokenomics_value_i64(
        row,
        &[
            "cache_read",
            "cacheRead",
            "cache_read_tokens",
            "cacheReadTokens",
        ],
    )
    .unwrap_or(0)
    .max(0);
    let cache_write_tokens = tokenomics_value_i64(
        row,
        &[
            "cache_write",
            "cacheWrite",
            "cache_write_tokens",
            "cacheWriteTokens",
        ],
    )
    .unwrap_or(0)
    .max(0);
    let total_tokens = tokenomics_value_i64(row, &["total", "total_tokens", "totalTokens"])
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
            "estimatedCostMicrousd",
            "provider_cost_microusd",
            "providerCostMicrousd",
            "cost_microusd",
            "costMicrousd",
            "cost",
        ],
    )
    .unwrap_or(0)
    .max(0);
    let updated_at = tokenomics_v2_ms_value_to_iso(
        row,
        &["server_seq", "serverSeq", "observed_at_ms", "observedAtMs"],
    )
    .unwrap_or_else(tokenomics_now_iso_like);
    Some(json!({
        "device_id": device_id,
        "deviceId": device_id,
        "provider": provider,
        "agent_kind": agent_kind,
        "agentKind": agent_kind,
        "model": tokenomics_value_string(row, &["model"]).unwrap_or_else(|| agent_kind.to_string()),
        "provider_account_key": provider_account_key,
        "providerAccountKey": provider_account_key,
        "subscription_key": provider_account_key,
        "subscriptionKey": provider_account_key,
        "provider_account_label": provider_account_label,
        "providerAccountLabel": provider_account_label,
        "bucket_width": "hour",
        "bucketWidth": "hour",
        "bucket_start": bucket_start,
        "bucketStart": bucket_start,
        "input_tokens": input_tokens,
        "inputTokens": input_tokens,
        "output_tokens": output_tokens,
        "outputTokens": output_tokens,
        "cache_read_tokens": cache_read_tokens,
        "cacheReadTokens": cache_read_tokens,
        "cache_write_tokens": cache_write_tokens,
        "cacheWriteTokens": cache_write_tokens,
        "total_tokens": total_tokens,
        "totalTokens": total_tokens,
        "estimated_cost_microusd": estimated_cost_microusd,
        "estimatedCostMicrousd": estimated_cost_microusd,
        "provider_cost_microusd": estimated_cost_microusd,
        "providerCostMicrousd": estimated_cost_microusd,
        "cost": estimated_cost_microusd,
        "event_count": tokenomics_value_i64(row, &["events", "event_count", "eventCount"]).unwrap_or(0).max(0),
        "eventCount": tokenomics_value_i64(row, &["events", "event_count", "eventCount"]).unwrap_or(0).max(0),
        "attribution_kind": tokenomics_value_string(row, &["attribution", "attribution_kind", "attributionKind"]).unwrap_or_else(|| "token_based".to_string()),
        "updated_at": updated_at,
        "updatedAt": updated_at,
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
    let used_percent = tokenomics_value_i64(window, &["used_percent", "usedPercent", "used"])
        .map(|value| value.clamp(0, 100));
    let remaining_percent = tokenomics_value_i64(
        window,
        &["remaining_percent", "remainingPercent", "remaining"],
    )
    .map(|value| value.clamp(0, 100));
    if used_percent.is_none() && remaining_percent.is_none() {
        return None;
    }
    let window_kind = tokenomics_v2_display_window_kind(
        tokenomics_value_string(
            window,
            &["window_kind", "windowKind", "limit_kind", "limitKind"],
        )
        .as_deref()
        .unwrap_or(raw_window_kind),
    );
    let observed_ms = tokenomics_value_i64(
        window,
        &["observed_at_ms", "observedAtMs", "server_seq", "serverSeq"],
    )
    .unwrap_or_else(|| (tokenomics_unix_now().saturating_mul(1000)) as i64);
    let sample_at_unix = tokenomics_normalize_unix_timestamp(observed_ms);
    let sample_at = tokenomics_iso_from_unix(sample_at_unix);
    let reset_at_ms = tokenomics_value_i64(window, &["reset_at_ms", "resetAtMs"]);
    let reset_at = reset_at_ms
        .map(tokenomics_normalize_unix_timestamp)
        .filter(|seconds| *seconds > 0)
        .map(tokenomics_iso_from_unix);
    let reset_after_seconds =
        reset_at_ms.map(|reset| reset.saturating_sub(observed_ms).max(0) / 1000);
    let limit_window_seconds = tokenomics_limit_effective_window_seconds(&window_kind, None);
    Some(json!({
        "device_id": device_id,
        "deviceId": device_id,
        "source_device_id": tokenomics_value_string(window, &["source_device_id", "sourceDeviceId"]).unwrap_or_else(|| device_id.to_string()),
        "sourceDeviceId": tokenomics_value_string(window, &["source_device_id", "sourceDeviceId"]).unwrap_or_else(|| device_id.to_string()),
        "provider": provider,
        "agent_kind": agent_kind,
        "agentKind": agent_kind,
        "provider_account_key": provider_account_key,
        "providerAccountKey": provider_account_key,
        "subscription_key": provider_account_key,
        "subscriptionKey": provider_account_key,
        "provider_account_label": provider_account_label,
        "providerAccountLabel": provider_account_label,
        "window_kind": window_kind,
        "windowKind": window_kind,
        "limit_kind": window_kind,
        "limitKind": window_kind,
        "used_percent": used_percent,
        "usedPercent": used_percent,
        "remaining_percent": remaining_percent,
        "remainingPercent": remaining_percent,
        "sample_at": sample_at,
        "sampleAt": sample_at,
        "sample_at_unix": sample_at_unix as i64,
        "sampleAtUnix": sample_at_unix as i64,
        "updated_at": sample_at,
        "updatedAt": sample_at,
        "reset_at": reset_at,
        "resetAt": reset_at,
        "reset_after_seconds": reset_after_seconds,
        "resetAfterSeconds": reset_after_seconds,
        "limit_window_seconds": limit_window_seconds,
        "limitWindowSeconds": limit_window_seconds,
        "source": tokenomics_value_string(window, &["source", "limit_source", "limitSource"]).unwrap_or_else(|| "cloud_v2".to_string()),
        "limit_source": tokenomics_value_string(window, &["source", "limit_source", "limitSource"]).unwrap_or_else(|| "cloud_v2".to_string()),
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
    tokenomics_text_field(value, &["device_id", "deviceId", "machine_id", "machineId"])
        .or_else(|| {
            value.get("device").and_then(|device| {
                tokenomics_text_field(
                    device,
                    &["device_id", "deviceId", "machine_id", "machineId"],
                )
            })
        })
        .or_else(|| {
            value.get("summary").and_then(|summary| {
                tokenomics_text_field(
                    summary,
                    &[
                        "current_device_id",
                        "currentDeviceId",
                        "device_id",
                        "deviceId",
                    ],
                )
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
        "currentDeviceName",
        "device_name",
        "deviceName",
        "machine_name",
        "machineName",
        "platform",
        "form_factor",
        "formFactor",
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
    object
        .entry("deviceId".to_string())
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
            tokenomics_value_string(row, &["device_id", "deviceId", "machine_id", "machineId"])
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

fn tokenomics_provider_limits(
    conn: &rusqlite::Connection,
    include_cloud_last_known: bool,
    include_stale_provider_cache: bool,
) -> Result<Vec<Value>, String> {
    let mut limits = Vec::new();

    let codex_active_profile_id = agent_accounts_active_profile_id_for_tokenomics("codex");
    let codex_plan = tokenomics_codex_plan_state();
    let codex_account = tokenomics_provider_account("openai", "codex");
    if let Some(codex_usage) = tokenomics_codex_live_usage(
        conn,
        &codex_plan,
        &codex_account,
        include_stale_provider_cache,
    ) {
        let codex_account = tokenomics_reconcile_codex_provider_account_from_usage(
            conn,
            &codex_account,
            &codex_usage,
        )?;
        let mut codex_limits = tokenomics_codex_live_limit_snapshots(
            &codex_plan,
            &codex_usage,
            &codex_account,
        );
        tokenomics_tag_limit_agent_profile(
            &mut codex_limits,
            AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
            &codex_active_profile_id,
        );
        limits.extend(codex_limits);
    } else {
        let mut codex_limits = vec![
            tokenomics_unknown_limit_snapshot(
                "openai",
                "codex",
                &codex_account,
                &codex_plan,
                "5_hour",
                "5-Hour Session",
            ),
            tokenomics_unknown_limit_snapshot(
                "openai",
                "codex",
                &codex_account,
                &codex_plan,
                "weekly",
                "Weekly Limit",
            ),
        ];
        tokenomics_tag_limit_agent_profile(
            &mut codex_limits,
            AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
            &codex_active_profile_id,
        );
        limits.extend(codex_limits);
    }

    // Codex agent-account profiles: each profile dir carries its own
    // auth.json, so the usage endpoint reports per-account windows (including
    // consumption from other devices on that account). Profiles that haven't
    // completed login are skipped instead of rendering unknown rows.
    for (profile_id, profile_label, profile_dir) in agent_accounts_profiles_for_tokenomics("codex")
    {
        let auth_path = profile_dir.join("auth.json");
        let profile_auth = tokenomics_read_json_file(auth_path.clone());
        let profile_plan = tokenomics_codex_plan_state_for_auth_path(Some(auth_path));
        let has_token = profile_plan
            .get("access_token")
            .and_then(Value::as_str)
            .map(str::trim)
            .is_some_and(|token| !token.is_empty());
        if !has_token {
            continue;
        }
        let mut profile_account =
            tokenomics_provider_account_from_auth("openai", "codex", profile_auth.as_ref());
        if profile_account.key.ends_with(":unknown") {
            profile_account = TokenomicsProviderAccount {
                key: format!("openai:codex:profile:{profile_id}"),
                label: tokenomics_clean_non_profile_provider_account_label(&profile_label)
                    .unwrap_or_else(|| {
                        let hash = tokenomics_hash(&profile_id);
                        let suffix = hash.get(0..8).unwrap_or(hash.as_str());
                        format!("Codex account {suffix}")
                    }),
            };
        }
        if let Some(profile_usage) = tokenomics_codex_live_usage(
            conn,
            &profile_plan,
            &profile_account,
            include_stale_provider_cache,
        ) {
            let profile_account = tokenomics_reconcile_codex_provider_account_from_usage(
                conn,
                &profile_account,
                &profile_usage,
            )?;
            let mut profile_limits = tokenomics_codex_live_limit_snapshots(
                &profile_plan,
                &profile_usage,
                &profile_account,
            );
            tokenomics_tag_limit_agent_profile(
                &mut profile_limits,
                &profile_id,
                &codex_active_profile_id,
            );
            limits.extend(profile_limits);
        }
    }

    let claude_active_profile_id = agent_accounts_active_profile_id_for_tokenomics("claude");
    let claude_plan = tokenomics_claude_plan_state();
    let claude_account = tokenomics_provider_account("anthropic", "claude");
    let _ = tokenomics_ensure_claude_statusline_collector(&claude_plan);
    if let Some(claude_usage) =
        tokenomics_claude_live_usage(conn, &claude_account, include_stale_provider_cache)
    {
        let mut claude_limits = tokenomics_claude_live_limit_snapshots(
            &claude_plan,
            &claude_usage,
            &claude_account,
        );
        tokenomics_tag_limit_agent_profile(
            &mut claude_limits,
            AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
            &claude_active_profile_id,
        );
        limits.extend(claude_limits);
    } else if let Some(claude_limits) =
        tokenomics_claude_statusline_limits(&claude_plan, &claude_account)
    {
        let mut claude_limits = claude_limits;
        tokenomics_tag_limit_agent_profile(
            &mut claude_limits,
            AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
            &claude_active_profile_id,
        );
        limits.extend(claude_limits);
    } else {
        let mut claude_limits = vec![
            tokenomics_unknown_limit_snapshot(
                "anthropic",
                "claude",
                &claude_account,
                &claude_plan,
                "5_hour",
                "5-Hour Session",
            ),
            tokenomics_unknown_limit_snapshot(
                "anthropic",
                "claude",
                &claude_account,
                &claude_plan,
                "weekly",
                "Weekly Limit",
            ),
        ];
        tokenomics_tag_limit_agent_profile(
            &mut claude_limits,
            AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
            &claude_active_profile_id,
        );
        limits.extend(claude_limits);
    }

    // Claude agent-account profiles: live window limits per account when the
    // profile keeps file-based credentials (macOS Keychain installs don't —
    // those profiles still get per-account token stats from their transcript
    // scan roots, just not the live limit gauges).
    for (profile_id, profile_label, profile_dir) in agent_accounts_profiles_for_tokenomics("claude")
    {
        let credentials = tokenomics_read_json_file(profile_dir.join(".credentials.json"));
        let Some(access_token) = credentials.as_ref().and_then(|credentials| {
            credentials
                .get("claudeAiOauth")
                .and_then(|oauth| tokenomics_value_string(oauth, &["accessToken", "access_token"]))
        }) else {
            continue;
        };
        let profile_plan = tokenomics_claude_plan_state_from_credentials(credentials.as_ref());
        let profile_account = TokenomicsProviderAccount {
            key: format!("anthropic:claude:profile:{profile_id}"),
            label: format!("Claude · {profile_label}"),
        };
        if let Some(profile_usage) = tokenomics_claude_live_usage_with_token(
            conn,
            &access_token,
            &profile_account,
            include_stale_provider_cache,
        ) {
            let mut profile_limits = tokenomics_claude_live_limit_snapshots(
                &profile_plan,
                &profile_usage,
                &profile_account,
            );
            tokenomics_tag_limit_agent_profile(
                &mut profile_limits,
                &profile_id,
                &claude_active_profile_id,
            );
            limits.extend(profile_limits);
        }
    }

    let local_device_id = tokenomics_local_device_id();
    tokenomics_tag_provider_limit_devices(&mut limits, &local_device_id);
    let active_account_keys = tokenomics_active_provider_account_key_map(&limits);
    limits = tokenomics_merge_provider_limits(Vec::new(), limits);
    tokenomics_retag_active_provider_accounts(&mut limits, &active_account_keys);

    if include_cloud_last_known {
        limits = tokenomics_merge_provider_limits(tokenomics_cloud_provider_limits(conn)?, limits);
        tokenomics_retag_active_provider_accounts(&mut limits, &active_account_keys);
    }

    // Suppressed duplicate-of-default profile accounts: drop their rows from
    // every limits payload (cloud last-known included) and from the local
    // sample store, so the same login never renders as two account chips.
    let retired_keys = tokenomics_retired_provider_account_keys();
    if !retired_keys.is_empty() {
        tokenomics_retain_active_account_rows(&mut limits, &retired_keys);
        tokenomics_purge_retired_limit_samples(conn, &retired_keys)?;
    }

    Ok(limits)
}

fn tokenomics_tag_provider_limit_devices(limits: &mut [Value], device_id: &str) {
    let device_id = device_id.trim();
    if device_id.is_empty() {
        return;
    }
    for limit in limits {
        if let Some(object) = limit.as_object_mut() {
            object
                .entry("device_id".to_string())
                .or_insert_with(|| json!(device_id));
            object
                .entry("deviceId".to_string())
                .or_insert_with(|| json!(device_id));
        }
    }
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
    let existing_unknown = tokenomics_provider_limit_is_unknown(existing);
    let incoming_unknown = tokenomics_provider_limit_is_unknown(incoming);
    if existing_unknown && !incoming_unknown {
        return true;
    }
    if !existing_unknown && incoming_unknown {
        return false;
    }
    tokenomics_provider_limit_updated_at_unix(incoming)
        >= tokenomics_provider_limit_updated_at_unix(existing)
}

fn tokenomics_provider_limit_key(limit: &Value) -> String {
    let device_id =
        tokenomics_value_string(limit, &["device_id", "deviceId", "machine_id", "machineId"])
            .unwrap_or_else(|| "unknown-device".to_string());
    let provider =
        tokenomics_value_string(limit, &["provider"]).unwrap_or_else(|| "unknown".to_string());
    let agent_kind = tokenomics_value_string(limit, &["agent_kind", "agentKind"])
        .unwrap_or_else(|| provider.clone());
    let account_key = tokenomics_value_string(
        limit,
        &[
            "provider_account_key",
            "providerAccountKey",
            "subscription_key",
            "subscriptionKey",
        ],
    )
    .unwrap_or_else(|| format!("{provider}:{agent_kind}:unknown"));
    let scope_type = tokenomics_value_string(
        limit,
        &[
            "billing_scope_type",
            "billingScopeType",
            "scope_type",
            "scopeType",
        ],
    )
    .unwrap_or_else(|| "unknown".to_string());
    let team_id = tokenomics_value_string(
        limit,
        &["billing_team_id", "billingTeamId", "team_id", "teamId"],
    )
    .unwrap_or_default();
    let window_kind = tokenomics_value_string(
        limit,
        &["window_kind", "windowKind", "limit_kind", "limitKind"],
    )
    .unwrap_or_else(|| "provider_limit".to_string());
    format!(
        "{scope_type}\u{1f}{team_id}\u{1f}{device_id}\u{1f}{provider}\u{1f}{agent_kind}\u{1f}{account_key}\u{1f}{window_kind}"
    )
}

fn tokenomics_provider_limit_is_unknown(limit: &Value) -> bool {
    let source = tokenomics_value_string(limit, &["limit_source", "limitSource"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    let confidence = tokenomics_value_string(limit, &["confidence"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    let status = tokenomics_value_string(limit, &["status_label", "statusLabel"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    let has_percent = tokenomics_value_i64(
        limit,
        &[
            "remaining_percent",
            "remainingPercent",
            "used_percent",
            "usedPercent",
            "limit_used_percent",
            "limitUsedPercent",
        ],
    )
    .is_some();
    source == "not_exposed"
        || source == "claude_statusline_unavailable"
        || confidence == "unknown"
        || status.contains("not exposed")
        || status.contains("unavailable")
        || !has_percent
}

fn tokenomics_provider_limit_updated_at_unix(limit: &Value) -> u64 {
    tokenomics_value_string(
        limit,
        &[
            "limit_observed_at",
            "limitObservedAt",
            "sample_observed_at",
            "sampleObservedAt",
            "sample_at",
            "sampleAt",
            "updated_at",
            "updatedAt",
            "last_known_at",
            "lastKnownAt",
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
    let fetched_at = tokenomics_value_i64(&cached, &["fetched_at_unix", "fetchedAtUnix"])
        .unwrap_or(0)
        .max(0) as u64;
    if fetched_at == 0 || now_unix.saturating_sub(fetched_at) >= max_age_secs {
        return Ok(None);
    }
    let Some(usage) = cached.get("usage").filter(|value| value.is_object()) else {
        return Ok(None);
    };
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
    object.insert("updatedAt".to_string(), json!(updated_at.clone()));
    object.insert("last_known_at".to_string(), json!(updated_at.clone()));
    object.insert("lastKnownAt".to_string(), json!(updated_at));
}

fn tokenomics_codex_live_usage(
    conn: &rusqlite::Connection,
    plan: &Value,
    provider_account: &TokenomicsProviderAccount,
    allow_stale_cache: bool,
) -> Option<Value> {
    let access_token = plan
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let cache_key = tokenomics_codex_usage_cache_key(provider_account);
    let now_unix = tokenomics_unix_now();
    if let Ok(Some(cached)) = tokenomics_cached_codex_usage(
        conn,
        &cache_key,
        now_unix,
        TOKENOMICS_CODEX_USAGE_CACHE_TTL_SECS,
    ) {
        return Some(cached);
    }
    let fetched = tokenomics_fetch_codex_live_usage(access_token);
    if let Some(mut usage) = fetched {
        tokenomics_mark_usage_updated_at(&mut usage, tokenomics_now_iso_like());
        let _ = tokenomics_store_codex_usage_cache(conn, &cache_key, &usage);
        return Some(usage);
    }
    if !allow_stale_cache {
        return None;
    }
    tokenomics_cached_codex_usage(
        conn,
        &cache_key,
        now_unix,
        TOKENOMICS_CODEX_USAGE_CACHE_STALE_SECS,
    )
    .ok()
    .flatten()
}

fn tokenomics_fetch_codex_live_usage(access_token: &str) -> Option<Value> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let response = client
        .get(TOKENOMICS_CODEX_USAGE_URL)
        .bearer_auth(access_token)
        .header("User-Agent", "DiffForge/0.1 tokenomics")
        .send()
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().ok()
}

fn tokenomics_claude_usage_cache_key(provider_account: &TokenomicsProviderAccount) -> String {
    format!(
        "{TOKENOMICS_CLAUDE_USAGE_CACHE_KEY_PREFIX}{}",
        provider_account.key
    )
}

fn tokenomics_cached_claude_usage(
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
        Err(error) => return Err(format!("Unable to read Claude usage cache: {error}")),
    };
    let cached = serde_json::from_str::<Value>(&text)
        .map_err(|error| format!("Unable to parse Claude usage cache: {error}"))?;
    let fetched_at = tokenomics_value_i64(&cached, &["fetched_at_unix", "fetchedAtUnix"])
        .unwrap_or(0)
        .max(0) as u64;
    if fetched_at == 0 || now_unix.saturating_sub(fetched_at) >= max_age_secs {
        return Ok(None);
    }
    let Some(usage) = cached.get("usage").filter(|value| value.is_object()) else {
        return Ok(None);
    };
    let mut usage = usage.clone();
    tokenomics_mark_usage_updated_at(&mut usage, tokenomics_unix_iso_like(fetched_at));
    Ok(Some(usage))
}

fn tokenomics_store_claude_usage_cache(
    conn: &rusqlite::Connection,
    cache_key: &str,
    usage: &Value,
) -> Result<(), String> {
    let payload = json!({
        "fetched_at_unix": tokenomics_unix_now(),
        "usage": usage,
    });
    conn.execute(
        "INSERT OR REPLACE INTO tokenomics_meta(key, value) VALUES(?1, ?2)",
        rusqlite::params![cache_key, payload.to_string()],
    )
    .map_err(|error| format!("Unable to write Claude usage cache: {error}"))?;
    Ok(())
}

fn tokenomics_claude_live_usage(
    conn: &rusqlite::Connection,
    provider_account: &TokenomicsProviderAccount,
    allow_stale_cache: bool,
) -> Option<Value> {
    let access_token = tokenomics_claude_access_token()?;
    tokenomics_claude_live_usage_with_token(
        conn,
        &access_token,
        provider_account,
        allow_stale_cache,
    )
}

/// Claude live usage with an explicit OAuth token — agent-account profiles
/// read theirs from the profile dir's credentials file (absent on macOS
/// Keychain installs, in which case the caller skips gracefully).
fn tokenomics_claude_live_usage_with_token(
    conn: &rusqlite::Connection,
    access_token: &str,
    provider_account: &TokenomicsProviderAccount,
    allow_stale_cache: bool,
) -> Option<Value> {
    let cache_key = tokenomics_claude_usage_cache_key(provider_account);
    let now_unix = tokenomics_unix_now();
    if let Ok(Some(cached)) = tokenomics_cached_claude_usage(
        conn,
        &cache_key,
        now_unix,
        TOKENOMICS_CLAUDE_USAGE_CACHE_TTL_SECS,
    ) {
        return Some(cached);
    }
    let fetched = tokenomics_fetch_claude_live_usage(access_token);
    if let Some(mut usage) = fetched {
        tokenomics_mark_usage_updated_at(&mut usage, tokenomics_now_iso_like());
        let _ = tokenomics_store_claude_usage_cache(conn, &cache_key, &usage);
        return Some(usage);
    }
    if !allow_stale_cache {
        return None;
    }
    tokenomics_cached_claude_usage(
        conn,
        &cache_key,
        now_unix,
        TOKENOMICS_CLAUDE_USAGE_CACHE_STALE_SECS,
    )
    .ok()
    .flatten()
}

fn tokenomics_fetch_claude_live_usage(access_token: &str) -> Option<Value> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let response = client
        .get(TOKENOMICS_CLAUDE_USAGE_URL)
        .bearer_auth(access_token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("User-Agent", tokenomics_claude_code_user_agent())
        .header("Content-Type", "application/json")
        .send()
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().ok()
}

fn tokenomics_claude_code_user_agent() -> String {
    let version = Command::new("claude")
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            tokenomics_first_semver(stdout.as_ref())
                .or_else(|| tokenomics_first_semver(stderr.as_ref()))
        })
        .unwrap_or_else(|| "2.1.170".to_string());
    format!("claude-code/{version}")
}

fn tokenomics_first_semver(text: &str) -> Option<String> {
    text.split_whitespace().find_map(|part| {
        let clean =
            part.trim_matches(|character: char| !(character.is_ascii_digit() || character == '.'));
        let mut pieces = clean.split('.');
        let major = pieces.next()?;
        let minor = pieces.next()?;
        let patch = pieces.next()?;
        if pieces.next().is_some()
            || major.is_empty()
            || minor.is_empty()
            || patch.is_empty()
            || !major.chars().all(|character| character.is_ascii_digit())
            || !minor.chars().all(|character| character.is_ascii_digit())
            || !patch.chars().all(|character| character.is_ascii_digit())
        {
            return None;
        }
        Some(format!("{major}.{minor}.{patch}"))
    })
}

fn tokenomics_codex_live_limit_snapshots(
    plan: &Value,
    usage: &Value,
    provider_account: &TokenomicsProviderAccount,
) -> Vec<Value> {
    let mut limits = Vec::new();
    let plan_name = usage
        .get("plan_type")
        .and_then(Value::as_str)
        .map(tokenomics_codex_plan_label)
        .unwrap_or_else(|| {
            plan.get("plan_name")
                .and_then(Value::as_str)
                .unwrap_or("ChatGPT plan")
                .to_string()
        });
    let updated_at = tokenomics_value_string(
        usage,
        &["updated_at", "updatedAt", "last_known_at", "lastKnownAt"],
    )
    .unwrap_or_else(tokenomics_now_iso_like);
    if let Some(rate_limit) = usage.get("rate_limit") {
        if let Some(primary) = rate_limit.get("primary_window") {
            limits.push(tokenomics_codex_window_snapshot(
                "5_hour",
                "5-Hour Session",
                &plan_name,
                "codex_usage_api",
                primary,
                rate_limit,
                updated_at.as_str(),
                provider_account,
            ));
        }
        if let Some(secondary) = rate_limit.get("secondary_window") {
            limits.push(tokenomics_codex_window_snapshot(
                "weekly",
                "Weekly Limit",
                &plan_name,
                "codex_usage_api",
                secondary,
                rate_limit,
                updated_at.as_str(),
                provider_account,
            ));
        }
    }
    if limits.is_empty() {
        limits.push(tokenomics_unknown_limit_snapshot(
            "openai",
            "codex",
            provider_account,
            &json!({
                "plan_detected": true,
                "plan_name": plan_name,
                "plan_source": "codex_usage_api",
            }),
            "5_hour",
            "5-Hour Session",
        ));
        limits.push(tokenomics_unknown_limit_snapshot(
            "openai",
            "codex",
            provider_account,
            &json!({
                "plan_detected": true,
                "plan_name": plan_name,
                "plan_source": "codex_usage_api",
            }),
            "weekly",
            "Weekly Limit",
        ));
    }
    limits
}

fn tokenomics_codex_plan_label(plan_type: &str) -> String {
    match plan_type.trim().to_ascii_lowercase().as_str() {
        "plus" => "ChatGPT Plus".to_string(),
        "pro" => "ChatGPT Pro".to_string(),
        "team" => "ChatGPT Team".to_string(),
        "enterprise" => "ChatGPT Enterprise".to_string(),
        other if !other.is_empty() => format!("ChatGPT {}", tokenomics_title_case(other)),
        _ => "ChatGPT plan".to_string(),
    }
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

fn tokenomics_limit_display_percent_kind(
    provider: &str,
    agent_kind: &str,
    window_kind: &str,
) -> &'static str {
    if (provider == "openai" && agent_kind == "codex")
        || (provider == "anthropic" && agent_kind == "claude")
    {
        "remaining"
    } else if window_kind == "weekly" {
        "remaining"
    } else {
        "used"
    }
}

fn tokenomics_limit_display_percent(
    provider: &str,
    agent_kind: &str,
    window_kind: &str,
    used_percent: i64,
    remaining_percent: i64,
) -> i64 {
    if tokenomics_limit_display_percent_kind(provider, agent_kind, window_kind) == "remaining" {
        remaining_percent
    } else {
        used_percent
    }
}

fn tokenomics_limit_pace_snapshot(
    used_percent: i64,
    limit_window_seconds: i64,
    reset_after_seconds: Option<i64>,
    reset_at_unix: Option<u64>,
    updated_at: &str,
) -> Value {
    let window_seconds = limit_window_seconds.max(0) as u64;
    if window_seconds == 0 {
        return tokenomics_unknown_pace_snapshot();
    }

    let updated_at_unix = tokenomics_timestamp_unix(updated_at).unwrap_or_else(tokenomics_unix_now);
    let remaining_seconds = reset_after_seconds
        .map(|value| value.max(0) as u64)
        .or_else(|| reset_at_unix.map(|reset_at| reset_at.saturating_sub(updated_at_unix)));
    let Some(remaining_seconds) = remaining_seconds else {
        return tokenomics_unknown_pace_snapshot();
    };

    let remaining_seconds = remaining_seconds.min(window_seconds);
    let elapsed_seconds = window_seconds.saturating_sub(remaining_seconds);
    let elapsed_for_rate = elapsed_seconds.max(1) as f64;
    let used_percent = used_percent.clamp(0, 100) as f64;
    let projected_used_percent = if used_percent <= 0.0 {
        0.0
    } else {
        (used_percent / elapsed_for_rate) * window_seconds as f64
    };
    let projected_used_percent = projected_used_percent.round().clamp(0.0, 999.0) as i64;
    let pace_delta_percent = projected_used_percent - 100;
    let expected_used_percent = ((elapsed_seconds as f64 / window_seconds as f64) * 100.0)
        .round()
        .clamp(0.0, 100.0) as i64;
    let exhausts_before_reset = if used_percent >= 100.0 {
        true
    } else if used_percent <= 0.0 {
        false
    } else {
        let seconds_to_full = (elapsed_for_rate * (100.0 / used_percent)).ceil();
        seconds_to_full <= window_seconds as f64
    };
    let projected_exhaustion_seconds = if used_percent >= 100.0 {
        Some(0_i64)
    } else if exhausts_before_reset {
        let seconds_to_full = (elapsed_for_rate * (100.0 / used_percent)).ceil() as i64;
        Some((seconds_to_full - elapsed_seconds as i64).max(0))
    } else {
        None
    };
    let projected_exhaustion_at = projected_exhaustion_seconds
        .map(|seconds| tokenomics_unix_iso_like(updated_at_unix.saturating_add(seconds as u64)));
    let reset_at = tokenomics_unix_iso_like(updated_at_unix.saturating_add(remaining_seconds));
    let pace_status = if exhausts_before_reset {
        "over_pace"
    } else {
        "on_pace"
    };

    json!({
        "pace_delta_percent": pace_delta_percent,
        "paceDeltaPercent": pace_delta_percent,
        "pace_status": pace_status,
        "paceStatus": pace_status,
        "pace_exhausts_before_reset": exhausts_before_reset,
        "paceExhaustsBeforeReset": exhausts_before_reset,
        "pace_expected_used_percent": expected_used_percent,
        "paceExpectedUsedPercent": expected_used_percent,
        "pace_window_elapsed_percent": expected_used_percent,
        "paceWindowElapsedPercent": expected_used_percent,
        "pace_projected_used_percent": projected_used_percent,
        "paceProjectedUsedPercent": projected_used_percent,
        "pace_projected_exhaustion_seconds": projected_exhaustion_seconds,
        "paceProjectedExhaustionSeconds": projected_exhaustion_seconds,
        "pace_projected_exhaustion_at": projected_exhaustion_at,
        "paceProjectedExhaustionAt": projected_exhaustion_at,
        "pace_reset_at": reset_at,
        "paceResetAt": reset_at,
    })
}

fn tokenomics_unknown_pace_snapshot() -> Value {
    json!({
        "pace_delta_percent": 0,
        "paceDeltaPercent": 0,
        "pace_status": "unknown",
        "paceStatus": "unknown",
        "pace_exhausts_before_reset": false,
        "paceExhaustsBeforeReset": false,
        "pace_expected_used_percent": Value::Null,
        "paceExpectedUsedPercent": Value::Null,
        "pace_window_elapsed_percent": Value::Null,
        "paceWindowElapsedPercent": Value::Null,
        "pace_projected_used_percent": Value::Null,
        "paceProjectedUsedPercent": Value::Null,
        "pace_projected_exhaustion_seconds": Value::Null,
        "paceProjectedExhaustionSeconds": Value::Null,
        "pace_projected_exhaustion_at": Value::Null,
        "paceProjectedExhaustionAt": Value::Null,
        "pace_reset_at": Value::Null,
        "paceResetAt": Value::Null,
    })
}

fn tokenomics_with_pace_fields(mut snapshot: Value, pace: Value) -> Value {
    let Some(snapshot_object) = snapshot.as_object_mut() else {
        return snapshot;
    };
    let Some(pace_object) = pace.as_object() else {
        return snapshot;
    };
    for (key, value) in pace_object {
        snapshot_object.insert(key.clone(), value.clone());
    }
    snapshot
}

fn tokenomics_codex_window_snapshot(
    window_kind: &str,
    label: &str,
    plan_name: &str,
    plan_source: &str,
    window: &Value,
    rate_limit: &Value,
    updated_at: &str,
    provider_account: &TokenomicsProviderAccount,
) -> Value {
    let used_percent = tokenomics_value_i64(window, &["used_percent", "usedPercent"])
        .unwrap_or(0)
        .clamp(0, 100);
    let remaining_percent = (100 - used_percent).clamp(0, 100);
    let display_percent_kind =
        tokenomics_limit_display_percent_kind("openai", "codex", window_kind);
    let display_percent = tokenomics_limit_display_percent(
        "openai",
        "codex",
        window_kind,
        used_percent,
        remaining_percent,
    );
    let reset_after_seconds_value =
        tokenomics_value_i64(window, &["reset_after_seconds", "resetAfterSeconds"]);
    let reset_after_seconds = reset_after_seconds_value.unwrap_or(0);
    let reset_at = tokenomics_value_i64(window, &["reset_at", "resetAt"]);
    let limit_window_seconds_value =
        tokenomics_value_i64(window, &["limit_window_seconds", "limitWindowSeconds"]);
    let limit_window_seconds =
        tokenomics_limit_effective_window_seconds(window_kind, limit_window_seconds_value);
    let pace = tokenomics_limit_pace_snapshot(
        used_percent,
        limit_window_seconds,
        reset_after_seconds_value,
        reset_at.map(tokenomics_normalize_unix_timestamp),
        updated_at,
    );
    let limit_reached = rate_limit
        .get("limit_reached")
        .or_else(|| rate_limit.get("limitReached"))
        .and_then(Value::as_bool)
        .unwrap_or(remaining_percent <= 0);
    let allowed = rate_limit
        .get("allowed")
        .and_then(Value::as_bool)
        .unwrap_or(!limit_reached);
    tokenomics_with_pace_fields(
        json!({
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": provider_account.key.as_str(),
            "provider_account_label": provider_account.label.as_str(),
            "subscription_key": provider_account.key.as_str(),
            "label": label,
            "window_kind": window_kind,
            "plan_detected": true,
            "plan_name": plan_name,
            "plan_source": plan_source,
            "limit_source": "codex_usage_api",
            "confidence": "live",
            "allowance_unit": "percent",
            "used": used_percent,
            "allowance": 100,
            "remaining": remaining_percent,
            "used_percent": used_percent,
            "remaining_percent": remaining_percent,
            "display_percent": display_percent,
            "displayPercent": display_percent,
            "limit_display_percent": display_percent,
            "limitDisplayPercent": display_percent,
            "display_percent_kind": display_percent_kind,
            "displayPercentKind": display_percent_kind,
            "limit_display_percent_kind": display_percent_kind,
            "limitDisplayPercentKind": display_percent_kind,
            "status_label": tokenomics_codex_status_label(remaining_percent, limit_reached, allowed),
            "reset_label": tokenomics_reset_label(reset_at, reset_after_seconds),
            "reset_after_seconds": reset_after_seconds,
            "reset_at": reset_at,
            "limit_window_seconds": limit_window_seconds,
            "updated_at": updated_at,
            "last_known_at": updated_at,
            "rate_points": [],
        }),
        pace,
    )
}

fn tokenomics_ensure_claude_statusline_collector(plan: &Value) -> Result<(), String> {
    if !plan
        .get("plan_detected")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Ok(());
    }
    let Some(home) = env::var("HOME").ok().map(PathBuf::from) else {
        return Ok(());
    };
    let claude_dir = home.join(".claude");
    fs::create_dir_all(&claude_dir)
        .map_err(|error| format!("Unable to create Claude config directory: {error}"))?;
    let collector_path = claude_dir.join("diffforge-statusline.cjs");
    let cache_path = claude_dir.join("diffforge-rate-limits.json");
    let collector = format!(
        r#"const fs = require("fs");
const input = [];
process.stdin.on("data", chunk => input.push(chunk));
process.stdin.on("end", () => {{
  try {{
    const payload = JSON.parse(Buffer.concat(input).toString("utf8") || "{{}}");
    if (payload && payload.rate_limits) {{
      const out = {{
        updated_at: new Date().toISOString(),
        session_id: payload.session_id || payload.sessionId || null,
        transcript_path: payload.transcript_path || payload.transcriptPath || null,
        cwd: payload.cwd || null,
        version: payload.version || null,
        model: payload.model || null,
        rate_limits: payload.rate_limits
      }};
      fs.writeFileSync({cache:?}, JSON.stringify(out, null, 2));
    }}
  }} catch (_) {{}}
}});
"#,
        cache = cache_path.display().to_string()
    );
    let should_write = fs::read_to_string(&collector_path)
        .map(|current| current != collector)
        .unwrap_or(true);
    if should_write {
        fs::write(&collector_path, collector)
            .map_err(|error| format!("Unable to write Claude statusline collector: {error}"))?;
    }

    let settings_path = claude_dir.join("settings.json");
    let mut settings = fs::read_to_string(&settings_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| json!({}));
    let status_command = settings
        .get("statusLine")
        .and_then(|value| value.get("command"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if !status_command.trim().is_empty() && !status_command.contains("diffforge-statusline") {
        return Ok(());
    }
    let command = format!("node \"{}\"", collector_path.display());
    if status_command == command {
        return Ok(());
    }
    if let Some(object) = settings.as_object_mut() {
        object.insert(
            "statusLine".to_string(),
            json!({
                "type": "command",
                "command": command,
            }),
        );
    }
    let body = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("Unable to serialize Claude settings: {error}"))?;
    fs::write(&settings_path, body)
        .map_err(|error| format!("Unable to update Claude settings for Tokenomics: {error}"))?;
    Ok(())
}

fn tokenomics_claude_live_limit_snapshots(
    plan: &Value,
    usage: &Value,
    provider_account: &TokenomicsProviderAccount,
) -> Vec<Value> {
    let plan_name = plan
        .get("plan_name")
        .and_then(Value::as_str)
        .unwrap_or("Claude account signed in");
    let updated_at = tokenomics_value_string(
        usage,
        &["updated_at", "updatedAt", "last_known_at", "lastKnownAt"],
    )
    .unwrap_or_else(tokenomics_now_iso_like);
    let mut limits = Vec::new();
    if let Some(five_hour) = usage
        .get("five_hour")
        .or_else(|| usage.get("fiveHour"))
        .filter(|value| value.is_object())
    {
        limits.push(tokenomics_claude_window_snapshot(
            "5_hour",
            "5-Hour Session",
            plan_name,
            "claude_oauth_usage_api",
            five_hour,
            updated_at.as_str(),
            provider_account,
        ));
    }
    if let Some(seven_day) = usage
        .get("seven_day")
        .or_else(|| usage.get("sevenDay"))
        .filter(|value| value.is_object())
    {
        limits.push(tokenomics_claude_window_snapshot(
            "weekly",
            "Weekly Limit",
            plan_name,
            "claude_oauth_usage_api",
            seven_day,
            updated_at.as_str(),
            provider_account,
        ));
    }
    limits
}

fn tokenomics_claude_statusline_limits(
    plan: &Value,
    provider_account: &TokenomicsProviderAccount,
) -> Option<Vec<Value>> {
    let home = env::var("HOME").ok().map(PathBuf::from)?;
    let cache_path = home.join(".claude").join("diffforge-rate-limits.json");
    let cache_modified = fs::metadata(&cache_path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| tokenomics_unix_iso_like(duration.as_secs()));
    let text = fs::read_to_string(cache_path).ok()?;
    let cache = serde_json::from_str::<Value>(&text).ok()?;
    let rate_limits = cache.get("rate_limits")?;
    let plan_name = plan
        .get("plan_name")
        .and_then(Value::as_str)
        .unwrap_or("Claude account signed in");
    let updated_at = cache
        .get("updated_at")
        .or_else(|| cache.get("updatedAt"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or(cache_modified)
        .unwrap_or_else(tokenomics_now_iso_like);
    let mut limits = Vec::new();
    if let Some(five_hour) = rate_limits
        .get("five_hour")
        .or_else(|| rate_limits.get("fiveHour"))
    {
        limits.push(tokenomics_claude_window_snapshot(
            "5_hour",
            "5-Hour Session",
            plan_name,
            "claude_statusline",
            five_hour,
            updated_at.as_str(),
            provider_account,
        ));
    }
    if let Some(seven_day) = rate_limits
        .get("seven_day")
        .or_else(|| rate_limits.get("sevenDay"))
    {
        limits.push(tokenomics_claude_window_snapshot(
            "weekly",
            "Weekly Limit",
            plan_name,
            "claude_statusline",
            seven_day,
            updated_at.as_str(),
            provider_account,
        ));
    }
    if limits.is_empty() {
        None
    } else {
        Some(limits)
    }
}

fn tokenomics_claude_window_snapshot(
    window_kind: &str,
    label: &str,
    plan_name: &str,
    limit_source: &str,
    window: &Value,
    updated_at: &str,
    provider_account: &TokenomicsProviderAccount,
) -> Value {
    let provider_reported_percent = tokenomics_value_i64(
        window,
        &[
            "used_percentage",
            "usedPercentage",
            "utilization",
            "used_percent",
            "usedPercent",
        ],
    )
    .unwrap_or(0)
    .clamp(0, 100);
    let used_percent = provider_reported_percent;
    let remaining_percent = (100 - used_percent).clamp(0, 100);
    let display_percent_kind =
        tokenomics_limit_display_percent_kind("anthropic", "claude", window_kind);
    let display_percent = tokenomics_limit_display_percent(
        "anthropic",
        "claude",
        window_kind,
        used_percent,
        remaining_percent,
    );
    let reset_at = tokenomics_value_string(
        window,
        &[
            "resets_at",
            "resetsAt",
            "reset_at",
            "resetAt",
            "limit_resets_at",
            "limitResetsAt",
        ],
    );
    let limit_window_seconds = if window_kind == "5_hour" {
        5 * 60 * 60
    } else {
        7 * 24 * 60 * 60
    };
    let reset_at_unix = reset_at.as_deref().and_then(tokenomics_timestamp_unix);
    let reset_after_seconds = reset_at_unix.map(|reset_at| {
        let updated_at_unix =
            tokenomics_timestamp_unix(updated_at).unwrap_or_else(tokenomics_unix_now);
        reset_at
            .saturating_sub(updated_at_unix)
            .min(i64::MAX as u64) as i64
    });
    let reset_label = tokenomics_reset_label(
        reset_at_unix.map(|value| value.min(i64::MAX as u64) as i64),
        reset_after_seconds.unwrap_or(0),
    );
    let pace = tokenomics_limit_pace_snapshot(
        used_percent,
        limit_window_seconds,
        reset_after_seconds,
        reset_at_unix,
        updated_at,
    );
    tokenomics_with_pace_fields(
        json!({
            "provider": "anthropic",
            "agent_kind": "claude",
            "provider_account_key": provider_account.key.as_str(),
            "provider_account_label": provider_account.label.as_str(),
            "subscription_key": provider_account.key.as_str(),
            "label": label,
            "window_kind": window_kind,
            "plan_detected": true,
            "plan_name": plan_name,
            "plan_source": "claude_credentials_file",
            "limit_source": limit_source,
            "confidence": "live",
            "allowance_unit": "percent",
            "used": used_percent,
            "allowance": 100,
            "remaining": remaining_percent,
            "used_percent": used_percent,
            "remaining_percent": remaining_percent,
            "display_percent": display_percent,
            "displayPercent": display_percent,
            "limit_display_percent": display_percent,
            "limitDisplayPercent": display_percent,
            "display_percent_kind": display_percent_kind,
            "displayPercentKind": display_percent_kind,
            "limit_display_percent_kind": display_percent_kind,
            "limitDisplayPercentKind": display_percent_kind,
            "provider_reported_percent": provider_reported_percent,
            "provider_reported_direction": "used",
            "status_label": tokenomics_claude_status_label(remaining_percent),
            "reset_label": reset_label,
            "reset_after_seconds": reset_after_seconds,
            "reset_at": reset_at.clone(),
            "resetAt": reset_at.clone(),
            "limit_resets_at": reset_at,
            "limit_window_seconds": limit_window_seconds,
            "updated_at": updated_at,
            "last_known_at": updated_at,
            "rate_points": [],
        }),
        pace,
    )
}

fn tokenomics_claude_status_label(remaining_percent: i64) -> &'static str {
    if remaining_percent <= 0 {
        "Limit reached"
    } else if remaining_percent < 18 {
        "Almost depleted"
    } else if remaining_percent < 38 {
        "Watch current pace"
    } else {
        "Available"
    }
}

fn tokenomics_unknown_limit_snapshot(
    provider: &str,
    agent_kind: &str,
    provider_account: &TokenomicsProviderAccount,
    plan: &Value,
    window_kind: &str,
    label: &str,
) -> Value {
    let is_claude = provider == "anthropic" && agent_kind == "claude";
    let (limit_source, status_label) = if is_claude {
        (
            "claude_statusline_unavailable",
            "Live Claude Code limits unavailable",
        )
    } else {
        ("not_exposed", "Plan limit not exposed")
    };
    let reset_label = if is_claude {
        if window_kind == "5_hour" {
            "Open Claude Code to publish live limits"
        } else {
            "Claude Code has not reported its weekly window"
        }
    } else if window_kind == "5_hour" {
        "Provider limit unavailable"
    } else {
        "Provider schedule unavailable"
    };
    tokenomics_with_pace_fields(
        json!({
            "provider": provider,
            "agent_kind": agent_kind,
            "provider_account_key": provider_account.key.as_str(),
            "provider_account_label": provider_account.label.as_str(),
            "subscription_key": provider_account.key.as_str(),
            "label": label,
            "window_kind": window_kind,
            "plan_detected": plan.get("plan_detected").cloned().unwrap_or(Value::Bool(false)),
            "plan_name": plan.get("plan_name").cloned().unwrap_or(Value::String("Unknown".to_string())),
            "plan_source": plan.get("plan_source").cloned().unwrap_or(Value::String("local".to_string())),
            "limit_source": limit_source,
            "confidence": "unknown",
            "allowance_unit": "unknown",
            "used": Value::Null,
            "allowance": Value::Null,
            "remaining": Value::Null,
            "used_percent": Value::Null,
            "remaining_percent": Value::Null,
            "display_percent": Value::Null,
            "displayPercent": Value::Null,
            "limit_display_percent": Value::Null,
            "limitDisplayPercent": Value::Null,
            "display_percent_kind": tokenomics_limit_display_percent_kind(provider, agent_kind, window_kind),
            "displayPercentKind": tokenomics_limit_display_percent_kind(provider, agent_kind, window_kind),
            "limit_display_percent_kind": tokenomics_limit_display_percent_kind(provider, agent_kind, window_kind),
            "limitDisplayPercentKind": tokenomics_limit_display_percent_kind(provider, agent_kind, window_kind),
            "status_label": status_label,
            "reset_label": reset_label,
            "rate_points": [],
        }),
        tokenomics_unknown_pace_snapshot(),
    )
}

fn tokenomics_codex_status_label(
    remaining_percent: i64,
    limit_reached: bool,
    allowed: bool,
) -> &'static str {
    if limit_reached || !allowed || remaining_percent <= 0 {
        "Limit reached"
    } else if remaining_percent < 18 {
        "Almost depleted"
    } else if remaining_percent < 38 {
        "Watch current pace"
    } else {
        "Available"
    }
}

fn tokenomics_reset_label(reset_at: Option<i64>, reset_after_seconds: i64) -> String {
    if reset_after_seconds > 0 {
        return format!(
            "Resets in {}",
            tokenomics_format_duration(reset_after_seconds as u64)
        );
    }
    if let Some(reset_at) = reset_at.filter(|value| *value > 0) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0);
        if reset_at > now {
            return format!(
                "Resets in {}",
                tokenomics_format_duration((reset_at - now) as u64)
            );
        }
    }
    "Reset time unavailable".to_string()
}

fn tokenomics_format_duration(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    if hours > 0 {
        format!("{hours}h {minutes}m")
    } else {
        format!("{minutes}m")
    }
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

fn tokenomics_codex_plan_state() -> Value {
    tokenomics_codex_plan_state_for_auth_path(
        env::var("HOME")
            .ok()
            .map(PathBuf::from)
            .map(|home| home.join(".codex").join("auth.json")),
    )
}

/// Codex plan state from an explicit auth.json path — agent-account profiles
/// each carry their own auth, so their live usage is queried per account.
fn tokenomics_codex_plan_state_for_auth_path(auth_path: Option<PathBuf>) -> Value {
    let auth = auth_path
        .as_ref()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let auth_mode = auth
        .as_ref()
        .and_then(|value| value.get("auth_mode"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let has_api_key = auth
        .as_ref()
        .and_then(|value| value.get("OPENAI_API_KEY"))
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let access_token = auth
        .as_ref()
        .and_then(|value| value.get("tokens"))
        .and_then(|value| value.get("access_token"))
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let plan_detected = auth_mode.eq_ignore_ascii_case("chatgpt") || has_api_key;
    json!({
        "plan_detected": plan_detected,
        "plan_name": if auth_mode.eq_ignore_ascii_case("chatgpt") {
            "ChatGPT plan"
        } else if has_api_key {
            "OpenAI API"
        } else {
            "No Codex auth detected"
        },
        "plan_source": if auth.is_some() { "codex_auth_file" } else { "not_found" },
        "access_token": access_token,
    })
}

fn tokenomics_claude_plan_state() -> Value {
    let credentials_path = env::var("HOME")
        .ok()
        .map(PathBuf::from)
        .map(|home| home.join(".claude").join(".credentials.json"));
    let credentials = credentials_path
        .as_ref()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    tokenomics_claude_plan_state_from_credentials(credentials.as_ref())
}

fn tokenomics_claude_access_token() -> Option<String> {
    let home = tokenomics_home_dir()?;
    let credentials = tokenomics_read_json_file(home.join(".claude").join(".credentials.json"))?;
    credentials
        .get("claudeAiOauth")
        .and_then(|oauth| tokenomics_value_string(oauth, &["accessToken", "access_token"]))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn tokenomics_claude_plan_state_from_credentials(credentials: Option<&Value>) -> Value {
    let has_oauth = credentials
        .and_then(|value| value.get("claudeAiOauth"))
        .map(|value| !value.is_null())
        .unwrap_or(false);
    let subscription_type = credentials
        .and_then(|value| value.get("claudeAiOauth"))
        .and_then(|oauth| {
            tokenomics_value_string(oauth, &["subscriptionType", "subscription_type"])
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let rate_limit_tier = credentials
        .and_then(|value| value.get("claudeAiOauth"))
        .and_then(|oauth| tokenomics_value_string(oauth, &["rateLimitTier", "rate_limit_tier"]))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let plan_name = if let Some(subscription_type) = subscription_type.as_deref() {
        tokenomics_claude_subscription_label(subscription_type)
    } else if has_oauth {
        "Claude account signed in".to_string()
    } else {
        "No Claude auth detected".to_string()
    };
    json!({
        "plan_detected": has_oauth,
        "account_detected": has_oauth,
        "plan_name": plan_name,
        "plan_source": if credentials.is_some() { "claude_credentials_file" } else { "not_found" },
        "subscription_type": subscription_type,
        "rate_limit_tier": rate_limit_tier,
    })
}

fn tokenomics_claude_subscription_label(subscription_type: &str) -> String {
    let normalized = subscription_type.trim();
    if normalized.is_empty() {
        return "Claude account signed in".to_string();
    }
    let lower = normalized.to_ascii_lowercase();
    match lower.as_str() {
        "free" => "Claude Free".to_string(),
        "pro" => "Claude Pro".to_string(),
        "max" => "Claude Max".to_string(),
        "team" => "Claude Team".to_string(),
        "enterprise" => "Claude Enterprise".to_string(),
        "api" => "Claude API".to_string(),
        _ => format!("Claude {}", tokenomics_title_case(normalized)),
    }
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

    fn tokenomics_test_current_hour_bucket() -> String {
        tokenomics_utc_hour_bucket_from_unix(tokenomics_unix_now()).1
    }

    #[test]
    fn tokenomics_buckets_parse_legacy_hour_only_timestamp() {
        let (day, hour) = tokenomics_buckets("2026-05-17T05");
        assert_eq!(day, "2026-05-17");
        assert_eq!(hour, "2026-05-17T05:00:00Z");
    }

    #[test]
    fn tokenomics_rollup_rebuild_normalizes_legacy_event_buckets() {
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
        assert!(
            columns
                .iter()
                .any(|column| column == "provider_account_key")
        );
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
    fn tokenomics_reconcile_preserves_completed_codex_state_scan() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        tokenomics_upsert_scan_state(
            &conn,
            "openai",
            "codex",
            "/tmp/state_5.sqlite",
            TOKENOMICS_CODEX_SCANNER_VERSION,
            true,
            123_456,
        )
        .unwrap();

        tokenomics_reconcile_codex_provider_before_scan(&conn).unwrap();

        let state =
            tokenomics_get_scan_state(&conn, "openai", "codex", "/tmp/state_5.sqlite").unwrap();
        let state = state.expect("scan state should remain");
        assert!(state.initial_backfill_done);
        assert_eq!(state.last_event_timestamp, 123_456);
    }

    #[test]
    fn tokenomics_reconcile_clears_legacy_codex_rows_before_scan() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        tokenomics_upsert_scan_state(
            &conn,
            "openai",
            "codex",
            "/tmp/state_5.sqlite",
            TOKENOMICS_CODEX_SCANNER_VERSION,
            true,
            123_456,
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tokenomics_usage_events(
               id, provider, agent_kind, model, subscription_key, workspace_id, repo_path,
               source_kind, source_path, bucket_day, bucket_hour, input_tokens, output_tokens,
               cache_read_tokens, cache_write_tokens, total_tokens, estimated_cost_microusd,
               created_at, observed_at
             ) VALUES(
               'legacy-event', 'openai', 'codex', NULL, NULL, NULL, NULL,
               'manual', NULL, '2026-05-30', '2026-05-30T04', 1, 1,
               0, 0, 2, 0, '2026-05-30T04:00:00Z', '2026-05-30T04:00:00Z'
             )",
            [],
        )
        .unwrap();

        tokenomics_reconcile_codex_provider_before_scan(&conn).unwrap();

        let event_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tokenomics_usage_events", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(event_count, 0);
        let state =
            tokenomics_get_scan_state(&conn, "openai", "codex", "/tmp/state_5.sqlite").unwrap();
        assert!(state.is_none());
    }

    #[test]
    fn tokenomics_codex_usage_cache_reuses_fresh_weekly_snapshot() {
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
    fn tokenomics_codex_usage_cache_expires_after_stale_window() {
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
    fn tokenomics_scan_day_progress_is_bounded_to_single_backfill_window() {
        let now = 1_800_000_000u64;
        let cutoff = now - TOKENOMICS_INITIAL_BACKFILL_DAYS * 86_400;

        let oldest = tokenomics_scan_day_progress(cutoff, cutoff, now);
        let newer = tokenomics_scan_day_progress(cutoff + 86_400, cutoff, now);
        let future = tokenomics_scan_day_progress(now + 86_400, cutoff, now);

        assert_eq!(oldest.0, 1);
        assert_eq!(oldest.1, TOKENOMICS_INITIAL_BACKFILL_DAYS);
        assert_eq!(newer.0, 2);
        assert_eq!(future.0, TOKENOMICS_INITIAL_BACKFILL_DAYS);
        assert_eq!(future.2, "today");
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
        assert!(
            accounts
                .iter()
                .any(|row| row["provider_account_key"] == json!("openai:codex:acct-a"))
        );
    }

    #[test]
    fn tokenomics_account_sync_rollups_collapse_workspace_metadata() {
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
    fn tokenomics_summary_separates_same_provider_accounts() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();

        for (account_key, account_label, input_tokens) in [
            ("openai:codex:personal", "Codex personal", 10_i64),
            ("openai:codex:work", "Codex work", 30_i64),
        ] {
            tokenomics_record_usage_value(
                &conn,
                &json!({
                    "provider": "openai",
                    "agent_kind": "codex",
                    "provider_account_key": account_key,
                    "provider_account_label": account_label,
                    "model": "gpt-5.5",
                    "created_at": "2026-05-30T05:00:00Z",
                    "input_tokens": input_tokens,
                    "output_tokens": 1,
                }),
                "test",
            )
            .unwrap();
        }

        let summary = tokenomics_summary_from_conn(&conn, false, None).unwrap();
        let hourly = summary["hourly"].as_array().unwrap();
        let provider_accounts = summary["provider_accounts"].as_array().unwrap();

        assert_eq!(summary["schema_version"], json!("tokenomics_v2"));
        assert_eq!(summary["total"]["total_tokens"], json!(42));
        assert!(hourly.iter().any(|row| row["provider_account_key"]
            == json!("openai:codex:personal")
            && row["total_tokens"] == json!(11)
            && row["replacement"] == json!(true)));
        assert!(hourly.iter().any(
            |row| row["provider_account_key"] == json!("openai:codex:work")
                && row["total_tokens"] == json!(31)
                && row["replacement"] == json!(true)
        ));
        assert!(
            provider_accounts
                .iter()
                .any(|row| row["provider_account_key"] == json!("openai:codex:personal"))
        );
        assert!(
            provider_accounts
                .iter()
                .any(|row| row["provider_account_key"] == json!("openai:codex:work"))
        );
        for legacy_key in [
            "by_device",
            "by_device_provider",
            "by_device_account",
            "by_device_model",
            "daily",
            "monthly",
            "monthly_by_device_provider",
            "by_provider",
            "by_account",
            "by_model",
            "daily_by_provider",
            "monthly_by_provider",
            "hourly_by_provider",
            "session_hourly_by_provider",
            "accounts",
            "rollups",
        ] {
            assert!(summary.get(legacy_key).is_none());
        }
    }

    #[test]
    fn tokenomics_existing_source_identity_reuses_historical_codex_provider() {
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
    fn tokenomics_local_json_scan_ignores_embedded_device_ids() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let provider_account = TokenomicsProviderAccount {
            key: "anthropic:claude:personal".to_string(),
            label: "Claude personal".to_string(),
        };

        let inserted = tokenomics_record_usage_json_tree(
            &conn,
            "anthropic",
            "claude",
            &provider_account,
            Some(Path::new("/tmp/claude.jsonl")),
            Some(0),
            &json!({
                "device_id": "macos-shadow-device",
                "message": {
                    "machineId": "macos-other-shadow",
                    "usage": {
                        "input_tokens": 10,
                        "output_tokens": 5
                    }
                }
            }),
        )
        .unwrap();

        assert_eq!(inserted, 1);
        let device_id: String = conn
            .query_row("SELECT device_id FROM tokenomics_usage_events", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(device_id, tokenomics_local_device_id());
    }

    #[test]
    fn tokenomics_summary_uses_hourly_replacements_without_day_double_counting() {
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
        assert_eq!(summary["daily_by_device_provider"][0]["total_tokens"], json!(12));
        assert_eq!(
            summary["hourly"][0]["provider_account_key"],
            json!("openai:codex:work")
        );
        assert_eq!(summary["hourly"][0]["replacement"], json!(true));
        assert!(summary.get("daily").is_none());
    }

    #[test]
    fn tokenomics_summary_v2_includes_rolling_daily_rows_without_legacy_monthly() {
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
        assert_eq!(daily.len(), TOKENOMICS_INITIAL_BACKFILL_DAYS as usize);
        assert!(summary.get("daily").is_none());
        assert!(summary.get("monthly").is_none());
        assert!(summary.get("monthly_by_device_provider").is_none());
        assert_eq!(summary["total"]["total_tokens"], json!(0));
    }

    #[test]
    fn tokenomics_account_sync_rollups_preserve_provider_accounts() {
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
    fn tokenomics_account_sync_rollups_preserve_scope_and_include_unknown() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();

        for usage in [
            json!({
                "provider": "openai",
                "agent_kind": "codex",
                "provider_account_key": "openai:codex:stable-account",
                "provider_account_label": "Codex stable",
                "billing_scope_type": "personal",
                "billing_scope_source": "test",
                "model": "gpt-5.5",
                "created_at": "2026-05-30T05:00:00Z",
                "input_tokens": 5,
            }),
            json!({
                "provider": "openai",
                "agent_kind": "codex",
                "provider_account_key": "openai:codex:stable-account",
                "provider_account_label": "Codex stable",
                "billing_scope_type": "team",
                "billing_team_id": "team-a",
                "billing_scope_source": "test",
                "model": "gpt-5.5",
                "created_at": "2026-05-30T06:00:00Z",
                "input_tokens": 7,
            }),
            json!({
                "provider": "openai",
                "agent_kind": "codex",
                "provider_account_key": "openai:codex:stable-account",
                "provider_account_label": "Codex stable",
                "model": "gpt-5.5",
                "created_at": "2026-05-30T07:00:00Z",
                "input_tokens": 3,
            }),
        ] {
            tokenomics_record_usage_value(&conn, &usage, "test").unwrap();
        }

        let all_rollups = tokenomics_account_hourly_sync_rollups(&conn, None, None).unwrap();
        assert_eq!(all_rollups.len(), 3);
        assert!(all_rollups.iter().any(|row| {
            row["billing_scope_key"] == json!("personal") && row["total_tokens"] == json!(5)
        }));
        assert!(all_rollups.iter().any(|row| {
            row["billing_scope_key"] == json!("team:team-a") && row["total_tokens"] == json!(7)
        }));
        assert!(all_rollups.iter().any(|row| {
            row["billing_scope_key"] == json!("unknown")
                && row["billing_scope_type"] == json!("unknown")
                && row["total_tokens"] == json!(3)
        }));

        let personal_scope = tokenomics_billing_scope_from_parts(Some("personal"), None, "test");
        let personal_rollups =
            tokenomics_account_hourly_sync_rollups(&conn, None, Some(&personal_scope)).unwrap();
        assert_eq!(personal_rollups.len(), 2);
        assert!(
            personal_rollups
                .iter()
                .any(|row| row["billing_scope_key"] == json!("personal"))
        );
        assert!(
            personal_rollups
                .iter()
                .any(|row| row["billing_scope_key"] == json!("unknown"))
        );
        assert!(
            !personal_rollups
                .iter()
                .any(|row| row["billing_scope_key"] == json!("team:team-a"))
        );
    }

    #[test]
    fn tokenomics_account_sync_rollups_preserve_models_for_same_account() {
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
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let local_device_id = tokenomics_local_device_id();
        let local_device_ids = tokenomics_local_device_id_set(&conn).unwrap();
        let scope = tokenomics_billing_scope_from_parts(Some("personal"), None, "test");
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
                    "updated_at": "2026-05-30T05:00:00Z"
                },
                {
                    "provider": "openai",
                    "agent_kind": "codex",
                    "provider_account_key": "openai:codex:personal",
                    "window_kind": "weekly",
                    "used_percent": 70,
                    "remaining_percent": 30,
                    "updated_at": "2026-05-30T05:00:00Z"
                },
                {
                    "device_id": "remote-device",
                    "provider": "openai",
                    "agent_kind": "codex",
                    "provider_account_key": "openai:codex:personal",
                    "window_kind": "weekly",
                    "used_percent": 35,
                    "remaining_percent": 65,
                    "updated_at": "2026-05-30T05:00:00Z"
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
                    "sample_at": "2026-05-30T05:00:00Z"
                },
                {
                    "provider": "openai",
                    "agent_kind": "codex",
                    "provider_account_key": "openai:codex:personal",
                    "window_kind": "weekly",
                    "used_percent": 70,
                    "remaining_percent": 30,
                    "sample_at": "2026-05-30T05:00:00Z"
                },
                {
                    "device_id": "remote-device",
                    "provider": "openai",
                    "agent_kind": "codex",
                    "provider_account_key": "openai:codex:personal",
                    "window_kind": "weekly",
                    "used_percent": 35,
                    "remaining_percent": 65,
                    "sample_at": "2026-05-30T05:00:00Z"
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
        let display_samples = tokenomics_provider_limit_sample_rows(&conn, None, None, true).unwrap();
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
    fn tokenomics_resync_reset_clears_scan_caches() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        tokenomics_upsert_scan_state(
            &conn,
            "openai",
            "codex",
            "/tmp/state_5.sqlite",
            TOKENOMICS_CODEX_SCANNER_VERSION,
            true,
            123,
        )
        .unwrap();
        tokenomics_upsert_source_offset(
            &conn,
            "openai",
            "codex",
            Path::new("/tmp/session.jsonl"),
            TOKENOMICS_CODEX_SCANNER_VERSION,
            9,
            123,
            0,
        )
        .unwrap();
        tokenomics_upsert_scan_day(
            &conn,
            "openai",
            "codex",
            "/tmp/state_5.sqlite",
            TOKENOMICS_CODEX_SCANNER_VERSION,
            86_400,
            2,
            2,
            4,
        )
        .unwrap();
        assert!(
            tokenomics_scan_day_is_complete(
                &conn,
                "openai",
                "codex",
                "/tmp/state_5.sqlite",
                TOKENOMICS_CODEX_SCANNER_VERSION,
                86_400,
            )
            .unwrap()
        );

        tokenomics_reset_scan_caches_for_resync(&conn).unwrap();

        let scan_states: i64 = conn
            .query_row("SELECT COUNT(*) FROM tokenomics_scan_state", [], |row| {
                row.get(0)
            })
            .unwrap();
        let source_offsets: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tokenomics_source_offsets",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let scan_days: i64 = conn
            .query_row("SELECT COUNT(*) FROM tokenomics_scan_days", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(scan_states, 0);
        assert_eq!(source_offsets, 0);
        assert_eq!(scan_days, 0);
    }

    #[test]
    fn tokenomics_source_offsets_require_matching_coverage_range() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let path = Path::new("/tmp/session-coverage.jsonl");
        tokenomics_upsert_source_offset(
            &conn,
            "openai",
            "codex",
            path,
            TOKENOMICS_CODEX_SCANNER_VERSION,
            9,
            123,
            10_000,
        )
        .unwrap();
        let offset = tokenomics_get_source_offset(&conn, "openai", "codex", path)
            .unwrap()
            .expect("offset should exist");

        assert!(tokenomics_source_offset_is_current_for_range(
            &offset,
            path,
            TOKENOMICS_CODEX_SCANNER_VERSION,
            10_000,
        ));
        assert!(!tokenomics_source_offset_is_current_for_range(
            &offset,
            path,
            TOKENOMICS_CODEX_SCANNER_VERSION,
            9_999,
        ));
    }

    #[test]
    fn tokenomics_account_sync_rollups_include_rolling_30_day_boundary() {
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
    fn tokenomics_provider_account_prefers_jwt_subject_identity() {
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

        assert_eq!(account_a.key, account_b.key);
        assert!(account_a.key.starts_with("openai:codex:"));
        assert_eq!(
            account_a.key.rsplit(':').next().unwrap_or_default().len(),
            32
        );
        assert!(account_a.label.starts_with("Codex account "));
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
        assert!(
            account
                .label
                .chars()
                .all(|character| character.is_ascii_uppercase())
        );
        assert!(!account.label.contains('@'));
    }

    #[test]
    fn tokenomics_reconcile_provider_account_label_updates_existing_rows() {
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
    fn tokenomics_reconcile_duplicate_provider_account_identities_migrates_badge_windows() {
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

        assert_eq!(old_badges, 0);
        assert_eq!(old_windows, 0);
        assert_eq!(distinct_badge_keys, 1);
        assert_eq!(migrated_windows, 1);
    }

    #[test]
    fn tokenomics_reconcile_duplicate_provider_account_identities_merges_usage_keys() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let canonical_key = "openai:codex:canonical-rizzist";
        let old_key = "openai:codex:old-rizzist";
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
                   ?1, 'openai', 'codex', 'gpt-5.4', ?2, ?2,
                   'Rizzist', 'codex_token_count_jsonl', '/tmp/session.jsonl',
                   '2026-06-16', '2026-06-16T11:00:00Z', ?3, ?4, 0, 0,
                   ?5, 0, '2026-06-16T11:00:00Z', '2026-06-16T11:00:00Z'
                 )",
                rusqlite::params![id, key, input_tokens, output_tokens, input_tokens + output_tokens],
            )
            .unwrap();
            tokenomics_upsert_provider_account(
                &conn,
                "device-a",
                "openai",
                "codex",
                key,
                Some("Rizzist"),
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
                 WHERE provider='openai' AND agent_kind='codex' AND provider_account_label='Rizzist'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let rollup_total: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(total_tokens), 0)
                 FROM tokenomics_rollups
                 WHERE provider='openai' AND agent_kind='codex'
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

        assert_eq!(old_events, 0);
        assert_eq!(distinct_event_keys, 1);
        assert_eq!(rollup_total, 110);
        assert_eq!(old_badges, 0);
    }

    #[test]
    fn tokenomics_provider_account_uses_claude_oauth_account_identity() {
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
        assert!(
            account
                .label
                .chars()
                .all(|character| character.is_ascii_uppercase())
        );
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
    fn tokenomics_record_usage_value_prices_claude_fable_5() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();

        let inserted = tokenomics_record_usage_value(
            &conn,
            &json!({
                "provider": "anthropic",
                "agent_kind": "claude",
                "provider_account_key": "anthropic:claude:fable-test",
                "provider_account_label": "Claude Fable Test",
                "model": "claude-fable-5",
                "created_at": "2026-06-10T10:00:00Z",
                "input_tokens": 1_000_000,
                "cache_read_tokens": 100_000,
                "cache_write_tokens": 100_000,
                "output_tokens": 2_000_000,
            }),
            "test",
        )
        .unwrap();

        assert_eq!(inserted, 1);
        let event_cost: i64 = conn
            .query_row(
                "SELECT estimated_cost_microusd FROM tokenomics_usage_events",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let rollup_cost: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(estimated_cost_microusd), 0)
                 FROM tokenomics_rollups WHERE bucket_width='hour'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(event_cost, 111_350_000);
        assert_eq!(rollup_cost, 111_350_000);
    }

    #[test]
    fn tokenomics_repair_provider_api_costs_rebuilds_claude_rollups() {
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
    fn tokenomics_claude_plan_state_distinguishes_auth_from_subscription() {
        let signed_in = tokenomics_claude_plan_state_from_credentials(Some(&json!({
            "claudeAiOauth": {
                "accessToken": "token"
            }
        })));

        assert_eq!(signed_in["plan_detected"], json!(true));
        assert_eq!(signed_in["account_detected"], json!(true));
        assert_eq!(signed_in["plan_name"], json!("Claude account signed in"));
        assert!(signed_in["subscription_type"].is_null());

        let pro = tokenomics_claude_plan_state_from_credentials(Some(&json!({
            "claudeAiOauth": {
                "accessToken": "token",
                "subscriptionType": "pro",
                "rateLimitTier": "standard"
            }
        })));

        assert_eq!(pro["plan_name"], json!("Claude Pro"));
        assert_eq!(pro["subscription_type"], json!("pro"));
        assert_eq!(pro["rate_limit_tier"], json!("standard"));
        assert!(pro["access_token"].is_null());
    }

    #[test]
    fn tokenomics_claude_limit_snapshot_accepts_numeric_reset_timestamp() {
        let account = TokenomicsProviderAccount {
            key: "anthropic:claude:test".to_string(),
            label: "Claude account test".to_string(),
        };
        let snapshot = tokenomics_claude_window_snapshot(
            "5_hour",
            "5-Hour Session",
            "Claude Pro",
            "claude_statusline",
            &json!({
                "used_percentage": 95,
                "resets_at": 1781061600i64,
            }),
            "unix:1781058000",
            &account,
        );

        assert_eq!(snapshot["used_percent"], json!(95));
        assert_eq!(snapshot["remaining_percent"], json!(5));
        assert_eq!(snapshot["display_percent"], json!(5));
        assert_eq!(snapshot["display_percent_kind"], json!("remaining"));
        assert_eq!(snapshot["provider_reported_percent"], json!(95));
        assert_eq!(snapshot["provider_reported_direction"], json!("used"));
        assert_eq!(snapshot["pace_status"], json!("over_pace"));
        assert_eq!(snapshot["pace_exhausts_before_reset"], json!(true));
        assert_eq!(snapshot["reset_after_seconds"], json!(3600));
        assert_eq!(snapshot["reset_at"], json!("1781061600"));
        assert_eq!(snapshot["limit_resets_at"], json!("1781061600"));
        assert_eq!(snapshot["reset_label"], json!("Resets in 1h 0m"));
    }

    #[test]
    fn tokenomics_claude_oauth_usage_snapshot_uses_utilization_and_iso_reset() {
        let account = TokenomicsProviderAccount {
            key: "anthropic:claude:test".to_string(),
            label: "Claude account test".to_string(),
        };
        let limits = tokenomics_claude_live_limit_snapshots(
            &json!({
                "plan_name": "Claude Pro",
            }),
            &json!({
                "updated_at": "2026-06-10T12:00:00Z",
                "five_hour": {
                    "utilization": 95,
                    "resets_at": "2026-06-10T13:00:00.528743+00:00"
                },
                "seven_day": {
                    "utilization": 20,
                    "resets_at": "2026-06-14T02:00:00.951713+00:00"
                }
            }),
            &account,
        );

        assert_eq!(limits.len(), 2);
        assert_eq!(limits[0]["limit_source"], json!("claude_oauth_usage_api"));
        assert_eq!(limits[0]["used_percent"], json!(95));
        assert_eq!(limits[0]["remaining_percent"], json!(5));
        assert_eq!(limits[0]["display_percent"], json!(5));
        assert_eq!(limits[0]["display_percent_kind"], json!("remaining"));
        assert_eq!(limits[0]["provider_reported_percent"], json!(95));
        assert_eq!(limits[0]["provider_reported_direction"], json!("used"));
        assert_eq!(limits[0]["reset_after_seconds"], json!(3600));
        assert_eq!(limits[1]["window_kind"], json!("weekly"));
        assert_eq!(limits[1]["used_percent"], json!(20));
        assert_eq!(limits[1]["remaining_percent"], json!(80));
        assert_eq!(limits[1]["display_percent"], json!(80));
        assert_eq!(limits[1]["display_percent_kind"], json!("remaining"));
    }

    #[test]
    fn tokenomics_claude_unknown_limit_uses_statusline_unavailable_copy() {
        let account = TokenomicsProviderAccount {
            key: "anthropic:claude:test".to_string(),
            label: "Claude account test".to_string(),
        };
        let snapshot = tokenomics_unknown_limit_snapshot(
            "anthropic",
            "claude",
            &account,
            &json!({
                "plan_detected": true,
                "plan_name": "Claude account signed in",
                "plan_source": "claude_credentials_file",
            }),
            "5_hour",
            "5-Hour Session",
        );

        assert_eq!(
            snapshot["limit_source"],
            json!("claude_statusline_unavailable")
        );
        assert_eq!(
            snapshot["status_label"],
            json!("Live Claude Code limits unavailable")
        );
        assert_eq!(
            snapshot["reset_label"],
            json!("Open Claude Code to publish live limits")
        );
        assert_eq!(snapshot["plan_name"], json!("Claude account signed in"));
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
    fn tokenomics_limit_pace_marks_projected_early_exhaustion() {
        let pace =
            tokenomics_limit_pace_snapshot(50, 5 * 60 * 60, Some(4 * 60 * 60), None, "unix:1000");

        assert_eq!(pace["pace_status"], json!("over_pace"));
        assert_eq!(pace["pace_exhausts_before_reset"], json!(true));
        assert_eq!(pace["pace_projected_used_percent"], json!(250));
        assert_eq!(pace["pace_delta_percent"], json!(150));
        assert_eq!(pace["pace_projected_exhaustion_seconds"], json!(3600));
    }

    #[test]
    fn tokenomics_limit_pace_keeps_safe_weekly_projection_on_pace() {
        let pace = tokenomics_limit_pace_snapshot(
            10,
            7 * 24 * 60 * 60,
            Some(3 * 24 * 60 * 60 + 12 * 60 * 60),
            None,
            "unix:1000",
        );

        assert_eq!(pace["pace_status"], json!("on_pace"));
        assert_eq!(pace["pace_exhausts_before_reset"], json!(false));
        assert_eq!(pace["pace_projected_used_percent"], json!(20));
        assert_eq!(pace["pace_delta_percent"], json!(-80));
    }

    #[test]
    fn tokenomics_codex_limit_snapshot_carries_live_timestamp() {
        let account = TokenomicsProviderAccount {
            key: "openai:codex:test".to_string(),
            label: "Codex account test".to_string(),
        };
        let snapshot = tokenomics_codex_window_snapshot(
            "5_hour",
            "5-Hour Session",
            "ChatGPT Pro",
            "codex_usage_api",
            &json!({
                "used_percent": 98,
                "reset_after_seconds": 60,
            }),
            &json!({
                "allowed": true,
                "limit_reached": false,
            }),
            "unix:2010",
            &account,
        );

        assert_eq!(snapshot["remaining_percent"], json!(2));
        assert_eq!(snapshot["display_percent"], json!(2));
        assert_eq!(snapshot["display_percent_kind"], json!("remaining"));
        assert_eq!(snapshot["updated_at"], json!("unix:2010"));
        assert_eq!(snapshot["last_known_at"], json!("unix:2010"));
    }

    #[test]
    fn tokenomics_codex_weekly_limit_snapshot_displays_remaining_percent() {
        let account = TokenomicsProviderAccount {
            key: "openai:codex:test".to_string(),
            label: "Codex account test".to_string(),
        };
        let snapshot = tokenomics_codex_window_snapshot(
            "weekly",
            "Weekly Limit",
            "ChatGPT Pro",
            "codex_usage_api",
            &json!({
                "used_percent": 62,
                "reset_after_seconds": 99 * 60 * 60,
            }),
            &json!({
                "allowed": true,
                "limit_reached": false,
            }),
            "unix:2010",
            &account,
        );

        assert_eq!(snapshot["used_percent"], json!(62));
        assert_eq!(snapshot["remaining_percent"], json!(38));
        assert_eq!(snapshot["display_percent"], json!(38));
        assert_eq!(snapshot["display_percent_kind"], json!("remaining"));
        assert_eq!(snapshot["pace_status"], json!("over_pace"));
    }
}

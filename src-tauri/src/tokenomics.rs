const TOKENOMICS_DB_FILE: &str = "tokenomics.sqlite3";
const TOKENOMICS_SCAN_MAX_FILES_PER_PROVIDER: usize = 120;
const TOKENOMICS_SCAN_MAX_LINE_BYTES: usize = 256 * 1024;
const TOKENOMICS_SCAN_MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
const TOKENOMICS_SYNC_ROLLUP_LIMIT: usize = 5000;
const TOKENOMICS_CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/codex/usage";
const TOKENOMICS_CODEX_SCANNER_VERSION: &str = "codex-token-count-v5-device-aware";
const TOKENOMICS_GENERIC_SCANNER_VERSION: &str = "generic-tokenomics-v3-device-aware";
const TOKENOMICS_ROLLUP_ID_VERSION: &str = "scope-aware-rollups-v1";
const TOKENOMICS_INITIAL_BACKFILL_DAYS: u64 = 30;
const TOKENOMICS_CODEX_USAGE_CACHE_KEY_PREFIX: &str = "codex_usage_api_cache:";
const TOKENOMICS_CODEX_USAGE_CACHE_TTL_SECS: u64 = 60;
const TOKENOMICS_CODEX_USAGE_CACHE_STALE_SECS: u64 = 7 * 24 * 60 * 60;
const TOKENOMICS_SCAN_PROGRESS_EVENT: &str = "diffforge://tokenomics-scan-progress";
static TOKENOMICS_SCAN_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();

use std::io::BufRead as _;

#[tauri::command]
async fn tokenomics_scan_usage(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || tokenomics_scan_usage_for(&app, true, false))
        .await
        .map_err(|error| format!("Unable to join Tokenomics scan: {error}"))?
}

#[tauri::command]
async fn tokenomics_scan_usage_silent(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || tokenomics_scan_usage_for(&app, false, false))
        .await
        .map_err(|error| format!("Unable to join Tokenomics scan: {error}"))?
}

#[tauri::command]
async fn tokenomics_resync_last_30_days(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || tokenomics_scan_usage_for(&app, false, true))
        .await
        .map_err(|error| format!("Unable to join Tokenomics resync: {error}"))?
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
        Ok(json!({
            "known": false,
            "source": "rust_live_provider_limits",
            "updated_at": tokenomics_now_iso_like(),
            "limits": tokenomics_provider_limits(&conn)?,
        }))
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
async fn tokenomics_record_usage(app: AppHandle, usage: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = tokenomics_open_db(&app)?;
        let inserted = tokenomics_record_usage_value(&conn, &usage, "manual")?;
        tokenomics_summary_from_conn(&conn, true, Some(inserted))
    })
    .await
    .map_err(|error| format!("Unable to join Tokenomics record: {error}"))?
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
         DROP VIEW IF EXISTS tokenomics_display_rollups;
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
           updated_at TEXT NOT NULL,
           PRIMARY KEY(provider, agent_kind, source_path)
         );
         CREATE INDEX IF NOT EXISTS idx_tokenomics_source_offsets_provider ON tokenomics_source_offsets(provider, agent_kind, updated_at);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_scan_state_provider ON tokenomics_scan_state(provider, agent_kind, updated_at);",
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
    conn.execute_batch(
        "DROP VIEW IF EXISTS tokenomics_display_daily_rollups;
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
           FROM tokenomics_cloud_rollups;
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
         CREATE INDEX IF NOT EXISTS idx_tokenomics_scan_state_provider ON tokenomics_scan_state(provider, agent_kind, updated_at);",
    )
    .map_err(|error| format!("Unable to finalize Tokenomics database schema: {error}"))?;
    tokenomics_rebuild_rollups_for_identity_version(conn)?;
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

fn tokenomics_scan_usage_for(
    app: &AppHandle,
    emit_progress: bool,
    force_resync_last_30_days: bool,
) -> Result<Value, String> {
    let scan_lock = TOKENOMICS_SCAN_LOCK.get_or_init(|| StdMutex::new(()));
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
    let codex_result = tokenomics_scan_codex_state_db(app, &conn, emit_progress)?;
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
        let provider_account = tokenomics_provider_account(source.provider, source.agent_kind);
        let mut source_files = 0usize;
        let mut source_inserted = 0usize;
        for root in source.roots {
            if !root.exists() {
                continue;
            }
            let files =
                tokenomics_collect_candidate_files(&root, TOKENOMICS_SCAN_MAX_FILES_PER_PROVIDER);
            for file in files {
                if tokenomics_source_is_unchanged(
                    &conn,
                    source.provider,
                    source.agent_kind,
                    &file,
                    TOKENOMICS_GENERIC_SCANNER_VERSION,
                )? {
                    continue;
                }
                source_files += 1;
                scanned_files += 1;
                let scan = tokenomics_scan_file(
                    &conn,
                    source.provider,
                    source.agent_kind,
                    &provider_account,
                    &file,
                )?;
                source_inserted += scan.inserted_events;
                tokenomics_upsert_source_offset(
                    &conn,
                    source.provider,
                    source.agent_kind,
                    &file,
                    TOKENOMICS_GENERIC_SCANNER_VERSION,
                    scan.last_line_index,
                    scan.last_event_timestamp,
                )?;
            }
        }
        inserted_events += source_inserted;
        sources.push(json!({
            "provider": source.provider,
            "agent_kind": source.agent_kind,
            "provider_account_key": provider_account.key.as_str(),
            "provider_account_label": provider_account.label.as_str(),
            "files_scanned": source_files,
            "inserted_events": source_inserted,
            "status": if source_files > 0 { "scanned" } else { "not_found" },
        }));
    }

    let mut summary = tokenomics_summary_from_conn(&conn, true, Some(inserted_events))?;
    summary["scan"] = json!({
        "files_scanned": scanned_files,
        "inserted_events": inserted_events,
        "sources": sources,
        "forced_resync": force_resync_last_30_days,
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
    Ok(())
}

struct TokenomicsSource {
    provider: &'static str,
    agent_kind: &'static str,
    roots: Vec<PathBuf>,
}

fn tokenomics_sources() -> Vec<TokenomicsSource> {
    let home = tokenomics_home_dir();
    let mut sources = Vec::new();
    if let Some(home) = home {
        sources.push(TokenomicsSource {
            provider: "anthropic",
            agent_kind: "claude",
            roots: vec![home.join(".claude").join("projects")],
        });
        sources.push(TokenomicsSource {
            provider: "opencode",
            agent_kind: "opencode",
            roots: vec![
                home.join(".local").join("share").join("opencode"),
                home.join(".config").join("opencode"),
                home.join(".opencode"),
            ],
        });
    }
    sources
}

fn tokenomics_home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
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

fn tokenomics_device_id_from_value(value: &Value, inherited: Option<String>) -> String {
    tokenomics_text_field(value, &["device_id", "deviceId", "machine_id", "machineId"])
        .or(inherited)
        .unwrap_or_else(tokenomics_local_device_id)
}

#[derive(Clone)]
struct TokenomicsSourceIdentity {
    provider_account: TokenomicsProviderAccount,
    device_id: String,
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
           COALESCE(NULLIF(device_id, ''), 'desktop-primary') AS device_id,
           COALESCE(NULLIF(billing_scope_type, ''), 'unknown') AS billing_scope_type,
           NULLIF(billing_team_id, '') AS billing_team_id,
           COALESCE(MAX(NULLIF(billing_scope_source, '')), 'unknown') AS billing_scope_source
         FROM tokenomics_usage_events
         WHERE provider=?1 AND agent_kind=?2
           AND COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, '')) IS NOT NULL
           AND (source_path=?3 OR source_path LIKE ?4)
         GROUP BY account_key, device_id, billing_scope_type, billing_team_id
         ORDER BY COUNT(*) DESC, MAX(COALESCE(observed_at, '')) DESC
         LIMIT 1",
        rusqlite::params![provider, agent_kind, source_path, source_path_with_suffix],
        |row| {
            let key: String = row.get(0)?;
            let label = row
                .get::<_, Option<String>>(1)?
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| key.clone());
            let device_id = row
                .get::<_, Option<String>>(2)?
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(tokenomics_local_device_id);
            let scope_type = row.get::<_, Option<String>>(3)?;
            let team_id = row.get::<_, Option<String>>(4)?;
            let scope_source = row
                .get::<_, Option<String>>(5)?
                .unwrap_or_else(|| "existing_source_identity".to_string());
            Ok(TokenomicsSourceIdentity {
                provider_account: TokenomicsProviderAccount { key, label },
                device_id,
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

fn tokenomics_emit_scan_progress(app: &AppHandle, emit_progress: bool, payload: Value) {
    if !emit_progress {
        return;
    }
    let _ = app.emit(TOKENOMICS_SCAN_PROGRESS_EVENT, payload);
}

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
    if clean.len() < 19 {
        return None;
    }
    let year = clean.get(0..4)?.parse::<i64>().ok()?;
    let month = clean.get(5..7)?.parse::<i64>().ok()?;
    let day = clean.get(8..10)?.parse::<i64>().ok()?;
    let hour = clean.get(11..13)?.parse::<i64>().ok()?;
    let minute = clean.get(14..16)?.parse::<i64>().ok()?;
    let second = clean.get(17..19)?.parse::<i64>().ok()?;
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
        Some(seconds as u64)
    }
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

fn tokenomics_get_source_offset(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    path: &Path,
) -> Result<Option<TokenomicsSourceOffset>, String> {
    let source_path = path.display().to_string();
    match conn.query_row(
        "SELECT scanner_version, last_line_index, last_seen_mtime, last_seen_size, last_event_timestamp
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
) -> Result<(), String> {
    let (last_seen_mtime, last_seen_size) = tokenomics_file_mtime_size(path);
    let now = tokenomics_now_iso_like();
    conn.execute(
        "INSERT INTO tokenomics_source_offsets(
           provider, agent_kind, source_path, scanner_version, last_line_index,
           last_seen_mtime, last_seen_size, last_event_timestamp, updated_at
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(provider, agent_kind, source_path)
         DO UPDATE SET
           scanner_version=excluded.scanner_version,
           last_line_index=excluded.last_line_index,
           last_seen_mtime=excluded.last_seen_mtime,
           last_seen_size=excluded.last_seen_size,
           last_event_timestamp=excluded.last_event_timestamp,
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
            now,
        ],
    )
    .map_err(|error| format!("Unable to write Tokenomics source offset: {error}"))?;
    Ok(())
}

fn tokenomics_source_is_unchanged(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    path: &Path,
    scanner_version: &str,
) -> Result<bool, String> {
    let Some(offset) = tokenomics_get_source_offset(conn, provider, agent_kind, path)? else {
        return Ok(false);
    };
    let (mtime, size) = tokenomics_file_mtime_size(path);
    Ok(offset.scanner_version == scanner_version
        && offset.last_seen_mtime == mtime
        && offset.last_seen_size == size)
}

fn tokenomics_scan_codex_state_db(
    app: &AppHandle,
    conn: &rusqlite::Connection,
    emit_progress: bool,
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
        .unwrap_or(true);
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
    } else if needs_scanner_reset {
        tokenomics_delete_provider_scan_cache(conn, "openai", "codex")?;
        scan_state = None;
    }
    let initial_backfill_done = scan_state
        .as_ref()
        .map(|state| state.initial_backfill_done)
        .unwrap_or(false);
    let now_unix = tokenomics_unix_now();
    let backfill_cutoff = now_unix.saturating_sub(TOKENOMICS_INITIAL_BACKFILL_DAYS * 86_400);
    let min_thread_updated_at = if initial_backfill_done {
        scan_state
            .as_ref()
            .map(|state| state.last_event_timestamp.saturating_sub(3_600))
            .unwrap_or(0)
    } else {
        backfill_cutoff
    };

    tokenomics_emit_scan_progress(
        app,
        emit_progress,
        json!({
            "provider": "openai",
            "agent_kind": "codex",
            "provider_account_key": provider_account.key.as_str(),
            "provider_account_label": provider_account.label.as_str(),
            "phase": if initial_backfill_done { "catch_up" } else { "backfill_start" },
            "day_index": 0,
            "day_total": TOKENOMICS_INITIAL_BACKFILL_DAYS,
            "day_label": if initial_backfill_done { "latest usage" } else { "preparing 30-day scan" },
            "files_scanned": 0,
            "inserted_events": 0,
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
                 ORDER BY updated_at ASC",
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
    let mut current_day_index = 0u64;
    let mut newest_event_timestamp = scan_state
        .as_ref()
        .map(|state| state.last_event_timestamp)
        .unwrap_or(backfill_cutoff);

    for candidate in candidates.iter() {
        let (day_index, day_total, day_label) =
            tokenomics_scan_day_progress(candidate.updated_at_unix, backfill_cutoff, now_unix);
        if day_index != current_day_index {
            current_day_index = day_index;
            let mut progress = json!({
                "provider": "openai",
                "agent_kind": "codex",
                "provider_account_key": provider_account.key.as_str(),
                "provider_account_label": provider_account.label.as_str(),
                "phase": if initial_backfill_done { "catch_up" } else { "day_start" },
                "day_index": day_index,
                "day_total": day_total,
                "day_label": day_label,
                "files_scanned": files_scanned,
                "inserted_events": inserted_events,
                "candidate_count": candidates.len(),
            });
            if files_scanned > 0 || inserted_events > 0 {
                if let Ok(summary) = tokenomics_summary_from_conn(conn, true, Some(inserted_events))
                {
                    progress["summary"] = summary;
                }
            }
            tokenomics_emit_scan_progress(app, emit_progress, progress);
        }

        let (mtime, size) = tokenomics_file_mtime_size(&candidate.rollout_path);
        let offset =
            tokenomics_get_source_offset(conn, "openai", "codex", &candidate.rollout_path)?;
        let offset_is_current = offset.as_ref().is_some_and(|offset| {
            offset.scanner_version == TOKENOMICS_CODEX_SCANNER_VERSION
                && offset.last_seen_mtime == mtime
                && offset.last_seen_size == size
        });
        if initial_backfill_done && offset_is_current {
            skipped_cached += 1;
            if let Some(offset) = offset.as_ref() {
                newest_event_timestamp = newest_event_timestamp.max(offset.last_event_timestamp);
            }
            continue;
        }
        let start_after_line = if initial_backfill_done {
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
            if initial_backfill_done {
                0
            } else {
                backfill_cutoff
            },
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
        )?;
    }

    let mut complete_progress = json!({
        "provider": "openai",
        "agent_kind": "codex",
        "provider_account_key": provider_account.key.as_str(),
        "provider_account_label": provider_account.label.as_str(),
        "phase": "complete",
        "day_index": TOKENOMICS_INITIAL_BACKFILL_DAYS,
        "day_total": TOKENOMICS_INITIAL_BACKFILL_DAYS,
        "day_label": "complete",
        "files_scanned": files_scanned,
        "inserted_events": inserted_events,
        "candidate_count": candidates.len(),
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
        true,
        newest_event_timestamp.max(backfill_cutoff),
    )?;

    Ok(TokenomicsScanResult {
        files_scanned,
        inserted_events,
        status: if !initial_backfill_done {
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
    let device_id = source_identity
        .as_ref()
        .map(|identity| identity.device_id.clone())
        .unwrap_or_else(tokenomics_local_device_id);
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

fn tokenomics_collect_candidate_files(root: &Path, limit: usize) -> Vec<PathBuf> {
    let mut files = Vec::<(u64, PathBuf)>::new();
    tokenomics_collect_candidate_files_inner(root, 0, &mut files);
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
    files: &mut Vec<(u64, PathBuf)>,
) {
    if depth > 8 || files.len() > TOKENOMICS_SCAN_MAX_FILES_PER_PROVIDER.saturating_mul(8) {
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
            tokenomics_collect_candidate_files_inner(&path, depth + 1, files);
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
        None,
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
    let mut device_id = inherited_device_id;
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
        if let Some(next_device_id) =
            tokenomics_text_field(value, &["device_id", "deviceId", "machine_id", "machineId"])
        {
            device_id = Some(next_device_id);
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
                tokenomics_device_id_from_value(usage_value, device_id.clone()),
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
        estimated_cost_microusd: 0,
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
    let clean = timestamp.trim();
    if clean.len() >= 13
        && clean.as_bytes().get(4) == Some(&b'-')
        && clean.as_bytes().get(7) == Some(&b'-')
    {
        let day = clean.get(0..10).unwrap_or("unknown").to_string();
        let hour = if clean.len() >= 13 {
            clean.get(0..13).unwrap_or(&day).to_string()
        } else {
            day.clone()
        };
        return (day, hour);
    }
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let day = format!("unix-day-{}", seconds / 86_400);
    let hour = format!("unix-hour-{}", seconds / 3_600);
    (day, hour)
}

fn tokenomics_now_iso_like() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("unix:{seconds}")
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
    tokenomics_increment_rollup(conn, event, "day", &event.bucket_day)?;
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
    tokenomics_rebuild_provider_rollups_for_width(conn, provider, agent_kind, "day", "bucket_day")?;
    tokenomics_rebuild_provider_rollups_for_width(
        conn,
        provider,
        agent_kind,
        "hour",
        "bucket_hour",
    )?;
    Ok(())
}

fn tokenomics_rebuild_all_rollups_from_events(conn: &rusqlite::Connection) -> Result<(), String> {
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
            "day",
            "bucket_day",
        )?;
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

fn tokenomics_rebuild_provider_rollups_for_width(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    bucket_width: &str,
    bucket_column: &str,
) -> Result<(), String> {
    let query = format!(
        "SELECT
	           device_id, provider, agent_kind, model, subscription_key, provider_account_key,
	           MAX(provider_account_label) AS provider_account_label,
	           COALESCE(NULLIF(billing_scope_type, ''), 'unknown') AS billing_scope_type,
	           NULLIF(billing_team_id, '') AS billing_team_id,
	           MAX(COALESCE(NULLIF(billing_scope_source, ''), 'unknown')) AS billing_scope_source,
	           workspace_id, MAX(repo_path) AS repo_path, {bucket_column} AS bucket_start,
	           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
           COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
           COALESCE(SUM(total_tokens), 0) AS total_tokens,
           COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd,
           COUNT(*) AS event_count
	         FROM tokenomics_usage_events
	         WHERE provider=?1 AND agent_kind=?2
	         GROUP BY device_id, provider, agent_kind, model, subscription_key, provider_account_key,
	                  billing_scope_type, billing_team_id, workspace_id, {bucket_column}"
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
	             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
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
    let Some(mut event) = tokenomics_usage_event_from_value(
        usage,
        &provider,
        &agent_kind,
        &provider_account,
        tokenomics_billing_scope_from_value(usage, &tokenomics_current_billing_scope()),
        usage
            .get("model")
            .and_then(Value::as_str)
            .map(|value| value.to_string()),
        usage
            .get("created_at")
            .or_else(|| usage.get("createdAt"))
            .and_then(Value::as_str)
            .map(|value| value.to_string()),
        tokenomics_device_id_from_value(usage, None),
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
    tokenomics_summary_from_conn_with_cloud_for_scope(&conn, true, None, false, Some(scope_filter))
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
    let account_key_sql = "COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, ''), provider || ':' || agent_kind || ':unknown')";
    let account_label_sql = "COALESCE(NULLIF(provider_account_label, ''), CASE WHEN agent_kind='codex' THEN 'Codex account' WHEN agent_kind='claude' THEN 'Claude account' WHEN agent_kind='opencode' THEN 'OpenCode account' ELSE agent_kind || ' account' END)";
    let scope_type_sql = "COALESCE(NULLIF(billing_scope_type, ''), 'unknown')";
    let scope_team_sql = "NULLIF(billing_team_id, '')";
    let scope_key_sql = "CASE WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='team' AND NULLIF(billing_team_id, '') IS NOT NULL THEN 'team:' || billing_team_id WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='personal' THEN 'personal' ELSE 'unknown' END";
    let scope_label_sql = "CASE WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='team' THEN 'Team' WHEN COALESCE(NULLIF(billing_scope_type, ''), 'unknown')='personal' THEN 'Personal' ELSE 'Unknown scope' END";
    let scope_source_sql = "COALESCE(NULLIF(billing_scope_source, ''), 'unknown')";
    let scope_select_sql = format!("{scope_type_sql} AS billing_scope_type, {scope_team_sql} AS billing_team_id, {scope_key_sql} AS billing_scope_key, {scope_label_sql} AS billing_scope_label, MAX({scope_source_sql}) AS billing_scope_source");
    let hourly_rollup_table = if include_cloud {
        "tokenomics_display_hourly_rollups"
    } else {
        "tokenomics_hourly_rollups"
    };
    let daily_rollup_table = if include_cloud {
        "tokenomics_display_daily_rollups"
    } else {
        "tokenomics_daily_rollups"
    };
    let total = tokenomics_query_one(
        conn,
        &format!("SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM {daily_rollup_table}")
    )?;
    let by_device = tokenomics_query_rows(
        conn,
        &format!("SELECT device_id, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM {daily_rollup_table} GROUP BY device_id ORDER BY total_tokens DESC LIMIT 40"),
    )?;
    let by_device_provider = tokenomics_query_rows(
	        conn,
	        &format!(
	            "SELECT device_id, provider, agent_kind, {account_key_sql} AS provider_account_key, {account_label_sql} AS provider_account_label, {scope_select_sql}, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM {daily_rollup_table} GROUP BY device_id, provider, agent_kind, provider_account_key, billing_scope_key ORDER BY total_tokens DESC LIMIT 80"
	        ),
	    )?;
    let by_device_account = tokenomics_query_rows(
	        conn,
	        &format!(
	            "SELECT device_id, provider, agent_kind, {account_key_sql} AS provider_account_key, {account_label_sql} AS provider_account_label, {scope_select_sql}, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM {daily_rollup_table} GROUP BY device_id, provider, agent_kind, provider_account_key, billing_scope_key ORDER BY total_tokens DESC LIMIT 120"
	        ),
	    )?;
    let daily = tokenomics_query_rows(
        conn,
        &format!("SELECT bucket_start, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM {daily_rollup_table} GROUP BY bucket_start ORDER BY bucket_start DESC LIMIT 30"),
    )?;
    let daily_by_device_provider = tokenomics_query_rows(
	        conn,
	        &format!(
	            "SELECT device_id, provider, agent_kind, {account_key_sql} AS provider_account_key, {account_label_sql} AS provider_account_label, {scope_select_sql}, bucket_start, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM {daily_rollup_table} GROUP BY device_id, provider, agent_kind, provider_account_key, billing_scope_key, bucket_start ORDER BY bucket_start DESC LIMIT 720"
	        ),
	    )?;
    let monthly = tokenomics_query_rows(
        conn,
        &format!("SELECT substr(bucket_start, 1, 7) || '-01' AS bucket_start, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM {daily_rollup_table} GROUP BY substr(bucket_start, 1, 7) ORDER BY bucket_start DESC LIMIT 24"),
    )?;
    let monthly_by_device_provider = tokenomics_query_rows(
	        conn,
	        &format!(
	            "SELECT device_id, provider, agent_kind, {account_key_sql} AS provider_account_key, {account_label_sql} AS provider_account_label, {scope_select_sql}, substr(bucket_start, 1, 7) || '-01' AS bucket_start, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM {daily_rollup_table} GROUP BY device_id, provider, agent_kind, provider_account_key, billing_scope_key, substr(bucket_start, 1, 7) ORDER BY bucket_start DESC LIMIT 720"
	        ),
	    )?;
    let by_device_model = tokenomics_query_rows(
	        conn,
	        &format!(
	            "SELECT device_id, provider, agent_kind, {account_key_sql} AS provider_account_key, {account_label_sql} AS provider_account_label, {scope_select_sql}, COALESCE(NULLIF(model, ''), agent_kind) AS model, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM {daily_rollup_table} GROUP BY device_id, provider, agent_kind, provider_account_key, billing_scope_key, COALESCE(NULLIF(model, ''), agent_kind) ORDER BY total_tokens DESC LIMIT 120"
	        ),
	    )?;
    let hourly = tokenomics_query_rows(
	        conn,
	        &format!(
	            "SELECT device_id, provider, agent_kind, {account_key_sql} AS provider_account_key, {account_label_sql} AS provider_account_label, {scope_select_sql}, COALESCE(NULLIF(model, ''), agent_kind) AS model, bucket_start, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count, MAX(updated_at) AS updated_at FROM {hourly_rollup_table} GROUP BY device_id, provider, agent_kind, provider_account_key, billing_scope_key, COALESCE(NULLIF(model, ''), agent_kind), bucket_start ORDER BY bucket_start DESC LIMIT 5000"
	        ),
	    )?;
    let limits = tokenomics_provider_limits(conn)?;
    let sync_hourly = if include_rollups {
        tokenomics_account_hourly_sync_rollups(conn, None, scope_filter)?
    } else {
        hourly
    };
    Ok(json!({
    "known": total.get("total_tokens").and_then(Value::as_i64).unwrap_or(0) > 0,
    "source": "rust_local_tokenomics_sqlite",
    "updated_at": tokenomics_now_iso_like(),
    "current_device_id": tokenomics_local_device_id(),
    "inserted_events": inserted_events.unwrap_or(0),
    "total": total,
    "by_device": by_device,
    "by_device_provider": by_device_provider,
    "by_device_account": by_device_account,
    "by_device_model": by_device_model,
    "daily": daily,
    "daily_by_device_provider": daily_by_device_provider,
    "monthly": monthly,
    "monthly_by_device_provider": monthly_by_device_provider,
    "hourly": sync_hourly,
    "sources": [
        {"provider": "anthropic", "agent_kind": "claude", "label": "Claude Code"},
        {"provider": "openai", "agent_kind": "codex", "label": "Codex"},
        {"provider": "opencode", "agent_kind": "opencode", "label": "OpenCode"}
    ],
    "limits": limits,
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

fn tokenomics_account_hourly_sync_rollups(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
    scope_filter: Option<&TokenomicsBillingScope>,
) -> Result<Vec<Value>, String> {
    let clean_since = since_updated_at
        .map(str::trim)
        .filter(|value| !value.is_empty());
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
               bucket_start,
               COALESCE(SUM(input_tokens), 0) AS input_tokens,
               COALESCE(SUM(output_tokens), 0) AS output_tokens,
               COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
               COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
               COALESCE(SUM(total_tokens), 0) AS total_tokens,
               COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd,
               COALESCE(SUM(event_count), 0) AS event_count,
               MAX(updated_at) AS updated_at
	             FROM tokenomics_rollups
	             WHERE bucket_width='hour'
	               AND (
	                 bucket_start >= strftime('%Y-%m-%dT00', 'now', '-29 days')
	                 OR bucket_start LIKE 'unix-hour-%'
		               )
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
                Ok(Value::Object(object))
            },
        )
        .map_err(|error| format!("Unable to query Tokenomics account sync rows: {error}"))?;
    let mut rollups = Vec::new();
    for row in mapped {
        rollups.push(
            row.map_err(|error| format!("Unable to read Tokenomics account sync row: {error}"))?,
        );
    }
    Ok(rollups)
}

fn tokenomics_sync_delta_from_conn(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
    scope_filter: Option<&TokenomicsBillingScope>,
) -> Result<Value, String> {
    let clean_since = since_updated_at
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let hourly = tokenomics_account_hourly_sync_rollups(conn, clean_since, scope_filter)?;
    let sync_cursor = hourly
        .iter()
        .filter_map(|row| row.get("updated_at").and_then(Value::as_str))
        .max()
        .map(ToOwned::to_owned)
        .or_else(|| clean_since.map(ToOwned::to_owned));
    let hourly_count = hourly.len();
    Ok(json!({
        "known": hourly_count > 0,
        "source": "rust_local_tokenomics_sqlite_delta",
        "updated_at": tokenomics_now_iso_like(),
        "sync_cursor": sync_cursor,
        "hourly_count": hourly_count,
        "hourly": hourly,
        "limits": tokenomics_provider_limits(conn)?,
    }))
}

fn tokenomics_record_cloud_account_state(app: &AppHandle, event: &Value) -> Result<Value, String> {
    let conn = tokenomics_open_db(app)?;
    let local_device_id = tokenomics_local_device_id();
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
    let hourly = summary
        .get("hourly")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if hourly.is_empty() {
        return Ok(json!({
            "ok": true,
            "stored_count": 0,
            "event_kind": event_kind,
        }));
    }

    let now = tokenomics_now_iso_like();
    let is_snapshot =
        event_kind.ends_with("_snapshot") || event_kind == "tokenomics_account_snapshot";
    let mut incoming_devices = HashSet::<String>::new();
    for rollup in &hourly {
        let device_id = tokenomics_device_id_from_value(rollup, inherited_device_id.clone());
        if device_id != local_device_id {
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
        let device_id = tokenomics_device_id_from_value(rollup, inherited_device_id.clone());
        if device_id == local_device_id {
            continue;
        }
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
                tokenomics_value_i64(rollup, &["input_tokens", "inputTokens"]).unwrap_or(0).max(0),
                tokenomics_value_i64(rollup, &["output_tokens", "outputTokens"]).unwrap_or(0).max(0),
                tokenomics_value_i64(rollup, &["cache_read_tokens", "cacheReadTokens"]).unwrap_or(0).max(0),
                tokenomics_value_i64(rollup, &["cache_write_tokens", "cacheWriteTokens"]).unwrap_or(0).max(0),
                tokenomics_value_i64(rollup, &["total_tokens", "totalTokens"]).unwrap_or(0).max(0),
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
        "event_kind": event_kind,
        "device_count": incoming_devices.len(),
    }))
}

fn tokenomics_cloud_summary_payload(event: &Value) -> &Value {
    event
        .get("summary")
        .or_else(|| {
            event
                .get("payload")
                .and_then(|payload| payload.get("summary"))
        })
        .unwrap_or(event)
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
    let now = tokenomics_now_iso_like();
    conn.execute(
        "DELETE FROM tokenomics_cloud_rollups WHERE bucket_width='day'",
        [],
    )
    .map_err(|error| format!("Unable to clear cached cloud Tokenomics day rows: {error}"))?;
    conn.execute(
	        "INSERT OR REPLACE INTO tokenomics_cloud_rollups(
	           id, device_id, provider, agent_kind, model, subscription_key,
	           provider_account_key, provider_account_label,
	           billing_scope_type, billing_team_id, billing_scope_source,
	           workspace_id, repo_path,
	           bucket_width, bucket_start, input_tokens, output_tokens,
	           cache_read_tokens, cache_write_tokens, total_tokens,
	           estimated_cost_microusd, event_count, updated_at, received_at
	         )
	         SELECT
	           'cloud-tokenomics-day-' || hex(device_id || '|' || provider || '|' || agent_kind || '|' || COALESCE(model, '') || '|' || COALESCE(provider_account_key, '') || '|' || COALESCE(billing_scope_type, '') || '|' || COALESCE(billing_team_id, '') || '|' || substr(bucket_start, 1, 10)),
	           device_id,
	           provider,
	           agent_kind,
           model,
	           provider_account_key,
	           provider_account_key,
	           provider_account_label,
	           COALESCE(NULLIF(billing_scope_type, ''), 'unknown'),
	           NULLIF(billing_team_id, ''),
	           COALESCE(MAX(NULLIF(billing_scope_source, '')), 'unknown'),
	           NULL,
	           NULL,
           'day',
           substr(bucket_start, 1, 10),
           COALESCE(SUM(input_tokens), 0),
           COALESCE(SUM(output_tokens), 0),
           COALESCE(SUM(cache_read_tokens), 0),
           COALESCE(SUM(cache_write_tokens), 0),
           COALESCE(SUM(total_tokens), 0),
           COALESCE(SUM(estimated_cost_microusd), 0),
           COALESCE(SUM(event_count), 0),
           COALESCE(MAX(updated_at), ?1),
	           ?1
	         FROM tokenomics_cloud_rollups
	         WHERE bucket_width='hour' AND LENGTH(substr(bucket_start, 1, 10)) = 10
	         GROUP BY device_id, provider, agent_kind, model, provider_account_key, provider_account_label, billing_scope_type, billing_team_id, substr(bucket_start, 1, 10)",
        rusqlite::params![now.as_str()],
    )
    .map_err(|error| format!("Unable to rebuild cached cloud Tokenomics day rows: {error}"))?;
    Ok(())
}

fn tokenomics_provider_limits(conn: &rusqlite::Connection) -> Result<Vec<Value>, String> {
    let mut limits = Vec::new();

    let codex_plan = tokenomics_codex_plan_state();
    let codex_account = tokenomics_provider_account("openai", "codex");
    if let Some(codex_usage) = tokenomics_codex_live_usage(conn, &codex_plan, &codex_account) {
        limits.extend(tokenomics_codex_live_limit_snapshots(
            &codex_plan,
            &codex_usage,
            &codex_account,
        ));
    } else {
        limits.push(tokenomics_unknown_limit_snapshot(
            "openai",
            "codex",
            &codex_account,
            &codex_plan,
            "5_hour",
            "5-Hour Session",
        ));
        limits.push(tokenomics_unknown_limit_snapshot(
            "openai",
            "codex",
            &codex_account,
            &codex_plan,
            "weekly",
            "Weekly Limit",
        ));
    }

    let claude_plan = tokenomics_claude_plan_state();
    let claude_account = tokenomics_provider_account("anthropic", "claude");
    let _ = tokenomics_ensure_claude_statusline_collector(&claude_plan);
    if let Some(claude_limits) = tokenomics_claude_statusline_limits(&claude_plan, &claude_account)
    {
        limits.extend(claude_limits);
    } else {
        limits.push(tokenomics_unknown_limit_snapshot(
            "anthropic",
            "claude",
            &claude_account,
            &claude_plan,
            "5_hour",
            "5-Hour Session",
        ));
        limits.push(tokenomics_unknown_limit_snapshot(
            "anthropic",
            "claude",
            &claude_account,
            &claude_plan,
            "weekly",
            "Weekly Limit",
        ));
    }

    Ok(limits)
}

fn tokenomics_codex_usage_cache_key(provider_account: &TokenomicsProviderAccount) -> String {
    format!(
        "{TOKENOMICS_CODEX_USAGE_CACHE_KEY_PREFIX}{}",
        provider_account.key
    )
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
    if fetched_at == 0 || now_unix.saturating_sub(fetched_at) > max_age_secs {
        return Ok(None);
    }
    let Some(usage) = cached.get("usage").filter(|value| value.is_object()) else {
        return Ok(None);
    };
    Ok(Some(tokenomics_adjust_cached_codex_usage(
        usage,
        now_unix.saturating_sub(fetched_at),
    )))
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
    let Some(rate_limit) = usage
        .get_mut("rate_limit")
        .and_then(Value::as_object_mut)
    else {
        return usage;
    };
    for window_key in ["primary_window", "secondary_window"] {
        let Some(window) = rate_limit.get_mut(window_key).and_then(Value::as_object_mut) else {
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

fn tokenomics_codex_live_usage(
    conn: &rusqlite::Connection,
    plan: &Value,
    provider_account: &TokenomicsProviderAccount,
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
    if let Some(usage) = fetched {
        let _ = tokenomics_store_codex_usage_cache(conn, &cache_key, &usage);
        return Some(usage);
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
    let credits = usage.get("credits").cloned().unwrap_or_else(|| json!({}));
    if let Some(rate_limit) = usage.get("rate_limit") {
        if let Some(primary) = rate_limit.get("primary_window") {
            limits.push(tokenomics_codex_window_snapshot(
                "5_hour",
                "5-Hour Session",
                &plan_name,
                "codex_usage_api",
                primary,
                rate_limit,
                &credits,
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
                &credits,
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

fn tokenomics_codex_window_snapshot(
    window_kind: &str,
    label: &str,
    plan_name: &str,
    plan_source: &str,
    window: &Value,
    rate_limit: &Value,
    credits: &Value,
    provider_account: &TokenomicsProviderAccount,
) -> Value {
    let used_percent = tokenomics_value_i64(window, &["used_percent", "usedPercent"])
        .unwrap_or(0)
        .clamp(0, 100);
    let remaining_percent = (100 - used_percent).clamp(0, 100);
    let reset_after_seconds =
        tokenomics_value_i64(window, &["reset_after_seconds", "resetAfterSeconds"]).unwrap_or(0);
    let reset_at = tokenomics_value_i64(window, &["reset_at", "resetAt"]);
    let limit_window_seconds =
        tokenomics_value_i64(window, &["limit_window_seconds", "limitWindowSeconds"]);
    let limit_reached = rate_limit
        .get("limit_reached")
        .or_else(|| rate_limit.get("limitReached"))
        .and_then(Value::as_bool)
        .unwrap_or(remaining_percent <= 0);
    let allowed = rate_limit
        .get("allowed")
        .and_then(Value::as_bool)
        .unwrap_or(!limit_reached);
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
        "pace_delta_percent": 0,
        "status_label": tokenomics_codex_status_label(remaining_percent, limit_reached, allowed),
        "reset_label": tokenomics_reset_label(reset_at, reset_after_seconds),
        "reset_after_seconds": reset_after_seconds,
        "reset_at": reset_at,
        "limit_window_seconds": limit_window_seconds,
        "credits": {
            "has_credits": credits.get("has_credits").or_else(|| credits.get("hasCredits")).and_then(Value::as_bool).unwrap_or(false),
            "unlimited": credits.get("unlimited").and_then(Value::as_bool).unwrap_or(false),
            "overage_limit_reached": credits.get("overage_limit_reached").or_else(|| credits.get("overageLimitReached")).and_then(Value::as_bool).unwrap_or(false),
            "balance": tokenomics_value_string(credits, &["balance"]).unwrap_or_else(|| "0".to_string()),
            "approx_local_messages": credits.get("approx_local_messages").or_else(|| credits.get("approxLocalMessages")).cloned().unwrap_or(Value::Null),
            "approx_cloud_messages": credits.get("approx_cloud_messages").or_else(|| credits.get("approxCloudMessages")).cloned().unwrap_or(Value::Null),
        },
        "rate_points": [],
    })
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

fn tokenomics_claude_statusline_limits(
    plan: &Value,
    provider_account: &TokenomicsProviderAccount,
) -> Option<Vec<Value>> {
    let home = env::var("HOME").ok().map(PathBuf::from)?;
    let cache_path = home.join(".claude").join("diffforge-rate-limits.json");
    let text = fs::read_to_string(cache_path).ok()?;
    let cache = serde_json::from_str::<Value>(&text).ok()?;
    let rate_limits = cache.get("rate_limits")?;
    let plan_name = plan
        .get("plan_name")
        .and_then(Value::as_str)
        .unwrap_or("Claude account signed in");
    let mut limits = Vec::new();
    if let Some(five_hour) = rate_limits
        .get("five_hour")
        .or_else(|| rate_limits.get("fiveHour"))
    {
        limits.push(tokenomics_claude_window_snapshot(
            "5_hour",
            "5-Hour Session",
            plan_name,
            five_hour,
            cache.get("updated_at").and_then(Value::as_str),
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
            seven_day,
            cache.get("updated_at").and_then(Value::as_str),
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
    window: &Value,
    updated_at: Option<&str>,
    provider_account: &TokenomicsProviderAccount,
) -> Value {
    let used_percent = tokenomics_value_i64(
        window,
        &[
            "used_percentage",
            "usedPercentage",
            "used_percent",
            "usedPercent",
        ],
    )
    .unwrap_or(0)
    .clamp(0, 100);
    let remaining_percent = (100 - used_percent).clamp(0, 100);
    let reset_at_text = window
        .get("resets_at")
        .or_else(|| window.get("resetsAt"))
        .and_then(Value::as_str);
    let limit_window_seconds = if window_kind == "5_hour" {
        5 * 60 * 60
    } else {
        7 * 24 * 60 * 60
    };
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
        "limit_source": "claude_statusline",
        "confidence": "live",
        "allowance_unit": "percent",
        "used": used_percent,
        "allowance": 100,
        "remaining": remaining_percent,
        "used_percent": used_percent,
        "remaining_percent": remaining_percent,
        "pace_delta_percent": 0,
        "status_label": tokenomics_claude_status_label(remaining_percent),
        "reset_label": tokenomics_claude_reset_label(reset_at_text),
        "reset_at": reset_at_text,
        "limit_window_seconds": limit_window_seconds,
        "updated_at": updated_at,
        "rate_points": [],
    })
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

fn tokenomics_claude_reset_label(reset_at: Option<&str>) -> String {
    reset_at
        .map(|value| format!("Resets {}", value))
        .unwrap_or_else(|| "Reset time unavailable".to_string())
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
        "pace_delta_percent": 0,
        "status_label": status_label,
        "reset_label": reset_label,
        "rate_points": [],
    })
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
    let auth_path = env::var("HOME")
        .ok()
        .map(PathBuf::from)
        .map(|home| home.join(".codex").join("auth.json"));
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
            1_030,
            TOKENOMICS_CODEX_USAGE_CACHE_TTL_SECS,
        )
        .unwrap()
        .expect("fresh cache");

        assert_eq!(
            cached["rate_limit"]["primary_window"]["reset_after_seconds"],
            json!(270)
        );
        assert_eq!(
            cached["rate_limit"]["secondary_window"]["reset_after_seconds"],
            json!(604_770)
        );
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
    fn tokenomics_account_sync_rollups_collapse_workspace_metadata() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
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
                   'hour', 'unix-hour-test', ?4, ?5, 0,
                   0, ?6, 0, 1, '2026-05-30T05:00:00Z'
                 )",
                rusqlite::params![id, workspace_id, repo_path, input_tokens, output_tokens, total_tokens],
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
        let by_device = summary["by_device"].as_array().unwrap();
        let by_device_provider = summary["by_device_provider"].as_array().unwrap();
        let by_device_account = summary["by_device_account"].as_array().unwrap();
        let daily_by_device_provider = summary["daily_by_device_provider"].as_array().unwrap();

        assert_eq!(by_device.len(), 1);
        assert_eq!(by_device[0]["total_tokens"], json!(42));
        assert_eq!(by_device_provider.len(), 2);
        assert_eq!(by_device_account.len(), 2);
        assert!(by_device_account
            .iter()
            .any(
                |row| row["provider_account_key"] == json!("openai:codex:personal")
                    && row["total_tokens"] == json!(11)
            ));
        assert!(by_device_account
            .iter()
            .any(
                |row| row["provider_account_key"] == json!("openai:codex:work")
                    && row["total_tokens"] == json!(31)
            ));
        assert_eq!(daily_by_device_provider.len(), 2);
        for legacy_key in [
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
        assert_eq!(identity.device_id, "macos-history");
        assert_eq!(identity.billing_scope.scope_type, "personal");
        assert_eq!(identity.billing_scope.source, "legacy_provider_restore");
    }

    #[test]
    fn tokenomics_summary_derives_days_from_hourly_without_double_counting() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();

        for (id, bucket_width, bucket_start, total_tokens) in [
            ("hour-rollup", "hour", "2026-05-31T00", 12_i64),
            ("day-rollup", "day", "2026-05-31", 999_i64),
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
        assert_eq!(summary["daily"][0]["bucket_start"], json!("2026-05-31"));
        assert_eq!(summary["daily"][0]["total_tokens"], json!(12));
        assert_eq!(
            summary["daily_by_device_provider"][0]["provider_account_key"],
            json!("openai:codex:work")
        );
        assert_eq!(
            summary["daily_by_device_provider"][0]["total_tokens"],
            json!(12)
        );
    }

    #[test]
    fn tokenomics_summary_monthly_is_not_limited_to_daily_window() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();

        for day in 1..=35_i64 {
            let bucket_start = if day <= 31 {
                format!("2026-05-{day:02}")
            } else {
                format!("2026-06-{:02}", day - 31)
            };
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
                    format!("rollup-day-{day}"),
                    bucket_start,
                    day,
                ],
            )
            .unwrap();
        }

        let summary = tokenomics_summary_from_conn(&conn, false, None).unwrap();
        assert_eq!(summary["daily"].as_array().unwrap().len(), 30);
        assert_eq!(summary["monthly"][0]["bucket_start"], json!("2026-06-01"));
        assert_eq!(summary["monthly"][0]["total_tokens"], json!(134));
        assert_eq!(summary["monthly"][1]["bucket_start"], json!("2026-05-01"));
        assert_eq!(summary["monthly"][1]["total_tokens"], json!(496));
        assert_eq!(
            summary["monthly_by_device_provider"][0]["provider_account_key"],
            json!("openai:codex:personal")
        );
        assert_eq!(
            summary["monthly_by_device_provider"][0]["total_tokens"],
            json!(134)
        );
    }

    #[test]
    fn tokenomics_account_sync_rollups_preserve_provider_accounts() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
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
                   'hour', 'unix-hour-test', 0, 0, 0,
                   0, ?4, 0, 1, '2026-05-30T05:00:00Z'
                 )",
                rusqlite::params![id, account_key, account_label, total_tokens],
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
        assert!(personal_rollups
            .iter()
            .any(|row| row["billing_scope_key"] == json!("personal")));
        assert!(personal_rollups
            .iter()
            .any(|row| row["billing_scope_key"] == json!("unknown")));
        assert!(!personal_rollups
            .iter()
            .any(|row| row["billing_scope_key"] == json!("team:team-a")));
    }

    #[test]
    fn tokenomics_account_sync_rollups_preserve_models_for_same_account() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
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
                   'hour', 'unix-hour-test', 0, 0, 0,
                   0, ?3, 0, 1, '2026-05-30T05:00:00Z'
                 )",
                rusqlite::params![id, model, total_tokens],
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
                   'hour', 'unix-hour-test', 0, 0, 0,
                   0, ?3, 0, 1, '2026-05-30T05:00:00Z'
                 )",
                rusqlite::params![id, device_id, total_tokens],
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
        for (id, bucket_width, bucket_start) in [
            ("local-hour", "hour", "2026-05-30T05"),
            ("local-day", "day", "2026-05-30"),
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
               'hour', '2026-05-30T05', 0, 0, 0,
               0, 7, 0, 1, '2026-05-30T05:00:00Z', '2026-05-30T05:00:00Z'
             )",
            [],
        )
        .unwrap();
        tokenomics_refresh_cloud_daily_rollups(&conn).unwrap();

        let display = tokenomics_summary_from_conn_with_cloud(&conn, false, None, true).unwrap();
        let local_only =
            tokenomics_summary_from_conn_with_cloud(&conn, false, None, false).unwrap();
        let sync_rollups = tokenomics_account_hourly_sync_rollups(&conn, None, None).unwrap();

        assert_eq!(display["total"]["total_tokens"], json!(12));
        assert_eq!(local_only["total"]["total_tokens"], json!(5));
        assert!(display["by_device"].as_array().unwrap().iter().any(|row| {
            row["device_id"] == json!("remote-device") && row["total_tokens"] == json!(7)
        }));
        assert_eq!(sync_rollups.len(), 1);
        assert_eq!(sync_rollups[0]["device_id"], json!("local-device"));
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
        )
        .unwrap();

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
        assert_eq!(scan_states, 0);
        assert_eq!(source_offsets, 0);
    }

    #[test]
    fn tokenomics_account_sync_rollups_include_rolling_30_day_boundary() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        let window_start: String = conn
            .query_row(
                "SELECT strftime('%Y-%m-%dT00', 'now', '-29 days')",
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
        assert!(account
            .label
            .chars()
            .all(|character| character.is_ascii_uppercase()));
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
        assert_eq!(new_rollups.len(), 2);
        assert!(new_rollups.iter().all(|row| {
            row["provider_account_key"] == json!("anthropic:claude:stable")
                && row["provider_account_label"] == json!("Claude Syed")
                && row["total_tokens"] == json!(10)
                && row["event_count"] == json!(1)
        }));
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
}

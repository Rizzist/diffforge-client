const TOKENOMICS_DB_FILE: &str = "tokenomics.sqlite3";
const TOKENOMICS_SCAN_MAX_FILES_PER_PROVIDER: usize = 120;
const TOKENOMICS_SCAN_MAX_LINE_BYTES: usize = 256 * 1024;
const TOKENOMICS_SCAN_MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
const TOKENOMICS_SYNC_ROLLUP_LIMIT: usize = 5000;
const TOKENOMICS_CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/codex/usage";
const TOKENOMICS_CODEX_SCANNER_VERSION: &str = "codex-token-count-v4-account-aware";
const TOKENOMICS_GENERIC_SCANNER_VERSION: &str = "generic-tokenomics-v2-account-aware";
const TOKENOMICS_INITIAL_BACKFILL_DAYS: u64 = 30;
const TOKENOMICS_SCAN_PROGRESS_EVENT: &str = "diffforge://tokenomics-scan-progress";
static TOKENOMICS_SCAN_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();

use std::io::BufRead as _;

#[tauri::command]
async fn tokenomics_scan_usage(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || tokenomics_scan_usage_for(&app))
        .await
        .map_err(|error| format!("Unable to join Tokenomics scan: {error}"))?
}

#[tauri::command]
async fn tokenomics_get_summary(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || tokenomics_summary_for(&app, false))
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
    tauri::async_runtime::spawn_blocking(move || tokenomics_summary_for(&app, true))
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
        tokenomics_sync_delta_from_conn(&conn, since_updated_at.as_deref())
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
           provider TEXT NOT NULL,
           agent_kind TEXT NOT NULL,
           model TEXT,
           subscription_key TEXT,
           provider_account_key TEXT,
           provider_account_label TEXT,
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
           provider TEXT NOT NULL,
           agent_kind TEXT NOT NULL,
           model TEXT,
           subscription_key TEXT,
           provider_account_key TEXT,
           provider_account_label TEXT,
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
         CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_provider ON tokenomics_rollups(provider, agent_kind, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_workspace ON tokenomics_rollups(workspace_id, bucket_width, bucket_start);
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_observed ON tokenomics_usage_events(observed_at);
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
    tokenomics_ensure_column(
        conn,
        "tokenomics_usage_events",
        "provider_account_key",
        "TEXT",
    )?;
    tokenomics_ensure_column(
        conn,
        "tokenomics_usage_events",
        "provider_account_label",
        "TEXT",
    )?;
    tokenomics_ensure_column(
        conn,
        "tokenomics_rollups",
        "provider_account_key",
        "TEXT",
    )?;
    tokenomics_ensure_column(
        conn,
        "tokenomics_rollups",
        "provider_account_label",
        "TEXT",
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tokenomics_rollups_account ON tokenomics_rollups(provider, agent_kind, provider_account_key, bucket_width, bucket_start)",
        [],
    )
    .map_err(|error| format!("Unable to create Tokenomics account index: {error}"))?;
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

fn tokenomics_scan_usage_for(app: &AppHandle) -> Result<Value, String> {
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
            });
            return Ok(summary);
        }
        Err(std::sync::TryLockError::Poisoned(error)) => error.into_inner(),
    };
    let conn = tokenomics_open_db(app)?;
    let mut scanned_files = 0usize;
    let mut inserted_events = 0usize;
    let mut sources = Vec::new();

    tokenomics_reconcile_codex_provider_before_scan(&conn)?;
    let codex_result = tokenomics_scan_codex_state_db(app, &conn)?;
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
    });
    Ok(summary)
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
        "claude" => tokenomics_home_dir()
            .map(|home| home.join(".claude").join(".credentials.json"))
            .and_then(tokenomics_read_json_file),
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
        return TokenomicsProviderAccount {
            key: format!("{provider}:{agent_kind}:unknown"),
            label: base_label,
        };
    }
    let hash = tokenomics_hash(&format!("{provider}:{agent_kind}:{fingerprint}"));
    let suffix = hash.get(0..8).unwrap_or(hash.as_str());
    TokenomicsProviderAccount {
        key: format!("{provider}:{agent_kind}:{suffix}"),
        label: format!("{base_label} {suffix}"),
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

fn tokenomics_read_json_file(path: PathBuf) -> Option<Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
}

fn tokenomics_collect_json_values_for_keys(value: &Value, keys: &[&str], output: &mut Vec<String>) {
    if let Some(object) = value.as_object() {
        for (key, item) in object {
            if keys.iter().any(|candidate| key.eq_ignore_ascii_case(candidate)) {
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

fn tokenomics_collect_jwt_account_identifiers(value: &Value, output: &mut Vec<String>) {
    if let Some(text) = value.as_str() {
        if let Some(payload) = tokenomics_decode_jwt_payload(text) {
            tokenomics_collect_json_values_for_keys(
                &payload,
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
    } else if let Some(object) = value.as_object() {
        for item in object.values() {
            tokenomics_collect_jwt_account_identifiers(item, output);
        }
    } else if let Some(array) = value.as_array() {
        for item in array {
            tokenomics_collect_jwt_account_identifiers(item, output);
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

fn tokenomics_unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn tokenomics_emit_scan_progress(app: &AppHandle, payload: Value) {
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
    let remaining_days = now_unix.saturating_sub(clamped).checked_div(86_400).unwrap_or(0);
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
        return value.parse::<i64>().ok().map(tokenomics_normalize_unix_timestamp);
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
    if needs_scanner_reset || accountless_events > 0 {
        tokenomics_delete_provider_rows(conn, "openai", "codex")?;
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
                if let Ok(summary) = tokenomics_summary_from_conn(conn, true, Some(inserted_events)) {
                    progress["summary"] = summary;
                }
            }
            tokenomics_emit_scan_progress(app, progress);
        }

        let (mtime, size) = tokenomics_file_mtime_size(&candidate.rollout_path);
        let offset = tokenomics_get_source_offset(conn, "openai", "codex", &candidate.rollout_path)?;
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
        newest_event_timestamp =
            newest_event_timestamp.max(file_scan.last_event_timestamp.max(candidate.updated_at_unix));
        tokenomics_upsert_source_offset(
            conn,
            "openai",
            "codex",
            &candidate.rollout_path,
            TOKENOMICS_CODEX_SCANNER_VERSION,
            file_scan.last_line_index,
            file_scan.last_event_timestamp.max(candidate.updated_at_unix),
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
    tokenomics_emit_scan_progress(app, complete_progress);

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
        let Some(last_usage) = payload
            .get("info")
            .and_then(|info| info.get("last_token_usage").or_else(|| info.get("lastTokenUsage")))
        else {
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
            provider_account.key,
            path.display()
        );
        let event = TokenomicsUsageEvent {
            id: tokenomics_hash(&identity),
            provider: provider.to_string(),
            agent_kind: "codex".to_string(),
            model: model.map(str::to_string),
            subscription_key: Some(provider_account.key.clone()),
            provider_account_key: Some(provider_account.key.clone()),
            provider_account_label: Some(provider_account.label.clone()),
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
    let Some((input_rate, cache_rate, output_rate)) = tokenomics_codex_credit_rates_per_million(model) else {
        return 0;
    };
    let uncached_input = input_tokens.saturating_sub(cache_read_tokens).max(0) as f64;
    let cached_input = cache_read_tokens.max(0) as f64;
    let output = output_tokens.max(0) as f64;
    let credits =
        (uncached_input * input_rate + cached_input * cache_rate + output * output_rate)
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
            "provider_account_key": event.provider_account_key.as_deref(),
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
    provider: String,
    agent_kind: String,
    model: Option<String>,
    subscription_key: Option<String>,
    provider_account_key: Option<String>,
    provider_account_label: Option<String>,
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
    inherited_model: Option<String>,
    inherited_timestamp: Option<String>,
    output: &mut Vec<TokenomicsUsageEvent>,
) {
    let mut model = inherited_model;
    let mut timestamp = inherited_timestamp;
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
                model.clone(),
                timestamp.clone(),
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
                model.clone(),
                timestamp.clone(),
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
                model.clone(),
                timestamp.clone(),
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
    model: Option<String>,
    timestamp: Option<String>,
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
        provider: provider.to_string(),
        agent_kind: agent_kind.to_string(),
        model,
        subscription_key: Some(provider_account.key.clone()),
        provider_account_key: Some(provider_account.key.clone()),
        provider_account_label: Some(provider_account.label.clone()),
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

fn tokenomics_insert_event(
    conn: &rusqlite::Connection,
    event: &TokenomicsUsageEvent,
) -> Result<bool, String> {
    let changed = conn
        .execute(
            "INSERT OR IGNORE INTO tokenomics_usage_events(
               id, provider, agent_kind, model, subscription_key,
               provider_account_key, provider_account_label, workspace_id, repo_path,
               source_kind, source_path, bucket_day, bucket_hour,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
               total_tokens, estimated_cost_microusd, created_at, observed_at
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
            rusqlite::params![
                event.id.as_str(),
                event.provider.as_str(),
                event.agent_kind.as_str(),
                event.model.as_deref(),
                event.subscription_key.as_deref(),
                event.provider_account_key.as_deref(),
                event.provider_account_label.as_deref(),
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
        "{}:{}:{}:{}:{}:{}:{}:{}",
        event.provider,
        event.agent_kind,
        event.model.as_deref().unwrap_or_default(),
        event.subscription_key.as_deref().unwrap_or_default(),
        event.provider_account_key.as_deref().unwrap_or_default(),
        event.workspace_id.as_deref().unwrap_or_default(),
        bucket_width,
        bucket_start,
    ));
    let now = tokenomics_now_iso_like();
    conn.execute(
        "INSERT INTO tokenomics_rollups(
           id, provider, agent_kind, model, subscription_key,
           provider_account_key, provider_account_label, workspace_id, repo_path,
           bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
           cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 1, ?18)
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
           updated_at=excluded.updated_at",
        rusqlite::params![
            rollup_id,
            event.provider.as_str(),
            event.agent_kind.as_str(),
            event.model.as_deref(),
            event.subscription_key.as_deref(),
            event.provider_account_key.as_deref(),
            event.provider_account_label.as_deref(),
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
        usage
            .get("model")
            .and_then(Value::as_str)
            .map(|value| value.to_string()),
        usage
            .get("created_at")
            .or_else(|| usage.get("createdAt"))
            .and_then(Value::as_str)
            .map(|value| value.to_string()),
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

fn tokenomics_summary_for(app: &AppHandle, include_rollups: bool) -> Result<Value, String> {
    let conn = tokenomics_open_db(app)?;
    tokenomics_summary_from_conn(&conn, include_rollups, None)
}

fn tokenomics_reconcile_codex_provider_before_scan(conn: &rusqlite::Connection) -> Result<(), String> {
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
    let account_key_sql = "COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, ''), provider || ':' || agent_kind || ':unknown')";
    let account_label_sql = "COALESCE(NULLIF(provider_account_label, ''), CASE WHEN agent_kind='codex' THEN 'Codex account' WHEN agent_kind='claude' THEN 'Claude account' WHEN agent_kind='opencode' THEN 'OpenCode account' ELSE agent_kind || ' account' END)";
    let total = tokenomics_query_one(conn, "SELECT COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COALESCE(SUM(cache_read_tokens), 0), COALESCE(SUM(cache_write_tokens), 0), COALESCE(SUM(total_tokens), 0), COALESCE(SUM(estimated_cost_microusd), 0), COALESCE(SUM(event_count), 0) FROM tokenomics_rollups WHERE bucket_width='day'")?;
    let by_provider = tokenomics_query_rows(
        conn,
        "SELECT provider, agent_kind, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM tokenomics_rollups WHERE bucket_width='day' GROUP BY provider, agent_kind ORDER BY total_tokens DESC LIMIT 12",
    )?;
    let by_account = tokenomics_query_rows(
        conn,
        &format!(
            "SELECT provider, agent_kind, {account_key_sql} AS provider_account_key, {account_label_sql} AS provider_account_label, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM tokenomics_rollups WHERE bucket_width='day' GROUP BY provider, agent_kind, provider_account_key ORDER BY total_tokens DESC LIMIT 40"
        ),
    )?;
    let daily = tokenomics_query_rows(
        conn,
        "SELECT bucket_start, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM tokenomics_rollups WHERE bucket_width='day' GROUP BY bucket_start ORDER BY bucket_start DESC LIMIT 14",
    )?;
    let daily_by_provider = tokenomics_query_rows(
        conn,
        &format!(
            "SELECT provider, agent_kind, {account_key_sql} AS provider_account_key, {account_label_sql} AS provider_account_label, bucket_start, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM tokenomics_rollups WHERE bucket_width='day' GROUP BY provider, agent_kind, provider_account_key, bucket_start ORDER BY bucket_start DESC LIMIT 240"
        ),
    )?;
    let hourly_by_provider = tokenomics_query_rows(
        conn,
        &format!(
            "SELECT provider, agent_kind, {account_key_sql} AS provider_account_key, {account_label_sql} AS provider_account_label, bucket_start, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM tokenomics_rollups WHERE bucket_width='hour' GROUP BY provider, agent_kind, provider_account_key, bucket_start ORDER BY bucket_start DESC LIMIT 480"
        ),
    )?;
    let session_hourly_by_provider = tokenomics_query_rows(
        conn,
        &format!("WITH params(now_ts) AS (SELECT CAST(strftime('%s', 'now') AS INTEGER)),
         event_rows AS (
           SELECT e.provider, e.agent_kind, e.model, {account_key_sql} AS provider_account_key,
                  {account_label_sql} AS provider_account_label, e.input_tokens, e.output_tokens,
                  e.cache_read_tokens, e.cache_write_tokens, e.total_tokens,
                  e.estimated_cost_microusd,
                  CAST(strftime('%s', e.created_at) AS INTEGER) AS event_ts,
                  params.now_ts AS now_ts
           FROM tokenomics_usage_events e, params
           WHERE e.created_at IS NOT NULL
             AND CAST(strftime('%s', e.created_at) AS INTEGER) > params.now_ts - 18000
             AND CAST(strftime('%s', e.created_at) AS INTEGER) <= params.now_ts
         ),
         indexed AS (
           SELECT provider, agent_kind, model, provider_account_key, provider_account_label,
                  input_tokens, output_tokens,
                  cache_read_tokens, cache_write_tokens, total_tokens,
                  estimated_cost_microusd,
                  CAST(((event_ts - (now_ts - 18000)) / 3600) AS INTEGER) AS window_index
           FROM event_rows
         )
         SELECT provider, agent_kind, provider_account_key, provider_account_label, window_index,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
                COALESCE(SUM(total_tokens), 0) AS total_tokens,
                COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd,
                COUNT(*) AS event_count
         FROM indexed
         WHERE window_index BETWEEN 0 AND 4
         GROUP BY provider, agent_kind, provider_account_key, window_index
         ORDER BY window_index ASC"),
    )?;
    let by_model = tokenomics_query_rows(
        conn,
        &format!(
            "SELECT provider, agent_kind, {account_key_sql} AS provider_account_key, {account_label_sql} AS provider_account_label, COALESCE(NULLIF(model, ''), agent_kind) AS model, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM tokenomics_rollups WHERE bucket_width='day' GROUP BY provider, agent_kind, provider_account_key, COALESCE(NULLIF(model, ''), agent_kind) ORDER BY total_tokens DESC LIMIT 40"
        ),
    )?;
    let accounts = tokenomics_query_rows(
        conn,
        &format!(
            "SELECT provider, agent_kind, {account_key_sql} AS provider_account_key, {account_label_sql} AS provider_account_label, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(event_count), 0) AS event_count FROM tokenomics_rollups WHERE bucket_width='day' GROUP BY provider, agent_kind, provider_account_key ORDER BY total_tokens DESC LIMIT 40"
        ),
    )?;
    let limits = tokenomics_provider_limits(conn)?;
    let recent_rollups = if include_rollups {
        tokenomics_account_hourly_sync_rollups(conn, None)?
    } else {
        Vec::new()
    };
    Ok(json!({
        "known": total.get("total_tokens").and_then(Value::as_i64).unwrap_or(0) > 0,
        "source": "rust_local_tokenomics_sqlite",
        "updated_at": tokenomics_now_iso_like(),
        "inserted_events": inserted_events.unwrap_or(0),
        "total": total,
        "by_provider": by_provider,
        "by_account": by_account,
        "by_model": by_model,
        "daily": daily,
        "daily_by_provider": daily_by_provider,
        "hourly_by_provider": hourly_by_provider,
        "session_hourly_by_provider": session_hourly_by_provider,
        "accounts": accounts,
        "rollups": recent_rollups,
        "sources": [
            {"provider": "anthropic", "agent_kind": "claude", "label": "Claude Code"},
            {"provider": "openai", "agent_kind": "codex", "label": "Codex"},
            {"provider": "opencode", "agent_kind": "opencode", "label": "OpenCode"}
        ],
        "limits": limits,
    }))
}

fn tokenomics_account_hourly_sync_rollups(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
) -> Result<Vec<Value>, String> {
    let clean_since = since_updated_at
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let account_key_sql = "COALESCE(NULLIF(provider_account_key, ''), NULLIF(subscription_key, ''), provider || ':' || agent_kind || ':unknown')";
    let account_label_sql = "COALESCE(NULLIF(provider_account_label, ''), CASE WHEN agent_kind='codex' THEN 'Codex account' WHEN agent_kind='claude' THEN 'Claude account' WHEN agent_kind='opencode' THEN 'OpenCode account' ELSE agent_kind || ' account' END)";
    let mut statement = conn
        .prepare(
            &format!("SELECT
               provider,
               agent_kind,
               NULL AS model,
               {account_key_sql} AS subscription_key,
               {account_key_sql} AS provider_account_key,
               {account_label_sql} AS provider_account_label,
               NULL AS workspace_id,
               NULL AS repo_path,
               'hour' AS bucket_width,
               bucket_start,
               0 AS input_tokens,
               0 AS output_tokens,
               0 AS cache_read_tokens,
               0 AS cache_write_tokens,
               COALESCE(SUM(total_tokens), 0) AS total_tokens,
               0 AS estimated_cost_microusd,
               COALESCE(SUM(event_count), 0) AS event_count,
               MAX(updated_at) AS updated_at
             FROM tokenomics_rollups
             WHERE bucket_width='hour'
               AND (
                 bucket_start >= strftime('%Y-%m-%dT%H', 'now', '-30 days')
                 OR bucket_start LIKE 'unix-hour-%'
               )
               AND (?1 IS NULL OR updated_at >= ?1)
             GROUP BY provider, agent_kind, subscription_key, provider_account_key, bucket_start
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
        rollups.push(row.map_err(|error| format!("Unable to read Tokenomics account sync row: {error}"))?);
    }
    Ok(rollups)
}

fn tokenomics_sync_delta_from_conn(
    conn: &rusqlite::Connection,
    since_updated_at: Option<&str>,
) -> Result<Value, String> {
    let clean_since = since_updated_at
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let rollups = tokenomics_account_hourly_sync_rollups(conn, clean_since)?;
    let sync_cursor = rollups
        .iter()
        .filter_map(|row| row.get("updated_at").and_then(Value::as_str))
        .max()
        .map(ToOwned::to_owned)
        .or_else(|| clean_since.map(ToOwned::to_owned));
    let rollup_count = rollups.len();
    Ok(json!({
        "known": rollup_count > 0,
        "source": "rust_local_tokenomics_sqlite_delta",
        "updated_at": tokenomics_now_iso_like(),
        "sync_cursor": sync_cursor,
        "rollup_count": rollup_count,
        "rollups": rollups,
        "limits": tokenomics_provider_limits(conn)?,
    }))
}

fn tokenomics_provider_limits(_conn: &rusqlite::Connection) -> Result<Vec<Value>, String> {
    let mut limits = Vec::new();

    let codex_plan = tokenomics_codex_plan_state();
    let codex_account = tokenomics_provider_account("openai", "codex");
    if let Some(codex_usage) = tokenomics_codex_live_usage(&codex_plan) {
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
    if let Some(claude_limits) =
        tokenomics_claude_statusline_limits(&claude_plan, &claude_account)
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

fn tokenomics_codex_live_usage(plan: &Value) -> Option<Value> {
    let access_token = plan
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
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
        .unwrap_or("Claude subscription");
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
        &["used_percentage", "usedPercentage", "used_percent", "usedPercent"],
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
        "limit_source": "not_exposed",
        "confidence": "unknown",
        "allowance_unit": "unknown",
        "used": Value::Null,
        "allowance": Value::Null,
        "remaining": Value::Null,
        "used_percent": Value::Null,
        "remaining_percent": Value::Null,
        "pace_delta_percent": 0,
        "status_label": "Plan limit not exposed",
        "reset_label": if window_kind == "5_hour" { "Provider limit unavailable" } else { "Provider schedule unavailable" },
        "rate_points": [],
    })
}

fn tokenomics_codex_status_label(remaining_percent: i64, limit_reached: bool, allowed: bool) -> &'static str {
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
        return format!("Resets in {}", tokenomics_format_duration(reset_after_seconds as u64));
    }
    if let Some(reset_at) = reset_at.filter(|value| *value > 0) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0);
        if reset_at > now {
            return format!("Resets in {}", tokenomics_format_duration((reset_at - now) as u64));
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
            item.as_i64().or_else(|| {
                item.as_f64()
                    .filter(|number| number.is_finite())
                    .map(|number| number.round() as i64)
            }).or_else(|| item.as_str().and_then(|text| text.parse::<i64>().ok()))
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
    let has_oauth = credentials
        .as_ref()
        .and_then(|value| value.get("claudeAiOauth"))
        .map(|value| !value.is_null())
        .unwrap_or(false);
    json!({
        "plan_detected": has_oauth,
        "plan_name": if has_oauth { "Claude subscription" } else { "No Claude auth detected" },
        "plan_source": if credentials.is_some() { "claude_credentials_file" } else { "not_found" },
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
            .query_row("SELECT COUNT(*) FROM tokenomics_usage_events", [], |row| row.get(0))
            .unwrap();
        assert_eq!(event_count, 0);
        let state =
            tokenomics_get_scan_state(&conn, "openai", "codex", "/tmp/state_5.sqlite").unwrap();
        assert!(state.is_none());
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
        for (id, workspace_id, repo_path, total_tokens) in [
            ("rollup-a", "workspace-a", "/tmp/repo-a", 5_i64),
            ("rollup-b", "workspace-b", "/tmp/repo-b", 7_i64),
        ] {
            conn.execute(
                "INSERT INTO tokenomics_rollups(
                   id, provider, agent_kind, model, subscription_key, workspace_id, repo_path,
                   bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
                   cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
                 ) VALUES(
                   ?1, 'openai', 'codex', NULL, 'openai:codex', ?2, ?3,
                   'hour', 'unix-hour-test', 0, 0, 0,
                   0, ?4, 0, 1, '2026-05-30T05:00:00Z'
                 )",
                rusqlite::params![id, workspace_id, repo_path, total_tokens],
            )
            .unwrap();
        }

        let rollups = tokenomics_account_hourly_sync_rollups(&conn, None).unwrap();

        assert_eq!(rollups.len(), 1);
        assert!(rollups[0]["workspace_id"].is_null());
        assert!(rollups[0]["repo_path"].is_null());
        assert_eq!(rollups[0]["total_tokens"], json!(12));
        assert_eq!(rollups[0]["event_count"], json!(2));
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
        let by_provider = summary["by_provider"].as_array().unwrap();
        let by_account = summary["by_account"].as_array().unwrap();
        let daily_by_provider = summary["daily_by_provider"].as_array().unwrap();

        assert_eq!(by_provider.len(), 1);
        assert_eq!(by_provider[0]["total_tokens"], json!(42));
        assert_eq!(by_account.len(), 2);
        assert!(by_account
            .iter()
            .any(|row| row["provider_account_key"] == json!("openai:codex:personal")
                && row["total_tokens"] == json!(11)));
        assert!(by_account.iter().any(|row| row["provider_account_key"] == json!("openai:codex:work")
            && row["total_tokens"] == json!(31)));
        assert_eq!(daily_by_provider.len(), 2);
    }

    #[test]
    fn tokenomics_account_sync_rollups_preserve_provider_accounts() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        tokenomics_prepare_db(&conn).unwrap();
        for (id, account_key, account_label, total_tokens) in [
            ("rollup-personal", "openai:codex:personal", "Codex personal", 5_i64),
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

        let rollups = tokenomics_account_hourly_sync_rollups(&conn, None).unwrap();

        assert_eq!(rollups.len(), 2);
        assert!(rollups
            .iter()
            .any(|row| row["provider_account_key"] == json!("openai:codex:personal")
                && row["total_tokens"] == json!(5)));
        assert!(rollups.iter().any(|row| row["provider_account_key"] == json!("openai:codex:work")
                && row["total_tokens"] == json!(7)));
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
        assert!(account_a.label.starts_with("Codex account "));
    }
}

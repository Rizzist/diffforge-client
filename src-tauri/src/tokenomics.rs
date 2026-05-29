const TOKENOMICS_DB_FILE: &str = "tokenomics.sqlite3";
const TOKENOMICS_SCAN_MAX_FILES_PER_PROVIDER: usize = 120;
const TOKENOMICS_SCAN_MAX_LINE_BYTES: usize = 256 * 1024;
const TOKENOMICS_SCAN_MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
const TOKENOMICS_RECENT_ROLLUP_LIMIT: usize = 240;

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
async fn tokenomics_get_sync_payload(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || tokenomics_summary_for(&app, true))
        .await
        .map_err(|error| format!("Unable to join Tokenomics sync payload: {error}"))?
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
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|error| format!("Unable to open Tokenomics database {}: {error}", db_path.display()))?;
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
         CREATE INDEX IF NOT EXISTS idx_tokenomics_usage_events_observed ON tokenomics_usage_events(observed_at);",
    )
    .map_err(|error| format!("Unable to prepare Tokenomics database: {error}"))?;
    Ok(())
}

fn tokenomics_scan_usage_for(app: &AppHandle) -> Result<Value, String> {
    let conn = tokenomics_open_db(app)?;
    let mut scanned_files = 0usize;
    let mut inserted_events = 0usize;
    let mut sources = Vec::new();

    for source in tokenomics_sources() {
        let mut source_files = 0usize;
        let mut source_inserted = 0usize;
        for root in source.roots {
            if !root.exists() {
                continue;
            }
            let files = tokenomics_collect_candidate_files(&root, TOKENOMICS_SCAN_MAX_FILES_PER_PROVIDER);
            for file in files {
                source_files += 1;
                scanned_files += 1;
                source_inserted += tokenomics_scan_file(&conn, &source.provider, &source.agent_kind, &file)?;
            }
        }
        inserted_events += source_inserted;
        sources.push(json!({
            "provider": source.provider,
            "agent_kind": source.agent_kind,
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
    let home = env::var("HOME").ok().map(PathBuf::from);
    let mut sources = Vec::new();
    if let Some(home) = home {
        sources.push(TokenomicsSource {
            provider: "anthropic",
            agent_kind: "claude",
            roots: vec![home.join(".claude").join("projects")],
        });
        sources.push(TokenomicsSource {
            provider: "openai",
            agent_kind: "codex",
            roots: vec![home.join(".codex").join("sessions"), home.join(".codex").join("history")],
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

fn tokenomics_collect_candidate_files_inner(root: &Path, depth: usize, files: &mut Vec<(u64, PathBuf)>) {
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
    path: &Path,
) -> Result<usize, String> {
    let content = fs::read_to_string(path).map_err(|error| {
        format!("Unable to read Tokenomics source file {}: {error}", path.display())
    })?;
    let mut inserted = 0usize;
    let is_jsonl = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("jsonl") || value.eq_ignore_ascii_case("ndjson"))
        .unwrap_or(false);
    if is_jsonl {
        for (line_index, line) in content.lines().enumerate() {
            if line.trim().is_empty() || line.len() > TOKENOMICS_SCAN_MAX_LINE_BYTES {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                inserted += tokenomics_record_usage_json_tree(
                    conn,
                    provider,
                    agent_kind,
                    Some(path),
                    Some(line_index),
                    &value,
                )?;
            }
        }
    } else if let Ok(value) = serde_json::from_str::<Value>(&content) {
        inserted += tokenomics_record_usage_json_tree(conn, provider, agent_kind, Some(path), None, &value)?;
    }
    Ok(inserted)
}

fn tokenomics_record_usage_json_tree(
    conn: &rusqlite::Connection,
    provider: &str,
    agent_kind: &str,
    path: Option<&Path>,
    line_index: Option<usize>,
    value: &Value,
) -> Result<usize, String> {
    let mut extracted = Vec::new();
    tokenomics_extract_usage_events(value, provider, agent_kind, None, None, &mut extracted);
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
                model.clone(),
                timestamp.clone(),
                output,
            );
        }
    }
}

fn tokenomics_object_looks_like_usage(object: &serde_json::Map<String, Value>) -> bool {
    ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens", "output_tokens", "outputTokens", "completion_tokens", "completionTokens"]
        .iter()
        .any(|key| object.get(*key).and_then(Value::as_i64).unwrap_or(0) > 0)
}

fn tokenomics_usage_event_from_value(
    value: &Value,
    provider: &str,
    agent_kind: &str,
    model: Option<String>,
    timestamp: Option<String>,
) -> Option<TokenomicsUsageEvent> {
    let input_tokens = tokenomics_usage_number(value, &[
        "input_tokens",
        "inputTokens",
        "prompt_tokens",
        "promptTokens",
        "input",
        "prompt",
    ]);
    let output_tokens = tokenomics_usage_number(value, &[
        "output_tokens",
        "outputTokens",
        "completion_tokens",
        "completionTokens",
        "output",
        "completion",
    ]);
    let cache_read_tokens = tokenomics_usage_number(value, &[
        "cache_read_tokens",
        "cacheReadTokens",
        "cache_read_input_tokens",
        "cacheReadInputTokens",
        "cached_tokens",
        "cachedTokens",
    ]);
    let cache_write_tokens = tokenomics_usage_number(value, &[
        "cache_write_tokens",
        "cacheWriteTokens",
        "cache_creation_input_tokens",
        "cacheCreationInputTokens",
    ]);
    let total_tokens = tokenomics_usage_number(value, &["total_tokens", "totalTokens", "total"])
        .max(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens);
    if total_tokens <= 0 {
        return None;
    }
    let observed_at = tokenomics_now_iso_like();
    let created_at = timestamp.filter(|value| !value.is_empty()).or_else(|| Some(observed_at.clone()));
    let (bucket_day, bucket_hour) = tokenomics_buckets(created_at.as_deref().unwrap_or(&observed_at));
    Some(TokenomicsUsageEvent {
        id: String::new(),
        provider: provider.to_string(),
        agent_kind: agent_kind.to_string(),
        model,
        subscription_key: Some(format!("{provider}:{agent_kind}")),
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

fn tokenomics_insert_event(conn: &rusqlite::Connection, event: &TokenomicsUsageEvent) -> Result<bool, String> {
    let changed = conn
        .execute(
            "INSERT OR IGNORE INTO tokenomics_usage_events(
               id, provider, agent_kind, model, subscription_key, workspace_id, repo_path,
               source_kind, source_path, bucket_day, bucket_hour,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
               total_tokens, estimated_cost_microusd, created_at, observed_at
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            rusqlite::params![
                event.id.as_str(),
                event.provider.as_str(),
                event.agent_kind.as_str(),
                event.model.as_deref(),
                event.subscription_key.as_deref(),
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
        "{}:{}:{}:{}:{}:{}:{}",
        event.provider,
        event.agent_kind,
        event.model.as_deref().unwrap_or_default(),
        event.subscription_key.as_deref().unwrap_or_default(),
        event.workspace_id.as_deref().unwrap_or_default(),
        bucket_width,
        bucket_start,
    ));
    let now = tokenomics_now_iso_like();
    conn.execute(
        "INSERT INTO tokenomics_rollups(
           id, provider, agent_kind, model, subscription_key, workspace_id, repo_path,
           bucket_width, bucket_start, input_tokens, output_tokens, cache_read_tokens,
           cache_write_tokens, total_tokens, estimated_cost_microusd, event_count, updated_at
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 1, ?16)
         ON CONFLICT(id)
         DO UPDATE SET
           input_tokens=tokenomics_rollups.input_tokens+excluded.input_tokens,
           output_tokens=tokenomics_rollups.output_tokens+excluded.output_tokens,
           cache_read_tokens=tokenomics_rollups.cache_read_tokens+excluded.cache_read_tokens,
           cache_write_tokens=tokenomics_rollups.cache_write_tokens+excluded.cache_write_tokens,
           total_tokens=tokenomics_rollups.total_tokens+excluded.total_tokens,
           estimated_cost_microusd=tokenomics_rollups.estimated_cost_microusd+excluded.estimated_cost_microusd,
           event_count=tokenomics_rollups.event_count+1,
           updated_at=excluded.updated_at",
        rusqlite::params![
            rollup_id,
            event.provider.as_str(),
            event.agent_kind.as_str(),
            event.model.as_deref(),
            event.subscription_key.as_deref(),
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
    let Some(mut event) = tokenomics_usage_event_from_value(
        usage,
        &provider,
        &agent_kind,
        usage.get("model").and_then(Value::as_str).map(|value| value.to_string()),
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
        .or(event.subscription_key);
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

fn tokenomics_summary_from_conn(
    conn: &rusqlite::Connection,
    include_rollups: bool,
    inserted_events: Option<usize>,
) -> Result<Value, String> {
    let total = tokenomics_query_one(conn, "SELECT COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COALESCE(SUM(cache_read_tokens), 0), COALESCE(SUM(cache_write_tokens), 0), COALESCE(SUM(total_tokens), 0), COALESCE(SUM(estimated_cost_microusd), 0), COALESCE(SUM(event_count), 0) FROM tokenomics_rollups WHERE bucket_width='day'")?;
    let by_provider = tokenomics_query_rows(
        conn,
        "SELECT provider, agent_kind, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM tokenomics_rollups WHERE bucket_width='day' GROUP BY provider, agent_kind ORDER BY total_tokens DESC LIMIT 12",
    )?;
    let daily = tokenomics_query_rows(
        conn,
        "SELECT bucket_start, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_microusd), 0) AS estimated_cost_microusd, COALESCE(SUM(event_count), 0) AS event_count FROM tokenomics_rollups WHERE bucket_width='day' GROUP BY bucket_start ORDER BY bucket_start DESC LIMIT 14",
    )?;
    let recent_rollups = if include_rollups {
        tokenomics_query_rows(
            conn,
            &format!(
                "SELECT * FROM tokenomics_rollups ORDER BY updated_at DESC LIMIT {}",
                TOKENOMICS_RECENT_ROLLUP_LIMIT
            ),
        )?
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
        "daily": daily,
        "rollups": recent_rollups,
        "sources": [
            {"provider": "anthropic", "agent_kind": "claude", "label": "Claude Code"},
            {"provider": "openai", "agent_kind": "codex", "label": "Codex"},
            {"provider": "opencode", "agent_kind": "opencode", "label": "OpenCode"}
        ],
        "limits": [],
    }))
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
                    rusqlite::types::ValueRef::Blob(value) => Value::String(tokenomics_hash(&String::from_utf8_lossy(value))),
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

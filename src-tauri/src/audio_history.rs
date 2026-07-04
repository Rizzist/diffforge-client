// Durable, paginated store for the audio/dictation transcription history.
//
// History used to live entirely in the webview `localStorage` (capped at 500
// items). That cannot scale and forces the whole list across the IPC boundary.
// This module keeps the full history in SQLite and exposes keyset/offset
// paginated reads plus SQL-computed summary aggregates, so the frontend only
// ever pulls the visible window (a few dozen rows) regardless of total size.
//
// The frontend sends a numeric `createdAtMs` on every entry so the backend
// never has to parse date strings; ordering and the heatmap buckets are all
// derived from that single integer column.

const AUDIO_HISTORY_DB_FILE: &str = "history.sqlite";
const AUDIO_HISTORY_DB_DIR: &str = "audio-history";
const AUDIO_HISTORY_APPENDED_EVENT: &str = "audio-history-appended";
const AUDIO_HISTORY_CHANGED_EVENT: &str = "audio-history-changed";
const AUDIO_HISTORY_MAX_PAGE_LIMIT: i64 = 200;
const AUDIO_HISTORY_DEFAULT_PAGE_LIMIT: i64 = 60;
const AUDIO_HISTORY_HEATMAP_DAYS: i64 = 7 * 18;
// How long the single shared connection stays warm after the last access before
// it is closed (which checkpoints + truncates the WAL). Long enough to keep a
// dictation/scroll burst fast, short enough that an unused feature holds nothing.
const AUDIO_HISTORY_IDLE_CLOSE_SECS: u64 = 30;

static AUDIO_HISTORY_ID_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn audio_history_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = device_data_path(
        app,
        Path::new(AUDIO_HISTORY_DB_DIR),
        DeviceDataMigrationStrategy::PreferNewest,
    )?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Unable to create audio history directory: {error}"))?;
    Ok(dir.join(AUDIO_HISTORY_DB_FILE))
}

fn audio_history_open(path: &Path) -> Result<rusqlite::Connection, String> {
    let connection = rusqlite::Connection::open(path)
        .map_err(|error| format!("Unable to open audio history database: {error}"))?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA busy_timeout=4000;
             CREATE TABLE IF NOT EXISTS audio_history (
                 id TEXT PRIMARY KEY,
                 created_at_ms INTEGER NOT NULL,
                 audio_ms INTEGER NOT NULL DEFAULT 0,
                 latency_ms INTEGER NOT NULL DEFAULT 0,
                 word_count INTEGER NOT NULL DEFAULT 0,
                 payload TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_audio_history_created
                 ON audio_history (created_at_ms DESC, id DESC);",
        )
        .map_err(|error| format!("Unable to initialize audio history database: {error}"))?;
    Ok(connection)
}

// A single connection is kept warm only while the history is actively being
// used, then closed on idle. An idle (or closed) connection costs nothing:
// SQLite has no background threads, so this is purely about not holding a handle
// + page cache + WAL mapping when the feature is unused -- it never polls or
// spins the CPU. The idle reaper is one self-extending sleeping task, not a poll.
#[derive(Default)]
struct AudioHistoryStoreInner {
    connection: Option<rusqlite::Connection>,
    path: Option<PathBuf>,
    last_used: Option<std::time::Instant>,
    reaper_armed: bool,
}

#[derive(Default)]
struct AudioHistoryStore {
    inner: std::sync::Mutex<AudioHistoryStoreInner>,
}

fn audio_history_store() -> &'static AudioHistoryStore {
    static STORE: std::sync::OnceLock<AudioHistoryStore> = std::sync::OnceLock::new();
    STORE.get_or_init(AudioHistoryStore::default)
}

// Run `work` against the warm shared connection, opening it (and initializing the
// schema) only if it is closed or pointing at a different path. Returns the work
// result and whether a fresh idle reaper needs to be armed by the async caller.
fn audio_history_with_connection<T>(
    path: &Path,
    work: impl FnOnce(&mut rusqlite::Connection) -> Result<T, String>,
) -> Result<(T, bool), String> {
    let store = audio_history_store();
    let mut guard = store
        .inner
        .lock()
        .map_err(|_| "Audio history store is unavailable.".to_string())?;

    let reuse = matches!(
        (&guard.connection, &guard.path),
        (Some(_), Some(existing)) if existing.as_path() == path
    );
    if !reuse {
        guard.connection = Some(audio_history_open(path)?);
        guard.path = Some(path.to_path_buf());
    }

    let result = {
        let connection = guard
            .connection
            .as_mut()
            .ok_or_else(|| "Audio history connection is unavailable.".to_string())?;
        work(connection)?
    };

    guard.last_used = Some(std::time::Instant::now());
    let arm_reaper = !guard.reaper_armed;
    if arm_reaper {
        guard.reaper_armed = true;
    }
    Ok((result, arm_reaper))
}

// One self-extending sleeping task per warm session: it sleeps until the idle
// deadline, and if the connection was touched again it re-sleeps for the
// remaining time; otherwise it closes the connection (dropping it checkpoints +
// truncates the WAL) and exits. No polling.
async fn audio_history_arm_idle_reaper() {
    let store = audio_history_store();
    let idle = std::time::Duration::from_secs(AUDIO_HISTORY_IDLE_CLOSE_SECS);
    loop {
        let sleep_for = {
            let mut guard = match store.inner.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            if guard.connection.is_none() {
                guard.reaper_armed = false;
                return;
            }
            let elapsed = guard
                .last_used
                .map(|instant| instant.elapsed())
                .unwrap_or(idle);
            if elapsed >= idle {
                guard.connection = None;
                guard.path = None;
                guard.last_used = None;
                guard.reaper_armed = false;
                return;
            }
            idle - elapsed
        };
        tokio::time::sleep(sleep_for).await;
    }
}

fn audio_history_value_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    for key in keys {
        match value.get(*key) {
            Some(Value::Number(number)) => {
                if let Some(parsed) = number.as_i64() {
                    return Some(parsed);
                }
                if let Some(parsed) = number.as_f64() {
                    return Some(parsed.round() as i64);
                }
            }
            Some(Value::String(text)) => {
                if let Ok(parsed) = text.trim().parse::<f64>() {
                    return Some(parsed.round() as i64);
                }
            }
            _ => {}
        }
    }
    None
}

fn audio_history_word_count_from_text(value: &Value) -> i64 {
    value
        .get("text")
        .and_then(Value::as_str)
        .map(|text| text.split_whitespace().filter(|word| !word.is_empty()).count() as i64)
        .unwrap_or(0)
}

struct AudioHistoryRecord {
    id: String,
    created_at_ms: i64,
    audio_ms: i64,
    latency_ms: i64,
    word_count: i64,
    payload: String,
}

fn audio_history_record_from_value(entry: &Value) -> Result<AudioHistoryRecord, String> {
    if !entry.is_object() {
        return Err("Audio history entry must be an object.".to_string());
    }

    let created_at_ms = audio_history_value_i64(entry, &["createdAtMs", "created_at_ms", "createdAt"])
        .filter(|value| *value > 0)
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
                .unwrap_or(0)
        });

    let id = entry
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            let counter = AUDIO_HISTORY_ID_COUNTER
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            format!("audio-{created_at_ms}-{counter}")
        });

    let audio_ms = audio_history_value_i64(entry, &["audioMs", "audio_ms", "durationMs", "duration_ms"])
        .unwrap_or(0)
        .max(0);
    let latency_ms = audio_history_value_i64(entry, &["latencyMs", "latency_ms"])
        .unwrap_or(0)
        .max(0);
    let word_count = audio_history_value_i64(entry, &["wordCount", "word_count"])
        .unwrap_or_else(|| audio_history_word_count_from_text(entry))
        .max(0);

    // Persist the id we resolved so the row always round-trips with a stable key.
    let mut payload_value = entry.clone();
    if let Some(object) = payload_value.as_object_mut() {
        object.insert("id".to_string(), Value::String(id.clone()));
        object.insert("createdAtMs".to_string(), Value::Number(created_at_ms.into()));
    }
    let payload = serde_json::to_string(&payload_value)
        .map_err(|error| format!("Unable to serialize audio history entry: {error}"))?;

    Ok(AudioHistoryRecord {
        id,
        created_at_ms,
        audio_ms,
        latency_ms,
        word_count,
        payload,
    })
}

fn audio_history_insert_record(
    connection: &rusqlite::Connection,
    record: &AudioHistoryRecord,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO audio_history (id, created_at_ms, audio_ms, latency_ms, word_count, payload)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                 created_at_ms = excluded.created_at_ms,
                 audio_ms = excluded.audio_ms,
                 latency_ms = excluded.latency_ms,
                 word_count = excluded.word_count,
                 payload = excluded.payload",
            rusqlite::params![
                record.id,
                record.created_at_ms,
                record.audio_ms,
                record.latency_ms,
                record.word_count,
                record.payload,
            ],
        )
        .map(|_| ())
        .map_err(|error| format!("Unable to write audio history entry: {error}"))
}

fn audio_history_payload_to_value(payload: &str) -> Value {
    serde_json::from_str::<Value>(payload).unwrap_or(Value::Null)
}

fn audio_history_append_blocking(
    connection: &rusqlite::Connection,
    entry: Value,
) -> Result<Value, String> {
    let record = audio_history_record_from_value(&entry)?;
    audio_history_insert_record(connection, &record)?;
    Ok(audio_history_payload_to_value(&record.payload))
}

fn audio_history_import_blocking(
    connection: &mut rusqlite::Connection,
    entries: Vec<Value>,
) -> Result<i64, String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Unable to begin audio history import: {error}"))?;
    let mut imported = 0i64;
    for entry in &entries {
        let Ok(record) = audio_history_record_from_value(entry) else {
            continue;
        };
        // Import is additive and idempotent: keep whatever is already stored.
        let changed = transaction
            .execute(
                "INSERT OR IGNORE INTO audio_history
                     (id, created_at_ms, audio_ms, latency_ms, word_count, payload)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    record.id,
                    record.created_at_ms,
                    record.audio_ms,
                    record.latency_ms,
                    record.word_count,
                    record.payload,
                ],
            )
            .map_err(|error| format!("Unable to import audio history entry: {error}"))?;
        imported += changed as i64;
    }
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit audio history import: {error}"))?;
    Ok(imported)
}

fn audio_history_page_blocking(
    connection: &rusqlite::Connection,
    offset: Option<i64>,
    limit: i64,
    before_created_at_ms: Option<i64>,
    before_id: Option<String>,
) -> Result<Value, String> {
    let limit = limit.clamp(1, AUDIO_HISTORY_MAX_PAGE_LIMIT);
    // Fetch one extra row to learn whether more remain without a second query.
    let fetch_limit = limit + 1;

    let mut payloads: Vec<String> = Vec::new();

    if let (Some(cursor_ms), Some(cursor_id)) = (before_created_at_ms, before_id.clone()) {
        // Keyset page: everything strictly older than the cursor in the stable
        // (created_at_ms DESC, id DESC) order. Stays correct as rows are
        // prepended at the head.
        let mut statement = connection
            .prepare(
                "SELECT payload FROM audio_history
                 WHERE created_at_ms < ?1 OR (created_at_ms = ?1 AND id < ?2)
                 ORDER BY created_at_ms DESC, id DESC
                 LIMIT ?3",
            )
            .map_err(|error| format!("Unable to read audio history page: {error}"))?;
        let rows = statement
            .query_map(rusqlite::params![cursor_ms, cursor_id, fetch_limit], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| format!("Unable to read audio history page: {error}"))?;
        for row in rows {
            payloads.push(row.map_err(|error| format!("Unable to read audio history row: {error}"))?);
        }
    } else {
        let resolved_offset = offset.unwrap_or(0).max(0);
        let mut statement = connection
            .prepare(
                "SELECT payload FROM audio_history
                 ORDER BY created_at_ms DESC, id DESC
                 LIMIT ?1 OFFSET ?2",
            )
            .map_err(|error| format!("Unable to read audio history page: {error}"))?;
        let rows = statement
            .query_map(rusqlite::params![fetch_limit, resolved_offset], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| format!("Unable to read audio history page: {error}"))?;
        for row in rows {
            payloads.push(row.map_err(|error| format!("Unable to read audio history row: {error}"))?);
        }
    }

    let has_more = payloads.len() as i64 > limit;
    payloads.truncate(limit as usize);
    let items: Vec<Value> = payloads
        .iter()
        .map(|payload| audio_history_payload_to_value(payload))
        .collect();

    Ok(json!({
        "items": items,
        "hasMore": has_more,
        "limit": limit,
        "offset": offset.unwrap_or(0).max(0),
    }))
}

fn audio_history_summary_blocking(connection: &rusqlite::Connection) -> Result<Value, String> {
    let (total, audio_ms, timed_words, total_words): (i64, i64, i64, i64) = connection
        .query_row(
            "SELECT
                 COUNT(*),
                 COALESCE(SUM(CASE WHEN audio_ms > 0 THEN audio_ms ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN audio_ms > 0 THEN word_count ELSE 0 END), 0),
                 COALESCE(SUM(word_count), 0)
             FROM audio_history",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|error| format!("Unable to read audio history summary: {error}"))?;

    let average_wpm = if audio_ms > 0 {
        ((timed_words as f64) / (audio_ms as f64 / 60000.0)).round() as i64
    } else {
        0
    };

    // Words-per-day for the heatmap window, bucketed by local date in SQL so the
    // frontend never has to scan the full history to render the grid.
    let cutoff_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
        - AUDIO_HISTORY_HEATMAP_DAYS * 24 * 60 * 60 * 1000;

    let mut words_by_day = serde_json::Map::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT date(created_at_ms / 1000, 'unixepoch', 'localtime') AS day,
                        COALESCE(SUM(word_count), 0) AS words
                 FROM audio_history
                 WHERE created_at_ms >= ?1
                 GROUP BY day",
            )
            .map_err(|error| format!("Unable to read audio history heatmap: {error}"))?;
        let rows = statement
            .query_map(rusqlite::params![cutoff_ms.max(0)], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|error| format!("Unable to read audio history heatmap: {error}"))?;
        for row in rows {
            let (day, words) =
                row.map_err(|error| format!("Unable to read audio history heatmap row: {error}"))?;
            words_by_day.insert(day, Value::Number(words.into()));
        }
    }

    Ok(json!({
        "totalDictations": total,
        "audioMs": audio_ms,
        "averageWpm": average_wpm,
        "totalWords": total_words,
        "wordsByDay": Value::Object(words_by_day),
    }))
}

fn audio_history_clear_blocking(connection: &rusqlite::Connection) -> Result<(), String> {
    connection
        .execute("DELETE FROM audio_history", [])
        .map(|_| ())
        .map_err(|error| format!("Unable to clear audio history: {error}"))
}

// Arm the idle reaper from the async (runtime) context after a blocking call
// reported that the connection was freshly opened / no reaper was running.
fn audio_history_arm_reaper_if_needed(arm: bool) {
    if arm {
        tokio::spawn(audio_history_arm_idle_reaper());
    }
}

#[tauri::command]
async fn audio_history_append(app: AppHandle, entry: Value) -> Result<Value, String> {
    let path = audio_history_db_path(&app)?;
    let (stored, arm) = tokio::task::spawn_blocking(move || {
        audio_history_with_connection(&path, |connection| {
            audio_history_append_blocking(connection, entry)
        })
    })
    .await
    .map_err(|error| format!("Audio history append task failed: {error}"))??;
    audio_history_arm_reaper_if_needed(arm);
    let _ = app.emit(AUDIO_HISTORY_APPENDED_EVENT, &stored);
    Ok(stored)
}

#[tauri::command]
async fn audio_history_import(app: AppHandle, entries: Vec<Value>) -> Result<Value, String> {
    let path = audio_history_db_path(&app)?;
    let (imported, arm) = tokio::task::spawn_blocking(move || {
        audio_history_with_connection(&path, |connection| {
            audio_history_import_blocking(connection, entries)
        })
    })
    .await
    .map_err(|error| format!("Audio history import task failed: {error}"))??;
    audio_history_arm_reaper_if_needed(arm);
    if imported > 0 {
        let _ = app.emit(AUDIO_HISTORY_CHANGED_EVENT, json!({ "reason": "import" }));
    }
    Ok(json!({ "imported": imported }))
}

#[tauri::command]
async fn audio_history_page(
    app: AppHandle,
    offset: Option<i64>,
    limit: Option<i64>,
    before_created_at_ms: Option<i64>,
    before_id: Option<String>,
) -> Result<Value, String> {
    let path = audio_history_db_path(&app)?;
    let limit = limit.unwrap_or(AUDIO_HISTORY_DEFAULT_PAGE_LIMIT);
    let (page, arm) = tokio::task::spawn_blocking(move || {
        audio_history_with_connection(&path, |connection| {
            audio_history_page_blocking(connection, offset, limit, before_created_at_ms, before_id)
        })
    })
    .await
    .map_err(|error| format!("Audio history page task failed: {error}"))??;
    audio_history_arm_reaper_if_needed(arm);
    Ok(page)
}

#[tauri::command]
async fn audio_history_summary(app: AppHandle) -> Result<Value, String> {
    let path = audio_history_db_path(&app)?;
    let (summary, arm) = tokio::task::spawn_blocking(move || {
        audio_history_with_connection(&path, |connection| audio_history_summary_blocking(connection))
    })
    .await
    .map_err(|error| format!("Audio history summary task failed: {error}"))??;
    audio_history_arm_reaper_if_needed(arm);
    Ok(summary)
}

#[tauri::command]
async fn audio_history_clear(app: AppHandle) -> Result<(), String> {
    let path = audio_history_db_path(&app)?;
    let (_, arm) = tokio::task::spawn_blocking(move || {
        audio_history_with_connection(&path, |connection| audio_history_clear_blocking(connection))
    })
    .await
    .map_err(|error| format!("Audio history clear task failed: {error}"))??;
    audio_history_arm_reaper_if_needed(arm);
    let _ = app.emit(AUDIO_HISTORY_CHANGED_EVENT, json!({ "reason": "clear" }));
    Ok(())
}

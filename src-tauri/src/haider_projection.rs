// Render projection for Haider-backed session views. This file is include!d
// into lib.rs so it intentionally reuses the sessions database, write lock,
// clock, status reducer, and Tauri imports from the crate root.

const HAIDER_PROJECTION_EXPORT_TIMEOUT: Duration = Duration::from_secs(10);
const HAIDER_PROJECTION_MAX_EXPORT_BYTES: u64 = 32 * 1024 * 1024;
const HAIDER_PROJECTION_MAX_LINE_BYTES: usize = 2 * 1024 * 1024;
const HAIDER_PROJECTION_MAX_WINDOW_ROWS: i64 = 1_000;
const HAIDER_PROJECTION_WATCH_LIMIT: usize = 6;
const HAIDER_PROJECTION_FRAME_TIME: Duration = Duration::from_millis(50);
const HAIDER_PROJECTION_ROWS_EVENT: &str = "session-rows-appended";

#[derive(Clone, Debug, PartialEq, Serialize)]
struct SessionProjectionRow {
    #[serde(skip_serializing)]
    session_id: String,
    seq: i64,
    kind: String,
    role: String,
    text: String,
    meta: Value,
    at_ms: i64,
}

#[derive(Debug, Serialize)]
struct SessionProjectionWindow {
    total_rows: i64,
    start_index: i64,
    rows: Vec<SessionProjectionRow>,
    live_tail: Option<SessionProjectionRow>,
}

#[derive(Clone, Debug)]
struct HaiderProjectionTail {
    item_id: String,
    row: SessionProjectionRow,
}

#[derive(Debug)]
struct HaiderProjectionFoldState {
    next_fallback_seq: i64,
    total_rows: i64,
    tail: Option<HaiderProjectionTail>,
    metadata: serde_json::Map<String, Value>,
    effect_summaries: HashMap<String, String>,
    seen_sequences: HashSet<i64>,
}

impl Default for HaiderProjectionFoldState {
    fn default() -> Self {
        Self {
            next_fallback_seq: 1,
            total_rows: 0,
            tail: None,
            metadata: serde_json::Map::new(),
            effect_summaries: HashMap::new(),
            seen_sequences: HashSet::new(),
        }
    }
}

#[derive(Debug, Default)]
struct HaiderProjectionFoldStep {
    rows: Vec<SessionProjectionRow>,
    status: Option<String>,
    tail_changed: bool,
}

#[derive(Clone, Debug)]
struct HaiderProjectionFrame {
    session_id: String,
    from_seq: Option<i64>,
    appended: usize,
    total_rows: i64,
    live_tail: Option<SessionProjectionRow>,
    tail_changed: bool,
}

#[derive(Clone, Serialize)]
struct HaiderProjectionEvent {
    session_id: String,
    from_seq: Option<i64>,
    appended: usize,
    total_rows: i64,
    live_tail: Option<SessionProjectionRow>,
}

struct HaiderProjectionWatch {
    child: Arc<StdMutex<std::process::Child>>,
    generation: u64,
    touched: u64,
}

#[derive(Default)]
struct HaiderProjectionWatchManager {
    watches: HashMap<String, HaiderProjectionWatch>,
    clock: u64,
}

static HAIDER_PROJECTION_STOPPING: AtomicBool = AtomicBool::new(false);
static HAIDER_PROJECTION_WATCH_GENERATION: AtomicU64 = AtomicU64::new(1);

fn haider_projection_states() -> &'static StdMutex<HashMap<String, HaiderProjectionFoldState>> {
    static STATES: OnceLock<StdMutex<HashMap<String, HaiderProjectionFoldState>>> = OnceLock::new();
    STATES.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn haider_projection_watch_manager() -> &'static StdMutex<HaiderProjectionWatchManager> {
    static MANAGER: OnceLock<StdMutex<HaiderProjectionWatchManager>> = OnceLock::new();
    MANAGER.get_or_init(|| StdMutex::new(HaiderProjectionWatchManager::default()))
}

fn haider_projection_ensure_lock() -> &'static StdMutex<()> {
    static LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| StdMutex::new(()))
}

fn haider_projection_open_database() -> Result<rusqlite::Connection, String> {
    let connection = sessions_open_database()?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS session_projection_rows (
                session_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                kind TEXT NOT NULL,
                role TEXT NOT NULL,
                text TEXT NOT NULL,
                meta TEXT NOT NULL,
                at_ms INTEGER NOT NULL,
                PRIMARY KEY (session_id, seq)
             );
             CREATE INDEX IF NOT EXISTS idx_session_projection_rows_order
                ON session_projection_rows(session_id, seq);",
        )
        .map_err(|error| format!("Unable to initialize session projection store: {error}"))?;
    Ok(connection)
}

fn haider_projection_database_stats(session_id: &str) -> Result<(i64, i64), String> {
    let connection = haider_projection_open_database()?;
    connection
        .query_row(
            "SELECT COUNT(*), COALESCE(MAX(seq), 0)
             FROM session_projection_rows WHERE session_id = ?1",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("Unable to inspect session projection: {error}"))
}

fn haider_projection_initialize_state(session_id: &str) -> Result<(), String> {
    if haider_projection_states()
        .lock()
        .map_err(|_| "Session projection state is unavailable.".to_string())?
        .contains_key(session_id)
    {
        return Ok(());
    }
    let (total_rows, max_seq) = haider_projection_database_stats(session_id)?;
    let mut states = haider_projection_states()
        .lock()
        .map_err(|_| "Session projection state is unavailable.".to_string())?;
    states
        .entry(session_id.to_string())
        .or_insert_with(|| HaiderProjectionFoldState {
            next_fallback_seq: max_seq.saturating_add(1).max(1),
            total_rows,
            ..HaiderProjectionFoldState::default()
        });
    Ok(())
}

fn haider_projection_json_i64(value: Option<&Value>) -> Option<i64> {
    let raw = match value? {
        Value::Number(number) => number.as_i64().or_else(|| {
            number
                .as_u64()
                .map(|value| value.min(i64::MAX as u64) as i64)
        }),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    }?;
    Some(raw.max(0))
}

fn haider_projection_text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) if !text.trim().is_empty() => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn haider_projection_extract_text(value: &Value) -> Option<String> {
    if let Some(text) = haider_projection_text(Some(value)) {
        return Some(text);
    }
    if let Some(values) = value.as_array() {
        let joined = values
            .iter()
            .filter_map(haider_projection_extract_text)
            .collect::<Vec<_>>()
            .join("");
        return (!joined.trim().is_empty()).then_some(joined);
    }
    let object = value.as_object()?;
    for key in [
        "text",
        "message",
        "summary",
        "content",
        "output_text",
        "reason",
        "report",
        "items",
    ] {
        if let Some(text) = object.get(key).and_then(haider_projection_extract_text) {
            return Some(text);
        }
    }
    None
}

fn haider_projection_compact(value: &str, limit: usize) -> String {
    let flattened = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if flattened.chars().count() <= limit {
        return flattened;
    }
    let mut text = flattened
        .chars()
        .take(limit.saturating_sub(1))
        .collect::<String>();
    text.push('…');
    text
}

fn haider_projection_payload(value: &Value) -> &Value {
    value
        .as_object()
        .and_then(|object| object.get("payload"))
        .unwrap_or(value)
}

fn haider_projection_kind(value: &Value, key: &str) -> Option<String> {
    let candidate = value.as_object()?.get(key)?;
    haider_projection_text(Some(candidate)).or_else(|| {
        candidate.as_object().and_then(|object| {
            [key, "kind", "type", "state", "status", "outcome"]
                .iter()
                .find_map(|nested| haider_projection_text(object.get(*nested)))
        })
    })
}

fn haider_projection_seq(
    state: &mut HaiderProjectionFoldState,
    envelope: &Value,
    item: &Value,
) -> i64 {
    let explicit = envelope
        .as_object()
        .and_then(|object| haider_projection_json_i64(object.get("seq")))
        .or_else(|| {
            item.as_object()
                .and_then(|object| haider_projection_json_i64(object.get("seq")))
        });
    if let Some(seq) = explicit {
        state.next_fallback_seq = state.next_fallback_seq.max(seq.saturating_add(1));
        return seq;
    }
    let seq = state.next_fallback_seq.max(1);
    state.next_fallback_seq = seq.saturating_add(1);
    seq
}

fn haider_projection_at_ms(envelope: &Value, item: &Value) -> i64 {
    for value in [envelope, item] {
        let Some(object) = value.as_object() else {
            continue;
        };
        for key in ["committed_at_ms", "at_ms", "created_at_ms", "timestamp_ms"] {
            if let Some(timestamp) = haider_projection_json_i64(object.get(key)) {
                return timestamp;
            }
        }
    }
    sessions_now_ms()
}

fn haider_projection_row(
    session_id: &str,
    seq: i64,
    kind: &str,
    role: &str,
    text: String,
    meta: Value,
    at_ms: i64,
) -> SessionProjectionRow {
    SessionProjectionRow {
        session_id: session_id.to_string(),
        seq,
        kind: kind.to_string(),
        role: role.to_string(),
        text,
        meta,
        at_ms,
    }
}

fn haider_projection_tool_summary(item: &Value) -> String {
    let object = item.as_object();
    let kind = object
        .and_then(|object| haider_projection_text(object.get("item")))
        .or_else(|| object.and_then(|object| haider_projection_text(object.get("type"))))
        .unwrap_or_else(|| "tool".to_string());
    let name = object.and_then(|object| {
        ["name", "tool", "command", "path", "call_id"]
            .iter()
            .find_map(|key| haider_projection_text(object.get(*key)))
    });
    let status = object.and_then(|_| {
        ["status", "phase", "outcome"]
            .iter()
            .find_map(|key| haider_projection_kind(item, key))
    });
    let summary = object.and_then(|object| {
        ["summary", "preview", "result", "report"]
            .iter()
            .find_map(|key| object.get(*key).and_then(haider_projection_extract_text))
    });
    let mut parts = vec![name.unwrap_or(kind)];
    if let Some(status) = status {
        parts.push(status);
    }
    if let Some(summary) = summary {
        parts.push(haider_projection_compact(&summary, 160));
    }
    haider_projection_compact(&parts.join(" · "), 240)
}

fn haider_projection_item_class(item: &Value) -> (&'static str, &'static str) {
    let kind = item
        .as_object()
        .and_then(|object| {
            haider_projection_text(object.get("item"))
                .or_else(|| haider_projection_text(object.get("type")))
        })
        .unwrap_or_default()
        .to_ascii_lowercase();
    match kind.as_str() {
        "agent_message" | "assistant" | "assistant_message" | "output_text" => {
            ("message", "assistant")
        }
        "incomplete_agent_message" => ("message", "assistant"),
        "reasoning" | "plan" => ("message", "assistant"),
        "refusal" => ("error", "assistant"),
        "tool_call" | "command_execution" | "file_change" | "child_spawn" | "child_result"
        | "context_compaction" | "extension" => ("tool", "tool"),
        _ => ("", ""),
    }
}

fn haider_projection_row_from_item(
    state: &mut HaiderProjectionFoldState,
    session_id: &str,
    envelope: &Value,
    item: &Value,
    fallback_text: Option<String>,
) -> Option<SessionProjectionRow> {
    let (kind, role) = haider_projection_item_class(item);
    if kind.is_empty() {
        return None;
    }
    let seq = haider_projection_seq(state, envelope, item);
    let at_ms = haider_projection_at_ms(envelope, item);
    let text = if kind == "tool" {
        haider_projection_tool_summary(item)
    } else {
        haider_projection_extract_text(item)
            .or(fallback_text)
            .unwrap_or_default()
    };
    Some(haider_projection_row(
        session_id,
        seq,
        kind,
        role,
        text,
        item.clone(),
        at_ms,
    ))
}

fn haider_projection_export_row(
    state: &mut HaiderProjectionFoldState,
    session_id: &str,
    item: &Value,
) -> Option<SessionProjectionRow> {
    let object = item.as_object()?;
    let role = haider_projection_text(object.get("role"))?.to_ascii_lowercase();
    let (kind, rendered_role, text) = match role.as_str() {
        "user" => (
            "message",
            "user",
            haider_projection_extract_text(item).unwrap_or_default(),
        ),
        "assistant" => (
            "message",
            "assistant",
            haider_projection_extract_text(item).unwrap_or_default(),
        ),
        "tool" | "effect" => (
            "tool",
            "tool",
            object
                .get("summary")
                .and_then(haider_projection_extract_text)
                .unwrap_or_else(|| haider_projection_tool_summary(item)),
        ),
        "error" => (
            "error",
            "assistant",
            object
                .get("presentation")
                .and_then(haider_projection_extract_text)
                .unwrap_or_else(|| "Haider run failed".to_string()),
        ),
        _ => return None,
    };
    let seq = haider_projection_seq(state, item, item);
    Some(haider_projection_row(
        session_id,
        seq,
        kind,
        rendered_role,
        text,
        item.clone(),
        haider_projection_at_ms(item, item),
    ))
}

fn haider_projection_fold_item_event(
    state: &mut HaiderProjectionFoldState,
    session_id: &str,
    envelope: &Value,
    payload: &Value,
    step: &mut HaiderProjectionFoldStep,
) {
    let Some(object) = payload.as_object() else {
        return;
    };
    let event = haider_projection_text(object.get("event"))
        .unwrap_or_default()
        .to_ascii_lowercase();
    let item_id = haider_projection_text(object.get("item_id")).unwrap_or_default();
    match event.as_str() {
        "started" => {
            let Some(item) = object.get("item") else {
                return;
            };
            if let Some(row) =
                haider_projection_row_from_item(state, session_id, envelope, item, None)
            {
                state.tail = Some(HaiderProjectionTail { item_id, row });
                step.tail_changed = true;
            }
        }
        "delta" => {
            let Some(delta) = object.get("delta") else {
                return;
            };
            let delta_kind = haider_projection_kind(delta, "delta")
                .unwrap_or_default()
                .to_ascii_lowercase();
            if state
                .tail
                .as_ref()
                .is_none_or(|tail| tail.item_id != item_id)
            {
                let seq = haider_projection_seq(state, envelope, delta);
                state.tail = Some(HaiderProjectionTail {
                    item_id: item_id.clone(),
                    row: haider_projection_row(
                        session_id,
                        seq,
                        if matches!(delta_kind.as_str(), "tool_args" | "command_output") {
                            "tool"
                        } else {
                            "message"
                        },
                        if matches!(delta_kind.as_str(), "tool_args" | "command_output") {
                            "tool"
                        } else {
                            "assistant"
                        },
                        String::new(),
                        json!({"deltas": []}),
                        haider_projection_at_ms(envelope, delta),
                    ),
                });
            }
            let Some(tail) = state.tail.as_mut() else {
                return;
            };
            match delta_kind.as_str() {
                "text" | "reasoning" => {
                    if let Some(chunk) = delta
                        .as_object()
                        .and_then(|object| haider_projection_text(object.get("text")))
                    {
                        tail.row.text.push_str(&chunk);
                    }
                }
                "tool_args" => {
                    if let Some(fragment) = delta
                        .as_object()
                        .and_then(|object| haider_projection_text(object.get("fragment")))
                    {
                        tail.row.text =
                            haider_projection_compact(&format!("tool arguments · {fragment}"), 240);
                    }
                }
                "command_output" => {
                    let stream = haider_projection_kind(delta, "stream")
                        .unwrap_or_else(|| "output".to_string());
                    tail.row.text = format!("command output · {stream}");
                }
                _ => {}
            }
            if let Some(deltas) = tail
                .row
                .meta
                .as_object_mut()
                .and_then(|meta| meta.get_mut("deltas"))
                .and_then(Value::as_array_mut)
            {
                if deltas.len() < 256 {
                    deltas.push(delta.clone());
                }
            }
            step.tail_changed = true;
        }
        "completed" => {
            let tail_text = state
                .tail
                .as_ref()
                .filter(|tail| tail.item_id == item_id)
                .map(|tail| tail.row.text.clone());
            if let Some(item) = object.get("item") {
                if let Some(row) =
                    haider_projection_row_from_item(state, session_id, envelope, item, tail_text)
                {
                    step.rows.push(row);
                }
            }
            if state
                .tail
                .as_ref()
                .is_some_and(|tail| tail.item_id == item_id)
            {
                state.tail = None;
                step.tail_changed = true;
            }
        }
        _ => {
            if let Some(item) = object.get("item") {
                if let Some(row) =
                    haider_projection_row_from_item(state, session_id, envelope, item, None)
                {
                    step.rows.push(row);
                }
            }
        }
    }
}

fn haider_projection_fold_value_locked(
    state: &mut HaiderProjectionFoldState,
    session_id: &str,
    value: &Value,
) -> HaiderProjectionFoldStep {
    let mut step = HaiderProjectionFoldStep::default();
    if value
        .as_object()
        .is_some_and(|object| object.contains_key("payload"))
    {
        if let Some(seq) = value
            .as_object()
            .and_then(|object| haider_projection_json_i64(object.get("seq")))
        {
            if !state.seen_sequences.insert(seq) {
                return step;
            }
            if state.seen_sequences.len() > 16_384 {
                let floor = seq.saturating_sub(8_192);
                state.seen_sequences.retain(|seen| *seen >= floor);
            }
        }
    }
    let payload = haider_projection_payload(value);
    let payload_object = payload.as_object();

    if payload_object.is_some_and(|object| object.contains_key("role")) {
        if let Some(row) = haider_projection_export_row(state, session_id, payload) {
            step.rows.push(row);
        }
        return step;
    }

    let payload_type = payload_object
        .and_then(|object| haider_projection_text(object.get("type")))
        .unwrap_or_default()
        .to_ascii_lowercase();
    match payload_type.as_str() {
        "user_message" => {
            let seq = haider_projection_seq(state, value, payload);
            let text = haider_projection_extract_text(payload).unwrap_or_default();
            step.rows.push(haider_projection_row(
                session_id,
                seq,
                "message",
                "user",
                text,
                payload.clone(),
                haider_projection_at_ms(value, payload),
            ));
        }
        "item" => {
            haider_projection_fold_item_event(state, session_id, value, payload, &mut step);
        }
        "tool_result" => {
            let seq = haider_projection_seq(state, value, payload);
            step.rows.push(haider_projection_row(
                session_id,
                seq,
                "tool",
                "tool",
                haider_projection_tool_summary(payload),
                payload.clone(),
                haider_projection_at_ms(value, payload),
            ));
        }
        "run_failed" => {
            let seq = haider_projection_seq(state, value, payload);
            let text = payload_object
                .and_then(|object| {
                    ["presentation", "message", "code"]
                        .iter()
                        .find_map(|key| object.get(*key).and_then(haider_projection_extract_text))
                })
                .unwrap_or_else(|| "Haider run failed".to_string());
            step.rows.push(haider_projection_row(
                session_id,
                seq,
                "error",
                "assistant",
                text,
                payload.clone(),
                haider_projection_at_ms(value, payload),
            ));
            step.status = Some("error".to_string());
        }
        "effect" => {
            let effect_id = payload_object
                .and_then(|object| haider_projection_text(object.get("effect")))
                .unwrap_or_default();
            let phase = haider_projection_kind(payload, "phase")
                .unwrap_or_default()
                .to_ascii_lowercase();
            if phase == "intent" {
                if let Some(summary) =
                    payload_object.and_then(|object| haider_projection_text(object.get("summary")))
                {
                    state.effect_summaries.insert(effect_id, summary);
                }
            } else if phase == "outcome" {
                let summary = state
                    .effect_summaries
                    .remove(&effect_id)
                    .unwrap_or_else(|| "effect completed".to_string());
                let outcome = haider_projection_kind(payload, "outcome")
                    .unwrap_or_else(|| "unknown".to_string());
                let seq = haider_projection_seq(state, value, payload);
                step.rows.push(haider_projection_row(
                    session_id,
                    seq,
                    "tool",
                    "tool",
                    haider_projection_compact(&format!("{summary} · {outcome}"), 240),
                    payload.clone(),
                    haider_projection_at_ms(value, payload),
                ));
            }
        }
        "usage" | "run_state" | "session_state" => {
            state.metadata.insert(payload_type.clone(), payload.clone());
            if payload_type == "usage" {
                // Usage snapshots become rows so the trajectory view gets
                // per-turn token/cache points; the transcript skips the kind.
                let seq = haider_projection_seq(state, value, payload);
                step.rows.push(haider_projection_row(
                    session_id,
                    seq,
                    "usage",
                    "meta",
                    String::new(),
                    payload.clone(),
                    haider_projection_at_ms(value, payload),
                ));
            }
            if matches!(payload_type.as_str(), "run_state" | "session_state") {
                let state_text = payload_object
                    .and_then(|object| object.get("state"))
                    .and_then(haider_bridge_state_text);
                step.status = Some(haider_bridge_store_status(state_text.as_deref()).to_string());
            }
        }
        _ => {
            // Some export harnesses emit flat assistant/tool items without the
            // item lifecycle wrapper. Unknown shapes remain harmless.
            if let Some(row) =
                haider_projection_row_from_item(state, session_id, value, payload, None)
            {
                step.rows.push(row);
            }
        }
    }
    step
}

fn haider_projection_input_items(value: &Value) -> Vec<&Value> {
    if let Some(object) = value.as_object() {
        for key in ["turns", "items", "events", "rows"] {
            if let Some(values) = object.get(key).and_then(Value::as_array) {
                return values.iter().collect();
            }
        }
    }
    if let Some(values) = value.as_array() {
        return values.iter().collect();
    }
    vec![value]
}

fn haider_projection_persist_rows(rows: &[SessionProjectionRow]) -> Result<(usize, i64), String> {
    if rows.is_empty() {
        return Ok((0, 0));
    }
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    let mut connection = haider_projection_open_database()?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Unable to begin session projection write: {error}"))?;
    let mut appended = 0usize;
    for row in rows {
        appended = appended.saturating_add(
            transaction
                .execute(
                    "INSERT OR IGNORE INTO session_projection_rows
                     (session_id, seq, kind, role, text, meta, at_ms)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![
                        row.session_id,
                        row.seq,
                        row.kind,
                        row.role,
                        row.text,
                        serde_json::to_string(&row.meta).unwrap_or_else(|_| "null".to_string()),
                        row.at_ms,
                    ],
                )
                .map_err(|error| format!("Unable to append session projection row: {error}"))?,
        );
    }
    let total_rows = transaction
        .query_row(
            "SELECT COUNT(*) FROM session_projection_rows WHERE session_id = ?1",
            [&rows[0].session_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Unable to count session projection rows: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit session projection rows: {error}"))?;
    Ok((appended, total_rows))
}

fn haider_projection_apply_status(
    app: Option<&AppHandle>,
    session_id: &str,
    status: Option<String>,
) {
    let Some(status) = status else {
        return;
    };
    let result = session_update_blocking(SessionUpdateArgs {
        id: session_id.to_string(),
        title: None,
        status: Some(status),
        provider_session_id: None,
        first_user_message: None,
        touch: Some(true),
    });
    if result.is_ok() {
        if let Some(app) = app {
            sessions_emit_changed(app);
        }
    }
}

fn haider_projection_ingest_value(
    app: Option<&AppHandle>,
    session_id: &str,
    value: &Value,
) -> Result<HaiderProjectionFrame, String> {
    haider_projection_initialize_state(session_id)?;
    let mut all_rows = Vec::new();
    let mut status = None;
    let mut tail_changed = false;
    {
        let mut states = haider_projection_states()
            .lock()
            .map_err(|_| "Session projection state is unavailable.".to_string())?;
        let state = states
            .get_mut(session_id)
            .ok_or_else(|| "Session projection state was not initialized.".to_string())?;
        for item in haider_projection_input_items(value) {
            let step = haider_projection_fold_value_locked(state, session_id, item);
            all_rows.extend(step.rows);
            status = step.status.or(status);
            tail_changed |= step.tail_changed;
        }
    }
    let (appended, persisted_total) = haider_projection_persist_rows(&all_rows)?;
    let mut states = haider_projection_states()
        .lock()
        .map_err(|_| "Session projection state is unavailable.".to_string())?;
    let state = states
        .get_mut(session_id)
        .ok_or_else(|| "Session projection state was not initialized.".to_string())?;
    if !all_rows.is_empty() {
        state.total_rows = persisted_total;
    }
    let live_tail = state.tail.as_ref().map(|tail| tail.row.clone());
    let total_rows = state.total_rows;
    drop(states);
    haider_projection_apply_status(app, session_id, status);
    let from_seq = (appended > 0)
        .then(|| all_rows.iter().map(|row| row.seq).min())
        .flatten();
    Ok(HaiderProjectionFrame {
        session_id: session_id.to_string(),
        from_seq,
        appended,
        total_rows,
        live_tail,
        tail_changed,
    })
}

fn haider_projection_frame_sender(
    app: &AppHandle,
) -> tokio::sync::mpsc::UnboundedSender<HaiderProjectionFrame> {
    static SENDER: OnceLock<tokio::sync::mpsc::UnboundedSender<HaiderProjectionFrame>> =
        OnceLock::new();
    SENDER
        .get_or_init(|| {
            let (sender, mut receiver) =
                tokio::sync::mpsc::unbounded_channel::<HaiderProjectionFrame>();
            let emit_app = app.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(first) = receiver.recv().await {
                    let mut frames = HashMap::new();
                    frames.insert(first.session_id.clone(), first);
                    sleep(HAIDER_PROJECTION_FRAME_TIME).await;
                    while let Ok(next) = receiver.try_recv() {
                        frames
                            .entry(next.session_id.clone())
                            .and_modify(|frame: &mut HaiderProjectionFrame| {
                                frame.from_seq = match (frame.from_seq, next.from_seq) {
                                    (Some(left), Some(right)) => Some(left.min(right)),
                                    (None, value) | (value, None) => value,
                                };
                                frame.appended = frame.appended.saturating_add(next.appended);
                                frame.total_rows = next.total_rows;
                                if next.tail_changed {
                                    frame.live_tail = next.live_tail.clone();
                                    frame.tail_changed = true;
                                }
                            })
                            .or_insert(next);
                    }
                    for (_, frame) in frames {
                        let _ = emit_app.emit_to(
                            "main",
                            HAIDER_PROJECTION_ROWS_EVENT,
                            HaiderProjectionEvent {
                                session_id: frame.session_id,
                                from_seq: frame.from_seq,
                                appended: frame.appended,
                                total_rows: frame.total_rows,
                                live_tail: frame.live_tail,
                            },
                        );
                    }
                }
            });
            sender
        })
        .clone()
}

fn haider_projection_ingest_and_emit(app: &AppHandle, session_id: &str, value: &Value) {
    match haider_projection_ingest_value(Some(app), session_id, value) {
        Ok(frame) if frame.appended > 0 || frame.tail_changed => {
            let _ = haider_projection_frame_sender(app).send(frame);
        }
        Ok(_) => {}
        Err(error) => eprintln!("Haider projection fold failed: {error}"),
    }
}

fn haider_projection_read_capped_line(
    reader: &mut impl BufRead,
    output: &mut Vec<u8>,
) -> std::io::Result<Option<bool>> {
    output.clear();
    let mut overflow = false;
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return Ok((!output.is_empty() || overflow).then_some(!overflow));
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(buffer.len(), |index| index + 1);
        let content = &buffer[..newline.unwrap_or(buffer.len())];
        if !overflow {
            let available = HAIDER_PROJECTION_MAX_LINE_BYTES.saturating_sub(output.len());
            output.extend_from_slice(&content[..content.len().min(available)]);
            overflow = content.len() > available;
        }
        reader.consume(consumed);
        if newline.is_some() {
            return Ok(Some(!overflow));
        }
    }
}

fn haider_projection_export_json(provider_session_id: &str) -> Result<Value, String> {
    let mut child = Command::new("haider")
        .args(["export", provider_session_id, "--format", "json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Unable to start Haider export: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Haider export stdout was unavailable.".to_string())?;
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout
            .take(HAIDER_PROJECTION_MAX_EXPORT_BYTES.saturating_add(1))
            .read_to_end(&mut bytes);
        bytes
    });
    let started_at = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if started_at.elapsed() < HAIDER_PROJECTION_EXPORT_TIMEOUT => {
                thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("Haider export timed out.".to_string());
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(format!("Unable to wait for Haider export: {error}"));
            }
        }
    }?;
    let bytes = reader
        .join()
        .map_err(|_| "Haider export reader failed.".to_string())?;
    if !status.success() {
        return Err(format!("Haider export failed with status {status}."));
    }
    if bytes.len() as u64 > HAIDER_PROJECTION_MAX_EXPORT_BYTES {
        return Err("Haider export exceeded the projection read cap.".to_string());
    }
    serde_json::from_slice(&bytes)
        .or_else(|_| {
            let values = bytes
                .split(|byte| *byte == b'\n')
                .filter(|line| !line.iter().all(u8::is_ascii_whitespace))
                .map(serde_json::from_slice)
                .collect::<Result<Vec<Value>, _>>()?;
            Ok::<Value, serde_json::Error>(Value::Array(values))
        })
        .map_err(|error| format!("Unable to decode Haider export JSON: {error}"))
}

fn haider_projection_resolve_provider_session(
    session_id: &str,
) -> Result<(SessionRow, String), String> {
    let connection = sessions_open_database()?;
    let row = sessions_row_by_id(&connection, session_id.trim())?;
    let provider_session_id = row.provider_session_id.trim().to_string();
    if provider_session_id.is_empty() {
        return Err("Haider session id is not bound yet.".to_string());
    }
    Ok((row, provider_session_id))
}

fn haider_projection_watch_finished(session_id: &str, generation: u64) {
    if let Ok(mut manager) = haider_projection_watch_manager().lock() {
        if manager
            .watches
            .get(session_id)
            .is_some_and(|watch| watch.generation == generation)
        {
            manager.watches.remove(session_id);
        }
    }
}

fn haider_projection_attach_blocking(app: AppHandle, session_id: String) -> Result<(), String> {
    let (_, provider_session_id) = haider_projection_resolve_provider_session(&session_id)?;
    let (_, baseline_seq) = haider_projection_database_stats(&session_id)?;
    HAIDER_PROJECTION_STOPPING.store(false, Ordering::Release);

    if let Ok(mut manager) = haider_projection_watch_manager().lock() {
        manager.clock = manager.clock.saturating_add(1);
        let touched = manager.clock;
        if let Some(watch) = manager.watches.get_mut(&session_id) {
            watch.touched = touched;
            return Ok(());
        }
    }

    // Per-session watch was selected over `events --follow`: v0.0.928 emits
    // the same lossless raw envelopes (including ItemDelta payloads) while
    // avoiding a global replay/filter process for every attached UI view.
    let mut child = Command::new("haider")
        .args(["session", &provider_session_id, "--watch"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Unable to start Haider session watch: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Haider session watch stdout was unavailable.".to_string())?;
    let child = Arc::new(StdMutex::new(child));
    let generation = HAIDER_PROJECTION_WATCH_GENERATION.fetch_add(1, Ordering::Relaxed);
    let (duplicate, evicted) = {
        let mut manager = match haider_projection_watch_manager().lock() {
            Ok(manager) => manager,
            Err(_) => {
                if let Ok(mut child) = child.lock() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                return Err("Haider projection watch manager is unavailable.".to_string());
            }
        };
        manager.clock = manager.clock.saturating_add(1);
        let touched = manager.clock;
        if let Some(watch) = manager.watches.get_mut(&session_id) {
            watch.touched = touched;
            (true, None)
        } else {
            let evicted = if manager.watches.len() >= HAIDER_PROJECTION_WATCH_LIMIT {
                manager
                    .watches
                    .iter()
                    .min_by_key(|(_, watch)| watch.touched)
                    .map(|(id, _)| id.clone())
                    .and_then(|id| manager.watches.remove(&id))
            } else {
                None
            };
            manager.watches.insert(
                session_id.clone(),
                HaiderProjectionWatch {
                    child: child.clone(),
                    generation,
                    touched,
                },
            );
            (false, evicted)
        }
    };
    if duplicate {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        return Ok(());
    }
    if let Some(evicted) = evicted {
        if let Ok(mut child) = evicted.child.lock() {
            let _ = child.kill();
        }
    }

    thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stdout);
        let mut line = Vec::new();
        while !HAIDER_PROJECTION_STOPPING.load(Ordering::Acquire) {
            match haider_projection_read_capped_line(&mut reader, &mut line) {
                Ok(Some(true)) => {
                    let Ok(value) = serde_json::from_slice::<Value>(&line) else {
                        continue;
                    };
                    let seq = value
                        .as_object()
                        .and_then(|object| haider_projection_json_i64(object.get("seq")))
                        .unwrap_or(0);
                    if seq > 0 && seq <= baseline_seq {
                        continue;
                    }
                    haider_projection_ingest_and_emit(&app, &session_id, &value);
                }
                Ok(Some(false)) => continue,
                Ok(None) | Err(_) => break,
            }
        }
        if let Ok(mut child) = child.lock() {
            if HAIDER_PROJECTION_STOPPING.load(Ordering::Acquire) {
                let _ = child.kill();
            }
            let _ = child.wait();
        }
        haider_projection_watch_finished(&session_id, generation);
    });
    Ok(())
}

fn haider_projection_stop() {
    HAIDER_PROJECTION_STOPPING.store(true, Ordering::Release);
    let children = haider_projection_watch_manager()
        .lock()
        .ok()
        .map(|mut manager| {
            manager
                .watches
                .drain()
                .map(|(_, watch)| watch.child)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for child in children {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    }
}

#[tauri::command]
async fn session_projection_window(
    session_id: String,
    start_index: i64,
    count: i64,
) -> Result<SessionProjectionWindow, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session_id = session_id.trim();
        let start_index = start_index.max(0);
        let count = count.clamp(0, HAIDER_PROJECTION_MAX_WINDOW_ROWS);
        let connection = haider_projection_open_database()?;
        let total_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM session_projection_rows WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Unable to count session projection rows: {error}"))?;
        let mut statement = connection
            .prepare(
                "SELECT session_id, seq, kind, role, text, meta, at_ms
                 FROM session_projection_rows WHERE session_id = ?1
                 ORDER BY seq LIMIT ?2 OFFSET ?3",
            )
            .map_err(|error| format!("Unable to prepare session projection window: {error}"))?;
        let rows = statement
            .query_map(rusqlite::params![session_id, count, start_index], |row| {
                let meta: String = row.get(5)?;
                Ok(SessionProjectionRow {
                    session_id: row.get(0)?,
                    seq: row.get(1)?,
                    kind: row.get(2)?,
                    role: row.get(3)?,
                    text: row.get(4)?,
                    meta: serde_json::from_str(&meta).unwrap_or_else(|_| json!({"raw": meta})),
                    at_ms: row.get(6)?,
                })
            })
            .map_err(|error| format!("Unable to read session projection window: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Unable to decode session projection row: {error}"))?;
        let live_tail = haider_projection_states().lock().ok().and_then(|states| {
            states
                .get(session_id)
                .and_then(|state| state.tail.as_ref())
                .map(|tail| tail.row.clone())
        });
        Ok(SessionProjectionWindow {
            total_rows,
            start_index,
            rows,
            live_tail,
        })
    })
    .await
    .map_err(|error| format!("Session projection window worker failed: {error}"))?
}

/// Alias-tolerant token count: usage payload shapes differ across harness
/// versions and providers; nested "usage" objects are searched too.
fn haider_projection_usage_number(meta: &Value, keys: &[&str]) -> Option<i64> {
    let object = meta.as_object()?;
    for key in keys {
        if let Some(value) = object.get(*key).and_then(haider_projection_json_i64_value) {
            return Some(value);
        }
    }
    let nested = object.get("usage")?;
    let nested_object = nested.as_object()?;
    for key in keys {
        if let Some(value) = nested_object
            .get(*key)
            .and_then(haider_projection_json_i64_value)
        {
            return Some(value);
        }
    }
    None
}

fn haider_projection_json_i64_value(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_f64().map(|number| number as i64))
}

/// Lean full-session feed for the trajectory strip: one small point per row,
/// token/cache stats extracted server-side so the wire never carries payloads.
#[tauri::command]
async fn session_projection_trajectory(session_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session_id = session_id.trim().to_string();
        let connection = haider_projection_open_database()?;
        let mut statement = connection
            .prepare(
                "SELECT seq, kind, role, text, meta, at_ms
                 FROM session_projection_rows WHERE session_id = ?1
                 ORDER BY seq",
            )
            .map_err(|error| format!("Unable to prepare session trajectory read: {error}"))?;
        let points = statement
            .query_map([&session_id], |row| {
                let seq: i64 = row.get(0)?;
                let kind: String = row.get(1)?;
                let role: String = row.get(2)?;
                let text: String = row.get(3)?;
                let meta_text: String = row.get(4)?;
                let at_ms: i64 = row.get(5)?;
                Ok((seq, kind, role, text, meta_text, at_ms))
            })
            .map_err(|error| format!("Unable to read session trajectory rows: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Unable to decode session trajectory row: {error}"))?
            .into_iter()
            .map(|(seq, kind, role, text, meta_text, at_ms)| {
                let mut point = json!({
                    "seq": seq,
                    "kind": kind,
                    "role": role,
                    "at_ms": at_ms,
                    "label": haider_projection_compact(&text, 140),
                });
                if kind == "usage" {
                    let meta: Value = serde_json::from_str(&meta_text).unwrap_or(Value::Null);
                    let input = haider_projection_usage_number(
                        &meta,
                        &["input", "input_tokens", "prompt_tokens"],
                    );
                    let output = haider_projection_usage_number(
                        &meta,
                        &["output", "output_tokens", "completion_tokens"],
                    );
                    let cached = haider_projection_usage_number(
                        &meta,
                        &[
                            "cached",
                            "cached_tokens",
                            "cache_read",
                            "cache_read_input_tokens",
                            "cached_input",
                            "cached_input_tokens",
                        ],
                    );
                    if let Some(object) = point.as_object_mut() {
                        object.insert("input".to_string(), json!(input));
                        object.insert("output".to_string(), json!(output));
                        object.insert("cached".to_string(), json!(cached));
                    }
                }
                point
            })
            .collect::<Vec<_>>();
        Ok(json!({ "points": points }))
    })
    .await
    .map_err(|error| format!("Session trajectory worker failed: {error}"))?
}

#[tauri::command]
async fn session_projection_ensure(session_id: String) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _ensure_guard = haider_projection_ensure_lock()
            .lock()
            .map_err(|_| "Session projection ensure lock is unavailable.".to_string())?;
        let session_id = session_id.trim().to_string();
        let (total_rows, _) = haider_projection_database_stats(&session_id)?;
        if total_rows > 0 {
            haider_projection_initialize_state(&session_id)?;
            return Ok(total_rows);
        }
        let (_, provider_session_id) = haider_projection_resolve_provider_session(&session_id)?;
        let export = haider_projection_export_json(&provider_session_id)?;
        let _ = haider_projection_ingest_value(None, &session_id, &export)?;
        haider_projection_database_stats(&session_id).map(|(total, _)| total)
    })
    .await
    .map_err(|error| format!("Session projection ensure worker failed: {error}"))?
}

#[tauri::command]
async fn session_projection_attach(app: AppHandle, session_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        haider_projection_attach_blocking(app, session_id.trim().to_string())
    })
    .await
    .map_err(|error| format!("Session projection attach worker failed: {error}"))?
}

#[tauri::command]
async fn session_projection_detach(session_id: String) -> Result<(), String> {
    let child = haider_projection_watch_manager()
        .lock()
        .map_err(|_| "Haider projection watch manager is unavailable.".to_string())?
        .watches
        .remove(session_id.trim())
        .map(|watch| watch.child);
    if let Some(child) = child {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    }
    Ok(())
}

#[cfg(test)]
mod haider_projection_tests {
    use super::*;

    #[test]
    fn haider_projection_folds_observed_export_shape_and_missing_seq() {
        // Shape captured from `haider export <id> --format json` v1. The
        // sandboxed test runner cannot connect to the user's daemon, so the
        // text is shortened while the observed public keys stay exact.
        let export = json!({
            "schema": "haider.export.v1",
            "session_id": "session-observed",
            "head_seq": 44,
            "turns": [
                {"role":"user", "text":"Review the parser", "at_ms":1700000000001_i64, "seq":7},
                {"role":"assistant", "text":"I found the issue.", "at_ms":1700000000002_i64, "seq":19},
                {"role":"tool", "name":"fs_read", "summary":"read src/parser.rs", "at_ms":1700000000003_i64}
            ]
        });
        let mut state = HaiderProjectionFoldState::default();
        let mut rows = Vec::new();
        for item in haider_projection_input_items(&export) {
            rows.extend(
                haider_projection_fold_value_locked(&mut state, "local-session", item).rows,
            );
        }
        assert_eq!(rows.len(), 3);
        assert_eq!((rows[0].seq, rows[0].role.as_str()), (7, "user"));
        assert_eq!((rows[1].seq, rows[1].role.as_str()), (19, "assistant"));
        assert_eq!((rows[2].seq, rows[2].kind.as_str()), (20, "tool"));
        assert_eq!(rows[2].text, "read src/parser.rs");
    }

    #[test]
    fn haider_projection_streaming_tail_is_mutable_until_completion() {
        // Raw envelope keys and item lifecycle captured from v0.0.928's real
        // store/watch wire shape; additive fields are deliberately omitted.
        let started = json!({
            "seq": 40,
            "committed_at_ms": 1700000000040_i64,
            "payload": {"type":"item", "event":"started", "item_id":"item-1",
                "item":{"item":"agent_message", "text":""}}
        });
        let delta = json!({
            "seq": 41,
            "committed_at_ms": 1700000000041_i64,
            "payload": {"type":"item", "event":"delta", "item_id":"item-1",
                "delta":{"delta":"text", "text":"Hello"}}
        });
        let completed = json!({
            "seq": 42,
            "committed_at_ms": 1700000000042_i64,
            "payload": {"type":"item", "event":"completed", "item_id":"item-1",
                "item":{"item":"agent_message", "text":"Hello world"}}
        });
        let mut state = HaiderProjectionFoldState::default();
        assert!(
            haider_projection_fold_value_locked(&mut state, "local", &started)
                .rows
                .is_empty()
        );
        assert!(
            haider_projection_fold_value_locked(&mut state, "local", &delta)
                .rows
                .is_empty()
        );
        assert_eq!(state.tail.as_ref().unwrap().row.text, "Hello");
        let sealed = haider_projection_fold_value_locked(&mut state, "local", &completed);
        assert_eq!(sealed.rows.len(), 1);
        assert_eq!(sealed.rows[0].seq, 42);
        assert_eq!(sealed.rows[0].text, "Hello world");
        assert!(state.tail.is_none());
    }

    #[test]
    fn haider_projection_state_events_do_not_create_rows() {
        let mut state = HaiderProjectionFoldState::default();
        for payload in [
            json!({"payload":{"type":"usage", "input":10, "output":3}}),
            json!({"payload":{"type":"run_state", "state":"streaming"}}),
            json!({"payload":{"type":"session_state", "state":"idle"}}),
        ] {
            let step = haider_projection_fold_value_locked(&mut state, "local", &payload);
            assert!(step.rows.is_empty());
        }
        assert!(state.metadata.contains_key("usage"));
        assert!(state.metadata.contains_key("run_state"));
        assert!(state.metadata.contains_key("session_state"));
    }

    #[test]
    fn haider_projection_rows_match_the_webview_contract() {
        let row = haider_projection_row(
            "local-only",
            7,
            "message",
            "assistant",
            "Hello".to_string(),
            json!({"source":"test"}),
            1_700_000_000_000,
        );
        let value = serde_json::to_value(row).unwrap();
        assert_eq!(
            value
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<HashSet<_>>(),
            ["seq", "kind", "role", "text", "meta", "at_ms"]
                .into_iter()
                .map(str::to_string)
                .collect()
        );
    }

    #[test]
    fn haider_projection_run_failure_is_visible_and_marks_error() {
        let mut state = HaiderProjectionFoldState::default();
        let event = json!({
            "seq": 9,
            "payload": {
                "type": "run_failed",
                "code": "provider_error",
                "presentation": "Provider is unavailable"
            }
        });
        let step = haider_projection_fold_value_locked(&mut state, "local", &event);
        assert_eq!(step.rows.len(), 1);
        assert_eq!(step.rows[0].kind, "error");
        assert_eq!(step.rows[0].text, "Provider is unavailable");
        assert_eq!(step.status.as_deref(), Some("error"));
    }
}

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};

use super::db::process_path_text;

pub const COORDINATION_ALIGNMENT_LOGGING_ENABLED: bool = false;

static ALIGNMENT_LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub fn is_enabled() -> bool {
    COORDINATION_ALIGNMENT_LOGGING_ENABLED
}

pub fn log_path(repo_path: &Path) -> PathBuf {
    repo_path.join("logs").join("coordination-alignment.jsonl")
}

pub fn check_entry(
    context: &str,
    check: &str,
    status: &str,
    reason: impl Into<String>,
    details: Value,
) -> Value {
    json!({
        "created_at": now_rfc3339(),
        "context": context,
        "check": check,
        "status": status,
        "reason": reason.into(),
        "details": details,
    })
}

pub fn lifecycle_entry(
    context: &str,
    event: &str,
    status: &str,
    reason: impl Into<String>,
    details: Value,
) -> Value {
    json!({
        "created_at": now_rfc3339(),
        "record_type": "lifecycle",
        "context": context,
        "event": event,
        "status": status,
        "reason": reason.into(),
        "details": details,
    })
}

pub fn write_lifecycle(
    repo_path: &Path,
    context: &str,
    event: &str,
    status: &str,
    reason: impl Into<String>,
    details: Value,
) -> Result<(), String> {
    let entry = lifecycle_entry(context, event, status, reason, details);
    write_check(repo_path, &entry)
}

pub fn write_check(repo_path: &Path, entry: &Value) -> Result<(), String> {
    if !COORDINATION_ALIGNMENT_LOGGING_ENABLED {
        return Ok(());
    }

    let path = log_path(repo_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Unable to create alignment log directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let _guard = ALIGNMENT_LOG_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Unable to lock coordination alignment log.".to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("Unable to open alignment log {}: {error}", path.display()))?;
    writeln!(file, "{entry}")
        .map_err(|error| format!("Unable to write alignment log {}: {error}", path.display()))
}

pub fn log_metadata(repo_path: &Path) -> Value {
    let path = log_path(repo_path);
    json!({
        "enabled": COORDINATION_ALIGNMENT_LOGGING_ENABLED,
        "path": process_path_text(&path),
        "format": "jsonl",
        "redaction": "kernel metadata only; no raw source code, terminal logs, env vars, secrets, credentials, or raw patch contents",
    })
}

fn now_rfc3339() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));

    format!("{}.{:03}Z", duration.as_secs(), duration.subsec_millis())
}

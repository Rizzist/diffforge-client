use std::path::Path;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::{
    db::process_path_text,
    kernel::{api_ok, CoordinationKernel},
};

const DEFAULT_DEBOUNCE_MS: u64 = 750;

pub fn scan_known_violations(kernel: &CoordinationKernel) -> Result<Value, String> {
    let watcher_id = watcher_id(kernel);
    let targets = active_watched_path_strings(kernel)?;
    kernel.record_file_watcher_event(
        &watcher_id,
        "disabled",
        "disabled",
        &targets,
        DEFAULT_DEBOUNCE_MS as i64,
        "file_watcher_manual_scan_skipped",
        json!({
            "disabled": true,
            "reason": "coordination_file_watcher_disabled_for_energy_savings",
        }),
        None,
    )?;

    Ok(api_ok(json!({
        "changes": [],
        "scanner": "disabled",
        "disabled": true,
    })))
}

pub fn start_file_watcher(
    kernel: &CoordinationKernel,
    _input: Option<Value>,
) -> Result<Value, String> {
    let watcher_id = watcher_id(kernel);
    let targets = active_watched_path_strings(kernel)?;
    kernel.record_file_watcher_event(
        &watcher_id,
        "disabled",
        "disabled",
        &targets,
        DEFAULT_DEBOUNCE_MS as i64,
        "file_watcher_start_skipped",
        json!({
            "disabled": true,
            "reason": "coordination_file_watcher_disabled_for_energy_savings",
        }),
        None,
    )?;

    Ok(api_ok(json!({
        "watcher_id": watcher_id,
        "status": "disabled",
        "backend": "disabled",
        "watched_paths": targets,
        "debounce_ms": DEFAULT_DEBOUNCE_MS,
        "refresh_ms": 0,
        "reused": false,
        "disabled": true,
    })))
}

pub fn stop_file_watcher(kernel: &CoordinationKernel) -> Result<Value, String> {
    Ok(api_ok(json!({
        "watcher_id": watcher_id(kernel),
        "status": "stopped",
        "reused": false,
        "disabled": true,
    })))
}

pub fn stop_all_file_watchers(reason: &str) -> Value {
    api_ok(json!({
        "status": "stopped",
        "reason": reason,
        "stopped": 0,
        "total": 0,
        "timed_out": false,
        "disabled": true,
    }))
}

pub fn stop_file_watchers_for_repo_path(repo_path: &Path, reason: &str) -> Value {
    api_ok(json!({
        "status": "stopped",
        "reason": reason,
        "repo_path": process_path_text(repo_path),
        "stopped": 0,
        "total": 0,
        "timed_out": false,
        "disabled": true,
    }))
}

pub fn file_watcher_status(kernel: &CoordinationKernel) -> Result<Value, String> {
    Ok(api_ok(json!({
        "watcher_id": watcher_id(kernel),
        "runtime": Value::Null,
        "disabled": true,
        "persisted": kernel.list_file_watchers()?["data"].clone(),
    })))
}

fn active_watched_path_strings(kernel: &CoordinationKernel) -> Result<Vec<String>, String> {
    Ok(kernel
        .active_file_watcher_targets()?
        .into_iter()
        .filter_map(|target| target["path"].as_str().map(str::to_string))
        .collect())
}

fn watcher_key(kernel: &CoordinationKernel) -> String {
    format!(
        "{}|{}",
        process_path_text(&kernel.paths.repo_path),
        process_path_text(&kernel.paths.db_path)
    )
}

fn watcher_id(kernel: &CoordinationKernel) -> String {
    let mut hasher = Sha256::new();
    hasher.update(watcher_key(kernel).as_bytes());
    let digest = hasher.finalize();
    let suffix = digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("file-watcher-{suffix}")
}

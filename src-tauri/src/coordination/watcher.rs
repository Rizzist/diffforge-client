use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::{
    db::process_path_text,
    kernel::{api_ok, CoordinationKernel},
};

const DEFAULT_DEBOUNCE_MS: u64 = 750;
const DEFAULT_REFRESH_MS: u64 = 5_000;
const STOP_ALL_JOIN_TIMEOUT_MS: u64 = 2_500;

struct WatcherRuntime {
    watcher_id: String,
    repo_path: PathBuf,
    db_path: Option<PathBuf>,
    watched_paths: Vec<String>,
    debounce_ms: u64,
    refresh_ms: u64,
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

#[derive(Clone, Copy)]
struct WatcherOptions {
    debounce_ms: u64,
    refresh_ms: u64,
}

static WATCHERS: OnceLock<Mutex<HashMap<String, WatcherRuntime>>> = OnceLock::new();

pub fn scan_known_violations(kernel: &CoordinationKernel) -> Result<Value, String> {
    let watcher_id = watcher_id(kernel);
    let targets = active_watched_path_strings(kernel)?;
    kernel.record_file_watcher_event(
        &watcher_id,
        runtime_status_for(&watcher_id),
        "manual_scan",
        &targets,
        DEFAULT_DEBOUNCE_MS as i64,
        "file_watcher_manual_scan_started",
        json!({"scanner": "git_status"}),
        None,
    )?;
    match kernel.scan_workspace_changes() {
        Ok(result) => {
            kernel.record_file_watcher_event(
                &watcher_id,
                runtime_status_for(&watcher_id),
                "manual_scan",
                &targets,
                DEFAULT_DEBOUNCE_MS as i64,
                "file_watcher_manual_scan_finished",
                scan_summary(&result),
                None,
            )?;
            Ok(result)
        }
        Err(error) => {
            kernel.record_file_watcher_event(
                &watcher_id,
                "error",
                "manual_scan",
                &targets,
                DEFAULT_DEBOUNCE_MS as i64,
                "file_watcher_manual_scan_failed",
                json!({"scanner": "git_status"}),
                Some(&error),
            )?;
            Err(error)
        }
    }
}

pub fn start_file_watcher(
    kernel: &CoordinationKernel,
    input: Option<Value>,
) -> Result<Value, String> {
    let options = WatcherOptions::from_input(input.as_ref());
    let watcher_id = watcher_id(kernel);
    let key = watcher_key(kernel);
    let targets = active_watched_path_strings(kernel)?;

    {
        let mut runtimes = watcher_runtimes().lock().map_err(lock_error)?;
        if let Some(runtime) = runtimes.get(&key) {
            if !runtime.stop.load(Ordering::SeqCst) {
                return Ok(api_ok(json!({
                    "watcher_id": runtime.watcher_id.clone(),
                    "status": "running",
                    "backend": "polling_git_status",
                    "watched_paths": runtime.watched_paths.clone(),
                    "debounce_ms": runtime.debounce_ms,
                    "refresh_ms": runtime.refresh_ms,
                    "reused": true,
                })));
            }
        }

        kernel.record_file_watcher_event(
            &watcher_id,
            "running",
            "polling_git_status",
            &targets,
            options.debounce_ms as i64,
            "file_watcher_started",
            json!({"refresh_ms": options.refresh_ms}),
            None,
        )?;

        let stop = Arc::new(AtomicBool::new(false));
        let runtime = WatcherRuntime {
            watcher_id: watcher_id.clone(),
            repo_path: kernel.paths.repo_path.clone(),
            db_path: Some(kernel.paths.db_path.clone()),
            watched_paths: targets.clone(),
            debounce_ms: options.debounce_ms,
            refresh_ms: options.refresh_ms,
            stop: stop.clone(),
            join: Some(spawn_watcher_worker(
                watcher_id.clone(),
                kernel.paths.repo_path.clone(),
                Some(kernel.paths.db_path.clone()),
                stop,
                options,
            )),
        };
        runtimes.insert(key, runtime);
    }

    Ok(api_ok(json!({
        "watcher_id": watcher_id,
        "status": "running",
        "backend": "polling_git_status",
        "watched_paths": targets,
        "debounce_ms": options.debounce_ms,
        "refresh_ms": options.refresh_ms,
        "reused": false,
    })))
}

pub fn stop_file_watcher(kernel: &CoordinationKernel) -> Result<Value, String> {
    let key = watcher_key(kernel);
    let runtime = watcher_runtimes().lock().map_err(lock_error)?.remove(&key);

    let Some(mut runtime) = runtime else {
        return Ok(api_ok(json!({
            "watcher_id": watcher_id(kernel),
            "status": "stopped",
            "reused": false,
        })));
    };

    runtime.stop.store(true, Ordering::SeqCst);
    if let Some(join) = runtime.join.take() {
        let _ = join.join();
    }

    Ok(api_ok(json!({
        "watcher_id": runtime.watcher_id,
        "status": "stopped",
        "repo_path": process_path_text(&runtime.repo_path),
        "db_path": runtime.db_path.as_ref().map(|path| process_path_text(path)),
        "state": kernel.list_file_watchers()?["data"].clone(),
    })))
}

pub fn stop_all_file_watchers(reason: &str) -> Value {
    let runtimes = match watcher_runtimes().lock() {
        Ok(mut runtimes) => runtimes
            .drain()
            .map(|(_, runtime)| runtime)
            .collect::<Vec<_>>(),
        Err(_) => Vec::new(),
    };
    let total = runtimes.len();

    if total == 0 {
        return api_ok(json!({
            "status": "stopped",
            "reason": reason,
            "stopped": 0,
            "total": 0,
            "timed_out": false,
        }));
    }

    let (joined_tx, joined_rx) = mpsc::channel();
    for mut runtime in runtimes {
        runtime.stop.store(true, Ordering::SeqCst);
        if let Some(join) = runtime.join.take() {
            let joined_tx = joined_tx.clone();
            thread::spawn(move || {
                let _ = join.join();
                let _ = joined_tx.send(());
            });
        } else {
            let _ = joined_tx.send(());
        }
    }
    drop(joined_tx);

    let deadline = Instant::now() + Duration::from_millis(STOP_ALL_JOIN_TIMEOUT_MS);
    let mut stopped = 0usize;
    while stopped < total {
        let now = Instant::now();
        if now >= deadline {
            break;
        }

        match joined_rx.recv_timeout(deadline.saturating_duration_since(now)) {
            Ok(()) => stopped += 1,
            Err(mpsc::RecvTimeoutError::Timeout) => break,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    api_ok(json!({
        "status": "stopped",
        "reason": reason,
        "stopped": stopped,
        "total": total,
        "timed_out": stopped < total,
    }))
}

pub fn file_watcher_status(kernel: &CoordinationKernel) -> Result<Value, String> {
    let key = watcher_key(kernel);
    let runtime = watcher_runtimes()
        .lock()
        .map_err(lock_error)?
        .get(&key)
        .map(|runtime| {
            json!({
                "watcher_id": runtime.watcher_id.clone(),
                "status": if runtime.stop.load(Ordering::SeqCst) { "stopping" } else { "running" },
                "backend": "polling_git_status",
                "repo_path": process_path_text(&runtime.repo_path),
                "db_path": runtime.db_path.as_ref().map(|path| process_path_text(path)),
                "watched_paths": runtime.watched_paths.clone(),
                "debounce_ms": runtime.debounce_ms,
                "refresh_ms": runtime.refresh_ms,
            })
        });
    Ok(api_ok(json!({
        "watcher_id": watcher_id(kernel),
        "runtime": runtime,
        "persisted": kernel.list_file_watchers()?["data"].clone(),
    })))
}

fn spawn_watcher_worker(
    watcher_id: String,
    repo_path: PathBuf,
    db_path: Option<PathBuf>,
    stop: Arc<AtomicBool>,
    options: WatcherOptions,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut watched_paths = Vec::new();
        loop {
            if stop.load(Ordering::SeqCst) || crate::app_shutdown_requested() {
                break;
            }

            let current_paths = active_watched_paths_for_log(&repo_path, db_path.as_ref());
            if current_paths != watched_paths {
                watched_paths = current_paths.clone();
                log_watcher_event(
                    &repo_path,
                    db_path.as_ref(),
                    &watcher_id,
                    "running",
                    "polling_git_status",
                    &watched_paths,
                    options.debounce_ms,
                    "file_watcher_paths_refreshed",
                    json!({}),
                    None,
                );
            }

            if !watched_paths.is_empty() && !crate::app_shutdown_requested() {
                run_poll_scan(
                    &repo_path,
                    db_path.as_ref(),
                    &watcher_id,
                    options.debounce_ms,
                    &watched_paths,
                );
            }

            sleep_interruptibly(options.refresh_ms, &stop);
        }

        log_watcher_event(
            &repo_path,
            db_path.as_ref(),
            &watcher_id,
            "stopped",
            "polling_git_status",
            &watched_paths,
            options.debounce_ms,
            "file_watcher_stopped",
            json!({}),
            None,
        );
    })
}

fn run_poll_scan(
    repo_path: &Path,
    db_path: Option<&PathBuf>,
    watcher_id: &str,
    debounce_ms: u64,
    watched_paths: &[String],
) {
    if crate::app_shutdown_requested() {
        return;
    }

    log_watcher_event(
        repo_path,
        db_path,
        watcher_id,
        "running",
        "polling_git_status",
        watched_paths,
        debounce_ms,
        "file_watcher_scan_triggered",
        json!({"reason": "poll_interval"}),
        None,
    );

    let scan_result = CoordinationKernel::open(repo_path, db_path.cloned())
        .and_then(|kernel| kernel.scan_workspace_changes());
    match scan_result {
        Ok(result) => {
            let summary = scan_summary(&result);
            log_watcher_event(
                repo_path,
                db_path,
                watcher_id,
                "running",
                "polling_git_status",
                watched_paths,
                debounce_ms,
                "file_watcher_scan_finished",
                summary.clone(),
                None,
            );
        }
        Err(error) => {
            log_watcher_event(
                repo_path,
                db_path,
                watcher_id,
                "error",
                "polling_git_status",
                watched_paths,
                debounce_ms,
                "file_watcher_scan_failed",
                json!({"reason": "poll_interval"}),
                Some(error.clone()),
            );
        }
    }
}

fn active_watched_path_strings(kernel: &CoordinationKernel) -> Result<Vec<String>, String> {
    Ok(kernel
        .active_file_watcher_targets()?
        .into_iter()
        .filter_map(|target| target["path"].as_str().map(str::to_string))
        .collect())
}

fn active_watched_paths_for_log(repo_path: &Path, db_path: Option<&PathBuf>) -> Vec<String> {
    CoordinationKernel::open(repo_path, db_path.cloned())
        .and_then(|kernel| active_watched_path_strings(&kernel))
        .unwrap_or_default()
}

fn log_watcher_event(
    repo_path: &Path,
    db_path: Option<&PathBuf>,
    watcher_id: &str,
    status: &str,
    backend: &str,
    watched_paths: &[String],
    debounce_ms: u64,
    event_type: &str,
    details: Value,
    last_error: Option<String>,
) {
    if let Ok(kernel) = CoordinationKernel::open(repo_path, db_path.cloned()) {
        let _ = kernel.record_file_watcher_event(
            watcher_id,
            status,
            backend,
            watched_paths,
            debounce_ms as i64,
            event_type,
            details,
            last_error.as_deref(),
        );
    }
}

fn scan_summary(result: &Value) -> Value {
    let changes = result["data"]["changes"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let unleased_change_count = changes
        .iter()
        .filter(|change| change["lease_status"].as_str() == Some("unleased"))
        .count();
    json!({
        "scanner": result["data"]["scanner"].clone(),
        "change_count": changes.len(),
        "unleased_change_count": unleased_change_count,
        "warning_count": result["warnings"].as_array().map(|warnings| warnings.len()).unwrap_or(0),
    })
}

fn watcher_runtimes() -> &'static Mutex<HashMap<String, WatcherRuntime>> {
    WATCHERS.get_or_init(|| Mutex::new(HashMap::new()))
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

fn runtime_status_for(watcher_id: &str) -> &'static str {
    let Ok(runtimes) = watcher_runtimes().lock() else {
        return "unknown";
    };
    if runtimes
        .values()
        .any(|runtime| runtime.watcher_id == watcher_id && !runtime.stop.load(Ordering::SeqCst))
    {
        "running"
    } else {
        "manual_scan"
    }
}

fn sleep_interruptibly(milliseconds: u64, stop: &AtomicBool) {
    let mut remaining = milliseconds;
    while remaining > 0 && !stop.load(Ordering::SeqCst) {
        let step = remaining.min(250);
        thread::sleep(Duration::from_millis(step));
        remaining -= step;
    }
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> String {
    format!("File watcher runtime lock is poisoned: {error}")
}

impl WatcherOptions {
    fn from_input(input: Option<&Value>) -> Self {
        let debounce_ms = input
            .and_then(|value| value["debounce_ms"].as_u64())
            .unwrap_or(DEFAULT_DEBOUNCE_MS)
            .clamp(100, 10_000);
        let refresh_ms = input
            .and_then(|value| value["refresh_ms"].as_u64())
            .unwrap_or(DEFAULT_REFRESH_MS)
            .clamp(1_000, 60_000);
        Self {
            debounce_ms,
            refresh_ms,
        }
    }
}

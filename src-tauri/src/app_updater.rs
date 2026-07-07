// Over-the-wire app updates (tauri-plugin-updater). The app checks the
// signed manifest at plugins.updater.endpoints on startup and every few
// hours, downloads in the background only when the user asks, and restarts
// only from the explicit restart affordance or the user's idle-restart opt-in.
//
// Env overrides: DIFFFORGE_UPDATER_URL replaces the manifest endpoint;
// DIFFFORGE_UPDATER_FORCE=1 enables checks in debug builds (off by default
// so `npm run dev` never talks to the release feed).

use tauri_plugin_updater::UpdaterExt as AppUpdaterExt;

const APP_UPDATE_AVAILABLE_EVENT: &str = "forge-app-update-available";
const APP_UPDATE_PROGRESS_EVENT: &str = "forge-app-update-progress";
const APP_UPDATE_STATE_EVENT: &str = "forge-app-update-state";
const APP_UPDATE_INITIAL_DELAY_SECS: u64 = 60;
const APP_UPDATE_RECHECK_INTERVAL_SECS: u64 = 4 * 60 * 60;
const APP_UPDATE_PROGRESS_STEP_BYTES: u64 = 1024 * 1024;
// While an update is pending and auto-restart is enabled, poll terminal
// idleness on this cadence, and require it to hold across a confirmation
// pause so a just-submitted prompt never races the restart.
const APP_UPDATE_IDLE_POLL_SECS: u64 = 5 * 60;
const APP_UPDATE_IDLE_CONFIRM_SECS: u64 = 60;
const APP_UPDATE_SETTINGS_STATE_KEY: &str = "app-update-settings";

static APP_UPDATE_INSTALLING: AtomicBool = AtomicBool::new(false);
// Opt-in, disabled by default: restart into a pending update on our own
// only when every terminal is idle. Cache of the persisted setting.
static APP_UPDATE_AUTO_WHEN_IDLE: AtomicBool = AtomicBool::new(false);
static APP_UPDATE_AVAILABLE: StdMutex<Option<AppUpdateInfo>> = StdMutex::new(None);
static APP_UPDATE_STAGED: StdMutex<Option<AppUpdateStaged>> = StdMutex::new(None);

#[derive(Clone, Serialize)]
struct AppUpdateInfo {
    version: String,
    notes: Option<String>,
}

struct AppUpdateStaged {
    version: String,
    installed: bool,
    bytes: Option<Vec<u8>>,
    #[cfg(windows)]
    update: Option<tauri_plugin_updater::Update>,
}

#[derive(Clone, Serialize)]
struct AppUpdateStagedInfo {
    version: String,
    installed: bool,
    has_bytes: bool,
}

struct AppUpdateStagedRestart {
    version: String,
    installed: bool,
    #[cfg(windows)]
    bytes: Option<Vec<u8>>,
    #[cfg(windows)]
    update: Option<tauri_plugin_updater::Update>,
}

fn app_update_available_snapshot() -> Option<AppUpdateInfo> {
    APP_UPDATE_AVAILABLE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn app_update_store_available(info: Option<AppUpdateInfo>) {
    *APP_UPDATE_AVAILABLE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = info;
}

fn app_update_staged_info() -> Option<AppUpdateStagedInfo> {
    APP_UPDATE_STAGED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
        .map(|staged| AppUpdateStagedInfo {
            version: staged.version.clone(),
            installed: staged.installed,
            has_bytes: staged.bytes.is_some(),
        })
}

fn app_update_staged_for_restart() -> Option<AppUpdateStagedRestart> {
    APP_UPDATE_STAGED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
        .map(|staged| AppUpdateStagedRestart {
            version: staged.version.clone(),
            installed: staged.installed,
            #[cfg(windows)]
            bytes: staged.bytes.clone(),
            #[cfg(windows)]
            update: staged.update.clone(),
        })
}

fn app_update_store_staged(staged: Option<AppUpdateStaged>) {
    *APP_UPDATE_STAGED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = staged;
}

fn app_update_settings_to_value() -> Value {
    json!({
        "autoRestartWhenIdle": APP_UPDATE_AUTO_WHEN_IDLE.load(Ordering::Acquire),
    })
}

pub(crate) fn app_update_settings_initialize(app: &AppHandle) {
    let raw = app_local_state_read(app, APP_UPDATE_SETTINGS_STATE_KEY);
    let auto = raw
        .get("autoRestartWhenIdle")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    APP_UPDATE_AUTO_WHEN_IDLE.store(auto, Ordering::Release);
}

fn app_update_settings_save(
    app: &AppHandle,
    auto_restart_when_idle: bool,
) -> Result<Value, String> {
    APP_UPDATE_AUTO_WHEN_IDLE.store(auto_restart_when_idle, Ordering::Release);
    let value = app_update_settings_to_value();
    app_local_state_write(app, APP_UPDATE_SETTINGS_STATE_KEY, &value)?;
    Ok(value)
}

/// True only when no terminal is doing anything: busy turns, starting
/// sessions, and paused/needs-input agents all block an automatic restart.
/// No terminals at all counts as idle.
async fn app_update_all_terminals_idle(app: &AppHandle) -> bool {
    let state = app.state::<TerminalState>();
    let terminals = state.terminals.read().await;
    for instance in terminals.values() {
        let snapshot = instance
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let status = terminal_projection_text(&snapshot.status, "");
        let activity = terminal_projection_text(&snapshot.activity_status, "");
        if terminal_runtime_snapshot_is_busy_turn(&snapshot)
            || terminal_runtime_snapshot_is_starting(&snapshot)
            || terminal_projection_state_is_paused(&status)
            || terminal_projection_state_is_paused(&activity)
        {
            return false;
        }
    }
    true
}

fn app_updater_instance(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let override_url = std::env::var("DIFFFORGE_UPDATER_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let builder = app.updater_builder();
    let builder = match override_url {
        Some(raw) => {
            let url = tauri::Url::parse(&raw)
                .map_err(|error| format!("Invalid DIFFFORGE_UPDATER_URL: {error}"))?;
            builder
                .endpoints(vec![url])
                .map_err(|error| format!("Could not apply updater endpoint override: {error}"))?
        }
        None => builder,
    };
    builder
        .build()
        .map_err(|error| format!("Could not build updater: {error}"))
}

fn app_update_status_snapshot() -> Value {
    let available = app_update_available_snapshot();
    let staged = app_update_staged_info();
    let version = staged
        .as_ref()
        .map(|info| info.version.clone())
        .or_else(|| available.as_ref().map(|info| info.version.clone()));
    json!({
        "available": available.is_some() || staged.is_some(),
        "version": version,
        "notes": available.as_ref().and_then(|info| info.notes.clone()),
        "installing": APP_UPDATE_INSTALLING.load(Ordering::Acquire),
        "ready": staged.is_some(),
        "staged": staged,
        "autoRestartWhenIdle": APP_UPDATE_AUTO_WHEN_IDLE.load(Ordering::Acquire),
        "currentVersion": env!("CARGO_PKG_VERSION"),
    })
}

async fn app_updater_run_check(app: &AppHandle) -> Result<Option<AppUpdateInfo>, String> {
    let updater = app_updater_instance(app)?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("Update check failed: {error}"))?;
    let Some(update) = update else {
        app_update_store_available(None);
        return Ok(None);
    };
    let info = AppUpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone(),
    };
    app_update_store_available(Some(info.clone()));
    let _ = app.emit(
        APP_UPDATE_AVAILABLE_EVENT,
        json!({ "version": info.version, "notes": info.notes }),
    );
    Ok(Some(info))
}

pub(crate) fn app_updater_start(app: &AppHandle) {
    let force_in_debug = std::env::var("DIFFFORGE_UPDATER_FORCE")
        .map(|value| value.trim() == "1")
        .unwrap_or(false);
    if cfg!(debug_assertions) && !force_in_debug {
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_secs(APP_UPDATE_INITIAL_DELAY_SECS)).await;
        loop {
            let pending = match app_updater_run_check(&app).await {
                Ok(Some(info)) => {
                    log_terminal_status_event(
                        "backend.app_update.available",
                        json!({ "version": info.version }),
                    );
                    true
                }
                Ok(None) => false,
                Err(error) => {
                    log_terminal_status_event(
                        "backend.app_update.check_failed",
                        json!({ "error": error }),
                    );
                    false
                }
            };

            if pending {
                app_update_auto_restart_watch(&app).await;
                // Fall through to a fresh check: the watch window either
                // installed (process gone), was disabled mid-wait, or never
                // saw sustained idle within a recheck interval.
                continue;
            }

            sleep(Duration::from_secs(APP_UPDATE_RECHECK_INTERVAL_SECS)).await;
        }
    });
}

/// With an update pending: poll terminal idleness until a full recheck
/// interval elapses, and install once idleness holds across the
/// confirmation pause. Returns without installing when auto-restart is off
/// (plain wait), gets disabled mid-watch, or an install is already running.
async fn app_update_auto_restart_watch(app: &AppHandle) {
    let mut waited: u64 = 0;
    while waited < APP_UPDATE_RECHECK_INTERVAL_SECS {
        if !APP_UPDATE_AUTO_WHEN_IDLE.load(Ordering::Acquire) {
            sleep(Duration::from_secs(
                APP_UPDATE_RECHECK_INTERVAL_SECS - waited,
            ))
            .await;
            return;
        }
        if !APP_UPDATE_INSTALLING.load(Ordering::Acquire)
            && app_update_all_terminals_idle(app).await
        {
            sleep(Duration::from_secs(APP_UPDATE_IDLE_CONFIRM_SECS)).await;
            waited += APP_UPDATE_IDLE_CONFIRM_SECS;
            if APP_UPDATE_AUTO_WHEN_IDLE.load(Ordering::Acquire)
                && app_update_all_terminals_idle(app).await
            {
                log_terminal_status_event("backend.app_update.auto_restart_idle", json!({}));
                // Shares the manual path: installing guard, failure events,
                // and the restart (on success this never returns).
                if let Err(error) = app_update_install_and_restart(app.clone()).await {
                    log_terminal_status_event(
                        "backend.app_update.auto_restart_failed",
                        json!({ "error": error }),
                    );
                    // Back off before the outer loop re-checks, so a
                    // persistent failure can't turn into a download storm.
                    sleep(Duration::from_secs(APP_UPDATE_IDLE_POLL_SECS)).await;
                    return;
                }
            }
            continue;
        }
        sleep(Duration::from_secs(APP_UPDATE_IDLE_POLL_SECS)).await;
        waited += APP_UPDATE_IDLE_POLL_SECS;
    }
}

#[tauri::command]
fn app_update_status() -> Value {
    app_update_status_snapshot()
}

#[tauri::command]
fn app_update_settings_state() -> Value {
    app_update_settings_to_value()
}

#[tauri::command]
async fn app_update_settings_update(
    app: AppHandle,
    auto_restart_when_idle: bool,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app_update_settings_save(&app, auto_restart_when_idle)
    })
    .await
    .map_err(|error| format!("App update settings worker failed: {error}"))?
}

#[tauri::command]
async fn app_update_check_now(app: AppHandle) -> Result<Value, String> {
    app_updater_run_check(&app).await?;
    Ok(app_update_status_snapshot())
}

#[tauri::command]
async fn app_update_install_and_restart(app: AppHandle) -> Result<(), String> {
    if APP_UPDATE_INSTALLING.swap(true, Ordering::AcqRel) {
        return Err("An update install is already in progress.".to_string());
    }
    let result = app_update_install_inner(&app).await;
    if let Err(error) = &result {
        APP_UPDATE_INSTALLING.store(false, Ordering::Release);
        let _ = app.emit(
            APP_UPDATE_STATE_EVENT,
            json!({ "state": "failed", "error": error }),
        );
        log_terminal_status_event(
            "backend.app_update.install_failed",
            json!({ "error": error }),
        );
    }
    result
}

#[tauri::command]
async fn app_update_download(app: AppHandle) -> Result<Value, String> {
    if APP_UPDATE_INSTALLING.swap(true, Ordering::AcqRel) {
        return Err("An update download is already in progress.".to_string());
    }
    let result = app_update_download_inner(&app).await;
    APP_UPDATE_INSTALLING.store(false, Ordering::Release);
    if let Err(error) = &result {
        let _ = app.emit(
            APP_UPDATE_STATE_EVENT,
            json!({ "state": "failed", "error": error }),
        );
        log_terminal_status_event(
            "backend.app_update.download_failed",
            json!({ "error": error }),
        );
    }
    result
}

#[tauri::command]
async fn app_update_restart(app: AppHandle) -> Result<(), String> {
    if APP_UPDATE_INSTALLING.swap(true, Ordering::AcqRel) {
        return Err("An update operation is already in progress.".to_string());
    }
    let result = app_update_restart_inner(&app).await;
    if let Err(error) = &result {
        APP_UPDATE_INSTALLING.store(false, Ordering::Release);
        let _ = app.emit(
            APP_UPDATE_STATE_EVENT,
            json!({ "state": "failed", "error": error }),
        );
        log_terminal_status_event(
            "backend.app_update.restart_failed",
            json!({ "error": error }),
        );
    }
    result
}

async fn app_update_download_inner(app: &AppHandle) -> Result<Value, String> {
    let updater = app_updater_instance(app)?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("Update check failed: {error}"))?
        .ok_or_else(|| "No update is available.".to_string())?;
    let info = AppUpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone(),
    };
    app_update_store_available(Some(info));
    app_update_store_staged(None);

    let _ = app.emit(
        APP_UPDATE_STATE_EVENT,
        json!({ "state": "downloading", "version": update.version }),
    );
    log_terminal_status_event(
        "backend.app_update.download_started",
        json!({ "version": update.version }),
    );

    let version = update.version.clone();
    let bytes = app_update_download_bytes(app, &update).await?;

    #[cfg(windows)]
    {
        app_update_store_staged(Some(AppUpdateStaged {
            version: version.clone(),
            installed: false,
            bytes: Some(bytes),
            update: Some(update),
        }));
        let _ = app.emit(
            APP_UPDATE_STATE_EVENT,
            json!({ "state": "ready", "version": version, "installed": false }),
        );
        log_terminal_status_event("backend.app_update.downloaded", json!({}));
        Ok(app_update_status_snapshot())
    }

    #[cfg(not(windows))]
    {
        update
            .install(&bytes)
            .map_err(|error| format!("Update install failed: {error}"))?;
        app_update_store_staged(Some(AppUpdateStaged {
            version: version.clone(),
            installed: true,
            bytes: None,
            #[cfg(windows)]
            update: None,
        }));
        let _ = app.emit(
            APP_UPDATE_STATE_EVENT,
            json!({ "state": "ready", "version": version, "installed": true }),
        );
        log_terminal_status_event("backend.app_update.staged", json!({}));
        Ok(app_update_status_snapshot())
    }
}

async fn app_update_install_inner(app: &AppHandle) -> Result<(), String> {
    if app_update_staged_info().is_some() {
        return app_update_restart_inner(app).await;
    }

    let updater = app_updater_instance(app)?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("Update check failed: {error}"))?
        .ok_or_else(|| "No update is available.".to_string())?;

    let _ = app.emit(
        APP_UPDATE_STATE_EVENT,
        json!({ "state": "downloading", "version": update.version }),
    );
    log_terminal_status_event(
        "backend.app_update.install_started",
        json!({ "version": update.version }),
    );

    let bytes = app_update_download_bytes(app, &update).await?;
    update
        .install(bytes)
        .map_err(|error| format!("Update install failed: {error}"))?;

    // On Windows the NSIS installer takes over and the process exits inside
    // install; on macOS/Linux the swapped bundle only takes effect after this
    // relaunch.
    let _ = app.emit(APP_UPDATE_STATE_EVENT, json!({ "state": "installed" }));
    log_terminal_status_event("backend.app_update.installed", json!({}));
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

async fn app_update_download_bytes(
    app: &AppHandle,
    update: &tauri_plugin_updater::Update,
) -> Result<Vec<u8>, String> {
    let progress_app = app.clone();
    let mut downloaded: u64 = 0;
    let mut next_progress: u64 = APP_UPDATE_PROGRESS_STEP_BYTES;
    update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                if downloaded >= next_progress || Some(downloaded) == total {
                    while next_progress <= downloaded {
                        next_progress += APP_UPDATE_PROGRESS_STEP_BYTES;
                    }
                    let _ = progress_app.emit(
                        APP_UPDATE_PROGRESS_EVENT,
                        json!({ "downloaded": downloaded, "total": total }),
                    );
                }
            },
            || {},
        )
        .await
        .map_err(|error| format!("Update download failed: {error}"))
}

async fn app_update_restart_inner(app: &AppHandle) -> Result<(), String> {
    let staged = app_update_staged_for_restart()
        .ok_or_else(|| "No downloaded update is ready.".to_string())?;
    let _ = app.emit(
        APP_UPDATE_STATE_EVENT,
        json!({ "state": "restarting", "version": staged.version }),
    );

    #[cfg(windows)]
    {
        let bytes = staged.bytes.ok_or_else(|| {
            "Downloaded update bytes are missing. Click Update to download it again.".to_string()
        })?;
        let update = staged.update.ok_or_else(|| {
            "Downloaded update metadata is missing. Click Update to download it again.".to_string()
        })?;
        log_terminal_status_event("backend.app_update.restart_installing", json!({}));
        update
            .install(bytes)
            .map_err(|error| format!("Update install failed: {error}"))?;
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        if !staged.installed {
            return Err(
                "Downloaded update is not installed yet. Click Update to download it again."
                    .to_string(),
            );
        }
        log_terminal_status_event("backend.app_update.restarting", json!({}));
    }
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

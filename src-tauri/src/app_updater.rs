// Over-the-wire app updates (tauri-plugin-updater). The app checks the
// signed manifest at plugins.updater.endpoints on startup and every few
// hours, downloads in the background only when the user asks, and restarts
// only from the explicit restart affordance or the user's idle-restart opt-in.
//
// Env overrides: DIFFFORGE_UPDATER_URL replaces the manifest endpoint;
// DIFFFORGE_UPDATER_FORCE=1 enables checks in debug builds (off by default
// so `npm run dev` never talks to the release feed);
// DIFFFORGE_DAEMON_AUTO_UPDATE=0 disables daemon-mode idle auto-restart.

use tauri_plugin_updater::UpdaterExt as AppUpdaterExt;

const APP_UPDATE_AVAILABLE_EVENT: &str = "forge-app-update-available";
const APP_UPDATE_PROGRESS_EVENT: &str = "forge-app-update-progress";
const APP_UPDATE_STATE_EVENT: &str = "forge-app-update-state";
const APP_UPDATE_RECHECK_INTERVAL_SECS: u64 = 4 * 60 * 60;
const APP_UPDATE_PROGRESS_STEP_BYTES: u64 = 1024 * 1024;
// While an update is pending and auto-restart is enabled, poll terminal
// idleness on this cadence, and require it to hold across a confirmation
// pause so a just-submitted prompt never races the restart.
const APP_UPDATE_IDLE_POLL_SECS: u64 = 5 * 60;
const APP_UPDATE_IDLE_CONFIRM_SECS: u64 = 60;
const APP_UPDATE_SETTINGS_STATE_KEY: &str = "app-update-settings";
const APP_UPDATE_STATE_IDLE: u8 = 0;
const APP_UPDATE_STATE_CHECKING: u8 = 1;
const APP_UPDATE_STATE_DOWNLOADING: u8 = 2;
const APP_UPDATE_STATE_READY: u8 = 3;
const APP_UPDATE_STATE_RESTARTING: u8 = 4;
const APP_UPDATE_STATE_FAILED: u8 = 5;

static APP_UPDATE_INSTALLING: AtomicBool = AtomicBool::new(false);
// GUI mode is opt-in. Daemons default to on unless DIFFFORGE_DAEMON_AUTO_UPDATE=0.
static APP_UPDATE_AUTO_WHEN_IDLE: AtomicBool = AtomicBool::new(false);
static APP_UPDATE_REMOTE_RESTART_WATCH_ACTIVE: AtomicBool = AtomicBool::new(false);
static APP_UPDATE_AUTH_TRANSPORT_RESTART_DEFERRED: AtomicBool = AtomicBool::new(false);
static APP_UPDATE_AUTH_RESTART_BLOCKED: AtomicBool = AtomicBool::new(false);
static APP_UPDATE_STATE: AtomicU8 = AtomicU8::new(APP_UPDATE_STATE_IDLE);
static APP_UPDATE_AVAILABLE: StdMutex<Option<AppUpdateInfo>> = StdMutex::new(None);
static APP_UPDATE_STAGED: StdMutex<Option<AppUpdateStaged>> = StdMutex::new(None);
static APP_UPDATE_LAST_ERROR: StdMutex<Option<String>> = StdMutex::new(None);

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AppUpdateAutomaticRestartAuthDecision {
    Proceed,
    Block,
    Defer,
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

fn app_update_last_error() -> Option<String> {
    APP_UPDATE_LAST_ERROR
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn app_update_store_last_error(error: Option<String>) {
    *APP_UPDATE_LAST_ERROR
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = error;
}

fn app_update_settings_to_value() -> Value {
    json!({
        "autoRestartWhenIdle": APP_UPDATE_AUTO_WHEN_IDLE.load(Ordering::Acquire),
    })
}

fn app_update_daemon_auto_update_disabled_from_env_value(value: Option<&str>) -> bool {
    value
        .map(str::trim)
        .map(|value| {
            value == "0"
                || value.eq_ignore_ascii_case("false")
                || value.eq_ignore_ascii_case("off")
                || value.eq_ignore_ascii_case("no")
        })
        .unwrap_or(false)
}

fn app_update_effective_auto_restart_when_idle(
    persisted_auto: bool,
    daemon_mode: bool,
    daemon_auto_env: Option<&str>,
) -> bool {
    if daemon_mode && app_update_daemon_auto_update_disabled_from_env_value(daemon_auto_env) {
        return false;
    }
    persisted_auto || daemon_mode
}

fn app_update_effective_auto_restart_when_idle_for_current_process(persisted_auto: bool) -> bool {
    let daemon_auto_env = std::env::var("DIFFFORGE_DAEMON_AUTO_UPDATE").ok();
    app_update_effective_auto_restart_when_idle(
        persisted_auto,
        crate::daemon_mode_active(),
        daemon_auto_env.as_deref(),
    )
}

pub(crate) fn app_update_settings_initialize(app: &AppHandle) {
    let raw = app_local_state_read(app, APP_UPDATE_SETTINGS_STATE_KEY);
    let persisted_auto = raw
        .get("autoRestartWhenIdle")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let auto = app_update_effective_auto_restart_when_idle_for_current_process(persisted_auto);
    APP_UPDATE_AUTO_WHEN_IDLE.store(auto, Ordering::Release);
}

fn app_update_settings_save(
    app: &AppHandle,
    auto_restart_when_idle: bool,
) -> Result<Value, String> {
    let effective_auto =
        app_update_effective_auto_restart_when_idle_for_current_process(auto_restart_when_idle);
    APP_UPDATE_AUTO_WHEN_IDLE.store(effective_auto, Ordering::Release);
    let value = app_update_settings_to_value();
    app_local_state_write(
        app,
        APP_UPDATE_SETTINGS_STATE_KEY,
        &json!({ "autoRestartWhenIdle": auto_restart_when_idle }),
    )?;
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

#[cfg(target_os = "linux")]
fn app_update_validate_platform_install_target() -> Result<(), String> {
    let appimage = std::env::var_os("APPIMAGE")
        .map(|value| value.to_string_lossy().trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Linux app updates require an AppImage launch with APPIMAGE set; refusing to run the updater for this install."
                .to_string()
        })?;
    if !std::path::Path::new(&appimage).is_file() {
        return Err(format!(
            "Linux app updates require APPIMAGE to point at the running AppImage; path is not a file: {}",
            clean_terminal_telemetry_text(&appimage)
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn app_update_validate_platform_install_target() -> Result<(), String> {
    Ok(())
}

fn app_updater_instance(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    app_update_validate_platform_install_target()?;
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
        "error": app_update_last_error(),
        "currentVersion": env!("CARGO_PKG_VERSION"),
    })
}

fn app_update_state_label(state: u8) -> &'static str {
    match state {
        APP_UPDATE_STATE_CHECKING => "checking",
        APP_UPDATE_STATE_DOWNLOADING => "downloading",
        APP_UPDATE_STATE_READY => "ready",
        APP_UPDATE_STATE_RESTARTING => "restarting",
        APP_UPDATE_STATE_FAILED => "failed",
        _ => "idle",
    }
}

fn app_update_store_state(state: u8) {
    if state != APP_UPDATE_STATE_FAILED {
        app_update_store_last_error(None);
    }
    APP_UPDATE_STATE.store(state, Ordering::Release);
}

fn app_update_store_failed_state(error: &str) {
    app_update_store_last_error(Some(error.to_string()));
    app_update_store_state(APP_UPDATE_STATE_FAILED);
}

fn app_update_publish_device_state(app: &AppHandle, reason: &str) {
    let state = app.state::<CloudMcpState>().inner().clone();
    let reason = reason.to_string();
    tauri::async_runtime::spawn(async move {
        cloud_mcp_publish_device_live_state_snapshot_debounced(&state, &reason).await;
    });
}

async fn app_update_publish_device_state_now(app: &AppHandle, reason: &str) {
    let state = app.state::<CloudMcpState>().inner().clone();
    cloud_mcp_publish_device_live_state_snapshot(&state, reason).await;
}

fn app_update_automatic_restart_auth_decision(
    status: DesktopAuthPreflightStatus,
    _daemon_mode: bool,
    transport_deferred_once: bool,
) -> AppUpdateAutomaticRestartAuthDecision {
    match status {
        DesktopAuthPreflightStatus::AuthOk | DesktopAuthPreflightStatus::NoSession => {
            AppUpdateAutomaticRestartAuthDecision::Proceed
        }
        DesktopAuthPreflightStatus::AuthRejected => AppUpdateAutomaticRestartAuthDecision::Block,
        DesktopAuthPreflightStatus::TransportError if transport_deferred_once => {
            AppUpdateAutomaticRestartAuthDecision::Proceed
        }
        DesktopAuthPreflightStatus::TransportError => AppUpdateAutomaticRestartAuthDecision::Defer,
    }
}

fn app_update_emit_auth_restart_blocked(
    app: &AppHandle,
    source: &str,
    error: &str,
    detail: Option<&str>,
) {
    app_update_store_failed_state(error);
    app_update_publish_device_state(app, "app_update_auth_restart_blocked");
    let detail = detail
        .map(clean_terminal_telemetry_text)
        .unwrap_or_default();
    let _ = app.emit(
        APP_UPDATE_STATE_EVENT,
        json!({
            "state": "failed",
            "error": error,
            "detail": detail,
            "source": source,
        }),
    );
    log_terminal_status_event(
        "backend.app_update.auth_restart_blocked",
        json!({
            "source": source,
            "error": error,
            "detail": detail,
        }),
    );
}

async fn app_update_automatic_restart_auth_gate(
    app: &AppHandle,
    source: &str,
) -> Result<(), String> {
    let cloud_mcp_state = app.state::<CloudMcpState>().inner().clone();
    let preflight = desktop_auth_preflight_automatic_restart(app, &cloud_mcp_state).await;
    let transport_deferred_once =
        APP_UPDATE_AUTH_TRANSPORT_RESTART_DEFERRED.load(Ordering::Acquire);
    let decision = app_update_automatic_restart_auth_decision(
        preflight.status,
        crate::daemon_mode_active(),
        transport_deferred_once,
    );

    match decision {
        AppUpdateAutomaticRestartAuthDecision::Proceed => {
            if preflight.status == DesktopAuthPreflightStatus::NoSession
                && APP_UPDATE_AUTH_RESTART_BLOCKED.load(Ordering::Acquire)
            {
                app_update_emit_auth_restart_blocked(
                    app,
                    source,
                    "auth_expired_restart_blocked",
                    Some("Stored desktop session was rejected before restart."),
                );
                return Err("auth_expired_restart_blocked".to_string());
            }
            if preflight.status == DesktopAuthPreflightStatus::AuthOk {
                APP_UPDATE_AUTH_RESTART_BLOCKED.store(false, Ordering::Release);
            }
            if preflight.status == DesktopAuthPreflightStatus::TransportError {
                log_terminal_status_event(
                    "backend.app_update.auth_transport_restart_allowed_after_defer",
                    json!({
                        "source": source,
                        "error": preflight.error.as_deref().map(clean_terminal_telemetry_text),
                    }),
                );
            }
            APP_UPDATE_AUTH_TRANSPORT_RESTART_DEFERRED.store(false, Ordering::Release);
            Ok(())
        }
        AppUpdateAutomaticRestartAuthDecision::Block => {
            APP_UPDATE_AUTH_TRANSPORT_RESTART_DEFERRED.store(false, Ordering::Release);
            APP_UPDATE_AUTH_RESTART_BLOCKED.store(true, Ordering::Release);
            app_update_emit_auth_restart_blocked(
                app,
                source,
                "auth_expired_restart_blocked",
                preflight.error.as_deref(),
            );
            Err("auth_expired_restart_blocked".to_string())
        }
        AppUpdateAutomaticRestartAuthDecision::Defer => {
            APP_UPDATE_AUTH_TRANSPORT_RESTART_DEFERRED.store(true, Ordering::Release);
            APP_UPDATE_AUTH_RESTART_BLOCKED.store(false, Ordering::Release);
            app_update_emit_auth_restart_blocked(
                app,
                source,
                "auth_transport_restart_deferred",
                preflight.error.as_deref(),
            );
            Err("auth_transport_restart_deferred".to_string())
        }
    }
}

async fn app_update_install_and_restart_automatic(
    app: AppHandle,
    source: &str,
) -> Result<(), String> {
    app_update_automatic_restart_auth_gate(&app, source).await?;
    app_update_install_and_restart(app).await
}

fn app_update_restart_or_exit(app: &AppHandle) {
    if crate::daemon_mode_active() && cfg!(target_os = "linux") {
        log_terminal_status_event(
            "backend.app_update.daemon_exit_for_systemd_restart",
            json!({}),
        );
        app.exit(0);
    } else {
        app.restart();
    }
}

pub(crate) fn app_update_device_payload() -> Value {
    let available = app_update_available_snapshot();
    let staged = app_update_staged_info();
    let available_version = staged
        .as_ref()
        .map(|info| info.version.clone())
        .or_else(|| available.as_ref().map(|info| info.version.clone()));
    let stored_state = APP_UPDATE_STATE.load(Ordering::Acquire);
    let state = if APP_UPDATE_INSTALLING.load(Ordering::Acquire)
        && !matches!(
            stored_state,
            APP_UPDATE_STATE_CHECKING | APP_UPDATE_STATE_DOWNLOADING | APP_UPDATE_STATE_RESTARTING
        ) {
        APP_UPDATE_STATE_RESTARTING
    } else if staged.is_some()
        && !matches!(
            stored_state,
            APP_UPDATE_STATE_CHECKING
                | APP_UPDATE_STATE_DOWNLOADING
                | APP_UPDATE_STATE_RESTARTING
                | APP_UPDATE_STATE_FAILED
        ) {
        APP_UPDATE_STATE_READY
    } else {
        stored_state
    };
    json!({
        "current_version": env!("CARGO_PKG_VERSION"),
        "available_version": available_version,
        "state": app_update_state_label(state),
        "error": app_update_last_error(),
    })
}

fn app_update_operation_in_progress_error(error: &str) -> bool {
    error.contains("already in progress")
}

fn app_update_auth_restart_gate_error(error: &str) -> bool {
    matches!(
        error,
        "auth_expired_restart_blocked" | "auth_transport_restart_deferred"
    )
}

fn app_update_already_running_response(daemon_mode: bool) -> Value {
    json!({
        "ok": true,
        "queued": false,
        "already_running": true,
        "daemon_mode": daemon_mode,
        "auto_restart_when_idle": APP_UPDATE_AUTO_WHEN_IDLE.load(Ordering::Acquire),
        "app_update": app_update_device_payload(),
        "status": app_update_status_snapshot(),
    })
}

fn app_update_remote_restart_queued_response(daemon_mode: bool, newly_queued: bool) -> Value {
    json!({
        "ok": true,
        "daemon_mode": daemon_mode,
        "queued": true,
        "restart_when_idle": true,
        "already_queued": !newly_queued,
        "app_update": app_update_device_payload(),
        "status": app_update_status_snapshot(),
    })
}

fn app_update_remote_restart_gate_response(
    daemon_mode: bool,
    newly_queued: bool,
    error: &str,
) -> Value {
    let clean_error = clean_terminal_telemetry_text(error);
    json!({
        "ok": false,
        "daemon_mode": daemon_mode,
        "queued": true,
        "restart_when_idle": true,
        "already_queued": !newly_queued,
        "error": clean_error,
        "app_update": app_update_device_payload(),
        "status": app_update_status_snapshot(),
    })
}

async fn app_updater_run_check(app: &AppHandle) -> Result<Option<AppUpdateInfo>, String> {
    app_update_store_state(APP_UPDATE_STATE_CHECKING);
    app_update_publish_device_state(app, "app_update_checking");
    let updater = match app_updater_instance(app) {
        Ok(updater) => updater,
        Err(error) => {
            app_update_store_failed_state(&error);
            app_update_publish_device_state(app, "app_update_failed");
            return Err(error);
        }
    };
    let update = match updater.check().await {
        Ok(update) => update,
        Err(error) => {
            let error = format!("Update check failed: {error}");
            app_update_store_failed_state(&error);
            app_update_publish_device_state(app, "app_update_failed");
            return Err(error);
        }
    };
    let Some(update) = update else {
        app_update_store_available(None);
        if app_update_staged_info().is_none() {
            app_update_store_state(APP_UPDATE_STATE_IDLE);
        } else {
            app_update_store_state(APP_UPDATE_STATE_READY);
        }
        app_update_publish_device_state(app, "app_update_idle");
        return Ok(None);
    };
    let info = AppUpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone(),
    };
    app_update_store_available(Some(info.clone()));
    if app_update_staged_info().is_none() {
        app_update_store_state(APP_UPDATE_STATE_IDLE);
    } else {
        app_update_store_state(APP_UPDATE_STATE_READY);
    }
    app_update_publish_device_state(app, "app_update_available");
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
        // Check immediately on startup so the update button is present the
        // moment the main window paints (the webview reads app_update_status
        // on mount and also listens for the available event). Subsequent
        // checks fall on the recheck interval at the bottom of the loop.
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
                if let Err(error) = app_update_install_and_restart_automatic(
                    app.clone(),
                    "idle_watcher",
                )
                .await
                {
                    log_terminal_status_event(
                        "backend.app_update.auto_restart_failed",
                        json!({ "error": error }),
                    );
                    // Back off before the outer loop re-checks, so a
                    // persistent failure can't turn into a download storm.
                    sleep(Duration::from_secs(APP_UPDATE_IDLE_POLL_SECS)).await;
                    if app_update_auth_restart_gate_error(&error) {
                        continue;
                    }
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
        app_update_store_failed_state(error);
        app_update_publish_device_state(&app, "app_update_failed");
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
        app_update_store_failed_state(error);
        app_update_publish_device_state(&app, "app_update_failed");
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
        app_update_store_failed_state(error);
        app_update_publish_device_state(&app, "app_update_failed");
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

pub(crate) async fn app_update_remote_now(app: AppHandle) -> Value {
    let daemon_mode = crate::daemon_mode_active();
    if APP_UPDATE_INSTALLING.load(Ordering::Acquire) {
        return app_update_already_running_response(daemon_mode);
    }

    if app_update_staged_info().is_some() {
        if daemon_mode {
            let gate_result =
                app_update_automatic_restart_auth_gate(&app, "remote_app_update_now_ack").await;
            let newly_queued = app_update_spawn_remote_restart_when_idle(app.clone());
            if let Err(error) = gate_result {
                return app_update_remote_restart_gate_response(daemon_mode, newly_queued, &error);
            }
            return app_update_remote_restart_queued_response(daemon_mode, newly_queued);
        }
        return json!({
            "ok": true,
            "daemon_mode": daemon_mode,
            "queued": false,
            "restart_when_idle": false,
            "app_update": app_update_device_payload(),
            "status": app_update_status_snapshot(),
        });
    }

    let download_result = app_update_download(app.clone()).await;
    let mut remote_restart_queued = None;
    let mut remote_restart_gate_error = None;
    if daemon_mode && download_result.is_ok() && app_update_staged_info().is_some() {
        remote_restart_gate_error =
            app_update_automatic_restart_auth_gate(&app, "remote_app_update_now_ack")
                .await
                .err();
        remote_restart_queued = Some(app_update_spawn_remote_restart_when_idle(app.clone()));
    }

    match download_result {
        Ok(status) => {
            if let (Some(newly_queued), Some(error)) =
                (remote_restart_queued, remote_restart_gate_error)
            {
                return app_update_remote_restart_gate_response(daemon_mode, newly_queued, &error);
            }
            json!({
                "ok": true,
                "daemon_mode": daemon_mode,
                "queued": remote_restart_queued.is_some(),
                "restart_when_idle": remote_restart_queued.is_some(),
                "already_queued": remote_restart_queued
                    .map(|newly_queued| !newly_queued)
                    .unwrap_or(false),
                "app_update": app_update_device_payload(),
                "status": status,
            })
        }
        Err(error) => {
            if app_update_operation_in_progress_error(&error) {
                return app_update_already_running_response(daemon_mode);
            }
            let no_update = error.contains("No update is available");
            if no_update {
                app_update_store_state(APP_UPDATE_STATE_IDLE);
            }
            let clean_error = clean_terminal_telemetry_text(&error);
            let message = if no_update {
                "No update is available.".to_string()
            } else {
                clean_error.clone()
            };
            json!({
                "ok": no_update,
                "daemon_mode": daemon_mode,
                "error": if no_update { Value::Null } else { json!(clean_error) },
                "message": message,
                "app_update": app_update_device_payload(),
                "status": app_update_status_snapshot(),
            })
        }
    }
}

fn app_update_spawn_remote_restart_when_idle(app: AppHandle) -> bool {
    if APP_UPDATE_REMOTE_RESTART_WATCH_ACTIVE.swap(true, Ordering::AcqRel) {
        return false;
    }
    tauri::async_runtime::spawn(async move {
        app_update_remote_restart_when_idle(app).await;
        APP_UPDATE_REMOTE_RESTART_WATCH_ACTIVE.store(false, Ordering::Release);
    });
    true
}

async fn app_update_remote_restart_when_idle(app: AppHandle) {
    loop {
        if crate::app_shutdown_requested() {
            return;
        }
        if !APP_UPDATE_INSTALLING.load(Ordering::Acquire)
            && app_update_all_terminals_idle(&app).await
        {
            sleep(Duration::from_secs(APP_UPDATE_IDLE_CONFIRM_SECS)).await;
            if crate::app_shutdown_requested() {
                return;
            }
            if app_update_all_terminals_idle(&app).await {
                let result = app_update_install_and_restart_automatic(
                    app.clone(),
                    "remote_app_update_now",
                )
                .await;
                if let Err(error) = result {
                    log_terminal_status_event(
                        "backend.app_update.remote_restart_failed",
                        json!({ "error": clean_terminal_telemetry_text(&error) }),
                    );
                    if app_update_auth_restart_gate_error(&error) {
                        sleep(Duration::from_secs(APP_UPDATE_IDLE_POLL_SECS)).await;
                        continue;
                    }
                }
                return;
            }
        }
        sleep(Duration::from_secs(APP_UPDATE_IDLE_POLL_SECS)).await;
    }
}

async fn app_update_download_inner(app: &AppHandle) -> Result<Value, String> {
    app_update_store_state(APP_UPDATE_STATE_CHECKING);
    app_update_publish_device_state(app, "app_update_checking");
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
    app_update_store_state(APP_UPDATE_STATE_DOWNLOADING);
    app_update_publish_device_state(app, "app_update_downloading");
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
        app_update_store_state(APP_UPDATE_STATE_READY);
        app_update_publish_device_state(app, "app_update_ready");
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
        app_update_store_state(APP_UPDATE_STATE_READY);
        app_update_publish_device_state(app, "app_update_ready");
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

    app_update_store_state(APP_UPDATE_STATE_CHECKING);
    app_update_publish_device_state(app, "app_update_checking");
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
    app_update_store_state(APP_UPDATE_STATE_DOWNLOADING);
    app_update_publish_device_state(app, "app_update_downloading");
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
    app_update_store_state(APP_UPDATE_STATE_RESTARTING);
    app_update_publish_device_state_now(app, "app_update_restarting").await;
    let _ = app.emit(APP_UPDATE_STATE_EVENT, json!({ "state": "restarting" }));
    log_terminal_status_event("backend.app_update.installed", json!({}));
    app_update_restart_or_exit(app);
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
    app_update_store_state(APP_UPDATE_STATE_RESTARTING);
    app_update_publish_device_state_now(app, "app_update_restarting").await;
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
    app_update_restart_or_exit(app);
    #[allow(unreachable_code)]
    Ok(())
}

#[cfg(test)]
mod app_update_tests {
    use super::*;

    #[test]
    fn effective_auto_restart_uses_daemon_default() {
        assert!(app_update_effective_auto_restart_when_idle(false, true, None));
        assert!(app_update_effective_auto_restart_when_idle(true, false, None));
        assert!(!app_update_effective_auto_restart_when_idle(false, false, None));
    }

    #[test]
    fn daemon_auto_update_env_zero_disables_daemon_default() {
        assert!(!app_update_effective_auto_restart_when_idle(
            false,
            true,
            Some("0")
        ));
        assert!(!app_update_effective_auto_restart_when_idle(
            true,
            true,
            Some("false")
        ));
        assert!(app_update_effective_auto_restart_when_idle(
            true,
            false,
            Some("0")
        ));
    }

    #[test]
    fn automatic_restart_auth_decision_blocks_auth_rejection() {
        for daemon_mode in [false, true] {
            assert_eq!(
                app_update_automatic_restart_auth_decision(
                    DesktopAuthPreflightStatus::AuthOk,
                    daemon_mode,
                    false,
                ),
                AppUpdateAutomaticRestartAuthDecision::Proceed
            );
            assert_eq!(
                app_update_automatic_restart_auth_decision(
                    DesktopAuthPreflightStatus::NoSession,
                    daemon_mode,
                    false,
                ),
                AppUpdateAutomaticRestartAuthDecision::Proceed
            );
            assert_eq!(
                app_update_automatic_restart_auth_decision(
                    DesktopAuthPreflightStatus::AuthRejected,
                    daemon_mode,
                    false,
                ),
                AppUpdateAutomaticRestartAuthDecision::Block
            );
        }
    }

    #[test]
    fn automatic_restart_auth_decision_defers_one_transport_cycle() {
        for daemon_mode in [false, true] {
            assert_eq!(
                app_update_automatic_restart_auth_decision(
                    DesktopAuthPreflightStatus::TransportError,
                    daemon_mode,
                    false,
                ),
                AppUpdateAutomaticRestartAuthDecision::Defer
            );
            assert_eq!(
                app_update_automatic_restart_auth_decision(
                    DesktopAuthPreflightStatus::TransportError,
                    daemon_mode,
                    true,
                ),
                AppUpdateAutomaticRestartAuthDecision::Proceed
            );
        }
    }
}

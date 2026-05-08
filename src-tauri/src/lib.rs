use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex as StdMutex, OnceLock,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest as Sha1Digest, Sha1};
use sha2::Sha256;
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tokio::{
    sync::{mpsc, Mutex, RwLock},
    time::{interval, MissedTickBehavior},
};

const API_BASE_URL: &str = "https://diffforge.ai/api";
const MIN_AUTH_VALUE_LENGTH: usize = 24;
const MAX_AUTH_VALUE_LENGTH: usize = 192;
const DEFAULT_API_TIMEOUT_SECS: u64 = 10;
const AUTH_EXCHANGE_TIMEOUT_SECS: u64 = 10;
const SESSION_VALIDATE_TIMEOUT_SECS: u64 = 5;
const LOGOUT_TIMEOUT_SECS: u64 = 5;
const AGENT_STATUS_TIMEOUT_SECS: u64 = 6;
const AGENT_UPDATE_CHECK_TIMEOUT_SECS: u64 = 3;
const AGENT_INSTALL_TIMEOUT_SECS: u64 = 240;
const AGENT_RUN_TIMEOUT_SECS: u64 = 120;
const AGENT_LOGOUT_TIMEOUT_SECS: u64 = 30;
const MAX_FORGE_PROMPT_LENGTH: usize = 12_000;
const MAX_FORGE_MODEL_LENGTH: usize = 80;
const MAX_FORGE_IMAGES: usize = 4;
const MAX_FORGE_IMAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_FORGE_IMAGE_TOTAL_BYTES: usize = 8 * 1024 * 1024;
const TERMINAL_DEFAULT_COLS: u16 = 80;
const TERMINAL_DEFAULT_ROWS: u16 = 24;
const TERMINAL_MIN_COLS: u16 = 20;
const TERMINAL_MIN_ROWS: u16 = 6;
const TERMINAL_MAX_COLS: u16 = 400;
const TERMINAL_MAX_ROWS: u16 = 160;
const MAX_TERMINAL_WRITE_BYTES: usize = 64 * 1024;
const MAX_TERMINAL_START_AGENT_BATCH: usize = 32;
const TERMINAL_PTY_POOL_TARGET: usize = 0;
const TERMINAL_OUTPUT_READ_BUFFER_BYTES: usize = 8192;
const TERMINAL_OUTPUT_FRAME_MICROS: u64 = 16_667;
const MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH: usize = 2048;
const MAX_FILE_EXPLORER_ENTRIES: usize = 600;
const MAX_WORKSPACE_FILE_READ_BYTES: u64 = 1024 * 1024;
const MAX_WORKSPACE_FILE_DIFF_BYTES: usize = 384 * 1024;
const GIT_STATUS_TIMEOUT_SECS: u64 = 2;
const GIT_DIFF_TIMEOUT_SECS: u64 = 3;
const TERMINAL_SHUTDOWN_POLL_ATTEMPTS: usize = 40;
const TERMINAL_SHUTDOWN_POLL_INTERVAL_MS: u64 = 25;
const TERMINAL_CLOSE_COMMAND_WAIT_MS: u64 = 3_000;
const TERMINAL_CLOSE_ALL_WAIT_MS: u64 = 3_000;
const APP_CLOSE_EXIT_REQUEST_DELAY_MS: u64 = 50;
const APP_CLOSE_DESTROY_FALLBACK_DELAY_MS: u64 = 250;
const APP_CLOSE_PROCESS_EXIT_FALLBACK_DELAY_MS: u64 = 1_500;
const TERMINAL_TELEMETRY_LOGGING_ENABLED: bool = false;
const TERMINAL_TELEMETRY_LOG_DIR: &str = "logs";
const TERMINAL_TELEMETRY_LOG_FILE: &str = "terminal-telemetry.jsonl";
const TERMINAL_TELEMETRY_MAX_TEXT: usize = 512;
const TERMINAL_CLOSE_ALL_PROGRESS_EVENT: &str = "forge-terminal-close-all-progress";
const AUDIO_WIDGET_WINDOW_LABEL: &str = "audio-widget";
const AUDIO_WIDGET_ARM_EVENT: &str = "forge-audio-widget-arm";
const AUDIO_SHORTCUT: &str = "CommandOrControl+Shift+Space";
const WHISPER_MODEL_ID: &str = "base.en";
const WHISPER_MODEL_NAME: &str = "Whisper base.en";
const WHISPER_MODEL_FILE: &str = "ggml-base.en.bin";
const WHISPER_MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const WHISPER_MODEL_SHA1: &str = "137c40403d78fd54d454da0f9bd998f78703390c";
const WHISPER_RUNTIME_NAME: &str = "whisper.cpp CLI";
#[cfg(windows)]
const WHISPER_RUNTIME_PACKAGE_NAME: &str = "whisper.cpp v1.8.4 x64";
#[cfg(not(windows))]
const WHISPER_RUNTIME_PACKAGE_NAME: &str = "PATH whisper.cpp CLI";
#[cfg(windows)]
const WHISPER_RUNTIME_ZIP_FILE: &str = "whisper-bin-x64.zip";
#[cfg(not(windows))]
const WHISPER_RUNTIME_ZIP_FILE: &str = "whisper-runtime.zip";
#[cfg(windows)]
const WHISPER_RUNTIME_URL: Option<&str> =
    Some("https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip");
#[cfg(not(windows))]
const WHISPER_RUNTIME_URL: Option<&str> = None;
#[cfg(windows)]
const WHISPER_RUNTIME_SHA256: Option<&str> =
    Some("74f973345cb52ef5ba3ec9e7e7af8e48cc8c71722d1528603b80588a11f82e3e");
#[cfg(not(windows))]
const WHISPER_RUNTIME_SHA256: Option<&str> = None;
#[cfg(target_os = "macos")]
const WHISPER_RUNTIME_INSTALL_HINT: &str =
    "Install whisper.cpp CLI with Homebrew, then recheck: brew install whisper-cpp";
#[cfg(target_os = "linux")]
const WHISPER_RUNTIME_INSTALL_HINT: &str =
    "Install whisper.cpp CLI and make whisper-cli, whisper, or main available on PATH.";
#[cfg(windows)]
const WHISPER_RUNTIME_INSTALL_HINT: &str =
    "Diff Forge can download the official whisper.cpp x64 runtime automatically.";
const WHISPER_MODEL_DISK_MB: u64 = 142;
const WHISPER_MODEL_MEMORY_MB: u64 = 500;
const WHISPER_DOWNLOAD_TIMEOUT_SECS: u64 = 900;
const WHISPER_MAX_AUDIO_BYTES: usize = 32 * 1024 * 1024;
const WHISPER_TRANSCRIBE_TIMEOUT_SECS: u64 = 180;
const MAX_AUDIO_TRANSCRIPT_INSERT_CHARS: usize = 8_000;
const AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT: &str = "forge-audio-model-download-progress";

static AGENT_COMMAND_CANDIDATE_CACHE: OnceLock<StdMutex<HashMap<&'static str, Vec<String>>>> =
    OnceLock::new();
static LOGIN_TERMINAL_CHILDREN: OnceLock<StdMutex<Vec<std::process::Child>>> = OnceLock::new();
static TERMINAL_TELEMETRY_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();

#[cfg(windows)]
const WINDOWS_APP_ICON_RESOURCE_ID: u16 = 32512;
#[cfg(windows)]
const GCLP_HICON: i32 = -14;
#[cfg(windows)]
const GCLP_HICONSM: i32 = -34;
#[cfg(windows)]
const ICON_SMALL: usize = 0;
#[cfg(windows)]
const ICON_BIG: usize = 1;
#[cfg(windows)]
const IMAGE_ICON: u32 = 1;
#[cfg(windows)]
const LR_DEFAULTCOLOR: u32 = 0;
#[cfg(windows)]
const SM_CXICON: i32 = 11;
#[cfg(windows)]
const SM_CYICON: i32 = 12;
#[cfg(windows)]
const SM_CXSMICON: i32 = 49;
#[cfg(windows)]
const SM_CYSMICON: i32 = 50;
#[cfg(windows)]
const WM_SETICON: u32 = 0x0080;
#[cfg(windows)]
const INPUT_KEYBOARD: u32 = 1;
#[cfg(windows)]
const KEYEVENTF_KEYUP: u32 = 0x0002;
#[cfg(windows)]
const KEYEVENTF_UNICODE: u32 = 0x0004;

#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy)]
struct WindowsMouseInput {
    dx: i32,
    dy: i32,
    mouse_data: u32,
    dw_flags: u32,
    time: u32,
    dw_extra_info: usize,
}

#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy)]
struct WindowsKeyboardInput {
    w_vk: u16,
    w_scan: u16,
    dw_flags: u32,
    time: u32,
    dw_extra_info: usize,
}

#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy)]
struct WindowsHardwareInput {
    u_msg: u32,
    w_param_l: u16,
    w_param_h: u16,
}

#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy)]
union WindowsInputUnion {
    mi: WindowsMouseInput,
    ki: WindowsKeyboardInput,
    hi: WindowsHardwareInput,
}

#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy)]
struct WindowsInput {
    input_type: u32,
    union: WindowsInputUnion,
}

struct TerminalState {
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    pty_pool: Arc<PtyPool>,
    next_terminal_instance_id: AtomicU64,
}

impl Drop for TerminalState {
    fn drop(&mut self) {
        let drop_started_at = Instant::now();
        let mut terminal_lock_failed = false;
        let instances = match self.terminals.try_write() {
            Ok(mut terminals) => terminals
                .drain()
                .collect::<Vec<(String, TerminalInstance)>>(),
            Err(_) => {
                terminal_lock_failed = true;
                Vec::new()
            }
        };
        let active_total = instances.len();
        let warm_ptys = self.pty_pool.drain_for_shutdown();
        let warm_total = warm_ptys.len();

        log_terminal_event(
            "terminal.state.drop.start",
            None,
            None,
            None,
            json!({
                "active_count": active_total,
                "app_pid": std::process::id(),
                "terminal_lock_failed": terminal_lock_failed,
                "warm_count": warm_total,
            }),
        );

        for (pane_id, instance) in instances {
            cleanup_terminal_instance_with_context(instance, true, Some(pane_id), "drop_fallback");
        }

        for warm_pty in warm_ptys {
            cleanup_warm_pty_with_context(warm_pty, "drop_fallback");
        }

        let refill_idle = self.pty_pool.wait_for_refill_idle();
        let login_closed = cleanup_login_terminal_children_with_context("drop_fallback");
        let console_hosts_closed = cleanup_windows_headless_console_hosts("drop_fallback");

        log_terminal_event(
            "terminal.state.drop.done",
            None,
            None,
            Some(drop_started_at.elapsed()),
            json!({
                "active_count": active_total,
                "app_pid": std::process::id(),
                "console_hosts_closed": console_hosts_closed,
                "login_closed": login_closed,
                "refill_idle": refill_idle,
                "terminal_lock_failed": terminal_lock_failed,
                "warm_count": warm_total,
            }),
        );
    }
}

#[derive(Clone)]
struct AudioState {
    download_lock: Arc<Mutex<()>>,
}

#[derive(Clone)]
struct TerminalInstance {
    id: u64,
    child: Arc<Mutex<Option<Box<dyn Child + Send>>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    size: Arc<Mutex<PtySize>>,
    working_directory: Arc<PathBuf>,
    agent_started: Arc<Mutex<bool>>,
}

impl TerminalInstance {
    fn from_warm_shell(
        id: u64,
        warm_pty: WarmPty,
        working_directory: PathBuf,
        agent_started: bool,
    ) -> (Self, Box<dyn Read + Send>) {
        let WarmPty {
            child,
            master,
            writer,
            reader,
            size,
        } = warm_pty;

        (
            Self {
                id,
                child: Arc::new(Mutex::new(Some(child))),
                master: Arc::new(Mutex::new(master)),
                writer: Arc::new(Mutex::new(writer)),
                size: Arc::new(Mutex::new(size)),
                working_directory: Arc::new(working_directory),
                agent_started: Arc::new(Mutex::new(agent_started)),
            },
            reader,
        )
    }
}

struct WarmPty {
    child: Box<dyn Child + Send>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    reader: Box<dyn Read + Send>,
    size: PtySize,
}

struct PtyPool {
    warm: StdMutex<Vec<WarmPty>>,
    refilling: AtomicBool,
    shutting_down: AtomicBool,
}

impl PtyPool {
    fn new() -> Self {
        Self {
            warm: StdMutex::new(Vec::new()),
            refilling: AtomicBool::new(false),
            shutting_down: AtomicBool::new(false),
        }
    }

    fn warm_count(&self) -> usize {
        self.warm.lock().map(|warm| warm.len()).unwrap_or(0)
    }

    fn drain_for_shutdown(&self) -> Vec<WarmPty> {
        self.shutting_down.store(true, Ordering::Release);

        self.warm
            .lock()
            .map(|mut warm| warm.drain(..).collect())
            .unwrap_or_default()
    }

    fn wait_for_refill_idle(&self) -> bool {
        for _ in 0..TERMINAL_SHUTDOWN_POLL_ATTEMPTS {
            if !self.refilling.load(Ordering::Acquire) {
                return true;
            }

            thread::sleep(Duration::from_millis(TERMINAL_SHUTDOWN_POLL_INTERVAL_MS));
        }

        false
    }

    fn ensure_warm_async(self: &Arc<Self>) {
        if self.shutting_down.load(Ordering::Acquire) {
            return;
        }

        if self
            .refilling
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }

        let pool = Arc::clone(self);

        tauri::async_runtime::spawn(async move {
            let worker_pool = Arc::clone(&pool);
            let _ = tauri::async_runtime::spawn_blocking(move || {
                worker_pool.refill_blocking();
            })
            .await;
            pool.refilling.store(false, Ordering::Release);
        });
    }

    fn refill_blocking(&self) {
        loop {
            if self.shutting_down.load(Ordering::Acquire) {
                break;
            }

            if self.warm_count() >= TERMINAL_PTY_POOL_TARGET {
                break;
            }

            let size = PtySize {
                rows: TERMINAL_DEFAULT_ROWS,
                cols: TERMINAL_DEFAULT_COLS,
                pixel_width: 0,
                pixel_height: 0,
            };
            let started_at = Instant::now();

            match create_warm_shell_pty(size) {
                Ok(warm_pty) => {
                    let mut should_cleanup = None;

                    if let Ok(mut warm) = self.warm.lock() {
                        if !self.shutting_down.load(Ordering::Acquire)
                            && warm.len() < TERMINAL_PTY_POOL_TARGET
                        {
                            warm.push(warm_pty);
                            log_terminal_event(
                                "terminal.pool.refill_ready",
                                None,
                                None,
                                Some(started_at.elapsed()),
                                json!({ "warm_count": warm.len() }),
                            );
                        } else {
                            should_cleanup = Some(warm_pty);
                        }
                    } else {
                        should_cleanup = Some(warm_pty);
                    }

                    if let Some(warm_pty) = should_cleanup {
                        cleanup_warm_pty_with_context(warm_pty, "pool_refill_discard");
                        break;
                    }
                }
                Err(error) => {
                    log_terminal_event(
                        "terminal.pool.refill_error",
                        None,
                        None,
                        Some(started_at.elapsed()),
                        json!({ "error": clean_terminal_telemetry_text(&error) }),
                    );
                    break;
                }
            }
        }
    }
}

impl Drop for PtyPool {
    fn drop(&mut self) {
        let warm_ptys = self
            .warm
            .get_mut()
            .map(|warm| warm.drain(..).collect::<Vec<_>>())
            .unwrap_or_default();

        for warm_pty in warm_ptys {
            cleanup_warm_pty_with_context(warm_pty, "pool_drop");
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStatus {
    ok: bool,
    endpoint: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeDesktopSessionRequest<'a> {
    code: &'a str,
    state: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateWorkspaceRequest<'a> {
    name: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateWorkspaceRequest<'a> {
    workspace_id: &'a str,
    name: &'a str,
}

#[derive(Clone, Copy)]
enum AgentProvider {
    Codex,
    Claude,
}

#[derive(Clone, Copy)]
struct AgentDefinition {
    id: &'static str,
    label: &'static str,
    binary: &'static str,
    install_package: &'static str,
    install_command: &'static str,
    native_install_url: &'static str,
    native_install_label: &'static str,
    connect_command: &'static str,
}

struct CommandCapture {
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentStatus {
    id: &'static str,
    label: &'static str,
    binary: &'static str,
    installed: bool,
    authenticated: bool,
    version: String,
    auth_message: String,
    install_command: &'static str,
    native_install_url: &'static str,
    native_install_label: &'static str,
    npm_available: bool,
    npm_version: String,
    npm_installed: bool,
    npm_package_version: String,
    npm_latest_version: String,
    npm_update_available: bool,
    recommend_native_install: bool,
    connect_command: &'static str,
}

struct AgentRuntimeStatus {
    installed: bool,
    authenticated: bool,
    version: String,
    auth_message: String,
    recommend_native_install: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentInstallResult {
    provider: &'static str,
    label: &'static str,
    installed: bool,
    updated: bool,
    permission_denied: bool,
    command: &'static str,
    native_install_url: &'static str,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentLoginStart {
    provider: &'static str,
    command: &'static str,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentLogoutResult {
    provider: &'static str,
    label: &'static str,
    disconnected: bool,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ForgeRunResult {
    provider: &'static str,
    label: &'static str,
    model: String,
    output: String,
    stderr: String,
    working_directory: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForgePromptRequest {
    provider: String,
    prompt: String,
    model: Option<String>,
    working_directory: Option<String>,
    images: Option<Vec<ForgePromptImage>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForgePromptImage {
    name: String,
    mime_type: String,
    data_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ForgeWorkingDirectory {
    working_directory: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDirectoryEntry {
    name: String,
    relative_path: String,
    kind: String,
    size: Option<u64>,
    modified_ms: Option<u64>,
    git_status: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDirectoryListing {
    root: String,
    relative_path: String,
    entries: Vec<WorkspaceDirectoryEntry>,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileText {
    root: String,
    relative_path: String,
    name: String,
    content: String,
    size: u64,
    modified_ms: Option<u64>,
    git_status: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileDiff {
    root: String,
    relative_path: String,
    diff: String,
    truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOpenRequest {
    pane_id: String,
    instance_id: Option<u64>,
    kind: String,
    provider: Option<String>,
    model: Option<String>,
    working_directory: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalStartAgentRequest {
    pane_id: String,
    instance_id: Option<u64>,
    provider: String,
    model: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalStartAgentPaneResult {
    pane_id: String,
    instance_id: Option<u64>,
    started: bool,
    skipped: bool,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalStartAgentManyResult {
    started: usize,
    skipped: usize,
    results: Vec<TerminalStartAgentPaneResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOpenResult {
    pane_id: String,
    instance_id: u64,
    command: String,
    working_directory: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
    pane_id: String,
    instance_id: u64,
    exit_code: Option<i32>,
    exited_at_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalCloseAllResult {
    closed: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalCloseAllProgressPayload {
    closed: usize,
    total: usize,
    pane_id: Option<String>,
    instance_id: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalTelemetryLogRequest {
    ts_ms: Option<u64>,
    pane_id: Option<String>,
    instance_id: Option<u64>,
    phase: String,
    message: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    elapsed_ms: Option<f64>,
    fields: Option<Value>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WhisperModelStatus {
    installed: bool,
    model_installed: bool,
    runtime_installed: bool,
    model_id: &'static str,
    model_name: &'static str,
    model_file: &'static str,
    model_path: String,
    runtime_name: &'static str,
    runtime_package_name: &'static str,
    runtime_path: String,
    runtime_installable: bool,
    runtime_install_hint: &'static str,
    download_url: &'static str,
    expected_sha1: &'static str,
    approximate_disk_mb: u64,
    approximate_memory_mb: u64,
    bytes: u64,
    shortcut: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WhisperModelDownloadProgress {
    state: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<f64>,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WhisperTranscriptionRequest {
    audio_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WhisperTranscriptionResult {
    text: String,
    segments: usize,
    duration_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioWidgetVisibility {
    visible: bool,
    installed: bool,
    shortcut: &'static str,
}

struct PreparedPromptImages {
    directory: PathBuf,
    paths: Vec<String>,
}

include!("validation.rs");
include!("platform.rs");
include!("process.rs");
include!("workspace_files.rs");
include!("terminal_cli.rs");
include!("terminals.rs");
include!("api.rs");
include!("audio.rs");

#[tauri::command]
fn close_app_after_terminal_shutdown(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    let app_pid = std::process::id();
    let window_label = window.label().to_string();

    log_terminal_event(
        "terminal.app_close.exit_schedule",
        None,
        None,
        None,
        json!({
            "app_pid": app_pid,
            "window_label": clean_terminal_telemetry_text(&window_label),
        }),
    );

    let app_for_exit = app.clone();
    thread::Builder::new()
        .name("diffforge-app-close".to_string())
        .spawn(move || {
            thread::sleep(Duration::from_millis(APP_CLOSE_EXIT_REQUEST_DELAY_MS));

            log_terminal_event(
                "terminal.app_close.exit_request",
                None,
                None,
                None,
                json!({
                    "app_pid": app_pid,
                    "window_label": clean_terminal_telemetry_text(&window_label),
                }),
            );
            app_for_exit.exit(0);

            thread::sleep(Duration::from_millis(APP_CLOSE_DESTROY_FALLBACK_DELAY_MS));

            if let Some(window) = app_for_exit.get_webview_window(&window_label) {
                let destroy_started_at = Instant::now();
                log_terminal_event(
                    "terminal.app_close.window_destroy_fallback_start",
                    None,
                    None,
                    None,
                    json!({
                        "app_pid": app_pid,
                        "window_label": clean_terminal_telemetry_text(&window_label),
                    }),
                );

                let destroy_result = window.destroy();
                let (destroy_ok, destroy_error) = match destroy_result {
                    Ok(()) => (true, None),
                    Err(error) => (
                        false,
                        Some(clean_terminal_telemetry_text(&error.to_string())),
                    ),
                };

                log_terminal_event(
                    "terminal.app_close.window_destroy_fallback_done",
                    None,
                    None,
                    Some(destroy_started_at.elapsed()),
                    json!({
                        "app_pid": app_pid,
                        "destroy_ok": destroy_ok,
                        "error": destroy_error,
                        "window_label": clean_terminal_telemetry_text(&window_label),
                    }),
                );
            }

            thread::sleep(Duration::from_millis(
                APP_CLOSE_PROCESS_EXIT_FALLBACK_DELAY_MS,
            ));

            log_terminal_event(
                "terminal.app_close.process_exit_fallback",
                None,
                None,
                None,
                json!({
                    "app_pid": app_pid,
                    "window_label": clean_terminal_telemetry_text(&window_label),
                }),
            );
            std::process::exit(0);
        })
        .map(|_| ())
        .map_err(|error| format!("Failed to schedule app close: {error}"))
}

pub fn run() {
    let mut builder = tauri::Builder::default();
    let pty_pool = Arc::new(PtyPool::new());

    log_terminal_event(
        "terminal.app.process_start",
        None,
        None,
        None,
        json!({ "app_pid": std::process::id() }),
    );

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .manage(TerminalState {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            pty_pool: Arc::clone(&pty_pool),
            next_terminal_instance_id: AtomicU64::new(1),
        })
        .manage(AudioState {
            download_lock: Arc::new(Mutex::new(())),
        })
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            pty_pool.ensure_warm_async();

            if let Err(error) =
                app.global_shortcut()
                    .on_shortcut(AUDIO_SHORTCUT, |app, _shortcut, event| {
                        if event.state != ShortcutState::Pressed {
                            return;
                        }

                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = toggle_audio_widget_for(&app);
                        });
                    })
            {
                eprintln!("Unable to register Diff Forge audio shortcut: {error}");
            }

            #[cfg(any(windows, target_os = "linux"))]
            {
                app.deep_link().register_all()?;
            }

            #[cfg(windows)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(hwnd) = window.hwnd() {
                        pin_windows_hang_icon(hwnd.0);
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_ping,
            exchange_desktop_auth_code,
            validate_desktop_session,
            logout_desktop_session,
            list_workspaces,
            create_workspace,
            update_workspace,
            agent_statuses,
            start_agent_login,
            disconnect_agent,
            install_agent,
            update_agent,
            forge_working_directory,
            validate_workspace_root_directory,
            list_workspace_directory,
            read_workspace_file,
            read_workspace_file_diff,
            run_forge_prompt,
            whisper_model_status,
            download_whisper_model,
            transcribe_whisper_audio,
            show_audio_widget,
            hide_audio_widget,
            toggle_audio_widget,
            insert_transcribed_text,
            terminal_telemetry_log,
            terminal_telemetry_log_many,
            terminal_open,
            terminal_start_agent,
            terminal_start_agent_many,
            terminal_write,
            resize_terminal,
            terminal_resize,
            terminal_close,
            terminal_close_all,
            close_app_after_terminal_shutdown
        ])
        .run(tauri::generate_context!())
        .expect("error while running Diff Forge AI desktop");
}

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
const TERMINAL_PTY_POOL_TARGET: usize = 2;
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
}

impl PtyPool {
    fn new() -> Self {
        Self {
            warm: StdMutex::new(Vec::new()),
            refilling: AtomicBool::new(false),
        }
    }

    fn take_warm(&self) -> Option<WarmPty> {
        self.warm.lock().ok().and_then(|mut warm| warm.pop())
    }

    fn warm_count(&self) -> usize {
        self.warm.lock().map(|warm| warm.len()).unwrap_or(0)
    }

    fn ensure_warm_async(self: &Arc<Self>) {
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
                        if warm.len() < TERMINAL_PTY_POOL_TARGET {
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
                        cleanup_warm_pty(warm_pty);
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

fn is_safe_auth_value(value: &str) -> bool {
    let value_length = value.len();

    value_length >= MIN_AUTH_VALUE_LENGTH
        && value_length <= MAX_AUTH_VALUE_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn validate_auth_value(label: &str, value: &str) -> Result<(), String> {
    if is_safe_auth_value(value) {
        return Ok(());
    }

    Err(format!("{label} is invalid."))
}

#[cfg(windows)]
type WindowsHandle = *mut std::ffi::c_void;

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetModuleHandleW(module_name: *const u16) -> WindowsHandle;
}

#[cfg(windows)]
#[link(name = "user32")]
unsafe extern "system" {
    fn GetSystemMetrics(index: i32) -> i32;
    fn LoadImageW(
        instance: WindowsHandle,
        name: *const u16,
        image_type: u32,
        width: i32,
        height: i32,
        load_flags: u32,
    ) -> WindowsHandle;
    fn SendMessageW(hwnd: WindowsHandle, message: u32, wparam: usize, lparam: isize) -> isize;
    fn SendInput(input_count: u32, inputs: *mut WindowsInput, size: i32) -> u32;
    fn SetClassLongPtrW(hwnd: WindowsHandle, index: i32, value: isize) -> isize;
}

#[cfg(windows)]
fn windows_resource_id(resource_id: u16) -> *const u16 {
    resource_id as usize as *const u16
}

#[cfg(windows)]
fn windows_metric(index: i32, fallback: i32) -> i32 {
    let value = unsafe { GetSystemMetrics(index) };

    if value > 0 {
        value
    } else {
        fallback
    }
}

#[cfg(windows)]
fn load_windows_app_icon(width: i32, height: i32) -> Option<isize> {
    let module = unsafe { GetModuleHandleW(std::ptr::null()) };

    if module.is_null() {
        return None;
    }

    let icon = unsafe {
        LoadImageW(
            module,
            windows_resource_id(WINDOWS_APP_ICON_RESOURCE_ID),
            IMAGE_ICON,
            width,
            height,
            LR_DEFAULTCOLOR,
        )
    };

    if icon.is_null() {
        None
    } else {
        Some(icon as isize)
    }
}

#[cfg(windows)]
fn pin_windows_hang_icon(hwnd: WindowsHandle) {
    if hwnd.is_null() {
        return;
    }

    if let Some(icon) =
        load_windows_app_icon(windows_metric(SM_CXICON, 32), windows_metric(SM_CYICON, 32))
    {
        unsafe {
            SendMessageW(hwnd, WM_SETICON, ICON_BIG, icon);
            SetClassLongPtrW(hwnd, GCLP_HICON, icon);
        }
    }

    if let Some(icon) = load_windows_app_icon(
        windows_metric(SM_CXSMICON, 16),
        windows_metric(SM_CYSMICON, 16),
    ) {
        unsafe {
            SendMessageW(hwnd, WM_SETICON, ICON_SMALL, icon);
            SetClassLongPtrW(hwnd, GCLP_HICONSM, icon);
        }
    }
}

fn clean_workspace_name(name: String) -> Result<String, String> {
    let workspace_name = name
        .replace(|character: char| character.is_control(), "")
        .trim()
        .to_string();

    if workspace_name.is_empty() || workspace_name.len() > 80 {
        return Err("Workspace name must be between 1 and 80 characters.".to_string());
    }

    Ok(workspace_name)
}

fn clean_workspace_id(workspace_id: String) -> Result<String, String> {
    let workspace_id = workspace_id.trim().to_string();
    let is_uuid_like = workspace_id.len() == 36
        && workspace_id
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-');

    if is_uuid_like {
        Ok(workspace_id)
    } else {
        Err("Workspace id is invalid.".to_string())
    }
}

fn is_safe_terminal_pane_id(value: &str) -> bool {
    let value_length = value.len();

    value_length >= 3
        && value_length <= 96
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn validate_terminal_pane_id(value: &str) -> Result<(), String> {
    if is_safe_terminal_pane_id(value) {
        return Ok(());
    }

    Err("Terminal pane id is invalid.".to_string())
}

fn parse_agent_provider(provider: &str) -> Result<AgentProvider, String> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "codex" => Ok(AgentProvider::Codex),
        "claude" | "claude-code" | "claude_code" => Ok(AgentProvider::Claude),
        _ => Err("Unknown terminal provider.".to_string()),
    }
}

fn agent_definition(provider: AgentProvider) -> AgentDefinition {
    match provider {
        AgentProvider::Codex => AgentDefinition {
            id: "codex",
            label: "Codex",
            binary: "codex",
            install_package: "@openai/codex",
            install_command: "npm install -g @openai/codex",
            native_install_url: "https://github.com/openai/codex/releases/latest",
            native_install_label: "GitHub release binaries",
            connect_command: "codex login",
        },
        AgentProvider::Claude => AgentDefinition {
            id: "claude",
            label: "Claude Code",
            binary: "claude",
            install_package: "@anthropic-ai/claude-code",
            install_command: "npm install -g @anthropic-ai/claude-code",
            native_install_url: "https://code.claude.com/docs/en/quickstart",
            native_install_label: "Native install guide",
            connect_command: "claude",
        },
    }
}

#[cfg(windows)]
fn npm_binary() -> &'static str {
    "npm.cmd"
}

#[cfg(not(windows))]
fn npm_binary() -> &'static str {
    "npm"
}

fn command_output_text(stdout: &str, stderr: &str) -> String {
    let combined = format!("{}\n{}", stdout.trim(), stderr.trim());
    combined.trim().to_string()
}

fn first_output_line(output: &str) -> String {
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("")
        .to_string()
}

fn looks_like_permission_error(output: &str) -> bool {
    let output = output.to_ascii_lowercase();

    [
        "eacces",
        "eperm",
        "permission denied",
        "access is denied",
        "operation not permitted",
        "requires elevation",
        "administrator",
    ]
    .iter()
    .any(|needle| output.contains(needle))
}

fn failed_agent_install_result(
    definition: AgentDefinition,
    output: &str,
    fallback_message: &str,
    operation: &str,
) -> AgentInstallResult {
    let permission_denied = looks_like_permission_error(output);
    let first_line = first_output_line(output);
    let detail = if first_line.is_empty() {
        fallback_message.to_string()
    } else {
        first_line
    };

    AgentInstallResult {
        provider: definition.id,
        label: definition.label,
        installed: false,
        updated: false,
        permission_denied,
        command: definition.install_command,
        native_install_url: definition.native_install_url,
        message: if permission_denied {
            format!(
                "{} {operation} was blocked by npm permissions. Close running {} terminals, then retry from an elevated app or fix the npm global prefix.",
                definition.label, definition.label
            )
        } else {
            format!("{} {operation} failed: {detail}", definition.label)
        },
    }
}

fn npm_version() -> Option<String> {
    let capture = run_command_capture(
        npm_binary(),
        &["--version"],
        None,
        Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
        None,
    )
    .ok()?;

    if capture.exit_code != Some(0) {
        return None;
    }

    let version = first_output_line(&command_output_text(&capture.stdout, &capture.stderr));

    Some(if version.is_empty() {
        "Detected".to_string()
    } else {
        version
    })
}

fn npm_global_package_version(definition: AgentDefinition) -> Option<String> {
    let capture = run_command_capture(
        npm_binary(),
        &[
            "list",
            "-g",
            definition.install_package,
            "--depth=0",
            "--json",
        ],
        None,
        Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
        None,
    )
    .ok()?;

    if capture.exit_code != Some(0) {
        return None;
    }

    let value = serde_json::from_str::<Value>(&capture.stdout).ok()?;
    let version = value
        .get("dependencies")
        .and_then(|dependencies| dependencies.get(definition.install_package))
        .and_then(|package| package.get("version"))
        .and_then(Value::as_str)
        .unwrap_or("Detected")
        .to_string();

    Some(version)
}

fn npm_latest_package_version(definition: AgentDefinition) -> Option<String> {
    let capture = run_command_capture(
        npm_binary(),
        &["view", definition.install_package, "version", "--json"],
        None,
        Duration::from_secs(AGENT_UPDATE_CHECK_TIMEOUT_SECS),
        None,
    )
    .ok()?;

    if capture.exit_code != Some(0) {
        return None;
    }

    if let Ok(value) = serde_json::from_str::<Value>(&capture.stdout) {
        if let Some(version) = value.as_str() {
            let version = version.trim();

            if !version.is_empty() {
                return Some(version.to_string());
            }
        }
    }

    let version = first_output_line(&capture.stdout)
        .trim_matches('"')
        .trim()
        .to_string();

    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

fn version_number_segments(version: &str) -> Vec<u64> {
    version
        .trim()
        .trim_start_matches('v')
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .take(3)
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

fn is_npm_version_newer(latest_version: &str, current_version: &str) -> bool {
    let latest_segments = version_number_segments(latest_version);
    let current_segments = version_number_segments(current_version);

    if latest_segments.is_empty() || current_segments.is_empty() {
        return false;
    }

    let segment_count = latest_segments.len().max(current_segments.len());

    for index in 0..segment_count {
        let latest = *latest_segments.get(index).unwrap_or(&0);
        let current = *current_segments.get(index).unwrap_or(&0);

        if latest > current {
            return true;
        }

        if latest < current {
            return false;
        }
    }

    false
}

fn spawn_npm_package_version_check(
    definition: AgentDefinition,
) -> thread::JoinHandle<Option<String>> {
    thread::spawn(move || {
        let started_at = Instant::now();
        let package_version = npm_global_package_version(definition);

        log_terminal_event(
            "agent.status.npm_package_done",
            None,
            None,
            Some(started_at.elapsed()),
            json!({
                "detected": package_version.is_some(),
                "package": definition.install_package,
                "provider": definition.id,
            }),
        );

        package_version
    })
}

fn spawn_npm_latest_package_version_check(
    definition: AgentDefinition,
) -> thread::JoinHandle<Option<String>> {
    thread::spawn(move || {
        let started_at = Instant::now();
        let latest_version = npm_latest_package_version(definition);

        log_terminal_event(
            "agent.status.npm_latest_done",
            None,
            None,
            Some(started_at.elapsed()),
            json!({
                "detected": latest_version.is_some(),
                "package": definition.install_package,
                "provider": definition.id,
            }),
        );

        latest_version
    })
}

fn resolve_npm_package_version(
    package_version_handle: thread::JoinHandle<Option<String>>,
    latest_version_handle: thread::JoinHandle<Option<String>>,
) -> (bool, String, String, bool) {
    let package_version = package_version_handle.join().ok().flatten();
    let latest_version = latest_version_handle.join().ok().flatten();
    let npm_installed = package_version.is_some();
    let npm_update_available = package_version
        .as_deref()
        .zip(latest_version.as_deref())
        .map(|(current_version, latest_version)| {
            is_npm_version_newer(latest_version, current_version)
        })
        .unwrap_or(false);
    let npm_package_version =
        package_version.unwrap_or_else(|| "Not installed with npm".to_string());
    let npm_latest_version = latest_version.unwrap_or_else(|| "Not checked".to_string());

    (
        npm_installed,
        npm_package_version,
        npm_latest_version,
        npm_update_available,
    )
}

fn agent_auth_status_for(provider: AgentProvider, definition: AgentDefinition) -> (bool, String) {
    match provider {
        AgentProvider::Codex => {
            let status = run_agent_command_capture(
                definition,
                &["login", "status"],
                None,
                Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
                None,
            );

            match status {
                Ok(capture) if capture.exit_code == Some(0) => (
                    true,
                    first_output_line(&command_output_text(&capture.stdout, &capture.stderr)),
                ),
                Ok(capture) => {
                    let message =
                        first_output_line(&command_output_text(&capture.stdout, &capture.stderr));
                    (
                        false,
                        if message.is_empty() {
                            "Run codex login to connect.".to_string()
                        } else {
                            message
                        },
                    )
                }
                Err(error) => (false, error),
            }
        }
        AgentProvider::Claude => {
            if claude_credentials_detected() {
                (true, "Claude credentials detected locally.".to_string())
            } else {
                (
                    false,
                    "Run claude to complete the official Claude Code login.".to_string(),
                )
            }
        }
    }
}

fn npm_global_prefix() -> Option<PathBuf> {
    let capture = run_command_capture(
        npm_binary(),
        &["prefix", "-g"],
        None,
        Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
        None,
    )
    .ok()?;

    if capture.exit_code != Some(0) {
        return None;
    }

    let prefix = first_output_line(&command_output_text(&capture.stdout, &capture.stderr));

    if prefix.is_empty() {
        None
    } else {
        Some(PathBuf::from(prefix))
    }
}

fn npm_global_executable_path(definition: AgentDefinition) -> Option<PathBuf> {
    let prefix = npm_global_prefix()?;

    #[cfg(windows)]
    let candidates = [
        prefix.join(format!("{}.cmd", definition.binary)),
        prefix.join(format!("{}.exe", definition.binary)),
        prefix.join(definition.binary),
    ];

    #[cfg(not(windows))]
    let candidates = [prefix.join("bin").join(definition.binary)];

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn resolve_agent_command_candidates(definition: AgentDefinition) -> Vec<String> {
    let mut candidates = Vec::new();

    if let Some(path) = npm_global_executable_path(definition) {
        let path = path.to_string_lossy().to_string();

        candidates.push(path);
    }

    if !candidates
        .iter()
        .any(|candidate| candidate == definition.binary)
    {
        candidates.push(definition.binary.to_string());
    }

    candidates
}

fn agent_command_candidates(definition: AgentDefinition) -> Vec<String> {
    let cache = AGENT_COMMAND_CANDIDATE_CACHE.get_or_init(|| StdMutex::new(HashMap::new()));

    if let Ok(cache) = cache.lock() {
        if let Some(candidates) = cache.get(definition.id) {
            return candidates.clone();
        }
    }

    let candidates = resolve_agent_command_candidates(definition);

    if let Ok(mut cache) = cache.lock() {
        cache.insert(definition.id, candidates.clone());
    }

    candidates
}

fn clear_agent_command_candidate_cache(provider: AgentProvider) {
    let definition = agent_definition(provider);

    if let Some(cache) = AGENT_COMMAND_CANDIDATE_CACHE.get() {
        if let Ok(mut cache) = cache.lock() {
            cache.remove(definition.id);
        }
    }
}

#[cfg(windows)]
fn quote_powershell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(windows)]
fn terminal_idle_shell_command() -> CommandBuilder {
    let mut command = CommandBuilder::new("powershell.exe");
    command.arg("-NoLogo");
    command.arg("-NoExit");
    command.arg("-ExecutionPolicy");
    command.arg("Bypass");
    command
}

#[cfg(not(windows))]
fn quote_shell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(not(windows))]
fn terminal_idle_shell_command() -> CommandBuilder {
    CommandBuilder::new(env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()))
}

fn is_terminal_prewarm_kind(kind: &str) -> bool {
    matches!(
        kind.trim().to_ascii_lowercase().as_str(),
        "shell"
            | "prewarm"
            | "prewarm-shell"
            | "prewarm_shell"
            | "prewarm-pty"
            | "prewarm_pty"
            | "pty"
    )
}

#[cfg(windows)]
fn terminal_agent_start_input(command_path: &str, args: &[String]) -> String {
    let mut invocation = format!("& {}", quote_powershell_literal(command_path));

    for arg in args {
        invocation.push(' ');
        invocation.push_str(&quote_powershell_literal(arg));
    }

    format!("{invocation}\r")
}

#[cfg(windows)]
fn terminal_agent_start_input_in_directory(
    command_path: &str,
    args: &[String],
    working_directory: &Path,
) -> String {
    let directory = working_directory.to_string_lossy();

    format!(
        "Set-Location -LiteralPath {}; {}",
        quote_powershell_literal(&directory),
        terminal_agent_start_input(command_path, args)
    )
}

#[cfg(not(windows))]
fn terminal_agent_start_input(command_path: &str, args: &[String]) -> String {
    let mut invocation = quote_shell_literal(command_path);

    for arg in args {
        invocation.push(' ');
        invocation.push_str(&quote_shell_literal(arg));
    }

    format!("{invocation}\n")
}

#[cfg(not(windows))]
fn terminal_agent_start_input_in_directory(
    command_path: &str,
    args: &[String],
    working_directory: &Path,
) -> String {
    let directory = working_directory.to_string_lossy();

    format!(
        "cd {}; {}",
        quote_shell_literal(&directory),
        terminal_agent_start_input(command_path, args)
    )
}

fn default_terminal_working_directory() -> PathBuf {
    env::current_dir()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf).or(Some(path)))
        .unwrap_or_else(|| {
            env::var_os("USERPROFILE")
                .or_else(|| env::var_os("HOME"))
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
        })
}

fn create_warm_shell_pty(size: PtySize) -> Result<WarmPty, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(size)
        .map_err(|error| format!("Unable to open warm terminal PTY: {error}"))?;
    let mut command = terminal_idle_shell_command();
    let working_directory = workspace_path_for_process(&default_terminal_working_directory());

    command.cwd(&working_directory);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Unable to start warm terminal shell: {error}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Unable to read warm terminal output: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Unable to write warm terminal input: {error}"))?;

    Ok(WarmPty {
        child,
        master: pair.master,
        writer,
        reader,
        size,
    })
}

fn cleanup_warm_pty(warm_pty: WarmPty) {
    let WarmPty {
        mut child,
        master,
        writer,
        reader,
        ..
    } = warm_pty;

    drop(reader);
    drop(writer);
    drop(master);
    kill_terminal_process_tree(child.as_mut());
    let _ = poll_terminal_child_exit(child.as_mut());
}

fn run_agent_command_capture(
    definition: AgentDefinition,
    args: &[&str],
    stdin_text: Option<&str>,
    timeout: Duration,
    working_directory: Option<&Path>,
) -> Result<CommandCapture, String> {
    let mut last_error = format!(
        "{} is not installed or not available on PATH.",
        definition.label
    );

    for candidate in agent_command_candidates(definition) {
        match run_command_capture(&candidate, args, stdin_text, timeout, working_directory) {
            Ok(capture) => return Ok(capture),
            Err(error) => {
                last_error = error;
            }
        }
    }

    Err(last_error)
}

fn default_working_directory() -> Result<PathBuf, String> {
    let current_dir = env::current_dir()
        .map_err(|error| format!("Unable to read current working directory: {error}"))?;

    let working_directory = if current_dir
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == "src-tauri")
    {
        if let Some(parent) = current_dir.parent() {
            parent.to_path_buf()
        } else {
            current_dir
        }
    } else {
        current_dir
    };

    if is_windows_system_startup_directory(&working_directory) {
        if let Some(project_directory) = source_project_directory() {
            return Ok(project_directory);
        }

        if let Some(home_directory) = user_home_dir() {
            return Ok(home_directory);
        }
    }

    Ok(working_directory)
}

fn source_project_directory() -> Option<PathBuf> {
    let tauri_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = if tauri_root
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == "src-tauri")
    {
        tauri_root.parent().map(Path::to_path_buf)?
    } else {
        tauri_root
    };

    project_root
        .canonicalize()
        .ok()
        .filter(|directory| directory.is_dir())
}

#[cfg(windows)]
fn is_windows_drive_path_text(value: &str) -> bool {
    let bytes = value.as_bytes();

    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

#[cfg(windows)]
fn windows_non_verbatim_path_text(path_text: &str) -> String {
    if let Some(rest) = path_text.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }

    if let Some(rest) = path_text.strip_prefix(r"\\?\") {
        if is_windows_drive_path_text(rest) {
            return rest.to_string();
        }
    }

    if let Some(rest) = path_text.strip_prefix("//?/UNC/") {
        return format!("//{rest}");
    }

    if let Some(rest) = path_text.strip_prefix("//?/") {
        if is_windows_drive_path_text(rest) {
            return rest.to_string();
        }
    }

    path_text.to_string()
}

#[cfg(windows)]
fn workspace_path_for_process(path: &Path) -> PathBuf {
    PathBuf::from(windows_non_verbatim_path_text(
        path.to_string_lossy().as_ref(),
    ))
}

#[cfg(not(windows))]
fn workspace_path_for_process(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn workspace_path_display(path: &Path) -> String {
    #[cfg(windows)]
    {
        windows_non_verbatim_path_text(path.to_string_lossy().as_ref())
    }

    #[cfg(not(windows))]
    {
        path.display().to_string()
    }
}

fn normalized_path_key(path: &Path) -> String {
    workspace_path_display(path)
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn is_windows_system_startup_directory(directory: &Path) -> bool {
    #[cfg(windows)]
    {
        let directory_key = normalized_path_key(directory);
        let Some(system_root) = env::var_os("SystemRoot")
            .or_else(|| env::var_os("WINDIR"))
            .map(PathBuf::from)
        else {
            return false;
        };

        let system_root_key = normalized_path_key(&system_root);
        let system32_key = normalized_path_key(&system_root.join("System32"));
        let syswow64_key = normalized_path_key(&system_root.join("SysWOW64"));

        directory_key == system_root_key
            || directory_key == system32_key
            || directory_key == syswow64_key
            || directory_key.starts_with(&(system32_key + "/"))
            || directory_key.starts_with(&(syswow64_key + "/"))
    }

    #[cfg(not(windows))]
    {
        let _ = directory;
        false
    }
}

fn resolve_workspace_root_directory(value: Option<&str>) -> Result<PathBuf, String> {
    let Some(value) = value else {
        return default_working_directory();
    };
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return default_working_directory();
    }

    if trimmed.len() > MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH {
        return Err("Workspace root directory path is too long.".to_string());
    }

    if trimmed
        .bytes()
        .any(|byte| byte.is_ascii_control() || byte == b'\x7f')
    {
        return Err("Workspace root directory path is invalid.".to_string());
    }

    let directory = PathBuf::from(trimmed);
    let canonical = directory
        .canonicalize()
        .map_err(|error| format!("Unable to read workspace root directory: {error}"))?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("Unable to inspect workspace root directory: {error}"))?;

    if !metadata.is_dir() {
        return Err("Workspace root directory must be an existing directory.".to_string());
    }

    if is_windows_system_startup_directory(&canonical) {
        return Err("Workspace root directory cannot be a Windows system folder.".to_string());
    }

    Ok(canonical)
}

fn clean_workspace_relative_path(value: &str) -> Result<PathBuf, String> {
    if value
        .bytes()
        .any(|byte| byte.is_ascii_control() || byte == b'\x7f')
    {
        return Err("Workspace path is invalid.".to_string());
    }

    let mut relative_path = PathBuf::new();

    for component in Path::new(value.trim()).components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => relative_path.push(part),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Workspace path must stay inside the workspace directory.".to_string());
            }
        }
    }

    Ok(relative_path)
}

fn workspace_relative_display(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
}

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn resolve_workspace_child_path(
    root: &Path,
    relative_path: &str,
) -> Result<(PathBuf, String), String> {
    let cleaned_relative = clean_workspace_relative_path(relative_path)?;
    let requested_path = root.join(&cleaned_relative);
    let canonical = requested_path
        .canonicalize()
        .map_err(|error| format!("Unable to read workspace path: {error}"))?;

    if !canonical.starts_with(root) {
        return Err("Workspace path must stay inside the workspace directory.".to_string());
    }

    Ok((canonical, workspace_relative_display(&cleaned_relative)))
}

fn child_relative_path(root: &Path, child: &Path) -> Option<String> {
    child
        .strip_prefix(root)
        .ok()
        .map(workspace_relative_display)
}

fn normalize_git_status_path(path: &str) -> String {
    path.replace('\\', "/").trim_matches('/').to_string()
}

fn git_status_priority(status: &str) -> u8 {
    match status {
        "conflicted" => 60,
        "deleted" => 50,
        "modified" => 40,
        "renamed" => 30,
        "copied" => 30,
        "added" => 20,
        "untracked" => 20,
        _ => 0,
    }
}

fn git_status_from_code(code: &str) -> Option<&'static str> {
    let mut chars = code.chars();
    let index = chars.next().unwrap_or(' ');
    let working_tree = chars.next().unwrap_or(' ');

    if index == '?' && working_tree == '?' {
        return Some("untracked");
    }

    if index == 'U'
        || working_tree == 'U'
        || matches!((index, working_tree), ('A', 'A') | ('D', 'D'))
    {
        return Some("conflicted");
    }

    if index == 'D' || working_tree == 'D' {
        return Some("deleted");
    }

    if index == 'A' || working_tree == 'A' {
        return Some("added");
    }

    if index == 'M' || working_tree == 'M' || index == 'T' || working_tree == 'T' {
        return Some("modified");
    }

    if index == 'R' || working_tree == 'R' {
        return Some("renamed");
    }

    if index == 'C' || working_tree == 'C' {
        return Some("copied");
    }

    None
}

fn parse_git_status_output(output: &str) -> HashMap<String, String> {
    let parts = output.split('\0').collect::<Vec<_>>();
    let mut statuses: HashMap<String, String> = HashMap::new();
    let mut index = 0;

    while index < parts.len() {
        let entry = parts[index];

        if entry.is_empty() {
            index += 1;
            continue;
        }

        let Some(code) = entry.get(0..2) else {
            index += 1;
            continue;
        };
        let path = normalize_git_status_path(entry.get(3..).unwrap_or(""));

        if !path.is_empty() {
            if let Some(status) = git_status_from_code(code) {
                let should_replace = statuses
                    .get(&path)
                    .map(|current| git_status_priority(status) > git_status_priority(current))
                    .unwrap_or(true);

                if should_replace {
                    statuses.insert(path, status.to_string());
                }
            }
        }

        if code.starts_with('R') || code.starts_with('C') {
            index += 2;
        } else {
            index += 1;
        }
    }

    statuses
}

fn workspace_git_statuses(root: &Path) -> HashMap<String, String> {
    let capture = match run_command_capture(
        "git",
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        None,
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        Some(root),
    ) {
        Ok(capture) => capture,
        Err(_) => return HashMap::new(),
    };

    if capture.exit_code != Some(0) {
        return HashMap::new();
    }

    parse_git_status_output(&capture.stdout)
}

fn git_status_for_relative_path(
    statuses: &HashMap<String, String>,
    relative_path: &str,
    kind: &str,
) -> Option<String> {
    let normalized = normalize_git_status_path(relative_path);

    if normalized.is_empty() {
        return None;
    }

    if let Some(status) = statuses.get(&normalized) {
        return Some(status.clone());
    }

    if kind != "directory" {
        return None;
    }

    let prefix = format!("{normalized}/");
    let mut best_status: Option<&String> = None;

    for (path, status) in statuses {
        if !path.starts_with(&prefix) {
            continue;
        }

        let should_replace = best_status
            .map(|current| git_status_priority(status) > git_status_priority(current))
            .unwrap_or(true);

        if should_replace {
            best_status = Some(status);
        }
    }

    best_status.cloned()
}

fn directory_entry_from_path(
    root: &Path,
    path: PathBuf,
    metadata: fs::Metadata,
    git_statuses: &HashMap<String, String>,
) -> Option<WorkspaceDirectoryEntry> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let kind = if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() {
        "file"
    } else {
        return None;
    };
    let relative_path = child_relative_path(root, &path)?;

    Some(WorkspaceDirectoryEntry {
        name,
        git_status: git_status_for_relative_path(git_statuses, &relative_path, kind),
        relative_path,
        kind: kind.to_string(),
        size: metadata.is_file().then_some(metadata.len()),
        modified_ms: modified_ms(&metadata),
    })
}

fn list_workspace_directory_for(
    root: String,
    relative_path: String,
) -> Result<WorkspaceDirectoryListing, String> {
    let workspace_root = resolve_workspace_root_directory(Some(&root))?;
    let (directory, normalized_relative_path) =
        resolve_workspace_child_path(&workspace_root, &relative_path)?;
    let metadata = fs::metadata(&directory)
        .map_err(|error| format!("Unable to inspect workspace folder: {error}"))?;

    if !metadata.is_dir() {
        return Err("Workspace path is not a folder.".to_string());
    }

    let mut entries = Vec::new();
    let mut truncated = false;
    let git_statuses = workspace_git_statuses(&workspace_root);
    let read_dir = fs::read_dir(&directory)
        .map_err(|error| format!("Unable to list workspace folder: {error}"))?;

    for entry in read_dir {
        if entries.len() >= MAX_FILE_EXPLORER_ENTRIES {
            truncated = true;
            break;
        }

        let Ok(entry) = entry else {
            continue;
        };
        let Ok(path) = entry.path().canonicalize() else {
            continue;
        };

        if !path.starts_with(&workspace_root) {
            continue;
        }

        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };

        if let Some(entry) =
            directory_entry_from_path(&workspace_root, path, metadata, &git_statuses)
        {
            entries.push(entry);
        }
    }

    entries.sort_by(|left, right| {
        let left_dir = left.kind == "directory";
        let right_dir = right.kind == "directory";

        right_dir
            .cmp(&left_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(WorkspaceDirectoryListing {
        root: workspace_path_display(&workspace_root),
        relative_path: normalized_relative_path,
        entries,
        truncated,
    })
}

fn read_workspace_file_for(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileText, String> {
    let workspace_root = resolve_workspace_root_directory(Some(&root))?;
    let (file_path, normalized_relative_path) =
        resolve_workspace_child_path(&workspace_root, &relative_path)?;
    let metadata = fs::metadata(&file_path)
        .map_err(|error| format!("Unable to inspect workspace file: {error}"))?;

    if !metadata.is_file() {
        return Err("Workspace path is not a file.".to_string());
    }

    if metadata.len() > MAX_WORKSPACE_FILE_READ_BYTES {
        return Err("Workspace file is too large to preview.".to_string());
    }

    let bytes =
        fs::read(&file_path).map_err(|error| format!("Unable to read workspace file: {error}"))?;
    let content = String::from_utf8(bytes)
        .map_err(|_| "Workspace file is not valid UTF-8 text.".to_string())?;

    Ok(WorkspaceFileText {
        root: workspace_path_display(&workspace_root),
        git_status: git_status_for_relative_path(
            &workspace_git_statuses(&workspace_root),
            &normalized_relative_path,
            "file",
        ),
        relative_path: normalized_relative_path,
        name: file_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string()),
        content,
        size: metadata.len(),
        modified_ms: modified_ms(&metadata),
    })
}

fn truncate_workspace_diff(diff: String) -> (String, bool) {
    if diff.len() <= MAX_WORKSPACE_FILE_DIFF_BYTES {
        return (diff, false);
    }

    let mut boundary = MAX_WORKSPACE_FILE_DIFF_BYTES;

    while boundary > 0 && !diff.is_char_boundary(boundary) {
        boundary -= 1;
    }

    let mut truncated = diff;
    truncated.truncate(boundary);
    truncated.push_str("\n... diff truncated ...\n");

    (truncated, true)
}

fn workspace_file_git_diff(root: &Path, relative_path: &str, cached: bool) -> String {
    let mut args = vec![
        "-c",
        "core.quotepath=false",
        "diff",
        "--no-ext-diff",
        "--unified=5",
    ];

    if cached {
        args.push("--cached");
    }

    args.push("--");
    args.push(relative_path);

    let capture = match run_command_capture(
        "git",
        &args,
        None,
        Duration::from_secs(GIT_DIFF_TIMEOUT_SECS),
        Some(root),
    ) {
        Ok(capture) => capture,
        Err(_) => return String::new(),
    };

    if capture.exit_code != Some(0) {
        return String::new();
    }

    capture.stdout
}

fn read_workspace_file_diff_for(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileDiff, String> {
    let workspace_root = resolve_workspace_root_directory(Some(&root))?;
    let (file_path, normalized_relative_path) =
        resolve_workspace_child_path(&workspace_root, &relative_path)?;
    let metadata = fs::metadata(&file_path)
        .map_err(|error| format!("Unable to inspect workspace file: {error}"))?;

    if !metadata.is_file() {
        return Err("Workspace path is not a file.".to_string());
    }

    let git_statuses = workspace_git_statuses(&workspace_root);
    let git_status = git_status_for_relative_path(&git_statuses, &normalized_relative_path, "file");

    if git_status.as_deref() != Some("modified") {
        return Ok(WorkspaceFileDiff {
            root: workspace_path_display(&workspace_root),
            relative_path: normalized_relative_path,
            diff: String::new(),
            truncated: false,
        });
    }

    let working_diff = workspace_file_git_diff(&workspace_root, &normalized_relative_path, false);
    let staged_diff = workspace_file_git_diff(&workspace_root, &normalized_relative_path, true);
    let diff = [working_diff, staged_diff]
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let (diff, truncated) = truncate_workspace_diff(diff);

    Ok(WorkspaceFileDiff {
        root: workspace_path_display(&workspace_root),
        relative_path: normalized_relative_path,
        diff,
        truncated,
    })
}

fn user_home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

fn claude_credentials_detected() -> bool {
    let env_has_credentials = [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
    ]
    .iter()
    .any(|key| env::var_os(key).is_some_and(|value| !value.is_empty()));

    if env_has_credentials {
        return true;
    }

    let config_dir = env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| user_home_dir().map(|home| home.join(".claude")));

    config_dir
        .map(|dir| dir.join(".credentials.json").exists())
        .unwrap_or(false)
}

fn run_command_capture(
    binary: &str,
    args: &[&str],
    stdin_text: Option<&str>,
    timeout: Duration,
    working_directory: Option<&Path>,
) -> Result<CommandCapture, String> {
    let mut command = Command::new(binary);
    command.args(args);

    if let Some(directory) = working_directory {
        command.current_dir(workspace_path_for_process(directory));
    }

    if stdin_text.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }

    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                format!("{binary} is not installed or not available on PATH.")
            } else {
                format!("Unable to start {binary}: {error}")
            }
        })?;

    if let Some(input) = stdin_text {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(input.as_bytes())
                .map_err(|error| format!("Unable to send prompt to {binary}: {error}"))?;
        }
    }

    let started_at = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|error| format!("Unable to read {binary} output: {error}"))?;

                return Ok(CommandCapture {
                    exit_code: output.status.code(),
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                });
            }
            Ok(None) => {
                if started_at.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("{binary} timed out."));
                }

                thread::sleep(Duration::from_millis(80));
            }
            Err(error) => {
                let _ = child.kill();
                return Err(format!("Unable to wait for {binary}: {error}"));
            }
        }
    }
}

fn agent_runtime_status_for(provider: AgentProvider) -> AgentRuntimeStatus {
    let started_at = Instant::now();
    let definition = agent_definition(provider);

    log_terminal_event(
        "agent.status.start",
        None,
        None,
        None,
        json!({
            "provider": definition.id,
        }),
    );

    let auth_check = thread::spawn(move || {
        let auth_started_at = Instant::now();
        let auth_status = agent_auth_status_for(provider, definition);
        log_terminal_event(
            "agent.status.auth_done",
            None,
            None,
            Some(auth_started_at.elapsed()),
            json!({
                "authenticated": auth_status.0,
                "provider": definition.id,
            }),
        );
        auth_status
    });

    let version_started_at = Instant::now();
    let version_result = match provider {
        AgentProvider::Codex => run_agent_command_capture(
            definition,
            &["--version"],
            None,
            Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
            None,
        ),
        AgentProvider::Claude => run_agent_command_capture(
            definition,
            &["--version"],
            None,
            Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
            None,
        ),
    };
    log_terminal_event(
        "agent.status.version_done",
        None,
        None,
        Some(version_started_at.elapsed()),
        json!({
            "provider": definition.id,
            "success": version_result.is_ok(),
        }),
    );

    let Ok(version_capture) = version_result else {
        let _ = auth_check.join();
        let status = AgentRuntimeStatus {
            installed: false,
            authenticated: false,
            version: "Not installed".to_string(),
            auth_message: format!("Install {} and recheck.", definition.label),
            recommend_native_install: true,
        };
        log_terminal_event(
            "agent.status.runtime_done",
            None,
            None,
            Some(started_at.elapsed()),
            json!({
                "authenticated": status.authenticated,
                "installed": status.installed,
                "provider": definition.id,
            }),
        );

        return status;
    };

    let version = first_output_line(&command_output_text(
        &version_capture.stdout,
        &version_capture.stderr,
    ));

    let (authenticated, auth_message) = auth_check.join().unwrap_or_else(|_| {
        (
            false,
            format!("Unable to check {} login.", definition.label),
        )
    });

    let status = AgentRuntimeStatus {
        installed: true,
        authenticated,
        version: if version.is_empty() {
            "Installed".to_string()
        } else {
            version
        },
        auth_message,
        recommend_native_install: true,
    };
    log_terminal_event(
        "agent.status.runtime_done",
        None,
        None,
        Some(started_at.elapsed()),
        json!({
            "authenticated": status.authenticated,
            "installed": status.installed,
            "provider": definition.id,
        }),
    );

    status
}

fn build_agent_status(
    provider: AgentProvider,
    runtime_status: AgentRuntimeStatus,
    npm_available: bool,
    npm_version: &str,
    npm_installed: bool,
    npm_package_version: String,
    npm_latest_version: String,
    npm_update_available: bool,
) -> AgentStatus {
    let definition = agent_definition(provider);

    AgentStatus {
        id: definition.id,
        label: definition.label,
        binary: definition.binary,
        installed: runtime_status.installed,
        authenticated: runtime_status.authenticated,
        version: runtime_status.version,
        auth_message: runtime_status.auth_message,
        install_command: definition.install_command,
        native_install_url: definition.native_install_url,
        native_install_label: definition.native_install_label,
        npm_available,
        npm_version: npm_version.to_string(),
        npm_installed,
        npm_package_version,
        npm_latest_version,
        npm_update_available,
        recommend_native_install: runtime_status.recommend_native_install,
        connect_command: definition.connect_command,
    }
}

fn install_agent_with_npm(provider: AgentProvider) -> AgentInstallResult {
    run_agent_npm_install(provider, false)
}

fn update_agent_with_npm(provider: AgentProvider) -> AgentInstallResult {
    run_agent_npm_install(provider, true)
}

fn run_agent_npm_install(provider: AgentProvider, is_update: bool) -> AgentInstallResult {
    let definition = agent_definition(provider);

    if npm_version().is_none() {
        return AgentInstallResult {
            provider: definition.id,
            label: definition.label,
            installed: false,
            updated: false,
            permission_denied: false,
            command: definition.install_command,
            native_install_url: definition.native_install_url,
            message: format!(
                "npm was not found on PATH. Use the {} instead.",
                definition.native_install_label
            ),
        };
    }

    let install = run_command_capture(
        npm_binary(),
        &["install", "-g", definition.install_package],
        None,
        Duration::from_secs(AGENT_INSTALL_TIMEOUT_SECS),
        None,
    );

    match install {
        Ok(capture) if capture.exit_code == Some(0) => AgentInstallResult {
            provider: definition.id,
            label: definition.label,
            installed: true,
            updated: is_update,
            permission_denied: false,
            command: definition.install_command,
            native_install_url: definition.native_install_url,
            message: if is_update {
                format!("{} npm package is up to date.", definition.label)
            } else {
                format!(
                    "{} installed with npm. Recheck status, then connect your account.",
                    definition.label
                )
            },
        },
        Ok(capture) => failed_agent_install_result(
            definition,
            &command_output_text(&capture.stdout, &capture.stderr),
            "npm install returned a non-zero status.",
            if is_update { "update" } else { "install" },
        ),
        Err(error) => failed_agent_install_result(
            definition,
            &error,
            "Unable to run npm install.",
            if is_update { "update" } else { "install" },
        ),
    }
}

fn launch_login_terminal(provider: AgentProvider) -> Result<(), String> {
    let definition = agent_definition(provider);
    let binary = npm_global_executable_path(definition)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| definition.binary.to_string());

    match provider {
        AgentProvider::Codex => run_login_terminal(definition.label, &binary, &["login"]),
        AgentProvider::Claude => run_login_terminal(definition.label, &binary, &[]),
    }
}

fn logout_agent_credentials(provider: AgentProvider) -> Result<AgentLogoutResult, String> {
    let definition = agent_definition(provider);
    let args = match provider {
        AgentProvider::Codex => vec!["logout"],
        AgentProvider::Claude => vec!["auth", "logout"],
    };
    let capture = run_agent_command_capture(
        definition,
        &args,
        None,
        Duration::from_secs(AGENT_LOGOUT_TIMEOUT_SECS),
        None,
    )?;
    let output = command_output_text(&capture.stdout, &capture.stderr);

    if capture.exit_code != Some(0) {
        let detail = first_output_line(&output);

        return Err(if detail.is_empty() {
            format!(
                "{} logout returned a non-zero exit status.",
                definition.label
            )
        } else {
            detail
        });
    }

    Ok(AgentLogoutResult {
        provider: definition.id,
        label: definition.label,
        disconnected: true,
        message: if output.is_empty() {
            format!(
                "{} credentials were removed from this machine.",
                definition.label
            )
        } else {
            first_output_line(&output)
        },
    })
}

#[cfg(windows)]
fn run_login_terminal(title: &str, binary: &str, args: &[&str]) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NEW_CONSOLE: u32 = 0x00000010;

    let mut command = Command::new("cmd");
    command
        .arg("/K")
        .arg(binary)
        .args(args)
        .creation_flags(CREATE_NEW_CONSOLE);

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Unable to open {title} login terminal: {error}"))
}

#[cfg(any(target_os = "macos", all(unix, not(target_os = "macos"))))]
fn quote_shell_arg(value: &str) -> String {
    if value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"-_./:@%+=,".contains(&byte))
    {
        return value.to_string();
    }

    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "macos")]
fn run_login_terminal(title: &str, binary: &str, args: &[&str]) -> Result<(), String> {
    let shell_command = std::iter::once(binary)
        .chain(args.iter().copied())
        .map(quote_shell_arg)
        .collect::<Vec<_>>()
        .join(" ");
    let escaped = shell_command.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!("tell application \"Terminal\" to do script \"{escaped}\"");

    Command::new("osascript")
        .args(["-e", &script])
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Unable to open {title} login terminal: {error}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn run_login_terminal(title: &str, binary: &str, args: &[&str]) -> Result<(), String> {
    let command_line = std::iter::once(binary)
        .chain(args.iter().copied())
        .map(quote_shell_arg)
        .collect::<Vec<_>>()
        .join(" ");

    let terminal_attempts = [
        ("x-terminal-emulator", vec!["-e", binary]),
        ("gnome-terminal", vec!["--", binary]),
        ("kgx", vec!["--", binary]),
        ("konsole", vec!["-e", binary]),
        ("xfce4-terminal", vec!["--command", command_line.as_str()]),
        ("mate-terminal", vec!["--command", command_line.as_str()]),
        ("kitty", vec![binary]),
        ("alacritty", vec!["-e", binary]),
    ];

    for (terminal, prefix_args) in terminal_attempts {
        let mut command = Command::new(terminal);

        if matches!(terminal, "xfce4-terminal" | "mate-terminal") {
            command.args(prefix_args);
        } else {
            command.args(prefix_args).args(args);
        }

        if command.spawn().is_ok() {
            return Ok(());
        }
    }

    Err(format!(
        "Unable to open a terminal for {title}. Run {} manually.",
        binary
    ))
}

fn normalize_forge_model(model: Option<String>) -> Result<Option<String>, String> {
    let Some(model) = model else {
        return Ok(None);
    };

    let model = model.trim();

    if model.is_empty() {
        return Ok(None);
    }

    if model.len() > MAX_FORGE_MODEL_LENGTH
        || !model.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':' | b'/')
        })
    {
        return Err("Model id is invalid.".to_string());
    }

    Ok(Some(model.to_string()))
}

fn image_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

fn sanitized_image_stem(name: &str, fallback_index: usize) -> String {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let cleaned = stem
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(40)
        .collect::<String>();

    if cleaned.is_empty() {
        format!("image-{}", fallback_index + 1)
    } else {
        cleaned
    }
}

fn decode_prompt_image(
    image: &ForgePromptImage,
    index: usize,
) -> Result<(String, Vec<u8>), String> {
    let mime_type = image.mime_type.trim().to_ascii_lowercase();
    let extension = image_extension(&mime_type)
        .ok_or_else(|| "Images must be PNG, JPEG, WebP, or GIF.".to_string())?;
    let expected_prefix = format!("data:{mime_type};base64,");

    if !image.data_url.starts_with(&expected_prefix) {
        return Err("Image data did not match its MIME type.".to_string());
    }

    let encoded = &image.data_url[expected_prefix.len()..];
    let decoded = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Image attachment could not be decoded.".to_string())?;

    if decoded.is_empty() || decoded.len() > MAX_FORGE_IMAGE_BYTES {
        return Err("Images must be 4 MB or smaller.".to_string());
    }

    let file_name = format!("{}.{}", sanitized_image_stem(&image.name, index), extension);

    Ok((file_name, decoded))
}

fn prepare_prompt_images(
    provider: AgentProvider,
    images: Vec<ForgePromptImage>,
) -> Result<Option<PreparedPromptImages>, String> {
    if images.is_empty() {
        return Ok(None);
    }

    if !matches!(provider, AgentProvider::Codex) {
        return Err("Image attachments are only supported for Codex local runs.".to_string());
    }

    if images.len() > MAX_FORGE_IMAGES {
        return Err(format!(
            "Attach up to {MAX_FORGE_IMAGES} images per prompt."
        ));
    }

    let mut decoded_images = Vec::with_capacity(images.len());
    let mut total_bytes = 0usize;

    for (index, image) in images.iter().enumerate() {
        let decoded = decode_prompt_image(image, index)?;
        total_bytes += decoded.1.len();

        if total_bytes > MAX_FORGE_IMAGE_TOTAL_BYTES {
            return Err("Images must be 8 MB total or smaller.".to_string());
        }

        decoded_images.push(decoded);
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Unable to prepare image attachment directory: {error}"))?
        .as_millis();
    let directory = env::temp_dir()
        .join("diffforge-forge-images")
        .join(format!("{}-{timestamp}", std::process::id()));

    fs::create_dir_all(&directory)
        .map_err(|error| format!("Unable to prepare image attachment directory: {error}"))?;

    let mut paths = Vec::with_capacity(decoded_images.len());

    for (file_name, bytes) in decoded_images {
        let path = directory.join(file_name);
        if let Err(error) = fs::write(&path, bytes) {
            let _ = fs::remove_dir_all(&directory);
            return Err(format!("Unable to write image attachment: {error}"));
        }
        paths.push(path.to_string_lossy().to_string());
    }

    Ok(Some(PreparedPromptImages { directory, paths }))
}

fn run_forge_prompt_for(request: ForgePromptRequest) -> Result<ForgeRunResult, String> {
    let provider = parse_agent_provider(&request.provider)?;
    let definition = agent_definition(provider);
    let prompt = request.prompt.trim();
    let model = normalize_forge_model(request.model)?;

    if prompt.is_empty() {
        return Err("Write a prompt before running Forge Console.".to_string());
    }

    if prompt.len() > MAX_FORGE_PROMPT_LENGTH {
        return Err("Forge prompt is too long for this local console run.".to_string());
    }

    let working_directory = resolve_workspace_root_directory(request.working_directory.as_deref())?;
    let prepared_images = prepare_prompt_images(provider, request.images.unwrap_or_default())?;
    let mut codex_output_path: Option<PathBuf> = None;

    let capture_result = match provider {
        AgentProvider::Codex => {
            let output_directory = env::temp_dir().join("diffforge-codex-output");
            let output_path = output_directory.join(format!(
                "{}-{}.txt",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|error| format!("Unable to prepare Codex output file: {error}"))?
                    .as_millis()
            ));

            fs::create_dir_all(&output_directory)
                .map_err(|error| format!("Unable to prepare Codex output directory: {error}"))?;
            codex_output_path = Some(output_path.clone());

            let mut args = vec![
                "--ask-for-approval".to_string(),
                "never".to_string(),
                "exec".to_string(),
                "--skip-git-repo-check".to_string(),
                "--sandbox".to_string(),
                "read-only".to_string(),
                "--color".to_string(),
                "never".to_string(),
            ];

            if let Some(model) = &model {
                args.push("--model".to_string());
                args.push(model.clone());
            }

            args.push("--output-last-message".to_string());
            args.push(output_path.to_string_lossy().to_string());

            if let Some(images) = &prepared_images {
                for path in &images.paths {
                    args.push("--image".to_string());
                    args.push(path.clone());
                }
            }

            args.push("-".to_string());
            let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();

            run_agent_command_capture(
                definition,
                &arg_refs,
                Some(prompt),
                Duration::from_secs(AGENT_RUN_TIMEOUT_SECS),
                Some(&working_directory),
            )
        }
        AgentProvider::Claude => {
            let mut args = Vec::new();

            if let Some(model) = &model {
                args.push("--model".to_string());
                args.push(model.clone());
            }

            args.push("-p".to_string());
            args.push(prompt.to_string());
            let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();

            run_agent_command_capture(
                definition,
                &arg_refs,
                None,
                Duration::from_secs(AGENT_RUN_TIMEOUT_SECS),
                Some(&working_directory),
            )
        }
    };

    if let Some(images) = &prepared_images {
        let _ = fs::remove_dir_all(&images.directory);
    }

    let capture = match capture_result {
        Ok(capture) => capture,
        Err(error) => {
            if let Some(path) = &codex_output_path {
                let _ = fs::remove_file(path);
            }

            return Err(error);
        }
    };
    let output_from_file = codex_output_path
        .as_ref()
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_default()
        .trim()
        .to_string();
    if let Some(path) = &codex_output_path {
        let _ = fs::remove_file(path);
    }

    let output = if output_from_file.is_empty() {
        capture.stdout.trim().to_string()
    } else {
        output_from_file
    };
    let stderr = capture.stderr.trim().to_string();

    if capture.exit_code != Some(0) {
        let message = first_output_line(&command_output_text(&output, &stderr));
        return Err(if message.is_empty() {
            format!("{} returned a non-zero exit status.", definition.label)
        } else {
            message
        });
    }

    Ok(ForgeRunResult {
        provider: definition.id,
        label: definition.label,
        model: model.unwrap_or_default(),
        output: if output.is_empty() {
            "(No output returned.)".to_string()
        } else {
            output
        },
        stderr,
        working_directory: workspace_path_display(&working_directory),
    })
}

fn terminal_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn terminal_telemetry_log_path() -> PathBuf {
    let tauri_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = tauri_root
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(tauri_root);

    project_root
        .join(TERMINAL_TELEMETRY_LOG_DIR)
        .join(TERMINAL_TELEMETRY_LOG_FILE)
}

fn clean_terminal_telemetry_text(value: &str) -> String {
    value
        .replace(|character: char| character.is_control(), " ")
        .trim()
        .chars()
        .take(TERMINAL_TELEMETRY_MAX_TEXT)
        .collect()
}

fn write_terminal_telemetry_entries(entries: Vec<Value>) {
    if entries.is_empty() {
        return;
    }

    let log_path = terminal_telemetry_log_path();
    let Some(log_dir) = log_path.parent() else {
        return;
    };

    if fs::create_dir_all(log_dir).is_err() {
        return;
    }

    let lock = TERMINAL_TELEMETRY_LOCK.get_or_init(|| StdMutex::new(()));
    let Ok(_guard) = lock.lock() else {
        return;
    };

    let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    else {
        return;
    };

    for entry in entries {
        let _ = writeln!(file, "{entry}");
    }
}

fn write_terminal_telemetry(entry: Value) {
    write_terminal_telemetry_entries(vec![entry]);
}

fn log_terminal_event(
    phase: &str,
    pane_id: Option<&str>,
    instance_id: Option<u64>,
    elapsed: Option<Duration>,
    fields: Value,
) {
    write_terminal_telemetry(json!({
        "ts_ms": terminal_now_ms(),
        "phase": clean_terminal_telemetry_text(phase),
        "pane_id": pane_id.map(clean_terminal_telemetry_text),
        "instance_id": instance_id,
        "elapsed_ms": elapsed.map(|duration| duration.as_secs_f64() * 1000.0),
        "fields": fields,
    }));
}

fn validate_terminal_size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(TERMINAL_MIN_COLS..=TERMINAL_MAX_COLS).contains(&cols) {
        return Err(format!(
            "Terminal columns must be between {TERMINAL_MIN_COLS} and {TERMINAL_MAX_COLS}."
        ));
    }

    if !(TERMINAL_MIN_ROWS..=TERMINAL_MAX_ROWS).contains(&rows) {
        return Err(format!(
            "Terminal rows must be between {TERMINAL_MIN_ROWS} and {TERMINAL_MAX_ROWS}."
        ));
    }

    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn terminal_size_from_request(cols: Option<u16>, rows: Option<u16>) -> Result<PtySize, String> {
    validate_terminal_size(
        cols.unwrap_or(TERMINAL_DEFAULT_COLS),
        rows.unwrap_or(TERMINAL_DEFAULT_ROWS),
    )
}

fn terminal_launch(
    kind: &str,
    provider: Option<String>,
    model: Option<String>,
) -> Result<(Vec<String>, Vec<String>, String), String> {
    let provider = match kind {
        "console" => provider
            .as_deref()
            .map(parse_agent_provider)
            .transpose()?
            .unwrap_or(AgentProvider::Codex),
        "codex" => AgentProvider::Codex,
        "claude" => AgentProvider::Claude,
        _ => {
            if let Some(provider) = provider {
                parse_agent_provider(&provider)?
            } else {
                return Err("Terminal kind is invalid.".to_string());
            }
        }
    };
    let definition = agent_definition(provider);
    let mut args = Vec::new();

    if let Some(model) = normalize_forge_model(model)? {
        args.push("--model".to_string());
        args.push(model);
    }

    Ok((
        agent_command_candidates(definition),
        args,
        definition.label.to_string(),
    ))
}

fn remove_terminal_instance_if_current(
    terminals: &Arc<RwLock<HashMap<String, TerminalInstance>>>,
    pane_id: &str,
    instance_id: u64,
) -> Option<TerminalInstance> {
    let mut terminals = terminals.blocking_write();
    let is_current = terminals
        .get(pane_id)
        .map(|instance| instance.id == instance_id)
        .unwrap_or(false);

    if is_current {
        terminals.remove(pane_id)
    } else {
        None
    }
}

async fn get_terminal_instance(
    state: &TerminalState,
    pane_id: &str,
) -> Result<TerminalInstance, String> {
    let terminals = state.terminals.read().await;

    terminals
        .get(pane_id)
        .cloned()
        .ok_or_else(|| "Terminal session is not running.".to_string())
}

async fn get_terminal_instance_if_current(
    state: &TerminalState,
    pane_id: &str,
    instance_id: Option<u64>,
) -> Result<Option<TerminalInstance>, String> {
    let terminals = state.terminals.read().await;
    let Some(instance) = terminals.get(pane_id).cloned() else {
        return if instance_id.is_some() {
            Ok(None)
        } else {
            Err("Terminal session is not running.".to_string())
        };
    };

    if instance_id.is_some_and(|expected_id| expected_id != instance.id) {
        return Ok(None);
    }

    Ok(Some(instance))
}

fn poll_terminal_child_exit(child: &mut dyn Child) -> bool {
    for _ in 0..TERMINAL_SHUTDOWN_POLL_ATTEMPTS {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => thread::sleep(Duration::from_millis(TERMINAL_SHUTDOWN_POLL_INTERVAL_MS)),
            Err(_) => return true,
        }
    }

    false
}

#[cfg(windows)]
fn kill_terminal_process_tree(child: &mut dyn Child) {
    if let Some(pid) = child.process_id() {
        let _ = Command::new("taskkill")
            .arg("/PID")
            .arg(pid.to_string())
            .arg("/T")
            .arg("/F")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    let _ = child.kill();
}

#[cfg(not(windows))]
fn kill_terminal_process_tree(child: &mut dyn Child) {
    let _ = child.kill();
}

fn cleanup_terminal_instance(instance: TerminalInstance, kill_first: bool) {
    let TerminalInstance {
        child,
        master,
        writer,
        size,
        working_directory,
        agent_started,
        ..
    } = instance;

    drop(writer);
    drop(master);
    drop(size);
    drop(working_directory);
    drop(agent_started);

    let mut child = child.blocking_lock();
    let Some(mut child) = child.take() else {
        return;
    };

    if kill_first {
        kill_terminal_process_tree(child.as_mut());
    } else if !poll_terminal_child_exit(child.as_mut()) {
        kill_terminal_process_tree(child.as_mut());
    }

    if !poll_terminal_child_exit(child.as_mut()) {
        let _ = child.kill();
        let _ = poll_terminal_child_exit(child.as_mut());
    }
}

fn cleanup_terminal_instance_async(instance: TerminalInstance, kill_first: bool) {
    thread::spawn(move || {
        cleanup_terminal_instance(instance, kill_first);
    });
}

fn emit_terminal_close_all_progress(
    app: &AppHandle,
    closed: usize,
    total: usize,
    pane_id: Option<String>,
    instance_id: Option<u64>,
) {
    let _ = app.emit(
        TERMINAL_CLOSE_ALL_PROGRESS_EVENT,
        TerminalCloseAllProgressPayload {
            closed,
            total,
            pane_id,
            instance_id,
        },
    );
}

fn spawn_terminal_reader(
    app: AppHandle,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    pane_id: String,
    instance_id: u64,
    output_channel: Channel<InvokeResponseBody>,
    mut reader: Box<dyn Read + Send>,
) {
    let (output_tx, mut output_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let reader_pane_id = pane_id.clone();

    thread::spawn(move || {
        log_terminal_event(
            "terminal.reader.thread_start",
            Some(&reader_pane_id),
            Some(instance_id),
            None,
            json!({}),
        );

        let mut buffer = [0u8; TERMINAL_OUTPUT_READ_BUFFER_BYTES];
        let mut saw_first_output = false;

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(bytes_read) => {
                    if !saw_first_output {
                        saw_first_output = true;
                        log_terminal_event(
                            "terminal.reader.first_output",
                            Some(&reader_pane_id),
                            Some(instance_id),
                            None,
                            json!({ "bytes": bytes_read }),
                        );
                    }

                    if output_tx.send(buffer[..bytes_read].to_vec()).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    log_terminal_event(
                        "terminal.reader.error",
                        Some(&reader_pane_id),
                        Some(instance_id),
                        None,
                        json!({ "error": clean_terminal_telemetry_text(&error.to_string()) }),
                    );
                    break;
                }
            }
        }

        log_terminal_event(
            "terminal.reader.closed",
            Some(&reader_pane_id),
            Some(instance_id),
            None,
            json!({ "saw_first_output": saw_first_output }),
        );
    });

    tauri::async_runtime::spawn(async move {
        let mut ticker = interval(Duration::from_micros(TERMINAL_OUTPUT_FRAME_MICROS));
        ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut pending = Vec::with_capacity(TERMINAL_OUTPUT_READ_BUFFER_BYTES * 2);
        let mut reader_closed = false;
        let mut flushed_chunks = 0usize;
        let mut flushed_bytes = 0usize;
        let mut channel_failed = false;

        loop {
            tokio::select! {
                maybe_chunk = output_rx.recv(), if !reader_closed => {
                    match maybe_chunk {
                        Some(chunk) => pending.extend_from_slice(&chunk),
                        None => reader_closed = true,
                    }
                }
                _ = ticker.tick() => {
                    while let Ok(chunk) = output_rx.try_recv() {
                        pending.extend_from_slice(&chunk);
                    }

                    if !pending.is_empty() {
                        let bytes = pending.len();
                        let chunk = std::mem::take(&mut pending);

                        if output_channel.send(InvokeResponseBody::Raw(chunk)).is_err() {
                            channel_failed = true;
                            break;
                        }

                        flushed_chunks += 1;
                        flushed_bytes += bytes;
                    }

                    if reader_closed {
                        break;
                    }
                }
            }
        }

        if !channel_failed && !pending.is_empty() {
            let bytes = pending.len();

            if output_channel
                .send(InvokeResponseBody::Raw(std::mem::take(&mut pending)))
                .is_ok()
            {
                flushed_chunks += 1;
                flushed_bytes += bytes;
            }
        }

        log_terminal_event(
            "terminal.reader.frame_flush_closed",
            Some(&pane_id),
            Some(instance_id),
            None,
            json!({
                "channel_failed": channel_failed,
                "flushed_bytes": flushed_bytes,
                "flushed_chunks": flushed_chunks,
                "frame_micros": TERMINAL_OUTPUT_FRAME_MICROS,
            }),
        );

        if let Some(instance) =
            remove_terminal_instance_if_current(&terminals, &pane_id, instance_id)
        {
            cleanup_terminal_instance_async(instance, false);
        }

        let _ = app.emit(
            "forge-terminal-exit",
            TerminalExitPayload {
                pane_id,
                instance_id,
                exit_code: None,
                exited_at_ms: terminal_now_ms(),
            },
        );
    });
}

async fn close_terminal_session(
    state: &TerminalState,
    pane_id: &str,
    instance_id: Option<u64>,
) -> Result<bool, String> {
    validate_terminal_pane_id(pane_id)?;

    let instance = {
        let mut terminals = state.terminals.write().await;

        if let Some(expected_id) = instance_id {
            let is_current = terminals
                .get(pane_id)
                .map(|instance| instance.id == expected_id)
                .unwrap_or(false);

            if !is_current {
                return Ok(false);
            }
        }

        terminals.remove(pane_id)
    };

    if let Some(instance) = instance {
        cleanup_terminal_instance_async(instance, true);
        return Ok(true);
    }

    Ok(false)
}

async fn close_all_terminal_sessions(
    app: AppHandle,
    state: &TerminalState,
) -> Result<usize, String> {
    let close_started_at = Instant::now();
    let instances = {
        let mut terminals = state.terminals.write().await;
        terminals
            .drain()
            .collect::<Vec<(String, TerminalInstance)>>()
    };
    let closed = instances.len();
    let total = closed;

    emit_terminal_close_all_progress(&app, 0, total, None, None);

    log_terminal_event(
        "terminal.close_all.start",
        None,
        None,
        None,
        json!({ "active_count": closed }),
    );

    if instances.is_empty() {
        log_terminal_event(
            "terminal.close_all.done",
            None,
            None,
            Some(close_started_at.elapsed()),
            json!({ "closed": 0 }),
        );
        return Ok(0);
    }

    thread::spawn(move || {
        let cleanup_started_at = Instant::now();
        let closed_count = Arc::new(AtomicUsize::new(0));
        let handles = instances
            .into_iter()
            .map(|(pane_id, instance)| {
                let app = app.clone();
                let closed_count = Arc::clone(&closed_count);
                thread::spawn(move || {
                    let instance_id = instance.id;

                    cleanup_terminal_instance(instance, true);
                    let closed = closed_count.fetch_add(1, Ordering::Relaxed) + 1;
                    log_terminal_event(
                        "terminal.close_all.cleanup_done",
                        Some(&pane_id),
                        Some(instance_id),
                        None,
                        json!({}),
                    );
                    emit_terminal_close_all_progress(
                        &app,
                        closed,
                        total,
                        Some(pane_id),
                        Some(instance_id),
                    );
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            let _ = handle.join();
        }

        log_terminal_event(
            "terminal.close_all.cleanup_finished",
            None,
            None,
            Some(cleanup_started_at.elapsed()),
            json!({ "closed": closed_count.load(Ordering::Relaxed), "total": total }),
        );
    });

    log_terminal_event(
        "terminal.close_all.done",
        None,
        None,
        Some(close_started_at.elapsed()),
        json!({ "closed": closed, "cleanup_detached": true }),
    );

    Ok(closed)
}

fn choose_terminal_command_path(command_candidates: &[String]) -> Option<String> {
    command_candidates
        .iter()
        .find(|candidate| Path::new(candidate.as_str()).exists())
        .or_else(|| command_candidates.first())
        .cloned()
}

fn prepare_warm_pty_for_handoff(
    pool: &Arc<PtyPool>,
    size: PtySize,
) -> Result<(WarmPty, bool), String> {
    let mut warm_pty = if let Some(warm_pty) = pool.take_warm() {
        (warm_pty, true)
    } else {
        (create_warm_shell_pty(size)?, false)
    };

    if warm_pty.0.size != size {
        warm_pty
            .0
            .master
            .resize(size)
            .map_err(|error| format!("Unable to resize warm terminal: {error}"))?;
        warm_pty.0.size = size;
    }

    Ok(warm_pty)
}

fn write_agent_start_input_to_writer(
    writer: &mut dyn Write,
    input: &str,
    context: &str,
) -> Result<(), String> {
    writer
        .write_all(input.as_bytes())
        .map_err(|error| format!("Unable to write {context}: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("Unable to flush {context}: {error}"))
}

#[tauri::command]
async fn terminal_open(
    app: AppHandle,
    state: State<'_, TerminalState>,
    request: TerminalOpenRequest,
    output_channel: Channel<InvokeResponseBody>,
) -> Result<TerminalOpenResult, String> {
    validate_terminal_pane_id(&request.pane_id)?;
    let pane_id = request.pane_id;
    let open_started_at = Instant::now();
    let requested_cols = request.cols;
    let requested_rows = request.rows;
    let kind = request.kind;
    let provider = request.provider;
    let model = request.model;
    let working_directory_request = request.working_directory;

    log_terminal_event(
        "terminal.open.start",
        Some(&pane_id),
        request.instance_id,
        None,
        json!({
            "kind": clean_terminal_telemetry_text(&kind),
            "provider": provider.as_deref().map(clean_terminal_telemetry_text),
            "cols": requested_cols,
            "rows": requested_rows,
            "has_working_directory": working_directory_request
                .as_deref()
                .map(|directory| !directory.trim().is_empty())
                .unwrap_or(false),
        }),
    );

    let close_started_at = Instant::now();
    let closed_existing = close_terminal_session(&state, &pane_id, None)
        .await
        .unwrap_or(false);
    log_terminal_event(
        "terminal.open.close_existing",
        Some(&pane_id),
        request.instance_id,
        Some(close_started_at.elapsed()),
        json!({ "closed_existing": closed_existing }),
    );

    let resolve_started_at = Instant::now();
    let working_directory = resolve_workspace_root_directory(working_directory_request.as_deref())?;
    log_terminal_event(
        "terminal.open.resolve_working_directory",
        Some(&pane_id),
        request.instance_id,
        Some(resolve_started_at.elapsed()),
        json!({ "working_directory": workspace_path_display(&working_directory) }),
    );
    let process_working_directory = workspace_path_for_process(&working_directory);

    let command_started_at = Instant::now();
    let is_prewarm_pty = is_terminal_prewarm_kind(&kind);
    let (command_candidates, args, label) = if is_prewarm_pty {
        (Vec::new(), Vec::new(), "Prepared PTY".to_string())
    } else {
        terminal_launch(&kind, provider, model)?
    };
    log_terminal_event(
        "terminal.open.resolve_command",
        Some(&pane_id),
        request.instance_id,
        Some(command_started_at.elapsed()),
        json!({
            "label": label,
            "candidate_count": command_candidates.len(),
            "arg_count": args.len(),
            "prewarm_pty": is_prewarm_pty,
        }),
    );

    let size_started_at = Instant::now();
    let size = terminal_size_from_request(requested_cols, requested_rows)?;
    let instance_id = request.instance_id.filter(|id| *id > 0).unwrap_or_else(|| {
        state
            .next_terminal_instance_id
            .fetch_add(1, Ordering::Relaxed)
    });
    log_terminal_event(
        "terminal.open.size",
        Some(&pane_id),
        Some(instance_id),
        Some(size_started_at.elapsed()),
        json!({ "cols": size.cols, "rows": size.rows }),
    );

    let handoff_started_at = Instant::now();
    let (mut warm_pty, from_pool) = match prepare_warm_pty_for_handoff(&state.pty_pool, size) {
        Ok(result) => result,
        Err(error) => {
            log_terminal_event(
                "terminal.open.pool_handoff_error",
                Some(&pane_id),
                Some(instance_id),
                Some(handoff_started_at.elapsed()),
                json!({ "error": clean_terminal_telemetry_text(&error) }),
            );
            state.pty_pool.ensure_warm_async();
            return Err(error);
        }
    };

    log_terminal_event(
        "terminal.open.pool_handoff",
        Some(&pane_id),
        Some(instance_id),
        Some(handoff_started_at.elapsed()),
        json!({
            "from_pool": from_pool,
            "prewarm_pty": is_prewarm_pty,
            "warm_remaining": state.pty_pool.warm_count(),
        }),
    );
    state.pty_pool.ensure_warm_async();

    let mut command = "prepared-shell".to_string();
    let mut agent_started = false;

    if !is_prewarm_pty {
        let Some(command_path) = choose_terminal_command_path(&command_candidates) else {
            let error = format!("{label} is not installed or not available on PATH.");
            cleanup_warm_pty(warm_pty);
            log_terminal_event(
                "terminal.open.error",
                Some(&pane_id),
                Some(instance_id),
                Some(open_started_at.elapsed()),
                json!({ "error": clean_terminal_telemetry_text(&error) }),
            );
            return Err(error);
        };
        let input = terminal_agent_start_input_in_directory(
            &command_path,
            &args,
            &process_working_directory,
        );

        if input.len() > MAX_TERMINAL_WRITE_BYTES {
            cleanup_warm_pty(warm_pty);
            return Err("Terminal launch input is too large.".to_string());
        }

        let write_started_at = Instant::now();
        if let Err(error) = write_agent_start_input_to_writer(
            warm_pty.writer.as_mut(),
            &input,
            "terminal agent launch",
        ) {
            cleanup_warm_pty(warm_pty);
            return Err(error);
        }
        log_terminal_event(
            "terminal.open.agent_start_write",
            Some(&pane_id),
            Some(instance_id),
            Some(write_started_at.elapsed()),
            json!({
                "arg_count": args.len(),
                "bytes": input.len(),
                "command": clean_terminal_telemetry_text(&command_path),
                "from_pool": from_pool,
            }),
        );

        command = command_path;
        agent_started = true;
    }

    let (instance, reader) = TerminalInstance::from_warm_shell(
        instance_id,
        warm_pty,
        process_working_directory.clone(),
        agent_started,
    );

    let insert_started_at = Instant::now();
    state
        .terminals
        .write()
        .await
        .insert(pane_id.clone(), instance);
    log_terminal_event(
        "terminal.open.insert_instance",
        Some(&pane_id),
        Some(instance_id),
        Some(insert_started_at.elapsed()),
        json!({
            "from_pool": from_pool,
            "prewarm_pty": is_prewarm_pty,
            "agent_started": agent_started,
        }),
    );

    spawn_terminal_reader(
        app.clone(),
        Arc::clone(&state.terminals),
        pane_id.clone(),
        instance_id,
        output_channel,
        reader,
    );
    log_terminal_event(
        if is_prewarm_pty {
            "terminal.open.prewarm_ready"
        } else {
            "terminal.open.success"
        },
        Some(&pane_id),
        Some(instance_id),
        Some(open_started_at.elapsed()),
        json!({
            "command": clean_terminal_telemetry_text(&command),
            "from_pool": from_pool,
            "working_directory": workspace_path_display(&working_directory),
        }),
    );

    Ok(TerminalOpenResult {
        pane_id,
        instance_id,
        command,
        working_directory: workspace_path_display(&working_directory),
    })
}

fn terminal_telemetry_entry(request: TerminalTelemetryLogRequest) -> Option<Value> {
    if request.phase.trim().is_empty() {
        return None;
    }

    Some(json!({
        "ts_ms": request.ts_ms.unwrap_or_else(terminal_now_ms),
        "phase": clean_terminal_telemetry_text(&request.phase),
        "pane_id": request.pane_id.as_deref().map(clean_terminal_telemetry_text),
        "instance_id": request.instance_id,
        "message": request.message.as_deref().map(clean_terminal_telemetry_text),
        "cols": request.cols,
        "rows": request.rows,
        "elapsed_ms": request.elapsed_ms,
        "fields": request.fields.unwrap_or_else(|| json!({})),
    }))
}

#[tauri::command]
fn terminal_telemetry_log(request: TerminalTelemetryLogRequest) -> Result<(), String> {
    if let Some(entry) = terminal_telemetry_entry(request) {
        write_terminal_telemetry(entry);
    }

    Ok(())
}

#[tauri::command]
fn terminal_telemetry_log_many(requests: Vec<TerminalTelemetryLogRequest>) -> Result<(), String> {
    let entries = requests
        .into_iter()
        .filter_map(terminal_telemetry_entry)
        .collect::<Vec<_>>();

    write_terminal_telemetry_entries(entries);

    Ok(())
}

#[tauri::command]
async fn terminal_start_agent(
    state: State<'_, TerminalState>,
    pane_id: String,
    instance_id: Option<u64>,
    provider: String,
    model: Option<String>,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
    let provider = parse_agent_provider(&provider)?;
    let definition = agent_definition(provider);
    let mut args = Vec::new();

    if let Some(model) = normalize_forge_model(model)? {
        args.push("--model".to_string());
        args.push(model);
    }

    let command_candidates = agent_command_candidates(definition);
    let command_path = command_candidates
        .iter()
        .find(|candidate| Path::new(candidate.as_str()).exists())
        .or_else(|| {
            command_candidates
                .iter()
                .find(|candidate| candidate.as_str() == definition.binary)
        })
        .or_else(|| command_candidates.first())
        .cloned()
        .ok_or_else(|| {
            format!(
                "{} is not installed or not available on PATH.",
                definition.label
            )
        })?;

    let Some(instance) = get_terminal_instance_if_current(&state, &pane_id, instance_id).await?
    else {
        log_terminal_event(
            "terminal.agent_start.skipped_stale_or_missing",
            Some(&pane_id),
            instance_id,
            None,
            json!({ "provider": definition.id }),
        );
        return Err("Terminal session is not running.".to_string());
    };
    let input = terminal_agent_start_input_in_directory(
        &command_path,
        &args,
        instance.working_directory.as_ref(),
    );

    if input.len() > MAX_TERMINAL_WRITE_BYTES {
        return Err("Terminal launch input is too large.".to_string());
    }

    let write_started_at = Instant::now();
    let mut agent_started = instance.agent_started.lock().await;

    if *agent_started {
        log_terminal_event(
            "terminal.agent_start.skipped_already_started",
            Some(&pane_id),
            Some(instance.id),
            Some(write_started_at.elapsed()),
            json!({ "provider": definition.id }),
        );
        return Ok(());
    }

    let mut writer = instance.writer.lock().await;

    write_agent_start_input_to_writer(writer.as_mut(), &input, "terminal agent launch")?;
    *agent_started = true;
    log_terminal_event(
        "terminal.agent_start.write",
        Some(&pane_id),
        Some(instance.id),
        Some(write_started_at.elapsed()),
        json!({
            "provider": definition.id,
            "command": clean_terminal_telemetry_text(&command_path),
            "arg_count": args.len(),
            "bytes": input.len(),
            "working_directory": workspace_path_display(instance.working_directory.as_ref()),
        }),
    );

    Ok(())
}

async fn start_terminal_agent_in_prepared_pty(
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    request: TerminalStartAgentRequest,
) -> TerminalStartAgentPaneResult {
    let pane_id = request.pane_id;
    let instance_id = request.instance_id;
    let start_started_at = Instant::now();

    if let Err(error) = validate_terminal_pane_id(&pane_id) {
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id,
            started: false,
            skipped: true,
            message: error,
        };
    }

    let provider = match parse_agent_provider(&request.provider) {
        Ok(provider) => provider,
        Err(error) => {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id,
                started: false,
                skipped: true,
                message: error,
            };
        }
    };
    let definition = agent_definition(provider);
    let mut args = Vec::new();

    match normalize_forge_model(request.model) {
        Ok(Some(model)) => {
            args.push("--model".to_string());
            args.push(model);
        }
        Ok(None) => {}
        Err(error) => {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id,
                started: false,
                skipped: true,
                message: error,
            };
        }
    }

    let Some(instance) = ({
        let terminals = terminals.read().await;
        terminals.get(&pane_id).cloned()
    }) else {
        log_terminal_event(
            "terminal.agent_start_many.skipped_missing",
            Some(&pane_id),
            instance_id,
            Some(start_started_at.elapsed()),
            json!({ "provider": definition.id }),
        );
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id,
            started: false,
            skipped: true,
            message: "Terminal session is not running.".to_string(),
        };
    };

    if instance_id.is_some_and(|expected_id| expected_id != instance.id) {
        log_terminal_event(
            "terminal.agent_start_many.skipped_stale",
            Some(&pane_id),
            instance_id,
            Some(start_started_at.elapsed()),
            json!({
                "current_instance_id": instance.id,
                "provider": definition.id,
            }),
        );
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id,
            started: false,
            skipped: true,
            message: "Terminal session was replaced before agent start.".to_string(),
        };
    }

    let mut agent_started_guard = instance.agent_started.lock().await;

    if *agent_started_guard {
        log_terminal_event(
            "terminal.agent_start_many.skipped_already_started",
            Some(&pane_id),
            Some(instance.id),
            Some(start_started_at.elapsed()),
            json!({ "provider": definition.id }),
        );
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id: Some(instance.id),
            started: false,
            skipped: true,
            message: "Terminal agent has already been started.".to_string(),
        };
    }

    let child_guard = instance.child.lock().await;

    if child_guard.is_some() {
        let command_candidates = agent_command_candidates(definition);
        let Some(command_path) = choose_terminal_command_path(&command_candidates) else {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id: Some(instance.id),
                started: false,
                skipped: false,
                message: format!(
                    "{} is not installed or not available on PATH.",
                    definition.label
                ),
            };
        };
        let input = terminal_agent_start_input_in_directory(
            &command_path,
            &args,
            instance.working_directory.as_ref(),
        );

        if input.len() > MAX_TERMINAL_WRITE_BYTES {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id: Some(instance.id),
                started: false,
                skipped: false,
                message: "Terminal launch input is too large.".to_string(),
            };
        }

        drop(child_guard);
        let write_started_at = Instant::now();
        let mut writer = instance.writer.lock().await;

        match write_agent_start_input_to_writer(writer.as_mut(), &input, "terminal agent launch") {
            Ok(()) => {
                *agent_started_guard = true;
                log_terminal_event(
                    "terminal.agent_start_many.write_done",
                    Some(&pane_id),
                    Some(instance.id),
                    Some(write_started_at.elapsed()),
                    json!({
                        "provider": definition.id,
                        "command": clean_terminal_telemetry_text(&command_path),
                        "arg_count": args.len(),
                        "bytes": input.len(),
                        "working_directory": workspace_path_display(instance.working_directory.as_ref()),
                    }),
                );
                return TerminalStartAgentPaneResult {
                    pane_id,
                    instance_id: Some(instance.id),
                    started: true,
                    skipped: false,
                    message: "Agent started.".to_string(),
                };
            }
            Err(error) => {
                log_terminal_event(
                    "terminal.agent_start_many.write_error",
                    Some(&pane_id),
                    Some(instance.id),
                    Some(write_started_at.elapsed()),
                    json!({
                        "provider": definition.id,
                        "command": clean_terminal_telemetry_text(&command_path),
                        "error": clean_terminal_telemetry_text(&error),
                    }),
                );
                return TerminalStartAgentPaneResult {
                    pane_id,
                    instance_id: Some(instance.id),
                    started: false,
                    skipped: false,
                    message: error,
                };
            }
        }
    }

    log_terminal_event(
        "terminal.agent_start_many.skipped_not_warm_shell",
        Some(&pane_id),
        Some(instance.id),
        Some(start_started_at.elapsed()),
        json!({ "provider": definition.id }),
    );
    TerminalStartAgentPaneResult {
        pane_id,
        instance_id: Some(instance.id),
        started: false,
        skipped: true,
        message: "Terminal shell is not available for deferred agent launch.".to_string(),
    }
}

#[tauri::command]
async fn terminal_start_agent_many(
    state: State<'_, TerminalState>,
    requests: Vec<TerminalStartAgentRequest>,
) -> Result<TerminalStartAgentManyResult, String> {
    if requests.len() > MAX_TERMINAL_START_AGENT_BATCH {
        return Err(format!(
            "Cannot start more than {MAX_TERMINAL_START_AGENT_BATCH} terminal agents at once."
        ));
    }

    let batch_started_at = Instant::now();
    log_terminal_event(
        "terminal.agent_start_many.start",
        None,
        None,
        None,
        json!({ "request_count": requests.len() }),
    );

    let mut join_set = tokio::task::JoinSet::new();

    for request in requests {
        let terminals = Arc::clone(&state.terminals);

        join_set
            .spawn(async move { start_terminal_agent_in_prepared_pty(terminals, request).await });
    }

    let mut results = Vec::new();

    while let Some(result) = join_set.join_next().await {
        match result {
            Ok(result) => results.push(result),
            Err(error) => results.push(TerminalStartAgentPaneResult {
                pane_id: String::new(),
                instance_id: None,
                started: false,
                skipped: false,
                message: format!("Unable to join terminal agent start task: {error}"),
            }),
        }
    }

    let started = results.iter().filter(|result| result.started).count();
    let skipped = results.iter().filter(|result| result.skipped).count();

    log_terminal_event(
        "terminal.agent_start_many.done",
        None,
        None,
        Some(batch_started_at.elapsed()),
        json!({
            "request_count": results.len(),
            "started": started,
            "skipped": skipped,
        }),
    );

    Ok(TerminalStartAgentManyResult {
        started,
        skipped,
        results,
    })
}

#[tauri::command]
async fn terminal_write(
    state: State<'_, TerminalState>,
    pane_id: String,
    instance_id: Option<u64>,
    data: String,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;

    if data.is_empty() {
        return Ok(());
    }

    if data.len() > MAX_TERMINAL_WRITE_BYTES {
        return Err("Terminal input chunk is too large.".to_string());
    }

    let Some(instance) = get_terminal_instance_if_current(&state, &pane_id, instance_id).await?
    else {
        log_terminal_event(
            "terminal.write.skipped_stale_or_missing",
            Some(&pane_id),
            instance_id,
            None,
            json!({ "bytes": data.len() }),
        );
        return Ok(());
    };
    let mut writer = instance.writer.lock().await;

    writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("Unable to write terminal input: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("Unable to flush terminal input: {error}"))
}

async fn resize_terminal_instance(
    instance: &TerminalInstance,
    size: PtySize,
) -> Result<bool, String> {
    let mut current_size = instance.size.lock().await;

    if *current_size == size {
        return Ok(false);
    }

    let master = instance.master.lock().await;

    master
        .resize(size)
        .map_err(|error| format!("Unable to resize terminal: {error}"))?;
    *current_size = size;

    Ok(true)
}

async fn resolve_terminal_for_resize(
    state: &TerminalState,
    pane_id: Option<String>,
    instance_id: Option<u64>,
) -> Result<Option<(String, TerminalInstance)>, String> {
    if let Some(pane_id) = pane_id.filter(|value| !value.trim().is_empty()) {
        validate_terminal_pane_id(&pane_id)?;
        return get_terminal_instance_if_current(state, &pane_id, instance_id)
            .await
            .map(|instance| instance.map(|instance| (pane_id, instance)));
    }

    let terminals = state.terminals.read().await;

    if terminals.is_empty() {
        return Err("Terminal session is not running.".to_string());
    }

    if terminals.len() > 1 {
        return Err(
            "Terminal pane id is required when multiple terminal sessions are running.".to_string(),
        );
    }

    let Some((resolved_pane_id, instance)) = terminals
        .iter()
        .next()
        .map(|(resolved_pane_id, instance)| (resolved_pane_id.clone(), instance.clone()))
    else {
        return Err("Terminal session is not running.".to_string());
    };

    if instance_id.is_some_and(|expected_id| expected_id != instance.id) {
        return Ok(None);
    }

    Ok(Some((resolved_pane_id, instance)))
}

#[tauri::command]
async fn resize_terminal(
    state: State<'_, TerminalState>,
    pane_id: Option<String>,
    instance_id: Option<u64>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let resize_started_at = Instant::now();
    log_terminal_event(
        "terminal.resize_terminal.start",
        pane_id.as_deref(),
        instance_id,
        None,
        json!({ "cols": cols, "rows": rows }),
    );

    let size = validate_terminal_size(cols, rows)?;
    let Some((resolved_pane_id, instance)) =
        resolve_terminal_for_resize(&state, pane_id.clone(), instance_id).await?
    else {
        log_terminal_event(
            "terminal.resize_terminal.skipped_stale",
            pane_id.as_deref(),
            instance_id,
            Some(resize_started_at.elapsed()),
            json!({ "cols": cols, "rows": rows }),
        );
        return Ok(());
    };

    let applied = resize_terminal_instance(&instance, size).await?;
    log_terminal_event(
        "terminal.resize_terminal.done",
        Some(&resolved_pane_id),
        Some(instance.id),
        Some(resize_started_at.elapsed()),
        json!({ "cols": cols, "rows": rows, "applied": applied }),
    );

    Ok(())
}

#[tauri::command]
async fn terminal_resize(
    state: State<'_, TerminalState>,
    pane_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let resize_started_at = Instant::now();
    log_terminal_event(
        "terminal.resize.start",
        Some(&pane_id),
        None,
        None,
        json!({ "cols": cols, "rows": rows }),
    );
    validate_terminal_pane_id(&pane_id)?;

    let size = validate_terminal_size(cols, rows)?;
    let instance = get_terminal_instance(&state, &pane_id).await?;
    let applied = resize_terminal_instance(&instance, size).await?;
    log_terminal_event(
        "terminal.resize.done",
        Some(&pane_id),
        Some(instance.id),
        Some(resize_started_at.elapsed()),
        json!({ "cols": cols, "rows": rows, "applied": applied }),
    );

    Ok(())
}

#[tauri::command]
async fn terminal_close(
    state: State<'_, TerminalState>,
    pane_id: String,
    instance_id: Option<u64>,
) -> Result<(), String> {
    let close_started_at = Instant::now();
    log_terminal_event(
        "terminal.close.start",
        Some(&pane_id),
        instance_id,
        None,
        json!({}),
    );

    match close_terminal_session(&state, &pane_id, instance_id).await {
        Ok(closed) => {
            log_terminal_event(
                "terminal.close.done",
                Some(&pane_id),
                instance_id,
                Some(close_started_at.elapsed()),
                json!({ "closed": closed }),
            );
        }
        Err(error) => {
            log_terminal_event(
                "terminal.close.error",
                Some(&pane_id),
                instance_id,
                Some(close_started_at.elapsed()),
                json!({ "error": error }),
            );
            return Err(error);
        }
    }

    Ok(())
}

#[tauri::command]
async fn terminal_close_all(
    app: AppHandle,
    state: State<'_, TerminalState>,
) -> Result<TerminalCloseAllResult, String> {
    let closed = close_all_terminal_sessions(app, &state).await?;

    Ok(TerminalCloseAllResult { closed })
}

fn http_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("Diff Forge AI Desktop/0.1.0")
        .build()
        .map_err(|error| format!("Unable to prepare backend request: {error}"))
}

fn non_json_api_response_message(
    status: reqwest::StatusCode,
    fallback_message: &str,
    parse_error: serde_json::Error,
) -> String {
    if status.is_success() {
        return format!("Diff Forge AI API returned invalid JSON: {parse_error}");
    }

    format!("{fallback_message} Diff Forge AI API returned {status} with a non-JSON response.")
}

async fn read_api_response(
    response: reqwest::Response,
    fallback_message: &str,
) -> Result<Value, String> {
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Unable to read Diff Forge AI API response: {error}"))?;
    let response_body = if response_text.trim().is_empty() {
        json!({})
    } else {
        match serde_json::from_str::<Value>(&response_text) {
            Ok(body) => body,
            Err(error) => {
                return Err(non_json_api_response_message(
                    status,
                    fallback_message,
                    error,
                ));
            }
        }
    };

    if status.is_success() {
        return Ok(response_body);
    }

    let api_error = response_body
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or(fallback_message);

    Err(api_error.to_string())
}

#[tauri::command]
async fn backend_ping() -> Result<BackendStatus, String> {
    let endpoint = format!("{API_BASE_URL}/hello");
    let client = http_client(Duration::from_secs(DEFAULT_API_TIMEOUT_SECS))?;

    let response = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|error| format!("Unable to reach Diff Forge AI API: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Diff Forge AI API returned {}", response.status()));
    }

    let _body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Diff Forge AI API returned invalid JSON: {error}"))?;

    Ok(BackendStatus {
        ok: true,
        endpoint,
        message: "Diff Forge API online".to_string(),
    })
}

#[tauri::command]
async fn exchange_desktop_auth_code(code: String, state: String) -> Result<Value, String> {
    validate_auth_value("Desktop auth code", &code)?;
    validate_auth_value("Desktop auth state", &state)?;

    let client = http_client(Duration::from_secs(AUTH_EXCHANGE_TIMEOUT_SECS))?;
    let response = client
        .post(format!("{API_BASE_URL}/desktop/sessions/exchange"))
        .json(&ExchangeDesktopSessionRequest {
            code: &code,
            state: &state,
        })
        .send()
        .await
        .map_err(|error| format!("Unable to exchange desktop login: {error}"))?;

    read_api_response(response, "Desktop login expired. Try again.").await
}

#[tauri::command]
async fn validate_desktop_session(token: String) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;

    let client = http_client(Duration::from_secs(SESSION_VALIDATE_TIMEOUT_SECS))?;
    let response = client
        .get(format!("{API_BASE_URL}/desktop/session"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Unable to validate desktop session: {error}"))?;

    read_api_response(response, "Desktop session expired.").await
}

#[tauri::command]
async fn logout_desktop_session(token: String) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;

    let client = http_client(Duration::from_secs(LOGOUT_TIMEOUT_SECS))?;
    let response = client
        .delete(format!("{API_BASE_URL}/desktop/session"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Unable to sign out desktop session: {error}"))?;

    read_api_response(response, "Unable to sign out desktop session.").await
}

#[tauri::command]
async fn list_workspaces(token: String) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;

    let client = http_client(Duration::from_secs(DEFAULT_API_TIMEOUT_SECS))?;
    let response = client
        .get(format!("{API_BASE_URL}/desktop/workspaces"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Unable to fetch workspaces: {error}"))?;

    read_api_response(response, "Unable to fetch workspaces.").await
}

#[tauri::command]
async fn create_workspace(token: String, name: String) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;

    let workspace_name = clean_workspace_name(name)?;

    let client = http_client(Duration::from_secs(DEFAULT_API_TIMEOUT_SECS))?;
    let response = client
        .post(format!("{API_BASE_URL}/desktop/workspaces"))
        .bearer_auth(token)
        .json(&CreateWorkspaceRequest {
            name: &workspace_name,
        })
        .send()
        .await
        .map_err(|error| format!("Unable to create workspace: {error}"))?;

    read_api_response(response, "Unable to create workspace.").await
}

#[tauri::command]
async fn update_workspace(
    token: String,
    workspace_id: String,
    name: String,
) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;

    let workspace_id = clean_workspace_id(workspace_id)?;
    let workspace_name = clean_workspace_name(name)?;

    let client = http_client(Duration::from_secs(DEFAULT_API_TIMEOUT_SECS))?;
    let response = client
        .patch(format!("{API_BASE_URL}/desktop/workspaces"))
        .bearer_auth(token)
        .json(&UpdateWorkspaceRequest {
            workspace_id: &workspace_id,
            name: &workspace_name,
        })
        .send()
        .await
        .map_err(|error| format!("Unable to update workspace: {error}"))?;

    read_api_response(response, "Unable to update workspace.").await
}

#[tauri::command]
async fn agent_statuses() -> Result<Vec<AgentStatus>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let started_at = Instant::now();
        log_terminal_event("agent.statuses.start", None, None, None, json!({}));

        let npm_version_handle = thread::spawn(|| {
            let npm_started_at = Instant::now();
            let version = npm_version();
            log_terminal_event(
                "agent.statuses.npm_version_done",
                None,
                None,
                Some(npm_started_at.elapsed()),
                json!({
                    "npmAvailable": version.is_some(),
                }),
            );
            version
        });
        let codex_package_version =
            spawn_npm_package_version_check(agent_definition(AgentProvider::Codex));
        let claude_package_version =
            spawn_npm_package_version_check(agent_definition(AgentProvider::Claude));
        let codex_latest_version =
            spawn_npm_latest_package_version_check(agent_definition(AgentProvider::Codex));
        let claude_latest_version =
            spawn_npm_latest_package_version_check(agent_definition(AgentProvider::Claude));
        let codex_runtime = thread::spawn(|| agent_runtime_status_for(AgentProvider::Codex));
        let claude_runtime = thread::spawn(|| agent_runtime_status_for(AgentProvider::Claude));

        let codex_runtime = codex_runtime
            .join()
            .map_err(|_| "Codex status check failed.".to_string())?;
        let claude_runtime = claude_runtime
            .join()
            .map_err(|_| "Claude Code status check failed.".to_string())?;
        let npm_version = npm_version_handle.join().ok().flatten();
        let npm_available = npm_version.is_some();
        let npm_version = npm_version.unwrap_or_else(|| "Not detected".to_string());
        let (
            codex_npm_installed,
            codex_npm_package_version,
            codex_npm_latest_version,
            codex_npm_update_available,
        ) = resolve_npm_package_version(codex_package_version, codex_latest_version);
        let (
            claude_npm_installed,
            claude_npm_package_version,
            claude_npm_latest_version,
            claude_npm_update_available,
        ) = resolve_npm_package_version(claude_package_version, claude_latest_version);

        let codex_status = build_agent_status(
            AgentProvider::Codex,
            codex_runtime,
            npm_available,
            &npm_version,
            codex_npm_installed,
            codex_npm_package_version,
            codex_npm_latest_version,
            codex_npm_update_available,
        );
        log_terminal_event(
            "agent.status.done",
            None,
            None,
            Some(started_at.elapsed()),
            json!({
                "authenticated": codex_status.authenticated,
                "installed": codex_status.installed,
                "npmInstalled": codex_status.npm_installed,
                "npmUpdateAvailable": codex_status.npm_update_available,
                "provider": codex_status.id,
            }),
        );

        let claude_status = build_agent_status(
            AgentProvider::Claude,
            claude_runtime,
            npm_available,
            &npm_version,
            claude_npm_installed,
            claude_npm_package_version,
            claude_npm_latest_version,
            claude_npm_update_available,
        );
        log_terminal_event(
            "agent.status.done",
            None,
            None,
            Some(started_at.elapsed()),
            json!({
                "authenticated": claude_status.authenticated,
                "installed": claude_status.installed,
                "npmInstalled": claude_status.npm_installed,
                "npmUpdateAvailable": claude_status.npm_update_available,
                "provider": claude_status.id,
            }),
        );

        let statuses = vec![codex_status, claude_status];
        log_terminal_event(
            "agent.statuses.done",
            None,
            None,
            Some(started_at.elapsed()),
            json!({
                "authenticatedCount": statuses.iter().filter(|status| status.authenticated).count(),
                "installedCount": statuses.iter().filter(|status| status.installed).count(),
                "statusCount": statuses.len(),
                "updateAvailableCount": statuses.iter().filter(|status| status.npm_update_available).count(),
            }),
        );

        Ok(statuses)
    })
    .await
    .map_err(|error| format!("Unable to check terminal CLIs: {error}"))?
}

#[tauri::command]
async fn start_agent_login(provider: String) -> Result<AgentLoginStart, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;
        let definition = agent_definition(provider);

        launch_login_terminal(provider)?;

        Ok(AgentLoginStart {
            provider: definition.id,
            command: definition.connect_command,
            message: format!("Opened {} login in a terminal.", definition.label),
        })
    })
    .await
    .map_err(|error| format!("Unable to start terminal CLI login: {error}"))?
}

#[tauri::command]
async fn disconnect_agent(provider: String) -> Result<AgentLogoutResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;

        logout_agent_credentials(provider)
    })
    .await
    .map_err(|error| format!("Unable to disconnect terminal CLI: {error}"))?
}

#[tauri::command]
async fn install_agent(provider: String) -> Result<AgentInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;
        let result = install_agent_with_npm(provider);

        if result.installed {
            clear_agent_command_candidate_cache(provider);
        }

        Ok(result)
    })
    .await
    .map_err(|error| format!("Unable to install terminal CLI: {error}"))?
}

#[tauri::command]
async fn update_agent(provider: String) -> Result<AgentInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;
        let result = update_agent_with_npm(provider);

        if result.installed {
            clear_agent_command_candidate_cache(provider);
        }

        Ok(result)
    })
    .await
    .map_err(|error| format!("Unable to update terminal CLI: {error}"))?
}

#[tauri::command]
async fn forge_working_directory() -> Result<ForgeWorkingDirectory, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let working_directory = default_working_directory()?;

        Ok(ForgeWorkingDirectory {
            working_directory: workspace_path_display(&working_directory),
        })
    })
    .await
    .map_err(|error| format!("Unable to read Forge working directory: {error}"))?
}

#[tauri::command]
async fn validate_workspace_root_directory(path: String) -> Result<ForgeWorkingDirectory, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let working_directory = resolve_workspace_root_directory(Some(&path))?;

        Ok(ForgeWorkingDirectory {
            working_directory: workspace_path_display(&working_directory),
        })
    })
    .await
    .map_err(|error| format!("Unable to validate workspace root directory: {error}"))?
}

#[tauri::command]
async fn list_workspace_directory(
    root: String,
    relative_path: String,
) -> Result<WorkspaceDirectoryListing, String> {
    tauri::async_runtime::spawn_blocking(move || list_workspace_directory_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to list workspace directory: {error}"))?
}

#[tauri::command]
async fn read_workspace_file(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileText, String> {
    tauri::async_runtime::spawn_blocking(move || read_workspace_file_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to read workspace file: {error}"))?
}

#[tauri::command]
async fn read_workspace_file_diff(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || read_workspace_file_diff_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to read workspace file diff: {error}"))?
}

#[tauri::command]
async fn run_forge_prompt(request: ForgePromptRequest) -> Result<ForgeRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_forge_prompt_for(request))
        .await
        .map_err(|error| format!("Unable to run Forge Console prompt: {error}"))?
}

fn whisper_model_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;

    Ok(app_data_dir.join("whisper"))
}

fn whisper_model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(whisper_model_directory(app)?.join(WHISPER_MODEL_FILE))
}

fn whisper_runtime_directory(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(whisper_model_directory(app)?.join("runtime"))
}

#[cfg(windows)]
fn whisper_runtime_zip_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(whisper_model_directory(app)?.join(WHISPER_RUNTIME_ZIP_FILE))
}

#[cfg(not(windows))]
fn whisper_runtime_zip_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(whisper_model_directory(app)?.join(WHISPER_RUNTIME_ZIP_FILE))
}

fn whisper_runtime_executable_names() -> &'static [&'static str] {
    #[cfg(windows)]
    {
        &["whisper-cli.exe", "main.exe", "whisper.exe"]
    }

    #[cfg(not(windows))]
    {
        &["whisper-cli", "main", "whisper"]
    }
}

fn find_executable_on_path(names: &[&str]) -> Option<PathBuf> {
    let path_value = env::var_os("PATH")?;

    for directory in env::split_paths(&path_value) {
        for name in names {
            let candidate = directory.join(name);

            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

fn common_whisper_runtime_paths() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        vec![
            PathBuf::from("/opt/homebrew/bin/whisper-cli"),
            PathBuf::from("/usr/local/bin/whisper-cli"),
            PathBuf::from("/opt/homebrew/bin/main"),
            PathBuf::from("/usr/local/bin/main"),
        ]
    }

    #[cfg(target_os = "linux")]
    {
        vec![
            PathBuf::from("/usr/local/bin/whisper-cli"),
            PathBuf::from("/usr/bin/whisper-cli"),
            PathBuf::from("/usr/local/bin/main"),
            PathBuf::from("/usr/bin/main"),
        ]
    }

    #[cfg(windows)]
    {
        Vec::new()
    }
}

fn find_whisper_runtime_executable(directory: &Path) -> Option<PathBuf> {
    let mut pending = vec![directory.to_path_buf()];

    while let Some(current) = pending.pop() {
        let entries = fs::read_dir(&current).ok()?;

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_dir() {
                pending.push(path);
                continue;
            }

            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");

            if whisper_runtime_executable_names()
                .iter()
                .any(|runtime_name| runtime_name.eq_ignore_ascii_case(name))
            {
                return Some(path);
            }
        }
    }

    None
}

fn whisper_runtime_executable_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    if let Some(runtime) = find_whisper_runtime_executable(&whisper_runtime_directory(app)?) {
        return Ok(Some(runtime));
    }

    if let Some(runtime) = find_executable_on_path(whisper_runtime_executable_names()) {
        return Ok(Some(runtime));
    }

    Ok(common_whisper_runtime_paths()
        .into_iter()
        .find(|candidate| candidate.is_file()))
}

fn whisper_model_status_for(app: &AppHandle) -> Result<WhisperModelStatus, String> {
    let model_path = whisper_model_path(app)?;
    let runtime_path = whisper_runtime_executable_path(app)?;
    let bytes = fs::metadata(&model_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let model_installed = bytes > 0;
    let runtime_installed = runtime_path.is_some();

    Ok(WhisperModelStatus {
        installed: model_installed && runtime_installed,
        model_installed,
        runtime_installed,
        model_id: WHISPER_MODEL_ID,
        model_name: WHISPER_MODEL_NAME,
        model_file: WHISPER_MODEL_FILE,
        model_path: model_path.display().to_string(),
        runtime_name: WHISPER_RUNTIME_NAME,
        runtime_package_name: WHISPER_RUNTIME_PACKAGE_NAME,
        runtime_path: runtime_path
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| {
                whisper_runtime_directory(app)
                    .map(|path| path.display().to_string())
                    .unwrap_or_default()
            }),
        runtime_installable: WHISPER_RUNTIME_URL.is_some(),
        runtime_install_hint: WHISPER_RUNTIME_INSTALL_HINT,
        download_url: WHISPER_MODEL_URL,
        expected_sha1: WHISPER_MODEL_SHA1,
        approximate_disk_mb: WHISPER_MODEL_DISK_MB,
        approximate_memory_mb: WHISPER_MODEL_MEMORY_MB,
        bytes,
        shortcut: AUDIO_SHORTCUT,
    })
}

fn emit_audio_download_progress(app: &AppHandle, progress: WhisperModelDownloadProgress) {
    let _ = app.emit(AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT, progress);
}

fn sha1_file(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|error| format!("Unable to verify Whisper model: {error}"))?;
    let mut hasher = Sha1::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Unable to verify Whisper model: {error}"))?;

        if read == 0 {
            break;
        }

        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Unable to verify Whisper runtime: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Unable to verify Whisper runtime: {error}"))?;

        if read == 0 {
            break;
        }

        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn extract_zip_file(zip_path: &Path, destination: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path)
        .map_err(|error| format!("Unable to open Whisper runtime archive: {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Unable to read Whisper runtime archive: {error}"))?;

    fs::create_dir_all(destination)
        .map_err(|error| format!("Unable to prepare Whisper runtime directory: {error}"))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Unable to extract Whisper runtime: {error}"))?;
        let enclosed_name = entry
            .enclosed_name()
            .ok_or_else(|| "Whisper runtime archive contains an unsafe path.".to_string())?;
        let output_path = destination.join(enclosed_name);

        if entry.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|error| format!("Unable to create runtime directory: {error}"))?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Unable to create runtime directory: {error}"))?;
        }

        let mut output = fs::File::create(&output_path)
            .map_err(|error| format!("Unable to write Whisper runtime file: {error}"))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Unable to write Whisper runtime file: {error}"))?;
    }

    Ok(())
}

fn normalize_transcript_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean_transcript_for_insert(text: String) -> Result<String, String> {
    let cleaned = text
        .chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\r' | '\t'))
        .collect::<String>()
        .trim()
        .to_string();

    if cleaned.is_empty() {
        return Err("Whisper did not produce any text to insert.".to_string());
    }

    if cleaned.chars().count() > MAX_AUDIO_TRANSCRIPT_INSERT_CHARS {
        return Err(format!(
            "Transcripts are limited to {MAX_AUDIO_TRANSCRIPT_INSERT_CHARS} characters."
        ));
    }

    Ok(cleaned)
}

fn transcribe_whisper_audio_for(
    app: &AppHandle,
    request: WhisperTranscriptionRequest,
) -> Result<WhisperTranscriptionResult, String> {
    if request.audio_base64.len() > WHISPER_MAX_AUDIO_BYTES * 2 {
        return Err("Recorded audio is too large to transcribe.".to_string());
    }

    let audio_bytes = general_purpose::STANDARD
        .decode(request.audio_base64.trim())
        .map_err(|error| format!("Recorded audio is not valid base64: {error}"))?;

    if audio_bytes.len() > WHISPER_MAX_AUDIO_BYTES {
        return Err("Recorded audio is too large to transcribe.".to_string());
    }

    let model_path = whisper_model_path(app)?;
    let runtime_path = whisper_runtime_executable_path(app)?
        .ok_or_else(|| "Install the local Whisper runtime before recording.".to_string())?;

    if !model_path.exists() {
        return Err("Install the local Whisper model before recording.".to_string());
    }

    let started_at = Instant::now();
    let temp_directory = whisper_model_directory(app)?.join("recordings");
    fs::create_dir_all(&temp_directory)
        .map_err(|error| format!("Unable to prepare audio recording directory: {error}"))?;

    let recording_id = current_time_ms();
    let audio_path = temp_directory.join(format!("recording-{recording_id}.wav"));
    let output_prefix = temp_directory.join(format!("transcript-{recording_id}"));
    let transcript_path = output_prefix.with_extension("txt");

    fs::write(&audio_path, &audio_bytes)
        .map_err(|error| format!("Unable to prepare microphone audio: {error}"))?;

    let runtime = runtime_path.display().to_string();
    let model = model_path.display().to_string();
    let audio = audio_path.display().to_string();
    let output = output_prefix.display().to_string();
    let args = vec![
        "-m".to_string(),
        model,
        "-f".to_string(),
        audio,
        "-l".to_string(),
        "en".to_string(),
        "-nt".to_string(),
        "-otxt".to_string(),
        "-of".to_string(),
        output,
    ];
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let capture_result = run_command_capture(
        &runtime,
        &arg_refs,
        None,
        Duration::from_secs(WHISPER_TRANSCRIBE_TIMEOUT_SECS),
        None,
    );
    let capture = match capture_result {
        Ok(capture) => capture,
        Err(error) => {
            let _ = fs::remove_file(&audio_path);
            let _ = fs::remove_file(&transcript_path);
            return Err(error);
        }
    };

    let transcript = fs::read_to_string(&transcript_path)
        .unwrap_or_else(|_| command_output_text(&capture.stdout, &capture.stderr));
    let text = normalize_transcript_text(&transcript);
    let _ = fs::remove_file(&audio_path);
    let _ = fs::remove_file(&transcript_path);

    if capture.exit_code != Some(0) && text.is_empty() {
        return Err(
            first_output_line(&command_output_text(&capture.stdout, &capture.stderr))
                .chars()
                .take(240)
                .collect::<String>(),
        );
    }

    Ok(WhisperTranscriptionResult {
        text,
        segments: if transcript.trim().is_empty() { 0 } else { 1 },
        duration_ms: started_at.elapsed().as_millis(),
    })
}

fn ensure_audio_widget_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(
        app,
        AUDIO_WIDGET_WINDOW_LABEL,
        WebviewUrl::App("index.html#/audio-widget".into()),
    )
    .title("Diff Forge Audio")
    .inner_size(380.0, 430.0)
    .min_inner_size(340.0, 380.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .focused(false)
    .visible(false)
    .shadow(true)
    .build()
    .map_err(|error| format!("Unable to create audio widget: {error}"))
}

fn show_audio_widget_for(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    let status = whisper_model_status_for(app)?;

    if !status.installed {
        if !status.model_installed {
            return Err(
                "Install the local Whisper model before opening the audio widget.".to_string(),
            );
        }

        return Err(WHISPER_RUNTIME_INSTALL_HINT.to_string());
    }

    let window = ensure_audio_widget_window(app)?;
    window
        .show()
        .map_err(|error| format!("Unable to show audio widget: {error}"))?;

    let _ = app.emit_to(AUDIO_WIDGET_WINDOW_LABEL, AUDIO_WIDGET_ARM_EVENT, ());
    let app_for_retry = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(350));
        let _ = app_for_retry.emit_to(AUDIO_WIDGET_WINDOW_LABEL, AUDIO_WIDGET_ARM_EVENT, ());
    });

    Ok(AudioWidgetVisibility {
        visible: true,
        installed: true,
        shortcut: AUDIO_SHORTCUT,
    })
}

fn hide_audio_widget_for(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
        window
            .hide()
            .map_err(|error| format!("Unable to hide audio widget: {error}"))?;
    }

    Ok(AudioWidgetVisibility {
        visible: false,
        installed: whisper_model_status_for(app)?.installed,
        shortcut: AUDIO_SHORTCUT,
    })
}

fn toggle_audio_widget_for(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            return hide_audio_widget_for(app);
        }
    }

    show_audio_widget_for(app)
}

#[cfg(windows)]
fn windows_unicode_input(scan: u16, key_up: bool) -> WindowsInput {
    WindowsInput {
        input_type: INPUT_KEYBOARD,
        union: WindowsInputUnion {
            ki: WindowsKeyboardInput {
                w_vk: 0,
                w_scan: scan,
                dw_flags: KEYEVENTF_UNICODE | if key_up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dw_extra_info: 0,
            },
        },
    }
}

#[cfg(windows)]
fn insert_text_into_focused_target(text: &str) -> Result<(), String> {
    let normalized = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', "\r");
    let units = normalized.encode_utf16().collect::<Vec<_>>();

    if units.is_empty() {
        return Err("No text was produced for insertion.".to_string());
    }

    let mut inputs = Vec::with_capacity(units.len() * 2);

    for unit in units {
        inputs.push(windows_unicode_input(unit, false));
        inputs.push(windows_unicode_input(unit, true));
    }

    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<WindowsInput>() as i32,
        )
    };

    if sent != inputs.len() as u32 {
        return Err("Windows did not accept the full transcript insertion.".to_string());
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn insert_text_into_focused_target(text: &str) -> Result<(), String> {
    run_command_capture("pbcopy", &[], Some(text), Duration::from_secs(3), None)?;
    let paste = run_command_capture(
        "osascript",
        &[
            "-e",
            "tell application \"System Events\" to keystroke \"v\" using command down",
        ],
        None,
        Duration::from_secs(4),
        None,
    )?;

    if paste.exit_code == Some(0) {
        Ok(())
    } else {
        Err(first_output_line(&command_output_text(
            &paste.stdout,
            &paste.stderr,
        )))
    }
}

#[cfg(target_os = "linux")]
fn insert_text_into_focused_target(text: &str) -> Result<(), String> {
    let mut errors = Vec::new();

    match run_command_capture(
        "xdotool",
        &["type", "--clearmodifiers", "--delay", "0", text],
        None,
        Duration::from_secs(5),
        None,
    ) {
        Ok(capture) if capture.exit_code == Some(0) => return Ok(()),
        Ok(capture) => errors.push(command_output_text(&capture.stdout, &capture.stderr)),
        Err(error) => errors.push(error),
    }

    match run_command_capture("wtype", &[text], None, Duration::from_secs(5), None) {
        Ok(capture) if capture.exit_code == Some(0) => return Ok(()),
        Ok(capture) => errors.push(command_output_text(&capture.stdout, &capture.stderr)),
        Err(error) => errors.push(error),
    }

    let wl_clipboard_set =
        run_command_capture("wl-copy", &[], Some(text), Duration::from_secs(3), None);
    if wl_clipboard_set.is_ok() {
        match run_command_capture(
            "wtype",
            &["-M", "ctrl", "v", "-m", "ctrl"],
            None,
            Duration::from_secs(5),
            None,
        ) {
            Ok(capture) if capture.exit_code == Some(0) => return Ok(()),
            Ok(capture) => errors.push(command_output_text(&capture.stdout, &capture.stderr)),
            Err(error) => errors.push(error),
        }
    } else if let Err(error) = wl_clipboard_set {
        errors.push(error);
    }

    let x_clipboard_set = run_command_capture(
        "xclip",
        &["-selection", "clipboard"],
        Some(text),
        Duration::from_secs(3),
        None,
    );
    if x_clipboard_set.is_ok() {
        match run_command_capture(
            "xdotool",
            &["key", "--clearmodifiers", "ctrl+v"],
            None,
            Duration::from_secs(5),
            None,
        ) {
            Ok(capture) if capture.exit_code == Some(0) => return Ok(()),
            Ok(capture) => errors.push(command_output_text(&capture.stdout, &capture.stderr)),
            Err(error) => errors.push(error),
        }
    } else if let Err(error) = x_clipboard_set {
        errors.push(error);
    }

    let detail = errors
        .into_iter()
        .map(|error| error.trim().to_string())
        .find(|error| !error.is_empty())
        .unwrap_or_else(|| "No supported Linux text insertion helper succeeded.".to_string());

    Err(format!(
        "Unable to insert transcript on Linux. Install xdotool for X11 or wtype/wl-copy for Wayland. {detail}"
    ))
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn insert_text_into_focused_target(_text: &str) -> Result<(), String> {
    Err("Focused transcript insertion is not supported on this platform yet.".to_string())
}

#[tauri::command]
async fn whisper_model_status(app: AppHandle) -> Result<WhisperModelStatus, String> {
    whisper_model_status_for(&app)
}

#[tauri::command]
async fn download_whisper_model(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
) -> Result<WhisperModelStatus, String> {
    let _download_guard = audio_state.download_lock.lock().await;
    let model_directory = whisper_model_directory(&app)?;
    let model_path = model_directory.join(WHISPER_MODEL_FILE);
    let temp_path = model_directory.join(format!("{WHISPER_MODEL_FILE}.download"));

    fs::create_dir_all(&model_directory)
        .map_err(|error| format!("Unable to create Whisper model directory: {error}"))?;

    if !model_path.exists() {
        emit_audio_download_progress(
            &app,
            WhisperModelDownloadProgress {
                state: "starting".to_string(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: None,
                message: format!("Downloading {WHISPER_MODEL_NAME}."),
            },
        );

        let client = http_client(Duration::from_secs(WHISPER_DOWNLOAD_TIMEOUT_SECS))?;
        let mut response = client
            .get(WHISPER_MODEL_URL)
            .send()
            .await
            .map_err(|error| format!("Unable to download Whisper model: {error}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Whisper model download returned HTTP {}.",
                response.status()
            ));
        }

        let total_bytes = response.content_length();
        let mut downloaded_bytes = 0u64;
        let mut file = fs::File::create(&temp_path)
            .map_err(|error| format!("Unable to write Whisper model: {error}"))?;

        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("Unable to read Whisper model download: {error}"))?
        {
            file.write_all(&chunk)
                .map_err(|error| format!("Unable to write Whisper model: {error}"))?;
            downloaded_bytes += chunk.len() as u64;
            let percent = total_bytes
                .filter(|total| *total > 0)
                .map(|total| (downloaded_bytes as f64 / total as f64) * 100.0);

            emit_audio_download_progress(
                &app,
                WhisperModelDownloadProgress {
                    state: "downloading".to_string(),
                    downloaded_bytes,
                    total_bytes,
                    percent,
                    message: "Downloading local Whisper weights.".to_string(),
                },
            );
        }

        file.flush()
            .map_err(|error| format!("Unable to finish Whisper model write: {error}"))?;
        let downloaded_sha1 = sha1_file(&temp_path)?;

        if downloaded_sha1 != WHISPER_MODEL_SHA1 {
            let _ = fs::remove_file(&temp_path);
            return Err("Downloaded Whisper model failed checksum verification.".to_string());
        }

        fs::rename(&temp_path, &model_path)
            .map_err(|error| format!("Unable to install Whisper model: {error}"))?;
    }

    if whisper_runtime_executable_path(&app)?.is_none() {
        let Some(runtime_url) = WHISPER_RUNTIME_URL else {
            emit_audio_download_progress(
                &app,
                WhisperModelDownloadProgress {
                    state: "runtime-missing".to_string(),
                    downloaded_bytes: 0,
                    total_bytes: None,
                    percent: Some(100.0),
                    message: WHISPER_RUNTIME_INSTALL_HINT.to_string(),
                },
            );

            return whisper_model_status_for(&app);
        };
        let runtime_sha256 = WHISPER_RUNTIME_SHA256
            .ok_or_else(|| "Whisper runtime checksum is not configured.".to_string())?;
        let runtime_directory = whisper_runtime_directory(&app)?;
        let runtime_zip_path = whisper_runtime_zip_path(&app)?;
        let runtime_temp_path =
            model_directory.join(format!("{WHISPER_RUNTIME_ZIP_FILE}.download"));

        emit_audio_download_progress(
            &app,
            WhisperModelDownloadProgress {
                state: "runtime".to_string(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: None,
                message: format!("Downloading {WHISPER_RUNTIME_NAME}."),
            },
        );

        let client = http_client(Duration::from_secs(WHISPER_DOWNLOAD_TIMEOUT_SECS))?;
        let mut response = client
            .get(runtime_url)
            .send()
            .await
            .map_err(|error| format!("Unable to download Whisper runtime: {error}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Whisper runtime download returned HTTP {}.",
                response.status()
            ));
        }

        let total_bytes = response.content_length();
        let mut downloaded_bytes = 0u64;
        let mut file = fs::File::create(&runtime_temp_path)
            .map_err(|error| format!("Unable to write Whisper runtime: {error}"))?;

        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("Unable to read Whisper runtime download: {error}"))?
        {
            file.write_all(&chunk)
                .map_err(|error| format!("Unable to write Whisper runtime: {error}"))?;
            downloaded_bytes += chunk.len() as u64;
            let percent = total_bytes
                .filter(|total| *total > 0)
                .map(|total| (downloaded_bytes as f64 / total as f64) * 100.0);

            emit_audio_download_progress(
                &app,
                WhisperModelDownloadProgress {
                    state: "runtime".to_string(),
                    downloaded_bytes,
                    total_bytes,
                    percent,
                    message: "Downloading local Whisper runtime.".to_string(),
                },
            );
        }

        file.flush()
            .map_err(|error| format!("Unable to finish Whisper runtime write: {error}"))?;
        let downloaded_sha256 = sha256_file(&runtime_temp_path)?;

        if downloaded_sha256 != runtime_sha256 {
            let _ = fs::remove_file(&runtime_temp_path);
            return Err("Downloaded Whisper runtime failed checksum verification.".to_string());
        }

        fs::rename(&runtime_temp_path, &runtime_zip_path)
            .map_err(|error| format!("Unable to install Whisper runtime archive: {error}"))?;
        extract_zip_file(&runtime_zip_path, &runtime_directory)?;
    }

    emit_audio_download_progress(
        &app,
        WhisperModelDownloadProgress {
            state: "done".to_string(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: Some(100.0),
            message: "Whisper is installed locally.".to_string(),
        },
    );

    whisper_model_status_for(&app)
}

#[tauri::command]
async fn transcribe_whisper_audio(
    app: AppHandle,
    request: WhisperTranscriptionRequest,
) -> Result<WhisperTranscriptionResult, String> {
    tauri::async_runtime::spawn_blocking(move || transcribe_whisper_audio_for(&app, request))
        .await
        .map_err(|error| format!("Unable to run local Whisper transcription: {error}"))?
}

#[tauri::command]
async fn show_audio_widget(app: AppHandle) -> Result<AudioWidgetVisibility, String> {
    show_audio_widget_for(&app)
}

#[tauri::command]
async fn hide_audio_widget(app: AppHandle) -> Result<AudioWidgetVisibility, String> {
    hide_audio_widget_for(&app)
}

#[tauri::command]
async fn toggle_audio_widget(app: AppHandle) -> Result<AudioWidgetVisibility, String> {
    toggle_audio_widget_for(&app)
}

#[tauri::command]
async fn insert_transcribed_text(
    app: AppHandle,
    text: String,
) -> Result<AudioWidgetVisibility, String> {
    let text = clean_transcript_for_insert(text)?;

    if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
        let _ = window.hide();
    }

    let insert_result = tauri::async_runtime::spawn_blocking(move || {
        thread::sleep(Duration::from_millis(220));
        insert_text_into_focused_target(&text)
    })
    .await
    .map_err(|error| format!("Unable to insert transcript: {error}"))?;

    if let Err(error) = insert_result {
        if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
            let _ = window.show();
            let _ = window.set_focus();
        }

        return Err(error);
    }

    Ok(AudioWidgetVisibility {
        visible: false,
        installed: whisper_model_status_for(&app)?.installed,
        shortcut: AUDIO_SHORTCUT,
    })
}

pub fn run() {
    let mut builder = tauri::Builder::default();
    let pty_pool = Arc::new(PtyPool::new());

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
            terminal_close_all
        ])
        .run(tauri::generate_context!())
        .expect("error while running Diff Forge AI desktop");
}

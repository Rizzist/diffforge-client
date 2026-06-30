#![recursion_limit = "512"]

use std::{
    collections::{HashMap, HashSet, VecDeque},
    env, fs,
    io::{Read, SeekFrom, Write},
    net::ToSocketAddrs,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, AtomicUsize, Ordering},
        Arc, Mutex as StdMutex, OnceLock,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};
use futures_util::{FutureExt, SinkExt, StreamExt};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest as Sha1Digest, Sha1};
use sha2::Sha256;
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    utils::config::Color,
    AppHandle, Emitter, Listener, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{mpsc, oneshot, Mutex, RwLock},
    time::{sleep, timeout},
};
use tokio_tungstenite::{
    accept_async, connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
};

pub mod coordination;

const DEFAULT_API_BASE_URL: &str = "https://diffforge.ai/api";
const DEFAULT_WEB_LOGIN_URL: &str = "https://diffforge.ai/desktop/login";

fn api_base_url() -> String {
    DEFAULT_API_BASE_URL.to_string()
}

fn api_endpoint(path: &str) -> String {
    format!("{}/{}", api_base_url(), path.trim_start_matches('/'))
}

fn web_login_url_from_api_base(api_base: &str) -> Option<String> {
    api_base
        .trim_end_matches('/')
        .strip_suffix("/api")
        .map(|origin| format!("{origin}/desktop/login"))
}

fn desktop_web_login_url_base() -> String {
    web_login_url_from_api_base(&api_base_url())
        .unwrap_or_else(|| DEFAULT_WEB_LOGIN_URL.to_string())
}

const MIN_AUTH_VALUE_LENGTH: usize = 24;
const MAX_AUTH_VALUE_LENGTH: usize = 192;
const DEFAULT_API_TIMEOUT_SECS: u64 = 10;
const AUTH_EXCHANGE_TIMEOUT_SECS: u64 = 10;
const SESSION_VALIDATE_TIMEOUT_SECS: u64 = 5;
const LOGOUT_TIMEOUT_SECS: u64 = 5;
const DEVICE_AUTH_START_TIMEOUT_SECS: u64 = 10;
const DEVICE_AUTH_POLL_TIMEOUT_SECS: u64 = 10;
const AGENT_STATUS_TIMEOUT_SECS: u64 = 6;
const AGENT_UPDATE_CHECK_TIMEOUT_SECS: u64 = 3;
// Coding-agent npm packages ship multi-hundred-MB native binaries (Claude
// Code's darwin-arm64 binary alone is ~220MB). run_command_capture KILLS the
// child on timeout, and killing npm mid-extraction leaves a truncated binary
// with a missing package.json — the agent then launches as a broken stub
// ("native binary not installed"). Keep this generous; a slow network is not
// an error.
const AGENT_INSTALL_TIMEOUT_SECS: u64 = 900;
const AGENT_RUN_TIMEOUT_SECS: u64 = 120;
const AGENT_THREAD_TURN_TIMEOUT_SECS: u64 = 30 * 60;
const AGENT_LOGOUT_TIMEOUT_SECS: u64 = 30;
const MAX_FORGE_PROMPT_LENGTH: usize = 12_000;
// Long enough for OpenCode `providerID/modelID` ids, whose model segment can
// itself be a slash path (e.g. `fireworks-ai/accounts/fireworks/routers/...`).
const MAX_FORGE_MODEL_LENGTH: usize = 128;
const MAX_FORGE_IMAGES: usize = 4;
const MAX_FORGE_IMAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_FORGE_IMAGE_TOTAL_BYTES: usize = 8 * 1024 * 1024;
const MAX_HTML_DOCUMENT_OPEN_BYTES: usize = 10 * 1024 * 1024;
const MAX_TODO_TEXT_ATTACHMENT_BYTES: usize = 256 * 1024;
const TERMINAL_DEFAULT_COLS: u16 = 80;
const TERMINAL_DEFAULT_ROWS: u16 = 24;
const TERMINAL_MIN_COLS: u16 = 20;
const TERMINAL_MIN_ROWS: u16 = 6;
const TERMINAL_MAX_COLS: u16 = 400;
const TERMINAL_MAX_ROWS: u16 = 160;
const MAX_TERMINAL_WRITE_BYTES: usize = 64 * 1024;
const MAX_TERMINAL_INPUT_TRANSPORT_MESSAGE_BYTES: usize = 256 * 1024;
const MAX_TERMINAL_ACTIVITY_TRANSPORT_MESSAGE_BYTES: usize = 256 * 1024;
const TERMINAL_INPUT_QUEUE_CAPACITY: usize = 1024;
const TERMINAL_INPUT_QUEUE_IDLE_SECS: u64 = 30;
const MAX_TERMINAL_START_AGENT_BATCH: usize = 32;
const TERMINAL_PTY_POOL_TARGET: usize = 0;
const TERMINAL_OUTPUT_READ_BUFFER_BYTES: usize = 8192;
const TERMINAL_OUTPUT_COALESCE_WINDOW_MS: u64 = 6;
const TERMINAL_OUTPUT_COALESCE_MAX_BYTES: usize = 16 * 1024;
const TERMINAL_OUTPUT_COALESCE_QUEUE_CAPACITY: usize = 64;
const TERMINAL_HEADLESS_OUTPUT_TAIL_BYTES: usize = 512 * 1024;
const TERMINAL_PARKED_RESUME_SUBMIT_DELAY_MS: u64 = 120;
const TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE: &str = "\r";
const TERMINAL_ACTIVITY_HOOK_POLL_MS: u64 = 50;
const TERMINAL_ACTIVITY_HOOK_FALLBACK_POLL_MS: u64 = 2_000;
const TERMINAL_ACTIVITY_TRANSPORT_CONNECT_TIMEOUT_MS: u64 = 150;
const TERMINAL_ACTIVITY_TRANSPORT_IO_TIMEOUT_MS: u64 = 1_000;
const TERMINAL_ENTER_SEQUENCE: &str = "\x1b[13u";
const TERMINAL_ENTER_SEQUENCE_MOD1: &str = "\x1b[13;1u";
const TERMINAL_SHIFT_ENTER_SEQUENCE: &str = "\x1b[13;2u";
const MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH: usize = 2048;
const MAX_FILE_EXPLORER_ENTRIES: usize = 600;
const MAX_WORKSPACE_PROJECT_MOUNTS: usize = 64;
const MAX_SAFE_WORKSPACE_ROOT_IMMEDIATE_ENTRIES: usize = 256;
const WORKSPACE_PROJECT_MOUNT_SCAN_MAX_DEPTH: usize = 2;
const WORKSPACE_PROJECT_MOUNT_SCAN_ROOT_FANOUT: usize = 100;
const WORKSPACE_PROJECT_MOUNT_SCAN_CHILD_FANOUT: usize = 20;
const WORKSPACE_PROJECT_MOUNT_SCAN_MAX_DIRECTORIES: usize = 500;
const WORKSPACE_PROJECT_MOUNT_CACHE_TTL_MS: u64 = 60_000;
const MAX_WORKSPACE_FILE_READ_BYTES: u64 = 1024 * 1024;
const MAX_WORKSPACE_IMAGE_PREVIEW_BYTES: u64 = 10 * 1024 * 1024;
const MAX_WORKSPACE_FILE_DIFF_BYTES: usize = 384 * 1024;
const GIT_STATUS_TIMEOUT_SECS: u64 = 2;
const GIT_DIFF_TIMEOUT_SECS: u64 = 3;
const GIT_INIT_TIMEOUT_SECS: u64 = 15;
const GIT_COMMIT_TIMEOUT_SECS: u64 = 30;
const TERMINAL_SHUTDOWN_POLL_ATTEMPTS: usize = 40;
const TERMINAL_SHUTDOWN_POLL_INTERVAL_MS: u64 = 25;
const TERMINAL_CLOSE_COMMAND_WAIT_MS: u64 = 12_000;
const TERMINAL_CLOSE_ALL_WAIT_MS: u64 = 12_000;
const TERMINAL_CLOSE_ALL_COORDINATION_WAIT_MS: u64 = 750;
const TERMINAL_DROP_CLEANUP_TRACKER_WAIT_MS: u64 = 1_500;
const TERMINAL_WORKSPACE_TOPOLOGY_CACHE_FRESH_MS: u64 = 15_000;
const APP_CLOSE_EXIT_REQUEST_DELAY_MS: u64 = 50;
const APP_CLOSE_DESTROY_FALLBACK_DELAY_MS: u64 = 250;
const APP_CLOSE_PROCESS_EXIT_FALLBACK_DELAY_MS: u64 = 1_500;
const APP_CLOSE_FORCE_EXIT_FALLBACK_DELAY_MS: u64 = 45_000;
const APP_SHUTDOWN_PHASE_RUNNING: u8 = 0;
const APP_SHUTDOWN_PHASE_QUIESCING: u8 = 1;
const APP_SHUTDOWN_PHASE_STOPPING_WATCHERS: u8 = 2;
const APP_SHUTDOWN_PHASE_CLOSING_TERMINALS: u8 = 3;
const APP_SHUTDOWN_PHASE_STOPPING_DAEMONS: u8 = 4;
const APP_SHUTDOWN_PHASE_EXITING: u8 = 5;
const DIAGNOSTIC_LOG_DIR: &str = "logs";
const TERMINAL_TELEMETRY_MAX_TEXT: usize = 512;
const TERMINAL_DIAGNOSTIC_LOGGING_ENABLED: bool = false;
const TERMINAL_DIAGNOSTIC_RUNTIME_ENABLE_ALLOWED: bool = false;
const TERMINAL_DIAGNOSTIC_LOG_FILE: &str = "terminal-performance.jsonl";
const THREAD_BRIDGE_DIAGNOSTIC_LOGGING_ENABLED: bool = false;
const THREAD_BRIDGE_DIAGNOSTIC_LOG_FILE: &str = "thread-bridge.jsonl";
const BIGVIEW_SYNC_DIAGNOSTIC_LOGGING_ENABLED: bool = false;
const BIGVIEW_SYNC_DIAGNOSTIC_LOG_FILE: &str = "bigview-sync.jsonl";
const WORKSPACE_ACTIVATION_DIAGNOSTIC_LOGGING_ENABLED: bool = false;
const WORKSPACE_ACTIVATION_DIAGNOSTIC_LOG_FILE: &str = "workspace-activation.jsonl";
const VOICE_ORCHESTRATOR_DIAGNOSTIC_LOGGING_ENABLED: bool = false;
const VOICE_ORCHESTRATOR_DIAGNOSTIC_LOG_FILE: &str = "voice-orchestrator.jsonl";
const TERMINAL_STATUS_LOGGING_ENABLED: bool = false;
const TERMINAL_STATUS_LOG_FILE: &str = "terminal-statuses.jsonl";
/// Flip to trace the cloud sync/connect loop into logs/cloud-sync.jsonl:
/// every connection-state note, ws phase change, route resolution, open
/// attempt (with durations), disconnect reason, and outbox depth.
const CLOUD_SYNC_LOGGING_ENABLED: bool = false;
const CLOUD_SYNC_LOG_FILE: &str = "cloud-sync.jsonl";
const TERMINAL_CRASH_FORENSICS_LOGGING_ENABLED: bool = false;
const TERMINAL_CRASH_FORENSICS_LOG_FILE: &str = "terminal-crash-forensics.jsonl";
const TERMINAL_DIAGNOSTIC_LOG_MAX_TEXT: usize = 512;
const TERMINAL_DIAGNOSTIC_SLOW_MS: f64 = 8.0;
const WINDOWS_TERMINAL_DIAGNOSTIC_LOGGING_ENABLED: bool = false;
const WINDOWS_TERMINAL_DIAGNOSTIC_RUNTIME_ENABLE_ALLOWED: bool = false;
const WINDOWS_TERMINAL_DIAGNOSTIC_LOG_FILE: &str = "windows-terminal-diagnostics.jsonl";
const WHISPER_LOCAL_AUDIO_LOGGING_ENABLED: bool = false;
const WHISPER_LOCAL_AUDIO_LOG_FILE: &str = "whisper-local-audio.jsonl";
const WHISPER_LOCAL_AUDIO_LOG_MAX_TEXT: usize = 512;
const AUDIO_WIDGET_BOTTOM_BAR_DEBUG_LOGGING_ENABLED: bool = false;
const AUDIO_WIDGET_BOTTOM_BAR_DEBUG_LOG_FILE: &str = "audio-widget-bottom-bar.jsonl";
const AUDIO_WIDGET_BUBBLE_POSITION_DEBUG_LOGGING_ENABLED: bool = false;
const AUDIO_WIDGET_BUBBLE_POSITION_DEBUG_LOG_FILE: &str = "audio-widget-bubble-position.jsonl";
const SNIPPING_AREA_CURSOR_DEBUG_LOGGING_ENABLED: bool = false;
const SNIPPING_AREA_CURSOR_DEBUG_LOG_FILE: &str = "snipping-area-cursor.jsonl";
const APP_SHUTDOWN_PROGRESS_EVENT: &str = "forge-app-shutdown-progress";
const APP_SHUTDOWN_TOTAL_STEPS: u8 = 6;
const DEEP_LINK_NEW_URL_EVENT: &str = "deep-link://new-url";
const TERMINAL_CLOSE_ALL_PROGRESS_EVENT: &str = "forge-terminal-close-all-progress";
const TERMINAL_AUDIO_INPUT_REFOCUS_EVENT: &str = "forge-terminal-audio-input-refocus";
const TERMINAL_INPUT_EVENT: &str = "forge-terminal-input";
const TERMINAL_INPUT_ERROR_EVENT: &str = "forge-terminal-input-error";
const TERMINAL_FORK_REQUESTED_EVENT: &str = "forge-terminal-fork-requested";
const TERMINAL_PROMPT_SUBMITTED_EVENT: &str = "forge-terminal-prompt-submitted";
const TERMINAL_ACTIVITY_HOOK_EVENT: &str = "forge-terminal-activity-hook";
const TERMINAL_PROVIDER_SESSION_BOUND_EVENT: &str = "forge-terminal-provider-session-bound";
const WORKSPACE_AGENT_SESSION_HISTORY_CHANGED_EVENT: &str =
    "workspace-agent-session-history-changed";
const AGENT_CHAT_SESSION_SYNC_STATUS_CHANGED_EVENT: &str = "agent-chat-session-sync-status-changed";
const TERMINAL_ARCHITECTURE_ACTIVITY_EVENT: &str = "diffforge:terminal-architecture-activity";
const TERMINAL_OUTPUT_STATE_EVENT: &str = "forge-terminal-output-state";
const TERMINAL_PARKED_PROMPT_EVENT: &str = "forge-terminal-parked-prompt";
const TERMINAL_TODO_PLAN_UPDATED_EVENT: &str = "forge-terminal-todo-plan-updated";
const WORKSPACE_NOTIFICATION_EVENT: &str = "diffforge:workspace-notification-event";
const MAIN_WINDOW_CURSOR_EVENT: &str = "forge-main-window-cursor";
const MAIN_WINDOW_CURSOR_POLL_MS: u64 = 50;
const MAIN_WINDOW_CURSOR_IDLE_POLL_MS: u64 = 500;
const MAIN_WINDOW_CURSOR_HIDDEN_POLL_MS: u64 = 5_000;
const AUDIO_WIDGET_WINDOW_LABEL: &str = "audio-widget";
const AUDIO_WIDGET_ERROR_WINDOW_LABEL: &str = "audio-widget-error";
const AUDIO_WIDGET_VISIBILITY_CHANGED_EVENT: &str = "forge-audio-widget-visibility-changed";
const ACTIVITY_OVERLAY_WINDOW_LABEL: &str = "activity-overlay";
const ACTIVITY_OVERLAY_VISIBILITY_CHANGED_EVENT: &str = "forge-activity-overlay-visibility-changed";
const ACTIVITY_OVERLAY_SHORTCUT: &str = "Ctrl+Shift+Space";
#[cfg(target_os = "macos")]
const MAIN_WINDOW_RESTORE_FOCUS_DELAY_MS: u64 = 260;
#[cfg(target_os = "macos")]
const MAIN_WINDOW_RESTORE_RETRY_DELAYS_MS: [u64; 2] = [160, 240];
#[cfg(target_os = "macos")]
const MAIN_WINDOW_RESTORE_COALESCE_RELEASE_MS: u64 = 120;
#[cfg(target_os = "macos")]
const MAIN_WINDOW_MINIMIZE_RESTORE_SUPPRESS_MS: u64 = 1_000;
#[derive(Clone, Copy)]
struct WhisperModelDefinition {
    id: &'static str,
    name: &'static str,
    file: &'static str,
    url: &'static str,
    sha256: &'static str,
    approximate_disk_mb: u64,
    approximate_memory_mb: u64,
    tier: &'static str,
    description: &'static str,
}

const WHISPER_DEFAULT_MODEL_ID: &str = "base.en";
const WHISPER_SELECTED_MODEL_FILE: &str = "selected-model.txt";
const WHISPER_MODEL_OPTIONS: &[WhisperModelDefinition] = &[
    WhisperModelDefinition {
        id: "tiny.en",
        name: "Whisper tiny.en",
        file: "ggml-tiny.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
        sha256: "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
        approximate_disk_mb: 74,
        approximate_memory_mb: 260,
        tier: "Fastest",
        description: "Lowest footprint",
    },
    WhisperModelDefinition {
        id: "base.en",
        name: "Whisper base.en",
        file: "ggml-base.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
        sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
        approximate_disk_mb: 142,
        approximate_memory_mb: 500,
        tier: "Balanced",
        description: "Current default",
    },
    WhisperModelDefinition {
        id: "small.en",
        name: "Whisper small.en",
        file: "ggml-small.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
        sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
        approximate_disk_mb: 465,
        approximate_memory_mb: 1100,
        tier: "Higher accuracy",
        description: "Larger local model",
    },
];
static APP_PANIC_LOG_HOOK_INSTALLED: OnceLock<()> = OnceLock::new();
static APP_CLOSE_SHUTDOWN_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static APP_CLOSE_FORCE_EXIT_SCHEDULED: AtomicBool = AtomicBool::new(false);
static APP_SHUTDOWN_PHASE: AtomicU8 = AtomicU8::new(APP_SHUTDOWN_PHASE_RUNNING);
static TERMINAL_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static THREAD_BRIDGE_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static BIGVIEW_SYNC_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static WORKSPACE_ACTIVATION_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static VOICE_ORCHESTRATOR_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static TERMINAL_STATUS_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static CLOUD_SYNC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static TERMINAL_CRASH_FORENSICS_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static WINDOWS_TERMINAL_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
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
    "Install whisper.cpp CLI with Homebrew: brew install whisper-cpp. If Homebrew is missing, install it from https://brew.sh, then recheck.";
#[cfg(target_os = "macos")]
const WHISPER_HOMEBREW_MISSING_HINT: &str =
    "Homebrew is required to install whisper.cpp automatically. Install Homebrew from https://brew.sh, then recheck.";
#[cfg(target_os = "linux")]
const WHISPER_RUNTIME_INSTALL_HINT: &str =
    "Install whisper.cpp CLI and make whisper-cli, whisper, or main available on PATH.";
#[cfg(windows)]
const WHISPER_RUNTIME_INSTALL_HINT: &str =
    "Diff Forge can download the official whisper.cpp x64 runtime automatically.";
const WHISPER_DOWNLOAD_TIMEOUT_SECS: u64 = 900;
const WHISPER_MAX_AUDIO_BYTES: usize = 32 * 1024 * 1024;
const WHISPER_TRANSCRIBE_TIMEOUT_SECS: u64 = 180;
const DEEPGRAM_LISTEN_WS_URL: &str = "wss://api.deepgram.com/v1/listen";
const DEEPGRAM_MODEL: &str = "nova-3";
const DEEPGRAM_DEFAULT_LANGUAGE: &str = "en";
const DEEPGRAM_TRANSCRIBE_TIMEOUT_SECS: u64 = 90;
const DEEPGRAM_CONNECT_TIMEOUT_SECS: u64 = 10;
const DEEPGRAM_CLOSE_TIMEOUT_SECS: u64 = 8;
const CLOUD_VOICE_AGENT_STREAM_START_TIMEOUT_SECS: u64 = 45;
const CLOUD_VOICE_AGENT_RESULT_TIMEOUT_SECS: u64 = 95;
const DEEPGRAM_MAX_API_KEY_LENGTH: usize = 512;
const DEEPGRAM_MAX_LANGUAGE_LENGTH: usize = 24;
const AUDIO_REALTIME_TRANSCRIPT_EVENT: &str = "forge-audio-realtime-transcript";
const CLOUD_VOICE_AGENT_EVENT: &str = "forge-cloud-voice-agent-event";
const MAX_AUDIO_TRANSCRIPT_INSERT_CHARS: usize = 8_000;
const AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT: &str = "forge-audio-model-download-progress";
const AUDIO_INPUT_STATS_EVENT: &str = "forge-audio-input-stats";
const AUDIO_TARGET_SAMPLE_RATE: u32 = 16_000;
const AUDIO_BUFFER_MAX_SECONDS: f64 = 3.0;
const AUDIO_CAPTURE_MAX_SECONDS: f64 = 90.0;
const AUDIO_CAPTURE_PREROLL_MS: u64 = 500;
/// Live input-stats emit cadence while actively recording or feeding an agent
/// stream — a smooth ~17 fps meter/waveform.
const AUDIO_STATS_INTERVAL_MS: u64 = 60;
/// Cadence while the mic is only warm on standby (no recording, no realtime
/// consumer). The always-open audio widget re-renders its meter on every emit,
/// so standby uses a sparse keepalive level while active capture keeps the
/// smooth meter cadence above.
const AUDIO_STATS_STANDBY_INTERVAL_MS: u64 = 1_000;
const AUDIO_INPUT_FREQUENCY_BAND_COUNT: usize = 24;
const AUDIO_INPUT_FREQUENCY_WINDOW_SAMPLES: usize = 2048;
const AUDIO_INPUT_FREQUENCY_MIN_HZ: f32 = 90.0;
const AUDIO_INPUT_FREQUENCY_MAX_HZ: f32 = 4200.0;
const AUDIO_INPUT_FREQUENCY_MIN_DB: f32 = -78.0;
const AUDIO_INPUT_FREQUENCY_MAX_DB: f32 = -24.0;
const AUDIO_INPUT_WAVEFORM_WINDOW_SAMPLES: usize = 768;
const AUDIO_INPUT_WAVEFORM_SAMPLE_COUNT: usize = 256;

static AGENT_COMMAND_CANDIDATE_CACHE: OnceLock<StdMutex<HashMap<&'static str, Vec<String>>>> =
    OnceLock::new();
static LOGIN_TERMINAL_CHILDREN: OnceLock<StdMutex<Vec<std::process::Child>>> = OnceLock::new();
static WHISPER_LOCAL_AUDIO_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static AUDIO_WIDGET_BOTTOM_BAR_DEBUG_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static AUDIO_WIDGET_BUBBLE_POSITION_DEBUG_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
#[cfg(target_os = "macos")]
static MAIN_WINDOW_RESTORE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static MAIN_WINDOW_MINIMIZE_REQUESTED_AT_MS: AtomicU64 = AtomicU64::new(0);
static MAIN_WINDOW_CURSOR_WATCHER_ACTIVE: AtomicBool = AtomicBool::new(false);

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
#[link(name = "kernel32")]
unsafe extern "system" {
    fn SetErrorMode(u_mode: u32) -> u32;
}

pub(crate) fn app_shutdown_requested() -> bool {
    APP_SHUTDOWN_PHASE.load(Ordering::Acquire) >= APP_SHUTDOWN_PHASE_QUIESCING
}

fn app_shutdown_phase_label_for(phase: u8) -> &'static str {
    match phase {
        APP_SHUTDOWN_PHASE_RUNNING => "running",
        APP_SHUTDOWN_PHASE_QUIESCING => "quiescing",
        APP_SHUTDOWN_PHASE_STOPPING_WATCHERS => "stopping_watchers",
        APP_SHUTDOWN_PHASE_CLOSING_TERMINALS => "closing_terminals",
        APP_SHUTDOWN_PHASE_STOPPING_DAEMONS => "stopping_daemons",
        APP_SHUTDOWN_PHASE_EXITING => "exiting",
        _ => "unknown",
    }
}

pub(crate) fn app_shutdown_phase_label() -> &'static str {
    app_shutdown_phase_label_for(APP_SHUTDOWN_PHASE.load(Ordering::Acquire))
}

pub(crate) fn app_shutdown_blocked_message(operation: &str) -> String {
    format!(
        "{operation} skipped because Diff Forge is shutting down ({})",
        app_shutdown_phase_label()
    )
}

fn emit_app_shutdown_progress(
    app: &AppHandle,
    phase: &str,
    label: &str,
    detail: &str,
    step: u8,
    terminal_closed: Option<usize>,
    terminal_total: Option<usize>,
) {
    let _ = app.emit(
        APP_SHUTDOWN_PROGRESS_EVENT,
        AppShutdownProgressPayload {
            phase: phase.to_string(),
            label: label.to_string(),
            detail: detail.to_string(),
            step,
            total_steps: APP_SHUTDOWN_TOTAL_STEPS,
            terminal_closed,
            terminal_total,
        },
    );
}

pub(crate) fn ensure_app_not_shutting_down(operation: &str) -> Result<(), String> {
    if app_shutdown_requested() {
        Err(app_shutdown_blocked_message(operation))
    } else {
        Ok(())
    }
}

fn begin_app_shutdown() -> bool {
    let changed = APP_SHUTDOWN_PHASE
        .compare_exchange(
            APP_SHUTDOWN_PHASE_RUNNING,
            APP_SHUTDOWN_PHASE_QUIESCING,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_ok();
    if changed {
        log_terminal_crash_forensics_event(
            "backend.app_shutdown.phase",
            json!({
                "phase": app_shutdown_phase_label_for(APP_SHUTDOWN_PHASE_QUIESCING),
            }),
        );
    }
    changed
}

fn advance_app_shutdown_phase(phase: u8) {
    loop {
        let current = APP_SHUTDOWN_PHASE.load(Ordering::Acquire);
        if current >= phase {
            return;
        }

        if APP_SHUTDOWN_PHASE
            .compare_exchange(current, phase, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            log_terminal_crash_forensics_event(
                "backend.app_shutdown.phase",
                json!({
                    "from": app_shutdown_phase_label_for(current),
                    "phase": app_shutdown_phase_label_for(phase),
                }),
            );
            return;
        }
    }
}

#[cfg(windows)]
fn configure_windows_process_error_mode() {
    const SEM_FAILCRITICALERRORS: u32 = 0x0001;
    const SEM_NOGPFAULTERRORBOX: u32 = 0x0002;
    const SEM_NOOPENFILEERRORBOX: u32 = 0x8000;

    unsafe {
        SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);
    }
}

#[cfg(not(windows))]
fn configure_windows_process_error_mode() {}

#[derive(Clone)]
struct TerminalWorkspaceTopologySnapshot {
    mounts: Vec<WorkspaceProjectMount>,
    scanned_ms: u64,
}

struct TerminalState {
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    terminal_input_queues: Arc<StdMutex<HashMap<String, TerminalInputQueueHandle>>>,
    terminal_input_transport: Arc<StdMutex<Option<TerminalInputTransportEndpoint>>>,
    terminal_output_transport: Arc<StdMutex<Option<TerminalOutputTransportEndpoint>>>,
    terminal_activity_transport: Arc<StdMutex<Option<TerminalActivityTransportEndpoint>>>,
    terminal_activity_transport_tokens: Arc<StdMutex<HashMap<String, String>>>,
    terminal_output_transport_subscribers:
        Arc<StdMutex<HashMap<String, Vec<TerminalOutputTransportSubscriber>>>>,
    parked_prompts: Arc<RwLock<HashMap<String, TerminalParkedPrompt>>>,
    active_audio_input_target: Arc<StdMutex<Option<TerminalAudioInputTarget>>>,
    audio_route_gate: Arc<StdMutex<TerminalAudioRouteGate>>,
    lifecycle_lock: Arc<Mutex<()>>,
    pty_pool: Arc<PtyPool>,
    cleanup_tracker: Arc<TerminalCleanupTracker>,
    workspace_topology_cache: Arc<RwLock<HashMap<String, TerminalWorkspaceTopologySnapshot>>>,
    next_terminal_instance_id: AtomicU64,
    next_terminal_input_queue_id: AtomicU64,
    next_terminal_output_subscriber_id: AtomicU64,
}

#[derive(Clone)]
struct TerminalInputQueueHandle {
    id: u64,
    sender: mpsc::Sender<TerminalInputQueueItem>,
}

struct TerminalInputQueueItem {
    payload: TerminalInputEventPayload,
    ack: Option<oneshot::Sender<Result<(), String>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalInputTransportEndpoint {
    url: String,
    token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalInputTransportEnvelope {
    token: String,
    message_id: Option<String>,
    payload: TerminalInputEventPayload,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalInputTransportAck {
    r#type: &'static str,
    message_id: String,
    ok: bool,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputTransportEndpoint {
    url: String,
    token: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalActivityTransportEndpoint {
    host: String,
    port: u16,
    token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalActivityTransportEnvelope {
    r#type: String,
    token: String,
    event: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalActivityTransportAck {
    r#type: &'static str,
    ok: bool,
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputTransportSubscribe {
    r#type: String,
    token: String,
    id: Option<String>,
    pane_id: String,
    instance_id: u64,
}

#[derive(Clone)]
struct TerminalOutputTransportSubscriber {
    id: u64,
    sender: mpsc::UnboundedSender<Vec<u8>>,
}

struct TerminalCleanupTracker {
    active: AtomicUsize,
}

struct TerminalCleanupGuard {
    tracker: Arc<TerminalCleanupTracker>,
    reason: &'static str,
    instance_id: Option<u64>,
}

struct TerminalDiagnosticState {
    enabled: AtomicBool,
}

struct WindowsTerminalDiagnosticState {
    enabled: AtomicBool,
}

impl TerminalDiagnosticState {
    fn new() -> Self {
        Self {
            enabled: AtomicBool::new(TERMINAL_DIAGNOSTIC_LOGGING_ENABLED),
        }
    }

    fn is_enabled(&self) -> bool {
        TERMINAL_DIAGNOSTIC_LOGGING_ENABLED
            || (TERMINAL_DIAGNOSTIC_RUNTIME_ENABLE_ALLOWED && self.enabled.load(Ordering::Relaxed))
    }
}

impl WindowsTerminalDiagnosticState {
    fn new() -> Self {
        Self {
            enabled: AtomicBool::new(WINDOWS_TERMINAL_DIAGNOSTIC_LOGGING_ENABLED),
        }
    }

    fn is_enabled(&self) -> bool {
        WINDOWS_TERMINAL_DIAGNOSTIC_LOGGING_ENABLED
            || (WINDOWS_TERMINAL_DIAGNOSTIC_RUNTIME_ENABLE_ALLOWED
                && self.enabled.load(Ordering::Relaxed))
    }
}

impl TerminalCleanupTracker {
    fn new() -> Self {
        Self {
            active: AtomicUsize::new(0),
        }
    }

    fn active(&self) -> usize {
        self.active.load(Ordering::Acquire)
    }

    fn begin(
        self: &Arc<Self>,
        reason: &'static str,
        instance_id: Option<u64>,
    ) -> TerminalCleanupGuard {
        let active = self.active.fetch_add(1, Ordering::AcqRel) + 1;
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup_tracker.begin",
            json!({
                "active": active,
                "instance_id": instance_id,
                "reason": reason,
            }),
        );

        TerminalCleanupGuard {
            tracker: Arc::clone(self),
            reason,
            instance_id,
        }
    }

    fn wait_for_idle(&self, reason: &'static str, timeout: Duration) -> bool {
        let started_at = Instant::now();
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup_tracker.wait.begin",
            json!({
                "active": self.active(),
                "reason": reason,
                "timeout_ms": timeout.as_millis(),
            }),
        );

        loop {
            let active = self.active();

            if active == 0 {
                log_terminal_crash_forensics_event(
                    "backend.terminal_cleanup_tracker.wait.done",
                    json!({
                        "active": active,
                        "elapsed_ms": terminal_diagnostic_elapsed_ms(started_at),
                        "reason": reason,
                        "timed_out": false,
                    }),
                );
                return true;
            }

            if started_at.elapsed() >= timeout {
                log_terminal_crash_forensics_event(
                    "backend.terminal_cleanup_tracker.wait.done",
                    json!({
                        "active": active,
                        "elapsed_ms": terminal_diagnostic_elapsed_ms(started_at),
                        "reason": reason,
                        "timed_out": true,
                    }),
                );
                return false;
            }

            thread::sleep(Duration::from_millis(TERMINAL_SHUTDOWN_POLL_INTERVAL_MS));
        }
    }

    async fn wait_for_idle_async(&self, reason: &'static str, timeout: Duration) -> bool {
        let started_at = Instant::now();
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup_tracker.wait.begin",
            json!({
                "active": self.active(),
                "reason": reason,
                "timeout_ms": timeout.as_millis(),
            }),
        );

        loop {
            let active = self.active();

            if active == 0 {
                log_terminal_crash_forensics_event(
                    "backend.terminal_cleanup_tracker.wait.done",
                    json!({
                        "active": active,
                        "elapsed_ms": terminal_diagnostic_elapsed_ms(started_at),
                        "reason": reason,
                        "timed_out": false,
                    }),
                );
                return true;
            }

            if started_at.elapsed() >= timeout {
                log_terminal_crash_forensics_event(
                    "backend.terminal_cleanup_tracker.wait.done",
                    json!({
                        "active": active,
                        "elapsed_ms": terminal_diagnostic_elapsed_ms(started_at),
                        "reason": reason,
                        "timed_out": true,
                    }),
                );
                return false;
            }

            sleep(Duration::from_millis(TERMINAL_SHUTDOWN_POLL_INTERVAL_MS)).await;
        }
    }
}

impl Drop for TerminalCleanupGuard {
    fn drop(&mut self) {
        let active = self
            .tracker
            .active
            .fetch_sub(1, Ordering::AcqRel)
            .saturating_sub(1);
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup_tracker.done",
            json!({
                "active": active,
                "instance_id": self.instance_id,
                "reason": self.reason,
            }),
        );
    }
}

impl Drop for TerminalState {
    fn drop(&mut self) {
        let _ = begin_app_shutdown();
        advance_app_shutdown_phase(APP_SHUTDOWN_PHASE_STOPPING_WATCHERS);
        let _ = coordination::watcher::stop_all_file_watchers("terminal_state_drop");
        advance_app_shutdown_phase(APP_SHUTDOWN_PHASE_CLOSING_TERMINALS);

        let instances = match self.terminals.try_write() {
            Ok(mut terminals) => terminals
                .drain()
                .collect::<Vec<(String, TerminalInstance)>>(),
            Err(_) => Vec::new(),
        };
        if let Ok(mut queues) = self.terminal_input_queues.lock() {
            queues.clear();
        }
        if let Ok(mut transport) = self.terminal_input_transport.lock() {
            *transport = None;
        }
        if let Ok(mut transport) = self.terminal_output_transport.lock() {
            *transport = None;
        }
        if let Ok(mut transport) = self.terminal_activity_transport.lock() {
            *transport = None;
        }
        if let Ok(mut tokens) = self.terminal_activity_transport_tokens.lock() {
            tokens.clear();
        }
        if let Ok(mut subscribers) = self.terminal_output_transport_subscribers.lock() {
            subscribers.clear();
        }
        let warm_ptys = self.pty_pool.drain_for_shutdown();

        for (_, instance) in instances {
            cleanup_terminal_instance_with_context(
                instance,
                true,
                "drop_fallback",
                TerminalCoordinationCleanupMode::InterruptAfterProcess,
            );
        }

        for warm_pty in warm_ptys {
            cleanup_warm_pty_with_context(warm_pty);
        }

        self.pty_pool.wait_for_refill_idle();
        self.cleanup_tracker.wait_for_idle(
            "terminal_state_drop",
            Duration::from_millis(TERMINAL_DROP_CLEANUP_TRACKER_WAIT_MS),
        );
        cleanup_login_terminal_children();
        cleanup_windows_headless_console_hosts();
    }
}

#[derive(Clone)]
struct TerminalAudioInputTarget {
    pane_id: String,
    instance_id: Option<u64>,
}

/// Webview-reported gate for routing dictation into the selected terminal.
/// The main window keeps this current from tab visibility and DOM focus:
/// the terminal route is only allowed while the Terminals tab is visible and
/// no non-terminal editable element holds focus, so speech follows what the
/// user is actually looking at instead of the sticky pane selection.
#[derive(Clone)]
struct TerminalAudioRouteGate {
    allow_terminal: bool,
}

impl Default for TerminalAudioRouteGate {
    fn default() -> Self {
        // Allow by default so dictation keeps working if a webview build
        // that does not report the gate is running.
        Self {
            allow_terminal: true,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalAudioInputRefocusPayload {
    pane_id: String,
    instance_id: Option<u64>,
    inserted_text: Option<String>,
}

#[derive(Clone)]
struct AudioState {
    download_lock: Arc<Mutex<()>>,
    cloud_voice_agent_stream: Arc<Mutex<Option<CloudVoiceAgentSession>>>,
    deepgram_stream: Arc<Mutex<Option<DeepgramRealtimeSession>>>,
    forge_dictation_stream: Arc<Mutex<Option<ForgeDictationSession>>>,
    // User intent for the cloud voice agent mic feed. The websocket/session
    // can stay alive while this is false; dictation release respects it.
    cloud_voice_agent_input_enabled: Arc<AtomicBool>,
    // True while an active dictation session has borrowed the microphone from
    // a live cloud voice agent session; dictation teardown hands it back.
    forge_dictation_mic_borrowed: Arc<AtomicBool>,
    // Same lender/borrower contract for the user's own-key Deepgram dictation
    // stream (a fully separate websocket straight to Deepgram).
    deepgram_mic_borrowed: Arc<AtomicBool>,
    forge_dictation_warm: Arc<Mutex<Option<ForgeDictationWarmSlot>>>,
    forge_dictation_warm_desired: Arc<AtomicBool>,
    forge_dictation_warm_generation: Arc<AtomicU64>,
    input_worker: NativeAudioWorker,
    realtime_stream_lock: Arc<Mutex<()>>,
    // Who currently owns the single realtime microphone outlet. Teardown
    // paths only detach when they still own it, so one consumer releasing
    // never rips the stream away from another (mic arbitration).
    realtime_mic_holder: Arc<StdMutex<RealtimeMicHolder>>,
    shortcut_manager: AudioShortcutManager,
    whisper_cancel_token: Arc<AtomicU64>,
    whisper_engine: WhisperCliWarmCache,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum RealtimeMicHolder {
    None,
    VoiceAgent,
    Dictation,
    Deepgram,
}

struct CloudVoiceAgentSession {
    // Kept so mic arbitration can re-attach the agent's audio feed after a
    // dictation session that borrowed the microphone finishes.
    audio_tx: mpsc::UnboundedSender<Vec<u8>>,
    client_session_id: String,
    control_tx: mpsc::UnboundedSender<CloudVoiceAgentControl>,
    finished_rx: oneshot::Receiver<Result<(), String>>,
    owner_id: String,
    voice_session_id: String,
}

enum CloudVoiceAgentControl {
    FinishInput,
    Stop,
}

struct DeepgramRealtimeSession {
    finished_rx: oneshot::Receiver<Result<WhisperTranscriptionResult, String>>,
    stream_task: tauri::async_runtime::JoinHandle<()>,
}

struct ForgeDictationSession {
    control_tx: mpsc::UnboundedSender<ForgeDictationControl>,
    finished_rx: oneshot::Receiver<Result<ForgeDictationResult, String>>,
    stream_task: tauri::async_runtime::JoinHandle<()>,
}

enum ForgeDictationControl {
    Finish,
    Cancel,
}

type ForgeDictationWsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>;

/// A parked, pre-authenticated cloud dictation websocket kept alive with
/// keepalive pings so press-to-talk skips the connect handshake. Claiming
/// sends a reply channel to the warm keeper task, which hands the live
/// stream back (or `None` if the parked socket died).
struct ForgeDictationWarmSlot {
    claim_tx: oneshot::Sender<oneshot::Sender<Option<ForgeDictationWsStream>>>,
}

#[derive(Clone)]
struct TerminalRuntimeSnapshot {
    status: String,
    activity_status: String,
    command_phase: String,
    input_ready: bool,
    input_ready_at: Option<String>,
    prompt_ready_at: Option<String>,
    completed_at: Option<String>,
    provider_session_id: Option<String>,
    native_session_id: Option<String>,
    fork_from_provider_session_id: Option<String>,
    provider_turn_id: Option<String>,
    turn_id: Option<String>,
    source: String,
    event_type: String,
    hook_event_name: String,
    updated_at_ms: u64,
}

impl TerminalRuntimeSnapshot {
    fn opened_with_state(
        provider_session_id: Option<String>,
        source: &str,
        status: &str,
        activity_status: &str,
        command_phase: &str,
        input_ready: bool,
    ) -> Self {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
            .unwrap_or(0);
        let now = crate::coordination::kernel::now_rfc3339();
        let native_session_id = provider_session_id.clone();
        Self {
            status: status.to_string(),
            activity_status: activity_status.to_string(),
            command_phase: command_phase.to_string(),
            input_ready,
            input_ready_at: input_ready.then_some(now.clone()),
            prompt_ready_at: input_ready.then_some(now),
            completed_at: None,
            provider_session_id,
            native_session_id,
            fork_from_provider_session_id: None,
            provider_turn_id: None,
            turn_id: None,
            source: source.to_string(),
            event_type: "opened".to_string(),
            hook_event_name: "TerminalOpen".to_string(),
            updated_at_ms: now_ms,
        }
    }

    fn opened_idle(provider_session_id: Option<String>) -> Self {
        Self::opened_with_state(
            provider_session_id,
            "terminal-open",
            "active",
            "idle",
            "ready",
            true,
        )
    }

    fn opened_starting(provider_session_id: Option<String>, source: &str) -> Self {
        Self::opened_with_state(
            provider_session_id,
            source,
            "starting",
            "starting",
            "starting",
            false,
        )
    }
}

#[derive(Clone)]
struct TerminalInstance {
    id: u64,
    child: Arc<Mutex<Option<Box<dyn Child + Send>>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    size: Arc<Mutex<PtySize>>,
    headless_output: Arc<StdMutex<TerminalHeadlessOutputBuffer>>,
    working_directory: Arc<PathBuf>,
    agent_started: Arc<Mutex<bool>>,
    input_gate: Arc<Mutex<TerminalInputGate>>,
    input_queue: Arc<Mutex<()>>,
    active_task: Arc<Mutex<Option<TerminalActiveTask>>>,
    coordination: Option<TerminalCoordinationSession>,
    session_mode: TerminalSessionMode,
    metadata: TerminalInstanceMetadata,
    runtime: Arc<StdMutex<TerminalRuntimeSnapshot>>,
    // Whether this pane was opened with the app-control orchestrator MCP. Kept
    // so deferred/resume agent starts can re-inject app-control (and its
    // auto-approval) the same way the initial open does.
    app_control_mcp_requested: bool,
}

#[derive(Default)]
struct TerminalHeadlessOutputBuffer {
    epoch: u64,
    total_bytes: u64,
    tail: VecDeque<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalHeadlessOutputSnapshot {
    bytes_base64: String,
    epoch: u64,
    instance_id: u64,
    pane_id: String,
    tail_bytes: usize,
    total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalHeadlessOutputDelta {
    bytes_base64: String,
    epoch: u64,
    from_total_bytes: u64,
    instance_id: u64,
    pane_id: String,
    tail_bytes: usize,
    total_bytes: u64,
    truncated: bool,
}

impl TerminalHeadlessOutputBuffer {
    fn append(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }

        self.epoch = self.epoch.saturating_add(1);
        self.total_bytes = self.total_bytes.saturating_add(data.len() as u64);
        if data.len() >= TERMINAL_HEADLESS_OUTPUT_TAIL_BYTES {
            self.tail.clear();
            self.tail.extend(
                data[data.len() - TERMINAL_HEADLESS_OUTPUT_TAIL_BYTES..]
                    .iter()
                    .copied(),
            );
            return;
        }

        self.tail.extend(data.iter().copied());
        let overflow = self
            .tail
            .len()
            .saturating_sub(TERMINAL_HEADLESS_OUTPUT_TAIL_BYTES);
        if overflow > 0 {
            self.tail.drain(..overflow);
        }
    }

    fn snapshot(&self, pane_id: &str, instance_id: u64) -> TerminalHeadlessOutputSnapshot {
        let bytes = self.tail.iter().copied().collect::<Vec<_>>();
        TerminalHeadlessOutputSnapshot {
            bytes_base64: general_purpose::STANDARD.encode(bytes),
            epoch: self.epoch,
            instance_id,
            pane_id: pane_id.to_string(),
            tail_bytes: self.tail.len(),
            total_bytes: self.total_bytes,
        }
    }

    fn delta_since(
        &self,
        pane_id: &str,
        instance_id: u64,
        since_total_bytes: u64,
    ) -> TerminalHeadlessOutputDelta {
        let tail_start_total_bytes = self.total_bytes.saturating_sub(self.tail.len() as u64);
        let truncated = since_total_bytes < tail_start_total_bytes;
        let from_total_bytes = if truncated {
            tail_start_total_bytes
        } else {
            since_total_bytes.min(self.total_bytes)
        };
        let start_index = from_total_bytes
            .saturating_sub(tail_start_total_bytes)
            .min(self.tail.len() as u64) as usize;
        let bytes = self
            .tail
            .iter()
            .skip(start_index)
            .copied()
            .collect::<Vec<_>>();
        TerminalHeadlessOutputDelta {
            bytes_base64: general_purpose::STANDARD.encode(bytes),
            epoch: self.epoch,
            from_total_bytes,
            instance_id,
            pane_id: pane_id.to_string(),
            tail_bytes: self.tail.len(),
            total_bytes: self.total_bytes,
            truncated,
        }
    }
}

#[derive(Clone)]
struct TerminalInstanceMetadata {
    pane_id: String,
    workspace_id: String,
    workspace_name: String,
    terminal_index: Option<u16>,
    thread_id: String,
    agent_id: String,
    agent_kind: String,
    terminal_name: String,
    terminal_nickname: String,
}

impl Default for TerminalInstanceMetadata {
    fn default() -> Self {
        Self {
            pane_id: String::new(),
            workspace_id: String::new(),
            workspace_name: String::new(),
            terminal_index: None,
            thread_id: String::new(),
            agent_id: String::new(),
            agent_kind: String::new(),
            terminal_name: String::new(),
            terminal_nickname: String::new(),
        }
    }
}

#[derive(Clone)]
struct TerminalCloudMcpCloseContext {
    working_directory: Arc<PathBuf>,
    active_task: Arc<Mutex<Option<TerminalActiveTask>>>,
    coordination: Option<TerminalCoordinationSession>,
    session_mode: TerminalSessionMode,
    metadata: TerminalInstanceMetadata,
}

impl TerminalCloudMcpCloseContext {
    fn from_instance(instance: &TerminalInstance) -> Self {
        Self {
            working_directory: Arc::clone(&instance.working_directory),
            active_task: Arc::clone(&instance.active_task),
            coordination: instance.coordination.clone(),
            session_mode: instance.session_mode,
            metadata: instance.metadata.clone(),
        }
    }
}

#[derive(Clone)]
struct TerminalCoordinationSession {
    repo_path: String,
    db_path: String,
    mcp_command: String,
    agent_id: String,
    agent_kind: String,
    session_id: String,
    terminal_launch_epoch: Option<String>,
    env_vars: Vec<(String, String)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TerminalSessionMode {
    General,
    ManagedPatch,
    DirectEdit,
    Activity,
    Free,
    RemoteOps,
}

impl TerminalSessionMode {
    fn as_str(self) -> &'static str {
        match self {
            TerminalSessionMode::General => "general",
            TerminalSessionMode::ManagedPatch => "managed_patch",
            TerminalSessionMode::DirectEdit => "direct_edit",
            TerminalSessionMode::Activity => "activity",
            TerminalSessionMode::Free => "free",
            TerminalSessionMode::RemoteOps => "remote_ops",
        }
    }

    fn file_authority(self) -> &'static str {
        match self {
            TerminalSessionMode::General => "task_scoped",
            TerminalSessionMode::ManagedPatch => "git_worktree_patch",
            TerminalSessionMode::DirectEdit => "bounded_direct_edit",
            TerminalSessionMode::Activity => "none",
            TerminalSessionMode::Free => "external_unmanaged",
            TerminalSessionMode::RemoteOps => "remote_unmanaged",
        }
    }

    fn completion_mode(self) -> &'static str {
        match self {
            TerminalSessionMode::General
            | TerminalSessionMode::DirectEdit
            | TerminalSessionMode::Activity
            | TerminalSessionMode::Free
            | TerminalSessionMode::RemoteOps => "complete_task",
            TerminalSessionMode::ManagedPatch => "submit_patch",
        }
    }

    fn should_prepare_coordination(self) -> bool {
        !matches!(self, TerminalSessionMode::Free)
    }

    fn requires_managed_patch_worktree(self) -> bool {
        matches!(self, TerminalSessionMode::ManagedPatch)
    }

    fn from_request(
        value: Option<&str>,
        default_mode: TerminalSessionMode,
    ) -> Result<Self, String> {
        let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
            return Ok(default_mode);
        };

        match value.to_ascii_lowercase().replace('-', "_").as_str() {
            "general" | "worker" | "general_worker" | "task_scoped" => {
                Ok(TerminalSessionMode::General)
            }
            "managed" | "managed_patch" | "patch" | "patch_mode" | "worktree" => {
                Ok(TerminalSessionMode::ManagedPatch)
            }
            "direct" | "direct_edit" | "direct_project" => Ok(TerminalSessionMode::DirectEdit),
            "activity" | "activity_mode" => Ok(TerminalSessionMode::Activity),
            "free" | "free_terminal" | "unmanaged" => Ok(TerminalSessionMode::Free),
            "remote" | "remote_ops" | "ssh" => Ok(TerminalSessionMode::RemoteOps),
            _ => Err("Terminal session mode must be one of general, managed_patch, direct_edit, activity, free, or remote_ops.".to_string()),
        }
    }
}

#[derive(Clone)]
struct TerminalActiveTask {
    task_id: String,
    title: String,
}

#[derive(Clone)]
struct TerminalParkedPrompt {
    pane_id: String,
    instance_id: u64,
    task_id: String,
    title: String,
    prompt: String,
    waiting_on: Vec<TerminalParkedWaitingOn>,
    voice_plan_prompt: Option<CloudMcpVoicePlanPromptMetadata>,
    coordination: TerminalCoordinationSession,
    working_directory: PathBuf,
    resume_claimed: bool,
}

#[derive(Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct TerminalParkedWaitingOn {
    agent_id: Option<String>,
    agent_label: Option<String>,
    slot_key: Option<String>,
    task_id: Option<String>,
    task_title: Option<String>,
    resource_key: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalParkedPromptPayload {
    pane_id: String,
    instance_id: u64,
    task_id: String,
    title: String,
    status: String,
    waiting_on: Vec<TerminalParkedWaitingOn>,
    reason: Option<String>,
    prompt_event_id: Option<String>,
    prompt_event_source: Option<String>,
    terminal_index: Option<u16>,
    thread_id: Option<String>,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
}

#[derive(Clone, Default)]
struct TerminalInputGate {
    current_line: String,
    current_line_user_touched: bool,
    ansi_escape_active: bool,
    ansi_csi_active: bool,
    ansi_csi_buffer: String,
    ansi_osc_active: bool,
    ansi_osc_escape_pending: bool,
    ansi_ss3_active: bool,
    cursor_position: usize,
}

impl TerminalInstance {
    fn from_warm_shell(
        id: u64,
        warm_pty: WarmPty,
        working_directory: PathBuf,
        agent_started: bool,
        coordination: Option<TerminalCoordinationSession>,
        session_mode: TerminalSessionMode,
        metadata: TerminalInstanceMetadata,
        app_control_mcp_requested: bool,
    ) -> (Self, Box<dyn Read + Send>) {
        let WarmPty {
            child,
            master,
            writer,
            reader,
            size,
        } = warm_pty;

        let initial_runtime = if cloud_mcp_agent_uses_activity_hooks(&metadata.agent_id)
            || cloud_mcp_agent_uses_activity_hooks(&metadata.agent_kind)
        {
            TerminalRuntimeSnapshot::opened_starting(None, "terminal-created")
        } else {
            TerminalRuntimeSnapshot::opened_idle(None)
        };

        (
            Self {
                id,
                child: Arc::new(Mutex::new(Some(child))),
                master: Arc::new(Mutex::new(master)),
                writer: Arc::new(Mutex::new(writer)),
                size: Arc::new(Mutex::new(size)),
                headless_output: Arc::new(StdMutex::new(TerminalHeadlessOutputBuffer::default())),
                working_directory: Arc::new(working_directory),
                agent_started: Arc::new(Mutex::new(agent_started)),
                input_gate: Arc::new(Mutex::new(TerminalInputGate::default())),
                input_queue: Arc::new(Mutex::new(())),
                active_task: Arc::new(Mutex::new(None)),
                coordination,
                session_mode,
                metadata,
                runtime: Arc::new(StdMutex::new(initial_runtime)),
                app_control_mcp_requested,
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
        if self.shutting_down.load(Ordering::Acquire) || app_shutdown_requested() {
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
            if self.shutting_down.load(Ordering::Acquire) || app_shutdown_requested() {
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

            match create_warm_shell_pty(size) {
                Ok(warm_pty) => {
                    let mut should_cleanup = None;

                    if let Ok(mut warm) = self.warm.lock() {
                        if !self.shutting_down.load(Ordering::Acquire)
                            && warm.len() < TERMINAL_PTY_POOL_TARGET
                        {
                            warm.push(warm_pty);
                        } else {
                            should_cleanup = Some(warm_pty);
                        }
                    } else {
                        should_cleanup = Some(warm_pty);
                    }

                    if let Some(warm_pty) = should_cleanup {
                        cleanup_warm_pty_with_context(warm_pty);
                        break;
                    }
                }
                Err(_) => {
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
            cleanup_warm_pty_with_context(warm_pty);
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

#[derive(Clone, Copy)]
enum AgentProvider {
    Codex,
    Claude,
    OpenCode,
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
    image_input_supported: bool,
    image_input_support: &'static str,
    image_input_reason: String,
    active_model: String,
    active_model_supports_images: bool,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentThreadTurnResult {
    agent_id: String,
    label: String,
    model: String,
    output: String,
    provider_session_id: String,
    requested_provider_session_id: String,
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
struct AgentThreadTurnRequest {
    agent_id: String,
    provider_session_id: Option<String>,
    prompt: String,
    model: Option<String>,
    working_directory: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForgePromptImage {
    name: String,
    mime_type: String,
    data_url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentImageInputStatus {
    supported: bool,
    support: &'static str,
    reason: String,
    active_model: String,
    active_model_supports_images: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TodoTextAttachmentRequest {
    title: Option<String>,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedTodoImageAttachment {
    name: String,
    mime_type: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedTodoTextAttachment {
    line_count: usize,
    path: String,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ForgeWorkingDirectory {
    working_directory: String,
    root_identity: String,
    empty_directory: bool,
    git_repository: bool,
    workspace_kind: String,
    active_project_root: Option<String>,
    project_mounts: Vec<WorkspaceProjectMount>,
    workspace_mounts: Vec<WorkspaceProjectMount>,
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
    project_root: Option<String>,
    project_relative_path: Option<String>,
    mount_id: Option<String>,
    is_project_mount: bool,
    has_agents: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDirectoryListing {
    root: String,
    relative_path: String,
    entries: Vec<WorkspaceDirectoryEntry>,
    truncated: bool,
    workspace_kind: String,
    active_project_root: Option<String>,
    project_mounts: Vec<WorkspaceProjectMount>,
    workspace_mounts: Vec<WorkspaceProjectMount>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceRootBrowse {
    working_directory: String,
    root_identity: String,
    parent_directory: Option<String>,
    directories: Vec<String>,
    truncated: bool,
    empty_directory: bool,
    git_repository: bool,
    root_eligible: bool,
    root_rejection_reason: Option<String>,
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
    project_root: Option<String>,
    project_relative_path: Option<String>,
    mount_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileImage {
    root: String,
    relative_path: String,
    name: String,
    data_url: String,
    mime_type: String,
    size: u64,
    modified_ms: Option<u64>,
    git_status: Option<String>,
    project_root: Option<String>,
    project_relative_path: Option<String>,
    mount_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileDiff {
    root: String,
    relative_path: String,
    diff: String,
    truncated: bool,
    project_root: Option<String>,
    project_relative_path: Option<String>,
    mount_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileOperationResult {
    root: String,
    relative_path: String,
    target_relative_path: Option<String>,
    parent_relative_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOpenRequest {
    pane_id: String,
    instance_id: Option<u64>,
    kind: String,
    agent_id: Option<String>,
    agent_kind: Option<String>,
    provider: Option<String>,
    provider_session_id: Option<String>,
    fork_from_provider_session_id: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    speed: Option<String>,
    permission_mode: Option<String>,
    plain_shell: Option<bool>,
    fresh_session: Option<bool>,
    preserve_coordination_session: Option<bool>,
    session_mode: Option<String>,
    slot_key: Option<String>,
    terminal_index: Option<u16>,
    thread_id: Option<String>,
    working_directory: Option<String>,
    workspace_root_was_empty_at_selection: Option<bool>,
    project_root: Option<String>,
    mount_id: Option<String>,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    terminal_name: Option<String>,
    terminal_nickname: Option<String>,
    app_control_mcp: Option<bool>,
    cols: Option<u16>,
    rows: Option<u16>,
    output_transport: Option<bool>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalStartAgentRequest {
    pane_id: String,
    instance_id: Option<u64>,
    provider: String,
    provider_session_id: Option<String>,
    fork_from_provider_session_id: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    speed: Option<String>,
    permission_mode: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalStartAgentPaneResult {
    pane_id: String,
    instance_id: Option<u64>,
    model: Option<String>,
    model_source: Option<String>,
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
    project_root: String,
    agent_id: Option<String>,
    session_id: Option<String>,
    agent_branch_root: Option<String>,
    agent_branch: Option<String>,
    slot_key: Option<String>,
    thread_id: Option<String>,
    coordination_mode: Option<String>,
    session_mode: String,
    file_authority: String,
    provider_session_id: Option<String>,
    native_session_id: Option<String>,
    fork_from_provider_session_id: Option<String>,
    shared_history_id: Option<String>,
    requested_provider_session_id: Option<String>,
    model: Option<String>,
    model_source: Option<String>,
    reasoning_effort: Option<String>,
    speed: Option<String>,
    activity_status: String,
    command_phase: String,
    input_ready: bool,
    input_ready_at: Option<String>,
    terminal_work_state: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalProviderSessionRecordRequest {
    pane_id: String,
    instance_id: Option<u64>,
    provider_session_id: String,
    source: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalProviderSessionRecordResult {
    pane_id: String,
    instance_id: u64,
    provider_session_id: String,
    recorded: bool,
    source: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
    pane_id: String,
    instance_id: u64,
    exit_code: Option<i32>,
    exited_at_ms: u64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalInputEventPayload {
    pane_id: String,
    instance_id: Option<u64>,
    data: String,
    app_fork_enabled: Option<bool>,
    prompt_event_id: Option<String>,
    prompt_event_revision: Option<u64>,
    prompt_event_source: Option<String>,
    prompt_event_submitted_at: Option<String>,
    prompt_event_text: Option<String>,
    todo_id: Option<String>,
    todo_dispatch_id: Option<String>,
    todo_command_id: Option<String>,
    todo_action: Option<String>,
    todo_resume_requested: Option<bool>,
    thread_id: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalForkRequestedPayload {
    pane_id: String,
    instance_id: u64,
    workspace_id: String,
    terminal_index: Option<u16>,
    thread_id: String,
    agent_id: String,
    agent_kind: String,
    provider_session_id: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalInputErrorPayload {
    pane_id: String,
    instance_id: Option<u64>,
    message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalPromptSubmittedPayload {
    pane_id: String,
    instance_id: u64,
    workspace_id: String,
    workspace_name: String,
    terminal_index: Option<u16>,
    thread_id: String,
    agent_id: String,
    agent_kind: String,
    prompt_event_id: Option<String>,
    prompt_event_revision: Option<u64>,
    prompt_event_source: Option<String>,
    prompt_event_submitted_at: Option<String>,
    todo_id: Option<String>,
    todo_dispatch_id: Option<String>,
    todo_command_id: Option<String>,
    todo_action: Option<String>,
    todo_resume_requested: bool,
    /// When a direct prompt was captured as a Rust todo, the item id every
    /// other surface (webview item, journal, receipts, cloud row) must reuse.
    direct_todo_item_id: Option<String>,
    expected_prompt: Option<String>,
    observed_prompt: Option<String>,
    prompt_match: bool,
    prompt_source: String,
    prompt: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalActivityHookPayload {
    pane_id: String,
    instance_id: u64,
    workspace_id: String,
    workspace_name: String,
    terminal_index: Option<u16>,
    thread_id: String,
    agent_id: String,
    agent_kind: String,
    agent_type: String,
    agent_display_name: String,
    display_name: String,
    terminal_name: String,
    terminal_nickname: String,
    provider: String,
    event_type: String,
    hook_event_name: String,
    source: String,
    status: String,
    activity_status: String,
    command_phase: String,
    execution_phase: String,
    native_rail_state: String,
    native_rail_label: String,
    readiness: String,
    terminal_lifecycle: String,
    terminal_status: String,
    terminal_work_state: String,
    turn_status: String,
    session_state: String,
    input_ready: bool,
    input_ready_at: Option<String>,
    prompt_ready_at: Option<String>,
    completed_at: Option<String>,
    provider_session_id: Option<String>,
    native_session_id: Option<String>,
    fork_from_provider_session_id: Option<String>,
    provider_turn_id: Option<String>,
    turn_id: Option<String>,
    transcript_path: Option<String>,
    cwd: Option<String>,
    user_message: Option<String>,
    message: Option<String>,
    tool_name: Option<String>,
    tool_use_id: Option<String>,
    approval_id: Option<String>,
    permission_prompt_id: Option<String>,
    permission_request_id: Option<String>,
    permission_mode: Option<String>,
    manual_prompt_source: Option<String>,
    manual_approval_required: bool,
    provider_blocked_for_user: bool,
    terminal_is_prompting_user: bool,
    prompting_user_kind: Option<String>,
    prompting_user_source: Option<String>,
    prompting_user_confidence: Option<String>,
    prompting_user_text: Option<String>,
    hook_health_status: String,
    hook_health_event: String,
    hook_health_observed_at_ms: u64,
    hook_timestamp_ms: u64,
    observed_at_ms: u64,
    completion_evidence: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalArchitectureActivityPayload {
    pane_id: String,
    instance_id: u64,
    workspace_id: String,
    workspace_name: String,
    terminal_index: Option<u16>,
    thread_id: String,
    agent_id: String,
    agent_kind: String,
    provider: String,
    hook_event_name: String,
    tool_name: String,
    phase: String,
    repo_path: String,
    cwd: String,
    graph_file_path: String,
    graph_id: String,
    graph_title: String,
    source: String,
    observed_at_ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputStatePayload {
    pane_id: String,
    instance_id: u64,
    looks_active: bool,
    looks_ready: bool,
    status_truth: String,
    output_preview: String,
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
    workspace_id: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppShutdownProgressPayload {
    phase: String,
    label: String,
    detail: String,
    step: u8,
    total_steps: u8,
    terminal_closed: Option<usize>,
    terminal_total: Option<usize>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioInputDeviceSummary {
    device_id: String,
    label: String,
    is_default: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioInputPermissionStatus {
    platform: &'static str,
    microphone_required: bool,
    microphone_granted: bool,
    microphone_promptable: bool,
    microphone_denied: bool,
    microphone_restricted: bool,
    microphone_settings_url: &'static str,
    status: String,
    message: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioInputMonitorRequest {
    device_id: Option<String>,
    owner: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioInputMonitorStatus {
    monitoring: bool,
    device_id: String,
    label: String,
    sample_rate: u32,
    owner_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioInputStats {
    device_id: String,
    rms: f32,
    peak: f32,
    buffer_ms: u64,
    frequency_bands: Vec<f32>,
    time_domain_samples: Vec<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioInputCaptureResult {
    audio_base64: String,
    audio_ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioShortcutRegistrationStatus {
    shortcut: String,
    default_shortcut: String,
    registered: bool,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioShortcutPermissionStatus {
    platform: &'static str,
    accessibility_required: bool,
    accessibility_granted: bool,
    accessibility_settings_url: &'static str,
    quarantine_detected: bool,
    quarantine_path: String,
    quarantine_fix_command: String,
    message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioShortcutSettingsStatus {
    push_to_talk: AudioShortcutRegistrationStatus,
    cancel: AudioShortcutRegistrationStatus,
    permissions: AudioShortcutPermissionStatus,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioShortcutBindings {
    push_to_talk: String,
    cancel: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudioShortcutUpdateRequest {
    action: String,
    shortcut: String,
}

#[derive(Clone)]
struct AudioShortcutManager {
    state: Arc<StdMutex<AudioShortcutManagerState>>,
}

#[derive(Clone)]
struct AudioShortcutManagerState {
    push_to_talk: AudioShortcutRegistration,
    cancel: AudioShortcutRegistration,
}

#[derive(Clone)]
struct AudioShortcutRegistration {
    shortcut: String,
    registered: bool,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WhisperModelStatus {
    installed: bool,
    model_installed: bool,
    runtime_installed: bool,
    selected_model_id: &'static str,
    default_model_id: &'static str,
    model_id: &'static str,
    model_name: &'static str,
    model_file: &'static str,
    model_path: String,
    runtime_name: &'static str,
    runtime_package_name: &'static str,
    runtime_path: String,
    runtime_installable: bool,
    managed_runtime_installed: bool,
    managed_assets_installed: bool,
    runtime_install_hint: &'static str,
    download_url: &'static str,
    expected_sha256: &'static str,
    approximate_disk_mb: u64,
    approximate_memory_mb: u64,
    bytes: u64,
    models: Vec<WhisperModelOptionStatus>,
    shortcut: String,
    shortcuts: AudioShortcutSettingsStatus,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WhisperModelOptionStatus {
    model_id: &'static str,
    model_name: &'static str,
    model_file: &'static str,
    model_path: String,
    download_url: &'static str,
    expected_sha256: &'static str,
    approximate_disk_mb: u64,
    approximate_memory_mb: u64,
    bytes: u64,
    installed: bool,
    selected: bool,
    tier: &'static str,
    description: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WhisperModelRequest {
    model_id: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WhisperModelDownloadProgress {
    state: String,
    model_id: Option<String>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<f64>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WhisperWarmStatus {
    prepared: bool,
    cached: bool,
    model_path: String,
    elapsed_ms: u128,
    warmed_bytes: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WhisperTranscriptionRequest {
    audio_base64: String,
    audio_ms: Option<u64>,
    capture_peak: Option<f32>,
    capture_rms: Option<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WhisperTranscriptionResult {
    text: String,
    segments: usize,
    duration_ms: u128,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeepgramRealtimeStartRequest {
    api_key: String,
    language: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeepgramRealtimeStartStatus {
    active: bool,
    language: String,
    model: &'static str,
    sample_rate: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudVoiceAgentStartRequest {
    client_session_id: Option<String>,
    owner_id: Option<String>,
    repo_id: Option<String>,
    submission_mode: Option<String>,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    workspace_root: Option<String>,
    /// GPT-Realtime engine opt-in: one native speech-to-speech session on the
    /// cloud instead of the STT → LLM → TTS pipeline.
    realtime: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudVoiceAgentControlRequest {
    client_session_id: Option<String>,
    owner_id: Option<String>,
    voice_session_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudVoiceAgentTextMessageRequest {
    text: String,
    turn_index: Option<u64>,
    repo_id: Option<String>,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    workspace_root: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudVoiceAgentStartStatus {
    active: bool,
    client_session_id: String,
    owner_id: String,
    repo_id: String,
    sample_rate: u32,
    voice_session_id: String,
    workspace_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrchestratorVoiceHistoryReadRequest {
    root_directory: Option<String>,
    workspace_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OrchestratorVoiceHistoryReadResult {
    items: Value,
    path: String,
    workspace_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrchestratorVoiceHistoryWriteRequest {
    root_directory: Option<String>,
    workspace_id: String,
    items: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OrchestratorVoiceHistoryWriteResult {
    saved: usize,
    path: String,
    workspace_id: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeepgramRealtimeTranscriptEvent {
    text: String,
    is_final: bool,
    speech_final: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioWidgetVisibility {
    visible: bool,
    installed: bool,
    shortcut: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ActivityOverlayVisibility {
    visible: bool,
    shortcut: String,
}

struct PreparedPromptImages {
    directory: PathBuf,
    paths: Vec<String>,
}

include!("validation.rs");
include!("platform.rs");
include!("process.rs");
include!("backend_cpu.rs");
include!("workspace_files.rs");
include!("workspace_threads_store.rs");
include!("architectures.rs");
include!("pcb.rs");
include!("workspace_web.rs");
include!("developer_processes.rs");
include!("app_control_mcp.rs");
include!("terminal_cli.rs");
include!("tokenomics.rs");
include!("native_notifications.rs");
include!("cloud_mcp.rs");
include!("local_scripts.rs");
include!("assets.rs");
include!("agent_sessions.rs");
include!("agent_chat_sync.rs");
include!("terminals.rs");
include!("tools_window.rs");
include!("web_panel.rs");
include!("api.rs");
include!("activity_overlay.rs");
include!("todo_dispatch.rs");
include!("agent_accounts.rs");
include!("background_mode.rs");
include!("audio.rs");
include!("audio_history.rs");
include!("handsfree_audio.rs");
include!("voice_text_rules.rs");
include!("snipping.rs");

fn diagnostic_log_path(file_name: &str) -> PathBuf {
    let tauri_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = tauri_root
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(tauri_root);

    project_root.join(DIAGNOSTIC_LOG_DIR).join(file_name)
}

fn terminal_diagnostic_log_path() -> PathBuf {
    diagnostic_log_path(TERMINAL_DIAGNOSTIC_LOG_FILE)
}

fn thread_bridge_diagnostic_log_path() -> PathBuf {
    diagnostic_log_path(THREAD_BRIDGE_DIAGNOSTIC_LOG_FILE)
}

fn bigview_sync_diagnostic_log_path() -> PathBuf {
    diagnostic_log_path(BIGVIEW_SYNC_DIAGNOSTIC_LOG_FILE)
}

fn workspace_activation_diagnostic_log_path() -> PathBuf {
    diagnostic_log_path(WORKSPACE_ACTIVATION_DIAGNOSTIC_LOG_FILE)
}

fn voice_orchestrator_diagnostic_log_path() -> PathBuf {
    diagnostic_log_path(VOICE_ORCHESTRATOR_DIAGNOSTIC_LOG_FILE)
}

fn terminal_status_log_path() -> PathBuf {
    diagnostic_log_path(TERMINAL_STATUS_LOG_FILE)
}

fn terminal_crash_forensics_log_path() -> PathBuf {
    diagnostic_log_path(TERMINAL_CRASH_FORENSICS_LOG_FILE)
}

fn windows_terminal_diagnostic_log_path() -> PathBuf {
    diagnostic_log_path(WINDOWS_TERMINAL_DIAGNOSTIC_LOG_FILE)
}

fn clean_terminal_diagnostic_log_text(value: &str) -> String {
    value
        .replace(|character: char| character.is_control(), " ")
        .trim()
        .chars()
        .take(TERMINAL_DIAGNOSTIC_LOG_MAX_TEXT)
        .collect()
}

fn terminal_diagnostic_thread_label() -> String {
    let current_thread = thread::current();
    let name = current_thread.name().unwrap_or("unnamed");

    format!("{:?}:{name}", current_thread.id())
}

fn write_terminal_diagnostic_log_entry(entry: Value) {
    if !TERMINAL_DIAGNOSTIC_LOGGING_ENABLED {
        return;
    }

    let log_path = terminal_diagnostic_log_path();
    let Some(log_dir) = log_path.parent() else {
        return;
    };

    if fs::create_dir_all(log_dir).is_err() {
        return;
    }

    let lock = TERMINAL_DIAGNOSTIC_LOG_LOCK.get_or_init(|| StdMutex::new(()));
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

    let _ = writeln!(file, "{entry}");
}

fn write_thread_bridge_diagnostic_log_entry(entry: Value) {
    if !THREAD_BRIDGE_DIAGNOSTIC_LOGGING_ENABLED {
        return;
    }

    let log_path = thread_bridge_diagnostic_log_path();
    let Some(log_dir) = log_path.parent() else {
        return;
    };

    if fs::create_dir_all(log_dir).is_err() {
        return;
    }

    let lock = THREAD_BRIDGE_DIAGNOSTIC_LOG_LOCK.get_or_init(|| StdMutex::new(()));
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

    let _ = writeln!(file, "{entry}");
}

fn write_bigview_sync_diagnostic_log_entry(entry: Value) {
    if !BIGVIEW_SYNC_DIAGNOSTIC_LOGGING_ENABLED {
        return;
    }

    let log_path = bigview_sync_diagnostic_log_path();
    let Some(log_dir) = log_path.parent() else {
        return;
    };

    if fs::create_dir_all(log_dir).is_err() {
        return;
    }

    let lock = BIGVIEW_SYNC_DIAGNOSTIC_LOG_LOCK.get_or_init(|| StdMutex::new(()));
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

    let _ = writeln!(file, "{entry}");
}

fn write_workspace_activation_diagnostic_log_entries(entries: Vec<Value>) {
    if !WORKSPACE_ACTIVATION_DIAGNOSTIC_LOGGING_ENABLED || entries.is_empty() {
        return;
    }

    let log_path = workspace_activation_diagnostic_log_path();
    let Some(log_dir) = log_path.parent() else {
        return;
    };

    if fs::create_dir_all(log_dir).is_err() {
        return;
    }

    let lock = WORKSPACE_ACTIVATION_DIAGNOSTIC_LOG_LOCK.get_or_init(|| StdMutex::new(()));
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

fn write_workspace_activation_diagnostic_log_entry(entry: Value) {
    write_workspace_activation_diagnostic_log_entries(vec![entry]);
}

fn write_voice_orchestrator_diagnostic_log_entry(entry: Value) {
    if !voice_orchestrator_diagnostics_enabled() {
        return;
    }

    let log_path = voice_orchestrator_diagnostic_log_path();
    let Some(log_dir) = log_path.parent() else {
        return;
    };

    if fs::create_dir_all(log_dir).is_err() {
        return;
    }

    let lock = VOICE_ORCHESTRATOR_DIAGNOSTIC_LOG_LOCK.get_or_init(|| StdMutex::new(()));
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

    let _ = writeln!(file, "{entry}");
    let _ = file.flush();
}

fn voice_orchestrator_diagnostics_enabled() -> bool {
    if !VOICE_ORCHESTRATOR_DIAGNOSTIC_LOGGING_ENABLED {
        return false;
    }

    env::var("RUST_DIFFFORGE_VOICE_ORCHESTRATOR_LOGS")
        .or_else(|_| env::var("DIFFFORGE_VOICE_ORCHESTRATOR_LOGS"))
        .ok()
        .map(|value| {
            let value = value.trim().to_ascii_lowercase();
            !matches!(value.as_str(), "0" | "false" | "off" | "no")
        })
        .unwrap_or(true)
}

fn write_terminal_status_log_entry(entry: Value) {
    if !TERMINAL_STATUS_LOGGING_ENABLED {
        return;
    }

    let log_path = terminal_status_log_path();
    let Some(log_dir) = log_path.parent() else {
        return;
    };

    if fs::create_dir_all(log_dir).is_err() {
        return;
    }

    let lock = TERMINAL_STATUS_LOG_LOCK.get_or_init(|| StdMutex::new(()));
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

    let _ = writeln!(file, "{entry}");
}

fn write_terminal_crash_forensics_log_entry(entry: Value) {
    if !TERMINAL_CRASH_FORENSICS_LOGGING_ENABLED {
        return;
    }

    let log_path = terminal_crash_forensics_log_path();
    let Some(log_dir) = log_path.parent() else {
        return;
    };

    if fs::create_dir_all(log_dir).is_err() {
        return;
    }

    let lock = TERMINAL_CRASH_FORENSICS_LOG_LOCK.get_or_init(|| StdMutex::new(()));
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

    let _ = writeln!(file, "{entry}");
    let _ = file.flush();
    let _ = file.sync_data();
}

fn write_windows_terminal_diagnostic_log_entry(entry: Value) {
    if !WINDOWS_TERMINAL_DIAGNOSTIC_LOGGING_ENABLED {
        return;
    }

    let log_path = windows_terminal_diagnostic_log_path();
    let Some(log_dir) = log_path.parent() else {
        return;
    };

    if fs::create_dir_all(log_dir).is_err() {
        return;
    }

    let lock = WINDOWS_TERMINAL_DIAGNOSTIC_LOG_LOCK.get_or_init(|| StdMutex::new(()));
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

    let _ = writeln!(file, "{entry}");
}

fn terminal_diagnostic_elapsed_ms(started_at: Instant) -> f64 {
    started_at.elapsed().as_secs_f64() * 1000.0
}

fn terminal_diagnostics_enabled_for_app(app: &AppHandle) -> bool {
    app.state::<TerminalDiagnosticState>().is_enabled()
}

fn log_terminal_diagnostic_event(app: &AppHandle, phase: &str, fields: Value) {
    if !terminal_diagnostics_enabled_for_app(app) {
        return;
    }

    write_terminal_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_terminal_diagnostic_log_text(phase),
        "source": "backend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": fields,
    }));
}

fn log_terminal_status_event(phase: &str, fields: Value) {
    write_terminal_status_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_terminal_diagnostic_log_text(phase),
        "source": "backend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": fields,
    }));
}

/// Cloud sync/connect loop trace (gated by CLOUD_SYNC_LOGGING_ENABLED),
/// written to logs/cloud-sync.jsonl in the project root.
fn log_cloud_sync_event(phase: &str, fields: Value) {
    if !CLOUD_SYNC_LOGGING_ENABLED {
        return;
    }

    let entry = json!({
        "ts_ms": current_time_ms(),
        "ts": chrono_like_now_iso(),
        "phase": clean_terminal_diagnostic_log_text(phase),
        "source": "backend",
        "app_pid": std::process::id(),
        "fields": fields,
    });
    let log_path = diagnostic_log_path(CLOUD_SYNC_LOG_FILE);
    let Some(log_dir) = log_path.parent() else {
        return;
    };
    if fs::create_dir_all(log_dir).is_err() {
        return;
    }
    let lock = CLOUD_SYNC_LOG_LOCK.get_or_init(|| StdMutex::new(()));
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
    let _ = writeln!(file, "{entry}");
}

fn log_terminal_crash_forensics_event(phase: &str, fields: Value) {
    write_terminal_crash_forensics_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_terminal_diagnostic_log_text(phase),
        "source": "backend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "shutdown_phase": app_shutdown_phase_label(),
        "fields": fields,
    }));
}

fn windows_terminal_diagnostics_enabled_for_app(app: &AppHandle) -> bool {
    app.state::<WindowsTerminalDiagnosticState>().is_enabled()
}

fn log_windows_terminal_diagnostic_event(app: &AppHandle, phase: &str, fields: Value) {
    if !windows_terminal_diagnostics_enabled_for_app(app) {
        return;
    }

    write_windows_terminal_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_terminal_diagnostic_log_text(phase),
        "source": "backend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": fields,
    }));
}

#[tauri::command]
fn terminal_set_diagnostic_logging(
    state: State<'_, TerminalDiagnosticState>,
    enabled: bool,
) -> bool {
    let resolved_enabled = TERMINAL_DIAGNOSTIC_LOGGING_ENABLED
        || (TERMINAL_DIAGNOSTIC_RUNTIME_ENABLE_ALLOWED && enabled);
    state.enabled.store(resolved_enabled, Ordering::Relaxed);

    if resolved_enabled {
        write_terminal_diagnostic_log_entry(json!({
            "ts_ms": current_time_ms(),
            "phase": "backend.diagnostic_logging.enabled",
            "source": "backend",
            "app_pid": std::process::id(),
            "thread": terminal_diagnostic_thread_label(),
            "fields": {
                "log_file": terminal_diagnostic_log_path().display().to_string(),
            },
        }));
    }

    resolved_enabled
}

#[tauri::command]
fn terminal_diagnostic_log(
    state: State<'_, TerminalDiagnosticState>,
    phase: String,
    fields: Value,
) -> Result<(), String> {
    if !state.is_enabled() {
        return Ok(());
    }

    write_terminal_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_terminal_diagnostic_log_text(&phase),
        "source": "frontend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": fields,
    }));

    Ok(())
}

#[tauri::command]
fn thread_bridge_diagnostic_log(phase: String, fields: Value) -> Result<(), String> {
    write_thread_bridge_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_terminal_diagnostic_log_text(&phase),
        "source": "frontend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": fields,
    }));

    Ok(())
}

#[tauri::command]
fn bigview_sync_diagnostic_log(phase: String, fields: Value) -> Result<(), String> {
    write_bigview_sync_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_terminal_diagnostic_log_text(&phase),
        "source": "frontend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": fields,
    }));

    Ok(())
}

#[derive(Deserialize)]
struct WorkspaceActivationDiagnosticEvent {
    phase: String,
    fields: Value,
}

#[tauri::command]
fn workspace_activation_diagnostic_log(phase: String, fields: Value) -> Result<(), String> {
    write_workspace_activation_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_terminal_diagnostic_log_text(&phase),
        "source": "frontend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": fields,
    }));

    Ok(())
}

#[tauri::command]
fn workspace_activation_diagnostic_log_many(
    events: Vec<WorkspaceActivationDiagnosticEvent>,
) -> Result<(), String> {
    let entries = events
        .into_iter()
        .take(256)
        .map(|event| {
            json!({
                "ts_ms": current_time_ms(),
                "phase": clean_terminal_diagnostic_log_text(&event.phase),
                "source": "frontend",
                "app_pid": std::process::id(),
                "thread": terminal_diagnostic_thread_label(),
                "fields": event.fields,
            })
        })
        .collect();

    write_workspace_activation_diagnostic_log_entries(entries);

    Ok(())
}

#[tauri::command]
fn voice_orchestrator_diagnostic_log(phase: String, fields: Value) -> Result<(), String> {
    write_voice_orchestrator_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_terminal_diagnostic_log_text(&phase),
        "source": "frontend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": fields,
    }));

    Ok(())
}

fn log_voice_orchestrator_diagnostic_event(phase: &str, fields: Value) {
    write_voice_orchestrator_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_terminal_diagnostic_log_text(phase),
        "source": "backend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": fields,
    }));
}

#[tauri::command]
fn terminal_status_log(phase: String, fields: Value) -> Result<(), String> {
    write_terminal_status_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_terminal_diagnostic_log_text(&phase),
        "source": "frontend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": fields,
    }));

    Ok(())
}

#[tauri::command]
fn windows_terminal_set_diagnostic_logging(
    state: State<'_, WindowsTerminalDiagnosticState>,
    enabled: bool,
) -> bool {
    let resolved_enabled = WINDOWS_TERMINAL_DIAGNOSTIC_LOGGING_ENABLED
        || (WINDOWS_TERMINAL_DIAGNOSTIC_RUNTIME_ENABLE_ALLOWED && enabled);
    state.enabled.store(resolved_enabled, Ordering::Relaxed);

    if resolved_enabled {
        write_windows_terminal_diagnostic_log_entry(json!({
            "ts_ms": current_time_ms(),
            "phase": "backend.windows_terminal_diagnostic_logging.enabled",
            "source": "backend",
            "app_pid": std::process::id(),
            "thread": terminal_diagnostic_thread_label(),
            "fields": {
                "log_file": windows_terminal_diagnostic_log_path().display().to_string(),
            },
        }));
    }

    resolved_enabled
}

#[tauri::command]
fn windows_terminal_diagnostic_log(
    state: State<'_, WindowsTerminalDiagnosticState>,
    phase: String,
    fields: Value,
) -> Result<(), String> {
    if !state.is_enabled() {
        return Ok(());
    }

    write_windows_terminal_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_terminal_diagnostic_log_text(&phase),
        "source": "frontend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": fields,
    }));

    Ok(())
}

fn install_app_panic_log_hook() {
    APP_PANIC_LOG_HOOK_INSTALLED.get_or_init(|| {
        let previous_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |panic_info| {
            let payload = panic_info
                .payload()
                .downcast_ref::<&str>()
                .map(|value| (*value).to_string())
                .or_else(|| panic_info.payload().downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "non-string panic payload".to_string());
            let location = panic_info.location().map(|location| {
                format!(
                    "{}:{}:{}",
                    location.file(),
                    location.line(),
                    location.column()
                )
            });
            let thread = thread::current();
            let thread_name = thread.name().unwrap_or("unnamed").to_string();
            let thread_id = format!("{:?}", thread.id());
            let fields = json!({
                "app_pid": std::process::id(),
                "location": location,
                "payload": clean_terminal_telemetry_text(&payload),
                "thread_id": thread_id,
                "thread_name": clean_terminal_telemetry_text(&thread_name),
            });
            log_terminal_crash_forensics_event("backend.app_panic", fields.clone());
            log_audio_diagnostic_event("app.panic", fields);
            previous_hook(panic_info);
        }));
    });
}

fn schedule_app_exit_after_terminal_shutdown(
    app_for_exit: AppHandle,
    window_label: String,
) -> Result<(), String> {
    thread::Builder::new()
        .name("diffforge-app-close".to_string())
        .spawn(move || {
            // Tell the cloud we are leaving BEFORE teardown: a deliberate ws
            // close flips dashboard presence to offline instantly instead of
            // racing process exit against the cloud's silence timeout.
            cloud_mcp_send_shutdown_goodbye_blocking();
            thread::sleep(Duration::from_millis(APP_CLOSE_EXIT_REQUEST_DELAY_MS));
            let _ = close_workspace_webviews(&app_for_exit);
            cleanup_windows_headless_console_hosts();
            app_for_exit.exit(0);

            thread::sleep(Duration::from_millis(APP_CLOSE_DESTROY_FALLBACK_DELAY_MS));

            if let Some(window) = app_for_exit.get_webview_window(&window_label) {
                let _ = window.destroy();
            }

            thread::sleep(Duration::from_millis(
                APP_CLOSE_PROCESS_EXIT_FALLBACK_DELAY_MS,
            ));
            cleanup_windows_headless_console_hosts();
            std::process::exit(0);
        })
        .map(|_| ())
        .map_err(|error| format!("Failed to schedule app close: {error}"))
}

fn schedule_app_force_exit(app_for_exit: AppHandle, window_label: String) -> Result<(), String> {
    if APP_CLOSE_FORCE_EXIT_SCHEDULED
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok(());
    }

    match thread::Builder::new()
        .name("diffforge-app-close-watchdog".to_string())
        .spawn(move || {
            thread::sleep(Duration::from_millis(
                APP_CLOSE_FORCE_EXIT_FALLBACK_DELAY_MS,
            ));
            cloud_mcp_send_shutdown_goodbye_blocking();
            let _ = close_workspace_webviews(&app_for_exit);
            advance_app_shutdown_phase(APP_SHUTDOWN_PHASE_EXITING);
            cleanup_windows_headless_console_hosts();
            app_for_exit.exit(0);

            thread::sleep(Duration::from_millis(APP_CLOSE_DESTROY_FALLBACK_DELAY_MS));

            if let Some(window) = app_for_exit.get_webview_window(&window_label) {
                let _ = window.destroy();
            }

            thread::sleep(Duration::from_millis(
                APP_CLOSE_PROCESS_EXIT_FALLBACK_DELAY_MS,
            ));
            cleanup_windows_headless_console_hosts();
            std::process::exit(0);
        }) {
        Ok(_) => Ok(()),
        Err(error) => {
            APP_CLOSE_FORCE_EXIT_SCHEDULED.store(false, Ordering::Release);
            Err(format!("Failed to schedule app close watchdog: {error}"))
        }
    }
}

async fn run_backend_app_shutdown(app_for_shutdown: AppHandle, window_label: String) {
    let _ = cloud_mcp_signal_desktop_closing(&app_for_shutdown, "app_shutdown").await;

    // In-flight todos cannot survive the process: label them interrupted
    // (resume-pending) now so they are never orphaned as "running".
    {
        let sweep_app = app_for_shutdown.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            todo_dispatch_mark_active_receipts_interrupted(Some(&sweep_app), "app_shutdown")
        })
        .await;
    }

    emit_app_shutdown_progress(
        &app_for_shutdown,
        "closing_webviews",
        "Closing web views",
        "Detaching embedded workspace browser views.",
        1,
        None,
        None,
    );
    let _ = close_workspace_webviews(&app_for_shutdown);

    emit_app_shutdown_progress(
        &app_for_shutdown,
        "stopping_watchers",
        "Stopping watchers",
        "Stopping file watchers and workspace listeners.",
        2,
        None,
        None,
    );
    advance_app_shutdown_phase(APP_SHUTDOWN_PHASE_STOPPING_WATCHERS);
    let _ = coordination::watcher::stop_all_file_watchers("app_close");
    emit_app_shutdown_progress(
        &app_for_shutdown,
        "stopping_syncs",
        "Stopping syncs",
        "Stopping graph sync tasks.",
        3,
        None,
        None,
    );

    emit_app_shutdown_progress(
        &app_for_shutdown,
        "closing_terminals",
        "Closing terminals",
        "Stopping terminal processes and cleaning PTYs.",
        4,
        Some(0),
        None,
    );
    advance_app_shutdown_phase(APP_SHUTDOWN_PHASE_CLOSING_TERMINALS);
    let _ = {
        let terminal_state = app_for_shutdown.state::<TerminalState>();
        let cloud_mcp_state = app_for_shutdown.state::<CloudMcpState>();
        let lifecycle_lock = Arc::clone(&terminal_state.lifecycle_lock);
        let _lifecycle_guard = lifecycle_lock.lock().await;
        close_all_terminal_sessions(
            app_for_shutdown.clone(),
            &terminal_state,
            cloud_mcp_state.inner(),
            None,
        )
        .await
    };

    emit_app_shutdown_progress(
        &app_for_shutdown,
        "stopping_daemons",
        "Stopping MCP daemons",
        "Stopping shared MCP daemons for this session.",
        5,
        None,
        None,
    );
    advance_app_shutdown_phase(APP_SHUTDOWN_PHASE_STOPPING_DAEMONS);
    let _ = coordination::mcp::stop_all_shared_daemons("app_close");

    emit_app_shutdown_progress(
        &app_for_shutdown,
        "exiting",
        "Exiting",
        "Finalizing shutdown.",
        6,
        None,
        None,
    );
    advance_app_shutdown_phase(APP_SHUTDOWN_PHASE_EXITING);
    if schedule_app_exit_after_terminal_shutdown(app_for_shutdown.clone(), window_label.clone())
        .is_err()
    {
        app_for_shutdown.exit(0);
    }
}

#[tauri::command]
async fn deactivate_workspace_runtime(
    app: AppHandle,
    repo_path: Option<String>,
    reason: Option<String>,
    workspace_id: Option<String>,
    publish_cloud_snapshot: Option<bool>,
) -> Result<Value, String> {
    let started_at = Instant::now();
    let reason = reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("workspace_deactivate")
        .to_string();
    let repo_path = repo_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let workspace_id = workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    log_terminal_diagnostic_event(
        &app,
        "workspace_deactivate_runtime.start",
        json!({
            "reason": reason,
            "repo_path": repo_path.as_deref().unwrap_or(""),
            "workspace_id": workspace_id.as_deref().unwrap_or(""),
        }),
    );

    let watcher_started_at = Instant::now();
    let watchers = if let Some(repo_path) = repo_path.as_deref() {
        coordination::watcher::stop_file_watchers_for_repo_path(Path::new(repo_path), &reason)
    } else {
        coordination::watcher::stop_all_file_watchers(&reason)
    };
    log_terminal_diagnostic_event(
        &app,
        "workspace_deactivate_runtime.watchers_stopped",
        json!({
            "reason": reason,
            "duration_ms": terminal_diagnostic_elapsed_ms(watcher_started_at),
        }),
    );

    let terminal_started_at = Instant::now();
    let terminal_result = {
        let terminal_state = app.state::<TerminalState>();
        let cloud_mcp_state = app.state::<CloudMcpState>();
        let lifecycle_lock = Arc::clone(&terminal_state.lifecycle_lock);
        let _lifecycle_guard = lifecycle_lock.lock().await;
        close_all_terminal_sessions(
            app.clone(),
            &terminal_state,
            cloud_mcp_state.inner(),
            workspace_id.as_deref(),
        )
        .await
    };
    let (closed_terminals, terminal_error) = match terminal_result {
        Ok(closed) => (closed, None),
        Err(error) => (0, Some(error)),
    };
    log_terminal_diagnostic_event(
        &app,
        "workspace_deactivate_runtime.terminals_closed",
        json!({
            "reason": reason,
            "closed": closed_terminals,
            "error": terminal_error.as_deref().unwrap_or(""),
            "duration_ms": terminal_diagnostic_elapsed_ms(terminal_started_at),
        }),
    );

    let mcp_started_at = Instant::now();
    let (mcp, mcp_error) = if let Some(repo_path) = repo_path.as_deref() {
        match coordination::mcp::stop_shared_daemon_for_repo(PathBuf::from(repo_path), &reason) {
            Ok(value) => (value, None),
            Err(error) => (
                json!({
                    "active": false,
                    "repo_path": repo_path,
                }),
                Some(error),
            ),
        }
    } else {
        (
            json!({
                "active": false,
                "skipped": true,
            }),
            None,
        )
    };
    log_terminal_diagnostic_event(
        &app,
        "workspace_deactivate_runtime.daemons_stopped",
        json!({
            "reason": reason,
            "error": mcp_error.as_deref().unwrap_or(""),
            "duration_ms": terminal_diagnostic_elapsed_ms(mcp_started_at),
        }),
    );

    if publish_cloud_snapshot.unwrap_or(true) {
        if let Some(workspace_id) = workspace_id.as_deref() {
            let cloud_mcp_state = app.state::<CloudMcpState>();
            cloud_mcp_publish_workspace_deactivated_snapshot(
                cloud_mcp_state.inner(),
                workspace_id,
                &reason,
            )
            .await;
        }
    }

    let errors = [terminal_error, mcp_error]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let result = json!({
        "ok": errors.is_empty(),
        "reason": reason,
        "repoPath": repo_path.as_deref().unwrap_or(""),
        "workspaceId": workspace_id.as_deref().unwrap_or(""),
        "watchers": watchers,
        "terminals": {
            "closed": closed_terminals,
        },
        "mcp": mcp,
        "errors": errors,
        "durationMs": terminal_diagnostic_elapsed_ms(started_at),
    });

    log_terminal_diagnostic_event(
        &app,
        "workspace_deactivate_runtime.complete",
        json!({
            "reason": reason,
            "ok": result.get("ok").and_then(Value::as_bool).unwrap_or(false),
            "duration_ms": terminal_diagnostic_elapsed_ms(started_at),
        }),
    );

    Ok(result)
}

fn workspace_delete_known_metadata_paths(agents_root: &Path) -> Vec<PathBuf> {
    [
        "worktrees",
        "cloud-mcp",
        "artifacts",
        "memory",
        "mcp",
        "cloud",
        "db",
        "kernel.sqlite",
        "kernel.sqlite-wal",
        "kernel.sqlite-shm",
        "coordination.db",
        "coordination.db-wal",
        "coordination.db-shm",
        "diffforge_threads.sqlite3",
        "diffforge_threads.sqlite3-wal",
        "diffforge_threads.sqlite3-shm",
    ]
    .into_iter()
    .map(|name| agents_root.join(name))
    .collect()
}

fn workspace_delete_path_is_exact_child(path: &Path, parent: &Path) -> bool {
    path.parent()
        .map(|path_parent| normalized_path_key(path_parent) == normalized_path_key(parent))
        .unwrap_or(false)
}

fn workspace_delete_git_dirty_summary(path: &Path) -> Result<Option<String>, String> {
    if !path.join(".git").exists() {
        return Ok(None);
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["status", "--porcelain", "--untracked-files=all"])
        .output()
        .map_err(|error| format!("Unable to inspect {} with git: {error}", path.display()))?;

    if !output.status.success() {
        if path.join(".git").exists() {
            let stderr = String::from_utf8_lossy(&output.stderr)
                .trim()
                .chars()
                .take(240)
                .collect::<String>();
            return Err(format!(
                "Unable to inspect worktree {} before deletion{}",
                path.display(),
                if stderr.is_empty() {
                    ".".to_string()
                } else {
                    format!(": {stderr}")
                }
            ));
        }
        return Ok(None);
    }

    let status = String::from_utf8_lossy(&output.stdout)
        .lines()
        .take(8)
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if status.is_empty() {
        Ok(None)
    } else {
        Ok(Some(status))
    }
}

fn workspace_delete_dirty_worktrees(worktrees_root: &Path) -> Result<Vec<Value>, String> {
    if !worktrees_root.exists() {
        return Ok(Vec::new());
    }

    let mut dirty = Vec::new();
    let entries = fs::read_dir(worktrees_root)
        .map_err(|error| format!("Unable to read workspace worktrees: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Unable to read workspace worktree: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Unable to inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }
        if let Some(summary) = workspace_delete_git_dirty_summary(&path)? {
            dirty.push(json!({
                "path": path.display().to_string(),
                "status": summary,
            }));
        }
    }
    Ok(dirty)
}

fn workspace_delete_remove_path(path: &Path, agents_root: &Path) -> Result<bool, String> {
    if !workspace_delete_path_is_exact_child(path, agents_root) {
        return Err(format!(
            "Refusing to delete workspace metadata path outside .agents: {}",
            path.display()
        ));
    }

    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!("Unable to inspect {}: {error}", path.display()));
        }
    };

    if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(path)
            .map_err(|error| format!("Unable to remove {}: {error}", path.display()))?;
        return Ok(true);
    }

    if metadata.is_dir() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("Unable to remove {}: {error}", path.display()))?;
        return Ok(true);
    }

    Ok(false)
}

fn workspace_delete_remove_private_state_root(
    state_root: &Path,
    workspace_root: &Path,
) -> Result<bool, String> {
    if normalized_path_key(state_root) == normalized_path_key(workspace_root)
        || state_root.starts_with(workspace_root)
    {
        return Err(format!(
            "Refusing to delete private coordination state inside workspace root: {}",
            state_root.display()
        ));
    }

    let metadata = match fs::symlink_metadata(state_root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "Unable to inspect private coordination state {}: {error}",
                state_root.display()
            ));
        }
    };

    if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(state_root).map_err(|error| {
            format!(
                "Unable to remove private coordination state {}: {error}",
                state_root.display()
            )
        })?;
        return Ok(true);
    }

    if metadata.is_dir() {
        fs::remove_dir_all(state_root).map_err(|error| {
            format!(
                "Unable to remove private coordination state {}: {error}",
                state_root.display()
            )
        })?;
        return Ok(true);
    }

    Ok(false)
}

fn delete_workspace_local_metadata_for(
    repo_path: String,
    discard_dirty_worktrees: bool,
) -> Result<Value, String> {
    let root = resolve_workspace_root_directory(Some(&repo_path))?;
    let agents_root = root.join(".agents");
    let private_state_root = coordination::db::coordination_repo_state_root(&root);
    let agents_metadata = match fs::symlink_metadata(&agents_root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let private_state_root_removed =
                workspace_delete_remove_private_state_root(&private_state_root, &root)?;
            let remembered_kernel_entries_removed =
                coordination::db::forget_initialized_kernel_storage_for_repo(&root)?;
            return Ok(json!({
                "ok": true,
                "repoPath": root.display().to_string(),
                "agentsRoot": agents_root.display().to_string(),
                "privateStateRoot": private_state_root.display().to_string(),
                "removed": [],
                "removedCount": (if private_state_root_removed { 1 } else { 0 }) + remembered_kernel_entries_removed,
                "agentsRootRemoved": false,
                "privateStateRootRemoved": private_state_root_removed,
                "rememberedKernelEntriesRemoved": remembered_kernel_entries_removed,
                "skipped": true,
            }));
        }
        Err(error) => {
            return Err(format!(
                "Unable to inspect workspace .agents directory: {error}"
            ));
        }
    };

    if agents_metadata.file_type().is_symlink() || !agents_metadata.is_dir() {
        return Err(
            "Workspace .agents path is not a directory; refusing metadata delete.".to_string(),
        );
    }

    let worktrees_root = agents_root.join("worktrees");
    let dirty_worktrees = workspace_delete_dirty_worktrees(&worktrees_root)?;
    if !discard_dirty_worktrees && !dirty_worktrees.is_empty() {
        return Err(format!(
            "Workspace has {} dirty Diff Forge worktree{} under .agents/worktrees. Submit, save, or discard those changes before deleting the workspace.",
            dirty_worktrees.len(),
            if dirty_worktrees.len() == 1 { "" } else { "s" },
        ));
    }

    let mut removed = Vec::new();
    for path in workspace_delete_known_metadata_paths(&agents_root) {
        if workspace_delete_remove_path(&path, &agents_root)? {
            removed.push(path.display().to_string());
        }
    }

    let agents_root_removed = match fs::read_dir(&agents_root) {
        Ok(entries) => {
            let is_empty = entries.into_iter().next().is_none();
            if is_empty {
                fs::remove_dir(&agents_root).map_err(|error| {
                    format!(
                        "Unable to remove empty workspace .agents directory {}: {error}",
                        agents_root.display()
                    )
                })?;
            }
            is_empty
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => {
            return Err(format!(
                "Unable to inspect workspace .agents directory after cleanup: {error}"
            ));
        }
    };

    let private_state_root_removed =
        workspace_delete_remove_private_state_root(&private_state_root, &root)?;
    if private_state_root_removed {
        removed.push(private_state_root.display().to_string());
    }
    let remembered_kernel_entries_removed =
        coordination::db::forget_initialized_kernel_storage_for_repo(&root)?;
    let removed_count = removed.len();

    Ok(json!({
        "ok": true,
        "repoPath": root.display().to_string(),
        "agentsRoot": agents_root.display().to_string(),
        "privateStateRoot": private_state_root.display().to_string(),
        "removed": removed,
        "removedCount": removed_count + remembered_kernel_entries_removed,
        "dirtyWorktrees": dirty_worktrees,
        "agentsRootRemoved": agents_root_removed,
        "privateStateRootRemoved": private_state_root_removed,
        "rememberedKernelEntriesRemoved": remembered_kernel_entries_removed,
        "skipped": false,
    }))
}

#[tauri::command]
async fn delete_workspace_local_metadata(
    repo_path: String,
    discard_dirty_worktrees: Option<bool>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_workspace_local_metadata_for(repo_path, discard_dirty_worktrees.unwrap_or(false))
    })
    .await
    .map_err(|error| format!("Unable to delete workspace metadata: {error}"))?
}

fn local_workspace_scope_file_key(scope_key: &str) -> String {
    let cleaned = scope_key
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .take(120)
        .collect::<String>();
    if cleaned.is_empty() {
        "personal".to_string()
    } else {
        cleaned
    }
}

fn local_workspace_store_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let store_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?
        .join("workspace-catalog");
    fs::create_dir_all(&store_dir)
        .map_err(|error| format!("Unable to create workspace catalog directory: {error}"))?;
    Ok(store_dir)
}

fn local_workspace_store_path(app: &AppHandle, scope_key: &str) -> Result<PathBuf, String> {
    let store_dir = local_workspace_store_dir(app)?;
    Ok(store_dir.join(format!(
        "{}.json",
        local_workspace_scope_file_key(scope_key)
    )))
}

/// Workspaces are local-first: the UI commits to this store instantly and the
/// cloud workspace catalog reconciles in the background.
#[tauri::command]
async fn local_workspaces_load(app: AppHandle, scope_key: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = local_workspace_store_path(&app, &scope_key)?;
        if !path.exists() {
            return Ok(json!({ "workspaces": [], "loaded": false }));
        }
        let text = fs::read_to_string(&path)
            .map_err(|error| format!("Unable to read local workspace catalog: {error}"))?;
        let value = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!({}));
        let workspaces = value
            .get("workspaces")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        Ok(json!({ "workspaces": workspaces, "loaded": true }))
    })
    .await
    .map_err(|error| format!("Unable to load local workspace catalog: {error}"))?
}

#[tauri::command]
async fn local_workspaces_store(
    app: AppHandle,
    scope_key: String,
    workspaces: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = local_workspace_store_path(&app, &scope_key)?;
        let workspace_settings = app_local_state_read(&app, "workspace-settings");
        let items = local_workspace_catalog_normalize_items(
            workspaces.as_array().cloned().unwrap_or_default(),
            &workspace_settings,
        )?;
        let payload = json!({
            "version": 1,
            "workspaces": items,
        });
        let serialized = serde_json::to_vec_pretty(&payload)
            .map_err(|error| format!("Unable to serialize local workspace catalog: {error}"))?;
        let temp_path = path.with_extension("json.tmp");
        fs::write(&temp_path, serialized)
            .map_err(|error| format!("Unable to write local workspace catalog: {error}"))?;
        fs::rename(&temp_path, &path)
            .map_err(|error| format!("Unable to finalize local workspace catalog: {error}"))?;
        let pruned_workspace_settings =
            local_workspace_catalog_prune_orphan_workspace_settings(&app)?;
        Ok(json!({
            "ok": true,
            "count": items.len(),
            "prunedWorkspaceSettings": pruned_workspace_settings,
        }))
    })
    .await
    .map_err(|error| format!("Unable to store local workspace catalog: {error}"))?
}

fn html_document_preview_file_name(title: Option<String>) -> String {
    let stem = title
        .as_deref()
        .unwrap_or("document")
        .trim()
        .trim_end_matches(".html")
        .trim_end_matches(".htm")
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches(['.', '_', '-'])
        .chars()
        .take(80)
        .collect::<String>();
    let stem = if stem.is_empty() {
        "document".to_string()
    } else {
        stem
    };
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{stem}-{nanos}.html")
}

fn open_path_with_default_browser(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", ""]).arg(path);
        command
    };

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Unable to open HTML document in the default browser: {error}"))
}

#[tauri::command]
async fn open_html_document_in_browser(
    app: AppHandle,
    title: Option<String>,
    content: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = content.as_bytes();
        if bytes.len() > MAX_HTML_DOCUMENT_OPEN_BYTES {
            return Err(format!(
                "HTML document preview is too large to open safely ({} bytes).",
                bytes.len()
            ));
        }
        let preview_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Unable to resolve app data directory: {error}"))?
            .join("html-document-previews");
        fs::create_dir_all(&preview_dir)
            .map_err(|error| format!("Unable to create HTML preview directory: {error}"))?;
        let preview_path = preview_dir.join(html_document_preview_file_name(title));
        fs::write(&preview_path, bytes)
            .map_err(|error| format!("Unable to write HTML preview: {error}"))?;
        open_path_with_default_browser(&preview_path)?;
        Ok(json!({
            "ok": true,
            "path": preview_path.display().to_string(),
        }))
    })
    .await
    .map_err(|error| format!("Unable to open HTML document: {error}"))?
}

fn local_workspace_catalog_text(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn local_workspace_catalog_root_text(entry: &Value, workspace_settings: &Value) -> Option<String> {
    let workspace_id = local_workspace_catalog_text(entry, &["id", "workspace_id", "workspaceId"]);
    let settings = workspace_id
        .as_deref()
        .and_then(|id| workspace_settings.get(id));
    local_workspace_catalog_text(
        entry,
        &[
            "rootDirectory",
            "root_directory",
            "workspaceRoot",
            "workspace_root",
            "repoPath",
            "repo_path",
        ],
    )
    .or_else(|| {
        settings.and_then(|settings| {
            local_workspace_catalog_text(settings, &["rootDirectory", "root_directory"])
        })
    })
}

fn local_workspace_catalog_root_identity(
    entry: &Value,
    workspace_settings: &Value,
) -> Option<(String, Option<String>)> {
    let explicit_identity = local_workspace_catalog_text(
        entry,
        &[
            "rootIdentity",
            "root_identity",
            "workspaceRootIdentity",
            "workspace_root_identity",
        ],
    )
    .map(|value| normalized_literal_path_key(&value))
    .filter(|value| !value.is_empty());
    if let Some(identity) = explicit_identity {
        return Some((
            identity,
            local_workspace_catalog_root_text(entry, workspace_settings),
        ));
    }

    let root_text = local_workspace_catalog_root_text(entry, workspace_settings)?;
    let root = PathBuf::from(&root_text);
    let identity = root
        .canonicalize()
        .map(|canonical| normalized_path_key(&visible_workspace_root_for_directory(&canonical)))
        .unwrap_or_else(|_| normalized_literal_path_key(&root_text));
    (!identity.is_empty()).then_some((identity, Some(root_text)))
}

fn local_workspace_catalog_normalize_items(
    items: Vec<Value>,
    workspace_settings: &Value,
) -> Result<Vec<Value>, String> {
    let mut root_owners: HashMap<String, String> = HashMap::new();
    let mut normalized_items = Vec::with_capacity(items.len());

    for item in items {
        let workspace_id =
            local_workspace_catalog_text(&item, &["id", "workspace_id", "workspaceId"])
                .unwrap_or_default();
        let root_details = local_workspace_catalog_root_identity(&item, workspace_settings);

        if !local_workspace_catalog_entry_is_deleted(&item) {
            if let (Some((root_identity, _)), true) = (&root_details, !workspace_id.is_empty()) {
                if let Some(existing_id) = root_owners.get(root_identity) {
                    if existing_id != &workspace_id {
                        return Err(format!(
                            "Workspace root is already attached to workspace {existing_id}."
                        ));
                    }
                } else {
                    root_owners.insert(root_identity.clone(), workspace_id.clone());
                }
            }
        }

        match (item, root_details) {
            (Value::Object(mut object), Some((root_identity, root_directory))) => {
                object.insert("rootIdentity".to_string(), json!(root_identity));
                if !object.contains_key("rootDirectory") {
                    if let Some(root_directory) = root_directory {
                        object.insert("rootDirectory".to_string(), json!(root_directory));
                    }
                }
                normalized_items.push(Value::Object(object));
            }
            (item, _) => normalized_items.push(item),
        }
    }

    Ok(normalized_items)
}

fn local_workspace_catalog_all_workspace_ids(app: &AppHandle) -> Result<HashSet<String>, String> {
    let store_dir = local_workspace_store_dir(app)?;
    let mut ids = HashSet::new();
    let entries = match fs::read_dir(&store_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(ids),
        Err(error) => {
            return Err(format!(
                "Unable to read local workspace catalog directory: {error}"
            ));
        }
    };

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Unable to read workspace catalog entry: {error}"))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let text = fs::read_to_string(&path)
            .map_err(|error| format!("Unable to read local workspace catalog: {error}"))?;
        let value = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!({}));
        if let Some(items) = value.get("workspaces").and_then(Value::as_array) {
            for item in items {
                if local_workspace_catalog_entry_is_deleted(item) {
                    continue;
                }
                if let Some(id) =
                    local_workspace_catalog_text(item, &["id", "workspace_id", "workspaceId"])
                {
                    ids.insert(id);
                }
            }
        }
    }
    Ok(ids)
}

fn local_workspace_catalog_prune_orphan_workspace_settings(
    app: &AppHandle,
) -> Result<usize, String> {
    let workspace_ids = local_workspace_catalog_all_workspace_ids(app)?;
    let current = app_local_state_read(app, "workspace-settings");
    let Some(current_object) = current.as_object() else {
        return Ok(0);
    };

    let mut next_object = serde_json::Map::new();
    for (workspace_id, settings) in current_object {
        if workspace_ids.contains(workspace_id) {
            next_object.insert(workspace_id.clone(), settings.clone());
        }
    }
    let removed = current_object.len().saturating_sub(next_object.len());
    if removed > 0 {
        app_local_state_write(app, "workspace-settings", &Value::Object(next_object))?;
    }
    Ok(removed)
}

fn local_workspace_catalog_entry_is_deleted(entry: &Value) -> bool {
    if entry
        .get("pendingDelete")
        .or_else(|| entry.get("pending_delete"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return true;
    }
    if entry
        .get("deleted")
        .or_else(|| entry.get("removed"))
        .or_else(|| entry.get("tombstoned"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return true;
    }
    if entry
        .get("current")
        .and_then(Value::as_bool)
        .map(|current| !current)
        .unwrap_or(false)
    {
        return true;
    }
    if local_workspace_catalog_text(entry, &["deletedAt", "deleted_at"]).is_some() {
        return true;
    }
    local_workspace_catalog_text(entry, &["status", "workspace_status"])
        .map(|status| matches!(status.as_str(), "deleted" | "archived" | "removed"))
        .unwrap_or(false)
}

/// Rust-owned app-local state files (app-data/app-state/<key>.json). These
/// replace webview localStorage for state that headless flows must read or
/// mutate (workspace settings, lifecycle defaults, remote-control intents).
/// The webview keeps localStorage as a synchronous cache and writes through.
fn app_local_state_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    let safe_key = key
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .take(80)
        .collect::<String>();
    if safe_key.is_empty() {
        return Err("App local state key is required.".to_string());
    }
    let store_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?
        .join("app-state");
    fs::create_dir_all(&store_dir)
        .map_err(|error| format!("Unable to create app state directory: {error}"))?;
    Ok(store_dir.join(format!("{safe_key}.json")))
}

pub(crate) fn app_local_state_read(app: &AppHandle, key: &str) -> Value {
    let Ok(path) = app_local_state_path(app, key) else {
        return json!(null);
    };
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or(json!(null))
}

pub(crate) fn app_local_state_write(
    app: &AppHandle,
    key: &str,
    value: &Value,
) -> Result<(), String> {
    let path = app_local_state_path(app, key)?;
    let serialized = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Unable to serialize app state: {error}"))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, serialized)
        .map_err(|error| format!("Unable to write app state: {error}"))?;
    fs::rename(&temp_path, &path)
        .map_err(|error| format!("Unable to finalize app state: {error}"))?;
    Ok(())
}

/// Merge top-level keys into an app-local state object (creates it if absent).
pub(crate) fn app_local_state_merge(
    app: &AppHandle,
    key: &str,
    patch: &Value,
) -> Result<Value, String> {
    let mut current = match app_local_state_read(app, key) {
        Value::Object(map) => Value::Object(map),
        _ => json!({}),
    };
    if let (Some(target), Some(source)) = (current.as_object_mut(), patch.as_object()) {
        for (patch_key, patch_value) in source {
            if patch_value.is_null() {
                target.remove(patch_key);
            } else {
                target.insert(patch_key.clone(), patch_value.clone());
            }
        }
    }
    app_local_state_write(app, key, &current)?;
    Ok(current)
}

fn app_local_state_public_value(key: &str, value: Value) -> Value {
    if key.trim().eq_ignore_ascii_case(DESKTOP_AUTH_STATE_KEY) {
        return desktop_auth_public_snapshot(&desktop_auth_snapshot_from_raw(value));
    }
    value
}

fn app_local_state_is_desktop_auth_key(key: &str) -> bool {
    key.trim().eq_ignore_ascii_case(DESKTOP_AUTH_STATE_KEY)
}

#[tauri::command]
async fn app_local_state_load(app: AppHandle, key: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let value = app_local_state_read(&app, &key);
        Ok(app_local_state_public_value(&key, value))
    })
    .await
    .map_err(|error| format!("App state load worker failed: {error}"))?
}

#[tauri::command]
async fn app_local_state_store(app: AppHandle, key: String, value: Value) -> Result<Value, String> {
    if app_local_state_is_desktop_auth_key(&key) {
        return Err("Desktop auth state is owned by the native auth core.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        app_local_state_write(&app, &key, &value)?;
        Ok(json!({ "ok": true }))
    })
    .await
    .map_err(|error| format!("App state store worker failed: {error}"))?
}

#[tauri::command]
async fn app_local_state_merge_command(
    app: AppHandle,
    key: String,
    patch: Value,
) -> Result<Value, String> {
    if app_local_state_is_desktop_auth_key(&key) {
        return Err("Desktop auth state is owned by the native auth core.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let value = app_local_state_merge(&app, &key, &patch)?;
        Ok(app_local_state_public_value(&key, value))
    })
    .await
    .map_err(|error| format!("App state merge worker failed: {error}"))?
}

#[tauri::command]
async fn close_app_after_terminal_shutdown(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    let window_label = window.label().to_string();
    let _ = begin_app_shutdown();
    let force_exit_result = schedule_app_force_exit(app.clone(), window_label.clone());

    if APP_CLOSE_SHUTDOWN_IN_FLIGHT.swap(true, Ordering::SeqCst) {
        return force_exit_result;
    }

    run_backend_app_shutdown(app, window_label).await;

    force_exit_result
}

fn start_backend_app_shutdown(app: AppHandle, window_label: String) -> Result<(), String> {
    let _ = begin_app_shutdown();
    let force_exit_result = schedule_app_force_exit(app.clone(), window_label.clone());

    if APP_CLOSE_SHUTDOWN_IN_FLIGHT.swap(true, Ordering::SeqCst) {
        return force_exit_result;
    }

    tauri::async_runtime::spawn(async move {
        run_backend_app_shutdown(app, window_label).await;
    });

    force_exit_result
}

fn restore_main_window(app: &AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }

    if let Some(window) = app.get_webview_window("main") {
        let was_minimized = window.is_minimized().unwrap_or(false);

        if was_minimized {
            let _ = window.unminimize();
            return true;
        }

        let _ = window.show();
        let _ = window.set_focus();
    }

    false
}

#[cfg(target_os = "macos")]
fn main_window_apply_macos_mouse_moved_style(window: &tauri::WebviewWindow) {
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("main_window_apply_mouse_moved_style", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &objc2_app_kit::NSWindow =
                unsafe { &*ns_window.cast::<objc2_app_kit::NSWindow>() };
            ns_window.setAcceptsMouseMovedEvents(true);
        });
    });
}

fn start_main_window_cursor_watcher(app: &AppHandle) {
    if MAIN_WINDOW_CURSOR_WATCHER_ACTIVE.swap(true, Ordering::AcqRel) {
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_snapshot: Option<(bool, i32, i32, bool)> = None;

        loop {
            let Some(window) = app.get_webview_window("main") else {
                last_snapshot = None;
                sleep(Duration::from_millis(MAIN_WINDOW_CURSOR_IDLE_POLL_MS)).await;
                continue;
            };

            let visible = window.is_visible().unwrap_or(false);
            let focused = window.is_focused().unwrap_or(false);
            let cursor_snapshot = if visible {
                app.cursor_position()
                    .ok()
                    .and_then(|cursor| {
                        let position = window.outer_position().ok()?;
                        let size = window.outer_size().ok()?;
                        let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
                        let client_x = (cursor.x - f64::from(position.x)) / scale;
                        let client_y = (cursor.y - f64::from(position.y)) / scale;
                        let logical_width = f64::from(size.width.max(1)) / scale;
                        let logical_height = f64::from(size.height.max(1)) / scale;
                        let hovered = client_x >= 0.0
                            && client_x <= logical_width
                            && client_y >= 0.0
                            && client_y <= logical_height;
                        Some((hovered, client_x, client_y))
                    })
                    .unwrap_or((false, -1.0, -1.0))
            } else {
                (false, -1.0, -1.0)
            };

            let (hovered, client_x, client_y) = cursor_snapshot;
            let rounded_x = if hovered { client_x.round() as i32 } else { -1 };
            let rounded_y = if hovered { client_y.round() as i32 } else { -1 };
            let snapshot = (hovered, rounded_x, rounded_y, focused);

            if last_snapshot != Some(snapshot) {
                let payload = if hovered {
                    json!({
                        "hovered": true,
                        "focused": focused,
                        "clientX": client_x,
                        "clientY": client_y,
                    })
                } else {
                    json!({
                        "hovered": false,
                        "focused": focused,
                    })
                };
                let _ = window.emit(MAIN_WINDOW_CURSOR_EVENT, payload);
                last_snapshot = Some(snapshot);
            }

            // Only poll at the fast hover cadence when the window is the active
            // (visible AND focused) window. A visible-but-unfocused/background
            // window drops to the slow idle cadence instead of waking ~20-30x/sec.
            let cursor_poll_ms = if visible && focused {
                MAIN_WINDOW_CURSOR_POLL_MS
            } else if visible {
                MAIN_WINDOW_CURSOR_IDLE_POLL_MS
            } else {
                MAIN_WINDOW_CURSOR_HIDDEN_POLL_MS
            };
            sleep(Duration::from_millis(cursor_poll_ms)).await;
        }
    });
}

fn deep_link_urls_from_args(args: &[String]) -> Vec<String> {
    args.iter()
        .filter_map(|arg| {
            let url = arg.trim();
            if url.starts_with("diffforge://") {
                Some(url.to_string())
            } else {
                None
            }
        })
        .collect()
}

fn emit_deep_link_urls(app: &AppHandle, urls: Vec<String>) {
    if urls.is_empty() {
        return;
    }

    let _ = app.emit(DEEP_LINK_NEW_URL_EVENT, urls);
}

#[cfg(target_os = "macos")]
fn focus_restored_main_window(app: &AppHandle) {
    let _ = app.show();

    if let Some(window) = app.get_webview_window("main") {
        if window.is_minimized().unwrap_or(false) {
            return;
        }

        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "macos")]
fn mark_main_window_minimize_requested() {
    MAIN_WINDOW_MINIMIZE_REQUESTED_AT_MS.store(current_time_ms(), Ordering::SeqCst);
}

#[cfg(target_os = "macos")]
fn main_window_recently_minimized() -> bool {
    let requested_at_ms = MAIN_WINDOW_MINIMIZE_REQUESTED_AT_MS.load(Ordering::SeqCst);

    requested_at_ms != 0
        && current_time_ms().saturating_sub(requested_at_ms)
            < MAIN_WINDOW_MINIMIZE_RESTORE_SUPPRESS_MS
}

#[tauri::command]
fn note_main_window_minimize_requested() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    mark_main_window_minimize_requested();

    Ok(())
}

#[cfg(test)]
mod workspace_delete_local_metadata_tests {
    use super::*;

    fn temp_workspace(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("diffforge-{name}-{nanos}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn delete_workspace_local_metadata_removes_only_owned_agents_paths() {
        let root = temp_workspace("workspace-delete-metadata");
        let resolved_root =
            resolve_workspace_root_directory(Some(&root.display().to_string())).unwrap();
        let agents = root.join(".agents");
        let private_state_root = coordination::db::coordination_repo_state_root(&resolved_root);
        fs::create_dir_all(agents.join("cloud-mcp")).unwrap();
        fs::create_dir_all(agents.join("worktrees").join("slot-1")).unwrap();
        fs::create_dir_all(&private_state_root).unwrap();
        fs::write(agents.join("cloud-mcp").join("cloud-mcp.jsonl"), "{}").unwrap();
        fs::write(
            agents.join("worktrees").join("slot-1").join("note.txt"),
            "draft",
        )
        .unwrap();
        fs::write(agents.join("kernel.sqlite"), "").unwrap();
        fs::write(private_state_root.join("kernel.sqlite"), "").unwrap();
        fs::write(root.join("source.txt"), "keep").unwrap();

        let result =
            delete_workspace_local_metadata_for(root.display().to_string(), false).unwrap();

        assert_eq!(result["ok"], json!(true));
        assert_eq!(result["agentsRootRemoved"], json!(true));
        assert_eq!(result["privateStateRootRemoved"], json!(true));
        assert!(!agents.exists());
        assert!(!private_state_root.exists());
        assert_eq!(fs::read_to_string(root.join("source.txt")).unwrap(), "keep");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_workspace_local_metadata_removes_private_state_without_agents_root() {
        let root = temp_workspace("workspace-delete-private-state-only");
        let resolved_root =
            resolve_workspace_root_directory(Some(&root.display().to_string())).unwrap();
        let private_state_root = coordination::db::coordination_repo_state_root(&resolved_root);
        fs::create_dir_all(&private_state_root).unwrap();
        fs::write(private_state_root.join("kernel.sqlite"), "").unwrap();
        fs::write(root.join("source.txt"), "keep").unwrap();

        let result =
            delete_workspace_local_metadata_for(root.display().to_string(), false).unwrap();

        assert_eq!(result["ok"], json!(true));
        assert_eq!(result["skipped"], json!(true));
        assert_eq!(result["privateStateRootRemoved"], json!(true));
        assert!(!private_state_root.exists());
        assert_eq!(fs::read_to_string(root.join("source.txt")).unwrap(), "keep");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_workspace_local_metadata_blocks_dirty_git_worktrees() {
        if Command::new("git").arg("--version").output().is_err() {
            return;
        }

        let root = temp_workspace("workspace-delete-dirty-worktree");
        let worktree = root.join(".agents").join("worktrees").join("slot-1");
        fs::create_dir_all(&worktree).unwrap();
        let init = Command::new("git")
            .arg("init")
            .arg(&worktree)
            .output()
            .unwrap();
        if !init.status.success() {
            let _ = fs::remove_dir_all(root);
            return;
        }
        fs::write(worktree.join("dirty.txt"), "unsaved").unwrap();

        let error =
            delete_workspace_local_metadata_for(root.display().to_string(), false).unwrap_err();

        assert!(error.contains("dirty Diff Forge worktree"));
        assert!(worktree.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_workspace_local_metadata_discards_dirty_git_worktrees_when_requested() {
        if Command::new("git").arg("--version").output().is_err() {
            return;
        }

        let root = temp_workspace("workspace-delete-discard-dirty-worktree");
        let worktree = root.join(".agents").join("worktrees").join("slot-1");
        fs::create_dir_all(&worktree).unwrap();
        let init = Command::new("git")
            .arg("init")
            .arg(&worktree)
            .output()
            .unwrap();
        if !init.status.success() {
            let _ = fs::remove_dir_all(root);
            return;
        }
        fs::write(worktree.join("dirty.txt"), "unsaved").unwrap();

        let result = delete_workspace_local_metadata_for(root.display().to_string(), true).unwrap();

        assert_eq!(result["ok"], json!(true));
        assert!(!worktree.exists());
        assert!(!root.join(".agents").exists());
        let _ = fs::remove_dir_all(root);
    }
}

#[cfg(target_os = "macos")]
fn main_window_needs_attention(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .map(|window| {
            window.is_minimized().unwrap_or(false)
                || !window.is_visible().unwrap_or(true)
                || !window.is_focused().unwrap_or(false)
        })
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn restore_main_window_after_reopen(app: AppHandle, has_visible_windows: bool) {
    if MAIN_WINDOW_RESTORE_IN_FLIGHT.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let suppress_restore = has_visible_windows && main_window_recently_minimized();

        if !suppress_restore {
            if restore_main_window(&app) {
                sleep(Duration::from_millis(MAIN_WINDOW_RESTORE_FOCUS_DELAY_MS)).await;
                focus_restored_main_window(&app);
            }

            for delay_ms in MAIN_WINDOW_RESTORE_RETRY_DELAYS_MS {
                sleep(Duration::from_millis(delay_ms)).await;

                let suppress_retry = has_visible_windows && main_window_recently_minimized();

                if main_window_needs_attention(&app) && !suppress_retry {
                    if restore_main_window(&app) {
                        sleep(Duration::from_millis(MAIN_WINDOW_RESTORE_FOCUS_DELAY_MS)).await;
                        focus_restored_main_window(&app);
                    }
                }
            }
        }

        sleep(Duration::from_millis(
            MAIN_WINDOW_RESTORE_COALESCE_RELEASE_MS,
        ))
        .await;
        MAIN_WINDOW_RESTORE_IN_FLIGHT.store(false, Ordering::SeqCst);
    });
}

pub fn run() {
    configure_windows_process_error_mode();
    configure_safe_process_current_directory();
    install_app_panic_log_hook();

    let mut builder = tauri::Builder::default();
    let pty_pool = Arc::new(PtyPool::new());
    log_terminal_crash_forensics_event(
        "backend.process_start",
        json!({
            "log_file": terminal_crash_forensics_log_path().display().to_string(),
            "terminal_status_logging_enabled": TERMINAL_STATUS_LOGGING_ENABLED,
            "windows": cfg!(windows),
            "windows_build_number": terminal_windows_build_number(),
        }),
    );
    terminal_recover_crashed_sessions_on_startup();
    log_audio_diagnostic_event(
        "audio.debug.process_start",
        json!({
            "app_pid": std::process::id(),
            "log_file": whisper_local_audio_log_path().display().to_string(),
        }),
    );
    write_workspace_activation_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": "backend.workspace_activation.process_start",
        "source": "backend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": {
            "enabled": WORKSPACE_ACTIVATION_DIAGNOSTIC_LOGGING_ENABLED,
            "log_file": workspace_activation_diagnostic_log_path().display().to_string(),
        },
    }));
    log_voice_orchestrator_diagnostic_event(
        "voice_agent.process_start",
        json!({
            "app_pid": std::process::id(),
            "log_file": voice_orchestrator_diagnostic_log_path().display().to_string(),
            "enabled": VOICE_ORCHESTRATOR_DIAGNOSTIC_LOGGING_ENABLED,
        }),
    );

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let deep_link_urls = deep_link_urls_from_args(&argv);

            if app_is_in_background_mode() {
                app_exit_background_internal(app);
            } else {
                #[cfg(target_os = "macos")]
                restore_main_window_after_reopen(app.clone(), false);
                #[cfg(not(target_os = "macos"))]
                restore_main_window(app);
            }

            emit_deep_link_urls(app, deep_link_urls);
        }));
    }

    builder
        .manage(TerminalState {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            terminal_input_queues: Arc::new(StdMutex::new(HashMap::new())),
            terminal_input_transport: Arc::new(StdMutex::new(None)),
            terminal_output_transport: Arc::new(StdMutex::new(None)),
            terminal_activity_transport: Arc::new(StdMutex::new(None)),
            terminal_activity_transport_tokens: Arc::new(StdMutex::new(HashMap::new())),
            terminal_output_transport_subscribers: Arc::new(StdMutex::new(HashMap::new())),
            parked_prompts: Arc::new(RwLock::new(HashMap::new())),
            active_audio_input_target: Arc::new(StdMutex::new(None)),
            audio_route_gate: Arc::new(StdMutex::new(TerminalAudioRouteGate::default())),
            lifecycle_lock: Arc::new(Mutex::new(())),
            pty_pool: Arc::clone(&pty_pool),
            cleanup_tracker: Arc::new(TerminalCleanupTracker::new()),
            workspace_topology_cache: Arc::new(RwLock::new(HashMap::new())),
            next_terminal_instance_id: AtomicU64::new(1),
            next_terminal_input_queue_id: AtomicU64::new(1),
            next_terminal_output_subscriber_id: AtomicU64::new(1),
        })
        .manage(TerminalDiagnosticState::new())
        .manage(WindowsTerminalDiagnosticState::new())
        .manage(CloudMcpState::new())
        .manage(AppControlMcpState::new())
        .manage(DeveloperProcessMonitorState::new())
        .manage(AudioState {
            download_lock: Arc::new(Mutex::new(())),
            cloud_voice_agent_stream: Arc::new(Mutex::new(None)),
            deepgram_stream: Arc::new(Mutex::new(None)),
            forge_dictation_stream: Arc::new(Mutex::new(None)),
            cloud_voice_agent_input_enabled: Arc::new(AtomicBool::new(false)),
            forge_dictation_mic_borrowed: Arc::new(AtomicBool::new(false)),
            deepgram_mic_borrowed: Arc::new(AtomicBool::new(false)),
            forge_dictation_warm: Arc::new(Mutex::new(None)),
            forge_dictation_warm_desired: Arc::new(AtomicBool::new(false)),
            forge_dictation_warm_generation: Arc::new(AtomicU64::new(0)),
            input_worker: NativeAudioWorker::new(),
            realtime_stream_lock: Arc::new(Mutex::new(())),
            realtime_mic_holder: Arc::new(StdMutex::new(RealtimeMicHolder::None)),
            shortcut_manager: AudioShortcutManager::new(),
            whisper_cancel_token: Arc::new(AtomicU64::new(0)),
            whisper_engine: WhisperCliWarmCache::new(),
        })
        .manage(SnippingState::new())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            pty_pool.ensure_warm_async();
            cloud_mcp_register_sync_status_app(app.handle());
            cloud_mcp_start_local_device_bridge();
            let cloud_mcp_state = app.state::<CloudMcpState>().inner().clone();
            let cloud_mcp_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Restore the persisted desktop session before the first
                // connect so cloud auth comes up without waiting for the
                // webview (background-capable startup).
                let _restored_auth = desktop_auth_restore_cloud_session_for_startup(
                    &cloud_mcp_app,
                    &cloud_mcp_state,
                )
                .await;
                let cloud_connected = cloud_mcp_connect_state(&cloud_mcp_state).await.is_ok();
                if cloud_connected
                    && env::var_os("DIFFFORGE_PREWARM_CLOUD_VOICE_ON_STARTUP").is_some()
                {
                    let _ =
                        prewarm_cloud_voice_agent_stream_for_state(&cloud_mcp_state, true).await;
                }
            });
            cloud_mcp_start_tokenomics_scheduler(
                app.handle().clone(),
                app.state::<CloudMcpState>().inner().clone(),
            );
            cloud_mcp_start_architecture_event_sync(
                app.handle().clone(),
                app.state::<CloudMcpState>().inner().clone(),
            );
            architecture_store_watcher_start(app.handle().clone());
            cloud_mcp_start_account_documents_watcher(app.handle().clone());
            cloud_mcp_start_agent_inventory_watcher(
                app.handle().clone(),
                app.state::<CloudMcpState>().inner().clone(),
            );
            // Background dispatcher: dormant while the webview heartbeats;
            // takes over queued-todo submission when the window goes away.
            todo_dispatch_start_background_dispatcher(app.handle().clone());
            // Always-present tray: with the main window up its click toggles
            // the recent-snips strip; in background mode, the monitor popover.
            // (Setup runs on the main thread, which NSStatusItem requires.)
            background_tray_create(app.handle());
            todo_store_orphan_sweep_start(app.handle().clone());
            agent_accounts_capture_watch_start(app.handle().clone());
            // Startup todo recovery is bounded, not destructive: queued work
            // survives app startup, while ambiguous in-flight rows wait for
            // Rust terminal/workspace evidence or a 45s timeout before being
            // reclassified.
            todo_store_startup_sweep(app.handle());
            register_terminal_input_event_listener(app);
            register_terminal_coordination_event_bridge(app);

            register_audio_shortcuts(app.handle());
            register_snipping_shortcuts(app.handle());
            if SNIPPING_STARTUP_PREWARM_ENABLED {
                prewarm_snipping_overlay_window(app.handle());
            }
            register_activity_overlay_shortcut(app.handle());

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

            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
                    main_window_apply_macos_mouse_moved_style(&window);
                }
            }
            start_main_window_cursor_watcher(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_ping,
            backend_cpu_attribution_snapshot,
            desktop_auth_snapshot_command,
            desktop_auth_start_login,
            desktop_auth_validate_session,
            desktop_auth_handle_deep_link,
            desktop_auth_set_active_scope,
            desktop_auth_apply_billing_status,
            desktop_auth_sign_out,
            local_workspaces_load,
            local_workspaces_store,
            open_html_document_in_browser,
            workspace_webview_open,
            workspace_webview_fit,
            workspace_webview_close,
            app_local_state_load,
            app_local_state_store,
            app_local_state_merge_command,
            agent_statuses,
            start_agent_login,
            start_agent_account_login,
            agent_accounts_start_profile_login,
            disconnect_agent,
            install_agent,
            update_agent,
            uninstall_agent,
            tools_check_cli_binaries,
            tools_run_cli_action,
            terminal_activity_snapshot,
            kill_developer_process,
            forge_working_directory,
            validate_workspace_root_directory,
            browse_workspace_root_directory,
            list_workspace_directory,
            read_workspace_file,
            read_workspace_file_image,
            read_workspace_file_diff,
            rename_workspace_entry,
            delete_workspace_entry,
            move_workspace_entry,
            workspace_threads_read,
            workspace_threads_persist,
            workspace_threads_persist_delta,
            workspace_agent_session_history_list,
            architecture_repositories,
            architecture_scanned_result,
            architecture_graphs_list,
            architecture_graph_read,
            architecture_graph_save,
            architecture_graph_revisions_list,
            architecture_graph_revision_read,
            architecture_graph_revision_restore,
            architecture_graph_delete,
            architecture_global_root,
            architecture_named_root,
            architecture_graph_copy,
            pcb_documents_list,
            pcb_document_read,
            pcb_document_create,
            pcb_document_delete,
            pcb_watch_start,
            pcb_panel_open,
            pcb_panel_focus,
            pcb_panel_close,
            pcb_window_open,
            pcb_window_close,
            delete_workspace_local_metadata,
            run_forge_prompt,
            agent_thread_turn_start,
            save_todo_image_attachments,
            save_todo_text_attachment,
            whisper_model_status,
            download_whisper_model,
            select_whisper_model,
            uninstall_whisper_model,
            audio_input_devices,
            audio_input_permission_status,
            open_audio_input_permissions,
            start_audio_input_monitor,
            stop_audio_input_monitor,
            begin_audio_input_capture,
            finish_audio_input_capture,
            prepare_whisper_model,
            transcribe_whisper_audio,
            cancel_whisper_transcription,
            start_deepgram_realtime_transcription,
            stop_deepgram_realtime_transcription,
            prewarm_cloud_voice_agent_stream,
            start_cloud_voice_agent_stream,
            set_cloud_voice_agent_input_enabled,
            finish_cloud_voice_agent_input,
            stop_cloud_voice_agent_stream,
            send_cloud_voice_agent_text_message,
            voice_orchestrator_diagnostic_log,
            read_orchestrator_voice_history,
            write_orchestrator_voice_history,
            prewarm_forge_dictation_transcription,
            start_forge_dictation_transcription,
            stop_forge_dictation_transcription,
            audio_shortcuts_status,
            audio_push_to_talk_status,
            audio_cancel_shortcut_scope,
            open_audio_shortcut_permissions,
            open_macos_fn_key_settings,
            set_audio_shortcut,
            reset_audio_shortcuts,
            voice_text_rules_get,
            voice_text_rules_set,
            snipping_status,
            snipping_shortcuts_status,
            set_snipping_enabled,
            set_snipping_hide_desktop_icons,
            set_snipping_freeze_screen,
            set_snipping_upload_public,
            set_snipping_shortcut,
            reset_snipping_shortcuts,
            open_snipping_permissions,
            snipping_capture_screenshot,
            snipping_begin_area_snip,
            snipping_begin_area_recording,
            snipping_area_overlay_status,
            snipping_area_overlay_ready,
            snipping_log_area_cursor_event,
            snipping_finish_area_snip,
            snipping_start_area_recording,
            snipping_stop_recording,
            snipping_recording_status,
            snipping_recent_capture_toasts,
            snipping_dismiss_capture_toast,
            snipping_upload_untracked_asset,
            snipping_upload_untracked_asset_to_cloud,
            snipping_publish_uploaded_asset,
            snipping_delete_uploaded_asset_from_cloud,
            snipping_save_edited_untracked_asset,
            snipping_open_annotation_editor,
            snipping_read_asset_data_url,
            snipping_open_snip_float,
            snipping_open_snip_float_for_drag,
            snipping_snip_float_open,
            snipping_close_snip_float,
            snipping_close_snip_float_for_path,
            snipping_close_annotation_editor,
            snipping_recent_snips,
            snipping_toggle_snip_strip,
            snipping_close_snip_strip,
            snipping_set_strip_interaction_guard,
            snipping_float_assigned_path,
            snipping_preview_drag_started,
            snipping_consume_snip_preview,
            snipping_set_dispatch_targets,
            snipping_dispatch_targets,
            snipping_open_annotation_editor_batch,
            snipping_copy_untracked_asset_to_clipboard,
            snipping_copy_text_to_clipboard,
            snipping_cancel_area_snip,
            audio_widget_status,
            audio_widget_bar_hover_snapshot,
            audio_widget_log_bubble_position,
            audio_widget_position_bottom_bar,
            audio_widget_clear_bottom_bar_position,
            audio_widget_show_error_overlay,
            audio_widget_hide_error_overlay,
            audio_widget_release_keyboard_focus,
            show_audio_widget,
            hide_audio_widget,
            toggle_audio_widget,
            activity_overlay_status,
            show_activity_overlay,
            hide_activity_overlay,
            toggle_activity_overlay,
            insert_transcribed_text,
            insert_handsfree_transcribed_text,
            note_main_window_minimize_requested,
            terminal_recover_crashed_sessions,
            cloud_mcp_connect,
            cloud_mcp_reconnect_now,
            cloud_mcp_enter_offline_mode,
            cloud_mcp_get_desktop_device_profile,
            cloud_mcp_get_status,
            cloud_mcp_get_network_diagnostics,
            cloud_mcp_get_cached_workspace_todos,
            cloud_mcp_get_billing_status,
            cloud_mcp_register_workspace,
            cloud_mcp_sync_workspace,
            cloud_mcp_sync_agent_installations,
            cloud_mcp_sync_device_workspaces_snapshot,
            cloud_mcp_delete_workspace,
            cloud_mcp_delete_agent_chat_session,
            cloud_mcp_sync_tokenomics_state,
            cloud_mcp_schedule_tokenomics_sync,
            cloud_mcp_reset_device_tokenomics,
            tokenomics_scan_usage,
            tokenomics_scan_realtime_usage,
            tokenomics_scan_usage_silent,
            tokenomics_resync_last_30_days,
            tokenomics_get_summary,
            tokenomics_get_live_limits,
            tokenomics_get_sync_payload,
            tokenomics_get_sync_delta,
            tokenomics_record_usage,
            cloud_mcp_reset_server_state,
            cloud_mcp_account_repo_catalog,
            cloud_mcp_get_account_documents,
            cloud_mcp_hydrate_account_document,
            cloud_mcp_prepare_account_document_draft,
            cloud_mcp_save_account_document_draft,
            cloud_mcp_discard_account_document_draft,
            cloud_mcp_save_account_document,
            cloud_mcp_delete_account_document,
            local_scripts_list,
            local_scripts_read,
            local_scripts_save,
            local_scripts_delete,
            local_scripts_run,
            local_scripts_cancel_run,
            local_scripts_run_history,
            cloud_mcp_get_account_tools,
            cloud_mcp_report_cli_snapshot,
            cloud_mcp_start_remote_command_listener,
            cloud_mcp_record_remote_command_status,
            cloud_mcp_get_audio_preferences,
            cloud_mcp_set_audio_preferences,
            cloud_mcp_record_voice_plan_task_status,
            cloud_mcp_update_voice_plan_steps,
            cloud_mcp_get_loopspaces,
            cloud_mcp_sync_loopspaces,
            cloud_mcp_create_loopspace,
            cloud_mcp_rename_loopspace,
            cloud_mcp_delete_loopspace,
            cloud_mcp_get_loopspace_graph,
            cloud_mcp_sync_loopspace_graph,
            cloud_mcp_update_loopspace_graph,
            cloud_mcp_get_loopspace_triggers,
            cloud_mcp_get_loopspace_logs,
            cloud_mcp_sync_loopspace_logs,
            cloud_mcp_sync_loopspace_triggers,
            cloud_mcp_create_loopspace_trigger,
            cloud_mcp_update_loopspace_trigger,
            cloud_mcp_run_loopspace_trigger,
            cloud_mcp_delete_loopspace_trigger,
            cloud_mcp_list_account_assets,
            cloud_mcp_list_asset_clouds,
            cloud_mcp_save_asset_cloud,
            cloud_mcp_validate_asset_cloud,
            cloud_mcp_set_default_asset_cloud,
            cloud_mcp_delete_asset_cloud,
            cloud_mcp_register_account_asset,
            cloud_mcp_upload_account_asset,
            cloud_mcp_download_account_asset,
            cloud_mcp_cancel_asset_transfer,
            cloud_mcp_delete_cloud_account_asset,
            cloud_mcp_publish_account_asset,
            cloud_mcp_delete_local_account_asset,
            cloud_mcp_get_account_asset_status,
            cloud_mcp_agent_list_assets,
            cloud_mcp_agent_get_asset_root,
            cloud_mcp_agent_upload_asset,
            cloud_mcp_agent_upload_asset_status,
            cloud_mcp_agent_download_asset,
            cloud_mcp_agent_download_asset_status,
            diffforge_start_untracked_assets_watcher,
            diffforge_list_untracked_assets,
            diffforge_delete_untracked_asset,
            diffforge_rename_untracked_asset,
            diffforge_save_untracked_data_url_asset,
            diffforge_save_untracked_text_asset,
            todo_dispatch_receipts_get,
            todo_dispatch_receipt_record,
            todo_dispatch_notify_queue_drained,
            todo_dispatch_queue_sync,
            todo_dispatch_settle_terminal_input_ready,
            todo_dispatch_dispatcher_heartbeat,
            todo_dispatch_startup_reconciliation_state,
            todo_dispatch_backend_submit_now,
            todo_dispatch_backend_submissions_drain,
            todo_dispatch_overview,
            todo_dispatch_queue_get,
            todo_store_snapshot,
            todo_store_history,
            todo_store_create,
            todo_store_update,
            todo_store_delete,
            todo_store_cancel,
            todo_store_dispatch_loopspace_batch,
            todo_store_queue_all,
            todo_store_set_status,
            todo_read_image_data_url,
            agent_accounts_state,
            agent_accounts_update_display,
            agent_accounts_set_active,
            agent_accounts_remove,
            agent_accounts_pane_profiles,
            app_enter_background,
            app_exit_background,
            app_background_mode_state,
            background_monitor_open_activity,
            background_monitor_open_snip_strip,
            hyperframe_transcribe_audio,
            hyperframe_save_media_transcript,
            hyperframe_media_transcript_status,
            polish_audio_transcription,
            audio_history_append,
            audio_history_import,
            audio_history_page,
            audio_history_summary,
            audio_history_clear,
            diffforge_copy_asset_to_clipboard,
            diffforge_copy_image_data_url_to_clipboard,
            diffforge_untrack_account_asset,
            diffforge_promote_untracked_asset,
            cloud_mcp_archive_workspace_todos,
            cloud_mcp_request_workspace_todo_dispatch,
            cloud_mcp_record_todo_dispatch_status,
            cloud_mcp_commit_workspace_todo_sync,
            cloud_mcp_get_activity,
            cloud_mcp_hydrate_workspace_todos,
            agent_thread_session_discover,
            agent_thread_transcript,
            agent_thread_transcript_watch,
            workspace_git_pull_candidates,
            workspace_git_pull_repositories,
            workspace_git_snapshot,
            workspace_git_file_diff,
            workspace_git_generate_commit_message,
            workspace_git_commit_and_push,
            workspace_initialize_git,
            terminal_open,
            terminal_record_provider_session,
            terminal_start_agent,
            terminal_start_agent_many,
            set_terminal_audio_input_target,
            set_terminal_audio_route_gate,
            terminal_write_to_audio_input_target,
            terminal_write,
            terminal_request_fork,
            terminal_input_transport_endpoint,
            terminal_output_transport_endpoint,
            app_control_mcp_reply,
            terminal_capture_direct_prompt_todo,
            terminal_write_realtime,
            terminal_refresh_theme,
            terminal_windows_pty_info,
            terminal_set_diagnostic_logging,
            terminal_diagnostic_log,
            thread_bridge_diagnostic_log,
            bigview_sync_diagnostic_log,
            workspace_activation_diagnostic_log,
            workspace_activation_diagnostic_log_many,
            terminal_status_log,
            windows_terminal_set_diagnostic_logging,
            windows_terminal_diagnostic_log,
            terminal_provider_turn_completed,
            terminal_delete_selection,
            terminal_cancel_parked_task,
            terminal_interrupt_agent,
            resize_terminal,
            terminal_resize,
            terminal_close,
            terminal_close_all,
            terminal_headless_output_delta,
            terminal_headless_output_snapshot,
            terminal_window_open,
            terminal_window_close,
            terminal_window_focus,
            terminal_drag_session_begin,
            terminal_drag_session_end,
            tools_window_open,
            tools_window_close,
            tools_window_focus,
            web_panel_open,
            web_panel_close,
            web_panel_focus,
            terminal_pane_runtime_info,
            terminal_live_sessions,
            coordination::tauri_commands::coordination_init,
            coordination::tauri_commands::coordination_bootstrap_workspace,
            coordination::tauri_commands::coordination_workspace_targets,
            coordination::tauri_commands::coordination_get_snapshot,
            coordination::tauri_commands::coordination_terminal_todo_plan_snapshot,
            coordination::tauri_commands::coordination_terminal_todo_plan_edit_step_title,
            coordination::tauri_commands::coordination_terminal_todo_plan_finish,
            coordination::tauri_commands::coordination_log_ui_surface_event,
            coordination::tauri_commands::coordination_cleanup_bloat_dry_run,
            coordination::tauri_commands::coordination_start_file_watcher,
            coordination::tauri_commands::coordination_stop_file_watcher,
            coordination::tauri_commands::coordination_get_file_watcher_status,
            coordination::tauri_commands::coordination_get_alignment_report,
            coordination::tauri_commands::coordination_get_workspace_mcp_status,
            coordination::tauri_commands::coordination_global_mcp_defaults_root,
            coordination::tauri_commands::coordination_workspace_mcp_registry,
            coordination::tauri_commands::coordination_workspace_mcp_registry_background,
            coordination::tauri_commands::coordination_add_workspace_mcp_marketplace,
            coordination::tauri_commands::coordination_remove_workspace_mcp_marketplace,
            coordination::tauri_commands::coordination_index_workspace_mcp_marketplace,
            coordination::tauri_commands::coordination_install_workspace_mcp_server,
            coordination::tauri_commands::coordination_update_workspace_mcp_server,
            coordination::tauri_commands::coordination_uninstall_workspace_mcp_server,
            coordination::tauri_commands::coordination_upsert_workspace_mcp_secret,
            coordination::tauri_commands::coordination_delete_workspace_mcp_secret,
            coordination::tauri_commands::coordination_activate_shared_mcp_daemon,
            coordination::tauri_commands::coordination_activate_shared_mcp_daemon_background,
            coordination::tauri_commands::coordination_deactivate_shared_mcp_daemon,
            coordination::tauri_commands::coordination_stop_all_shared_mcp_daemons,
            coordination::tauri_commands::coordination_create_session,
            coordination::tauri_commands::coordination_heartbeat_session,
            coordination::tauri_commands::coordination_acquire_lease,
            coordination::tauri_commands::coordination_release_lease,
            coordination::tauri_commands::coordination_list_events,
            coordination::tauri_commands::coordination_list_resources,
            coordination::tauri_commands::coordination_list_active_leases,
            coordination::tauri_commands::coordination_write_memory,
            coordination::tauri_commands::coordination_search_memory,
            coordination::tauri_commands::coordination_write_contract_memory,
            coordination::tauri_commands::coordination_write_handoff_memory,
            coordination::tauri_commands::coordination_get_repo_policy,
            coordination::tauri_commands::coordination_update_repo_policy,
            coordination::tauri_commands::coordination_create_worktree,
            coordination::tauri_commands::coordination_validate_patch,
            coordination::tauri_commands::coordination_submit_patch,
            coordination::tauri_commands::coordination_submit_patch_status,
            coordination::tauri_commands::coordination_worktree_diff_summary,
            coordination::tauri_commands::coordination_undo_worktree_diff_summary,
            coordination::tauri_commands::coordination_request_merge,
            coordination::tauri_commands::coordination_initialize_merge_resolution,
            coordination::tauri_commands::coordination_apply_merge,
            coordination::tauri_commands::coordination_list_workspace_violations,
            coordination::tauri_commands::coordination_list_workspace_changes,
            coordination::tauri_commands::coordination_resolve_workspace_violation,
            coordination::tauri_commands::coordination_db_classify_sql,
            coordination::tauri_commands::coordination_db_get_mode,
            coordination::tauri_commands::coordination_db_request_change,
            coordination::tauri_commands::coordination_db_list_change_requests,
            coordination::tauri_commands::coordination_db_get_change_request,
            coordination::tauri_commands::coordination_db_request_approval,
            coordination::tauri_commands::coordination_db_propose_migration,
            coordination::tauri_commands::coordination_request_approval,
            coordination::tauri_commands::coordination_resolve_approval,
            coordination::tauri_commands::coordination_scan_workspace_violations,
            deactivate_workspace_runtime,
            close_app_after_terminal_shutdown
        ])
        .build(tauri::generate_context!())
        .expect("error while building Diff Forge AI desktop")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { ref api, .. } = event {
                let phase = APP_SHUTDOWN_PHASE.load(Ordering::Acquire);

                if phase == APP_SHUTDOWN_PHASE_RUNNING {
                    api.prevent_exit();
                    let _ = start_backend_app_shutdown(app.clone(), "main".to_string());
                    return;
                }

                if phase < APP_SHUTDOWN_PHASE_EXITING {
                    api.prevent_exit();
                    let _ = start_backend_app_shutdown(app.clone(), "main".to_string());
                    return;
                }

                cleanup_windows_headless_console_hosts();
            }

            #[cfg(not(target_os = "macos"))]
            let _ = app;

            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if app_is_in_background_mode() {
                    app_exit_background_internal(app);
                } else {
                    restore_main_window_after_reopen(app.clone(), has_visible_windows);
                }
            }
        });
}

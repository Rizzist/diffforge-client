#![recursion_limit = "512"]

use std::{
    collections::{BTreeSet, HashMap, HashSet, VecDeque},
    env, fs,
    io::{BufRead, Read, Seek, SeekFrom, Write},
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
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{mpsc, oneshot, Mutex, OwnedMutexGuard, RwLock},
    time::{sleep, timeout},
};
use tokio_tungstenite::{
    accept_async, connect_async, connect_async_with_config,
    tungstenite::{
        client::IntoClientRequest, http::HeaderValue, protocol::WebSocketConfig, Message,
    },
    MaybeTlsStream, WebSocketStream,
};

mod codex_config;
pub mod coordination;
mod energy_impact;

const DEFAULT_API_BASE_URL: &str = "https://diffforge.ai/api";
const DEFAULT_WEB_LOGIN_URL: &str = "https://diffforge.ai/desktop/login";
const STARTUP_SETTINGS_STATE_KEY: &str = "startup-settings";
const TRAY_CLICK_SETTINGS_STATE_KEY: &str = "tray-click-settings";
const STARTUP_LAUNCH_MODE_BACKGROUND: &str = "background";
const STARTUP_BACKGROUND_ARG: &str = "--background-startup";

fn api_base_url() -> String {
    env::var("DIFFFORGE_API_BASE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
        .unwrap_or_else(|| DEFAULT_API_BASE_URL.to_string())
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
const DESKTOP_AUTH_PROVISION_REDEEM_TIMEOUT_SECS: u64 = 10;
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
const MAX_FORGE_IMAGES: usize = 5;
const MAX_FORGE_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_FORGE_IMAGE_TOTAL_BYTES: usize = 20 * 1024 * 1024;
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
// One display frame: under agent output floods the previous 6ms window still
// crossed the IPC bridge ~166x/sec/terminal — the webview timeline measured
// the resulting message-event + microtask storm at ~5s of a 26s recording.
// 16ms halves-to-thirds the event rate at an imperceptible echo latency.
const TERMINAL_OUTPUT_COALESCE_WINDOW_MS: u64 = 16;
// A remote controller is waiting on the authoritative PTY echo. Keep a small
// batching window to absorb split escape sequences without paying a full
// display frame for ordinary interactive typing.
const TERMINAL_REMOTE_OUTPUT_COALESCE_WINDOW_MS: u64 = 4;
const TERMINAL_OUTPUT_COALESCE_MAX_BYTES: usize = 64 * 1024;
const TERMINAL_OUTPUT_COALESCE_QUEUE_CAPACITY: usize = 64;
const TERMINAL_HEADLESS_OUTPUT_TAIL_BYTES: usize = 512 * 1024;
const TERMINAL_PARKED_RESUME_SUBMIT_DELAY_MS: u64 = 120;
const TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE: &str = "\r";
const TERMINAL_ACTIVITY_HOOK_POLL_MS: u64 = 50;
const TERMINAL_ACTIVITY_HOOK_BACKOFF_POLL_MS: u64 = 250;
const TERMINAL_ACTIVITY_HOOK_IDLE_POLL_MS: u64 = 1_000;
const TERMINAL_ACTIVITY_HOOK_FALLBACK_POLL_MS: u64 = 2_000;
const TERMINAL_ACTIVITY_HOOK_BACKOFF_UNCHANGED_POLLS: u32 = 4;
const TERMINAL_ACTIVITY_TRANSPORT_CONNECT_TIMEOUT_MS: u64 = 150;
const TERMINAL_ACTIVITY_TRANSPORT_IO_TIMEOUT_MS: u64 = 1_000;
const TERMINAL_STRUCTURED_INTERACTION_WAIT_SECONDS: u64 = 570;
// Once an answer has been written or handed to a provider API, only the
// provider's resolution event remains. Bound that confirmation gap so a lost
// follow-up cannot leave the terminal prompting forever.
const STRUCTURED_ANSWER_CONFIRMATION_TIMEOUT_SECS: u64 = 90;
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
const PROD_BUNDLE_IDENTIFIER: &str = "ai.diffforge.desktop";
const DEV_BUNDLE_IDENTIFIER: &str = "ai.diffforge.desktop.dev";
const DEVICE_APP_STATE_DIR: &str = "app-state";
const DEVICE_WORKSPACE_CATALOG_DIR: &str = "workspace-catalog";
const TERMINAL_PROCESS_EPOCH_COUNTER_FILE: &str = "terminal-process-epoch-counter.log";
// Keep the leading order token above every plausible legacy millisecond
// epoch while remaining exactly representable by JavaScript Number.
const TERMINAL_PROCESS_EPOCH_SEQUENCE_BASE: u64 = 4_000_000_000_000_000;
const TERMINAL_PROCESS_EPOCH_MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;
const DEVICE_DATA_MIGRATION_LOCK_STALE_SECS: u64 = 30 * 60;
const LOCAL_WORKSPACE_TOMBSTONE_RETENTION_MS: u64 = 90 * 24 * 60 * 60 * 1000;
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
const APP_SHUTDOWN_LIFECYCLE_LOCK_TIMEOUT_SECS: u64 = 10;
const WORKSPACE_ACTIVATE_TERMINAL_READY_TIMEOUT_SECS: u64 = 20;
const WORKSPACE_ACTIVATE_TERMINAL_READY_POLL_MS: u64 = 250;
const WORKSPACE_ACTIVATE_DEFAULT_TERMINAL_COUNT: usize = 1;
const WORKSPACE_ACTIVATE_MAX_TERMINAL_COUNT: usize = 24;
const WORKSPACE_DEACTIVATE_TERMINAL_TIMEOUT_SECS: u64 = 25;
const TERMINAL_CLOSE_ALL_LIFECYCLE_TIMEOUT_SECS: u64 = 25;
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
// Off by default (user request 2026-07-07); the env-var launch path below
// still re-enables workspace-activation tracing per run when needed.
const WORKSPACE_ACTIVATION_DIAGNOSTIC_LOGGING_ENABLED: bool = false;
const WORKSPACE_ACTIVATION_DIAGNOSTIC_LOG_FILE: &str = "workspace-activation.jsonl";
const VOICE_ORCHESTRATOR_DIAGNOSTIC_LOGGING_ENABLED: bool = false;
const VOICE_ORCHESTRATOR_DIAGNOSTIC_LOG_FILE: &str = "voice-orchestrator.jsonl";
const TERMINAL_STATUS_LOGGING_ENABLED: bool = cfg!(debug_assertions);
const TERMINAL_STATUS_LOG_FILE: &str = "terminal-statuses.jsonl";
/// Persist the cloud sync/connect loop into logs/cloud-sync.jsonl:
/// every connection-state note, ws phase change, route resolution, open
/// attempt (with durations), disconnect reason, and outbox depth.
const CLOUD_SYNC_LOGGING_ENABLED: bool = cfg!(debug_assertions);
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
const SNIPPING_WINDOWS_DEBUG_LOGGING_ENABLED: bool = false;
const SNIPPING_WINDOWS_DEBUG_LOG_FILE: &str = "snipping-windows-debug.jsonl";
const SNIPPING_AREA_CURSOR_DEBUG_LOGGING_ENABLED: bool = SNIPPING_WINDOWS_DEBUG_LOGGING_ENABLED;
const SNIPPING_AREA_CURSOR_DEBUG_LOG_FILE: &str = SNIPPING_WINDOWS_DEBUG_LOG_FILE;
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
const MAIN_WINDOW_CURSOR_BACKOFF_POLL_MS: u64 = 150;
const MAIN_WINDOW_CURSOR_FOCUSED_IDLE_POLL_MS: u64 = 400;
const MAIN_WINDOW_CURSOR_IDLE_POLL_MS: u64 = 500;
const MAIN_WINDOW_CURSOR_HIDDEN_POLL_MS: u64 = 5_000;
const MAIN_WINDOW_CURSOR_BACKOFF_UNCHANGED_SAMPLES: u32 = 4;
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
static DAEMON_MODE: AtomicBool = AtomicBool::new(false);
static DAEMON_LOCK_PATH: OnceLock<PathBuf> = OnceLock::new();
static APP_CLOSE_SHUTDOWN_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static APP_CLOSE_FORCE_EXIT_SCHEDULED: AtomicBool = AtomicBool::new(false);
static APP_CLOSE_FORCE_EXIT_STARTED: AtomicBool = AtomicBool::new(false);
static APP_SHUTDOWN_PHASE: AtomicU8 = AtomicU8::new(APP_SHUTDOWN_PHASE_RUNNING);
static TERMINAL_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static THREAD_BRIDGE_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static BIGVIEW_SYNC_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static WORKSPACE_ACTIVATION_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static VOICE_ORCHESTRATOR_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static TERMINAL_STATUS_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static CLOUD_SYNC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static TERMINAL_STATUS_LOGGING_RESOLVED: OnceLock<bool> = OnceLock::new();
static CLOUD_SYNC_LOGGING_RESOLVED: OnceLock<bool> = OnceLock::new();
static WORKSPACE_ACTIVATION_LOGGING_RESOLVED: OnceLock<bool> = OnceLock::new();
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
const WHISPER_RUNTIME_INSTALL_HINT: &str = "Install whisper.cpp CLI with Homebrew: brew install whisper-cpp. If Homebrew is missing, install it from https://brew.sh, then recheck.";
#[cfg(target_os = "macos")]
const WHISPER_HOMEBREW_MISSING_HINT: &str = "Homebrew is required to install whisper.cpp automatically. Install Homebrew from https://brew.sh, then recheck.";
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
// Match the widget's locked recording window. Local Whisper receives one WAV
// after release, so trimming shorter here silently drops the start of long takes.
const AUDIO_CAPTURE_MAX_SECONDS: f64 = 900.0;
const AUDIO_CAPTURE_PREROLL_MS: u64 = 500;
const WHISPER_PARTIAL_MIN_CHUNK_MS: u64 = 10_000;
const WHISPER_PARTIAL_MAX_CHUNK_MS: u64 = 35_000;
const WHISPER_PARTIAL_SILENCE_MS: u64 = 750;
const WHISPER_PARTIAL_MIN_TAIL_MS: u64 = 1_200;
const WHISPER_PARTIAL_FINISH_TIMEOUT_SECS: u64 = 600;
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

pub fn daemon_mode_active() -> bool {
    DAEMON_MODE.load(Ordering::Relaxed)
}

fn set_daemon_mode_active(active: bool) {
    DAEMON_MODE.store(active, Ordering::Relaxed);
}

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
        todo_store_orphan_sweep_shutdown_notify();
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
    pending_restart_intents: Arc<StdMutex<HashMap<String, TerminalPendingRestartIntent>>>,
    next_restart_intent_seq: AtomicU64,
    terminal_input_queues: Arc<StdMutex<HashMap<String, TerminalInputQueueHandle>>>,
    terminal_input_transport: Arc<StdMutex<Option<TerminalInputTransportEndpoint>>>,
    terminal_output_transport: Arc<StdMutex<Option<TerminalOutputTransportEndpoint>>>,
    terminal_activity_transport: Arc<StdMutex<Option<TerminalActivityTransportEndpoint>>>,
    terminal_activity_transport_tokens: Arc<StdMutex<HashMap<String, String>>>,
    terminal_structured_interactions: Arc<StdMutex<HashMap<String, TerminalStructuredInteraction>>>,
    terminal_structured_interaction_waiters: Arc<StdMutex<HashMap<String, oneshot::Sender<Value>>>>,
    terminal_output_transport_subscribers:
        Arc<StdMutex<HashMap<String, Vec<TerminalOutputTransportSubscriber>>>>,
    parked_prompts: Arc<RwLock<HashMap<String, TerminalParkedPrompt>>>,
    active_audio_input_target: Arc<StdMutex<Option<TerminalAudioInputTarget>>>,
    audio_route_gate: Arc<StdMutex<TerminalAudioRouteGate>>,
    lifecycle_lock: Arc<Mutex<()>>,
    pty_pool: Arc<PtyPool>,
    cleanup_tracker: Arc<TerminalCleanupTracker>,
    workspace_topology_cache: Arc<RwLock<HashMap<String, TerminalWorkspaceTopologySnapshot>>>,
    terminal_process_epoch: String,
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
struct TerminalInputTransportEndpoint {
    url: String,
    token: String,
}

#[derive(Deserialize)]
struct TerminalInputTransportEnvelope {
    token: String,
    message_id: Option<String>,
    payload: TerminalInputEventPayload,
}

#[derive(Serialize)]
struct TerminalInputTransportAck {
    r#type: &'static str,
    message_id: String,
    ok: bool,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
struct TerminalOutputTransportEndpoint {
    url: String,
    token: String,
}

#[derive(Clone, Serialize)]
struct TerminalActivityTransportEndpoint {
    host: String,
    port: u16,
    token: String,
}

#[derive(Deserialize)]
struct TerminalActivityTransportEnvelope {
    r#type: String,
    token: String,
    event: Value,
}

#[derive(Serialize)]
struct TerminalActivityTransportAck {
    r#type: &'static str,
    ok: bool,
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hook_response: Option<Value>,
}

#[derive(Clone, Debug)]
struct TerminalStructuredInteraction {
    interaction_id: String,
    revision: u64,
    pane_id: String,
    instance_id: u64,
    provider: String,
    /// Provider session id stamped when the interaction OPENS (empty when the
    /// opening event carried none). Request/tool ids are only unique WITHIN a
    /// provider session (OpenCode namespaces them by session), so resolution
    /// matchers require session equality whenever both sides carry one — a
    /// delayed event from session A must not unlatch session B after an
    /// in-PTY relaunch reuses an id.
    provider_session_id: String,
    provider_request_id: String,
    /// Provider tool call id bound to this prompt, when the opening request
    /// carried one. OpenCode permission ids (`per_*`) differ from tool ids
    /// (`edit_*`/`read_*`), so request identity and tool-execution identity
    /// are tracked separately.
    tool_use_id: Option<String>,
    prompt_id: String,
    hook_event_name: String,
    response_mode: String,
    awaiting_provider_confirmation: bool,
    claimed_option_id: Option<String>,
    options: Vec<TerminalActivityHookPromptOption>,
    permission_suggestions: Option<Value>,
    prompt_questions: Option<Value>,
    prompt_schema: Option<Value>,
    provider_payload: Option<Value>,
    prompt_metadata: TerminalStructuredInteractionPromptMetadata,
}

#[derive(Clone, Debug, Default)]
struct TerminalStructuredInteractionPromptMetadata {
    approval_id: Option<String>,
    permission_prompt_id: Option<String>,
    permission_request_id: Option<String>,
    permission_mode: Option<String>,
    prompt_kind: Option<String>,
    prompt_default_option: Option<String>,
    prompt_ttl_ms: Option<u64>,
    prompt_url: Option<String>,
    allows_free_text: bool,
    manual_prompt_source: Option<String>,
    manual_approval_required: bool,
    prompting_user_kind: Option<String>,
    prompting_user_source: Option<String>,
    prompting_user_confidence: Option<String>,
    prompting_user_text: Option<String>,
}

#[derive(Deserialize)]
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
        if let Ok(mut interactions) = self.terminal_structured_interactions.lock() {
            interactions.clear();
        }
        if let Ok(mut waiters) = self.terminal_structured_interaction_waiters.lock() {
            waiters.clear();
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
    local_whisper_partial: Arc<Mutex<Option<LocalWhisperPartialSession>>>,
    local_whisper_partial_generation: Arc<AtomicU64>,
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
    terminal_state_contract_version: u8,
    canonical_state: String,
    canonical_badge_label: String,
    canonical_state_seq: u64,
    prompt_state_seq: u64,
    turn_generation: u64,
    completed_turn_generation: u64,
    turn_active: bool,
    active_interaction_id: Option<String>,
    active_interaction_revision: Option<u64>,
    interaction_actionable: bool,
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
    /// ORIGIN timestamp (hook CLI fire time) of the event that parked the
    /// session in WAITING; zero outside waiting. Ordering checks compare
    /// candidate origins against this, never `updated_at_ms` — ingestion
    /// time moves on unrelated writes (provider-session recording) and lives
    /// on a different clock than hook fire time.
    waiting_origin_ms: u64,
    /// Last-known live background work counts (from Claude Stop evidence);
    /// latched so passive frames while WAITING keep the visual cue. None =
    /// no evidence yet.
    background_task_counts: Option<TerminalBackgroundTaskCounts>,
}

#[derive(Clone, Debug, Serialize)]
struct TerminalPendingRestartIntent {
    pane_id: String,
    instance_id: u64,
    launch_epoch: String,
    target_role: String,
    fresh_session: bool,
    provider_session_id: Option<String>,
    mode: String,
    coordinator_id: String,
    requested_at_ms: u64,
    deadline_at_ms: u64,
    restart_intent_seq: u64,
    state: String,
}

#[derive(Clone, Default)]
struct TerminalLaunchRuntimeMetadata {
    model: Option<String>,
    model_source: Option<String>,
    reasoning_effort: Option<String>,
    speed: Option<String>,
    permission_mode: Option<String>,
    /// Latest unresolved provider/session error. Kept with the launch/runtime
    /// metadata so periodic live-state snapshots cannot erase an error that
    /// arrived on the faster hook or protocol lane.
    provider_error: Option<Value>,
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
        let canonical_state = if activity_status == "starting" || status == "starting" {
            "starting"
        } else {
            "idle"
        };
        Self {
            terminal_state_contract_version: 1,
            canonical_state: canonical_state.to_string(),
            canonical_badge_label: canonical_state.to_string(),
            // Canonical lifecycle ordering is per terminal instance. Wall-clock
            // time belongs in `updated_at_ms`; using it here lets a later open
            // snapshot outrank a real runtime transition.
            canonical_state_seq: 1,
            prompt_state_seq: 0,
            turn_generation: 0,
            completed_turn_generation: 0,
            turn_active: false,
            active_interaction_id: None,
            active_interaction_revision: None,
            interaction_actionable: false,
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
            waiting_origin_ms: 0,
            background_task_counts: None,
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
    // Admission is the close/write/runtime-publication linearization point.
    // A guarded idle restart may only mark `closing` while no operation is
    // active; stale clones then fail closed instead of writing after removal.
    operation_admission: Arc<StdMutex<TerminalOperationAdmissionState>>,
    coordination: Option<TerminalCoordinationSession>,
    session_mode: TerminalSessionMode,
    metadata: TerminalInstanceMetadata,
    runtime: Arc<StdMutex<TerminalRuntimeSnapshot>>,
    launch_metadata: Arc<StdMutex<TerminalLaunchRuntimeMetadata>>,
    // Prepared PTYs freeze their provider account at terminal_open. Deferred
    // and legacy starts must reuse this exact binding instead of sampling the
    // account that happens to be active when the later start command arrives.
    launch_account_binding: Option<TerminalProviderLaunchAccountBinding>,
    // Managed Codex panes run the stock TUI against a per-terminal local
    // app-server gateway.  The gateway is deliberately separate from the PTY:
    // terminal rendering/input remain native while structured JSON-RPC server
    // requests can also be answered from the web dashboard.
    codex_gateway: Arc<StdMutex<Option<TerminalCodexGatewayHandle>>>,
    // Whether this pane was opened with the app-control orchestrator MCP. Kept
    // so deferred/resume agent starts can re-inject app-control (and its
    // auto-approval) the same way the initial open does.
    app_control_mcp_requested: bool,
}

#[derive(Clone)]
struct TerminalCodexGatewayHandle {
    endpoint: String,
    shutdown: Arc<StdMutex<Option<oneshot::Sender<()>>>>,
}

#[derive(Default)]
struct TerminalOperationAdmissionState {
    active: usize,
    closing: bool,
}

impl TerminalCodexGatewayHandle {
    fn shutdown(&self) {
        if let Ok(mut shutdown) = self.shutdown.lock() {
            if let Some(sender) = shutdown.take() {
                let _ = sender.send(());
            }
        }
    }
}

struct TerminalHeadlessOutputBuffer {
    epoch: u64,
    total_bytes: u64,
    tail: VecDeque<u8>,
    vt: vt100::Parser,
}

#[derive(Serialize)]
struct TerminalHeadlessOutputSnapshot {
    bytes_base64: String,
    epoch: u64,
    instance_id: u64,
    pane_id: String,
    tail_bytes: usize,
    total_bytes: u64,
}

#[derive(Serialize)]
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
    fn new(rows: u16, cols: u16) -> Self {
        Self {
            epoch: 0,
            total_bytes: 0,
            tail: VecDeque::new(),
            vt: vt100::Parser::new(rows.max(1), cols.max(1), 10_000),
        }
    }

    fn append(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }

        self.vt.process(data);
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

    fn resize_vt(&mut self, rows: u16, cols: u16) {
        // vt100::Grid::set_size truncates rows and cells in place. That makes
        // the headless checkpoint permanently lose fullscreen TUI content
        // even though the native xterm still renders it. Rebuild the parser
        // from the retained ordered PTY bytes at the new geometry instead.
        let mut resized = vt100::Parser::new(rows.max(1), cols.max(1), 10_000);
        if !self.tail.is_empty() {
            let replay = self.tail.iter().copied().collect::<Vec<_>>();
            resized.process(&replay);
        }
        self.vt = resized;
    }

    fn vt_state(&self) -> Vec<u8> {
        let screen = self.vt.screen();
        let mut state = Vec::new();
        if screen.alternate_screen() {
            state.extend_from_slice(b"\x1b[?1049h");
        }
        state.extend_from_slice(&screen.state_formatted());
        state
    }

    /// The bottom `count` rows of the CURRENT VT screen as plain text, with
    /// trailing blank rows trimmed. Unlike the raw `tail` (an append-only
    /// byte journal), this reflects what a viewer actually sees right now:
    /// content that was overwritten in place or scrolled away by later
    /// output — a TUI footer after the CLI exited to its wrapper shell —
    /// is NOT here, so liveness detectors keyed on visible markers cannot be
    /// satisfied by stale bytes.
    fn vt_screen_bottom_rows(&self, count: usize) -> Vec<String> {
        let screen = self.vt.screen();
        let (_, cols) = screen.size();
        let mut rows: Vec<String> = screen.rows(0, cols).collect();
        while rows.last().is_some_and(|row| row.trim().is_empty()) {
            rows.pop();
        }
        if rows.len() > count {
            rows.drain(..rows.len() - count);
        }
        rows
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

impl Default for TerminalHeadlessOutputBuffer {
    fn default() -> Self {
        Self::new(24, 80)
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
    terminal_process_epoch: String,
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
            terminal_process_epoch: String::new(),
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
    runtime: TerminalRuntimeSnapshot,
}

impl TerminalCloudMcpCloseContext {
    fn from_instance(instance: &TerminalInstance) -> Self {
        Self {
            working_directory: Arc::clone(&instance.working_directory),
            active_task: Arc::clone(&instance.active_task),
            coordination: instance.coordination.clone(),
            session_mode: instance.session_mode,
            metadata: instance.metadata.clone(),
            runtime: terminal_runtime_snapshot(instance),
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
struct TerminalParkedWaitingOn {
    agent_id: Option<String>,
    agent_label: Option<String>,
    slot_key: Option<String>,
    task_id: Option<String>,
    task_title: Option<String>,
    resource_key: Option<String>,
}

#[derive(Clone, Serialize)]
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
        launch_metadata: TerminalLaunchRuntimeMetadata,
        launch_account_binding: Option<TerminalProviderLaunchAccountBinding>,
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
                headless_output: Arc::new(StdMutex::new(TerminalHeadlessOutputBuffer::new(
                    size.rows, size.cols,
                ))),
                working_directory: Arc::new(working_directory),
                agent_started: Arc::new(Mutex::new(agent_started)),
                input_gate: Arc::new(Mutex::new(TerminalInputGate::default())),
                input_queue: Arc::new(Mutex::new(())),
                active_task: Arc::new(Mutex::new(None)),
                operation_admission: Arc::new(StdMutex::new(
                    TerminalOperationAdmissionState::default(),
                )),
                coordination,
                session_mode,
                metadata,
                runtime: Arc::new(StdMutex::new(initial_runtime)),
                launch_metadata: Arc::new(StdMutex::new(launch_metadata)),
                launch_account_binding,
                codex_gateway: Arc::new(StdMutex::new(None)),
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
struct BackendStatus {
    ok: bool,
    endpoint: String,
    message: String,
}

#[derive(Serialize)]
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct AgentUpdateProgress {
    provider: String,
    from_version: String,
    to_version: String,
    stage: String,
    stage_seq: u64,
    started_at_ms: u64,
    updated_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    failed_stage: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct AgentInstallProgressSignal {
    stage: &'static str,
    error_reason: Option<String>,
    failed_stage: Option<&'static str>,
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

#[derive(Clone, Debug, Serialize)]
struct AgentInstallResult {
    provider: &'static str,
    label: &'static str,
    ok: bool,
    installed: bool,
    updated: bool,
    permission_denied: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    failed_stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    stderr: String,
    installed_version: String,
    command: &'static str,
    native_install_url: &'static str,
    message: String,
}

#[derive(Serialize)]
struct AgentLoginStart {
    provider: &'static str,
    command: &'static str,
    message: String,
}

#[derive(Serialize)]
struct AgentLogoutResult {
    provider: &'static str,
    label: &'static str,
    disconnected: bool,
    message: String,
}

#[derive(Serialize)]
struct ForgeRunResult {
    provider: &'static str,
    label: &'static str,
    model: String,
    output: String,
    stderr: String,
    working_directory: String,
}

#[derive(Serialize)]
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
struct ForgePromptRequest {
    provider: String,
    prompt: String,
    model: Option<String>,
    working_directory: Option<String>,
    images: Option<Vec<ForgePromptImage>>,
}

#[derive(Deserialize)]
struct AgentThreadTurnRequest {
    agent_id: String,
    provider_session_id: Option<String>,
    prompt: String,
    model: Option<String>,
    working_directory: Option<String>,
}

#[derive(Deserialize)]
struct ForgePromptImage {
    name: String,
    mime_type: String,
    data_url: String,
}

#[derive(Serialize, Clone)]
struct AgentImageInputStatus {
    supported: bool,
    support: &'static str,
    reason: String,
    active_model: String,
    active_model_supports_images: bool,
}

#[derive(Deserialize)]
struct TodoTextAttachmentRequest {
    title: Option<String>,
    text: String,
}

#[derive(Clone, Debug, Serialize)]
struct SavedTodoImageAttachment {
    name: String,
    mime_type: String,
    path: String,
}

#[derive(Serialize)]
struct SavedTodoTextAttachment {
    line_count: usize,
    path: String,
    title: String,
}

#[derive(Serialize)]
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
struct WorkspaceFileOperationResult {
    root: String,
    relative_path: String,
    target_relative_path: Option<String>,
    parent_relative_path: String,
}

#[derive(Deserialize)]
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
struct TerminalStartAgentPaneResult {
    pane_id: String,
    instance_id: Option<u64>,
    model: Option<String>,
    model_source: Option<String>,
    effective_provider_session_id: Option<String>,
    started: bool,
    skipped: bool,
    message: String,
}

#[derive(Serialize)]
struct TerminalStartAgentManyResult {
    started: usize,
    skipped: usize,
    results: Vec<TerminalStartAgentPaneResult>,
}

#[derive(Serialize)]
struct TerminalOpenResult {
    pane_id: String,
    instance_id: u64,
    launch_epoch: String,
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
    permission_mode: Option<String>,
    activity_status: String,
    command_phase: String,
    input_ready: bool,
    input_ready_at: Option<String>,
    terminal_work_state: String,
}

#[derive(Deserialize)]
struct TerminalProviderSessionRecordRequest {
    pane_id: String,
    instance_id: Option<u64>,
    provider_session_id: String,
    source: Option<String>,
}

#[derive(Serialize)]
struct TerminalProviderSessionRecordResult {
    pane_id: String,
    instance_id: u64,
    provider_session_id: String,
    recorded: bool,
    source: String,
}

#[derive(Serialize, Clone)]
struct TerminalExitPayload {
    pane_id: String,
    instance_id: u64,
    exit_code: Option<i32>,
    exited_at_ms: u64,
}

#[derive(Deserialize, Clone)]
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
struct TerminalInputErrorPayload {
    pane_id: String,
    instance_id: Option<u64>,
    message: String,
}

#[derive(Serialize, Clone)]
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

#[derive(Debug, Serialize, Clone)]
struct TerminalActivityHookPromptOption {
    id: String,
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    danger: Option<bool>,
}

/// Counts of live harness-owned background work, classified from the Claude
/// Code Stop hook's `background_tasks` / `session_crons` evidence. Drives the
/// WAITING visual cue (client + dashboard): the user sees WHAT the session is
/// waiting on.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq, Default)]
struct TerminalBackgroundTaskCounts {
    shells: u32,
    subagents: u32,
    monitors: u32,
    other: u32,
}

impl TerminalBackgroundTaskCounts {
    fn total(&self) -> u32 {
        self.shells
            .saturating_add(self.subagents)
            .saturating_add(self.monitors)
            .saturating_add(self.other)
    }
}

#[derive(Serialize, Clone)]
struct TerminalActivityHookPayload {
    pane_id: String,
    instance_id: u64,
    terminal_process_epoch: String,
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
    terminal_state_contract_version: u8,
    canonical_state: String,
    canonical_badge_label: String,
    canonical_state_seq: u64,
    prompt_state_seq: u64,
    turn_generation: u64,
    #[serde(skip_serializing)]
    turn_generation_explicit: bool,
    completed_turn_generation: u64,
    turn_active: bool,
    active_interaction_id: Option<String>,
    active_interaction_revision: Option<u64>,
    interaction_actionable: bool,
    turn_settlement_accepted: bool,
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
    background_work_active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    background_task_counts: Option<TerminalBackgroundTaskCounts>,
    input_ready_at: Option<String>,
    prompt_ready_at: Option<String>,
    completed_at: Option<String>,
    provider_session_id: Option<String>,
    native_session_id: Option<String>,
    fork_from_provider_session_id: Option<String>,
    provider_turn_id: Option<String>,
    turn_id: Option<String>,
    provider_error: Option<Value>,
    transcript_path: Option<String>,
    cwd: Option<String>,
    user_message: Option<String>,
    message: Option<String>,
    live_text_delta: Option<String>,
    live_text_snapshot: Option<String>,
    live_text_kind: Option<String>,
    tool_name: Option<String>,
    tool_use_id: Option<String>,
    tool_server: Option<String>,
    tool_input: Option<Value>,
    tool_output: Option<Value>,
    tool_error: Option<Value>,
    raw_tool_payload: Option<Value>,
    command: Option<String>,
    file_path: Option<String>,
    duration_ms: Option<u64>,
    exit_code: Option<i64>,
    approval_id: Option<String>,
    permission_prompt_id: Option<String>,
    permission_request_id: Option<String>,
    permission_mode: Option<String>,
    prompt_id: Option<String>,
    prompt_kind: Option<String>,
    prompt_default_option: Option<String>,
    prompt_ttl_ms: Option<u64>,
    prompt_options: Vec<TerminalActivityHookPromptOption>,
    prompt_questions: Option<Value>,
    prompt_schema: Option<Value>,
    prompt_url: Option<String>,
    provider_payload: Option<Value>,
    allows_free_text: bool,
    prompt_answer_option: Option<String>,
    interaction_id: Option<String>,
    interaction_revision: Option<u64>,
    #[serde(skip_serializing)]
    event_interaction_id: Option<String>,
    #[serde(skip_serializing)]
    event_interaction_revision: Option<u64>,
    interaction_source: Option<String>,
    interaction_response_mode: Option<String>,
    provider_request_id: Option<String>,
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
struct TerminalOutputStatePayload {
    pane_id: String,
    instance_id: u64,
    looks_active: bool,
    looks_ready: bool,
    status_truth: String,
    output_preview: String,
}

#[derive(Serialize)]
struct TerminalCloseAllResult {
    closed: usize,
}

#[derive(Serialize, Clone)]
struct TerminalCloseAllProgressPayload {
    closed: usize,
    total: usize,
    pane_id: Option<String>,
    instance_id: Option<u64>,
    workspace_id: Option<String>,
}

#[derive(Serialize, Clone)]
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
struct AudioInputDeviceSummary {
    device_id: String,
    label: String,
    is_default: bool,
}

#[derive(Serialize, Clone)]
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
struct AudioInputMonitorRequest {
    device_id: Option<String>,
    owner: Option<String>,
}

#[derive(Serialize, Clone)]
struct AudioInputMonitorStatus {
    monitoring: bool,
    device_id: String,
    label: String,
    sample_rate: u32,
    owner_count: usize,
    engine: &'static str,
    echo_cancellation: bool,
}

#[derive(Serialize, Clone)]
struct AudioInputStats {
    device_id: String,
    engine: &'static str,
    echo_cancellation: bool,
    rms: f32,
    peak: f32,
    buffer_ms: u64,
    frequency_bands: Vec<f32>,
    time_domain_samples: Vec<f32>,
}

#[derive(Serialize)]
struct AudioInputCaptureResult {
    audio_base64: String,
    audio_ms: u64,
}

#[derive(Serialize, Clone)]
struct AudioShortcutRegistrationStatus {
    shortcut: String,
    default_shortcut: String,
    registered: bool,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
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
struct AudioShortcutSettingsStatus {
    push_to_talk: AudioShortcutRegistrationStatus,
    cancel: AudioShortcutRegistrationStatus,
    permissions: AudioShortcutPermissionStatus,
}

#[derive(Serialize, Deserialize, Clone)]
struct AudioShortcutBindings {
    push_to_talk: String,
    cancel: String,
}

#[derive(Deserialize)]
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
struct WhisperModelRequest {
    model_id: Option<String>,
}

#[derive(Serialize, Clone)]
struct WhisperModelDownloadProgress {
    state: String,
    model_id: Option<String>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<f64>,
    message: String,
}

#[derive(Serialize)]
struct WhisperWarmStatus {
    prepared: bool,
    cached: bool,
    model_path: String,
    elapsed_ms: u128,
    warmed_bytes: u64,
}

#[derive(Deserialize)]
struct WhisperTranscriptionRequest {
    audio_base64: String,
    audio_ms: Option<u64>,
    capture_peak: Option<f32>,
    capture_rms: Option<f32>,
}

#[derive(Serialize)]
struct WhisperTranscriptionResult {
    text: String,
    segments: usize,
    duration_ms: u128,
}

struct LocalWhisperPartialSession {
    session_id: String,
    cancel_flag: Arc<AtomicBool>,
    finished_rx: Option<oneshot::Receiver<Result<LocalWhisperPartialTranscriptionResult, String>>>,
}

#[derive(Deserialize)]
struct LocalWhisperPartialStartRequest {
    session_id: String,
    history_id: Option<String>,
    min_chunk_ms: Option<u64>,
    max_chunk_ms: Option<u64>,
    silence_ms: Option<u64>,
}

#[derive(Deserialize)]
struct LocalWhisperPartialStopRequest {
    session_id: String,
}

#[derive(Deserialize)]
struct LocalWhisperPartialCancelRequest {
    session_id: Option<String>,
}

#[derive(Serialize)]
struct LocalWhisperPartialStartStatus {
    active: bool,
    session_id: String,
}

#[derive(Clone, Serialize)]
struct LocalWhisperPartialChunkResult {
    index: u64,
    start_ms: u64,
    end_ms: u64,
    audio_ms: u64,
    text: String,
    reason: String,
    duration_ms: u128,
}

#[derive(Serialize)]
struct LocalWhisperPartialTranscriptionResult {
    text: String,
    segments: usize,
    duration_ms: u128,
    audio_ms: u64,
    chunks: Vec<LocalWhisperPartialChunkResult>,
    partial: bool,
    cancelled: bool,
}

#[derive(Deserialize)]
struct DeepgramRealtimeStartRequest {
    api_key: String,
    language: Option<String>,
}

#[derive(Serialize)]
struct DeepgramRealtimeStartStatus {
    active: bool,
    language: String,
    model: &'static str,
    sample_rate: u32,
}

#[derive(Deserialize)]
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
    /// Audio-settings language code; the cloud speaks its fast
    /// acknowledgement line in this language.
    language: Option<String>,
}

#[derive(Deserialize)]
struct CloudVoiceAgentControlRequest {
    client_session_id: Option<String>,
    owner_id: Option<String>,
    voice_session_id: Option<String>,
}

#[derive(Deserialize)]
struct CloudVoiceAgentTextMessageRequest {
    text: String,
    turn_index: Option<u64>,
    repo_id: Option<String>,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    workspace_root: Option<String>,
}

#[derive(Serialize)]
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
struct OrchestratorVoiceHistoryReadRequest {
    #[serde(rename = "root_directory")]
    _root_directory: Option<String>,
    workspace_id: String,
}

#[derive(Serialize)]
struct OrchestratorVoiceHistoryReadResult {
    items: Value,
    path: String,
    workspace_id: String,
}

#[derive(Deserialize)]
struct OrchestratorVoiceHistoryWriteRequest {
    #[serde(rename = "root_directory")]
    _root_directory: Option<String>,
    workspace_id: String,
    items: Value,
}

#[derive(Serialize)]
struct OrchestratorVoiceHistoryWriteResult {
    saved: usize,
    path: String,
    workspace_id: String,
}

#[derive(Serialize, Clone)]
struct DeepgramRealtimeTranscriptEvent {
    text: String,
    is_final: bool,
    speech_final: bool,
    provider: String,
    history_id: String,
}

#[derive(Serialize, Clone)]
struct AudioWidgetVisibility {
    visible: bool,
    installed: bool,
    shortcut: String,
}

#[derive(Serialize, Clone)]
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
include!("video_editor.rs");
include!("video_tier1.rs");
include!("video_code.rs");
include!("video_polish.rs");
include!("video_annotate.rs");
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
include!("swarm_runtime.rs");
include!("orchestrator_pool.rs");
include!("tools_window.rs");
include!("web_panel.rs");
include!("api.rs");
include!("activity_overlay.rs");
include!("todo_dispatch.rs");
include!("agent_accounts.rs");
include!("ssh_profiles.rs");
include!("background_mode.rs");
include!("app_updater.rs");
include!("vm_sandbox.rs");
include!("audio.rs");
include!("audio_history.rs");
include!("handsfree_audio.rs");
include!("voice_text_rules.rs");
include!("snipping.rs");

pub(crate) fn diagnostic_log_path(file_name: &str) -> PathBuf {
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

fn diagnostic_env_truthy(name: &str) -> bool {
    env::var(name)
        .ok()
        .map(|value| {
            let value = value.trim().to_ascii_lowercase();
            !matches!(value.as_str(), "" | "0" | "false" | "off" | "no")
        })
        .unwrap_or(false)
}

fn terminal_status_logging_enabled() -> bool {
    *TERMINAL_STATUS_LOGGING_RESOLVED.get_or_init(|| {
        TERMINAL_STATUS_LOGGING_ENABLED || diagnostic_env_truthy("DIFFFORGE_TERMINAL_STATUS_LOG")
    })
}

fn cloud_sync_logging_enabled() -> bool {
    *CLOUD_SYNC_LOGGING_RESOLVED.get_or_init(|| {
        CLOUD_SYNC_LOGGING_ENABLED || diagnostic_env_truthy("DIFFFORGE_CLOUD_SYNC_LOG")
    })
}

fn workspace_activation_logging_enabled() -> bool {
    *WORKSPACE_ACTIVATION_LOGGING_RESOLVED.get_or_init(|| {
        WORKSPACE_ACTIVATION_DIAGNOSTIC_LOGGING_ENABLED
            || diagnostic_env_truthy("DIFFFORGE_WORKSPACE_ACTIVATION_LOG")
    })
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
    if !workspace_activation_logging_enabled() || entries.is_empty() {
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

fn audio_widget_bottom_bar_debug_logging_enabled() -> bool {
    if AUDIO_WIDGET_BOTTOM_BAR_DEBUG_LOGGING_ENABLED {
        return true;
    }

    env::var("RUST_DIFFFORGE_AUDIO_WIDGET_BOTTOM_BAR_DEBUG_LOGS")
        .or_else(|_| env::var("DIFFFORGE_AUDIO_WIDGET_BOTTOM_BAR_DEBUG_LOGS"))
        .ok()
        .map(|value| {
            let value = value.trim().to_ascii_lowercase();
            !matches!(value.as_str(), "0" | "false" | "off" | "no")
        })
        .unwrap_or(false)
}

/// Size cap for terminal-statuses.jsonl: on overflow the current file rotates
/// to `<name>.1` (replacing any previous rotation) so the always-on status log
/// can never grow unbounded (it had reached 722 MB in the wild).
const TERMINAL_STATUS_LOG_MAX_BYTES: u64 = 32 * 1024 * 1024;

fn write_terminal_status_log_entry(entry: Value) {
    if !terminal_status_logging_enabled() {
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

    if fs::metadata(&log_path)
        .map(|metadata| metadata.len() >= TERMINAL_STATUS_LOG_MAX_BYTES)
        .unwrap_or(false)
    {
        let rotated = log_path.with_extension("jsonl.1");
        let _ = fs::rename(&log_path, rotated);
    }

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
    if daemon_mode_active() && phase.starts_with("backend.app_update.") {
        // Release builds disable the JSONL diagnostic sinks, so headless BYOC
        // daemons would otherwise have zero OTA visibility. systemd captures
        // stderr into journald; keep it to one terse sanitized line per event.
        eprintln!(
            "diffforge-ota {} {}",
            clean_terminal_telemetry_text(phase),
            app_update_scrub_external_text(&fields.to_string())
        );
    }
    if !terminal_status_logging_enabled() {
        forward_terminal_status_to_energy_if_needed(phase, "backend", fields);
        return;
    }

    write_terminal_status_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_terminal_diagnostic_log_text(phase),
        "source": "backend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": fields,
    }));
}

fn forward_terminal_status_to_energy_if_needed(phase: &str, source: &str, fields: Value) {
    if phase.starts_with("frontend.render_probe")
        || phase.starts_with("frontend.invoke_probe")
        || phase.starts_with("frontend.freeze_probe")
        || phase.starts_with("frontend.commit_profiler")
        || phase.starts_with("frontend.stringify_probe")
        || phase.starts_with("frontend.webgl_mode")
    {
        energy_impact::energy_impact_log_render_storm(phase, source, fields);
    }
}

/// Cloud sync/connect loop trace (gated by CLOUD_SYNC_LOGGING_ENABLED),
/// written to logs/cloud-sync.jsonl in the project root.
fn log_cloud_sync_event(phase: &str, fields: Value) {
    if !cloud_sync_logging_enabled() {
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

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
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

/// Lets the frontend skip building/sending activation diagnostic batches when
/// the sink is off. Enabled by the build const or DIFFFORGE_WORKSPACE_ACTIVATION_LOG=1.
#[tauri::command(rename_all = "snake_case")]
fn workspace_activation_diagnostic_logging_status() -> bool {
    workspace_activation_logging_enabled()
}

#[tauri::command(rename_all = "snake_case")]
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

/// Webview → Rust attention mirror: what the user is looking at plus the
/// native-notification preference, so Rust-side notification paths can gate
/// on watched workspaces and honor the setting (they previously could not).
#[tauri::command(rename_all = "snake_case")]
fn attention_state_update(
    focused: bool,
    selected_workspace_id: Option<String>,
    terminals_view_visible: bool,
    native_notifications_enabled: Option<bool>,
) -> Result<(), String> {
    native_attention_state_update(NativeAttentionState {
        focused,
        native_enabled_override: native_notifications_enabled,
        selected_workspace_id: selected_workspace_id.unwrap_or_default().trim().to_string(),
        terminals_view_visible,
    });
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
fn terminal_status_log(phase: String, fields: Value) -> Result<(), String> {
    if !terminal_status_logging_enabled() {
        forward_terminal_status_to_energy_if_needed(&phase, "frontend", fields);
        return Ok(());
    }

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

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
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
            log_cloud_sync_event("backend.app_panic", fields.clone());
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
            daemon_lockfile_remove_current();
            app_for_exit.exit(0);

            thread::sleep(Duration::from_millis(APP_CLOSE_DESTROY_FALLBACK_DELAY_MS));

            if let Some(window) = app_for_exit.get_window(&window_label) {
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

fn mark_app_force_exit_scheduled(flag: &AtomicBool) -> bool {
    flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
}

fn mark_app_force_exit_started(flag: &AtomicBool) -> bool {
    flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
}

fn normalize_app_force_exit_reason(reason: Option<String>, fallback: &str) -> String {
    reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(clean_terminal_telemetry_text)
        .unwrap_or_else(|| fallback.to_string())
}

fn run_app_force_exit_tail(app_for_exit: AppHandle, window_label: Option<String>, reason: String) {
    if !mark_app_force_exit_started(&APP_CLOSE_FORCE_EXIT_STARTED) {
        return;
    }

    log_terminal_crash_forensics_event(
        "backend.app_force_exit.start",
        json!({
            "reason": reason,
            "window_label": window_label.as_deref().unwrap_or(""),
        }),
    );
    cloud_mcp_send_shutdown_goodbye_blocking();
    let _ = close_workspace_webviews(&app_for_exit);
    advance_app_shutdown_phase(APP_SHUTDOWN_PHASE_EXITING);
    cleanup_windows_headless_console_hosts();
    daemon_lockfile_remove_current();
    app_for_exit.exit(0);

    thread::sleep(Duration::from_millis(APP_CLOSE_DESTROY_FALLBACK_DELAY_MS));

    if let Some(window_label) = window_label.as_deref() {
        if let Some(window) = app_for_exit.get_window(window_label) {
            let _ = window.destroy();
        }
    }

    thread::sleep(Duration::from_millis(
        APP_CLOSE_PROCESS_EXIT_FALLBACK_DELAY_MS,
    ));
    cleanup_windows_headless_console_hosts();
    std::process::exit(0);
}

fn spawn_app_force_exit_thread(
    app_for_exit: AppHandle,
    window_label: Option<String>,
    delay: Duration,
    thread_name: &'static str,
    reason: String,
) -> Result<(), String> {
    thread::Builder::new()
        .name(thread_name.to_string())
        .spawn(move || {
            if delay > Duration::from_millis(0) {
                thread::sleep(delay);
            }
            run_app_force_exit_tail(app_for_exit, window_label, reason);
        })
        .map(|_| ())
        .map_err(|error| format!("Failed to schedule app force exit: {error}"))
}

fn schedule_app_force_exit(app_for_exit: AppHandle, window_label: String) -> Result<(), String> {
    if !mark_app_force_exit_scheduled(&APP_CLOSE_FORCE_EXIT_SCHEDULED) {
        return Ok(());
    }

    match spawn_app_force_exit_thread(
        app_for_exit,
        Some(window_label),
        Duration::from_millis(APP_CLOSE_FORCE_EXIT_FALLBACK_DELAY_MS),
        "diffforge-app-close-watchdog",
        "watchdog".to_string(),
    ) {
        Ok(()) => Ok(()),
        Err(error) => {
            APP_CLOSE_FORCE_EXIT_SCHEDULED.store(false, Ordering::Release);
            Err(error)
        }
    }
}

async fn lock_lifecycle_with_timeout(
    lifecycle_lock: Arc<Mutex<()>>,
    timeout_duration: Duration,
) -> Option<OwnedMutexGuard<()>> {
    timeout(timeout_duration, lifecycle_lock.lock_owned())
        .await
        .ok()
}

#[cfg(test)]
mod app_shutdown_tests {
    use super::*;

    #[test]
    fn app_force_exit_schedule_marker_is_idempotent() {
        let scheduled = AtomicBool::new(false);

        assert!(mark_app_force_exit_scheduled(&scheduled));
        assert!(!mark_app_force_exit_scheduled(&scheduled));

        scheduled.store(false, Ordering::Release);
        assert!(mark_app_force_exit_scheduled(&scheduled));
    }

    #[test]
    fn app_force_exit_started_marker_is_idempotent_and_separate() {
        let scheduled = AtomicBool::new(false);
        let started = AtomicBool::new(false);

        assert!(mark_app_force_exit_scheduled(&scheduled));
        assert!(mark_app_force_exit_started(&started));
        assert!(!mark_app_force_exit_started(&started));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn lifecycle_lock_timeout_returns_none_when_held() {
        let lifecycle_lock = Arc::new(Mutex::new(()));
        let _held = lifecycle_lock.lock().await;

        let guard =
            lock_lifecycle_with_timeout(Arc::clone(&lifecycle_lock), Duration::from_millis(10))
                .await;

        assert!(guard.is_none());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn lifecycle_lock_timeout_returns_guard_when_available() {
        let lifecycle_lock = Arc::new(Mutex::new(()));

        let guard =
            lock_lifecycle_with_timeout(Arc::clone(&lifecycle_lock), Duration::from_millis(100))
                .await;

        assert!(guard.is_some());
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct WorkspaceActivationWorkspace {
    id: String,
    name: String,
    root: String,
    root_was_empty_at_selection: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct WorkspaceActivationTerminalDescriptor {
    terminal_index: u16,
    role: String,
    pane_id: String,
    slot_key: String,
    thread_id: Option<String>,
    provider: Option<String>,
    provider_session_id: Option<String>,
    fork_from_provider_session_id: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    speed: Option<String>,
    permission_mode: Option<String>,
    working_directory: String,
    terminal_name: Option<String>,
    terminal_nickname: Option<String>,
    plain_shell: bool,
}

struct WorkspaceActivationSpawnResult {
    descriptor: WorkspaceActivationTerminalDescriptor,
    open_result: Option<TerminalOpenResult>,
    error: Option<String>,
    // Pane was already live in TerminalState — kept as-is, not respawned.
    adopted: bool,
}

fn workspace_activation_log(phase: &str, fields: Value) {
    write_workspace_activation_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_terminal_diagnostic_log_text(phase),
        "source": "backend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": fields,
    }));
}

fn workspace_activation_text(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key))
        .and_then(|value| match value {
            Value::String(text) => Some(text.trim().to_string()),
            Value::Number(number) => Some(number.to_string()),
            Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty())
}

fn workspace_activation_bool(value: &Value, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .find_map(|key| value.get(*key))
        .and_then(|value| match value {
            Value::Bool(value) => Some(*value),
            Value::String(text) => match text.trim().to_ascii_lowercase().as_str() {
                "1" | "true" | "yes" | "on" => Some(true),
                "0" | "false" | "no" | "off" => Some(false),
                _ => None,
            },
            Value::Number(number) => Some(number.as_i64().unwrap_or_default() != 0),
            _ => None,
        })
}

fn workspace_activation_usize(value: &Value, keys: &[&str]) -> Option<usize> {
    keys.iter()
        .find_map(|key| value.get(*key))
        .and_then(|value| match value {
            Value::Number(number) => number.as_u64().map(|value| value as usize),
            Value::String(text) => text.trim().parse::<usize>().ok(),
            _ => None,
        })
}

fn workspace_activation_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|key| value.get(*key))
        .and_then(|value| match value {
            Value::Number(number) => number.as_i64(),
            Value::String(text) => text.trim().parse::<i64>().ok(),
            _ => None,
        })
}

fn workspace_activation_nested_text(value: &Value, paths: &[&[&str]]) -> Option<String> {
    paths.iter().find_map(|path| {
        let mut cursor = value;
        for key in *path {
            cursor = cursor.get(*key)?;
        }
        match cursor {
            Value::String(text) => Some(text.trim().to_string()),
            Value::Number(number) => Some(number.to_string()),
            Value::Bool(value) => Some(value.to_string()),
            _ => None,
        }
        .filter(|value| !value.is_empty())
    })
}

fn workspace_activation_clean_role(value: Option<&str>) -> String {
    let normalized = value
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '_'], "-");
    match normalized.as_str() {
        "claude-code" | "claudecode" => "claude".to_string(),
        "open-code" | "open-code-ai" | "opencode-ai" => "opencode".to_string(),
        "terminal" | "shell" | "plain-shell" | "plain_shell" => "generic".to_string(),
        "claude" | "codex" | "generic" | "opencode" => normalized,
        _ => "codex".to_string(),
    }
}

fn workspace_activation_agent_id_for_role(role: &str) -> String {
    if role.trim().is_empty() {
        "agent".to_string()
    } else {
        workspace_activation_clean_role(Some(role))
    }
}

fn workspace_activation_agent_label(role: &str) -> String {
    match workspace_activation_clean_role(Some(role)).as_str() {
        "claude" => "Claude Code".to_string(),
        "codex" => "Codex".to_string(),
        "generic" => "Terminal".to_string(),
        "opencode" => "OpenCode".to_string(),
        other => other.to_string(),
    }
}

// Mirrors the webview's getSafePaneToken (threadRuntime.js): invalid chars
// map to '-', capped at 48 — pane ids must match byte-for-byte or the GUI
// duplicates instead of adopting, and validate_terminal_pane_id rejects
// anything outside [A-Za-z0-9_:-].
fn workspace_activation_safe_workspace_token(workspace_id: &str) -> String {
    let token = workspace_id
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .take(48)
        .collect::<String>();
    if token.is_empty() {
        "workspace".to_string()
    } else {
        token
    }
}

fn workspace_activation_default_pane_id(
    workspace_id: &str,
    terminal_index: usize,
    role: &str,
) -> String {
    format!(
        "workspace-terminal-{}-{}-{}",
        workspace_activation_safe_workspace_token(workspace_id),
        terminal_index,
        workspace_activation_agent_id_for_role(role)
    )
}

fn workspace_activation_clean_permission_mode(value: Option<&str>, role: &str) -> Option<String> {
    if workspace_activation_clean_role(Some(role)) == "generic" {
        return None;
    }
    let normalized = value
        .unwrap_or("accept_edits")
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '-'], "_");
    let permission = match normalized.as_str() {
        "" | "accept" | "accept_edits" | "accept_edits_automatically" => "accept_edits",
        "ask" | "ask_each_time" | "ask_before_editing" => "ask",
        "bypass" | "bypass_permissions" | "bypasspermissions" => "bypass_permissions",
        _ => "accept_edits",
    };
    Some(permission.to_string())
}

// Array-form settings (terminalRoles, agentPermissions) are persisted by the
// webview POSITIONALLY aligned to logicalTerminalIndexes (see AppShell's
// expandTerminalRolesForSlotIndexes), so arrays are read by list position;
// object-form settings are keyed by the slot index itself.
fn workspace_activation_setting_for_index<'a>(
    value: &'a Value,
    slot_index: usize,
    position: usize,
    keys: &[&str],
) -> Option<&'a Value> {
    for key in keys {
        let Some(candidate) = value.get(*key) else {
            continue;
        };
        if let Some(array) = candidate.as_array() {
            if let Some(item) = array.get(position) {
                return Some(item);
            }
        }
        if let Some(object) = candidate.as_object() {
            let key = slot_index.to_string();
            if let Some(item) = object.get(&key) {
                return Some(item);
            }
        }
    }
    None
}

fn workspace_activation_role_for_index(
    settings: &Value,
    slot_index: usize,
    position: usize,
) -> String {
    workspace_activation_setting_for_index(
        settings,
        slot_index,
        position,
        &["terminalRoles", "terminal_roles"],
    )
    .and_then(|value| match value {
        Value::String(text) => Some(text.as_str()),
        _ => None,
    })
    .map(|value| workspace_activation_clean_role(Some(value)))
    .unwrap_or_else(|| "codex".to_string())
}

fn workspace_activation_permission_for_index(
    settings: &Value,
    slot_index: usize,
    position: usize,
    role: &str,
) -> Option<String> {
    let raw = workspace_activation_setting_for_index(
        settings,
        slot_index,
        position,
        &[
            "agentPermissions",
            "agent_permissions",
            "permissionModes",
            "permission_modes",
        ],
    )
    .and_then(|value| match value {
        Value::String(text) => Some(text.as_str()),
        Value::Object(object) => object
            .get("permissionMode")
            .or_else(|| object.get("permission_mode"))
            .or_else(|| object.get("mode"))
            .and_then(Value::as_str),
        _ => None,
    });
    workspace_activation_clean_permission_mode(raw, role)
}

fn workspace_activation_pane_kind(value: Option<&Value>) -> Option<String> {
    let raw = value.and_then(|value| match value {
        Value::String(text) => Some(text.trim().to_ascii_lowercase()),
        Value::Object(_) => workspace_activation_text(
            value,
            &[
                "kind",
                "paneKind",
                "pane_kind",
                "type",
                "surfaceKind",
                "surface_kind",
            ],
        )
        .map(|value| value.to_ascii_lowercase()),
        _ => None,
    })?;
    let normalized = raw.replace([' ', '_'], "-");
    match normalized.as_str() {
        "terminal" | "agent" | "" => None,
        "web" | "browser" | "web-tab" => Some("web".to_string()),
        "pcb" | "circuit" => Some("pcb".to_string()),
        "vm" | "sandbox" => Some("vm".to_string()),
        "video" | "video-editor" => Some("video".to_string()),
        "swarm" | "swarm-panel" => Some("swarm".to_string()),
        other => Some(other.to_string()),
    }
}

fn workspace_activation_pane_records(settings: &Value) -> HashMap<usize, Value> {
    let mut records = HashMap::new();
    for key in ["panes", "workspacePanes", "workspace_panes"] {
        let Some(value) = settings.get(key) else {
            continue;
        };
        if let Some(array) = value.as_array() {
            for (fallback_index, item) in array.iter().enumerate() {
                let index = workspace_activation_i64(
                    item,
                    &[
                        "logicalIndex",
                        "logical_index",
                        "terminalIndex",
                        "terminal_index",
                        "slotIndex",
                        "slot_index",
                        "index",
                    ],
                )
                .and_then(|value| (value >= 0).then_some(value as usize))
                .unwrap_or(fallback_index);
                records.insert(index, item.clone());
            }
        } else if let Some(object) = value.as_object() {
            for (key, item) in object {
                if let Ok(index) = key.parse::<usize>() {
                    records.insert(index, item.clone());
                }
            }
        }
    }
    records
}

fn workspace_activation_panel_indexes(settings: &Value) -> HashMap<usize, String> {
    let mut indexes = HashMap::new();
    for key in ["paneKinds", "pane_kinds", "panelKinds", "panel_kinds"] {
        let Some(value) = settings.get(key) else {
            continue;
        };
        if let Some(object) = value.as_object() {
            for (key, item) in object {
                let Ok(index) = key.parse::<usize>() else {
                    continue;
                };
                if let Some(kind) = workspace_activation_pane_kind(Some(item)) {
                    indexes.insert(index, kind);
                }
            }
        } else if let Some(array) = value.as_array() {
            for (index, item) in array.iter().enumerate() {
                if let Some(kind) = workspace_activation_pane_kind(Some(item)) {
                    indexes.insert(index, kind);
                }
            }
        }
    }
    for (index, record) in workspace_activation_pane_records(settings) {
        if let Some(kind) = workspace_activation_pane_kind(Some(&record)) {
            indexes.insert(index, kind);
        }
    }
    indexes
}

fn workspace_activation_terminal_count(settings: Option<&Value>) -> usize {
    let Some(settings) = settings else {
        return WORKSPACE_ACTIVATE_DEFAULT_TERMINAL_COUNT;
    };
    if let Some(count) =
        workspace_activation_usize(settings, &["terminalCount", "terminal_count", "terminals"])
    {
        return count.min(WORKSPACE_ACTIVATE_MAX_TERMINAL_COUNT);
    }
    if let Some(array) = settings
        .get("terminalRoles")
        .or_else(|| settings.get("terminal_roles"))
        .and_then(Value::as_array)
    {
        return array.len().min(WORKSPACE_ACTIVATE_MAX_TERMINAL_COUNT);
    }
    if let Some(array) = settings
        .get("logicalTerminalIndexes")
        .or_else(|| settings.get("logical_terminal_indexes"))
        .and_then(Value::as_array)
    {
        return array.len().min(WORKSPACE_ACTIVATE_MAX_TERMINAL_COUNT);
    }
    if workspace_activation_text(settings, &["rootDirectory", "root_directory"]).is_some() {
        return 0;
    }
    WORKSPACE_ACTIVATE_DEFAULT_TERMINAL_COUNT
}

// Returns (slot_index, position) pairs. Position is the index within the
// UNFILTERED logical list (panels included) — the webview persists the
// positional arrays (terminalRoles, agentPermissions) aligned to the full
// logicalTerminalIndexes list, before panel slots are filtered out.
fn workspace_activation_terminal_indexes(
    settings: Option<&Value>,
    terminal_count: usize,
) -> Vec<(usize, usize)> {
    let Some(settings) = settings else {
        return (0..terminal_count).map(|index| (index, index)).collect();
    };
    let panels = workspace_activation_panel_indexes(settings);
    let mut indexes = Vec::new();
    if let Some(array) = settings
        .get("logicalTerminalIndexes")
        .or_else(|| settings.get("logical_terminal_indexes"))
        .and_then(Value::as_array)
    {
        for item in array {
            let index = match item {
                Value::Number(number) => number.as_i64(),
                Value::String(text) => text.trim().parse::<i64>().ok(),
                Value::Object(_) => workspace_activation_i64(
                    item,
                    &[
                        "logicalIndex",
                        "logical_index",
                        "terminalIndex",
                        "terminal_index",
                        "slotIndex",
                        "slot_index",
                        "index",
                    ],
                ),
                _ => None,
            };
            if let Some(index) = index
                .filter(|value| *value >= 0)
                .map(|value| value as usize)
            {
                if !indexes.contains(&index) {
                    indexes.push(index);
                }
            }
        }
    } else {
        let pane_records = workspace_activation_pane_records(settings);
        if !pane_records.is_empty() || !panels.is_empty() {
            let mut configured = pane_records.keys().copied().collect::<Vec<_>>();
            configured.extend(panels.keys().copied());
            configured.sort_unstable();
            configured.dedup();
            indexes = configured;
        }
    }
    if indexes.is_empty() {
        indexes = (0..terminal_count).collect();
    }
    indexes
        .into_iter()
        .enumerate()
        .map(|(position, index)| (index, position))
        .filter(|(index, _)| !panels.contains_key(index))
        .take(WORKSPACE_ACTIVATE_MAX_TERMINAL_COUNT)
        .collect()
}

fn workspace_activation_thread_for_index<'a>(
    threads_state: &'a Value,
    terminal_index: usize,
) -> Option<&'a Value> {
    let terminal_index_key = terminal_index.to_string();
    if let Some(thread_id) = threads_state
        .get("terminal_thread_ids")
        .and_then(|value| value.get(&terminal_index_key))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        if let Some(thread) = threads_state
            .get("threads")
            .and_then(Value::as_object)
            .and_then(|threads| threads.get(thread_id))
        {
            return Some(thread);
        }
    }
    threads_state
        .get("threads")
        .and_then(Value::as_object)
        .and_then(|threads| {
            threads.values().find(|thread| {
                workspace_activation_i64(thread, &["terminal_index", "logical_index"])
                    .is_some_and(|value| value == terminal_index as i64)
            })
        })
}

fn workspace_activation_terminal_record_for_index<'a>(
    threads_state: &'a Value,
    terminal_index: usize,
) -> Option<&'a Value> {
    let key = terminal_index.to_string();
    threads_state
        .get("terminals")
        .and_then(Value::as_object)
        .and_then(|terminals| terminals.get(&key))
}

fn workspace_activation_provider_binding<'a>(thread: &'a Value, role: &str) -> Option<&'a Value> {
    let role = workspace_activation_clean_role(Some(role));
    thread
        .get("provider_bindings")
        .and_then(Value::as_object)
        .and_then(|bindings| {
            bindings
                .get(&role)
                .or_else(|| bindings.get(&workspace_activation_agent_id_for_role(&role)))
        })
}

fn workspace_activation_descriptor_from_sources(
    workspace: &WorkspaceActivationWorkspace,
    settings: Option<&Value>,
    threads_state: &Value,
    terminal_index: usize,
    position: usize,
) -> WorkspaceActivationTerminalDescriptor {
    let empty_settings = Value::Object(serde_json::Map::new());
    let settings = settings.unwrap_or(&empty_settings);
    let role = workspace_activation_role_for_index(settings, terminal_index, position);
    let plain_shell = role == "generic";
    let terminal_record =
        workspace_activation_terminal_record_for_index(threads_state, terminal_index);
    let thread = workspace_activation_thread_for_index(threads_state, terminal_index);
    let binding = thread.and_then(|thread| workspace_activation_provider_binding(thread, &role));
    let pane_record = workspace_activation_pane_records(settings).remove(&terminal_index);
    let pane_id = pane_record
        .as_ref()
        .and_then(|value| {
            workspace_activation_text(value, &["pane_id", "panel_id", "terminal_id", "id"])
        })
        .or_else(|| {
            binding.and_then(|value| {
                workspace_activation_text(value, &["pane_id", "terminal_id", "target_terminal_id"])
            })
        })
        .or_else(|| {
            thread.and_then(|value| {
                workspace_activation_nested_text(
                    value,
                    &[
                        &["terminal_binding", "pane_id"],
                        &["terminal_binding", "pane_id"],
                        &["terminal_binding", "pane_id"],
                        &["terminal_binding", "pane_id"],
                    ],
                )
                .or_else(|| workspace_activation_text(value, &["pane_id", "terminal_id"]))
            })
        })
        .or_else(|| {
            terminal_record.and_then(|value| {
                workspace_activation_text(value, &["pane_id", "terminal_id", "target_terminal_id"])
            })
        })
        .unwrap_or_else(|| {
            workspace_activation_default_pane_id(&workspace.id, terminal_index, &role)
        });
    let slot_key = pane_record
        .as_ref()
        .and_then(|value| workspace_activation_text(value, &["slot_key"]))
        .or_else(|| binding.and_then(|value| workspace_activation_text(value, &["slot_key"])))
        .or_else(|| {
            terminal_record.and_then(|value| workspace_activation_text(value, &["slot_key"]))
        })
        .unwrap_or_else(|| (terminal_index + 1).to_string());
    let thread_id = thread
        .and_then(|value| workspace_activation_text(value, &["id", "thread_id"]))
        .or_else(|| {
            terminal_record.and_then(|value| workspace_activation_text(value, &["thread_id"]))
        });
    let provider = if plain_shell {
        None
    } else {
        binding
            .and_then(|value| workspace_activation_text(value, &["provider", "agent_id"]))
            .map(|value| workspace_activation_clean_role(Some(&value)))
            .or_else(|| Some(role.clone()))
    };
    let provider_session_id = binding
        .and_then(|value| {
            workspace_activation_text(
                value,
                &["provider_session_id", "native_session_id", "session_id"],
            )
        })
        .or_else(|| {
            thread.and_then(|value| {
                workspace_activation_text(
                    value,
                    &[
                        "provider_session_id",
                        "native_session_id",
                        "transcript_session_id",
                    ],
                )
            })
        })
        .or_else(|| {
            terminal_record.and_then(|value| {
                workspace_activation_text(
                    value,
                    &["provider_session_id", "native_session_id", "session_id"],
                )
            })
        })
        .filter(|_| !plain_shell);
    let fork_from_provider_session_id = binding
        .and_then(|value| workspace_activation_text(value, &["fork_from_provider_session_id"]))
        .filter(|_| !plain_shell);
    let model = binding
        .and_then(|value| workspace_activation_text(value, &["model_id", "model"]))
        .or_else(|| {
            terminal_record.and_then(|value| {
                workspace_activation_text(value, &["model", "model_id", "current_model"])
            })
        });
    let reasoning_effort = binding
        .and_then(|value| {
            workspace_activation_text(value, &["reasoning_effort", "effort", "thinking_power"])
        })
        .or_else(|| {
            terminal_record.and_then(|value| {
                workspace_activation_text(value, &["reasoning_effort", "current_effort"])
            })
        });
    let speed = binding
        .and_then(|value| workspace_activation_text(value, &["speed", "service_tier"]))
        .or_else(|| {
            terminal_record
                .and_then(|value| workspace_activation_text(value, &["speed", "service_tier"]))
        });
    let permission_mode =
        workspace_activation_permission_for_index(settings, terminal_index, position, &role);
    let working_directory = binding
        .and_then(|value| {
            workspace_activation_text(value, &["working_directory", "cwd", "repo_path"])
        })
        .or_else(|| {
            terminal_record.and_then(|value| {
                workspace_activation_text(value, &["working_directory", "cwd", "repo_path"])
            })
        })
        .or_else(|| {
            thread.and_then(|value| {
                workspace_activation_nested_text(
                    value,
                    &[
                        &["coordination", "worktree_path"],
                        &["coordination", "worktree_path"],
                        &["worktree", "path"],
                        &["worktree", "root"],
                    ],
                )
                .or_else(|| {
                    workspace_activation_text(value, &["working_directory", "cwd", "repo_path"])
                })
            })
        })
        .unwrap_or_else(|| workspace.root.clone());
    let terminal_name = terminal_record
        .and_then(|value| {
            workspace_activation_text(value, &["terminal_name", "display_name", "name"])
        })
        .or_else(|| Some(workspace_activation_agent_label(&role)));
    let terminal_nickname = terminal_record
        .and_then(|value| workspace_activation_text(value, &["terminal_nickname", "nickname"]));
    WorkspaceActivationTerminalDescriptor {
        terminal_index: terminal_index.min(u16::MAX as usize) as u16,
        role,
        pane_id,
        slot_key,
        thread_id,
        provider,
        provider_session_id,
        fork_from_provider_session_id,
        model,
        reasoning_effort,
        speed,
        permission_mode,
        working_directory,
        terminal_name,
        terminal_nickname,
        plain_shell,
    }
}

fn workspace_activation_terminal_descriptors_from_values(
    workspace: &WorkspaceActivationWorkspace,
    settings: Option<&Value>,
    threads_state: &Value,
) -> Vec<WorkspaceActivationTerminalDescriptor> {
    let terminal_count = workspace_activation_terminal_count(settings);
    workspace_activation_terminal_indexes(settings, terminal_count)
        .into_iter()
        .map(|(index, position)| {
            workspace_activation_descriptor_from_sources(
                workspace,
                settings,
                threads_state,
                index,
                position,
            )
        })
        .collect()
}

fn workspace_activation_catalog_entry_text(entry: &Value, keys: &[&str]) -> Option<String> {
    workspace_activation_text(entry, keys)
}

fn workspace_activation_settings_for_workspace<'a>(
    settings: &'a Value,
    workspace_id: &str,
) -> Option<&'a Value> {
    settings.get(workspace_id).filter(|value| value.is_object())
}

fn workspace_activation_find_workspace_catalog_entry(
    app: &AppHandle,
    workspace_id: &str,
    workspace_settings: &Value,
) -> Result<Option<Value>, String> {
    let catalog_dir = local_workspace_store_dir(app)?;
    if !catalog_dir.exists() {
        return Ok(None);
    }
    let entries = fs::read_dir(&catalog_dir).map_err(|error| {
        format!(
            "Unable to read workspace catalog directory {}: {error}",
            catalog_dir.display()
        )
    })?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(items) = local_workspace_catalog_read_items_from_path(&path) else {
            continue;
        };
        for item in local_workspace_catalog_visible_items(items) {
            let id = local_workspace_catalog_entry_id(&item);
            if id.as_deref() == Some(workspace_id) {
                let mut item = item;
                if let Some(root) = local_workspace_catalog_root_text(&item, workspace_settings) {
                    if let Some(object) = item.as_object_mut() {
                        object.insert("root_directory".to_string(), json!(root));
                    }
                }
                return Ok(Some(item));
            }
        }
    }
    Ok(None)
}

fn workspace_activation_resolve_workspace(
    app: &AppHandle,
    workspace_id: &str,
    workspace_settings: &Value,
) -> Result<WorkspaceActivationWorkspace, String> {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return Err("Workspace activation requires a workspace id.".to_string());
    }
    let settings = workspace_activation_settings_for_workspace(workspace_settings, workspace_id);
    let catalog_entry =
        workspace_activation_find_workspace_catalog_entry(app, workspace_id, workspace_settings)?;
    let root = catalog_entry
        .as_ref()
        .and_then(|entry| {
            workspace_activation_catalog_entry_text(
                entry,
                &["root_directory", "root", "path", "repo_path"],
            )
        })
        .or_else(|| {
            settings.and_then(|settings| {
                workspace_activation_text(settings, &["rootDirectory", "root", "path", "repoPath"])
            })
        })
        .ok_or_else(|| format!("Unknown workspace: {workspace_id}"))?;
    let resolved = resolve_workspace_root_directory(Some(&root))?;
    if !resolved.is_dir() {
        return Err(format!(
            "Workspace root does not exist on disk: {}",
            resolved.display()
        ));
    }
    let name = catalog_entry
        .as_ref()
        .and_then(|entry| {
            workspace_activation_catalog_entry_text(
                entry,
                &["name", "workspace_name", "label", "title"],
            )
        })
        .or_else(|| {
            settings.and_then(|settings| {
                workspace_activation_text(settings, &["name", "workspace_name", "label", "title"])
            })
        })
        .unwrap_or_else(|| workspace_id.to_string());
    let root_was_empty_at_selection = settings
        .and_then(|settings| workspace_activation_bool(settings, &["rootWasEmptyAtSelection"]))
        .unwrap_or(false);
    Ok(WorkspaceActivationWorkspace {
        id: workspace_id.to_string(),
        name,
        root: workspace_path_display(&resolved),
        root_was_empty_at_selection,
    })
}

fn workspace_activation_remote_intent_clear_if_matching(
    app: &AppHandle,
    workspace_id: &str,
) -> Result<(), String> {
    let patch = json!({
        "pendingActivationWorkspaceId": null,
        "pendingActivationReason": null,
        "pendingActivationAtMs": null,
        "pendingActivationSelectWorkspace": null,
        "pendingActivationWorkspaceTab": null,
    });
    app_local_state_clear_if_matching_serialized(
        || app_local_state_read(app, "remote-intents"),
        |current| app_local_state_write_with_mode_unlocked(app, "remote-intents", current, None),
        "pendingActivationWorkspaceId",
        workspace_id,
        &patch,
    )?;
    Ok(())
}

async fn workspace_activation_threads_state(
    workspace_id: &str,
    root: &str,
) -> Result<Value, String> {
    let result = workspace_threads_read(WorkspaceThreadsReadRequest {
        workspaces: vec![WorkspaceThreadsReadWorkspace {
            workspace_id: workspace_id.to_string(),
            root_directory: Some(root.to_string()),
        }],
    })
    .await?;
    Ok(result
        .threads
        .get(workspace_id)
        .cloned()
        .unwrap_or_else(|| json!({})))
}

fn workspace_activation_terminal_request(
    workspace: &WorkspaceActivationWorkspace,
    descriptor: &WorkspaceActivationTerminalDescriptor,
) -> TerminalOpenRequest {
    let role = workspace_activation_clean_role(Some(&descriptor.role));
    let kind = if descriptor.plain_shell {
        "shell".to_string()
    } else {
        role.clone()
    };
    TerminalOpenRequest {
        pane_id: descriptor.pane_id.clone(),
        instance_id: None,
        kind,
        agent_id: Some(role.clone()),
        agent_kind: Some(role),
        provider: descriptor.provider.clone(),
        provider_session_id: descriptor.provider_session_id.clone(),
        fork_from_provider_session_id: descriptor.fork_from_provider_session_id.clone(),
        model: descriptor.model.clone(),
        reasoning_effort: descriptor.reasoning_effort.clone(),
        speed: descriptor.speed.clone(),
        permission_mode: descriptor.permission_mode.clone(),
        plain_shell: Some(descriptor.plain_shell),
        fresh_session: Some(false),
        preserve_coordination_session: Some(true),
        session_mode: Some("general".to_string()),
        slot_key: Some(descriptor.slot_key.clone()),
        terminal_index: Some(descriptor.terminal_index),
        thread_id: descriptor.thread_id.clone(),
        working_directory: Some(descriptor.working_directory.clone()),
        workspace_root_was_empty_at_selection: Some(workspace.root_was_empty_at_selection),
        project_root: None,
        mount_id: None,
        workspace_id: Some(workspace.id.clone()),
        workspace_name: Some(workspace.name.clone()),
        terminal_name: descriptor.terminal_name.clone(),
        terminal_nickname: descriptor.terminal_nickname.clone(),
        app_control_mcp: Some(false),
        cols: Some(TERMINAL_DEFAULT_COLS),
        rows: Some(TERMINAL_DEFAULT_ROWS),
        output_transport: Some(false),
    }
}

fn workspace_activation_ready_json(
    descriptor: &WorkspaceActivationTerminalDescriptor,
    result: &TerminalOpenResult,
    ready: bool,
) -> Value {
    json!({
        "agent_id": descriptor.role,
        "input_ready": ready,
        "instance_id": result.instance_id,
        "pane_id": result.pane_id,
        "provider_session_id": result.provider_session_id,
        "slot_key": descriptor.slot_key,
        "terminal_index": descriptor.terminal_index,
        "thread_id": result.thread_id,
    })
}

async fn workspace_activation_terminal_ready(
    app: &AppHandle,
    pane_id: &str,
    instance_id: u64,
) -> Option<bool> {
    let terminal_state = app.state::<TerminalState>();
    let instance = {
        let guard = terminal_state.terminals.read().await;
        guard
            .get(pane_id)
            .filter(|instance| instance.id == instance_id)
            .cloned()
    }?;
    let parked = {
        let guard = terminal_state.parked_prompts.read().await;
        guard
            .values()
            .any(|prompt| prompt.pane_id == pane_id && prompt.instance_id == instance_id)
    };
    let runtime = terminal_runtime_snapshot(&instance);
    let projected = terminal_project_runtime(&instance.metadata, &runtime, parked);
    let ready = todo_dispatch_core_terminal_ready_for_submit(&runtime, &projected, parked);
    if ready == Some(true) {
        todo_dispatch_refresh_terminal_runtime_from_core(
            pane_id, &instance, &runtime, &projected, true,
        );
    }
    ready
}

async fn workspace_activation_wait_for_readiness(
    app: &AppHandle,
    spawned: &[WorkspaceActivationSpawnResult],
) -> Vec<Value> {
    let deadline =
        Instant::now() + Duration::from_secs(WORKSPACE_ACTIVATE_TERMINAL_READY_TIMEOUT_SECS);
    let mut ready_by_pane: HashMap<String, bool> = spawned
        .iter()
        .filter_map(|spawn| {
            spawn
                .open_result
                .as_ref()
                .map(|result| (result.pane_id.clone(), false))
        })
        .collect();
    while Instant::now() < deadline && ready_by_pane.values().any(|ready| !*ready) {
        for spawn in spawned {
            let Some(result) = spawn.open_result.as_ref() else {
                continue;
            };
            if ready_by_pane.get(&result.pane_id).copied().unwrap_or(false) {
                continue;
            }
            if workspace_activation_terminal_ready(app, &result.pane_id, result.instance_id).await
                == Some(true)
            {
                ready_by_pane.insert(result.pane_id.clone(), true);
            }
        }
        if ready_by_pane.values().all(|ready| *ready) {
            break;
        }
        sleep(Duration::from_millis(
            WORKSPACE_ACTIVATE_TERMINAL_READY_POLL_MS,
        ))
        .await;
    }
    spawned
        .iter()
        .filter_map(|spawn| {
            let result = spawn.open_result.as_ref()?;
            Some(workspace_activation_ready_json(
                &spawn.descriptor,
                result,
                ready_by_pane.get(&result.pane_id).copied().unwrap_or(false),
            ))
        })
        .collect()
}

async fn workspace_activation_workspace_snapshot(
    app: &AppHandle,
    workspace: &WorkspaceActivationWorkspace,
    reason: &str,
) -> Value {
    let terminal_state = app.state::<TerminalState>();
    let instances = {
        let guard = terminal_state.terminals.read().await;
        guard
            .iter()
            .map(|(pane_id, instance)| (pane_id.clone(), instance.clone()))
            .collect::<Vec<_>>()
    };
    let parked = {
        let guard = terminal_state.parked_prompts.read().await;
        guard
            .values()
            .map(|prompt| (prompt.pane_id.clone(), prompt.instance_id))
            .collect::<HashSet<_>>()
    };
    let mut terminals = Vec::new();
    for (pane_id, instance) in instances {
        let metadata = instance.metadata.clone();
        if metadata.workspace_id.trim() != workspace.id {
            continue;
        }
        let runtime = terminal_runtime_snapshot(&instance);
        let launch_metadata = instance
            .launch_metadata
            .lock()
            .map(|metadata| metadata.clone())
            .unwrap_or_default();
        let is_parked = parked.contains(&(pane_id.clone(), instance.id));
        let projected = terminal_project_runtime(&metadata, &runtime, is_parked);
        let input_ready =
            todo_dispatch_core_terminal_ready_for_submit(&runtime, &projected, is_parked)
                == Some(true);
        terminals.push(json!({
            "terminal_state_contract_version": runtime.terminal_state_contract_version,
            "canonical_state": runtime.canonical_state.clone(),
            "canonical_badge_label": runtime.canonical_badge_label.clone(),
            "canonical_state_seq": runtime.canonical_state_seq,
            "prompt_state_seq": runtime.prompt_state_seq,
            "turn_active": runtime.turn_active,
            "turn_generation": runtime.turn_generation,
            "completed_turn_generation": runtime.completed_turn_generation,
            "active_interaction_id": runtime.active_interaction_id.clone(),
            "active_interaction_revision": runtime.active_interaction_revision,
            "interaction_actionable": runtime.interaction_actionable,
            "activity_status": runtime.activity_status.clone(),
            "agent_id": metadata.agent_id.clone(),
            "agent_kind": metadata.agent_kind.clone(),
            "commandable": true,
            "connected": true,
            "current_effort": launch_metadata.reasoning_effort.clone(),
            "current_model": launch_metadata.model.clone(),
            "display_name": projected.display_name.clone(),
            "display_status": projected.native_rail_label.clone(),
            "input_ready": input_ready,
            "input_ready_at": runtime.input_ready_at.clone(),
            "instance_id": instance.id,
            "model": launch_metadata.model.clone(),
            "native_connected": true,
            "native_rail_label": projected.native_rail_label.clone(),
            "native_rail_state": projected.native_rail_state.clone(),
            "pane_id": pane_id.clone(),
            "provider_session_id": runtime.provider_session_id.clone(),
            "readiness": projected.readiness.clone(),
            "session_state": projected.session_state.clone(),
            "status": projected.terminal_status.clone(),
            "terminal_id": pane_id.clone(),
            "terminal_index": metadata.terminal_index,
            "terminal_instance_id": instance.id,
            "terminal_process_epoch": metadata.terminal_process_epoch.clone(),
            "terminal_name": projected.terminal_name.clone(),
            "terminal_nickname": projected.terminal_nickname.clone(),
            "terminal_status": projected.terminal_status.clone(),
            "terminal_work_state": projected.terminal_work_state.clone(),
            "thread_id": metadata.thread_id.clone(),
        }));
    }
    terminals.sort_by_key(|terminal| {
        terminal
            .get("terminal_index")
            .and_then(Value::as_u64)
            .unwrap_or(u64::MAX)
    });
    json!({
        "active": true,
        "commandable": true,
        "connected": true,
        "name": workspace.name,
        "reason": reason,
        "repo_path": workspace.root,
        "root_directory": workspace.root,
        // This snapshot is produced by the Rust-owned headless orchestrator.
        // Runtime liveness is authoritative here, but React selection is not:
        // only AppShell may publish selected=true after its UI commits.
        "selected": false,
        "status": "active",
        "terminals": terminals,
        "workspace_active": true,
        "workspace_id": workspace.id,
        "workspace_name": workspace.name,
        "workspace_root": workspace.root,
        "workspace_status": "active"})
}

async fn workspace_activation_pane_is_live(app: &AppHandle, pane_id: &str) -> bool {
    let terminal_state = app.state::<TerminalState>();
    let guard = terminal_state.terminals.read().await;
    guard.contains_key(pane_id)
}

async fn workspace_activation_spawn_terminals(
    app: &AppHandle,
    workspace: &WorkspaceActivationWorkspace,
    descriptors: Vec<WorkspaceActivationTerminalDescriptor>,
) -> Vec<WorkspaceActivationSpawnResult> {
    let mut results = Vec::new();
    for descriptor in descriptors {
        // A live pane means the terminal already exists (possibly mid-turn):
        // activation must be idempotent, never close-and-respawn. terminal_open
        // closes an existing pane's session before reopening.
        if workspace_activation_pane_is_live(app, &descriptor.pane_id).await {
            results.push(WorkspaceActivationSpawnResult {
                descriptor,
                open_result: None,
                error: None,
                adopted: true,
            });
            continue;
        }
        // Re-check per spawn: a webview can come alive mid-activation (the
        // readiness/spawn loop runs for seconds); the moment it heartbeats,
        // its reconcile owns the remaining panes — abort, don't fight it.
        if todo_dispatch_webview_dispatcher_active() {
            workspace_activation_log(
                "backend.workspace_activation.orchestrator.aborted",
                json!({
                    "pane_id": descriptor.pane_id.clone(),
                    "reason": "webview_dispatcher_became_active",
                    "workspace_id": workspace.id,
                }),
            );
            results.push(WorkspaceActivationSpawnResult {
                descriptor,
                open_result: None,
                error: Some("webview dispatcher became active mid-activation".to_string()),
                adopted: false,
            });
            break;
        }
        let request = workspace_activation_terminal_request(workspace, &descriptor);
        let output_channel = Channel::new(|_body: InvokeResponseBody| Ok(()));
        let terminal_state = app.state::<TerminalState>();
        let cloud_mcp_state = app.state::<CloudMcpState>();
        let app_control_mcp_state = app.state::<AppControlMcpState>();
        let open_result = terminal_open(
            app.clone(),
            terminal_state,
            cloud_mcp_state,
            app_control_mcp_state,
            request,
            output_channel,
        )
        .await;
        match open_result {
            Ok(open_result) => results.push(WorkspaceActivationSpawnResult {
                descriptor,
                open_result: Some(open_result),
                error: None,
                adopted: false,
            }),
            Err(error) => {
                workspace_activation_log(
                    "backend.workspace_activation.orchestrator.error",
                    json!({
                        "error": clean_terminal_diagnostic_log_text(&error),
                        "pane_id": descriptor.pane_id.clone(),
                        "terminal_index": descriptor.terminal_index,
                        "workspace_id": workspace.id,
                    }),
                );
                results.push(WorkspaceActivationSpawnResult {
                    descriptor,
                    open_result: None,
                    error: Some(error),
                    adopted: false,
                });
            }
        }
    }
    results
}

async fn workspace_activation_bootstrap_coordination_and_mcp(root: &str) -> Value {
    let mut bootstrap_value = Value::Null;
    let mut bootstrap_error = None;
    match coordination::tauri_commands::coordination_bootstrap_workspace(
        Some(root.to_string()),
        None,
        None,
    ) {
        Ok(value) => {
            bootstrap_value = value;
        }
        Err(error) => {
            bootstrap_error = Some(error);
        }
    }
    let mut daemon_value = json!({
        "active": false,
        "repo_path": root,
    });
    let mut daemon_error = None;
    match crate::coordination::kernel::CoordinationKernel::init(PathBuf::from(root), None) {
        Ok(kernel) => {
            match coordination::mcp::ensure_shared_daemon_for_paths(
                &kernel.paths.repo_path,
                &kernel.paths.db_path,
            ) {
                Ok(value) => {
                    daemon_value = value;
                }
                Err(error) => {
                    daemon_error = Some(error);
                }
            }
        }
        Err(error) => {
            daemon_error = Some(error);
        }
    }
    json!({
        "bootstrap": bootstrap_value,
        "bootstrap_error": bootstrap_error,
        "daemon": daemon_value,
        "error": daemon_error,
        "ok": bootstrap_error.is_none() && daemon_error.is_none(),
    })
}

// Per-workspace activation exclusion: a second activation of the same
// workspace refuses instead of racing, and deactivate_workspace_runtime
// refuses while an activation is mid-flight (spawns happen one lifecycle_lock
// acquisition at a time, so a deactivate could otherwise interleave between
// spawns and leave a half-activated workspace).
static WORKSPACE_ACTIVATIONS_IN_FLIGHT: OnceLock<StdMutex<HashSet<String>>> = OnceLock::new();

fn workspace_activations_in_flight() -> &'static StdMutex<HashSet<String>> {
    WORKSPACE_ACTIVATIONS_IN_FLIGHT.get_or_init(|| StdMutex::new(HashSet::new()))
}

fn workspace_activation_begin(workspace_id: &str) -> Result<(), String> {
    let mut guard = workspace_activations_in_flight()
        .lock()
        .map_err(|_| "workspace activation registry poisoned".to_string())?;
    if !guard.insert(workspace_id.to_string()) {
        return Err(format!(
            "workspace activation already in flight for {workspace_id}"
        ));
    }
    Ok(())
}

fn workspace_activation_end(workspace_id: &str) {
    if let Ok(mut guard) = workspace_activations_in_flight().lock() {
        guard.remove(workspace_id);
    }
}

pub(crate) fn workspace_activation_in_flight(workspace_id: &str) -> bool {
    workspace_activations_in_flight()
        .lock()
        .map(|guard| guard.contains(workspace_id))
        .unwrap_or(false)
}

fn workspace_activate_runtime_webview_guard() -> Result<(), String> {
    workspace_activate_runtime_webview_guard_for_active(todo_dispatch_webview_dispatcher_active())
}

fn workspace_activate_runtime_webview_guard_for_active(active: bool) -> Result<(), String> {
    if active {
        Err("webview dispatcher active".to_string())
    } else {
        Ok(())
    }
}

pub(crate) async fn workspace_activate_runtime_internal(
    app: &AppHandle,
    workspace_id: &str,
    reason: &str,
) -> Result<Value, String> {
    let started_at = Instant::now();
    let workspace_id = workspace_id.trim();
    let reason = reason.trim();
    let reason = if reason.is_empty() {
        "workspace_activate_runtime"
    } else {
        reason
    };
    workspace_activation_log(
        "backend.workspace_activation.orchestrator.start",
        json!({
            "reason": reason,
            "workspace_id": workspace_id,
        }),
    );
    if let Err(error) = workspace_activate_runtime_webview_guard() {
        workspace_activation_log(
            "backend.workspace_activation.orchestrator.error",
            json!({
                "error": error,
                "reason": reason,
                "workspace_id": workspace_id,
            }),
        );
        return Err(error);
    }
    if let Err(error) = workspace_activation_begin(workspace_id) {
        workspace_activation_log(
            "backend.workspace_activation.orchestrator.error",
            json!({
                "error": error,
                "reason": reason,
                "workspace_id": workspace_id,
            }),
        );
        return Err(error);
    }

    let run: Result<Value, String> = async {
        let workspace_settings = app_local_state_read(app, "workspace-settings");
        let workspace =
            workspace_activation_resolve_workspace(app, workspace_id, &workspace_settings)?;
        workspace_activation_remote_intent_clear_if_matching(app, &workspace.id)?;
        let settings =
            workspace_activation_settings_for_workspace(&workspace_settings, &workspace.id);
        let threads_state =
            workspace_activation_threads_state(&workspace.id, &workspace.root).await?;
        let descriptors = workspace_activation_terminal_descriptors_from_values(
            &workspace,
            settings,
            &threads_state,
        );
        let mcp_daemon = workspace_activation_bootstrap_coordination_and_mcp(&workspace.root).await;
        let spawned =
            workspace_activation_spawn_terminals(app, &workspace, descriptors.clone()).await;
        let readiness = workspace_activation_wait_for_readiness(app, &spawned).await;
        let todos_hydrated = {
            let cloud_mcp_state = app.state::<CloudMcpState>();
            cloud_mcp_hydrate_workspace_todos_internal(
                cloud_mcp_state.inner(),
                workspace.root.clone(),
                Some(workspace.id.clone()),
                Some(workspace.name.clone()),
                json!([]),
            )
            .await
            .unwrap_or_else(|error| {
                json!({
                    "error": error,
                    "hydrated_count": 0,
                    "items": [],
                })
            })
        };
        let cloud_snapshot = {
            let cloud_mcp_state = app.state::<CloudMcpState>();
            let workspace_snapshot =
                workspace_activation_workspace_snapshot(app, &workspace, reason).await;
            cloud_mcp_sync_device_workspaces_snapshot_internal(
                cloud_mcp_state.inner(),
                json!([workspace_snapshot]),
                None,
                Some("workspace_activate_runtime".to_string()),
            )
            .await
            .unwrap_or_else(|error| {
                json!({
                    "error": error,
                    "queued": false,
                    "sent": false,
                })
            })
        };
        let spawn_errors = spawned
            .iter()
            .filter_map(|spawn| {
                spawn.error.as_ref().map(|error| {
                    json!({
                        "error": error,
                        "pane_id": spawn.descriptor.pane_id,
                        "terminal_index": spawn.descriptor.terminal_index,
                    })
                })
            })
            .collect::<Vec<_>>();
        let terminals_spawned = spawned
            .iter()
            .filter(|spawn| spawn.open_result.is_some())
            .count();
        let terminals_adopted = spawned.iter().filter(|spawn| spawn.adopted).count();
        let terminals_ready = readiness
            .iter()
            .filter(|entry| {
                entry
                    .get("input_ready")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
            .count();
        // An activation that produced zero live terminals for a workspace
        // that expects terminals is a failure, not a "completed" — the
        // dashboard/automation must not see success for an empty runtime.
        if terminals_spawned == 0 && terminals_adopted == 0 && !spawned.is_empty() {
            let first_error = spawn_errors
                .first()
                .and_then(|entry| entry.get("error").and_then(Value::as_str))
                .unwrap_or("no terminals could be spawned");
            return Err(format!(
                "workspace activation spawned no terminals: {first_error}"
            ));
        }
        Ok(json!({
            "workspace_id": workspace.id,
            "root": workspace.root,
            "terminals_spawned": terminals_spawned,
            "terminals_adopted": terminals_adopted,
            "terminals_ready": terminals_ready,
            "terminal_readiness": readiness,
            "terminal_spawn_errors": spawn_errors,
            "mcp_daemon": mcp_daemon,
            "todos_hydrated": todos_hydrated,
            "cloud_snapshot": cloud_snapshot,
            "reason": reason,
            "duration_ms": terminal_diagnostic_elapsed_ms(started_at),
        }))
    }
    .await;
    workspace_activation_end(workspace_id);

    match run {
        Ok(result) => {
            workspace_activation_log(
                "backend.workspace_activation.orchestrator.done",
                json!({
                    "duration_ms": terminal_diagnostic_elapsed_ms(started_at),
                    "reason": reason,
                    "terminals_ready": result.get("terminals_ready").cloned().unwrap_or(Value::Null),
                    "terminals_spawned": result.get("terminals_spawned").cloned().unwrap_or(Value::Null),
                    "workspace_id": workspace_id,
                }),
            );
            Ok(result)
        }
        Err(error) => {
            workspace_activation_log(
                "backend.workspace_activation.orchestrator.error",
                json!({
                    "duration_ms": terminal_diagnostic_elapsed_ms(started_at),
                    "error": clean_terminal_diagnostic_log_text(&error),
                    "reason": reason,
                    "workspace_id": workspace_id,
                }),
            );
            Err(error)
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn workspace_activate_runtime(
    app: AppHandle,
    workspace_id: String,
    reason: Option<String>,
) -> Result<Value, String> {
    workspace_activate_runtime_internal(
        &app,
        &workspace_id,
        reason
            .as_deref()
            .unwrap_or("workspace_activate_runtime_command"),
    )
    .await
}

#[cfg(test)]
mod workspace_activation_tests {
    use super::*;

    #[test]
    fn descriptor_synthesis_uses_webview_pane_and_slot_scheme() {
        let workspace = WorkspaceActivationWorkspace {
            id: "ws 1".to_string(),
            name: "Workspace One".to_string(),
            root: "/repo".to_string(),
            root_was_empty_at_selection: false,
        };
        let settings = json!({
            "terminal_count": 3,
            "logical_terminal_indexes": [0, 1, 2],
            "pane_kinds": {
                "1": "web"
            },
            "terminal_roles": ["codex", "generic", "claude"],
            "agent_permissions": {
                "0": "bypass_permissions",
                "2": "ask_each_time"
            },
            "panes": {
                "2": {
                    "kind": "terminal",
                    "pane_id": "explicit-pane-2",
                    "slot_key": "slot-three"
                }
            }
        });
        let threads = json!({
            "terminal_thread_ids": {
                "0": "thread-zero",
                "2": "thread-two"
            },
            "threads": {
                "thread-zero": {
                    "id": "thread-zero",
                    "provider_bindings": {
                        "codex": {
                            "provider": "codex",
                            "model_id": "gpt-5",
                            "native_session_id": "session-zero",
                            "working_directory": "/repo/sub"
                        }
                    }
                },
                "thread-two": {
                    "id": "thread-two",
                    "provider_bindings": {
                        "claude": {
                            "provider": "claude",
                            "model_id": "sonnet",
                            "reasoning_effort": "high",
                            "provider_session_id": "session-two"
                        }
                    }
                }
            },
            "terminals": {
                "2": {
                    "terminal_name": "Review",
                    "terminal_nickname": "Reviewer"
                }
            }
        });

        let descriptors = workspace_activation_terminal_descriptors_from_values(
            &workspace,
            Some(&settings),
            &threads,
        );

        assert_eq!(descriptors.len(), 2);
        assert_eq!(descriptors[0].terminal_index, 0);
        assert_eq!(descriptors[0].pane_id, "workspace-terminal-ws-1-0-codex");
        assert_eq!(descriptors[0].slot_key, "1");
        assert_eq!(descriptors[0].provider.as_deref(), Some("codex"));
        assert_eq!(
            descriptors[0].provider_session_id.as_deref(),
            Some("session-zero")
        );
        assert_eq!(
            descriptors[0].permission_mode.as_deref(),
            Some("bypass_permissions")
        );
        assert_eq!(descriptors[0].working_directory, "/repo/sub");

        assert_eq!(descriptors[1].terminal_index, 2);
        assert_eq!(descriptors[1].pane_id, "explicit-pane-2");
        assert_eq!(descriptors[1].slot_key, "slot-three");
        assert_eq!(descriptors[1].role, "claude");
        assert_eq!(
            descriptors[1].provider_session_id.as_deref(),
            Some("session-two")
        );
        assert_eq!(descriptors[1].permission_mode.as_deref(), Some("ask"));
        assert_eq!(descriptors[1].terminal_name.as_deref(), Some("Review"));
        assert_eq!(
            descriptors[1].terminal_nickname.as_deref(),
            Some("Reviewer")
        );
    }

    #[test]
    fn descriptor_uses_agent_label_instead_of_derived_thread_title() {
        let workspace = WorkspaceActivationWorkspace {
            id: "workspace-name".to_string(),
            name: "Workspace Name".to_string(),
            root: "/repo".to_string(),
            root_was_empty_at_selection: false,
        };
        let settings = json!({
            "terminal_count": 1,
            "terminal_roles": ["codex"]
        });
        let threads = json!({
            "terminal_thread_ids": {
                "0": "thread-zero"
            },
            "threads": {
                "thread-zero": {
                    "id": "thread-zero",
                    "session_name": "Derived session name",
                    "title": "Derived message title"
                }
            }
        });

        let descriptors = workspace_activation_terminal_descriptors_from_values(
            &workspace,
            Some(&settings),
            &threads,
        );

        assert_eq!(descriptors.len(), 1);
        assert_eq!(descriptors[0].terminal_name.as_deref(), Some("Codex"));
        assert_eq!(descriptors[0].terminal_nickname.as_deref(), None);
    }

    #[test]
    fn activation_refuses_when_webview_dispatcher_active() {
        assert_eq!(
            workspace_activate_runtime_webview_guard_for_active(true),
            Err("webview dispatcher active".to_string())
        );
        assert_eq!(
            workspace_activate_runtime_webview_guard_for_active(false),
            Ok(())
        );
    }
}

async fn run_backend_app_shutdown(app_for_shutdown: AppHandle, window_label: String) {
    let _ = cloud_mcp_signal_desktop_closing(&app_for_shutdown, "app_shutdown").await;
    // Close OTA admission and resolve every command generation while the
    // Cloud transport is still available. Staged artifacts intentionally
    // remain staged for the next launch.
    app_update_shutdown().await;

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
    video_code_preview_stop_all();
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
        let lifecycle_guard = lock_lifecycle_with_timeout(
            lifecycle_lock,
            Duration::from_secs(APP_SHUTDOWN_LIFECYCLE_LOCK_TIMEOUT_SECS),
        )
        .await;
        if lifecycle_guard.is_none() {
            let message = format!(
                "Timed out after {APP_SHUTDOWN_LIFECYCLE_LOCK_TIMEOUT_SECS}s acquiring terminal lifecycle lock during app shutdown; proceeding without guard."
            );
            eprintln!("{message}");
            log_terminal_crash_forensics_event(
                "backend.app_shutdown.lifecycle_lock_timeout",
                json!({
                    "timeout_secs": APP_SHUTDOWN_LIFECYCLE_LOCK_TIMEOUT_SECS,
                    "window_label": clean_terminal_telemetry_text(&window_label),
                }),
            );
            log_terminal_diagnostic_event(
                &app_for_shutdown,
                "app_shutdown.lifecycle_lock_timeout",
                json!({
                    "timeout_secs": APP_SHUTDOWN_LIFECYCLE_LOCK_TIMEOUT_SECS,
                    "window_label": clean_terminal_telemetry_text(&window_label),
                }),
            );
        }
        let result = close_all_terminal_sessions(
            app_for_shutdown.clone(),
            &terminal_state,
            cloud_mcp_state.inner(),
            None,
        )
        .await;
        drop(lifecycle_guard);
        result
    };
    let _ = cloud_mcp_request_desktop_close(&app_for_shutdown, "app_shutdown").await;

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

#[tauri::command(rename_all = "snake_case")]
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

    // A Rust activation mid-flight spawns terminals one lifecycle_lock
    // acquisition at a time; letting a deactivate interleave would close the
    // already-spawned half and leave both callers reporting success.
    if let Some(target) = workspace_id.as_deref() {
        if workspace_activation_in_flight(target) {
            return Err(format!(
                "workspace activation in flight for {target}; retry deactivation shortly"
            ));
        }
    }

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
    let mut terminal_timeout_error = None;
    let terminal_result = {
        let terminal_state = app.state::<TerminalState>();
        let cloud_mcp_state = app.state::<CloudMcpState>();
        let lifecycle_lock = Arc::clone(&terminal_state.lifecycle_lock);
        let close_result = timeout(
            Duration::from_secs(WORKSPACE_DEACTIVATE_TERMINAL_TIMEOUT_SECS),
            async {
                let _lifecycle_guard = lifecycle_lock.lock().await;
                close_all_terminal_sessions(
                    app.clone(),
                    &terminal_state,
                    cloud_mcp_state.inner(),
                    workspace_id.as_deref(),
                )
                .await
            },
        )
        .await;

        match close_result {
            Ok(result) => result,
            Err(_) => {
                let error = format!(
                    "Timed out after {WORKSPACE_DEACTIVATE_TERMINAL_TIMEOUT_SECS}s closing terminals while deactivating workspace runtime."
                );
                eprintln!(
                    "{error} workspace_id={} repo_path={} reason={}",
                    workspace_id.as_deref().unwrap_or(""),
                    repo_path.as_deref().unwrap_or(""),
                    reason
                );
                log_terminal_crash_forensics_event(
                    "backend.workspace_deactivate_runtime.terminal_timeout",
                    json!({
                        "reason": reason,
                        "repo_path": repo_path.as_deref().unwrap_or(""),
                        "timeout_secs": WORKSPACE_DEACTIVATE_TERMINAL_TIMEOUT_SECS,
                        "workspace_id": workspace_id.as_deref().unwrap_or(""),
                    }),
                );
                let error = format!(
                    "{error} workspace_id={} repo_path={}",
                    workspace_id.as_deref().unwrap_or(""),
                    repo_path.as_deref().unwrap_or("")
                );
                terminal_timeout_error = Some(error.clone());
                Err(error)
            }
        }
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
    todo_store_orphan_sweep_trigger("workspace_deactivate_runtime");

    let mcp_started_at = Instant::now();
    let (mcp, mcp_error) = if let Some(repo_path) = repo_path.as_deref() {
        match coordination::mcp::park_shared_daemon_for_repo(PathBuf::from(repo_path), &reason) {
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
        "repo_path": repo_path.as_deref().unwrap_or(""),
        "workspace_id": workspace_id.as_deref().unwrap_or(""),
        "watchers": watchers,
        "terminals": {
            "closed": closed_terminals,
        },
        "mcp": mcp,
        "errors": errors,
        "duration_ms": terminal_diagnostic_elapsed_ms(started_at),
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

    if let Some(error) = terminal_timeout_error {
        return Err(error);
    }

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
                "repo_path": root.display().to_string(),
                "agents_root": agents_root.display().to_string(),
                "private_state_root": private_state_root.display().to_string(),
                "removed": [],
                "removed_count": (if private_state_root_removed { 1 } else { 0 }) + remembered_kernel_entries_removed,
                "agents_root_removed": false,
                "private_state_root_removed": private_state_root_removed,
                "remembered_kernel_entries_removed": remembered_kernel_entries_removed,
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
        "repo_path": root.display().to_string(),
        "agents_root": agents_root.display().to_string(),
        "private_state_root": private_state_root.display().to_string(),
        "removed": removed,
        "removed_count": removed_count + remembered_kernel_entries_removed,
        "dirty_worktrees": dirty_worktrees,
        "agents_root_removed": agents_root_removed,
        "private_state_root_removed": private_state_root_removed,
        "remembered_kernel_entries_removed": remembered_kernel_entries_removed,
        "skipped": false,
    }))
}

#[tauri::command(rename_all = "snake_case")]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DeviceDataMigrationStrategy {
    PreferNewest,
    MergeWorkspaceCatalog,
    MergeAppStateWorkspaceSettings,
}

struct DeviceDataMigrationLock {
    path: PathBuf,
}

impl Drop for DeviceDataMigrationLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn device_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(root) = cloud_mcp_native_data_root() {
        return Ok(root);
    }

    app.path()
        .data_dir()
        .map(|data_dir| data_dir.join("DiffForge"))
        .map_err(|error| format!("Unable to resolve Diff Forge device data directory: {error}"))
}

fn legacy_identifier_data_dirs(app: &AppHandle) -> Vec<PathBuf> {
    app.path()
        .data_dir()
        .map(|data_dir| {
            vec![
                data_dir.join(PROD_BUNDLE_IDENTIFIER),
                data_dir.join(DEV_BUNDLE_IDENTIFIER),
            ]
        })
        .unwrap_or_default()
}

fn device_data_target_path(root: &Path, rel_path: &Path) -> Result<PathBuf, String> {
    if rel_path.as_os_str().is_empty() {
        return Err("Device data relative path is required.".to_string());
    }

    let mut target = root.to_path_buf();
    for component in rel_path.components() {
        match component {
            Component::Normal(part) => target.push(part),
            _ => {
                return Err(format!(
                    "Invalid device data relative path: {}",
                    rel_path.display()
                ));
            }
        }
    }
    Ok(target)
}

fn ensure_device_migrated<P: AsRef<Path>>(
    app: &AppHandle,
    rel_path: P,
    strategy: DeviceDataMigrationStrategy,
) -> Result<(), String> {
    let device_root = device_data_root(app)?;
    let legacy_roots = legacy_identifier_data_dirs(app);
    ensure_device_migrated_for_roots(&device_root, &legacy_roots, rel_path.as_ref(), strategy)
}

fn device_data_path<P: AsRef<Path>>(
    app: &AppHandle,
    rel_path: P,
    strategy: DeviceDataMigrationStrategy,
) -> Result<PathBuf, String> {
    let rel_path = rel_path.as_ref();
    ensure_device_migrated(app, rel_path, strategy)?;
    device_data_target_path(&device_data_root(app)?, rel_path)
}

fn ensure_device_migrated_for_roots(
    device_root: &Path,
    legacy_roots: &[PathBuf],
    rel_path: &Path,
    strategy: DeviceDataMigrationStrategy,
) -> Result<(), String> {
    let target = device_data_target_path(device_root, rel_path)?;
    if target.exists() {
        return Ok(());
    }

    let Some(_lock) = device_data_migration_acquire_lock(&target)? else {
        return Ok(());
    };
    if target.exists() {
        return Ok(());
    }

    match strategy {
        DeviceDataMigrationStrategy::PreferNewest => {
            let candidates = device_data_legacy_candidates(legacy_roots, rel_path);
            device_data_migrate_prefer_newest(&target, &candidates)
        }
        DeviceDataMigrationStrategy::MergeWorkspaceCatalog => {
            device_data_migrate_workspace_catalog(device_root, legacy_roots, &target)
        }
        DeviceDataMigrationStrategy::MergeAppStateWorkspaceSettings => {
            let candidates = device_data_legacy_candidates(legacy_roots, rel_path);
            if let Some(payload) = merge_app_state_workspace_settings_files(&candidates)? {
                device_data_write_json_atomic(&target, &payload, "app state workspace settings")?;
            }
            Ok(())
        }
    }
}

fn device_data_legacy_candidates(legacy_roots: &[PathBuf], rel_path: &Path) -> Vec<PathBuf> {
    legacy_roots
        .iter()
        .map(|root| root.join(rel_path))
        .filter(|path| path.exists())
        .collect()
}

fn device_data_migration_now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

fn device_data_migration_temp_path(target: &Path) -> PathBuf {
    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut file_name = target
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_else(|| std::ffi::OsString::from("device-data"));
    file_name.push(format!(
        ".migration-{}-{}-{counter}.tmp",
        std::process::id(),
        device_data_migration_now_nanos()
    ));
    target.with_file_name(file_name)
}

fn device_data_migration_lock_path(target: &Path) -> PathBuf {
    let mut file_name = target
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_else(|| std::ffi::OsString::from("device-data"));
    file_name.push(".migration.lock");
    target.with_file_name(file_name)
}

fn device_data_migration_lock_is_stale(path: &Path) -> bool {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .map(|age| age.as_secs() >= DEVICE_DATA_MIGRATION_LOCK_STALE_SECS)
        .unwrap_or(false)
}

fn device_data_migration_acquire_lock(
    target: &Path,
) -> Result<Option<DeviceDataMigrationLock>, String> {
    let lock_path = device_data_migration_lock_path(target);
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create device migration directory: {error}"))?;
    }

    for _ in 0..1200 {
        if target.exists() {
            return Ok(None);
        }

        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(mut file) => {
                let _ = writeln!(
                    file,
                    "{{\"pid\":{},\"createdAtNanos\":{}}}",
                    std::process::id(),
                    device_data_migration_now_nanos()
                );
                return Ok(Some(DeviceDataMigrationLock { path: lock_path }));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if device_data_migration_lock_is_stale(&lock_path) {
                    let _ = fs::remove_file(&lock_path);
                    continue;
                }
                thread::sleep(Duration::from_millis(250));
            }
            Err(error) => {
                return Err(format!(
                    "Unable to acquire device migration lock {}: {error}",
                    lock_path.display()
                ));
            }
        }
    }

    if target.exists() {
        Ok(None)
    } else {
        Err(format!(
            "Timed out waiting for device migration lock {}.",
            lock_path.display()
        ))
    }
}

fn device_data_path_newest_modified(path: &Path) -> Option<SystemTime> {
    let metadata = fs::metadata(path).ok()?;
    let mut newest = metadata.modified().ok();
    if metadata.is_dir() {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                if let Some(modified) = device_data_path_newest_modified(&entry.path()) {
                    if newest.map(|current| modified > current).unwrap_or(true) {
                        newest = Some(modified);
                    }
                }
            }
        }
    }
    newest
}

fn device_data_newest_candidate(candidates: &[PathBuf]) -> Option<PathBuf> {
    let mut selected: Option<(&PathBuf, SystemTime)> = None;
    for candidate in candidates {
        let modified = device_data_path_newest_modified(candidate).unwrap_or(UNIX_EPOCH);
        if selected
            .as_ref()
            .map(|(_, current)| modified > *current)
            .unwrap_or(true)
        {
            selected = Some((candidate, modified));
        }
    }
    selected.map(|(path, _)| path.clone())
}

fn device_data_finalize_temp_path(
    temp_path: &Path,
    target: &Path,
    label: &str,
) -> Result<(), String> {
    if target.exists() {
        let _ = if temp_path.is_dir() {
            fs::remove_dir_all(temp_path)
        } else {
            fs::remove_file(temp_path)
        };
        return Ok(());
    }

    match fs::rename(temp_path, target) {
        Ok(_) => Ok(()),
        Err(_error) if target.exists() => {
            let _ = if temp_path.is_dir() {
                fs::remove_dir_all(temp_path)
            } else {
                fs::remove_file(temp_path)
            };
            Ok(())
        }
        Err(error) => {
            let _ = if temp_path.is_dir() {
                fs::remove_dir_all(temp_path)
            } else {
                fs::remove_file(temp_path)
            };
            Err(format!(
                "Unable to finalize migrated {label} {}: {error}",
                target.display()
            ))
        }
    }
}

fn device_data_copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| {
        format!(
            "Unable to create migrated directory {}: {error}",
            target.display()
        )
    })?;
    for entry in fs::read_dir(source).map_err(|error| {
        format!(
            "Unable to read legacy directory {}: {error}",
            source.display()
        )
    })? {
        let entry = entry.map_err(|error| {
            format!(
                "Unable to read legacy directory entry {}: {error}",
                source.display()
            )
        })?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "Unable to inspect legacy entry {}: {error}",
                source_path.display()
            )
        })?;
        if file_type.is_dir() {
            device_data_copy_dir_recursive(&source_path, &target_path)?;
        } else {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!(
                        "Unable to create migrated file parent {}: {error}",
                        parent.display()
                    )
                })?;
            }
            fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "Unable to copy legacy file {} to {}: {error}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn device_data_copy_file_atomic(source: &Path, target: &Path, label: &str) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create migrated {label} directory: {error}"))?;
    }
    let temp_path = device_data_migration_temp_path(target);
    fs::copy(source, &temp_path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!(
            "Unable to copy legacy {label} {} to {}: {error}",
            source.display(),
            target.display()
        )
    })?;
    device_data_finalize_temp_path(&temp_path, target, label)
}

fn device_data_copy_dir_atomic(source: &Path, target: &Path, label: &str) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create migrated {label} directory: {error}"))?;
    }
    let temp_path = device_data_migration_temp_path(target);
    if temp_path.exists() {
        let _ = fs::remove_dir_all(&temp_path);
    }
    device_data_copy_dir_recursive(source, &temp_path).map_err(|error| {
        let _ = fs::remove_dir_all(&temp_path);
        error
    })?;
    device_data_finalize_temp_path(&temp_path, target, label)
}

fn device_data_migrate_prefer_newest(target: &Path, candidates: &[PathBuf]) -> Result<(), String> {
    let Some(source) = device_data_newest_candidate(candidates) else {
        return Ok(());
    };
    let metadata = fs::metadata(&source).map_err(|error| {
        format!(
            "Unable to inspect legacy store {}: {error}",
            source.display()
        )
    })?;
    if metadata.is_dir() {
        device_data_copy_dir_atomic(&source, target, "device store")
    } else {
        device_data_copy_file_atomic(&source, target, "device store")
    }
}

fn device_data_read_json(path: &Path) -> Option<Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
}

fn device_data_write_json_atomic(target: &Path, value: &Value, label: &str) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create migrated {label} directory: {error}"))?;
    }
    let serialized = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Unable to serialize migrated {label}: {error}"))?;
    let temp_path = device_data_migration_temp_path(target);
    fs::write(&temp_path, serialized)
        .map_err(|error| format!("Unable to write migrated {label}: {error}"))?;
    device_data_finalize_temp_path(&temp_path, target, label)
}

fn merge_app_state_workspace_settings_files(
    candidates: &[PathBuf],
) -> Result<Option<Value>, String> {
    let mut merged = serde_json::Map::new();
    let mut key_mtimes: HashMap<String, SystemTime> = HashMap::new();
    let mut saw_object = false;

    for candidate in candidates {
        let Some(Value::Object(object)) = device_data_read_json(candidate) else {
            continue;
        };
        saw_object = true;
        let modified = fs::metadata(candidate)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        for (key, value) in object {
            let should_replace = key_mtimes
                .get(&key)
                .map(|existing| modified > *existing)
                .unwrap_or(true);
            if should_replace {
                key_mtimes.insert(key.clone(), modified);
                merged.insert(key, value);
            }
        }
    }

    Ok(saw_object.then_some(Value::Object(merged)))
}

fn device_data_workspace_settings_for_catalog(
    device_root: &Path,
    legacy_roots: &[PathBuf],
) -> Value {
    let target = device_root
        .join(DEVICE_APP_STATE_DIR)
        .join("workspace-settings.json");
    if let Some(Value::Object(object)) = device_data_read_json(&target) {
        return Value::Object(object);
    }

    let rel_path = PathBuf::from(DEVICE_APP_STATE_DIR).join("workspace-settings.json");
    let candidates = device_data_legacy_candidates(legacy_roots, &rel_path);
    merge_app_state_workspace_settings_files(&candidates)
        .ok()
        .flatten()
        .unwrap_or_else(|| json!({}))
}

fn device_data_workspace_catalog_scope_files(candidate_dirs: &[PathBuf]) -> Vec<String> {
    let mut names = BTreeSet::new();
    for dir in candidate_dirs {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
                continue;
            }
            if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
                names.insert(name.to_string());
            }
        }
    }
    names.into_iter().collect()
}

fn workspace_catalog_entry_updated_key(entry: &Value) -> (u8, u128, String) {
    for key in ["updated_at_ms", "modified_at_ms", "created_at_ms"] {
        if let Some(value) = entry.get(key) {
            if let Some(number) = value.as_u64() {
                return (2, number as u128, String::new());
            }
            if let Some(number) = value
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .and_then(|value| value.parse::<u128>().ok())
            {
                return (2, number, String::new());
            }
        }
    }

    for key in ["updated_at", "modified_at", "created_at"] {
        if let Some(value) = entry
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if let Ok(number) = value.parse::<u128>() {
                return (2, number, String::new());
            }
            return (1, 0, value.to_string());
        }
    }

    (0, 0, String::new())
}

fn mark_workspace_catalog_entry_deleted(entry: &mut Value) {
    if let Value::Object(object) = entry {
        object.insert("pending_delete".to_string(), json!(true));
        object.insert("deleted".to_string(), json!(true));
    }
}

fn resolve_workspace_catalog_root_collisions(items: &mut [Value], workspace_settings: &Value) {
    let mut root_owners: HashMap<String, usize> = HashMap::new();
    for index in 0..items.len() {
        if local_workspace_catalog_entry_is_deleted(&items[index]) {
            continue;
        }
        let Some((root_identity, _)) =
            local_workspace_catalog_root_identity(&items[index], workspace_settings)
        else {
            continue;
        };
        let workspace_id = local_workspace_catalog_text(&items[index], &["id", "workspace_id"])
            .unwrap_or_default();
        if workspace_id.is_empty() {
            continue;
        }

        if let Some(existing_index) = root_owners.get(&root_identity).copied() {
            let existing_id =
                local_workspace_catalog_text(&items[existing_index], &["id", "workspace_id"])
                    .unwrap_or_default();
            if existing_id == workspace_id {
                continue;
            }
            if workspace_catalog_entry_updated_key(&items[index])
                > workspace_catalog_entry_updated_key(&items[existing_index])
            {
                mark_workspace_catalog_entry_deleted(&mut items[existing_index]);
                root_owners.insert(root_identity, index);
            } else {
                mark_workspace_catalog_entry_deleted(&mut items[index]);
            }
        } else {
            root_owners.insert(root_identity, index);
        }
    }
}

fn merge_workspace_catalog_files(
    candidates: &[PathBuf],
    workspace_settings: &Value,
) -> Result<Option<Value>, String> {
    let mut items: Vec<Value> = Vec::new();
    let mut indexes_by_id: HashMap<String, usize> = HashMap::new();
    let mut saw_catalog = false;

    for candidate in candidates {
        let Some(value) = device_data_read_json(candidate) else {
            continue;
        };
        saw_catalog = true;
        let Some(workspaces) = value.get("workspaces").and_then(Value::as_array) else {
            continue;
        };
        for item in workspaces {
            let item = item.clone();
            let workspace_id = local_workspace_catalog_text(&item, &["id", "workspace_id"]);
            let Some(workspace_id) = workspace_id else {
                items.push(item);
                continue;
            };
            if let Some(existing_index) = indexes_by_id.get(&workspace_id).copied() {
                if workspace_catalog_entry_updated_key(&item)
                    > workspace_catalog_entry_updated_key(&items[existing_index])
                {
                    items[existing_index] = item;
                }
            } else {
                indexes_by_id.insert(workspace_id, items.len());
                items.push(item);
            }
        }
    }

    if !saw_catalog {
        return Ok(None);
    }

    resolve_workspace_catalog_root_collisions(&mut items, workspace_settings);
    let items = local_workspace_catalog_normalize_items(items, workspace_settings)?;
    Ok(Some(json!({
        "version": 1,
        "workspaces": items,
    })))
}

fn device_data_migrate_workspace_catalog(
    device_root: &Path,
    legacy_roots: &[PathBuf],
    target: &Path,
) -> Result<(), String> {
    let candidate_dirs: Vec<PathBuf> = legacy_roots
        .iter()
        .map(|root| root.join(DEVICE_WORKSPACE_CATALOG_DIR))
        .filter(|path| path.is_dir())
        .collect();
    if candidate_dirs.is_empty() {
        return Ok(());
    }

    let scope_files = device_data_workspace_catalog_scope_files(&candidate_dirs);
    if scope_files.is_empty() {
        return Ok(());
    }

    let workspace_settings = device_data_workspace_settings_for_catalog(device_root, legacy_roots);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Unable to create migrated workspace catalog parent {}: {error}",
                parent.display()
            )
        })?;
    }
    let temp_dir = device_data_migration_temp_path(target);
    fs::create_dir_all(&temp_dir).map_err(|error| {
        format!(
            "Unable to create migrated workspace catalog temp directory {}: {error}",
            temp_dir.display()
        )
    })?;

    let mut wrote_any = false;
    for scope_file in scope_files {
        let candidates: Vec<PathBuf> = candidate_dirs
            .iter()
            .map(|dir| dir.join(&scope_file))
            .filter(|path| path.is_file())
            .collect();
        if let Some(payload) = merge_workspace_catalog_files(&candidates, &workspace_settings)? {
            let target_file = temp_dir.join(scope_file);
            let serialized = serde_json::to_vec_pretty(&payload).map_err(|error| {
                format!("Unable to serialize migrated workspace catalog: {error}")
            })?;
            fs::write(&target_file, serialized).map_err(|error| {
                format!(
                    "Unable to write migrated workspace catalog {}: {error}",
                    target_file.display()
                )
            })?;
            wrote_any = true;
        }
    }

    if !wrote_any {
        let _ = fs::remove_dir_all(&temp_dir);
        return Ok(());
    }

    device_data_finalize_temp_path(&temp_dir, target, "workspace catalog")
}

#[cfg(test)]
mod device_data_migration_tests {
    use super::*;

    static DEVICE_DATA_MIGRATION_TEST_ENV_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(prefix: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let suffix = format!(
                "{}-{}",
                device_data_migration_now_nanos(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            );
            let path = env::temp_dir().join(format!("{prefix}-{suffix}"));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    struct ScopedDeviceDataEnv {
        key: &'static str,
        previous: Option<std::ffi::OsString>,
    }

    impl ScopedDeviceDataEnv {
        fn set(key: &'static str, value: &Path) -> Self {
            let previous = env::var_os(key);
            env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for ScopedDeviceDataEnv {
        fn drop(&mut self) {
            if let Some(previous) = self.previous.take() {
                env::set_var(self.key, previous);
            } else {
                env::remove_var(self.key);
            }
        }
    }

    fn write_json(path: &Path, value: &Value) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
    }

    fn read_json(path: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    }

    fn legacy_roots(root: &Path) -> Vec<PathBuf> {
        vec![
            root.join(PROD_BUNDLE_IDENTIFIER),
            root.join(DEV_BUNDLE_IDENTIFIER),
        ]
    }

    fn workspace_by_id<'a>(catalog: &'a Value, id: &str) -> &'a Value {
        catalog["workspaces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|workspace| {
                local_workspace_catalog_text(workspace, &["id", "workspace_id"]).as_deref()
                    == Some(id)
            })
            .unwrap_or_else(|| panic!("missing workspace {id}"))
    }

    fn workspace_item_by_id<'a>(items: &'a [Value], id: &str) -> &'a Value {
        items
            .iter()
            .find(|workspace| local_workspace_catalog_entry_id(workspace).as_deref() == Some(id))
            .unwrap_or_else(|| panic!("missing workspace {id}"))
    }

    #[test]
    fn workspace_catalog_migration_unions_tombstones_and_tombstones_older_root_collision() {
        let root = TestDir::new("diffforge-device-catalog-migration");
        let device_root = root.path().join("device");
        let legacy_roots = legacy_roots(root.path());
        let catalog_rel = Path::new(DEVICE_WORKSPACE_CATALOG_DIR);
        let prod_catalog = legacy_roots[0]
            .join(DEVICE_WORKSPACE_CATALOG_DIR)
            .join("personal.json");
        let dev_catalog = legacy_roots[1]
            .join(DEVICE_WORKSPACE_CATALOG_DIR)
            .join("personal.json");

        write_json(
            &prod_catalog,
            &json!({
                "version": 1,
                "workspaces": [
                    {
                        "id": "prod-only",
                        "name": "Prod",
                        "root_identity": "prod-root",
                        "root_directory": "/tmp/prod-root",
                        "updated_at_ms": 100
                    },
                    {
                        "id": "deleted-preserved",
                        "name": "Deleted",
                        "root_identity": "deleted-root",
                        "pending_delete": true,
                        "updated_at_ms": 110
                    },
                    {
                        "id": "older-root-owner",
                        "name": "Older root owner",
                        "root_identity": "shared-root",
                        "root_directory": "/tmp/shared-old",
                        "updated_at_ms": 120
                    },
                    {
                        "id": "same-id",
                        "name": "Older same id",
                        "root_identity": "same-id-old-root",
                        "root_directory": "/tmp/same-id-old",
                        "updated_at_ms": 130
                    }
                ]
            }),
        );
        write_json(
            &dev_catalog,
            &json!({
                "version": 1,
                "workspaces": [
                    {
                        "id": "dev-only",
                        "name": "Dev",
                        "root_identity": "dev-root",
                        "root_directory": "/tmp/dev-root",
                        "updated_at_ms": 200
                    },
                    {
                        "id": "newer-root-owner",
                        "name": "Newer root owner",
                        "root_identity": "shared-root",
                        "root_directory": "/tmp/shared-new",
                        "updated_at_ms": 300
                    },
                    {
                        "id": "same-id",
                        "name": "Newer same id",
                        "root_identity": "same-id-new-root",
                        "root_directory": "/tmp/same-id-new",
                        "updated_at_ms": 400
                    }
                ]
            }),
        );

        ensure_device_migrated_for_roots(
            &device_root,
            &legacy_roots,
            catalog_rel,
            DeviceDataMigrationStrategy::MergeWorkspaceCatalog,
        )
        .unwrap();

        let catalog = read_json(
            &device_root
                .join(DEVICE_WORKSPACE_CATALOG_DIR)
                .join("personal.json"),
        );
        let workspaces = catalog["workspaces"].as_array().unwrap();
        assert_eq!(workspaces.len(), 6);
        assert_eq!(
            workspace_by_id(&catalog, "prod-only")["name"],
            json!("Prod")
        );
        assert_eq!(workspace_by_id(&catalog, "dev-only")["name"], json!("Dev"));
        assert_eq!(
            workspace_by_id(&catalog, "same-id")["name"],
            json!("Newer same id")
        );
        assert!(local_workspace_catalog_entry_is_deleted(workspace_by_id(
            &catalog,
            "deleted-preserved"
        )));
        assert!(local_workspace_catalog_entry_is_deleted(workspace_by_id(
            &catalog,
            "older-root-owner"
        )));
        assert!(!local_workspace_catalog_entry_is_deleted(workspace_by_id(
            &catalog,
            "newer-root-owner"
        )));

        local_workspace_catalog_normalize_items(workspaces.clone(), &json!({})).unwrap();
    }

    #[test]
    fn workspace_settings_migration_unions_maps_and_prefers_newer_conflicts() {
        let root = TestDir::new("diffforge-device-settings-migration");
        let device_root = root.path().join("device");
        let legacy_roots = legacy_roots(root.path());
        let rel = PathBuf::from(DEVICE_APP_STATE_DIR).join("workspace-settings.json");
        write_json(
            &legacy_roots[0].join(&rel),
            &json!({
                "prod-workspace": { "root_directory": "/tmp/prod" },
                "shared-workspace": { "root_directory": "/tmp/prod-shared" }
            }),
        );
        thread::sleep(Duration::from_millis(20));
        write_json(
            &legacy_roots[1].join(&rel),
            &json!({
                "dev-workspace": { "root_directory": "/tmp/dev" },
                "shared-workspace": { "root_directory": "/tmp/dev-shared" }
            }),
        );

        ensure_device_migrated_for_roots(
            &device_root,
            &legacy_roots,
            &rel,
            DeviceDataMigrationStrategy::MergeAppStateWorkspaceSettings,
        )
        .unwrap();

        let merged = read_json(&device_root.join(&rel));
        assert_eq!(
            merged["prod-workspace"]["root_directory"],
            json!("/tmp/prod")
        );
        assert_eq!(merged["dev-workspace"]["root_directory"], json!("/tmp/dev"));
        assert_eq!(
            merged["shared-workspace"]["root_directory"],
            json!("/tmp/dev-shared")
        );
    }

    #[test]
    fn prefer_newest_file_migration_picks_newest_and_is_idempotent() {
        let root = TestDir::new("diffforge-device-prefer-newest");
        let device_root = root.path().join("device");
        let legacy_roots = legacy_roots(root.path());
        let rel = Path::new("voice-text-rules.json");
        fs::create_dir_all(&legacy_roots[0]).unwrap();
        fs::create_dir_all(&legacy_roots[1]).unwrap();
        fs::write(legacy_roots[0].join(rel), "prod").unwrap();
        thread::sleep(Duration::from_millis(20));
        fs::write(legacy_roots[1].join(rel), "dev").unwrap();

        ensure_device_migrated_for_roots(
            &device_root,
            &legacy_roots,
            rel,
            DeviceDataMigrationStrategy::PreferNewest,
        )
        .unwrap();
        let target = device_root.join(rel);
        assert_eq!(fs::read_to_string(&target).unwrap(), "dev");

        fs::write(legacy_roots[1].join(rel), "changed-after-migration").unwrap();
        ensure_device_migrated_for_roots(
            &device_root,
            &legacy_roots,
            rel,
            DeviceDataMigrationStrategy::PreferNewest,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "dev");
    }

    #[test]
    fn desktop_auth_cli_read_falls_back_to_legacy_prod_when_device_file_missing() {
        let _guard = DEVICE_DATA_MIGRATION_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap();
        let root = TestDir::new("diffforge-desktop-auth-cli-fallback");
        let device_root = root.path().join("device");
        let home = root.path().join("home");
        let xdg_data = root.path().join("xdg-data");
        let appdata = root.path().join("appdata");
        let localappdata = root.path().join("localappdata");
        let _data_env = ScopedDeviceDataEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &device_root);
        let _home_env = ScopedDeviceDataEnv::set("HOME", &home);
        let _userprofile_env = ScopedDeviceDataEnv::set("USERPROFILE", &home);
        let _xdg_data_env = ScopedDeviceDataEnv::set("XDG_DATA_HOME", &xdg_data);
        let _appdata_env = ScopedDeviceDataEnv::set("APPDATA", &appdata);
        let _localappdata_env = ScopedDeviceDataEnv::set("LOCALAPPDATA", &localappdata);

        let legacy_path = desktop_auth_cli_legacy_state_path().unwrap();
        write_json(
            &legacy_path,
            &json!({
                "status": "authenticated",
                "token": "abcdefghijklmnopqrstuvwxyz123456",
                "user": { "id": "legacy-user" }
            }),
        );

        let legacy_snapshot = desktop_auth_cli_read_snapshot();
        assert_eq!(legacy_snapshot["status"], json!("authenticated"));
        assert_eq!(legacy_snapshot["user"]["id"], json!("legacy-user"));

        let device_path = desktop_auth_cli_state_path().unwrap();
        write_json(
            &device_path,
            &json!({
                "status": "signedOut",
                "token": "",
                "user": null
            }),
        );
        let device_snapshot = desktop_auth_cli_read_snapshot();
        assert_eq!(device_snapshot["status"], json!("signedOut"));
    }

    #[test]
    fn local_workspace_store_tombstones_absent_existing_entries() {
        let now_ms = 2_000_000;
        let stored = local_workspace_catalog_store_items(
            vec![
                json!({
                    "id": "ws-kept",
                    "name": "Kept",
                    "root_identity": "root-kept",
                    "root_directory": "/tmp/kept"
                }),
                json!({
                    "id": "ws-removed",
                    "name": "Removed",
                    "root_identity": "root-removed",
                    "root_directory": "/tmp/removed"
                }),
            ],
            vec![json!({
                "id": "ws-kept",
                "name": "Kept",
                "root_identity": "root-kept",
                "root_directory": "/tmp/kept"
            })],
            &json!({}),
            now_ms,
        )
        .unwrap();

        assert_eq!(stored.len(), 2);
        assert!(!local_workspace_catalog_entry_is_deleted(
            workspace_item_by_id(&stored, "ws-kept")
        ));
        let removed = workspace_item_by_id(&stored, "ws-removed");
        assert!(local_workspace_catalog_entry_is_deleted(removed));
        assert_eq!(removed["deleted"], json!(true));
        assert_eq!(removed["deleted_at_ms"], json!(now_ms));
    }

    #[test]
    fn local_workspace_store_revives_matching_tombstoned_entry() {
        let stored = local_workspace_catalog_store_items(
            vec![json!({
                "id": "ws-revive",
                "name": "Deleted before",
                "root_identity": "root-revive",
                "root_directory": "/tmp/revive",
                "deleted": true,
                "deleted_at_ms": 100
            })],
            vec![json!({
                "id": "ws-revive",
                "name": "Revived",
                "root_identity": "root-revive",
                "root_directory": "/tmp/revive",
                "deleted": true,
                "deleted_at_ms": 100,
                "status": "deleted",
                "current": false
            })],
            &json!({}),
            200,
        )
        .unwrap();

        assert_eq!(stored.len(), 1);
        let revived = workspace_item_by_id(&stored, "ws-revive");
        assert!(!local_workspace_catalog_entry_is_deleted(revived));
        assert_eq!(revived["name"], json!("Revived"));
        assert!(revived.get("deleted").is_none());
        assert!(revived.get("deleted_at_ms").is_none());
        assert_eq!(revived["current"], json!(true));
    }

    #[test]
    fn local_workspace_catalog_accepts_legacy_camel_case_and_emits_snake_case() {
        let legacy = json!({
            "workspaceId": "ws-legacy",
            "workspaceName": "Legacy workspace",
            "rootDirectory": "/tmp/legacy-workspace",
            "rootIdentity": "legacy-root",
            "pendingDelete": true,
            "deletedAtMs": "123",
            "deviceIds": ["device-1"],
            "updatedAt": "2026-07-01T00:00:00Z"
        });

        assert_eq!(
            local_workspace_catalog_entry_id(&legacy).as_deref(),
            Some("ws-legacy")
        );
        assert_eq!(
            local_workspace_catalog_root_text(&legacy, &json!({})).as_deref(),
            Some("/tmp/legacy-workspace")
        );
        assert!(local_workspace_catalog_entry_is_deleted(&legacy));
        assert_eq!(
            local_workspace_catalog_entry_deleted_at_ms(&legacy),
            Some(123)
        );

        let stored =
            local_workspace_catalog_store_items(vec![legacy], vec![], &json!({}), 200).unwrap();
        let item = stored.first().expect("legacy tombstone retained");
        assert_eq!(item["workspace_id"], json!("ws-legacy"));
        assert_eq!(item["workspace_name"], json!("Legacy workspace"));
        assert_eq!(item["root_directory"], json!("/tmp/legacy-workspace"));
        assert_eq!(item["root_identity"], json!("legacy-root"));
        assert_eq!(item["deleted_at_ms"], json!("123"));
        assert_eq!(item["device_ids"], json!(["device-1"]));
        assert_eq!(item["updated_at"], json!("2026-07-01T00:00:00Z"));
        assert!(item.get("workspaceId").is_none());
        assert!(item.get("rootDirectory").is_none());
        assert!(item.get("deletedAtMs").is_none());
    }

    #[test]
    fn local_workspace_reusable_id_for_root_matches_only_same_scope_tombstones() {
        let root = TestDir::new("diffforge-reusable-workspace-id");
        let store_dir = root.path().join("catalog");
        let deleted_root = root.path().join("deleted-root");
        let live_root = root.path().join("live-root");
        let other_scope_root = root.path().join("other-scope-root");
        let unknown_root = root.path().join("unknown-root");
        for path in [&deleted_root, &live_root, &other_scope_root, &unknown_root] {
            fs::create_dir_all(path).unwrap();
        }
        write_json(
            &store_dir.join("personal.json"),
            &json!({
                "version": 1,
                "workspaces": [
                    {
                        "id": "ws-deleted",
                        "root_directory": deleted_root.display().to_string(),
                        "deleted": true,
                        "deleted_at_ms": local_workspace_catalog_now_ms()
                    },
                    {
                        "id": "ws-live",
                        "root_directory": live_root.display().to_string()
                    }
                ]
            }),
        );
        write_json(
            &store_dir.join("work.json"),
            &json!({
                "version": 1,
                "workspaces": [
                    {
                        "id": "ws-other-scope",
                        "root_directory": other_scope_root.display().to_string(),
                        "deleted": true,
                        "deleted_at_ms": local_workspace_catalog_now_ms()
                    }
                ]
            }),
        );

        assert_eq!(
            local_workspace_reusable_id_for_root_in_dir(
                &store_dir,
                "personal",
                &deleted_root.display().to_string(),
                &json!({})
            )
            .unwrap(),
            Some("ws-deleted".to_string())
        );
        assert_eq!(
            local_workspace_reusable_id_for_root_in_dir(
                &store_dir,
                "personal",
                &live_root.display().to_string(),
                &json!({})
            )
            .unwrap(),
            None
        );
        assert_eq!(
            local_workspace_reusable_id_for_root_in_dir(
                &store_dir,
                "personal",
                &unknown_root.display().to_string(),
                &json!({})
            )
            .unwrap(),
            None
        );
        assert_eq!(
            local_workspace_reusable_id_for_root_in_dir(
                &store_dir,
                "personal",
                &other_scope_root.display().to_string(),
                &json!({})
            )
            .unwrap(),
            None
        );
    }

    #[test]
    fn local_workspace_prune_keeps_tombstoned_settings_until_expiry() {
        let root = TestDir::new("diffforge-prune-workspace-settings");
        let store_dir = root.path().join("catalog");
        let now_ms = 10_000_000_000;
        write_json(
            &store_dir.join("personal.json"),
            &json!({
                "version": 1,
                "workspaces": [
                    { "id": "ws-live", "root_identity": "root-live" },
                    {
                        "id": "ws-tombstone",
                        "root_identity": "root-tombstone",
                        "deleted": true,
                        "deleted_at_ms": now_ms - 1_000
                    },
                    {
                        "id": "ws-expired",
                        "root_identity": "root-expired",
                        "deleted": true,
                        "deleted_at_ms": now_ms - LOCAL_WORKSPACE_TOMBSTONE_RETENTION_MS - 1
                    }
                ]
            }),
        );
        let retained =
            local_workspace_catalog_retained_workspace_ids_from_dir(&store_dir, now_ms).unwrap();
        let (pruned, removed) = local_workspace_catalog_pruned_workspace_settings(
            &json!({
                "ws-live": { "root_directory": "/tmp/live" },
                "ws-tombstone": { "root_directory": "/tmp/tombstone" },
                "ws-expired": { "root_directory": "/tmp/expired" },
                "ws-unknown": { "root_directory": "/tmp/unknown" }
            }),
            &retained,
        )
        .unwrap();

        assert_eq!(removed, 2);
        assert!(pruned.get("ws-live").is_some());
        assert!(pruned.get("ws-tombstone").is_some());
        assert!(pruned.get("ws-expired").is_none());
        assert!(pruned.get("ws-unknown").is_none());
    }

    #[test]
    fn local_workspace_store_prunes_expired_tombstones() {
        let now_ms = LOCAL_WORKSPACE_TOMBSTONE_RETENTION_MS + 10_000;
        let stored = local_workspace_catalog_store_items(
            vec![
                json!({
                    "id": "ws-expired",
                    "root_identity": "root-expired",
                    "deleted": true,
                    "deleted_at_ms": now_ms - LOCAL_WORKSPACE_TOMBSTONE_RETENTION_MS - 1
                }),
                json!({
                    "id": "ws-fresh",
                    "root_identity": "root-fresh",
                    "deleted": true,
                    "deleted_at_ms": now_ms - 1_000
                }),
            ],
            vec![],
            &json!({}),
            now_ms,
        )
        .unwrap();

        assert!(stored
            .iter()
            .all(|item| local_workspace_catalog_entry_id(item).as_deref() != Some("ws-expired")));
        assert!(local_workspace_catalog_entry_is_deleted(
            workspace_item_by_id(&stored, "ws-fresh")
        ));
    }

    #[test]
    fn local_workspace_load_visible_items_filters_tombstones() {
        let visible = local_workspace_catalog_visible_items(vec![
            json!({ "id": "ws-live", "root_identity": "root-live" }),
            json!({
                "id": "ws-deleted",
                "root_identity": "root-deleted",
                "deleted": true,
                "deleted_at_ms": 100
            }),
        ]);

        assert_eq!(visible.len(), 1);
        assert_eq!(
            local_workspace_catalog_entry_id(&visible[0]).as_deref(),
            Some("ws-live")
        );
    }
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
    let store_dir = device_data_path(
        app,
        Path::new(DEVICE_WORKSPACE_CATALOG_DIR),
        DeviceDataMigrationStrategy::MergeWorkspaceCatalog,
    )?;
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

fn local_workspace_catalog_read_items_from_path(path: &Path) -> Result<Vec<Value>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(path)
        .map_err(|error| format!("Unable to read local workspace catalog: {error}"))?;
    let value = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!({}));
    Ok(value
        .get("workspaces")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(local_workspace_catalog_canonicalize_entry)
        .collect())
}

fn local_workspace_catalog_visible_items(items: Vec<Value>) -> Vec<Value> {
    items
        .into_iter()
        .filter(|item| !local_workspace_catalog_entry_is_deleted(item))
        .collect()
}

/// Workspaces are local-first: the UI commits to this store instantly and the
/// cloud workspace catalog reconciles in the background.
#[tauri::command(rename_all = "snake_case")]
async fn local_workspaces_load(app: AppHandle, scope_key: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = local_workspace_store_path(&app, &scope_key)?;
        if !path.exists() {
            return Ok(json!({ "workspaces": [], "loaded": false }));
        }
        let workspaces = local_workspace_catalog_visible_items(
            local_workspace_catalog_read_items_from_path(&path)?,
        );
        Ok(json!({ "workspaces": workspaces, "loaded": true }))
    })
    .await
    .map_err(|error| format!("Unable to load local workspace catalog: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn local_workspaces_store(
    app: AppHandle,
    scope_key: String,
    workspaces: Value,
) -> Result<Value, String> {
    let cloud_mcp_state = app.state::<CloudMcpState>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = local_workspace_store_path(&app, &scope_key)?;
        let workspace_settings = app_local_state_read(&app, "workspace-settings");
        let existing_items = local_workspace_catalog_read_items_from_path(&path)?;
        let now_ms = local_workspace_catalog_now_ms();
        let items = local_workspace_catalog_store_items(
            existing_items,
            workspaces.as_array().cloned().unwrap_or_default(),
            &workspace_settings,
            now_ms,
        )?;
        let live_count = items
            .iter()
            .filter(|item| !local_workspace_catalog_entry_is_deleted(item))
            .count();
        let live_workspace_ids = local_workspace_catalog_live_workspace_ids(&items);
        let deleted_workspace_ids = cloud_mcp_deleted_workspace_ids();
        let revived_workspace_ids = live_workspace_ids
            .intersection(&deleted_workspace_ids)
            .cloned()
            .collect::<HashSet<_>>();
        let revived_workspace_items = if revived_workspace_ids.is_empty() {
            Vec::new()
        } else {
            items
                .iter()
                .filter(|item| !local_workspace_catalog_entry_is_deleted(item))
                .filter(|item| {
                    local_workspace_catalog_entry_id(item)
                        .as_ref()
                        .is_some_and(|workspace_id| revived_workspace_ids.contains(workspace_id))
                })
                .cloned()
                .collect::<Vec<_>>()
        };
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
        cloud_mcp_notify_workspace_catalog_ready(&cloud_mcp_state);
        let _removed_revived_workspace_count = if revived_workspace_ids.len() == 1 {
            if let Some(workspace_id) = revived_workspace_ids.iter().next() {
                match cloud_mcp_forget_deleted_workspace_id(workspace_id) {
                    Ok(true) => 1,
                    Ok(false) => 0,
                    Err(error) => {
                        log_terminal_status_event(
                            "backend.local_workspaces.revive_ledger_cleanup_failed",
                            json!({
                                "workspace_id": workspace_id,
                                "error": error,
                            }),
                        );
                        0
                    }
                }
            } else {
                0
            }
        } else if !revived_workspace_ids.is_empty() {
            match cloud_mcp_forget_deleted_workspace_ids(&revived_workspace_ids) {
                Ok(removed) => removed,
                Err(error) => {
                    let mut workspace_ids =
                        revived_workspace_ids.iter().cloned().collect::<Vec<_>>();
                    workspace_ids.sort();
                    log_terminal_status_event(
                        "backend.local_workspaces.revive_ledger_cleanup_failed",
                        json!({
                            "workspace_ids": workspace_ids,
                            "error": error,
                        }),
                    );
                    0
                }
            }
        } else {
            0
        };
        if !revived_workspace_items.is_empty() {
            cloud_mcp_post_workspace_revived_events(cloud_mcp_state, revived_workspace_items);
        }
        let pruned_workspace_settings =
            local_workspace_catalog_prune_orphan_workspace_settings(&app)?;
        Ok(json!({
            "ok": true,
            "count": live_count,
            "pruned_workspace_settings": pruned_workspace_settings,
        }))
    })
    .await
    .map_err(|error| format!("Unable to store local workspace catalog: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn local_workspace_reusable_id_for_root(
    app: AppHandle,
    scope_key: String,
    root_path: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store_dir = local_workspace_store_dir(&app)?;
        let workspace_settings = app_local_state_read(&app, "workspace-settings");
        local_workspace_reusable_id_for_root_in_dir(
            &store_dir,
            &scope_key,
            &root_path,
            &workspace_settings,
        )
    })
    .await
    .map_err(|error| format!("Unable to resolve reusable workspace id: {error}"))?
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

#[tauri::command(rename_all = "snake_case")]
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
        let preview_dir = device_data_path(
            &app,
            Path::new("html-document-previews"),
            DeviceDataMigrationStrategy::PreferNewest,
        )?;
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

fn local_workspace_catalog_canonicalize_entry(entry: Value) -> Value {
    let Value::Object(mut object) = entry else {
        return entry;
    };
    for (camel, snake) in [
        ("workspaceId", "workspace_id"),
        ("workspaceName", "workspace_name"),
        ("rootDirectory", "root_directory"),
        ("workspaceRoot", "workspace_root"),
        ("repoPath", "repo_path"),
        ("rootIdentity", "root_identity"),
        ("workspaceRootIdentity", "workspace_root_identity"),
        ("pendingDelete", "pending_delete"),
        ("deletedAtMs", "deleted_at_ms"),
        ("deletedAt", "deleted_at"),
        ("createdAt", "created_at"),
        ("updatedAt", "updated_at"),
        ("originDeviceId", "origin_device_id"),
        ("deviceIds", "device_ids"),
        ("localArchived", "local_archived"),
        ("locallyArchived", "locally_archived"),
        ("localArchivedAt", "local_archived_at"),
        ("locallyArchivedAt", "locally_archived_at"),
        ("syncState", "sync_state"),
        ("workspaceStatus", "workspace_status"),
    ] {
        if let Some(value) = object.remove(camel) {
            object.entry(snake.to_string()).or_insert(value);
        }
    }
    Value::Object(object)
}

fn local_workspace_catalog_root_text(entry: &Value, workspace_settings: &Value) -> Option<String> {
    let workspace_id = local_workspace_catalog_text(entry, &["id", "workspace_id", "workspaceId"]);
    let settings = workspace_id
        .as_deref()
        .and_then(|id| workspace_settings.get(id));
    local_workspace_catalog_text(
        entry,
        &[
            "root_directory",
            "rootDirectory",
            "workspace_root",
            "workspaceRoot",
            "repo_path",
            "repoPath",
        ],
    )
    .or_else(|| {
        settings.and_then(|settings| {
            local_workspace_catalog_text(settings, &["root_directory", "rootDirectory"])
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
            "root_identity",
            "rootIdentity",
            "workspace_root_identity",
            "workspaceRootIdentity",
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

fn local_workspace_catalog_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn local_workspace_catalog_entry_id(entry: &Value) -> Option<String> {
    local_workspace_catalog_text(entry, &["id", "workspace_id", "workspaceId"])
}

fn local_workspace_catalog_entry_deleted_at_ms(entry: &Value) -> Option<u64> {
    for key in ["deleted_at_ms", "deletedAtMs", "deleted_at", "deletedAt"] {
        if let Some(value) = entry.get(key) {
            if let Some(number) = value.as_u64() {
                return Some(number);
            }
            if let Some(number) = value
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .and_then(|value| value.parse::<u64>().ok())
            {
                return Some(number);
            }
        }
    }
    None
}

fn local_workspace_catalog_tombstone_is_expired(entry: &Value, now_ms: u64) -> bool {
    local_workspace_catalog_entry_is_deleted(entry)
        && local_workspace_catalog_entry_deleted_at_ms(entry)
            .map(|deleted_at_ms| {
                now_ms.saturating_sub(deleted_at_ms) >= LOCAL_WORKSPACE_TOMBSTONE_RETENTION_MS
            })
            .unwrap_or(false)
}

fn local_workspace_catalog_mark_tombstoned(entry: &mut Value, now_ms: u64) {
    if let Value::Object(object) = entry {
        object.insert("deleted".to_string(), json!(true));
        object.insert("deleted_at_ms".to_string(), json!(now_ms));
    }
}

fn local_workspace_catalog_ensure_tombstone_shape(entry: &mut Value, now_ms: u64) {
    if let Value::Object(object) = entry {
        object.insert("deleted".to_string(), json!(true));
        if !object.contains_key("deleted_at_ms") && !object.contains_key("deletedAtMs") {
            object.insert("deleted_at_ms".to_string(), json!(now_ms));
        }
    }
}

fn local_workspace_catalog_clear_tombstone(entry: &mut Value) {
    let Value::Object(object) = entry else {
        return;
    };
    for key in [
        "pendingDelete",
        "pending_delete",
        "deleted",
        "removed",
        "tombstoned",
        "deletedAtMs",
        "deleted_at_ms",
        "deletedAt",
        "deleted_at",
    ] {
        object.remove(key);
    }
    for key in ["status", "workspace_status"] {
        let should_remove = object
            .get(key)
            .and_then(Value::as_str)
            .map(|status| matches!(status, "deleted" | "archived" | "removed"))
            .unwrap_or(false);
        if should_remove {
            object.remove(key);
        }
    }
    if object
        .get("current")
        .and_then(Value::as_bool)
        .map(|current| !current)
        .unwrap_or(false)
    {
        object.insert("current".to_string(), json!(true));
    }
}

fn local_workspace_catalog_live_workspace_ids(items: &[Value]) -> HashSet<String> {
    items
        .iter()
        .filter(|item| !local_workspace_catalog_entry_is_deleted(item))
        .filter_map(local_workspace_catalog_entry_id)
        .collect()
}

fn local_workspace_catalog_store_items(
    existing_items: Vec<Value>,
    incoming_items: Vec<Value>,
    workspace_settings: &Value,
    now_ms: u64,
) -> Result<Vec<Value>, String> {
    let existing_tombstoned_ids = existing_items
        .iter()
        .filter(|item| local_workspace_catalog_entry_is_deleted(item))
        .filter_map(local_workspace_catalog_entry_id)
        .collect::<HashSet<_>>();
    let mut incoming_ids = HashSet::new();
    let mut prepared_incoming = Vec::with_capacity(incoming_items.len());

    for mut item in incoming_items {
        if let Some(workspace_id) = local_workspace_catalog_entry_id(&item) {
            incoming_ids.insert(workspace_id.clone());
            if existing_tombstoned_ids.contains(&workspace_id) {
                local_workspace_catalog_clear_tombstone(&mut item);
            }
        }
        prepared_incoming.push(item);
    }

    let mut merged_items =
        local_workspace_catalog_normalize_items(prepared_incoming, workspace_settings)?;
    for mut existing in existing_items {
        let is_absent = local_workspace_catalog_entry_id(&existing)
            .map(|workspace_id| !incoming_ids.contains(&workspace_id))
            .unwrap_or(true);
        if !is_absent {
            continue;
        }
        if local_workspace_catalog_entry_is_deleted(&existing) {
            local_workspace_catalog_ensure_tombstone_shape(&mut existing, now_ms);
        } else {
            local_workspace_catalog_mark_tombstoned(&mut existing, now_ms);
        }
        merged_items.push(existing);
    }

    let normalized_items =
        local_workspace_catalog_normalize_items(merged_items, workspace_settings)?;
    let mut retained_items = Vec::with_capacity(normalized_items.len());
    for mut item in normalized_items {
        if local_workspace_catalog_entry_is_deleted(&item) {
            local_workspace_catalog_ensure_tombstone_shape(&mut item, now_ms);
            if local_workspace_catalog_tombstone_is_expired(&item, now_ms) {
                continue;
            }
        }
        retained_items.push(item);
    }
    Ok(retained_items)
}

fn local_workspace_catalog_normalize_items(
    items: Vec<Value>,
    workspace_settings: &Value,
) -> Result<Vec<Value>, String> {
    let mut root_owners: HashMap<String, String> = HashMap::new();
    let mut normalized_items = Vec::with_capacity(items.len());

    for item in items {
        let item = local_workspace_catalog_canonicalize_entry(item);
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
                object.insert("root_identity".to_string(), json!(root_identity));
                if !object.contains_key("root_directory") {
                    if let Some(root_directory) = root_directory {
                        object.insert("root_directory".to_string(), json!(root_directory));
                    }
                }
                normalized_items.push(Value::Object(object));
            }
            (item, _) => normalized_items.push(item),
        }
    }

    Ok(normalized_items)
}

#[derive(Debug, PartialEq, Eq)]
enum LocalWorkspaceRootMatch {
    Live,
    Tombstoned(String),
}

fn local_workspace_catalog_scope_root_match(
    path: &Path,
    root_identity: &str,
    workspace_settings: &Value,
    now_ms: u64,
) -> Result<Option<LocalWorkspaceRootMatch>, String> {
    let items = local_workspace_catalog_read_items_from_path(path)?;
    let mut tombstoned_match: Option<Value> = None;

    for item in items {
        if local_workspace_catalog_entry_is_deleted(&item)
            && local_workspace_catalog_tombstone_is_expired(&item, now_ms)
        {
            continue;
        }
        let Some((candidate_identity, _)) =
            local_workspace_catalog_root_identity(&item, workspace_settings)
        else {
            continue;
        };
        if candidate_identity != root_identity {
            continue;
        }
        if !local_workspace_catalog_entry_is_deleted(&item) {
            return Ok(Some(LocalWorkspaceRootMatch::Live));
        }
        if local_workspace_catalog_entry_id(&item).is_some() {
            let should_replace = tombstoned_match
                .as_ref()
                .map(|current| {
                    workspace_catalog_entry_updated_key(&item)
                        > workspace_catalog_entry_updated_key(current)
                })
                .unwrap_or(true);
            if should_replace {
                tombstoned_match = Some(item);
            }
        }
    }

    Ok(tombstoned_match
        .as_ref()
        .and_then(local_workspace_catalog_entry_id)
        .map(LocalWorkspaceRootMatch::Tombstoned))
}

fn local_workspace_reusable_id_for_root_in_dir(
    store_dir: &Path,
    scope_key: &str,
    root_path: &str,
    workspace_settings: &Value,
) -> Result<Option<String>, String> {
    let probe = json!({ "root_directory": root_path });
    let Some((root_identity, _)) =
        local_workspace_catalog_root_identity(&probe, workspace_settings)
    else {
        return Ok(None);
    };
    let now_ms = local_workspace_catalog_now_ms();
    let primary_name = format!("{}.json", local_workspace_scope_file_key(scope_key));
    let primary_path = store_dir.join(&primary_name);
    match local_workspace_catalog_scope_root_match(
        &primary_path,
        &root_identity,
        workspace_settings,
        now_ms,
    )? {
        Some(LocalWorkspaceRootMatch::Live) => return Ok(None),
        Some(LocalWorkspaceRootMatch::Tombstoned(workspace_id)) => return Ok(Some(workspace_id)),
        None => {}
    }

    let entries = match fs::read_dir(store_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
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
        if path.file_name().and_then(|name| name.to_str()) == Some(primary_name.as_str()) {
            continue;
        }
        if local_workspace_catalog_scope_root_match(
            &path,
            &root_identity,
            workspace_settings,
            now_ms,
        )?
        .is_some()
        {
            return Ok(None);
        }
    }

    Ok(None)
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

fn local_workspace_catalog_retained_workspace_ids_from_dir(
    store_dir: &Path,
    now_ms: u64,
) -> Result<HashSet<String>, String> {
    let mut ids = HashSet::new();
    let entries = match fs::read_dir(store_dir) {
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
        for item in local_workspace_catalog_read_items_from_path(&path)? {
            if local_workspace_catalog_entry_is_deleted(&item)
                && local_workspace_catalog_tombstone_is_expired(&item, now_ms)
            {
                continue;
            }
            if let Some(id) = local_workspace_catalog_entry_id(&item) {
                ids.insert(id);
            }
        }
    }

    Ok(ids)
}

fn local_workspace_catalog_pruned_workspace_settings(
    current: &Value,
    retained_workspace_ids: &HashSet<String>,
) -> Option<(Value, usize)> {
    let current_object = current.as_object()?;
    let mut next_object = serde_json::Map::new();
    for (workspace_id, settings) in current_object {
        if retained_workspace_ids.contains(workspace_id) {
            next_object.insert(workspace_id.clone(), settings.clone());
        }
    }
    let removed = current_object.len().saturating_sub(next_object.len());
    Some((Value::Object(next_object), removed))
}

fn local_workspace_catalog_prune_orphan_workspace_settings(
    app: &AppHandle,
) -> Result<usize, String> {
    let store_dir = local_workspace_store_dir(app)?;
    let workspace_ids = local_workspace_catalog_retained_workspace_ids_from_dir(
        &store_dir,
        local_workspace_catalog_now_ms(),
    )?;
    let current = app_local_state_read(app, "workspace-settings");
    let Some((next, removed)) =
        local_workspace_catalog_pruned_workspace_settings(&current, &workspace_ids)
    else {
        return Ok(0);
    };
    if removed > 0 {
        app_local_state_write(app, "workspace-settings", &next)?;
    }
    Ok(removed)
}

fn local_workspace_catalog_entry_is_deleted(entry: &Value) -> bool {
    if entry
        .get("pending_delete")
        .or_else(|| entry.get("pendingDelete"))
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
    if local_workspace_catalog_text(entry, &["deleted_at", "deletedAt"]).is_some() {
        return true;
    }
    local_workspace_catalog_text(entry, &["status", "workspace_status"])
        .map(|status| matches!(status.as_str(), "deleted" | "archived" | "removed"))
        .unwrap_or(false)
}

/// Rust-owned app-local state files (device-root/app-state/<key>.json). These
/// replace webview localStorage for state that headless flows must read or
/// mutate (workspace settings, lifecycle defaults, remote-control intents).
/// The webview keeps localStorage as a synchronous cache and writes through.
// The on-disk filename is derived by mapping every non-[a-z0-9_-] char to '-',
// so "byoc.providers", "byoc/providers", and "byoc-providers" all resolve to
// the SAME file. Redaction/ownership gates MUST compare this canonical key,
// not the raw one, or an aliased key slips past them and leaks/overwrites the
// underlying file.
fn app_local_state_canonical_key(key: &str) -> String {
    key.trim()
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
        .collect::<String>()
}

fn app_local_state_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    let safe_key = app_local_state_canonical_key(key);
    if safe_key.is_empty() {
        return Err("App local state key is required.".to_string());
    }
    let rel_path = PathBuf::from(DEVICE_APP_STATE_DIR).join(format!("{safe_key}.json"));
    let strategy = if safe_key == "workspace-settings" {
        DeviceDataMigrationStrategy::MergeAppStateWorkspaceSettings
    } else {
        DeviceDataMigrationStrategy::PreferNewest
    };
    let path = device_data_path(app, &rel_path, strategy)?;
    let store_dir = path
        .parent()
        .ok_or_else(|| "Unable to resolve app state directory.".to_string())?;
    fs::create_dir_all(&store_dir)
        .map_err(|error| format!("Unable to create app state directory: {error}"))?;
    Ok(path)
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
    app_local_state_write_with_mode(app, key, value, None)
}

// `mode` (unix) is applied to the temp file BEFORE the rename, so a
// secret-bearing file (e.g. byoc-providers) is never briefly world-readable.
pub(crate) fn app_local_state_write_with_mode(
    app: &AppHandle,
    key: &str,
    value: &Value,
    #[allow(unused_variables)] mode: Option<u32>,
) -> Result<(), String> {
    app_local_state_store_serialized(|| {
        app_local_state_write_with_mode_unlocked(app, key, value, mode)
    })
}

fn app_local_state_unique_temp_path(path: &Path) -> PathBuf {
    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("app-state.json");
    path.with_file_name(format!(
        "{file_name}.{}.{}.tmp",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed),
    ))
}

fn app_local_state_write_with_mode_unlocked(
    app: &AppHandle,
    key: &str,
    value: &Value,
    #[allow(unused_variables)] mode: Option<u32>,
) -> Result<(), String> {
    let path = app_local_state_path(app, key)?;
    let serialized = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Unable to serialize app state: {error}"))?;
    let temp_path = app_local_state_unique_temp_path(&path);
    if let Err(error) = fs::write(&temp_path, serialized) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Unable to write app state: {error}"));
    }
    #[cfg(unix)]
    if let Some(mode) = mode {
        use std::os::unix::fs::PermissionsExt;
        if let Err(error) = fs::set_permissions(&temp_path, fs::Permissions::from_mode(mode)) {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("Unable to secure app state permissions: {error}"));
        }
    }
    if let Err(error) = fs::rename(&temp_path, &path) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Unable to finalize app state: {error}"));
    }
    Ok(())
}

fn app_local_state_writer_lock() -> &'static StdMutex<()> {
    static APP_LOCAL_STATE_WRITER_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
    APP_LOCAL_STATE_WRITER_LOCK.get_or_init(|| StdMutex::new(()))
}

fn app_local_state_store_serialized<WriteCurrent>(write_current: WriteCurrent) -> Result<(), String>
where
    WriteCurrent: FnOnce() -> Result<(), String>,
{
    let _guard = app_local_state_writer_lock()
        .lock()
        .map_err(|_| "App local state writer lock is unavailable.".to_string())?;
    write_current()
}

fn app_local_state_update_serialized<ReadCurrent, WriteCurrent, UpdateCurrent>(
    read_current: ReadCurrent,
    write_current: WriteCurrent,
    update_current: UpdateCurrent,
) -> Result<Value, String>
where
    ReadCurrent: FnOnce() -> Value,
    WriteCurrent: FnOnce(&Value) -> Result<(), String>,
    UpdateCurrent: FnOnce(&mut Value) -> bool,
{
    let _guard = app_local_state_writer_lock()
        .lock()
        .map_err(|_| "App local state writer lock is unavailable.".to_string())?;
    let mut current = match read_current() {
        Value::Object(map) => Value::Object(map),
        _ => json!({}),
    };
    if update_current(&mut current) {
        write_current(&current)?;
    }
    Ok(current)
}

/// Merge top-level keys into an app-local state object (creates it if absent).
fn app_local_state_merge_serialized<ReadCurrent, WriteCurrent>(
    read_current: ReadCurrent,
    write_current: WriteCurrent,
    patch: &Value,
) -> Result<Value, String>
where
    ReadCurrent: FnOnce() -> Value,
    WriteCurrent: FnOnce(&Value) -> Result<(), String>,
{
    app_local_state_update_serialized(read_current, write_current, |current| {
        let Some(target) = current.as_object_mut() else {
            return false;
        };
        let Some(source) = patch.as_object() else {
            return false;
        };
        for (patch_key, patch_value) in source {
            if patch_value.is_null() {
                target.remove(patch_key);
            } else {
                target.insert(patch_key.clone(), patch_value.clone());
            }
        }
        true
    })
}

fn app_local_state_clear_if_matching_serialized<ReadCurrent, WriteCurrent>(
    read_current: ReadCurrent,
    write_current: WriteCurrent,
    compare_key: &str,
    expected_value: &str,
    clear_patch: &Value,
) -> Result<Value, String>
where
    ReadCurrent: FnOnce() -> Value,
    WriteCurrent: FnOnce(&Value) -> Result<(), String>,
{
    app_local_state_update_serialized(read_current, write_current, |current| {
        let observed = current
            .get(compare_key)
            .and_then(Value::as_str)
            .map(str::trim);
        if observed != Some(expected_value) {
            return false;
        }
        let Some(target) = current.as_object_mut() else {
            return false;
        };
        let Some(source) = clear_patch.as_object() else {
            return false;
        };
        for (patch_key, patch_value) in source {
            if patch_value.is_null() {
                target.remove(patch_key);
            } else {
                target.insert(patch_key.clone(), patch_value.clone());
            }
        }
        true
    })
}

pub(crate) fn app_local_state_merge(
    app: &AppHandle,
    key: &str,
    patch: &Value,
) -> Result<Value, String> {
    app_local_state_merge_serialized(
        || app_local_state_read(app, key),
        |current| app_local_state_write_with_mode_unlocked(app, key, current, None),
        patch,
    )
}

fn app_local_state_public_value(key: &str, value: Value) -> Value {
    let canonical = app_local_state_canonical_key(key);
    if canonical.eq_ignore_ascii_case(DESKTOP_AUTH_STATE_KEY) {
        return desktop_auth_public_snapshot(&desktop_auth_snapshot_from_raw(value));
    }
    value
}

fn app_local_state_is_desktop_auth_key(key: &str) -> bool {
    app_local_state_canonical_key(key).eq_ignore_ascii_case(DESKTOP_AUTH_STATE_KEY)
}

#[tauri::command(rename_all = "snake_case")]
async fn app_local_state_load(app: AppHandle, key: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Auth state goes through the cached snapshot: the raw path re-read
        // and re-slimmed the (legacy ~2 MB) file on every call and bypassed
        // the one-time slim migration.
        if app_local_state_is_desktop_auth_key(&key) {
            return Ok(desktop_auth_public_snapshot(&desktop_auth_snapshot(&app)));
        }
        let value = app_local_state_read(&app, &key);
        // Redaction keys on the canonical form, so an aliased key ("byoc.providers")
        // still lands on the masked branch instead of returning raw secrets.
        Ok(app_local_state_public_value(&key, value))
    })
    .await
    .map_err(|error| format!("App state load worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
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

#[cfg(test)]
mod app_local_state_tests {
    use super::*;
    use std::sync::{mpsc as std_mpsc, Barrier};

    fn read_test_file(path: &Path) -> Value {
        fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .unwrap_or_else(|| json!({}))
    }

    fn write_test_file(path: &Path, value: &Value) -> Result<(), String> {
        fs::write(
            path,
            serde_json::to_vec_pretty(value)
                .map_err(|error| format!("Unable to serialize test app state: {error}"))?,
        )
        .map_err(|error| format!("Unable to write test app state: {error}"))
    }

    fn merge_test_file(path: &Path, patch: &Value) -> Result<Value, String> {
        app_local_state_merge_serialized(
            || read_test_file(path),
            |current| write_test_file(path, current),
            patch,
        )
    }

    #[test]
    fn concurrent_remote_intent_patches_preserve_both_fields() {
        let root = env::temp_dir().join(format!(
            "diffforge-remote-intents-merge-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("remote-intents.json");
        fs::write(&path, b"{}\n").unwrap();
        let barrier = Arc::new(Barrier::new(3));

        let workspace_path = path.clone();
        let workspace_barrier = Arc::clone(&barrier);
        let workspace_patch = thread::spawn(move || {
            workspace_barrier.wait();
            merge_test_file(
                &workspace_path,
                &json!({"pendingActivationWorkspaceId": "workspace-b"}),
            )
            .unwrap();
        });
        let loopspace_path = path.clone();
        let loopspace_barrier = Arc::clone(&barrier);
        let loopspace_patch = thread::spawn(move || {
            loopspace_barrier.wait();
            merge_test_file(
                &loopspace_path,
                &json!({"selectedLoopspaceId": "loopspace-b", "spaceMode": "loopspaces"}),
            )
            .unwrap();
        });

        barrier.wait();
        workspace_patch.join().unwrap();
        loopspace_patch.join().unwrap();

        let merged: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(merged["pendingActivationWorkspaceId"], json!("workspace-b"));
        assert_eq!(merged["selectedLoopspaceId"], json!("loopspace-b"));
        assert_eq!(merged["spaceMode"], json!("loopspaces"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_store_then_merge_preserves_gui_and_cloud_workspace_settings() {
        let root = env::temp_dir().join(format!(
            "diffforge-workspace-settings-store-merge-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("workspace-settings.json");
        write_test_file(&path, &json!({})).unwrap();
        let (store_entered_tx, store_entered_rx) = std_mpsc::channel();
        let (release_store_tx, release_store_rx) = std_mpsc::channel();

        let store_path = path.clone();
        let store = thread::spawn(move || {
            app_local_state_store_serialized(|| {
                store_entered_tx.send(()).unwrap();
                release_store_rx.recv().unwrap();
                write_test_file(
                    &store_path,
                    &json!({
                        "workspace-gui": {
                            "root_directory": "/tmp/gui-workspace",
                            "terminal_count": 2,
                        },
                    }),
                )
            })
            .unwrap();
        });
        store_entered_rx.recv().unwrap();

        let (merge_started_tx, merge_started_rx) = std_mpsc::channel();
        let merge_path = path.clone();
        let merge = thread::spawn(move || {
            merge_started_tx.send(()).unwrap();
            merge_test_file(
                &merge_path,
                &json!({
                    "workspace-cloud": {
                        "root_directory": "/tmp/cloud-workspace",
                        "terminal_count": 1,
                    },
                }),
            )
            .unwrap();
        });
        merge_started_rx.recv().unwrap();
        release_store_tx.send(()).unwrap();
        store.join().unwrap();
        merge.join().unwrap();

        let persisted = read_test_file(&path);
        assert_eq!(
            persisted["workspace-gui"]["root_directory"],
            json!("/tmp/gui-workspace")
        );
        assert_eq!(
            persisted["workspace-cloud"]["root_directory"],
            json!("/tmp/cloud-workspace")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn compare_and_clear_does_not_erase_a_newer_pending_intent() {
        let root = env::temp_dir().join(format!(
            "diffforge-remote-intents-compare-clear-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("remote-intents.json");
        write_test_file(
            &path,
            &json!({
                "pendingActivationWorkspaceId": "workspace-a",
                "pendingActivationReason": "remote-a",
            }),
        )
        .unwrap();
        let (clear_observed_tx, clear_observed_rx) = std_mpsc::channel();
        let (release_clear_tx, release_clear_rx) = std_mpsc::channel();

        let clear_path = path.clone();
        let clear = thread::spawn(move || {
            app_local_state_clear_if_matching_serialized(
                || {
                    let observed = read_test_file(&clear_path);
                    clear_observed_tx.send(()).unwrap();
                    release_clear_rx.recv().unwrap();
                    observed
                },
                |current| write_test_file(&clear_path, current),
                "pendingActivationWorkspaceId",
                "workspace-a",
                &json!({
                    "pendingActivationWorkspaceId": null,
                    "pendingActivationReason": null,
                }),
            )
            .unwrap();
        });
        clear_observed_rx.recv().unwrap();

        let (record_started_tx, record_started_rx) = std_mpsc::channel();
        let record_path = path.clone();
        let record = thread::spawn(move || {
            record_started_tx.send(()).unwrap();
            merge_test_file(
                &record_path,
                &json!({
                    "pendingActivationWorkspaceId": "workspace-b",
                    "pendingActivationReason": "remote-b",
                }),
            )
            .unwrap();
        });
        record_started_rx.recv().unwrap();
        release_clear_tx.send(()).unwrap();
        clear.join().unwrap();
        record.join().unwrap();

        let persisted = read_test_file(&path);
        assert_eq!(
            persisted["pendingActivationWorkspaceId"],
            json!("workspace-b")
        );
        assert_eq!(persisted["pendingActivationReason"], json!("remote-b"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn app_local_state_temp_paths_are_unique_siblings() {
        let target = env::temp_dir()
            .join("diffforge-app-local-state-temp-paths")
            .join("workspace-settings.json");
        let paths = (0..128)
            .map(|_| app_local_state_unique_temp_path(&target))
            .collect::<HashSet<_>>();
        assert_eq!(paths.len(), 128);
        assert!(paths.iter().all(|path| path.parent() == target.parent()));
        assert!(paths.iter().all(|path| path != &target));
    }
}

const TRAY_CLICK_ACTION_SNIP_STRIP: u8 = 0;
const TRAY_CLICK_ACTION_MONITOR: u8 = 1;
const TRAY_CLICK_ACTION_OPEN_APP: u8 = 2;

static TRAY_CLICK_FOREGROUND_ACTION: AtomicU8 = AtomicU8::new(TRAY_CLICK_ACTION_SNIP_STRIP);
static TRAY_CLICK_BACKGROUND_ACTION: AtomicU8 = AtomicU8::new(TRAY_CLICK_ACTION_MONITOR);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TrayClickAction {
    SnipStrip,
    Monitor,
    OpenApp,
}

impl TrayClickAction {
    fn from_wire(value: &str) -> Option<Self> {
        match value.trim() {
            "snipStrip" => Some(Self::SnipStrip),
            "monitor" => Some(Self::Monitor),
            "openApp" => Some(Self::OpenApp),
            _ => None,
        }
    }

    fn from_code(value: u8) -> Self {
        match value {
            TRAY_CLICK_ACTION_MONITOR => Self::Monitor,
            TRAY_CLICK_ACTION_OPEN_APP => Self::OpenApp,
            _ => Self::SnipStrip,
        }
    }

    fn code(self) -> u8 {
        match self {
            Self::SnipStrip => TRAY_CLICK_ACTION_SNIP_STRIP,
            Self::Monitor => TRAY_CLICK_ACTION_MONITOR,
            Self::OpenApp => TRAY_CLICK_ACTION_OPEN_APP,
        }
    }

    fn wire_value(self) -> &'static str {
        match self {
            Self::SnipStrip => "snipStrip",
            Self::Monitor => "monitor",
            Self::OpenApp => "openApp",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct TrayClickSettings {
    foreground_action: TrayClickAction,
    background_action: TrayClickAction,
}

impl Default for TrayClickSettings {
    fn default() -> Self {
        Self {
            foreground_action: TrayClickAction::SnipStrip,
            background_action: TrayClickAction::Monitor,
        }
    }
}

fn tray_click_action_from_object(
    object: &serde_json::Map<String, Value>,
    key: &str,
    default_action: TrayClickAction,
) -> (TrayClickAction, bool) {
    object
        .get(key)
        .and_then(Value::as_str)
        .and_then(TrayClickAction::from_wire)
        .map(|action| (action, false))
        .unwrap_or((default_action, true))
}

fn tray_click_settings_from_value(value: &Value) -> (TrayClickSettings, bool) {
    let Some(object) = value.as_object() else {
        return (TrayClickSettings::default(), true);
    };
    let default_settings = TrayClickSettings::default();
    let (foreground_action, foreground_defaulted) = tray_click_action_from_object(
        object,
        "foregroundAction",
        default_settings.foreground_action,
    );
    let (background_action, background_defaulted) = tray_click_action_from_object(
        object,
        "backgroundAction",
        default_settings.background_action,
    );

    (
        TrayClickSettings {
            foreground_action,
            background_action,
        },
        foreground_defaulted || background_defaulted,
    )
}

fn tray_click_settings_to_value(settings: &TrayClickSettings) -> Value {
    json!({
        "foreground_action": settings.foreground_action.wire_value(),
        "background_action": settings.background_action.wire_value(),
    })
}

fn tray_click_settings_to_persisted_value(settings: &TrayClickSettings) -> Value {
    json!({
        "foregroundAction": settings.foreground_action.wire_value(),
        "backgroundAction": settings.background_action.wire_value(),
    })
}

fn tray_click_settings_apply_cache(settings: &TrayClickSettings) {
    TRAY_CLICK_FOREGROUND_ACTION.store(settings.foreground_action.code(), Ordering::Release);
    TRAY_CLICK_BACKGROUND_ACTION.store(settings.background_action.code(), Ordering::Release);
}

fn tray_click_cached_action(background: bool) -> TrayClickAction {
    let action = if background {
        TRAY_CLICK_BACKGROUND_ACTION.load(Ordering::Acquire)
    } else {
        TRAY_CLICK_FOREGROUND_ACTION.load(Ordering::Acquire)
    };
    TrayClickAction::from_code(action)
}

fn tray_click_settings_read_or_seed(app: &AppHandle) -> Result<(TrayClickSettings, bool), String> {
    let raw = app_local_state_read(app, TRAY_CLICK_SETTINGS_STATE_KEY);
    let (settings, should_write) = tray_click_settings_from_value(&raw);
    if should_write {
        app_local_state_write(
            app,
            TRAY_CLICK_SETTINGS_STATE_KEY,
            &tray_click_settings_to_persisted_value(&settings),
        )?;
    }
    tray_click_settings_apply_cache(&settings);
    Ok((settings, should_write))
}

fn tray_click_settings_save(app: &AppHandle, settings: TrayClickSettings) -> Result<Value, String> {
    app_local_state_write(
        app,
        TRAY_CLICK_SETTINGS_STATE_KEY,
        &tray_click_settings_to_persisted_value(&settings),
    )?;
    tray_click_settings_apply_cache(&settings);
    Ok(tray_click_settings_to_value(&settings))
}

fn tray_click_settings_initialize(app: &AppHandle) {
    let Ok((settings, defaulted)) = tray_click_settings_read_or_seed(app) else {
        log_terminal_status_event(
            "backend.tray_click_settings.seed_error",
            json!({ "state_key": TRAY_CLICK_SETTINGS_STATE_KEY }),
        );
        return;
    };
    log_terminal_status_event(
        "backend.tray_click_settings.ready",
        json!({
            "foreground_action": settings.foreground_action.wire_value(),
            "background_action": settings.background_action.wire_value(),
            "defaulted": defaulted,
        }),
    );
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct StartupSettings {
    enabled: bool,
    launch_mode: String,
    foreground_on_second_launch: bool,
}

impl Default for StartupSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            launch_mode: STARTUP_LAUNCH_MODE_BACKGROUND.to_string(),
            foreground_on_second_launch: true,
        }
    }
}

fn normalize_startup_launch_mode(value: Option<&str>) -> String {
    match value
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        STARTUP_LAUNCH_MODE_BACKGROUND => STARTUP_LAUNCH_MODE_BACKGROUND.to_string(),
        _ => STARTUP_LAUNCH_MODE_BACKGROUND.to_string(),
    }
}

fn startup_settings_from_value(value: &Value) -> (StartupSettings, bool) {
    let Some(object) = value.as_object() else {
        return (StartupSettings::default(), true);
    };
    let default_settings = StartupSettings::default();
    let settings = StartupSettings {
        enabled: object
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(default_settings.enabled),
        launch_mode: normalize_startup_launch_mode(
            object.get("launchMode").and_then(Value::as_str),
        ),
        foreground_on_second_launch: object
            .get("foregroundOnSecondLaunch")
            .and_then(Value::as_bool)
            .unwrap_or(default_settings.foreground_on_second_launch),
    };

    (
        settings,
        !object.contains_key("enabled")
            || !object.contains_key("launchMode")
            || !object.contains_key("foregroundOnSecondLaunch"),
    )
}

fn startup_settings_to_value(settings: &StartupSettings) -> Value {
    json!({
        "enabled": settings.enabled,
        "launchMode": settings.launch_mode,
        "foregroundOnSecondLaunch": settings.foreground_on_second_launch,
    })
}

fn startup_settings_state_value(
    settings: &StartupSettings,
    autostart_enabled: Option<bool>,
    defaulted: bool,
) -> Value {
    json!({
        "enabled": settings.enabled,
        "launch_mode": settings.launch_mode,
        "foreground_on_second_launch": settings.foreground_on_second_launch,
        "autostart_enabled": autostart_enabled,
        "defaulted": defaulted,
    })
}

fn startup_autostart_is_enabled(app: &AppHandle) -> Result<bool, String> {
    if daemon_mode_active() {
        return Ok(false);
    }
    app.autolaunch()
        .is_enabled()
        .map_err(|error| format!("Unable to read startup registration: {error}"))
}

fn startup_apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    if daemon_mode_active() {
        return Ok(());
    }
    let autostart = app.autolaunch();
    if enabled {
        autostart
            .enable()
            .map_err(|error| format!("Unable to enable startup registration: {error}"))
    } else {
        autostart
            .disable()
            .map_err(|error| format!("Unable to disable startup registration: {error}"))
    }
}

fn startup_settings_read_or_seed(app: &AppHandle) -> Result<(StartupSettings, bool), String> {
    let raw = app_local_state_read(app, STARTUP_SETTINGS_STATE_KEY);
    let (settings, should_write) = startup_settings_from_value(&raw);
    if should_write {
        app_local_state_write(
            app,
            STARTUP_SETTINGS_STATE_KEY,
            &startup_settings_to_value(&settings),
        )?;
    }
    Ok((settings, should_write))
}

fn startup_settings_save_and_apply(
    app: &AppHandle,
    settings: StartupSettings,
) -> Result<Value, String> {
    app_local_state_write(
        app,
        STARTUP_SETTINGS_STATE_KEY,
        &startup_settings_to_value(&settings),
    )?;
    startup_apply_autostart(app, settings.enabled)?;
    Ok(startup_settings_state_value(
        &settings,
        startup_autostart_is_enabled(app).ok(),
        false,
    ))
}

fn startup_settings_initialize(app: &AppHandle) {
    let Ok((settings, defaulted)) = startup_settings_read_or_seed(app) else {
        log_terminal_status_event(
            "backend.startup_settings.seed_error",
            json!({ "state_key": STARTUP_SETTINGS_STATE_KEY }),
        );
        return;
    };
    if let Err(error) = startup_apply_autostart(app, settings.enabled) {
        log_terminal_status_event(
            "backend.startup_settings.autostart_error",
            json!({
                "enabled": settings.enabled,
                "error": error,
            }),
        );
        return;
    }
    log_terminal_status_event(
        "backend.startup_settings.ready",
        json!({
            "enabled": settings.enabled,
            "launch_mode": settings.launch_mode,
            "defaulted": defaulted,
            "autostart_enabled": startup_autostart_is_enabled(app).ok(),
        }),
    );
}

fn startup_args_request_background(args: &[String]) -> bool {
    args.iter()
        .any(|arg| arg.trim().eq_ignore_ascii_case(STARTUP_BACKGROUND_ARG))
}

#[tauri::command(rename_all = "snake_case")]
async fn app_startup_settings_state(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (settings, defaulted) = startup_settings_read_or_seed(&app)?;
        Ok(startup_settings_state_value(
            &settings,
            startup_autostart_is_enabled(&app).ok(),
            defaulted,
        ))
    })
    .await
    .map_err(|error| format!("Startup settings worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn app_startup_settings_update(
    app: AppHandle,
    enabled: bool,
    launch_mode: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (mut settings, _) = startup_settings_read_or_seed(&app)?;
        settings.enabled = enabled;
        settings.launch_mode = normalize_startup_launch_mode(launch_mode.as_deref());
        settings.foreground_on_second_launch = true;
        startup_settings_save_and_apply(&app, settings)
    })
    .await
    .map_err(|error| format!("Startup settings worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn tray_click_settings_state(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (settings, _) = tray_click_settings_read_or_seed(&app)?;
        Ok(tray_click_settings_to_value(&settings))
    })
    .await
    .map_err(|error| format!("Tray click settings worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn tray_click_settings_update(
    app: AppHandle,
    foreground_action: Option<String>,
    background_action: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (mut settings, _) = tray_click_settings_read_or_seed(&app)?;
        let default_settings = TrayClickSettings::default();
        if let Some(action) = foreground_action.as_deref() {
            settings.foreground_action =
                TrayClickAction::from_wire(action).unwrap_or(default_settings.foreground_action);
        }
        if let Some(action) = background_action.as_deref() {
            settings.background_action =
                TrayClickAction::from_wire(action).unwrap_or(default_settings.background_action);
        }
        tray_click_settings_save(&app, settings)
    })
    .await
    .map_err(|error| format!("Tray click settings worker failed: {error}"))?
}

#[cfg(test)]
mod tray_click_settings_tests {
    use super::*;

    #[test]
    fn tray_click_settings_from_value_defaults_on_garbage() {
        let (settings, defaulted) = tray_click_settings_from_value(&json!("garbage"));
        assert!(defaulted);
        assert_eq!(settings, TrayClickSettings::default());

        let (settings, defaulted) = tray_click_settings_from_value(&json!({
            "foregroundAction": "openApp",
            "backgroundAction": "notAnAction",
        }));
        assert!(defaulted);
        assert_eq!(settings.foreground_action, TrayClickAction::OpenApp);
        assert_eq!(settings.background_action, TrayClickAction::Monitor);

        let (settings, defaulted) = tray_click_settings_from_value(&json!({
            "foregroundAction": 42,
            "backgroundAction": "snipStrip",
        }));
        assert!(defaulted);
        assert_eq!(settings.foreground_action, TrayClickAction::SnipStrip);
        assert_eq!(settings.background_action, TrayClickAction::SnipStrip);
    }

    #[test]
    fn tray_click_settings_to_value_round_trips() {
        let settings = TrayClickSettings {
            foreground_action: TrayClickAction::Monitor,
            background_action: TrayClickAction::OpenApp,
        };

        let value = tray_click_settings_to_persisted_value(&settings);
        assert_eq!(
            value,
            json!({
                "foregroundAction": "monitor",
                "backgroundAction": "openApp",
            })
        );

        let (parsed, defaulted) = tray_click_settings_from_value(&value);
        assert!(!defaulted);
        assert_eq!(parsed, settings);
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn close_app_after_terminal_shutdown(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    let window_label = window.label().to_string();
    let force_exit_result = schedule_app_force_exit(app.clone(), window_label.clone());
    start_backend_app_shutdown_with_watchdog(app, window_label, force_exit_result)
}

#[tauri::command(rename_all = "snake_case")]
async fn app_force_exit_now(app: AppHandle, reason: Option<String>) -> Result<(), String> {
    let reason = normalize_app_force_exit_reason(reason, "app_force_exit_now");
    log_terminal_crash_forensics_event(
        "backend.app_force_exit_now.requested",
        json!({
            "reason": reason,
        }),
    );

    match spawn_app_force_exit_thread(
        app.clone(),
        Some("main".to_string()),
        Duration::from_millis(0),
        "diffforge-app-force-exit-now",
        reason.clone(),
    ) {
        Ok(()) => Ok(()),
        Err(error) => {
            eprintln!("Failed to spawn immediate app force-exit thread: {error}");
            run_app_force_exit_tail(app, Some("main".to_string()), reason);
            Ok(())
        }
    }
}

fn start_backend_app_shutdown(app: AppHandle, window_label: String) -> Result<(), String> {
    let force_exit_result = schedule_app_force_exit(app.clone(), window_label.clone());
    start_backend_app_shutdown_with_watchdog(app, window_label, force_exit_result)
}

fn start_backend_app_shutdown_with_watchdog(
    app: AppHandle,
    window_label: String,
    force_exit_result: Result<(), String>,
) -> Result<(), String> {
    let _ = begin_app_shutdown();

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

    if let Some(window) = app.get_window("main") {
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

fn present_main_window(app: &AppHandle) {
    if app_is_in_background_mode() {
        app_exit_background_internal(app);
        return;
    }

    #[cfg(target_os = "macos")]
    restore_main_window_after_reopen(app.clone(), false);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = restore_main_window(app);
    }
}

#[cfg(target_os = "macos")]
fn main_window_apply_macos_mouse_moved_style(window: &tauri::Window) {
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
        let mut focused_poll_ms = MAIN_WINDOW_CURSOR_POLL_MS;
        let mut unchanged_focused_samples = 0u32;

        loop {
            let Some(window) = app.get_window("main") else {
                last_snapshot = None;
                focused_poll_ms = MAIN_WINDOW_CURSOR_POLL_MS;
                unchanged_focused_samples = 0;
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
            let snapshot_changed = last_snapshot != Some(snapshot);
            let focus_transition = last_snapshot
                .map(|previous| previous.3 != focused)
                .unwrap_or(false);

            if snapshot_changed {
                let payload = if hovered {
                    json!({
                        "hovered": true,
                        "focused": focused,
                        "client_x": client_x,
                        "client_y": client_y,
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

            if visible && focused {
                if snapshot_changed || focus_transition {
                    focused_poll_ms = MAIN_WINDOW_CURSOR_POLL_MS;
                    unchanged_focused_samples = 0;
                } else {
                    unchanged_focused_samples = unchanged_focused_samples.saturating_add(1);
                    if unchanged_focused_samples >= MAIN_WINDOW_CURSOR_BACKOFF_UNCHANGED_SAMPLES {
                        focused_poll_ms = if focused_poll_ms < MAIN_WINDOW_CURSOR_BACKOFF_POLL_MS {
                            MAIN_WINDOW_CURSOR_BACKOFF_POLL_MS
                        } else {
                            MAIN_WINDOW_CURSOR_FOCUSED_IDLE_POLL_MS
                        };
                        unchanged_focused_samples = 0;
                    }
                }
            } else {
                focused_poll_ms = MAIN_WINDOW_CURSOR_POLL_MS;
                unchanged_focused_samples = 0;
            }

            // Only poll at the fast hover cadence when the window is the active
            // (visible AND focused) window. A visible-but-unfocused/background
            // window drops to the slow idle cadence instead of waking ~20-30x/sec.
            let cursor_poll_ms = if visible && focused {
                focused_poll_ms
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

    if let Some(window) = app.get_window("main") {
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

#[tauri::command(rename_all = "snake_case")]
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
        assert_eq!(result["agents_root_removed"], json!(true));
        assert_eq!(result["private_state_root_removed"], json!(true));
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
        assert_eq!(result["private_state_root_removed"], json!(true));
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
    app.get_window("main")
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

fn daemon_lockfile_path() -> Result<PathBuf, String> {
    let state_dir = cloud_mcp_native_data_root()
        .ok_or_else(|| "Unable to resolve Diff Forge device data directory.".to_string())?
        .join(DEVICE_APP_STATE_DIR);
    fs::create_dir_all(&state_dir)
        .map_err(|error| format!("Unable to create daemon state directory: {error}"))?;
    Ok(state_dir.join("daemon.lock"))
}

fn daemon_lockfile_pid(path: &Path) -> Option<u32> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| raw.trim().parse::<u32>().ok())
}

// Only removes the lockfile while it still names this process: a SIGTERM'd
// daemon lingers for seconds in the force-exit fallback delays, long enough
// for a supervisor to start a successor that owns a fresh lock.
fn daemon_lockfile_remove_current() {
    if let Some(path) = DAEMON_LOCK_PATH.get() {
        if daemon_lockfile_pid(path) == Some(std::process::id()) {
            let _ = fs::remove_file(path);
        }
    }
}

fn daemon_process_identity_refresh_kind() -> sysinfo::ProcessRefreshKind {
    // Plain refresh_processes does NOT fetch cmd/exe in sysinfo 0.39 —
    // identity checks silently see cmd=[] without these update kinds.
    sysinfo::ProcessRefreshKind::nothing()
        .with_cmd(sysinfo::UpdateKind::Always)
        .with_exe(sysinfo::UpdateKind::Always)
        .without_tasks()
}

// A live pid alone is not enough: after a crash leaves a stale lock, the OS
// can recycle that pid onto an unrelated process and lock the daemon out
// forever. The lock holder must also look like a diffforge daemon process —
// but when identity CANNOT be determined, a live pid counts as a live daemon:
// mutual exclusion is the invariant, pid-reuse recovery the convenience.
fn daemon_pid_is_live_daemon(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    if pid == std::process::id() {
        return false;
    }
    let sys_pid = sysinfo::Pid::from_u32(pid);
    let mut system = sysinfo::System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[sys_pid]),
        true,
        daemon_process_identity_refresh_kind(),
    );
    let Some(process) = system.process(sys_pid) else {
        return false;
    };
    let current_exe_name = std::env::current_exe()
        .ok()
        .and_then(|path| path.file_name().map(|name| name.to_os_string()));
    if let (Some(current), Some(exe)) = (current_exe_name.as_deref(), process.exe()) {
        if let Some(exe_name) = exe.file_name() {
            if exe_name != current {
                return false;
            }
        }
    }
    let cmd = process.cmd();
    if cmd.is_empty() {
        return true;
    }
    cmd.iter()
        .skip(1)
        .any(|arg| arg.to_string_lossy() == "daemon")
}

fn daemon_lockfile_acquire() -> Result<PathBuf, String> {
    let path = daemon_lockfile_path()?;
    // At most one stale-lock removal, then a read-back ownership check: two
    // daemons racing the same stale lock can otherwise both pass create_new
    // (the loser's remove_file deletes the winner's fresh lock).
    for attempt in 0..2 {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                if let Err(error) = writeln!(file, "{}", std::process::id()) {
                    let _ = fs::remove_file(&path);
                    return Err(format!("Unable to write daemon lockfile: {error}"));
                }
                drop(file);
                thread::sleep(Duration::from_millis(50));
                if daemon_lockfile_pid(&path) != Some(std::process::id()) {
                    return Err(format!(
                        "diffforge daemon lost a startup race for {}; another daemon is starting.",
                        path.display()
                    ));
                }
                let _ = DAEMON_LOCK_PATH.set(path.clone());
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if let Some(pid) = daemon_lockfile_pid(&path) {
                    if daemon_pid_is_live_daemon(pid) {
                        return Err(format!(
                            "diffforge daemon is already running with pid {pid} ({})",
                            path.display()
                        ));
                    }
                }
                if attempt > 0 {
                    return Err(format!(
                        "diffforge daemon could not acquire {}; another daemon is starting.",
                        path.display()
                    ));
                }
                fs::remove_file(&path)
                    .map_err(|error| format!("Unable to remove stale daemon lockfile: {error}"))?;
            }
            Err(error) => {
                return Err(format!("Unable to create daemon lockfile: {error}"));
            }
        }
    }
    Err(format!(
        "diffforge daemon could not acquire {}.",
        path.display()
    ))
}

// Same device identity, shared SQLite/PTY/MCP state: a daemon running next
// to the desktop app will claim cloud remote commands the GUI could have
// executed and answer them "blocked". Warn loudly; BYOC boxes have no GUI.
fn daemon_warn_if_gui_instance_running() {
    let Ok(current_exe) = std::env::current_exe() else {
        return;
    };
    let Some(exe_name) = current_exe.file_name().map(|name| name.to_os_string()) else {
        return;
    };
    let mut system = sysinfo::System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        daemon_process_identity_refresh_kind(),
    );
    let current_pid = std::process::id();
    for process in system.processes().values() {
        if process.pid().as_u32() == current_pid {
            continue;
        }
        let exe_matches = process
            .exe()
            .map(|exe| exe.file_name() == Some(exe_name.as_os_str()))
            .unwrap_or(false);
        if !exe_matches {
            continue;
        }
        // GUI = plain launch or --background-startup; every other subcommand
        // (daemon, auth, the --*-mcp/helper family) is windowless. Empty cmd
        // means the args could not be read — skip rather than misclassify.
        let cmd = process.cmd();
        if cmd.is_empty() {
            continue;
        }
        let first_arg = cmd
            .get(1)
            .map(|arg| arg.to_string_lossy().to_string())
            .unwrap_or_default();
        let is_gui_instance = first_arg.is_empty()
            || first_arg == STARTUP_BACKGROUND_ARG
            || !(first_arg.starts_with("--") || first_arg == "daemon" || first_arg == "auth");
        if is_gui_instance {
            eprintln!(
                "diffforge daemon: WARNING — the Diff Forge desktop app appears to be running (pid {}). Both processes share this device's identity; cloud remote commands may be claimed by the daemon and answered \"blocked\" instead of reaching the app.",
                process.pid().as_u32()
            );
            return;
        }
    }
}

fn daemon_spawn_signal_handler(app: AppHandle) {
    #[cfg(unix)]
    async fn daemon_wait_for_shutdown_signal(sigterm: &mut Option<tokio::signal::unix::Signal>) {
        if let Some(sigterm) = sigterm.as_mut() {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = sigterm.recv() => {}
            }
        } else {
            let _ = tokio::signal::ctrl_c().await;
        }
    }

    #[cfg(not(unix))]
    async fn daemon_wait_for_shutdown_signal(_sigterm: &mut Option<()>) {
        let _ = tokio::signal::ctrl_c().await;
    }

    tauri::async_runtime::spawn(async move {
        #[cfg(unix)]
        let mut sigterm =
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(stream) => Some(stream),
                Err(error) => {
                    eprintln!("diffforge daemon: unable to register SIGTERM handler: {error}");
                    None
                }
            };
        #[cfg(not(unix))]
        let mut sigterm: Option<()> = None;

        daemon_wait_for_shutdown_signal(&mut sigterm).await;
        eprintln!("diffforge daemon: shutdown signal received");
        let _ = start_backend_app_shutdown(app.clone(), "main".to_string());
        app.exit(0);

        // A second signal must still work when the graceful path hangs:
        // release the lock (ownership-checked) and hard-exit.
        daemon_wait_for_shutdown_signal(&mut sigterm).await;
        eprintln!("diffforge daemon: second shutdown signal received, forcing exit");
        daemon_lockfile_remove_current();
        std::process::exit(130);
    });
}

fn terminal_process_epoch_lock_file(file: &fs::File) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd as _;
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err(format!(
                "Unable to lock the terminal process epoch counter: {}",
                std::io::Error::last_os_error()
            ));
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle as _;
        use windows_sys::Win32::Storage::FileSystem::{LockFileEx, LOCKFILE_EXCLUSIVE_LOCK};
        use windows_sys::Win32::System::IO::OVERLAPPED;

        let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
        if unsafe {
            LockFileEx(
                file.as_raw_handle(),
                LOCKFILE_EXCLUSIVE_LOCK,
                0,
                u32::MAX,
                u32::MAX,
                &mut overlapped,
            )
        } == 0
        {
            return Err(format!(
                "Unable to lock the terminal process epoch counter: {}",
                std::io::Error::last_os_error()
            ));
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        return Err(
            "Terminal process epoch persistence is unsupported on this platform.".to_string(),
        );
    }
    Ok(())
}

fn terminal_process_epoch_allocate_at(
    counter_path: &Path,
    timestamp_ms: u64,
    unique_suffix: &str,
) -> Result<String, String> {
    let parent = counter_path
        .parent()
        .ok_or_else(|| "Unable to resolve the terminal process epoch directory.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Unable to create the terminal process epoch directory {}: {error}",
            parent.display()
        )
    })?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .append(true)
        .open(counter_path)
        .map_err(|error| {
            format!(
                "Unable to open terminal process epoch counter {}: {error}",
                counter_path.display()
            )
        })?;
    terminal_process_epoch_lock_file(&file)?;

    file.seek(SeekFrom::Start(0)).map_err(|error| {
        format!(
            "Unable to seek terminal process epoch counter {}: {error}",
            counter_path.display()
        )
    })?;
    let mut persisted = String::new();
    file.read_to_string(&mut persisted).map_err(|error| {
        format!(
            "Unable to read terminal process epoch counter {}: {error}",
            counter_path.display()
        )
    })?;
    let previous_counter = persisted
        .lines()
        .filter_map(|line| line.trim().parse::<u64>().ok())
        .max()
        .unwrap_or(0);
    let counter = previous_counter
        .checked_add(1)
        .ok_or_else(|| "Terminal process epoch counter is exhausted.".to_string())?;
    let sequence = TERMINAL_PROCESS_EPOCH_SEQUENCE_BASE
        .checked_add(counter)
        .filter(|sequence| *sequence <= TERMINAL_PROCESS_EPOCH_MAX_SAFE_SEQUENCE)
        .ok_or_else(|| "Terminal process epoch sequence is exhausted.".to_string())?;
    writeln!(file, "{counter}").map_err(|error| {
        format!(
            "Unable to append terminal process epoch counter {}: {error}",
            counter_path.display()
        )
    })?;
    file.flush().map_err(|error| {
        format!(
            "Unable to flush terminal process epoch counter {}: {error}",
            counter_path.display()
        )
    })?;
    file.sync_all().map_err(|error| {
        format!(
            "Unable to persist terminal process epoch counter {}: {error}",
            counter_path.display()
        )
    })?;

    Ok(format!("{sequence:020}-{timestamp_ms:020}-{unique_suffix}"))
}

fn terminal_process_epoch_allocate() -> Result<String, String> {
    let root = cloud_mcp_native_data_root()
        .ok_or_else(|| "Unable to resolve the Diff Forge device data directory.".to_string())?;
    terminal_process_epoch_allocate_at(
        &root
            .join(DEVICE_APP_STATE_DIR)
            .join(TERMINAL_PROCESS_EPOCH_COUNTER_FILE),
        current_time_ms(),
        &uuid::Uuid::new_v4().to_string(),
    )
}

#[cfg(test)]
mod terminal_process_epoch_tests {
    use super::*;

    #[test]
    fn persistent_counter_orders_clock_rollback_and_same_millisecond_antisymmetrically() {
        let root = env::temp_dir().join(format!(
            "diffforge-terminal-process-epoch-{}",
            uuid::Uuid::new_v4()
        ));
        let counter_path = root.join(TERMINAL_PROCESS_EPOCH_COUNTER_FILE);

        let first = terminal_process_epoch_allocate_at(&counter_path, 200, "process-a").unwrap();
        let rollback = terminal_process_epoch_allocate_at(&counter_path, 100, "process-b").unwrap();
        let same_millisecond =
            terminal_process_epoch_allocate_at(&counter_path, 100, "process-c").unwrap();

        assert!(
            rollback > first,
            "persistent counter must beat a clock rollback"
        );
        assert!(
            same_millisecond > rollback,
            "same-millisecond processes must have a strict total order"
        );
        assert!(first.contains("-00000000000000000200-process-a"));
        assert!(rollback.contains("-00000000000000000100-process-b"));
        assert_eq!(fs::read_to_string(&counter_path).unwrap(), "1\n2\n3\n");

        let _ = fs::remove_dir_all(root);
    }
}

pub fn run() {
    run_app(false)
}

pub fn run_daemon() {
    set_daemon_mode_active(true);
    run_app(true)
}

fn run_app(daemon: bool) {
    set_daemon_mode_active(daemon);
    configure_windows_process_error_mode();
    configure_safe_process_current_directory();
    install_app_panic_log_hook();

    let startup_args = env::args().collect::<Vec<_>>();
    let background_startup_requested = startup_args_request_background(&startup_args);
    let daemon_lock_path = if daemon {
        match daemon_lockfile_acquire() {
            Ok(path) => {
                daemon_warn_if_gui_instance_running();
                Some(path)
            }
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
    } else {
        None
    };
    let mut builder = tauri::Builder::default();
    let pty_pool = Arc::new(PtyPool::new());
    let terminal_process_epoch = match terminal_process_epoch_allocate() {
        Ok(epoch) => epoch,
        Err(error) => {
            eprintln!("Unable to allocate terminal process epoch: {error}");
            std::process::exit(1);
        }
    };
    log_terminal_crash_forensics_event(
        "backend.process_start",
        json!({
            "log_file": terminal_crash_forensics_log_path().display().to_string(),
            "terminal_status_logging_enabled": terminal_status_logging_enabled(),
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
            "enabled": workspace_activation_logging_enabled(),
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
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
        if !daemon {
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
                let deep_link_urls = deep_link_urls_from_args(&argv);
                let background_startup = startup_args_request_background(&argv);

                if background_startup && deep_link_urls.is_empty() {
                    app_enter_background_internal(app);
                } else {
                    present_main_window(app);
                }

                emit_deep_link_urls(app, deep_link_urls);
            }));
        }
    }

    builder = builder
        .manage(TerminalState {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            pending_restart_intents: Arc::new(StdMutex::new(HashMap::new())),
            next_restart_intent_seq: AtomicU64::new(1),
            terminal_input_queues: Arc::new(StdMutex::new(HashMap::new())),
            terminal_input_transport: Arc::new(StdMutex::new(None)),
            terminal_output_transport: Arc::new(StdMutex::new(None)),
            terminal_activity_transport: Arc::new(StdMutex::new(None)),
            terminal_activity_transport_tokens: Arc::new(StdMutex::new(HashMap::new())),
            terminal_structured_interactions: Arc::new(StdMutex::new(HashMap::new())),
            terminal_structured_interaction_waiters: Arc::new(StdMutex::new(HashMap::new())),
            terminal_output_transport_subscribers: Arc::new(StdMutex::new(HashMap::new())),
            parked_prompts: Arc::new(RwLock::new(HashMap::new())),
            active_audio_input_target: Arc::new(StdMutex::new(None)),
            audio_route_gate: Arc::new(StdMutex::new(TerminalAudioRouteGate::default())),
            lifecycle_lock: Arc::new(Mutex::new(())),
            pty_pool: Arc::clone(&pty_pool),
            cleanup_tracker: Arc::new(TerminalCleanupTracker::new()),
            workspace_topology_cache: Arc::new(RwLock::new(HashMap::new())),
            terminal_process_epoch,
            next_terminal_instance_id: AtomicU64::new(1),
            next_terminal_input_queue_id: AtomicU64::new(1),
            next_terminal_output_subscriber_id: AtomicU64::new(1),
        })
        .manage(TerminalDiagnosticState::new())
        .manage(WindowsTerminalDiagnosticState::new())
        .manage(SwarmRuntimeState::new())
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
            local_whisper_partial: Arc::new(Mutex::new(None)),
            local_whisper_partial_generation: Arc::new(AtomicU64::new(0)),
        })
        .manage(VmSandboxState::default())
        .manage(SnippingState::new());

    if !daemon {
        builder = builder
            .plugin(tauri_plugin_autostart::init(
                MacosLauncher::LaunchAgent,
                Some(vec![STARTUP_BACKGROUND_ARG]),
            ))
            .plugin(tauri_plugin_deep_link::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .plugin(tauri_plugin_notification::init())
            .plugin(tauri_plugin_opener::init());
    }

    let daemon_lock_path_for_setup = daemon_lock_path.clone();
    let daemon_lock_path_for_run = daemon_lock_path.clone();
    let mut context = tauri::generate_context!();
    if daemon {
        context.config_mut().app.windows.clear();
    }

    let mut app = builder
        .setup(move |app| {
            if daemon {
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Prohibited);
                daemon_spawn_signal_handler(app.handle().clone());
            }
            pty_pool.ensure_warm_async();
            startup_settings_initialize(app.handle());
            tray_click_settings_initialize(app.handle());
            cloud_mcp_register_sync_status_app(app.handle());
            let cloud_mcp_state = app.state::<CloudMcpState>().inner().clone();
            let cloud_mcp_app = app.handle().clone();
            if daemon {
                // Install the remote-command consumer synchronously during
                // setup, before any background worker can open the daemon
                // websocket and forward its first command.
                if let Err(error) = cloud_mcp_ensure_remote_command_listener(
                    cloud_mcp_app.clone(),
                    cloud_mcp_state.clone(),
                ) {
                    eprintln!(
                        "diffforge daemon: unable to start remote command listener: {error}"
                    );
                }
            }
            let app_control_bridge_app = app.handle().clone();
            let app_control_bridge_state = app.state::<AppControlMcpState>().inner().clone();
            tauri::async_runtime::spawn(async move {
                let _ = app_control_mcp_endpoint_for_state(
                    app_control_bridge_app,
                    &app_control_bridge_state,
                )
                .await;
            });
            desktop_auth_start_renewal_loop(app.handle().clone(), cloud_mcp_state.clone());
            tauri::async_runtime::spawn(async move {
                // Restore the persisted desktop session before the first
                // connect so cloud auth comes up without waiting for the
                // webview (background-capable startup).
                if daemon {
                    match tauri::async_runtime::spawn_blocking(
                        desktop_auth_try_provision_from_environment,
                    )
                    .await
                    {
                        Ok(Ok(true)) => eprintln!(
                            "diffforge daemon: provisioning token redeemed — session established"
                        ),
                        Ok(Ok(false)) => {}
                        Ok(Err(error)) => {
                            eprintln!("diffforge daemon: provisioning token redeem failed: {error}")
                        }
                        Err(error) => eprintln!(
                            "diffforge daemon: provisioning token redeem failed: worker failed: {error}"
                        ),
                    }
                }
                let restored_auth = desktop_auth_restore_cloud_session_for_startup(
                    &cloud_mcp_app,
                    &cloud_mcp_state,
                )
                .await;
                if daemon {
                    if restored_auth {
                        eprintln!("diffforge daemon: cloud session restored");
                    } else {
                        eprintln!(
                            "diffforge daemon: no cloud session -- run 'diff-forge auth login' on this machine"
                        );
                    }
                }
                let daemon_workspace_catalog = if daemon {
                    match cloud_mcp_prepare_daemon_startup_workspace_catalog(&cloud_mcp_app).await {
                        Ok(workspaces) => Some(workspaces),
                        Err(error) => {
                            eprintln!(
                                "diffforge daemon: unable to prepare authoritative workspace catalog: {error}"
                            );
                            None
                        }
                    }
                } else {
                    None
                };
                // Free accounts have no personal cloud instance, so skip the
                // account websocket entirely (permanent-offline mode). Daemon
                // mode always connects — it is a headless, cloud-first setup.
                // If the plan upgrades later, the webview's paid-gated warmup
                // opens the connection.
                let should_auto_connect = daemon || desktop_auth_account_is_paid(&cloud_mcp_app);
                let cloud_connected = if should_auto_connect {
                    cloud_mcp_connect_state(&cloud_mcp_state).await.is_ok()
                } else {
                    false
                };
                if cloud_connected {
                    if let Some(workspaces) = daemon_workspace_catalog {
                        if let Err(error) = cloud_mcp_publish_daemon_startup_workspace_catalog(
                            &cloud_mcp_state,
                            workspaces,
                        )
                        .await
                        {
                            eprintln!(
                                "diffforge daemon: unable to publish startup workspace catalog: {error}"
                            );
                        }
                    }
                }
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
            energy_impact::energy_impact_start();
            video_cloud_generation_events_start(
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
            #[cfg(desktop)]
            {
                app_update_settings_initialize(app.handle());
                app_updater_start(app.handle());
            }
            // Always-present tray: left-click behavior is driven by the
            // persisted tray-click settings seeded above.
            // (Setup runs on the main thread, which NSStatusItem requires.)
            if !daemon {
                background_tray_create(app.handle());
            }
            todo_store_orphan_sweep_start(app.handle().clone());
            agent_accounts_capture_watch_start(app.handle().clone());
            // Startup todo recovery is bounded, not destructive: queued work
            // survives app startup, while ambiguous in-flight rows wait for
            // Rust terminal/workspace evidence or a 45s timeout before being
            // reclassified.
            todo_store_startup_sweep(app.handle());
            register_terminal_input_event_listener(app);
            register_terminal_coordination_event_bridge(app);

            if !daemon {
                register_audio_shortcuts(app.handle());
                register_snipping_shortcuts(app.handle());
                if SNIPPING_STARTUP_PREWARM_ENABLED {
                    prewarm_snipping_overlay_window(app.handle());
                }
                register_activity_overlay_shortcut(app.handle());
            }

            #[cfg(any(windows, target_os = "linux"))]
            {
                if !daemon {
                    use tauri_plugin_deep_link::DeepLinkExt;
                    app.deep_link().register_all()?;
                }
            }

            #[cfg(windows)]
            {
                if !daemon {
                    if let Some(window) = app.get_window("main") {
                        if let Ok(hwnd) = window.hwnd() {
                            pin_windows_hang_icon(hwnd.0);
                        }
                    }
                }
            }

            #[cfg(target_os = "macos")]
            {
                if !daemon {
                    if let Some(window) = app.get_window("main") {
                        let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
                        main_window_apply_macos_mouse_moved_style(&window);
                    }
                }
            }
            if !daemon {
                start_main_window_cursor_watcher(app.handle());
                if background_startup_requested {
                    app_enter_background_internal(app.handle());
                }
            }

            if daemon {
                let lock_path = daemon_lock_path_for_setup
                    .as_ref()
                    .map(|path| path.display().to_string())
                    .unwrap_or_default();
                eprintln!("diffforge daemon: services started (pid {})", std::process::id());
                log_terminal_crash_forensics_event(
                    "backend.daemon_ready",
                    json!({
                        "pid": std::process::id(),
                        "lock_path": lock_path,
                    }),
                );
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_update_status,
            app_update_check_now,
            app_update_download,
            app_update_restart,
            app_update_install_and_restart,
            app_update_settings_state,
            app_update_settings_update,
            backend_ping,
            backend_cpu_attribution_snapshot,
            desktop_auth_snapshot_command,
            desktop_auth_start_login,
            desktop_auth_validate_session,
            desktop_auth_handle_deep_link,
            desktop_auth_set_active_scope,
            desktop_auth_apply_billing_status,
            desktop_auth_sign_out,
            desktop_billing_start_topup_checkout,
            local_workspaces_load,
            local_workspaces_store,
            local_workspace_reusable_id_for_root,
            open_html_document_in_browser,
            workspace_webview_open,
            workspace_webview_adopt,
            workspace_webview_fit,
            workspace_webview_eval,
            workspace_webview_close,
            app_local_state_load,
            app_local_state_store,
            app_local_state_merge_command,
            app_startup_settings_state,
            app_startup_settings_update,
            tray_click_settings_state,
            tray_click_settings_update,
            agent_statuses,
            opencode_list_models,
            start_agent_login,
            start_agent_account_login,
            agent_accounts_start_profile_login,
            agent_accounts_web_login_command,
            agent_accounts_cancel_profile_login,
            agent_accounts_bind_login_terminal,
            agent_accounts_reconcile_workspace_trust,
            disconnect_agent,
            install_agent,
            update_agent,
            retry_update_agent_as_administrator,
            cancel_agent_update,
            uninstall_agent,
            tools_check_cli_binaries,
            tools_run_cli_action,
            terminal_activity_snapshot,
            terminal_subagents_snapshot,
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
            pcb_vendor_fetch,
            pcb_watch_start,
            pcb_panel_open,
            pcb_panel_focus,
            pcb_panel_close,
            pcb_window_open,
            pcb_window_close,
            video_tools_status,
            video_tools_install,
            video_tools_install_cancel,
            video_watch_start,
            video_media_list,
            video_media_manifest_get,
            video_media_folder_create,
            video_media_folder_rename,
            video_media_folder_delete,
            video_media_set_folder,
            video_media_import,
            video_media_delete,
            video_media_waveform,
            video_media_filmstrip,
            video_frame_extract,
            video_projects_list,
            video_project_create,
            video_project_read,
            video_project_write,
            video_project_delete,
            video_agent_state_set,
            video_export_start,
            video_export_cancel,
            video_export_encoders,
            video_detect_silences,
            video_draft_render,
            video_export_fcpxml,
            video_export_premiere_xml,
            video_render_frame,
            video_transcribe_start,
            video_transcribe_cancel,
            video_transcript_get,
            video_transcript_update,
            video_transcript_delete,
            video_transcript_export,
            video_generate_start,
            video_generate_resume,
            video_generate_cancel,
            video_generate_code_render,
            video_code_tools_status,
            video_code_tools_install,
            video_code_tools_install_cancel,
            video_code_preview_start,
            video_code_preview_stop,
            video_polish_start,
            video_polish_cancel,
            video_annotation_get,
            video_annotation_update,
            video_annotation_delete,
            video_describe_start,
            video_describe_cancel,
            video_jobs_list,
            video_jobs_delete,
            video_generation_providers,
            video_lora_list,
            video_lora_delete,
            video_lora_train_start,
            video_panel_open,
            video_panel_focus,
            video_panel_close,
            delete_workspace_local_metadata,
            run_forge_prompt,
            agent_thread_turn_start,
            save_todo_image_attachments,
            stage_chat_attachment_refs,
            save_todo_text_attachment,
            whisper_model_status,
            download_whisper_model,
            vm_sandbox_runtime_status,
            vm_sandbox_install_runtime,
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
            start_local_whisper_partial_transcription,
            stop_local_whisper_partial_transcription,
            cancel_local_whisper_partial_transcription,
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
            set_snipping_visible_in_captures,
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
            snipping_unpublish_uploaded_asset,
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
            snipping_windows_debug_log,
            snipping_preview_drag_started,
            snipping_preview_drag_moved,
            snipping_preview_drag_released,
            snipping_consume_snip_preview,
            snipping_set_dispatch_targets,
            snipping_dispatch_targets,
            snipping_open_annotation_editor_batch,
            snipping_copy_untracked_asset_to_clipboard,
            snipping_copy_text_to_clipboard,
            snipping_cancel_area_snip,
            audio_widget_status,
            audio_widget_set_capture_visible,
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
            terminal_remote_presence_snapshot,
            cloud_mcp_get_network_diagnostics,
            cloud_mcp_get_cached_workspace_todos,
            cloud_mcp_get_billing_status,
            cloud_mcp_refresh_billing_status,
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
            cloud_mcp_record_client_action_ack,
            cloud_mcp_record_agent_chat_model_config,
            cloud_mcp_record_agent_chat_permission_config,
            cloud_mcp_get_audio_preferences,
            cloud_mcp_set_audio_preferences,
            cloud_mcp_get_notification_preferences,
            cloud_mcp_set_notification_preferences,
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
            cloud_mcp_unpublish_account_asset,
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
            todo_dispatch_ack_deferred_remote_command,
            todo_dispatch_dispatcher_heartbeat,
            todo_dispatch_dispatcher_ready,
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
            agent_account_push_to_device,
            agent_accounts_remove,
            agent_accounts_pane_profiles,
            ssh_profiles_list,
            ssh_profile_save,
            ssh_profile_delete,
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
            swarm_get_state,
            swarm_configure,
            swarm_member_restart,
            swarm_activate,
            swarm_submit_task,
            swarm_cancel_run,
            swarm_run_events,
            swarm_dispose,
            workspace_git_pull_candidates,
            workspace_git_pull_repositories,
            workspace_git_snapshot,
            workspace_git_file_diff,
            workspace_git_generate_commit_message,
            workspace_git_commit_and_push,
            workspace_initialize_git,
            terminal_provider_session_exists,
            terminal_open,
            terminal_record_provider_session,
            terminal_start_agent,
            terminal_start_agent_many,
            set_terminal_audio_input_target,
            set_terminal_audio_route_gate,
            terminal_write_to_audio_input_target,
            terminal_write,
            terminal_control_automation_begin,
            terminal_control_automation_end,
            terminal_answer_agent_prompt_remote_command,
            terminal_ssh_connect,
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
            workspace_activation_diagnostic_logging_status,
            attention_state_update,
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
            terminal_restart_if_idle,
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
            coordination::tauri_commands::coordination_reveal_workspace_mcp_secret,
            coordination::tauri_commands::coordination_upsert_workspace_mcp_ssh_target,
            coordination::tauri_commands::coordination_delete_workspace_mcp_ssh_target,
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
            workspace_activate_runtime,
            deactivate_workspace_runtime,
            close_app_after_terminal_shutdown,
            app_force_exit_now
        ])
        .build(context)
        .expect("error while building Diff Forge AI desktop");

    app.run(move |app, event| {
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

        if daemon {
            if let tauri::RunEvent::Exit = event {
                if let Some(path) = daemon_lock_path_for_run.as_ref() {
                    let _ = fs::remove_file(path);
                }
            }
        }

        #[cfg(not(target_os = "macos"))]
        let _ = app;

        #[cfg(target_os = "macos")]
        {
            if !daemon {
                if let tauri::RunEvent::Reopen {
                    has_visible_windows: _,
                    ..
                } = event
                {
                    present_main_window(app);
                }
            }
        }
    });
}

#![recursion_limit = "512"]

use std::{
    collections::{HashMap, HashSet, VecDeque},
    env, fs,
    io::{BufRead, Read, Seek, SeekFrom, Write},
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
    io::{AsyncReadExt, AsyncSeekExt},
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
pub mod email;
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
const TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE: &str = "\r";
const TERMINAL_ACTIVITY_HOOK_POLL_MS: u64 = 50;
const TERMINAL_ACTIVITY_HOOK_BACKOFF_POLL_MS: u64 = 250;
const TERMINAL_ACTIVITY_HOOK_IDLE_POLL_MS: u64 = 1_000;
const TERMINAL_ACTIVITY_HOOK_FALLBACK_POLL_MS: u64 = 2_000;
const TERMINAL_ACTIVITY_HOOK_BACKOFF_UNCHANGED_POLLS: u32 = 4;
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
// The scanner must visit two container layers to discover project markers at
// paths such as portfolio/product-a/frontend. Fanout and total-directory caps
// still bound the work independently of this depth.
const WORKSPACE_PROJECT_MOUNT_SCAN_MAX_DEPTH: usize = 3;
const WORKSPACE_PROJECT_MOUNT_SCAN_ROOT_FANOUT: usize = 100;
const WORKSPACE_PROJECT_MOUNT_SCAN_CHILD_FANOUT: usize = 20;
const WORKSPACE_PROJECT_MOUNT_SCAN_MAX_DIRECTORIES: usize = 500;
const PROD_BUNDLE_IDENTIFIER: &str = "ai.diffforge.desktop";
const DEV_BUNDLE_IDENTIFIER: &str = "ai.diffforge.desktop.dev";
const DEVICE_APP_STATE_DIR: &str = "app-state";
const TERMINAL_PROCESS_EPOCH_COUNTER_FILE: &str = "terminal-process-epoch-counter.log";
// Keep the leading order token above every plausible legacy millisecond
// epoch while remaining exactly representable by JavaScript Number.
const TERMINAL_PROCESS_EPOCH_SEQUENCE_BASE: u64 = 4_000_000_000_000_000;
const TERMINAL_PROCESS_EPOCH_MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;
const DEVICE_DATA_MIGRATION_LOCK_STALE_SECS: u64 = 30 * 60;
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
const TERMINAL_ACTIVITY_HOOK_EVENT: &str = "forge-terminal-activity-hook";
const AGENT_CHAT_SESSION_SYNC_STATUS_CHANGED_EVENT: &str = "agent-chat-session-sync-status-changed";
const TERMINAL_ARCHITECTURE_ACTIVITY_EVENT: &str = "diffforge:terminal-architecture-activity";
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
/// Close-confirm contract: a native exit request (Cmd-Q) with running or
/// waiting sessions first raises the frontend modal; the modal's Close sets
/// this flag so the SAME request path proceeds on the second pass.
static APP_CLOSE_CONFIRMED: AtomicBool = AtomicBool::new(false);
static APP_CLOSE_LISTENER_READY: AtomicBool = AtomicBool::new(false);
static APP_CLOSE_FORCE_EXIT_SCHEDULED: AtomicBool = AtomicBool::new(false);
static APP_CLOSE_FORCE_EXIT_STARTED: AtomicBool = AtomicBool::new(false);
static APP_SHUTDOWN_PHASE: AtomicU8 = AtomicU8::new(APP_SHUTDOWN_PHASE_RUNNING);
#[derive(Clone)]
struct ApplicationExitAuthority {
    committed: Arc<AtomicBool>,
    mutation_gate: Arc<StdMutex<()>>,
}

impl ApplicationExitAuthority {
    fn new() -> Self {
        Self {
            committed: Arc::new(AtomicBool::new(false)),
            mutation_gate: Arc::new(StdMutex::new(())),
        }
    }

    fn from_app(app: &AppHandle) -> Self {
        Self {
            committed: Arc::clone(app.state::<Arc<AtomicBool>>().inner()),
            mutation_gate: Arc::clone(app.state::<Arc<StdMutex<()>>>().inner()),
        }
    }

    fn is_committed(&self) -> bool {
        self.committed.load(Ordering::Acquire)
    }

    fn commit(&self) -> bool {
        // Exit commitment is one-way. Recover a poisoned gate only to force
        // the safe state (retain durable intent); mutations fail closed.
        let _guard = self
            .mutation_gate
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        !self.committed.swap(true, Ordering::AcqRel)
    }

    fn with_gate<T>(&self, operation: impl FnOnce(bool) -> Result<T, String>) -> Result<T, String> {
        let _guard = self
            .mutation_gate
            .lock()
            .map_err(|_| "Application exit mutation gate is unavailable.".to_string())?;
        operation(self.is_committed())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct BreakoutWindowRegistration {
    profile_id: String,
    id: String,
}

#[derive(Default)]
struct BreakoutWindowRegistry {
    registrations: HashMap<String, BreakoutWindowRegistration>,
    /// A child can receive CloseRequested in the narrow native-open → IPC
    /// registration gap. Remember that pre-commit user intent so registration
    /// can consume it instead of leaving a durable orphan.
    pending_explicit_closes: HashSet<String>,
}

static BREAKOUT_WINDOW_REGISTRY: OnceLock<StdMutex<BreakoutWindowRegistry>> = OnceLock::new();
static TERMINAL_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static THREAD_BRIDGE_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static BIGVIEW_SYNC_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static VOICE_ORCHESTRATOR_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static TERMINAL_STATUS_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static CLOUD_SYNC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static TERMINAL_STATUS_LOGGING_RESOLVED: OnceLock<bool> = OnceLock::new();
static CLOUD_SYNC_LOGGING_RESOLVED: OnceLock<bool> = OnceLock::new();
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

fn commit_application_exit(app: &AppHandle) -> bool {
    ApplicationExitAuthority::from_app(app).commit()
}

fn breakout_window_registry() -> &'static StdMutex<BreakoutWindowRegistry> {
    BREAKOUT_WINDOW_REGISTRY.get_or_init(|| StdMutex::new(BreakoutWindowRegistry::default()))
}

#[cfg(test)]
fn breakout_window_registration(
    registry: &StdMutex<BreakoutWindowRegistry>,
    window_id: &str,
) -> Result<Option<BreakoutWindowRegistration>, String> {
    registry
        .lock()
        .map_err(|_| "Breakout window registry is unavailable.".to_string())
        .map(|state| state.registrations.get(window_id).cloned())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BreakoutWindowRegisterOutcome {
    Registered,
    RemovedPendingClose,
    RetainedForExit,
}

fn breakout_window_register_with(
    registry: &StdMutex<BreakoutWindowRegistry>,
    exit_authority: &ApplicationExitAuthority,
    window_id: String,
    registration: BreakoutWindowRegistration,
    window_exists: bool,
    remove: impl FnOnce(&BreakoutWindowRegistration) -> Result<(), String>,
) -> Result<BreakoutWindowRegisterOutcome, String> {
    exit_authority.with_gate(|committed| {
        let pending_close = {
            let state = registry
                .lock()
                .map_err(|_| "Breakout window registry is unavailable.".to_string())?;
            state.pending_explicit_closes.contains(&window_id)
        };
        if pending_close {
            // The user close linearized before exit commit. Its identity only
            // became available now, so complete that already-authorized delete
            // even if commitment happened between close and registration.
            // Production prevents this unregistered close until this branch
            // consumes it, so a still-managed window is the closing original,
            // never a same-label fresh incarnation.
            remove(&registration)?;
            registry
                .lock()
                .map_err(|_| "Breakout window registry is unavailable.".to_string())?
                .pending_explicit_closes
                .remove(&window_id);
            return Ok(BreakoutWindowRegisterOutcome::RemovedPendingClose);
        }
        if committed {
            return Ok(BreakoutWindowRegisterOutcome::RetainedForExit);
        }
        if !window_exists {
            return Err("Cannot register a breakout for a missing session window.".to_string());
        }
        registry
            .lock()
            .map_err(|_| "Breakout window registry is unavailable.".to_string())?
            .registrations
            .insert(window_id, registration);
        Ok(BreakoutWindowRegisterOutcome::Registered)
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BreakoutWindowCloseOutcome {
    Unregistered,
    PendingRegistration,
    Removed,
    RetainedForExit,
}

fn handle_breakout_window_close_with(
    registry: &StdMutex<BreakoutWindowRegistry>,
    exit_authority: &ApplicationExitAuthority,
    window_id: &str,
    remember_unregistered_close: bool,
    remove: impl FnOnce(&BreakoutWindowRegistration) -> Result<(), String>,
) -> Result<BreakoutWindowCloseOutcome, String> {
    exit_authority.with_gate(|committed| {
        if committed {
            return Ok(BreakoutWindowCloseOutcome::RetainedForExit);
        }
        let registration = {
            let mut state = registry
                .lock()
                .map_err(|_| "Breakout window registry is unavailable.".to_string())?;
            match state.registrations.get(window_id).cloned() {
                Some(registration) => registration,
                None if !remember_unregistered_close => {
                    return Ok(BreakoutWindowCloseOutcome::Unregistered);
                }
                None => {
                    state.pending_explicit_closes.insert(window_id.to_string());
                    return Ok(BreakoutWindowCloseOutcome::PendingRegistration);
                }
            }
        };
        remove(&registration)?;
        let mut state = registry
            .lock()
            .map_err(|_| "Breakout window registry is unavailable.".to_string())?;
        if state.registrations.get(window_id) == Some(&registration) {
            state.registrations.remove(window_id);
        }
        Ok(BreakoutWindowCloseOutcome::Removed)
    })
}

/// The close-confirm modal's Close: let the next exit request through the
/// ExitRequested gate instead of re-raising the modal. Consumed per attempt.
#[tauri::command]
fn app_confirm_close() {
    APP_CLOSE_CONFIRMED.store(true, Ordering::Release);
}

/// The frontend's close-request listener announces itself: until this flag
/// is set, an exit request must NOT be parked on a modal nobody can show.
#[tauri::command]
fn app_close_listener_ready() {
    APP_CLOSE_LISTENER_READY.store(true, Ordering::Release);
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
        let now = cloud_mcp_rfc3339_now();
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
    adopt_tolerant: bool,
    adoptable_output: Option<Arc<StdMutex<TerminalAdoptableOutputSlot>>>,
    working_directory: Arc<PathBuf>,
    agent_started: Arc<Mutex<bool>>,
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
}

#[derive(Default)]
struct TerminalOperationAdmissionState {
    active: usize,
    closing: bool,
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

/// Daemon-only diagnostic tap wrapped around an agent pane's PTY writer:
/// hex-dumps every byte that enters the agent's stdin into journald. Added
/// for the BYOC claude exit-1 investigation — the launch envelope was fully
/// exonerated by faithful reproduction, leaving the live input path as the
/// only unobserved surface; this names any killer byte sequence on the next
/// reproduction. Low volume by construction (daemon agent panes only see
/// viewer keystrokes and daemon-injected control writes).
struct DaemonPtyWriteTap {
    inner: Box<dyn Write + Send>,
    pane_id: String,
    enabled: bool,
}

/// Hard budget for tap output per daemon process (~100MB) so the diagnostic
/// can never grow journald without bound; one final line marks exhaustion.
static DAEMON_PTY_WRITE_TAP_BUDGET: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(100 * 1024 * 1024);

impl Write for DaemonPtyWriteTap {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self.enabled && !buf.is_empty() {
            let head: String = buf
                .iter()
                .take(96)
                .map(|byte| format!("{byte:02x}"))
                .collect();
            let line = format!(
                "diffforge daemon: terminal.pty_write {{\"pane_id\":\"{}\",\"len\":{},\"hex\":\"{}\"}}",
                self.pane_id,
                buf.len(),
                head
            );
            let cost = line.len() as u64 + 1;
            let remaining =
                DAEMON_PTY_WRITE_TAP_BUDGET.fetch_sub(cost, std::sync::atomic::Ordering::Relaxed);
            if remaining >= cost {
                println!("{line}");
            } else if remaining > 0 {
                println!("diffforge daemon: terminal.pty_write tap budget exhausted; suppressing further dumps");
            }
        }
        self.inner.write(buf)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
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
        _app_control_mcp_requested: bool,
    ) -> (Self, Box<dyn Read + Send>) {
        let WarmPty {
            child,
            master,
            writer,
            reader,
            size,
        } = warm_pty;
        let writer: Box<dyn Write + Send> = {
            let agent_pane = cloud_mcp_agent_uses_activity_hooks(&metadata.agent_id)
                || cloud_mcp_agent_uses_activity_hooks(&metadata.agent_kind);
            Box::new(DaemonPtyWriteTap {
                inner: writer,
                pane_id: metadata.pane_id.clone(),
                enabled: daemon_mode_active() && agent_pane,
            })
        };

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
                adopt_tolerant: false,
                adoptable_output: None,
                working_directory: Arc::new(working_directory),
                agent_started: Arc::new(Mutex::new(agent_started)),
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

#[derive(Clone, Copy, PartialEq, Eq)]
enum AgentProvider {
    Codex,
    Claude,
    OpenCode,
    Haider,
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
    #[serde(default)]
    adopt_existing: Option<bool>,
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
    prompt_event_id: Option<String>,
    prompt_event_revision: Option<u64>,
    prompt_event_source: Option<String>,
    prompt_event_submitted_at: Option<String>,
    prompt_event_text: Option<String>,
    todo_action: Option<String>,
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
#[cfg(test)]
include!("test_env_lock.rs");
include!("platform.rs");
include!("process.rs");
include!("backend_cpu.rs");
include!("workspace_files.rs");
include!("sessions.rs");
// Spaces persist next to sessions in sessions.sqlite; the include boundary is
// pinned by tests/spaces.rs, which compiles the same file around a stub path.
include!("spaces.rs");
// ADE presentation intent shares sessions.sqlite without crossing the crate-root
// sessions_database_path boundary; tests/workspace_view.rs pins this include shape.
include!("workspace_view.rs");
include!("haider_bridge.rs");
include!("haider_projection.rs");
mod haider_rpc_ade;
include!("haider_run.rs");
include!("architectures.rs");
include!("pcb.rs");
include!("video_editor.rs");
include!("video_tier1.rs");
include!("video_code.rs");
include!("video_polish.rs");
include!("video_annotate.rs");
include!("developer_processes.rs");
include!("app_control_mcp.rs");
include!("terminal_cli.rs");
include!("tokenomics.rs");
include!("native_notifications.rs");
include!("cloud_mcp.rs");
include!("local_scripts.rs");
include!("assets.rs");
include!("removed_session_compat.rs");
include!("terminals.rs");
include!("swarm_runtime.rs");
include!("orchestrator_pool.rs");
include!("tools_window.rs");
include!("session_window.rs");
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

/// Terminal lifecycle breadcrumbs for daemon (headless) devices, printed to
/// stdout so they land in journald. The crash-forensics file logger is
/// compiled out of production builds and a BYOC box has no webview console,
/// so without these a daemon terminal can be closed with zero on-box trace
/// of who initiated it or why (exactly what made the 2026-07 BYOC claude
/// close undiagnosable from the droplet).
pub(crate) fn daemon_terminal_lifecycle_println(phase: &str, detail: &Value) {
    if !daemon_mode_active() {
        return;
    }
    println!("diffforge daemon: terminal.{phase} {detail}");
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
    // This is the immediate/watchdog exit's commit point. It precedes every
    // AppHandle::exit or fallback window destruction below.
    let _ = commit_application_exit(&app_for_exit);

    log_terminal_crash_forensics_event(
        "backend.app_force_exit.start",
        json!({
            "reason": reason,
            "window_label": window_label.as_deref().unwrap_or(""),
        }),
    );
    cloud_mcp_send_shutdown_goodbye_blocking();
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

    fn breakout_test_connection() -> rusqlite::Connection {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        workspace_view_initialize_database(&mut connection).unwrap();
        connection
    }

    fn insert_test_breakout(connection: &mut rusqlite::Connection, id: &str) {
        breakout_upsert_in_connection(
            connection,
            "profile-exit-test",
            id,
            BreakoutKind::Session,
            Some(format!("session-{id}")),
            None,
            None,
            None,
            None,
            10,
        )
        .unwrap();
    }

    fn test_breakout_exists(connection: &rusqlite::Connection, id: &str) -> bool {
        breakout_get_from_connection(connection, "profile-exit-test", id)
            .unwrap()
            .is_some()
    }

    fn register_test_breakout(
        registry: &StdMutex<BreakoutWindowRegistry>,
        window_id: &str,
        id: &str,
    ) {
        registry.lock().unwrap().registrations.insert(
            window_id.to_string(),
            BreakoutWindowRegistration {
                profile_id: "profile-exit-test".to_string(),
                id: id.to_string(),
            },
        );
    }

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

    #[test]
    fn registered_child_close_removes_before_commit_and_retains_after_commit() {
        let mut connection = breakout_test_connection();
        insert_test_breakout(&mut connection, "breakout-running");
        insert_test_breakout(&mut connection, "breakout-exiting");

        let running_registry = StdMutex::new(BreakoutWindowRegistry::default());
        register_test_breakout(
            &running_registry,
            "session-window-running",
            "breakout-running",
        );
        let running = ApplicationExitAuthority::new();
        assert_eq!(
            handle_breakout_window_close_with(
                &running_registry,
                &running,
                "session-window-running",
                false,
                |registration| {
                    breakout_remove_in_connection(
                        &mut connection,
                        &registration.profile_id,
                        &registration.id,
                    )
                },
            )
            .unwrap(),
            BreakoutWindowCloseOutcome::Removed
        );
        assert!(!test_breakout_exists(&connection, "breakout-running"));
        assert!(
            breakout_window_registration(&running_registry, "session-window-running")
                .unwrap()
                .is_none()
        );

        let exiting_registry = StdMutex::new(BreakoutWindowRegistry::default());
        register_test_breakout(
            &exiting_registry,
            "session-window-exiting",
            "breakout-exiting",
        );
        let exiting = ApplicationExitAuthority::new();
        assert!(exiting.commit());
        assert_eq!(
            handle_breakout_window_close_with(
                &exiting_registry,
                &exiting,
                "session-window-exiting",
                false,
                |registration| {
                    breakout_remove_in_connection(
                        &mut connection,
                        &registration.profile_id,
                        &registration.id,
                    )
                },
            )
            .unwrap(),
            BreakoutWindowCloseOutcome::RetainedForExit
        );
        assert!(test_breakout_exists(&connection, "breakout-exiting"));
    }

    #[test]
    fn live_main_close_before_registration_is_consumed_if_exit_commits_next() {
        let mut connection = breakout_test_connection();
        insert_test_breakout(&mut connection, "breakout-register-gap");
        let registry = StdMutex::new(BreakoutWindowRegistry::default());
        let authority = ApplicationExitAuthority::new();

        assert_eq!(
            handle_breakout_window_close_with(
                &registry,
                &authority,
                "session-window-register-gap",
                true,
                |_| panic!("an unregistered close has no durable identity yet"),
            )
            .unwrap(),
            BreakoutWindowCloseOutcome::PendingRegistration
        );
        assert!(authority.commit());
        assert_eq!(
            breakout_window_register_with(
                &registry,
                &authority,
                "session-window-register-gap".to_string(),
                BreakoutWindowRegistration {
                    profile_id: "profile-exit-test".to_string(),
                    id: "breakout-register-gap".to_string(),
                },
                true,
                |registration| {
                    breakout_remove_in_connection(
                        &mut connection,
                        &registration.profile_id,
                        &registration.id,
                    )
                },
            )
            .unwrap(),
            BreakoutWindowRegisterOutcome::RemovedPendingClose
        );
        assert!(!test_breakout_exists(&connection, "breakout-register-gap"));
    }

    #[test]
    fn pending_close_is_consumed_while_child_is_still_managed() {
        let mut connection = breakout_test_connection();
        insert_test_breakout(&mut connection, "breakout-register-before-commit");
        let registry = StdMutex::new(BreakoutWindowRegistry::default());
        let authority = ApplicationExitAuthority::new();

        assert_eq!(
            handle_breakout_window_close_with(
                &registry,
                &authority,
                "session-window-register-before-commit",
                true,
                |_| panic!("an unregistered close has no durable identity yet"),
            )
            .unwrap(),
            BreakoutWindowCloseOutcome::PendingRegistration
        );
        assert_eq!(
            breakout_window_register_with(
                &registry,
                &authority,
                "session-window-register-before-commit".to_string(),
                BreakoutWindowRegistration {
                    profile_id: "profile-exit-test".to_string(),
                    id: "breakout-register-before-commit".to_string(),
                },
                true,
                |registration| {
                    breakout_remove_in_connection(
                        &mut connection,
                        &registration.profile_id,
                        &registration.id,
                    )
                },
            )
            .unwrap(),
            BreakoutWindowRegisterOutcome::RemovedPendingClose
        );
        assert!(!test_breakout_exists(
            &connection,
            "breakout-register-before-commit"
        ));
        assert!(authority.commit());
    }

    #[test]
    fn explicit_child_close_already_inside_gate_wins_before_exit_commit() {
        use std::sync::mpsc;

        let authority = Arc::new(ApplicationExitAuthority::new());
        let (mutation_entered_tx, mutation_entered_rx) = mpsc::channel();
        let (release_mutation_tx, release_mutation_rx) = mpsc::channel();
        let mutation_authority = Arc::clone(&authority);
        let mutation = thread::spawn(move || {
            mutation_authority.with_gate(|committed| {
                assert!(!committed);
                mutation_entered_tx.send(()).unwrap();
                release_mutation_rx.recv().unwrap();
                Ok(())
            })
        });
        mutation_entered_rx.recv().unwrap();

        let (commit_started_tx, commit_started_rx) = mpsc::channel();
        let (commit_done_tx, commit_done_rx) = mpsc::channel();
        let commit_authority = Arc::clone(&authority);
        let commit = thread::spawn(move || {
            commit_started_tx.send(()).unwrap();
            let changed = commit_authority.commit();
            commit_done_tx.send(changed).unwrap();
        });
        commit_started_rx.recv().unwrap();
        assert_eq!(
            commit_done_rx.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        );

        release_mutation_tx.send(()).unwrap();
        mutation.join().unwrap().unwrap();
        assert!(commit_done_rx.recv().unwrap());
        commit.join().unwrap();
        assert!(authority.is_committed());
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

enum DeviceDataMigrationStrategy {
    PreferNewest,
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

    let _ = strategy;
    let candidates = device_data_legacy_candidates(legacy_roots, rel_path);
    device_data_migrate_prefer_newest(&target, &candidates)
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
    let path = device_data_path(app, &rel_path, DeviceDataMigrationStrategy::PreferNewest)?;
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

/// Binds a native session-window label to durable breakout identity for the
/// lifetime of this process only. The label is never written to the durable
/// workspace-view store.
#[tauri::command(rename_all = "snake_case")]
fn breakout_window_register(
    app: AppHandle,
    window_id: String,
    profile_id: String,
    id: String,
) -> Result<(), String> {
    let window_id = window_id.trim().to_string();
    let profile_id = profile_id.trim().to_string();
    let id = id.trim().to_string();
    validate_session_window_label(&window_id)?;
    workspace_view_validate_profile_id(&profile_id)?;
    workspace_view_validate_reference(&id, "Breakout id")?;
    let window_exists = app.get_webview_window(&window_id).is_some();
    let exit_authority = ApplicationExitAuthority::from_app(&app);
    let destroy_label = window_id.clone();
    let outcome = breakout_window_register_with(
        breakout_window_registry(),
        &exit_authority,
        window_id,
        BreakoutWindowRegistration { profile_id, id },
        window_exists,
        |registration| {
            breakout_remove_blocking_unchecked(
                registration.profile_id.clone(),
                registration.id.clone(),
            )
        },
    )?;
    if outcome == BreakoutWindowRegisterOutcome::RemovedPendingClose {
        if let Some(window) = app.get_webview_window(&destroy_label) {
            window.destroy().map_err(|error| {
                format!("Unable to finish explicit close for {destroy_label}: {error}")
            })?;
        }
    }
    Ok(())
}

fn handle_registered_breakout_window_close(
    app: &AppHandle,
    window_id: &str,
) -> Result<BreakoutWindowCloseOutcome, String> {
    let exit_authority = ApplicationExitAuthority::from_app(app);
    handle_breakout_window_close_with(
        breakout_window_registry(),
        &exit_authority,
        window_id,
        true,
        |registration| {
            breakout_remove_blocking_unchecked(
                registration.profile_id.clone(),
                registration.id.clone(),
            )
        },
    )
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

fn request_backend_app_shutdown_from_native_close(
    app: &AppHandle,
    daemon: bool,
    source: &str,
) -> Result<bool, String> {
    let phase = APP_SHUTDOWN_PHASE.load(Ordering::Acquire);
    if phase == APP_SHUTDOWN_PHASE_RUNNING {
        // Confirmation is consumed per attempt. Merely asking for or showing
        // the modal is not an exit commit, so explicit child closes remain
        // ordinary durable deletes until the confirmed request returns here.
        let confirmed = APP_CLOSE_CONFIRMED.swap(false, Ordering::AcqRel);
        if !daemon
            && !confirmed
            && !app_is_in_background_mode()
            && APP_CLOSE_LISTENER_READY.load(Ordering::Acquire)
            && !app.webview_windows().is_empty()
            && app
                .emit(
                    "forge-app-close-requested",
                    serde_json::json!({ "source": source }),
                )
                .is_ok()
        {
            return Ok(false);
        }
    }

    if phase < APP_SHUTDOWN_PHASE_EXITING {
        start_backend_app_shutdown(app.clone(), "main".to_string())?;
    }
    Ok(true)
}

fn start_backend_app_shutdown_with_watchdog(
    app: AppHandle,
    window_label: String,
    force_exit_result: Result<(), String>,
) -> Result<(), String> {
    // This is the graceful exit commit point. It is deliberately after the
    // close-confirm gate, but before teardown can destroy any child window.
    let _ = commit_application_exit(&app);
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

/// Keeps the system titlebar out of macOS native fullscreen. The main window
/// is borderless, but tao adds the Titled style mask while a window is in
/// native fullscreen, which resurrects the system titlebar + traffic lights
/// over our custom bar. Making the titlebar transparent/hidden with a
/// full-size content view (and hiding the standard buttons) is idempotent
/// and survives the transition; re-applied on every resize event because the
/// fullscreen transition rebuilds the style mask.
#[cfg(target_os = "macos")]
fn main_window_apply_macos_frameless_titlebar(window: &tauri::Window) {
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("main_window_apply_frameless_titlebar", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &objc2_app_kit::NSWindow =
                unsafe { &*ns_window.cast::<objc2_app_kit::NSWindow>() };
            ns_window.setTitlebarAppearsTransparent(true);
            ns_window.setTitleVisibility(objc2_app_kit::NSWindowTitleVisibility::Hidden);
            ns_window.setStyleMask(
                ns_window.styleMask() | objc2_app_kit::NSWindowStyleMask::FullSizeContentView,
            );
            for button_kind in [
                objc2_app_kit::NSWindowButton::CloseButton,
                objc2_app_kit::NSWindowButton::MiniaturizeButton,
                objc2_app_kit::NSWindowButton::ZoomButton,
            ] {
                if let Some(button) = ns_window.standardWindowButton(button_kind) {
                    button.setHidden(true);
                }
            }
        });
    });
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
    let application_exit_authority = ApplicationExitAuthority::new();
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
        .manage(Arc::clone(&application_exit_authority.committed))
        .manage(Arc::clone(&application_exit_authority.mutation_gate))
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
            // email-v1 (plan §4.3 / review #1): journal recovery runs
            // SYNCHRONOUSLY here, strictly before the remote-command
            // listener and before any task can open the cloud connection.
            // A crashed `data_started` generation is terminalized
            // (delivery_unknown / submitted-if-persisted) before any wake
            // command can possibly re-offer it — the DATA boundary is
            // crossed at most once per generation.
            email::remote::email_startup_journal_recovery();
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
            energy_impact::energy_impact_start();
            video_cloud_generation_events_start(
                app.handle().clone(),
                app.state::<CloudMcpState>().inner().clone(),
            );
            cloud_mcp_start_account_documents_watcher(app.handle().clone());
            // Background dispatcher: dormant while the webview heartbeats;
            // takes over queued-todo submission when the window goes away.
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
            // Startup todo recovery is bounded, not destructive: queued work
            // survives app startup, while ambiguous in-flight rows wait for
            // Rust terminal/workspace evidence or a 45s timeout before being
            // reclassified.
            register_terminal_input_event_listener(app);

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
                        main_window_apply_macos_frameless_titlebar(&window);
                        let titlebar_window = window.clone();
                        window.on_window_event(move |event| {
                            if matches!(event, tauri::WindowEvent::Resized(_)) {
                                main_window_apply_macos_frameless_titlebar(&titlebar_window);
                            }
                        });
                    }
                }
            }
            if !daemon {
                haider_bridge_start(app.handle().clone());
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
            sessions_list,
            session_create,
            session_update,
            session_rename,
            session_set_pinned,
            session_delete,
            sessions_home_dir,
            spaces_list,
            space_create,
            space_rename,
            space_delete,
            space_save_layout,
            space_get,
            workspace_view_get,
            workspace_view_save,
            breakout_list,
            breakout_upsert,
            breakout_remove,
            breakout_window_register,
            breakout_clear_missing,
            session_projection_window,
            session_projection_trajectory,
            session_projection_ensure,
            session_projection_attach,
            session_projection_detach,
            session_start_with_prompt,
            session_submit_prompt,
            session_mark_seen,
            haider_library_snapshot,
            session_config_get,
            session_item_get,
            stage_pasted_image,
            discard_staged_attachment,
            app_confirm_close,
            app_close_listener_ready,
            session_config_set,
            haider_rpc_ade::rpc_features,
            haider_rpc_ade::loom_list,
            haider_rpc_ade::loom_register_agent_type,
            haider_rpc_ade::loom_install_status,
            haider_rpc_ade::loom_install_retry,
            haider_rpc_ade::loom_install_watch,
            haider_rpc_ade::session_select_agent_type,
            haider_rpc_ade::queue_list,
            haider_rpc_ade::queue_remove,
            haider_rpc_ade::queue_promote_steer,
            haider_rpc_ade::command_list,
            haider_rpc_ade::command_invoke,
            haider_rpc_ade::resident_session_binding_snapshot,
            haider_rpc_ade::surface_attach,
            haider_rpc_ade::surface_detach,
            haider_rpc_ade::surface_publish_input,
            haider_rpc_ade::session_answer_menu,
            haider_rpc_ade::session_cancel_turn,
            haider_rpc_ade::computer_permission_open_settings,
            haider_rpc_ade::account_list,
            haider_rpc_ade::account_list_watch,
            haider_rpc_ade::account_add_api_key,
            haider_rpc_ade::account_oauth_start,
            haider_rpc_ade::account_oauth_status,
            haider_rpc_ade::account_oauth_cancel,
            haider_rpc_ade::account_oauth_add,
            haider_rpc_ade::haider_account_oauth_import_sources,
            haider_rpc_ade::haider_account_oauth_import,
            haider_rpc_ade::account_set_active,
            haider_rpc_ade::account_set_label,
            haider_rpc_ade::account_remove,
            haider_rpc_ade::account_set_default_model,
            haider_usage_snapshot,
            open_html_document_in_browser,
            app_local_state_load,
            app_local_state_store,
            app_local_state_merge_command,
            app_startup_settings_state,
            app_startup_settings_update,
            tray_click_settings_state,
            tray_click_settings_update,
            tools_agent_statuses,
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
            cloud_mcp_get_billing_status,
            cloud_mcp_refresh_billing_status,
            cloud_mcp_sync_agent_installations,
            cloud_mcp_delete_agent_chat_session,
            cloud_mcp_sync_tokenomics_state,
            cloud_mcp_schedule_tokenomics_sync,
            cloud_mcp_reset_device_tokenomics,
            cloud_mcp_tokenomics_republish_cloud_history,
            tokenomics_get_summary,
            tokenomics_get_live_limits,
            tokenomics_get_sync_payload,
            tokenomics_get_sync_delta,
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
            agent_account_push_availability,
            agent_account_push_to_device,
            ssh_profiles_list,
            ssh_profile_save,
            ssh_profile_delete,
            email::ui::email_delivery_profiles_list,
            email::ui::email_delivery_profile_save,
            email::ui::email_delivery_profile_delete,
            email::ui::email_delivery_profile_probe,
            email::ui::email_delivery_capability_snapshot,
            email::ui::email_delivery_preflight_local,
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
            cloud_mcp_get_activity,
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
            set_terminal_audio_input_target,
            set_terminal_audio_route_gate,
            terminal_write_to_audio_input_target,
            terminal_write,
            terminal_ssh_connect,
            terminal_input_transport_endpoint,
            terminal_output_transport_endpoint,
            app_control_mcp_reply,
            terminal_capture_direct_prompt_todo,
            terminal_write_realtime,
            terminal_windows_pty_info,
            terminal_set_diagnostic_logging,
            terminal_diagnostic_log,
            thread_bridge_diagnostic_log,
            bigview_sync_diagnostic_log,
            attention_state_update,
            terminal_status_log,
            windows_terminal_set_diagnostic_logging,
            windows_terminal_diagnostic_log,
            terminal_provider_turn_completed,
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
            session_window_open,
            session_window_close,
            session_window_focus,
            web_panel_open,
            web_panel_close,
            web_panel_focus,
            terminal_pane_runtime_info,
            terminal_live_sessions,
            close_app_after_terminal_shutdown,
            app_force_exit_now
        ])
        .build(context)
        .expect("error while building Diff Forge AI desktop");

    app.run(move |app, event| {
        if !daemon && matches!(&event, tauri::RunEvent::Exit) {
            haider_bridge_stop();
            haider_projection_stop();
            haider_run_stop();
        }
        if let tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } = &event
        {
            if label == "main" {
                // Closing the main window is an application-close request even
                // while independent breakout windows keep Tauri's registry
                // nonempty. Prevent this one window from disappearing and run
                // the same confirm/commit gate used by ExitRequested.
                api.prevent_close();
                if let Err(error) =
                    request_backend_app_shutdown_from_native_close(app, daemon, "main-window")
                {
                    eprintln!("Failed to start backend shutdown from main window close: {error}");
                }
                return;
            }

            if validate_session_window_label(label).is_ok() {
                // CloseRequested is the authoritative user-close source. It
                // runs synchronously so the durable delete wins if it entered
                // the commit gate first; an already-committed exit retains.
                match handle_registered_breakout_window_close(app, label) {
                    Ok(BreakoutWindowCloseOutcome::PendingRegistration) => {
                        // The durable identity is still behind the ordered
                        // upsert. Keep this exact incarnation alive until
                        // registration consumes the recorded close and
                        // destroys it, eliminating CloseRequested→Destroyed
                        // registry timing as an authority input.
                        api.prevent_close();
                    }
                    Ok(_) => {}
                    Err(error) => {
                        api.prevent_close();
                        eprintln!(
                            "Unable to remove durable breakout for closing window {label}: {error}"
                        );
                    }
                }
            }
        }
        if let tauri::RunEvent::ExitRequested { ref api, .. } = event {
            let phase = APP_SHUTDOWN_PHASE.load(Ordering::Acquire);

            if phase < APP_SHUTDOWN_PHASE_EXITING {
                api.prevent_exit();
                if let Err(error) =
                    request_backend_app_shutdown_from_native_close(app, daemon, "exit-request")
                {
                    eprintln!("Failed to start backend shutdown from exit request: {error}");
                }
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

use std::{
    collections::{HashMap, HashSet, VecDeque},
    env, fs,
    io::{Read, Write},
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
use futures_util::{
    future::{BoxFuture, FutureExt, Shared},
    SinkExt, StreamExt,
};
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
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tokio::{
    sync::{mpsc, oneshot, Mutex, RwLock},
    time::{sleep, timeout},
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
};

pub mod coordination;

const API_BASE_URL: &str = "https://diffforge.ai/api";
const MIN_AUTH_VALUE_LENGTH: usize = 24;
const MAX_AUTH_VALUE_LENGTH: usize = 192;
const DEFAULT_API_TIMEOUT_SECS: u64 = 10;
const AUTH_EXCHANGE_TIMEOUT_SECS: u64 = 10;
const SESSION_VALIDATE_TIMEOUT_SECS: u64 = 5;
const LOGOUT_TIMEOUT_SECS: u64 = 5;
const DESKTOP_SIGNIN_DIAGNOSTICS_ENABLED: bool = false;
const DESKTOP_SIGNIN_DIAGNOSTIC_TIMEOUT_SECS: u64 = 3;
const DESKTOP_SIGNIN_DIAGNOSTIC_MAX_TEXT: usize = 600;
const AGENT_STATUS_TIMEOUT_SECS: u64 = 6;
const AGENT_UPDATE_CHECK_TIMEOUT_SECS: u64 = 3;
const AGENT_INSTALL_TIMEOUT_SECS: u64 = 240;
const AGENT_RUN_TIMEOUT_SECS: u64 = 120;
const AGENT_THREAD_TURN_TIMEOUT_SECS: u64 = 30 * 60;
const AGENT_LOGOUT_TIMEOUT_SECS: u64 = 30;
const MAX_FORGE_PROMPT_LENGTH: usize = 12_000;
const MAX_FORGE_MODEL_LENGTH: usize = 80;
const MAX_FORGE_IMAGES: usize = 4;
const MAX_FORGE_IMAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_FORGE_IMAGE_TOTAL_BYTES: usize = 8 * 1024 * 1024;
const MAX_TODO_TEXT_ATTACHMENT_BYTES: usize = 256 * 1024;
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
const TERMINAL_PARKED_RESUME_SUBMIT_DELAY_MS: u64 = 120;
const TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE: &str = "\r";
const TERMINAL_ENTER_SEQUENCE: &str = "\x1b[13u";
const TERMINAL_ENTER_SEQUENCE_MOD1: &str = "\x1b[13;1u";
const TERMINAL_SHIFT_ENTER_SEQUENCE: &str = "\x1b[13;2u";
const MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH: usize = 2048;
const MAX_FILE_EXPLORER_ENTRIES: usize = 600;
const MAX_WORKSPACE_FILE_READ_BYTES: u64 = 1024 * 1024;
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
const TERMINAL_STATUS_LOGGING_ENABLED: bool = false;
const TERMINAL_STATUS_LOG_FILE: &str = "terminal-statuses.jsonl";
const TERMINAL_CRASH_FORENSICS_LOGGING_ENABLED: bool = true;
const TERMINAL_CRASH_FORENSICS_LOG_FILE: &str = "terminal-crash-forensics.jsonl";
const TERMINAL_DIAGNOSTIC_LOG_MAX_TEXT: usize = 512;
const TERMINAL_DIAGNOSTIC_SLOW_MS: f64 = 8.0;
const WINDOWS_TERMINAL_DIAGNOSTIC_LOGGING_ENABLED: bool = false;
const WINDOWS_TERMINAL_DIAGNOSTIC_RUNTIME_ENABLE_ALLOWED: bool = false;
const WINDOWS_TERMINAL_DIAGNOSTIC_LOG_FILE: &str = "windows-terminal-diagnostics.jsonl";
const WHISPER_LOCAL_AUDIO_LOGGING_ENABLED: bool = false;
const WHISPER_LOCAL_AUDIO_LOG_FILE: &str = "whisper-local-audio.jsonl";
const WHISPER_LOCAL_AUDIO_LOG_MAX_TEXT: usize = 512;
const APP_SHUTDOWN_PROGRESS_EVENT: &str = "forge-app-shutdown-progress";
const APP_SHUTDOWN_TOTAL_STEPS: u8 = 6;
const TERMINAL_CLOSE_ALL_PROGRESS_EVENT: &str = "forge-terminal-close-all-progress";
const TERMINAL_AUDIO_INPUT_REFOCUS_EVENT: &str = "forge-terminal-audio-input-refocus";
const TERMINAL_INPUT_EVENT: &str = "forge-terminal-input";
const TERMINAL_INPUT_ERROR_EVENT: &str = "forge-terminal-input-error";
const TERMINAL_PROMPT_SUBMITTED_EVENT: &str = "forge-terminal-prompt-submitted";
const TERMINAL_PARKED_PROMPT_EVENT: &str = "forge-terminal-parked-prompt";
const WORKSPACE_NOTIFICATION_EVENT: &str = "diffforge:workspace-notification-event";
const AUDIO_WIDGET_WINDOW_LABEL: &str = "audio-widget";
const AUDIO_WIDGET_VISIBILITY_CHANGED_EVENT: &str = "forge-audio-widget-visibility-changed";
#[cfg(target_os = "macos")]
const MAIN_WINDOW_RESTORE_FOCUS_DELAY_MS: u64 = 260;
#[cfg(target_os = "macos")]
const MAIN_WINDOW_RESTORE_RETRY_DELAYS_MS: [u64; 2] = [160, 240];
#[cfg(target_os = "macos")]
const MAIN_WINDOW_RESTORE_COALESCE_RELEASE_MS: u64 = 120;
#[cfg(target_os = "macos")]
const MAIN_WINDOW_MINIMIZE_RESTORE_SUPPRESS_MS: u64 = 1_000;
const WHISPER_MODEL_ID: &str = "base.en";
const WHISPER_MODEL_NAME: &str = "Whisper base.en";
const WHISPER_MODEL_FILE: &str = "ggml-base.en.bin";
const WHISPER_MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const WHISPER_MODEL_SHA1: &str = "137c40403d78fd54d454da0f9bd998f78703390c";
static APP_PANIC_LOG_HOOK_INSTALLED: OnceLock<()> = OnceLock::new();
static APP_CLOSE_SHUTDOWN_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static APP_CLOSE_FORCE_EXIT_SCHEDULED: AtomicBool = AtomicBool::new(false);
static APP_SHUTDOWN_PHASE: AtomicU8 = AtomicU8::new(APP_SHUTDOWN_PHASE_RUNNING);
static TERMINAL_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static THREAD_BRIDGE_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static BIGVIEW_SYNC_DIAGNOSTIC_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static TERMINAL_STATUS_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
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
const WHISPER_MODEL_DISK_MB: u64 = 142;
const WHISPER_MODEL_MEMORY_MB: u64 = 500;
const WHISPER_DOWNLOAD_TIMEOUT_SECS: u64 = 900;
const WHISPER_MAX_AUDIO_BYTES: usize = 32 * 1024 * 1024;
const WHISPER_TRANSCRIBE_TIMEOUT_SECS: u64 = 180;
const DEEPGRAM_LISTEN_WS_URL: &str = "wss://api.deepgram.com/v1/listen";
const DEEPGRAM_MODEL: &str = "nova-3";
const DEEPGRAM_DEFAULT_LANGUAGE: &str = "en";
const DEEPGRAM_TRANSCRIBE_TIMEOUT_SECS: u64 = 90;
const DEEPGRAM_CONNECT_TIMEOUT_SECS: u64 = 10;
const DEEPGRAM_CLOSE_TIMEOUT_SECS: u64 = 8;
const CLOUD_VOICE_AGENT_RESULT_TIMEOUT_SECS: u64 = 55;
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
const AUDIO_STATS_INTERVAL_MS: u64 = 60;
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
#[cfg(target_os = "macos")]
static MAIN_WINDOW_RESTORE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static MAIN_WINDOW_MINIMIZE_REQUESTED_AT_MS: AtomicU64 = AtomicU64::new(0);

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

struct TerminalState {
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    parked_prompts: Arc<RwLock<HashMap<String, TerminalParkedPrompt>>>,
    active_audio_input_target: Arc<StdMutex<Option<TerminalAudioInputTarget>>>,
    lifecycle_lock: Arc<Mutex<()>>,
    pty_pool: Arc<PtyPool>,
    cleanup_tracker: Arc<TerminalCleanupTracker>,
    next_terminal_instance_id: AtomicU64,
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
    input_worker: NativeAudioWorker,
    realtime_stream_lock: Arc<Mutex<()>>,
    shortcut_manager: AudioShortcutManager,
    whisper_cancel_token: Arc<AtomicU64>,
    whisper_engine: WhisperCliWarmCache,
}

struct CloudVoiceAgentSession {
    control_tx: mpsc::UnboundedSender<CloudVoiceAgentControl>,
    finished_rx: oneshot::Receiver<Result<(), String>>,
}

enum CloudVoiceAgentControl {
    FinishInput,
    Stop,
}

struct DeepgramRealtimeSession {
    finished_rx: oneshot::Receiver<Result<WhisperTranscriptionResult, String>>,
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
    input_gate: Arc<Mutex<TerminalInputGate>>,
    input_queue: Arc<Mutex<()>>,
    active_task: Arc<Mutex<Option<TerminalActiveTask>>>,
    coordination: Option<TerminalCoordinationSession>,
    metadata: TerminalInstanceMetadata,
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
        }
    }
}

#[derive(Clone)]
struct TerminalCloudMcpCloseContext {
    working_directory: Arc<PathBuf>,
    active_task: Arc<Mutex<Option<TerminalActiveTask>>>,
    coordination: Option<TerminalCoordinationSession>,
}

impl TerminalCloudMcpCloseContext {
    fn from_instance(instance: &TerminalInstance) -> Self {
        Self {
            working_directory: Arc::clone(&instance.working_directory),
            active_task: Arc::clone(&instance.active_task),
            coordination: instance.coordination.clone(),
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

#[derive(Default)]
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
        metadata: TerminalInstanceMetadata,
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
                input_gate: Arc::new(Mutex::new(TerminalInputGate::default())),
                input_queue: Arc::new(Mutex::new(())),
                active_task: Arc::new(Mutex::new(None)),
                coordination,
                metadata,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSigninDiagnosticRequest<'a> {
    flow_id: Option<&'a str>,
    source: &'a str,
    step: &'a str,
    status: &'a str,
    message: Option<&'a str>,
    details: Value,
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
    provider_session_id: Option<String>,
    model: Option<String>,
    plain_shell: Option<bool>,
    fresh_session: Option<bool>,
    preserve_coordination_session: Option<bool>,
    slot_key: Option<String>,
    terminal_index: Option<u16>,
    thread_id: Option<String>,
    working_directory: Option<String>,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalStartAgentRequest {
    pane_id: String,
    instance_id: Option<u64>,
    provider: String,
    provider_session_id: Option<String>,
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
    project_root: String,
    agent_id: Option<String>,
    session_id: Option<String>,
    agent_branch_root: Option<String>,
    agent_branch: Option<String>,
    slot_key: Option<String>,
    thread_id: Option<String>,
    coordination_mode: Option<String>,
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
    prompt_event_id: Option<String>,
    prompt_event_revision: Option<u64>,
    prompt_event_source: Option<String>,
    prompt_event_submitted_at: Option<String>,
    prompt_event_text: Option<String>,
    thread_id: Option<String>,
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
    expected_prompt: Option<String>,
    observed_prompt: Option<String>,
    prompt_match: bool,
    prompt_source: String,
    prompt: String,
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
    expected_sha1: &'static str,
    approximate_disk_mb: u64,
    approximate_memory_mb: u64,
    bytes: u64,
    shortcut: String,
    shortcuts: AudioShortcutSettingsStatus,
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
    repo_id: Option<String>,
    agent_statuses: Option<Value>,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    workspace_root: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudVoiceAgentTextMessageRequest {
    text: String,
    turn_index: Option<u64>,
    repo_id: Option<String>,
    agent_statuses: Option<Value>,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    workspace_root: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudVoiceAgentStartStatus {
    active: bool,
    repo_id: String,
    sample_rate: u32,
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

struct PreparedPromptImages {
    directory: PathBuf,
    paths: Vec<String>,
}

include!("validation.rs");
include!("platform.rs");
include!("process.rs");
include!("workspace_files.rs");
include!("workspace_threads_store.rs");
include!("workspace_web.rs");
include!("developer_processes.rs");
include!("terminal_cli.rs");
include!("cloud_mcp.rs");
include!("agent_sessions.rs");
include!("terminals.rs");
include!("api.rs");
include!("audio.rs");
include!("handsfree_audio.rs");

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
        "Stopping knowledge graph sync tasks.",
        3,
        None,
        None,
    );
    {
        let cloud_mcp_state = app_for_shutdown.state::<CloudMcpState>();
        let _ = cloud_mcp_stop_all_knowledge_graph_syncs(cloud_mcp_state.inner()).await;
    }

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
    log_audio_diagnostic_event(
        "audio.debug.process_start",
        json!({
            "app_pid": std::process::id(),
            "log_file": whisper_local_audio_log_path().display().to_string(),
        }),
    );

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            #[cfg(target_os = "macos")]
            restore_main_window_after_reopen(app.clone(), false);
            #[cfg(not(target_os = "macos"))]
            restore_main_window(app);
        }));
    }

    builder
        .manage(TerminalState {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            parked_prompts: Arc::new(RwLock::new(HashMap::new())),
            active_audio_input_target: Arc::new(StdMutex::new(None)),
            lifecycle_lock: Arc::new(Mutex::new(())),
            pty_pool: Arc::clone(&pty_pool),
            cleanup_tracker: Arc::new(TerminalCleanupTracker::new()),
            next_terminal_instance_id: AtomicU64::new(1),
        })
        .manage(TerminalDiagnosticState::new())
        .manage(WindowsTerminalDiagnosticState::new())
        .manage(CloudMcpState::new())
        .manage(DeveloperProcessMonitorState::new())
        .manage(AudioState {
            download_lock: Arc::new(Mutex::new(())),
            cloud_voice_agent_stream: Arc::new(Mutex::new(None)),
            deepgram_stream: Arc::new(Mutex::new(None)),
            input_worker: NativeAudioWorker::new(),
            realtime_stream_lock: Arc::new(Mutex::new(())),
            shortcut_manager: AudioShortcutManager::new(),
            whisper_cancel_token: Arc::new(AtomicU64::new(0)),
            whisper_engine: WhisperCliWarmCache::new(),
        })
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            pty_pool.ensure_warm_async();
            let cloud_mcp_state = app.state::<CloudMcpState>().inner().clone();
            tauri::async_runtime::spawn(async move {
                let _ = cloud_mcp_connect_state(&cloud_mcp_state).await;
            });
            register_terminal_input_event_listener(app);
            register_terminal_coordination_event_bridge(app);

            register_audio_shortcuts(app.handle());

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
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_ping,
            exchange_desktop_auth_code,
            validate_desktop_session,
            logout_desktop_session,
            record_desktop_signin_diagnostic,
            list_workspaces,
            create_workspace,
            update_workspace,
            agent_statuses,
            start_agent_login,
            disconnect_agent,
            install_agent,
            update_agent,
            list_developer_processes,
            kill_developer_process,
            docker_developer_action,
            forge_working_directory,
            validate_workspace_root_directory,
            list_workspace_directory,
            read_workspace_file,
            read_workspace_file_diff,
            workspace_threads_read,
            workspace_threads_persist,
            workspace_web_normalize_url,
            workspace_web_navigate,
            workspace_web_reload,
            workspace_web_close_all,
            run_forge_prompt,
            agent_thread_turn_start,
            save_todo_image_attachments,
            save_todo_text_attachment,
            whisper_model_status,
            download_whisper_model,
            uninstall_whisper_model,
            audio_input_devices,
            start_audio_input_monitor,
            stop_audio_input_monitor,
            begin_audio_input_capture,
            finish_audio_input_capture,
            prepare_whisper_model,
            transcribe_whisper_audio,
            cancel_whisper_transcription,
            start_deepgram_realtime_transcription,
            stop_deepgram_realtime_transcription,
            start_cloud_voice_agent_stream,
            finish_cloud_voice_agent_input,
            stop_cloud_voice_agent_stream,
            send_cloud_voice_agent_text_message,
            read_orchestrator_voice_history,
            write_orchestrator_voice_history,
            audio_shortcuts_status,
            audio_push_to_talk_status,
            open_audio_shortcut_permissions,
            set_audio_shortcut,
            reset_audio_shortcuts,
            audio_widget_status,
            show_audio_widget,
            hide_audio_widget,
            toggle_audio_widget,
            insert_transcribed_text,
            insert_handsfree_transcribed_text,
            note_main_window_minimize_requested,
            terminal_recover_crashed_sessions,
            cloud_mcp_connect,
            cloud_mcp_set_desktop_session_token,
            cloud_mcp_get_status,
            cloud_mcp_get_billing_status,
            cloud_mcp_register_workspace,
            cloud_mcp_sync_workspace,
            cloud_mcp_sync_agent_installations,
            cloud_mcp_reset_workspace_graph_state,
            cloud_mcp_record_spec_edit_intent,
            cloud_mcp_record_voice_plan_task_status,
            cloud_mcp_get_activity,
            cloud_mcp_get_cached_spec_graph,
            cloud_mcp_get_local_ignored_spec_graph_overlay,
            cloud_mcp_start_spec_graph_sync,
            cloud_mcp_stop_spec_graph_sync,
            cloud_mcp_get_spec_graph,
            cloud_mcp_get_cached_knowledge_graph,
            cloud_mcp_start_knowledge_graph_sync,
            cloud_mcp_stop_knowledge_graph_sync,
            cloud_mcp_get_knowledge_graph,
            agent_thread_session_discover,
            agent_thread_transcript,
            terminal_open,
            terminal_start_agent,
            terminal_start_agent_many,
            set_terminal_audio_input_target,
            terminal_write_to_audio_input_target,
            terminal_write,
            terminal_refresh_theme,
            terminal_windows_pty_info,
            terminal_set_diagnostic_logging,
            terminal_diagnostic_log,
            thread_bridge_diagnostic_log,
            bigview_sync_diagnostic_log,
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
            coordination::tauri_commands::coordination_init,
            coordination::tauri_commands::coordination_get_snapshot,
            coordination::tauri_commands::coordination_log_ui_surface_event,
            coordination::tauri_commands::coordination_cleanup_bloat_dry_run,
            coordination::tauri_commands::coordination_start_file_watcher,
            coordination::tauri_commands::coordination_stop_file_watcher,
            coordination::tauri_commands::coordination_get_file_watcher_status,
            coordination::tauri_commands::coordination_get_alignment_report,
            coordination::tauri_commands::coordination_get_workspace_mcp_status,
            coordination::tauri_commands::coordination_workspace_mcp_registry,
            coordination::tauri_commands::coordination_add_workspace_mcp_marketplace,
            coordination::tauri_commands::coordination_remove_workspace_mcp_marketplace,
            coordination::tauri_commands::coordination_index_workspace_mcp_marketplace,
            coordination::tauri_commands::coordination_install_workspace_mcp_server,
            coordination::tauri_commands::coordination_update_workspace_mcp_server,
            coordination::tauri_commands::coordination_uninstall_workspace_mcp_server,
            coordination::tauri_commands::coordination_activate_shared_mcp_daemon,
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

                if phase < APP_SHUTDOWN_PHASE_EXITING {
                    api.prevent_exit();
                    let _ = begin_app_shutdown();
                    let _ = schedule_app_force_exit(app.clone(), "main".to_string());

                    if APP_CLOSE_SHUTDOWN_IN_FLIGHT
                        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                        .is_ok()
                    {
                        let app_for_shutdown = app.clone();
                        tauri::async_runtime::spawn(async move {
                            run_backend_app_shutdown(app_for_shutdown, "main".to_string()).await;
                        });
                    }

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
                restore_main_window_after_reopen(app.clone(), has_visible_windows);
            }
        });
}

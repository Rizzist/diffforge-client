#[cfg(target_os = "macos")]
use objc2_app_kit::{NSCursor, NSWindow};
#[cfg(target_os = "macos")]
use objc2_core_foundation::{CGPoint, CGRect};
use image::ImageFormat as SnippingImageFormat;

const SNIPPING_SHORTCUTS_CHANGED_EVENT: &str = "forge-snipping-shortcuts-changed";
const SNIPPING_CAPTURE_SAVED_EVENT: &str = "forge-snipping-capture-saved";
const SNIPPING_PERMISSION_ATTENTION_EVENT: &str = "forge-snipping-permission-attention";
const SNIPPING_CAPTURE_ATTENTION_EVENT: &str = "forge-snipping-capture-attention";
const SNIPPING_SOURCE_UPDATED_EVENT: &str = "forge-snip-source-updated";
const SNIPPING_CLOUD_UPLOAD_EVENT: &str = "forge-snip-cloud-upload";
const SNIPPING_AREA_OVERLAY_STARTED_EVENT: &str = "forge-snipping-area-overlay-started";
const SNIPPING_AREA_OVERLAY_SNAPSHOT_EVENT: &str = "forge-snipping-area-overlay-snapshot";
const SNIPPING_DISPATCH_TARGETS_CHANGED_EVENT: &str =
    "diffforge:snipping-dispatch-targets-changed";
const SNIPPING_AREA_OVERLAY_WINDOW_PREFIX: &str = "snipping-overlay";
const SNIPPING_RECORDING_CONTROLS_WINDOW_LABEL: &str = "snipping-recording-controls";
const SNIPPING_RECORDING_CONTROLS_TITLE: &str = "Diff Forge Recording Controls";
const SNIPPING_EDITOR_WINDOW_PREFIX: &str = "snipping-editor";
const SNIPPING_EDITOR_DISPOSE_EVENT: &str = "forge-snip-editor-dispose";
const SNIPPING_SHORTCUT_SETTINGS_FILE: &str = "snipping-shortcuts.json";
const SNIPPING_DISMISSED_TOASTS_FILE: &str = "snipping-dismissed-toasts.json";
/// Restore recipe written while this app has the user's desktop icons hidden
/// for a capture; replayed on startup if a crash skipped the normal restore.
const SNIPPING_DESKTOP_ICONS_MARKER_FILE: &str = "snipping-desktop-icons-hidden.json";

/// True only between a hide this process performed and its matching restore,
/// so captures never double-hide and never touch a user's own icons-off setup.
static SNIPPING_DESKTOP_ICONS_HIDDEN_BY_APP: AtomicBool = AtomicBool::new(false);
static SNIPPING_AREA_BEGIN_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static SNIPPING_AREA_BEGIN_STARTED_AT_MS: AtomicU64 = AtomicU64::new(0);
static SNIPPING_AREA_BEGIN_GENERATION: AtomicU64 = AtomicU64::new(0);
static SNIPPING_AREA_CURSOR_DEBUG_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static SNIPPING_AREA_CURSOR_DEBUG_LAST_MOUSE_LOG_MS: AtomicU64 = AtomicU64::new(0);
const SNIPPING_CAPTURE_HIDE_OVERLAY_DELAY_MS: u64 = 16;
const SNIPPING_SCAP_CAPTURE_FPS: u32 = 60;
const SNIPPING_SCAP_WARM_CAPTURE_FPS: u32 = 30;
const SNIPPING_SCAP_CAPTURE_TIMEOUT_MS: u64 = 4_500;
const SNIPPING_SCAP_TARGET_SIZE_TIMEOUT_MS: u64 = 1_200;
const SNIPPING_AREA_BEGIN_CAPTURE_TIMEOUT_MS: u64 = 5_500;
const SNIPPING_AREA_BEGIN_STALE_MS: u64 = SNIPPING_AREA_BEGIN_CAPTURE_TIMEOUT_MS + 3_000;
const SNIPPING_STARTUP_PREWARM_ENABLED: bool = false;
const SNIPPING_WARM_CAPTURE_ENABLED: bool = false;
const SNIPPING_RECORDING_FPS: u32 = 30;
const SNIPPING_RECORDING_MAX_SAMPLE_DURATION_MS: u32 = 45_000;
const SNIPPING_WARM_CAPTURE_FRAME_MAX_AGE_MS: u64 = 750;
const SNIPPING_WARM_CAPTURE_RESTART_MIN_MS: u64 = 2_000;
const SNIPPING_MIN_AREA_PIXELS: u32 = 8;
const SNIPPING_MIN_RECORDING_PIXELS: u32 = 8;
const SNIPPING_RECENT_CAPTURE_TOAST_LIMIT: usize = 6;
const SNIPPING_AREA_CURSOR_DEBUG_MOUSE_SAMPLE_MS: u64 = 120;
const SNIPPING_AREA_OVERLAY_READY_WAIT_MS: u64 = 650;
const SNIPPING_AREA_OVERLAY_READY_POLL_MS: u64 = 8;
#[cfg(target_os = "macos")]
const MACOS_SCREEN_CAPTURE_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_CG_HID_EVENT_TAP: u32 = 0;
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_CG_EVENT_TAP_OPTION_DEFAULT: u32 = 0;
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_CG_EVENT_KEY_DOWN: u32 = 10;
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xffff_fffe;
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_CG_EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = 0xffff_ffff;
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_KEYBOARD_EVENT_AUTOREPEAT: u32 = 8;
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_FLAG_SHIFT: u64 = 0x0002_0000;
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_FLAG_CONTROL: u64 = 0x0004_0000;
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_FLAG_OPTION: u64 = 0x0008_0000;
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_FLAG_COMMAND: u64 = 0x0010_0000;
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_KEY_3: i64 = 20;
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_KEY_4: i64 = 21;
#[cfg(target_os = "macos")]
const SNIPPING_MACOS_KEY_5: i64 = 23;
#[cfg(target_os = "macos")]
const SNIPPING_AREA_REASSERT_DELAYS_MS: [u64; 6] = [0, 120, 280, 700, 1_600, 3_000];
#[cfg(target_os = "macos")]
const SNIPPING_AREA_CURSOR_GUARD_INTERVAL_MS: u64 = 50;
#[cfg(target_os = "macos")]
const SNIPPING_AREA_CURSOR_GUARD_DURATION_MS: u64 = 5_000;

// CGPreflightScreenCaptureAccess caches its result per process and is known to
// keep reporting false after the user grants Screen Recording while the app is
// running. Once we have actually obtained capture access this session — a real
// snip succeeded, the request API resolved to granted, or the prewarm session
// established — we trust this flag instead of the stale preflight value so the
// permissions panel stops showing "Needs access".
#[cfg(target_os = "macos")]
static SNIPPING_SCREEN_CAPTURE_CONFIRMED: AtomicBool = AtomicBool::new(false);
// The first scap capture in a process makes macOS set up its screen-capture
// pipeline, which briefly flickers the display. We establish that session once,
// off the interactive path, so the user's first real area snip is flicker-free.
#[cfg(target_os = "macos")]
static SNIPPING_CAPTURE_SESSION_PREWARMED: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
static SNIPPING_MACOS_EVENT_TAP_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static SNIPPING_MACOS_EVENT_TAP_HANDLE: AtomicUsize = AtomicUsize::new(0);
#[cfg(target_os = "macos")]
static SNIPPING_MACOS_EVENT_TAP_APP: OnceLock<StdMutex<Option<AppHandle>>> = OnceLock::new();

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: extern "C" fn(
            *mut std::ffi::c_void,
            u32,
            *mut std::ffi::c_void,
            *mut std::ffi::c_void,
        ) -> *mut std::ffi::c_void,
        user_info: *mut std::ffi::c_void,
    ) -> *mut std::ffi::c_void;
    fn CGEventTapEnable(tap: *mut std::ffi::c_void, enable: bool);
    fn CGEventGetFlags(event: *mut std::ffi::c_void) -> u64;
    fn CGEventGetIntegerValueField(event: *mut std::ffi::c_void, field: u32) -> i64;
    fn CGEventSourceButtonState(state_id: u32, button: u32) -> bool;
}

/// kCGEventSourceStateCombinedSessionState / kCGMouseButtonLeft: true while
/// the left mouse button is held anywhere in the session (a native window
/// drag is still in progress).
#[cfg(target_os = "macos")]
fn snipping_left_mouse_button_pressed() -> bool {
    unsafe { CGEventSourceButtonState(0, 0) }
}

/// VK_LBUTTON via GetAsyncKeyState: high bit set while the button is held.
#[cfg(windows)]
fn snipping_left_mouse_button_pressed() -> bool {
    let state = unsafe { windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(0x01) };
    (state as u16 & 0x8000) != 0
}

#[cfg(not(any(target_os = "macos", windows)))]
fn snipping_left_mouse_button_pressed() -> bool {
    false
}

/// Whether this platform can actually answer "is the left button down?".
/// Where it can, preview drops resolve the instant the button releases;
/// where it cannot (Linux), the Moved-event deadline is the only signal and
/// must never be short-circuited by the always-false button probe.
fn snipping_mouse_button_state_supported() -> bool {
    cfg!(any(target_os = "macos", windows))
}

fn snipping_area_cursor_debug_log_path() -> PathBuf {
    diagnostic_log_path(SNIPPING_AREA_CURSOR_DEBUG_LOG_FILE)
}

fn snipping_area_cursor_debug_thread_label() -> String {
    let current_thread = thread::current();
    let name = current_thread.name().unwrap_or("unnamed");
    format!("{:?}:{name}", current_thread.id())
}

fn log_snipping_area_cursor_debug_event(phase: &str, fields: Value) {
    if !SNIPPING_AREA_CURSOR_DEBUG_LOGGING_ENABLED {
        return;
    }

    let log_path = snipping_area_cursor_debug_log_path();
    let Some(log_dir) = log_path.parent() else {
        return;
    };

    if fs::create_dir_all(log_dir).is_err() {
        return;
    }

    let lock = SNIPPING_AREA_CURSOR_DEBUG_LOG_LOCK.get_or_init(|| StdMutex::new(()));
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

    let _ = writeln!(
        file,
        "{}",
        json!({
            "ts_ms": current_time_ms(),
            "phase": clean_terminal_diagnostic_log_text(phase),
            "app_pid": std::process::id(),
            "thread": snipping_area_cursor_debug_thread_label(),
            "details": fields,
        })
    );
}

fn snipping_area_cursor_debug_should_sample_mouse() -> bool {
    let now = current_time_ms();
    let previous = SNIPPING_AREA_CURSOR_DEBUG_LAST_MOUSE_LOG_MS.load(Ordering::Acquire);
    if now.saturating_sub(previous) < SNIPPING_AREA_CURSOR_DEBUG_MOUSE_SAMPLE_MS {
        return false;
    }
    SNIPPING_AREA_CURSOR_DEBUG_LAST_MOUSE_LOG_MS
        .compare_exchange(previous, now, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
}

fn snipping_app_cursor_position_debug_value(app: &AppHandle) -> Value {
    app.cursor_position()
        .map(|position| {
            json!({
                "x": position.x,
                "y": position.y,
            })
        })
        .unwrap_or(Value::Null)
}

#[cfg(target_os = "macos")]
fn snipping_macos_point_debug_value(point: CGPoint) -> Value {
    json!({
        "x": point.x,
        "y": point.y,
    })
}

#[cfg(target_os = "macos")]
fn snipping_macos_rect_debug_value(rect: CGRect) -> Value {
    json!({
        "x": rect.origin.x,
        "y": rect.origin.y,
        "width": rect.size.width,
        "height": rect.size.height,
    })
}

#[cfg(target_os = "macos")]
fn snipping_macos_cursor_matches(
    cursor: &NSCursor,
    candidate: objc2::rc::Retained<NSCursor>,
) -> bool {
    std::ptr::eq(cursor, &*candidate)
}

#[cfg(target_os = "macos")]
fn snipping_macos_cursor_kind(cursor: &NSCursor) -> &'static str {
    if snipping_macos_cursor_matches(cursor, NSCursor::crosshairCursor()) {
        "crosshair"
    } else if snipping_macos_cursor_matches(cursor, NSCursor::arrowCursor()) {
        "arrow"
    } else if snipping_macos_cursor_matches(cursor, NSCursor::closedHandCursor()) {
        "closed-hand"
    } else if snipping_macos_cursor_matches(cursor, NSCursor::openHandCursor()) {
        "open-hand"
    } else if snipping_macos_cursor_matches(cursor, NSCursor::pointingHandCursor()) {
        "pointing-hand"
    } else if snipping_macos_cursor_matches(cursor, NSCursor::IBeamCursor()) {
        "i-beam"
    } else if snipping_macos_cursor_matches(cursor, NSCursor::operationNotAllowedCursor()) {
        "operation-not-allowed"
    } else if snipping_macos_cursor_matches(cursor, NSCursor::dragCopyCursor()) {
        "drag-copy"
    } else if snipping_macos_cursor_matches(cursor, NSCursor::dragLinkCursor()) {
        "drag-link"
    } else if snipping_macos_cursor_matches(cursor, NSCursor::contextualMenuCursor()) {
        "contextual-menu"
    } else {
        "unknown"
    }
}

#[cfg(target_os = "macos")]
fn snipping_macos_cursor_debug_value(cursor: &NSCursor) -> Value {
    json!({
        "kind": snipping_macos_cursor_kind(cursor),
        "ptr": format!("{:p}", cursor as *const NSCursor),
    })
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn snipping_macos_current_cursor_debug_value() -> Value {
    let app_current = NSCursor::currentCursor();
    let system_current = NSCursor::currentSystemCursor()
        .map(|cursor| snipping_macos_cursor_debug_value(&cursor))
        .unwrap_or(Value::Null);
    json!({
        "app_current": snipping_macos_cursor_debug_value(&app_current),
        "system_current": system_current,
    })
}

#[cfg(target_os = "macos")]
fn snipping_macos_window_cursor_debug_value(
    label: &str,
    ns_window: &NSWindow,
    mouse_location: CGPoint,
) -> Value {
    let frame = ns_window.frame();
    let mouse_inside = mouse_location.x >= frame.origin.x
        && mouse_location.x < frame.origin.x + frame.size.width
        && mouse_location.y >= frame.origin.y
        && mouse_location.y < frame.origin.y + frame.size.height;
    json!({
        "label": label,
        "visible": ns_window.isVisible(),
        "key": ns_window.isKeyWindow(),
        "main": ns_window.isMainWindow(),
        "accepts_mouse_moved": ns_window.acceptsMouseMovedEvents(),
        "cursor_rects_enabled": ns_window.areCursorRectsEnabled(),
        "level": ns_window.level(),
        "frame": snipping_macos_rect_debug_value(frame),
        "mouse_inside": mouse_inside,
    })
}

#[cfg(target_os = "macos")]
fn snipping_macos_cursor_context_debug_value() -> Value {
    json!({
        "session_active": SNIPPING_AREA_SESSION_ACTIVE.load(Ordering::Acquire),
        "mouse_button_down": snipping_left_mouse_button_pressed(),
        "mouse_button_state_supported": snipping_mouse_button_state_supported(),
        "cursor": snipping_macos_current_cursor_debug_value(),
    })
}

#[cfg(target_os = "macos")]
fn snipping_area_native_cursor_context_debug_value() -> Value {
    snipping_macos_cursor_context_debug_value()
}

#[cfg(not(target_os = "macos"))]
fn snipping_area_native_cursor_context_debug_value() -> Value {
    json!({
        "session_active": Value::Null,
        "mouse_button_down": snipping_left_mouse_button_pressed(),
        "mouse_button_state_supported": snipping_mouse_button_state_supported(),
        "cursor": Value::Null,
    })
}

#[cfg(target_os = "macos")]
fn snipping_run_on_main_thread_sync<T, F>(
    app: &AppHandle,
    context: &'static str,
    work: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    if objc2_foundation::NSThread::isMainThread_class() {
        return work();
    }

    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(work());
    })
    .map_err(|error| format!("Unable to schedule {context} on the main thread: {error}"))?;

    receiver
        .recv_timeout(Duration::from_millis(750))
        .map_err(|error| format!("Timed out waiting for {context} on the main thread: {error}"))?
}

#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFRunLoopCommonModes: *const std::ffi::c_void;
    fn CFMachPortCreateRunLoopSource(
        allocator: *const std::ffi::c_void,
        port: *mut std::ffi::c_void,
        order: isize,
    ) -> *mut std::ffi::c_void;
    fn CFRunLoopAddSource(
        rl: *mut std::ffi::c_void,
        source: *mut std::ffi::c_void,
        mode: *const std::ffi::c_void,
    );
    fn CFRunLoopGetCurrent() -> *mut std::ffi::c_void;
    fn CFRunLoopRun();
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SnippingAreaMode {
    Image,
    Recording,
}

impl SnippingAreaMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Recording => "recording",
        }
    }
}

/// One per-monitor overlay window's frozen state during an active area snip:
/// the monitor geometry (plus backdrop JPEG path) and the in-memory frozen
/// frame the final crop is cut from. Keyed by overlay window label.
#[derive(Clone)]
struct SnippingAreaSession {
    mode: SnippingAreaMode,
    monitor: SnippingAreaMonitor,
    snapshot: Option<Arc<image::RgbaImage>>,
}

#[derive(Clone)]
struct SnippingWarmFrame {
    frame: Arc<scap::frame::VideoFrame>,
    captured_at_ms: u64,
    width: i32,
    height: i32,
}

struct SnippingWarmCaptureState {
    generation: AtomicU64,
    starting: AtomicBool,
    last_start_ms: AtomicU64,
    frames: StdMutex<HashMap<String, SnippingWarmFrame>>,
}

impl SnippingWarmCaptureState {
    fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
            starting: AtomicBool::new(false),
            last_start_ms: AtomicU64::new(0),
            frames: StdMutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone)]
struct SnippingRecordingSession {
    id: String,
    stop: Arc<AtomicBool>,
    stop_requested_at_ms: Arc<AtomicU64>,
    target_path: PathBuf,
    tmp_path: PathBuf,
    started_at_ms: u64,
    width: u32,
    height: u32,
}

struct SnippingRecordingState {
    active: StdMutex<Option<SnippingRecordingSession>>,
}

impl SnippingRecordingState {
    fn new() -> Self {
        Self {
            active: StdMutex::new(None),
        }
    }
}

#[derive(Clone)]
struct SnippingState {
    shortcut_manager: SnippingShortcutManager,
    active_area_sessions: Arc<StdMutex<HashMap<String, SnippingAreaSession>>>,
    area_overlay_ready_labels: Arc<StdMutex<HashSet<String>>>,
    warm_capture: Arc<SnippingWarmCaptureState>,
    recording: Arc<SnippingRecordingState>,
    recent_capture_toasts: Arc<StdMutex<Vec<Value>>>,
    dispatch_targets: Arc<StdMutex<Value>>,
    /// Settle deadline (epoch ms) pushed forward by every preview Moved
    /// event; one watcher thread (gated by the flag below) polls it together
    /// with the live mouse-button state, so a release resolves the drop
    /// immediately instead of waiting out a debounce.
    preview_restack_deadline_ms: Arc<AtomicU64>,
    preview_restack_watcher_active: Arc<AtomicBool>,
    /// Preview window label -> asset path currently shown in that window
    /// (retargeted when an annotated copy takes over the preview).
    preview_paths: Arc<StdMutex<HashMap<String, String>>>,
    /// Old snip path -> promoted tracked asset path. The recent strip may
    /// still ask to open the source path after promotion; aliases keep that
    /// request attached to the already-awake preview instead of spawning a
    /// duplicate.
    preview_path_aliases: Arc<StdMutex<HashMap<String, String>>>,
    /// Preview window label -> outer position when the user grabbed it.
    /// Presence marks an in-flight user drag; the start position separates
    /// real drags from plain clicks when the drag settles.
    preview_drag_sessions: Arc<StdMutex<HashMap<String, (i32, i32)>>>,
    /// Preview labels the user has manually moved. These may still block the
    /// bottom-left queue, but the queue must not pull them into an auto slot
    /// after release.
    preview_detached_labels: Arc<StdMutex<HashSet<String>>>,
    /// Preview labels released near the queue column that are waiting for
    /// native post-release movement (edge snap/constrain) to go quiet before
    /// the app decides queue vs detached from the final position.
    preview_post_release_settling_labels: Arc<StdMutex<HashSet<String>>>,
    /// Preview labels currently hovering over the recent strip during a native
    /// drag. While present, their native window stays strip-tile sized.
    preview_strip_hover_labels: Arc<StdMutex<HashSet<String>>>,
    /// Preview labels freshly pulled from the strip whose native window drag is
    /// still being adopted by the OS. During this short phase, synthetic
    /// position/size moves must not trigger left-column queue reflow.
    preview_drag_handoff_until_ms: Arc<StdMutex<HashMap<String, u64>>>,
    /// Epoch-ms guard set by the strip webview while a tile drag is active or
    /// has just ended. Outside-click dismissal checks this before hiding the
    /// strip on focus loss or global mouse release.
    strip_interaction_guard_until_ms: Arc<AtomicU64>,
    strip_outside_click_watcher_active: Arc<AtomicBool>,
    /// Bumped on every strip show/close. Delayed show reassertions and hide
    /// tasks compare their ticket so stale timers cannot resurrect or hide the
    /// wrong visibility state.
    strip_visibility_generation: Arc<AtomicU64>,
    /// Bumped whenever the native strip window is re-anchored; in-flight
    /// position tweens compare their ticket and stop when superseded.
    strip_position_animation_generation: Arc<AtomicU64>,
    /// Set by the watcher as soon as it sees mouse-up for a native preview
    /// drag, before the main-thread settle pass can decide whether the
    /// left-column quiet gate applies. This prevents a post-release Moved
    /// event from spawning a second watcher that resolves too early.
    preview_post_release_check_pending: Arc<AtomicBool>,
    /// Preview labels whose webviews have been told to dispose and whose native
    /// windows are waiting for the close grace/release gate.
    preview_closing: Arc<StdMutex<HashSet<String>>>,
    preview_drag_over_last_emit_ms: Arc<AtomicU64>,
    /// Bumped whenever a preview size tween is superseded by a newer
    /// strip-hover shrink/expand target.
    preview_size_animation_generation: Arc<AtomicU64>,
    /// Bumped whenever a new stack animation starts; in-flight tween threads
    /// compare their ticket and stop, so re-targeted reflows never fight.
    preview_animation_generation: Arc<AtomicU64>,
    preview_live_reflow_last_ms: Arc<AtomicU64>,
    /// Labels of hidden, fully booted preview windows parked for instant
    /// adoption by the next capture (webview creation + page boot paid ahead
    /// of the capture hot path).
    preview_pool: Arc<StdMutex<Vec<String>>>,
    preview_pool_spawning: Arc<AtomicBool>,
    /// Annotation editor window label -> the asset paths it is editing. One
    /// asset gets at most one live editor: re-annotating focuses the existing
    /// window instead of opening a duplicate that would fight over saves.
    editor_paths: Arc<StdMutex<HashMap<String, Vec<String>>>>,
}

impl SnippingState {
    fn new() -> Self {
        Self {
            shortcut_manager: SnippingShortcutManager::new(),
            active_area_sessions: Arc::new(StdMutex::new(HashMap::new())),
            area_overlay_ready_labels: Arc::new(StdMutex::new(HashSet::new())),
            warm_capture: Arc::new(SnippingWarmCaptureState::new()),
            recording: Arc::new(SnippingRecordingState::new()),
            recent_capture_toasts: Arc::new(StdMutex::new(Vec::new())),
            dispatch_targets: Arc::new(StdMutex::new(Value::Array(Vec::new()))),
            preview_restack_deadline_ms: Arc::new(AtomicU64::new(0)),
            preview_restack_watcher_active: Arc::new(AtomicBool::new(false)),
            preview_paths: Arc::new(StdMutex::new(HashMap::new())),
            preview_path_aliases: Arc::new(StdMutex::new(HashMap::new())),
            preview_drag_sessions: Arc::new(StdMutex::new(HashMap::new())),
            preview_detached_labels: Arc::new(StdMutex::new(HashSet::new())),
            preview_post_release_settling_labels: Arc::new(StdMutex::new(HashSet::new())),
            preview_strip_hover_labels: Arc::new(StdMutex::new(HashSet::new())),
            preview_drag_handoff_until_ms: Arc::new(StdMutex::new(HashMap::new())),
            strip_interaction_guard_until_ms: Arc::new(AtomicU64::new(0)),
            strip_outside_click_watcher_active: Arc::new(AtomicBool::new(false)),
            strip_visibility_generation: Arc::new(AtomicU64::new(0)),
            strip_position_animation_generation: Arc::new(AtomicU64::new(0)),
            preview_post_release_check_pending: Arc::new(AtomicBool::new(false)),
            preview_closing: Arc::new(StdMutex::new(HashSet::new())),
            preview_drag_over_last_emit_ms: Arc::new(AtomicU64::new(0)),
            preview_size_animation_generation: Arc::new(AtomicU64::new(0)),
            preview_animation_generation: Arc::new(AtomicU64::new(0)),
            preview_live_reflow_last_ms: Arc::new(AtomicU64::new(0)),
            preview_pool: Arc::new(StdMutex::new(Vec::new())),
            preview_pool_spawning: Arc::new(AtomicBool::new(false)),
            editor_paths: Arc::new(StdMutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone)]
struct SnippingShortcutManager {
    state: Arc<StdMutex<SnippingShortcutManagerState>>,
}

impl SnippingShortcutManager {
    fn new() -> Self {
        let settings = default_snipping_settings();
        Self {
            state: Arc::new(StdMutex::new(SnippingShortcutManagerState::from_settings(
                &settings,
            ))),
        }
    }

    fn snapshot(&self) -> SnippingShortcutManagerState {
        self.state
            .lock()
            .map(|state| state.clone())
            .unwrap_or_else(|_| {
                SnippingShortcutManagerState::from_settings(&default_snipping_settings())
            })
    }

    fn replace(&self, state: SnippingShortcutManagerState) {
        if let Ok(mut guard) = self.state.lock() {
            *guard = state;
        }
    }

    fn set_registration(
        &self,
        action: SnippingShortcutAction,
        registration: SnippingShortcutRegistration,
    ) {
        if let Ok(mut guard) = self.state.lock() {
            guard.set_registration(action, registration);
        }
    }
}

#[derive(Clone)]
struct SnippingShortcutManagerState {
    enabled: bool,
    hide_desktop_icons: bool,
    upload_public: bool,
    full_screenshot: SnippingShortcutRegistration,
    area_snip: SnippingShortcutRegistration,
    area_recording: SnippingShortcutRegistration,
}

impl SnippingShortcutManagerState {
    fn from_settings(settings: &SnippingSettings) -> Self {
        Self {
            enabled: settings.enabled,
            hide_desktop_icons: settings.hide_desktop_icons,
            upload_public: settings.upload_public,
            full_screenshot: SnippingShortcutRegistration::new(settings.full_screenshot.clone()),
            area_snip: SnippingShortcutRegistration::new(settings.area_snip.clone()),
            area_recording: SnippingShortcutRegistration::new(settings.area_recording.clone()),
        }
    }

    fn settings(&self) -> SnippingSettings {
        SnippingSettings {
            enabled: self.enabled,
            hide_desktop_icons: self.hide_desktop_icons,
            upload_public: self.upload_public,
            full_screenshot: self.full_screenshot.shortcut.clone(),
            area_snip: self.area_snip.shortcut.clone(),
            area_recording: self.area_recording.shortcut.clone(),
        }
    }

    fn registration(&self, action: SnippingShortcutAction) -> SnippingShortcutRegistration {
        match action {
            SnippingShortcutAction::FullScreenshot => self.full_screenshot.clone(),
            SnippingShortcutAction::AreaSnip => self.area_snip.clone(),
            SnippingShortcutAction::AreaRecording => self.area_recording.clone(),
        }
    }

    fn set_registration(
        &mut self,
        action: SnippingShortcutAction,
        registration: SnippingShortcutRegistration,
    ) {
        match action {
            SnippingShortcutAction::FullScreenshot => self.full_screenshot = registration,
            SnippingShortcutAction::AreaSnip => self.area_snip = registration,
            SnippingShortcutAction::AreaRecording => self.area_recording = registration,
        }
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }
}

#[derive(Clone)]
struct SnippingShortcutRegistration {
    shortcut: String,
    registered: bool,
    error: Option<String>,
}

impl SnippingShortcutRegistration {
    fn new(shortcut: String) -> Self {
        Self {
            shortcut,
            registered: false,
            error: None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SnippingShortcutAction {
    FullScreenshot,
    AreaSnip,
    AreaRecording,
}

impl SnippingShortcutAction {
    fn from_request(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "full" | "full-screenshot" | "full_screenshot" | "screenshot" => {
                Ok(Self::FullScreenshot)
            }
            "area" | "area-snip" | "area_snip" | "snip" | "selection" => Ok(Self::AreaSnip),
            "record"
            | "recording"
            | "area-recording"
            | "area_recording"
            | "screen-recording"
            | "screen_recording"
            | "video" => Ok(Self::AreaRecording),
            _ => Err("Unknown snipping shortcut action.".to_string()),
        }
    }

    fn default_shortcut(self) -> String {
        match self {
            Self::FullScreenshot => default_snipping_full_screenshot_shortcut().to_string(),
            Self::AreaSnip => default_snipping_area_snip_shortcut().to_string(),
            Self::AreaRecording => default_snipping_area_recording_shortcut().to_string(),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::FullScreenshot => "full screenshot",
            Self::AreaSnip => "area snip",
            Self::AreaRecording => "area recording",
        }
    }
}

#[cfg(target_os = "macos")]
fn default_snipping_full_screenshot_shortcut() -> &'static str {
    "Command+Shift+Digit3"
}

#[cfg(target_os = "macos")]
fn default_snipping_area_snip_shortcut() -> &'static str {
    "Command+Shift+Digit4"
}

#[cfg(target_os = "macos")]
fn default_snipping_area_recording_shortcut() -> &'static str {
    "Command+Shift+Digit5"
}

#[cfg(not(target_os = "macos"))]
fn default_snipping_full_screenshot_shortcut() -> &'static str {
    "Control+Shift+Digit3"
}

#[cfg(not(target_os = "macos"))]
fn default_snipping_area_snip_shortcut() -> &'static str {
    "Control+Shift+Digit4"
}

#[cfg(not(target_os = "macos"))]
fn default_snipping_area_recording_shortcut() -> &'static str {
    "Control+Shift+Digit5"
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnippingShortcutRegistrationStatus {
    shortcut: String,
    default_shortcut: String,
    registered: bool,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnippingPermissionStatus {
    platform: &'static str,
    shortcut_accessibility_required: bool,
    shortcut_accessibility_granted: bool,
    screen_capture_required: bool,
    screen_capture_granted: bool,
    screen_capture_settings_url: &'static str,
    message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnippingSettingsStatus {
    enabled: bool,
    hide_desktop_icons: bool,
    upload_public: bool,
    full_screenshot: SnippingShortcutRegistrationStatus,
    area_snip: SnippingShortcutRegistrationStatus,
    area_recording: SnippingShortcutRegistrationStatus,
    permissions: SnippingPermissionStatus,
    untracked_root: String,
}

fn default_snipping_enabled() -> bool {
    true
}

fn default_snipping_hide_desktop_icons() -> bool {
    true
}

fn default_snipping_upload_public() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnippingSettings {
    #[serde(default = "default_snipping_enabled")]
    enabled: bool,
    #[serde(default = "default_snipping_hide_desktop_icons")]
    hide_desktop_icons: bool,
    #[serde(default = "default_snipping_upload_public")]
    upload_public: bool,
    #[serde(default)]
    full_screenshot: String,
    #[serde(default)]
    area_snip: String,
    #[serde(default)]
    area_recording: String,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SnippingDismissedToasts {
    paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippingEnabledUpdateRequest {
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippingHideDesktopIconsRequest {
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippingUploadPublicRequest {
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippingPublishAssetRequest {
    asset_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippingShortcutUpdateRequest {
    action: String,
    shortcut: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippingCaptureRequest {
    mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippingAreaSelectionRequest {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale_factor: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippingAreaCursorLogRequest {
    phase: String,
    fields: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippingUploadAssetRequest {
    path: String,
    asset_id: Option<String>,
    name: Option<String>,
    group: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippingEditedAssetRequest {
    source_path: String,
    image_data_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippingAnnotationEditorRequest {
    paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippingCaptureToastDismissRequest {
    id: Option<String>,
    path: Option<String>,
    local_path: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnippingAreaMonitor {
    name: Option<String>,
    primary: bool,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
    capture_x: i32,
    capture_y: i32,
    capture_width: u32,
    capture_height: u32,
    snapshot_path: Option<String>,
    snapshot_width: u32,
    snapshot_height: u32,
}

fn default_snipping_settings() -> SnippingSettings {
    SnippingSettings {
        enabled: true,
        hide_desktop_icons: true,
        upload_public: true,
        full_screenshot: SnippingShortcutAction::FullScreenshot.default_shortcut(),
        area_snip: SnippingShortcutAction::AreaSnip.default_shortcut(),
        area_recording: SnippingShortcutAction::AreaRecording.default_shortcut(),
    }
}

fn snipping_shortcut_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;

    Ok(app_data_dir.join(SNIPPING_SHORTCUT_SETTINGS_FILE))
}

fn snipping_dismissed_toasts_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;

    Ok(app_data_dir.join(SNIPPING_DISMISSED_TOASTS_FILE))
}

fn snipping_shortcut_error_text(error: String) -> String {
    error
        .replace("Audio shortcuts", "Snipping shortcuts")
        .replace("audio shortcuts", "snipping shortcuts")
        .replace("Audio shortcut", "Snipping shortcut")
        .replace("audio shortcut", "snipping shortcut")
}

fn parse_snipping_shortcut(value: &str) -> Result<Shortcut, String> {
    parse_audio_shortcut(value).map_err(snipping_shortcut_error_text)
}

fn normalize_snipping_shortcut_text(value: &str) -> Result<String, String> {
    Ok(parse_snipping_shortcut(value)?.into_string())
}

fn snipping_shortcuts_conflict(left: &str, right: &str) -> bool {
    match (
        parse_snipping_shortcut(left),
        parse_snipping_shortcut(right),
    ) {
        (Ok(left), Ok(right)) => left.id() == right.id(),
        _ => false,
    }
}

fn snipping_shortcut_has_explicit_modifier(shortcut: &str) -> bool {
    audio_shortcut_has_explicit_modifier(shortcut)
}

fn snipping_shortcut_is_print_screen(shortcut: &str) -> bool {
    snipping_shortcuts_conflict(shortcut, "PrintScreen")
}

fn validate_snipping_shortcut_for_action(
    action: SnippingShortcutAction,
    shortcut: &str,
) -> Result<(), String> {
    parse_snipping_shortcut(shortcut)?;

    if !snipping_shortcut_has_explicit_modifier(shortcut)
        && !snipping_shortcut_is_print_screen(shortcut)
    {
        return Err(format!(
            "The {} shortcut needs a modifier such as Control, Command, Alt, or Shift.",
            action.label()
        ));
    }

    Ok(())
}

fn sanitized_snipping_settings(settings: SnippingSettings) -> SnippingSettings {
    let defaults = default_snipping_settings();
    let mut full_screenshot = normalize_snipping_shortcut_text(&settings.full_screenshot)
        .unwrap_or(defaults.full_screenshot.clone());
    let mut area_snip =
        normalize_snipping_shortcut_text(&settings.area_snip).unwrap_or(defaults.area_snip.clone());
    let mut area_recording = normalize_snipping_shortcut_text(&settings.area_recording)
        .unwrap_or(defaults.area_recording.clone());

    if validate_snipping_shortcut_for_action(
        SnippingShortcutAction::FullScreenshot,
        &full_screenshot,
    )
    .is_err()
    {
        full_screenshot = defaults.full_screenshot.clone();
    }

    if validate_snipping_shortcut_for_action(SnippingShortcutAction::AreaSnip, &area_snip).is_err()
    {
        area_snip = defaults.area_snip.clone();
    }

    if validate_snipping_shortcut_for_action(
        SnippingShortcutAction::AreaRecording,
        &area_recording,
    )
    .is_err()
    {
        area_recording = defaults.area_recording.clone();
    }

    if snipping_shortcuts_conflict(&full_screenshot, &area_snip) {
        area_snip = defaults.area_snip.clone();
    }
    if snipping_shortcuts_conflict(&full_screenshot, &area_recording)
        || snipping_shortcuts_conflict(&area_snip, &area_recording)
    {
        area_recording = defaults.area_recording.clone();
    }

    SnippingSettings {
        enabled: settings.enabled,
        hide_desktop_icons: settings.hide_desktop_icons,
        upload_public: settings.upload_public,
        full_screenshot,
        area_snip,
        area_recording,
    }
}

fn read_snipping_settings(app: &AppHandle) -> SnippingSettings {
    let Ok(path) = snipping_shortcut_settings_path(app) else {
        return default_snipping_settings();
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return default_snipping_settings();
    };

    serde_json::from_str::<SnippingSettings>(&contents)
        .map(sanitized_snipping_settings)
        .unwrap_or_else(|_| default_snipping_settings())
}

fn write_snipping_settings(app: &AppHandle, settings: &SnippingSettings) -> Result<(), String> {
    let path = snipping_shortcut_settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Unable to create snipping shortcut settings directory {}: {error}",
                parent.display()
            )
        })?;
    }
    let contents = serde_json::to_string_pretty(&sanitized_snipping_settings(settings.clone()))
        .map_err(|error| format!("Unable to encode snipping settings: {error}"))?;
    fs::write(&path, contents).map_err(|error| {
        format!(
            "Unable to write snipping shortcut settings {}: {error}",
            path.display()
        )
    })
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnippingDesktopIconsRestoreEntry {
    kind: String,
    #[serde(default)]
    schema: String,
    #[serde(default)]
    key: String,
    #[serde(default)]
    value: String,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SnippingDesktopIconsMarker {
    entries: Vec<SnippingDesktopIconsRestoreEntry>,
}

fn snipping_desktop_icons_marker_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;

    Ok(app_data_dir.join(SNIPPING_DESKTOP_ICONS_MARKER_FILE))
}

// Only the Windows/Linux screen-side hides leave state worth a crash marker;
// macOS hides capture-side and changes nothing on the system.
#[cfg(any(windows, target_os = "linux"))]
fn snipping_write_desktop_icons_marker(app: &AppHandle, marker: &SnippingDesktopIconsMarker) {
    let Ok(path) = snipping_desktop_icons_marker_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(contents) = serde_json::to_string(marker) {
        let _ = fs::write(path, contents);
    }
}

fn snipping_take_desktop_icons_marker(app: &AppHandle) -> Option<SnippingDesktopIconsMarker> {
    let path = snipping_desktop_icons_marker_path(app).ok()?;
    let contents = fs::read_to_string(&path).ok()?;
    let _ = fs::remove_file(&path);
    serde_json::from_str::<SnippingDesktopIconsMarker>(&contents).ok()
}

/// Undoes the Finder CreateDesktop toggle an older build's crash marker may
/// have left behind. The scap-backed macOS path does not mutate Finder state.
#[cfg(target_os = "macos")]
fn snipping_macos_restore_finder_desktop_icons() {
    let wrote = Command::new("defaults")
        .args([
            "write",
            "com.apple.finder",
            "CreateDesktop",
            "-bool",
            "true",
        ])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if wrote {
        // Finder only re-evaluates CreateDesktop on relaunch.
        let _ = Command::new("killall").arg("Finder").status();
    }
}

#[cfg(windows)]
fn snipping_windows_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The desktop icon ListView lives in a SHELLDLL_DefView under Progman, or
/// under a WorkerW when wallpaper slideshow mode has reparented it.
#[cfg(windows)]
fn snipping_windows_desktop_icons_view() -> *mut std::ffi::c_void {
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowExW, FindWindowW};

    let progman_class = snipping_windows_wide("Progman");
    let defview_class = snipping_windows_wide("SHELLDLL_DefView");
    let worker_class = snipping_windows_wide("WorkerW");
    unsafe {
        let progman = FindWindowW(progman_class.as_ptr(), std::ptr::null());
        if !progman.is_null() {
            let defview = FindWindowExW(
                progman,
                std::ptr::null_mut(),
                defview_class.as_ptr(),
                std::ptr::null(),
            );
            if !defview.is_null() {
                return defview;
            }
        }
        let mut worker = FindWindowExW(
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            worker_class.as_ptr(),
            std::ptr::null(),
        );
        while !worker.is_null() {
            let defview = FindWindowExW(
                worker,
                std::ptr::null_mut(),
                defview_class.as_ptr(),
                std::ptr::null(),
            );
            if !defview.is_null() {
                return defview;
            }
            worker = FindWindowExW(
                std::ptr::null_mut(),
                worker,
                worker_class.as_ptr(),
                std::ptr::null(),
            );
        }
        std::ptr::null_mut()
    }
}

#[cfg(windows)]
fn snipping_windows_show_desktop_icons_view(visible: bool) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IsWindowVisible, ShowWindow, SW_HIDE, SW_SHOW,
    };

    let defview = snipping_windows_desktop_icons_view();
    if defview.is_null() {
        return false;
    }
    unsafe {
        if !visible && IsWindowVisible(defview) == 0 {
            // Icons are already hidden (by the user or another tool).
            return false;
        }
        let _ = ShowWindow(defview, if visible { SW_SHOW } else { SW_HIDE });
    }
    true
}

#[cfg(windows)]
fn snipping_desktop_icons_hide_platform(app: &AppHandle) -> bool {
    if !snipping_windows_show_desktop_icons_view(false) {
        return false;
    }
    snipping_write_desktop_icons_marker(
        app,
        &SnippingDesktopIconsMarker {
            entries: vec![SnippingDesktopIconsRestoreEntry {
                kind: "windows-defview".to_string(),
                schema: String::new(),
                key: String::new(),
                value: String::new(),
            }],
        },
    );
    true
}

/// Desktop-icon toggles per Linux desktop environment that draws icons.
/// GNOME Shell itself has none; Cinnamon (nemo), MATE, and legacy GNOME
/// expose gsettings booleans, XFCE an xfconf icon-style integer.
#[cfg(target_os = "linux")]
const SNIPPING_LINUX_DESKTOP_ICON_GSETTINGS: &[(&str, &str)] = &[
    ("org.nemo.desktop", "show-desktop-icons"),
    ("org.mate.background", "show-desktop-icons"),
    ("org.gnome.desktop.background", "show-desktop-icons"),
];

#[cfg(target_os = "linux")]
fn snipping_linux_command_stdout(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "linux")]
fn snipping_desktop_icons_hide_platform(app: &AppHandle) -> bool {
    let mut entries = Vec::new();

    for (schema, key) in SNIPPING_LINUX_DESKTOP_ICON_GSETTINGS {
        let Some(value) = snipping_linux_command_stdout("gsettings", &["get", schema, key]) else {
            continue;
        };
        if value != "true" {
            continue;
        }
        let set = Command::new("gsettings")
            .args(["set", schema, key, "false"])
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if set {
            entries.push(SnippingDesktopIconsRestoreEntry {
                kind: "gsettings".to_string(),
                schema: (*schema).to_string(),
                key: (*key).to_string(),
                value: "true".to_string(),
            });
        }
    }

    if let Some(style) = snipping_linux_command_stdout(
        "xfconf-query",
        &["-c", "xfce4-desktop", "-p", "/desktop-icons/style"],
    ) {
        if style.parse::<i64>().map(|value| value > 0).unwrap_or(false) {
            let set = Command::new("xfconf-query")
                .args([
                    "-c",
                    "xfce4-desktop",
                    "-p",
                    "/desktop-icons/style",
                    "-s",
                    "0",
                ])
                .status()
                .map(|status| status.success())
                .unwrap_or(false);
            if set {
                entries.push(SnippingDesktopIconsRestoreEntry {
                    kind: "xfconf".to_string(),
                    schema: "xfce4-desktop".to_string(),
                    key: "/desktop-icons/style".to_string(),
                    value: style,
                });
            }
        }
    }

    if entries.is_empty() {
        return false;
    }
    snipping_write_desktop_icons_marker(app, &SnippingDesktopIconsMarker { entries });
    true
}

// macOS shares the no-op screen-side hide with unsupported platforms. scap's
// public target metadata does not expose enough Finder window ownership/layer
// data to recreate the previous capture-side desktop-icon exclusion here.
#[cfg(not(any(windows, target_os = "linux")))]
fn snipping_desktop_icons_hide_platform(_app: &AppHandle) -> bool {
    false
}

fn snipping_desktop_icons_restore_entries(entries: &[SnippingDesktopIconsRestoreEntry]) {
    for entry in entries {
        match entry.kind.as_str() {
            #[cfg(target_os = "macos")]
            "macos-finder" => {
                snipping_macos_restore_finder_desktop_icons();
            }
            #[cfg(windows)]
            "windows-defview" => {
                let _ = snipping_windows_show_desktop_icons_view(true);
            }
            #[cfg(target_os = "linux")]
            "gsettings" => {
                let _ = Command::new("gsettings")
                    .args(["set", &entry.schema, &entry.key, &entry.value])
                    .status();
            }
            #[cfg(target_os = "linux")]
            "xfconf" => {
                let _ = Command::new("xfconf-query")
                    .args(["-c", &entry.schema, "-p", &entry.key, "-s", &entry.value])
                    .status();
            }
            _ => {}
        }
    }
}

fn snipping_desktop_icons_restore_platform(app: &AppHandle) {
    if let Some(marker) = snipping_take_desktop_icons_marker(app) {
        snipping_desktop_icons_restore_entries(&marker.entries);
    }
}

fn snipping_should_hide_desktop_icons(app: &AppHandle) -> bool {
    app.state::<SnippingState>()
        .shortcut_manager
        .snapshot()
        .hide_desktop_icons
}

/// Hides desktop icon clutter ahead of a capture when the setting is on.
/// Screen-side hiding only exists on Windows/Linux; macOS filters the icon
/// windows out of the capture itself, so this no-ops there. No-ops when
/// icons are already hidden (by the user or an in-flight snip).
fn snipping_hide_desktop_icons_for_capture(app: &AppHandle) {
    if !snipping_should_hide_desktop_icons(app) {
        return;
    }
    if SNIPPING_DESKTOP_ICONS_HIDDEN_BY_APP.swap(true, Ordering::AcqRel) {
        return;
    }
    if !snipping_desktop_icons_hide_platform(app) {
        SNIPPING_DESKTOP_ICONS_HIDDEN_BY_APP.store(false, Ordering::Release);
    }
}

/// Brings the desktop icons back after a capture this process hid them for.
fn snipping_restore_desktop_icons_after_capture(app: &AppHandle) {
    if !SNIPPING_DESKTOP_ICONS_HIDDEN_BY_APP.swap(false, Ordering::AcqRel) {
        return;
    }
    snipping_desktop_icons_restore_platform(app);
}

/// A crash between hide and restore leaves the user's desktop iconless; the
/// persisted marker lets the next launch undo exactly what was changed.
fn snipping_restore_desktop_icons_from_marker_on_startup(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        snipping_desktop_icons_restore_platform(&app);
    });
}

#[cfg(target_os = "macos")]
fn macos_screen_capture_permission_granted() -> bool {
    if SNIPPING_SCREEN_CAPTURE_CONFIRMED.load(Ordering::Acquire) {
        return true;
    }
    let granted = unsafe { CGPreflightScreenCaptureAccess() };
    if granted {
        SNIPPING_SCREEN_CAPTURE_CONFIRMED.store(true, Ordering::Release);
    }
    granted
}

#[cfg(target_os = "macos")]
fn macos_request_screen_capture_permission() -> bool {
    let granted = unsafe { CGRequestScreenCaptureAccess() };
    if granted {
        SNIPPING_SCREEN_CAPTURE_CONFIRMED.store(true, Ordering::Release);
    }
    granted
}

/// Record that real screen-capture access has been observed this session. Used
/// to override the stale `CGPreflightScreenCaptureAccess` cache once a snip (or
/// the prewarm session) has actually captured. No-op off macOS.
fn snipping_mark_screen_capture_confirmed() {
    #[cfg(target_os = "macos")]
    SNIPPING_SCREEN_CAPTURE_CONFIRMED.store(true, Ordering::Release);
}

#[cfg(target_os = "macos")]
fn macos_open_screen_capture_settings() -> Result<(), String> {
    Command::new("open")
        .arg(MACOS_SCREEN_CAPTURE_SETTINGS_URL)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Unable to open macOS Screen Recording settings: {error}"))
}

fn snipping_permission_status() -> SnippingPermissionStatus {
    #[cfg(target_os = "macos")]
    {
        let shortcut_accessibility_granted = macos_accessibility_permission_granted();
        let screen_capture_granted = macos_screen_capture_permission_granted();
        let message = if !screen_capture_granted {
            "Enable Screen Recording for Diff Forge AI, then retry the snip.".to_string()
        } else if !shortcut_accessibility_granted {
            "Enable Accessibility if the global snipping shortcuts do not fire.".to_string()
        } else {
            "Snipping permissions look ready.".to_string()
        };

        return SnippingPermissionStatus {
            platform: "macos",
            shortcut_accessibility_required: true,
            shortcut_accessibility_granted,
            screen_capture_required: true,
            screen_capture_granted,
            screen_capture_settings_url: MACOS_SCREEN_CAPTURE_SETTINGS_URL,
            message,
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        SnippingPermissionStatus {
            platform: "other",
            shortcut_accessibility_required: false,
            shortcut_accessibility_granted: true,
            screen_capture_required: false,
            screen_capture_granted: true,
            screen_capture_settings_url: "",
            message: "Snipping is ready on this platform if the desktop environment allows screen capture.".to_string(),
        }
    }
}

fn snipping_shortcut_registration_status(
    action: SnippingShortcutAction,
    registration: SnippingShortcutRegistration,
) -> SnippingShortcutRegistrationStatus {
    SnippingShortcutRegistrationStatus {
        shortcut: registration.shortcut,
        default_shortcut: action.default_shortcut(),
        registered: registration.registered,
        error: registration.error,
    }
}

fn snipping_status_from_state(
    state: SnippingShortcutManagerState,
) -> Result<SnippingSettingsStatus, String> {
    let root = diffforge_prepare_untracked_asset_root()?;
    Ok(SnippingSettingsStatus {
        enabled: state.enabled,
        hide_desktop_icons: state.hide_desktop_icons,
        upload_public: state.upload_public,
        full_screenshot: snipping_shortcut_registration_status(
            SnippingShortcutAction::FullScreenshot,
            state.full_screenshot,
        ),
        area_snip: snipping_shortcut_registration_status(
            SnippingShortcutAction::AreaSnip,
            state.area_snip,
        ),
        area_recording: snipping_shortcut_registration_status(
            SnippingShortcutAction::AreaRecording,
            state.area_recording,
        ),
        permissions: snipping_permission_status(),
        untracked_root: root.display().to_string(),
    })
}

fn snipping_status_for(app: &AppHandle) -> Result<SnippingSettingsStatus, String> {
    let manager = app.state::<SnippingState>().shortcut_manager.clone();
    snipping_status_from_state(manager.snapshot())
}

fn emit_snipping_shortcuts_changed(app: &AppHandle) {
    if let Ok(status) = snipping_status_for(app) {
        let _ = app.emit(SNIPPING_SHORTCUTS_CHANGED_EVENT, status);
    }
}

fn snipping_reason_is_hotkey(reason: &str) -> bool {
    matches!(reason, "shortcut" | "macos-default-override")
}

fn snipping_error_is_screen_capture_permission(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    lower.contains("screen capture permission")
        || lower.contains("screen recording")
        || lower.contains("permission was not granted")
}

fn focus_main_window_for_snipping_permission(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn emit_snipping_permission_attention(
    app: &AppHandle,
    reason: &str,
    shortcut: &str,
    error: &str,
) {
    if !snipping_reason_is_hotkey(reason) || !snipping_error_is_screen_capture_permission(error) {
        return;
    }

    focus_main_window_for_snipping_permission(app);
    emit_snipping_shortcuts_changed(app);
    let _ = app.emit_to(
        "main",
        SNIPPING_PERMISSION_ATTENTION_EVENT,
        json!({
            "id": current_time_ms(),
            "reason": reason,
            "shortcut": shortcut,
            "message": error,
        }),
    );
}

fn emit_snipping_capture_attention(app: &AppHandle, reason: &str, shortcut: &str, error: &str) {
    if !snipping_reason_is_hotkey(reason) {
        return;
    }

    focus_main_window_for_snipping_permission(app);
    emit_snipping_shortcuts_changed(app);
    let _ = app.emit_to(
        "main",
        SNIPPING_CAPTURE_ATTENTION_EVENT,
        json!({
            "id": current_time_ms(),
            "reason": reason,
            "shortcut": shortcut,
            "message": error,
        }),
    );
}

fn emit_snipping_hotkey_failure_attention(
    app: &AppHandle,
    reason: &str,
    shortcut: &str,
    error: &str,
) {
    if snipping_error_is_screen_capture_permission(error) {
        emit_snipping_permission_attention(app, reason, shortcut, error);
    } else {
        emit_snipping_capture_attention(app, reason, shortcut, error);
    }
}

fn register_snipping_shortcut_handler(
    app: &AppHandle,
    action: SnippingShortcutAction,
    shortcut_text: &str,
) -> Result<(), String> {
    let shortcut = parse_snipping_shortcut(shortcut_text)?;

    app.global_shortcut()
        .on_shortcut(shortcut, move |app, shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }

            let shortcut_text = shortcut.into_string();
            let app_handle = app.clone();
            match action {
                SnippingShortcutAction::FullScreenshot => {
                    thread::spawn(move || {
                        let result =
                            snipping_capture_full_for(&app_handle, "shortcut", shortcut_text.clone());
                        if let Err(error) = result {
                            emit_snipping_hotkey_failure_attention(
                                &app_handle,
                                "shortcut",
                                &shortcut_text,
                                &error,
                            );
                        }
                    });
                }
                SnippingShortcutAction::AreaSnip => {
                    // Capture + overlay prep must never block the shortcut
                    // dispatch thread, or the overlay appears with a visible lag.
                    thread::spawn(move || {
                        let result =
                            snipping_begin_area_snip_for(&app_handle, "shortcut", shortcut_text.clone());
                        if let Err(error) = result {
                            emit_snipping_hotkey_failure_attention(
                                &app_handle,
                                "shortcut",
                                &shortcut_text,
                                &error,
                            );
                        }
                    });
                }
                SnippingShortcutAction::AreaRecording => {
                    thread::spawn(move || {
                        let result = snipping_toggle_area_recording_shortcut_for(
                            &app_handle,
                            "shortcut",
                            shortcut_text.clone(),
                        );
                        if let Err(error) = result {
                            emit_snipping_hotkey_failure_attention(
                                &app_handle,
                                "shortcut",
                                &shortcut_text,
                                &error,
                            );
                        }
                    });
                }
            }
        })
        .map_err(|error| format!("Unable to register {} shortcut: {error}", action.label()))
}

fn unregister_snipping_shortcut(app: &AppHandle, shortcut_text: &str) {
    if let Ok(shortcut) = parse_snipping_shortcut(shortcut_text) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

#[cfg(target_os = "macos")]
fn snipping_is_macos_default_shortcut(action: SnippingShortcutAction, shortcut_text: &str) -> bool {
    snipping_shortcuts_conflict(shortcut_text, &action.default_shortcut())
}

#[cfg(target_os = "macos")]
fn snipping_set_macos_event_tap_app(app: &AppHandle) {
    let cell = SNIPPING_MACOS_EVENT_TAP_APP.get_or_init(|| StdMutex::new(None));
    if let Ok(mut guard) = cell.lock() {
        *guard = Some(app.clone());
    }
}

#[cfg(target_os = "macos")]
fn snipping_macos_event_tap_app() -> Option<AppHandle> {
    SNIPPING_MACOS_EVENT_TAP_APP
        .get()
        .and_then(|cell| cell.lock().ok().and_then(|guard| guard.clone()))
}

#[cfg(target_os = "macos")]
fn snipping_macos_reenable_event_tap(reason: &'static str) -> bool {
    let tap = SNIPPING_MACOS_EVENT_TAP_HANDLE.load(Ordering::Acquire);
    if tap == 0 {
        log_terminal_status_event(
            "backend.snipping.macos_event_tap.reenable_missing",
            json!({ "reason": reason }),
        );
        return false;
    }

    unsafe {
        CGEventTapEnable(tap as *mut std::ffi::c_void, true);
    }
    log_terminal_status_event(
        "backend.snipping.macos_event_tap.reenabled",
        json!({ "reason": reason }),
    );
    true
}

#[cfg(target_os = "macos")]
fn snipping_macos_default_action_for_key(
    app: &AppHandle,
    keycode: i64,
) -> Option<SnippingShortcutAction> {
    let state = app.state::<SnippingState>().shortcut_manager.snapshot();
    if !state.enabled {
        return None;
    }

    if keycode == SNIPPING_MACOS_KEY_3
        && snipping_is_macos_default_shortcut(
            SnippingShortcutAction::FullScreenshot,
            &state.full_screenshot.shortcut,
        )
    {
        return Some(SnippingShortcutAction::FullScreenshot);
    }

    if keycode == SNIPPING_MACOS_KEY_4
        && snipping_is_macos_default_shortcut(
            SnippingShortcutAction::AreaSnip,
            &state.area_snip.shortcut,
        )
    {
        return Some(SnippingShortcutAction::AreaSnip);
    }

    if keycode == SNIPPING_MACOS_KEY_5
        && snipping_is_macos_default_shortcut(
            SnippingShortcutAction::AreaRecording,
            &state.area_recording.shortcut,
        )
    {
        return Some(SnippingShortcutAction::AreaRecording);
    }

    None
}

#[cfg(target_os = "macos")]
extern "C" fn snipping_macos_event_tap_callback(
    _proxy: *mut std::ffi::c_void,
    event_type: u32,
    event: *mut std::ffi::c_void,
    _user_info: *mut std::ffi::c_void,
) -> *mut std::ffi::c_void {
    if event_type == SNIPPING_MACOS_CG_EVENT_TAP_DISABLED_BY_TIMEOUT {
        let _ = snipping_macos_reenable_event_tap("disabled_by_timeout");
        return event;
    }
    if event_type == SNIPPING_MACOS_CG_EVENT_TAP_DISABLED_BY_USER_INPUT {
        let _ = snipping_macos_reenable_event_tap("disabled_by_user_input");
        return event;
    }

    if event_type != SNIPPING_MACOS_CG_EVENT_KEY_DOWN || event.is_null() {
        return event;
    }

    let flags = unsafe { CGEventGetFlags(event) };
    let required = SNIPPING_MACOS_FLAG_COMMAND | SNIPPING_MACOS_FLAG_SHIFT;
    let blocked = SNIPPING_MACOS_FLAG_CONTROL | SNIPPING_MACOS_FLAG_OPTION;
    if flags & required != required || flags & blocked != 0 {
        return event;
    }

    let keycode =
        unsafe { CGEventGetIntegerValueField(event, SNIPPING_MACOS_CG_KEYBOARD_EVENT_KEYCODE) };
    let Some(app) = snipping_macos_event_tap_app() else {
        return event;
    };
    let Some(action) = snipping_macos_default_action_for_key(&app, keycode) else {
        return event;
    };

    let is_autorepeat =
        unsafe { CGEventGetIntegerValueField(event, SNIPPING_MACOS_KEYBOARD_EVENT_AUTOREPEAT) } != 0;
    if is_autorepeat {
        log_terminal_status_event(
            "backend.snipping.macos_default_shortcut.autorepeat_ignored",
            json!({
                "action": action.label(),
            }),
        );
        return std::ptr::null_mut();
    }

    thread::spawn(move || {
        let shortcut_text = action.default_shortcut();
        let result = match action {
            SnippingShortcutAction::FullScreenshot => snipping_capture_full_for(
                &app,
                "macos-default-override",
                shortcut_text.clone(),
            ),
            SnippingShortcutAction::AreaSnip => snipping_begin_area_snip_for(
                &app,
                "macos-default-override",
                shortcut_text.clone(),
            ),
            SnippingShortcutAction::AreaRecording => snipping_toggle_area_recording_shortcut_for(
                &app,
                "macos-default-override",
                shortcut_text.clone(),
            ),
        };
        if let Err(error) = result {
            log_terminal_status_event(
                "backend.snipping.macos_default_shortcut.error",
                json!({
                    "action": action.label(),
                    "error": error,
                }),
            );
            emit_snipping_hotkey_failure_attention(
                &app,
                "macos-default-override",
                &shortcut_text,
                &error,
            );
        }
    });

    std::ptr::null_mut()
}

#[cfg(target_os = "macos")]
fn register_snipping_macos_event_tap(app: &AppHandle) -> Result<(), String> {
    snipping_set_macos_event_tap_app(app);

    if SNIPPING_MACOS_EVENT_TAP_STARTED.load(Ordering::SeqCst) {
        let _ = snipping_macos_reenable_event_tap("registration_check");
        return Ok(());
    }

    if !macos_accessibility_permission_granted() {
        return Err(
            "macOS screenshot shortcut override needs Accessibility permission for Diff Forge AI."
                .to_string(),
        );
    }

    let (sender, receiver) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let event_mask = 1_u64 << SNIPPING_MACOS_CG_EVENT_KEY_DOWN;
        let tap = unsafe {
            CGEventTapCreate(
                SNIPPING_MACOS_CG_HID_EVENT_TAP,
                SNIPPING_MACOS_CG_HEAD_INSERT_EVENT_TAP,
                SNIPPING_MACOS_CG_EVENT_TAP_OPTION_DEFAULT,
                event_mask,
                snipping_macos_event_tap_callback,
                std::ptr::null_mut(),
            )
        };

        if tap.is_null() {
            let _ = sender.send(false);
            return;
        }
        SNIPPING_MACOS_EVENT_TAP_HANDLE.store(tap as usize, Ordering::Release);

        let source = unsafe { CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0) };
        if source.is_null() {
            SNIPPING_MACOS_EVENT_TAP_HANDLE.store(0, Ordering::Release);
            let _ = sender.send(false);
            return;
        }

        unsafe {
            CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
            CGEventTapEnable(tap, true);
        }

        SNIPPING_MACOS_EVENT_TAP_STARTED.store(true, Ordering::SeqCst);
        let _ = sender.send(true);

        unsafe {
            CFRunLoopRun();
        }
    });

    match receiver.recv_timeout(Duration::from_millis(900)) {
        Ok(true) => Ok(()),
        Ok(false) => Err("Unable to install macOS screenshot shortcut override.".to_string()),
        Err(_) => Err("Timed out installing macOS screenshot shortcut override.".to_string()),
    }
}

#[cfg(not(target_os = "macos"))]
fn snipping_is_macos_default_shortcut(
    _action: SnippingShortcutAction,
    _shortcut_text: &str,
) -> bool {
    false
}

fn register_snipping_shortcut_registration(
    app: &AppHandle,
    action: SnippingShortcutAction,
    shortcut: String,
) -> SnippingShortcutRegistration {
    #[cfg(target_os = "macos")]
    if snipping_is_macos_default_shortcut(action, &shortcut) {
        return match register_snipping_macos_event_tap(app) {
            Ok(()) => SnippingShortcutRegistration {
                shortcut,
                registered: true,
                error: None,
            },
            Err(error) => SnippingShortcutRegistration {
                shortcut,
                registered: false,
                error: Some(error),
            },
        };
    }

    match register_snipping_shortcut_handler(app, action, &shortcut) {
        Ok(()) => SnippingShortcutRegistration {
            shortcut,
            registered: true,
            error: None,
        },
        Err(error) => SnippingShortcutRegistration {
            shortcut,
            registered: false,
            error: Some(error),
        },
    }
}

fn register_snipping_shortcuts(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    register_snipping_space_change_observer(app);
    snipping_restore_desktop_icons_from_marker_on_startup(app);
    let settings = read_snipping_settings(app);
    let mut state = SnippingShortcutManagerState::from_settings(&settings);

    if settings.enabled {
        state.full_screenshot = register_snipping_shortcut_registration(
            app,
            SnippingShortcutAction::FullScreenshot,
            settings.full_screenshot,
        );
        state.area_snip = register_snipping_shortcut_registration(
            app,
            SnippingShortcutAction::AreaSnip,
            settings.area_snip,
        );
        state.area_recording = register_snipping_shortcut_registration(
            app,
            SnippingShortcutAction::AreaRecording,
            settings.area_recording,
        );
    }

    app.state::<SnippingState>().shortcut_manager.replace(state);
    if settings.enabled && SNIPPING_STARTUP_PREWARM_ENABLED {
        prewarm_snipping_overlay_window(app);
        snipping_warm_preview_pool(app);
        snipping_start_warm_capture_if_ready(app);
    }
    if settings.enabled {
        snipping_prewarm_capture_session(app);
    }
    emit_snipping_shortcuts_changed(app);
}

fn unregister_snipping_shortcuts_for_state(app: &AppHandle, state: &SnippingShortcutManagerState) {
    unregister_snipping_shortcut(app, &state.full_screenshot.shortcut);
    unregister_snipping_shortcut(app, &state.area_snip.shortcut);
    unregister_snipping_shortcut(app, &state.area_recording.shortcut);
}

fn set_snipping_enabled_for(
    app: &AppHandle,
    request: SnippingEnabledUpdateRequest,
) -> Result<SnippingSettingsStatus, String> {
    let manager = app.state::<SnippingState>().shortcut_manager.clone();
    let state = manager.snapshot();

    unregister_snipping_shortcuts_for_state(app, &state);

    let settings = SnippingSettings {
        enabled: request.enabled,
        hide_desktop_icons: state.hide_desktop_icons,
        upload_public: state.upload_public,
        full_screenshot: state.full_screenshot.shortcut.clone(),
        area_snip: state.area_snip.shortcut.clone(),
        area_recording: state.area_recording.shortcut.clone(),
    };
    write_snipping_settings(app, &settings)?;

    let mut next_state = SnippingShortcutManagerState::from_settings(&settings);
    next_state.set_enabled(request.enabled);
    if request.enabled {
        next_state.full_screenshot = register_snipping_shortcut_registration(
            app,
            SnippingShortcutAction::FullScreenshot,
            settings.full_screenshot,
        );
        next_state.area_snip = register_snipping_shortcut_registration(
            app,
            SnippingShortcutAction::AreaSnip,
            settings.area_snip,
        );
        next_state.area_recording = register_snipping_shortcut_registration(
            app,
            SnippingShortcutAction::AreaRecording,
            settings.area_recording,
        );
        if SNIPPING_STARTUP_PREWARM_ENABLED {
            prewarm_snipping_overlay_window(app);
            snipping_warm_preview_pool(app);
        }
    } else {
        let _ = snipping_stop_recording_for(app, "snipping-disabled");
        snipping_stop_warm_capture(app);
        snipping_clear_area_sessions(app)?;
        snipping_hide_area_overlay(app);
        snipping_close_area_overlay(app);
    }

    manager.replace(next_state);
    if request.enabled && SNIPPING_STARTUP_PREWARM_ENABLED {
        snipping_start_warm_capture_if_ready(app);
    }
    if request.enabled {
        snipping_prewarm_capture_session(app);
    }
    emit_snipping_shortcuts_changed(app);
    snipping_status_for(app)
}

fn set_snipping_hide_desktop_icons_for(
    app: &AppHandle,
    request: SnippingHideDesktopIconsRequest,
) -> Result<SnippingSettingsStatus, String> {
    let manager = app.state::<SnippingState>().shortcut_manager.clone();
    let mut state = manager.snapshot();
    state.hide_desktop_icons = request.enabled;

    write_snipping_settings(app, &state.settings())?;
    manager.replace(state);
    if !request.enabled {
        // Never leave icons hidden when the user turns the feature off
        // mid-capture.
        snipping_restore_desktop_icons_after_capture(app);
    }
    emit_snipping_shortcuts_changed(app);
    snipping_status_for(app)
}

fn set_snipping_upload_public_for(
    app: &AppHandle,
    request: SnippingUploadPublicRequest,
) -> Result<SnippingSettingsStatus, String> {
    let manager = app.state::<SnippingState>().shortcut_manager.clone();
    let mut state = manager.snapshot();
    state.upload_public = request.enabled;

    write_snipping_settings(app, &state.settings())?;
    manager.replace(state);
    emit_snipping_shortcuts_changed(app);
    snipping_status_for(app)
}

fn snipping_upload_public_enabled(app: &AppHandle) -> bool {
    app.state::<SnippingState>()
        .shortcut_manager
        .snapshot()
        .upload_public
}

fn set_snipping_shortcut_for(
    app: &AppHandle,
    request: SnippingShortcutUpdateRequest,
) -> Result<SnippingSettingsStatus, String> {
    let action = SnippingShortcutAction::from_request(&request.action)?;
    let next_shortcut = normalize_snipping_shortcut_text(&request.shortcut)?;
    validate_snipping_shortcut_for_action(action, &next_shortcut)?;
    let manager = app.state::<SnippingState>().shortcut_manager.clone();
    let state = manager.snapshot();
    let previous = state.registration(action);
    for other_action in [
        SnippingShortcutAction::FullScreenshot,
        SnippingShortcutAction::AreaSnip,
        SnippingShortcutAction::AreaRecording,
    ] {
        if other_action == action {
            continue;
        }
        let other = state.registration(other_action);
        if snipping_shortcuts_conflict(&next_shortcut, &other.shortcut) {
            return Err(
                "Full screenshot, area snip, and area recording need different shortcuts."
                    .to_string(),
            );
        }
    }

    if snipping_shortcuts_conflict(&next_shortcut, &previous.shortcut) {
        return snipping_status_for(app);
    }

    if !state.enabled {
        manager.set_registration(action, SnippingShortcutRegistration::new(next_shortcut));
        let settings = manager.snapshot().settings();
        write_snipping_settings(app, &settings)?;
        emit_snipping_shortcuts_changed(app);
        return snipping_status_for(app);
    }

    unregister_snipping_shortcut(app, &previous.shortcut);

    let next_registration =
        register_snipping_shortcut_registration(app, action, next_shortcut.clone());
    if !next_registration.registered {
        if previous.registered {
            let restored = register_snipping_shortcut_registration(app, action, previous.shortcut);
            manager.set_registration(action, restored);
        }
        return Err(next_registration
            .error
            .unwrap_or_else(|| format!("Unable to register {} shortcut.", action.label())));
    }

    manager.set_registration(action, next_registration);

    let settings = manager.snapshot().settings();
    write_snipping_settings(app, &settings)?;
    emit_snipping_shortcuts_changed(app);
    snipping_status_for(app)
}

fn reset_snipping_shortcuts_for(app: &AppHandle) -> Result<SnippingSettingsStatus, String> {
    let manager = app.state::<SnippingState>().shortcut_manager.clone();
    let state = manager.snapshot();

    unregister_snipping_shortcuts_for_state(app, &state);

    let settings = SnippingSettings {
        enabled: state.enabled,
        hide_desktop_icons: state.hide_desktop_icons,
        upload_public: state.upload_public,
        ..default_snipping_settings()
    };
    write_snipping_settings(app, &settings)?;

    let mut next_state = SnippingShortcutManagerState::from_settings(&settings);
    if settings.enabled {
        next_state.full_screenshot = register_snipping_shortcut_registration(
            app,
            SnippingShortcutAction::FullScreenshot,
            settings.full_screenshot,
        );
        next_state.area_snip = register_snipping_shortcut_registration(
            app,
            SnippingShortcutAction::AreaSnip,
            settings.area_snip,
        );
        next_state.area_recording = register_snipping_shortcut_registration(
            app,
            SnippingShortcutAction::AreaRecording,
            settings.area_recording,
        );
    }
    manager.replace(next_state);

    emit_snipping_shortcuts_changed(app);
    snipping_status_for(app)
}

fn snipping_tauri_monitors_match(left: &tauri::Monitor, right: &tauri::Monitor) -> bool {
    left.name() == right.name()
        && left.position() == right.position()
        && left.size() == right.size()
        && (left.scale_factor() - right.scale_factor()).abs() < f64::EPSILON
}

fn snipping_area_monitor_from_tauri_monitor_with_primary(
    monitor: &tauri::Monitor,
    primary: bool,
) -> SnippingAreaMonitor {
    let position = monitor.position();
    let size = monitor.size();
    let scale_factor = monitor.scale_factor().max(0.1);
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let (capture_x, capture_y, capture_width, capture_height) = (
        (f64::from(position.x) / scale_factor).round() as i32,
        (f64::from(position.y) / scale_factor).round() as i32,
        (f64::from(size.width) / scale_factor).round().max(1.0) as u32,
        (f64::from(size.height) / scale_factor).round().max(1.0) as u32,
    );
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let (capture_x, capture_y, capture_width, capture_height) =
        (position.x, position.y, size.width, size.height);

    SnippingAreaMonitor {
        name: monitor.name().cloned(),
        primary,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        scale_factor,
        capture_x,
        capture_y,
        capture_width,
        capture_height,
        snapshot_path: None,
        snapshot_width: 0,
        snapshot_height: 0,
    }
}

fn snipping_area_monitor_from_tauri_monitor(monitor: &tauri::Monitor) -> SnippingAreaMonitor {
    snipping_area_monitor_from_tauri_monitor_with_primary(monitor, false)
}

fn snipping_current_area_monitor(app: &AppHandle) -> Result<SnippingAreaMonitor, String> {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = window.current_monitor() {
            return Ok(snipping_area_monitor_from_tauri_monitor(&monitor));
        }
    }

    if let Ok(Some(monitor)) = app.primary_monitor() {
        return Ok(snipping_area_monitor_from_tauri_monitor_with_primary(
            &monitor, true,
        ));
    }

    app.available_monitors()
        .ok()
        .and_then(|mut monitors| monitors.drain(..).next())
        .map(|monitor| snipping_area_monitor_from_tauri_monitor(&monitor))
        .ok_or_else(|| "No monitor is available for snipping.".to_string())
}

/// Every connected display, one entry per future overlay window — area snips
/// cover all screens at once the way the native screenshot UI does.
fn snipping_area_monitors(app: &AppHandle) -> Result<Vec<SnippingAreaMonitor>, String> {
    let monitors = app
        .available_monitors()
        .map_err(|error| format!("Unable to list monitors: {error}"))?;
    let primary_monitor = app.primary_monitor().ok().flatten();
    let mapped: Vec<SnippingAreaMonitor> = monitors
        .iter()
        .map(|monitor| {
            let primary = primary_monitor
                .as_ref()
                .is_some_and(|primary| snipping_tauri_monitors_match(monitor, primary));
            snipping_area_monitor_from_tauri_monitor_with_primary(monitor, primary)
        })
        .collect();
    if mapped.is_empty() {
        return Err("No monitor is available for snipping.".to_string());
    }
    Ok(mapped)
}

fn snipping_overlay_label(index: usize) -> String {
    format!("{SNIPPING_AREA_OVERLAY_WINDOW_PREFIX}-{index}")
}

fn snipping_is_overlay_label(label: &str) -> bool {
    label.starts_with(SNIPPING_AREA_OVERLAY_WINDOW_PREFIX)
}

fn snipping_mark_area_overlay_ready(app: &AppHandle, label: &str) {
    if !snipping_is_overlay_label(label) {
        return;
    }
    if let Ok(mut labels) = app.state::<SnippingState>().area_overlay_ready_labels.lock() {
        labels.insert(label.to_string());
    }
}

fn snipping_forget_area_overlay_ready(app: &AppHandle, label: &str) {
    if let Ok(mut labels) = app.state::<SnippingState>().area_overlay_ready_labels.lock() {
        labels.remove(label);
    }
}

fn snipping_area_overlay_is_ready(app: &AppHandle, label: &str) -> bool {
    app.state::<SnippingState>()
        .area_overlay_ready_labels
        .lock()
        .map(|labels| labels.contains(label))
        .unwrap_or(false)
}

fn snipping_wait_for_area_overlay_ready(app: &AppHandle, label: &str) {
    if snipping_area_overlay_is_ready(app, label) {
        return;
    }

    let started_at = Instant::now();
    while started_at.elapsed() < Duration::from_millis(SNIPPING_AREA_OVERLAY_READY_WAIT_MS) {
        if snipping_area_overlay_is_ready(app, label) {
            return;
        }
        thread::sleep(Duration::from_millis(SNIPPING_AREA_OVERLAY_READY_POLL_MS));
    }
}

fn snipping_overlay_windows(app: &AppHandle) -> Vec<(String, tauri::WebviewWindow)> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| snipping_is_overlay_label(label))
        .collect()
}

fn snipping_monitor_for_full(app: &AppHandle) -> Result<SnippingAreaMonitor, String> {
    if let Ok(cursor) = app.cursor_position() {
        if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
            return Ok(snipping_area_monitor_from_tauri_monitor(&monitor));
        }
    }

    snipping_current_area_monitor(app)
        .map_err(|_| "No monitor is available for screenshot capture.".to_string())
}

fn snipping_overlay_snapshot_path() -> Result<PathBuf, String> {
    let root = diffforge_prepare_untracked_asset_root()?;
    let tmp_dir = root.join(".tmp");
    fs::create_dir_all(&tmp_dir).map_err(|error| {
        format!(
            "Unable to create snipping temp directory {}: {error}",
            tmp_dir.display()
        )
    })?;
    Ok(tmp_dir.join(format!(
        ".snipping-overlay-{}-{}.jpg",
        cloud_mcp_now_ms(),
        uuid::Uuid::new_v4()
    )))
}

fn snipping_remove_snapshot_file(path: Option<&str>) {
    let Some(path) = path.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    let _ = fs::remove_file(path);
}

fn snipping_crop_snapshot_image(
    image: &image::RgbaImage,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<image::RgbaImage, String> {
    let image_width = image.width().max(1);
    let image_height = image.height().max(1);
    let crop_x = x.min(image_width.saturating_sub(1));
    let crop_y = y.min(image_height.saturating_sub(1));
    let crop_width = width.min(image_width.saturating_sub(crop_x)).max(1);
    let crop_height = height.min(image_height.saturating_sub(crop_y)).max(1);
    Ok(image::imageops::crop_imm(image, crop_x, crop_y, crop_width, crop_height).to_image())
}

fn snipping_crop_area_preview_snapshot(
    area_monitor: &SnippingAreaMonitor,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<image::RgbaImage, String> {
    let snapshot_path = area_monitor
        .snapshot_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "No frozen snip snapshot is available.".to_string())?;
    let image = image::open(snapshot_path)
        .map_err(|error| format!("Unable to read frozen snip snapshot {snapshot_path}: {error}"))?
        .to_rgba8();
    snipping_crop_snapshot_image(&image, x, y, width, height)
}

fn snipping_warm_capture_key(monitor: &SnippingAreaMonitor) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{:.3}",
        monitor.name.as_deref().unwrap_or(""),
        monitor.x,
        monitor.y,
        monitor.width,
        monitor.height,
        monitor.capture_width,
        monitor.capture_height,
        monitor.scale_factor
    )
}

fn snipping_scap_video_frame_dimensions(frame: &scap::frame::VideoFrame) -> (i32, i32) {
    match frame {
        scap::frame::VideoFrame::BGRA(frame) => (frame.width, frame.height),
        scap::frame::VideoFrame::BGR0(frame) => (frame.width, frame.height),
        scap::frame::VideoFrame::BGRx(frame) => (frame.width, frame.height),
        scap::frame::VideoFrame::RGBx(frame) => (frame.width, frame.height),
        scap::frame::VideoFrame::XBGR(frame) => (frame.width, frame.height),
        scap::frame::VideoFrame::RGB(frame) => (frame.width, frame.height),
        scap::frame::VideoFrame::YUVFrame(frame) => (frame.width, frame.height),
    }
}

fn snipping_warm_capture_has_fresh_frames_for(
    state: &SnippingWarmCaptureState,
    monitors: &[SnippingAreaMonitor],
) -> bool {
    let now = current_time_ms();
    state
        .frames
        .lock()
        .map(|frames| {
            !monitors.is_empty()
                && monitors.iter().all(|monitor| {
                    let key = snipping_warm_capture_key(monitor);
                    frames.get(&key).is_some_and(|frame| {
                        frame.width > 0
                            && frame.height > 0
                            && now.saturating_sub(frame.captured_at_ms)
                                <= SNIPPING_WARM_CAPTURE_FRAME_MAX_AGE_MS
                    })
                })
            })
        .unwrap_or(false)
}

fn snipping_warm_capture_frame_for_monitor(
    app: &AppHandle,
    monitor: &SnippingAreaMonitor,
    min_captured_at_ms: u64,
) -> Option<image::RgbaImage> {
    if !SNIPPING_WARM_CAPTURE_ENABLED {
        return None;
    }

    let state = app.state::<SnippingState>().warm_capture.clone();
    let key = snipping_warm_capture_key(monitor);
    let now = current_time_ms();
    let warm_frame = state
        .frames
        .lock()
        .ok()
        .and_then(|frames| frames.get(&key).cloned())?;
    if warm_frame.width <= 0
        || warm_frame.height <= 0
        || warm_frame.captured_at_ms < min_captured_at_ms
        || now.saturating_sub(warm_frame.captured_at_ms) > SNIPPING_WARM_CAPTURE_FRAME_MAX_AGE_MS
    {
        snipping_start_warm_capture_if_ready(app);
        return None;
    }

    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        snipping_scap_video_frame_to_rgba((*warm_frame.frame).clone())
    }))
    .ok()
    .and_then(Result::ok)
}

fn snipping_store_warm_capture_frame(
    state: &SnippingWarmCaptureState,
    generation: u64,
    key: &str,
    frame: scap::frame::VideoFrame,
) {
    if state.generation.load(Ordering::Acquire) != generation {
        return;
    }
    let (width, height) = snipping_scap_video_frame_dimensions(&frame);
    if width <= 0 || height <= 0 {
        return;
    }
    let warm_frame = SnippingWarmFrame {
        frame: Arc::new(frame),
        captured_at_ms: current_time_ms(),
        width,
        height,
    };
    if let Ok(mut frames) = state.frames.lock() {
        frames.insert(key.to_string(), warm_frame);
    }
}

fn snipping_warm_capture_loop(
    state: Arc<SnippingWarmCaptureState>,
    generation: u64,
    key: String,
    target: Option<scap::Target>,
) {
    let options = scap::capturer::Options {
        fps: SNIPPING_SCAP_WARM_CAPTURE_FPS,
        show_cursor: false,
        show_highlight: false,
        target,
        crop_area: None,
        output_type: scap::frame::FrameType::BGRAFrame,
        output_resolution: scap::capturer::Resolution::Captured,
        excluded_targets: None,
        captures_audio: false,
        exclude_current_process_audio: true,
    };
    let Ok(mut capturer) = scap::capturer::Capturer::build(options) else {
        return;
    };
    capturer.start_capture();

    while state.generation.load(Ordering::Acquire) == generation {
        let frame = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            capturer.get_next_frame()
        }));
        match frame {
            Ok(Ok(scap::frame::Frame::Video(frame))) => {
                snipping_store_warm_capture_frame(&state, generation, &key, frame);
            }
            Ok(Ok(scap::frame::Frame::Audio(_))) => {}
            Ok(Err(_)) | Err(_) => break,
        }
    }

    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        capturer.stop_capture();
    }));
}

fn snipping_start_warm_capture_if_ready(app: &AppHandle) {
    if !SNIPPING_WARM_CAPTURE_ENABLED {
        return;
    }

    if !app
        .state::<SnippingState>()
        .shortcut_manager
        .snapshot()
        .enabled
    {
        return;
    }

    let supported = std::panic::catch_unwind(scap::is_supported).unwrap_or(false);
    let has_permission = std::panic::catch_unwind(scap::has_permission).unwrap_or(false);
    if !supported || !has_permission {
        return;
    }

    let state = app.state::<SnippingState>().warm_capture.clone();
    let Ok(monitors) = snipping_area_monitors(app) else {
        return;
    };
    if snipping_warm_capture_has_fresh_frames_for(&state, &monitors) {
        return;
    }

    let now = current_time_ms();
    let previous_start = state.last_start_ms.load(Ordering::Acquire);
    if now.saturating_sub(previous_start) < SNIPPING_WARM_CAPTURE_RESTART_MIN_MS {
        return;
    }
    if state
        .last_start_ms
        .compare_exchange(previous_start, now, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }
    if state.starting.swap(true, Ordering::AcqRel) {
        return;
    }

    let state_for_start = state.clone();
    thread::spawn(move || {
        let state = state_for_start;
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let generation = state.generation.fetch_add(1, Ordering::AcqRel) + 1;
            if let Ok(mut frames) = state.frames.lock() {
                frames.clear();
            }

            for monitor in monitors {
                let key = snipping_warm_capture_key(&monitor);
                let target = snipping_scap_display_target_for_area_monitor(&monitor);
                let state_for_thread = state.clone();
                thread::spawn(move || {
                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        snipping_warm_capture_loop(state_for_thread, generation, key, target);
                    }));
                });
            }

            Ok::<(), String>(())
        }));
        state.starting.store(false, Ordering::Release);
        if !matches!(result, Ok(Ok(()))) {
            state.last_start_ms.store(current_time_ms(), Ordering::Release);
        }
    });
}

fn snipping_stop_warm_capture(app: &AppHandle) {
    let state = app.state::<SnippingState>().warm_capture.clone();
    state.generation.fetch_add(1, Ordering::AcqRel);
    state.starting.store(false, Ordering::Release);
    state.last_start_ms.store(0, Ordering::Release);
    if let Ok(mut frames) = state.frames.lock() {
        frames.clear();
    };
}

fn snipping_scap_display_targets() -> Vec<scap::Target> {
    let (sender, receiver) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let targets = std::panic::catch_unwind(scap::get_all_targets).unwrap_or_default();
        let _ = sender.send(targets);
    });
    receiver
        .recv_timeout(Duration::from_millis(SNIPPING_SCAP_TARGET_SIZE_TIMEOUT_MS))
        .unwrap_or_default()
        .into_iter()
        .filter(|target| matches!(target, scap::Target::Display(_)))
        .collect()
}

#[cfg(not(target_os = "linux"))]
fn snipping_scap_main_display_target() -> Option<scap::Target> {
    let (sender, receiver) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let target = std::panic::catch_unwind(scap::get_main_display)
            .ok()
            .map(scap::Target::Display);
        let _ = sender.send(target);
    });
    receiver
        .recv_timeout(Duration::from_millis(SNIPPING_SCAP_TARGET_SIZE_TIMEOUT_MS))
        .ok()
        .flatten()
}

#[cfg(target_os = "linux")]
fn snipping_scap_main_display_target() -> Option<scap::Target> {
    None
}

fn snipping_scap_display_target_output_size(target: &scap::Target) -> Option<(u32, u32)> {
    let target = target.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let options = scap::capturer::Options {
            fps: SNIPPING_SCAP_CAPTURE_FPS,
            show_cursor: false,
            show_highlight: false,
            target: Some(target),
            crop_area: None,
            output_type: scap::frame::FrameType::BGRAFrame,
            output_resolution: scap::capturer::Resolution::Captured,
            excluded_targets: None,
            captures_audio: false,
            exclude_current_process_audio: true,
        };
        let result = std::panic::catch_unwind(|| {
            let [width, height] = scap::capturer::get_output_frame_size(&options);
            (width > 0 && height > 0).then_some((width, height))
        })
        .ok()
        .flatten();
        let _ = sender.send(result);
    });
    receiver
        .recv_timeout(Duration::from_millis(SNIPPING_SCAP_TARGET_SIZE_TIMEOUT_MS))
        .ok()
        .flatten()
}

fn snipping_scap_display_target_for_area_monitor(
    monitor: &SnippingAreaMonitor,
) -> Option<scap::Target> {
    let display_targets = snipping_scap_display_targets();
    if display_targets.is_empty() {
        return snipping_scap_main_display_target();
    }

    if let Some(monitor_name) = monitor
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_lowercase)
    {
        if let Some(target) = display_targets.iter().find(|target| match target {
            scap::Target::Display(display) => {
                let title = display.title.trim().to_lowercase();
                !title.is_empty() && title == monitor_name
            }
            scap::Target::Window(_) => false,
        }) {
            return Some(target.clone());
        }
    }

    if let Some(target) = display_targets.iter().find(|target| {
        snipping_scap_display_target_output_size(target).is_some_and(|(width, height)| {
            (width == monitor.width && height == monitor.height)
                || (width == monitor.height && height == monitor.width)
        })
    }) {
        return Some(target.clone());
    }

    if monitor.primary {
        if let Some(target) = snipping_scap_main_display_target() {
            return Some(target);
        }
    }

    display_targets.into_iter().next()
}

fn snipping_scap_capture_area(
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> scap::capturer::Area {
    scap::capturer::Area {
        origin: scap::capturer::Point {
            x: f64::from(x),
            y: f64::from(y),
        },
        size: scap::capturer::Size {
            width: f64::from(width.max(1)),
            height: f64::from(height.max(1)),
        },
    }
}

fn snipping_ensure_scap_ready() -> Result<(), String> {
    let supported = std::panic::catch_unwind(scap::is_supported).unwrap_or(false);
    if !supported {
        return Err("Screen capture is not supported on this system.".to_string());
    }

    let has_permission = std::panic::catch_unwind(scap::has_permission).unwrap_or(false);
    if has_permission {
        snipping_mark_screen_capture_confirmed();
        return Ok(());
    }

    let granted = std::panic::catch_unwind(scap::request_permission).unwrap_or(false);
    let has_permission = std::panic::catch_unwind(scap::has_permission).unwrap_or(false);
    if granted || has_permission {
        snipping_mark_screen_capture_confirmed();
        Ok(())
    } else {
        Err("Screen capture permission was not granted.".to_string())
    }
}

/// Build, start, grab one frame from, and release a scap capturer. The point is
/// the side effect: the first capture in a process makes macOS stand up its
/// screen-capture pipeline (a brief display flicker). Returns whether the
/// session was established.
#[cfg(target_os = "macos")]
fn snipping_prewarm_capture_session_blocking() -> bool {
    let supported = std::panic::catch_unwind(scap::is_supported).unwrap_or(false);
    if !supported {
        return false;
    }
    // Prefer a concrete display target like the real capture paths do; fall back
    // to the scap default if enumeration comes up empty.
    let target = snipping_scap_display_targets().into_iter().next();
    let established = snipping_scap_capture_image(target, None, "prewarming screen capture").is_ok();
    if established {
        snipping_mark_screen_capture_confirmed();
    }
    established
}

/// Warm the macOS screen-capture session once per process, deferred and off the
/// interactive path, so the user's first real area snip does not flash the
/// display. No continuous capture loop, so it adds no steady-state cost. No-op
/// off macOS, when snipping is disabled, or before capture access exists (this
/// never prompts).
fn snipping_prewarm_capture_session(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        if !app
            .state::<SnippingState>()
            .shortcut_manager
            .snapshot()
            .enabled
        {
            return;
        }
        if !macos_screen_capture_permission_granted() {
            return;
        }
        if SNIPPING_CAPTURE_SESSION_PREWARMED.swap(true, Ordering::AcqRel) {
            return;
        }
        thread::spawn(move || {
            // Let launch / the enable toggle settle first so the one-time flicker
            // lands during idle rather than under the user's hands.
            thread::sleep(Duration::from_millis(1_200));
            let established = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                snipping_prewarm_capture_session_blocking,
            ))
            .unwrap_or(false);
            if !established {
                // Allow a later trigger to retry if this one-shot did not land.
                SNIPPING_CAPTURE_SESSION_PREWARMED.store(false, Ordering::Release);
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

fn snipping_scap_frame_pixel_count(
    width: i32,
    height: i32,
    source: &str,
) -> Result<(u32, u32, usize), String> {
    if width <= 0 || height <= 0 {
        return Err(format!("{source} returned an empty frame."));
    }
    let width = width as u32;
    let height = height as u32;
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| format!("{source} returned a frame that is too large."))?;
    let pixels = usize::try_from(pixels)
        .map_err(|_| format!("{source} returned a frame that is too large."))?;
    Ok((width, height, pixels))
}

fn snipping_scap_image_from_four_channel_frame<F>(
    width: i32,
    height: i32,
    mut data: Vec<u8>,
    source: &str,
    mut write_pixel: F,
) -> Result<image::RgbaImage, String>
where
    F: FnMut(&mut [u8]),
{
    let (width, height, pixels) = snipping_scap_frame_pixel_count(width, height, source)?;
    let expected_len = pixels
        .checked_mul(4)
        .ok_or_else(|| format!("{source} returned a frame that is too large."))?;
    if data.len() < expected_len {
        return Err(format!("{source} returned incomplete frame data."));
    }
    data.truncate(expected_len);
    for pixel in data.chunks_exact_mut(4) {
        write_pixel(pixel);
    }
    image::RgbaImage::from_raw(width, height, data)
        .ok_or_else(|| format!("Unable to decode {source} frame."))
}

fn snipping_scap_image_from_rgb_frame(
    width: i32,
    height: i32,
    data: Vec<u8>,
) -> Result<image::RgbaImage, String> {
    let (width, height, pixels) = snipping_scap_frame_pixel_count(width, height, "scap RGB")?;
    let expected_len = pixels
        .checked_mul(3)
        .ok_or_else(|| "scap RGB returned a frame that is too large.".to_string())?;
    if data.len() < expected_len {
        return Err("scap RGB returned incomplete frame data.".to_string());
    }
    let mut rgba = Vec::with_capacity(pixels * 4);
    for pixel in data[..expected_len].chunks_exact(3) {
        rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
    }
    image::RgbaImage::from_raw(width, height, rgba)
        .ok_or_else(|| "Unable to decode scap RGB frame.".to_string())
}

fn snipping_scap_video_frame_to_rgba(
    frame: scap::frame::VideoFrame,
) -> Result<image::RgbaImage, String> {
    match frame {
        scap::frame::VideoFrame::BGRA(frame) => snipping_scap_image_from_four_channel_frame(
            frame.width,
            frame.height,
            frame.data,
            "scap BGRA",
            |pixel| pixel.swap(0, 2),
        ),
        scap::frame::VideoFrame::BGR0(frame) => snipping_scap_image_from_four_channel_frame(
            frame.width,
            frame.height,
            frame.data,
            "scap BGR0",
            |pixel| {
                pixel.swap(0, 2);
                pixel[3] = 255;
            },
        ),
        scap::frame::VideoFrame::BGRx(frame) => snipping_scap_image_from_four_channel_frame(
            frame.width,
            frame.height,
            frame.data,
            "scap BGRx",
            |pixel| {
                pixel.swap(0, 2);
                pixel[3] = 255;
            },
        ),
        scap::frame::VideoFrame::RGBx(frame) => snipping_scap_image_from_four_channel_frame(
            frame.width,
            frame.height,
            frame.data,
            "scap RGBx",
            |pixel| {
                pixel[3] = 255;
            },
        ),
        scap::frame::VideoFrame::XBGR(frame) => snipping_scap_image_from_four_channel_frame(
            frame.width,
            frame.height,
            frame.data,
            "scap XBGR",
            |pixel| {
                let red = pixel[3];
                let green = pixel[2];
                let blue = pixel[1];
                pixel[0] = red;
                pixel[1] = green;
                pixel[2] = blue;
                pixel[3] = 255;
            },
        ),
        scap::frame::VideoFrame::RGB(frame) => {
            snipping_scap_image_from_rgb_frame(frame.width, frame.height, frame.data)
        }
        scap::frame::VideoFrame::YUVFrame(_) => {
            Err("scap returned YUV data for an RGBA screenshot request.".to_string())
        }
    }
}

fn snipping_scap_video_frame_to_bgra_bytes(
    frame: scap::frame::VideoFrame,
) -> Result<(Vec<u8>, u32, u32, SystemTime), String> {
    match frame {
        scap::frame::VideoFrame::BGRA(frame) => {
            let display_time = frame.display_time;
            let (width, height, pixels) =
                snipping_scap_frame_pixel_count(frame.width, frame.height, "scap BGRA")?;
            let expected_len = pixels
                .checked_mul(4)
                .ok_or_else(|| "scap BGRA returned a frame that is too large.".to_string())?;
            if frame.data.len() < expected_len {
                return Err("scap BGRA returned incomplete frame data.".to_string());
            }
            let mut data = frame.data;
            data.truncate(expected_len);
            Ok((data, width, height, display_time))
        }
        scap::frame::VideoFrame::BGR0(frame) => {
            let display_time = frame.display_time;
            let (data, width, height) = snipping_scap_bgra_from_four_channel_frame(
                frame.width,
                frame.height,
                frame.data,
                "scap BGR0",
                |pixel| pixel[3] = 255,
            )?;
            Ok((data, width, height, display_time))
        }
        scap::frame::VideoFrame::BGRx(frame) => {
            let display_time = frame.display_time;
            let (data, width, height) = snipping_scap_bgra_from_four_channel_frame(
                frame.width,
                frame.height,
                frame.data,
                "scap BGRx",
                |pixel| pixel[3] = 255,
            )?;
            Ok((data, width, height, display_time))
        }
        scap::frame::VideoFrame::RGBx(frame) => {
            let display_time = frame.display_time;
            let (data, width, height) = snipping_scap_bgra_from_four_channel_frame(
                frame.width,
                frame.height,
                frame.data,
                "scap RGBx",
                |pixel| {
                    pixel.swap(0, 2);
                    pixel[3] = 255;
                },
            )?;
            Ok((data, width, height, display_time))
        }
        scap::frame::VideoFrame::XBGR(frame) => {
            let display_time = frame.display_time;
            let (data, width, height) = snipping_scap_bgra_from_four_channel_frame(
                frame.width,
                frame.height,
                frame.data,
                "scap XBGR",
                |pixel| {
                    let blue = pixel[1];
                    let green = pixel[2];
                    let red = pixel[3];
                    pixel[0] = blue;
                    pixel[1] = green;
                    pixel[2] = red;
                    pixel[3] = 255;
                },
            )?;
            Ok((data, width, height, display_time))
        }
        scap::frame::VideoFrame::RGB(frame) => {
            let display_time = frame.display_time;
            let (width, height, pixels) =
                snipping_scap_frame_pixel_count(frame.width, frame.height, "scap RGB")?;
            let expected_len = pixels
                .checked_mul(3)
                .ok_or_else(|| "scap RGB returned a frame that is too large.".to_string())?;
            if frame.data.len() < expected_len {
                return Err("scap RGB returned incomplete frame data.".to_string());
            }
            let mut bgra = Vec::with_capacity(pixels * 4);
            for pixel in frame.data[..expected_len].chunks_exact(3) {
                bgra.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 255]);
            }
            Ok((bgra, width, height, display_time))
        }
        scap::frame::VideoFrame::YUVFrame(_) => {
            Err("scap returned YUV data for a BGRA recording request.".to_string())
        }
    }
}

fn snipping_scap_bgra_from_four_channel_frame<F>(
    width: i32,
    height: i32,
    mut data: Vec<u8>,
    source: &str,
    mut write_pixel: F,
) -> Result<(Vec<u8>, u32, u32), String>
where
    F: FnMut(&mut [u8]),
{
    let (width, height, pixels) = snipping_scap_frame_pixel_count(width, height, source)?;
    let expected_len = pixels
        .checked_mul(4)
        .ok_or_else(|| format!("{source} returned a frame that is too large."))?;
    if data.len() < expected_len {
        return Err(format!("{source} returned incomplete frame data."));
    }
    data.truncate(expected_len);
    for pixel in data.chunks_exact_mut(4) {
        write_pixel(pixel);
    }
    Ok((data, width, height))
}

fn snipping_scap_capture_image_inner(
    target: Option<scap::Target>,
    crop_area: Option<scap::capturer::Area>,
) -> Result<image::RgbaImage, String> {
    snipping_ensure_scap_ready()?;

    let options = scap::capturer::Options {
        fps: SNIPPING_SCAP_CAPTURE_FPS,
        show_cursor: false,
        show_highlight: false,
        target,
        crop_area,
        output_type: scap::frame::FrameType::BGRAFrame,
        output_resolution: scap::capturer::Resolution::Captured,
        excluded_targets: None,
        captures_audio: false,
        exclude_current_process_audio: true,
    };
    let mut capturer = scap::capturer::Capturer::build(options)
        .map_err(|error| format!("Unable to initialize screen capture: {error}"))?;
    capturer.start_capture();
    let capture_result = (|| -> Result<image::RgbaImage, String> {
        loop {
            match capturer
                .get_next_frame()
                .map_err(|error| format!("Unable to receive screen frame: {error}"))?
            {
                scap::frame::Frame::Video(frame) => return snipping_scap_video_frame_to_rgba(frame),
                scap::frame::Frame::Audio(_) => continue,
            }
        }
    })();
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        capturer.stop_capture();
    }));
    capture_result
}

fn snipping_scap_capture_image(
    target: Option<scap::Target>,
    crop_area: Option<scap::capturer::Area>,
    context: &str,
) -> Result<image::RgbaImage, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let context_for_worker = context.to_string();
    thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            snipping_scap_capture_image_inner(target, crop_area)
        }))
        .map_err(|_| format!("Screen capture backend panicked while {context_for_worker}."))
        .and_then(|result| result);
        let _ = sender.send(result);
    });

    match receiver.recv_timeout(Duration::from_millis(SNIPPING_SCAP_CAPTURE_TIMEOUT_MS)) {
        Ok(result) => result,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err(format!(
            "Timed out while {context}. Try the snip again; if it keeps happening, reopen Screen Recording permission for Diff Forge AI."
        )),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            Err(format!("Screen capture backend stopped while {context}."))
        }
    }
}

/// Full-monitor capture for snips. Tauri supplies monitor geometry; scap
/// supplies the frame.
fn snipping_capture_monitor_full_image(
    app: &AppHandle,
    monitor: &SnippingAreaMonitor,
    exclude_desktop_icons: bool,
) -> Result<image::RgbaImage, String> {
    let warm_capture_allowed = !exclude_desktop_icons || cfg!(target_os = "macos");
    if warm_capture_allowed {
        if let Some(image) = snipping_warm_capture_frame_for_monitor(app, monitor, 0) {
            return Ok(image);
        }
    }

    let target = snipping_scap_display_target_for_area_monitor(monitor);
    let image = snipping_scap_capture_image(target, None, "capturing the screen");
    if image.is_ok() {
        snipping_start_warm_capture_if_ready(app);
    }
    image
}

fn snipping_scap_capture_monitor_region(
    monitor: &SnippingAreaMonitor,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    context: &str,
) -> Result<image::RgbaImage, String> {
    let target = snipping_scap_display_target_for_area_monitor(monitor);
    let crop_area = Some(snipping_scap_capture_area(x, y, width, height));
    let image = snipping_scap_capture_image(target, crop_area, context)?;
    #[cfg(target_os = "linux")]
    {
        return snipping_crop_snapshot_image(&image, x, y, width, height);
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok(image)
    }
}

fn snipping_capture_monitor_region_image(
    app: &AppHandle,
    monitor: &SnippingAreaMonitor,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    context: &str,
    min_warm_capture_ms: u64,
) -> Result<image::RgbaImage, String> {
    if let Some(image) = snipping_warm_capture_frame_for_monitor(app, monitor, min_warm_capture_ms)
    {
        return snipping_crop_snapshot_image(&image, x, y, width, height);
    }

    let image = snipping_scap_capture_monitor_region(monitor, x, y, width, height, context);
    if image.is_ok() {
        snipping_start_warm_capture_if_ready(app);
    }
    image
}

fn snipping_capture_area_image(
    app: &AppHandle,
    _overlay_label: &str,
    monitor: &SnippingAreaMonitor,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<image::RgbaImage, String> {
    snipping_hide_area_overlay(app);
    let overlay_hidden_at_ms = current_time_ms();
    thread::sleep(Duration::from_millis(
        SNIPPING_CAPTURE_HIDE_OVERLAY_DELAY_MS,
    ));
    snipping_capture_monitor_region_image(
        app,
        monitor,
        x,
        y,
        width,
        height,
        "capturing the selected area",
        overlay_hidden_at_ms,
    )
}

/// Mid-session capture that must NOT end the snip. Re-freezes hide only the
/// relevant overlay for the capture and then restore it, preserving the active
/// area session, Escape grab, and overlay windows.
fn snipping_capture_monitor_image_keeping_session(
    app: &AppHandle,
    overlay_label: &str,
    monitor: &SnippingAreaMonitor,
    width: u32,
    height: u32,
) -> Result<image::RgbaImage, String> {
    let overlay = app.get_webview_window(overlay_label);
    if let Some(overlay) = overlay.as_ref() {
        snipping_hide_window_now(overlay, "capture_region_hide_overlay");
    }
    let overlay_hidden_at_ms = current_time_ms();
    thread::sleep(Duration::from_millis(60));
    let captured = snipping_capture_monitor_region_image(
        app,
        monitor,
        0,
        0,
        width,
        height,
        "capturing screen for snip re-freeze",
        overlay_hidden_at_ms,
    )
    .map_err(|error| format!("Unable to capture screen for snip re-freeze: {error}"));
    if let Some(overlay) = overlay.as_ref() {
        snipping_show_window_now(overlay, "capture_region_show_overlay");
        #[cfg(target_os = "macos")]
        snipping_order_overlay_front_regardless(overlay);
    }
    captured
}

fn snipping_capture_toast_path(value: &Value) -> Option<String> {
    value
        .get("path")
        .or_else(|| value.get("localPath"))
        .or_else(|| value.get("local_path"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_string)
        .or_else(|| {
            value
                .get("item")
                .and_then(|item| {
                    item.get("path")
                        .or_else(|| item.get("localPath"))
                        .or_else(|| item.get("local_path"))
                        .and_then(Value::as_str)
                })
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .map(str::to_string)
        })
}

fn snipping_read_dismissed_toast_paths(app: &AppHandle) -> HashSet<String> {
    let Ok(path) = snipping_dismissed_toasts_path(app) else {
        return HashSet::new();
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return HashSet::new();
    };
    serde_json::from_str::<SnippingDismissedToasts>(&contents)
        .map(|dismissed| {
            dismissed
                .paths
                .into_iter()
                .map(|path| path.trim().to_string())
                .filter(|path| !path.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn snipping_write_dismissed_toast_paths(
    app: &AppHandle,
    paths: &HashSet<String>,
) -> Result<(), String> {
    let file = snipping_dismissed_toasts_path(app)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Unable to create snipping settings directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let mut sorted_paths = paths.iter().cloned().collect::<Vec<_>>();
    sorted_paths.sort();
    let contents = serde_json::to_string_pretty(&SnippingDismissedToasts {
        paths: sorted_paths,
    })
    .map_err(|error| format!("Unable to serialize dismissed snips: {error}"))?;
    fs::write(&file, contents).map_err(|error| {
        format!(
            "Unable to write dismissed snips {}: {error}",
            file.display()
        )
    })
}

fn snipping_capture_toast_is_dismissed(value: &Value, dismissed_paths: &HashSet<String>) -> bool {
    snipping_capture_toast_path(value)
        .map(|path| dismissed_paths.contains(&path))
        .unwrap_or(false)
}

fn snipping_push_recent_capture_toast(app: &AppHandle, payload: Value) {
    let dismissed_paths = snipping_read_dismissed_toast_paths(app);
    if snipping_capture_toast_is_dismissed(&payload, &dismissed_paths) {
        return;
    }

    let recent_capture_toasts = app.state::<SnippingState>().recent_capture_toasts.clone();
    let Ok(mut guard) = recent_capture_toasts.lock() else {
        return;
    };

    if let Some(path) = snipping_capture_toast_path(&payload) {
        guard.retain(|item| {
            snipping_capture_toast_path(item)
                .map(|item_path| item_path != path)
                .unwrap_or(true)
        });
    }
    guard.insert(0, payload);
    guard.truncate(SNIPPING_RECENT_CAPTURE_TOAST_LIMIT);
}

fn snipping_recent_capture_toasts_for(app: &AppHandle) -> Value {
    let dismissed_paths = snipping_read_dismissed_toast_paths(app);
    let items = app
        .state::<SnippingState>()
        .recent_capture_toasts
        .lock()
        .map(|guard| {
            guard
                .iter()
                .filter(|item| !snipping_capture_toast_is_dismissed(item, &dismissed_paths))
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "kind": "snipping_recent_capture_toasts",
        "items": items,
    })
}

fn snipping_dismiss_capture_toast_for(
    app: &AppHandle,
    request: SnippingCaptureToastDismissRequest,
) -> Result<Value, String> {
    let dismissed_path = request
        .path
        .or(request.local_path)
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());
    let dismissed_id = request
        .id
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty());

    let mut dismissed_paths = snipping_read_dismissed_toast_paths(app);
    if let Some(path) = dismissed_path.as_ref() {
        dismissed_paths.insert(path.clone());
        snipping_write_dismissed_toast_paths(app, &dismissed_paths)?;
    }

    let recent_capture_toasts = app.state::<SnippingState>().recent_capture_toasts.clone();
    if let Ok(mut guard) = recent_capture_toasts.lock() {
        guard.retain(|item| {
            let path_matches = dismissed_path
                .as_ref()
                .and_then(|path| {
                    snipping_capture_toast_path(item).map(|item_path| item_path == *path)
                })
                .unwrap_or(false);
            let id_matches = dismissed_id
                .as_ref()
                .and_then(|id| {
                    item.get("id")
                        .or_else(|| item.get("untrackedId"))
                        .or_else(|| item.get("untracked_id"))
                        .and_then(Value::as_str)
                        .or_else(|| {
                            item.get("item").and_then(|nested| {
                                nested
                                    .get("id")
                                    .or_else(|| nested.get("untrackedId"))
                                    .or_else(|| nested.get("untracked_id"))
                                    .and_then(Value::as_str)
                            })
                        })
                        .map(|item_id| item_id == id)
                })
                .unwrap_or(false);
            !(path_matches || id_matches)
        });
    }

    Ok(snipping_recent_capture_toasts_for(app))
}

fn snipping_prepare_capture_path(mode: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = diffforge_prepare_untracked_asset_root()?;
    let target_dir = root.join("snips");
    let tmp_dir = root.join(".tmp");
    fs::create_dir_all(&target_dir).map_err(|error| {
        format!(
            "Unable to create snipping output directory {}: {error}",
            target_dir.display()
        )
    })?;
    fs::create_dir_all(&tmp_dir).map_err(|error| {
        format!(
            "Unable to create snipping temp directory {}: {error}",
            tmp_dir.display()
        )
    })?;

    let now_ms = cloud_mcp_now_ms();
    let filename = format!("df-snip-{now_ms}-{mode}.png");
    let target = cloud_mcp_available_asset_download_path(&target_dir, &filename);
    let tmp = tmp_dir.join(format!(
        ".{}-{}.tmp",
        filename.trim_end_matches(".png"),
        uuid::Uuid::new_v4()
    ));
    Ok((target, tmp))
}

fn snipping_prepare_recording_path(mode: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = diffforge_prepare_untracked_asset_root()?;
    let target_dir = root.join("snips");
    let tmp_dir = root.join(".tmp");
    fs::create_dir_all(&target_dir).map_err(|error| {
        format!(
            "Unable to create snipping output directory {}: {error}",
            target_dir.display()
        )
    })?;
    fs::create_dir_all(&tmp_dir).map_err(|error| {
        format!(
            "Unable to create snipping temp directory {}: {error}",
            tmp_dir.display()
        )
    })?;

    let now_ms = cloud_mcp_now_ms();
    let filename = format!("df-snip-{now_ms}-{mode}.mp4");
    let target = cloud_mcp_available_asset_download_path(&target_dir, &filename);
    let tmp = tmp_dir.join(format!(
        ".{}-{}.tmp.mp4",
        filename.trim_end_matches(".mp4"),
        uuid::Uuid::new_v4()
    ));
    Ok((target, tmp))
}

#[allow(clippy::too_many_arguments)]
fn snipping_emit_untracked_image_saved_with_toast(
    app: &AppHandle,
    target: &Path,
    width: u32,
    height: u32,
    mode: &str,
    reason: &str,
    shortcut: String,
    original_path: Option<String>,
    show_toast: bool,
) -> Result<Value, String> {
    if show_toast {
        // Every snip preview is its own draggable native window from the
        // start; new captures stack in the bottom-left column. Open it FIRST
        // — the asset item/library payload below scans the asset store, and
        // the preview should not wait on that.
        let app_for_preview = app.clone();
        let preview_path = target.display().to_string();
        let _ = app.run_on_main_thread(move || {
            let _ = snipping_open_snip_preview_window_for(
                &app_for_preview,
                &preview_path,
                None,
                false,
            );
        });
    }
    let root = diffforge_prepare_untracked_asset_root()?;
    let item = diffforge_untracked_asset_item(&root, target).ok();
    let saved_at_ms = cloud_mcp_now_ms();
    let payload = json!({
        "kind": "snipping_capture_saved",
        "mode": mode,
        "reason": reason,
        "shortcut": shortcut,
        "path": target.display().to_string(),
        "local_path": target.display().to_string(),
        "localPath": target.display().to_string(),
        "filename": target.file_name().and_then(|value| value.to_str()).unwrap_or("snip.png"),
        "width": width,
        "height": height,
        "saved_at_ms": saved_at_ms,
        "savedAtMs": saved_at_ms,
        "original_path": original_path.clone(),
        "originalPath": original_path,
        "item": item,
        "library": diffforge_untracked_asset_library(None)?,
    });
    diffforge_emit_untracked_assets_updated(app, "snip-saved", payload.get("item").cloned());
    snipping_push_recent_capture_toast(app, payload.clone());
    let _ = app.emit(SNIPPING_CAPTURE_SAVED_EVENT, payload.clone());
    Ok(payload)
}

#[allow(clippy::too_many_arguments)]
fn snipping_emit_untracked_video_saved_with_toast(
    app: &AppHandle,
    target: &Path,
    width: u32,
    height: u32,
    duration_ms: u64,
    mode: &str,
    reason: &str,
    shortcut: String,
    original_path: Option<String>,
    show_toast: bool,
) -> Result<Value, String> {
    if show_toast {
        let app_for_preview = app.clone();
        let preview_path = target.display().to_string();
        let _ = app.run_on_main_thread(move || {
            let _ = snipping_open_snip_preview_window_for(
                &app_for_preview,
                &preview_path,
                None,
                false,
            );
        });
    }
    let root = diffforge_prepare_untracked_asset_root()?;
    let item = diffforge_untracked_asset_item(&root, target).ok();
    let saved_at_ms = cloud_mcp_now_ms();
    let payload = json!({
        "kind": "snipping_capture_saved",
        "assetKind": "video",
        "asset_kind": "video",
        "mimeType": "video/mp4",
        "mime_type": "video/mp4",
        "mode": mode,
        "reason": reason,
        "shortcut": shortcut,
        "path": target.display().to_string(),
        "local_path": target.display().to_string(),
        "localPath": target.display().to_string(),
        "filename": target.file_name().and_then(|value| value.to_str()).unwrap_or("recording.mp4"),
        "width": width,
        "height": height,
        "duration_ms": duration_ms,
        "durationMs": duration_ms,
        "saved_at_ms": saved_at_ms,
        "savedAtMs": saved_at_ms,
        "original_path": original_path.clone(),
        "originalPath": original_path,
        "item": item,
        "library": diffforge_untracked_asset_library(None)?,
    });
    diffforge_emit_untracked_assets_updated(app, "snip-recording-saved", payload.get("item").cloned());
    snipping_push_recent_capture_toast(app, payload.clone());
    let _ = app.emit(SNIPPING_CAPTURE_SAVED_EVENT, payload.clone());
    Ok(payload)
}

#[allow(clippy::too_many_arguments)]
fn snipping_emit_untracked_image_saved(
    app: &AppHandle,
    target: &Path,
    width: u32,
    height: u32,
    mode: &str,
    reason: &str,
    shortcut: String,
    original_path: Option<String>,
) -> Result<Value, String> {
    snipping_emit_untracked_image_saved_with_toast(
        app,
        target,
        width,
        height,
        mode,
        reason,
        shortcut,
        original_path,
        true,
    )
}

/// Writes a capture as PNG with fast compression. Default PNG settings spend
/// seconds compressing a retina-sized frame, which is the difference between
/// the capture toast appearing instantly and appearing after a long pause.
fn snipping_write_png_fast(image: &image::RgbaImage, path: &Path) -> Result<(), String> {
    use image::ImageEncoder;
    let width = image.width();
    let height = image.height();
    let raw = image.as_raw();
    let expected_len = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| {
            format!(
                "Unable to encode snip image {}: image dimensions are too large ({width}x{height})",
                path.display()
            )
        })?;
    if expected_len != raw.len() as u64 {
        return Err(format!(
            "Unable to encode snip image {}: invalid RGBA buffer length for {width}x{height} image, expected {expected_len} bytes but got {}",
            path.display(),
            raw.len()
        ));
    }

    let file = fs::File::create(path)
        .map_err(|error| format!("Unable to create snip image {}: {error}", path.display()))?;
    let writer = std::io::BufWriter::new(file);
    let encoder = image::codecs::png::PngEncoder::new_with_quality(
        writer,
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::Adaptive,
    );
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        encoder.write_image(raw, width, height, image::ExtendedColorType::Rgba8)
    }))
    .map_err(|_| format!("Unable to encode snip image {}: PNG encoder panicked", path.display()))?
    .map_err(|error| format!("Unable to encode snip image {}: {error}", path.display()))
}

fn snipping_save_image(
    app: &AppHandle,
    image: image::RgbaImage,
    mode: &str,
    reason: &str,
    shortcut: String,
) -> Result<Value, String> {
    let (target, tmp) = snipping_prepare_capture_path(mode)?;
    let width = image.width();
    let height = image.height();
    if let Err(error) = snipping_write_png_fast(&image, &tmp) {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }
    fs::rename(&tmp, &target).map_err(|error| {
        let _ = fs::remove_file(&tmp);
        format!(
            "Unable to move snip image {} to {}: {error}",
            tmp.display(),
            target.display()
        )
    })?;

    snipping_emit_untracked_image_saved(app, &target, width, height, mode, reason, shortcut, None)
}

fn snipping_crop_bgra_bytes(
    data: &[u8],
    source_width: u32,
    source_height: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Option<Vec<u8>> {
    if source_width == 0 || source_height == 0 || width == 0 || height == 0 {
        return None;
    }
    let x = x.min(source_width.saturating_sub(1));
    let y = y.min(source_height.saturating_sub(1));
    let width = width.min(source_width.saturating_sub(x));
    let height = height.min(source_height.saturating_sub(y));
    if width == 0 || height == 0 {
        return None;
    }
    let source_stride = usize::try_from(source_width).ok()?.checked_mul(4)?;
    let row_len = usize::try_from(width).ok()?.checked_mul(4)?;
    let expected_len = usize::try_from(source_height).ok()?.checked_mul(source_stride)?;
    if data.len() < expected_len {
        return None;
    }
    let mut cropped = Vec::with_capacity(usize::try_from(height).ok()?.checked_mul(row_len)?);
    for row in y..y.saturating_add(height) {
        let offset = usize::try_from(row).ok()?
            .checked_mul(source_stride)?
            .checked_add(usize::try_from(x).ok()?.checked_mul(4)?)?;
        let end = offset.checked_add(row_len)?;
        cropped.extend_from_slice(data.get(offset..end)?);
    }
    Some(cropped)
}

fn snipping_recording_bitrate_bps(width: u32, height: u32) -> u32 {
    let pixels = u64::from(width).saturating_mul(u64::from(height));
    let bitrate = pixels
        .saturating_mul(u64::from(SNIPPING_RECORDING_FPS))
        .saturating_div(12);
    bitrate.clamp(1_500_000, 20_000_000) as u32
}

fn snipping_recording_default_frame_duration_ms() -> u32 {
    (1_000 / SNIPPING_RECORDING_FPS).max(1)
}

fn snipping_recording_sample_duration_ms(start_ms: u64, end_ms: u64) -> u32 {
    let duration = end_ms
        .saturating_sub(start_ms)
        .max(1)
        .min(u64::from(SNIPPING_RECORDING_MAX_SAMPLE_DURATION_MS));
    u32::try_from(duration).unwrap_or(SNIPPING_RECORDING_MAX_SAMPLE_DURATION_MS)
}

fn snipping_recording_system_time_ms(value: SystemTime) -> Option<u64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn snipping_recording_frame_pts_ms(
    frame_epoch_ms: u64,
    first_frame_epoch_ms: &mut Option<u64>,
    last_frame_pts_ms: &mut Option<u64>,
) -> u64 {
    let first_epoch_ms = *first_frame_epoch_ms.get_or_insert(frame_epoch_ms);
    let mut pts_ms = frame_epoch_ms.saturating_sub(first_epoch_ms);
    if let Some(previous_pts_ms) = *last_frame_pts_ms {
        if pts_ms <= previous_pts_ms {
            pts_ms = previous_pts_ms.saturating_add(1);
        }
    }
    *last_frame_pts_ms = Some(pts_ms);
    pts_ms
}

fn snipping_recording_final_sample_duration_ms(
    first_frame_epoch_ms: Option<u64>,
    pending_pts_ms: u64,
    stop_requested_at_ms: u64,
) -> u32 {
    let Some(first_frame_epoch_ms) = first_frame_epoch_ms else {
        return snipping_recording_default_frame_duration_ms();
    };
    if stop_requested_at_ms == 0 {
        return snipping_recording_default_frame_duration_ms();
    }
    let stop_pts_ms = stop_requested_at_ms.saturating_sub(first_frame_epoch_ms);
    if stop_pts_ms <= pending_pts_ms {
        return snipping_recording_default_frame_duration_ms();
    }
    snipping_recording_sample_duration_ms(pending_pts_ms, stop_pts_ms)
}

fn snipping_clamp_u8(value: i32) -> u8 {
    value.clamp(0, 255) as u8
}

fn snipping_bgra_to_i420(
    bgra: &[u8],
    width: u32,
    height: u32,
    yuv: &mut Vec<u8>,
) -> Result<(), String> {
    if width == 0 || height == 0 || width % 2 != 0 || height % 2 != 0 {
        return Err("Screen recording frame dimensions must be even.".to_string());
    }
    let width = usize::try_from(width)
        .map_err(|_| "Screen recording frame width is too large.".to_string())?;
    let height = usize::try_from(height)
        .map_err(|_| "Screen recording frame height is too large.".to_string())?;
    let pixels = width
        .checked_mul(height)
        .ok_or_else(|| "Screen recording frame is too large.".to_string())?;
    let expected_bgra_len = pixels
        .checked_mul(4)
        .ok_or_else(|| "Screen recording frame is too large.".to_string())?;
    if bgra.len() < expected_bgra_len {
        return Err("Screen recording frame returned incomplete pixel data.".to_string());
    }

    let y_len = pixels;
    let uv_len = pixels / 4;
    let yuv_len = y_len
        .checked_add(uv_len)
        .and_then(|value| value.checked_add(uv_len))
        .ok_or_else(|| "Screen recording frame is too large.".to_string())?;
    yuv.resize(yuv_len, 0);
    let (y_plane, uv_plane) = yuv.split_at_mut(y_len);
    let (u_plane, v_plane) = uv_plane.split_at_mut(uv_len);

    for row in 0..height {
        let row_base = row * width;
        for col in 0..width {
            let pixel_offset = (row_base + col) * 4;
            let blue = i32::from(bgra[pixel_offset]);
            let green = i32::from(bgra[pixel_offset + 1]);
            let red = i32::from(bgra[pixel_offset + 2]);
            y_plane[row_base + col] =
                snipping_clamp_u8(((66 * red + 129 * green + 25 * blue) >> 8) + 16);
        }
    }

    let half_width = width / 2;
    for row in (0..height).step_by(2) {
        for col in (0..width).step_by(2) {
            let mut blue_sum = 0_i32;
            let mut green_sum = 0_i32;
            let mut red_sum = 0_i32;
            for y_offset in 0..2 {
                for x_offset in 0..2 {
                    let pixel_offset = ((row + y_offset) * width + col + x_offset) * 4;
                    blue_sum += i32::from(bgra[pixel_offset]);
                    green_sum += i32::from(bgra[pixel_offset + 1]);
                    red_sum += i32::from(bgra[pixel_offset + 2]);
                }
            }
            let blue = (blue_sum + 2) / 4;
            let green = (green_sum + 2) / 4;
            let red = (red_sum + 2) / 4;
            let uv_index = (row / 2) * half_width + (col / 2);
            u_plane[uv_index] =
                snipping_clamp_u8(((-38 * red - 74 * green + 112 * blue) >> 8) + 128);
            v_plane[uv_index] =
                snipping_clamp_u8(((112 * red - 94 * green - 18 * blue) >> 8) + 128);
        }
    }

    Ok(())
}

fn snipping_h264_nal_payload(nal: &[u8]) -> &[u8] {
    if nal.starts_with(&[0, 0, 0, 1]) {
        &nal[4..]
    } else if nal.starts_with(&[0, 0, 1]) {
        &nal[3..]
    } else {
        nal
    }
}

fn snipping_h264_annexb_from_bitstream(
    bitstream: &openh264::encoder::EncodedBitStream<'_>,
    output: &mut Vec<u8>,
) -> bool {
    output.clear();
    let mut has_video_slice = false;
    for layer_index in 0..bitstream.num_layers() {
        let Some(layer) = bitstream.layer(layer_index) else {
            continue;
        };
        for nal_index in 0..layer.nal_count() {
            let Some(nal) = layer.nal_unit(nal_index) else {
                continue;
            };
            let nal = snipping_h264_nal_payload(nal);
            if nal.is_empty() {
                continue;
            }
            let nal_type = nal[0] & 0x1f;
            if !matches!(nal_type, 1 | 5 | 7 | 8) {
                continue;
            }
            has_video_slice |= matches!(nal_type, 1 | 5);
            output.extend_from_slice(&[0, 0, 0, 1]);
            output.extend_from_slice(nal);
        }
    }
    has_video_slice
}

#[derive(Default)]
struct SnippingMp4RecordingSummary {
    mdat_payload_bytes: u64,
    sample_count: u64,
}

fn snipping_mp4_box_is_container(kind: [u8; 4]) -> bool {
    matches!(
        kind,
        [b'm', b'o', b'o', b'v']
            | [b't', b'r', b'a', b'k']
            | [b'm', b'd', b'i', b'a']
            | [b'm', b'i', b'n', b'f']
            | [b's', b't', b'b', b'l']
    )
}

fn snipping_read_mp4_bytes(
    file: &mut fs::File,
    offset: u64,
    bytes: &mut [u8],
) -> Result<(), String> {
    use std::io::{Read as _, Seek as _};
    file.seek(std::io::SeekFrom::Start(offset))
        .map_err(|error| format!("Unable to read recording MP4: {error}"))?;
    file.read_exact(bytes)
        .map_err(|error| format!("Unable to read recording MP4: {error}"))
}

fn snipping_read_mp4_u32(file: &mut fs::File, offset: u64) -> Result<u32, String> {
    let mut bytes = [0u8; 4];
    snipping_read_mp4_bytes(file, offset, &mut bytes)?;
    Ok(u32::from_be_bytes(bytes))
}

fn snipping_read_mp4_u64(file: &mut fs::File, offset: u64) -> Result<u64, String> {
    let mut bytes = [0u8; 8];
    snipping_read_mp4_bytes(file, offset, &mut bytes)?;
    Ok(u64::from_be_bytes(bytes))
}

fn snipping_scan_mp4_recording_boxes(
    file: &mut fs::File,
    start: u64,
    end: u64,
    depth: u8,
    summary: &mut SnippingMp4RecordingSummary,
) -> Result<(), String> {
    if depth > 8 {
        return Ok(());
    }
    let mut offset = start;
    while offset < end {
        if end.saturating_sub(offset) < 8 {
            return Err("Recording file has a truncated MP4 box.".to_string());
        }

        let size32 = snipping_read_mp4_u32(file, offset)?;
        let mut kind = [0u8; 4];
        snipping_read_mp4_bytes(file, offset.saturating_add(4), &mut kind)?;

        let mut header_size = 8_u64;
        let box_size = match size32 {
            0 => end.saturating_sub(offset),
            1 => {
                header_size = 16;
                snipping_read_mp4_u64(file, offset.saturating_add(8))?
            }
            value => u64::from(value),
        };

        if box_size < header_size {
            return Err("Recording file has an invalid MP4 box size.".to_string());
        }
        let Some(box_end) = offset.checked_add(box_size) else {
            return Err("Recording file has an invalid MP4 box size.".to_string());
        };
        if box_end > end {
            return Err("Recording file has an invalid MP4 box size.".to_string());
        }

        let payload_start = offset.saturating_add(header_size);
        if kind == *b"mdat" {
            summary.mdat_payload_bytes = summary
                .mdat_payload_bytes
                .saturating_add(box_size.saturating_sub(header_size));
        } else if kind == *b"stsz" {
            if box_end.saturating_sub(payload_start) < 12 {
                return Err("Recording file has a truncated MP4 sample table.".to_string());
            }
            let sample_count = u64::from(snipping_read_mp4_u32(
                file,
                payload_start.saturating_add(8),
            )?);
            summary.sample_count = summary.sample_count.saturating_add(sample_count);
        } else if snipping_mp4_box_is_container(kind) {
            snipping_scan_mp4_recording_boxes(file, payload_start, box_end, depth + 1, summary)?;
        }

        offset = box_end;
    }
    Ok(())
}

fn snipping_validate_recording_mp4(path: &Path) -> Result<(), String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Unable to open recording file {}: {error}", path.display()))?;
    let file_len = file
        .metadata()
        .map_err(|error| format!("Unable to read recording file {}: {error}", path.display()))?
        .len();
    if file_len == 0 {
        return Err("Recording file is empty.".to_string());
    }

    let mut summary = SnippingMp4RecordingSummary::default();
    snipping_scan_mp4_recording_boxes(&mut file, 0, file_len, 0, &mut summary)?;
    if summary.mdat_payload_bytes == 0 || summary.sample_count == 0 {
        return Err("Recording file contains no playable video frames.".to_string());
    }
    Ok(())
}

fn snipping_recording_encoder_config(
    width: u32,
    height: u32,
) -> openh264::encoder::EncoderConfig {
    openh264::encoder::EncoderConfig::new()
        .bitrate(openh264::encoder::BitRate::from_bps(
            snipping_recording_bitrate_bps(width, height),
        ))
        .max_frame_rate(openh264::encoder::FrameRate::from_hz(
            SNIPPING_RECORDING_FPS as f32,
        ))
        .usage_type(openh264::encoder::UsageType::ScreenContentRealTime)
        .rate_control_mode(openh264::encoder::RateControlMode::Bitrate)
        .complexity(openh264::encoder::Complexity::Low)
        .skip_frames(false)
        .scene_change_detect(true)
        .intra_frame_period(openh264::encoder::IntraFramePeriod::from_num_frames(
            SNIPPING_RECORDING_FPS.saturating_mul(2),
        ))
        .vui(openh264::encoder::VuiConfig::srgb())
}

fn snipping_recording_active(app: &AppHandle) -> bool {
    app.state::<SnippingState>()
        .recording
        .active
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

fn snipping_recording_status_for(app: &AppHandle) -> Value {
    let session = app
        .state::<SnippingState>()
        .recording
        .active
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    match session {
        Some(session) => json!({
            "kind": "snipping_recording_status",
            "active": true,
            "path": session.target_path.display().to_string(),
            "local_path": session.target_path.display().to_string(),
            "localPath": session.target_path.display().to_string(),
            "started_at_ms": session.started_at_ms,
            "startedAtMs": session.started_at_ms,
            "width": session.width,
            "height": session.height,
        }),
        None => json!({
            "kind": "snipping_recording_status",
            "active": false,
        }),
    }
}

fn snipping_clear_recording_if_current(app: &AppHandle, id: &str) {
    let state = app.state::<SnippingState>().recording.clone();
    if let Ok(mut guard) = state.active.lock() {
        if guard.as_ref().is_some_and(|session| session.id == id) {
            *guard = None;
        }
    };
}

#[cfg(windows)]
fn snipping_set_recording_controls_capture_exclusion(
    window: &tauri::WebviewWindow,
    enabled: bool,
) {
    const WDA_NONE: u32 = 0x0000_0000;
    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x0000_0011;
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let affinity = if enabled {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };
    unsafe {
        let _ = SetWindowDisplayAffinity(hwnd.0, affinity);
    }
}

#[cfg(not(windows))]
fn snipping_set_recording_controls_capture_exclusion(
    _window: &tauri::WebviewWindow,
    _enabled: bool,
) {
}

#[cfg(target_os = "macos")]
fn snipping_recording_controls_apply_macos_style(window: &tauri::WebviewWindow) {
    snipping_convert_overlay_window_to_panel(window);
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("recording_controls_apply_macos_style", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            ns_window.setCollectionBehavior(
                objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllSpaces
                    | objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllApplications
                    | objc2_app_kit::NSWindowCollectionBehavior::FullScreenAuxiliary
                    | objc2_app_kit::NSWindowCollectionBehavior::Stationary
                    | objc2_app_kit::NSWindowCollectionBehavior::IgnoresCycle,
            );
            ns_window.setLevel(objc2_app_kit::NSScreenSaverWindowLevel);
            ns_window.setAcceptsMouseMovedEvents(true);
        });
    });
}

#[cfg(not(target_os = "macos"))]
fn snipping_recording_controls_apply_macos_style(_window: &tauri::WebviewWindow) {}

fn snipping_recording_controls_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(SNIPPING_RECORDING_CONTROLS_WINDOW_LABEL) {
        snipping_set_recording_controls_capture_exclusion(&window, true);
        #[cfg(target_os = "macos")]
        snipping_recording_controls_apply_macos_style(&window);
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        SNIPPING_RECORDING_CONTROLS_WINDOW_LABEL,
        WebviewUrl::App("index.html#/snipping-recording-controls".into()),
    )
    .title(SNIPPING_RECORDING_CONTROLS_TITLE)
    .inner_size(250.0, 54.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .focused(false)
    .accept_first_mouse(true)
    .skip_taskbar(true)
    .visible_on_all_workspaces(true)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .visible(false)
    .shadow(true)
    .build()
    .map_err(|error| format!("Unable to create recording controls: {error}"))?;

    snipping_set_recording_controls_capture_exclusion(&window, true);
    #[cfg(target_os = "macos")]
    snipping_recording_controls_apply_macos_style(&window);
    {
        let app_for_close = app.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = snipping_stop_recording_for(&app_for_close, "recording-controls-close");
            }
        });
    }
    Ok(window)
}

fn snipping_position_recording_controls(
    window: &tauri::WebviewWindow,
    monitor: &SnippingAreaMonitor,
    request: &SnippingAreaSelectionRequest,
) {
    const CONTROLS_WIDTH: f64 = 250.0;
    const CONTROLS_HEIGHT: f64 = 54.0;
    const CONTROLS_MARGIN: f64 = 14.0;

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let (screen_x, screen_y, screen_width, screen_height) = (
        f64::from(monitor.capture_x),
        f64::from(monitor.capture_y),
        f64::from(monitor.capture_width),
        f64::from(monitor.capture_height),
    );
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let (screen_x, screen_y, screen_width, screen_height) = (
        f64::from(monitor.x),
        f64::from(monitor.y),
        f64::from(monitor.width),
        f64::from(monitor.height),
    );

    let selection_left = screen_x + request.x.max(0.0);
    let selection_top = screen_y + request.y.max(0.0);
    let selection_width = request.width.max(1.0);
    let selection_height = request.height.max(1.0);
    let min_x = screen_x + CONTROLS_MARGIN;
    let max_x = screen_x + screen_width - CONTROLS_WIDTH - CONTROLS_MARGIN;
    let min_y = screen_y + CONTROLS_MARGIN;
    let max_y = screen_y + screen_height - CONTROLS_HEIGHT - CONTROLS_MARGIN;
    let mut x = selection_left + selection_width * 0.5 - CONTROLS_WIDTH * 0.5;
    let mut y = selection_top + selection_height + CONTROLS_MARGIN;
    if y > max_y {
        y = selection_top + selection_height - CONTROLS_HEIGHT - CONTROLS_MARGIN;
    }
    x = x.clamp(min_x, max_x.max(min_x));
    y = y.clamp(min_y, max_y.max(min_y));

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = window.set_position(tauri::PhysicalPosition::new(
            x.round() as i32,
            y.round() as i32,
        ));
    }
}

fn snipping_show_recording_controls(
    app: &AppHandle,
    monitor: &SnippingAreaMonitor,
    request: &SnippingAreaSelectionRequest,
) -> Result<(), String> {
    let window = snipping_recording_controls_window(app)?;
    snipping_position_recording_controls(&window, monitor, request);
    snipping_set_recording_controls_capture_exclusion(&window, true);
    #[cfg(target_os = "macos")]
    snipping_recording_controls_apply_macos_style(&window);
    snipping_show_window_now(&window, "recording_controls_show");
    #[cfg(target_os = "macos")]
    snipping_preview_order_front_regardless(&window);
    Ok(())
}

fn snipping_hide_recording_controls(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SNIPPING_RECORDING_CONTROLS_WINDOW_LABEL) {
        snipping_hide_window_now(&window, "recording_controls_hide");
        snipping_set_recording_controls_capture_exclusion(&window, false);
    }
}

fn snipping_stop_recording_for(app: &AppHandle, reason: &str) -> Result<Value, String> {
    let state = app.state::<SnippingState>().recording.clone();
    let session = state
        .active
        .lock()
        .map_err(|_| "Unable to lock screen recording state.".to_string())?
        .clone();
    if let Some(session) = session {
        let stop_requested_at_ms = current_time_ms();
        let _ = session.stop_requested_at_ms.compare_exchange(
            0,
            stop_requested_at_ms,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
        session.stop.store(true, Ordering::Release);
        snipping_hide_recording_controls(app);
        return Ok(json!({
            "kind": "snipping_recording_stopping",
            "active": true,
            "reason": reason,
            "path": session.target_path.display().to_string(),
            "localPath": session.target_path.display().to_string(),
            "startedAtMs": session.started_at_ms,
            "width": session.width,
            "height": session.height,
        }));
    }
    snipping_hide_recording_controls(app);
    Ok(json!({
        "kind": "snipping_recording_stopping",
        "active": false,
        "reason": reason,
    }))
}

fn snipping_recording_loop(
    app: AppHandle,
    session: SnippingRecordingSession,
    monitor: SnippingAreaMonitor,
    source_x: u32,
    source_y: u32,
    source_width: u32,
    source_height: u32,
    frame_x: u32,
    frame_y: u32,
    reason: String,
    shortcut: String,
) {
    let session_id = session.id.clone();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        snipping_recording_loop_inner(
            &app,
            &session,
            monitor,
            source_x,
            source_y,
            source_width,
            source_height,
            frame_x,
            frame_y,
            reason,
            shortcut,
        )
    }))
    .map_err(|_| "Screen recording backend panicked.".to_string())
    .and_then(|value| value);

    if let Err(error) = result {
        let _ = fs::remove_file(&session.tmp_path);
        log_terminal_status_event(
            "backend.snipping.recording.error",
            json!({
                "error": error,
                "path": session.target_path.display().to_string(),
            }),
        );
    }
    snipping_clear_recording_if_current(&app, &session_id);
    snipping_hide_recording_controls(&app);
    snipping_start_warm_capture_if_ready(&app);
}

#[cfg(target_os = "macos")]
fn snipping_recording_excluded_targets() -> Option<Vec<scap::Target>> {
    let targets = std::panic::catch_unwind(scap::get_all_targets)
        .unwrap_or_default()
        .into_iter()
        .filter(|target| match target {
            scap::Target::Window(window) => {
                window.title.trim() == SNIPPING_RECORDING_CONTROLS_TITLE
            }
            scap::Target::Display(_) => false,
        })
        .collect::<Vec<_>>();
    (!targets.is_empty()).then_some(targets)
}

#[cfg(not(target_os = "macos"))]
fn snipping_recording_excluded_targets() -> Option<Vec<scap::Target>> {
    None
}

#[allow(clippy::too_many_arguments)]
fn snipping_recording_loop_inner(
    app: &AppHandle,
    session: &SnippingRecordingSession,
    monitor: SnippingAreaMonitor,
    source_x: u32,
    source_y: u32,
    source_width: u32,
    source_height: u32,
    frame_x: u32,
    frame_y: u32,
    reason: String,
    shortcut: String,
) -> Result<(), String> {
    snipping_ensure_scap_ready()?;
    let target = snipping_scap_display_target_for_area_monitor(&monitor);
    let crop_area = Some(snipping_scap_capture_area(
        source_x,
        source_y,
        source_width,
        source_height,
    ));
    let options = scap::capturer::Options {
        fps: SNIPPING_RECORDING_FPS,
        show_cursor: true,
        show_highlight: false,
        target,
        crop_area,
        output_type: scap::frame::FrameType::BGRAFrame,
        output_resolution: scap::capturer::Resolution::Captured,
        excluded_targets: snipping_recording_excluded_targets(),
        captures_audio: false,
        exclude_current_process_audio: true,
    };
    let mut capturer = scap::capturer::Capturer::build(options)
        .map_err(|error| format!("Unable to initialize screen recording: {error}"))?;

    let encoder_config = snipping_recording_encoder_config(session.width, session.height);
    let mut encoder = openh264::encoder::Encoder::with_api_config(
        openh264::OpenH264API::from_source(),
        encoder_config,
    )
    .map_err(|error| format!("Unable to initialize screen recording encoder: {error}"))?;
    let file = fs::File::create(&session.tmp_path).map_err(|error| {
        format!(
            "Unable to create recording file {}: {error}",
            session.tmp_path.display()
        )
    })?;
    let mut writer = std::io::BufWriter::new(file);
    let mut muxer = mp4e::Mp4e::new(&mut writer);
    let create_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    muxer.set_create_time(create_time);
    muxer.set_video_track(session.width, session.height, mp4e::Codec::AVC);

    capturer.start_capture();
    let mut sample_count = 0_u64;
    let mut first_frame_epoch_ms = None;
    let mut last_frame_pts_ms = None;
    let mut pending_h264_frame: Option<Vec<u8>> = None;
    let mut pending_h264_pts_ms = 0_u64;
    let mut yuv_frame = Vec::new();
    let mut h264_frame = Vec::new();
    let write_result = (|| -> Result<(), String> {
        while !session.stop.load(Ordering::Acquire) {
            match capturer
                .get_next_frame()
                .map_err(|error| format!("Unable to receive screen recording frame: {error}"))?
            {
                scap::frame::Frame::Video(frame) => {
                    let (bytes, frame_width, frame_height, display_time) =
                        snipping_scap_video_frame_to_bgra_bytes(frame)?;
                    let frame_epoch_ms =
                        snipping_recording_system_time_ms(display_time).unwrap_or_else(current_time_ms);
                    let frame_pts_ms = snipping_recording_frame_pts_ms(
                        frame_epoch_ms,
                        &mut first_frame_epoch_ms,
                        &mut last_frame_pts_ms,
                    );
                    let frame_bytes =
                        if frame_width == session.width && frame_height == session.height {
                            bytes
                        } else if frame_width >= frame_x.saturating_add(session.width)
                            && frame_height >= frame_y.saturating_add(session.height)
                        {
                            snipping_crop_bgra_bytes(
                                &bytes,
                                frame_width,
                                frame_height,
                                frame_x,
                                frame_y,
                                session.width,
                                session.height,
                            )
                            .ok_or_else(|| {
                                "Unable to crop screen recording frame.".to_string()
                            })?
                        } else if frame_width >= session.width && frame_height >= session.height {
                            snipping_crop_bgra_bytes(
                                &bytes,
                                frame_width,
                                frame_height,
                                0,
                                0,
                                session.width,
                                session.height,
                            )
                            .ok_or_else(|| {
                                "Unable to crop screen recording frame.".to_string()
                            })?
                        } else {
                            continue;
                        };
                    snipping_bgra_to_i420(
                        &frame_bytes,
                        session.width,
                        session.height,
                        &mut yuv_frame,
                    )?;
                    let y_len = usize::try_from(session.width)
                        .ok()
                        .and_then(|frame_width| {
                            usize::try_from(session.height)
                                .ok()
                                .and_then(|frame_height| frame_width.checked_mul(frame_height))
                        })
                        .ok_or_else(|| "Screen recording frame is too large.".to_string())?;
                    let uv_len = y_len / 4;
                    let (y_plane, uv_plane) = yuv_frame.split_at(y_len);
                    let (u_plane, v_plane) = uv_plane.split_at(uv_len);
                    let yuv_source = openh264::formats::YUVSlices::new(
                        (y_plane, u_plane, v_plane),
                        (session.width as usize, session.height as usize),
                        (
                            session.width as usize,
                            (session.width / 2) as usize,
                            (session.width / 2) as usize,
                        ),
                    );
                    let bitstream = encoder
                        .encode_at(
                            &yuv_source,
                            openh264::Timestamp::from_millis(frame_pts_ms),
                        )
                        .map_err(|error| format!("Unable to encode recording frame: {error}"))?;
                    let has_video_slice =
                        snipping_h264_annexb_from_bitstream(&bitstream, &mut h264_frame);
                    if h264_frame.is_empty() {
                        continue;
                    }
                    if !has_video_slice {
                        muxer
                            .encode_video(&h264_frame, 0)
                            .map_err(|error| format!("Unable to write recording frame: {error}"))?;
                        continue;
                    }
                    if let Some(pending_frame) = pending_h264_frame.take() {
                        let duration_ms = snipping_recording_sample_duration_ms(
                            pending_h264_pts_ms,
                            frame_pts_ms,
                        );
                        muxer
                            .encode_video(&pending_frame, duration_ms)
                            .map_err(|error| format!("Unable to write recording frame: {error}"))?;
                        sample_count = sample_count.saturating_add(1);
                    }
                    pending_h264_pts_ms = frame_pts_ms;
                    pending_h264_frame = Some(std::mem::take(&mut h264_frame));
                }
                scap::frame::Frame::Audio(_) => {}
            }
        }
        if let Some(pending_frame) = pending_h264_frame.take() {
            let duration_ms = snipping_recording_final_sample_duration_ms(
                first_frame_epoch_ms,
                pending_h264_pts_ms,
                session.stop_requested_at_ms.load(Ordering::Acquire),
            );
            muxer
                .encode_video(&pending_frame, duration_ms)
                .map_err(|error| format!("Unable to write recording frame: {error}"))?;
            sample_count = sample_count.saturating_add(1);
        }
        if sample_count == 0 {
            return Err("Recording stopped before any frames were captured.".to_string());
        }
        muxer
            .flush()
            .map_err(|error| format!("Unable to finalize screen recording: {error}"))?;
        Ok(())
    })();

    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        capturer.stop_capture();
    }));
    drop(muxer);
    writer
        .flush()
        .map_err(|error| format!("Unable to flush recording file: {error}"))?;
    write_result?;

    let size = fs::metadata(&session.tmp_path)
        .map_err(|error| format!("Unable to read recording file {}: {error}", session.tmp_path.display()))?
        .len();
    if size == 0 {
        let _ = fs::remove_file(&session.tmp_path);
        return Err("Recording file is empty.".to_string());
    }
    if let Err(error) = snipping_validate_recording_mp4(&session.tmp_path) {
        let _ = fs::remove_file(&session.tmp_path);
        return Err(error);
    }
    fs::rename(&session.tmp_path, &session.target_path).map_err(|error| {
        let _ = fs::remove_file(&session.tmp_path);
        format!(
            "Unable to move recording {} to {}: {error}",
            session.tmp_path.display(),
            session.target_path.display()
        )
    })?;

    let stopped_at_ms = session.stop_requested_at_ms.load(Ordering::Acquire);
    let duration_ms = if stopped_at_ms > 0 {
        stopped_at_ms
    } else {
        current_time_ms()
    }
    .saturating_sub(session.started_at_ms);
    snipping_emit_untracked_video_saved_with_toast(
        app,
        &session.target_path,
        session.width,
        session.height,
        duration_ms,
        "recording",
        &reason,
        shortcut,
        None,
        true,
    )?;
    Ok(())
}

fn snipping_even_recording_rect(
    frame_width: u32,
    frame_height: u32,
    selection_x: u32,
    selection_y: u32,
    selection_width: u32,
    selection_height: u32,
) -> (u32, u32, u32, u32) {
    let frame_width = frame_width.max(1);
    let frame_height = frame_height.max(1);
    let mut x = selection_x.min(frame_width.saturating_sub(1));
    let mut y = selection_y.min(frame_height.saturating_sub(1));
    let mut width = selection_width.min(frame_width.saturating_sub(x));
    let mut height = selection_height.min(frame_height.saturating_sub(y));
    if width > 2 {
        width -= width % 2;
    }
    if height > 2 {
        height -= height % 2;
    }
    width = width.max(1);
    height = height.max(1);
    if x.saturating_add(width) > frame_width {
        x = frame_width.saturating_sub(width);
    }
    if y.saturating_add(height) > frame_height {
        y = frame_height.saturating_sub(height);
    }
    (x, y, width, height)
}

#[derive(Clone, Copy)]
struct SnippingRecordingArea {
    source_x: u32,
    source_y: u32,
    source_width: u32,
    source_height: u32,
    frame_x: u32,
    frame_y: u32,
    frame_width: u32,
    frame_height: u32,
}

fn snipping_recording_capture_scale(monitor: &SnippingAreaMonitor) -> f64 {
    if monitor.snapshot_width > 0 && monitor.capture_width > 0 {
        return (f64::from(monitor.snapshot_width) / f64::from(monitor.capture_width)).max(0.1);
    }
    monitor.scale_factor.max(0.1)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn snipping_recording_area_from_selection(
    monitor: &SnippingAreaMonitor,
    request: &SnippingAreaSelectionRequest,
) -> SnippingRecordingArea {
    let source_x = request.x.max(0.0).round() as u32;
    let source_y = request.y.max(0.0).round() as u32;
    let source_width = request.width.max(0.0).round() as u32;
    let source_height = request.height.max(0.0).round() as u32;
    let (source_x, source_y, source_width, source_height) = snipping_even_recording_rect(
        monitor.capture_width,
        monitor.capture_height,
        source_x,
        source_y,
        source_width,
        source_height,
    );

    let scale = snipping_recording_capture_scale(monitor);
    let frame_x = (f64::from(source_x) * scale).round() as u32;
    let frame_y = (f64::from(source_y) * scale).round() as u32;
    let frame_width = ((f64::from(source_width) * scale).round() as u32).max(1);
    let frame_height = ((f64::from(source_height) * scale).round() as u32).max(1);
    let (_, _, frame_width, frame_height) =
        snipping_even_recording_rect(u32::MAX, u32::MAX, 0, 0, frame_width, frame_height);

    SnippingRecordingArea {
        source_x,
        source_y,
        source_width,
        source_height,
        frame_x,
        frame_y,
        frame_width,
        frame_height,
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn snipping_recording_area_from_selection(
    monitor: &SnippingAreaMonitor,
    selection_x: u32,
    selection_y: u32,
    selection_width: u32,
    selection_height: u32,
) -> SnippingRecordingArea {
    let frame_width = monitor
        .snapshot_width
        .max(monitor.width)
        .max(monitor.capture_width)
        .max(1);
    let frame_height = monitor
        .snapshot_height
        .max(monitor.height)
        .max(monitor.capture_height)
        .max(1);
    let (x, y, width, height) = snipping_even_recording_rect(
        frame_width,
        frame_height,
        selection_x,
        selection_y,
        selection_width,
        selection_height,
    );
    SnippingRecordingArea {
        source_x: x,
        source_y: y,
        source_width: width,
        source_height: height,
        frame_x: x,
        frame_y: y,
        frame_width: width,
        frame_height: height,
    }
}

fn snipping_start_area_recording_for(
    app: &AppHandle,
    overlay_label: &str,
    request: SnippingAreaSelectionRequest,
) -> Result<Value, String> {
    ensure_snipping_enabled(app)?;
    let mode = snipping_area_session_mode(app, overlay_label)?;
    if mode != SnippingAreaMode::Recording {
        return Err("Start recording from the recording area picker.".to_string());
    }
    let (monitor, _selection_x, _selection_y, selection_width, selection_height) =
        snipping_scaled_area_selection(app, overlay_label, &request)?;
    if selection_width < SNIPPING_MIN_RECORDING_PIXELS
        || selection_height < SNIPPING_MIN_RECORDING_PIXELS
    {
        snipping_clear_area_sessions(app)?;
        snipping_hide_area_overlay(app);
        return Err("Recording area is too small.".to_string());
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let recording_area = snipping_recording_area_from_selection(&monitor, &request);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let recording_area = snipping_recording_area_from_selection(
        &monitor,
        _selection_x,
        _selection_y,
        selection_width,
        selection_height,
    );
    if recording_area.frame_width < SNIPPING_MIN_RECORDING_PIXELS
        || recording_area.frame_height < SNIPPING_MIN_RECORDING_PIXELS
    {
        snipping_clear_area_sessions(app)?;
        snipping_hide_area_overlay(app);
        return Err("Recording area is too small.".to_string());
    }

    let (target_path, tmp_path) = snipping_prepare_recording_path("recording")?;
    let session = SnippingRecordingSession {
        id: uuid::Uuid::new_v4().to_string(),
        stop: Arc::new(AtomicBool::new(false)),
        stop_requested_at_ms: Arc::new(AtomicU64::new(0)),
        target_path,
        tmp_path,
        started_at_ms: current_time_ms(),
        width: recording_area.frame_width,
        height: recording_area.frame_height,
    };
    {
        let state = app.state::<SnippingState>().recording.clone();
        let mut guard = state
            .active
            .lock()
            .map_err(|_| "Unable to lock screen recording state.".to_string())?;
        if guard.is_some() {
            return Err("A screen recording is already in progress.".to_string());
        }
        *guard = Some(session.clone());
    }

    snipping_stop_warm_capture(app);
    snipping_clear_area_sessions(app)?;
    snipping_hide_area_overlay(app);
    thread::sleep(Duration::from_millis(SNIPPING_CAPTURE_HIDE_OVERLAY_DELAY_MS));
    if let Err(error) = snipping_show_recording_controls(app, &monitor, &request) {
        snipping_clear_recording_if_current(app, &session.id);
        snipping_start_warm_capture_if_ready(app);
        return Err(error);
    }

    let app_for_thread = app.clone();
    let session_for_thread = session.clone();
    thread::spawn(move || {
        snipping_recording_loop(
            app_for_thread,
            session_for_thread,
            monitor,
            recording_area.source_x,
            recording_area.source_y,
            recording_area.source_width,
            recording_area.source_height,
            recording_area.frame_x,
            recording_area.frame_y,
            "area-recording".to_string(),
            String::new(),
        );
    });

    Ok(json!({
        "kind": "snipping_recording_started",
        "path": session.target_path.display().to_string(),
        "local_path": session.target_path.display().to_string(),
        "localPath": session.target_path.display().to_string(),
        "started_at_ms": session.started_at_ms,
        "startedAtMs": session.started_at_ms,
        "width": recording_area.frame_width,
        "height": recording_area.frame_height,
    }))
}

fn snipping_toggle_area_recording_shortcut_for(
    app: &AppHandle,
    reason: &str,
    shortcut: String,
) -> Result<Value, String> {
    if snipping_recording_active(app) {
        return snipping_stop_recording_for(app, reason);
    }
    snipping_begin_area_recording_for(app, reason, shortcut)
}

fn snipping_copy_untracked_asset_to_clipboard_for(path: String) -> Result<Value, String> {
    let file = diffforge_untracked_asset_file(&path)?;
    diffforge_copy_image_file_to_clipboard(&file)
}

fn snipping_copy_text_to_clipboard_for(value: String) -> Result<Value, String> {
    let normalized = value.trim().to_string();
    if normalized.is_empty() {
        return Err("Nothing to copy.".to_string());
    }
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("Unable to open system clipboard: {error}"))?;
    clipboard
        .set_text(normalized.clone())
        .map_err(|error| format!("Unable to copy text to clipboard: {error}"))?;
    Ok(json!({
        "kind": "snipping_text_copied",
        "text": normalized,
    }))
}

fn snipping_url_token(value: &str) -> String {
    general_purpose::URL_SAFE_NO_PAD.encode(value.as_bytes())
}

fn snipping_window_token(path: &Path) -> String {
    let seed = format!("{}:{}", path.display(), uuid::Uuid::new_v4());
    cloud_mcp_short_hash(&seed)
}

fn snipping_center_floating_window(app: &AppHandle, window: &tauri::WebviewWindow) {
    let monitor = app
        .get_webview_window("main")
        .and_then(|main_window| main_window.current_monitor().ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        let _ = window.center();
        return;
    };

    let work_area = monitor.work_area();
    let Ok(size) = window.outer_size() else {
        let _ = window.center();
        return;
    };
    let x = work_area.position.x + ((work_area.size.width as i32 - size.width as i32) / 2).max(0);
    let y = work_area.position.y + ((work_area.size.height as i32 - size.height as i32) / 2).max(0);
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

/// Width/height from a PNG header (snips are always PNG); None for other
/// formats or unreadable files.
fn snipping_png_dimensions(path: &Path) -> Option<(u32, u32)> {
    use std::io::Read as _;
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0u8; 24];
    file.read_exact(&mut header).ok()?;
    if header[0..8] != [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]
        || &header[12..16] != b"IHDR"
    {
        return None;
    }
    let width = u32::from_be_bytes([header[16], header[17], header[18], header[19]]);
    let height = u32::from_be_bytes([header[20], header[21], header[22], header[23]]);
    (width > 0 && height > 0).then_some((width, height))
}

fn snipping_open_annotation_editor_for_paths(
    app: &AppHandle,
    paths: Vec<String>,
) -> Result<Value, String> {
    let mut files = Vec::new();
    for path in paths {
        let value = path.trim();
        if value.is_empty() {
            continue;
        }
        let file = diffforge_local_asset_file(value)?;
        if !files.iter().any(|existing: &PathBuf| existing == &file) {
            files.push(file);
        }
    }
    if files.is_empty() {
        return Err("Select at least one local image to annotate.".to_string());
    }
    let path_values = files
        .iter()
        .map(|file| file.display().to_string())
        .collect::<Vec<_>>();
    // One live editor per asset: if any requested path is already open in an
    // annotation editor, focus that window instead of spawning a second one
    // that would race it on autosave.
    let editor_paths = app.state::<SnippingState>().editor_paths.clone();
    let label = format!(
        "{}-{}",
        SNIPPING_EDITOR_WINDOW_PREFIX,
        cloud_mcp_short_hash(&path_values.join("|"))
    );
    {
        let mut open = editor_paths
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        open.retain(|open_label, _| app.get_webview_window(open_label).is_some());
        let existing = open
            .iter()
            .find(|(_, open_paths)| {
                open_paths
                    .iter()
                    .any(|open_path| path_values.contains(open_path))
            })
            .map(|(open_label, open_paths)| (open_label.clone(), open_paths.clone()));
        if let Some((existing_label, existing_paths)) = existing {
            if let Some(window) = app.get_webview_window(&existing_label) {
                snipping_unminimize_window_now(&window, "focus_existing_editor_unminimize");
                snipping_show_window_now(&window, "focus_existing_editor_show");
                snipping_focus_window_now(&window, "focus_existing_editor_focus");
                return Ok(json!({
                    "kind": "snipping_floating_asset_window_focused",
                    "label": existing_label,
                    "paths": existing_paths,
                }));
            }
        }
        open.insert(label.clone(), path_values.clone());
    }
    let encoded_paths = snipping_url_token(
        &serde_json::to_string(&path_values)
            .map_err(|error| format!("Unable to encode annotation paths: {error}"))?,
    );
    // Size the editor to the snip itself so the canvas fills the stage
    // instead of floating inside empty chrome: image logical size plus the
    // tool rail / title bar / composer, clamped to the monitor work area.
    let monitor = app
        .get_webview_window("main")
        .and_then(|main_window| main_window.current_monitor().ok().flatten());
    let scale = monitor
        .as_ref()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0)
        .max(0.5);
    let (image_width, image_height) = files
        .first()
        .and_then(|file| snipping_png_dimensions(file))
        .map(|(width, height)| (f64::from(width) / scale, f64::from(height) / scale))
        .unwrap_or((760.0, 480.0));
    // CSS chrome around the canvas: tool rail + stage padding horizontally;
    // title bar + composer + stage padding vertically (plus the thumbnail
    // strip when editing several images). Matches the compact editor CSS —
    // the composer is a two-row card (prompt line over the dispatch
    // controls), so the vertical chrome is taller than one input row.
    let chrome_width = 62.0;
    let chrome_height = if files.len() > 1 { 230.0 } else { 194.0 };
    // Lean editor: cap well below the work area so the window reads as a
    // focused tool, not a second app taking over the screen.
    let (max_width, max_height) = monitor
        .as_ref()
        .map(|monitor| {
            let area = monitor
                .work_area()
                .size
                .to_logical::<f64>(monitor.scale_factor());
            (area.width * 0.78, area.height * 0.78)
        })
        .unwrap_or((1100.0, 740.0));
    // Golden-ratio window, like the snip previews: the canvas letterboxes
    // inside the stage, so grow the short dimension until W/H = φ around the
    // content, then scale down uniformly (ratio preserved) to the cap.
    let content_width = (image_width + chrome_width).max(420.0);
    let content_height = (image_height + chrome_height).max(1.0);
    let (mut inner_width, mut inner_height) =
        if content_width / content_height > SNIPPING_FLOAT_GOLDEN_RATIO {
            (content_width, content_width / SNIPPING_FLOAT_GOLDEN_RATIO)
        } else {
            (content_height * SNIPPING_FLOAT_GOLDEN_RATIO, content_height)
        };
    let fit = (max_width / inner_width)
        .min(max_height / inner_height)
        .min(1.0)
        .max(0.05);
    inner_width *= fit;
    inner_height *= fit;
    // Comfortable editing floor: small snips still open a workable editor —
    // room for the full-height tool rail, the options pill, the action
    // cluster, and the two-row composer — while bigger snips keep growing
    // through the golden-ratio fit above. Clamped per axis so a wide-short
    // or tall-narrow fit cannot duck under either minimum.
    let min_inner_width = 760.0;
    let min_inner_height = 560.0;
    inner_width = inner_width.max(min_inner_width);
    inner_height = inner_height.max(min_inner_height);
    let window = WebviewWindowBuilder::new(
        app,
        label.clone(),
        WebviewUrl::App(format!("index.html#/snipping-editor/{encoded_paths}").into()),
    )
    .title(if path_values.len() > 1 {
        "Annotate Assets"
    } else {
        "Annotate Snip"
    })
    .inner_size(inner_width, inner_height)
    .min_inner_size(min_inner_width, min_inner_height)
    .resizable(true)
    .decorations(false)
    // Normal z-order: clicking the main Diff Forge window brings it in front
    // of the annotation editor.
    .always_on_top(false)
    .focused(true)
    .accept_first_mouse(true)
    // Transparent window: the webview paints a rounded editor card and macOS
    // derives the native shadow from its alpha, so corners stay round and
    // nothing opaque can flash white before the page's first paint.
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .visible(false)
    .shadow(true)
    .build()
    .map_err(|error| format!("Unable to create annotation editor window: {error}"))?;
    {
        let editor_paths = app.state::<SnippingState>().editor_paths.clone();
        let label_for_destroy = label.clone();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                if let Ok(mut open) = editor_paths.lock() {
                    open.remove(&label_for_destroy);
                }
            }
        });
    }
    snipping_center_floating_window(app, &window);
    // Show the editor shell immediately. index.html paints a lightweight
    // spinner before React boots, then the editor keeps showing its own image
    // loading state until the snip bytes decode.
    snipping_show_window_now(&window, "editor_initial_show");
    snipping_focus_window_now(&window, "editor_initial_focus");
    // React reasserts focus after its first paint. The fallback below only
    // fires if an earlier show call failed or the page failed to boot.
    {
        let app_for_reveal = app.clone();
        let label_for_reveal = label.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let app_for_main = app_for_reveal.clone();
            let _ = app_for_reveal.run_on_main_thread(move || {
                let Some(window) = app_for_main.get_webview_window(&label_for_reveal) else {
                    return;
                };
                if matches!(window.is_visible(), Ok(false)) {
                    snipping_show_window_now(&window, "editor_reveal_fallback_show");
                    snipping_focus_window_now(&window, "editor_reveal_fallback_focus");
                }
            });
        });
    }
    Ok(json!({
        "kind": "snipping_floating_asset_window_opened",
        "label": label,
        "paths": path_values,
    }))
}

fn snipping_upload_untracked_asset_for(
    app: &AppHandle,
    request: SnippingUploadAssetRequest,
) -> Result<Value, String> {
    // Snips are account-level assets: no workspace target is required.
    diffforge_promote_untracked_asset(
        app.clone(),
        request.path,
        request.name,
        request.group.or_else(|| Some("snips".to_string())),
        Some(false),
    )
}

fn snipping_save_edited_untracked_asset_for(
    app: &AppHandle,
    request: SnippingEditedAssetRequest,
) -> Result<Value, String> {
    let source = diffforge_local_asset_file(&request.source_path)?;
    let source_name = source
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("snip");
    let encoded = request
        .image_data_url
        .split_once(',')
        .map(|(_, value)| value)
        .unwrap_or(request.image_data_url.as_str());
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("Unable to decode edited snip image: {error}"))?;
    let image = image::load_from_memory(&bytes)
        .map_err(|error| format!("Edited snip is not a valid image: {error}"))?;
    let width = image.width();
    let height = image.height();
    let root = diffforge_prepare_untracked_asset_root()?;
    let edits_dir = root.join("edits");
    let tmp_dir = root.join(".tmp");
    fs::create_dir_all(&edits_dir).map_err(|error| {
        format!(
            "Unable to create snipping edits directory {}: {error}",
            edits_dir.display()
        )
    })?;
    fs::create_dir_all(&tmp_dir).map_err(|error| {
        format!(
            "Unable to create snipping temp directory {}: {error}",
            tmp_dir.display()
        )
    })?;
    // Annotating an original creates exactly one edited copy. Re-annotating
    // that copy must update it in place instead of multiplying
    // "-edited-edited-…" files.
    let source_is_edited_copy = source
        .parent()
        .and_then(|parent| parent.canonicalize().ok())
        .zip(edits_dir.canonicalize().ok())
        .is_some_and(|(parent, edits)| parent == edits);
    let (target, original_path) = if source_is_edited_copy {
        (source.clone(), None)
    } else {
        let filename = cloud_mcp_sanitize_asset_filename(
            &format!("{source_name}-edited.png"),
            "snip-edited.png",
        );
        (
            cloud_mcp_available_asset_download_path(&edits_dir, &filename),
            Some(source.display().to_string()),
        )
    };
    let tmp = tmp_dir.join(format!(".snip-edited-{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&tmp, &bytes)
        .map_err(|error| format!("Unable to write edited snip {}: {error}", tmp.display()))?;
    fs::rename(&tmp, &target).map_err(|error| {
        let _ = fs::remove_file(&tmp);
        format!(
            "Unable to move edited snip {} to {}: {error}",
            tmp.display(),
            target.display()
        )
    })?;
    // Edits never spawn a second preview window. The original's preview
    // retargets itself to the edited copy (or refreshes in place for
    // re-edits) through the source-updated event below.
    let saved = snipping_emit_untracked_image_saved_with_toast(
        app,
        &target,
        width,
        height,
        "edited",
        "annotation-editor",
        String::new(),
        original_path.clone(),
        false,
    )?;

    let target_path = target.display().to_string();
    let original_for_event = original_path.clone().unwrap_or_else(|| target_path.clone());
    let _ = app.emit(
        SNIPPING_SOURCE_UPDATED_EVENT,
        json!({
            "kind": "snip_source_updated",
            "original_path": original_for_event,
            "originalPath": original_for_event,
            "edited_path": target_path,
            "editedPath": target_path,
            "path": target_path,
            "in_place": source_is_edited_copy,
            "inPlace": source_is_edited_copy,
        }),
    );

    // The original's preview window keeps its label but now shows the edited
    // copy; keep the label -> path map in sync so a later drop consumes the
    // annotated image, not the stale original. Saving NEVER spawns a new
    // preview window: if no preview is showing (dismissed, or opened through
    // the editor directly), the save is just a save.
    if !source_is_edited_copy {
        let source_path = source.display().to_string();
        let closing_labels = snipping_preview_closing_labels(app);
        if let Ok(mut paths) = app.state::<SnippingState>().preview_paths.lock() {
            let mut retargeted = false;
            for (label, open_path) in paths.iter_mut() {
                if open_path == &source_path && !closing_labels.contains(label) {
                    *open_path = target_path.clone();
                    retargeted = true;
                }
            }
            let preview_label = format!(
                "{SNIPPING_FLOAT_WINDOW_PREFIX}-{}",
                snipping_window_token(&source)
            );
            if !retargeted
                && !closing_labels.contains(&preview_label)
                && app.get_webview_window(&preview_label).is_some()
            {
                paths.insert(preview_label, target_path.clone());
            }
        }
        if let Ok(mut editors) = app.state::<SnippingState>().editor_paths.lock() {
            for open_paths in editors.values_mut() {
                if open_paths.iter().any(|open_path| open_path == &source_path)
                    && !open_paths.iter().any(|open_path| open_path == &target_path)
                {
                    open_paths.push(target_path.clone());
                }
            }
        }
    }

    Ok(saved)
}

fn ensure_snipping_enabled(app: &AppHandle) -> Result<(), String> {
    if app
        .state::<SnippingState>()
        .shortcut_manager
        .snapshot()
        .enabled
    {
        return Ok(());
    }

    Err("Snipping is disabled. Turn it on before taking snips.".to_string())
}

fn snipping_capture_full_for(
    app: &AppHandle,
    reason: &str,
    shortcut: String,
) -> Result<Value, String> {
    ensure_snipping_enabled(app)?;
    let exclude_desktop_icons = snipping_should_hide_desktop_icons(app);
    snipping_hide_desktop_icons_for_capture(app);
    let image_result = snipping_monitor_for_full(app).and_then(|monitor| {
        snipping_capture_monitor_full_image(app, &monitor, exclude_desktop_icons)
            .map_err(|error| format!("Unable to capture screenshot: {error}"))
    });
    snipping_restore_desktop_icons_after_capture(app);
    let image = match image_result {
        Ok(image) => image,
        Err(error) => return Err(error),
    };
    snipping_save_image(app, image, "full", reason, shortcut)
}

fn size_snipping_overlay_window(window: &tauri::WebviewWindow, monitor: &SnippingAreaMonitor) {
    // macOS/Linux: position in logical points — physical coordinates are not
    // a uniform space across mixed-DPI displays, so a physical set_position
    // lands a secondary-display overlay in the wrong place. capture_* already
    // holds the logical rect there. Windows keeps the physical path.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let _ = window.set_position(tauri::LogicalPosition::new(
            f64::from(monitor.capture_x),
            f64::from(monitor.capture_y),
        ));
        let _ = window.set_size(tauri::LogicalSize::new(
            monitor.capture_width.max(1) as f64,
            monitor.capture_height.max(1) as f64,
        ));
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = window.set_position(tauri::PhysicalPosition::new(monitor.x, monitor.y));
        let _ = window.set_size(tauri::PhysicalSize::new(monitor.width, monitor.height));
    }
}

fn ensure_snipping_overlay_window(
    app: &AppHandle,
    label: &str,
    monitor: &SnippingAreaMonitor,
) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(label) {
        size_snipping_overlay_window(&window, monitor);
        return Ok(window);
    }

    let logical_width = f64::from(monitor.width) / monitor.scale_factor.max(1.0);
    let logical_height = f64::from(monitor.height) / monitor.scale_factor.max(1.0);
    snipping_forget_area_overlay_ready(app, label);
    let window = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App("index.html#/snipping-overlay".into()),
    )
    .title("Snipping")
    .inner_size(logical_width, logical_height)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .focused(false)
    .accept_first_mouse(true)
    .skip_taskbar(true)
    .visible_on_all_workspaces(true)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .visible(false)
    .shadow(false)
    .build()
    .map_err(|error| format!("Unable to create snipping overlay: {error}"))?;

    {
        let app_for_destroy = app.clone();
        let label_for_destroy = label.to_string();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                snipping_forget_area_overlay_ready(&app_for_destroy, &label_for_destroy);
            }
        });
    }
    size_snipping_overlay_window(&window, monitor);
    #[cfg(target_os = "macos")]
    {
        snipping_convert_overlay_window_to_panel(&window);
        snipping_apply_overlay_fullscreen_window_style(&window);
    }
    Ok(window)
}

/// Window style that lets the selection overlay appear over OTHER apps'
/// fullscreen Spaces (a fullscreen Chrome window, for example) the way the
/// system screenshot UI does. CanJoinAllSpaces alone does not join other apps'
/// fullscreen Spaces: the overlay also needs CanJoinAllApplications and
/// FullScreenAuxiliary. Tao's always-on-top floating level (3) is not reliably
/// above a fullscreen Space's window, so the overlay runs at screen-saver level
/// for the duration of the snip. Applied on the AppKit main thread, and
/// re-asserted on every snip start since both values are plain NSWindow state
/// that other window calls may rewrite.
#[cfg(target_os = "macos")]
fn snipping_apply_overlay_fullscreen_window_style(window: &tauri::WebviewWindow) {
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("apply_overlay_fullscreen_window_style", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            snipping_apply_overlay_fullscreen_window_style_to_ns_window(ns_window);
        });
    });
}

#[cfg(target_os = "macos")]
fn snipping_set_area_crosshair_cursor_now() {
    snipping_catch_objc("set_area_crosshair_cursor", || {
        let before = snipping_macos_current_cursor_debug_value();
        NSCursor::crosshairCursor().set();
        log_snipping_area_cursor_debug_event(
            "native.set_crosshair",
            json!({
                "before": before,
                "after": snipping_macos_current_cursor_debug_value(),
                "context": snipping_macos_cursor_context_debug_value(),
            }),
        );
    });
}

#[cfg(target_os = "macos")]
fn snipping_restore_default_cursor_now() {
    snipping_catch_objc("restore_default_cursor", || {
        let before = snipping_macos_current_cursor_debug_value();
        NSCursor::arrowCursor().set();
        log_snipping_area_cursor_debug_event(
            "native.restore_arrow",
            json!({
                "before": before,
                "after": snipping_macos_current_cursor_debug_value(),
                "context": snipping_macos_cursor_context_debug_value(),
            }),
        );
    });
}

#[cfg(target_os = "macos")]
fn snipping_apply_overlay_fullscreen_window_style_to_ns_window(ns_window: &NSWindow) {
    ns_window.setCollectionBehavior(
        objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllSpaces
            | objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllApplications
            | objc2_app_kit::NSWindowCollectionBehavior::FullScreenAuxiliary
            | objc2_app_kit::NSWindowCollectionBehavior::Stationary
            | objc2_app_kit::NSWindowCollectionBehavior::IgnoresCycle,
    );
    ns_window.setLevel(objc2_app_kit::NSScreenSaverWindowLevel);
    ns_window.setAcceptsMouseMovedEvents(true);
    if SNIPPING_AREA_SESSION_ACTIVE.load(Ordering::Acquire) {
        snipping_force_area_crosshair_for_ns_window(ns_window);
    }
}

#[cfg(target_os = "macos")]
fn snipping_force_area_crosshair_for_ns_window(ns_window: &NSWindow) {
    ns_window.setAcceptsMouseMovedEvents(true);
    if ns_window.areCursorRectsEnabled() {
        ns_window.disableCursorRects();
    }
    ns_window.discardCursorRects();
    NSCursor::crosshairCursor().set();
}

#[cfg(target_os = "macos")]
fn snipping_force_area_crosshair_for_visible_overlays(
    app: &AppHandle,
    reason: &'static str,
    force_log: bool,
) {
    if !SNIPPING_AREA_SESSION_ACTIVE.load(Ordering::Acquire) {
        return;
    }
    snipping_catch_objc("force_area_crosshair_for_visible_overlays", || {
        let should_log = force_log || snipping_area_cursor_debug_should_sample_mouse();
        let before = should_log.then(snipping_macos_current_cursor_debug_value);
        NSCursor::crosshairCursor().set();

        let location = objc2_app_kit::NSEvent::mouseLocation();
        let mut forced_cursor_window = false;
        let mut windows_debug = Vec::new();
        for (_, window) in snipping_overlay_windows(app) {
            let label = window.label().to_string();
            let Ok(ns_ptr) = window.ns_window() else {
                continue;
            };
            if ns_ptr.is_null() {
                continue;
            }
            let ns_window: &NSWindow = unsafe { &*ns_ptr.cast::<NSWindow>() };
            if !ns_window.isVisible() {
                if should_log {
                    windows_debug.push(json!({
                        "label": label,
                        "visible": false,
                    }));
                }
                continue;
            }
            snipping_apply_overlay_fullscreen_window_style_to_ns_window(ns_window);
            ns_window.orderFrontRegardless();
            let frame = ns_window.frame();
            let inside = location.x >= frame.origin.x
                && location.x < frame.origin.x + frame.size.width
                && location.y >= frame.origin.y
                && location.y < frame.origin.y + frame.size.height;
            if should_log {
                windows_debug.push(snipping_macos_window_cursor_debug_value(
                    &label,
                    ns_window,
                    location,
                ));
            }
            if !inside {
                continue;
            }
            if !ns_window.isKeyWindow() {
                ns_window.makeKeyAndOrderFront(None);
            }
            snipping_force_area_crosshair_for_ns_window(ns_window);
            forced_cursor_window = true;
        }

        if !forced_cursor_window {
            for (_, window) in snipping_overlay_windows(app) {
                let label = window.label().to_string();
                let Ok(ns_ptr) = window.ns_window() else {
                    continue;
                };
                if ns_ptr.is_null() {
                    continue;
                }
                let ns_window: &NSWindow = unsafe { &*ns_ptr.cast::<NSWindow>() };
                if !ns_window.isVisible() {
                    continue;
                }
                if should_log {
                    windows_debug.push(json!({
                        "fallback_target": true,
                        "window": snipping_macos_window_cursor_debug_value(
                            &label,
                            ns_window,
                            location,
                        ),
                    }));
                }
                snipping_apply_overlay_fullscreen_window_style_to_ns_window(ns_window);
                ns_window.orderFrontRegardless();
                snipping_force_area_crosshair_for_ns_window(ns_window);
                break;
            }
        }

        NSCursor::crosshairCursor().set();
        if should_log {
            log_snipping_area_cursor_debug_event(
                "native.force_visible_overlays",
                json!({
                    "reason": reason,
                    "mouse_location": snipping_macos_point_debug_value(location),
                    "forced_cursor_window": forced_cursor_window,
                    "before": before.unwrap_or(Value::Null),
                    "after": snipping_macos_current_cursor_debug_value(),
                    "windows": windows_debug,
                    "context": snipping_macos_cursor_context_debug_value(),
                }),
            );
        }
    });
}

#[cfg(target_os = "macos")]
fn snipping_claim_area_crosshair_on_main_thread(app: &AppHandle, reason: &'static str) {
    if let Err(error) = snipping_run_on_main_thread_sync(app, "claim_area_crosshair", move || {
        snipping_set_area_crosshair_cursor_now();
        log_snipping_area_cursor_debug_event(
            "native.claim_crosshair_sync",
            json!({
                "reason": reason,
                "context": snipping_macos_cursor_context_debug_value(),
            }),
        );
        Ok(())
    }) {
        log_snipping_area_cursor_debug_event(
            "native.claim_crosshair_sync_failed",
            json!({
                "reason": reason,
                "error": error,
            }),
        );
    }
}

#[cfg(target_os = "macos")]
fn snipping_force_area_crosshair_for_visible_overlays_on_main_thread(
    app: &AppHandle,
    reason: &'static str,
) {
    let app_for_main = app.clone();
    if let Err(error) = snipping_run_on_main_thread_sync(
        app,
        "force_area_crosshair_for_visible_overlays",
        move || {
            snipping_force_area_crosshair_for_visible_overlays(&app_for_main, reason, true);
            Ok(())
        },
    ) {
        log_snipping_area_cursor_debug_event(
            "native.force_visible_overlays_sync_failed",
            json!({
                "reason": reason,
                "error": error,
            }),
        );
    }
}

#[cfg(target_os = "macos")]
fn snipping_restore_area_overlay_cursor_rects(window: &tauri::WebviewWindow) {
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("restore_area_overlay_cursor_rects", || {
            if SNIPPING_AREA_SESSION_ACTIVE.load(Ordering::Acquire) {
                return;
            }
            let Ok(ns_window) = window_for_main.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            if !ns_window.areCursorRectsEnabled() {
                ns_window.enableCursorRects();
            }
            ns_window.discardCursorRects();
            if let Some(content_view) = ns_window.contentView() {
                ns_window.invalidateCursorRectsForView(&content_view);
            }
            ns_window.resetCursorRects();
        });
    });
}

/// Orders the overlay to the front even while Diff Forge is NOT the active
/// app. tao's show()/set_focus() rely on makeKeyAndOrderFront, which does
/// nothing visible when another app's fullscreen Space is active; AppKit's
/// orderFrontRegardless is the documented way to surface a window from an
/// inactive application.
#[cfg(target_os = "macos")]
fn snipping_order_overlay_front_regardless(window: &tauri::WebviewWindow) {
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("order_overlay_front_regardless", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            ns_window.orderFrontRegardless();
            if SNIPPING_AREA_SESSION_ACTIVE.load(Ordering::Acquire) {
                snipping_force_area_crosshair_for_ns_window(ns_window);
            }
        });
    });
}

#[cfg(target_os = "macos")]
extern "C" fn snipping_panel_can_become_key(
    _this: &objc2::runtime::AnyObject,
    _sel: objc2::runtime::Sel,
) -> objc2::runtime::Bool {
    objc2::runtime::Bool::YES
}

#[cfg(target_os = "macos")]
extern "C" fn snipping_panel_can_become_main(
    _this: &objc2::runtime::AnyObject,
    _sel: objc2::runtime::Sel,
) -> objc2::runtime::Bool {
    objc2::runtime::Bool::NO
}

/// NSPanel subclass the overlay window is re-classed into. Layout parity
/// with tao's `TaoWindow` (NSWindow + one `focusable` Bool ivar) is required:
/// `object_setClass` keeps the instance bytes, so the replacement class must
/// have the identical instance size. `canBecomeKeyWindow` is forced YES (the
/// panel must take key while Diff Forge is inactive) and main is refused —
/// a capture overlay should never be the app's main window.
#[cfg(target_os = "macos")]
fn snipping_overlay_panel_class() -> Option<&'static objc2::runtime::AnyClass> {
    static PANEL_CLASS: OnceLock<Option<&'static objc2::runtime::AnyClass>> = OnceLock::new();
    *PANEL_CLASS.get_or_init(|| {
        let superclass = objc2::class!(NSPanel);
        let mut builder = objc2::runtime::ClassBuilder::new(c"DiffForgeSnipPanel", superclass)?;
        builder.add_ivar::<objc2::runtime::Bool>(c"focusable");
        unsafe {
            builder.add_method(
                objc2::sel!(canBecomeKeyWindow),
                snipping_panel_can_become_key as extern "C" fn(_, _) -> _,
            );
            builder.add_method(
                objc2::sel!(canBecomeMainWindow),
                snipping_panel_can_become_main as extern "C" fn(_, _) -> _,
            );
        }
        Some(builder.register())
    })
}

/// AppKit exception guard for raw main-thread window calls. An NSException
/// that unwinds out of a runloop callback crosses Rust's catch_unwind in
/// tao's observer as a FOREIGN exception, which aborts the whole process
/// (SIGABRT in __rust_foreign_exception — seen closing a re-classed snip
/// preview). Catch at the ObjC boundary and log instead.
#[cfg(target_os = "macos")]
fn snipping_catch_objc<F: FnOnce()>(context: &'static str, work: F) {
    let outcome = objc2::exception::catch(std::panic::AssertUnwindSafe(work));
    if let Err(exception) = outcome {
        let exception = exception
            .map(|error| format!("{error:?}"))
            .unwrap_or_else(|| "unknown".to_string());
        log_terminal_status_event(
            "backend.snipping.objc_exception",
            json!({
                "context": context,
                "exception": exception,
            }),
        );
    }
}

#[cfg(target_os = "macos")]
fn snipping_catch_objc_result<T, F>(context: &'static str, work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    match objc2::exception::catch(std::panic::AssertUnwindSafe(work)) {
        Ok(result) => result,
        Err(exception) => {
            let exception = exception
                .map(|error| format!("{error:?}"))
                .unwrap_or_else(|| "unknown".to_string());
            log_terminal_status_event(
                "backend.snipping.objc_exception",
                json!({
                    "context": context,
                    "exception": exception,
                }),
            );
            Err(format!("macOS snipping window operation failed: {context}"))
        }
    }
}

/// The class tao gave our windows before any panel re-classing, captured the
/// first time a conversion runs so teardown can restore it.
#[cfg(target_os = "macos")]
static SNIPPING_PANEL_ORIGINAL_CLASS: OnceLock<&'static objc2::runtime::AnyClass> = OnceLock::new();

/// Re-classes the tao NSWindow into a non-activating NSPanel. A regular
/// NSWindow of an inactive app can never become key, and activating the app
/// (tao's set_focus) either gets denied by macOS 14+ cooperative activation
/// or yanks the user out of the fullscreen Space they invoked the snip on.
/// A panel with NSWindowStyleMaskNonactivatingPanel takes key input with the
/// app left inactive — the same technique CleanShot/Raycast-style overlays
/// and Electron's panel windows use.
#[cfg(target_os = "macos")]
fn snipping_convert_ns_window_to_panel(ns_window: &NSWindow) {
    let Some(panel_class) = snipping_overlay_panel_class() else {
        return;
    };
    let object: &objc2::runtime::AnyObject =
        unsafe { &*(ns_window as *const NSWindow).cast::<objc2::runtime::AnyObject>() };
    if !std::ptr::eq(object.class(), panel_class) {
        let _ = SNIPPING_PANEL_ORIGINAL_CLASS.set(object.class());
        unsafe {
            objc2::runtime::AnyObject::set_class(object, panel_class);
        }
    }
    let panel: &objc2_app_kit::NSPanel =
        unsafe { &*(ns_window as *const NSWindow).cast::<objc2_app_kit::NSPanel>() };
    panel.setStyleMask(panel.styleMask() | objc2_app_kit::NSWindowStyleMask::NonactivatingPanel);
    panel.setBecomesKeyOnlyIfNeeded(false);
    panel.setWorksWhenModal(true);
    // NSPanel semantics would otherwise order the overlay out whenever
    // the app deactivates — which is the normal state during a snip.
    panel.setHidesOnDeactivate(false);
}

#[cfg(target_os = "macos")]
fn snipping_convert_overlay_window_to_panel(window: &tauri::WebviewWindow) {
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("convert_overlay_window_to_panel", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            snipping_convert_ns_window_to_panel(ns_window);
        });
    });
}

/// Undoes the panel re-class right before a converted window closes: AppKit
/// tears the window down through NSPanel code paths the instance was never
/// initialized for (it was allocated as tao's plain NSWindow subclass), and
/// that teardown can raise — crashing the app — once the window is in an
/// ordering transaction. Restoring the original class makes close boring.
#[cfg(target_os = "macos")]
fn snipping_restore_window_class_for_close_now(window: &tauri::WebviewWindow) {
    let Some(panel_class) = snipping_overlay_panel_class() else {
        return;
    };
    let Some(original_class) = SNIPPING_PANEL_ORIGINAL_CLASS.get().copied() else {
        return;
    };
    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    if ns_window.is_null() {
        return;
    }
    let object: &objc2::runtime::AnyObject = unsafe { &*ns_window.cast::<objc2::runtime::AnyObject>() };
    if std::ptr::eq(object.class(), panel_class) {
        unsafe {
            objc2::runtime::AnyObject::set_class(object, original_class);
        }
    }
}

#[cfg(target_os = "macos")]
fn snipping_close_window_now(window: &tauri::WebviewWindow, context: &'static str) {
    snipping_catch_objc(context, || {
        snipping_restore_window_class_for_close_now(window);
        let _ = window.close();
    });
}

#[cfg(not(target_os = "macos"))]
fn snipping_close_window_now(window: &tauri::WebviewWindow, _context: &'static str) {
    let _ = window.close();
}

fn snipping_close_window_guarded(window: &tauri::WebviewWindow, context: &'static str) {
    let window_for_main = window.clone();
    let window_for_close = window_for_main.clone();
    let _ = window_for_main.run_on_main_thread(move || {
        snipping_close_window_now(&window_for_close, context);
    });
}

#[cfg(target_os = "macos")]
fn snipping_hide_window_now(window: &tauri::WebviewWindow, context: &'static str) {
    snipping_catch_objc(context, || {
        let _ = window.hide();
    });
}

#[cfg(not(target_os = "macos"))]
fn snipping_hide_window_now(window: &tauri::WebviewWindow, _context: &'static str) {
    let _ = window.hide();
}

#[cfg(target_os = "macos")]
fn snipping_show_window_now(window: &tauri::WebviewWindow, context: &'static str) -> bool {
    snipping_catch_objc_result(context, || {
        window.show().map_err(|error| format!("{error}"))
    })
    .is_ok()
}

#[cfg(not(target_os = "macos"))]
fn snipping_show_window_now(window: &tauri::WebviewWindow, _context: &'static str) -> bool {
    window.show().is_ok()
}

#[cfg(target_os = "macos")]
fn snipping_show_area_overlay_window_for_session(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    label: &str,
) -> bool {
    let window_for_main = window.clone();
    let label_for_main = label.to_string();
    let label_for_error = label_for_main.clone();
    match snipping_run_on_main_thread_sync(app, "show_area_overlay_window", move || {
        snipping_catch_objc_result("show_area_overlay_window", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return Err("Unable to access snipping overlay NSWindow.".to_string());
            };
            if ns_window.is_null() {
                return Err("Snipping overlay NSWindow is null.".to_string());
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            snipping_convert_ns_window_to_panel(ns_window);
            snipping_apply_overlay_fullscreen_window_style_to_ns_window(ns_window);
            window_for_main
                .show()
                .map_err(|error| format!("{error}"))?;
            ns_window.orderFrontRegardless();
            if SNIPPING_AREA_SESSION_ACTIVE.load(Ordering::Acquire) {
                snipping_force_area_crosshair_for_ns_window(ns_window);
            }
            NSCursor::crosshairCursor().set();
            log_snipping_area_cursor_debug_event(
                "native.overlay_show_crosshair_committed",
                json!({
                    "overlay_label": &label_for_main,
                    "window": snipping_macos_window_cursor_debug_value(
                        &label_for_main,
                        ns_window,
                        objc2_app_kit::NSEvent::mouseLocation(),
                    ),
                    "context": snipping_macos_cursor_context_debug_value(),
                }),
            );
            Ok(())
        })
    }) {
        Ok(()) => true,
        Err(error) => {
            log_snipping_area_cursor_debug_event(
                "native.overlay_show_crosshair_failed",
                json!({
                    "overlay_label": label_for_error,
                    "error": error,
                }),
            );
            false
        }
    }
}

#[cfg(target_os = "macos")]
fn snipping_focus_window_now(window: &tauri::WebviewWindow, context: &'static str) -> bool {
    snipping_catch_objc_result(context, || {
        window.set_focus().map_err(|error| format!("{error}"))
    })
    .is_ok()
}

#[cfg(not(target_os = "macos"))]
fn snipping_focus_window_now(window: &tauri::WebviewWindow, _context: &'static str) -> bool {
    window.set_focus().is_ok()
}

#[cfg(target_os = "macos")]
fn snipping_unminimize_window_now(window: &tauri::WebviewWindow, context: &'static str) -> bool {
    snipping_catch_objc_result(context, || {
        window.unminimize().map_err(|error| format!("{error}"))
    })
    .is_ok()
}

#[cfg(not(target_os = "macos"))]
fn snipping_unminimize_window_now(window: &tauri::WebviewWindow, _context: &'static str) -> bool {
    window.unminimize().is_ok()
}

/// Makes one overlay panel the key window WITHOUT activating the app — the
/// non-activating panel accepts key status while another app (a fullscreen
/// Chrome, say) stays active, so hover tracking and webview keyboard input
/// work and macOS never switches Spaces.
#[cfg(target_os = "macos")]
fn snipping_make_overlay_key(window: &tauri::WebviewWindow) {
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("make_overlay_key", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            ns_window.makeKeyAndOrderFront(None);
            if SNIPPING_AREA_SESSION_ACTIVE.load(Ordering::Acquire) {
                snipping_force_area_crosshair_for_ns_window(ns_window);
            }
        });
    });
}

#[cfg(target_os = "macos")]
fn snipping_make_overlay_key_sync(app: &AppHandle, window: &tauri::WebviewWindow) -> bool {
    let window_for_main = window.clone();
    let label_for_error = window.label().to_string();
    match snipping_run_on_main_thread_sync(app, "make_overlay_key", move || {
        snipping_catch_objc_result("make_overlay_key", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return Err("Unable to access snipping overlay NSWindow.".to_string());
            };
            if ns_window.is_null() {
                return Err("Snipping overlay NSWindow is null.".to_string());
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            snipping_convert_ns_window_to_panel(ns_window);
            snipping_apply_overlay_fullscreen_window_style_to_ns_window(ns_window);
            ns_window.makeKeyAndOrderFront(None);
            if SNIPPING_AREA_SESSION_ACTIVE.load(Ordering::Acquire) {
                snipping_force_area_crosshair_for_ns_window(ns_window);
            }
            NSCursor::crosshairCursor().set();
            log_snipping_area_cursor_debug_event(
                "native.key_overlay_crosshair_committed",
                json!({
                    "overlay_label": window_for_main.label(),
                    "window": snipping_macos_window_cursor_debug_value(
                        window_for_main.label(),
                        ns_window,
                        objc2_app_kit::NSEvent::mouseLocation(),
                    ),
                    "context": snipping_macos_cursor_context_debug_value(),
                }),
            );
            Ok(())
        })
    }) {
        Ok(()) => true,
        Err(error) => {
            log_snipping_area_cursor_debug_event(
                "native.key_overlay_crosshair_failed",
                json!({
                    "overlay_label": label_for_error,
                    "error": error,
                }),
            );
            false
        }
    }
}

#[cfg(target_os = "macos")]
static SNIPPING_OVERLAY_MOUSE_MONITORS_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static SNIPPING_AREA_SESSION_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static SNIPPING_AREA_REASSERT_GENERATION: AtomicU64 = AtomicU64::new(0);

/// A Space swipe can finish before AppKit/WebKit are done restoring cursor
/// ownership. Reassert from the event that changed the Space, then a few more
/// one-shot ticks during the transition window. A short high-cadence guard runs
/// for the same generation because fullscreen Space animations can steal cursor
/// ownership without producing mouse-move/cursor-update events.
#[cfg(target_os = "macos")]
fn snipping_schedule_area_overlay_reassertions(app: &AppHandle, reason: &'static str) {
    if !SNIPPING_AREA_SESSION_ACTIVE.load(Ordering::Acquire) {
        return;
    }

    let generation = SNIPPING_AREA_REASSERT_GENERATION
        .fetch_add(1, Ordering::AcqRel)
        .saturating_add(1);

    log_snipping_area_cursor_debug_event(
        "native.schedule_reassertions",
        json!({
            "reason": reason,
            "generation": generation,
            "delays_ms": SNIPPING_AREA_REASSERT_DELAYS_MS,
            "context": snipping_macos_cursor_context_debug_value(),
        }),
    );

    let app_for_guard = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut elapsed_ms = 0;
        while elapsed_ms <= SNIPPING_AREA_CURSOR_GUARD_DURATION_MS {
            if !SNIPPING_AREA_SESSION_ACTIVE.load(Ordering::Acquire) {
                break;
            }
            if SNIPPING_AREA_REASSERT_GENERATION.load(Ordering::Acquire) != generation {
                break;
            }
            let app_for_main = app_for_guard.clone();
            let _ = app_for_guard.run_on_main_thread(move || {
                snipping_force_area_crosshair_for_visible_overlays(
                    &app_for_main,
                    reason,
                    false,
                );
            });
            sleep(Duration::from_millis(SNIPPING_AREA_CURSOR_GUARD_INTERVAL_MS)).await;
            elapsed_ms += SNIPPING_AREA_CURSOR_GUARD_INTERVAL_MS;
        }
    });

    for delay_ms in SNIPPING_AREA_REASSERT_DELAYS_MS {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if delay_ms > 0 {
                sleep(Duration::from_millis(delay_ms)).await;
            }
            if !SNIPPING_AREA_SESSION_ACTIVE.load(Ordering::Acquire) {
                return;
            }
            if SNIPPING_AREA_REASSERT_GENERATION.load(Ordering::Acquire) != generation {
                return;
            }
            let app_for_main = app.clone();
            let _ = app.run_on_main_thread(move || {
                log_snipping_area_cursor_debug_event(
                    "native.reassert_tick",
                    json!({
                        "reason": reason,
                        "generation": generation,
                        "delay_ms": delay_ms,
                        "context": snipping_macos_cursor_context_debug_value(),
                    }),
                );
                snipping_force_area_crosshair_for_visible_overlays(
                    &app_for_main,
                    reason,
                    true,
                );
            });
        });
    }
}

/// AppKit routes mouseMoved events to the key window only, so with one
/// overlay panel per display, hover tracking would stay stuck on whichever
/// panel is key. While a snip session is active, this watches global mouse
/// movement and hands key status to the overlay panel under the cursor —
/// cross-display hover works like the native screenshot UI. Runs on the main
/// thread (NSEvent monitor handlers fire there) and is a cheap atomic check
/// outside snip sessions.
#[cfg(target_os = "macos")]
fn snipping_overlay_handle_mouse_moved(source: &'static str, event_kind: &'static str) {
    if !SNIPPING_AREA_SESSION_ACTIVE.load(Ordering::Acquire) {
        return;
    }
    let should_log = snipping_area_cursor_debug_should_sample_mouse();
    if should_log {
        log_snipping_area_cursor_debug_event(
            "native.mouse_monitor",
            json!({
                "source": source,
                "event_kind": event_kind,
                "context": snipping_macos_cursor_context_debug_value(),
            }),
        );
    }
    if let Some(app) = snipping_macos_event_tap_app() {
        snipping_force_area_crosshair_for_visible_overlays(&app, event_kind, should_log);
    } else {
        snipping_set_area_crosshair_cursor_now();
    }
}

/// Installs the app-lifetime mouse-move monitors that drive cross-display
/// overlay key handoff. A global monitor covers movement while another app
/// is active; the local monitor covers movement once one of our panels holds
/// key. Both are gated by SNIPPING_AREA_SESSION_ACTIVE.
#[cfg(target_os = "macos")]
fn register_snipping_overlay_mouse_monitors(app: &AppHandle) {
    snipping_set_macos_event_tap_app(app);
    if SNIPPING_OVERLAY_MOUSE_MONITORS_STARTED.swap(true, Ordering::SeqCst) {
        log_snipping_area_cursor_debug_event(
            "native.mouse_monitors_already_started",
            snipping_macos_cursor_context_debug_value(),
        );
        return;
    }
    log_snipping_area_cursor_debug_event(
        "native.register_mouse_monitors",
        snipping_macos_cursor_context_debug_value(),
    );
    let _ = app.run_on_main_thread(move || {
        snipping_catch_objc("register_overlay_mouse_monitors", || {
            use objc2_app_kit::{NSEvent, NSEventMask};

            let mask = NSEventMask::MouseMoved
                | NSEventMask::LeftMouseDragged
                | NSEventMask::CursorUpdate;

            let global_block =
                block2::RcBlock::new(move |_event: std::ptr::NonNull<objc2_app_kit::NSEvent>| {
                    snipping_overlay_handle_mouse_moved("global", "mouse-or-drag");
                });
            if let Some(token) =
                NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global_block)
            {
                // The monitors live for the app's lifetime.
                std::mem::forget(token);
            }

            let local_block = block2::RcBlock::new(
                move |event: std::ptr::NonNull<objc2_app_kit::NSEvent>| -> *mut objc2_app_kit::NSEvent {
                    if SNIPPING_AREA_SESSION_ACTIVE.load(Ordering::Acquire) {
                        let event_ref = unsafe { event.as_ref() };
                        let event_kind = match event_ref.r#type() {
                            objc2_app_kit::NSEventType::MouseMoved => "mouse-moved",
                            objc2_app_kit::NSEventType::LeftMouseDragged => "left-mouse-dragged",
                            objc2_app_kit::NSEventType::CursorUpdate => "cursor-update",
                            _ => "other",
                        };
                        snipping_overlay_handle_mouse_moved("local", event_kind);
                        if event_ref.r#type() == objc2_app_kit::NSEventType::CursorUpdate {
                            log_snipping_area_cursor_debug_event(
                                "native.cursor_update_intercept",
                                json!({
                                    "source": "local",
                                    "event_kind": event_kind,
                                    "context": snipping_macos_cursor_context_debug_value(),
                                }),
                            );
                            snipping_set_area_crosshair_cursor_now();
                            return std::ptr::null_mut();
                        }
                    }
                    event.as_ptr()
                },
            );
            let local_token =
                unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local_block) };
            if let Some(token) = local_token {
                std::mem::forget(token);
            }
        });
    });
}

fn prewarm_snipping_overlay_window(app: &AppHandle) {
    let app_for_task = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Ok(monitors) = snipping_area_monitors(&app_for_task) else {
            return;
        };
        for (index, monitor) in monitors.iter().enumerate() {
            let label = snipping_overlay_label(index);
            let Ok(window) = ensure_snipping_overlay_window(&app_for_task, &label, monitor) else {
                continue;
            };
            snipping_hide_window_now(&window, "prewarm_overlay_hide");
        }
    });
}

/// Replaces the whole per-overlay session map (start of a new snip), deleting
/// any backdrop files the previous sessions left behind.
fn snipping_replace_area_sessions(
    app: &AppHandle,
    sessions: HashMap<String, SnippingAreaSession>,
) -> Result<(), String> {
    let state = app.state::<SnippingState>();
    let mut guard = state
        .active_area_sessions
        .lock()
        .map_err(|_| "Unable to lock snipping overlay state.".to_string())?;
    let previous = std::mem::replace(&mut *guard, sessions);
    let next_paths: HashSet<String> = guard
        .values()
        .filter_map(|session| session.monitor.snapshot_path.clone())
        .collect();
    drop(guard);
    for (_, session) in previous {
        if let Some(path) = session.monitor.snapshot_path.as_deref() {
            if !next_paths.contains(path) {
                snipping_remove_snapshot_file(Some(path));
            }
        }
    }
    Ok(())
}

fn snipping_clear_area_sessions(app: &AppHandle) -> Result<(), String> {
    snipping_replace_area_sessions(app, HashMap::new())
}

fn snipping_area_session_labels(app: &AppHandle) -> Vec<String> {
    app.state::<SnippingState>()
        .active_area_sessions
        .lock()
        .map(|guard| guard.keys().cloned().collect())
        .unwrap_or_default()
}

fn snipping_area_session_active(app: &AppHandle) -> bool {
    app.state::<SnippingState>()
        .active_area_sessions
        .lock()
        .map(|guard| !guard.is_empty())
        .unwrap_or(false)
}

struct SnippingAreaBeginGuard {
    generation: u64,
}

impl SnippingAreaBeginGuard {
    fn is_current(&self) -> bool {
        SNIPPING_AREA_BEGIN_IN_FLIGHT.load(Ordering::Acquire)
            && SNIPPING_AREA_BEGIN_GENERATION.load(Ordering::Acquire) == self.generation
    }
}

impl Drop for SnippingAreaBeginGuard {
    fn drop(&mut self) {
        if SNIPPING_AREA_BEGIN_GENERATION.load(Ordering::Acquire) == self.generation {
            SNIPPING_AREA_BEGIN_STARTED_AT_MS.store(0, Ordering::Release);
            SNIPPING_AREA_BEGIN_IN_FLIGHT.store(false, Ordering::Release);
        }
    }
}

fn snipping_area_begin_age_ms(now_ms: u64) -> Option<u64> {
    if !SNIPPING_AREA_BEGIN_IN_FLIGHT.load(Ordering::Acquire) {
        return None;
    }
    let started_at = SNIPPING_AREA_BEGIN_STARTED_AT_MS.load(Ordering::Acquire);
    if started_at == 0 {
        return None;
    }
    Some(now_ms.saturating_sub(started_at))
}

fn snipping_clear_stale_area_begin_if_needed(
    app: &AppHandle,
    reason: &str,
    shortcut: &str,
) -> bool {
    let now = current_time_ms();
    let Some(age_ms) = snipping_area_begin_age_ms(now) else {
        return false;
    };
    if age_ms < SNIPPING_AREA_BEGIN_STALE_MS || snipping_area_session_active(app) {
        return false;
    }
    if SNIPPING_AREA_BEGIN_IN_FLIGHT
        .compare_exchange(true, false, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return false;
    }
    SNIPPING_AREA_BEGIN_STARTED_AT_MS.store(0, Ordering::Release);
    log_snipping_area_cursor_debug_event(
        "native.begin_stale_cleared",
        json!({
            "reason": reason,
            "shortcut": shortcut,
            "age_ms": age_ms,
            "stale_after_ms": SNIPPING_AREA_BEGIN_STALE_MS,
            "cursor_position": snipping_app_cursor_position_debug_value(app),
        }),
    );
    true
}

fn snipping_try_begin_area_snip() -> Option<SnippingAreaBeginGuard> {
    if SNIPPING_AREA_BEGIN_IN_FLIGHT
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return None;
    }

    let generation = SNIPPING_AREA_BEGIN_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    SNIPPING_AREA_BEGIN_STARTED_AT_MS.store(current_time_ms(), Ordering::Release);
    Some(SnippingAreaBeginGuard { generation })
}

fn snipping_area_already_active_payload(reason: &str, shortcut: String) -> Value {
    json!({
        "kind": "snipping_area_already_active",
        "reason": reason,
        "shortcut": shortcut,
    })
}

fn snipping_area_session_monitor(
    app: &AppHandle,
    label: &str,
) -> Result<SnippingAreaMonitor, String> {
    let state = app.state::<SnippingState>();
    let guard = state
        .active_area_sessions
        .lock()
        .map_err(|_| "Unable to lock snipping overlay state.".to_string())?;
    guard
        .get(label)
        .map(|session| session.monitor.clone())
        .ok_or_else(|| "No active snipping overlay monitor.".to_string())
}

fn snipping_area_session_mode(app: &AppHandle, label: &str) -> Result<SnippingAreaMode, String> {
    let state = app.state::<SnippingState>();
    let guard = state
        .active_area_sessions
        .lock()
        .map_err(|_| "Unable to lock snipping overlay state.".to_string())?;
    guard
        .get(label)
        .map(|session| session.mode)
        .ok_or_else(|| "No active snipping overlay monitor.".to_string())
}

/// Swaps the in-memory frozen frame for one overlay's session (Space-change
/// re-freeze); returns false when the session is no longer active.
fn snipping_set_area_session_snapshot(
    app: &AppHandle,
    label: &str,
    snapshot: Arc<image::RgbaImage>,
) -> bool {
    let state = app.state::<SnippingState>();
    let Ok(mut guard) = state.active_area_sessions.lock() else {
        return false;
    };
    match guard.get_mut(label) {
        Some(session) => {
            session.snapshot = Some(snapshot);
            true
        }
        None => false,
    }
}

fn snipping_crop_area_session_snapshot(
    app: &AppHandle,
    label: &str,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<image::RgbaImage, String> {
    let state = app.state::<SnippingState>();
    let guard = state
        .active_area_sessions
        .lock()
        .map_err(|_| "Unable to lock snipping snapshot state.".to_string())?;
    let image = guard
        .get(label)
        .and_then(|session| session.snapshot.clone())
        .ok_or_else(|| "No frozen snip snapshot is available.".to_string())?;
    drop(guard);
    snipping_crop_snapshot_image(image.as_ref(), x, y, width, height)
}

fn snipping_begin_area_snip_for(
    app: &AppHandle,
    reason: &str,
    shortcut: String,
) -> Result<Value, String> {
    snipping_begin_area_for(app, reason, shortcut, SnippingAreaMode::Image)
}

fn snipping_begin_area_recording_for(
    app: &AppHandle,
    reason: &str,
    shortcut: String,
) -> Result<Value, String> {
    snipping_begin_area_for(app, reason, shortcut, SnippingAreaMode::Recording)
}

fn snipping_begin_area_for(
    app: &AppHandle,
    reason: &str,
    shortcut: String,
    mode: SnippingAreaMode,
) -> Result<Value, String> {
    log_snipping_area_cursor_debug_event(
        "native.begin_requested",
        json!({
            "reason": reason,
            "shortcut": &shortcut,
            "mode": mode.as_str(),
            "cursor_position": snipping_app_cursor_position_debug_value(app),
            "area_session_active": snipping_area_session_active(app),
            "begin_in_flight": SNIPPING_AREA_BEGIN_IN_FLIGHT.load(Ordering::Acquire),
            "begin_in_flight_age_ms": snipping_area_begin_age_ms(current_time_ms()),
        }),
    );
    ensure_snipping_enabled(app)?;
    if snipping_area_session_active(app) {
        log_snipping_area_cursor_debug_event(
            "native.begin_already_active",
            json!({
                "reason": reason,
                "shortcut": &shortcut,
                "cursor_position": snipping_app_cursor_position_debug_value(app),
            }),
        );
        return Ok(snipping_area_already_active_payload(reason, shortcut));
    }
    snipping_clear_stale_area_begin_if_needed(app, reason, &shortcut);
    let Some(begin_guard) = snipping_try_begin_area_snip() else {
        log_snipping_area_cursor_debug_event(
            "native.begin_in_flight",
            json!({
                "reason": reason,
                "shortcut": &shortcut,
                "age_ms": snipping_area_begin_age_ms(current_time_ms()),
                "cursor_position": snipping_app_cursor_position_debug_value(app),
            }),
        );
        return Ok(snipping_area_already_active_payload(reason, shortcut));
    };
    if snipping_area_session_active(app) {
        log_snipping_area_cursor_debug_event(
            "native.begin_active_after_guard",
            json!({
                "reason": reason,
                "shortcut": &shortcut,
                "cursor_position": snipping_app_cursor_position_debug_value(app),
            }),
        );
        return Ok(snipping_area_already_active_payload(reason, shortcut));
    }

    // Boot the preview window for this capture while the user is still
    // drawing the selection, so the draggable preview shows up instantly
    // when the snip finishes.
    snipping_warm_preview_pool(app);
    let monitors = snipping_area_monitors(app)?;
    log_snipping_area_cursor_debug_event(
        "native.begin_monitors_captured",
        json!({
            "reason": reason,
            "monitor_count": monitors.len(),
            "cursor_position": snipping_app_cursor_position_debug_value(app),
        }),
    );

    // Freeze every display in parallel BEFORE any overlay shows, so no
    // overlay (hint pill, dimming) contaminates a frozen frame. Total
    // latency is the slowest single display, same as one display before.
    let exclude_desktop_icons = snipping_should_hide_desktop_icons(app);
    snipping_hide_desktop_icons_for_capture(app);
    let capture_count = monitors.len();
    let (capture_sender, capture_receiver) = std::sync::mpsc::channel();
    for (index, monitor) in monitors.into_iter().enumerate() {
        let app_for_capture = app.clone();
        let capture_sender = capture_sender.clone();
        thread::spawn(move || {
            let result =
                snipping_capture_monitor_full_image(&app_for_capture, &monitor, exclude_desktop_icons);
            let _ = capture_sender.send((index, monitor, result));
        });
    }
    drop(capture_sender);

    let mut sessions = HashMap::new();
    let mut ordered: Vec<(String, SnippingAreaMonitor, Arc<image::RgbaImage>)> = Vec::new();
    let mut captured: Vec<(usize, String, SnippingAreaMonitor, Arc<image::RgbaImage>)> = Vec::new();
    let mut first_error: Option<String> = None;
    let capture_started_at = Instant::now();
    let capture_deadline = Duration::from_millis(SNIPPING_AREA_BEGIN_CAPTURE_TIMEOUT_MS);
    let mut received_count = 0usize;
    while received_count < capture_count {
        let elapsed = capture_started_at.elapsed();
        if elapsed >= capture_deadline {
            if first_error.is_none() {
                first_error = Some(format!(
                    "Timed out preparing snip overlays after {}ms.",
                    SNIPPING_AREA_BEGIN_CAPTURE_TIMEOUT_MS
                ));
            }
            log_snipping_area_cursor_debug_event(
                "native.begin_capture_timeout",
                json!({
                    "reason": reason,
                    "shortcut": &shortcut,
                    "monitor_count": capture_count,
                    "received_count": received_count,
                    "timeout_ms": SNIPPING_AREA_BEGIN_CAPTURE_TIMEOUT_MS,
                    "cursor_position": snipping_app_cursor_position_debug_value(app),
                }),
            );
            break;
        }

        let wait_for = capture_deadline
            .checked_sub(elapsed)
            .unwrap_or_else(|| Duration::from_millis(0));
        let Ok((index, mut monitor, result)) = capture_receiver.recv_timeout(wait_for) else {
            if first_error.is_none() {
                first_error = Some("Timed out preparing snip overlays.".to_string());
            }
            break;
        };
        received_count += 1;
        match result {
            Ok(image) => {
                let image = Arc::new(image);
                monitor.snapshot_width = image.width();
                monitor.snapshot_height = image.height();
                monitor.snapshot_path = None;
                let label = snipping_overlay_label(index);
                sessions.insert(
                    label.clone(),
                    SnippingAreaSession {
                        mode,
                        monitor: monitor.clone(),
                        snapshot: Some(Arc::clone(&image)),
                    },
                );
                captured.push((index, label, monitor, image));
            }
            Err(error) => {
                // A display that cannot be captured (mirroring quirks, ...)
                // is skipped; the snip continues on the displays that can.
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }
    captured.sort_by_key(|(index, _, _, _)| *index);
    ordered.extend(
        captured
            .into_iter()
            .map(|(_, label, monitor, image)| (label, monitor, image)),
    );

    if !begin_guard.is_current() {
        log_snipping_area_cursor_debug_event(
            "native.begin_replaced",
            json!({
                "reason": reason,
                "shortcut": &shortcut,
                "cursor_position": snipping_app_cursor_position_debug_value(app),
            }),
        );
        snipping_restore_desktop_icons_after_capture(app);
        return Err("A newer snip attempt replaced this startup.".to_string());
    }

    if ordered.is_empty() {
        log_snipping_area_cursor_debug_event(
            "native.begin_no_overlays",
            json!({
                "reason": reason,
                "first_error": first_error.clone(),
                "cursor_position": snipping_app_cursor_position_debug_value(app),
            }),
        );
        snipping_restore_desktop_icons_after_capture(app);
        let error = first_error
            .unwrap_or_else(|| "Unable to capture screen for area snip.".to_string());
        return Err(error);
    }

    snipping_replace_area_sessions(app, sessions)?;
    #[cfg(target_os = "macos")]
    {
        SNIPPING_AREA_SESSION_ACTIVE.store(true, Ordering::Release);
        snipping_claim_area_crosshair_on_main_thread(app, "session_active");
        log_snipping_area_cursor_debug_event(
            "native.session_active",
            json!({
                "reason": reason,
                "overlay_labels": ordered
                    .iter()
                    .map(|(label, _, _)| label.clone())
                    .collect::<Vec<String>>(),
                "context": snipping_macos_cursor_context_debug_value(),
            }),
        );
    }

    // Overlay windows left over from a display that disappeared since the
    // prewarm must not linger as stale full-screen surfaces.
    let active_labels: HashSet<&str> = ordered.iter().map(|(label, _, _)| label.as_str()).collect();
    for (label, window) in snipping_overlay_windows(app) {
        if !active_labels.contains(label.as_str()) {
            snipping_hide_window_now(&window, "begin_area_hide_stale_overlay");
        }
    }

    // The overlay under the cursor takes key for hover/keyboard; the others
    // still accept the click that starts a drag (and the mouse-move monitor
    // hands key over as the cursor crosses displays).
    let cursor = app.cursor_position().ok();
    let mut key_window: Option<tauri::WebviewWindow> = None;
    let mut monitors_payload = Vec::new();
    for (label, monitor, _) in &ordered {
        // A display whose overlay cannot be created or shown is skipped: the
        // snip keeps going on the displays that work. Aborting here would
        // strand already-shown overlays with no Escape grab.
        let Ok(window) = ensure_snipping_overlay_window(app, label, monitor) else {
            log_snipping_area_cursor_debug_event(
                "native.overlay_ensure_failed",
                json!({
                    "reason": reason,
                    "overlay_label": label,
                    "cursor_position": snipping_app_cursor_position_debug_value(app),
                }),
            );
            continue;
        };
        snipping_wait_for_area_overlay_ready(app, label);
        #[cfg(target_os = "macos")]
        {
            if !snipping_show_area_overlay_window_for_session(app, &window, label) {
                log_snipping_area_cursor_debug_event(
                    "native.overlay_show_failed",
                    json!({
                        "reason": reason,
                        "overlay_label": label,
                        "cursor_position": snipping_app_cursor_position_debug_value(app),
                    }),
                );
                continue;
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            if !snipping_show_window_now(&window, "begin_area_show_overlay") {
                log_snipping_area_cursor_debug_event(
                    "native.overlay_show_failed",
                    json!({
                        "reason": reason,
                        "overlay_label": label,
                        "cursor_position": snipping_app_cursor_position_debug_value(app),
                    }),
                );
                continue;
            }
        }
        let _ = app.emit(
            SNIPPING_AREA_OVERLAY_STARTED_EVENT,
            json!({
                "kind": "snipping_area_overlay_started",
                "mode": mode.as_str(),
                "overlayLabel": label,
                "overlay_label": label,
                "monitor": monitor.clone(),
            }),
        );

        let cursor_inside = cursor
            .as_ref()
            .map(|position| {
                position.x >= f64::from(monitor.x)
                    && position.x < f64::from(monitor.x) + f64::from(monitor.width)
                    && position.y >= f64::from(monitor.y)
                    && position.y < f64::from(monitor.y) + f64::from(monitor.height)
            })
            .unwrap_or(false);
        if cursor_inside || key_window.is_none() {
            key_window = Some(window);
        }
        log_snipping_area_cursor_debug_event(
            "native.overlay_shown",
            json!({
                "reason": reason,
                "overlay_label": label,
                "cursor_inside": cursor_inside,
                "cursor_position": snipping_app_cursor_position_debug_value(app),
                "monitor": monitor,
            }),
        );
        monitors_payload.push(json!({
            "overlayLabel": label,
            "monitor": monitor.clone(),
        }));
    }
    if monitors_payload.is_empty() {
        log_snipping_area_cursor_debug_event(
            "native.begin_no_visible_overlays",
            json!({
                "reason": reason,
                "cursor_position": snipping_app_cursor_position_debug_value(app),
            }),
        );
        snipping_clear_area_sessions(app)?;
        snipping_hide_area_overlay(app);
        return Err("Unable to show any snipping overlay.".to_string());
    }
    if let Some(window) = key_window.as_ref() {
        #[cfg(target_os = "macos")]
        snipping_make_overlay_key_sync(app, window);
        #[cfg(not(target_os = "macos"))]
        snipping_focus_window_now(window, "begin_area_focus_overlay");
        log_snipping_area_cursor_debug_event(
            "native.key_overlay_selected",
            json!({
                "reason": reason,
                "overlay_label": window.label(),
                "cursor_position": snipping_app_cursor_position_debug_value(app),
            }),
        );
    }
    snipping_register_escape_cancel(app);
    #[cfg(target_os = "macos")]
    {
        register_snipping_overlay_mouse_monitors(app);
        snipping_force_area_crosshair_for_visible_overlays_on_main_thread(app, "begin_ready");
        snipping_schedule_area_overlay_reassertions(app, "begin_area");
    }

    // The frozen-frame JPEGs are only visual backdrops; write them off the
    // hot path so the selection overlays appear instantly, then announce
    // each to its overlay webview.
    for (label, _, image) in ordered {
        let app_for_snapshot = app.clone();
        thread::spawn(move || {
            snipping_store_area_snapshot_backdrop(&app_for_snapshot, &label, image);
        });
    }

    log_snipping_area_cursor_debug_event(
        "native.begin_ready",
        json!({
            "reason": reason,
            "shortcut": &shortcut,
            "overlay_count": monitors_payload.len(),
            "cursor_position": snipping_app_cursor_position_debug_value(app),
        }),
    );

    Ok(json!({
        "kind": "snipping_area_started",
        "mode": mode.as_str(),
        "reason": reason,
        "shortcut": shortcut,
        "monitors": monitors_payload,
    }))
}

/// Writes the frozen-frame JPEG backdrop for one overlay's session, swaps it
/// into that session's monitor state (deleting any previous backdrop file),
/// and announces it to the overlay webview. Safe to call again mid-session,
/// which is how Space switches refresh the freeze.
fn snipping_store_area_snapshot_backdrop(
    app: &AppHandle,
    overlay_label: &str,
    image: Arc<image::RgbaImage>,
) {
    let Ok(snapshot_path) = snipping_overlay_snapshot_path() else {
        return;
    };
    // Pixel copy + JPEG encode both happen off the capture hot path.
    if image::DynamicImage::ImageRgba8(image.as_ref().clone())
        .to_rgb8()
        .save_with_format(&snapshot_path, SnippingImageFormat::Jpeg)
        .is_err()
    {
        return;
    }
    let path_text = snapshot_path.display().to_string();
    let state = app.state::<SnippingState>();
    let mut still_active = false;
    let mut previous_path = None;
    if let Ok(mut guard) = state.active_area_sessions.lock() {
        if let Some(session) = guard.get_mut(overlay_label) {
            previous_path = session.monitor.snapshot_path.replace(path_text.clone());
            session.monitor.snapshot_width = image.width();
            session.monitor.snapshot_height = image.height();
            still_active = true;
        }
    }
    if !still_active {
        snipping_remove_snapshot_file(Some(&path_text));
        return;
    }
    if let Some(previous_path) = previous_path.filter(|previous| previous != &path_text) {
        snipping_remove_snapshot_file(Some(&previous_path));
    }
    let _ = app.emit(
        SNIPPING_AREA_OVERLAY_SNAPSHOT_EVENT,
        json!({
            "kind": "snipping_area_overlay_snapshot",
            "overlayLabel": overlay_label,
            "overlay_label": overlay_label,
            "snapshotPath": path_text.clone(),
            "snapshot_path": path_text,
        }),
    );
}

/// Re-freezes every active overlay session after a macOS Space switch:
/// captures each display below its overlay (so the stale backdrop is not in
/// the shot), swaps the in-memory frozen frames, and refreshes the backdrops.
/// NSWorkspace's notification does not say which display changed Space, so
/// all visible overlays re-freeze.
#[cfg(target_os = "macos")]
fn snipping_refreeze_area_snapshot_for_space_change(app: &AppHandle) {
    let labels = snipping_area_session_labels(app);
    if labels.is_empty() {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        // Let the Space transition animation settle before re-capturing.
        thread::sleep(Duration::from_millis(260));
        for label in labels {
            let Some(window) = app.get_webview_window(&label) else {
                continue;
            };
            if !window.is_visible().unwrap_or(false) {
                continue;
            }
            let Ok(area_monitor) = snipping_area_session_monitor(&app, &label) else {
                continue;
            };
            let width = area_monitor.capture_width.max(1);
            let height = area_monitor.capture_height.max(1);
            let Ok(image) = snipping_capture_monitor_image_keeping_session(
                &app,
                &label,
                &area_monitor,
                width,
                height,
            ) else {
                continue;
            };
            let image = Arc::new(image);
            if !snipping_set_area_session_snapshot(&app, &label, Arc::clone(&image)) {
                continue;
            }
            snipping_store_area_snapshot_backdrop(&app, &label, image);
        }
    });
}

#[cfg(target_os = "macos")]
fn snipping_reflow_preview_stack_for_space_change(app: &AppHandle) {
    for delay_ms in SNIPPING_FLOAT_SPACE_REFLOW_DELAYS_MS {
        let app_for_thread = app.clone();
        thread::spawn(move || {
            if delay_ms > 0 {
                thread::sleep(Duration::from_millis(delay_ms));
            }
            let app_for_main = app_for_thread.clone();
            let _ = app_for_thread.run_on_main_thread(move || {
                snipping_reflow_preview_stack(
                    &app_for_main,
                    SNIPPING_FLOAT_ANIMATE_MS,
                    SnippingTweenEasing::Track,
                );
                snipping_strip_reposition_if_visible(&app_for_main, true);
            });
        });
    }
}

#[cfg(target_os = "macos")]
static SNIPPING_MACOS_SPACE_OBSERVER_STARTED: AtomicBool = AtomicBool::new(false);

/// Watches macOS Space changes while the app runs; when the user swipes to
/// another Space mid-snip, the frozen backdrop re-freezes on that Space so
/// area selection keeps working everywhere.
#[cfg(target_os = "macos")]
fn register_snipping_space_change_observer(app: &AppHandle) {
    if SNIPPING_MACOS_SPACE_OBSERVER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    snipping_set_macos_event_tap_app(app);
    let _ = app.run_on_main_thread(move || {
        snipping_catch_objc("register_space_change_observer", || {
            let workspace = objc2_app_kit::NSWorkspace::sharedWorkspace();
            let center = workspace.notificationCenter();
            let block = block2::RcBlock::new(
                move |_notification: std::ptr::NonNull<objc2_foundation::NSNotification>| {
                    snipping_catch_objc("space_change_observer_callback", || {
                        let use_full_monitor_bounds =
                            macos_refresh_active_space_uses_full_monitor_bounds_on_main_thread();
                        if let Some(app) = snipping_macos_event_tap_app() {
                            log_snipping_area_cursor_debug_event(
                                "native.space_changed",
                                json!({
                                    "use_full_monitor_bounds": use_full_monitor_bounds,
                                    "cursor_position": snipping_app_cursor_position_debug_value(&app),
                                    "context": snipping_macos_cursor_context_debug_value(),
                                }),
                            );
                            let _ = app.emit(
                                FLOATING_SURFACE_LAYOUT_CHANGED_EVENT,
                                json!({
                                    "source": "macos_space",
                                    "useFullMonitorBounds": use_full_monitor_bounds,
                                }),
                            );
                            snipping_force_area_crosshair_for_visible_overlays(
                                &app,
                                "macos_space_immediate",
                                true,
                            );
                            snipping_refreeze_area_snapshot_for_space_change(&app);
                            snipping_schedule_area_overlay_reassertions(&app, "macos_space");
                            snipping_reflow_preview_stack_for_space_change(&app);
                        }
                    });
                },
            );
            let token = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(objc2_app_kit::NSWorkspaceActiveSpaceDidChangeNotification),
                    None,
                    None,
                    &block,
                )
            };
            // The observer lives for the app's lifetime.
            std::mem::forget(token);
            macos_refresh_active_space_uses_full_monitor_bounds_on_main_thread();
        });
    });
}

/// While area-snip mode is active, Escape is grabbed globally so it always
/// exits the mode — even when the overlay webview does not hold keyboard
/// focus (e.g. right after swiping to a full-screen Space). The grab exists
/// only for the lifetime of the mode; outside it, Escape reaches apps
/// normally.
// Escape ownership goes through the shared broker in handsfree_audio.rs: the
// dictation widget scopes the same bare key, and independent register/
// unregister calls used to steal it from each other (whichever feature
// finished first unregistered the survivor's live registration).
fn snipping_register_escape_cancel(app: &AppHandle) {
    escape_scope_set_snipping(app, true);
}

fn snipping_unregister_escape_cancel(app: &AppHandle) {
    escape_scope_set_snipping(app, false);
}

fn snipping_cancel_area_snip_for(app: &AppHandle) -> Result<Value, String> {
    log_snipping_area_cursor_debug_event(
        "native.cancel_requested",
        json!({
            "cursor_position": snipping_app_cursor_position_debug_value(app),
        }),
    );
    snipping_clear_area_sessions(app)?;
    snipping_hide_area_overlay(app);
    Ok(json!({
        "kind": "snipping_area_cancelled",
    }))
}

fn snipping_hide_area_overlay(app: &AppHandle) {
    log_snipping_area_cursor_debug_event(
        "native.hide_overlay_begin",
        json!({
            "cursor_position": snipping_app_cursor_position_debug_value(app),
            "overlay_count": snipping_overlay_windows(app).len(),
            "context": snipping_area_native_cursor_context_debug_value(),
        }),
    );
    #[cfg(target_os = "macos")]
    {
        SNIPPING_AREA_SESSION_ACTIVE.store(false, Ordering::Release);
        SNIPPING_AREA_REASSERT_GENERATION.fetch_add(1, Ordering::AcqRel);
    }
    snipping_unregister_escape_cancel(app);
    for (_, window) in snipping_overlay_windows(app) {
        #[cfg(target_os = "macos")]
        snipping_restore_area_overlay_cursor_rects(&window);
        snipping_hide_window_now(&window, "hide_area_overlay");
    }
    #[cfg(target_os = "macos")]
    snipping_restore_default_cursor_now();
    // Windows/Linux hide the real desktop icons for the whole area session;
    // teardown (finish, cancel, Escape) is where they come back.
    snipping_restore_desktop_icons_after_capture(app);
    log_snipping_area_cursor_debug_event(
        "native.hide_overlay_done",
        json!({
            "cursor_position": snipping_app_cursor_position_debug_value(app),
            "context": snipping_area_native_cursor_context_debug_value(),
        }),
    );
}

fn snipping_close_area_overlay(app: &AppHandle) {
    for (_, window) in snipping_overlay_windows(app) {
        snipping_close_window_guarded(&window, "close_area_overlay");
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn snipping_area_capture_scale(
    _area_monitor: &SnippingAreaMonitor,
    _request_scale_factor: Option<f64>,
) -> f64 {
    1.0
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn snipping_area_capture_scale(
    area_monitor: &SnippingAreaMonitor,
    request_scale_factor: Option<f64>,
) -> f64 {
    request_scale_factor
        .unwrap_or(area_monitor.scale_factor)
        .max(0.1)
}

fn snipping_scaled_area_selection(
    app: &AppHandle,
    overlay_label: &str,
    request: &SnippingAreaSelectionRequest,
) -> Result<(SnippingAreaMonitor, u32, u32, u32, u32), String> {
    let area_monitor = snipping_area_session_monitor(app, overlay_label)?;
    let fallback_scale = snipping_area_capture_scale(&area_monitor, request.scale_factor);
    // Map CSS selection coordinates onto physical capture pixels. The
    // snapshot dimensions are the best truth source for HiDPI and mixed-DPI
    // displays; fallback_scale covers sessions whose backdrop is still being
    // written when the user finishes a fast drag.
    let logical_width = f64::from(area_monitor.width) / area_monitor.scale_factor.max(0.1);
    let logical_height = f64::from(area_monitor.height) / area_monitor.scale_factor.max(0.1);
    let scale_x = if area_monitor.snapshot_width > 0 && logical_width > 0.5 {
        f64::from(area_monitor.snapshot_width) / logical_width
    } else {
        fallback_scale
    };
    let scale_y = if area_monitor.snapshot_height > 0 && logical_height > 0.5 {
        f64::from(area_monitor.snapshot_height) / logical_height
    } else {
        fallback_scale
    };

    Ok((
        area_monitor,
        (request.x.max(0.0) * scale_x).round() as u32,
        (request.y.max(0.0) * scale_y).round() as u32,
        (request.width.max(0.0) * scale_x).round() as u32,
        (request.height.max(0.0) * scale_y).round() as u32,
    ))
}

fn snipping_finish_area_snip_for(
    app: &AppHandle,
    overlay_label: &str,
    request: SnippingAreaSelectionRequest,
) -> Result<Value, String> {
    log_snipping_area_cursor_debug_event(
        "native.finish_requested",
        json!({
            "overlay_label": overlay_label,
            "request": {
                "x": request.x,
                "y": request.y,
                "width": request.width,
                "height": request.height,
                "scale_factor": request.scale_factor,
            },
            "cursor_position": snipping_app_cursor_position_debug_value(app),
            "context": snipping_area_native_cursor_context_debug_value(),
        }),
    );
    let (area_monitor, selection_x, selection_y, selection_width, selection_height) =
        snipping_scaled_area_selection(app, overlay_label, &request)?;

    if selection_width < SNIPPING_MIN_AREA_PIXELS || selection_height < SNIPPING_MIN_AREA_PIXELS {
        log_snipping_area_cursor_debug_event(
            "native.finish_too_small",
            json!({
                "overlay_label": overlay_label,
                "selection_width": selection_width,
                "selection_height": selection_height,
                "cursor_position": snipping_app_cursor_position_debug_value(app),
            }),
        );
        snipping_clear_area_sessions(app)?;
        snipping_hide_area_overlay(app);
        return Err("Snip area is too small.".to_string());
    }

    let image_result = (|| -> Result<image::RgbaImage, String> {
        // The in-memory frozen frame is what the user actually saw while
        // selecting; prefer it over re-capturing the live screen.
        if let Ok(image) = snipping_crop_area_session_snapshot(
            app,
            overlay_label,
            selection_x,
            selection_y,
            selection_width,
            selection_height,
        ) {
            return Ok(image);
        }
        if area_monitor
            .snapshot_path
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
        {
            if let Ok(image) = snipping_crop_area_preview_snapshot(
                &area_monitor,
                selection_x,
                selection_y,
                selection_width,
                selection_height,
            ) {
                return Ok(image);
            }
        }

        // macOS below-window capture works in logical points, so the live
        // fallback uses the unscaled CSS selection there; other platforms
        // crop a physical-pixel monitor image.
        #[cfg(target_os = "macos")]
        {
            let x = request.x.max(0.0).round() as u32;
            let y = request.y.max(0.0).round() as u32;
            let width = (request.width.max(0.0).round() as u32).max(1);
            let height = (request.height.max(0.0).round() as u32).max(1);
            snipping_capture_area_image(app, overlay_label, &area_monitor, x, y, width, height)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let monitor_width = area_monitor.capture_width.max(1);
            let monitor_height = area_monitor.capture_height.max(1);
            let x = selection_x.min(monitor_width.saturating_sub(1));
            let y = selection_y.min(monitor_height.saturating_sub(1));
            let width = selection_width.min(monitor_width.saturating_sub(x)).max(1);
            let height = selection_height
                .min(monitor_height.saturating_sub(y))
                .max(1);
            snipping_capture_area_image(app, overlay_label, &area_monitor, x, y, width, height)
        }
    })();
    log_snipping_area_cursor_debug_event(
        "native.finish_image_result",
        json!({
            "overlay_label": overlay_label,
            "success": image_result.is_ok(),
            "error": image_result.as_ref().err().map(|error| clean_terminal_diagnostic_log_text(error)),
            "cursor_position": snipping_app_cursor_position_debug_value(app),
        }),
    );
    snipping_clear_area_sessions(app)?;
    snipping_hide_area_overlay(app);
    snipping_save_image(app, image_result?, "area", "overlay", String::new())
}

#[tauri::command]
fn snipping_status(app: AppHandle) -> Result<SnippingSettingsStatus, String> {
    snipping_status_for(&app)
}

#[tauri::command]
fn snipping_shortcuts_status(app: AppHandle) -> Result<SnippingSettingsStatus, String> {
    snipping_status_for(&app)
}

#[tauri::command]
fn set_snipping_enabled(
    app: AppHandle,
    request: SnippingEnabledUpdateRequest,
) -> Result<SnippingSettingsStatus, String> {
    set_snipping_enabled_for(&app, request)
}

#[tauri::command]
fn set_snipping_hide_desktop_icons(
    app: AppHandle,
    request: SnippingHideDesktopIconsRequest,
) -> Result<SnippingSettingsStatus, String> {
    set_snipping_hide_desktop_icons_for(&app, request)
}

#[tauri::command]
fn set_snipping_upload_public(
    app: AppHandle,
    request: SnippingUploadPublicRequest,
) -> Result<SnippingSettingsStatus, String> {
    set_snipping_upload_public_for(&app, request)
}

#[tauri::command]
fn set_snipping_shortcut(
    app: AppHandle,
    request: SnippingShortcutUpdateRequest,
) -> Result<SnippingSettingsStatus, String> {
    set_snipping_shortcut_for(&app, request)
}

#[tauri::command]
fn reset_snipping_shortcuts(app: AppHandle) -> Result<SnippingSettingsStatus, String> {
    reset_snipping_shortcuts_for(&app)
}

#[tauri::command]
fn open_snipping_permissions(app: AppHandle) -> Result<SnippingSettingsStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = macos_request_accessibility_permission();
        let _ = macos_request_screen_capture_permission();
        let _ = macos_open_accessibility_settings();
        let _ = macos_open_screen_capture_settings();
    }

    // If access just resolved, warm the capture session so the next snip is
    // flicker-free (no-op when access still isn't granted).
    snipping_prewarm_capture_session(&app);
    snipping_status_for(&app)
}

#[tauri::command]
fn snipping_capture_screenshot(
    app: AppHandle,
    request: SnippingCaptureRequest,
) -> Result<Value, String> {
    let mode = request
        .mode
        .as_deref()
        .unwrap_or("full")
        .trim()
        .to_ascii_lowercase();

    if matches!(mode.as_str(), "area" | "area-snip" | "selection" | "snip") {
        return snipping_begin_area_snip_for(&app, "manual", String::new());
    }
    if matches!(
        mode.as_str(),
        "record" | "recording" | "video" | "area-recording" | "screen-recording"
    ) {
        return snipping_toggle_area_recording_shortcut_for(&app, "manual", String::new());
    }

    snipping_capture_full_for(&app, "manual", String::new())
}

#[tauri::command]
fn snipping_begin_area_snip(app: AppHandle) -> Result<Value, String> {
    snipping_begin_area_snip_for(&app, "manual", String::new())
}

#[tauri::command]
fn snipping_begin_area_recording(app: AppHandle) -> Result<Value, String> {
    snipping_toggle_area_recording_shortcut_for(&app, "manual", String::new())
}

#[tauri::command]
fn snipping_area_overlay_status(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    let label = window.label().to_string();
    let monitor = snipping_area_session_monitor(&app, &label)
        .or_else(|_| snipping_current_area_monitor(&app))?;
    let mode = snipping_area_session_mode(&app, &label)
        .unwrap_or(SnippingAreaMode::Image);
    Ok(json!({
        "kind": "snipping_area_overlay_status",
        "mode": mode.as_str(),
        "overlayLabel": label,
        "monitor": monitor,
    }))
}

#[tauri::command]
fn snipping_area_overlay_ready(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    let label = window.label().to_string();
    if !snipping_is_overlay_label(&label) {
        return Err("Not a snipping overlay window.".to_string());
    }
    snipping_mark_area_overlay_ready(&app, &label);
    Ok(json!({
        "kind": "snipping_area_overlay_ready",
        "overlayLabel": label,
    }))
}

#[tauri::command]
fn snipping_log_area_cursor_event(
    app: AppHandle,
    window: tauri::WebviewWindow,
    request: SnippingAreaCursorLogRequest,
) -> Result<Value, String> {
    let phase = request.phase.trim();
    let phase = if phase.is_empty() {
        "web.event".to_string()
    } else {
        format!("web.{phase}")
    };
    log_snipping_area_cursor_debug_event(
        &phase,
        json!({
            "overlay_label": window.label(),
            "cursor_position": snipping_app_cursor_position_debug_value(&app),
            "context": snipping_area_native_cursor_context_debug_value(),
            "fields": request.fields.unwrap_or(Value::Null),
        }),
    );
    Ok(json!({
        "ok": true,
        "log_file": snipping_area_cursor_debug_log_path().display().to_string(),
    }))
}

#[tauri::command]
fn snipping_finish_area_snip(
    app: AppHandle,
    window: tauri::WebviewWindow,
    request: SnippingAreaSelectionRequest,
) -> Result<Value, String> {
    snipping_finish_area_snip_for(&app, window.label(), request)
}

#[tauri::command]
fn snipping_start_area_recording(
    app: AppHandle,
    window: tauri::WebviewWindow,
    request: SnippingAreaSelectionRequest,
) -> Result<Value, String> {
    snipping_start_area_recording_for(&app, window.label(), request)
}

#[tauri::command]
fn snipping_stop_recording(app: AppHandle) -> Result<Value, String> {
    snipping_stop_recording_for(&app, "manual")
}

#[tauri::command]
fn snipping_recording_status(app: AppHandle) -> Result<Value, String> {
    Ok(snipping_recording_status_for(&app))
}

#[tauri::command]
fn snipping_recent_capture_toasts(app: AppHandle) -> Result<Value, String> {
    Ok(snipping_recent_capture_toasts_for(&app))
}

#[tauri::command]
fn snipping_dismiss_capture_toast(
    app: AppHandle,
    request: SnippingCaptureToastDismissRequest,
) -> Result<Value, String> {
    snipping_dismiss_capture_toast_for(&app, request)
}

#[tauri::command]
fn snipping_upload_untracked_asset(
    app: AppHandle,
    request: SnippingUploadAssetRequest,
) -> Result<Value, String> {
    snipping_upload_untracked_asset_for(&app, request)
}

fn snipping_publish_public_url(published: &Value) -> Option<String> {
    cloud_mcp_payload_text(published, &["public_url", "publicUrl"]).or_else(|| {
        [
            "/public_link/public_url",
            "/publicLink/publicUrl",
            "/public_link/publicUrl",
            "/publicLink/public_url",
        ]
        .iter()
        .find_map(|path| {
            published
                .pointer(path)
                .and_then(Value::as_str)
                .map(str::to_string)
                .filter(|value| !value.trim().is_empty())
        })
    })
}

/// Publishes an already-uploaded snip asset as a public link and returns the
/// URL. Backs the "Make public" step of the preview/strip upload button when
/// the snip upload-public setting is off. Assets are account-level, so the
/// publish goes through the fixed account scope (empty repo path).
async fn snipping_publish_uploaded_asset_to_cloud(
    app: &AppHandle,
    asset_id: String,
) -> Result<String, String> {
    let published = cloud_mcp_publish_account_asset(
        app.state::<CloudMcpState>(),
        asset_id,
        None,
    )
    .await?;
    snipping_publish_public_url(&published)
        .ok_or_else(|| "Snip published, but the cloud did not return a public URL.".to_string())
}

#[tauri::command]
async fn snipping_publish_uploaded_asset(
    app: AppHandle,
    request: SnippingPublishAssetRequest,
) -> Result<Value, String> {
    let asset_id = request.asset_id.trim().to_string();
    if asset_id.is_empty() {
        return Err("An asset id is required to publish a snip.".to_string());
    }
    let public_url = snipping_publish_uploaded_asset_to_cloud(&app, asset_id.clone()).await?;
    Ok(json!({
        "kind": "snip_published",
        "asset_id": asset_id.clone(),
        "assetId": asset_id,
        "public_url": public_url.clone(),
        "publicUrl": public_url,
    }))
}

#[tauri::command]
async fn snipping_delete_uploaded_asset_from_cloud(
    app: AppHandle,
    request: SnippingPublishAssetRequest,
) -> Result<Value, String> {
    let asset_id = request.asset_id.trim().to_string();
    if asset_id.is_empty() {
        return Err("An asset id is required to remove a snip from Cloud.".to_string());
    }
    let deleted =
        cloud_mcp_delete_cloud_account_asset(app.state::<CloudMcpState>(), asset_id.clone(), None)
            .await?;
    Ok(json!({
        "kind": "snip_cloud_upload_deleted",
        "asset_id": asset_id.clone(),
        "assetId": asset_id,
        "deleted": deleted,
    }))
}

async fn snipping_upload_known_asset_to_cloud(
    app: &AppHandle,
    asset_id: String,
    local_path: String,
    source_path: String,
) -> Result<Value, String> {
    let _ = app.emit(
        SNIPPING_CLOUD_UPLOAD_EVENT,
        json!({
            "kind": "snip_cloud_upload_started",
            "status": "uploading",
            "asset_id": asset_id.clone(),
            "assetId": asset_id.clone(),
            "local_path": local_path.clone(),
            "localPath": local_path.clone(),
            "source_path": source_path.clone(),
            "sourcePath": source_path.clone(),
        }),
    );

    if let Err(error) = cloud_mcp_upload_account_asset(
        app.state::<CloudMcpState>(),
        asset_id.clone(),
        None,
    )
    .await
    {
        let _ = app.emit(
            SNIPPING_CLOUD_UPLOAD_EVENT,
            json!({
                "kind": "snip_cloud_upload_failed",
                "status": "failed",
                "asset_id": asset_id.clone(),
                "assetId": asset_id.clone(),
                "local_path": local_path.clone(),
                "localPath": local_path,
                "source_path": source_path.clone(),
                "sourcePath": source_path,
                "error": error.clone(),
            }),
        );
        return Err(error);
    }

    let _ = app.emit(
        SNIPPING_CLOUD_UPLOAD_EVENT,
        json!({
            "kind": "snip_cloud_upload_completed",
            "status": "completed",
            "asset_id": asset_id.clone(),
            "assetId": asset_id.clone(),
            "local_path": local_path.clone(),
            "localPath": local_path.clone(),
            "source_path": source_path.clone(),
            "sourcePath": source_path,
        }),
    );

    if !snipping_upload_public_enabled(app) {
        return Ok(json!({
            "kind": "snip_uploaded_to_cloud",
            "asset_id": asset_id.clone(),
            "assetId": asset_id,
            "local_path": local_path.clone(),
            "localPath": local_path,
            "published": false,
        }));
    }

    let public_url = snipping_publish_uploaded_asset_to_cloud(app, asset_id.clone()).await?;
    Ok(json!({
        "kind": "snip_uploaded_to_cloud",
        "asset_id": asset_id.clone(),
        "assetId": asset_id,
        "local_path": local_path.clone(),
        "localPath": local_path,
        "published": true,
        "public_url": public_url.clone(),
        "publicUrl": public_url,
    }))
}

/// Full snip share chain for the preview/strip upload button: promote the
/// untracked snip into the tracked library, upload it to the cloud, and —
/// when the snip upload-public setting is on — publish a public link so the
/// button can flip straight to "Copy URL". With the setting off the upload
/// stays private and the button flips to "Make public" instead. Assets are
/// account-level, so the whole chain runs in the fixed account scope with no
/// workspace selection. Every step is idempotent (deterministic asset id,
/// prepare-upload dedupe, publish returns the existing link), so retrying
/// after a mid-chain failure is safe.
#[tauri::command]
async fn snipping_upload_untracked_asset_to_cloud(
    app: AppHandle,
    request: SnippingUploadAssetRequest,
) -> Result<Value, String> {
    let requested_path = request.path.clone();
    if let Some(asset_id) = request
        .asset_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    {
        let local_path = snipping_preview_current_path_string(&app, &requested_path)
            .unwrap_or_else(|_| requested_path.clone());
        return snipping_upload_known_asset_to_cloud(
            &app,
            asset_id,
            local_path,
            requested_path,
        )
        .await;
    }

    let promoted = snipping_upload_untracked_asset_for(&app, request)?;
    let asset_id = cloud_mcp_payload_text(&promoted, &["asset_id", "assetId"])
        .ok_or_else(|| "Snip was tracked, but no asset id was returned.".to_string())?;
    let local_path = cloud_mcp_payload_text(&promoted, &["local_path", "localPath", "path"])
        .unwrap_or_else(|| requested_path.clone());
    snipping_upload_known_asset_to_cloud(&app, asset_id, local_path, requested_path).await
}

#[tauri::command]
fn snipping_save_edited_untracked_asset(
    app: AppHandle,
    request: SnippingEditedAssetRequest,
) -> Result<Value, String> {
    snipping_save_edited_untracked_asset_for(&app, request)
}

const SNIPPING_FLOAT_WINDOW_PREFIX: &str = "snip-float";
const SNIPPING_FLOAT_LOGICAL_WIDTH: f64 = 240.0;
const SNIPPING_FLOAT_GOLDEN_RATIO: f64 = 1.618_033_988_749_895;
// Every preview is the same golden-ratio rectangle; the capture scales to
// fit inside it (object-fit: contain in the webview, centered, never
// cropped) instead of sizing the window.
const SNIPPING_FLOAT_LOGICAL_HEIGHT: f64 =
    SNIPPING_FLOAT_LOGICAL_WIDTH / SNIPPING_FLOAT_GOLDEN_RATIO;
const SNIPPING_STRIP_TILE_LOGICAL_WIDTH: f64 = SNIPPING_FLOAT_LOGICAL_WIDTH * 0.5;
const SNIPPING_STRIP_TILE_LOGICAL_HEIGHT: f64 = SNIPPING_FLOAT_LOGICAL_HEIGHT * 0.5;
const SNIPPING_FLOAT_STACK_MARGIN: f64 = 16.0;
const SNIPPING_FLOAT_STACK_GAP: f64 = 10.0;
#[cfg(target_os = "macos")]
const SNIPPING_FLOAT_SPACE_REFLOW_DELAYS_MS: [u64; 4] = [0, 120, 280, 700];
// Fallback settle deadline pushed forward by every Moved event. On platforms
// with a live mouse-button probe the watcher usually resolves the drop the
// moment the button releases, except for left-column post-release settling.
// On platforms without one (Linux) it is the release signal.
const SNIPPING_FLOAT_RESTACK_SETTLE_MS: u64 = 160;
// Without a button probe a mid-drag pause is indistinguishable from a
// release; keep the old longer stillness window there.
const SNIPPING_FLOAT_RESTACK_SETTLE_FALLBACK_MS: u64 = 420;
// After a left-column release, wait for native edge snap/constrain movement
// to go quiet, then decide queue vs detached from the final window position.
const SNIPPING_FLOAT_POST_RELEASE_SETTLE_MS: u64 = 170;
// Fresh strip drag-outs create/reuse a native window, position it, resize it,
// and then hand it to the OS drag manager. Those first synthetic/native-takeover
// moves must not wake the left queue, or the preview visually snaps between
// OS-owned and queue-owned positions.
const SNIPPING_FLOAT_DRAG_HANDOFF_GRACE_MS: u64 = 260;
const SNIPPING_FLOAT_DRAG_HANDOFF_EXPAND_DELAY_MS: u64 = 90;
// How often the settle watcher polls the button state / deadline while a
// drag or pending reflow is in flight.
const SNIPPING_FLOAT_SETTLE_POLL_MS: u64 = 15;
// Webview events for dropping a preview window onto the main window: the
// main webview hit-tests the point for a drop target (todo card, terminal
// pane, ...) and consumes the preview when one accepts.
const SNIPPING_PREVIEW_DROP_EVENT: &str = "forge-snip-preview-drop";
const SNIPPING_PREVIEW_DRAG_OVER_EVENT: &str = "forge-snip-preview-drag-over";
const SNIPPING_STRIP_DRAG_EVENT: &str = "forge-snip-strip-drag";
// One drag-over point per display frame keeps target highlights glued to the
// cursor; the old 50ms cadence visibly trailed it.
const SNIPPING_PREVIEW_DRAG_OVER_THROTTLE_MS: u64 = 16;
// Anything closer than this to the grab position is a click, not a drop.
const SNIPPING_PREVIEW_DRAG_MIN_DISTANCE: i32 = 8;
const SNIPPING_FLOAT_DISPOSE_EVENT: &str = "forge-snip-float-dispose";
// One paint turn for the webview to unhook live-preview listeners and clear its
// image src before the native WebKit window starts teardown.
const SNIPPING_FLOAT_CLOSE_GRACE_MS: u64 = 45;
const SNIPPING_FLOAT_CLOSE_RELEASE_WAIT_MS: u64 = 1200;

fn snipping_preview_closing_labels(app: &AppHandle) -> HashSet<String> {
    app.state::<SnippingState>()
        .preview_closing
        .lock()
        .map(|closing| closing.clone())
        .unwrap_or_default()
}

fn snipping_preview_is_closing(app: &AppHandle, label: &str) -> bool {
    app.state::<SnippingState>()
        .preview_closing
        .lock()
        .map(|closing| closing.contains(label))
        .unwrap_or(false)
}

fn snipping_preview_dragging_labels(app: &AppHandle) -> HashSet<String> {
    app.state::<SnippingState>()
        .preview_drag_sessions
        .lock()
        .map(|sessions| sessions.keys().cloned().collect())
        .unwrap_or_default()
}

fn snipping_preview_is_dragging(app: &AppHandle, label: &str) -> bool {
    app.state::<SnippingState>()
        .preview_drag_sessions
        .lock()
        .map(|sessions| sessions.contains_key(label))
        .unwrap_or(false)
}

fn snipping_preview_detached_labels(app: &AppHandle) -> HashSet<String> {
    app.state::<SnippingState>()
        .preview_detached_labels
        .lock()
        .map(|labels| labels.clone())
        .unwrap_or_default()
}

fn snipping_path_has_visible_free_preview(app: &AppHandle, path_string: &str) -> bool {
    let closing = snipping_preview_closing_labels(app);
    app.state::<SnippingState>()
        .preview_paths
        .lock()
        .map(|paths| {
            paths.iter().any(|(label, open_path)| {
                open_path == path_string
                    && !closing.contains(label)
                    && app
                        .get_webview_window(label.as_str())
                        .is_some_and(|window| window.is_visible().unwrap_or(false))
            })
        })
        .unwrap_or(false)
}

fn snipping_begin_preview_drag_session(
    app: &AppHandle,
    label: &str,
    position: tauri::PhysicalPosition<i32>,
) {
    let state = app.state::<SnippingState>();
    if let Ok(mut sessions) = state.preview_drag_sessions.lock() {
        sessions.insert(label.to_string(), (position.x, position.y));
    }
    if let Ok(mut settling) = state.preview_post_release_settling_labels.lock() {
        settling.remove(label);
    }
    if let Ok(mut strip_hover) = state.preview_strip_hover_labels.lock() {
        strip_hover.remove(label);
    }
    if let Ok(mut handoffs) = state.preview_drag_handoff_until_ms.lock() {
        handoffs.remove(label);
    }
    state
        .preview_post_release_check_pending
        .store(false, Ordering::SeqCst);
    // A pack animation may have captured this preview as movable just before
    // the press. Kill it immediately so left-side queue alignment wins over any
    // stale side/center tug.
    state
        .preview_animation_generation
        .fetch_add(1, Ordering::SeqCst);
    state.preview_live_reflow_last_ms.store(0, Ordering::SeqCst);
}

fn snipping_cleanup_preview_registry(app: &AppHandle, label: &str) {
    let state = app.state::<SnippingState>();
    if let Ok(mut closing) = state.preview_closing.lock() {
        closing.remove(label);
    }
    if let Ok(mut paths) = state.preview_paths.lock() {
        paths.remove(label);
    }
    if let Ok(mut sessions) = state.preview_drag_sessions.lock() {
        sessions.remove(label);
    }
    if let Ok(mut detached) = state.preview_detached_labels.lock() {
        detached.remove(label);
    }
    if let Ok(mut settling) = state.preview_post_release_settling_labels.lock() {
        settling.remove(label);
    }
    if let Ok(mut strip_hover) = state.preview_strip_hover_labels.lock() {
        strip_hover.remove(label);
    }
    if let Ok(mut handoffs) = state.preview_drag_handoff_until_ms.lock() {
        handoffs.remove(label);
    }
    state
        .preview_post_release_check_pending
        .store(false, Ordering::SeqCst);
    if let Ok(mut pool) = state.preview_pool.lock() {
        pool.retain(|pooled| pooled != label);
    };
}

fn snipping_begin_preview_close(app: &AppHandle, label: &str) -> bool {
    let state = app.state::<SnippingState>();
    let first_close = state
        .preview_closing
        .lock()
        .map(|mut closing| closing.insert(label.to_string()))
        .unwrap_or(true);
    if !first_close {
        return false;
    }
    if let Ok(mut paths) = state.preview_paths.lock() {
        paths.remove(label);
    }
    if let Ok(mut sessions) = state.preview_drag_sessions.lock() {
        sessions.remove(label);
    }
    if let Ok(mut detached) = state.preview_detached_labels.lock() {
        detached.remove(label);
    }
    if let Ok(mut settling) = state.preview_post_release_settling_labels.lock() {
        settling.remove(label);
    }
    if let Ok(mut strip_hover) = state.preview_strip_hover_labels.lock() {
        strip_hover.remove(label);
    }
    if let Ok(mut handoffs) = state.preview_drag_handoff_until_ms.lock() {
        handoffs.remove(label);
    }
    state
        .preview_post_release_check_pending
        .store(false, Ordering::SeqCst);
    if let Ok(mut pool) = state.preview_pool.lock() {
        pool.retain(|pooled| pooled != label);
    }
    state
        .preview_animation_generation
        .fetch_add(1, Ordering::SeqCst);
    true
}

fn snipping_park_preview_window(app: &AppHandle, label: &str, window: &tauri::WebviewWindow) {
    snipping_hide_window_now(window, "park_preview_window");

    let state = app.state::<SnippingState>();
    if let Ok(mut closing) = state.preview_closing.lock() {
        closing.remove(label);
    }
    if let Ok(mut paths) = state.preview_paths.lock() {
        paths.remove(label);
    }
    if let Ok(mut sessions) = state.preview_drag_sessions.lock() {
        sessions.remove(label);
    }
    if let Ok(mut detached) = state.preview_detached_labels.lock() {
        detached.remove(label);
    }
    if let Ok(mut settling) = state.preview_post_release_settling_labels.lock() {
        settling.remove(label);
    }
    if let Ok(mut strip_hover) = state.preview_strip_hover_labels.lock() {
        strip_hover.remove(label);
    }
    if let Ok(mut handoffs) = state.preview_drag_handoff_until_ms.lock() {
        handoffs.remove(label);
    }
    state
        .preview_post_release_check_pending
        .store(false, Ordering::SeqCst);
    if let Ok(mut pool) = state.preview_pool.lock() {
        if !pool.iter().any(|pooled| pooled == label) {
            pool.push(label.to_string());
        }
    };
}

fn snipping_close_preview_window(app: &AppHandle, label: &str, reason: &'static str) -> bool {
    let label = label.trim().to_string();
    if !label.starts_with(SNIPPING_FLOAT_WINDOW_PREFIX) {
        return false;
    }
    let Some(_) = app.get_webview_window(&label) else {
        snipping_cleanup_preview_registry(app, &label);
        return false;
    };
    if !snipping_begin_preview_close(app, &label) {
        return true;
    }

    let _ = app.emit_to(
        label.as_str(),
        SNIPPING_FLOAT_DISPOSE_EVENT,
        json!({
            "kind": "snip_float_dispose",
            "label": label.clone(),
            "reason": reason,
        }),
    );
    snipping_emit_floats_changed(app);
    schedule_snipping_preview_stack_reflow(app);

    let app_for_thread = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(SNIPPING_FLOAT_CLOSE_GRACE_MS));
        if snipping_mouse_button_state_supported() {
            let started = Instant::now();
            while snipping_left_mouse_button_pressed()
                && started.elapsed() < Duration::from_millis(SNIPPING_FLOAT_CLOSE_RELEASE_WAIT_MS)
            {
                thread::sleep(Duration::from_millis(SNIPPING_FLOAT_SETTLE_POLL_MS));
            }
        }
        let app_for_main = app_for_thread.clone();
        let label_for_main = label.clone();
        let _ = app_for_thread.run_on_main_thread(move || {
            if let Some(window) = app_for_main.get_webview_window(&label_for_main) {
                snipping_park_preview_window(&app_for_main, &label_for_main, &window);
                snipping_emit_floats_changed(&app_for_main);
            } else {
                snipping_cleanup_preview_registry(&app_for_main, &label_for_main);
                snipping_emit_floats_changed(&app_for_main);
            }
        });
    });
    true
}

fn snipping_close_editor_window(app: &AppHandle, label: &str, reason: &'static str) -> bool {
    let label = label.trim().to_string();
    if !label.starts_with(SNIPPING_EDITOR_WINDOW_PREFIX) {
        return false;
    }
    if app.get_webview_window(&label).is_none() {
        if let Ok(mut editors) = app.state::<SnippingState>().editor_paths.lock() {
            editors.remove(&label);
        }
        return false;
    }

    let _ = app.emit_to(
        label.as_str(),
        SNIPPING_EDITOR_DISPOSE_EVENT,
        json!({
            "kind": "snip_editor_dispose",
            "label": label.clone(),
            "reason": reason,
        }),
    );

    let app_for_thread = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(SNIPPING_FLOAT_CLOSE_GRACE_MS));
        let app_for_main = app_for_thread.clone();
        let label_for_main = label.clone();
        let _ = app_for_thread.run_on_main_thread(move || {
            if let Some(window) = app_for_main.get_webview_window(&label_for_main) {
                snipping_close_window_now(&window, "close_editor_window");
            } else if let Ok(mut editors) = app_for_main.state::<SnippingState>().editor_paths.lock() {
                editors.remove(&label_for_main);
            }
        });
    });
    true
}

/// Horizontal ownership for the bottom-left preview queue. If a preview
/// overlaps this column at all, the queue owns its final alignment; generic
/// left-edge centering must only apply outside this band.
fn snipping_preview_in_stack_column(position_x: i32, preview_width: i32, stack_x: i32) -> bool {
    let width = preview_width.max(1);
    let preview_left = position_x;
    let preview_right = position_x + width;
    let stack_left = stack_x;
    let stack_right = stack_x + width;
    preview_right >= stack_left && preview_left <= stack_right
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct SnippingPreviewStackMonitorKey {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_micros: i64,
}

#[derive(Clone, Copy)]
struct SnippingPreviewStackMetrics {
    key: SnippingPreviewStackMonitorKey,
    x: i32,
    top_limit: i32,
    bottom_edge: i32,
    gap: i32,
    width_physical: i32,
    height_physical: i32,
}

fn snipping_preview_stack_metrics_for_monitor(
    monitor: &tauri::Monitor,
    width: f64,
    height: f64,
) -> SnippingPreviewStackMetrics {
    let (area_position, area_size) = snipping_preview_stack_anchor_area_for_monitor(monitor);
    let scale = monitor.scale_factor().max(0.1);
    let margin = (SNIPPING_FLOAT_STACK_MARGIN * scale).round() as i32;
    let gap = (SNIPPING_FLOAT_STACK_GAP * scale).round() as i32;
    let width_physical = (width * scale).round().max(1.0) as i32;
    let height_physical = (height * scale).round().max(1.0) as i32;
    SnippingPreviewStackMetrics {
        key: SnippingPreviewStackMonitorKey {
            x: area_position.x,
            y: area_position.y,
            width: area_size.width,
            height: area_size.height,
            scale_micros: (scale * 1_000_000.0).round() as i64,
        },
        x: area_position.x + margin,
        top_limit: area_position.y + margin,
        bottom_edge: area_position.y + area_size.height as i32 - margin,
        gap,
        width_physical,
        height_physical,
    }
}

fn snipping_preview_stack_anchor_area_for_monitor(
    monitor: &tauri::Monitor,
) -> (tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>) {
    let (position, size, _) = floating_surface_anchor_area_for_monitor(monitor);
    (position, size)
}

fn snipping_monitor_overlap_area(
    position: tauri::PhysicalPosition<i32>,
    width: i32,
    height: i32,
    monitor: &tauri::Monitor,
) -> i64 {
    let (area_position, area_size) = snipping_preview_stack_anchor_area_for_monitor(monitor);
    let left = position.x.max(area_position.x);
    let top = position.y.max(area_position.y);
    let right = (position.x + width.max(1)).min(area_position.x + area_size.width as i32);
    let bottom = (position.y + height.max(1)).min(area_position.y + area_size.height as i32);
    i64::from((right - left).max(0)) * i64::from((bottom - top).max(0))
}

fn snipping_preview_stack_monitor_for_rect(
    app: &AppHandle,
    position: tauri::PhysicalPosition<i32>,
    width: i32,
    height: i32,
) -> Option<tauri::Monitor> {
    let width = width.max(1);
    let height = height.max(1);
    let center_x = f64::from(position.x) + f64::from(width) * 0.5;
    let center_y = f64::from(position.y) + f64::from(height) * 0.5;
    app.monitor_from_point(center_x, center_y)
        .ok()
        .flatten()
        .or_else(|| {
            app.available_monitors().ok().and_then(|monitors| {
                let mut best: Option<(tauri::Monitor, i64)> = None;
                for monitor in monitors {
                    let area = snipping_monitor_overlap_area(position, width, height, &monitor);
                    if area > best.as_ref().map(|(_, best_area)| *best_area).unwrap_or(0) {
                        best = Some((monitor, area));
                    }
                }
                best.map(|(monitor, _)| monitor)
            })
        })
        .or_else(|| {
            app.get_webview_window("main")
                .and_then(|main_window| main_window.current_monitor().ok().flatten())
        })
        .or_else(|| app.primary_monitor().ok().flatten())
}

fn snipping_preview_stack_active_monitor(app: &AppHandle) -> Option<tauri::Monitor> {
    app.cursor_position()
        .ok()
        .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten())
        .or_else(|| {
            app.get_webview_window("main")
                .and_then(|main_window| main_window.current_monitor().ok().flatten())
        })
        .or_else(|| app.primary_monitor().ok().flatten())
}

fn snipping_preview_window_in_stack_column(app: &AppHandle, window: &tauri::WebviewWindow) -> bool {
    let Ok(position) = window.outer_position() else {
        return false;
    };
    let (width, height) = window
        .outer_size()
        .map(|size| (size.width.max(1) as i32, size.height.max(1) as i32))
        .unwrap_or((1, 1));
    snipping_preview_stack_monitor_for_rect(app, position, width, height)
        .map(|monitor| {
            let metrics = snipping_preview_stack_metrics_for_monitor(
                &monitor,
                SNIPPING_FLOAT_LOGICAL_WIDTH,
                SNIPPING_FLOAT_LOGICAL_HEIGHT,
            );
            snipping_preview_in_stack_column(position.x, width, metrics.x)
        })
        .unwrap_or(false)
}

/// Bottom-left stacking slot for a new preview window: directly above the
/// highest preview still sitting in the left column, or the bottom corner of
/// the work area when none are there.
fn snipping_preview_stack_position(
    app: &AppHandle,
    width: f64,
    height: f64,
) -> Option<tauri::PhysicalPosition<i32>> {
    let monitor = snipping_preview_stack_active_monitor(app)?;
    let metrics = snipping_preview_stack_metrics_for_monitor(&monitor, width, height);
    let bottom_y = metrics.bottom_edge - metrics.height_physical;

    let mut highest_top: Option<i32> = None;
    let closing_labels = snipping_preview_closing_labels(app);
    for (label, window) in app.webview_windows() {
        if !label.starts_with(SNIPPING_FLOAT_WINDOW_PREFIX) {
            continue;
        }
        if closing_labels.contains(&label) {
            continue;
        }
        if !window.is_visible().unwrap_or(false) {
            continue;
        }
        let Ok(position) = window.outer_position() else {
            continue;
        };
        let (window_width, window_height) = window
            .outer_size()
            .map(|size| (size.width.max(1) as i32, size.height.max(1) as i32))
            .unwrap_or((metrics.width_physical, metrics.height_physical));
        let Some(window_monitor) =
            snipping_preview_stack_monitor_for_rect(app, position, window_width, window_height)
        else {
            continue;
        };
        if snipping_preview_stack_metrics_for_monitor(&window_monitor, width, height).key
            != metrics.key
        {
            continue;
        }
        // Only stack against previews still parked in the left column; ones
        // the user dragged away stop reserving a slot.
        if !snipping_preview_in_stack_column(position.x, window_width, metrics.x) {
            continue;
        }
        highest_top = Some(highest_top.map_or(position.y, |current| current.min(position.y)));
    }

    let y = match highest_top {
        Some(top) => (top - metrics.gap - metrics.height_physical).max(metrics.top_limit),
        None => bottom_y,
    };
    Some(tauri::PhysicalPosition::new(metrics.x, y))
}

// One snappy tween profile for both mid-drag re-packs and release settles:
// an ease-out starts at full speed so the queue reacts instantly (an ease-in
// ramp reads as input lag under the 33ms re-target stream) and still lands
// softly.
const SNIPPING_FLOAT_ANIMATE_MS: f64 = 360.0;
const SNIPPING_FLOAT_ANIMATE_FRAME_MS: u64 = 12;
const SNIPPING_FLOAT_LIVE_REFLOW_THROTTLE_MS: u64 = 33;

#[derive(Clone, Copy, PartialEq)]
enum SnippingTweenEasing {
    /// Ease-out cubic: starts at full speed, lands softly.
    Track,
}

fn snipping_tween_eased(progress: f64, easing: SnippingTweenEasing) -> f64 {
    let t = progress.clamp(0.0, 1.0);
    match easing {
        SnippingTweenEasing::Track => 1.0 - (1.0 - t).powi(3),
    }
}

fn snipping_set_preview_logical_size_now(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    width: f64,
    height: f64,
) {
    app.state::<SnippingState>()
        .preview_size_animation_generation
        .fetch_add(1, Ordering::SeqCst);
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
}

fn snipping_animate_preview_logical_size(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    from_width: f64,
    from_height: f64,
    to_width: f64,
    to_height: f64,
    duration_ms: f64,
    center_on_cursor: bool,
) {
    let generation = app
        .state::<SnippingState>()
        .preview_size_animation_generation
        .clone();
    let ticket = generation.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = window.set_size(tauri::LogicalSize::new(from_width, from_height));
    let app = app.clone();
    let window = window.clone();
    let label = window.label().to_string();
    let duration_ms = duration_ms.max(1.0);
    thread::spawn(move || {
        let started = Instant::now();
        loop {
            if generation.load(Ordering::SeqCst) != ticket {
                return;
            }
            let progress = (started.elapsed().as_millis() as f64 / duration_ms).min(1.0);
            let eased = snipping_tween_eased(progress, SnippingTweenEasing::Track);
            let width = from_width + (to_width - from_width) * eased;
            let height = from_height + (to_height - from_height) * eased;
            let app_for_frame = app.clone();
            let window_for_frame = window.clone();
            let label_for_frame = label.clone();
            let generation_for_frame = generation.clone();
            let _ = app.run_on_main_thread(move || {
                if generation_for_frame.load(Ordering::SeqCst) != ticket {
                    return;
                }
                if app_for_frame
                    .get_webview_window(label_for_frame.as_str())
                    .is_none()
                    || snipping_preview_is_closing(&app_for_frame, &label_for_frame)
                {
                    return;
                }
                let _ = window_for_frame.set_size(tauri::LogicalSize::new(width, height));
                if center_on_cursor
                    && snipping_preview_is_dragging(&app_for_frame, &label_for_frame)
                {
                    let _ = snipping_position_preview_under_cursor(
                        &app_for_frame,
                        &window_for_frame,
                        width,
                        height,
                    );
                }
            });
            if progress >= 1.0 {
                return;
            }
            thread::sleep(Duration::from_millis(SNIPPING_FLOAT_ANIMATE_FRAME_MS));
        }
    });
}

fn snipping_animate_preview_logical_size_to_full(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    from_width: f64,
    from_height: f64,
    duration_ms: f64,
) {
    snipping_animate_preview_logical_size(
        app,
        window,
        from_width,
        from_height,
        SNIPPING_FLOAT_LOGICAL_WIDTH,
        SNIPPING_FLOAT_LOGICAL_HEIGHT,
        duration_ms,
        false,
    );
}

fn snipping_animate_preview_logical_size_to_full_under_cursor(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    from_width: f64,
    from_height: f64,
    duration_ms: f64,
) {
    snipping_animate_preview_logical_size(
        app,
        window,
        from_width,
        from_height,
        SNIPPING_FLOAT_LOGICAL_WIDTH,
        SNIPPING_FLOAT_LOGICAL_HEIGHT,
        duration_ms,
        true,
    );
}

/// Tweens preview windows to their stack slots instead of snapping them. A
/// new animation (or a re-targeted reflow mid-drag) bumps the generation,
/// which stops in-flight tween threads at their next frame — the new tween
/// picks up from wherever each window currently is, so rapid re-targets stay
/// fluid.
fn snipping_animate_previews(
    app: &AppHandle,
    moves: Vec<(
        tauri::WebviewWindow,
        tauri::PhysicalPosition<i32>,
        tauri::PhysicalPosition<i32>,
    )>,
    duration_ms: f64,
    easing: SnippingTweenEasing,
) {
    if moves.is_empty() {
        return;
    }
    let duration_ms = duration_ms.max(1.0);
    let generation = app
        .state::<SnippingState>()
        .preview_animation_generation
        .clone();
    let ticket = generation.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    thread::spawn(move || {
        let started = Instant::now();
        loop {
            if generation.load(Ordering::SeqCst) != ticket {
                return;
            }
            let progress = (started.elapsed().as_millis() as f64 / duration_ms).min(1.0);
            let eased = snipping_tween_eased(progress, easing);
            let frame: Vec<(tauri::WebviewWindow, i32, i32)> = moves
                .iter()
                .map(|(window, from, to)| {
                    (
                        window.clone(),
                        from.x + (f64::from(to.x - from.x) * eased).round() as i32,
                        from.y + (f64::from(to.y - from.y) * eased).round() as i32,
                    )
                })
                .collect();
            let frame_generation = generation.clone();
            let app_for_frame = app.clone();
            let _ = app.run_on_main_thread(move || {
                if frame_generation.load(Ordering::SeqCst) != ticket {
                    return;
                }
                for (window, x, y) in frame {
                    // A preview can close mid-tween (its captured handle
                    // outlives the window): never poke a dead window.
                    if app_for_frame.get_webview_window(window.label()).is_none()
                        || snipping_preview_is_closing(&app_for_frame, window.label())
                        || snipping_preview_is_dragging(&app_for_frame, window.label())
                    {
                        continue;
                    }
                    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                }
            });
            if progress >= 1.0 {
                return;
            }
            thread::sleep(Duration::from_millis(SNIPPING_FLOAT_ANIMATE_FRAME_MS));
        }
    });
}

/// Re-packs every queue-owned preview parked in the bottom-left column into a
/// tight bottom-up stack. A manually dragged preview becomes detached after
/// release: it can still block the column, but the queue no longer pulls it
/// into an auto slot.
fn snipping_reflow_preview_stack(app: &AppHandle, animate_ms: f64, easing: SnippingTweenEasing) {
    let dragging_labels = snipping_preview_dragging_labels(app);
    let detached_labels = snipping_preview_detached_labels(app);
    let closing_labels = snipping_preview_closing_labels(app);

    type StackPreviewEntry = (
        tauri::PhysicalPosition<i32>,
        i32,
        tauri::WebviewWindow,
        bool,
        bool,
    );
    let mut groups: HashMap<
        SnippingPreviewStackMonitorKey,
        (SnippingPreviewStackMetrics, Vec<StackPreviewEntry>),
    > = HashMap::new();
    for (label, window) in app.webview_windows() {
        if !label.starts_with(SNIPPING_FLOAT_WINDOW_PREFIX) {
            continue;
        }
        if closing_labels.contains(&label) {
            continue;
        }
        if !window.is_visible().unwrap_or(false) {
            continue;
        }
        let Ok(position) = window.outer_position() else {
            continue;
        };
        let (width, height) = window
            .outer_size()
            .map(|size| (size.width as i32, size.height as i32))
            .unwrap_or((1, 1));
        let Some(monitor) = snipping_preview_stack_monitor_for_rect(app, position, width, height)
        else {
            continue;
        };
        let metrics = snipping_preview_stack_metrics_for_monitor(
            &monitor,
            SNIPPING_FLOAT_LOGICAL_WIDTH,
            SNIPPING_FLOAT_LOGICAL_HEIGHT,
        );
        // Same queue-ownership test as snipping_preview_stack_position.
        if !snipping_preview_in_stack_column(position.x, width, metrics.x) {
            continue;
        }
        let height = height.max(1);
        let entry = groups
            .entry(metrics.key)
            .or_insert_with(|| (metrics, Vec::new()));
        entry.1.push((
            position,
            height,
            window,
            dragging_labels.contains(&label),
            detached_labels.contains(&label),
        ));
    }

    let mut moves = Vec::new();
    for (_, (metrics, mut previews)) in groups {
        // The lowest window keeps the bottom slot; on-screen order is preserved.
        previews.sort_by(|a, b| (b.0.y + b.1).cmp(&(a.0.y + a.1)));
        // A held window is an obstacle at its REAL on-screen band, not at a
        // canonical packed slot. Detached windows use the same treatment after
        // release, preventing the old left-side auto-align from grabbing them.
        let mut obstacle_bands: Vec<(i32, i32)> = previews
            .iter()
            .filter(|(_, _, _, dragging, detached)| *dragging || *detached)
            .map(|(position, height, _, _, _)| (position.y, position.y + height))
            .collect();
        obstacle_bands.sort_by(|a, b| b.1.cmp(&a.1));
        let mut bottom_edge = metrics.bottom_edge;
        for (position, height, window, dragging, detached) in previews {
            if dragging || detached {
                // The OS drag owns a held window's position; a detached window is
                // user-positioned. Their bands above already block slots.
                continue;
            }
            let mut y = bottom_edge - height;
            for (band_top, band_bottom) in &obstacle_bands {
                let intersects =
                    y < band_bottom + metrics.gap && y + height > band_top - metrics.gap;
                if intersects {
                    // The lowest free slot would collide with the held preview:
                    // hop fully above it (bands are visited lowest-first, so a
                    // hop can cascade past stacked obstacles).
                    y = band_top - metrics.gap - height;
                }
            }
            let y = y.max(metrics.top_limit);
            if position.x != metrics.x || position.y != y {
                moves.push((window, position, tauri::PhysicalPosition::new(metrics.x, y)));
            }
            bottom_edge = y - metrics.gap;
        }
    }
    snipping_animate_previews(app, moves, animate_ms, easing);
}

/// Throttled live re-pack while the user drags a preview: the rest of the
/// stack parts around (or collapses behind) the held window in real time.
fn snipping_live_reflow_on_drag(app: &AppHandle, label: &str) {
    let state = app.state::<SnippingState>();
    let is_dragging = state
        .preview_drag_sessions
        .lock()
        .map(|sessions| sessions.contains_key(label))
        .unwrap_or(false);
    if !is_dragging {
        return;
    }
    if snipping_preview_drag_handoff_active(app, label) {
        return;
    }
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let last_ms = state.preview_live_reflow_last_ms.load(Ordering::SeqCst);
    if now_ms.saturating_sub(last_ms) < SNIPPING_FLOAT_LIVE_REFLOW_THROTTLE_MS {
        return;
    }
    state
        .preview_live_reflow_last_ms
        .store(now_ms, Ordering::SeqCst);
    snipping_reflow_preview_stack(app, SNIPPING_FLOAT_ANIMATE_MS, SnippingTweenEasing::Track);
}

fn snipping_now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn snipping_preview_drag_handoff_active(app: &AppHandle, label: &str) -> bool {
    let now_ms = snipping_now_epoch_ms();
    app.state::<SnippingState>()
        .preview_drag_handoff_until_ms
        .lock()
        .map(|handoffs| handoffs.get(label).is_some_and(|until_ms| now_ms < *until_ms))
        .unwrap_or(false)
}

fn snipping_any_preview_drag_handoff_active(app: &AppHandle) -> bool {
    let now_ms = snipping_now_epoch_ms();
    app.state::<SnippingState>()
        .preview_drag_handoff_until_ms
        .lock()
        .map(|handoffs| handoffs.values().any(|until_ms| now_ms < *until_ms))
        .unwrap_or(false)
}

fn snipping_finish_preview_drag_handoff(app: &AppHandle, label: &str) -> bool {
    let now_ms = snipping_now_epoch_ms();
    app.state::<SnippingState>()
        .preview_drag_handoff_until_ms
        .lock()
        .map(|mut handoffs| match handoffs.get(label).copied() {
            Some(until_ms) if now_ms >= until_ms => {
                handoffs.remove(label);
                true
            }
            _ => false,
        })
        .unwrap_or(false)
}

fn snipping_begin_preview_drag_handoff(app: &AppHandle, label: &str) {
    let until_ms = snipping_now_epoch_ms() + SNIPPING_FLOAT_DRAG_HANDOFF_GRACE_MS;
    let state = app.state::<SnippingState>();
    if let Ok(mut handoffs) = state.preview_drag_handoff_until_ms.lock() {
        handoffs.insert(label.to_string(), until_ms);
    }

    let app_for_expand = app.clone();
    let label_for_expand = label.to_string();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(
            SNIPPING_FLOAT_DRAG_HANDOFF_EXPAND_DELAY_MS,
        ));
        let app_for_main = app_for_expand.clone();
        let label_for_main = label_for_expand.clone();
        let _ = app_for_expand.run_on_main_thread(move || {
            if !snipping_preview_drag_handoff_active(&app_for_main, &label_for_main)
                || !snipping_preview_is_dragging(&app_for_main, &label_for_main)
            {
                return;
            }
            let Some(window) = app_for_main.get_webview_window(&label_for_main) else {
                return;
            };
            if snipping_preview_overlaps_strip(&app_for_main, &window) {
                snipping_update_preview_strip_drag_state(&app_for_main, &label_for_main, false);
                return;
            }
            snipping_animate_preview_logical_size_to_full_under_cursor(
                &app_for_main,
                &window,
                SNIPPING_STRIP_TILE_LOGICAL_WIDTH,
                SNIPPING_STRIP_TILE_LOGICAL_HEIGHT,
                (SNIPPING_FLOAT_DRAG_HANDOFF_GRACE_MS
                    .saturating_sub(SNIPPING_FLOAT_DRAG_HANDOFF_EXPAND_DELAY_MS))
                    as f64,
            );
        });

        thread::sleep(Duration::from_millis(
            SNIPPING_FLOAT_DRAG_HANDOFF_GRACE_MS
                .saturating_sub(SNIPPING_FLOAT_DRAG_HANDOFF_EXPAND_DELAY_MS),
        ));
        let app_for_main = app_for_expand.clone();
        let label_for_main = label_for_expand.clone();
        let _ = app_for_expand.run_on_main_thread(move || {
            if !snipping_finish_preview_drag_handoff(&app_for_main, &label_for_main) {
                return;
            }
            if snipping_preview_is_dragging(&app_for_main, &label_for_main) {
                snipping_update_preview_strip_drag_state(&app_for_main, &label_for_main, false);
                schedule_snipping_preview_stack_reflow(&app_for_main);
            }
        });
    });
}

/// Settle deadline for the current platform: short where the watcher has a
/// live button probe (the deadline then only covers programmatic restack
/// animations), longer where Moved-event silence is the only release signal
/// so a mid-drag pause is not mistaken for a drop.
fn snipping_restack_settle_ms() -> u64 {
    if snipping_mouse_button_state_supported() {
        SNIPPING_FLOAT_RESTACK_SETTLE_MS
    } else {
        SNIPPING_FLOAT_RESTACK_SETTLE_FALLBACK_MS
    }
}

fn snipping_begin_left_column_post_release_settle(app: &AppHandle) -> bool {
    // Platforms without a reliable button probe already wait for Moved-event
    // stillness before resolving, so they do not need a second release gate.
    if !snipping_mouse_button_state_supported() {
        return false;
    }
    let state = app.state::<SnippingState>();
    let labels = state
        .preview_drag_sessions
        .lock()
        .map(|sessions| sessions.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    if labels.is_empty() {
        return false;
    }

    let left_column_labels = labels
        .into_iter()
        .filter(|label| {
            app.get_webview_window(label).is_some_and(|window| {
                !snipping_preview_overlaps_strip(app, &window)
                    && snipping_preview_window_in_stack_column(app, &window)
            })
        })
        .collect::<Vec<_>>();
    if left_column_labels.is_empty() {
        return false;
    }

    let marked = state
        .preview_post_release_settling_labels
        .lock()
        .map(|mut settling| {
            let mut inserted = false;
            for label in left_column_labels {
                inserted |= settling.insert(label);
            }
            inserted
        })
        .unwrap_or(false);
    marked
}

/// Settle trigger fed by preview Moved/Destroyed window events and drag
/// starts. Pushes the shared deadline forward and ensures the single watcher
/// thread is running: the watcher resolves most user drags the instant the
/// mouse button releases, but waits for Moved-event stillness when a preview
/// was released over the left queue column. One thread total, instead of one
/// spawned per Moved event.
fn schedule_snipping_preview_stack_reflow(app: &AppHandle) {
    let state = app.state::<SnippingState>();
    state.preview_restack_deadline_ms.store(
        snipping_now_epoch_ms() + snipping_restack_settle_ms(),
        Ordering::SeqCst,
    );
    if state
        .preview_restack_watcher_active
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    let deadline = state.preview_restack_deadline_ms.clone();
    let watcher_active = state.preview_restack_watcher_active.clone();
    let drag_sessions = state.preview_drag_sessions.clone();
    let post_release_settling = state.preview_post_release_settling_labels.clone();
    let post_release_check_pending = state.preview_post_release_check_pending.clone();
    let app = app.clone();
    thread::spawn(move || {
        let button_probe = snipping_mouse_button_state_supported();
        loop {
            thread::sleep(Duration::from_millis(SNIPPING_FLOAT_SETTLE_POLL_MS));
            let dragging = drag_sessions
                .lock()
                .map(|sessions| !sessions.is_empty())
                .unwrap_or(false);
            let settling_after_release = post_release_settling
                .lock()
                .map(|settling| !settling.is_empty())
                .unwrap_or(false);
            let release_check_pending = post_release_check_pending.load(Ordering::SeqCst);
            if button_probe {
                let button_down = snipping_left_mouse_button_pressed();
                if dragging && button_down {
                    // Still holding: never settle mid-drag, however long the
                    // pause — keep watching for the release.
                    continue;
                }
                if settling_after_release || release_check_pending {
                    if snipping_now_epoch_ms() >= deadline.load(Ordering::SeqCst) {
                        break;
                    }
                    continue;
                }
                if dragging {
                    // Released; the main-thread settle pass will decide
                    // whether the left-column native quiet gate applies.
                    post_release_check_pending.store(true, Ordering::SeqCst);
                    break;
                }
            }
            if snipping_now_epoch_ms() >= deadline.load(Ordering::SeqCst) {
                break;
            }
        }
        watcher_active.store(false, Ordering::SeqCst);
        let app_for_settle = app.clone();
        let _ = app.run_on_main_thread(move || {
            snipping_settle_preview_windows(&app_for_settle);
        });
    });
}

/// Runs once a drag released (or the move stream went quiet): first offers
/// any user-dragged preview to the main webview as a drop, then re-packs the
/// bottom-left stack.
fn snipping_settle_preview_windows(app: &AppHandle) {
    if snipping_any_preview_drag_handoff_active(app) {
        schedule_snipping_preview_stack_reflow(app);
        return;
    }
    if snipping_left_mouse_button_pressed() {
        // Rare watcher race (a drag re-grabbed between release and settle):
        // never resolve a drop while the button is held; watch again.
        schedule_snipping_preview_stack_reflow(app);
        return;
    }
    let settling_after_release = {
        let state = app.state::<SnippingState>();
        state
            .preview_post_release_settling_labels
            .lock()
            .map(|settling| !settling.is_empty())
            .unwrap_or(false)
    };
    if !settling_after_release && snipping_begin_left_column_post_release_settle(app) {
        app.state::<SnippingState>()
            .preview_post_release_check_pending
            .store(false, Ordering::SeqCst);
        schedule_snipping_preview_stack_reflow(app);
        app.state::<SnippingState>()
            .preview_restack_deadline_ms
            .store(
                snipping_now_epoch_ms() + SNIPPING_FLOAT_POST_RELEASE_SETTLE_MS,
                Ordering::SeqCst,
            );
        return;
    }
    app.state::<SnippingState>()
        .preview_post_release_check_pending
        .store(false, Ordering::SeqCst);
    if settling_after_release {
        if snipping_now_epoch_ms()
            < app
                .state::<SnippingState>()
                .preview_restack_deadline_ms
                .load(Ordering::SeqCst)
        {
            schedule_snipping_preview_stack_reflow(app);
            app.state::<SnippingState>()
                .preview_restack_deadline_ms
                .store(
                    snipping_now_epoch_ms() + SNIPPING_FLOAT_POST_RELEASE_SETTLE_MS,
                    Ordering::SeqCst,
                );
            return;
        }
        if let Ok(mut settling) = app
            .state::<SnippingState>()
            .preview_post_release_settling_labels
            .lock()
        {
            settling.clear();
        }
    }
    snipping_resolve_preview_drop_candidates(app);
    snipping_reflow_preview_stack(app, SNIPPING_FLOAT_ANIMATE_MS, SnippingTweenEasing::Track);
}

/// Maps a preview window's center to main-webview CSS coordinates, or None
/// when the point is outside the main window's webview.
fn snipping_preview_point_in_main(
    app: &AppHandle,
    preview: &tauri::WebviewWindow,
) -> Option<(f64, f64)> {
    let main = app.get_webview_window("main")?;
    if !main.is_visible().unwrap_or(false) || main.is_minimized().unwrap_or(false) {
        return None;
    }
    let position = preview.outer_position().ok()?;
    let size = preview.outer_size().ok()?;
    let center_x = position.x + size.width as i32 / 2;
    let center_y = position.y + size.height as i32 / 2;
    let main_origin = main.inner_position().ok()?;
    let main_size = main.inner_size().ok()?;
    if center_x < main_origin.x
        || center_y < main_origin.y
        || center_x >= main_origin.x + main_size.width as i32
        || center_y >= main_origin.y + main_size.height as i32
    {
        return None;
    }
    let scale = main.scale_factor().unwrap_or(1.0).max(0.1);
    Some((
        f64::from(center_x - main_origin.x) / scale,
        f64::from(center_y - main_origin.y) / scale,
    ))
}

/// True when a native preview substantially overlaps the recent-snips strip.
/// This is the drag-back bridge between the native preview window and the
/// high-throughput DOM rail that renders docked items.
fn snipping_preview_overlaps_strip(app: &AppHandle, preview: &tauri::WebviewWindow) -> bool {
    let Some(strip) = app.get_webview_window(SNIPPING_STRIP_WINDOW_LABEL) else {
        return false;
    };
    if !strip.is_visible().unwrap_or(false) || strip.is_minimized().unwrap_or(false) {
        return false;
    }
    let Ok(preview_position) = preview.outer_position() else {
        return false;
    };
    let Ok(preview_size) = preview.outer_size() else {
        return false;
    };
    let Ok(strip_position) = strip.outer_position() else {
        return false;
    };
    let Ok(strip_size) = strip.outer_size() else {
        return false;
    };
    let preview_left = preview_position.x;
    let preview_top = preview_position.y;
    let preview_right = preview_left + preview_size.width as i32;
    let preview_bottom = preview_top + preview_size.height as i32;
    let strip_left = strip_position.x;
    let strip_top = strip_position.y;
    let strip_right = strip_left + strip_size.width as i32;
    let strip_bottom = strip_top + strip_size.height as i32;
    let overlap_x = preview_right.min(strip_right) - preview_left.max(strip_left);
    let overlap_y = preview_bottom.min(strip_bottom) - preview_top.max(strip_top);
    let scale = strip.scale_factor().unwrap_or(1.0).max(0.1);
    let min_overlap_x = (24.0 * scale).round().max(1.0) as i32;
    let min_overlap_y = (14.0 * scale).round().max(1.0) as i32;
    overlap_x >= min_overlap_x && overlap_y >= min_overlap_y
}

fn snipping_preview_strip_client_x(
    app: &AppHandle,
    preview: &tauri::WebviewWindow,
) -> Option<f64> {
    let strip = app.get_webview_window(SNIPPING_STRIP_WINDOW_LABEL)?;
    let preview_position = preview.outer_position().ok()?;
    let preview_size = preview.outer_size().ok()?;
    let strip_position = strip.outer_position().ok()?;
    let scale = strip.scale_factor().unwrap_or(1.0).max(0.1);
    let center_x = preview_position.x + preview_size.width as i32 / 2;
    Some(f64::from(center_x - strip_position.x) / scale)
}

fn snipping_emit_strip_drag_event(
    app: &AppHandle,
    label: &str,
    window: Option<&tauri::WebviewWindow>,
    over: bool,
    done: bool,
    docked: bool,
) {
    let path = app
        .state::<SnippingState>()
        .preview_paths
        .lock()
        .ok()
        .and_then(|paths| paths.get(label).cloned())
        .unwrap_or_default();
    let mut payload = json!({
        "kind": "snip_strip_drag",
        "label": label,
        "path": path,
        "over": over,
        "done": done,
        "docked": docked,
    });
    if let Some(client_x) = window.and_then(|preview| snipping_preview_strip_client_x(app, preview))
    {
        payload["clientX"] = json!(client_x);
    }
    let _ = app.emit_to(SNIPPING_STRIP_WINDOW_LABEL, SNIPPING_STRIP_DRAG_EVENT, payload);
}

fn snipping_update_preview_strip_drag_state(
    app: &AppHandle,
    label: &str,
    force_full_when_not_over: bool,
) {
    let is_dragging = app
        .state::<SnippingState>()
        .preview_drag_sessions
        .lock()
        .map(|sessions| sessions.contains_key(label))
        .unwrap_or(false);
    if !is_dragging {
        return;
    }
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    let over_strip = snipping_preview_overlaps_strip(app, &window);
    let changed = app
        .state::<SnippingState>()
        .preview_strip_hover_labels
        .lock()
        .map(|mut hovered| {
            if over_strip {
                hovered.insert(label.to_string())
            } else {
                hovered.remove(label)
            }
        })
        .unwrap_or(false);
    if over_strip {
        if changed {
            snipping_set_preview_logical_size_now(
                app,
                &window,
                SNIPPING_STRIP_TILE_LOGICAL_WIDTH,
                SNIPPING_STRIP_TILE_LOGICAL_HEIGHT,
            );
            let _ = snipping_position_preview_under_cursor(
                app,
                &window,
                SNIPPING_STRIP_TILE_LOGICAL_WIDTH,
                SNIPPING_STRIP_TILE_LOGICAL_HEIGHT,
            );
        }
        snipping_emit_strip_drag_event(app, label, Some(&window), true, false, false);
    } else {
        if changed || force_full_when_not_over {
            snipping_animate_preview_logical_size_to_full(
                app,
                &window,
                SNIPPING_STRIP_TILE_LOGICAL_WIDTH,
                SNIPPING_STRIP_TILE_LOGICAL_HEIGHT,
                SNIPPING_FLOAT_ANIMATE_MS * 0.45,
            );
        }
        if changed {
            snipping_emit_strip_drag_event(app, label, Some(&window), false, false, false);
        }
    }
}

fn snipping_clear_preview_strip_drag_state(
    app: &AppHandle,
    label: &str,
    window: Option<&tauri::WebviewWindow>,
    expand_to_full: bool,
    docked: bool,
) {
    let changed = app
        .state::<SnippingState>()
        .preview_strip_hover_labels
        .lock()
        .map(|mut hovered| hovered.remove(label))
        .unwrap_or(false);
    if expand_to_full && changed {
        if let Some(window) = window {
            snipping_animate_preview_logical_size_to_full(
                app,
                window,
                SNIPPING_STRIP_TILE_LOGICAL_WIDTH,
                SNIPPING_STRIP_TILE_LOGICAL_HEIGHT,
                SNIPPING_FLOAT_ANIMATE_MS * 0.45,
            );
        }
    }
    if changed || docked {
        snipping_emit_strip_drag_event(app, label, window, false, true, docked);
    }
}

/// Offers every settled user drag to the main webview as a drop candidate.
/// The webview decides whether something accepts it (and then calls
/// snipping_consume_snip_preview); Rust only reports where it landed.
fn snipping_resolve_preview_drop_candidates(app: &AppHandle) {
    let state = app.state::<SnippingState>();
    let sessions: Vec<(String, (i32, i32))> = match state.preview_drag_sessions.lock() {
        Ok(mut guard) => guard.drain().collect(),
        Err(_) => return,
    };
    if sessions.is_empty() {
        return;
    }
    // Always tell the webview the drag ended so target highlights clear.
    let _ = app.emit_to(
        "main",
        SNIPPING_PREVIEW_DRAG_OVER_EVENT,
        json!({ "kind": "snip_preview_drag_over", "done": true }),
    );
    for (label, (start_x, start_y)) in sessions {
        let Some(window) = app.get_webview_window(&label) else {
            continue;
        };
        let Ok(position) = window.outer_position() else {
            continue;
        };
        if (position.x - start_x).abs() < SNIPPING_PREVIEW_DRAG_MIN_DISTANCE
            && (position.y - start_y).abs() < SNIPPING_PREVIEW_DRAG_MIN_DISTANCE
        {
            snipping_clear_preview_strip_drag_state(app, &label, Some(&window), true, false);
            continue;
        }
        let path = state
            .preview_paths
            .lock()
            .ok()
            .and_then(|paths| paths.get(&label).cloned())
            .unwrap_or_default();
        if path.is_empty() {
            snipping_clear_preview_strip_drag_state(app, &label, Some(&window), true, false);
            continue;
        }
        if snipping_preview_overlaps_strip(app, &window) {
            if let Ok(mut detached) = state.preview_detached_labels.lock() {
                detached.remove(&label);
            }
            snipping_clear_preview_strip_drag_state(app, &label, Some(&window), false, true);
            snipping_close_preview_window(app, &label, "strip-returned");
            continue;
        }
        snipping_clear_preview_strip_drag_state(app, &label, Some(&window), true, false);
        // A drop inside the bottom-left queue column adopts the preview (the
        // reflow then packs it); a drop back onto the strip was handled above.
        // Anywhere else detaches it at the user's position.
        let adopted_by_queue = snipping_preview_window_in_stack_column(app, &window);
        if let Ok(mut detached) = state.preview_detached_labels.lock() {
            if adopted_by_queue {
                detached.remove(&label);
            } else {
                detached.insert(label.clone());
            }
        }
        let Some((client_x, client_y)) = snipping_preview_point_in_main(app, &window) else {
            continue;
        };
        let _ = app.emit_to(
            "main",
            SNIPPING_PREVIEW_DROP_EVENT,
            json!({
                "kind": "snip_preview_drop",
                "label": label,
                "path": path,
                "clientX": client_x,
                "clientY": client_y,
            }),
        );
    }
}

/// Streams throttled drag-over points to the main webview while the user is
/// dragging a preview, so potential drop targets can highlight live.
fn snipping_emit_preview_drag_over(app: &AppHandle, label: &str) {
    let state = app.state::<SnippingState>();
    let dragging = state
        .preview_drag_sessions
        .lock()
        .map(|sessions| sessions.contains_key(label))
        .unwrap_or(false);
    if !dragging {
        return;
    }
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0);
    let last_ms = state.preview_drag_over_last_emit_ms.load(Ordering::SeqCst);
    if now_ms.saturating_sub(last_ms) < SNIPPING_PREVIEW_DRAG_OVER_THROTTLE_MS {
        return;
    }
    state
        .preview_drag_over_last_emit_ms
        .store(now_ms, Ordering::SeqCst);
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    let payload = match snipping_preview_point_in_main(app, &window) {
        Some((client_x, client_y)) => json!({
            "kind": "snip_preview_drag_over",
            "label": label,
            "clientX": client_x,
            "clientY": client_y,
        }),
        None => json!({ "kind": "snip_preview_drag_over", "label": label, "outside": true }),
    };
    let _ = app.emit_to("main", SNIPPING_PREVIEW_DRAG_OVER_EVENT, payload);
}

const SNIPPING_FLOAT_ASSIGN_EVENT: &str = "forge-snip-float-assign";
// Fired whenever the set of open floating previews changes (open, close,
// destroy), so any quick-access UI watching preview state can refresh.
const SNIPPING_FLOATS_CHANGED_EVENT: &str = "forge-snip-floats-changed";
// Keep two parked preview windows booted: one for the immediate drag/capture
// handoff and one spare while the consumed window is being refilled.
const SNIPPING_FLOAT_POOL_TARGET: usize = 2;

fn snipping_emit_floats_changed(app: &AppHandle) {
    let _ = app.emit(
        SNIPPING_FLOATS_CHANGED_EVENT,
        json!({ "kind": "snip_floats_changed" }),
    );
}

/// Builds a snip preview window (hidden) with all of its chrome and window
/// event wiring; shared by direct opens and the warm pool.
/// Cross-Space style for floating previews, re-asserted on every show: the
/// CanJoinAllSpaces bit tao maintains does not join other apps' fullscreen
/// Spaces — that needs CanJoinAllApplications + FullScreenAuxiliary — and
/// the old build-time assert ran inline on whatever thread the opening
/// command happened to be on, where AppKit silently ignores NSWindow
/// mutations (pool windows, built on the main thread, worked; direct builds
/// intermittently did not). Same main-thread + every-show recipe as the strip
/// and monitor overlays.
/// Collection behavior alone is not enough on a fullscreen Space: tao's
/// always-on-top floating level (3) renders BEHIND the Space's raised
/// fullscreen window, so previews join the Space but stay invisible there.
/// They run at screen-saver level like the area overlay; the strip drag-out
/// level juggling restores to this same level.
#[cfg(target_os = "macos")]
fn snipping_preview_apply_macos_space_style(window: &tauri::WebviewWindow) {
    snipping_convert_overlay_window_to_panel(window);
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("preview_apply_macos_space_style", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            ns_window.setCollectionBehavior(
                objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllSpaces
                    | objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllApplications
                    | objc2_app_kit::NSWindowCollectionBehavior::FullScreenAuxiliary
                    | objc2_app_kit::NSWindowCollectionBehavior::Stationary,
            );
            ns_window.setLevel(objc2_app_kit::NSScreenSaverWindowLevel);
            // Hover must work without the window ever having been clicked: a
            // non-key NSWindow drops mouse-moved events by default, which left
            // the preview's hover chrome unreachable until a focusing click
            // (and made every button cost two clicks).
            ns_window.setAcceptsMouseMovedEvents(true);
        });
    });
}

/// Orders a preview front even while Diff Forge is NOT the active app (a
/// capture finishing inside another app's fullscreen Space): tao's show()
/// relies on makeKeyAndOrderFront, which does nothing visible there;
/// orderFrontRegardless is the documented way. Same recipe as the overlay
/// and the strip.
#[cfg(target_os = "macos")]
fn snipping_preview_order_front_regardless(window: &tauri::WebviewWindow) {
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("preview_order_front_regardless", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            ns_window.orderFrontRegardless();
        });
    });
}

fn snipping_build_preview_window(
    app: &AppHandle,
    label: &str,
    encoded_path: &str,
    focused: bool,
) -> Result<tauri::WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(
        app,
        label.to_string(),
        WebviewUrl::App(format!("index.html#/snipping-float/{encoded_path}").into()),
    )
    .title("Snip")
    .inner_size(SNIPPING_FLOAT_LOGICAL_WIDTH, SNIPPING_FLOAT_LOGICAL_HEIGHT)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .focused(focused)
    .accept_first_mouse(true)
    .skip_taskbar(true)
    .visible_on_all_workspaces(true)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .visible(false)
    .shadow(true)
    .build()
    .map_err(|error| format!("Unable to create snip preview window: {error}"))?;
    #[cfg(target_os = "macos")]
    snipping_preview_apply_macos_space_style(&window);
    // Dragging a preview out of the bottom-left column (or closing one) frees
    // its slot and the stack re-packs; dropping one back over the column
    // re-adopts it. Reflow is debounced until the window stops moving. While
    // a user drag is in flight, the move stream also feeds live drag-over
    // points to the main webview so drop targets can highlight.
    {
        let app_for_events = app.clone();
        let label_for_events = label.to_string();
        window.on_window_event(move |event| {
            match event {
                WindowEvent::Moved(_) => {
                    if snipping_preview_drag_handoff_active(&app_for_events, &label_for_events) {
                        if app_for_events
                            .get_webview_window(&label_for_events)
                            .is_some_and(|window| {
                                snipping_preview_overlaps_strip(&app_for_events, &window)
                            })
                        {
                            snipping_update_preview_strip_drag_state(
                                &app_for_events,
                                &label_for_events,
                                false,
                            );
                        }
                        return;
                    }
                    snipping_update_preview_strip_drag_state(
                        &app_for_events,
                        &label_for_events,
                        false,
                    );
                    snipping_emit_preview_drag_over(&app_for_events, &label_for_events);
                    // While the user holds this preview, the rest of the stack
                    // re-packs around it live (throttled, animated).
                    snipping_live_reflow_on_drag(&app_for_events, &label_for_events);
                    schedule_snipping_preview_stack_reflow(&app_for_events);
                }
                WindowEvent::CloseRequested { api, .. } => {
                    // Preview windows are re-classed AppKit panels. A real
                    // native close can still throw after close() returns, so
                    // treat close requests as dismissals: prevent destruction
                    // and park the hidden webview for the next snip.
                    api.prevent_close();
                    snipping_close_preview_window(
                        &app_for_events,
                        &label_for_events,
                        "close-requested",
                    );
                }
                WindowEvent::Destroyed => {
                    snipping_cleanup_preview_registry(&app_for_events, &label_for_events);
                    schedule_snipping_preview_stack_reflow(&app_for_events);
                    snipping_emit_floats_changed(&app_for_events);
                }
                _ => {}
            }
        });
    }
    Ok(window)
}

fn snipping_position_preview_window(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    explicit_position: Option<(f64, f64)>,
) {
    match explicit_position {
        Some((x, y)) => {
            let _ = window.set_position(tauri::LogicalPosition::new(x, y));
        }
        None => {
            if let Some(position) = snipping_preview_stack_position(
                app,
                SNIPPING_FLOAT_LOGICAL_WIDTH,
                SNIPPING_FLOAT_LOGICAL_HEIGHT,
            ) {
                let _ = window.set_position(position);
            }
        }
    }
}

fn snipping_cursor_logical_origin_for_preview(
    app: &AppHandle,
    width: f64,
    height: f64,
) -> Option<(f64, f64)> {
    let cursor = app.cursor_position().ok()?;
    let scale = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())
        .map(|monitor| monitor.scale_factor().max(0.1))
        .unwrap_or(1.0);
    Some((cursor.x / scale - width * 0.5, cursor.y / scale - height * 0.5))
}

fn snipping_position_preview_under_cursor(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    width: f64,
    height: f64,
) -> bool {
    let Ok(cursor) = app.cursor_position() else {
        return false;
    };
    let scale = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .map(|monitor| monitor.scale_factor().max(0.1))
        .unwrap_or(1.0);
    let width_physical = (width * scale).round() as i32;
    let height_physical = (height * scale).round() as i32;
    let x = cursor.x.round() as i32 - width_physical / 2;
    let y = cursor.y.round() as i32 - height_physical / 2;
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .is_ok()
}

/// Keeps hidden, fully booted preview windows parked so the next capture or
/// strip drag-out shows its preview instantly: webview creation and page boot
/// — the slow part of opening a preview on every platform — happen ahead of
/// time, off the interaction hot path.
fn snipping_warm_preview_pool(app: &AppHandle) {
    let state = app.state::<SnippingState>();
    let parked = state
        .preview_pool
        .lock()
        .map(|pool| pool.len())
        .unwrap_or(0);
    if parked >= SNIPPING_FLOAT_POOL_TARGET {
        return;
    }
    if state.preview_pool_spawning.swap(true, Ordering::SeqCst) {
        return;
    }
    let app_for_spawn = app.clone();
    let queued = app.run_on_main_thread(move || {
        let label = format!(
            "{SNIPPING_FLOAT_WINDOW_PREFIX}-pool-{}",
            uuid::Uuid::new_v4().simple()
        );
        let built = snipping_build_preview_window(&app_for_spawn, &label, "", false);
        let state = app_for_spawn.state::<SnippingState>();
        state.preview_pool_spawning.store(false, Ordering::SeqCst);
        if built.is_ok() {
            if let Ok(mut pool) = state.preview_pool.lock() {
                pool.push(label);
            }
            snipping_warm_preview_pool(&app_for_spawn);
        }
    });
    if queued.is_err() {
        state.preview_pool_spawning.store(false, Ordering::SeqCst);
    }
}

fn snipping_take_pooled_preview_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let state = app.state::<SnippingState>();
    loop {
        let label = state.preview_pool.lock().ok()?.pop()?;
        if let Some(window) = app.get_webview_window(&label) {
            return Some(window);
        }
    }
}

/// Path currently assigned to a preview window. Pool windows boot with no
/// path in their URL and may miss the assign event if adoption races their
/// boot; this query closes that gap on mount.
#[tauri::command]
fn snipping_float_assigned_path(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    let label = window.label().to_string();
    let path = app
        .state::<SnippingState>()
        .preview_paths
        .lock()
        .map_err(|_| "Unable to lock snip preview paths.".to_string())?
        .get(&label)
        .cloned()
        .unwrap_or_default();
    Ok(json!({
        "kind": "snip_float_assigned_path",
        "label": label,
        "path": path,
    }))
}

/// Opens one snip preview as its own draggable native window. Every preview is
/// a standalone window from the moment it is captured: new previews stack in
/// the bottom-left column and can be dragged anywhere (over any Space) without
/// ever changing identity. A pre-booted pooled window is adopted when one is
/// parked, making the preview effectively instant.
fn snipping_open_snip_preview_window_for(
    app: &AppHandle,
    path: &str,
    explicit_position: Option<(f64, f64)>,
    focused: bool,
) -> Result<Value, String> {
    snipping_open_snip_preview_window_for_with_size(app, path, explicit_position, focused, None)
}

fn snipping_open_snip_preview_window_for_with_size(
    app: &AppHandle,
    path: &str,
    explicit_position: Option<(f64, f64)>,
    focused: bool,
    initial_size: Option<(f64, f64)>,
) -> Result<Value, String> {
    let resolved_path = snipping_preview_current_path_string(app, path)?;
    let file = diffforge_local_asset_file(&resolved_path)?;
    let (width, height) =
        initial_size.unwrap_or((SNIPPING_FLOAT_LOGICAL_WIDTH, SNIPPING_FLOAT_LOGICAL_HEIGHT));
    let path_string = file.display().to_string();
    let label = format!(
        "{SNIPPING_FLOAT_WINDOW_PREFIX}-{}",
        snipping_window_token(&file)
    );
    let closing_labels = snipping_preview_closing_labels(app);

    // The path registry is authoritative: parked preview windows are reused
    // across snips, so a native window label may outlive the path it was first
    // derived from.
    let existing_label = app
        .state::<SnippingState>()
        .preview_paths
        .lock()
        .ok()
        .and_then(|paths| {
            paths.iter().find_map(|(open_label, open_path)| {
                (open_path == &path_string
                    && !closing_labels.contains(open_label)
                    && app.get_webview_window(open_label).is_some())
                .then(|| open_label.clone())
            })
        });
    if let Some(existing_label) = existing_label {
        if let Some(existing) = app.get_webview_window(&existing_label) {
            let was_visible = existing.is_visible().unwrap_or(false);
            let _ = existing.set_size(tauri::LogicalSize::new(width, height));
            if explicit_position.is_some() || !was_visible {
                snipping_position_preview_window(app, &existing, explicit_position);
            }
            #[cfg(target_os = "macos")]
            snipping_preview_apply_macos_space_style(&existing);
            snipping_show_window_now(&existing, "open_existing_preview_show");
            #[cfg(target_os = "macos")]
            snipping_preview_order_front_regardless(&existing);
            if focused {
                snipping_focus_window_now(&existing, "open_existing_preview_focus");
            }
            snipping_start_float_hover_watcher(app);
            snipping_emit_floats_changed(app);
            return Ok(json!({
                "kind": "snip_float_opened",
                "label": existing_label,
                "path": path_string,
                "already_open": true,
                "width": width,
                "height": height,
            }));
        }
    }

    // Fast path: adopt a parked pre-booted window. The webview is already
    // running, so the preview appears the moment the capture file lands.
    if let Some(window) = snipping_take_pooled_preview_window(app) {
        let pooled_label = window.label().to_string();
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
        snipping_position_preview_window(app, &window, explicit_position);
        if let Ok(mut paths) = app.state::<SnippingState>().preview_paths.lock() {
            paths.insert(pooled_label.clone(), path_string.clone());
        }
        let _ = app.emit_to(
            pooled_label.as_str(),
            SNIPPING_FLOAT_ASSIGN_EVENT,
            json!({
                "kind": "snip_float_assign",
                "label": pooled_label,
                "path": path_string,
            }),
        );
        #[cfg(target_os = "macos")]
        snipping_preview_apply_macos_space_style(&window);
        snipping_show_window_now(&window, "open_pooled_preview_show");
        #[cfg(target_os = "macos")]
        snipping_preview_order_front_regardless(&window);
        if focused {
            snipping_focus_window_now(&window, "open_pooled_preview_focus");
        }
        snipping_start_float_hover_watcher(app);
        snipping_warm_preview_pool(app);
        snipping_emit_floats_changed(app);
        return Ok(json!({
            "kind": "snip_float_opened",
            "label": pooled_label,
            "path": path_string,
            "width": width,
            "height": height,
            "pooled": true,
        }));
    }

    let encoded_path = snipping_url_token(&path_string);
    let window = snipping_build_preview_window(app, &label, &encoded_path, focused)?;
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    snipping_position_preview_window(app, &window, explicit_position);
    if let Ok(mut paths) = app.state::<SnippingState>().preview_paths.lock() {
        paths.insert(label.clone(), path_string.clone());
    }
    #[cfg(target_os = "macos")]
    snipping_preview_apply_macos_space_style(&window);
    snipping_show_window_now(&window, "open_preview_show");
    #[cfg(target_os = "macos")]
    snipping_preview_order_front_regardless(&window);
    snipping_start_float_hover_watcher(app);
    // Park a warm window so the next capture takes the fast path.
    snipping_warm_preview_pool(app);
    snipping_emit_floats_changed(app);

    Ok(json!({
        "kind": "snip_float_opened",
        "label": label,
        "path": path_string,
        "width": width,
        "height": height,
    }))
}

const SNIPPING_FLOAT_HOVER_EVENT: &str = "snipping-float-hover";
const SNIPPING_FLOAT_HOVER_POLL_MS: u64 = 33;
static SNIPPING_FLOAT_HOVER_WATCHER_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Hover state for the floating snip previews, derived from the global cursor
/// position in Rust. Webview `:hover` only fires while macOS delivers
/// mouse-moved events to the window, which depends on key/active status — the
/// watcher makes the hover chrome appear whenever the cursor is over a
/// preview, no matter which window or app has focus. While hovered it also
/// streams client coordinates so the webview can synthesize per-button hover
/// visuals when native mouse-move events are suppressed. One loop serves every
/// preview and exits when the last one closes.
fn snipping_start_float_hover_watcher(app: &AppHandle) {
    if SNIPPING_FLOAT_HOVER_WATCHER_ACTIVE.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut hovered_by_label: HashMap<String, (bool, i32, i32)> = HashMap::new();
        loop {
            sleep(Duration::from_millis(SNIPPING_FLOAT_HOVER_POLL_MS)).await;
            let windows = app
                .webview_windows()
                .into_iter()
                .filter(|(label, window)| {
                    label.starts_with(SNIPPING_FLOAT_WINDOW_PREFIX)
                        && !snipping_preview_is_closing(&app, label)
                        // Parked pool windows are hidden; they neither hover
                        // nor keep the watcher alive on their own.
                        && window.is_visible().unwrap_or(false)
                })
                .collect::<Vec<_>>();
            if windows.is_empty() {
                SNIPPING_FLOAT_HOVER_WATCHER_ACTIVE.store(false, Ordering::Release);
                return;
            }
            let cursor = app.cursor_position().ok();
            for (label, window) in windows {
                let (hovered, client_x, client_y) = cursor
                    .as_ref()
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
                    .unwrap_or((false, -1.0, -1.0));
                let rounded_x = if hovered { client_x.round() as i32 } else { -1 };
                let rounded_y = if hovered { client_y.round() as i32 } else { -1 };
                let snapshot = (hovered, rounded_x, rounded_y);
                if hovered_by_label.insert(label.clone(), snapshot) != Some(snapshot) {
                    let payload = if hovered {
                        json!({
                            "label": label.as_str(),
                            "hovered": true,
                            "clientX": client_x,
                            "clientY": client_y,
                        })
                    } else {
                        json!({ "label": label.as_str(), "hovered": false })
                    };
                    let _ = window.emit_to(
                        label.as_str(),
                        SNIPPING_FLOAT_HOVER_EVENT,
                        payload,
                    );
                }
            }
            hovered_by_label.retain(|label, _| app.get_webview_window(label).is_some());
        }
    });
}

// === Recent-snips strip: a CleanShot-style bar of the latest captures. ===
// Toggled from the always-present tray icon while the main window is up, and
// launched from the background monitor's Snippets button (which dismisses the
// popover first — the strip is never embedded inside the dropdown). The bar
// spans the full width of the monitor the cursor is on and joins fullscreen
// Spaces, so a tray click surfaces it from any Space. Tiles reuse the
// floating-preview look and actions, with a pin button where the preview's
// close button sits (pin = open as a draggable preview in the bottom-left
// queue). Snips already on screen as floating previews are excluded from the
// list, and a tile can be physically dragged out of the bar to become a
// preview at the drop point.

const SNIPPING_STRIP_WINDOW_LABEL: &str = "snipping-strip";
const SNIPPING_STRIP_ANIM_EVENT: &str = "forge-snip-strip-anim";
const SNIPPING_STRIP_LOGICAL_HEIGHT: f64 = 88.0;
// Pre-show placeholder only: every show resizes the bar to the full logical
// width of the monitor under the cursor.
const SNIPPING_STRIP_DEFAULT_LOGICAL_WIDTH: f64 = 1280.0;
const SNIPPING_STRIP_RECENT_PAGE_LIMIT: usize = 64;
const SNIPPING_STRIP_RECENT_PAGE_LIMIT_MAX: usize = 200;
const SNIPPING_STRIP_POSITION_ANIMATE_MS: f64 = 180.0;
const SNIPPING_STRIP_CLOSE_ANIM_MS: u64 = 200;
// Steps for the native backdrop alpha fade on close. The whole frosted bar is
// faded out over SNIPPING_STRIP_CLOSE_ANIM_MS in lockstep with the webview's
// CSS content fade, so the glass eases away instead of snapping out from under
// the fading tiles. Each step re-checks the visibility generation, so a
// re-open mid-close cancels the fade cleanly.
const SNIPPING_STRIP_CLOSE_FADE_STEPS: u64 = 14;
const SNIPPING_STRIP_REASSERT_SHOW_MS: u64 = 120;
const SNIPPING_STRIP_COLD_BOOT_REASSERT_MS: u64 = 300;
const SNIPPING_STRIP_INTERACTION_GUARD_ACTIVE_MS: u64 = 30_000;
const SNIPPING_STRIP_INTERACTION_GUARD_RELEASE_MS: u64 = 220;
const SNIPPING_STRIP_FOCUS_LOSS_CLOSE_DELAY_MS: u64 = 90;
const SNIPPING_STRIP_OUTSIDE_CLICK_POLL_MS: u64 = 18;

/// Newest-first listing of saved snip files and their edited copies. The
/// on-disk `snips` and `edits` directories are the durable history (the
/// in-memory toast list only ever holds six). The strip can exclude visible
/// previews so opening the dock never duplicates what is already on screen.
fn snipping_recent_snip_items(
    app: &AppHandle,
    limit: usize,
    cursor_modified_ms: Option<u64>,
    cursor_path: Option<&str>,
    exclude_visible_free_previews: bool,
) -> Result<(Vec<Value>, usize, bool, Option<u64>, Option<String>), String> {
    let root = diffforge_prepare_untracked_asset_root()?;
    let mut snips: Vec<(u128, String, Value)> = Vec::new();
    let mut total_count = 0usize;
    let cursor_modified_ms = cursor_modified_ms.map(u128::from);
    let cursor_path = cursor_path.unwrap_or("");
    for (directory_name, source_kind) in [("snips", "snip"), ("edits", "edit")] {
        let Ok(entries) = fs::read_dir(root.join(directory_name)) else {
            continue;
        };
        snips.extend(entries.flatten().filter_map(|entry| {
            let path = entry.path();
            if !path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| extension.eq_ignore_ascii_case("png"))
                .unwrap_or(false)
            {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let modified_ms = metadata
                .modified()
                .ok()
                .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                .map(|elapsed| elapsed.as_millis())
                .unwrap_or_default();
            let name = path.file_name()?.to_string_lossy().to_string();
            let path_string = path
                .canonicalize()
                .unwrap_or_else(|_| path.clone())
                .display()
                .to_string();
            if exclude_visible_free_previews
                && snipping_path_has_visible_free_preview(app, &path_string)
            {
                return None;
            }
            total_count += 1;
            if let Some(cursor_modified_ms) = cursor_modified_ms {
                let after_cursor = modified_ms < cursor_modified_ms
                    || (modified_ms == cursor_modified_ms && path_string.as_str() > cursor_path);
                if !after_cursor {
                    return None;
                }
            }
            Some((
                modified_ms,
                path_string.clone(),
                json!({
                    "path": path_string,
                    "name": name,
                    "modifiedMs": modified_ms as u64,
                    "sourceKind": source_kind,
                    "source_kind": source_kind,
                }),
            ))
        }));
    }
    snips.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    let has_more = snips.len() > limit;
    let mut next_cursor_modified_ms = None;
    let mut next_cursor_path = None;
    let items = snips
        .into_iter()
        .take(limit)
        .map(|(modified_ms, path, item)| {
            next_cursor_modified_ms = Some(modified_ms as u64);
            next_cursor_path = Some(path);
            item
        })
        .collect();
    Ok((
        items,
        total_count,
        has_more,
        next_cursor_modified_ms,
        next_cursor_path,
    ))
}

#[tauri::command]
fn snipping_recent_snips(
    app: AppHandle,
    limit: Option<usize>,
    cursor_modified_ms: Option<u64>,
    cursor_path: Option<String>,
    exclude_visible_free_previews: Option<bool>,
) -> Result<Value, String> {
    let limit = limit
        .unwrap_or(SNIPPING_STRIP_RECENT_PAGE_LIMIT)
        .clamp(1, SNIPPING_STRIP_RECENT_PAGE_LIMIT_MAX);
    let (items, total_count, has_more, next_cursor_modified_ms, next_cursor_path) =
        snipping_recent_snip_items(
            &app,
            limit,
            cursor_modified_ms,
            cursor_path.as_deref(),
            exclude_visible_free_previews.unwrap_or(false),
        )?;
    Ok(json!({
        "kind": "snipping_recent_snips",
        "items": items,
        "totalCount": total_count,
        "total_count": total_count,
        "hasMore": has_more,
        "has_more": has_more,
        "nextCursor": {
            "modifiedMs": next_cursor_modified_ms,
            "modified_ms": next_cursor_modified_ms,
            "path": next_cursor_path,
        },
        "next_cursor": {
            "modifiedMs": next_cursor_modified_ms,
            "modified_ms": next_cursor_modified_ms,
            "path": next_cursor_path,
        },
    }))
}

fn snipping_cursor_inside_window(app: &AppHandle, window: &tauri::WebviewWindow) -> bool {
    let Ok(cursor) = app.cursor_position() else {
        return false;
    };
    let Ok(position) = window.outer_position() else {
        return false;
    };
    let Ok(size) = window.outer_size() else {
        return false;
    };
    cursor.x >= f64::from(position.x)
        && cursor.x <= f64::from(position.x) + f64::from(size.width)
        && cursor.y >= f64::from(position.y)
        && cursor.y <= f64::from(position.y) + f64::from(size.height)
}

fn snipping_strip_auto_close_guard_active(app: &AppHandle) -> bool {
    let state = app.state::<SnippingState>();
    if state
        .strip_interaction_guard_until_ms
        .load(Ordering::SeqCst)
        > snipping_now_epoch_ms()
    {
        return true;
    }
    if state
        .preview_drag_sessions
        .lock()
        .map(|sessions| !sessions.is_empty())
        .unwrap_or(false)
    {
        return true;
    }
    if state
        .preview_strip_hover_labels
        .lock()
        .map(|labels| !labels.is_empty())
        .unwrap_or(false)
    {
        return true;
    }
    snipping_any_preview_drag_handoff_active(app)
}

fn snipping_strip_mark_interaction_guard(app: &AppHandle, active: bool) {
    let guard_until_ms = if active {
        snipping_now_epoch_ms() + SNIPPING_STRIP_INTERACTION_GUARD_ACTIVE_MS
    } else {
        snipping_now_epoch_ms() + SNIPPING_STRIP_INTERACTION_GUARD_RELEASE_MS
    };
    app.state::<SnippingState>()
        .strip_interaction_guard_until_ms
        .store(guard_until_ms, Ordering::SeqCst);
}

fn snipping_strip_next_visibility_generation(app: &AppHandle) -> u64 {
    app.state::<SnippingState>()
        .strip_visibility_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1
}

fn snipping_strip_close_if_visible(app: &AppHandle, only_if_unfocused: bool) {
    let Some(window) = app.get_webview_window(SNIPPING_STRIP_WINDOW_LABEL) else {
        return;
    };
    snipping_strip_hide_animated(app, window, only_if_unfocused);
}

#[cfg(target_os = "macos")]
fn snipping_strip_force_hide_now(window: &tauri::WebviewWindow) {
    snipping_hide_window_now(window, "strip_force_hide_tauri");
    snipping_catch_objc("strip_force_hide_order_out", || {
        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        if ns_window.is_null() {
            return;
        }
        let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
        ns_window.setAlphaValue(0.0);
        ns_window.orderOut(None);
    });
}

#[cfg(not(target_os = "macos"))]
fn snipping_strip_force_hide_now(window: &tauri::WebviewWindow) {
    snipping_hide_window_now(window, "strip_force_hide");
}

#[cfg(target_os = "macos")]
fn snipping_strip_restore_show_alpha(window: &tauri::WebviewWindow) {
    let window_for_main = window.clone();
    let window_for_alpha = window_for_main.clone();
    let _ = window_for_main.run_on_main_thread(move || {
        snipping_catch_objc("strip_restore_alpha", || {
            let Ok(ns_window) = window_for_alpha.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            ns_window.setAlphaValue(1.0);
        });
    });
}

#[cfg(not(target_os = "macos"))]
fn snipping_strip_restore_show_alpha(_window: &tauri::WebviewWindow) {}

fn snipping_strip_schedule_focus_loss_close(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(
            SNIPPING_STRIP_FOCUS_LOSS_CLOSE_DELAY_MS,
        ))
        .await;
        if snipping_strip_auto_close_guard_active(&app) {
            return;
        }
        let Some(window) = app.get_webview_window(SNIPPING_STRIP_WINDOW_LABEL) else {
            return;
        };
        if !window.is_visible().unwrap_or(false) || window.is_focused().unwrap_or(false) {
            return;
        }
        snipping_strip_hide_animated(&app, window, false);
    });
}

fn snipping_strip_start_outside_click_watcher(app: &AppHandle) {
    if !snipping_mouse_button_state_supported() {
        return;
    }
    let state = app.state::<SnippingState>();
    if state
        .strip_outside_click_watcher_active
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    let app = app.clone();
    let watcher_active = state.strip_outside_click_watcher_active.clone();
    tauri::async_runtime::spawn(async move {
        let mut was_down = snipping_left_mouse_button_pressed();
        let mut outside_click_candidate = false;
        loop {
            sleep(Duration::from_millis(SNIPPING_STRIP_OUTSIDE_CLICK_POLL_MS)).await;
            let Some(window) = app.get_webview_window(SNIPPING_STRIP_WINDOW_LABEL) else {
                break;
            };
            if !window.is_visible().unwrap_or(false) {
                break;
            }

            let is_down = snipping_left_mouse_button_pressed();
            if is_down && !was_down {
                outside_click_candidate = !snipping_cursor_inside_window(&app, &window)
                    && !snipping_strip_auto_close_guard_active(&app);
            } else if !is_down && was_down {
                if outside_click_candidate
                    && !snipping_cursor_inside_window(&app, &window)
                    && !snipping_strip_auto_close_guard_active(&app)
                {
                    snipping_strip_hide_animated(&app, window, false);
                    break;
                }
                outside_click_candidate = false;
            }
            if is_down && outside_click_candidate && snipping_strip_auto_close_guard_active(&app) {
                outside_click_candidate = false;
            }
            was_down = is_down;
        }
        watcher_active.store(false, Ordering::SeqCst);
    });
}

#[tauri::command]
fn snipping_set_strip_interaction_guard(app: AppHandle, active: bool) -> Result<(), String> {
    snipping_strip_mark_interaction_guard(&app, active);
    Ok(())
}

#[tauri::command]
fn snipping_close_snip_strip(app: AppHandle) -> Result<(), String> {
    snipping_strip_close_if_visible(&app, false);
    Ok(())
}

fn snipping_strip_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window(SNIPPING_STRIP_WINDOW_LABEL) {
        return Some(window);
    }
    let window = WebviewWindowBuilder::new(
        app,
        SNIPPING_STRIP_WINDOW_LABEL,
        WebviewUrl::App("index.html#/snipping-strip".into()),
    )
    .title("Recent Snips")
    .inner_size(
        SNIPPING_STRIP_DEFAULT_LOGICAL_WIDTH,
        SNIPPING_STRIP_LOGICAL_HEIGHT,
    )
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .accept_first_mouse(true)
    .visible_on_all_workspaces(true)
    .focused(false)
    .visible(false)
    .build()
    .ok()?;
    {
        let app_for_focus = app.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::Focused(false) = event {
                snipping_strip_schedule_focus_loss_close(&app_for_focus);
            }
        });
    }
    // A transparent window still paints the webview's default backdrop until
    // the background color is cleared (the same faint full-size square the
    // monitor popover had).
    let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
    // Native glass behind the translucent webview chrome: CSS backdrop-filter
    // can only blur the webview's own content, never the desktop behind a
    // transparent window, so the frosted look needs the OS compositor.
    // HudWindow is dark glass on both system themes.
    {
        let vibrancy_window = window.clone();
        let _ = window.run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            snipping_catch_objc("strip_apply_vibrancy", || {
                let _ = window_vibrancy::apply_vibrancy(
                    &vibrancy_window,
                    window_vibrancy::NSVisualEffectMaterial::HudWindow,
                    Some(window_vibrancy::NSVisualEffectState::Active),
                    Some(14.0),
                );
            });
            #[cfg(target_os = "windows")]
            let _ = window_vibrancy::apply_acrylic(&vibrancy_window, Some((10, 14, 22, 150)))
                .or_else(|_| {
                    window_vibrancy::apply_blur(&vibrancy_window, Some((10, 14, 22, 150)))
                });
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let _ = &vibrancy_window;
        });
    }
    #[cfg(target_os = "macos")]
    {
        snipping_convert_overlay_window_to_panel(&window);
        snipping_strip_apply_macos_overlay_style(&window);
    }
    Some(window)
}

/// Menu-bar-level overlay style, the same recipe the background monitor uses
/// to appear over OTHER apps' fullscreen Spaces: CanJoinAllSpaces alone does
/// not join fullscreen Spaces — the bar also needs CanJoinAllApplications +
/// FullScreenAuxiliary — and tao's always-on-top floating level is not
/// reliably above a fullscreen Space's window, and status-bar level can still
/// lose to another app's fullscreen Space, so the bar uses the same
/// screen-saver level as the area overlay. Re-asserted on every show since
/// both values are plain NSWindow state that other window calls may rewrite.
#[cfg(target_os = "macos")]
fn snipping_strip_apply_macos_overlay_style(window: &tauri::WebviewWindow) {
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("strip_apply_macos_overlay_style", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            ns_window.setCollectionBehavior(
                objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllSpaces
                    | objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllApplications
                    | objc2_app_kit::NSWindowCollectionBehavior::FullScreenAuxiliary
                    | objc2_app_kit::NSWindowCollectionBehavior::Stationary
                    | objc2_app_kit::NSWindowCollectionBehavior::IgnoresCycle,
            );
            ns_window.setLevel(objc2_app_kit::NSScreenSaverWindowLevel);
            ns_window.setAcceptsMouseMovedEvents(true);
        });
    });
}

/// Surfaces the bar even while Diff Forge is NOT the active app (tray clicks
/// from another app's fullscreen Space): makeKeyAndOrderFront does nothing
/// visible there, orderFrontRegardless is the documented way.
#[cfg(target_os = "macos")]
fn snipping_strip_order_front_regardless(window: &tauri::WebviewWindow) {
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("strip_order_front_regardless", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            ns_window.orderFrontRegardless();
        });
    });
}

#[derive(Clone, Copy)]
struct SnippingStripPlacement {
    origin: &'static str,
    width_logical: f64,
    position: tauri::PhysicalPosition<i32>,
}

fn snipping_strip_default_origin() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "top"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "bottom"
    }
}

fn snipping_strip_target_placement(app: &AppHandle) -> Option<SnippingStripPlacement> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let monitor = monitor?;
    let (area_position, area_size, _) = floating_surface_anchor_area_for_monitor(&monitor);
    let scale = monitor.scale_factor().max(0.1);
    let width_logical = (area_size.width as f64 / scale).max(360.0);
    let x = area_position.x;
    let origin = snipping_strip_default_origin();
    #[cfg(target_os = "macos")]
    let y = area_position.y;
    #[cfg(not(target_os = "macos"))]
    let y = {
        let height = (SNIPPING_STRIP_LOGICAL_HEIGHT * scale).round() as i32;
        area_position.y + area_size.height as i32 - height
    };
    Some(SnippingStripPlacement {
        origin,
        width_logical,
        position: tauri::PhysicalPosition::new(x, y),
    })
}

fn snipping_set_strip_position_now(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    position: tauri::PhysicalPosition<i32>,
) {
    app.state::<SnippingState>()
        .strip_position_animation_generation
        .fetch_add(1, Ordering::SeqCst);
    let _ = window.set_position(tauri::Position::Physical(position));
}

fn snipping_animate_strip_position(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    target: tauri::PhysicalPosition<i32>,
) {
    let Ok(start) = window.outer_position() else {
        snipping_set_strip_position_now(app, window, target);
        return;
    };
    if start.x == target.x && start.y == target.y {
        return;
    }

    let generation = app
        .state::<SnippingState>()
        .strip_position_animation_generation
        .clone();
    let ticket = generation.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    let window = window.clone();
    thread::spawn(move || {
        let started = Instant::now();
        loop {
            if generation.load(Ordering::SeqCst) != ticket {
                return;
            }
            let progress = (started.elapsed().as_millis() as f64 / SNIPPING_STRIP_POSITION_ANIMATE_MS)
                .min(1.0);
            let eased = snipping_tween_eased(progress, SnippingTweenEasing::Track);
            let x = start.x + (f64::from(target.x - start.x) * eased).round() as i32;
            let y = start.y + (f64::from(target.y - start.y) * eased).round() as i32;
            let frame_generation = generation.clone();
            let window_for_frame = window.clone();
            let _ = app.run_on_main_thread(move || {
                if frame_generation.load(Ordering::SeqCst) != ticket {
                    return;
                }
                let _ = window_for_frame
                    .set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x, y)));
            });
            if progress >= 1.0 {
                return;
            }
            thread::sleep(Duration::from_millis(SNIPPING_FLOAT_ANIMATE_FRAME_MS));
        }
    });
}

/// Full-width bar on the monitor the cursor is on, flush against the shared
/// floating-surface anchor edge. In ordinary desktop Spaces that is the work
/// area; in fullscreen/bare-edge Spaces it is the whole monitor.
fn snipping_strip_position(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    animate: bool,
) -> &'static str {
    let Some(placement) = snipping_strip_target_placement(app) else {
        return snipping_strip_default_origin();
    };
    let _ = window.set_size(tauri::LogicalSize::new(
        placement.width_logical,
        SNIPPING_STRIP_LOGICAL_HEIGHT,
    ));
    if animate {
        snipping_animate_strip_position(app, window, placement.position);
    } else {
        snipping_set_strip_position_now(app, window, placement.position);
    }
    placement.origin
}

fn snipping_strip_reposition_if_visible(app: &AppHandle, animate: bool) {
    let Some(window) = app.get_webview_window(SNIPPING_STRIP_WINDOW_LABEL) else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    let _ = snipping_strip_position(app, &window, animate);
}

fn snipping_strip_emit_anim(app: &AppHandle, phase: &str, origin: Option<&str>) {
    let mut payload = json!({ "phase": phase });
    if let Some(origin) = origin {
        payload["origin"] = json!(origin);
    }
    let _ = app.emit_to(
        SNIPPING_STRIP_WINDOW_LABEL,
        SNIPPING_STRIP_ANIM_EVENT,
        payload,
    );
}

fn snipping_strip_reassert_open_state(
    app: &AppHandle,
    origin: &'static str,
    emit_anim: bool,
    generation: u64,
) -> bool {
    if app
        .state::<SnippingState>()
        .strip_visibility_generation
        .load(Ordering::SeqCst)
        != generation
    {
        return false;
    }
    let Some(window) = app.get_webview_window(SNIPPING_STRIP_WINDOW_LABEL) else {
        return false;
    };
    if !window.is_visible().unwrap_or(false) {
        return false;
    }
    snipping_strip_restore_show_alpha(&window);
    #[cfg(target_os = "macos")]
    {
        snipping_convert_overlay_window_to_panel(&window);
        snipping_strip_apply_macos_overlay_style(&window);
        snipping_strip_order_front_regardless(&window);
        snipping_make_overlay_key(&window);
    }
    if emit_anim {
        snipping_strip_emit_anim(app, "open", Some(origin));
    }
    true
}

fn snipping_strip_emit_open_reassert(app: &AppHandle, origin: &'static str, generation: u64) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(SNIPPING_STRIP_REASSERT_SHOW_MS)).await;
        if !snipping_strip_reassert_open_state(&app, origin, true, generation) {
            return;
        }
        sleep(Duration::from_millis(
            SNIPPING_STRIP_COLD_BOOT_REASSERT_MS.saturating_sub(SNIPPING_STRIP_REASSERT_SHOW_MS),
        ))
        .await;
        let _ = snipping_strip_reassert_open_state(&app, origin, false, generation);
    });
}

fn snipping_strip_hide_animated(
    app: &AppHandle,
    window: tauri::WebviewWindow,
    only_if_unfocused: bool,
) {
    if only_if_unfocused && window.is_focused().unwrap_or(false) {
        return;
    }
    let generation = snipping_strip_next_visibility_generation(app);
    let generation_state = app
        .state::<SnippingState>()
        .strip_visibility_generation
        .clone();
    snipping_strip_emit_anim(app, "close", None);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Dissolve the native frosted backdrop alongside the webview's CSS
        // content fade so the whole bar eases out together.
        snipping_strip_animate_alpha_out(&app, &window, &generation_state, generation).await;
        if generation_state.load(Ordering::SeqCst) != generation {
            return;
        }
        let generation_state_for_main = generation_state.clone();
        let _ = app.run_on_main_thread(move || {
            if generation_state_for_main.load(Ordering::SeqCst) != generation {
                return;
            }
            snipping_strip_force_hide_now(&window);
        });
    });
}

/// Steps the native strip window's alpha from fully visible to transparent
/// over SNIPPING_STRIP_CLOSE_ANIM_MS. Every step re-checks the visibility
/// generation so a re-open mid-close aborts the fade (the next show snaps the
/// alpha back to 1.0), and since each step is a plain `setAlphaValue` there is
/// no lingering implicit animation to fight that restore.
#[cfg(target_os = "macos")]
async fn snipping_strip_animate_alpha_out(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    generation_state: &Arc<AtomicU64>,
    generation: u64,
) {
    let steps = SNIPPING_STRIP_CLOSE_FADE_STEPS.max(1);
    let step_ms = (SNIPPING_STRIP_CLOSE_ANIM_MS / steps).max(1);
    for step in 1..=steps {
        sleep(Duration::from_millis(step_ms)).await;
        if generation_state.load(Ordering::SeqCst) != generation {
            return;
        }
        let alpha = (1.0 - (step as f64 / steps as f64)).max(0.0);
        let window = window.clone();
        let generation_state = generation_state.clone();
        let _ = app.run_on_main_thread(move || {
            if generation_state.load(Ordering::SeqCst) != generation {
                return;
            }
            snipping_strip_set_window_alpha(&window, alpha);
        });
    }
}

/// Non-macOS strip windows have no native vibrancy backdrop, so the CSS fade is
/// the whole close animation — just wait it out before ordering the window out.
#[cfg(not(target_os = "macos"))]
async fn snipping_strip_animate_alpha_out(
    _app: &AppHandle,
    _window: &tauri::WebviewWindow,
    _generation_state: &Arc<AtomicU64>,
    _generation: u64,
) {
    sleep(Duration::from_millis(SNIPPING_STRIP_CLOSE_ANIM_MS)).await;
}

#[cfg(target_os = "macos")]
fn snipping_strip_set_window_alpha(window: &tauri::WebviewWindow, alpha: f64) {
    snipping_catch_objc("strip_fade_alpha", || {
        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        if ns_window.is_null() {
            return;
        }
        let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
        ns_window.setAlphaValue(alpha);
    });
}

/// Unconditional show (the monitor popover's Snippets button): re-anchors to
/// the cursor's monitor, re-asserts the overlay style, and surfaces the bar
/// even while another app's fullscreen Space is frontmost.
pub(crate) fn snipping_strip_show(app: &AppHandle) {
    snipping_warm_preview_pool(app);
    let Some(window) = snipping_strip_window(app) else {
        return;
    };
    let generation = snipping_strip_next_visibility_generation(app);
    let origin = snipping_strip_position(app, &window, false);
    #[cfg(target_os = "macos")]
    snipping_convert_overlay_window_to_panel(&window);
    #[cfg(target_os = "macos")]
    snipping_strip_apply_macos_overlay_style(&window);
    snipping_strip_restore_show_alpha(&window);
    snipping_show_window_now(&window, "strip_show");
    #[cfg(target_os = "macos")]
    snipping_strip_order_front_regardless(&window);
    #[cfg(target_os = "macos")]
    snipping_make_overlay_key(&window);
    #[cfg(not(target_os = "macos"))]
    snipping_focus_window_now(&window, "strip_focus");
    snipping_strip_emit_anim(app, "open", Some(origin));
    snipping_strip_start_outside_click_watcher(app);
    snipping_strip_emit_open_reassert(app, origin, generation);
}

/// Tray-click toggle for the recent-snips bar. The strip is persistent now:
/// explicit close controls and click-away can hide it, while drag guards keep
/// in/out strip drags from being treated as dismissal clicks.
pub(crate) fn snipping_strip_toggle(app: &AppHandle) {
    let Some(window) = snipping_strip_window(app) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        snipping_strip_hide_animated(app, window, false);
        return;
    }
    snipping_strip_show(app);
}

#[tauri::command]
fn snipping_toggle_snip_strip(app: AppHandle) -> Result<(), String> {
    snipping_strip_toggle(&app);
    Ok(())
}

#[tauri::command]
fn snipping_open_snip_float(
    app: AppHandle,
    path: String,
    x: Option<f64>,
    y: Option<f64>,
    focused: Option<bool>,
) -> Result<Value, String> {
    let explicit_position = match (x, y) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    };
    // `focused: false` keeps quick-access opens from stealing focus away from
    // the strip/background workflow.
    snipping_open_snip_preview_window_for(&app, &path, explicit_position, focused.unwrap_or(true))
}

#[tauri::command]
fn snipping_open_snip_float_for_drag(
    app: AppHandle,
    path: String,
    x: f64,
    y: f64,
) -> Result<Value, String> {
    let drag_size = (
        SNIPPING_STRIP_TILE_LOGICAL_WIDTH,
        SNIPPING_STRIP_TILE_LOGICAL_HEIGHT,
    );
    let initial_position =
        snipping_cursor_logical_origin_for_preview(&app, drag_size.0, drag_size.1)
            .or(Some((x, y)));
    let opened = snipping_open_snip_preview_window_for_with_size(
        &app,
        &path,
        initial_position,
        false,
        Some(drag_size),
    )?;
    let label = opened
        .get("label")
        .and_then(Value::as_str)
        .ok_or_else(|| "Snip preview opened without a window label.".to_string())?
        .to_string();
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| "Snip preview window is not open.".to_string())?;
    snipping_set_preview_logical_size_now(&app, &window, drag_size.0, drag_size.1);
    let _ = snipping_position_preview_under_cursor(&app, &window, drag_size.0, drag_size.1);
    let position = window
        .outer_position()
        .map_err(|error| format!("Unable to read snip preview position: {error}"))?;
    snipping_begin_preview_drag_session(&app, &label, position);
    snipping_begin_preview_drag_handoff(&app, &label);
    let _ = snipping_position_preview_under_cursor(&app, &window, drag_size.0, drag_size.1);
    let drag_started = window.start_dragging().is_ok();
    let mut opened = opened;
    opened["dragStarted"] = json!(drag_started);
    Ok(opened)
}

fn snipping_preview_alias_target(app: &AppHandle, path: &str) -> Option<String> {
    let requested = path.trim();
    if requested.is_empty() {
        return None;
    }
    let state = app.state::<SnippingState>();
    let aliases = state.preview_path_aliases.lock().ok()?;
    if let Some(target) = aliases.get(requested) {
        return Some(target.clone());
    }
    let canonical = diffforge_local_asset_file(requested)
        .ok()
        .map(|file| file.display().to_string())?;
    aliases.get(&canonical).cloned()
}

fn snipping_preview_current_path_string(app: &AppHandle, path: &str) -> Result<String, String> {
    if let Some(target) = snipping_preview_alias_target(app, path) {
        return Ok(diffforge_local_asset_file(&target)?.display().to_string());
    }
    Ok(diffforge_local_asset_file(path)?.display().to_string())
}

fn snipping_handle_promoted_untracked_asset(
    app: &AppHandle,
    source_path: &str,
    target_path: &str,
    asset_id: &str,
    asset: &Value,
    source_removed: bool,
) {
    let source_path = source_path.trim().to_string();
    let target_path = target_path.trim().to_string();
    if source_path.is_empty() || target_path.is_empty() {
        return;
    }

    let state = app.state::<SnippingState>();
    if let Ok(mut aliases) = state.preview_path_aliases.lock() {
        aliases.insert(source_path.clone(), target_path.clone());
    }

    let closing_labels = snipping_preview_closing_labels(app);
    if let Ok(mut paths) = state.preview_paths.lock() {
        let mut retargeted = false;
        for (label, open_path) in paths.iter_mut() {
            if open_path == &source_path && !closing_labels.contains(label) {
                *open_path = target_path.clone();
                retargeted = true;
            }
        }
        let preview_label = format!(
            "{SNIPPING_FLOAT_WINDOW_PREFIX}-{}",
            snipping_window_token(Path::new(&source_path))
        );
        if !retargeted
            && !closing_labels.contains(&preview_label)
            && app.get_webview_window(&preview_label).is_some()
        {
            paths.insert(preview_label, target_path.clone());
        }
    }

    if let Ok(mut editors) = state.editor_paths.lock() {
        for open_paths in editors.values_mut() {
            if open_paths.iter().any(|open_path| open_path == &source_path)
                && !open_paths.iter().any(|open_path| open_path == &target_path)
            {
                open_paths.push(target_path.clone());
            }
        }
    }

    let _ = app.emit(
        SNIPPING_SOURCE_UPDATED_EVENT,
        json!({
            "kind": "snip_asset_promoted",
            "asset_id": asset_id,
            "assetId": asset_id,
            "asset": asset,
            "original_path": source_path,
            "originalPath": source_path,
            "source_path": source_path,
            "sourcePath": source_path,
            "edited_path": target_path,
            "editedPath": target_path,
            "local_path": target_path,
            "localPath": target_path,
            "path": target_path,
            "source_removed": source_removed,
            "sourceRemoved": source_removed,
            "in_place": false,
            "inPlace": false,
        }),
    );
    snipping_emit_floats_changed(app);
}

/// Every preview window label currently showing this snip. The path registry is
/// authoritative because pooled windows are retargeted and direct labels include
/// a random token that cannot be reconstructed later.
fn snipping_float_labels_for_path(app: &AppHandle, path: &str) -> Result<Vec<String>, String> {
    let path_string = snipping_preview_current_path_string(app, path)?;
    let mut labels = Vec::new();
    if let Ok(paths) = app.state::<SnippingState>().preview_paths.lock() {
        for (label, open_path) in paths.iter() {
            if open_path == &path_string && !labels.contains(label) {
                labels.push(label.clone());
            }
        }
    }
    Ok(labels)
}

/// Whether a floating preview is currently open for this snip — drives the
/// annotation editor's pin/close toggle.
#[tauri::command]
fn snipping_snip_float_open(app: AppHandle, path: String) -> Result<Value, String> {
    let open = snipping_float_labels_for_path(&app, &path)?
        .iter()
        .any(|label| {
            !snipping_preview_is_closing(&app, label)
                && app
                    .get_webview_window(label)
                    .is_some_and(|window| window.is_visible().unwrap_or(false))
        });
    Ok(json!({ "kind": "snip_float_open", "open": open }))
}

/// Closes a specific floating preview through the shared dispose lifecycle.
#[tauri::command]
fn snipping_close_snip_float(app: AppHandle, label: String) -> Result<Value, String> {
    let label = label.trim().to_string();
    if !label.starts_with(SNIPPING_FLOAT_WINDOW_PREFIX) {
        return Err("Not a snip preview window.".to_string());
    }
    let closed = snipping_close_preview_window(&app, &label, "preview-command");
    Ok(json!({ "ok": true, "closed": closed, "label": label }))
}

#[tauri::command]
fn snipping_close_snip_float_for_path(app: AppHandle, path: String) -> Result<Value, String> {
    let mut closed = false;
    for label in snipping_float_labels_for_path(&app, &path)? {
        if app
            .get_webview_window(&label)
            .is_some_and(|window| window.is_visible().unwrap_or(false))
        {
            snipping_close_preview_window(&app, &label, "path-command");
            closed = true;
        }
    }
    Ok(json!({ "ok": true, "closed": closed }))
}

#[tauri::command]
fn snipping_close_annotation_editor(app: AppHandle, label: String) -> Result<Value, String> {
    let label = label.trim().to_string();
    if !label.starts_with(SNIPPING_EDITOR_WINDOW_PREFIX) {
        return Err("Not a snip annotation editor window.".to_string());
    }
    let closed = snipping_close_editor_window(&app, &label, "editor-command");
    Ok(json!({ "ok": true, "closed": closed, "label": label }))
}

/// A deleted snip must not linger on screen: dismisses its capture toast and
/// closes every window presenting it — the draggable preview floats and any
/// annotation editor whose path list includes it. Runs after the file is
/// gone, so matching uses the canonical path strings the registries captured
/// at open time; the canonicalizing path helpers would fail on the missing
/// file. Rust owns this cleanup end to end: the preview's own delete-button
/// follow-up never runs once its window is closed under it.
fn snipping_handle_untracked_asset_deleted(app: &AppHandle, deleted_path: &str) {
    let _ = snipping_dismiss_capture_toast_for(
        app,
        SnippingCaptureToastDismissRequest {
            id: None,
            path: Some(deleted_path.to_string()),
            local_path: None,
        },
    );
    let state = app.state::<SnippingState>();
    let mut labels: Vec<String> = Vec::new();
    if let Ok(paths) = state.preview_paths.lock() {
        for (label, open_path) in paths.iter() {
            if open_path == deleted_path {
                labels.push(label.clone());
            }
        }
    }
    {
        let mut editors = state
            .editor_paths
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        editors.retain(|label, open_paths| {
            let stale = open_paths.iter().any(|open_path| open_path == deleted_path);
            if stale {
                labels.push(label.clone());
            }
            !stale
        });
    }
    // Close outside the registry locks: preview disposal also touches these
    // registries, while editor windows close normally.
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            if label.starts_with(SNIPPING_FLOAT_WINDOW_PREFIX) {
                snipping_close_preview_window(app, &label, "asset-deleted");
            } else if label.starts_with(SNIPPING_EDITOR_WINDOW_PREFIX) {
                snipping_close_editor_window(app, &label, "asset-deleted");
            } else {
                snipping_close_window_guarded(&window, "asset-deleted-window");
            }
        }
    }
}

/// Called by a preview window's webview right before it starts the native
/// window drag. Marks the drag session so the settle pass can tell a real
/// user drag (drop candidate) from programmatic restacking.
#[tauri::command]
fn snipping_preview_drag_started(app: AppHandle, label: String) -> Result<Value, String> {
    let label = label.trim().to_string();
    if !label.starts_with(SNIPPING_FLOAT_WINDOW_PREFIX) {
        return Err("Not a snip preview window.".to_string());
    }
    if snipping_preview_is_closing(&app, &label) {
        return Err("Snip preview window is closing.".to_string());
    }
    let Some(window) = app.get_webview_window(&label) else {
        return Err("Snip preview window is not open.".to_string());
    };
    let position = window
        .outer_position()
        .map_err(|error| format!("Unable to read snip preview position: {error}"))?;
    snipping_begin_preview_drag_session(&app, &label, position);
    snipping_update_preview_strip_drag_state(&app, &label, false);
    // A plain click never emits Moved events, so make sure the session still
    // gets settled (and cleared) shortly after.
    schedule_snipping_preview_stack_reflow(&app);
    Ok(json!({ "ok": true }))
}

/// A drop target in the main webview accepted the snip: the preview window
/// closes and its capture toast is dismissed, like a manual dismiss.
#[tauri::command]
fn snipping_consume_snip_preview(
    app: AppHandle,
    label: String,
    path: String,
) -> Result<Value, String> {
    let label = label.trim().to_string();
    if !label.starts_with(SNIPPING_FLOAT_WINDOW_PREFIX) {
        return Err("Not a snip preview window.".to_string());
    }
    if !path.trim().is_empty() {
        let _ = snipping_dismiss_capture_toast_for(
            &app,
            SnippingCaptureToastDismissRequest {
                id: None,
                path: Some(path.trim().to_string()),
                local_path: None,
            },
        );
    }
    snipping_close_preview_window(&app, &label, "drop-consumed");
    Ok(json!({ "ok": true, "label": label }))
}

#[tauri::command]
fn snipping_set_dispatch_targets(app: AppHandle, targets: Value) -> Result<Value, String> {
    let state = app.state::<SnippingState>();
    let next_targets = if targets.is_array() {
        targets
    } else {
        Value::Array(Vec::new())
    };
    let mut guard = state
        .dispatch_targets
        .lock()
        .map_err(|_| "Unable to lock snipping dispatch targets.".to_string())?;
    *guard = next_targets.clone();
    drop(guard);
    let _ = app.emit(
        SNIPPING_DISPATCH_TARGETS_CHANGED_EVENT,
        json!({ "targets": next_targets }),
    );
    Ok(json!({"ok": true}))
}

#[tauri::command]
fn snipping_dispatch_targets(app: AppHandle) -> Result<Value, String> {
    app.state::<SnippingState>()
        .dispatch_targets
        .lock()
        .map(|guard| guard.clone())
        .map_err(|_| "Unable to lock snipping dispatch targets.".to_string())
}

#[tauri::command]
fn snipping_read_asset_data_url(path: String) -> Result<String, String> {
    let file = diffforge_local_asset_file(&path)?;
    let bytes = fs::read(&file)
        .map_err(|error| format!("Unable to read asset {}: {error}", file.display()))?;
    let mime = cloud_mcp_asset_mime_for_path(&file);
    let mime = if mime.trim().is_empty() {
        "image/png".to_string()
    } else {
        mime
    };
    Ok(format!(
        "data:{mime};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
fn snipping_open_annotation_editor(app: AppHandle, path: String) -> Result<Value, String> {
    // Same builder as the batch path: transparent rounded window sized to the
    // snip, plus the one-editor-per-asset focus dedupe.
    snipping_open_annotation_editor_for_paths(&app, vec![path])
}

#[tauri::command]
fn snipping_open_annotation_editor_batch(
    app: AppHandle,
    request: SnippingAnnotationEditorRequest,
) -> Result<Value, String> {
    snipping_open_annotation_editor_for_paths(&app, request.paths)
}

#[tauri::command]
fn snipping_copy_untracked_asset_to_clipboard(path: String) -> Result<Value, String> {
    snipping_copy_untracked_asset_to_clipboard_for(path)
}

#[tauri::command]
fn snipping_copy_text_to_clipboard(text: String) -> Result<Value, String> {
    snipping_copy_text_to_clipboard_for(text)
}

#[tauri::command]
fn snipping_cancel_area_snip(app: AppHandle) -> Result<Value, String> {
    snipping_cancel_area_snip_for(&app)
}

#[cfg(test)]
mod snipping_recording_mp4_tests {
    use super::*;

    fn recording_test_monitor(
        scale_factor: f64,
        capture_width: u32,
        capture_height: u32,
        snapshot_width: u32,
        snapshot_height: u32,
    ) -> SnippingAreaMonitor {
        SnippingAreaMonitor {
            name: Some("test".to_string()),
            primary: true,
            x: 0,
            y: 0,
            width: ((f64::from(capture_width) * scale_factor).round() as u32).max(1),
            height: ((f64::from(capture_height) * scale_factor).round() as u32).max(1),
            scale_factor,
            capture_x: 0,
            capture_y: 0,
            capture_width,
            capture_height,
            snapshot_path: None,
            snapshot_width,
            snapshot_height,
        }
    }

    fn mp4_box(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let size = u32::try_from(8_usize.saturating_add(payload.len())).unwrap();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&size.to_be_bytes());
        bytes.extend_from_slice(kind);
        bytes.extend_from_slice(payload);
        bytes
    }

    fn sample_table_box(sample_count: u32) -> Vec<u8> {
        let mut stsz_payload = Vec::new();
        stsz_payload.extend_from_slice(&[0, 0, 0, 0]);
        stsz_payload.extend_from_slice(&0_u32.to_be_bytes());
        stsz_payload.extend_from_slice(&sample_count.to_be_bytes());
        for _ in 0..sample_count {
            stsz_payload.extend_from_slice(&4_u32.to_be_bytes());
        }

        let stsz = mp4_box(b"stsz", &stsz_payload);
        let stbl = mp4_box(b"stbl", &stsz);
        let minf = mp4_box(b"minf", &stbl);
        let mdia = mp4_box(b"mdia", &minf);
        let trak = mp4_box(b"trak", &mdia);
        mp4_box(b"moov", &trak)
    }

    fn recording_mp4_bytes(sample_count: u32, mdat_payload: &[u8]) -> Vec<u8> {
        let mut ftyp_payload = Vec::new();
        ftyp_payload.extend_from_slice(b"isom");
        ftyp_payload.extend_from_slice(&0_u32.to_be_bytes());
        ftyp_payload.extend_from_slice(b"isom");

        let mut bytes = mp4_box(b"ftyp", &ftyp_payload);
        bytes.extend_from_slice(&mp4_box(b"mdat", mdat_payload));
        bytes.extend_from_slice(&sample_table_box(sample_count));
        bytes
    }

    fn write_test_recording(name: &str, bytes: &[u8]) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let path = std::env::temp_dir().join(format!(
            "diffforge-{name}-{}-{nanos}.mp4",
            std::process::id()
        ));
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn recording_mp4_validation_rejects_header_only_file() {
        let bytes = recording_mp4_bytes(0, &[]);
        let path = write_test_recording("empty-recording", &bytes);

        let result = snipping_validate_recording_mp4(&path);

        let _ = fs::remove_file(path);
        assert!(result.is_err());
    }

    #[test]
    fn recording_mp4_validation_accepts_file_with_media_samples() {
        let bytes = recording_mp4_bytes(1, &[0, 0, 0, 1]);
        let path = write_test_recording("sampled-recording", &bytes);

        let result = snipping_validate_recording_mp4(&path);

        let _ = fs::remove_file(path);
        assert!(result.is_ok());
    }

    #[test]
    fn recording_frame_pts_tracks_real_capture_time() {
        let mut first_frame_epoch_ms = None;
        let mut last_frame_pts_ms = None;

        assert_eq!(
            snipping_recording_frame_pts_ms(
                1_000,
                &mut first_frame_epoch_ms,
                &mut last_frame_pts_ms,
            ),
            0
        );
        assert_eq!(
            snipping_recording_frame_pts_ms(
                1_066,
                &mut first_frame_epoch_ms,
                &mut last_frame_pts_ms,
            ),
            66
        );
        assert_eq!(
            snipping_recording_frame_pts_ms(
                1_066,
                &mut first_frame_epoch_ms,
                &mut last_frame_pts_ms,
            ),
            67
        );
    }

    #[test]
    fn recording_final_sample_extends_to_stop_request() {
        assert_eq!(
            snipping_recording_final_sample_duration_ms(Some(1_000), 800, 3_000),
            1_200
        );
    }

    #[test]
    fn recording_system_time_ms_reads_epoch_milliseconds() {
        let timestamp = UNIX_EPOCH + Duration::from_millis(12_345);

        assert_eq!(snipping_recording_system_time_ms(timestamp), Some(12_345));
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn recording_area_uses_overlay_points_for_source_rect() {
        let monitor = recording_test_monitor(2.0, 800, 600, 1600, 1200);
        let request = SnippingAreaSelectionRequest {
            x: 100.0,
            y: 50.0,
            width: 400.0,
            height: 300.0,
            scale_factor: Some(2.0),
        };

        let area = snipping_recording_area_from_selection(&monitor, &request);

        assert_eq!(
            (
                area.source_x,
                area.source_y,
                area.source_width,
                area.source_height
            ),
            (100, 50, 400, 300)
        );
        assert_eq!(
            (area.frame_x, area.frame_y, area.frame_width, area.frame_height),
            (200, 100, 800, 600)
        );
    }
}

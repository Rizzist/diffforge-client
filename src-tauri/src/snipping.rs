#[cfg(target_os = "macos")]
use objc2_app_kit::NSWindow;
#[cfg(target_os = "macos")]
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
#[cfg(target_os = "macos")]
#[allow(deprecated)]
use objc2_core_graphics::{
    CGDataProvider, CGImage, CGWindowImageOption, CGWindowListCreateImage, CGWindowListOption,
};
use xcap::{image::ImageFormat as XcapImageFormat, Monitor as XcapMonitor};

const SNIPPING_SHORTCUTS_CHANGED_EVENT: &str = "forge-snipping-shortcuts-changed";
const SNIPPING_CAPTURE_SAVED_EVENT: &str = "forge-snipping-capture-saved";
const SNIPPING_SOURCE_UPDATED_EVENT: &str = "forge-snip-source-updated";
const SNIPPING_AREA_OVERLAY_STARTED_EVENT: &str = "forge-snipping-area-overlay-started";
const SNIPPING_AREA_OVERLAY_SNAPSHOT_EVENT: &str = "forge-snipping-area-overlay-snapshot";
const SNIPPING_AREA_OVERLAY_WINDOW_LABEL: &str = "snipping-overlay";
const SNIPPING_EDITOR_WINDOW_PREFIX: &str = "snipping-editor";
const SNIPPING_SHORTCUT_SETTINGS_FILE: &str = "snipping-shortcuts.json";
const SNIPPING_DISMISSED_TOASTS_FILE: &str = "snipping-dismissed-toasts.json";
const SNIPPING_CAPTURE_HIDE_OVERLAY_DELAY_MS: u64 = 16;
const SNIPPING_MIN_AREA_PIXELS: u32 = 8;
const SNIPPING_RECENT_CAPTURE_TOAST_LIMIT: usize = 6;
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
static SNIPPING_MACOS_EVENT_TAP_STARTED: AtomicBool = AtomicBool::new(false);
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

#[cfg(not(target_os = "macos"))]
fn snipping_left_mouse_button_pressed() -> bool {
    false
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

#[derive(Clone)]
struct SnippingState {
    shortcut_manager: SnippingShortcutManager,
    active_area_monitor: Arc<StdMutex<Option<SnippingAreaMonitor>>>,
    active_area_snapshot: Arc<StdMutex<Option<Arc<xcap::image::RgbaImage>>>>,
    recent_capture_toasts: Arc<StdMutex<Vec<Value>>>,
    asset_target: Arc<StdMutex<SnippingAssetTarget>>,
    dispatch_targets: Arc<StdMutex<Value>>,
    preview_restack_generation: Arc<AtomicU64>,
    /// Preview window label -> asset path currently shown in that window
    /// (retargeted when an annotated copy takes over the preview).
    preview_paths: Arc<StdMutex<HashMap<String, String>>>,
    /// Preview window label -> outer position when the user grabbed it.
    /// Presence marks an in-flight user drag; the start position separates
    /// real drags from plain clicks when the drag settles.
    preview_drag_sessions: Arc<StdMutex<HashMap<String, (i32, i32)>>>,
    preview_drag_over_last_emit_ms: Arc<AtomicU64>,
}

impl SnippingState {
    fn new() -> Self {
        Self {
            shortcut_manager: SnippingShortcutManager::new(),
            active_area_monitor: Arc::new(StdMutex::new(None)),
            active_area_snapshot: Arc::new(StdMutex::new(None)),
            recent_capture_toasts: Arc::new(StdMutex::new(Vec::new())),
            asset_target: Arc::new(StdMutex::new(SnippingAssetTarget::default())),
            dispatch_targets: Arc::new(StdMutex::new(Value::Array(Vec::new()))),
            preview_restack_generation: Arc::new(AtomicU64::new(0)),
            preview_paths: Arc::new(StdMutex::new(HashMap::new())),
            preview_drag_sessions: Arc::new(StdMutex::new(HashMap::new())),
            preview_drag_over_last_emit_ms: Arc::new(AtomicU64::new(0)),
        }
    }
}

#[derive(Clone, Default)]
struct SnippingAssetTarget {
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
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
    full_screenshot: SnippingShortcutRegistration,
    area_snip: SnippingShortcutRegistration,
}

impl SnippingShortcutManagerState {
    fn from_settings(settings: &SnippingSettings) -> Self {
        Self {
            enabled: settings.enabled,
            full_screenshot: SnippingShortcutRegistration::new(settings.full_screenshot.clone()),
            area_snip: SnippingShortcutRegistration::new(settings.area_snip.clone()),
        }
    }

    fn settings(&self) -> SnippingSettings {
        SnippingSettings {
            enabled: self.enabled,
            full_screenshot: self.full_screenshot.shortcut.clone(),
            area_snip: self.area_snip.shortcut.clone(),
        }
    }

    fn registration(&self, action: SnippingShortcutAction) -> SnippingShortcutRegistration {
        match action {
            SnippingShortcutAction::FullScreenshot => self.full_screenshot.clone(),
            SnippingShortcutAction::AreaSnip => self.area_snip.clone(),
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
}

impl SnippingShortcutAction {
    fn from_request(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "full" | "full-screenshot" | "full_screenshot" | "screenshot" => {
                Ok(Self::FullScreenshot)
            }
            "area" | "area-snip" | "area_snip" | "snip" | "selection" => Ok(Self::AreaSnip),
            _ => Err("Unknown snipping shortcut action.".to_string()),
        }
    }

    fn default_shortcut(self) -> String {
        match self {
            Self::FullScreenshot => default_snipping_full_screenshot_shortcut().to_string(),
            Self::AreaSnip => default_snipping_area_snip_shortcut().to_string(),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::FullScreenshot => "full screenshot",
            Self::AreaSnip => "area snip",
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

#[cfg(not(target_os = "macos"))]
fn default_snipping_full_screenshot_shortcut() -> &'static str {
    "Control+Shift+Digit3"
}

#[cfg(not(target_os = "macos"))]
fn default_snipping_area_snip_shortcut() -> &'static str {
    "Control+Shift+Digit4"
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
    full_screenshot: SnippingShortcutRegistrationStatus,
    area_snip: SnippingShortcutRegistrationStatus,
    permissions: SnippingPermissionStatus,
    untracked_root: String,
}

fn default_snipping_enabled() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnippingSettings {
    #[serde(default = "default_snipping_enabled")]
    enabled: bool,
    #[serde(default)]
    full_screenshot: String,
    #[serde(default)]
    area_snip: String,
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
struct SnippingAssetTargetRequest {
    repo_path: Option<String>,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippingUploadAssetRequest {
    path: String,
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
        full_screenshot: SnippingShortcutAction::FullScreenshot.default_shortcut(),
        area_snip: SnippingShortcutAction::AreaSnip.default_shortcut(),
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
    match (parse_snipping_shortcut(left), parse_snipping_shortcut(right)) {
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

    if !snipping_shortcut_has_explicit_modifier(shortcut) && !snipping_shortcut_is_print_screen(shortcut) {
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
    let mut area_snip = normalize_snipping_shortcut_text(&settings.area_snip)
        .unwrap_or(defaults.area_snip.clone());

    if validate_snipping_shortcut_for_action(
        SnippingShortcutAction::FullScreenshot,
        &full_screenshot,
    )
    .is_err()
    {
        full_screenshot = defaults.full_screenshot.clone();
    }

    if validate_snipping_shortcut_for_action(SnippingShortcutAction::AreaSnip, &area_snip)
        .is_err()
    {
        area_snip = defaults.area_snip.clone();
    }

    if snipping_shortcuts_conflict(&full_screenshot, &area_snip) {
        area_snip = defaults.area_snip.clone();
    }

    SnippingSettings {
        enabled: settings.enabled,
        full_screenshot,
        area_snip,
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

fn write_snipping_settings(
    app: &AppHandle,
    settings: &SnippingSettings,
) -> Result<(), String> {
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

#[cfg(target_os = "macos")]
fn macos_screen_capture_permission_granted() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

#[cfg(target_os = "macos")]
fn macos_request_screen_capture_permission() -> bool {
    unsafe { CGRequestScreenCaptureAccess() }
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
        full_screenshot: snipping_shortcut_registration_status(
            SnippingShortcutAction::FullScreenshot,
            state.full_screenshot,
        ),
        area_snip: snipping_shortcut_registration_status(
            SnippingShortcutAction::AreaSnip,
            state.area_snip,
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
                        let _ = snipping_capture_full_for(&app_handle, "shortcut", shortcut_text);
                    });
                }
                SnippingShortcutAction::AreaSnip => {
                    // Capture + overlay prep must never block the shortcut
                    // dispatch thread, or the overlay appears with a visible lag.
                    thread::spawn(move || {
                        let _ =
                            snipping_begin_area_snip_for(&app_handle, "shortcut", shortcut_text);
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
fn snipping_is_macos_default_shortcut(
    action: SnippingShortcutAction,
    shortcut_text: &str,
) -> bool {
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

    None
}

#[cfg(target_os = "macos")]
extern "C" fn snipping_macos_event_tap_callback(
    _proxy: *mut std::ffi::c_void,
    event_type: u32,
    event: *mut std::ffi::c_void,
    _user_info: *mut std::ffi::c_void,
) -> *mut std::ffi::c_void {
    if event_type != SNIPPING_MACOS_CG_EVENT_KEY_DOWN || event.is_null() {
        return event;
    }

    let flags = unsafe { CGEventGetFlags(event) };
    let required = SNIPPING_MACOS_FLAG_COMMAND | SNIPPING_MACOS_FLAG_SHIFT;
    let blocked = SNIPPING_MACOS_FLAG_CONTROL | SNIPPING_MACOS_FLAG_OPTION;
    if flags & required != required || flags & blocked != 0 {
        return event;
    }

    let keycode = unsafe { CGEventGetIntegerValueField(event, SNIPPING_MACOS_CG_KEYBOARD_EVENT_KEYCODE) };
    let Some(app) = snipping_macos_event_tap_app() else {
        return event;
    };
    let Some(action) = snipping_macos_default_action_for_key(&app, keycode) else {
        return event;
    };

    thread::spawn(move || match action {
        SnippingShortcutAction::FullScreenshot => {
            let _ = snipping_capture_full_for(
                &app,
                "macos-default-override",
                SnippingShortcutAction::FullScreenshot.default_shortcut(),
            );
        }
        SnippingShortcutAction::AreaSnip => {
            let _ = snipping_begin_area_snip_for(
                &app,
                "macos-default-override",
                SnippingShortcutAction::AreaSnip.default_shortcut(),
            );
        }
    });

    std::ptr::null_mut()
}

#[cfg(target_os = "macos")]
fn register_snipping_macos_event_tap(app: &AppHandle) -> Result<(), String> {
    snipping_set_macos_event_tap_app(app);

    if SNIPPING_MACOS_EVENT_TAP_STARTED.load(Ordering::SeqCst) {
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

        let source = unsafe {
            CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0)
        };
        if source.is_null() {
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
    }

    app.state::<SnippingState>().shortcut_manager.replace(state);
    emit_snipping_shortcuts_changed(app);
}

fn unregister_snipping_shortcuts_for_state(app: &AppHandle, state: &SnippingShortcutManagerState) {
    unregister_snipping_shortcut(app, &state.full_screenshot.shortcut);
    unregister_snipping_shortcut(app, &state.area_snip.shortcut);
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
        full_screenshot: state.full_screenshot.shortcut.clone(),
        area_snip: state.area_snip.shortcut.clone(),
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
        prewarm_snipping_overlay_window(app);
    } else {
        snipping_set_active_area_snapshot(app, None)?;
        snipping_set_active_area_monitor(app, None)?;
        snipping_close_area_overlay(app);
    }

    manager.replace(next_state);
    emit_snipping_shortcuts_changed(app);
    snipping_status_for(app)
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
    let other_action = match action {
        SnippingShortcutAction::FullScreenshot => SnippingShortcutAction::AreaSnip,
        SnippingShortcutAction::AreaSnip => SnippingShortcutAction::FullScreenshot,
    };
    let other = state.registration(other_action);

    if snipping_shortcuts_conflict(&next_shortcut, &other.shortcut) {
        return Err("Full screenshot and area snip need different shortcuts.".to_string());
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
    }
    manager.replace(next_state);

    emit_snipping_shortcuts_changed(app);
    snipping_status_for(app)
}

fn snipping_current_area_monitor(app: &AppHandle) -> Result<SnippingAreaMonitor, String> {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = window.current_monitor() {
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

            return Ok(SnippingAreaMonitor {
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
            });
        }
    }

    let monitor = XcapMonitor::all()
        .map_err(|error| format!("Unable to list monitors: {error}"))?
        .into_iter()
        .find(|monitor| monitor.is_primary().unwrap_or(false))
        .or_else(|| XcapMonitor::all().ok().and_then(|mut monitors| monitors.drain(..).next()))
        .ok_or_else(|| "No monitor is available for snipping.".to_string())?;

    let capture_x = monitor.x().unwrap_or(0);
    let capture_y = monitor.y().unwrap_or(0);
    let capture_width = monitor.width().unwrap_or(1);
    let capture_height = monitor.height().unwrap_or(1);
    let scale_factor = f64::from(monitor.scale_factor().unwrap_or(1.0)).max(0.1);
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let (x, y, width, height) = (
        (f64::from(capture_x) * scale_factor).round() as i32,
        (f64::from(capture_y) * scale_factor).round() as i32,
        (f64::from(capture_width) * scale_factor).round().max(1.0) as u32,
        (f64::from(capture_height) * scale_factor).round().max(1.0) as u32,
    );
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let (x, y, width, height) = (capture_x, capture_y, capture_width, capture_height);

    Ok(SnippingAreaMonitor {
        x,
        y,
        width,
        height,
        scale_factor,
        capture_x,
        capture_y,
        capture_width,
        capture_height,
        snapshot_path: None,
        snapshot_width: 0,
        snapshot_height: 0,
    })
}

fn xcap_monitor_for_area(area: &SnippingAreaMonitor) -> Result<XcapMonitor, String> {
    if let Ok(mut monitors) = XcapMonitor::all() {
        if let Some(index) = monitors.iter().position(|monitor| {
            monitor.x().unwrap_or(0) == area.capture_x
                && monitor.y().unwrap_or(0) == area.capture_y
                && monitor.width().unwrap_or(0) == area.capture_width
                && monitor.height().unwrap_or(0) == area.capture_height
        }) {
            return Ok(monitors.swap_remove(index));
        }
    }

    let center_x = area
        .capture_x
        .saturating_add((area.capture_width / 2).min(i32::MAX as u32) as i32);
    let center_y = area
        .capture_y
        .saturating_add((area.capture_height / 2).min(i32::MAX as u32) as i32);
    XcapMonitor::from_point(center_x, center_y)
        .or_else(|_| {
            XcapMonitor::all()?
                .into_iter()
                .find(|monitor| monitor.is_primary().unwrap_or(false))
                .ok_or_else(|| xcap::XCapError::new("No monitor is available for snipping."))
        })
        .map_err(|error| format!("Unable to select monitor for snip: {error}"))
}

fn xcap_monitor_for_full(app: &AppHandle) -> Result<XcapMonitor, String> {
    if let Ok(area) = snipping_current_area_monitor(app) {
        if let Ok(monitor) = xcap_monitor_for_area(&area) {
            return Ok(monitor);
        }
    }

    XcapMonitor::all()
        .map_err(|error| format!("Unable to list monitors: {error}"))?
        .into_iter()
        .find(|monitor| monitor.is_primary().unwrap_or(false))
        .or_else(|| XcapMonitor::all().ok().and_then(|mut monitors| monitors.drain(..).next()))
        .ok_or_else(|| "No monitor is available for screenshot capture.".to_string())
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
    image: &xcap::image::RgbaImage,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<xcap::image::RgbaImage, String> {
    let image_width = image.width().max(1);
    let image_height = image.height().max(1);
    let crop_x = x.min(image_width.saturating_sub(1));
    let crop_y = y.min(image_height.saturating_sub(1));
    let crop_width = width.min(image_width.saturating_sub(crop_x)).max(1);
    let crop_height = height.min(image_height.saturating_sub(crop_y)).max(1);
    Ok(
        xcap::image::imageops::crop_imm(image, crop_x, crop_y, crop_width, crop_height)
            .to_image(),
    )
}

fn snipping_crop_area_preview_snapshot(
    area_monitor: &SnippingAreaMonitor,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<xcap::image::RgbaImage, String> {
    let snapshot_path = area_monitor
        .snapshot_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "No frozen snip snapshot is available.".to_string())?;
    let image = xcap::image::open(snapshot_path)
        .map_err(|error| format!("Unable to read frozen snip snapshot {snapshot_path}: {error}"))?
        .to_rgba8();
    snipping_crop_snapshot_image(&image, x, y, width, height)
}

#[cfg(target_os = "macos")]
fn snipping_macos_area_overlay_window_number(app: &AppHandle) -> Option<u32> {
    let window = app.get_webview_window(SNIPPING_AREA_OVERLAY_WINDOW_LABEL)?;
    let ns_window = window.ns_window().ok()?;
    if ns_window.is_null() {
        return None;
    }

    let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
    u32::try_from(ns_window.windowNumber())
        .ok()
        .filter(|window_number| *window_number > 0)
}

#[cfg(target_os = "macos")]
fn snipping_macos_cg_image_to_rgba_image(
    cg_image: Option<&CGImage>,
) -> Result<xcap::image::RgbaImage, String> {
    let width = CGImage::width(cg_image);
    let height = CGImage::height(cg_image);
    if width == 0 || height == 0 {
        return Err("CoreGraphics returned an empty snip image.".to_string());
    }

    let data_provider = CGImage::data_provider(cg_image);
    let data = CGDataProvider::data(data_provider.as_deref())
        .ok_or_else(|| "CoreGraphics returned snip image data without bytes.".to_string())?
        .to_vec();
    let bytes_per_row = CGImage::bytes_per_row(cg_image);
    let mut buffer = Vec::with_capacity(width * height * 4);
    for row in data.chunks_exact(bytes_per_row) {
        buffer.extend_from_slice(&row[..width * 4]);
    }

    for bgra in buffer.chunks_exact_mut(4) {
        bgra.swap(0, 2);
    }

    xcap::image::RgbaImage::from_raw(width as u32, height as u32, buffer)
        .ok_or_else(|| "Unable to decode CoreGraphics snip image.".to_string())
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn snipping_macos_capture_region_below_window(
    monitor: &XcapMonitor,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    below_window_number: u32,
) -> Result<xcap::image::RgbaImage, String> {
    let monitor_x = monitor
        .x()
        .map_err(|error| format!("Unable to read monitor x position: {error}"))?;
    let monitor_y = monitor
        .y()
        .map_err(|error| format!("Unable to read monitor y position: {error}"))?;
    let monitor_width = monitor
        .width()
        .map_err(|error| format!("Unable to read monitor width: {error}"))?
        .max(1);
    let monitor_height = monitor
        .height()
        .map_err(|error| format!("Unable to read monitor height: {error}"))?
        .max(1);

    if width > monitor_width
        || height > monitor_height
        || x.saturating_add(width) > monitor_width
        || y.saturating_add(height) > monitor_height
    {
        return Err(format!(
            "Region ({x}, {y}, {width}, {height}) is outside monitor bounds ({monitor_x}, {monitor_y}, {monitor_width}, {monitor_height})"
        ));
    }

    let rect = CGRect {
        origin: CGPoint {
            x: (monitor_x + x as i32) as f64,
            y: (monitor_y + y as i32) as f64,
        },
        size: CGSize {
            width: width as f64,
            height: height as f64,
        },
    };
    let cg_image = CGWindowListCreateImage(
        rect,
        CGWindowListOption::OptionOnScreenBelowWindow,
        below_window_number,
        CGWindowImageOption::Default,
    );

    snipping_macos_cg_image_to_rgba_image(cg_image.as_deref())
}

fn snipping_capture_area_image(
    app: &AppHandle,
    monitor: &XcapMonitor,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<xcap::image::RgbaImage, String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(window_number) = snipping_macos_area_overlay_window_number(app) {
            if let Ok(image) =
                snipping_macos_capture_region_below_window(monitor, x, y, width, height, window_number)
            {
                return Ok(image);
            }
        }
    }

    snipping_hide_area_overlay(app);
    thread::sleep(Duration::from_millis(SNIPPING_CAPTURE_HIDE_OVERLAY_DELAY_MS));
    monitor
        .capture_region(x, y, width, height)
        .map_err(|error| format!("Unable to capture selected area: {error}"))
}

/// Mid-session capture that must NOT end the snip: tries the
/// capture-below-overlay path first (works through macOS 14), and where
/// CGWindowListCreateImage is gone (macOS 15+ returns nil) it hides the
/// overlay only for the duration of the capture and puts it straight back —
/// keeping the session, the Escape grab, and the overlay window alive. This
/// is what Space-change re-freezes use; routing them through the final-capture
/// fallback used to tear the whole session down the moment the user swiped
/// to a full-screen app.
fn snipping_capture_monitor_image_keeping_session(
    app: &AppHandle,
    monitor: &XcapMonitor,
    width: u32,
    height: u32,
) -> Result<xcap::image::RgbaImage, String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(window_number) = snipping_macos_area_overlay_window_number(app) {
            if let Ok(image) = snipping_macos_capture_region_below_window(
                monitor,
                0,
                0,
                width,
                height,
                window_number,
            ) {
                return Ok(image);
            }
        }
    }

    let overlay = app.get_webview_window(SNIPPING_AREA_OVERLAY_WINDOW_LABEL);
    if let Some(overlay) = overlay.as_ref() {
        let _ = overlay.hide();
    }
    thread::sleep(Duration::from_millis(60));
    let captured = monitor
        .capture_region(0, 0, width, height)
        .map_err(|error| format!("Unable to capture screen for snip re-freeze: {error}"));
    if let Some(overlay) = overlay.as_ref() {
        let _ = overlay.show();
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
    fs::write(&file, contents)
        .map_err(|error| format!("Unable to write dismissed snips {}: {error}", file.display()))
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
                .and_then(|path| snipping_capture_toast_path(item).map(|item_path| item_path == *path))
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
    if show_toast {
        // Every snip preview is its own draggable native window from the
        // start; new captures stack in the bottom-left column.
        let app_for_preview = app.clone();
        let preview_path = target.display().to_string();
        let _ = app.run_on_main_thread(move || {
            let _ = snipping_open_snip_preview_window_for(&app_for_preview, &preview_path, None, false);
        });
    }
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
fn snipping_write_png_fast(
    image: &xcap::image::RgbaImage,
    path: &Path,
) -> Result<(), String> {
    use xcap::image::ImageEncoder;
    let file = fs::File::create(path)
        .map_err(|error| format!("Unable to create snip image {}: {error}", path.display()))?;
    let writer = std::io::BufWriter::new(file);
    let encoder = xcap::image::codecs::png::PngEncoder::new_with_quality(
        writer,
        xcap::image::codecs::png::CompressionType::Fast,
        xcap::image::codecs::png::FilterType::Adaptive,
    );
    encoder
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            xcap::image::ExtendedColorType::Rgba8,
        )
        .map_err(|error| format!("Unable to encode snip image {}: {error}", path.display()))
}

fn snipping_save_image(
    app: &AppHandle,
    image: xcap::image::RgbaImage,
    mode: &str,
    reason: &str,
    shortcut: String,
) -> Result<Value, String> {
    let (target, tmp) = snipping_prepare_capture_path(mode)?;
    let width = image.width();
    let height = image.height();
    snipping_write_png_fast(&image, &tmp)?;
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

fn snipping_copy_untracked_asset_to_clipboard_for(path: String) -> Result<Value, String> {
    let file = diffforge_untracked_asset_file(&path)?;
    diffforge_copy_image_file_to_clipboard(&file)
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
    let x = work_area.position.x
        + ((work_area.size.width as i32 - size.width as i32) / 2).max(0);
    let y = work_area.position.y
        + ((work_area.size.height as i32 - size.height as i32) / 2).max(0);
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

fn snipping_open_floating_asset_window(
    app: &AppHandle,
    path: String,
    prefix: &str,
    route: &str,
    title: &str,
    width: f64,
    height: f64,
) -> Result<Value, String> {
    let file = diffforge_local_asset_file(&path)?;
    let label = format!("{prefix}-{}", snipping_window_token(&file));
    let encoded_path = snipping_url_token(&file.display().to_string());
    let window = WebviewWindowBuilder::new(
        app,
        label.clone(),
        WebviewUrl::App(format!("index.html#{route}/{encoded_path}").into()),
    )
    .title(title)
    .inner_size(width, height)
    .min_inner_size(260.0, 180.0)
    .resizable(true)
    .decorations(false)
    .always_on_top(true)
    .focused(true)
    .accept_first_mouse(true)
    .transparent(false)
    .visible(false)
    .shadow(true)
    .build()
    .map_err(|error| format!("Unable to create {title} window: {error}"))?;
    snipping_center_floating_window(app, &window);
    window
        .show()
        .map_err(|error| format!("Unable to show {title} window: {error}"))?;
    let _ = window.set_focus();
    Ok(json!({
        "kind": "snipping_floating_asset_window_opened",
        "label": label,
        "path": file.display().to_string(),
    }))
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
    let seed = format!("{}:{}", path_values.join("|"), uuid::Uuid::new_v4());
    let label = format!("{}-{}", SNIPPING_EDITOR_WINDOW_PREFIX, cloud_mcp_short_hash(&seed));
    let encoded_paths = snipping_url_token(
        &serde_json::to_string(&path_values)
            .map_err(|error| format!("Unable to encode annotation paths: {error}"))?,
    );
    let window = WebviewWindowBuilder::new(
        app,
        label.clone(),
        WebviewUrl::App(format!("index.html#/snipping-editor/{encoded_paths}").into()),
    )
    .title(if path_values.len() > 1 { "Annotate Assets" } else { "Annotate Snip" })
    .inner_size(840.0, 620.0)
    .min_inner_size(380.0, 280.0)
    .resizable(true)
    .decorations(false)
    // Normal z-order: clicking the main Diff Forge window brings it in front
    // of the annotation editor.
    .always_on_top(false)
    .focused(true)
    .accept_first_mouse(true)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .visible(false)
    // The native shadow is computed from the window frame, which paints a
    // square halo behind the rounded CSS chrome; the webview draws its own
    // shadow inside a transparent gutter instead.
    .shadow(false)
    .build()
    .map_err(|error| format!("Unable to create annotation editor window: {error}"))?;
    snipping_center_floating_window(app, &window);
    window
        .show()
        .map_err(|error| format!("Unable to show annotation editor window: {error}"))?;
    let _ = window.set_focus();
    Ok(json!({
        "kind": "snipping_floating_asset_window_opened",
        "label": label,
        "paths": path_values,
    }))
}

fn snipping_set_asset_target_for(
    app: &AppHandle,
    request: SnippingAssetTargetRequest,
) -> Result<Value, String> {
    let repo_path = request
        .repo_path
        .unwrap_or_default()
        .trim()
        .to_string();
    let workspace_id = request
        .workspace_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let workspace_name = request
        .workspace_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let state = app.state::<SnippingState>();
    let mut guard = state
        .asset_target
        .lock()
        .map_err(|_| "Unable to lock snipping asset target.".to_string())?;
    *guard = SnippingAssetTarget {
        repo_path,
        workspace_id,
        workspace_name,
    };
    Ok(json!({
        "kind": "snipping_asset_target_set",
        "repoPath": guard.repo_path.clone(),
        "workspaceId": guard.workspace_id.clone(),
        "workspaceName": guard.workspace_name.clone(),
    }))
}

fn snipping_asset_target_for(app: &AppHandle) -> Result<SnippingAssetTarget, String> {
    app.state::<SnippingState>()
        .asset_target
        .lock()
        .map(|guard| guard.clone())
        .map_err(|_| "Unable to lock snipping asset target.".to_string())
}

fn snipping_upload_untracked_asset_for(
    app: &AppHandle,
    request: SnippingUploadAssetRequest,
) -> Result<Value, String> {
    let target = snipping_asset_target_for(app)?;
    if target.repo_path.trim().is_empty() {
        return Err("Select a workspace before uploading this snip.".to_string());
    }
    diffforge_promote_untracked_asset(
        app.clone(),
        target.repo_path,
        target.workspace_id,
        target.workspace_name,
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
    let image = xcap::image::load_from_memory(&bytes)
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
    let tmp = tmp_dir.join(format!(
        ".snip-edited-{}.tmp",
        uuid::Uuid::new_v4()
    ));
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
    let original_for_event = original_path
        .clone()
        .unwrap_or_else(|| target_path.clone());
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
        let preview_label = format!(
            "{SNIPPING_FLOAT_WINDOW_PREFIX}-{}",
            snipping_window_token(&source)
        );
        if app.get_webview_window(&preview_label).is_some() {
            if let Ok(mut paths) = app.state::<SnippingState>().preview_paths.lock() {
                paths.insert(preview_label, target_path.clone());
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
    let monitor = xcap_monitor_for_full(app)?;
    let image = monitor
        .capture_image()
        .map_err(|error| format!("Unable to capture screenshot: {error}"))?;
    snipping_save_image(app, image, "full", reason, shortcut)
}

fn size_snipping_overlay_window(
    window: &tauri::WebviewWindow,
    monitor: &SnippingAreaMonitor,
) {
    let _ = window.set_position(tauri::PhysicalPosition::new(monitor.x, monitor.y));
    let _ = window.set_size(tauri::PhysicalSize::new(monitor.width, monitor.height));
}

fn ensure_snipping_overlay_window(
    app: &AppHandle,
    monitor: &SnippingAreaMonitor,
) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(SNIPPING_AREA_OVERLAY_WINDOW_LABEL) {
        size_snipping_overlay_window(&window, monitor);
        return Ok(window);
    }

    let logical_width = f64::from(monitor.width) / monitor.scale_factor.max(1.0);
    let logical_height = f64::from(monitor.height) / monitor.scale_factor.max(1.0);
    let window = WebviewWindowBuilder::new(
        app,
        SNIPPING_AREA_OVERLAY_WINDOW_LABEL,
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

    size_snipping_overlay_window(&window, monitor);
    // CanJoinAllSpaces alone does not join full-screen Spaces on macOS; the
    // overlay needs FullScreenAuxiliary or it vanishes when the user swipes
    // to a full-screen window mid-snip.
    #[cfg(target_os = "macos")]
    if let Ok(ns_window) = window.ns_window() {
        if !ns_window.is_null() {
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            ns_window.setCollectionBehavior(
                objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllSpaces
                    | objc2_app_kit::NSWindowCollectionBehavior::FullScreenAuxiliary
                    | objc2_app_kit::NSWindowCollectionBehavior::Stationary,
            );
        }
    }
    Ok(window)
}

fn prewarm_snipping_overlay_window(app: &AppHandle) {
    let app_for_task = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Ok(monitor) = snipping_current_area_monitor(&app_for_task) else {
            return;
        };
        let Ok(window) = ensure_snipping_overlay_window(&app_for_task, &monitor) else {
            return;
        };
        let _ = window.hide();
    });
}

fn snipping_set_active_area_monitor(
    app: &AppHandle,
    monitor: Option<SnippingAreaMonitor>,
) -> Result<(), String> {
    let state = app.state::<SnippingState>();
    let mut guard = state
        .active_area_monitor
        .lock()
        .map_err(|_| "Unable to lock snipping overlay state.".to_string())?;
    let next_snapshot_path = monitor
        .as_ref()
        .and_then(|next_monitor| next_monitor.snapshot_path.as_deref())
        .map(str::to_string);
    let previous = std::mem::replace(&mut *guard, monitor);
    if let Some(previous_monitor) = previous {
        let previous_snapshot_path = previous_monitor.snapshot_path.as_deref();
        if previous_snapshot_path != next_snapshot_path.as_deref() {
            snipping_remove_snapshot_file(previous_snapshot_path);
        }
    }
    Ok(())
}

fn snipping_set_active_area_snapshot(
    app: &AppHandle,
    snapshot: Option<Arc<xcap::image::RgbaImage>>,
) -> Result<(), String> {
    let state = app.state::<SnippingState>();
    let mut guard = state
        .active_area_snapshot
        .lock()
        .map_err(|_| "Unable to lock snipping snapshot state.".to_string())?;
    *guard = snapshot;
    Ok(())
}

fn snipping_crop_active_area_snapshot(
    app: &AppHandle,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<xcap::image::RgbaImage, String> {
    let state = app.state::<SnippingState>();
    let guard = state
        .active_area_snapshot
        .lock()
        .map_err(|_| "Unable to lock snipping snapshot state.".to_string())?;
    let image = guard
        .as_ref()
        .ok_or_else(|| "No frozen snip snapshot is available.".to_string())?;
    snipping_crop_snapshot_image(image.as_ref(), x, y, width, height)
}

fn snipping_active_area_monitor(app: &AppHandle) -> Result<SnippingAreaMonitor, String> {
    let state = app.state::<SnippingState>();
    let guard = state
        .active_area_monitor
        .lock()
        .map_err(|_| "Unable to lock snipping overlay state.".to_string())?;
    guard
        .clone()
        .ok_or_else(|| "No active snipping overlay monitor.".to_string())
}

fn snipping_begin_area_snip_for(
    app: &AppHandle,
    reason: &str,
    shortcut: String,
) -> Result<Value, String> {
    ensure_snipping_enabled(app)?;
    let mut monitor = snipping_current_area_monitor(app)?;
    let xcap_monitor = xcap_monitor_for_area(&monitor)?;
    let image = Arc::new(
        xcap_monitor
            .capture_image()
            .map_err(|error| format!("Unable to capture screen for area snip: {error}"))?,
    );
    monitor.snapshot_width = image.width();
    monitor.snapshot_height = image.height();
    monitor.snapshot_path = None;
    snipping_set_active_area_snapshot(app, Some(Arc::clone(&image)))?;
    snipping_set_active_area_monitor(app, Some(monitor.clone()))?;
    let window = ensure_snipping_overlay_window(app, &monitor)?;
    let _ = window.emit(SNIPPING_AREA_OVERLAY_STARTED_EVENT, json!({
        "kind": "snipping_area_overlay_started",
        "monitor": monitor.clone(),
    }));
    window
        .show()
        .map_err(|error| format!("Unable to show snipping overlay: {error}"))?;
    let _ = window.set_focus();
    snipping_register_escape_cancel(app);

    // The frozen-frame JPEG is only a visual backdrop; write it off the hot
    // path so the selection overlay appears instantly, then announce it.
    let app_for_snapshot = app.clone();
    thread::spawn(move || {
        snipping_store_area_snapshot_backdrop(&app_for_snapshot, image);
    });

    Ok(json!({
        "kind": "snipping_area_started",
        "reason": reason,
        "shortcut": shortcut,
        "monitor": monitor,
    }))
}

/// Writes the frozen-frame JPEG backdrop for the active snip session, swaps
/// it into the active monitor state (deleting any previous backdrop file),
/// and announces it to the overlay webview. Safe to call again mid-session,
/// which is how Space switches refresh the freeze.
fn snipping_store_area_snapshot_backdrop(
    app: &AppHandle,
    image: Arc<xcap::image::RgbaImage>,
) {
    let Ok(snapshot_path) = snipping_overlay_snapshot_path() else {
        return;
    };
    // Pixel copy + JPEG encode both happen off the capture hot path.
    if xcap::image::DynamicImage::ImageRgba8(image.as_ref().clone())
        .to_rgb8()
        .save_with_format(&snapshot_path, XcapImageFormat::Jpeg)
        .is_err()
    {
        return;
    }
    let path_text = snapshot_path.display().to_string();
    let state = app.state::<SnippingState>();
    let mut still_active = false;
    let mut previous_path = None;
    if let Ok(mut guard) = state.active_area_monitor.lock() {
        if let Some(active_monitor) = guard.as_mut() {
            previous_path = active_monitor.snapshot_path.replace(path_text.clone());
            active_monitor.snapshot_width = image.width();
            active_monitor.snapshot_height = image.height();
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
    if let Some(overlay) = app.get_webview_window(SNIPPING_AREA_OVERLAY_WINDOW_LABEL) {
        let _ = overlay.emit(
            SNIPPING_AREA_OVERLAY_SNAPSHOT_EVENT,
            json!({
                "kind": "snipping_area_overlay_snapshot",
                "snapshotPath": path_text.clone(),
                "snapshot_path": path_text,
            }),
        );
    }
}

/// Re-freezes the active snip session after a macOS Space switch: captures
/// the new Space below the overlay (so the stale backdrop is not in the
/// shot), swaps the in-memory frozen frame, and refreshes the backdrop.
#[cfg(target_os = "macos")]
fn snipping_refreeze_area_snapshot_for_space_change(app: &AppHandle) {
    let Some(window) = app.get_webview_window(SNIPPING_AREA_OVERLAY_WINDOW_LABEL) else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    let Ok(area_monitor) = snipping_active_area_monitor(app) else {
        return;
    };
    let app = app.clone();
    thread::spawn(move || {
        // Let the Space transition animation settle before re-capturing.
        thread::sleep(Duration::from_millis(260));
        let Ok(monitor) = xcap_monitor_for_area(&area_monitor) else {
            return;
        };
        let width = monitor.width().unwrap_or(area_monitor.capture_width).max(1);
        let height = monitor.height().unwrap_or(area_monitor.capture_height).max(1);
        let Ok(image) =
            snipping_capture_monitor_image_keeping_session(&app, &monitor, width, height)
        else {
            return;
        };
        let image = Arc::new(image);
        if snipping_set_active_area_snapshot(&app, Some(Arc::clone(&image))).is_err() {
            return;
        }
        snipping_store_area_snapshot_backdrop(&app, image);
    });
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
        let workspace = objc2_app_kit::NSWorkspace::sharedWorkspace();
        let center = workspace.notificationCenter();
        let block = block2::RcBlock::new(
            move |_notification: std::ptr::NonNull<objc2_foundation::NSNotification>| {
                if let Some(app) = snipping_macos_event_tap_app() {
                    snipping_refreeze_area_snapshot_for_space_change(&app);
                }
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
    });
}

fn snipping_area_escape_shortcut() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

/// While area-snip mode is active, Escape is grabbed globally so it always
/// exits the mode — even when the overlay webview does not hold keyboard
/// focus (e.g. right after swiping to a full-screen Space). The grab exists
/// only for the lifetime of the mode; outside it, Escape reaches apps
/// normally.
fn snipping_register_escape_cancel(app: &AppHandle) {
    let _ = app
        .global_shortcut()
        .unregister(snipping_area_escape_shortcut());
    let _ = app.global_shortcut().on_shortcut(
        snipping_area_escape_shortcut(),
        |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let app = app.clone();
            thread::spawn(move || {
                let _ = snipping_cancel_area_snip_for(&app);
            });
        },
    );
}

fn snipping_unregister_escape_cancel(app: &AppHandle) {
    let _ = app
        .global_shortcut()
        .unregister(snipping_area_escape_shortcut());
}

fn snipping_cancel_area_snip_for(app: &AppHandle) -> Result<Value, String> {
    snipping_set_active_area_snapshot(app, None)?;
    snipping_set_active_area_monitor(app, None)?;
    snipping_hide_area_overlay(app);
    Ok(json!({
        "kind": "snipping_area_cancelled",
    }))
}

fn snipping_hide_area_overlay(app: &AppHandle) {
    snipping_unregister_escape_cancel(app);
    if let Some(window) = app.get_webview_window(SNIPPING_AREA_OVERLAY_WINDOW_LABEL) {
        let _ = window.hide();
    }
}

fn snipping_close_area_overlay(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SNIPPING_AREA_OVERLAY_WINDOW_LABEL) {
        let _ = window.close();
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

fn snipping_finish_area_snip_for(
    app: &AppHandle,
    request: SnippingAreaSelectionRequest,
) -> Result<Value, String> {
    let area_monitor = snipping_active_area_monitor(app)?;
    let fallback_scale = snipping_area_capture_scale(&area_monitor, request.scale_factor);
    // Map CSS selection coordinates onto the frozen snapshot exactly. The
    // snapshot is in physical pixels while the overlay reports logical
    // pixels, so a hardcoded 1.0 scale crops up-left of the real selection
    // on HiDPI displays. Deriving the scale per axis from the snapshot and
    // window logical size is correct on every platform and mixed-DPI setup.
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
    let selection_x = (request.x.max(0.0) * scale_x).round() as u32;
    let selection_y = (request.y.max(0.0) * scale_y).round() as u32;
    let selection_width = (request.width.max(0.0) * scale_x).round() as u32;
    let selection_height = (request.height.max(0.0) * scale_y).round() as u32;

    if selection_width < SNIPPING_MIN_AREA_PIXELS || selection_height < SNIPPING_MIN_AREA_PIXELS {
        snipping_set_active_area_snapshot(app, None)?;
        snipping_set_active_area_monitor(app, None)?;
        snipping_hide_area_overlay(app);
        return Err("Snip area is too small.".to_string());
    }

    let image_result = (|| -> Result<xcap::image::RgbaImage, String> {
        // The in-memory frozen frame is what the user actually saw while
        // selecting; prefer it over re-capturing the live screen.
        if let Ok(image) = snipping_crop_active_area_snapshot(
            app,
            selection_x,
            selection_y,
            selection_width,
            selection_height,
        ) {
            return Ok(image);
        }
        if area_monitor.snapshot_path.as_deref().map(str::trim).is_some_and(|value| !value.is_empty()) {
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

        let monitor = xcap_monitor_for_area(&area_monitor)?;
        // macOS below-window capture works in logical points, so the live
        // fallback uses the unscaled CSS selection there; other platforms
        // crop a physical-pixel monitor image.
        #[cfg(target_os = "macos")]
        {
            let x = request.x.max(0.0).round() as u32;
            let y = request.y.max(0.0).round() as u32;
            let width = (request.width.max(0.0).round() as u32).max(1);
            let height = (request.height.max(0.0).round() as u32).max(1);
            snipping_capture_area_image(app, &monitor, x, y, width, height)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let monitor_width = monitor.width().unwrap_or(area_monitor.capture_width).max(1);
            let monitor_height = monitor.height().unwrap_or(area_monitor.capture_height).max(1);
            let x = selection_x.min(monitor_width.saturating_sub(1));
            let y = selection_y.min(monitor_height.saturating_sub(1));
            let width = selection_width.min(monitor_width.saturating_sub(x)).max(1);
            let height = selection_height.min(monitor_height.saturating_sub(y)).max(1);
            snipping_capture_area_image(app, &monitor, x, y, width, height)
        }
    })();
    snipping_set_active_area_snapshot(app, None)?;
    snipping_set_active_area_monitor(app, None)?;
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

    snipping_capture_full_for(&app, "manual", String::new())
}

#[tauri::command]
fn snipping_begin_area_snip(app: AppHandle) -> Result<Value, String> {
    snipping_begin_area_snip_for(&app, "manual", String::new())
}

#[tauri::command]
fn snipping_area_overlay_status(app: AppHandle) -> Result<Value, String> {
    let monitor = snipping_active_area_monitor(&app)
        .or_else(|_| snipping_current_area_monitor(&app))?;
    Ok(json!({
        "kind": "snipping_area_overlay_status",
        "monitor": monitor,
    }))
}

#[tauri::command]
fn snipping_finish_area_snip(
    app: AppHandle,
    request: SnippingAreaSelectionRequest,
) -> Result<Value, String> {
    snipping_finish_area_snip_for(&app, request)
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
fn snipping_set_asset_target(
    app: AppHandle,
    request: SnippingAssetTargetRequest,
) -> Result<Value, String> {
    snipping_set_asset_target_for(&app, request)
}

#[tauri::command]
fn snipping_upload_untracked_asset(
    app: AppHandle,
    request: SnippingUploadAssetRequest,
) -> Result<Value, String> {
    snipping_upload_untracked_asset_for(&app, request)
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
// Every preview is the same golden-ratio rectangle; the capture letterboxes
// inside it (object-fit: contain in the webview) instead of sizing the window.
const SNIPPING_FLOAT_LOGICAL_HEIGHT: f64 = SNIPPING_FLOAT_LOGICAL_WIDTH / SNIPPING_FLOAT_GOLDEN_RATIO;
const SNIPPING_FLOAT_STACK_MARGIN: f64 = 16.0;
const SNIPPING_FLOAT_STACK_GAP: f64 = 10.0;
// A native window drag streams Moved events; the stack only re-packs after
// the window has sat still this long (also long enough to skip mid-drag
// pauses being treated as drops in most cases).
const SNIPPING_FLOAT_RESTACK_SETTLE_MS: u64 = 420;
// Webview events for dropping a preview window onto the main window: the
// main webview hit-tests the point for a drop target (todo card, terminal
// pane, ...) and consumes the preview when one accepts.
const SNIPPING_PREVIEW_DROP_EVENT: &str = "forge-snip-preview-drop";
const SNIPPING_PREVIEW_DRAG_OVER_EVENT: &str = "forge-snip-preview-drag-over";
const SNIPPING_PREVIEW_DRAG_OVER_THROTTLE_MS: u64 = 50;
// Anything closer than this to the grab position is a click, not a drop.
const SNIPPING_PREVIEW_DRAG_MIN_DISTANCE: i32 = 8;

/// Bottom-left stacking slot for a new preview window: directly above the
/// highest preview still sitting in the left column, or the bottom corner of
/// the work area when none are there.
fn snipping_preview_stack_position(
    app: &AppHandle,
    width: f64,
    height: f64,
) -> Option<tauri::PhysicalPosition<i32>> {
    let monitor = app
        .get_webview_window("main")
        .and_then(|main_window| main_window.current_monitor().ok().flatten())?;
    let work_area = monitor.work_area();
    let scale = monitor.scale_factor().max(0.1);
    let margin = (SNIPPING_FLOAT_STACK_MARGIN * scale).round() as i32;
    let gap = (SNIPPING_FLOAT_STACK_GAP * scale).round() as i32;
    let width_physical = (width * scale).round() as i32;
    let height_physical = (height * scale).round() as i32;
    let x = work_area.position.x + margin;
    let bottom_y =
        work_area.position.y + work_area.size.height as i32 - height_physical - margin;

    let mut highest_top: Option<i32> = None;
    for (label, window) in app.webview_windows() {
        if !label.starts_with(SNIPPING_FLOAT_WINDOW_PREFIX) {
            continue;
        }
        if !window.is_visible().unwrap_or(false) {
            continue;
        }
        let Ok(position) = window.outer_position() else {
            continue;
        };
        // Only stack against previews still parked in the left column; ones
        // the user dragged away stop reserving a slot.
        if (position.x - x).abs() > width_physical {
            continue;
        }
        highest_top = Some(highest_top.map_or(position.y, |current| current.min(position.y)));
    }

    let y = match highest_top {
        Some(top) => (top - gap - height_physical).max(work_area.position.y + margin),
        None => bottom_y,
    };
    Some(tauri::PhysicalPosition::new(x, y))
}

/// Re-packs every preview parked in the bottom-left column into a tight
/// bottom-up stack. A preview dragged out of the column stops reserving a
/// slot (the ones above slide down to fill it), and a preview dropped back
/// over the column is adopted into the stack at the height it was dropped.
fn snipping_reflow_preview_stack(app: &AppHandle) {
    let Some(monitor) = app
        .get_webview_window("main")
        .and_then(|main_window| main_window.current_monitor().ok().flatten())
    else {
        return;
    };
    let work_area = monitor.work_area();
    let scale = monitor.scale_factor().max(0.1);
    let margin = (SNIPPING_FLOAT_STACK_MARGIN * scale).round() as i32;
    let gap = (SNIPPING_FLOAT_STACK_GAP * scale).round() as i32;
    let width_physical = (SNIPPING_FLOAT_LOGICAL_WIDTH * scale).round() as i32;
    let height_physical = (SNIPPING_FLOAT_LOGICAL_HEIGHT * scale).round() as i32;
    let x = work_area.position.x + margin;
    let top_limit = work_area.position.y + margin;

    let mut docked: Vec<(tauri::PhysicalPosition<i32>, i32, tauri::WebviewWindow)> = Vec::new();
    for (label, window) in app.webview_windows() {
        if !label.starts_with(SNIPPING_FLOAT_WINDOW_PREFIX) {
            continue;
        }
        if !window.is_visible().unwrap_or(false) {
            continue;
        }
        let Ok(position) = window.outer_position() else {
            continue;
        };
        // Same column membership test as snipping_preview_stack_position.
        if (position.x - x).abs() > width_physical {
            continue;
        }
        let height = window
            .outer_size()
            .map(|size| size.height as i32)
            .unwrap_or(height_physical)
            .max(1);
        docked.push((position, height, window));
    }

    // The lowest window keeps the bottom slot; on-screen order is preserved.
    docked.sort_by(|a, b| (b.0.y + b.1).cmp(&(a.0.y + a.1)));
    let mut bottom_edge = work_area.position.y + work_area.size.height as i32 - margin;
    for (position, height, window) in docked {
        let y = (bottom_edge - height).max(top_limit);
        // Skipping already-settled windows keeps this idempotent, so the
        // Moved events our own set_position emits cannot ping-pong forever.
        if position.x != x || position.y != y {
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
        bottom_edge = y - gap;
    }
}

/// Debounced settle trigger fed by preview Moved/Destroyed window events.
fn schedule_snipping_preview_stack_reflow(app: &AppHandle) {
    let generation = app
        .state::<SnippingState>()
        .preview_restack_generation
        .clone();
    let ticket = generation.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(SNIPPING_FLOAT_RESTACK_SETTLE_MS));
        if generation.load(Ordering::SeqCst) != ticket {
            return;
        }
        let app_for_settle = app.clone();
        let _ = app.run_on_main_thread(move || {
            snipping_settle_preview_windows(&app_for_settle);
        });
    });
}

/// Runs once a preview window has stopped moving AND the mouse button is up:
/// first offers any user-dragged preview to the main webview as a drop, then
/// re-packs the bottom-left stack.
fn snipping_settle_preview_windows(app: &AppHandle) {
    if snipping_left_mouse_button_pressed() {
        // Still mid-drag (the user paused without releasing): check again.
        schedule_snipping_preview_stack_reflow(app);
        return;
    }
    snipping_resolve_preview_drop_candidates(app);
    snipping_reflow_preview_stack(app);
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
            continue;
        }
        let Some((client_x, client_y)) = snipping_preview_point_in_main(app, &window) else {
            continue;
        };
        let path = state
            .preview_paths
            .lock()
            .ok()
            .and_then(|paths| paths.get(&label).cloned())
            .unwrap_or_default();
        if path.is_empty() {
            continue;
        }
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

/// Opens one snip preview as its own draggable native window. Every preview is
/// a standalone window from the moment it is captured: new previews stack in
/// the bottom-left column and can be dragged anywhere (over any Space) without
/// ever changing identity.
fn snipping_open_snip_preview_window_for(
    app: &AppHandle,
    path: &str,
    explicit_position: Option<(f64, f64)>,
    focused: bool,
) -> Result<Value, String> {
    let file = diffforge_local_asset_file(path)?;
    let width = SNIPPING_FLOAT_LOGICAL_WIDTH;
    let height = SNIPPING_FLOAT_LOGICAL_HEIGHT;
    let label = format!("{SNIPPING_FLOAT_WINDOW_PREFIX}-{}", snipping_window_token(&file));

    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.show();
        if focused {
            let _ = existing.set_focus();
        }
        return Ok(json!({
            "kind": "snip_float_opened",
            "label": label,
            "path": file.display().to_string(),
            "already_open": true,
            "width": width,
            "height": height,
        }));
    }

    let encoded_path = snipping_url_token(&file.display().to_string());
    let window = WebviewWindowBuilder::new(
        app,
        label.clone(),
        WebviewUrl::App(format!("index.html#/snipping-float/{encoded_path}").into()),
    )
    .title("Snip")
    .inner_size(width, height)
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
    if let Ok(ns_window) = window.ns_window() {
        if !ns_window.is_null() {
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            ns_window.setCollectionBehavior(
                objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllSpaces
                    | objc2_app_kit::NSWindowCollectionBehavior::FullScreenAuxiliary
                    | objc2_app_kit::NSWindowCollectionBehavior::Stationary,
            );
        }
    }

    match explicit_position {
        Some((x, y)) => {
            let _ = window.set_position(tauri::LogicalPosition::new(x.max(0.0), y.max(0.0)));
        }
        None => {
            if let Some(position) = snipping_preview_stack_position(app, width, height) {
                let _ = window.set_position(position);
            }
        }
    }
    if let Ok(mut paths) = app.state::<SnippingState>().preview_paths.lock() {
        paths.insert(label.clone(), file.display().to_string());
    }
    // Dragging a preview out of the bottom-left column (or closing one) frees
    // its slot and the stack re-packs; dropping one back over the column
    // re-adopts it. Reflow is debounced until the window stops moving. While
    // a user drag is in flight, the move stream also feeds live drag-over
    // points to the main webview so drop targets can highlight.
    {
        let app_for_events = app.clone();
        let label_for_events = label.clone();
        window.on_window_event(move |event| {
            match event {
                WindowEvent::Moved(_) => {
                    snipping_emit_preview_drag_over(&app_for_events, &label_for_events);
                    schedule_snipping_preview_stack_reflow(&app_for_events);
                }
                WindowEvent::Destroyed => {
                    let state = app_for_events.state::<SnippingState>();
                    if let Ok(mut paths) = state.preview_paths.lock() {
                        paths.remove(&label_for_events);
                    }
                    if let Ok(mut sessions) = state.preview_drag_sessions.lock() {
                        sessions.remove(&label_for_events);
                    }
                    schedule_snipping_preview_stack_reflow(&app_for_events);
                }
                _ => {}
            }
        });
    }
    let _ = window.show();

    Ok(json!({
        "kind": "snip_float_opened",
        "label": label,
        "path": file.display().to_string(),
        "width": width,
        "height": height,
    }))
}

#[tauri::command]
fn snipping_open_snip_float(
    app: AppHandle,
    path: String,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<Value, String> {
    let explicit_position = match (x, y) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    };
    snipping_open_snip_preview_window_for(&app, &path, explicit_position, true)
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
    let Some(window) = app.get_webview_window(&label) else {
        return Err("Snip preview window is not open.".to_string());
    };
    let position = window
        .outer_position()
        .map_err(|error| format!("Unable to read snip preview position: {error}"))?;
    if let Ok(mut sessions) = app
        .state::<SnippingState>()
        .preview_drag_sessions
        .lock()
    {
        sessions.insert(label, (position.x, position.y));
    }
    // A plain click never emits Moved events, so make sure the session still
    // gets settled (and cleared) shortly after.
    schedule_snipping_preview_stack_reflow(&app);
    Ok(json!({ "ok": true }))
}

/// A drop target in the main webview accepted the snip: the preview window
/// closes and its capture toast is dismissed, like a manual dismiss.
#[tauri::command]
fn snipping_consume_snip_preview(app: AppHandle, label: String, path: String) -> Result<Value, String> {
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
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }
    Ok(json!({ "ok": true, "label": label }))
}

#[tauri::command]
fn snipping_set_dispatch_targets(app: AppHandle, targets: Value) -> Result<Value, String> {
    let state = app.state::<SnippingState>();
    let mut guard = state
        .dispatch_targets
        .lock()
        .map_err(|_| "Unable to lock snipping dispatch targets.".to_string())?;
    *guard = if targets.is_array() { targets } else { Value::Array(Vec::new()) };
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
    snipping_open_floating_asset_window(
        &app,
        path,
        SNIPPING_EDITOR_WINDOW_PREFIX,
        "/snipping-editor",
        "Annotate Snip",
        980.0,
        720.0,
    )
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
fn snipping_cancel_area_snip(app: AppHandle) -> Result<Value, String> {
    snipping_cancel_area_snip_for(&app)
}

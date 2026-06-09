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
const SNIPPING_AREA_OVERLAY_WINDOW_LABEL: &str = "snipping-overlay";
const SNIPPING_TOAST_WINDOW_LABEL: &str = "snipping-toasts";
const SNIPPING_PIN_WINDOW_PREFIX: &str = "snipping-pin";
const SNIPPING_EDITOR_WINDOW_PREFIX: &str = "snipping-editor";
const SNIPPING_SHORTCUT_SETTINGS_FILE: &str = "snipping-shortcuts.json";
const SNIPPING_CAPTURE_HIDE_OVERLAY_DELAY_MS: u64 = 16;
const SNIPPING_MIN_AREA_PIXELS: u32 = 8;
const SNIPPING_RECENT_CAPTURE_TOAST_LIMIT: usize = 6;
const SNIPPING_TOAST_WINDOW_WIDTH: f64 = 316.0;
const SNIPPING_TOAST_WINDOW_HEIGHT: f64 = 560.0;
const SNIPPING_TOAST_WINDOW_MARGIN: i32 = 18;
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
    recent_capture_toasts: Arc<StdMutex<Vec<Value>>>,
    asset_target: Arc<StdMutex<SnippingAssetTarget>>,
}

impl SnippingState {
    fn new() -> Self {
        Self {
            shortcut_manager: SnippingShortcutManager::new(),
            active_area_monitor: Arc::new(StdMutex::new(None)),
            recent_capture_toasts: Arc::new(StdMutex::new(Vec::new())),
            asset_target: Arc::new(StdMutex::new(SnippingAssetTarget::default())),
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
                    let _ = snipping_begin_area_snip_for(&app_handle, "shortcut", shortcut_text);
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
    } else {
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

fn size_snipping_toast_window(window: &tauri::WebviewWindow) {
    let _ = window.set_size(tauri::LogicalSize::new(
        SNIPPING_TOAST_WINDOW_WIDTH,
        SNIPPING_TOAST_WINDOW_HEIGHT,
    ));
}

fn position_snipping_toast_window(app: &AppHandle, window: &tauri::WebviewWindow) {
    let monitor = app
        .get_webview_window("main")
        .and_then(|main_window| main_window.current_monitor().ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };

    let work_area = monitor.work_area();
    let scale_factor = monitor.scale_factor().max(0.1);
    let height = (SNIPPING_TOAST_WINDOW_HEIGHT * scale_factor).round() as i32;
    let x = work_area.position.x + SNIPPING_TOAST_WINDOW_MARGIN;
    let y = work_area.position.y + work_area.size.height as i32 - height - SNIPPING_TOAST_WINDOW_MARGIN;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

fn ensure_snipping_toast_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(SNIPPING_TOAST_WINDOW_LABEL) {
        size_snipping_toast_window(&window);
        position_snipping_toast_window(app, &window);
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        SNIPPING_TOAST_WINDOW_LABEL,
        WebviewUrl::App("index.html#/snipping-toasts".into()),
    )
    .title("Snip Quick Access")
    .inner_size(SNIPPING_TOAST_WINDOW_WIDTH, SNIPPING_TOAST_WINDOW_HEIGHT)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .focused(false)
    .accept_first_mouse(true)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .visible(false)
    .shadow(false)
    .build()
    .map_err(|error| format!("Unable to create snipping preview window: {error}"))?;

    position_snipping_toast_window(app, &window);
    let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
    Ok(window)
}

fn show_snipping_toast_window_for(app: &AppHandle) -> Result<(), String> {
    let window = ensure_snipping_toast_window(app)?;
    window
        .show()
        .map_err(|error| format!("Unable to show snipping preview window: {error}"))?;
    position_snipping_toast_window(app, &window);
    Ok(())
}

fn show_snipping_toast_window(app: &AppHandle) {
    let app_for_task = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = show_snipping_toast_window_for(&app_for_task);
    });
}

fn snipping_push_recent_capture_toast(app: &AppHandle, payload: Value) {
    let recent_capture_toasts = app.state::<SnippingState>().recent_capture_toasts.clone();
    let Ok(mut guard) = recent_capture_toasts.lock() else {
        return;
    };

    let path = payload
        .get("path")
        .or_else(|| payload.get("localPath"))
        .or_else(|| payload.get("local_path"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if !path.is_empty() {
        guard.retain(|item| {
            item.get("path")
                .or_else(|| item.get("localPath"))
                .or_else(|| item.get("local_path"))
                .and_then(Value::as_str)
                .map(|item_path| item_path != path)
                .unwrap_or(true)
        });
    }
    guard.insert(0, payload);
    guard.truncate(SNIPPING_RECENT_CAPTURE_TOAST_LIMIT);
}

fn snipping_recent_capture_toasts_for(app: &AppHandle) -> Value {
    let items = app
        .state::<SnippingState>()
        .recent_capture_toasts
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    json!({
        "kind": "snipping_recent_capture_toasts",
        "items": items,
    })
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
    show_snipping_toast_window(app);
    let _ = app.emit(SNIPPING_CAPTURE_SAVED_EVENT, payload.clone());
    Ok(payload)
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
    image
        .save_with_format(&tmp, XcapImageFormat::Png)
        .map_err(|error| format!("Unable to write snip image {}: {error}", tmp.display()))?;
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
    let filename = cloud_mcp_sanitize_asset_filename(
        &format!("{source_name}-edited-{}.png", cloud_mcp_now_ms()),
        "snip-edited.png",
    );
    let target = cloud_mcp_available_asset_download_path(&edits_dir, &filename);
    let tmp = tmp_dir.join(format!(
        ".{}-{}.tmp",
        filename.trim_end_matches(".png"),
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
    snipping_emit_untracked_image_saved(
        app,
        &target,
        width,
        height,
        "edited",
        "annotation-editor",
        String::new(),
        Some(source.display().to_string()),
    )
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
    .focused(true)
    .accept_first_mouse(true)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .visible(false)
    .shadow(false)
    .build()
    .map_err(|error| format!("Unable to create snipping overlay: {error}"))?;

    size_snipping_overlay_window(&window, monitor);
    Ok(window)
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
    *guard = monitor;
    Ok(())
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
    let monitor = snipping_current_area_monitor(app)?;
    snipping_set_active_area_monitor(app, Some(monitor.clone()))?;
    let window = ensure_snipping_overlay_window(app, &monitor)?;
    window
        .show()
        .map_err(|error| format!("Unable to show snipping overlay: {error}"))?;
    let _ = window.set_focus();

    Ok(json!({
        "kind": "snipping_area_started",
        "reason": reason,
        "shortcut": shortcut,
        "monitor": monitor,
    }))
}

fn snipping_hide_area_overlay(app: &AppHandle) {
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
    let scale_factor = snipping_area_capture_scale(&area_monitor, request.scale_factor);
    let selection_x = (request.x.max(0.0) * scale_factor).round() as u32;
    let selection_y = (request.y.max(0.0) * scale_factor).round() as u32;
    let selection_width = (request.width.max(0.0) * scale_factor).round() as u32;
    let selection_height = (request.height.max(0.0) * scale_factor).round() as u32;

    if selection_width < SNIPPING_MIN_AREA_PIXELS || selection_height < SNIPPING_MIN_AREA_PIXELS {
        snipping_set_active_area_monitor(app, None)?;
        snipping_close_area_overlay(app);
        return Err("Snip area is too small.".to_string());
    }

    let image_result = (|| -> Result<xcap::image::RgbaImage, String> {
        let monitor = xcap_monitor_for_area(&area_monitor)?;
        let monitor_width = monitor.width().unwrap_or(area_monitor.capture_width).max(1);
        let monitor_height = monitor.height().unwrap_or(area_monitor.capture_height).max(1);
        let x = selection_x.min(monitor_width.saturating_sub(1));
        let y = selection_y.min(monitor_height.saturating_sub(1));
        let width = selection_width.min(monitor_width.saturating_sub(x)).max(1);
        let height = selection_height.min(monitor_height.saturating_sub(y)).max(1);
        snipping_capture_area_image(app, &monitor, x, y, width, height)
    })();
    snipping_set_active_area_monitor(app, None)?;
    snipping_close_area_overlay(app);
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

#[tauri::command]
fn snipping_open_pinned_window(app: AppHandle, path: String) -> Result<Value, String> {
    snipping_open_floating_asset_window(
        &app,
        path,
        SNIPPING_PIN_WINDOW_PREFIX,
        "/snipping-pin",
        "Pinned Snip",
        460.0,
        340.0,
    )
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
fn snipping_copy_untracked_asset_to_clipboard(path: String) -> Result<Value, String> {
    snipping_copy_untracked_asset_to_clipboard_for(path)
}

#[tauri::command]
fn snipping_cancel_area_snip(app: AppHandle) -> Result<Value, String> {
    snipping_set_active_area_monitor(&app, None)?;
    snipping_close_area_overlay(&app);
    Ok(json!({
        "kind": "snipping_area_cancelled",
    }))
}

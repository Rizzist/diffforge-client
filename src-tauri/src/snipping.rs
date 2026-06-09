use xcap::{image::ImageFormat as XcapImageFormat, Monitor as XcapMonitor};

const SNIPPING_SHORTCUTS_CHANGED_EVENT: &str = "forge-snipping-shortcuts-changed";
const SNIPPING_CAPTURE_SAVED_EVENT: &str = "forge-snipping-capture-saved";
const SNIPPING_AREA_OVERLAY_WINDOW_LABEL: &str = "snipping-overlay";
const SNIPPING_SHORTCUT_SETTINGS_FILE: &str = "snipping-shortcuts.json";
const SNIPPING_CAPTURE_HIDE_OVERLAY_DELAY_MS: u64 = 120;
const SNIPPING_MIN_AREA_PIXELS: u32 = 8;
#[cfg(target_os = "macos")]
const MACOS_SCREEN_CAPTURE_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[derive(Clone)]
struct SnippingState {
    shortcut_manager: SnippingShortcutManager,
    active_area_monitor: Arc<StdMutex<Option<SnippingAreaMonitor>>>,
}

impl SnippingState {
    fn new() -> Self {
        Self {
            shortcut_manager: SnippingShortcutManager::new(),
            active_area_monitor: Arc::new(StdMutex::new(None)),
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

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnippingSettings {
    #[serde(default)]
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnippingAreaMonitor {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
}

fn default_snipping_settings() -> SnippingSettings {
    SnippingSettings {
        enabled: false,
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

fn register_snipping_shortcut_registration(
    app: &AppHandle,
    action: SnippingShortcutAction,
    shortcut: String,
) -> SnippingShortcutRegistration {
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
            return Ok(SnippingAreaMonitor {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
                scale_factor: monitor.scale_factor(),
            });
        }
    }

    let monitor = XcapMonitor::all()
        .map_err(|error| format!("Unable to list monitors: {error}"))?
        .into_iter()
        .find(|monitor| monitor.is_primary().unwrap_or(false))
        .or_else(|| XcapMonitor::all().ok().and_then(|mut monitors| monitors.drain(..).next()))
        .ok_or_else(|| "No monitor is available for snipping.".to_string())?;

    Ok(SnippingAreaMonitor {
        x: monitor.x().unwrap_or(0),
        y: monitor.y().unwrap_or(0),
        width: monitor.width().unwrap_or(1),
        height: monitor.height().unwrap_or(1),
        scale_factor: f64::from(monitor.scale_factor().unwrap_or(1.0)),
    })
}

fn xcap_monitor_for_area(area: &SnippingAreaMonitor) -> Result<XcapMonitor, String> {
    let center_x = area.x.saturating_add((area.width / 2).min(i32::MAX as u32) as i32);
    let center_y = area.y.saturating_add((area.height / 2).min(i32::MAX as u32) as i32);
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

fn snipping_save_image(
    app: &AppHandle,
    image: xcap::image::RgbaImage,
    mode: &str,
    reason: &str,
    shortcut: String,
) -> Result<Value, String> {
    let root = diffforge_prepare_untracked_asset_root()?;
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

    let item = diffforge_untracked_asset_item(&root, &target).ok();
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
        "saved_at_ms": cloud_mcp_now_ms(),
        "savedAtMs": cloud_mcp_now_ms(),
        "item": item,
        "library": diffforge_untracked_asset_library(None)?,
    });
    diffforge_emit_untracked_assets_updated(app, "snip-saved", payload.get("item").cloned());
    let _ = app.emit(SNIPPING_CAPTURE_SAVED_EVENT, payload.clone());
    Ok(payload)
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

fn snipping_finish_area_snip_for(
    app: &AppHandle,
    request: SnippingAreaSelectionRequest,
) -> Result<Value, String> {
    let area_monitor = snipping_active_area_monitor(app)?;
    let scale_factor = request.scale_factor.unwrap_or(area_monitor.scale_factor).max(0.1);
    let selection_x = (request.x.max(0.0) * scale_factor).round() as u32;
    let selection_y = (request.y.max(0.0) * scale_factor).round() as u32;
    let selection_width = (request.width.max(0.0) * scale_factor).round() as u32;
    let selection_height = (request.height.max(0.0) * scale_factor).round() as u32;

    if selection_width < SNIPPING_MIN_AREA_PIXELS || selection_height < SNIPPING_MIN_AREA_PIXELS {
        snipping_set_active_area_monitor(app, None)?;
        snipping_close_area_overlay(app);
        return Err("Snip area is too small.".to_string());
    }

    snipping_hide_area_overlay(app);
    thread::sleep(Duration::from_millis(SNIPPING_CAPTURE_HIDE_OVERLAY_DELAY_MS));

    let result = (|| -> Result<Value, String> {
        let monitor = xcap_monitor_for_area(&area_monitor)?;
        let monitor_width = monitor.width().unwrap_or(area_monitor.width).max(1);
        let monitor_height = monitor.height().unwrap_or(area_monitor.height).max(1);
        let x = selection_x.min(monitor_width.saturating_sub(1));
        let y = selection_y.min(monitor_height.saturating_sub(1));
        let width = selection_width.min(monitor_width.saturating_sub(x)).max(1);
        let height = selection_height.min(monitor_height.saturating_sub(y)).max(1);
        let image = monitor
            .capture_region(x, y, width, height)
            .map_err(|error| format!("Unable to capture selected area: {error}"))?;
        snipping_save_image(app, image, "area", "overlay", String::new())
    })();
    snipping_set_active_area_monitor(app, None)?;
    snipping_close_area_overlay(app);
    result
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
        let _ = macos_request_screen_capture_permission();
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
fn snipping_cancel_area_snip(app: AppHandle) -> Result<Value, String> {
    snipping_set_active_area_monitor(&app, None)?;
    snipping_close_area_overlay(&app);
    Ok(json!({
        "kind": "snipping_area_cancelled",
    }))
}

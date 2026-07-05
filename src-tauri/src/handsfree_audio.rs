const AUDIO_PUSH_TO_TALK_EVENT: &str = "forge-audio-push-to-talk";
const AUDIO_CANCEL_EVENT: &str = "forge-audio-cancel";
const AUDIO_SHORTCUTS_CHANGED_EVENT: &str = "forge-audio-shortcuts-changed";
const AUDIO_HOTKEY_ATTENTION_EVENT: &str = "forge-audio-hotkey-attention";
const AUDIO_SHORTCUT_SETTINGS_FILE: &str = "audio-shortcuts.json";
const AUDIO_HANDSFREE_INSERT_DELAY_MS: u64 = 160;
const AUDIO_FN_KEY_SHORTCUT: &str = "Fn";
#[cfg(target_os = "macos")]
const MACOS_ACCESSIBILITY_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
#[cfg(target_os = "macos")]
const MACOS_KEYBOARD_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.Keyboard-Settings.extension";
#[cfg(target_os = "macos")]
const MACOS_FN_KEY_CODE: u16 = 63;
#[cfg(target_os = "macos")]
const MACOS_HANDSFREE_AX_ERROR_NO_VALUE: i32 = -25212;
#[cfg(target_os = "macos")]
const MACOS_HANDSFREE_AX_ERROR_ATTRIBUTE_UNSUPPORTED: i32 = -25205;
#[cfg(target_os = "macos")]
const MACOS_HANDSFREE_AX_ERROR_UNTRUSTED: i32 = -40_001;
#[cfg(target_os = "macos")]
const MACOS_HANDSFREE_AX_ERROR_SYSTEM_WIDE_UNAVAILABLE: i32 = -40_002;
#[cfg(target_os = "macos")]
const MACOS_HANDSFREE_AX_ERROR_UNEXPECTED_ATTRIBUTE_TYPE: i32 = -40_003;

static AUDIO_PUSH_TO_TALK_IS_DOWN: AtomicBool = AtomicBool::new(false);
static AUDIO_FN_BINDING_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static AUDIO_FN_MONITORS_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static AUDIO_FN_KEY_IS_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static AUDIO_FN_MONITOR_APP: OnceLock<StdMutex<Option<AppHandle>>> = OnceLock::new();
#[cfg(target_os = "macos")]
static AUDIO_OPTION_MONITORS_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static AUDIO_OPTION_KEY_IS_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static AUDIO_OPTION_PTT_BINDING: OnceLock<StdMutex<Option<AudioOptionPushToTalkBinding>>> =
    OnceLock::new();

/// macOS 15 broke RegisterEventHotKey for combos whose only modifiers are
/// Option or Option+Shift (FB15168205): the Carbon hot key never fires, or
/// fires without a matching release. Those bindings get a parallel NSEvent
/// keyboard monitor; `handle_audio_push_to_talk_state` dedupes the two paths.
#[cfg(target_os = "macos")]
#[derive(Clone)]
struct AudioOptionPushToTalkBinding {
    shortcut: String,
    key_code: u16,
    require_shift: bool,
}
#[cfg(windows)]
static AUDIO_CONTEXT_MENU_HOOK_HANDLE: AtomicUsize = AtomicUsize::new(0);
#[cfg(windows)]
static AUDIO_CONTEXT_MENU_HOOK_APP: OnceLock<StdMutex<Option<AppHandle>>> = OnceLock::new();

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    static kAXTrustedCheckOptionPrompt: *const std::ffi::c_void;
    #[link_name = "AXUIElementCreateSystemWide"]
    fn handsfree_ax_ui_element_create_system_wide() -> *const std::ffi::c_void;
    #[link_name = "AXUIElementIsAttributeSettable"]
    fn handsfree_ax_ui_element_is_attribute_settable(
        element: *const std::ffi::c_void,
        attribute: *const std::ffi::c_void,
        settable: *mut std::os::raw::c_uchar,
    ) -> i32;
    #[link_name = "AXUIElementGetPid"]
    fn handsfree_ax_ui_element_get_pid(
        element: *const std::ffi::c_void,
        pid: *mut i32,
    ) -> i32;
    fn AXIsProcessTrusted() -> std::os::raw::c_uchar;
    fn AXIsProcessTrustedWithOptions(
        options: *const std::ffi::c_void,
    ) -> std::os::raw::c_uchar;
}

#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFBooleanTrue: *const std::ffi::c_void;
    fn CFDictionaryCreate(
        allocator: *const std::ffi::c_void,
        keys: *const *const std::ffi::c_void,
        values: *const *const std::ffi::c_void,
        num_values: isize,
        key_callbacks: *const std::ffi::c_void,
        value_callbacks: *const std::ffi::c_void,
    ) -> *const std::ffi::c_void;
    fn CFRelease(value: *const std::ffi::c_void);
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AudioShortcutAction {
    PushToTalk,
    Cancel,
}

impl AudioShortcutAction {
    fn from_request(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "push-to-talk" | "push_to_talk" | "pushtotalk" | "record" => Ok(Self::PushToTalk),
            "cancel" | "escape" | "dismiss" => Ok(Self::Cancel),
            _ => Err("Unknown audio shortcut action.".to_string()),
        }
    }

    fn default_shortcut(self) -> String {
        match self {
            Self::PushToTalk => default_audio_push_to_talk_shortcut().to_string(),
            Self::Cancel => "Escape".to_string(),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::PushToTalk => "hold-to-record",
            Self::Cancel => "cancel",
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioShortcutEvent {
    action: &'static str,
    shortcut: String,
    created_at_ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioPushToTalkEvent {
    phase: &'static str,
    pressed: bool,
    shortcut: String,
    created_at_ms: u64,
}

#[cfg(target_os = "macos")]
fn default_audio_push_to_talk_shortcut() -> &'static str {
    "Alt+KeyP"
}

#[cfg(windows)]
fn default_audio_push_to_talk_shortcut() -> &'static str {
    "ContextMenu"
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
fn default_audio_push_to_talk_shortcut() -> &'static str {
    "Alt+KeyP"
}

impl AudioShortcutRegistration {
    fn new(shortcut: String) -> Self {
        Self {
            shortcut,
            registered: false,
            error: None,
        }
    }
}

impl AudioShortcutManagerState {
    fn from_bindings(bindings: &AudioShortcutBindings) -> Self {
        Self {
            push_to_talk: AudioShortcutRegistration::new(bindings.push_to_talk.clone()),
            cancel: AudioShortcutRegistration::new(bindings.cancel.clone()),
        }
    }

    fn bindings(&self) -> AudioShortcutBindings {
        AudioShortcutBindings {
            push_to_talk: self.push_to_talk.shortcut.clone(),
            cancel: self.cancel.shortcut.clone(),
        }
    }

    fn registration(&self, action: AudioShortcutAction) -> AudioShortcutRegistration {
        match action {
            AudioShortcutAction::PushToTalk => self.push_to_talk.clone(),
            AudioShortcutAction::Cancel => self.cancel.clone(),
        }
    }

    fn set_registration(
        &mut self,
        action: AudioShortcutAction,
        registration: AudioShortcutRegistration,
    ) {
        match action {
            AudioShortcutAction::PushToTalk => self.push_to_talk = registration,
            AudioShortcutAction::Cancel => self.cancel = registration,
        }
    }
}

impl AudioShortcutManager {
    fn new() -> Self {
        let bindings = default_audio_shortcut_bindings();

        Self {
            state: Arc::new(StdMutex::new(AudioShortcutManagerState::from_bindings(
                &bindings,
            ))),
        }
    }

    fn snapshot(&self) -> AudioShortcutManagerState {
        self.state
            .lock()
            .map(|state| state.clone())
            .unwrap_or_else(|_| AudioShortcutManagerState::from_bindings(&default_audio_shortcut_bindings()))
    }

    fn replace(&self, state: AudioShortcutManagerState) {
        if let Ok(mut current_state) = self.state.lock() {
            *current_state = state;
        }
    }

    fn set_registration(
        &self,
        action: AudioShortcutAction,
        registration: AudioShortcutRegistration,
    ) {
        if let Ok(mut state) = self.state.lock() {
            state.set_registration(action, registration);
        }
    }
}

fn default_audio_shortcut_bindings() -> AudioShortcutBindings {
    AudioShortcutBindings {
        push_to_talk: AudioShortcutAction::PushToTalk.default_shortcut(),
        cancel: AudioShortcutAction::Cancel.default_shortcut(),
    }
}

fn audio_shortcut_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    device_data_path(
        app,
        Path::new(AUDIO_SHORTCUT_SETTINGS_FILE),
        DeviceDataMigrationStrategy::PreferNewest,
    )
}

#[cfg(target_os = "macos")]
fn macos_accessibility_permission_granted() -> bool {
    unsafe { AXIsProcessTrusted() != 0 }
}

#[cfg(target_os = "macos")]
fn macos_request_accessibility_permission() -> bool {
    unsafe {
        let keys = [kAXTrustedCheckOptionPrompt];
        let values = [kCFBooleanTrue];
        let options = CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            std::ptr::null(),
            std::ptr::null(),
        );
        let trusted = AXIsProcessTrustedWithOptions(options) != 0;

        if !options.is_null() {
            CFRelease(options);
        }

        trusted
    }
}

#[cfg(target_os = "macos")]
fn macos_app_bundle_or_executable_path() -> Option<PathBuf> {
    let executable = env::current_exe().ok()?;

    for ancestor in executable.ancestors() {
        if ancestor
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
        {
            return Some(ancestor.to_path_buf());
        }
    }

    Some(executable)
}

#[cfg(target_os = "macos")]
fn macos_quarantine_path() -> Option<PathBuf> {
    let path = macos_app_bundle_or_executable_path()?;
    let output = Command::new("xattr")
        .args(["-p", "com.apple.quarantine"])
        .arg(&path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    output.status.success().then_some(path)
}

#[cfg(target_os = "macos")]
fn macos_open_accessibility_settings() -> Result<(), String> {
    Command::new("open")
        .arg(MACOS_ACCESSIBILITY_SETTINGS_URL)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Unable to open macOS Accessibility settings: {error}"))
}

fn audio_shortcut_permission_status() -> AudioShortcutPermissionStatus {
    #[cfg(target_os = "macos")]
    {
        let accessibility_granted = macos_accessibility_permission_granted();
        let quarantine_path = macos_quarantine_path();
        let quarantine_path_label = quarantine_path
            .as_ref()
            .map(|path| path.display().to_string())
            .unwrap_or_default();
        let quarantine_fix_command = quarantine_path
            .as_ref()
            .map(|path| {
                format!(
                    "xattr -d com.apple.quarantine {}",
                    quote_shell_literal(&path.display().to_string())
                )
            })
            .unwrap_or_default();
        let message = if !accessibility_granted {
            "Enable Accessibility for Diff Forge AI, then restart the app.".to_string()
        } else if quarantine_path.is_some() {
            "Remove the macOS quarantine attribute, then restart the app.".to_string()
        } else {
            "Shortcut permissions look ready.".to_string()
        };

        return AudioShortcutPermissionStatus {
            platform: "macos",
            accessibility_required: true,
            accessibility_granted,
            accessibility_settings_url: MACOS_ACCESSIBILITY_SETTINGS_URL,
            quarantine_detected: quarantine_path.is_some(),
            quarantine_path: quarantine_path_label,
            quarantine_fix_command,
            message,
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        AudioShortcutPermissionStatus {
            platform: "other",
            accessibility_required: false,
            accessibility_granted: true,
            accessibility_settings_url: "",
            quarantine_detected: false,
            quarantine_path: String::new(),
            quarantine_fix_command: String::new(),
            message: String::new(),
        }
    }
}

fn parse_audio_shortcut_code(value: &str) -> Result<Code, String> {
    let token = value.trim();
    let compact = token
        .chars()
        .filter(|character| !matches!(character, ' ' | '-' | '_'))
        .collect::<String>()
        .to_ascii_uppercase();

    match compact.as_str() {
        "MENU" | "APPS" | "APPKEY" | "APPLICATION" | "CONTEXTMENU" => {
            return Ok(Code::ContextMenu);
        }
        "ESC" | "ESCAPE" => return Ok(Code::Escape),
        "RIGHTCOMMAND" | "RIGHTCMD" | "RIGHTMETA" | "METARIGHT" | "OSRIGHT" => {
            return Ok(Code::MetaRight);
        }
        "LEFTCOMMAND" | "LEFTCMD" | "LEFTMETA" | "METALEFT" | "OSLEFT" => {
            return Ok(Code::MetaLeft);
        }
        "RIGHTCONTROL" | "RIGHTCTRL" | "CONTROLRIGHT" | "CTRLRIGHT" => {
            return Ok(Code::ControlRight);
        }
        "LEFTCONTROL" | "LEFTCTRL" | "CONTROLLEFT" | "CTRLLEFT" => {
            return Ok(Code::ControlLeft);
        }
        "RIGHTALT" | "RIGHTOPTION" | "ALTRIGHT" | "OPTIONRIGHT" => {
            return Ok(Code::AltRight);
        }
        "LEFTALT" | "LEFTOPTION" | "ALTLEFT" | "OPTIONLEFT" => return Ok(Code::AltLeft),
        "RIGHTSHIFT" | "SHIFTRIGHT" => return Ok(Code::ShiftRight),
        "LEFTSHIFT" | "SHIFTLEFT" => return Ok(Code::ShiftLeft),
        "SPACEBAR" => return Ok(Code::Space),
        _ => {}
    }

    if compact.len() == 1 {
        let character = compact.chars().next().unwrap_or_default();

        if character.is_ascii_alphabetic() {
            return format!("Key{character}")
                .parse::<Code>()
                .map_err(|_| format!("Unsupported audio shortcut key: {value}"));
        }

        if character.is_ascii_digit() {
            return format!("Digit{character}")
                .parse::<Code>()
                .map_err(|_| format!("Unsupported audio shortcut key: {value}"));
        }
    }

    token
        .parse::<Code>()
        .map_err(|_| format!("Unsupported audio shortcut key: {value}"))
}

fn parse_audio_shortcut(value: &str) -> Result<Shortcut, String> {
    let shortcut = value.trim();

    if shortcut.is_empty() {
        return Err("Choose a key for this audio shortcut.".to_string());
    }

    if shortcut.chars().count() > 96 {
        return Err("Audio shortcuts are limited to 96 characters.".to_string());
    }

    let mut modifiers = Modifiers::empty();
    let mut key_token = None;

    for raw_token in shortcut.split('+') {
        let token = raw_token.trim();

        if token.is_empty() {
            return Err(format!("Invalid audio shortcut: {shortcut}"));
        }

        let normalized = token
            .chars()
            .filter(|character| !matches!(character, ' ' | '-' | '_'))
            .collect::<String>()
            .to_ascii_uppercase();

        match normalized.as_str() {
            "OPTION" | "ALT" => modifiers |= Modifiers::ALT,
            "CONTROL" | "CTRL" => modifiers |= Modifiers::CONTROL,
            "COMMAND" | "CMD" | "SUPER" | "META" => modifiers |= Modifiers::SUPER,
            "SHIFT" => modifiers |= Modifiers::SHIFT,
            "COMMANDORCONTROL" | "COMMANDORCTRL" | "CMDORCTRL" | "CMDORCONTROL" => {
                #[cfg(target_os = "macos")]
                {
                    modifiers |= Modifiers::SUPER;
                }
                #[cfg(not(target_os = "macos"))]
                {
                    modifiers |= Modifiers::CONTROL;
                }
            }
            _ => {
                if key_token.replace(token).is_some() {
                    return Err(format!("Audio shortcuts can only contain one key: {shortcut}"));
                }
            }
        }
    }

    let key = parse_audio_shortcut_code(
        key_token.ok_or_else(|| format!("Audio shortcut is missing a key: {shortcut}"))?,
    )?;

    Ok(Shortcut::new(Some(modifiers), key))
}

fn audio_shortcut_is_fn_key(shortcut: &str) -> bool {
    matches!(
        shortcut
            .trim()
            .replace([' ', '-', '_'], "")
            .to_ascii_uppercase()
            .as_str(),
        "FN" | "FNKEY" | "GLOBE" | "GLOBEKEY" | "FNGLOBE"
    )
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
fn audio_fn_key_unsupported_message() -> String {
    "Fn key capture is only available on macOS. Most Windows and Linux keyboards handle Fn in firmware, so bind another key and use Hybrid mode instead.".to_string()
}

fn normalize_audio_shortcut_text(value: &str) -> Result<String, String> {
    if audio_shortcut_is_fn_key(value) {
        return Ok(AUDIO_FN_KEY_SHORTCUT.to_string());
    }

    Ok(parse_audio_shortcut(value)?.into_string())
}

fn audio_shortcuts_conflict(left: &str, right: &str) -> bool {
    if audio_shortcut_is_fn_key(left) || audio_shortcut_is_fn_key(right) {
        return audio_shortcut_is_fn_key(left) && audio_shortcut_is_fn_key(right);
    }

    match (parse_audio_shortcut(left), parse_audio_shortcut(right)) {
        (Ok(left), Ok(right)) => left.id() == right.id(),
        _ => false,
    }
}

#[cfg(windows)]
fn audio_shortcut_is_bare_context_menu(shortcut: &str) -> bool {
    audio_shortcuts_conflict(shortcut, "ContextMenu")
}

fn audio_shortcut_has_explicit_modifier(shortcut: &str) -> bool {
    shortcut.split('+').any(|token| {
        matches!(
            token.trim().replace([' ', '-', '_'], "").to_ascii_uppercase().as_str(),
            "OPTION"
                | "ALT"
                | "CONTROL"
                | "CTRL"
                | "COMMAND"
                | "CMD"
                | "SUPER"
                | "META"
                | "SHIFT"
                | "COMMANDORCONTROL"
                | "COMMANDORCTRL"
                | "CMDORCTRL"
                | "CMDORCONTROL"
        )
    })
}

fn audio_cancel_shortcut_defers_global_registration(shortcut: &str) -> bool {
    !audio_shortcut_has_explicit_modifier(shortcut)
}

fn audio_shortcut_is_bare_escape(shortcut: &str) -> bool {
    matches!(
        shortcut.trim().replace([' ', '-', '_'], "").to_ascii_uppercase().as_str(),
        "ESC" | "ESCAPE"
    )
}

const AUDIO_SHORTCUT_MODIFIER_ALT_MASK: u8 = 1 << 0;
const AUDIO_SHORTCUT_MODIFIER_CONTROL_MASK: u8 = 1 << 1;
const AUDIO_SHORTCUT_MODIFIER_SUPER_MASK: u8 = 1 << 2;
const AUDIO_SHORTCUT_MODIFIER_SHIFT_MASK: u8 = 1 << 3;

fn audio_shortcut_modifier_mask(shortcut: &str) -> u8 {
    let mut mask = 0;

    for raw_token in shortcut.split('+') {
        let normalized = raw_token
            .trim()
            .chars()
            .filter(|character| !matches!(character, ' ' | '-' | '_'))
            .collect::<String>()
            .to_ascii_uppercase();

        match normalized.as_str() {
            "OPTION" | "ALT" => mask |= AUDIO_SHORTCUT_MODIFIER_ALT_MASK,
            "CONTROL" | "CTRL" => mask |= AUDIO_SHORTCUT_MODIFIER_CONTROL_MASK,
            "COMMAND" | "CMD" | "SUPER" | "META" => mask |= AUDIO_SHORTCUT_MODIFIER_SUPER_MASK,
            "SHIFT" => mask |= AUDIO_SHORTCUT_MODIFIER_SHIFT_MASK,
            "COMMANDORCONTROL" | "COMMANDORCTRL" | "CMDORCTRL" | "CMDORCONTROL" => {
                #[cfg(target_os = "macos")]
                {
                    mask |= AUDIO_SHORTCUT_MODIFIER_SUPER_MASK;
                }
                #[cfg(not(target_os = "macos"))]
                {
                    mask |= AUDIO_SHORTCUT_MODIFIER_CONTROL_MASK;
                }
            }
            _ => {}
        }
    }

    mask
}

fn escape_scope_allows_modifier_mask(
    event_modifier_mask: u8,
    audio_active: bool,
    push_to_talk_down: bool,
    push_to_talk_shortcut: &str,
) -> bool {
    if event_modifier_mask == 0 {
        return true;
    }

    if !audio_active || !push_to_talk_down {
        return false;
    }

    let push_to_talk_modifier_mask = audio_shortcut_modifier_mask(push_to_talk_shortcut);
    push_to_talk_modifier_mask != 0
        && (event_modifier_mask & !push_to_talk_modifier_mask) == 0
}

// ---------------------------------------------------------------------------
// Shared bare-Escape scope broker.
//
// Two features scope-register plain Escape globally: dictation cancel (while
// a take is active) and area-snip cancel (while selection overlays are up).
// They used to register and unregister the same accelerator independently,
// so whichever activated second silently stole the key, and whichever
// finished first unregistered it out from under the other — leaving Escape
// dead for the survivor until restart. The broker is the single owner: each
// feature toggles its scope bit, exactly one plugin registration lives while
// any bit is set, and a press routes by priority (visible snip overlays
// first, then the active dictation take).
// ---------------------------------------------------------------------------

static ESCAPE_SCOPE_AUDIO_ACTIVE: AtomicBool = AtomicBool::new(false);
static ESCAPE_SCOPE_SNIPPING_ACTIVE: AtomicBool = AtomicBool::new(false);
static ESCAPE_SCOPE_REGISTERED: AtomicBool = AtomicBool::new(false);
static ESCAPE_SCOPE_LAST_TRIGGER_MS: AtomicU64 = AtomicU64::new(0);

fn escape_scope_shortcut() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

fn escape_scope_any_active() -> bool {
    ESCAPE_SCOPE_AUDIO_ACTIVE.load(Ordering::Acquire)
        || ESCAPE_SCOPE_SNIPPING_ACTIVE.load(Ordering::Acquire)
}

/// One press, one cancel: the hotkey callback and the macOS key-monitor
/// fallback can both observe the same keystroke.
fn escape_scope_trigger_debounced(app: &AppHandle, source: &str) {
    let now = current_time_ms();
    let last = ESCAPE_SCOPE_LAST_TRIGGER_MS.swap(now, Ordering::AcqRel);
    if now.saturating_sub(last) < 250 {
        return;
    }
    log_audio_diagnostic_event(
        "audio.escape_scope.trigger",
        json!({
            "source": source,
            "audio_active": ESCAPE_SCOPE_AUDIO_ACTIVE.load(Ordering::Acquire),
            "snipping_active": ESCAPE_SCOPE_SNIPPING_ACTIVE.load(Ordering::Acquire),
        }),
    );
    if ESCAPE_SCOPE_SNIPPING_ACTIVE.load(Ordering::Acquire) {
        let app = app.clone();
        thread::spawn(move || {
            let _ = snipping_cancel_area_snip_for(&app);
        });
        return;
    }
    if ESCAPE_SCOPE_AUDIO_ACTIVE.load(Ordering::Acquire) {
        handle_audio_cancel_shortcut_state(
            app.clone(),
            ShortcutState::Pressed,
            "Escape".to_string(),
        );
    }
}

fn escape_scope_sync_registration(app: &AppHandle) {
    if escape_scope_any_active() {
        if ESCAPE_SCOPE_REGISTERED.swap(true, Ordering::AcqRel) {
            return;
        }
        // Defensive re-take: clears any stale handle (crashed scope, older
        // build) so this registration can never fail on "already registered".
        let _ = app.global_shortcut().unregister(escape_scope_shortcut());
        let registered = app.global_shortcut().on_shortcut(
            escape_scope_shortcut(),
            |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                escape_scope_trigger_debounced(app, "global_hotkey");
            },
        );
        if let Err(error) = registered {
            ESCAPE_SCOPE_REGISTERED.store(false, Ordering::Release);
            log_audio_diagnostic_event(
                "audio.escape_scope.register_error",
                json!({ "error": clean_whisper_local_audio_log_text(&error.to_string()) }),
            );
        } else {
            log_audio_diagnostic_event("audio.escape_scope.registered", json!({}));
        }
        // The macOS key monitors back up the hotkey regardless of whether it
        // registered: RegisterEventHotKey can also fail silently there.
        #[cfg(target_os = "macos")]
        escape_scope_install_macos_key_monitors(app);
    } else if ESCAPE_SCOPE_REGISTERED.swap(false, Ordering::AcqRel) {
        let _ = app.global_shortcut().unregister(escape_scope_shortcut());
        log_audio_diagnostic_event("audio.escape_scope.unregistered", json!({}));
    }
}

pub(crate) fn escape_scope_set_audio(app: &AppHandle, active: bool) {
    ESCAPE_SCOPE_AUDIO_ACTIVE.store(active, Ordering::Release);
    escape_scope_sync_registration(app);
}

pub(crate) fn escape_scope_set_snipping(app: &AppHandle, active: bool) {
    ESCAPE_SCOPE_SNIPPING_ACTIVE.store(active, Ordering::Release);
    escape_scope_sync_registration(app);
}

#[cfg(target_os = "macos")]
const MACOS_ESCAPE_KEY_CODE: u16 = 53;

#[cfg(target_os = "macos")]
static ESCAPE_SCOPE_MONITORS_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static ESCAPE_SCOPE_MONITOR_APP: OnceLock<StdMutex<Option<AppHandle>>> = OnceLock::new();

/// Returns true when the event is an Escape press this broker consumed.
/// Modifier combos pass through, except while a recording shortcut is still
/// held; then Escape plus that shortcut's modifiers still means cancel.
#[cfg(target_os = "macos")]
fn escape_scope_handle_monitor_event(event: &objc2_app_kit::NSEvent) -> bool {
    if !escape_scope_any_active() {
        return false;
    }
    if event.r#type() != objc2_app_kit::NSEventType::KeyDown {
        return false;
    }
    if event.keyCode() != MACOS_ESCAPE_KEY_CODE {
        return false;
    }
    let Some(app) = ESCAPE_SCOPE_MONITOR_APP
        .get()
        .and_then(|slot| slot.lock().ok().and_then(|guard| guard.clone()))
    else {
        return false;
    };
    let flags = event.modifierFlags();
    let mut event_modifier_mask = 0;
    if flags.contains(objc2_app_kit::NSEventModifierFlags::Option) {
        event_modifier_mask |= AUDIO_SHORTCUT_MODIFIER_ALT_MASK;
    }
    if flags.contains(objc2_app_kit::NSEventModifierFlags::Control) {
        event_modifier_mask |= AUDIO_SHORTCUT_MODIFIER_CONTROL_MASK;
    }
    if flags.contains(objc2_app_kit::NSEventModifierFlags::Command) {
        event_modifier_mask |= AUDIO_SHORTCUT_MODIFIER_SUPER_MASK;
    }
    if flags.contains(objc2_app_kit::NSEventModifierFlags::Shift) {
        event_modifier_mask |= AUDIO_SHORTCUT_MODIFIER_SHIFT_MASK;
    }
    if !escape_scope_allows_modifier_mask(
        event_modifier_mask,
        ESCAPE_SCOPE_AUDIO_ACTIVE.load(Ordering::Acquire),
        AUDIO_PUSH_TO_TALK_IS_DOWN.load(Ordering::Acquire),
        &audio_push_to_talk_shortcut_for(&app),
    ) {
        return false;
    }
    escape_scope_trigger_debounced(&app, "macos_key_monitor");
    true
}

/// macOS belt-and-suspenders: RegisterEventHotKey has silently stopped
/// delivering some registrations on macOS 15 (this codebase already works
/// around Option-only and Fn bindings with NSEvent monitors). The same
/// fallback covers scoped Escape: app-lifetime global+local key monitors
/// fire the broker while a scope is active — the local monitor swallows the
/// key inside Diff Forge windows; system-wide consumption still comes from
/// the hotkey whenever it is healthy.
#[cfg(target_os = "macos")]
fn escape_scope_install_macos_key_monitors(app: &AppHandle) {
    let app_slot = ESCAPE_SCOPE_MONITOR_APP.get_or_init(|| StdMutex::new(None));
    if let Ok(mut slot) = app_slot.lock() {
        *slot = Some(app.clone());
    }
    if ESCAPE_SCOPE_MONITORS_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = app.run_on_main_thread(move || {
        use objc2_app_kit::{NSEvent, NSEventMask};

        let mask = NSEventMask::KeyDown;

        let global_block = block2::RcBlock::new(
            move |event: std::ptr::NonNull<objc2_app_kit::NSEvent>| {
                let _ = escape_scope_handle_monitor_event(unsafe { event.as_ref() });
            },
        );
        if let Some(token) =
            NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global_block)
        {
            std::mem::forget(token);
        }

        let local_block = block2::RcBlock::new(
            move |event: std::ptr::NonNull<objc2_app_kit::NSEvent>| -> *mut objc2_app_kit::NSEvent {
                if escape_scope_handle_monitor_event(unsafe { event.as_ref() }) {
                    return std::ptr::null_mut();
                }
                event.as_ptr()
            },
        );
        if let Some(token) =
            unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local_block) }
        {
            std::mem::forget(token);
        }

        log_audio_diagnostic_event("audio.escape_scope.monitors_installed", json!({}));
    });
}

/// Tracks whether a deferred bare-key cancel shortcut (typically plain
/// Escape) is currently scope-registered as a global shortcut.
static AUDIO_CANCEL_SCOPE_REGISTERED: AtomicBool = AtomicBool::new(false);

/// Scope-registers a bare cancel shortcut globally only while the audio
/// widget has an active take. Bare keys must never be swallowed system-wide
/// while idle, so startup registration defers them (see
/// `audio_cancel_shortcut_defers_global_registration`); the widget calls this
/// when it enters/leaves arming/recording/transcribing so ESC cancels even
/// when another app or terminal has keyboard focus.
#[tauri::command]
fn audio_cancel_shortcut_scope(app: AppHandle, active: bool) -> Result<(), String> {
    let manager = app.state::<AudioState>().shortcut_manager.clone();
    let cancel = manager.snapshot().registration(AudioShortcutAction::Cancel);
    let shortcut = cancel.shortcut;
    if !audio_cancel_shortcut_defers_global_registration(&shortcut) {
        // Modifier shortcuts are globally registered at startup already.
        return Ok(());
    }
    if audio_shortcut_is_bare_escape(&shortcut) {
        // Plain Escape is shared with the snipping overlay: the broker owns
        // the single registration and routes presses by scope priority.
        escape_scope_set_audio(&app, active);
        return Ok(());
    }
    if active {
        if AUDIO_CANCEL_SCOPE_REGISTERED.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        if let Err(error) =
            register_audio_shortcut_handler(&app, AudioShortcutAction::Cancel, &shortcut)
        {
            AUDIO_CANCEL_SCOPE_REGISTERED.store(false, Ordering::Release);
            log_audio_diagnostic_event(
                "audio.shortcut.cancel_scope.register_error",
                json!({
                    "shortcut": shortcut,
                    "error": clean_whisper_local_audio_log_text(&error),
                }),
            );
            return Err(error);
        }
        log_audio_diagnostic_event(
            "audio.shortcut.cancel_scope.registered",
            json!({ "shortcut": shortcut }),
        );
    } else if AUDIO_CANCEL_SCOPE_REGISTERED.swap(false, Ordering::AcqRel) {
        unregister_audio_shortcut(&app, &shortcut);
        log_audio_diagnostic_event(
            "audio.shortcut.cancel_scope.unregistered",
            json!({ "shortcut": shortcut }),
        );
    }
    Ok(())
}

fn deferred_audio_cancel_registration(shortcut: String) -> AudioShortcutRegistration {
    AudioShortcutRegistration {
        shortcut,
        registered: true,
        error: None,
    }
}

#[cfg(target_os = "macos")]
fn macos_push_to_talk_shortcut_needs_modifier(shortcut: &str) -> bool {
    !shortcut.split('+').any(|token| {
        matches!(
            token.trim().to_ascii_uppercase().as_str(),
            "OPTION"
                | "ALT"
                | "CONTROL"
                | "CTRL"
                | "COMMAND"
                | "CMD"
                | "SUPER"
                | "META"
                | "SHIFT"
                | "COMMANDORCONTROL"
                | "COMMANDORCTRL"
                | "CMDORCTRL"
                | "CMDORCONTROL"
        )
    })
}

#[cfg(not(target_os = "macos"))]
fn macos_push_to_talk_shortcut_needs_modifier(_shortcut: &str) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn macos_push_to_talk_shortcut_is_reserved(shortcut: &str) -> bool {
    let tokens = shortcut
        .split('+')
        .map(|token| token.trim().replace([' ', '-', '_'], "").to_ascii_uppercase())
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();

    (tokens.len() == 2 && tokens[0] == "ALT" && tokens[1] == "SPACE")
        || (tokens.len() == 3
            && (tokens[0] == "CONTROL" || tokens[0] == "CTRL")
            && tokens[1] == "ALT"
            && tokens[2] == "SPACE")
}

#[cfg(not(target_os = "macos"))]
fn macos_push_to_talk_shortcut_is_reserved(_shortcut: &str) -> bool {
    false
}

fn validate_audio_shortcut_for_action(
    action: AudioShortcutAction,
    shortcut: &str,
) -> Result<(), String> {
    if audio_shortcut_is_fn_key(shortcut) {
        if action != AudioShortcutAction::PushToTalk {
            return Err("The Fn (Globe) key can only drive the record shortcut.".to_string());
        }

        #[cfg(target_os = "macos")]
        return Ok(());
        #[cfg(not(target_os = "macos"))]
        return Err(audio_fn_key_unsupported_message());
    }

    if action == AudioShortcutAction::PushToTalk
        && macos_push_to_talk_shortcut_needs_modifier(shortcut)
    {
        return Err(
            "macOS hold-to-record needs a modifier shortcut, like Option+P.".to_string(),
        );
    }

    if action == AudioShortcutAction::PushToTalk
        && macos_push_to_talk_shortcut_is_reserved(shortcut)
    {
        return Err(
            "Space-based Option shortcuts are unreliable on macOS. Use Option+P instead."
                .to_string(),
        );
    }

    Ok(())
}

#[cfg(windows)]
fn audio_shortcut_uses_windows_context_menu_hook(
    action: AudioShortcutAction,
    shortcut: &str,
) -> bool {
    action == AudioShortcutAction::PushToTalk && audio_shortcut_is_bare_context_menu(shortcut)
}

#[cfg(not(windows))]
fn audio_shortcut_uses_windows_context_menu_hook(
    _action: AudioShortcutAction,
    _shortcut: &str,
) -> bool {
    false
}

fn sanitized_audio_shortcut_bindings(bindings: AudioShortcutBindings) -> AudioShortcutBindings {
    let defaults = default_audio_shortcut_bindings();
    let mut push_to_talk = normalize_audio_shortcut_text(&bindings.push_to_talk)
        .unwrap_or_else(|_| defaults.push_to_talk.clone());
    let mut cancel = normalize_audio_shortcut_text(&bindings.cancel)
        .unwrap_or_else(|_| defaults.cancel.clone());

    if validate_audio_shortcut_for_action(AudioShortcutAction::PushToTalk, &push_to_talk).is_err()
    {
        push_to_talk = defaults.push_to_talk;
    }

    if audio_shortcuts_conflict(&push_to_talk, &cancel) {
        cancel = defaults.cancel;
    }

    AudioShortcutBindings {
        push_to_talk,
        cancel,
    }
}

fn read_audio_shortcut_bindings(app: &AppHandle) -> AudioShortcutBindings {
    let Ok(path) = audio_shortcut_settings_path(app) else {
        return default_audio_shortcut_bindings();
    };

    let Ok(contents) = fs::read_to_string(path) else {
        return default_audio_shortcut_bindings();
    };

    serde_json::from_str::<AudioShortcutBindings>(&contents)
        .map(sanitized_audio_shortcut_bindings)
        .unwrap_or_else(|_| default_audio_shortcut_bindings())
}

fn write_audio_shortcut_bindings(
    app: &AppHandle,
    bindings: &AudioShortcutBindings,
) -> Result<(), String> {
    let path = audio_shortcut_settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to save audio shortcuts: {error}"))?;
    }

    let contents = serde_json::to_string_pretty(bindings)
        .map_err(|error| format!("Unable to save audio shortcuts: {error}"))?;
    fs::write(path, contents).map_err(|error| format!("Unable to save audio shortcuts: {error}"))
}

fn audio_shortcut_registration_status(
    action: AudioShortcutAction,
    registration: AudioShortcutRegistration,
) -> AudioShortcutRegistrationStatus {
    AudioShortcutRegistrationStatus {
        shortcut: registration.shortcut,
        default_shortcut: action.default_shortcut(),
        registered: registration.registered,
        error: registration.error,
    }
}

fn audio_shortcuts_status_from_state(
    state: AudioShortcutManagerState,
) -> AudioShortcutSettingsStatus {
    AudioShortcutSettingsStatus {
        push_to_talk: audio_shortcut_registration_status(
            AudioShortcutAction::PushToTalk,
            state.push_to_talk,
        ),
        cancel: audio_shortcut_registration_status(AudioShortcutAction::Cancel, state.cancel),
        permissions: audio_shortcut_permission_status(),
    }
}

fn audio_shortcuts_status_for(app: &AppHandle) -> AudioShortcutSettingsStatus {
    let manager = app.state::<AudioState>().shortcut_manager.clone();
    audio_shortcuts_status_from_state(manager.snapshot())
}

fn audio_push_to_talk_shortcut_for(app: &AppHandle) -> String {
    audio_shortcuts_status_for(app).push_to_talk.shortcut
}

#[cfg(windows)]
fn audio_push_to_talk_uses_context_menu(app: &AppHandle) -> bool {
    audio_shortcut_is_bare_context_menu(&audio_push_to_talk_shortcut_for(app))
}

fn audio_shortcut_state_label(state: &ShortcutState) -> &'static str {
    match state {
        ShortcutState::Pressed => "pressed",
        ShortcutState::Released => "released",
    }
}

fn emit_audio_shortcuts_changed(app: &AppHandle) {
    match app.emit(AUDIO_SHORTCUTS_CHANGED_EVENT, audio_shortcuts_status_for(app)) {
        Ok(()) => log_audio_diagnostic_event("audio.shortcuts.changed.emit_done", json!({})),
        Err(error) => log_audio_diagnostic_event(
            "audio.shortcuts.changed.emit_error",
            json!({
                "error": clean_whisper_local_audio_log_text(&error.to_string()),
            }),
        ),
    }
}

fn register_audio_shortcut_handler(
    app: &AppHandle,
    action: AudioShortcutAction,
    shortcut_text: &str,
) -> Result<(), String> {
    let shortcut = parse_audio_shortcut(shortcut_text)?;

    match action {
        AudioShortcutAction::PushToTalk => app
            .global_shortcut()
            .on_shortcut(shortcut, |app, shortcut, event| {
                let shortcut = shortcut.into_string();
                log_audio_diagnostic_event(
                    "audio.ptt.shortcut.callback",
                    json!({
                        "shortcut": shortcut,
                        "state": audio_shortcut_state_label(&event.state),
                    }),
                );
                let handled =
                    handle_audio_push_to_talk_state(app.clone(), event.state, shortcut.clone());
                log_audio_diagnostic_event(
                    "audio.ptt.shortcut.callback_done",
                    json!({
                        "shortcut": shortcut,
                        "state": audio_shortcut_state_label(&event.state),
                        "handled": handled,
                    }),
                );
            })
            .map_err(|error| format!("Unable to register hold-to-record shortcut: {error}")),
        AudioShortcutAction::Cancel => app
            .global_shortcut()
            .on_shortcut(shortcut, |app, shortcut, event| {
                let shortcut = shortcut.into_string();
                log_audio_diagnostic_event(
                    "audio.ptt.cancel_shortcut.callback",
                    json!({
                        "shortcut": shortcut,
                        "state": audio_shortcut_state_label(&event.state),
                    }),
                );
                handle_audio_cancel_shortcut_state(app.clone(), event.state, shortcut.clone());
                log_audio_diagnostic_event(
                    "audio.ptt.cancel_shortcut.callback_done",
                    json!({
                        "shortcut": shortcut,
                        "state": audio_shortcut_state_label(&event.state),
                    }),
                );
            })
            .map_err(|error| format!("Unable to register cancel shortcut: {error}")),
    }
}

fn unregister_audio_shortcut(app: &AppHandle, shortcut_text: &str) {
    if audio_shortcut_is_fn_key(shortcut_text) {
        AUDIO_FN_BINDING_ACTIVE.store(false, Ordering::Release);
        log_audio_diagnostic_event(
            "audio.shortcut.unregister_fn_done",
            json!({
                "shortcut": shortcut_text,
            }),
        );
        return;
    }

    match parse_audio_shortcut(shortcut_text) {
        Ok(shortcut) => {
            let result = app.global_shortcut().unregister(shortcut);
            match result {
                Ok(()) => log_audio_diagnostic_event(
                    "audio.shortcut.unregister_done",
                    json!({
                        "shortcut": shortcut_text,
                    }),
                ),
                Err(error) => log_audio_diagnostic_event(
                    "audio.shortcut.unregister_error",
                    json!({
                        "shortcut": shortcut_text,
                        "error": clean_whisper_local_audio_log_text(&error.to_string()),
                    }),
                ),
            }
        }
        Err(error) => log_audio_diagnostic_event(
            "audio.shortcut.unregister_parse_error",
            json!({
                "shortcut": shortcut_text,
                "error": clean_whisper_local_audio_log_text(&error),
            }),
        ),
    }
}

fn register_audio_shortcut_registration(
    app: &AppHandle,
    action: AudioShortcutAction,
    shortcut: String,
) -> AudioShortcutRegistration {
    log_audio_diagnostic_event(
        "audio.shortcut.register.start",
        json!({
            "action": action.label(),
            "shortcut": shortcut,
            "is_ptt_down": AUDIO_PUSH_TO_TALK_IS_DOWN.load(Ordering::Acquire),
        }),
    );

    if action == AudioShortcutAction::Cancel
        && audio_cancel_shortcut_defers_global_registration(&shortcut)
        && !AUDIO_PUSH_TO_TALK_IS_DOWN.load(Ordering::Acquire)
    {
        log_audio_diagnostic_event(
            "audio.shortcut.register.deferred_cancel",
            json!({
                "shortcut": shortcut,
            }),
        );
        return deferred_audio_cancel_registration(shortcut);
    }

    #[cfg(target_os = "macos")]
    if action == AudioShortcutAction::PushToTalk {
        sync_macos_option_push_to_talk_binding(app, &shortcut);
    }

    if audio_shortcut_is_fn_key(&shortcut) {
        return register_audio_fn_key_registration(app, action, shortcut);
    }

    if audio_shortcut_uses_windows_context_menu_hook(action, &shortcut) {
        return match register_audio_context_menu_keyboard_hook(app) {
            Ok(()) => {
                log_audio_diagnostic_event(
                    "audio.shortcut.register.context_menu_hook_done",
                    json!({
                        "action": action.label(),
                        "shortcut": shortcut,
                    }),
                );
                AudioShortcutRegistration {
                    shortcut,
                    registered: true,
                    error: None,
                }
            }
            Err(error) => {
                log_audio_diagnostic_event(
                    "audio.shortcut.register.context_menu_hook_error",
                    json!({
                        "action": action.label(),
                        "shortcut": shortcut,
                        "error": clean_whisper_local_audio_log_text(&error),
                    }),
                );
                AudioShortcutRegistration {
                    shortcut,
                    registered: false,
                    error: Some(error),
                }
            }
        };
    }

    match register_audio_shortcut_handler(app, action, &shortcut) {
        Ok(()) => {
            log_audio_diagnostic_event(
                "audio.shortcut.register.done",
                json!({
                    "action": action.label(),
                    "shortcut": shortcut,
                }),
            );
            AudioShortcutRegistration {
                shortcut,
                registered: true,
                error: None,
            }
        }
        Err(error) => {
            log_audio_diagnostic_event(
                "audio.shortcut.register.error",
                json!({
                    "action": action.label(),
                    "shortcut": shortcut,
                    "error": clean_whisper_local_audio_log_text(&error),
                }),
            );
            AudioShortcutRegistration {
                shortcut,
                registered: false,
                error: Some(error),
            }
        }
    }
}

fn register_audio_fn_key_registration(
    app: &AppHandle,
    action: AudioShortcutAction,
    shortcut: String,
) -> AudioShortcutRegistration {
    if action != AudioShortcutAction::PushToTalk {
        return AudioShortcutRegistration {
            shortcut,
            registered: false,
            error: Some("The Fn (Globe) key can only drive the record shortcut.".to_string()),
        };
    }

    #[cfg(target_os = "macos")]
    {
        register_audio_fn_key_monitors(app);
        AUDIO_FN_BINDING_ACTIVE.store(true, Ordering::Release);
        log_audio_diagnostic_event(
            "audio.shortcut.register.fn_done",
            json!({
                "shortcut": shortcut,
            }),
        );

        AudioShortcutRegistration {
            shortcut,
            registered: true,
            error: None,
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        AudioShortcutRegistration {
            shortcut,
            registered: false,
            error: Some(audio_fn_key_unsupported_message()),
        }
    }
}

/// Emits a quiet gesture abort: another key was pressed while Fn was held, so
/// this is an OS combo (fn+arrow, fn+backspace, ...) rather than a record
/// gesture. The widget discards the capture without saving anything.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn emit_audio_push_to_talk_abort(app: &AppHandle) {
    if !AUDIO_PUSH_TO_TALK_IS_DOWN.swap(false, Ordering::AcqRel) {
        return;
    }

    emit_audio_push_to_talk_event(app, "aborted", false, AUDIO_FN_KEY_SHORTCUT.to_string());
}

#[cfg(target_os = "macos")]
fn audio_fn_monitor_app_handle() -> Option<AppHandle> {
    AUDIO_FN_MONITOR_APP
        .get()
        .and_then(|app_handle| app_handle.lock().ok().and_then(|guard| guard.clone()))
}

#[cfg(target_os = "macos")]
fn audio_fn_handle_monitor_event(event: &objc2_app_kit::NSEvent) {
    if !AUDIO_FN_BINDING_ACTIVE.load(Ordering::Acquire) {
        return;
    }

    let Some(app) = audio_fn_monitor_app_handle() else {
        return;
    };

    let event_type = event.r#type();

    if event_type == objc2_app_kit::NSEventType::FlagsChanged {
        if event.keyCode() != MACOS_FN_KEY_CODE {
            return;
        }

        let pressed = event
            .modifierFlags()
            .contains(objc2_app_kit::NSEventModifierFlags::Function);
        if pressed == AUDIO_FN_KEY_IS_DOWN.swap(pressed, Ordering::AcqRel) {
            return;
        }

        let state = if pressed {
            ShortcutState::Pressed
        } else {
            ShortcutState::Released
        };
        log_audio_diagnostic_event(
            "audio.ptt.fn_monitor.flags_changed",
            json!({
                "pressed": pressed,
            }),
        );
        let _ = handle_audio_push_to_talk_state(app, state, AUDIO_FN_KEY_SHORTCUT.to_string());
        return;
    }

    if event_type == objc2_app_kit::NSEventType::KeyDown
        && AUDIO_FN_KEY_IS_DOWN.load(Ordering::Acquire)
    {
        log_audio_diagnostic_event("audio.ptt.fn_monitor.combo_abort", json!({}));
        emit_audio_push_to_talk_abort(&app);
    }
}

#[cfg(target_os = "macos")]
fn register_audio_fn_key_monitors(app: &AppHandle) {
    let app_slot = AUDIO_FN_MONITOR_APP.get_or_init(|| StdMutex::new(None));
    if let Ok(mut slot) = app_slot.lock() {
        *slot = Some(app.clone());
    }

    if AUDIO_FN_MONITORS_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let _ = app.run_on_main_thread(move || {
        use objc2_app_kit::{NSEvent, NSEventMask};

        let mask = NSEventMask::FlagsChanged | NSEventMask::KeyDown;

        let global_block = block2::RcBlock::new(
            move |event: std::ptr::NonNull<objc2_app_kit::NSEvent>| {
                audio_fn_handle_monitor_event(unsafe { event.as_ref() });
            },
        );
        if let Some(token) =
            NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global_block)
        {
            // The monitors live for the app's lifetime.
            std::mem::forget(token);
        }

        let local_block = block2::RcBlock::new(
            move |event: std::ptr::NonNull<objc2_app_kit::NSEvent>| -> *mut objc2_app_kit::NSEvent {
                audio_fn_handle_monitor_event(unsafe { event.as_ref() });
                event.as_ptr()
            },
        );
        let local_token = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local_block)
        };
        if let Some(token) = local_token {
            std::mem::forget(token);
        }

        log_audio_diagnostic_event("audio.ptt.fn_monitor.installed", json!({}));
    });
}

#[cfg(target_os = "macos")]
fn macos_virtual_key_code_for_shortcut_key(token: &str) -> Option<u16> {
    let compact = token.trim().replace([' ', '-', '_'], "").to_ascii_uppercase();

    let key_code = match compact.as_str() {
        "KEYA" | "A" => 0,
        "KEYS" | "S" => 1,
        "KEYD" | "D" => 2,
        "KEYF" | "F" => 3,
        "KEYH" | "H" => 4,
        "KEYG" | "G" => 5,
        "KEYZ" | "Z" => 6,
        "KEYX" | "X" => 7,
        "KEYC" | "C" => 8,
        "KEYV" | "V" => 9,
        "KEYB" | "B" => 11,
        "KEYQ" | "Q" => 12,
        "KEYW" | "W" => 13,
        "KEYE" | "E" => 14,
        "KEYR" | "R" => 15,
        "KEYY" | "Y" => 16,
        "KEYT" | "T" => 17,
        "DIGIT1" | "1" => 18,
        "DIGIT2" | "2" => 19,
        "DIGIT3" | "3" => 20,
        "DIGIT4" | "4" => 21,
        "DIGIT6" | "6" => 22,
        "DIGIT5" | "5" => 23,
        "EQUAL" => 24,
        "DIGIT9" | "9" => 25,
        "DIGIT7" | "7" => 26,
        "MINUS" => 27,
        "DIGIT8" | "8" => 28,
        "DIGIT0" | "0" => 29,
        "BRACKETRIGHT" | "RIGHTBRACKET" => 30,
        "KEYO" | "O" => 31,
        "KEYU" | "U" => 32,
        "BRACKETLEFT" | "LEFTBRACKET" => 33,
        "KEYI" | "I" => 34,
        "KEYP" | "P" => 35,
        "ENTER" | "RETURN" => 36,
        "KEYL" | "L" => 37,
        "KEYJ" | "J" => 38,
        "QUOTE" => 39,
        "KEYK" | "K" => 40,
        "SEMICOLON" => 41,
        "BACKSLASH" => 42,
        "COMMA" => 43,
        "SLASH" => 44,
        "KEYN" | "N" => 45,
        "KEYM" | "M" => 46,
        "PERIOD" | "DOT" => 47,
        "TAB" => 48,
        "SPACE" => 49,
        "BACKQUOTE" | "GRAVE" => 50,
        "BACKSPACE" => 51,
        "F1" => 122,
        "F2" => 120,
        "F3" => 99,
        "F4" => 118,
        "F5" => 96,
        "F6" => 97,
        "F7" => 98,
        "F8" => 100,
        "F9" => 101,
        "F10" => 109,
        "F11" => 103,
        "F12" => 111,
        "ARROWLEFT" | "LEFT" => 123,
        "ARROWRIGHT" | "RIGHT" => 124,
        "ARROWDOWN" | "DOWN" => 125,
        "ARROWUP" | "UP" => 126,
        _ => return None,
    };

    Some(key_code)
}

/// Builds the NSEvent-monitor binding for a push-to-talk shortcut whose
/// modifier set hits the macOS 15 Option/Option+Shift hot key regression.
/// Returns None for combos Carbon still handles reliably.
#[cfg(target_os = "macos")]
fn macos_option_push_to_talk_binding(shortcut: &str) -> Option<AudioOptionPushToTalkBinding> {
    let mut has_option = false;
    let mut has_shift = false;
    let mut key_token: Option<String> = None;

    for token in shortcut.split('+') {
        let compact = token.trim().replace([' ', '-', '_'], "").to_ascii_uppercase();
        match compact.as_str() {
            "" => continue,
            "ALT" | "OPTION" => has_option = true,
            "SHIFT" => has_shift = true,
            "CONTROL" | "CTRL" | "COMMAND" | "CMD" | "SUPER" | "META" | "COMMANDORCONTROL"
            | "COMMANDORCTRL" | "CMDORCTRL" | "CMDORCONTROL" => return None,
            _ => {
                if key_token.replace(compact).is_some() {
                    return None;
                }
            }
        }
    }

    if !has_option {
        return None;
    }

    Some(AudioOptionPushToTalkBinding {
        shortcut: shortcut.to_string(),
        key_code: macos_virtual_key_code_for_shortcut_key(&key_token?)?,
        require_shift: has_shift,
    })
}

#[cfg(target_os = "macos")]
fn audio_option_active_binding() -> Option<AudioOptionPushToTalkBinding> {
    AUDIO_OPTION_PTT_BINDING
        .get()
        .and_then(|slot| slot.lock().ok().and_then(|guard| guard.clone()))
}

/// Returns true when the event matched the active Option binding and became a
/// push-to-talk gesture, so the local monitor can swallow the keystroke
/// instead of letting it type into the focused field.
#[cfg(target_os = "macos")]
fn audio_option_handle_monitor_event(event: &objc2_app_kit::NSEvent) -> bool {
    let Some(binding) = audio_option_active_binding() else {
        return false;
    };

    let Some(app) = audio_fn_monitor_app_handle() else {
        return false;
    };

    use objc2_app_kit::{NSEventModifierFlags, NSEventType};

    let event_type = event.r#type();

    if event_type == NSEventType::KeyDown {
        if event.keyCode() != binding.key_code {
            return false;
        }

        let flags = event.modifierFlags();
        let modifiers_match = flags.contains(NSEventModifierFlags::Option)
            && !flags.contains(NSEventModifierFlags::Command)
            && !flags.contains(NSEventModifierFlags::Control)
            && flags.contains(NSEventModifierFlags::Shift) == binding.require_shift;
        if !modifiers_match {
            return false;
        }

        if AUDIO_OPTION_KEY_IS_DOWN.swap(true, Ordering::AcqRel) {
            // Key auto-repeat while held.
            return true;
        }

        log_audio_diagnostic_event(
            "audio.ptt.option_monitor.key_down",
            json!({
                "shortcut": binding.shortcut,
            }),
        );
        let _ = handle_audio_push_to_talk_state(app, ShortcutState::Pressed, binding.shortcut);
        return true;
    }

    if event_type == NSEventType::KeyUp {
        if event.keyCode() != binding.key_code
            || !AUDIO_OPTION_KEY_IS_DOWN.swap(false, Ordering::AcqRel)
        {
            return false;
        }

        log_audio_diagnostic_event(
            "audio.ptt.option_monitor.key_up",
            json!({
                "shortcut": binding.shortcut,
            }),
        );
        let _ = handle_audio_push_to_talk_state(app, ShortcutState::Released, binding.shortcut);
        return true;
    }

    if event_type == NSEventType::FlagsChanged
        && AUDIO_OPTION_KEY_IS_DOWN.load(Ordering::Acquire)
        && !event
            .modifierFlags()
            .contains(NSEventModifierFlags::Option)
    {
        // Option released before the key: end the hold gesture now.
        AUDIO_OPTION_KEY_IS_DOWN.store(false, Ordering::Release);
        log_audio_diagnostic_event(
            "audio.ptt.option_monitor.option_released",
            json!({
                "shortcut": binding.shortcut,
            }),
        );
        let _ = handle_audio_push_to_talk_state(app, ShortcutState::Released, binding.shortcut);
    }

    false
}

#[cfg(target_os = "macos")]
fn register_audio_option_key_monitors(app: &AppHandle) {
    let app_slot = AUDIO_FN_MONITOR_APP.get_or_init(|| StdMutex::new(None));
    if let Ok(mut slot) = app_slot.lock() {
        *slot = Some(app.clone());
    }

    if AUDIO_OPTION_MONITORS_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let _ = app.run_on_main_thread(move || {
        use objc2_app_kit::{NSEvent, NSEventMask};

        let mask = NSEventMask::KeyDown | NSEventMask::KeyUp | NSEventMask::FlagsChanged;

        let global_block = block2::RcBlock::new(
            move |event: std::ptr::NonNull<objc2_app_kit::NSEvent>| {
                let _ = audio_option_handle_monitor_event(unsafe { event.as_ref() });
            },
        );
        if let Some(token) =
            NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global_block)
        {
            // The monitors live for the app's lifetime.
            std::mem::forget(token);
        }

        let local_block = block2::RcBlock::new(
            move |event: std::ptr::NonNull<objc2_app_kit::NSEvent>| -> *mut objc2_app_kit::NSEvent {
                if audio_option_handle_monitor_event(unsafe { event.as_ref() }) {
                    // Swallow the matched gesture inside our own app.
                    return std::ptr::null_mut();
                }
                event.as_ptr()
            },
        );
        let local_token = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local_block)
        };
        if let Some(token) = local_token {
            std::mem::forget(token);
        }

        log_audio_diagnostic_event("audio.ptt.option_monitor.installed", json!({}));
    });
}

/// Activates or clears the NSEvent fallback for the current push-to-talk
/// binding. Safe to call on every (re)registration; non-Option combos clear
/// the binding so the monitor goes inert.
#[cfg(target_os = "macos")]
fn sync_macos_option_push_to_talk_binding(app: &AppHandle, shortcut: &str) {
    let binding = macos_option_push_to_talk_binding(shortcut);
    let active = binding.is_some();

    let slot = AUDIO_OPTION_PTT_BINDING.get_or_init(|| StdMutex::new(None));
    if let Ok(mut guard) = slot.lock() {
        *guard = binding;
    }
    AUDIO_OPTION_KEY_IS_DOWN.store(false, Ordering::Release);

    log_audio_diagnostic_event(
        "audio.ptt.option_monitor.sync",
        json!({
            "shortcut": shortcut,
            "active": active,
        }),
    );

    if active {
        register_audio_option_key_monitors(app);
    }
}

fn register_audio_shortcuts(app: &AppHandle) {
    log_audio_diagnostic_event("audio.shortcuts.startup_register.start", json!({}));
    let bindings = read_audio_shortcut_bindings(app);
    let mut state = AudioShortcutManagerState::from_bindings(&bindings);

    state.push_to_talk = register_audio_shortcut_registration(
        app,
        AudioShortcutAction::PushToTalk,
        bindings.push_to_talk,
    );
    state.cancel =
        register_audio_shortcut_registration(app, AudioShortcutAction::Cancel, bindings.cancel);

    app.state::<AudioState>().shortcut_manager.replace(state);
    match register_audio_context_menu_keyboard_hook(app) {
        Ok(()) => log_audio_diagnostic_event(
            "audio.shortcuts.startup_context_menu_hook_done",
            json!({}),
        ),
        Err(error) => log_audio_diagnostic_event(
            "audio.shortcuts.startup_context_menu_hook_error",
            json!({
                "error": clean_whisper_local_audio_log_text(&error),
            }),
        ),
    }
    emit_audio_shortcuts_changed(app);
    log_audio_diagnostic_event("audio.shortcuts.startup_register.done", json!({}));
}

fn set_audio_shortcut_for(
    app: &AppHandle,
    request: AudioShortcutUpdateRequest,
) -> Result<AudioShortcutSettingsStatus, String> {
    let action = AudioShortcutAction::from_request(&request.action)?;
    let next_shortcut = normalize_audio_shortcut_text(&request.shortcut)?;
    validate_audio_shortcut_for_action(action, &next_shortcut)?;
    let manager = app.state::<AudioState>().shortcut_manager.clone();
    let state = manager.snapshot();
    let previous = state.registration(action);
    let other = state.registration(match action {
        AudioShortcutAction::PushToTalk => AudioShortcutAction::Cancel,
        AudioShortcutAction::Cancel => AudioShortcutAction::PushToTalk,
    });

    if audio_shortcuts_conflict(&next_shortcut, &other.shortcut) {
        return Err("Hold-to-record and cancel need different audio shortcuts.".to_string());
    }

    if audio_shortcuts_conflict(&next_shortcut, &previous.shortcut) {
        return Ok(audio_shortcuts_status_for(app));
    }

    unregister_audio_shortcut(app, &previous.shortcut);

    let next_registration =
        register_audio_shortcut_registration(app, action, next_shortcut.clone());
    if !next_registration.registered {
        if previous.registered {
            let restored = register_audio_shortcut_registration(app, action, previous.shortcut);
            manager.set_registration(action, restored);
        }

        return Err(next_registration
            .error
            .unwrap_or_else(|| format!("Unable to register {} shortcut.", action.label())));
    }

    manager.set_registration(action, next_registration);

    let bindings = manager.snapshot().bindings();
    if let Err(error) = write_audio_shortcut_bindings(app, &bindings) {
        let mut registration = manager.snapshot().registration(action);
        registration.error = Some(error.clone());
        manager.set_registration(action, registration);
        return Err(error);
    }

    emit_audio_shortcuts_changed(app);
    Ok(audio_shortcuts_status_for(app))
}

fn reset_audio_shortcuts_for(app: &AppHandle) -> Result<AudioShortcutSettingsStatus, String> {
    let manager = app.state::<AudioState>().shortcut_manager.clone();
    let state = manager.snapshot();

    unregister_audio_shortcut(app, &state.push_to_talk.shortcut);
    unregister_audio_shortcut(app, &state.cancel.shortcut);

    let bindings = default_audio_shortcut_bindings();
    write_audio_shortcut_bindings(app, &bindings)?;

    let mut next_state = AudioShortcutManagerState::from_bindings(&bindings);
    next_state.push_to_talk = register_audio_shortcut_registration(
        app,
        AudioShortcutAction::PushToTalk,
        bindings.push_to_talk,
    );
    next_state.cancel =
        register_audio_shortcut_registration(app, AudioShortcutAction::Cancel, bindings.cancel);
    manager.replace(next_state);

    emit_audio_shortcuts_changed(app);
    Ok(audio_shortcuts_status_for(app))
}

#[cfg(windows)]
fn audio_context_menu_hook_app_handle() -> Option<AppHandle> {
    AUDIO_CONTEXT_MENU_HOOK_APP
        .get()
        .and_then(|app_handle| app_handle.lock().ok().and_then(|guard| guard.clone()))
}

#[cfg(windows)]
unsafe extern "system" fn audio_context_menu_keyboard_hook(
    code: i32,
    wparam: windows_sys::Win32::Foundation::WPARAM,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::LRESULT {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_APPS;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, KBDLLHOOKSTRUCT, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    if code < 0 || lparam == 0 {
        return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
    }

    let event = *(lparam as *const KBDLLHOOKSTRUCT);
    if event.vkCode != u32::from(VK_APPS) {
        return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
    }

    let Some(app) = audio_context_menu_hook_app_handle() else {
        return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
    };

    if !audio_push_to_talk_uses_context_menu(&app) {
        return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
    }

    log_audio_diagnostic_event(
        "audio.ptt.context_menu_hook.event",
        json!({
            "code": code,
            "vk_code": event.vkCode,
            "wparam": wparam,
            "lparam": lparam,
        }),
    );

    match wparam as u32 {
        WM_KEYDOWN | WM_SYSKEYDOWN => {
            if handle_audio_push_to_talk_state(
                app,
                ShortcutState::Pressed,
                "ContextMenu".to_string(),
            ) {
                log_audio_diagnostic_event("audio.ptt.context_menu_hook.handled_down", json!({}));
                1
            } else {
                log_audio_diagnostic_event("audio.ptt.context_menu_hook.passed_down", json!({}));
                CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
            }
        }
        WM_KEYUP | WM_SYSKEYUP => {
            if handle_audio_push_to_talk_state(
                app,
                ShortcutState::Released,
                "ContextMenu".to_string(),
            ) {
                log_audio_diagnostic_event("audio.ptt.context_menu_hook.handled_up", json!({}));
                1
            } else {
                log_audio_diagnostic_event("audio.ptt.context_menu_hook.passed_up", json!({}));
                CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
            }
        }
        _ => CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam),
    }
}

#[cfg(windows)]
fn register_audio_context_menu_keyboard_hook(app: &AppHandle) -> Result<(), String> {
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowsHookExW, WH_KEYBOARD_LL};

    let app_handle = AUDIO_CONTEXT_MENU_HOOK_APP.get_or_init(|| StdMutex::new(None));
    if let Ok(mut current_app) = app_handle.lock() {
        *current_app = Some(app.clone());
    }

    if AUDIO_CONTEXT_MENU_HOOK_HANDLE.load(Ordering::Acquire) != 0 {
        return Ok(());
    }

    let module_handle = unsafe { GetModuleHandleW(std::ptr::null()) };
    let hook = unsafe {
        SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(audio_context_menu_keyboard_hook),
            module_handle,
            0,
        )
    };

    if !hook.is_null() {
        AUDIO_CONTEXT_MENU_HOOK_HANDLE.store(hook as usize, Ordering::Release);
        return Ok(());
    }

    Err("Unable to install the Windows Menu key hook for hold-to-record.".to_string())
}

#[cfg(not(windows))]
fn register_audio_context_menu_keyboard_hook(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

fn emit_audio_push_to_talk_event(
    app: &AppHandle,
    phase: &'static str,
    pressed: bool,
    shortcut: String,
) {
    log_audio_diagnostic_event(
        "audio.ptt.emit.start",
        json!({
            "phase": phase,
            "pressed": pressed,
            "shortcut": shortcut,
        }),
    );
    let event = AudioPushToTalkEvent {
        phase,
        pressed,
        shortcut,
        created_at_ms: current_time_ms(),
    };
    match app.emit(AUDIO_PUSH_TO_TALK_EVENT, event) {
        Ok(()) => log_audio_diagnostic_event(
            "audio.ptt.emit.done",
            json!({
                "phase": phase,
                "pressed": pressed,
            }),
        ),
        Err(error) => log_audio_diagnostic_event(
            "audio.ptt.emit.error",
            json!({
                "phase": phase,
                "pressed": pressed,
                "error": clean_whisper_local_audio_log_text(&error.to_string()),
            }),
        ),
    }
}

fn audio_shortcut_permissions_need_attention(status: &AudioShortcutPermissionStatus) -> bool {
    (status.accessibility_required && !status.accessibility_granted) || status.quarantine_detected
}

fn focus_main_window_for_audio_attention(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }

    if let Some(window) = app.get_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn emit_audio_hotkey_attention(
    app: &AppHandle,
    reason: &str,
    shortcut: &str,
    targets: &[&str],
    message: &str,
) {
    focus_main_window_for_audio_attention(app);
    emit_audio_shortcuts_changed(app);
    let _ = app.emit_to(
        "main",
        AUDIO_HOTKEY_ATTENTION_EVENT,
        json!({
            "id": current_time_ms(),
            "reason": reason,
            "shortcut": shortcut,
            "targets": targets,
            "message": message,
        }),
    );
}

fn audio_push_to_talk_status_for(app: &AppHandle) -> AudioPushToTalkEvent {
    let pressed = AUDIO_PUSH_TO_TALK_IS_DOWN.load(Ordering::Acquire);

    AudioPushToTalkEvent {
        phase: if pressed { "pressed" } else { "released" },
        pressed,
        shortcut: audio_push_to_talk_shortcut_for(app),
        created_at_ms: current_time_ms(),
    }
}

fn emit_audio_cancel_event(app: &AppHandle, shortcut: String) {
    log_audio_diagnostic_event(
        "audio.ptt.cancel_emit.start",
        json!({
            "shortcut": shortcut,
        }),
    );
    let result = app.emit(
        AUDIO_CANCEL_EVENT,
        AudioShortcutEvent {
            action: "cancel",
            shortcut,
            created_at_ms: current_time_ms(),
        },
    );
    match result {
        Ok(()) => log_audio_diagnostic_event("audio.ptt.cancel_emit.done", json!({})),
        Err(error) => log_audio_diagnostic_event(
            "audio.ptt.cancel_emit.error",
            json!({
                "error": clean_whisper_local_audio_log_text(&error.to_string()),
            }),
        ),
    }
}

fn audio_widget_visibility_for_handsfree(
    app: &AppHandle,
) -> Result<Option<AudioWidgetVisibility>, String> {
    log_audio_diagnostic_event("audio.ptt.widget_visibility.start", json!({}));
    let visible = match audio_widget_visible_on_main_thread(app) {
        Ok(visible) => visible,
        Err(error) => {
            log_audio_diagnostic_event(
                "audio.ptt.widget_visibility.visible_error",
                json!({
                    "error": clean_whisper_local_audio_log_text(&error),
                }),
            );
            return Err(error);
        }
    };

    if !visible {
        log_audio_diagnostic_event("audio.ptt.widget_visibility.not_visible", json!({}));
        return Ok(None);
    }

    let status = match whisper_model_status_for(app) {
        Ok(status) => status,
        Err(error) => {
            log_audio_diagnostic_event(
                "audio.ptt.widget_visibility.status_error",
                json!({
                    "error": clean_whisper_local_audio_log_text(&error),
                }),
            );
            return Err(error);
        }
    };
    let visibility = AudioWidgetVisibility {
        visible: true,
        installed: status.installed,
        shortcut: audio_push_to_talk_shortcut_for(app),
    };
    emit_audio_widget_visibility_changed(app, &visibility);
    log_audio_diagnostic_event(
        "audio.ptt.widget_visibility.done",
        json!({
            "installed": visibility.installed,
            "shortcut": visibility.shortcut,
        }),
    );
    Ok(Some(visibility))
}

fn handle_audio_push_to_talk_state(app: AppHandle, state: ShortcutState, shortcut: String) -> bool {
    let state_label = audio_shortcut_state_label(&state);
    log_audio_diagnostic_event(
        "audio.ptt.handle.start",
        json!({
            "state": state_label,
            "shortcut": shortcut,
            "is_down_before": AUDIO_PUSH_TO_TALK_IS_DOWN.load(Ordering::Acquire),
        }),
    );

    match state {
        ShortcutState::Pressed => {
            let permission_status = audio_shortcut_permission_status();
            if audio_shortcut_permissions_need_attention(&permission_status) {
                AUDIO_PUSH_TO_TALK_IS_DOWN.store(false, Ordering::Release);
                log_audio_diagnostic_event(
                    "audio.ptt.handle.ignored_permissions",
                    json!({
                        "message": clean_whisper_local_audio_log_text(&permission_status.message),
                    }),
                );
                emit_audio_hotkey_attention(
                    &app,
                    "permissions",
                    &shortcut,
                    &["permissions"],
                    &permission_status.message,
                );
                return false;
            }

            let input_permission_status = audio_input_permission_status_for_platform();
            if audio_input_permissions_need_attention(&input_permission_status) {
                AUDIO_PUSH_TO_TALK_IS_DOWN.store(false, Ordering::Release);
                log_audio_diagnostic_event(
                    "audio.ptt.handle.ignored_microphone_permissions",
                    json!({
                        "message": clean_whisper_local_audio_log_text(&input_permission_status.message),
                        "status": input_permission_status.status,
                    }),
                );
                emit_audio_hotkey_attention(
                    &app,
                    "microphone-permission",
                    &shortcut,
                    &["input", "microphone"],
                    &input_permission_status.message,
                );
                return false;
            }

            let widget_visible = match audio_widget_visible_on_main_thread(&app) {
                Ok(visible) => {
                    log_audio_diagnostic_event(
                        "audio.ptt.handle.initial_visibility",
                        json!({
                            "visible": visible,
                        }),
                    );
                    visible
                }
                Err(error) => {
                    log_audio_diagnostic_event(
                        "audio.ptt.handle.initial_visibility_error",
                        json!({
                            "error": clean_whisper_local_audio_log_text(&error),
                        }),
                    );
                    false
                }
            };

            if !widget_visible {
                AUDIO_PUSH_TO_TALK_IS_DOWN.store(false, Ordering::Release);
                log_audio_diagnostic_event("audio.ptt.handle.ignored_not_visible", json!({}));
                emit_audio_hotkey_attention(
                    &app,
                    "recorder",
                    &shortcut,
                    &["recorder"],
                    "Open the floating recorder before using the audio hotkey.",
                );
                return false;
            }

            #[cfg(target_os = "macos")]
            {
                // Push-to-talk should never steal the insertion caret from the
                // app/text field the user selected before pressing the hotkey.
                let _ = audio_widget_reassert_open_state(&app, false);
                audio_widget_emit_open_reassert(&app, false);
            }

            if AUDIO_PUSH_TO_TALK_IS_DOWN.swap(true, Ordering::AcqRel) {
                log_audio_diagnostic_event("audio.ptt.handle.duplicate_press", json!({}));
                return true;
            }

            log_audio_diagnostic_event("audio.ptt.handle.spawn_press_task", json!({}));
            tauri::async_runtime::spawn(async move {
                log_audio_diagnostic_event("audio.ptt.press_task.start", json!({}));
                let widget_visible = match audio_widget_visible_on_main_thread(&app) {
                    Ok(visible) => {
                        log_audio_diagnostic_event(
                            "audio.ptt.press_task.visibility",
                            json!({
                                "visible": visible,
                            }),
                        );
                        visible
                    }
                    Err(error) => {
                        log_audio_diagnostic_event(
                            "audio.ptt.press_task.visibility_error",
                            json!({
                                "error": clean_whisper_local_audio_log_text(&error),
                            }),
                        );
                        false
                    }
                };

                if !widget_visible {
                    AUDIO_PUSH_TO_TALK_IS_DOWN.store(false, Ordering::Release);
                    log_audio_diagnostic_event(
                        "audio.ptt.press_task.ignored_not_visible",
                        json!({}),
                    );
                    emit_audio_hotkey_attention(
                        &app,
                        "recorder",
                        &shortcut,
                        &["recorder"],
                        "Open the floating recorder before using the audio hotkey.",
                    );
                    return;
                }

                if !app_has_focused_audio_input_window(&app) {
                    log_audio_diagnostic_event(
                        "audio.ptt.press_task.clear_terminal_target_start",
                        json!({}),
                    );
                    let terminal_state = app.state::<TerminalState>();
                    let _ = clear_terminal_audio_input_target(&terminal_state);
                    log_audio_diagnostic_event(
                        "audio.ptt.press_task.clear_terminal_target_done",
                        json!({}),
                    );
                }

                if AUDIO_PUSH_TO_TALK_IS_DOWN.load(Ordering::Acquire) {
                    log_audio_diagnostic_event("audio.ptt.press_task.emit_pressed", json!({}));
                    emit_audio_push_to_talk_event(&app, "pressed", true, shortcut);
                }

                match audio_widget_visibility_for_handsfree(&app) {
                    Ok(Some(visibility)) => {
                        if visibility.installed {
                            let prepare_app = app.clone();
                            let engine = app.state::<AudioState>().whisper_engine.clone();
                            log_audio_diagnostic_event(
                                "audio.ptt.press_task.prepare_spawn",
                                json!({}),
                            );
                            let _ = tauri::async_runtime::spawn_blocking(move || {
                                match prepare_whisper_model_for(&prepare_app, &engine) {
                                    Ok(status) => log_audio_diagnostic_event(
                                        "audio.ptt.press_task.prepare_done",
                                        json!({
                                            "cached": status.cached,
                                            "elapsed_ms": status.elapsed_ms,
                                        }),
                                    ),
                                    Err(error) => log_audio_diagnostic_event(
                                        "audio.ptt.press_task.prepare_error",
                                        json!({
                                            "error": clean_whisper_local_audio_log_text(&error),
                                        }),
                                    ),
                                }
                            });
                        } else {
                            log_audio_diagnostic_event(
                                "audio.ptt.press_task.prepare_skipped_not_installed",
                                json!({}),
                            );
                        }
                    }
                    Ok(None) => {
                        log_audio_diagnostic_event(
                            "audio.ptt.press_task.visibility_none",
                            json!({}),
                        );
                    }
                    Err(error) => {
                        log_audio_diagnostic_event(
                            "audio.ptt.press_task.widget_visibility_error",
                            json!({
                                "error": clean_whisper_local_audio_log_text(&error),
                            }),
                        );
                    }
                }
                log_audio_diagnostic_event("audio.ptt.press_task.done", json!({}));
            });

            log_audio_diagnostic_event("audio.ptt.handle.pressed_done", json!({}));
            true
        }
        ShortcutState::Released => {
            if !AUDIO_PUSH_TO_TALK_IS_DOWN.swap(false, Ordering::AcqRel) {
                log_audio_diagnostic_event("audio.ptt.handle.release_ignored_not_down", json!({}));
                return false;
            }

            log_audio_diagnostic_event("audio.ptt.handle.spawn_release_task", json!({}));
            tauri::async_runtime::spawn(async move {
                log_audio_diagnostic_event("audio.ptt.release_task.emit_released", json!({}));
                emit_audio_push_to_talk_event(&app, "released", false, shortcut);
                log_audio_diagnostic_event("audio.ptt.release_task.done", json!({}));
            });

            log_audio_diagnostic_event("audio.ptt.handle.released_done", json!({}));
            true
        }
    }
}

fn handle_audio_cancel_shortcut_state(app: AppHandle, state: ShortcutState, shortcut: String) {
    log_audio_diagnostic_event(
        "audio.ptt.cancel_handle.start",
        json!({
            "state": audio_shortcut_state_label(&state),
            "shortcut": shortcut,
            "is_down_before": AUDIO_PUSH_TO_TALK_IS_DOWN.load(Ordering::Acquire),
        }),
    );

    if state != ShortcutState::Pressed {
        log_audio_diagnostic_event("audio.ptt.cancel_handle.ignored_release", json!({}));
        return;
    }

    AUDIO_PUSH_TO_TALK_IS_DOWN.store(false, Ordering::Release);

    tauri::async_runtime::spawn(async move {
        log_audio_diagnostic_event("audio.ptt.cancel_task.emit", json!({}));
        emit_audio_cancel_event(&app, shortcut);
        log_audio_diagnostic_event("audio.ptt.cancel_task.done", json!({}));
    });
}

fn insert_text_with_enigo(text: &str) -> Result<(), String> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");

    if normalized.is_empty() {
        return Err("No text was produced for insertion.".to_string());
    }

    let settings = enigo::Settings::default();
    let mut enigo = enigo::Enigo::new(&settings)
        .map_err(|error| format!("Unable to open native text output: {error}"))?;

    enigo::Keyboard::text(&mut enigo, &normalized)
        .map_err(|error| format!("Unable to insert transcript into the focused target: {error}"))
}

fn handsfree_focused_element_attributes_are_editable(
    role: Option<&str>,
    subrole: Option<&str>,
    value_attribute_settable: bool,
) -> bool {
    const EDITABLE_ROLES: &[&str] = &["AXTextField", "AXTextArea", "AXSearchField", "AXComboBox"];
    const EDITABLE_SUBROLES: &[&str] = &["AXSecureTextField", "AXSearchField"];

    role.is_some_and(|role| EDITABLE_ROLES.contains(&role))
        || subrole.is_some_and(|subrole| EDITABLE_SUBROLES.contains(&subrole))
        || value_attribute_settable
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, PartialEq, Eq)]
struct HandsfreeFocusedElementAttributes {
    role: Option<String>,
    subrole: Option<String>,
    value_attribute_settable: bool,
}

#[cfg(target_os = "macos")]
impl HandsfreeFocusedElementAttributes {
    fn is_editable(&self) -> bool {
        handsfree_focused_element_attributes_are_editable(
            self.role.as_deref(),
            self.subrole.as_deref(),
            self.value_attribute_settable,
        )
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, PartialEq, Eq)]
enum HandsfreeFocusedElementProbe {
    Editable(HandsfreeFocusedElementAttributes),
    NotEditable {
        attributes: HandsfreeFocusedElementAttributes,
        // Focus inside THIS app: WKWebView child webviews (web panes, popouts)
        // often surface as a non-editable container to the system-wide AX
        // query even when a page input (e.g. Discord's composer) has focus —
        // keystrokes there go to web content and never beep, so insertion is
        // safe and expected.
        owned_by_app: bool,
    },
    NoFocusedElement {
        app_frontmost: bool,
    },
}

#[cfg(target_os = "macos")]
fn handsfree_ax_element_owned_by_app(element: *const std::ffi::c_void) -> bool {
    let mut pid: i32 = 0;
    let error = unsafe { handsfree_ax_ui_element_get_pid(element, &mut pid) };
    error == MACOS_AX_ERROR_SUCCESS && pid > 0 && pid as u32 == std::process::id()
}

#[cfg(target_os = "macos")]
fn handsfree_frontmost_app_is_self() -> bool {
    objc2_app_kit::NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .map(|application| unsafe { application.processIdentifier() })
        .is_some_and(|pid| pid > 0 && pid as u32 == std::process::id())
}

#[cfg(target_os = "macos")]
fn handsfree_ax_attribute_is_absent(error: i32) -> bool {
    matches!(
        error,
        MACOS_AX_ERROR_SUCCESS
            | MACOS_HANDSFREE_AX_ERROR_NO_VALUE
            | MACOS_HANDSFREE_AX_ERROR_ATTRIBUTE_UNSUPPORTED
    )
}

#[cfg(target_os = "macos")]
fn handsfree_ax_optional_string_attribute(
    element: *const std::ffi::c_void,
    attribute: &'static str,
) -> Result<Option<String>, i32> {
    match audio_widget_ax_copy_attribute_value(element, attribute) {
        Ok(value) => {
            let cf_value = unsafe { &*value.cast::<objc2_core_foundation::CFType>() };
            let result = cf_value
                .downcast_ref::<objc2_core_foundation::CFString>()
                .map(ToString::to_string)
                .ok_or(MACOS_HANDSFREE_AX_ERROR_UNEXPECTED_ATTRIBUTE_TYPE);
            audio_widget_cf_release(value);
            result.map(Some)
        }
        Err(error) if handsfree_ax_attribute_is_absent(error) => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(target_os = "macos")]
fn handsfree_ax_value_attribute_settable(
    element: *const std::ffi::c_void,
) -> Result<bool, i32> {
    let attribute_string = objc2_core_foundation::CFString::from_static_str("AXValue");
    let attribute_ref =
        attribute_string.as_ref() as *const objc2_core_foundation::CFString;
    let mut settable: std::os::raw::c_uchar = 0;
    let error = unsafe {
        handsfree_ax_ui_element_is_attribute_settable(
            element,
            attribute_ref.cast(),
            &mut settable,
        )
    };

    if error == MACOS_AX_ERROR_SUCCESS {
        Ok(settable != 0)
    } else if handsfree_ax_attribute_is_absent(error) {
        Ok(false)
    } else {
        Err(error)
    }
}

#[cfg(target_os = "macos")]
fn handsfree_ax_focused_element_probe() -> Result<HandsfreeFocusedElementProbe, i32> {
    if unsafe { audio_widget_ax_is_process_trusted() == 0 } {
        return Err(MACOS_HANDSFREE_AX_ERROR_UNTRUSTED);
    }

    let system_wide = unsafe { handsfree_ax_ui_element_create_system_wide() };
    if system_wide.is_null() {
        return Err(MACOS_HANDSFREE_AX_ERROR_SYSTEM_WIDE_UNAVAILABLE);
    }

    let focused_element =
        match audio_widget_ax_copy_attribute_value(system_wide, "AXFocusedUIElement") {
            Ok(focused_element) => Some(focused_element),
            Err(error)
                if matches!(error, MACOS_AX_ERROR_SUCCESS | MACOS_HANDSFREE_AX_ERROR_NO_VALUE) =>
            {
                None
            }
            Err(error) => {
                audio_widget_cf_release(system_wide);
                return Err(error);
            }
        };
    audio_widget_cf_release(system_wide);

    let Some(focused_element) = focused_element else {
        return Ok(HandsfreeFocusedElementProbe::NoFocusedElement {
            app_frontmost: handsfree_frontmost_app_is_self(),
        });
    };

    let owned_by_app = handsfree_ax_element_owned_by_app(focused_element);
    let attributes: Result<HandsfreeFocusedElementAttributes, i32> = (|| {
        let role = handsfree_ax_optional_string_attribute(focused_element, "AXRole")?;
        let subrole = handsfree_ax_optional_string_attribute(focused_element, "AXSubrole")?;
        let value_attribute_settable = handsfree_ax_value_attribute_settable(focused_element)?;
        Ok(HandsfreeFocusedElementAttributes {
            role,
            subrole,
            value_attribute_settable,
        })
    })();
    audio_widget_cf_release(focused_element);

    let attributes = attributes?;
    if attributes.is_editable() {
        Ok(HandsfreeFocusedElementProbe::Editable(attributes))
    } else {
        Ok(HandsfreeFocusedElementProbe::NotEditable {
            attributes,
            owned_by_app,
        })
    }
}

#[cfg(target_os = "macos")]
fn handsfree_ax_focused_element_probe_on_main_thread(
    app: &AppHandle,
) -> Result<HandsfreeFocusedElementProbe, i32> {
    match run_audio_widget_action_on_main_thread(
        app,
        "handsfree_focused_element_probe",
        |_| Ok(handsfree_ax_focused_element_probe()),
    ) {
        Ok(probe_result) => probe_result,
        Err(error) => {
            log_audio_diagnostic_event(
                "audio.handsfree.insert.focus_probe.main_thread_error",
                json!({
                    "error": clean_whisper_local_audio_log_text(&error),
                }),
            );
            Err(MACOS_HANDSFREE_AX_ERROR_SYSTEM_WIDE_UNAVAILABLE)
        }
    }
}

fn handsfree_insert_result(inserted: bool, method: &'static str, reason: Option<&'static str>) -> Value {
    match reason {
        Some(reason) => json!({
            "inserted": inserted,
            "method": method,
            "reason": reason,
        }),
        None => json!({
            "inserted": inserted,
            "method": method,
        }),
    }
}

#[tauri::command]
async fn audio_shortcuts_status(app: AppHandle) -> Result<AudioShortcutSettingsStatus, String> {
    log_audio_diagnostic_event("audio.shortcuts.status.command", json!({}));
    Ok(audio_shortcuts_status_for(&app))
}

#[tauri::command]
async fn audio_push_to_talk_status(app: AppHandle) -> Result<AudioPushToTalkEvent, String> {
    let status = audio_push_to_talk_status_for(&app);
    log_audio_diagnostic_event(
        "audio.ptt.status.command",
        json!({
            "phase": status.phase,
            "pressed": status.pressed,
            "shortcut": status.shortcut,
        }),
    );
    Ok(status)
}

#[tauri::command]
async fn open_audio_shortcut_permissions(
    app: AppHandle,
) -> Result<AudioShortcutSettingsStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = macos_request_accessibility_permission();
        macos_open_accessibility_settings()?;
    }

    Ok(audio_shortcuts_status_for(&app))
}

#[tauri::command]
async fn open_macos_fn_key_settings(app: AppHandle) -> Result<AudioShortcutSettingsStatus, String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(MACOS_KEYBOARD_SETTINGS_URL)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Unable to open macOS keyboard settings: {error}"))?;
    }

    Ok(audio_shortcuts_status_for(&app))
}

#[tauri::command]
async fn set_audio_shortcut(
    app: AppHandle,
    request: AudioShortcutUpdateRequest,
) -> Result<AudioShortcutSettingsStatus, String> {
    set_audio_shortcut_for(&app, request)
}

#[tauri::command]
async fn reset_audio_shortcuts(app: AppHandle) -> Result<AudioShortcutSettingsStatus, String> {
    reset_audio_shortcuts_for(&app)
}

#[tauri::command]
async fn insert_handsfree_transcribed_text(
    app: AppHandle,
    terminal_state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    text: String,
) -> Result<Value, String> {
    let text = clean_transcript_for_insert(text)?;
    let terminal_target = active_terminal_audio_input_target(&terminal_state)?;
    let terminal_target_owned_insert =
        terminal_audio_target_should_own_insert(&app, &terminal_state, terminal_target.as_ref())?;

    if write_to_active_terminal_audio_input_target(&app, &terminal_state, &cloud_mcp_state, &text)
        .await?
    {
        return Ok(handsfree_insert_result(true, "terminal", None));
    }

    if terminal_target_owned_insert {
        return Err(
            "Selected terminal was not available for direct dictation insertion.".to_string(),
        );
    }

    #[cfg(target_os = "macos")]
    let _ = audio_widget_release_keyboard_focus_on_main_thread(&app);

    let insert_result = tauri::async_runtime::spawn_blocking(move || {
        thread::sleep(Duration::from_millis(AUDIO_HANDSFREE_INSERT_DELAY_MS));

        // The AX focus probe is diagnostics-only: gating insertion on it broke
        // dictation into native child webviews (web panes/popouts report a
        // non-editable container even when a page input has focus), so the
        // transcript is ALWAYS typed into whatever is focused — the original
        // behavior. The occasional alert beep on a non-editable target is an
        // accepted trade-off.
        #[cfg(target_os = "macos")]
        match handsfree_ax_focused_element_probe_on_main_thread(&app) {
            Ok(HandsfreeFocusedElementProbe::Editable(attributes)) => {
                log_audio_diagnostic_event(
                    "audio.handsfree.insert.focus_probe.editable",
                    json!({
                        "role": attributes.role,
                        "subrole": attributes.subrole,
                        "value_attribute_settable": attributes.value_attribute_settable,
                    }),
                );
            }
            Ok(HandsfreeFocusedElementProbe::NotEditable {
                attributes,
                owned_by_app,
            }) => {
                log_audio_diagnostic_event(
                    "audio.handsfree.insert.focus_probe.not_editable",
                    json!({
                        "owned_by_app": owned_by_app,
                        "role": attributes.role,
                        "subrole": attributes.subrole,
                        "value_attribute_settable": attributes.value_attribute_settable,
                    }),
                );
            }
            Ok(HandsfreeFocusedElementProbe::NoFocusedElement { app_frontmost }) => {
                log_audio_diagnostic_event(
                    "audio.handsfree.insert.focus_probe.no_focused_element",
                    json!({ "app_frontmost": app_frontmost }),
                );
            }
            Err(error) => {
                log_audio_diagnostic_event(
                    "audio.handsfree.insert.focus_probe.error_fallback",
                    json!({ "error": error }),
                );
            }
        }

        insert_text_with_enigo(&text)?;
        Ok(handsfree_insert_result(true, "keystrokes", None))
    })
    .await
    .map_err(|error| format!("Unable to insert transcript: {error}"))?;

    insert_result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_scope_accepts_plain_escape_without_active_audio() {
        assert!(escape_scope_allows_modifier_mask(
            0,
            false,
            false,
            "Alt+KeyP",
        ));
    }

    #[test]
    fn escape_scope_accepts_record_shortcut_modifiers_while_recording() {
        assert!(escape_scope_allows_modifier_mask(
            AUDIO_SHORTCUT_MODIFIER_ALT_MASK,
            true,
            true,
            "Alt+KeyP",
        ));
        assert!(escape_scope_allows_modifier_mask(
            AUDIO_SHORTCUT_MODIFIER_ALT_MASK | AUDIO_SHORTCUT_MODIFIER_SHIFT_MASK,
            true,
            true,
            "Alt+Shift+KeyP",
        ));
    }

    #[test]
    fn escape_scope_rejects_unrelated_or_inactive_modifiers() {
        assert!(!escape_scope_allows_modifier_mask(
            AUDIO_SHORTCUT_MODIFIER_SHIFT_MASK,
            true,
            true,
            "Alt+KeyP",
        ));
        assert!(!escape_scope_allows_modifier_mask(
            AUDIO_SHORTCUT_MODIFIER_ALT_MASK,
            false,
            true,
            "Alt+KeyP",
        ));
        assert!(!escape_scope_allows_modifier_mask(
            AUDIO_SHORTCUT_MODIFIER_ALT_MASK,
            true,
            false,
            "Alt+KeyP",
        ));
    }

    #[test]
    fn focused_element_classifier_accepts_editable_roles() {
        for role in ["AXTextField", "AXTextArea", "AXSearchField", "AXComboBox"] {
            assert!(handsfree_focused_element_attributes_are_editable(
                Some(role),
                None,
                false,
            ));
        }
    }

    #[test]
    fn focused_element_classifier_accepts_secure_and_search_subroles() {
        for subrole in ["AXSecureTextField", "AXSearchField"] {
            assert!(handsfree_focused_element_attributes_are_editable(
                Some("AXGroup"),
                Some(subrole),
                false,
            ));
        }
    }

    #[test]
    fn focused_element_classifier_accepts_settable_value_attribute() {
        assert!(handsfree_focused_element_attributes_are_editable(
            Some("AXButton"),
            None,
            true,
        ));
    }

    #[test]
    fn focused_element_classifier_rejects_non_editable_combinations() {
        assert!(!handsfree_focused_element_attributes_are_editable(
            Some("AXButton"),
            None,
            false,
        ));
        assert!(!handsfree_focused_element_attributes_are_editable(
            None,
            Some("AXStandardWindow"),
            false,
        ));
        assert!(!handsfree_focused_element_attributes_are_editable(
            None,
            None,
            false,
        ));
    }

    #[test]
    fn handsfree_insert_result_matches_return_contract() {
        assert_eq!(
            handsfree_insert_result(true, "terminal", None),
            json!({ "inserted": true, "method": "terminal" }),
        );
        assert_eq!(
            handsfree_insert_result(false, "none", Some("no_editable_focus")),
            json!({
                "inserted": false,
                "method": "none",
                "reason": "no_editable_focus",
            }),
        );
    }
}

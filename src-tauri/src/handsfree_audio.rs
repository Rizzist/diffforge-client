const AUDIO_PUSH_TO_TALK_EVENT: &str = "forge-audio-push-to-talk";
const AUDIO_CANCEL_EVENT: &str = "forge-audio-cancel";
const AUDIO_SHORTCUTS_CHANGED_EVENT: &str = "forge-audio-shortcuts-changed";
const AUDIO_SHORTCUT_SETTINGS_FILE: &str = "audio-shortcuts.json";
const AUDIO_HANDSFREE_INSERT_DELAY_MS: u64 = 160;
#[cfg(target_os = "macos")]
const MACOS_ACCESSIBILITY_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

static AUDIO_PUSH_TO_TALK_IS_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static AUDIO_CONTEXT_MENU_HOOK_HANDLE: AtomicUsize = AtomicUsize::new(0);
#[cfg(windows)]
static AUDIO_CONTEXT_MENU_HOOK_APP: OnceLock<StdMutex<Option<AppHandle>>> = OnceLock::new();

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    static kAXTrustedCheckOptionPrompt: *const std::ffi::c_void;
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
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;

    Ok(app_data_dir.join(AUDIO_SHORTCUT_SETTINGS_FILE))
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

fn normalize_audio_shortcut_text(value: &str) -> Result<String, String> {
    Ok(parse_audio_shortcut(value)?.into_string())
}

fn audio_shortcuts_conflict(left: &str, right: &str) -> bool {
    match (parse_audio_shortcut(left), parse_audio_shortcut(right)) {
        (Ok(left), Ok(right)) => left.id() == right.id(),
        _ => false,
    }
}

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

fn audio_push_to_talk_uses_context_menu(app: &AppHandle) -> bool {
    audio_shortcut_is_bare_context_menu(&audio_push_to_talk_shortcut_for(app))
}

fn emit_audio_shortcuts_changed(app: &AppHandle) {
    let _ = app.emit(AUDIO_SHORTCUTS_CHANGED_EVENT, audio_shortcuts_status_for(app));
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
                handle_audio_push_to_talk_state(
                    app.clone(),
                    event.state,
                    shortcut.into_string(),
                );
            })
            .map_err(|error| format!("Unable to register hold-to-record shortcut: {error}")),
        AudioShortcutAction::Cancel => app
            .global_shortcut()
            .on_shortcut(shortcut, |app, shortcut, event| {
                handle_audio_cancel_shortcut_state(app.clone(), event.state, shortcut.into_string());
            })
            .map_err(|error| format!("Unable to register cancel shortcut: {error}")),
    }
}

fn unregister_audio_shortcut(app: &AppHandle, shortcut_text: &str) {
    if let Ok(shortcut) = parse_audio_shortcut(shortcut_text) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

fn register_deferred_audio_cancel_shortcut(app: &AppHandle) {
    let manager = app.state::<AudioState>().shortcut_manager.clone();
    let shortcut = manager.snapshot().cancel.shortcut;

    if audio_cancel_shortcut_defers_global_registration(&shortcut) {
        let _ = register_audio_shortcut_handler(app, AudioShortcutAction::Cancel, &shortcut);
    }
}

fn unregister_deferred_audio_cancel_shortcut(app: &AppHandle) {
    let manager = app.state::<AudioState>().shortcut_manager.clone();
    let shortcut = manager.snapshot().cancel.shortcut;

    if audio_cancel_shortcut_defers_global_registration(&shortcut) {
        unregister_audio_shortcut(app, &shortcut);
    }
}

fn register_audio_shortcut_registration(
    app: &AppHandle,
    action: AudioShortcutAction,
    shortcut: String,
) -> AudioShortcutRegistration {
    if action == AudioShortcutAction::Cancel
        && audio_cancel_shortcut_defers_global_registration(&shortcut)
        && !AUDIO_PUSH_TO_TALK_IS_DOWN.load(Ordering::Acquire)
    {
        return deferred_audio_cancel_registration(shortcut);
    }

    if audio_shortcut_uses_windows_context_menu_hook(action, &shortcut) {
        return match register_audio_context_menu_keyboard_hook(app) {
            Ok(()) => AudioShortcutRegistration {
                shortcut,
                registered: true,
                error: None,
            },
            Err(error) => AudioShortcutRegistration {
                shortcut,
                registered: false,
                error: Some(error),
            },
        };
    }

    match register_audio_shortcut_handler(app, action, &shortcut) {
        Ok(()) => AudioShortcutRegistration {
            shortcut,
            registered: true,
            error: None,
        },
        Err(error) => AudioShortcutRegistration {
            shortcut,
            registered: false,
            error: Some(error),
        },
    }
}

fn register_audio_shortcuts(app: &AppHandle) {
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
    let _ = register_audio_context_menu_keyboard_hook(app);
    emit_audio_shortcuts_changed(app);
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

    match wparam as u32 {
        WM_KEYDOWN | WM_SYSKEYDOWN => {
            handle_audio_push_to_talk_state(
                app,
                ShortcutState::Pressed,
                "ContextMenu".to_string(),
            );
            1
        }
        WM_KEYUP | WM_SYSKEYUP => {
            handle_audio_push_to_talk_state(
                app,
                ShortcutState::Released,
                "ContextMenu".to_string(),
            );
            1
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
    let _ = app.emit(AUDIO_PUSH_TO_TALK_EVENT, AudioPushToTalkEvent {
        phase,
        pressed,
        shortcut,
        created_at_ms: current_time_ms(),
    });
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
    let _ = app.emit(
        AUDIO_CANCEL_EVENT,
        AudioShortcutEvent {
            action: "cancel",
            shortcut,
            created_at_ms: current_time_ms(),
        },
    );
}

fn show_audio_widget_for_handsfree(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    let status = whisper_model_status_for(app)?;
    let window = ensure_audio_widget_window(app)?;
    window
        .show()
        .map_err(|error| format!("Unable to show audio widget: {error}"))?;

    let visibility = AudioWidgetVisibility {
        visible: true,
        installed: status.installed,
        shortcut: audio_push_to_talk_shortcut_for(app),
    };
    emit_audio_widget_visibility_changed(app, &visibility);
    Ok(visibility)
}

fn handle_audio_push_to_talk_state(app: AppHandle, state: ShortcutState, shortcut: String) {
    match state {
        ShortcutState::Pressed => {
            if AUDIO_PUSH_TO_TALK_IS_DOWN.swap(true, Ordering::AcqRel) {
                return;
            }

            register_deferred_audio_cancel_shortcut(&app);

            tauri::async_runtime::spawn(async move {
                if !app_has_focused_audio_input_window(&app) {
                    let terminal_state = app.state::<TerminalState>();
                    let _ = clear_terminal_audio_input_target(&terminal_state);
                }

                if AUDIO_PUSH_TO_TALK_IS_DOWN.load(Ordering::Acquire) {
                    emit_audio_push_to_talk_event(&app, "pressed", true, shortcut);
                }

                if let Ok(visibility) = show_audio_widget_for_handsfree(&app) {
                    if visibility.installed {
                        let prepare_app = app.clone();
                        let engine = app.state::<AudioState>().whisper_engine.clone();
                        let _ = tauri::async_runtime::spawn_blocking(move || {
                            let _ = prepare_whisper_model_for(&prepare_app, &engine);
                        });
                    }
                }
            });
        }
        ShortcutState::Released => {
            if !AUDIO_PUSH_TO_TALK_IS_DOWN.swap(false, Ordering::AcqRel) {
                return;
            }

            unregister_deferred_audio_cancel_shortcut(&app);

            tauri::async_runtime::spawn(async move {
                emit_audio_push_to_talk_event(&app, "released", false, shortcut);
            });
        }
    }
}

fn handle_audio_cancel_shortcut_state(app: AppHandle, state: ShortcutState, shortcut: String) {
    if state != ShortcutState::Pressed {
        return;
    }

    AUDIO_PUSH_TO_TALK_IS_DOWN.store(false, Ordering::Release);
    unregister_deferred_audio_cancel_shortcut(&app);

    tauri::async_runtime::spawn(async move {
        emit_audio_cancel_event(&app, shortcut);
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

#[tauri::command]
async fn audio_shortcuts_status(app: AppHandle) -> Result<AudioShortcutSettingsStatus, String> {
    Ok(audio_shortcuts_status_for(&app))
}

#[tauri::command]
async fn audio_push_to_talk_status(app: AppHandle) -> Result<AudioPushToTalkEvent, String> {
    Ok(audio_push_to_talk_status_for(&app))
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
    text: String,
) -> Result<AudioWidgetVisibility, String> {
    let text = clean_transcript_for_insert(text)?;
    let widget_visible = app
        .get_webview_window(AUDIO_WIDGET_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    if write_to_active_terminal_audio_input_target(&app, &terminal_state, &text).await? {
        return Ok(AudioWidgetVisibility {
            visible: widget_visible,
            installed: whisper_model_status_for(&app)?.installed,
            shortcut: audio_push_to_talk_shortcut_for(&app),
        });
    }

    let insert_result = tauri::async_runtime::spawn_blocking(move || {
        thread::sleep(Duration::from_millis(AUDIO_HANDSFREE_INSERT_DELAY_MS));
        insert_text_with_enigo(&text)
    })
    .await
    .map_err(|error| format!("Unable to insert transcript: {error}"))?;

    if let Err(error) = insert_result {
        return Err(error);
    }

    Ok(AudioWidgetVisibility {
        visible: widget_visible,
        installed: whisper_model_status_for(&app)?.installed,
        shortcut: audio_push_to_talk_shortcut_for(&app),
    })
}

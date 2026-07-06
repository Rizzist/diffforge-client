#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NativeNotificationUrgency {
    Normal,
    Attention,
}

/// Webview-mirrored attention state: what the user is looking at plus their
/// native-notification preference. The webview pushes updates whenever any of
/// these change (attention_state_update command); Rust notification paths
/// consult it so native banners respect both the user's setting and whether
/// they are already watching the workspace in question.
#[derive(Clone, Debug, Default)]
pub(crate) struct NativeAttentionState {
    pub focused: bool,
    pub native_enabled_override: Option<bool>,
    pub selected_workspace_id: String,
    pub terminals_view_visible: bool,
}

static NATIVE_ATTENTION_STATE: std::sync::OnceLock<std::sync::Mutex<NativeAttentionState>> =
    std::sync::OnceLock::new();

fn native_attention_state() -> &'static std::sync::Mutex<NativeAttentionState> {
    NATIVE_ATTENTION_STATE.get_or_init(|| std::sync::Mutex::new(NativeAttentionState::default()))
}

pub(crate) fn native_attention_state_update(state: NativeAttentionState) {
    if let Ok(mut current) = native_attention_state().lock() {
        *current = state;
    }
}

/// The user's native-notification setting (mirrored from the webview; enabled
/// until the webview reports otherwise, so background-mode startup before the
/// first mirror still notifies).
pub(crate) fn native_notifications_enabled() -> bool {
    native_attention_state()
        .lock()
        .map(|state| state.native_enabled_override.unwrap_or(true))
        .unwrap_or(true)
}

/// True when the user is actively watching this workspace's terminals: app
/// focused, that workspace selected, terminals view visible. Attention-grade
/// notifications for a watched workspace are redundant (the in-app cue and
/// pane chip are on screen).
pub(crate) fn native_attention_watching_workspace(workspace_id: &str) -> bool {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return false;
    }
    native_attention_state()
        .lock()
        .map(|state| {
            state.focused
                && state.terminals_view_visible
                && state.selected_workspace_id == workspace_id
        })
        .unwrap_or(false)
}

fn diffforge_native_notify(
    app: &AppHandle,
    title: &str,
    body: &str,
    urgency: NativeNotificationUrgency,
    suppress_when_focused: bool,
) -> Result<(), String> {
    if crate::daemon_mode_active() {
        return Ok(());
    }
    let title = title.trim();
    if title.is_empty() {
        return Err("Native notification title is empty.".to_string());
    }
    if !native_notifications_enabled() {
        return Ok(());
    }
    if suppress_when_focused && diffforge_main_window_focused(app) {
        return Ok(());
    }
    let body = body.trim();

    #[cfg(target_os = "macos")]
    {
        macos_user_notification_show(title, body, urgency)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let mut builder = app.notification().builder().title(title).body(body);
        if let Some(icon) = diffforge_notification_icon_path(app) {
            builder = builder.icon(icon);
        }
        builder
            .show()
            .map_err(|error| format!("Unable to show native notification: {error}"))
    }
}

fn diffforge_main_window_focused(app: &AppHandle) -> bool {
    app.get_window("main")
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
fn diffforge_notification_icon_path(app: &AppHandle) -> Option<String> {
    let resource_dir = app.path().resource_dir().ok()?;
    for candidate in ["icons/128x128.png", "icons/32x32.png", "icons/icon.ico"] {
        let path = resource_dir.join(candidate);
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}

#[cfg(target_os = "macos")]
mod macos_native_notifications {
    use super::NativeNotificationUrgency;
    use block2::{DynBlock, RcBlock};
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, ProtocolObject};
    use objc2::{define_class, msg_send};
    use objc2::AnyThread;
    use objc2_foundation::{NSError, NSObject, NSObjectProtocol, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotification,
        UNNotificationInterruptionLevel, UNNotificationPresentationOptions, UNNotificationRequest,
        UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };
    use std::sync::mpsc;
    use std::sync::OnceLock;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    const AUTH_TIMEOUT: Duration = Duration::from_secs(2);

    static DELEGATE_PTR: OnceLock<usize> = OnceLock::new();
    static AUTH_REQUESTED: OnceLock<bool> = OnceLock::new();

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "DiffForgeNotificationDelegate"]
        #[ivars = ()]
        struct DiffForgeNotificationDelegate;

        unsafe impl NSObjectProtocol for DiffForgeNotificationDelegate {}

        unsafe impl UNUserNotificationCenterDelegate for DiffForgeNotificationDelegate {
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present_notification(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                completion_handler: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                completion_handler.call((
                    UNNotificationPresentationOptions::Banner
                        | UNNotificationPresentationOptions::List
                        | UNNotificationPresentationOptions::Sound,
                ));
            }
        }
    );

    impl DiffForgeNotificationDelegate {
        fn new() -> Retained<Self> {
            let this = Self::alloc().set_ivars(());
            unsafe { msg_send![super(this), init] }
        }
    }

    pub(super) fn show(
        title: &str,
        body: &str,
        urgency: NativeNotificationUrgency,
    ) -> Result<(), String> {
        let center = UNUserNotificationCenter::currentNotificationCenter();
        install_delegate(&center);
        ensure_authorized(&center)?;

        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(title));
        content.setBody(&NSString::from_str(body));
        content.setSound(Some(&UNNotificationSound::defaultSound()));
        if urgency == NativeNotificationUrgency::Attention {
            content.setInterruptionLevel(UNNotificationInterruptionLevel::TimeSensitive);
        }

        let identifier = NSString::from_str(&format!(
            "ai.diffforge.desktop.{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis())
                .unwrap_or_default()
        ));
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &identifier,
            &content,
            None,
        );
        center.addNotificationRequest_withCompletionHandler(&request, None);
        Ok(())
    }

    fn install_delegate(center: &UNUserNotificationCenter) {
        let _ = DELEGATE_PTR.get_or_init(|| {
            let delegate = DiffForgeNotificationDelegate::new();
            center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
            Retained::into_raw(delegate) as usize
        });
    }

    fn ensure_authorized(center: &UNUserNotificationCenter) -> Result<(), String> {
        if AUTH_REQUESTED.get().copied() == Some(true) {
            return Ok(());
        }

        let options = UNAuthorizationOptions::Alert
            | UNAuthorizationOptions::Sound
            | UNAuthorizationOptions::Badge;
        let (sender, receiver) = mpsc::channel();
        let completion = RcBlock::new(move |granted: Bool, error: *mut NSError| {
            let _ = sender.send(error.is_null() && granted.as_bool());
        });
        center.requestAuthorizationWithOptions_completionHandler(options, &completion);
        let granted = receiver.recv_timeout(AUTH_TIMEOUT).unwrap_or(true);
        let _ = AUTH_REQUESTED.set(granted);
        if granted {
            Ok(())
        } else {
            Err("Native notification permission was not granted for Diff Forge AI.".to_string())
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_user_notification_show(
    title: &str,
    body: &str,
    urgency: NativeNotificationUrgency,
) -> Result<(), String> {
    macos_native_notifications::show(title, body, urgency)
}

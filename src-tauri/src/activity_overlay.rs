const ACTIVITY_OVERLAY_DEFAULT_WIDTH: f64 = 360.0;
const ACTIVITY_OVERLAY_DEFAULT_HEIGHT: f64 = 216.0;
const ACTIVITY_OVERLAY_CORNER_MARGIN: i32 = 18;

fn size_activity_overlay_window(window: &tauri::WebviewWindow) {
    let _ = window.set_size(tauri::LogicalSize::new(
        ACTIVITY_OVERLAY_DEFAULT_WIDTH,
        ACTIVITY_OVERLAY_DEFAULT_HEIGHT,
    ));
}

fn position_activity_overlay_window(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let work_area = monitor.work_area();
    let x = work_area.position.x + ACTIVITY_OVERLAY_CORNER_MARGIN;
    let y = work_area.position.y + ACTIVITY_OVERLAY_CORNER_MARGIN;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

/// Cross-Space style for the hotkey-summoned activity widget. Tauri's
/// `always_on_top` only floats above ordinary windows; showing the widget
/// while another app owns a fullscreen Space also needs AppKit's
/// FullScreenAuxiliary behavior and a level above the fullscreen window.
/// Re-asserted on ensure/show because these are mutable NSWindow properties.
#[cfg(target_os = "macos")]
fn activity_overlay_apply_macos_space_style(window: &tauri::WebviewWindow) {
    snipping_convert_overlay_window_to_panel(window);
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("activity_overlay_apply_macos_space_style", || {
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
                    | objc2_app_kit::NSWindowCollectionBehavior::Transient
                    | objc2_app_kit::NSWindowCollectionBehavior::Stationary
                    | objc2_app_kit::NSWindowCollectionBehavior::IgnoresCycle,
            );
            ns_window.setLevel(objc2_app_kit::NSScreenSaverWindowLevel);
            ns_window.setHidesOnDeactivate(false);
            ns_window.setAcceptsMouseMovedEvents(true);
        });
    });
}

/// Surfaces the widget even while Diff Forge is not the active app, such as
/// when the hotkey fires inside another app's fullscreen Space.
#[cfg(target_os = "macos")]
fn activity_overlay_order_front_regardless(window: &tauri::WebviewWindow) {
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("activity_overlay_order_front_regardless", || {
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

fn ensure_activity_overlay_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    let _span = BackendCpuSpan::new("activity_overlay.ensure_window");
    if let Some(window) = app.get_webview_window(ACTIVITY_OVERLAY_WINDOW_LABEL) {
        size_activity_overlay_window(&window);
        #[cfg(target_os = "macos")]
        activity_overlay_apply_macos_space_style(&window);
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        ACTIVITY_OVERLAY_WINDOW_LABEL,
        WebviewUrl::App("index.html#/activity-overlay".into()),
    )
    .title("Activity")
    .inner_size(ACTIVITY_OVERLAY_DEFAULT_WIDTH, ACTIVITY_OVERLAY_DEFAULT_HEIGHT)
    .min_inner_size(320.0, 174.0)
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
    .map_err(|error| format!("Unable to create activity overlay: {error}"))?;

    position_activity_overlay_window(&window);
    let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
    Ok(window)
}

fn activity_overlay_status_for(app: &AppHandle) -> ActivityOverlayVisibility {
    let _span = BackendCpuSpan::new("activity_overlay.status");
    let visible = app
        .get_webview_window(ACTIVITY_OVERLAY_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    ActivityOverlayVisibility {
        visible,
        shortcut: ACTIVITY_OVERLAY_SHORTCUT.to_string(),
    }
}

fn emit_activity_overlay_visibility_changed(app: &AppHandle, visible: bool) {
    let _ = app.emit(
        ACTIVITY_OVERLAY_VISIBILITY_CHANGED_EVENT,
        ActivityOverlayVisibility {
            visible,
            shortcut: ACTIVITY_OVERLAY_SHORTCUT.to_string(),
        },
    );
}

fn show_activity_overlay_for(app: &AppHandle, focus: bool) -> Result<ActivityOverlayVisibility, String> {
    let window = ensure_activity_overlay_window(app)?;
    window
        .show()
        .map_err(|error| format!("Unable to show activity overlay: {error}"))?;
    #[cfg(target_os = "macos")]
    {
        activity_overlay_apply_macos_space_style(&window);
        activity_overlay_order_front_regardless(&window);
    }
    if focus {
        let _ = window.set_focus();
    }

    emit_activity_overlay_visibility_changed(app, true);
    Ok(ActivityOverlayVisibility {
        visible: true,
        shortcut: ACTIVITY_OVERLAY_SHORTCUT.to_string(),
    })
}

fn hide_activity_overlay_for(app: &AppHandle) -> Result<ActivityOverlayVisibility, String> {
    if let Some(window) = app.get_webview_window(ACTIVITY_OVERLAY_WINDOW_LABEL) {
        window
            .hide()
            .map_err(|error| format!("Unable to hide activity overlay: {error}"))?;
    }

    emit_activity_overlay_visibility_changed(app, false);
    Ok(ActivityOverlayVisibility {
        visible: false,
        shortcut: ACTIVITY_OVERLAY_SHORTCUT.to_string(),
    })
}

fn toggle_activity_overlay_for(app: &AppHandle) -> Result<ActivityOverlayVisibility, String> {
    let visible = app
        .get_webview_window(ACTIVITY_OVERLAY_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    if visible {
        hide_activity_overlay_for(app)
    } else {
        show_activity_overlay_for(app, true)
    }
}

fn register_activity_overlay_shortcut(app: &AppHandle) {
    if crate::daemon_mode_active() {
        return;
    }
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
    let result = app.global_shortcut().on_shortcut(shortcut, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            let _ = toggle_activity_overlay_for(app);
        }
    });

    if let Err(error) = result {
        eprintln!("Unable to register activity overlay shortcut: {error}");
    }
}

#[tauri::command]
async fn activity_overlay_status(app: AppHandle) -> Result<ActivityOverlayVisibility, String> {
    Ok(activity_overlay_status_for(&app))
}

#[tauri::command]
async fn show_activity_overlay(app: AppHandle) -> Result<ActivityOverlayVisibility, String> {
    show_activity_overlay_for(&app, true)
}

#[tauri::command]
async fn hide_activity_overlay(app: AppHandle) -> Result<ActivityOverlayVisibility, String> {
    hide_activity_overlay_for(&app)
}

#[tauri::command]
async fn toggle_activity_overlay(app: AppHandle) -> Result<ActivityOverlayVisibility, String> {
    toggle_activity_overlay_for(&app)
}

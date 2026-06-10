// Background mode: the app keeps running with the main window hidden, with a
// cross-platform tray icon and a small monitor window (activity + tokenomics)
// as the visible surface. Entering/leaving background never tears anything
// down — terminals, sync, hotkeys, and the todo ledger are process-scoped.

const BACKGROUND_MONITOR_WINDOW_LABEL: &str = "background-monitor";
const BACKGROUND_MODE_CHANGED_EVENT: &str = "forge-background-mode-changed";

static APP_BACKGROUND_MODE: AtomicBool = AtomicBool::new(false);

pub(crate) fn app_is_in_background_mode() -> bool {
    APP_BACKGROUND_MODE.load(Ordering::Acquire)
}

fn background_monitor_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window(BACKGROUND_MONITOR_WINDOW_LABEL) {
        return Some(window);
    }
    WebviewWindowBuilder::new(
        app,
        BACKGROUND_MONITOR_WINDOW_LABEL,
        WebviewUrl::App("index.html#/background-monitor".into()),
    )
    .title("Diff Forge Monitor")
    .inner_size(440.0, 620.0)
    .min_inner_size(360.0, 480.0)
    .resizable(true)
    .visible(false)
    .build()
    .ok()
}

fn background_monitor_show(app: &AppHandle) {
    if let Some(window) = background_monitor_window(app) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn background_mode_emit_changed(app: &AppHandle, background: bool) {
    let _ = app.emit(
        BACKGROUND_MODE_CHANGED_EVENT,
        json!({ "background": background }),
    );
}

pub(crate) fn app_enter_background_internal(app: &AppHandle) {
    APP_BACKGROUND_MODE.store(true, Ordering::Release);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    background_monitor_show(app);
    background_mode_emit_changed(app, true);
    log_terminal_status_event(
        "backend.background_mode.entered",
        json!({ "monitor_window": BACKGROUND_MONITOR_WINDOW_LABEL }),
    );
}

pub(crate) fn app_exit_background_internal(app: &AppHandle) {
    APP_BACKGROUND_MODE.store(false, Ordering::Release);
    if let Some(monitor) = app.get_webview_window(BACKGROUND_MONITOR_WINDOW_LABEL) {
        let _ = monitor.hide();
    }
    let _ = restore_main_window(app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    background_mode_emit_changed(app, false);
    log_terminal_status_event("backend.background_mode.exited", json!({}));
}

#[tauri::command]
async fn app_enter_background(app: AppHandle) -> Result<(), String> {
    app_enter_background_internal(&app);
    Ok(())
}

#[tauri::command]
async fn app_exit_background(app: AppHandle) -> Result<(), String> {
    app_exit_background_internal(&app);
    Ok(())
}

#[tauri::command]
fn app_background_mode_state() -> Result<Value, String> {
    Ok(json!({ "background": app_is_in_background_mode() }))
}

/// Cross-platform tray icon: left click opens the monitor while backgrounded
/// (or focuses the app otherwise); the menu offers open / monitor / quit.
/// Quit routes through the existing graceful-shutdown choreography by
/// emitting the same close-requested event the window close path uses.
pub(crate) fn setup_background_tray(app: &tauri::App) {
    let Some(icon) = app.default_window_icon().cloned() else {
        return;
    };
    let menu_items = (
        tauri::menu::MenuItem::with_id(app, "diffforge-open", "Open Diff Forge", true, None::<&str>),
        tauri::menu::MenuItem::with_id(app, "diffforge-monitor", "Activity Monitor", true, None::<&str>),
        tauri::menu::MenuItem::with_id(app, "diffforge-quit", "Quit Diff Forge", true, None::<&str>),
    );
    let (Ok(open_item), Ok(monitor_item), Ok(quit_item)) = menu_items else {
        return;
    };
    let Ok(menu) = tauri::menu::Menu::with_items(app, &[&open_item, &monitor_item, &quit_item])
    else {
        return;
    };
    let tray = tauri::tray::TrayIconBuilder::with_id("diffforge-tray")
        .icon(icon)
        .tooltip("Diff Forge AI")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "diffforge-open" => {
                app_exit_background_internal(app);
            }
            "diffforge-monitor" => {
                background_monitor_show(app);
            }
            "diffforge-quit" => {
                // Surface the main window so the shutdown progress and any
                // active-terminal confirmation are visible, then reuse the
                // existing close choreography.
                let _ = restore_main_window(app);
                let _ = app.emit(
                    APP_CLOSE_REQUESTED_EVENT,
                    json!({
                        "reason": "tray_quit",
                        "source": "background_tray",
                    }),
                );
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if app_is_in_background_mode() {
                    background_monitor_show(app);
                } else {
                    let _ = restore_main_window(app);
                }
            }
        })
        .build(app);
    if let Err(error) = tray {
        log_terminal_status_event(
            "backend.background_mode.tray_error",
            json!({ "error": error.to_string() }),
        );
    }
}

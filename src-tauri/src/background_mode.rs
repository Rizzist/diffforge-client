// Background mode: the app keeps running with the main window hidden, with a
// cross-platform tray icon and a small monitor window (activity + tokenomics)
// as the visible surface. Entering/leaving background never tears anything
// down — terminals, sync, hotkeys, and the todo ledger are process-scoped.

const BACKGROUND_MONITOR_WINDOW_LABEL: &str = "background-monitor";
const BACKGROUND_MODE_CHANGED_EVENT: &str = "forge-background-mode-changed";
const BACKGROUND_MONITOR_WIDTH: f64 = 380.0;
const BACKGROUND_MONITOR_HEIGHT: f64 = 540.0;
const BACKGROUND_MONITOR_BLUR_TOGGLE_GRACE_MS: u64 = 350;

static APP_BACKGROUND_MODE: AtomicBool = AtomicBool::new(false);
static BACKGROUND_MONITOR_LAST_BLUR_HIDE_MS: AtomicU64 = AtomicU64::new(0);

pub(crate) fn app_is_in_background_mode() -> bool {
    APP_BACKGROUND_MODE.load(Ordering::Acquire)
}

/// The monitor is a tray-anchored popover, not a regular window: frameless,
/// always on top, hidden from the taskbar/dock, and auto-hiding on focus
/// loss — a menu-bar dropdown on macOS, an above-tray flyout on Windows.
fn background_monitor_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window(BACKGROUND_MONITOR_WINDOW_LABEL) {
        return Some(window);
    }
    let window = WebviewWindowBuilder::new(
        app,
        BACKGROUND_MONITOR_WINDOW_LABEL,
        WebviewUrl::App("index.html#/background-monitor".into()),
    )
    .title("Diff Forge Monitor")
    .inner_size(BACKGROUND_MONITOR_WIDTH, BACKGROUND_MONITOR_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .accept_first_mouse(true)
    .focused(false)
    .visible(false)
    .build()
    .ok()?;
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_visible_on_all_workspaces(true);
    }
    let blur_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            BACKGROUND_MONITOR_LAST_BLUR_HIDE_MS
                .store(todo_dispatch_now_ms(), Ordering::Release);
            let _ = blur_window.hide();
        }
    });
    Some(window)
}

/// Anchor the popover to a screen point: panels near the top of the monitor
/// (macOS menu bar) drop below the anchor; panels near the bottom (Windows /
/// most Linux taskbars) flip above it. Always clamped into the monitor.
fn background_monitor_position_for_anchor(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    anchor_x: f64,
    anchor_y: f64,
) -> tauri::PhysicalPosition<i32> {
    let size = window.outer_size().unwrap_or(tauri::PhysicalSize {
        width: BACKGROUND_MONITOR_WIDTH as u32,
        height: BACKGROUND_MONITOR_HEIGHT as u32,
    });
    let monitor = app
        .monitor_from_point(anchor_x, anchor_y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let (monitor_position, monitor_size, scale) = monitor
        .map(|monitor| (*monitor.position(), *monitor.size(), monitor.scale_factor()))
        .unwrap_or((
            tauri::PhysicalPosition::new(0, 0),
            tauri::PhysicalSize::new(1920, 1080),
            1.0,
        ));
    let margin = (10.0 * scale).round() as i32;
    let width = size.width as i32;
    let height = size.height as i32;
    let monitor_right = monitor_position.x + monitor_size.width as i32;
    let monitor_bottom = monitor_position.y + monitor_size.height as i32;

    let x = ((anchor_x as i32) - width / 2)
        .clamp(monitor_position.x + margin, (monitor_right - width - margin).max(monitor_position.x + margin));
    let anchor_y = anchor_y as i32;
    let monitor_mid = monitor_position.y + (monitor_size.height as i32) / 2;
    let raw_y = if anchor_y < monitor_mid {
        anchor_y + margin * 2
    } else {
        anchor_y - height - margin * 2
    };
    let y = raw_y.clamp(
        monitor_position.y + margin,
        (monitor_bottom - height - margin).max(monitor_position.y + margin),
    );
    tauri::PhysicalPosition::new(x, y)
}

fn background_monitor_show_at(app: &AppHandle, anchor: Option<(f64, f64)>) {
    let Some(window) = background_monitor_window(app) else {
        return;
    };
    if let Some((anchor_x, anchor_y)) = anchor {
        let position = background_monitor_position_for_anchor(app, &window, anchor_x, anchor_y);
        let _ = window.set_position(tauri::Position::Physical(position));
    }
    let _ = window.show();
    let _ = window.set_focus();
}

/// Tray-click toggle: hide when visible; ignore the click that just
/// blur-hid the popover (clicking the tray steals focus first, so without
/// the grace window the popover would hide and instantly reopen).
fn background_monitor_toggle_at(app: &AppHandle, anchor: Option<(f64, f64)>) {
    let Some(window) = background_monitor_window(app) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    let now = todo_dispatch_now_ms();
    if now.saturating_sub(BACKGROUND_MONITOR_LAST_BLUR_HIDE_MS.load(Ordering::Acquire))
        < BACKGROUND_MONITOR_BLUR_TOGGLE_GRACE_MS
    {
        return;
    }
    background_monitor_show_at(app, anchor);
}

/// Fallback anchor for entry points without a click position (tray menu):
/// the tray corner — top-right on macOS, bottom-right elsewhere.
fn background_monitor_show_near_tray_corner(app: &AppHandle) {
    let monitor = app.primary_monitor().ok().flatten();
    let (position, size) = monitor
        .map(|monitor| (*monitor.position(), *monitor.size()))
        .unwrap_or((
            tauri::PhysicalPosition::new(0, 0),
            tauri::PhysicalSize::new(1920, 1080),
        ));
    let right = position.x as f64 + size.width as f64 - 24.0;
    #[cfg(target_os = "macos")]
    let anchor = (right, position.y as f64 + 8.0);
    #[cfg(not(target_os = "macos"))]
    let anchor = (right, position.y as f64 + size.height as f64 - 8.0);
    background_monitor_show_at(app, Some(anchor));
}

fn background_mode_emit_changed(app: &AppHandle, background: bool) {
    let _ = app.emit(
        BACKGROUND_MODE_CHANGED_EVENT,
        json!({ "background": background }),
    );
}

pub(crate) fn app_enter_background_internal(app: &AppHandle) {
    APP_BACKGROUND_MODE.store(true, Ordering::Release);
    background_tray_create(app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    // Pre-create the hidden popover so the first tray click is instant.
    let _ = background_monitor_window(app);
    background_mode_emit_changed(app, true);
    log_terminal_status_event(
        "backend.background_mode.entered",
        json!({ "monitor_window": BACKGROUND_MONITOR_WINDOW_LABEL }),
    );
}

pub(crate) fn app_exit_background_internal(app: &AppHandle) {
    APP_BACKGROUND_MODE.store(false, Ordering::Release);
    background_tray_remove(app);
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

/// Cross-platform tray icon, present only while background mode is active:
/// left click opens the monitor; the menu offers open / monitor / quit.
/// Quit routes through the existing graceful-shutdown choreography by
/// emitting the same close-requested event the window close path uses.
fn background_tray_create(app: &AppHandle) {
    if app.tray_by_id("diffforge-tray").is_some() {
        return;
    }
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
        .tooltip("Diff Forge AI — running in background")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "diffforge-open" => {
                app_exit_background_internal(app);
            }
            "diffforge-monitor" => {
                background_monitor_show_near_tray_corner(app);
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
                position,
                ..
            } = event
            {
                let app = tray.app_handle();
                if app_is_in_background_mode() {
                    background_monitor_toggle_at(app, Some((position.x, position.y)));
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

fn background_tray_remove(app: &AppHandle) {
    let _ = app.remove_tray_by_id("diffforge-tray");
}

// Background mode: the app keeps running with the main window hidden, with a
// small monitor window (activity + tokenomics tabs, plus a Snippets button
// that dismisses the popover and launches the full-width recent-snips strip)
// as the visible surface. The cross-platform tray icon lives for the whole
// app lifetime, with configurable foreground/background click behavior.
// Entering/leaving background never tears anything down — terminals, sync,
// hotkeys, and the todo ledger are process-scoped.

const BACKGROUND_MONITOR_WINDOW_LABEL: &str = "background-monitor";
const BACKGROUND_MODE_CHANGED_EVENT: &str = "forge-background-mode-changed";
const BACKGROUND_MONITOR_WIDTH: f64 = 430.0;
const BACKGROUND_MONITOR_HEIGHT: f64 = 600.0;
const BACKGROUND_MONITOR_BLUR_TOGGLE_GRACE_MS: u64 = 350;
const BACKGROUND_MONITOR_ANIM_EVENT: &str = "forge-background-monitor-anim";
const BACKGROUND_MONITOR_OPEN_TAB_EVENT: &str = "forge-background-monitor-open-tab";
const OPEN_AUDIO_HISTORY_EVENT: &str = "forge-open-audio-history";
const BACKGROUND_MONITOR_CLOSE_ANIM_MS: u64 = 190;

static APP_BACKGROUND_MODE: AtomicBool = AtomicBool::new(false);
static BACKGROUND_MONITOR_LAST_BLUR_HIDE_MS: AtomicU64 = AtomicU64::new(0);

pub(crate) fn app_is_in_background_mode() -> bool {
    APP_BACKGROUND_MODE.load(Ordering::Acquire)
}

/// The monitor is a tray-anchored popover, not a regular window: frameless,
/// always on top, hidden from the taskbar/dock, and auto-hiding on focus
/// loss — a menu-bar dropdown on macOS, an above-tray flyout on Windows.
fn background_monitor_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if crate::daemon_mode_active() {
        return None;
    }
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
    .background_color(Color(0, 0, 0, 0))
    .build()
    .ok()?;
    // A transparent window still paints the webview's default backdrop until
    // the background color is cleared — that backdrop is the faint full-size
    // square visible around the popover card.
    let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_visible_on_all_workspaces(true);
        background_monitor_apply_macos_popover_style(&window);
    }
    let blur_window = window.clone();
    let blur_app = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            if !blur_window.is_visible().unwrap_or(false) {
                return;
            }
            BACKGROUND_MONITOR_LAST_BLUR_HIDE_MS
                .store(todo_dispatch_now_ms(), Ordering::Release);
            background_monitor_hide_animated(&blur_app, blur_window.clone(), true);
        }
    });
    Some(window)
}

/// Menu-bar dropdown window style, the same recipe the snipping overlay uses
/// to appear over OTHER apps' fullscreen Spaces: CanJoinAllSpaces alone does
/// not join fullscreen Spaces — the popover also needs FullScreenAuxiliary —
/// and tao's always-on-top floating level is not reliably above a fullscreen
/// Space's window, so the popover runs at status-bar level like a real
/// NSStatusItem dropdown. Re-asserted on every show since both values are
/// plain NSWindow state that other window calls may rewrite.
#[cfg(target_os = "macos")]
fn background_monitor_apply_macos_popover_style(window: &tauri::WebviewWindow) {
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(ns_window) = window_for_main.ns_window() else {
            return;
        };
        if ns_window.is_null() {
            return;
        }
        let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
        ns_window.setCollectionBehavior(
            objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllSpaces
                | objc2_app_kit::NSWindowCollectionBehavior::FullScreenAuxiliary
                | objc2_app_kit::NSWindowCollectionBehavior::IgnoresCycle,
        );
        ns_window.setLevel(objc2_app_kit::NSStatusWindowLevel);
    });
}

/// Surfaces the popover even while Diff Forge is NOT the active app (tray
/// clicks from another app's fullscreen Space): makeKeyAndOrderFront does
/// nothing visible there, orderFrontRegardless is the documented way.
#[cfg(target_os = "macos")]
fn background_monitor_order_front_regardless(window: &tauri::WebviewWindow) {
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(ns_window) = window_for_main.ns_window() else {
            return;
        };
        if ns_window.is_null() {
            return;
        }
        let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
        ns_window.orderFrontRegardless();
    });
}

/// Anchor the popover to a screen point: panels near the top of the monitor
/// (macOS menu bar) drop below the anchor; panels near the bottom (Windows /
/// most Linux taskbars) flip above it. Always clamped into the monitor.
fn background_monitor_position_for_anchor(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    anchor_x: f64,
    anchor_y: f64,
) -> (tauri::PhysicalPosition<i32>, &'static str) {
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
    let drops_below = anchor_y < monitor_mid;
    let raw_y = if drops_below {
        anchor_y + margin * 2
    } else {
        anchor_y - height - margin * 2
    };
    let y = raw_y.clamp(
        monitor_position.y + margin,
        (monitor_bottom - height - margin).max(monitor_position.y + margin),
    );
    (
        tauri::PhysicalPosition::new(x, y),
        // Animation origin: dropping below a menu-bar icon scales from the
        // top edge; flying up from a taskbar icon scales from the bottom.
        if drops_below { "top" } else { "bottom" },
    )
}

fn background_monitor_emit_anim(app: &AppHandle, phase: &str, origin: Option<&str>) {
    let mut payload = json!({ "phase": phase });
    if let Some(origin) = origin {
        payload["origin"] = json!(origin);
    }
    let _ = app.emit_to(
        BACKGROUND_MONITOR_WINDOW_LABEL,
        BACKGROUND_MONITOR_ANIM_EVENT,
        payload,
    );
}

/// Plays the close micro-animation in the webview, then hides the window.
/// `only_if_unfocused` is the blur path: a quick refocus cancels the hide.
fn background_monitor_hide_animated(
    app: &AppHandle,
    window: tauri::WebviewWindow,
    only_if_unfocused: bool,
) {
    background_monitor_emit_anim(app, "close", None);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(BACKGROUND_MONITOR_CLOSE_ANIM_MS)).await;
        let _ = app.run_on_main_thread(move || {
            if only_if_unfocused && window.is_focused().unwrap_or(false) {
                return;
            }
            let _ = window.hide();
        });
    });
}

fn background_monitor_show_at(app: &AppHandle, anchor: Option<(f64, f64)>) {
    let Some(window) = background_monitor_window(app) else {
        return;
    };
    let mut origin = "top";
    if let Some((anchor_x, anchor_y)) = anchor {
        let (position, anchor_origin) =
            background_monitor_position_for_anchor(app, &window, anchor_x, anchor_y);
        origin = anchor_origin;
        let _ = window.set_position(tauri::Position::Physical(position));
    }
    #[cfg(target_os = "macos")]
    background_monitor_apply_macos_popover_style(&window);
    // Like the popover style above, the cleared webview backdrop is plain
    // window state — re-assert it so the full-size square never comes back.
    let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
    let _ = window.show();
    #[cfg(target_os = "macos")]
    background_monitor_order_front_regardless(&window);
    let _ = window.set_focus();
    background_monitor_emit_anim(app, "open", Some(origin));
}

/// Tray-click toggle: hide when visible; ignore the click that just
/// blur-hid the popover (clicking the tray steals focus first, so without
/// the grace window the popover would hide and instantly reopen).
fn background_monitor_toggle_at(app: &AppHandle, anchor: Option<(f64, f64)>) {
    let Some(window) = background_monitor_window(app) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        background_monitor_hide_animated(app, window, false);
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

// Tray icons are NSStatusItems on macOS (and shell handles elsewhere):
// creating or dropping them — and creating popover windows — off the main
// thread crashes the app. The enter/exit commands run on the async command
// runtime, so all UI work below is marshalled onto the main thread; the mode
// flag flips synchronously so toggling stays race-free for callers.
pub(crate) fn app_enter_background_internal(app: &AppHandle) {
    if crate::daemon_mode_active() {
        return;
    }
    APP_BACKGROUND_MODE.store(true, Ordering::Release);
    let main_app = app.clone();
    let scheduled = app.run_on_main_thread(move || {
        background_tray_create(&main_app);
        // Run as an accessory app (no Dock icon) while backgrounded, the way
        // menu-bar apps do: activating the popover from another app's
        // fullscreen Space then cannot trigger a Space switch (which showed
        // as a black menu bar instead of the dropdown).
        #[cfg(target_os = "macos")]
        let _ = main_app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        if let Some(main) = main_app.get_window("main") {
            let _ = main.hide();
        }
        // Pre-create the hidden popover so monitor actions are instant.
        let _ = background_monitor_window(&main_app);
        background_mode_emit_changed(&main_app, true);
        todo_dispatch_wake_background_dispatcher(main_app.clone());
        log_terminal_status_event(
            "backend.background_mode.entered",
            json!({ "monitor_window": BACKGROUND_MONITOR_WINDOW_LABEL }),
        );
    });
    if let Err(error) = scheduled {
        APP_BACKGROUND_MODE.store(false, Ordering::Release);
        log_terminal_status_event(
            "backend.background_mode.enter_schedule_error",
            json!({ "error": error.to_string() }),
        );
    }
}

pub(crate) fn app_exit_background_internal(app: &AppHandle) {
    if crate::daemon_mode_active() {
        return;
    }
    APP_BACKGROUND_MODE.store(false, Ordering::Release);
    let main_app = app.clone();
    let scheduled = app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        let _ = main_app.set_activation_policy(tauri::ActivationPolicy::Regular);
        // Restore the main window FIRST: even if tray/popover teardown were
        // to fail, the user always gets their window back.
        let _ = restore_main_window(&main_app);
        if let Some(main) = main_app.get_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }
        if let Some(monitor) = main_app.get_webview_window(BACKGROUND_MONITOR_WINDOW_LABEL) {
            let _ = monitor.hide();
        }
        // The tray icon stays: with the main window up it serves as the
        // recent-snips strip toggle.
        background_mode_emit_changed(&main_app, false);
        log_terminal_status_event("backend.background_mode.exited", json!({}));
    });
    if let Err(error) = scheduled {
        log_terminal_status_event(
            "backend.background_mode.exit_schedule_error",
            json!({ "error": error.to_string() }),
        );
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn app_enter_background(app: AppHandle) -> Result<(), String> {
    app_enter_background_internal(&app);
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
async fn app_exit_background(app: AppHandle) -> Result<(), String> {
    app_exit_background_internal(&app);
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
fn app_background_mode_state() -> Result<Value, String> {
    Ok(json!({ "background": app_is_in_background_mode() }))
}

/// The dictation bar's History button: surface dictation history wherever it
/// lives right now. In background mode (or with the main window hidden) that
/// is the tray popover's Activity tab; otherwise the main window comes
/// forward on its Audio view.
#[tauri::command(rename_all = "snake_case")]
async fn background_monitor_open_activity(app: AppHandle) -> Result<(), String> {
    if crate::daemon_mode_active() {
        return Ok(());
    }
    let main_visible = app
        .get_window("main")
        .map(|main| main.is_visible().unwrap_or(false))
        .unwrap_or(false);
    if app_is_in_background_mode() || !main_visible {
        let monitor_app = app.clone();
        let _ = app.run_on_main_thread(move || {
            background_monitor_show_near_tray_corner(&monitor_app);
            // After show so a pre-created popover's listener is live; a
            // freshly created one reads the same tab from localStorage.
            let _ = monitor_app.emit(BACKGROUND_MONITOR_OPEN_TAB_EVENT, json!({ "tab": "activity" }));
        });
        return Ok(());
    }
    if let Some(main) = app.get_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = app.emit(OPEN_AUDIO_HISTORY_EVENT, json!({}));
    Ok(())
}

/// The monitor popover's Snippets button: the strip is its own full-width
/// surface, never embedded inside the dropdown — dismiss the popover and
/// surface the bar in its place.
#[tauri::command(rename_all = "snake_case")]
fn background_monitor_open_snip_strip(app: AppHandle) -> Result<(), String> {
    if crate::daemon_mode_active() {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window(BACKGROUND_MONITOR_WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            background_monitor_hide_animated(&app, window, false);
        }
    }
    snipping_strip_show(&app);
    Ok(())
}

/// Cross-platform tray icon, present for the whole app lifetime. Left click
/// uses persisted foreground/background actions, defaulting to the historical
/// recent-snips strip in foreground and monitor popover in background.
/// Quit routes through the existing graceful-shutdown choreography by
/// emitting the same close-requested event the window close path uses.
pub(crate) fn background_tray_create(app: &AppHandle) {
    if crate::daemon_mode_active() {
        return;
    }
    if app.tray_by_id("diffforge-tray").is_some() {
        return;
    }
    let Some(icon) = app.default_window_icon().cloned() else {
        return;
    };
    let menu_items = (
        tauri::menu::MenuItem::with_id(app, "diffforge-open", "Open Diff Forge", true, None::<&str>),
        tauri::menu::MenuItem::with_id(app, "diffforge-monitor", "Activity Monitor", true, None::<&str>),
        tauri::menu::MenuItem::with_id(app, "diffforge-snips", "Recent Snips", true, None::<&str>),
        tauri::menu::MenuItem::with_id(app, "diffforge-quit", "Quit Diff Forge", true, None::<&str>),
    );
    let (Ok(open_item), Ok(monitor_item), Ok(snips_item), Ok(quit_item)) = menu_items else {
        return;
    };
    let Ok(menu) =
        tauri::menu::Menu::with_items(app, &[&open_item, &monitor_item, &snips_item, &quit_item])
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
                if snipping_recording_active(app) {
                    let _ = snipping_stop_recording_for(app, "tray-menu");
                    return;
                }
                present_main_window(app);
            }
            "diffforge-monitor" => {
                if snipping_recording_active(app) {
                    let _ = snipping_stop_recording_for(app, "tray-menu");
                    return;
                }
                background_monitor_show_near_tray_corner(app);
            }
            "diffforge-snips" => {
                if snipping_recording_active(app) {
                    let _ = snipping_stop_recording_for(app, "tray-menu");
                    return;
                }
                snipping_strip_toggle(app);
            }
            "diffforge-quit" => {
                // Surface the main window so the shutdown progress and any
                // active-terminal progress are visible, then start backend
                // shutdown directly. Routing this through the frontend close
                // event is fragile if the close-options dialog is already
                // open, because the webview intentionally ignores duplicate
                // close requests while that dialog is active.
                let _ = restore_main_window(app);
                let _ = start_backend_app_shutdown(app.clone(), "main".to_string());
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
                if snipping_recording_active(app) {
                    let _ = snipping_stop_recording_for(app, "tray-click");
                    return;
                }
                let background = app_is_in_background_mode();
                match tray_click_cached_action(background) {
                    TrayClickAction::SnipStrip => snipping_strip_toggle(app),
                    TrayClickAction::Monitor => {
                        background_monitor_toggle_at(app, Some((position.x, position.y)));
                    }
                    TrayClickAction::OpenApp => present_main_window(app),
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
    // Pre-create the hidden strip so its webview is booted before the first
    // snip-strip action: an open-anim event emitted into a still-loading
    // webview is lost, which showed as an invisible-but-clickable bar.
    let _ = snipping_strip_window(app);
}

fn validate_workspace_webview_label(label: &str) -> Result<(), String> {
    let valid = label.starts_with("workspace-web-")
        && label.len() <= 96
        && label
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));

    if valid {
        Ok(())
    } else {
        Err("Invalid workspace webview label.".to_string())
    }
}

const WORKSPACE_WEBVIEW_EVAL_MAX_SCRIPT_BYTES: usize = 160 * 1024;
const WORKSPACE_WEBVIEW_EVAL_TIMEOUT_MS: u64 = 2_500;

fn close_workspace_webviews(app: &AppHandle) -> Result<usize, String> {
    let mut closed = 0;
    let mut errors = Vec::new();

    for (label, webview) in app.webviews() {
        if validate_workspace_webview_label(&label).is_err() {
            continue;
        }

        let _ = webview.hide();
        match webview.close() {
            Ok(()) => {
                closed += 1;
            }
            Err(error) => {
                errors.push(format!("{label}: {error}"));
            }
        }
    }

    if errors.is_empty() {
        Ok(closed)
    } else {
        Err(format!(
            "Unable to close workspace web views: {}",
            errors.join("; ")
        ))
    }
}

fn workspace_webview_for_label(app: &AppHandle, label: &str) -> Option<tauri::Webview> {
    app.webviews().into_iter().find_map(|(webview_label, webview)| {
        if webview_label == label {
            Some(webview)
        } else {
            None
        }
    })
}

fn validate_workspace_webview_url(url: &str) -> Result<tauri::Url, String> {
    let parsed = tauri::Url::parse(url).map_err(|error| format!("Invalid web URL: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err("Workspace web views only support http and https URLs.".to_string()),
    }
}

#[tauri::command]
async fn workspace_webview_eval(
    app: AppHandle,
    label: String,
    script: String,
    expect_result: Option<bool>,
) -> Result<Value, String> {
    validate_workspace_webview_label(&label)?;
    if script.trim().is_empty() {
        return Err("Web view script is required.".to_string());
    }
    if script.len() > WORKSPACE_WEBVIEW_EVAL_MAX_SCRIPT_BYTES {
        return Err("Web view script is too large.".to_string());
    }
    let webview = workspace_webview_for_label(&app, &label)
        .ok_or_else(|| "Workspace web view is unavailable.".to_string())?;

    if expect_result == Some(false) {
        webview
            .eval(script)
            .map_err(|error| format!("Unable to evaluate workspace web view script: {error}"))?;
        return Ok(json!({ "ok": true }));
    }

    let (sender, receiver) = oneshot::channel::<String>();
    let sender = Arc::new(StdMutex::new(Some(sender)));
    let callback_sender = sender.clone();
    webview
        .eval_with_callback(script, move |result| {
            if let Ok(mut guard) = callback_sender.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(result);
                }
            }
        })
        .map_err(|error| format!("Unable to evaluate workspace web view script: {error}"))?;

    let raw = timeout(
        Duration::from_millis(WORKSPACE_WEBVIEW_EVAL_TIMEOUT_MS),
        receiver,
    )
    .await
    .map_err(|_| "Timed out reading workspace web view script result.".to_string())?
    .map_err(|_| "Workspace web view script result was canceled.".to_string())?;

    Ok(serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| json!({ "value": raw })))
}

#[tauri::command]
fn workspace_webview_open(
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    window_label: Option<String>,
) -> Result<(), String> {
    validate_workspace_webview_label(&label)?;
    let parsed_url = validate_workspace_webview_url(&url)?;
    // Default to the main window, but allow a breakout window (e.g. the web panel
    // pop-out) to host its own child webview by passing its own label.
    let parent_label = window_label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("main");
    let window = app
        .get_window(parent_label)
        .ok_or_else(|| "Host window is unavailable.".to_string())?;

    if let Some(existing) = workspace_webview_for_label(&app, &label) {
        let _ = existing.hide();
        let _ = existing.close();
    }

    let event_label = label.clone();
    let event_app = app.clone();
    let builder = tauri::webview::WebviewBuilder::new(
        label.clone(),
        WebviewUrl::External(parsed_url),
    )
    .accept_first_mouse(true)
    .disable_drag_drop_handler()
    .on_page_load(move |_webview, payload| {
        let event_name = match payload.event() {
            tauri::webview::PageLoadEvent::Started => "started",
            tauri::webview::PageLoadEvent::Finished => "finished",
        };
        let _ = event_app.emit(
            "workspace-webview-load",
            json!({
                "event": event_name,
                "label": event_label.as_str(),
                "url": payload.url().to_string(),
            }),
        );
    });

    let safe_width = width.max(24.0);
    let safe_height = height.max(24.0);
    let webview = window
        .add_child(
            builder,
            tauri::LogicalPosition::new(x.max(0.0), y.max(0.0)),
            tauri::LogicalSize::new(safe_width, safe_height),
        )
        .map_err(|error| format!("Unable to open workspace web view: {error}"))?;
    // The child webview is created already positioned over the viewport, so make it
    // visible right away. Gating visibility on the page-load "finished" event is
    // unreliable for child webviews on macOS and leaves the panel blank/black when
    // the event never arrives.
    let _ = webview.show();
    let _ = webview.set_focus();
    Ok(())
}

// Moves a living workspace webview into another host window (main <-> web panel
// pop-out) without reloading it, preserving page/session/JS state. Returns false
// when no webview exists for the label so callers can fall back to a fresh open.
#[tauri::command]
fn workspace_webview_adopt(
    app: AppHandle,
    label: String,
    window_label: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<bool, String> {
    validate_workspace_webview_label(&label)?;
    let Some(webview) = workspace_webview_for_label(&app, &label) else {
        return Ok(false);
    };
    let parent_label = window_label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("main");
    let window = app
        .get_window(parent_label)
        .ok_or_else(|| "Host window is unavailable.".to_string())?;
    webview
        .reparent(&window)
        .map_err(|error| format!("Unable to move workspace web view: {error}"))?;
    webview
        .set_position(tauri::LogicalPosition::new(x.max(0.0), y.max(0.0)))
        .map_err(|error| format!("Unable to position workspace web view: {error}"))?;
    webview
        .set_size(tauri::LogicalSize::new(width.max(24.0), height.max(24.0)))
        .map_err(|error| format!("Unable to size workspace web view: {error}"))?;
    let _ = webview.show();
    let _ = webview.set_focus();
    Ok(true)
}

#[tauri::command]
fn workspace_webview_fit(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    validate_workspace_webview_label(&label)?;
    let webview = workspace_webview_for_label(&app, &label)
        .ok_or_else(|| "Workspace web view is unavailable.".to_string())?;

    if width < 24.0 || height < 24.0 {
        let _ = webview.hide();
        return Ok(());
    }

    webview
        .set_position(tauri::LogicalPosition::new(x.max(0.0), y.max(0.0)))
        .map_err(|error| format!("Unable to position workspace web view: {error}"))?;
    webview
        .set_size(tauri::LogicalSize::new(width.max(24.0), height.max(24.0)))
        .map_err(|error| format!("Unable to size workspace web view: {error}"))?;

    if visible {
        let _ = webview.show();
    } else {
        let _ = webview.hide();
    }
    Ok(())
}

#[tauri::command]
fn workspace_webview_close(app: AppHandle, label: String) -> Result<(), String> {
    validate_workspace_webview_label(&label)?;
    if let Some(webview) = workspace_webview_for_label(&app, &label) {
        let _ = webview.hide();
        webview
            .close()
            .map_err(|error| format!("Unable to close workspace web view: {error}"))?;
    }
    Ok(())
}

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
fn workspace_webview_open(
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    validate_workspace_webview_label(&label)?;
    let parsed_url = validate_workspace_webview_url(&url)?;
    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window is unavailable.".to_string())?;

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
    .on_page_load(move |webview, payload| {
        let event_name = match payload.event() {
            tauri::webview::PageLoadEvent::Started => {
                let _ = webview.hide();
                "started"
            }
            tauri::webview::PageLoadEvent::Finished => {
                let _ = webview.show();
                "finished"
            }
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
    let _ = webview.hide();
    Ok(())
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

const WEB_PANEL_LABEL_PREFIX: &str = "web-panel-";
const WEB_PANEL_CLOSED_EVENT: &str = "forge-web-panel-closed";
const WEB_PANEL_WEBVIEW_PRESERVED_EVENT: &str = "forge-web-panel-webview-preserved";
const WEB_PANEL_DEFAULT_WIDTH: f64 = 1024.0;
const WEB_PANEL_DEFAULT_HEIGHT: f64 = 720.0;
const WEB_PANEL_MIN_WIDTH: f64 = 480.0;
const WEB_PANEL_MIN_HEIGHT: f64 = 320.0;
const WEB_PANEL_DEFAULT_URL: &str = "https://www.google.com";

#[derive(Serialize)]
struct WebPanelOpenResult {
    label: String,
}

fn web_panel_theme(value: Option<&str>) -> String {
    let normalized = value.unwrap_or_default().trim().to_ascii_lowercase();
    if matches!(normalized.as_str(), "dark" | "light") {
        normalized
    } else {
        "dark".to_string()
    }
}

fn web_panel_url(value: Option<&str>) -> String {
    let raw = value.unwrap_or_default().trim();
    if raw.is_empty() {
        return WEB_PANEL_DEFAULT_URL.to_string();
    }
    match tauri::Url::parse(raw) {
        Ok(parsed) if matches!(parsed.scheme(), "http" | "https") => parsed.to_string(),
        _ => WEB_PANEL_DEFAULT_URL.to_string(),
    }
}

fn web_panel_safe_label_part(value: &str, fallback: &str) -> String {
    let source = value.trim();
    let source = if source.is_empty() { fallback } else { source };
    let mut hash = 2166136261u32;
    for byte in source.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(16_777_619);
    }
    let mut slug = String::new();
    for character in source.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '_' | '-') {
            slug.push(character);
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
        if slug.len() >= 70 {
            break;
        }
    }
    let slug = slug.trim_matches('-');
    format!("{}-{hash:x}", if slug.is_empty() { fallback } else { slug })
}

fn web_panel_label(pane_id: &str) -> String {
    format!(
        "{WEB_PANEL_LABEL_PREFIX}{}",
        web_panel_safe_label_part(pane_id, "pane")
    )
}

fn validate_web_panel_label(label: &str) -> Result<(), String> {
    if label.starts_with(WEB_PANEL_LABEL_PREFIX)
        && label
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        Ok(())
    } else {
        Err("Invalid web panel label.".to_string())
    }
}

fn emit_web_panel_closed(app: &AppHandle, window_id: &str, pane_id: &str) {
    let _ = app.emit(
        WEB_PANEL_CLOSED_EVENT,
        json!({
            "paneId": pane_id,
            "windowId": window_id,
        }),
    );
}

// Before a web panel window closes, hand its child workspace webviews back to the
// main window (hidden, parked offscreen) so the living page survives the window
// and the grid pane can adopt it without a reload.
fn preserve_web_panel_child_webviews(app: &AppHandle, window_id: &str, pane_id: &str) {
    let Some(window) = app.get_window(window_id) else {
        return;
    };
    let Some(main_window) = app.get_window("main") else {
        return;
    };
    let mut preserved: Vec<String> = Vec::new();
    for webview in window.webviews() {
        let label = webview.label().to_string();
        if validate_workspace_webview_label(&label).is_err() {
            continue;
        }
        if webview.reparent(&main_window).is_err() {
            continue;
        }
        let _ = webview.hide();
        let _ = webview.set_position(tauri::LogicalPosition::new(100_000.0, 100_000.0));
        preserved.push(label);
    }
    if !preserved.is_empty() {
        let _ = app.emit(
            WEB_PANEL_WEBVIEW_PRESERVED_EVENT,
            json!({
                "paneId": pane_id,
                "webviewLabels": preserved,
                "windowId": window_id,
            }),
        );
    }
}

#[tauri::command]
fn web_panel_open(
    app: AppHandle,
    pane_id: String,
    url: Option<String>,
    theme: Option<String>,
    title: Option<String>,
    workspace_id: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
    adopt_label: Option<String>,
) -> Result<WebPanelOpenResult, String> {
    let pane_text = pane_id.trim().chars().take(512).collect::<String>();
    if pane_text.is_empty() {
        return Err("Web panel pane id is required.".to_string());
    }
    let url_text = web_panel_url(url.as_deref());
    let theme_text = web_panel_theme(theme.as_deref());
    let title_text = title
        .as_deref()
        .unwrap_or_default()
        .trim()
        .chars()
        .take(160)
        .collect::<String>();
    let title_text = if title_text.is_empty() {
        "Web".to_string()
    } else {
        title_text
    };
    let workspace_text = workspace_id
        .as_deref()
        .unwrap_or_default()
        .trim()
        .chars()
        .take(160)
        .collect::<String>();
    let label = web_panel_label(&pane_text);

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(WebPanelOpenResult { label });
    }

    let window_width = width
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(WEB_PANEL_MIN_WIDTH, 2600.0))
        .unwrap_or(WEB_PANEL_DEFAULT_WIDTH);
    let window_height = height
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(WEB_PANEL_MIN_HEIGHT, 1800.0))
        .unwrap_or(WEB_PANEL_DEFAULT_HEIGHT);
    // A validated adopt label lets the host window take over the caller's living
    // webview (reparent) instead of loading the page from scratch.
    let adopt_text = adopt_label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && validate_workspace_webview_label(value).is_ok())
        .unwrap_or_default()
        .to_string();
    let app_url = format!(
        "index.html#/web-panel?paneId={}&url={}&theme={}&title={}&windowId={}&workspaceId={}&adoptLabel={}",
        percent_encode_query_component(&pane_text),
        percent_encode_query_component(&url_text),
        percent_encode_query_component(&theme_text),
        percent_encode_query_component(&title_text),
        percent_encode_query_component(&label),
        percent_encode_query_component(&workspace_text),
        percent_encode_query_component(&adopt_text),
    );

    let window = WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::App(app_url.into()))
        .title(format!("{title_text} - Diff Forge"))
        .inner_size(window_width, window_height)
        .min_inner_size(WEB_PANEL_MIN_WIDTH, WEB_PANEL_MIN_HEIGHT)
        .resizable(true)
        .decorations(false)
        .focused(true)
        .accept_first_mouse(true)
        .transparent(true)
        .background_color(Color(2, 3, 4, 255))
        .shadow(true)
        .build()
        .map_err(|error| format!("Unable to create web panel window: {error}"))?;

    let app_for_events = app.clone();
    let pane_for_events = pane_text.clone();
    let label_for_events = label.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::CloseRequested { .. }) {
            preserve_web_panel_child_webviews(&app_for_events, &label_for_events, &pane_for_events);
        }
        if matches!(event, WindowEvent::Destroyed) {
            emit_web_panel_closed(&app_for_events, &label_for_events, &pane_for_events);
        }
    });

    Ok(WebPanelOpenResult { label })
}

#[tauri::command]
fn web_panel_focus(app: AppHandle, label: String) -> Result<bool, String> {
    validate_web_panel_label(&label)?;
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(false);
    };
    let _ = window.show();
    let _ = window.set_focus();
    Ok(true)
}

#[tauri::command]
fn web_panel_close(app: AppHandle, label: String) -> Result<(), String> {
    validate_web_panel_label(&label)?;
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    } else {
        emit_web_panel_closed(&app, &label, "");
    }
    Ok(())
}

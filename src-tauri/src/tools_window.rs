const TOOLS_WINDOW_LABEL_PREFIX: &str = "tools-window-";
const TOOLS_WINDOW_CLOSED_EVENT: &str = "forge-tools-window-closed";
const TOOLS_WINDOW_DEFAULT_WIDTH: f64 = 920.0;
const TOOLS_WINDOW_DEFAULT_HEIGHT: f64 = 760.0;
const TOOLS_WINDOW_MIN_WIDTH: f64 = 520.0;
const TOOLS_WINDOW_MIN_HEIGHT: f64 = 420.0;

#[derive(Serialize)]
struct ToolsWindowOpenResult {
    label: String,
}

fn tools_window_mode(value: Option<&str>) -> String {
    if value
        .unwrap_or_default()
        .trim()
        .eq_ignore_ascii_case("scripts")
    {
        "scripts".to_string()
    } else {
        "docs".to_string()
    }
}

fn tools_window_theme(value: Option<&str>) -> String {
    let normalized = value.unwrap_or_default().trim().to_ascii_lowercase();
    if matches!(normalized.as_str(), "dark" | "navy" | "gold" | "light") {
        normalized
    } else {
        "dark".to_string()
    }
}

fn tools_window_safe_label_part(value: &str, fallback: &str) -> String {
    let source = value.trim();
    let source = if source.is_empty() { fallback } else { source };
    let mut hash = 2166136261u32;
    for byte in source.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(16_777_619);
    }
    let without_prefix = source
        .strip_prefix("library:")
        .or_else(|| source.strip_prefix("draft:"))
        .unwrap_or(source);
    let mut slug = String::new();
    for character in without_prefix.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, ':' | '_' | '-') {
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

fn tools_window_label(mode: &str, key: &str) -> String {
    format!(
        "{TOOLS_WINDOW_LABEL_PREFIX}{}-{}",
        tools_window_safe_label_part(mode, "mode"),
        tools_window_safe_label_part(key, "item")
    )
}

fn validate_tools_window_label(label: &str) -> Result<(), String> {
    if label.starts_with(TOOLS_WINDOW_LABEL_PREFIX)
        && label.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '/')
        })
    {
        Ok(())
    } else {
        Err("Invalid tools window label.".to_string())
    }
}

fn emit_tools_window_closed(app: &AppHandle, window_id: &str, mode: &str, key: &str) {
    let _ = app.emit(
        TOOLS_WINDOW_CLOSED_EVENT,
        json!({
            "key": key,
            "mode": mode,
            "window_id": window_id,
        }),
    );
}

#[tauri::command(rename_all = "snake_case")]
fn tools_window_open(
    app: AppHandle,
    key: String,
    mode: Option<String>,
    theme: Option<String>,
    title: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<ToolsWindowOpenResult, String> {
    let key_text = key.trim().chars().take(2048).collect::<String>();
    if key_text.is_empty() {
        return Err("Tools window key is required.".to_string());
    }
    let mode_text = tools_window_mode(mode.as_deref());
    let theme_text = tools_window_theme(theme.as_deref());
    let title_text = title
        .as_deref()
        .unwrap_or_default()
        .trim()
        .chars()
        .take(160)
        .collect::<String>();
    let title_text = if title_text.is_empty() {
        if mode_text == "scripts" {
            "Script".to_string()
        } else {
            "Document".to_string()
        }
    } else {
        title_text
    };
    let label = tools_window_label(&mode_text, &key_text);

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(ToolsWindowOpenResult { label });
    }

    let window_width = width
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(TOOLS_WINDOW_MIN_WIDTH, 2600.0))
        .unwrap_or(TOOLS_WINDOW_DEFAULT_WIDTH);
    let window_height = height
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(TOOLS_WINDOW_MIN_HEIGHT, 1800.0))
        .unwrap_or(TOOLS_WINDOW_DEFAULT_HEIGHT);
    let url = format!(
        "index.html#/tools-window?key={}&mode={}&theme={}&title={}&windowId={}",
        percent_encode_query_component(&key_text),
        percent_encode_query_component(&mode_text),
        percent_encode_query_component(&theme_text),
        percent_encode_query_component(&title_text),
        percent_encode_query_component(&label),
    );

    let window = WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::App(url.into()))
        .title(format!("{title_text} - Diff Forge"))
        .inner_size(window_width, window_height)
        .min_inner_size(TOOLS_WINDOW_MIN_WIDTH, TOOLS_WINDOW_MIN_HEIGHT)
        .resizable(true)
        .decorations(false)
        .focused(true)
        .accept_first_mouse(true)
        .transparent(true)
        .background_color(Color(2, 3, 4, 255))
        .shadow(true)
        .build()
        .map_err(|error| format!("Unable to create tools window: {error}"))?;

    let app_for_events = app.clone();
    let key_for_events = key_text.clone();
    let mode_for_events = mode_text.clone();
    let label_for_events = label.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            emit_tools_window_closed(
                &app_for_events,
                &label_for_events,
                &mode_for_events,
                &key_for_events,
            );
        }
    });

    Ok(ToolsWindowOpenResult { label })
}

#[tauri::command(rename_all = "snake_case")]
fn tools_window_focus(app: AppHandle, label: String) -> Result<bool, String> {
    validate_tools_window_label(&label)?;
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(false);
    };
    let _ = window.show();
    let _ = window.set_focus();
    Ok(true)
}

#[tauri::command(rename_all = "snake_case")]
fn tools_window_close(app: AppHandle, label: String) -> Result<(), String> {
    validate_tools_window_label(&label)?;
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    } else {
        emit_tools_window_closed(&app, &label, "", "");
    }
    Ok(())
}

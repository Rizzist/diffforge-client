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

fn workspace_web_candidate_url(raw_url: &str) -> Result<String, String> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return Err("Enter a URL to open.".to_string());
    }

    if trimmed.len() > 2048 {
        return Err("URL is too long.".to_string());
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Ok(trimmed.to_string());
    }

    if lower.contains("://") {
        return Err("Only http and https URLs can be opened in the workspace web view.".to_string());
    }

    if trimmed.bytes().all(|byte| byte.is_ascii_digit()) {
        return Ok(format!("http://127.0.0.1:{trimmed}"));
    }

    let localhost_like = lower == "localhost"
        || lower.starts_with("localhost:")
        || lower.starts_with("127.")
        || lower.starts_with("0.0.0.0")
        || lower.starts_with("[::1]")
        || lower.starts_with("::1");

    if localhost_like {
        Ok(format!("http://{trimmed}"))
    } else {
        Ok(format!("https://{trimmed}"))
    }
}

fn normalize_workspace_web_url_value(raw_url: &str) -> Result<tauri::Url, String> {
    let candidate = workspace_web_candidate_url(raw_url)?;
    let url = tauri::Url::parse(&candidate).map_err(|error| format!("Invalid URL: {error}"))?;

    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only http and https URLs can be opened in the workspace web view.".to_string());
    }

    if url.host_str().unwrap_or("").is_empty() {
        return Err("URL must include a host.".to_string());
    }

    Ok(url)
}

#[tauri::command]
fn workspace_web_normalize_url(url: String) -> Result<String, String> {
    normalize_workspace_web_url_value(&url).map(|url| url.to_string())
}

#[tauri::command]
fn workspace_web_navigate(app: AppHandle, label: String, url: String) -> Result<String, String> {
    validate_workspace_webview_label(&label)?;
    let normalized_url = normalize_workspace_web_url_value(&url)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "Workspace webview not found.".to_string())?;

    webview
        .navigate(normalized_url.clone())
        .map_err(|error| format!("Unable to navigate web view: {error}"))?;

    Ok(normalized_url.to_string())
}

#[tauri::command]
fn workspace_web_reload(app: AppHandle, label: String) -> Result<(), String> {
    validate_workspace_webview_label(&label)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "Workspace webview not found.".to_string())?;

    webview
        .reload()
        .map_err(|error| format!("Unable to reload web view: {error}"))
}

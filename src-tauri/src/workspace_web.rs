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

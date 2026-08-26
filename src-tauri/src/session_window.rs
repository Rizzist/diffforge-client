const SESSION_WINDOW_LABEL_PREFIX: &str = "session-window-";
const SESSION_WINDOW_CLOSED_EVENT: &str = "forge-session-window-closed";
const SESSION_WINDOW_DEFAULT_WIDTH: f64 = 960.0;
const SESSION_WINDOW_DEFAULT_HEIGHT: f64 = 760.0;
const SESSION_WINDOW_MIN_WIDTH: f64 = 520.0;
const SESSION_WINDOW_MIN_HEIGHT: f64 = 420.0;
const SESSION_WINDOW_MAX_SESSION_ID_CHARS: usize = 2048;

#[derive(Serialize)]
struct SessionWindowOpenResult {
    label: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SessionWindowOpenDecision {
    FocusExisting,
    Create,
}

fn session_window_open_decision(has_existing_window: bool) -> SessionWindowOpenDecision {
    if has_existing_window {
        SessionWindowOpenDecision::FocusExisting
    } else {
        SessionWindowOpenDecision::Create
    }
}

fn session_window_theme(value: Option<&str>) -> String {
    let normalized = value.unwrap_or_default().trim().to_ascii_lowercase();
    if matches!(normalized.as_str(), "dark" | "light") {
        normalized
    } else {
        "dark".to_string()
    }
}

fn session_window_label(session_id: &str, space_id: Option<&str>, leaf_id: Option<&str>) -> String {
    let (slug_source, fingerprint_source) = match (space_id, leaf_id) {
        (Some(space_id), Some(leaf_id)) => (
            format!("leaf-{space_id}-{leaf_id}"),
            format!("space:{space_id}\nleaf:{leaf_id}"),
        ),
        _ => (session_id.to_string(), session_id.to_string()),
    };
    let mut slug = String::new();
    for character in slug_source.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '_' | '-') {
            slug.push(character);
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
        if slug.len() >= 48 {
            break;
        }
    }
    let slug = slug.trim_matches('-');
    let slug = if slug.is_empty() { "session" } else { slug };
    let digest = format!(
        "{:x}",
        <Sha256 as Sha1Digest>::digest(fingerprint_source.as_bytes())
    );
    format!("{SESSION_WINDOW_LABEL_PREFIX}{slug}-{}", &digest[..24])
}

fn validate_session_window_label(label: &str) -> Result<(), String> {
    if label.len() > SESSION_WINDOW_LABEL_PREFIX.len()
        && label.len() <= 96
        && label.starts_with(SESSION_WINDOW_LABEL_PREFIX)
        && label
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Ok(())
    } else {
        Err("Invalid session window label.".to_string())
    }
}

fn emit_session_window_closed(
    app: &AppHandle,
    window_id: &str,
    session_id: Option<&str>,
    space_id: Option<&str>,
    leaf_id: Option<&str>,
) {
    let _ = app.emit(
        SESSION_WINDOW_CLOSED_EVENT,
        json!({
            "session_id": session_id,
            "space_id": space_id,
            "leaf_id": leaf_id,
            "window_id": window_id,
        }),
    );
}

#[tauri::command(rename_all = "snake_case")]
fn session_window_open(
    app: AppHandle,
    session_id: String,
    space_id: Option<String>,
    leaf_id: Option<String>,
    theme: Option<String>,
    title: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<SessionWindowOpenResult, String> {
    let session_id_text = session_id.trim().to_string();
    if session_id_text.is_empty() {
        return Err("Session window session id is required.".to_string());
    }
    if session_id_text.chars().count() > SESSION_WINDOW_MAX_SESSION_ID_CHARS {
        return Err("Session window session id is too long.".to_string());
    }

    let space_id_text = space_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let leaf_id_text = leaf_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if space_id_text.is_some() != leaf_id_text.is_some() {
        return Err("Session window space id and leaf id must be provided together.".to_string());
    }
    if space_id_text
        .as_deref()
        .is_some_and(|value| value.chars().count() > SESSION_WINDOW_MAX_SESSION_ID_CHARS)
        || leaf_id_text
            .as_deref()
            .is_some_and(|value| value.chars().count() > SESSION_WINDOW_MAX_SESSION_ID_CHARS)
    {
        return Err("Session window space or leaf id is too long.".to_string());
    }

    let theme_text = session_window_theme(theme.as_deref());
    let title_text = title
        .as_deref()
        .unwrap_or_default()
        .trim()
        .chars()
        .take(160)
        .collect::<String>();
    let title_text = if title_text.is_empty() {
        "Session".to_string()
    } else {
        title_text
    };
    let label = session_window_label(
        &session_id_text,
        space_id_text.as_deref(),
        leaf_id_text.as_deref(),
    );

    let existing_window = app.get_webview_window(&label);
    if session_window_open_decision(existing_window.is_some())
        == SessionWindowOpenDecision::FocusExisting
    {
        if let Some(window) = existing_window {
            let _ = window.show();
            let _ = window.set_focus();
        }
        return Ok(SessionWindowOpenResult { label });
    }

    let window_width = width
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(SESSION_WINDOW_MIN_WIDTH, 2600.0))
        .unwrap_or(SESSION_WINDOW_DEFAULT_WIDTH);
    let window_height = height
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(SESSION_WINDOW_MIN_HEIGHT, 1800.0))
        .unwrap_or(SESSION_WINDOW_DEFAULT_HEIGHT);
    let url = format!(
        "index.html#/session-window?session_id={}&space_id={}&leaf_id={}&theme={}&title={}&window_id={}",
        percent_encode_query_component(&session_id_text),
        percent_encode_query_component(space_id_text.as_deref().unwrap_or_default()),
        percent_encode_query_component(leaf_id_text.as_deref().unwrap_or_default()),
        percent_encode_query_component(&theme_text),
        percent_encode_query_component(&title_text),
        percent_encode_query_component(&label),
    );

    let window = WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::App(url.into()))
        .title(format!("{title_text} - Diff Forge"))
        .inner_size(window_width, window_height)
        .min_inner_size(SESSION_WINDOW_MIN_WIDTH, SESSION_WINDOW_MIN_HEIGHT)
        .resizable(true)
        .decorations(false)
        .focused(true)
        .accept_first_mouse(true)
        .transparent(true)
        .background_color(Color(2, 3, 4, 255))
        .shadow(true)
        .build()
        .map_err(|error| format!("Unable to create session window: {error}"))?;

    let app_for_events = app.clone();
    let session_id_for_events = session_id_text.clone();
    let space_id_for_events = space_id_text.clone();
    let leaf_id_for_events = leaf_id_text.clone();
    let label_for_events = label.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            emit_session_window_closed(
                &app_for_events,
                &label_for_events,
                Some(&session_id_for_events),
                space_id_for_events.as_deref(),
                leaf_id_for_events.as_deref(),
            );
        }
    });

    Ok(SessionWindowOpenResult { label })
}

#[tauri::command(rename_all = "snake_case")]
fn session_window_focus(app: AppHandle, label: String) -> Result<bool, String> {
    validate_session_window_label(&label)?;
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(false);
    };
    let _ = window.show();
    let _ = window.set_focus();
    Ok(true)
}

#[tauri::command(rename_all = "snake_case")]
fn session_window_close(app: AppHandle, label: String) -> Result<(), String> {
    validate_session_window_label(&label)?;
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    } else {
        emit_session_window_closed(&app, &label, None, None, None);
    }
    Ok(())
}

#[cfg(test)]
mod session_window_tests {
    use super::*;

    #[test]
    fn session_window_label_is_stable_and_valid() {
        let label = session_window_label("session/library:abc 123", None, None);

        assert_eq!(
            label,
            "session-window-session-library-abc-123-730924f9f42176ea61c5030c"
        );
        assert_eq!(
            session_window_label("session/library:abc 123", None, None),
            label
        );
        assert!(validate_session_window_label(&label).is_ok());
    }

    #[test]
    fn session_window_label_keeps_sanitized_collisions_unique() {
        let slash = session_window_label("space/session", None, None);
        let question = session_window_label("space?session", None, None);

        assert_ne!(slash, question);
        assert!(slash.starts_with("session-window-space-session-"));
        assert!(question.starts_with("session-window-space-session-"));
    }

    #[test]
    fn session_window_label_keeps_duplicate_session_leaves_unique() {
        let first = session_window_label("same-session", Some("space-a"), Some("leaf/duplicate"));
        let second = session_window_label("same-session", Some("space-a"), Some("leaf?duplicate"));
        let first_after_session_reconciliation =
            session_window_label("updated-session", Some("space-a"), Some("leaf/duplicate"));

        assert_ne!(first, second);
        assert_eq!(first, first_after_session_reconciliation);
        assert!(first.starts_with("session-window-leaf-space-a-leaf-duplicate-"));
        assert!(second.starts_with("session-window-leaf-space-a-leaf-duplicate-"));
    }

    #[test]
    fn session_window_open_focuses_existing_label_instead_of_creating_duplicate() {
        assert_eq!(
            session_window_open_decision(true),
            SessionWindowOpenDecision::FocusExisting
        );
        assert_eq!(
            session_window_open_decision(false),
            SessionWindowOpenDecision::Create
        );
    }

    #[test]
    fn session_window_label_validation_rejects_other_window_scopes() {
        assert!(validate_session_window_label("tools-window-session-abc").is_err());
        assert!(validate_session_window_label("session-window-abc/def").is_err());
        assert!(validate_session_window_label("session-window-").is_err());
    }
}

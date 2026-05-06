use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

const API_BASE_URL: &str = "https://diffforge.ai/api";
const MIN_AUTH_VALUE_LENGTH: usize = 24;
const MAX_AUTH_VALUE_LENGTH: usize = 192;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStatus {
    ok: bool,
    endpoint: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeDesktopSessionRequest<'a> {
    code: &'a str,
    state: &'a str,
}

fn is_safe_auth_value(value: &str) -> bool {
    let value_length = value.len();

    value_length >= MIN_AUTH_VALUE_LENGTH
        && value_length <= MAX_AUTH_VALUE_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn validate_auth_value(label: &str, value: &str) -> Result<(), String> {
    if is_safe_auth_value(value) {
        return Ok(());
    }

    Err(format!("{label} is invalid."))
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Diffforge Desktop/0.1.0")
        .build()
        .map_err(|error| format!("Unable to prepare backend request: {error}"))
}

async fn read_api_response(
    response: reqwest::Response,
    fallback_message: &str,
) -> Result<Value, String> {
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Unable to read Diffforge API response: {error}"))?;
    let response_body = if response_text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str::<Value>(&response_text)
            .map_err(|error| format!("Diffforge API returned invalid JSON: {error}"))?
    };

    if status.is_success() {
        return Ok(response_body);
    }

    let api_error = response_body
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or(fallback_message);

    Err(api_error.to_string())
}

#[tauri::command]
async fn backend_ping() -> Result<BackendStatus, String> {
    let endpoint = format!("{API_BASE_URL}/hello");
    let client = http_client()?;

    let response = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|error| format!("Unable to reach Diffforge API: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Diffforge API returned {}", response.status()));
    }

    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Diffforge API returned invalid JSON: {error}"))?;
    let service_name = body
        .get("name")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("Diffforge API");

    Ok(BackendStatus {
        ok: true,
        endpoint,
        message: format!("Connected to {service_name}"),
    })
}

#[tauri::command]
async fn exchange_desktop_auth_code(code: String, state: String) -> Result<Value, String> {
    validate_auth_value("Desktop auth code", &code)?;
    validate_auth_value("Desktop auth state", &state)?;

    let client = http_client()?;
    let response = client
        .post(format!("{API_BASE_URL}/desktop/sessions/exchange"))
        .json(&ExchangeDesktopSessionRequest {
            code: &code,
            state: &state,
        })
        .send()
        .await
        .map_err(|error| format!("Unable to exchange desktop login: {error}"))?;

    read_api_response(response, "Desktop login expired. Try again.").await
}

#[tauri::command]
async fn validate_desktop_session(token: String) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;

    let client = http_client()?;
    let response = client
        .get(format!("{API_BASE_URL}/desktop/session"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Unable to validate desktop session: {error}"))?;

    read_api_response(response, "Desktop session expired.").await
}

#[tauri::command]
async fn logout_desktop_session(token: String) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;

    let client = http_client()?;
    let response = client
        .delete(format!("{API_BASE_URL}/desktop/session"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Unable to sign out desktop session: {error}"))?;

    read_api_response(response, "Unable to sign out desktop session.").await
}

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                app.deep_link().register_all()?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_ping,
            exchange_desktop_auth_code,
            validate_desktop_session,
            logout_desktop_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running Diffforge desktop");
}

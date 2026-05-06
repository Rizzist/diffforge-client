use std::time::Duration;

use serde::Serialize;

const API_BASE_URL: &str = "https://diffforge.ai/api";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStatus {
    ok: bool,
    endpoint: String,
    message: String,
}

#[tauri::command]
async fn backend_ping() -> Result<BackendStatus, String> {
    let endpoint = format!("{API_BASE_URL}/hello");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("Diffforge Desktop/0.1.0")
        .build()
        .map_err(|error| format!("Unable to prepare backend request: {error}"))?;

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

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![backend_ping])
        .run(tauri::generate_context!())
        .expect("error while running Diffforge desktop");
}

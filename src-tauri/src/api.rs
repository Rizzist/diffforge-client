// Building a reqwest client reloads the entire macOS root-certificate store via
// securityd (SecTrustSettingsCopyCertificates) — an expensive keychain
// enumeration. Periodic callers (device heartbeat, polling) used to rebuild a
// client per request, which pegged a CPU core every cycle. These helpers build
// each client once and reuse it; reqwest clients are cheap to clone (Arc) and
// share the loaded trust store plus the connection pool.
fn shared_async_http_client() -> reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent("Diff Forge AI Desktop/0.1.0")
                .build()
                .unwrap_or_else(|_| reqwest::Client::new())
        })
        .clone()
}

fn shared_blocking_http_client() -> reqwest::blocking::Client {
    static CLIENT: std::sync::OnceLock<reqwest::blocking::Client> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::blocking::Client::builder()
                .user_agent("Diff Forge AI Desktop/0.1.0")
                .build()
                .unwrap_or_else(|_| reqwest::blocking::Client::new())
        })
        .clone()
}

fn http_client(timeout: Duration) -> Result<reqwest::Client, String> {
    // Cache one client per distinct timeout so the trust store is loaded once
    // per timeout value instead of on every call. Timeouts come from a small,
    // fixed set of constants, so the cache stays tiny.
    static CACHE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<u64, reqwest::Client>>> =
        std::sync::OnceLock::new();
    let cache = CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    let key = timeout.as_millis() as u64;
    if let Ok(map) = cache.lock() {
        if let Some(client) = map.get(&key) {
            return Ok(client.clone());
        }
    }
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("Diff Forge AI Desktop/0.1.0")
        .build()
        .map_err(|error| format!("Unable to prepare backend request: {error}"))?;
    if let Ok(mut map) = cache.lock() {
        map.insert(key, client.clone());
    }
    Ok(client)
}

fn non_json_api_response_message(
    status: reqwest::StatusCode,
    fallback_message: &str,
    parse_error: serde_json::Error,
) -> String {
    if status.is_success() {
        return format!("Diff Forge AI API returned invalid JSON: {parse_error}");
    }

    format!("{fallback_message} Diff Forge AI API returned {status} with a non-JSON response.")
}

async fn read_api_response(
    response: reqwest::Response,
    fallback_message: &str,
) -> Result<Value, String> {
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Unable to read Diff Forge AI API response: {error}"))?;
    let response_body = if response_text.trim().is_empty() {
        json!({})
    } else {
        match serde_json::from_str::<Value>(&response_text) {
            Ok(body) => body,
            Err(error) => {
                return Err(non_json_api_response_message(
                    status,
                    fallback_message,
                    error,
                ));
            }
        }
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

fn desktop_auth_failure_kind_for_status(status: reqwest::StatusCode) -> DesktopAuthSessionFailureKind {
    if matches!(
        status,
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN
    ) {
        DesktopAuthSessionFailureKind::AuthRejected
    } else {
        DesktopAuthSessionFailureKind::Transport
    }
}

#[cfg(test)]
fn desktop_auth_classify_error_message(message: &str) -> DesktopAuthSessionFailureKind {
    let lower = message.to_ascii_lowercase();
    if lower.contains("desktop session expired")
        || lower.contains("desktop session is invalid")
        || lower.contains("unauthorized")
        || lower.contains("forbidden")
        || lower.contains("access_denied")
    {
        DesktopAuthSessionFailureKind::AuthRejected
    } else {
        DesktopAuthSessionFailureKind::Transport
    }
}

async fn read_desktop_auth_api_response(
    response: reqwest::Response,
    fallback_message: &str,
) -> Result<Value, DesktopAuthSessionFailure> {
    let status = response.status();
    let response_text = response.text().await.map_err(|error| {
        DesktopAuthSessionFailure::new(
            DesktopAuthSessionFailureKind::Transport,
            format!("Unable to read Diff Forge AI API response: {error}"),
        )
    })?;
    let response_body = if response_text.trim().is_empty() {
        json!({})
    } else {
        match serde_json::from_str::<Value>(&response_text) {
            Ok(body) => body,
            Err(error) => {
                let kind = desktop_auth_failure_kind_for_status(status);
                let message = if kind == DesktopAuthSessionFailureKind::AuthRejected {
                    fallback_message.to_string()
                } else {
                    non_json_api_response_message(status, fallback_message, error)
                };
                return Err(DesktopAuthSessionFailure::new(
                    kind,
                    message,
                ));
            }
        }
    };

    if status.is_success() {
        return Ok(response_body);
    }

    let kind = desktop_auth_failure_kind_for_status(status);
    let api_error = response_body
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or(fallback_message);
    let message = if kind == DesktopAuthSessionFailureKind::AuthRejected {
        fallback_message
    } else {
        api_error
    };

    Err(DesktopAuthSessionFailure::new(kind, message.to_string()))
}

fn read_blocking_api_response(
    response: reqwest::blocking::Response,
    fallback_message: &str,
) -> Result<Value, String> {
    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("Unable to read Diff Forge AI API response: {error}"))?;
    let response_body = if response_text.trim().is_empty() {
        json!({})
    } else {
        match serde_json::from_str::<Value>(&response_text) {
            Ok(body) => body,
            Err(error) => {
                return Err(non_json_api_response_message(
                    status,
                    fallback_message,
                    error,
                ));
            }
        }
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

fn blocking_http_client(timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .user_agent("Diff Forge AI Desktop/0.1.0")
        .build()
        .map_err(|error| format!("Unable to prepare backend request: {error}"))
}

fn read_blocking_api_body(
    response: reqwest::blocking::Response,
    fallback_message: &str,
) -> Result<(reqwest::StatusCode, Value), String> {
    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("Unable to read Diff Forge AI API response: {error}"))?;
    let response_body = if response_text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str::<Value>(&response_text).map_err(|error| {
            non_json_api_response_message(status, fallback_message, error)
        })?
    };

    Ok((status, response_body))
}

#[tauri::command(rename_all = "snake_case")]
async fn backend_ping() -> Result<BackendStatus, String> {
    let endpoint = api_endpoint("hello");
    let client = http_client(Duration::from_secs(DEFAULT_API_TIMEOUT_SECS))?;

    let response = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|error| format!("Unable to reach Diff Forge AI API: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Diff Forge AI API returned {}", response.status()));
    }

    let _body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Diff Forge AI API returned invalid JSON: {error}"))?;

    Ok(BackendStatus {
        ok: true,
        endpoint,
        message: "Diff Forge API online".to_string(),
    })
}

const DESKTOP_AUTH_STATE_KEY: &str = "desktop-auth";
const DESKTOP_AUTH_PROVISION_TOKEN_CONSUMED_MARKER: &str = "provision-token-consumed";
const DESKTOP_AUTH_STATE_CHANGED_EVENT: &str = "desktop-auth-state-changed";
const DESKTOP_AUTH_DEFAULT_MESSAGE: &str = "Sign in with your Diff Forge AI web account.";
const DESKTOP_AUTH_SESSION_EXPIRED_MESSAGE: &str = "Desktop session expired.";
const DESKTOP_AUTH_BILLING_HISTORY_LIMIT: usize = 100;
const SESSION_RENEW_TIMEOUT_SECS: u64 = 5;
const DESKTOP_AUTH_RENEWAL_STARTUP_MIN_SECS: u64 = 30;
const DESKTOP_AUTH_RENEWAL_STARTUP_JITTER_SECS: u64 = 300;
const DESKTOP_AUTH_RENEWAL_INTERVAL_SECS: u64 = 24 * 60 * 60;
const DESKTOP_AUTH_RENEWAL_JITTER_SECS: u64 = 60 * 60;
const DESKTOP_AUTH_RENEWAL_NO_SESSION_SECS: u64 = 15 * 60;
const DESKTOP_AUTH_RENEWAL_MIN_BACKOFF_SECS: u64 = 15 * 60;
const DESKTOP_AUTH_RENEWAL_MAX_BACKOFF_SECS: u64 = 6 * 60 * 60;
const DESKTOP_AUTH_RENEWAL_CONNECTIVITY_POLL_SECS: u64 = 60;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DesktopAuthSessionFailureKind {
    AuthRejected,
    Transport,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DesktopAuthSessionFailure {
    kind: DesktopAuthSessionFailureKind,
    message: String,
}

impl DesktopAuthSessionFailure {
    fn new(kind: DesktopAuthSessionFailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum DesktopAuthRenewOutcome {
    NoSession,
    Renewed,
    AuthRejected(String),
    TransportError(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DesktopAuthPreflightStatus {
    AuthOk,
    NoSession,
    AuthRejected,
    TransportError,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DesktopAuthPreflightResult {
    status: DesktopAuthPreflightStatus,
    error: Option<String>,
}

impl DesktopAuthPreflightResult {
    fn new(status: DesktopAuthPreflightStatus, error: Option<String>) -> Self {
        Self { status, error }
    }
}

fn desktop_auth_text(value: &Value, keys: &[&str]) -> Option<String> {
    let mut current = value;
    for key in keys {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn desktop_auth_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    let mut current = value;
    for key in keys {
        current = current.get(*key)?;
    }
    current.as_u64()
}

fn desktop_auth_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    let mut current = value;
    for key in keys {
        current = current.get(*key)?;
    }
    if let Some(number) = current.as_i64() {
        return Some(number);
    }
    if let Some(number) = current.as_u64() {
        return Some(number.min(i64::MAX as u64) as i64);
    }
    if let Some(number) = current.as_f64() {
        if number.is_finite() && number >= i64::MIN as f64 && number <= i64::MAX as f64 {
            return Some(number.round() as i64);
        }
    }
    current.as_str().and_then(|text| {
        let number = text.trim().parse::<f64>().ok()?;
        if number.is_finite() && number >= i64::MIN as f64 && number <= i64::MAX as f64 {
            Some(number.round() as i64)
        } else {
            None
        }
    })
}

fn desktop_auth_canonical_billing_snapshot_key(key: &str) -> Option<&'static str> {
    match key {
        "audio_seconds" => Some("audioSeconds"),
        "billing_history" => Some("billingHistory"),
        "bucket_day" => Some("bucketDay"),
        "bucket_start" => Some("bucketStart"),
        "by_meter" => Some("byMeter"),
        "billed_credits" => Some("billedCredits"),
        "bytes_per_credit" => Some("bytesPerCredit"),
        "cached_input_tokens" => Some("cachedInputTokens"),
        "created_at" => Some("createdAt"),
        "created_at_ms" => Some("createdAtMs"),
        "credit_ledger" => Some("creditLedger"),
        "daily_30d" => Some("daily30d"),
        "dedupe_key" => Some("dedupeKey"),
        "entity_id" => Some("entityId"),
        "entity_type" => Some("entityType"),
        "event_count" => Some("eventCount"),
        "input_tokens" => Some("inputTokens"),
        "local_metered_used_credits" => Some("localMeteredUsedCredits"),
        "low_credit_state" => Some("lowCreditState"),
        "output_tokens" => Some("outputTokens"),
        "pending_event_count" => Some("pendingEventCount"),
        "plan_name" => Some("planName"),
        "plan_status" => Some("planStatus"),
        "provider_cost_microusd" => Some("providerCostMicrousd"),
        "remaining_credits" => Some("remainingCredits"),
        "remainder_bytes" => Some("remainderBytes"),
        "repo_id" => Some("repoId"),
        "reserved_credits" => Some("reservedCredits"),
        "reset_at" => Some("resetAt"),
        "source_event_id" => Some("sourceEventId"),
        "term_end" => Some("termEnd"),
        "term_id" => Some("termId"),
        "term_remaining_credits" => Some("termRemainingCredits"),
        "term_reserved_credits" => Some("termReservedCredits"),
        "term_total_credits" => Some("termTotalCredits"),
        "term_used_credits" => Some("termUsedCredits"),
        "total_bytes" => Some("totalBytes"),
        "total_credits" => Some("totalCredits"),
        "tts_characters" => Some("ttsCharacters"),
        "updated_at" => Some("updatedAt"),
        "usage_by_meter" => Some("usageByMeter"),
        "usage_history" => Some("usageHistory"),
        "used_credits" => Some("usedCredits"),
        "wallet_version" => Some("walletVersion"),
        "web_search_calls" => Some("webSearchCalls"),
        "workspace_id" => Some("workspaceId"),
        _ => None,
    }
}

fn desktop_auth_billing_history_array_key(key: &str) -> bool {
    matches!(key, "billingHistory" | "history" | "items" | "usageHistory")
}

fn desktop_auth_billing_history_item_ms(value: &Value) -> Option<i64> {
    [
        &["createdAtMs"][..],
        &["updatedAtMs"][..],
        &["timestampMs"][..],
        &["tsMs"][..],
    ]
    .iter()
    .find_map(|path| desktop_auth_i64(value, path))
}

fn desktop_auth_trim_billing_history_array(mut items: Vec<Value>) -> Vec<Value> {
    if items.len() <= DESKTOP_AUTH_BILLING_HISTORY_LIMIT {
        return items;
    }

    if items
        .iter()
        .any(|item| desktop_auth_billing_history_item_ms(item).is_some())
    {
        items.sort_by(|left, right| {
            let left_ms = desktop_auth_billing_history_item_ms(left).unwrap_or(i64::MIN);
            let right_ms = desktop_auth_billing_history_item_ms(right).unwrap_or(i64::MIN);
            right_ms.cmp(&left_ms)
        });
    }
    items.truncate(DESKTOP_AUTH_BILLING_HISTORY_LIMIT);
    items
}

fn desktop_auth_remove_duplicate_usage_history(value: Option<&mut Value>, canonical_items: &Value) {
    let Some(object) = value.and_then(Value::as_object_mut) else {
        return;
    };
    if object.get("usageHistory") == Some(canonical_items) {
        object.remove("usageHistory");
    }
}

fn desktop_auth_prune_duplicate_billing_history_aliases(object: &mut serde_json::Map<String, Value>) {
    if let Some(items) = object.get("items").cloned() {
        if object.get("history") == Some(&items) {
            object.remove("history");
        }
    }

    let Some(ledger_items) = object
        .get("creditLedger")
        .and_then(|ledger| ledger.get("items"))
        .cloned()
    else {
        return;
    };

    if object.get("billingHistory") == Some(&ledger_items) {
        object.remove("billingHistory");
    }
    desktop_auth_remove_duplicate_usage_history(object.get_mut("credits"), &ledger_items);
    desktop_auth_remove_duplicate_usage_history(
        object
            .get_mut("user")
            .and_then(|user| user.get_mut("credits")),
        &ledger_items,
    );
}

fn desktop_auth_slim_billing_snapshot_value(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(desktop_auth_slim_billing_snapshot_value)
                .collect(),
        ),
        Value::Object(object) => {
            let mut slimmed = serde_json::Map::new();
            for (key, value) in object {
                let canonical_key =
                    desktop_auth_canonical_billing_snapshot_key(&key).unwrap_or(key.as_str());
                let canonical_key_is_original = canonical_key == key;
                let mut value = desktop_auth_slim_billing_snapshot_value(value);
                if desktop_auth_billing_history_array_key(canonical_key) {
                    if let Value::Array(items) = value {
                        value = Value::Array(desktop_auth_trim_billing_history_array(items));
                    }
                }

                match slimmed.entry(canonical_key.to_string()) {
                    serde_json::map::Entry::Occupied(mut entry) => {
                        if canonical_key_is_original {
                            entry.insert(value);
                        }
                    }
                    serde_json::map::Entry::Vacant(entry) => {
                        entry.insert(value);
                    }
                }
            }
            desktop_auth_prune_duplicate_billing_history_aliases(&mut slimmed);
            Value::Object(slimmed)
        }
        value => value,
    }
}

/// Marker key stamped on a slimmed billingStatus so repeated passes are O(1).
/// Billing payloads bounce between Rust, the webview, disk, and the cloud ws
/// cache; every boundary defensively slims, and before this marker each hop
/// re-walked the full structure (a measured recurring CPU spike).
const DESKTOP_AUTH_BILLING_SLIM_MARKER: &str = "desktopSlimV";

fn desktop_auth_slim_billing_status(billing_status: Value) -> Value {
    if !billing_status.is_object() {
        return billing_status;
    }
    if billing_status.get(DESKTOP_AUTH_BILLING_SLIM_MARKER).is_some() {
        return billing_status;
    }
    let mut slimmed = desktop_auth_slim_billing_snapshot_value(billing_status);
    if let Some(object) = slimmed.as_object_mut() {
        object.insert(DESKTOP_AUTH_BILLING_SLIM_MARKER.to_string(), json!(1));
    }
    slimmed
}

fn desktop_auth_slim_user_snapshot(user: Value) -> Value {
    match user {
        Value::Object(mut object) => {
            if let Some(credits) = object.remove("credits") {
                object.insert(
                    "credits".to_string(),
                    desktop_auth_slim_billing_snapshot_value(credits),
                );
            }
            Value::Object(object)
        }
        value => value,
    }
}

fn desktop_auth_personal_scope() -> Value {
    json!({
        "id": "personal",
        "type": "personal",
        "label": "Personal",
        "teamId": Value::Null,
    })
}

fn desktop_auth_normalize_scope(_scope: &Value, _user: Option<&Value>) -> Value {
    desktop_auth_personal_scope()
}

fn desktop_auth_account_scopes(_user: Option<&Value>) -> Value {
    json!([desktop_auth_personal_scope()])
}

fn desktop_auth_user_plan_status(user: Option<&Value>) -> String {
    user.and_then(|user| {
        desktop_auth_text(user, &["planStatus"])
            .or_else(|| desktop_auth_text(user, &["plan_status"]))
    })
    .unwrap_or_else(|| "free".to_string())
    .to_ascii_lowercase()
}

fn desktop_auth_plan_name_from_snapshot(snapshot: &Value) -> String {
    let billing = snapshot.get("billingStatus").unwrap_or(&Value::Null);
    let user = snapshot.get("user");
    let plan_status = desktop_auth_user_plan_status(user);
    let plan_name = desktop_auth_text(billing, &["planName"])
        .or_else(|| desktop_auth_text(billing, &["plan_name"]))
        .or_else(|| desktop_auth_text(billing, &["credits", "planName"]))
        .or_else(|| desktop_auth_text(billing, &["credits", "plan_name"]))
        .or_else(|| user.and_then(|user| desktop_auth_text(user, &["planName"])))
        .or_else(|| user.and_then(|user| desktop_auth_text(user, &["plan_name"])))
        .unwrap_or_else(|| if plan_status == "paid" { "plus" } else { "free" }.to_string());
    cloud_mcp_plan_name_from_value(Some(plan_name))
}

/// Whether the currently persisted desktop session is an authenticated PAID
/// account, decided entirely from local state (no cloud round-trip). Free
/// accounts have no personal cloud instance, so this gates whether the app
/// should open the account websocket at all. Unknown/signed-out reads as not
/// paid — the paid-gated webview warmup connects later if the plan upgrades.
pub(crate) fn desktop_auth_account_is_paid(app: &AppHandle) -> bool {
    let snapshot = desktop_auth_snapshot(app);
    if snapshot.get("status").and_then(Value::as_str) != Some("authenticated") {
        return false;
    }
    let plan_status = desktop_auth_user_plan_status(snapshot.get("user"));
    if plan_status == "paid" {
        return true;
    }
    let plan_name = desktop_auth_plan_name_from_snapshot(&snapshot);
    !plan_name.is_empty() && plan_name != "free"
}

fn desktop_auth_device_limit_from_snapshot(snapshot: &Value, plan_name: &str) -> u64 {
    let billing = snapshot.get("billingStatus").unwrap_or(&Value::Null);
    let user = snapshot.get("user").unwrap_or(&Value::Null);
    desktop_auth_u64(billing, &["entitlements", "deviceLimit"])
        .or_else(|| desktop_auth_u64(billing, &["limits", "deviceLimit"]))
        .or_else(|| desktop_auth_u64(billing, &["user", "entitlements", "deviceLimit"]))
        .or_else(|| desktop_auth_u64(user, &["entitlements", "deviceLimit"]))
        .unwrap_or_else(|| cloud_mcp_device_limit_for_plan(plan_name))
}

fn desktop_auth_credit_snapshot_has_meaningful_data(credits: &Value) -> bool {
    if !credits.is_object() {
        return false;
    }
    if credits.get("known").and_then(Value::as_bool) == Some(true)
        || credits.get("live").and_then(Value::as_bool) == Some(true)
        || desktop_auth_text(credits, &["planName"]).is_some()
        || desktop_auth_text(credits, &["plan_name"]).is_some()
        || desktop_auth_text(credits, &["term", "planName"]).is_some()
        || desktop_auth_text(credits, &["term", "plan_name"]).is_some()
        || desktop_auth_text(credits, &["term", "id"]).is_some()
    {
        return true;
    }
    [
        &["termTotalCredits"][..],
        &["term_total_credits"][..],
        &["termRemainingCredits"][..],
        &["term_remaining_credits"][..],
        &["termReservedCredits"][..],
        &["term_reserved_credits"][..],
        &["termUsedCredits"][..],
        &["term_used_credits"][..],
        &["localMeteredUsedCredits"][..],
        &["local_metered_used_credits"][..],
        &["total", "totalCredits"][..],
        &["total", "total_credits"][..],
        &["total", "remainingCredits"][..],
        &["total", "remaining_credits"][..],
        &["total", "reservedCredits"][..],
        &["total", "reserved_credits"][..],
        &["total", "usedCredits"][..],
        &["total", "used_credits"][..],
    ]
    .iter()
    .any(|path| desktop_auth_u64(credits, path).is_some())
}

fn desktop_auth_first_i64(value: &Value, paths: &[&[&str]]) -> Option<i64> {
    paths.iter().find_map(|path| desktop_auth_i64(value, path))
}

fn desktop_auth_max_i64(value: &Value, paths: &[&[&str]]) -> Option<i64> {
    paths
        .iter()
        .filter_map(|path| desktop_auth_i64(value, path))
        .max()
}

fn desktop_auth_first_text(value: &Value, paths: &[&[&str]]) -> Option<String> {
    paths.iter().find_map(|path| desktop_auth_text(value, path))
}

fn desktop_auth_credit_same_term(incoming: Option<&Value>, previous: Option<&Value>) -> bool {
    let Some(incoming) = incoming else {
        return true;
    };
    let Some(previous) = previous else {
        return true;
    };
    let incoming_plan = desktop_auth_first_text(
        incoming,
        &[
            &["planName"][..],
            &["plan_name"][..],
            &["planStatus"][..],
            &["plan_status"][..],
            &["status"][..],
        ],
    )
    .unwrap_or_default()
    .to_ascii_lowercase();
    let previous_plan = desktop_auth_first_text(
        previous,
        &[
            &["planName"][..],
            &["plan_name"][..],
            &["planStatus"][..],
            &["plan_status"][..],
            &["status"][..],
        ],
    )
    .unwrap_or_default()
    .to_ascii_lowercase();
    if incoming_plan == "free" && previous_plan != "free" && !previous_plan.is_empty() {
        return false;
    }
    let incoming_term_id = desktop_auth_first_text(
        incoming,
        &[&["termId"][..], &["term_id"][..], &["term", "id"][..]],
    );
    let previous_term_id = desktop_auth_first_text(
        previous,
        &[&["termId"][..], &["term_id"][..], &["term", "id"][..]],
    );
    if let (Some(incoming_term_id), Some(previous_term_id)) = (incoming_term_id, previous_term_id) {
        return incoming_term_id == previous_term_id;
    }
    let incoming_term_end = desktop_auth_first_text(
        incoming,
        &[
            &["termEnd"][..],
            &["term_end"][..],
            &["resetAt"][..],
            &["reset_at"][..],
            &["term", "termEnd"][..],
            &["term", "term_end"][..],
        ],
    );
    let previous_term_end = desktop_auth_first_text(
        previous,
        &[
            &["termEnd"][..],
            &["term_end"][..],
            &["resetAt"][..],
            &["reset_at"][..],
            &["term", "termEnd"][..],
            &["term", "term_end"][..],
        ],
    );
    match (incoming_term_end, previous_term_end) {
        (Some(incoming_term_end), Some(previous_term_end)) => incoming_term_end == previous_term_end,
        _ => true,
    }
}

fn desktop_auth_normalize_credit_wallet(
    credits: Value,
    incoming_credits: Option<&Value>,
    previous_credits: Option<&Value>,
) -> Value {
    if !desktop_auth_credit_snapshot_has_meaningful_data(&credits) {
        return credits;
    }

    let empty = Value::Null;
    let incoming_source = incoming_credits.unwrap_or(&empty);
    let incoming_unknown = incoming_source.get("known").and_then(Value::as_bool) == Some(false)
        && incoming_source.get("live").and_then(Value::as_bool) != Some(true);
    let trusted_incoming = (!incoming_unknown && incoming_source.is_object()).then_some(incoming_source);
    let incoming_authoritative = trusted_incoming.is_some_and(|incoming| {
        incoming.get("known").and_then(Value::as_bool) == Some(true)
            || incoming.get("live").and_then(Value::as_bool) == Some(true)
    });
    let incoming_top_term_id = trusted_incoming.and_then(|incoming| {
        desktop_auth_first_text(incoming, &[&["termId"][..], &["term_id"][..]])
    });
    let incoming_nested_term_id = trusted_incoming
        .and_then(|incoming| desktop_auth_text(incoming, &["term", "id"]));
    let incoming_nested_term_conflicts = matches!(
        (&incoming_top_term_id, &incoming_nested_term_id),
        (Some(top), Some(nested)) if top != nested
    );
    let same_term = if incoming_unknown {
        true
    } else {
        desktop_auth_credit_same_term(incoming_credits, previous_credits)
    };
    let source = if incoming_unknown {
        previous_credits.unwrap_or(&credits)
    } else if same_term {
        &credits
    } else {
        incoming_credits.unwrap_or(&credits)
    };
    let previous_source = if same_term {
        previous_credits.unwrap_or(&empty)
    } else {
        &empty
    };

    let incoming_used = trusted_incoming.and_then(|incoming| {
        let mut paths = vec![
            &["termUsedCredits"][..],
            &["term_used_credits"][..],
            &["usedCredits"][..],
            &["used_credits"][..],
            &["localMeteredUsedCredits"][..],
            &["local_metered_used_credits"][..],
        ];
        if !incoming_nested_term_conflicts {
            paths.extend([
                &["total", "usedCredits"][..],
                &["total", "used_credits"][..],
                &["term", "usedCredits"][..],
                &["term", "used_credits"][..],
            ]);
        }
        desktop_auth_max_i64(incoming, &paths)
    });
    let fallback_used = [
        desktop_auth_max_i64(
            source,
            &[
                &["termUsedCredits"][..],
                &["term_used_credits"][..],
                &["usedCredits"][..],
                &["used_credits"][..],
                &["localMeteredUsedCredits"][..],
                &["local_metered_used_credits"][..],
                &["total", "usedCredits"][..],
                &["total", "used_credits"][..],
                &["term", "usedCredits"][..],
                &["term", "used_credits"][..],
            ],
        ),
        desktop_auth_max_i64(
            previous_source,
            &[
                &["termUsedCredits"][..],
                &["term_used_credits"][..],
                &["usedCredits"][..],
                &["used_credits"][..],
                &["total", "used_credits"][..],
                &["total", "usedCredits"][..],
            ],
        ),
    ]
    .into_iter()
    .flatten()
    .max()
    .unwrap_or(0);
    let used = match incoming_used {
        Some(incoming) if !same_term => incoming,
        Some(incoming) => incoming.max(fallback_used),
        None => fallback_used,
    };
    let incoming_reserved = trusted_incoming.and_then(|incoming| {
        desktop_auth_first_i64(
            incoming,
            &[
                &["termReservedCredits"][..],
                &["term_reserved_credits"][..],
                &["reservedCredits"][..],
                &["reserved_credits"][..],
            ],
        )
        .or_else(|| {
            (!incoming_nested_term_conflicts)
                .then(|| {
                    desktop_auth_first_i64(
                        incoming,
                        &[
                            &["total", "reservedCredits"][..],
                            &["total", "reserved_credits"][..],
                            &["term", "reservedCredits"][..],
                            &["term", "reserved_credits"][..],
                        ],
                    )
                })
                .flatten()
        })
    });
    let fallback_reserved = desktop_auth_first_i64(
        source,
        &[
            &["termReservedCredits"][..],
            &["term_reserved_credits"][..],
            &["reservedCredits"][..],
            &["reserved_credits"][..],
            &["total", "reservedCredits"][..],
            &["total", "reserved_credits"][..],
            &["term", "reservedCredits"][..],
            &["term", "reserved_credits"][..],
        ],
    )
    .or_else(|| {
        desktop_auth_first_i64(
            previous_source,
            &[
                &["termReservedCredits"][..],
                &["term_reserved_credits"][..],
                &["reservedCredits"][..],
                &["reserved_credits"][..],
            ],
        )
    })
    .unwrap_or(0);
    let reserved = incoming_reserved.unwrap_or(fallback_reserved);
    let incoming_total = trusted_incoming.and_then(|incoming| {
        desktop_auth_first_i64(
            incoming,
            &[
                &["termTotalCredits"][..],
                &["term_total_credits"][..],
                &["totalCredits"][..],
                &["total_credits"][..],
            ],
        )
        .or_else(|| {
            (!incoming_nested_term_conflicts)
                .then(|| {
                    desktop_auth_first_i64(
                        incoming,
                        &[
                            &["total", "totalCredits"][..],
                            &["total", "total_credits"][..],
                            &["term", "totalCredits"][..],
                            &["term", "total_credits"][..],
                        ],
                    )
                })
                .flatten()
        })
    });
    let fallback_total = [
        desktop_auth_max_i64(
            source,
            &[
                &["termTotalCredits"][..],
                &["term_total_credits"][..],
                &["totalCredits"][..],
                &["total_credits"][..],
                &["total", "totalCredits"][..],
                &["total", "total_credits"][..],
                &["term", "totalCredits"][..],
                &["term", "total_credits"][..],
            ],
        ),
        desktop_auth_max_i64(
            previous_source,
            &[
                &["termTotalCredits"][..],
                &["term_total_credits"][..],
                &["totalCredits"][..],
                &["total_credits"][..],
                &["total", "total_credits"][..],
                &["total", "totalCredits"][..],
            ],
        ),
    ]
    .into_iter()
    .flatten()
    .max()
    .unwrap_or(0);
    let total = incoming_total.unwrap_or(fallback_total);
    let incoming_remaining = trusted_incoming.and_then(|incoming| {
        let top = desktop_auth_first_i64(
            incoming,
            &[
                &["termRemainingCredits"][..],
                &["term_remaining_credits"][..],
                &["remainingCredits"][..],
                &["remaining_credits"][..],
            ],
        );
        let nested = (!incoming_nested_term_conflicts)
            .then(|| {
                desktop_auth_first_i64(
                    incoming,
                    &[
                        &["total", "remainingCredits"][..],
                        &["total", "remaining_credits"][..],
                        &["term", "remainingCredits"][..],
                        &["term", "remaining_credits"][..],
                    ],
                )
            })
            .flatten();
        match top {
            Some(value) if incoming_authoritative || value > 0 => Some(value),
            Some(value) => nested.or(Some(value)),
            None => nested,
        }
    });
    let fallback_remaining = desktop_auth_first_i64(
        source,
        &[
            &["termRemainingCredits"][..],
            &["term_remaining_credits"][..],
            &["remainingCredits"][..],
            &["remaining_credits"][..],
            &["total", "remainingCredits"][..],
            &["total", "remaining_credits"][..],
            &["term", "remainingCredits"][..],
            &["term", "remaining_credits"][..],
        ],
    )
    .or_else(|| {
        desktop_auth_first_i64(
            previous_source,
            &[
                &["termRemainingCredits"][..],
                &["term_remaining_credits"][..],
                &["remainingCredits"][..],
                &["remaining_credits"][..],
            ],
        )
    });
    let computed_remaining = (total > 0).then(|| total.saturating_sub(used).saturating_sub(reserved).max(0));
    let incoming_changes_balance = incoming_used.is_some()
        || incoming_total.is_some()
        || incoming_reserved.is_some();
    let remaining = match (incoming_remaining, fallback_remaining, computed_remaining) {
        (Some(direct), _, _) if incoming_authoritative => direct.max(0),
        (Some(direct), _, _) if direct > 0 => direct,
        (Some(_), _, Some(computed)) => computed,
        (Some(direct), _, None) => direct.max(0),
        (None, _, Some(computed)) if incoming_changes_balance => computed,
        (None, Some(direct), Some(_)) if direct > 0 => direct,
        (None, Some(_), Some(computed)) => computed,
        (None, Some(direct), None) => direct.max(0),
        (None, None, Some(computed)) => computed,
        (None, None, None) => 0,
    };

    let mut object = credits
        .as_object()
        .cloned()
        .unwrap_or_else(serde_json::Map::new);
    object.insert("termUsedCredits".to_string(), json!(used));
    object.insert("term_used_credits".to_string(), json!(used));
    object.insert("usedCredits".to_string(), json!(used));
    object.insert("used_credits".to_string(), json!(used));
    object.insert("termRemainingCredits".to_string(), json!(remaining));
    object.insert("term_remaining_credits".to_string(), json!(remaining));
    object.insert("remainingCredits".to_string(), json!(remaining));
    object.insert("remaining_credits".to_string(), json!(remaining));
    object.insert("termReservedCredits".to_string(), json!(reserved));
    object.insert("term_reserved_credits".to_string(), json!(reserved));
    object.insert("reservedCredits".to_string(), json!(reserved));
    object.insert("reserved_credits".to_string(), json!(reserved));
    object.insert("termTotalCredits".to_string(), json!(total));
    object.insert("term_total_credits".to_string(), json!(total));
    object.insert("totalCredits".to_string(), json!(total));
    object.insert("total_credits".to_string(), json!(total));
    let term_id = trusted_incoming
        .and_then(|incoming| {
            desktop_auth_first_text(
                incoming,
                &[&["termId"][..], &["term_id"][..], &["term", "id"][..]],
            )
        })
        .or_else(|| {
            desktop_auth_first_text(
                source,
                &[&["termId"][..], &["term_id"][..], &["term", "id"][..]],
            )
        })
        .or_else(|| {
            desktop_auth_first_text(
                previous_source,
                &[&["termId"][..], &["term_id"][..], &["term", "id"][..]],
            )
        });
    if let Some(term_id) = term_id.as_ref() {
        object.insert("termId".to_string(), json!(term_id.clone()));
        object.insert("term_id".to_string(), json!(term_id.clone()));
    }
    let term_end = trusted_incoming
        .and_then(|incoming| {
            desktop_auth_first_text(
                incoming,
                &[
                    &["termEnd"][..],
                    &["term_end"][..],
                    &["resetAt"][..],
                    &["reset_at"][..],
                    &["term", "termEnd"][..],
                    &["term", "term_end"][..],
                ],
            )
        })
        .or_else(|| {
            desktop_auth_first_text(
                source,
                &[
                    &["termEnd"][..],
                    &["term_end"][..],
                    &["resetAt"][..],
                    &["reset_at"][..],
                    &["term", "termEnd"][..],
                    &["term", "term_end"][..],
                ],
            )
        })
        .or_else(|| {
            desktop_auth_first_text(
                previous_source,
                &[
                &["termEnd"][..],
                &["term_end"][..],
                &["resetAt"][..],
                &["reset_at"][..],
                    &["term", "termEnd"][..],
                    &["term", "term_end"][..],
                ],
            )
        });
    if let Some(term_end) = term_end.as_ref() {
        object.insert("termEnd".to_string(), json!(term_end.clone()));
        object.insert("term_end".to_string(), json!(term_end.clone()));
        object.insert("resetAt".to_string(), json!(term_end.clone()));
        object.insert("reset_at".to_string(), json!(term_end.clone()));
    }

    let mut total_object = object
        .get("total")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_else(serde_json::Map::new);
    for (camel, snake, value) in [
        ("usedCredits", "used_credits", used),
        ("remainingCredits", "remaining_credits", remaining),
        ("reservedCredits", "reserved_credits", reserved),
        ("totalCredits", "total_credits", total),
    ] {
        total_object.insert(camel.to_string(), json!(value));
        total_object.insert(snake.to_string(), json!(value));
    }
    object.insert("total".to_string(), Value::Object(total_object));

    let mut term_object = object
        .get("term")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_else(serde_json::Map::new);
    for (camel, snake, value) in [
        ("usedCredits", "used_credits", used),
        ("remainingCredits", "remaining_credits", remaining),
        ("reservedCredits", "reserved_credits", reserved),
        ("totalCredits", "total_credits", total),
    ] {
        term_object.insert(camel.to_string(), json!(value));
        term_object.insert(snake.to_string(), json!(value));
    }
    if let Some(term_id) = term_id {
        term_object.insert("id".to_string(), json!(term_id));
    }
    if let Some(term_end) = term_end {
        term_object.insert("termEnd".to_string(), json!(term_end.clone()));
        term_object.insert("term_end".to_string(), json!(term_end));
    }
    if let Some(plan_name) = desktop_auth_first_text(
        &Value::Object(object.clone()),
        &[&["planName"][..], &["plan_name"][..]],
    ) {
        term_object.insert("planName".to_string(), json!(plan_name.clone()));
        term_object.insert("plan_name".to_string(), json!(plan_name));
    }
    object.insert("term".to_string(), Value::Object(term_object));
    Value::Object(object)
}

fn desktop_auth_billing_status_has_meaningful_data(billing_status: &Value) -> bool {
    if !billing_status.is_object() {
        return false;
    }
    desktop_auth_text(billing_status, &["planName"]).is_some()
        || desktop_auth_text(billing_status, &["plan_name"]).is_some()
        || desktop_auth_text(billing_status, &["planStatus"]).is_some()
        || desktop_auth_text(billing_status, &["plan_status"]).is_some()
        || desktop_auth_credit_snapshot_has_meaningful_data(
            billing_status.get("credits").unwrap_or(&Value::Null),
        )
        || desktop_auth_credit_snapshot_has_meaningful_data(
            billing_status
                .get("user")
                .and_then(|user| user.get("credits"))
                .unwrap_or(&Value::Null),
        )
}

fn desktop_auth_merge_billing_status(previous: &Value, incoming: Value) -> Value {
    // `previous` always comes from a snapshot that already went through
    // desktop_auth_snapshot_from_raw (which slims billingStatus), so only the
    // incoming server payload needs the slim pass. Re-slimming previous — and
    // the merged result below — on every ws billing message was itself a
    // measured CPU hotspot.
    let previous = previous.clone();
    let incoming = desktop_auth_slim_billing_status(incoming);
    if !desktop_auth_billing_status_has_meaningful_data(&incoming) {
        return previous;
    }
    let Some(incoming_object) = incoming.as_object() else {
        return previous;
    };
    let mut merged = previous
        .as_object()
        .cloned()
        .unwrap_or_else(serde_json::Map::new);
    for (key, value) in incoming_object {
        merged.insert(key.clone(), value.clone());
    }
    let incoming_credits = incoming
        .get("credits")
        .filter(|credits| desktop_auth_credit_snapshot_has_meaningful_data(credits))
        .or_else(|| {
            incoming
                .get("user")
                .and_then(|user| user.get("credits"))
                .filter(|credits| desktop_auth_credit_snapshot_has_meaningful_data(credits))
        });
    if let Some(incoming_credits) = incoming_credits {
        let mut credits = previous
            .get("credits")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_else(serde_json::Map::new);
        if let Some(incoming_credits_object) = incoming_credits.as_object() {
            for (key, value) in incoming_credits_object {
                credits.insert(key.clone(), value.clone());
            }
        }
        let credits = desktop_auth_normalize_credit_wallet(
            Value::Object(credits),
            Some(incoming_credits),
            previous.get("credits"),
        );
        merged.insert("credits".to_string(), credits.clone());
        if let Some(user) = merged.get_mut("user").and_then(Value::as_object_mut) {
            user.insert("credits".to_string(), credits);
        }
    } else if let Some(previous_credits) = previous.get("credits") {
        if desktop_auth_credit_snapshot_has_meaningful_data(previous_credits) {
            merged.insert("credits".to_string(), previous_credits.clone());
        }
    }
    desktop_auth_slim_billing_status(Value::Object(merged))
}

fn desktop_auth_entitlements(snapshot: &Value) -> Value {
    let user = snapshot.get("user");
    let plan_status = desktop_auth_user_plan_status(user);
    let plan_name = desktop_auth_plan_name_from_snapshot(snapshot);
    let device_limit = desktop_auth_device_limit_from_snapshot(snapshot, &plan_name);
    let agent_entitlements = desktop_auth_agent_entitlements_for_plan(&plan_name);
    let team_entitlements = desktop_auth_team_entitlements_for_plan(&plan_name);
    let paid = plan_status == "paid" || plan_name != "free";
    json!({
        "planName": plan_name,
        "planStatus": if paid { "paid" } else { "free" },
        "agents": agent_entitlements,
        "teams": team_entitlements,
        "deviceLimit": device_limit,
        "isPaid": paid,
        "canUseCloudSync": paid,
        "canUseForgeAudio": paid,
        "canUseTokenomicsCloud": paid,
    })
}

fn desktop_auth_agent_entitlements_for_plan(plan_name: &str) -> Value {
    let (shared_agent_compute_credits, dedicated_agent_limit, status) =
        match plan_name.trim().to_ascii_lowercase().as_str() {
            "ultra" => (12, 1, "coming_soon"),
            "pro" => (5, 0, "coming_soon"),
            "plus" => (1, 0, "coming_soon"),
            _ => (0, 0, "unavailable"),
        };
    let shared_agent_small_credit_cost = 1;
    let shared_agent_big_credit_cost = 4;
    let shared_agent_limit = shared_agent_compute_credits / shared_agent_small_credit_cost;
    let shared_agent_big_limit = shared_agent_compute_credits / shared_agent_big_credit_cost;
    json!({
        "sharedAgentLimit": shared_agent_limit,
        "shared_agent_limit": shared_agent_limit,
        "sharedAgentComputeCredits": shared_agent_compute_credits,
        "shared_agent_compute_credits": shared_agent_compute_credits,
        "sharedAgentSmallCreditCost": shared_agent_small_credit_cost,
        "shared_agent_small_credit_cost": shared_agent_small_credit_cost,
        "sharedAgentBigCreditCost": shared_agent_big_credit_cost,
        "shared_agent_big_credit_cost": shared_agent_big_credit_cost,
        "sharedAgentSmallLimit": shared_agent_limit,
        "shared_agent_small_limit": shared_agent_limit,
        "sharedAgentBigLimit": shared_agent_big_limit,
        "shared_agent_big_limit": shared_agent_big_limit,
        "dedicatedAgentLimit": dedicated_agent_limit,
        "dedicated_agent_limit": dedicated_agent_limit,
        "status": status,
    })
}

fn desktop_auth_team_entitlements_for_plan(plan_name: &str) -> Value {
    let (team_limit, team_member_limit, team_device_limit, status) =
        match plan_name.trim().to_ascii_lowercase().as_str() {
            "ultra" => (1, 25, 150, "coming_soon"),
            "pro" => (1, 10, 50, "coming_soon"),
            _ => (0, 0, 0, "unavailable"),
        };
    json!({
        "teamLimit": team_limit,
        "team_limit": team_limit,
        "teamMemberLimit": team_member_limit,
        "team_member_limit": team_member_limit,
        "teamDeviceLimit": team_device_limit,
        "team_device_limit": team_device_limit,
        "status": status,
    })
}

fn desktop_auth_account_key(user: Option<&Value>) -> String {
    user.and_then(|user| {
        desktop_auth_text(user, &["id"])
            .or_else(|| desktop_auth_text(user, &["$id"]))
            .or_else(|| desktop_auth_text(user, &["email"]))
    })
    .unwrap_or_default()
}

fn desktop_auth_snapshot_from_raw(raw: Value) -> Value {
    let raw = raw.as_object().cloned().unwrap_or_default();
    let user = raw
        .get("user")
        .cloned()
        .filter(Value::is_object)
        .map(desktop_auth_slim_user_snapshot);
    let token = raw
        .get("token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| is_safe_auth_value(value))
        .map(str::to_string)
        .unwrap_or_default();
    let pending_state = raw
        .get("pendingState")
        .or_else(|| raw.get("pending_state"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| is_safe_auth_value(value))
        .map(str::to_string)
        .unwrap_or_default();
    let stored_status = raw
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("signedOut");
    let status = if !token.is_empty() && user.is_some() {
        "authenticated"
    } else if matches!(stored_status, "waiting" | "exchanging" | "checking") && !pending_state.is_empty() {
        stored_status
    } else if stored_status == "checking" {
        "checking"
    } else {
        "signedOut"
    };
    let stage = raw
        .get("stage")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| if status == "authenticated" { "authenticated" } else { "idle" });
    let message = raw
        .get("message")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DESKTOP_AUTH_DEFAULT_MESSAGE);
    let error = raw
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let active_scope = raw
        .get("activeScope")
        .or_else(|| raw.get("active_scope"))
        .map(|scope| desktop_auth_normalize_scope(scope, user.as_ref()))
        .unwrap_or_else(desktop_auth_personal_scope);
    let account_scopes = desktop_auth_account_scopes(user.as_ref());
    let billing_status = desktop_auth_slim_billing_status(
        raw.get("billingStatus").cloned().unwrap_or(Value::Null),
    );
    let expires_at = raw
        .get("expiresAt")
        .or_else(|| raw.get("expires_at"))
        .cloned()
        .filter(|value| value.as_str().is_some_and(|text| !text.trim().is_empty()))
        .unwrap_or(Value::Null);
    let mut snapshot = json!({
        "status": status,
        "stage": stage,
        "message": message,
        "error": error,
        "user": user.clone().unwrap_or(Value::Null),
        "token": token,
        "expiresAt": expires_at,
        "activeScope": active_scope,
        "accountScopes": account_scopes,
        "pendingState": pending_state,
        "billingStatus": billing_status,
        "version": raw.get("version").and_then(Value::as_u64).unwrap_or(0),
        "updatedAtMs": raw.get("updatedAtMs").and_then(Value::as_u64).unwrap_or(0),
    });
    snapshot["accountKey"] = json!(desktop_auth_account_key(user.as_ref()));
    snapshot["entitlements"] = desktop_auth_entitlements(&snapshot);
    snapshot
}

/// Cache for the normalized desktop auth snapshot keyed by the state file's
/// (mtime, size). desktop_auth_snapshot() is on hot paths (ws billing
/// messages, many commands); before this cache every call re-read and
/// re-parsed the JSON from disk and re-ran the slim pass — brutal while the
/// legacy file was ~2 MB.
static DESKTOP_AUTH_SNAPSHOT_CACHE: std::sync::OnceLock<
    std::sync::Mutex<Option<(u64, u64, Value)>>,
> = std::sync::OnceLock::new();
/// One-time migration marker: rewrite a fat legacy state file with the
/// slimmed snapshot so subsequent cold reads stay cheap.
static DESKTOP_AUTH_SLIM_MIGRATED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

fn desktop_auth_state_file_stamp(app: &AppHandle) -> Option<(u64, u64)> {
    let path = app_local_state_path(app, DESKTOP_AUTH_STATE_KEY).ok()?;
    let metadata = fs::metadata(path).ok()?;
    let modified_ms = metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some((modified_ms, metadata.len()))
}

fn desktop_auth_snapshot(app: &AppHandle) -> Value {
    let stamp = desktop_auth_state_file_stamp(app);
    let cache = DESKTOP_AUTH_SNAPSHOT_CACHE.get_or_init(|| std::sync::Mutex::new(None));
    if let (Some((modified_ms, size)), Ok(cached)) = (stamp, cache.lock()) {
        if let Some((cached_modified, cached_size, snapshot)) = cached.as_ref() {
            if *cached_modified == modified_ms && *cached_size == size {
                return snapshot.clone();
            }
        }
    }

    let raw = app_local_state_read(app, DESKTOP_AUTH_STATE_KEY);
    let raw_was_fat = stamp.map(|(_, size)| size > 256 * 1024).unwrap_or(false);
    let snapshot = desktop_auth_snapshot_from_raw(raw);

    // Migrate a fat legacy file to the slimmed shape once so cold reads and
    // the frontend localStorage mirror stop paying for megabytes of
    // duplicated billing history.
    if raw_was_fat
        && !DESKTOP_AUTH_SLIM_MIGRATED.swap(true, std::sync::atomic::Ordering::SeqCst)
    {
        let write_result = app_local_state_write(app, DESKTOP_AUTH_STATE_KEY, &snapshot);
        log_terminal_status_event(
            "backend.desktop_auth.slim_migration",
            json!({
                "ok": write_result.is_ok(),
                "error": write_result.err().unwrap_or_default(),
                "bytesBefore": stamp.map(|(_, size)| size).unwrap_or(0),
                "bytesAfter": serde_json::to_string(&snapshot).map(|s| s.len()).unwrap_or(0),
            }),
        );
    }

    if let (Some((modified_ms, size)), Ok(mut cached)) =
        (desktop_auth_state_file_stamp(app), cache.lock())
    {
        *cached = Some((modified_ms, size, snapshot.clone()));
    }
    snapshot
}

fn desktop_auth_exchange_lock() -> &'static Mutex<()> {
    static DESKTOP_AUTH_EXCHANGE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    DESKTOP_AUTH_EXCHANGE_LOCK.get_or_init(|| Mutex::new(()))
}

/// Cheap scalar identity of a billing snapshot for burst dedupe: no history
/// walks, only shallow gets. Empty when the payload lacks the scalars.
fn desktop_auth_billing_shallow_fingerprint(billing_status: &Value) -> String {
    let credits = billing_status
        .get("credits")
        .or_else(|| billing_status.get("user").and_then(|user| user.get("credits")));
    let field = |source: Option<&Value>, keys: &[&str]| -> String {
        let Some(source) = source else {
            return String::new();
        };
        for key in keys {
            if let Some(value) = source.get(*key) {
                if !value.is_null() {
                    return value.to_string();
                }
            }
        }
        String::new()
    };
    let wallet = billing_status
        .get("wallet")
        .or_else(|| credits.and_then(|credits| credits.get("wallet")));
    let parts = [
        field(Some(billing_status), &["walletVersion", "wallet_version"]),
        field(Some(billing_status), &["updatedAt", "updated_at", "updatedAtMs", "updated_at_ms"]),
        field(Some(billing_status), &["planName", "plan_name"]),
        field(credits, &["termUsedCredits", "term_used_credits", "usedCredits", "used_credits"]),
        field(credits, &["termRemainingCredits", "term_remaining_credits", "remainingCredits", "remaining_credits"]),
        field(credits, &["walletVersion", "wallet_version"]),
        field(credits, &["updatedAt", "updated_at", "updatedAtMs", "updated_at_ms"]),
        field(wallet, &["walletVersion", "wallet_version", "version"]),
        field(wallet, &["usedCredits", "used_credits"]),
        field(wallet, &["remainingCredits", "remaining_credits"]),
        field(wallet, &["updatedAt", "updated_at", "updatedAtMs", "updated_at_ms"]),
    ];
    if parts.iter().all(String::is_empty) {
        return String::new();
    }
    parts.join("|")
}

fn desktop_auth_public_snapshot(snapshot: &Value) -> Value {
    // Callers always pass a snapshot produced by desktop_auth_snapshot_from_raw
    // (or by merge paths that slim their inputs), so billingStatus/user are
    // already slim — re-slimming here ran the full deep pass on every command
    // response and event emit, which showed up in CPU spike samples.
    let mut public_snapshot = snapshot.clone();
    if let Some(object) = public_snapshot.as_object_mut() {
        object.remove("token");
        object.remove("pendingState");
        object.remove("pending_state");
    }
    public_snapshot
}

fn desktop_auth_snapshot_token(snapshot: &Value) -> Option<String> {
    snapshot
        .get("token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| is_safe_auth_value(value))
        .map(str::to_string)
}

fn desktop_auth_snapshot_pending_state(snapshot: &Value) -> String {
    snapshot
        .get("pendingState")
        .or_else(|| snapshot.get("pending_state"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| is_safe_auth_value(value))
        .unwrap_or_default()
        .to_string()
}

fn desktop_auth_snapshot_has_rejected_session(snapshot: &Value) -> bool {
    if snapshot.get("status").and_then(Value::as_str) != Some("signedOut") {
        return false;
    }
    let text = [
        snapshot.get("error").and_then(Value::as_str).unwrap_or(""),
        snapshot.get("message").and_then(Value::as_str).unwrap_or(""),
    ]
    .join(" ")
    .to_ascii_lowercase();
    text.contains("desktop session expired")
        || text.contains("desktop session is invalid")
        || text.contains("unauthorized")
        || text.contains("forbidden")
}

fn desktop_auth_current_validation_snapshot(app: &AppHandle, token: &str) -> Option<Value> {
    let current = desktop_auth_snapshot(app);
    let current_token = desktop_auth_snapshot_token(&current)?;
    if current_token != token || !desktop_auth_snapshot_pending_state(&current).is_empty() {
        return None;
    }
    Some(current)
}

fn desktop_auth_snapshot_version(snapshot: &Value) -> Option<u64> {
    snapshot.get("version").and_then(Value::as_u64)
}

fn desktop_auth_snapshot_still_current(app: &AppHandle, snapshot: &Value) -> bool {
    let current = desktop_auth_snapshot(app);
    if let Some(expected_version) = desktop_auth_snapshot_version(snapshot) {
        return desktop_auth_snapshot_version(&current) == Some(expected_version);
    }
    current.get("status").and_then(Value::as_str)
        == snapshot.get("status").and_then(Value::as_str)
        && desktop_auth_snapshot_token(&current) == desktop_auth_snapshot_token(snapshot)
        && desktop_auth_snapshot_pending_state(&current) == desktop_auth_snapshot_pending_state(snapshot)
}

fn desktop_auth_persist_lock() -> &'static StdMutex<()> {
    static DESKTOP_AUTH_PERSIST_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
    DESKTOP_AUTH_PERSIST_LOCK.get_or_init(|| StdMutex::new(()))
}

fn desktop_auth_snapshot_matches_account(snapshot: &Value, expected_account_key: &str) -> bool {
    let expected = expected_account_key.trim();
    if expected.is_empty() {
        return true;
    }
    let current = desktop_auth_text(snapshot, &["accountKey"])
        .or_else(|| desktop_auth_text(snapshot, &["account_key"]))
        .or_else(|| {
            snapshot
                .get("user")
                .and_then(|user| desktop_auth_text(user, &["id"]))
        })
        .or_else(|| {
            snapshot
                .get("user")
                .and_then(|user| desktop_auth_text(user, &["$id"]))
        })
        .or_else(|| {
            snapshot
                .get("user")
                .and_then(|user| desktop_auth_text(user, &["email"]))
        })
        .unwrap_or_default();
    current == expected
}

fn desktop_auth_persist_snapshot(app: &AppHandle, snapshot: Value) -> Result<Value, String> {
    desktop_auth_persist_snapshot_for_account(app, snapshot, None)
}

fn desktop_auth_persist_snapshot_for_account(
    app: &AppHandle,
    snapshot: Value,
    expected_account_key: Option<&str>,
) -> Result<Value, String> {
    let _persist_guard = desktop_auth_persist_lock()
        .lock()
        .map_err(|_| "Unable to lock desktop auth state for persistence.".to_string())?;
    let previous = desktop_auth_snapshot(app);
    if expected_account_key
        .is_some_and(|expected| !desktop_auth_snapshot_matches_account(&previous, expected))
    {
        return Ok(previous);
    }
    desktop_auth_persist_snapshot_locked(app, snapshot, previous)
}

fn desktop_auth_persist_snapshot_locked(
    app: &AppHandle,
    mut snapshot: Value,
    previous: Value,
) -> Result<Value, String> {
    let previous_version = previous.get("version").and_then(Value::as_u64).unwrap_or(0);
    // Dedupe before stamping version/updatedAtMs: a persist that changes
    // nothing else must not write the (multi-hundred-KB) state file, chmod it,
    // and emit a full snapshot over IPC. Repeated no-op persists have driven
    // event→apply→persist feedback loops at hundreds of iterations/second
    // (the 800% cold-start burn).
    {
        let mut prev_cmp = previous.clone();
        let mut next_cmp = snapshot.clone();
        for key in ["version", "updatedAtMs"] {
            if let Some(object) = prev_cmp.as_object_mut() {
                object.remove(key);
            }
            if let Some(object) = next_cmp.as_object_mut() {
                object.remove(key);
            }
        }
        let next_cmp = desktop_auth_snapshot_from_raw(next_cmp);
        if prev_cmp == next_cmp {
            return Ok(previous);
        }
    }
    snapshot["version"] = json!(previous_version.saturating_add(1));
    snapshot["updatedAtMs"] = json!(current_time_ms());
    let snapshot = desktop_auth_snapshot_from_raw(snapshot);
    app_local_state_write(app, DESKTOP_AUTH_STATE_KEY, &snapshot)?;
    #[cfg(unix)]
    if let Ok(path) = app_local_state_path(app, DESKTOP_AUTH_STATE_KEY) {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    let _ = app.emit(
        DESKTOP_AUTH_STATE_CHANGED_EVENT,
        desktop_auth_public_snapshot(&snapshot),
    );
    Ok(snapshot)
}

fn desktop_auth_rebase_billing_status(current: &Value, billing_status: Value) -> Value {
    let mut rebased = current.clone();
    let next_billing_status = desktop_auth_merge_billing_status(
        current.get("billingStatus").unwrap_or(&Value::Null),
        billing_status,
    );
    rebased["billingStatus"] = next_billing_status;
    rebased
}

fn desktop_auth_persist_billing_status_for_account(
    app: &AppHandle,
    billing_status: Value,
    expected_account_key: Option<&str>,
) -> Result<Value, String> {
    let _persist_guard = desktop_auth_persist_lock()
        .lock()
        .map_err(|_| "Unable to lock desktop auth state for persistence.".to_string())?;
    let current = desktop_auth_snapshot(app);
    if expected_account_key
        .is_some_and(|expected| !desktop_auth_snapshot_matches_account(&current, expected))
    {
        return Ok(current);
    }
    let incoming_fingerprint = desktop_auth_billing_shallow_fingerprint(&billing_status);
    if !incoming_fingerprint.is_empty() {
        let current_fingerprint = desktop_auth_billing_shallow_fingerprint(
            current.get("billingStatus").unwrap_or(&Value::Null),
        );
        if incoming_fingerprint == current_fingerprint {
            return Ok(current);
        }
    }
    let rebased = desktop_auth_rebase_billing_status(&current, billing_status);
    desktop_auth_persist_snapshot_locked(app, rebased, current)
}

fn desktop_auth_signed_out_snapshot(message: &str, error: &str, clear_pending: bool) -> Value {
    json!({
        "status": "signedOut",
        "stage": "idle",
        "message": if message.trim().is_empty() { DESKTOP_AUTH_DEFAULT_MESSAGE } else { message.trim() },
        "error": error.trim(),
        "user": Value::Null,
        "token": "",
        "activeScope": desktop_auth_personal_scope(),
        "pendingState": if clear_pending { json!("") } else { Value::Null },
        "billingStatus": Value::Null,
    })
}

fn desktop_auth_scope_payload(_scope: &Value) -> (String, Option<String>) {
    ("personal".to_string(), None)
}

async fn desktop_auth_sync_cloud_state(
    app: &AppHandle,
    cloud_mcp_state: &CloudMcpState,
    snapshot: &Value,
) -> Result<(), String> {
    let token = snapshot
        .get("token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let active_scope = snapshot
        .get("activeScope")
        .cloned()
        .unwrap_or_else(desktop_auth_personal_scope);
    let (scope_type, team_id) = desktop_auth_scope_payload(&active_scope);
    let entitlements = snapshot.get("entitlements").unwrap_or(&Value::Null);
    let plan_name = desktop_auth_text(entitlements, &["planName"])
        .unwrap_or_else(|| desktop_auth_plan_name_from_snapshot(snapshot));
    let device_limit = desktop_auth_u64(entitlements, &["deviceLimit"])
        .unwrap_or_else(|| cloud_mcp_device_limit_for_plan(&plan_name));
    let account_key = desktop_auth_text(snapshot, &["accountKey"])
        .or_else(|| desktop_auth_text(snapshot, &["account_key"]));
    cloud_mcp_apply_desktop_auth_session(
        app.clone(),
        cloud_mcp_state,
        account_key,
        token,
        Some(scope_type),
        team_id,
        Some(plan_name),
        Some(device_limit),
    )
    .await?;
    Ok(())
}

fn desktop_auth_sync_cloud_state_background(
    app: &AppHandle,
    cloud_mcp_state: &CloudMcpState,
    snapshot: &Value,
) {
    let app = app.clone();
    let cloud_mcp_state = cloud_mcp_state.clone();
    let snapshot = snapshot.clone();
    tauri::async_runtime::spawn(async move {
        if !desktop_auth_snapshot_still_current(&app, &snapshot) {
            log_terminal_status_event(
                "backend.desktop_auth.cloud_sync_skipped_stale_snapshot",
                json!({}),
            );
            return;
        }
        let _ = desktop_auth_sync_cloud_state(&app, &cloud_mcp_state, &snapshot).await;
    });
}

pub(crate) async fn desktop_auth_restore_cloud_session_for_startup(
    app: &AppHandle,
    cloud_mcp_state: &CloudMcpState,
) -> bool {
    let snapshot = desktop_auth_snapshot(app);
    if snapshot.get("status").and_then(Value::as_str) != Some("authenticated") {
        return false;
    }
    let Some(token) = snapshot
        .get("token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| is_safe_auth_value(value))
    else {
        return false;
    };
    if token.is_empty() {
        return false;
    }
    match validate_desktop_session_checked(token.to_string()).await {
        Ok(session) => {
            let Some(current) = desktop_auth_current_validation_snapshot(app, token) else {
                return false;
            };
            let next = match desktop_auth_authenticated_snapshot_from_session(
                &current,
                token,
                &session,
                Some("Initializing workspace..."),
            ) {
                Ok(next) => next,
                Err(error) => {
                    let Some(_current) = desktop_auth_current_validation_snapshot(app, token)
                    else {
                        return false;
                    };
                    if let Ok(next) = desktop_auth_persist_snapshot(
                        app,
                        desktop_auth_signed_out_snapshot(
                            "Your desktop session expired. Sign in again with the web app.",
                            &error,
                            true,
                        ),
                    ) {
                        let _ = desktop_auth_sync_cloud_state(app, cloud_mcp_state, &next).await;
                    }
                    return false;
                }
            };
            let Ok(next) = desktop_auth_persist_snapshot(app, next) else {
                return false;
            };
            desktop_auth_sync_cloud_state(app, cloud_mcp_state, &next)
                .await
                .is_ok()
        }
        Err(error) => {
            let Some(_current) = desktop_auth_current_validation_snapshot(app, token) else {
                return false;
            };
            if error.kind == DesktopAuthSessionFailureKind::Transport {
                log_terminal_status_event(
                    "backend.desktop_auth.startup_restore_transport_error",
                    json!({ "error": clean_terminal_telemetry_text(&error.message) }),
                );
                return false;
            }
            if let Ok(next) = desktop_auth_persist_snapshot(
                app,
                desktop_auth_signed_out_snapshot(
                    "Your desktop session expired. Sign in again with the web app.",
                    DESKTOP_AUTH_SESSION_EXPIRED_MESSAGE,
                    true,
                ),
            ) {
                let _ = desktop_auth_sync_cloud_state(app, cloud_mcp_state, &next).await;
            }
            false
        }
    }
}

fn desktop_auth_percent_encode_query_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len() * 3);
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*byte as char);
            }
            _ => {
                encoded.push('%');
                encoded.push_str(&format!("{byte:02X}"));
            }
        }
    }
    encoded
}

fn desktop_auth_login_url(state: &str) -> String {
    let mut pairs = vec![("state".to_string(), state.to_string())];
    pairs.push((
        "desktop_callback_scheme".to_string(),
        desktop_auth_callback_scheme().to_string(),
    ));
    let device_profile = cloud_mcp_desktop_device_profile();
    for (key, path) in [
        ("desktop_device_id", &["device_id", "deviceId"][..]),
        (
            "desktop_device_name",
            &["device_name", "deviceName", "machine_name", "machineName"][..],
        ),
        ("desktop_platform", &["platform", "os"][..]),
        (
            "desktop_form_factor",
            &["form_factor", "formFactor", "device_type", "deviceType"][..],
        ),
        (
            "desktop_app_version",
            &["app_version", "appVersion"][..],
        ),
        ("desktop_architecture", &["architecture", "arch"][..]),
        (
            "desktop_build_channel",
            &["build_channel", "buildChannel"][..],
        ),
    ] {
        if let Some(value) = cloud_mcp_payload_text(&device_profile, path) {
            pairs.push((key.to_string(), value));
        }
    }
    let query = pairs
        .into_iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                desktop_auth_percent_encode_query_component(&key),
                desktop_auth_percent_encode_query_component(&value)
            )
        })
        .collect::<Vec<_>>()
        .join("&");
    let base = desktop_web_login_url_base();
    let separator = if base.contains('?') { "&" } else { "?" };
    format!("{base}{separator}{query}")
}

fn desktop_auth_new_state() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn desktop_auth_query_value(url_value: &str, key: &str) -> Option<String> {
    let query = url_value.split_once('?')?.1.split('#').next().unwrap_or("");
    for part in query.split('&') {
        let (name, value) = part.split_once('=').unwrap_or((part, ""));
        if name == key {
            return Some(value.to_string());
        }
    }
    None
}

fn desktop_auth_parse_callback(url_value: &str) -> Option<(String, String)> {
    let url = url_value.trim();
    let callback_base = url.split_once('?')?.0;
    if callback_base != desktop_auth_callback_base() {
        return None;
    }
    let code = desktop_auth_query_value(url, "code")?;
    let state = desktop_auth_query_value(url, "state")?;
    if !is_safe_auth_value(&code) || !is_safe_auth_value(&state) {
        return None;
    }
    Some((code, state))
}

fn desktop_auth_extract_session_token(session: &Value) -> Result<String, String> {
    session
        .get("token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| is_safe_auth_value(value))
        .map(str::to_string)
        .ok_or_else(|| "Desktop session response did not include a valid token.".to_string())
}

fn desktop_auth_extract_session_user(session: &Value) -> Result<Value, String> {
    session
        .get("user")
        .cloned()
        .filter(Value::is_object)
        .ok_or_else(|| "Desktop session response did not include a valid user.".to_string())
}

fn desktop_auth_session_expires_at(session: &Value) -> Value {
    session
        .get("expiresAt")
        .or_else(|| session.get("expires_at"))
        .cloned()
        .filter(|value| value.as_str().is_some_and(|text| !text.trim().is_empty()))
        .unwrap_or(Value::Null)
}

fn desktop_auth_authenticated_snapshot_from_session(
    current: &Value,
    token: &str,
    session: &Value,
    message: Option<&str>,
) -> Result<Value, String> {
    let user = desktop_auth_extract_session_user(session)?;
    let active_scope = desktop_auth_normalize_scope(
        current.get("activeScope").unwrap_or(&Value::Null),
        Some(&user),
    );
    let mut next = current.clone();
    next["status"] = json!("authenticated");
    next["stage"] = json!("authenticated");
    next["message"] = json!(message
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            current
                .get("message")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("Initializing workspace...")
        }));
    next["error"] = json!("");
    next["token"] = json!(token);
    next["expiresAt"] = desktop_auth_session_expires_at(session);
    next["user"] = user;
    next["activeScope"] = active_scope;
    next["pendingState"] = json!("");
    Ok(next)
}

const DESKTOP_AUTH_CALLBACK_SCHEME_ENV: &str = "RUST_DIFFFORGE_DESKTOP_CALLBACK_SCHEME";
const DESKTOP_AUTH_PROD_CALLBACK_SCHEME: &str = "diffforge";
const DESKTOP_AUTH_DEV_CALLBACK_SCHEME: &str = "diffforge-dev";
const DESKTOP_AUTH_CALLBACK_PATH: &str = "auth/callback";

fn desktop_auth_normalize_callback_scheme(value: &str) -> Option<&'static str> {
    match value.trim() {
        DESKTOP_AUTH_PROD_CALLBACK_SCHEME => Some(DESKTOP_AUTH_PROD_CALLBACK_SCHEME),
        DESKTOP_AUTH_DEV_CALLBACK_SCHEME => Some(DESKTOP_AUTH_DEV_CALLBACK_SCHEME),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn desktop_auth_macos_bundle_looks_dev() -> bool {
    let Ok(executable) = env::current_exe() else {
        return false;
    };

    for ancestor in executable.ancestors() {
        let is_app_bundle = ancestor
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"));
        if !is_app_bundle {
            continue;
        }

        let bundle_name = ancestor
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if bundle_name.contains(" Dev.") || bundle_name.contains(" Dev.app") {
            return true;
        }

        let info_plist = ancestor.join("Contents").join("Info.plist");
        if let Ok(bytes) = fs::read(info_plist) {
            let text = String::from_utf8_lossy(&bytes);
            if text.contains("ai.diffforge.desktop.dev")
                || text.contains("Diff Forge AI Dev")
            {
                return true;
            }
        }
    }

    false
}

fn desktop_auth_callback_scheme() -> &'static str {
    if let Ok(value) = env::var(DESKTOP_AUTH_CALLBACK_SCHEME_ENV) {
        if let Some(scheme) = desktop_auth_normalize_callback_scheme(&value) {
            return scheme;
        }
    }

    #[cfg(target_os = "macos")]
    if desktop_auth_macos_bundle_looks_dev() {
        return DESKTOP_AUTH_DEV_CALLBACK_SCHEME;
    }

    DESKTOP_AUTH_PROD_CALLBACK_SCHEME
}

fn desktop_auth_callback_base() -> String {
    format!(
        "{}://{}",
        desktop_auth_callback_scheme(),
        DESKTOP_AUTH_CALLBACK_PATH
    )
}

#[tauri::command(rename_all = "snake_case")]
async fn desktop_auth_snapshot_command(app: AppHandle) -> Result<Value, String> {
    Ok(desktop_auth_public_snapshot(&desktop_auth_snapshot(&app)))
}

#[tauri::command(rename_all = "snake_case")]
async fn desktop_auth_start_login(app: AppHandle) -> Result<Value, String> {
    let state = desktop_auth_new_state();
    let snapshot = desktop_auth_persist_snapshot(
        &app,
        json!({
            "status": "waiting",
            "stage": "browser_handoff",
            "message": "Opening secure web sign-in in your browser...",
            "error": "",
            "pendingState": state,
        }),
    )?;
    Ok(json!({
        "login_url": desktop_auth_login_url(&state),
        "snapshot": desktop_auth_public_snapshot(&snapshot),
    }))
}

/// Start a one-time credit top-up checkout for the signed-in account. The web
/// backend validates the desktop session token and returns a Stripe Checkout
/// URL the shell opens in the system browser, so the user lands on Stripe
/// already identified — no interim sign-in page.
#[tauri::command(rename_all = "snake_case")]
async fn desktop_billing_start_topup_checkout(
    app: AppHandle,
    packs: Option<u32>,
) -> Result<Value, String> {
    let snapshot = desktop_auth_snapshot(&app);
    let token = snapshot
        .get("token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| is_safe_auth_value(value))
        .map(str::to_string)
        .ok_or_else(|| "Sign in to Diff Forge before buying credits.".to_string())?;
    let packs = packs.unwrap_or(1).clamp(1, 25);

    let client = http_client(Duration::from_secs(DEFAULT_API_TIMEOUT_SECS))?;
    let response = client
        .post(api_endpoint("desktop/topup-checkout"))
        .bearer_auth(token)
        .json(&json!({
            "packs": packs,
            "desktop_callback_scheme": desktop_auth_callback_scheme(),
        }))
        .send()
        .await
        .map_err(|error| format!("Unable to start credit top-up checkout: {error}"))?;

    read_api_response(response, "Unable to start credit top-up checkout.").await
}

#[tauri::command(rename_all = "snake_case")]
async fn desktop_auth_validate_session(
    app: AppHandle,
    cloud_mcp_state: State<'_, CloudMcpState>,
) -> Result<Value, String> {
    let snapshot = desktop_auth_snapshot(&app);
    let token = snapshot
        .get("token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| is_safe_auth_value(value))
        .map(str::to_string);
    let Some(token) = token else {
        let snapshot = desktop_auth_persist_snapshot(
            &app,
            desktop_auth_signed_out_snapshot(DESKTOP_AUTH_DEFAULT_MESSAGE, "", true),
        )?;
        desktop_auth_sync_cloud_state_background(&app, cloud_mcp_state.inner(), &snapshot);
        return Ok(desktop_auth_public_snapshot(&snapshot));
    };
    if snapshot.get("status").and_then(Value::as_str) != Some("authenticated") {
        let mut checking = snapshot.clone();
        checking["status"] = json!("checking");
        checking["stage"] = json!("session_restore");
        checking["message"] =
            json!("Checking saved desktop session. You can still sign in with the web app.");
        checking["error"] = json!("");
        let _ = desktop_auth_persist_snapshot(&app, checking);
    }

    match validate_desktop_session_checked(token.clone()).await {
        Ok(session) => {
            let Some(current) = desktop_auth_current_validation_snapshot(&app, &token) else {
                return Ok(desktop_auth_public_snapshot(&desktop_auth_snapshot(&app)));
            };
            let next = desktop_auth_authenticated_snapshot_from_session(
                &current,
                &token,
                &session,
                Some("Initializing workspace..."),
            )?;
            let next = desktop_auth_persist_snapshot(&app, next)?;
            desktop_auth_sync_cloud_state_background(&app, cloud_mcp_state.inner(), &next);
            Ok(desktop_auth_public_snapshot(&next))
        }
        Err(error) => {
            if desktop_auth_current_validation_snapshot(&app, &token).is_none() {
                return Ok(desktop_auth_public_snapshot(&desktop_auth_snapshot(&app)));
            }
            if error.kind == DesktopAuthSessionFailureKind::Transport {
                log_terminal_status_event(
                    "backend.desktop_auth.validate_transport_error",
                    json!({ "error": clean_terminal_telemetry_text(&error.message) }),
                );
                let current = desktop_auth_snapshot(&app);
                if current.get("status").and_then(Value::as_str) == Some("checking") {
                    let restored = desktop_auth_persist_snapshot(&app, snapshot)?;
                    return Ok(desktop_auth_public_snapshot(&restored));
                }
                return Ok(desktop_auth_public_snapshot(&current));
            }
            let next = desktop_auth_persist_snapshot(
                &app,
                desktop_auth_signed_out_snapshot(
                    "Your desktop session expired. Sign in again with the web app.",
                    DESKTOP_AUTH_SESSION_EXPIRED_MESSAGE,
                    true,
                ),
            )?;
            desktop_auth_sync_cloud_state_background(&app, cloud_mcp_state.inner(), &next);
            Ok(desktop_auth_public_snapshot(&next))
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn desktop_auth_handle_deep_link(
    app: AppHandle,
    cloud_mcp_state: State<'_, CloudMcpState>,
    url: String,
) -> Result<Value, String> {
    let _exchange_guard = desktop_auth_exchange_lock().lock().await;
    let Some((code, callback_state)) = desktop_auth_parse_callback(&url) else {
        return Ok(json!({
            "handled": false,
            "snapshot": desktop_auth_public_snapshot(&desktop_auth_snapshot(&app)),
        }));
    };
    let snapshot = desktop_auth_snapshot(&app);
    let pending_state = snapshot
        .get("pendingState")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if pending_state.is_empty() || pending_state != callback_state {
        if snapshot.get("status").and_then(Value::as_str) == Some("authenticated") {
            return Ok(json!({
                "handled": true,
                "snapshot": desktop_auth_public_snapshot(&snapshot),
            }));
        }
        let next = desktop_auth_persist_snapshot(
            &app,
            desktop_auth_signed_out_snapshot(
                DESKTOP_AUTH_DEFAULT_MESSAGE,
                "Desktop login state did not match. Start again from this app.",
                true,
            ),
        )?;
        desktop_auth_sync_cloud_state_background(&app, cloud_mcp_state.inner(), &next);
        return Ok(json!({
            "handled": true,
            "snapshot": desktop_auth_public_snapshot(&next),
        }));
    }

    let mut exchanging = snapshot.clone();
    exchanging["status"] = json!("exchanging");
    exchanging["stage"] = json!("session_exchange");
    exchanging["message"] = json!("Browser callback matched. Creating your desktop session...");
    exchanging["error"] = json!("");
    let _ = desktop_auth_persist_snapshot(&app, exchanging);

    match exchange_desktop_auth_code(code, callback_state.clone()).await {
        Ok(session) => {
            let current = desktop_auth_snapshot(&app);
            if desktop_auth_snapshot_pending_state(&current) != callback_state {
                return Ok(json!({
                    "handled": true,
                    "snapshot": desktop_auth_public_snapshot(&current),
                }));
            }
            let token = desktop_auth_extract_session_token(&session)?;
            let next = desktop_auth_authenticated_snapshot_from_session(
                &current,
                &token,
                &session,
                Some("Initializing workspace..."),
            )?;
            let next = desktop_auth_persist_snapshot(
                &app,
                {
                    let mut next = next;
                    next["billingStatus"] = Value::Null;
                    next
                },
            )?;
            desktop_auth_sync_cloud_state_background(&app, cloud_mcp_state.inner(), &next);
            Ok(json!({
                "handled": true,
                "snapshot": desktop_auth_public_snapshot(&next),
            }))
        }
        Err(error) => {
            let current = desktop_auth_snapshot(&app);
            if desktop_auth_snapshot_pending_state(&current) != callback_state {
                return Ok(json!({
                    "handled": true,
                    "snapshot": desktop_auth_public_snapshot(&current),
                    "error": error,
                }));
            }
            let next = desktop_auth_persist_snapshot(
                &app,
                desktop_auth_signed_out_snapshot(
                    DESKTOP_AUTH_DEFAULT_MESSAGE,
                    &error,
                    true,
                ),
            )?;
            desktop_auth_sync_cloud_state_background(&app, cloud_mcp_state.inner(), &next);
            Ok(json!({
                "handled": true,
                "snapshot": desktop_auth_public_snapshot(&next),
                "error": error,
            }))
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn desktop_auth_set_active_scope(
    app: AppHandle,
    cloud_mcp_state: State<'_, CloudMcpState>,
    scope: Value,
) -> Result<Value, String> {
    let mut snapshot = desktop_auth_snapshot(&app);
    let user = snapshot.get("user").cloned().filter(Value::is_object);
    let normalized_scope = desktop_auth_normalize_scope(&scope, user.as_ref());
    if snapshot.get("activeScope") == Some(&normalized_scope) {
        return Ok(desktop_auth_public_snapshot(&snapshot));
    }
    snapshot["activeScope"] = normalized_scope;
    let snapshot = desktop_auth_persist_snapshot(&app, snapshot)?;
    desktop_auth_sync_cloud_state_background(&app, cloud_mcp_state.inner(), &snapshot);
    Ok(desktop_auth_public_snapshot(&snapshot))
}

#[tauri::command(rename_all = "snake_case")]
async fn desktop_auth_apply_billing_status(
    app: AppHandle,
    cloud_mcp_state: State<'_, CloudMcpState>,
    billing_status: Value,
    expected_account_key: Option<String>,
) -> Result<Value, String> {
    let snapshot = desktop_auth_snapshot(&app);
    let expected_account_key = expected_account_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if expected_account_key
        .is_some_and(|expected| !desktop_auth_snapshot_matches_account(&snapshot, expected))
    {
        return Ok(desktop_auth_public_snapshot(&snapshot));
    }
    // Re-read and merge under the persistence lock. This both rejects an
    // account switch and preserves same-account token/user updates that may
    // have landed while the billing request was in flight.
    let snapshot = desktop_auth_persist_billing_status_for_account(
        &app,
        billing_status,
        expected_account_key,
    )?;
    desktop_auth_sync_cloud_state_background(&app, cloud_mcp_state.inner(), &snapshot);
    Ok(desktop_auth_public_snapshot(&snapshot))
}

#[tauri::command(rename_all = "snake_case")]
async fn desktop_auth_sign_out(
    app: AppHandle,
    cloud_mcp_state: State<'_, CloudMcpState>,
) -> Result<Value, String> {
    let snapshot = desktop_auth_snapshot(&app);
    let token = snapshot
        .get("token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| is_safe_auth_value(value))
        .map(str::to_string);
    let next = desktop_auth_persist_snapshot(
        &app,
        desktop_auth_signed_out_snapshot(DESKTOP_AUTH_DEFAULT_MESSAGE, "", true),
    )?;
    desktop_auth_sync_cloud_state_background(&app, cloud_mcp_state.inner(), &next);
    if let Some(token) = token {
        let _ = logout_desktop_session(token).await;
    }
    Ok(desktop_auth_public_snapshot(&next))
}

async fn desktop_auth_mark_stored_session_rejected(
    app: &AppHandle,
    cloud_mcp_state: &CloudMcpState,
    token: &str,
    _error: &str,
) -> bool {
    if desktop_auth_current_validation_snapshot(app, token).is_none() {
        return false;
    }
    match desktop_auth_persist_snapshot(
        app,
        desktop_auth_signed_out_snapshot(
            "Your desktop session expired. Sign in again with the web app.",
            DESKTOP_AUTH_SESSION_EXPIRED_MESSAGE,
            true,
        ),
    ) {
        Ok(next) => {
            let _ = desktop_auth_sync_cloud_state(app, cloud_mcp_state, &next).await;
            true
        }
        Err(persist_error) => {
            log_terminal_status_event(
                "backend.desktop_auth.reject_persist_failed",
                json!({ "error": clean_terminal_telemetry_text(&persist_error) }),
            );
            false
        }
    }
}

async fn desktop_auth_renew_stored_session_once(
    app: &AppHandle,
    cloud_mcp_state: &CloudMcpState,
    reason: &str,
    timeout_secs: u64,
) -> DesktopAuthRenewOutcome {
    let snapshot = desktop_auth_snapshot(app);
    let Some(token) = desktop_auth_snapshot_token(&snapshot) else {
        return DesktopAuthRenewOutcome::NoSession;
    };
    if token.is_empty() || !desktop_auth_snapshot_pending_state(&snapshot).is_empty() {
        return DesktopAuthRenewOutcome::NoSession;
    }

    match renew_desktop_session_checked(token.clone(), timeout_secs).await {
        Ok(session) => {
            let Some(current) = desktop_auth_current_validation_snapshot(app, &token) else {
                return DesktopAuthRenewOutcome::NoSession;
            };
            let next = match desktop_auth_authenticated_snapshot_from_session(
                &current,
                &token,
                &session,
                None,
            ) {
                Ok(next) => next,
                Err(error) => {
                    return DesktopAuthRenewOutcome::TransportError(error);
                }
            };
            match desktop_auth_persist_snapshot(app, next) {
                Ok(next) => {
                    desktop_auth_sync_cloud_state_background(app, cloud_mcp_state, &next);
                    log_terminal_status_event(
                        "backend.desktop_auth.session_renewed",
                        json!({
                            "reason": reason,
                            "expiresAt": next.get("expiresAt").cloned().unwrap_or(Value::Null),
                        }),
                    );
                    DesktopAuthRenewOutcome::Renewed
                }
                Err(error) => DesktopAuthRenewOutcome::TransportError(error),
            }
        }
        Err(error) => match error.kind {
            DesktopAuthSessionFailureKind::AuthRejected => {
                desktop_auth_mark_stored_session_rejected(
                    app,
                    cloud_mcp_state,
                    &token,
                    &error.message,
                )
                .await;
                DesktopAuthRenewOutcome::AuthRejected(error.message)
            }
            DesktopAuthSessionFailureKind::Transport => {
                DesktopAuthRenewOutcome::TransportError(error.message)
            }
        },
    }
}

fn desktop_auth_renewal_startup_delay_secs(seed_ms: u64) -> u64 {
    DESKTOP_AUTH_RENEWAL_STARTUP_MIN_SECS
        + (seed_ms % DESKTOP_AUTH_RENEWAL_STARTUP_JITTER_SECS.max(1))
}

fn desktop_auth_renewal_interval_secs(seed_ms: u64) -> u64 {
    let jitter_window = DESKTOP_AUTH_RENEWAL_JITTER_SECS.saturating_mul(2).saturating_add(1);
    let offset = seed_ms % jitter_window.max(1);
    DESKTOP_AUTH_RENEWAL_INTERVAL_SECS
        .saturating_sub(DESKTOP_AUTH_RENEWAL_JITTER_SECS)
        .saturating_add(offset)
}

fn desktop_auth_next_renew_backoff_secs(current_secs: u64) -> u64 {
    current_secs
        .saturating_mul(2)
        .clamp(DESKTOP_AUTH_RENEWAL_MIN_BACKOFF_SECS, DESKTOP_AUTH_RENEWAL_MAX_BACKOFF_SECS)
}

async fn desktop_auth_cloud_connected(cloud_mcp_state: &CloudMcpState) -> bool {
    let status = cloud_mcp_status_snapshot(cloud_mcp_state).await;
    status.connected || status.global_ws_connected
}

fn desktop_auth_renewal_log_state(
    last_logged_state: &mut String,
    state: &str,
    error: Option<&str>,
) {
    if last_logged_state == state {
        return;
    }
    *last_logged_state = state.to_string();
    log_terminal_status_event(
        "backend.desktop_auth.renewal_loop_state",
        json!({
            "state": state,
            "error": error.map(clean_terminal_telemetry_text),
        }),
    );
}

pub(crate) fn desktop_auth_start_renewal_loop(
    app: AppHandle,
    cloud_mcp_state: CloudMcpState,
) {
    static DESKTOP_AUTH_RENEWAL_LOOP_STARTED: AtomicBool = AtomicBool::new(false);
    if DESKTOP_AUTH_RENEWAL_LOOP_STARTED.swap(true, Ordering::AcqRel) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let mut backoff_secs = DESKTOP_AUTH_RENEWAL_MIN_BACKOFF_SECS;
        let mut transport_failed = false;
        let mut was_cloud_connected = false;
        let mut last_logged_state = String::new();
        let mut next_attempt = Instant::now()
            + Duration::from_secs(desktop_auth_renewal_startup_delay_secs(current_time_ms()));

        loop {
            let cloud_connected = desktop_auth_cloud_connected(&cloud_mcp_state).await;
            if transport_failed && cloud_connected && !was_cloud_connected {
                next_attempt = Instant::now();
                desktop_auth_renewal_log_state(
                    &mut last_logged_state,
                    "cloud_reconnected_retry",
                    None,
                );
            }
            was_cloud_connected = cloud_connected;

            let now = Instant::now();
            if now >= next_attempt {
                let outcome = desktop_auth_renew_stored_session_once(
                    &app,
                    &cloud_mcp_state,
                    "background_loop",
                    SESSION_RENEW_TIMEOUT_SECS,
                )
                .await;
                let now = Instant::now();
                match outcome {
                    DesktopAuthRenewOutcome::Renewed => {
                        transport_failed = false;
                        backoff_secs = DESKTOP_AUTH_RENEWAL_MIN_BACKOFF_SECS;
                        desktop_auth_renewal_log_state(&mut last_logged_state, "renewed", None);
                        next_attempt = now
                            + Duration::from_secs(desktop_auth_renewal_interval_secs(
                                current_time_ms(),
                            ));
                    }
                    DesktopAuthRenewOutcome::NoSession => {
                        transport_failed = false;
                        backoff_secs = DESKTOP_AUTH_RENEWAL_MIN_BACKOFF_SECS;
                        desktop_auth_renewal_log_state(&mut last_logged_state, "no_session", None);
                        next_attempt =
                            now + Duration::from_secs(DESKTOP_AUTH_RENEWAL_NO_SESSION_SECS);
                    }
                    DesktopAuthRenewOutcome::AuthRejected(error) => {
                        transport_failed = false;
                        backoff_secs = DESKTOP_AUTH_RENEWAL_MIN_BACKOFF_SECS;
                        desktop_auth_renewal_log_state(
                            &mut last_logged_state,
                            "auth_rejected",
                            Some(&error),
                        );
                        next_attempt =
                            now + Duration::from_secs(DESKTOP_AUTH_RENEWAL_NO_SESSION_SECS);
                    }
                    DesktopAuthRenewOutcome::TransportError(error) => {
                        transport_failed = true;
                        desktop_auth_renewal_log_state(
                            &mut last_logged_state,
                            "transport_error",
                            Some(&error),
                        );
                        next_attempt = now + Duration::from_secs(backoff_secs);
                        backoff_secs = desktop_auth_next_renew_backoff_secs(backoff_secs);
                    }
                }
            }

            let now = Instant::now();
            let until_next = next_attempt
                .checked_duration_since(now)
                .unwrap_or(Duration::ZERO);
            let sleep_for = until_next
                .min(Duration::from_secs(DESKTOP_AUTH_RENEWAL_CONNECTIVITY_POLL_SECS))
                .max(Duration::from_secs(1));
            sleep(sleep_for).await;
        }
    });
}

pub(crate) async fn desktop_auth_preflight_automatic_restart(
    app: &AppHandle,
    cloud_mcp_state: &CloudMcpState,
) -> DesktopAuthPreflightResult {
    let snapshot = desktop_auth_snapshot(app);
    let Some(token) = desktop_auth_snapshot_token(&snapshot) else {
        if desktop_auth_snapshot_has_rejected_session(&snapshot) {
            return DesktopAuthPreflightResult::new(
                DesktopAuthPreflightStatus::AuthRejected,
                Some(DESKTOP_AUTH_SESSION_EXPIRED_MESSAGE.to_string()),
            );
        }
        return DesktopAuthPreflightResult::new(DesktopAuthPreflightStatus::NoSession, None);
    };
    if token.is_empty() || !desktop_auth_snapshot_pending_state(&snapshot).is_empty() {
        return DesktopAuthPreflightResult::new(DesktopAuthPreflightStatus::NoSession, None);
    }

    match validate_desktop_session_checked(token.clone()).await {
        Ok(_) => {}
        Err(error) => {
            if error.kind == DesktopAuthSessionFailureKind::AuthRejected {
                desktop_auth_mark_stored_session_rejected(
                    app,
                    cloud_mcp_state,
                    &token,
                    &error.message,
                )
                .await;
                return DesktopAuthPreflightResult::new(
                    DesktopAuthPreflightStatus::AuthRejected,
                    Some(error.message),
                );
            }
            return DesktopAuthPreflightResult::new(
                DesktopAuthPreflightStatus::TransportError,
                Some(error.message),
            );
        }
    }

    match desktop_auth_renew_stored_session_once(
        app,
        cloud_mcp_state,
        "automatic_restart_preflight",
        SESSION_RENEW_TIMEOUT_SECS,
    )
    .await
    {
        DesktopAuthRenewOutcome::Renewed | DesktopAuthRenewOutcome::NoSession => {
            DesktopAuthPreflightResult::new(DesktopAuthPreflightStatus::AuthOk, None)
        }
        DesktopAuthRenewOutcome::AuthRejected(error) => DesktopAuthPreflightResult::new(
            DesktopAuthPreflightStatus::AuthRejected,
            Some(error),
        ),
        DesktopAuthRenewOutcome::TransportError(error) => DesktopAuthPreflightResult::new(
            DesktopAuthPreflightStatus::TransportError,
            Some(error),
        ),
    }
}

async fn exchange_desktop_auth_code(code: String, state: String) -> Result<Value, String> {
    validate_auth_value("Desktop auth code", &code)?;
    validate_auth_value("Desktop auth state", &state)?;

    let client = http_client(Duration::from_secs(AUTH_EXCHANGE_TIMEOUT_SECS))?;
    let response = client
        .post(api_endpoint("desktop/sessions/exchange"))
        .json(&ExchangeDesktopSessionRequest {
            code: &code,
            state: &state,
        })
        .send()
        .await
        .map_err(|error| format!("Unable to exchange desktop login: {error}"))?;

    read_api_response(response, "Desktop login expired. Try again.").await
}

async fn validate_desktop_session_checked(
    token: String,
) -> Result<Value, DesktopAuthSessionFailure> {
    validate_auth_value("Desktop session", &token).map_err(|error| {
        DesktopAuthSessionFailure::new(DesktopAuthSessionFailureKind::AuthRejected, error)
    })?;

    let client = http_client(Duration::from_secs(SESSION_VALIDATE_TIMEOUT_SECS)).map_err(|error| {
        DesktopAuthSessionFailure::new(DesktopAuthSessionFailureKind::Transport, error)
    })?;
    let response = client
        .get(api_endpoint("desktop/session"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| {
            DesktopAuthSessionFailure::new(
                DesktopAuthSessionFailureKind::Transport,
                format!("Unable to validate desktop session: {error}"),
            )
        })?;

    read_desktop_auth_api_response(response, "Desktop session expired.").await
}

async fn renew_desktop_session_checked(
    token: String,
    timeout_secs: u64,
) -> Result<Value, DesktopAuthSessionFailure> {
    validate_auth_value("Desktop session", &token).map_err(|error| {
        DesktopAuthSessionFailure::new(DesktopAuthSessionFailureKind::AuthRejected, error)
    })?;

    let client = http_client(Duration::from_secs(timeout_secs)).map_err(|error| {
        DesktopAuthSessionFailure::new(DesktopAuthSessionFailureKind::Transport, error)
    })?;
    let response = client
        .post(api_endpoint("desktop/session/renew"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| {
            DesktopAuthSessionFailure::new(
                DesktopAuthSessionFailureKind::Transport,
                format!("Unable to renew desktop session: {error}"),
            )
        })?;

    read_desktop_auth_api_response(response, "Desktop session expired.").await
}

async fn logout_desktop_session(token: String) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;

    let client = http_client(Duration::from_secs(LOGOUT_TIMEOUT_SECS))?;
    let response = client
        .delete(api_endpoint("desktop/session"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Unable to sign out desktop session: {error}"))?;

    read_api_response(response, "Unable to sign out desktop session.").await
}

fn start_desktop_device_authorization_blocking(device: Value) -> Result<Value, String> {
    let client = blocking_http_client(Duration::from_secs(DEVICE_AUTH_START_TIMEOUT_SECS))?;
    let response = client
        .post(api_endpoint("desktop/device-codes"))
        .json(&json!({ "device": device }))
        .send()
        .map_err(|error| format!("Unable to start device sign in: {error}"))?;

    read_blocking_api_response(response, "Unable to start device sign in.")
}

fn poll_desktop_device_authorization_blocking(device_code: &str) -> Result<Value, String> {
    validate_auth_value("Device auth code", device_code)?;

    let client = blocking_http_client(Duration::from_secs(DEVICE_AUTH_POLL_TIMEOUT_SECS))?;
    let response = client
        .post(api_endpoint("desktop/device-codes/token"))
        .json(&json!({ "device_code": device_code }))
        .send()
        .map_err(|error| format!("Unable to check device sign in: {error}"))?;
    let (status, body) =
        read_blocking_api_body(response, "Unable to check device sign in.")?;

    if status.as_u16() >= 500 {
        let error = body
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Unable to check device sign in.");
        return Err(error.to_string());
    }

    Ok(body)
}

fn is_safe_desktop_provisioning_token_value(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_AUTH_VALUE_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn desktop_auth_provisioning_token_file_path_from_env() -> Option<PathBuf> {
    match env::var("DIFFFORGE_PROVISION_TOKEN_FILE") {
        Ok(value) => {
            let path = value.trim();
            if path.is_empty() {
                None
            } else {
                Some(PathBuf::from(path))
            }
        }
        Err(env::VarError::NotUnicode(_)) => {
            eprintln!(
                "diffforge auth: ignoring DIFFFORGE_PROVISION_TOKEN_FILE because it is not valid UTF-8."
            );
            None
        }
        Err(env::VarError::NotPresent) => None,
    }
}

fn desktop_auth_provisioning_token_env_has_inline_token() -> bool {
    match env::var("DIFFFORGE_PROVISION_TOKEN") {
        Ok(value) => !value.trim().is_empty(),
        Err(env::VarError::NotUnicode(_)) => true,
        Err(env::VarError::NotPresent) => false,
    }
}

fn desktop_auth_provisioning_token_from_env() -> Option<String> {
    match env::var("DIFFFORGE_PROVISION_TOKEN") {
        Ok(value) => {
            let token = value.trim();
            if !token.is_empty() {
                if is_safe_desktop_provisioning_token_value(token) {
                    return Some(token.to_string());
                }
                eprintln!(
                    "diffforge auth: ignoring DIFFFORGE_PROVISION_TOKEN because the token value is not safe to use."
                );
                return None;
            }
        }
        Err(env::VarError::NotUnicode(_)) => {
            eprintln!(
                "diffforge auth: ignoring DIFFFORGE_PROVISION_TOKEN because it is not valid UTF-8."
            );
            return None;
        }
        Err(env::VarError::NotPresent) => {}
    }

    let path = desktop_auth_provisioning_token_file_path_from_env()?;
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) => {
            eprintln!("diffforge auth: unable to read DIFFFORGE_PROVISION_TOKEN_FILE: {error}");
            return None;
        }
    };
    let token = raw.trim();
    if token.is_empty() {
        return None;
    }
    if !is_safe_desktop_provisioning_token_value(token) {
        eprintln!(
            "diffforge auth: ignoring DIFFFORGE_PROVISION_TOKEN_FILE because the token value is not safe to use."
        );
        return None;
    }
    Some(token.to_string())
}

fn desktop_auth_provisioning_token_hash(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    format!("{digest:x}")
}

fn desktop_auth_provisioning_token_consumed_marker_matches(
    marker: &str,
    token_hash: &str,
) -> bool {
    marker.trim() == token_hash
}

fn desktop_auth_provisioning_token_consumed_marker_matches_path(
    path: &Path,
    token_hash: &str,
) -> bool {
    fs::read_to_string(path)
        .map(|marker| {
            desktop_auth_provisioning_token_consumed_marker_matches(&marker, token_hash)
        })
        .unwrap_or(false)
}

fn desktop_auth_provisioning_token_consumed_marker_matches_hash(token_hash: &str) -> bool {
    let Ok(path) = desktop_auth_provisioning_token_consumed_marker_path() else {
        return false;
    };
    desktop_auth_provisioning_token_consumed_marker_matches_path(&path, token_hash)
}

fn desktop_auth_write_provisioning_token_consumed_marker_hash_to_path(
    path: &Path,
    token_hash: &str,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create auth state directory: {error}"))?;
    }
    fs::write(path, token_hash)
        .map_err(|error| format!("Unable to write provisioning token marker: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn desktop_auth_write_provisioning_token_consumed_marker_hash(
    token_hash: &str,
) -> Result<(), String> {
    let path = desktop_auth_provisioning_token_consumed_marker_path()?;
    desktop_auth_write_provisioning_token_consumed_marker_hash_to_path(&path, token_hash)
}

fn redeem_desktop_provisioning_token_blocking(token: &str) -> Result<Value, String> {
    if !is_safe_desktop_provisioning_token_value(token) {
        return Err("Provisioning token is invalid.".to_string());
    }

    let client = blocking_http_client(Duration::from_secs(
        DESKTOP_AUTH_PROVISION_REDEEM_TIMEOUT_SECS,
    ))?;
    let response = client
        .post(api_endpoint("desktop/provisioning-tokens/redeem"))
        .json(&json!({
            "token": token,
            "device": desktop_auth_cli_device_metadata("provisioning_token"),
        }))
        .send()
        .map_err(|error| format!("Unable to redeem provisioning token: {error}"))?;

    read_blocking_api_response(response, "Unable to redeem provisioning token.")
        .map_err(|error| format!("Unable to redeem provisioning token: {error}"))
}

fn desktop_auth_try_provision_from_environment() -> Result<bool, String> {
    let Some(token) = desktop_auth_provisioning_token_from_env() else {
        return Ok(false);
    };

    // "Already authenticated" must mean a session the cloud still accepts —
    // a fleet box holding a revoked/expired session plus a fresh provisioning
    // token is exactly the reprovision case. Only a validated session skips
    // the redeem (and preserves the single-use token).
    let current = desktop_auth_cli_read_snapshot();
    if current.get("status").and_then(Value::as_str) == Some("authenticated") {
        let stored_token = current
            .get("token")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !stored_token.is_empty() && validate_desktop_session_blocking(stored_token).is_ok() {
            return Ok(false);
        }
        eprintln!(
            "diffforge auth: stored session no longer validates; redeeming provisioning token."
        );
    }

    let token_hash = desktop_auth_provisioning_token_hash(&token);
    if desktop_auth_provisioning_token_consumed_marker_matches_hash(&token_hash) {
        eprintln!(
            "diffforge auth: provisioning token already consumed by this device; not re-redeeming (mint a fresh token to reprovision)."
        );
        return Ok(false);
    }

    let token_file = if desktop_auth_provisioning_token_env_has_inline_token() {
        None
    } else {
        desktop_auth_provisioning_token_file_path_from_env()
    };

    let session = redeem_desktop_provisioning_token_blocking(&token)?;
    // The token is consumed server-side the moment the redeem succeeds —
    // clear the file before anything else can fail, or the next boot
    // re-redeems a burned token and loops on access_denied.
    let _ = desktop_auth_write_provisioning_token_consumed_marker_hash(&token_hash);
    if let Some(path) = token_file {
        let _ = fs::write(path, "");
    }
    desktop_auth_cli_snapshot_from_session(session)?;
    Ok(true)
}

fn validate_desktop_session_blocking(token: &str) -> Result<Value, String> {
    validate_auth_value("Desktop session", token)?;

    let client = blocking_http_client(Duration::from_secs(SESSION_VALIDATE_TIMEOUT_SECS))?;
    let response = client
        .get(api_endpoint("desktop/session"))
        .bearer_auth(token)
        .send()
        .map_err(|error| format!("Unable to validate desktop session: {error}"))?;

    read_blocking_api_response(response, "Desktop session expired.")
}

fn logout_desktop_session_blocking(token: &str) -> Result<Value, String> {
    validate_auth_value("Desktop session", token)?;

    let client = blocking_http_client(Duration::from_secs(LOGOUT_TIMEOUT_SECS))?;
    let response = client
        .delete(api_endpoint("desktop/session"))
        .bearer_auth(token)
        .send()
        .map_err(|error| format!("Unable to sign out desktop session: {error}"))?;

    read_blocking_api_response(response, "Unable to sign out desktop session.")
}

fn desktop_auth_cli_home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

fn desktop_auth_cli_app_data_dir() -> Result<PathBuf, String> {
    cloud_mcp_native_data_root()
        .ok_or_else(|| "Unable to resolve Diff Forge device data directory.".to_string())
}

fn desktop_auth_cli_legacy_app_data_dir() -> Result<PathBuf, String> {
    if cfg!(target_os = "windows") {
        if let Some(appdata) = env::var_os("APPDATA").map(PathBuf::from) {
            return Ok(appdata.join(PROD_BUNDLE_IDENTIFIER));
        }
        if let Some(home) = desktop_auth_cli_home_dir() {
            return Ok(home
                .join("AppData")
                .join("Roaming")
                .join(PROD_BUNDLE_IDENTIFIER));
        }
    } else if cfg!(target_os = "macos") {
        if let Some(home) = desktop_auth_cli_home_dir() {
            return Ok(home
                .join("Library")
                .join("Application Support")
                .join(PROD_BUNDLE_IDENTIFIER));
        }
    } else {
        if let Some(data_home) = env::var_os("XDG_DATA_HOME").map(PathBuf::from) {
            return Ok(data_home.join(PROD_BUNDLE_IDENTIFIER));
        }
        if let Some(home) = desktop_auth_cli_home_dir() {
            return Ok(home
                .join(".local")
                .join("share")
                .join(PROD_BUNDLE_IDENTIFIER));
        }
    }

    Err("Unable to resolve Diff Forge app data directory.".to_string())
}

fn desktop_auth_cli_state_dir() -> Result<PathBuf, String> {
    let state_dir = desktop_auth_cli_app_data_dir()?.join("app-state");
    fs::create_dir_all(&state_dir)
        .map_err(|error| format!("Unable to create auth state directory: {error}"))?;
    Ok(state_dir)
}

fn desktop_auth_cli_state_path() -> Result<PathBuf, String> {
    let state_dir = desktop_auth_cli_state_dir()?;
    Ok(state_dir.join(format!("{DESKTOP_AUTH_STATE_KEY}.json")))
}

fn desktop_auth_provisioning_token_consumed_marker_path() -> Result<PathBuf, String> {
    Ok(desktop_auth_cli_state_dir()?.join(DESKTOP_AUTH_PROVISION_TOKEN_CONSUMED_MARKER))
}

fn desktop_auth_cli_legacy_state_path() -> Result<PathBuf, String> {
    Ok(desktop_auth_cli_legacy_app_data_dir()?
        .join("app-state")
        .join(format!("{DESKTOP_AUTH_STATE_KEY}.json")))
}

fn desktop_auth_cli_read_snapshot() -> Value {
    if let Ok(path) = desktop_auth_cli_state_path() {
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                return desktop_auth_snapshot_from_raw(value);
            }
        }
    }

    let value = desktop_auth_cli_legacy_state_path()
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|body| serde_json::from_str::<Value>(&body).ok())
        .unwrap_or(json!(null));
    desktop_auth_snapshot_from_raw(value)
}

fn desktop_auth_cli_write_snapshot(snapshot: Value) -> Result<Value, String> {
    let path = desktop_auth_cli_state_path()?;
    let snapshot = desktop_auth_snapshot_from_raw(snapshot);
    let serialized = serde_json::to_vec_pretty(&snapshot)
        .map_err(|error| format!("Unable to serialize auth state: {error}"))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, serialized)
        .map_err(|error| format!("Unable to write auth state: {error}"))?;
    fs::rename(&temp_path, &path)
        .map_err(|error| format!("Unable to finalize auth state: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(snapshot)
}

fn desktop_auth_cli_clear_snapshot() -> Result<Value, String> {
    desktop_auth_cli_write_snapshot(desktop_auth_signed_out_snapshot(
        DESKTOP_AUTH_DEFAULT_MESSAGE,
        "",
        true,
    ))
}

fn desktop_auth_cli_gui_available() -> bool {
    cfg!(target_os = "macos")
        || cfg!(target_os = "windows")
        || env::var_os("DISPLAY").is_some()
        || env::var_os("WAYLAND_DISPLAY").is_some()
}

fn desktop_auth_cli_device_metadata(login_method: &str) -> Value {
    let mut device = cloud_mcp_desktop_device_profile();
    let gui_available = desktop_auth_cli_gui_available();
    if let Some(object) = device.as_object_mut() {
        object.insert("login_method".to_string(), json!(login_method));
        object.insert("app_version".to_string(), json!(env!("CARGO_PKG_VERSION")));
        object.insert("architecture".to_string(), json!(env::consts::ARCH));
        object.insert(
            "form_factor".to_string(),
            json!(if gui_available { "desktop" } else { "headless" }),
        );
        object.insert(
            "device_type".to_string(),
            json!(if gui_available { "pc" } else { "server" }),
        );
        object.insert(
            "capabilities".to_string(),
            json!([
                if gui_available { "gui" } else { "headless" },
                "terminal",
                "cloud_sync"
            ]),
        );
    }
    device
}

fn desktop_auth_cli_snapshot_from_session(session: Value) -> Result<Value, String> {
    let token = desktop_auth_extract_session_token(&session)?;
    let user = desktop_auth_extract_session_user(&session)?;
    desktop_auth_cli_write_snapshot(json!({
        "status": "authenticated",
        "stage": "authenticated",
        "message": "Signed in from the command line.",
        "error": "",
        "token": token,
        "expiresAt": desktop_auth_session_expires_at(&session),
        "user": user,
        "pendingState": "",
        "billingStatus": Value::Null,
    }))
}

fn desktop_auth_cli_token() -> Option<String> {
    desktop_auth_snapshot_token(&desktop_auth_cli_read_snapshot())
}

fn desktop_auth_cli_user_label(snapshot: &Value) -> String {
    snapshot
        .get("user")
        .and_then(|user| {
            desktop_auth_text(user, &["email"])
                .or_else(|| desktop_auth_text(user, &["name"]))
                .or_else(|| desktop_auth_text(user, &["id"]))
        })
        .unwrap_or_else(|| "Diff Forge account".to_string())
}

fn desktop_auth_cli_status() -> i32 {
    let Some(token) = desktop_auth_cli_token() else {
        println!("Signed out.");
        return 1;
    };

    match validate_desktop_session_blocking(&token) {
        Ok(session) => match desktop_auth_cli_snapshot_from_session({
            let mut next = session.clone();
            next["token"] = json!(token);
            next
        }) {
            Ok(snapshot) => {
                println!("Signed in as {}.", desktop_auth_cli_user_label(&snapshot));
                0
            }
            Err(error) => {
                eprintln!("Signed in, but unable to refresh local auth state: {error}");
                1
            }
        },
        Err(error) => {
            eprintln!("Saved session is not valid: {error}");
            let _ = desktop_auth_cli_clear_snapshot();
            1
        }
    }
}

fn desktop_auth_cli_logout() -> i32 {
    if let Some(token) = desktop_auth_cli_token() {
        let _ = logout_desktop_session_blocking(&token);
    }

    match desktop_auth_cli_clear_snapshot() {
        Ok(_) => {
            println!("Signed out.");
            0
        }
        Err(error) => {
            eprintln!("Unable to clear local auth state: {error}");
            1
        }
    }
}

fn desktop_auth_cli_login(args: &[String]) -> i32 {
    let force = args.iter().any(|arg| arg == "--force");
    if !force {
        if let Some(token) = desktop_auth_cli_token() {
            if let Ok(session) = validate_desktop_session_blocking(&token) {
                let mut next = session.clone();
                next["token"] = json!(token);
                if let Ok(snapshot) = desktop_auth_cli_snapshot_from_session(next) {
                    println!(
                        "Already signed in as {}. Run `diffforge auth logout` to switch accounts.",
                        desktop_auth_cli_user_label(&snapshot)
                    );
                    return 0;
                }
            }
        }
    }

    let authorization = match start_desktop_device_authorization_blocking(
        desktop_auth_cli_device_metadata("device_code"),
    ) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let device_code = authorization
        .get("device_code")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let user_code = authorization
        .get("user_code")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let verification_uri = authorization
        .get("verification_uri")
        .and_then(Value::as_str)
        .unwrap_or("https://diffforge.ai/device");
    let verification_uri_complete = authorization
        .get("verification_uri_complete")
        .and_then(Value::as_str)
        .unwrap_or(verification_uri);
    let mut interval = authorization
        .get("interval")
        .and_then(Value::as_u64)
        .unwrap_or(5)
        .clamp(2, 30);
    let expires_in = authorization
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(600);

    if device_code.is_empty() || user_code.is_empty() {
        eprintln!("Device sign in did not return a usable code.");
        return 1;
    }

    println!("Open: {verification_uri}");
    println!("Code: {user_code}");
    if verification_uri_complete != verification_uri {
        println!("Direct link: {verification_uri_complete}");
    }
    println!("Waiting for approval...");

    let deadline = Instant::now() + Duration::from_secs(expires_in.saturating_add(30));
    while Instant::now() < deadline {
        thread::sleep(Duration::from_secs(interval));
        let poll = match poll_desktop_device_authorization_blocking(&device_code) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("{error}");
                return 1;
            }
        };
        let status = poll
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match status {
            "authorized" => match desktop_auth_cli_snapshot_from_session(poll) {
                Ok(snapshot) => {
                    println!("Signed in as {}.", desktop_auth_cli_user_label(&snapshot));
                    return 0;
                }
                Err(error) => {
                    eprintln!("Unable to save desktop session: {error}");
                    return 1;
                }
            },
            "authorization_pending" => {
                interval = poll
                    .get("interval")
                    .and_then(Value::as_u64)
                    .unwrap_or(interval)
                    .clamp(2, 30);
            }
            "slow_down" => {
                interval = poll
                    .get("interval")
                    .and_then(Value::as_u64)
                    .unwrap_or(interval.saturating_add(5))
                    .clamp(2, 60);
            }
            "access_denied" => {
                eprintln!("Device sign in was denied.");
                return 1;
            }
            "expired_token" => {
                eprintln!("Device sign in expired. Run `diffforge auth login` again.");
                return 1;
            }
            _ => {
                let error = poll
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Device sign in failed.");
                eprintln!("{error}");
                return 1;
            }
        }
    }

    eprintln!("Device sign in timed out. Run `diffforge auth login` again.");
    1
}

fn desktop_auth_cli_provision(args: &[String]) -> i32 {
    let mut token_arg: Option<String> = None;
    let mut force = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--token" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("Missing value for --token.");
                    return 1;
                };
                token_arg = Some(value.clone());
                index += 2;
            }
            "--force" => {
                force = true;
                index += 1;
            }
            "--help" | "-h" => {
                desktop_auth_cli_help();
                return 0;
            }
            other => {
                eprintln!("Unknown auth provision option: {other}");
                return 1;
            }
        }
    }

    // Provisioning tokens are single-use: redeeming while a valid session
    // exists burns the token and replaces the session for nothing.
    if !force {
        let current = desktop_auth_cli_read_snapshot();
        if current.get("status").and_then(Value::as_str) == Some("authenticated") {
            let stored_token = current
                .get("token")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !stored_token.is_empty() && validate_desktop_session_blocking(stored_token).is_ok() {
                eprintln!(
                    "Already signed in as {}. Pass --force to redeem the provisioning token anyway (it is single-use and will replace this session).",
                    desktop_auth_cli_user_label(&current)
                );
                return 1;
            }
        }
    }

    let token = match token_arg {
        Some(value) => {
            let token = value.trim().to_string();
            if is_safe_desktop_provisioning_token_value(&token) {
                token
            } else {
                eprintln!("Provisioning token is invalid.");
                return 1;
            }
        }
        None => match desktop_auth_provisioning_token_from_env() {
            Some(token) => token,
            None => {
                eprintln!(
                    "No provisioning token provided. Pass --token or set DIFFFORGE_PROVISION_TOKEN / DIFFFORGE_PROVISION_TOKEN_FILE."
                );
                return 1;
            }
        },
    };

    match redeem_desktop_provisioning_token_blocking(&token)
        .and_then(desktop_auth_cli_snapshot_from_session)
    {
        Ok(snapshot) => {
            println!(
                "Provisioned desktop session for {}.",
                desktop_auth_cli_user_label(&snapshot)
            );
            0
        }
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

fn desktop_auth_cli_help() {
    println!("Diff Forge authentication");
    println!();
    println!("Usage:");
    println!("  diffforge auth login [--force]");
    println!("  diffforge auth provision [--token <token>] [--force]");
    println!("  diffforge auth status");
    println!("  diffforge auth logout");
    println!("  diffforge auth help");
    println!();
    println!("`auth login` works in GUI and headless terminals. It prints a device code");
    println!("that can be approved from any signed-in browser at https://diffforge.ai/device.");
    println!("`auth provision` redeems a provisioning token from --token,");
    println!("DIFFFORGE_PROVISION_TOKEN, or DIFFFORGE_PROVISION_TOKEN_FILE.");
}

pub fn run_desktop_auth_cli(args: &[String]) -> i32 {
    let command = args.first().map(String::as_str).unwrap_or("help");
    match command {
        "login" => desktop_auth_cli_login(&args[1..]),
        "provision" => desktop_auth_cli_provision(&args[1..]),
        "status" => desktop_auth_cli_status(),
        "logout" | "signout" | "sign-out" => desktop_auth_cli_logout(),
        "help" | "--help" | "-h" => {
            desktop_auth_cli_help();
            0
        }
        other => {
            eprintln!("Unknown auth command: {other}");
            desktop_auth_cli_help();
            2
        }
    }
}

#[cfg(test)]
mod desktop_auth_tests {
    use super::*;

    #[test]
    fn desktop_auth_login_url_uses_snake_case_query_keys() {
        let url = reqwest::Url::parse(&desktop_auth_login_url("state-123"))
            .expect("desktop login URL");
        let query = url
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect::<std::collections::HashMap<_, _>>();

        for key in [
            "state",
            "desktop_callback_scheme",
            "desktop_device_id",
            "desktop_device_name",
            "desktop_platform",
            "desktop_form_factor",
            "desktop_app_version",
            "desktop_architecture",
            "desktop_build_channel",
        ] {
            assert!(query.contains_key(key), "missing snake_case query key {key}");
        }
        for key in [
            "desktopCallbackScheme",
            "desktopDeviceId",
            "desktopDeviceName",
            "desktopPlatform",
            "desktopFormFactor",
            "desktopAppVersion",
            "desktopArchitecture",
            "desktopBuildChannel",
        ] {
            assert!(!query.contains_key(key), "found camelCase query key {key}");
        }
    }

    #[test]
    fn public_snapshot_redacts_private_auth_values() {
        let token = "a".repeat(MIN_AUTH_VALUE_LENGTH);
        let pending_state = "b".repeat(MIN_AUTH_VALUE_LENGTH);
        let expires_at = "2026-08-07T00:00:00.000Z";
        let snapshot = desktop_auth_snapshot_from_raw(json!({
            "status": "authenticated",
            "stage": "authenticated",
            "message": "ok",
            "token": token,
            "expiresAt": expires_at,
            "pendingState": pending_state,
            "user": { "id": "user-1", "email": "user@example.com" },
        }));

        assert_eq!(snapshot.get("token").and_then(Value::as_str), Some(token.as_str()));
        let public_snapshot = desktop_auth_public_snapshot(&snapshot);

        assert!(public_snapshot.get("token").is_none());
        assert!(public_snapshot.get("pendingState").is_none());
        assert_eq!(
            public_snapshot.get("status").and_then(Value::as_str),
            Some("authenticated")
        );
        assert_eq!(
            public_snapshot.get("accountKey").and_then(Value::as_str),
            Some("user-1")
        );
        assert_eq!(
            public_snapshot.get("expiresAt").and_then(Value::as_str),
            Some(expires_at)
        );
    }

    #[test]
    fn billing_persistence_account_guard_rejects_stale_accounts() {
        let snapshot = json!({
            "accountKey": "account-current",
            "user": {
                "id": "account-current",
                "$id": "legacy-current",
                "email": "current@example.com"
            }
        });

        assert!(desktop_auth_snapshot_matches_account(
            &snapshot,
            "account-current"
        ));
        assert!(!desktop_auth_snapshot_matches_account(
            &snapshot,
            "account-previous"
        ));
        assert!(desktop_auth_snapshot_matches_account(&snapshot, ""));

        let legacy_snapshot = json!({
            "user": { "$id": "legacy-current" }
        });
        assert!(desktop_auth_snapshot_matches_account(
            &legacy_snapshot,
            "legacy-current"
        ));
    }

    #[test]
    fn desktop_auth_failure_classifier_separates_auth_from_transport() {
        assert_eq!(
            desktop_auth_failure_kind_for_status(reqwest::StatusCode::UNAUTHORIZED),
            DesktopAuthSessionFailureKind::AuthRejected
        );
        assert_eq!(
            desktop_auth_failure_kind_for_status(reqwest::StatusCode::FORBIDDEN),
            DesktopAuthSessionFailureKind::AuthRejected
        );
        assert_eq!(
            desktop_auth_failure_kind_for_status(reqwest::StatusCode::BAD_REQUEST),
            DesktopAuthSessionFailureKind::Transport
        );
        assert_eq!(
            desktop_auth_failure_kind_for_status(reqwest::StatusCode::TOO_MANY_REQUESTS),
            DesktopAuthSessionFailureKind::Transport
        );
        assert_eq!(
            desktop_auth_failure_kind_for_status(reqwest::StatusCode::BAD_GATEWAY),
            DesktopAuthSessionFailureKind::Transport
        );
        assert_eq!(
            desktop_auth_classify_error_message("Desktop session expired."),
            DesktopAuthSessionFailureKind::AuthRejected
        );
        assert_eq!(
            desktop_auth_classify_error_message("Unable to validate desktop session: timed out"),
            DesktopAuthSessionFailureKind::Transport
        );
    }

    #[test]
    fn rejected_signed_out_snapshot_blocks_automatic_restart() {
        let rejected = desktop_auth_signed_out_snapshot(
            "Your desktop session expired. Sign in again with the web app.",
            DESKTOP_AUTH_SESSION_EXPIRED_MESSAGE,
            true,
        );
        let manual = desktop_auth_signed_out_snapshot(DESKTOP_AUTH_DEFAULT_MESSAGE, "", true);

        assert!(desktop_auth_snapshot_has_rejected_session(&rejected));
        assert!(!desktop_auth_snapshot_has_rejected_session(&manual));
    }

    #[test]
    fn provisioning_token_consumed_marker_matches_only_same_token_hash() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock is after unix epoch")
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!(
            "diffforge-provision-token-marker-test-{}-{nanos}",
            std::process::id()
        ));
        let marker_path = temp_dir.join(DESKTOP_AUTH_PROVISION_TOKEN_CONSUMED_MARKER);
        let token_hash = desktop_auth_provisioning_token_hash("inline-token-A_123");
        let different_token_hash = desktop_auth_provisioning_token_hash("inline-token-B_456");

        assert_ne!(token_hash, different_token_hash);
        assert!(!desktop_auth_provisioning_token_consumed_marker_matches_path(
            &marker_path,
            &token_hash
        ));

        desktop_auth_write_provisioning_token_consumed_marker_hash_to_path(
            &marker_path,
            &token_hash,
        )
        .expect("write consumed token marker");

        assert_eq!(
            std::fs::read_to_string(&marker_path).expect("read consumed token marker"),
            token_hash
        );
        assert!(desktop_auth_provisioning_token_consumed_marker_matches_path(
            &marker_path,
            &token_hash
        ));
        assert!(!desktop_auth_provisioning_token_consumed_marker_matches_path(
            &marker_path,
            &different_token_hash
        ));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&marker_path)
                .expect("marker metadata")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn desktop_auth_renewal_backoff_is_capped() {
        assert_eq!(
            desktop_auth_next_renew_backoff_secs(DESKTOP_AUTH_RENEWAL_MIN_BACKOFF_SECS),
            DESKTOP_AUTH_RENEWAL_MIN_BACKOFF_SECS * 2
        );
        assert_eq!(
            desktop_auth_next_renew_backoff_secs(DESKTOP_AUTH_RENEWAL_MAX_BACKOFF_SECS),
            DESKTOP_AUTH_RENEWAL_MAX_BACKOFF_SECS
        );
        let interval = desktop_auth_renewal_interval_secs(0);
        assert!(interval >= DESKTOP_AUTH_RENEWAL_INTERVAL_SECS - DESKTOP_AUTH_RENEWAL_JITTER_SECS);
        assert!(interval <= DESKTOP_AUTH_RENEWAL_INTERVAL_SECS + DESKTOP_AUTH_RENEWAL_JITTER_SECS);
    }

    #[test]
    fn snapshot_normalization_slims_billing_status_history_duplicates() {
        let ledger_items = (0..150)
            .map(|index| {
                json!({
                    "id": format!("row-{index}"),
                    "entity_type": "workspace",
                    "entityType": "workspace",
                    "entity_id": format!("entity-{index}"),
                    "entityId": format!("entity-{index}"),
                    "workspace_id": "workspace-1",
                    "workspaceId": "workspace-1",
                    "created_at_ms": index,
                    "createdAtMs": index,
                    "credits": 1,
                })
            })
            .collect::<Vec<_>>();

        let snapshot = desktop_auth_snapshot_from_raw(json!({
            "status": "authenticated",
            "stage": "authenticated",
            "message": "ok",
            "token": "a".repeat(MIN_AUTH_VALUE_LENGTH),
            "user": {
                "id": "user-1",
                "email": "user@example.com",
                "credits": {
                    "usage_history": ledger_items.clone(),
                    "usageHistory": ledger_items.clone(),
                },
            },
            "billingStatus": {
                "plan_name": "plus",
                "planName": "plus",
                "plan_status": "paid",
                "planStatus": "paid",
                "credit_ledger": {
                    "items": ledger_items.clone(),
                    "history": ledger_items.clone(),
                    "total_credits": 150,
                    "totalCredits": 150,
                },
                "creditLedger": {
                    "items": ledger_items.clone(),
                    "history": ledger_items.clone(),
                    "total_credits": 150,
                    "totalCredits": 150,
                },
                "billing_history": ledger_items.clone(),
                "billingHistory": ledger_items.clone(),
                "credits": {
                    "plan_name": "plus",
                    "planName": "plus",
                    "term_remaining_credits": 42,
                    "termRemainingCredits": 42,
                    "usage_history": ledger_items.clone(),
                    "usageHistory": ledger_items.clone(),
                },
                "user": {
                    "credits": {
                        "usage_history": ledger_items.clone(),
                        "usageHistory": ledger_items,
                    },
                },
            },
        }));

        let billing_status = &snapshot["billingStatus"];
        assert!(billing_status.get("plan_name").is_none());
        assert_eq!(billing_status["planName"].as_str(), Some("plus"));
        assert!(billing_status.get("credit_ledger").is_none());
        assert!(billing_status.get("billing_history").is_none());
        assert!(billing_status.get("billingHistory").is_none());
        assert!(billing_status["credits"].get("usage_history").is_none());
        assert!(billing_status["credits"].get("usageHistory").is_none());
        assert!(billing_status["user"]["credits"].get("usageHistory").is_none());

        let items = billing_status["creditLedger"]["items"]
            .as_array()
            .expect("slimmed ledger items");
        assert_eq!(items.len(), DESKTOP_AUTH_BILLING_HISTORY_LIMIT);
        assert_eq!(items[0]["createdAtMs"].as_i64(), Some(149));
        assert_eq!(items[99]["createdAtMs"].as_i64(), Some(50));
        assert!(billing_status["creditLedger"].get("history").is_none());
        assert!(items[0].get("entity_type").is_none());
        assert_eq!(items[0]["entityType"].as_str(), Some("workspace"));

        let user_history = snapshot["user"]["credits"]["usageHistory"]
            .as_array()
            .expect("top-level user credit history");
        assert_eq!(user_history.len(), DESKTOP_AUTH_BILLING_HISTORY_LIMIT);
        assert_eq!(user_history[0]["createdAtMs"].as_i64(), Some(149));
        assert!(snapshot["user"]["credits"].get("usage_history").is_none());
    }

    #[test]
    fn team_scope_normalization_is_disabled_for_now() {
        let user = json!({
            "id": "user-1",
            "accountScopes": [
                {
                    "type": "team",
                    "teamId": "known-team",
                    "label": "Known Team"
                }
            ]
        });

        let known = desktop_auth_normalize_scope(
            &json!({ "type": "team", "teamId": "known-team" }),
            Some(&user),
        );
        assert_eq!(known.get("id").and_then(Value::as_str), Some("personal"));
        assert!(known.get("teamId").is_some_and(Value::is_null));

        let unknown = desktop_auth_normalize_scope(
            &json!({ "type": "team", "teamId": "unknown-team", "label": "Fabricated" }),
            Some(&user),
        );
        assert_eq!(unknown.get("id").and_then(Value::as_str), Some("personal"));
        assert!(unknown.get("teamId").is_some_and(Value::is_null));
    }

    #[test]
    fn billing_status_merge_prefers_runtime_credit_totals_over_stale_aliases() {
        let merged = desktop_auth_merge_billing_status(
            &json!({
                "credits": {
                    "planName": "plus",
                    "termUsedCredits": 1363,
                    "termRemainingCredits": 0,
                    "termTotalCredits": 10000
                }
            }),
            json!({
                "planName": "plus",
                "credits": {
                    "planName": "plus",
                    "termUsedCredits": 1363,
                    "termRemainingCredits": 0,
                    "termTotalCredits": 10000,
                    "total": {
                        "total_credits": 10000,
                        "used_credits": 9820,
                        "remaining_credits": 180,
                        "reserved_credits": 0
                    }
                },
                "user": {
                    "credits": {
                        "planName": "plus",
                        "total": {
                            "total_credits": 10000,
                            "used_credits": 9820,
                            "remaining_credits": 180,
                            "reserved_credits": 0
                        }
                    }
                }
            }),
        );

        assert_eq!(merged["credits"]["termUsedCredits"].as_i64(), Some(9820));
        assert_eq!(merged["credits"]["termRemainingCredits"].as_i64(), Some(180));
        assert_eq!(merged["credits"]["termReservedCredits"].as_i64(), Some(0));
        assert_eq!(
            merged["user"]["credits"]["termUsedCredits"].as_i64(),
            Some(9820)
        );
    }

    #[test]
    fn billing_status_merge_derives_remaining_from_local_metered_same_term_usage() {
        let merged = desktop_auth_merge_billing_status(
            &json!({
                "credits": {
                    "planName": "plus",
                    "termId": "term-current",
                    "termUsedCredits": 1363,
                    "termRemainingCredits": 0,
                    "termReservedCredits": 0,
                    "termTotalCredits": 10000
                }
            }),
            json!({
                "credits": {
                    "planName": "plus",
                    "termId": "term-current",
                    "termUsedCredits": 1363,
                    "termRemainingCredits": 0,
                    "termReservedCredits": 0,
                    "termTotalCredits": 10000,
                    "localMeteredUsedCredits": 9840
                }
            }),
        );

        assert_eq!(merged["credits"]["termUsedCredits"].as_i64(), Some(9840));
        assert_eq!(merged["credits"]["termRemainingCredits"].as_i64(), Some(160));
    }

    #[test]
    fn billing_status_merge_does_not_carry_usage_across_credit_term_reset() {
        let merged = desktop_auth_merge_billing_status(
            &json!({
                "credits": {
                    "termId": "term-previous",
                    "termUsedCredits": 9840,
                    "termRemainingCredits": 160,
                    "termReservedCredits": 0,
                    "termTotalCredits": 10000
                }
            }),
            json!({
                "credits": {
                    "term": {
                        "id": "term-next",
                        "total_credits": 10000,
                        "used_credits": 20,
                        "remaining_credits": 9980,
                        "reserved_credits": 0
                    }
                }
            }),
        );

        assert_eq!(merged["credits"]["termUsedCredits"].as_i64(), Some(20));
        assert_eq!(merged["credits"]["termRemainingCredits"].as_i64(), Some(9980));
        assert_eq!(merged["credits"]["termId"].as_str(), Some("term-next"));
    }

    #[test]
    fn billing_status_partial_remaining_is_idempotent_across_nested_containers() {
        let previous = json!({
            "credits": {
                "termId": "term-current",
                "termTotalCredits": 10000,
                "termUsedCredits": 1000,
                "termRemainingCredits": 9000,
                "termReservedCredits": 0,
                "total": {
                    "totalCredits": 10000,
                    "usedCredits": 1000,
                    "remainingCredits": 9000,
                    "reservedCredits": 0
                },
                "term": {
                    "id": "term-current",
                    "totalCredits": 10000,
                    "usedCredits": 1000,
                    "remainingCredits": 9000,
                    "reservedCredits": 0
                }
            }
        });
        let merged = desktop_auth_merge_billing_status(
            &previous,
            json!({
                "credits": {
                    "termId": "term-current",
                    "termRemainingCredits": 8000
                }
            }),
        );

        for path in [
            &["credits", "termRemainingCredits"][..],
            &["credits", "total", "remainingCredits"][..],
            &["credits", "term", "remainingCredits"][..],
        ] {
            assert_eq!(desktop_auth_i64(&merged, path), Some(8000));
        }

        let normalized_again = desktop_auth_merge_billing_status(
            &Value::Null,
            json!({ "credits": merged["credits"].clone() }),
        );
        for path in [
            &["credits", "termRemainingCredits"][..],
            &["credits", "total", "remainingCredits"][..],
            &["credits", "term", "remainingCredits"][..],
        ] {
            assert_eq!(desktop_auth_i64(&normalized_again, path), Some(8000));
        }
    }

    #[test]
    fn billing_status_top_level_term_rollover_replaces_stale_nested_term() {
        let previous = json!({
            "credits": {
                "termId": "term-a",
                "termTotalCredits": 10000,
                "termUsedCredits": 9000,
                "termRemainingCredits": 1000,
                "termReservedCredits": 0,
                "term": {
                    "id": "term-a",
                    "totalCredits": 10000,
                    "usedCredits": 9000,
                    "remainingCredits": 1000,
                    "reservedCredits": 0
                }
            }
        });
        let rolled = desktop_auth_merge_billing_status(
            &previous,
            json!({
                "credits": {
                    "known": true,
                    "termId": "term-b",
                    "termTotalCredits": 10000,
                    "termUsedCredits": 20,
                    "termRemainingCredits": 9980,
                    "termReservedCredits": 0,
                    "term": {
                        "id": "term-a",
                        "totalCredits": 10000,
                        "usedCredits": 9000,
                        "remainingCredits": 1000,
                        "reservedCredits": 0
                    }
                }
            }),
        );

        assert_eq!(rolled["credits"]["termId"].as_str(), Some("term-b"));
        assert_eq!(rolled["credits"]["term"]["id"].as_str(), Some("term-b"));
        assert_eq!(rolled["credits"]["termUsedCredits"].as_i64(), Some(20));
        assert_eq!(rolled["credits"]["termRemainingCredits"].as_i64(), Some(9980));

        let after_partial = desktop_auth_merge_billing_status(
            &rolled,
            json!({
                "credits": {
                    "termUsedCredits": 100,
                    "termRemainingCredits": 9900
                }
            }),
        );
        assert_eq!(after_partial["credits"]["termId"].as_str(), Some("term-b"));
        assert_eq!(after_partial["credits"]["term"]["id"].as_str(), Some("term-b"));
        assert_eq!(after_partial["credits"]["termUsedCredits"].as_i64(), Some(100));
        assert_eq!(after_partial["credits"]["termRemainingCredits"].as_i64(), Some(9900));
    }

    #[test]
    fn billing_status_authoritative_zero_remaining_is_preserved() {
        let merged = desktop_auth_merge_billing_status(
            &json!({
                "credits": {
                    "termId": "term-current",
                    "termTotalCredits": 10000,
                    "termUsedCredits": 9900,
                    "termRemainingCredits": 100,
                    "termReservedCredits": 0
                }
            }),
            json!({
                "credits": {
                    "known": true,
                    "termId": "term-current",
                    "termRemainingCredits": 0
                }
            }),
        );

        assert_eq!(merged["credits"]["termRemainingCredits"].as_i64(), Some(0));
        assert_eq!(merged["credits"]["total"]["remainingCredits"].as_i64(), Some(0));
        assert_eq!(merged["credits"]["term"]["remainingCredits"].as_i64(), Some(0));
    }

    #[test]
    fn billing_rebase_preserves_latest_nonbilling_snapshot_fields() {
        let current = json!({
            "status": "authenticated",
            "token": "token-new",
            "user": {
                "id": "account-current",
                "displayName": "Latest user"
            },
            "entitlements": {
                "isPaid": true,
                "deviceLimit": 25
            },
            "version": 17,
            "billingStatus": {
                "credits": {
                    "termId": "term-current",
                    "termRemainingCredits": 9000
                }
            }
        });
        let rebased = desktop_auth_rebase_billing_status(
            &current,
            json!({
                "credits": {
                    "termId": "term-current",
                    "termRemainingCredits": 8000
                }
            }),
        );

        for key in ["status", "token", "user", "entitlements", "version"] {
            assert_eq!(rebased.get(key), current.get(key), "changed nonbilling field {key}");
        }
        assert_eq!(
            rebased["billingStatus"]["credits"]["termRemainingCredits"].as_i64(),
            Some(8000)
        );
    }

    #[test]
    fn billing_status_merge_preserves_paid_usage_from_unknown_zero_credit_snapshot() {
        let merged = desktop_auth_merge_billing_status(
            &json!({
                "credits": {
                    "planName": "plus",
                    "termId": "term-current",
                    "termUsedCredits": 9700,
                    "termRemainingCredits": 300,
                    "termReservedCredits": 0,
                    "termTotalCredits": 10000
                }
            }),
            json!({
                "credits": {
                    "known": false,
                    "termUsedCredits": 0,
                    "termRemainingCredits": 0,
                    "termReservedCredits": 0,
                    "termTotalCredits": 0
                }
            }),
        );

        assert_eq!(merged["credits"]["planName"].as_str(), Some("plus"));
        assert_eq!(merged["credits"]["termTotalCredits"].as_i64(), Some(10000));
        assert_eq!(merged["credits"]["termUsedCredits"].as_i64(), Some(9700));
        assert_eq!(merged["credits"]["termRemainingCredits"].as_i64(), Some(300));
    }
}

#[tauri::command]
async fn agent_statuses() -> Result<Vec<AgentStatus>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let npm_version_handle = thread::spawn(|| {
            let version = npm_version();
            version
        });
        let codex_package_version =
            spawn_npm_package_version_check(agent_definition(AgentProvider::Codex));
        let claude_package_version =
            spawn_npm_package_version_check(agent_definition(AgentProvider::Claude));
        let opencode_package_version =
            spawn_npm_package_version_check(agent_definition(AgentProvider::OpenCode));
        let codex_latest_version =
            spawn_npm_latest_package_version_check(agent_definition(AgentProvider::Codex));
        let claude_latest_version =
            spawn_npm_latest_package_version_check(agent_definition(AgentProvider::Claude));
        let opencode_latest_version =
            spawn_npm_latest_package_version_check(agent_definition(AgentProvider::OpenCode));
        let codex_runtime = thread::spawn(|| agent_runtime_status_for(AgentProvider::Codex));
        let claude_runtime = thread::spawn(|| agent_runtime_status_for(AgentProvider::Claude));
        let opencode_runtime = thread::spawn(|| agent_runtime_status_for(AgentProvider::OpenCode));

        let codex_runtime = codex_runtime
            .join()
            .map_err(|_| "Codex status check failed.".to_string())?;
        let claude_runtime = claude_runtime
            .join()
            .map_err(|_| "Claude Code status check failed.".to_string())?;
        let opencode_runtime = opencode_runtime
            .join()
            .map_err(|_| "OpenCode status check failed.".to_string())?;
        let npm_version = npm_version_handle.join().ok().flatten();
        let npm_available = npm_version.is_some();
        let npm_version = npm_version.unwrap_or_else(|| "Not detected".to_string());
        let (
            codex_npm_installed,
            codex_npm_package_version,
            codex_npm_latest_version,
            codex_npm_update_available,
        ) = resolve_npm_package_version(codex_package_version, codex_latest_version);
        let (
            claude_npm_installed,
            claude_npm_package_version,
            claude_npm_latest_version,
            claude_npm_update_available,
        ) = resolve_npm_package_version(claude_package_version, claude_latest_version);
        let (
            opencode_npm_installed,
            opencode_npm_package_version,
            opencode_npm_latest_version,
            opencode_npm_update_available,
        ) = resolve_npm_package_version(opencode_package_version, opencode_latest_version);

        let codex_status = build_agent_status(
            AgentProvider::Codex,
            codex_runtime,
            npm_available,
            &npm_version,
            codex_npm_installed,
            codex_npm_package_version,
            codex_npm_latest_version,
            codex_npm_update_available,
        );
        let claude_status = build_agent_status(
            AgentProvider::Claude,
            claude_runtime,
            npm_available,
            &npm_version,
            claude_npm_installed,
            claude_npm_package_version,
            claude_npm_latest_version,
            claude_npm_update_available,
        );
        let opencode_status = build_agent_status(
            AgentProvider::OpenCode,
            opencode_runtime,
            npm_available,
            &npm_version,
            opencode_npm_installed,
            opencode_npm_package_version,
            opencode_npm_latest_version,
            opencode_npm_update_available,
        );
        let statuses = vec![codex_status, claude_status, opencode_status];
        Ok(statuses)
    })
    .await
    .map_err(|error| format!("Unable to check terminal CLIs: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn start_agent_login(provider: String) -> Result<AgentLoginStart, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;
        let definition = agent_definition(provider);

        launch_login_terminal(provider)?;

        Ok(AgentLoginStart {
            provider: definition.id,
            command: definition.connect_command,
            message: format!("Opened {} login in a terminal.", definition.label),
        })
    })
    .await
    .map_err(|error| format!("Unable to start terminal CLI login: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn start_agent_account_login(provider: String) -> Result<AgentLoginStart, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;
        let definition = agent_definition(provider);

        launch_account_login_terminal(provider)?;

        Ok(AgentLoginStart {
            provider: definition.id,
            command: definition.connect_command,
            message: format!("Opened {} login in a terminal.", definition.label),
        })
    })
    .await
    .map_err(|error| format!("Unable to start terminal CLI login: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn disconnect_agent(provider: String) -> Result<AgentLogoutResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;

        logout_agent_credentials(provider)
    })
    .await
    .map_err(|error| format!("Unable to disconnect terminal CLI: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn install_agent(provider: String) -> Result<AgentInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;
        let result = install_agent_with_npm(provider);

        if result.installed {
            clear_agent_command_candidate_cache(provider);
        }

        Ok(result)
    })
    .await
    .map_err(|error| format!("Unable to install terminal CLI: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn update_agent(provider: String) -> Result<AgentInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;
        let result = update_agent_with_npm(provider);

        if result.installed {
            clear_agent_command_candidate_cache(provider);
        }

        Ok(result)
    })
    .await
    .map_err(|error| format!("Unable to update terminal CLI: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn uninstall_agent(provider: String) -> Result<AgentInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;
        let result = uninstall_agent_with_npm(provider);

        if !result.installed {
            clear_agent_command_candidate_cache(provider);
        }

        Ok(result)
    })
    .await
    .map_err(|error| format!("Unable to uninstall terminal CLI: {error}"))?
}

fn tools_binary_on_path(binary: &str) -> Option<String> {
    let binary = binary.trim();
    if binary.is_empty() || binary.contains(['/', '\\']) {
        return None;
    }
    let path_value = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_value) {
        let candidate = dir.join(binary);
        #[cfg(windows)]
        {
            if candidate.is_file() {
                return Some(candidate.display().to_string());
            }
            for extension in ["exe", "cmd", "bat", "ps1"] {
                let candidate = candidate.with_extension(extension);
                if candidate.is_file() {
                    return Some(candidate.display().to_string());
                }
            }
        }
        #[cfg(not(windows))]
        {
            use std::os::unix::fs::PermissionsExt;
            if candidate.is_file()
                && fs::metadata(&candidate)
                    .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
                    .unwrap_or(false)
            {
                return Some(candidate.display().to_string());
            }
        }
    }
    // GUI apps often miss package-manager locations from the login shell
    // PATH; probe the common ones per platform.
    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let mut fallback_dirs: Vec<String> = Vec::new();
        #[cfg(target_os = "macos")]
        fallback_dirs.extend(["/opt/homebrew/bin".to_string(), "/usr/local/bin".to_string()]);
        #[cfg(target_os = "linux")]
        fallback_dirs.extend([
            "/usr/local/bin".to_string(),
            "/home/linuxbrew/.linuxbrew/bin".to_string(),
            format!("{home}/.linuxbrew/bin"),
            format!("{home}/.local/bin"),
        ]);
        fallback_dirs.push(format!("{home}/.cargo/bin"));
        for prefix in fallback_dirs {
            if prefix.trim().is_empty() {
                continue;
            }
            let candidate = Path::new(&prefix).join(binary);
            if candidate.is_file() {
                return Some(candidate.display().to_string());
            }
        }
    }
    None
}

#[tauri::command(rename_all = "snake_case")]
async fn tools_check_cli_binaries(binaries: Vec<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut results = serde_json::Map::new();
        for binary in binaries.iter().take(200) {
            let path = tools_binary_on_path(binary);
            results.insert(
                binary.clone(),
                json!({
                    "installed": path.is_some(),
                    "path": path,
                }),
            );
        }
        Ok(Value::Object(results))
    })
    .await
    .map_err(|error| format!("CLI check worker failed: {error}"))?
}

const TOOLS_CLI_ACTION_TIMEOUT_SECS: u64 = 15 * 60;

#[tauri::command(rename_all = "snake_case")]
async fn tools_run_cli_action(
    manager: String,
    package: String,
    action: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = manager.trim().to_ascii_lowercase();
        let action = action.trim().to_ascii_lowercase();
        let package = package.trim().to_string();
        if package.is_empty()
            || package.len() > 120
            || !package
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'/' | b'@'))
        {
            return Err("CLI package name is invalid.".to_string());
        }
        if !matches!(action.as_str(), "install" | "uninstall") {
            return Err("CLI action must be install or uninstall.".to_string());
        }
        let (program, args): (String, Vec<String>) = match manager.as_str() {
            "brew" => {
                #[cfg(windows)]
                return Err("Homebrew is not available on Windows; use winget or npm.".to_string());
                #[cfg(not(windows))]
                {
                    let brew = tools_binary_on_path("brew")
                        .ok_or_else(|| "Homebrew is not installed on this device.".to_string())?;
                    (brew, vec![action.clone(), package.clone()])
                }
            }
            "winget" => {
                #[cfg(not(windows))]
                return Err("winget is only available on Windows.".to_string());
                #[cfg(windows)]
                {
                    let winget = tools_binary_on_path("winget")
                        .ok_or_else(|| "winget is not installed on this device.".to_string())?;
                    let mut winget_args = vec![
                        action.clone(),
                        "--id".to_string(),
                        package.clone(),
                        "--exact".to_string(),
                    ];
                    if action == "install" {
                        winget_args.push("--accept-source-agreements".to_string());
                        winget_args.push("--accept-package-agreements".to_string());
                        winget_args.push("--silent".to_string());
                    }
                    (winget, winget_args)
                }
            }
            "npm" => (
                npm_binary().to_string(),
                vec![action.clone(), "-g".to_string(), package.clone()],
            ),
            _ => return Err("CLI manager must be brew, winget, or npm.".to_string()),
        };
        let args_ref = args.iter().map(String::as_str).collect::<Vec<_>>();
        let capture = run_command_capture(
            &program,
            &args_ref,
            None,
            Duration::from_secs(TOOLS_CLI_ACTION_TIMEOUT_SECS),
            None,
        )
        .map_err(|error| format!("Unable to run {manager} {action}: {error}"))?;
        let ok = capture.exit_code == Some(0);
        Ok(json!({
            "ok": ok,
            "manager": manager,
            "package": package,
            "action": action,
            "exit_code": capture.exit_code,
            "message": if ok {
                format!("{package} {action} completed.")
            } else {
                let stderr = capture.stderr.trim();
                if stderr.is_empty() {
                    format!("{manager} {action} failed for {package}.")
                } else {
                    format!("{manager} {action} failed: {}", stderr.chars().take(400).collect::<String>())
                }
            },
        }))
    })
    .await
    .map_err(|error| format!("CLI action worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn forge_working_directory() -> Result<ForgeWorkingDirectory, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let working_directory = default_working_directory()?;

        Ok(workspace_root_basic_response(&working_directory))
    })
    .await
    .map_err(|error| format!("Unable to read Forge working directory: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn validate_workspace_root_directory(path: String) -> Result<ForgeWorkingDirectory, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let working_directory = match resolve_workspace_root_directory(Some(&path)) {
            Ok(working_directory) => working_directory,
            Err(error) => {
                return Err(error);
            }
        };
        Ok(workspace_root_basic_response(&working_directory))
    })
    .await
    .map_err(|error| format!("Unable to validate workspace root directory: {error}"))?
}

fn workspace_browse_is_windows_absolute(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

fn expand_workspace_browse_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed == "~" || trimmed.starts_with("~/") {
        let home =
            user_home_dir().ok_or_else(|| "Unable to resolve the home directory.".to_string())?;
        if trimmed == "~" {
            Ok(home)
        } else {
            Ok(home.join(trimmed.trim_start_matches("~/")))
        }
    } else if trimmed.is_empty() {
        default_working_directory()
    } else {
        Ok(PathBuf::from(trimmed))
    }
}

fn resolve_workspace_browse_target(
    path: Option<String>,
    command: Option<String>,
    base_path: Option<String>,
) -> Result<PathBuf, String> {
    if let Some(raw_command) = command {
        let trimmed = raw_command.trim();
        if trimmed.is_empty() {
            return Err("Enter a cd command.".to_string());
        }

        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let verb = parts.next().unwrap_or_default();
        if !verb.eq_ignore_ascii_case("cd") {
            return Err("Only cd commands can change the project root.".to_string());
        }

        let destination = parts.next().unwrap_or_default().trim();
        let destination = if destination.is_empty() {
            "~"
        } else {
            destination
        };
        if destination == "~"
            || destination.starts_with("~/")
            || PathBuf::from(destination).is_absolute()
            || workspace_browse_is_windows_absolute(destination)
        {
            return expand_workspace_browse_path(destination);
        }

        let base = expand_workspace_browse_path(base_path.as_deref().unwrap_or_default())?;
        return Ok(base.join(destination));
    }

    expand_workspace_browse_path(path.as_deref().unwrap_or_default())
}

/// Directory navigation for the inline create-workspace panel: unlike
/// `validate_workspace_root_directory`, browsing may pass through directories
/// (home, system folders) that are not eligible workspace roots — eligibility
/// is reported separately so the UI can disable Create instead of blocking
/// navigation. The optional command path is intentionally cd-only; shell muscle
/// memory such as ls/dir should never be interpreted as a folder path.
#[tauri::command(rename_all = "snake_case")]
async fn browse_workspace_root_directory(
    base_path: Option<String>,
    command: Option<String>,
    path: Option<String>,
) -> Result<WorkspaceRootBrowse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let expanded = resolve_workspace_browse_target(path, command, base_path)?;
        if expanded
            .to_string_lossy()
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == b'\x7f')
        {
            return Err("Directory path is invalid.".to_string());
        }
        let canonical = expanded
            .canonicalize()
            .map_err(|error| format!("Unable to open that directory: {error}"))?;
        let metadata = fs::metadata(&canonical)
            .map_err(|error| format!("Unable to inspect that directory: {error}"))?;
        if !metadata.is_dir() {
            return Err("That path is not a directory.".to_string());
        }

        let mut directories = Vec::new();
        let mut truncated = false;
        let mut entry_count = 0usize;
        if let Ok(read_dir) = fs::read_dir(&canonical) {
            for entry in read_dir.flatten() {
                entry_count += 1;
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let is_directory = entry
                    .file_type()
                    .map(|file_type| file_type.is_dir())
                    .unwrap_or(false);
                if !is_directory {
                    continue;
                }
                if directories.len() >= 200 {
                    truncated = true;
                    break;
                }
                directories.push(name);
            }
        }
        directories.sort_by_key(|name| name.to_lowercase());

        let rejection_reason = workspace_root_rejection_reason(&canonical);
        Ok(WorkspaceRootBrowse {
            working_directory: workspace_path_display(&canonical),
            root_identity: normalized_path_key(&canonical),
            parent_directory: canonical
                .parent()
                .map(|parent| workspace_path_display(parent)),
            directories,
            truncated,
            empty_directory: entry_count == 0,
            git_repository: workspace_is_exact_git_root(&canonical),
            root_eligible: rejection_reason.is_none(),
            root_rejection_reason: rejection_reason.map(str::to_string),
        })
    })
    .await
    .map_err(|error| format!("Unable to browse workspace directory: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn list_workspace_directory(
    root: String,
    relative_path: String,
) -> Result<WorkspaceDirectoryListing, String> {
    tauri::async_runtime::spawn_blocking(move || list_workspace_directory_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to list workspace directory: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn read_workspace_file(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileText, String> {
    tauri::async_runtime::spawn_blocking(move || read_workspace_file_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to read workspace file: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn read_workspace_file_image(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileImage, String> {
    tauri::async_runtime::spawn_blocking(move || read_workspace_file_image_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to read workspace image: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn read_workspace_file_diff(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || read_workspace_file_diff_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to read workspace file diff: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn rename_workspace_entry(
    root: String,
    relative_path: String,
    new_name: String,
) -> Result<WorkspaceFileOperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rename_workspace_entry_for(root, relative_path, new_name)
    })
    .await
    .map_err(|error| format!("Unable to rename workspace item: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn delete_workspace_entry(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileOperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_workspace_entry_for(root, relative_path)
    })
    .await
    .map_err(|error| format!("Unable to delete workspace item: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn move_workspace_entry(
    root: String,
    relative_path: String,
    target_directory: String,
) -> Result<WorkspaceFileOperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        move_workspace_entry_for(root, relative_path, target_directory)
    })
    .await
    .map_err(|error| format!("Unable to move workspace item: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn run_forge_prompt(request: ForgePromptRequest) -> Result<ForgeRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_forge_prompt_for(request))
        .await
        .map_err(|error| format!("Unable to run Forge Console prompt: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn agent_thread_turn_start(
    request: AgentThreadTurnRequest,
) -> Result<AgentThreadTurnResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_agent_thread_turn_for(request))
        .await
        .map_err(|error| format!("Unable to send agent turn: {error}"))?
}

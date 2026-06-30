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

#[tauri::command]
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
const DESKTOP_AUTH_STATE_CHANGED_EVENT: &str = "desktop-auth-state-changed";
const DESKTOP_AUTH_DEFAULT_MESSAGE: &str = "Sign in with your Diff Forge AI web account.";

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
        &[&["term", "id"][..], &["termId"][..], &["term_id"][..]],
    );
    let previous_term_id = desktop_auth_first_text(
        previous,
        &[&["term", "id"][..], &["termId"][..], &["term_id"][..]],
    );
    if let (Some(incoming_term_id), Some(previous_term_id)) = (incoming_term_id, previous_term_id) {
        return incoming_term_id == previous_term_id;
    }
    let incoming_term_end = desktop_auth_first_text(
        incoming,
        &[
            &["term", "termEnd"][..],
            &["term", "term_end"][..],
            &["termEnd"][..],
            &["term_end"][..],
            &["resetAt"][..],
            &["reset_at"][..],
        ],
    );
    let previous_term_end = desktop_auth_first_text(
        previous,
        &[
            &["term", "termEnd"][..],
            &["term", "term_end"][..],
            &["termEnd"][..],
            &["term_end"][..],
            &["resetAt"][..],
            &["reset_at"][..],
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

    let same_term = desktop_auth_credit_same_term(incoming_credits, previous_credits);
    let source = if same_term {
        &credits
    } else {
        incoming_credits.unwrap_or(&credits)
    };
    let empty = Value::Null;
    let previous_source = if same_term {
        previous_credits.unwrap_or(&empty)
    } else {
        &empty
    };

    let used = [
        desktop_auth_max_i64(
            source,
            &[
                &["total", "used_credits"][..],
                &["total", "usedCredits"][..],
                &["termUsedCredits"][..],
                &["term_used_credits"][..],
                &["usedCredits"][..],
                &["used_credits"][..],
                &["term", "used_credits"][..],
                &["term", "usedCredits"][..],
                &["localMeteredUsedCredits"][..],
                &["local_metered_used_credits"][..],
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
    let reserved = desktop_auth_first_i64(
        source,
        &[
            &["total", "reserved_credits"][..],
            &["total", "reservedCredits"][..],
            &["termReservedCredits"][..],
            &["term_reserved_credits"][..],
            &["reservedCredits"][..],
            &["reserved_credits"][..],
            &["term", "reserved_credits"][..],
            &["term", "reservedCredits"][..],
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
    let total = [
        desktop_auth_max_i64(
            source,
            &[
                &["total", "total_credits"][..],
                &["total", "totalCredits"][..],
                &["termTotalCredits"][..],
                &["term_total_credits"][..],
                &["totalCredits"][..],
                &["total_credits"][..],
                &["term", "total_credits"][..],
                &["term", "totalCredits"][..],
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
    let direct_remaining = desktop_auth_first_i64(
        source,
        &[
            &["total", "remaining_credits"][..],
            &["total", "remainingCredits"][..],
            &["termRemainingCredits"][..],
            &["term_remaining_credits"][..],
            &["remainingCredits"][..],
            &["remaining_credits"][..],
            &["term", "remaining_credits"][..],
            &["term", "remainingCredits"][..],
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
    let remaining = match (direct_remaining, computed_remaining) {
        (Some(direct), Some(_computed)) if direct > 0 => direct,
        (Some(_), Some(computed)) => computed,
        (Some(direct), None) => direct.max(0),
        (None, Some(computed)) => computed,
        (None, None) => 0,
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
    if let Some(term_id) = desktop_auth_first_text(
        source,
        &[&["term", "id"][..], &["termId"][..], &["term_id"][..]],
    )
    .or_else(|| {
        desktop_auth_first_text(
            previous_source,
            &[&["term", "id"][..], &["termId"][..], &["term_id"][..]],
        )
    }) {
        object.insert("termId".to_string(), json!(term_id.clone()));
        object.insert("term_id".to_string(), json!(term_id));
    }
    if let Some(term_end) = desktop_auth_first_text(
        source,
        &[
            &["term", "termEnd"][..],
            &["term", "term_end"][..],
            &["termEnd"][..],
            &["term_end"][..],
            &["resetAt"][..],
            &["reset_at"][..],
        ],
    )
    .or_else(|| {
        desktop_auth_first_text(
            previous_source,
            &[
                &["term", "termEnd"][..],
                &["term", "term_end"][..],
                &["termEnd"][..],
                &["term_end"][..],
                &["resetAt"][..],
                &["reset_at"][..],
            ],
        )
    }) {
        object.insert("termEnd".to_string(), json!(term_end.clone()));
        object.insert("term_end".to_string(), json!(term_end.clone()));
        object.insert("resetAt".to_string(), json!(term_end.clone()));
        object.insert("reset_at".to_string(), json!(term_end));
    }
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
    if !desktop_auth_billing_status_has_meaningful_data(&incoming) {
        return previous.clone();
    }
    let Some(incoming_object) = incoming.as_object() else {
        return previous.clone();
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
    Value::Object(merged)
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
    let user = raw.get("user").cloned().filter(Value::is_object);
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
    let billing_status = raw.get("billingStatus").cloned().unwrap_or(Value::Null);
    let mut snapshot = json!({
        "status": status,
        "stage": stage,
        "message": message,
        "error": error,
        "user": user.clone().unwrap_or(Value::Null),
        "token": token,
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

fn desktop_auth_snapshot(app: &AppHandle) -> Value {
    desktop_auth_snapshot_from_raw(app_local_state_read(app, DESKTOP_AUTH_STATE_KEY))
}

fn desktop_auth_exchange_lock() -> &'static Mutex<()> {
    static DESKTOP_AUTH_EXCHANGE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    DESKTOP_AUTH_EXCHANGE_LOCK.get_or_init(|| Mutex::new(()))
}

fn desktop_auth_public_snapshot(snapshot: &Value) -> Value {
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

fn desktop_auth_current_validation_snapshot(app: &AppHandle, token: &str) -> Option<Value> {
    let current = desktop_auth_snapshot(app);
    let current_token = desktop_auth_snapshot_token(&current)?;
    if current_token != token || !desktop_auth_snapshot_pending_state(&current).is_empty() {
        return None;
    }
    Some(current)
}

fn desktop_auth_persist_snapshot(app: &AppHandle, mut snapshot: Value) -> Result<Value, String> {
    let previous_version = desktop_auth_snapshot(app)
        .get("version")
        .and_then(Value::as_u64)
        .unwrap_or(0);
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
    cloud_mcp_apply_desktop_auth_session(
        app.clone(),
        cloud_mcp_state,
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
    match validate_desktop_session(token.to_string()).await {
        Ok(session) => {
            let Some(current) = desktop_auth_current_validation_snapshot(app, token) else {
                return false;
            };
            let user = match desktop_auth_extract_session_user(&session) {
                Ok(user) => user,
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
            let active_scope = desktop_auth_normalize_scope(
                current.get("activeScope").unwrap_or(&Value::Null),
                Some(&user),
            );
            let mut next = current.clone();
            next["status"] = json!("authenticated");
            next["stage"] = json!("authenticated");
            next["message"] = json!("Initializing workspace...");
            next["error"] = json!("");
            next["token"] = json!(token);
            next["user"] = user;
            next["activeScope"] = active_scope;
            next["pendingState"] = json!("");
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
            let message = if desktop_auth_network_restore_error(&error) {
                "Secure session could not be verified. Sign in again with the web app."
            } else {
                "Your desktop session expired. Sign in again with the web app."
            };
            if let Ok(next) = desktop_auth_persist_snapshot(
                app,
                desktop_auth_signed_out_snapshot(message, &error, true),
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
        "desktopCallbackScheme".to_string(),
        desktop_auth_callback_scheme().to_string(),
    ));
    let device_profile = cloud_mcp_desktop_device_profile();
	    for (key, path) in [
	        ("desktopDeviceId", &["device_id", "deviceId"][..]),
	        ("desktopDeviceName", &["device_name", "deviceName", "machine_name", "machineName"][..]),
	        ("desktopPlatform", &["platform", "os"][..]),
	        ("desktopFormFactor", &["form_factor", "formFactor", "device_type", "deviceType"][..]),
	        ("desktopAppVersion", &["app_version", "appVersion"][..]),
	        ("desktopArchitecture", &["architecture", "arch"][..]),
	        ("desktopBuildChannel", &["build_channel", "buildChannel"][..]),
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

fn desktop_auth_network_restore_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("unable to validate desktop session")
        || lower.contains("unable to read diff forge ai api response")
        || lower.contains("returned 500")
        || lower.contains("returned 501")
        || lower.contains("returned 502")
        || lower.contains("returned 503")
        || lower.contains("returned 504")
        || lower.contains("unable to prepare backend request")
        || lower.contains("timed out")
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

#[tauri::command]
async fn desktop_auth_snapshot_command(app: AppHandle) -> Result<Value, String> {
    Ok(desktop_auth_public_snapshot(&desktop_auth_snapshot(&app)))
}

#[tauri::command]
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
        "loginUrl": desktop_auth_login_url(&state),
        "snapshot": desktop_auth_public_snapshot(&snapshot),
    }))
}

#[tauri::command]
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

    match validate_desktop_session(token.clone()).await {
        Ok(session) => {
            let Some(current) = desktop_auth_current_validation_snapshot(&app, &token) else {
                return Ok(desktop_auth_public_snapshot(&desktop_auth_snapshot(&app)));
            };
            let user = desktop_auth_extract_session_user(&session)?;
            let active_scope = desktop_auth_normalize_scope(
                current.get("activeScope").unwrap_or(&Value::Null),
                Some(&user),
            );
            let mut next = current.clone();
            next["status"] = json!("authenticated");
            next["stage"] = json!("authenticated");
            next["message"] = json!("Initializing workspace...");
            next["error"] = json!("");
            next["token"] = json!(token);
            next["user"] = user;
            next["activeScope"] = active_scope;
            next["pendingState"] = json!("");
            let next = desktop_auth_persist_snapshot(&app, next)?;
            desktop_auth_sync_cloud_state_background(&app, cloud_mcp_state.inner(), &next);
            Ok(desktop_auth_public_snapshot(&next))
        }
        Err(error) => {
            if desktop_auth_current_validation_snapshot(&app, &token).is_none() {
                return Ok(desktop_auth_public_snapshot(&desktop_auth_snapshot(&app)));
            }
            let message = if desktop_auth_network_restore_error(&error) {
                "Secure session could not be verified. Sign in again with the web app."
            } else {
                "Your desktop session expired. Sign in again with the web app."
            };
            let next =
                desktop_auth_persist_snapshot(&app, desktop_auth_signed_out_snapshot(message, &error, true))?;
            desktop_auth_sync_cloud_state_background(&app, cloud_mcp_state.inner(), &next);
            Ok(desktop_auth_public_snapshot(&next))
        }
    }
}

#[tauri::command]
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
            let user = desktop_auth_extract_session_user(&session)?;
            let active_scope = desktop_auth_normalize_scope(
                current.get("activeScope").unwrap_or(&Value::Null),
                Some(&user),
            );
            let next = desktop_auth_persist_snapshot(
                &app,
                json!({
                    "status": "authenticated",
                    "stage": "authenticated",
                    "message": "Initializing workspace...",
                    "error": "",
                    "token": token,
                    "user": user,
                    "activeScope": active_scope,
                    "pendingState": "",
                    "billingStatus": Value::Null,
                }),
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

#[tauri::command]
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

#[tauri::command]
async fn desktop_auth_apply_billing_status(
    app: AppHandle,
    cloud_mcp_state: State<'_, CloudMcpState>,
    billing_status: Value,
) -> Result<Value, String> {
    let mut snapshot = desktop_auth_snapshot(&app);
    let next_billing_status = desktop_auth_merge_billing_status(
        snapshot.get("billingStatus").unwrap_or(&Value::Null),
        billing_status,
    );
    if snapshot.get("billingStatus") == Some(&next_billing_status) {
        return Ok(desktop_auth_public_snapshot(&snapshot));
    }
    snapshot["billingStatus"] = next_billing_status;
    let snapshot = desktop_auth_persist_snapshot(&app, snapshot)?;
    desktop_auth_sync_cloud_state_background(&app, cloud_mcp_state.inner(), &snapshot);
    Ok(desktop_auth_public_snapshot(&snapshot))
}

#[tauri::command]
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

async fn validate_desktop_session(token: String) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;

    let client = http_client(Duration::from_secs(SESSION_VALIDATE_TIMEOUT_SECS))?;
    let response = client
        .get(api_endpoint("desktop/session"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Unable to validate desktop session: {error}"))?;

    read_api_response(response, "Desktop session expired.").await
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
        .json(&json!({ "deviceCode": device_code }))
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
    if cfg!(target_os = "windows") {
        if let Some(appdata) = env::var_os("APPDATA").map(PathBuf::from) {
            return Ok(appdata.join("ai.diffforge.desktop"));
        }
        if let Some(home) = desktop_auth_cli_home_dir() {
            return Ok(home
                .join("AppData")
                .join("Roaming")
                .join("ai.diffforge.desktop"));
        }
    } else if cfg!(target_os = "macos") {
        if let Some(home) = desktop_auth_cli_home_dir() {
            return Ok(home
                .join("Library")
                .join("Application Support")
                .join("ai.diffforge.desktop"));
        }
    } else {
        if let Some(data_home) = env::var_os("XDG_DATA_HOME").map(PathBuf::from) {
            return Ok(data_home.join("ai.diffforge.desktop"));
        }
        if let Some(home) = desktop_auth_cli_home_dir() {
            return Ok(home
                .join(".local")
                .join("share")
                .join("ai.diffforge.desktop"));
        }
    }

    Err("Unable to resolve Diff Forge app data directory.".to_string())
}

fn desktop_auth_cli_state_path() -> Result<PathBuf, String> {
    let state_dir = desktop_auth_cli_app_data_dir()?.join("app-state");
    fs::create_dir_all(&state_dir)
        .map_err(|error| format!("Unable to create auth state directory: {error}"))?;
    Ok(state_dir.join(format!("{DESKTOP_AUTH_STATE_KEY}.json")))
}

fn desktop_auth_cli_read_snapshot() -> Value {
    let Ok(path) = desktop_auth_cli_state_path() else {
        return desktop_auth_snapshot_from_raw(json!(null));
    };
    let raw = fs::read_to_string(path).ok();
    let value = raw
        .as_deref()
        .and_then(|body| serde_json::from_str::<Value>(body).ok())
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
        .get("deviceCode")
        .or_else(|| authorization.get("device_code"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let user_code = authorization
        .get("userCode")
        .or_else(|| authorization.get("user_code"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let verification_uri = authorization
        .get("verificationUri")
        .or_else(|| authorization.get("verification_uri"))
        .and_then(Value::as_str)
        .unwrap_or("https://diffforge.ai/device");
    let verification_uri_complete = authorization
        .get("verificationUriComplete")
        .or_else(|| authorization.get("verification_uri_complete"))
        .and_then(Value::as_str)
        .unwrap_or(verification_uri);
    let mut interval = authorization
        .get("interval")
        .and_then(Value::as_u64)
        .unwrap_or(5)
        .clamp(2, 30);
    let expires_in = authorization
        .get("expiresIn")
        .or_else(|| authorization.get("expires_in"))
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

fn desktop_auth_cli_help() {
    println!("Diff Forge authentication");
    println!();
    println!("Usage:");
    println!("  diffforge auth login [--force]");
    println!("  diffforge auth status");
    println!("  diffforge auth logout");
    println!("  diffforge auth help");
    println!();
    println!("`auth login` works in GUI and headless terminals. It prints a device code");
    println!("that can be approved from any signed-in browser at https://diffforge.ai/device.");
}

pub fn run_desktop_auth_cli(args: &[String]) -> i32 {
    let command = args.first().map(String::as_str).unwrap_or("help");
    match command {
        "login" => desktop_auth_cli_login(&args[1..]),
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
    fn public_snapshot_redacts_private_auth_values() {
        let token = "a".repeat(MIN_AUTH_VALUE_LENGTH);
        let pending_state = "b".repeat(MIN_AUTH_VALUE_LENGTH);
        let snapshot = desktop_auth_snapshot_from_raw(json!({
            "status": "authenticated",
            "stage": "authenticated",
            "message": "ok",
            "token": token,
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
async fn disconnect_agent(provider: String) -> Result<AgentLogoutResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;

        logout_agent_credentials(provider)
    })
    .await
    .map_err(|error| format!("Unable to disconnect terminal CLI: {error}"))?
}

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
async fn forge_working_directory() -> Result<ForgeWorkingDirectory, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let working_directory = default_working_directory()?;

        Ok(workspace_root_basic_response(&working_directory))
    })
    .await
    .map_err(|error| format!("Unable to read Forge working directory: {error}"))?
}

#[tauri::command]
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
#[tauri::command]
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

#[tauri::command]
async fn list_workspace_directory(
    root: String,
    relative_path: String,
) -> Result<WorkspaceDirectoryListing, String> {
    tauri::async_runtime::spawn_blocking(move || list_workspace_directory_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to list workspace directory: {error}"))?
}

#[tauri::command]
async fn read_workspace_file(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileText, String> {
    tauri::async_runtime::spawn_blocking(move || read_workspace_file_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to read workspace file: {error}"))?
}

#[tauri::command]
async fn read_workspace_file_image(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileImage, String> {
    tauri::async_runtime::spawn_blocking(move || read_workspace_file_image_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to read workspace image: {error}"))?
}

#[tauri::command]
async fn read_workspace_file_diff(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || read_workspace_file_diff_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to read workspace file diff: {error}"))?
}

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
async fn run_forge_prompt(request: ForgePromptRequest) -> Result<ForgeRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_forge_prompt_for(request))
        .await
        .map_err(|error| format!("Unable to run Forge Console prompt: {error}"))?
}

#[tauri::command]
async fn agent_thread_turn_start(
    request: AgentThreadTurnRequest,
) -> Result<AgentThreadTurnResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_agent_thread_turn_for(request))
        .await
        .map_err(|error| format!("Unable to send agent turn: {error}"))?
}

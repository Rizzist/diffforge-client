const BYOC_PROVIDERS_STATE_KEY: &str = "byoc-providers";
const BYOC_PROVISION_PROGRESS_EVENT: &str = "byoc-provision-progress";
const BYOC_PROVIDER_HTTP_TIMEOUT_SECS: u64 = 20;
const BYOC_PROVISIONING_TOKEN_TTL_SECS: u64 = 30 * 60;

#[derive(Clone)]
struct ByocProvisionJob {
    provision_id: String,
    provider: String,
    credentials: Value,
    region: String,
    size: String,
    image: String,
    device_name: String,
    desktop_token: String,
}

#[derive(Clone, Debug)]
struct ByocCreatedServer {
    server_id: Option<String>,
    ip: Option<String>,
}

#[derive(Clone)]
struct AwsCredentials {
    access_key_id: String,
    secret_access_key: String,
    session_token: Option<String>,
}

struct AwsTimestamp {
    amz_date: String,
    date: String,
}

struct GcpServiceAccount {
    client_email: String,
    private_key: String,
    token_uri: String,
    project_id: String,
    zone: String,
}

#[derive(serde::Serialize)]
struct GcpJwtClaims {
    iss: String,
    scope: String,
    aud: String,
    exp: u64,
    iat: u64,
}

#[tauri::command]
async fn byoc_provider_catalog() -> Result<Value, String> {
    Ok(json!({
        "providers": [
            {
                "id": "hetzner",
                "label": "Hetzner Cloud",
                "credentialFields": [
                    {
                        "key": "apiToken",
                        "label": "API Token",
                        "secret": true,
                        "help": "Cloud console \u{2192} Security \u{2192} API Tokens (Read & Write)"
                    }
                ],
                "supportsLiveOptions": true
            },
            {
                "id": "digitalocean",
                "label": "DigitalOcean",
                "credentialFields": [
                    {
                        "key": "apiToken",
                        "label": "Personal Access Token",
                        "secret": true,
                        "help": "API \u{2192} Tokens (write scope)"
                    }
                ],
                "supportsLiveOptions": true
            },
            {
                "id": "aws",
                "label": "Amazon EC2",
                "credentialFields": [
                    { "key": "accessKeyId", "label": "Access Key ID", "secret": false },
                    { "key": "secretAccessKey", "label": "Secret Access Key", "secret": true },
                    { "key": "region", "label": "Default Region", "secret": false, "placeholder": "us-east-1" }
                ],
                "supportsLiveOptions": true
            },
            {
                "id": "gcp",
                "label": "Google Cloud",
                "credentialFields": [
                    {
                        "key": "serviceAccountJson",
                        "label": "Service Account JSON",
                        "secret": true,
                        "multiline": true,
                        "help": "IAM \u{2192} Service Accounts \u{2192} Keys \u{2192} JSON (Compute Admin role)"
                    },
                    { "key": "projectId", "label": "Project ID", "secret": false },
                    { "key": "zone", "label": "Zone", "secret": false, "placeholder": "us-central1-a" }
                ],
                "supportsLiveOptions": true
            }
        ]
    }))
}

#[tauri::command]
async fn byoc_list_server_options(
    app: AppHandle,
    provider: String,
    credentials: Value,
    use_saved: Option<bool>,
) -> Result<Value, String> {
    let provider = byoc_normalize_provider_id(&provider)?;
    let credentials =
        byoc_resolve_request_credentials(&app, &provider, &credentials, use_saved.unwrap_or(false))?;
    tauri::async_runtime::spawn_blocking(move || {
        byoc_list_server_options_blocking(&provider, &credentials)
    })
    .await
    .map_err(|error| format!("BYOC options worker failed: {error}"))?
}

#[tauri::command]
async fn byoc_provision(app: AppHandle, request: Value) -> Result<Value, String> {
    let provider = byoc_normalize_provider_id(&byoc_required_string(&request, "provider")?)?;
    let use_saved = request
        .get("useSaved")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let credentials = byoc_resolve_request_credentials(
        &app,
        &provider,
        &request.get("credentials").cloned().unwrap_or_else(|| json!({})),
        use_saved,
    )?;
    let region = byoc_required_string(&request, "region")?;
    let size = byoc_required_string(&request, "size")?;
    let image = byoc_required_string(&request, "image")?;
    let short_id = uuid::Uuid::new_v4().to_string();
    let provision_id = short_id.clone();
    let default_name = format!("byoc-{provider}-{}", &short_id[..8]);
    let device_name = byoc_normalize_device_name(
        request
            .get("deviceName")
            .and_then(Value::as_str)
            .unwrap_or(&default_name),
    );
    let desktop_token = desktop_auth_snapshot_token(&desktop_auth_snapshot(&app))
        .ok_or_else(|| "Sign in to Diff Forge before provisioning a BYOC server.".to_string())?;

    if request
        .get("saveCredentials")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        byoc_save_provider_credentials(&app, &provider, &credentials)?;
    }

    let job = ByocProvisionJob {
        provision_id: provision_id.clone(),
        provider: provider.clone(),
        credentials,
        region,
        size,
        image,
        device_name: device_name.clone(),
        desktop_token,
    };
    let worker_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let error_app = worker_app.clone();
        let error_job = job.clone();
        let result =
            tauri::async_runtime::spawn_blocking(move || byoc_provision_blocking(&worker_app, job))
                .await;
        let error = match result {
            Ok(Ok(())) => None,
            Ok(Err(error)) => Some(error),
            Err(error) => Some(format!("BYOC provisioning worker failed: {error}")),
        };
        if let Some(error) = error {
            let sanitized = byoc_sanitize_error(&error, &[]);
            byoc_emit_progress(
                &error_app,
                &error_job,
                "error",
                "BYOC provisioning failed.",
                None,
                None,
                Some(&sanitized),
            );
        }
    });

    Ok(json!({
        "provisionId": provision_id,
        "deviceName": device_name
    }))
}

#[tauri::command]
async fn byoc_saved_providers(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(byoc_saved_providers_from_state(&app_local_state_read(
            &app,
            BYOC_PROVIDERS_STATE_KEY,
        )))
    })
    .await
    .map_err(|error| format!("BYOC saved providers worker failed: {error}"))?
}

#[tauri::command]
async fn byoc_delete_saved_provider(app: AppHandle, provider: String) -> Result<Value, String> {
    let provider = byoc_normalize_provider_id(&provider)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut state = match app_local_state_read(&app, BYOC_PROVIDERS_STATE_KEY) {
            Value::Object(map) => Value::Object(map),
            _ => json!({}),
        };
        if let Some(providers) = state.get_mut("providers").and_then(Value::as_object_mut) {
            providers.remove(&provider);
        }
        byoc_app_local_state_write_secure(&app, BYOC_PROVIDERS_STATE_KEY, &state)?;
        Ok(json!({ "ok": true }))
    })
    .await
    .map_err(|error| format!("BYOC delete saved provider worker failed: {error}"))?
}

fn byoc_list_server_options_blocking(provider: &str, credentials: &Value) -> Result<Value, String> {
    match provider {
        "hetzner" => byoc_hetzner_options(credentials),
        "digitalocean" => byoc_digitalocean_options(credentials),
        "aws" => byoc_aws_options(credentials),
        "gcp" => byoc_gcp_options(credentials),
        _ => Err("Unsupported BYOC provider.".to_string()),
    }
}

fn byoc_provision_blocking(app: &AppHandle, job: ByocProvisionJob) -> Result<(), String> {
    byoc_emit_progress(
        app,
        &job,
        "minting_token",
        "Minting provisioning token.",
        None,
        None,
        None,
    );
    let minted = byoc_mint_provisioning_token(&job)?;
    let provisioning_token = minted.token;
    let api_base = api_base_url();

    byoc_emit_progress(
        app,
        &job,
        "creating_server",
        "Creating cloud server.",
        None,
        None,
        None,
    );
    let created = match job.provider.as_str() {
        "hetzner" => byoc_create_hetzner_server(&job, &provisioning_token, &api_base),
        "digitalocean" => byoc_create_digitalocean_server(&job, &provisioning_token, &api_base),
        "aws" => byoc_create_aws_server(&job, &provisioning_token, &api_base),
        "gcp" => byoc_create_gcp_server(&job, &provisioning_token, &api_base),
        _ => Err("Unsupported BYOC provider.".to_string()),
    };
    let created = match created {
        Ok(created) => created,
        Err(error) => {
            // Server never came up — don't strand a single-use token against
            // the 25-active cap; best-effort revoke it.
            if let Some(token_id) = minted.token_id.as_deref() {
                byoc_revoke_provisioning_token(&job, token_id);
            }
            return Err(error);
        }
    };

    byoc_emit_progress(
        app,
        &job,
        "server_created",
        "Server created. First-boot installer is starting.",
        created.server_id.as_deref(),
        created.ip.as_deref(),
        None,
    );
    byoc_emit_progress(
        app,
        &job,
        "installing",
        "Diff Forge daemon installer is running on the server.",
        created.server_id.as_deref(),
        created.ip.as_deref(),
        None,
    );
    Ok(())
}

fn byoc_emit_progress(
    app: &AppHandle,
    job: &ByocProvisionJob,
    stage: &str,
    message: &str,
    server_id: Option<&str>,
    ip: Option<&str>,
    error: Option<&str>,
) {
    let mut payload = serde_json::Map::new();
    payload.insert("provisionId".to_string(), json!(job.provision_id));
    payload.insert("stage".to_string(), json!(stage));
    payload.insert("message".to_string(), json!(message));
    payload.insert("deviceName".to_string(), json!(job.device_name));
    payload.insert("provider".to_string(), json!(job.provider));
    if let Some(server_id) = server_id.filter(|value| !value.trim().is_empty()) {
        payload.insert("serverId".to_string(), json!(server_id));
    }
    if let Some(ip) = ip.filter(|value| !value.trim().is_empty()) {
        payload.insert("ip".to_string(), json!(ip));
    }
    if let Some(error) = error.filter(|value| !value.trim().is_empty()) {
        payload.insert("error".to_string(), json!(error));
    }
    let _ = app.emit(BYOC_PROVISION_PROGRESS_EVENT, Value::Object(payload));
}

fn byoc_mint_provisioning_token(job: &ByocProvisionJob) -> Result<ByocMintedToken, String> {
    let client = blocking_http_client(Duration::from_secs(BYOC_PROVIDER_HTTP_TIMEOUT_SECS))?;
    let response = client
        .post(api_endpoint("desktop/provisioning-tokens"))
        .bearer_auth(&job.desktop_token)
        .json(&json!({
            "deviceName": job.device_name,
            "label": format!("BYOC {}", job.provider),
            "ttlSeconds": BYOC_PROVISIONING_TOKEN_TTL_SECS
        }))
        .send()
        .map_err(|_| "Unable to mint BYOC provisioning token.".to_string())?;
    let body = read_blocking_api_response(response, "Unable to mint BYOC provisioning token.")
        .map_err(|error| {
            byoc_sanitize_error(
                &format!("Unable to mint BYOC provisioning token: {error}"),
                &[],
            )
        })?;
    let token = body
        .get("token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Provisioning token response did not include a token.".to_string())?;
    let token_id = body
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Ok(ByocMintedToken { token, token_id })
}

struct ByocMintedToken {
    token: String,
    token_id: Option<String>,
}

fn byoc_revoke_provisioning_token(job: &ByocProvisionJob, token_id: &str) {
    let Ok(client) = blocking_http_client(Duration::from_secs(BYOC_PROVIDER_HTTP_TIMEOUT_SECS))
    else {
        return;
    };
    let _ = client
        .delete(api_endpoint(&format!("desktop/provisioning-tokens/{token_id}")))
        .bearer_auth(&job.desktop_token)
        .send();
}

fn byoc_save_provider_credentials(
    app: &AppHandle,
    provider: &str,
    credentials: &Value,
) -> Result<(), String> {
    let mut state = match app_local_state_read(app, BYOC_PROVIDERS_STATE_KEY) {
        Value::Object(map) => Value::Object(map),
        _ => json!({}),
    };
    let providers = state
        .as_object_mut()
        .expect("state is an object")
        .entry("providers".to_string())
        .or_insert_with(|| json!({}));
    if !providers.is_object() {
        *providers = json!({});
    }
    let label = byoc_provider_label(provider);
    providers
        .as_object_mut()
        .expect("providers is an object")
        .insert(
            provider.to_string(),
            json!({
                "provider": provider,
                "credentials": credentials,
                "savedAtMs": byoc_now_ms(),
                "label": label
            }),
        );
    byoc_app_local_state_write_secure(app, BYOC_PROVIDERS_STATE_KEY, &state)
}

fn byoc_app_local_state_write_secure(
    app: &AppHandle,
    key: &str,
    value: &Value,
) -> Result<(), String> {
    // 0600 on the temp file before rename — no world-readable window for the
    // plaintext provider secrets.
    app_local_state_write_with_mode(app, key, value, Some(0o600))?;
    Ok(())
}

// Full saved credentials (with secrets) — Rust-only; never returned to JS.
fn byoc_load_saved_credentials(app: &AppHandle, provider: &str) -> Option<Value> {
    app_local_state_read(app, BYOC_PROVIDERS_STATE_KEY)
        .get("providers")
        .and_then(Value::as_object)
        .and_then(|providers| providers.get(provider))
        .and_then(|entry| entry.get("credentials"))
        .filter(|value| value.is_object())
        .cloned()
}

// Resolves the credentials a job/options-lookup should use: with use_saved,
// start from the on-disk secrets (so the UI never has to re-hold them) and
// overlay any non-empty fields the request did send; otherwise use the
// request credentials verbatim. Secrets stay entirely Rust-side.
fn byoc_resolve_request_credentials(
    app: &AppHandle,
    provider: &str,
    request_credentials: &Value,
    use_saved: bool,
) -> Result<Value, String> {
    let request_object = request_credentials.as_object().cloned().unwrap_or_default();
    if !use_saved {
        if request_object.is_empty() {
            return Err("Provider credentials are required.".to_string());
        }
        return Ok(Value::Object(request_object));
    }
    let mut base = byoc_load_saved_credentials(app, provider)
        .and_then(|value| value.as_object().cloned())
        .ok_or_else(|| "No saved credentials for this provider.".to_string())?;
    for (key, value) in request_object {
        let non_empty = value.as_str().map(|text| !text.trim().is_empty()).unwrap_or(true);
        if non_empty {
            base.insert(key, value);
        }
    }
    Ok(Value::Object(base))
}

fn byoc_saved_providers_from_state(state: &Value) -> Value {
    let providers = state
        .get("providers")
        .and_then(Value::as_object)
        .map(|providers| {
            let mut rows = providers
                .values()
                .filter_map(|entry| {
                    let provider = entry.get("provider").and_then(Value::as_str)?.to_string();
                    let label = entry
                        .get("label")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| byoc_provider_label(&provider));
                    let saved_at_ms = entry
                        .get("savedAtMs")
                        .and_then(Value::as_u64)
                        .unwrap_or_default();
                    let credential_summary = byoc_credential_summary(entry.get("credentials"));
                    Some(json!({
                        "provider": provider,
                        "label": label,
                        "savedAtMs": saved_at_ms,
                        "credentialSummary": credential_summary
                    }))
                })
                .collect::<Vec<_>>();
            rows.sort_by(|left, right| {
                let left_label = left.get("label").and_then(Value::as_str).unwrap_or("");
                let right_label = right.get("label").and_then(Value::as_str).unwrap_or("");
                left_label.cmp(right_label)
            });
            rows
        })
        .unwrap_or_default();
    json!({ "providers": providers })
}

fn byoc_credential_summary(credentials: Option<&Value>) -> Value {
    let mut summary = serde_json::Map::new();
    if let Some(object) = credentials.and_then(Value::as_object) {
        let mut keys = object.keys().cloned().collect::<Vec<_>>();
        keys.sort();
        for key in keys {
            if let Some(value) = object.get(&key) {
                summary.insert(key, json!(byoc_mask_credential_value(value)));
            }
        }
    }
    Value::Object(summary)
}

fn byoc_mask_credential_value(value: &Value) -> String {
    let Some(raw) = value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return "present".to_string();
    };
    let chars = raw.chars().collect::<Vec<_>>();
    if chars.len() <= 4 {
        "present".to_string()
    } else {
        let suffix = chars[chars.len().saturating_sub(4)..]
            .iter()
            .collect::<String>();
        format!("****{suffix}")
    }
}

fn byoc_hetzner_options(credentials: &Value) -> Result<Value, String> {
    let token = byoc_required_credential(credentials, "apiToken")?;
    let client = byoc_provider_client()?;
    let datacenters = byoc_bearer_json_get(
        &client,
        "Hetzner",
        "https://api.hetzner.cloud/v1/datacenters",
        &token,
    )?;
    let server_types = byoc_bearer_json_get(
        &client,
        "Hetzner",
        "https://api.hetzner.cloud/v1/server_types",
        &token,
    )?;
    let images = byoc_bearer_json_get(
        &client,
        "Hetzner",
        "https://api.hetzner.cloud/v1/images",
        &token,
    )?;

    Ok(json!({
        "regions": byoc_hetzner_regions_from_value(&datacenters),
        "sizes": byoc_hetzner_sizes_from_value(&server_types),
        "images": byoc_hetzner_images_from_value(&images)
    }))
}

fn byoc_hetzner_regions_from_value(value: &Value) -> Vec<Value> {
    value
        .get("datacenters")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("name").and_then(Value::as_str)?;
                    let label = item
                        .get("description")
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or(id);
                    let mut row = json!({ "id": id, "label": label });
                    let city = item
                        .get("location")
                        .and_then(|location| location.get("city"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let country = item
                        .get("location")
                        .and_then(|location| location.get("country"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let detail = [city, country]
                        .iter()
                        .copied()
                        .filter(|part| !part.trim().is_empty())
                        .collect::<Vec<_>>()
                        .join(", ");
                    if !detail.is_empty() {
                        row["detail"] = json!(detail);
                    }
                    Some(row)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn byoc_hetzner_sizes_from_value(value: &Value) -> Vec<Value> {
    let mut sizes = value
        .get("server_types")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    !item
                        .get("deprecated")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
                .filter(|item| {
                    item.get("architecture")
                        .and_then(Value::as_str)
                        .map(|arch| arch.eq_ignore_ascii_case("x86"))
                        .unwrap_or(true)
                })
                .filter(|item| {
                    // Real API: `cpu_type` is "shared"/"dedicated"; `category`
                    // is a display string ("Shared vCPU"). Match cpu_type, and
                    // accept category only via case-insensitive contains so a
                    // future rename can't silently empty the whole list.
                    let cpu_type = item.get("cpu_type").and_then(Value::as_str);
                    if let Some(cpu_type) = cpu_type {
                        return cpu_type.eq_ignore_ascii_case("shared")
                            || cpu_type.eq_ignore_ascii_case("dedicated");
                    }
                    item.get("category")
                        .and_then(Value::as_str)
                        .map(|category| {
                            let lowered = category.to_ascii_lowercase();
                            lowered.contains("shared") || lowered.contains("dedicated")
                        })
                        .unwrap_or(true)
                })
                .filter_map(|item| {
                    let id = item.get("name").and_then(Value::as_str)?;
                    let cores = item.get("cores").and_then(Value::as_u64).unwrap_or(0);
                    let memory = item.get("memory").and_then(Value::as_f64).unwrap_or(0.0);
                    let disk = item.get("disk").and_then(Value::as_u64).unwrap_or(0);
                    let label = format!(
                        "{id} \u{00b7} {} vCPU \u{00b7} {}",
                        cores,
                        byoc_format_gb(memory)
                    );
                    let mut row = json!({
                        "id": id,
                        "label": label,
                        "detail": format!("{disk}GB SSD")
                    });
                    if let Some(price_hint) = byoc_hetzner_price_hint(item) {
                        row["priceHint"] = json!(price_hint);
                    }
                    Some(row)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    sizes.sort_by(|left, right| {
        let left_id = left.get("id").and_then(Value::as_str).unwrap_or("");
        let right_id = right.get("id").and_then(Value::as_str).unwrap_or("");
        left_id.cmp(right_id)
    });
    sizes
}

fn byoc_hetzner_price_hint(item: &Value) -> Option<String> {
    let prices = item.get("prices").and_then(Value::as_array)?;
    let price = prices.first()?;
    let monthly = price
        .get("price_monthly")
        .and_then(|value| value.get("gross"))
        .and_then(Value::as_str)?;
    Some(format!("\u{20ac}{monthly}/mo"))
}

fn byoc_hetzner_images_from_value(value: &Value) -> Vec<Value> {
    value
        .get("images")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| item.get("type").and_then(Value::as_str) == Some("system"))
                .filter(|item| {
                    let flavor = item.get("os_flavor").and_then(Value::as_str).unwrap_or("");
                    let version = item.get("os_version").and_then(Value::as_str).unwrap_or("");
                    (flavor == "ubuntu"
                        && (version.starts_with("22.04") || version.starts_with("24.04")))
                        || (flavor == "debian" && version.starts_with("12"))
                })
                .filter_map(|item| {
                    let id = item.get("name").and_then(Value::as_str)?;
                    let label = item
                        .get("description")
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or(id);
                    let mut row = json!({ "id": id, "label": label });
                    if let Some(detail) = item.get("os_version").and_then(Value::as_str) {
                        row["detail"] = json!(detail);
                    }
                    Some(row)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn byoc_digitalocean_options(credentials: &Value) -> Result<Value, String> {
    let token = byoc_required_credential(credentials, "apiToken")?;
    let client = byoc_provider_client()?;
    let regions = byoc_bearer_json_get(
        &client,
        "DigitalOcean",
        "https://api.digitalocean.com/v2/regions",
        &token,
    )?;
    let sizes = byoc_bearer_json_get(
        &client,
        "DigitalOcean",
        "https://api.digitalocean.com/v2/sizes?per_page=200",
        &token,
    )?;
    let images = byoc_bearer_json_get(
        &client,
        "DigitalOcean",
        "https://api.digitalocean.com/v2/images?type=distribution&per_page=200",
        &token,
    )?;

    Ok(json!({
        "regions": byoc_do_regions_from_value(&regions),
        "sizes": byoc_do_sizes_from_value(&sizes),
        "images": byoc_do_images_from_value(&images)
    }))
}

fn byoc_do_regions_from_value(value: &Value) -> Vec<Value> {
    value
        .get("regions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    item.get("available")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
                .filter_map(|item| {
                    let id = item.get("slug").and_then(Value::as_str)?;
                    let label = item.get("name").and_then(Value::as_str).unwrap_or(id);
                    Some(json!({ "id": id, "label": label }))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn byoc_do_sizes_from_value(value: &Value) -> Vec<Value> {
    value
        .get("sizes")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    item.get("available")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
                .filter_map(|item| {
                    let id = item.get("slug").and_then(Value::as_str)?;
                    let vcpus = item.get("vcpus").and_then(Value::as_u64).unwrap_or(0);
                    let memory_mb = item.get("memory").and_then(Value::as_u64).unwrap_or(0);
                    let disk = item.get("disk").and_then(Value::as_u64).unwrap_or(0);
                    let label = format!(
                        "{id} \u{00b7} {} vCPU \u{00b7} {}",
                        vcpus,
                        byoc_format_gb(memory_mb as f64 / 1024.0)
                    );
                    let mut row = json!({
                        "id": id,
                        "label": label,
                        "detail": format!("{disk}GB SSD")
                    });
                    if let Some(monthly) = item.get("price_monthly").and_then(Value::as_f64) {
                        row["priceHint"] = json!(format!("${monthly:.2}/mo"));
                    }
                    Some(row)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn byoc_do_images_from_value(value: &Value) -> Vec<Value> {
    value
        .get("images")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    item.get("type")
                        .and_then(Value::as_str)
                        .map(|value| value == "distribution")
                        .unwrap_or(true)
                })
                .filter(|item| {
                    let distribution = item
                        .get("distribution")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    let name = item
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    (distribution == "ubuntu" && (name.contains("22.04") || name.contains("24.04")))
                        || (distribution == "debian" && name.contains("12"))
                })
                .filter_map(|item| {
                    let id = item.get("slug").and_then(Value::as_str)?;
                    let name = item.get("name").and_then(Value::as_str).unwrap_or(id);
                    let distribution = item
                        .get("distribution")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    Some(json!({
                        "id": id,
                        "label": format!("{distribution} {name}").trim().to_string(),
                        "detail": "distribution"
                    }))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn byoc_aws_options(credentials: &Value) -> Result<Value, String> {
    let region =
        byoc_optional_credential(credentials, "region").unwrap_or_else(|| "us-east-1".to_string());
    let aws = byoc_aws_credentials(credentials)?;
    let regions = byoc_aws_describe_regions(&aws, &region).map_err(|error| {
        byoc_sanitize_error(
            &format!("AWS credentials rejected: {error}"),
            &[aws.access_key_id.as_str(), aws.secret_access_key.as_str()],
        )
    })?;
    Ok(json!({
        "regions": regions
            .into_iter()
            .map(|id| json!({ "id": id, "label": id }))
            .collect::<Vec<_>>(),
        "sizes": byoc_aws_curated_sizes(),
        "images": byoc_aws_curated_images()
    }))
}

fn byoc_aws_curated_sizes() -> Vec<Value> {
    vec![
        json!({ "id": "t3.small", "label": "t3.small \u{00b7} 2 vCPU \u{00b7} 2GB", "detail": "Curated general-purpose EC2 type" }),
        json!({ "id": "t3.medium", "label": "t3.medium \u{00b7} 2 vCPU \u{00b7} 4GB", "detail": "Curated general-purpose EC2 type" }),
        json!({ "id": "t3.large", "label": "t3.large \u{00b7} 2 vCPU \u{00b7} 8GB", "detail": "Curated general-purpose EC2 type" }),
        json!({ "id": "t3a.small", "label": "t3a.small \u{00b7} 2 vCPU \u{00b7} 2GB", "detail": "Curated general-purpose EC2 type" }),
        json!({ "id": "t3a.medium", "label": "t3a.medium \u{00b7} 2 vCPU \u{00b7} 4GB", "detail": "Curated general-purpose EC2 type" }),
        json!({ "id": "m6i.large", "label": "m6i.large \u{00b7} 2 vCPU \u{00b7} 8GB", "detail": "Curated general-purpose EC2 type" }),
        json!({ "id": "m6i.xlarge", "label": "m6i.xlarge \u{00b7} 4 vCPU \u{00b7} 16GB", "detail": "Curated general-purpose EC2 type" }),
        json!({ "id": "m5.large", "label": "m5.large \u{00b7} 2 vCPU \u{00b7} 8GB", "detail": "Curated general-purpose EC2 type" }),
    ]
}

fn byoc_aws_curated_images() -> Vec<Value> {
    vec![
        json!({ "id": "ubuntu-22.04", "label": "Ubuntu 22.04 LTS", "detail": "Resolved at provision time through AWS SSM public parameters" }),
        json!({ "id": "ubuntu-24.04", "label": "Ubuntu 24.04 LTS", "detail": "Resolved at provision time through AWS SSM public parameters" }),
    ]
}

fn byoc_gcp_options(credentials: &Value) -> Result<Value, String> {
    let account = byoc_gcp_service_account(credentials)?;
    let client = byoc_provider_client()?;
    let access_token = byoc_gcp_access_token(&client, &account)?;
    let zones_url = format!(
        "https://compute.googleapis.com/compute/v1/projects/{}/zones",
        byoc_url_path_segment(&account.project_id)
    );
    let zones = byoc_gcp_get_json(&client, &access_token, &zones_url)?;
    Ok(json!({
        "regions": byoc_gcp_zones_from_value(&zones),
        "sizes": byoc_gcp_curated_sizes(),
        "images": byoc_gcp_curated_images()
    }))
}

fn byoc_gcp_zones_from_value(value: &Value) -> Vec<Value> {
    value
        .get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("name").and_then(Value::as_str)?;
                    // Skip DOWN zones — picking one only fails later at insert.
                    let status = item.get("status").and_then(Value::as_str).unwrap_or("UP");
                    if !status.eq_ignore_ascii_case("UP") {
                        return None;
                    }
                    Some(json!({ "id": id, "label": id }))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn byoc_gcp_curated_sizes() -> Vec<Value> {
    vec![
        json!({ "id": "e2-small", "label": "e2-small \u{00b7} 2 vCPU \u{00b7} 2GB", "detail": "Curated Google Compute Engine E2 type" }),
        json!({ "id": "e2-medium", "label": "e2-medium \u{00b7} 2 vCPU \u{00b7} 4GB", "detail": "Curated Google Compute Engine E2 type" }),
        json!({ "id": "e2-standard-2", "label": "e2-standard-2 \u{00b7} 2 vCPU \u{00b7} 8GB", "detail": "Curated Google Compute Engine E2 type" }),
        json!({ "id": "e2-standard-4", "label": "e2-standard-4 \u{00b7} 4 vCPU \u{00b7} 16GB", "detail": "Curated Google Compute Engine E2 type" }),
    ]
}

fn byoc_gcp_curated_images() -> Vec<Value> {
    vec![
        json!({ "id": "ubuntu-2204-lts", "label": "Ubuntu 22.04 LTS", "detail": "ubuntu-os-cloud image family" }),
        json!({ "id": "ubuntu-2404-lts-amd64", "label": "Ubuntu 24.04 LTS", "detail": "ubuntu-os-cloud image family" }),
        json!({ "id": "debian-12", "label": "Debian 12", "detail": "debian-cloud image family" }),
    ]
}

fn byoc_create_hetzner_server(
    job: &ByocProvisionJob,
    provisioning_token: &str,
    api_base: &str,
) -> Result<ByocCreatedServer, String> {
    let token = byoc_required_credential(&job.credentials, "apiToken")?;
    let user_data = byoc_cloud_init_user_data(provisioning_token, api_base, &job.device_name);
    let client = byoc_provider_client()?;
    let response = client
        .post("https://api.hetzner.cloud/v1/servers")
        .bearer_auth(&token)
        .json(&json!({
            "name": job.device_name,
            "server_type": job.size,
            "image": job.image,
            "datacenter": job.region,
            "user_data": user_data,
            "start_after_create": true
        }))
        .send()
        .map_err(|_| "Unable to reach Hetzner API.".to_string())?;
    let body = byoc_json_response("Hetzner", response)?;
    let server = body.get("server").unwrap_or(&body);
    let server_id = server
        .get("id")
        .map(|value| value.to_string().trim_matches('"').to_string());
    let ip = server
        .get("public_net")
        .and_then(|value| value.get("ipv4"))
        .and_then(|value| value.get("ip"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(ByocCreatedServer { server_id, ip })
}

fn byoc_create_digitalocean_server(
    job: &ByocProvisionJob,
    provisioning_token: &str,
    api_base: &str,
) -> Result<ByocCreatedServer, String> {
    let token = byoc_required_credential(&job.credentials, "apiToken")?;
    let user_data = byoc_cloud_init_user_data(provisioning_token, api_base, &job.device_name);
    let client = byoc_provider_client()?;
    let response = client
        .post("https://api.digitalocean.com/v2/droplets")
        .bearer_auth(&token)
        .json(&json!({
            "name": job.device_name,
            "region": job.region,
            "size": job.size,
            "image": job.image,
            "user_data": user_data,
            "ssh_keys": []
        }))
        .send()
        .map_err(|_| "Unable to reach DigitalOcean API.".to_string())?;
    let body = byoc_json_response("DigitalOcean", response)?;
    let droplet = body.get("droplet").unwrap_or(&body);
    let server_id = droplet
        .get("id")
        .map(|value| value.to_string().trim_matches('"').to_string());
    let ip = droplet
        .get("networks")
        .and_then(|value| value.get("v4"))
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().find_map(|item| {
                let ip_type = item.get("type").and_then(Value::as_str).unwrap_or("");
                if ip_type == "public" {
                    item.get("ip_address").and_then(Value::as_str)
                } else {
                    None
                }
            })
        })
        .map(str::to_string);
    Ok(ByocCreatedServer { server_id, ip })
}

fn byoc_create_aws_server(
    job: &ByocProvisionJob,
    provisioning_token: &str,
    api_base: &str,
) -> Result<ByocCreatedServer, String> {
    let aws = byoc_aws_credentials(&job.credentials)?;
    let user_data = byoc_cloud_init_user_data(provisioning_token, api_base, &job.device_name);
    let ami_id = byoc_aws_resolve_ami(&aws, &job.region, &job.image)?;
    let security_group_id = byoc_aws_ensure_egress_security_group(&aws, &job.region)?;
    let user_data_b64 = {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.encode(user_data.as_bytes())
    };
    let params = vec![
        ("Action".to_string(), "RunInstances".to_string()),
        ("Version".to_string(), "2016-11-15".to_string()),
        ("ImageId".to_string(), ami_id),
        ("InstanceType".to_string(), job.size.clone()),
        ("MinCount".to_string(), "1".to_string()),
        ("MaxCount".to_string(), "1".to_string()),
        ("UserData".to_string(), user_data_b64),
        ("SecurityGroupId.1".to_string(), security_group_id),
        (
            "TagSpecification.1.ResourceType".to_string(),
            "instance".to_string(),
        ),
        (
            "TagSpecification.1.Tag.1.Key".to_string(),
            "Name".to_string(),
        ),
        (
            "TagSpecification.1.Tag.1.Value".to_string(),
            job.device_name.clone(),
        ),
    ];
    let xml = byoc_aws_signed_get("ec2", &job.region, &params, &aws)?;
    let server_id = byoc_xml_first_tag(&xml, "instanceId");
    let ip = byoc_xml_first_tag(&xml, "ipAddress")
        .or_else(|| byoc_xml_first_tag(&xml, "publicIpAddress"));
    Ok(ByocCreatedServer { server_id, ip })
}

fn byoc_create_gcp_server(
    job: &ByocProvisionJob,
    provisioning_token: &str,
    api_base: &str,
) -> Result<ByocCreatedServer, String> {
    let mut account = byoc_gcp_service_account(&job.credentials)?;
    account.zone = job.region.clone();
    let client = byoc_provider_client()?;
    let access_token = byoc_gcp_access_token(&client, &account)?;
    let startup_script = byoc_gcp_startup_script(provisioning_token, api_base, &job.device_name);
    let source_image = byoc_gcp_source_image(&job.image)?;
    let url = format!(
        "https://compute.googleapis.com/compute/v1/projects/{}/zones/{}/instances",
        byoc_url_path_segment(&account.project_id),
        byoc_url_path_segment(&account.zone)
    );
    let response = client
        .post(url)
        .bearer_auth(&access_token)
        .json(&json!({
            "name": job.device_name,
            "machineType": format!("zones/{}/machineTypes/{}", account.zone, job.size),
            "disks": [{
                "boot": true,
                "autoDelete": true,
                "initializeParams": {
                    "sourceImage": source_image
                }
            }],
            "networkInterfaces": [{
                "network": "global/networks/default",
                "accessConfigs": [{
                    "name": "External NAT",
                    "type": "ONE_TO_ONE_NAT"
                }]
            }],
            "metadata": {
                "items": [{
                    "key": "startup-script",
                    "value": startup_script
                }]
            },
            "labels": {
                "diffforge-byoc": "true"
            }
        }))
        .send()
        .map_err(|_| "Unable to reach Google Compute API.".to_string())?;
    let body = byoc_json_response("Google Cloud", response)?;
    let server_id = body
        .get("targetId")
        .or_else(|| body.get("name"))
        .map(|value| value.to_string().trim_matches('"').to_string());
    Ok(ByocCreatedServer {
        server_id,
        ip: None,
    })
}

fn byoc_cloud_init_user_data(provisioning_token: &str, api_base: &str, device_name: &str) -> String {
    let script = byoc_linux_install_script(provisioning_token, api_base, device_name);
    format!(
        "#cloud-config\nwrite_files:\n  - path: /root/diffforge-byoc-install.sh\n    owner: root:root\n    permissions: '0700'\n    content: |\n{}runcmd:\n  - [ bash, /root/diffforge-byoc-install.sh ]\n",
        byoc_indent(&script, 6)
    )
}

fn byoc_gcp_startup_script(provisioning_token: &str, api_base: &str, device_name: &str) -> String {
    byoc_linux_install_script(provisioning_token, api_base, device_name)
}

fn byoc_linux_install_script(provisioning_token: &str, api_base: &str, device_name: &str) -> String {
    let token = byoc_env_file_value(provisioning_token);
    let api_base = byoc_env_file_value(api_base);
    // device_name is already normalized to [a-z0-9-] before it reaches here;
    // env-file-escape defensively so it can never break out of the heredoc.
    let device_name = byoc_env_file_value(device_name);
    format!(
        r#"#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# GCP runs this startup-script on every boot — once the daemon is installed
# there is nothing to redo (the token is single-use and already redeemed).
if [ -f /etc/systemd/system/diffforge-daemon.service ]; then
  systemctl start diffforge-daemon.service || true
  exit 0
fi

# Name the box so it reports the user's chosen device name to presence
# (AWS/GCP otherwise report an ip-*/internal FQDN hostname).
hostnamectl set-hostname "{device_name}" || true

install -d -m 700 /etc/diffforge
cat > /etc/diffforge/daemon.env <<'DIFFFORGE_ENV'
DIFFFORGE_PROVISION_TOKEN={token}
DIFFFORGE_API_BASE_URL={api_base}
DIFFFORGE_ENV
chmod 600 /etc/diffforge/daemon.env

# Fresh cloud images often hold the apt/dpkg lock (unattended-upgrades) for the
# first minute; wait rather than fail the whole install.
apt_ready() {{ ! fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 && ! fuser /var/lib/apt/lists/lock >/dev/null 2>&1; }}
for _ in $(seq 1 30); do apt_ready && break; sleep 5; done

retry() {{ local n=0; until "$@"; do n=$((n+1)); [ "$n" -ge 5 ] && return 1; sleep 10; done; }}

retry apt-get update
if ! retry apt-get install -y ca-certificates curl xvfb libgtk-3-0 libwebkit2gtk-4.1-0; then
  retry apt-get install -y ca-certificates curl xvfb libgtk-3-0 libwebkit2gtk-4.0-37
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ASSET_RE='diffforge-ai-.*linux-x86_64\.deb$|diffforge-ai-.*amd64\.deb$' ;;
  aarch64|arm64) ASSET_RE='diffforge-ai-.*linux-aarch64\.deb$|diffforge-ai-.*arm64\.deb$' ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

WORKDIR="$(mktemp -d)"
cleanup() {{ rm -rf "$WORKDIR"; }}
trap cleanup EXIT
retry curl -fsSL https://api.github.com/repos/Rizzist/diffforge-client-releases/releases/latest -o "$WORKDIR/release.json"
ASSET_URL="$(grep -E '"browser_download_url"[[:space:]]*:' "$WORKDIR/release.json" | sed -E 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' | grep -E "$ASSET_RE" | head -n 1)"
if [ -z "$ASSET_URL" ]; then
  echo "No matching Diff Forge Linux .deb asset found." >&2
  exit 1
fi
retry curl -fsSL "$ASSET_URL" -o "$WORKDIR/diffforge.deb"
retry apt-get install -y "$WORKDIR/diffforge.deb"

BIN="$(command -v diffforge-ai || command -v diffforge || find /usr/bin -maxdepth 1 -type f -name 'diffforge*' | head -n 1)"
if [ -z "$BIN" ]; then
  echo "Diff Forge binary not found after package install." >&2
  exit 1
fi

cat > /etc/systemd/system/diffforge-daemon.service <<UNIT
[Unit]
Description=Diff Forge daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
EnvironmentFile=/etc/diffforge/daemon.env
ExecStart=/usr/bin/xvfb-run -a $BIN daemon
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now diffforge-daemon.service
"#
    )
}

fn byoc_indent(value: &str, spaces: usize) -> String {
    let prefix = " ".repeat(spaces);
    value
        .lines()
        .map(|line| format!("{prefix}{line}\n"))
        .collect::<String>()
}

fn byoc_env_file_value(value: &str) -> String {
    value
        .chars()
        .filter(|character| !matches!(character, '\r' | '\n' | '\0'))
        .collect()
}

fn byoc_bearer_json_get(
    client: &reqwest::blocking::Client,
    provider_label: &str,
    url: &str,
    token: &str,
) -> Result<Value, String> {
    let response = client
        .get(url)
        .bearer_auth(token)
        .send()
        .map_err(|_| format!("Unable to reach {provider_label} API."))?;
    byoc_json_response(provider_label, response)
}

fn byoc_json_response(
    provider_label: &str,
    response: reqwest::blocking::Response,
) -> Result<Value, String> {
    let status = response.status();
    let text = response
        .text()
        .map_err(|_| format!("Unable to read {provider_label} API response."))?;
    let body = if text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str::<Value>(&text)
            .map_err(|_| format!("{provider_label} API returned invalid JSON."))?
    };
    if status.is_success() {
        return Ok(body);
    }
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(format!("{provider_label} credentials rejected: {status}"));
    }
    let message = body
        .get("error")
        .and_then(Value::as_str)
        .or_else(|| body.get("message").and_then(Value::as_str))
        .or_else(|| {
            body.get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
        })
        .map(|message| byoc_sanitize_error(message, &[]))
        .unwrap_or_else(|| status.to_string());
    Err(format!("{provider_label} API request failed: {message}"))
}

fn byoc_provider_client() -> Result<reqwest::blocking::Client, String> {
    blocking_http_client(Duration::from_secs(BYOC_PROVIDER_HTTP_TIMEOUT_SECS))
}

fn byoc_aws_credentials(credentials: &Value) -> Result<AwsCredentials, String> {
    Ok(AwsCredentials {
        access_key_id: byoc_required_credential(credentials, "accessKeyId")?,
        secret_access_key: byoc_required_credential(credentials, "secretAccessKey")?,
        session_token: byoc_optional_credential(credentials, "sessionToken"),
    })
}

fn byoc_aws_describe_regions(aws: &AwsCredentials, region: &str) -> Result<Vec<String>, String> {
    let params = vec![
        ("Action".to_string(), "DescribeRegions".to_string()),
        ("Version".to_string(), "2016-11-15".to_string()),
        // Opted-in regions only — listing an not-opted-in region just fails
        // later at RunInstances with an opaque auth error.
        ("AllRegions".to_string(), "false".to_string()),
    ];
    let xml = byoc_aws_signed_get("ec2", region, &params, aws)?;
    let mut regions = byoc_xml_tag_values(&xml, "regionName");
    regions.sort();
    regions.dedup();
    if regions.is_empty() {
        regions.push(region.to_string());
    }
    Ok(regions)
}

fn byoc_aws_resolve_ami(aws: &AwsCredentials, region: &str, image: &str) -> Result<String, String> {
    let parameter = match image {
        "ubuntu-22.04" | "ubuntu-2204-lts" => {
            "/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id"
        }
        "ubuntu-24.04" | "ubuntu-2404-lts" => {
            "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp2/ami-id"
        }
        _ => return Err("Unsupported AWS image selection.".to_string()),
    };
    let params = vec![
        ("Action".to_string(), "GetParameter".to_string()),
        ("Version".to_string(), "2014-11-06".to_string()),
        ("Name".to_string(), parameter.to_string()),
    ];
    let xml = byoc_aws_signed_get("ssm", region, &params, aws)?;
    byoc_xml_first_tag(&xml, "Value")
        .filter(|value| value.starts_with("ami-"))
        .ok_or_else(|| "Unable to resolve AWS AMI from SSM.".to_string())
}

fn byoc_aws_ensure_egress_security_group(
    aws: &AwsCredentials,
    region: &str,
) -> Result<String, String> {
    let vpc_params = vec![
        ("Action".to_string(), "DescribeVpcs".to_string()),
        ("Version".to_string(), "2016-11-15".to_string()),
        ("Filter.1.Name".to_string(), "isDefault".to_string()),
        ("Filter.1.Value.1".to_string(), "true".to_string()),
    ];
    let vpc_xml = byoc_aws_signed_get("ec2", region, &vpc_params, aws)?;
    let vpc_id = byoc_xml_first_tag(&vpc_xml, "vpcId")
        .ok_or_else(|| "AWS default VPC was not found in the selected region.".to_string())?;
    let group_name = "diffforge-byoc-egress-only";
    if let Some(group_id) = byoc_aws_find_security_group(aws, region, group_name, &vpc_id)? {
        return Ok(group_id);
    }
    let create_params = vec![
        ("Action".to_string(), "CreateSecurityGroup".to_string()),
        ("Version".to_string(), "2016-11-15".to_string()),
        ("GroupName".to_string(), group_name.to_string()),
        (
            "GroupDescription".to_string(),
            "Diff Forge BYOC egress-only daemon group".to_string(),
        ),
        ("VpcId".to_string(), vpc_id.clone()),
    ];
    match byoc_aws_signed_get("ec2", region, &create_params, aws) {
        Ok(xml) => byoc_xml_first_tag(&xml, "groupId")
            .ok_or_else(|| "AWS security group creation did not return a group id.".to_string()),
        Err(_) => byoc_aws_find_security_group(aws, region, group_name, &vpc_id)?
            .ok_or_else(|| "Unable to create AWS BYOC security group.".to_string()),
    }
}

fn byoc_aws_find_security_group(
    aws: &AwsCredentials,
    region: &str,
    group_name: &str,
    vpc_id: &str,
) -> Result<Option<String>, String> {
    let params = vec![
        ("Action".to_string(), "DescribeSecurityGroups".to_string()),
        ("Version".to_string(), "2016-11-15".to_string()),
        ("Filter.1.Name".to_string(), "group-name".to_string()),
        ("Filter.1.Value.1".to_string(), group_name.to_string()),
        ("Filter.2.Name".to_string(), "vpc-id".to_string()),
        ("Filter.2.Value.1".to_string(), vpc_id.to_string()),
    ];
    let xml = byoc_aws_signed_get("ec2", region, &params, aws)?;
    Ok(byoc_xml_first_tag(&xml, "groupId"))
}

fn byoc_aws_signed_get(
    service: &str,
    region: &str,
    params: &[(String, String)],
    credentials: &AwsCredentials,
) -> Result<String, String> {
    let client = byoc_provider_client()?;
    let host = format!("{service}.{region}.amazonaws.com");
    let timestamp = byoc_aws_timestamp_now();
    let signed = byoc_aws_signed_get_parts(
        "GET",
        &host,
        "/",
        params,
        service,
        region,
        credentials,
        &timestamp,
    );
    let url = format!("https://{host}/?{}", signed.canonical_query);
    let mut request = client
        .get(url)
        .header(
            "content-type",
            "application/x-www-form-urlencoded; charset=utf-8",
        )
        .header("x-amz-date", &timestamp.amz_date)
        .header("Authorization", signed.authorization);
    if let Some(session_token) = credentials.session_token.as_deref() {
        request = request.header("x-amz-security-token", session_token);
    }
    let response = request
        .send()
        .map_err(|_| format!("Unable to reach AWS {service} API."))?;
    let status = response.status();
    let text = response
        .text()
        .map_err(|_| format!("Unable to read AWS {service} API response."))?;
    if status.is_success() {
        return Ok(text);
    }
    let code = byoc_xml_first_tag(&text, "Code").unwrap_or_else(|| status.to_string());
    let message = byoc_xml_first_tag(&text, "Message").unwrap_or_default();
    Err(byoc_sanitize_error(
        &format!("AWS {service} request rejected: {status} {code} {message}"),
        &[
            credentials.access_key_id.as_str(),
            credentials.secret_access_key.as_str(),
        ],
    ))
}

struct AwsSignedGetParts {
    canonical_query: String,
    authorization: String,
}

fn byoc_aws_signed_get_parts(
    method: &str,
    host: &str,
    canonical_uri: &str,
    params: &[(String, String)],
    service: &str,
    region: &str,
    credentials: &AwsCredentials,
    timestamp: &AwsTimestamp,
) -> AwsSignedGetParts {
    let canonical_query = byoc_aws_canonical_query(params);
    let mut canonical_headers = format!(
        "content-type:application/x-www-form-urlencoded; charset=utf-8\nhost:{host}\nx-amz-date:{}\n",
        timestamp.amz_date
    );
    let mut signed_headers = "content-type;host;x-amz-date".to_string();
    if let Some(session_token) = credentials.session_token.as_deref() {
        canonical_headers.push_str(&format!("x-amz-security-token:{session_token}\n"));
        signed_headers.push_str(";x-amz-security-token");
    }
    let payload_hash = byoc_sha256_hex(b"");
    let canonical_request = format!(
        "{method}\n{canonical_uri}\n{canonical_query}\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    );
    let credential_scope = format!("{}/{}/{}/aws4_request", timestamp.date, region, service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        timestamp.amz_date,
        credential_scope,
        byoc_sha256_hex(canonical_request.as_bytes())
    );
    let signing_key = byoc_aws_signing_key(
        credentials.secret_access_key.as_bytes(),
        &timestamp.date,
        region,
        service,
    );
    let signature = byoc_hex(&byoc_hmac_sha256(&signing_key, string_to_sign.as_bytes()));
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        credentials.access_key_id, credential_scope, signed_headers, signature
    );
    AwsSignedGetParts {
        canonical_query,
        authorization,
    }
}

fn byoc_aws_signing_key(secret: &[u8], date: &str, region: &str, service: &str) -> Vec<u8> {
    let k_secret = [b"AWS4".as_slice(), secret].concat();
    let k_date = byoc_hmac_sha256(&k_secret, date.as_bytes());
    let k_region = byoc_hmac_sha256(&k_date, region.as_bytes());
    let k_service = byoc_hmac_sha256(&k_region, service.as_bytes());
    byoc_hmac_sha256(&k_service, b"aws4_request")
}

fn byoc_hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    use hmac::Mac;
    let mut mac =
        hmac::Hmac::<sha2::Sha256>::new_from_slice(key).expect("HMAC accepts keys of any size");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn byoc_sha256_hex(data: &[u8]) -> String {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(data);
    byoc_hex(&hasher.finalize())
}

fn byoc_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn byoc_aws_canonical_query(params: &[(String, String)]) -> String {
    let mut encoded = params
        .iter()
        .map(|(key, value)| (byoc_uri_encode(key), byoc_uri_encode(value)))
        .collect::<Vec<_>>();
    encoded.sort();
    encoded
        .into_iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}

fn byoc_aws_timestamp_now() -> AwsTimestamp {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    byoc_aws_timestamp_from_unix(now)
}

fn byoc_aws_timestamp_from_unix(seconds: i64) -> AwsTimestamp {
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = byoc_civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    AwsTimestamp {
        amz_date: format!("{year:04}{month:02}{day:02}T{hour:02}{minute:02}{second:02}Z"),
        date: format!("{year:04}{month:02}{day:02}"),
    }
}

fn byoc_civil_from_days(days_since_unix_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_unix_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

fn byoc_xml_tag_values(xml: &str, tag: &str) -> Vec<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut values = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(&open) {
        let after_open = &rest[start + open.len()..];
        let Some(end) = after_open.find(&close) else {
            break;
        };
        values.push(byoc_xml_unescape(after_open[..end].trim()));
        rest = &after_open[end + close.len()..];
    }
    values
}

fn byoc_xml_first_tag(xml: &str, tag: &str) -> Option<String> {
    byoc_xml_tag_values(xml, tag).into_iter().next()
}

fn byoc_xml_unescape(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn byoc_gcp_service_account(credentials: &Value) -> Result<GcpServiceAccount, String> {
    let raw = credentials
        .get("serviceAccountJson")
        .ok_or_else(|| "Google Cloud service account JSON is required.".to_string())?;
    let parsed = if let Some(raw) = raw.as_str() {
        serde_json::from_str::<Value>(raw)
            .map_err(|_| "Google Cloud service account JSON is invalid.".to_string())?
    } else {
        raw.clone()
    };
    let project_id = byoc_optional_credential(credentials, "projectId")
        .or_else(|| byoc_optional_credential(&parsed, "project_id"))
        .ok_or_else(|| "Google Cloud project ID is required.".to_string())?;
    let zone = byoc_optional_credential(credentials, "zone")
        .or_else(|| byoc_optional_credential(&parsed, "zone"))
        .unwrap_or_else(|| "us-central1-a".to_string());
    Ok(GcpServiceAccount {
        client_email: byoc_required_credential(&parsed, "client_email")?,
        private_key: byoc_required_credential(&parsed, "private_key")?,
        token_uri: byoc_optional_credential(&parsed, "token_uri")
            .unwrap_or_else(|| "https://oauth2.googleapis.com/token".to_string()),
        project_id,
        zone,
    })
}

fn byoc_gcp_access_token(
    client: &reqwest::blocking::Client,
    account: &GcpServiceAccount,
) -> Result<String, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let claims = GcpJwtClaims {
        iss: account.client_email.clone(),
        scope: "https://www.googleapis.com/auth/compute".to_string(),
        aud: account.token_uri.clone(),
        iat: now,
        exp: now + 3600,
    };
    let key = jsonwebtoken::EncodingKey::from_rsa_pem(account.private_key.as_bytes())
        .map_err(|_| "Google Cloud service account private key is invalid.".to_string())?;
    let jwt = jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
        &claims,
        &key,
    )
    .map_err(|_| "Unable to sign Google Cloud service account JWT.".to_string())?;
    let response = client
        .post(&account.token_uri)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", jwt.as_str()),
        ])
        .send()
        .map_err(|_| "Unable to reach Google OAuth token endpoint.".to_string())?;
    let status = response.status();
    let text = response
        .text()
        .map_err(|_| "Unable to read Google OAuth token response.".to_string())?;
    let body = if text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str::<Value>(&text)
            .map_err(|_| "Google OAuth token endpoint returned invalid JSON.".to_string())?
    };
    if !status.is_success() {
        let message = body
            .get("error_description")
            .and_then(Value::as_str)
            .or_else(|| body.get("error").and_then(Value::as_str))
            .unwrap_or("token exchange failed");
        return Err(byoc_sanitize_error(
            &format!("GCP credentials rejected: {status} {message}"),
            &[account.private_key.as_str()],
        ));
    }
    body.get("access_token")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Google OAuth token response did not include an access token.".to_string())
}

fn byoc_gcp_get_json(
    client: &reqwest::blocking::Client,
    access_token: &str,
    url: &str,
) -> Result<Value, String> {
    let response = client
        .get(url)
        .bearer_auth(access_token)
        .send()
        .map_err(|_| "Unable to reach Google Compute API.".to_string())?;
    byoc_json_response("Google Cloud", response)
}

fn byoc_gcp_source_image(image: &str) -> Result<&'static str, String> {
    match image {
        "ubuntu-2204-lts" | "ubuntu-22.04" => {
            Ok("projects/ubuntu-os-cloud/global/images/family/ubuntu-2204-lts")
        }
        "ubuntu-2404-lts-amd64" | "ubuntu-24.04" => {
            Ok("projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64")
        }
        "debian-12" => Ok("projects/debian-cloud/global/images/family/debian-12"),
        _ => Err("Unsupported Google Cloud image selection.".to_string()),
    }
}

fn byoc_required_string(value: &Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("BYOC request field `{key}` is required."))
}

fn byoc_required_credential(credentials: &Value, key: &str) -> Result<String, String> {
    byoc_optional_credential(credentials, key)
        .ok_or_else(|| format!("Provider credential `{key}` is required."))
}

fn byoc_optional_credential(credentials: &Value, key: &str) -> Option<String> {
    credentials
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn byoc_normalize_provider_id(provider: &str) -> Result<String, String> {
    let provider = provider.trim().to_ascii_lowercase();
    match provider.as_str() {
        "hetzner" | "digitalocean" | "aws" | "gcp" => Ok(provider),
        _ => Err("Unsupported BYOC provider.".to_string()),
    }
}

fn byoc_provider_label(provider: &str) -> String {
    match provider {
        "hetzner" => "Hetzner Cloud",
        "digitalocean" => "DigitalOcean",
        "aws" => "Amazon EC2",
        "gcp" => "Google Cloud",
        _ => provider,
    }
    .to_string()
}

fn byoc_normalize_device_name(value: &str) -> String {
    let mut out = String::new();
    let mut previous_dash = false;
    for character in value.trim().chars() {
        let next = if character.is_ascii_alphanumeric() {
            Some(character.to_ascii_lowercase())
        } else if character == '-' || character == '_' || character.is_whitespace() {
            Some('-')
        } else {
            None
        };
        if let Some(character) = next {
            if character == '-' {
                if previous_dash || out.is_empty() {
                    continue;
                }
                previous_dash = true;
            } else {
                previous_dash = false;
            }
            out.push(character);
        }
        if out.len() >= 63 {
            break;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() || !out.as_bytes()[0].is_ascii_alphabetic() {
        out = format!("byoc-{out}");
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.len() > 63 {
        out.truncate(63);
        while out.ends_with('-') {
            out.pop();
        }
    }
    if out == "byoc" {
        "byoc-server".to_string()
    } else {
        out
    }
}

fn byoc_format_gb(value: f64) -> String {
    if (value.fract()).abs() < f64::EPSILON {
        format!("{}GB", value as u64)
    } else {
        format!("{value:.1}GB")
    }
}

fn byoc_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn byoc_sanitize_error(message: &str, secrets: &[&str]) -> String {
    let mut sanitized = message.to_string();
    for secret in secrets {
        let secret = secret.trim();
        if secret.len() >= 4 {
            sanitized = sanitized.replace(secret, "[redacted]");
        }
    }
    let sensitive_markers = [
        "dfprov_",
        "Authorization:",
        "Bearer ",
        "access_token",
        "secretAccessKey",
        "private_key",
    ];
    for marker in sensitive_markers {
        if let Some(index) = sanitized.find(marker) {
            sanitized.truncate(index);
            sanitized.push_str("[redacted]");
        }
    }
    sanitized
        .chars()
        .filter(|character| !matches!(character, '\r' | '\n' | '\0'))
        .collect()
}

fn byoc_uri_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn byoc_url_path_segment(value: &str) -> String {
    byoc_uri_encode(value)
}

#[cfg(test)]
mod byoc_tests {
    use super::*;

    #[test]
    fn byoc_cloud_init_embeds_token_base_systemd_and_xvfb() {
        let user_data = byoc_cloud_init_user_data(
            "dfprov_test_token",
            "https://staging.example/api",
            "byoc-hetzner-abc12",
        );
        assert!(user_data.contains("#cloud-config"));
        assert!(user_data.contains("DIFFFORGE_PROVISION_TOKEN=dfprov_test_token"));
        assert!(user_data.contains("DIFFFORGE_API_BASE_URL=https://staging.example/api"));
        assert!(user_data.contains("/etc/systemd/system/diffforge-daemon.service"));
        assert!(user_data.contains("ExecStart=/usr/bin/xvfb-run -a $BIN daemon"));
        assert!(user_data.contains("systemctl enable --now diffforge-daemon.service"));
        assert!(user_data.contains("hostnamectl set-hostname \"byoc-hetzner-abc12\""));
    }

    #[test]
    fn byoc_gcp_startup_script_embeds_token_base_and_systemd() {
        let script = byoc_gcp_startup_script(
            "dfprov_test_token",
            "https://staging.example/api",
            "byoc-gcp-abc12",
        );
        assert!(script.starts_with("#!/usr/bin/env bash"));
        assert!(script.contains("DIFFFORGE_PROVISION_TOKEN=dfprov_test_token"));
        assert!(script.contains("DIFFFORGE_API_BASE_URL=https://staging.example/api"));
        assert!(script.contains("ExecStart=/usr/bin/xvfb-run -a $BIN daemon"));
        assert!(script.contains("hostnamectl set-hostname \"byoc-gcp-abc12\""));
        // Idempotent on GCP's every-boot startup-script semantics.
        assert!(script.contains("if [ -f /etc/systemd/system/diffforge-daemon.service ]"));
    }

    #[test]
    fn byoc_aws_sigv4_matches_aws_iam_get_vector() {
        let credentials = AwsCredentials {
            access_key_id: "AKIDEXAMPLE".to_string(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY".to_string(),
            session_token: None,
        };
        let timestamp = AwsTimestamp {
            amz_date: "20150830T123600Z".to_string(),
            date: "20150830".to_string(),
        };
        let params = vec![
            ("Action".to_string(), "ListUsers".to_string()),
            ("Version".to_string(), "2010-05-08".to_string()),
        ];
        let signed = byoc_aws_signed_get_parts(
            "GET",
            "iam.amazonaws.com",
            "/",
            &params,
            "iam",
            "us-east-1",
            &credentials,
            &timestamp,
        );
        assert_eq!(
            signed.canonical_query,
            "Action=ListUsers&Version=2010-05-08"
        );
        assert!(signed.authorization.contains(
            "Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7"
        ));
    }

    #[test]
    fn byoc_hetzner_server_types_parse_to_sizes() {
        let sizes = byoc_hetzner_sizes_from_value(&json!({
            "server_types": [
                {
                    "name": "cx22",
                    "cores": 2,
                    "memory": 4.0,
                    "disk": 40,
                    "architecture": "x86",
                    "cpu_type": "shared",
                    "category": "Shared vCPU",
                    "deprecated": false,
                    "prices": [{"price_monthly": {"gross": "3.79"}}]
                },
                {
                    "name": "cax11",
                    "cores": 2,
                    "memory": 4.0,
                    "disk": 40,
                    "architecture": "arm",
                    "cpu_type": "shared",
                    "category": "Shared vCPU",
                    "deprecated": false
                },
                {
                    "name": "cx11",
                    "cores": 1,
                    "memory": 2.0,
                    "disk": 20,
                    "architecture": "x86",
                    "cpu_type": "shared",
                    "category": "Shared vCPU",
                    "deprecated": true
                }
            ]
        }));
        assert_eq!(sizes.len(), 1);
        assert_eq!(sizes[0]["id"], "cx22");
        assert_eq!(sizes[0]["label"], "cx22 \u{00b7} 2 vCPU \u{00b7} 4GB");
        assert_eq!(sizes[0]["priceHint"], "\u{20ac}3.79/mo");
    }

    #[test]
    fn byoc_saved_providers_masks_credentials() {
        let output = byoc_saved_providers_from_state(&json!({
            "providers": {
                "hetzner": {
                    "provider": "hetzner",
                    "label": "Hetzner Cloud",
                    "savedAtMs": 1234,
                    "credentials": {
                        "apiToken": "super-secret-token-123456",
                        "region": "fsn1"
                    }
                }
            }
        }));
        let provider = &output["providers"][0];
        assert_eq!(provider["provider"], "hetzner");
        assert_eq!(provider["credentialSummary"]["apiToken"], "****3456");
        assert_eq!(provider["credentialSummary"]["region"], "present");
        assert!(provider["credentials"].is_null());
    }

    #[test]
    fn byoc_app_local_state_public_value_redacts_saved_credentials() {
        let output = app_local_state_public_value(
            BYOC_PROVIDERS_STATE_KEY,
            json!({
                "providers": {
                    "aws": {
                        "provider": "aws",
                        "label": "Amazon EC2",
                        "savedAtMs": 42,
                        "credentials": {
                            "accessKeyId": "AKIAEXAMPLE1234",
                            "secretAccessKey": "very-secret-value-9876"
                        }
                    }
                }
            }),
        );
        assert_eq!(
            output["providers"][0]["credentialSummary"]["secretAccessKey"],
            "****9876"
        );
        assert!(output["providers"][0]["credentials"].is_null());
    }

    #[test]
    fn byoc_aliased_state_key_still_redacts() {
        // "byoc.providers"/"byoc/providers" canonicalize to the same file as
        // "byoc-providers"; redaction must key on the canonical form so an
        // aliased key can't return raw secrets to JS (C1 regression).
        let raw = json!({
            "providers": {
                "hetzner": {
                    "provider": "hetzner",
                    "credentials": { "apiToken": "super-secret-token-123456" }
                }
            }
        });
        for aliased in ["byoc.providers", "byoc/providers", "BYOC Providers"] {
            assert_eq!(
                app_local_state_canonical_key(aliased),
                BYOC_PROVIDERS_STATE_KEY,
                "alias {aliased} must canonicalize to the byoc key"
            );
            let output = app_local_state_public_value(aliased, raw.clone());
            assert!(
                output["providers"][0]["credentials"].is_null(),
                "alias {aliased} leaked raw credentials"
            );
            assert!(app_local_state_is_byoc_providers_key(aliased));
        }
    }
}

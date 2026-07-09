// Agent account profiles: manual multi-account switching for the coding
// agent CLIs (Claude Code, Codex).
//
// A profile is a pointer to an isolated CLI home directory. There is no
// manual "add account" flow: a background watcher pins every authenticated
// identity it sees in the default CLI homes into its own snapshot profile
// (credential files copied while they are still valid), so logging into
// another account in any terminal captures the previous one before the new
// login overwrites it — both stay switchable afterwards. Keychain-only
// Claude installs are the one gap: their snapshot carries identity but the
// OAuth token stays in the Keychain entry keyed to the source dir, so the
// pinned profile shows "needs login" until used once. The registry holds
// one `activeProfileId` per agent kind: NEW terminal spawns bind to it via
// env (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`), already-running panes keep the
// account they were born with, and the webview shows a restart chip when a
// pane's stamped profile no longer matches the active one. Switching is
// always an explicit user action — there is deliberately no automatic
// rotation on rate limits.

const AGENT_ACCOUNTS_CHANGED_EVENT: &str = "agent-accounts-changed";
const AGENT_ACCOUNTS_FILE: &str = "agent-accounts.json";
const AGENT_ACCOUNTS_PROFILE_DIR: &str = "agent-profiles";
const AGENT_ACCOUNTS_DEFAULT_PROFILE_ID: &str = "default";
const AGENT_ACCOUNTS_AUTH_ISSUE_KEY: &str = "authIssue";
const AGENT_ACCOUNTS_DEFAULT_AUTH_ISSUE_KEY: &str = "defaultAuthIssue";
const AGENT_ACCOUNTS_AUTH_SCAN_MAX_CHARS: usize = 4096;
const AGENT_ACCOUNT_PUSH_CHANGED_EVENT: &str = "agent-account-push-changed";
const AGENT_ACCOUNT_PUSH_KEY_FILE: &str = "agent-account-push-key.json";
const AGENT_ACCOUNT_PUSH_TRUSTED_KEYS_FILE: &str = "agent-account-push-trusted-keys.json";
pub(crate) const AGENT_ACCOUNT_PUSH_SEALED_ALGORITHM: &str = "x25519-sealedbox-v1";
const AGENT_ACCOUNT_PUSH_KEY_BYTES: usize = 32;
const AGENT_ACCOUNT_PUSH_MAX_FILE_BYTES: u64 = 1024 * 1024;
const AGENT_ACCOUNT_PUSH_MAX_BLOB_BYTES: usize = 4 * 1024 * 1024;
const AGENT_ACCOUNT_PUSH_CONTRACT: &str = "diffforge.agent_account_push.v1";
const AGENT_ACCOUNT_PUSH_BLOB_TTL_MS: u64 = 5 * 60 * 1000;
const AGENT_ACCOUNT_PUSH_APPLIED_MAX: usize = 256;

static AGENT_ACCOUNTS_PANE_PROFILES: OnceLock<StdMutex<HashMap<String, Value>>> = OnceLock::new();
static AGENT_ACCOUNT_PUSH_PENDING: OnceLock<StdMutex<HashMap<String, AgentAccountPushPending>>> =
    OnceLock::new();
static AGENT_ACCOUNT_PUSH_APPLIED: OnceLock<StdMutex<HashMap<String, u64>>> = OnceLock::new();
static AGENT_ACCOUNT_PUSH_KEY_FILE_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static AGENT_ACCOUNT_PUSH_KEY_FILE_CACHE: OnceLock<StdMutex<Option<(PathBuf, AgentAccountPushKeyFile)>>> =
    OnceLock::new();

#[derive(Clone)]
pub(crate) struct AgentAccountPushPublicKeyMetadata {
    pub public_key_b64: String,
    pub algorithm: String,
}

#[derive(Clone)]
struct AgentAccountPushPending {
    agent_kind: String,
    profile_id: String,
    target_device_id: String,
    wipe_local_after: bool,
    identity_email: String,
    delivered: bool,
}

#[derive(Clone, Serialize, Deserialize)]
struct AgentAccountPushKeyFile {
    version: u8,
    algorithm: String,
    private_key_b64: String,
    public_key_b64: String,
    created_at_ms: u64,
}

#[derive(Serialize, Deserialize)]
struct AgentAccountPushBlob {
    version: u8,
    contract: String,
    push_id: String,
    target_device_id: String,
    sender_device_id: String,
    issued_at_ms: u64,
    expires_at_ms: u64,
    agent_kind: String,
    source_profile_id: String,
    identity_email: String,
    label: String,
    alias: String,
    files: Vec<AgentAccountPushFile>,
}

#[derive(Serialize, Deserialize)]
struct AgentAccountPushFile {
    name: String,
    data_b64: String,
}

fn agent_account_push_pending() -> &'static StdMutex<HashMap<String, AgentAccountPushPending>> {
    AGENT_ACCOUNT_PUSH_PENDING.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn agent_account_push_applied() -> &'static StdMutex<HashMap<String, u64>> {
    AGENT_ACCOUNT_PUSH_APPLIED.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn agent_account_push_key_path() -> Result<PathBuf, String> {
    let state_dir = cloud_mcp_native_data_root()
        .ok_or_else(|| "Unable to resolve Diff Forge device data directory.".to_string())?
        .join(DEVICE_APP_STATE_DIR);
    fs::create_dir_all(&state_dir)
        .map_err(|error| format!("Unable to create agent account push key directory: {error}"))?;
    Ok(state_dir.join(AGENT_ACCOUNT_PUSH_KEY_FILE))
}

fn agent_account_push_random_32() -> Result<[u8; AGENT_ACCOUNT_PUSH_KEY_BYTES], String> {
    let mut bytes = [0_u8; AGENT_ACCOUNT_PUSH_KEY_BYTES];
    getrandom::getrandom(&mut bytes)
        .map_err(|error| format!("Unable to generate secure random bytes: {error}"))?;
    Ok(bytes)
}

fn agent_account_push_write_private_json(path: &Path, value: &AgentAccountPushKeyFile) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Unable to encode agent account push key: {error}"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create agent account push key directory: {error}"))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(path)
            .map_err(|error| format!("Unable to open agent account push key: {error}"))?;
        file.write_all(&bytes)
            .map_err(|error| format!("Unable to write agent account push key: {error}"))?;
        let _ = fs::set_permissions(path, std::os::unix::fs::PermissionsExt::from_mode(0o600));
        return Ok(());
    }
    #[cfg(not(unix))]
    {
        fs::write(path, bytes)
            .map_err(|error| format!("Unable to write agent account push key: {error}"))?;
        Ok(())
    }
}

fn agent_account_push_read_or_create_key_file() -> Result<AgentAccountPushKeyFile, String> {
    let _guard = AGENT_ACCOUNT_PUSH_KEY_FILE_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .map_err(|_| "Agent account push key lock is unavailable.".to_string())?;
    let path = agent_account_push_key_path()?;
    let cache = AGENT_ACCOUNT_PUSH_KEY_FILE_CACHE.get_or_init(|| StdMutex::new(None));
    {
        let cache = cache
            .lock()
            .map_err(|_| "Agent account push key cache is unavailable.".to_string())?;
        if let Some((cached_path, cached_file)) = cache.as_ref() {
            if cached_path == &path {
                return Ok(cached_file.clone());
            }
        }
    }
    let file = agent_account_push_read_or_create_key_file_uncached(&path)?;
    let mut cache = cache
        .lock()
        .map_err(|_| "Agent account push key cache is unavailable.".to_string())?;
    *cache = Some((path, file.clone()));
    Ok(file)
}

fn agent_account_push_read_or_create_key_file_uncached(path: &Path) -> Result<AgentAccountPushKeyFile, String> {
    match fs::read_to_string(&path) {
        Ok(raw) => {
            let file = serde_json::from_str::<AgentAccountPushKeyFile>(&raw)
                .map_err(|_| "Stored agent account push key is not valid JSON; refusing to rotate it automatically.".to_string())?;
            if file.algorithm != AGENT_ACCOUNT_PUSH_SEALED_ALGORITHM {
                return Err("Stored agent account push key uses an unsupported algorithm; refusing to rotate it automatically.".to_string());
            }
            let private_key = general_purpose::STANDARD
                .decode(&file.private_key_b64)
                .map_err(|_| "Stored agent account push private key is invalid; refusing to rotate it automatically.".to_string())?;
            if private_key.len() != AGENT_ACCOUNT_PUSH_KEY_BYTES {
                return Err("Stored agent account push private key is invalid; refusing to rotate it automatically.".to_string());
            }
            let public_key = general_purpose::STANDARD
                .decode(&file.public_key_b64)
                .map_err(|_| "Stored agent account push public key is invalid; refusing to rotate it automatically.".to_string())?;
            if public_key.len() != AGENT_ACCOUNT_PUSH_KEY_BYTES {
                return Err("Stored agent account push public key is invalid; refusing to rotate it automatically.".to_string());
            }
            let derived_public_key = crypto_box::SecretKey::from_slice(&private_key)
                .map_err(|_| "Stored agent account push private key is invalid; refusing to rotate it automatically.".to_string())?
                .public_key();
            if derived_public_key.as_bytes() != public_key.as_slice() {
                return Err("Stored agent account push keypair does not match; refusing to rotate it automatically.".to_string());
            }
            Ok(file)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let secret = crypto_box::SecretKey::from(agent_account_push_random_32()?);
            let private_key = secret.to_bytes();
            let public_key = secret.public_key();
            let file = AgentAccountPushKeyFile {
                version: 1,
                algorithm: AGENT_ACCOUNT_PUSH_SEALED_ALGORITHM.to_string(),
                private_key_b64: general_purpose::STANDARD.encode(private_key),
                public_key_b64: general_purpose::STANDARD.encode(public_key.as_bytes()),
                created_at_ms: todo_dispatch_now_ms(),
            };
            agent_account_push_write_private_json(&path, &file)?;
            Ok(file)
        }
        Err(error) => Err(format!("Unable to read agent account push key: {error}")),
    }
}

pub(crate) fn agent_account_push_public_key_metadata(
) -> Result<AgentAccountPushPublicKeyMetadata, String> {
    let file = agent_account_push_read_or_create_key_file()?;
    Ok(AgentAccountPushPublicKeyMetadata {
        public_key_b64: file.public_key_b64,
        algorithm: file.algorithm,
    })
}

fn agent_account_push_local_private_key() -> Result<crypto_box::SecretKey, String> {
    let file = agent_account_push_read_or_create_key_file()?;
    let bytes = general_purpose::STANDARD
        .decode(file.private_key_b64)
        .map_err(|_| "Stored agent account push private key is not valid base64.".to_string())?;
    crypto_box::SecretKey::from_slice(&bytes)
        .map_err(|_| "Stored agent account push private key has the wrong length.".to_string())
}

fn agent_account_push_seal_blob(
    recipient_public_key_b64: &str,
    plaintext: &[u8],
) -> Result<String, String> {
    let recipient_public_key = general_purpose::STANDARD
        .decode(recipient_public_key_b64.trim())
        .map_err(|_| "Target device push public key is not valid base64.".to_string())?;
    let recipient_public_key = crypto_box::PublicKey::from_slice(&recipient_public_key)
        .map_err(|_| "Target device push public key has the wrong length.".to_string())?;
    let sealed = recipient_public_key
        .seal(&mut crypto_box::aead::OsRng, plaintext)
        .map_err(|_| "Unable to seal agent account credentials for target device.".to_string())?;
    if sealed.len() > AGENT_ACCOUNT_PUSH_MAX_BLOB_BYTES {
        return Err("Agent account push payload is too large.".to_string());
    }
    Ok(general_purpose::STANDARD.encode(sealed))
}

fn agent_account_push_open_blob(sealed_blob_b64: &str) -> Result<Vec<u8>, String> {
    let sealed = general_purpose::STANDARD
        .decode(sealed_blob_b64.trim())
        .map_err(|_| "Agent account push payload is not valid base64.".to_string())?;
    if sealed.len() > AGENT_ACCOUNT_PUSH_MAX_BLOB_BYTES {
        return Err("Agent account push payload is too large.".to_string());
    }

    let private_key = agent_account_push_local_private_key()?;
    private_key
        .unseal(&sealed)
        .map_err(|_| "Unable to open sealed agent account push payload.".to_string())
}

fn agent_account_push_emit(
    app: &AppHandle,
    push_id: &str,
    target_device_id: &str,
    agent_kind: &str,
    profile_id: &str,
    state: &str,
    message: Option<&str>,
) {
    let mut payload = json!({
        "pushId": push_id,
        "push_id": push_id,
        "targetDeviceId": target_device_id,
        "target_device_id": target_device_id,
        "agentKind": agent_kind,
        "agent_kind": agent_kind,
        "profileId": profile_id,
        "profile_id": profile_id,
        "state": state,
    });
    if let Some(message) = message.filter(|value| !value.trim().is_empty()) {
        payload["message"] = json!(message);
    }
    let _ = app.emit(AGENT_ACCOUNT_PUSH_CHANGED_EVENT, payload);
}

fn agent_account_push_emit_optional(
    app: Option<&AppHandle>,
    push_id: &str,
    target_device_id: &str,
    agent_kind: &str,
    profile_id: &str,
    state: &str,
    message: Option<&str>,
) {
    if let Some(app) = app {
        agent_account_push_emit(
            app,
            push_id,
            target_device_id,
            agent_kind,
            profile_id,
            state,
            message,
        );
    }
}

fn agent_account_push_status_text(event: &Value, keys: &[&str]) -> Option<String> {
    cloud_mcp_payload_text(event, keys)
        .or_else(|| {
            keys.iter()
                .find_map(|key| cloud_mcp_payload_text(event, &["payload", key]))
        })
        .or_else(|| {
            keys.iter()
                .find_map(|key| cloud_mcp_payload_text(event, &["details", key]))
        })
        .or_else(|| {
            keys.iter()
                .find_map(|key| cloud_mcp_payload_text(event, &["result", key]))
        })
}

fn agent_account_push_status_push_id(event: &Value) -> Option<String> {
    agent_account_push_status_text(event, &["push_id", "pushId", "intent_id", "intentId"])
        .or_else(|| {
            cloud_mcp_remote_command_field_text(event, &["command_id", "commandId"]).and_then(
                |command_id| {
                    command_id
                        .strip_prefix("agent-account-push-")
                        .map(str::to_string)
                },
            )
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn agent_account_push_status_reporting_device_id(event: &Value) -> Option<String> {
    agent_account_push_status_text(event, &["device_id", "deviceId", "machine_id", "machineId"])
        .or_else(|| cloud_mcp_payload_text(event, &["device", "device_id"]))
        .or_else(|| cloud_mcp_payload_text(event, &["device", "deviceId"]))
        .or_else(|| cloud_mcp_payload_text(event, &["payload", "device", "device_id"]))
        .or_else(|| cloud_mcp_payload_text(event, &["payload", "device", "deviceId"]))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn agent_account_push_status_matches_pending(
    event: &Value,
    push_id: &str,
    pending: &AgentAccountPushPending,
) -> bool {
    let expected_command_id = format!("agent-account-push-{push_id}");
    let command_id = cloud_mcp_remote_command_field_text(event, &["command_id", "commandId"])
        .unwrap_or_default();
    if command_id != expected_command_id {
        return false;
    }
    let Some(reporting_device_id) = agent_account_push_status_reporting_device_id(event) else {
        return false;
    };
    agent_account_push_normalized_device_id(&reporting_device_id)
        == agent_account_push_normalized_device_id(&pending.target_device_id)
}

fn agent_account_push_handle_remote_status_inner(app: Option<&AppHandle>, event: &Value) -> bool {
    let event_kind =
        cloud_mcp_payload_text(event, &["event_kind", "eventKind", "kind"]).unwrap_or_default();
    if !matches!(
        event_kind.as_str(),
        "remote_command_ack" | "remote_command_result"
    ) {
        return false;
    }
    let command_kind =
        cloud_mcp_remote_command_field_text(event, &["command_kind", "commandKind"])
            .unwrap_or_default()
            .to_ascii_lowercase()
            .replace(['.', ' ', '-'], "_");
    if command_kind != "agent_account_push" {
        return false;
    }
    let Some(push_id) = agent_account_push_status_push_id(event) else {
        return true;
    };
    let status = cloud_mcp_payload_text(event, &["status"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    match status.as_str() {
        "received" | "accepted" | "queued" | "delivered" => {
            let pending = agent_account_push_pending()
                .lock()
                .ok()
                .and_then(|mut pending| {
                    let entry = pending.get_mut(&push_id)?;
                    if !agent_account_push_status_matches_pending(event, &push_id, entry) {
                        return None;
                    }
                    if entry.delivered {
                        return None;
                    }
                    entry.delivered = true;
                    Some(entry.clone())
                });
            if let Some(pending) = pending {
                agent_account_push_emit_optional(
                    app,
                    &push_id,
                    &pending.target_device_id,
                    &pending.agent_kind,
                    &pending.profile_id,
                    "delivered",
                    None,
                );
            }
            true
        }
        "completed" => {
            let pending = agent_account_push_pending()
                .lock()
                .ok()
                .and_then(|mut pending| {
                    let entry = pending.get(&push_id)?;
                    if !agent_account_push_status_matches_pending(event, &push_id, entry) {
                        return None;
                    }
                    pending.remove(&push_id)
                });
            let Some(pending) = pending else {
                return true;
            };
            if !pending.delivered {
                agent_account_push_emit_optional(
                    app,
                    &push_id,
                    &pending.target_device_id,
                    &pending.agent_kind,
                    &pending.profile_id,
                    "delivered",
                    None,
                );
            }
            agent_account_push_emit_optional(
                app,
                &push_id,
                &pending.target_device_id,
                &pending.agent_kind,
                &pending.profile_id,
                "applied",
                None,
            );
            if pending.wipe_local_after {
                if let Some(app_handle) = app.cloned() {
                    let push_id_for_wipe = push_id.clone();
                    let pending_for_wipe = pending.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        match agent_accounts_wipe_pushed_profile_internal(
                            Some(&app_handle),
                            &pending_for_wipe.agent_kind,
                            &pending_for_wipe.profile_id,
                            &pending_for_wipe.identity_email,
                        ) {
                            Ok(_) => agent_account_push_emit(
                                &app_handle,
                                &push_id_for_wipe,
                                &pending_for_wipe.target_device_id,
                                &pending_for_wipe.agent_kind,
                                &pending_for_wipe.profile_id,
                                "wiped",
                                None,
                            ),
                            Err(error) => agent_account_push_emit(
                                &app_handle,
                                &push_id_for_wipe,
                                &pending_for_wipe.target_device_id,
                                &pending_for_wipe.agent_kind,
                                &pending_for_wipe.profile_id,
                                "failed",
                                Some(&format!(
                                    "Account was applied on the target device, but local wipe failed: {error}"
                                )),
                            ),
                        }
                    });
                } else {
                    match agent_accounts_wipe_pushed_profile_internal(
                        None,
                        &pending.agent_kind,
                        &pending.profile_id,
                        &pending.identity_email,
                    ) {
                        Ok(_) => agent_account_push_emit_optional(
                            app,
                            &push_id,
                            &pending.target_device_id,
                            &pending.agent_kind,
                            &pending.profile_id,
                            "wiped",
                            None,
                        ),
                        Err(error) => agent_account_push_emit_optional(
                            app,
                            &push_id,
                            &pending.target_device_id,
                            &pending.agent_kind,
                            &pending.profile_id,
                            "failed",
                            Some(&format!(
                                "Account was applied on the target device, but local wipe failed: {error}"
                            )),
                        ),
                    }
                }
            }
            true
        }
        "failed" | "error" | "rejected" | "cancelled" | "canceled" | "timed_out" | "timeout" => {
            let pending = agent_account_push_pending()
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&push_id));
            if let Some(pending) = pending {
                let message = cloud_mcp_payload_text(event, &["message"])
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "Agent account push failed on the target device.".to_string());
                agent_account_push_emit_optional(
                    app,
                    &push_id,
                    &pending.target_device_id,
                    &pending.agent_kind,
                    &pending.profile_id,
                    "failed",
                    Some(&message),
                );
            }
            true
        }
        _ => true,
    }
}

pub(crate) fn agent_account_push_handle_remote_status(app: &AppHandle, event: &Value) -> bool {
    agent_account_push_handle_remote_status_inner(Some(app), event)
}

fn agent_accounts_file_path() -> Option<PathBuf> {
    cloud_mcp_local_data_file_path(AGENT_ACCOUNTS_FILE)
}

fn agent_accounts_supported_kind(kind: &str) -> Option<&'static str> {
    let normalized = kind.trim().to_ascii_lowercase();
    if normalized.contains("claude") {
        return Some("claude");
    }
    if normalized.contains("codex") || normalized == "console" {
        return Some("codex");
    }
    if normalized.contains("opencode") {
        return Some("opencode");
    }
    None
}

/// OpenCode's auth.json is provider-keyed API keys with no email, so derive a
/// stable non-secret identity from the configured key (preferring the Go plan
/// key). This lets the email-keyed multi-account machinery dedupe/pin OpenCode
/// accounts the same way it does Claude/Codex.
fn agent_accounts_opencode_identity_from_auth(auth: &Value) -> String {
    let key = auth
        .get("opencode-go")
        .and_then(|entry| entry.get("key"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .or_else(|| {
            auth.as_object().and_then(|providers| {
                providers
                    .values()
                    .filter_map(|entry| entry.get("key").and_then(Value::as_str).map(str::trim))
                    .find(|key| !key.is_empty())
            })
        });
    match key {
        Some(key) => format!("opencode-go-{}", cloud_mcp_short_hash(key)),
        None => String::new(),
    }
}

/// Canonical OpenCode data home (where auth.json + opencode.db live). Prefers an
/// existing candidate, else the first by OpenCode's own resolution order.
fn agent_accounts_opencode_default_home() -> Option<PathBuf> {
    let candidates = opencode_data_home();
    candidates
        .iter()
        .find(|path| path.exists())
        .cloned()
        .or_else(|| candidates.into_iter().next())
}

fn agent_accounts_registry_read() -> Value {
    agent_accounts_file_path()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({ "agents": {} }))
}

fn agent_accounts_registry_write(registry: &Value) {
    let Some(path) = agent_accounts_file_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(registry) {
        let _ = fs::write(path, bytes);
    }
}

fn agent_accounts_kind_entry(registry: &Value, kind: &str) -> (String, Vec<Value>) {
    let entry = registry.get("agents").and_then(|agents| agents.get(kind));
    let active = entry
        .and_then(|entry| entry.get("activeProfileId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(AGENT_ACCOUNTS_DEFAULT_PROFILE_ID)
        .to_string();
    let profiles = entry
        .and_then(|entry| entry.get("profiles"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    (active, profiles)
}

fn agent_accounts_default_home(kind: &str) -> Option<PathBuf> {
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)?;
    Some(match kind {
        "claude" => home.join(".claude"),
        "opencode" => {
            return agent_accounts_opencode_default_home();
        }
        _ => home.join(".codex"),
    })
}

/// Identity probe for one profile dir. Reads only non-secret metadata the
/// CLIs leave beside their credentials; on macOS the OAuth token itself lives
/// in the Keychain and is deliberately not touched.
fn agent_accounts_profile_identity(kind: &str, dir: Option<&Path>) -> Value {
    match kind {
        "claude" => {
            // With CLAUDE_CONFIG_DIR set, `.claude.json` lives inside the
            // profile dir; the default account keeps it at `~/.claude.json`.
            let state_path = match dir {
                Some(dir) => dir.join(".claude.json"),
                None => match env::var_os("HOME").map(PathBuf::from) {
                    Some(home) => home.join(".claude.json"),
                    None => return json!({ "email": "", "authReady": false }),
                },
            };
            let state = fs::read_to_string(&state_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
            let email = state
                .as_ref()
                .and_then(|state| state.pointer("/oauthAccount/emailAddress"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let display_name = state
                .as_ref()
                .and_then(|state| state.pointer("/oauthAccount/displayName"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            // The oauth-derived tokenomics key lets the usage view fold
            // historical rows (keyed by account hash OR by legacy profile id)
            // into this profile's account group.
            let tokenomics_account_key = state
                .as_ref()
                .and_then(tokenomics_claude_account_key_for_claude_config)
                .unwrap_or_default();
            let credentials_present = dir
                .map(|dir| dir.join(".credentials.json").is_file())
                .unwrap_or_else(|| {
                    agent_accounts_default_home("claude")
                        .map(|home| home.join(".credentials.json").is_file())
                        .unwrap_or(false)
                });
            let auth_ready = !email.is_empty() || credentials_present;
            json!({
                "email": email,
                "authReady": auth_ready,
                "displayName": display_name,
                "tokenomicsAccountKey": tokenomics_account_key,
            })
        }
        "opencode" => {
            let auth_path = match dir {
                Some(dir) => dir.join("auth.json"),
                None => match agent_accounts_default_home("opencode") {
                    Some(home) => home.join("auth.json"),
                    None => return json!({ "email": "", "authReady": false }),
                },
            };
            let auth = fs::read_to_string(&auth_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
            // The synthetic "email" is a stable key fingerprint, which the
            // dedupe/capture machinery treats as the account identity.
            let identity = auth
                .as_ref()
                .map(agent_accounts_opencode_identity_from_auth)
                .unwrap_or_default();
            let auth_ready = auth
                .as_ref()
                .and_then(Value::as_object)
                .is_some_and(|providers| !providers.is_empty());
            json!({ "email": identity, "authReady": auth_ready })
        }
        _ => {
            let auth_path = match dir {
                Some(dir) => dir.join("auth.json"),
                None => match agent_accounts_default_home("codex") {
                    Some(home) => home.join("auth.json"),
                    None => return json!({ "email": "", "authReady": false }),
                },
            };
            let auth = fs::read_to_string(&auth_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
            let email = auth
                .as_ref()
                .map(agent_accounts_codex_email_from_auth)
                .unwrap_or_default();
            json!({ "email": email, "authReady": auth.is_some() })
        }
    }
}

/// Codex `auth.json` carries the account email inside the OIDC id token; the
/// payload segment is plain base64url JSON — no signature use, display only.
fn agent_accounts_codex_email_from_auth(auth: &Value) -> String {
    if let Some(email) = auth
        .pointer("/tokens/email")
        .or_else(|| auth.get("email"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return email.to_string();
    }
    let Some(id_token) = auth
        .pointer("/tokens/id_token")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    else {
        return String::new();
    };
    let Some(payload_b64) = id_token.split('.').nth(1) else {
        return String::new();
    };
    general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|claims| {
            claims
                .get("email")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default()
}

fn agent_accounts_login_command(kind: &str, dir: &str) -> String {
    match kind {
        "claude" => format!("CLAUDE_CONFIG_DIR=\"{dir}\" claude"),
        "opencode" => format!("OPENCODE_DATA_DIR=\"{dir}\" opencode auth login"),
        _ => format!("CODEX_HOME=\"{dir}\" codex login"),
    }
}

fn agent_accounts_profile_view(kind: &str, profile: &Value, active_id: &str) -> Value {
    let id = profile
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let dir = profile
        .get("dir")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let identity = agent_accounts_profile_identity(kind, Some(Path::new(&dir)));
    let auth_status = agent_accounts_auth_status(
        kind,
        &id,
        Some(profile),
        &identity,
        profile.get(AGENT_ACCOUNTS_AUTH_ISSUE_KEY),
    );
    json!({
        "id": id,
        "label": profile.get("label").and_then(Value::as_str).unwrap_or_default(),
        "alias": profile.get("alias").and_then(Value::as_str).unwrap_or_default(),
        "showAlias": profile.get("showAlias").and_then(Value::as_bool).unwrap_or(true),
        "showEmail": profile.get("showEmail").and_then(Value::as_bool).unwrap_or(true),
        "source": profile.get("source").and_then(Value::as_str).unwrap_or("manual"),
        "dir": dir,
        "createdAtMs": profile.get("createdAtMs").and_then(Value::as_u64).unwrap_or(0),
        "identity": identity,
        "authStatus": auth_status,
        "isDefault": false,
        "isActive": id == active_id,
        "loginCommand": agent_accounts_login_command(kind, &dir),
    })
}

/// The name everything outside the pill renderer uses for a profile —
/// tokenomics account rows and the stale-terminal chips. A user alias wins
/// over the captured label.
fn agent_accounts_profile_display_label(profile: &Value) -> String {
    if let Some(alias) = profile
        .get("alias")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return alias.to_string();
    }
    profile
        .get("label")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Account")
        .to_string()
}

fn agent_accounts_profile_alias(profile: &Value) -> Option<String> {
    profile
        .get("alias")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// A profile that shows the exact account the Default pill currently holds is
/// pure noise — one email must never render or publish tokenomics as two
/// accounts. The profile is hidden, not deleted: its snapshot keeps refreshing
/// and reappears the moment the default home moves to a different login.
fn agent_accounts_profile_is_duplicate_of_default(
    kind: &str,
    profile: &Value,
    default_email: &str,
) -> bool {
    if default_email.is_empty() {
        return false;
    }
    agent_accounts_profile_email(kind, profile) == default_email
}

fn agent_accounts_canonical_profile_ids_by_email(
    kind: &str,
    profiles: &[Value],
    active_id: &str,
    default_email: &str,
) -> HashSet<String> {
    let mut by_email: HashMap<String, String> = HashMap::new();
    let mut ids = HashSet::new();
    for profile in profiles {
        let Some(id) = agent_accounts_profile_id(profile) else {
            continue;
        };
        let email = agent_accounts_profile_email(kind, profile);
        if email.is_empty() {
            ids.insert(id);
            continue;
        }
        if !default_email.is_empty() && email == default_email {
            if id == active_id {
                ids.insert(id);
            }
            continue;
        }
        match by_email.entry(email) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(id);
            }
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                if id == active_id && entry.get() != active_id {
                    entry.insert(id);
                }
            }
        }
    }
    ids.extend(by_email.into_values());
    ids
}

fn agent_accounts_profile_id_for_email(
    kind: &str,
    profiles: &[Value],
    email: &str,
) -> Option<String> {
    if email.is_empty() {
        return None;
    }
    profiles.iter().find_map(|profile| {
        let id = agent_accounts_profile_id(profile)?;
        (agent_accounts_profile_email(kind, profile) == email).then_some(id)
    })
}

fn agent_accounts_effective_active_profile_id(
    kind: &str,
    active_id: &str,
    profiles: &[Value],
    default_email: &str,
) -> String {
    if active_id != AGENT_ACCOUNTS_DEFAULT_PROFILE_ID
        && profiles.iter().any(|profile| {
            agent_accounts_profile_id(profile).as_deref() == Some(active_id)
        })
    {
        return active_id.to_string();
    }
    agent_accounts_profile_id_for_email(kind, profiles, default_email)
        .unwrap_or_else(|| AGENT_ACCOUNTS_DEFAULT_PROFILE_ID.to_string())
}

fn agent_accounts_default_alias_for_state(
    registry: &Value,
    kind: &str,
    profiles: &[Value],
    active_id: &str,
    default_email: &str,
) -> String {
    let explicit = registry
        .get("agents")
        .and_then(|agents| agents.get(kind))
        .and_then(|entry| entry.get("defaultAlias"))
        .and_then(Value::as_str);
    if let Some(explicit) = explicit {
        return explicit.trim().to_string();
    }

    profiles
        .iter()
        .find(|profile| {
            agent_accounts_profile_id(profile).as_deref() == Some(active_id)
                && agent_accounts_profile_is_duplicate_of_default(kind, profile, default_email)
        })
        .and_then(agent_accounts_profile_alias)
        .or_else(|| {
            profiles
                .iter()
                .find(|profile| {
                    agent_accounts_profile_is_duplicate_of_default(kind, profile, default_email)
                })
                .and_then(agent_accounts_profile_alias)
        })
        .unwrap_or_default()
}

fn agent_accounts_default_email(kind: &str) -> String {
    agent_accounts_profile_identity(kind, None)
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default()
}

/// Ids of non-canonical profiles suppressed because their email already maps
/// to Default or to another profile. Tokenomics retracts per-profile account
/// keys it may have published before the dedupe existed, so one login stops
/// rendering as two usage accounts (desktop Tokenomics tab and the cloud
/// dashboard alike).
pub(crate) fn agent_accounts_duplicate_profile_ids(kind: &str) -> Vec<String> {
    let registry = agent_accounts_registry_read();
    let (active_id, profiles) = agent_accounts_kind_entry(&registry, kind);
    let default_email = agent_accounts_default_email(kind);
    let effective_active_id =
        agent_accounts_effective_active_profile_id(kind, &active_id, &profiles, &default_email);
    let canonical_ids =
        agent_accounts_canonical_profile_ids_by_email(kind, &profiles, &effective_active_id, &default_email);
    profiles
        .iter()
        .filter_map(|profile| {
            profile
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .filter(|id| !canonical_ids.contains(id))
        .collect()
}

pub(crate) fn agent_accounts_active_profile_id_for_tokenomics(kind: &str) -> String {
    let registry = agent_accounts_registry_read();
    let (active_id, profiles) = agent_accounts_kind_entry(&registry, kind);
    let default_email = agent_accounts_default_email(kind);
    let effective_active_id =
        agent_accounts_effective_active_profile_id(kind, &active_id, &profiles, &default_email);
    let canonical_ids =
        agent_accounts_canonical_profile_ids_by_email(kind, &profiles, &effective_active_id, &default_email);
    if canonical_ids.contains(&effective_active_id) {
        effective_active_id
    } else {
        AGENT_ACCOUNTS_DEFAULT_PROFILE_ID.to_string()
    }
}

fn agent_accounts_kind_state(registry: &Value, kind: &str) -> Value {
    let (active_id, profiles) = agent_accounts_kind_entry(registry, kind);
    let default_identity = agent_accounts_profile_identity(kind, None);
    let default_email = default_identity
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
    let effective_active_id =
        agent_accounts_effective_active_profile_id(kind, &active_id, &profiles, &default_email);
    let canonical_ids =
        agent_accounts_canonical_profile_ids_by_email(kind, &profiles, &effective_active_id, &default_email);
    let default_alias =
        agent_accounts_default_alias_for_state(registry, kind, &profiles, &active_id, &default_email);
    let default_issue = registry
        .get("agents")
        .and_then(|agents| agents.get(kind))
        .and_then(|entry| entry.get(AGENT_ACCOUNTS_DEFAULT_AUTH_ISSUE_KEY));
    let default_auth_status = agent_accounts_auth_status(
        kind,
        AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
        None,
        &default_identity,
        default_issue,
    );
    let mut views = vec![json!({
        "id": AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
        "label": "Default",
        "alias": default_alias,
        "dir": agent_accounts_default_home(kind)
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        "createdAtMs": 0,
        "identity": default_identity,
        "authStatus": default_auth_status,
        "isDefault": true,
        "isActive": effective_active_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
        "loginCommand": "",
    })];
    for profile in &profiles {
        let Some(id) = agent_accounts_profile_id(profile) else {
            continue;
        };
        if !canonical_ids.contains(&id) {
            continue;
        }
        views.push(agent_accounts_profile_view(kind, profile, &effective_active_id));
    }
    json!({ "activeProfileId": effective_active_id, "profiles": views })
}

fn agent_accounts_kind_auth_statuses(registry: &Value, kind: &str) -> Value {
    let mut statuses = serde_json::Map::new();
    let default_identity = agent_accounts_profile_identity(kind, None);
    let default_issue = registry
        .get("agents")
        .and_then(|agents| agents.get(kind))
        .and_then(|entry| entry.get(AGENT_ACCOUNTS_DEFAULT_AUTH_ISSUE_KEY));
    statuses.insert(
        AGENT_ACCOUNTS_DEFAULT_PROFILE_ID.to_string(),
        agent_accounts_auth_status(
            kind,
            AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
            None,
            &default_identity,
            default_issue,
        ),
    );

    let (_, profiles) = agent_accounts_kind_entry(registry, kind);
    for profile in profiles {
        let Some(id) = agent_accounts_profile_id(&profile) else {
            continue;
        };
        let dir = profile
            .get("dir")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|dir| !dir.is_empty())
            .map(PathBuf::from);
        let identity = dir
            .as_deref()
            .map(|dir| agent_accounts_profile_identity(kind, Some(dir)))
            .unwrap_or_else(|| json!({ "email": "", "authReady": false }));
        statuses.insert(
            id.clone(),
            agent_accounts_auth_status(
                kind,
                &id,
                Some(&profile),
                &identity,
                profile.get(AGENT_ACCOUNTS_AUTH_ISSUE_KEY),
            ),
        );
    }

    Value::Object(statuses)
}

fn agent_accounts_active_profile_dir(kind: &str) -> Option<String> {
    let registry = agent_accounts_registry_read();
    let (active_id, profiles) = agent_accounts_kind_entry(&registry, kind);
    if active_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        return None;
    }
    profiles.iter().find_map(|profile| {
        let id = profile
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if id != active_id {
            return None;
        }
        profile
            .get("dir")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|dir| !dir.is_empty() && Path::new(dir).is_dir())
            .map(str::to_string)
    })
}

fn agent_accounts_auth_file_name(kind: &str) -> &'static str {
    match kind {
        "claude" => ".credentials.json",
        _ => "auth.json",
    }
}

fn agent_accounts_auth_file_signature(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    let bytes = fs::read(path).ok()?;
    let digest = cloud_mcp_short_hash(&String::from_utf8_lossy(&bytes));
    Some(format!("{modified_ms}:{}:{digest}", metadata.len()))
}

fn agent_accounts_auth_file_path(
    kind: &str,
    profile_id: &str,
    profile: Option<&Value>,
) -> Option<PathBuf> {
    if profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        return agent_accounts_default_home(kind).map(|home| home.join(agent_accounts_auth_file_name(kind)));
    }
    profile
        .and_then(agent_accounts_profile_dir)
        .map(|dir| dir.join(agent_accounts_auth_file_name(kind)))
}

fn agent_accounts_auth_signature_for_profile(
    kind: &str,
    profile_id: &str,
    profile: Option<&Value>,
) -> Option<String> {
    agent_accounts_auth_file_path(kind, profile_id, profile)
        .and_then(|path| agent_accounts_auth_file_signature(&path))
}

fn agent_accounts_auth_issue_is_current(
    kind: &str,
    profile_id: &str,
    profile: Option<&Value>,
    issue: Option<&Value>,
) -> bool {
    let Some(issue) = issue else {
        return false;
    };
    if !issue
        .get("needsLogin")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return false;
    }
    let marked_signature = issue
        .get("authFileSignature")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let current_signature = agent_accounts_auth_signature_for_profile(kind, profile_id, profile);
    match marked_signature {
        Some(marked_signature) => match current_signature {
            Some(current_signature) => current_signature == marked_signature,
            None => true,
        },
        None => current_signature.is_none(),
    }
}

fn agent_accounts_auth_status(
    kind: &str,
    profile_id: &str,
    profile: Option<&Value>,
    identity: &Value,
    issue: Option<&Value>,
) -> Value {
    let file_ready = identity
        .get("authReady")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let issue_current = agent_accounts_auth_issue_is_current(kind, profile_id, profile, issue);
    let needs_login = !file_ready || issue_current;
    let reason = if issue_current {
        issue
            .and_then(|issue| issue.get("reason"))
            .and_then(Value::as_str)
            .unwrap_or("refresh_failed")
    } else if !file_ready {
        "missing_auth"
    } else {
        ""
    };
    let message = if issue_current {
        issue
            .and_then(|issue| issue.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Sign in again for this saved account.")
    } else if !file_ready {
        "Sign in to finish this saved account."
    } else {
        ""
    };
    json!({
        "authReady": file_ready && !issue_current,
        "fileReady": file_ready,
        "needsLogin": needs_login,
        "reason": reason,
        "message": message,
        "detectedAtMs": issue.and_then(|issue| issue.get("detectedAtMs")).and_then(Value::as_u64).unwrap_or(0),
    })
}

fn agent_accounts_clear_resolved_auth_issues_for_kind(registry: &mut Value, kind: &str) -> bool {
    let mut changed = false;
    if let Some(entry) = registry
        .get_mut("agents")
        .and_then(|agents| agents.get_mut(kind))
    {
        let default_issue = entry.get(AGENT_ACCOUNTS_DEFAULT_AUTH_ISSUE_KEY).cloned();
        if default_issue.is_some()
            && !agent_accounts_auth_issue_is_current(
                kind,
                AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
                None,
                default_issue.as_ref(),
            )
        {
            if let Some(object) = entry.as_object_mut() {
                object.remove(AGENT_ACCOUNTS_DEFAULT_AUTH_ISSUE_KEY);
                changed = true;
            }
        }

        if let Some(profiles) = entry.get_mut("profiles").and_then(Value::as_array_mut) {
            for profile in profiles {
                let id = agent_accounts_profile_id(profile).unwrap_or_default();
                if id.is_empty() {
                    continue;
                }
                let issue = profile.get(AGENT_ACCOUNTS_AUTH_ISSUE_KEY).cloned();
                if issue.is_some()
                    && !agent_accounts_auth_issue_is_current(kind, &id, Some(profile), issue.as_ref())
                {
                    if let Some(object) = profile.as_object_mut() {
                        object.remove(AGENT_ACCOUNTS_AUTH_ISSUE_KEY);
                        changed = true;
                    }
                }
            }
        }
    }
    changed
}

fn agent_accounts_registry_read_resolved() -> Value {
    let mut registry = agent_accounts_registry_read();
    let claude_changed = agent_accounts_clear_resolved_auth_issues_for_kind(&mut registry, "claude");
    let codex_changed = agent_accounts_clear_resolved_auth_issues_for_kind(&mut registry, "codex");
    let changed = claude_changed || codex_changed;
    if changed {
        agent_accounts_registry_write(&registry);
    }
    registry
}

fn agent_accounts_profile_id(profile: &Value) -> Option<String> {
    profile
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn agent_accounts_profile_dir(profile: &Value) -> Option<PathBuf> {
    profile
        .get("dir")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
}

fn agent_accounts_default_profile_for_launch(kind: &'static str) -> Option<Value> {
    let identity = agent_accounts_profile_identity(kind, None);
    let email = identity
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
    let auth_ready = identity
        .get("authReady")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if email.is_empty() || !auth_ready {
        return None;
    }

    let _ = agent_accounts_capture_kind(kind);
    let registry = agent_accounts_registry_read();
    let (_, profiles) = agent_accounts_kind_entry(&registry, kind);
    let auth_file = agent_accounts_auth_file_name(kind);
    profiles.into_iter().find_map(|profile| {
        if agent_accounts_profile_email(kind, &profile) != email {
            return None;
        }
        agent_accounts_profile_dir(&profile)
            .filter(|path| path.join(auth_file).is_file())
            .map(|_| profile)
    })
}

fn agent_accounts_default_profile_home_for_launch(kind: &'static str) -> Option<PathBuf> {
    agent_accounts_default_profile_for_launch(kind).and_then(|profile| {
        let auth_file = agent_accounts_auth_file_name(kind);
        agent_accounts_profile_dir(&profile).filter(|path| path.join(auth_file).is_file())
    })
}

fn agent_accounts_profile_home_for_launch(kind: &'static str) -> Option<PathBuf> {
    agent_accounts_active_profile_dir(kind)
        .map(PathBuf::from)
        .or_else(|| agent_accounts_default_profile_home_for_launch(kind))
}

fn agent_accounts_active_profile_label(kind: &str) -> (String, String) {
    let registry = agent_accounts_registry_read();
    let (active_id, profiles) = agent_accounts_kind_entry(&registry, kind);
    if active_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        return (active_id, "Default".to_string());
    }
    let label = profiles
        .iter()
        .find(|profile| {
            profile
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                == active_id
        })
        .map(agent_accounts_profile_display_label)
        .unwrap_or_else(|| "Account".to_string());
    (active_id, label)
}

fn agent_accounts_launch_profile_label(kind: &'static str) -> (String, String) {
    let (active_id, active_label) = agent_accounts_active_profile_label(kind);
    if active_id != AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        return (active_id, active_label);
    }
    agent_accounts_default_profile_for_launch(kind)
        .and_then(|profile| {
            agent_accounts_profile_id(&profile)
                .map(|id| (id, agent_accounts_profile_display_label(&profile)))
        })
        .unwrap_or((active_id, active_label))
}

/// All registered profiles of one kind with existing dirs, for tokenomics:
/// Claude profiles contribute transcript scan roots (`<dir>/projects`), Codex
/// profiles contribute per-account auth for the live usage endpoint — each
/// attributed to its own account key.
pub(crate) fn agent_accounts_profiles_for_tokenomics(kind: &str) -> Vec<(String, String, PathBuf)> {
    let registry = agent_accounts_registry_read();
    let (active_id, profiles) = agent_accounts_kind_entry(&registry, kind);
    let default_email = agent_accounts_default_email(kind);
    let effective_active_id =
        agent_accounts_effective_active_profile_id(kind, &active_id, &profiles, &default_email);
    let canonical_ids =
        agent_accounts_canonical_profile_ids_by_email(kind, &profiles, &effective_active_id, &default_email);
    profiles
        .iter()
        .filter_map(|profile| {
            // Same rule as the switcher pills: duplicate emails collapse to
            // one canonical profile, with Default owning its current email.
            let id = agent_accounts_profile_id(profile)?;
            if !canonical_ids.contains(&id) {
                return None;
            }
            let label = agent_accounts_profile_display_label(profile);
            let dir = profile
                .get("dir")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .filter(|path| path.is_dir())?;
            Some((id, label, dir))
        })
        .collect()
}

/// The active Codex profile dir for the coordination kernel's auth bridge:
/// managed per-slot Codex homes re-link `auth.json` from this dir, so
/// coordinated panes pick up the active account on (re)launch.
pub(crate) fn agent_accounts_active_codex_home() -> Option<PathBuf> {
    agent_accounts_active_profile_dir("codex")
        .map(PathBuf::from)
        .filter(|path| path.join("auth.json").is_file())
}

/// Stable Codex auth home for a managed launch. A selected captured profile is
/// already isolated; the Default profile is first pinned to its captured
/// per-account snapshot so later `~/.codex/auth.json` changes do not mutate
/// running managed panes.
pub(crate) fn agent_accounts_codex_home_for_launch() -> Option<PathBuf> {
    if let Some(profile_home) = agent_accounts_active_codex_home() {
        return Some(profile_home);
    }
    agent_accounts_default_profile_home_for_launch("codex")
}

/// Spawn-time account binding: stamps the pane with the active profile and
/// injects the CLI home override for non-default profiles. Called from
/// `extend_terminal_activity_env_vars`, which every agent spawn/relaunch
/// path funnels through — switching never needs an app restart because the
/// account is resolved fresh at each spawn.
pub(crate) fn agent_accounts_apply_spawn_env(
    env_vars: &mut Vec<(String, String)>,
    pane_id: &str,
    provider_id: &str,
) {
    let Some(kind) = agent_accounts_supported_kind(provider_id) else {
        return;
    };
    let (active_id, active_label) = agent_accounts_launch_profile_label(kind);
    {
        let registry = AGENT_ACCOUNTS_PANE_PROFILES.get_or_init(|| StdMutex::new(HashMap::new()));
        if let Ok(mut map) = registry.lock() {
            if map.len() > 400 {
                map.clear();
            }
            map.insert(
                pane_id.to_string(),
                json!({
                    "kind": kind,
                    "profileId": active_id,
                    "profileLabel": active_label,
                    "stampedAtMs": todo_dispatch_now_ms(),
                }),
            );
        }
    }
    match kind {
        "claude" => {
            let Some(dir) = agent_accounts_profile_home_for_launch(kind) else {
                return;
            };
            env_vars.retain(|(key, _)| key != "CLAUDE_CONFIG_DIR");
            env_vars.push((
                "CLAUDE_CONFIG_DIR".to_string(),
                dir.to_string_lossy().to_string(),
            ));
        }
        "opencode" => {
            let Some(dir) = agent_accounts_active_profile_dir(kind) else {
                return;
            };
            env_vars.retain(|(key, _)| key != "OPENCODE_DATA_DIR");
            env_vars.push(("OPENCODE_DATA_DIR".to_string(), dir));
        }
        _ => {
            let Some(dir) = agent_accounts_active_profile_dir(kind) else {
                return;
            };
            // Coordinated Codex panes already run a Diff Forge managed
            // CODEX_HOME (hook profiles live there); their auth re-links from
            // the active profile via the kernel's auth bridge instead.
            let managed = env_vars.iter().any(|(key, _)| key == "CODEX_HOME");
            if !managed {
                env_vars.push(("CODEX_HOME".to_string(), dir));
            }
        }
    }
}

// ---- Automatic account capture --------------------------------------------
//
// While the app runs, a watcher polls the default CLI homes. Every
// authenticated identity it sees gets pinned into its own snapshot profile
// before a later login can overwrite the credentials, which is what makes
// "log into another account anywhere, then switch between both" work with no
// add-account flow. Deleting a captured profile while that account is still
// signed in suppresses recapture until the default identity changes.

fn agent_accounts_email_key(email: &str) -> String {
    email.trim().to_ascii_lowercase()
}

/// The registry's display label for whichever profile holds this login email,
/// so tokenomics account chips name accounts exactly like the accounts
/// settings UI ("syedmraza99", "admin") instead of the provider-side display
/// name. Returns None for logins the registry doesn't know. STORED emails
/// only — the live probe (`agent_accounts_profile_email` fallback) derives a
/// tokenomics key whose label resolution calls back into this function, so
/// probing here would recurse for profiles missing a stored email.
pub(crate) fn agent_accounts_profile_label_for_email(kind: &str, email: &str) -> Option<String> {
    let wanted = agent_accounts_email_key(email);
    if wanted.is_empty() {
        return None;
    }
    let registry = agent_accounts_registry_read();
    let (_, profiles) = agent_accounts_kind_entry(&registry, kind);
    profiles
        .iter()
        .find(|profile| {
            profile
                .get("email")
                .and_then(Value::as_str)
                .map(agent_accounts_email_key)
                .is_some_and(|stored| stored == wanted)
        })
        .map(agent_accounts_profile_display_label)
}

fn agent_accounts_email_slug(email: &str) -> String {
    let local = email.split('@').next().unwrap_or(email);
    let slug = local
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(32)
        .collect::<String>();
    if slug.is_empty() {
        "account".to_string()
    } else {
        slug
    }
}

/// The identity a profile is pinned to: the email stored at capture time, or
/// a live probe of the profile dir for manually created legacy profiles.
fn agent_accounts_profile_email(kind: &str, profile: &Value) -> String {
    if let Some(stored) = profile
        .get("email")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return agent_accounts_email_key(stored);
    }
    let dir = profile
        .get("dir")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(dir) = dir else {
        return String::new();
    };
    agent_accounts_profile_identity(kind, Some(Path::new(dir)))
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default()
}

fn agent_accounts_copy_if_newer(source: &Path, destination: &Path) -> bool {
    if !source.is_file() {
        return false;
    }
    let destination_empty = destination
        .metadata()
        .map(|meta| meta.len() == 0)
        .unwrap_or(false);
    let newer = match (
        source.metadata().and_then(|meta| meta.modified()),
        destination.metadata().and_then(|meta| meta.modified()),
    ) {
        (Ok(source_time), Ok(destination_time)) => {
            destination_empty || source_time > destination_time
        }
        (Ok(_), Err(_)) => true,
        _ => false,
    };
    newer && fs::copy(source, destination).is_ok()
}

/// Copies the default home's credential/identity files into a snapshot
/// profile dir. Callers only invoke this while the default home holds the
/// SAME account the profile is pinned to, so refreshed tokens keep
/// propagating into the snapshot without ever mixing identities.
fn agent_accounts_snapshot_refresh(kind: &str, dir: &Path) {
    let _span = BackendCpuSpan::new("agent_accounts.snapshot_refresh");
    let Some(default_home) = agent_accounts_default_home(kind) else {
        return;
    };
    match kind {
        "claude" => {
            let creds_copied = agent_accounts_copy_if_newer(
                &default_home.join(".credentials.json"),
                &dir.join(".credentials.json"),
            );
            // `.claude.json` (identity + CLI state) lives at `~/.claude.json`
            // beside the default home and churns constantly with project
            // state; only mirror it when missing or when credentials moved.
            if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
                let state_destination = dir.join(".claude.json");
                if creds_copied || !state_destination.is_file() {
                    let _ = fs::copy(home.join(".claude.json"), &state_destination);
                }
            }
            let settings_destination = dir.join("settings.json");
            if !settings_destination.exists() {
                let _ = fs::copy(default_home.join("settings.json"), &settings_destination);
            }
        }
        "opencode" => {
            agent_accounts_copy_if_newer(&default_home.join("auth.json"), &dir.join("auth.json"));
            for config_name in ["config.json", "opencode.json", "opencode.jsonc"] {
                let destination = dir.join(config_name);
                if !destination.exists() {
                    let _ = fs::copy(default_home.join(config_name), &destination);
                }
            }
        }
        _ => {
            agent_accounts_copy_if_newer(&default_home.join("auth.json"), &dir.join("auth.json"));
            let config_destination = dir.join("config.toml");
            if !config_destination.exists() {
                let _ = fs::copy(default_home.join("config.toml"), &config_destination);
            }
        }
    }
}

fn agent_account_push_allowed_files(kind: &str) -> &'static [&'static str] {
    match kind {
        "claude" => &[".credentials.json", ".claude.json"],
        "opencode" => &["auth.json"],
        _ => &["auth.json"],
    }
}

fn agent_account_push_required_files(kind: &str) -> &'static [&'static str] {
    match kind {
        "claude" => &[".credentials.json", ".claude.json"],
        "opencode" => &["auth.json"],
        _ => &["auth.json"],
    }
}

fn agent_account_push_default_file_path(kind: &str, name: &str) -> Option<PathBuf> {
    match (kind, name) {
        ("claude", ".claude.json") => env::var_os("HOME").map(PathBuf::from).map(|home| home.join(name)),
        _ => agent_accounts_default_home(kind).map(|home| home.join(name)),
    }
}

fn agent_account_push_source_file_path(
    kind: &str,
    profile_id: &str,
    profile_dir: Option<&Path>,
    name: &str,
) -> Option<PathBuf> {
    if profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        return agent_account_push_default_file_path(kind, name);
    }
    profile_dir.map(|dir| dir.join(name))
}

fn agent_accounts_write_private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create {}: {error}", parent.display()))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(path)
            .map_err(|error| format!("Unable to open {}: {error}", path.display()))?;
        file.write_all(bytes)
            .map_err(|error| format!("Unable to write {}: {error}", path.display()))?;
        let _ = fs::set_permissions(path, std::os::unix::fs::PermissionsExt::from_mode(0o600));
        return Ok(());
    }
    #[cfg(not(unix))]
    {
        fs::write(path, bytes)
            .map_err(|error| format!("Unable to write {}: {error}", path.display()))
    }
}

fn agent_account_push_read_file(path: &Path, required: bool) -> Result<Option<String>, String> {
    if !path.is_file() {
        if required {
            return Err(format!(
                "Required credential file is missing: {}",
                path.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("credential")
            ));
        }
        return Ok(None);
    }
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Unable to inspect credential file {}: {error}", path.display()))?;
    if metadata.len() > AGENT_ACCOUNT_PUSH_MAX_FILE_BYTES {
        return Err(format!(
            "Credential file is too large to push safely: {}",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("credential")
        ));
    }
    let bytes = fs::read(path)
        .map_err(|error| format!("Unable to read credential file {}: {error}", path.display()))?;
    Ok(Some(general_purpose::STANDARD.encode(bytes)))
}

fn agent_account_push_read_claude_state_subset_file(path: &Path) -> Result<Option<String>, String> {
    if !path.is_file() {
        return Err("Required credential file is missing: .claude.json".to_string());
    }
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Unable to inspect credential file {}: {error}", path.display()))?;
    if metadata.len() > AGENT_ACCOUNT_PUSH_MAX_FILE_BYTES {
        return Err("Credential file is too large to push safely: .claude.json".to_string());
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Unable to read credential file {}: {error}", path.display()))?;
    let state = serde_json::from_str::<Value>(&raw)
        .map_err(|_| "Claude account state is not valid JSON.".to_string())?;
    let oauth_account = state
        .get("oauthAccount")
        .cloned()
        .filter(Value::is_object)
        .ok_or_else(|| "Claude account state is missing oauthAccount.".to_string())?;
    let mut subset = serde_json::Map::new();
    subset.insert("oauthAccount".to_string(), oauth_account);
    let bytes = serde_json::to_vec_pretty(&Value::Object(subset))
        .map_err(|error| format!("Unable to encode Claude account state: {error}"))?;
    Ok(Some(general_purpose::STANDARD.encode(bytes)))
}

fn agent_account_push_claude_default_state_path() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".claude.json"))
        .ok_or_else(|| "Unable to locate Claude global state for local wipe.".to_string())
}

fn agent_account_push_splice_claude_default_state(expected_email: &str) -> Result<Option<Vec<u8>>, String> {
    let path = agent_account_push_claude_default_state_path()?;
    if !path.exists() {
        return Ok(None);
    }
    if !path.is_file() {
        return Err("Claude global state is not a regular file; wipe cancelled.".to_string());
    }
    let original = fs::read(&path)
        .map_err(|error| format!("Unable to read Claude global state: {error}"))?;
    let mut state = serde_json::from_slice::<Value>(&original)
        .map_err(|_| "Claude global state is not valid JSON; wipe cancelled.".to_string())?;
    let state_email = state
        .pointer("/oauthAccount/emailAddress")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
    if state_email.is_empty() {
        return Ok(None);
    }
    if state_email != expected_email {
        return Err("Claude default account identity changed; wipe cancelled.".to_string());
    }
    let Some(object) = state.as_object_mut() else {
        return Err("Claude global state is not an object; wipe cancelled.".to_string());
    };
    object.remove("oauthAccount");
    let updated = serde_json::to_vec_pretty(&state)
        .map_err(|error| format!("Unable to encode Claude global state: {error}"))?;
    agent_accounts_write_private_file(&path, &updated)?;
    Ok(Some(original))
}

fn agent_account_push_restore_claude_default_state(original: &[u8]) {
    if let Ok(path) = agent_account_push_claude_default_state_path() {
        let _ = agent_accounts_write_private_file(&path, original);
    }
}

fn agent_account_push_profile_bundle(
    kind: &str,
    profile_id: &str,
    push_id: &str,
    target_device_id: &str,
    sender_device_id: &str,
) -> Result<AgentAccountPushBlob, String> {
    let registry = agent_accounts_registry_read_resolved();
    let (_, profiles) = agent_accounts_kind_entry(&registry, kind);
    let (profile, profile_dir) = if profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        (None, None)
    } else {
        let profile = profiles
            .iter()
            .find(|profile| agent_accounts_profile_id(profile).as_deref() == Some(profile_id))
            .cloned()
            .ok_or_else(|| format!("Unknown {kind} account profile: {profile_id}"))?;
        let dir = agent_accounts_profile_dir(&profile)
            .ok_or_else(|| format!("{kind} account profile has no directory: {profile_id}"))?;
        if !dir.is_dir() {
            return Err(format!("{kind} account profile directory is missing: {profile_id}"));
        }
        (Some(profile), Some(dir))
    };
    let identity = match profile_dir.as_deref() {
        Some(dir) => agent_accounts_profile_identity(kind, Some(dir)),
        None => agent_accounts_profile_identity(kind, None),
    };
    let auth_ready = identity
        .get("authReady")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !auth_ready {
        return Err(format!("{kind} account profile is not signed in with file credentials."));
    }
    let email = identity
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
    if email.is_empty() {
        return Err(format!(
            "Unable to identify the {kind} account identity; it cannot be pushed safely."
        ));
    }
    let required_files = agent_account_push_required_files(kind);
    if kind == "claude" {
        let credentials_path = agent_account_push_source_file_path(
            kind,
            profile_id,
            profile_dir.as_deref(),
            ".credentials.json",
        )
        .ok_or_else(|| "Unable to locate Claude credentials file.".to_string())?;
        if !credentials_path.is_file() {
            return Err(
                "This Claude account only has Keychain credentials on this device and cannot be pushed."
                    .to_string(),
            );
        }
    }
    let mut files = Vec::new();
    for name in agent_account_push_allowed_files(kind) {
        let path = agent_account_push_source_file_path(kind, profile_id, profile_dir.as_deref(), name)
            .ok_or_else(|| format!("Unable to locate {kind} credential file: {name}"))?;
        let required = required_files.iter().any(|required| required == name);
        let data_b64 = if kind == "claude" && *name == ".claude.json" {
            agent_account_push_read_claude_state_subset_file(&path)?
        } else {
            agent_account_push_read_file(&path, required)?
        };
        if let Some(data_b64) = data_b64 {
            files.push(AgentAccountPushFile {
                name: (*name).to_string(),
                data_b64,
            });
        }
    }
    for required in required_files {
        if !files.iter().any(|file| file.name == *required) {
            return Err(format!("Required {kind} credential file is missing: {required}"));
        }
    }
    let label = profile
        .as_ref()
        .map(agent_accounts_profile_display_label)
        .unwrap_or_else(|| {
            email.split('@')
                .next()
                .filter(|value| !value.is_empty())
                .unwrap_or("Account")
                .to_string()
        });
    let alias = profile
        .as_ref()
        .and_then(|profile| profile.get("alias"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string();
    let issued_at_ms = todo_dispatch_now_ms();
    Ok(AgentAccountPushBlob {
        version: 1,
        contract: AGENT_ACCOUNT_PUSH_CONTRACT.to_string(),
        push_id: push_id.trim().to_string(),
        target_device_id: target_device_id.trim().to_string(),
        sender_device_id: sender_device_id.trim().to_string(),
        issued_at_ms,
        expires_at_ms: issued_at_ms.saturating_add(AGENT_ACCOUNT_PUSH_BLOB_TTL_MS),
        agent_kind: kind.to_string(),
        source_profile_id: profile_id.to_string(),
        identity_email: email,
        label,
        alias,
        files,
    })
}

fn agent_account_push_normalized_device_id(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn agent_account_push_first_text(value: &Value, paths: &[&[&str]]) -> Option<String> {
    paths
        .iter()
        .find_map(|path| cloud_mcp_payload_text(value, path))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn agent_account_push_device_matches_id(device: &Value, target_device_id: &str) -> bool {
    let target = agent_account_push_normalized_device_id(target_device_id);
    if target.is_empty() {
        return false;
    }
    let ids = [
        &["device_id"][..],
        &["deviceId"][..],
        &["machine_id"][..],
        &["machineId"][..],
        &["id"][..],
        &["native_device_id"][..],
        &["nativeDeviceId"][..],
        &["target_native_device_id"][..],
        &["targetNativeDeviceId"][..],
        &["device", "device_id"][..],
        &["device", "deviceId"][..],
        &["device", "id"][..],
        &["surfaces", "native", "device_id"][..],
        &["surfaces", "native", "deviceId"][..],
    ];
    ids.iter().any(|path| {
        cloud_mcp_payload_text(device, path)
            .map(|value| agent_account_push_normalized_device_id(&value) == target)
            .unwrap_or(false)
    })
}

fn agent_account_push_find_device_candidate(
    value: &Value,
    target_device_id: &str,
    depth: usize,
) -> Option<Value> {
    if depth > 8 {
        return None;
    }
    match value {
        Value::Object(object) => {
            if agent_account_push_device_matches_id(value, target_device_id) {
                return Some(value.clone());
            }
            let target = agent_account_push_normalized_device_id(target_device_id);
            for (key, child) in object {
                if agent_account_push_normalized_device_id(key) == target && child.is_object() {
                    let mut candidate = child.clone();
                    if let Some(candidate_object) = candidate.as_object_mut() {
                        candidate_object
                            .entry("device_id".to_string())
                            .or_insert_with(|| json!(target_device_id));
                    }
                    return Some(candidate);
                }
                if child.is_object() || child.is_array() {
                    if let Some(found) =
                        agent_account_push_find_device_candidate(child, target_device_id, depth + 1)
                    {
                        return Some(found);
                    }
                }
            }
            None
        }
        Value::Array(items) => items
            .iter()
            .find_map(|item| agent_account_push_find_device_candidate(item, target_device_id, depth + 1)),
        _ => None,
    }
}

fn agent_account_push_device_online(device: &Value) -> bool {
    let native_connected = [
        &["native_connected"][..],
        &["nativeConnected"][..],
        &["native", "connected"][..],
        &["surfaces", "native", "connected"][..],
    ]
    .iter()
    .any(|path| cloud_mcp_payload_bool(device, path, false));
    if native_connected {
        return true;
    }
    let desktopish = agent_account_push_first_text(
        device,
        &[
            &["client_type"][..],
            &["clientType"][..],
            &["client_kind"][..],
            &["clientKind"][..],
            &["connection_source"][..],
            &["connectionSource"][..],
        ],
    )
    .map(|value| {
        let value = value.to_ascii_lowercase();
        value.contains("rust") || value.contains("desktop") || value.contains("diffforge")
    })
    .unwrap_or(false);
    let status_online = agent_account_push_first_text(
        device,
        &[
            &["status"][..],
            &["state"][..],
            &["connection_status"][..],
            &["connectionStatus"][..],
        ],
    )
    .map(|value| {
        matches!(
            value.to_ascii_lowercase().as_str(),
            "connected" | "online" | "active" | "ready"
        )
    })
    .unwrap_or(false);
    let connected = [
        &["connected"][..],
        &["device", "connected"][..],
        &["surfaces", "native", "connected"][..],
    ]
    .iter()
    .any(|path| cloud_mcp_payload_bool(device, path, false));
    desktopish && (connected || status_online)
}

fn agent_account_push_target_key(device: &Value) -> Result<(String, String), String> {
    let push_public_key = agent_account_push_first_text(
        device,
        &[
            &["push_public_key"][..],
            &["pushPublicKey"][..],
            &["device", "push_public_key"][..],
            &["device", "pushPublicKey"][..],
            &["surfaces", "native", "push_public_key"][..],
            &["surfaces", "native", "pushPublicKey"][..],
        ],
    )
    .unwrap_or_default();
    let push_capable = [
        &["push_capable"][..],
        &["pushCapable"][..],
        &["device", "push_capable"][..],
        &["device", "pushCapable"][..],
        &["surfaces", "native", "push_capable"][..],
        &["surfaces", "native", "pushCapable"][..],
    ]
    .iter()
    .any(|path| cloud_mcp_payload_bool(device, path, false));
    if push_public_key.is_empty() || !push_capable {
        return Err("Target device is not push-capable; it has not published an agent account push key.".to_string());
    }
    let algorithm = agent_account_push_first_text(
        device,
        &[
            &["push_key_algorithm"][..],
            &["pushKeyAlgorithm"][..],
            &["device", "push_key_algorithm"][..],
            &["device", "pushKeyAlgorithm"][..],
            &["surfaces", "native", "push_key_algorithm"][..],
            &["surfaces", "native", "pushKeyAlgorithm"][..],
        ],
    )
    .unwrap_or_default();
    if algorithm != AGENT_ACCOUNT_PUSH_SEALED_ALGORITHM {
        return Err("Target device uses an unsupported agent account push key algorithm.".to_string());
    }
    Ok((push_public_key, algorithm))
}

fn agent_account_push_trusted_keys_path() -> Result<PathBuf, String> {
    let state_dir = cloud_mcp_native_data_root()
        .ok_or_else(|| "Unable to resolve Diff Forge device data directory.".to_string())?
        .join(DEVICE_APP_STATE_DIR);
    fs::create_dir_all(&state_dir)
        .map_err(|error| format!("Unable to create agent account push trust directory: {error}"))?;
    Ok(state_dir.join(AGENT_ACCOUNT_PUSH_TRUSTED_KEYS_FILE))
}

fn agent_account_push_read_trusted_keys() -> Result<HashMap<String, String>, String> {
    let path = agent_account_push_trusted_keys_path()?;
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(error) => return Err(format!("Unable to read trusted device push keys: {error}")),
    };
    let value = serde_json::from_str::<Value>(&raw)
        .map_err(|_| "Trusted device push key file is not valid JSON.".to_string())?;
    let mut keys = HashMap::new();
    if let Some(object) = value.as_object() {
        for (device_id, key) in object {
            let device_id = agent_account_push_normalized_device_id(device_id);
            let key = key.as_str().unwrap_or_default().trim().to_string();
            if !device_id.is_empty() && !key.is_empty() {
                keys.insert(device_id, key);
            }
        }
    }
    Ok(keys)
}

fn agent_account_push_write_trusted_keys(keys: &HashMap<String, String>) -> Result<(), String> {
    let path = agent_account_push_trusted_keys_path()?;
    let mut object = serde_json::Map::new();
    for (device_id, key) in keys {
        object.insert(device_id.clone(), json!(key));
    }
    let bytes = serde_json::to_vec_pretty(&Value::Object(object))
        .map_err(|error| format!("Unable to encode trusted device push keys: {error}"))?;
    agent_accounts_write_private_file(&path, &bytes)
}

fn agent_account_push_verify_or_pin_target_key(
    target_device_id: &str,
    push_public_key: &str,
) -> Result<(), String> {
    let target_device_id = agent_account_push_normalized_device_id(target_device_id);
    let push_public_key = push_public_key.trim().to_string();
    if target_device_id.is_empty() || push_public_key.is_empty() {
        return Err("Target device push key is missing.".to_string());
    }
    let mut keys = agent_account_push_read_trusted_keys()?;
    if let Some(pinned) = keys.get(&target_device_id) {
        if pinned != &push_public_key {
            return Err(
                "This device's security key changed; push cancelled. Re-verify the device."
                    .to_string(),
            );
        }
        return Ok(());
    }
    keys.insert(target_device_id, push_public_key);
    agent_account_push_write_trusted_keys(&keys)
}

async fn agent_account_push_target_device(
    state: &CloudMcpState,
    target_device_id: &str,
) -> Result<Value, String> {
    let snapshot = {
        let runtime = state.inner.lock().await;
        runtime.account_device_live_state_snapshot.clone()
    }
    .ok_or_else(|| "Device live-state is not available yet; wait for cloud sync and try again.".to_string())?;
    let target = agent_account_push_find_device_candidate(&snapshot, target_device_id, 0)
        .ok_or_else(|| format!("Unknown target device: {target_device_id}"))?;
    if !agent_account_push_device_online(&target) {
        return Err(format!(
            "Target device {target_device_id} is not online with a connected Rust desktop client."
        ));
    }
    Ok(target)
}

fn agent_account_push_profile_id(kind: &str, email: &str) -> String {
    let email = agent_accounts_email_key(email);
    format!(
        "cap-{}-{}",
        agent_accounts_email_slug(&email),
        cloud_mcp_short_hash(&format!("{kind}:{email}"))
    )
}

fn agent_account_push_decode_blob(plaintext: &[u8]) -> Result<AgentAccountPushBlob, String> {
    let blob: AgentAccountPushBlob = serde_json::from_slice(plaintext)
        .map_err(|_| "Agent account push payload is not valid JSON.".to_string())?;
    if blob.version != 1 || blob.contract != AGENT_ACCOUNT_PUSH_CONTRACT {
        return Err("Unsupported agent account push payload.".to_string());
    }
    if blob.push_id.trim().is_empty() {
        return Err("Pushed agent account is missing push_id.".to_string());
    }
    if blob.target_device_id.trim().is_empty() {
        return Err("Pushed agent account is missing target device binding.".to_string());
    }
    if blob.sender_device_id.trim().is_empty() {
        return Err("Pushed agent account is missing sender device binding.".to_string());
    }
    if blob.issued_at_ms == 0 || blob.expires_at_ms <= blob.issued_at_ms {
        return Err("Pushed agent account has an invalid expiry.".to_string());
    }
    let kind = agent_accounts_supported_kind(&blob.agent_kind)
        .ok_or_else(|| format!("Unsupported pushed agent kind: {}", blob.agent_kind))?;
    if kind != blob.agent_kind {
        return Err("Pushed agent account kind was not canonical.".to_string());
    }
    if agent_accounts_email_key(&blob.identity_email).is_empty() {
        return Err("Pushed agent account identity is missing.".to_string());
    }
    let allowed = agent_account_push_allowed_files(kind);
    let required = agent_account_push_required_files(kind);
    let mut names = HashSet::new();
    for file in &blob.files {
        if file.name.contains('/') || file.name.contains('\\') || file.name == "." || file.name == ".." {
            return Err("Pushed agent account contains an invalid file name.".to_string());
        }
        if !allowed.iter().any(|allowed| *allowed == file.name) {
            return Err(format!(
                "Pushed {kind} account contains an unsupported file: {}",
                file.name
            ));
        }
        if !names.insert(file.name.clone()) {
            return Err("Pushed agent account contains duplicate files.".to_string());
        }
        let decoded = general_purpose::STANDARD
            .decode(&file.data_b64)
            .map_err(|_| "Pushed agent account file is not valid base64.".to_string())?;
        if decoded.len() as u64 > AGENT_ACCOUNT_PUSH_MAX_FILE_BYTES {
            return Err("Pushed agent account file is too large.".to_string());
        }
    }
    for required in required {
        if !names.contains(*required) {
            return Err(format!("Pushed {kind} account is missing {required}."));
        }
    }
    Ok(blob)
}

fn agent_account_push_verify_received_blob(
    blob: AgentAccountPushBlob,
    event_push_id: &str,
    current_device_id: &str,
    now_ms: u64,
) -> Result<AgentAccountPushBlob, String> {
    let event_push_id = event_push_id.trim();
    if event_push_id.is_empty() || blob.push_id != event_push_id {
        return Err("Agent account push id does not match the sealed payload.".to_string());
    }
    if agent_account_push_normalized_device_id(&blob.target_device_id)
        != agent_account_push_normalized_device_id(current_device_id)
    {
        return Err("Agent account push was sealed for a different device.".to_string());
    }
    if now_ms > blob.expires_at_ms {
        return Err("Agent account push payload expired.".to_string());
    }
    Ok(blob)
}

fn agent_account_push_prune_applied_locked(applied: &mut HashMap<String, u64>, now_ms: u64) {
    applied.retain(|_, expires_at_ms| *expires_at_ms >= now_ms);
    if applied.len() > AGENT_ACCOUNT_PUSH_APPLIED_MAX {
        let remove_count = applied.len() - AGENT_ACCOUNT_PUSH_APPLIED_MAX;
        let stale_keys = applied
            .keys()
            .take(remove_count)
            .cloned()
            .collect::<Vec<_>>();
        for key in stale_keys {
            applied.remove(&key);
        }
    }
}

fn agent_account_push_reject_if_applied(push_id: &str, now_ms: u64) -> Result<(), String> {
    let mut applied = agent_account_push_applied()
        .lock()
        .map_err(|_| "Agent account push replay guard is unavailable.".to_string())?;
    agent_account_push_prune_applied_locked(&mut applied, now_ms);
    if applied.contains_key(push_id) {
        return Err("Agent account push was already applied on this device.".to_string());
    }
    Ok(())
}

fn agent_account_push_mark_applied(push_id: &str, expires_at_ms: u64, now_ms: u64) -> Result<(), String> {
    let mut applied = agent_account_push_applied()
        .lock()
        .map_err(|_| "Agent account push replay guard is unavailable.".to_string())?;
    agent_account_push_prune_applied_locked(&mut applied, now_ms);
    applied.insert(push_id.trim().to_string(), expires_at_ms.max(now_ms));
    Ok(())
}

fn agent_accounts_replace_profile_dir_with_backup(
    temp_dir: &Path,
    final_dir: &Path,
) -> Result<(), String> {
    let final_name = final_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("profile");
    let backup_dir = final_dir.with_file_name(format!(
        ".push-backup-{}-{}",
        final_name,
        uuid::Uuid::new_v4()
    ));
    let had_existing = final_dir.exists();
    if had_existing {
        fs::rename(final_dir, &backup_dir)
            .map_err(|error| format!("Unable to stage existing pushed profile backup: {error}"))?;
    }
    if let Err(error) = fs::rename(temp_dir, final_dir) {
        if had_existing {
            if let Err(restore_error) = fs::rename(&backup_dir, final_dir) {
                return Err(format!(
                    "Unable to install pushed account profile: {error}; restoring the previous profile also failed: {restore_error}"
                ));
            }
        }
        return Err(format!("Unable to install pushed account profile: {error}"));
    }
    if had_existing {
        if let Err(error) = fs::remove_dir_all(&backup_dir) {
            let _ = fs::remove_dir_all(final_dir);
            if let Err(restore_error) = fs::rename(&backup_dir, final_dir) {
                return Err(format!(
                    "Unable to remove previous pushed profile backup: {error}; restoring the previous profile also failed: {restore_error}"
                ));
            }
            return Err(format!(
                "Unable to remove previous pushed profile backup: {error}"
            ));
        }
    }
    Ok(())
}

fn agent_accounts_materialize_pushed_account(blob: AgentAccountPushBlob) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(&blob.agent_kind)
        .ok_or_else(|| format!("Unsupported pushed agent kind: {}", blob.agent_kind))?;
    let email = agent_accounts_email_key(&blob.identity_email);
    let profile_id = agent_account_push_profile_id(kind, &email);
    let root = cloud_mcp_local_data_file_path(AGENT_ACCOUNTS_PROFILE_DIR)
        .ok_or_else(|| "Unable to resolve agent profile storage root.".to_string())?;
    let kind_root = root.join(kind);
    fs::create_dir_all(&kind_root)
        .map_err(|error| format!("Unable to create pushed account profile root: {error}"))?;
    let temp_dir = kind_root.join(format!(".push-{}-{}", profile_id, uuid::Uuid::new_v4()));
    let final_dir = kind_root.join(&profile_id);
    fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Unable to create pushed account profile directory: {error}"))?;
    let write_result = (|| -> Result<(), String> {
        for file in &blob.files {
            let bytes = general_purpose::STANDARD
                .decode(&file.data_b64)
                .map_err(|_| "Pushed agent account file is not valid base64.".to_string())?;
            agent_accounts_write_private_file(&temp_dir.join(&file.name), &bytes)?;
        }
        let materialized_identity = agent_accounts_profile_identity(kind, Some(&temp_dir));
        let materialized_email = materialized_identity
            .get("email")
            .and_then(Value::as_str)
            .map(agent_accounts_email_key)
            .unwrap_or_default();
        if materialized_email != email {
            return Err("Pushed account credentials did not match the sealed identity.".to_string());
        }
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(error);
    }
    agent_accounts_replace_profile_dir_with_backup(&temp_dir, &final_dir)?;

    let mut registry = agent_accounts_registry_read();
    agent_accounts_ensure_kind_entry(&mut registry, kind);
    let profile = json!({
        "id": profile_id,
        "label": if blob.label.trim().is_empty() {
            email.split('@').next().unwrap_or("account").to_string()
        } else {
            blob.label.trim().chars().take(80).collect::<String>()
        },
        "alias": blob.alias.trim().chars().take(40).collect::<String>(),
        "email": email,
        "source": "pushed",
        "dir": final_dir.to_string_lossy().to_string(),
        "createdAtMs": todo_dispatch_now_ms(),
    });
    if let Some(profiles) = registry["agents"][kind]["profiles"].as_array_mut() {
        if let Some(existing) = profiles.iter_mut().find(|entry| {
            entry
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                == profile_id
        }) {
            *existing = profile.clone();
        } else {
            profiles.push(profile.clone());
        }
    }
    registry["agents"][kind]["activeProfileId"] = json!(profile_id.clone());
    agent_accounts_registry_write(&registry);
    Ok(json!({
        "ok": true,
        "agent_kind": kind,
        "agentKind": kind,
        "profile_id": profile_id,
        "profileId": profile_id,
        "identity_email": email,
        "identityEmail": email,
        "dir": final_dir.to_string_lossy().to_string(),
    }))
}

fn agent_accounts_add_suppressed_email(registry: &mut Value, kind: &str, email: &str) {
    let email = agent_accounts_email_key(email);
    if email.is_empty() {
        return;
    }
    agent_accounts_ensure_kind_entry(registry, kind);
    let mut suppressed = agent_accounts_suppressed_emails(registry, kind);
    if !suppressed.iter().any(|entry| entry == &email) {
        suppressed.push(email);
    }
    registry["agents"][kind]["capturedSuppressed"] = json!(suppressed);
}

fn agent_account_push_default_wipe_paths(kind: &str) -> Vec<PathBuf> {
    let names: &[&str] = if kind == "claude" {
        &[".credentials.json"]
    } else {
        agent_account_push_allowed_files(kind)
    };
    names
        .iter()
        .filter_map(|name| agent_account_push_default_file_path(kind, name))
        .collect()
}

#[derive(Clone)]
struct AgentAccountWipeTarget {
    path: PathBuf,
    is_dir: bool,
}

#[derive(Clone)]
struct AgentAccountWipeQuarantine {
    original: PathBuf,
    quarantine: PathBuf,
}

fn agent_account_push_quarantine_path(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("credential");
    parent.join(format!(
        ".diffforge-push-wipe-{}-{name}",
        uuid::Uuid::new_v4()
    ))
}

fn agent_account_push_rollback_quarantines(moves: &[AgentAccountWipeQuarantine]) {
    for moved in moves.iter().rev() {
        if moved.quarantine.exists() && !moved.original.exists() {
            let _ = fs::rename(&moved.quarantine, &moved.original);
        }
    }
}

fn agent_account_push_validate_managed_profile_dir(kind: &str, dir: &Path) -> Result<(), String> {
    let root = cloud_mcp_local_data_file_path(AGENT_ACCOUNTS_PROFILE_DIR)
        .ok_or_else(|| "Unable to resolve agent profile storage root.".to_string())?;
    let canonical_root = fs::canonicalize(&root)
        .map_err(|error| format!("Unable to verify agent profile storage root: {error}"))?;
    let kind_root = root.join(kind);
    let canonical_kind_root = fs::canonicalize(&kind_root)
        .map_err(|error| format!("Unable to verify agent profile kind root: {error}"))?;
    if !canonical_kind_root.starts_with(&canonical_root) {
        return Err("Local account profile kind root is outside managed storage; wipe cancelled.".to_string());
    }

    match fs::symlink_metadata(dir) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err("Local account profile directory is a symlink; wipe cancelled.".to_string());
            }
            let canonical_dir = fs::canonicalize(dir)
                .map_err(|error| format!("Unable to verify local account profile directory: {error}"))?;
            if !canonical_dir.starts_with(&canonical_kind_root) {
                return Err("Local account profile directory is outside managed storage; wipe cancelled.".to_string());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = dir
                .parent()
                .ok_or_else(|| "Local account profile directory is invalid; wipe cancelled.".to_string())?;
            let final_component = dir
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty() && *name != "." && *name != "..")
                .ok_or_else(|| "Local account profile directory is invalid; wipe cancelled.".to_string())?;
            if final_component.contains('/') || final_component.contains('\\') {
                return Err("Local account profile directory is invalid; wipe cancelled.".to_string());
            }
            let canonical_parent = fs::canonicalize(parent)
                .map_err(|error| format!("Unable to verify local account profile parent: {error}"))?;
            if !canonical_parent.starts_with(&canonical_kind_root) {
                return Err("Local account profile directory is outside managed storage; wipe cancelled.".to_string());
            }
        }
        Err(error) => {
            return Err(format!(
                "Unable to inspect local account profile directory: {error}"
            ));
        }
    }
    Ok(())
}

fn agent_accounts_wipe_pushed_profile_internal(
    app: Option<&AppHandle>,
    kind: &str,
    profile_id: &str,
    expected_email: &str,
) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(kind)
        .ok_or_else(|| format!("Unsupported agent kind for local wipe: {kind}"))?;
    let expected_email = agent_accounts_email_key(expected_email);
    if expected_email.is_empty() {
        return Err("Pushed account identity is missing; local wipe cancelled.".to_string());
    }
    let mut registry = agent_accounts_registry_read();
    let (active_id, profiles) = agent_accounts_kind_entry(&registry, kind);
    let mut removed_profile = None;
    let mut profile_dir = None;
    let removed_email = if profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        agent_accounts_default_email(kind)
    } else {
        let profile = profiles
            .iter()
            .find(|profile| agent_accounts_profile_id(profile).as_deref() == Some(profile_id))
            .cloned()
            .ok_or_else(|| format!("Unknown {kind} account profile: {profile_id}"))?;
        let email = agent_accounts_profile_email(kind, &profile);
        profile_dir = agent_accounts_profile_dir(&profile);
        removed_profile = Some(profile);
        email
    };
    if removed_email != expected_email {
        return Err("Local account identity changed; wipe cancelled.".to_string());
    }

    if let Some(dir) = profile_dir.as_ref() {
        agent_account_push_validate_managed_profile_dir(kind, dir)?;
    }

    let default_email = agent_accounts_default_email(kind);
    let wipe_default_home = default_email == expected_email;
    let default_paths = if wipe_default_home {
        agent_account_push_default_wipe_paths(kind)
    } else {
        Vec::new()
    };
    let mut targets = Vec::<AgentAccountWipeTarget>::new();
    if let Some(dir) = profile_dir.as_ref().filter(|dir| dir.exists()) {
        if !dir.is_dir() {
            return Err("Local account profile path is not a directory; wipe cancelled.".to_string());
        }
        targets.push(AgentAccountWipeTarget {
            path: dir.clone(),
            is_dir: true,
        });
    }
    for path in &default_paths {
        if path.exists() {
            if !path.is_file() {
                return Err(format!(
                    "Default credential path is not a regular file; wipe cancelled: {}",
                    path.display()
                ));
            }
            targets.push(AgentAccountWipeTarget {
                path: path.clone(),
                is_dir: false,
            });
        }
    }

    let mut quarantines = Vec::<AgentAccountWipeQuarantine>::new();
    for target in &targets {
        let quarantine = agent_account_push_quarantine_path(&target.path);
        if let Some(parent) = quarantine.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Unable to prepare local wipe quarantine: {error}"))?;
        }
        if let Err(error) = fs::rename(&target.path, &quarantine) {
            agent_account_push_rollback_quarantines(&quarantines);
            return Err(format!("Unable to stage local credential wipe: {error}"));
        }
        quarantines.push(AgentAccountWipeQuarantine {
            original: target.path.clone(),
            quarantine,
        });
    }

    let claude_default_state_backup = if wipe_default_home && kind == "claude" {
        match agent_account_push_splice_claude_default_state(&expected_email) {
            Ok(backup) => backup,
            Err(error) => {
                agent_account_push_rollback_quarantines(&quarantines);
                return Err(error);
            }
        }
    } else {
        None
    };

    let delete_result = (|| -> Result<(), String> {
        for (target, moved) in targets.iter().zip(quarantines.iter()) {
            if target.is_dir {
                fs::remove_dir_all(&moved.quarantine)
                    .map_err(|error| format!("Unable to remove pushed profile directory: {error}"))?;
            } else {
                fs::remove_file(&moved.quarantine)
                    .map_err(|error| format!("Unable to remove default credential file: {error}"))?;
            }
        }
        Ok(())
    })();
    if let Err(error) = delete_result {
        agent_account_push_rollback_quarantines(&quarantines);
        if let Some(original) = claude_default_state_backup.as_deref() {
            agent_account_push_restore_claude_default_state(original);
        }
        return Err(error);
    }

    agent_accounts_ensure_kind_entry(&mut registry, kind);
    if removed_profile.is_some() {
        if let Some(entries) = registry
            .get_mut("agents")
            .and_then(|agents| agents.get_mut(kind))
            .and_then(|entry| entry.get_mut("profiles"))
            .and_then(Value::as_array_mut)
        {
            entries.retain(|profile| agent_accounts_profile_id(profile).as_deref() != Some(profile_id));
        }
        if active_id == profile_id {
            let replacement = profiles
                .iter()
                .filter_map(agent_accounts_profile_id)
                .find(|id| id != profile_id)
                .unwrap_or_else(|| AGENT_ACCOUNTS_DEFAULT_PROFILE_ID.to_string());
            registry["agents"][kind]["activeProfileId"] = json!(replacement);
        }
    }
    if wipe_default_home {
        agent_accounts_add_suppressed_email(&mut registry, kind, &expected_email);
    }
    agent_accounts_registry_write(&registry);
    if let Some(app) = app {
        let _ = app.emit(AGENT_ACCOUNTS_CHANGED_EVENT, json!({ "kind": kind }));
    }
    Ok(json!({
        "ok": true,
        "profile_removed": removed_profile.is_some(),
        "profileRemoved": removed_profile.is_some(),
        "default_home_wiped": wipe_default_home,
        "defaultHomeWiped": wipe_default_home,
    }))
}

fn agent_accounts_suppressed_emails(registry: &Value, kind: &str) -> Vec<String> {
    registry
        .get("agents")
        .and_then(|agents| agents.get(kind))
        .and_then(|entry| entry.get("capturedSuppressed"))
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(agent_accounts_email_key)
                .filter(|value| !value.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn agent_accounts_ensure_kind_entry(registry: &mut Value, kind: &str) {
    if !registry.get("agents").is_some_and(Value::is_object) {
        registry["agents"] = json!({});
    }
    if !registry["agents"].get(kind).is_some_and(Value::is_object) {
        registry["agents"][kind] = json!({
            "activeProfileId": AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
            "profiles": [],
        });
    }
}

/// One capture pass for one agent kind. Returns true when the registry
/// changed (a new account was pinned or a stale suppression was cleared).
fn agent_accounts_capture_kind(kind: &'static str) -> bool {
    let _span = BackendCpuSpan::new("agent_accounts.capture_kind");
    let identity = agent_accounts_profile_identity(kind, None);
    let email = identity
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
    let auth_ready = identity
        .get("authReady")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if email.is_empty() || !auth_ready {
        return false;
    }
    let mut registry = agent_accounts_registry_read();
    let suppressed = agent_accounts_suppressed_emails(&registry, kind);
    if suppressed.iter().any(|entry| entry == &email) {
        return false;
    }
    let mut registry_changed = false;
    if !suppressed.is_empty() {
        // Suppressions only block recapture of the identity that was deleted
        // while still signed in; once the default home moved on, clear them
        // so a deliberate later login re-pins the account.
        agent_accounts_ensure_kind_entry(&mut registry, kind);
        registry["agents"][kind]["capturedSuppressed"] = json!([]);
        registry_changed = true;
    }
    let (_, profiles) = agent_accounts_kind_entry(&registry, kind);
    let existing = profiles
        .iter()
        .find(|profile| agent_accounts_profile_email(kind, profile) == email)
        .cloned();
    if let Some(existing) = existing {
        // Same account still signed in: keep its snapshot's tokens fresh so
        // switching back later doesn't land on an expired refresh token.
        if existing.get("source").and_then(Value::as_str) == Some("captured") {
            if let Some(dir) = existing
                .get("dir")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                agent_accounts_snapshot_refresh(kind, Path::new(dir));
            }
        }
        if registry_changed {
            agent_accounts_registry_write(&registry);
        }
        return registry_changed;
    }
    // New identity in the default home: pin it. The id is deterministic per
    // (kind, email) so a deleted-then-relogged account lands back in its dir.
    let profile_id = format!(
        "cap-{}-{}",
        agent_accounts_email_slug(&email),
        cloud_mcp_short_hash(&format!("{kind}:{email}"))
    );
    let Some(dir) = cloud_mcp_local_data_file_path(AGENT_ACCOUNTS_PROFILE_DIR)
        .map(|root| root.join(kind).join(&profile_id))
    else {
        return registry_changed;
    };
    if fs::create_dir_all(&dir).is_err() {
        return registry_changed;
    }
    agent_accounts_snapshot_refresh(kind, &dir);
    agent_accounts_ensure_kind_entry(&mut registry, kind);
    let label = email.split('@').next().unwrap_or("account").to_string();
    let profile = json!({
        "id": profile_id,
        "label": label,
        "email": email,
        "source": "captured",
        "dir": dir.to_string_lossy().to_string(),
        "createdAtMs": todo_dispatch_now_ms(),
    });
    if let Some(profiles) = registry["agents"][kind]["profiles"].as_array_mut() {
        profiles.push(profile);
    }
    agent_accounts_registry_write(&registry);
    true
}

pub(crate) fn agent_accounts_capture_watch_start(app: AppHandle) {
    let _ = std::thread::Builder::new()
        .name("agent-accounts-capture".to_string())
        .spawn(move || {
            let capture_all = |capture_app: &AppHandle| {
                let _heavy_permit = backend_heavy_job_acquire("agent_accounts.capture_all");
                let _span = BackendCpuSpan::new("agent_accounts.capture_all");
                for kind in ["claude", "codex", "opencode"] {
                    if agent_accounts_capture_kind(kind) {
                        let _ = capture_app.emit(
                            AGENT_ACCOUNTS_CHANGED_EVENT,
                            json!({ "kind": kind, "captured": true }),
                        );
                    }
                }
            };

            // Capture whatever is already on disk once after first paint has had time to settle.
            let startup_capture_app = app.clone();
            let _ = thread::Builder::new()
                .name("agent-accounts-startup-capture".to_string())
                .spawn(move || {
                    thread::sleep(Duration::from_secs(45));
                    let _heavy_permit = backend_heavy_job_acquire("agent_accounts.capture_all");
                    let _span = BackendCpuSpan::new("agent_accounts.capture_all");
                    for kind in ["claude", "codex", "opencode"] {
                        if agent_accounts_capture_kind(kind) {
                            let _ = startup_capture_app.emit(
                                AGENT_ACCOUNTS_CHANGED_EVENT,
                                json!({ "kind": kind, "captured": true }),
                            );
                        }
                    }
                });

            // Event-driven instead of a fixed poll: watch the CLI auth dirs and
            // re-capture only when their files actually change (login / logout /
            // token refresh). At idle this thread makes ~zero CPU wake-ups; the
            // old 4s poll was 15 wakes/min forever. `capture_all` still only
            // emits when the credential signature changed, and a 5-min backstop
            // covers missed events or dirs that didn't exist at startup.
            let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
            let mut watcher = notify::recommended_watcher(tx).ok();
            if let Some(watcher) = watcher.as_mut() {
                for kind in ["claude", "codex", "opencode"] {
                    if let Some(dir) = agent_accounts_default_home(kind) {
                        let _ = notify::Watcher::watch(
                            watcher,
                            &dir,
                            notify::RecursiveMode::NonRecursive,
                        );
                    }
                }
            }

            // Only credential files matter for capture. The watched CLI home
            // dirs (~/.claude, ~/.codex, opencode data home) also churn with
            // agent session/history writes many times a minute; re-running a
            // full identity/capture pass (which re-reads and re-parses large
            // state files) on every unrelated write produced ~15s CPU spikes
            // whenever any agent was active.
            let event_is_credential_related = |event: &notify::Event| {
                event.paths.iter().any(|path| {
                    matches!(
                        path.file_name().and_then(|name| name.to_str()),
                        Some(".credentials.json" | "auth.json" | ".claude.json")
                    )
                })
            };
            const EVENT_CAPTURE_MIN_GAP_SECS: u64 = 30;
            let mut last_event_capture = std::time::Instant::now()
                .checked_sub(std::time::Duration::from_secs(EVENT_CAPTURE_MIN_GAP_SECS))
                .unwrap_or_else(std::time::Instant::now);
            loop {
                match rx.recv_timeout(std::time::Duration::from_secs(300)) {
                    Ok(event) => {
                        // A login writes several files in a burst; drain the
                        // burst (quiet for 400ms) and capture once.
                        let mut relevant = event
                            .as_ref()
                            .map(&event_is_credential_related)
                            .unwrap_or(false);
                        while let Ok(next_event) =
                            rx.recv_timeout(std::time::Duration::from_millis(400))
                        {
                            relevant = relevant
                                || next_event
                                    .as_ref()
                                    .map(&event_is_credential_related)
                                    .unwrap_or(false);
                        }
                        if !relevant {
                            continue;
                        }
                        if last_event_capture.elapsed()
                            < std::time::Duration::from_secs(EVENT_CAPTURE_MIN_GAP_SECS)
                        {
                            // The 300s backstop still covers anything skipped.
                            continue;
                        }
                        last_event_capture = std::time::Instant::now();
                        capture_all(&app);
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => capture_all(&app),
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        // Watcher unavailable: degrade to a slow safety poll.
                        std::thread::sleep(std::time::Duration::from_secs(300));
                        capture_all(&app);
                    }
                }
            }
        });
}

fn agent_accounts_codex_auth_failure_reason(text: &str) -> Option<(&'static str, &'static str)> {
    let lower = text.to_ascii_lowercase();
    if lower.contains("your access token could not be refreshed because you have since logged out")
        || lower.contains("signed in to another account. please sign in again")
    {
        return Some((
            "account_mismatch",
            "Codex could not refresh this account because another account was signed in. Sign in again for this saved account.",
        ));
    }
    if lower.contains("refresh token has expired") {
        return Some((
            "refresh_expired",
            "Codex refresh expired for this saved account. Sign in again for this account.",
        ));
    }
    if lower.contains("refresh token was already used")
        || lower.contains("refresh token has already been used")
    {
        return Some((
            "refresh_reused",
            "Codex refresh was already consumed elsewhere. Sign in again for this saved account.",
        ));
    }
    if lower.contains("refresh token was revoked")
        || lower.contains("refresh_token_invalidated")
    {
        return Some((
            "refresh_revoked",
            "Codex refresh was revoked for this saved account. Sign in again for this account.",
        ));
    }
    if lower.contains("failed to refresh token")
        && (lower.contains("401") || lower.contains("unauthorized"))
    {
        return Some((
            "refresh_failed",
            "Codex could not refresh this saved account. Sign in again for this account.",
        ));
    }
    None
}

pub(crate) fn agent_accounts_observe_terminal_auth_output(
    app: &AppHandle,
    pane_id: &str,
    scan_tail: &mut String,
    chunk: &[u8],
) -> bool {
    if chunk.is_empty() {
        return false;
    }
    scan_tail.push_str(&String::from_utf8_lossy(chunk));
    if scan_tail.len() > AGENT_ACCOUNTS_AUTH_SCAN_MAX_CHARS {
        let drain_to = scan_tail.len().saturating_sub(AGENT_ACCOUNTS_AUTH_SCAN_MAX_CHARS);
        if scan_tail.is_char_boundary(drain_to) {
            scan_tail.drain(..drain_to);
        } else {
            scan_tail.clear();
            scan_tail.push_str(&String::from_utf8_lossy(chunk));
        }
    }
    let Some((reason, message)) = agent_accounts_codex_auth_failure_reason(scan_tail) else {
        return false;
    };
    agent_accounts_mark_pane_auth_issue(app, pane_id, reason, message)
}

fn agent_accounts_mark_pane_auth_issue(
    app: &AppHandle,
    pane_id: &str,
    reason: &str,
    message: &str,
) -> bool {
    let stamp = AGENT_ACCOUNTS_PANE_PROFILES
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
        .ok()
        .and_then(|map| map.get(pane_id).cloned());
    let Some(stamp) = stamp else {
        return false;
    };
    let Some(kind) = stamp
        .get("kind")
        .and_then(Value::as_str)
        .and_then(agent_accounts_supported_kind)
    else {
        return false;
    };
    if kind != "codex" {
        return false;
    }
    let profile_id = stamp
        .get("profileId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(AGENT_ACCOUNTS_DEFAULT_PROFILE_ID)
        .to_string();

    let mut registry = agent_accounts_registry_read();
    agent_accounts_ensure_kind_entry(&mut registry, kind);
    let mut profile_for_signature = None;
    if profile_id != AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        profile_for_signature = registry
            .get("agents")
            .and_then(|agents| agents.get(kind))
            .and_then(|entry| entry.get("profiles"))
            .and_then(Value::as_array)
            .and_then(|profiles| {
                profiles.iter().find(|profile| {
                    profile
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        == profile_id
                })
            })
            .cloned();
        if profile_for_signature.is_none() {
            return false;
        }
    }
    let auth_file_signature =
        agent_accounts_auth_signature_for_profile(kind, &profile_id, profile_for_signature.as_ref())
            .unwrap_or_default();
    let issue = json!({
        "needsLogin": true,
        "reason": reason,
        "message": message,
        "detectedAtMs": todo_dispatch_now_ms(),
        "authFileSignature": auth_file_signature,
    });

    let mut changed = false;
    if profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        let current = registry["agents"][kind]
            .get(AGENT_ACCOUNTS_DEFAULT_AUTH_ISSUE_KEY)
            .cloned();
        if current.as_ref() != Some(&issue) {
            registry["agents"][kind][AGENT_ACCOUNTS_DEFAULT_AUTH_ISSUE_KEY] = issue;
            changed = true;
        }
    } else if let Some(profile) = registry
        .get_mut("agents")
        .and_then(|agents| agents.get_mut(kind))
        .and_then(|entry| entry.get_mut("profiles"))
        .and_then(Value::as_array_mut)
        .and_then(|profiles| {
            profiles.iter_mut().find(|profile| {
                profile
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    == profile_id
            })
        })
    {
        let current = profile.get(AGENT_ACCOUNTS_AUTH_ISSUE_KEY).cloned();
        if current.as_ref() != Some(&issue) {
            profile[AGENT_ACCOUNTS_AUTH_ISSUE_KEY] = issue;
            changed = true;
        }
    }

    if changed {
        agent_accounts_registry_write(&registry);
        let _ = app.emit(
            AGENT_ACCOUNTS_CHANGED_EVENT,
            json!({
                "kind": kind,
                "profileId": profile_id,
                "authIssue": true,
                "reason": reason,
            }),
        );
    }
    changed
}

fn agent_accounts_profile_login_target(
    kind: &'static str,
    profile_id: &str,
) -> Result<(PathBuf, bool), String> {
    if profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        let dir = agent_accounts_default_home(kind)
            .ok_or_else(|| format!("Unable to resolve default {kind} account home."))?;
        return Ok((dir, true));
    }
    let registry = agent_accounts_registry_read();
    let (_, profiles) = agent_accounts_kind_entry(&registry, kind);
    let profile = profiles
        .iter()
        .find(|profile| {
            profile
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                == profile_id
        })
        .ok_or_else(|| format!("Unknown {kind} account profile: {profile_id}"))?;
    let dir = agent_accounts_profile_dir(profile)
        .ok_or_else(|| format!("{kind} account profile has no directory: {profile_id}"))?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Unable to prepare {kind} account profile dir: {error}"))?;
    Ok((dir, false))
}

fn agent_accounts_launch_profile_login_terminal(
    kind: &'static str,
    profile_id: &str,
) -> Result<(), String> {
    let (dir, is_default) = agent_accounts_profile_login_target(kind, profile_id)?;
    let provider = agent_accounts_provider_for_kind(kind);
    if is_default {
        return launch_account_login_terminal(provider);
    }

    let definition = agent_definition(provider);
    let binary = npm_global_executable_path(definition)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| definition.binary.to_string());
    let dir_text = dir.to_string_lossy().to_string();
    let (args, env_vars): (Vec<&str>, Vec<(String, String)>) = match kind {
        "claude" => (
            vec!["/login"],
            vec![("CLAUDE_CONFIG_DIR".to_string(), dir_text)],
        ),
        "opencode" => (
            vec!["auth", "login"],
            vec![("OPENCODE_DATA_DIR".to_string(), dir_text)],
        ),
        _ => (
            vec!["login"],
            vec![("CODEX_HOME".to_string(), dir_text)],
        ),
    };
    run_login_terminal_with_env(definition.label, &binary, &args, &env_vars)
}

fn agent_accounts_provider_for_kind(kind: &str) -> AgentProvider {
    match kind {
        "claude" => AgentProvider::Claude,
        "opencode" => AgentProvider::OpenCode,
        _ => AgentProvider::Codex,
    }
}

#[tauri::command]
async fn agent_accounts_state() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _span = BackendCpuSpan::new("agent_accounts.command.state");
        let registry = agent_accounts_registry_read_resolved();
        Ok(json!({
            "agents": {
                "claude": agent_accounts_kind_state(&registry, "claude"),
                "codex": agent_accounts_kind_state(&registry, "codex"),
                "opencode": agent_accounts_kind_state(&registry, "opencode"),
            }
        }))
    })
    .await
    .map_err(|error| format!("Agent accounts state worker failed: {error}"))?
}

#[tauri::command]
async fn agent_accounts_start_profile_login(
    app: AppHandle,
    agent_kind: String,
    profile_id: String,
) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(&agent_kind)
        .ok_or_else(|| format!("Unsupported agent kind for accounts: {agent_kind}"))?;
    let profile_id = profile_id.trim().to_string();
    if profile_id.is_empty() {
        return Err("A profile id is required.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        agent_accounts_launch_profile_login_terminal(kind, &profile_id)?;
        let _ = app.emit(
            AGENT_ACCOUNTS_CHANGED_EVENT,
            json!({ "kind": kind, "profileId": profile_id, "loginStarted": true }),
        );
        Ok(json!({ "ok": true, "kind": kind, "profileId": profile_id }))
    })
    .await
    .map_err(|error| format!("Agent account login worker failed: {error}"))?
}

/// Alias + display preferences for one account pill. The pill shows the alias
/// INSTEAD of the email when one is set (streaming privacy), so the default
/// profile is aliasable too — its alias lives at the kind entry level because
/// the default view is synthesized, not a registry profile. Only connected
/// profiles (a signed-in identity is present) can be customized — the alias
/// names an account, not an empty dir.
#[tauri::command]
async fn agent_accounts_update_display(
    app: AppHandle,
    agent_kind: String,
    profile_id: String,
    alias: Option<String>,
    show_alias: Option<bool>,
    show_email: Option<bool>,
) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(&agent_kind)
        .ok_or_else(|| format!("Unsupported agent kind for accounts: {agent_kind}"))?;
    let profile_id = profile_id.trim().to_string();
    if profile_id.is_empty() {
        return Err("A profile id is required.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut registry = agent_accounts_registry_read();
        if profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
            let default_email = agent_accounts_default_email(kind);
            if default_email.is_empty() {
                return Err(
                    "Only connected accounts (with a signed-in identity) can be customized."
                        .to_string(),
                );
            }
            agent_accounts_ensure_kind_entry(&mut registry, kind);
            if let Some(alias) = alias {
                registry["agents"][kind]["defaultAlias"] =
                    json!(alias.trim().chars().take(40).collect::<String>());
            }
            agent_accounts_registry_write(&registry);
            let _ = app.emit(AGENT_ACCOUNTS_CHANGED_EVENT, json!({ "kind": kind }));
            return Ok(json!({ "ok": true }));
        }
        let profile = registry
            .get_mut("agents")
            .and_then(|agents| agents.get_mut(kind))
            .and_then(|entry| entry.get_mut("profiles"))
            .and_then(Value::as_array_mut)
            .and_then(|profiles| {
                profiles.iter_mut().find(|profile| {
                    profile
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        == profile_id
                })
            })
            .ok_or_else(|| format!("Unknown {kind} account profile: {profile_id}"))?;
        if agent_accounts_profile_email(kind, profile).is_empty() {
            return Err(
                "Only connected accounts (with a signed-in identity) can be customized."
                    .to_string(),
            );
        }
        if let Some(alias) = alias {
            profile["alias"] = json!(alias.trim().chars().take(40).collect::<String>());
        }
        if let Some(show_alias) = show_alias {
            profile["showAlias"] = json!(show_alias);
        }
        if let Some(show_email) = show_email {
            profile["showEmail"] = json!(show_email);
        }
        agent_accounts_registry_write(&registry);
        let _ = app.emit(AGENT_ACCOUNTS_CHANGED_EVENT, json!({ "kind": kind }));
        Ok(json!({ "ok": true }))
    })
    .await
    .map_err(|error| format!("Agent accounts update-display worker failed: {error}"))?
}

#[tauri::command]
async fn agent_accounts_set_active(
    app: AppHandle,
    agent_kind: String,
    profile_id: String,
) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(&agent_kind)
        .ok_or_else(|| format!("Unsupported agent kind for accounts: {agent_kind}"))?;
    let profile_id = profile_id.trim().to_string();
    if profile_id.is_empty() {
        return Err("A profile id is required.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut registry = agent_accounts_registry_read();
        let (_, profiles) = agent_accounts_kind_entry(&registry, kind);
        if profile_id != AGENT_ACCOUNTS_DEFAULT_PROFILE_ID
            && !profiles.iter().any(|profile| {
                profile
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    == profile_id
            })
        {
            return Err(format!("Unknown {kind} account profile: {profile_id}"));
        }
        let active_profile_id = profile_id.clone();
        if !registry.get("agents").is_some_and(Value::is_object) {
            registry["agents"] = json!({});
        }
        if !registry["agents"].get(kind).is_some_and(Value::is_object) {
            registry["agents"][kind] = json!({ "profiles": [] });
        }
        registry["agents"][kind]["activeProfileId"] = json!(active_profile_id);
        agent_accounts_registry_write(&registry);
        let _ = app.emit(
            AGENT_ACCOUNTS_CHANGED_EVENT,
            json!({ "kind": kind, "activeProfileId": active_profile_id }),
        );
        Ok(json!({ "ok": true, "kind": kind, "activeProfileId": active_profile_id }))
    })
    .await
    .map_err(|error| format!("Agent accounts set-active worker failed: {error}"))?
}

#[tauri::command]
async fn agent_account_push_to_device(
    app: AppHandle,
    state: State<'_, CloudMcpState>,
    agent_kind: String,
    profile_id: String,
    target_device_id: String,
    wipe_local_after: bool,
) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(&agent_kind)
        .ok_or_else(|| format!("Unsupported agent kind for account push: {agent_kind}"))?;
    let profile_id = profile_id.trim().to_string();
    if profile_id.is_empty() {
        return Err("A profile id is required.".to_string());
    }
    let target_device_id = target_device_id.trim().to_string();
    if target_device_id.is_empty() {
        return Err("A target device id is required.".to_string());
    }
    let local_device = cloud_mcp_desktop_device_profile();
    let local_device_id =
        cloud_mcp_payload_text(&local_device, &["device_id", "deviceId"]).unwrap_or_default();
    if agent_account_push_normalized_device_id(&target_device_id)
        == agent_account_push_normalized_device_id(&local_device_id)
    {
        return Err("Choose a different device; this account is already on the current device.".to_string());
    }

    let target_device = agent_account_push_target_device(state.inner(), &target_device_id).await?;
    let (target_push_public_key, sealed_algorithm) = agent_account_push_target_key(&target_device)?;
    let push_id = uuid::Uuid::new_v4().to_string();
    if let Err(error) =
        agent_account_push_verify_or_pin_target_key(&target_device_id, &target_push_public_key)
    {
        agent_account_push_emit(
            &app,
            &push_id,
            &target_device_id,
            kind,
            &profile_id,
            "failed",
            Some(&error),
        );
        return Err(error);
    }
    agent_account_push_emit(
        &app,
        &push_id,
        &target_device_id,
        kind,
        &profile_id,
        "sealing",
        None,
    );

    let profile_id_for_bundle = profile_id.clone();
    let push_id_for_bundle = push_id.clone();
    let target_device_id_for_bundle = target_device_id.clone();
    let sender_device_id_for_bundle = local_device_id.clone();
    let target_key_for_bundle = target_push_public_key.clone();
    let sealed = tauri::async_runtime::spawn_blocking(move || {
        let blob = agent_account_push_profile_bundle(
            kind,
            &profile_id_for_bundle,
            &push_id_for_bundle,
            &target_device_id_for_bundle,
            &sender_device_id_for_bundle,
        )?;
        let identity_email = blob.identity_email.clone();
        let plaintext = serde_json::to_vec(&blob)
            .map_err(|error| format!("Unable to encode agent account push payload: {error}"))?;
        let sealed_blob = agent_account_push_seal_blob(&target_key_for_bundle, &plaintext)?;
        Ok::<_, String>((sealed_blob, identity_email))
    })
    .await
    .map_err(|error| format!("Agent account push sealing worker failed: {error}"))?;
    let (sealed_blob, identity_email) = match sealed {
        Ok(value) => value,
        Err(error) => {
            agent_account_push_emit(
                &app,
                &push_id,
                &target_device_id,
                kind,
                &profile_id,
                "failed",
                Some(&error),
            );
            return Err(error);
        }
    };

    agent_account_push_emit(
        &app,
        &push_id,
        &target_device_id,
        kind,
        &profile_id,
        "uploading",
        None,
    );
    {
        let mut pending = agent_account_push_pending()
            .lock()
            .map_err(|_| "Agent account push pending state is unavailable.".to_string())?;
        pending.insert(
            push_id.clone(),
            AgentAccountPushPending {
                agent_kind: kind.to_string(),
                profile_id: profile_id.clone(),
                target_device_id: target_device_id.clone(),
                wipe_local_after,
                identity_email: identity_email.clone(),
                delivered: false,
            },
        );
    }

    let command_id = format!("agent-account-push-{push_id}");
    let sender_device = cloud_mcp_desktop_device_profile();
    let target_device_name = agent_account_push_first_text(
        &target_device,
        &[
            &["device_name"][..],
            &["deviceName"][..],
            &["machine_name"][..],
            &["machineName"][..],
            &["name"][..],
        ],
    )
    .unwrap_or_else(|| target_device_id.clone());
    let request = json!({
        "kind": "remote_command_requested",
        "event_kind": "remote_command_requested",
        "eventKind": "remote_command_requested",
        "source": "rust-diffforge-agent-account-push",
        "command_id": command_id.clone(),
        "commandId": command_id,
        "command_kind": "agent_account_push",
        "commandKind": "agent_account_push",
        "intent_id": push_id.clone(),
        "intentId": push_id.clone(),
        "push_id": push_id.clone(),
        "pushId": push_id.clone(),
        "agent_kind": kind,
        "agentKind": kind,
        "provider": kind,
        "profile_id": profile_id.clone(),
        "profileId": profile_id.clone(),
        "target_device_id": target_device_id.clone(),
        "targetDeviceId": target_device_id.clone(),
        "target_device_name": target_device_name.clone(),
        "targetDeviceName": target_device_name,
        "sealed_blob": sealed_blob.clone(),
        "sealedBlob": sealed_blob,
        "sealed_algorithm": sealed_algorithm.clone(),
        "sealedAlgorithm": sealed_algorithm,
        "sender_device": sender_device.clone(),
        "senderDevice": sender_device.clone(),
        "device": sender_device.clone(),
        "device_id": sender_device["device_id"].clone(),
        "deviceId": sender_device["device_id"].clone(),
        "device_name": sender_device["device_name"].clone(),
        "deviceName": sender_device["device_name"].clone(),
        "machine_name": sender_device["machine_name"].clone(),
        "machineName": sender_device["machine_name"].clone(),
        "wipe_local_after": wipe_local_after,
        "wipeLocalAfter": wipe_local_after,
        "ts_ms": todo_dispatch_now_ms(),
    });
    if let Err(error) =
        cloud_mcp_send_remote_command_over_app_ws_once(state.inner(), &request, "agent-account-push")
            .await
    {
        if let Ok(mut pending) = agent_account_push_pending().lock() {
            pending.remove(&push_id);
        }
        agent_account_push_emit(
            &app,
            &push_id,
            &target_device_id,
            kind,
            &profile_id,
            "failed",
            Some(&error),
        );
        return Err(error);
    }

    Ok(json!({
        "ok": true,
        "pushId": push_id,
        "push_id": push_id,
    }))
}

#[tauri::command]
async fn agent_accounts_remove(
    app: AppHandle,
    agent_kind: String,
    profile_id: String,
) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(&agent_kind)
        .ok_or_else(|| format!("Unsupported agent kind for accounts: {agent_kind}"))?;
    let profile_id = profile_id.trim().to_string();
    if profile_id.is_empty() || profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        return Err("The default account cannot be removed.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut registry = agent_accounts_registry_read();
        let (active_id, profiles) = agent_accounts_kind_entry(&registry, kind);
        if active_id == profile_id {
            return Err(
                "Switch to another account first — the active account can't be deleted."
                    .to_string(),
            );
        }
        let removed = profiles
            .iter()
            .find(|profile| {
                profile
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    == profile_id
            })
            .cloned()
            .ok_or_else(|| format!("Unknown {kind} account profile: {profile_id}"))?;
        if let Some(entries) = registry
            .get_mut("agents")
            .and_then(|agents| agents.get_mut(kind))
            .and_then(|entry| entry.get_mut("profiles"))
            .and_then(Value::as_array_mut)
        {
            entries.retain(|profile| {
                profile
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    != profile_id
            });
        }
        // Deleting an account that is still signed into the default home must
        // not bounce straight back in via the capture watcher: suppress that
        // identity until the default home moves to a different account.
        let removed_email = agent_accounts_profile_email(kind, &removed);
        let current_email = agent_accounts_profile_identity(kind, None)
            .get("email")
            .and_then(Value::as_str)
            .map(agent_accounts_email_key)
            .unwrap_or_default();
        if !removed_email.is_empty() && removed_email == current_email {
            agent_accounts_ensure_kind_entry(&mut registry, kind);
            let mut suppressed = agent_accounts_suppressed_emails(&registry, kind);
            if !suppressed.iter().any(|entry| entry == &removed_email) {
                suppressed.push(removed_email);
            }
            registry["agents"][kind]["capturedSuppressed"] = json!(suppressed);
        }
        agent_accounts_registry_write(&registry);
        // Profiles are credential snapshots, so a delete is a real delete —
        // but only ever inside the managed agent-profiles root.
        if let (Some(dir), Some(root)) = (
            removed
                .get("dir")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from),
            cloud_mcp_local_data_file_path(AGENT_ACCOUNTS_PROFILE_DIR),
        ) {
            if dir.starts_with(&root) {
                let _ = fs::remove_dir_all(&dir);
            }
        }
        let _ = app.emit(AGENT_ACCOUNTS_CHANGED_EVENT, json!({ "kind": kind }));
        Ok(json!({ "ok": true }))
    })
    .await
    .map_err(|error| format!("Agent accounts remove worker failed: {error}"))?
}

/// Pane → launch-profile stamps plus the current launch ids, for the webview's
/// stale-terminal chips ("account switched — restart to use X"). Default
/// accounts resolve to captured snapshots when possible, so a later default
/// login change can still mark older panes stale.
#[tauri::command]
async fn agent_accounts_pane_profiles() -> Result<Value, String> {
    let registry = agent_accounts_registry_read_resolved();
    let panes = AGENT_ACCOUNTS_PANE_PROFILES
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
        .map(|map| {
            map.iter()
                .map(|(pane_id, stamp)| (pane_id.clone(), stamp.clone()))
                .collect::<serde_json::Map<String, Value>>()
        })
        .unwrap_or_default();
    let (claude_active, claude_label) = agent_accounts_launch_profile_label("claude");
    let (codex_active, codex_label) = agent_accounts_launch_profile_label("codex");
    let (opencode_active, opencode_label) = agent_accounts_launch_profile_label("opencode");
    let auth = json!({
        "claude": agent_accounts_kind_auth_statuses(&registry, "claude"),
        "codex": agent_accounts_kind_auth_statuses(&registry, "codex"),
        "opencode": agent_accounts_kind_auth_statuses(&registry, "opencode"),
    });
    Ok(json!({
        "panes": panes,
        "active": {
            "claude": { "profileId": claude_active, "profileLabel": claude_label },
            "codex": { "profileId": codex_active, "profileLabel": codex_label },
            "opencode": { "profileId": opencode_active, "profileLabel": opencode_label },
        },
        "auth": auth,
    }))
}

#[cfg(test)]
mod agent_accounts_tests {
    use super::*;

    static AGENT_ACCOUNTS_TEST_ENV_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();

    struct ScopedAgentAccountsEnv {
        key: &'static str,
        previous: Option<std::ffi::OsString>,
    }

    impl ScopedAgentAccountsEnv {
        fn set(key: &'static str, value: &Path) -> Self {
            let previous = env::var_os(key);
            env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for ScopedAgentAccountsEnv {
        fn drop(&mut self) {
            if let Some(previous) = &self.previous {
                env::set_var(self.key, previous);
            } else {
                env::remove_var(self.key);
            }
        }
    }

    fn test_codex_auth_for_email(email: &str) -> String {
        let claims = general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&json!({ "email": email })).unwrap());
        serde_json::to_string(&json!({ "tokens": { "id_token": format!("h.{claims}.s") } }))
            .unwrap()
    }

    fn test_claude_state_for_email(email: &str) -> String {
        serde_json::to_string(&json!({ "oauthAccount": { "emailAddress": email } })).unwrap()
    }

    fn test_claude_state_with_globals(email: &str) -> String {
        serde_json::to_string(&json!({
            "oauthAccount": { "emailAddress": email, "displayName": "Pushed Claude" },
            "projects": { "project-a": { "allowedTools": ["Bash"] } },
            "mcpServers": { "server-a": { "command": "secret-server" } },
            "theme": "dark",
        }))
        .unwrap()
    }

    fn test_write_codex_profile(dir: &Path, email: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("auth.json"), test_codex_auth_for_email(email)).unwrap();
        fs::write(dir.join("config.toml"), "model = \"gpt-5\"\n").unwrap();
    }

    fn test_agent_account_push_blob(
        push_id: &str,
        target_device_id: &str,
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> AgentAccountPushBlob {
        AgentAccountPushBlob {
            version: 1,
            contract: AGENT_ACCOUNT_PUSH_CONTRACT.to_string(),
            push_id: push_id.to_string(),
            target_device_id: target_device_id.to_string(),
            sender_device_id: "device-source".to_string(),
            issued_at_ms,
            expires_at_ms,
            agent_kind: "codex".to_string(),
            source_profile_id: AGENT_ACCOUNTS_DEFAULT_PROFILE_ID.to_string(),
            identity_email: "pushed@example.com".to_string(),
            label: "Pushed".to_string(),
            alias: String::new(),
            files: vec![AgentAccountPushFile {
                name: "auth.json".to_string(),
                data_b64: general_purpose::STANDARD.encode(test_codex_auth_for_email("pushed@example.com")),
            }],
        }
    }

    #[test]
    fn supported_kind_normalizes_provider_ids() {
        assert_eq!(agent_accounts_supported_kind("claude"), Some("claude"));
        assert_eq!(agent_accounts_supported_kind("Claude Code"), Some("claude"));
        assert_eq!(agent_accounts_supported_kind("codex"), Some("codex"));
        assert_eq!(agent_accounts_supported_kind("console"), Some("codex"));
        assert_eq!(agent_accounts_supported_kind("opencode"), Some("opencode"));
        assert_eq!(agent_accounts_supported_kind("OpenCode"), Some("opencode"));
        assert_eq!(agent_accounts_supported_kind("generic"), None);
    }

    #[test]
    fn codex_email_reads_id_token_payload() {
        let auth =
            serde_json::from_str::<Value>(&test_codex_auth_for_email("dev@example.com")).unwrap();
        assert_eq!(
            agent_accounts_codex_email_from_auth(&auth),
            "dev@example.com"
        );
        assert_eq!(agent_accounts_codex_email_from_auth(&json!({})), "");
    }

    #[test]
    fn email_key_and_slug_normalize() {
        assert_eq!(
            agent_accounts_email_key(" Dev@Example.COM "),
            "dev@example.com"
        );
        assert_eq!(
            agent_accounts_email_slug("dev.person+x@example.com"),
            "dev-person-x"
        );
        assert_eq!(agent_accounts_email_slug("@nowhere"), "account");
    }

    #[test]
    fn profile_email_prefers_stored_capture_identity() {
        let profile = json!({ "email": " Dev@Example.com ", "dir": "/nonexistent-dir" });
        assert_eq!(
            agent_accounts_profile_email("codex", &profile),
            "dev@example.com"
        );
        assert_eq!(agent_accounts_profile_email("codex", &json!({})), "");
    }

    #[test]
    fn display_label_prefers_alias_over_label() {
        assert_eq!(
            agent_accounts_profile_display_label(&json!({ "alias": "Work", "label": "dev" })),
            "Work"
        );
        assert_eq!(
            agent_accounts_profile_display_label(&json!({ "alias": "  ", "label": "dev" })),
            "dev"
        );
        assert_eq!(agent_accounts_profile_display_label(&json!({})), "Account");
    }

    #[test]
    fn duplicate_of_default_is_hidden_even_when_active() {
        let captured = json!({
            "id": "cap-x",
            "email": "dev@example.com",
            "source": "captured",
            "dir": "/nonexistent-dir",
        });
        assert!(agent_accounts_profile_is_duplicate_of_default(
            "codex",
            &captured,
            "dev@example.com"
        ));
        // The active duplicate maps back to Default instead of rendering as
        // a second account row for the same email.
        assert!(agent_accounts_profile_is_duplicate_of_default(
            "codex",
            &captured,
            "dev@example.com"
        ));
        // A different default identity un-hides the pin.
        assert!(!agent_accounts_profile_is_duplicate_of_default(
            "codex",
            &captured,
            "other@example.com"
        ));
        // The invariant is by email, not by source.
        let manual = json!({ "id": "m1", "email": "dev@example.com", "dir": "/nonexistent-dir" });
        assert!(agent_accounts_profile_is_duplicate_of_default(
            "codex",
            &manual,
            "dev@example.com"
        ));
    }

    #[test]
    fn active_duplicate_email_stays_on_selected_profile() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_duplicate_email_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let default_codex_home = home.join(".codex");
        let duplicate_dir = data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("codex")
            .join("cap-admin");
        let work_dir = data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("codex")
            .join("cap-work");
        fs::create_dir_all(&default_codex_home).unwrap();
        fs::create_dir_all(&duplicate_dir).unwrap();
        fs::create_dir_all(&work_dir).unwrap();
        fs::write(
            default_codex_home.join("auth.json"),
            test_codex_auth_for_email("admin@example.com"),
        )
        .unwrap();
        fs::write(
            duplicate_dir.join("auth.json"),
            test_codex_auth_for_email("admin@example.com"),
        )
        .unwrap();
        fs::write(
            work_dir.join("auth.json"),
            test_codex_auth_for_email("work@example.com"),
        )
        .unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        agent_accounts_registry_write(&json!({
            "agents": {
                "codex": {
                    "activeProfileId": "cap-admin",
                    "profiles": [
                        {
                            "id": "cap-admin",
                            "email": "admin@example.com",
                            "alias": "Admin",
                            "label": "admin",
                            "source": "captured",
                            "dir": duplicate_dir.to_string_lossy().to_string(),
                        },
                        {
                            "id": "cap-work",
                            "email": "work@example.com",
                            "label": "work",
                            "source": "captured",
                            "dir": work_dir.to_string_lossy().to_string(),
                        }
                    ],
                }
            }
        }));

        let registry = agent_accounts_registry_read();
        let state = agent_accounts_kind_state(&registry, "codex");
        let profiles = state["profiles"].as_array().unwrap();
        let visible_ids = profiles
            .iter()
            .filter_map(|profile| profile["id"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(visible_ids, vec!["default", "cap-admin", "cap-work"]);
        assert_eq!(profiles[0]["isActive"].as_bool(), Some(false));
        assert_eq!(profiles[1]["isActive"].as_bool(), Some(true));
        assert_eq!(profiles[0]["alias"].as_str(), Some("Admin"));
        assert!(agent_accounts_duplicate_profile_ids("codex").is_empty());
        let tokenomics_ids = agent_accounts_profiles_for_tokenomics("codex")
            .into_iter()
            .map(|(id, _, _)| id)
            .collect::<Vec<_>>();
        assert_eq!(tokenomics_ids, vec!["cap-admin".to_string(), "cap-work".to_string()]);

        assert!(!agent_accounts_capture_kind("codex"));
        let registry_after = agent_accounts_registry_read();
        assert_eq!(
            registry_after["agents"]["codex"]["activeProfileId"].as_str(),
            Some("cap-admin")
        );
    }

    #[test]
    fn default_active_resolves_to_current_device_codex_profile() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_default_device_active_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let default_codex_home = home.join(".codex");
        let device_dir = data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("codex")
            .join("cap-device");
        let other_dir = data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("codex")
            .join("cap-other");
        fs::create_dir_all(&default_codex_home).unwrap();
        fs::create_dir_all(&device_dir).unwrap();
        fs::create_dir_all(&other_dir).unwrap();
        fs::write(
            default_codex_home.join("auth.json"),
            test_codex_auth_for_email("device@example.com"),
        )
        .unwrap();
        fs::write(
            device_dir.join("auth.json"),
            test_codex_auth_for_email("device@example.com"),
        )
        .unwrap();
        fs::write(
            other_dir.join("auth.json"),
            test_codex_auth_for_email("other@example.com"),
        )
        .unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        agent_accounts_registry_write(&json!({
            "agents": {
                "codex": {
                    "activeProfileId": AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
                    "profiles": [
                        {
                            "id": "cap-device",
                            "email": "device@example.com",
                            "alias": "Device",
                            "label": "device",
                            "source": "captured",
                            "dir": device_dir.to_string_lossy().to_string(),
                        },
                        {
                            "id": "cap-other",
                            "email": "other@example.com",
                            "label": "other",
                            "source": "captured",
                            "dir": other_dir.to_string_lossy().to_string(),
                        }
                    ],
                }
            }
        }));

        let registry = agent_accounts_registry_read();
        let state = agent_accounts_kind_state(&registry, "codex");
        assert_eq!(state["activeProfileId"].as_str(), Some("cap-device"));
        let profiles = state["profiles"].as_array().unwrap();
        let active_ids = profiles
            .iter()
            .filter(|profile| profile["isActive"].as_bool() == Some(true))
            .filter_map(|profile| profile["id"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(active_ids, vec!["cap-device"]);
        assert_eq!(
            agent_accounts_active_profile_id_for_tokenomics("codex"),
            "cap-device".to_string()
        );
    }

    #[test]
    fn suppressed_emails_read_normalized() {
        let registry = json!({
            "agents": { "codex": { "capturedSuppressed": [" A@B.com ", "", 7] } }
        });
        assert_eq!(
            agent_accounts_suppressed_emails(&registry, "codex"),
            vec!["a@b.com".to_string()]
        );
        assert!(agent_accounts_suppressed_emails(&json!({}), "claude").is_empty());
    }

    #[test]
    fn codex_refresh_failure_text_is_detected() {
        let (reason, message) = agent_accounts_codex_auth_failure_reason(
            "Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.",
        )
        .unwrap();
        assert_eq!(reason, "account_mismatch");
        assert!(message.contains("Sign in again"));

        let (reason, _) =
            agent_accounts_codex_auth_failure_reason("Failed to refresh token: 401 Unauthorized")
                .unwrap();
        assert_eq!(reason, "refresh_failed");
        assert!(agent_accounts_codex_auth_failure_reason("ordinary output").is_none());
    }

    #[test]
    fn auth_issue_clears_after_profile_auth_file_changes() {
        let root = env::temp_dir().join(format!(
            "agent_accounts_auth_issue_{}",
            uuid::Uuid::new_v4()
        ));
        let profile_dir = root.join("profile");
        fs::create_dir_all(&profile_dir).unwrap();
        fs::write(
            profile_dir.join("auth.json"),
            test_codex_auth_for_email("dev@example.com"),
        )
        .unwrap();
        let mut profile = json!({
            "id": "cap-dev",
            "email": "dev@example.com",
            "source": "captured",
            "dir": profile_dir.to_string_lossy().to_string(),
        });
        let signature =
            agent_accounts_auth_signature_for_profile("codex", "cap-dev", Some(&profile)).unwrap();
        profile[AGENT_ACCOUNTS_AUTH_ISSUE_KEY] = json!({
            "needsLogin": true,
            "reason": "refresh_expired",
            "message": "Sign in again.",
            "detectedAtMs": 1,
            "authFileSignature": signature,
        });
        let identity = agent_accounts_profile_identity("codex", Some(&profile_dir));
        let status = agent_accounts_auth_status(
            "codex",
            "cap-dev",
            Some(&profile),
            &identity,
            profile.get(AGENT_ACCOUNTS_AUTH_ISSUE_KEY),
        );
        assert_eq!(status["needsLogin"].as_bool(), Some(true));

        fs::write(
            profile_dir.join("auth.json"),
            test_codex_auth_for_email("dev@example.com")
                .replace("h.", "h.changed-",)
                .replace(".s", ".changed-s"),
        )
        .unwrap();
        let mut registry = json!({
            "agents": {
                "codex": {
                    "activeProfileId": "cap-dev",
                    "profiles": [profile],
                }
            }
        });
        assert!(agent_accounts_clear_resolved_auth_issues_for_kind(
            &mut registry,
            "codex"
        ));
        assert!(registry["agents"]["codex"]["profiles"][0]
            .get(AGENT_ACCOUNTS_AUTH_ISSUE_KEY)
            .is_none());
    }

    #[test]
    fn auth_issue_without_signature_clears_after_auth_file_appears() {
        let root = env::temp_dir().join(format!(
            "agent_accounts_missing_auth_issue_{}",
            uuid::Uuid::new_v4()
        ));
        let profile_dir = root.join("profile");
        fs::create_dir_all(&profile_dir).unwrap();
        let mut profile = json!({
            "id": "cap-dev",
            "email": "dev@example.com",
            "source": "captured",
            "dir": profile_dir.to_string_lossy().to_string(),
        });
        profile[AGENT_ACCOUNTS_AUTH_ISSUE_KEY] = json!({
            "needsLogin": true,
            "reason": "refresh_failed",
            "message": "Sign in again.",
            "detectedAtMs": 1,
        });
        let identity = agent_accounts_profile_identity("codex", Some(&profile_dir));
        let status = agent_accounts_auth_status(
            "codex",
            "cap-dev",
            Some(&profile),
            &identity,
            profile.get(AGENT_ACCOUNTS_AUTH_ISSUE_KEY),
        );
        assert_eq!(status["needsLogin"].as_bool(), Some(true));

        fs::write(
            profile_dir.join("auth.json"),
            test_codex_auth_for_email("dev@example.com"),
        )
        .unwrap();
        let mut registry = json!({
            "agents": {
                "codex": {
                    "activeProfileId": "cap-dev",
                    "profiles": [profile],
                }
            }
        });
        assert!(agent_accounts_clear_resolved_auth_issues_for_kind(
            &mut registry,
            "codex"
        ));
        assert!(registry["agents"]["codex"]["profiles"][0]
            .get(AGENT_ACCOUNTS_AUTH_ISSUE_KEY)
            .is_none());
    }

    #[test]
    fn codex_launch_home_pins_default_account_to_captured_snapshot() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!("agent_accounts_launch_{}", uuid::Uuid::new_v4()));
        let home = root.join("home");
        let data = root.join("data");
        let default_codex_home = home.join(".codex");
        fs::create_dir_all(&default_codex_home).unwrap();
        fs::create_dir_all(&data).unwrap();
        fs::write(
            default_codex_home.join("auth.json"),
            test_codex_auth_for_email("dev@example.com"),
        )
        .unwrap();
        fs::write(default_codex_home.join("config.toml"), "# default config\n").unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);

        let launch_home = agent_accounts_codex_home_for_launch().unwrap();

        assert_ne!(launch_home, default_codex_home);
        assert!(launch_home.starts_with(data.join(AGENT_ACCOUNTS_PROFILE_DIR)));
        assert_eq!(
            fs::read_to_string(launch_home.join("auth.json")).unwrap(),
            test_codex_auth_for_email("dev@example.com")
        );
    }

    #[test]
    fn claude_spawn_env_pins_default_account_to_captured_config_dir() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_claude_launch_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let default_claude_home = home.join(".claude");
        fs::create_dir_all(&default_claude_home).unwrap();
        fs::create_dir_all(&data).unwrap();
        fs::write(
            default_claude_home.join(".credentials.json"),
            "{\"accessToken\":\"account-a\"}",
        )
        .unwrap();
        fs::write(default_claude_home.join("settings.json"), "{}").unwrap();
        fs::write(
            home.join(".claude.json"),
            test_claude_state_for_email("dev@example.com"),
        )
        .unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);

        let mut env_vars = Vec::new();
        agent_accounts_apply_spawn_env(&mut env_vars, "pane-test-claude", "claude");
        let launch_dir = env_vars
            .iter()
            .find_map(|(key, value)| (key == "CLAUDE_CONFIG_DIR").then(|| PathBuf::from(value)))
            .unwrap();

        assert_ne!(launch_dir, default_claude_home);
        assert!(launch_dir.starts_with(data.join(AGENT_ACCOUNTS_PROFILE_DIR).join("claude")));
        assert_eq!(
            fs::read_to_string(launch_dir.join(".credentials.json")).unwrap(),
            "{\"accessToken\":\"account-a\"}"
        );
        assert_eq!(
            fs::read_to_string(launch_dir.join(".claude.json")).unwrap(),
            test_claude_state_for_email("dev@example.com")
        );
        let expected_profile_id = launch_dir.file_name().and_then(|value| value.to_str());
        let panes = AGENT_ACCOUNTS_PANE_PROFILES
            .get_or_init(|| StdMutex::new(HashMap::new()))
            .lock()
            .unwrap();
        assert_eq!(
            panes["pane-test-claude"]["profileId"].as_str(),
            expected_profile_id
        );
    }

    #[test]
    fn spawn_env_skips_unsupported_providers() {
        let mut env_vars = Vec::new();
        agent_accounts_apply_spawn_env(&mut env_vars, "pane-test-unsupported", "generic");
        assert!(env_vars.is_empty());
    }

    #[test]
    fn codex_managed_home_is_not_clobbered() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        // Even if an active codex profile existed, a coordination-managed
        // CODEX_HOME must win; this asserts the guard path compiles and the
        // managed entry survives untouched.
        let mut env_vars = vec![("CODEX_HOME".to_string(), "/tmp/managed".to_string())];
        agent_accounts_apply_spawn_env(&mut env_vars, "pane-test-codex", "codex");
        assert_eq!(
            env_vars
                .iter()
                .filter(|(key, _)| key == "CODEX_HOME")
                .count(),
            1
        );
        assert!(env_vars
            .iter()
            .any(|(key, value)| key == "CODEX_HOME" && value == "/tmp/managed"));
    }

    #[test]
    fn push_seal_open_round_trip_and_tamper_fails() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_push_crypto_{}",
            uuid::Uuid::new_v4()
        ));
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);

        let metadata = agent_account_push_public_key_metadata().unwrap();
        let plaintext = br#"{"kind":"codex","email":"dev@example.com"}"#;
        let sealed = agent_account_push_seal_blob(&metadata.public_key_b64, plaintext).unwrap();
        assert_eq!(agent_account_push_open_blob(&sealed).unwrap(), plaintext);

        let mut tampered = general_purpose::STANDARD.decode(&sealed).unwrap();
        tampered[0] ^= 0x01;
        let tampered = general_purpose::STANDARD.encode(tampered);
        assert!(agent_account_push_open_blob(&tampered).is_err());
    }

    #[test]
    fn claude_push_bundle_contains_only_account_scoped_state() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_claude_bundle_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let claude_home = home.join(".claude");
        fs::create_dir_all(&claude_home).unwrap();
        fs::write(claude_home.join(".credentials.json"), r#"{"token":"secret"}"#).unwrap();
        fs::write(
            home.join(".claude.json"),
            test_claude_state_with_globals("pushed@example.com"),
        )
        .unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);

        let bundle = agent_account_push_profile_bundle(
            "claude",
            AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
            "push-claude",
            "device-target",
            "device-source",
        )
        .unwrap();

        assert!(bundle.files.iter().any(|file| file.name == ".credentials.json"));
        let state_file = bundle
            .files
            .iter()
            .find(|file| file.name == ".claude.json")
            .unwrap();
        let state_bytes = general_purpose::STANDARD
            .decode(&state_file.data_b64)
            .unwrap();
        let state = serde_json::from_slice::<Value>(&state_bytes).unwrap();
        assert_eq!(
            state.pointer("/oauthAccount/emailAddress").and_then(Value::as_str),
            Some("pushed@example.com")
        );
        assert!(state.get("projects").is_none());
        assert!(state.get("mcpServers").is_none());
        assert!(state.get("theme").is_none());
    }

    #[test]
    fn codex_push_bundle_excludes_config_toml_global_settings() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_codex_bundle_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let default_codex_home = home.join(".codex");
        test_write_codex_profile(&default_codex_home, "pushed@example.com");
        fs::write(
            default_codex_home.join("config.toml"),
            "model = \"gpt-5\"\nmcp_server = \"secret\"\n",
        )
        .unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);

        let bundle = agent_account_push_profile_bundle(
            "codex",
            AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
            "push-codex",
            "device-target",
            "device-source",
        )
        .unwrap();

        assert!(bundle.files.iter().any(|file| file.name == "auth.json"));
        assert!(!bundle.files.iter().any(|file| file.name == "config.toml"));
    }

    #[test]
    fn claude_default_wipe_splices_oauth_and_preserves_global_state() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_claude_default_wipe_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let claude_home = home.join(".claude");
        fs::create_dir_all(&claude_home).unwrap();
        fs::write(claude_home.join(".credentials.json"), r#"{"token":"secret"}"#).unwrap();
        fs::write(
            home.join(".claude.json"),
            test_claude_state_with_globals("pushed@example.com"),
        )
        .unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        agent_accounts_registry_write(&json!({
            "agents": {
                "claude": {
                    "activeProfileId": AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
                    "profiles": []
                }
            }
        }));

        let result = agent_accounts_wipe_pushed_profile_internal(
            None,
            "claude",
            AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
            "pushed@example.com",
        )
        .unwrap();

        assert_eq!(result["defaultHomeWiped"].as_bool(), Some(true));
        assert!(!claude_home.join(".credentials.json").exists());
        let state = serde_json::from_str::<Value>(
            &fs::read_to_string(home.join(".claude.json")).unwrap(),
        )
        .unwrap();
        assert!(state.get("oauthAccount").is_none());
        assert!(state.get("projects").is_some());
        assert!(state.get("mcpServers").is_some());
        assert_eq!(state.get("theme").and_then(Value::as_str), Some("dark"));
    }

    #[test]
    fn wipe_isolation_parent_escape_profile_dir_refused() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_wipe_escape_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let kind_root = data.join(AGENT_ACCOUNTS_PROFILE_DIR).join("codex");
        let escaped_dir = data.join(AGENT_ACCOUNTS_PROFILE_DIR).join("escaped");
        fs::create_dir_all(&kind_root).unwrap();
        test_write_codex_profile(&escaped_dir, "escape@example.com");
        let escaping_registry_dir = kind_root.join("..").join("escaped");
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        agent_accounts_registry_write(&json!({
            "agents": {
                "codex": {
                    "activeProfileId": "cap-escape",
                    "profiles": [
                        { "id": "cap-escape", "email": "escape@example.com", "source": "pushed", "dir": escaping_registry_dir.to_string_lossy().to_string() }
                    ]
                }
            }
        }));

        let error =
            agent_accounts_wipe_pushed_profile_internal(None, "codex", "cap-escape", "escape@example.com")
                .unwrap_err();

        assert!(error.contains("outside managed storage"));
        assert!(escaped_dir.join("auth.json").is_file());
    }

    #[test]
    fn materialize_replace_restores_existing_profile_when_temp_rename_fails() {
        let root = env::temp_dir().join(format!(
            "agent_accounts_replace_restore_{}",
            uuid::Uuid::new_v4()
        ));
        let final_dir = root.join("profile");
        let missing_temp = root.join("missing-temp");
        fs::create_dir_all(&final_dir).unwrap();
        fs::write(final_dir.join("sentinel.txt"), "original").unwrap();

        let error = agent_accounts_replace_profile_dir_with_backup(&missing_temp, &final_dir)
            .unwrap_err();

        assert!(error.contains("Unable to install pushed account profile"));
        assert_eq!(
            fs::read_to_string(final_dir.join("sentinel.txt")).unwrap(),
            "original"
        );
    }

    #[test]
    fn agent_account_push_completed_from_wrong_device_does_not_wipe() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_wrong_device_complete_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let default_codex_home = home.join(".codex");
        let pushed_dir = data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("codex")
            .join("cap-pushed");
        test_write_codex_profile(&default_codex_home, "pushed@example.com");
        test_write_codex_profile(&pushed_dir, "pushed@example.com");
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        agent_accounts_registry_write(&json!({
            "agents": {
                "codex": {
                    "activeProfileId": "cap-pushed",
                    "profiles": [
                        { "id": "cap-pushed", "email": "pushed@example.com", "source": "pushed", "dir": pushed_dir.to_string_lossy().to_string() }
                    ]
                }
            }
        }));
        agent_account_push_pending().lock().unwrap().clear();
        agent_account_push_pending().lock().unwrap().insert(
            "push-wrong-device".to_string(),
            AgentAccountPushPending {
                agent_kind: "codex".to_string(),
                profile_id: "cap-pushed".to_string(),
                target_device_id: "device-b".to_string(),
                wipe_local_after: true,
                identity_email: "pushed@example.com".to_string(),
                delivered: true,
            },
        );

        assert!(agent_account_push_handle_remote_status_inner(
            None,
            &json!({
                "event_kind": "remote_command_result",
                "command_kind": "agent_account_push",
                "command_id": "agent-account-push-push-wrong-device",
                "push_id": "push-wrong-device",
                "status": "completed",
                "device_id": "device-c"
            })
        ));

        assert!(pushed_dir.join("auth.json").is_file());
        assert!(default_codex_home.join("auth.json").is_file());
        assert!(agent_account_push_pending()
            .lock()
            .unwrap()
            .contains_key("push-wrong-device"));
        agent_account_push_pending().lock().unwrap().clear();
    }

    #[test]
    fn agent_account_push_target_key_pin_allows_same_key_and_rejects_changed_key() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_target_pin_{}",
            uuid::Uuid::new_v4()
        ));
        let data = root.join("data");
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);

        agent_account_push_verify_or_pin_target_key("Device-A", "key-one").unwrap();
        agent_account_push_verify_or_pin_target_key("device-a", "key-one").unwrap();
        let error = agent_account_push_verify_or_pin_target_key("device-a", "key-two")
            .unwrap_err();

        assert!(error.contains("security key changed"));
    }

    #[test]
    fn agent_account_push_received_blob_rejects_wrong_target_expiry_and_replay() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        agent_account_push_applied().lock().unwrap().clear();

        let wrong_target = test_agent_account_push_blob("push-a", "device-a", 1_000, 2_000);
        assert!(agent_account_push_verify_received_blob(
            wrong_target,
            "push-a",
            "device-b",
            1_500,
        )
        .is_err());

        let expired = test_agent_account_push_blob("push-b", "device-a", 1_000, 2_000);
        assert!(agent_account_push_verify_received_blob(
            expired,
            "push-b",
            "device-a",
            2_001,
        )
        .is_err());

        let valid = test_agent_account_push_blob("push-replay", "device-a", 1_000, 2_000);
        agent_account_push_verify_received_blob(valid, "push-replay", "device-a", 1_500)
            .unwrap();
        agent_account_push_reject_if_applied("push-replay", 1_500).unwrap();
        agent_account_push_mark_applied("push-replay", 2_000, 1_500).unwrap();
        assert!(agent_account_push_reject_if_applied("push-replay", 1_600).is_err());
        assert!(agent_account_push_reject_if_applied("push-replay", 2_001).is_ok());
    }

    #[test]
    fn agent_account_push_existing_corrupt_key_is_not_rotated() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_corrupt_key_{}",
            uuid::Uuid::new_v4()
        ));
        let data = root.join("data");
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        let path = agent_account_push_key_path().unwrap();
        fs::write(&path, "{not-json").unwrap();

        let error = match agent_account_push_public_key_metadata() {
            Ok(_) => panic!("corrupt key should be rejected"),
            Err(error) => error,
        };

        assert!(error.contains("not valid JSON"));
        assert_eq!(fs::read_to_string(path).unwrap(), "{not-json");
    }

    #[test]
    fn agent_account_push_existing_mismatched_keypair_is_rejected() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_mismatched_key_{}",
            uuid::Uuid::new_v4()
        ));
        let data = root.join("data");
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        let path = agent_account_push_key_path().unwrap();
        let private_secret = crypto_box::SecretKey::from(agent_account_push_random_32().unwrap());
        let public_secret = crypto_box::SecretKey::from(agent_account_push_random_32().unwrap());
        let mismatched = AgentAccountPushKeyFile {
            version: 1,
            algorithm: AGENT_ACCOUNT_PUSH_SEALED_ALGORITHM.to_string(),
            private_key_b64: general_purpose::STANDARD.encode(private_secret.to_bytes()),
            public_key_b64: general_purpose::STANDARD.encode(public_secret.public_key().as_bytes()),
            created_at_ms: todo_dispatch_now_ms(),
        };
        agent_account_push_write_private_json(&path, &mismatched).unwrap();

        let error = match agent_account_push_public_key_metadata() {
            Ok(_) => panic!("mismatched keypair should be rejected"),
            Err(error) => error,
        };

        assert!(error.contains("keypair does not match"));
    }

    #[test]
    fn agent_account_push_uses_loaded_key_after_file_changes_in_same_run() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_cached_key_{}",
            uuid::Uuid::new_v4()
        ));
        let data = root.join("data");
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        let metadata = agent_account_push_public_key_metadata().unwrap();
        let path = agent_account_push_key_path().unwrap();
        let replacement_secret = crypto_box::SecretKey::from(agent_account_push_random_32().unwrap());
        let replacement_file = AgentAccountPushKeyFile {
            version: 1,
            algorithm: AGENT_ACCOUNT_PUSH_SEALED_ALGORITHM.to_string(),
            private_key_b64: general_purpose::STANDARD.encode(replacement_secret.to_bytes()),
            public_key_b64: general_purpose::STANDARD.encode(replacement_secret.public_key().as_bytes()),
            created_at_ms: todo_dispatch_now_ms(),
        };
        agent_account_push_write_private_json(&path, &replacement_file).unwrap();

        let sealed = agent_account_push_seal_blob(&metadata.public_key_b64, b"same-run").unwrap();

        assert_eq!(agent_account_push_open_blob(&sealed).unwrap(), b"same-run");
    }

    #[test]
    fn wipe_isolation_other_profile_dirs_untouched() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_wipe_other_profiles_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let default_codex_home = home.join(".codex");
        let pushed_dir = data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("codex")
            .join("cap-pushed");
        let other_codex_dir = data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("codex")
            .join("cap-other");
        let other_kind_dir = data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("claude")
            .join("cap-claude");
        test_write_codex_profile(&default_codex_home, "default@example.com");
        test_write_codex_profile(&pushed_dir, "pushed@example.com");
        test_write_codex_profile(&other_codex_dir, "other@example.com");
        fs::create_dir_all(&other_kind_dir).unwrap();
        fs::write(other_kind_dir.join(".credentials.json"), "{}").unwrap();
        fs::write(
            other_kind_dir.join(".claude.json"),
            test_claude_state_for_email("claude@example.com"),
        )
        .unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        agent_accounts_registry_write(&json!({
            "agents": {
                "codex": {
                    "activeProfileId": "cap-pushed",
                    "profiles": [
                        { "id": "cap-pushed", "email": "pushed@example.com", "source": "pushed", "dir": pushed_dir.to_string_lossy().to_string() },
                        { "id": "cap-other", "email": "other@example.com", "source": "captured", "dir": other_codex_dir.to_string_lossy().to_string() }
                    ]
                },
                "claude": {
                    "activeProfileId": "cap-claude",
                    "profiles": [
                        { "id": "cap-claude", "email": "claude@example.com", "source": "captured", "dir": other_kind_dir.to_string_lossy().to_string() }
                    ]
                }
            }
        }));

        let result =
            agent_accounts_wipe_pushed_profile_internal(None, "codex", "cap-pushed", "pushed@example.com")
                .unwrap();

        assert_eq!(result["profileRemoved"].as_bool(), Some(true));
        assert!(!pushed_dir.exists());
        assert!(other_codex_dir.join("auth.json").is_file());
        assert!(other_kind_dir.join(".credentials.json").is_file());
        let registry = agent_accounts_registry_read();
        assert_eq!(
            registry["agents"]["codex"]["activeProfileId"].as_str(),
            Some("cap-other")
        );
    }

    #[test]
    fn wipe_isolation_default_home_different_identity_untouched() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_wipe_default_other_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let default_codex_home = home.join(".codex");
        let pushed_dir = data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("codex")
            .join("cap-pushed");
        test_write_codex_profile(&default_codex_home, "default@example.com");
        test_write_codex_profile(&pushed_dir, "pushed@example.com");
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        agent_accounts_registry_write(&json!({
            "agents": {
                "codex": {
                    "activeProfileId": "cap-pushed",
                    "profiles": [
                        { "id": "cap-pushed", "email": "pushed@example.com", "source": "pushed", "dir": pushed_dir.to_string_lossy().to_string() }
                    ]
                }
            }
        }));

        let result =
            agent_accounts_wipe_pushed_profile_internal(None, "codex", "cap-pushed", "pushed@example.com")
                .unwrap();

        assert_eq!(result["defaultHomeWiped"].as_bool(), Some(false));
        assert!(default_codex_home.join("auth.json").is_file());
        assert_eq!(
            agent_accounts_codex_email_from_auth(
                &serde_json::from_str::<Value>(
                    &fs::read_to_string(default_codex_home.join("auth.json")).unwrap()
                )
                .unwrap()
            ),
            "default@example.com"
        );
    }

    #[test]
    fn wipe_isolation_only_pushed_identity_material_removed() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_wipe_only_pushed_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let default_codex_home = home.join(".codex");
        let pushed_dir = data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("codex")
            .join("cap-pushed");
        let other_dir = data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("codex")
            .join("cap-other");
        test_write_codex_profile(&default_codex_home, "pushed@example.com");
        test_write_codex_profile(&pushed_dir, "pushed@example.com");
        test_write_codex_profile(&other_dir, "other@example.com");
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        agent_accounts_registry_write(&json!({
            "agents": {
                "codex": {
                    "activeProfileId": "cap-pushed",
                    "profiles": [
                        { "id": "cap-pushed", "email": "pushed@example.com", "source": "pushed", "dir": pushed_dir.to_string_lossy().to_string() },
                        { "id": "cap-other", "email": "other@example.com", "source": "captured", "dir": other_dir.to_string_lossy().to_string() }
                    ]
                }
            }
        }));

        let result =
            agent_accounts_wipe_pushed_profile_internal(None, "codex", "cap-pushed", "pushed@example.com")
                .unwrap();

        assert_eq!(result["defaultHomeWiped"].as_bool(), Some(true));
        assert!(!pushed_dir.exists());
        assert!(!default_codex_home.join("auth.json").exists());
        assert!(default_codex_home.join("config.toml").is_file());
        assert!(other_dir.join("auth.json").is_file());
        let registry = agent_accounts_registry_read();
        assert_eq!(
            agent_accounts_suppressed_emails(&registry, "codex"),
            vec!["pushed@example.com".to_string()]
        );
    }

    #[test]
    fn wipe_isolation_apply_failed_does_not_wipe() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_wipe_failed_apply_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let default_codex_home = home.join(".codex");
        let pushed_dir = data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("codex")
            .join("cap-pushed");
        test_write_codex_profile(&default_codex_home, "pushed@example.com");
        test_write_codex_profile(&pushed_dir, "pushed@example.com");
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        agent_accounts_registry_write(&json!({
            "agents": {
                "codex": {
                    "activeProfileId": "cap-pushed",
                    "profiles": [
                        { "id": "cap-pushed", "email": "pushed@example.com", "source": "pushed", "dir": pushed_dir.to_string_lossy().to_string() }
                    ]
                }
            }
        }));
        agent_account_push_pending().lock().unwrap().clear();
        agent_account_push_pending().lock().unwrap().insert(
            "push-failed".to_string(),
            AgentAccountPushPending {
                agent_kind: "codex".to_string(),
                profile_id: "cap-pushed".to_string(),
                target_device_id: "device-b".to_string(),
                wipe_local_after: true,
                identity_email: "pushed@example.com".to_string(),
                delivered: true,
            },
        );

        assert!(agent_account_push_handle_remote_status_inner(
            None,
            &json!({
                "event_kind": "remote_command_result",
                "command_kind": "agent_account_push",
                "intent_id": "push-failed",
                "status": "failed",
                "message": "apply failed"
            })
        ));

        assert!(pushed_dir.join("auth.json").is_file());
        assert!(default_codex_home.join("auth.json").is_file());
        assert!(!agent_account_push_pending()
            .lock()
            .unwrap()
            .contains_key("push-failed"));
    }
}

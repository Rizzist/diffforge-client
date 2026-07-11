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
const AGENT_ACCOUNTS_AUTH_ISSUE_KEY: &str = "auth_issue";
const AGENT_ACCOUNTS_DEFAULT_AUTH_ISSUE_KEY: &str = "default_auth_issue";
const AGENT_ACCOUNTS_AUTH_SCAN_MAX_CHARS: usize = 4096;
const AGENT_ACCOUNT_PUSH_CHANGED_EVENT: &str = "agent-account-push-changed";
const AGENT_ACCOUNT_PUSH_KEY_FILE: &str = "agent-account-push-key.json";
const AGENT_ACCOUNT_PUSH_TRUSTED_KEYS_FILE: &str = "agent-account-push-trusted-keys.json";
const AGENT_ACCOUNT_PUSH_APPLIED_FILE: &str = "agent-account-push-applied.json";
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
static AGENT_ACCOUNT_PUSH_KEY_FILE_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static AGENT_ACCOUNT_PUSH_KEY_FILE_CACHE: OnceLock<
    StdMutex<Option<(PathBuf, AgentAccountPushKeyFile)>>,
> = OnceLock::new();
static AGENT_ACCOUNT_PUSH_TRUSTED_KEYS_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static AGENT_ACCOUNT_PUSH_APPLIED_FILE_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static AGENT_ACCOUNTS_CLAUDE_CREDENTIAL_OBSERVATIONS: OnceLock<
    StdMutex<HashMap<PathBuf, AgentAccountsClaudeCredentialObservation>>,
> = OnceLock::new();
static AGENT_ACCOUNTS_CLAUDE_CAPTURE_CYCLE: AtomicU64 = AtomicU64::new(0);
static AGENT_ACCOUNTS_REGISTRY_ACTIVITY_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static AGENT_ACCOUNTS_PROFILE_LOGIN_MARKERS: OnceLock<
    StdMutex<HashMap<PathBuf, AgentAccountsProfileLoginMarker>>,
> = OnceLock::new();

const AGENT_ACCOUNTS_PROFILE_LOGIN_MARKER_TTL_SECS: u64 = 30 * 60;
const AGENT_ACCOUNTS_PROFILE_LOGIN_CREDENTIAL_ONLY_CONFIRM_SECS: u64 = 30;

#[derive(Clone, Eq, PartialEq)]
struct AgentAccountsClaudeCredentialFingerprint {
    modified: Option<std::time::SystemTime>,
    len: u64,
    sha256: String,
    expected_email: String,
}

#[derive(Clone)]
struct AgentAccountsClaudeCredentialObservation {
    fingerprint: AgentAccountsClaudeCredentialFingerprint,
    capture_cycle: u64,
    observed_at: std::time::Instant,
}

#[derive(Clone)]
struct AgentAccountsProfileLoginMarker {
    expires_at: std::time::Instant,
    credentials_sha256: Option<String>,
    state_sha256: Option<String>,
    state_modified: Option<std::time::SystemTime>,
    baseline_email: String,
    matching_credentials_sha256: Option<String>,
    matching_credentials_observed_at: Option<std::time::Instant>,
}

#[derive(Default)]
struct AgentAccountsClaudeReconcileResult {
    profile_files_changed: bool,
    registry_changed: bool,
    rebound_profile_dirs: Vec<PathBuf>,
}

impl AgentAccountsClaudeReconcileResult {
    fn changed(&self) -> bool {
        self.profile_files_changed || self.registry_changed
    }
}

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
    created_at_ms: u64,
    expires_at_ms: u64,
    ack_nonce_b64: String,
    target_push_public_key_b64: String,
    source_credentials_sha256: String,
}

fn agent_account_push_pending_is_fresh(pending: &AgentAccountPushPending, now_ms: u64) -> bool {
    pending.created_at_ms <= now_ms && now_ms < pending.expires_at_ms
}

#[derive(Clone, Serialize, Deserialize)]
struct AgentAccountPushKeyFile {
    version: u8,
    algorithm: String,
    private_key_b64: String,
    public_key_b64: String,
    created_at_ms: u64,
}

#[derive(Clone, Serialize, Deserialize)]
struct AgentAccountPushTrustedKey {
    public_key_b64: String,
    fingerprint_sha256: String,
    confirmed_at_ms: u64,
}

#[derive(Clone, Serialize, Deserialize)]
struct AgentAccountPushBlob {
    version: u8,
    contract: String,
    push_id: String,
    target_device_id: String,
    sender_device_id: String,
    sender_push_public_key_b64: String,
    sender_key_fingerprint_sha256: String,
    ack_nonce_b64: String,
    sender_auth_tag_b64: String,
    issued_at_ms: u64,
    expires_at_ms: u64,
    agent_kind: String,
    source_profile_id: String,
    identity_email: String,
    label: String,
    alias: String,
    files: Vec<AgentAccountPushFile>,
}

#[derive(Clone, Serialize, Deserialize)]
struct AgentAccountPushFile {
    name: String,
    data_b64: String,
}

fn agent_account_push_pending() -> &'static StdMutex<HashMap<String, AgentAccountPushPending>> {
    AGENT_ACCOUNT_PUSH_PENDING.get_or_init(|| StdMutex::new(HashMap::new()))
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

fn agent_accounts_write_private_file_atomic(
    path: &Path,
    bytes: &[u8],
    description: &str,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Unable to resolve {description} directory."))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Unable to create {description} directory: {error}"))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("private-state");
    let temp_path = parent.join(format!(".{file_name}.tmp-{}", uuid::Uuid::new_v4()));
    let write_result = (|| -> Result<(), String> {
        #[cfg(unix)]
        let mut file = {
            use std::os::unix::fs::OpenOptionsExt as _;
            fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&temp_path)
                .map_err(|error| format!("Unable to open temporary {description}: {error}"))?
        };
        #[cfg(not(unix))]
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .map_err(|error| format!("Unable to open temporary {description}: {error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("Unable to write temporary {description}: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Unable to sync temporary {description}: {error}"))?;
        fs::rename(&temp_path, path)
            .map_err(|error| format!("Unable to install {description}: {error}"))?;
        #[cfg(unix)]
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("Unable to sync {description} directory: {error}"))?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

fn agent_account_push_write_private_json(
    path: &Path,
    value: &AgentAccountPushKeyFile,
) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Unable to encode agent account push key: {error}"))?;
    agent_accounts_write_private_file_atomic(path, &bytes, "agent account push key")
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

fn agent_account_push_read_or_create_key_file_uncached(
    path: &Path,
) -> Result<AgentAccountPushKeyFile, String> {
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
        "push_id": push_id,
        "target_device_id": target_device_id,
        "agent_kind": agent_kind,
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
        .or_else(|| {
            keys.iter()
                .find_map(|key| cloud_mcp_payload_text(event, &["payload", "details", key]))
        })
        .or_else(|| {
            keys.iter()
                .find_map(|key| cloud_mcp_payload_text(event, &["payload", "result", key]))
        })
        .or_else(|| {
            keys.iter().find_map(|key| {
                cloud_mcp_payload_text(event, &["request", "payload", "details", key])
            })
        })
}

fn agent_account_push_status_push_id(event: &Value) -> Option<String> {
    agent_account_push_status_text(event, &["push_id", "intent_id"])
        .or_else(|| {
            cloud_mcp_remote_command_field_text(event, &["command_id"]).and_then(
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
    agent_account_push_status_text(event, &["device_id", "machine_id"])
        .or_else(|| cloud_mcp_payload_text(event, &["device", "device_id"]))
        .or_else(|| cloud_mcp_payload_text(event, &["payload", "device", "device_id"]))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn agent_account_push_status_matches_pending(
    event: &Value,
    push_id: &str,
    pending: &AgentAccountPushPending,
) -> bool {
    let expected_command_id = format!("agent-account-push-{push_id}");
    let command_id = cloud_mcp_remote_command_field_text(event, &["command_id"])
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

fn agent_account_push_status_has_valid_completion_proof(
    event: &Value,
    push_id: &str,
    pending: &AgentAccountPushPending,
) -> bool {
    let Some(proof) = agent_account_push_status_text(
        event,
        &[
            "recipient_proof_b64",
            "ack_proof_b64",
        ],
    ) else {
        return false;
    };
    let local_device = cloud_mcp_desktop_device_profile();
    let sender_device_id =
        cloud_mcp_payload_text(&local_device, &["device_id"]).unwrap_or_default();
    let Ok(payload) = agent_account_push_ack_payload(
        push_id,
        &pending.ack_nonce_b64,
        &sender_device_id,
        &pending.target_device_id,
    ) else {
        return false;
    };
    agent_account_push_verify_hmac_b64(
        &pending.target_push_public_key_b64,
        b"diffforge.agent_account_push.ack.v2\0",
        &payload,
        &proof,
    )
    .is_ok()
}

fn agent_account_push_handle_remote_status_inner(app: Option<&AppHandle>, event: &Value) -> bool {
    let event_kind =
        cloud_mcp_payload_text(event, &["event_kind", "kind"]).unwrap_or_default();
    if !matches!(
        event_kind.as_str(),
        "remote_command_ack" | "remote_command_result"
    ) {
        return false;
    }
    let command_kind = cloud_mcp_remote_command_field_text(event, &["command_kind"])
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
            let now_ms = todo_dispatch_now_ms();
            let pending = agent_account_push_pending()
                .lock()
                .ok()
                .and_then(|mut pending| {
                    if pending
                        .get(&push_id)
                        .is_some_and(|entry| !agent_account_push_pending_is_fresh(entry, now_ms))
                    {
                        pending.remove(&push_id);
                        return None;
                    }
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
            let now_ms = todo_dispatch_now_ms();
            let pending = agent_account_push_pending()
                .lock()
                .ok()
                .and_then(|mut pending| {
                    if pending
                        .get(&push_id)
                        .is_some_and(|entry| !agent_account_push_pending_is_fresh(entry, now_ms))
                    {
                        pending.remove(&push_id);
                        return None;
                    }
                    let entry = pending.get(&push_id)?;
                    if !agent_account_push_status_matches_pending(event, &push_id, entry) {
                        return None;
                    }
                    if !agent_account_push_status_has_valid_completion_proof(event, &push_id, entry)
                    {
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
                            Some(&pending_for_wipe.source_credentials_sha256),
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
                        Some(&pending.source_credentials_sha256),
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
                    .unwrap_or_else(|| {
                        "Agent account push failed on the target device.".to_string()
                    });
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

fn agent_accounts_registry_key(key: String, to_runtime: bool) -> String {
    let mapped = if to_runtime {
        match key.as_str() {
            "activeProfileId" => "active_profile_id",
            "authFileSignature" => "auth_file_signature",
            "authIssue" => "auth_issue",
            "capturedSuppressed" => "captured_suppressed",
            "createdAtMs" => "created_at_ms",
            "defaultAlias" => "default_alias",
            "defaultAuthIssue" => "default_auth_issue",
            "detectedAtMs" => "detected_at_ms",
            "identityEmail" => "identity_email",
            "needsLogin" => "needs_login",
            "pushSenderDeviceId" => "push_sender_device_id",
            "pushSourceProfileId" => "push_source_profile_id",
            "showAlias" => "show_alias",
            "showEmail" => "show_email",
            _ => return key,
        }
    } else {
        match key.as_str() {
            "active_profile_id" => "activeProfileId",
            "auth_file_signature" => "authFileSignature",
            "auth_issue" => "authIssue",
            "captured_suppressed" => "capturedSuppressed",
            "created_at_ms" => "createdAtMs",
            "default_alias" => "defaultAlias",
            "default_auth_issue" => "defaultAuthIssue",
            "detected_at_ms" => "detectedAtMs",
            "identity_email" => "identityEmail",
            "needs_login" => "needsLogin",
            "push_sender_device_id" => "pushSenderDeviceId",
            "push_source_profile_id" => "pushSourceProfileId",
            "show_alias" => "showAlias",
            "show_email" => "showEmail",
            _ => return key,
        }
    };
    mapped.to_string()
}

fn agent_accounts_registry_map_keys(value: Value, to_runtime: bool) -> Value {
    match value {
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| agent_accounts_registry_map_keys(item, to_runtime))
                .collect(),
        ),
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(key, item)| {
                    (
                        agent_accounts_registry_key(key, to_runtime),
                        agent_accounts_registry_map_keys(item, to_runtime),
                    )
                })
                .collect(),
        ),
        other => other,
    }
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
        .map(|value| agent_accounts_registry_map_keys(value, true))
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({ "agents": {} }))
}

fn agent_accounts_registry_read_checked() -> Result<Value, String> {
    let path = agent_accounts_file_path()
        .ok_or_else(|| "Unable to resolve agent accounts registry path.".to_string())?;
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(json!({ "agents": {} }));
        }
        Err(error) => return Err(format!("Unable to read agent accounts registry: {error}")),
    };
    let registry = serde_json::from_str::<Value>(&raw)
        .map(|value| agent_accounts_registry_map_keys(value, true))
        .map_err(|_| "Agent accounts registry is not valid JSON.".to_string())?;
    if !registry.is_object() {
        return Err("Agent accounts registry root is not an object.".to_string());
    }
    Ok(registry)
}

fn agent_accounts_registry_write(registry: &Value) -> Result<(), String> {
    let path = agent_accounts_file_path()
        .ok_or_else(|| "Unable to resolve agent accounts registry path.".to_string())?;
    let persisted = agent_accounts_registry_map_keys(registry.clone(), false);
    let bytes = serde_json::to_vec_pretty(&persisted)
        .map_err(|error| format!("Unable to encode agent accounts registry: {error}"))?;
    agent_accounts_write_private_file_atomic(&path, &bytes, "agent accounts registry")
}

fn agent_accounts_kind_entry(registry: &Value, kind: &str) -> (String, Vec<Value>) {
    let entry = registry.get("agents").and_then(|agents| agents.get(kind));
    let active = entry
        .and_then(|entry| entry.get("active_profile_id"))
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
                    None => return json!({ "email": "", "auth_ready": false }),
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
                "auth_ready": auth_ready,
                "display_name": display_name,
                "tokenomics_account_key": tokenomics_account_key,
            })
        }
        "opencode" => {
            let auth_path = match dir {
                Some(dir) => dir.join("auth.json"),
                None => match agent_accounts_default_home("opencode") {
                    Some(home) => home.join("auth.json"),
                    None => return json!({ "email": "", "auth_ready": false }),
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
            json!({ "email": identity, "auth_ready": auth_ready })
        }
        _ => {
            let auth_path = match dir {
                Some(dir) => dir.join("auth.json"),
                None => match agent_accounts_default_home("codex") {
                    Some(home) => home.join("auth.json"),
                    None => return json!({ "email": "", "auth_ready": false }),
                },
            };
            let auth = fs::read_to_string(&auth_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
            let email = auth
                .as_ref()
                .map(agent_accounts_codex_email_from_auth)
                .unwrap_or_default();
            json!({ "email": email, "auth_ready": auth.is_some() })
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
    let mut identity = agent_accounts_profile_identity(kind, Some(Path::new(&dir)));
    let stored_email = profile
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
    if kind == "claude"
        && profile.get("source").and_then(Value::as_str) == Some("captured")
        && !stored_email.is_empty()
    {
        let live_email = identity
            .get("email")
            .and_then(Value::as_str)
            .map(agent_accounts_email_key)
            .unwrap_or_default();
        if live_email != stored_email {
            identity["email"] = json!("");
            identity["display_name"] = json!("");
            identity["tokenomics_account_key"] = json!("");
            identity["auth_ready"] = json!(false);
            identity["identity_mismatch"] = json!(!live_email.is_empty());
        }
    }
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
        "email": stored_email,
        "alias": profile.get("alias").and_then(Value::as_str).unwrap_or_default(),
        "show_alias": profile.get("show_alias").and_then(Value::as_bool).unwrap_or(true),
        "show_email": profile.get("show_email").and_then(Value::as_bool).unwrap_or(true),
        "source": profile.get("source").and_then(Value::as_str).unwrap_or("manual"),
        "dir": dir,
        "created_at_ms": profile.get("created_at_ms").and_then(Value::as_u64).unwrap_or(0),
        "identity": identity,
        "auth_status": auth_status,
        "is_default": false,
        "is_active": id == active_id,
        "login_command": agent_accounts_login_command(kind, &dir),
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
        && profiles
            .iter()
            .any(|profile| agent_accounts_profile_id(profile).as_deref() == Some(active_id))
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
        .and_then(|entry| entry.get("default_alias"))
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
    let canonical_ids = agent_accounts_canonical_profile_ids_by_email(
        kind,
        &profiles,
        &effective_active_id,
        &default_email,
    );
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
    let canonical_ids = agent_accounts_canonical_profile_ids_by_email(
        kind,
        &profiles,
        &effective_active_id,
        &default_email,
    );
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
    let canonical_ids = agent_accounts_canonical_profile_ids_by_email(
        kind,
        &profiles,
        &effective_active_id,
        &default_email,
    );
    let default_alias = agent_accounts_default_alias_for_state(
        registry,
        kind,
        &profiles,
        &active_id,
        &default_email,
    );
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
        "created_at_ms": 0,
        "identity": default_identity,
        "auth_status": default_auth_status,
        "is_default": true,
        "is_active": effective_active_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
        "login_command": "",
    })];
    for profile in &profiles {
        let Some(id) = agent_accounts_profile_id(profile) else {
            continue;
        };
        if !canonical_ids.contains(&id) {
            continue;
        }
        views.push(agent_accounts_profile_view(
            kind,
            profile,
            &effective_active_id,
        ));
    }
    json!({ "active_profile_id": effective_active_id, "profiles": views })
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
            .unwrap_or_else(|| json!({ "email": "", "auth_ready": false }));
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
        return agent_accounts_default_home(kind)
            .map(|home| home.join(agent_accounts_auth_file_name(kind)));
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
        .get("needs_login")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return false;
    }
    let marked_signature = issue
        .get("auth_file_signature")
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
        .get("auth_ready")
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
        "auth_ready": file_ready && !issue_current,
        "file_ready": file_ready,
        "needs_login": needs_login,
        "reason": reason,
        "message": message,
        "detected_at_ms": issue.and_then(|issue| issue.get("detected_at_ms")).and_then(Value::as_u64).unwrap_or(0),
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
                    && !agent_accounts_auth_issue_is_current(
                        kind,
                        &id,
                        Some(profile),
                        issue.as_ref(),
                    )
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
    let claude_changed =
        agent_accounts_clear_resolved_auth_issues_for_kind(&mut registry, "claude");
    let codex_changed = agent_accounts_clear_resolved_auth_issues_for_kind(&mut registry, "codex");
    let changed = claude_changed || codex_changed;
    if changed {
        let _ = agent_accounts_registry_write(&registry);
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
        .get("auth_ready")
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
pub(crate) fn agent_accounts_profiles_for_tokenomics(
    kind: &str,
) -> Vec<(String, String, Option<String>, PathBuf)> {
    let registry = agent_accounts_registry_read();
    let (active_id, profiles) = agent_accounts_kind_entry(&registry, kind);
    let default_email = agent_accounts_default_email(kind);
    let effective_active_id =
        agent_accounts_effective_active_profile_id(kind, &active_id, &profiles, &default_email);
    let canonical_ids = agent_accounts_canonical_profile_ids_by_email(
        kind,
        &profiles,
        &effective_active_id,
        &default_email,
    );
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
            let stored_email = profile
                .get("email")
                .and_then(Value::as_str)
                .map(agent_accounts_email_key)
                .filter(|email| !email.is_empty());
            let dir = profile
                .get("dir")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .filter(|path| path.is_dir())?;
            Some((id, label, stored_email, dir))
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
                    "profile_id": active_id,
                    "profile_label": active_label,
                    "stamped_at_ms": todo_dispatch_now_ms(),
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

fn agent_accounts_label_key(label: &str) -> String {
    label
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn agent_accounts_email_domain_label(email: &str) -> String {
    email
        .split_once('@')
        .map(|(_, domain)| domain)
        .unwrap_or_default()
        .chars()
        .filter_map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-') {
                Some(character.to_ascii_lowercase())
            } else {
                None
            }
        })
        .collect::<String>()
        .trim_matches(['.', '-'])
        .chars()
        .take(48)
        .collect()
}

fn agent_accounts_unique_capture_label(email: &str, used_labels: &HashSet<String>) -> String {
    let base = agent_accounts_email_slug(email);
    if !used_labels.contains(&agent_accounts_label_key(&base)) {
        return base;
    }
    let domain = agent_accounts_email_domain_label(email);
    let disambiguated = if domain.is_empty() {
        format!("{base}-{}", cloud_mcp_short_hash(email))
    } else {
        format!("{base}-{domain}")
    };
    if !used_labels.contains(&agent_accounts_label_key(&disambiguated)) {
        return disambiguated;
    }
    format!("{disambiguated}-{}", cloud_mcp_short_hash(email))
}

/// Captured labels are derived rather than user-authored. Keep the oldest
/// captured profile's short local-part label and deterministically append the
/// email domain to newer collisions. Aliases are never changed and continue
/// to win at display time.
fn agent_accounts_dedupe_captured_profile_labels(registry: &mut Value, kind: &str) -> bool {
    let Some(profiles) = registry
        .get_mut("agents")
        .and_then(|agents| agents.get_mut(kind))
        .and_then(|entry| entry.get_mut("profiles"))
        .and_then(Value::as_array_mut)
    else {
        return false;
    };
    let mut used_labels = profiles
        .iter()
        .filter(|profile| profile.get("source").and_then(Value::as_str) != Some("captured"))
        .filter_map(|profile| profile.get("label").and_then(Value::as_str))
        .map(agent_accounts_label_key)
        .filter(|label| !label.is_empty())
        .collect::<HashSet<_>>();
    let mut captured_indices = profiles
        .iter()
        .enumerate()
        .filter_map(|(index, profile)| {
            (profile.get("source").and_then(Value::as_str) == Some("captured")).then_some(index)
        })
        .collect::<Vec<_>>();
    captured_indices.sort_by_key(|index| {
        (
            profiles[*index]
                .get("created_at_ms")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            *index,
        )
    });

    let mut changed = false;
    for index in captured_indices {
        let current_label = profiles[index]
            .get("label")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .to_string();
        let current_key = agent_accounts_label_key(&current_label);
        if !current_key.is_empty() && used_labels.insert(current_key) {
            continue;
        }
        let email = profiles[index]
            .get("email")
            .and_then(Value::as_str)
            .map(agent_accounts_email_key)
            .unwrap_or_default();
        if email.is_empty() {
            continue;
        }
        let label = agent_accounts_unique_capture_label(&email, &used_labels);
        used_labels.insert(agent_accounts_label_key(&label));
        if label != current_label {
            profiles[index]["label"] = json!(label);
            changed = true;
        }
    }
    changed
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

fn agent_accounts_source_is_newer(source: &Path, destination: &Path) -> bool {
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
    newer
}

fn agent_accounts_copy_if_newer(source: &Path, destination: &Path) -> bool {
    agent_accounts_source_is_newer(source, destination)
        && fs::copy(source, destination).is_ok()
}

struct AgentAccountsFileSnapshot {
    bytes: Vec<u8>,
    modified: Option<std::time::SystemTime>,
    len: u64,
}

fn agent_accounts_read_stable_file(path: &Path) -> Option<AgentAccountsFileSnapshot> {
    let before = path.metadata().ok()?;
    let bytes = fs::read(path).ok()?;
    let after = path.metadata().ok()?;
    let before_modified = before.modified().ok();
    let after_modified = after.modified().ok();
    if before.len() != after.len()
        || before_modified != after_modified
        || after.len() != bytes.len() as u64
    {
        return None;
    }
    Some(AgentAccountsFileSnapshot {
        bytes,
        modified: after_modified,
        len: after.len(),
    })
}

fn agent_accounts_claude_state_email(state: &Value) -> String {
    state
        .pointer("/oauthAccount/emailAddress")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default()
}

fn agent_accounts_claude_default_state_for_email(
    expected_email: &str,
) -> Option<AgentAccountsFileSnapshot> {
    let expected_email = agent_accounts_email_key(expected_email);
    if expected_email.is_empty() {
        return None;
    }
    let path = env::var_os("HOME")
        .map(PathBuf::from)?
        .join(".claude.json");
    let snapshot = agent_accounts_read_stable_file(&path)?;
    let state = serde_json::from_slice::<Value>(&snapshot.bytes).ok()?;
    (agent_accounts_claude_state_email(&state) == expected_email).then_some(snapshot)
}

fn agent_accounts_clear_claude_credential_observation(destination: &Path) {
    if let Ok(mut observations) = AGENT_ACCOUNTS_CLAUDE_CREDENTIAL_OBSERVATIONS
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
    {
        observations.remove(destination);
    }
}

fn agent_accounts_claude_credentials_consistent_for_copy(
    credentials: &AgentAccountsFileSnapshot,
    state: &AgentAccountsFileSnapshot,
    destination: &Path,
    expected_email: &str,
    capture_cycle: u64,
) -> bool {
    let credentials_are_newer = match (credentials.modified, state.modified) {
        (Some(credentials_modified), Some(state_modified)) => {
            credentials_modified > state_modified
        }
        // If either timestamp is unavailable, require the same conservative
        // confirmation as the credentials-first case.
        _ => true,
    };
    if !credentials_are_newer {
        agent_accounts_clear_claude_credential_observation(destination);
        return true;
    }

    let fingerprint = AgentAccountsClaudeCredentialFingerprint {
        modified: credentials.modified,
        len: credentials.len,
        sha256: format!("{:x}", Sha256::digest(&credentials.bytes)),
        expected_email: expected_email.to_string(),
    };
    let Ok(mut observations) = AGENT_ACCOUNTS_CLAUDE_CREDENTIAL_OBSERVATIONS
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
    else {
        return false;
    };
    if let Some(observation) = observations.get(destination) {
        if observation.fingerprint == fingerprint {
            // Reconcile and normal refresh can both run inside one slow
            // capture pass. Only a later capture cycle may confirm the same
            // credentials; elapsed wall time alone is not a poll boundary.
            if observation.capture_cycle != capture_cycle {
                observations.remove(destination);
                return true;
            }
            return false;
        }
    }
    observations.insert(
        destination.to_path_buf(),
        AgentAccountsClaudeCredentialObservation {
            fingerprint,
            capture_cycle,
            observed_at: std::time::Instant::now(),
        },
    );
    false
}

fn agent_accounts_has_pending_claude_credentials() -> bool {
    let default_email = agent_accounts_default_email("claude");
    let Ok(mut observations) = AGENT_ACCOUNTS_CLAUDE_CREDENTIAL_OBSERVATIONS
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
    else {
        return false;
    };
    observations.retain(|destination, observation| {
        observation.fingerprint.expected_email == default_email
            && destination.parent().is_some_and(Path::exists)
            && observation.observed_at.elapsed() < Duration::from_secs(10 * 60)
    });
    !observations.is_empty()
}

/// Copies default-home auth material only after the live identity matches the
/// captured profile's stored email. Claude state is copied from the exact
/// bytes that passed the check, so a later login change cannot substitute a
/// different oauthAccount between the gate and the write.
fn agent_accounts_next_claude_capture_cycle() -> u64 {
    AGENT_ACCOUNTS_CLAUDE_CAPTURE_CYCLE
        .fetch_add(1, Ordering::Relaxed)
        .wrapping_add(1)
}

fn agent_accounts_snapshot_refresh(kind: &str, dir: &Path, expected_email: &str) -> bool {
    agent_accounts_snapshot_refresh_in_cycle(
        kind,
        dir,
        expected_email,
        false,
        agent_accounts_next_claude_capture_cycle(),
    )
}

fn agent_accounts_snapshot_refresh_in_cycle(
    kind: &str,
    dir: &Path,
    expected_email: &str,
    force_credentials: bool,
    capture_cycle: u64,
) -> bool {
    let _span = BackendCpuSpan::new("agent_accounts.snapshot_refresh");
    let Some(default_home) = agent_accounts_default_home(kind) else {
        return false;
    };
    let expected_email = agent_accounts_email_key(expected_email);
    if expected_email.is_empty() {
        return false;
    }
    match kind {
        "claude" => {
            let credentials_destination = dir.join(".credentials.json");
            let Some(_) = agent_accounts_claude_default_state_for_email(&expected_email) else {
                agent_accounts_clear_claude_credential_observation(&credentials_destination);
                return false;
            };
            let credentials_source = default_home.join(".credentials.json");
            let credentials_snapshot = (force_credentials
                || agent_accounts_source_is_newer(
                    &credentials_source,
                    &credentials_destination,
                ))
            .then(|| agent_accounts_read_stable_file(&credentials_source))
            .flatten();
            if credentials_snapshot.is_none() {
                agent_accounts_clear_claude_credential_observation(&credentials_destination);
            }
            // Re-probe after buffering credentials. Nothing is written unless
            // the default state still names the registered account.
            let Some(state_snapshot) =
                agent_accounts_claude_default_state_for_email(&expected_email)
            else {
                agent_accounts_clear_claude_credential_observation(&credentials_destination);
                return false;
            };
            let mut changed = false;
            // Claude can write new credentials before it rewrites
            // `~/.claude.json` during an account switch. If credentials are
            // newer than the matching state, defer them until a later capture
            // observes the same credential version with the same identity.
            // The watcher schedules that confirmation after its normal 30s
            // capture gap, so routine same-account token refreshes are delayed
            // once rather than starved.
            let creds_copied = credentials_snapshot.is_some_and(|credentials| {
                if !agent_accounts_claude_credentials_consistent_for_copy(
                    &credentials,
                    &state_snapshot,
                    &credentials_destination,
                    &expected_email,
                    capture_cycle,
                ) {
                    return false;
                }
                agent_accounts_write_private_file_atomic(
                    &credentials_destination,
                    &credentials.bytes,
                    "captured Claude credentials",
                )
                .is_ok()
            });
            changed |= creds_copied;
            // `.claude.json` (identity + CLI state) lives at `~/.claude.json`
            // beside the default home. Repair a missing/neutralized/mismatched
            // captured identity even when the stale credentials mtime did not
            // move; otherwise copy only alongside an actual credentials move.
            let state_destination = dir.join(".claude.json");
            let destination_email = fs::read(&state_destination)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                .map(|state| agent_accounts_claude_state_email(&state))
                .unwrap_or_default();
            if (creds_copied || destination_email != expected_email)
                && agent_accounts_write_private_file_atomic(
                    &state_destination,
                    &state_snapshot.bytes,
                    "captured Claude identity state",
                )
                .is_ok()
            {
                changed = true;
            }
            let settings_destination = dir.join("settings.json");
            if !settings_destination.exists() {
                changed |= fs::copy(default_home.join("settings.json"), &settings_destination)
                    .is_ok();
            }
            changed
        }
        "opencode" => {
            if agent_accounts_default_email(kind) != expected_email {
                return false;
            }
            let mut changed = agent_accounts_copy_if_newer(
                &default_home.join("auth.json"),
                &dir.join("auth.json"),
            );
            for config_name in ["config.json", "opencode.json", "opencode.jsonc"] {
                let destination = dir.join(config_name);
                if !destination.exists() {
                    changed |= fs::copy(default_home.join(config_name), &destination).is_ok();
                }
            }
            changed
        }
        _ => {
            if agent_accounts_default_email(kind) != expected_email {
                return false;
            }
            let mut changed = agent_accounts_copy_if_newer(
                &default_home.join("auth.json"),
                &dir.join("auth.json"),
            );
            let config_destination = dir.join("config.toml");
            if !config_destination.exists() {
                changed |= fs::copy(default_home.join("config.toml"), &config_destination).is_ok();
            }
            changed
        }
    }
}

fn agent_accounts_neutralize_captured_claude_identity(profile_dir: &Path) -> bool {
    // Captured credentials are disposable snapshots. Once the state identity
    // is known to be foreign, retaining its bearer token would let the live
    // limits poll attribute another account's windows to this profile.
    let credentials_path = profile_dir.join(".credentials.json");
    agent_accounts_clear_claude_credential_observation(&credentials_path);
    let mut changed = match fs::remove_file(&credentials_path) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => false,
    };
    let state_path = profile_dir.join(".claude.json");
    let Ok(bytes) = fs::read(&state_path) else {
        return changed;
    };
    let Ok(mut state) = serde_json::from_slice::<Value>(&bytes) else {
        return changed;
    };
    let Some(object) = state.as_object_mut() else {
        return changed;
    };
    let removed = object.remove("oauthAccount").is_some()
        | object.remove("oauth_account").is_some();
    if !removed {
        return changed;
    }
    changed |= serde_json::to_vec_pretty(&state)
        .ok()
        .is_some_and(|bytes| {
            agent_accounts_write_private_file_atomic(
                &state_path,
                &bytes,
                "neutralized captured Claude identity state",
            )
            .is_ok()
        });
    changed
}

fn agent_accounts_profile_credentials_sha256(profile_dir: &Path) -> Option<String> {
    fs::read(profile_dir.join(".credentials.json"))
        .ok()
        .map(|bytes| format!("{:x}", Sha256::digest(bytes)))
}

fn agent_accounts_profile_state_sha256(profile_dir: &Path) -> Option<String> {
    fs::read(profile_dir.join(".claude.json"))
        .ok()
        .map(|bytes| format!("{:x}", Sha256::digest(bytes)))
}

fn agent_accounts_profile_state_modified(
    profile_dir: &Path,
) -> Option<std::time::SystemTime> {
    profile_dir
        .join(".claude.json")
        .metadata()
        .ok()?
        .modified()
        .ok()
}

fn agent_accounts_mark_profile_login(profile_dir: &Path) -> bool {
    let baseline_email = agent_accounts_profile_identity("claude", Some(profile_dir))
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
    if let Ok(mut markers) = AGENT_ACCOUNTS_PROFILE_LOGIN_MARKERS
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
    {
        markers.insert(
            profile_dir.to_path_buf(),
            AgentAccountsProfileLoginMarker {
                expires_at: std::time::Instant::now()
                    + Duration::from_secs(AGENT_ACCOUNTS_PROFILE_LOGIN_MARKER_TTL_SECS),
                credentials_sha256: agent_accounts_profile_credentials_sha256(profile_dir),
                state_sha256: agent_accounts_profile_state_sha256(profile_dir),
                state_modified: agent_accounts_profile_state_modified(profile_dir),
                baseline_email,
                matching_credentials_sha256: None,
                matching_credentials_observed_at: None,
            },
        );
        return true;
    }
    false
}

fn agent_accounts_profile_login_marker(
    profile_dir: &Path,
) -> Option<AgentAccountsProfileLoginMarker> {
    let mut markers = AGENT_ACCOUNTS_PROFILE_LOGIN_MARKERS
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
        .ok()?;
    markers.retain(|_, marker| marker.expires_at > std::time::Instant::now());
    markers.get(profile_dir).cloned()
}

fn agent_accounts_profile_login_marker_observed_change(
    marker: &AgentAccountsProfileLoginMarker,
    profile_dir: &Path,
    live_email: &str,
) -> bool {
    live_email != marker.baseline_email
        || agent_accounts_profile_credentials_sha256(profile_dir) != marker.credentials_sha256
        || agent_accounts_profile_login_marker_observed_state_change(marker, profile_dir)
}

fn agent_accounts_profile_login_marker_observed_state_change(
    marker: &AgentAccountsProfileLoginMarker,
    profile_dir: &Path,
) -> bool {
    agent_accounts_profile_state_sha256(profile_dir) != marker.state_sha256
        || agent_accounts_profile_state_modified(profile_dir) != marker.state_modified
}

fn agent_accounts_profile_login_marker_matching_completion(
    profile_dir: &Path,
    live_email: &str,
) -> bool {
    // The outer poll's identity read can become stale while Claude atomically
    // replaces its state file. Derive the email and fingerprint from one
    // stable read, and refuse to consume the marker unless that email still
    // agrees with the poll. A transient/partial rewrite therefore retries on
    // the next tick instead of turning a deliberate account switch into an
    // unmarked mismatch that reconciliation would neutralize.
    let Some(state) = agent_accounts_read_stable_file(&profile_dir.join(".claude.json")) else {
        return false;
    };
    let Ok(state_json) = serde_json::from_slice::<Value>(&state.bytes) else {
        return false;
    };
    let stable_email = agent_accounts_claude_state_email(&state_json);
    let live_email = agent_accounts_email_key(live_email);
    if stable_email != live_email {
        return false;
    }
    let state_sha256 = Some(format!("{:x}", Sha256::digest(&state.bytes)));

    let Ok(mut markers) = AGENT_ACCOUNTS_PROFILE_LOGIN_MARKERS
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
    else {
        return false;
    };
    markers.retain(|_, marker| marker.expires_at > std::time::Instant::now());
    let Some(marker) = markers.get_mut(profile_dir) else {
        return false;
    };
    if live_email != marker.baseline_email
        || state_sha256 != marker.state_sha256
        || state.modified != marker.state_modified
    {
        return true;
    }
    let credentials_sha256 = agent_accounts_profile_credentials_sha256(profile_dir);
    if credentials_sha256 == marker.credentials_sha256 {
        marker.matching_credentials_sha256 = None;
        marker.matching_credentials_observed_at = None;
        return false;
    }
    if marker.matching_credentials_sha256 != credentials_sha256 {
        marker.matching_credentials_sha256 = credentials_sha256;
        marker.matching_credentials_observed_at = Some(std::time::Instant::now());
        return false;
    }
    marker
        .matching_credentials_observed_at
        .is_some_and(|observed_at| {
            observed_at.elapsed()
                >= Duration::from_secs(
                    AGENT_ACCOUNTS_PROFILE_LOGIN_CREDENTIAL_ONLY_CONFIRM_SECS,
                )
        })
}

fn agent_accounts_clear_profile_login_marker(profile_dir: &Path) {
    if let Ok(mut markers) = AGENT_ACCOUNTS_PROFILE_LOGIN_MARKERS
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
    {
        markers.remove(profile_dir);
    }
}

fn agent_accounts_prepare_captured_claude_profile_login(
    profile_id: &str,
    profile_dir: &Path,
) -> Result<bool, String> {
    let _registry_guard = AGENT_ACCOUNTS_REGISTRY_ACTIVITY_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let registry = agent_accounts_registry_read_checked()?;
    let (_, profiles) = agent_accounts_kind_entry(&registry, "claude");
    let Some(profile) = profiles.iter().find(|profile| {
        profile.get("id").and_then(Value::as_str) == Some(profile_id)
            && profile.get("source").and_then(Value::as_str) == Some("captured")
    }) else {
        return Ok(false);
    };
    let registered_email = profile
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
    let live_email = agent_accounts_profile_identity("claude", Some(profile_dir))
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
    if registered_email.is_empty() {
        return Err("Captured Claude profile has no registered email.".to_string());
    }
    if live_email != registered_email {
        let _ = agent_accounts_neutralize_captured_claude_identity(profile_dir);
    }
    if !agent_accounts_mark_profile_login(profile_dir) {
        return Err("Unable to authorize captured Claude profile login.".to_string());
    }
    Ok(true)
}

fn agent_accounts_rebind_captured_claude_profile(
    registry: &mut Value,
    profile_id: &str,
    observed_email: &str,
) -> bool {
    let observed_email = agent_accounts_email_key(observed_email);
    if observed_email.is_empty() {
        return false;
    }
    let Some(profiles) = registry
        .get_mut("agents")
        .and_then(|agents| agents.get_mut("claude"))
        .and_then(|entry| entry.get_mut("profiles"))
        .and_then(Value::as_array_mut)
    else {
        return false;
    };
    let Some(index) = profiles.iter().position(|profile| {
        profile.get("id").and_then(Value::as_str) == Some(profile_id)
            && profile.get("source").and_then(Value::as_str) == Some("captured")
    }) else {
        return false;
    };
    let current_email = profiles[index]
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
    if current_email == observed_email {
        return false;
    }
    let used_labels = profiles
        .iter()
        .enumerate()
        .filter(|(candidate_index, _)| *candidate_index != index)
        .filter_map(|(_, profile)| profile.get("label").and_then(Value::as_str))
        .map(agent_accounts_label_key)
        .filter(|label| !label.is_empty())
        .collect::<HashSet<_>>();
    let label = agent_accounts_unique_capture_label(&observed_email, &used_labels);
    profiles[index]["email"] = json!(observed_email);
    profiles[index]["label"] = json!(label);
    if let Some(profile) = profiles[index].as_object_mut() {
        profile.remove(AGENT_ACCOUNTS_AUTH_ISSUE_KEY);
    }
    // If another profile already owns this email, the existing canonical-id
    // selection suppresses one of the duplicates (favoring the active one),
    // so re-login never creates two visible/tokenomics accounts.
    let _ = agent_accounts_dedupe_captured_profile_labels(registry, "claude");
    true
}

/// Captured dirs are registry-owned snapshots. A live oauthAccount that does
/// not match the stored email is unusable identity material: repair it from a
/// matching default login or remove both identity and bearer credentials so
/// scanners and live-limit probes cannot attribute another account. The one
/// exception is a fresh mismatch under a profile-login marker: that is an
/// explicit user re-login and rebinds the registry entry instead. Manual and
/// pushed profiles retain ownership of their own dir identity.
fn agent_accounts_reconcile_captured_claude_identities(
    registry: &mut Value,
    default_email: &str,
) -> AgentAccountsClaudeReconcileResult {
    agent_accounts_reconcile_captured_claude_identities_in_cycle(
        registry,
        default_email,
        agent_accounts_next_claude_capture_cycle(),
    )
}

fn agent_accounts_reconcile_captured_claude_identities_in_cycle(
    registry: &mut Value,
    default_email: &str,
    capture_cycle: u64,
) -> AgentAccountsClaudeReconcileResult {
    let (_, profiles) = agent_accounts_kind_entry(registry, "claude");
    let default_email = agent_accounts_email_key(default_email);
    let mut result = AgentAccountsClaudeReconcileResult::default();
    for profile in profiles {
        if profile.get("source").and_then(Value::as_str) != Some("captured") {
            continue;
        }
        let registered_email = profile
            .get("email")
            .and_then(Value::as_str)
            .map(agent_accounts_email_key)
            .unwrap_or_default();
        let Some(profile_dir) = agent_accounts_profile_dir(&profile) else {
            continue;
        };
        let profile_id = profile
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        if registered_email.is_empty() {
            continue;
        }
        let live_email = agent_accounts_profile_identity("claude", Some(&profile_dir))
            .get("email")
            .and_then(Value::as_str)
            .map(agent_accounts_email_key)
            .unwrap_or_default();
        if live_email == registered_email {
            continue;
        }

        if let Some(marker) = agent_accounts_profile_login_marker(&profile_dir) {
            if live_email.is_empty()
                || profile_id.is_empty()
                || !agent_accounts_profile_login_marker_observed_change(
                    &marker,
                    &profile_dir,
                    &live_email,
                )
            {
                // Empty/unchanged identity is an in-progress explicit login,
                // including the neutralized pre-launch baseline. Do not let
                // default-home repair or background mirroring consume it.
                continue;
            }
            // A Keychain-only login can update identity without replacing the
            // old file snapshot. Drop unchanged credentials before rebinding
            // so the new email cannot inherit old live limits.
            let credentials_path = profile_dir.join(".credentials.json");
            if credentials_path.is_file()
                && agent_accounts_profile_credentials_sha256(&profile_dir)
                    == marker.credentials_sha256
            {
                result.profile_files_changed |= fs::remove_file(&credentials_path).is_ok();
            }
            if agent_accounts_rebind_captured_claude_profile(
                registry,
                profile_id,
                &live_email,
            ) {
                result.registry_changed = true;
                result.rebound_profile_dirs.push(profile_dir);
            }
            continue;
        }

        if default_email == registered_email {
            // The destination is already suspect. Remove it first, then force
            // a source read so a newer foreign snapshot cannot defeat repair
            // through the normal copy-if-newer optimization.
            let credentials_path = profile_dir.join(".credentials.json");
            agent_accounts_clear_claude_credential_observation(&credentials_path);
            result.profile_files_changed |= match fs::remove_file(&credentials_path) {
                Ok(()) => true,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
                Err(_) => false,
            };
            result.profile_files_changed |= agent_accounts_snapshot_refresh_in_cycle(
                "claude",
                &profile_dir,
                &registered_email,
                true,
                capture_cycle,
            );
            let repaired_email = agent_accounts_profile_identity("claude", Some(&profile_dir))
                .get("email")
                .and_then(Value::as_str)
                .map(agent_accounts_email_key)
                .unwrap_or_default();
            if repaired_email == registered_email {
                continue;
            }
        }
        result.profile_files_changed |=
            agent_accounts_neutralize_captured_claude_identity(&profile_dir);
    }
    result
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
        ("claude", ".claude.json") => env::var_os("HOME")
            .map(PathBuf::from)
            .map(|home| home.join(name)),
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
        file.sync_all()
            .map_err(|error| format!("Unable to sync {}: {error}", path.display()))?;
        let _ = fs::set_permissions(path, std::os::unix::fs::PermissionsExt::from_mode(0o600));
        return Ok(());
    }
    #[cfg(not(unix))]
    {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(path)
            .map_err(|error| format!("Unable to open {}: {error}", path.display()))?;
        file.write_all(bytes)
            .map_err(|error| format!("Unable to write {}: {error}", path.display()))?;
        file.sync_all()
            .map_err(|error| format!("Unable to sync {}: {error}", path.display()))
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
    let metadata = fs::metadata(path).map_err(|error| {
        format!(
            "Unable to inspect credential file {}: {error}",
            path.display()
        )
    })?;
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
    let metadata = fs::metadata(path).map_err(|error| {
        format!(
            "Unable to inspect credential file {}: {error}",
            path.display()
        )
    })?;
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

fn agent_account_push_splice_claude_default_state(
    expected_email: &str,
) -> Result<Option<Vec<u8>>, String> {
    let path = agent_account_push_claude_default_state_path()?;
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("Claude global state is a symlink; wipe cancelled.".to_string());
        }
        Ok(metadata) if !metadata.is_file() => {
            return Err("Claude global state is not a regular file; wipe cancelled.".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!("Unable to inspect Claude global state: {error}"));
        }
    }
    let original =
        fs::read(&path).map_err(|error| format!("Unable to read Claude global state: {error}"))?;
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
    agent_accounts_write_private_file_atomic(&path, &updated, "Claude global state")?;
    Ok(Some(original))
}

fn agent_account_push_restore_claude_default_state(original: &[u8]) {
    if let Ok(path) = agent_account_push_claude_default_state_path() {
        let _ = agent_accounts_write_private_file_atomic(&path, original, "Claude global state");
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
            return Err(format!(
                "{kind} account profile directory is missing: {profile_id}"
            ));
        }
        (Some(profile), Some(dir))
    };
    let identity = match profile_dir.as_deref() {
        Some(dir) => agent_accounts_profile_identity(kind, Some(dir)),
        None => agent_accounts_profile_identity(kind, None),
    };
    let auth_ready = identity
        .get("auth_ready")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !auth_ready {
        return Err(format!(
            "{kind} account profile is not signed in with file credentials."
        ));
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
        let path =
            agent_account_push_source_file_path(kind, profile_id, profile_dir.as_deref(), name)
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
            return Err(format!(
                "Required {kind} credential file is missing: {required}"
            ));
        }
    }
    let label = profile
        .as_ref()
        .map(agent_accounts_profile_display_label)
        .unwrap_or_else(|| {
            email
                .split('@')
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
        version: 2,
        contract: AGENT_ACCOUNT_PUSH_CONTRACT.to_string(),
        push_id: push_id.trim().to_string(),
        target_device_id: target_device_id.trim().to_string(),
        sender_device_id: sender_device_id.trim().to_string(),
        sender_push_public_key_b64: String::new(),
        sender_key_fingerprint_sha256: String::new(),
        ack_nonce_b64: String::new(),
        sender_auth_tag_b64: String::new(),
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

fn agent_account_push_blob_credentials_digest(
    blob: &AgentAccountPushBlob,
) -> Result<String, String> {
    let credential_name = agent_accounts_auth_file_name(&blob.agent_kind);
    let file = blob
        .files
        .iter()
        .find(|file| file.name == credential_name)
        .ok_or_else(|| "Pushed account is missing its primary credential file.".to_string())?;
    let bytes = general_purpose::STANDARD
        .decode(&file.data_b64)
        .map_err(|_| "Pushed account credential file is not valid base64.".to_string())?;
    let mut material = credential_name.as_bytes().to_vec();
    material.push(0);
    material.extend_from_slice(&bytes);
    Ok(format!("{:x}", Sha256::digest(material)))
}

fn agent_account_push_current_credentials_digest(
    kind: &str,
    profile_id: &str,
    profile_dir: Option<&Path>,
) -> Result<String, String> {
    let credential_name = agent_accounts_auth_file_name(kind);
    let path = agent_account_push_source_file_path(kind, profile_id, profile_dir, credential_name)
        .ok_or_else(|| "Unable to resolve current credential file for local wipe.".to_string())?;
    let bytes = fs::read(&path).map_err(|error| {
        format!("Unable to re-read current credentials before local wipe: {error}")
    })?;
    let mut material = credential_name.as_bytes().to_vec();
    material.push(0);
    material.extend_from_slice(&bytes);
    Ok(format!("{:x}", Sha256::digest(material)))
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
        &["machine_id"][..],
        &["id"][..],
        &["native_device_id"][..],
        &["target_native_device_id"][..],
        &["device", "device_id"][..],
        &["device", "id"][..],
        &["surfaces", "native", "device_id"][..],
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
        Value::Array(items) => items.iter().find_map(|item| {
            agent_account_push_find_device_candidate(item, target_device_id, depth + 1)
        }),
        _ => None,
    }
}

fn agent_account_push_device_online(device: &Value) -> bool {
    let native_connected = [
        &["native_connected"][..],
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
            &["client_kind"][..],
            &["connection_source"][..],
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
            &["device", "push_public_key"][..],
            &["surfaces", "native", "push_public_key"][..],
        ],
    )
    .unwrap_or_default();
    let push_capable = [
        &["push_capable"][..],
        &["device", "push_capable"][..],
        &["surfaces", "native", "push_capable"][..],
    ]
    .iter()
    .any(|path| cloud_mcp_payload_bool(device, path, false));
    if push_public_key.is_empty() || !push_capable {
        return Err(
            "Target device is not push-capable; it has not published an agent account push key."
                .to_string(),
        );
    }
    let algorithm = agent_account_push_first_text(
        device,
        &[
            &["push_key_algorithm"][..],
            &["device", "push_key_algorithm"][..],
            &["surfaces", "native", "push_key_algorithm"][..],
        ],
    )
    .unwrap_or_default();
    if algorithm != AGENT_ACCOUNT_PUSH_SEALED_ALGORITHM {
        return Err(
            "Target device uses an unsupported agent account push key algorithm.".to_string(),
        );
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

fn agent_account_push_decode_public_key(
    value: &str,
) -> Result<[u8; AGENT_ACCOUNT_PUSH_KEY_BYTES], String> {
    let decoded = general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|_| "Agent account push public key is not valid base64.".to_string())?;
    decoded
        .try_into()
        .map_err(|_| "Agent account push public key has the wrong length.".to_string())
}

fn agent_account_push_key_fingerprint(public_key_b64: &str) -> Result<String, String> {
    let public_key = agent_account_push_decode_public_key(public_key_b64)?;
    Ok(format!("{:x}", Sha256::digest(public_key)))
}

fn agent_account_push_normalized_fingerprint(value: &str) -> String {
    let value = value.trim();
    let value = value
        .strip_prefix("sha256:")
        .or_else(|| value.strip_prefix("SHA256:"))
        .unwrap_or(value);
    value
        .chars()
        .filter(|character| character.is_ascii_hexdigit())
        .flat_map(char::to_lowercase)
        .collect()
}

fn agent_account_push_read_trusted_keys_unlocked(
) -> Result<HashMap<String, AgentAccountPushTrustedKey>, String> {
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
        for (device_id, stored) in object {
            let device_id = agent_account_push_normalized_device_id(device_id);
            if device_id.is_empty() {
                continue;
            }
            let key = if let Some(public_key_b64) = stored.as_str() {
                // Legacy entries were silently TOFU-pinned. Preserve the key but
                // deliberately mark it unconfirmed so it cannot authenticate a
                // credential transfer until the user compares its fingerprint.
                AgentAccountPushTrustedKey {
                    public_key_b64: public_key_b64.trim().to_string(),
                    fingerprint_sha256: agent_account_push_key_fingerprint(public_key_b64)?,
                    confirmed_at_ms: 0,
                }
            } else {
                serde_json::from_value::<AgentAccountPushTrustedKey>(stored.clone()).map_err(
                    |_| "Trusted device push key file contains an invalid entry.".to_string(),
                )?
            };
            let actual_fingerprint = agent_account_push_key_fingerprint(&key.public_key_b64)?;
            if key.fingerprint_sha256 != actual_fingerprint {
                return Err(
                    "Trusted device push key fingerprint does not match its key.".to_string(),
                );
            }
            keys.insert(device_id, key);
        }
    }
    Ok(keys)
}

fn agent_account_push_write_trusted_keys_unlocked(
    keys: &HashMap<String, AgentAccountPushTrustedKey>,
) -> Result<(), String> {
    let path = agent_account_push_trusted_keys_path()?;
    let mut object = serde_json::Map::new();
    for (device_id, key) in keys {
        object.insert(
            device_id.clone(),
            serde_json::to_value(key)
                .map_err(|error| format!("Unable to encode trusted device push key: {error}"))?,
        );
    }
    let bytes = serde_json::to_vec_pretty(&Value::Object(object))
        .map_err(|error| format!("Unable to encode trusted device push keys: {error}"))?;
    agent_accounts_write_private_file_atomic(&path, &bytes, "trusted device push keys")
}

/// There is currently no cloud/device-attestation chain for push keys. The
/// only safe bootstrap available in this file is an exact, full fingerprint
/// supplied after the user compares it with the value displayed locally on
/// the other device. The caller must not derive `user_confirmed_fingerprint`
/// from the same cloud snapshot. A future cloud protocol should replace this
/// manual trust bootstrap with device-key-signed push-key attestation.
fn agent_account_push_verify_or_pin_target_key(
    target_device_id: &str,
    push_public_key: &str,
    user_confirmed_fingerprint: Option<&str>,
) -> Result<(), String> {
    let target_device_id = agent_account_push_normalized_device_id(target_device_id);
    if target_device_id.is_empty() || push_public_key.trim().is_empty() {
        return Err("Target device push key is missing.".to_string());
    }
    let key_bytes = agent_account_push_decode_public_key(push_public_key)?;
    let push_public_key = general_purpose::STANDARD.encode(key_bytes);
    let _ = agent_account_push_shared_secret(&push_public_key)?;
    let fingerprint = agent_account_push_key_fingerprint(&push_public_key)?;
    let _guard = AGENT_ACCOUNT_PUSH_TRUSTED_KEYS_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .map_err(|_| "Trusted device push key lock is unavailable.".to_string())?;
    let mut keys = agent_account_push_read_trusted_keys_unlocked()?;
    if let Some(pinned) = keys.get_mut(&target_device_id) {
        if pinned.public_key_b64 != push_public_key && pinned.confirmed_at_ms != 0 {
            return Err(
                "This device's security key changed; push cancelled. Re-verify the device."
                    .to_string(),
            );
        }
        if pinned.public_key_b64 == push_public_key && pinned.confirmed_at_ms != 0 {
            return Ok(());
        }
        let confirmed = user_confirmed_fingerprint
            .map(agent_account_push_normalized_fingerprint)
            .filter(|value| value.len() == 64 && value == &fingerprint)
            .is_some();
        if !confirmed {
            return Err(format!(
                "Credential push requires an out-of-band fingerprint match. Compare the target device fingerprint outside the cloud channel, then confirm the full SHA-256 value: {fingerprint}"
            ));
        }
        *pinned = AgentAccountPushTrustedKey {
            public_key_b64: push_public_key,
            fingerprint_sha256: fingerprint,
            confirmed_at_ms: todo_dispatch_now_ms(),
        };
        return agent_account_push_write_trusted_keys_unlocked(&keys);
    }
    let confirmed = user_confirmed_fingerprint
        .map(agent_account_push_normalized_fingerprint)
        .filter(|value| value.len() == 64 && value == &fingerprint)
        .is_some();
    if !confirmed {
        // The displayed value is only a convenience. It is cloud-derived and
        // must not itself be treated as attestation; the user must compare it
        // with the fingerprint shown locally on the recipient device.
        return Err(format!(
            "Credential push requires an out-of-band fingerprint match. Compare the target device fingerprint outside the cloud channel, then confirm the full SHA-256 value: {fingerprint}"
        ));
    }
    keys.insert(
        target_device_id,
        AgentAccountPushTrustedKey {
            public_key_b64: push_public_key,
            fingerprint_sha256: fingerprint,
            confirmed_at_ms: todo_dispatch_now_ms(),
        },
    );
    agent_account_push_write_trusted_keys_unlocked(&keys)
}

fn agent_account_push_require_confirmed_peer_key(
    device_id: &str,
    public_key_b64: &str,
) -> Result<(), String> {
    let device_id = agent_account_push_normalized_device_id(device_id);
    let public_key =
        general_purpose::STANDARD.encode(agent_account_push_decode_public_key(public_key_b64)?);
    let _guard = AGENT_ACCOUNT_PUSH_TRUSTED_KEYS_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .map_err(|_| "Trusted device push key lock is unavailable.".to_string())?;
    let keys = agent_account_push_read_trusted_keys_unlocked()?;
    let trusted = keys.get(&device_id).ok_or_else(|| {
        "Sender device key is not user-confirmed; pushed credentials were rejected.".to_string()
    })?;
    if trusted.confirmed_at_ms == 0 || trusted.public_key_b64 != public_key {
        return Err(
            "Sender device key is not user-confirmed or changed; pushed credentials were rejected."
                .to_string(),
        );
    }
    Ok(())
}

fn agent_account_push_shared_secret(peer_public_key_b64: &str) -> Result<[u8; 32], String> {
    let peer_public_key = agent_account_push_decode_public_key(peer_public_key_b64)?;
    let local_private_key = agent_account_push_local_private_key()?.to_bytes();
    let shared = x25519_dalek::x25519(local_private_key, peer_public_key);
    if shared.iter().all(|byte| *byte == 0) {
        return Err("Agent account push peer key produced an invalid shared secret.".to_string());
    }
    Ok(shared)
}

fn agent_account_push_hmac_b64(
    peer_public_key_b64: &str,
    domain: &[u8],
    payload: &[u8],
) -> Result<String, String> {
    use hmac::Mac as _;
    let shared = agent_account_push_shared_secret(peer_public_key_b64)?;
    let mut mac = hmac::Hmac::<Sha256>::new_from_slice(&shared)
        .map_err(|_| "Unable to initialize agent account push authenticator.".to_string())?;
    mac.update(domain);
    mac.update(payload);
    Ok(general_purpose::STANDARD.encode(mac.finalize().into_bytes()))
}

fn agent_account_push_verify_hmac_b64(
    peer_public_key_b64: &str,
    domain: &[u8],
    payload: &[u8],
    tag_b64: &str,
) -> Result<(), String> {
    use hmac::Mac as _;
    let tag = general_purpose::STANDARD
        .decode(tag_b64.trim())
        .map_err(|_| "Agent account push authenticator is not valid base64.".to_string())?;
    let shared = agent_account_push_shared_secret(peer_public_key_b64)?;
    let mut mac = hmac::Hmac::<Sha256>::new_from_slice(&shared)
        .map_err(|_| "Unable to initialize agent account push authenticator.".to_string())?;
    mac.update(domain);
    mac.update(payload);
    mac.verify_slice(&tag)
        .map_err(|_| "Agent account push authentication failed.".to_string())
}

fn agent_account_push_sender_auth_payload(blob: &AgentAccountPushBlob) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&json!({
        "version": blob.version,
        "contract": blob.contract,
        "push_id": blob.push_id,
        "target_device_id": blob.target_device_id,
        "sender_device_id": blob.sender_device_id,
        "sender_push_public_key_b64": blob.sender_push_public_key_b64,
        "sender_key_fingerprint_sha256": blob.sender_key_fingerprint_sha256,
        "ack_nonce_b64": blob.ack_nonce_b64,
        "issued_at_ms": blob.issued_at_ms,
        "expires_at_ms": blob.expires_at_ms,
        "agent_kind": blob.agent_kind,
        "source_profile_id": blob.source_profile_id,
        "identity_email": blob.identity_email,
        "label": blob.label,
        "alias": blob.alias,
        "files": blob.files.iter().map(|file| json!({
            "name": file.name,
            "data_b64": file.data_b64,
        })).collect::<Vec<_>>(),
    }))
    .map_err(|error| format!("Unable to encode agent account push authenticator input: {error}"))
}

fn agent_account_push_authenticate_outbound_blob(
    blob: &mut AgentAccountPushBlob,
    target_public_key_b64: &str,
) -> Result<(), String> {
    let local_key = agent_account_push_read_or_create_key_file()?;
    blob.sender_push_public_key_b64 = local_key.public_key_b64;
    blob.sender_key_fingerprint_sha256 =
        agent_account_push_key_fingerprint(&blob.sender_push_public_key_b64)?;
    blob.ack_nonce_b64 = general_purpose::STANDARD.encode(agent_account_push_random_32()?);
    let payload = agent_account_push_sender_auth_payload(blob)?;
    blob.sender_auth_tag_b64 = agent_account_push_hmac_b64(
        target_public_key_b64,
        b"diffforge.agent_account_push.sender.v2\0",
        &payload,
    )?;
    Ok(())
}

fn agent_account_push_verify_sender_auth(blob: &AgentAccountPushBlob) -> Result<(), String> {
    agent_account_push_require_confirmed_peer_key(
        &blob.sender_device_id,
        &blob.sender_push_public_key_b64,
    )?;
    let fingerprint = agent_account_push_key_fingerprint(&blob.sender_push_public_key_b64)?;
    if blob.sender_key_fingerprint_sha256 != fingerprint {
        return Err("Sender device key fingerprint does not match the signed key.".to_string());
    }
    let nonce = general_purpose::STANDARD
        .decode(blob.ack_nonce_b64.trim())
        .map_err(|_| "Agent account push ACK nonce is not valid base64.".to_string())?;
    if nonce.len() != AGENT_ACCOUNT_PUSH_KEY_BYTES {
        return Err("Agent account push ACK nonce has the wrong length.".to_string());
    }
    let payload = agent_account_push_sender_auth_payload(blob)?;
    agent_account_push_verify_hmac_b64(
        &blob.sender_push_public_key_b64,
        b"diffforge.agent_account_push.sender.v2\0",
        &payload,
        &blob.sender_auth_tag_b64,
    )
}

fn agent_account_push_ack_payload(
    push_id: &str,
    ack_nonce_b64: &str,
    sender_device_id: &str,
    target_device_id: &str,
) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&json!({
        "push_id": push_id,
        "ack_nonce_b64": ack_nonce_b64,
        "sender_device_id": agent_account_push_normalized_device_id(sender_device_id),
        "target_device_id": agent_account_push_normalized_device_id(target_device_id),
        "state": "durably_applied",
    }))
    .map_err(|error| format!("Unable to encode agent account push ACK proof input: {error}"))
}

fn agent_account_push_completion_proof(blob: &AgentAccountPushBlob) -> Result<String, String> {
    let payload = agent_account_push_ack_payload(
        &blob.push_id,
        &blob.ack_nonce_b64,
        &blob.sender_device_id,
        &blob.target_device_id,
    )?;
    agent_account_push_hmac_b64(
        &blob.sender_push_public_key_b64,
        b"diffforge.agent_account_push.ack.v2\0",
        &payload,
    )
}

async fn agent_account_push_target_device(
    state: &CloudMcpState,
    target_device_id: &str,
) -> Result<Value, String> {
    let snapshot = {
        let runtime = state.inner.lock().await;
        runtime.account_device_live_state_snapshot.clone()
    }
    .ok_or_else(|| {
        "Device live-state is not available yet; wait for cloud sync and try again.".to_string()
    })?;
    let target = agent_account_push_find_device_candidate(&snapshot, target_device_id, 0)
        .ok_or_else(|| format!("Unknown target device: {target_device_id}"))?;
    if !agent_account_push_device_online(&target) {
        return Err(format!(
            "Target device {target_device_id} is not online with a connected Rust desktop client."
        ));
    }
    Ok(target)
}

fn agent_account_push_profile_id(kind: &str, sender_device_id: &str, push_id: &str) -> String {
    format!(
        "push-{kind}-{}",
        cloud_mcp_short_hash(&format!(
            "{}:{}",
            agent_account_push_normalized_device_id(sender_device_id),
            push_id.trim()
        ))
    )
}

fn agent_account_push_decode_blob(plaintext: &[u8]) -> Result<AgentAccountPushBlob, String> {
    let blob: AgentAccountPushBlob = serde_json::from_slice(plaintext)
        .map_err(|_| "Agent account push payload is not valid JSON.".to_string())?;
    if blob.version != 2 || blob.contract != AGENT_ACCOUNT_PUSH_CONTRACT {
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
    if blob.sender_push_public_key_b64.trim().is_empty()
        || blob.sender_key_fingerprint_sha256.trim().is_empty()
        || blob.ack_nonce_b64.trim().is_empty()
        || blob.sender_auth_tag_b64.trim().is_empty()
    {
        return Err("Pushed agent account is missing authenticated sender metadata.".to_string());
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
        if file.name.contains('/')
            || file.name.contains('\\')
            || file.name == "."
            || file.name == ".."
        {
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
    if blob.issued_at_ms > now_ms {
        return Err("Agent account push payload was issued in the future.".to_string());
    }
    if now_ms >= blob.expires_at_ms {
        return Err("Agent account push payload expired.".to_string());
    }
    if blob.expires_at_ms.saturating_sub(blob.issued_at_ms) > AGENT_ACCOUNT_PUSH_BLOB_TTL_MS {
        return Err("Agent account push payload expiry exceeds the allowed lifetime.".to_string());
    }
    agent_account_push_verify_sender_auth(&blob)?;
    Ok(blob)
}

fn agent_account_push_prune_applied_locked(applied: &mut HashMap<String, u64>, now_ms: u64) {
    applied.retain(|_, expires_at_ms| *expires_at_ms > now_ms);
}

fn agent_account_push_applied_path() -> Result<PathBuf, String> {
    let state_dir = cloud_mcp_native_data_root()
        .ok_or_else(|| "Unable to resolve Diff Forge device data directory.".to_string())?
        .join(DEVICE_APP_STATE_DIR);
    fs::create_dir_all(&state_dir).map_err(|error| {
        format!("Unable to create agent account push replay directory: {error}")
    })?;
    Ok(state_dir.join(AGENT_ACCOUNT_PUSH_APPLIED_FILE))
}

fn agent_account_push_read_applied_unlocked() -> Result<HashMap<String, u64>, String> {
    let path = agent_account_push_applied_path()?;
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(error) => {
            return Err(format!(
                "Unable to read agent account push replay guard: {error}"
            ))
        }
    };
    serde_json::from_str::<HashMap<String, u64>>(&raw)
        .map_err(|_| "Agent account push replay guard is not valid JSON.".to_string())
}

fn agent_account_push_write_applied_unlocked(applied: &HashMap<String, u64>) -> Result<(), String> {
    let path = agent_account_push_applied_path()?;
    let bytes = serde_json::to_vec_pretty(applied)
        .map_err(|error| format!("Unable to encode agent account push replay guard: {error}"))?;
    agent_accounts_write_private_file_atomic(&path, &bytes, "agent account push replay guard")
}

fn agent_account_push_reject_if_applied(push_id: &str, now_ms: u64) -> Result<(), String> {
    let push_id = push_id.trim();
    if push_id.is_empty() {
        return Err("Agent account push replay id is missing.".to_string());
    }
    let _guard = AGENT_ACCOUNT_PUSH_APPLIED_FILE_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .map_err(|_| "Agent account push replay guard is unavailable.".to_string())?;
    let mut applied = agent_account_push_read_applied_unlocked()?;
    agent_account_push_prune_applied_locked(&mut applied, now_ms);
    if applied.contains_key(push_id) {
        return Err("Agent account push was already applied on this device.".to_string());
    }
    if applied.len() >= AGENT_ACCOUNT_PUSH_APPLIED_MAX {
        return Err(
            "Agent account push replay guard is at capacity; wait for existing pushes to expire."
                .to_string(),
        );
    }
    // Claim durably before materialization. A failed apply remains blocked for
    // the short payload lifetime, which is safer than a concurrent/restarted
    // process applying the same credential bundle twice.
    applied.insert(
        push_id.to_string(),
        now_ms.saturating_add(AGENT_ACCOUNT_PUSH_BLOB_TTL_MS),
    );
    agent_account_push_write_applied_unlocked(&applied)
}

fn agent_account_push_mark_applied(
    push_id: &str,
    expires_at_ms: u64,
    now_ms: u64,
) -> Result<(), String> {
    let _guard = AGENT_ACCOUNT_PUSH_APPLIED_FILE_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .map_err(|_| "Agent account push replay guard is unavailable.".to_string())?;
    let mut applied = agent_account_push_read_applied_unlocked()?;
    agent_account_push_prune_applied_locked(&mut applied, now_ms);
    applied.insert(push_id.trim().to_string(), expires_at_ms.max(now_ms));
    agent_account_push_write_applied_unlocked(&applied)
}

fn agent_accounts_materialize_pushed_account(blob: AgentAccountPushBlob) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(&blob.agent_kind)
        .ok_or_else(|| format!("Unsupported pushed agent kind: {}", blob.agent_kind))?;
    agent_account_push_verify_sender_auth(&blob)?;
    let email = agent_accounts_email_key(&blob.identity_email);
    // Claimed email/identity fields in Claude state and Codex JWT payloads are
    // not provider-verified offline. They are display/consistency metadata
    // only. A recipient-local id names the trusted sender + one signed push,
    // so crafted identity text cannot collide with or overwrite any profile.
    let profile_id = agent_account_push_profile_id(kind, &blob.sender_device_id, &blob.push_id);
    let root = cloud_mcp_local_data_file_path(AGENT_ACCOUNTS_PROFILE_DIR)
        .ok_or_else(|| "Unable to resolve agent profile storage root.".to_string())?;
    let kind_root = root.join(kind);
    fs::create_dir_all(&kind_root)
        .map_err(|error| format!("Unable to create pushed account profile root: {error}"))?;
    let temp_dir = kind_root.join(format!(".push-{}-{}", profile_id, uuid::Uuid::new_v4()));
    let final_dir = kind_root.join(&profile_id);
    if final_dir.exists() {
        return Err(
            "A local profile already exists for this push; refusing to overwrite it.".to_string(),
        );
    }
    let mut registry = agent_accounts_registry_read_checked()?;
    let original_registry = registry.clone();
    agent_accounts_ensure_kind_entry(&mut registry, kind);
    if registry["agents"][kind]["profiles"]
        .as_array()
        .is_some_and(|profiles| {
            profiles
                .iter()
                .any(|entry| entry.get("id").and_then(Value::as_str) == Some(profile_id.as_str()))
        })
    {
        return Err(
            "A registry profile already exists for this push; refusing to overwrite it."
                .to_string(),
        );
    }
    fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Unable to create pushed account profile directory: {error}"))?;
    let write_result = (|| -> Result<(), String> {
        for file in &blob.files {
            let bytes = general_purpose::STANDARD
                .decode(&file.data_b64)
                .map_err(|_| "Pushed agent account file is not valid base64.".to_string())?;
            agent_accounts_write_private_file(&temp_dir.join(&file.name), &bytes).map_err(|_| {
                format!(
                    "Unable to durably write pushed {kind} credential file: {}",
                    file.name
                )
            })?;
        }
        let materialized_identity = agent_accounts_profile_identity(kind, Some(&temp_dir));
        let materialized_email = materialized_identity
            .get("email")
            .and_then(Value::as_str)
            .map(agent_accounts_email_key)
            .unwrap_or_default();
        if materialized_email != email {
            return Err(
                "Pushed account credentials did not match the sealed identity.".to_string(),
            );
        }
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(error);
    }
    fs::rename(&temp_dir, &final_dir)
        .map_err(|error| format!("Unable to install pushed account profile: {error}"))?;
    #[cfg(unix)]
    if let Err(error) = fs::File::open(&kind_root)
        .and_then(|directory| directory.sync_all())
    {
        let _ = fs::remove_dir_all(&final_dir);
        return Err(format!(
            "Unable to sync pushed account profile directory: {error}"
        ));
    }
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
        "push_sender_device_id": agent_account_push_normalized_device_id(&blob.sender_device_id),
        "push_source_profile_id": blob.source_profile_id,
        "created_at_ms": todo_dispatch_now_ms(),
    });
    if let Some(profiles) = registry["agents"][kind]["profiles"].as_array_mut() {
        profiles.push(profile);
    }
    registry["agents"][kind]["active_profile_id"] = json!(profile_id.clone());
    if let Err(error) = agent_accounts_registry_write(&registry) {
        let _ = fs::remove_dir_all(&final_dir);
        let _ = agent_accounts_registry_write(&original_registry);
        return Err(error);
    }
    let recipient_proof_b64 = agent_account_push_completion_proof(&blob)?;
    Ok(json!({
        "ok": true,
        "agent_kind": kind,
        "recipient_proof_b64": recipient_proof_b64,
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
    registry["agents"][kind]["captured_suppressed"] = json!(suppressed);
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
        return Err(
            "Local account profile kind root is outside managed storage; wipe cancelled."
                .to_string(),
        );
    }

    match fs::symlink_metadata(dir) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(
                    "Local account profile directory is a symlink; wipe cancelled.".to_string(),
                );
            }
            let canonical_dir = fs::canonicalize(dir).map_err(|error| {
                format!("Unable to verify local account profile directory: {error}")
            })?;
            if !canonical_dir.starts_with(&canonical_kind_root) {
                return Err(
                    "Local account profile directory is outside managed storage; wipe cancelled."
                        .to_string(),
                );
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = dir.parent().ok_or_else(|| {
                "Local account profile directory is invalid; wipe cancelled.".to_string()
            })?;
            let final_component = dir
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty() && *name != "." && *name != "..")
                .ok_or_else(|| {
                    "Local account profile directory is invalid; wipe cancelled.".to_string()
                })?;
            if final_component.contains('/') || final_component.contains('\\') {
                return Err(
                    "Local account profile directory is invalid; wipe cancelled.".to_string(),
                );
            }
            let canonical_parent = fs::canonicalize(parent).map_err(|error| {
                format!("Unable to verify local account profile parent: {error}")
            })?;
            if !canonical_parent.starts_with(&canonical_kind_root) {
                return Err(
                    "Local account profile directory is outside managed storage; wipe cancelled."
                        .to_string(),
                );
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
    expected_credentials_sha256: Option<&str>,
) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(kind)
        .ok_or_else(|| format!("Unsupported agent kind for local wipe: {kind}"))?;
    let expected_email = agent_accounts_email_key(expected_email);
    if expected_email.is_empty() {
        return Err("Pushed account identity is missing; local wipe cancelled.".to_string());
    }
    let mut registry = agent_accounts_registry_read_checked()?;
    let original_registry = registry.clone();
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
        let dir = agent_accounts_profile_dir(&profile).ok_or_else(|| {
            "Local account profile has no managed directory; wipe cancelled.".to_string()
        })?;
        agent_account_push_validate_managed_profile_dir(kind, &dir)?;
        let email = agent_accounts_profile_identity(kind, Some(&dir))
            .get("email")
            .and_then(Value::as_str)
            .map(agent_accounts_email_key)
            .unwrap_or_default();
        if email.is_empty() {
            return Err(
                "Unable to re-probe the current on-disk account identity; wipe cancelled."
                    .to_string(),
            );
        }
        profile_dir = Some(dir);
        removed_profile = Some(profile);
        email
    };
    if removed_email != expected_email {
        return Err("Local account identity changed; wipe cancelled.".to_string());
    }

    if let Some(dir) = profile_dir.as_ref() {
        agent_account_push_validate_managed_profile_dir(kind, dir)?;
    }
    if let Some(expected_digest) = expected_credentials_sha256
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let current_digest = agent_account_push_current_credentials_digest(
            kind,
            profile_id,
            profile_dir.as_deref(),
        )?;
        if current_digest != expected_digest {
            return Err("Local credential bytes changed after push; wipe cancelled.".to_string());
        }
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
            return Err(
                "Local account profile path is not a directory; wipe cancelled.".to_string(),
            );
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

    agent_accounts_ensure_kind_entry(&mut registry, kind);
    if removed_profile.is_some() {
        if let Some(entries) = registry
            .get_mut("agents")
            .and_then(|agents| agents.get_mut(kind))
            .and_then(|entry| entry.get_mut("profiles"))
            .and_then(Value::as_array_mut)
        {
            entries.retain(|profile| {
                agent_accounts_profile_id(profile).as_deref() != Some(profile_id)
            });
        }
        if active_id == profile_id {
            let replacement = profiles
                .iter()
                .filter_map(agent_accounts_profile_id)
                .find(|id| id != profile_id)
                .unwrap_or_else(|| AGENT_ACCOUNTS_DEFAULT_PROFILE_ID.to_string());
            registry["agents"][kind]["active_profile_id"] = json!(replacement);
        }
    }
    if wipe_default_home {
        agent_accounts_add_suppressed_email(&mut registry, kind, &expected_email);
    }
    if let Err(error) = agent_accounts_registry_write(&registry) {
        agent_account_push_rollback_quarantines(&quarantines);
        if let Some(original) = claude_default_state_backup.as_deref() {
            agent_account_push_restore_claude_default_state(original);
        }
        return Err(error);
    }

    let delete_result = (|| -> Result<(), String> {
        for (target, moved) in targets.iter().zip(quarantines.iter()) {
            if target.is_dir {
                fs::remove_dir_all(&moved.quarantine).map_err(|error| {
                    format!("Unable to remove pushed profile directory: {error}")
                })?;
            } else {
                fs::remove_file(&moved.quarantine).map_err(|error| {
                    format!("Unable to remove default credential file: {error}")
                })?;
            }
        }
        Ok(())
    })();
    if let Err(error) = delete_result {
        agent_account_push_rollback_quarantines(&quarantines);
        if let Some(original) = claude_default_state_backup.as_deref() {
            agent_account_push_restore_claude_default_state(original);
        }
        let _ = agent_accounts_registry_write(&original_registry);
        return Err(error);
    }
    if let Some(app) = app {
        let _ = app.emit(AGENT_ACCOUNTS_CHANGED_EVENT, json!({ "kind": kind }));
    }
    Ok(json!({
        "ok": true,
        "profile_removed": removed_profile.is_some(),
        "default_home_wiped": wipe_default_home,
    }))
}

fn agent_accounts_suppressed_emails(registry: &Value, kind: &str) -> Vec<String> {
    registry
        .get("agents")
        .and_then(|agents| agents.get(kind))
        .and_then(|entry| entry.get("captured_suppressed"))
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
            "active_profile_id": AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
            "profiles": [],
        });
    }
}

fn agent_accounts_available_capture_profile_id(
    kind: &str,
    email: &str,
    profiles: &[Value],
    profile_root: &Path,
) -> String {
    let slug = agent_accounts_email_slug(email);
    for collision_index in 0_u32.. {
        let hash_material = if collision_index == 0 {
            format!("{kind}:{email}")
        } else {
            format!("{kind}:{email}:collision:{collision_index}")
        };
        let candidate = format!("cap-{slug}-{}", cloud_mcp_short_hash(&hash_material));
        let candidate_dir = profile_root.join(kind).join(&candidate);
        let occupied = profiles.iter().any(|profile| {
            agent_accounts_profile_id(profile).as_deref() == Some(candidate.as_str())
                || agent_accounts_profile_dir(profile).as_deref() == Some(candidate_dir.as_path())
        });
        if !occupied {
            return candidate;
        }
    }
    unreachable!("capture profile collision search is unbounded")
}

/// One capture pass for one agent kind. Returns true when registry or captured
/// snapshot state changed.
fn agent_accounts_capture_kind(kind: &'static str) -> bool {
    let _span = BackendCpuSpan::new("agent_accounts.capture_kind");
    let identity = agent_accounts_profile_identity(kind, None);
    let email = identity
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
    let auth_ready = identity
        .get("auth_ready")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let _registry_guard = AGENT_ACCOUNTS_REGISTRY_ACTIVITY_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let capture_cycle = (kind == "claude")
        .then(agent_accounts_next_claude_capture_cycle)
        .unwrap_or(0);
    let mut registry = agent_accounts_registry_read();
    let mut registry_changed = agent_accounts_dedupe_captured_profile_labels(&mut registry, kind);
    let reconcile_result = if kind == "claude" {
        agent_accounts_reconcile_captured_claude_identities_in_cycle(
            &mut registry,
            &email,
            capture_cycle,
        )
    } else {
        AgentAccountsClaudeReconcileResult::default()
    };
    registry_changed |= reconcile_result.registry_changed;
    let snapshot_changed = reconcile_result.profile_files_changed;
    let persist_registry = |registry: &Value, changed: bool| {
        let persisted = changed && agent_accounts_registry_write(registry).is_ok();
        if persisted && reconcile_result.registry_changed {
            for dir in &reconcile_result.rebound_profile_dirs {
                agent_accounts_clear_profile_login_marker(dir);
            }
        }
        persisted
    };
    if email.is_empty() || !auth_ready {
        let registry_persisted = persist_registry(&registry, registry_changed);
        return snapshot_changed || registry_persisted;
    }
    let suppressed = agent_accounts_suppressed_emails(&registry, kind);
    if suppressed.iter().any(|entry| entry == &email) {
        let registry_persisted = persist_registry(&registry, registry_changed);
        return snapshot_changed || registry_persisted;
    }
    if !suppressed.is_empty() {
        // Suppressions only block recapture of the identity that was deleted
        // while still signed in; once the default home moved on, clear them
        // so a deliberate later login re-pins the account.
        agent_accounts_ensure_kind_entry(&mut registry, kind);
        registry["agents"][kind]["captured_suppressed"] = json!([]);
        registry_changed = true;
    }
    let (_, profiles) = agent_accounts_kind_entry(&registry, kind);
    let existing = profiles
        .iter()
        .any(|profile| agent_accounts_profile_email(kind, profile) == email);
    if existing {
        // Same account still signed in: keep its snapshot's tokens fresh so
        // switching back later doesn't land on an expired refresh token. Walk
        // every matching captured profile: a manual/duplicate first in
        // registry order must not starve a deferred repair destination.
        let mut refresh_changed = false;
        for existing in profiles.iter().filter(|profile| {
            profile.get("source").and_then(Value::as_str) == Some("captured")
                && agent_accounts_profile_email(kind, profile) == email
        }) {
            if let Some(dir) = existing
                .get("dir")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                if kind == "claude"
                    && agent_accounts_profile_login_marker(Path::new(dir)).is_some()
                {
                    continue;
                }
                let registered_email = existing
                    .get("email")
                    .and_then(Value::as_str)
                    .map(agent_accounts_email_key)
                    .filter(|email| !email.is_empty())
                    .unwrap_or_else(|| email.clone());
                refresh_changed |= agent_accounts_snapshot_refresh_in_cycle(
                    kind,
                    Path::new(dir),
                    &registered_email,
                    false,
                    capture_cycle,
                );
            }
        }
        let registry_persisted = persist_registry(&registry, registry_changed);
        return snapshot_changed || refresh_changed || registry_persisted;
    }
    // New identity in the default home: pin it. Normally the id is
    // deterministic per (kind, email). If a deliberate rebind still owns that
    // historical id/dir, allocate a deterministic collision suffix instead of
    // overwriting the rebound account.
    let Some(profile_root) = cloud_mcp_local_data_file_path(AGENT_ACCOUNTS_PROFILE_DIR) else {
        let registry_persisted = persist_registry(&registry, registry_changed);
        return snapshot_changed || registry_persisted;
    };
    let profile_id =
        agent_accounts_available_capture_profile_id(kind, &email, &profiles, &profile_root);
    let dir = profile_root.join(kind).join(&profile_id);
    if fs::create_dir_all(&dir).is_err() {
        let registry_persisted = persist_registry(&registry, registry_changed);
        return snapshot_changed || registry_persisted;
    }
    if !agent_accounts_snapshot_refresh_in_cycle(
        kind,
        &dir,
        &email,
        false,
        capture_cycle,
    ) {
        let _ = fs::remove_dir(&dir);
        let registry_persisted = persist_registry(&registry, registry_changed);
        return snapshot_changed || registry_persisted;
    }
    agent_accounts_ensure_kind_entry(&mut registry, kind);
    let used_labels = profiles
        .iter()
        .filter_map(|profile| profile.get("label").and_then(Value::as_str))
        .map(agent_accounts_label_key)
        .filter(|label| !label.is_empty())
        .collect::<HashSet<_>>();
    let label = agent_accounts_unique_capture_label(&email, &used_labels);
    let profile = json!({
        "id": profile_id,
        "label": label,
        "email": email,
        "source": "captured",
        "dir": dir.to_string_lossy().to_string(),
        "created_at_ms": todo_dispatch_now_ms(),
    });
    if let Some(profiles) = registry["agents"][kind]["profiles"].as_array_mut() {
        profiles.push(profile);
    }
    let persisted = agent_accounts_registry_write(&registry).is_ok();
    if persisted && reconcile_result.registry_changed {
        for dir in &reconcile_result.rebound_profile_dirs {
            agent_accounts_clear_profile_login_marker(dir);
        }
    }
    persisted
}

fn agent_accounts_capture_startup_reconcile() -> bool {
    let _registry_guard = AGENT_ACCOUNTS_REGISTRY_ACTIVITY_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let mut registry = agent_accounts_registry_read();
    let mut registry_changed = false;
    for kind in ["claude", "codex", "opencode"] {
        registry_changed |= agent_accounts_dedupe_captured_profile_labels(&mut registry, kind);
    }
    let default_claude_email = agent_accounts_default_email("claude");
    let reconcile_result = agent_accounts_reconcile_captured_claude_identities(
        &mut registry,
        &default_claude_email,
    );
    registry_changed |= reconcile_result.registry_changed;
    let registry_persisted =
        registry_changed && agent_accounts_registry_write(&registry).is_ok();
    if registry_persisted && reconcile_result.registry_changed {
        for dir in &reconcile_result.rebound_profile_dirs {
            agent_accounts_clear_profile_login_marker(dir);
        }
    }
    reconcile_result.profile_files_changed || registry_persisted
}

pub(crate) fn agent_accounts_capture_watch_start(app: AppHandle) {
    let _ = std::thread::Builder::new()
        .name("agent-accounts-capture".to_string())
        .spawn(move || {
            if agent_accounts_capture_startup_reconcile() {
                let _ = app.emit(
                    AGENT_ACCOUNTS_CHANGED_EVENT,
                    json!({ "kind": "claude", "reconciled": true }),
                );
            }
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
                let mut watched_paths = HashSet::new();
                for kind in ["claude", "codex", "opencode"] {
                    if let Some(dir) = agent_accounts_default_home(kind) {
                        if watched_paths.insert(dir.clone()) {
                            let _ = notify::Watcher::watch(
                                watcher,
                                &dir,
                                notify::RecursiveMode::NonRecursive,
                            );
                        }
                    }
                }
                // Claude keeps identity state beside (not inside) ~/.claude.
                // Watch the parent so creation and replacement of the sibling
                // ~/.claude.json are both observable.
                if let Some(claude_parent) = agent_accounts_default_home("claude")
                    .and_then(|dir| dir.parent().map(Path::to_path_buf))
                {
                    if watched_paths.insert(claude_parent.clone()) {
                        let _ = notify::Watcher::watch(
                            watcher,
                            &claude_parent,
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
            const EVENT_DEBOUNCE_MS: u64 = 400;
            const BACKSTOP_SECS: u64 = 300;
            let mut last_capture = std::time::Instant::now()
                .checked_sub(Duration::from_secs(EVENT_CAPTURE_MIN_GAP_SECS))
                .unwrap_or_else(std::time::Instant::now);
            let mut next_backstop = std::time::Instant::now() + Duration::from_secs(BACKSTOP_SECS);
            let mut pending_event_capture: Option<std::time::Instant> = None;
            loop {
                let now = std::time::Instant::now();
                if now >= next_backstop {
                    // Advance from the prior deadline, never from "now", so
                    // unrelated filesystem notifications cannot reset the
                    // five-minute safety cadence.
                    while next_backstop <= now {
                        next_backstop += Duration::from_secs(BACKSTOP_SECS);
                    }
                    capture_all(&app);
                    last_capture = std::time::Instant::now();
                    pending_event_capture = agent_accounts_has_pending_claude_credentials()
                        .then_some(last_capture + Duration::from_secs(EVENT_CAPTURE_MIN_GAP_SECS));
                    continue;
                }
                if pending_event_capture.is_some_and(|deadline| now >= deadline) {
                    capture_all(&app);
                    last_capture = std::time::Instant::now();
                    pending_event_capture = agent_accounts_has_pending_claude_credentials()
                        .then_some(last_capture + Duration::from_secs(EVENT_CAPTURE_MIN_GAP_SECS));
                    continue;
                }

                let deadline = pending_event_capture
                    .map(|pending| pending.min(next_backstop))
                    .unwrap_or(next_backstop);
                let wait = deadline.saturating_duration_since(now);
                match rx.recv_timeout(wait) {
                    Ok(event) => {
                        let relevant = event
                            .as_ref()
                            .map(&event_is_credential_related)
                            .unwrap_or(false);
                        if !relevant {
                            continue;
                        }
                        // Debounce credential bursts, but never drop a change
                        // inside the post-capture gap: carry it to the first
                        // allowed deadline instead.
                        let event_deadline = std::time::Instant::now()
                            + Duration::from_millis(EVENT_DEBOUNCE_MS);
                        let gap_deadline = last_capture
                            + Duration::from_secs(EVENT_CAPTURE_MIN_GAP_SECS);
                        pending_event_capture = Some(event_deadline.max(gap_deadline));
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        // Watcher unavailable: let the same monotonic deadline
                        // loop degrade to a slow safety poll without spinning.
                        std::thread::sleep(wait.min(Duration::from_secs(60)));
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
    if lower.contains("refresh token was revoked") || lower.contains("refresh_token_invalidated") {
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
        let drain_to = scan_tail
            .len()
            .saturating_sub(AGENT_ACCOUNTS_AUTH_SCAN_MAX_CHARS);
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
        .get("profile_id")
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
    let auth_file_signature = agent_accounts_auth_signature_for_profile(
        kind,
        &profile_id,
        profile_for_signature.as_ref(),
    )
    .unwrap_or_default();
    let issue = json!({
        "needs_login": true,
        "reason": reason,
        "message": message,
        "detected_at_ms": todo_dispatch_now_ms(),
        "auth_file_signature": auth_file_signature,
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
        if agent_accounts_registry_write(&registry).is_err() {
            return false;
        }
        let _ = app.emit(
            AGENT_ACCOUNTS_CHANGED_EVENT,
            json!({
                "kind": kind,
                "profile_id": profile_id,
                "auth_issue": true,
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
        _ => (vec!["login"], vec![("CODEX_HOME".to_string(), dir_text)]),
    };
    let marker_set = if kind == "claude" {
        agent_accounts_prepare_captured_claude_profile_login(profile_id, &dir)?
    } else {
        false
    };
    let launch = run_login_terminal_with_env(definition.label, &binary, &args, &env_vars);
    if launch.is_err() && marker_set {
        agent_accounts_clear_profile_login_marker(&dir);
    }
    launch
}

fn agent_accounts_watch_profile_login_completion(
    app: AppHandle,
    kind: &'static str,
    profile_id: String,
) {
    if kind != "claude" || profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        return;
    }
    let Ok((profile_dir, false)) = agent_accounts_profile_login_target(kind, &profile_id) else {
        return;
    };
    let _ = thread::Builder::new()
        .name("agent-account-profile-login".to_string())
        .spawn(move || loop {
            if agent_accounts_profile_login_marker(&profile_dir).is_none() {
                break;
            }
            let registry_guard = AGENT_ACCOUNTS_REGISTRY_ACTIVITY_LOCK
                .get_or_init(|| StdMutex::new(()))
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            let mut registry = match agent_accounts_registry_read_checked() {
                Ok(registry) => registry,
                Err(_) => {
                    // A concurrent atomic replacement can be briefly
                    // unreadable. Preserve the authorization marker and retry
                    // instead of treating an empty fallback as profile removal.
                    drop(registry_guard);
                    thread::sleep(Duration::from_secs(1));
                    continue;
                }
            };
            let (_, profiles) = agent_accounts_kind_entry(&registry, "claude");
            let registered_email = profiles.iter().find_map(|profile| {
                (profile.get("id").and_then(Value::as_str) == Some(profile_id.as_str()))
                    .then(|| {
                        profile
                            .get("email")
                            .and_then(Value::as_str)
                            .map(agent_accounts_email_key)
                            .unwrap_or_default()
                    })
            });
            let Some(registered_email) = registered_email else {
                agent_accounts_clear_profile_login_marker(&profile_dir);
                break;
            };
            let live_email = agent_accounts_profile_identity("claude", Some(&profile_dir))
                .get("email")
                .and_then(Value::as_str)
                .map(agent_accounts_email_key)
                .unwrap_or_default();
            if !live_email.is_empty()
                && live_email == registered_email
                // Credentials can arrive before identity during a deliberate
                // account switch. State writes complete immediately; a
                // credentials-only refresh must remain stable for 30 seconds
                // before it can consume the marker.
                && agent_accounts_profile_login_marker_matching_completion(
                    &profile_dir,
                    &live_email,
                )
            {
                agent_accounts_clear_profile_login_marker(&profile_dir);
                let _ = app.emit(
                    AGENT_ACCOUNTS_CHANGED_EVENT,
                    json!({
                        "kind": "claude",
                        "profile_id": profile_id,
                        "login_completed": true,
                        "rebound": false,
                    }),
                );
                break;
            }
            if !live_email.is_empty() && live_email != registered_email {
                let default_email = agent_accounts_default_email("claude");
                let result = agent_accounts_reconcile_captured_claude_identities(
                    &mut registry,
                    &default_email,
                );
                let persisted = !result.registry_changed
                    || agent_accounts_registry_write(&registry).is_ok();
                if persisted && result.registry_changed {
                    for dir in &result.rebound_profile_dirs {
                        agent_accounts_clear_profile_login_marker(dir);
                    }
                }
                if result.changed() {
                    let _ = app.emit(
                        AGENT_ACCOUNTS_CHANGED_EVENT,
                        json!({
                            "kind": "claude",
                            "profile_id": profile_id,
                            "login_completed": persisted,
                            "rebound": persisted && result.registry_changed,
                        }),
                    );
                }
                if persisted && result.registry_changed {
                    break;
                }
            }
            drop(registry_guard);
            thread::sleep(Duration::from_secs(1));
        });
}

fn agent_accounts_provider_for_kind(kind: &str) -> AgentProvider {
    match kind {
        "claude" => AgentProvider::Claude,
        "opencode" => AgentProvider::OpenCode,
        _ => AgentProvider::Codex,
    }
}

#[tauri::command(rename_all = "snake_case")]
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

#[tauri::command(rename_all = "snake_case")]
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
        agent_accounts_watch_profile_login_completion(app.clone(), kind, profile_id.clone());
        let _ = app.emit(
            AGENT_ACCOUNTS_CHANGED_EVENT,
            json!({ "kind": kind, "profile_id": profile_id, "login_started": true }),
        );
        Ok(json!({ "ok": true, "kind": kind, "profile_id": profile_id }))
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
#[tauri::command(rename_all = "snake_case")]
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
                registry["agents"][kind]["default_alias"] =
                    json!(alias.trim().chars().take(40).collect::<String>());
            }
            agent_accounts_registry_write(&registry)?;
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
            profile["show_alias"] = json!(show_alias);
        }
        if let Some(show_email) = show_email {
            profile["show_email"] = json!(show_email);
        }
        agent_accounts_registry_write(&registry)?;
        let _ = app.emit(AGENT_ACCOUNTS_CHANGED_EVENT, json!({ "kind": kind }));
        Ok(json!({ "ok": true }))
    })
    .await
    .map_err(|error| format!("Agent accounts update-display worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
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
        registry["agents"][kind]["active_profile_id"] = json!(active_profile_id);
        agent_accounts_registry_write(&registry)?;
        let _ = app.emit(
            AGENT_ACCOUNTS_CHANGED_EVENT,
            json!({ "kind": kind, "active_profile_id": active_profile_id }),
        );
        Ok(json!({ "ok": true, "kind": kind, "active_profile_id": active_profile_id }))
    })
    .await
    .map_err(|error| format!("Agent accounts set-active worker failed: {error}"))?
}

fn agent_account_push_validate_wipe_mode(wipe_local_after: bool) -> Result<(), String> {
    if wipe_local_after {
        // A boolean arriving over IPC is not evidence of a user gesture. Keep
        // Push & Wipe fail-closed until the frontend is wired to a separate,
        // one-time backend-issued confirmation token. Normal credential push
        // still uses the authenticated apply proof below.
        return Err(
            "Push & Wipe is disabled until an explicit one-time local confirmation token is available. Push without wiping instead."
                .to_string(),
        );
    }
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
async fn agent_account_push_to_device(
    app: AppHandle,
    state: State<'_, CloudMcpState>,
    agent_kind: String,
    profile_id: String,
    target_device_id: String,
    wipe_local_after: bool,
    target_key_fingerprint: Option<String>,
) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(&agent_kind)
        .ok_or_else(|| format!("Unsupported agent kind for account push: {agent_kind}"))?;
    let profile_id = profile_id.trim().to_string();
    if profile_id.is_empty() {
        return Err("A profile id is required.".to_string());
    }
    agent_account_push_validate_wipe_mode(wipe_local_after)?;
    let target_device_id = target_device_id.trim().to_string();
    if target_device_id.is_empty() {
        return Err("A target device id is required.".to_string());
    }
    let local_device = cloud_mcp_desktop_device_profile();
    let local_device_id =
        cloud_mcp_payload_text(&local_device, &["device_id"]).unwrap_or_default();
    if local_device_id.trim().is_empty() {
        return Err(
            "Current device identity is unavailable; credential push cancelled.".to_string(),
        );
    }
    if agent_account_push_normalized_device_id(&target_device_id)
        == agent_account_push_normalized_device_id(&local_device_id)
    {
        return Err(
            "Choose a different device; this account is already on the current device.".to_string(),
        );
    }

    let target_device = agent_account_push_target_device(state.inner(), &target_device_id).await?;
    let (target_push_public_key, sealed_algorithm) = agent_account_push_target_key(&target_device)?;
    let push_id = uuid::Uuid::new_v4().to_string();
    if let Err(error) = agent_account_push_verify_or_pin_target_key(
        &target_device_id,
        &target_push_public_key,
        target_key_fingerprint.as_deref(),
    ) {
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
        let mut blob = agent_account_push_profile_bundle(
            kind,
            &profile_id_for_bundle,
            &push_id_for_bundle,
            &target_device_id_for_bundle,
            &sender_device_id_for_bundle,
        )?;
        agent_account_push_authenticate_outbound_blob(&mut blob, &target_key_for_bundle)?;
        let identity_email = blob.identity_email.clone();
        let source_credentials_sha256 = agent_account_push_blob_credentials_digest(&blob)?;
        let ack_nonce_b64 = blob.ack_nonce_b64.clone();
        let issued_at_ms = blob.issued_at_ms;
        let expires_at_ms = blob.expires_at_ms;
        let plaintext = serde_json::to_vec(&blob)
            .map_err(|error| format!("Unable to encode agent account push payload: {error}"))?;
        let sealed_blob = agent_account_push_seal_blob(&target_key_for_bundle, &plaintext)?;
        Ok::<_, String>((
            sealed_blob,
            identity_email,
            source_credentials_sha256,
            ack_nonce_b64,
            issued_at_ms,
            expires_at_ms,
        ))
    })
    .await
    .map_err(|error| format!("Agent account push sealing worker failed: {error}"))?;
    let (
        sealed_blob,
        identity_email,
        source_credentials_sha256,
        ack_nonce_b64,
        issued_at_ms,
        expires_at_ms,
    ) = match sealed {
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
                created_at_ms: issued_at_ms,
                expires_at_ms,
                ack_nonce_b64,
                target_push_public_key_b64: target_push_public_key.clone(),
                source_credentials_sha256,
            },
        );
    }

    let command_id = format!("agent-account-push-{push_id}");
    let sender_device = cloud_mcp_desktop_device_profile();
    let target_device_name = agent_account_push_first_text(
        &target_device,
        &[
            &["device_name"][..],
            &["machine_name"][..],
            &["name"][..],
        ],
    )
    .unwrap_or_else(|| target_device_id.clone());
    let request = json!({
        "kind": "remote_command_requested",
        "event_kind": "remote_command_requested",
        "source": "rust-diffforge-agent-account-push",
        "command_id": command_id,
        "command_kind": "agent_account_push",
        "intent_id": push_id.clone(),
        "push_id": push_id.clone(),
        "agent_kind": kind,
        "provider": kind,
        "target_device_id": target_device_id.clone(),
        "target_device_name": target_device_name,
        "sealed_blob": sealed_blob,
        "sealed_algorithm": sealed_algorithm,
        "sender_device": sender_device.clone(),
        "device": sender_device.clone(),
        "device_id": sender_device["device_id"].clone(),
        "device_name": sender_device["device_name"].clone(),
        "machine_name": sender_device["machine_name"].clone(),
        "wipe_local_after": wipe_local_after,
        "ts_ms": todo_dispatch_now_ms(),
    });
    if let Err(error) = cloud_mcp_send_remote_command_over_app_ws_once(
        state.inner(),
        &request,
        "agent-account-push",
    )
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
        "push_id": push_id,
    }))
}

#[tauri::command(rename_all = "snake_case")]
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
            registry["agents"][kind]["captured_suppressed"] = json!(suppressed);
        }
        agent_accounts_registry_write(&registry)?;
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
#[tauri::command(rename_all = "snake_case")]
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
            "claude": { "profile_id": claude_active, "profile_label": claude_label },
            "codex": { "profile_id": codex_active, "profile_label": codex_label },
            "opencode": { "profile_id": opencode_active, "profile_label": opencode_label },
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
            version: 2,
            contract: AGENT_ACCOUNT_PUSH_CONTRACT.to_string(),
            push_id: push_id.to_string(),
            target_device_id: target_device_id.to_string(),
            sender_device_id: "device-source".to_string(),
            sender_push_public_key_b64: String::new(),
            sender_key_fingerprint_sha256: String::new(),
            ack_nonce_b64: String::new(),
            sender_auth_tag_b64: String::new(),
            issued_at_ms,
            expires_at_ms,
            agent_kind: "codex".to_string(),
            source_profile_id: AGENT_ACCOUNTS_DEFAULT_PROFILE_ID.to_string(),
            identity_email: "pushed@example.com".to_string(),
            label: "Pushed".to_string(),
            alias: String::new(),
            files: vec![AgentAccountPushFile {
                name: "auth.json".to_string(),
                data_b64: general_purpose::STANDARD
                    .encode(test_codex_auth_for_email("pushed@example.com")),
            }],
        }
    }

    fn test_authenticated_agent_account_push_blob(
        sender_data: &Path,
        recipient_data: &Path,
        push_id: &str,
    ) -> AgentAccountPushBlob {
        let recipient_key = {
            let _env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, recipient_data);
            agent_account_push_public_key_metadata().unwrap()
        };
        let (sender_key, blob) = {
            let _env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, sender_data);
            let sender_key = agent_account_push_public_key_metadata().unwrap();
            let now_ms = todo_dispatch_now_ms();
            let mut blob = test_agent_account_push_blob(
                push_id,
                "device-recipient",
                now_ms,
                now_ms.saturating_add(AGENT_ACCOUNT_PUSH_BLOB_TTL_MS),
            );
            blob.sender_device_id = "device-sender".to_string();
            agent_account_push_authenticate_outbound_blob(&mut blob, &recipient_key.public_key_b64)
                .unwrap();
            (sender_key, blob)
        };
        {
            let _env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, recipient_data);
            let sender_fingerprint =
                agent_account_push_key_fingerprint(&sender_key.public_key_b64).unwrap();
            agent_account_push_verify_or_pin_target_key(
                "device-sender",
                &sender_key.public_key_b64,
                Some(&sender_fingerprint),
            )
            .unwrap();
        }
        blob
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
    fn agent_account_push_and_wipe_requires_backend_gesture_token() {
        assert!(agent_account_push_validate_wipe_mode(false).is_ok());
        assert!(agent_account_push_validate_wipe_mode(true)
            .unwrap_err()
            .contains("one-time local confirmation token"));
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
    fn captured_label_collisions_disambiguate_newer_profile_by_domain() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let data = env::temp_dir().join(format!(
            "agent_accounts_label_dedupe_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&data).unwrap();
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        let mut registry = json!({
            "agents": {
                "claude": {
                    "active_profile_id": AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
                    "profiles": [
                        {
                            "id": "cap-support-splutter",
                            "label": "support",
                            "email": "support@splutter.ai",
                            "source": "captured",
                            "created_at_ms": 100,
                            "dir": data.join("splutter").to_string_lossy().to_string()
                        },
                        {
                            "id": "cap-support-diffforge",
                            "label": "support",
                            "alias": "Work Support",
                            "email": "support@diffforge.ai",
                            "source": "captured",
                            "created_at_ms": 200,
                            "dir": data.join("diffforge").to_string_lossy().to_string()
                        }
                    ]
                }
            }
        });

        assert!(agent_accounts_dedupe_captured_profile_labels(
            &mut registry,
            "claude"
        ));
        let profiles = registry["agents"]["claude"]["profiles"]
            .as_array()
            .unwrap();
        assert_eq!(profiles[0]["label"].as_str(), Some("support"));
        assert_eq!(
            profiles[1]["label"].as_str(),
            Some("support-diffforge.ai")
        );
        assert_eq!(profiles[1]["alias"].as_str(), Some("Work Support"));

        agent_accounts_registry_write(&registry).unwrap();
        assert_eq!(
            agent_accounts_profile_label_for_email("claude", "support@splutter.ai").as_deref(),
            Some("support")
        );
        assert_eq!(
            agent_accounts_profile_label_for_email("claude", "support@diffforge.ai").as_deref(),
            Some("Work Support")
        );
        let _ = fs::remove_dir_all(&data);
    }

    #[test]
    fn claude_snapshot_refresh_rejects_mismatched_default_identity() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_claude_identity_gate_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let default_claude_home = home.join(".claude");
        let profile_dir = root.join("captured-support");
        fs::create_dir_all(&default_claude_home).unwrap();
        fs::create_dir_all(&profile_dir).unwrap();
        fs::write(
            home.join(".claude.json"),
            test_claude_state_for_email("admin@example.test"),
        )
        .unwrap();
        fs::write(
            default_claude_home.join(".credentials.json"),
            "admin-credentials",
        )
        .unwrap();
        fs::write(default_claude_home.join("settings.json"), "admin-settings").unwrap();
        fs::write(
            profile_dir.join(".claude.json"),
            test_claude_state_for_email("support@example.test"),
        )
        .unwrap();
        fs::write(
            profile_dir.join(".credentials.json"),
            "support-credentials",
        )
        .unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);

        assert!(!agent_accounts_snapshot_refresh(
            "claude",
            &profile_dir,
            "support@example.test"
        ));
        assert_eq!(
            fs::read_to_string(profile_dir.join(".claude.json")).unwrap(),
            test_claude_state_for_email("support@example.test")
        );
        assert_eq!(
            fs::read_to_string(profile_dir.join(".credentials.json")).unwrap(),
            "support-credentials"
        );
        assert!(!profile_dir.join("settings.json").exists());

        fs::write(
            home.join(".claude.json"),
            test_claude_state_for_email("support@example.test"),
        )
        .unwrap();
        fs::write(
            profile_dir.join(".claude.json"),
            test_claude_state_for_email("admin@example.test"),
        )
        .unwrap();
        fs::remove_file(profile_dir.join(".credentials.json")).unwrap();
        fs::write(
            default_claude_home.join(".credentials.json"),
            "fresh-support-credentials",
        )
        .unwrap();

        // Credentials newer than matching state take two observations. The
        // first pass can still repair identity/settings, but must not install
        // the not-yet-confirmed bearer snapshot.
        let first_capture_cycle = agent_accounts_next_claude_capture_cycle();
        assert!(agent_accounts_snapshot_refresh_in_cycle(
            "claude",
            &profile_dir,
            "support@example.test",
            false,
            first_capture_cycle,
        ));
        assert!(!profile_dir.join(".credentials.json").exists());
        assert!(!agent_accounts_snapshot_refresh_in_cycle(
            "claude",
            &profile_dir,
            "support@example.test",
            false,
            first_capture_cycle,
        ));
        assert!(!profile_dir.join(".credentials.json").exists());
        assert!(agent_accounts_snapshot_refresh_in_cycle(
            "claude",
            &profile_dir,
            "support@example.test",
            false,
            agent_accounts_next_claude_capture_cycle(),
        ));
        assert_eq!(
            fs::read_to_string(profile_dir.join(".claude.json")).unwrap(),
            test_claude_state_for_email("support@example.test")
        );
        assert_eq!(
            fs::read_to_string(profile_dir.join(".credentials.json")).unwrap(),
            "fresh-support-credentials"
        );
        assert_eq!(
            fs::read_to_string(profile_dir.join("settings.json")).unwrap(),
            "admin-settings"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn claude_snapshot_refresh_defers_credentials_newer_than_matching_state() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_claude_credentials_first_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let default_claude_home = home.join(".claude");
        let profile_dir = root.join("captured-b");
        fs::create_dir_all(&default_claude_home).unwrap();
        fs::create_dir_all(&profile_dir).unwrap();
        let default_state_path = home.join(".claude.json");
        let default_credentials_path = default_claude_home.join(".credentials.json");
        fs::write(
            &default_state_path,
            test_claude_state_for_email("b@example.test"),
        )
        .unwrap();
        thread::sleep(Duration::from_millis(20));
        fs::write(&default_credentials_path, "account-a-credentials").unwrap();
        assert!(
            default_credentials_path
                .metadata()
                .unwrap()
                .modified()
                .unwrap()
                > default_state_path.metadata().unwrap().modified().unwrap()
        );
        fs::write(
            profile_dir.join(".claude.json"),
            test_claude_state_for_email("b@example.test"),
        )
        .unwrap();
        fs::write(profile_dir.join(".credentials.json"), "account-b-credentials").unwrap();
        fs::write(profile_dir.join("settings.json"), "settings").unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);

        assert!(!agent_accounts_snapshot_refresh(
            "claude",
            &profile_dir,
            "b@example.test"
        ));
        assert_eq!(
            fs::read_to_string(profile_dir.join(".credentials.json")).unwrap(),
            "account-b-credentials"
        );

        // Once the state catches up to account A, B's pending observation is
        // invalidated rather than copied on a later pass.
        fs::write(
            &default_state_path,
            test_claude_state_for_email("a@example.test"),
        )
        .unwrap();
        assert!(!agent_accounts_has_pending_claude_credentials());
        assert!(!agent_accounts_snapshot_refresh(
            "claude",
            &profile_dir,
            "b@example.test"
        ));
        assert_eq!(
            fs::read_to_string(profile_dir.join(".credentials.json")).unwrap(),
            "account-b-credentials"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn deferred_claude_repair_refreshes_captured_profile_after_manual_duplicate() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_claude_deferred_duplicate_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let default_claude_home = home.join(".claude");
        let captured_dir = root.join("captured");
        fs::create_dir_all(&default_claude_home).unwrap();
        fs::create_dir_all(&captured_dir).unwrap();
        fs::write(
            home.join(".claude.json"),
            test_claude_state_for_email("support@example.test"),
        )
        .unwrap();
        thread::sleep(Duration::from_millis(20));
        fs::write(
            default_claude_home.join(".credentials.json"),
            "fresh-support-credentials",
        )
        .unwrap();
        fs::write(
            captured_dir.join(".claude.json"),
            test_claude_state_for_email("foreign@example.test"),
        )
        .unwrap();
        fs::write(
            captured_dir.join(".credentials.json"),
            "foreign-credentials",
        )
        .unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        agent_accounts_registry_write(&json!({
            "agents": {
                "claude": {
                    "profiles": [
                        {
                            "id": "manual-support",
                            "label": "support-manual",
                            "email": "support@example.test",
                            "source": "manual",
                            "dir": root.join("manual").to_string_lossy().to_string()
                        },
                        {
                            "id": "cap-support",
                            "label": "support",
                            "email": "support@example.test",
                            "source": "captured",
                            "dir": captured_dir.to_string_lossy().to_string()
                        }
                    ]
                }
            }
        }))
        .unwrap();

        assert!(agent_accounts_capture_kind("claude"));
        assert_eq!(
            agent_accounts_profile_identity("claude", Some(&captured_dir))["email"].as_str(),
            Some("support@example.test")
        );
        assert!(!captured_dir.join(".credentials.json").exists());
        assert!(agent_accounts_has_pending_claude_credentials());

        assert!(agent_accounts_capture_kind("claude"));
        assert_eq!(
            fs::read_to_string(captured_dir.join(".credentials.json")).unwrap(),
            "fresh-support-credentials"
        );
        assert!(!agent_accounts_has_pending_claude_credentials());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn captured_claude_identity_self_heals_without_touching_manual_profiles() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_claude_self_heal_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let default_claude_home = home.join(".claude");
        let captured_dir = root.join("captured");
        let manual_dir = root.join("manual");
        fs::create_dir_all(&default_claude_home).unwrap();
        fs::create_dir_all(&captured_dir).unwrap();
        fs::create_dir_all(&manual_dir).unwrap();
        fs::write(
            home.join(".claude.json"),
            test_claude_state_for_email("syed@example.test"),
        )
        .unwrap();
        fs::write(
            default_claude_home.join(".credentials.json"),
            "default-credentials",
        )
        .unwrap();
        fs::write(
            captured_dir.join(".claude.json"),
            test_claude_state_with_globals("admin@example.test"),
        )
        .unwrap();
        fs::write(
            captured_dir.join(".credentials.json"),
            "foreign-admin-credentials",
        )
        .unwrap();
        fs::write(
            manual_dir.join(".claude.json"),
            test_claude_state_for_email("admin@example.test"),
        )
        .unwrap();
        let captured_profile = json!({
            "id": "cap-support",
            "label": "support",
            "email": "support@example.test",
            "source": "captured",
            "dir": captured_dir.to_string_lossy().to_string()
        });
        let manual_profile = json!({
            "id": "manual-support",
            "label": "support-manual",
            "email": "support@example.test",
            "source": "manual",
            "dir": manual_dir.to_string_lossy().to_string()
        });
        let mut registry = json!({
            "agents": {
                "claude": {
                    "profiles": [captured_profile.clone(), manual_profile]
                }
            }
        });
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);

        let result = agent_accounts_reconcile_captured_claude_identities(
            &mut registry,
            "syed@example.test",
        );
        assert!(result.changed());
        let captured_state = serde_json::from_slice::<Value>(
            &fs::read(captured_dir.join(".claude.json")).unwrap(),
        )
        .unwrap();
        assert!(captured_state.get("oauthAccount").is_none());
        assert!(captured_state.get("projects").is_some());
        assert!(!captured_dir.join(".credentials.json").exists());
        assert_eq!(
            agent_accounts_profile_identity("claude", Some(&manual_dir))["email"].as_str(),
            Some("admin@example.test")
        );
        let view = agent_accounts_profile_view("claude", &captured_profile, "");
        assert_eq!(view["email"].as_str(), Some("support@example.test"));
        assert_eq!(view["identity"]["email"].as_str(), Some(""));
        assert_eq!(view["identity"]["auth_ready"].as_bool(), Some(false));

        fs::write(
            default_claude_home.join(".credentials.json"),
            "fresh-support-credentials",
        )
        .unwrap();
        thread::sleep(Duration::from_millis(20));
        fs::write(
            home.join(".claude.json"),
            test_claude_state_for_email("support@example.test"),
        )
        .unwrap();
        thread::sleep(Duration::from_millis(20));
        fs::write(
            captured_dir.join(".credentials.json"),
            "newer-foreign-credentials",
        )
        .unwrap();
        let result = agent_accounts_reconcile_captured_claude_identities(
            &mut registry,
            "support@example.test",
        );
        assert!(result.changed());
        assert_eq!(
            agent_accounts_profile_identity("claude", Some(&captured_dir))["email"].as_str(),
            Some("support@example.test")
        );
        assert_eq!(
            fs::read_to_string(captured_dir.join(".credentials.json")).unwrap(),
            "fresh-support-credentials"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn marked_claude_profile_login_rebinds_email_and_collision_safe_label() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_claude_profile_rebind_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let default_claude_home = home.join(".claude");
        let captured_dir = root.join("captured");
        fs::create_dir_all(&default_claude_home).unwrap();
        fs::create_dir_all(&captured_dir).unwrap();
        fs::write(
            default_claude_home.join(".credentials.json"),
            "default-support-credentials",
        )
        .unwrap();
        fs::write(
            home.join(".claude.json"),
            test_claude_state_for_email("support@example.test"),
        )
        .unwrap();
        fs::write(
            captured_dir.join(".claude.json"),
            test_claude_state_for_email("support@example.test"),
        )
        .unwrap();
        fs::write(
            captured_dir.join(".credentials.json"),
            "old-support-credentials",
        )
        .unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let mut registry = json!({
            "agents": {
                "claude": {
                    "profiles": [
                        {
                            "id": "cap-support",
                            "label": "support",
                            "email": "support@example.test",
                            "source": "captured",
                            "dir": captured_dir.to_string_lossy().to_string()
                        },
                        {
                            "id": "manual-admin-label",
                            "label": "admin",
                            "email": "operations@example.test",
                            "source": "manual",
                            "dir": root.join("manual").to_string_lossy().to_string()
                        }
                    ]
                }
            }
        });

        agent_accounts_mark_profile_login(&captured_dir);
        let marker = agent_accounts_profile_login_marker(&captured_dir).unwrap();
        assert!(!agent_accounts_profile_login_marker_observed_change(
            &marker,
            &captured_dir,
            "support@example.test"
        ));
        fs::write(
            captured_dir.join(".credentials.json"),
            "new-admin-credentials",
        )
        .unwrap();
        fs::write(
            captured_dir.join(".claude.json"),
            test_claude_state_for_email("admin@example.test"),
        )
        .unwrap();
        assert!(agent_accounts_profile_login_marker_observed_change(
            &marker,
            &captured_dir,
            "admin@example.test"
        ));
        let result = agent_accounts_reconcile_captured_claude_identities(
            &mut registry,
            "support@example.test",
        );

        assert!(result.registry_changed);
        let rebound = &registry["agents"]["claude"]["profiles"][0];
        assert_eq!(rebound["email"].as_str(), Some("admin@example.test"));
        assert_eq!(rebound["label"].as_str(), Some("admin-example.test"));
        assert_eq!(
            fs::read_to_string(captured_dir.join(".credentials.json")).unwrap(),
            "new-admin-credentials"
        );
        agent_accounts_clear_profile_login_marker(&captured_dir);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn profile_login_preparation_neutralizes_a_preexisting_mismatch() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_claude_profile_prepare_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let default_claude_home = home.join(".claude");
        let captured_dir = root.join("captured");
        fs::create_dir_all(&default_claude_home).unwrap();
        fs::create_dir_all(&captured_dir).unwrap();
        fs::write(
            default_claude_home.join(".credentials.json"),
            "default-support-credentials",
        )
        .unwrap();
        fs::write(
            home.join(".claude.json"),
            test_claude_state_for_email("support@example.test"),
        )
        .unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        fs::write(
            captured_dir.join(".claude.json"),
            test_claude_state_for_email("foreign@example.test"),
        )
        .unwrap();
        fs::write(
            captured_dir.join(".credentials.json"),
            "foreign-credentials",
        )
        .unwrap();
        agent_accounts_registry_write(&json!({
            "agents": {
                "claude": {
                    "profiles": [{
                        "id": "cap-support",
                        "label": "support",
                        "email": "support@example.test",
                        "source": "captured",
                        "dir": captured_dir.to_string_lossy().to_string()
                    }]
                }
            }
        }))
        .unwrap();

        assert!(agent_accounts_prepare_captured_claude_profile_login(
            "cap-support",
            &captured_dir
        )
        .unwrap());
        assert_eq!(
            agent_accounts_profile_identity("claude", Some(&captured_dir))["email"].as_str(),
            Some("")
        );
        assert!(!captured_dir.join(".credentials.json").exists());
        let marker = agent_accounts_profile_login_marker(&captured_dir).unwrap();
        assert!(marker.baseline_email.is_empty());
        assert!(!agent_accounts_capture_kind("claude"));
        assert_eq!(
            agent_accounts_profile_identity("claude", Some(&captured_dir))["email"].as_str(),
            Some("")
        );
        assert!(!captured_dir.join(".credentials.json").exists());
        assert!(agent_accounts_profile_login_marker(&captured_dir).is_some());
        agent_accounts_clear_profile_login_marker(&captured_dir);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn matching_email_profile_login_detects_completion_material_change() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let profile_dir = env::temp_dir().join(format!(
            "agent_accounts_claude_same_email_login_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&profile_dir).unwrap();
        fs::write(
            profile_dir.join(".claude.json"),
            test_claude_state_for_email("support@example.test"),
        )
        .unwrap();
        fs::write(profile_dir.join(".credentials.json"), "old-credentials").unwrap();
        assert!(agent_accounts_mark_profile_login(&profile_dir));
        let marker = agent_accounts_profile_login_marker(&profile_dir).unwrap();
        assert!(!agent_accounts_profile_login_marker_observed_change(
            &marker,
            &profile_dir,
            "support@example.test"
        ));

        fs::write(
            profile_dir.join(".credentials.json"),
            "refreshed-credentials",
        )
        .unwrap();
        assert!(agent_accounts_profile_login_marker_observed_change(
            &marker,
            &profile_dir,
            "support@example.test"
        ));
        assert!(!agent_accounts_profile_login_marker_observed_state_change(
            &marker,
            &profile_dir
        ));
        thread::sleep(Duration::from_millis(20));
        fs::write(
            profile_dir.join(".claude.json"),
            test_claude_state_for_email("support@example.test"),
        )
        .unwrap();
        assert!(agent_accounts_profile_login_marker_observed_state_change(
            &marker,
            &profile_dir
        ));
        agent_accounts_clear_profile_login_marker(&profile_dir);
        let _ = fs::remove_dir_all(&profile_dir);
    }

    #[test]
    fn profile_login_completion_rejects_stale_email_for_new_state() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let profile_dir = env::temp_dir().join(format!(
            "agent_accounts_claude_stale_login_poll_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&profile_dir).unwrap();
        fs::write(
            profile_dir.join(".claude.json"),
            test_claude_state_for_email("support@example.test"),
        )
        .unwrap();
        assert!(agent_accounts_mark_profile_login(&profile_dir));

        fs::write(
            profile_dir.join(".claude.json"),
            test_claude_state_for_email("admin@example.test"),
        )
        .unwrap();
        assert!(!agent_accounts_profile_login_marker_matching_completion(
            &profile_dir,
            "support@example.test"
        ));
        assert!(agent_accounts_profile_login_marker(&profile_dir).is_some());
        assert!(agent_accounts_profile_login_marker_matching_completion(
            &profile_dir,
            "admin@example.test"
        ));

        agent_accounts_clear_profile_login_marker(&profile_dir);
        let _ = fs::remove_dir_all(&profile_dir);
    }

    #[test]
    fn rebind_reserves_old_capture_id_and_dir_when_old_default_is_recaptured() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_claude_rebind_recapture_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let default_claude_home = home.join(".claude");
        let profile_root = data.join(AGENT_ACCOUNTS_PROFILE_DIR);
        let old_email = "support@example.test";
        let rebound_id = agent_accounts_available_capture_profile_id(
            "claude",
            old_email,
            &[],
            &profile_root,
        );
        let rebound_dir = profile_root.join("claude").join(&rebound_id);
        fs::create_dir_all(&default_claude_home).unwrap();
        fs::create_dir_all(&rebound_dir).unwrap();
        fs::write(
            default_claude_home.join(".credentials.json"),
            "default-support-credentials",
        )
        .unwrap();
        fs::write(
            home.join(".claude.json"),
            test_claude_state_for_email(old_email),
        )
        .unwrap();
        fs::write(
            rebound_dir.join(".claude.json"),
            test_claude_state_for_email(old_email),
        )
        .unwrap();
        fs::write(
            rebound_dir.join(".credentials.json"),
            "old-support-credentials",
        )
        .unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        let mut registry = json!({
            "agents": {
                "claude": {
                    "active_profile_id": AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
                    "profiles": [{
                        "id": rebound_id,
                        "label": "support",
                        "email": old_email,
                        "source": "captured",
                        "dir": rebound_dir.to_string_lossy().to_string()
                    }]
                }
            }
        });

        agent_accounts_mark_profile_login(&rebound_dir);
        fs::write(
            rebound_dir.join(".credentials.json"),
            "new-admin-credentials",
        )
        .unwrap();
        fs::write(
            rebound_dir.join(".claude.json"),
            test_claude_state_for_email("admin@example.test"),
        )
        .unwrap();
        let result = agent_accounts_reconcile_captured_claude_identities(
            &mut registry,
            old_email,
        );
        assert!(result.registry_changed);
        agent_accounts_registry_write(&registry).unwrap();
        agent_accounts_clear_profile_login_marker(&rebound_dir);

        assert!(agent_accounts_capture_kind("claude"));
        let captured_registry = agent_accounts_registry_read();
        let (_, profiles) = agent_accounts_kind_entry(&captured_registry, "claude");
        assert_eq!(profiles.len(), 2);
        let rebound = profiles
            .iter()
            .find(|profile| profile.get("email").and_then(Value::as_str) == Some("admin@example.test"))
            .unwrap();
        let recaptured = profiles
            .iter()
            .find(|profile| profile.get("email").and_then(Value::as_str) == Some(old_email))
            .unwrap();
        assert_eq!(rebound.get("id").and_then(Value::as_str), Some(rebound_id.as_str()));
        assert_ne!(recaptured.get("id").and_then(Value::as_str), Some(rebound_id.as_str()));
        assert_ne!(
            agent_accounts_profile_dir(recaptured).as_deref(),
            Some(rebound_dir.as_path())
        );
        assert_eq!(
            agent_accounts_profile_identity("claude", Some(&rebound_dir))["email"].as_str(),
            Some("admin@example.test")
        );
        assert_eq!(
            fs::read_to_string(rebound_dir.join(".credentials.json")).unwrap(),
            "new-admin-credentials"
        );
        let _ = fs::remove_dir_all(&root);
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
                    "active_profile_id": "cap-admin",
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
        }))
        .unwrap();

        let registry = agent_accounts_registry_read();
        let state = agent_accounts_kind_state(&registry, "codex");
        let profiles = state["profiles"].as_array().unwrap();
        let visible_ids = profiles
            .iter()
            .filter_map(|profile| profile["id"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(visible_ids, vec!["default", "cap-admin", "cap-work"]);
        assert_eq!(profiles[0]["is_active"].as_bool(), Some(false));
        assert_eq!(profiles[1]["is_active"].as_bool(), Some(true));
        assert_eq!(profiles[0]["alias"].as_str(), Some("Admin"));
        assert!(agent_accounts_duplicate_profile_ids("codex").is_empty());
        let tokenomics_ids = agent_accounts_profiles_for_tokenomics("codex")
            .into_iter()
            .map(|(id, _, _, _)| id)
            .collect::<Vec<_>>();
        assert_eq!(
            tokenomics_ids,
            vec!["cap-admin".to_string(), "cap-work".to_string()]
        );

        assert!(!agent_accounts_capture_kind("codex"));
        let registry_after = agent_accounts_registry_read();
        assert_eq!(
            registry_after["agents"]["codex"]["active_profile_id"].as_str(),
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
                    "active_profile_id": AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
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
        }))
        .unwrap();

        let registry = agent_accounts_registry_read();
        let state = agent_accounts_kind_state(&registry, "codex");
        assert_eq!(state["active_profile_id"].as_str(), Some("cap-device"));
        let profiles = state["profiles"].as_array().unwrap();
        let active_ids = profiles
            .iter()
            .filter(|profile| profile["is_active"].as_bool() == Some(true))
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
            "agents": { "codex": { "captured_suppressed": [" A@B.com ", "", 7] } }
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
            "needs_login": true,
            "reason": "refresh_expired",
            "message": "Sign in again.",
            "detected_at_ms": 1,
            "auth_file_signature": signature,
        });
        let identity = agent_accounts_profile_identity("codex", Some(&profile_dir));
        let status = agent_accounts_auth_status(
            "codex",
            "cap-dev",
            Some(&profile),
            &identity,
            profile.get(AGENT_ACCOUNTS_AUTH_ISSUE_KEY),
        );
        assert_eq!(status["needs_login"].as_bool(), Some(true));

        fs::write(
            profile_dir.join("auth.json"),
            test_codex_auth_for_email("dev@example.com")
                .replace("h.", "h.changed-")
                .replace(".s", ".changed-s"),
        )
        .unwrap();
        let mut registry = json!({
            "agents": {
                "codex": {
                    "active_profile_id": "cap-dev",
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
            "needs_login": true,
            "reason": "refresh_failed",
            "message": "Sign in again.",
            "detected_at_ms": 1,
        });
        let identity = agent_accounts_profile_identity("codex", Some(&profile_dir));
        let status = agent_accounts_auth_status(
            "codex",
            "cap-dev",
            Some(&profile),
            &identity,
            profile.get(AGENT_ACCOUNTS_AUTH_ISSUE_KEY),
        );
        assert_eq!(status["needs_login"].as_bool(), Some(true));

        fs::write(
            profile_dir.join("auth.json"),
            test_codex_auth_for_email("dev@example.com"),
        )
        .unwrap();
        let mut registry = json!({
            "agents": {
                "codex": {
                    "active_profile_id": "cap-dev",
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
            panes["pane-test-claude"]["profile_id"].as_str(),
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
        fs::write(
            claude_home.join(".credentials.json"),
            r#"{"token":"secret"}"#,
        )
        .unwrap();
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

        assert!(bundle
            .files
            .iter()
            .any(|file| file.name == ".credentials.json"));
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
            state
                .pointer("/oauthAccount/emailAddress")
                .and_then(Value::as_str),
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
        fs::write(
            claude_home.join(".credentials.json"),
            r#"{"token":"secret"}"#,
        )
        .unwrap();
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
                    "active_profile_id": AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
                    "profiles": []
                }
            }
        }))
        .unwrap();

        let result = agent_accounts_wipe_pushed_profile_internal(
            None,
            "claude",
            AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
            "pushed@example.com",
            None,
        )
        .unwrap();

        assert_eq!(result["default_home_wiped"].as_bool(), Some(true));
        assert!(!claude_home.join(".credentials.json").exists());
        let state =
            serde_json::from_str::<Value>(&fs::read_to_string(home.join(".claude.json")).unwrap())
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
                    "active_profile_id": "cap-escape",
                    "profiles": [
                        { "id": "cap-escape", "email": "escape@example.com", "source": "pushed", "dir": escaping_registry_dir.to_string_lossy().to_string() }
                    ]
                }
            }
        }))
        .unwrap();

        let error = agent_accounts_wipe_pushed_profile_internal(
            None,
            "codex",
            "cap-escape",
            "escape@example.com",
            None,
        )
        .unwrap_err();

        assert!(error.contains("outside managed storage"));
        assert!(escaped_dir.join("auth.json").is_file());
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
                    "active_profile_id": "cap-pushed",
                    "profiles": [
                        { "id": "cap-pushed", "email": "pushed@example.com", "source": "pushed", "dir": pushed_dir.to_string_lossy().to_string() }
                    ]
                }
            }
        }))
        .unwrap();
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
                created_at_ms: todo_dispatch_now_ms(),
                expires_at_ms: todo_dispatch_now_ms()
                    .saturating_add(AGENT_ACCOUNT_PUSH_BLOB_TTL_MS),
                ack_nonce_b64: String::new(),
                target_push_public_key_b64: String::new(),
                source_credentials_sha256: String::new(),
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
    fn agent_account_push_stale_completion_is_rejected_and_removed() {
        use hmac::Mac as _;

        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_stale_completion_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let default_codex_home = home.join(".codex");
        test_write_codex_profile(&default_codex_home, "pushed@example.com");
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        agent_accounts_registry_write(&json!({ "agents": {} })).unwrap();
        let local_key = agent_account_push_public_key_metadata().unwrap();
        let local_public = agent_account_push_decode_public_key(&local_key.public_key_b64).unwrap();
        let local_device = cloud_mcp_desktop_device_profile();
        let local_device_id =
            cloud_mcp_payload_text(&local_device, &["device_id"]).unwrap();
        let target_secret = crypto_box::SecretKey::from(agent_account_push_random_32().unwrap());
        let target_public_b64 =
            general_purpose::STANDARD.encode(target_secret.public_key().as_bytes());
        let nonce_b64 = general_purpose::STANDARD.encode(agent_account_push_random_32().unwrap());
        agent_account_push_pending().lock().unwrap().clear();
        agent_account_push_pending().lock().unwrap().insert(
            "push-stale".to_string(),
            AgentAccountPushPending {
                agent_kind: "codex".to_string(),
                profile_id: "default".to_string(),
                target_device_id: "device-b".to_string(),
                wipe_local_after: true,
                identity_email: "pushed@example.com".to_string(),
                delivered: true,
                created_at_ms: 1,
                expires_at_ms: 2,
                ack_nonce_b64: nonce_b64.clone(),
                target_push_public_key_b64: target_public_b64,
                source_credentials_sha256: String::new(),
            },
        );

        assert!(!agent_account_push_pending_is_fresh(
            agent_account_push_pending()
                .lock()
                .unwrap()
                .get("push-stale")
                .unwrap(),
            todo_dispatch_now_ms(),
        ));
        let payload = agent_account_push_ack_payload(
            "push-stale",
            &nonce_b64,
            &local_device_id,
            "device-b",
        )
        .unwrap();
        let shared = x25519_dalek::x25519(target_secret.to_bytes(), local_public);
        let mut mac = hmac::Hmac::<Sha256>::new_from_slice(&shared).unwrap();
        mac.update(b"diffforge.agent_account_push.ack.v2\0");
        mac.update(&payload);
        let proof = general_purpose::STANDARD.encode(mac.finalize().into_bytes());
        assert!(agent_account_push_handle_remote_status_inner(
            None,
            &json!({
                "event_kind": "remote_command_result",
                "command_kind": "agent_account_push",
                "command_id": "agent-account-push-push-stale",
                "push_id": "push-stale",
                "status": "completed",
                "device_id": "device-b",
                "details": { "recipient_proof_b64": proof }
            })
        ));
        assert!(!agent_account_push_pending()
            .lock()
            .unwrap()
            .contains_key("push-stale"));
        assert!(default_codex_home.join("auth.json").is_file());
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

        let first = crypto_box::SecretKey::from(agent_account_push_random_32().unwrap());
        let first_key = general_purpose::STANDARD.encode(first.public_key().as_bytes());
        let first_fingerprint = agent_account_push_key_fingerprint(&first_key).unwrap();
        let second = crypto_box::SecretKey::from(agent_account_push_random_32().unwrap());
        let second_key = general_purpose::STANDARD.encode(second.public_key().as_bytes());
        let second_fingerprint = agent_account_push_key_fingerprint(&second_key).unwrap();

        assert!(agent_account_push_verify_or_pin_target_key(
            "invalid-device",
            "not-base64",
            Some("00")
        )
        .is_err());
        let low_order_key = general_purpose::STANDARD.encode([0_u8; 32]);
        assert!(agent_account_push_verify_or_pin_target_key(
            "low-order-device",
            &low_order_key,
            Some(&agent_account_push_key_fingerprint(&low_order_key).unwrap())
        )
        .is_err());
        assert!(!agent_account_push_trusted_keys_path().unwrap().exists());
        let unconfirmed =
            agent_account_push_verify_or_pin_target_key("Device-A", &first_key, None).unwrap_err();
        assert!(unconfirmed.contains("out-of-band fingerprint"));
        agent_account_push_verify_or_pin_target_key(
            "Device-A",
            &first_key,
            Some(&first_fingerprint),
        )
        .unwrap();
        agent_account_push_verify_or_pin_target_key("device-a", &first_key, None).unwrap();
        let error = agent_account_push_verify_or_pin_target_key(
            "device-a",
            &second_key,
            Some(&second_fingerprint),
        )
        .unwrap_err();

        assert!(error.contains("security key changed"));
    }

    #[test]
    fn agent_account_push_completed_requires_recipient_key_proof() {
        use hmac::Mac as _;

        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root =
            env::temp_dir().join(format!("agent_accounts_ack_proof_{}", uuid::Uuid::new_v4()));
        let data = root.join("data");
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        let local_key = agent_account_push_public_key_metadata().unwrap();
        let local_public = agent_account_push_decode_public_key(&local_key.public_key_b64).unwrap();
        let local_device = cloud_mcp_desktop_device_profile();
        let local_device_id =
            cloud_mcp_payload_text(&local_device, &["device_id"]).unwrap();
        let target_secret = crypto_box::SecretKey::from(agent_account_push_random_32().unwrap());
        let target_public_b64 =
            general_purpose::STANDARD.encode(target_secret.public_key().as_bytes());
        let nonce_b64 = general_purpose::STANDARD.encode(agent_account_push_random_32().unwrap());
        let now_ms = todo_dispatch_now_ms();
        agent_account_push_pending().lock().unwrap().clear();
        agent_account_push_pending().lock().unwrap().insert(
            "push-proof".to_string(),
            AgentAccountPushPending {
                agent_kind: "codex".to_string(),
                profile_id: "default".to_string(),
                target_device_id: "device-b".to_string(),
                wipe_local_after: false,
                identity_email: "pushed@example.com".to_string(),
                delivered: true,
                created_at_ms: now_ms,
                expires_at_ms: now_ms.saturating_add(AGENT_ACCOUNT_PUSH_BLOB_TTL_MS),
                ack_nonce_b64: nonce_b64.clone(),
                target_push_public_key_b64: target_public_b64,
                source_credentials_sha256: String::new(),
            },
        );
        let event = |proof: Option<&str>| {
            let mut event = json!({
                "event_kind": "remote_command_result",
                "command_kind": "agent_account_push",
                "command_id": "agent-account-push-push-proof",
                "push_id": "push-proof",
                "status": "completed",
                "device_id": "device-b",
            });
            if let Some(proof) = proof {
                event["details"] = json!({ "recipient_proof_b64": proof });
            }
            event
        };
        assert!(agent_account_push_handle_remote_status_inner(
            None,
            &event(None)
        ));
        assert!(agent_account_push_pending()
            .lock()
            .unwrap()
            .contains_key("push-proof"));

        let payload =
            agent_account_push_ack_payload("push-proof", &nonce_b64, &local_device_id, "device-b")
                .unwrap();
        let shared = x25519_dalek::x25519(target_secret.to_bytes(), local_public);
        let mut mac = hmac::Hmac::<Sha256>::new_from_slice(&shared).unwrap();
        mac.update(b"diffforge.agent_account_push.ack.v2\0");
        mac.update(&payload);
        let proof = general_purpose::STANDARD.encode(mac.finalize().into_bytes());
        assert!(agent_account_push_handle_remote_status_inner(
            None,
            &event(Some(&proof))
        ));
        assert!(!agent_account_push_pending()
            .lock()
            .unwrap()
            .contains_key("push-proof"));
    }

    #[test]
    fn agent_account_push_received_blob_rejects_wrong_target_expiry_and_replay() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!("agent_accounts_replay_{}", uuid::Uuid::new_v4()));
        let data = root.join("data");
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);

        let wrong_target = test_agent_account_push_blob("push-a", "device-a", 1_000, 2_000);
        assert!(
            agent_account_push_verify_received_blob(wrong_target, "push-a", "device-b", 1_500,)
                .is_err()
        );

        let expired = test_agent_account_push_blob("push-b", "device-a", 1_000, 2_000);
        assert!(
            agent_account_push_verify_received_blob(expired, "push-b", "device-a", 2_001,).is_err()
        );

        agent_account_push_reject_if_applied("push-replay", 1_500).unwrap();
        assert!(agent_account_push_applied_path().unwrap().is_file());
        assert!(agent_account_push_reject_if_applied("push-replay", 1_500).is_err());
        agent_account_push_mark_applied("push-replay", 2_000, 1_500).unwrap();
        assert!(agent_account_push_reject_if_applied("push-replay", 1_600).is_err());
        assert!(agent_account_push_reject_if_applied("push-replay", 2_001).is_ok());
    }

    #[test]
    fn agent_account_push_requires_trusted_authenticated_sender() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_sender_auth_{}",
            uuid::Uuid::new_v4()
        ));
        let sender_data = root.join("sender");
        let recipient_data = root.join("recipient");
        let blob = test_authenticated_agent_account_push_blob(
            &sender_data,
            &recipient_data,
            "push-authenticated",
        );
        let now_ms = blob.issued_at_ms;
        {
            let _env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &recipient_data);
            agent_account_push_verify_received_blob(
                blob.clone(),
                "push-authenticated",
                "device-recipient",
                now_ms,
            )
            .unwrap();

            let mut tampered = blob.clone();
            tampered.identity_email = "victim@example.com".to_string();
            assert!(agent_account_push_verify_received_blob(
                tampered,
                "push-authenticated",
                "device-recipient",
                now_ms,
            )
            .is_err());
        }

        let unknown_recipient = root.join("unknown-recipient");
        {
            let _env =
                ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &unknown_recipient);
            let unknown_key = agent_account_push_public_key_metadata().unwrap();
            let mut unknown_blob = blob.clone();
            unknown_blob.target_device_id = "device-unknown".to_string();
            {
                let _sender_env =
                    ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &sender_data);
                agent_account_push_authenticate_outbound_blob(
                    &mut unknown_blob,
                    &unknown_key.public_key_b64,
                )
                .unwrap();
            }
            let error = match agent_account_push_verify_received_blob(
                unknown_blob,
                "push-authenticated",
                "device-unknown",
                now_ms,
            ) {
                Ok(_) => panic!("unknown sender should be rejected"),
                Err(error) => error,
            };
            assert!(error.contains("not user-confirmed"));
        }
    }

    #[test]
    fn agent_account_push_materialize_is_private_and_never_overwrites() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_materialize_{}",
            uuid::Uuid::new_v4()
        ));
        let sender_data = root.join("sender");
        let recipient_data = root.join("recipient");
        let home = root.join("home");
        let blob = test_authenticated_agent_account_push_blob(
            &sender_data,
            &recipient_data,
            "push-materialize",
        );
        let profile_id =
            agent_account_push_profile_id(&blob.agent_kind, &blob.sender_device_id, &blob.push_id);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &recipient_data);
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let details = agent_accounts_materialize_pushed_account(blob.clone()).unwrap();
        assert!(details.get("recipient_proof_b64").is_some());
        assert!(details.get("identity_email").is_none());
        assert!(details.get("dir").is_none());
        let final_dir = recipient_data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("codex")
            .join(&profile_id);
        assert!(final_dir.join("auth.json").is_file());

        let error = agent_accounts_materialize_pushed_account(blob).unwrap_err();
        assert!(error.contains("refusing to overwrite"));
        assert!(final_dir.join("auth.json").is_file());
    }

    #[test]
    fn agent_account_push_registry_failure_never_reports_materialized() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_registry_failure_{}",
            uuid::Uuid::new_v4()
        ));
        let sender_data = root.join("sender");
        let recipient_data = root.join("recipient");
        let home = root.join("home");
        let blob = test_authenticated_agent_account_push_blob(
            &sender_data,
            &recipient_data,
            "push-registry-failure",
        );
        let profile_id =
            agent_account_push_profile_id(&blob.agent_kind, &blob.sender_device_id, &blob.push_id);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &recipient_data);
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let registry_path = agent_accounts_file_path().unwrap();
        fs::create_dir_all(&registry_path).unwrap();

        assert!(agent_accounts_materialize_pushed_account(blob).is_err());
        assert!(!recipient_data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("codex")
            .join(profile_id)
            .exists());
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
        let replacement_secret =
            crypto_box::SecretKey::from(agent_account_push_random_32().unwrap());
        let replacement_file = AgentAccountPushKeyFile {
            version: 1,
            algorithm: AGENT_ACCOUNT_PUSH_SEALED_ALGORITHM.to_string(),
            private_key_b64: general_purpose::STANDARD.encode(replacement_secret.to_bytes()),
            public_key_b64: general_purpose::STANDARD
                .encode(replacement_secret.public_key().as_bytes()),
            created_at_ms: todo_dispatch_now_ms(),
        };
        agent_account_push_write_private_json(&path, &replacement_file).unwrap();

        let sealed = agent_account_push_seal_blob(&metadata.public_key_b64, b"same-run").unwrap();

        assert_eq!(agent_account_push_open_blob(&sealed).unwrap(), b"same-run");
    }

    #[test]
    fn wipe_reprobes_non_default_identity_before_deleting() {
        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_wipe_reprobe_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let pushed_dir = data
            .join(AGENT_ACCOUNTS_PROFILE_DIR)
            .join("codex")
            .join("cap-stale");
        test_write_codex_profile(&pushed_dir, "account-b@example.com");
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        agent_accounts_registry_write(&json!({
            "agents": {
                "codex": {
                    "active_profile_id": "cap-stale",
                    "profiles": [{
                        "id": "cap-stale",
                        "email": "account-a@example.com",
                        "source": "pushed",
                        "dir": pushed_dir.to_string_lossy().to_string()
                    }]
                }
            }
        }))
        .unwrap();

        let error = agent_accounts_wipe_pushed_profile_internal(
            None,
            "codex",
            "cap-stale",
            "account-a@example.com",
            None,
        )
        .unwrap_err();

        assert!(error.contains("identity changed"));
        assert!(pushed_dir.join("auth.json").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn wipe_rejects_symlinked_claude_global_state_without_touching_target() {
        use std::os::unix::fs::symlink;

        let _guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = env::temp_dir().join(format!(
            "agent_accounts_wipe_claude_symlink_{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let data = root.join("data");
        let claude_home = home.join(".claude");
        let outside_state = root.join("outside-claude.json");
        fs::create_dir_all(&claude_home).unwrap();
        fs::write(claude_home.join(".credentials.json"), "secret-token").unwrap();
        fs::write(
            &outside_state,
            test_claude_state_for_email("pushed@example.com"),
        )
        .unwrap();
        fs::create_dir_all(&home).unwrap();
        symlink(&outside_state, home.join(".claude.json")).unwrap();
        let outside_before = fs::read(&outside_state).unwrap();
        let _home_env = ScopedAgentAccountsEnv::set("HOME", &home);
        let _data_env = ScopedAgentAccountsEnv::set(CLOUD_MCP_LOCAL_DATA_DIR_ENV, &data);
        agent_accounts_registry_write(&json!({ "agents": {} })).unwrap();

        let error = agent_accounts_wipe_pushed_profile_internal(
            None,
            "claude",
            AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
            "pushed@example.com",
            None,
        )
        .unwrap_err();

        assert!(error.contains("symlink"));
        assert!(claude_home.join(".credentials.json").is_file());
        assert_eq!(fs::read(outside_state).unwrap(), outside_before);
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
                    "active_profile_id": "cap-pushed",
                    "profiles": [
                        { "id": "cap-pushed", "email": "pushed@example.com", "source": "pushed", "dir": pushed_dir.to_string_lossy().to_string() },
                        { "id": "cap-other", "email": "other@example.com", "source": "captured", "dir": other_codex_dir.to_string_lossy().to_string() }
                    ]
                },
                "claude": {
                    "active_profile_id": "cap-claude",
                    "profiles": [
                        { "id": "cap-claude", "email": "claude@example.com", "source": "captured", "dir": other_kind_dir.to_string_lossy().to_string() }
                    ]
                }
            }
        }))
        .unwrap();

        let result = agent_accounts_wipe_pushed_profile_internal(
            None,
            "codex",
            "cap-pushed",
            "pushed@example.com",
            None,
        )
        .unwrap();

        assert_eq!(result["profile_removed"].as_bool(), Some(true));
        assert!(!pushed_dir.exists());
        assert!(other_codex_dir.join("auth.json").is_file());
        assert!(other_kind_dir.join(".credentials.json").is_file());
        let registry = agent_accounts_registry_read();
        assert_eq!(
            registry["agents"]["codex"]["active_profile_id"].as_str(),
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
                    "active_profile_id": "cap-pushed",
                    "profiles": [
                        { "id": "cap-pushed", "email": "pushed@example.com", "source": "pushed", "dir": pushed_dir.to_string_lossy().to_string() }
                    ]
                }
            }
        }))
        .unwrap();

        let result = agent_accounts_wipe_pushed_profile_internal(
            None,
            "codex",
            "cap-pushed",
            "pushed@example.com",
            None,
        )
        .unwrap();

        assert_eq!(result["default_home_wiped"].as_bool(), Some(false));
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
                    "active_profile_id": "cap-pushed",
                    "profiles": [
                        { "id": "cap-pushed", "email": "pushed@example.com", "source": "pushed", "dir": pushed_dir.to_string_lossy().to_string() },
                        { "id": "cap-other", "email": "other@example.com", "source": "captured", "dir": other_dir.to_string_lossy().to_string() }
                    ]
                }
            }
        }))
        .unwrap();

        let result = agent_accounts_wipe_pushed_profile_internal(
            None,
            "codex",
            "cap-pushed",
            "pushed@example.com",
            None,
        )
        .unwrap();

        assert_eq!(result["default_home_wiped"].as_bool(), Some(true));
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
                    "active_profile_id": "cap-pushed",
                    "profiles": [
                        { "id": "cap-pushed", "email": "pushed@example.com", "source": "pushed", "dir": pushed_dir.to_string_lossy().to_string() }
                    ]
                }
            }
        }))
        .unwrap();
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
                created_at_ms: todo_dispatch_now_ms(),
                expires_at_ms: todo_dispatch_now_ms()
                    .saturating_add(AGENT_ACCOUNT_PUSH_BLOB_TTL_MS),
                ack_nonce_b64: String::new(),
                target_push_public_key_b64: String::new(),
                source_credentials_sha256: String::new(),
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

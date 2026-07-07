const SSH_PROFILES_FILE: &str = "ssh_profiles.json";
const SSH_PROFILE_ID_PREFIX: &str = "ssh-";
const SSH_AUTOFILL_TTL_SECS: u64 = 90;
// Fill exactly once, then disarm. The first matched prompt IS the ssh password
// prompt; a second fill cannot help (a wrong stored password stays wrong on
// retry) and only risks writing the secret into a later `New password:` /
// `Database password:` prompt printed by the post-login shell within the TTL.
const SSH_AUTOFILL_MAX_FILLS: u8 = 1;
const SSH_AUTOFILL_TAIL_BYTES: usize = 256;
const SSH_CONNECT_READY_TIMEOUT_MS: u64 = 20_000;
const SSH_CONNECT_READY_POLL_MS: u64 = 100;
// A plain shell accepts input as soon as its PTY is live and the prompt is
// printed. Unlike coding agents, a generic shell's `input_ready` is projected
// back through the frontend from prompt-marker heuristics, so it can lag or —
// with an exotic prompt the heuristics do not recognize — never flip. Prefer
// `input_ready` as a fast path but fall back to writing once the pane has been
// present for a short settle so SSH launch never hangs on a live shell.
const SSH_CONNECT_READY_SETTLE_MS: u64 = 600;

static SSH_PROFILES_STORE_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static SSH_PASSWORD_AUTOFILL_WATCHERS: OnceLock<
    StdMutex<HashMap<String, SshPasswordAutofillWatcher>>,
> = OnceLock::new();
static SSH_PASSWORD_AUTOFILL_ACTIVE_COUNT: AtomicUsize = AtomicUsize::new(0);
static SSH_PASSWORD_AUTOFILL_NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshProfilesRegistry {
    profiles: Vec<SshProfileRecord>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshProfileRecord {
    id: String,
    name: String,
    host: String,
    port: Option<u16>,
    username: Option<String>,
    auth_method: String,
    key_path: Option<String>,
    certificate_path: Option<String>,
    secret: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshProfileSummary {
    id: String,
    name: String,
    host: String,
    port: Option<u16>,
    username: Option<String>,
    auth_method: String,
    key_path: Option<String>,
    certificate_path: Option<String>,
    created_at: String,
    updated_at: String,
    has_secret: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SshProfilesListResult {
    profiles: Vec<SshProfileSummary>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshProfileSaveRequest {
    id: Option<String>,
    name: String,
    host: String,
    port: Option<u16>,
    username: Option<String>,
    auth_method: String,
    key_path: Option<String>,
    certificate_path: Option<String>,
    secret: Option<String>,
}

struct SshProfileValidatedRequest {
    id: Option<String>,
    name: String,
    host: String,
    port: Option<u16>,
    username: Option<String>,
    auth_method: String,
    key_path: Option<String>,
    certificate_path: Option<String>,
    secret: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSshConnectResult {
    started: bool,
    message: String,
}

struct SshPasswordAutofillWatcher {
    token: u64,
    instance_id: u64,
    secret: String,
    tail: Vec<u8>,
    fills: u8,
    expires_at: Instant,
}

fn ssh_profiles_file_path() -> Option<PathBuf> {
    cloud_mcp_local_data_file_path(SSH_PROFILES_FILE)
}

fn ssh_profiles_store_lock() -> &'static StdMutex<()> {
    SSH_PROFILES_STORE_LOCK.get_or_init(|| StdMutex::new(()))
}

fn ssh_password_autofill_watchers() -> &'static StdMutex<HashMap<String, SshPasswordAutofillWatcher>>
{
    SSH_PASSWORD_AUTOFILL_WATCHERS.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn ssh_password_autofill_set_count(count: usize) {
    SSH_PASSWORD_AUTOFILL_ACTIVE_COUNT.store(count, Ordering::Release);
}

fn ssh_profile_optional_trim(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn ssh_profile_validate_request(
    request: SshProfileSaveRequest,
) -> Result<SshProfileValidatedRequest, String> {
    let id = match request.id {
        Some(value) => {
            let value = value.trim().to_string();
            if value.is_empty() {
                return Err("SSH profile id is required for updates.".to_string());
            }
            Some(value)
        }
        None => None,
    };
    let name = request.name.trim().to_string();
    if name.is_empty() {
        return Err("SSH profile name is required.".to_string());
    }
    let host = request.host.trim().to_string();
    if host.is_empty() {
        return Err("SSH profile host is required.".to_string());
    }
    if host.chars().any(char::is_whitespace) {
        return Err("SSH profile host must not contain whitespace.".to_string());
    }
    // Shell single-quoting stops shell injection but not ssh option injection:
    // a host/username beginning with `-` is parsed by ssh as a flag (e.g.
    // `-oProxyCommand=...`), not a destination. Reject it up front.
    if host.starts_with('-') {
        return Err("SSH profile host must not start with '-'.".to_string());
    }
    let username = ssh_profile_optional_trim(request.username);
    if username.as_deref().is_some_and(|value| value.starts_with('-')) {
        return Err("SSH profile username must not start with '-'.".to_string());
    }
    if request.port == Some(0) {
        return Err("SSH profile port must be greater than 0.".to_string());
    }
    let auth_method = request.auth_method.trim().to_ascii_lowercase();
    if !matches!(auth_method.as_str(), "agent" | "password" | "key") {
        return Err("SSH profile auth method must be agent, password, or key.".to_string());
    }
    let key_path = ssh_profile_optional_trim(request.key_path);
    if auth_method == "key" && key_path.is_none() {
        return Err("SSH key path is required for key auth.".to_string());
    }
    Ok(SshProfileValidatedRequest {
        id,
        name,
        host,
        port: request.port,
        username,
        auth_method,
        key_path,
        certificate_path: ssh_profile_optional_trim(request.certificate_path),
        // Secrets are stored verbatim: trimming would silently corrupt a
        // password that legitimately contains leading/trailing whitespace.
        secret: request.secret,
    })
}

fn ssh_profiles_read_registry_locked() -> Result<SshProfilesRegistry, String> {
    let Some(path) = ssh_profiles_file_path() else {
        return Err("Unable to resolve SSH profiles storage path.".to_string());
    };
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SshProfilesRegistry::default());
        }
        Err(error) => {
            return Err(format!("Unable to read SSH profiles: {error}"));
        }
    };
    if raw.trim().is_empty() {
        return Ok(SshProfilesRegistry::default());
    }
    if let Ok(registry) = serde_json::from_str::<SshProfilesRegistry>(&raw) {
        return Ok(registry);
    }
    if let Ok(profiles) = serde_json::from_str::<Vec<SshProfileRecord>>(&raw) {
        return Ok(SshProfilesRegistry { profiles });
    }
    Err("Unable to parse SSH profiles.".to_string())
}

fn ssh_profiles_write_registry_locked(registry: &SshProfilesRegistry) -> Result<(), String> {
    let Some(path) = ssh_profiles_file_path() else {
        return Err("Unable to resolve SSH profiles storage path.".to_string());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create SSH profiles directory: {error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(registry)
        .map_err(|error| format!("Unable to serialize SSH profiles: {error}"))?;

    // Write to a sibling temp file then atomically rename over the target so a
    // crash / power loss / disk-full mid-write can never leave the store empty
    // or partial (which would drop every saved profile and its secret).
    let temp_path = path.with_extension("json.tmp");

    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&temp_path)
            .map_err(|error| format!("Unable to write SSH profiles: {error}"))?;
        file.write_all(&bytes)
            .map_err(|error| format!("Unable to write SSH profiles: {error}"))?;
        file.flush()
            .map_err(|error| format!("Unable to flush SSH profiles: {error}"))?;
        let _ = file.sync_all();
        let _ = fs::set_permissions(&temp_path, fs::Permissions::from_mode(0o600));
    }

    #[cfg(not(unix))]
    {
        fs::write(&temp_path, &bytes)
            .map_err(|error| format!("Unable to write SSH profiles: {error}"))?;
    }

    if let Err(error) = fs::rename(&temp_path, &path) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Unable to persist SSH profiles: {error}"));
    }

    Ok(())
}

fn ssh_profile_summary(profile: &SshProfileRecord) -> SshProfileSummary {
    SshProfileSummary {
        id: profile.id.clone(),
        name: profile.name.clone(),
        host: profile.host.clone(),
        port: profile.port,
        username: profile.username.clone(),
        auth_method: profile.auth_method.clone(),
        key_path: profile.key_path.clone(),
        certificate_path: profile.certificate_path.clone(),
        created_at: profile.created_at.clone(),
        updated_at: profile.updated_at.clone(),
        has_secret: profile
            .secret
            .as_deref()
            .is_some_and(|value| !value.is_empty()),
    }
}

fn ssh_profile_sort_key(profile: &SshProfileSummary) -> (String, String) {
    (profile.name.to_ascii_lowercase(), profile.id.clone())
}

#[tauri::command]
fn ssh_profiles_list() -> Result<SshProfilesListResult, String> {
    let _guard = ssh_profiles_store_lock()
        .lock()
        .map_err(|_| "Unable to lock SSH profiles storage.".to_string())?;
    let registry = ssh_profiles_read_registry_locked()?;
    let mut profiles = registry
        .profiles
        .iter()
        .map(ssh_profile_summary)
        .collect::<Vec<_>>();
    profiles.sort_by_key(ssh_profile_sort_key);
    Ok(SshProfilesListResult { profiles })
}

#[tauri::command]
fn ssh_profile_save(request: SshProfileSaveRequest) -> Result<SshProfileSummary, String> {
    let request = ssh_profile_validate_request(request)?;
    let _guard = ssh_profiles_store_lock()
        .lock()
        .map_err(|_| "Unable to lock SSH profiles storage.".to_string())?;
    let mut registry = ssh_profiles_read_registry_locked()?;
    let now = crate::coordination::kernel::now_rfc3339();

    let saved = if let Some(id) = request.id.as_deref() {
        let Some(profile) = registry
            .profiles
            .iter_mut()
            .find(|profile| profile.id == id)
        else {
            return Err("SSH profile was not found.".to_string());
        };
        profile.name = request.name;
        profile.host = request.host;
        profile.port = request.port;
        profile.username = request.username;
        profile.auth_method = request.auth_method;
        profile.key_path = request.key_path;
        profile.certificate_path = request.certificate_path;
        if let Some(secret) = request.secret {
            profile.secret = (!secret.is_empty()).then_some(secret);
        }
        profile.updated_at = now;
        profile.clone()
    } else {
        let secret = request
            .secret
            .and_then(|secret| (!secret.is_empty()).then_some(secret));
        let profile = SshProfileRecord {
            id: format!("{SSH_PROFILE_ID_PREFIX}{}", uuid::Uuid::new_v4()),
            name: request.name,
            host: request.host,
            port: request.port,
            username: request.username,
            auth_method: request.auth_method,
            key_path: request.key_path,
            certificate_path: request.certificate_path,
            secret,
            created_at: now.clone(),
            updated_at: now,
        };
        registry.profiles.push(profile.clone());
        profile
    };

    ssh_profiles_write_registry_locked(&registry)?;
    Ok(ssh_profile_summary(&saved))
}

#[tauri::command]
fn ssh_profile_delete(profile_id: String) -> Result<bool, String> {
    let profile_id = profile_id.trim().to_string();
    if profile_id.is_empty() {
        return Err("SSH profile id is required.".to_string());
    }
    let _guard = ssh_profiles_store_lock()
        .lock()
        .map_err(|_| "Unable to lock SSH profiles storage.".to_string())?;
    let mut registry = ssh_profiles_read_registry_locked()?;
    let before = registry.profiles.len();
    registry.profiles.retain(|profile| profile.id != profile_id);
    let removed = registry.profiles.len() != before;
    if removed {
        ssh_profiles_write_registry_locked(&registry)?;
    }
    Ok(removed)
}

fn ssh_profile_load(profile_id: &str) -> Result<SshProfileRecord, String> {
    let profile_id = profile_id.trim();
    if profile_id.is_empty() {
        return Err("SSH profile id is required.".to_string());
    }
    let _guard = ssh_profiles_store_lock()
        .lock()
        .map_err(|_| "Unable to lock SSH profiles storage.".to_string())?;
    let registry = ssh_profiles_read_registry_locked()?;
    registry
        .profiles
        .into_iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| "SSH profile was not found.".to_string())
}

fn ssh_shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn ssh_expand_home_path(value: &str) -> String {
    let value = value.trim();
    if value != "~" && !value.starts_with("~/") {
        return value.to_string();
    }
    let Some(home) = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
    else {
        return value.to_string();
    };
    if value == "~" {
        return home.to_string_lossy().to_string();
    }
    home.join(&value[2..]).to_string_lossy().to_string()
}

fn ssh_profile_command(profile: &SshProfileRecord) -> Result<String, String> {
    let mut parts = vec![
        "ssh".to_string(),
        "-o ServerAliveInterval=30".to_string(),
        "-o ServerAliveCountMax=4".to_string(),
    ];
    if let Some(port) = profile.port {
        if port == 0 {
            return Err("SSH profile port must be greater than 0.".to_string());
        }
        parts.push("-p".to_string());
        parts.push(port.to_string());
    }
    match profile.auth_method.as_str() {
        "key" => {
            let Some(key_path) = profile
                .key_path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                return Err("SSH key path is required for key auth.".to_string());
            };
            parts.push("-i".to_string());
            parts.push(ssh_shell_quote(&ssh_expand_home_path(key_path)));
            parts.push("-o IdentitiesOnly=yes".to_string());
            if let Some(certificate_path) = profile
                .certificate_path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                parts.push(format!(
                    "-o CertificateFile={}",
                    ssh_shell_quote(&ssh_expand_home_path(certificate_path))
                ));
            }
        }
        "password" => {
            parts.push("-o PreferredAuthentications=password,keyboard-interactive".to_string());
            parts.push("-o PubkeyAuthentication=no".to_string());
        }
        "agent" => {}
        _ => return Err("SSH profile auth method must be agent, password, or key.".to_string()),
    }
    let host = profile.host.trim();
    if host.is_empty() || host.chars().any(char::is_whitespace) {
        return Err("SSH profile host must not contain whitespace.".to_string());
    }
    if host.starts_with('-') {
        return Err("SSH profile host must not start with '-'.".to_string());
    }
    let username = profile
        .username
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if username.is_some_and(|value| value.starts_with('-')) {
        return Err("SSH profile username must not start with '-'.".to_string());
    }
    let destination = username
        .map(|username| format!("{}@{}", ssh_shell_quote(username), ssh_shell_quote(host)))
        .unwrap_or_else(|| ssh_shell_quote(host));
    parts.push(destination);
    Ok(parts.join(" "))
}

fn ssh_strip_ansi(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = String::with_capacity(value.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != 0x1b {
            if let Some(character) = value[index..].chars().next() {
                output.push(character);
                index += character.len_utf8();
            } else {
                break;
            }
            continue;
        }

        index += 1;
        if index >= bytes.len() {
            break;
        }
        match bytes[index] {
            b'[' => {
                index += 1;
                while index < bytes.len() {
                    let byte = bytes[index];
                    index += 1;
                    if (0x40..=0x7e).contains(&byte) {
                        break;
                    }
                }
            }
            b']' | b'P' | b'^' | b'_' => {
                index += 1;
                while index < bytes.len() {
                    if bytes[index] == 0x07 {
                        index += 1;
                        break;
                    }
                    if bytes[index] == 0x1b && index + 1 < bytes.len() && bytes[index + 1] == b'\\'
                    {
                        index += 2;
                        break;
                    }
                    index += 1;
                }
            }
            b'(' | b')' | b'*' | b'+' | b'-' | b'.' | b'/' => {
                index += 1;
                if index < bytes.len() {
                    index += 1;
                }
            }
            _ => {
                index += 1;
            }
        }
    }
    output
}

fn ssh_password_prompt_tail_matches(clean_tail: &str) -> bool {
    let trimmed = clean_tail.trim_end_matches(char::is_whitespace);
    if !trimmed.ends_with(':') {
        return false;
    }
    let line = trimmed
        .rsplit(['\r', '\n'])
        .next()
        .unwrap_or(trimmed)
        .to_ascii_lowercase();
    line.contains("password") || line.contains("passphrase")
}

fn ssh_password_autofill_expire(pane_id: &str, token: u64) {
    let Ok(mut watchers) = ssh_password_autofill_watchers().lock() else {
        return;
    };
    if watchers
        .get(pane_id)
        .is_some_and(|watcher| watcher.token == token)
    {
        watchers.remove(pane_id);
        ssh_password_autofill_set_count(watchers.len());
    }
}

fn ssh_password_autofill_arm(pane_id: &str, instance_id: u64, secret: String) {
    if secret.is_empty() {
        return;
    }
    let token = SSH_PASSWORD_AUTOFILL_NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut watchers) = ssh_password_autofill_watchers().lock() {
        watchers.insert(
            pane_id.to_string(),
            SshPasswordAutofillWatcher {
                token,
                instance_id,
                secret,
                tail: Vec::with_capacity(SSH_AUTOFILL_TAIL_BYTES),
                fills: 0,
                expires_at: Instant::now() + Duration::from_secs(SSH_AUTOFILL_TTL_SECS),
            },
        );
        ssh_password_autofill_set_count(watchers.len());
    }
    let pane_id = pane_id.to_string();
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_secs(SSH_AUTOFILL_TTL_SECS)).await;
        ssh_password_autofill_expire(&pane_id, token);
    });
}

fn ssh_password_autofill_disarm_if_instance(pane_id: &str, instance_id: u64) {
    let Ok(mut watchers) = ssh_password_autofill_watchers().lock() else {
        return;
    };
    if watchers
        .get(pane_id)
        .is_some_and(|watcher| watcher.instance_id == instance_id)
    {
        watchers.remove(pane_id);
        ssh_password_autofill_set_count(watchers.len());
    }
}

fn ssh_password_autofill_write_secret(
    terminals: &Arc<RwLock<HashMap<String, TerminalInstance>>>,
    pane_id: &str,
    instance_id: u64,
    secret: &str,
) {
    if secret.is_empty() {
        return;
    }
    let payload = format!("{secret}\r");
    let instance = {
        let terminals = terminals.blocking_read();
        terminals
            .get(pane_id)
            .filter(|instance| instance.id == instance_id)
            .cloned()
    };
    let Some(instance) = instance else {
        return;
    };
    let _input_guard = instance.input_queue.blocking_lock();
    let terminals_guard = terminals.blocking_read();
    if !terminals_guard
        .get(pane_id)
        .is_some_and(|current| current.id == instance.id)
    {
        return;
    }
    let mut writer = instance.writer.blocking_lock();
    let _ = writer.write_all(payload.as_bytes());
    let _ = writer.flush();
}

fn ssh_password_autofill_observe_output(
    terminals: &Arc<RwLock<HashMap<String, TerminalInstance>>>,
    pane_id: &str,
    instance_id: u64,
    chunk: &[u8],
) {
    if SSH_PASSWORD_AUTOFILL_ACTIVE_COUNT.load(Ordering::Acquire) == 0 || chunk.is_empty() {
        return;
    }

    let secret = {
        let Ok(mut watchers) = ssh_password_autofill_watchers().lock() else {
            return;
        };
        let Some(watcher) = watchers.get_mut(pane_id) else {
            return;
        };
        if watcher.instance_id != instance_id || Instant::now() >= watcher.expires_at {
            watchers.remove(pane_id);
            ssh_password_autofill_set_count(watchers.len());
            return;
        }
        watcher.tail.extend_from_slice(chunk);
        if watcher.tail.len() > SSH_AUTOFILL_TAIL_BYTES {
            let excess = watcher.tail.len() - SSH_AUTOFILL_TAIL_BYTES;
            watcher.tail.drain(0..excess);
        }
        let clean_tail = ssh_strip_ansi(&String::from_utf8_lossy(&watcher.tail));
        if !ssh_password_prompt_tail_matches(&clean_tail) {
            return;
        }
        watcher.fills = watcher.fills.saturating_add(1);
        let secret = watcher.secret.clone();
        watcher.tail.clear();
        if watcher.fills >= SSH_AUTOFILL_MAX_FILLS {
            watchers.remove(pane_id);
            ssh_password_autofill_set_count(watchers.len());
        }
        secret
    };

    ssh_password_autofill_write_secret(terminals, pane_id, instance_id, &secret);
}

async fn ssh_terminal_ready_instance(
    state: &TerminalState,
    pane_id: &str,
) -> Result<Option<TerminalInstance>, String> {
    let started = Instant::now();
    let deadline = started + Duration::from_millis(SSH_CONNECT_READY_TIMEOUT_MS);
    let settle = Duration::from_millis(SSH_CONNECT_READY_SETTLE_MS);
    loop {
        if let Some(instance) = get_terminal_instance_if_current(state, pane_id, None).await? {
            if terminal_runtime_snapshot(&instance).input_ready || started.elapsed() >= settle {
                return Ok(Some(instance));
            }
        }
        if Instant::now() >= deadline {
            // Absolute ceiling reached: write into whatever pane is current, or
            // report a timeout if the pane is gone.
            return get_terminal_instance_if_current(state, pane_id, None).await;
        }
        sleep(Duration::from_millis(SSH_CONNECT_READY_POLL_MS)).await;
    }
}

#[tauri::command]
async fn terminal_ssh_connect(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    pane_id: String,
    profile_id: String,
) -> Result<TerminalSshConnectResult, String> {
    validate_terminal_pane_id(&pane_id)?;
    let profile = ssh_profile_load(&profile_id)?;
    let Some(instance) = ssh_terminal_ready_instance(state.inner(), &pane_id).await? else {
        return Ok(TerminalSshConnectResult {
            started: false,
            message: "Timed out waiting for terminal input readiness.".to_string(),
        });
    };
    let command = format!("{}\r", ssh_profile_command(&profile)?);
    let armed = profile.auth_method == "password"
        && profile
            .secret
            .as_deref()
            .is_some_and(|secret| !secret.is_empty());
    if armed {
        ssh_password_autofill_arm(
            &pane_id,
            instance.id,
            profile.secret.clone().unwrap_or_default(),
        );
    } else {
        ssh_password_autofill_disarm_if_instance(&pane_id, instance.id);
    }

    let write_result = terminal_write_inner(
        app,
        state.inner(),
        cloud_mcp_state.inner(),
        pane_id.clone(),
        Some(instance.id),
        command,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(false),
        false,
    )
    .await;
    if write_result.is_err() && armed {
        ssh_password_autofill_disarm_if_instance(&pane_id, instance.id);
    }
    write_result?;

    Ok(TerminalSshConnectResult {
        started: true,
        message: "SSH command started.".to_string(),
    })
}

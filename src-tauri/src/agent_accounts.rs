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
static AGENT_ACCOUNTS_PRIVATE_FILE_WRITE_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static AGENT_ACCOUNTS_CLAUDE_CREDENTIAL_OBSERVATIONS: OnceLock<
    StdMutex<HashMap<PathBuf, AgentAccountsClaudeCredentialObservation>>,
> = OnceLock::new();
static AGENT_ACCOUNTS_CLAUDE_CAPTURE_CYCLE: AtomicU64 = AtomicU64::new(0);
static AGENT_ACCOUNTS_REGISTRY_ACTIVITY_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static AGENT_ACCOUNTS_PROFILE_LOGIN_MARKERS: OnceLock<
    StdMutex<HashMap<PathBuf, AgentAccountsProfileLoginMarker>>,
> = OnceLock::new();
static AGENT_ACCOUNTS_LOGIN_TRANSACTIONS: OnceLock<StdMutex<AgentAccountsLoginTransactions>> =
    OnceLock::new();
static AGENT_ACCOUNTS_LOGIN_GENERATION: AtomicU64 = AtomicU64::new(0);
static AGENT_ACCOUNTS_LOGIN_PANES: OnceLock<
    StdMutex<HashMap<(String, u64, u64), AgentAccountsLoginPaneBinding>>,
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
struct AgentAccountsLoginTransactions {
    current: HashMap<(String, String), AgentAccountsLoginTransaction>,
    newest_selection: HashMap<String, (String, u64)>,
}

#[derive(Clone)]
struct AgentAccountsLoginTransaction {
    generation: u64,
    baseline: Option<AgentAccountsLoginCompletionBaseline>,
    exit_marker: Option<PathBuf>,
    bound_instance: Option<(String, u64)>,
}

fn agent_accounts_login_transactions() -> &'static StdMutex<AgentAccountsLoginTransactions> {
    AGENT_ACCOUNTS_LOGIN_TRANSACTIONS
        .get_or_init(|| StdMutex::new(AgentAccountsLoginTransactions::default()))
}

fn agent_accounts_login_transaction_begin(
    kind: &str,
    profile_id: &str,
    baseline: Option<AgentAccountsLoginCompletionBaseline>,
) -> u64 {
    let generation = AGENT_ACCOUNTS_LOGIN_GENERATION
        .fetch_add(1, Ordering::SeqCst)
        .wrapping_add(1);
    let mut transactions = agent_accounts_login_transactions()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    transactions
        .current
        .retain(|(current_kind, _), _| current_kind != kind);
    // A new selection supersedes every older terminal binding for the same
    // provider while the transaction CAS is held. This prevents the same
    // pane/instance from accumulating multiple generations that teardown
    // could otherwise select nondeterministically.
    if let Ok(mut panes) = AGENT_ACCOUNTS_LOGIN_PANES
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
    {
        panes.retain(|_, binding| binding.kind != kind);
    }
    transactions
        .current
        .insert(
            (kind.to_string(), profile_id.to_string()),
            AgentAccountsLoginTransaction {
                generation,
                baseline,
                exit_marker: None,
                bound_instance: None,
            },
        );
    transactions
        .newest_selection
        .insert(kind.to_string(), (profile_id.to_string(), generation));
    generation
}

fn agent_accounts_login_transaction_is_current(
    kind: &str,
    profile_id: &str,
    generation: u64,
) -> bool {
    let transactions = agent_accounts_login_transactions()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    transactions
        .current
        .get(&(kind.to_string(), profile_id.to_string()))
        .is_some_and(|transaction| transaction.generation == generation)
        && transactions.newest_selection.get(kind) == Some(&(profile_id.to_string(), generation))
}

fn agent_accounts_login_transaction_claim(kind: &str, profile_id: &str, generation: u64) -> bool {
    let mut transactions = agent_accounts_login_transactions()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let key = (kind.to_string(), profile_id.to_string());
    if !transactions
        .current
        .get(&key)
        .is_some_and(|transaction| transaction.generation == generation)
        || transactions.newest_selection.get(kind) != Some(&(profile_id.to_string(), generation))
    {
        return false;
    }
    transactions.current.remove(&key);
    transactions.newest_selection.remove(kind);
    true
}

fn agent_accounts_login_transaction_set_exit_marker(
    kind: &str,
    profile_id: &str,
    generation: u64,
    marker: PathBuf,
) -> bool {
    let mut transactions = agent_accounts_login_transactions()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if transactions.newest_selection.get(kind) != Some(&(profile_id.to_string(), generation)) {
        return false;
    }
    let Some(transaction) = transactions
        .current
        .get_mut(&(kind.to_string(), profile_id.to_string()))
    else {
        return false;
    };
    if transaction.generation != generation {
        return false;
    }
    transaction.exit_marker = Some(marker);
    true
}

fn agent_accounts_login_transaction_bind_terminal(
    kind: &'static str,
    profile_id: &str,
    generation: u64,
    pane_id: &str,
    instance_id: u64,
) -> Result<AgentAccountsLoginPaneBinding, String> {
    let mut transactions = agent_accounts_login_transactions()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if transactions.newest_selection.get(kind) != Some(&(profile_id.to_string(), generation)) {
        return Err("The provider login transaction is no longer current.".to_string());
    }
    let transaction = transactions
        .current
        .get_mut(&(kind.to_string(), profile_id.to_string()))
        .filter(|transaction| transaction.generation == generation)
        .ok_or_else(|| "The provider login transaction is no longer current.".to_string())?;
    let baseline = transaction
        .baseline
        .clone()
        .ok_or_else(|| "The provider login transaction has no completion baseline.".to_string())?;
    let exit_marker = transaction
        .exit_marker
        .clone()
        .ok_or_else(|| "The provider login transaction has no exit-status marker.".to_string())?;
    let binding_target = (pane_id.to_string(), instance_id);
    if transaction
        .bound_instance
        .as_ref()
        .is_some_and(|bound| bound != &binding_target)
    {
        return Err("The provider login transaction is already bound to another terminal instance."
            .to_string());
    }
    let binding = AgentAccountsLoginPaneBinding {
        kind,
        profile_id: profile_id.to_string(),
        generation,
        baseline,
        exit_marker,
    };
    // This insert and the transaction CAS share the transaction mutex. Two
    // binds cannot both displace one another after separately observing the
    // same generation.
    AGENT_ACCOUNTS_LOGIN_PANES
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Unable to bind the provider login terminal.".to_string())?
        .insert(
            (pane_id.to_string(), instance_id, generation),
            binding.clone(),
        );
    transaction.bound_instance = Some(binding_target);
    Ok(binding)
}

fn agent_accounts_login_transaction_invalidate(
    kind: &str,
    profile_id: Option<&str>,
    generation: Option<u64>,
) -> bool {
    let mut transactions = agent_accounts_login_transactions()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let mut changed = false;
    transactions
        .current
        .retain(|(current_kind, current_profile), transaction| {
            let matches = current_kind == kind
                && profile_id.map_or(true, |profile| profile == current_profile)
                && generation.map_or(true, |wanted| wanted == transaction.generation);
            changed |= matches;
            !matches
        });
    let remove_newest = transactions.newest_selection.get(kind).is_some_and(
        |(current_profile, current_generation)| {
            profile_id.map_or(true, |profile| profile == current_profile)
                && generation.map_or(true, |wanted| wanted == *current_generation)
        },
    );
    if remove_newest {
        transactions.newest_selection.remove(kind);
        changed = true;
    }
    changed
}

#[derive(Clone)]
struct AgentAccountsLoginPaneBinding {
    kind: &'static str,
    profile_id: String,
    generation: u64,
    baseline: AgentAccountsLoginCompletionBaseline,
    exit_marker: PathBuf,
}

fn agent_accounts_remove_login_bindings(kind: &str, profile_id: &str, generation: u64) {
    if let Ok(mut panes) = AGENT_ACCOUNTS_LOGIN_PANES
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
    {
        panes.retain(|_, binding| {
            binding.kind != kind
                || binding.profile_id != profile_id
                || binding.generation != generation
        });
    }
}

pub(crate) fn agent_accounts_login_terminal_process_exited(
    app: Option<&AppHandle>,
    pane_id: &str,
    instance_id: u64,
    exit_status: Option<i32>,
) {
    let transaction = AGENT_ACCOUNTS_LOGIN_PANES
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
        .ok()
        .and_then(|mut panes| {
            let key = panes
                .keys()
                .find(|(candidate_pane, candidate_instance, _)| {
                    candidate_pane == pane_id && *candidate_instance == instance_id
                })
                .cloned()?;
            panes.remove(&key)
        });
    if let Some(transaction) = transaction {
        // Managed login activation is gated by both the PTY's real exit code
        // and the atomically-published inner-command marker. A watcher and
        // teardown racing here still get only one marker claim and one CAS.
        let completed = exit_status == Some(0)
            && app.is_some_and(|app| {
                agent_accounts_consume_login_exit_marker(
                    transaction.kind,
                    &transaction.profile_id,
                    transaction.generation,
                    &transaction.exit_marker,
                    || {
                        agent_accounts_try_complete_profile_login(
                            app,
                            transaction.kind,
                            &transaction.profile_id,
                            &transaction.baseline,
                            transaction.generation,
                        )
                    },
                ) == Some(true)
            });
        if !completed {
            agent_accounts_login_transaction_invalidate(
                transaction.kind,
                Some(&transaction.profile_id),
                Some(transaction.generation),
            );
            let _ = fs::remove_file(&transaction.exit_marker);
        }
    }
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
    let _guard = AGENT_ACCOUNTS_PRIVATE_FILE_WRITE_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let _claude_state_guard =
        if path.file_name().and_then(|name| name.to_str()) == Some(".claude.json") {
            Some(acquire_claude_workspace_trust_lock(path)?)
        } else {
            None
        };
    agent_accounts_write_private_file_atomic_unlocked(path, bytes, description)
}

fn agent_accounts_write_private_file_atomic_unlocked(
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
    agent_accounts_cleanup_stale_private_file_temps(
        parent,
        file_name,
        Duration::from_secs(60 * 60),
    );
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

fn agent_accounts_cleanup_stale_private_file_temps(
    parent: &Path,
    file_name: &str,
    minimum_age: Duration,
) -> usize {
    const MAX_REMOVALS: usize = 32;
    let prefix = format!(".{file_name}.tmp-");
    let Ok(entries) = fs::read_dir(parent) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        if removed >= MAX_REMOVALS {
            break;
        }
        let candidate_name = entry.file_name();
        let Some(candidate_name) = candidate_name.to_str() else {
            continue;
        };
        if !candidate_name.starts_with(&prefix) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file()
            || metadata
                .modified()
                .ok()
                .and_then(|modified| modified.elapsed().ok())
                .is_none_or(|age| age < minimum_age)
        {
            continue;
        }
        if fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
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

fn agent_account_push_status_has_valid_completion_proof(
    event: &Value,
    push_id: &str,
    pending: &AgentAccountPushPending,
) -> bool {
    let Some(proof) = agent_account_push_status_text(
        event,
        &[
            "recipient_proof_b64",
            "recipientProofB64",
            "ack_proof_b64",
            "ackProofB64",
        ],
    ) else {
        return false;
    };
    let local_device = cloud_mcp_desktop_device_profile();
    let sender_device_id =
        cloud_mcp_payload_text(&local_device, &["device_id", "deviceId"]).unwrap_or_default();
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
        cloud_mcp_payload_text(event, &["event_kind", "eventKind", "kind"]).unwrap_or_default();
    if !matches!(
        event_kind.as_str(),
        "remote_command_ack" | "remote_command_result"
    ) {
        return false;
    }
    let command_kind = cloud_mcp_remote_command_field_text(event, &["command_kind", "commandKind"])
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

fn agent_accounts_jwt_claims(token: &str) -> Option<Value> {
    let payload = token.trim().split('.').nth(1)?;
    general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| general_purpose::URL_SAFE.decode(payload))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
}

fn agent_accounts_first_text_for_keys(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(object) => {
            for key in keys {
                if let Some(text) = object
                    .get(*key)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                {
                    return Some(text.to_string());
                }
            }
            object
                .values()
                .find_map(|child| agent_accounts_first_text_for_keys(child, keys))
        }
        Value::Array(values) => values
            .iter()
            .find_map(|child| agent_accounts_first_text_for_keys(child, keys)),
        _ => None,
    }
}

fn agent_accounts_jwt_identity_for_entry(entry: &Value) -> Option<String> {
    let object = entry.as_object()?;
    for key in [
        "id_token",
        "idToken",
        "access",
        "access_token",
        "accessToken",
    ] {
        let Some(token) = object.get(key).and_then(Value::as_str) else {
            continue;
        };
        let Some(claims) = agent_accounts_jwt_claims(token) else {
            continue;
        };
        if let Some(account_id) = agent_accounts_first_text_for_keys(
            &claims,
            &[
                "chatgpt_account_id",
                "chatgptAccountId",
                "account_id",
                "accountId",
                "workspace_id",
                "workspaceId",
                "organization_id",
                "organizationId",
            ],
        ) {
            return Some(format!("account:{account_id}"));
        }
        if let Some(subject) =
            agent_accounts_first_text_for_keys(&claims, &["sub", "user_id", "userId", "userid"])
        {
            return Some(format!("subject:{subject}"));
        }
    }
    None
}

/// OpenCode API-key identities intentionally retain the pre-iteration-1
/// format and selection order: prefer `opencode-go`, otherwise use the first
/// provider entry as stored in auth.json, and always prefix `opencode-go-`.
/// Existing registry rows therefore continue to dedupe after upgrade.
fn agent_accounts_opencode_api_key_identity(auth: &Value) -> Option<String> {
    let providers = auth.as_object()?;
    let key = providers
        .get("opencode-go")
        .and_then(|entry| entry.get("key"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .or_else(|| {
            providers.values().find_map(|entry| {
                entry
                    .get("key")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|key| !key.is_empty())
            })
        })?;
    Some(format!("opencode-go-{}", cloud_mcp_short_hash(key)))
}

fn agent_accounts_opencode_oauth_identity_from_auth(auth: &Value) -> Option<String> {
    let providers = auth.as_object()?;
    for (provider, entry) in providers {
        if entry.get("key").and_then(Value::as_str).is_some() {
            continue;
        }
        let account_id =
            agent_accounts_first_text_for_keys(entry, &["accountId", "account_id", "accountID"])
                .map(|value| format!("account:{value}"))
                .or_else(|| agent_accounts_jwt_identity_for_entry(entry));
        if let Some(account_id) = account_id {
            return Some(format!(
                "opencode-oauth-{provider}-{}",
                cloud_mcp_short_hash(&account_id)
            ));
        }
    }
    None
}

pub(crate) fn agent_accounts_opencode_identity_from_auth(auth: &Value) -> String {
    agent_accounts_opencode_api_key_identity(auth)
        .or_else(|| agent_accounts_opencode_oauth_identity_from_auth(auth))
        .unwrap_or_default()
}

const AGENT_ACCOUNTS_OPENCODE_IDENTITY_FILE: &str = ".diffforge-account-identity.json";

fn agent_accounts_persisted_opencode_identity(path: &Path) -> Option<String> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|value| {
            value
                .get("identity_id")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn agent_accounts_opencode_identity_lock(path: &Path) -> Result<fs::File, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Unable to resolve the OpenCode identity directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Unable to create the OpenCode identity directory: {error}"))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(AGENT_ACCOUNTS_OPENCODE_IDENTITY_FILE);
    let lock_path = parent.join(format!(".{name}.lock"));
    let file = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(lock_path)
        .map_err(|error| format!("Unable to open the OpenCode identity lock: {error}"))?;

    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd as _;
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err(format!(
                "Unable to lock the OpenCode identity: {}",
                std::io::Error::last_os_error()
            ));
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle as _;
        use windows_sys::Win32::Storage::FileSystem::{LockFileEx, LOCKFILE_EXCLUSIVE_LOCK};
        use windows_sys::Win32::System::IO::OVERLAPPED;

        let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
        if unsafe {
            LockFileEx(
                file.as_raw_handle(),
                LOCKFILE_EXCLUSIVE_LOCK,
                0,
                u32::MAX,
                u32::MAX,
                &mut overlapped,
            )
        } == 0
        {
            return Err(format!(
                "Unable to lock the OpenCode identity: {}",
                std::io::Error::last_os_error()
            ));
        }
    }
    Ok(file)
}

fn agent_accounts_opencode_oauth_provider(auth: &Value) -> Option<String> {
    auth.as_object()?.iter().find_map(|(provider, entry)| {
        let has_oauth = [
            "access",
            "access_token",
            "accessToken",
            "refresh",
            "refresh_token",
            "refreshToken",
        ]
        .iter()
        .any(|key| {
            entry
                .get(*key)
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
        });
        has_oauth.then(|| provider.clone())
    })
}

fn agent_accounts_opencode_identity_with_first_seen(auth: &Value, home: &Path) -> String {
    let api_key_identity = agent_accounts_opencode_api_key_identity(auth);
    let oauth_provider = agent_accounts_opencode_oauth_provider(auth);
    if api_key_identity.is_none() && oauth_provider.is_none() {
        // A sidecar pins identity; it is not evidence that current
        // credentials are usable. Logout/empty auth must remain fail-closed.
        return String::new();
    }
    let path = home.join(AGENT_ACCOUNTS_OPENCODE_IDENTITY_FILE);
    // The first observed OAuth identity is immutable for this profile. A
    // token that later gains accountId/JWT claims must not fork tokenomics or
    // capture a second profile.
    let _guard = AGENT_ACCOUNTS_PRIVATE_FILE_WRITE_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let Ok(_cross_process_guard) = agent_accounts_opencode_identity_lock(&path) else {
        return String::new();
    };
    if let Some(identity) = agent_accounts_persisted_opencode_identity(&path) {
        return identity;
    }
    // Existing sidecars win even if a later credential set gains an API-key
    // entry. Profiles that have always been API-key-only retain the legacy
    // deterministic identity and do not create a sidecar.
    if oauth_provider.is_none() {
        return api_key_identity.unwrap_or_default();
    }
    let Some(provider) = oauth_provider else {
        return String::new();
    };
    let direct = agent_accounts_opencode_oauth_identity_from_auth(auth).unwrap_or_default();
    let identity = if direct.is_empty() {
        format!(
            "opencode-oauth-{provider}-first-seen-{}",
            uuid::Uuid::new_v4()
        )
    } else {
        direct
    };
    let bytes = serde_json::to_vec_pretty(&json!({
        "version": 1,
        "provider": provider,
        "identity_id": identity,
        "created_at_ms": todo_dispatch_now_ms(),
    }))
    .unwrap_or_default();
    if !bytes.is_empty()
        && agent_accounts_write_private_file_atomic_unlocked(
            &path,
            &bytes,
            "OpenCode first-seen account identity",
        )
        .is_ok()
    {
        return identity;
    }
    String::new()
}

fn agent_accounts_persist_opencode_identity(home: &Path, identity: &str) -> bool {
    let identity = identity.trim();
    if identity.is_empty() {
        return false;
    }
    let path = home.join(AGENT_ACCOUNTS_OPENCODE_IDENTITY_FILE);
    let _guard = AGENT_ACCOUNTS_PRIVATE_FILE_WRITE_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let Ok(_cross_process_guard) = agent_accounts_opencode_identity_lock(&path) else {
        return false;
    };
    // Never overwrite a first-seen value, even if a later credential gains a
    // stronger-looking claim. Explicit migration would need to update the
    // registry row atomically; ordinary refresh is not such a migration.
    if agent_accounts_persisted_opencode_identity(&path).is_some() {
        return false;
    }
    serde_json::to_vec_pretty(&json!({
        "version": 1,
        "identity_id": identity,
        "created_at_ms": todo_dispatch_now_ms(),
    }))
    .ok()
    .is_some_and(|bytes| {
        agent_accounts_write_private_file_atomic_unlocked(
            &path,
            &bytes,
            "OpenCode persisted account identity",
        )
        .is_ok()
    })
}

/// Canonical OpenCode data home (where auth.json + opencode.db live). Prefers an
/// existing candidate, else the first by OpenCode's own resolution order.
fn agent_accounts_opencode_default_home() -> Option<PathBuf> {
    let candidates = opencode_native_data_home();
    candidates
        .iter()
        .find(|path| path.exists())
        .cloned()
        .or_else(|| candidates.into_iter().next())
}

static AGENT_ACCOUNTS_REGISTRY_LAST_GOOD: OnceLock<StdMutex<Option<Value>>> = OnceLock::new();

fn agent_accounts_registry_last_good_cell() -> &'static StdMutex<Option<Value>> {
    AGENT_ACCOUNTS_REGISTRY_LAST_GOOD.get_or_init(|| StdMutex::new(None))
}

fn agent_accounts_registry_remember_last_good(registry: &Value) {
    let mut guard = agent_accounts_registry_last_good_cell()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    *guard = Some(registry.clone());
}

fn agent_accounts_registry_last_good_or_empty() -> Value {
    agent_accounts_registry_last_good_cell()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone()
        .unwrap_or_else(|| json!({ "agents": {} }))
}

fn agent_accounts_registry_parse(raw: &str) -> Option<Value> {
    serde_json::from_str::<Value>(raw)
        .ok()
        .map(|value| agent_accounts_registry_map_keys(value, true))
        // A structurally invalid registry (no object-valued `agents`) must
        // not become "last known good" — it would collapse the roster just
        // like the torn writes this cache exists to survive.
        .filter(|value| value.get("agents").map(Value::is_object).unwrap_or(false))
}

fn agent_accounts_registry_read() -> Value {
    let Some(path) = agent_accounts_file_path() else {
        return json!({ "agents": {} });
    };
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // A missing file IS an authoritative empty registry (fresh
            // install / explicit wipe). Remember it so a later transient
            // failure cannot resurrect pre-wipe accounts.
            let empty = json!({ "agents": {} });
            agent_accounts_registry_remember_last_good(&empty);
            return empty;
        }
        // Transient I/O failure must never become an authoritative empty
        // account set: downstream views treat absent profiles as removed.
        Err(_) => return agent_accounts_registry_last_good_or_empty(),
    };
    match agent_accounts_registry_parse(&raw) {
        Some(registry) => {
            agent_accounts_registry_remember_last_good(&registry);
            registry
        }
        // Same for a torn/partial write: serve the last-known-good registry
        // until a readable one lands.
        None => agent_accounts_registry_last_good_or_empty(),
    }
}

fn agent_accounts_registry_read_checked() -> Result<Value, String> {
    let path = agent_accounts_file_path()
        .ok_or_else(|| "Unable to resolve agent accounts registry path.".to_string())?;
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // Authoritative empty: refresh the fallback cache too, so a later
            // transient failure cannot resurrect pre-reset accounts.
            let empty = json!({ "agents": {} });
            agent_accounts_registry_remember_last_good(&empty);
            return Ok(empty);
        }
        Err(error) => return Err(format!("Unable to read agent accounts registry: {error}")),
    };
    let registry = serde_json::from_str::<Value>(&raw)
        .map(|value| agent_accounts_registry_map_keys(value, true))
        .map_err(|_| "Agent accounts registry is not valid JSON.".to_string())?;
    if !registry.is_object() {
        return Err("Agent accounts registry root is not an object.".to_string());
    }
    if registry
        .get("agents")
        .map(Value::is_object)
        .unwrap_or(false)
    {
        agent_accounts_registry_remember_last_good(&registry);
    }
    Ok(registry)
}

fn agent_accounts_registry_write(registry: &Value) -> Result<(), String> {
    let path = agent_accounts_file_path()
        .ok_or_else(|| "Unable to resolve agent accounts registry path.".to_string())?;
    let persisted = agent_accounts_registry_map_keys(registry.clone(), false);
    let bytes = serde_json::to_vec_pretty(&persisted)
        .map_err(|error| format!("Unable to encode agent accounts registry: {error}"))?;
    // Hold the cache lock across disk commit + cache refresh so two in-process
    // writers cannot leave the cache pointing at the older revision. (Cross-
    // process writers — GUI + daemon — still race on the file itself; that
    // exposure predates the cache and needs an OS-level lock to close.)
    let mut guard = agent_accounts_registry_last_good_cell()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    agent_accounts_write_private_file_atomic(&path, &bytes, "agent accounts registry")?;
    *guard = Some(registry.clone());
    Ok(())
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
    let home = user_home_dir()?;
    Some(match kind {
        "claude" => home.join(".claude"),
        "opencode" => {
            return agent_accounts_opencode_default_home();
        }
        _ => home.join(".codex"),
    })
}

/// Saved OpenCode profile dirs are XDG roots. OpenCode appends `opencode`
/// itself, so the authoritative credential file is
/// `<profile>/opencode/auth.json`. Iteration-0 profiles stored auth.json at
/// the profile root; migrate that file once without deleting the source so a
/// crash during upgrade cannot strand the account.
fn agent_accounts_profile_auth_path(kind: &str, profile_dir: &Path) -> PathBuf {
    if kind == "opencode" {
        profile_dir.join("opencode").join("auth.json")
    } else {
        profile_dir.join(agent_accounts_auth_file_name(kind))
    }
}

fn agent_accounts_migrate_opencode_profile_layout(profile_dir: &Path) -> Result<bool, String> {
    let legacy = profile_dir.join("auth.json");
    let destination = agent_accounts_profile_auth_path("opencode", profile_dir);
    if destination.is_file() || !legacy.is_file() {
        return Ok(false);
    }
    let bytes = fs::read(&legacy).map_err(|error| {
        format!(
            "Unable to read legacy OpenCode profile credentials {}: {error}",
            legacy.display()
        )
    })?;
    agent_accounts_write_private_file_atomic(
        &destination,
        &bytes,
        "migrated OpenCode profile credentials",
    )?;
    Ok(true)
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
                None => match user_home_dir() {
                    Some(home) => home.join(".claude.json"),
                    None => return json!({ "email": "", "auth_ready": false }),
                },
            };
            let state = agent_accounts_read_json_stable_with_retry(&state_path);
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
            if let Some(dir) = dir {
                let _ = agent_accounts_migrate_opencode_profile_layout(dir);
            }
            let auth_path = match dir {
                Some(dir) => agent_accounts_profile_auth_path("opencode", dir),
                None => match agent_accounts_default_home("opencode") {
                    Some(home) => home.join("auth.json"),
                    None => return json!({ "email": "", "auth_ready": false }),
                },
            };
            let auth = agent_accounts_read_json_stable_with_retry(&auth_path);
            // The synthetic "email" is a stable key fingerprint, which the
            // dedupe/capture machinery treats as the account identity.
            let identity_home = dir
                .map(Path::to_path_buf)
                .or_else(|| agent_accounts_default_home("opencode"));
            let identity = auth
                .as_ref()
                .zip(identity_home.as_deref())
                .map(|(auth, home)| agent_accounts_opencode_identity_with_first_seen(auth, home))
                .unwrap_or_default();
            let auth_ready = !identity.is_empty();
            json!({
                "email": identity,
                "stable_identity": identity,
                "auth_ready": auth_ready,
            })
        }
        _ => {
            let auth_path = match dir {
                Some(dir) => dir.join("auth.json"),
                None => match agent_accounts_default_home("codex") {
                    Some(home) => home.join("auth.json"),
                    None => return json!({ "email": "", "auth_ready": false }),
                },
            };
            let auth = agent_accounts_read_json_stable_with_retry(&auth_path);
            let email = auth
                .as_ref()
                .map(agent_accounts_codex_email_from_auth)
                .unwrap_or_default();
            let stable_identity = auth
                .as_ref()
                .map(agent_accounts_codex_stable_identity_from_auth)
                .unwrap_or_default();
            json!({
                "email": email,
                "stable_identity": stable_identity,
                "account_id": stable_identity,
                "auth_ready": auth.is_some() && !stable_identity.is_empty(),
            })
        }
    }
}

pub(crate) fn agent_accounts_codex_stable_identity_from_auth(auth: &Value) -> String {
    if let Some(account_id) = agent_accounts_first_text_for_keys(
        auth.get("tokens").unwrap_or(auth),
        &[
            "chatgpt_account_id",
            "chatgptAccountId",
            "account_id",
            "accountId",
            "workspace_id",
            "workspaceId",
            "organization_id",
            "organizationId",
        ],
    ) {
        return format!("codex-account:{account_id}");
    }

    for token_path in [
        "/tokens/id_token",
        "/tokens/access_token",
        "/id_token",
        "/access_token",
    ] {
        let Some(token) = auth.pointer(token_path).and_then(Value::as_str) else {
            continue;
        };
        let Some(claims) = agent_accounts_jwt_claims(token) else {
            continue;
        };
        if let Some(account_id) = agent_accounts_first_text_for_keys(
            &claims,
            &[
                "chatgpt_account_id",
                "chatgptAccountId",
                "account_id",
                "accountId",
                "workspace_id",
                "workspaceId",
                "organization_id",
                "organizationId",
            ],
        ) {
            return format!("codex-account:{account_id}");
        }
        // A JWT subject identifies a person, not the selected ChatGPT
        // workspace. Never accept it (or display email) as switch identity.
        // JWT-backed profiles must expose an immutable account/workspace/org
        // claim; API-key-only profiles use the key fingerprint below.
    }

    let api_key = auth
        .get("OPENAI_API_KEY")
        .or_else(|| auth.get("api_key"))
        .or_else(|| auth.pointer("/tokens/api_key"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    api_key
        .map(|key| format!("codex-api-key:{}", cloud_mcp_short_hash(key)))
        .unwrap_or_default()
}

/// Codex `auth.json` carries account email inside the OIDC id token. Email is
/// display metadata only; activation and dedupe use the immutable identity
/// returned by `agent_accounts_codex_stable_identity_from_auth`.
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
    agent_accounts_jwt_claims(id_token)
        .and_then(|claims| {
            claims
                .get("email")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default()
}

fn agent_accounts_login_command_for_shell(kind: &str, dir: &str, powershell: bool) -> String {
    if powershell {
        let dir = format!("'{}'", dir.replace('\'', "''"));
        return match kind {
            "claude" => format!("$env:CLAUDE_CONFIG_DIR = {dir}; claude auth login"),
            "opencode" => format!("$env:XDG_DATA_HOME = {dir}; opencode auth login"),
            _ => format!("$env:CODEX_HOME = {dir}; codex login --device-auth"),
        };
    }
    let dir = agent_accounts_shell_quote(dir);
    match kind {
        "claude" => format!("CLAUDE_CONFIG_DIR={dir} claude auth login"),
        "opencode" => format!("XDG_DATA_HOME={dir} opencode auth login"),
        _ => format!("CODEX_HOME={dir} codex login --device-auth"),
    }
}

fn agent_accounts_login_command(kind: &str, dir: &str) -> String {
    agent_accounts_login_command_for_shell(kind, dir, cfg!(windows))
}

fn agent_accounts_login_exit_marker_path(
    kind: &str,
    profile_id: &str,
    generation: u64,
) -> PathBuf {
    env::temp_dir().join(format!(
        "diffforge-login-exit-{}-{}-{generation}-{}",
        kind,
        cloud_mcp_short_hash(profile_id),
        uuid::Uuid::new_v4()
    ))
}

fn agent_accounts_managed_login_command_with_exit_marker(
    command: &str,
    marker: &Path,
    powershell: bool,
) -> String {
    let marker_temp = marker.with_extension(format!(
        "pending-{}",
        uuid::Uuid::new_v4().simple()
    ));
    if powershell {
        let marker = format!("'{}'", marker.to_string_lossy().replace('\'', "''"));
        let marker_temp = format!(
            "'{}'",
            marker_temp.to_string_lossy().replace('\'', "''")
        );
        return format!(
            "& {{ {command} }}; $diffforgeSucceeded = $?; $diffforgeStatus = if ($null -ne $LASTEXITCODE) {{ [int]$LASTEXITCODE }} elseif ($diffforgeSucceeded) {{ 0 }} else {{ 1 }}; Set-Content -LiteralPath {marker_temp} -Value $diffforgeStatus -NoNewline; Move-Item -Force -LiteralPath {marker_temp} -Destination {marker}; exit $diffforgeStatus"
        );
    }
    let marker = agent_accounts_shell_quote(&marker.to_string_lossy());
    let marker_temp = agent_accounts_shell_quote(&marker_temp.to_string_lossy());
    format!(
        "{{ {command}; diffforge_status=$?; printf '%s\\n' \"$diffforge_status\" > {marker_temp} && mv -f -- {marker_temp} {marker}; exit \"$diffforge_status\"; }}"
    )
}

fn agent_accounts_shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
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
        "identity_id": profile.get("identity_id").and_then(Value::as_str).unwrap_or_default(),
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
    let identity = agent_accounts_profile_identity(kind, None);
    agent_accounts_identity_key(kind, &identity)
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
    let default_email = agent_accounts_identity_key(kind, &default_identity);
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
    let snapshot = agent_accounts_read_stable_file(path)?;
    Some(agent_accounts_file_snapshot_signature(&snapshot))
}

fn agent_accounts_file_snapshot_signature(snapshot: &AgentAccountsFileSnapshot) -> String {
    let modified_ms = snapshot
        .modified
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    let digest = cloud_mcp_short_hash(&String::from_utf8_lossy(&snapshot.bytes));
    format!("{modified_ms}:{}:{digest}", snapshot.len)
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
        .map(|dir| agent_accounts_profile_auth_path(kind, &dir))
}

fn agent_accounts_auth_signature_for_profile(
    kind: &str,
    profile_id: &str,
    profile: Option<&Value>,
) -> Option<String> {
    agent_accounts_auth_file_path(kind, profile_id, profile)
        .and_then(|path| agent_accounts_auth_file_signature(&path))
}

fn agent_accounts_auth_revision_for_profile(
    kind: &str,
    profile_id: &str,
    profile: Option<&Value>,
) -> String {
    let auth_signature =
        agent_accounts_auth_signature_for_profile(kind, profile_id, profile).unwrap_or_default();
    let provider_state_signature = if kind == "claude" {
        let state_path = if profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
            user_home_dir().map(|home| home.join(".claude.json"))
        } else {
            profile
                .and_then(agent_accounts_profile_dir)
                .map(|dir| dir.join(".claude.json"))
        };
        state_path
            .as_deref()
            .and_then(agent_accounts_auth_file_signature)
            .unwrap_or_default()
    } else {
        String::new()
    };
    if auth_signature.is_empty() && provider_state_signature.is_empty() {
        return String::new();
    }
    cloud_mcp_short_hash(&format!(
        "{kind}:{profile_id}:{auth_signature}:{provider_state_signature}"
    ))
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
        "auth_revision": agent_accounts_auth_revision_for_profile(kind, profile_id, profile),
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
    // Mutations must never build on the last-known-good fallback: a stale
    // snapshot written back whole would erase registry state committed by
    // another writer. On a transient/torn read, serve the fallback for
    // display and skip the cleanup write.
    let mut registry = match agent_accounts_registry_read_checked() {
        Ok(registry) => registry,
        Err(_) => return agent_accounts_registry_read(),
    };
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
    let identity_key = agent_accounts_identity_key(kind, &identity);
    let auth_ready = identity
        .get("auth_ready")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if identity_key.is_empty() || !auth_ready {
        return None;
    }

    let _ = agent_accounts_capture_kind(kind);
    let registry = agent_accounts_registry_read();
    let (_, profiles) = agent_accounts_kind_entry(&registry, kind);
    profiles.into_iter().find_map(|profile| {
        if agent_accounts_profile_email(kind, &profile) != identity_key {
            return None;
        }
        agent_accounts_profile_dir(&profile)
            .filter(|path| agent_accounts_profile_auth_path(kind, path).is_file())
            .map(|_| profile)
    })
}

fn agent_accounts_default_profile_home_for_launch(kind: &'static str) -> Option<PathBuf> {
    agent_accounts_default_profile_for_launch(kind).and_then(|profile| {
        agent_accounts_profile_dir(&profile)
            .filter(|path| agent_accounts_profile_auth_path(kind, path).is_file())
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

fn agent_accounts_bind_opencode_env(env_vars: &mut Vec<(String, String)>, xdg_root: &Path) {
    env_vars.retain(|(key, _)| key != "OPENCODE_DATA_DIR" && key != "XDG_DATA_HOME");
    env_vars.push((
        "XDG_DATA_HOME".to_string(),
        xdg_root.to_string_lossy().to_string(),
    ));
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
    workspace_id: Option<&str>,
    workspace_label: Option<&str>,
    terminal_index: Option<u16>,
) {
    let Some(kind) = agent_accounts_supported_kind(provider_id) else {
        return;
    };
    // Migrate before computing the launch revision. Otherwise the first
    // post-upgrade OpenCode pane can be stamped with an empty legacy-path
    // revision and immediately appear stale after the migration below.
    if kind == "opencode" {
        if let Some(dir) = agent_accounts_active_profile_dir(kind) {
            let _ = agent_accounts_migrate_opencode_profile_layout(Path::new(&dir));
        }
    }
    let (active_id, active_label) = agent_accounts_launch_profile_label(kind);
    let auth_revision = agent_accounts_active_auth_revision(kind);
    let workspace_trust = if kind == "claude" {
        // Claude trust must wait until the actual interactive launch boundary:
        // only then are the final CLAUDE_CONFIG_DIR/HOME and canonical PTY cwd
        // known. In particular, this function also runs while preparing warm
        // shells, which must never pre-trust a directory on their own.
        Some(json!({
            "state": "pending",
            "source": "interactive_launch_preflight",
        }))
    } else {
        env_vars
            .iter()
            .find_map(|(key, value)| {
                matches!(
                    key.as_str(),
                    "COORDINATION_REPO_PATH" | "DIFFFORGE_WORKSPACE_ROOT"
                )
                .then_some(value.as_str())
            })
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|workspace_root| {
                // PTY output is intentionally never inspected to infer or resolve trust.
                agent_accounts_reconcile_workspace_trust_for(kind, Path::new(workspace_root))
                    .unwrap_or_else(|error| json!({ "state": "failed", "message": error, "source": "provider_native_state" }))
            })
    };
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
                    "auth_revision": auth_revision,
                    "workspace_id": workspace_id.unwrap_or_default(),
                    "workspace_label": workspace_label.unwrap_or_default(),
                    "terminal_index": terminal_index,
                    "workspace_trust_state": workspace_trust.as_ref().and_then(|value| value.get("state")).cloned().unwrap_or_else(|| json!("unknown")),
                    "workspace_trust_source": workspace_trust.as_ref().and_then(|value| value.get("source")).cloned().unwrap_or_else(|| json!("provider_native_state")),
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
            let dir = PathBuf::from(dir);
            let _ = agent_accounts_migrate_opencode_profile_layout(&dir);
            agent_accounts_bind_opencode_env(env_vars, &dir);
        }
        _ => {
            let Some(dir) = agent_accounts_codex_home_for_launch() else {
                return;
            };
            let dir = dir.to_string_lossy().to_string();
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

fn agent_accounts_identity_key(kind: &str, identity: &Value) -> String {
    let key = if matches!(kind, "codex" | "opencode") {
        identity
            .get("stable_identity")
            .or_else(|| identity.get("account_id"))
            .or_else(|| identity.get("email"))
    } else {
        identity.get("email")
    };
    key.and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default()
}

/// The stable identity a profile is pinned to. Claude retains its historical
/// email identity. Codex/OpenCode prefer the persisted immutable identity and
/// only fall back to legacy email rows while their auth file is migrated.
fn agent_accounts_profile_email(kind: &str, profile: &Value) -> String {
    if matches!(kind, "codex" | "opencode") {
        if let Some(stored) = profile
            .get("identity_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return agent_accounts_email_key(stored);
        }
        if let Some(dir) = profile
            .get("dir")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let identity = agent_accounts_profile_identity(kind, Some(Path::new(dir)));
            let stable = agent_accounts_identity_key(kind, &identity);
            if !stable.is_empty() {
                return stable;
            }
        }
    }
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
    let identity = agent_accounts_profile_identity(kind, Some(Path::new(dir)));
    agent_accounts_identity_key(kind, &identity)
}

pub(crate) fn agent_accounts_active_stable_identity(kind: &str) -> Option<String> {
    let registry = agent_accounts_registry_read_resolved();
    let (active_profile_id, profiles) = agent_accounts_kind_entry(&registry, kind);
    if active_profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        let identity = agent_accounts_profile_identity(kind, None);
        let key = agent_accounts_identity_key(kind, &identity);
        return (!key.is_empty()).then_some(key);
    }
    profiles
        .iter()
        .find(|profile| agent_accounts_profile_id(profile).as_deref() == Some(&active_profile_id))
        .map(|profile| agent_accounts_profile_email(kind, profile))
        .filter(|identity| !identity.is_empty())
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
    agent_accounts_source_is_newer(source, destination) && fs::copy(source, destination).is_ok()
}

#[derive(Clone)]
struct AgentAccountsFileSnapshot {
    bytes: Vec<u8>,
    modified: Option<std::time::SystemTime>,
    len: u64,
    file_id: String,
    revision_id: String,
}

#[cfg(unix)]
fn agent_accounts_metadata_file_id(metadata: &fs::Metadata) -> String {
    use std::os::unix::fs::MetadataExt as _;
    format!("{}:{}", metadata.dev(), metadata.ino())
}

#[cfg(windows)]
fn agent_accounts_metadata_file_id(metadata: &fs::Metadata) -> String {
    use std::os::windows::fs::MetadataExt as _;
    // volume_serial_number()/file_index() need the nightly windows_by_handle
    // feature. creation_time travels with the underlying file object, so a
    // swapped-in replacement between metadata samples still changes the id
    // (the callers' len/mtime guards catch in-place rewrites).
    format!(
        "{}:{}",
        metadata.creation_time(),
        metadata.file_attributes()
    )
}

#[cfg(not(any(unix, windows)))]
fn agent_accounts_metadata_file_id(_metadata: &fs::Metadata) -> String {
    String::new()
}

#[cfg(unix)]
fn agent_accounts_metadata_revision_id(metadata: &fs::Metadata) -> String {
    use std::os::unix::fs::MetadataExt as _;
    format!(
        "{}:{}:{}:{}",
        metadata.mtime(),
        metadata.mtime_nsec(),
        metadata.ctime(),
        metadata.ctime_nsec()
    )
}

#[cfg(windows)]
fn agent_accounts_metadata_revision_id(metadata: &fs::Metadata) -> String {
    use std::os::windows::fs::MetadataExt as _;
    format!("{}:{}", metadata.last_write_time(), metadata.file_size())
}

#[cfg(not(any(unix, windows)))]
fn agent_accounts_metadata_revision_id(metadata: &fs::Metadata) -> String {
    format!("{:?}:{}", metadata.modified().ok(), metadata.len())
}

fn agent_accounts_metadata_matches_snapshot(
    metadata: &fs::Metadata,
    snapshot: &AgentAccountsFileSnapshot,
) -> bool {
    metadata.len() == snapshot.len
        && metadata.modified().ok() == snapshot.modified
        && agent_accounts_metadata_file_id(metadata) == snapshot.file_id
        && agent_accounts_metadata_revision_id(metadata) == snapshot.revision_id
}

fn agent_accounts_read_stable_file(path: &Path) -> Option<AgentAccountsFileSnapshot> {
    let mut file = fs::File::open(path).ok()?;
    let before = file.metadata().ok()?;
    let mut bytes = Vec::with_capacity(before.len().min(1024 * 1024) as usize);
    file.read_to_end(&mut bytes).ok()?;
    let after = file.metadata().ok()?;
    let path_after = path.metadata().ok()?;
    let before_modified = before.modified().ok();
    let after_modified = after.modified().ok();
    if before.len() != after.len()
        || before_modified != after_modified
        || after.len() != bytes.len() as u64
        || agent_accounts_metadata_file_id(&before) != agent_accounts_metadata_file_id(&after)
        || agent_accounts_metadata_file_id(&after) != agent_accounts_metadata_file_id(&path_after)
        || agent_accounts_metadata_revision_id(&before)
            != agent_accounts_metadata_revision_id(&after)
        || agent_accounts_metadata_revision_id(&after)
            != agent_accounts_metadata_revision_id(&path_after)
        || path_after.len() != after.len()
        || path_after.modified().ok() != after_modified
    {
        return None;
    }
    Some(AgentAccountsFileSnapshot {
        bytes,
        modified: after_modified,
        len: after.len(),
        file_id: agent_accounts_metadata_file_id(&after),
        revision_id: agent_accounts_metadata_revision_id(&after),
    })
}

#[derive(Clone)]
struct AgentAccountsJsonSnapshot {
    file: AgentAccountsFileSnapshot,
    json: Value,
}

fn agent_accounts_read_json_snapshot_with_retry(path: &Path) -> Option<AgentAccountsJsonSnapshot> {
    const ATTEMPTS: usize = 6;
    const RETRY_MS: u64 = 100;
    for attempt in 0..ATTEMPTS {
        match path.metadata() {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
            _ => {}
        }
        if let Some(file) = agent_accounts_read_stable_file(path) {
            if let Ok(json) = serde_json::from_slice::<Value>(&file.bytes) {
                return Some(AgentAccountsJsonSnapshot { file, json });
            }
        }
        if attempt + 1 < ATTEMPTS {
            thread::sleep(Duration::from_millis(RETRY_MS));
        }
    }
    None
}

/// Login CLIs replace auth files atomically on Unix and can expose a brief
/// sharing violation or partial write on Windows. Require one stable,
/// parseable snapshot, retrying for a bounded 500ms window.
fn agent_accounts_read_json_stable_with_retry(path: &Path) -> Option<Value> {
    agent_accounts_read_json_snapshot_with_retry(path).map(|snapshot| snapshot.json)
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
    let path = user_home_dir()?.join(".claude.json");
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
        (Some(credentials_modified), Some(state_modified)) => credentials_modified > state_modified,
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
    let validated_auth = if matches!(kind, "codex" | "opencode") {
        agent_accounts_default_home(kind)
            .and_then(|home| agent_accounts_read_json_snapshot_with_retry(&home.join("auth.json")))
    } else {
        None
    };
    agent_accounts_snapshot_refresh_in_cycle_with_auth(
        kind,
        dir,
        expected_email,
        false,
        agent_accounts_next_claude_capture_cycle(),
        validated_auth.as_ref(),
    )
}

fn agent_accounts_snapshot_refresh_in_cycle(
    kind: &str,
    dir: &Path,
    expected_email: &str,
    force_credentials: bool,
    capture_cycle: u64,
) -> bool {
    let validated_auth = if matches!(kind, "codex" | "opencode") {
        agent_accounts_default_home(kind)
            .and_then(|home| agent_accounts_read_json_snapshot_with_retry(&home.join("auth.json")))
    } else {
        None
    };
    agent_accounts_snapshot_refresh_in_cycle_with_auth(
        kind,
        dir,
        expected_email,
        force_credentials,
        capture_cycle,
        validated_auth.as_ref(),
    )
}

fn agent_accounts_validated_auth_identity(
    kind: &str,
    source_home: &Path,
    snapshot: &AgentAccountsJsonSnapshot,
) -> String {
    match kind {
        "opencode" => agent_accounts_opencode_identity_with_first_seen(&snapshot.json, source_home),
        "codex" => agent_accounts_codex_stable_identity_from_auth(&snapshot.json),
        _ => String::new(),
    }
}

fn agent_accounts_install_validated_auth_snapshot(
    kind: &str,
    source: &Path,
    destination: &Path,
    expected_identity: &str,
    snapshot: &AgentAccountsJsonSnapshot,
) -> Option<bool> {
    let expected_identity = agent_accounts_email_key(expected_identity);
    let source_home = source.parent().unwrap_or(source);
    let validated_identity = agent_accounts_email_key(&agent_accounts_validated_auth_identity(
        kind,
        source_home,
        snapshot,
    ));
    if expected_identity.is_empty() || validated_identity != expected_identity {
        return None;
    }
    // Final revision check is metadata/file-id only: the credential bytes are
    // never read a second time. If auth.json was replaced or rewritten after
    // validation, defer to the next capture instead of committing stale or
    // mismatched bytes.
    let Ok(metadata) = source.metadata() else {
        return None;
    };
    if !agent_accounts_metadata_matches_snapshot(&metadata, &snapshot.file) {
        return None;
    }
    let unchanged = fs::read(destination)
        .ok()
        .is_some_and(|current| current == snapshot.file.bytes);
    if unchanged {
        return Some(false);
    }
    agent_accounts_write_private_file_atomic(
        destination,
        &snapshot.file.bytes,
        "captured validated credentials",
    )
    .ok()
    .map(|_| true)
}

fn agent_accounts_snapshot_refresh_in_cycle_with_auth(
    kind: &str,
    dir: &Path,
    expected_email: &str,
    force_credentials: bool,
    capture_cycle: u64,
    validated_auth: Option<&AgentAccountsJsonSnapshot>,
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
                || agent_accounts_source_is_newer(&credentials_source, &credentials_destination))
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
                changed |=
                    fs::copy(default_home.join("settings.json"), &settings_destination).is_ok();
            }
            changed
        }
        "opencode" => {
            let Some(validated_auth) = validated_auth else {
                return false;
            };
            let data_dir = dir.join("opencode");
            if fs::create_dir_all(&data_dir).is_err() {
                return false;
            }
            let Some(mut changed) = agent_accounts_install_validated_auth_snapshot(
                kind,
                &default_home.join("auth.json"),
                &data_dir.join("auth.json"),
                &expected_email,
                validated_auth,
            ) else {
                return false;
            };
            for config_name in ["config.json", "opencode.json", "opencode.jsonc"] {
                let destination = data_dir.join(config_name);
                if !destination.exists() {
                    changed |= fs::copy(default_home.join(config_name), &destination).is_ok();
                }
            }
            changed
        }
        _ => {
            let Some(validated_auth) = validated_auth else {
                return false;
            };
            let Some(mut changed) = agent_accounts_install_validated_auth_snapshot(
                kind,
                &default_home.join("auth.json"),
                &dir.join("auth.json"),
                &expected_email,
                validated_auth,
            ) else {
                return false;
            };
            let config_destination = dir.join("config.toml");
            if !config_destination.exists() {
                changed |= fs::copy(default_home.join("config.toml"), &config_destination).is_ok();
            }
            if agent_accounts_ensure_codex_file_auth_store(dir).is_err() {
                return false;
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
    let removed =
        object.remove("oauthAccount").is_some() | object.remove("oauth_account").is_some();
    if !removed {
        return changed;
    }
    changed |= serde_json::to_vec_pretty(&state).ok().is_some_and(|bytes| {
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

fn agent_accounts_profile_state_modified(profile_dir: &Path) -> Option<std::time::SystemTime> {
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
                >= Duration::from_secs(AGENT_ACCOUNTS_PROFILE_LOGIN_CREDENTIAL_ONLY_CONFIRM_SECS)
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
            if agent_accounts_rebind_captured_claude_profile(registry, profile_id, &live_email) {
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
        ("claude", ".claude.json") => user_home_dir().map(|home| home.join(name)),
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
    profile_dir.map(|dir| {
        if kind == "opencode" && name == "auth.json" {
            agent_accounts_profile_auth_path(kind, dir)
        } else {
            dir.join(name)
        }
    })
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
    user_home_dir()
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
        Value::Array(items) => items.iter().find_map(|item| {
            agent_account_push_find_device_candidate(item, target_device_id, depth + 1)
        }),
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
        return Err(
            "Target device is not push-capable; it has not published an agent account push key."
                .to_string(),
        );
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
            ));
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
            let destination = if kind == "opencode" && file.name == "auth.json" {
                agent_accounts_profile_auth_path(kind, &temp_dir)
            } else {
                temp_dir.join(&file.name)
            };
            agent_accounts_write_private_file(&destination, &bytes).map_err(|_| {
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
    if let Err(error) = fs::File::open(&kind_root).and_then(|directory| directory.sync_all()) {
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

    let default_email = agent_accounts_profile_identity(kind, None)
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
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
    let validated_auth = if matches!(kind, "codex" | "opencode") {
        agent_accounts_default_home(kind)
            .and_then(|home| agent_accounts_read_json_snapshot_with_retry(&home.join("auth.json")))
    } else {
        None
    };
    let identity = match (kind, validated_auth.as_ref()) {
        ("codex", Some(snapshot)) => {
            let email = agent_accounts_codex_email_from_auth(&snapshot.json);
            let stable_identity = agent_accounts_codex_stable_identity_from_auth(&snapshot.json);
            json!({
                "email": email,
                "stable_identity": stable_identity,
                "account_id": stable_identity,
                "auth_ready": !stable_identity.is_empty(),
            })
        }
        ("opencode", Some(snapshot)) => {
            let stable_identity = agent_accounts_default_home("opencode")
                .map(|home| agent_accounts_opencode_identity_with_first_seen(&snapshot.json, &home))
                .unwrap_or_default();
            json!({
                "email": stable_identity,
                "stable_identity": stable_identity,
                "auth_ready": !stable_identity.is_empty(),
            })
        }
        ("codex" | "opencode", None) => json!({
            "email": "",
            "stable_identity": "",
            "auth_ready": false,
        }),
        _ => agent_accounts_profile_identity(kind, None),
    };
    let email = identity
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
    let stable_identity = agent_accounts_identity_key(kind, &identity);
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
    // Never reconcile-and-persist on top of the fallback snapshot: a stale
    // base written back whole would erase another writer's registry state.
    let Ok(mut registry) = agent_accounts_registry_read_checked() else {
        return false;
    };
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
    if stable_identity.is_empty() || !auth_ready {
        let registry_persisted = persist_registry(&registry, registry_changed);
        return snapshot_changed || registry_persisted;
    }
    let suppressed = agent_accounts_suppressed_emails(&registry, kind);
    if suppressed.iter().any(|entry| entry == &stable_identity) {
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
        .any(|profile| agent_accounts_profile_email(kind, profile) == stable_identity);
    if existing {
        if matches!(kind, "codex" | "opencode") {
            if let Some(profile) = registry["agents"][kind]["profiles"]
                .as_array_mut()
                .and_then(|profiles| {
                    profiles.iter_mut().find(|profile| {
                        agent_accounts_profile_email(kind, profile) == stable_identity
                    })
                })
            {
                if profile.get("identity_id").and_then(Value::as_str)
                    != Some(stable_identity.as_str())
                {
                    profile["identity_id"] = json!(stable_identity.clone());
                    registry_changed = true;
                }
                if kind == "codex"
                    && !email.is_empty()
                    && profile.get("email").and_then(Value::as_str) != Some(email.as_str())
                {
                    profile["email"] = json!(email.clone());
                    registry_changed = true;
                }
            }
        }
        // Same account still signed in: keep its snapshot's tokens fresh so
        // switching back later doesn't land on an expired refresh token. Walk
        // every matching captured profile: a manual/duplicate first in
        // registry order must not starve a deferred repair destination.
        let mut refresh_changed = false;
        for existing in profiles.iter().filter(|profile| {
            profile.get("source").and_then(Value::as_str) == Some("captured")
                && agent_accounts_profile_email(kind, profile) == stable_identity
        }) {
            if let Some(dir) = existing
                .get("dir")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                if kind == "claude" && agent_accounts_profile_login_marker(Path::new(dir)).is_some()
                {
                    continue;
                }
                if kind == "opencode" {
                    refresh_changed |=
                        agent_accounts_persist_opencode_identity(Path::new(dir), &stable_identity);
                }
                let registered_email = existing
                    .get("email")
                    .and_then(Value::as_str)
                    .map(agent_accounts_email_key)
                    .filter(|email| !email.is_empty())
                    .and_then(|_| {
                        matches!(kind, "codex" | "opencode").then(|| stable_identity.clone())
                    })
                    .unwrap_or_else(|| stable_identity.clone());
                refresh_changed |= agent_accounts_snapshot_refresh_in_cycle_with_auth(
                    kind,
                    Path::new(dir),
                    &registered_email,
                    false,
                    capture_cycle,
                    validated_auth.as_ref(),
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
    let profile_id = agent_accounts_available_capture_profile_id(
        kind,
        &stable_identity,
        &profiles,
        &profile_root,
    );
    let dir = profile_root.join(kind).join(&profile_id);
    if fs::create_dir_all(&dir).is_err() {
        let registry_persisted = persist_registry(&registry, registry_changed);
        return snapshot_changed || registry_persisted;
    }
    if !agent_accounts_snapshot_refresh_in_cycle_with_auth(
        kind,
        &dir,
        &stable_identity,
        false,
        capture_cycle,
        validated_auth.as_ref(),
    ) {
        let _ = fs::remove_dir(&dir);
        let registry_persisted = persist_registry(&registry, registry_changed);
        return snapshot_changed || registry_persisted;
    }
    if kind == "opencode" {
        let _ = agent_accounts_persist_opencode_identity(&dir, &stable_identity);
    }
    agent_accounts_ensure_kind_entry(&mut registry, kind);
    let used_labels = profiles
        .iter()
        .filter_map(|profile| profile.get("label").and_then(Value::as_str))
        .map(agent_accounts_label_key)
        .filter(|label| !label.is_empty())
        .collect::<HashSet<_>>();
    let display_identity = if email.is_empty() {
        stable_identity.as_str()
    } else {
        email.as_str()
    };
    let label = agent_accounts_unique_capture_label(display_identity, &used_labels);
    let profile = json!({
        "id": profile_id,
        "label": label,
        "email": email,
        "identity_id": stable_identity,
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
    // See agent_accounts_capture_kind: mutations never build on the fallback.
    let Ok(mut registry) = agent_accounts_registry_read_checked() else {
        return false;
    };
    let mut registry_changed = false;
    for kind in ["claude", "codex", "opencode"] {
        registry_changed |= agent_accounts_dedupe_captured_profile_labels(&mut registry, kind);
    }
    let (_, opencode_profiles) = agent_accounts_kind_entry(&registry, "opencode");
    let mut opencode_profiles_migrated = false;
    for profile in &opencode_profiles {
        opencode_profiles_migrated |= agent_accounts_profile_dir(profile)
            .and_then(|dir| agent_accounts_migrate_opencode_profile_layout(&dir).ok())
            .unwrap_or(false);
    }
    let default_claude_email = agent_accounts_default_email("claude");
    let reconcile_result =
        agent_accounts_reconcile_captured_claude_identities(&mut registry, &default_claude_email);
    registry_changed |= reconcile_result.registry_changed;
    let registry_persisted = registry_changed && agent_accounts_registry_write(&registry).is_ok();
    if registry_persisted && reconcile_result.registry_changed {
        for dir in &reconcile_result.rebound_profile_dirs {
            agent_accounts_clear_profile_login_marker(dir);
        }
    }
    reconcile_result.profile_files_changed || opencode_profiles_migrated || registry_persisted
}

fn agent_accounts_nearest_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut candidate = path.to_path_buf();
    loop {
        if candidate.is_dir() {
            return Some(candidate);
        }
        if !candidate.pop() {
            return None;
        }
    }
}

fn agent_accounts_capture_watch_targets() -> Vec<(&'static str, PathBuf)> {
    let mut targets = ["claude", "codex", "opencode"]
        .into_iter()
        .filter_map(|kind| {
            agent_accounts_default_home(kind)
                .map(|path| (kind, path.join(agent_accounts_auth_file_name(kind))))
        })
        .collect::<Vec<_>>();
    if let Some(home) = user_home_dir() {
        targets.push(("claude-state", home.join(".claude.json")));
    }
    targets
}

fn agent_accounts_capture_watch_registration_plan(
    targets: &[(&'static str, PathBuf)],
    watched_paths: &HashMap<&'static str, PathBuf>,
) -> Vec<(&'static str, PathBuf)> {
    let mut registrations = Vec::new();
    for (provider, target) in targets {
        let Some(target_parent) = target.parent() else {
            continue;
        };
        let Some(registration) = agent_accounts_nearest_existing_ancestor(target_parent) else {
            continue;
        };
        if watched_paths.get(provider) != Some(&registration) {
            registrations.push((*provider, registration));
        }
    }
    registrations
}

fn agent_accounts_capture_event_is_relevant(
    event: &notify::Event,
    targets: &[(&'static str, PathBuf)],
) -> bool {
    event
        .paths
        .iter()
        .any(|event_path| targets.iter().any(|(_, target)| event_path == target))
}

fn agent_accounts_capture_promoted_target_exists(
    provider: &str,
    targets: &[(&'static str, PathBuf)],
) -> bool {
    targets
        .iter()
        .find(|(candidate, _)| *candidate == provider)
        .is_some_and(|(_, target)| target.is_file())
}

fn agent_accounts_log_capture_watcher_error(
    provider: &str,
    path: &Path,
    error: &dyn std::fmt::Display,
) {
    let path_label = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("home");
    log_terminal_status_event(
        "backend.agent_accounts.capture_watcher_error",
        json!({
            "provider": clean_terminal_diagnostic_log_text(provider),
            "path": clean_terminal_diagnostic_log_text(path_label),
            "error": clean_terminal_diagnostic_log_text(&error.to_string()),
        }),
    );
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
            let mut watcher = match notify::recommended_watcher(tx) {
                Ok(watcher) => Some(watcher),
                Err(error) => {
                    agent_accounts_log_capture_watcher_error(
                        "all",
                        Path::new("credential-homes"),
                        &error,
                    );
                    None
                }
            };
            let watch_targets = agent_accounts_capture_watch_targets();
            let mut watched_paths = HashMap::new();
            if let Some(watcher) = watcher.as_mut() {
                for (provider, path) in
                    agent_accounts_capture_watch_registration_plan(&watch_targets, &watched_paths)
                {
                    if watched_paths.values().any(|watched| watched == &path) {
                        watched_paths.insert(provider, path);
                        continue;
                    }
                    match notify::Watcher::watch(
                        watcher,
                        &path,
                        notify::RecursiveMode::NonRecursive,
                    ) {
                        Ok(()) => {
                            watched_paths.insert(provider, path);
                        }
                        Err(error) => {
                            agent_accounts_log_capture_watcher_error(provider, &path, &error);
                        }
                    }
                }
            }

            // Only credential files matter for capture. The watched CLI home
            // dirs (~/.claude, ~/.codex, opencode data home) also churn with
            // agent session/history writes many times a minute; re-running a
            // full identity/capture pass (which re-reads and re-parses large
            // state files) on every unrelated write produced ~15s CPU spikes
            // whenever any agent was active.
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
                        let mut promoted_existing_credential = false;
                        if let Some(watcher) = watcher.as_mut() {
                            // Directory creation events are topology signals,
                            // not credential events. Reconcile registrations
                            // before filtering so a newly created provider
                            // home becomes watched immediately.
                            for (provider, path) in agent_accounts_capture_watch_registration_plan(
                                &watch_targets,
                                &watched_paths,
                            ) {
                                let previous = watched_paths.get(provider).cloned();
                                let path_already_watched = watched_paths
                                    .iter()
                                    .any(|(other, watched)| *other != provider && watched == &path);
                                let registration = if path_already_watched {
                                    Ok(())
                                } else {
                                    notify::Watcher::watch(
                                        watcher,
                                        &path,
                                        notify::RecursiveMode::NonRecursive,
                                    )
                                };
                                match registration {
                                    Ok(()) => {
                                        let promoted = previous.as_ref() != Some(&path);
                                        watched_paths.insert(provider, path.clone());
                                        if let Some(previous) = previous.filter(|old| old != &path)
                                        {
                                            let still_used = watched_paths
                                                .iter()
                                                .any(|(_, watched)| watched == &previous);
                                            if !still_used {
                                                let _ =
                                                    notify::Watcher::unwatch(watcher, &previous);
                                            }
                                        }
                                        // The provider directory and auth file can be
                                        // created in the same filesystem burst. The
                                        // auth write then predates this promoted watch,
                                        // so schedule capture immediately rather than
                                        // waiting for the five-minute backstop.
                                        promoted_existing_credential |= promoted
                                            && agent_accounts_capture_promoted_target_exists(
                                                provider,
                                                &watch_targets,
                                            );
                                    }
                                    Err(error) => agent_accounts_log_capture_watcher_error(
                                        provider, &path, &error,
                                    ),
                                }
                            }
                        }
                        if let Err(error) = event.as_ref() {
                            agent_accounts_log_capture_watcher_error(
                                "event",
                                Path::new("credential-homes"),
                                error,
                            );
                        }
                        let relevant = promoted_existing_credential
                            || event
                                .as_ref()
                                .map(|event| {
                                    agent_accounts_capture_event_is_relevant(event, &watch_targets)
                                })
                                .unwrap_or(false);
                        if !relevant {
                            continue;
                        }
                        // Debounce credential bursts, but never drop a change
                        // inside the post-capture gap: carry it to the first
                        // allowed deadline instead.
                        let event_deadline =
                            std::time::Instant::now() + Duration::from_millis(EVENT_DEBOUNCE_MS);
                        let gap_deadline =
                            last_capture + Duration::from_secs(EVENT_CAPTURE_MIN_GAP_SECS);
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

pub(crate) fn agent_accounts_default_login_capture_baseline(kind: &str) -> String {
    agent_accounts_auth_revision_for_profile(kind, AGENT_ACCOUNTS_DEFAULT_PROFILE_ID, None)
}

pub(crate) fn agent_accounts_watch_default_login_capture_completion(
    app: AppHandle,
    kind: &'static str,
    baseline_revision: String,
) {
    let _ = thread::Builder::new()
        .name("agent-account-default-login".to_string())
        .spawn(move || {
            for _ in 0..(10 * 60) {
                let identity = agent_accounts_profile_identity(kind, None);
                let identity_ready = identity
                    .get("auth_ready")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                    && identity
                        .get("email")
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.trim().is_empty());
                let revision = agent_accounts_auth_revision_for_profile(
                    kind,
                    AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
                    None,
                );
                if identity_ready && !revision.is_empty() && revision != baseline_revision {
                    let captured = agent_accounts_capture_kind(kind);
                    let _ = app.emit(
                        AGENT_ACCOUNTS_CHANGED_EVENT,
                        json!({
                            "kind": kind,
                            "profile_id": AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
                            "auth_revision": revision,
                            "login_completed": true,
                            "captured": captured,
                        }),
                    );
                    break;
                }
                thread::sleep(Duration::from_secs(1));
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
) -> Option<Value> {
    if chunk.is_empty() {
        return None;
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
        return None;
    };
    // Account metadata and terminal turn state are deliberately separate. The
    // caller uses this structured result to fail the active turn immediately,
    // even when the same account issue was already recorded earlier.
    let _ = agent_accounts_mark_pane_auth_issue(app, pane_id, reason, message);
    Some(json!({
        "category": "auth",
        "provider_code": reason,
        "safe_message": message,
        "retryable": false,
    }))
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

    // Mutation base: never the fallback snapshot (see agent_accounts_capture_kind).
    let Ok(mut registry) = agent_accounts_registry_read_checked() else {
        return false;
    };
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

#[derive(Clone)]
struct AgentAccountsLoginCompletionBaseline {
    auth_signature: String,
    expected_identity: String,
}

fn agent_accounts_login_auth_path(kind: &str, dir: &Path, is_default: bool) -> PathBuf {
    if is_default {
        dir.join(agent_accounts_auth_file_name(kind))
    } else {
        agent_accounts_profile_auth_path(kind, dir)
    }
}

fn agent_accounts_login_completion_baseline(
    kind: &'static str,
    profile_id: &str,
) -> Result<Option<AgentAccountsLoginCompletionBaseline>, String> {
    if !matches!(kind, "codex" | "opencode") {
        return Ok(None);
    }
    let (dir, is_default) = agent_accounts_profile_login_target(kind, profile_id)?;
    let registry = agent_accounts_registry_read();
    let profile = (!is_default)
        .then(|| agent_accounts_profile_for_id(&registry, kind, profile_id))
        .flatten();
    let expected_identity = profile
        .as_ref()
        .and_then(|profile| profile.get("identity_id").or_else(|| profile.get("email")))
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .filter(|identity| !identity.is_empty())
        .unwrap_or_else(|| {
            let identity =
                agent_accounts_profile_identity(kind, if is_default { None } else { Some(&dir) });
            agent_accounts_identity_key(kind, &identity)
        });
    if expected_identity.is_empty() {
        return Err(format!(
            "Unable to identify the {kind} account selected for login."
        ));
    }
    Ok(Some(AgentAccountsLoginCompletionBaseline {
        auth_signature: agent_accounts_auth_file_signature(&agent_accounts_login_auth_path(
            kind, &dir, is_default,
        ))
        .unwrap_or_default(),
        expected_identity,
    }))
}

fn agent_accounts_codex_login_completion_matches(
    baseline: &AgentAccountsLoginCompletionBaseline,
    current_signature: &str,
    identity: &Value,
) -> bool {
    if current_signature.is_empty() || current_signature == baseline.auth_signature {
        return false;
    }
    let auth_ready = identity
        .get("auth_ready")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let current_identity = identity
        .get("stable_identity")
        .or_else(|| identity.get("account_id"))
        .or_else(|| identity.get("email"))
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
    auth_ready && current_identity == baseline.expected_identity
}

fn agent_accounts_activate_profile_in_registry(
    registry: &mut Value,
    kind: &str,
    profile_id: &str,
) -> Result<bool, String> {
    let (active_id, profiles) = agent_accounts_kind_entry(registry, kind);
    if profile_id != AGENT_ACCOUNTS_DEFAULT_PROFILE_ID
        && !profiles
            .iter()
            .any(|profile| agent_accounts_profile_id(profile).as_deref() == Some(profile_id))
    {
        return Err(format!("Unknown {kind} account profile: {profile_id}"));
    }
    agent_accounts_ensure_kind_entry(registry, kind);
    registry["agents"][kind]["active_profile_id"] = json!(profile_id);
    Ok(active_id != profile_id)
}

fn agent_accounts_login_transaction_commit_activation(
    registry: &mut Value,
    kind: &str,
    profile_id: &str,
    generation: u64,
) -> Result<bool, String> {
    // Keep the transaction lock across registry persistence. A later
    // selection therefore cannot begin after the CAS check but before the old
    // selection is written active.
    let mut transactions = agent_accounts_login_transactions()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let key = (kind.to_string(), profile_id.to_string());
    if !transactions
        .current
        .get(&key)
        .is_some_and(|transaction| transaction.generation == generation)
        || transactions.newest_selection.get(kind) != Some(&(profile_id.to_string(), generation))
    {
        return Ok(false);
    }
    agent_accounts_activate_profile_in_registry(registry, kind, profile_id)?;
    agent_accounts_registry_write(registry)?;
    transactions.current.remove(&key);
    transactions.newest_selection.remove(kind);
    Ok(true)
}

fn agent_accounts_login_identity_from_snapshot(
    kind: &'static str,
    home: &Path,
    snapshot: &AgentAccountsJsonSnapshot,
) -> Value {
    match kind {
        "opencode" => {
            let stable_identity =
                agent_accounts_opencode_identity_with_first_seen(&snapshot.json, home);
            json!({
                "email": stable_identity,
                "stable_identity": stable_identity,
                "auth_ready": !stable_identity.is_empty(),
            })
        }
        _ => {
            let email = agent_accounts_codex_email_from_auth(&snapshot.json);
            let stable_identity = agent_accounts_codex_stable_identity_from_auth(&snapshot.json);
            json!({
                "email": email,
                "stable_identity": stable_identity,
                "account_id": stable_identity,
                "auth_ready": !stable_identity.is_empty(),
            })
        }
    }
}

fn agent_accounts_try_complete_profile_login(
    app: &AppHandle,
    kind: &'static str,
    profile_id: &str,
    baseline: &AgentAccountsLoginCompletionBaseline,
    generation: u64,
) -> bool {
    if !agent_accounts_login_transaction_is_current(kind, profile_id, generation) {
        return false;
    }
    let Ok((profile_dir, is_default)) = agent_accounts_profile_login_target(kind, profile_id)
    else {
        return false;
    };
    let auth_path = agent_accounts_login_auth_path(kind, &profile_dir, is_default);
    let Some(snapshot) = agent_accounts_read_json_snapshot_with_retry(&auth_path) else {
        return false;
    };
    let identity = agent_accounts_login_identity_from_snapshot(kind, &profile_dir, &snapshot);
    let current_signature = agent_accounts_file_snapshot_signature(&snapshot.file);
    if !agent_accounts_codex_login_completion_matches(baseline, &current_signature, &identity) {
        return false;
    }

    let registry_guard = AGENT_ACCOUNTS_REGISTRY_ACTIVITY_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let Ok(mut registry) = agent_accounts_registry_read_checked() else {
        return false;
    };
    let committed = agent_accounts_login_transaction_commit_activation(
        &mut registry,
        kind,
        profile_id,
        generation,
    )
    .unwrap_or(false);
    if !committed {
        return false;
    }
    drop(registry_guard);

    // Login completion is an explicit capture trigger; correctness never
    // waits on the FS watcher or its five-minute backstop.
    let captured = agent_accounts_capture_kind(kind);
    let revision = agent_accounts_active_auth_revision(kind);
    let _ = app.emit(
        AGENT_ACCOUNTS_CHANGED_EVENT,
        json!({
            "kind": kind,
            "profile_id": profile_id,
            "active_profile_id": profile_id,
            "auth_revision": revision,
            "login_completed": true,
            "captured": captured,
        }),
    );
    true
}

fn agent_accounts_launch_profile_login_terminal(
    kind: &'static str,
    profile_id: &str,
    generation: Option<u64>,
) -> Result<Option<PathBuf>, String> {
    let (dir, is_default) = agent_accounts_profile_login_target(kind, profile_id)?;
    let provider = agent_accounts_provider_for_kind(kind);
    if is_default && kind == "claude" {
        return launch_account_login_terminal(provider).map(|_| None);
    }

    let definition = agent_definition(provider);
    let binary = npm_global_executable_path(definition)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| definition.binary.to_string());
    let dir_text = dir.to_string_lossy().to_string();
    let (args, env_vars): (Vec<&str>, Vec<(String, String)>) = match kind {
        "claude" => (
            vec!["auth", "login"],
            vec![("CLAUDE_CONFIG_DIR".to_string(), dir_text)],
        ),
        "opencode" => (
            vec!["auth", "login"],
            vec![(
                "XDG_DATA_HOME".to_string(),
                if is_default {
                    dir.parent().unwrap_or(&dir).to_string_lossy().to_string()
                } else {
                    dir_text
                },
            )],
        ),
        _ => {
            agent_accounts_ensure_codex_file_auth_store(&dir)?;
            (
                vec!["login", "--device-auth"],
                vec![("CODEX_HOME".to_string(), dir_text)],
            )
        }
    };
    let marker_set = if kind == "claude" {
        agent_accounts_prepare_captured_claude_profile_login(profile_id, &dir)?
    } else {
        false
    };
    let exit_marker = generation
        .map(|generation| agent_accounts_login_exit_marker_path(kind, profile_id, generation));
    let mut launch_env = env_vars;
    if let Some(marker) = exit_marker.as_ref() {
        launch_env.push((
            "DIFFFORGE_LOGIN_EXIT_MARKER".to_string(),
            marker.to_string_lossy().to_string(),
        ));
    }
    #[cfg(windows)]
    let launch = if let Some(marker) = exit_marker.as_ref() {
        let marker_temp = marker.with_extension(format!(
            "pending-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let mut command_line = format!("call {}", quote_cmd_arg(&binary));
        for arg in &args {
            command_line.push(' ');
            command_line.push_str(&quote_cmd_arg(arg));
        }
        command_line.push_str(" & set \"DIFFFORGE_LOGIN_STATUS=!errorlevel!\"");
        command_line.push_str(" & > ");
        command_line.push_str(&quote_cmd_arg(&marker_temp.to_string_lossy()));
        command_line.push_str(" echo !DIFFFORGE_LOGIN_STATUS!");
        command_line.push_str(" & move /Y ");
        command_line.push_str(&quote_cmd_arg(&marker_temp.to_string_lossy()));
        command_line.push(' ');
        command_line.push_str(&quote_cmd_arg(&marker.to_string_lossy()));
        command_line.push_str(" >nul & exit /B !DIFFFORGE_LOGIN_STATUS!");
        run_login_terminal_with_env(
            definition.label,
            "cmd.exe",
            &["/D", "/V:ON", "/S", "/C", &command_line],
            &launch_env,
        )
    } else {
        run_login_terminal_with_env(definition.label, &binary, &args, &launch_env)
    };
    #[cfg(not(windows))]
    let launch = if let Some(marker) = exit_marker.as_ref() {
        let invocation = std::iter::once(binary.as_str())
            .chain(args.iter().copied())
            .map(quote_shell_arg)
            .collect::<Vec<_>>()
            .join(" ");
        let marker_temp = marker.with_extension(format!(
            "pending-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let marker = quote_shell_arg(&marker.to_string_lossy());
        let marker_temp = quote_shell_arg(&marker_temp.to_string_lossy());
        let script = format!(
            "marker={marker}; marker_tmp={marker_temp}; \
             publish_status() {{ printf '%s\\n' \"$1\" > \"$marker_tmp\" && mv -f -- \"$marker_tmp\" \"$marker\"; }}; \
             trap 'publish_status 130; trap - HUP INT TERM; exit 130' HUP INT TERM; \
             {invocation}; status=$?; trap - HUP INT TERM; publish_status \"$status\"; exit \"$status\""
        );
        run_login_terminal_with_env(definition.label, "/bin/sh", &["-lc", &script], &launch_env)
    } else {
        run_login_terminal_with_env(definition.label, &binary, &args, &launch_env)
    };
    if launch.is_err() && marker_set {
        agent_accounts_clear_profile_login_marker(&dir);
    }
    launch.map(|_| exit_marker)
}

fn agent_accounts_profile_for_id(registry: &Value, kind: &str, profile_id: &str) -> Option<Value> {
    let (_, profiles) = agent_accounts_kind_entry(registry, kind);
    profiles.into_iter().find(|profile| {
        profile.get("id").and_then(Value::as_str).map(str::trim) == Some(profile_id)
    })
}

fn agent_accounts_active_auth_revision(kind: &str) -> String {
    let registry = agent_accounts_registry_read();
    let (profile_id, _) =
        agent_accounts_launch_profile_label(agent_accounts_supported_kind(kind).unwrap_or("codex"));
    let profile = agent_accounts_profile_for_id(&registry, kind, &profile_id);
    agent_accounts_auth_revision_for_profile(kind, &profile_id, profile.as_ref())
}

fn agent_accounts_active_home_for_kind(kind: &'static str) -> Option<PathBuf> {
    agent_accounts_profile_home_for_launch(kind).or_else(|| agent_accounts_default_home(kind))
}

fn agent_accounts_toml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn agent_accounts_upsert_codex_trust(body: &str, workspace_root: &Path) -> String {
    let path = workspace_root.to_string_lossy();
    let header = format!("[projects.\"{}\"]", agent_accounts_toml_escape(&path));
    let mut lines = body.lines().map(str::to_string).collect::<Vec<_>>();
    if let Some(start) = lines.iter().position(|line| line.trim() == header) {
        let end = lines[start + 1..]
            .iter()
            .position(|line| line.trim_start().starts_with('['))
            .map(|offset| start + 1 + offset)
            .unwrap_or(lines.len());
        if let Some(index) = (start + 1..end).find(|index| {
            lines[*index]
                .split_once('=')
                .is_some_and(|(key, _)| key.trim() == "trust_level")
        }) {
            lines[index] = "trust_level = \"trusted\"".to_string();
        } else {
            lines.insert(start + 1, "trust_level = \"trusted\"".to_string());
        }
    } else {
        if !lines.is_empty() && !lines.last().is_some_and(|line| line.trim().is_empty()) {
            lines.push(String::new());
        }
        lines.push(header);
        lines.push("trust_level = \"trusted\"".to_string());
    }
    let mut output = lines.join("\n");
    output.push('\n');
    output
}

fn agent_accounts_upsert_codex_file_auth_store(body: &str) -> String {
    let setting = "cli_auth_credentials_store = \"file\"";
    let mut lines = body.lines().map(str::to_string).collect::<Vec<_>>();
    let mut found = false;
    lines.retain_mut(|line| {
        let is_setting = line
            .split_once('=')
            .is_some_and(|(key, _)| key.trim() == "cli_auth_credentials_store");
        if !is_setting {
            return true;
        }
        if found {
            return false;
        }
        *line = setting.to_string();
        found = true;
        true
    });
    if !found {
        let section = lines
            .iter()
            .position(|line| line.trim_start().starts_with('['))
            .unwrap_or(lines.len());
        lines.insert(section, setting.to_string());
        if section + 1 < lines.len() && !lines[section + 1].trim().is_empty() {
            lines.insert(section + 1, String::new());
        }
    }
    let mut output = lines.join("\n");
    if !output.ends_with('\n') {
        output.push('\n');
    }
    output
}

fn agent_accounts_ensure_codex_file_auth_store(home: &Path) -> Result<(), String> {
    let path = home.join("config.toml");
    let current = fs::read_to_string(&path).unwrap_or_default();
    let next = agent_accounts_upsert_codex_file_auth_store(&current);
    if next != current {
        agent_accounts_write_private_file_atomic(&path, next.as_bytes(), "Codex file auth config")?;
    }
    Ok(())
}

fn agent_accounts_reconcile_workspace_trust_for(
    kind: &'static str,
    workspace_root: &Path,
) -> Result<Value, String> {
    let workspace_root =
        fs::canonicalize(workspace_root).unwrap_or_else(|_| workspace_root.to_path_buf());
    if !workspace_root.is_dir() {
        return Err("Workspace trust requires an existing project directory.".to_string());
    }
    match kind {
        "opencode" => Ok(json!({
            "contract": "diffforge.provider_workspace_trust.v1",
            "provider": kind,
            "state": "not_applicable",
            "workspace_root": workspace_root.to_string_lossy(),
            "source": "provider_native_state",
        })),
        "claude" => {
            let profile_home = agent_accounts_active_home_for_kind(kind)
                .ok_or_else(|| "Unable to resolve the active Claude profile home.".to_string())?;
            let state_path =
                if profile_home.file_name().and_then(|value| value.to_str()) == Some(".claude") {
                    profile_home
                        .parent()
                        .unwrap_or(&profile_home)
                        .join(".claude.json")
                } else {
                    profile_home.join(".claude.json")
                };
            let key = workspace_root.to_string_lossy().to_string();
            let outcome = ensure_claude_workspace_trust_in_config(&state_path, &workspace_root)?;
            if outcome == ClaudeWorkspaceTrustMergeOutcome::SkippedInvalidConfig {
                return Ok(json!({
                    "contract": "diffforge.provider_workspace_trust.v1",
                    "provider": kind,
                    "state": "skipped",
                    "workspace_root": key,
                    "source": "provider_native_state",
                    "message": "Claude state is malformed; DiffForge left it unchanged.",
                }));
            }
            Ok(json!({
                "contract": "diffforge.provider_workspace_trust.v1",
                "provider": kind,
                "state": "resolved",
                "workspace_root": key,
                "source": "provider_native_state",
            }))
        }
        _ => {
            let mut homes = Vec::new();
            if let Some(home) = agent_accounts_active_home_for_kind("codex") {
                homes.push(home);
            }
            if let Some(home) = agent_accounts_default_home("codex") {
                if !homes.contains(&home) {
                    homes.push(home);
                }
            }
            if homes.is_empty() {
                return Err("Unable to resolve the active Codex home.".to_string());
            }
            for home in homes {
                let path = home.join("config.toml");
                let current = fs::read_to_string(&path).unwrap_or_default();
                let next = agent_accounts_upsert_codex_trust(&current, &workspace_root);
                if next != current {
                    agent_accounts_write_private_file_atomic(
                        &path,
                        next.as_bytes(),
                        "Codex workspace trust",
                    )?;
                }
            }
            Ok(json!({
                "contract": "diffforge.provider_workspace_trust.v1",
                "provider": "codex",
                "state": "resolved",
                "workspace_root": workspace_root.to_string_lossy(),
                "source": "provider_native_state",
            }))
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn agent_accounts_reconcile_workspace_trust(
    agent_kind: String,
    workspace_root: String,
) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(&agent_kind)
        .ok_or_else(|| format!("Unsupported agent kind for trust: {agent_kind}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        agent_accounts_reconcile_workspace_trust_for(kind, Path::new(workspace_root.trim()))
    })
    .await
    .map_err(|error| format!("Provider workspace trust worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn agent_accounts_web_login_command(
    app: AppHandle,
    agent_kind: String,
    profile_id: String,
) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(&agent_kind)
        .ok_or_else(|| format!("Unsupported agent kind for accounts: {agent_kind}"))?;
    let profile_id = profile_id.trim().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let baseline = agent_accounts_login_completion_baseline(kind, &profile_id)?;
        let (dir, is_default) = agent_accounts_profile_login_target(kind, &profile_id)?;
        let default_claude_revision = (kind == "claude" && is_default)
            .then(|| agent_accounts_default_login_capture_baseline(kind));
        if kind == "claude" && !is_default {
            agent_accounts_prepare_captured_claude_profile_login(&profile_id, &dir)?;
        }
        if kind == "codex" {
            agent_accounts_ensure_codex_file_auth_store(&dir)?;
        }
        let base_command = if is_default {
            match kind {
                "claude" => "claude auth login".to_string(),
                "opencode" => "opencode auth login".to_string(),
                _ => "codex login --device-auth".to_string(),
            }
        } else {
            agent_accounts_login_command(kind, &dir.to_string_lossy())
        };
        let generation = matches!(kind, "codex" | "opencode").then(|| {
            agent_accounts_login_transaction_begin(kind, &profile_id, baseline.clone())
        });
        let exit_marker = generation
            .map(|generation| agent_accounts_login_exit_marker_path(kind, &profile_id, generation));
        if let (Some(generation), Some(marker)) = (generation, exit_marker.as_ref()) {
            if !agent_accounts_login_transaction_set_exit_marker(
                kind,
                &profile_id,
                generation,
                marker.clone(),
            ) {
                agent_accounts_login_transaction_invalidate(
                    kind,
                    Some(&profile_id),
                    Some(generation),
                );
                return Err("The provider login transaction changed during shell setup."
                    .to_string());
            }
        }
        let command = exit_marker
            .as_deref()
            .map(|marker| {
                agent_accounts_managed_login_command_with_exit_marker(
                    &base_command,
                    marker,
                    cfg!(windows),
                )
            })
            .unwrap_or(base_command);
        if let Some(baseline_revision) = default_claude_revision {
            agent_accounts_watch_default_login_capture_completion(
                app.clone(),
                kind,
                baseline_revision,
            );
        } else {
            agent_accounts_watch_profile_login_completion(
                app.clone(),
                kind,
                profile_id.clone(),
                baseline,
                generation,
                exit_marker,
                true,
            );
        }
        let _ = app.emit(
            AGENT_ACCOUNTS_CHANGED_EVENT,
            json!({ "kind": kind, "profile_id": profile_id, "login_started": true, "web_shell": true }),
        );
        Ok(json!({
            "contract": "diffforge.provider_auth_session.v1",
            "kind": kind,
            "profile_id": profile_id,
            "command": command,
            "generation": generation,
            "state": "starting",
        }))
    })
    .await
    .map_err(|error| format!("Provider web login worker failed: {error}"))?
}

fn agent_accounts_device_live_state_payload(stale_terminal_inventory: Vec<Value>) -> Value {
    let registry = agent_accounts_registry_read_resolved();
    let sanitize = |kind: &'static str| {
        let mut state = agent_accounts_kind_state(&registry, kind);
        if let Some(profiles) = state.get_mut("profiles").and_then(Value::as_array_mut) {
            for profile in profiles {
                if let Some(object) = profile.as_object_mut() {
                    object.remove("dir");
                    object.remove("login_command");
                    if let Some(identity) =
                        object.get_mut("identity").and_then(Value::as_object_mut)
                    {
                        identity.remove("tokenomics_account_key");
                    }
                }
            }
        }
        state
    };
    json!({
        "contract": "diffforge.provider_accounts_live.v1",
        "updated_at_ms": todo_dispatch_now_ms(),
        "stale_terminal_inventory": stale_terminal_inventory,
        "agents": {
            "codex": sanitize("codex"),
            "claude": sanitize("claude"),
            "opencode": sanitize("opencode"),
        }
    })
}

pub(crate) fn agent_accounts_device_live_state() -> Value {
    agent_accounts_device_live_state_payload(Vec::new())
}

pub(crate) async fn agent_accounts_device_live_state_for_terminal_state(
    state: &TerminalState,
) -> Value {
    let pane_profiles = agent_accounts_pane_profiles_for_state(state).await;
    let stale_terminal_inventory = pane_profiles
        .get("stale_inventory")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    agent_accounts_device_live_state_payload(stale_terminal_inventory)
}

pub(crate) fn agent_accounts_pane_profile_stamp(pane_id: &str) -> Option<Value> {
    AGENT_ACCOUNTS_PANE_PROFILES
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
        .ok()
        .and_then(|panes| panes.get(pane_id).cloned())
}

fn agent_accounts_watch_profile_login_completion(
    app: AppHandle,
    kind: &'static str,
    profile_id: String,
    baseline: Option<AgentAccountsLoginCompletionBaseline>,
    generation: Option<u64>,
    exit_marker: Option<PathBuf>,
    terminal_exit_owns_completion: bool,
) {
    if matches!(kind, "codex" | "opencode") {
        let Some(baseline) = baseline else {
            if let Some(generation) = generation {
                agent_accounts_login_transaction_invalidate(
                    kind,
                    Some(&profile_id),
                    Some(generation),
                );
                agent_accounts_remove_login_bindings(kind, &profile_id, generation);
            }
            if let Some(path) = exit_marker.as_ref() {
                let _ = fs::remove_file(path);
            }
            return;
        };
        let Some(generation) = generation else {
            return;
        };
        if agent_accounts_profile_login_target(kind, &profile_id).is_err() {
            agent_accounts_login_transaction_invalidate(kind, Some(&profile_id), Some(generation));
            agent_accounts_remove_login_bindings(kind, &profile_id, generation);
            if let Some(path) = exit_marker.as_ref() {
                let _ = fs::remove_file(path);
            }
            return;
        }
        let cleanup_profile_id = profile_id.clone();
        let cleanup_exit_marker = exit_marker.clone();
        let spawned = thread::Builder::new()
            .name("agent-account-codex-login".to_string())
            .spawn(move || {
                for _ in 0..(10 * 60) {
                    if !agent_accounts_login_transaction_is_current(kind, &profile_id, generation) {
                        if let Some(path) = exit_marker.as_ref() {
                            let _ = fs::remove_file(path);
                        }
                        return;
                    }
                    if let Some(path) = exit_marker.as_ref() {
                        // External CLI logins complete only at process exit.
                        // Status 0 receives one final exact-identity CAS attempt;
                        // failure/cancel/forced-close invalidates without ever
                        // consulting later credential changes. Managed-shell
                        // watchers call the same helper in cleanup-only mode;
                        // exact terminal teardown owns their marker.
                        if agent_accounts_login_watcher_consume_exit_marker(
                            kind,
                            &profile_id,
                            generation,
                            path,
                            terminal_exit_owns_completion,
                            || {
                                agent_accounts_try_complete_profile_login(
                                    &app,
                                    kind,
                                    &profile_id,
                                    &baseline,
                                    generation,
                                )
                            },
                        )
                        .is_some()
                        {
                            return;
                        }
                    } else if agent_accounts_try_complete_profile_login(
                        &app,
                        kind,
                        &profile_id,
                        &baseline,
                        generation,
                    ) {
                        return;
                    }
                    thread::sleep(Duration::from_secs(1));
                }
                agent_accounts_login_transaction_invalidate(
                    kind,
                    Some(&profile_id),
                    Some(generation),
                );
                if let Some(path) = exit_marker.as_ref() {
                    let _ = fs::remove_file(path);
                }
            });
        if spawned.is_err() {
            agent_accounts_login_transaction_invalidate(
                kind,
                Some(&cleanup_profile_id),
                Some(generation),
            );
            agent_accounts_remove_login_bindings(kind, &cleanup_profile_id, generation);
            if let Some(path) = cleanup_exit_marker.as_ref() {
                let _ = fs::remove_file(path);
            }
        }
        return;
    }
    if kind != "claude" || profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        return;
    }
    let Ok((profile_dir, false)) = agent_accounts_profile_login_target(kind, &profile_id) else {
        return;
    };
    let _ = thread::Builder::new()
        .name("agent-account-profile-login".to_string())
        .spawn(move || {
            loop {
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
                    (profile.get("id").and_then(Value::as_str) == Some(profile_id.as_str())).then(
                        || {
                            profile
                                .get("email")
                                .and_then(Value::as_str)
                                .map(agent_accounts_email_key)
                                .unwrap_or_default()
                        },
                    )
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
                ) {
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
            }
        });
}

fn agent_accounts_login_watcher_consume_exit_marker<F>(
    kind: &str,
    profile_id: &str,
    generation: u64,
    marker: &Path,
    terminal_exit_owns_completion: bool,
    complete: F,
) -> Option<bool>
where
    F: FnOnce() -> bool,
{
    if terminal_exit_owns_completion {
        return None;
    }
    agent_accounts_consume_login_exit_marker(
        kind,
        profile_id,
        generation,
        marker,
        complete,
    )
}

fn agent_accounts_login_exit_marker_status(marker: &Path) -> Option<i32> {
    match fs::read_to_string(marker) {
        Ok(status) => Some(status.trim().parse::<i32>().unwrap_or(-1)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => Some(-1),
    }
}

#[cfg(windows)]
fn agent_accounts_login_exit_marker_ack_path(marker: &Path) -> PathBuf {
    marker.with_extension("consumed")
}

#[cfg(any(windows, test))]
fn agent_accounts_publish_login_exit_marker(marker: &Path, status: i32) -> std::io::Result<()> {
    let pending = marker.with_extension(format!("pending-{}", uuid::Uuid::new_v4().simple()));
    fs::write(&pending, format!("{status}\n"))?;
    match fs::rename(&pending, marker) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&pending);
            Err(error)
        }
    }
}

fn agent_accounts_consume_login_exit_marker<F>(
    kind: &str,
    profile_id: &str,
    generation: u64,
    marker: &Path,
    complete: F,
) -> Option<bool>
where
    F: FnOnce() -> bool,
{
    let claimed = marker.with_extension(format!(
        "consuming-{}",
        uuid::Uuid::new_v4().simple()
    ));
    match fs::rename(marker, &claimed) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(_) => return None,
    }
    let status = agent_accounts_login_exit_marker_status(&claimed).unwrap_or(-1);
    let completed = status == 0 && complete();
    if !completed {
        agent_accounts_login_transaction_invalidate(kind, Some(profile_id), Some(generation));
    }
    #[cfg(windows)]
    {
        // The console-process monitor uses this acknowledgement to distinguish
        // a consumed inner-command status from a later forced console close.
        let _ = fs::write(agent_accounts_login_exit_marker_ack_path(marker), b"consumed\n");
    }
    let _ = fs::remove_file(&claimed);
    Some(completed)
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
        let baseline = agent_accounts_login_completion_baseline(kind, &profile_id)?;
        let generation = matches!(kind, "codex" | "opencode").then(|| {
            agent_accounts_login_transaction_begin(kind, &profile_id, baseline.clone())
        });
        let exit_marker =
            match agent_accounts_launch_profile_login_terminal(kind, &profile_id, generation) {
                Ok(exit_marker) => exit_marker,
                Err(error) => {
                    if let Some(generation) = generation {
                        agent_accounts_login_transaction_invalidate(
                            kind,
                            Some(&profile_id),
                            Some(generation),
                        );
                    }
                    return Err(error);
                }
            };
        if let (Some(generation), Some(marker)) = (generation, exit_marker.as_ref()) {
            if !agent_accounts_login_transaction_set_exit_marker(
                kind,
                &profile_id,
                generation,
                marker.clone(),
            ) {
                let _ = fs::remove_file(marker);
                agent_accounts_login_transaction_invalidate(
                    kind,
                    Some(&profile_id),
                    Some(generation),
                );
                return Err("The provider login transaction changed during launch.".to_string());
            }
        }
        agent_accounts_watch_profile_login_completion(
            app.clone(),
            kind,
            profile_id.clone(),
            baseline,
            generation,
            exit_marker,
            false,
        );
        let _ = app.emit(
            AGENT_ACCOUNTS_CHANGED_EVENT,
            json!({ "kind": kind, "profile_id": profile_id, "login_started": true }),
        );
        Ok(json!({ "ok": true, "kind": kind, "profile_id": profile_id, "generation": generation }))
    })
    .await
    .map_err(|error| format!("Agent account login worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn agent_accounts_cancel_profile_login(
    agent_kind: String,
    profile_id: String,
    generation: Option<u64>,
) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(&agent_kind)
        .ok_or_else(|| format!("Unsupported agent kind for accounts: {agent_kind}"))?;
    let profile_id = profile_id.trim().to_string();
    if profile_id.is_empty() {
        return Err("A profile id is required.".to_string());
    }
    let cancelled =
        agent_accounts_login_transaction_invalidate(kind, Some(&profile_id), generation);
    Ok(json!({
        "ok": true,
        "kind": kind,
        "profile_id": profile_id,
        "generation": generation,
        "cancelled": cancelled,
    }))
}

#[tauri::command(rename_all = "snake_case")]
async fn agent_accounts_bind_login_terminal(
    state: State<'_, TerminalState>,
    agent_kind: String,
    profile_id: String,
    generation: u64,
    pane_id: String,
) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(&agent_kind)
        .ok_or_else(|| format!("Unsupported agent kind for accounts: {agent_kind}"))?;
    let profile_id = profile_id.trim().to_string();
    validate_terminal_pane_id(&pane_id)?;
    let mut instance_id = None;
    for _ in 0..100 {
        instance_id = state
            .terminals
            .read()
            .await
            .get(&pane_id)
            .map(|instance| instance.id);
        if instance_id.is_some() {
            break;
        }
        sleep(Duration::from_millis(50)).await;
    }
    let instance_id = instance_id
        .ok_or_else(|| "The provider login terminal did not start in time.".to_string())?;
    agent_accounts_login_transaction_bind_terminal(
        kind,
        &profile_id,
        generation,
        &pane_id,
        instance_id,
    )?;
    Ok(json!({
        "ok": true,
        "kind": kind,
        "profile_id": profile_id,
        "generation": generation,
        "pane_id": pane_id,
        "instance_id": instance_id,
    }))
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
        let mut registry = agent_accounts_registry_read_checked()
            .map_err(|error| format!("Agent accounts registry is unavailable: {error}"))?;
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
    if kind == "codex" {
        return Err(
            "Codex account switches require device authorization; start a profile login instead."
                .to_string(),
        );
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Any explicit selection supersedes an in-flight login for this
        // provider. A completion watcher must never overwrite that newer
        // choice later.
        agent_accounts_login_transaction_invalidate(kind, None, None);
        let mut registry = agent_accounts_registry_read_checked()
            .map_err(|error| format!("Agent accounts registry is unavailable: {error}"))?;
        let profile = agent_accounts_profile_for_id(&registry, kind, &profile_id);
        if kind == "opencode" {
            let identity = if profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
                agent_accounts_profile_identity(kind, None)
            } else {
                let dir = profile
                    .as_ref()
                    .and_then(agent_accounts_profile_dir)
                    .ok_or_else(|| format!("Unknown {kind} account profile: {profile_id}"))?;
                agent_accounts_profile_identity(kind, Some(&dir))
            };
            if !identity
                .get("auth_ready")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                return Err(
                    "This OpenCode account needs login before it can be selected.".to_string(),
                );
            }
        }
        let active_profile_id = profile_id.clone();
        agent_accounts_activate_profile_in_registry(&mut registry, kind, &active_profile_id)?;
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
    let local_device_id = cloud_mcp_payload_text(&local_device, &["device_id"]).unwrap_or_default();
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
        &[&["device_name"][..], &["machine_name"][..], &["name"][..]],
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
        let mut registry = agent_accounts_registry_read_checked()
            .map_err(|error| format!("Agent accounts registry is unavailable: {error}"))?;
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
        // Duplicate profiles are only retired DYNAMICALLY (derived from the
        // registry), so deleting one would resurrect its synthetic usage pill
        // from durable Tokenomics history. Capture the duplicate verdict from
        // the pre-removal roster; the retirement is persisted after the
        // registry write succeeds.
        let removed_was_duplicate = {
            let default_email = agent_accounts_default_email(kind);
            let effective_active_id = agent_accounts_effective_active_profile_id(
                kind,
                &active_id,
                &profiles,
                &default_email,
            );
            !agent_accounts_canonical_profile_ids_by_email(
                kind,
                &profiles,
                &effective_active_id,
                &default_email,
            )
            .contains(&profile_id)
        };
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
                suppressed.push(removed_email.clone());
            }
            registry["agents"][kind]["captured_suppressed"] = json!(suppressed);
        }
        agent_accounts_registry_write(&registry)?;
        if removed_was_duplicate {
            let (provider, tokenomics_agent_kind) = match kind {
                "claude" => ("anthropic", "claude"),
                "codex" => ("openai", "codex"),
                _ => ("opencode", "opencode"),
            };
            let synthetic_key = format!("{provider}:{tokenomics_agent_kind}:profile:{profile_id}");
            // When the removed identity is the one signed into the default
            // home, fold its synthetic history into the live canonical
            // account; otherwise a durable retirement keeps the phantom pill
            // hidden without deleting its rows.
            let canonical_key = (!removed_email.is_empty() && removed_email == current_email)
                .then(|| tokenomics_provider_account(provider, tokenomics_agent_kind).key)
                .filter(|key| !tokenomics_provider_account_key_is_unknown(key));
            let _ = tokenomics_persist_retired_provider_account_key_for_app(
                &app,
                provider,
                tokenomics_agent_kind,
                &synthetic_key,
                canonical_key.as_deref(),
            );
        }
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
fn agent_accounts_restart_eligible(execution_phase: &str, terminal_lifecycle: &str) -> bool {
    terminal_lifecycle == "open"
        && matches!(
            execution_phase,
            "idle" | "completed" | "complete" | "done" | "cancelled" | "canceled" | "interrupted"
        )
}

fn agent_accounts_build_stale_inventory(
    panes: &serde_json::Map<String, Value>,
    active: &Value,
    live_panes: &HashMap<String, Value>,
) -> Vec<Value> {
    let mut inventory = panes
        .iter()
        .filter_map(|(pane_id, stamp)| {
            let kind = stamp.get("kind").and_then(Value::as_str)?;
            let target = active.get(kind)?;
            let stamped_profile_id = stamp
                .get("profile_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let stamped_revision = stamp
                .get("auth_revision")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let target_profile_id = target
                .get("profile_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let target_revision = target
                .get("auth_revision")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let profile_changed = !target_profile_id.is_empty()
                && stamped_profile_id != target_profile_id;
            let revision_changed = !profile_changed
                && !target_revision.is_empty()
                && stamped_revision != target_revision;
            if !profile_changed && !revision_changed {
                return None;
            }
            // Closed panes can leave a bounded historical launch stamp behind;
            // the provider-wide restart inventory is live-terminal state only.
            let live = live_panes.get(pane_id)?;
            let open = live
                .get("open")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            if !open {
                return None;
            }
            let workspace_id = live
                .get("workspace_id")
                .and_then(Value::as_str)
                .or_else(|| stamp.get("workspace_id").and_then(Value::as_str))
                .unwrap_or_default();
            let workspace_label = live
                .get("workspace_label")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .or_else(|| stamp.get("workspace_label").and_then(Value::as_str))
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(workspace_id);
            let terminal_index = live
                .get("terminal_index")
                .and_then(Value::as_u64)
                .or_else(|| stamp.get("terminal_index").and_then(Value::as_u64));
            let instance_id = live.get("instance_id").and_then(Value::as_u64)?;
            let launch_epoch = live
                .get("launch_epoch")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())?;
            let restart_eligible = live
                .get("restart_eligible")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let busy = !restart_eligible;
            let activity = live
                .get("activity")
                .and_then(Value::as_str)
                .unwrap_or(if busy { "blocked" } else { "idle" });
            Some(json!({
                "kind": kind,
                "provider": kind,
                "workspace_id": workspace_id,
                "workspace_label": workspace_label,
                "pane_id": pane_id,
                "terminal_index": terminal_index,
                "instance_id": instance_id,
                "launch_epoch": launch_epoch,
                "activity": activity,
                "busy": busy,
                "idle": restart_eligible,
                "restart_eligible": restart_eligible,
                "restart_intent_seq": live.get("restart_intent_seq").and_then(Value::as_u64).unwrap_or(0),
                "restart_intent_pending": live.get("restart_intent_pending").and_then(Value::as_bool).unwrap_or(false),
                "restart_intent_state": live.get("restart_intent_state").and_then(Value::as_str).unwrap_or("none"),
                "restart_mode": live.get("restart_mode").cloned().unwrap_or(Value::Null),
                "restart_target_role": live.get("restart_target_role").cloned().unwrap_or(Value::Null),
                "restart_coordinator_id": live.get("restart_coordinator_id").cloned().unwrap_or(Value::Null),
                "restart_deadline_at_ms": live.get("restart_deadline_at_ms").cloned().unwrap_or(Value::Null),
                "restart_force_action": live.get("restart_force_action").cloned().unwrap_or(Value::Null),
                "needs_restart": true,
                "stamped_profile_id": stamped_profile_id,
                "stamped_profile_label": stamp.get("profile_label").and_then(Value::as_str).unwrap_or_default(),
                "stamped_auth_revision": stamped_revision,
                "target_profile_id": target_profile_id,
                "target_profile_label": target.get("profile_label").and_then(Value::as_str).unwrap_or_default(),
                "target_auth_revision": target_revision,
                "stale_reason": if profile_changed { "profile_changed" } else { "auth_revision_changed" },
            }))
        })
        .collect::<Vec<_>>();
    inventory.sort_by(|left, right| {
        let text = |value: &Value, key: &str| {
            value
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        text(left, "workspace_label")
            .cmp(&text(right, "workspace_label"))
            .then_with(|| text(left, "workspace_id").cmp(&text(right, "workspace_id")))
            .then_with(|| {
                left.get("terminal_index")
                    .and_then(Value::as_u64)
                    .cmp(&right.get("terminal_index").and_then(Value::as_u64))
            })
            .then_with(|| text(left, "pane_id").cmp(&text(right, "pane_id")))
    });
    inventory
}

async fn agent_accounts_pane_profiles_for_state(state: &TerminalState) -> Value {
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
    let active = json!({
        "claude": { "profile_id": claude_active, "profile_label": claude_label, "auth_revision": agent_accounts_active_auth_revision("claude") },
        "codex": { "profile_id": codex_active, "profile_label": codex_label, "auth_revision": agent_accounts_active_auth_revision("codex") },
        "opencode": { "profile_id": opencode_active, "profile_label": opencode_label, "auth_revision": agent_accounts_active_auth_revision("opencode") },
    });
    let auth = json!({
        "claude": agent_accounts_kind_auth_statuses(&registry, "claude"),
        "codex": agent_accounts_kind_auth_statuses(&registry, "codex"),
        "opencode": agent_accounts_kind_auth_statuses(&registry, "opencode"),
    });
    let live_panes = {
        let terminals = state.terminals.read().await;
        terminals
            .iter()
            .map(|(pane_id, instance)| {
                let runtime = terminal_runtime_snapshot(instance);
                let projected = terminal_project_runtime(&instance.metadata, &runtime, false);
                let launch_epoch = terminal_instance_launch_epoch(instance);
                let restart_intent = terminal_restart_intent_for_instance(state, instance);
                let open = projected.terminal_lifecycle == "open";
                let restart_eligible = agent_accounts_restart_eligible(
                    &projected.execution_phase,
                    &projected.terminal_lifecycle,
                );
                (
                    pane_id.clone(),
                    json!({
                        "instance_id": instance.id,
                        "launch_epoch": launch_epoch,
                        "workspace_id": instance.metadata.workspace_id.as_str(),
                        "workspace_label": instance.metadata.workspace_name.as_str(),
                        "terminal_index": instance.metadata.terminal_index,
                        "activity": projected.execution_phase,
                        "open": open,
                        "restart_eligible": restart_eligible,
                        "restart_intent_seq": restart_intent.as_ref().map(|intent| intent.restart_intent_seq).unwrap_or(0),
                        "restart_intent_pending": restart_intent.is_some(),
                        "restart_intent_state": restart_intent.as_ref().map(|intent| intent.state.as_str()).unwrap_or("none"),
                        "restart_mode": restart_intent.as_ref().map(|intent| intent.mode.as_str()),
                        "restart_target_role": restart_intent.as_ref().map(|intent| intent.target_role.as_str()),
                        "restart_coordinator_id": restart_intent.as_ref().map(|intent| intent.coordinator_id.as_str()),
                        "restart_deadline_at_ms": restart_intent.as_ref().map(|intent| intent.deadline_at_ms),
                        "restart_force_action": restart_intent.as_ref().and_then(|intent| (intent.state == "blocked").then(|| terminal_restart_intent_force_action(intent))),
                    }),
                )
            })
            .collect::<HashMap<_, _>>()
    };
    let inventory = agent_accounts_build_stale_inventory(&panes, &active, &live_panes);
    json!({
        "panes": panes,
        "active": active,
        "auth": auth,
        "stale_inventory": inventory,
    })
}

#[tauri::command(rename_all = "snake_case")]
async fn agent_accounts_pane_profiles(state: State<'_, TerminalState>) -> Result<Value, String> {
    Ok(agent_accounts_pane_profiles_for_state(state.inner()).await)
}

#[cfg(test)]
mod agent_accounts_tests {
    use super::*;

    static AGENT_ACCOUNTS_TEST_ENV_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();

    #[test]
    fn registry_parse_rejects_torn_writes_and_last_good_survives() {
        let _env_guard = AGENT_ACCOUNTS_TEST_ENV_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        assert!(agent_accounts_registry_parse("{\"agents\": {\"codex\"").is_none());
        assert!(agent_accounts_registry_parse("[1, 2]").is_none());
        // Structurally invalid shapes must not become "last known good".
        assert!(agent_accounts_registry_parse("{}").is_none());
        assert!(agent_accounts_registry_parse("{\"agents\": null}").is_none());
        let registry = json!({ "agents": { "codex": { "profiles": [{ "id": "p1" }] } } });
        assert_eq!(
            agent_accounts_registry_parse(&registry.to_string()).as_ref(),
            Some(&registry)
        );

        agent_accounts_registry_remember_last_good(&registry);
        assert_eq!(agent_accounts_registry_last_good_or_empty(), registry);
        let empty = json!({ "agents": {} });
        agent_accounts_registry_remember_last_good(&empty);
        assert_eq!(agent_accounts_registry_last_good_or_empty(), empty);
    }

    #[test]
    fn codex_workspace_trust_upsert_is_idempotent_and_overrides_untrusted() {
        let root = Path::new("/tmp/diff-forge trust/project");
        let original = format!(
            "model = \"gpt-5\"\n\n[projects.\"{}\"]\ntrust_level = \"untrusted\"\n",
            agent_accounts_toml_escape(&root.to_string_lossy()),
        );
        let trusted = agent_accounts_upsert_codex_trust(&original, root);
        assert!(trusted.contains("trust_level = \"trusted\""));
        assert!(!trusted.contains("trust_level = \"untrusted\""));
        assert_eq!(agent_accounts_upsert_codex_trust(&trusted, root), trusted);
    }

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
        test_codex_auth_for_account(email, &format!("acct-{email}"), "refresh-a")
    }

    fn test_codex_auth_for_account(email: &str, account_id: &str, refresh: &str) -> String {
        let claims = general_purpose::URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&json!({
                "email": email,
                "chatgpt_account_id": account_id,
            }))
            .unwrap(),
        );
        serde_json::to_string(&json!({ "tokens": {
            "id_token": format!("h.{claims}.s"),
            "refresh_token": refresh,
        } }))
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

    #[test]
    fn userprofile_without_home_resolves_all_provider_identities() {
        let root = env::temp_dir().join(format!(
            "agent_accounts_userprofile_{}",
            uuid::Uuid::new_v4()
        ));
        let status = std::process::Command::new(env::current_exe().unwrap())
            .arg("--exact")
            .arg("agent_accounts_tests::userprofile_without_home_capture_child")
            .arg("--nocapture")
            .env("DIFFFORGE_USERPROFILE_CAPTURE_CHILD", &root)
            .env("USERPROFILE", &root)
            .env_remove("HOME")
            .env_remove("XDG_DATA_HOME")
            .env(CLOUD_MCP_LOCAL_DATA_DIR_ENV, root.join("diffforge-data"))
            .status()
            .unwrap();
        let _ = fs::remove_dir_all(&root);
        assert!(
            status.success(),
            "isolated USERPROFILE capture child failed"
        );
    }

    /// Environment variables are process-global. Run the Windows-home capture
    /// regression in an exact child test so unrelated parallel tests cannot
    /// replace HOME/local-data between the three provider captures.
    #[test]
    fn userprofile_without_home_capture_child() {
        let Some(root) = env::var_os("DIFFFORGE_USERPROFILE_CAPTURE_CHILD").map(PathBuf::from)
        else {
            return;
        };
        fs::create_dir_all(root.join(".claude")).unwrap();
        fs::create_dir_all(root.join(".codex")).unwrap();
        fs::create_dir_all(root.join(".local/share/opencode")).unwrap();
        fs::write(root.join(".claude/.credentials.json"), "{}").unwrap();
        fs::write(
            root.join(".claude.json"),
            test_claude_state_for_email("claude@example.com"),
        )
        .unwrap();
        fs::write(
            root.join(".codex/auth.json"),
            test_codex_auth_for_email("codex@example.com"),
        )
        .unwrap();
        fs::write(
            root.join(".local/share/opencode/auth.json"),
            serde_json::to_vec(&json!({ "opencode-go": { "type": "api", "key": "oc-key" } }))
                .unwrap(),
        )
        .unwrap();

        for kind in ["claude", "codex", "opencode"] {
            let identity = agent_accounts_profile_identity(kind, None);
            assert_eq!(identity["auth_ready"], json!(true), "{kind}");
            assert!(
                identity["email"]
                    .as_str()
                    .is_some_and(|value| !value.is_empty()),
                "{kind}"
            );
        }
        assert_eq!(
            user_home_dir_from(Some(root.clone().into_os_string()), None),
            Some(root.clone())
        );
        for kind in ["claude", "codex", "opencode"] {
            assert!(agent_accounts_capture_kind(kind), "capture {kind}");
        }
        let registry = agent_accounts_registry_read_checked().unwrap();
        for kind in ["claude", "codex", "opencode"] {
            let (_, profiles) = agent_accounts_kind_entry(&registry, kind);
            assert_eq!(profiles.len(), 1, "captured registry profile for {kind}");
            let profile_dir = agent_accounts_profile_dir(&profiles[0]).unwrap();
            let auth_path = agent_accounts_profile_auth_path(kind, &profile_dir);
            assert!(auth_path.is_file(), "captured auth snapshot for {kind}");
            assert!(
                agent_accounts_profile_identity(kind, Some(&profile_dir))["auth_ready"]
                    .as_bool()
                    .unwrap_or(false),
                "captured profile identity for {kind}"
            );
        }
    }

    #[test]
    fn capture_watcher_promotes_later_created_provider_dir() {
        let root = env::temp_dir().join(format!(
            "agent_accounts_watch_plan_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let provider_dir = root.join(".codex");
        let auth_path = provider_dir.join("auth.json");
        let targets = vec![("codex", auth_path.clone())];
        let mut watched = HashMap::new();
        let initial = agent_accounts_capture_watch_registration_plan(&targets, &watched);
        assert_eq!(initial, vec![("codex", root.clone())]);
        watched.insert("codex", root.clone());

        fs::create_dir_all(&provider_dir).unwrap();
        fs::write(&auth_path, test_codex_auth_for_email("watch@example.com")).unwrap();
        let promoted = agent_accounts_capture_watch_registration_plan(&targets, &watched);
        assert_eq!(promoted, vec![("codex", provider_dir.clone())]);
        assert!(agent_accounts_capture_promoted_target_exists(
            "codex", &targets
        ));
        watched.insert("codex", provider_dir.clone());
        assert!(agent_accounts_capture_watch_registration_plan(&targets, &watched).is_empty());

        let relevant = notify::Event::new(notify::EventKind::Any).add_path(auth_path);
        let unrelated = notify::Event::new(notify::EventKind::Any)
            .add_path(root.join("another/provider/auth.json"));
        assert!(agent_accounts_capture_event_is_relevant(
            &relevant, &targets
        ));
        assert!(!agent_accounts_capture_event_is_relevant(
            &unrelated, &targets
        ));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn codex_login_transaction_requires_changed_expected_auth_before_activation() {
        let baseline = AgentAccountsLoginCompletionBaseline {
            auth_signature: "before".to_string(),
            expected_identity: "codex-account:workspace-expected".to_string(),
        };
        let expected = json!({
            "email": "same@example.com",
            "stable_identity": "codex-account:workspace-expected",
            "auth_ready": true,
        });
        let wrong = json!({
            "email": "same@example.com",
            "stable_identity": "codex-account:workspace-wrong",
            "auth_ready": true,
        });
        assert!(!agent_accounts_codex_login_completion_matches(
            &baseline, "before", &expected
        ));
        assert!(!agent_accounts_codex_login_completion_matches(
            &baseline, "after", &wrong
        ));
        assert!(agent_accounts_codex_login_completion_matches(
            &baseline, "after", &expected
        ));
        assert_eq!(
            agent_accounts_login_command("codex", "/tmp/profile"),
            "CODEX_HOME='/tmp/profile' codex login --device-auth"
        );

        let mut registry = json!({
            "agents": { "codex": {
                "active_profile_id": "old",
                "profiles": [{ "id": "old" }, { "id": "target" }]
            }}
        });
        assert_eq!(registry["agents"]["codex"]["active_profile_id"], "old");
        agent_accounts_activate_profile_in_registry(&mut registry, "codex", "target").unwrap();
        assert_eq!(registry["agents"]["codex"]["active_profile_id"], "target");
    }

    #[test]
    fn failed_external_login_marker_cannot_claim_changed_matching_auth() {
        let kind = format!("test-exit-kind-{}", uuid::Uuid::new_v4());
        let profile = "external-profile";
        let generation = agent_accounts_login_transaction_begin(&kind, profile, None);
        let marker =
            env::temp_dir().join(format!("agent-account-login-exit-{}", uuid::Uuid::new_v4()));
        agent_accounts_publish_login_exit_marker(&marker, 1).unwrap();
        let completion_attempted = AtomicBool::new(false);
        assert_eq!(
            agent_accounts_consume_login_exit_marker(
                &kind,
                profile,
                generation,
                &marker,
                || {
                    // Models a matching auth.json revision appearing after the
                    // failed process exited. Failure must not call completion.
                    completion_attempted.store(true, Ordering::SeqCst);
                    true
                },
            ),
            Some(false)
        );
        assert!(!completion_attempted.load(Ordering::SeqCst));
        assert!(!agent_accounts_login_transaction_is_current(
            &kind,
            profile,
            generation,
        ));
        assert!(!agent_accounts_login_transaction_claim(
            &kind, profile, generation
        ));
        assert!(!marker.exists());

        let success_generation = agent_accounts_login_transaction_begin(&kind, profile, None);
        agent_accounts_publish_login_exit_marker(&marker, 0).unwrap();
        assert_eq!(
            agent_accounts_consume_login_exit_marker(
                &kind,
                profile,
                success_generation,
                &marker,
                || agent_accounts_login_transaction_claim(&kind, profile, success_generation),
            ),
            Some(true)
        );
        assert!(!agent_accounts_login_transaction_is_current(
            &kind,
            profile,
            success_generation,
        ));
        assert!(!marker.exists());
    }

    #[cfg(unix)]
    #[test]
    fn managed_web_shell_login_is_exit_status_gated() {
        let kind = format!("managed-exit-kind-{}", uuid::Uuid::new_v4());
        let profile = "managed-profile";
        let failed_generation =
            agent_accounts_login_transaction_begin(&kind, profile, None);
        let failed_marker = env::temp_dir().join(format!(
            "agent-account-managed-failed-{}",
            uuid::Uuid::new_v4()
        ));
        let failed_command = agent_accounts_managed_login_command_with_exit_marker(
            "false",
            &failed_marker,
            false,
        );
        let completion_attempted = Arc::new(AtomicBool::new(false));
        assert!(agent_accounts_consume_login_exit_marker(
            &kind,
            profile,
            failed_generation,
            &failed_marker,
            || true,
        )
        .is_none(), "pre-exit credential changes cannot activate");
        let status = Command::new("/bin/sh")
            .args(["-c", &failed_command])
            .status()
            .unwrap();
        assert!(!status.success());
        let attempted = Arc::clone(&completion_attempted);
        assert_eq!(
            agent_accounts_consume_login_exit_marker(
                &kind,
                profile,
                failed_generation,
                &failed_marker,
                move || {
                    attempted.store(true, Ordering::SeqCst);
                    true
                },
            ),
            Some(false)
        );
        assert!(!completion_attempted.load(Ordering::SeqCst));

        let success_generation =
            agent_accounts_login_transaction_begin(&kind, profile, None);
        let success_marker = env::temp_dir().join(format!(
            "agent-account-managed-success-{}",
            uuid::Uuid::new_v4()
        ));
        let success_command = agent_accounts_managed_login_command_with_exit_marker(
            "trap 'sleep 1' EXIT; true",
            &success_marker,
            false,
        );
        let mut child = Command::new("/bin/sh")
            .args(["-c", &success_command])
            .spawn()
            .unwrap();
        for _ in 0..100 {
            if success_marker.is_file() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(success_marker.is_file());
        assert!(child.try_wait().unwrap().is_none(), "the PTY command is still alive after publishing its inner status");
        assert_eq!(
            agent_accounts_login_watcher_consume_exit_marker(
                &kind,
                profile,
                success_generation,
                &success_marker,
                true,
                || panic!("a managed watcher must never attempt activation"),
            ),
            None
        );
        assert!(success_marker.is_file());
        assert!(child.wait().unwrap().success());
        assert_eq!(
            agent_accounts_consume_login_exit_marker(
                &kind,
                profile,
                success_generation,
                &success_marker,
                || agent_accounts_login_transaction_claim(
                    &kind,
                    profile,
                    success_generation,
                ),
            ),
            Some(true)
        );
    }

    #[test]
    fn login_transaction_generation_cas_rejects_stale_cancelled_and_exited_watchers() {
        agent_accounts_login_transaction_invalidate("codex", None, None);
        let old = agent_accounts_login_transaction_begin("codex", "profile-a", None);
        let current = agent_accounts_login_transaction_begin("codex", "profile-b", None);
        assert!(!agent_accounts_login_transaction_is_current(
            "codex",
            "profile-a",
            old
        ));
        assert!(!agent_accounts_login_transaction_claim(
            "codex",
            "profile-a",
            old
        ));
        assert!(agent_accounts_login_transaction_is_current(
            "codex",
            "profile-b",
            current
        ));
        assert!(agent_accounts_login_transaction_invalidate(
            "codex",
            Some("profile-b"),
            Some(current)
        ));
        assert!(!agent_accounts_login_transaction_claim(
            "codex",
            "profile-b",
            current
        ));

        let baseline = AgentAccountsLoginCompletionBaseline {
            auth_signature: "before".to_string(),
            expected_identity: "codex-account:profile-c".to_string(),
        };
        let exited = agent_accounts_login_transaction_begin(
            "codex",
            "profile-c",
            Some(baseline),
        );
        let marker = env::temp_dir().join(format!(
            "agent-account-bound-exit-{}",
            uuid::Uuid::new_v4()
        ));
        assert!(agent_accounts_login_transaction_set_exit_marker(
            "codex",
            "profile-c",
            exited,
            marker.clone(),
        ));
        agent_accounts_login_transaction_bind_terminal(
            "codex",
            "profile-c",
            exited,
            "login-pane",
            91,
        )
        .unwrap();
        agent_accounts_publish_login_exit_marker(&marker, 1).unwrap();
        agent_accounts_login_terminal_process_exited(None, "login-pane", 91, Some(1));
        assert!(!agent_accounts_login_transaction_is_current(
            "codex",
            "profile-c",
            exited
        ));
    }

    #[test]
    fn login_pane_binding_is_atomic_and_instance_scoped() {
        let kind = "opencode";
        let profile = format!("atomic-bind-{}", uuid::Uuid::new_v4());
        let baseline = AgentAccountsLoginCompletionBaseline {
            auth_signature: "original-baseline".to_string(),
            expected_identity: "opencode-account".to_string(),
        };
        let first = agent_accounts_login_transaction_begin(
            kind,
            &profile,
            Some(baseline.clone()),
        );
        let first_marker = env::temp_dir().join(format!(
            "agent-account-bind-first-{}",
            uuid::Uuid::new_v4()
        ));
        assert!(agent_accounts_login_transaction_set_exit_marker(
            kind,
            &profile,
            first,
            first_marker.clone(),
        ));
        let first_binding = agent_accounts_login_transaction_bind_terminal(
            kind,
            &profile,
            first,
            "shared-pane",
            101,
        )
        .unwrap();
        assert_eq!(first_binding.baseline.auth_signature, "original-baseline");

        let second = agent_accounts_login_transaction_begin(
            kind,
            &profile,
            Some(AgentAccountsLoginCompletionBaseline {
                auth_signature: "new-baseline".to_string(),
                expected_identity: "opencode-account".to_string(),
            }),
        );
        let second_marker = env::temp_dir().join(format!(
            "agent-account-bind-second-{}",
            uuid::Uuid::new_v4()
        ));
        assert!(agent_accounts_login_transaction_set_exit_marker(
            kind,
            &profile,
            second,
            second_marker.clone(),
        ));
        agent_accounts_login_transaction_bind_terminal(
            kind,
            &profile,
            second,
            "shared-pane",
            102,
        )
        .unwrap();

        agent_accounts_login_terminal_process_exited(None, "shared-pane", 101, Some(1));
        assert!(agent_accounts_login_transaction_is_current(
            kind,
            &profile,
            second,
        ));
        assert!(AGENT_ACCOUNTS_LOGIN_PANES
            .get_or_init(|| StdMutex::new(HashMap::new()))
            .lock()
            .unwrap()
            .contains_key(&("shared-pane".to_string(), 102, second)));
        agent_accounts_login_terminal_process_exited(None, "shared-pane", 102, Some(1));
        let _ = fs::remove_file(first_marker);
        let _ = fs::remove_file(second_marker);

        let race_profile = format!("atomic-bind-race-{}", uuid::Uuid::new_v4());
        let race = agent_accounts_login_transaction_begin(
            kind,
            &race_profile,
            Some(AgentAccountsLoginCompletionBaseline {
                auth_signature: "race-baseline".to_string(),
                expected_identity: "opencode-account".to_string(),
            }),
        );
        let race_marker = env::temp_dir().join(format!(
            "agent-account-bind-race-{}",
            uuid::Uuid::new_v4()
        ));
        assert!(agent_accounts_login_transaction_set_exit_marker(
            kind,
            &race_profile,
            race,
            race_marker.clone(),
        ));
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let attempts = [201_u64, 202_u64]
            .into_iter()
            .map(|instance_id| {
                let profile = race_profile.clone();
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    agent_accounts_login_transaction_bind_terminal(
                        kind,
                        &profile,
                        race,
                        "racing-pane",
                        instance_id,
                    )
                    .is_ok()
                })
            })
            .collect::<Vec<_>>();
        assert_eq!(
            attempts
                .into_iter()
                .map(|attempt| attempt.join().unwrap())
                .filter(|bound| *bound)
                .count(),
            1,
            "the transaction CAS must allow exactly one concurrent terminal binding"
        );
        agent_accounts_login_transaction_invalidate(kind, Some(&race_profile), Some(race));
        agent_accounts_remove_login_bindings(kind, &race_profile, race);
        let _ = fs::remove_file(race_marker);
    }

    #[test]
    fn codex_identity_uses_workspace_account_id_not_display_email() {
        let personal: Value = serde_json::from_str(&test_codex_auth_for_account(
            "shared@example.com",
            "workspace-personal",
            "refresh-personal",
        ))
        .unwrap();
        let organization: Value = serde_json::from_str(&test_codex_auth_for_account(
            "shared@example.com",
            "workspace-org",
            "refresh-org",
        ))
        .unwrap();
        assert_eq!(
            agent_accounts_codex_email_from_auth(&personal),
            agent_accounts_codex_email_from_auth(&organization)
        );
        assert_eq!(
            agent_accounts_codex_stable_identity_from_auth(&personal),
            "codex-account:workspace-personal"
        );
        assert_eq!(
            agent_accounts_codex_stable_identity_from_auth(&organization),
            "codex-account:workspace-org"
        );
        assert_ne!(
            agent_accounts_codex_stable_identity_from_auth(&personal),
            agent_accounts_codex_stable_identity_from_auth(&organization)
        );
    }

    #[test]
    fn codex_jwt_subject_without_workspace_claim_is_not_switch_identity() {
        let claims = general_purpose::URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&json!({
                "sub": "same-person",
                "email": "shared@example.com"
            }))
            .unwrap(),
        );
        let auth = json!({ "tokens": {
            "id_token": format!("h.{claims}.s"),
            "refresh_token": "rotating-secret"
        }});
        assert_eq!(
            agent_accounts_codex_email_from_auth(&auth),
            "shared@example.com"
        );
        assert!(agent_accounts_codex_stable_identity_from_auth(&auth).is_empty());
    }

    #[test]
    fn opencode_first_seen_oauth_identity_is_single_under_concurrency() {
        const OBSERVERS: usize = 16;
        let root = env::temp_dir().join(format!(
            "agent_accounts_opencode_first_seen_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let auth = Arc::new(json!({
            "provider-oauth": {
                "type": "oauth",
                "access": "rotating-access",
                "refresh": "rotating-refresh"
            }
        }));
        let barrier = Arc::new(std::sync::Barrier::new(OBSERVERS));
        let mut observers = Vec::new();
        for _ in 0..OBSERVERS {
            let root = root.clone();
            let auth = Arc::clone(&auth);
            let barrier = Arc::clone(&barrier);
            observers.push(thread::spawn(move || {
                barrier.wait();
                agent_accounts_opencode_identity_with_first_seen(&auth, &root)
            }));
        }
        let identities = observers
            .into_iter()
            .map(|observer| observer.join().unwrap())
            .collect::<Vec<_>>();
        assert!(!identities[0].is_empty());
        assert!(identities.iter().all(|identity| identity == &identities[0]));
        let persisted = agent_accounts_opencode_identity_with_first_seen(&auth, &root);
        assert_eq!(persisted, identities[0]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn opencode_mixed_oauth_and_api_first_observation_survives_rotation() {
        let root = env::temp_dir().join(format!(
            "agent_accounts_opencode_mixed_rotation_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let first_auth = json!({
            "opencode-go": {"type": "api", "key": "api-before"},
            "provider-oauth": {
                "type": "oauth",
                "access": "access-before",
                "refresh": "refresh-before"
            }
        });
        let first = agent_accounts_opencode_identity_with_first_seen(&first_auth, &root);
        assert!(
            first.contains("opencode-oauth-provider-oauth-first-seen-"),
            "mixed credentials must persist the OAuth account identity on first observation"
        );
        assert!(root.join(AGENT_ACCOUNTS_OPENCODE_IDENTITY_FILE).is_file());

        let rotated_auth = json!({
            "opencode-go": {"type": "api", "key": "api-after"},
            "provider-oauth": {
                "type": "oauth",
                "access": "access-after",
                "refresh": "refresh-after"
            }
        });
        let rotated = agent_accounts_opencode_identity_with_first_seen(&rotated_auth, &root);
        assert_eq!(rotated, first);
        assert_eq!(
            [first.clone(), rotated.clone()]
                .into_iter()
                .collect::<HashSet<_>>()
                .len(),
            1,
            "rotating either credential in a mixed set must not create another account"
        );
        assert_eq!(
            tokenomics_opencode_account_key_identifiers_with_stable(&first_auth, Some(&first)),
            tokenomics_opencode_account_key_identifiers_with_stable(
                &rotated_auth,
                Some(&rotated)
            )
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn opencode_no_claim_then_claimed_token_rotation_keeps_one_identity() {
        let root = env::temp_dir().join(format!(
            "agent_accounts_opencode_identity_rotation_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let no_claim = json!({
            "provider-oauth": {
                "type": "oauth",
                "access": "first-access",
                "refresh": "first-refresh"
            }
        });
        let first = agent_accounts_opencode_identity_with_first_seen(&no_claim, &root);
        assert!(first.contains("first-seen"));
        let claimed = json!({
            "provider-oauth": {
                "type": "oauth",
                "access": "rotated-access",
                "refresh": "rotated-refresh",
                "accountId": "provider-account-123"
            }
        });
        assert_ne!(
            agent_accounts_opencode_identity_from_auth(&claimed),
            first,
            "the later direct claim would have forked the account without the sidecar"
        );
        let rotated = agent_accounts_opencode_identity_with_first_seen(&claimed, &root);
        assert_eq!(rotated, first);
        assert_eq!(
            tokenomics_opencode_account_key_identifiers_with_stable(&no_claim, Some(&first)),
            tokenomics_opencode_account_key_identifiers_with_stable(&claimed, Some(&first)),
            "tokenomics must prefer the immutable profile identity over a later direct claim"
        );
        let mixed = json!({
            "opencode-go": {"type": "api", "key": "later-api-key"},
            "provider-oauth": {
                "type": "oauth",
                "access": "rotated-again",
                "refresh": "rotated-again",
                "accountId": "provider-account-456"
            }
        });
        assert_eq!(
            agent_accounts_opencode_identity_with_first_seen(&mixed, &root),
            first,
            "a later API-key entry cannot bypass an existing first-seen sidecar"
        );
        assert!(
            agent_accounts_opencode_identity_with_first_seen(&json!({}), &root).is_empty(),
            "a persisted identity must not make logged-out or empty auth appear ready"
        );
        assert_eq!(
            tokenomics_opencode_account_key_identifiers_with_stable(&mixed, Some(&first)),
            vec![first.clone()]
        );
        let legacy_api = json!({"opencode-go": {"type": "api", "key": "legacy-key"}});
        let legacy_identity = agent_accounts_opencode_identity_from_auth(&legacy_api);
        assert!(legacy_identity.starts_with("opencode-go-"));
        assert_eq!(
            tokenomics_opencode_account_key_identifiers_with_stable(
                &legacy_api,
                Some(&legacy_identity),
            ),
            vec![tokenomics_hash("legacy-key")],
            "API-only profiles retain their historical tokenomics key"
        );
        assert_eq!(
            [first, rotated].into_iter().collect::<HashSet<_>>().len(),
            1,
            "token rotation must still describe exactly one captured account"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    #[ignore]
    fn opencode_first_seen_cross_process_helper() {
        let Ok(root) = env::var("DIFFFORGE_TEST_OPENCODE_IDENTITY_HOME") else {
            return;
        };
        let auth = json!({
            "provider-oauth": {
                "type": "oauth",
                "access": "cross-process-access",
                "refresh": "cross-process-refresh"
            }
        });
        let identity = agent_accounts_opencode_identity_with_first_seen(&auth, Path::new(&root));
        assert!(!identity.is_empty());
    }

    #[test]
    fn opencode_first_seen_identity_is_single_across_backend_processes() {
        let root = env::temp_dir().join(format!(
            "agent_accounts_opencode_cross_process_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let executable = env::current_exe().unwrap();
        let mut children = Vec::new();
        for _ in 0..4 {
            children.push(
                Command::new(&executable)
                    .args([
                        "--ignored",
                        "--exact",
                        "agent_accounts_tests::opencode_first_seen_cross_process_helper",
                    ])
                    .env("DIFFFORGE_TEST_OPENCODE_IDENTITY_HOME", &root)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .unwrap(),
            );
        }
        for mut child in children {
            assert!(child.wait().unwrap().success());
        }
        let identity = agent_accounts_persisted_opencode_identity(
            &root.join(AGENT_ACCOUNTS_OPENCODE_IDENTITY_FILE),
        )
        .expect("one backend must persist the shared first-seen identity");
        let auth = json!({
            "provider-oauth": {"type": "oauth", "access": "next", "refresh": "next"}
        });
        assert_eq!(
            agent_accounts_opencode_identity_with_first_seen(&auth, &root),
            identity
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stale_atomic_credential_temps_are_cleaned_with_a_bounded_prefix() {
        let root = env::temp_dir().join(format!(
            "agent_accounts_stale_temp_cleanup_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        for index in 0..40 {
            fs::write(root.join(format!(".auth.json.tmp-{index}")), b"partial").unwrap();
        }
        let unrelated = root.join(".another.json.tmp-1");
        fs::write(&unrelated, b"keep").unwrap();
        assert_eq!(
            agent_accounts_cleanup_stale_private_file_temps(
                &root,
                "auth.json",
                Duration::ZERO,
            ),
            32
        );
        assert!(unrelated.is_file());
        assert_eq!(
            fs::read_dir(&root)
                .unwrap()
                .flatten()
                .filter(|entry| entry.file_name().to_string_lossy().starts_with(".auth.json.tmp-"))
                .count(),
            8
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn validated_auth_capture_commits_exact_bytes_and_rejects_changed_revision() {
        let root = env::temp_dir().join(format!(
            "agent_accounts_atomic_snapshot_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("auth.json");
        let destination = root.join("profile-auth.json");
        let first =
            test_codex_auth_for_account("same@example.com", "workspace-stable", "refresh-first");
        fs::write(&source, first.as_bytes()).unwrap();
        fs::write(&destination, b"old-destination").unwrap();
        let validated = agent_accounts_read_json_snapshot_with_retry(&source).unwrap();

        let replacement = root.join("auth.replacement.json");
        fs::write(
            &replacement,
            test_codex_auth_for_account("same@example.com", "workspace-stable", "refresh-second"),
        )
        .unwrap();
        fs::rename(&replacement, &source).unwrap();
        assert_eq!(
            agent_accounts_install_validated_auth_snapshot(
                "codex",
                &source,
                &destination,
                "codex-account:workspace-stable",
                &validated,
            ),
            None,
            "a changed source revision must never commit the earlier validation"
        );
        assert_eq!(fs::read(&destination).unwrap(), b"old-destination");

        let current = agent_accounts_read_json_snapshot_with_retry(&source).unwrap();
        assert_eq!(
            agent_accounts_install_validated_auth_snapshot(
                "codex",
                &source,
                &destination,
                "codex-account:workspace-stable",
                &current,
            ),
            Some(true)
        );
        assert_eq!(fs::read(&destination).unwrap(), current.file.bytes);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stable_json_retry_returns_immediately_when_file_is_absent() {
        let missing = env::temp_dir().join(format!(
            "agent_accounts_missing_{}.json",
            uuid::Uuid::new_v4()
        ));
        let started = std::time::Instant::now();
        assert!(agent_accounts_read_json_snapshot_with_retry(&missing).is_none());
        assert!(
            started.elapsed() < Duration::from_millis(80),
            "NotFound must not pay the 500ms torn-write retry budget"
        );
    }

    #[test]
    fn stale_inventory_spans_workspaces_and_preserves_busy_state() {
        let panes = json!({
            "pane-a": { "kind": "codex", "profile_id": "old", "profile_label": "Old", "auth_revision": "r1", "refresh_token": "inventory-must-not-leak" },
            "pane-b": { "kind": "codex", "profile_id": "old", "profile_label": "Old", "auth_revision": "r1" },
            "pane-failed": { "kind": "codex", "profile_id": "old", "profile_label": "Old", "auth_revision": "r1" },
            "pane-closed": { "kind": "codex", "profile_id": "old", "profile_label": "Old", "auth_revision": "r1" },
            "pane-current": { "kind": "codex", "profile_id": "new", "profile_label": "New", "auth_revision": "r2" },
        })
        .as_object()
        .unwrap()
        .clone();
        let active = json!({
            "codex": { "profile_id": "new", "profile_label": "New", "auth_revision": "r2" }
        });
        let live = HashMap::from([
            (
                "pane-a".to_string(),
                json!({ "instance_id": 11, "launch_epoch": "pane-a:11", "workspace_id": "w1", "workspace_label": "Alpha", "terminal_index": 0, "activity": "idle", "open": true, "restart_eligible": true, "access_token": "live-terminal-secret" }),
            ),
            (
                "pane-b".to_string(),
                json!({ "instance_id": 12, "launch_epoch": "pane-b:12", "workspace_id": "w2", "workspace_label": "Beta", "terminal_index": 3, "activity": "needs_input", "open": true, "restart_eligible": false }),
            ),
            (
                "pane-failed".to_string(),
                json!({ "instance_id": 13, "launch_epoch": "pane-failed:13", "workspace_id": "w2", "workspace_label": "Beta", "terminal_index": 4, "activity": "failed", "open": true, "restart_eligible": false }),
            ),
            (
                "pane-closed".to_string(),
                json!({ "instance_id": 14, "launch_epoch": "pane-closed:14", "workspace_id": "w3", "workspace_label": "Closed", "terminal_index": 0, "activity": "closed", "open": false, "restart_eligible": false }),
            ),
        ]);
        let inventory = agent_accounts_build_stale_inventory(&panes, &active, &live);
        assert_eq!(inventory.len(), 3);
        assert_eq!(inventory[0]["workspace_id"], "w1");
        assert_eq!(inventory[0]["terminal_index"], 0);
        assert_eq!(inventory[0]["idle"], true);
        assert_eq!(inventory[0]["needs_restart"], true);
        assert_eq!(inventory[1]["workspace_id"], "w2");
        assert_eq!(inventory[1]["busy"], true);
        assert_eq!(inventory[1]["activity"], "needs_input");
        assert_eq!(inventory[1]["target_profile_id"], "new");
        assert_eq!(inventory[2]["activity"], "failed");
        assert!(!inventory.iter().any(|row| row["workspace_id"] == "w3"));
        let allowed_fields = HashSet::from([
            "kind",
            "provider",
            "workspace_id",
            "workspace_label",
            "pane_id",
            "terminal_index",
            "instance_id",
            "launch_epoch",
            "activity",
            "busy",
            "idle",
            "restart_eligible",
            "restart_intent_seq",
            "restart_intent_pending",
            "restart_intent_state",
            "restart_mode",
            "restart_target_role",
            "restart_coordinator_id",
            "restart_deadline_at_ms",
            "restart_force_action",
            "needs_restart",
            "stamped_profile_id",
            "stamped_profile_label",
            "stamped_auth_revision",
            "target_profile_id",
            "target_profile_label",
            "target_auth_revision",
            "stale_reason",
        ]);
        for row in &inventory {
            let keys = row
                .as_object()
                .expect("inventory rows are objects")
                .keys()
                .map(String::as_str)
                .collect::<HashSet<_>>();
            assert!(
                keys.is_subset(&allowed_fields),
                "stale inventory added a non-contract field: {:?}",
                keys.difference(&allowed_fields).collect::<Vec<_>>()
            );
        }
        let serialized = serde_json::to_string(&inventory).unwrap();
        assert!(!serialized.contains("inventory-must-not-leak"));
        assert!(!serialized.contains("live-terminal-secret"));
        assert!(!serialized.contains("refresh_token"));
        assert!(!serialized.contains("access_token"));
        let provider_accounts = agent_accounts_device_live_state_payload(inventory.clone());
        assert_eq!(
            provider_accounts["stale_terminal_inventory"],
            Value::Array(inventory),
            "the secret-free native inventory is the provider_accounts sync source"
        );
    }

    #[test]
    fn stale_restart_eligibility_is_fail_closed() {
        for phase in [
            "starting",
            "queued",
            "running",
            "compacting",
            "needs_input",
            "failed",
            "offline",
            "unknown",
        ] {
            assert!(
                !agent_accounts_restart_eligible(phase, "open"),
                "{phase} must remain stale"
            );
        }
        for phase in ["idle", "completed", "cancelled", "interrupted"] {
            assert!(agent_accounts_restart_eligible(phase, "open"), "{phase}");
        }
        assert!(!agent_accounts_restart_eligible("idle", "closed"));
    }

    #[test]
    fn opencode_uses_xdg_nested_auth_and_oauth_identity() {
        let root = env::temp_dir().join(format!(
            "agent_accounts_opencode_xdg_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let legacy = json!({
            "provider-oauth": {
                "type": "oauth",
                "access": "access-token",
                "refresh": "stable-refresh",
                "accountId": "account-123",
                "expires": 1234
            }
        });
        fs::write(root.join("auth.json"), serde_json::to_vec(&legacy).unwrap()).unwrap();
        assert!(agent_accounts_migrate_opencode_profile_layout(&root).unwrap());
        assert!(!agent_accounts_migrate_opencode_profile_layout(&root).unwrap());
        assert_eq!(
            agent_accounts_profile_auth_path("opencode", &root),
            root.join("opencode/auth.json")
        );
        let identity = agent_accounts_profile_identity("opencode", Some(&root));
        assert_eq!(identity["auth_ready"], true);
        let identity_id = identity["email"].as_str().unwrap().to_string();
        assert!(identity_id.starts_with("opencode-oauth-provider-oauth-"));
        let refreshed = json!({
            "provider-oauth": {
                "type": "oauth",
                "access": "rotated-access-token",
                "refresh": "rotated-refresh-token",
                "accountId": "account-123",
                "expires": 9999
            }
        });
        assert_eq!(
            agent_accounts_opencode_identity_from_auth(&legacy),
            agent_accounts_opencode_identity_from_auth(&refreshed),
            "rotating OAuth secrets must not split one OpenCode account"
        );
        let command = agent_accounts_login_command("opencode", &root.to_string_lossy());
        assert!(command.starts_with("XDG_DATA_HOME="));
        assert!(!command.contains("OPENCODE_DATA_DIR"));
        let mut env_vars = vec![
            ("OPENCODE_DATA_DIR".to_string(), "legacy".to_string()),
            ("XDG_DATA_HOME".to_string(), "stale".to_string()),
        ];
        agent_accounts_bind_opencode_env(&mut env_vars, &root);
        assert_eq!(
            env_vars,
            vec![(
                "XDG_DATA_HOME".to_string(),
                root.to_string_lossy().to_string()
            )]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn opencode_api_key_identity_preserves_legacy_prefix_and_first_provider_order() {
        let auth = json!({
            "custom-provider": { "type": "api", "key": "first-key" }
        });
        assert_eq!(
            agent_accounts_opencode_identity_from_auth(&auth),
            format!("opencode-go-{}", cloud_mcp_short_hash("first-key"))
        );
        let preferred = json!({
            "z-provider": { "type": "api", "key": "first-key" },
            "opencode-go": { "type": "api", "key": "go-key" }
        });
        assert_eq!(
            agent_accounts_opencode_identity_from_auth(&preferred),
            format!("opencode-go-{}", cloud_mcp_short_hash("go-key"))
        );
    }

    #[test]
    fn windows_managed_login_commands_use_powershell_environment_syntax() {
        let dir = r"C:\Users\O'Brien\Diff Forge\profile";
        assert_eq!(
            agent_accounts_login_command_for_shell("codex", dir, true),
            "$env:CODEX_HOME = 'C:\\Users\\O''Brien\\Diff Forge\\profile'; codex login --device-auth"
        );
        assert_eq!(
            agent_accounts_login_command_for_shell("opencode", dir, true),
            "$env:XDG_DATA_HOME = 'C:\\Users\\O''Brien\\Diff Forge\\profile'; opencode auth login"
        );
        assert_eq!(
            agent_accounts_login_command_for_shell("claude", dir, true),
            "$env:CLAUDE_CONFIG_DIR = 'C:\\Users\\O''Brien\\Diff Forge\\profile'; claude auth login"
        );
    }

    #[test]
    fn codex_file_auth_store_upsert_is_idempotent() {
        let original = "model = \"gpt-5\"\n\n[projects.\"/tmp/repo\"]\ntrust_level = \"trusted\"\n";
        let updated = agent_accounts_upsert_codex_file_auth_store(original);
        assert!(updated.starts_with("model = \"gpt-5\"\n\ncli_auth_credentials_store = \"file\""));
        assert_eq!(
            updated
                .matches("cli_auth_credentials_store = \"file\"")
                .count(),
            1
        );
        assert_eq!(
            agent_accounts_upsert_codex_file_auth_store(&updated),
            updated
        );
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
        let profiles = registry["agents"]["claude"]["profiles"].as_array().unwrap();
        assert_eq!(profiles[0]["label"].as_str(), Some("support"));
        assert_eq!(profiles[1]["label"].as_str(), Some("support-diffforge.ai"));
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
        fs::write(profile_dir.join(".credentials.json"), "support-credentials").unwrap();
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
        fs::write(
            profile_dir.join(".credentials.json"),
            "account-b-credentials",
        )
        .unwrap();
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

        let result =
            agent_accounts_reconcile_captured_claude_identities(&mut registry, "syed@example.test");
        assert!(result.changed());
        let captured_state =
            serde_json::from_slice::<Value>(&fs::read(captured_dir.join(".claude.json")).unwrap())
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

        assert!(
            agent_accounts_prepare_captured_claude_profile_login("cap-support", &captured_dir)
                .unwrap()
        );
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
        let rebound_id =
            agent_accounts_available_capture_profile_id("claude", old_email, &[], &profile_root);
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
        let result = agent_accounts_reconcile_captured_claude_identities(&mut registry, old_email);
        assert!(result.registry_changed);
        agent_accounts_registry_write(&registry).unwrap();
        agent_accounts_clear_profile_login_marker(&rebound_dir);

        assert!(agent_accounts_capture_kind("claude"));
        let captured_registry = agent_accounts_registry_read();
        let (_, profiles) = agent_accounts_kind_entry(&captured_registry, "claude");
        assert_eq!(profiles.len(), 2);
        let rebound = profiles
            .iter()
            .find(|profile| {
                profile.get("email").and_then(Value::as_str) == Some("admin@example.test")
            })
            .unwrap();
        let recaptured = profiles
            .iter()
            .find(|profile| profile.get("email").and_then(Value::as_str) == Some(old_email))
            .unwrap();
        assert_eq!(
            rebound.get("id").and_then(Value::as_str),
            Some(rebound_id.as_str())
        );
        assert_ne!(
            recaptured.get("id").and_then(Value::as_str),
            Some(rebound_id.as_str())
        );
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
                            "identity_id": "codex-account:acct-admin@example.com",
                            "alias": "Admin",
                            "label": "admin",
                            "source": "captured",
                            "dir": duplicate_dir.to_string_lossy().to_string(),
                        },
                        {
                            "id": "cap-work",
                            "email": "work@example.com",
                            "identity_id": "codex-account:acct-work@example.com",
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
        agent_accounts_apply_spawn_env(
            &mut env_vars,
            "pane-test-claude",
            "claude",
            Some("workspace-a"),
            Some("Workspace A"),
            Some(2),
        );
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
        agent_accounts_apply_spawn_env(
            &mut env_vars,
            "pane-test-unsupported",
            "generic",
            None,
            None,
            None,
        );
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
        agent_accounts_apply_spawn_env(&mut env_vars, "pane-test-codex", "codex", None, None, None);
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
    fn agent_account_push_accepts_legacy_camel_case_device_and_status_payloads() {
        let device = json!({
            "nativeDeviceId": "Device-B",
            "clientType": "desktop",
            "connectionStatus": "online",
            "connected": true,
            "device": {
                "pushPublicKey": "legacy-public-key",
                "pushCapable": true,
                "pushKeyAlgorithm": AGENT_ACCOUNT_PUSH_SEALED_ALGORITHM
            }
        });
        assert!(agent_account_push_device_matches_id(&device, "device-b"));
        assert!(agent_account_push_device_online(&device));
        assert_eq!(
            agent_account_push_target_key(&device).unwrap(),
            (
                "legacy-public-key".to_string(),
                AGENT_ACCOUNT_PUSH_SEALED_ALGORITHM.to_string()
            )
        );

        let event = json!({
            "eventKind": "remote_command_ack",
            "commandKind": "agent_account_push",
            "commandId": "agent-account-push-push-legacy",
            "pushId": "push-legacy",
            "status": "accepted",
            "device": { "deviceId": "Device-B" }
        });
        let pending = AgentAccountPushPending {
            agent_kind: "codex".to_string(),
            profile_id: "default".to_string(),
            target_device_id: "device-b".to_string(),
            wipe_local_after: false,
            identity_email: String::new(),
            delivered: false,
            created_at_ms: todo_dispatch_now_ms(),
            expires_at_ms: todo_dispatch_now_ms().saturating_add(AGENT_ACCOUNT_PUSH_BLOB_TTL_MS),
            ack_nonce_b64: String::new(),
            target_push_public_key_b64: String::new(),
            source_credentials_sha256: String::new(),
        };
        assert_eq!(
            agent_account_push_status_push_id(&event).as_deref(),
            Some("push-legacy")
        );
        assert_eq!(
            agent_account_push_status_reporting_device_id(&event).as_deref(),
            Some("Device-B")
        );
        assert!(agent_account_push_status_matches_pending(
            &event,
            "push-legacy",
            &pending
        ));
        assert!(agent_account_push_handle_remote_status_inner(None, &event));
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
        let local_device_id = cloud_mcp_payload_text(&local_device, &["device_id"]).unwrap();
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
        let payload =
            agent_account_push_ack_payload("push-stale", &nonce_b64, &local_device_id, "device-b")
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
        let local_device_id = cloud_mcp_payload_text(&local_device, &["device_id"]).unwrap();
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

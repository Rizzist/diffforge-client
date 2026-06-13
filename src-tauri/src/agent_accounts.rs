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

static AGENT_ACCOUNTS_PANE_PROFILES: OnceLock<StdMutex<HashMap<String, Value>>> = OnceLock::new();

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
    None
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
            let credentials_present = dir
                .map(|dir| dir.join(".credentials.json").is_file())
                .unwrap_or_else(|| {
                    agent_accounts_default_home("claude")
                        .map(|home| home.join(".credentials.json").is_file())
                        .unwrap_or(false)
                });
            let auth_ready = !email.is_empty() || credentials_present;
            json!({ "email": email, "authReady": auth_ready })
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

/// A captured pin that shows the exact account the Default pill currently
/// holds is pure noise — one account must never render as two pills. It is
/// hidden (not deleted: its snapshot keeps refreshing) and reappears the
/// moment the default home moves to a different login. The active profile is
/// never hidden.
fn agent_accounts_profile_is_duplicate_of_default(
    kind: &str,
    profile: &Value,
    active_id: &str,
    default_email: &str,
) -> bool {
    if default_email.is_empty() {
        return false;
    }
    if profile.get("source").and_then(Value::as_str) != Some("captured") {
        return false;
    }
    let id = profile
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if id == active_id {
        return false;
    }
    agent_accounts_profile_email(kind, profile) == default_email
}

fn agent_accounts_default_email(kind: &str) -> String {
    agent_accounts_profile_identity(kind, None)
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default()
}

/// Ids of captured profiles currently suppressed as duplicates of the
/// Default login. Tokenomics retracts the per-profile account keys it may
/// have published for these before the dedupe existed, so one login stops
/// rendering as two usage accounts (desktop Tokenomics tab and the cloud
/// dashboard alike).
pub(crate) fn agent_accounts_duplicate_profile_ids(kind: &str) -> Vec<String> {
    let registry = agent_accounts_registry_read();
    let (active_id, profiles) = agent_accounts_kind_entry(&registry, kind);
    let default_email = agent_accounts_default_email(kind);
    profiles
        .iter()
        .filter(|profile| {
            agent_accounts_profile_is_duplicate_of_default(
                kind,
                profile,
                &active_id,
                &default_email,
            )
        })
        .filter_map(|profile| {
            profile
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect()
}

fn agent_accounts_kind_state(registry: &Value, kind: &str) -> Value {
    let (active_id, profiles) = agent_accounts_kind_entry(registry, kind);
    let default_identity = agent_accounts_profile_identity(kind, None);
    let default_email = default_identity
        .get("email")
        .and_then(Value::as_str)
        .map(agent_accounts_email_key)
        .unwrap_or_default();
    let default_alias = registry
        .get("agents")
        .and_then(|agents| agents.get(kind))
        .and_then(|entry| entry.get("defaultAlias"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut views = vec![json!({
        "id": AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
        "label": "Default",
        "alias": default_alias,
        "dir": agent_accounts_default_home(kind)
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        "createdAtMs": 0,
        "identity": default_identity,
        "isDefault": true,
        "isActive": active_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
        "loginCommand": "",
    })];
    for profile in &profiles {
        if agent_accounts_profile_is_duplicate_of_default(kind, profile, &active_id, &default_email)
        {
            continue;
        }
        views.push(agent_accounts_profile_view(kind, profile, &active_id));
    }
    json!({ "activeProfileId": active_id, "profiles": views })
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
    profiles
        .iter()
        .filter_map(|profile| {
            // Same rule as the switcher pills: a captured pin that mirrors
            // the Default home's current login must not feed a second
            // tokenomics account (transcript roots, limit probes) for the
            // same human account.
            if agent_accounts_profile_is_duplicate_of_default(
                kind,
                profile,
                &active_id,
                &default_email,
            ) {
                return None;
            }
            let id = profile
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())?
                .to_string();
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
        _ => {
            agent_accounts_copy_if_newer(&default_home.join("auth.json"), &dir.join("auth.json"));
            let config_destination = dir.join("config.toml");
            if !config_destination.exists() {
                let _ = fs::copy(default_home.join("config.toml"), &config_destination);
            }
        }
    }
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
        .spawn(move || loop {
            for kind in ["claude", "codex"] {
                if agent_accounts_capture_kind(kind) {
                    let _ = app.emit(
                        AGENT_ACCOUNTS_CHANGED_EVENT,
                        json!({ "kind": kind, "captured": true }),
                    );
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(4));
        });
}

#[tauri::command]
async fn agent_accounts_state() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let registry = agent_accounts_registry_read();
        Ok(json!({
            "agents": {
                "claude": agent_accounts_kind_state(&registry, "claude"),
                "codex": agent_accounts_kind_state(&registry, "codex"),
            }
        }))
    })
    .await
    .map_err(|error| format!("Agent accounts state worker failed: {error}"))?
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
        let known = profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID
            || profiles.iter().any(|profile| {
                profile
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    == profile_id
            });
        if !known {
            return Err(format!("Unknown {kind} account profile: {profile_id}"));
        }
        if !registry.get("agents").is_some_and(Value::is_object) {
            registry["agents"] = json!({});
        }
        if !registry["agents"].get(kind).is_some_and(Value::is_object) {
            registry["agents"][kind] = json!({ "profiles": [] });
        }
        registry["agents"][kind]["activeProfileId"] = json!(profile_id);
        agent_accounts_registry_write(&registry);
        let _ = app.emit(
            AGENT_ACCOUNTS_CHANGED_EVENT,
            json!({ "kind": kind, "activeProfileId": profile_id }),
        );
        Ok(json!({ "ok": true, "kind": kind, "activeProfileId": profile_id }))
    })
    .await
    .map_err(|error| format!("Agent accounts set-active worker failed: {error}"))?
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
    Ok(json!({
        "panes": panes,
        "active": {
            "claude": { "profileId": claude_active, "profileLabel": claude_label },
            "codex": { "profileId": codex_active, "profileLabel": codex_label },
        }
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

    #[test]
    fn supported_kind_normalizes_provider_ids() {
        assert_eq!(agent_accounts_supported_kind("claude"), Some("claude"));
        assert_eq!(agent_accounts_supported_kind("Claude Code"), Some("claude"));
        assert_eq!(agent_accounts_supported_kind("codex"), Some("codex"));
        assert_eq!(agent_accounts_supported_kind("console"), Some("codex"));
        assert_eq!(agent_accounts_supported_kind("opencode"), None);
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
    fn captured_duplicate_of_default_is_hidden_unless_active() {
        let captured = json!({
            "id": "cap-x",
            "email": "dev@example.com",
            "source": "captured",
            "dir": "/nonexistent-dir",
        });
        assert!(agent_accounts_profile_is_duplicate_of_default(
            "codex",
            &captured,
            "default",
            "dev@example.com"
        ));
        // The active profile always renders, even as a duplicate.
        assert!(!agent_accounts_profile_is_duplicate_of_default(
            "codex",
            &captured,
            "cap-x",
            "dev@example.com"
        ));
        // A different default identity un-hides the pin.
        assert!(!agent_accounts_profile_is_duplicate_of_default(
            "codex",
            &captured,
            "default",
            "other@example.com"
        ));
        // Manual profiles are never deduped away.
        let manual = json!({ "id": "m1", "email": "dev@example.com", "dir": "/nonexistent-dir" });
        assert!(!agent_accounts_profile_is_duplicate_of_default(
            "codex",
            &manual,
            "default",
            "dev@example.com"
        ));
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
}

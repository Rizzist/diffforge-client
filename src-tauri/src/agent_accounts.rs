// Agent account profiles: manual multi-account switching for the coding
// agent CLIs (Claude Code, Codex).
//
// A profile is a pointer to an isolated CLI home directory — Diff Forge never
// stores or touches credentials; the CLI's own login flow writes them into
// the profile dir (or the macOS Keychain entry derived from that dir's path,
// which is why profile dirs must never move once created). The registry holds
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
        "dir": dir,
        "createdAtMs": profile.get("createdAtMs").and_then(Value::as_u64).unwrap_or(0),
        "identity": identity,
        "isDefault": false,
        "isActive": id == active_id,
        "loginCommand": agent_accounts_login_command(kind, &dir),
    })
}

fn agent_accounts_kind_state(registry: &Value, kind: &str) -> Value {
    let (active_id, profiles) = agent_accounts_kind_entry(registry, kind);
    let default_identity = agent_accounts_profile_identity(kind, None);
    let mut views = vec![json!({
        "id": AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
        "label": "Default",
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
        let id = profile.get("id").and_then(Value::as_str).unwrap_or_default();
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

fn agent_accounts_active_profile_label(kind: &str) -> (String, String) {
    let registry = agent_accounts_registry_read();
    let (active_id, profiles) = agent_accounts_kind_entry(&registry, kind);
    if active_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        return (active_id, "Default".to_string());
    }
    let label = profiles
        .iter()
        .find(|profile| {
            profile.get("id").and_then(Value::as_str).unwrap_or_default() == active_id
        })
        .and_then(|profile| profile.get("label").and_then(Value::as_str))
        .unwrap_or("Account")
        .to_string();
    (active_id, label)
}

/// All registered profiles of one kind with existing dirs, for tokenomics:
/// Claude profiles contribute transcript scan roots (`<dir>/projects`), Codex
/// profiles contribute per-account auth for the live usage endpoint — each
/// attributed to its own account key.
pub(crate) fn agent_accounts_profiles_for_tokenomics(
    kind: &str,
) -> Vec<(String, String, PathBuf)> {
    let registry = agent_accounts_registry_read();
    let (_, profiles) = agent_accounts_kind_entry(&registry, kind);
    profiles
        .iter()
        .filter_map(|profile| {
            let id = profile
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())?
                .to_string();
            let label = profile
                .get("label")
                .and_then(Value::as_str)
                .unwrap_or("Account")
                .to_string();
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
    let (active_id, active_label) = agent_accounts_active_profile_label(kind);
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
    let Some(dir) = agent_accounts_active_profile_dir(kind) else {
        return;
    };
    match kind {
        "claude" => {
            env_vars.retain(|(key, _)| key != "CLAUDE_CONFIG_DIR");
            env_vars.push(("CLAUDE_CONFIG_DIR".to_string(), dir));
        }
        _ => {
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

#[tauri::command]
async fn agent_accounts_add(
    app: AppHandle,
    agent_kind: String,
    label: String,
) -> Result<Value, String> {
    let kind = agent_accounts_supported_kind(&agent_kind)
        .ok_or_else(|| format!("Unsupported agent kind for accounts: {agent_kind}"))?;
    let label = label.trim().to_string();
    if label.is_empty() {
        return Err("A profile label is required.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let slug = label
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
            .take(40)
            .collect::<String>();
        let profile_id = format!(
            "{}-{}",
            if slug.is_empty() { "account" } else { &slug },
            cloud_mcp_short_hash(&format!("{kind}:{label}:{}", todo_dispatch_now_ms()))
        );
        let dir = cloud_mcp_local_data_file_path(AGENT_ACCOUNTS_PROFILE_DIR)
            .map(|root| root.join(kind).join(&profile_id))
            .ok_or_else(|| "Agent profile storage is unavailable.".to_string())?;
        fs::create_dir_all(&dir)
            .map_err(|error| format!("Unable to create agent profile directory: {error}"))?;

        // Seed CLI config from the default account so hooks and preferences
        // carry over; credentials never copy — the user logs in once.
        if let Some(default_home) = agent_accounts_default_home(kind) {
            let seed_file = match kind {
                "claude" => "settings.json",
                _ => "config.toml",
            };
            let source = default_home.join(seed_file);
            let destination = dir.join(seed_file);
            if source.is_file() && !destination.exists() {
                let _ = fs::copy(&source, &destination);
            }
        }

        let mut registry = agent_accounts_registry_read();
        if !registry.get("agents").is_some_and(Value::is_object) {
            registry["agents"] = json!({});
        }
        if !registry["agents"].get(kind).is_some_and(Value::is_object) {
            registry["agents"][kind] = json!({
                "activeProfileId": AGENT_ACCOUNTS_DEFAULT_PROFILE_ID,
                "profiles": [],
            });
        }
        let dir_text = dir.to_string_lossy().to_string();
        let profile = json!({
            "id": profile_id,
            "label": label,
            "dir": dir_text,
            "createdAtMs": todo_dispatch_now_ms(),
        });
        registry["agents"][kind]["profiles"]
            .as_array_mut()
            .map(|profiles| profiles.push(profile.clone()));
        agent_accounts_registry_write(&registry);
        let _ = app.emit(AGENT_ACCOUNTS_CHANGED_EVENT, json!({ "kind": kind }));
        Ok(json!({
            "profile": agent_accounts_profile_view(kind, &profile, ""),
            "loginCommand": agent_accounts_login_command(kind, &dir_text),
        }))
    })
    .await
    .map_err(|error| format!("Agent accounts add worker failed: {error}"))?
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
                profile.get("id").and_then(Value::as_str).unwrap_or_default() == profile_id
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
        let (active_id, _) = agent_accounts_kind_entry(&registry, kind);
        if let Some(profiles) = registry
            .get_mut("agents")
            .and_then(|agents| agents.get_mut(kind))
            .and_then(|entry| entry.get_mut("profiles"))
            .and_then(Value::as_array_mut)
        {
            // The profile dir (and its credentials) is kept on disk so a
            // re-added account doesn't need a fresh login; only the registry
            // entry goes away.
            profiles.retain(|profile| {
                profile.get("id").and_then(Value::as_str).unwrap_or_default() != profile_id
            });
        }
        if active_id == profile_id {
            registry["agents"][kind]["activeProfileId"] =
                json!(AGENT_ACCOUNTS_DEFAULT_PROFILE_ID);
        }
        agent_accounts_registry_write(&registry);
        let _ = app.emit(AGENT_ACCOUNTS_CHANGED_EVENT, json!({ "kind": kind }));
        Ok(json!({ "ok": true }))
    })
    .await
    .map_err(|error| format!("Agent accounts remove worker failed: {error}"))?
}

/// Pane → profile stamps plus the current active ids, for the webview's
/// stale-terminal chips ("account switched — restart to use X").
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
    let (claude_active, claude_label) = agent_accounts_active_profile_label("claude");
    let (codex_active, codex_label) = agent_accounts_active_profile_label("codex");
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
        let claims = general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&json!({ "email": "dev@example.com" })).unwrap());
        let auth = json!({ "tokens": { "id_token": format!("h.{claims}.s") } });
        assert_eq!(agent_accounts_codex_email_from_auth(&auth), "dev@example.com");
        assert_eq!(agent_accounts_codex_email_from_auth(&json!({})), "");
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

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
    let canonical_ids =
        agent_accounts_canonical_profile_ids_by_email(kind, &profiles, &active_id, &default_email);
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
    if active_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
        return AGENT_ACCOUNTS_DEFAULT_PROFILE_ID.to_string();
    }

    let default_email = agent_accounts_default_email(kind);
    if profiles.iter().any(|profile| {
        agent_accounts_profile_id(profile).as_deref() == Some(active_id.as_str())
            && agent_accounts_profile_is_duplicate_of_default(kind, profile, &default_email)
    }) {
        return AGENT_ACCOUNTS_DEFAULT_PROFILE_ID.to_string();
    }

    let canonical_ids =
        agent_accounts_canonical_profile_ids_by_email(kind, &profiles, &active_id, &default_email);
    if canonical_ids.contains(&active_id) {
        active_id
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
    let canonical_ids =
        agent_accounts_canonical_profile_ids_by_email(kind, &profiles, &active_id, &default_email);
    let active_duplicates_default = profiles.iter().any(|profile| {
        agent_accounts_profile_id(profile).as_deref() == Some(active_id.as_str())
            && agent_accounts_profile_is_duplicate_of_default(kind, profile, &default_email)
    });
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
        "isActive": active_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID || active_duplicates_default,
        "loginCommand": "",
    })];
    for profile in &profiles {
        let Some(id) = agent_accounts_profile_id(profile) else {
            continue;
        };
        if !canonical_ids.contains(&id) {
            continue;
        }
        views.push(agent_accounts_profile_view(kind, profile, &active_id));
    }
    json!({ "activeProfileId": active_id, "profiles": views })
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
    let canonical_ids =
        agent_accounts_canonical_profile_ids_by_email(kind, &profiles, &active_id, &default_email);
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
    let (active_id, profiles) = agent_accounts_kind_entry(&registry, kind);
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
        if agent_accounts_profile_id(&existing).as_deref() == Some(active_id.as_str()) {
            agent_accounts_ensure_kind_entry(&mut registry, kind);
            registry["agents"][kind]["activeProfileId"] = json!(AGENT_ACCOUNTS_DEFAULT_PROFILE_ID);
            registry_changed = true;
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
            let capture_all = || {
                let _span = BackendCpuSpan::new("agent_accounts.capture_all");
                for kind in ["claude", "codex"] {
                    if agent_accounts_capture_kind(kind) {
                        let _ = app.emit(
                            AGENT_ACCOUNTS_CHANGED_EVENT,
                            json!({ "kind": kind, "captured": true }),
                        );
                    }
                }
            };

            // Capture whatever is already on disk once at startup.
            capture_all();

            // Event-driven instead of a fixed poll: watch the CLI auth dirs and
            // re-capture only when their files actually change (login / logout /
            // token refresh). At idle this thread makes ~zero CPU wake-ups; the
            // old 4s poll was 15 wakes/min forever. `capture_all` still only
            // emits when the credential signature changed, and a 5-min backstop
            // covers missed events or dirs that didn't exist at startup.
            let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
            let mut watcher = notify::recommended_watcher(tx).ok();
            if let Some(watcher) = watcher.as_mut() {
                for kind in ["claude", "codex"] {
                    if let Some(dir) = agent_accounts_default_home(kind) {
                        let _ = notify::Watcher::watch(
                            watcher,
                            &dir,
                            notify::RecursiveMode::NonRecursive,
                        );
                    }
                }
            }

            loop {
                match rx.recv_timeout(std::time::Duration::from_secs(300)) {
                    Ok(_) => {
                        // A login writes several files in a burst; drain the
                        // burst (quiet for 400ms) and capture once.
                        while rx
                            .recv_timeout(std::time::Duration::from_millis(400))
                            .is_ok()
                        {}
                        capture_all();
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => capture_all(),
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        // Watcher unavailable: degrade to a slow safety poll.
                        std::thread::sleep(std::time::Duration::from_secs(300));
                        capture_all();
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
    if is_default {
        let provider = if kind == "claude" {
            AgentProvider::Claude
        } else {
            AgentProvider::Codex
        };
        return launch_account_login_terminal(provider);
    }

    let provider = if kind == "claude" {
        AgentProvider::Claude
    } else {
        AgentProvider::Codex
    };
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
        _ => (
            vec!["login"],
            vec![("CODEX_HOME".to_string(), dir_text)],
        ),
    };
    run_login_terminal_with_env(definition.label, &binary, &args, &env_vars)
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
        let selected_profile = if profile_id == AGENT_ACCOUNTS_DEFAULT_PROFILE_ID {
            None
        } else {
            Some(
                profiles
                    .iter()
                    .find(|profile| {
                        profile
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            == profile_id
                    })
                    .cloned()
                    .ok_or_else(|| format!("Unknown {kind} account profile: {profile_id}"))?,
            )
        };
        let active_profile_id = selected_profile
            .as_ref()
            .filter(|profile| {
                let default_email = agent_accounts_default_email(kind);
                agent_accounts_profile_is_duplicate_of_default(kind, profile, &default_email)
            })
            .map(|_| AGENT_ACCOUNTS_DEFAULT_PROFILE_ID.to_string())
            .unwrap_or_else(|| profile_id.clone());
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
    let auth = json!({
        "claude": agent_accounts_kind_auth_statuses(&registry, "claude"),
        "codex": agent_accounts_kind_auth_statuses(&registry, "codex"),
    });
    Ok(json!({
        "panes": panes,
        "active": {
            "claude": { "profileId": claude_active, "profileLabel": claude_label },
            "codex": { "profileId": codex_active, "profileLabel": codex_label },
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
    fn active_duplicate_email_maps_to_default_for_state_and_tokenomics() {
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
        assert_eq!(visible_ids, vec!["default", "cap-work"]);
        assert_eq!(profiles[0]["isActive"].as_bool(), Some(true));
        assert_eq!(profiles[0]["alias"].as_str(), Some("Admin"));
        assert_eq!(
            agent_accounts_duplicate_profile_ids("codex"),
            vec!["cap-admin".to_string()]
        );
        let tokenomics_ids = agent_accounts_profiles_for_tokenomics("codex")
            .into_iter()
            .map(|(id, _, _)| id)
            .collect::<Vec<_>>();
        assert_eq!(tokenomics_ids, vec!["cap-work".to_string()]);

        assert!(agent_accounts_capture_kind("codex"));
        let registry_after = agent_accounts_registry_read();
        assert_eq!(
            registry_after["agents"]["codex"]["activeProfileId"].as_str(),
            Some(AGENT_ACCOUNTS_DEFAULT_PROFILE_ID)
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
}

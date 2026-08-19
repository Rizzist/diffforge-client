fn parse_agent_provider(provider: &str) -> Result<AgentProvider, String> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "codex" => Ok(AgentProvider::Codex),
        "claude" | "claude-code" | "claude_code" => Ok(AgentProvider::Claude),
        "opencode" | "open-code" | "open_code" => Ok(AgentProvider::OpenCode),
        "haider" => Ok(AgentProvider::Haider),
        _ => Err("Unknown terminal provider.".to_string()),
    }
}

fn agent_definition(provider: AgentProvider) -> AgentDefinition {
    match provider {
        AgentProvider::Codex => AgentDefinition {
            id: "codex",
            label: "Codex",
            binary: "codex",
            install_package: "@openai/codex",
            install_command: "npm install -g @openai/codex",
            native_install_url: "https://github.com/openai/codex/releases/latest",
            native_install_label: "GitHub release binaries",
            connect_command: "codex login --device-auth",
        },
        AgentProvider::Claude => AgentDefinition {
            id: "claude",
            label: "Claude Code",
            binary: "claude",
            install_package: "@anthropic-ai/claude-code",
            install_command: "npm install -g @anthropic-ai/claude-code",
            native_install_url: "https://code.claude.com/docs/en/quickstart",
            native_install_label: "Native install guide",
            connect_command: "claude",
        },
        AgentProvider::OpenCode => AgentDefinition {
            id: "opencode",
            label: "OpenCode",
            binary: "opencode",
            install_package: "opencode-ai",
            install_command: "npm install -g opencode-ai",
            native_install_url: "https://opencode.ai/docs/",
            native_install_label: "Install script / package guide",
            connect_command: "opencode auth login",
        },
        AgentProvider::Haider => AgentDefinition {
            id: "haider",
            label: "Haider",
            binary: "haider",
            install_package: "",
            install_command: "",
            native_install_url: "",
            native_install_label: "GitHub release binaries",
            connect_command: "haider tui",
        },
    }
}

fn ensure_npm_managed_agent_provider(provider: AgentProvider) -> Result<(), String> {
    if matches!(provider, AgentProvider::Haider) {
        Err("Haider is installed from GitHub releases and is not managed by npm.".to_string())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn npm_binary() -> &'static str {
    "npm.cmd"
}

#[cfg(not(windows))]
fn npm_binary() -> &'static str {
    "npm"
}

fn command_output_text(stdout: &str, stderr: &str) -> String {
    let combined = format!("{}\n{}", stdout.trim(), stderr.trim());
    combined.trim().to_string()
}

fn first_output_line(output: &str) -> String {
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("")
        .to_string()
}

fn looks_like_permission_error(output: &str) -> bool {
    let output = output.to_ascii_lowercase();

    [
        "eacces",
        "eperm",
        "permission denied",
        "access is denied",
        "operation not permitted",
        "requires elevation",
        "administrator",
    ]
    .iter()
        .any(|needle| output.contains(needle))
}

const AGENT_INSTALL_STDERR_LIMIT: usize = 2_048;

fn bounded_agent_install_stderr(stderr: &str) -> String {
    stderr
        .trim()
        .chars()
        .take(AGENT_INSTALL_STDERR_LIMIT)
        .collect()
}

fn elevated_launch_was_cancelled(error_code: u32) -> bool {
    // ERROR_CANCELLED: the user dismissed or rejected the Windows UAC prompt.
    error_code == 1_223
}

#[cfg(test)]
#[test]
fn issue_17_agent_install_failure_is_structured_and_stderr_is_bounded() {
    let definition = agent_definition(AgentProvider::Codex);
    let stderr = format!("npm ERR! code EACCES {}", "x".repeat(AGENT_INSTALL_STDERR_LIMIT * 2));
    let result = failed_agent_install_result(
        definition,
        &stderr,
        &stderr,
        "npm failed",
        "update",
        "installing",
        Some(1),
        "npm_failed",
    );
    assert!(!result.ok);
    assert!(result.permission_denied);
    assert_eq!(result.error_kind.as_deref(), Some("permission_denied"));
    assert_eq!(result.failed_stage.as_deref(), Some("installing"));
    assert_eq!(result.exit_code, Some(1));
    assert!(result.stderr.chars().count() <= AGENT_INSTALL_STDERR_LIMIT);
    assert!(result.installed_version.is_empty());
}

#[cfg(test)]
#[test]
fn issue_17_windows_uac_cancel_code_is_classified() {
    assert!(elevated_launch_was_cancelled(1_223));
    assert!(!elevated_launch_was_cancelled(5));
    assert!(elevated_agent_update_helper_output_path("0123456789abcdef0123456789abcdef").is_some());
    assert!(elevated_agent_update_helper_output_path("../../arbitrary-file").is_none());
    let result = failed_elevated_agent_update_result(
        agent_definition(AgentProvider::Codex),
        "Administrator approval was cancelled; the update was not run.",
        "Administrator approval was cancelled; the update was not run.",
        "installing",
        None,
        "elevation_cancelled",
    );
    assert!(!result.ok);
    assert!(!result.permission_denied);
    assert_eq!(result.error_kind.as_deref(), Some("elevation_cancelled"));
    assert!(result.message.contains("cancelled"));
}

fn failed_agent_install_result(
    definition: AgentDefinition,
    output: &str,
    stderr: &str,
    fallback_message: &str,
    operation: &str,
    failed_stage: &str,
    exit_code: Option<i32>,
    fallback_error_kind: &str,
) -> AgentInstallResult {
    let permission_denied = looks_like_permission_error(output);
    let first_line = first_output_line(output);
    let detail = if first_line.is_empty() {
        fallback_message.to_string()
    } else {
        first_line
    };

    AgentInstallResult {
        provider: definition.id,
        label: definition.label,
        ok: false,
        installed: false,
        updated: false,
        permission_denied,
        error_kind: Some(if permission_denied {
            "permission_denied".to_string()
        } else {
            fallback_error_kind.to_string()
        }),
        failed_stage: Some(failed_stage.to_string()),
        exit_code,
        stderr: bounded_agent_install_stderr(stderr),
        installed_version: String::new(),
        command: definition.install_command,
        native_install_url: definition.native_install_url,
        message: if permission_denied {
            format!(
                "{} {operation} was blocked by npm permissions. Close running {} terminals, then retry as administrator or move npm global packages to a user-writable prefix.",
                definition.label, definition.label
            )
        } else {
            format!("{} {operation} failed: {detail}", definition.label)
        },
    }
}

fn npm_version() -> Option<String> {
    let capture = run_command_capture(
        npm_binary(),
        &["--version"],
        None,
        Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
        None,
    )
    .ok()?;

    if capture.exit_code != Some(0) {
        return None;
    }

    let version = first_output_line(&command_output_text(&capture.stdout, &capture.stderr));

    Some(if version.is_empty() {
        "Detected".to_string()
    } else {
        version
    })
}

fn npm_global_package_version(definition: AgentDefinition) -> Option<String> {
    let capture = run_command_capture(
        npm_binary(),
        &[
            "list",
            "-g",
            definition.install_package,
            "--depth=0",
            "--json",
        ],
        None,
        Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
        None,
    )
    .ok()?;

    if capture.exit_code != Some(0) {
        return None;
    }

    let value = serde_json::from_str::<Value>(&capture.stdout).ok()?;
    let version = value
        .get("dependencies")
        .and_then(|dependencies| dependencies.get(definition.install_package))
        .and_then(|package| package.get("version"))
        .and_then(Value::as_str)
        .unwrap_or("Detected")
        .to_string();

    Some(version)
}

fn npm_latest_package_version(definition: AgentDefinition) -> Option<String> {
    let capture = run_command_capture(
        npm_binary(),
        &["view", definition.install_package, "version", "--json"],
        None,
        Duration::from_secs(AGENT_UPDATE_CHECK_TIMEOUT_SECS),
        None,
    )
    .ok()?;

    if capture.exit_code != Some(0) {
        return None;
    }

    if let Ok(value) = serde_json::from_str::<Value>(&capture.stdout) {
        if let Some(version) = value.as_str() {
            let version = version.trim();

            if !version.is_empty() {
                return Some(version.to_string());
            }
        }
    }

    let version = first_output_line(&capture.stdout)
        .trim_matches('"')
        .trim()
        .to_string();

    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

fn version_number_segments(version: &str) -> Vec<u64> {
    version
        .trim()
        .trim_start_matches('v')
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .take(3)
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

fn is_npm_version_newer(latest_version: &str, current_version: &str) -> bool {
    let latest_segments = version_number_segments(latest_version);
    let current_segments = version_number_segments(current_version);

    if latest_segments.is_empty() || current_segments.is_empty() {
        return false;
    }

    let segment_count = latest_segments.len().max(current_segments.len());

    for index in 0..segment_count {
        let latest = *latest_segments.get(index).unwrap_or(&0);
        let current = *current_segments.get(index).unwrap_or(&0);

        if latest > current {
            return true;
        }

        if latest < current {
            return false;
        }
    }

    false
}

fn spawn_npm_package_version_check(
    definition: AgentDefinition,
) -> thread::JoinHandle<Option<String>> {
    thread::spawn(move || {
        let package_version = npm_global_package_version(definition);
        package_version
    })
}

fn spawn_npm_latest_package_version_check(
    definition: AgentDefinition,
) -> thread::JoinHandle<Option<String>> {
    thread::spawn(move || {
        let latest_version = npm_latest_package_version(definition);
        latest_version
    })
}

fn resolve_npm_package_version(
    package_version_handle: thread::JoinHandle<Option<String>>,
    latest_version_handle: thread::JoinHandle<Option<String>>,
) -> (bool, String, String, bool) {
    let package_version = package_version_handle.join().ok().flatten();
    let latest_version = latest_version_handle.join().ok().flatten();
    let npm_installed = package_version.is_some();
    let npm_update_available = package_version
        .as_deref()
        .zip(latest_version.as_deref())
        .map(|(current_version, latest_version)| {
            is_npm_version_newer(latest_version, current_version)
        })
        .unwrap_or(false);
    let npm_package_version =
        package_version.unwrap_or_else(|| "Not installed with npm".to_string());
    let npm_latest_version = latest_version.unwrap_or_else(|| "Not checked".to_string());

    (
        npm_installed,
        npm_package_version,
        npm_latest_version,
        npm_update_available,
    )
}

fn agent_auth_status_for(provider: AgentProvider, definition: AgentDefinition) -> (bool, String) {
    match provider {
        AgentProvider::Codex => {
            let status = run_agent_command_capture(
                definition,
                &["login", "status"],
                None,
                Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
                None,
            );

            match status {
                Ok(capture) if capture.exit_code == Some(0) => (
                    true,
                    first_output_line(&command_output_text(&capture.stdout, &capture.stderr)),
                ),
                Ok(capture) => {
                    let message =
                        first_output_line(&command_output_text(&capture.stdout, &capture.stderr));
                    (
                        false,
                        if message.is_empty() {
                            "Run codex login to connect.".to_string()
                        } else {
                            message
                        },
                    )
                }
                Err(error) => (false, error),
            }
        }
        AgentProvider::Claude => {
            if claude_credentials_detected() {
                (true, "Claude credentials detected locally.".to_string())
            } else {
                (
                    false,
                    "Run claude to complete the official Claude Code login.".to_string(),
                )
            }
        }
        AgentProvider::OpenCode => {
            let status = run_agent_command_capture(
                definition,
                &["auth", "list"],
                None,
                Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
                None,
            );

            match status {
                Ok(capture) if capture.exit_code == Some(0) => {
                    let output = command_output_text(&capture.stdout, &capture.stderr);
                    if opencode_auth_list_has_credentials(&output) {
                        (true, "OpenCode providers detected locally.".to_string())
                    } else {
                        (
                            false,
                            "Run opencode auth login to connect a provider.".to_string(),
                        )
                    }
                }
                Ok(capture) => {
                    let message =
                        first_output_line(&command_output_text(&capture.stdout, &capture.stderr));
                    (
                        false,
                        if message.is_empty() {
                            "Run opencode auth login to connect a provider.".to_string()
                        } else {
                            message
                        },
                    )
                }
                Err(error) => (false, error),
            }
        }
        AgentProvider::Haider => (
            false,
            "Haider authentication is managed by its local daemon.".to_string(),
        ),
    }
}

fn opencode_auth_list_has_credentials(output: &str) -> bool {
    let trimmed = output.trim();

    if trimmed.is_empty() {
        return false;
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("no authenticated")
        || lower.contains("no credentials")
        || lower.contains("not logged")
        || lower.contains("not authenticated")
    {
        return false;
    }

    trimmed.lines().any(|line| {
        let line = line.trim();
        !line.is_empty()
            && !line.eq_ignore_ascii_case("provider")
            && !line.starts_with("---")
            && !line.starts_with("===")
    })
}

fn npm_global_prefix() -> Option<PathBuf> {
    let capture = run_command_capture(
        npm_binary(),
        &["prefix", "-g"],
        None,
        Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
        None,
    )
    .ok()?;

    if capture.exit_code != Some(0) {
        return None;
    }

    let prefix = first_output_line(&command_output_text(&capture.stdout, &capture.stderr));

    if prefix.is_empty() {
        None
    } else {
        Some(PathBuf::from(prefix))
    }
}

fn npm_global_executable_path(definition: AgentDefinition) -> Option<PathBuf> {
    if definition.id == "haider" {
        return None;
    }
    let prefix = npm_global_prefix()?;

    #[cfg(windows)]
    let candidates = [
        prefix.join(format!("{}.cmd", definition.binary)),
        prefix.join(format!("{}.exe", definition.binary)),
        prefix.join(definition.binary),
    ];

    #[cfg(not(windows))]
    let candidates = [prefix.join("bin").join(definition.binary)];

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn resolve_agent_command_candidates(definition: AgentDefinition) -> Vec<String> {
    let mut candidates = Vec::new();

    if let Some(path) = npm_global_executable_path(definition) {
        let path = path.to_string_lossy().to_string();

        candidates.push(path);
    }
    for path in agent_path_command_candidates(definition) {
        if !candidates.iter().any(|candidate| candidate == &path) {
            candidates.push(path);
        }
    }

    if !candidates
        .iter()
        .any(|candidate| candidate == definition.binary)
    {
        candidates.push(definition.binary.to_string());
    }

    candidates
}

#[cfg(windows)]
fn agent_path_command_candidates(definition: AgentDefinition) -> Vec<String> {
    let Some(path_value) = env::var_os("PATH") else {
        return Vec::new();
    };
    let suffixes = [".cmd", ".exe", ".bat", ""];
    let mut candidates = Vec::new();

    for directory in env::split_paths(&path_value) {
        for suffix in suffixes {
            let candidate = directory.join(format!("{}{}", definition.binary, suffix));
            if candidate.exists() {
                let path = candidate.to_string_lossy().to_string();
                if !candidates.iter().any(|existing| existing == &path) {
                    candidates.push(path);
                }
            }
        }
    }

    candidates
}

#[cfg(not(windows))]
fn agent_path_command_candidates(_definition: AgentDefinition) -> Vec<String> {
    Vec::new()
}

fn agent_command_candidates(definition: AgentDefinition) -> Vec<String> {
    let cache = AGENT_COMMAND_CANDIDATE_CACHE.get_or_init(|| StdMutex::new(HashMap::new()));

    if let Ok(cache) = cache.lock() {
        if let Some(candidates) = cache.get(definition.id) {
            return candidates.clone();
        }
    }

    let candidates = resolve_agent_command_candidates(definition);

    // On Windows a resolution with no on-disk candidate fails the launch
    // ("not installed"), so never cache the miss: installing the CLI
    // mid-session must be picked up by the next launch retry, not pinned
    // to the failure until app restart. Unix keeps caching either way
    // because the bare-name fallback stays a valid shell-resolved launch.
    let cacheable = cfg!(not(windows))
        || candidates
            .iter()
            .any(|candidate| Path::new(candidate).exists());

    if cacheable {
        if let Ok(mut cache) = cache.lock() {
            cache.insert(definition.id, candidates.clone());
        }
    }

    candidates
}

fn clear_agent_command_candidate_cache(provider: AgentProvider) {
    let definition = agent_definition(provider);

    if let Some(cache) = AGENT_COMMAND_CANDIDATE_CACHE.get() {
        if let Ok(mut cache) = cache.lock() {
            cache.remove(definition.id);
        }
    }
}

const AGENT_MODEL_CATALOG_CLAUDE_REASONING_EFFORTS: [&str; 6] =
    ["default", "low", "medium", "high", "xhigh", "max"];
const AGENT_MODEL_CATALOG_CODEX_REASONING_EFFORTS: [&str; 4] = ["low", "medium", "high", "xhigh"];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct AgentModelCatalogEntry {
    id: String,
    display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<String>,
    supports_images: bool,
    supports_effort: bool,
    reasoning_efforts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    speed_modes: Option<Vec<String>>,
    is_default: bool,
    hidden: bool,
    deprecated: bool,
    source: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct AgentModelCatalog {
    agent_kind: String,
    harness_version: String,
    source: String,
    complete: bool,
    models: Vec<AgentModelCatalogEntry>,
    content_hash: String,
}

fn clean_agent_model_catalog_text(value: &str, max_chars: usize) -> String {
    value
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(max_chars)
        .collect::<String>()
}

fn agent_model_catalog_content_hash(
    agent_kind: &str,
    harness_version: &str,
    source: &str,
    complete: bool,
    models: &[AgentModelCatalogEntry],
) -> String {
    let seed = json!({
        "agent_kind": agent_kind,
        "harness_version": harness_version,
        "source": source,
        "complete": complete,
        "models": models,
    });
    format!("{:x}", Sha256::digest(seed.to_string().as_bytes()))
}

fn agent_model_catalog(
    agent_kind: &str,
    harness_version: &str,
    source: &str,
    complete: bool,
    models: Vec<AgentModelCatalogEntry>,
) -> AgentModelCatalog {
    let content_hash =
        agent_model_catalog_content_hash(agent_kind, harness_version, source, complete, &models);
    AgentModelCatalog {
        agent_kind: agent_kind.to_string(),
        harness_version: harness_version.to_string(),
        source: source.to_string(),
        complete,
        models,
        content_hash,
    }
}

fn agent_model_catalog_provider_from_id(model_id: &str) -> Option<String> {
    let provider = model_id.split('/').next()?.trim();
    if provider.is_empty() || provider == model_id {
        None
    } else {
        Some(provider.to_string())
    }
}

fn agent_model_catalog_display_from_id(model_id: &str) -> String {
    let leaf = model_id
        .rsplit('/')
        .next()
        .unwrap_or(model_id)
        .replace(['_', '-'], " ");
    let display = leaf
        .split_whitespace()
        .map(|part| {
            if part.chars().all(|ch| ch.is_ascii_digit() || ch == '.') {
                part.to_string()
            } else if part.len() <= 4 && part.chars().all(|ch| ch.is_ascii_alphanumeric()) {
                part.to_ascii_uppercase()
            } else {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    if display.trim().is_empty() {
        model_id.to_string()
    } else {
        display
    }
}

fn agent_model_catalog_entry(
    agent_kind: &str,
    id: &str,
    display_name: &str,
    description: Option<&str>,
    source: &str,
    is_default: bool,
    supports_images: bool,
    supports_effort: bool,
    reasoning_efforts: Vec<String>,
    default_reasoning_effort: Option<&str>,
    speed_modes: Option<Vec<&str>>,
    provider: Option<&str>,
    hidden: bool,
    deprecated: bool,
) -> AgentModelCatalogEntry {
    AgentModelCatalogEntry {
        id: clean_agent_model_catalog_text(id, 180),
        display_name: clean_agent_model_catalog_text(display_name, 120),
        description: description
            .map(|value| clean_agent_model_catalog_text(value, 240))
            .filter(|value| !value.is_empty()),
        agent_kind: agent_kind.to_string(),
        provider: provider
            .map(|value| clean_agent_model_catalog_text(value, 80))
            .filter(|value| !value.is_empty()),
        supports_images,
        supports_effort,
        reasoning_efforts,
        default_reasoning_effort: default_reasoning_effort
            .map(|value| clean_agent_model_catalog_text(value, 40))
            .filter(|value| !value.is_empty()),
        speed_modes: speed_modes.map(|modes| {
            modes
                .into_iter()
                .map(|mode| clean_agent_model_catalog_text(mode, 40))
                .filter(|mode| !mode.is_empty())
                .collect::<Vec<_>>()
        }),
        is_default,
        hidden,
        deprecated,
        source: source.to_string(),
    }
}

fn agent_model_baseline_catalog_entries(agent_kind: &str) -> Vec<AgentModelCatalogEntry> {
    match agent_kind {
        "codex" => {
            let efforts = AGENT_MODEL_CATALOG_CODEX_REASONING_EFFORTS
                .iter()
                .map(|effort| effort.to_string())
                .collect::<Vec<_>>();
            vec![
                agent_model_catalog_entry(
                    "codex",
                    "gpt-5.5",
                    "GPT-5.5",
                    Some("Latest Codex model"),
                    "device_baseline",
                    true,
                    true,
                    true,
                    efforts.clone(),
                    Some("medium"),
                    Some(vec!["standard", "fast"]),
                    None,
                    false,
                    false,
                ),
                agent_model_catalog_entry(
                    "codex",
                    "gpt-5.4",
                    "GPT-5.4",
                    Some("Balanced coding model"),
                    "device_baseline",
                    false,
                    true,
                    true,
                    efforts.clone(),
                    Some("medium"),
                    Some(vec!["standard", "fast"]),
                    None,
                    false,
                    false,
                ),
                agent_model_catalog_entry(
                    "codex",
                    "gpt-5.4-mini",
                    "GPT-5.4 mini",
                    Some("Faster lower-cost coding model"),
                    "device_baseline",
                    false,
                    true,
                    true,
                    efforts.clone(),
                    Some("medium"),
                    None,
                    None,
                    false,
                    false,
                ),
                agent_model_catalog_entry(
                    "codex",
                    "gpt-5.3-codex-spark",
                    "Codex Spark",
                    Some("Research preview quick coding model"),
                    "device_baseline",
                    false,
                    true,
                    true,
                    efforts,
                    Some("high"),
                    Some(vec!["fast"]),
                    None,
                    false,
                    false,
                ),
            ]
        }
        "claude" => {
            let efforts = AGENT_MODEL_CATALOG_CLAUDE_REASONING_EFFORTS
                .iter()
                .map(|effort| effort.to_string())
                .collect::<Vec<_>>();
            vec![
                agent_model_catalog_entry(
                    "claude",
                    "sonnet",
                    "Sonnet",
                    Some("Balanced Claude Code default"),
                    "device_baseline",
                    true,
                    true,
                    true,
                    efforts.clone(),
                    Some("default"),
                    None,
                    None,
                    false,
                    false,
                ),
                agent_model_catalog_entry(
                    "claude",
                    "opus",
                    "Opus",
                    Some("Higher capability Claude model"),
                    "device_baseline",
                    false,
                    true,
                    true,
                    efforts.clone(),
                    Some("default"),
                    Some(vec!["standard", "fast"]),
                    None,
                    false,
                    false,
                ),
                agent_model_catalog_entry(
                    "claude",
                    "haiku",
                    "Haiku",
                    Some("Lower-latency Claude model"),
                    "device_baseline",
                    false,
                    true,
                    true,
                    efforts.clone(),
                    Some("default"),
                    None,
                    None,
                    false,
                    false,
                ),
                agent_model_catalog_entry(
                    "claude",
                    "fable",
                    "Fable",
                    Some("Latest Claude alias when available"),
                    "device_baseline",
                    false,
                    true,
                    true,
                    efforts,
                    Some("default"),
                    None,
                    None,
                    false,
                    false,
                ),
            ]
        }
        "opencode" => vec![
            opencode_model_catalog_entry("openai/gpt-5.5", "device_baseline", false),
            opencode_model_catalog_entry("openai/gpt-5.4-mini", "device_baseline", false),
            opencode_model_catalog_entry("anthropic/claude-sonnet-4-5", "device_baseline", true),
            opencode_model_catalog_entry("google/gemini-2.5-pro", "device_baseline", false),
        ],
        _ => Vec::new(),
    }
}

fn agent_model_catalog_normalize_defaults(models: &mut [AgentModelCatalogEntry]) {
    let mut found_default = false;
    for model in models.iter_mut() {
        if model.is_default && !found_default {
            found_default = true;
        } else {
            model.is_default = false;
        }
    }
    if found_default {
        return;
    }
    let default_index = models
        .iter()
        .position(|model| !model.hidden && !model.deprecated)
        .or_else(|| (!models.is_empty()).then_some(0));
    if let Some(index) = default_index {
        if let Some(model) = models.get_mut(index) {
            model.is_default = true;
        }
    }
}

fn agent_model_catalog_merge_live_with_baseline(
    agent_kind: &str,
    live_models: Vec<AgentModelCatalogEntry>,
) -> Vec<AgentModelCatalogEntry> {
    let mut merged = Vec::new();
    let mut seen = HashSet::new();
    for mut model in live_models
        .into_iter()
        .chain(agent_model_baseline_catalog_entries(agent_kind))
    {
        let id = model.id.trim().to_string();
        if id.is_empty() {
            continue;
        }
        let key = id.to_ascii_lowercase();
        if !seen.insert(key) {
            continue;
        }
        model.id = id;
        model.agent_kind = agent_kind.to_string();
        merged.push(model);
    }
    agent_model_catalog_normalize_defaults(&mut merged);
    merged
}

fn agent_model_catalog_fallback(agent_kind: &str, harness_version: &str) -> AgentModelCatalog {
    let models = agent_model_catalog_merge_live_with_baseline(agent_kind, Vec::new());
    agent_model_catalog(
        agent_kind,
        harness_version,
        "device_baseline",
        false,
        models,
    )
}

const OPENCODE_MODELS_TIMEOUT: Duration = Duration::from_secs(10);
const OPENCODE_MODELS_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

static OPENCODE_MODEL_LIST_CACHE: OnceLock<StdMutex<Option<OpencodeModelCacheEntry>>> =
    OnceLock::new();
static OPENCODE_HARNESS_VERSION: OnceLock<StdMutex<Option<String>>> = OnceLock::new();

#[derive(Clone, Serialize)]
struct OpencodeModelList {
    models: Vec<String>,
    source: String,
    fetched_at_ms: u64,
    harness_version: Option<String>,
    error: Option<String>,
}

#[derive(Clone)]
struct OpencodeModelCacheEntry {
    models: Vec<String>,
    fetched_at_ms: u64,
    fetched_instant: Instant,
    harness_version: Option<String>,
}

enum OpencodeModelsCommandError {
    Spawn(String),
    Run(String),
}

fn parse_opencode_models_stdout(stdout: &str) -> Vec<String> {
    let mut models = Vec::new();
    let mut seen = HashSet::new();

    for line in stdout.lines() {
        let model = line.trim();
        if model.is_empty() || !model.contains('/') || model.chars().any(char::is_whitespace) {
            continue;
        }

        if seen.insert(model.to_string()) {
            models.push(model.to_string());
        }
    }

    models
}

fn opencode_model_list_cache() -> &'static StdMutex<Option<OpencodeModelCacheEntry>> {
    OPENCODE_MODEL_LIST_CACHE.get_or_init(|| StdMutex::new(None))
}

fn opencode_harness_version_cache() -> &'static StdMutex<Option<String>> {
    OPENCODE_HARNESS_VERSION.get_or_init(|| StdMutex::new(None))
}

fn opencode_current_harness_version() -> Option<String> {
    opencode_harness_version_cache()
        .lock()
        .ok()
        .and_then(|version| version.clone())
}

fn clear_opencode_model_list_cache() {
    if let Ok(mut cache) = opencode_model_list_cache().lock() {
        *cache = None;
    }
}

fn opencode_note_harness_version(version: &str) -> bool {
    let version = version.trim();
    if version.is_empty() {
        return false;
    }
    let Ok(mut current) = opencode_harness_version_cache().lock() else {
        return false;
    };
    if current.as_deref() == Some(version) {
        return false;
    }
    *current = Some(version.to_string());
    drop(current);
    clear_opencode_model_list_cache();
    true
}

fn opencode_model_list_response(
    entry: &OpencodeModelCacheEntry,
    source: &str,
    error: Option<String>,
) -> OpencodeModelList {
    OpencodeModelList {
        models: entry.models.clone(),
        source: source.to_string(),
        fetched_at_ms: entry.fetched_at_ms,
        harness_version: entry.harness_version.clone(),
        error,
    }
}

fn opencode_model_list_cached_response_for(
    entry: Option<&OpencodeModelCacheEntry>,
    now: Instant,
    force_refresh: bool,
) -> Option<OpencodeModelList> {
    if force_refresh {
        return None;
    }

    let entry = entry?;
    if let Some(current_harness_version) = opencode_current_harness_version() {
        if entry.harness_version.as_deref() != Some(current_harness_version.as_str()) {
            return None;
        }
    }
    if now.saturating_duration_since(entry.fetched_instant) < OPENCODE_MODELS_CACHE_TTL {
        Some(opencode_model_list_response(entry, "cache", None))
    } else {
        None
    }
}

fn opencode_model_list_cached_response(force_refresh: bool) -> Option<OpencodeModelList> {
    let entry = opencode_model_list_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.as_ref().cloned());

    opencode_model_list_cached_response_for(entry.as_ref(), Instant::now(), force_refresh)
}

fn opencode_model_list_failure_response(error: String) -> OpencodeModelList {
    let entry = opencode_model_list_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.as_ref().cloned());

    if let Some(entry) = entry {
        opencode_model_list_response(&entry, "stale-cache", Some(error))
    } else {
        OpencodeModelList {
            models: Vec::new(),
            source: "error".to_string(),
            fetched_at_ms: 0,
            harness_version: opencode_current_harness_version(),
            error: Some(error),
        }
    }
}

fn store_opencode_model_list_cache(entry: OpencodeModelCacheEntry) {
    if let Ok(mut cache) = opencode_model_list_cache().lock() {
        *cache = Some(entry);
    }
}

fn opencode_models_nonzero_exit_message(capture: &CommandCapture) -> String {
    let detail = first_output_line(&command_output_text(&capture.stdout, &capture.stderr));

    if detail.is_empty() {
        "opencode models exited with an error.".to_string()
    } else {
        format!("opencode models failed: {detail}")
    }
}

fn spawn_opencode_models_pipe_reader<R>(
    stream_name: &'static str,
    mut pipe: R,
) -> thread::JoinHandle<Result<String, String>>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut output = Vec::new();
        pipe.read_to_end(&mut output)
            .map_err(|error| format!("Unable to read opencode {stream_name}: {error}"))?;
        Ok(String::from_utf8_lossy(&output).to_string())
    })
}

fn join_opencode_models_pipe_reader(
    reader: Option<thread::JoinHandle<Result<String, String>>>,
    stream_name: &str,
) -> Result<String, OpencodeModelsCommandError> {
    let Some(reader) = reader else {
        return Ok(String::new());
    };

    reader
        .join()
        .map_err(|_| {
            OpencodeModelsCommandError::Run(format!("OpenCode {stream_name} reader panicked."))
        })?
        .map_err(OpencodeModelsCommandError::Run)
}

fn finish_opencode_models_pipe_readers(
    stdout_reader: Option<thread::JoinHandle<Result<String, String>>>,
    stderr_reader: Option<thread::JoinHandle<Result<String, String>>>,
) -> Result<(String, String), OpencodeModelsCommandError> {
    let stdout = join_opencode_models_pipe_reader(stdout_reader, "stdout")?;
    let stderr = join_opencode_models_pipe_reader(stderr_reader, "stderr")?;

    Ok((stdout, stderr))
}

fn discard_opencode_models_pipe_readers(
    stdout_reader: Option<thread::JoinHandle<Result<String, String>>>,
    stderr_reader: Option<thread::JoinHandle<Result<String, String>>>,
) {
    let _ = finish_opencode_models_pipe_readers(stdout_reader, stderr_reader);
}

fn run_opencode_models_candidate(
    candidate: &str,
) -> Result<CommandCapture, OpencodeModelsCommandError> {
    if app_shutdown_requested() {
        return Err(OpencodeModelsCommandError::Run(
            app_shutdown_blocked_message(candidate),
        ));
    }

    let mut command = Command::new(candidate);
    command.env("PATH", desktop_command_path());
    command.arg("models");
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().map_err(|error| {
        let message = if error.kind() == std::io::ErrorKind::NotFound {
            format!("{candidate} is not installed or not available on PATH.")
        } else {
            format!("Unable to start {candidate}: {error}")
        };
        OpencodeModelsCommandError::Spawn(message)
    })?;

    let stdout_reader = child
        .stdout
        .take()
        .map(|stdout| spawn_opencode_models_pipe_reader("stdout", stdout));
    let stderr_reader = child
        .stderr
        .take()
        .map(|stderr| spawn_opencode_models_pipe_reader("stderr", stderr));
    let started_at = Instant::now();

    loop {
        if app_shutdown_requested() {
            let _ = child.kill();
            let _ = child.wait();
            discard_opencode_models_pipe_readers(stdout_reader, stderr_reader);
            return Err(OpencodeModelsCommandError::Run(
                app_shutdown_blocked_message(candidate),
            ));
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                let (stdout, stderr) =
                    finish_opencode_models_pipe_readers(stdout_reader, stderr_reader)?;

                return Ok(CommandCapture {
                    exit_code: status.code(),
                    stdout,
                    stderr,
                });
            }
            Ok(None) => {
                if started_at.elapsed() >= OPENCODE_MODELS_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    discard_opencode_models_pipe_readers(stdout_reader, stderr_reader);
                    return Err(OpencodeModelsCommandError::Run(format!(
                        "{candidate} timed out."
                    )));
                }

                thread::sleep(Duration::from_millis(80));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                discard_opencode_models_pipe_readers(stdout_reader, stderr_reader);
                return Err(OpencodeModelsCommandError::Run(format!(
                    "Unable to wait for {candidate}: {error}"
                )));
            }
        }
    }
}

fn fetch_opencode_models_from_cli() -> Result<OpencodeModelCacheEntry, String> {
    let definition = agent_definition(AgentProvider::OpenCode);
    let mut last_error = format!(
        "{} is not installed or not available on PATH.",
        definition.label
    );

    for candidate in agent_command_candidates(definition) {
        let capture = match run_opencode_models_candidate(&candidate) {
            Ok(capture) => capture,
            Err(OpencodeModelsCommandError::Spawn(error)) => {
                last_error = error;
                continue;
            }
            Err(OpencodeModelsCommandError::Run(error)) => return Err(error),
        };

        if capture.exit_code != Some(0) {
            return Err(opencode_models_nonzero_exit_message(&capture));
        }

        return Ok(OpencodeModelCacheEntry {
            models: parse_opencode_models_stdout(&capture.stdout),
            fetched_at_ms: current_time_ms(),
            fetched_instant: Instant::now(),
            harness_version: opencode_current_harness_version(),
        });
    }

    Err(last_error)
}

fn opencode_model_catalog_entry(
    model_id: &str,
    source: &str,
    is_default: bool,
) -> AgentModelCatalogEntry {
    let supports_images = opencode_model_supports_images(model_id).unwrap_or(false);
    agent_model_catalog_entry(
        "opencode",
        model_id,
        &agent_model_catalog_display_from_id(model_id),
        None,
        source,
        is_default,
        supports_images,
        false,
        Vec::new(),
        None,
        None,
        agent_model_catalog_provider_from_id(model_id).as_deref(),
        false,
        false,
    )
}

fn opencode_model_catalog_entries_from_ids(
    model_ids: &[String],
    source: &str,
) -> Vec<AgentModelCatalogEntry> {
    let source = if source == "cache" || source == "stale-cache" {
        "harness_cache"
    } else {
        "harness_api"
    };
    let mut models = Vec::new();
    let mut seen = HashSet::new();
    for model_id in model_ids.iter().take(512) {
        let model_id = model_id.trim();
        if model_id.is_empty() || !seen.insert(model_id.to_ascii_lowercase()) {
            continue;
        }
        models.push(opencode_model_catalog_entry(
            model_id,
            source,
            model_id == "anthropic/claude-sonnet-4-5",
        ));
    }
    agent_model_catalog_normalize_defaults(&mut models);
    models
}

#[tauri::command(rename_all = "snake_case")]
async fn opencode_list_models(force_refresh: Option<bool>) -> OpencodeModelList {
    let force_refresh = force_refresh.unwrap_or(false);

    if let Some(response) = opencode_model_list_cached_response(force_refresh) {
        return response;
    }

    let fetch_result = tauri::async_runtime::spawn_blocking(fetch_opencode_models_from_cli)
        .await
        .unwrap_or_else(|error| {
            Err(format!(
                "OpenCode model list worker failed before completion: {error}"
            ))
        });

    match fetch_result {
        Ok(entry) => {
            store_opencode_model_list_cache(entry.clone());
            opencode_model_list_response(&entry, "cli", None)
        }
        Err(error) => opencode_model_list_failure_response(error),
    }
}

#[cfg(windows)]
fn quote_powershell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(windows)]
fn terminal_idle_shell_command() -> CommandBuilder {
    let mut command = CommandBuilder::new("powershell.exe");
    command.arg("-NoLogo");
    command.arg("-NoExit");
    command.arg("-ExecutionPolicy");
    command.arg("Bypass");
    command
}

#[cfg(not(windows))]
fn quote_shell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(not(windows))]
fn terminal_idle_shell_command() -> CommandBuilder {
    CommandBuilder::new(env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()))
}

#[cfg(windows)]
fn terminal_interactive_shell_command() -> CommandBuilder {
    terminal_idle_shell_command()
}

#[cfg(target_os = "macos")]
fn terminal_interactive_shell_command() -> CommandBuilder {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let shell_name = Path::new(&shell)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_string();
    let mut command = CommandBuilder::new(shell);

    if matches!(shell_name.as_str(), "zsh" | "bash") {
        command.arg("-l");
    }

    command
}

#[cfg(all(unix, not(target_os = "macos")))]
fn terminal_interactive_shell_command() -> CommandBuilder {
    terminal_idle_shell_command()
}

fn is_terminal_prewarm_kind(kind: &str) -> bool {
    matches!(
        kind.trim().to_ascii_lowercase().as_str(),
        "shell"
            | "plain-shell"
            | "plain_shell"
            | "generic"
            | "generic-shell"
            | "generic_shell"
            | "prewarm"
            | "prewarm-shell"
            | "prewarm_shell"
            | "prewarm-pty"
            | "prewarm_pty"
            | "pty"
    )
}

#[cfg(windows)]
fn terminal_agent_start_input(command_path: &str, args: &[String]) -> String {
    format!("{}\r", terminal_agent_invocation(command_path, args))
}

#[cfg(windows)]
fn terminal_agent_invocation(command_path: &str, args: &[String]) -> String {
    let mut invocation = format!("& {}", quote_powershell_literal(command_path));

    for arg in args {
        invocation.push(' ');
        invocation.push_str(&quote_powershell_literal(arg));
    }

    invocation
}

// cmd.exe rejects command lines at roughly 8191 UTF-16 code units. Keep
// enough headroom for PowerShell/cmd quoting and the npm-generated Claude
// launcher, which is commonly a .cmd shim on Windows.
const WINDOWS_CLAUDE_LAUNCH_STAGE_THRESHOLD: usize = 7_000;
// Native executables bypass cmd.exe and inherit CreateProcessW's roughly
// 32,767 UTF-16-unit command-line ceiling. Preserve conservative headroom for
// the PowerShell and portable-pty quoting layers.
const WINDOWS_NATIVE_CLAUDE_LAUNCH_STAGE_THRESHOLD: usize = 30_000;
const WINDOWS_CLAUDE_LAUNCH_STAGE_MAX_AGE: Duration = Duration::from_secs(10 * 60);
const WINDOWS_CLAUDE_LAUNCH_SWEEP_INTERVAL: Duration = Duration::from_secs(60);

fn windows_claude_launch_stage_directory() -> PathBuf {
    env::temp_dir().join("diffforge-claude-launch")
}

fn windows_claude_launch_file_should_prune(modified_at: SystemTime, now: SystemTime) -> bool {
    now.duration_since(modified_at)
        .is_ok_and(|age| age >= WINDOWS_CLAUDE_LAUNCH_STAGE_MAX_AGE)
}

fn prune_windows_claude_launch_stage_directory() {
    let directory = windows_claude_launch_stage_directory();
    let Ok(entries) = fs::read_dir(&directory) else {
        return;
    };
    let now = SystemTime::now();

    for entry in entries.flatten() {
        let path = entry.path();
        let should_prune = entry
            .metadata()
            .ok()
            .filter(|metadata| metadata.is_file())
            .and_then(|metadata| metadata.modified().ok())
            .is_some_and(|modified_at| windows_claude_launch_file_should_prune(modified_at, now));
        if should_prune {
            let _ = fs::remove_file(path);
        }
    }

    // Keep the shared empty directory: removing it can race another launch
    // between its create_dir_all and create_new calls.
}

fn ensure_windows_claude_launch_cleanup_sweeper() {
    static SWEEPER_STARTED: OnceLock<()> = OnceLock::new();
    SWEEPER_STARTED.get_or_init(|| {
        thread::spawn(|| loop {
            thread::sleep(WINDOWS_CLAUDE_LAUNCH_SWEEP_INTERVAL);
            prune_windows_claude_launch_stage_directory();
        });
    });
}

fn cleanup_windows_claude_launch_files(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowsClaudeLaunchFileCleanupPolicy {
    Immediate,
    AgeBasedSweep,
}

fn windows_claude_launch_file_cleanup_policy(
    staging_failed: bool,
) -> WindowsClaudeLaunchFileCleanupPolicy {
    if staging_failed {
        WindowsClaudeLaunchFileCleanupPolicy::Immediate
    } else {
        WindowsClaudeLaunchFileCleanupPolicy::AgeBasedSweep
    }
}

fn windows_powershell_literal_command_line_len(value: &str) -> usize {
    // PowerShell single-quoted literals wrap the value and escape each single
    // quote by doubling it. portable-pty then quotes the complete -Command
    // payload for CreateProcessW; count every embedded double quote and
    // backslash as an extra code unit for a conservative upper bound on that
    // second escaping layer.
    2 + value.encode_utf16().count()
        + value
            .chars()
            .filter(|ch| matches!(*ch, '\'' | '"' | '\\'))
            .count()
}

fn windows_agent_launch_command_line_len(command_path: &str, args: &[String]) -> usize {
    let powershell_prefix = "powershell.exe -NoLogo -NoExit -ExecutionPolicy Bypass -Command ";
    let mut len = powershell_prefix.encode_utf16().count()
        + 2 // quotes around the -Command payload
        + 2 // `& `
        + windows_powershell_literal_command_line_len(command_path)
        + 1; // terminating NUL
    for arg in args {
        len += 1 + windows_powershell_literal_command_line_len(arg);
    }
    len
}

fn windows_agent_launch_command_line_bound(command_path: &str) -> usize {
    let is_batch_shim = Path::new(command_path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
        });
    if is_batch_shim {
        WINDOWS_CLAUDE_LAUNCH_STAGE_THRESHOLD
    } else {
        WINDOWS_NATIVE_CLAUDE_LAUNCH_STAGE_THRESHOLD
    }
}

fn windows_claude_launch_needs_file_staging(command_path: &str, args: &[String]) -> bool {
    windows_agent_launch_command_line_len(command_path, args)
        >= windows_agent_launch_command_line_bound(command_path)
}

fn windows_claude_inline_json(value: &str) -> bool {
    let trimmed = value.trim();
    matches!(trimmed.as_bytes().first(), Some(b'{') | Some(b'['))
        && serde_json::from_str::<Value>(trimmed).is_ok()
}

fn write_windows_claude_launch_file(
    kind: &str,
    extension: &str,
    contents: &str,
) -> Result<PathBuf, String> {
    let directory = windows_claude_launch_stage_directory();
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Unable to prepare Claude launch staging directory {}: {error}",
            directory.display()
        )
    })?;
    let path = directory.join(format!(
        "{kind}-{}-{}.{}",
        std::process::id(),
        uuid::Uuid::new_v4(),
        extension
    ));

    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        // The production staging path is Windows-only, so this mode is a no-op
        // there; staged files instead inherit the per-user ACLs on %TEMP%.
        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(|error| {
        format!(
            "Unable to create Claude launch staging file {}: {error}",
            path.display()
        )
    })?;
    if let Err(error) = file.write_all(contents.as_bytes()) {
        drop(file);
        cleanup_windows_claude_launch_files(std::slice::from_ref(&path));
        return Err(format!(
            "Unable to write Claude launch staging file {}: {error}",
            path.display()
        ));
    }
    if let Err(error) = file.flush() {
        drop(file);
        cleanup_windows_claude_launch_files(std::slice::from_ref(&path));
        return Err(format!(
            "Unable to flush Claude launch staging file {}: {error}",
            path.display()
        ));
    }
    Ok(path)
}

fn windows_claude_launch_file_spec(
    option: &str,
    value: &str,
) -> Option<(&'static str, &'static str, &'static str)> {
    match option {
        "--append-system-prompt" => {
            Some(("--append-system-prompt-file", "append-system-prompt", "txt"))
        }
        "--system-prompt" => Some(("--system-prompt-file", "system-prompt", "txt")),
        "--settings" if windows_claude_inline_json(value) => {
            Some(("--settings", "settings", "json"))
        }
        "--mcp-config" if windows_claude_inline_json(value) => {
            Some(("--mcp-config", "mcp-config", "json"))
        }
        _ => None,
    }
}

fn windows_claude_inline_option(arg: &str) -> Option<(&'static str, &str)> {
    for option in [
        "--append-system-prompt",
        "--system-prompt",
        "--settings",
        "--mcp-config",
    ] {
        if let Some(value) = arg.strip_prefix(&format!("{option}=")) {
            return Some((option, value));
        }
    }
    None
}

fn windows_claude_allowed_tools_inline_value(arg: &str) -> Option<&str> {
    arg.strip_prefix("--allowedTools=")
        .or_else(|| arg.strip_prefix("--allowed-tools="))
}

fn windows_claude_settings_value(value: Option<&str>) -> Result<Value, String> {
    let Some(value) = value else {
        return Ok(json!({}));
    };
    let body = if windows_claude_inline_json(value) {
        value.to_string()
    } else {
        fs::read_to_string(value)
            .map_err(|error| format!("Unable to read Claude settings {value}: {error}"))?
    };
    serde_json::from_str(&body)
        .map_err(|error| format!("Unable to parse Claude settings for Windows staging: {error}"))
}

fn stage_windows_claude_allowed_tools_in_settings(
    args: &[String],
    staged_paths: &mut Vec<PathBuf>,
) -> Result<Vec<String>, String> {
    let mut retained = Vec::with_capacity(args.len());
    let mut allowed_tools = Vec::new();
    let mut settings_value = None;
    let mut index = 0usize;
    while index < args.len() {
        match args[index].as_str() {
            "--allowedTools" | "--allowed-tools" if index + 1 < args.len() => {
                allowed_tools.push(args[index + 1].clone());
                index += 2;
            }
            "--settings" if index + 1 < args.len() => {
                settings_value = Some(args[index + 1].clone());
                index += 2;
            }
            arg => {
                if let Some(value) = windows_claude_allowed_tools_inline_value(arg) {
                    allowed_tools.push(value.to_string());
                } else if let Some(value) = arg.strip_prefix("--settings=") {
                    settings_value = Some(value.to_string());
                } else {
                    retained.push(args[index].clone());
                }
                index += 1;
            }
        }
    }

    if allowed_tools.is_empty() {
        return Ok(args.to_vec());
    }

    let mut settings = windows_claude_settings_value(settings_value.as_deref())?;
    let settings_object = settings
        .as_object_mut()
        .ok_or_else(|| "Claude settings must be a JSON object for Windows staging.".to_string())?;
    let permissions = settings_object
        .entry("permissions".to_string())
        .or_insert_with(|| Value::Object(serde_json::Map::new()))
        .as_object_mut()
        .ok_or_else(|| {
            "Claude settings permissions must be a JSON object for Windows staging.".to_string()
        })?;
    let allow = permissions
        .entry("allow".to_string())
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| {
            "Claude settings permissions.allow must be an array for Windows staging.".to_string()
        })?;
    let mut seen = allow
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<HashSet<_>>();
    for tool in allowed_tools
        .iter()
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if seen.insert(tool.to_string()) {
            allow.push(Value::String(tool.to_string()));
        }
    }

    let serialized = serde_json::to_string(&settings)
        .map_err(|error| format!("Unable to serialize staged Claude settings: {error}"))?;
    let staged_path = write_windows_claude_launch_file("settings", "json", &serialized)?;
    staged_paths.push(staged_path.clone());
    if let Some(previous_path) = settings_value
        .as_deref()
        .map(Path::new)
        .filter(|previous_path| previous_path.starts_with(windows_claude_launch_stage_directory()))
    {
        let _ = fs::remove_file(previous_path);
    }
    retained.push("--settings".to_string());
    retained.push(staged_path.to_string_lossy().to_string());
    Ok(retained)
}

fn stage_windows_claude_launch_args(
    command_path: &str,
    args: &[String],
) -> Result<Vec<String>, String> {
    let mut staged_paths = Vec::new();
    let result = (|| {
        let command_line_bound = windows_agent_launch_command_line_bound(command_path);
        if windows_agent_launch_command_line_len(command_path, args) < command_line_bound {
            return Ok(args.to_vec());
        }

        let mut staged_args = Vec::with_capacity(args.len());
        let mut index = 0usize;
        while index < args.len() {
            let option = args[index].as_str();
            if let Some(value) = args.get(index + 1) {
                if let Some((file_option, kind, extension)) =
                    windows_claude_launch_file_spec(option, value)
                {
                    let path = write_windows_claude_launch_file(kind, extension, value)?;
                    staged_paths.push(path.clone());
                    staged_args.push(file_option.to_string());
                    staged_args.push(path.to_string_lossy().to_string());
                    index += 2;
                    continue;
                }
            }

            if let Some((inline_option, value)) = windows_claude_inline_option(option) {
                if let Some((file_option, kind, extension)) =
                    windows_claude_launch_file_spec(inline_option, value)
                {
                    let path = write_windows_claude_launch_file(kind, extension, value)?;
                    staged_paths.push(path.clone());
                    staged_args.push(file_option.to_string());
                    staged_args.push(path.to_string_lossy().to_string());
                    index += 1;
                    continue;
                }
            }

            staged_args.push(args[index].clone());
            index += 1;
        }

        let mut staged_len = windows_agent_launch_command_line_len(command_path, &staged_args);
        if staged_len >= command_line_bound {
            staged_args =
                stage_windows_claude_allowed_tools_in_settings(&staged_args, &mut staged_paths)?;
            staged_len = windows_agent_launch_command_line_len(command_path, &staged_args);
        }
        if staged_len >= command_line_bound {
            return Err(format!(
                "Claude Code launch remains too long for Windows after staging file-backed settings, allowed tools, MCP config, and system prompts ({staged_len} characters; limit {command_line_bound})."
            ));
        }

        Ok(staged_args)
    })();

    match windows_claude_launch_file_cleanup_policy(result.is_err()) {
        WindowsClaudeLaunchFileCleanupPolicy::Immediate => {
            cleanup_windows_claude_launch_files(&staged_paths);
        }
        WindowsClaudeLaunchFileCleanupPolicy::AgeBasedSweep => {
            if cfg!(windows) && !staged_paths.is_empty() {
                // Successful staging transfers ownership exclusively to the
                // conservative age-based sweep. Later writer/spawn completion
                // must not delete files Claude may not have opened yet.
                ensure_windows_claude_launch_cleanup_sweeper();
            }
        }
    }
    result
}

fn prepare_terminal_agent_launch_args_for_platform(
    provider_id: &str,
    command_path: &str,
    args: &[String],
) -> Result<Vec<String>, String> {
    if cfg!(windows) && provider_id.to_ascii_lowercase().contains("claude") {
        // Prune before every Claude launch, while preserving files recent
        // enough that another concurrent launch may not have consumed them.
        prune_windows_claude_launch_stage_directory();
        if windows_claude_launch_needs_file_staging(command_path, args) {
            return stage_windows_claude_launch_args(command_path, args);
        }
    }

    Ok(args.to_vec())
}

#[cfg(windows)]
fn terminal_agent_launch_command(
    command_path: &str,
    args: &[String],
    working_directory: &Path,
    banner: Option<&str>,
) -> CommandBuilder {
    let mut command = terminal_idle_shell_command();
    let invocation = terminal_agent_invocation(command_path, args);
    let command_text = if let Some(banner) = banner {
        format!(
            "Write-Host {}; {}",
            quote_powershell_literal(banner),
            invocation
        )
    } else {
        invocation
    };

    command.arg("-Command");
    command.arg(command_text);
    command.cwd(working_directory);

    command
}

#[cfg(windows)]
fn terminal_set_working_directory_input(working_directory: &Path) -> String {
    let directory = working_directory.to_string_lossy();

    format!(
        "Set-Location -LiteralPath {}\r",
        quote_powershell_literal(&directory)
    )
}

#[cfg(windows)]
fn terminal_agent_start_input_with_env_in_directory(
    command_path: &str,
    args: &[String],
    working_directory: &Path,
    env_vars: &[(String, String)],
) -> String {
    preflight_interactive_claude_workspace_trust(command_path, working_directory, env_vars);
    let mut input = terminal_set_working_directory_input(working_directory);
    for (key, value) in env_vars {
        if key.trim().is_empty() {
            continue;
        }
        input.push_str(&format!(
            "$env:{} = {}\r",
            key,
            quote_powershell_literal(value)
        ));
    }
    input.push_str(&terminal_agent_start_input(command_path, args));
    input
}

#[cfg(not(windows))]
fn terminal_agent_start_input(command_path: &str, args: &[String]) -> String {
    let mut invocation = quote_shell_literal(command_path);

    for arg in args {
        invocation.push(' ');
        invocation.push_str(&quote_shell_literal(arg));
    }

    format!("{invocation}\n")
}

fn terminal_args_with_codex_mcp_identity(
    provider_id: &str,
    args: &[String],
    _coordination: Option<&TerminalCoordinationSession>,
    permission_mode: Option<&str>,
    _pane_id: &str,
    _instance_id: u64,
    _activity_transport: Option<&TerminalActivityTransportEndpoint>,
) -> Vec<String> {
    let provider_id = provider_id.to_ascii_lowercase();
    let is_codex = provider_id.contains("codex");
    let is_claude = provider_id.contains("claude");
    let mut next = terminal_interactive_resume_args(&provider_id, args);
    if !is_codex && !is_claude {
        return next;
    }
    if is_codex {
        apply_codex_terminal_display_args(&mut next);
        apply_codex_interactive_permission_args(&mut next, permission_mode);
    }
    if is_claude {
        apply_claude_interactive_permission_mode_arg(&mut next, permission_mode);
    }
    next
}

const APP_CONTROL_MCP_TOOL_NAMES: &[&str] = &[
    "get_state",
    "get_visible_context",
    "list_docs",
    "get_doc",
    "prepare_doc_draft",
    "save_doc",
    "write_doc",
    "get_selected_document_context",
    "get_selected_script_context",
    "get_selection_context",
    "save_selected_document",
    "update_selected_document",
    "save_selected_script",
    "update_selected_script",
    "run_selected_script",
    "run_local_script",
    "list_assets",
    "get_asset_root",
    "upload_asset",
    "upload_asset_status",
    "download_asset",
    "download_asset_status",
    "list_local_scripts",
    "list_scripts",
    "get_script",
    "select_workspace",
    "list_loopspace_triggers",
    "create_loopspace_trigger",
    "update_loopspace_trigger",
    "delete_loopspace_trigger",
    "run_loopspace_trigger",
    "record_loopspace_step_progress",
    "get_loopspace_graph",
    "update_loopspace_graph",
    "edit_loopspace_graph",
    "patch_loopspace_graph",
    "select_tab",
    "list_terminals",
    "open_terminals",
    "close_terminals",
    "focus_terminal",
];
const APP_CONTROL_ORCHESTRATOR_SYSTEM_PROMPT: &str = "\
You are Diff Forge's app-control terminal orchestrator. Treat the visible Diff Forge UI as first-class context, not as an ordinary repo task. When the user asks things like \"make a skill\", \"create a draft\", \"make a local script\", \"modify this selection\", \"delete this selection\", \"save this locally\", \"run this script\", or \"publish this\", use the diffforge-app-control MCP tools before guessing.

Default routing:
- Start with get_visible_context when the request could refer to the current tab, selected Tools document, selected local script, draft, or highlighted text.
- For background Tools document inventory questions, use list_docs or get_doc. These tools do not switch tabs or disturb the user's selected document. For questions about the selected/visible document, use get_selected_document_context or get_visible_context(includeContent=true) and explain the selected skill, instruction, architecture, or document from that context.
- For account document edits, call prepare_doc_draft first, edit the returned draft_path directly, then call save_doc with draft_path, draft_id, base_content_hash, and the document_key/path_key before reporting the edit done or completing a Loopspace checkpoint. Do not edit canonical local_path directly. Default to mode=\"publish\" so other clients can see completed document writes; use mode=\"local\" only when the user asks for local-only/save locally. Empty overwrites require allow_empty_overwrite=true.
- For creating a skill/architecture/HTML/document draft, call update_selected_document with title, document_kind, content or content_md, and mode=\"draft\" unless the user asks to save or publish.
- For modifying or deleting highlighted text, get the selection context, preserve the surrounding document, send the full updated document content through update_selected_document, and keep mode=\"draft\" unless the user asks for local save or publish.
- For save locally, use mode=\"local\". For publish, push, sync, fan out, or share with other clients, use mode=\"publish\".
- For background local script inventory questions, use list_scripts or get_script. These tools do not switch tabs or disturb the user's selected script. For selected/visible local Scripts tab questions, use get_selected_script_context or get_visible_context(includeContent=true). For creating or editing a local script, call update_selected_script with title, shell, content/content_md, and mode=\"draft\" unless the user asks to save or run. For save locally use save_selected_script or update_selected_script(mode=\"local\"). For saved selected or named scripts, prefer run_local_script with script_id when available or an exact script_name; use run_selected_script when a selected draft may need saving first. Script run tools are fire-and-forget: once accepted, tell the user it started and stop; do not monitor logs unless the user explicitly asks.
- For readable input assets, call list_assets and use an existing local_path when present; if an asset is Cloud-only, call download_asset first and use download_asset_status if you need to verify transfer state. For generated screenshots, images, media, or reusable file assets, call get_asset_root with a filename first, write the generated file to the returned local_path, then call upload_asset with that path. Use upload_asset_status to verify uploads. When completing a Loopspace checkpoint that generated assets, include asset_id or asset_ids in record_loopspace_step_progress.
- For Loopspace manual trigger requests, call run_loopspace_trigger with a trigger_id or trigger_name and optional payload. For trigger inventory edits, always specify trigger_type when creating, use update_loopspace_trigger for rename/enable/disable/rotate/auth changes, and use delete_loopspace_trigger only when the user clearly asks to remove a trigger.
- For Loopspace graph edits, call get_loopspace_graph and list_loopspace_triggers first. Loopspace graphs use .dfblueprint source with explicit node ids, typed node kinds, and edge node.port -> node.port connections. Trigger nodes are references to reusable trigger inventory: if the requested cron/webhook/manual trigger does not exist, call create_loopspace_trigger first with an explicit trigger_type, then patch_loopspace_graph with op=\"attach_trigger\" and trigger_id. Webhook triggers are inbound; they default to signed_hmac, and public_token is allowed only when the user explicitly asks for a public URL and public_webhook_confirmed=true is set. Never invent standalone cron/manual/webhook trigger nodes in the graph source.
- For add_node, use supported node kinds: document_read, document_write, asset_read, asset_write, run_script, send_message, dispatch_todos, notify_device, or step. Device nodes are legacy saved-graph compatibility only; target devices are selected on send_message, dispatch_todos, run_script, and notify_device nodes. When a Loopspace should send a message to the terminal orchestrator or coding agent, model it as a send_message action region; do not model that as queue_todo, dispatch_todos, or a loose terminal edge. When a Loopspace should dispatch queued todos to workspace terminals, model it as a dispatch_todos action region. send_message and dispatch_todos can both contain child step nodes for internal checkpoints with parent_id set to the action node id; dispatch_todos can also be direct with target_workspace_ids and todo_lines and no children.
- Connect trigger.out -> send_message.in or dispatch_todos.in; connect document_read.docs or asset_read.assets -> step.in for readable context; connect step.docs -> document_write.in and step.assets -> asset_write.in for generated outputs; and connect step.success -> run_script.in/send_message.in/dispatch_todos.in/notify_device.in for follow-up actions. Legal ports include trigger.out; run_script/send_message/dispatch_todos/notify_device exec, success, failure, and interrupt; document_read/document_write docs; asset_read/asset_write assets; step success/docs/assets; and target .in ports. Resource nodes use doc_refs or asset_refs for selected inputs, create_name for generated outputs, h for height, and target_mode for selection/create behavior. Send-message nodes use prompt plus optional device_id/target_device_id, device_label/target_device_label, target_agent_id, target_terminal_id, model, reasoning_effort, and speed. Dispatch todo nodes use target_workspace_ids and todo_lines plus device_id/target_device_id, target_agent_id, model, reasoning_effort, speed, and terminal targeting; set target_terminal_mode=\"auto\" or omit terminal selectors for any terminal, and set target_terminal_mode=\"pinned\" with target_terminal_id, target_terminal_index, or target_terminal_name for a specific terminal.
- Loopspace packets use compact LS/1 lines instead of verbose JSON. When executing a Dispatch Todo with loop_runtime_run_id, the initial todo contains the complete dispatched todo body together with the run identity. Call coordination-kernel.start_task with loopspace_id, loop_runtime_run_id, loop_runtime_node_id, loop_runtime_edge_id, trigger_id, and trigger_run_id when present, wait for its response, and use the LS/1 run_context in loopspace_run_context. It returns only the connected subloop slice, the main Dispatch Todo action for direct runs or the first/current child checkpoint for stepped runs, and the exact docs/assets read-write resources. coordination-kernel.start_task creates the local task and injects the Cloud-backed Loopspace run context; coordination-kernel.checkpoint remains local visibility only. After each local checkpoint, call record_loopspace_step_progress, include the loop runtime ids, wait for the response, and follow next_checkpoint before moving on. For dispatch_todos, todo queue status is the final source of completed/failed/interrupted state; checkpoint progress only updates the internal step display. Do not connect send_message.exec, send_message.success, dispatch_todos.exec, dispatch_todos.success, run_script.exec, or other action execution branches directly into document_write or asset_write; route generated docs/assets through child step docs/assets ports. Prefer patch_loopspace_graph for attach_trigger, add_node, move_node, remove_node, connect, disconnect, and update_node_props; specify from_port and to_port on connect operations, especially from run_script/send_message/dispatch_todos/notify_device action nodes. Use update_loopspace_graph only for larger full-source rewrites, preserve existing ids, and wait for the hydrated result.
- For tab or workspace navigation and terminal management, use select_tab, select_workspace, list_terminals, open_terminals, close_terminals, or focus_terminal.

Do not search for legacy account-skills.md or random files when the app-control tools can answer or edit the live UI state. Ask a brief clarifying question only when the visible context is missing and the user's target cannot be inferred.";
const OPENCODE_CONFIG_CONTENT_ENV: &str = "OPENCODE_CONFIG_CONTENT";

fn app_control_orchestrator_instructions_body() -> String {
    format!(
        "# Diff Forge App-Control Orchestrator\n\n{}\n",
        APP_CONTROL_ORCHESTRATOR_SYSTEM_PROMPT
    )
}

fn diffforge_app_control_orchestrator_instructions_path() -> PathBuf {
    env::temp_dir()
        .join("diffforge-app-control")
        .join("orchestrator-instructions.md")
}

fn ensure_diffforge_app_control_orchestrator_instructions_file() -> Result<PathBuf, String> {
    let path = diffforge_app_control_orchestrator_instructions_path();
    let Some(parent) = path.parent() else {
        return Err("Unable to prepare app-control orchestrator instruction path.".to_string());
    };
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Unable to prepare app-control orchestrator instruction directory {}: {error}",
            parent.display()
        )
    })?;

    let body = app_control_orchestrator_instructions_body();
    if fs::read_to_string(&path).ok().as_deref() != Some(body.as_str()) {
        fs::write(&path, body).map_err(|error| {
            format!(
                "Unable to write app-control orchestrator instructions {}: {error}",
                path.display()
            )
        })?;
    }
    Ok(path)
}

fn terminal_args_with_app_control_mcp_identity(
    provider_id: &str,
    args: &[String],
    app_control_command: &str,
    app_control_args: &[String],
) -> Result<Vec<String>, String> {
    let provider_id = provider_id.to_ascii_lowercase();
    let is_codex = provider_id.contains("codex");
    let is_claude = provider_id.contains("claude");
    if !is_codex && !is_claude {
        return Ok(args.to_vec());
    }

    let mut next = args.to_vec();
    if is_codex {
        append_codex_app_control_developer_instructions_arg(&mut next);
        append_codex_mcp_server_config_args(
            &mut next,
            APP_CONTROL_MCP_SERVER_NAME,
            app_control_command,
            app_control_args,
        );
        for tool in APP_CONTROL_MCP_TOOL_NAMES {
            append_codex_mcp_tool_approval_arg(&mut next, APP_CONTROL_MCP_SERVER_NAME, tool);
        }
        next.push("-c".to_string());
        next.push("shell_environment_policy.inherit=all".to_string());
    }

    if is_claude {
        next.push("--append-system-prompt".to_string());
        next.push(APP_CONTROL_ORCHESTRATOR_SYSTEM_PROMPT.to_string());

        strip_terminal_arg_option(&mut next, "--mcp-config", "", true);
        next.push("--mcp-config".to_string());
        next.push(claude_app_control_mcp_config_arg(
            app_control_command,
            app_control_args,
        )?);

        strip_terminal_arg_option(&mut next, "--allowedTools", "", true);
        strip_terminal_arg_option(&mut next, "--allowed-tools", "", true);
        next.push("--allowedTools".to_string());
        next.push(
            APP_CONTROL_MCP_TOOL_NAMES
                .iter()
                .map(|tool| format!("mcp__{APP_CONTROL_MCP_SERVER_NAME}__{tool}"))
                .collect::<Vec<_>>()
                .join(","),
        );

        apply_claude_managed_mcp_isolation_args(&mut next);
    }

    Ok(next)
}

fn terminal_env_vars_with_app_control_mcp_identity(
    provider_id: &str,
    env_vars: &[(String, String)],
    app_control_command: &str,
    app_control_args: &[String],
) -> Result<Vec<(String, String)>, String> {
    let mut next = env_vars.to_vec();
    let provider_id = provider_id.to_ascii_lowercase();
    if !provider_id.contains("opencode") {
        return Ok(next);
    }

    let existing_config = next
        .iter()
        .rev()
        .find_map(|(key, value)| (key == OPENCODE_CONFIG_CONTENT_ENV).then(|| value.trim()))
        .filter(|value| !value.is_empty());
    let mut config = if let Some(existing_config) = existing_config {
        serde_json::from_str::<Value>(existing_config)
            .map_err(|error| format!("Invalid OpenCode inline config JSON: {error}"))?
    } else {
        json!({})
    };
    let Some(config_object) = config.as_object_mut() else {
        return Err("OpenCode inline config must be a JSON object.".to_string());
    };
    config_object
        .entry("$schema".to_string())
        .or_insert_with(|| Value::String("https://opencode.ai/config.json".to_string()));

    if !config_object
        .get("mcp")
        .map_or(true, |value| value.is_object())
    {
        return Err("OpenCode inline config field `mcp` must be a JSON object.".to_string());
    }
    let mcp_servers = config_object
        .entry("mcp".to_string())
        .or_insert_with(|| Value::Object(serde_json::Map::new()))
        .as_object_mut()
        .ok_or_else(|| "Unable to prepare OpenCode MCP config.".to_string())?;

    let mut command = vec![Value::String(app_control_command.to_string())];
    command.extend(app_control_args.iter().cloned().map(Value::String));
    mcp_servers.insert(
        APP_CONTROL_MCP_SERVER_NAME.to_string(),
        json!({
            "type": "local",
            "command": command,
            "enabled": true,
            "timeout": APP_CONTROL_MCP_SCRIPT_RUN_TIMEOUT_MS,
            "environment": {
                "DIFFFORGE_APP_CONTROL_MCP": "1"
            }
        }),
    );

    let instruction_path = ensure_diffforge_app_control_orchestrator_instructions_file()?
        .to_string_lossy()
        .to_string();
    let instructions = config_object
        .entry("instructions".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    let Some(instructions_array) = instructions.as_array_mut() else {
        return Err(
            "OpenCode inline config field `instructions` must be a JSON array.".to_string(),
        );
    };
    if !instructions_array
        .iter()
        .any(|value| value.as_str() == Some(instruction_path.as_str()))
    {
        instructions_array.push(Value::String(instruction_path));
    }

    // The app-control orchestrator drives the terminal, so auto-approve its
    // tools like Codex/Claude do. Coordinated terminals set the same block
    // later (identical value), so this composes cleanly.
    config_object.insert(
        "permission".to_string(),
        opencode_auto_approval_permission_value(),
    );

    set_terminal_env_var(&mut next, OPENCODE_CONFIG_CONTENT_ENV, &config.to_string());
    Ok(next)
}

fn claude_app_control_mcp_config_arg(
    app_control_command: &str,
    app_control_args: &[String],
) -> Result<String, String> {
    let mut servers = serde_json::Map::new();
    servers.insert(
        APP_CONTROL_MCP_SERVER_NAME.to_string(),
        json!({
            "command": app_control_command,
            "args": app_control_args,
            "env": {
                "DIFFFORGE_APP_CONTROL_MCP": "1"
            },
            "diffforge": {
                "scope": "app-control",
                "always_on": true,
                "toggleable": false,
                "authority": "local_app_control"
            }
        }),
    );
    let config = json!({ "mcpServers": servers });

    #[cfg(windows)]
    {
        let config_dir = env::temp_dir().join("diffforge-app-control-mcp");
        fs::create_dir_all(&config_dir).map_err(|error| {
            format!(
                "Unable to create app-control MCP config directory {}: {error}",
                config_dir.display()
            )
        })?;
        let config_path =
            config_dir.join(format!("claude-app-control-{}.json", uuid::Uuid::new_v4()));
        fs::write(&config_path, config.to_string()).map_err(|error| {
            format!(
                "Unable to write app-control MCP config {}: {error}",
                config_path.display()
            )
        })?;
        return Ok(config_path.to_string_lossy().to_string());
    }

    #[cfg(not(windows))]
    {
        Ok(config.to_string())
    }
}

fn append_codex_mcp_server_config_args(
    args: &mut Vec<String>,
    server_key: &str,
    command: &str,
    server_args: &[String],
) {
    let key = terminal_toml_key_segment(server_key);
    for value in [
        (format!("mcp_servers.{key}.enabled"), "true".to_string()),
        (
            format!("mcp_servers.{key}.command"),
            terminal_toml_string(command),
        ),
        (
            format!("mcp_servers.{key}.args"),
            terminal_toml_string_array(server_args),
        ),
        (
            format!("mcp_servers.{key}.default_tools_approval_mode"),
            terminal_toml_string("prompt"),
        ),
    ] {
        args.push("-c".to_string());
        args.push(format!("{}={}", value.0, value.1));
    }
}

fn append_codex_mcp_tool_approval_arg(args: &mut Vec<String>, server_key: &str, tool: &str) {
    let server_key = terminal_toml_key_segment(server_key);
    let tool = terminal_toml_key_segment(tool);
    args.push("-c".to_string());
    args.push(format!(
        "mcp_servers.{server_key}.tools.{tool}.approval_mode={}",
        terminal_toml_string("approve")
    ));
}

fn append_codex_app_control_developer_instructions_arg(args: &mut Vec<String>) {
    let existing = take_codex_config_string_override(args, "developer_instructions");
    let instructions = match existing {
        Some(existing) if existing.trim().is_empty() => {
            APP_CONTROL_ORCHESTRATOR_SYSTEM_PROMPT.to_string()
        }
        Some(existing) if existing.contains(APP_CONTROL_ORCHESTRATOR_SYSTEM_PROMPT) => existing,
        Some(existing) => format!("{existing}\n\n{APP_CONTROL_ORCHESTRATOR_SYSTEM_PROMPT}"),
        None => APP_CONTROL_ORCHESTRATOR_SYSTEM_PROMPT.to_string(),
    };
    args.push("-c".to_string());
    args.push(format!(
        "developer_instructions={}",
        terminal_toml_string(&instructions)
    ));
}

fn take_codex_config_string_override(args: &mut Vec<String>, key: &str) -> Option<String> {
    let mut next = Vec::with_capacity(args.len());
    let mut value = None;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if (arg == "-c" || arg == "--config") && index + 1 < args.len() {
            if let Some(candidate) = codex_config_string_override_value(&args[index + 1], key) {
                if let Some(candidate) = candidate {
                    value = Some(candidate);
                }
                index += 2;
                continue;
            }
        }

        if let Some(config) = arg.strip_prefix("--config=") {
            if let Some(candidate) = codex_config_string_override_value(config, key) {
                if let Some(candidate) = candidate {
                    value = Some(candidate);
                }
                index += 1;
                continue;
            }
        }

        next.push(arg.clone());
        index += 1;
    }
    *args = next;
    value
}

fn codex_config_string_override_value(config: &str, key: &str) -> Option<Option<String>> {
    let (candidate_key, raw_value) = config.split_once('=')?;
    if candidate_key.trim() != key {
        return None;
    }
    Some(terminal_toml_string_literal_value(raw_value))
}

fn terminal_toml_string_literal_value(value: &str) -> Option<String> {
    let value = value.trim();
    if value.starts_with("'''") && value.ends_with("'''") && value.len() >= 6 {
        return Some(value[3..value.len().saturating_sub(3)].to_string());
    }
    if !(value.starts_with('"') && value.ends_with('"') && value.len() >= 2) {
        return None;
    }
    let body = &value[1..value.len().saturating_sub(1)];
    let mut output = String::new();
    let mut chars = body.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            output.push(ch);
            continue;
        }
        match chars.next() {
            Some('n') => output.push('\n'),
            Some('r') => output.push('\r'),
            Some('t') => output.push('\t'),
            Some('"') => output.push('"'),
            Some('\\') => output.push('\\'),
            Some(other) => output.push(other),
            None => return None,
        }
    }
    Some(output)
}

fn terminal_toml_key_segment(value: &str) -> String {
    if !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
    {
        value.to_string()
    } else {
        format!("\"{}\"", terminal_toml_escape(value))
    }
}

const TERMINAL_PERMISSION_MODE_PLAN: &str = "plan";
const TERMINAL_PERMISSION_MODE_ASK: &str = "ask";
const TERMINAL_PERMISSION_MODE_ACCEPT_EDITS: &str = "accept_edits";
const TERMINAL_PERMISSION_MODE_AUTO: &str = "auto";
const TERMINAL_PERMISSION_MODE_FULL_ACCESS: &str = "full_access";
const TERMINAL_PERMISSION_MODE_BYPASS: &str = "bypass";

fn terminal_normalize_permission_mode(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let mode = value.trim().to_ascii_lowercase().replace([' ', '-'], "_");
    if mode.is_empty() || mode == "default" {
        return Ok(None);
    }

    let normalized = match mode.as_str() {
        "plan" | "plan_mode" => TERMINAL_PERMISSION_MODE_PLAN,
        "ask" | "ask_each" | "ask_each_time" | "default" => TERMINAL_PERMISSION_MODE_ASK,
        "accept" | "accept_edit" | "accept_edits" | "acceptedits" => {
            TERMINAL_PERMISSION_MODE_ACCEPT_EDITS
        }
        "auto" | "auto_mode" | "automode" => TERMINAL_PERMISSION_MODE_AUTO,
        "full" | "full_access" | "fullaccess" | "danger_full_access" | "dangerfullaccess" => {
            TERMINAL_PERMISSION_MODE_FULL_ACCESS
        }
        "bypass" | "bypass_permissions" | "bypasspermissions" => TERMINAL_PERMISSION_MODE_BYPASS,
        _ => return Err("Agent permission mode is invalid.".to_string()),
    };

    Ok(Some(normalized.to_string()))
}

fn apply_codex_terminal_display_args(args: &mut Vec<String>) {
    if !terminal_args_have_option(args, "--no-alt-screen", "") {
        args.push("--no-alt-screen".to_string());
    }
}

fn terminal_interactive_resume_args(provider_id: &str, args: &[String]) -> Vec<String> {
    let provider_id = provider_id.trim().to_ascii_lowercase();
    if provider_id.contains("claude") {
        let mut next = Vec::with_capacity(args.len());
        let mut index = 0;
        while index < args.len() {
            let arg = args[index].as_str();
            if matches!(arg, "--continue" | "-c") {
                index += 1;
                continue;
            }
            if matches!(arg, "--resume" | "-r") {
                let has_explicit_session = args
                    .get(index + 1)
                    .is_some_and(|value| !value.trim().is_empty() && !value.starts_with('-'));
                if has_explicit_session {
                    next.push(args[index].clone());
                    next.push(args[index + 1].clone());
                    index += 2;
                } else {
                    index += 1;
                }
                continue;
            }
            if arg == "--resume=" || arg == "-r=" {
                index += 1;
                continue;
            }
            next.push(args[index].clone());
            index += 1;
        }
        return next;
    }

    let mut next = args.to_vec();
    if provider_id.contains("codex")
        && next.first().is_some_and(|arg| arg == "resume")
        && !next.iter().any(|arg| arg == "--last")
        && !next
            .get(1)
            .is_some_and(|arg| !arg.trim().is_empty() && !arg.starts_with('-'))
    {
        // Codex documents `resume --last` as the non-picker fallback. A
        // tracked session id remains preferable and is preserved above.
        next.insert(1, "--last".to_string());
    }
    next
}

fn apply_codex_interactive_permission_args(args: &mut Vec<String>, permission_mode: Option<&str>) {
    let permission_mode = permission_mode.unwrap_or(TERMINAL_PERMISSION_MODE_ACCEPT_EDITS);
    strip_terminal_arg_option(args, "--ask-for-approval", "-a", true);
    strip_terminal_arg_option(args, "--sandbox", "-s", true);
    strip_terminal_arg_option(
        args,
        "--dangerously-bypass-approvals-and-sandbox",
        "",
        false,
    );
    if permission_mode == TERMINAL_PERMISSION_MODE_BYPASS {
        args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
        return;
    }

    let (approval, sandbox) = match permission_mode {
        TERMINAL_PERMISSION_MODE_PLAN => ("never", "read-only"),
        TERMINAL_PERMISSION_MODE_ASK => ("on-request", "workspace-write"),
        TERMINAL_PERMISSION_MODE_FULL_ACCESS => ("never", "danger-full-access"),
        _ => ("never", "workspace-write"),
    };
    args.push("--ask-for-approval".to_string());
    args.push(approval.to_string());
    args.push("--sandbox".to_string());
    args.push(sandbox.to_string());
}

fn terminal_env_truthy(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn strip_terminal_arg_option(args: &mut Vec<String>, long: &str, short: &str, takes_value: bool) {
    let mut next = Vec::with_capacity(args.len());
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        let exact = arg == long || (!short.is_empty() && arg == short);
        let inline = (!long.is_empty() && arg.starts_with(&format!("{long}=")))
            || (!short.is_empty() && arg.starts_with(&format!("{short}=")));
        if exact {
            index += 1;
            if takes_value && index < args.len() {
                index += 1;
            }
            continue;
        }
        if inline {
            index += 1;
            continue;
        }
        next.push(arg.clone());
        index += 1;
    }
    *args = next;
}

fn apply_claude_interactive_permission_mode_arg(
    args: &mut Vec<String>,
    permission_mode: Option<&str>,
) {
    let permission_mode = permission_mode.unwrap_or(TERMINAL_PERMISSION_MODE_ACCEPT_EDITS);
    strip_terminal_arg_option(args, "--permission-mode", "", true);
    args.push("--permission-mode".to_string());
    args.push(claude_permission_mode_arg(permission_mode).to_string());
}

fn apply_claude_managed_mcp_isolation_args(args: &mut Vec<String>) {
    if terminal_args_have_any_option(args, &["--mcp-config"])
        && !terminal_args_have_any_option(args, &["--strict-mcp-config"])
    {
        args.push("--strict-mcp-config".to_string());
    }
}

fn claude_permission_mode_arg(permission_mode: &str) -> &'static str {
    match permission_mode {
        TERMINAL_PERMISSION_MODE_PLAN => "plan",
        TERMINAL_PERMISSION_MODE_ASK => "default",
        TERMINAL_PERMISSION_MODE_AUTO | TERMINAL_PERMISSION_MODE_FULL_ACCESS => "auto",
        TERMINAL_PERMISSION_MODE_BYPASS => "bypassPermissions",
        _ => "acceptEdits",
    }
}

fn extend_terminal_activity_env_vars(
    env_vars: &mut Vec<(String, String)>,
    workspace_root: Option<&Path>,
    _pane_id: &str,
    _instance_id: u64,
    _workspace_id: Option<&str>,
    _terminal_index: Option<u16>,
    provider_id: &str,
    _activity_transport: Option<&TerminalActivityTransportEndpoint>,
    launch_account_binding: Option<&TerminalProviderLaunchAccountBinding>,
) -> Result<(), String> {
    if let Some(workspace_root) = workspace_root {
        set_terminal_env_var(
            env_vars,
            "DIFFFORGE_WORKSPACE_ROOT",
            &workspace_root.to_string_lossy(),
        );
    }
    // Resume/open resolution captures a provider account before asynchronous
    // launch work begins. Apply only that frozen provider environment here;
    // the pane stamp is committed after the process/PTY launch succeeds.
    if agent_accounts_supported_kind(provider_id).is_some() {
        let provider_binding = launch_account_binding
            .filter(|binding| binding.matches_provider_id(provider_id))
            .ok_or_else(|| {
                format!(
                    "Unable to build the {provider_id} launch environment without a frozen account binding."
                )
            })?;
        provider_binding.apply_to_env(env_vars);
    }
    Ok(())
}

fn stamp_terminal_launch_account(
    pane_id: &str,
    instance_id: u64,
    launch_epoch: &str,
    provider_id: &str,
    workspace_id: Option<&str>,
    terminal_index: Option<u16>,
    launch_account_binding: &TerminalProviderLaunchAccountBinding,
    workspace_trust: Option<&Value>,
) {
    let Some(account_binding) = launch_account_binding
        .matches_provider_id(provider_id)
        .then(|| launch_account_binding.captured_account())
        .flatten()
    else {
        return;
    };
    agent_accounts_stamp_captured_spawn(
        pane_id,
        Some(instance_id),
        Some(launch_epoch),
        provider_id,
        workspace_id,
        None,
        terminal_index,
        account_binding,
        workspace_trust,
    );
}

fn prepare_terminal_launch_account(
    env_vars: &[(String, String)],
    provider_id: &str,
    launch_account_binding: &TerminalProviderLaunchAccountBinding,
) -> Result<Option<Value>, String> {
    // Haider accounts live in the daemon and switch in realtime; no frozen
    // per-launch capture applies, so launches must not require one.
    if provider_id == "haider" {
        return Ok(None);
    }
    let account_binding = launch_account_binding
        .matches_provider_id(provider_id)
        .then(|| launch_account_binding.captured_account())
        .flatten()
        .ok_or_else(|| {
            format!(
                "Unable to freeze the {provider_id} account for this terminal launch."
            )
        })?;
    agent_accounts_prepare_captured_spawn(env_vars, account_binding)
}

fn set_terminal_env_var(env_vars: &mut Vec<(String, String)>, key: &str, value: &str) {
    env_vars.retain(|(existing_key, _)| existing_key != key);
    env_vars.push((key.to_string(), value.to_string()));
}

fn terminal_app_bridge_env_vars() -> Vec<(String, String)> {
    let endpoint = env::var(DIFFFORGE_APP_BRIDGE_ENDPOINT_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let token = env::var(DIFFFORGE_APP_BRIDGE_TOKEN_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    match (endpoint, token) {
        (Some(endpoint), Some(token)) => vec![
            (DIFFFORGE_APP_BRIDGE_ENDPOINT_ENV.to_string(), endpoint),
            (DIFFFORGE_APP_BRIDGE_TOKEN_ENV.to_string(), token),
        ],
        _ => Vec::new(),
    }
}

fn apply_codex_resume_home_env(
    env_vars: &mut Vec<(String, String)>,
    source_home: &str,
    provider_session_id: &str,
    launch_account_binding: Option<&TerminalProviderLaunchAccountBinding>,
) -> Result<(), String> {
    let source_home = source_home.trim();
    if source_home.is_empty() {
        return Ok(());
    }
    let managed_home = env_vars
        .iter()
        .rev()
        .find_map(|(key, value)| {
            (key == "DIFFFORGE_CODEX_HOME")
                .then_some(value.trim())
                .filter(|value| !value.is_empty())
        })
        .map(ToString::to_string);
    let frozen_account_home = launch_account_binding
        .and_then(TerminalProviderLaunchAccountBinding::codex_auth_home)
        .map(Path::to_path_buf);
    let launch_home = managed_home
        .map(PathBuf::from)
        .or(frozen_account_home)
        .unwrap_or_else(|| PathBuf::from(source_home));
    if launch_home != Path::new(source_home) {
        materialize_codex_rollout_in_managed_home(
            provider_session_id,
            Path::new(source_home),
            &launch_home,
        )?;
    }
    let launch_home = launch_home.to_string_lossy();
    // Resume/fork may originate in a global home, another account profile, or
    // another coordinated slot. It contributes only the rollout; the frozen
    // account/managed home remains authoritative for auth and policy.
    set_terminal_env_var(env_vars, "CODEX_HOME", &launch_home);
    set_terminal_env_var(env_vars, "DIFFFORGE_CODEX_HOME", &launch_home);
    Ok(())
}

fn validate_terminal_agent_launch_args_for_platform(
    provider_id: &str,
    args: &[String],
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let provider_id = provider_id.trim().to_ascii_lowercase();
        if provider_id.contains("claude") && terminal_args_have_inline_claude_mcp_config(args) {
            return Err(
                "Claude Code launch on Windows requires a file-backed MCP config; inline JSON is unsafe through the Windows terminal launch path."
                    .to_string(),
            );
        }
    }

    let _ = provider_id;
    let _ = args;
    Ok(())
}

#[cfg(windows)]
fn terminal_args_have_inline_claude_mcp_config(args: &[String]) -> bool {
    args.windows(2).any(|pair| {
        (pair[0] == "--mcp-config")
            && pair[1].trim_start().starts_with('{')
            && pair[1].contains("mcpServers")
    })
}

fn terminal_args_have_option(args: &[String], long: &str, short: &str) -> bool {
    args.iter().any(|arg| {
        arg == long
            || (!short.is_empty() && arg == short)
            || (!long.is_empty() && arg.starts_with(&format!("{long}=")))
    })
}

fn terminal_args_have_option_value(args: &[String], long: &str, short: &str, value: &str) -> bool {
    let value = value.trim();
    args.windows(2).any(|pair| {
        (pair[0] == long || (!short.is_empty() && pair[0] == short)) && pair[1].trim() == value
    }) || args.iter().any(|arg| {
        (!long.is_empty()
            && arg
                .strip_prefix(&format!("{long}="))
                .is_some_and(|candidate| candidate.trim() == value))
            || (!short.is_empty()
                && arg
                    .strip_prefix(&format!("{short}="))
                    .is_some_and(|candidate| candidate.trim() == value))
    })
}

fn terminal_args_have_any_option(args: &[String], options: &[&str]) -> bool {
    options
        .iter()
        .any(|option| terminal_args_have_option(args, option, ""))
}

fn terminal_toml_string_array(values: &[String]) -> String {
    let items = values
        .iter()
        .map(|value| terminal_toml_string(value))
        .collect::<Vec<_>>()
        .join(", ");
    format!("[{items}]")
}

#[cfg(windows)]
fn terminal_toml_string(value: &str) -> String {
    // The Windows PowerShell/npm launch path strips embedded double quotes from Codex -c values.
    if value.contains("'''") {
        format!("\"{}\"", terminal_toml_escape(value))
    } else {
        format!("'''{}'''", value)
    }
}

#[cfg(not(windows))]
fn terminal_toml_string(value: &str) -> String {
    format!("\"{}\"", terminal_toml_escape(value))
}

fn terminal_toml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(not(windows))]
fn terminal_agent_launch_command(
    command_path: &str,
    args: &[String],
    working_directory: &Path,
    banner: Option<&str>,
) -> CommandBuilder {
    if let Some(banner) = banner {
        let mut invocation = quote_shell_literal(command_path);

        for arg in args {
            invocation.push(' ');
            invocation.push_str(&quote_shell_literal(arg));
        }

        let mut command = terminal_idle_shell_command();
        command.arg("-lc");
        command.arg(format!(
            "printf %s {}; exec {}",
            quote_shell_literal(banner),
            invocation
        ));
        command.cwd(working_directory);
        return command;
    }

    let mut command = CommandBuilder::new(command_path);
    for arg in args {
        command.arg(arg.as_str());
    }
    command.cwd(working_directory);

    command
}

#[cfg(not(windows))]
fn terminal_set_working_directory_input(working_directory: &Path) -> String {
    let directory = working_directory.to_string_lossy();

    format!("cd {}\n", quote_shell_literal(&directory))
}

#[cfg(not(windows))]
fn terminal_agent_start_input_with_env_in_directory(
    command_path: &str,
    args: &[String],
    working_directory: &Path,
    env_vars: &[(String, String)],
) -> String {
    preflight_interactive_claude_workspace_trust(command_path, working_directory, env_vars);
    let mut input = terminal_set_working_directory_input(working_directory);
    for (key, value) in env_vars {
        if key.trim().is_empty() {
            continue;
        }
        input.push_str("export ");
        input.push_str(key);
        input.push('=');
        input.push_str(&quote_shell_literal(value));
        input.push('\n');
    }
    input.push_str(&terminal_agent_start_input(command_path, args));
    input
}

fn default_terminal_working_directory() -> PathBuf {
    env::current_dir()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf).or(Some(path)))
        .unwrap_or_else(|| {
            env::var_os("USERPROFILE")
                .or_else(|| env::var_os("HOME"))
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
        })
}

fn path_is_inside_agent_worktree(path: &Path) -> bool {
    let mut saw_agents = false;
    for component in path.components() {
        let Component::Normal(value) = component else {
            continue;
        };
        let name = value.to_string_lossy().to_ascii_lowercase();
        if saw_agents && name == "worktrees" {
            return true;
        }
        saw_agents = name == ".agents";
    }
    false
}

fn safe_background_command_working_directory() -> PathBuf {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .unwrap_or_else(env::temp_dir)
}

fn configure_safe_process_current_directory() {
    let Ok(current_dir) = env::current_dir() else {
        return;
    };
    if !path_is_inside_agent_worktree(&current_dir) {
        return;
    }

    let safe_dir = safe_background_command_working_directory();
    let _ = env::set_current_dir(safe_dir);
}

const TERMINAL_EMULATION_TERM: &str = "xterm-256color";
const TERMINAL_EMULATION_COLORTERM: &str = "truecolor";
const TERMINAL_EMULATION_FORCE_COLOR: &str = "1";
const OPENCODE_TUI_CONFIG_ENV: &str = "OPENCODE_TUI_CONFIG";
const OPENCODE_TUI_SYSTEM_THEME: &str = "system";
#[cfg(windows)]
const TERMINAL_EMULATION_PROGRAM: &str = "vscode";
#[cfg(not(windows))]
const TERMINAL_EMULATION_PROGRAM: &str = "DiffForge";

fn diffforge_opencode_tui_config_path() -> PathBuf {
    env::temp_dir()
        .join("diffforge-opencode")
        .join("tui-system.json")
}

fn ensure_diffforge_opencode_tui_config() -> Result<PathBuf, String> {
    let path = diffforge_opencode_tui_config_path();
    let Some(parent) = path.parent() else {
        return Err("Unable to prepare OpenCode TUI config path.".to_string());
    };
    fs::create_dir_all(parent)
        .map_err(|error| format!("Unable to prepare OpenCode TUI config directory: {error}"))?;

    let config = json!({
        "$schema": "https://opencode.ai/tui.json",
        "theme": OPENCODE_TUI_SYSTEM_THEME
    });
    let body = format!(
        "{}\n",
        serde_json::to_string_pretty(&config).unwrap_or_else(|_| config.to_string())
    );
    if fs::read_to_string(&path).ok().as_deref() != Some(body.as_str()) {
        fs::write(&path, body)
            .map_err(|error| format!("Unable to write OpenCode TUI config: {error}"))?;
    }
    Ok(path)
}

fn terminal_env_vars_with_opencode_tui_config(
    provider_id: &str,
    env_vars: &[(String, String)],
) -> Result<Vec<(String, String)>, String> {
    let mut next = env_vars.to_vec();
    let normalized_provider = provider_id.trim().to_ascii_lowercase();
    set_terminal_env_var(&mut next, "DIFFFORGE_MANAGED_AGENT_TERMINAL", "1");
    if normalized_provider.contains("claude") {
        set_terminal_env_var(&mut next, "DISABLE_AUTOUPDATER", "1");
    }
    if normalized_provider.contains("codex") {
        set_terminal_env_var(&mut next, "DIFFFORGE_CODEX_UPDATE_CHECK_DISABLED", "1");
    }
    if !normalized_provider.contains("opencode") {
        return Ok(next);
    }

    next.retain(|(key, _)| key != OPENCODE_TUI_CONFIG_ENV);
    next.push((
        OPENCODE_TUI_CONFIG_ENV.to_string(),
        ensure_diffforge_opencode_tui_config()?
            .to_string_lossy()
            .to_string(),
    ));
    Ok(next)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClaudeWorkspaceTrustMergeOutcome {
    Updated,
    Unchanged,
    SkippedInvalidConfig,
}

struct ClaudeWorkspaceTrustLock {
    path: PathBuf,
}

impl Drop for ClaudeWorkspaceTrustLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn terminal_launch_env_value<'a>(env_vars: &'a [(String, String)], key: &str) -> Option<&'a str> {
    env_vars
        .iter()
        .rev()
        .find_map(|(candidate, value)| (candidate == key).then_some(value.as_str()))
}

fn terminal_safe_absolute_launch_path(value: &str) -> Option<PathBuf> {
    let path = PathBuf::from(value.trim());
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return None;
    }
    Some(path)
}

fn claude_config_path_for_interactive_launch(env_vars: &[(String, String)]) -> Option<PathBuf> {
    if let Some(config_dir) = terminal_launch_env_value(env_vars, "CLAUDE_CONFIG_DIR") {
        return terminal_safe_absolute_launch_path(config_dir)
            .map(|directory| directory.join(".claude.json"));
    }

    let launch_home = terminal_launch_env_value(env_vars, "USERPROFILE")
        .or_else(|| terminal_launch_env_value(env_vars, "HOME"))
        .map(str::to_string)
        .or_else(|| user_home_dir().map(|home| home.to_string_lossy().to_string()))?;
    terminal_safe_absolute_launch_path(&launch_home).map(|home| home.join(".claude.json"))
}

fn claude_managed_workspace_for_interactive_launch(
    command_path: &str,
    working_directory: &Path,
    env_vars: &[(String, String)],
) -> Option<PathBuf> {
    if !terminal_launch_env_value(env_vars, "DIFFFORGE_MANAGED_AGENT_TERMINAL")
        .is_some_and(terminal_env_truthy)
    {
        return None;
    }
    let provider = terminal_launch_env_value(env_vars, "DIFFFORGE_TERMINAL_PROVIDER")?;
    if !provider.trim().to_ascii_lowercase().contains("claude") {
        return None;
    }
    let command_name = Path::new(command_path)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if command_name != "claude" {
        return None;
    }

    let managed_root = terminal_safe_absolute_launch_path(terminal_launch_env_value(
        env_vars,
        "DIFFFORGE_WORKSPACE_ROOT",
    )?)?;
    let managed_root = fs::canonicalize(managed_root).ok()?;
    let working_directory = fs::canonicalize(working_directory).ok()?;
    (managed_root == working_directory && working_directory.is_dir()).then_some(working_directory)
}

fn claude_workspace_trust_lock_path(config_path: &Path) -> Option<PathBuf> {
    let parent = config_path.parent()?;
    let name = config_path.file_name()?.to_string_lossy();
    Some(parent.join(format!(".{name}.diffforge-trust.lock")))
}

fn acquire_claude_workspace_trust_lock(
    config_path: &Path,
) -> Result<ClaudeWorkspaceTrustLock, String> {
    const ATTEMPTS: usize = 100;
    let lock_path = claude_workspace_trust_lock_path(config_path)
        .ok_or_else(|| "Unable to resolve the Claude workspace-trust lock path.".to_string())?;
    let parent = lock_path.parent().ok_or_else(|| {
        "Unable to resolve the Claude workspace-trust config directory.".to_string()
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        format!("Unable to prepare the Claude workspace-trust config directory: {error}")
    })?;

    for _ in 0..ATTEMPTS {
        match fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&lock_path)
        {
            Ok(_) => return Ok(ClaudeWorkspaceTrustLock { path: lock_path }),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                // Never steal an apparently stale lock: another process may
                // have replaced it between metadata inspection and removal.
                // A genuinely orphaned lock safely degrades to today's trust
                // dialog instead of risking a concurrent config overwrite.
                thread::sleep(Duration::from_millis(5));
            }
            Err(error) => {
                return Err(format!(
                    "Unable to lock Claude workspace-trust state: {error}"
                ));
            }
        }
    }
    Err("Timed out locking Claude workspace-trust state.".to_string())
}

fn merge_claude_workspace_trust_config(
    config: &mut Value,
    workspace: &Path,
) -> Result<bool, String> {
    let root = config
        .as_object_mut()
        .ok_or_else(|| "Claude state is not a JSON object.".to_string())?;
    let projects = root
        .entry("projects".to_string())
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    let projects = projects
        .as_object_mut()
        .ok_or_else(|| "Claude state has an invalid projects value.".to_string())?;
    // `canonicalize` yields verbatim `\\?\` paths on Windows. Claude keys
    // project state by the normal provider-facing cwd, so strip that prefix
    // while retaining the canonical path for the trust-boundary comparison.
    let workspace_key = workspace_path_display(workspace);
    let project = projects
        .entry(workspace_key)
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    let project = project
        .as_object_mut()
        .ok_or_else(|| "Claude state has invalid project state for this workspace.".to_string())?;

    let already_trusted = project
        .get("hasTrustDialogAccepted")
        .and_then(Value::as_bool)
        == Some(true);
    let already_onboarded = project
        .get("hasCompletedProjectOnboarding")
        .and_then(Value::as_bool)
        == Some(true);
    if already_trusted && already_onboarded {
        return Ok(false);
    }
    project.insert("hasTrustDialogAccepted".to_string(), json!(true));
    project.insert("hasCompletedProjectOnboarding".to_string(), json!(true));
    Ok(true)
}

fn ensure_claude_workspace_trust_in_config(
    config_path: &Path,
    workspace: &Path,
) -> Result<ClaudeWorkspaceTrustMergeOutcome, String> {
    // Every DiffForge atomic private-state writer shares this in-process
    // guard, including account snapshot refresh/wipe paths that may replace
    // the same `.claude.json`. The adjacent lock file additionally
    // serializes separate DiffForge processes.
    let _process_guard = AGENT_ACCOUNTS_PRIVATE_FILE_WRITE_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let _lock = acquire_claude_workspace_trust_lock(config_path)?;
    let read_current = || {
        match fs::symlink_metadata(config_path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(
                    "Claude workspace-trust state is a symlink; skipped the merge.".to_string(),
                );
            }
            Ok(metadata) if !metadata.is_file() => {
                return Err(
                    "Claude workspace-trust state is not a regular file; skipped the merge."
                        .to_string(),
                );
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Unable to inspect Claude workspace-trust state: {error}"
                ));
            }
        }
        match fs::read(config_path) {
            Ok(raw) => Ok(raw),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(format!(
                "Unable to read Claude workspace-trust state: {error}"
            )),
        }
    };

    // The lock serializes every DiffForge writer. The stability check also
    // catches a provider process replacing the file while this merge is being
    // prepared, so the retry always starts from its newest complete JSON.
    for _ in 0..8 {
        let raw = read_current()?;
        let mut config = if raw.iter().all(u8::is_ascii_whitespace) {
            json!({})
        } else {
            match serde_json::from_slice::<Value>(&raw) {
                Ok(Value::Object(object)) => Value::Object(object),
                Ok(_) | Err(_) => {
                    return Ok(ClaudeWorkspaceTrustMergeOutcome::SkippedInvalidConfig);
                }
            }
        };
        let changed = match merge_claude_workspace_trust_config(&mut config, workspace) {
            Ok(changed) => changed,
            Err(_) => return Ok(ClaudeWorkspaceTrustMergeOutcome::SkippedInvalidConfig),
        };
        if read_current()? != raw {
            continue;
        }
        if !changed {
            return Ok(ClaudeWorkspaceTrustMergeOutcome::Unchanged);
        }

        let mut bytes = serde_json::to_vec_pretty(&config)
            .map_err(|error| format!("Unable to encode Claude workspace-trust state: {error}"))?;
        bytes.push(b'\n');
        agent_accounts_write_private_file_atomic_unlocked(
            config_path,
            &bytes,
            "Claude workspace trust",
        )?;
        return Ok(ClaudeWorkspaceTrustMergeOutcome::Updated);
    }
    Err(
        "Claude workspace-trust state kept changing during preflight; skipped the merge."
            .to_string(),
    )
}

fn preflight_interactive_claude_workspace_trust(
    command_path: &str,
    working_directory: &Path,
    env_vars: &[(String, String)],
) {
    let Some(workspace) =
        claude_managed_workspace_for_interactive_launch(command_path, working_directory, env_vars)
    else {
        return;
    };
    let Some(config_path) = claude_config_path_for_interactive_launch(env_vars) else {
        log_terminal_status_event(
            "backend.claude_workspace_trust.skipped",
            json!({ "reason": "unsafe_config_path" }),
        );
        return;
    };
    match ensure_claude_workspace_trust_in_config(&config_path, &workspace) {
        Ok(ClaudeWorkspaceTrustMergeOutcome::Updated) => log_terminal_status_event(
            "backend.claude_workspace_trust.updated",
            json!({ "workspace": clean_terminal_diagnostic_log_text(&workspace_path_display(&workspace)) }),
        ),
        Ok(ClaudeWorkspaceTrustMergeOutcome::Unchanged) => {}
        Ok(ClaudeWorkspaceTrustMergeOutcome::SkippedInvalidConfig) => log_terminal_status_event(
            "backend.claude_workspace_trust.skipped",
            json!({ "reason": "invalid_config" }),
        ),
        Err(error) => log_terminal_status_event(
            "backend.claude_workspace_trust.skipped",
            json!({
                "error": clean_terminal_diagnostic_log_text(&error),
                "reason": "preflight_failed",
            }),
        ),
    }
}

fn opencode_permission_value(permission_mode: Option<&str>) -> Value {
    match permission_mode.unwrap_or(TERMINAL_PERMISSION_MODE_ACCEPT_EDITS) {
        TERMINAL_PERMISSION_MODE_PLAN => json!({
            "edit": "deny",
            "bash": "deny",
            "webfetch": "ask",
            "external_directory": "deny"
        }),
        TERMINAL_PERMISSION_MODE_ASK => json!({
            "edit": "ask",
            "bash": "ask",
            "webfetch": "ask",
            "external_directory": "ask"
        }),
        TERMINAL_PERMISSION_MODE_BYPASS => json!({
            "edit": "allow",
            "bash": "allow",
            "webfetch": "allow",
            "external_directory": "allow"
        }),
        _ => json!({
            "edit": "allow",
            "bash": "ask",
            "webfetch": "ask",
            "external_directory": "deny"
        }),
    }
}

fn opencode_auto_approval_permission_value() -> Value {
    opencode_permission_value(Some(TERMINAL_PERMISSION_MODE_BYPASS))
}

fn apply_terminal_emulation_env(command: &mut CommandBuilder) {
    command.env("PATH", desktop_command_path());
    command.env("TERM", TERMINAL_EMULATION_TERM);
    command.env("COLORTERM", TERMINAL_EMULATION_COLORTERM);
    command.env("FORCE_COLOR", TERMINAL_EMULATION_FORCE_COLOR);
    command.env("CLICOLOR", TERMINAL_EMULATION_FORCE_COLOR);
    command.env("TERM_PROGRAM", TERMINAL_EMULATION_PROGRAM);
    command.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
}

fn spawn_terminal_pty(
    size: PtySize,
    mut command: CommandBuilder,
    context: &str,
) -> Result<WarmPty, String> {
    log_terminal_crash_forensics_event(
        "backend.pty.open.begin",
        json!({
            "cols": size.cols,
            "context": clean_terminal_diagnostic_log_text(context),
            "pty_backend": if cfg!(windows) { "conpty" } else { "native" },
            "rows": size.rows,
            "windows_build_number": terminal_windows_build_number(),
        }),
    );
    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(size) {
        Ok(pair) => {
            log_terminal_crash_forensics_event(
                "backend.pty.open.done",
                json!({
                    "cols": size.cols,
                    "context": clean_terminal_diagnostic_log_text(context),
                    "rows": size.rows,
                }),
            );
            pair
        }
        Err(error) => {
            log_terminal_crash_forensics_event(
                "backend.pty.open.error",
                json!({
                    "context": clean_terminal_diagnostic_log_text(context),
                    "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                }),
            );
            return Err(format!("Unable to open {context} PTY: {error}"));
        }
    };
    apply_terminal_emulation_env(&mut command);

    log_terminal_crash_forensics_event(
        "backend.pty.spawn_command.begin",
        json!({
            "context": clean_terminal_diagnostic_log_text(context),
        }),
    );
    let child = match pair.slave.spawn_command(command) {
        Ok(child) => {
            log_terminal_crash_forensics_event(
                "backend.pty.spawn_command.done",
                json!({
                    "context": clean_terminal_diagnostic_log_text(context),
                    "pid": child.process_id(),
                }),
            );
            child
        }
        Err(error) => {
            log_terminal_crash_forensics_event(
                "backend.pty.spawn_command.error",
                json!({
                    "context": clean_terminal_diagnostic_log_text(context),
                    "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                }),
            );
            return Err(format!("Unable to start {context}: {error}"));
        }
    };
    log_terminal_crash_forensics_event(
        "backend.pty.clone_reader.begin",
        json!({
            "context": clean_terminal_diagnostic_log_text(context),
        }),
    );
    let reader = match pair.master.try_clone_reader() {
        Ok(reader) => {
            log_terminal_crash_forensics_event(
                "backend.pty.clone_reader.done",
                json!({
                    "context": clean_terminal_diagnostic_log_text(context),
                }),
            );
            reader
        }
        Err(error) => {
            log_terminal_crash_forensics_event(
                "backend.pty.clone_reader.error",
                json!({
                    "context": clean_terminal_diagnostic_log_text(context),
                    "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                }),
            );
            return Err(format!("Unable to read {context} output: {error}"));
        }
    };
    log_terminal_crash_forensics_event(
        "backend.pty.take_writer.begin",
        json!({
            "context": clean_terminal_diagnostic_log_text(context),
        }),
    );
    let writer = match pair.master.take_writer() {
        Ok(writer) => {
            log_terminal_crash_forensics_event(
                "backend.pty.take_writer.done",
                json!({
                    "context": clean_terminal_diagnostic_log_text(context),
                }),
            );
            writer
        }
        Err(error) => {
            log_terminal_crash_forensics_event(
                "backend.pty.take_writer.error",
                json!({
                    "context": clean_terminal_diagnostic_log_text(context),
                    "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                }),
            );
            return Err(format!("Unable to write {context} input: {error}"));
        }
    };

    Ok(WarmPty {
        child,
        master: pair.master,
        writer,
        reader,
        size,
    })
}

fn create_warm_shell_pty_in_directory(
    size: PtySize,
    working_directory: &Path,
) -> Result<WarmPty, String> {
    create_warm_shell_pty_in_directory_with_env(size, working_directory, &[])
}

fn create_warm_shell_pty_in_directory_with_env(
    size: PtySize,
    working_directory: &Path,
    env_vars: &[(String, String)],
) -> Result<WarmPty, String> {
    let mut command = terminal_interactive_shell_command();

    command.cwd(working_directory);
    for (key, value) in env_vars {
        command.env(key, value);
    }

    spawn_terminal_pty(size, command, "warm terminal shell")
}

fn create_warm_shell_pty(size: PtySize) -> Result<WarmPty, String> {
    let working_directory = workspace_path_for_process(&default_terminal_working_directory());

    create_warm_shell_pty_in_directory(size, &working_directory)
}

fn create_agent_terminal_pty(
    size: PtySize,
    command_path: &str,
    args: &[String],
    working_directory: &Path,
    env_vars: &[(String, String)],
    banner: Option<&str>,
) -> Result<WarmPty, String> {
    preflight_interactive_claude_workspace_trust(command_path, working_directory, env_vars);
    let mut command = terminal_agent_launch_command(command_path, args, working_directory, banner);

    for (key, value) in env_vars {
        command.env(key, value);
    }

    // `spawn_terminal_pty` can fail while acquiring the reader/writer after
    // the child process has already started, so no post-spawn result is safe
    // evidence that staged Claude files are unconsumed. The age-based sweeper
    // owns every successfully staged file.
    spawn_terminal_pty(size, command, "agent terminal")
}

fn cleanup_warm_pty_with_context(warm_pty: WarmPty) {
    log_terminal_crash_forensics_event("backend.warm_pty_cleanup.begin", json!({}));
    let WarmPty {
        mut child,
        master,
        writer,
        reader,
        size: _,
    } = warm_pty;
    log_terminal_crash_forensics_event("backend.warm_pty_cleanup.kill.begin", json!({}));
    #[cfg(not(windows))]
    let process_group_leader = master.process_group_leader();
    #[cfg(windows)]
    let process_group_leader: Option<i32> = None;
    let report = kill_terminal_process_tree(child.as_mut(), process_group_leader);
    log_terminal_crash_forensics_event(
        "backend.warm_pty_cleanup.kill.done",
        json!({
            "report": terminal_kill_report_json(&report),
        }),
    );
    poll_terminal_child_exit(child.as_mut());
    thread::spawn(move || {
        log_terminal_crash_forensics_event("backend.warm_pty_cleanup.drop_child.begin", json!({}));
        drop(child);
        log_terminal_crash_forensics_event("backend.warm_pty_cleanup.drop_child.done", json!({}));
        log_terminal_crash_forensics_event("backend.warm_pty_cleanup.drop_reader.begin", json!({}));
        drop(reader);
        log_terminal_crash_forensics_event("backend.warm_pty_cleanup.drop_reader.done", json!({}));
        log_terminal_crash_forensics_event("backend.warm_pty_cleanup.drop_writer.begin", json!({}));
        drop(writer);
        log_terminal_crash_forensics_event("backend.warm_pty_cleanup.drop_writer.done", json!({}));
        log_terminal_crash_forensics_event("backend.warm_pty_cleanup.drop_master.begin", json!({}));
        drop(master);
        log_terminal_crash_forensics_event("backend.warm_pty_cleanup.drop_master.done", json!({}));
    });
}

#[cfg(windows)]
const WINDOWS_TH32CS_SNAPPROCESS: u32 = 0x00000002;
#[cfg(windows)]
const WINDOWS_PROCESS_TERMINATE: u32 = 0x0001;
#[cfg(windows)]
const WINDOWS_MAX_PATH: usize = 260;

#[cfg(windows)]
#[repr(C)]
struct WindowsProcessEntry32 {
    dw_size: u32,
    cnt_usage: u32,
    th32_process_id: u32,
    th32_default_heap_id: usize,
    th32_module_id: u32,
    cnt_threads: u32,
    th32_parent_process_id: u32,
    pc_pri_class_base: i32,
    dw_flags: u32,
    sz_exe_file: [u16; WINDOWS_MAX_PATH],
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> WindowsHandle;
    fn Process32FirstW(snapshot: WindowsHandle, entry: *mut WindowsProcessEntry32) -> i32;
    fn Process32NextW(snapshot: WindowsHandle, entry: *mut WindowsProcessEntry32) -> i32;
    fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> WindowsHandle;
    fn TerminateProcess(process: WindowsHandle, exit_code: u32) -> i32;
    fn CloseHandle(object: WindowsHandle) -> i32;
}

#[cfg(windows)]
fn windows_invalid_handle() -> WindowsHandle {
    (-1isize) as WindowsHandle
}

#[cfg(windows)]
fn windows_process_entry_name(entry: &WindowsProcessEntry32) -> String {
    let end = entry
        .sz_exe_file
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(entry.sz_exe_file.len());

    String::from_utf16_lossy(&entry.sz_exe_file[..end]).to_ascii_lowercase()
}

#[cfg(windows)]
fn app_child_process_ids_by_name(parent_process_id: u32, process_name: &str) -> Vec<u32> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(WINDOWS_TH32CS_SNAPPROCESS, 0) };

    if snapshot.is_null() || snapshot == windows_invalid_handle() {
        return Vec::new();
    }

    let mut process_ids = Vec::new();
    let target_name = process_name.to_ascii_lowercase();
    let mut entry = WindowsProcessEntry32 {
        dw_size: std::mem::size_of::<WindowsProcessEntry32>() as u32,
        cnt_usage: 0,
        th32_process_id: 0,
        th32_default_heap_id: 0,
        th32_module_id: 0,
        cnt_threads: 0,
        th32_parent_process_id: 0,
        pc_pri_class_base: 0,
        dw_flags: 0,
        sz_exe_file: [0; WINDOWS_MAX_PATH],
    };
    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;

    while has_entry {
        if entry.th32_parent_process_id == parent_process_id
            && windows_process_entry_name(&entry) == target_name
        {
            process_ids.push(entry.th32_process_id);
        }

        has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }

    unsafe {
        CloseHandle(snapshot);
    }

    process_ids
}

#[cfg(windows)]
fn terminate_windows_process(process_id: u32) -> bool {
    let process = unsafe { OpenProcess(WINDOWS_PROCESS_TERMINATE, 0, process_id) };

    if process.is_null() {
        return false;
    }

    let terminated = unsafe { TerminateProcess(process, 1) } != 0;
    unsafe {
        CloseHandle(process);
    }

    terminated
}

#[cfg(windows)]
fn cleanup_windows_headless_console_hosts() -> usize {
    let app_pid = std::process::id();
    let process_ids = app_child_process_ids_by_name(app_pid, "conhost.exe");
    let mut closed_process_ids = Vec::new();

    for process_id in &process_ids {
        if terminate_windows_process(*process_id) {
            closed_process_ids.push(*process_id);
        }
    }

    log_terminal_crash_forensics_event(
        "backend.windows_headless_console_hosts.cleanup",
        json!({
            "app_pid": app_pid,
            "closed_count": closed_process_ids.len(),
            "closed_process_ids": closed_process_ids,
            "found_count": process_ids.len(),
        }),
    );

    closed_process_ids.len()
}

#[cfg(not(windows))]
fn cleanup_windows_headless_console_hosts() -> usize {
    0
}

fn run_agent_command_capture(
    definition: AgentDefinition,
    args: &[&str],
    stdin_text: Option<&str>,
    timeout: Duration,
    working_directory: Option<&Path>,
) -> Result<CommandCapture, String> {
    run_agent_command_capture_with_env(
        definition,
        args,
        stdin_text,
        timeout,
        working_directory,
        &[],
    )
}

fn run_agent_command_capture_with_env(
    definition: AgentDefinition,
    args: &[&str],
    stdin_text: Option<&str>,
    timeout: Duration,
    working_directory: Option<&Path>,
    env_vars: &[(String, String)],
) -> Result<CommandCapture, String> {
    let mut last_error = format!(
        "{} is not installed or not available on PATH.",
        definition.label
    );

    for candidate in agent_command_candidates(definition) {
        match run_command_capture_with_env(
            &candidate,
            args,
            stdin_text,
            timeout,
            working_directory,
            env_vars,
        ) {
            Ok(capture) => return Ok(capture),
            Err(error) => {
                last_error = error;
            }
        }
    }

    Err(last_error)
}

fn agent_runtime_status_for(provider: AgentProvider) -> AgentRuntimeStatus {
    let definition = agent_definition(provider);
    let auth_check = thread::spawn(move || {
        let auth_status = agent_auth_status_for(provider, definition);
        auth_status
    });

    let version_result = match provider {
        AgentProvider::Codex | AgentProvider::Claude | AgentProvider::OpenCode => {
            run_agent_command_capture(
                definition,
                &["--version"],
                None,
                Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
                None,
            )
        }
        AgentProvider::Haider => {
            Err("Haider runtime status is not managed by DiffForge.".to_string())
        }
    };
    let Ok(version_capture) = version_result else {
        let _ = auth_check.join();
        let status = AgentRuntimeStatus {
            installed: false,
            authenticated: false,
            version: "Not installed".to_string(),
            auth_message: format!("Install {} and recheck.", definition.label),
            recommend_native_install: true,
        };
        return status;
    };

    let version = first_output_line(&command_output_text(
        &version_capture.stdout,
        &version_capture.stderr,
    ));

    let (authenticated, auth_message) = auth_check.join().unwrap_or_else(|_| {
        (
            false,
            format!("Unable to check {} login.", definition.label),
        )
    });

    let status = AgentRuntimeStatus {
        installed: true,
        authenticated,
        version: if version.is_empty() {
            "Installed".to_string()
        } else {
            version
        },
        auth_message,
        recommend_native_install: true,
    };
    status
}

fn build_agent_status(
    provider: AgentProvider,
    runtime_status: AgentRuntimeStatus,
    npm_available: bool,
    npm_version: &str,
    npm_installed: bool,
    npm_package_version: String,
    npm_latest_version: String,
    npm_update_available: bool,
) -> AgentStatus {
    let definition = agent_definition(provider);
    let image_input = agent_image_input_status(provider);

    AgentStatus {
        id: definition.id,
        label: definition.label,
        binary: definition.binary,
        installed: runtime_status.installed,
        authenticated: runtime_status.authenticated,
        version: runtime_status.version,
        auth_message: runtime_status.auth_message,
        install_command: definition.install_command,
        native_install_url: definition.native_install_url,
        native_install_label: definition.native_install_label,
        npm_available,
        npm_version: npm_version.to_string(),
        npm_installed,
        npm_package_version,
        npm_latest_version,
        npm_update_available,
        recommend_native_install: runtime_status.recommend_native_install,
        connect_command: definition.connect_command,
        image_input_supported: image_input.supported,
        image_input_support: image_input.support,
        image_input_reason: image_input.reason,
        active_model: image_input.active_model,
        active_model_supports_images: image_input.active_model_supports_images,
    }
}

fn agent_image_input_status(provider: AgentProvider) -> AgentImageInputStatus {
    match provider {
        AgentProvider::Codex => AgentImageInputStatus {
            supported: true,
            support: "supported",
            reason: "Codex CLI supports image input.".to_string(),
            active_model: String::new(),
            active_model_supports_images: true,
        },
        AgentProvider::Claude => AgentImageInputStatus {
            supported: true,
            support: "supported",
            reason: "Claude Code supports image input.".to_string(),
            active_model: String::new(),
            active_model_supports_images: true,
        },
        AgentProvider::OpenCode => {
            let active_model = detect_opencode_configured_model().unwrap_or_default();

            if active_model.is_empty() {
                return AgentImageInputStatus {
                    supported: false,
                    support: "conditional",
                    reason: "OpenCode image input depends on the selected model; no configured model was detected.".to_string(),
                    active_model,
                    active_model_supports_images: false,
                };
            }

            match opencode_model_supports_images(&active_model) {
                Some(true) => AgentImageInputStatus {
                    supported: true,
                    support: "supported",
                    reason: format!(
                        "OpenCode is configured with an image-capable model ({active_model})."
                    ),
                    active_model,
                    active_model_supports_images: true,
                },
                Some(false) => AgentImageInputStatus {
                    supported: false,
                    support: "unsupported",
                    reason: format!(
                        "OpenCode is configured with a text-only model ({active_model})."
                    ),
                    active_model,
                    active_model_supports_images: false,
                },
                None => AgentImageInputStatus {
                    supported: false,
                    support: "unknown",
                    reason: format!("OpenCode model image support is unknown for {active_model}."),
                    active_model,
                    active_model_supports_images: false,
                },
            }
        }
        AgentProvider::Haider => AgentImageInputStatus {
            supported: false,
            support: "unknown",
            reason: "Haider image input is managed by its local daemon.".to_string(),
            active_model: String::new(),
            active_model_supports_images: false,
        },
    }
}

fn detect_opencode_configured_model() -> Option<String> {
    ["OPENCODE_MODEL", "OPEN_CODE_MODEL"]
        .iter()
        .find_map(|key| env::var(key).ok().and_then(clean_opencode_model_id))
        .or_else(|| {
            opencode_config_paths()
                .into_iter()
                .find_map(|path| read_opencode_model_from_config(&path))
        })
}

fn clean_opencode_model_id(value: String) -> Option<String> {
    let model = value.trim();
    if model.is_empty() {
        return None;
    }

    Some(model.chars().take(MAX_FORGE_MODEL_LENGTH).collect())
}

fn opencode_config_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(current_dir) = env::current_dir() {
        paths.push(current_dir.join("opencode.json"));
        paths.push(current_dir.join(".opencode.json"));
    }

    if let Some(home) = user_home_dir() {
        paths.push(home.join(".config").join("opencode").join("opencode.json"));
        paths.push(home.join(".config").join("opencode").join("config.json"));
        paths.push(home.join(".opencode").join("opencode.json"));
        paths.push(home.join(".opencode").join("config.json"));
        paths.push(home.join(".opencode.json"));
    }

    if let Some(app_data) = env::var_os("APPDATA").map(PathBuf::from) {
        paths.push(app_data.join("opencode").join("opencode.json"));
        paths.push(app_data.join("opencode").join("config.json"));
    }

    paths
}

fn read_opencode_model_from_config(path: &Path) -> Option<String> {
    let body = fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<Value>(&body).ok()?;

    opencode_model_from_config_value(&value).and_then(clean_opencode_model_id)
}

fn opencode_model_from_config_value(value: &Value) -> Option<String> {
    [
        "model",
        "defaultModel",
        "default_model",
        "selectedModel",
        "selected_model",
    ]
    .iter()
    .find_map(|key| value.get(*key).and_then(Value::as_str).map(str::to_string))
    .or_else(|| {
        value
            .get("agent")
            .and_then(opencode_model_from_config_value)
    })
    .or_else(|| {
        let provider = value.get("provider").and_then(Value::as_str)?;
        value
            .get("providers")
            .and_then(|providers| providers.get(provider))
            .and_then(opencode_model_from_config_value)
    })
}

fn opencode_model_supports_images(model: &str) -> Option<bool> {
    let normalized = model.trim().to_ascii_lowercase();

    if normalized.is_empty() {
        return None;
    }

    // Vision markers are checked first: a vision variant of an otherwise
    // text-only family (e.g. `llama-3.2-90b-vision`, `deepseek-vl2`) is
    // image-capable and must not be short-circuited by the family token below.
    let vision_markers = [
        "gpt-4o",
        "gpt-4.1",
        "gpt-5",
        "claude-3",
        "claude-opus-4",
        "claude-sonnet-4",
        "claude-haiku-4",
        "sonnet-4",
        "opus-4",
        "gemini",
        "pixtral",
        "llava",
        "minicpm-v",
        "vision",
        "multimodal",
        "omni",
        "qwen-vl",
        "qwen2-vl",
        "qwen2.5-vl",
    ];
    if vision_markers
        .iter()
        .any(|marker| normalized.contains(marker))
        || normalized.contains("-vl")
        || normalized.contains("/vl")
        || normalized.ends_with(":vl")
    {
        return Some(true);
    }

    let text_only_markers = [
        "gpt-3.5",
        "o1-mini",
        "o3-mini",
        "deepseek",
        "codestral",
        "devstral",
        "llama",
        "qwen-coder",
        "kimi",
    ];
    if text_only_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return Some(false);
    }

    None
}

fn install_agent_with_npm(provider: AgentProvider) -> AgentInstallResult {
    run_agent_npm_install(provider, false)
}

fn update_agent_with_npm(provider: AgentProvider) -> AgentInstallResult {
    run_agent_npm_install(provider, true)
}

fn update_agent_with_npm_progress<F>(
    provider: AgentProvider,
    target_version: &str,
    emit: F,
) -> AgentInstallResult
where
    F: FnMut(AgentInstallProgressSignal),
{
    run_agent_npm_install_with_progress(provider, true, Some(target_version), emit)
}

fn uninstall_agent_with_npm(provider: AgentProvider) -> AgentInstallResult {
    let definition = agent_definition(provider);

    if npm_version().is_none() {
        return AgentInstallResult {
            provider: definition.id,
            label: definition.label,
            ok: false,
            installed: false,
            updated: false,
            permission_denied: false,
            error_kind: Some("npm_unavailable".to_string()),
            failed_stage: Some("uninstalling".to_string()),
            exit_code: None,
            stderr: String::new(),
            installed_version: String::new(),
            command: definition.install_command,
            native_install_url: definition.native_install_url,
            message: format!(
                "npm was not found on PATH, so the {} npm package cannot be removed.",
                definition.label
            ),
        };
    }

    let uninstall = run_command_capture(
        npm_binary(),
        &["uninstall", "-g", definition.install_package],
        None,
        Duration::from_secs(AGENT_INSTALL_TIMEOUT_SECS),
        None,
    );

    match uninstall {
        Ok(capture) if capture.exit_code == Some(0) => AgentInstallResult {
            provider: definition.id,
            label: definition.label,
            ok: true,
            installed: false,
            updated: false,
            permission_denied: false,
            error_kind: None,
            failed_stage: None,
            exit_code: capture.exit_code,
            stderr: bounded_agent_install_stderr(&capture.stderr),
            installed_version: String::new(),
            command: definition.install_command,
            native_install_url: definition.native_install_url,
            message: format!("{} npm package was uninstalled.", definition.label),
        },
        Ok(capture) => {
            let stderr = capture.stderr.trim().to_string();
            let permission_denied = stderr.contains("EACCES") || stderr.contains("permission");
            AgentInstallResult {
                provider: definition.id,
                label: definition.label,
                ok: false,
                installed: true,
                updated: false,
                permission_denied,
                error_kind: Some(if permission_denied {
                    "permission_denied".to_string()
                } else {
                    "npm_failed".to_string()
                }),
                failed_stage: Some("uninstalling".to_string()),
                exit_code: capture.exit_code,
                stderr: bounded_agent_install_stderr(&capture.stderr),
                installed_version: npm_global_package_version(definition).unwrap_or_default(),
                command: definition.install_command,
                native_install_url: definition.native_install_url,
                message: if stderr.is_empty() {
                    format!("npm could not uninstall {}.", definition.label)
                } else {
                    format!("npm could not uninstall {}: {stderr}", definition.label)
                },
            }
        }
        Err(error) => AgentInstallResult {
            provider: definition.id,
            label: definition.label,
            ok: false,
            installed: true,
            updated: false,
            permission_denied: false,
            error_kind: Some("process_error".to_string()),
            failed_stage: Some("uninstalling".to_string()),
            exit_code: None,
            stderr: bounded_agent_install_stderr(&error),
            installed_version: npm_global_package_version(definition).unwrap_or_default(),
            command: definition.install_command,
            native_install_url: definition.native_install_url,
            message: format!("npm uninstall failed: {error}"),
        },
    }
}

fn npm_global_node_modules_root() -> Option<PathBuf> {
    let capture = run_command_capture(
        npm_binary(),
        &["root", "-g"],
        None,
        Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
        None,
    )
    .ok()?;
    if capture.exit_code != Some(0) {
        return None;
    }
    let line = first_output_line(&command_output_text(&capture.stdout, &capture.stderr));
    if line.is_empty() {
        return None;
    }
    Some(PathBuf::from(line))
}

/// An earlier interrupted install can wedge npm: it fails with ENOTEMPTY
/// renaming the package dir onto a stale hidden temp dir it left behind
/// (e.g. `@anthropic-ai/.claude-code-XXXX`). Removing that reported temp dir
/// unblocks the retry. Only paths inside node_modules whose final component
/// is hidden are eligible.
fn cleanup_npm_wedged_temp_dir(output: &str) -> bool {
    for line in output.lines() {
        let Some(path_text) = line.trim().strip_prefix("npm error dest ") else {
            continue;
        };
        let path = PathBuf::from(path_text.trim());
        let in_node_modules = path
            .components()
            .any(|component| component.as_os_str() == "node_modules");
        let hidden_temp = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with('.'))
            .unwrap_or(false);
        if in_node_modules && hidden_temp && path.exists() {
            return fs::remove_dir_all(&path).is_ok();
        }
    }
    false
}

/// Confirms the installed agent binary actually starts. A killed or failed
/// npm extraction can leave the wrapper's placeholder stub in place, which
/// only prints "native binary not installed" when a terminal launches it.
fn verify_agent_binary_runs(definition: AgentDefinition) -> Result<(), String> {
    let Some(binary) = npm_global_executable_path(definition) else {
        return Err(format!(
            "{} binary was not found in the npm global prefix after install.",
            definition.label
        ));
    };
    let binary_text = binary.to_string_lossy().to_string();
    let capture = run_command_capture(
        &binary_text,
        &["--version"],
        None,
        Duration::from_secs(30),
        None,
    )
    .map_err(|error| format!("{} did not start after install: {error}", definition.label))?;
    if capture.exit_code == Some(0) {
        return Ok(());
    }
    let detail = first_output_line(&command_output_text(&capture.stdout, &capture.stderr));
    Err(if detail.is_empty() {
        format!("{} exited with an error after install.", definition.label)
    } else {
        detail
    })
}

/// Re-runs the npm package's own postinstall (install.cjs) to place the
/// platform-native binary, the same repair the package suggests when its
/// stub runs.
fn repair_agent_npm_postinstall(definition: AgentDefinition) -> bool {
    let Some(root) = npm_global_node_modules_root() else {
        return false;
    };
    let installer = root.join(definition.install_package).join("install.cjs");
    if !installer.is_file() {
        return false;
    }
    let installer_text = installer.to_string_lossy().to_string();
    run_command_capture(
        "node",
        &[&installer_text],
        None,
        Duration::from_secs(120),
        None,
    )
    .map(|capture| capture.exit_code == Some(0))
    .unwrap_or(false)
}

fn run_agent_npm_install(provider: AgentProvider, is_update: bool) -> AgentInstallResult {
    run_agent_npm_install_with_progress(provider, is_update, None, |_| {})
}

fn agent_version_is_at_least(installed_version: &str, target_version: &str) -> bool {
    let installed = version_number_segments(installed_version);
    let target = version_number_segments(target_version);
    if installed.is_empty() || target.is_empty() {
        return false;
    }
    let count = installed.len().max(target.len());
    for index in 0..count {
        let installed_segment = *installed.get(index).unwrap_or(&0);
        let target_segment = *target.get(index).unwrap_or(&0);
        if installed_segment != target_segment {
            return installed_segment > target_segment;
        }
    }
    true
}

#[derive(Default)]
struct AgentInstallProgressPhases {
    downloading_emitted: bool,
    installing_emitted: bool,
}

impl AgentInstallProgressPhases {
    fn begin_downloading(&mut self) -> bool {
        if self.downloading_emitted {
            return false;
        }
        self.downloading_emitted = true;
        true
    }

    fn begin_installing(&mut self) -> bool {
        if self.installing_emitted {
            return false;
        }
        self.installing_emitted = true;
        true
    }
}

fn verify_completed_agent_install(
    definition: AgentDefinition,
    target_version: Option<&str>,
) -> Result<String, String> {
    // npm exiting 0 is not enough: verify the binary really starts, and try
    // the package's own postinstall repair once before reporting corruption.
    if let Err(verify_error) = verify_agent_binary_runs(definition) {
        let repaired = repair_agent_npm_postinstall(definition)
            && verify_agent_binary_runs(definition).is_ok();
        if !repaired {
            return Err(verify_error);
        }
    }

    let installed_version = npm_global_package_version(definition).unwrap_or_default();
    if installed_version.trim().is_empty() {
        return Err(format!(
            "{} version could not be re-probed after npm completed.",
            definition.label
        ));
    }
    if let Some(target_version) = target_version.filter(|value| !value.trim().is_empty()) {
        if !agent_version_is_at_least(&installed_version, target_version) {
            return Err(format!(
                "{} remained at {} after updating to target {}.",
                definition.label, installed_version, target_version
            ));
        }
    }
    Ok(installed_version)
}

#[cfg(windows)]
enum ElevatedNpmLaunchOutcome {
    Exited {
        exit_code: i32,
        stderr: String,
        detail: String,
    },
    Cancelled,
    Failed { reason: String, stderr: String },
}

#[derive(Deserialize, Serialize)]
struct ElevatedAgentUpdateHelperOutput {
    exit_code: Option<i32>,
    stderr: String,
    error: String,
}

fn elevated_agent_update_helper_output_path(nonce: &str) -> Option<PathBuf> {
    let nonce = nonce.trim();
    if nonce.len() != 32 || !nonce.chars().all(|character| character.is_ascii_hexdigit()) {
        return None;
    }
    Some(env::temp_dir().join(format!(
        "diffforge-agent-update-elevated-{nonce}.json"
    )))
}

/// Internal subprocess mode used only by the Windows `runas` launcher below.
/// It accepts a provider from the fixed registry plus a validated nonce, runs
/// exactly that provider's global npm install, and writes a bounded result to
/// a fixed temp-file name. It cannot accept arbitrary commands or paths.
#[cfg(windows)]
pub fn run_agent_update_elevated_helper(args: &[String]) -> i32 {
    if args.len() != 2 {
        return 2;
    }
    let provider = match parse_agent_provider(&args[0]) {
        Ok(provider) => provider,
        Err(_) => return 2,
    };
    if ensure_npm_managed_agent_provider(provider).is_err() {
        return 2;
    }
    let Some(output_path) = elevated_agent_update_helper_output_path(&args[1]) else {
        return 2;
    };
    let definition = agent_definition(provider);
    let output = match run_command_capture(
        npm_binary(),
        &["install", "-g", definition.install_package],
        None,
        Duration::from_secs(AGENT_INSTALL_TIMEOUT_SECS),
        None,
    ) {
        Ok(capture) => {
            let combined = command_output_text(&capture.stdout, &capture.stderr);
            ElevatedAgentUpdateHelperOutput {
                exit_code: capture.exit_code,
                stderr: bounded_agent_install_stderr(&capture.stderr),
                error: if capture.exit_code == Some(0) {
                    String::new()
                } else {
                    first_output_line(&combined).chars().take(512).collect()
                },
            }
        }
        Err(error) => ElevatedAgentUpdateHelperOutput {
            exit_code: None,
            stderr: bounded_agent_install_stderr(&error),
            error,
        },
    };
    let Ok(json) = serde_json::to_vec(&output) else {
        return 3;
    };
    let write_result = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output_path)
        .and_then(|mut file| file.write_all(&json));
    if write_result.is_err() {
        return 3;
    }
    0
}

#[cfg(not(windows))]
pub fn run_agent_update_elevated_helper(_args: &[String]) -> i32 {
    2
}

/// Elevates a narrowly-scoped mode of this executable rather than npm or an
/// arbitrary shell command. The helper captures bounded stderr for the parent.
#[cfg(windows)]
fn run_windows_agent_npm_update_as_administrator(
    definition: AgentDefinition,
) -> ElevatedNpmLaunchOutcome {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, WAIT_OBJECT_0},
        System::Threading::{GetExitCodeProcess, WaitForSingleObject},
        UI::{
            Shell::{
                ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
            },
            WindowsAndMessaging::SW_HIDE,
        },
    };

    let executable = match env::current_exe() {
        Ok(executable) => executable,
        Err(error) => {
            return ElevatedNpmLaunchOutcome::Failed {
                reason: format!("Unable to locate the Diff Forge update helper: {error}"),
                stderr: String::new(),
            };
        }
    };
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let output_path = elevated_agent_update_helper_output_path(&nonce)
        .expect("generated elevated update nonce must be valid");
    let verb = "runas\0".encode_utf16().collect::<Vec<_>>();
    let file = executable
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let parameters = format!(
        "--agent-update-elevated-helper {} {}\0",
        definition.id, nonce
    )
        .encode_utf16()
        .collect::<Vec<_>>();
    let mut execute = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: verb.as_ptr(),
        lpFile: file.as_ptr(),
        lpParameters: parameters.as_ptr(),
        nShow: SW_HIDE,
        ..Default::default()
    };
    // SAFETY: every pointer above references a NUL-terminated buffer that
    // remains alive for the call; the returned process handle is closed below.
    if unsafe { ShellExecuteExW(&mut execute) } == 0 {
        let code = unsafe { GetLastError() };
        return if elevated_launch_was_cancelled(code) {
            ElevatedNpmLaunchOutcome::Cancelled
        } else {
            ElevatedNpmLaunchOutcome::Failed {
                reason: format!(
                    "Unable to start the administrator npm retry (Windows error {code})."
                ),
                stderr: String::new(),
            }
        };
    }
    if execute.hProcess.is_null() {
        return ElevatedNpmLaunchOutcome::Failed {
            reason: "Windows did not return a process handle for the administrator npm retry."
                .to_string(),
            stderr: String::new(),
        };
    }

    let wait_result = unsafe {
        WaitForSingleObject(
            execute.hProcess,
            AGENT_INSTALL_TIMEOUT_SECS.saturating_mul(1_000) as u32,
        )
    };
    if wait_result != WAIT_OBJECT_0 {
        unsafe { CloseHandle(execute.hProcess) };
        return ElevatedNpmLaunchOutcome::Failed {
            reason: "The administrator npm retry did not finish before the update timeout."
                .to_string(),
            stderr: String::new(),
        };
    }
    let mut exit_code = 0_u32;
    let read_exit_code = unsafe { GetExitCodeProcess(execute.hProcess, &mut exit_code) };
    unsafe { CloseHandle(execute.hProcess) };
    if read_exit_code == 0 {
        return ElevatedNpmLaunchOutcome::Failed {
            reason: "Windows could not read the administrator npm retry exit code.".to_string(),
            stderr: String::new(),
        };
    }
    if exit_code != 0 {
        let _ = fs::remove_file(&output_path);
        return ElevatedNpmLaunchOutcome::Failed {
            reason: format!("The administrator update helper exited with status {exit_code}."),
            stderr: String::new(),
        };
    }
    let output = fs::read_to_string(&output_path)
        .map_err(|error| format!("Unable to read the administrator update result: {error}"))
        .and_then(|json| {
            serde_json::from_str::<ElevatedAgentUpdateHelperOutput>(&json)
                .map_err(|error| format!("Unable to parse the administrator update result: {error}"))
        });
    let _ = fs::remove_file(&output_path);
    match output {
        Ok(output) => match output.exit_code {
            Some(exit_code) => ElevatedNpmLaunchOutcome::Exited {
                exit_code,
                stderr: output.stderr,
                detail: output.error,
            },
            None => ElevatedNpmLaunchOutcome::Failed {
                reason: if output.error.trim().is_empty() {
                    "The administrator npm process did not report an exit code.".to_string()
                } else {
                    output.error
                },
                stderr: output.stderr,
            },
        },
        Err(reason) => ElevatedNpmLaunchOutcome::Failed {
            reason,
            stderr: String::new(),
        },
    }
}

fn failed_elevated_agent_update_result(
    definition: AgentDefinition,
    reason: &str,
    stderr: &str,
    failed_stage: &str,
    exit_code: Option<i32>,
    error_kind: &str,
) -> AgentInstallResult {
    let mut result = failed_agent_install_result(
        definition,
        reason,
        stderr,
        reason,
        "update",
        failed_stage,
        exit_code,
        error_kind,
    );
    // Words such as "administrator" describe this explicit elevation flow;
    // they are not evidence that the elevated process itself was denied.
    result.permission_denied = false;
    result.error_kind = Some(error_kind.to_string());
    result.message = reason.to_string();
    result
}

fn update_agent_with_npm_as_administrator_progress<F>(
    provider: AgentProvider,
    target_version: &str,
    mut emit: F,
) -> AgentInstallResult
where
    F: FnMut(AgentInstallProgressSignal),
{
    let definition = agent_definition(provider);

    #[cfg(not(windows))]
    {
        let _ = target_version;
        let reason = "Administrator retry is only available on Windows.".to_string();
        emit(AgentInstallProgressSignal {
            stage: "failed",
            error_reason: Some(reason.clone()),
            failed_stage: Some("installing"),
        });
        return failed_elevated_agent_update_result(
            definition,
            &reason,
            &reason,
            "installing",
            None,
            "elevation_unsupported",
        );
    }

    #[cfg(windows)]
    {
        emit(AgentInstallProgressSignal {
            stage: "downloading",
            error_reason: None,
            failed_stage: None,
        });
        emit(AgentInstallProgressSignal {
            stage: "installing",
            error_reason: None,
            failed_stage: None,
        });
        let (exit_code, elevated_stderr) =
            match run_windows_agent_npm_update_as_administrator(definition) {
            ElevatedNpmLaunchOutcome::Exited {
                exit_code: 0,
                stderr,
                ..
            } => (0, stderr),
            ElevatedNpmLaunchOutcome::Exited {
                exit_code,
                stderr,
                detail,
            } => {
                let detail = first_output_line(&detail);
                let stderr_summary = first_output_line(&stderr);
                let reason = if !detail.is_empty() {
                    format!("Administrator npm update failed: {detail}")
                } else if stderr_summary.is_empty() {
                    format!("Administrator npm update exited with status {exit_code}.")
                } else {
                    format!("Administrator npm update failed: {stderr_summary}")
                };
                emit(AgentInstallProgressSignal {
                    stage: "failed",
                    error_reason: Some(reason.clone()),
                    failed_stage: Some("installing"),
                });
                return failed_elevated_agent_update_result(
                    definition,
                    &reason,
                    &stderr,
                    "installing",
                    Some(exit_code),
                    "npm_failed",
                );
            }
            ElevatedNpmLaunchOutcome::Cancelled => {
                let reason = "Administrator approval was cancelled; the update was not run.";
                emit(AgentInstallProgressSignal {
                    stage: "failed",
                    error_reason: Some(reason.to_string()),
                    failed_stage: Some("installing"),
                });
                return failed_elevated_agent_update_result(
                    definition,
                    reason,
                    reason,
                    "installing",
                    None,
                    "elevation_cancelled",
                );
            }
            ElevatedNpmLaunchOutcome::Failed { reason, stderr } => {
                emit(AgentInstallProgressSignal {
                    stage: "failed",
                    error_reason: Some(reason.clone()),
                    failed_stage: Some("installing"),
                });
                return failed_elevated_agent_update_result(
                    definition,
                    &reason,
                    &stderr,
                    "installing",
                    None,
                    "elevation_failed",
                );
            }
        };
        emit(AgentInstallProgressSignal {
            stage: "verifying",
            error_reason: None,
            failed_stage: None,
        });
        match verify_completed_agent_install(definition, Some(target_version)) {
            Ok(installed_version) => {
                emit(AgentInstallProgressSignal {
                    stage: "complete",
                    error_reason: None,
                    failed_stage: None,
                });
                AgentInstallResult {
                    provider: definition.id,
                    label: definition.label,
                    ok: true,
                    installed: true,
                    updated: true,
                    permission_denied: false,
                    error_kind: None,
                    failed_stage: None,
                    exit_code: Some(exit_code),
                    stderr: bounded_agent_install_stderr(&elevated_stderr),
                    installed_version: installed_version.clone(),
                    command: definition.install_command,
                    native_install_url: definition.native_install_url,
                    message: format!(
                        "{} updated successfully to version {}.",
                        definition.label, installed_version
                    ),
                }
            }
            Err(reason) => {
                emit(AgentInstallProgressSignal {
                    stage: "failed",
                    error_reason: Some(reason.clone()),
                    failed_stage: Some("verifying"),
                });
                failed_elevated_agent_update_result(
                    definition,
                    &reason,
                    &elevated_stderr,
                    "verifying",
                    Some(exit_code),
                    "verification_failed",
                )
            }
        }
    }
}

fn run_agent_npm_install_with_progress<F>(
    provider: AgentProvider,
    is_update: bool,
    target_version: Option<&str>,
    mut emit: F,
) -> AgentInstallResult
where
    F: FnMut(AgentInstallProgressSignal),
{
    let definition = agent_definition(provider);

    if npm_version().is_none() {
        emit(AgentInstallProgressSignal {
            stage: "failed",
            error_reason: Some("npm was not found on PATH.".to_string()),
            failed_stage: Some("downloading"),
        });
        return AgentInstallResult {
            provider: definition.id,
            label: definition.label,
            ok: false,
            installed: false,
            updated: false,
            permission_denied: false,
            error_kind: Some("npm_unavailable".to_string()),
            failed_stage: Some("downloading".to_string()),
            exit_code: None,
            stderr: String::new(),
            installed_version: String::new(),
            command: definition.install_command,
            native_install_url: definition.native_install_url,
            message: format!(
                "npm was not found on PATH. Use the {} instead.",
                definition.native_install_label
            ),
        };
    }

    let mut phases = AgentInstallProgressPhases::default();
    let mut run_npm_install = || {
        if phases.begin_downloading() {
            emit(AgentInstallProgressSignal {
                stage: "downloading",
                error_reason: None,
                failed_stage: None,
            });
        }
        run_command_capture_with_started(
            npm_binary(),
            &["install", "-g", definition.install_package],
            None,
            Duration::from_secs(AGENT_INSTALL_TIMEOUT_SECS),
            None,
            || {
                if phases.begin_installing() {
                    emit(AgentInstallProgressSignal {
                        stage: "installing",
                        error_reason: None,
                        failed_stage: None,
                    });
                }
            },
        )
    };
    let mut install = run_npm_install();
    if let Ok(capture) = &install {
        if capture.exit_code != Some(0) {
            let output = command_output_text(&capture.stdout, &capture.stderr);
            if output.contains("ENOTEMPTY") && cleanup_npm_wedged_temp_dir(&output) {
                install = run_npm_install();
            }
        }
    }
    drop(run_npm_install);

    match install {
        Ok(capture) if capture.exit_code == Some(0) => {
            emit(AgentInstallProgressSignal {
                stage: "verifying",
                error_reason: None,
                failed_stage: None,
            });
            let installed_version = match verify_completed_agent_install(definition, target_version) {
                Ok(installed_version) => installed_version,
                Err(reason) => {
                    emit(AgentInstallProgressSignal {
                        stage: "failed",
                        error_reason: Some(reason.clone()),
                        failed_stage: Some("verifying"),
                    });
                    return failed_agent_install_result(
                        definition,
                        &reason,
                        &capture.stderr,
                        "The installed version could not be verified after npm completed.",
                        if is_update { "update" } else { "install" },
                        "verifying",
                        capture.exit_code,
                        "verification_failed",
                    );
                }
            };
            emit(AgentInstallProgressSignal {
                stage: "complete",
                error_reason: None,
                failed_stage: None,
            });
            AgentInstallResult {
                provider: definition.id,
                label: definition.label,
                ok: true,
                installed: true,
                updated: is_update,
                permission_denied: false,
                error_kind: None,
                failed_stage: None,
                exit_code: capture.exit_code,
                stderr: bounded_agent_install_stderr(&capture.stderr),
                installed_version: installed_version.clone(),
                command: definition.install_command,
                native_install_url: definition.native_install_url,
                message: if is_update {
                    format!(
                        "{} updated successfully to version {}.",
                        definition.label, installed_version
                    )
                } else {
                    format!(
                        "{} version {} installed with npm. Recheck status, then connect your account.",
                        definition.label, installed_version
                    )
                },
            }
        }
        Ok(capture) => {
            let output = command_output_text(&capture.stdout, &capture.stderr);
            let output_summary = first_output_line(&output)
                .chars()
                .take(512)
                .collect::<String>();
            let reason = if output_summary.is_empty() {
                "npm install returned a non-zero status.".to_string()
            } else {
                output_summary
            };
            emit(AgentInstallProgressSignal {
                stage: "failed",
                error_reason: Some(reason),
                failed_stage: Some("installing"),
            });
            failed_agent_install_result(
                definition,
                &output,
                &capture.stderr,
                "npm install returned a non-zero status.",
                if is_update { "update" } else { "install" },
                "installing",
                capture.exit_code,
                "npm_failed",
            )
        }
        Err(error) => {
            emit(AgentInstallProgressSignal {
                stage: "failed",
                error_reason: Some(error.clone()),
                failed_stage: Some(if phases.installing_emitted {
                    "installing"
                } else {
                    "downloading"
                }),
            });
            failed_agent_install_result(
                definition,
                &error,
                &error,
                "Unable to run npm install.",
                if is_update { "update" } else { "install" },
                if phases.installing_emitted {
                    "installing"
                } else {
                    "downloading"
                },
                None,
                "process_error",
            )
        }
    }
}

fn launch_login_terminal(provider: AgentProvider) -> Result<(), String> {
    ensure_app_not_shutting_down("agent login terminal")?;

    let definition = agent_definition(provider);
    let binary = npm_global_executable_path(definition)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| definition.binary.to_string());

    match provider {
        AgentProvider::Codex => {
            if let Some(home) = agent_accounts_default_home("codex") {
                agent_accounts_ensure_codex_file_auth_store(&home)?;
            }
            run_login_terminal(definition.label, &binary, &["login", "--device-auth"])
        }
        AgentProvider::Claude => run_login_terminal(definition.label, &binary, &[]),
        AgentProvider::OpenCode => {
            run_login_terminal(definition.label, &binary, &["auth", "login"])
        }
        AgentProvider::Haider => Err("Haider login is managed by its local daemon.".to_string()),
    }
}

/// Like `launch_login_terminal`, but forces the sign-in flow even when the
/// default home is already authenticated, so a second account can be added
/// for the capture watcher to pin. Plain `claude` would just open the REPL.
fn launch_account_login_terminal(provider: AgentProvider) -> Result<(), String> {
    ensure_app_not_shutting_down("agent account login terminal")?;

    let definition = agent_definition(provider);
    let binary = npm_global_executable_path(definition)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| definition.binary.to_string());

    match provider {
        AgentProvider::Codex => {
            if let Some(home) = agent_accounts_default_home("codex") {
                agent_accounts_ensure_codex_file_auth_store(&home)?;
            }
            run_login_terminal(definition.label, &binary, &["login", "--device-auth"])
        }
        AgentProvider::Claude => run_login_terminal(definition.label, &binary, &["auth", "login"]),
        AgentProvider::OpenCode => {
            run_login_terminal(definition.label, &binary, &["auth", "login"])
        }
        AgentProvider::Haider => Err("Haider login is managed by its local daemon.".to_string()),
    }
}

fn logout_agent_credentials(provider: AgentProvider) -> Result<AgentLogoutResult, String> {
    let definition = agent_definition(provider);
    let args = match provider {
        AgentProvider::Codex => vec!["logout"],
        AgentProvider::Claude => vec!["auth", "logout"],
        AgentProvider::OpenCode => vec!["auth", "logout"],
        AgentProvider::Haider => {
            return Err("Haider logout is managed by its local daemon.".to_string())
        }
    };
    let capture = run_agent_command_capture(
        definition,
        &args,
        None,
        Duration::from_secs(AGENT_LOGOUT_TIMEOUT_SECS),
        None,
    )?;
    let output = command_output_text(&capture.stdout, &capture.stderr);

    if capture.exit_code != Some(0) {
        let detail = first_output_line(&output);

        return Err(if detail.is_empty() {
            format!(
                "{} logout returned a non-zero exit status.",
                definition.label
            )
        } else {
            detail
        });
    }

    Ok(AgentLogoutResult {
        provider: definition.id,
        label: definition.label,
        disconnected: true,
        message: if output.is_empty() {
            format!(
                "{} credentials were removed from this machine.",
                definition.label
            )
        } else {
            first_output_line(&output)
        },
    })
}

fn poll_login_terminal_child_exit(child: &mut std::process::Child) -> bool {
    for _ in 0..TERMINAL_SHUTDOWN_POLL_ATTEMPTS {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => thread::sleep(Duration::from_millis(TERMINAL_SHUTDOWN_POLL_INTERVAL_MS)),
            Err(_) => return true,
        }
    }

    false
}

#[cfg(windows)]
fn kill_login_terminal_child(child: &mut std::process::Child) -> TerminalKillReport {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut report = TerminalKillReport {
        pid: Some(child.id()),
        ..TerminalKillReport::default()
    };

    let mut taskkill = Command::new("taskkill");
    taskkill.creation_flags(CREATE_NO_WINDOW);

    match taskkill
        .arg("/PID")
        .arg(child.id().to_string())
        .arg("/T")
        .arg("/F")
        .current_dir(safe_background_command_working_directory())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
    {
        Ok(status) => {
            report.taskkill_exit_code = status.code();
            report.taskkill_success = Some(status.success());
        }
        Err(error) => {
            report.taskkill_success = Some(false);
            report.taskkill_error = Some(clean_terminal_telemetry_text(&error.to_string()));
        }
    }

    match child.kill() {
        Ok(()) => report.child_kill_ok = true,
        Err(error) => {
            report.child_kill_error = Some(clean_terminal_telemetry_text(&error.to_string()));
        }
    }

    report
}

#[cfg(not(windows))]
fn kill_login_terminal_child(child: &mut std::process::Child) -> TerminalKillReport {
    let mut report = TerminalKillReport {
        pid: Some(child.id()),
        ..TerminalKillReport::default()
    };

    match child.kill() {
        Ok(()) => report.child_kill_ok = true,
        Err(error) => {
            report.child_kill_error = Some(clean_terminal_telemetry_text(&error.to_string()));
        }
    }

    report
}

#[cfg(any(windows, all(unix, not(target_os = "macos"))))]
fn track_login_terminal_child(mut child: std::process::Child) {
    let children = LOGIN_TERMINAL_CHILDREN.get_or_init(|| StdMutex::new(Vec::new()));

    let Ok(mut children) = children.lock() else {
        kill_login_terminal_child(&mut child);
        poll_login_terminal_child_exit(&mut child);
        return;
    };

    children.retain_mut(|existing_child| {
        existing_child
            .try_wait()
            .map(|status| status.is_none())
            .unwrap_or(false)
    });

    if child
        .try_wait()
        .map(|status| status.is_none())
        .unwrap_or(false)
    {
        children.push(child);
    }
}

fn cleanup_login_terminal_children() -> usize {
    let children = LOGIN_TERMINAL_CHILDREN.get_or_init(|| StdMutex::new(Vec::new()));
    let tracked_children = match children.lock() {
        Ok(mut children) => children.drain(..).collect::<Vec<_>>(),
        Err(_) => Vec::new(),
    };
    let tracked_count = tracked_children.len();

    for mut child in tracked_children {
        let mut already_exited = false;

        match child.try_wait() {
            Ok(Some(_)) => {
                already_exited = true;
            }
            Ok(None) => {
                kill_login_terminal_child(&mut child);
            }
            Err(_) => {
                kill_login_terminal_child(&mut child);
            }
        }

        if !already_exited {
            poll_login_terminal_child_exit(&mut child);
        }
    }
    tracked_count
}

#[cfg(windows)]
fn quote_cmd_arg(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

#[cfg(windows)]
fn run_login_terminal_with_env(
    title: &str,
    binary: &str,
    args: &[&str],
    env_vars: &[(String, String)],
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NEW_CONSOLE: u32 = 0x00000010;

    let mut command = Command::new("cmd");
    command.arg("/K").creation_flags(CREATE_NEW_CONSOLE);
    if env_vars.is_empty() {
        command.arg(binary).args(args);
    } else {
        let mut command_line = env_vars
            .iter()
            .map(|(key, value)| format!("set \"{key}={value}\""))
            .collect::<Vec<_>>()
            .join(" && ");
        command_line.push_str(" && ");
        command_line.push_str(&quote_cmd_arg(binary));
        for arg in args {
            command_line.push(' ');
            command_line.push_str(&quote_cmd_arg(arg));
        }
        command.arg(command_line);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("Unable to open {title} login terminal: {error}"))?;

    if let Some(marker) = env_vars.iter().find_map(|(key, value)| {
        (key == "DIFFFORGE_LOGIN_EXIT_MARKER" && !value.trim().is_empty())
            .then(|| PathBuf::from(value))
    }) {
        // A Windows console close can bypass the inner cmd's final redirection.
        // Observe the actual console process as the authoritative exit signal.
        let _ = thread::Builder::new()
            .name("provider-login-exit".to_string())
            .spawn(move || {
                let mut child = child;
                loop {
                    match child.try_wait() {
                        Ok(Some(_)) | Err(_) => break,
                        Ok(None) if crate::app_shutdown_requested() => {
                            let _ = child.kill();
                            let _ = child.wait();
                            break;
                        }
                        Ok(None) => thread::sleep(Duration::from_millis(100)),
                    }
                }
                let acknowledgement = agent_accounts_login_exit_marker_ack_path(&marker);
                if acknowledgement.is_file() {
                    let _ = fs::remove_file(acknowledgement);
                    let _ = fs::remove_file(marker);
                } else if !marker.is_file() {
                    // Forced console close bypasses the inner cmd's status
                    // publisher. Publish cancellation atomically and never
                    // overwrite a completed inner-command marker.
                    let _ = agent_accounts_publish_login_exit_marker(&marker, 130);
                }
            });
    } else {
        track_login_terminal_child(child);
    }

    Ok(())
}

#[cfg(windows)]
fn run_login_terminal(title: &str, binary: &str, args: &[&str]) -> Result<(), String> {
    run_login_terminal_with_env(title, binary, args, &[])
}

#[cfg(any(target_os = "macos", all(unix, not(target_os = "macos"))))]
fn quote_shell_arg(value: &str) -> String {
    if value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"-_./:@%+=,".contains(&byte))
    {
        return value.to_string();
    }

    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "macos")]
fn run_login_terminal_with_env(
    title: &str,
    binary: &str,
    args: &[&str],
    env_vars: &[(String, String)],
) -> Result<(), String> {
    let env_prefix = env_vars
        .iter()
        .map(|(key, value)| format!("{key}={}", quote_shell_arg(value)))
        .collect::<Vec<_>>()
        .join(" ");
    let invocation = std::iter::once(binary)
        .chain(args.iter().copied())
        .map(quote_shell_arg)
        .collect::<Vec<_>>()
        .join(" ");
    let shell_command = if env_prefix.is_empty() {
        invocation
    } else {
        format!("{env_prefix} {invocation}")
    };
    let escaped = shell_command.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!("tell application \"Terminal\" to do script \"{escaped}\"");

    let mut command = Command::new("osascript");
    apply_desktop_command_environment(&mut command);

    command
        .args(["-e", &script])
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Unable to open {title} login terminal: {error}"))
}

#[cfg(target_os = "macos")]
fn run_login_terminal(title: &str, binary: &str, args: &[&str]) -> Result<(), String> {
    run_login_terminal_with_env(title, binary, args, &[])
}

#[cfg(all(unix, not(target_os = "macos")))]
fn run_login_terminal_with_env(
    title: &str,
    binary: &str,
    args: &[&str],
    env_vars: &[(String, String)],
) -> Result<(), String> {
    let command_line = std::iter::once(binary)
        .chain(args.iter().copied())
        .map(quote_shell_arg)
        .collect::<Vec<_>>()
        .join(" ");

    let terminal_attempts = [
        ("x-terminal-emulator", vec!["-e", binary]),
        ("gnome-terminal", vec!["--", binary]),
        ("kgx", vec!["--", binary]),
        ("konsole", vec!["-e", binary]),
        ("xfce4-terminal", vec!["--command", command_line.as_str()]),
        ("mate-terminal", vec!["--command", command_line.as_str()]),
        ("kitty", vec![binary]),
        ("alacritty", vec!["-e", binary]),
    ];

    for (terminal, prefix_args) in terminal_attempts {
        let mut command = Command::new(terminal);
        apply_desktop_command_environment(&mut command);
        for (key, value) in env_vars {
            command.env(key, value);
        }

        if matches!(terminal, "xfce4-terminal" | "mate-terminal") {
            command.args(prefix_args);
        } else {
            command.args(prefix_args).args(args);
        }

        if let Ok(child) = command.spawn() {
            track_login_terminal_child(child);
            return Ok(());
        }
    }

    Err(format!(
        "Unable to open a terminal for {title}. Run {} manually.",
        binary
    ))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn run_login_terminal(title: &str, binary: &str, args: &[&str]) -> Result<(), String> {
    run_login_terminal_with_env(title, binary, args, &[])
}

fn normalize_forge_model(model: Option<String>) -> Result<Option<String>, String> {
    let Some(model) = model else {
        return Ok(None);
    };

    let model = model.trim();

    if model.is_empty() {
        return Ok(None);
    }

    if model.len() > MAX_FORGE_MODEL_LENGTH
        || !model.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':' | b'/')
        })
    {
        return Err("Model id is invalid.".to_string());
    }

    Ok(Some(model.to_string()))
}

fn image_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

const CHAT_ATTACHMENT_STAGE_DIR: &str = "chat-images-staged";
const CHAT_ATTACHMENT_SWEEP_AGE_MS: u64 = 7 * 24 * 60 * 60 * 1000;
static CHAT_ATTACHMENT_STAGE_INDEX: OnceLock<StdMutex<HashMap<String, ChatAttachmentStagedFile>>> =
    OnceLock::new();
static CHAT_ATTACHMENT_VERIFY_CACHE: OnceLock<
    StdMutex<HashMap<ChatAttachmentVerifyCacheKey, ChatAttachmentVerifiedFile>>,
> = OnceLock::new();

#[derive(Clone, Debug, Deserialize)]
struct ChatAttachmentRef {
    #[serde(default)]
    attachment_id: String,
    #[serde(default)]
    sha256: String,
    #[serde(default)]
    bytes: u64,
    #[serde(default)]
    mime: String,
    #[serde(default)]
    name: String,
}

#[derive(Clone, Debug, Deserialize)]
struct ChatAttachmentStageRequest {
    #[serde(default)]
    workspace_id: String,
    #[serde(default)]
    attachments: Vec<ChatAttachmentRef>,
    #[serde(default)]
    ack_cloud: bool,
    #[serde(default)]
    marker_start_index: usize,
}

#[derive(Clone, Debug)]
struct ChatAttachmentStagedFile {
    name: String,
    mime_type: String,
    path: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct ChatAttachmentVerifyCacheKey {
    path: String,
    modified_ns: u128,
    size: u64,
}

#[derive(Clone, Debug)]
struct ChatAttachmentVerifiedFile {
    sha256: String,
    signature_mime: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
struct ChatAttachmentVerifyOutcome {
    cache_hit: bool,
}

#[derive(Clone, Debug)]
struct ChatAttachmentDownload {
    bytes: Vec<u8>,
    content_type: String,
}

#[derive(Clone, Debug)]
struct ChatAttachmentPushImage {
    name: String,
    mime: String,
    sha256: String,
    bytes: Vec<u8>,
}

#[derive(Clone, Debug, Serialize)]
struct ChatAttachmentStageFailure {
    id: String,
    name: String,
    reason: String,
}

#[derive(Serialize)]
struct ChatAttachmentStageResult {
    staged: Vec<String>,
    failed: Vec<ChatAttachmentStageFailure>,
    attachments: Vec<SavedTodoImageAttachment>,
    marker_block: String,
    warning_block: String,
    cloud_acked: bool,
    cloud_ack_error: String,
    workspace_id: String,
}

fn sanitized_image_stem(name: &str, fallback_index: usize) -> String {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let cleaned = stem
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(40)
        .collect::<String>();

    if cleaned.is_empty() {
        format!("image-{}", fallback_index + 1)
    } else {
        cleaned
    }
}

fn sanitized_chat_attachment_id(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(96)
        .collect()
}

fn chat_attachment_is_websocket_id(value: &str) -> bool {
    value
        .trim()
        .strip_prefix("ws-")
        .is_some_and(|sha| sha.len() == 64 && sha.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

fn normalized_chat_attachment_sha(value: &str) -> String {
    let cleaned = value
        .trim()
        .chars()
        .filter(|character| character.is_ascii_hexdigit())
        .take(64)
        .collect::<String>()
        .to_ascii_lowercase();
    if cleaned.len() == 64 {
        cleaned
    } else {
        String::new()
    }
}

fn normalized_chat_attachment_mime(value: &str) -> String {
    value
        .trim()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

fn chat_attachment_display_name(attachment: &ChatAttachmentRef, fallback_index: usize) -> String {
    let raw_name = attachment.name.trim();
    if raw_name.is_empty() {
        return format!("image-{}", fallback_index + 1);
    }
    let sanitized = raw_name
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric()
                || character.is_ascii_whitespace()
                || matches!(*character, '-' | '_' | '.' | '(' | ')')
        })
        .take(120)
        .collect::<String>()
        .trim()
        .to_string();
    if sanitized.is_empty() {
        format!("image-{}", fallback_index + 1)
    } else {
        sanitized
    }
}

fn chat_attachment_file_name(attachment: &ChatAttachmentRef, fallback_index: usize) -> String {
    let sha = normalized_chat_attachment_sha(&attachment.sha256);
    let mime = normalized_chat_attachment_mime(&attachment.mime);
    let extension = image_extension(&mime).unwrap_or("img");
    let stem = sanitized_image_stem(&attachment.name, fallback_index);
    format!("{sha}-{stem}.{extension}")
}

fn chat_attachment_stage_root() -> Result<PathBuf, String> {
    let directory = env::temp_dir()
        .join("diffforge-todo-attachments")
        .join(CHAT_ATTACHMENT_STAGE_DIR);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Unable to prepare chat attachment staging directory: {error}"))?;
    Ok(directory)
}

fn chat_attachment_stage_index() -> &'static StdMutex<HashMap<String, ChatAttachmentStagedFile>> {
    CHAT_ATTACHMENT_STAGE_INDEX.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn chat_attachment_verify_cache(
) -> &'static StdMutex<HashMap<ChatAttachmentVerifyCacheKey, ChatAttachmentVerifiedFile>> {
    CHAT_ATTACHMENT_VERIFY_CACHE.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn chat_attachment_signature_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

fn chat_attachment_sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn chat_attachment_file_modified_ms(path: &Path) -> Option<u64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

fn chat_attachment_verify_cache_key(path: &Path) -> Result<ChatAttachmentVerifyCacheKey, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Unable to inspect staged attachment: {error}"))?;
    if !metadata.is_file() {
        return Err("Staged attachment is not a file.".to_string());
    }
    let modified_ns = metadata
        .modified()
        .map_err(|error| format!("Unable to inspect staged attachment modified time: {error}"))?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Unable to inspect staged attachment modified time: {error}"))?
        .as_nanos();

    Ok(ChatAttachmentVerifyCacheKey {
        path: path.to_string_lossy().to_string(),
        modified_ns,
        size: metadata.len(),
    })
}

fn chat_attachment_verified_file_for_key(
    path: &Path,
    key: &ChatAttachmentVerifyCacheKey,
    use_cache: bool,
) -> Result<(ChatAttachmentVerifiedFile, bool), String> {
    if use_cache {
        if let Ok(cache) = chat_attachment_verify_cache().lock() {
            if let Some(verified) = cache.get(key) {
                return Ok((verified.clone(), true));
            }
        }
    }

    let bytes =
        fs::read(path).map_err(|error| format!("Unable to read staged attachment: {error}"))?;
    if bytes.len() as u64 != key.size {
        return Err("Staged attachment changed while being verified.".to_string());
    }
    let verified = ChatAttachmentVerifiedFile {
        sha256: chat_attachment_sha256_hex(&bytes),
        signature_mime: chat_attachment_signature_mime(&bytes).map(str::to_string),
    };
    if let Ok(mut cache) = chat_attachment_verify_cache().lock() {
        cache.insert(key.clone(), verified.clone());
    }

    Ok((verified, false))
}

fn verify_staged_chat_attachment_path(
    attachment: &ChatAttachmentRef,
    path: &Path,
) -> Result<ChatAttachmentVerifyOutcome, String> {
    verify_staged_chat_attachment_path_with_cache(attachment, path, true)
}

fn verify_staged_chat_attachment_path_with_cache(
    attachment: &ChatAttachmentRef,
    path: &Path,
    use_cache: bool,
) -> Result<ChatAttachmentVerifyOutcome, String> {
    let expected_size = attachment.bytes;
    let expected_sha = normalized_chat_attachment_sha(&attachment.sha256);
    let expected_mime = normalized_chat_attachment_mime(&attachment.mime);
    let key = chat_attachment_verify_cache_key(path)?;
    if key.size != expected_size {
        return Err("Staged attachment size did not match.".to_string());
    }

    let (verified, cache_hit) = chat_attachment_verified_file_for_key(path, &key, use_cache)?;
    if verified.sha256 != expected_sha {
        return Err("Staged attachment hash did not match.".to_string());
    }
    if verified.signature_mime.as_deref() != Some(expected_mime.as_str()) {
        return Err("Staged attachment MIME did not match its bytes.".to_string());
    }

    Ok(ChatAttachmentVerifyOutcome { cache_hit })
}

fn remove_chat_attachment_stage_index_path(path: &Path) {
    let path_string = path.to_string_lossy().to_string();
    if let Ok(mut index) = chat_attachment_stage_index().lock() {
        index.retain(|_, staged| staged.path != path_string);
    }
}

fn remove_chat_attachment_verify_cache_path(path: &Path) {
    let path_string = path.to_string_lossy().to_string();
    if let Ok(mut cache) = chat_attachment_verify_cache().lock() {
        cache.retain(|key, _| key.path != path_string);
    }
}

fn discard_staged_chat_attachment_file(path: &Path) {
    remove_chat_attachment_stage_index_path(path);
    remove_chat_attachment_verify_cache_path(path);
    let _ = fs::remove_file(path);
}

fn sweep_stale_chat_attachments_at(now_ms: u64) -> usize {
    let Ok(root) = chat_attachment_stage_root() else {
        return 0;
    };
    let Ok(entries) = fs::read_dir(&root) else {
        return 0;
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(modified_ms) = chat_attachment_file_modified_ms(&path) else {
            continue;
        };
        if now_ms.saturating_sub(modified_ms) >= CHAT_ATTACHMENT_SWEEP_AGE_MS {
            discard_staged_chat_attachment_file(&path);
            removed += 1;
        }
    }
    removed
}

fn sweep_stale_chat_attachments() -> usize {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    sweep_stale_chat_attachments_at(now_ms)
}

fn chat_attachment_staged_file_from_path(
    path: PathBuf,
    attachment: &ChatAttachmentRef,
    fallback_index: usize,
) -> ChatAttachmentStagedFile {
    ChatAttachmentStagedFile {
        name: chat_attachment_display_name(attachment, fallback_index),
        mime_type: normalized_chat_attachment_mime(&attachment.mime),
        path: path.to_string_lossy().to_string(),
    }
}

fn find_staged_chat_attachment(
    attachment: &ChatAttachmentRef,
    fallback_index: usize,
    use_verify_cache: bool,
) -> Option<ChatAttachmentStagedFile> {
    let sha = normalized_chat_attachment_sha(&attachment.sha256);
    if sha.is_empty() {
        return None;
    }
    let indexed_staged = chat_attachment_stage_index()
        .lock()
        .ok()
        .and_then(|index| index.get(&sha).cloned());
    if let Some(staged) = indexed_staged {
        let path = PathBuf::from(&staged.path);
        if path.is_file() {
            if verify_staged_chat_attachment_path_with_cache(attachment, &path, use_verify_cache)
                .is_ok()
            {
                return Some(staged);
            }
            discard_staged_chat_attachment_file(&path);
        }
    }
    let root = chat_attachment_stage_root().ok()?;
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if path.is_file() && file_name.starts_with(&format!("{sha}-")) {
            if verify_staged_chat_attachment_path_with_cache(attachment, &path, use_verify_cache)
                .is_err()
            {
                discard_staged_chat_attachment_file(&path);
                continue;
            }
            let staged = chat_attachment_staged_file_from_path(path, attachment, fallback_index);
            if let Ok(mut index) = chat_attachment_stage_index().lock() {
                index.insert(sha, staged.clone());
            }
            return Some(staged);
        }
    }
    None
}

fn validate_chat_attachment_ref(
    attachment: &ChatAttachmentRef,
    fallback_index: usize,
) -> Result<(String, String, String), String> {
    let attachment_id = sanitized_chat_attachment_id(&attachment.attachment_id);
    if attachment_id.is_empty() {
        return Err("Attachment id is invalid.".to_string());
    }
    let sha = normalized_chat_attachment_sha(&attachment.sha256);
    if sha.is_empty() {
        return Err("Attachment hash is invalid.".to_string());
    }
    let mime = normalized_chat_attachment_mime(&attachment.mime);
    if image_extension(&mime).is_none() {
        return Err("Images must be PNG, JPEG, WebP, or GIF.".to_string());
    }
    if attachment.bytes == 0 || attachment.bytes as usize > MAX_FORGE_IMAGE_BYTES {
        return Err("Images must be 10 MiB or smaller.".to_string());
    }
    let file_name = chat_attachment_file_name(attachment, fallback_index);
    Ok((attachment_id, sha, file_name))
}

fn verify_chat_attachment_download(
    attachment: &ChatAttachmentRef,
    download: &ChatAttachmentDownload,
) -> Result<(), String> {
    let expected_mime = normalized_chat_attachment_mime(&attachment.mime);
    let expected_sha = normalized_chat_attachment_sha(&attachment.sha256);
    if download.bytes.len() != attachment.bytes as usize {
        return Err("Downloaded attachment size did not match.".to_string());
    }
    if download.bytes.is_empty() || download.bytes.len() > MAX_FORGE_IMAGE_BYTES {
        return Err("Images must be 10 MiB or smaller.".to_string());
    }
    let actual_sha = chat_attachment_sha256_hex(&download.bytes);
    if actual_sha != expected_sha {
        return Err("Downloaded attachment hash did not match.".to_string());
    }
    if chat_attachment_signature_mime(&download.bytes) != Some(expected_mime.as_str()) {
        return Err("Downloaded attachment MIME did not match its bytes.".to_string());
    }
    let response_mime = normalized_chat_attachment_mime(&download.content_type);
    if !response_mime.is_empty()
        && response_mime != "unknown"
        && response_mime != "application/octet-stream"
        && response_mime != expected_mime
    {
        return Err("Downloaded attachment content type did not match.".to_string());
    }
    Ok(())
}

fn write_staged_chat_attachment(
    attachment: &ChatAttachmentRef,
    bytes: &[u8],
    file_name: &str,
    fallback_index: usize,
    use_verify_cache: bool,
) -> Result<ChatAttachmentStagedFile, String> {
    let root = chat_attachment_stage_root()?;
    let path = root.join(file_name);
    if path.is_file() {
        if verify_staged_chat_attachment_path_with_cache(attachment, &path, use_verify_cache)
            .is_err()
        {
            discard_staged_chat_attachment_file(&path);
        } else {
            let staged = chat_attachment_staged_file_from_path(path, attachment, fallback_index);
            return Ok(staged);
        }
    }
    let tmp_path = root.join(format!(".{}-{}.tmp", file_name, uuid::Uuid::new_v4()));
    fs::write(&tmp_path, bytes)
        .map_err(|error| format!("Unable to write staged attachment: {error}"))?;
    fs::rename(&tmp_path, &path).map_err(|error| {
        let _ = fs::remove_file(&tmp_path);
        format!("Unable to finalize staged attachment: {error}")
    })?;
    Ok(chat_attachment_staged_file_from_path(
        path,
        attachment,
        fallback_index,
    ))
}

fn saved_todo_image_from_staged(staged: &ChatAttachmentStagedFile) -> SavedTodoImageAttachment {
    SavedTodoImageAttachment {
        name: staged.name.clone(),
        mime_type: staged.mime_type.clone(),
        path: staged.path.clone(),
    }
}

fn format_saved_todo_image_attachment_markers(
    attachments: &[SavedTodoImageAttachment],
    start_index: usize,
) -> String {
    attachments
        .iter()
        .enumerate()
        .filter_map(|(index, image)| {
            let name = image.name.trim();
            let path = image.path.trim();
            if path.is_empty() {
                None
            } else {
                Some(format!(
                    "[image-attached {}] {} -> {}",
                    start_index + index + 1,
                    if name.is_empty() {
                        format!("image-{}", start_index + index + 1)
                    } else {
                        name.to_string()
                    },
                    path
                ))
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn stage_chat_attachment_refs_with<F>(
    request: ChatAttachmentStageRequest,
    mut downloader: F,
    ack_cloud: bool,
) -> ChatAttachmentStageResult
where
    F: FnMut(&ChatAttachmentRef) -> Result<ChatAttachmentDownload, String>,
{
    stage_chat_attachment_refs_with_cache_mode(request, &mut downloader, ack_cloud, true)
}

fn stage_chat_attachment_refs_with_cache_mode<F>(
    request: ChatAttachmentStageRequest,
    downloader: &mut F,
    ack_cloud: bool,
    use_verify_cache: bool,
) -> ChatAttachmentStageResult
where
    F: FnMut(&ChatAttachmentRef) -> Result<ChatAttachmentDownload, String>,
{
    sweep_stale_chat_attachments();
    let mut result = ChatAttachmentStageResult {
        staged: Vec::new(),
        failed: Vec::new(),
        attachments: Vec::new(),
        marker_block: String::new(),
        warning_block: String::new(),
        cloud_acked: false,
        cloud_ack_error: String::new(),
        workspace_id: request.workspace_id.trim().to_string(),
    };

    if request.attachments.len() > MAX_FORGE_IMAGES {
        result.failed = request
            .attachments
            .iter()
            .enumerate()
            .map(|(index, attachment)| ChatAttachmentStageFailure {
                id: sanitized_chat_attachment_id(&attachment.attachment_id),
                name: chat_attachment_display_name(attachment, index),
                reason: format!("Attach up to {MAX_FORGE_IMAGES} images per todo."),
            })
            .collect();
        result.warning_block = result
            .failed
            .iter()
            .map(|failure| format!("[attachment {} unavailable]", failure.name))
            .collect::<Vec<_>>()
            .join("\n");
        return result;
    }

    let total_bytes = request.attachments.iter().fold(0u64, |total, attachment| {
        total.saturating_add(attachment.bytes)
    });
    if total_bytes > MAX_FORGE_IMAGE_TOTAL_BYTES as u64 {
        result.failed = request
            .attachments
            .iter()
            .enumerate()
            .map(|(index, attachment)| ChatAttachmentStageFailure {
                id: sanitized_chat_attachment_id(&attachment.attachment_id),
                name: chat_attachment_display_name(attachment, index),
                reason: "Images must be 20 MB total or smaller.".to_string(),
            })
            .collect();
        result.warning_block = result
            .failed
            .iter()
            .map(|failure| format!("[attachment {} unavailable]", failure.name))
            .collect::<Vec<_>>()
            .join("\n");
        return result;
    }

    let mut ack_ids = Vec::new();
    for (index, attachment) in request.attachments.iter().enumerate() {
        let display_name = chat_attachment_display_name(attachment, index);
        let (attachment_id, sha, file_name) = match validate_chat_attachment_ref(attachment, index)
        {
            Ok(valid) => valid,
            Err(reason) => {
                result.failed.push(ChatAttachmentStageFailure {
                    id: sanitized_chat_attachment_id(&attachment.attachment_id),
                    name: display_name,
                    reason,
                });
                continue;
            }
        };

        if let Some(staged) = find_staged_chat_attachment(attachment, index, use_verify_cache) {
            result.staged.push(attachment_id.clone());
            if !chat_attachment_is_websocket_id(&attachment_id) {
                ack_ids.push(attachment_id);
            }
            result
                .attachments
                .push(saved_todo_image_from_staged(&staged));
            continue;
        }

        let staged = match downloader(attachment).and_then(|download| {
            verify_chat_attachment_download(attachment, &download)?;
            write_staged_chat_attachment(
                attachment,
                &download.bytes,
                &file_name,
                index,
                use_verify_cache,
            )
        }) {
            Ok(staged) => staged,
            Err(reason) => {
                result.failed.push(ChatAttachmentStageFailure {
                    id: attachment_id,
                    name: display_name,
                    reason,
                });
                continue;
            }
        };
        if !use_verify_cache {
            let staged_path = Path::new(&staged.path);
            if let Err(reason) =
                verify_staged_chat_attachment_path_with_cache(attachment, staged_path, false)
            {
                discard_staged_chat_attachment_file(staged_path);
                result.failed.push(ChatAttachmentStageFailure {
                    id: attachment_id,
                    name: display_name,
                    reason,
                });
                continue;
            }
        }

        if let Ok(mut index) = chat_attachment_stage_index().lock() {
            index.insert(sha, staged.clone());
        }
        result.staged.push(attachment_id.clone());
        if !chat_attachment_is_websocket_id(&attachment_id) {
            ack_ids.push(attachment_id);
        }
        result
            .attachments
            .push(saved_todo_image_from_staged(&staged));
    }

    result.marker_block =
        format_saved_todo_image_attachment_markers(&result.attachments, request.marker_start_index);
    result.warning_block = result
        .failed
        .iter()
        .map(|failure| format!("[attachment {} unavailable]", failure.name))
        .collect::<Vec<_>>()
        .join("\n");

    if ack_cloud && !ack_ids.is_empty() {
        match cloud_mcp_ack_chat_attachments_staged_blocking(&ack_ids) {
            Ok(_) => {
                result.cloud_acked = true;
            }
            Err(error) => {
                result.cloud_ack_error = error;
            }
        }
    }

    result
}

fn stage_chat_attachment_push_images(
    workspace_id: &str,
    images: Vec<ChatAttachmentPushImage>,
) -> Result<ChatAttachmentStageResult, String> {
    let mut downloads = images
        .iter()
        .map(|image| {
            (
                normalized_chat_attachment_sha(&image.sha256),
                ChatAttachmentDownload {
                    bytes: image.bytes.clone(),
                    content_type: normalized_chat_attachment_mime(&image.mime),
                },
            )
        })
        .collect::<HashMap<_, _>>();
    let attachments = images
        .into_iter()
        .map(|image| {
            let sha256 = normalized_chat_attachment_sha(&image.sha256);
            ChatAttachmentRef {
                attachment_id: format!("ws-{sha256}"),
                sha256,
                bytes: image.bytes.len() as u64,
                mime: normalized_chat_attachment_mime(&image.mime),
                name: image.name,
            }
        })
        .collect::<Vec<_>>();
    let result = stage_chat_attachment_refs_with_cache_mode(
        ChatAttachmentStageRequest {
            workspace_id: workspace_id.trim().to_string(),
            attachments,
            ack_cloud: false,
            marker_start_index: 0,
        },
        &mut |attachment: &ChatAttachmentRef| {
            downloads
                .remove(&normalized_chat_attachment_sha(&attachment.sha256))
                .ok_or_else(|| "Inline websocket attachment bytes are unavailable.".to_string())
        },
        false,
        false,
    );
    if result.failed.is_empty() {
        Ok(result)
    } else {
        Err(result
            .failed
            .iter()
            .map(|failure| format!("{}: {}", failure.name, failure.reason))
            .collect::<Vec<_>>()
            .join("; "))
    }
}

fn stage_chat_attachment_refs_for(
    request: ChatAttachmentStageRequest,
) -> ChatAttachmentStageResult {
    let ack_cloud = request.ack_cloud;
    stage_chat_attachment_refs_with_cache_mode(
        request,
        &mut |attachment: &ChatAttachmentRef| {
            let attachment_id = sanitized_chat_attachment_id(&attachment.attachment_id);
            if chat_attachment_is_websocket_id(&attachment_id) {
                return Err(
                    "Websocket-staged attachment is unavailable on this device.".to_string()
                );
            }
            cloud_mcp_download_chat_attachment_blocking(&attachment_id)
        },
        ack_cloud,
        true,
    )
}

fn stage_chat_attachment_refs_for_dispatch(
    request: ChatAttachmentStageRequest,
) -> ChatAttachmentStageResult {
    let ack_cloud = request.ack_cloud;
    stage_chat_attachment_refs_with_cache_mode(
        request,
        &mut |attachment: &ChatAttachmentRef| {
            let attachment_id = sanitized_chat_attachment_id(&attachment.attachment_id);
            if chat_attachment_is_websocket_id(&attachment_id) {
                return Err(
                    "Websocket-staged attachment is unavailable on this device.".to_string()
                );
            }
            cloud_mcp_download_chat_attachment_blocking(&attachment_id)
        },
        ack_cloud,
        false,
    )
}

fn decode_prompt_image(
    image: &ForgePromptImage,
    index: usize,
) -> Result<(String, Vec<u8>), String> {
    let mime_type = image.mime_type.trim().to_ascii_lowercase();
    let extension = image_extension(&mime_type)
        .ok_or_else(|| "Images must be PNG, JPEG, WebP, or GIF.".to_string())?;
    let expected_prefix = format!("data:{mime_type};base64,");

    if !image.data_url.starts_with(&expected_prefix) {
        return Err("Image data did not match its MIME type.".to_string());
    }

    let encoded = &image.data_url[expected_prefix.len()..];
    let decoded = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Image attachment could not be decoded.".to_string())?;

    if decoded.is_empty() || decoded.len() > MAX_FORGE_IMAGE_BYTES {
        return Err("Images must be 5 MB or smaller.".to_string());
    }

    let file_name = format!("{}.{}", sanitized_image_stem(&image.name, index), extension);

    Ok((file_name, decoded))
}

fn prepare_prompt_images(
    provider: AgentProvider,
    images: Vec<ForgePromptImage>,
) -> Result<Option<PreparedPromptImages>, String> {
    if images.is_empty() {
        return Ok(None);
    }

    if !matches!(provider, AgentProvider::Codex) {
        return Err("Image attachments are only supported for Codex local runs.".to_string());
    }

    if images.len() > MAX_FORGE_IMAGES {
        return Err(format!(
            "Attach up to {MAX_FORGE_IMAGES} images per prompt."
        ));
    }

    let mut decoded_images = Vec::with_capacity(images.len());
    let mut total_bytes = 0usize;

    for (index, image) in images.iter().enumerate() {
        let decoded = decode_prompt_image(image, index)?;
        total_bytes += decoded.1.len();

        if total_bytes > MAX_FORGE_IMAGE_TOTAL_BYTES {
            return Err("Images must be 20 MB total or smaller.".to_string());
        }

        decoded_images.push(decoded);
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Unable to prepare image attachment directory: {error}"))?
        .as_millis();
    let directory = env::temp_dir()
        .join("diffforge-forge-images")
        .join(format!("{}-{timestamp}", std::process::id()));

    fs::create_dir_all(&directory)
        .map_err(|error| format!("Unable to prepare image attachment directory: {error}"))?;

    let mut paths = Vec::with_capacity(decoded_images.len());

    for (file_name, bytes) in decoded_images {
        let path = directory.join(file_name);
        if let Err(error) = fs::write(&path, bytes) {
            let _ = fs::remove_dir_all(&directory);
            return Err(format!("Unable to write image attachment: {error}"));
        }
        paths.push(path.to_string_lossy().to_string());
    }

    Ok(Some(PreparedPromptImages { directory, paths }))
}

fn todo_attachment_directory(prefix: &str) -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Unable to prepare todo attachment directory: {error}"))?
        .as_millis();
    let directory = env::temp_dir()
        .join("diffforge-todo-attachments")
        .join(format!("{}-{}-{timestamp}", std::process::id(), prefix));

    fs::create_dir_all(&directory)
        .map_err(|error| format!("Unable to prepare todo attachment directory: {error}"))?;

    Ok(directory)
}

fn save_todo_image_attachments_for(
    images: Vec<ForgePromptImage>,
) -> Result<Vec<SavedTodoImageAttachment>, String> {
    if images.is_empty() {
        return Ok(Vec::new());
    }

    if images.len() > MAX_FORGE_IMAGES {
        return Err(format!("Attach up to {MAX_FORGE_IMAGES} images per todo."));
    }

    let mut decoded_images = Vec::with_capacity(images.len());
    let mut total_bytes = 0usize;

    for (index, image) in images.iter().enumerate() {
        let mime_type = image.mime_type.trim().to_ascii_lowercase();
        let decoded = decode_prompt_image(image, index)?;
        total_bytes += decoded.1.len();

        if total_bytes > MAX_FORGE_IMAGE_TOTAL_BYTES {
            return Err("Images must be 20 MB total or smaller.".to_string());
        }

        decoded_images.push((decoded.0, decoded.1, mime_type));
    }

    let directory = todo_attachment_directory("images")?;
    let mut saved_images = Vec::with_capacity(decoded_images.len());

    for (file_name, bytes, mime_type) in decoded_images {
        let path = directory.join(&file_name);
        if let Err(error) = fs::write(&path, bytes) {
            let _ = fs::remove_dir_all(&directory);
            return Err(format!("Unable to write image attachment: {error}"));
        }

        saved_images.push(SavedTodoImageAttachment {
            name: file_name,
            mime_type,
            path: path.to_string_lossy().to_string(),
        });
    }

    Ok(saved_images)
}

fn sanitized_text_attachment_stem(title: &str, line_count: usize) -> String {
    let cleaned = title
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(48)
        .collect::<String>();

    if cleaned.is_empty() {
        format!("pasted-lines-{line_count}")
    } else {
        cleaned
    }
}

fn save_todo_text_attachment_for(
    request: TodoTextAttachmentRequest,
) -> Result<SavedTodoTextAttachment, String> {
    let text = request.text.replace("\r\n", "\n").replace('\r', "\n");
    let byte_count = text.as_bytes().len();

    if text.trim().is_empty() {
        return Err("Pasted text attachment is empty.".to_string());
    }

    if byte_count > MAX_TODO_TEXT_ATTACHMENT_BYTES {
        return Err("Pasted text attachment is too large.".to_string());
    }

    let line_count = text.lines().count().max(1);
    let title = request
        .title
        .map(|value| value.trim().chars().take(80).collect::<String>())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("[pasted-lines {line_count}]"));
    let directory = todo_attachment_directory("text")?;
    let file_name = format!("{}.txt", sanitized_text_attachment_stem(&title, line_count));
    let path = directory.join(file_name);

    fs::write(&path, text)
        .map_err(|error| format!("Unable to write pasted text attachment: {error}"))?;

    Ok(SavedTodoTextAttachment {
        line_count,
        path: path.to_string_lossy().to_string(),
        title,
    })
}

fn temporary_agent_output_path(prefix: &str) -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Unable to prepare agent output file: {error}"))?
        .as_millis();
    let directory = env::temp_dir().join("diffforge-agent-turn-output");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Unable to prepare agent output directory: {error}"))?;
    Ok(directory.join(format!(
        "{}-{}-{timestamp}.txt",
        std::process::id(),
        prefix
            .chars()
            .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
            .take(24)
            .collect::<String>()
    )))
}

fn json_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn extract_session_id_from_json(value: &Value) -> Option<String> {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                let normalized_key = key
                    .chars()
                    .filter(|character| character.is_ascii_alphanumeric())
                    .collect::<String>()
                    .to_ascii_lowercase();
                if matches!(normalized_key.as_str(), "sessionid" | "sessionuuid") {
                    if let Some(session_id) = json_string(Some(child)) {
                        return Some(clean_codex_id(session_id));
                    }
                }
                if normalized_key == "session" {
                    if let Some(session_object) = child.as_object() {
                        if let Some(session_id) = json_string(session_object.get("id")) {
                            return Some(clean_codex_id(session_id));
                        }
                    }
                }
            }

            object.values().find_map(extract_session_id_from_json)
        }
        Value::Array(items) => items.iter().find_map(extract_session_id_from_json),
        _ => None,
    }
}

fn json_content_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.trim().to_string(),
        Value::Array(items) => items
            .iter()
            .map(json_content_text)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(object) => {
            if let Some(text) = json_string(object.get("text")) {
                return text;
            }
            if let Some(text) = json_string(object.get("content")) {
                return text;
            }
            if let Some(content) = object.get("content") {
                return json_content_text(content);
            }
            String::new()
        }
        _ => String::new(),
    }
}

fn collect_agent_turn_texts(value: &Value, texts: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            let event_type = json_string(object.get("type"))
                .unwrap_or_default()
                .to_ascii_lowercase();
            let role = json_string(object.get("role"))
                .unwrap_or_default()
                .to_ascii_lowercase();

            if event_type == "result" {
                if let Some(result) = json_string(object.get("result")) {
                    texts.push(result);
                }
            }

            if role == "assistant"
                || event_type.contains("assistant")
                || event_type.contains("message")
            {
                for key in ["message", "content", "text", "delta", "output"] {
                    if let Some(child) = object.get(key) {
                        let text = json_content_text(child);
                        if !text.is_empty() {
                            texts.push(text);
                        }
                    }
                }
            }

            object
                .values()
                .for_each(|child| collect_agent_turn_texts(child, texts));
        }
        Value::Array(items) => {
            items
                .iter()
                .for_each(|child| collect_agent_turn_texts(child, texts));
        }
        _ => {}
    }
}

fn extract_agent_turn_metadata(stdout: &str, stderr: &str) -> (String, String) {
    let mut session_id = String::new();
    let mut texts = Vec::new();
    let combined = command_output_text(stdout, stderr);
    let combined_trimmed = combined.trim();
    if (combined_trimmed.starts_with('{') || combined_trimmed.starts_with('['))
        && serde_json::from_str::<Value>(combined_trimmed)
            .map(|value| {
                session_id = extract_session_id_from_json(&value).unwrap_or_default();
                collect_agent_turn_texts(&value, &mut texts);
            })
            .is_ok()
    {
        let output = texts
            .into_iter()
            .map(|text| clean_codex_transcript_text(text, CODEX_TRANSCRIPT_MAX_TEXT))
            .filter(|text| !text.is_empty())
            .last()
            .unwrap_or_default();
        return (session_id, output);
    }

    for line in stdout.lines().chain(stderr.lines()) {
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.starts_with('{') {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if session_id.is_empty() {
            session_id = extract_session_id_from_json(&value).unwrap_or_default();
        }
        collect_agent_turn_texts(&value, &mut texts);
    }

    let output = texts
        .into_iter()
        .map(|text| clean_codex_transcript_text(text, CODEX_TRANSCRIPT_MAX_TEXT))
        .filter(|text| !text.is_empty())
        .last()
        .unwrap_or_default();

    (session_id, output)
}

fn build_codex_turn_args(
    model: Option<&str>,
    provider_session_id: &str,
    output_path: &Path,
) -> Vec<String> {
    let mut args = vec![
        "--ask-for-approval".to_string(),
        "never".to_string(),
        "--disable".to_string(),
        "apps".to_string(),
        "exec".to_string(),
        "--sandbox".to_string(),
        "workspace-write".to_string(),
        "--color".to_string(),
        "never".to_string(),
    ];
    args.push("--skip-git-repo-check".to_string());
    args.push("--output-last-message".to_string());
    args.push(output_path.to_string_lossy().to_string());
    if let Some(model) = model {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    if !provider_session_id.is_empty() {
        args.push("resume".to_string());
        args.push(provider_session_id.to_string());
    }
    args.push("-".to_string());
    args
}

fn build_claude_turn_args(
    model: Option<&str>,
    provider_session_id: &str,
    prompt: &str,
) -> Vec<String> {
    let mut args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "json".to_string(),
    ];
    if let Some(model) = model {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    if !provider_session_id.is_empty() {
        args.push("--resume".to_string());
        args.push(provider_session_id.to_string());
    }
    args.push(prompt.to_string());
    args
}

fn build_opencode_turn_args(
    model: Option<&str>,
    provider_session_id: &str,
    prompt: &str,
    cwd: &Path,
) -> Vec<String> {
    let mut args = vec![
        "run".to_string(),
        "--dir".to_string(),
        cwd.to_string_lossy().to_string(),
    ];
    if let Some(model) = model {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    if !provider_session_id.is_empty() {
        args.push("--session".to_string());
        args.push(provider_session_id.to_string());
    }
    args.push(prompt.to_string());
    args
}

fn run_agent_thread_turn_for(
    request: AgentThreadTurnRequest,
) -> Result<AgentThreadTurnResult, String> {
    run_agent_thread_turn_for_context(request, &[])
}

fn run_agent_thread_turn_for_context(
    request: AgentThreadTurnRequest,
    env_vars: &[(String, String)],
) -> Result<AgentThreadTurnResult, String> {
    let provider = parse_agent_provider(&request.agent_id)?;
    let definition = agent_definition(provider);
    let prompt = request.prompt.trim();
    let model = normalize_forge_model(request.model)?;
    let requested_provider_session_id =
        clean_codex_id(request.provider_session_id.unwrap_or_default());

    if prompt.is_empty() {
        return Err("Write a message before sending.".to_string());
    }

    if prompt.len() > MAX_FORGE_PROMPT_LENGTH {
        return Err("Message is too long for a local agent turn.".to_string());
    }

    let working_directory = resolve_workspace_root_directory(request.working_directory.as_deref())?;
    let working_directory_text = working_directory.to_string_lossy().to_string();
    let mut launch_env_vars = env_vars.to_vec();
    let launch_account_binding = TerminalProviderLaunchAccountBinding::capture(provider);
    launch_account_binding.validate_frozen_account(provider, true)?;
    launch_account_binding.apply_to_env(&mut launch_env_vars);
    let _workspace_trust = prepare_terminal_launch_account(
        &launch_env_vars,
        definition.id,
        &launch_account_binding,
    )?;
    let resume_was_requested =
        terminal_clean_provider_session_id(Some(&requested_provider_session_id)).is_some();
    let (launch_provider_session_id, codex_resume_home) =
        terminal_resolve_provider_resume_session_for_binding(
            provider,
            terminal_clean_provider_session_id(Some(&requested_provider_session_id)),
            &working_directory_text,
            &launch_account_binding,
        );
    if matches!(provider, AgentProvider::Claude)
        && resume_was_requested
        && launch_provider_session_id.is_none()
    {
        return Err(terminal_claude_resume_unavailable_message());
    }
    if let Some(home) = codex_resume_home.as_deref() {
        apply_codex_resume_home_env(
            &mut launch_env_vars,
            home,
            launch_provider_session_id.as_deref().unwrap_or_default(),
            Some(&launch_account_binding),
        )?;
    }
    let launch_provider_session_id = launch_provider_session_id.unwrap_or_default();
    let mut output_path = None;
    let (args, stdin_text) = match provider {
        AgentProvider::Codex => {
            let path = temporary_agent_output_path("codex")?;
            let args =
                build_codex_turn_args(model.as_deref(), &launch_provider_session_id, &path);
            output_path = Some(path);
            (args, Some(prompt))
        }
        AgentProvider::Claude => {
            let args =
                build_claude_turn_args(model.as_deref(), &launch_provider_session_id, prompt);
            (args, None)
        }
        AgentProvider::OpenCode => (
            build_opencode_turn_args(
                model.as_deref(),
                &launch_provider_session_id,
                prompt,
                &working_directory,
            ),
            None,
        ),
        AgentProvider::Haider => {
            return Err("Haider non-interactive turns are managed by its local daemon.".to_string())
        }
    };
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();

    let capture = run_agent_command_capture_with_env(
        definition,
        &arg_refs,
        stdin_text,
        Duration::from_secs(AGENT_THREAD_TURN_TIMEOUT_SECS),
        Some(&working_directory),
        &launch_env_vars,
    );
    let output_from_file = output_path
        .as_ref()
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_default()
        .trim()
        .to_string();
    if let Some(path) = &output_path {
        let _ = fs::remove_file(path);
    }

    let capture = capture?;
    let stderr = capture.stderr.trim().to_string();
    let stdout = capture.stdout.trim().to_string();
    if capture.exit_code != Some(0) {
        let message = first_output_line(&command_output_text(&stdout, &stderr));
        return Err(if message.is_empty() {
            format!("{} returned a non-zero exit status.", definition.label)
        } else {
            message
        });
    }

    let (parsed_session_id, parsed_output) = extract_agent_turn_metadata(&stdout, &stderr);
    let output = if !output_from_file.is_empty() {
        output_from_file
    } else if !parsed_output.is_empty() {
        parsed_output
    } else {
        clean_codex_transcript_text(
            command_output_text(&stdout, &stderr),
            CODEX_TRANSCRIPT_MAX_TEXT,
        )
    };

    Ok(AgentThreadTurnResult {
        agent_id: definition.id.to_string(),
        label: definition.label.to_string(),
        model: model.unwrap_or_default(),
        output: if output.trim().is_empty() {
            "(No output returned.)".to_string()
        } else {
            output
        },
        provider_session_id: if parsed_session_id.is_empty() {
            launch_provider_session_id
        } else {
            parsed_session_id
        },
        requested_provider_session_id,
        stderr,
        working_directory: workspace_path_display(&working_directory),
    })
}

#[tauri::command(rename_all = "snake_case")]
async fn save_todo_image_attachments(
    images: Vec<ForgePromptImage>,
) -> Result<Vec<SavedTodoImageAttachment>, String> {
    tauri::async_runtime::spawn_blocking(move || save_todo_image_attachments_for(images))
        .await
        .map_err(|error| format!("Unable to prepare todo image attachments: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn stage_chat_attachment_refs(
    request: ChatAttachmentStageRequest,
) -> Result<ChatAttachmentStageResult, String> {
    tauri::async_runtime::spawn_blocking(move || stage_chat_attachment_refs_for(request))
        .await
        .map_err(|error| format!("Unable to stage chat attachments: {error}"))
}

#[tauri::command(rename_all = "snake_case")]
async fn save_todo_text_attachment(
    request: TodoTextAttachmentRequest,
) -> Result<SavedTodoTextAttachment, String> {
    tauri::async_runtime::spawn_blocking(move || save_todo_text_attachment_for(request))
        .await
        .map_err(|error| format!("Unable to prepare pasted text attachment: {error}"))?
}

fn run_forge_prompt_for(request: ForgePromptRequest) -> Result<ForgeRunResult, String> {
    let provider = parse_agent_provider(&request.provider)?;
    let definition = agent_definition(provider);
    let prompt = request.prompt.trim();
    let model = normalize_forge_model(request.model)?;

    if prompt.is_empty() {
        return Err("Write a prompt before running Forge Console.".to_string());
    }

    if prompt.len() > MAX_FORGE_PROMPT_LENGTH {
        return Err("Forge prompt is too long for this local console run.".to_string());
    }

    let working_directory = resolve_workspace_root_directory(request.working_directory.as_deref())?;
    let prepared_images = prepare_prompt_images(provider, request.images.unwrap_or_default())?;
    let mut codex_output_path: Option<PathBuf> = None;

    let capture_result = match provider {
        AgentProvider::Codex => {
            let output_directory = env::temp_dir().join("diffforge-codex-output");
            let output_path = output_directory.join(format!(
                "{}-{}.txt",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|error| format!("Unable to prepare Codex output file: {error}"))?
                    .as_millis()
            ));

            fs::create_dir_all(&output_directory)
                .map_err(|error| format!("Unable to prepare Codex output directory: {error}"))?;
            codex_output_path = Some(output_path.clone());

            let mut args = vec![
                "--ask-for-approval".to_string(),
                "never".to_string(),
                "exec".to_string(),
                "--skip-git-repo-check".to_string(),
                "--sandbox".to_string(),
                "read-only".to_string(),
                "--color".to_string(),
                "never".to_string(),
            ];

            if let Some(model) = &model {
                args.push("--model".to_string());
                args.push(model.clone());
            }

            args.push("--output-last-message".to_string());
            args.push(output_path.to_string_lossy().to_string());

            if let Some(images) = &prepared_images {
                for path in &images.paths {
                    args.push("--image".to_string());
                    args.push(path.clone());
                }
            }

            args.push("-".to_string());
            let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();

            run_agent_command_capture(
                definition,
                &arg_refs,
                Some(prompt),
                Duration::from_secs(AGENT_RUN_TIMEOUT_SECS),
                Some(&working_directory),
            )
        }
        AgentProvider::Claude => {
            let mut args = Vec::new();

            if let Some(model) = &model {
                args.push("--model".to_string());
                args.push(model.clone());
            }

            args.push("-p".to_string());
            args.push(prompt.to_string());
            let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();

            run_agent_command_capture(
                definition,
                &arg_refs,
                None,
                Duration::from_secs(AGENT_RUN_TIMEOUT_SECS),
                Some(&working_directory),
            )
        }
        AgentProvider::OpenCode => {
            let mut args = vec!["run".to_string()];

            if let Some(model) = &model {
                args.push("--model".to_string());
                args.push(model.clone());
            }

            args.push(prompt.to_string());
            let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();

            run_agent_command_capture(
                definition,
                &arg_refs,
                None,
                Duration::from_secs(AGENT_RUN_TIMEOUT_SECS),
                Some(&working_directory),
            )
        }
        AgentProvider::Haider => {
            return Err("Haider Forge prompts are managed by its local daemon.".to_string())
        }
    };

    if let Some(images) = &prepared_images {
        let _ = fs::remove_dir_all(&images.directory);
    }

    let capture = match capture_result {
        Ok(capture) => capture,
        Err(error) => {
            if let Some(path) = &codex_output_path {
                let _ = fs::remove_file(path);
            }

            return Err(error);
        }
    };
    let output_from_file = codex_output_path
        .as_ref()
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_default()
        .trim()
        .to_string();
    if let Some(path) = &codex_output_path {
        let _ = fs::remove_file(path);
    }

    let output = if output_from_file.is_empty() {
        capture.stdout.trim().to_string()
    } else {
        output_from_file
    };
    let stderr = capture.stderr.trim().to_string();

    if capture.exit_code != Some(0) {
        let message = first_output_line(&command_output_text(&output, &stderr));
        return Err(if message.is_empty() {
            format!("{} returned a non-zero exit status.", definition.label)
        } else {
            message
        });
    }

    Ok(ForgeRunResult {
        provider: definition.id,
        label: definition.label,
        model: model.unwrap_or_default(),
        output: if output.is_empty() {
            "(No output returned.)".to_string()
        } else {
            output
        },
        stderr,
        working_directory: workspace_path_display(&working_directory),
    })
}

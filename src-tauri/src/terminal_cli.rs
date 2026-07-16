fn parse_agent_provider(provider: &str) -> Result<AgentProvider, String> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "codex" => Ok(AgentProvider::Codex),
        "claude" | "claude-code" | "claude_code" => Ok(AgentProvider::Claude),
        "opencode" | "open-code" | "open_code" => Ok(AgentProvider::OpenCode),
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

fn failed_agent_install_result(
    definition: AgentDefinition,
    output: &str,
    fallback_message: &str,
    operation: &str,
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
        installed: false,
        updated: false,
        permission_denied,
        command: definition.install_command,
        native_install_url: definition.native_install_url,
        message: if permission_denied {
            format!(
                "{} {operation} was blocked by npm permissions. Close running {} terminals, then retry from an elevated app or fix the npm global prefix.",
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
    coordination: Option<&TerminalCoordinationSession>,
    permission_mode: Option<&str>,
    pane_id: &str,
    instance_id: u64,
    activity_transport: Option<&TerminalActivityTransportEndpoint>,
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
    let Some(coordination) = coordination else {
        return next;
    };

    let env_value = |key: &str| -> Option<String> {
        coordination.env_vars.iter().find_map(|(candidate, value)| {
            (candidate == key && !value.trim().is_empty()).then(|| value.clone())
        })
    };
    let codex_profile = env_value("DIFFFORGE_CODEX_PROFILE");
    let codex_bypass_hook_trust = env_value("DIFFFORGE_CODEX_BYPASS_HOOK_TRUST")
        .is_some_and(|value| terminal_env_truthy(&value));
    let enforcement_mode = env_value("COORDINATION_ENFORCEMENT_MODE").unwrap_or_default();
    let file_authority = env_value("COORDINATION_FILE_AUTHORITY").unwrap_or_default();

    let coordination_args = terminal_coordination_proxy_args(coordination);

    if is_codex {
        let _ = (enforcement_mode.as_str(), file_authority.as_str());
        apply_codex_coordinated_auto_approval_args(
            &mut next,
            codex_profile.as_deref(),
            codex_bypass_hook_trust,
            permission_mode,
        );

        append_codex_mcp_server_config_args(
            &mut next,
            "coordination-kernel",
            &coordination.mcp_command,
            &coordination_args,
        );
        for tool in crate::coordination::mcp::TOOL_NAMES {
            append_codex_mcp_tool_approval_arg(&mut next, "coordination-kernel", tool);
        }

        let gateway_args =
            terminal_workspace_gateway_args_from_coordination_args(&coordination_args);
        append_codex_mcp_server_config_args(
            &mut next,
            "workspace-mcp-gateway",
            &coordination.mcp_command,
            &gateway_args,
        );
        append_codex_workspace_gateway_bridge_env_args(&mut next);
        for tool in TERMINAL_WORKSPACE_MCP_GATEWAY_TOOLS {
            append_codex_mcp_tool_approval_arg(&mut next, "workspace-mcp-gateway", tool);
        }
        if let Some(value) = env_value("DIFFFORGE_WORKSPACE_MCP_ALLOWED_TOOLS") {
            for tool in value
                .split(',')
                .map(str::trim)
                .filter(|tool| !tool.is_empty())
            {
                append_codex_mcp_tool_approval_arg(&mut next, "workspace-mcp-gateway", tool);
            }
        }
        next.push("-c".to_string());
        next.push("shell_environment_policy.inherit=all".to_string());
    }
    if is_claude {
        apply_claude_coordinated_auto_approval_args(
            &mut next,
            coordination,
            &coordination_args,
            permission_mode,
            pane_id,
            instance_id,
            terminal_coordination_env_value(coordination, "COORDINATION_WORKSPACE_ID").as_deref(),
            terminal_coordination_env_value(coordination, "DIFFFORGE_TERMINAL_INDEX")
                .as_deref()
                .and_then(|value| value.parse::<u16>().ok()),
            activity_transport,
        );
    }
    next
}

fn terminal_coordination_proxy_args(coordination: &TerminalCoordinationSession) -> Vec<String> {
    let mut coordination_args =
        crate::coordination::mcp::proxy_args_for_repo(&coordination.repo_path);
    coordination_args.extend([
        "--repo-path".to_string(),
        coordination.repo_path.clone(),
        "--db-path".to_string(),
        coordination.db_path.clone(),
        "--agent-id".to_string(),
        coordination.agent_id.clone(),
        "--session-id".to_string(),
        coordination.session_id.clone(),
    ]);
    for (env_key, arg_key) in [
        ("COORDINATION_AGENT_SLOT_ID", "--agent-slot-id"),
        ("COORDINATION_SLOT_KEY", "--slot-key"),
        (
            "COORDINATION_TERMINAL_LAUNCH_EPOCH",
            "--terminal-launch-epoch",
        ),
        ("COORDINATION_TASK_ID", "--task-id"),
        ("COORDINATION_WORKTREE_ID", "--worktree-id"),
        ("COORDINATION_WORKTREE_PATH", "--worktree-path"),
        ("COORDINATION_WORKSPACE_ID", "--workspace-id"),
        ("COORDINATION_OBJECTIVE_KEY", "--objective-key"),
    ] {
        if let Some(value) = terminal_coordination_env_value(coordination, env_key) {
            coordination_args.push(arg_key.to_string());
            coordination_args.push(value);
        }
    }
    coordination_args
}

const TERMINAL_WORKSPACE_MCP_GATEWAY_TOOLS: &[&str] = &[
    "workspace_mcp__sync_manifest",
    "workspace_mcp__list_servers",
    "workspace_mcp__get_server_status",
    "workspace_mcp__get_server_config",
    "workspace_mcp__write_env_file",
    "secrets__list",
    "secrets__get",
    "secrets__write_env_file",
    "secrets__ssh_list",
    "secrets__ssh_connect",
    "secrets__ssh_get",
    "video_context",
    "video_edit",
    "video_transcribe",
    "video_look",
    "video_media",
    "video_generate",
    "video_export",
];
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
- Loopspace packets use compact LS/1 lines instead of verbose JSON. When executing a Dispatch Todo with loop_runtime_run_id, the initial todo carries run identity only, not the child loop contents. Call coordination-kernel.start_task with loopspace_id, loop_runtime_run_id, loop_runtime_node_id, loop_runtime_edge_id, trigger_id, and trigger_run_id when present, wait for its response, and use the LS/1 run_context in loopspace_run_context. It returns only the connected subloop slice, the main Dispatch Todo action for direct runs or the first/current child checkpoint for stepped runs, and the exact docs/assets read-write resources. coordination-kernel.start_task creates the local task and injects the Cloud-backed Loopspace run context; coordination-kernel.checkpoint remains local visibility only. After each local checkpoint, call record_loopspace_step_progress, include the loop runtime ids, wait for the response, and follow next_checkpoint before moving on. For dispatch_todos, todo queue status is the final source of completed/failed/interrupted state; checkpoint progress only updates the internal step display. Do not connect send_message.exec, send_message.success, dispatch_todos.exec, dispatch_todos.success, run_script.exec, or other action execution branches directly into document_write or asset_write; route generated docs/assets through child step docs/assets ports. Prefer patch_loopspace_graph for attach_trigger, add_node, move_node, remove_node, connect, disconnect, and update_node_props; specify from_port and to_port on connect operations, especially from run_script/send_message/dispatch_todos/notify_device action nodes. Use update_loopspace_graph only for larger full-source rewrites, preserve existing ids, and wait for the hydrated result.
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

fn append_codex_workspace_gateway_bridge_env_args(args: &mut Vec<String>) {
    let server_key = terminal_toml_key_segment("workspace-mcp-gateway");
    for (key, value) in terminal_app_bridge_env_vars() {
        args.push("-c".to_string());
        args.push(format!(
            "mcp_servers.{server_key}.env.{}={}",
            terminal_toml_key_segment(&key),
            terminal_toml_string(&value)
        ));
    }
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

fn terminal_coordination_arg_value(args: &[String], key: &str) -> Option<String> {
    args.windows(2)
        .find_map(|items| (items[0] == key).then(|| items[1].clone()))
        .filter(|value| !value.trim().is_empty())
}

fn terminal_workspace_gateway_args_from_coordination_args(args: &[String]) -> Vec<String> {
    let mut gateway_args = vec!["--workspace-mcp-gateway".to_string()];
    for key in [
        "--repo-path",
        "--db-path",
        "--workspace-id",
        "--objective-key",
        "--agent-id",
        "--agent-slot-id",
        "--slot-key",
        "--session-id",
        "--terminal-launch-epoch",
        "--task-id",
        "--worktree-id",
        "--worktree-path",
    ] {
        if let Some(value) = terminal_coordination_arg_value(args, key) {
            gateway_args.extend([key.to_string(), value]);
        }
    }
    gateway_args
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

fn terminal_coordination_env_value(
    coordination: &TerminalCoordinationSession,
    key: &str,
) -> Option<String> {
    coordination.env_vars.iter().find_map(|(candidate, value)| {
        (candidate == key && !value.trim().is_empty()).then(|| value.clone())
    })
}

fn terminal_full_filesystem_root() -> &'static str {
    "/"
}

fn claude_workspace_permission_root(coordination: &TerminalCoordinationSession) -> String {
    let root = coordination.repo_path.trim();
    if root.is_empty() {
        terminal_full_filesystem_root().to_string()
    } else {
        root.to_string()
    }
}

fn claude_workspace_permission_glob(coordination: &TerminalCoordinationSession) -> String {
    let root = claude_workspace_permission_root(coordination)
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    if root.is_empty() || root == "/" {
        "//**".to_string()
    } else {
        format!("{root}/**")
    }
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

fn apply_codex_coordinated_auto_approval_args(
    args: &mut Vec<String>,
    codex_profile: Option<&str>,
    bypass_hook_trust: bool,
    permission_mode: Option<&str>,
) {
    apply_codex_interactive_permission_args(args, permission_mode);
    strip_terminal_arg_option(args, "--profile", "-p", true);
    if let Some(profile) = codex_profile.filter(|value| !value.trim().is_empty()) {
        args.insert(0, profile.to_string());
        args.insert(0, "--profile".to_string());
    }

    strip_terminal_arg_option(args, "--dangerously-bypass-hook-trust", "", false);
    strip_terminal_arg_option_value(args, "--enable", "", "apps");
    strip_terminal_arg_option_value(args, "--disable", "", "apps");
    strip_terminal_arg_option(args, "--cd", "-C", true);

    if !terminal_args_have_option_value(args, "--enable", "", "hooks") {
        args.push("--enable".to_string());
        args.push("hooks".to_string());
    }
    if bypass_hook_trust {
        args.push("--dangerously-bypass-hook-trust".to_string());
    }
}

fn apply_codex_hook_trust_bypass_arg(args: &mut Vec<String>) {
    strip_terminal_arg_option(args, "--dangerously-bypass-hook-trust", "", false);
    args.push("--dangerously-bypass-hook-trust".to_string());
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

fn strip_terminal_arg_option_value(args: &mut Vec<String>, long: &str, short: &str, value: &str) {
    let value = value.trim();
    let mut next = Vec::with_capacity(args.len());
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        let exact = arg == long || (!short.is_empty() && arg == short);
        if exact && index + 1 < args.len() && args[index + 1].trim() == value {
            index += 2;
            continue;
        }

        let inline_matches = (!long.is_empty()
            && arg
                .strip_prefix(&format!("{long}="))
                .is_some_and(|candidate| candidate.trim() == value))
            || (!short.is_empty()
                && arg
                    .strip_prefix(&format!("{short}="))
                    .is_some_and(|candidate| candidate.trim() == value));
        if inline_matches {
            index += 1;
            continue;
        }

        next.push(arg.clone());
        index += 1;
    }
    *args = next;
}

fn apply_claude_coordinated_auto_approval_args(
    args: &mut Vec<String>,
    coordination: &TerminalCoordinationSession,
    coordination_args: &[String],
    permission_mode: Option<&str>,
    pane_id: &str,
    instance_id: u64,
    workspace_id: Option<&str>,
    terminal_index: Option<u16>,
    activity_transport: Option<&TerminalActivityTransportEndpoint>,
) {
    let permission_mode = permission_mode.unwrap_or(TERMINAL_PERMISSION_MODE_ACCEPT_EDITS);
    strip_terminal_arg_option(args, "--dangerously-skip-permissions", "", false);
    strip_terminal_arg_option(args, "--allow-dangerously-skip-permissions", "", false);

    strip_terminal_arg_option(args, "--add-dir", "", true);
    args.push("--add-dir".to_string());
    args.push(claude_workspace_permission_root(coordination));

    strip_terminal_arg_option(args, "--allowedTools", "", true);
    strip_terminal_arg_option(args, "--allowed-tools", "", true);
    if permission_mode != TERMINAL_PERMISSION_MODE_BYPASS {
        args.push("--allowedTools".to_string());
        args.push(claude_allowed_tools_arg(coordination, permission_mode));
    }

    strip_terminal_arg_option(args, "--mcp-config", "", true);
    args.push("--mcp-config".to_string());
    args.push(claude_coordination_mcp_config_arg(
        coordination,
        coordination_args,
    ));

    apply_claude_interactive_permission_mode_arg(args, Some(permission_mode));

    strip_terminal_arg_option(args, "--settings", "", true);
    args.push("--settings".to_string());
    args.push(claude_write_authority_guard_settings(
        coordination,
        permission_mode,
        pane_id,
        instance_id,
        workspace_id,
        terminal_index,
        activity_transport,
    ));

    strip_terminal_arg_option(args, "--setting-sources", "", true);

    apply_claude_managed_mcp_isolation_args(args);
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

fn claude_allowed_tools_arg(
    coordination: &TerminalCoordinationSession,
    permission_mode: &str,
) -> String {
    let mut tools = ["Read", "Glob", "Grep", "LS"]
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    if matches!(
        permission_mode,
        TERMINAL_PERMISSION_MODE_ACCEPT_EDITS
            | TERMINAL_PERMISSION_MODE_AUTO
            | TERMINAL_PERMISSION_MODE_FULL_ACCESS
    ) {
        let workspace_files = claude_workspace_permission_glob(coordination);
        tools.push(format!("Edit({workspace_files})"));
        tools.push(format!("Write({workspace_files})"));
        tools.push(format!("NotebookEdit({workspace_files})"));
    }
    tools.extend(
        crate::coordination::mcp::TOOL_NAMES
            .iter()
            .map(|tool| format!("mcp__coordination-kernel__{tool}")),
    );
    tools.extend(
        [
            "workspace_mcp__sync_manifest",
            "workspace_mcp__list_servers",
            "workspace_mcp__get_server_status",
            "workspace_mcp__get_server_config",
            "workspace_mcp__write_env_file",
            "secrets__list",
            "secrets__get",
            "secrets__write_env_file",
            "video_context",
            "video_edit",
            "video_transcribe",
            "video_look",
            "video_media",
            "video_generate",
            "video_export",
        ]
        .into_iter()
        .map(|tool| format!("mcp__workspace-mcp-gateway__{tool}")),
    );
    tools.extend(
        [
            "video_context",
            "video_edit",
            "video_transcribe",
            "video_look",
            "video_media",
            "video_generate",
            "video_export",
        ]
        .into_iter()
        .map(|tool| format!("mcp__diffforge-workspace-mcp-gateway__{tool}")),
    );
    if let Some(value) =
        terminal_coordination_env_value(coordination, "DIFFFORGE_WORKSPACE_MCP_ALLOWED_TOOLS")
    {
        tools.extend(
            value
                .split(',')
                .map(str::trim)
                .filter(|tool| !tool.is_empty())
                .map(|tool| format!("mcp__workspace-mcp-gateway__{tool}")),
        );
    }
    tools.join(",")
}

fn claude_write_authority_guard_settings(
    coordination: &TerminalCoordinationSession,
    permission_mode: &str,
    pane_id: &str,
    instance_id: u64,
    workspace_id: Option<&str>,
    terminal_index: Option<u16>,
    activity_transport: Option<&TerminalActivityTransportEndpoint>,
) -> String {
    let workspace_files = claude_workspace_permission_glob(coordination);
    let allowed_permissions = if matches!(
        permission_mode,
        TERMINAL_PERMISSION_MODE_ACCEPT_EDITS
            | TERMINAL_PERMISSION_MODE_AUTO
            | TERMINAL_PERMISSION_MODE_FULL_ACCESS
    ) {
        vec![
            format!("Edit({workspace_files})"),
            format!("Write({workspace_files})"),
            format!("NotebookEdit({workspace_files})"),
        ]
    } else {
        Vec::new()
    };
    let sandbox_write_roots = if permission_mode == TERMINAL_PERMISSION_MODE_PLAN {
        Vec::new()
    } else {
        vec![claude_workspace_permission_root(coordination)]
    };
    let activity_command = diff_forge_scoped_activity_hook_command(
        coordination,
        "claude",
        pane_id,
        instance_id,
        workspace_id,
        terminal_index,
        activity_transport,
    );
    let deny_rules: Vec<String> = Vec::new();

    let mut settings = json!({
        "disableBypassPermissionsMode": if permission_mode == TERMINAL_PERMISSION_MODE_BYPASS { "allow" } else { "disable" },
        "permissions": {
            "defaultMode": claude_permission_mode_arg(permission_mode),
            "allow": allowed_permissions,
            "deny": deny_rules
        },
        "hooks": {
            "SessionStart": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 5
                        }
                    ]
                }
            ],
            "UserPromptSubmit": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 5
                        }
                    ]
                }
            ],
            "MessageDisplay": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 5
                        }
                    ]
                }
            ],
            "PreCompact": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 5
                        }
                    ]
                }
            ],
            "PostCompact": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 5
                        }
                    ]
                }
            ],
            "Stop": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 5
                        }
                    ]
                }
            ],
            "StopFailure": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 5
                        }
                    ]
                }
            ],
            "PreToolUse": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 600
                        }
                    ]
                }
            ],
            "PostToolUse": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 5
                        }
                    ]
                }
            ],
            "PostToolUseFailure": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 5
                        }
                    ]
                }
            ],
            "PostToolBatch": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 5
                        }
                    ]
                }
            ],
            "PermissionRequest": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 600
                        }
                    ]
                }
            ],
            "PermissionDenied": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 600
                        }
                    ]
                }
            ],
            "Notification": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 5
                        }
                    ]
                }
            ],
            "Elicitation": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 600
                        }
                    ]
                }
            ],
            "ElicitationResult": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 5
                        }
                    ]
                }
            ],
            "SubagentStart": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 5
                        }
                    ]
                }
            ],
            "SubagentStop": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": activity_command.clone(),
                            "timeout": 5
                        }
                    ]
                }
            ]
        }
    });

    // Keep the managed profile aligned with Claude Code's complete hook
    // surface. Most of these are observational lifecycle events. WorktreeCreate
    // is intentionally not installed here: Claude defines it as an exclusive
    // worktree provider that must return an absolute path, not an observation.
    if let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) {
        for event_name in [
            "UserPromptExpansion",
            "TaskCreated",
            "TaskCompleted",
            "TeammateIdle",
            "SessionEnd",
            "ConfigChange",
            "CwdChanged",
            "InstructionsLoaded",
            "FileChanged",
            "WorktreeRemove",
            "Setup",
        ] {
            hooks.entry(event_name.to_string()).or_insert_with(|| {
                let mut group = json!({
                    "hooks": [{
                        "type": "command",
                        "command": activity_command.clone(),
                        "timeout": 5
                    }]
                });
                if event_name == "FileChanged" {
                    // Claude's FileChanged matcher is also its literal watch
                    // list. Watch the portable project/config files Diff
                    // Forge can know ahead of time; provider/project settings
                    // may add more literal names alongside this group.
                    group["matcher"] = json!(
                        ".env|.envrc|.tool-versions|AGENTS.md|CLAUDE.md|Cargo.toml|package.json|pyproject.toml|requirements.txt"
                    );
                }
                json!([group])
            });
        }
    }

    if !cfg!(windows) {
        settings["sandbox"] = json!({
            "enabled": true,
            "failIfUnavailable": true,
            "allowUnsandboxedCommands": true,
            "filesystem": {
                "allowWrite": sandbox_write_roots
            }
        });
    }

    settings.to_string()
}

fn diff_forge_scoped_activity_hook_command(
    coordination: &TerminalCoordinationSession,
    provider: &str,
    pane_id: &str,
    instance_id: u64,
    workspace_id: Option<&str>,
    terminal_index: Option<u16>,
    activity_transport: Option<&TerminalActivityTransportEndpoint>,
) -> String {
    let command_path = coordination.mcp_command.as_str();
    let events_path = terminal_activity_events_path(pane_id, instance_id);
    let debug_path = terminal_activity_debug_path(pane_id, instance_id);
    let instance_id = instance_id.to_string();
    let terminal_index = terminal_index
        .map(|index| index.to_string())
        .unwrap_or_default();
    let workspace_id = workspace_id.unwrap_or_default();
    let events_path = events_path.to_string_lossy().to_string();
    let debug_path = debug_path.to_string_lossy().to_string();
    let transport_args: Vec<(&'static str, String)> = activity_transport
        .map(|endpoint| {
            vec![
                ("--transport-host", endpoint.host.clone()),
                ("--transport-port", endpoint.port.to_string()),
                ("--transport-token", endpoint.token.clone()),
            ]
        })
        .unwrap_or_default();

    #[cfg(windows)]
    {
        let mut command = format!(
            "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"& {} --diff-forge-activity-hook --provider {} --pane-id {} --instance-id {} --workspace-id {} --terminal-index {} --events-path {} --debug-path {}",
            quote_powershell_literal(command_path),
            quote_powershell_literal(provider),
            quote_powershell_literal(pane_id),
            quote_powershell_literal(&instance_id),
            quote_powershell_literal(workspace_id),
            quote_powershell_literal(&terminal_index),
            quote_powershell_literal(&events_path),
            quote_powershell_literal(&debug_path),
        );
        for (key, value) in transport_args {
            command.push(' ');
            command.push_str(key);
            command.push(' ');
            command.push_str(&quote_powershell_literal(&value));
        }
        command.push('"');
        command
    }

    #[cfg(not(windows))]
    {
        let mut command = format!(
            "{} --diff-forge-activity-hook --provider {} --pane-id {} --instance-id {} --workspace-id {} --terminal-index {} --events-path {} --debug-path {}",
            quote_shell_literal(command_path),
            quote_shell_literal(provider),
            quote_shell_literal(pane_id),
            quote_shell_literal(&instance_id),
            quote_shell_literal(workspace_id),
            quote_shell_literal(&terminal_index),
            quote_shell_literal(&events_path),
            quote_shell_literal(&debug_path),
        );
        for (key, value) in transport_args {
            command.push(' ');
            command.push_str(key);
            command.push(' ');
            command.push_str(&quote_shell_literal(&value));
        }
        command
    }
}

fn terminal_activity_events_path(pane_id: &str, instance_id: u64) -> PathBuf {
    let safe_pane_id = pane_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    env::temp_dir()
        .join("diffforge-terminal-activity")
        .join(format!("{safe_pane_id}-{instance_id}.jsonl"))
}

fn terminal_activity_debug_path(pane_id: &str, instance_id: u64) -> PathBuf {
    let mut path = terminal_activity_events_path(pane_id, instance_id);
    path.set_extension("debug.jsonl");
    path
}

fn terminal_activity_env_vars(
    pane_id: &str,
    instance_id: u64,
    workspace_id: Option<&str>,
    terminal_index: Option<u16>,
    provider_id: &str,
    activity_transport: Option<&TerminalActivityTransportEndpoint>,
) -> Vec<(String, String)> {
    let activity_path = terminal_activity_events_path(pane_id, instance_id);
    let mut env_vars = vec![
        (
            "DIFFFORGE_TERMINAL_PANE_ID".to_string(),
            pane_id.to_string(),
        ),
        (
            "DIFFFORGE_TERMINAL_INSTANCE_ID".to_string(),
            instance_id.to_string(),
        ),
        (
            "DIFFFORGE_TERMINAL_WORKSPACE_ID".to_string(),
            workspace_id.unwrap_or_default().to_string(),
        ),
        (
            "DIFFFORGE_TERMINAL_INDEX".to_string(),
            terminal_index
                .map(|index| index.to_string())
                .unwrap_or_default(),
        ),
        (
            "DIFFFORGE_TERMINAL_PROVIDER".to_string(),
            provider_id.to_string(),
        ),
        (
            "DIFFFORGE_ACTIVITY_EVENTS_PATH".to_string(),
            activity_path.to_string_lossy().to_string(),
        ),
        (
            "DIFFFORGE_ACTIVITY_DEBUG_PATH".to_string(),
            terminal_activity_debug_path(pane_id, instance_id)
                .to_string_lossy()
                .to_string(),
        ),
    ];
    if let Some(endpoint) = activity_transport {
        env_vars.extend([
            (
                "DIFFFORGE_ACTIVITY_TRANSPORT_HOST".to_string(),
                endpoint.host.clone(),
            ),
            (
                "DIFFFORGE_ACTIVITY_TRANSPORT_PORT".to_string(),
                endpoint.port.to_string(),
            ),
            (
                "DIFFFORGE_ACTIVITY_TRANSPORT_TOKEN".to_string(),
                endpoint.token.clone(),
            ),
        ]);
    }
    env_vars
}

fn extend_terminal_activity_env_vars(
    env_vars: &mut Vec<(String, String)>,
    workspace_root: Option<&Path>,
    pane_id: &str,
    instance_id: u64,
    workspace_id: Option<&str>,
    terminal_index: Option<u16>,
    provider_id: &str,
    activity_transport: Option<&TerminalActivityTransportEndpoint>,
) {
    if let Some(workspace_root) = workspace_root {
        set_terminal_env_var(
            env_vars,
            "DIFFFORGE_WORKSPACE_ROOT",
            &workspace_root.to_string_lossy(),
        );
    }
    let activity_env = terminal_activity_env_vars(
        pane_id,
        instance_id,
        workspace_id,
        terminal_index,
        provider_id,
        activity_transport,
    );
    for (key, value) in activity_env {
        env_vars.retain(|(existing_key, _)| existing_key != &key);
        env_vars.push((key, value));
    }
    // Account profile binding: stamps the pane with the active agent account
    // and injects CLAUDE_CONFIG_DIR / CODEX_HOME for non-default profiles.
    // Every agent spawn and relaunch path funnels through here, so switching
    // accounts applies to the next spawn without an app restart.
    agent_accounts_apply_spawn_env(
        env_vars,
        pane_id,
        provider_id,
        workspace_id,
        None,
        terminal_index,
    );
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

fn terminal_workspace_gateway_environment(
    coordination: Option<&TerminalCoordinationSession>,
) -> serde_json::Map<String, Value> {
    let mut environment = serde_json::Map::new();
    environment.insert("COORDINATION_ENABLED".to_string(), json!("1"));
    environment.insert("DIFFFORGE_WORKSPACE_MCP_GATEWAY".to_string(), json!("1"));
    if let Some(coordination) = coordination {
        environment.insert(
            "COORDINATION_REPO_PATH".to_string(),
            json!(coordination.repo_path.clone()),
        );
        environment.insert(
            "COORDINATION_DB_PATH".to_string(),
            json!(coordination.db_path.clone()),
        );
        environment.insert(
            "COORDINATION_AGENT_ID".to_string(),
            json!(coordination.agent_id.clone()),
        );
        environment.insert(
            "COORDINATION_SESSION_ID".to_string(),
            json!(coordination.session_id.clone()),
        );
        environment.insert(
            "COORDINATION_TERMINAL_LAUNCH_EPOCH".to_string(),
            json!(coordination
                .terminal_launch_epoch
                .clone()
                .unwrap_or_default()),
        );
        for key in [
            "COORDINATION_AGENT_SLOT_ID",
            "COORDINATION_SLOT_KEY",
            "COORDINATION_WORKSPACE_ID",
            "COORDINATION_OBJECTIVE_KEY",
        ] {
            if let Some(value) = terminal_coordination_env_value(coordination, key) {
                environment.insert(key.to_string(), json!(value));
            }
        }
    }
    for (key, value) in terminal_app_bridge_env_vars() {
        environment.insert(key, json!(value));
    }
    environment
}

fn apply_codex_resume_home_env(
    env_vars: &mut Vec<(String, String)>,
    source_home: &str,
    provider_session_id: &str,
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
    if let Some(managed_home) = managed_home {
        materialize_codex_rollout_in_managed_home(
            provider_session_id,
            Path::new(source_home),
            Path::new(&managed_home),
        )?;
        // Resume/fork may originate in a global home or another coordinated
        // slot. The new pane's managed home remains authoritative so its MCP
        // identity and permission roots cannot be inherited from the source.
        set_terminal_env_var(env_vars, "CODEX_HOME", &managed_home);
        set_terminal_env_var(env_vars, "DIFFFORGE_CODEX_HOME", &managed_home);
        return Ok(());
    }
    set_terminal_env_var(env_vars, "CODEX_HOME", source_home);
    set_terminal_env_var(env_vars, "DIFFFORGE_CODEX_HOME", source_home);
    Ok(())
}

fn refresh_codex_activity_hook_profile_for_terminal(
    coordination: Option<&TerminalCoordinationSession>,
    provider_id: &str,
    pane_id: &str,
    instance_id: u64,
    workspace_id: Option<&str>,
    terminal_index: Option<u16>,
) -> Result<bool, String> {
    if !provider_id.to_ascii_lowercase().contains("codex") {
        return Ok(false);
    }
    let Some(coordination) = coordination else {
        return Ok(false);
    };
    let Some(profile) = terminal_coordination_env_value(coordination, "DIFFFORGE_CODEX_PROFILE")
    else {
        return Err(
            "Managed Codex launch is missing DIFFFORGE_CODEX_PROFILE for hook trust.".to_string(),
        );
    };
    let Some(home) = terminal_coordination_env_value(coordination, "DIFFFORGE_CODEX_HOME")
        .or_else(|| terminal_coordination_env_value(coordination, "CODEX_HOME"))
    else {
        return Err("Managed Codex launch is missing CODEX_HOME for hook trust.".to_string());
    };

    let profile_path = PathBuf::from(&home).join(format!("{profile}.config.toml"));
    // Codex (verified on 0.142) loads command hooks ONLY from
    // `$CODEX_HOME/hooks.json`; a `hooksPath` key or inline `[[hooks.*]]`
    // blocks in a `--profile <name>.config.toml` layer are ignored, so the
    // activity hooks must live in the home-level file or they never run.
    // Diff Forge codex homes are per-slot, so pane-scoped commands are safe
    // there; the last launch for a shared home owns the hook commands.
    let hooks_path = PathBuf::from(&home).join("hooks.json");
    let body = match fs::read_to_string(&hooks_path) {
        Ok(body) => Some(body),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "Unable to read Codex hooks config {}: {error}",
                hooks_path.display()
            ));
        }
    };
    let mut hooks_json: Value = if let Some(body) = body {
        serde_json::from_str(&body).map_err(|error| {
            format!(
                "Unable to parse Codex hooks config {}: {error}",
                hooks_path.display()
            )
        })?
    } else {
        json!({ "hooks": {} })
    };
    let scoped_command = diff_forge_scoped_activity_hook_command(
        coordination,
        "codex",
        pane_id,
        instance_id,
        workspace_id,
        terminal_index,
        None,
    );
    let removed_write_guards = remove_codex_write_guard_hooks_from_json(&mut hooks_json);
    let replaced = replace_activity_hook_commands_in_json(&mut hooks_json, scoped_command.as_str());
    let added = ensure_codex_activity_hooks(&mut hooks_json, scoped_command.as_str());
    let mut updated = removed_write_guards > 0 || replaced > 0 || added > 0;
    if !json_file_matches_local(&hooks_path, &hooks_json) {
        if let Some(parent) = hooks_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Unable to create Codex hooks config directory {}: {error}",
                    parent.display()
                )
            })?;
        }
        let body = serde_json::to_vec_pretty(&hooks_json).map_err(|error| {
            format!(
                "Unable to serialize Codex hooks config {}: {error}",
                hooks_path.display()
            )
        })?;
        fs::write(&hooks_path, body).map_err(|error| {
            format!(
                "Unable to write Codex hooks config {}: {error}",
                hooks_path.display()
            )
        })?;
        updated = true;
    }
    // Current Codex counts profile-inline copies in addition to the canonical
    // home-level hooks.json catalog, while standalone app-server hooks/list
    // intentionally has no runtime --profile support.  Remove only the inline
    // blocks generated by Diff Forge after the canonical file is safely
    // written so the native TUI and deterministic discovery see one catalog.
    if strip_codex_profile_managed_inline_hooks(&profile_path)? {
        updated = true;
    }
    // Codex 0.144 persists hook trust in the user config layer as an exact
    // per-handler key/hash pair.  The pane app-server reads config.toml while
    // the interactive CLI also layers the active profile on top, so both
    // files must contain the freshly computed hashes before either process is
    // spawned.  Trust only Diff Forge's own activity-hook handlers; unrelated
    // user/project hooks keep Codex's native review gate.
    let base_config_path = PathBuf::from(&home).join("config.toml");
    if persist_codex_managed_activity_hook_trust(
        &[base_config_path.as_path(), profile_path.as_path()],
        &hooks_path,
        &hooks_json,
    )? {
        updated = true;
    }
    Ok(updated)
}

fn codex_hook_event_trust_identity(event_name: &str) -> Option<(&'static str, bool)> {
    match event_name {
        "PreToolUse" => Some(("pre_tool_use", true)),
        "PermissionRequest" => Some(("permission_request", true)),
        "PostToolUse" => Some(("post_tool_use", true)),
        "PreCompact" => Some(("pre_compact", true)),
        "PostCompact" => Some(("post_compact", true)),
        "SessionStart" => Some(("session_start", true)),
        "UserPromptSubmit" => Some(("user_prompt_submit", false)),
        "SubagentStart" => Some(("subagent_start", true)),
        "SubagentStop" => Some(("subagent_stop", true)),
        "Stop" => Some(("stop", false)),
        _ => None,
    }
}

fn codex_hook_platform_command(handler: &serde_json::Map<String, Value>) -> Option<String> {
    #[cfg(windows)]
    let command = handler
        .get("commandWindows")
        .or_else(|| handler.get("command_windows"))
        .or_else(|| handler.get("command"));
    #[cfg(not(windows))]
    let command = handler.get("command");

    command.and_then(Value::as_str).map(ToString::to_string)
}

fn codex_hook_normalized_hash(
    event_label: &str,
    matcher: Option<&str>,
    handler: &serde_json::Map<String, Value>,
) -> Result<String, String> {
    let command = codex_hook_platform_command(handler)
        .ok_or_else(|| "Codex command hook is missing its platform command.".to_string())?;
    let timeout = match handler.get("timeout") {
        Some(value) => value
            .as_u64()
            .ok_or_else(|| "Codex command hook timeout must be an unsigned integer.".to_string())?,
        None => 600,
    }
    .max(1);
    let is_async = match handler.get("async") {
        Some(value) => value
            .as_bool()
            .ok_or_else(|| "Codex command hook async must be a boolean.".to_string())?,
        None => false,
    };

    let mut normalized_handler = serde_json::Map::new();
    normalized_handler.insert("type".to_string(), json!("command"));
    normalized_handler.insert("command".to_string(), json!(command));
    normalized_handler.insert("timeout".to_string(), json!(timeout));
    normalized_handler.insert("async".to_string(), json!(is_async));
    if let Some(status_message) = handler.get("statusMessage") {
        let status_message = status_message.as_str().ok_or_else(|| {
            "Codex command hook statusMessage must be a string when present.".to_string()
        })?;
        normalized_handler.insert("statusMessage".to_string(), json!(status_message));
    }

    let mut identity = serde_json::Map::new();
    identity.insert("event_name".to_string(), json!(event_label));
    if let Some(matcher) = matcher {
        identity.insert("matcher".to_string(), json!(matcher));
    }
    // Codex hashes each handler separately even when multiple handlers share
    // one matcher group.  This is what lets Diff Forge trust only its own
    // command without implicitly trusting a neighboring user hook.
    identity.insert(
        "hooks".to_string(),
        Value::Array(vec![Value::Object(normalized_handler)]),
    );
    Ok(format!(
        "sha256:{}",
        diff_forge_activity_hook_canonical_sha256(&Value::Object(identity))
    ))
}

fn codex_managed_activity_hook_trust_records(
    hooks_path: &Path,
    hooks_json: &Value,
) -> Result<Vec<(String, String)>, String> {
    let hooks = hooks_json
        .get("hooks")
        .and_then(Value::as_object)
        .ok_or_else(|| "Codex hooks config must contain a hooks object.".to_string())?;
    // Discovery canonicalizes the source file before constructing the trust
    // key. Match that exactly: on macOS `/var/...` becomes `/private/var/...`,
    // and keeping the lexical launch path would leave an otherwise correct
    // hash untrusted. The hooks file has already been materialized above.
    let key_source = fs::canonicalize(hooks_path).map_err(|error| {
        format!(
            "Unable to canonicalize Codex hooks config {} for trust: {error}",
            hooks_path.display()
        )
    })?;
    let key_source = key_source.to_string_lossy();
    let mut records = Vec::new();

    for (event_name, groups) in hooks {
        let Some((event_label, matcher_supported)) =
            codex_hook_event_trust_identity(event_name.as_str())
        else {
            continue;
        };
        let groups = groups.as_array().ok_or_else(|| {
            format!("Codex {event_name} hooks config must contain an array of matcher groups.")
        })?;
        for (group_index, group) in groups.iter().enumerate() {
            let group = group.as_object().ok_or_else(|| {
                format!("Codex {event_name} matcher group {group_index} must be an object.")
            })?;
            let matcher = if matcher_supported {
                match group.get("matcher") {
                    Some(value) => Some(value.as_str().ok_or_else(|| {
                        format!(
                            "Codex {event_name} matcher group {group_index} matcher must be a string."
                        )
                    })?),
                    None => None,
                }
            } else {
                None
            };
            let handlers = group
                .get("hooks")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    format!(
                        "Codex {event_name} matcher group {group_index} must contain a hooks array."
                    )
                })?;
            for (handler_index, handler) in handlers.iter().enumerate() {
                let Some(handler) = handler.as_object() else {
                    continue;
                };
                if handler.get("type").and_then(Value::as_str) != Some("command") {
                    continue;
                }
                let declared_command = handler
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let windows_command = handler
                    .get("commandWindows")
                    .or_else(|| handler.get("command_windows"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !declared_command.contains("--diff-forge-activity-hook")
                    && !windows_command.contains("--diff-forge-activity-hook")
                {
                    continue;
                }
                if handler.get("async").and_then(Value::as_bool) == Some(true) {
                    return Err(format!(
                        "Diff Forge Codex activity hook {event_name}:{group_index}:{handler_index} cannot be async."
                    ));
                }
                let current_hash = codex_hook_normalized_hash(event_label, matcher, handler)?;
                records.push((
                    format!("{key_source}:{event_label}:{group_index}:{handler_index}"),
                    current_hash,
                ));
            }
        }
    }

    if records.is_empty() {
        return Err(
            "Codex hooks config contains no Diff Forge activity hooks to trust.".to_string(),
        );
    }
    Ok(records)
}

fn codex_config_with_managed_hook_trust(
    path: &Path,
    records: &[(String, String)],
) -> Result<Option<Vec<u8>>, String> {
    let body = match fs::read_to_string(path) {
        Ok(body) => body,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(format!(
                "Unable to read Codex hook-trust config {}: {error}",
                path.display()
            ));
        }
    };
    let mut config = if body.trim().is_empty() {
        toml::Value::Table(toml::map::Map::new())
    } else {
        toml::from_str::<toml::Value>(&body).map_err(|error| {
            format!(
                "Unable to parse Codex hook-trust config {}: {error}",
                path.display()
            )
        })?
    };
    let root = config.as_table_mut().ok_or_else(|| {
        format!(
            "Codex hook-trust config {} must contain a TOML table.",
            path.display()
        )
    })?;
    let hooks = root
        .entry("hooks".to_string())
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()))
        .as_table_mut()
        .ok_or_else(|| {
            format!(
                "Codex hook-trust config {} has an invalid hooks value.",
                path.display()
            )
        })?;
    let state = hooks
        .entry("state".to_string())
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()))
        .as_table_mut()
        .ok_or_else(|| {
            format!(
                "Codex hook-trust config {} has an invalid hooks.state value.",
                path.display()
            )
        })?;
    let mut changed = false;
    for (key, current_hash) in records {
        let entry = state
            .entry(key.clone())
            .or_insert_with(|| toml::Value::Table(toml::map::Map::new()))
            .as_table_mut()
            .ok_or_else(|| {
                format!(
                    "Codex hook-trust config {} has invalid state for {key}.",
                    path.display()
                )
            })?;
        if entry.get("trusted_hash").and_then(toml::Value::as_str) != Some(current_hash.as_str()) {
            entry.insert(
                "trusted_hash".to_string(),
                toml::Value::String(current_hash.clone()),
            );
            changed = true;
        }
        // A previously reviewed handler can still be explicitly disabled in
        // the same state entry. Diff Forge owns these exact commands and
        // requires them for UIR/push settlement, so make the managed handler
        // active as well as trusted. This does not touch neighboring hooks.
        if entry.get("enabled").and_then(toml::Value::as_bool) != Some(true) {
            entry.insert("enabled".to_string(), toml::Value::Boolean(true));
            changed = true;
        }
    }
    if !changed {
        return Ok(None);
    }
    let mut body = toml::to_string_pretty(&config).map_err(|error| {
        format!(
            "Unable to serialize Codex hook-trust config {}: {error}",
            path.display()
        )
    })?;
    if !body.ends_with('\n') {
        body.push('\n');
    }
    Ok(Some(body.into_bytes()))
}

fn persist_codex_managed_activity_hook_trust(
    config_paths: &[&Path],
    hooks_path: &Path,
    hooks_json: &Value,
) -> Result<bool, String> {
    let records = codex_managed_activity_hook_trust_records(hooks_path, hooks_json)?;
    // Serialize the base/profile pair as one pre-launch critical section so
    // concurrent pane startup cannot preserve a stale profile override.
    let _guard = AGENT_ACCOUNTS_PRIVATE_FILE_WRITE_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let mut updates = Vec::new();
    for path in config_paths {
        if let Some(bytes) = codex_config_with_managed_hook_trust(path, &records)? {
            updates.push((path.to_path_buf(), bytes));
        }
    }
    for (path, bytes) in &updates {
        agent_accounts_write_private_file_atomic_unlocked(path, bytes, "Codex managed hook trust")?;
    }
    Ok(!updates.is_empty())
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

fn replace_activity_hook_commands_in_json(value: &mut Value, scoped_command: &str) -> usize {
    match value {
        Value::Object(object) => {
            let mut replaced = 0usize;
            for (key, value) in object.iter_mut() {
                if key == "command"
                    && value
                        .as_str()
                        .is_some_and(|command| command.contains("--diff-forge-activity-hook"))
                {
                    *value = Value::String(scoped_command.to_string());
                    replaced += 1;
                } else {
                    replaced += replace_activity_hook_commands_in_json(value, scoped_command);
                }
            }
            replaced
        }
        Value::Array(items) => items
            .iter_mut()
            .map(|item| replace_activity_hook_commands_in_json(item, scoped_command))
            .sum(),
        _ => 0,
    }
}

fn remove_codex_write_guard_hooks_from_json(value: &mut Value) -> usize {
    match value {
        Value::Object(object) => object
            .values_mut()
            .map(remove_codex_write_guard_hooks_from_json)
            .sum(),
        Value::Array(items) => {
            let before = items.len();
            items.retain(|item| !json_value_contains_write_guard_command(item));
            let removed = before.saturating_sub(items.len());
            removed
                + items
                    .iter_mut()
                    .map(remove_codex_write_guard_hooks_from_json)
                    .sum::<usize>()
        }
        _ => 0,
    }
}

fn json_value_contains_write_guard_command(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            (key == "command"
                && value
                    .as_str()
                    .is_some_and(|command| command.contains("--diff-forge-write-guard")))
                || json_value_contains_write_guard_command(value)
        }),
        Value::Array(items) => items.iter().any(json_value_contains_write_guard_command),
        _ => false,
    }
}

fn ensure_codex_activity_hooks(value: &mut Value, scoped_command: &str) -> usize {
    let Some(root) = value.as_object_mut() else {
        return 0;
    };
    let hooks = root.entry("hooks").or_insert_with(|| json!({}));
    let Some(hooks) = hooks.as_object_mut() else {
        return 0;
    };

    const OFFICIAL_CODEX_HOOKS: &[&str] = &[
        "SessionStart",
        "UserPromptSubmit",
        "PreCompact",
        "PostCompact",
        "Stop",
        "PreToolUse",
        "PostToolUse",
        "PermissionRequest",
        "SubagentStart",
        "SubagentStop",
    ];
    // Codex ignores unknown hook names, but leaving Diff Forge registrations
    // under Claude-only names creates a false sense of coverage. Remove only
    // our generated entries and preserve every user-authored hook.
    let unsupported_keys = hooks
        .keys()
        .filter(|name| !OFFICIAL_CODEX_HOOKS.contains(&name.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    for key in unsupported_keys {
        if let Some(entries) = hooks.get_mut(&key).and_then(Value::as_array_mut) {
            entries.retain(|entry| !hook_entry_contains_activity_command(entry));
        }
        if hooks
            .get(&key)
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
        {
            hooks.remove(&key);
        }
    }

    let mut added = 0usize;
    for event_name in OFFICIAL_CODEX_HOOKS {
        let entry = hooks
            .entry((*event_name).to_string())
            .or_insert_with(|| Value::Array(Vec::new()));
        let Some(entries) = entry.as_array_mut() else {
            continue;
        };
        let has_activity_hook = entries
            .iter()
            .any(|entry| hook_entry_contains_activity_command(entry));
        if !has_activity_hook {
            entries.push(json!({
                "hooks": [
                    {
                        "type": "command",
                        "command": scoped_command,
                        "timeout": if *event_name == "PermissionRequest" { 120 } else { 5 }
                    }
                ]
            }));
            added += 1;
        }
    }

    added
}

fn strip_codex_profile_managed_inline_hooks(profile_path: &Path) -> Result<bool, String> {
    let body = match fs::read_to_string(profile_path) {
        Ok(body) => body,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "Unable to read Codex profile config {}: {error}",
                profile_path.display()
            ));
        }
    };
    let next = strip_codex_profile_managed_inline_hook_events(&body);
    if next == body {
        return Ok(false);
    }
    if let Some(parent) = profile_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Unable to create Codex profile config directory {}: {error}",
                parent.display()
            )
        })?;
    }
    fs::write(profile_path, next).map_err(|error| {
        format!(
            "Unable to write Codex profile config {}: {error}",
            profile_path.display()
        )
    })?;
    Ok(true)
}

fn strip_codex_profile_managed_inline_hook_events(body: &str) -> String {
    let lines = body.lines().collect::<Vec<_>>();
    let mut next = Vec::new();
    let mut index = 0usize;
    while index < lines.len() {
        if let Some(section) = terminal_toml_section_header_name(lines[index]) {
            if codex_toml_section_is_inline_hook_event_root(&section) {
                let start = index;
                index += 1;
                while index < lines.len() {
                    let Some(next_section) = terminal_toml_section_header_name(lines[index]) else {
                        index += 1;
                        continue;
                    };
                    if codex_toml_section_is_inline_hook_event_root(&next_section)
                        || !codex_toml_section_is_inline_hook_event(&next_section)
                    {
                        break;
                    }
                    index += 1;
                }
                let block = &lines[start..index];
                let nested_hook_section = format!("{section}.hooks");
                let mut retained_block = Vec::new();
                let mut block_index = 0usize;
                let mut removed_managed_hook = false;
                let mut retained_hook = false;
                while block_index < block.len() {
                    let is_nested_hook = terminal_toml_section_header_name(block[block_index])
                        .is_some_and(|name| name == nested_hook_section);
                    if !is_nested_hook {
                        retained_block.push(block[block_index]);
                        block_index += 1;
                        continue;
                    }

                    let hook_start = block_index;
                    block_index += 1;
                    while block_index < block.len()
                        && terminal_toml_section_header_name(block[block_index]).is_none()
                    {
                        block_index += 1;
                    }
                    let hook_block = &block[hook_start..block_index];
                    if codex_profile_inline_hook_block_is_diff_forge_managed(hook_block) {
                        removed_managed_hook = true;
                    } else {
                        retained_hook = true;
                        retained_block.extend_from_slice(hook_block);
                    }
                }

                if !removed_managed_hook {
                    next.extend_from_slice(block);
                } else if retained_hook
                    || retained_block.iter().any(|line| {
                        let trimmed = line.trim_start();
                        trimmed
                            .strip_prefix("hooks")
                            .is_some_and(|rest| rest.trim_start().starts_with('='))
                    })
                {
                    next.extend(retained_block);
                }
                continue;
            }
        }
        next.push(lines[index]);
        index += 1;
    }
    let mut body = next.join("\n");
    if !body.trim().is_empty() && !body.ends_with('\n') {
        body.push('\n');
    }
    body
}

fn codex_profile_inline_hook_block_is_diff_forge_managed(lines: &[&str]) -> bool {
    lines.iter().any(|line| {
        let trimmed = line.trim_start();
        let Some(rest) = trimmed.strip_prefix("command") else {
            return false;
        };
        let Some(value) = rest.trim_start().strip_prefix('=') else {
            return false;
        };
        terminal_toml_string_literal_value(value)
            .is_some_and(|command| command.contains("--diff-forge-activity-hook"))
    })
}

fn codex_toml_section_is_inline_hook_event_root(section: &str) -> bool {
    let Some(event_name) = section.strip_prefix("hooks.") else {
        return false;
    };
    !event_name.is_empty() && !event_name.contains('.') && event_name != "state"
}

fn terminal_toml_section_header_name(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.starts_with("[[") && trimmed.ends_with("]]") && trimmed.len() >= 4 {
        let section = &trimmed[2..trimmed.len().saturating_sub(2)];
        return (!section.trim().is_empty()).then(|| section.trim().to_string());
    }
    if trimmed.starts_with('[') && trimmed.ends_with(']') && trimmed.len() >= 2 {
        let section = &trimmed[1..trimmed.len().saturating_sub(1)];
        return (!section.trim().is_empty()).then(|| section.trim().to_string());
    }
    None
}

fn codex_toml_section_is_inline_hook_event(section: &str) -> bool {
    (section == "hooks" || section.starts_with("hooks."))
        && section != "hooks.state"
        && !section.starts_with("hooks.state.")
}

fn hook_entry_contains_activity_command(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            key == "command"
                && value
                    .as_str()
                    .is_some_and(|command| command.contains("--diff-forge-activity-hook"))
                || hook_entry_contains_activity_command(value)
        }),
        Value::Array(items) => items.iter().any(hook_entry_contains_activity_command),
        _ => false,
    }
}

fn json_file_matches_local(path: &Path, value: &Value) -> bool {
    let Ok(expected) = serde_json::to_vec_pretty(value) else {
        return false;
    };
    fs::read(path).is_ok_and(|current| current == expected)
}

pub fn run_diff_forge_activity_hook(args: &[String]) -> i32 {
    let provider = terminal_cli_arg_or_env(
        args,
        "--provider",
        &["DIFFFORGE_HOOK_PROVIDER", "DIFFFORGE_TERMINAL_PROVIDER"],
    )
    .unwrap_or_else(|| "unknown".to_string());
    let pane_id = terminal_cli_arg_or_env(args, "--pane-id", &["DIFFFORGE_TERMINAL_PANE_ID"])
        .unwrap_or_default();
    let instance_id =
        terminal_cli_arg_or_env(args, "--instance-id", &["DIFFFORGE_TERMINAL_INSTANCE_ID"])
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);
    let workspace_id = terminal_cli_arg_or_env(
        args,
        "--workspace-id",
        &[
            "DIFFFORGE_TERMINAL_WORKSPACE_ID",
            "COORDINATION_WORKSPACE_ID",
        ],
    )
    .unwrap_or_default();
    let terminal_index =
        terminal_cli_arg_or_env(args, "--terminal-index", &["DIFFFORGE_TERMINAL_INDEX"])
            .unwrap_or_default();
    let activity_path =
        terminal_cli_arg_or_env(args, "--events-path", &["DIFFFORGE_ACTIVITY_EVENTS_PATH"])
            .map(PathBuf::from)
            .unwrap_or_else(|| terminal_activity_events_path(&pane_id, instance_id));
    let debug_path =
        terminal_cli_arg_or_env(args, "--debug-path", &["DIFFFORGE_ACTIVITY_DEBUG_PATH"])
            .map(PathBuf::from)
            .unwrap_or_else(|| terminal_activity_debug_path(&pane_id, instance_id));
    let activity_transport = diff_forge_activity_hook_transport_config(args);

    if activity_transport.is_none() {
        write_diff_forge_activity_hook_debug(
            &debug_path,
            "started",
            &provider,
            &pane_id,
            instance_id,
            &workspace_id,
            &terminal_index,
            &activity_path,
            json!({
                "arg_count": args.len(),
                "has_events_path_arg": terminal_cli_arg_value(args, "--events-path").is_some(),
                "has_pane_id_arg": terminal_cli_arg_value(args, "--pane-id").is_some(),
                "has_instance_id_arg": terminal_cli_arg_value(args, "--instance-id").is_some(),
                "transport_configured": false,
            }),
        );
    }

    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        write_diff_forge_activity_hook_debug(
            &debug_path,
            "stdin_read_error",
            &provider,
            &pane_id,
            instance_id,
            &workspace_id,
            &terminal_index,
            &activity_path,
            Value::Null,
        );
        return 0;
    }
    let Ok(hook_input) = serde_json::from_str::<Value>(&input) else {
        write_diff_forge_activity_hook_debug(
            &debug_path,
            "json_parse_error",
            &provider,
            &pane_id,
            instance_id,
            &workspace_id,
            &terminal_index,
            &activity_path,
            json!({ "input_length": input.len() }),
        );
        return 0;
    };
    let record = diff_forge_activity_hook_record_with_persisted_claude_state(
        &provider,
        &pane_id,
        instance_id,
        &workspace_id,
        &terminal_index,
        &hook_input,
        &activity_path,
    );
    let codex_app_server_uir_active = provider.to_ascii_lowercase().contains("codex")
        && env::var("DIFFFORGE_CODEX_APP_SERVER_UIR")
            .ok()
            .is_some_and(|value| terminal_env_truthy(&value));
    let record_hook_key = record
        .get("hook_event_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    let record_tool_key = record
        .get("tool_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    if codex_app_server_uir_active
        && (record_hook_key == "permissionrequest"
            || (record_hook_key == "pretooluse"
                && matches!(
                    record_tool_key.as_str(),
                    "askuserquestion" | "requestuserinput" | "elicitation" | "mcpelicitation"
                )))
    {
        // The app-server gateway owns these blocking requests. Keep the
        // official Codex hook registered, but do not publish a second prompt
        // or block the hook process while the JSON-RPC request is active.
        write_diff_forge_activity_hook_debug(
            &debug_path,
            "app_server_uir_authoritative",
            &provider,
            &pane_id,
            instance_id,
            &workspace_id,
            &terminal_index,
            &activity_path,
            json!({
                "hook_event_name": record.get("hook_event_name").and_then(Value::as_str).unwrap_or_default(),
                "tool_name": record.get("tool_name").and_then(Value::as_str).unwrap_or_default(),
            }),
        );
        return 0;
    }
    if diff_forge_activity_stream_debug_enabled() {
        write_diff_forge_activity_hook_debug(
            &debug_path,
            "normalized_live_text",
            &provider,
            &pane_id,
            instance_id,
            &workspace_id,
            &terminal_index,
            &activity_path,
            json!({
                "hook_event_name": record.get("hook_event_name").and_then(Value::as_str).unwrap_or_default(),
                "raw_keys": diff_forge_activity_hook_object_keys(&hook_input),
                "assistant_delta": diff_forge_activity_hook_text_debug_summary(record.get("assistant_delta").and_then(Value::as_str)),
                "assistant_message": diff_forge_activity_hook_text_debug_summary(record.get("assistant_message").and_then(Value::as_str)),
                "assistant_message_snapshot": diff_forge_activity_hook_text_debug_summary(record.get("assistant_message_snapshot").and_then(Value::as_str)),
                "reasoning_delta": diff_forge_activity_hook_text_debug_summary(record.get("reasoning_delta").and_then(Value::as_str)),
                "reasoning_snapshot": diff_forge_activity_hook_text_debug_summary(record.get("reasoning_snapshot").and_then(Value::as_str)),
            }),
        );
    }
    let blocking_fallback = diff_forge_activity_hook_blocking_fallback_response(&record);
    if let Some(transport) = activity_transport.as_ref() {
        match send_diff_forge_activity_hook_transport(transport, &record) {
            Ok(hook_response) => {
                if let Some(hook_response) = hook_response {
                    if let Ok(response) = serde_json::to_string(&hook_response) {
                        println!("{response}");
                    }
                }
                return 0;
            }
            Err(error) => {
                let fallback_error_published = blocking_fallback.as_ref().is_some_and(|_| {
                    let failure_record =
                        diff_forge_activity_hook_transport_failure_record(&record, &error);
                    diff_forge_activity_hook_append_record(&activity_path, &failure_record).is_ok()
                });
                write_diff_forge_activity_hook_debug(
                    &debug_path,
                    if blocking_fallback.is_some() {
                        "blocking_transport_failed_closed"
                    } else {
                        "transport_fallback"
                    },
                    &provider,
                    &pane_id,
                    instance_id,
                    &workspace_id,
                    &terminal_index,
                    &activity_path,
                    json!({
                        "error": error,
                        "fallback_error_published": fallback_error_published,
                        "hook_event_name": record.get("hook_event_name").and_then(Value::as_str).unwrap_or_default(),
                    }),
                );
                if let Some(response) = blocking_fallback.as_ref() {
                    println!("{response}");
                    return 0;
                }
            }
        }
    }
    if let Some(response) = blocking_fallback {
        let failure_record = diff_forge_activity_hook_transport_failure_record(
            &record,
            "Authenticated activity transport is unavailable.",
        );
        let fallback_error_published =
            diff_forge_activity_hook_append_record(&activity_path, &failure_record).is_ok();
        write_diff_forge_activity_hook_debug(
            &debug_path,
            "blocking_transport_missing_failed_closed",
            &provider,
            &pane_id,
            instance_id,
            &workspace_id,
            &terminal_index,
            &activity_path,
            json!({
                "fallback_error_published": fallback_error_published,
                "hook_event_name": record.get("hook_event_name").and_then(Value::as_str).unwrap_or_default(),
            }),
        );
        println!("{response}");
        return 0;
    }
    if let Some(parent) = activity_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&activity_path)
    {
        let record_line = format!("{record}\n");
        match file.write_all(record_line.as_bytes()) {
            Ok(_) => write_diff_forge_activity_hook_debug(
                &debug_path,
                "event_written",
                &provider,
                &pane_id,
                instance_id,
                &workspace_id,
                &terminal_index,
                &activity_path,
                json!({
                    "hook_event_name": record.get("hook_event_name").and_then(Value::as_str).unwrap_or_default(),
                }),
            ),
            Err(error) => write_diff_forge_activity_hook_debug(
                &debug_path,
                "event_write_error",
                &provider,
                &pane_id,
                instance_id,
                &workspace_id,
                &terminal_index,
                &activity_path,
                json!({ "error": error.to_string() }),
            ),
        }
    } else {
        write_diff_forge_activity_hook_debug(
            &debug_path,
            "event_open_error",
            &provider,
            &pane_id,
            instance_id,
            &workspace_id,
            &terminal_index,
            &activity_path,
            Value::Null,
        );
    }

    0
}

fn diff_forge_activity_hook_transport_config(args: &[String]) -> Option<(String, u16, String)> {
    let host = terminal_cli_arg_or_env(
        args,
        "--transport-host",
        &["DIFFFORGE_ACTIVITY_TRANSPORT_HOST"],
    )?
    .trim()
    .to_string();
    if host.is_empty() {
        return None;
    }
    let port = terminal_cli_arg_or_env(
        args,
        "--transport-port",
        &["DIFFFORGE_ACTIVITY_TRANSPORT_PORT"],
    )?
    .trim()
    .parse::<u16>()
    .ok()
    .filter(|port| *port > 0)?;
    let token = terminal_cli_arg_or_env(
        args,
        "--transport-token",
        &["DIFFFORGE_ACTIVITY_TRANSPORT_TOKEN"],
    )?
    .trim()
    .to_string();
    if token.is_empty() {
        return None;
    }

    Some((host, port, token))
}

fn send_diff_forge_activity_hook_transport(
    transport: &(String, u16, String),
    record: &Value,
) -> Result<Option<Value>, String> {
    let (host, port, token) = transport;
    let address = (host.as_str(), *port)
        .to_socket_addrs()
        .map_err(|error| format!("Unable to resolve activity transport: {error}"))?
        .find(|address| address.ip().is_loopback())
        .ok_or_else(|| "Activity transport did not resolve to loopback.".to_string())?;
    let mut stream = std::net::TcpStream::connect_timeout(
        &address,
        Duration::from_millis(TERMINAL_ACTIVITY_TRANSPORT_CONNECT_TIMEOUT_MS),
    )
    .map_err(|error| format!("Unable to connect to activity transport: {error}"))?;
    let io_timeout = Some(Duration::from_millis(
        TERMINAL_ACTIVITY_TRANSPORT_IO_TIMEOUT_MS,
    ));
    let hook_name = record
        .get("hook_event_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let provider = record
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let tool_name = record
        .get("tool_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    let waits_for_structured_response = (provider.contains("claude")
        && (matches!(
            hook_name.as_str(),
            "permissionrequest" | "permissiondenied" | "elicitation"
        ) || (hook_name == "pretooluse"
            && matches!(tool_name.as_str(), "askuserquestion" | "exitplanmode"))))
        || (provider.contains("codex")
            && (hook_name == "permissionrequest"
                || (hook_name == "pretooluse"
                    && matches!(
                        tool_name.as_str(),
                        "askuserquestion" | "requestuserinput" | "elicitation" | "mcpelicitation"
                    ))))
        || (provider.contains("opencode")
            && matches!(
                hook_name.as_str(),
                "permissionrequest" | "userpromptrequired"
            ));
    let read_timeout = if waits_for_structured_response {
        Some(Duration::from_secs(if provider.contains("codex") {
            110
        } else {
            590
        }))
    } else {
        io_timeout
    };
    let _ = stream.set_write_timeout(io_timeout);
    let _ = stream.set_read_timeout(read_timeout);

    let envelope = json!({
        "type": "terminal-activity-hook",
        "token": token,
        "event": record,
    });
    let envelope_line = format!("{envelope}\n");
    stream
        .write_all(envelope_line.as_bytes())
        .map_err(|error| format!("Unable to send activity event: {error}"))?;
    let _ = stream.shutdown(std::net::Shutdown::Write);

    let mut response = Vec::new();
    let mut chunk = [0u8; 128];
    loop {
        let response_len = stream
            .read(&mut chunk)
            .map_err(|error| format!("Unable to read activity acknowledgement: {error}"))?;
        if response_len == 0 {
            break;
        }
        response.extend_from_slice(&chunk[..response_len]);
        if response.len() > 16 * 1024 {
            return Err("Activity acknowledgement is too large.".to_string());
        }
        if response.iter().any(|byte| *byte == b'\n') {
            break;
        }
    }
    if response.is_empty() {
        return Err("Activity transport closed without acknowledgement.".to_string());
    }
    let response_end = response
        .iter()
        .position(|byte| *byte == b'\n')
        .unwrap_or(response.len());
    let response_text = std::str::from_utf8(&response[..response_end])
        .map_err(|error| format!("Activity acknowledgement was not UTF-8: {error}"))?
        .trim();
    let response_value = serde_json::from_str::<Value>(response_text)
        .map_err(|error| format!("Unable to parse activity acknowledgement: {error}"))?;
    if response_value.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(response_value.get("hook_response").cloned())
    } else {
        Err(response_value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Activity transport rejected event.")
            .to_string())
    }
}

fn diff_forge_activity_hook_blocking_fallback_response(record: &Value) -> Option<Value> {
    let hook_name = record
        .get("hook_event_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let provider = record
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !provider.contains("claude") {
        return None;
    }
    match hook_name.as_str() {
        "permissionrequest" => Some(json!({
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": {
                    "behavior": "deny",
                    "message": "Diff Forge could not establish its authenticated UIR transport.",
                }
            }
        })),
        "elicitation" => Some(json!({
            "hookSpecificOutput": {
                "hookEventName": "Elicitation",
                "action": "cancel",
            }
        })),
        "permissiondenied" => Some(json!({
            "hookSpecificOutput": {
                "hookEventName": "PermissionDenied",
                "retry": false,
            }
        })),
        "pretooluse" => {
            let tool_name = record
                .get("tool_name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .chars()
                .filter(|value| value.is_ascii_alphanumeric())
                .collect::<String>()
                .to_ascii_lowercase();
            matches!(tool_name.as_str(), "askuserquestion" | "exitplanmode").then(|| {
                json!({
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": "Diff Forge could not establish its authenticated UIR transport."
                    }
                })
            })
        }
        _ => None,
    }
}

fn diff_forge_activity_hook_transport_failure_record(record: &Value, reason: &str) -> Value {
    let mut failure = record.as_object().cloned().unwrap_or_default();
    let original_hook_event_name = record
        .get("hook_event_name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let observed_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    failure.insert("hook_event_name".to_string(), json!("TurnError"));
    failure.insert(
        "original_hook_event_name".to_string(),
        json!(original_hook_event_name),
    );
    failure.insert(
        "provider_code".to_string(),
        json!("blocking_hook_transport_unavailable"),
    );
    failure.insert(
        "safe_message".to_string(),
        json!("Diff Forge could not establish its authenticated UIR transport."),
    );
    failure.insert("error".to_string(), json!(reason));
    failure.insert("retryable".to_string(), json!(true));
    failure.insert("provider_blocked_for_user".to_string(), json!(false));
    failure.insert("terminal_is_prompting_user".to_string(), json!(false));
    failure.insert("manual_approval_required".to_string(), json!(false));
    failure.insert(
        "completion_evidence".to_string(),
        json!("blocking_hook_transport_unavailable"),
    );
    failure.insert("timestamp_ms".to_string(), json!(observed_at_ms));
    Value::Object(failure)
}

fn diff_forge_activity_hook_append_record(path: &Path, record: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(format!("{record}\n").as_bytes())
        .map_err(|error| error.to_string())
}

fn write_diff_forge_activity_hook_debug(
    debug_path: &Path,
    phase: &str,
    provider: &str,
    pane_id: &str,
    instance_id: u64,
    workspace_id: &str,
    terminal_index: &str,
    activity_path: &Path,
    details: Value,
) {
    if let Some(parent) = debug_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let record = json!({
        "activity_path": activity_path.to_string_lossy(),
        "details": details,
        "instance_id": instance_id,
        "pane_id": pane_id,
        "phase": phase,
        "provider": provider,
        "terminal_index": terminal_index,
        "timestamp_ms": terminal_now_ms(),
        "workspace_id": workspace_id,
    });
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(debug_path)
    {
        let record_line = format!("{record}\n");
        let _ = file.write_all(record_line.as_bytes());
    }
}

fn diff_forge_activity_stream_debug_enabled() -> bool {
    cfg!(debug_assertions)
        && [
            "RUST_DIFFFORGE_AGENT_STREAM_DEBUG",
            "RUST_DIFFFORGE_USE_LOCAL_DOCKER_CLOUD",
        ]
        .iter()
        .any(|key| {
            env::var(key).ok().is_some_and(|value| {
                matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on" | "debug"
                )
            })
        })
}

fn diff_forge_activity_hook_object_keys(value: &Value) -> Vec<String> {
    let Some(object) = value.as_object() else {
        return Vec::new();
    };
    let mut keys = object.keys().cloned().collect::<Vec<_>>();
    keys.sort();
    keys.truncate(80);
    keys
}

fn diff_forge_activity_hook_text_debug_summary(value: Option<&str>) -> Value {
    let Some(value) = value else {
        return json!({ "present": false });
    };
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    json!({
        "present": true,
        "bytes": value.len(),
        "chars": value.chars().count(),
        "hash": format!("{:016x}", hasher.finish()),
    })
}

fn diff_forge_activity_hook_text_from_value(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        Value::Array(items) => {
            let text = items
                .iter()
                .filter_map(diff_forge_activity_hook_text_from_value)
                .collect::<Vec<_>>()
                .join("\n");
            (!text.trim().is_empty()).then(|| text)
        }
        Value::Object(object) => {
            for key in [
                "text",
                "content",
                "delta",
                "message",
                "assistantMessage",
                "assistant_message",
                "outputText",
                "output_text",
                "summary",
                "thinking",
                "reasoning",
            ] {
                if let Some(text) = object
                    .get(key)
                    .and_then(diff_forge_activity_hook_text_from_value)
                {
                    return Some(text);
                }
            }
            None
        }
        _ => None,
    }
}

fn diff_forge_activity_hook_lossless_text_from_value(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => (!value.is_empty()).then(|| value.to_string()),
        Value::Array(items) => {
            let text = items
                .iter()
                .filter_map(diff_forge_activity_hook_lossless_text_from_value)
                .collect::<Vec<_>>()
                .join("\n");
            (!text.is_empty()).then_some(text)
        }
        Value::Object(object) => {
            for key in [
                "text",
                "content",
                "delta",
                "message",
                "assistantMessage",
                "assistant_message",
                "assistantMessageSnapshot",
                "assistant_message_snapshot",
                "outputText",
                "output_text",
                "summary",
                "thinking",
                "reasoning",
            ] {
                if let Some(text) = object
                    .get(key)
                    .and_then(diff_forge_activity_hook_lossless_text_from_value)
                {
                    return Some(text);
                }
            }
            None
        }
        _ => None,
    }
}

fn diff_forge_architecture_graph_path_from_text(value: &str) -> String {
    let haystack = value.trim();
    if haystack.is_empty() {
        return String::new();
    }
    let lower = haystack.to_ascii_lowercase();
    let markers = [
        ".agents/architectures/graphs/",
        ".agents\\architectures\\graphs\\",
    ];
    let Some((marker_index, _marker)) = markers
        .iter()
        .find_map(|marker| lower.find(marker).map(|index| (index, *marker)))
    else {
        return String::new();
    };
    let is_boundary = |ch: char| {
        ch.is_whitespace()
            || matches!(
                ch,
                '"' | '\'' | '`' | '<' | '>' | '(' | ')' | '[' | ']' | '{' | '}' | '=' | ','
            )
    };
    let mut start = 0usize;
    for (index, ch) in haystack[..marker_index].char_indices() {
        if is_boundary(ch) {
            start = index + ch.len_utf8();
        }
    }
    let mut end = haystack.len();
    for (offset, ch) in haystack[marker_index..].char_indices() {
        if is_boundary(ch) {
            end = marker_index + offset;
            break;
        }
    }
    let path = haystack[start..end]
        .trim_matches(|ch: char| matches!(ch, ':' | ';'))
        .to_string();
    if path.to_ascii_lowercase().ends_with(".arch") {
        path
    } else {
        String::new()
    }
}

fn diff_forge_architecture_graph_path_from_value(value: &Value) -> String {
    match value {
        Value::String(text) => {
            if text.len() > 256_000 {
                let sample = text.chars().take(256_000).collect::<String>();
                diff_forge_architecture_graph_path_from_text(&sample)
            } else {
                diff_forge_architecture_graph_path_from_text(text)
            }
        }
        Value::Array(items) => items
            .iter()
            .map(diff_forge_architecture_graph_path_from_value)
            .find(|path| !path.is_empty())
            .unwrap_or_default(),
        Value::Object(object) => object
            .values()
            .map(diff_forge_architecture_graph_path_from_value)
            .find(|path| !path.is_empty())
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn diff_forge_plan_tool_key(tool_name: &str) -> String {
    tool_name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

fn diff_forge_plan_step_value(step: &Value, status_fallback: &str) -> Option<Value> {
    let title = step
        .as_str()
        .map(str::to_string)
        .or_else(|| {
            step.as_object().and_then(|object| {
                [
                    "content",
                    "step",
                    "title",
                    "text",
                    "name",
                    "summary",
                    "activeForm",
                    "active_form",
                ]
                .iter()
                .find_map(|key| object.get(*key).and_then(Value::as_str))
                .map(str::to_string)
            })
        })
        .map(|value| value.trim().chars().take(500).collect::<String>())
        .filter(|value| !value.is_empty())?;
    let status = step
        .as_object()
        .and_then(|object| {
            ["status", "state", "phase"]
                .iter()
                .find_map(|key| object.get(*key).and_then(Value::as_str))
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(status_fallback);
    Some(json!({ "title": title, "status": status }))
}

/// Native plan capture: providers maintain their own plan/todo lists through
/// built-in tools (Claude TodoWrite + ExitPlanMode, Codex update_plan,
/// OpenCode todowrite). When one of those tools fires, normalize the full
/// list into a compact planUpdate the app forwards into the Plans-tab store —
/// no agent-facing create_plan tool involved.
fn diff_forge_native_plan_update(tool_name: &str, tool_input: &Value, hook_input: &Value) -> Value {
    let tool_key = diff_forge_plan_tool_key(tool_name);
    let arguments = if tool_input.is_object() {
        tool_input
    } else {
        hook_input
            .get("arguments")
            .or_else(|| hook_input.get("toolArguments"))
            .or_else(|| hook_input.get("tool_arguments"))
            .unwrap_or(tool_input)
    };

    match tool_key.as_str() {
        "todowrite" => {
            let steps = arguments
                .get("todos")
                .or_else(|| arguments.get("items"))
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| diff_forge_plan_step_value(item, "pending"))
                        .take(120)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if steps.is_empty() {
                return Value::Null;
            }
            json!({ "tool": "todowrite", "steps": steps })
        }
        "updateplan" => {
            let steps = arguments
                .get("plan")
                .or_else(|| arguments.get("steps"))
                .or_else(|| arguments.get("items"))
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| diff_forge_plan_step_value(item, "pending"))
                        .take(120)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if steps.is_empty() {
                return Value::Null;
            }
            let explanation = arguments
                .get("explanation")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.chars().take(500).collect::<String>());
            json!({
                "tool": "update_plan",
                "steps": steps,
                "explanation": explanation,
            })
        }
        "exitplanmode" => {
            let plan_text = arguments
                .get("plan")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or_default();
            if plan_text.is_empty() {
                return Value::Null;
            }
            let title = plan_text
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .map(|line| {
                    line.trim_start_matches('#')
                        .trim()
                        .chars()
                        .take(160)
                        .collect::<String>()
                })
                .unwrap_or_default();
            let mut steps = plan_text
                .lines()
                .map(str::trim)
                .filter_map(|line| {
                    let unprefixed = line
                        .strip_prefix("- ")
                        .or_else(|| line.strip_prefix("* "))
                        .or_else(|| line.strip_prefix("+ "))
                        .or_else(|| {
                            line.split_once(". ")
                                .filter(|(ordinal, _)| {
                                    !ordinal.is_empty()
                                        && ordinal.chars().all(|value| value.is_ascii_digit())
                                })
                                .map(|(_, rest)| rest)
                        })?;
                    let completed =
                        unprefixed.starts_with("[x] ") || unprefixed.starts_with("[X] ");
                    let step_title = unprefixed
                        .trim_start_matches("[ ] ")
                        .trim_start_matches("[x] ")
                        .trim_start_matches("[X] ")
                        .trim();
                    if step_title.is_empty() {
                        return None;
                    }
                    Some(json!({
                        "title": step_title.chars().take(500).collect::<String>(),
                        "status": if completed { "completed" } else { "pending" },
                    }))
                })
                .take(120)
                .collect::<Vec<_>>();
            if steps.is_empty() {
                steps.push(json!({
                    "title": if title.is_empty() {
                        "Review plan proposal".to_string()
                    } else {
                        title.clone()
                    },
                    "status": "pending",
                }));
            }
            json!({
                "tool": "exitplanmode",
                "title": title,
                "steps": steps,
                "plan_text": plan_text.chars().take(4000).collect::<String>(),
            })
        }
        _ => Value::Null,
    }
}

const CLAUDE_HOOK_CORRELATION_MAX_PER_SESSION: usize = 32;
const CLAUDE_HOOK_CORRELATION_MAX_TOTAL: usize = 128;
const CLAUDE_HOOK_CORRELATION_LOCK_ATTEMPTS: usize = 50;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct ClaudePreToolUseCorrelation {
    session_id: String,
    common_prompt_id: String,
    tool_name: String,
    canonical_tool_input_sha256: String,
    tool_use_id: String,
    arrival_ordinal: u64,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(default)]
struct ClaudeHookCorrelationState {
    next_arrival_ordinal: u64,
    pre_tool_uses: VecDeque<ClaudePreToolUseCorrelation>,
}

impl ClaudeHookCorrelationState {
    fn next_ordinal(&mut self) -> u64 {
        self.next_arrival_ordinal = self.next_arrival_ordinal.saturating_add(1).max(1);
        self.next_arrival_ordinal
    }

    fn remember_pre_tool_use(
        &mut self,
        session_id: &str,
        common_prompt_id: &str,
        tool_name: &str,
        tool_input: &Value,
        tool_use_id: &str,
    ) {
        let arrival_ordinal = self.next_ordinal();
        while self
            .pre_tool_uses
            .iter()
            .filter(|record| record.session_id == session_id)
            .count()
            >= CLAUDE_HOOK_CORRELATION_MAX_PER_SESSION
        {
            let Some(index) = self
                .pre_tool_uses
                .iter()
                .position(|record| record.session_id == session_id)
            else {
                break;
            };
            self.pre_tool_uses.remove(index);
        }
        self.pre_tool_uses.push_back(ClaudePreToolUseCorrelation {
            session_id: session_id.to_string(),
            common_prompt_id: common_prompt_id.to_string(),
            tool_name: tool_name.to_string(),
            canonical_tool_input_sha256: diff_forge_activity_hook_canonical_sha256(tool_input),
            tool_use_id: tool_use_id.to_string(),
            arrival_ordinal,
        });
        while self.pre_tool_uses.len() > CLAUDE_HOOK_CORRELATION_MAX_TOTAL {
            self.pre_tool_uses.pop_front();
        }
    }

    fn take_permission_match(
        &mut self,
        session_id: &str,
        tool_name: &str,
        tool_input: &Value,
    ) -> Option<ClaudePreToolUseCorrelation> {
        let tool_key = diff_forge_activity_hook_name_key(tool_name);
        let canonical_tool_input_sha256 = diff_forge_activity_hook_canonical_sha256(tool_input);
        let index = self.pre_tool_uses.iter().position(|record| {
            record.session_id == session_id
                && diff_forge_activity_hook_name_key(&record.tool_name) == tool_key
                && record.canonical_tool_input_sha256 == canonical_tool_input_sha256
        })?;
        self.pre_tool_uses.remove(index)
    }

    fn evict_tool_use(&mut self, session_id: &str, tool_use_id: &str) {
        self.pre_tool_uses
            .retain(|record| record.session_id != session_id || record.tool_use_id != tool_use_id);
    }

    fn evict_session(&mut self, session_id: &str) {
        self.pre_tool_uses
            .retain(|record| record.session_id != session_id);
    }
}

fn diff_forge_activity_hook_name_key(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn diff_forge_activity_hook_canonical_value(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(diff_forge_activity_hook_canonical_value)
                .collect(),
        ),
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            let mut canonical = serde_json::Map::new();
            for key in keys {
                canonical.insert(
                    key.clone(),
                    diff_forge_activity_hook_canonical_value(&object[key]),
                );
            }
            Value::Object(canonical)
        }
        _ => value.clone(),
    }
}

fn diff_forge_activity_hook_canonical_json(value: &Value) -> String {
    serde_json::to_string(&diff_forge_activity_hook_canonical_value(value)).unwrap_or_default()
}

fn diff_forge_activity_hook_canonical_sha256(value: &Value) -> String {
    format!(
        "{:x}",
        Sha256::digest(diff_forge_activity_hook_canonical_json(value).as_bytes())
    )
}

fn diff_forge_activity_hook_record_base(
    provider: &str,
    pane_id: &str,
    instance_id: u64,
    workspace_id: &str,
    terminal_index: &str,
    hook_input: &Value,
) -> Value {
    let empty_tool_input = Value::Null;
    let tool_input = hook_input
        .get("tool_input")
        .or_else(|| hook_input.get("toolInput"))
        .unwrap_or(&empty_tool_input);
    let hook_string = |keys: &[&str]| -> String {
        keys.iter()
            .find_map(|key| hook_input.get(*key).and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
            .to_string()
    };
    let tool_string = |keys: &[&str]| -> String {
        keys.iter()
            .find_map(|key| tool_input.get(*key).and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
            .to_string()
    };
    let hook_bool = |keys: &[&str]| -> bool {
        keys.iter().any(|key| {
            hook_input
                .get(*key)
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
    };
    let hook_value = |keys: &[&str]| -> Value {
        keys.iter()
            .find_map(|key| hook_input.get(*key))
            .cloned()
            .unwrap_or(Value::Null)
    };
    let tool_value = |keys: &[&str]| -> Value {
        keys.iter()
            .find_map(|key| tool_input.get(*key))
            .cloned()
            .unwrap_or(Value::Null)
    };
    let hook_text_value = |keys: &[&str]| -> String {
        keys.iter()
            .find_map(|key| {
                hook_input
                    .get(*key)
                    .and_then(diff_forge_activity_hook_text_from_value)
            })
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
    };
    let hook_lossless_text_value = |keys: &[&str]| -> String {
        keys.iter()
            .find_map(|key| {
                hook_input
                    .get(*key)
                    .and_then(diff_forge_activity_hook_lossless_text_from_value)
            })
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
    };
    let tool_bool = |keys: &[&str]| -> bool {
        keys.iter().any(|key| {
            tool_input
                .get(*key)
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
    };
    let first_string = |values: Vec<String>| -> String {
        values
            .into_iter()
            .map(|value| value.trim().to_string())
            .find(|value| !value.is_empty())
            .unwrap_or_default()
    };
    let hook_event_name = hook_string(&[
        "hook_event_name",
        "hookEventName",
        "event_name",
        "eventName",
    ]);
    let hook_event_key = hook_event_name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    let session_id = hook_string(&["session_id", "sessionId"]);
    let turn_id = hook_string(&["turn_id", "turnId"]);
    let permission_mode = hook_string(&["permission_mode", "permissionMode"]);
    let transcript_path = hook_string(&["transcript_path", "transcriptPath"]);
    let agent_id = hook_string(&["agent_id", "agentId"]);
    let agent_type = first_string(vec![
        hook_string(&["agent_type", "agentType"]),
        tool_string(&["agent_type", "agentType", "subagent_type", "subagentType"]),
    ]);
    let agent_transcript_path = hook_string(&["agent_transcript_path", "agentTranscriptPath"]);
    let last_message = hook_text_value(&[
        "last_assistant_message",
        "lastAssistantMessage",
        "last_message",
        "lastMessage",
    ]);
    let mut assistant_payload_keys = vec![
        "assistant_message",
        "assistantMessage",
        "assistant_delta",
        "assistantDelta",
        "content",
        "delta",
        "output",
        "response",
        "thinking",
        "reasoning",
    ];
    if hook_event_key.contains("message")
        || hook_event_key.contains("delta")
        || hook_event_key.contains("thinking")
        || hook_event_key.contains("reasoning")
    {
        assistant_payload_keys.push("message");
    }
    let assistant_message = first_string(vec![
        hook_string(&[
            "assistant_message",
            "assistantMessage",
            "assistant_delta",
            "assistantDelta",
            "output_text",
            "outputText",
            "text",
        ]),
        hook_text_value(&assistant_payload_keys),
    ]);
    let assistant_delta = hook_lossless_text_value(&[
        "assistant_delta",
        "assistantDelta",
        "text_delta",
        "textDelta",
        "content_delta",
        "contentDelta",
        "delta",
    ]);
    let assistant_message_snapshot = hook_lossless_text_value(&[
        "assistant_message_snapshot",
        "assistantMessageSnapshot",
        "assistant_snapshot",
        "assistantSnapshot",
        "message_snapshot",
        "messageSnapshot",
        "cumulative_text",
        "cumulativeText",
    ]);
    let reasoning_delta = hook_lossless_text_value(&[
        "reasoning_delta",
        "reasoningDelta",
        "thinking_delta",
        "thinkingDelta",
    ]);
    let reasoning_snapshot = hook_lossless_text_value(&[
        "reasoning_snapshot",
        "reasoningSnapshot",
        "thinking_snapshot",
        "thinkingSnapshot",
    ]);
    let description = first_string(vec![
        tool_string(&["description", "prompt"]),
        hook_string(&["description"]),
    ]);
    let user_prompt = first_string(vec![
        hook_string(&["prompt", "user_prompt", "userPrompt", "message"]),
        tool_string(&["prompt", "description"]),
    ]);
    let display_message = first_string(vec![
        assistant_message.clone(),
        user_prompt.clone(),
        description.clone(),
    ]);
    let tool_name = first_string(vec![
        hook_string(&["tool_name", "toolName"]),
        tool_string(&["tool_name", "toolName"]),
    ]);
    let tool_use_id = first_string(vec![
        hook_string(&["tool_use_id", "toolUseId"]),
        tool_string(&["tool_use_id", "toolUseId"]),
    ]);
    let tool_server = first_string(vec![
        hook_string(&["tool_server", "toolServer", "server"]),
        tool_string(&["tool_server", "toolServer", "server"]),
    ]);
    let command = tool_string(&["command"]);
    let tool_output = hook_value(&[
        "tool_output",
        "toolOutput",
        "tool_response",
        "toolResponse",
        "output",
        "result",
        "response",
        "stdout",
    ]);
    let tool_error = hook_value(&["tool_error", "toolError", "error", "stderr"]);
    let error_details = hook_value(&[
        "error_details",
        "errorDetails",
        "details",
        "api_error",
        "apiError",
    ]);
    let error_code = first_string(vec![
        hook_string(&[
            "provider_code",
            "providerCode",
            "error_code",
            "errorCode",
            "error_type",
            "errorType",
            "code",
        ]),
        tool_string(&[
            "provider_code",
            "providerCode",
            "error_code",
            "errorCode",
            "error_type",
            "errorType",
            "code",
        ]),
    ]);
    let error_retryable = hook_bool(&["retryable", "isRetryable", "willRetry"])
        || tool_bool(&["retryable", "isRetryable", "willRetry"]);
    let raw_tool_payload = hook_value(&[
        "rawToolPayload",
        "raw_tool_payload",
        "rawPayload",
        "raw_payload",
        "raw",
    ]);
    let duration_ms = hook_value(&["durationMs", "duration_ms", "elapsedMs", "elapsed_ms"]);
    let exit_code = hook_value(&["exitCode", "exit_code", "code"]);
    let mut tool_paths = Vec::new();
    claude_guard_collect_tool_paths(tool_input, &mut tool_paths);
    let graph_file_path = tool_paths
        .iter()
        .map(|path| diff_forge_architecture_graph_path_from_text(path))
        .find(|path| !path.is_empty())
        .unwrap_or_else(|| diff_forge_architecture_graph_path_from_value(tool_input));
    let approval_id = first_string(vec![
        hook_string(&["approval_id", "approvalId"]),
        tool_string(&["approval_id", "approvalId"]),
    ]);
    let permission_prompt_id = first_string(vec![
        hook_string(&["permission_prompt_id", "permissionPromptId"]),
        tool_string(&["permission_prompt_id", "permissionPromptId"]),
    ]);
    let permission_request_id = first_string(vec![
        hook_string(&[
            "permission_request_id",
            "permissionRequestId",
            "prompt_id",
            "promptId",
            "question_id",
            "questionId",
            "selection_id",
            "selectionId",
            "id",
        ]),
        tool_string(&[
            "permission_request_id",
            "permissionRequestId",
            "prompt_id",
            "promptId",
            "question_id",
            "questionId",
            "selection_id",
            "selectionId",
            "id",
        ]),
    ]);
    let permission_status = first_string(vec![
        hook_string(&["permission_status", "permissionStatus"]),
        tool_string(&["permission_status", "permissionStatus"]),
    ]);
    let permission_decision = first_string(vec![
        hook_string(&["permission_decision", "permissionDecision", "decision"]),
        tool_string(&["permission_decision", "permissionDecision", "decision"]),
    ]);
    let approval_status = first_string(vec![
        hook_string(&["approval_status", "approvalStatus"]),
        tool_string(&["approval_status", "approvalStatus"]),
    ]);
    let prompting_user_kind = first_string(vec![
        hook_string(&[
            "prompting_user_kind",
            "promptingUserKind",
            "prompting_kind",
            "promptingKind",
        ]),
        tool_string(&[
            "prompting_user_kind",
            "promptingUserKind",
            "prompting_kind",
            "promptingKind",
        ]),
    ]);
    let prompting_user_source = first_string(vec![
        hook_string(&[
            "prompting_user_source",
            "promptingUserSource",
            "prompting_source",
            "promptingSource",
        ]),
        tool_string(&[
            "prompting_user_source",
            "promptingUserSource",
            "prompting_source",
            "promptingSource",
        ]),
    ]);
    let prompting_user_text = first_string(vec![
        hook_string(&[
            "prompting_user_text",
            "promptingUserText",
            "prompting_text",
            "promptingText",
            "question",
            "title",
            "description",
            "message",
            "prompt",
        ]),
        tool_string(&[
            "prompting_user_text",
            "promptingUserText",
            "prompting_text",
            "promptingText",
            "question",
            "title",
            "description",
            "message",
            "prompt",
        ]),
    ]);
    let manual_approval_required =
        hook_bool(&["manual_approval_required", "manualApprovalRequired"])
            || tool_bool(&["manual_approval_required", "manualApprovalRequired"]);
    let provider_blocked_for_user =
        hook_bool(&["provider_blocked_for_user", "providerBlockedForUser"])
            || tool_bool(&["provider_blocked_for_user", "providerBlockedForUser"]);
    let requires_user_input = hook_bool(&["requires_user_input", "requiresUserInput"])
        || tool_bool(&["requires_user_input", "requiresUserInput"]);
    let prompting_user = hook_bool(&[
        "prompting_user",
        "promptingUser",
        "terminal_is_prompting_user",
        "terminalIsPromptingUser",
    ]) || tool_bool(&[
        "prompting_user",
        "promptingUser",
        "terminal_is_prompting_user",
        "terminalIsPromptingUser",
    ]);
    let startup_idle_candidate = hook_bool(&[
        "startupIdleCandidate",
        "startup_idle_candidate",
        "sessionIdleWithoutPrompt",
        "session_idle_without_prompt",
    ]);
    let startup_idle_buffered = hook_bool(&[
        "startupIdleBuffered",
        "startup_idle_buffered",
        "startingIdleBuffered",
        "starting_idle_buffered",
    ]);
    let stop_hook_active = hook_bool(&["stopHookActive", "stop_hook_active"]);
    let background_tasks = hook_value(&["backgroundTasks", "background_tasks"]);
    let session_crons = hook_value(&["sessionCrons", "session_crons"]);
    let prompt_options = {
        let value = hook_value(&[
            "promptOptions",
            "prompt_options",
            "options",
            "choices",
            "actions",
            "decisions",
        ]);
        if value.is_null() {
            tool_value(&[
                "promptOptions",
                "prompt_options",
                "options",
                "choices",
                "actions",
                "decisions",
            ])
        } else {
            value
        }
    };
    let prompt_questions = {
        let value = hook_value(&[
            "promptQuestions",
            "prompt_questions",
            "questions",
            "questionSet",
            "question_set",
        ]);
        if value.is_null() {
            tool_value(&[
                "promptQuestions",
                "prompt_questions",
                "questions",
                "questionSet",
                "question_set",
            ])
        } else {
            value
        }
    };
    let prompt_schema = {
        let value = hook_value(&[
            "promptSchema",
            "prompt_schema",
            "requestedSchema",
            "requested_schema",
            "schema",
        ]);
        if value.is_null() {
            tool_value(&[
                "promptSchema",
                "prompt_schema",
                "requestedSchema",
                "requested_schema",
                "schema",
            ])
        } else {
            value
        }
    };
    let prompt_url = first_string(vec![
        hook_string(&["promptUrl", "prompt_url", "url"]),
        tool_string(&["promptUrl", "prompt_url", "url"]),
    ]);
    let native_provider_payload = hook_value(&["provider_payload", "providerPayload"]);
    let provider_payload = json!({
        "hook_event_name": hook_event_name,
        "tool_name": tool_name,
        "tool_input": tool_input,
        "questions": prompt_questions,
        "schema": prompt_schema,
        "url": prompt_url,
        "notification_type": hook_string(&["notification_type", "notificationType"]),
        "source": hook_string(&["source"]),
        "mode": hook_string(&["mode"]),
        "metadata": hook_value(&["metadata"]),
        "mcp_server_name": hook_string(&["mcp_server_name", "mcpServerName", "server_name", "serverName"]),
        "elicitation_id": hook_string(&["elicitation_id", "elicitationId"]),
        "permission_patterns": hook_value(&["patterns", "permission_patterns", "permissionPatterns"]),
        "permission_always": hook_value(&["always", "permission_always", "permissionAlways"]),
        "provider_request": native_provider_payload,
    });
    let permission_suggestions = {
        let value = hook_value(&[
            "permissionSuggestions",
            "permission_suggestions",
            "updatedPermissions",
            "updated_permissions",
        ]);
        if value.is_null() {
            tool_value(&[
                "permissionSuggestions",
                "permission_suggestions",
                "updatedPermissions",
                "updated_permissions",
            ])
        } else {
            value
        }
    };
    let prompt_default_option = first_string(vec![
        hook_string(&[
            "promptDefaultOption",
            "prompt_default_option",
            "defaultOption",
            "default_option",
            "defaultDecision",
            "default_decision",
            "default",
        ]),
        tool_string(&[
            "promptDefaultOption",
            "prompt_default_option",
            "defaultOption",
            "default_option",
            "defaultDecision",
            "default_decision",
            "default",
        ]),
    ]);
    let prompt_ttl_ms = {
        let value = hook_value(&[
            "promptTtlMs",
            "prompt_ttl_ms",
            "ttlMs",
            "ttl_ms",
            "timeoutMs",
            "timeout_ms",
        ]);
        if value.is_null() {
            tool_value(&[
                "promptTtlMs",
                "prompt_ttl_ms",
                "ttlMs",
                "ttl_ms",
                "timeoutMs",
                "timeout_ms",
            ])
        } else {
            value
        }
    };
    let prompt_ttl_ms_string = first_string(vec![
        hook_string(&[
            "promptTtlMs",
            "prompt_ttl_ms",
            "ttlMs",
            "ttl_ms",
            "timeoutMs",
            "timeout_ms",
        ]),
        tool_string(&[
            "promptTtlMs",
            "prompt_ttl_ms",
            "ttlMs",
            "ttl_ms",
            "timeoutMs",
            "timeout_ms",
        ]),
    ]);
    let prompt_ttl_ms_value = if !prompt_ttl_ms.is_null() {
        prompt_ttl_ms.clone()
    } else if prompt_ttl_ms_string.trim().is_empty() {
        Value::Null
    } else {
        Value::String(prompt_ttl_ms_string)
    };
    let plan_update = diff_forge_native_plan_update(&tool_name, tool_input, hook_input);
    json!({
        "timestamp_ms": current_time_ms(),
        "provider": provider,
        "pane_id": pane_id,
        "instance_id": instance_id,
        "workspace_id": workspace_id,
        "terminal_index": terminal_index,
        "event_name": hook_event_name.clone(),
        "hook_event_name": hook_event_name,
        "plan_update": plan_update,
        "session_id": session_id,
        "turn_id": turn_id,
        "cwd": hook_string(&["cwd"]),
        "permission_mode": permission_mode,
        "transcript_path": transcript_path,
        "agent_id": agent_id,
        "agent_type": agent_type,
        "agent_transcript_path": agent_transcript_path,
        "assistant_message": assistant_message,
        "assistant_delta": assistant_delta,
        "assistant_message_snapshot": assistant_message_snapshot,
        "reasoning_delta": reasoning_delta,
        "reasoning_snapshot": reasoning_snapshot,
        "last_message": last_message.clone(),
        "last_assistant_message": last_message,
        "message": display_message,
        "prompt": user_prompt.clone(),
        "tool_name": tool_name,
        "tool_use_id": tool_use_id,
        "tool_server": tool_server,
        "tool_input": tool_input.clone(),
        "tool_output": tool_output,
        "error": tool_error.clone(),
        "tool_error": tool_error,
        "error_details": error_details,
        "error_code": error_code,
        "retryable": error_retryable,
        "raw_tool_payload": raw_tool_payload,
        "command": command,
        "file_path": tool_paths.first().cloned().unwrap_or_default(),
        "duration_ms": duration_ms,
        "exit_code": exit_code,
        "graph_file_path": graph_file_path,
        "approval_id": approval_id,
        "permission_prompt_id": permission_prompt_id,
        "permission_request_id": permission_request_id,
        "interaction_id": hook_value(&[
            "interaction_id",
            "interactionId",
        ]),
        "interaction_revision": hook_value(&[
            "interaction_revision",
            "interactionRevision",
        ]),
        "resolved_interaction_id": hook_value(&[
            "resolved_interaction_id",
            "resolvedInteractionId",
        ]),
        "resolved_interaction_revision": hook_value(&[
            "resolved_interaction_revision",
            "resolvedInteractionRevision",
        ]),
        "permission_status": permission_status,
        "permission_decision": permission_decision,
        "approval_status": approval_status,
        "prompting_user_kind": prompting_user_kind,
        "prompting_user_source": prompting_user_source,
        "prompting_user_text": prompting_user_text,
        "prompt_options": prompt_options,
        "prompt_questions": prompt_questions,
        "prompt_schema": prompt_schema,
        "prompt_url": prompt_url,
        "provider_payload": provider_payload,
        "permission_suggestions": permission_suggestions,
        "prompt_default_option": prompt_default_option,
        "prompt_ttl_ms": prompt_ttl_ms_value,
        "manual_approval_required": manual_approval_required,
        "provider_blocked_for_user": provider_blocked_for_user,
        "requires_user_input": requires_user_input,
        "prompting_user": prompting_user,
        "terminal_is_prompting_user": prompting_user,
        "startup_idle_candidate": startup_idle_candidate,
        "session_idle_without_prompt": startup_idle_candidate,
        "startup_idle_buffered": startup_idle_buffered,
        "stop_hook_active": stop_hook_active,
        "background_tasks": background_tasks,
        "session_crons": session_crons,
        "description": if description.is_empty() { user_prompt } else { description },
    })
}

fn diff_forge_activity_hook_record_string(record: &Value, key: &str) -> String {
    record
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn diff_forge_activity_hook_set_prompt_identity(record: &mut Value, prompt_id: &str) {
    if prompt_id.trim().is_empty() {
        return;
    }
    record["permission_request_id"] = json!(prompt_id);
    record["prompt_id"] = json!(prompt_id);
}

fn diff_forge_activity_hook_exit_plan_body(tool_input: &Value) -> String {
    let plan_text = ["plan", "plan_text", "planText"]
        .iter()
        .find_map(|key| tool_input.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let plan_path = [
        "plan_path",
        "planPath",
        "plan_file_path",
        "planFilePath",
        "file_path",
        "filePath",
        "path",
    ]
    .iter()
    .find_map(|key| tool_input.get(*key).and_then(Value::as_str))
    .map(str::trim)
    .filter(|value| !value.is_empty());
    match (plan_text, plan_path) {
        (Some(text), Some(path)) => format!("{text}\n\nPlan file: {path}"),
        (Some(text), None) => text.to_string(),
        (None, Some(path)) => format!("Plan file: {path}"),
        (None, None) => String::new(),
    }
}

fn diff_forge_activity_hook_apply_claude_source_fidelity(
    hook_input: &Value,
    record: &mut Value,
    state: &mut ClaudeHookCorrelationState,
) {
    let hook_key = diff_forge_activity_hook_name_key(&diff_forge_activity_hook_record_string(
        record,
        "hook_event_name",
    ));
    let session_id = diff_forge_activity_hook_record_string(record, "session_id");
    let tool_name = diff_forge_activity_hook_record_string(record, "tool_name");
    let tool_key = diff_forge_activity_hook_name_key(&tool_name);
    let tool_use_id = diff_forge_activity_hook_record_string(record, "tool_use_id");
    let tool_input = record.get("tool_input").cloned().unwrap_or(Value::Null);

    if hook_key == "pretooluse" && !tool_use_id.is_empty() {
        let common_prompt_id =
            diff_forge_activity_hook_record_string(record, "permission_request_id");
        state.remember_pre_tool_use(
            &session_id,
            &common_prompt_id,
            &tool_name,
            &tool_input,
            &tool_use_id,
        );

        if matches!(tool_key.as_str(), "askuserquestion" | "exitplanmode") {
            diff_forge_activity_hook_set_prompt_identity(record, &tool_use_id);
        }
        if tool_key == "askuserquestion" {
            // The provider's question array is the menu. Keep it grouped by
            // question (including multiSelect) and leave the flat option list
            // empty so projection cannot manufacture a synthetic Continue.
            record["prompt_options"] = json!([]);
            record["prompting_user_kind"] = json!("question");
        } else if tool_key == "exitplanmode" {
            let body = diff_forge_activity_hook_exit_plan_body(&tool_input);
            if !body.is_empty() {
                record["message"] = json!(body);
                record["prompt"] = json!(body);
                record["prompting_user_text"] = json!(body);
                record["description"] = json!(body);
            }
            record["prompting_user_kind"] = json!("approval");
            record["prompt_default_option"] = json!("keep_planning");
            record["prompt_options"] = json!([
                {
                    "id": "approve_plan",
                    "label": "Approve plan",
                    "value": "approve_plan"
                },
                {
                    "id": "keep_planning",
                    "label": "Keep planning",
                    "value": "keep_planning"
                }
            ]);
            record["allows_free_text"] = json!(true);
        }
    } else if hook_key == "permissionrequest" {
        if let Some(matched) = state.take_permission_match(&session_id, &tool_name, &tool_input) {
            diff_forge_activity_hook_set_prompt_identity(record, &matched.tool_use_id);
        } else {
            // Preserve the historical common prompt id when Claude did not
            // provide a preceding correlatable PreToolUse event.
            let fallback_id =
                diff_forge_activity_hook_record_string(record, "permission_request_id");
            diff_forge_activity_hook_set_prompt_identity(record, &fallback_id);
        }

        let has_permission_suggestions = record
            .get("permission_suggestions")
            .is_some_and(|value| !value.is_null());
        let mut options = vec![json!({
            "id": "allow_once",
            "label": "Allow once",
            "value": "allow_once"
        })];
        if has_permission_suggestions {
            options.push(json!({
                "id": "allow_always",
                "label": "Allow always",
                "value": "allow_always"
            }));
        }
        options.push(json!({
            "id": "reject",
            "label": "Reject",
            "value": "reject"
        }));
        record["prompt_options"] = Value::Array(options);
        record["prompt_default_option"] = json!("reject");
    } else if hook_key == "elicitation" {
        let native_elicitation_id = ["elicitation_id", "elicitationId"]
            .iter()
            .find_map(|key| hook_input.get(*key).and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                hook_input
                    .get("provider_payload")
                    .or_else(|| hook_input.get("providerPayload"))
                    .and_then(|payload| {
                        ["elicitation_id", "elicitationId"]
                            .iter()
                            .find_map(|key| payload.get(*key).and_then(Value::as_str))
                    })
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            })
            .or_else(|| {
                record
                    .pointer("/provider_payload/elicitation_id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            });
        let elicitation_id = native_elicitation_id.unwrap_or_else(|| {
            let server = [
                "mcp_server_name",
                "mcpServerName",
                "server_name",
                "serverName",
                "server",
            ]
            .iter()
            .find_map(|key| hook_input.get(*key).and_then(Value::as_str))
            .or_else(|| {
                hook_input
                    .get("provider_payload")
                    .or_else(|| hook_input.get("providerPayload"))
                    .and_then(|payload| {
                        [
                            "mcp_server_name",
                            "mcpServerName",
                            "server_name",
                            "serverName",
                            "server",
                        ]
                        .iter()
                        .find_map(|key| payload.get(*key).and_then(Value::as_str))
                    })
            })
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("server");
            let payload = hook_input
                .get("provider_payload")
                .or_else(|| hook_input.get("providerPayload"))
                .filter(|value| !value.is_null())
                .unwrap_or(hook_input);
            let ordinal = state.next_ordinal();
            // Claude does not always expose elicitation_id. This documented
            // fallback is stable for an ordered hook stream and distinct for
            // repeated identical payloads: session + server + canonical
            // provider payload + arrival ordinal.
            let seed = format!(
                "{}\n{}\n{}\n{}",
                session_id,
                server,
                diff_forge_activity_hook_canonical_json(payload),
                ordinal
            );
            let digest = format!("{:x}", Sha256::digest(seed.as_bytes()));
            format!("elicitation-derived-{}", &digest[..32])
        });
        diff_forge_activity_hook_set_prompt_identity(record, &elicitation_id);
        record["elicitation_id"] = json!(elicitation_id);
        record["prompting_user_kind"] = json!("selection");
        record["prompt_default_option"] = json!("decline");
        record["prompt_options"] = json!([
            { "id": "accept", "label": "Accept", "value": "accept" },
            { "id": "decline", "label": "Decline", "value": "decline" },
            { "id": "cancel", "label": "Cancel", "value": "cancel" }
        ]);
    } else if hook_key == "permissiondenied" {
        // PermissionDenied reports a decision Claude has already finalized.
        // DiffForge may still offer a useful retry, but it is an intervention,
        // never a provider-native live blocking menu.
        record["interaction_response_mode"] = json!("diffforge_intervention");
        record["interaction_kind"] = json!("diffforge_retry_intervention");
        record["provider_native_prompt"] = json!(false);
    }

    if matches!(
        hook_key.as_str(),
        "posttooluse" | "posttoolusefailure" | "permissionresult"
    ) && !tool_use_id.is_empty()
    {
        state.evict_tool_use(&session_id, &tool_use_id);
    }
    if matches!(
        hook_key.as_str(),
        "stop" | "stopfailure" | "sessionend" | "userpromptcancelled"
    ) {
        state.evict_session(&session_id);
    }
}

fn diff_forge_activity_hook_record_with_claude_state(
    provider: &str,
    pane_id: &str,
    instance_id: u64,
    workspace_id: &str,
    terminal_index: &str,
    hook_input: &Value,
    state: &mut ClaudeHookCorrelationState,
) -> Value {
    let mut record = diff_forge_activity_hook_record_base(
        provider,
        pane_id,
        instance_id,
        workspace_id,
        terminal_index,
        hook_input,
    );
    if diff_forge_activity_hook_name_key(provider).contains("claude") {
        diff_forge_activity_hook_apply_claude_source_fidelity(hook_input, &mut record, state);
    }
    record
}

fn diff_forge_activity_hook_record(
    provider: &str,
    pane_id: &str,
    instance_id: u64,
    workspace_id: &str,
    terminal_index: &str,
    hook_input: &Value,
) -> Value {
    diff_forge_activity_hook_record_with_claude_state(
        provider,
        pane_id,
        instance_id,
        workspace_id,
        terminal_index,
        hook_input,
        &mut ClaudeHookCorrelationState::default(),
    )
}

fn diff_forge_claude_hook_correlation_state_path(activity_path: &Path) -> PathBuf {
    let mut path = activity_path.to_path_buf();
    path.set_extension("claude-hook-state.json");
    path
}

fn diff_forge_claude_hook_correlation_lock_path(activity_path: &Path) -> PathBuf {
    let mut path = activity_path.to_path_buf();
    path.set_extension("claude-hook-state.lock");
    path
}

struct DiffForgeClaudeHookCorrelationLock {
    path: PathBuf,
}

impl Drop for DiffForgeClaudeHookCorrelationLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn diff_forge_claude_hook_correlation_lock(
    activity_path: &Path,
) -> Option<DiffForgeClaudeHookCorrelationLock> {
    let lock_path = diff_forge_claude_hook_correlation_lock_path(activity_path);
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent).ok()?;
    }
    for _ in 0..CLAUDE_HOOK_CORRELATION_LOCK_ATTEMPTS {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(_) => return Some(DiffForgeClaudeHookCorrelationLock { path: lock_path }),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let stale = fs::metadata(&lock_path)
                    .ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .and_then(|modified| modified.elapsed().ok())
                    .is_some_and(|age| age > Duration::from_secs(5));
                if stale {
                    let _ = fs::remove_file(&lock_path);
                } else {
                    thread::sleep(Duration::from_millis(5));
                }
            }
            Err(_) => return None,
        }
    }
    None
}

fn diff_forge_activity_hook_record_with_persisted_claude_state(
    provider: &str,
    pane_id: &str,
    instance_id: u64,
    workspace_id: &str,
    terminal_index: &str,
    hook_input: &Value,
    activity_path: &Path,
) -> Value {
    if !diff_forge_activity_hook_name_key(provider).contains("claude") {
        return diff_forge_activity_hook_record(
            provider,
            pane_id,
            instance_id,
            workspace_id,
            terminal_index,
            hook_input,
        );
    }
    let Some(_lock) = diff_forge_claude_hook_correlation_lock(activity_path) else {
        return diff_forge_activity_hook_record(
            provider,
            pane_id,
            instance_id,
            workspace_id,
            terminal_index,
            hook_input,
        );
    };
    let state_path = diff_forge_claude_hook_correlation_state_path(activity_path);
    let mut state = fs::read(&state_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ClaudeHookCorrelationState>(&bytes).ok())
        .unwrap_or_default();
    let record = diff_forge_activity_hook_record_with_claude_state(
        provider,
        pane_id,
        instance_id,
        workspace_id,
        terminal_index,
        hook_input,
        &mut state,
    );
    if let Ok(bytes) = serde_json::to_vec(&state) {
        let temporary_path =
            state_path.with_extension(format!("claude-hook-state.{}.tmp", std::process::id()));
        if fs::write(&temporary_path, bytes).is_ok() {
            if fs::rename(&temporary_path, &state_path).is_err() {
                let _ = fs::remove_file(&state_path);
                let _ = fs::rename(&temporary_path, &state_path);
            }
        }
        let _ = fs::remove_file(temporary_path);
    }
    record
}

#[cfg(test)]
mod terminal_cli_tests {
    use super::*;

    #[test]
    fn claude_workspace_trust_merge_preserves_state_and_is_missing_file_safe() {
        let root = env::temp_dir().join(format!("diffforge-claude-trust-{}", uuid::Uuid::new_v4()));
        let workspace = root.join("workspace");
        let sibling_workspace = root.join("sibling");
        let config_path = root.join("profile").join(".claude.json");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&sibling_workspace).unwrap();
        fs::create_dir_all(config_path.parent().unwrap()).unwrap();
        let workspace = fs::canonicalize(workspace).unwrap();
        let sibling_workspace = fs::canonicalize(sibling_workspace).unwrap();
        let initial = json!({
            "oauthAccount": { "emailAddress": "dev@example.com" },
            "projects": {
                (workspace_path_display(&sibling_workspace)): {
                    "hasTrustDialogAccepted": false,
                    "allowedTools": ["Read", "Bash(git status)"]
                },
                (workspace_path_display(&workspace)): {
                    "allowedTools": ["Read"],
                    "customSibling": { "keep": true }
                }
            },
            "unrelatedCache": { "keep": [1, 2, 3] }
        });
        fs::write(&config_path, serde_json::to_vec_pretty(&initial).unwrap()).unwrap();

        assert_eq!(
            ensure_claude_workspace_trust_in_config(&config_path, &workspace).unwrap(),
            ClaudeWorkspaceTrustMergeOutcome::Updated
        );
        let first_bytes = fs::read(&config_path).unwrap();
        let merged: Value = serde_json::from_slice(&first_bytes).unwrap();
        let project = &merged["projects"][workspace_path_display(&workspace)];
        assert_eq!(project["hasTrustDialogAccepted"], true);
        assert_eq!(project["hasCompletedProjectOnboarding"], true);
        assert_eq!(project["allowedTools"], json!(["Read"]));
        assert_eq!(project["customSibling"], json!({ "keep": true }));
        assert_eq!(merged["oauthAccount"], initial["oauthAccount"]);
        assert_eq!(merged["unrelatedCache"], initial["unrelatedCache"]);
        assert_eq!(
            merged["projects"][workspace_path_display(&sibling_workspace)],
            initial["projects"][workspace_path_display(&sibling_workspace)]
        );

        assert_eq!(
            ensure_claude_workspace_trust_in_config(&config_path, &workspace).unwrap(),
            ClaudeWorkspaceTrustMergeOutcome::Unchanged
        );
        assert_eq!(fs::read(&config_path).unwrap(), first_bytes);

        let missing_path = root.join("missing-profile").join(".claude.json");
        assert_eq!(
            ensure_claude_workspace_trust_in_config(&missing_path, &workspace).unwrap(),
            ClaudeWorkspaceTrustMergeOutcome::Updated
        );
        let missing_state: Value =
            serde_json::from_slice(&fs::read(&missing_path).unwrap()).unwrap();
        assert_eq!(
            missing_state["projects"][workspace_path_display(&workspace)]["hasTrustDialogAccepted"],
            true
        );

        let corrupt_path = root.join("corrupt-profile").join(".claude.json");
        fs::create_dir_all(corrupt_path.parent().unwrap()).unwrap();
        fs::write(&corrupt_path, b"{not-json").unwrap();
        assert_eq!(
            ensure_claude_workspace_trust_in_config(&corrupt_path, &workspace).unwrap(),
            ClaudeWorkspaceTrustMergeOutcome::SkippedInvalidConfig
        );
        assert_eq!(fs::read(&corrupt_path).unwrap(), b"{not-json");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_claude_workspace_trust_merges_preserve_both_projects() {
        use std::sync::Barrier;

        let root = env::temp_dir().join(format!(
            "diffforge-claude-trust-concurrent-{}",
            uuid::Uuid::new_v4()
        ));
        let config_path = root.join("profile").join(".claude.json");
        let workspace_a = root.join("workspace-a");
        let workspace_b = root.join("workspace-b");
        fs::create_dir_all(config_path.parent().unwrap()).unwrap();
        fs::create_dir_all(&workspace_a).unwrap();
        fs::create_dir_all(&workspace_b).unwrap();
        fs::write(&config_path, b"{\"sibling\":{\"keep\":true}}").unwrap();
        let workspace_a = fs::canonicalize(workspace_a).unwrap();
        let workspace_b = fs::canonicalize(workspace_b).unwrap();
        let barrier = Arc::new(Barrier::new(2));

        let handles = [workspace_a.clone(), workspace_b.clone()].map(|workspace| {
            let config_path = config_path.clone();
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                ensure_claude_workspace_trust_in_config(&config_path, &workspace).unwrap()
            })
        });
        for handle in handles {
            assert!(matches!(
                handle.join().unwrap(),
                ClaudeWorkspaceTrustMergeOutcome::Updated
                    | ClaudeWorkspaceTrustMergeOutcome::Unchanged
            ));
        }

        let merged: Value = serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
        assert_eq!(merged["sibling"]["keep"], true);
        for workspace in [&workspace_a, &workspace_b] {
            assert_eq!(
                merged["projects"][workspace_path_display(workspace)]["hasTrustDialogAccepted"],
                true
            );
            assert_eq!(
                merged["projects"][workspace_path_display(workspace)]
                    ["hasCompletedProjectOnboarding"],
                true
            );
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn claude_interactive_preflight_targets_final_launch_config_and_managed_cwd() {
        let root = env::temp_dir().join(format!(
            "diffforge-claude-trust-launch-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        let other_directory = root.join("other");
        let profile = root.join("selected-profile");
        let overridden_home = root.join("overridden-home");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&other_directory).unwrap();
        fs::create_dir_all(&profile).unwrap();
        fs::create_dir_all(&overridden_home).unwrap();
        let workspace = fs::canonicalize(workspace).unwrap();
        let other_directory = fs::canonicalize(other_directory).unwrap();
        let env_vars = vec![
            (
                "DIFFFORGE_MANAGED_AGENT_TERMINAL".to_string(),
                "1".to_string(),
            ),
            (
                "DIFFFORGE_TERMINAL_PROVIDER".to_string(),
                "claude".to_string(),
            ),
            (
                "DIFFFORGE_WORKSPACE_ROOT".to_string(),
                workspace.to_string_lossy().to_string(),
            ),
            (
                "CLAUDE_CONFIG_DIR".to_string(),
                profile.to_string_lossy().to_string(),
            ),
            (
                "HOME".to_string(),
                overridden_home.to_string_lossy().to_string(),
            ),
        ];

        preflight_interactive_claude_workspace_trust(
            "/usr/local/bin/claude",
            &workspace,
            &env_vars,
        );
        let state_path = profile.join(".claude.json");
        let state: Value = serde_json::from_slice(&fs::read(&state_path).unwrap()).unwrap();
        assert_eq!(
            state["projects"][workspace_path_display(&workspace)]["hasTrustDialogAccepted"],
            true
        );
        assert!(!overridden_home.join(".claude.json").exists());

        fs::remove_file(&state_path).unwrap();
        preflight_interactive_claude_workspace_trust(
            "/usr/local/bin/claude",
            &other_directory,
            &env_vars,
        );
        assert!(!state_path.exists());

        let mut unmanaged_env = env_vars;
        unmanaged_env.retain(|(key, _)| key != "DIFFFORGE_MANAGED_AGENT_TERMINAL");
        preflight_interactive_claude_workspace_trust(
            "/usr/local/bin/claude",
            &workspace,
            &unmanaged_env,
        );
        assert!(!state_path.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn claude_interactive_resume_requires_an_explicit_session() {
        let explicit = terminal_interactive_resume_args(
            "claude",
            &[
                "--resume".to_string(),
                "claude-session-1".to_string(),
                "--model".to_string(),
                "opus".to_string(),
            ],
        );
        assert_eq!(&explicit[..2], ["--resume", "claude-session-1"]);
        assert!(!explicit.iter().any(|arg| arg == "--continue"));

        let bare_resume = terminal_interactive_resume_args(
            "claude",
            &[
                "--resume".to_string(),
                "--model".to_string(),
                "opus".to_string(),
            ],
        );
        assert_eq!(bare_resume, ["--model", "opus"]);
        let bare_continue = terminal_interactive_resume_args("claude", &["--continue".to_string()]);
        assert!(bare_continue.is_empty());
        assert!(terminal_interactive_resume_args("claude", &[]).is_empty());
    }

    #[test]
    fn codex_interactive_resume_never_reaches_the_picker() {
        let explicit = terminal_interactive_resume_args(
            "codex",
            &["resume".to_string(), "codex-session-1".to_string()],
        );
        assert_eq!(explicit, ["resume", "codex-session-1"]);
        assert_eq!(
            terminal_interactive_resume_args("codex", &["resume".to_string()]),
            ["resume", "--last"]
        );
        assert!(terminal_interactive_resume_args("codex", &[]).is_empty());
    }

    #[test]
    fn interactive_launches_make_permission_and_model_choices_explicit() {
        let claude = terminal_args_with_codex_mcp_identity(
            "claude",
            &["--model".to_string(), "opus".to_string()],
            None,
            None,
            "pane-launch",
            1,
            None,
        );
        assert!(claude.windows(2).any(|pair| pair == ["--model", "opus"]));
        assert!(claude
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "acceptEdits"]));

        let codex = terminal_args_with_codex_mcp_identity(
            "codex",
            &[
                "resume".to_string(),
                "codex-session-1".to_string(),
                "--model".to_string(),
                "gpt-5.4".to_string(),
                "-c".to_string(),
                "model_reasoning_effort=\"high\"".to_string(),
            ],
            None,
            None,
            "pane-launch",
            1,
            None,
        );
        assert_eq!(&codex[..2], ["resume", "codex-session-1"]);
        assert!(codex.windows(2).any(|pair| pair == ["--model", "gpt-5.4"]));
        assert!(codex
            .windows(2)
            .any(|pair| pair == ["-c", "model_reasoning_effort=\"high\""]));
        assert!(codex
            .windows(2)
            .any(|pair| pair == ["--ask-for-approval", "never"]));
        assert!(codex
            .windows(2)
            .any(|pair| pair == ["--sandbox", "workspace-write"]));
    }

    #[test]
    fn coordinated_interactive_codex_keeps_apps_while_internal_turns_disable_them() {
        let mut interactive = vec![
            "--disable".to_string(),
            "apps".to_string(),
            "resume".to_string(),
            "session-1".to_string(),
        ];
        apply_codex_coordinated_auto_approval_args(
            &mut interactive,
            None,
            false,
            Some(TERMINAL_PERMISSION_MODE_ACCEPT_EDITS),
        );
        assert!(!interactive
            .windows(2)
            .any(|pair| pair == ["--disable", "apps"]));

        let coordination = TerminalCoordinationSession {
            repo_path: "/tmp/diffforge-workspace".to_string(),
            db_path: "/tmp/diffforge-workspace/coordination.db".to_string(),
            mcp_command: "diffforge".to_string(),
            agent_id: "codex".to_string(),
            agent_kind: "codex".to_string(),
            session_id: "session-1".to_string(),
            terminal_launch_epoch: Some("pane-1:1".to_string()),
            env_vars: Vec::new(),
        };
        let coordinated = terminal_args_with_codex_mcp_identity(
            "codex",
            &[],
            Some(&coordination),
            Some(TERMINAL_PERMISSION_MODE_ACCEPT_EDITS),
            "pane-1",
            1,
            None,
        );
        assert!(!coordinated
            .windows(2)
            .any(|pair| pair == ["--disable", "apps"]));
        assert!(coordinated
            .iter()
            .any(|arg| arg.contains("coordination-kernel")));
        assert!(coordinated
            .iter()
            .any(|arg| arg.contains("workspace-mcp-gateway")));

        let output = env::temp_dir().join("diffforge-codex-internal-turn-output.txt");
        let internal = build_codex_turn_args(None, "", &output);
        assert!(internal
            .windows(2)
            .any(|pair| pair == ["--disable", "apps"]));

        let mut coordinated_exec = vec!["exec".to_string(), "-".to_string()];
        apply_codex_coordinated_exec_args(&mut coordinated_exec, &coordination);
        assert!(coordinated_exec
            .windows(2)
            .any(|pair| pair == ["--disable", "apps"]));
    }

    #[test]
    fn windows_claude_staging_prunes_only_files_at_or_beyond_max_age() {
        let now = UNIX_EPOCH + Duration::from_secs(1_000_000);
        let just_recent = now - WINDOWS_CLAUDE_LAUNCH_STAGE_MAX_AGE + Duration::from_secs(1);
        let exactly_stale = now - WINDOWS_CLAUDE_LAUNCH_STAGE_MAX_AGE;

        assert!(!windows_claude_launch_file_should_prune(just_recent, now));
        assert!(windows_claude_launch_file_should_prune(exactly_stale, now));
        assert!(!windows_claude_launch_file_should_prune(
            now + Duration::from_secs(1),
            now
        ));
    }

    #[test]
    fn windows_claude_staging_failure_cleans_files_from_attempt() {
        let command_path = r"C:\Users\tester\AppData\Roaming\npm\claude.cmd";
        let marker = format!("diffforge-stage-failure-{}", uuid::Uuid::new_v4());
        let args = vec![
            "--append-system-prompt".to_string(),
            format!("{marker}{}", "p".repeat(8_000)),
            "--model".to_string(),
            "m".repeat(8_000),
        ];

        let result = stage_windows_claude_launch_args(command_path, &args);
        assert!(result.is_err());

        let leaked = fs::read_dir(windows_claude_launch_stage_directory())
            .ok()
            .is_some_and(|entries| {
                entries.flatten().any(|entry| {
                    fs::read_to_string(entry.path())
                        .is_ok_and(|contents| contents.contains(&marker))
                })
            });
        assert!(
            !leaked,
            "failed staging left its payload in the temp directory"
        );
    }

    #[test]
    fn windows_claude_launch_staging_policy_uses_resolved_shim_type() {
        let batch_command_path = r"C:\Users\tester\AppData\Roaming\npm\claude.cmd";
        let native_command_path = r"C:\Program Files\Claude\claude.exe";
        assert_eq!(
            windows_agent_launch_command_line_bound(batch_command_path),
            WINDOWS_CLAUDE_LAUNCH_STAGE_THRESHOLD
        );
        assert_eq!(
            windows_agent_launch_command_line_bound(r"C:\tools\CLAUDE.BAT"),
            WINDOWS_CLAUDE_LAUNCH_STAGE_THRESHOLD
        );
        assert_eq!(
            windows_agent_launch_command_line_bound(native_command_path),
            WINDOWS_NATIVE_CLAUDE_LAUNCH_STAGE_THRESHOLD
        );

        let short_args = vec!["--model".to_string(), "sonnet".to_string()];
        assert!(!windows_claude_launch_needs_file_staging(
            batch_command_path,
            &short_args
        ));
        assert_eq!(
            stage_windows_claude_launch_args(batch_command_path, &short_args).unwrap(),
            short_args
        );

        let fixed_len = windows_agent_launch_command_line_len(
            batch_command_path,
            &["--append-system-prompt".to_string(), String::new()],
        );
        let batch_threshold_args = vec![
            "--append-system-prompt".to_string(),
            "x".repeat(WINDOWS_CLAUDE_LAUNCH_STAGE_THRESHOLD.saturating_sub(fixed_len)),
        ];
        assert_eq!(
            windows_agent_launch_command_line_len(batch_command_path, &batch_threshold_args),
            WINDOWS_CLAUDE_LAUNCH_STAGE_THRESHOLD
        );
        assert!(windows_claude_launch_needs_file_staging(
            batch_command_path,
            &batch_threshold_args
        ));
        assert!(!windows_claude_launch_needs_file_staging(
            native_command_path,
            &batch_threshold_args
        ));
        assert_eq!(
            stage_windows_claude_launch_args(native_command_path, &batch_threshold_args).unwrap(),
            batch_threshold_args
        );

        let native_fixed_len = windows_agent_launch_command_line_len(
            native_command_path,
            &["--append-system-prompt".to_string(), String::new()],
        );
        let native_oversized_args = vec![
            "--append-system-prompt".to_string(),
            "n".repeat(
                WINDOWS_NATIVE_CLAUDE_LAUNCH_STAGE_THRESHOLD
                    .saturating_sub(native_fixed_len)
                    .saturating_add(1),
            ),
        ];
        assert!(windows_claude_launch_needs_file_staging(
            native_command_path,
            &native_oversized_args
        ));
        let staged_native =
            stage_windows_claude_launch_args(native_command_path, &native_oversized_args).unwrap();
        assert!(
            windows_agent_launch_command_line_len(native_command_path, &staged_native)
                < WINDOWS_NATIVE_CLAUDE_LAUNCH_STAGE_THRESHOLD
        );
        let staged_native_path = staged_native
            .windows(2)
            .find_map(|pair| {
                (pair[0] == "--append-system-prompt-file").then_some(PathBuf::from(&pair[1]))
            })
            .expect("native launch should stage its system prompt");
        cleanup_windows_claude_launch_files(std::slice::from_ref(&staged_native_path));

        let native_unstageable_args = vec![
            "--model".to_string(),
            "m".repeat(WINDOWS_NATIVE_CLAUDE_LAUNCH_STAGE_THRESHOLD),
        ];
        let error = stage_windows_claude_launch_args(native_command_path, &native_unstageable_args)
            .expect_err("non-file-backed native launch should remain over the native bound");
        assert!(error.contains(&format!(
            "limit {WINDOWS_NATIVE_CLAUDE_LAUNCH_STAGE_THRESHOLD}"
        )));
    }

    #[test]
    fn windows_claude_successfully_staged_files_use_only_age_based_cleanup() {
        assert_eq!(
            windows_claude_launch_file_cleanup_policy(false),
            WindowsClaudeLaunchFileCleanupPolicy::AgeBasedSweep
        );
        assert_eq!(
            windows_claude_launch_file_cleanup_policy(true),
            WindowsClaudeLaunchFileCleanupPolicy::Immediate
        );
    }

    #[test]
    fn windows_claude_long_launch_uses_file_backed_payloads_below_cmd_limit() {
        let command_path = r"C:\Users\tester\AppData\Roaming\npm\claude.cmd";
        let settings = json!({
            "hooks": {
                "Stop": [{
                    "hooks": [{
                        "type": "command",
                        "command": "powershell.exe -NoProfile -File activity-hook.ps1",
                        "timeout": 5
                    }]
                }]
            },
            "permissions": { "allow": ["Read", "Write(C:/work/**)"] },
            "padding": "s".repeat(8_000)
        })
        .to_string();
        let mcp_config = json!({
            "mcpServers": {
                "coordination-kernel": {
                    "command": "diff-forge.exe",
                    "args": ["--coordination-mcp", "--repo-path", r"C:\work"]
                }
            }
        })
        .to_string();
        let mut allowed_tool_entries = APP_CONTROL_MCP_TOOL_NAMES
            .iter()
            .map(|tool| format!("mcp__{APP_CONTROL_MCP_SERVER_NAME}__{tool}"))
            .collect::<Vec<_>>();
        allowed_tool_entries.extend((0..160).map(|index| {
            format!(
                "mcp__diffforge-app-control__long_windows_tool_{index}_{}",
                "x".repeat(32)
            )
        }));
        let allowed_tools = allowed_tool_entries.join(",");
        let args = vec![
            "--settings".to_string(),
            settings.clone(),
            "--append-system-prompt".to_string(),
            APP_CONTROL_ORCHESTRATOR_SYSTEM_PROMPT.to_string(),
            "--mcp-config".to_string(),
            mcp_config.clone(),
            "--allowedTools".to_string(),
            allowed_tools.clone(),
        ];

        assert!(windows_claude_launch_needs_file_staging(
            command_path,
            &args
        ));
        let staged = stage_windows_claude_launch_args(command_path, &args).unwrap();
        assert!(
            windows_agent_launch_command_line_len(command_path, &staged)
                < WINDOWS_CLAUDE_LAUNCH_STAGE_THRESHOLD
        );
        assert!(!staged
            .iter()
            .any(|arg| arg == "--allowedTools" || arg == "--allowed-tools"));
        assert!(!staged.iter().any(|arg| arg == "--append-system-prompt"));

        let settings_path = staged
            .windows(2)
            .find_map(|pair| (pair[0] == "--settings").then_some(PathBuf::from(&pair[1])))
            .unwrap();
        let prompt_path = staged
            .windows(2)
            .find_map(|pair| {
                (pair[0] == "--append-system-prompt-file").then_some(PathBuf::from(&pair[1]))
            })
            .unwrap();
        let mcp_path = staged
            .windows(2)
            .find_map(|pair| (pair[0] == "--mcp-config").then_some(PathBuf::from(&pair[1])))
            .unwrap();

        let staged_settings: Value =
            serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
        assert_eq!(
            staged_settings["hooks"]["Stop"][0]["hooks"][0]["command"].as_str(),
            Some("powershell.exe -NoProfile -File activity-hook.ps1")
        );
        assert_eq!(
            staged_settings["padding"].as_str().map(str::len),
            Some(8_000)
        );
        let staged_allow = staged_settings["permissions"]["allow"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .collect::<HashSet<_>>();
        assert!(allowed_tool_entries
            .iter()
            .all(|tool| staged_allow.contains(tool.as_str())));
        assert!(staged_allow.contains("Read"));
        assert!(staged_allow.contains("Write(C:/work/**)"));
        assert_eq!(
            fs::read_to_string(&prompt_path).unwrap(),
            APP_CONTROL_ORCHESTRATOR_SYSTEM_PROMPT
        );
        assert_eq!(fs::read_to_string(&mcp_path).unwrap(), mcp_config);

        let _ = fs::remove_file(settings_path);
        let _ = fs::remove_file(prompt_path);
        let _ = fs::remove_file(mcp_path);
    }

    #[test]
    fn opencode_image_support_prefers_vision_over_text_only_family() {
        // Vision variants of otherwise text-only families are image-capable.
        assert_eq!(
            opencode_model_supports_images("llama-3.2-90b-vision-instruct"),
            Some(true)
        );
        assert_eq!(opencode_model_supports_images("deepseek-vl2"), Some(true));
        // Plain text-only families remain unsupported.
        assert_eq!(opencode_model_supports_images("llama-3.3-70b"), Some(false));
        assert_eq!(opencode_model_supports_images("deepseek-v3"), Some(false));
        // Known vision + unknown models.
        assert_eq!(opencode_model_supports_images("gpt-4o"), Some(true));
        assert_eq!(opencode_model_supports_images("glm-5.2"), None);
    }

    #[test]
    fn opencode_list_models_parser_filters_garbage_and_dedupes() {
        let output = r#"
            anthropic/claude-sonnet-4-5
        provider/model
        Provider Heading
        openai/gpt-5
        openai/gpt-5
        bad model/id
        missing-slash
        openrouter/google/gemini-2.5-pro
        tabs/are	bad
        "#;

        assert_eq!(
            parse_opencode_models_stdout(output),
            vec![
                "anthropic/claude-sonnet-4-5".to_string(),
                "provider/model".to_string(),
                "openai/gpt-5".to_string(),
                "openrouter/google/gemini-2.5-pro".to_string(),
            ]
        );
    }

    #[test]
    fn opencode_list_models_cache_uses_ttl_and_force_refresh() {
        let now = Instant::now();
        let entry = OpencodeModelCacheEntry {
            models: vec!["anthropic/claude-sonnet-4-5".to_string()],
            fetched_at_ms: 1234,
            fetched_instant: now
                .checked_sub(Duration::from_secs(30))
                .expect("fresh instant"),
            harness_version: None,
        };

        let cached = opencode_model_list_cached_response_for(Some(&entry), now, false)
            .expect("fresh cache response");
        assert_eq!(cached.source, "cache");
        assert_eq!(cached.models, entry.models);
        assert_eq!(cached.fetched_at_ms, 1234);
        assert_eq!(cached.error, None);

        assert!(opencode_model_list_cached_response_for(Some(&entry), now, true).is_none());

        let expired_entry = OpencodeModelCacheEntry {
            models: vec!["openai/gpt-5".to_string()],
            fetched_at_ms: 5678,
            fetched_instant: now
                .checked_sub(OPENCODE_MODELS_CACHE_TTL + Duration::from_secs(1))
                .expect("expired instant"),
            harness_version: None,
        };

        assert!(
            opencode_model_list_cached_response_for(Some(&expired_entry), now, false).is_none()
        );
    }

    fn chat_attachment_test_png(seed: u8) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\nchat-attachment-test".to_vec();
        bytes.push(seed);
        bytes
    }

    fn chat_attachment_test_ref(id: &str, name: &str, bytes: &[u8]) -> ChatAttachmentRef {
        ChatAttachmentRef {
            attachment_id: id.to_string(),
            sha256: chat_attachment_sha256_hex(bytes),
            bytes: bytes.len() as u64,
            mime: "image/png".to_string(),
            name: name.to_string(),
        }
    }

    fn cleanup_chat_attachment_test_sha(sha: &str) {
        if let Ok(mut index) = chat_attachment_stage_index().lock() {
            index.remove(sha);
        }
        let Ok(root) = chat_attachment_stage_root() else {
            return;
        };
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                let path = entry.path();
                let file_name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_string();
                if file_name.starts_with(&format!("{sha}-")) {
                    discard_staged_chat_attachment_file(&path);
                }
            }
        }
    }

    fn chat_attachment_test_stage_path(
        attachment: &ChatAttachmentRef,
        fallback_index: usize,
    ) -> PathBuf {
        chat_attachment_stage_root()
            .expect("stage root")
            .join(chat_attachment_file_name(attachment, fallback_index))
    }

    fn chat_attachment_tampered_bytes(bytes: &[u8]) -> Vec<u8> {
        let mut tampered = bytes.to_vec();
        let last_index = tampered.len().saturating_sub(1);
        tampered[last_index] = tampered[last_index].wrapping_add(1);
        tampered
    }

    #[test]
    fn chat_attachment_stage_verify_persist() {
        let bytes = chat_attachment_test_png(1);
        let attachment = chat_attachment_test_ref("att-stage-persist", "screenshot.png", &bytes);
        let sha = attachment.sha256.clone();
        cleanup_chat_attachment_test_sha(&sha);

        let result = stage_chat_attachment_refs_with(
            ChatAttachmentStageRequest {
                workspace_id: "workspace-1".to_string(),
                attachments: vec![attachment.clone()],
                ack_cloud: false,
                marker_start_index: 0,
            },
            |requested| {
                assert_eq!(requested.attachment_id, "att-stage-persist");
                Ok(ChatAttachmentDownload {
                    bytes: bytes.clone(),
                    content_type: "image/png".to_string(),
                })
            },
            false,
        );

        assert_eq!(result.staged, vec!["att-stage-persist".to_string()]);
        assert!(result.failed.is_empty());
        assert_eq!(result.attachments.len(), 1);
        assert!(result
            .marker_block
            .contains("[image-attached 1] screenshot.png -> "));
        let staged_path = Path::new(&result.attachments[0].path);
        assert_eq!(fs::read(staged_path).expect("staged file readable"), bytes);
        cleanup_chat_attachment_test_sha(&sha);
    }

    #[test]
    fn chat_attachment_dedupe_instant_ack() {
        let bytes = chat_attachment_test_png(2);
        let first = chat_attachment_test_ref("att-dedupe-first", "dedupe.png", &bytes);
        let sha = first.sha256.clone();
        cleanup_chat_attachment_test_sha(&sha);

        let first_result = stage_chat_attachment_refs_with(
            ChatAttachmentStageRequest {
                workspace_id: "workspace-1".to_string(),
                attachments: vec![first.clone()],
                ack_cloud: false,
                marker_start_index: 0,
            },
            |_| {
                Ok(ChatAttachmentDownload {
                    bytes: bytes.clone(),
                    content_type: "image/png".to_string(),
                })
            },
            false,
        );
        assert_eq!(first_result.staged, vec!["att-dedupe-first".to_string()]);

        let mut second = first;
        second.attachment_id = "att-dedupe-second".to_string();
        let mut downloads = 0usize;
        let second_result = stage_chat_attachment_refs_with(
            ChatAttachmentStageRequest {
                workspace_id: "workspace-1".to_string(),
                attachments: vec![second],
                ack_cloud: false,
                marker_start_index: 0,
            },
            |_| {
                downloads += 1;
                Err("download should have been skipped".to_string())
            },
            false,
        );

        assert_eq!(downloads, 0);
        assert_eq!(second_result.staged, vec!["att-dedupe-second".to_string()]);
        assert!(second_result.failed.is_empty());
        cleanup_chat_attachment_test_sha(&sha);
    }

    #[test]
    fn chat_attachment_tampered_staged_file_is_redownloaded() {
        let bytes = chat_attachment_test_png(5);
        let attachment = chat_attachment_test_ref("att-tamper-redownload", "tamper.png", &bytes);
        let sha = attachment.sha256.clone();
        cleanup_chat_attachment_test_sha(&sha);
        let staged_path = chat_attachment_test_stage_path(&attachment, 0);
        fs::write(&staged_path, chat_attachment_tampered_bytes(&bytes)).unwrap();

        let mut downloads = 0usize;
        let result = stage_chat_attachment_refs_with(
            ChatAttachmentStageRequest {
                workspace_id: "workspace-1".to_string(),
                attachments: vec![attachment.clone()],
                ack_cloud: false,
                marker_start_index: 0,
            },
            |_| {
                downloads += 1;
                Ok(ChatAttachmentDownload {
                    bytes: bytes.clone(),
                    content_type: "image/png".to_string(),
                })
            },
            false,
        );

        assert_eq!(downloads, 1);
        assert_eq!(result.staged, vec!["att-tamper-redownload".to_string()]);
        assert!(result.failed.is_empty());
        assert_eq!(fs::read(&staged_path).expect("staged file readable"), bytes);
        cleanup_chat_attachment_test_sha(&sha);
    }

    #[test]
    fn chat_attachment_tampered_staged_file_warns_without_ack() {
        let bytes = chat_attachment_test_png(6);
        let attachment =
            chat_attachment_test_ref("att-tamper-warning", "tamper-warning.png", &bytes);
        let sha = attachment.sha256.clone();
        cleanup_chat_attachment_test_sha(&sha);
        let staged_path = chat_attachment_test_stage_path(&attachment, 0);
        fs::write(&staged_path, chat_attachment_tampered_bytes(&bytes)).unwrap();

        let mut downloads = 0usize;
        let result = stage_chat_attachment_refs_with(
            ChatAttachmentStageRequest {
                workspace_id: "workspace-1".to_string(),
                attachments: vec![attachment.clone()],
                ack_cloud: true,
                marker_start_index: 0,
            },
            |_| {
                downloads += 1;
                Err("not found".to_string())
            },
            true,
        );

        assert_eq!(downloads, 1);
        assert!(result.staged.is_empty());
        assert_eq!(result.failed.len(), 1);
        assert_eq!(
            result.warning_block,
            "[attachment tamper-warning.png unavailable]"
        );
        assert!(!result.cloud_acked);
        assert!(result.cloud_ack_error.is_empty());
        assert!(!staged_path.exists());
        cleanup_chat_attachment_test_sha(&sha);
    }

    #[test]
    fn chat_attachment_verification_cache_hits_unchanged_file() {
        let bytes = chat_attachment_test_png(7);
        let attachment = chat_attachment_test_ref("att-cache-hit", "cache.png", &bytes);
        let sha = attachment.sha256.clone();
        cleanup_chat_attachment_test_sha(&sha);
        let staged_path = chat_attachment_test_stage_path(&attachment, 0);
        fs::write(&staged_path, &bytes).unwrap();

        let first = verify_staged_chat_attachment_path(&attachment, &staged_path)
            .expect("first verification");
        let second = verify_staged_chat_attachment_path(&attachment, &staged_path)
            .expect("second verification");

        assert!(!first.cache_hit);
        assert!(second.cache_hit);
        cleanup_chat_attachment_test_sha(&sha);
    }

    #[test]
    fn chat_attachment_dispatch_rehash_bypasses_poisoned_verify_cache() {
        let bytes = chat_attachment_test_png(8);
        let attachment =
            chat_attachment_test_ref("att-dispatch-cache-poison", "dispatch.png", &bytes);
        let sha = attachment.sha256.clone();
        cleanup_chat_attachment_test_sha(&sha);
        let staged_path = chat_attachment_test_stage_path(&attachment, 0);
        fs::write(&staged_path, chat_attachment_tampered_bytes(&bytes)).unwrap();
        let poisoned_key = chat_attachment_verify_cache_key(&staged_path).unwrap();
        if let Ok(mut cache) = chat_attachment_verify_cache().lock() {
            cache.insert(
                poisoned_key,
                ChatAttachmentVerifiedFile {
                    sha256: attachment.sha256.clone(),
                    signature_mime: Some("image/png".to_string()),
                },
            );
        }

        let cached = verify_staged_chat_attachment_path(&attachment, &staged_path)
            .expect("poisoned cached verification should pass");
        assert!(cached.cache_hit);

        let mut downloads = 0usize;
        let mut downloader = |_attachment: &ChatAttachmentRef| {
            downloads += 1;
            Ok(ChatAttachmentDownload {
                bytes: bytes.clone(),
                content_type: "image/png".to_string(),
            })
        };
        let result = stage_chat_attachment_refs_with_cache_mode(
            ChatAttachmentStageRequest {
                workspace_id: "workspace-1".to_string(),
                attachments: vec![attachment.clone()],
                ack_cloud: false,
                marker_start_index: 0,
            },
            &mut downloader,
            false,
            false,
        );

        assert_eq!(downloads, 1);
        assert_eq!(result.staged, vec!["att-dispatch-cache-poison".to_string()]);
        assert!(result.failed.is_empty());
        assert_eq!(fs::read(&staged_path).expect("staged file readable"), bytes);
        let refreshed_key = chat_attachment_verify_cache_key(&staged_path).unwrap();
        let refreshed = chat_attachment_verify_cache()
            .lock()
            .ok()
            .and_then(|cache| cache.get(&refreshed_key).cloned())
            .expect("dispatch full rehash refreshes cache");
        assert_eq!(refreshed.sha256, sha);
        cleanup_chat_attachment_test_sha(&sha);
    }

    #[test]
    fn chat_attachment_missing_inline_fetch_returns_warning_marker() {
        let bytes = chat_attachment_test_png(3);
        let attachment = chat_attachment_test_ref("att-missing", "lost.png", &bytes);
        cleanup_chat_attachment_test_sha(&attachment.sha256);

        let result = stage_chat_attachment_refs_with(
            ChatAttachmentStageRequest {
                workspace_id: "workspace-1".to_string(),
                attachments: vec![attachment.clone()],
                ack_cloud: false,
                marker_start_index: 0,
            },
            |_| Err("not found".to_string()),
            false,
        );

        assert!(result.staged.is_empty());
        assert_eq!(result.failed.len(), 1);
        assert_eq!(result.warning_block, "[attachment lost.png unavailable]");
        assert!(result.marker_block.is_empty());
        cleanup_chat_attachment_test_sha(&attachment.sha256);
    }

    #[test]
    fn chat_attachment_caps_validate_five_images_and_twenty_mb() {
        let bytes = chat_attachment_test_png(4);
        let six = (0..6)
            .map(|index| chat_attachment_test_ref(&format!("att-cap-{index}"), "cap.png", &bytes))
            .collect::<Vec<_>>();
        let too_many = stage_chat_attachment_refs_with(
            ChatAttachmentStageRequest {
                workspace_id: "workspace-1".to_string(),
                attachments: six,
                ack_cloud: false,
                marker_start_index: 0,
            },
            |_| Err("download should not run".to_string()),
            false,
        );
        assert_eq!(too_many.failed.len(), 6);
        assert!(too_many.failed[0].reason.contains("Attach up to 5 images"));

        let oversized = ChatAttachmentRef {
            attachment_id: "att-too-large".to_string(),
            sha256: "a".repeat(64),
            bytes: (MAX_FORGE_IMAGE_BYTES + 1) as u64,
            mime: "image/png".to_string(),
            name: "large.png".to_string(),
        };
        let oversized_result = stage_chat_attachment_refs_with(
            ChatAttachmentStageRequest {
                workspace_id: "workspace-1".to_string(),
                attachments: vec![oversized],
                ack_cloud: false,
                marker_start_index: 0,
            },
            |_| Err("download should not run".to_string()),
            false,
        );
        assert_eq!(
            oversized_result.failed[0].reason,
            "Images must be 10 MiB or smaller."
        );

        let total = (0..5)
            .map(|index| ChatAttachmentRef {
                attachment_id: format!("att-total-{index}"),
                sha256: format!("{index:064x}"),
                bytes: MAX_FORGE_IMAGE_BYTES as u64,
                mime: "image/png".to_string(),
                name: format!("total-{index}.png"),
            })
            .collect::<Vec<_>>();
        let total_result = stage_chat_attachment_refs_with(
            ChatAttachmentStageRequest {
                workspace_id: "workspace-1".to_string(),
                attachments: total,
                ack_cloud: false,
                marker_start_index: 0,
            },
            |_| Err("download should not run".to_string()),
            false,
        );
        assert_eq!(
            total_result.failed[0].reason,
            "Images must be 20 MB total or smaller."
        );
    }

    #[test]
    fn activity_hook_record_preserves_prompt_options() {
        let record = diff_forge_activity_hook_record(
            "opencode",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "UserPromptRequired",
                "prompting_user_kind": "selection",
                "prompting_user_text": "Choose what to do",
                "prompt_default_option": "Use existing config",
                "prompt_ttl_ms": 45000,
                "prompt_options": [
                    { "value": "Use existing config", "label": "Use existing config" },
                    { "value": "Create-new", "label": "Create new" }
                ]
            }),
        );

        assert_eq!(
            record.get("prompting_user_kind").and_then(Value::as_str),
            Some("selection")
        );
        assert_eq!(
            record.get("prompt_default_option").and_then(Value::as_str),
            Some("Use existing config")
        );
        assert_eq!(
            record.get("prompt_ttl_ms").and_then(Value::as_u64),
            Some(45000)
        );
        assert_eq!(
            record
                .get("prompt_options")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(2)
        );
    }

    #[test]
    fn opencode_stop_failure_normalization_preserves_original_interaction_identity() {
        let record = diff_forge_activity_hook_record(
            "opencode",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "StopFailure",
                "session_id": "session-1",
                "error_code": "permission_reply_failed",
                "error": "reply failed",
                "interactionId": "uir:opencode:session-1:permission:request-a:11",
                "interactionRevision": 11,
                "retryable": true
            }),
        );

        assert_eq!(
            record["interaction_id"],
            json!("uir:opencode:session-1:permission:request-a:11")
        );
        assert_eq!(record["interaction_revision"], json!(11));
        assert!(record["resolved_interaction_id"].is_null());
        assert!(record["resolved_interaction_revision"].is_null());
    }

    #[test]
    fn activity_hook_record_preserves_native_question_and_schema_payloads() {
        let record = diff_forge_activity_hook_record(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "PreToolUse",
                "tool_name": "AskUserQuestion",
                "tool_input": {
                    "questions": [{
                        "header": "Framework",
                        "question": "Which framework?",
                        "multiSelect": true,
                        "options": [{"label": "React"}, {"label": "Vue"}]
                    }]
                },
                "requested_schema": {"type": "object"},
                "url": "https://example.invalid/form"
            }),
        );

        assert_eq!(record["prompt_questions"][0]["header"], "Framework");
        assert_eq!(record["prompt_schema"]["type"], "object");
        assert_eq!(record["prompt_url"], "https://example.invalid/form");
        assert_eq!(record["provider_payload"]["tool_name"], "AskUserQuestion");
    }

    #[test]
    fn claude_permission_requests_correlate_fifo_to_distinct_tool_use_ids() {
        let mut state = ClaudeHookCorrelationState::default();
        for tool_use_id in ["tool-use-1", "tool-use-2"] {
            let record = diff_forge_activity_hook_record_with_claude_state(
                "claude",
                "pane-1",
                7,
                "workspace-1",
                "0",
                &json!({
                    "hook_event_name": "PreToolUse",
                    "session_id": "session-1",
                    "prompt_id": "common-turn-prompt",
                    "tool_name": "Bash",
                    "tool_use_id": tool_use_id,
                    "tool_input": {"command": "git status", "timeout": 30}
                }),
                &mut state,
            );
            assert_eq!(record["permission_request_id"], "common-turn-prompt");
        }

        let first = diff_forge_activity_hook_record_with_claude_state(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "PermissionRequest",
                "session_id": "session-1",
                "prompt_id": "common-turn-prompt",
                "tool_name": "Bash",
                "tool_input": {"timeout": 30, "command": "git status"}
            }),
            &mut state,
        );
        let second = diff_forge_activity_hook_record_with_claude_state(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "PermissionRequest",
                "session_id": "session-1",
                "prompt_id": "common-turn-prompt",
                "tool_name": "Bash",
                "tool_input": {"command": "git status", "timeout": 30}
            }),
            &mut state,
        );

        assert_eq!(first["permission_request_id"], "tool-use-1");
        assert_eq!(first["prompt_id"], "tool-use-1");
        assert_eq!(second["permission_request_id"], "tool-use-2");
        assert_eq!(second["prompt_id"], "tool-use-2");
        assert!(state.pre_tool_uses.is_empty());
    }

    #[test]
    fn claude_single_permission_without_correlation_keeps_common_prompt_id() {
        let record = diff_forge_activity_hook_record(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "PermissionRequest",
                "session_id": "session-1",
                "prompt_id": "existing-single-prompt",
                "tool_name": "Bash",
                "tool_input": {"command": "git status"}
            }),
        );

        assert_eq!(record["permission_request_id"], "existing-single-prompt");
        assert_eq!(record["prompt_id"], "existing-single-prompt");
    }

    #[test]
    fn claude_permission_correlation_survives_separate_hook_process_state_loads() {
        let root = env::temp_dir().join(format!(
            "diffforge-claude-hook-correlation-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let activity_path = root.join("events.jsonl");
        let pre_tool = diff_forge_activity_hook_record_with_persisted_claude_state(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "PreToolUse",
                "session_id": "session-1",
                "prompt_id": "common-turn-prompt",
                "tool_name": "Bash",
                "tool_use_id": "persisted-tool-use-1",
                "tool_input": {"command": "git status"}
            }),
            &activity_path,
        );
        assert_eq!(pre_tool["permission_request_id"], "common-turn-prompt");
        assert!(diff_forge_claude_hook_correlation_state_path(&activity_path).exists());

        let permission = diff_forge_activity_hook_record_with_persisted_claude_state(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "PermissionRequest",
                "session_id": "session-1",
                "prompt_id": "common-turn-prompt",
                "tool_name": "Bash",
                "tool_input": {"command": "git status"}
            }),
            &activity_path,
        );

        assert_eq!(permission["prompt_id"], "persisted-tool-use-1");
        let persisted = fs::read(diff_forge_claude_hook_correlation_state_path(
            &activity_path,
        ))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ClaudeHookCorrelationState>(&bytes).ok())
        .expect("persisted correlation state");
        assert!(persisted.pre_tool_uses.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn claude_ask_user_question_uses_tool_identity_and_structured_questions_only() {
        let record = diff_forge_activity_hook_record(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "PreToolUse",
                "session_id": "session-1",
                "prompt_id": "common-turn-prompt",
                "tool_name": "AskUserQuestion",
                "tool_use_id": "ask-tool-use-1",
                "tool_input": {
                    "questions": [
                        {
                            "header": "Framework",
                            "question": "Which frameworks?",
                            "multiSelect": true,
                            "options": [
                                {"label": "React", "description": "Use React"},
                                {"label": "Vue", "description": "Use Vue"}
                            ]
                        },
                        {
                            "header": "Tests",
                            "question": "Which runner?",
                            "multiSelect": false,
                            "options": [{"label": "Vitest", "description": "Fast tests"}]
                        }
                    ]
                }
            }),
        );

        assert_eq!(record["permission_request_id"], "ask-tool-use-1");
        assert_eq!(record["prompt_id"], "ask-tool-use-1");
        assert_eq!(record["prompt_questions"].as_array().map(Vec::len), Some(2));
        assert_eq!(record["prompt_questions"][0]["multiSelect"], true);
        assert_eq!(record["prompt_questions"][1]["multiSelect"], false);
        assert_eq!(
            record["prompt_questions"][0]["options"][0]["description"],
            "Use React"
        );
        assert_eq!(record["prompt_options"], json!([]));
    }

    #[test]
    fn claude_exit_plan_mode_uses_tool_identity_and_source_actions() {
        let record = diff_forge_activity_hook_record(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "PreToolUse",
                "session_id": "session-1",
                "prompt_id": "common-turn-prompt",
                "tool_name": "ExitPlanMode",
                "tool_use_id": "plan-tool-use-1",
                "tool_input": {
                    "plan": "# Plan\n\n- Implement the fix",
                    "plan_file_path": "/tmp/plan.md"
                }
            }),
        );

        assert_eq!(record["permission_request_id"], "plan-tool-use-1");
        assert_eq!(record["prompt_id"], "plan-tool-use-1");
        assert_eq!(record["prompt_default_option"], "keep_planning");
        assert_eq!(record["prompt_options"][0]["id"], "approve_plan");
        assert_eq!(record["prompt_options"][1]["id"], "keep_planning");
        assert_eq!(record["prompt_options"].as_array().map(Vec::len), Some(2));
        assert!(record["message"].as_str().is_some_and(|message| message
            .contains("Implement the fix")
            && message.contains("/tmp/plan.md")));
        assert_eq!(record["allows_free_text"], true);
    }

    #[test]
    fn claude_elicitation_promotes_native_id_actions_and_schema_defaults() {
        let record = diff_forge_activity_hook_record(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "Elicitation",
                "session_id": "session-1",
                "mcp_server_name": "example-server",
                "provider_payload": {
                    "elicitation_id": "elicitation-native-1",
                    "request": "Choose a region"
                },
                "requested_schema": {
                    "type": "object",
                    "properties": {
                        "region": {"type": "string", "default": "us-east-1"}
                    }
                }
            }),
        );

        assert_eq!(record["permission_request_id"], "elicitation-native-1");
        assert_eq!(record["prompt_id"], "elicitation-native-1");
        assert_eq!(record["prompt_options"][0]["id"], "accept");
        assert_eq!(record["prompt_options"][1]["id"], "decline");
        assert_eq!(record["prompt_options"][2]["id"], "cancel");
        assert_eq!(
            record.pointer("/prompt_schema/properties/region/default"),
            Some(&json!("us-east-1"))
        );
    }

    #[test]
    fn claude_elicitation_fallback_id_is_deterministic_and_ordinally_distinct() {
        let input = json!({
            "hook_event_name": "Elicitation",
            "session_id": "session-1",
            "mcp_server_name": "example-server",
            "requested_schema": {"type": "string", "default": "hello"}
        });
        let mut first_state = ClaudeHookCorrelationState::default();
        let first = diff_forge_activity_hook_record_with_claude_state(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &input,
            &mut first_state,
        );
        let second = diff_forge_activity_hook_record_with_claude_state(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &input,
            &mut first_state,
        );
        let mut replay_state = ClaudeHookCorrelationState::default();
        let replay = diff_forge_activity_hook_record_with_claude_state(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &input,
            &mut replay_state,
        );

        assert_eq!(first["prompt_id"], replay["prompt_id"]);
        assert_ne!(first["prompt_id"], second["prompt_id"]);
        assert!(first["prompt_id"]
            .as_str()
            .is_some_and(|id| id.starts_with("elicitation-derived-")));
    }

    #[test]
    fn claude_permission_allow_always_requires_source_suggestions() {
        let without = diff_forge_activity_hook_record(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "PermissionRequest",
                "session_id": "session-1",
                "prompt_id": "permission-1",
                "tool_name": "Bash",
                "tool_input": {"command": "git status"}
            }),
        );
        let with = diff_forge_activity_hook_record(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "PermissionRequest",
                "session_id": "session-1",
                "prompt_id": "permission-2",
                "tool_name": "Bash",
                "tool_input": {"command": "git status"},
                "permission_suggestions": [
                    {"type": "addRules", "rules": ["Bash(git status)"]}
                ]
            }),
        );
        let option_ids = |record: &Value| {
            record["prompt_options"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|option| option["id"].as_str().map(str::to_string))
                .collect::<Vec<_>>()
        };

        assert_eq!(option_ids(&without), vec!["allow_once", "reject"]);
        assert_eq!(
            option_ids(&with),
            vec!["allow_once", "allow_always", "reject"]
        );
    }

    #[test]
    fn claude_permission_denied_is_labeled_as_diffforge_intervention() {
        let record = diff_forge_activity_hook_record(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "PermissionDenied",
                "session_id": "session-1",
                "prompt_id": "permission-denied-1",
                "tool_name": "Bash"
            }),
        );

        assert_eq!(
            record["interaction_response_mode"],
            "diffforge_intervention"
        );
        assert_eq!(record["interaction_kind"], "diffforge_retry_intervention");
        assert_eq!(record["provider_native_prompt"], false);
    }

    #[test]
    fn activity_hook_record_preserves_tool_response_timing_and_exit_code() {
        let record = diff_forge_activity_hook_record(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "PostToolUse",
                "tool_name": "Bash",
                "tool_use_id": "tool-123",
                "tool_input": { "command": "npm test" },
                "tool_response": {
                    "stdout": "ok",
                    "stderr": "",
                    "interrupted": false
                },
                "duration_ms": 1234,
                "exit_code": 0
            }),
        );

        assert_eq!(record["tool_name"].as_str(), Some("Bash"));
        assert_eq!(record["tool_use_id"].as_str(), Some("tool-123"));
        assert_eq!(record["tool_input"]["command"].as_str(), Some("npm test"));
        assert_eq!(record["tool_output"]["stdout"].as_str(), Some("ok"));
        assert_eq!(record["duration_ms"].as_u64(), Some(1234));
        assert_eq!(record["exit_code"].as_i64(), Some(0));
    }

    #[test]
    fn claude_guard_settings_use_valid_claude_hook_events() {
        let coordination = TerminalCoordinationSession {
            repo_path: "/repo".to_string(),
            db_path: "/repo/.coordination/db".to_string(),
            mcp_command: "diff-forge".to_string(),
            agent_id: "claude".to_string(),
            agent_kind: "claude".to_string(),
            session_id: "session-1".to_string(),
            terminal_launch_epoch: None,
            env_vars: Vec::new(),
        };

        let settings = claude_write_authority_guard_settings(
            &coordination,
            TERMINAL_PERMISSION_MODE_ACCEPT_EDITS,
            "pane-claude",
            99,
            Some("workspace-claude"),
            Some(3),
            None,
        );

        // Claude Code rejects unknown hook events with a startup settings
        // warning; keep this to Claude's documented event set.
        assert!(settings.contains("\"StopFailure\""));
        assert!(!settings.contains("\"Error\""));
        assert!(!settings.contains("\"Interrupt\""));
        assert!(settings.contains("\"SessionStart\""));
        assert!(settings.contains("\"UserPromptSubmit\""));
        assert!(settings.contains("\"MessageDisplay\""));
        assert!(settings.contains("\"PreCompact\""));
        assert!(settings.contains("\"PostCompact\""));
        assert!(settings.contains("\"Stop\""));
        assert!(settings.contains("\"PostToolUse\""));
        assert!(settings.contains("\"SubagentStop\""));
        for event_name in [
            "UserPromptExpansion",
            "TaskCreated",
            "TaskCompleted",
            "TeammateIdle",
            "SessionEnd",
            "ConfigChange",
            "CwdChanged",
            "InstructionsLoaded",
            "FileChanged",
            "WorktreeRemove",
            "Setup",
        ] {
            assert!(settings.contains(&format!("\"{event_name}\"")));
        }
        assert!(!settings.contains("\"WorktreeCreate\""));
        assert!(settings.contains("--pane-id"));
        assert!(settings.contains("pane-claude"));
        assert!(settings.contains("--instance-id"));
        assert!(settings.contains("99"));
        assert!(settings.contains("--workspace-id"));
        assert!(settings.contains("workspace-claude"));
        assert!(settings.contains("--terminal-index"));
        assert!(settings.contains("3"));
        assert!(settings.contains("--events-path"));
        assert!(settings.contains("--debug-path"));
    }

    #[test]
    fn codex_activity_hooks_register_only_the_official_surface() {
        let mut hooks = json!({
            "hooks": {
                "MessageDisplay": [{"hooks": [{"type": "command", "command": "diff-forge --diff-forge-activity-hook"}]}],
                "CustomUserHook": [{"hooks": [{"type": "command", "command": "user-script"}]}]
            }
        });
        ensure_codex_activity_hooks(&mut hooks, "diff-forge --diff-forge-activity-hook");
        let object = hooks["hooks"].as_object().expect("hooks object");
        for event_name in [
            "SessionStart",
            "UserPromptSubmit",
            "PreCompact",
            "PostCompact",
            "Stop",
            "PreToolUse",
            "PostToolUse",
            "PermissionRequest",
            "SubagentStart",
            "SubagentStop",
        ] {
            assert!(object.contains_key(event_name), "missing {event_name}");
        }
        assert!(!object.contains_key("MessageDisplay"));
        assert!(object.contains_key("CustomUserHook"));
        assert_eq!(
            object["PermissionRequest"][0]["hooks"][0]["timeout"],
            json!(120)
        );
    }

    #[test]
    fn opencode_plugin_uses_chat_message_as_prompt_boundary() {
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("\"chat.message\""));
        assert!(
            DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("hook_event_name: \"UserPromptSubmit\"")
        );
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("userPromptSubmitKeys"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("messageRoleForPart"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("role !== \"assistant\""));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("assistantMessageCompleted"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("emitStop(sessionId"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("const IDLE_STOP_DELAY_MS = 1500"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("const emitQueues = new Map()"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("return previous.catch(() => {}).then(() => spawnHook(payload))"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("assistant_message_snapshot"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("const assistantTextPartsByMessage = new Map()"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("rememberAssistantPartSnapshot"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("scheduleStop(sessionId"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("emitStartupIdleCandidate"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("startup_idle_candidate: true"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("scheduleIdle(sessionId, \"session.status\")"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("scheduleIdle(sessionId, \"session.idle\")"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("clearTimeout(timer)"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("/permission/${id}/reply"));
        assert!(
            DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("postSessionIdPermissionsPermissionId")
        );
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("handlePendingPermission"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("reconcilePendingPermissions"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("client.permission.list"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("opencodeFetch(serverUrl, \"/permission\", undefined, \"GET\")"));
        assert!(
            DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("if (type === \"permission.asked\")")
        );
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("await handlePendingPermission(sessionId, requestId, props, interactionAskFingerprint(props))"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("hook_event_name: \"PermissionRequest\""));
        assert_eq!(
            DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
                .matches("interaction_id: interactionGeneration.interaction_id")
                .count(),
            4,
        );
        assert_eq!(
            DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
                .matches("interaction_revision: interactionGeneration.interaction_revision")
                .count(),
            4,
        );
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("reconcilePendingPermissions(\"session.status\")"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("reconcilePendingPermissions(\"session.idle\")"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("clearInterval(permissionReconcileInterval)"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("/question/${id}/reply"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("hook_event_name: \"TranscriptChanged\""));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("permission_decision: record.props.reply"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("permission.replied"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("interactionGenerations"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("takeInteractionGeneration"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("ask_fingerprint: askFingerprint"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("const HANDLED_INTERACTION_DEDUPE_TTL_MS = 90_000"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("const pendingInteractionIds = new Map()"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("const interactionAskFingerprint = (props)"));
        assert!(
            DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("scheduleHandledQuestionRevalidation")
        );
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("scheduleNativeInteractionResolutionRevalidation"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("const NATIVE_RESULT_REVALIDATION_TIMEOUT_MS = 90_000"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("newerGenerationQueued"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS
            .contains("handlePendingPermission(sessionId, requestId, props, askFingerprint)"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("livePermissionKeys"));
        assert!(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains("texts.join(\"\\n\")"));
        assert!(!DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains(
            "if (statusValue === \"idle\" || statusValue === \"cooldown\") {\n          emitStop(sessionId);"
        ));
        assert!(!DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS.contains(
            "activeSessions.add(sessionId);\n          emit({\n            hook_event_name: \"UserPromptSubmit\""
        ));
    }

    #[test]
    fn app_control_claude_launch_appends_orchestrator_instructions() {
        let args = terminal_args_with_app_control_mcp_identity(
            "claude",
            &["--model".to_string(), "sonnet".to_string()],
            "diff-forge",
            &["--app-control-mcp".to_string()],
        )
        .unwrap();

        let prompt = args
            .windows(2)
            .find_map(|pair| (pair[0] == "--append-system-prompt").then(|| pair[1].as_str()))
            .unwrap();
        assert!(prompt.contains("app-control terminal orchestrator"));
        assert!(prompt.contains("make a skill"));
        assert!(prompt.contains("list_docs"));
        assert!(prompt.contains("prepare_doc_draft"));
        assert!(prompt.contains("save_doc"));
        assert!(prompt.contains("list_scripts"));
        assert!(prompt.contains("modify this selection"));
        assert!(prompt.contains("update_selected_document"));
        assert!(
            prompt.contains("When a Loopspace should send a message to the terminal orchestrator")
        );
        assert!(prompt.contains("send_message action region"));
        assert!(prompt.contains("dispatch_todos action region"));
        assert!(prompt.contains("loopspace_run_context"));
        assert!(prompt.contains("coordination-kernel.start_task"));
        assert!(prompt.contains("target_terminal_mode=\"auto\""));
        assert!(prompt.contains("run identity only"));
        assert!(prompt.contains("trigger.out -> send_message.in"));
        assert!(prompt.contains("step.docs -> document_write.in"));

        let allowed_tools = args
            .windows(2)
            .find_map(|pair| {
                (pair[0] == "--allowedTools" || pair[0] == "--allowed-tools")
                    .then(|| pair[1].as_str())
            })
            .unwrap();
        assert!(allowed_tools.contains("mcp__diffforge-app-control__get_visible_context"));
        assert!(allowed_tools.contains("mcp__diffforge-app-control__list_docs"));
        assert!(allowed_tools.contains("mcp__diffforge-app-control__prepare_doc_draft"));
        assert!(allowed_tools.contains("mcp__diffforge-app-control__save_doc"));
        assert!(allowed_tools.contains("mcp__diffforge-app-control__list_scripts"));
        assert!(allowed_tools.contains("mcp__diffforge-app-control__list_assets"));
        assert!(allowed_tools.contains("mcp__diffforge-app-control__get_asset_root"));
        assert!(allowed_tools.contains("mcp__diffforge-app-control__upload_asset"));
        assert!(allowed_tools.contains("mcp__diffforge-app-control__download_asset"));
        assert!(allowed_tools.contains("mcp__diffforge-app-control__delete_loopspace_trigger"));
        assert!(
            allowed_tools.contains("mcp__diffforge-app-control__record_loopspace_step_progress")
        );
        assert!(allowed_tools.contains("mcp__diffforge-app-control__update_selected_document"));
        assert!(args.windows(2).any(|pair| pair[0] == "--mcp-config"));
        assert!(args.iter().any(|arg| arg == "--strict-mcp-config"));
    }

    #[test]
    fn app_control_codex_launch_adds_orchestrator_developer_instructions() {
        let args = terminal_args_with_app_control_mcp_identity(
            "codex",
            &[
                "-c".to_string(),
                "developer_instructions=\"Keep existing app instruction\"".to_string(),
            ],
            "diff-forge",
            &["--app-control-mcp".to_string()],
        )
        .unwrap();

        let developer_instruction_configs = args
            .windows(2)
            .filter_map(|pair| {
                (pair[0] == "-c" || pair[0] == "--config")
                    .then(|| pair[1].strip_prefix("developer_instructions="))
                    .flatten()
            })
            .collect::<Vec<_>>();
        assert_eq!(developer_instruction_configs.len(), 1);
        let prompt = terminal_toml_string_literal_value(developer_instruction_configs[0]).unwrap();
        assert!(prompt.contains("Keep existing app instruction"));
        assert!(prompt.contains("app-control terminal orchestrator"));
        assert!(prompt.contains("make a skill"));
        assert!(prompt.contains("list_docs"));
        assert!(prompt.contains("prepare_doc_draft"));
        assert!(prompt.contains("save_doc"));
        assert!(prompt.contains("list_scripts"));
        assert!(prompt.contains("update_selected_document"));
        assert!(
            prompt.contains("When a Loopspace should send a message to the terminal orchestrator")
        );
        assert!(prompt.contains("send_message action region"));
        assert!(prompt.contains("dispatch_todos action region"));
        assert!(prompt.contains("loopspace_run_context"));
        assert!(prompt.contains("coordination-kernel.start_task"));
        assert!(prompt.contains("target_terminal_mode=\"auto\""));
        assert!(prompt.contains("run identity only"));
        assert!(prompt.contains("trigger.out -> send_message.in"));
        assert!(prompt.contains("step.docs -> document_write.in"));
        assert!(args.iter().any(|arg| {
            arg.contains("mcp_servers.diffforge-app-control.command") && arg.contains("diff-forge")
        }));
        assert!(args.iter().any(|arg| {
            arg.contains(
                "mcp_servers.diffforge-app-control.tools.get_visible_context.approval_mode",
            )
        }));
    }

    #[test]
    fn app_control_opencode_launch_adds_orchestrator_instruction_file() {
        let env_vars = terminal_env_vars_with_app_control_mcp_identity(
            "opencode",
            &[(
                OPENCODE_CONFIG_CONTENT_ENV.to_string(),
                r#"{"instructions":["existing.md"]}"#.to_string(),
            )],
            "diff-forge",
            &["--app-control-mcp".to_string()],
        )
        .unwrap();

        let config = env_vars
            .iter()
            .find_map(|(key, value)| (key == OPENCODE_CONFIG_CONTENT_ENV).then_some(value))
            .unwrap();
        let config = serde_json::from_str::<Value>(config).unwrap();
        let instructions = config["instructions"].as_array().unwrap();
        assert!(instructions
            .iter()
            .any(|value| value.as_str() == Some("existing.md")));
        let instruction_path = instructions
            .iter()
            .filter_map(Value::as_str)
            .find(|value| value.contains("diffforge-app-control"))
            .unwrap();
        let body = fs::read_to_string(instruction_path).unwrap();
        assert!(body.contains("Diff Forge App-Control Orchestrator"));
        assert!(body.contains("modify this selection"));
        assert!(body.contains("update_selected_document"));
        assert_eq!(
            config["mcp"][APP_CONTROL_MCP_SERVER_NAME]["command"][0].as_str(),
            Some("diff-forge")
        );
        // The orchestrator drives the terminal, so it auto-approves its tools
        // even without a coordination session.
        assert_eq!(config["permission"]["edit"].as_str(), Some("allow"));
        assert_eq!(config["permission"]["bash"].as_str(), Some("allow"));
    }

    #[test]
    fn native_plan_update_extracts_provider_plan_tools() {
        let todo = diff_forge_native_plan_update(
            "TodoWrite",
            &json!({"todos": [
                {"content": "Find bug", "status": "completed"},
                {"content": "Fix bug", "status": "in_progress"}
            ]}),
            &json!({}),
        );
        assert_eq!(todo["tool"], "todowrite");
        assert_eq!(todo["steps"].as_array().map(Vec::len), Some(2));
        assert_eq!(todo["steps"][1]["status"], "in_progress");

        let codex = diff_forge_native_plan_update(
            "update_plan",
            &json!({"explanation": "Ship it", "plan": [
                {"step": "Write code", "status": "completed"},
                {"step": "Run tests", "status": "pending"}
            ]}),
            &json!({}),
        );
        assert_eq!(codex["tool"], "update_plan");
        assert_eq!(codex["explanation"], "Ship it");
        assert_eq!(codex["steps"][0]["title"], "Write code");

        let plan_mode = diff_forge_native_plan_update(
            "ExitPlanMode",
            &json!({"plan": "# Fix login\n\n1. Reproduce\n2. Patch handler\n- [x] Write test"}),
            &json!({}),
        );
        assert_eq!(plan_mode["tool"], "exitplanmode");
        assert_eq!(plan_mode["title"], "Fix login");
        assert_eq!(plan_mode["steps"].as_array().map(Vec::len), Some(3));
        assert_eq!(plan_mode["steps"][2]["status"], "completed");
        assert_eq!(plan_mode["steps"][2]["title"], "Write test");

        assert!(
            diff_forge_native_plan_update("Bash", &json!({"command": "ls"}), &json!({})).is_null()
        );
    }

    #[test]
    fn activity_hook_record_carries_plan_update_for_todo_write() {
        let record = diff_forge_activity_hook_record(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "PostToolUse",
                "tool_name": "TodoWrite",
                "tool_input": {"todos": [{"content": "Step one", "status": "pending"}]}
            }),
        );
        assert_eq!(record["plan_update"]["tool"], "todowrite");
        assert_eq!(
            record["plan_update"]["steps"].as_array().map(Vec::len),
            Some(1)
        );

        let plain = diff_forge_activity_hook_record(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "PostToolUse",
                "tool_name": "Bash",
                "tool_input": {"command": "ls"}
            }),
        );
        assert!(plain["plan_update"].is_null());
    }

    #[test]
    fn activity_hook_record_preserves_nested_assistant_delta_text() {
        let record = diff_forge_activity_hook_record(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "AssistantMessageDelta",
                "delta": {"text": "hello from a nested delta"}
            }),
        );
        assert_eq!(
            record["message"].as_str(),
            Some("hello from a nested delta")
        );
        assert_eq!(
            record["assistant_message"].as_str(),
            Some("hello from a nested delta")
        );
    }

    #[test]
    fn activity_hook_record_preserves_exact_assistant_snapshot_text() {
        let table = "| A | B |\n| --- | --- |\n|  one  | two |";
        let record = diff_forge_activity_hook_record(
            "opencode",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hook_event_name": "AssistantMessageDelta",
                "assistant_message_snapshot": table
            }),
        );

        assert_eq!(record["assistant_message_snapshot"].as_str(), Some(table));
    }

    #[test]
    fn activity_hook_record_accepts_camel_case_fields() {
        let record = diff_forge_activity_hook_record(
            "codex",
            "pane-1",
            42,
            "workspace-1",
            "3",
            &json!({
                "hook_event_name": "Stop",
                "session_id": "session-123",
                "turn_id": "turn-456",
                "transcript_path": "/tmp/session.jsonl",
                "user_prompt": "ship it",
                "manual_approval_required": true,
                "session_idle_without_prompt": true,
                "stop_hook_active": true,
                "background_tasks": [{ "id": "task-1" }],
                "session_crons": [{ "id": "cron-1" }],
                "approval_id": "approval-123",
                "prompting_user_kind": "approval",
                "tool_input": {
                    "description": "fallback description"
                }
            }),
        );

        assert_eq!(record["hook_event_name"], "Stop");
        assert_eq!(record["session_id"], "session-123");
        assert_eq!(record["turn_id"], "turn-456");
        assert_eq!(record["transcript_path"], "/tmp/session.jsonl");
        assert_eq!(record["prompt"], "ship it");
        assert_eq!(record["manual_approval_required"], true);
        assert_eq!(record["startup_idle_candidate"], true);
        assert_eq!(record["session_idle_without_prompt"], true);
        assert_eq!(record["stop_hook_active"], true);
        assert_eq!(record["background_tasks"][0]["id"], "task-1");
        assert_eq!(record["session_crons"][0]["id"], "cron-1");
        assert_eq!(record["approval_id"], "approval-123");
        assert_eq!(record["prompting_user_kind"], "approval");
    }

    #[test]
    fn claude_blocking_hooks_fail_closed_without_authenticated_transport() {
        let permission = diff_forge_activity_hook_blocking_fallback_response(&json!({
            "provider": "claude",
            "hook_event_name": "PermissionRequest",
        }))
        .expect("permission fallback");
        assert_eq!(
            permission.pointer("/hookSpecificOutput/decision/behavior"),
            Some(&json!("deny")),
        );

        let elicitation = diff_forge_activity_hook_blocking_fallback_response(&json!({
            "provider": "claude-code",
            "hook_event_name": "Elicitation",
        }))
        .expect("elicitation fallback");
        assert_eq!(
            elicitation.pointer("/hookSpecificOutput/action"),
            Some(&json!("cancel")),
        );

        let permission_denied = diff_forge_activity_hook_blocking_fallback_response(&json!({
            "provider": "claude",
            "hook_event_name": "PermissionDenied",
        }))
        .expect("permission-denied fallback");
        assert_eq!(
            permission_denied.pointer("/hookSpecificOutput/hookEventName"),
            Some(&json!("PermissionDenied")),
        );
        assert_eq!(
            permission_denied.pointer("/hookSpecificOutput/retry"),
            Some(&json!(false)),
        );

        assert!(diff_forge_activity_hook_blocking_fallback_response(&json!({
            "provider": "codex",
            "hook_event_name": "PermissionRequest",
        }))
        .is_none());

        let failure = diff_forge_activity_hook_transport_failure_record(
            &json!({
                "provider": "claude",
                "hook_event_name": "PermissionRequest",
                "session_id": "session-1",
                "turn_id": "turn-1",
                "provider_blocked_for_user": true,
            }),
            "transport timed out",
        );
        assert_eq!(failure["hook_event_name"], json!("TurnError"));
        assert_eq!(
            failure["provider_code"],
            json!("blocking_hook_transport_unavailable")
        );
        assert_eq!(failure["provider_blocked_for_user"], json!(false));
        assert_eq!(failure["terminal_is_prompting_user"], json!(false));
        assert_eq!(failure["session_id"], json!("session-1"));
        assert_eq!(failure["turn_id"], json!("turn-1"));
    }
}

pub fn run_claude_worktree_guard(_args: &[String]) -> i32 {
    0
}

pub fn run_diff_forge_write_guard(_args: &[String]) -> i32 {
    0
}

#[cfg(test)]
#[derive(Debug, Clone, Default)]
struct DiffForgeWriteGuardIdentity;

#[cfg(test)]
impl DiffForgeWriteGuardIdentity {
    fn new(
        _agent_id: Option<String>,
        _session_id: Option<String>,
        _db_path: Option<PathBuf>,
    ) -> Self {
        Self
    }
}

#[cfg(test)]
fn diff_forge_write_guard_decision(
    _provider: &str,
    _hook_input: &Value,
    _coordination_root: &Path,
    _slot_key: &str,
    _agent_kind: &str,
    _identity: &DiffForgeWriteGuardIdentity,
) -> Result<Option<Value>, String> {
    Ok(None)
}

#[cfg(test)]
fn claude_worktree_guard_denial_reason(
    _hook_input: &Value,
    _repo_path: &Path,
    _worktree_path: &Path,
    _slot_key: &str,
    _identity: &DiffForgeWriteGuardIdentity,
) -> Option<String> {
    None
}

#[cfg(test)]
#[derive(Debug, Clone)]
struct DiffForgeGitWriteRoute;

#[cfg(test)]
fn diff_forge_git_write_route(
    _candidate_path: &Path,
    _slot_key: &str,
    _agent_kind: &str,
    _identity: &DiffForgeWriteGuardIdentity,
    _require_lease: bool,
) -> Result<Option<DiffForgeGitWriteRoute>, String> {
    Ok(None)
}

fn terminal_cli_arg_value<'a>(args: &'a [String], key: &str) -> Option<&'a str> {
    let inline_prefix = format!("{key}=");
    let mut index = 0;
    while index < args.len() {
        let arg = args[index].as_str();
        if arg == key {
            return args.get(index + 1).map(String::as_str);
        }
        if let Some(value) = arg.strip_prefix(&inline_prefix) {
            return Some(value);
        }
        index += 1;
    }
    None
}

fn terminal_cli_arg_or_env(args: &[String], key: &str, env_keys: &[&str]) -> Option<String> {
    terminal_cli_arg_value(args, key)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            env_keys.iter().find_map(|env_key| {
                env::var(env_key)
                    .ok()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
            })
        })
}

fn claude_guard_collect_tool_paths(value: &Value, paths: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if matches!(
                    key.as_str(),
                    "file_path"
                        | "filePath"
                        | "path"
                        | "filename"
                        | "file"
                        | "notebook_path"
                        | "notebookPath"
                ) {
                    if let Some(path) = value.as_str().filter(|path| !path.trim().is_empty()) {
                        paths.push(path.to_string());
                    }
                }
                if matches!(value, Value::Array(_) | Value::Object(_)) {
                    claude_guard_collect_tool_paths(value, paths);
                }
            }
        }
        Value::Array(values) => {
            for value in values {
                claude_guard_collect_tool_paths(value, paths);
            }
        }
        _ => {}
    }
}

fn claude_coordination_mcp_config_arg(
    coordination: &TerminalCoordinationSession,
    coordination_args: &[String],
) -> String {
    if let Some(path) = claude_coordination_mcp_config_path_arg(coordination) {
        inject_claude_workspace_gateway_bridge_env(&path, coordination, coordination_args);
        return path;
    }

    let gateway_args = terminal_workspace_gateway_args_from_coordination_args(coordination_args);
    let gateway_environment =
        Value::Object(terminal_workspace_gateway_environment(Some(coordination)));
    json!({
        "mcpServers": {
            "coordination-kernel": {
                "command": coordination.mcp_command.clone(),
                "args": coordination_args,
                "env": {
                    "COORDINATION_ENABLED": "1",
                    "COORDINATION_REPO_PATH": coordination.repo_path.clone(),
                    "COORDINATION_DB_PATH": coordination.db_path.clone(),
                    "COORDINATION_AGENT_ID": coordination.agent_id.clone(),
                    "COORDINATION_SESSION_ID": coordination.session_id.clone(),
                    "COORDINATION_TERMINAL_LAUNCH_EPOCH": coordination.terminal_launch_epoch.clone().unwrap_or_default(),
                    "COORDINATION_MCP_ALWAYS_ON": "1"
                },
                "diffforge": {
                    "scope": "terminal-session",
                    "always_on": true,
                    "toggleable": false,
                    "identity_source": "terminal_launch_args",
                    "authority": "local_coordination_kernel"
                }
            },
            "workspace-mcp-gateway": {
                "command": coordination.mcp_command.clone(),
                "args": gateway_args,
                "env": gateway_environment,
                "diffforge": {
                    "scope": "terminal-session",
                    "always_on": true,
                    "toggleable": false,
                    "identity_source": "terminal_launch_args",
                    "authority": "workspace_mcp_gateway"
                }
            }
        }
    })
    .to_string()
}

fn inject_claude_workspace_gateway_bridge_env(
    path: &str,
    coordination: &TerminalCoordinationSession,
    coordination_args: &[String],
) {
    if terminal_app_bridge_env_vars().is_empty() {
        return;
    }
    let path = PathBuf::from(path);
    let Ok(body) = fs::read_to_string(&path) else {
        return;
    };
    let Ok(mut config) = serde_json::from_str::<Value>(&body) else {
        return;
    };
    let Some(config_object) = config.as_object_mut() else {
        return;
    };
    let mcp_servers = config_object
        .entry("mcpServers".to_string())
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    let Some(mcp_servers) = mcp_servers.as_object_mut() else {
        return;
    };
    let gateway_args = terminal_workspace_gateway_args_from_coordination_args(coordination_args);
    let gateway = mcp_servers
        .entry("workspace-mcp-gateway".to_string())
        .or_insert_with(|| {
            json!({
                "command": coordination.mcp_command.clone(),
                "args": gateway_args,
                "diffforge": {
                    "scope": "terminal-session",
                    "always_on": true,
                    "toggleable": false,
                    "identity_source": "terminal_launch_args",
                    "authority": "workspace_mcp_gateway"
                }
            })
        });
    let Some(gateway_object) = gateway.as_object_mut() else {
        return;
    };
    let environment = gateway_object
        .entry("env".to_string())
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    let Some(environment) = environment.as_object_mut() else {
        return;
    };
    for (key, value) in terminal_workspace_gateway_environment(Some(coordination)) {
        environment.insert(key, value);
    }
    if let Ok(serialized) = serde_json::to_vec_pretty(&config) {
        let _ = fs::write(&path, serialized);
    }
}

fn claude_coordination_mcp_config_path_arg(
    coordination: &TerminalCoordinationSession,
) -> Option<String> {
    [
        "CLAUDE_MCP_CONFIG",
        "CLAUDE_CODE_MCP_CONFIG",
        "COORDINATION_MCP_CONFIG_PATH",
        "MCP_CONFIG_PATH",
    ]
    .iter()
    .find_map(|key| terminal_coordination_env_value(coordination, key))
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

const OPENCODE_ACTIVITY_HOOK_BIN_ENV: &str = "DIFFFORGE_OPENCODE_ACTIVITY_HOOK_BIN";

// OpenCode plugin that bridges OpenCode's lifecycle events to the Diff Forge
// activity hook CLI, exactly like the Claude (settings.json) and Codex
// (hooks.json) hooks do. OpenCode does not run command hooks natively, but it
// loads JS plugins (see `@opencode-ai/plugin`); a plugin may spawn processes,
// so we shell out to `<bin> --diff-forge-activity-hook --provider opencode`
// with the same JSON-on-stdin contract the other harnesses use. The hook CLI
// reads pane/instance/workspace/transport identity from the env vars the app
// already stamps on every managed terminal (see terminal_activity_env_vars),
// so this needs no per-event identity wiring. Emitting `Stop` on
// `session.idle` is what lets a finished OpenCode turn settle to idle instead
// of being swept to "interrupted".
const DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS: &str = r#"// Diff Forge managed OpenCode activity plugin. Auto-generated — do not edit.
import { spawn } from "node:child_process";

const HOOK_BIN = process.env.DIFFFORGE_OPENCODE_ACTIVITY_HOOK_BIN || "";
const PROVIDER = "opencode";
const IDLE_STOP_DELAY_MS = 1500;
const HOOK_EMIT_TIMEOUT_MS = 5000;
	const emitQueues = new Map();
	const lastAssistantTextByMessage = new Map();
	const lastAssistantTextBySession = new Map();
	const assistantTextPartsByMessage = new Map();
const messageRolesById = new Map();
const submittedUserMessages = new Set();

function clearAssistantTextForSession(sessionId) {
  if (!sessionId) return;
  lastAssistantTextBySession.delete(sessionId);
  for (const key of Array.from(lastAssistantTextByMessage.keys())) {
    if (key.startsWith(`${sessionId}:`)) {
      lastAssistantTextByMessage.delete(key);
    }
  }
	  for (const key of Array.from(assistantTextPartsByMessage.keys())) {
	    if (key.startsWith(`${sessionId}:`)) {
	      assistantTextPartsByMessage.delete(key);
	    }
	  }
  for (const key of Array.from(messageRolesById.keys())) {
    if (key.startsWith(`${sessionId}:`)) {
      messageRolesById.delete(key);
    }
  }
  for (const key of Array.from(submittedUserMessages.keys())) {
    if (key.startsWith(`${sessionId}:`)) {
      submittedUserMessages.delete(key);
    }
  }
	}

function spawnHook(payload) {
  if (!HOOK_BIN) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        const text = stdout.trim();
        resolve(text ? JSON.parse(text.split(/\r?\n/).filter(Boolean).at(-1)) : null);
      } catch {
        resolve(null);
      }
    };
    try {
      const child = spawn(HOOK_BIN, ["--diff-forge-activity-hook", "--provider", PROVIDER], {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
      child.stdout.on("data", (chunk) => {
        if (stdout.length < 64 * 1024) stdout += String(chunk || "");
      });
      const hookName = String((payload && payload.hook_event_name) || "").toLowerCase();
      const waitsForUser = hookName === "permissionrequest" || hookName === "userpromptrequired";
      const timeout = setTimeout(() => {
        try { child.kill(); } catch {}
        finish();
      }, waitsForUser ? 590000 : HOOK_EMIT_TIMEOUT_MS);
      const done = () => {
        clearTimeout(timeout);
        finish();
      };
      child.on("close", done);
      child.on("exit", done);
      child.on("error", done);
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(payload || {}));
    } catch {
      finish();
    }
  });
}

function emit(payload) {
  if (!HOOK_BIN) return Promise.resolve(null);
  const hookName = String((payload && payload.hook_event_name) || "").toLowerCase();
  const sessionKey = (payload && payload.session_id) || "global";
  const previous = emitQueues.get(sessionKey) || Promise.resolve();
  if (hookName === "permissionrequest" || hookName === "userpromptrequired") {
    // Never head-of-line block the provider's resolution event behind a UIR
    // request that is intentionally waiting for the user. Native TUI, web,
    // and push answers must be able to race and resolve one interaction. The
    // request still waits for already-enqueued session lifecycle events, so a
    // prior idle Stop cannot be overtaken by the prompt it predates.
    return previous.catch(() => {}).then(() => spawnHook(payload));
  }
  const next = previous.catch(() => {}).then(() => spawnHook(payload));
  emitQueues.set(sessionKey, next);
  next.finally(() => {
    if (emitQueues.get(sessionKey) === next) emitQueues.delete(sessionKey);
  });
  return next;
}

async function opencodeFetch(serverUrl, path, body, method = "POST") {
  if (!serverUrl || typeof fetch !== "function") return false;
  const options = { method };
  if (method !== "GET") {
    options.headers = { "content-type": "application/json" };
    options.body = JSON.stringify(body || {});
  }
  const response = await fetch(`${String(serverUrl).replace(/\/$/, "")}${path}`, options);
  if (!response.ok) throw new Error(`OpenCode API ${path} returned ${response.status}`);
  return method === "GET" ? response.json() : true;
}

async function replyOpenCodePermission(client, serverUrl, sessionId, requestId, reply) {
  const id = encodeURIComponent(requestId);
  const api = client && client.permission && client.permission.reply;
  if (typeof api === "function") {
    try {
      await api({ path: { requestID: requestId }, body: { reply }, throwOnError: true });
      return;
    } catch {}
  }
  const authenticatedTransport = client && client._client;
  if (authenticatedTransport && typeof authenticatedTransport.post === "function") {
    try {
      await authenticatedTransport.post({
        url: "/permission/{requestID}/reply",
        path: { requestID: requestId },
        body: { reply },
        throwOnError: true,
      });
      return;
    } catch {}
  }
  const legacyApi = client && client.postSessionIdPermissionsPermissionId;
  if (sessionId && typeof legacyApi === "function") {
    try {
      await legacyApi.call(client, {
        path: { id: sessionId, permissionID: requestId },
        body: { response: reply },
        throwOnError: true,
      });
      return;
    } catch {}
  }
  try {
    if (await opencodeFetch(serverUrl, `/permission/${id}/reply`, { reply })) return;
  } catch {}
  if (sessionId) {
    try {
      if (await opencodeFetch(
        serverUrl,
        `/session/${encodeURIComponent(sessionId)}/permissions/${id}`,
        { response: reply }
      )) return;
    } catch {}
  }
  throw new Error("OpenCode permission reply API is unavailable.");
}

async function replyOpenCodeQuestion(client, serverUrl, requestId, response) {
  const id = encodeURIComponent(requestId);
  const authenticatedTransport = client && client._client;
  if (response && response.rejected) {
    const reject = client && client.question && client.question.reject;
    if (typeof reject === "function") {
      try {
        await reject({ path: { requestID: requestId }, throwOnError: true });
        return;
      } catch {}
    }
    if (authenticatedTransport && typeof authenticatedTransport.post === "function") {
      try {
        await authenticatedTransport.post({
          url: "/question/{requestID}/reject",
          path: { requestID: requestId },
          body: {},
          throwOnError: true,
        });
        return;
      } catch {}
    }
    try {
      if (await opencodeFetch(serverUrl, `/question/${id}/reject`, {})) return;
    } catch {}
    throw new Error("OpenCode question rejection API is unavailable.");
  }
  const answers = response && Array.isArray(response.answers) ? response.answers : [];
  const reply = client && client.question && client.question.reply;
  if (typeof reply === "function") {
    try {
      await reply({ path: { requestID: requestId }, body: { answers }, throwOnError: true });
      return;
    } catch {}
  }
  if (authenticatedTransport && typeof authenticatedTransport.post === "function") {
    try {
      await authenticatedTransport.post({
        url: "/question/{requestID}/reply",
        path: { requestID: requestId },
        body: { answers },
        throwOnError: true,
      });
      return;
    } catch {}
  }
  try {
    if (await opencodeFetch(serverUrl, `/question/${id}/reply`, { answers })) return;
  } catch {}
  throw new Error("OpenCode question reply API is unavailable.");
}

	function pickText(parts) {
	  if (!Array.isArray(parts)) return "";
  const texts = [];
  for (const part of parts) {
    const text = part && (part.text != null ? part.text : part.content);
    if (typeof text === "string" && text.length > 0) texts.push(text);
  }
	  return texts.join("\n");
	}

function textFromMessage(message) {
  if (!message || typeof message !== "object") return "";
  if (typeof message.text === "string") return message.text;
  if (typeof message.content === "string") return message.content;
  return pickText(message.parts || message.content || []);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function pickDeltaText(value) {
  if (!value || typeof value !== "object") return "";
  for (const key of ["delta", "textDelta", "contentDelta", "messageDelta"]) {
    const candidate = value[key];
    if (nonEmptyString(candidate)) return candidate;
    if (candidate && typeof candidate === "object") {
      const nested = pickDeltaText(candidate) || pickText([candidate]);
      if (nested) return nested;
    }
  }
  return "";
}

function eventSessionId(event) {
  const props = (event && event.properties) || {};
  return (
    props.sessionID
    || props.session_id
    || (props.info && (props.info.sessionID || props.info.id))
    || (props.session && props.session.id)
    || ""
  );
}

function statusText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase();
  }
  if (typeof value === "object") {
    return String(value.type || value.phase || value.state || value.status || value.reason || "").toLowerCase();
  }
  return "";
}

function completionFlag(value) {
  const text = statusText(value);
  return text === "true"
    || text === "1"
    || text === "complete"
    || text === "completed"
    || text === "done"
    || text === "finish"
    || text === "finished"
    || text === "success"
    || text === "succeeded"
    || text === "stop"
    || text === "stopped";
}

function assistantMessageCompleted(message, props) {
  const time = (message && message.time) || (props && props.time) || {};
  if (time.completed || time.completedAt || time.completed_at) return true;
  for (const source of [message || {}, props || {}]) {
    if (completionFlag(source.completed)
      || completionFlag(source.done)
      || completionFlag(source.finished)
      || completionFlag(source.complete)
      || completionFlag(source.finish)
      || completionFlag(source.status)
      || completionFlag(source.state)
      || completionFlag(source.phase)
      || completionFlag(source.finishReason)
      || completionFlag(source.finish_reason)
      || completionFlag(source.stopReason)
      || completionFlag(source.stop_reason)
      || completionFlag(source.completedAt)
      || completionFlag(source.completed_at)) {
      return true;
    }
  }
  return false;
}

function assistantMessageCompletionKey(sessionId, message, props) {
  const key = (message && (message.id || message.messageID || message.messageId))
    || (props && (props.id || props.messageID || props.messageId));
  return key ? `${sessionId || "session"}:${key}` : "";
}

function textualPartKind(part) {
  const kind = String((part && (part.type || part.kind)) || "").toLowerCase();
  return kind === "text" || kind === "reasoning" ? kind : "";
}

function partText(part) {
  if (!part || typeof part !== "object") return "";
  return typeof part.text === "string" ? part.text : pickText([part]);
}

	function messageIdForPart(props, part) {
  const message = (props && (props.message || props.info)) || {};
  return (part && (part.messageID || part.messageId || part.message_id))
    || (props && (props.messageID || props.messageId || props.message_id))
    || (message && (message.id || message.messageID || message.messageId || message.message_id))
	    || "";
	}

function messageIdForMessage(message, props) {
  return (message && (message.id || message.messageID || message.messageId || message.message_id))
    || (props && (props.id || props.messageID || props.messageId || props.message_id))
    || "";
}

function normalizedMessageRole(value) {
  const role = String((value && (value.role || value.authorRole || value.author_role || value.type)) || "").toLowerCase();
  return role === "assistant" || role === "user" ? role : "";
}

function rememberMessageRole(sessionId, message, props) {
  const messageId = messageIdForMessage(message, props);
  const role = normalizedMessageRole(message) || normalizedMessageRole(props && props.info);
  if (sessionId && messageId && role) {
    messageRolesById.set(`${sessionId}:${messageId}`, role);
    messageRolesById.set(messageId, role);
  }
  return role;
}

function messageRoleForPart(sessionId, props, part) {
  const role = normalizedMessageRole(part && part.message)
    || normalizedMessageRole(props && props.message)
    || normalizedMessageRole(props && props.info)
    || normalizedMessageRole(part);
  if (role) return role;
  const messageId = messageIdForPart(props, part);
  if (!messageId) return "";
  return messageRolesById.get(`${sessionId}:${messageId}`) || messageRolesById.get(messageId) || "";
}

function partKey(sessionId, messageId, partId) {
  return sessionId && partId ? `${sessionId}:${messageId || "message"}:${partId}` : "";
}

function userPromptSubmitKeys(sessionId, messageId, prompt, reason) {
  const scope = sessionId || "session";
  const keys = [];
  if (nonEmptyString(prompt)) keys.push(`${scope}:prompt:${prompt}`);
  if (nonEmptyString(messageId)) keys.push(`${scope}:message:${messageId}`);
  const fallback = messageId || prompt || reason || "";
  if (fallback) keys.push(`${scope}:${fallback}`);
  return keys;
}

function userPromptAlreadySubmitted(keys) {
  return keys.some((key) => submittedUserMessages.has(key));
}

function rememberUserPromptSubmitted(keys) {
  keys.forEach((key) => submittedUserMessages.add(key));
}

function rememberAssistantText(sessionId, messageId, text, snapshot) {
  if (!nonEmptyString(text) || !sessionId) return;
  const messageKey = `${sessionId}:${messageId || "message"}`;
  let nextText = text;
  if (!snapshot && lastAssistantTextByMessage.has(messageKey)) {
    nextText = `${lastAssistantTextByMessage.get(messageKey)}${text}`;
  }
  lastAssistantTextByMessage.set(messageKey, nextText);
  lastAssistantTextBySession.set(sessionId, nextText);
}

function rememberAssistantPartSnapshot(sessionId, messageId, partId, text) {
  if (!nonEmptyString(text) || !sessionId) return text;
  const messageKey = `${sessionId}:${messageId || "message"}`;
  let parts = assistantTextPartsByMessage.get(messageKey);
  if (!parts) {
    parts = new Map();
    assistantTextPartsByMessage.set(messageKey, parts);
  }
  const partStorageId = partId || `part-${parts.size}`;
  if (parts.get(partStorageId) === text) return "";
  parts.set(partStorageId, text);
  const nextText = Array.from(parts.values()).join("\n");
  lastAssistantTextByMessage.set(messageKey, nextText);
  lastAssistantTextBySession.set(sessionId, nextText);
  return nextText;
}

function emitPartText(sessionId, kind, text, snapshot, messageId, partId) {
  if (!nonEmptyString(text)) return false;
  const outputText = kind === "text" && snapshot
    ? rememberAssistantPartSnapshot(sessionId, messageId, partId, text)
    : text;
  if (!nonEmptyString(outputText)) return false;
  if (!(kind === "text" && snapshot)) {
    rememberAssistantText(sessionId, messageId, text, snapshot);
  }
  if (kind === "reasoning") {
    emit({
      hook_event_name: "ReasoningDelta",
      session_id: sessionId,
      message_id: messageId || "",
      [snapshot ? "reasoning_snapshot" : "reasoning_delta"]: outputText,
    });
    return true;
  }
  if (kind === "text") {
    emit({
      hook_event_name: "AssistantMessageDelta",
      session_id: sessionId,
      message_id: messageId || "",
      [snapshot ? "assistant_message_snapshot" : "assistant_delta"]: outputText,
    });
    return true;
  }
  return false;
}

export const DiffForgeActivityPlugin = async ({ client, serverUrl } = {}) => {
  // Track which sessions have an in-flight turn so a stray, startup, duplicate,
  // or child/sub-agent `session.idle` cannot settle the wrong turn: we only
  // emit `Stop` for a session we actually observed a prompt for. Keyed by
  // session id (not a single flag) because OpenCode fires session.idle for
  // sub-sessions too.
  const activeSessions = new Map();
  const completedAssistantMessages = new Set();
  const pendingStopTimers = new Map();
  const partKinds = new Map();
  const HANDLED_INTERACTION_DEDUPE_TTL_MS = 90_000;
  const NATIVE_RESULT_REVALIDATION_TIMEOUT_MS = 90_000;
  const handledInteractionIds = new Map();
  const pendingInteractionIds = new Map();
  const interactionGenerations = new Map();
  const interactionRevalidationTimers = new Set();
  const nativeInteractionResolutionRevalidations = new Map();
  let lastInteractionRevision = 0;
  let lastHandledInteractionToken = 0;
  const rememberInteractionGeneration = (key, sessionId, kind, requestId, askFingerprint = "") => {
    if (!key) return {};
    lastInteractionRevision = Math.max(lastInteractionRevision + 1, Date.now() * 1000);
    const generation = {
      interaction_id: `uir:opencode:${sessionId}:${kind}:${requestId}:${lastInteractionRevision}`,
      interaction_revision: lastInteractionRevision,
      ask_fingerprint: askFingerprint,
    };
    const queued = interactionGenerations.get(key) || [];
    queued.push(generation);
    interactionGenerations.set(key, queued.slice(-32));
    return generation;
  };
  const takeInteractionGeneration = (key) => {
    if (!key) return {};
    const queued = interactionGenerations.get(key) || [];
    const generation = queued.shift() || {};
    if (queued.length) interactionGenerations.set(key, queued);
    else interactionGenerations.delete(key);
    return generation;
  };
  const retireInteractionGeneration = (key, interactionId) => {
    if (!key || !interactionId) return;
    const queued = interactionGenerations.get(key) || [];
    const remaining = queued.filter(
      (candidate) => candidate.interaction_id !== interactionId,
    );
    if (remaining.length) interactionGenerations.set(key, remaining);
    else interactionGenerations.delete(key);
  };
  const interactionAskFingerprintValue = (value) => {
    if (Array.isArray(value)) return value.map(interactionAskFingerprintValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, interactionAskFingerprintValue(value[key])])
    );
  };
  const interactionAskFingerprint = (props) => {
    try {
      return JSON.stringify(interactionAskFingerprintValue(props || {}));
    } catch {
      return "";
    }
  };
  const rememberHandledInteraction = (key, fingerprint = "") => {
    if (!key) return 0;
    if (handledInteractionIds.size >= 2048) handledInteractionIds.clear();
    const previous = handledInteractionIds.get(key);
    lastHandledInteractionToken += 1;
    handledInteractionIds.set(key, {
      fingerprint: fingerprint || previous?.fingerprint || "",
      observedAt: Date.now(),
      token: lastHandledInteractionToken,
    });
    return lastHandledInteractionToken;
  };
  const handledInteractionRecently = (key, fingerprint = "") => {
    if (!key) return false;
    const handled = handledInteractionIds.get(key);
    if (!handled || !Number.isFinite(handled.observedAt)) return false;
    if (Date.now() - handled.observedAt >= HANDLED_INTERACTION_DEDUPE_TTL_MS) {
      handledInteractionIds.delete(key);
      return false;
    }
    if (fingerprint && handled.fingerprint && fingerprint !== handled.fingerprint) {
      // Same provider request id, but a different ask payload: this is a new
      // lifecycle, not a replay of the generation that was just answered.
      handledInteractionIds.delete(key);
      return false;
    }
    return true;
  };
  const forgetHandledInteractionIfCurrent = (key, token) => {
    if (!key || !token) return;
    if (handledInteractionIds.get(key)?.token === token) {
      handledInteractionIds.delete(key);
    }
  };
  let startupIdleCandidateEmitted = false;
  const cancelPendingStop = (sessionId) => {
    if (!sessionId) return;
    const timer = pendingStopTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      pendingStopTimers.delete(sessionId);
    }
  };
  const activeTurn = (sessionId) => {
    if (!sessionId) return null;
    const turn = activeSessions.get(sessionId);
    return turn && !turn.settled ? turn : null;
  };
	  const startTurn = (sessionId, reason = "chat.message") => {
	    if (!sessionId) return null;
	    cancelPendingStop(sessionId);
	    const previous = activeSessions.get(sessionId) || {};
	    const next = {
      implicit: reason !== "chat.message",
      reason,
	      settled: false,
	      turn_id: (previous.turn_id || 0) + 1,
	      pending_extra: {},
	    };
	    activeSessions.set(sessionId, next);
	    return next;
	  };
  const ensureTurn = (sessionId, reason = "activity") => {
    if (!sessionId) return null;
    const existing = activeTurn(sessionId);
    if (existing) {
      cancelPendingStop(sessionId);
      return existing;
    }
    return startTurn(sessionId, reason);
  };
	  const noteActivity = (sessionId, reason = "activity") => {
	    if (ensureTurn(sessionId, reason)) cancelPendingStop(sessionId);
	  };
  const emitUserPromptFromMessage = (sessionId, message, props, reason = "message") => {
    if (!sessionId) return;
    const messageId = messageIdForMessage(message, props);
    const prompt = textFromMessage(message);
    const submitKeys = userPromptSubmitKeys(sessionId, messageId, prompt, reason);
    if (userPromptAlreadySubmitted(submitKeys)) return;
    ensureTurn(sessionId, reason);
    clearAssistantTextForSession(sessionId);
    rememberUserPromptSubmitted(submitKeys);
    emit({
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      prompt,
    });
  };
  const rememberStopCandidate = (sessionId, extra = {}) => {
    const turn = activeTurn(sessionId);
    if (!turn) return null;
    turn.pending_extra = {
      ...(turn.pending_extra || {}),
      ...(extra || {}),
    };
    activeSessions.set(sessionId, turn);
    return turn;
  };
  const emitStop = (sessionId, extra = {}) => {
    if (!sessionId) return;
    const turn = activeTurn(sessionId);
    if (!turn) return;
    cancelPendingStop(sessionId);
    turn.settled = true;
    activeSessions.set(sessionId, turn);
    const rememberedAssistantText = sessionId ? lastAssistantTextBySession.get(sessionId) : "";
    const stopExtra = {
      ...(turn.pending_extra || {}),
      ...(extra || {}),
    };
    emit({
      hook_event_name: "Stop",
      session_id: sessionId,
      startup_idle_candidate: false,
      session_idle_without_prompt: false,
      ...(rememberedAssistantText
        && !stopExtra.assistant_message
        && !stopExtra.assistant_message_snapshot
        ? { assistant_message_snapshot: rememberedAssistantText }
        : {}),
      ...stopExtra,
    });
  };
  const emitStartupIdleCandidate = (sessionId, source = "startup-idle") => {
    if (startupIdleCandidateEmitted) return;
    startupIdleCandidateEmitted = true;
    emit({
      hook_event_name: "Stop",
      session_id: sessionId || "",
      startup_idle_candidate: true,
      session_idle_without_prompt: true,
      opencode_idle_source: source,
      input_ready: true,
    });
  };
  const scheduleStop = (sessionId, extra = {}) => {
    if (!sessionId || !rememberStopCandidate(sessionId, extra)) return;
    cancelPendingStop(sessionId);
    const timer = setTimeout(() => {
      pendingStopTimers.delete(sessionId);
      emitStop(sessionId, extra);
    }, IDLE_STOP_DELAY_MS);
    pendingStopTimers.set(sessionId, timer);
  };
  const scheduleIdle = (sessionId, source) => {
    if (sessionId && activeTurn(sessionId)) {
      scheduleStop(sessionId, { opencode_idle_source: source });
      return;
    }
    setTimeout(() => emitStartupIdleCandidate(sessionId, source), IDLE_STOP_DELAY_MS);
  };
  const handlePendingPermission = async (sessionId, requestId, props = {}, askFingerprint = "") => {
    noteActivity(sessionId, "permission.asked");
    const interactionKey = requestId ? `${sessionId}:permission:${requestId}` : "";
    if (interactionKey && (handledInteractionRecently(interactionKey, askFingerprint) || pendingInteractionIds.has(interactionKey))) return;
    if (interactionKey) pendingInteractionIds.set(interactionKey, "starting");
    let interactionGeneration = {};
    try {
      interactionGeneration = rememberInteractionGeneration(
        interactionKey,
        sessionId,
        "permission",
        requestId,
        askFingerprint,
      );
      if (interactionKey) {
        pendingInteractionIds.set(
          interactionKey,
          interactionGeneration.interaction_id || "starting",
        );
      }
      const response = await emit({
        hook_event_name: "PermissionRequest",
        session_id: sessionId,
        manual_approval_required: true,
        permission_request_id: requestId,
        tool_use_id: props.callID || props.callId || props.toolCallID || props.toolCallId || props.tool?.callID || props.tool?.callId || "",
        tool_name: props.permission || props.type || props.tool || "",
        description: props.title || props.description || props.metadata?.title || "",
        provider_payload: props,
        interaction_id: interactionGeneration.interaction_id,
        interaction_revision: interactionGeneration.interaction_revision,
        prompt_default_option: "reject",
        prompt_options: [
          ["allow_once", "Allow once"],
          ["allow_always", "Allow always"],
          ["reject", "Reject"]
        ],
      });
      if (requestId && response && response.reply) {
        try {
          await replyOpenCodePermission(client, serverUrl, sessionId, requestId, response.reply);
          retireInteractionGeneration(
            interactionKey,
            interactionGeneration.interaction_id,
          );
          rememberHandledInteraction(interactionKey, askFingerprint);
          emit({
            hook_event_name: "PermissionResult",
            session_id: sessionId,
            permission_request_id: requestId,
            permission_decision: response.reply,
            resolved_interaction_id: response._diffforge_interaction_id,
            resolved_interaction_revision: response._diffforge_interaction_revision,
          });
        } catch (error) {
          emit({
            hook_event_name: "StopFailure",
            session_id: sessionId,
            error_code: "permission_reply_failed",
            error: String((error && error.message) || error || "OpenCode permission reply failed."),
            interaction_id: interactionGeneration.interaction_id,
            interaction_revision: interactionGeneration.interaction_revision,
            retryable: true,
          });
        }
      }
    } finally {
      const pendingGeneration = interactionKey
        ? pendingInteractionIds.get(interactionKey)
        : "";
      if (
        interactionKey
        && (pendingGeneration === "starting"
          || pendingGeneration === interactionGeneration.interaction_id)
      ) {
        pendingInteractionIds.delete(interactionKey);
      }
    }
  };
  const pendingPermissionsFromResponse = (response) => {
    if (Array.isArray(response)) return response;
    if (!response || typeof response !== "object") return [];
    for (const key of ["data", "permissions", "items", "result", "body"]) {
      if (Array.isArray(response[key])) return response[key];
    }
    return [];
  };
  const pendingQuestionsFromResponse = (response) => {
    if (Array.isArray(response)) return response;
    if (!response || typeof response !== "object") return [];
    for (const key of ["data", "items", "result", "body", "requests"]) {
      if (Array.isArray(response[key])) return response[key];
    }
    return [];
  };
  const providerInteractionStillPending = async (kind, sessionId, requestId) => {
    let response;
    if (kind === "permission") {
      if (client && client.permission && typeof client.permission.list === "function") {
        try {
          response = await client.permission.list();
          if (response && response.error) throw response.error;
        } catch {
          response = await opencodeFetch(serverUrl, "/permission", undefined, "GET");
        }
      } else {
        response = await opencodeFetch(serverUrl, "/permission", undefined, "GET");
      }
      return pendingPermissionsFromResponse(response).some((permission) => {
        const props = permission && typeof permission === "object" ? permission : {};
        const pendingSessionId = props.sessionID || props.sessionId || props.session_id || props.session?.id || "";
        const pendingRequestId = props.id || props.permissionID || props.permissionId || props.requestID || props.requestId || "";
        return pendingSessionId === sessionId && pendingRequestId === requestId;
      });
    }
    if (client && client.question && typeof client.question.list === "function") {
      try {
        response = await client.question.list();
        if (response && response.error) throw response.error;
      } catch {
        response = await opencodeFetch(serverUrl, "/question", undefined, "GET");
      }
    } else {
      response = await opencodeFetch(serverUrl, "/question", undefined, "GET");
    }
    return pendingQuestionsFromResponse(response).some((question) => {
      const props = question && typeof question === "object" ? question : {};
      const pendingSessionId = props.sessionID || props.sessionId || props.session_id || props.session?.id || "";
      const pendingRequestId = props.id || props.questionID || props.questionId || props.requestID || props.requestId || "";
      return pendingSessionId === sessionId && pendingRequestId === requestId;
    });
  };
  const finishNativeInteractionResolution = (record) => {
    if (
      !record
      || nativeInteractionResolutionRevalidations.get(record.interaction_key) !== record
    ) return;
    const queued = interactionGenerations.get(record.interaction_key) || [];
    if (
      !queued.length
      || queued[0].interaction_id !== record.interaction_id
    ) {
      nativeInteractionResolutionRevalidations.delete(record.interaction_key);
      return;
    }
    nativeInteractionResolutionRevalidations.delete(record.interaction_key);
    const resolution = takeInteractionGeneration(record.interaction_key);
    const newerGenerationQueued = (
      interactionGenerations.get(record.interaction_key) || []
    ).length > 0;
    const pendingGeneration = pendingInteractionIds.get(record.interaction_key) || "";
    const resolutionOwnsPending = !pendingGeneration
      || pendingGeneration === resolution.interaction_id;
    if (record.request_id && !newerGenerationQueued && resolutionOwnsPending) {
      const handledToken = rememberHandledInteraction(
        record.interaction_key,
        resolution.ask_fingerprint,
      );
      if (record.interaction_kind === "question") {
        scheduleHandledQuestionRevalidation(
          record.session_id,
          record.request_id,
          record.interaction_key,
          handledToken,
        );
      }
      if (pendingGeneration === resolution.interaction_id) {
        pendingInteractionIds.delete(record.interaction_key);
      }
    }
    emit({
      hook_event_name: record.type === "permission.replied" ? "PermissionResult" : "ElicitationResult",
      session_id: record.session_id,
      permission_request_id: record.request_id,
      decision: record.type.endsWith("rejected")
        || String(record.props.reply || record.props.response || "").toLowerCase() === "reject"
        ? "rejected"
        : "accepted",
      permission_decision: record.props.reply || record.props.response || "",
      provider_payload: record.props,
      resolved_interaction_id: resolution.interaction_id,
      resolved_interaction_revision: resolution.interaction_revision,
    });
  };
  const scheduleNativeInteractionResolutionRevalidation = (record) => {
    if (
      !record
      || nativeInteractionResolutionRevalidations.get(record.interaction_key) !== record
      || record.timer
      || record.in_flight
    ) return;
    const delayMs = Math.min(2_000, 250 * (2 ** Math.min(record.attempt, 3)));
    const timer = setTimeout(async () => {
      interactionRevalidationTimers.delete(timer);
      if (record.timer === timer) record.timer = null;
      if (nativeInteractionResolutionRevalidations.get(record.interaction_key) !== record) return;
      const queued = interactionGenerations.get(record.interaction_key) || [];
      if (!queued.length || queued[0].interaction_id !== record.interaction_id) {
        nativeInteractionResolutionRevalidations.delete(record.interaction_key);
        return;
      }
      record.in_flight = true;
      const version = record.version;
      try {
        const currentStillPending = await providerInteractionStillPending(
          record.interaction_kind,
          record.session_id,
          record.request_id,
        );
        record.in_flight = false;
        if (nativeInteractionResolutionRevalidations.get(record.interaction_key) !== record) return;
        const currentQueue = interactionGenerations.get(record.interaction_key) || [];
        if (!currentQueue.length || currentQueue[0].interaction_id !== record.interaction_id) {
          nativeInteractionResolutionRevalidations.delete(record.interaction_key);
          return;
        }
        if (version !== record.version) {
          scheduleNativeInteractionResolutionRevalidation(record);
          return;
        }
        if (!currentStillPending) {
          finishNativeInteractionResolution(record);
          return;
        }
        if (Date.now() >= record.deadline_at) {
          // The provider still says the current generation is open, so this
          // was a late result for an older reused request id.
          nativeInteractionResolutionRevalidations.delete(record.interaction_key);
          return;
        }
      } catch {
        record.in_flight = false;
        if (nativeInteractionResolutionRevalidations.get(record.interaction_key) !== record) return;
        const currentQueue = interactionGenerations.get(record.interaction_key) || [];
        if (!currentQueue.length || currentQueue[0].interaction_id !== record.interaction_id) {
          nativeInteractionResolutionRevalidations.delete(record.interaction_key);
          return;
        }
        if (version !== record.version) {
          scheduleNativeInteractionResolutionRevalidation(record);
          return;
        }
        if (Date.now() >= record.deadline_at) {
          // A native result is the strongest remaining signal when the
          // provider's pending-list API stays unavailable. Resolve only the
          // same generation that was open when that event arrived.
          finishNativeInteractionResolution(record);
          return;
        }
      }
      record.attempt += 1;
      scheduleNativeInteractionResolutionRevalidation(record);
    }, delayMs);
    record.timer = timer;
    interactionRevalidationTimers.add(timer);
    if (typeof timer.unref === "function") timer.unref();
  };
  const revalidateNativeInteractionResolution = (
    type,
    props,
    sessionId,
    interactionKind,
    requestId,
    interactionKey,
  ) => {
    const queued = interactionKey ? interactionGenerations.get(interactionKey) || [] : [];
    if (!queued.length) {
      // Diff Forge already emitted the exact result for a reply-API answer,
      // so this native event is only its duplicate acknowledgement.
      return;
    }
    const interactionId = queued[0].interaction_id;
    const existing = nativeInteractionResolutionRevalidations.get(interactionKey);
    if (existing && existing.timer) {
      const existingTimer = existing.timer;
      clearTimeout(existingTimer);
      interactionRevalidationTimers.delete(existingTimer);
      if (existing.timer === existingTimer) existing.timer = null;
    }
    const record = existing && existing.interaction_id === interactionId
      ? existing
      : {
          interaction_key: interactionKey,
          interaction_id: interactionId,
          in_flight: false,
          timer: null,
          version: 0,
        };
    record.type = type;
    record.props = props;
    record.session_id = sessionId;
    record.interaction_kind = interactionKind;
    record.request_id = requestId;
    record.attempt = 0;
    record.deadline_at = Date.now() + NATIVE_RESULT_REVALIDATION_TIMEOUT_MS;
    record.version += 1;
    nativeInteractionResolutionRevalidations.set(interactionKey, record);
    scheduleNativeInteractionResolutionRevalidation(record);
  };
  const scheduleHandledQuestionRevalidation = (sessionId, requestId, interactionKey, token) => {
    if (!requestId || !interactionKey || !token) return;
    const timer = setTimeout(async () => {
      interactionRevalidationTimers.delete(timer);
      try {
        const stillPending = await providerInteractionStillPending(
          "question",
          sessionId,
          requestId,
        );
        if (!stillPending) forgetHandledInteractionIfCurrent(interactionKey, token);
      } catch {
        // Keep the bounded handled marker when the provider cannot confirm
        // that the answered question has left its pending list.
      }
    }, 250);
    interactionRevalidationTimers.add(timer);
    if (typeof timer.unref === "function") timer.unref();
  };
  let permissionReconciliationInFlight = false;
  let permissionReconciliationStopped = false;
  const reconcilePendingPermissions = async (reason) => {
    if (permissionReconciliationStopped || permissionReconciliationInFlight) return;
    permissionReconciliationInFlight = true;
    try {
      let response;
      if (client && client.permission && typeof client.permission.list === "function") {
        try {
          response = await client.permission.list();
          if (response && response.error) throw response.error;
        } catch {
          response = await opencodeFetch(serverUrl, "/permission", undefined, "GET");
        }
      } else {
        response = await opencodeFetch(serverUrl, "/permission", undefined, "GET");
      }
      if (permissionReconciliationStopped) return;
      const pendingPermissions = pendingPermissionsFromResponse(response);
      const livePermissionKeys = new Set();
      for (const permission of pendingPermissions) {
        const props = permission && typeof permission === "object" ? permission : {};
        const sessionId = props.sessionID || props.sessionId || props.session_id || props.session?.id || "";
        const requestId = props.id || props.permissionID || props.permissionId || props.requestID || props.requestId || "";
        const interactionKey = requestId ? `${sessionId}:permission:${requestId}` : "";
        const askFingerprint = interactionAskFingerprint(props);
        if (interactionKey) livePermissionKeys.add(interactionKey);
        if (!requestId || (interactionKey && (handledInteractionRecently(interactionKey, askFingerprint) || pendingInteractionIds.has(interactionKey)))) continue;
        handlePendingPermission(sessionId, requestId, props, askFingerprint).catch(() => {});
      }
      for (const interactionKey of handledInteractionIds.keys()) {
        if (interactionKey.includes(":permission:") && !livePermissionKeys.has(interactionKey)) {
          handledInteractionIds.delete(interactionKey);
        }
      }
    } catch {
      // Permission reconciliation is a recovery path; live provider events
      // remain authoritative when the SDK/server is temporarily unavailable.
    } finally {
      permissionReconciliationInFlight = false;
    }
  };
  const startupPermissionReconcileTimer = setTimeout(
    () => reconcilePendingPermissions("startup"),
    750
  );
  const permissionReconcileInterval = setInterval(
    () => reconcilePendingPermissions("interval"),
    4000
  );
  if (typeof startupPermissionReconcileTimer.unref === "function") startupPermissionReconcileTimer.unref();
  if (typeof permissionReconcileInterval.unref === "function") permissionReconcileInterval.unref();
  const stopPermissionReconciliation = () => {
    if (permissionReconciliationStopped) return;
    permissionReconciliationStopped = true;
    clearTimeout(startupPermissionReconcileTimer);
    clearInterval(permissionReconcileInterval);
    for (const timer of interactionRevalidationTimers) clearTimeout(timer);
    interactionRevalidationTimers.clear();
  };
  return {
    "chat.message": async (input, output) => {
      const sessionId = (input && input.sessionID) || "";
      const prompt = pickText(output && output.parts);
      const submitKeys = userPromptSubmitKeys(sessionId, "", prompt, "chat.message");
      if (userPromptAlreadySubmitted(submitKeys)) return;
      startTurn(sessionId, "chat.message");
      clearAssistantTextForSession(sessionId);
      rememberUserPromptSubmitted(submitKeys);
      emit({
        hook_event_name: "UserPromptSubmit",
        session_id: sessionId,
	        prompt,
	      });
	    },
	    "tool.execute.before": async (input, output) => {
	      noteActivity((input && input.sessionID) || "", "tool.execute.before");
      emit({
        hook_event_name: "PreToolUse",
        session_id: (input && input.sessionID) || "",
        tool_name: (input && input.tool) || "",
        tool_use_id: (input && input.callID) || "",
        tool_input: (output && output.args) || {},
      });
    },
	    "tool.execute.after": async (input, output) => {
	      noteActivity((input && input.sessionID) || "", "tool.execute.after");
      emit({
        hook_event_name: "PostToolUse",
        session_id: (input && input.sessionID) || "",
        tool_name: (input && input.tool) || "",
        tool_use_id: (input && input.callID) || "",
        tool_input: (input && input.args) || {},
        tool_output: (output && (output.output || output.result || output)) || {},
        duration_ms: (output && (output.durationMs || output.duration_ms)) || null,
      });
    },
	    "permission.ask": async (input) => {
	      noteActivity((input && input.sessionID) || "", "permission.ask");
      // Fires only when OpenCode actually needs a decision (auto-allowed tools
      // never ask), so surface it as a manual-approval attention event. We do
      // not touch `output` — OpenCode's own permission config decides.
      emit({
        hook_event_name: "PermissionObserved",
        session_id: (input && input.sessionID) || "",
        manual_approval_required: true,
        permission_request_id: (input && input.id) || "",
        tool_use_id: (input && input.callID) || "",
        tool_name: (input && input.type) || "",
        description: (input && input.title) || "",
        prompt_default_option: "reject",
        prompt_options: [
          ["allow_once", "Allow once"],
          ["allow_always", "Allow always"],
          ["reject", "Reject"]
        ],
      });
    },
    event: async ({ event }) => {
      const type = (event && event.type) || "";
      const sessionId = eventSessionId(event);
	      const props = (event && event.properties) || {};
	      if (type === "server.instance.disposed" || type === "global.disposed") {
	        stopPermissionReconciliation();
	        return;
	      }
	      if (type === "message.updated" || type === "message.created") {
	        const message = props.message || props.info || {};
        const role = rememberMessageRole(sessionId, message, props);
        if (role === "user") {
          emitUserPromptFromMessage(sessionId, message, props, type);
        } else if (role === "assistant") {
          const completed = assistantMessageCompleted(message, props);
          const completionKey = completed ? assistantMessageCompletionKey(sessionId, message, props) : "";
          if (completed && completionKey && completedAssistantMessages.has(completionKey)) {
            return;
          }
          noteActivity(sessionId, type);
          if (completed) {
            if (!completionKey || !completedAssistantMessages.has(completionKey)) {
              if (completionKey) completedAssistantMessages.add(completionKey);
              const completedText = pickText(message.parts || message.content || []);
              rememberAssistantText(sessionId, (message && (message.id || message.messageID || message.messageId)) || "", completedText, true);
              scheduleStop(sessionId, completedText ? {
                opencode_idle_source: type,
                assistant_message_snapshot: completedText,
              } : {});
            }
          }
        }
	      }
	      if (type === "message.part.updated") {
	        const part = props.part || {};
	        const kind = textualPartKind(part);
	        const id = (part && (part.id || part.partID || part.partId)) || props.partID || props.partId || "";
	        const messageId = messageIdForPart(props, part);
        const role = messageRoleForPart(sessionId, props, part);
        if (role === "user") {
          emitUserPromptFromMessage(sessionId, props.message || props.info || { id: messageId, parts: [part], role: "user" }, props, type);
          return;
        }
        if (role !== "assistant") return;
        const key = partKey(sessionId, messageId, id);
        if (key && kind) partKinds.set(key, kind);
        if (emitPartText(sessionId, kind, partText(part), true, messageId, id)) {
          noteActivity(sessionId, type);
        }
      }
	      if (type === "message.part.delta") {
	        const id = props.partID || props.partId || "";
	        const messageId = messageIdForPart(props, null);
        const role = messageRoleForPart(sessionId, props, null);
        if (role !== "assistant") return;
        const key = partKey(sessionId, messageId, id);
        const kind = partKinds.get(key) || "text";
        const field = String(props.field || "").toLowerCase();
        const delta = nonEmptyString(props.delta) ? props.delta : pickDeltaText(props);
        if (kind && (!field || field === "text" || field === "content" || field === "delta")) {
          if (emitPartText(sessionId, kind, delta, false, messageId, id)) {
            noteActivity(sessionId, type);
          }
        }
      }
	      if (type === "session.compacted" || type === "session.compacting") {
	        noteActivity(sessionId, type);
        emit({
          hook_event_name: type === "session.compacting" ? "PreCompact" : "PostCompact",
          session_id: sessionId,
        });
      }
      if (type === "permission.asked") {
        const requestId = props.id || props.permissionID || props.permissionId || props.requestID || props.requestId || "";
        await handlePendingPermission(sessionId, requestId, props, interactionAskFingerprint(props));
      }
	      if (type === "question.ask" || type === "question.asked" || type === "selection.ask" || type === "selection.asked") {
        noteActivity(sessionId, type);
        const promptId = props.id || props.questionID || props.questionId || props.promptID || props.promptId || props.selectionID || props.selectionId || "";
        const interactionKey = promptId ? `${sessionId}:question:${promptId}` : "";
        const askFingerprint = interactionAskFingerprint(props);
        if (interactionKey && (handledInteractionRecently(interactionKey, askFingerprint) || pendingInteractionIds.has(interactionKey))) return;
        if (interactionKey) pendingInteractionIds.set(interactionKey, "starting");
        const interactionGeneration = rememberInteractionGeneration(
          interactionKey,
          sessionId,
          "question",
          promptId,
          askFingerprint,
        );
        if (interactionKey) {
          pendingInteractionIds.set(
            interactionKey,
            interactionGeneration.interaction_id || "starting",
          );
        }
        const questions = Array.isArray(props.questions)
          ? props.questions
          : (props.question ? [props.question] : []);
        const response = await emit({
          hook_event_name: "UserPromptRequired",
          session_id: sessionId,
          requires_user_input: true,
          provider_blocked_for_user: true,
          permission_request_id: promptId || (sessionId ? `${type}:${sessionId}:${Date.now()}` : `${type}:${Date.now()}`),
          prompting_user_kind: type.startsWith("selection.") ? "selection" : "question",
          prompting_user_text: props.title || (questions[0] && questions[0].question) || props.description || "",
          prompt_questions: questions,
          prompt_options: props.options || props.choices || props.actions || [],
          provider_payload: props,
          interaction_id: interactionGeneration.interaction_id,
          interaction_revision: interactionGeneration.interaction_revision,
        });
        if (promptId && response) {
          try {
            await replyOpenCodeQuestion(client, serverUrl, promptId, response);
            retireInteractionGeneration(
              interactionKey,
              interactionGeneration.interaction_id,
            );
            const handledToken = rememberHandledInteraction(interactionKey, askFingerprint);
            scheduleHandledQuestionRevalidation(sessionId, promptId, interactionKey, handledToken);
            emit({
              hook_event_name: "ElicitationResult",
              session_id: sessionId,
              permission_request_id: promptId,
              decision: response.rejected ? "rejected" : "accepted",
              resolved_interaction_id: response._diffforge_interaction_id,
              resolved_interaction_revision: response._diffforge_interaction_revision,
            });
          } catch (error) {
            emit({
              hook_event_name: "StopFailure",
              session_id: sessionId,
              error_code: "question_reply_failed",
              error: String((error && error.message) || error || "OpenCode question reply failed."),
              interaction_id: interactionGeneration.interaction_id,
              interaction_revision: interactionGeneration.interaction_revision,
              retryable: true,
            });
          }
        }
        if (
          interactionKey
          && pendingInteractionIds.get(interactionKey)
            === interactionGeneration.interaction_id
        ) {
          pendingInteractionIds.delete(interactionKey);
        }
      }
      if (type === "permission.replied" || type === "question.replied" || type === "question.rejected") {
        const requestId = props.id || props.permissionID || props.permissionId || props.questionID || props.questionId || props.requestID || props.requestId || "";
        const interactionKind = type.startsWith("permission.") ? "permission" : "question";
        const interactionKey = requestId ? `${sessionId}:${interactionKind}:${requestId}` : "";
        revalidateNativeInteractionResolution(
          type,
          props,
          sessionId,
          interactionKind,
          requestId,
          interactionKey,
        );
      }
      if (type === "session.created") {
        emit({
          hook_event_name: "SessionStart",
          session_id: sessionId,
          provider_payload: props,
        });
      } else if (type === "session.updated") {
        emit({
          hook_event_name: "Notification",
          session_id: sessionId,
          notification_type: type,
          provider_payload: props,
        });
      } else if (type === "session.deleted") {
        emit({
          hook_event_name: "SessionEnd",
          session_id: sessionId,
          provider_payload: props,
        });
      }
      if (type === "todo.updated") {
        noteActivity(sessionId, type);
        emit({
          hook_event_name: "PostToolUse",
          session_id: sessionId,
          tool_name: "TodoWrite",
          tool_input: { todos: props.todos || props.items || [] },
          provider_payload: props,
        });
      } else if (type === "command.executed" || type === "tool.updated") {
        noteActivity(sessionId, type);
        emit({
          hook_event_name: "Notification",
          session_id: sessionId,
          notification_type: type,
          provider_payload: props,
        });
      }
      if (type === "message.removed" || type === "message.part.removed" || type === "session.diff") {
        emit({
          hook_event_name: "TranscriptChanged",
          session_id: sessionId,
          notification_type: type,
          provider_passive: true,
          provider_payload: props,
        });
      }
      if (
        type === "file.edited"
        || type === "file.watcher.updated"
        || type === "installation.updated"
        || type === "installation.update-available"
      ) {
        emit({
          hook_event_name: "Notification",
          session_id: sessionId,
          notification_type: type,
          provider_passive: true,
          provider_payload: props,
        });
      }
      if (type === "session.status") {
        reconcilePendingPermissions("session.status");
        // OpenCode >= 1.17 reports turn phases via session.status; treat a
        // return to idle/cooldown as a quiet-period completion candidate.
        // OpenCode can publish idle before the final message/tool events have
        // drained, so a later event for the same session cancels this.
        const raw = props.status !== undefined
          ? props.status
          : (props.phase !== undefined ? props.phase : props.state);
        const statusValue = String(
          (raw && typeof raw === "object"
            ? (raw.type || raw.phase || raw.state || raw.status)
            : raw) || ""
        ).toLowerCase();
	        if (statusValue === "idle" || statusValue === "cooldown") {
	          scheduleIdle(sessionId, "session.status");
	        } else if (statusValue === "retry") {
          noteActivity(sessionId, "session.status.retry");
          emit({
            hook_event_name: "ProviderRetry",
            session_id: sessionId,
            retryable: true,
            retry_attempt: raw && raw.attempt,
            retry_message: raw && raw.message,
            retry_action: raw && raw.action,
            retry_next_at: raw && raw.next,
            provider_payload: raw,
          });
	        } else if (statusValue) {
		          noteActivity(sessionId, "session.status");
		        }
      }
      if (type === "session.idle") {
	        reconcilePendingPermissions("session.idle");
	        scheduleIdle(sessionId, "session.idle");
	      } else if (type === "session.error") {
        cancelPendingStop(sessionId);
        const turn = activeTurn(sessionId);
        if (turn) {
          turn.settled = true;
          activeSessions.set(sessionId, turn);
        }
        const providerError = props.error || props.apiError || props.api_error || props;
        const providerCode = (providerError && (
          providerError.name
          || providerError.type
          || providerError.code
          || providerError.statusCode
        )) || "session_error";
        const providerMessage = (providerError && (
          providerError.message
          || providerError.body
          || providerError.detail
        )) || props.message || "OpenCode session failed.";
        emit({
          hook_event_name: "StopFailure",
          session_id: sessionId,
          error: providerMessage,
          error_code: String(providerCode),
          error_details: providerError,
          retryable: Boolean(providerError && (providerError.isRetryable || providerError.retryable)),
        });
      }
    },
  };
};

export default DiffForgeActivityPlugin;
"#;

fn diffforge_opencode_activity_plugin_path() -> PathBuf {
    env::temp_dir()
        .join("diffforge-opencode")
        .join("diffforge-activity-plugin.js")
}

fn ensure_diffforge_opencode_activity_plugin() -> Result<PathBuf, String> {
    let path = diffforge_opencode_activity_plugin_path();
    let Some(parent) = path.parent() else {
        return Err("Unable to prepare OpenCode plugin path.".to_string());
    };
    fs::create_dir_all(parent)
        .map_err(|error| format!("Unable to prepare OpenCode plugin directory: {error}"))?;
    if fs::read_to_string(&path).ok().as_deref() != Some(DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS) {
        fs::write(&path, DIFFFORGE_OPENCODE_ACTIVITY_PLUGIN_JS)
            .map_err(|error| format!("Unable to write OpenCode plugin: {error}"))?;
    }
    Ok(path)
}

// Coarse auto-approval for Diff Forge-driven OpenCode terminals (coordinated
// agents + the app-control orchestrator), mirroring Codex's per-tool approve /
// Claude's acceptEdits. OpenCode's `permission` schema is coarse, so allow the
// edit/bash/webfetch/external-directory buckets the app drives. Plain
// (non-managed) terminals never receive this.
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

fn diff_forge_opencode_activity_hook_bin(
    coordination: Option<&TerminalCoordinationSession>,
) -> String {
    if let Some(coordination) = coordination {
        let command = coordination.mcp_command.trim();
        if !command.is_empty() {
            return command.to_string();
        }
    }
    env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "diff-forge".to_string())
}

// Injects Diff Forge's OpenCode integration into the inline `OPENCODE_CONFIG_CONTENT`
// the app already uses (it merges with the user's own config). For every managed
// OpenCode terminal this registers the activity plugin (Phase 2, live status). For
// coordinated terminals it also wires the coordination-kernel + workspace-mcp-gateway
// MCP servers and auto-approval permissions (Phase 3), matching the Claude/Codex
// coordination launch parity. Composes with other writers of the same env var
// (e.g. app-control) by reading the existing config and merging.
fn terminal_env_vars_with_opencode_coordination_config(
    provider_id: &str,
    env_vars: &[(String, String)],
    coordination: Option<&TerminalCoordinationSession>,
    permission_mode: Option<&str>,
) -> Result<Vec<(String, String)>, String> {
    let mut next = env_vars.to_vec();
    if !provider_id.to_ascii_lowercase().contains("opencode") {
        return Ok(next);
    }

    let plugin_path = ensure_diffforge_opencode_activity_plugin()?
        .to_string_lossy()
        .to_string();
    set_terminal_env_var(
        &mut next,
        OPENCODE_ACTIVITY_HOOK_BIN_ENV,
        &diff_forge_opencode_activity_hook_bin(coordination),
    );

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
        .get("plugin")
        .map_or(true, |value| value.is_array())
    {
        return Err("OpenCode inline config field `plugin` must be a JSON array.".to_string());
    }
    let plugin_array = config_object
        .entry("plugin".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    let Some(plugin_array) = plugin_array.as_array_mut() else {
        return Err("Unable to prepare OpenCode plugin list.".to_string());
    };
    if !plugin_array
        .iter()
        .any(|value| value.as_str() == Some(plugin_path.as_str()))
    {
        plugin_array.push(Value::String(plugin_path));
    }

    if let Some(coordination) = coordination {
        let coordination_args = terminal_coordination_proxy_args(coordination);
        let gateway_args =
            terminal_workspace_gateway_args_from_coordination_args(&coordination_args);

        if !config_object
            .get("mcp")
            .map_or(true, |value| value.is_object())
        {
            return Err("OpenCode inline config field `mcp` must be a JSON object.".to_string());
        }
        let mcp_servers = config_object
            .entry("mcp".to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        let Some(mcp_servers) = mcp_servers.as_object_mut() else {
            return Err("Unable to prepare OpenCode MCP config.".to_string());
        };

        let mut coordination_command = vec![Value::String(coordination.mcp_command.clone())];
        coordination_command.extend(coordination_args.iter().cloned().map(Value::String));
        mcp_servers.insert(
            "coordination-kernel".to_string(),
            json!({
                "type": "local",
                "command": coordination_command,
                "enabled": true,
                "environment": {
                    "COORDINATION_ENABLED": "1",
                    "COORDINATION_MCP_ALWAYS_ON": "1"
                }
            }),
        );

        let mut gateway_command = vec![Value::String(coordination.mcp_command.clone())];
        gateway_command.extend(gateway_args.iter().cloned().map(Value::String));
        mcp_servers.insert(
            "workspace-mcp-gateway".to_string(),
            json!({
                "type": "local",
                "command": gateway_command,
                "enabled": true,
                "environment": Value::Object(terminal_workspace_gateway_environment(Some(coordination)))
            }),
        );

        // Auto-approval parity: keep coordinated turns from blocking on tool
        // approvals (mirrors Codex --dangerously-bypass / Claude acceptEdits).
        config_object.insert(
            "permission".to_string(),
            opencode_permission_value(permission_mode),
        );
    }

    set_terminal_env_var(&mut next, OPENCODE_CONFIG_CONTENT_ENV, &config.to_string());
    Ok(next)
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
            installed: false,
            updated: false,
            permission_denied: false,
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
            installed: false,
            updated: false,
            permission_denied: false,
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
                installed: true,
                updated: false,
                permission_denied,
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
            installed: true,
            updated: false,
            permission_denied: false,
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
            installed: false,
            updated: false,
            permission_denied: false,
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
            // npm exiting 0 is not enough: verify the binary really starts,
            // and try the package's own postinstall repair once before
            // reporting a corrupt install.
            if let Err(verify_error) = verify_agent_binary_runs(definition) {
                let repaired = repair_agent_npm_postinstall(definition)
                    && verify_agent_binary_runs(definition).is_ok();
                if !repaired {
                    emit(AgentInstallProgressSignal {
                        stage: "failed",
                        error_reason: Some(verify_error.clone()),
                        failed_stage: Some("verifying"),
                    });
                    return failed_agent_install_result(
                        definition,
                        &verify_error,
                        "The npm package installed but its binary does not run (likely an interrupted download). Try again on a stable connection.",
                        if is_update { "update" } else { "install" },
                    );
                }
            }
            if let Some(target_version) = target_version.filter(|value| !value.trim().is_empty()) {
                let installed_version = npm_global_package_version(definition).unwrap_or_default();
                if !agent_version_is_at_least(&installed_version, target_version) {
                    let reason = if installed_version.is_empty() {
                        format!(
                            "{} version could not be re-probed after npm completed.",
                            definition.label
                        )
                    } else {
                        format!(
                            "{} remained at {} after updating to target {}.",
                            definition.label, installed_version, target_version
                        )
                    };
                    emit(AgentInstallProgressSignal {
                        stage: "failed",
                        error_reason: Some(reason.clone()),
                        failed_stage: Some("verifying"),
                    });
                    return failed_agent_install_result(
                        definition,
                        &reason,
                        "The installed version did not reach the requested target.",
                        if is_update { "update" } else { "install" },
                    );
                }
            }
            emit(AgentInstallProgressSignal {
                stage: "complete",
                error_reason: None,
                failed_stage: None,
            });
            AgentInstallResult {
                provider: definition.id,
                label: definition.label,
                installed: true,
                updated: is_update,
                permission_denied: false,
                command: definition.install_command,
                native_install_url: definition.native_install_url,
                message: if is_update {
                    format!("{} npm package is up to date.", definition.label)
                } else {
                    format!(
                        "{} installed with npm. Recheck status, then connect your account.",
                        definition.label
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
                "npm install returned a non-zero status.",
                if is_update { "update" } else { "install" },
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
                "Unable to run npm install.",
                if is_update { "update" } else { "install" },
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
    }
}

fn logout_agent_credentials(provider: AgentProvider) -> Result<AgentLogoutResult, String> {
    let definition = agent_definition(provider);
    let args = match provider {
        AgentProvider::Codex => vec!["logout"],
        AgentProvider::Claude => vec!["auth", "logout"],
        AgentProvider::OpenCode => vec!["auth", "logout"],
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

fn insert_codex_exec_args_before_stdin_prompt(args: &mut Vec<String>, values: Vec<String>) {
    if values.is_empty() {
        return;
    }
    let insert_at = args
        .iter()
        .position(|arg| arg == "resume")
        .or_else(|| args.iter().rposition(|arg| arg == "-"))
        .unwrap_or(args.len());
    args.splice(insert_at..insert_at, values);
}

fn apply_codex_coordinated_exec_args(
    args: &mut Vec<String>,
    coordination: &TerminalCoordinationSession,
) {
    let codex_profile = terminal_coordination_env_value(coordination, "DIFFFORGE_CODEX_PROFILE");
    if let Some(profile) = codex_profile.filter(|value| !value.trim().is_empty()) {
        args.insert(0, profile);
        args.insert(0, "--profile".to_string());
    }

    strip_terminal_arg_option(args, "--sandbox", "-s", true);

    let coordination_args = terminal_coordination_proxy_args(coordination);
    let mut codex_config_args = Vec::new();
    codex_config_args.extend([
        "--sandbox".to_string(),
        "danger-full-access".to_string(),
        "--disable".to_string(),
        "apps".to_string(),
        "--enable".to_string(),
        "hooks".to_string(),
    ]);
    if terminal_coordination_env_value(coordination, "DIFFFORGE_CODEX_BYPASS_HOOK_TRUST")
        .is_some_and(|value| terminal_env_truthy(&value))
    {
        codex_config_args.push("--dangerously-bypass-hook-trust".to_string());
    }
    append_codex_mcp_server_config_args(
        &mut codex_config_args,
        "coordination-kernel",
        &coordination.mcp_command,
        &coordination_args,
    );
    for tool in crate::coordination::mcp::TOOL_NAMES {
        append_codex_mcp_tool_approval_arg(&mut codex_config_args, "coordination-kernel", tool);
    }

    let gateway_args = terminal_workspace_gateway_args_from_coordination_args(&coordination_args);
    append_codex_mcp_server_config_args(
        &mut codex_config_args,
        "workspace-mcp-gateway",
        &coordination.mcp_command,
        &gateway_args,
    );
    append_codex_workspace_gateway_bridge_env_args(&mut codex_config_args);
    for tool in TERMINAL_WORKSPACE_MCP_GATEWAY_TOOLS {
        append_codex_mcp_tool_approval_arg(&mut codex_config_args, "workspace-mcp-gateway", tool);
    }
    if let Some(value) =
        terminal_coordination_env_value(coordination, "DIFFFORGE_WORKSPACE_MCP_ALLOWED_TOOLS")
    {
        for tool in value
            .split(',')
            .map(str::trim)
            .filter(|tool| !tool.is_empty())
        {
            append_codex_mcp_tool_approval_arg(
                &mut codex_config_args,
                "workspace-mcp-gateway",
                tool,
            );
        }
    }
    codex_config_args.push("-c".to_string());
    codex_config_args.push("shell_environment_policy.inherit=all".to_string());
    insert_codex_exec_args_before_stdin_prompt(args, codex_config_args);
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
    run_agent_thread_turn_for_context(request, None, &[])
}

fn run_agent_thread_turn_for_context(
    request: AgentThreadTurnRequest,
    coordination: Option<&TerminalCoordinationSession>,
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
    let resume_was_requested =
        terminal_clean_provider_session_id(Some(&requested_provider_session_id)).is_some();
    let (launch_provider_session_id, codex_resume_home) = terminal_resolve_provider_resume_session(
        provider,
        terminal_clean_provider_session_id(Some(&requested_provider_session_id)),
        &working_directory_text,
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
        )?;
    }
    let launch_provider_session_id = launch_provider_session_id.unwrap_or_default();
    let mut output_path = None;
    let (args, stdin_text) = match provider {
        AgentProvider::Codex => {
            let path = temporary_agent_output_path("codex")?;
            let mut args =
                build_codex_turn_args(model.as_deref(), &launch_provider_session_id, &path);
            if let Some(coordination) = coordination {
                apply_codex_coordinated_exec_args(&mut args, coordination);
            }
            output_path = Some(path);
            (args, Some(prompt))
        }
        AgentProvider::Claude => {
            let mut args =
                build_claude_turn_args(model.as_deref(), &launch_provider_session_id, prompt);
            if let Some(coordination) = coordination {
                let coordination_args = terminal_coordination_proxy_args(coordination);
                apply_claude_coordinated_auto_approval_args(
                    &mut args,
                    coordination,
                    &coordination_args,
                    None,
                    "",
                    0,
                    terminal_coordination_env_value(coordination, "COORDINATION_WORKSPACE_ID")
                        .as_deref(),
                    terminal_coordination_env_value(coordination, "DIFFFORGE_TERMINAL_INDEX")
                        .as_deref()
                        .and_then(|value| value.parse::<u16>().ok()),
                    None,
                );
            }
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

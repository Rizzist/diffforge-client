fn parse_agent_provider(provider: &str) -> Result<AgentProvider, String> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "haider" => Ok(AgentProvider::Haider),
        "codex" | "claude" | "claude-code" | "claude_code" | "opencode" | "open-code"
        | "open_code" | "kimi" | "grok" | "grok-cli" | "grok_cli" => {
            Err("This legacy harness is unavailable; DiffForge only supports Haider.".to_string())
        }
        _ => Err("Unknown harness provider.".to_string()),
    }
}

fn agent_definition(provider: AgentProvider) -> AgentDefinition {
    match provider {
        AgentProvider::Codex => AgentDefinition {
            id: "codex",
            label: "Codex",
            binary: "",
            install_package: "",
            install_command: "",
            native_install_url: "",
            native_install_label: "Unavailable",
            connect_command: "",
        },
        AgentProvider::Claude => AgentDefinition {
            id: "claude",
            label: "Claude Code",
            binary: "",
            install_package: "",
            install_command: "",
            native_install_url: "",
            native_install_label: "Unavailable",
            connect_command: "",
        },
        AgentProvider::OpenCode => AgentDefinition {
            id: "opencode",
            label: "OpenCode",
            binary: "",
            install_package: "",
            install_command: "",
            native_install_url: "",
            native_install_label: "Unavailable",
            connect_command: "",
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
    let _ = provider;
    Err("DiffForge does not install or update harness CLIs.".to_string())
}

fn unsupported_harness_management_result(
    provider: AgentProvider,
    operation: &str,
) -> AgentInstallResult {
    let definition = agent_definition(provider);
    AgentInstallResult {
        provider: definition.id,
        label: definition.label,
        ok: false,
        installed: false,
        updated: false,
        permission_denied: false,
        error_kind: Some("unsupported_harness".to_string()),
        failed_stage: Some(operation.to_string()),
        exit_code: None,
        stderr: String::new(),
        installed_version: String::new(),
        command: "",
        native_install_url: "",
        message: "DiffForge does not install, update, or uninstall harness CLIs.".to_string(),
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






fn npm_global_package_version(definition: AgentDefinition) -> Option<String> {
    let _ = definition;
    None
}

fn npm_latest_package_version(definition: AgentDefinition) -> Option<String> {
    let _ = definition;
    None
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
    if definition.id != "haider" {
        return Vec::new();
    }
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
    let _ = agent_kind;
    Vec::new()
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

#[derive(Clone, Serialize)]
struct OpencodeModelList {
    models: Vec<String>,
    source: String,
    fetched_at_ms: u64,
    harness_version: Option<String>,
    error: Option<String>,
}

fn opencode_current_harness_version() -> Option<String> {
    None
}


fn opencode_note_harness_version(version: &str) -> bool {
    let _ = version;
    false
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







fn opencode_model_catalog_entries_from_ids(
    model_ids: &[String],
    source: &str,
) -> Vec<AgentModelCatalogEntry> {
    let _ = (model_ids, source);
    Vec::new()
}

fn opencode_model_supports_images(_model: &str) -> Option<bool> {
    // The removed OpenCode harness is no longer an authority for model
    // capabilities. Callers outside this lane must render the fact as unknown.
    None
}

async fn opencode_list_models(_force_refresh: Option<bool>) -> OpencodeModelList {
    OpencodeModelList {
        models: Vec::new(),
        source: "unavailable".to_string(),
        fetched_at_ms: 0,
        harness_version: None,
        error: Some("OpenCode is not a supported harness.".to_string()),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClaudeWorkspaceTrustMergeOutcome {
    SkippedInvalidConfig,
}

struct ClaudeWorkspaceTrustLock;

fn acquire_claude_workspace_trust_lock(
    _config_path: &Path,
) -> Result<ClaudeWorkspaceTrustLock, String> {
    Err("Claude Code workspace trust is not managed by DiffForge.".to_string())
}

fn ensure_claude_workspace_trust_in_config(
    _config_path: &Path,
    _workspace: &Path,
) -> Result<ClaudeWorkspaceTrustMergeOutcome, String> {
    Ok(ClaudeWorkspaceTrustMergeOutcome::SkippedInvalidConfig)
}

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


const TERMINAL_PERMISSION_MODE_PLAN: &str = "plan";
const TERMINAL_PERMISSION_MODE_ASK: &str = "ask";
const TERMINAL_PERMISSION_MODE_ACCEPT_EDITS: &str = "accept_edits";
const TERMINAL_PERMISSION_MODE_AUTO: &str = "auto";
const TERMINAL_PERMISSION_MODE_FULL_ACCESS: &str = "full_access";
const TERMINAL_PERMISSION_MODE_BYPASS: &str = "bypass";










fn extend_terminal_activity_env_vars(
    env_vars: &mut Vec<(String, String)>,
    workspace_root: Option<&Path>,
    _pane_id: &str,
    _instance_id: u64,
    _workspace_id: Option<&str>,
    _terminal_index: Option<u16>,
    provider_id: &str,
    _activity_transport: Option<&TerminalActivityTransportEndpoint>,
    _launch_account_binding: Option<&TerminalProviderLaunchAccountBinding>,
) -> Result<(), String> {
    if provider_id != "haider" {
        return Err("Legacy harness launch environments are unavailable.".to_string());
    }
    if let Some(workspace_root) = workspace_root {
        set_terminal_env_var(
            env_vars,
            "DIFFFORGE_WORKSPACE_ROOT",
            &workspace_root.to_string_lossy(),
        );
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
    let _ = (
        pane_id,
        instance_id,
        launch_epoch,
        provider_id,
        workspace_id,
        terminal_index,
        launch_account_binding,
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
    let _ = (env_vars, launch_account_binding);
    Err("Legacy harness launch accounts are unavailable.".to_string())
}

fn set_terminal_env_var(env_vars: &mut Vec<(String, String)>, key: &str, value: &str) {
    env_vars.retain(|(existing_key, _)| existing_key != key);
    env_vars.push((key.to_string(), value.to_string()));
}


fn apply_codex_resume_home_env(
    env_vars: &mut Vec<(String, String)>,
    source_home: &str,
    provider_session_id: &str,
    launch_account_binding: Option<&TerminalProviderLaunchAccountBinding>,
) -> Result<(), String> {
    let _ = (
        env_vars,
        source_home,
        provider_session_id,
        launch_account_binding,
    );
    Err("Codex resume homes are not managed by DiffForge.".to_string())
}






#[cfg(windows)]
fn terminal_toml_string(value: &str) -> String {
    // Preserve embedded quotes across the Windows PowerShell launch path.
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
#[cfg(windows)]
const TERMINAL_EMULATION_PROGRAM: &str = "vscode";
#[cfg(not(windows))]
const TERMINAL_EMULATION_PROGRAM: &str = "DiffForge";




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
    let mut command = terminal_agent_launch_command(command_path, args, working_directory, banner);

    for (key, value) in env_vars {
        command.env(key, value);
    }

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







fn update_agent_with_npm_progress<F>(
    provider: AgentProvider,
    target_version: &str,
    emit: F,
) -> AgentInstallResult
where
    F: FnMut(AgentInstallProgressSignal),
{
    let _ = target_version;
    let mut emit = emit;
    emit(AgentInstallProgressSignal {
        stage: "failed",
        error_reason: Some("DiffForge does not update harness CLIs.".to_string()),
        failed_stage: Some("installing"),
    });
    unsupported_harness_management_result(provider, "installing")
}



fn verify_agent_binary_runs(definition: AgentDefinition) -> Result<(), String> {
    let _ = definition;
    Err("DiffForge does not probe legacy harness executables.".to_string())
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






fn update_agent_with_npm_as_administrator_progress<F>(
    provider: AgentProvider,
    target_version: &str,
    mut emit: F,
) -> AgentInstallResult
where
    F: FnMut(AgentInstallProgressSignal),
{
    let _ = target_version;
    emit(AgentInstallProgressSignal {
        stage: "failed",
        error_reason: Some("DiffForge does not update harness CLIs.".to_string()),
        failed_stage: Some("installing"),
    });
    unsupported_harness_management_result(provider, "installing")
}



/// Compatibility entry point retained for persisted account flows.
fn launch_account_login_terminal(provider: AgentProvider) -> Result<(), String> {
    let _ = provider;
    Err("DiffForge no longer launches harness login terminals.".to_string())
}






fn cleanup_login_terminal_children() -> usize {
    0
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
    let _ = (title, binary, args, env_vars);
    Err("DiffForge no longer launches harness login terminals.".to_string())
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
    let _ = (title, binary, args, env_vars);
    Err("DiffForge no longer launches harness login terminals.".to_string())
}


#[cfg(all(unix, not(target_os = "macos")))]
fn run_login_terminal_with_env(
    title: &str,
    binary: &str,
    args: &[&str],
    env_vars: &[(String, String)],
) -> Result<(), String> {
    let _ = (title, binary, args, env_vars);
    Err("DiffForge no longer launches harness login terminals.".to_string())
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

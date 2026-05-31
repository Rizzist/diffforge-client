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
            connect_command: "codex login",
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

    if let Ok(mut cache) = cache.lock() {
        cache.insert(definition.id, candidates.clone());
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

fn terminal_args_with_codex_mcp_identity(
    provider_id: &str,
    args: &[String],
    coordination: Option<&TerminalCoordinationSession>,
    _pane_id: &str,
    _instance_id: u64,
) -> Vec<String> {
    let mut next = args.to_vec();
    let provider_id = provider_id.to_ascii_lowercase();
    let is_codex = provider_id.contains("codex");
    let is_claude = provider_id.contains("claude");
    if !is_codex && !is_claude {
        return next;
    }
    if is_codex {
        apply_codex_terminal_display_args(&mut next);
    }
    let Some(coordination) = coordination else {
        return next;
    };

    let env_value = |key: &str| -> Option<String> {
        coordination.env_vars.iter().find_map(|(candidate, value)| {
            (candidate == key && !value.trim().is_empty()).then(|| value.clone())
        })
    };
    let write_root = env_value("COORDINATION_AGENT_BRANCH_ROOT")
        .or_else(|| env_value("COORDINATION_WORKTREE_PATH"));
    let codex_profile = env_value("DIFFFORGE_CODEX_PROFILE");
    let codex_bypass_hook_trust = env_value("DIFFFORGE_CODEX_BYPASS_HOOK_TRUST")
        .is_some_and(|value| terminal_env_truthy(&value));
    let enforcement_mode = env_value("COORDINATION_ENFORCEMENT_MODE").unwrap_or_default();
    let file_authority = env_value("COORDINATION_FILE_AUTHORITY").unwrap_or_default();

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
        if let Some(value) = env_value(env_key) {
            coordination_args.push(arg_key.to_string());
            coordination_args.push(value);
        }
    }

    if is_codex {
        let _ = (enforcement_mode.as_str(), file_authority.as_str());
        apply_codex_coordinated_auto_approval_args(
            &mut next,
            write_root.as_deref(),
            codex_profile.as_deref(),
            codex_bypass_hook_trust,
        );

        append_codex_global_mcp_disable_args(&mut next);
        append_codex_mcp_server_config_args(
            &mut next,
            "coordination-kernel",
            &coordination.mcp_command,
            &coordination_args,
        );
        for tool in crate::coordination::mcp::TOOL_NAMES {
            append_codex_mcp_tool_approval_arg(&mut next, "coordination-kernel", tool);
        }

        let gateway_args = terminal_workspace_gateway_args_from_coordination_args(&coordination_args);
        append_codex_mcp_server_config_args(
            &mut next,
            "workspace-mcp-gateway",
            &coordination.mcp_command,
            &gateway_args,
        );
        for tool in TERMINAL_WORKSPACE_MCP_GATEWAY_TOOLS {
            append_codex_mcp_tool_approval_arg(&mut next, "workspace-mcp-gateway", tool);
        }
        if let Some(value) = env_value("DIFFFORGE_WORKSPACE_MCP_ALLOWED_TOOLS") {
            for tool in value.split(',').map(str::trim).filter(|tool| !tool.is_empty()) {
                append_codex_mcp_tool_approval_arg(&mut next, "workspace-mcp-gateway", tool);
            }
        }
        next.push("-c".to_string());
        next.push("shell_environment_policy.inherit=all".to_string());
    }
    if is_claude {
        apply_claude_coordinated_auto_approval_args(&mut next, coordination, &coordination_args);
    }
    next
}

const TERMINAL_DIFFFORGE_MCP_SERVERS: &[&str] =
    &["coordination-kernel", "workspace-mcp-gateway"];

const TERMINAL_WORKSPACE_MCP_GATEWAY_TOOLS: &[&str] = &[
    "workspace_mcp__sync_manifest",
    "workspace_mcp__list_servers",
    "workspace_mcp__get_server_status",
    "workspace_mcp__get_server_config",
    "workspace_mcp__write_env_file",
];

fn append_codex_mcp_server_config_args(
    args: &mut Vec<String>,
    server_key: &str,
    command: &str,
    server_args: &[String],
) {
    let key = terminal_toml_key_segment(server_key);
    for value in [
        (
            format!("mcp_servers.{key}.enabled"),
            "true".to_string(),
        ),
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

fn append_codex_global_mcp_disable_args(args: &mut Vec<String>) {
    let Some(path) = terminal_codex_global_config_path() else {
        return;
    };
    let Ok(body) = fs::read_to_string(path) else {
        return;
    };
    for server_key in codex_global_mcp_server_keys_from_config(&body) {
        args.push("-c".to_string());
        args.push(format!(
            "mcp_servers.{}.enabled=false",
            terminal_toml_key_segment(&server_key)
        ));
    }
}

fn terminal_codex_global_config_path() -> Option<PathBuf> {
    env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))
        .or_else(|| env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".codex")))
        .map(|home| home.join("config.toml"))
}

fn codex_global_mcp_server_keys_from_config(body: &str) -> Vec<String> {
    let mut keys = Vec::new();
    let mut seen = HashSet::new();
    for line in body.lines() {
        let Some(section) = terminal_toml_section_name(line) else {
            continue;
        };
        let Some(server_key) = terminal_codex_mcp_server_key_from_section(section) else {
            continue;
        };
        if TERMINAL_DIFFFORGE_MCP_SERVERS.contains(&server_key.as_str()) {
            continue;
        }
        if seen.insert(server_key.clone()) {
            keys.push(server_key);
        }
    }
    keys
}

fn terminal_toml_section_name(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    if trimmed.starts_with("[[") {
        return None;
    }
    trimmed
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn terminal_codex_mcp_server_key_from_section(section: &str) -> Option<String> {
    let rest = section.trim().strip_prefix("mcp_servers.")?;
    terminal_toml_first_key_segment(rest).filter(|key| !key.trim().is_empty())
}

fn terminal_toml_first_key_segment(value: &str) -> Option<String> {
    let value = value.trim_start();
    let quote = value.chars().next().filter(|quote| *quote == '"' || *quote == '\'');
    if let Some(quote) = quote {
        let mut key = String::new();
        let mut escaped = false;
        for character in value[quote.len_utf8()..].chars() {
            if quote == '"' && escaped {
                key.push(match character {
                    'n' => '\n',
                    'r' => '\r',
                    't' => '\t',
                    '"' => '"',
                    '\\' => '\\',
                    other => other,
                });
                escaped = false;
                continue;
            }
            if quote == '"' && character == '\\' {
                escaped = true;
                continue;
            }
            if character == quote {
                return Some(key);
            }
            key.push(character);
        }
        return None;
    }

    value
        .split('.')
        .next()
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_string)
}

fn terminal_toml_key_segment(value: &str) -> String {
    if !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
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

fn terminal_coordination_env_value(
    coordination: &TerminalCoordinationSession,
    key: &str,
) -> Option<String> {
    coordination.env_vars.iter().find_map(|(candidate, value)| {
        (candidate == key && !value.trim().is_empty()).then(|| value.clone())
    })
}

fn apply_codex_terminal_display_args(args: &mut Vec<String>) {
    if !terminal_args_have_option(args, "--no-alt-screen", "") {
        args.push("--no-alt-screen".to_string());
    }
}

fn apply_codex_coordinated_auto_approval_args(
    args: &mut Vec<String>,
    write_root: Option<&str>,
    codex_profile: Option<&str>,
    bypass_hook_trust: bool,
) {
    strip_terminal_arg_option(args, "--ask-for-approval", "-a", true);
    args.push("--ask-for-approval".to_string());
    args.push("never".to_string());
    strip_terminal_arg_option(args, "--profile", "-p", true);
    if let Some(profile) = codex_profile.filter(|value| !value.trim().is_empty()) {
        args.insert(0, profile.to_string());
        args.insert(0, "--profile".to_string());
    }

    // Diff Forge coordinated Codex sessions use an app-generated launch
    // profile layered on the normal Codex home. Keep older sandbox flags out
    // of the launch args so profile read/write carveouts actually take effect.
    strip_terminal_arg_option(args, "--sandbox", "-s", true);
    strip_terminal_arg_option(args, "--dangerously-bypass-approvals-and-sandbox", "", false);
    strip_terminal_arg_option(args, "--dangerously-bypass-hook-trust", "", false);

    if let Some(write_root) = write_root.filter(|value| !value.trim().is_empty()) {
        strip_terminal_arg_option(args, "--cd", "-C", true);
        args.push("--cd".to_string());
        args.push(write_root.to_string());
    }

    if !terminal_args_have_option_value(args, "--enable", "", "hooks") {
        args.push("--enable".to_string());
        args.push("hooks".to_string());
    }
    if bypass_hook_trust {
        args.push("--dangerously-bypass-hook-trust".to_string());
    }
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

fn apply_claude_coordinated_auto_approval_args(
    args: &mut Vec<String>,
    coordination: &TerminalCoordinationSession,
    coordination_args: &[String],
) {
    let coordination_root = terminal_coordination_env_value(coordination, "COORDINATION_AGENT_BRANCH_ROOT")
        .or_else(|| terminal_coordination_env_value(coordination, "COORDINATION_WORKTREE_PATH"))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| coordination.repo_path.clone());
    let enforcement_mode =
        terminal_coordination_env_value(coordination, "COORDINATION_ENFORCEMENT_MODE")
            .unwrap_or_default();
    let file_authority = terminal_coordination_env_value(coordination, "COORDINATION_FILE_AUTHORITY")
        .unwrap_or_default();
    let worktree_required = enforcement_mode.trim() == "worktree_required"
        || file_authority.trim() == "git_worktree_patch";
    let general_worker = enforcement_mode.trim() == "general_worker"
        || file_authority.trim() == "task_scoped";
    let direct_edit_allowed = enforcement_mode.trim() == "bounded_direct_edit"
        || file_authority.trim() == "bounded_direct_edit";
    let edit_root = if worktree_required || direct_edit_allowed {
        Some(coordination_root.clone())
    } else {
        None
    };
    let local_edit_allowed = edit_root.is_some();

    strip_terminal_arg_option(args, "--dangerously-skip-permissions", "", false);
    strip_terminal_arg_option(args, "--allow-dangerously-skip-permissions", "", false);

    strip_terminal_arg_option(args, "--add-dir", "", true);
    if !coordination_root.trim().is_empty() {
        args.push("--add-dir".to_string());
        args.push(coordination_root.clone());
    }
    if let Some(edit_root) = edit_root
        .as_deref()
        .filter(|value| !value.trim().is_empty() && value.trim() != coordination_root.trim())
    {
        args.push("--add-dir".to_string());
        args.push(edit_root.to_string());
    }

    strip_terminal_arg_option(args, "--allowedTools", "", true);
    strip_terminal_arg_option(args, "--allowed-tools", "", true);
    args.push("--allowedTools".to_string());
    args.push(claude_auto_approved_tools_arg(
        coordination,
        edit_root.as_deref(),
    ));

    strip_terminal_arg_option(args, "--mcp-config", "", true);
    args.push("--mcp-config".to_string());
    args.push(claude_coordination_mcp_config_arg(
        coordination,
        coordination_args,
    ));

    strip_terminal_arg_option(args, "--permission-mode", "", true);
    if local_edit_allowed || general_worker {
        args.push("--permission-mode".to_string());
        args.push("acceptEdits".to_string());
    }

    if let Some(edit_root) = edit_root.as_deref().filter(|value| !value.trim().is_empty()) {
        strip_terminal_arg_option(args, "--settings", "", true);
        args.push("--settings".to_string());
        args.push(claude_write_authority_guard_settings(
            coordination,
            edit_root,
            worktree_required || general_worker,
        ));

        strip_terminal_arg_option(args, "--setting-sources", "", true);
    }

    apply_claude_managed_mcp_isolation_args(args);
}

fn apply_claude_managed_mcp_isolation_args(args: &mut Vec<String>) {
    if terminal_args_have_any_option(args, &["--mcp-config"])
        && !terminal_args_have_any_option(args, &["--strict-mcp-config"])
    {
        args.push("--strict-mcp-config".to_string());
    }
}

fn claude_auto_approved_tools_arg(
    coordination: &TerminalCoordinationSession,
    allowed_edit_root: Option<&str>,
) -> String {
    let mut tools = ["Read", "Glob", "Grep", "LS"]
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    if let Some(root) = allowed_edit_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(claude_absolute_permission_glob)
    {
        tools.push(format!("Edit({root})"));
        tools.push(format!("Write({root})"));
        tools.push(format!("NotebookEdit({root})"));
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
        ]
        .into_iter()
        .map(|tool| format!("mcp__workspace-mcp-gateway__{tool}")),
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
    write_root: &str,
    worktree_required: bool,
) -> String {
    let write_root = write_root.trim();
    let edit_root = claude_absolute_permission_glob(write_root);
    let guard_command = if worktree_required {
        claude_worktree_guard_hook_command(coordination, write_root)
    } else {
        diff_forge_write_guard_hook_command(coordination, write_root, "claude")
    };
    let mut deny_rules = vec![
        format!(
            "Edit({})",
            claude_absolute_permission_glob(
                PathBuf::from(&coordination.repo_path)
                    .join(".git")
                    .to_string_lossy()
                    .as_ref()
            )
        ),
        format!(
            "Write({})",
            claude_absolute_permission_glob(
                PathBuf::from(&coordination.repo_path)
                    .join(".git")
                    .to_string_lossy()
                    .as_ref()
            )
        ),
    ];

    if cfg!(windows) {
        deny_rules.extend(
            ["Bash", "PowerShell", "Monitor"]
                .into_iter()
                .map(str::to_string),
        );
    }

    let mut settings = json!({
        "disableBypassPermissionsMode": "disable",
        "permissions": {
            "defaultMode": "acceptEdits",
            "allow": [
                format!("Edit({edit_root})")
            ],
            "deny": deny_rules
        },
        "hooks": {
            "PreToolUse": [
                {
                    "matcher": "Edit|Write|NotebookEdit",
                    "hooks": [
                        {
                            "type": "command",
                            "command": guard_command
                        }
                    ]
                },
                {
                    "matcher": "Bash|PowerShell|Monitor",
                    "hooks": [
                        {
                            "type": "command",
                            "command": guard_command
                        }
                    ]
                }
            ]
        }
    });

    if !cfg!(windows) {
        settings["sandbox"] = json!({
            "enabled": true,
            "failIfUnavailable": true,
            "allowUnsandboxedCommands": false,
            "filesystem": {
                "allowWrite": [write_root]
            }
        });
    }

    settings.to_string()
}

fn claude_absolute_permission_glob(path: &str) -> String {
    let mut path = claude_permission_absolute_path(path);
    while path.ends_with('/') && path.len() > 2 {
        path.pop();
    }
    format!("{path}/**")
}

fn claude_permission_absolute_path(path: &str) -> String {
    let normalized = path.trim().replace('\\', "/");
    if normalized.is_empty() {
        return "//".to_string();
    }

    #[cfg(windows)]
    {
        let bytes = normalized.as_bytes();
        if bytes.len() >= 3
            && bytes[1] == b':'
            && bytes[2] == b'/'
            && bytes[0].is_ascii_alphabetic()
        {
            let drive = (bytes[0] as char).to_ascii_lowercase();
            let rest = normalized[3..].trim_start_matches('/');
            return if rest.is_empty() {
                format!("//{drive}")
            } else {
                format!("//{drive}/{rest}")
            };
        }
    }

    if normalized.starts_with("//") {
        normalized
    } else if normalized.starts_with('/') {
        format!("/{normalized}")
    } else {
        format!("//{normalized}")
    }
}

fn claude_worktree_guard_hook_command(
    coordination: &TerminalCoordinationSession,
    write_root: &str,
) -> String {
    let slot_key = terminal_coordination_env_value(coordination, "COORDINATION_SLOT_KEY")
        .unwrap_or_else(|| "unknown".to_string());
    let command_path = coordination.mcp_command.as_str();

    #[cfg(windows)]
    {
        format!(
            "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"& {} --claude-worktree-guard --repo-path {} --db-path {} --agent-id {} --session-id {} --worktree-path {} --slot-key {}\"",
            quote_powershell_literal(command_path),
            quote_powershell_literal(&coordination.repo_path),
            quote_powershell_literal(&coordination.db_path),
            quote_powershell_literal(&coordination.agent_id),
            quote_powershell_literal(&coordination.session_id),
            quote_powershell_literal(write_root),
            quote_powershell_literal(&slot_key),
        )
    }

    #[cfg(not(windows))]
    {
        format!(
            "{} --claude-worktree-guard --repo-path {} --db-path {} --agent-id {} --session-id {} --worktree-path {} --slot-key {}",
            quote_shell_literal(command_path),
            quote_shell_literal(&coordination.repo_path),
            quote_shell_literal(&coordination.db_path),
            quote_shell_literal(&coordination.agent_id),
            quote_shell_literal(&coordination.session_id),
            quote_shell_literal(write_root),
            quote_shell_literal(&slot_key),
        )
    }
}

fn diff_forge_write_guard_hook_command(
    coordination: &TerminalCoordinationSession,
    write_root: &str,
    provider: &str,
) -> String {
    let slot_key = terminal_coordination_env_value(coordination, "COORDINATION_SLOT_KEY")
        .unwrap_or_else(|| "unknown".to_string());
    let command_path = coordination.mcp_command.as_str();
    let agent_kind = coordination.agent_kind.as_str();

    #[cfg(windows)]
    {
        format!(
            "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"& {} --diff-forge-write-guard --provider {} --repo-path {} --db-path {} --agent-id {} --session-id {} --slot-key {} --agent-kind {}\"",
            quote_powershell_literal(command_path),
            quote_powershell_literal(provider),
            quote_powershell_literal(write_root),
            quote_powershell_literal(&coordination.db_path),
            quote_powershell_literal(&coordination.agent_id),
            quote_powershell_literal(&coordination.session_id),
            quote_powershell_literal(&slot_key),
            quote_powershell_literal(agent_kind),
        )
    }

    #[cfg(not(windows))]
    {
        format!(
            "{} --diff-forge-write-guard --provider {} --repo-path {} --db-path {} --agent-id {} --session-id {} --slot-key {} --agent-kind {}",
            quote_shell_literal(command_path),
            quote_shell_literal(provider),
            quote_shell_literal(write_root),
            quote_shell_literal(&coordination.db_path),
            quote_shell_literal(&coordination.agent_id),
            quote_shell_literal(&coordination.session_id),
            quote_shell_literal(&slot_key),
            quote_shell_literal(agent_kind),
        )
    }
}

pub fn run_claude_worktree_guard(args: &[String]) -> i32 {
    let repo_path = terminal_cli_arg_value(args, "--repo-path");
    let db_path = terminal_cli_arg_or_env(args, "--db-path", &["COORDINATION_DB_PATH"]);
    let agent_id = terminal_cli_arg_or_env(
        args,
        "--agent-id",
        &["COORDINATION_AGENT_ID", "DIFFFORGE_AGENT_ID"],
    );
    let session_id = terminal_cli_arg_or_env(
        args,
        "--session-id",
        &["COORDINATION_SESSION_ID", "DIFFFORGE_SESSION_ID"],
    );
    let worktree_path = terminal_cli_arg_value(args, "--worktree-path");
    let slot_key = terminal_cli_arg_value(args, "--slot-key").unwrap_or("unknown");

    let Some(repo_path) = repo_path.filter(|value| !value.trim().is_empty()) else {
        print_claude_worktree_guard_deny("Diff Forge Claude guard is missing the repo path.");
        return 0;
    };
    let Some(worktree_path) = worktree_path.filter(|value| !value.trim().is_empty()) else {
        print_claude_worktree_guard_deny("Diff Forge Claude guard is missing the worktree path.");
        return 0;
    };

    let mut input = String::new();
    if let Err(error) = std::io::stdin().read_to_string(&mut input) {
        print_claude_worktree_guard_deny(&format!(
            "Diff Forge Claude guard could not read hook input: {error}."
        ));
        return 0;
    }
    let hook_input = match serde_json::from_str::<Value>(&input) {
        Ok(value) => value,
        Err(error) => {
            print_claude_worktree_guard_deny(&format!(
                "Diff Forge Claude guard received invalid hook input: {error}."
            ));
            return 0;
        }
    };

    if let Some(reason) = claude_worktree_guard_denial_reason(
        &hook_input,
        Path::new(repo_path),
        Path::new(worktree_path),
        slot_key,
        &DiffForgeWriteGuardIdentity::new(agent_id, session_id, db_path.map(PathBuf::from)),
    ) {
        print_claude_worktree_guard_deny(&reason);
    }

    0
}

pub fn run_diff_forge_write_guard(args: &[String]) -> i32 {
    let provider = terminal_cli_arg_or_env(args, "--provider", &["DIFFFORGE_HOOK_PROVIDER"])
        .unwrap_or_else(|| "codex".to_string());
    let repo_path = terminal_cli_arg_or_env(
        args,
        "--repo-path",
        &[
            "COORDINATION_REPO_PATH",
            "COORDINATION_PROJECT_ROOT",
            "DIFFFORGE_REPO_PATH",
            "COORDINATION_WRITE_ROOT",
        ],
    );
    let slot_key = terminal_cli_arg_or_env(args, "--slot-key", &["COORDINATION_SLOT_KEY"])
        .unwrap_or_else(|| "unknown".to_string());
    let db_path = terminal_cli_arg_or_env(args, "--db-path", &["COORDINATION_DB_PATH"]);
    let agent_id = terminal_cli_arg_or_env(
        args,
        "--agent-id",
        &["COORDINATION_AGENT_ID", "DIFFFORGE_AGENT_ID"],
    );
    let session_id = terminal_cli_arg_or_env(
        args,
        "--session-id",
        &["COORDINATION_SESSION_ID", "DIFFFORGE_SESSION_ID"],
    );
    let agent_kind = terminal_cli_arg_or_env(
        args,
        "--agent-kind",
        &["COORDINATION_AGENT_KIND", "DIFFFORGE_AGENT_KIND"],
    )
    .unwrap_or_else(|| provider.clone());

    let Some(repo_path) = repo_path.filter(|value| !value.trim().is_empty()) else {
        print_diff_forge_pre_tool_deny(
            &provider,
            "Diff Forge write guard is missing the coordination root.",
        );
        return 0;
    };

    let mut input = String::new();
    if let Err(error) = std::io::stdin().read_to_string(&mut input) {
        print_diff_forge_pre_tool_deny(
            &provider,
            &format!("Diff Forge write guard could not read hook input: {error}."),
        );
        return 0;
    }
    let hook_input = match serde_json::from_str::<Value>(&input) {
        Ok(value) => value,
        Err(error) => {
            print_diff_forge_pre_tool_deny(
                &provider,
                &format!("Diff Forge write guard received invalid hook input: {error}."),
            );
            return 0;
        }
    };

    match diff_forge_write_guard_decision(
        &provider,
        &hook_input,
        Path::new(&repo_path),
        &slot_key,
        &agent_kind,
        &DiffForgeWriteGuardIdentity::new(agent_id, session_id, db_path.map(PathBuf::from)),
    ) {
        Ok(Some(output)) => println!("{output}"),
        Ok(None) => {}
        Err(error) => print_diff_forge_pre_tool_deny(&provider, &error),
    }

    0
}

fn diff_forge_write_guard_decision(
    provider: &str,
    hook_input: &Value,
    coordination_root: &Path,
    slot_key: &str,
    agent_kind: &str,
    identity: &DiffForgeWriteGuardIdentity,
) -> Result<Option<Value>, String> {
    let tool_name = hook_input["tool_name"]
        .as_str()
        .unwrap_or_default()
        .trim();
    let tool_key = tool_name.to_ascii_lowercase();
    let tool_input = &hook_input["tool_input"];

    if matches!(
        tool_key.as_str(),
        "bash"
            | "powershell"
            | "monitor"
            | "shell"
            | "sh"
            | "zsh"
            | "exec_command"
            | "functions.exec_command"
            | "run_command"
            | "command"
    ) {
        if tool_input["dangerouslyDisableSandbox"].as_bool() == Some(true)
            || tool_input["dangerously_disable_sandbox"].as_bool() == Some(true)
        {
            return Err(
                "Diff Forge denied this shell command because it requested unsandboxed execution."
                    .to_string(),
            );
        }
        if matches!(
            tool_key.as_str(),
            "bash"
                | "powershell"
                | "shell"
                | "sh"
                | "zsh"
                | "exec_command"
                | "functions.exec_command"
                | "run_command"
                | "command"
        ) {
            let cwd = hook_input["cwd"]
                .as_str()
                .filter(|value| !value.trim().is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| coordination_root.to_path_buf());
            if let Some(reason) =
                diff_forge_shell_git_write_denial_reason(
                    tool_input,
                    &cwd,
                    slot_key,
                    agent_kind,
                    identity,
                )?
            {
                return Err(reason);
            }
        }
        return Ok(None);
    }

    if provider.eq_ignore_ascii_case("codex") && tool_key == "apply_patch" {
        let command = tool_input["command"]
            .as_str()
            .ok_or_else(|| "Diff Forge denied apply_patch because the patch command was missing.".to_string())?;
        let cwd = hook_input["cwd"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| coordination_root.to_path_buf());
        let rewrite =
            diff_forge_rewrite_apply_patch(command, &cwd, slot_key, agent_kind, identity)?;
        if rewrite.changed {
            return Ok(Some(json!({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow",
                    "permissionDecisionReason": "Diff Forge routed Git repository edits to the assigned worktree.",
                    "updatedInput": {
                        "command": rewrite.command
                    },
                    "additionalContext": rewrite.summary
                }
            })));
        }
        return Ok(None);
    }

    if matches!(
        tool_key.as_str(),
        "edit" | "write" | "multiedit" | "notebookedit"
    ) {
        let cwd = hook_input["cwd"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| coordination_root.to_path_buf());
        let mut candidate_paths = Vec::new();
        claude_guard_collect_tool_paths(tool_input, &mut candidate_paths);
        if candidate_paths.is_empty() {
            return Err(format!(
                "Diff Forge denied this {tool_name} call because the tool did not provide a target file path."
            ));
        }
        for candidate in candidate_paths {
            let candidate_path = claude_guard_resolved_path(&PathBuf::from(candidate), &cwd);
            if let Some(reason) =
                diff_forge_git_write_denial_reason(
                    &candidate_path,
                    slot_key,
                    agent_kind,
                    identity,
                    true,
                )?
            {
                return Err(reason);
            }
        }
    }

    Ok(None)
}

#[derive(Debug, Clone)]
struct DiffForgeApplyPatchRewrite {
    command: String,
    changed: bool,
    summary: String,
}

#[derive(Debug, Clone, Default)]
struct DiffForgeWriteGuardIdentity {
    agent_id: Option<String>,
    session_id: Option<String>,
    db_path: Option<PathBuf>,
}

impl DiffForgeWriteGuardIdentity {
    fn new(agent_id: Option<String>, session_id: Option<String>, db_path: Option<PathBuf>) -> Self {
        Self {
            agent_id: agent_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            session_id: session_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            db_path,
        }
    }
}

#[derive(Debug, Clone)]
struct DiffForgeActiveGitWriteAuthority {
    task_id: String,
    agent_id: String,
    session_id: String,
    worktree_root: PathBuf,
}

#[derive(Debug, Clone)]
struct DiffForgeGitWriteRoute {
    mapped_path: PathBuf,
}

fn diff_forge_rewrite_apply_patch(
    command: &str,
    cwd: &Path,
    slot_key: &str,
    agent_kind: &str,
    identity: &DiffForgeWriteGuardIdentity,
) -> Result<DiffForgeApplyPatchRewrite, String> {
    let mut changed = false;
    let mut routes = Vec::new();
    let mut lines = Vec::new();
    for line in command.lines() {
        let mut rewritten = line.to_string();
        for prefix in [
            "*** Update File: ",
            "*** Add File: ",
            "*** Delete File: ",
            "*** Move to: ",
        ] {
            if let Some(path) = line.strip_prefix(prefix) {
                let path = path.trim();
                if !path.is_empty() {
                    let absolute = claude_guard_resolved_path(&PathBuf::from(path), cwd);
                    if let Some(route) =
                        diff_forge_git_write_route(&absolute, slot_key, agent_kind, identity, true)?
                    {
                        rewritten = format!("{prefix}{}", route.mapped_path.display());
                        changed = true;
                        routes.push(format!(
                            "{} -> {}",
                            absolute.display(),
                            route.mapped_path.display()
                        ));
                    }
                }
                break;
            }
        }
        lines.push(rewritten);
    }
    let mut next = lines.join("\n");
    if command.ends_with('\n') {
        next.push('\n');
    }
    let summary = if routes.is_empty() {
        String::new()
    } else {
        format!(
            "Diff Forge routed Git repository patch paths through worktrees: {}",
            routes.join("; ")
        )
    };
    Ok(DiffForgeApplyPatchRewrite {
        command: next,
        changed,
        summary,
    })
}

fn diff_forge_git_write_denial_reason(
    candidate_path: &Path,
    slot_key: &str,
    agent_kind: &str,
    identity: &DiffForgeWriteGuardIdentity,
    require_lease: bool,
) -> Result<Option<String>, String> {
    let Some(route) =
        diff_forge_git_write_route(candidate_path, slot_key, agent_kind, identity, require_lease)?
    else {
        return Ok(None);
    };
    if terminal_paths_equal(candidate_path, &route.mapped_path) {
        return Ok(None);
    }
    Ok(Some(format!(
        "Diff Forge denied this direct Git repository edit. Edit the assigned worktree path instead: {}",
        route.mapped_path.display()
    )))
}

fn diff_forge_shell_git_write_denial_reason(
    tool_input: &Value,
    cwd: &Path,
    slot_key: &str,
    agent_kind: &str,
    identity: &DiffForgeWriteGuardIdentity,
) -> Result<Option<String>, String> {
    let command = tool_input["command"]
        .as_str()
        .or_else(|| tool_input["cmd"].as_str())
        .unwrap_or_default();
    if !diff_forge_shell_command_may_write(command) {
        return Ok(None);
    }

    let mut cwd_is_slot_worktree_git_root = false;
    if let Some(repo_root) = diff_forge_nearest_git_root(cwd) {
        if !diff_forge_path_is_slot_worktree_root(&repo_root, slot_key) {
            if let Some(reason) =
                diff_forge_git_write_denial_reason(
                    &repo_root,
                    slot_key,
                    agent_kind,
                    identity,
                    false,
                )?
            {
                return Ok(Some(format!(
                    "{reason} Shell commands that mutate Git repositories must run through the routed worktree path."
                )));
            }
        } else {
            diff_forge_git_write_route(&repo_root, slot_key, agent_kind, identity, false)?;
            cwd_is_slot_worktree_git_root = true;
        }
    }

    let candidate_paths = diff_forge_shell_command_path_candidates(command, cwd);
    if candidate_paths.is_empty() && cwd_is_slot_worktree_git_root {
        return Ok(Some(
            "Diff Forge denied this mutating shell command because it did not expose an explicit file path to verify a write lease. Use Edit/Write/apply_patch or name the target file in the shell command after acquiring its lease."
                .to_string(),
        ));
    }

    for candidate in candidate_paths {
        if let Some(reason) =
            diff_forge_git_write_denial_reason(&candidate, slot_key, agent_kind, identity, true)?
        {
            return Ok(Some(format!(
                "{reason} Shell commands that mutate Git repositories must run through the routed worktree path."
            )));
        }
    }

    Ok(None)
}

fn diff_forge_shell_command_may_write(command: &str) -> bool {
    let lowered = command.to_ascii_lowercase();
    if lowered.contains(">")
        || lowered.contains("sed -i")
        || lowered.contains("perl -pi")
        || lowered.contains("python -c")
        || lowered.contains("node -e")
    {
        return true;
    }

    let normalized = lowered
        .replace(['\n', '\r', '\t', ';', '&', '|', '(', ')'], " ");
    let tokens = normalized.split_whitespace().collect::<Vec<_>>();
    tokens.iter().enumerate().any(|(index, token)| {
        matches!(
            *token,
            "touch"
                | "rm"
                | "rmdir"
                | "mv"
                | "cp"
                | "mkdir"
                | "tee"
                | "install"
                | "truncate"
                | "patch"
        ) || (*token == "git"
            && tokens
                .iter()
                .skip(index + 1)
                .copied()
                .find(|next| !next.starts_with('-') && *next != "-c")
                .is_some_and(|subcommand| {
                    matches!(
                        subcommand,
                        "add"
                            | "am"
                            | "apply"
                            | "checkout"
                            | "cherry-pick"
                            | "clean"
                            | "commit"
                            | "init"
                            | "merge"
                            | "mv"
                            | "rebase"
                            | "reset"
                            | "restore"
                            | "rm"
                            | "switch"
                    )
                }))
    })
}

fn diff_forge_shell_command_path_candidates(command: &str, cwd: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let tokens = command
        .replace(['\n', '\r', '\t', ';', '&', '|', '(', ')', '<', '>'], " ")
        .split_whitespace()
        .map(diff_forge_clean_shell_path_token)
        .collect::<Vec<_>>();
    for token in &tokens {
        if diff_forge_shell_token_looks_like_path(token, false) {
            candidates.push(claude_guard_resolved_path(&PathBuf::from(token), cwd));
        }
    }

    let redirect_tokens = command
        .replace(['\n', '\r', '\t', ';', '&', '|', '(', ')', '<'], " ")
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    for (index, token) in redirect_tokens.iter().enumerate() {
        if !diff_forge_shell_token_is_redirect(token) {
            continue;
        }
        let Some(next) = redirect_tokens.get(index + 1) else {
            continue;
        };
        let candidate = diff_forge_clean_shell_path_token(next);
        if diff_forge_shell_token_looks_like_path(&candidate, true) {
            candidates.push(claude_guard_resolved_path(&PathBuf::from(candidate), cwd));
        }
    }

    candidates
}

fn diff_forge_clean_shell_path_token(token: &str) -> String {
    token
        .trim_matches(|ch: char| {
            matches!(ch, '\'' | '"' | '`' | ',' | ':' | '[' | ']' | '{' | '}')
        })
        .trim()
        .to_string()
}

fn diff_forge_shell_token_is_redirect(token: &str) -> bool {
    let token = token.trim();
    matches!(token, ">" | ">>" | "1>" | "1>>" | "2>" | "2>>")
        || token.ends_with('>')
        || token.ends_with(">>")
}

fn diff_forge_shell_token_looks_like_path(token: &str, allow_plain_filename: bool) -> bool {
    let token = token.trim();
    if token.is_empty()
        || token.starts_with('-')
        || token.starts_with('$')
        || token.starts_with('&')
        || token.contains("://")
    {
        return false;
    }
    if token.contains('/') || token.starts_with('.') {
        return true;
    }
    allow_plain_filename
}

fn diff_forge_git_write_route(
    candidate_path: &Path,
    slot_key: &str,
    agent_kind: &str,
    identity: &DiffForgeWriteGuardIdentity,
    require_lease: bool,
) -> Result<Option<DiffForgeGitWriteRoute>, String> {
    let _ = agent_kind;
    let candidate_path = claude_guard_existing_or_parent_canonical_path(candidate_path);
    if diff_forge_path_is_in_other_slot_worktree(&candidate_path, slot_key) {
        return Err(format!(
            "Diff Forge denied this edit because {} is inside another terminal slot's worktree.",
            candidate_path.display()
        ));
    }

    let Some(repo_root) = diff_forge_nearest_git_root(&candidate_path) else {
        return Ok(None);
    };
    if let Some(worktree) = diff_forge_slot_worktree_context(&candidate_path) {
        if !worktree.slot_matches(slot_key) {
            return Err(format!(
                "Diff Forge denied this edit because {} is inside another terminal slot's worktree.",
                candidate_path.display()
            ));
        }
        if terminal_paths_equal(&repo_root, &worktree.worktree_root) {
            let authority =
                diff_forge_active_git_write_authority(&worktree.repo_root, slot_key, identity)?;
            diff_forge_validate_authority_worktree(&authority, &worktree.worktree_root)?;
            let resource_key =
                diff_forge_file_resource_key(&candidate_path, &worktree.worktree_root);
            if require_lease {
                diff_forge_validate_active_write_lease(
                    &worktree.repo_root,
                    identity,
                    &authority,
                    resource_key.as_deref(),
                )?;
            }
            return Ok(Some(DiffForgeGitWriteRoute {
                mapped_path: candidate_path,
            }));
        }
    }
    if diff_forge_path_is_slot_worktree_root(&repo_root, slot_key) {
        let worktree = diff_forge_slot_worktree_context(&repo_root).ok_or_else(|| {
            format!(
                "Diff Forge denied this edit because {} is not a valid Diff Forge worktree.",
                repo_root.display()
            )
        })?;
        let authority =
            diff_forge_active_git_write_authority(&worktree.repo_root, slot_key, identity)?;
        diff_forge_validate_authority_worktree(&authority, &worktree.worktree_root)?;
        if require_lease {
            diff_forge_validate_active_write_lease(&worktree.repo_root, identity, &authority, None)?;
        }
        return Ok(Some(DiffForgeGitWriteRoute {
            mapped_path: candidate_path,
        }));
    }
    if diff_forge_path_is_in_other_slot_worktree(&repo_root, slot_key) {
        return Err(format!(
            "Diff Forge denied this edit because {} is inside another terminal slot's worktree.",
            candidate_path.display()
        ));
    }

    let authority = diff_forge_active_git_write_authority(&repo_root, slot_key, identity)?;
    let worktree = authority.worktree_root.clone();
    let relative = candidate_path
        .strip_prefix(&repo_root)
        .map_err(|_| {
            format!(
                "Unable to map {} relative to Git root {}.",
                candidate_path.display(),
                repo_root.display()
            )
        })?;
    let resource_key = diff_forge_file_resource_key(&candidate_path, &repo_root);
    if require_lease {
        diff_forge_validate_active_write_lease(&repo_root, identity, &authority, resource_key.as_deref())?;
    }
    Ok(Some(DiffForgeGitWriteRoute {
        mapped_path: worktree.join(relative),
    }))
}

#[derive(Debug, Clone)]
struct DiffForgeSlotWorktreeContext {
    repo_root: PathBuf,
    worktree_root: PathBuf,
    slot_segment: String,
}

impl DiffForgeSlotWorktreeContext {
    fn slot_matches(&self, slot_key: &str) -> bool {
        let slot_key = slot_key.trim();
        !slot_key.is_empty()
            && (self.slot_segment == slot_key
                || self.slot_segment.starts_with(&format!("{slot_key}-")))
    }
}

fn diff_forge_slot_worktree_context(path: &Path) -> Option<DiffForgeSlotWorktreeContext> {
    let path = claude_guard_clean_path(path);
    let components = path
        .components()
        .map(|component| component.as_os_str().to_os_string())
        .collect::<Vec<_>>();
    let mut built = PathBuf::new();
    for (index, component) in components.iter().enumerate() {
        built.push(component);
        if component.to_string_lossy() != ".agents" {
            continue;
        }
        let Some(worktrees) = components.get(index + 1) else {
            continue;
        };
        let Some(slot_segment) = components.get(index + 2) else {
            continue;
        };
        if worktrees.to_string_lossy() != "worktrees" {
            continue;
        }
        let repo_root = built.parent()?.to_path_buf();
        let worktree_root = components
            .iter()
            .take(index + 3)
            .fold(PathBuf::new(), |mut path, segment| {
                path.push(segment);
                path
            });
        return Some(DiffForgeSlotWorktreeContext {
            repo_root,
            worktree_root,
            slot_segment: slot_segment.to_string_lossy().to_string(),
        });
    }
    None
}

fn diff_forge_active_git_write_authority(
    repo_root: &Path,
    slot_key: &str,
    identity: &DiffForgeWriteGuardIdentity,
) -> Result<DiffForgeActiveGitWriteAuthority, String> {
    let Some(agent_id) = identity.agent_id.as_deref() else {
        return Err(diff_forge_start_task_required_message());
    };
    let Some(session_id) = identity.session_id.as_deref() else {
        return Err(diff_forge_start_task_required_message());
    };
    let kernel = crate::coordination::CoordinationKernel::open_for_shutdown_cleanup(
        repo_root,
        diff_forge_identity_db_path_for_repo(identity, repo_root),
    )
    .map_err(|error| {
        if error.contains("Coordination database does not exist") {
            return diff_forge_start_task_required_message();
        }
        format!(
            "Diff Forge denied this Git write because coordination state could not be opened for {}: {error}",
            repo_root.display()
        )
    })?;
    let mut rows = kernel.query_json(
        "SELECT s.id AS session_id,
                s.agent_id,
                s.agent_slot_id,
                s.task_id,
                s.status AS session_status,
                s.worktree_id,
                s.write_root,
                s.enforcement_mode,
                sl.slot_key,
                t.status AS task_status,
                t.claimed_session_id,
                w.path AS recorded_worktree_path,
                w.agent_slot_id AS worktree_slot_id
         FROM agent_sessions s
         LEFT JOIN agent_slots sl ON sl.id=s.agent_slot_id
         LEFT JOIN tasks t ON t.id=s.task_id
         LEFT JOIN worktrees w ON w.id=s.worktree_id
         WHERE s.id=?1 AND s.agent_id=?2
         LIMIT 1",
        &[&session_id, &agent_id],
    ).map_err(|error| {
        if error.contains("no such table: agent_sessions") {
            diff_forge_start_task_required_message()
        } else {
            format!(
                "Diff Forge denied this Git write because coordination state could not be read for {}: {error}",
                repo_root.display()
            )
        }
    })?;
    let Some(session) = rows.pop() else {
        return Err(diff_forge_start_task_required_message());
    };
    if session["session_status"].as_str() != Some("active") {
        return Err(
            "Diff Forge denied this Git write because this terminal coordination session is not active."
                .to_string(),
        );
    }
    if let Some(recorded_slot_key) = session["slot_key"].as_str().filter(|value| !value.is_empty())
    {
        if recorded_slot_key != slot_key {
            return Err(format!(
                "Diff Forge denied this Git write because terminal slot {recorded_slot_key} does not match hook slot {slot_key}."
            ));
        }
    }
    let Some(task_id) = session["task_id"].as_str().filter(|value| !value.trim().is_empty()) else {
        return Err(diff_forge_start_task_required_message());
    };
    let claimed_session_id = session["claimed_session_id"].as_str().unwrap_or_default();
    if claimed_session_id != session_id {
        return Err(
            "Diff Forge denied this Git write because the active task is not claimed by this terminal session."
                .to_string(),
        );
    }
    if diff_forge_task_status_is_terminal(session["task_status"].as_str().unwrap_or_default()) {
        return Err(
            "Diff Forge denied this Git write because this terminal's task has already finished."
                .to_string(),
        );
    }
    let Some(_worktree_id) = session["worktree_id"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
    else {
        return Err(
            "Diff Forge denied this Git write because this task has no assigned worktree. Call acquire_lease for the file before editing."
                .to_string(),
        );
    };
    let worktree_path = session["recorded_worktree_path"]
        .as_str()
        .or_else(|| session["write_root"].as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "Diff Forge denied this Git write because this task has no recorded worktree path."
                .to_string()
        })?;
    let worktree_root = claude_guard_existing_or_parent_canonical_path(Path::new(worktree_path));
    if !diff_forge_path_is_slot_worktree_root(&worktree_root, slot_key) {
        return Err(format!(
            "Diff Forge denied this Git write because {} is not this terminal slot's assigned worktree.",
            worktree_root.display()
        ));
    }
    Ok(DiffForgeActiveGitWriteAuthority {
        task_id: task_id.to_string(),
        agent_id: agent_id.to_string(),
        session_id: session_id.to_string(),
        worktree_root,
    })
}

fn diff_forge_validate_authority_worktree(
    authority: &DiffForgeActiveGitWriteAuthority,
    worktree_root: &Path,
) -> Result<(), String> {
    if terminal_paths_equal(&authority.worktree_root, worktree_root) {
        return Ok(());
    }
    Err(format!(
        "Diff Forge denied this Git write because {} is not the active task worktree for this terminal.",
        worktree_root.display()
    ))
}

fn diff_forge_validate_active_write_lease(
    repo_root: &Path,
    identity: &DiffForgeWriteGuardIdentity,
    authority: &DiffForgeActiveGitWriteAuthority,
    resource_key: Option<&str>,
) -> Result<(), String> {
    let Some(resource_key) = resource_key.filter(|value| !value.trim().is_empty()) else {
        return Ok(());
    };
    let kernel = crate::coordination::CoordinationKernel::open_for_shutdown_cleanup(
        repo_root,
        diff_forge_identity_db_path_for_repo(identity, repo_root),
    )
    .map_err(|error| {
        format!(
            "Diff Forge denied this Git write because lease state could not be opened for {}: {error}",
            repo_root.display()
        )
    })?;
    let now = crate::coordination::kernel::now_rfc3339();
    let leases = kernel.query_json(
        "SELECT l.mode, r.resource_key
         FROM leases l
         JOIN resources r ON r.id=l.resource_id
         WHERE l.status='active'
           AND l.expires_at >= ?1
           AND l.task_id=?2
           AND l.agent_id=?3
           AND l.session_id=?4",
        &[
            &now,
            &authority.task_id,
            &authority.agent_id,
            &authority.session_id,
        ],
    )?;
    if leases.iter().any(|lease| {
        crate::coordination::resources::is_write_like(lease["mode"].as_str().unwrap_or_default())
            && crate::coordination::resources::resource_covers(
                lease["resource_key"].as_str().unwrap_or_default(),
                resource_key,
            )
    }) {
        return Ok(());
    }

    Err(format!(
        "Diff Forge denied this Git write because task {} has no active write lease covering {}. Call coordination-kernel.acquire_lease for this file before editing.",
        authority.task_id,
        resource_key
    ))
}

fn diff_forge_file_resource_key(path: &Path, root: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    if relative.as_os_str().is_empty() {
        return None;
    }
    Some(crate::coordination::resources::path_to_file_resource(
        &relative.to_string_lossy(),
    ))
}

fn diff_forge_identity_db_path_for_repo(
    identity: &DiffForgeWriteGuardIdentity,
    repo_root: &Path,
) -> Option<PathBuf> {
    let db_path = identity.db_path.as_ref()?;
    let db_path = claude_guard_existing_or_parent_canonical_path(db_path);
    let repo_root = claude_guard_existing_or_parent_canonical_path(repo_root);
    if claude_guard_path_is_inside(&db_path, &repo_root) {
        Some(db_path)
    } else {
        None
    }
}

fn diff_forge_task_status_is_terminal(status: &str) -> bool {
    matches!(
        status.trim(),
        "done" | "completed" | "merged" | "cancelled" | "interrupted" | "skipped"
    )
}

fn diff_forge_start_task_required_message() -> String {
    "Diff Forge denied this Git write because this terminal has no active task-owned worktree. Call coordination-kernel.start_task, then acquire_lease for the file, then use coordination-kernel.write_file/delete_file or a task-owned worktree edit."
        .to_string()
}

fn diff_forge_nearest_git_root(path: &Path) -> Option<PathBuf> {
    let resolved = claude_guard_existing_or_parent_canonical_path(path);
    let mut cursor = if resolved.is_dir() {
        resolved.as_path()
    } else {
        resolved.parent().unwrap_or(resolved.as_path())
    };
    loop {
        let dot_git = cursor.join(".git");
        if dot_git.is_dir() || dot_git.is_file() {
            return Some(claude_guard_clean_path(cursor));
        }
        let Some(parent) = cursor.parent() else {
            return None;
        };
        cursor = parent;
    }
}

fn diff_forge_path_is_in_other_slot_worktree(path: &Path, slot_key: &str) -> bool {
    diff_forge_worktree_slot_segment(path).is_some_and(|segment| {
        !(segment == slot_key || segment.starts_with(&format!("{slot_key}-")))
    })
}

fn diff_forge_path_is_slot_worktree_root(path: &Path, slot_key: &str) -> bool {
    let components = claude_guard_clean_path(path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    components.windows(3).enumerate().any(|(index, window)| {
        window[0] == ".agents"
            && window[1] == "worktrees"
            && (window[2] == slot_key || window[2].starts_with(&format!("{slot_key}-")))
            && index + 3 == components.len()
    })
}

fn diff_forge_worktree_slot_segment(path: &Path) -> Option<String> {
    let path = claude_guard_clean_path(path);
    let components = path
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    components.windows(3).find_map(|window| {
        (window[0] == ".agents" && window[1] == "worktrees").then(|| window[2].clone())
    })
}

fn terminal_paths_equal(left: &Path, right: &Path) -> bool {
    claude_guard_path_key(left) == claude_guard_path_key(right)
}

fn print_diff_forge_pre_tool_deny(provider: &str, reason: &str) {
    let provider = provider.trim().to_ascii_lowercase();
    if provider.contains("claude") {
        print_claude_worktree_guard_deny(reason);
        return;
    }
    println!(
        "{}",
        json!({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason
            }
        })
    );
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

fn print_claude_worktree_guard_deny(reason: &str) {
    println!(
        "{}",
        json!({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason
            }
        })
    );
}

fn claude_worktree_guard_denial_reason(
    hook_input: &Value,
    repo_path: &Path,
    worktree_path: &Path,
    slot_key: &str,
    identity: &DiffForgeWriteGuardIdentity,
) -> Option<String> {
    let tool_name = hook_input["tool_name"]
        .as_str()
        .unwrap_or_default()
        .trim();
    let tool_key = tool_name.to_ascii_lowercase();
    let tool_input = &hook_input["tool_input"];

    if matches!(tool_key.as_str(), "bash" | "powershell" | "monitor") {
        if tool_input["dangerouslyDisableSandbox"].as_bool() == Some(true)
            || tool_input["dangerously_disable_sandbox"].as_bool() == Some(true)
        {
            return Some(
                "Diff Forge denied this shell command because it requested unsandboxed execution."
                    .to_string(),
            );
        }
        if matches!(tool_key.as_str(), "bash" | "powershell") {
            let cwd = hook_input["cwd"]
                .as_str()
                .filter(|value| !value.trim().is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| worktree_path.to_path_buf());
            match diff_forge_shell_git_write_denial_reason(
                tool_input,
                &cwd,
                slot_key,
                "claude",
                identity,
            ) {
                Ok(Some(reason)) => return Some(reason),
                Ok(None) => {}
                Err(error) => return Some(error),
            }
        }
        return None;
    }

    if !matches!(
        tool_key.as_str(),
        "edit" | "write" | "multiedit" | "notebookedit"
    ) {
        return None;
    }

    let worktree = claude_guard_resolved_path(worktree_path, worktree_path);
    if !claude_guard_path_is_under_worktree(&worktree, repo_path, slot_key) {
        return Some(
            "Diff Forge denied this edit because the assigned worktree is not a valid terminal slot worktree."
                .to_string(),
        );
    }
    let authority =
        match diff_forge_active_git_write_authority(repo_path, slot_key, identity) {
            Ok(authority) => authority,
            Err(error) => return Some(error),
        };
    if let Err(error) = diff_forge_validate_authority_worktree(&authority, &worktree) {
        return Some(error);
    }

    let cwd = hook_input["cwd"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| worktree.clone());
    let mut candidate_paths = Vec::new();
    claude_guard_collect_tool_paths(tool_input, &mut candidate_paths);
    if candidate_paths.is_empty() {
        return Some(format!(
            "Diff Forge denied this {tool_name} call because Claude did not provide a target file path."
        ));
    }

    for candidate in candidate_paths {
        let candidate_path = claude_guard_resolved_path(&PathBuf::from(candidate), &cwd);
        if !claude_guard_path_is_inside(&candidate_path, &worktree) {
            return Some(format!(
                "Diff Forge denied this edit because {} is outside terminal slot {slot_key}'s assigned worktree {}.",
                candidate_path.display(),
                worktree.display()
            ));
        }
        let resource_key = diff_forge_file_resource_key(&candidate_path, &worktree);
        if let Err(error) =
            diff_forge_validate_active_write_lease(repo_path, identity, &authority, resource_key.as_deref())
        {
            return Some(error);
        }
    }

    None
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

fn claude_guard_resolved_path(path: &Path, cwd: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    claude_guard_existing_or_parent_canonical_path(&absolute)
}

fn claude_guard_existing_or_parent_canonical_path(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return claude_guard_clean_path(&canonical);
    }

    let mut missing = Vec::new();
    let mut cursor = path;
    while !cursor.exists() {
        if let Some(name) = cursor.file_name() {
            missing.push(name.to_os_string());
        }
        let Some(parent) = cursor.parent() else {
            return claude_guard_clean_path(path);
        };
        cursor = parent;
    }

    let mut resolved = cursor
        .canonicalize()
        .unwrap_or_else(|_| claude_guard_clean_path(cursor));
    for segment in missing.iter().rev() {
        resolved.push(segment);
    }
    claude_guard_clean_path(&resolved)
}

fn claude_guard_clean_path(path: &Path) -> PathBuf {
    let mut cleaned = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                cleaned.pop();
            }
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                cleaned.push(component.as_os_str());
            }
        }
    }
    cleaned
}

fn claude_guard_path_is_inside(path: &Path, root: &Path) -> bool {
    let path_key = claude_guard_path_key(path);
    let root_key = claude_guard_path_key(root);
    path_key == root_key || path_key.starts_with(&format!("{root_key}/"))
}

fn claude_guard_path_is_under_worktree(path: &Path, repo_path: &Path, slot_key: &str) -> bool {
    let worktrees_root = claude_guard_resolved_path(&repo_path.join(".agents").join("worktrees"), repo_path);
    if !claude_guard_path_is_inside(path, &worktrees_root) {
        return false;
    }
    let Ok(relative) = path.strip_prefix(&worktrees_root) else {
        return false;
    };
    let Some(Component::Normal(segment)) = relative.components().next() else {
        return false;
    };
    let segment = segment.to_string_lossy();
    segment == slot_key || segment.starts_with(&format!("{slot_key}-"))
}

fn claude_guard_path_key(path: &Path) -> String {
    claude_guard_clean_path(path)
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn claude_coordination_mcp_config_arg(
    coordination: &TerminalCoordinationSession,
    coordination_args: &[String],
) -> String {
    if let Some(path) = claude_coordination_mcp_config_path_arg(coordination) {
        return path;
    }

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
                    "alwaysOn": true,
                    "toggleable": false,
                    "identitySource": "terminal_launch_args",
                    "authority": "local_coordination_kernel"
                }
            }
        }
    })
    .to_string()
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
    if !provider_id
        .trim()
        .to_ascii_lowercase()
        .contains("opencode")
    {
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
    let report = kill_terminal_process_tree(child.as_mut());
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
    let mut last_error = format!(
        "{} is not installed or not available on PATH.",
        definition.label
    );

    for candidate in agent_command_candidates(definition) {
        match run_command_capture(&candidate, args, stdin_text, timeout, working_directory) {
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
                    reason: format!("OpenCode is configured with an image-capable model ({active_model})."),
                    active_model,
                    active_model_supports_images: true,
                },
                Some(false) => AgentImageInputStatus {
                    supported: false,
                    support: "unsupported",
                    reason: format!("OpenCode is configured with a text-only model ({active_model})."),
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

    if let Some(home) = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
    {
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

    None
}

fn install_agent_with_npm(provider: AgentProvider) -> AgentInstallResult {
    run_agent_npm_install(provider, false)
}

fn update_agent_with_npm(provider: AgentProvider) -> AgentInstallResult {
    run_agent_npm_install(provider, true)
}

fn run_agent_npm_install(provider: AgentProvider, is_update: bool) -> AgentInstallResult {
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
                "npm was not found on PATH. Use the {} instead.",
                definition.native_install_label
            ),
        };
    }

    let install = run_command_capture(
        npm_binary(),
        &["install", "-g", definition.install_package],
        None,
        Duration::from_secs(AGENT_INSTALL_TIMEOUT_SECS),
        None,
    );

    match install {
        Ok(capture) if capture.exit_code == Some(0) => AgentInstallResult {
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
        },
        Ok(capture) => failed_agent_install_result(
            definition,
            &command_output_text(&capture.stdout, &capture.stderr),
            "npm install returned a non-zero status.",
            if is_update { "update" } else { "install" },
        ),
        Err(error) => failed_agent_install_result(
            definition,
            &error,
            "Unable to run npm install.",
            if is_update { "update" } else { "install" },
        ),
    }
}

fn launch_login_terminal(provider: AgentProvider) -> Result<(), String> {
    ensure_app_not_shutting_down("agent login terminal")?;

    let definition = agent_definition(provider);
    let binary = npm_global_executable_path(definition)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| definition.binary.to_string());

    match provider {
        AgentProvider::Codex => run_login_terminal(definition.label, &binary, &["login"]),
        AgentProvider::Claude => run_login_terminal(definition.label, &binary, &[]),
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
fn run_login_terminal(title: &str, binary: &str, args: &[&str]) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NEW_CONSOLE: u32 = 0x00000010;

    let mut command = Command::new("cmd");
    command
        .arg("/K")
        .arg(binary)
        .args(args)
        .creation_flags(CREATE_NEW_CONSOLE);

    let child = command
        .spawn()
        .map_err(|error| format!("Unable to open {title} login terminal: {error}"))?;

    track_login_terminal_child(child);

    Ok(())
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
fn run_login_terminal(title: &str, binary: &str, args: &[&str]) -> Result<(), String> {
    let shell_command = std::iter::once(binary)
        .chain(args.iter().copied())
        .map(quote_shell_arg)
        .collect::<Vec<_>>()
        .join(" ");
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

#[cfg(all(unix, not(target_os = "macos")))]
fn run_login_terminal(title: &str, binary: &str, args: &[&str]) -> Result<(), String> {
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
        return Err("Images must be 4 MB or smaller.".to_string());
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
            return Err("Images must be 8 MB total or smaller.".to_string());
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
        return Err(format!(
            "Attach up to {MAX_FORGE_IMAGES} images per todo."
        ));
    }

    let mut decoded_images = Vec::with_capacity(images.len());
    let mut total_bytes = 0usize;

    for (index, image) in images.iter().enumerate() {
        let mime_type = image.mime_type.trim().to_ascii_lowercase();
        let decoded = decode_prompt_image(image, index)?;
        total_bytes += decoded.1.len();

        if total_bytes > MAX_FORGE_IMAGE_TOTAL_BYTES {
            return Err("Images must be 8 MB total or smaller.".to_string());
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

            object
                .values()
                .find_map(extract_session_id_from_json)
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
            let event_type = json_string(object.get("type")).unwrap_or_default().to_ascii_lowercase();
            let role = json_string(object.get("role")).unwrap_or_default().to_ascii_lowercase();

            if event_type == "result" {
                if let Some(result) = json_string(object.get("result")) {
                    texts.push(result);
                }
            }

            if role == "assistant" || event_type.contains("assistant") || event_type.contains("message") {
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
            items.iter().for_each(|child| collect_agent_turn_texts(child, texts));
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
    let mut args = vec!["exec".to_string()];
    if !provider_session_id.is_empty() {
        args.push("resume".to_string());
    }

    args.push("--skip-git-repo-check".to_string());
    args.push("--output-last-message".to_string());
    args.push(output_path.to_string_lossy().to_string());
    if let Some(model) = model {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    if !provider_session_id.is_empty() {
        args.push(provider_session_id.to_string());
    }
    args.push("-".to_string());
    args
}

fn build_claude_turn_args(model: Option<&str>, provider_session_id: &str, prompt: &str) -> Vec<String> {
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

fn build_opencode_turn_args(model: Option<&str>, provider_session_id: &str, prompt: &str, cwd: &Path) -> Vec<String> {
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

fn run_agent_thread_turn_for(request: AgentThreadTurnRequest) -> Result<AgentThreadTurnResult, String> {
    let provider = parse_agent_provider(&request.agent_id)?;
    let definition = agent_definition(provider);
    let prompt = request.prompt.trim();
    let model = normalize_forge_model(request.model)?;
    let requested_provider_session_id = clean_codex_id(request.provider_session_id.unwrap_or_default());

    if prompt.is_empty() {
        return Err("Write a message before sending.".to_string());
    }

    if prompt.len() > MAX_FORGE_PROMPT_LENGTH {
        return Err("Message is too long for a local agent turn.".to_string());
    }

    let working_directory = resolve_workspace_root_directory(request.working_directory.as_deref())?;
    let mut output_path = None;
    let (args, stdin_text) = match provider {
        AgentProvider::Codex => {
            let path = temporary_agent_output_path("codex")?;
            let args = build_codex_turn_args(
                model.as_deref(),
                &requested_provider_session_id,
                &path,
            );
            output_path = Some(path);
            (args, Some(prompt))
        }
        AgentProvider::Claude => (
            build_claude_turn_args(model.as_deref(), &requested_provider_session_id, prompt),
            None,
        ),
        AgentProvider::OpenCode => (
            build_opencode_turn_args(
                model.as_deref(),
                &requested_provider_session_id,
                prompt,
                &working_directory,
            ),
            None,
        ),
    };
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();

    let capture = run_agent_command_capture(
        definition,
        &arg_refs,
        stdin_text,
        Duration::from_secs(AGENT_THREAD_TURN_TIMEOUT_SECS),
        Some(&working_directory),
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
        clean_codex_transcript_text(command_output_text(&stdout, &stderr), CODEX_TRANSCRIPT_MAX_TEXT)
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
            requested_provider_session_id.clone()
        } else {
            parsed_session_id
        },
        requested_provider_session_id,
        stderr,
        working_directory: workspace_path_display(&working_directory),
    })
}

#[tauri::command]
async fn save_todo_image_attachments(
    images: Vec<ForgePromptImage>,
) -> Result<Vec<SavedTodoImageAttachment>, String> {
    tauri::async_runtime::spawn_blocking(move || save_todo_image_attachments_for(images))
        .await
        .map_err(|error| format!("Unable to prepare todo image attachments: {error}"))?
}

#[tauri::command]
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

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
    permission_mode: Option<&str>,
    pane_id: &str,
    instance_id: u64,
    activity_transport: Option<&TerminalActivityTransportEndpoint>,
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
- For Loopspace graph edits, call get_loopspace_graph and list_loopspace_triggers first. Loopspace graphs use .dfblueprint source with explicit node ids, typed node kinds, and edge node.port -> node.port connections. Trigger nodes are references to reusable trigger inventory: if the requested cron/webhook/manual trigger does not exist, call create_loopspace_trigger first with an explicit trigger_type, then patch_loopspace_graph with op=\"attach_trigger\" and trigger_id. Webhook triggers are inbound; they default to signed_hmac, and public_token is allowed only when the user explicitly asks for a public URL and public_webhook_confirmed=true is set. Never invent standalone cron/manual/webhook trigger nodes in the graph source. For add_node, use supported node kinds: document_read, document_write, asset_read, asset_write, run_script, send_message, dispatch_todos, or step. Device nodes are legacy saved-graph compatibility only; target devices are selected on send_message, dispatch_todos, and run_script nodes. Legal ports include trigger.out; run_script/send_message/dispatch_todos exec, success, failure, and interrupt; document_read/document_write docs; asset_read/asset_write assets; and target .in ports. Resource nodes use doc_refs or asset_refs for selected inputs, create_name for generated outputs, h for height, and target_mode for selection/create behavior. Dispatch todo nodes use target_workspace_ids and todo_lines, plus optional target_terminal_id, target_agent_id, model, reasoning_effort, and speed. For send-message substeps, connect step.success -> run_script.in, send_message.in, or dispatch_todos.in when a completed substep should start another action. For substep resource guidance, connect document_read.docs or document_write.docs -> step.in for readable document context, asset_read.assets or asset_write.assets -> step.in for readable asset context, step.docs -> document_write.in for generated documents, and step.assets -> asset_write.in for generated assets; do not connect send_message.exec, send_message.success, dispatch_todos.exec, dispatch_todos.success, run_script.exec, or other action execution branches directly into asset_write. Prefer patch_loopspace_graph for attach_trigger, add_node, move_node, remove_node, connect, disconnect, and update_node_props; specify from_port/fromPort and to_port/toPort on connect operations, especially from run_script/send_message/dispatch_todos action nodes. Use update_loopspace_graph only for larger full-source rewrites, preserve existing ids, and wait for the hydrated result.
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
                "alwaysOn": true,
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
const TERMINAL_PERMISSION_MODE_BYPASS: &str = "bypass";

fn terminal_normalize_permission_mode(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let mode = value
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '-'], "_");
    if mode.is_empty() || mode == "default" {
        return Ok(None);
    }

    let normalized = match mode.as_str() {
        "plan" | "plan_mode" => TERMINAL_PERMISSION_MODE_PLAN,
        "ask" | "ask_each" | "ask_each_time" | "default" => TERMINAL_PERMISSION_MODE_ASK,
        "accept" | "accept_edit" | "accept_edits" | "acceptedits" => {
            TERMINAL_PERMISSION_MODE_ACCEPT_EDITS
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

fn apply_codex_coordinated_auto_approval_args(
    args: &mut Vec<String>,
    codex_profile: Option<&str>,
    bypass_hook_trust: bool,
    permission_mode: Option<&str>,
) {
    let permission_mode = permission_mode.unwrap_or(TERMINAL_PERMISSION_MODE_ACCEPT_EDITS);
    strip_terminal_arg_option(args, "--ask-for-approval", "-a", true);
    strip_terminal_arg_option(args, "--profile", "-p", true);
    if let Some(profile) = codex_profile.filter(|value| !value.trim().is_empty()) {
        args.insert(0, profile.to_string());
        args.insert(0, "--profile".to_string());
    }

    strip_terminal_arg_option(args, "--sandbox", "-s", true);
    strip_terminal_arg_option(
        args,
        "--dangerously-bypass-approvals-and-sandbox",
        "",
        false,
    );
    if permission_mode == TERMINAL_PERMISSION_MODE_BYPASS {
        args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
    } else {
        let (approval, sandbox) = match permission_mode {
            TERMINAL_PERMISSION_MODE_PLAN => ("never", "read-only"),
            TERMINAL_PERMISSION_MODE_ASK => ("on-request", "workspace-write"),
            _ => ("never", "workspace-write"),
        };
        args.push("--ask-for-approval".to_string());
        args.push(approval.to_string());
        args.push("--sandbox".to_string());
        args.push(sandbox.to_string());
    }
    strip_terminal_arg_option(args, "--dangerously-bypass-hook-trust", "", false);
    strip_terminal_arg_option_value(args, "--enable", "", "apps");
    strip_terminal_arg_option_value(args, "--disable", "", "apps");
    strip_terminal_arg_option(args, "--cd", "-C", true);
    args.push("--disable".to_string());
    args.push("apps".to_string());

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

    strip_terminal_arg_option(args, "--permission-mode", "", true);
    args.push("--permission-mode".to_string());
    args.push(claude_permission_mode_arg(permission_mode).to_string());

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
    if permission_mode == TERMINAL_PERMISSION_MODE_ACCEPT_EDITS {
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
    permission_mode: &str,
    pane_id: &str,
    instance_id: u64,
    workspace_id: Option<&str>,
    terminal_index: Option<u16>,
    activity_transport: Option<&TerminalActivityTransportEndpoint>,
) -> String {
    let workspace_files = claude_workspace_permission_glob(coordination);
    let allowed_permissions = if permission_mode == TERMINAL_PERMISSION_MODE_ACCEPT_EDITS {
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
                            "timeout": 5
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
                            "timeout": 5
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
                            "timeout": 5
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
                            "timeout": 5
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
    pane_id: &str,
    instance_id: u64,
    workspace_id: Option<&str>,
    terminal_index: Option<u16>,
    provider_id: &str,
    activity_transport: Option<&TerminalActivityTransportEndpoint>,
) {
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
    agent_accounts_apply_spawn_env(env_vars, pane_id, provider_id);
}

fn set_terminal_env_var(env_vars: &mut Vec<(String, String)>, key: &str, value: &str) {
    env_vars.retain(|(existing_key, _)| existing_key != key);
    env_vars.push((key.to_string(), value.to_string()));
}

fn apply_codex_resume_home_env(env_vars: &mut Vec<(String, String)>, home: &str) {
    let home = home.trim();
    if home.is_empty() {
        return;
    }
    set_terminal_env_var(env_vars, "CODEX_HOME", home);
    set_terminal_env_var(env_vars, "DIFFFORGE_CODEX_HOME", home);
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
        return Ok(false);
    };
    let Some(home) = terminal_coordination_env_value(coordination, "DIFFFORGE_CODEX_HOME")
        .or_else(|| terminal_coordination_env_value(coordination, "CODEX_HOME"))
    else {
        return Ok(false);
    };

    let profile_path = PathBuf::from(&home).join(format!("{profile}.config.toml"));
    let hooks_path = codex_hooks_path_from_profile(&profile_path)?
        .unwrap_or_else(|| PathBuf::from(&home).join(format!("{profile}.hooks.json")));
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
    if sync_codex_profile_inline_hooks(&profile_path, &hooks_json)? {
        updated = true;
    }
    Ok(updated)
}

fn codex_hooks_path_from_profile(profile_path: &Path) -> Result<Option<PathBuf>, String> {
    let Ok(body) = fs::read_to_string(profile_path) else {
        return Ok(None);
    };
    let profile_dir = profile_path.parent().unwrap_or_else(|| Path::new("."));
    for line in body.lines() {
        let trimmed = line.trim();
        let Some(value) = trimmed.strip_prefix("hooksPath") else {
            continue;
        };
        let Some(value) = value.trim_start().strip_prefix('=') else {
            continue;
        };
        let value = value.trim();
        let Some(path) = terminal_toml_string_literal_value(value) else {
            continue;
        };
        let path = PathBuf::from(path);
        return Ok(Some(if path.is_absolute() {
            path
        } else {
            profile_dir.join(path)
        }));
    }
    Ok(None)
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

    let mut added = 0usize;
    for event_name in [
        "UserPromptSubmit",
        "MessageDisplay",
        "PreCompact",
        "PostCompact",
        "Stop",
        "StopFailure",
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
        "PostToolBatch",
        "PermissionRequest",
        "PermissionDenied",
        "Notification",
        "Elicitation",
        "ElicitationResult",
        "SubagentStart",
        "SubagentStop",
    ] {
        let entry = hooks
            .entry(event_name)
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
                        "timeout": 5
                    }
                ]
            }));
            added += 1;
        }
    }

    added
}

fn sync_codex_profile_inline_hooks(
    profile_path: &Path,
    hooks_json: &Value,
) -> Result<bool, String> {
    let body = match fs::read_to_string(profile_path) {
        Ok(body) => body,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(format!(
                "Unable to read Codex profile config {}: {error}",
                profile_path.display()
            ));
        }
    };
    let hooks_config = crate::coordination::kernel::codex_managed_hooks_config_toml(hooks_json);
    if hooks_config.trim().is_empty() {
        return Ok(false);
    }
    let mut next = strip_codex_profile_inline_hook_events(&body)
        .trim_end()
        .to_string();
    if !next.is_empty() {
        next.push_str("\n\n");
    }
    next.push_str(hooks_config.trim_end());
    next.push('\n');
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

fn strip_codex_profile_inline_hook_events(body: &str) -> String {
    let lines = body.lines().collect::<Vec<_>>();
    let mut next = Vec::new();
    let mut index = 0usize;
    while index < lines.len() {
        if let Some(section) = terminal_toml_section_header_name(lines[index]) {
            if codex_toml_section_is_inline_hook_event(&section) {
                index += 1;
                while index < lines.len()
                    && terminal_toml_section_header_name(lines[index]).is_none()
                {
                    index += 1;
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
                "argCount": args.len(),
                "hasEventsPathArg": terminal_cli_arg_value(args, "--events-path").is_some(),
                "hasPaneIdArg": terminal_cli_arg_value(args, "--pane-id").is_some(),
                "hasInstanceIdArg": terminal_cli_arg_value(args, "--instance-id").is_some(),
                "transportConfigured": false,
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
            json!({ "inputLength": input.len() }),
        );
        return 0;
    };
    let record = diff_forge_activity_hook_record(
        &provider,
        &pane_id,
        instance_id,
        &workspace_id,
        &terminal_index,
        &hook_input,
    );
    if let Some(transport) = activity_transport.as_ref() {
        match send_diff_forge_activity_hook_transport(transport, &record) {
            Ok(()) => return 0,
            Err(error) => write_diff_forge_activity_hook_debug(
                &debug_path,
                "transport_fallback",
                &provider,
                &pane_id,
                instance_id,
                &workspace_id,
                &terminal_index,
                &activity_path,
                json!({
                    "error": error,
                    "hookEventName": record.get("hookEventName").and_then(Value::as_str).unwrap_or_default(),
                }),
            ),
        }
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
                    "hookEventName": record.get("hookEventName").and_then(Value::as_str).unwrap_or_default(),
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
) -> Result<(), String> {
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
    let timeout = Some(Duration::from_millis(
        TERMINAL_ACTIVITY_TRANSPORT_IO_TIMEOUT_MS,
    ));
    let _ = stream.set_write_timeout(timeout);
    let _ = stream.set_read_timeout(timeout);

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
        if response.len() > 1024 {
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
        Ok(())
    } else {
        Err(response_value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Activity transport rejected event.")
            .to_string())
    }
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
        "activityPath": activity_path.to_string_lossy(),
        "details": details,
        "instanceId": instance_id,
        "paneId": pane_id,
        "phase": phase,
        "provider": provider,
        "terminalIndex": terminal_index,
        "timestampMs": terminal_now_ms(),
        "workspaceId": workspace_id,
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
                "planText": plan_text.chars().take(4000).collect::<String>(),
            })
        }
        _ => Value::Null,
    }
}

fn diff_forge_activity_hook_record(
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
    let command = tool_string(&["command"]);
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
        "timestampMs": current_time_ms(),
        "provider": provider,
        "paneId": pane_id,
        "instanceId": instance_id,
        "workspaceId": workspace_id,
        "terminalIndex": terminal_index,
        "eventName": hook_event_name.clone(),
        "hookEventName": hook_event_name,
        "planUpdate": plan_update,
        "sessionId": session_id,
        "turnId": turn_id,
        "cwd": hook_string(&["cwd"]),
        "permissionMode": permission_mode,
        "transcriptPath": transcript_path,
        "agentId": agent_id,
        "agentType": agent_type,
        "agentTranscriptPath": agent_transcript_path,
        "assistantMessage": assistant_message,
        "lastMessage": last_message.clone(),
        "lastAssistantMessage": last_message,
        "message": display_message,
        "prompt": user_prompt.clone(),
        "toolName": tool_name,
        "toolUseId": tool_use_id,
        "command": command,
        "filePath": tool_paths.first().cloned().unwrap_or_default(),
        "graphFilePath": graph_file_path,
        "approvalId": approval_id,
        "permissionPromptId": permission_prompt_id,
        "permissionRequestId": permission_request_id,
        "permissionStatus": permission_status,
        "permissionDecision": permission_decision,
        "approvalStatus": approval_status,
        "promptingUserKind": prompting_user_kind,
        "promptingUserSource": prompting_user_source,
        "promptingUserText": prompting_user_text,
        "promptOptions": prompt_options.clone(),
        "prompt_options": prompt_options,
        "promptDefaultOption": prompt_default_option.clone(),
        "prompt_default_option": prompt_default_option,
        "promptTtlMs": prompt_ttl_ms_value.clone(),
        "prompt_ttl_ms": prompt_ttl_ms_value,
        "manualApprovalRequired": manual_approval_required,
        "providerBlockedForUser": provider_blocked_for_user,
        "requiresUserInput": requires_user_input,
        "promptingUser": prompting_user,
        "terminalIsPromptingUser": prompting_user,
        "startupIdleCandidate": startup_idle_candidate,
        "startup_idle_candidate": startup_idle_candidate,
        "sessionIdleWithoutPrompt": startup_idle_candidate,
        "session_idle_without_prompt": startup_idle_candidate,
        "startupIdleBuffered": startup_idle_buffered,
        "startup_idle_buffered": startup_idle_buffered,
        "stopHookActive": stop_hook_active,
        "stop_hook_active": stop_hook_active,
        "backgroundTasks": background_tasks.clone(),
        "background_tasks": background_tasks,
        "sessionCrons": session_crons.clone(),
        "session_crons": session_crons,
        "description": if description.is_empty() { user_prompt } else { description },
    })
}

#[cfg(test)]
mod terminal_cli_tests {
    use super::*;

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
    fn activity_hook_record_preserves_prompt_options() {
        let record = diff_forge_activity_hook_record(
            "opencode",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hookEventName": "UserPromptRequired",
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
            record.get("promptingUserKind").and_then(Value::as_str),
            Some("selection")
        );
        assert_eq!(
            record.get("promptDefaultOption").and_then(Value::as_str),
            Some("Use existing config")
        );
        assert_eq!(record.get("promptTtlMs").and_then(Value::as_u64), Some(45000));
        assert_eq!(
            record
                .get("promptOptions")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(2)
        );
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
        assert!(settings.contains("\"UserPromptSubmit\""));
        assert!(settings.contains("\"MessageDisplay\""));
        assert!(settings.contains("\"PreCompact\""));
        assert!(settings.contains("\"PostCompact\""));
        assert!(settings.contains("\"Stop\""));
        assert!(settings.contains("\"PostToolUse\""));
        assert!(settings.contains("\"SubagentStop\""));
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
                "hookEventName": "PostToolUse",
                "toolName": "TodoWrite",
                "toolInput": {"todos": [{"content": "Step one", "status": "pending"}]}
            }),
        );
        assert_eq!(record["planUpdate"]["tool"], "todowrite");
        assert_eq!(
            record["planUpdate"]["steps"].as_array().map(Vec::len),
            Some(1)
        );

        let plain = diff_forge_activity_hook_record(
            "claude",
            "pane-1",
            7,
            "workspace-1",
            "0",
            &json!({
                "hookEventName": "PostToolUse",
                "toolName": "Bash",
                "toolInput": {"command": "ls"}
            }),
        );
        assert!(plain["planUpdate"].is_null());
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
                "hookEventName": "AssistantMessageDelta",
                "delta": {"text": "hello from a nested delta"}
            }),
        );
        assert_eq!(record["message"].as_str(), Some("hello from a nested delta"));
        assert_eq!(
            record["assistantMessage"].as_str(),
            Some("hello from a nested delta")
        );
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
                "hookEventName": "Stop",
                "sessionId": "session-123",
                "turnId": "turn-456",
                "transcriptPath": "/tmp/session.jsonl",
                "userPrompt": "ship it",
                "manualApprovalRequired": true,
                "sessionIdleWithoutPrompt": true,
                "stopHookActive": true,
                "backgroundTasks": [{ "id": "task-1" }],
                "sessionCrons": [{ "id": "cron-1" }],
                "approvalId": "approval-123",
                "promptingUserKind": "approval",
                "toolInput": {
                    "description": "fallback description"
                }
            }),
        );

        assert_eq!(record["hookEventName"], "Stop");
        assert_eq!(record["sessionId"], "session-123");
        assert_eq!(record["turnId"], "turn-456");
        assert_eq!(record["transcriptPath"], "/tmp/session.jsonl");
        assert_eq!(record["prompt"], "ship it");
        assert_eq!(record["manualApprovalRequired"], true);
        assert_eq!(record["startupIdleCandidate"], true);
        assert_eq!(record["startup_idle_candidate"], true);
        assert_eq!(record["sessionIdleWithoutPrompt"], true);
        assert_eq!(record["session_idle_without_prompt"], true);
        assert_eq!(record["stopHookActive"], true);
        assert_eq!(record["stop_hook_active"], true);
        assert_eq!(record["backgroundTasks"][0]["id"], "task-1");
        assert_eq!(record["background_tasks"][0]["id"], "task-1");
        assert_eq!(record["sessionCrons"][0]["id"], "cron-1");
        assert_eq!(record["session_crons"][0]["id"], "cron-1");
        assert_eq!(record["approvalId"], "approval-123");
        assert_eq!(record["promptingUserKind"], "approval");
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

function emit(payload) {
  if (!HOOK_BIN) return;
  try {
    const child = spawn(HOOK_BIN, ["--diff-forge-activity-hook", "--provider", PROVIDER], {
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload || {}));
  } catch {}
}

function pickText(parts) {
  if (!Array.isArray(parts)) return "";
  for (const part of parts) {
    const text = part && (part.text != null ? part.text : part.content);
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return "";
}

function pickDeltaText(value) {
  if (!value || typeof value !== "object") return "";
  for (const key of ["delta", "textDelta", "contentDelta", "messageDelta"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
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

export const DiffForgeActivityPlugin = async () => {
  // Track which sessions have an in-flight turn so a stray, startup, duplicate,
  // or child/sub-agent `session.idle` cannot settle the wrong turn: we only
  // emit `Stop` for a session we actually observed a prompt for. Keyed by
  // session id (not a single flag) because OpenCode fires session.idle for
  // sub-sessions too.
  const activeSessions = new Set();
  return {
    "chat.message": async (input, output) => {
      const sessionId = (input && input.sessionID) || "";
      activeSessions.add(sessionId);
      emit({
        hook_event_name: "UserPromptSubmit",
        session_id: sessionId,
        prompt: pickText(output && output.parts),
      });
    },
    "tool.execute.before": async (input, output) => {
      emit({
        hook_event_name: "PreToolUse",
        session_id: (input && input.sessionID) || "",
        tool_name: (input && input.tool) || "",
        tool_use_id: (input && input.callID) || "",
        tool_input: (output && output.args) || {},
      });
    },
    "tool.execute.after": async (input) => {
      emit({
        hook_event_name: "PostToolUse",
        session_id: (input && input.sessionID) || "",
        tool_name: (input && input.tool) || "",
        tool_use_id: (input && input.callID) || "",
      });
    },
    "permission.ask": async (input) => {
      // Fires only when OpenCode actually needs a decision (auto-allowed tools
      // never ask), so surface it as a manual-approval attention event. We do
      // not touch `output` — OpenCode's own permission config decides.
      emit({
        hook_event_name: "PermissionRequest",
        session_id: (input && input.sessionID) || "",
        manual_approval_required: true,
        permission_request_id: (input && input.id) || "",
        tool_use_id: (input && input.callID) || "",
        tool_name: (input && input.type) || "",
        description: (input && input.title) || "",
        prompt_default_option: "deny",
        prompt_options: [
          ["allow_once", "Allow once"],
          ["deny", "Deny"],
          ["park", "Park todo"]
        ],
      });
    },
    event: async ({ event }) => {
      const type = (event && event.type) || "";
      const sessionId = eventSessionId(event);
      const props = (event && event.properties) || {};
      if (type === "message.updated" || type === "message.created") {
        const message = props.message || props.info || {};
        const role = String(message.role || message.type || "").toLowerCase();
        if (role === "user") {
          activeSessions.add(sessionId);
          emit({
            hook_event_name: "UserPromptSubmit",
            session_id: sessionId,
            prompt: pickText(message.parts || message.content || []),
          });
        } else if (role === "assistant") {
          const delta = pickDeltaText(props) || pickDeltaText(message);
          if (delta) {
            emit({
              hook_event_name: "AssistantMessageDelta",
              session_id: sessionId,
              assistant_message: delta,
            });
          }
        }
      }
      if (type === "message.part.updated" || type === "message.part.created") {
        const part = props.part || props.info || {};
        const delta = pickDeltaText(props) || pickDeltaText(part);
        if (delta) {
          emit({
            hook_event_name: "AssistantMessageDelta",
            session_id: sessionId,
            assistant_message: delta,
          });
        }
      }
      if (type === "session.compacted" || type === "session.compacting") {
        emit({
          hook_event_name: type === "session.compacting" ? "PreCompact" : "PostCompact",
          session_id: sessionId,
        });
      }
      if (type === "permission.asked") {
        emit({
          hook_event_name: "PermissionRequest",
          session_id: sessionId,
          manual_approval_required: true,
          permission_request_id: props.id || props.permissionID || "",
          tool_use_id: props.callID || props.toolCallID || "",
          tool_name: props.type || props.tool || "",
          description: props.title || props.description || "",
          prompt_default_option: "deny",
          prompt_options: [
            ["allow_once", "Allow once"],
            ["deny", "Deny"],
            ["park", "Park todo"]
          ],
        });
      }
      if (type === "question.ask" || type === "question.asked" || type === "selection.ask" || type === "selection.asked") {
        const promptId = props.id || props.questionID || props.questionId || props.promptID || props.promptId || props.selectionID || props.selectionId || "";
        emit({
          hook_event_name: "UserPromptRequired",
          session_id: sessionId,
          requires_user_input: true,
          provider_blocked_for_user: true,
          permission_request_id: promptId || (sessionId ? `${type}:${sessionId}:${Date.now()}` : `${type}:${Date.now()}`),
          prompting_user_kind: type.startsWith("selection.") ? "selection" : "question",
          prompting_user_text: props.title || props.question || props.description || "",
          prompt_options: props.options || props.choices || props.actions || [],
        });
      }
      if (type === "session.idle") {
        const hadActiveSession = activeSessions.has(sessionId);
        activeSessions.delete(sessionId);
        emit({
          hook_event_name: "Stop",
          session_id: sessionId,
          startup_idle_candidate: !hadActiveSession,
          session_idle_without_prompt: !hadActiveSession,
        });
      } else if (type === "session.error") {
        activeSessions.delete(sessionId);
        emit({ hook_event_name: "StopFailure", session_id: sessionId });
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
                "environment": {
                    "COORDINATION_ENABLED": "1",
                    "DIFFFORGE_WORKSPACE_MCP_GATEWAY": "1"
                }
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

    let run_npm_install = || {
        run_command_capture(
            npm_binary(),
            &["install", "-g", definition.install_package],
            None,
            Duration::from_secs(AGENT_INSTALL_TIMEOUT_SECS),
            None,
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

    match install {
        Ok(capture) if capture.exit_code == Some(0) => {
            // npm exiting 0 is not enough: verify the binary really starts,
            // and try the package's own postinstall repair once before
            // reporting a corrupt install.
            if let Err(verify_error) = verify_agent_binary_runs(definition) {
                let repaired = repair_agent_npm_postinstall(definition)
                    && verify_agent_binary_runs(definition).is_ok();
                if !repaired {
                    return failed_agent_install_result(
                        definition,
                        &verify_error,
                        "The npm package installed but its binary does not run (likely an interrupted download). Try again on a stable connection.",
                        if is_update { "update" } else { "install" },
                    );
                }
            }
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
        AgentProvider::Codex => run_login_terminal(definition.label, &binary, &["login"]),
        AgentProvider::Claude => run_login_terminal(definition.label, &binary, &["/login"]),
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

    track_login_terminal_child(child);

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
        return Err(format!("Attach up to {MAX_FORGE_IMAGES} images per todo."));
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
    let (launch_provider_session_id, codex_resume_home) = terminal_resolve_provider_resume_session(
        provider,
        terminal_clean_provider_session_id(Some(&requested_provider_session_id)),
        &working_directory_text,
    );
    if let Some(home) = codex_resume_home.as_deref() {
        apply_codex_resume_home_env(&mut launch_env_vars, home);
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

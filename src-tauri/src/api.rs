fn http_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("Diff Forge AI Desktop/0.1.0")
        .build()
        .map_err(|error| format!("Unable to prepare backend request: {error}"))
}

fn non_json_api_response_message(
    status: reqwest::StatusCode,
    fallback_message: &str,
    parse_error: serde_json::Error,
) -> String {
    if status.is_success() {
        return format!("Diff Forge AI API returned invalid JSON: {parse_error}");
    }

    format!("{fallback_message} Diff Forge AI API returned {status} with a non-JSON response.")
}

async fn read_api_response(
    response: reqwest::Response,
    fallback_message: &str,
) -> Result<Value, String> {
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Unable to read Diff Forge AI API response: {error}"))?;
    let response_body = if response_text.trim().is_empty() {
        json!({})
    } else {
        match serde_json::from_str::<Value>(&response_text) {
            Ok(body) => body,
            Err(error) => {
                return Err(non_json_api_response_message(
                    status,
                    fallback_message,
                    error,
                ));
            }
        }
    };

    if status.is_success() {
        return Ok(response_body);
    }

    let api_error = response_body
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or(fallback_message);

    Err(api_error.to_string())
}

#[tauri::command]
async fn backend_ping() -> Result<BackendStatus, String> {
    let endpoint = api_endpoint("hello");
    let client = http_client(Duration::from_secs(DEFAULT_API_TIMEOUT_SECS))?;

    let response = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|error| format!("Unable to reach Diff Forge AI API: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Diff Forge AI API returned {}", response.status()));
    }

    let _body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Diff Forge AI API returned invalid JSON: {error}"))?;

    Ok(BackendStatus {
        ok: true,
        endpoint,
        message: "Diff Forge API online".to_string(),
    })
}

#[tauri::command]
fn desktop_web_login_url() -> Result<String, String> {
    Ok(desktop_web_login_url_base())
}

#[tauri::command]
async fn exchange_desktop_auth_code(code: String, state: String) -> Result<Value, String> {
    validate_auth_value("Desktop auth code", &code)?;
    validate_auth_value("Desktop auth state", &state)?;

    let client = http_client(Duration::from_secs(AUTH_EXCHANGE_TIMEOUT_SECS))?;
    let response = client
        .post(api_endpoint("desktop/sessions/exchange"))
        .json(&ExchangeDesktopSessionRequest {
            code: &code,
            state: &state,
        })
        .send()
        .await
        .map_err(|error| format!("Unable to exchange desktop login: {error}"))?;

    read_api_response(response, "Desktop login expired. Try again.").await
}

#[tauri::command]
async fn validate_desktop_session(token: String) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;

    let client = http_client(Duration::from_secs(SESSION_VALIDATE_TIMEOUT_SECS))?;
    let response = client
        .get(api_endpoint("desktop/session"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Unable to validate desktop session: {error}"))?;

    read_api_response(response, "Desktop session expired.").await
}

#[tauri::command]
async fn logout_desktop_session(token: String) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;

    let client = http_client(Duration::from_secs(LOGOUT_TIMEOUT_SECS))?;
    let response = client
        .delete(api_endpoint("desktop/session"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Unable to sign out desktop session: {error}"))?;

    read_api_response(response, "Unable to sign out desktop session.").await
}

fn clean_desktop_signin_diagnostic_text(value: impl AsRef<str>, max_len: usize) -> String {
    value
        .as_ref()
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(max_len)
        .collect()
}

#[tauri::command]
async fn record_desktop_signin_diagnostic(
    token: String,
    flow_id: Option<String>,
    source: Option<String>,
    step: String,
    status: String,
    message: Option<String>,
    details: Option<Value>,
) -> Result<Value, String> {
    if !DESKTOP_SIGNIN_DIAGNOSTICS_ENABLED {
        return Ok(json!({
            "ok": true,
            "stored": false,
            "enabled": false,
        }));
    }

    validate_auth_value("Desktop session", &token)?;
    let step = clean_desktop_signin_diagnostic_text(step, 120);
    if step.is_empty() {
        return Err("Desktop sign-in diagnostic step is required.".to_string());
    }
    let status = clean_desktop_signin_diagnostic_text(status, 40);
    let source = clean_desktop_signin_diagnostic_text(
        source.unwrap_or_else(|| "rust-diffforge-ui".to_string()),
        80,
    );
    let flow_id = flow_id
        .map(|value| clean_desktop_signin_diagnostic_text(value, 160))
        .filter(|value| !value.is_empty());
    let message = message
        .map(|value| clean_desktop_signin_diagnostic_text(
            value,
            DESKTOP_SIGNIN_DIAGNOSTIC_MAX_TEXT,
        ))
        .filter(|value| !value.is_empty());

    let client = http_client(Duration::from_secs(DESKTOP_SIGNIN_DIAGNOSTIC_TIMEOUT_SECS))?;
    let response = client
        .post(api_endpoint("desktop/signin-diagnostics"))
        .bearer_auth(token)
        .json(&DesktopSigninDiagnosticRequest {
            flow_id: flow_id.as_deref(),
            source: &source,
            step: &step,
            status: &status,
            message: message.as_deref(),
            details: details.unwrap_or_else(|| json!({})),
        })
        .send()
        .await
        .map_err(|error| format!("Unable to record desktop sign-in diagnostic: {error}"))?;

    read_api_response(response, "Unable to record desktop sign-in diagnostic.").await
}

#[tauri::command]
async fn record_desktop_connection_diagnostic(
    token: String,
    flow_id: Option<String>,
    source: Option<String>,
    channel: Option<String>,
    workspace_id: Option<String>,
    repo_id: Option<String>,
    step: String,
    status: String,
    message: Option<String>,
    details: Option<Value>,
) -> Result<Value, String> {
    if !DESKTOP_CONNECTION_DIAGNOSTICS_ENABLED {
        return Ok(json!({
            "ok": true,
            "stored": false,
            "enabled": false,
        }));
    }

    validate_auth_value("Desktop session", &token)?;
    let step = clean_desktop_signin_diagnostic_text(step, 140);
    if step.is_empty() {
        return Err("Desktop connection diagnostic step is required.".to_string());
    }
    let status = clean_desktop_signin_diagnostic_text(status, 48);
    let source = clean_desktop_signin_diagnostic_text(
        source.unwrap_or_else(|| "rust-diffforge-ui".to_string()),
        100,
    );
    let flow_id = flow_id
        .map(|value| clean_desktop_signin_diagnostic_text(value, 180))
        .filter(|value| !value.is_empty());
    let channel = channel
        .map(|value| clean_desktop_signin_diagnostic_text(value, 80))
        .filter(|value| !value.is_empty());
    let workspace_id = workspace_id
        .map(|value| clean_desktop_signin_diagnostic_text(value, 180))
        .filter(|value| !value.is_empty());
    let repo_id = repo_id
        .map(|value| clean_desktop_signin_diagnostic_text(value, 180))
        .filter(|value| !value.is_empty());
    let message = message
        .map(|value| clean_desktop_signin_diagnostic_text(
            value,
            DESKTOP_SIGNIN_DIAGNOSTIC_MAX_TEXT,
        ))
        .filter(|value| !value.is_empty());

    let payload = json!({
        "flowId": flow_id,
        "source": source,
        "channel": channel,
        "workspaceId": workspace_id,
        "repoId": repo_id,
        "step": step,
        "status": status,
        "message": message,
        "details": details.unwrap_or_else(|| json!({})),
    });

    let client = http_client(Duration::from_secs(DESKTOP_SIGNIN_DIAGNOSTIC_TIMEOUT_SECS))?;
    let response = client
        .post(api_endpoint("desktop/connection-diagnostics"))
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("Unable to record desktop connection diagnostic: {error}"))?;

    read_api_response(response, "Unable to record desktop connection diagnostic.").await
}

#[tauri::command]
async fn agent_statuses() -> Result<Vec<AgentStatus>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let npm_version_handle = thread::spawn(|| {
            let version = npm_version();
            version
        });
        let codex_package_version =
            spawn_npm_package_version_check(agent_definition(AgentProvider::Codex));
        let claude_package_version =
            spawn_npm_package_version_check(agent_definition(AgentProvider::Claude));
        let opencode_package_version =
            spawn_npm_package_version_check(agent_definition(AgentProvider::OpenCode));
        let codex_latest_version =
            spawn_npm_latest_package_version_check(agent_definition(AgentProvider::Codex));
        let claude_latest_version =
            spawn_npm_latest_package_version_check(agent_definition(AgentProvider::Claude));
        let opencode_latest_version =
            spawn_npm_latest_package_version_check(agent_definition(AgentProvider::OpenCode));
        let codex_runtime = thread::spawn(|| agent_runtime_status_for(AgentProvider::Codex));
        let claude_runtime = thread::spawn(|| agent_runtime_status_for(AgentProvider::Claude));
        let opencode_runtime = thread::spawn(|| agent_runtime_status_for(AgentProvider::OpenCode));

        let codex_runtime = codex_runtime
            .join()
            .map_err(|_| "Codex status check failed.".to_string())?;
        let claude_runtime = claude_runtime
            .join()
            .map_err(|_| "Claude Code status check failed.".to_string())?;
        let opencode_runtime = opencode_runtime
            .join()
            .map_err(|_| "OpenCode status check failed.".to_string())?;
        let npm_version = npm_version_handle.join().ok().flatten();
        let npm_available = npm_version.is_some();
        let npm_version = npm_version.unwrap_or_else(|| "Not detected".to_string());
        let (
            codex_npm_installed,
            codex_npm_package_version,
            codex_npm_latest_version,
            codex_npm_update_available,
        ) = resolve_npm_package_version(codex_package_version, codex_latest_version);
        let (
            claude_npm_installed,
            claude_npm_package_version,
            claude_npm_latest_version,
            claude_npm_update_available,
        ) = resolve_npm_package_version(claude_package_version, claude_latest_version);
        let (
            opencode_npm_installed,
            opencode_npm_package_version,
            opencode_npm_latest_version,
            opencode_npm_update_available,
        ) = resolve_npm_package_version(opencode_package_version, opencode_latest_version);

        let codex_status = build_agent_status(
            AgentProvider::Codex,
            codex_runtime,
            npm_available,
            &npm_version,
            codex_npm_installed,
            codex_npm_package_version,
            codex_npm_latest_version,
            codex_npm_update_available,
        );
        let claude_status = build_agent_status(
            AgentProvider::Claude,
            claude_runtime,
            npm_available,
            &npm_version,
            claude_npm_installed,
            claude_npm_package_version,
            claude_npm_latest_version,
            claude_npm_update_available,
        );
        let opencode_status = build_agent_status(
            AgentProvider::OpenCode,
            opencode_runtime,
            npm_available,
            &npm_version,
            opencode_npm_installed,
            opencode_npm_package_version,
            opencode_npm_latest_version,
            opencode_npm_update_available,
        );
        let statuses = vec![codex_status, claude_status, opencode_status];
        Ok(statuses)
    })
    .await
    .map_err(|error| format!("Unable to check terminal CLIs: {error}"))?
}

#[tauri::command]
async fn start_agent_login(provider: String) -> Result<AgentLoginStart, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;
        let definition = agent_definition(provider);

        launch_login_terminal(provider)?;

        Ok(AgentLoginStart {
            provider: definition.id,
            command: definition.connect_command,
            message: format!("Opened {} login in a terminal.", definition.label),
        })
    })
    .await
    .map_err(|error| format!("Unable to start terminal CLI login: {error}"))?
}

#[tauri::command]
async fn start_agent_account_login(provider: String) -> Result<AgentLoginStart, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;
        let definition = agent_definition(provider);

        launch_account_login_terminal(provider)?;

        Ok(AgentLoginStart {
            provider: definition.id,
            command: definition.connect_command,
            message: format!("Opened {} login in a terminal.", definition.label),
        })
    })
    .await
    .map_err(|error| format!("Unable to start terminal CLI login: {error}"))?
}

#[tauri::command]
async fn disconnect_agent(provider: String) -> Result<AgentLogoutResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;

        logout_agent_credentials(provider)
    })
    .await
    .map_err(|error| format!("Unable to disconnect terminal CLI: {error}"))?
}

#[tauri::command]
async fn install_agent(provider: String) -> Result<AgentInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;
        let result = install_agent_with_npm(provider);

        if result.installed {
            clear_agent_command_candidate_cache(provider);
        }

        Ok(result)
    })
    .await
    .map_err(|error| format!("Unable to install terminal CLI: {error}"))?
}

#[tauri::command]
async fn update_agent(provider: String) -> Result<AgentInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;
        let result = update_agent_with_npm(provider);

        if result.installed {
            clear_agent_command_candidate_cache(provider);
        }

        Ok(result)
    })
    .await
    .map_err(|error| format!("Unable to update terminal CLI: {error}"))?
}

#[tauri::command]
async fn uninstall_agent(provider: String) -> Result<AgentInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;
        let result = uninstall_agent_with_npm(provider);

        if !result.installed {
            clear_agent_command_candidate_cache(provider);
        }

        Ok(result)
    })
    .await
    .map_err(|error| format!("Unable to uninstall terminal CLI: {error}"))?
}

fn tools_binary_on_path(binary: &str) -> Option<String> {
    let binary = binary.trim();
    if binary.is_empty() || binary.contains(['/', '\\']) {
        return None;
    }
    let path_value = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_value) {
        let candidate = dir.join(binary);
        #[cfg(windows)]
        {
            if candidate.is_file() {
                return Some(candidate.display().to_string());
            }
            for extension in ["exe", "cmd", "bat", "ps1"] {
                let candidate = candidate.with_extension(extension);
                if candidate.is_file() {
                    return Some(candidate.display().to_string());
                }
            }
        }
        #[cfg(not(windows))]
        {
            use std::os::unix::fs::PermissionsExt;
            if candidate.is_file()
                && fs::metadata(&candidate)
                    .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
                    .unwrap_or(false)
            {
                return Some(candidate.display().to_string());
            }
        }
    }
    // GUI apps often miss package-manager locations from the login shell
    // PATH; probe the common ones per platform.
    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let mut fallback_dirs: Vec<String> = Vec::new();
        #[cfg(target_os = "macos")]
        fallback_dirs.extend(["/opt/homebrew/bin".to_string(), "/usr/local/bin".to_string()]);
        #[cfg(target_os = "linux")]
        fallback_dirs.extend([
            "/usr/local/bin".to_string(),
            "/home/linuxbrew/.linuxbrew/bin".to_string(),
            format!("{home}/.linuxbrew/bin"),
            format!("{home}/.local/bin"),
        ]);
        fallback_dirs.push(format!("{home}/.cargo/bin"));
        for prefix in fallback_dirs {
            if prefix.trim().is_empty() {
                continue;
            }
            let candidate = Path::new(&prefix).join(binary);
            if candidate.is_file() {
                return Some(candidate.display().to_string());
            }
        }
    }
    None
}

#[tauri::command]
async fn tools_check_cli_binaries(binaries: Vec<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut results = serde_json::Map::new();
        for binary in binaries.iter().take(200) {
            let path = tools_binary_on_path(binary);
            results.insert(
                binary.clone(),
                json!({
                    "installed": path.is_some(),
                    "path": path,
                }),
            );
        }
        Ok(Value::Object(results))
    })
    .await
    .map_err(|error| format!("CLI check worker failed: {error}"))?
}

const TOOLS_CLI_ACTION_TIMEOUT_SECS: u64 = 15 * 60;

#[tauri::command]
async fn tools_run_cli_action(
    manager: String,
    package: String,
    action: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = manager.trim().to_ascii_lowercase();
        let action = action.trim().to_ascii_lowercase();
        let package = package.trim().to_string();
        if package.is_empty()
            || package.len() > 120
            || !package
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'/' | b'@'))
        {
            return Err("CLI package name is invalid.".to_string());
        }
        if !matches!(action.as_str(), "install" | "uninstall") {
            return Err("CLI action must be install or uninstall.".to_string());
        }
        let (program, args): (String, Vec<String>) = match manager.as_str() {
            "brew" => {
                #[cfg(windows)]
                return Err("Homebrew is not available on Windows; use winget or npm.".to_string());
                #[cfg(not(windows))]
                {
                    let brew = tools_binary_on_path("brew")
                        .ok_or_else(|| "Homebrew is not installed on this device.".to_string())?;
                    (brew, vec![action.clone(), package.clone()])
                }
            }
            "winget" => {
                #[cfg(not(windows))]
                return Err("winget is only available on Windows.".to_string());
                #[cfg(windows)]
                {
                    let winget = tools_binary_on_path("winget")
                        .ok_or_else(|| "winget is not installed on this device.".to_string())?;
                    let mut winget_args = vec![
                        action.clone(),
                        "--id".to_string(),
                        package.clone(),
                        "--exact".to_string(),
                    ];
                    if action == "install" {
                        winget_args.push("--accept-source-agreements".to_string());
                        winget_args.push("--accept-package-agreements".to_string());
                        winget_args.push("--silent".to_string());
                    }
                    (winget, winget_args)
                }
            }
            "npm" => (
                npm_binary().to_string(),
                vec![action.clone(), "-g".to_string(), package.clone()],
            ),
            _ => return Err("CLI manager must be brew, winget, or npm.".to_string()),
        };
        let args_ref = args.iter().map(String::as_str).collect::<Vec<_>>();
        let capture = run_command_capture(
            &program,
            &args_ref,
            None,
            Duration::from_secs(TOOLS_CLI_ACTION_TIMEOUT_SECS),
            None,
        )
        .map_err(|error| format!("Unable to run {manager} {action}: {error}"))?;
        let ok = capture.exit_code == Some(0);
        Ok(json!({
            "ok": ok,
            "manager": manager,
            "package": package,
            "action": action,
            "exit_code": capture.exit_code,
            "message": if ok {
                format!("{package} {action} completed.")
            } else {
                let stderr = capture.stderr.trim();
                if stderr.is_empty() {
                    format!("{manager} {action} failed for {package}.")
                } else {
                    format!("{manager} {action} failed: {}", stderr.chars().take(400).collect::<String>())
                }
            },
        }))
    })
    .await
    .map_err(|error| format!("CLI action worker failed: {error}"))?
}

#[tauri::command]
async fn forge_working_directory() -> Result<ForgeWorkingDirectory, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let working_directory = default_working_directory()?;

        Ok(workspace_root_basic_response(&working_directory))
    })
    .await
    .map_err(|error| format!("Unable to read Forge working directory: {error}"))?
}

#[tauri::command]
async fn validate_workspace_root_directory(path: String) -> Result<ForgeWorkingDirectory, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let working_directory = match resolve_workspace_root_directory(Some(&path)) {
            Ok(working_directory) => working_directory,
            Err(error) => {
                return Err(error);
            }
        };
        Ok(workspace_root_basic_response(&working_directory))
    })
    .await
    .map_err(|error| format!("Unable to validate workspace root directory: {error}"))?
}

fn workspace_browse_is_windows_absolute(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

fn expand_workspace_browse_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed == "~" || trimmed.starts_with("~/") {
        let home =
            user_home_dir().ok_or_else(|| "Unable to resolve the home directory.".to_string())?;
        if trimmed == "~" {
            Ok(home)
        } else {
            Ok(home.join(trimmed.trim_start_matches("~/")))
        }
    } else if trimmed.is_empty() {
        default_working_directory()
    } else {
        Ok(PathBuf::from(trimmed))
    }
}

fn resolve_workspace_browse_target(
    path: Option<String>,
    command: Option<String>,
    base_path: Option<String>,
) -> Result<PathBuf, String> {
    if let Some(raw_command) = command {
        let trimmed = raw_command.trim();
        if trimmed.is_empty() {
            return Err("Enter a cd command.".to_string());
        }

        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let verb = parts.next().unwrap_or_default();
        if !verb.eq_ignore_ascii_case("cd") {
            return Err("Only cd commands can change the project root.".to_string());
        }

        let destination = parts.next().unwrap_or_default().trim();
        let destination = if destination.is_empty() {
            "~"
        } else {
            destination
        };
        if destination == "~"
            || destination.starts_with("~/")
            || PathBuf::from(destination).is_absolute()
            || workspace_browse_is_windows_absolute(destination)
        {
            return expand_workspace_browse_path(destination);
        }

        let base = expand_workspace_browse_path(base_path.as_deref().unwrap_or_default())?;
        return Ok(base.join(destination));
    }

    expand_workspace_browse_path(path.as_deref().unwrap_or_default())
}

/// Directory navigation for the inline create-workspace panel: unlike
/// `validate_workspace_root_directory`, browsing may pass through directories
/// (home, system folders) that are not eligible workspace roots — eligibility
/// is reported separately so the UI can disable Create instead of blocking
/// navigation. The optional command path is intentionally cd-only; shell muscle
/// memory such as ls/dir should never be interpreted as a folder path.
#[tauri::command]
async fn browse_workspace_root_directory(
    base_path: Option<String>,
    command: Option<String>,
    path: Option<String>,
) -> Result<WorkspaceRootBrowse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let expanded = resolve_workspace_browse_target(path, command, base_path)?;
        if expanded
            .to_string_lossy()
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == b'\x7f')
        {
            return Err("Directory path is invalid.".to_string());
        }
        let canonical = expanded
            .canonicalize()
            .map_err(|error| format!("Unable to open that directory: {error}"))?;
        let metadata = fs::metadata(&canonical)
            .map_err(|error| format!("Unable to inspect that directory: {error}"))?;
        if !metadata.is_dir() {
            return Err("That path is not a directory.".to_string());
        }

        let mut directories = Vec::new();
        let mut truncated = false;
        let mut entry_count = 0usize;
        if let Ok(read_dir) = fs::read_dir(&canonical) {
            for entry in read_dir.flatten() {
                entry_count += 1;
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let is_directory = entry
                    .file_type()
                    .map(|file_type| file_type.is_dir())
                    .unwrap_or(false);
                if !is_directory {
                    continue;
                }
                if directories.len() >= 200 {
                    truncated = true;
                    break;
                }
                directories.push(name);
            }
        }
        directories.sort_by_key(|name| name.to_lowercase());

        let rejection_reason = workspace_root_rejection_reason(&canonical);
        Ok(WorkspaceRootBrowse {
            working_directory: workspace_path_display(&canonical),
            parent_directory: canonical
                .parent()
                .map(|parent| workspace_path_display(parent)),
            directories,
            truncated,
            empty_directory: entry_count == 0,
            git_repository: workspace_is_exact_git_root(&canonical),
            root_eligible: rejection_reason.is_none(),
            root_rejection_reason: rejection_reason.map(str::to_string),
        })
    })
    .await
    .map_err(|error| format!("Unable to browse workspace directory: {error}"))?
}

#[tauri::command]
async fn list_workspace_directory(
    root: String,
    relative_path: String,
) -> Result<WorkspaceDirectoryListing, String> {
    tauri::async_runtime::spawn_blocking(move || list_workspace_directory_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to list workspace directory: {error}"))?
}

#[tauri::command]
async fn read_workspace_file(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileText, String> {
    tauri::async_runtime::spawn_blocking(move || read_workspace_file_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to read workspace file: {error}"))?
}

#[tauri::command]
async fn read_workspace_file_image(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileImage, String> {
    tauri::async_runtime::spawn_blocking(move || read_workspace_file_image_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to read workspace image: {error}"))?
}

#[tauri::command]
async fn read_workspace_file_diff(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || read_workspace_file_diff_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to read workspace file diff: {error}"))?
}

#[tauri::command]
async fn rename_workspace_entry(
    root: String,
    relative_path: String,
    new_name: String,
) -> Result<WorkspaceFileOperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rename_workspace_entry_for(root, relative_path, new_name)
    })
    .await
    .map_err(|error| format!("Unable to rename workspace item: {error}"))?
}

#[tauri::command]
async fn delete_workspace_entry(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileOperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_workspace_entry_for(root, relative_path)
    })
    .await
    .map_err(|error| format!("Unable to delete workspace item: {error}"))?
}

#[tauri::command]
async fn move_workspace_entry(
    root: String,
    relative_path: String,
    target_directory: String,
) -> Result<WorkspaceFileOperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        move_workspace_entry_for(root, relative_path, target_directory)
    })
    .await
    .map_err(|error| format!("Unable to move workspace item: {error}"))?
}

#[tauri::command]
async fn run_forge_prompt(request: ForgePromptRequest) -> Result<ForgeRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_forge_prompt_for(request))
        .await
        .map_err(|error| format!("Unable to run Forge Console prompt: {error}"))?
}

#[tauri::command]
async fn agent_thread_turn_start(
    request: AgentThreadTurnRequest,
) -> Result<AgentThreadTurnResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_agent_thread_turn_for(request))
        .await
        .map_err(|error| format!("Unable to send agent turn: {error}"))?
}

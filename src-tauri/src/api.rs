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
    let endpoint = format!("{API_BASE_URL}/hello");
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
async fn exchange_desktop_auth_code(code: String, state: String) -> Result<Value, String> {
    validate_auth_value("Desktop auth code", &code)?;
    validate_auth_value("Desktop auth state", &state)?;

    let client = http_client(Duration::from_secs(AUTH_EXCHANGE_TIMEOUT_SECS))?;
    let response = client
        .post(format!("{API_BASE_URL}/desktop/sessions/exchange"))
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
        .get(format!("{API_BASE_URL}/desktop/session"))
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
        .delete(format!("{API_BASE_URL}/desktop/session"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Unable to sign out desktop session: {error}"))?;

    read_api_response(response, "Unable to sign out desktop session.").await
}

#[tauri::command]
async fn list_workspaces(token: String) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;

    let client = http_client(Duration::from_secs(DEFAULT_API_TIMEOUT_SECS))?;
    let response = client
        .get(format!("{API_BASE_URL}/desktop/workspaces"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Unable to fetch workspaces: {error}"))?;

    read_api_response(response, "Unable to fetch workspaces.").await
}

#[tauri::command]
async fn create_workspace(token: String, name: String) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;

    let workspace_name = clean_workspace_name(name)?;

    let client = http_client(Duration::from_secs(DEFAULT_API_TIMEOUT_SECS))?;
    let response = client
        .post(format!("{API_BASE_URL}/desktop/workspaces"))
        .bearer_auth(token)
        .json(&CreateWorkspaceRequest {
            name: &workspace_name,
        })
        .send()
        .await
        .map_err(|error| format!("Unable to create workspace: {error}"))?;

    read_api_response(response, "Unable to create workspace.").await
}

#[tauri::command]
async fn update_workspace(
    token: String,
    workspace_id: String,
    name: String,
) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;

    let workspace_id = clean_workspace_id(workspace_id)?;
    let workspace_name = clean_workspace_name(name)?;

    let client = http_client(Duration::from_secs(DEFAULT_API_TIMEOUT_SECS))?;
    let response = client
        .patch(format!("{API_BASE_URL}/desktop/workspaces"))
        .bearer_auth(token)
        .json(&UpdateWorkspaceRequest {
            workspace_id: &workspace_id,
            name: &workspace_name,
        })
        .send()
        .await
        .map_err(|error| format!("Unable to update workspace: {error}"))?;

    read_api_response(response, "Unable to update workspace.").await
}

#[tauri::command]
async fn agent_statuses() -> Result<Vec<AgentStatus>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let started_at = Instant::now();
        log_terminal_event("agent.statuses.start", None, None, None, json!({}));

        let npm_version_handle = thread::spawn(|| {
            let npm_started_at = Instant::now();
            let version = npm_version();
            log_terminal_event(
                "agent.statuses.npm_version_done",
                None,
                None,
                Some(npm_started_at.elapsed()),
                json!({
                    "npmAvailable": version.is_some(),
                }),
            );
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
        log_terminal_event(
            "agent.status.done",
            None,
            None,
            Some(started_at.elapsed()),
            json!({
                "authenticated": codex_status.authenticated,
                "installed": codex_status.installed,
                "npmInstalled": codex_status.npm_installed,
                "npmUpdateAvailable": codex_status.npm_update_available,
                "provider": codex_status.id,
            }),
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
        log_terminal_event(
            "agent.status.done",
            None,
            None,
            Some(started_at.elapsed()),
            json!({
                "authenticated": claude_status.authenticated,
                "installed": claude_status.installed,
                "npmInstalled": claude_status.npm_installed,
                "npmUpdateAvailable": claude_status.npm_update_available,
                "provider": claude_status.id,
            }),
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
        log_terminal_event(
            "agent.status.done",
            None,
            None,
            Some(started_at.elapsed()),
            json!({
                "authenticated": opencode_status.authenticated,
                "installed": opencode_status.installed,
                "npmInstalled": opencode_status.npm_installed,
                "npmUpdateAvailable": opencode_status.npm_update_available,
                "provider": opencode_status.id,
            }),
        );

        let statuses = vec![codex_status, claude_status, opencode_status];
        log_terminal_event(
            "agent.statuses.done",
            None,
            None,
            Some(started_at.elapsed()),
            json!({
                "authenticatedCount": statuses.iter().filter(|status| status.authenticated).count(),
                "installedCount": statuses.iter().filter(|status| status.installed).count(),
                "statusCount": statuses.len(),
                "updateAvailableCount": statuses.iter().filter(|status| status.npm_update_available).count(),
            }),
        );

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
async fn forge_working_directory() -> Result<ForgeWorkingDirectory, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let working_directory = default_working_directory()?;

        Ok(ForgeWorkingDirectory {
            working_directory: workspace_path_display(&working_directory),
        })
    })
    .await
    .map_err(|error| format!("Unable to read Forge working directory: {error}"))?
}

#[tauri::command]
async fn validate_workspace_root_directory(path: String) -> Result<ForgeWorkingDirectory, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let validate_started_at = Instant::now();

        log_terminal_event(
            "workspace.root.validate.start",
            None,
            None,
            None,
            json!({
                "has_path": !path.trim().is_empty(),
                "requested_path": clean_terminal_telemetry_text(&path),
            }),
        );

        let working_directory = match resolve_workspace_root_directory(Some(&path)) {
            Ok(working_directory) => working_directory,
            Err(error) => {
                log_terminal_event(
                    "workspace.root.validate.error",
                    None,
                    None,
                    Some(validate_started_at.elapsed()),
                    json!({
                        "error": clean_terminal_telemetry_text(&error),
                        "requested_path": clean_terminal_telemetry_text(&path),
                    }),
                );
                return Err(error);
            }
        };
        let agents_gitignore_update = match ensure_workspace_agents_gitignore(&working_directory) {
            Ok(update) => update,
            Err(error) => {
                log_terminal_event(
                    "workspace.root.agents_gitignore.error",
                    None,
                    None,
                    Some(validate_started_at.elapsed()),
                    json!({
                        "error": clean_terminal_telemetry_text(&error),
                        "requested_path": clean_terminal_telemetry_text(&path),
                    }),
                );
                return Err(error);
            }
        };
        let resolved_directory = workspace_path_display(&working_directory);

        log_terminal_event(
            "workspace.root.validate.done",
            None,
            None,
            Some(validate_started_at.elapsed()),
            json!({
                "requested_path": clean_terminal_telemetry_text(&path),
                "working_directory": resolved_directory,
                "agents_gitignore": workspace_agents_gitignore_update_label(agents_gitignore_update),
            }),
        );

        Ok(ForgeWorkingDirectory {
            working_directory: resolved_directory,
        })
    })
    .await
    .map_err(|error| format!("Unable to validate workspace root directory: {error}"))?
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
async fn read_workspace_file_diff(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || read_workspace_file_diff_for(root, relative_path))
        .await
        .map_err(|error| format!("Unable to read workspace file diff: {error}"))?
}

#[tauri::command]
async fn run_forge_prompt(request: ForgePromptRequest) -> Result<ForgeRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_forge_prompt_for(request))
        .await
        .map_err(|error| format!("Unable to run Forge Console prompt: {error}"))?
}

use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;

const API_BASE_URL: &str = "https://diffforge.ai/api";
const MIN_AUTH_VALUE_LENGTH: usize = 24;
const MAX_AUTH_VALUE_LENGTH: usize = 192;
const DEFAULT_API_TIMEOUT_SECS: u64 = 10;
const AUTH_EXCHANGE_TIMEOUT_SECS: u64 = 10;
const SESSION_VALIDATE_TIMEOUT_SECS: u64 = 5;
const LOGOUT_TIMEOUT_SECS: u64 = 5;
const AGENT_STATUS_TIMEOUT_SECS: u64 = 6;
const AGENT_INSTALL_TIMEOUT_SECS: u64 = 240;
const AGENT_RUN_TIMEOUT_SECS: u64 = 120;
const AGENT_LOGOUT_TIMEOUT_SECS: u64 = 30;
const MAX_FORGE_PROMPT_LENGTH: usize = 12_000;
const MAX_FORGE_MODEL_LENGTH: usize = 80;
const MAX_FORGE_IMAGES: usize = 4;
const MAX_FORGE_IMAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_FORGE_IMAGE_TOTAL_BYTES: usize = 8 * 1024 * 1024;
const MAX_WORKSPACE_TERMINALS: usize = 8;
const WORKSPACE_BOARD_COLUMNS: i64 = 4;
const WORKSPACE_BOARD_ROWS: i64 = 2;
const TERMINAL_DEFAULT_COLS: u16 = 80;
const TERMINAL_DEFAULT_ROWS: u16 = 24;
const TERMINAL_MIN_COLS: u16 = 20;
const TERMINAL_MIN_ROWS: u16 = 6;
const TERMINAL_MAX_COLS: u16 = 400;
const TERMINAL_MAX_ROWS: u16 = 160;
const MAX_TERMINAL_WRITE_BYTES: usize = 64 * 1024;

struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

struct TerminalSession {
    child: Box<dyn Child + Send>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStatus {
    ok: bool,
    endpoint: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeDesktopSessionRequest<'a> {
    code: &'a str,
    state: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateWorkspaceRequest<'a> {
    name: &'a str,
    terminal_count: u8,
    terminal_layout: &'a Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateWorkspaceLayoutRequest<'a> {
    workspace_id: &'a str,
    terminal_layout: &'a Value,
}

#[derive(Clone, Copy)]
enum AgentProvider {
    Codex,
    Claude,
}

#[derive(Clone, Copy)]
struct AgentDefinition {
    id: &'static str,
    label: &'static str,
    binary: &'static str,
    install_package: &'static str,
    install_command: &'static str,
    native_install_url: &'static str,
    native_install_label: &'static str,
    connect_command: &'static str,
}

struct CommandCapture {
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentStatus {
    id: &'static str,
    label: &'static str,
    binary: &'static str,
    installed: bool,
    authenticated: bool,
    version: String,
    auth_message: String,
    install_command: &'static str,
    native_install_url: &'static str,
    native_install_label: &'static str,
    npm_available: bool,
    npm_version: String,
    npm_installed: bool,
    npm_package_version: String,
    recommend_native_install: bool,
    connect_command: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentInstallResult {
    provider: &'static str,
    label: &'static str,
    installed: bool,
    updated: bool,
    permission_denied: bool,
    command: &'static str,
    native_install_url: &'static str,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentLoginStart {
    provider: &'static str,
    command: &'static str,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentLogoutResult {
    provider: &'static str,
    label: &'static str,
    disconnected: bool,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ForgeRunResult {
    provider: &'static str,
    label: &'static str,
    model: String,
    output: String,
    stderr: String,
    working_directory: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForgePromptRequest {
    provider: String,
    prompt: String,
    model: Option<String>,
    images: Option<Vec<ForgePromptImage>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForgePromptImage {
    name: String,
    mime_type: String,
    data_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ForgeWorkingDirectory {
    working_directory: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOpenRequest {
    pane_id: String,
    kind: String,
    provider: Option<String>,
    model: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOpenResult {
    pane_id: String,
    command: String,
    working_directory: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalDataPayload {
    pane_id: String,
    data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
    pane_id: String,
    exit_code: Option<i32>,
}

struct PreparedPromptImages {
    directory: PathBuf,
    paths: Vec<String>,
}

fn is_safe_auth_value(value: &str) -> bool {
    let value_length = value.len();

    value_length >= MIN_AUTH_VALUE_LENGTH
        && value_length <= MAX_AUTH_VALUE_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn validate_auth_value(label: &str, value: &str) -> Result<(), String> {
    if is_safe_auth_value(value) {
        return Ok(());
    }

    Err(format!("{label} is invalid."))
}

fn is_safe_workspace_id(value: &str) -> bool {
    let value_length = value.len();

    value_length == 36
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

fn validate_workspace_id(value: &str) -> Result<(), String> {
    if is_safe_workspace_id(value) {
        return Ok(());
    }

    Err("Workspace id is invalid.".to_string())
}

fn is_safe_terminal_pane_id(value: &str) -> bool {
    let value_length = value.len();

    value_length >= 3
        && value_length <= 96
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn validate_terminal_pane_id(value: &str) -> Result<(), String> {
    if is_safe_terminal_pane_id(value) {
        return Ok(());
    }

    Err("Terminal pane id is invalid.".to_string())
}

fn layout_number(pane: &Value, key: &str) -> Option<i64> {
    pane.get(key)?.as_i64()
}

fn validate_workspace_terminal_layout(terminal_layout: &Value) -> Result<(), String> {
    let panes = terminal_layout
        .as_array()
        .ok_or_else(|| "Terminal layout must be an array.".to_string())?;

    if panes.is_empty() || panes.len() > MAX_WORKSPACE_TERMINALS {
        return Err("Terminal layout must contain between 1 and 8 terminals.".to_string());
    }

    let mut occupied_cells = HashSet::new();

    for pane in panes {
        let Some(pane_object) = pane.as_object() else {
            return Err("Every terminal layout item must be an object.".to_string());
        };

        let x = layout_number(pane, "x")
            .ok_or_else(|| "Terminal x coordinate is invalid.".to_string())?;
        let y = layout_number(pane, "y")
            .ok_or_else(|| "Terminal y coordinate is invalid.".to_string())?;
        let width =
            layout_number(pane, "width").ok_or_else(|| "Terminal width is invalid.".to_string())?;
        let height = layout_number(pane, "height")
            .ok_or_else(|| "Terminal height is invalid.".to_string())?;
        if !pane_object
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| id.len() >= 3 && id.len() <= 64)
        {
            return Err("Terminal layout id is invalid.".to_string());
        }
        if let Some(model) = pane_object.get("model").and_then(Value::as_str) {
            normalize_forge_model(Some(model.to_string()))?;
        }

        if x < 0
            || y < 0
            || width < 1
            || height < 1
            || x + width > WORKSPACE_BOARD_COLUMNS
            || y + height > WORKSPACE_BOARD_ROWS
        {
            return Err("Terminal layout must fit the 4 by 2 workspace board.".to_string());
        }

        for row in y..(y + height) {
            for column in x..(x + width) {
                let key = format!("{column}:{row}");

                if !occupied_cells.insert(key) {
                    return Err("Terminal layout panes cannot overlap.".to_string());
                }
            }
        }
    }

    Ok(())
}

fn parse_agent_provider(provider: &str) -> Result<AgentProvider, String> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "codex" => Ok(AgentProvider::Codex),
        "claude" | "claude-code" | "claude_code" => Ok(AgentProvider::Claude),
        _ => Err("Unknown agent provider.".to_string()),
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
                "{} install was blocked by permissions. Fix npm permissions and try again, or use the native installer page.",
                definition.label
            )
        } else {
            format!("{} install failed: {detail}", definition.label)
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

fn agent_command_candidates(definition: AgentDefinition) -> Vec<String> {
    let mut candidates = vec![definition.binary.to_string()];

    if let Some(path) = npm_global_executable_path(definition) {
        let path = path.to_string_lossy().to_string();

        if !candidates.iter().any(|candidate| candidate == &path) {
            candidates.push(path);
        }
    }

    candidates
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

fn default_working_directory() -> Result<PathBuf, String> {
    let current_dir = env::current_dir()
        .map_err(|error| format!("Unable to read current working directory: {error}"))?;

    if current_dir
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == "src-tauri")
    {
        if let Some(parent) = current_dir.parent() {
            return Ok(parent.to_path_buf());
        }
    }

    Ok(current_dir)
}

fn user_home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

fn claude_credentials_detected() -> bool {
    let env_has_credentials = [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
    ]
    .iter()
    .any(|key| env::var_os(key).is_some_and(|value| !value.is_empty()));

    if env_has_credentials {
        return true;
    }

    let config_dir = env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| user_home_dir().map(|home| home.join(".claude")));

    config_dir
        .map(|dir| dir.join(".credentials.json").exists())
        .unwrap_or(false)
}

fn run_command_capture(
    binary: &str,
    args: &[&str],
    stdin_text: Option<&str>,
    timeout: Duration,
    working_directory: Option<&Path>,
) -> Result<CommandCapture, String> {
    let mut command = Command::new(binary);
    command.args(args);

    if let Some(directory) = working_directory {
        command.current_dir(directory);
    }

    if stdin_text.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }

    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                format!("{binary} is not installed or not available on PATH.")
            } else {
                format!("Unable to start {binary}: {error}")
            }
        })?;

    if let Some(input) = stdin_text {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(input.as_bytes())
                .map_err(|error| format!("Unable to send prompt to {binary}: {error}"))?;
        }
    }

    let started_at = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|error| format!("Unable to read {binary} output: {error}"))?;

                return Ok(CommandCapture {
                    exit_code: output.status.code(),
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                });
            }
            Ok(None) => {
                if started_at.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("{binary} timed out."));
                }

                thread::sleep(Duration::from_millis(80));
            }
            Err(error) => {
                let _ = child.kill();
                return Err(format!("Unable to wait for {binary}: {error}"));
            }
        }
    }
}

fn agent_status_for(provider: AgentProvider) -> AgentStatus {
    let definition = agent_definition(provider);
    let npm_version = npm_version();
    let npm_available = npm_version.is_some();
    let npm_version = npm_version.unwrap_or_else(|| "Not detected".to_string());
    let npm_package_version = if npm_available {
        npm_global_package_version(definition)
    } else {
        None
    };
    let npm_installed = npm_package_version.is_some();
    let npm_package_version =
        npm_package_version.unwrap_or_else(|| "Not installed with npm".to_string());
    let version_result = match provider {
        AgentProvider::Codex => run_agent_command_capture(
            definition,
            &["--version"],
            None,
            Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
            None,
        ),
        AgentProvider::Claude => run_agent_command_capture(
            definition,
            &["--version"],
            None,
            Duration::from_secs(AGENT_STATUS_TIMEOUT_SECS),
            None,
        ),
    };

    let Ok(version_capture) = version_result else {
        return AgentStatus {
            id: definition.id,
            label: definition.label,
            binary: definition.binary,
            installed: false,
            authenticated: false,
            version: "Not installed".to_string(),
            auth_message: format!("Install {} and recheck.", definition.label),
            install_command: definition.install_command,
            native_install_url: definition.native_install_url,
            native_install_label: definition.native_install_label,
            npm_available,
            npm_version,
            npm_installed,
            npm_package_version,
            recommend_native_install: true,
            connect_command: definition.connect_command,
        };
    };

    let version = first_output_line(&command_output_text(
        &version_capture.stdout,
        &version_capture.stderr,
    ));

    let (authenticated, auth_message) = match provider {
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
    };

    AgentStatus {
        id: definition.id,
        label: definition.label,
        binary: definition.binary,
        installed: true,
        authenticated,
        version: if version.is_empty() {
            "Installed".to_string()
        } else {
            version
        },
        auth_message,
        install_command: definition.install_command,
        native_install_url: definition.native_install_url,
        native_install_label: definition.native_install_label,
        npm_available,
        npm_version,
        npm_installed,
        npm_package_version,
        recommend_native_install: true,
        connect_command: definition.connect_command,
    }
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
        ),
        Err(error) => failed_agent_install_result(definition, &error, "Unable to run npm install."),
    }
}

fn launch_login_terminal(provider: AgentProvider) -> Result<(), String> {
    let definition = agent_definition(provider);
    let binary = npm_global_executable_path(definition)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| definition.binary.to_string());

    match provider {
        AgentProvider::Codex => run_login_terminal(definition.label, &binary, &["login"]),
        AgentProvider::Claude => run_login_terminal(definition.label, &binary, &[]),
    }
}

fn logout_agent_credentials(provider: AgentProvider) -> Result<AgentLogoutResult, String> {
    let definition = agent_definition(provider);
    let args = match provider {
        AgentProvider::Codex => vec!["logout"],
        AgentProvider::Claude => vec!["auth", "logout"],
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

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Unable to open {title} login terminal: {error}"))
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

    Command::new("osascript")
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
        ("xterm", vec!["-e", binary]),
    ];

    for (terminal, prefix_args) in terminal_attempts {
        let mut command = Command::new(terminal);

        if matches!(terminal, "xfce4-terminal" | "mate-terminal") {
            command.args(prefix_args);
        } else {
            command.args(prefix_args).args(args);
        }

        if command.spawn().is_ok() {
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

    let working_directory = default_working_directory()?;
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
        working_directory: working_directory.display().to_string(),
    })
}

fn normalize_terminal_size(cols: Option<u16>, rows: Option<u16>) -> PtySize {
    PtySize {
        rows: rows
            .unwrap_or(TERMINAL_DEFAULT_ROWS)
            .clamp(TERMINAL_MIN_ROWS, TERMINAL_MAX_ROWS),
        cols: cols
            .unwrap_or(TERMINAL_DEFAULT_COLS)
            .clamp(TERMINAL_MIN_COLS, TERMINAL_MAX_COLS),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn terminal_launch(
    kind: &str,
    provider: Option<String>,
    model: Option<String>,
) -> Result<(Vec<String>, Vec<String>, String), String> {
    let provider = match kind {
        "console" => provider
            .as_deref()
            .map(parse_agent_provider)
            .transpose()?
            .unwrap_or(AgentProvider::Codex),
        "codex" => AgentProvider::Codex,
        "claude" => AgentProvider::Claude,
        _ => {
            if let Some(provider) = provider {
                parse_agent_provider(&provider)?
            } else {
                return Err("Terminal kind is invalid.".to_string());
            }
        }
    };
    let definition = agent_definition(provider);
    let mut args = Vec::new();

    if let Some(model) = normalize_forge_model(model)? {
        args.push("--model".to_string());
        args.push(model);
    }

    Ok((
        agent_command_candidates(definition),
        args,
        definition.label.to_string(),
    ))
}

fn spawn_terminal_reader(app: AppHandle, pane_id: String, mut reader: Box<dyn Read + Send>) {
    thread::spawn(move || {
        let mut buffer = [0u8; 8192];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(bytes_read) => {
                    let data = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
                    let _ = app.emit(
                        "forge-terminal-data",
                        TerminalDataPayload {
                            pane_id: pane_id.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }

        let _ = app.emit(
            "forge-terminal-exit",
            TerminalExitPayload {
                pane_id,
                exit_code: None,
            },
        );
    });
}

fn close_terminal_session(state: &TerminalState, pane_id: &str) -> Result<bool, String> {
    validate_terminal_pane_id(pane_id)?;

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal session state is unavailable.".to_string())?;

    if let Some(mut session) = sessions.remove(pane_id) {
        let _ = session.child.kill();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn terminal_open(
    app: AppHandle,
    state: State<'_, TerminalState>,
    request: TerminalOpenRequest,
) -> Result<TerminalOpenResult, String> {
    validate_terminal_pane_id(&request.pane_id)?;
    let pane_id = request.pane_id;
    let _ = close_terminal_session(&state, &pane_id);

    let working_directory = default_working_directory()?;
    let (command_candidates, args, label) =
        terminal_launch(&request.kind, request.provider, request.model)?;
    let size = normalize_terminal_size(request.cols, request.rows);
    let pty_system = native_pty_system();
    let mut last_error = format!("{label} is not installed or not available on PATH.");

    for command_path in command_candidates {
        let pair = pty_system
            .openpty(size)
            .map_err(|error| format!("Unable to open terminal PTY: {error}"))?;
        let mut command = CommandBuilder::new(&command_path);

        for arg in &args {
            command.arg(arg);
        }

        command.cwd(&working_directory);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        let child = match pair.slave.spawn_command(command) {
            Ok(child) => child,
            Err(error) => {
                let detail = error.to_string();
                last_error = if detail.to_ascii_lowercase().contains("not found") {
                    format!("{label} is not installed or not available on PATH.")
                } else {
                    format!("Unable to start {label}: {detail}")
                };
                continue;
            }
        };

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("Unable to read terminal output: {error}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("Unable to write terminal input: {error}"))?;

        spawn_terminal_reader(app, pane_id.clone(), reader);

        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "Terminal session state is unavailable.".to_string())?;
        sessions.insert(
            pane_id.clone(),
            TerminalSession {
                child,
                master: pair.master,
                writer,
            },
        );

        return Ok(TerminalOpenResult {
            pane_id,
            command: command_path,
            working_directory: working_directory.display().to_string(),
        });
    }

    Err(last_error)
}

#[tauri::command]
fn terminal_write(
    state: State<'_, TerminalState>,
    pane_id: String,
    data: String,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;

    if data.is_empty() {
        return Ok(());
    }

    if data.len() > MAX_TERMINAL_WRITE_BYTES {
        return Err("Terminal input chunk is too large.".to_string());
    }

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal session state is unavailable.".to_string())?;
    let session = sessions
        .get_mut(&pane_id)
        .ok_or_else(|| "Terminal session is not running.".to_string())?;

    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("Unable to write terminal input: {error}"))?;
    session
        .writer
        .flush()
        .map_err(|error| format!("Unable to flush terminal input: {error}"))
}

#[tauri::command]
fn terminal_resize(
    state: State<'_, TerminalState>,
    pane_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;

    let size = normalize_terminal_size(Some(cols), Some(rows));
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal session state is unavailable.".to_string())?;
    let session = sessions
        .get(&pane_id)
        .ok_or_else(|| "Terminal session is not running.".to_string())?;

    session
        .master
        .resize(size)
        .map_err(|error| format!("Unable to resize terminal: {error}"))
}

#[tauri::command]
fn terminal_close(state: State<'_, TerminalState>, pane_id: String) -> Result<(), String> {
    close_terminal_session(&state, &pane_id)?;

    Ok(())
}

fn http_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("Diff Forge AI Desktop/0.1.0")
        .build()
        .map_err(|error| format!("Unable to prepare backend request: {error}"))
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
        serde_json::from_str::<Value>(&response_text)
            .map_err(|error| format!("Diff Forge AI API returned invalid JSON: {error}"))?
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
async fn create_workspace(
    token: String,
    name: String,
    terminal_count: u8,
    terminal_layout: Value,
) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;
    validate_workspace_terminal_layout(&terminal_layout)?;

    let workspace_name = name
        .replace(|character: char| character.is_control(), "")
        .trim()
        .to_string();

    if workspace_name.is_empty() || workspace_name.len() > 80 {
        return Err("Workspace name must be between 1 and 80 characters.".to_string());
    }

    if !(1..=8).contains(&terminal_count) {
        return Err("Terminal count must be between 1 and 8.".to_string());
    }

    let client = http_client(Duration::from_secs(DEFAULT_API_TIMEOUT_SECS))?;
    let response = client
        .post(format!("{API_BASE_URL}/desktop/workspaces"))
        .bearer_auth(token)
        .json(&CreateWorkspaceRequest {
            name: &workspace_name,
            terminal_count,
            terminal_layout: &terminal_layout,
        })
        .send()
        .await
        .map_err(|error| format!("Unable to create workspace: {error}"))?;

    read_api_response(response, "Unable to create workspace.").await
}

#[tauri::command]
async fn update_workspace_layout(
    token: String,
    workspace_id: String,
    terminal_layout: Value,
) -> Result<Value, String> {
    validate_auth_value("Desktop session", &token)?;
    validate_workspace_id(&workspace_id)?;
    validate_workspace_terminal_layout(&terminal_layout)?;

    let client = http_client(Duration::from_secs(DEFAULT_API_TIMEOUT_SECS))?;
    let response = client
        .patch(format!("{API_BASE_URL}/desktop/workspaces"))
        .bearer_auth(token)
        .json(&UpdateWorkspaceLayoutRequest {
            workspace_id: &workspace_id,
            terminal_layout: &terminal_layout,
        })
        .send()
        .await
        .map_err(|error| format!("Unable to save workspace layout: {error}"))?;

    read_api_response(response, "Unable to save workspace layout.").await
}

#[tauri::command]
async fn agent_statuses() -> Result<Vec<AgentStatus>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        Ok(vec![
            agent_status_for(AgentProvider::Codex),
            agent_status_for(AgentProvider::Claude),
        ])
    })
    .await
    .map_err(|error| format!("Unable to check local agents: {error}"))?
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
    .map_err(|error| format!("Unable to start local agent login: {error}"))?
}

#[tauri::command]
async fn disconnect_agent(provider: String) -> Result<AgentLogoutResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;

        logout_agent_credentials(provider)
    })
    .await
    .map_err(|error| format!("Unable to disconnect local agent: {error}"))?
}

#[tauri::command]
async fn install_agent(provider: String) -> Result<AgentInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;

        Ok(install_agent_with_npm(provider))
    })
    .await
    .map_err(|error| format!("Unable to install local agent: {error}"))?
}

#[tauri::command]
async fn update_agent(provider: String) -> Result<AgentInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = parse_agent_provider(&provider)?;

        Ok(update_agent_with_npm(provider))
    })
    .await
    .map_err(|error| format!("Unable to update local agent: {error}"))?
}

#[tauri::command]
async fn forge_working_directory() -> Result<ForgeWorkingDirectory, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let working_directory = default_working_directory()?;

        Ok(ForgeWorkingDirectory {
            working_directory: working_directory.display().to_string(),
        })
    })
    .await
    .map_err(|error| format!("Unable to read Forge working directory: {error}"))?
}

#[tauri::command]
async fn run_forge_prompt(request: ForgePromptRequest) -> Result<ForgeRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_forge_prompt_for(request))
        .await
        .map_err(|error| format!("Unable to run Forge Console prompt: {error}"))?
}

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .manage(TerminalState {
            sessions: Mutex::new(HashMap::new()),
        })
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                app.deep_link().register_all()?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_ping,
            exchange_desktop_auth_code,
            validate_desktop_session,
            logout_desktop_session,
            list_workspaces,
            create_workspace,
            update_workspace_layout,
            agent_statuses,
            start_agent_login,
            disconnect_agent,
            install_agent,
            update_agent,
            forge_working_directory,
            run_forge_prompt,
            terminal_open,
            terminal_write,
            terminal_resize,
            terminal_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running Diff Forge AI desktop");
}

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

fn push_existing_command_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !candidate.is_dir() || paths.iter().any(|path| path == &candidate) {
        return;
    }

    paths.push(candidate);
}

fn nvm_node_version_key(path: &Path) -> Vec<u64> {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .split('.')
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

fn append_nvm_node_bins(paths: &mut Vec<PathBuf>) {
    let nvm_dir = env::var_os("NVM_DIR")
        .map(PathBuf::from)
        .or_else(|| user_home_dir().map(|home| home.join(".nvm")));
    let Some(nvm_dir) = nvm_dir else {
        return;
    };

    push_existing_command_path(paths, nvm_dir.join("current").join("bin"));

    let versions_dir = nvm_dir.join("versions").join("node");
    let Ok(entries) = fs::read_dir(versions_dir) else {
        return;
    };
    let mut version_dirs = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();

    version_dirs.sort_by(|left, right| {
        nvm_node_version_key(right)
            .cmp(&nvm_node_version_key(left))
            .then_with(|| right.cmp(left))
    });

    for version_dir in version_dirs {
        push_existing_command_path(paths, version_dir.join("bin"));
    }
}

fn desktop_command_path() -> std::ffi::OsString {
    let mut paths = Vec::new();

    if let Some(home) = user_home_dir() {
        push_existing_command_path(&mut paths, home.join(".local").join("bin"));
        push_existing_command_path(&mut paths, home.join(".cargo").join("bin"));
    }
    append_nvm_node_bins(&mut paths);

    #[cfg(target_os = "macos")]
    {
        push_existing_command_path(&mut paths, PathBuf::from("/opt/homebrew/bin"));
        push_existing_command_path(&mut paths, PathBuf::from("/opt/homebrew/sbin"));
        push_existing_command_path(&mut paths, PathBuf::from("/usr/local/bin"));
        push_existing_command_path(&mut paths, PathBuf::from("/usr/local/sbin"));
    }

    if let Some(existing_path) = env::var_os("PATH") {
        for path in env::split_paths(&existing_path) {
            push_existing_command_path(&mut paths, path);
        }
    }

    env::join_paths(paths)
        .ok()
        .or_else(|| env::var_os("PATH"))
        .unwrap_or_default()
}

fn apply_desktop_command_environment(command: &mut Command) {
    command.env("PATH", desktop_command_path());
}

fn run_command_capture(
    binary: &str,
    args: &[&str],
    stdin_text: Option<&str>,
    timeout: Duration,
    working_directory: Option<&Path>,
) -> Result<CommandCapture, String> {
    run_command_capture_with_cancel_and_env(
        binary,
        args,
        stdin_text,
        timeout,
        working_directory,
        &[],
        || false,
        "Command canceled.",
    )
}

fn run_command_capture_with_env(
    binary: &str,
    args: &[&str],
    stdin_text: Option<&str>,
    timeout: Duration,
    working_directory: Option<&Path>,
    env_vars: &[(String, String)],
) -> Result<CommandCapture, String> {
    run_command_capture_with_cancel_and_env(
        binary,
        args,
        stdin_text,
        timeout,
        working_directory,
        env_vars,
        || false,
        "Command canceled.",
    )
}

fn run_command_capture_with_cancel<F>(
    binary: &str,
    args: &[&str],
    stdin_text: Option<&str>,
    timeout: Duration,
    working_directory: Option<&Path>,
    should_cancel: F,
    canceled_message: &str,
) -> Result<CommandCapture, String>
where
    F: FnMut() -> bool,
{
    run_command_capture_with_cancel_and_env(
        binary,
        args,
        stdin_text,
        timeout,
        working_directory,
        &[],
        should_cancel,
        canceled_message,
    )
}

fn run_command_capture_with_cancel_and_env<F>(
    binary: &str,
    args: &[&str],
    stdin_text: Option<&str>,
    timeout: Duration,
    working_directory: Option<&Path>,
    env_vars: &[(String, String)],
    mut should_cancel: F,
    canceled_message: &str,
) -> Result<CommandCapture, String>
where
    F: FnMut() -> bool,
{
    if app_shutdown_requested() {
        return Err(app_shutdown_blocked_message(binary));
    }

    if should_cancel() {
        return Err(canceled_message.to_string());
    }

    let mut command = Command::new(binary);
    apply_desktop_command_environment(&mut command);
    command.args(args);
    for (key, value) in env_vars {
        command.env(key, value);
    }

    if let Some(directory) = working_directory {
        command.current_dir(workspace_path_for_process(directory));
    }

    if stdin_text.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    if app_shutdown_requested() {
        return Err(app_shutdown_blocked_message(binary));
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
        if should_cancel() || app_shutdown_requested() {
            let _ = child.kill();
            let _ = child.wait();
            return if app_shutdown_requested() {
                Err(app_shutdown_blocked_message(binary))
            } else {
                Err(canceled_message.to_string())
            };
        }

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

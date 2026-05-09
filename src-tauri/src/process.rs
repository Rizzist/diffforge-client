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
    run_command_capture_with_cancel(
        binary,
        args,
        stdin_text,
        timeout,
        working_directory,
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
    mut should_cancel: F,
    canceled_message: &str,
) -> Result<CommandCapture, String>
where
    F: FnMut() -> bool,
{
    if should_cancel() {
        return Err(canceled_message.to_string());
    }

    let mut command = Command::new(binary);
    command.args(args);

    if let Some(directory) = working_directory {
        command.current_dir(workspace_path_for_process(directory));
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
        if should_cancel() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(canceled_message.to_string());
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

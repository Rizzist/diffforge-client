const LOCAL_SCRIPTS_ROOT_DIR: &str = "local-scripts";
const LOCAL_SCRIPTS_FILE_DIR: &str = "scripts";
const LOCAL_SCRIPTS_META_SUFFIX: &str = ".diffforge.json";
const LOCAL_SCRIPTS_RUN_TIMEOUT_MS: u128 = 120_000;
const LOCAL_SCRIPTS_RUN_OUTPUT_LIMIT_BYTES: usize = 512 * 1024;
const LOCAL_SCRIPT_RUN_EVENT: &str = "diffforge://local-script-run";
const LOCAL_SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR: &str = "#1f3f7a";
const LOCAL_SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR: &str = "#4b3512";
const LOCAL_SCRIPT_DEFAULT_TEXT_COLOR: &str = "#ffffff";

fn local_scripts_root() -> Result<PathBuf, String> {
    cloud_mcp_local_data_file_path(LOCAL_SCRIPTS_ROOT_DIR)
        .map(|path| path.join(LOCAL_SCRIPTS_FILE_DIR))
        .ok_or_else(|| "Unable to resolve local scripts directory.".to_string())
}

fn local_scripts_now_iso() -> String {
    chrono_like_now_iso()
}

fn local_scripts_text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn local_scripts_slug(value: &str, fallback: &str) -> String {
    let mut slug = String::new();
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if matches!(character, '-' | '_' | ' ' | '.') {
            if !slug.ends_with('_') && !slug.ends_with('-') && !slug.is_empty() {
                slug.push('_');
            }
        }
    }
    let trimmed = slug.trim_matches(['_', '-']).to_string();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed
    }
}

fn local_scripts_normalized_extension(value: &str, shell: &str) -> String {
    let extension = value
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if !extension.is_empty()
        && extension.len() <= 12
        && extension
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return extension;
    }
    match shell.trim().to_ascii_lowercase().as_str() {
        "python" | "python3" | "py" => "py".to_string(),
        "node" | "javascript" | "js" => "js".to_string(),
        "bash" => "sh".to_string(),
        "powershell" | "pwsh" | "ps1" => "ps1".to_string(),
        "cmd" => "cmd".to_string(),
        "bat" => "bat".to_string(),
        _ => "sh".to_string(),
    }
}

fn local_scripts_normalized_shell(value: &str, extension: &str) -> String {
    let shell = value.trim().to_ascii_lowercase();
    match shell.as_str() {
        "bash" | "zsh" | "sh" | "python" | "python3" | "node" | "powershell" | "pwsh" | "cmd" => {
            shell
        }
        _ => match extension {
            "py" => "python3".to_string(),
            "js" | "mjs" | "cjs" => "node".to_string(),
            "bash" => "bash".to_string(),
            "zsh" => "zsh".to_string(),
            "ps1" => "powershell".to_string(),
            "bat" | "cmd" => "cmd".to_string(),
            _ => "zsh".to_string(),
        },
    }
}

fn local_scripts_rel_path_from_request(request: &Value) -> Result<String, String> {
    let mut rel = local_scripts_text(
        request
            .get("path_key")
            .or_else(|| request.get("file_path"))
            .or_else(|| request.get("path")),
    );
    let shell = local_scripts_text(request.get("shell"));
    let extension = local_scripts_normalized_extension(
        &local_scripts_text(request.get("extension").or_else(|| request.get("ext"))),
        &shell,
    );
    if rel.is_empty() {
        let title = local_scripts_text(request.get("title").or_else(|| request.get("name")));
        let file_name = local_scripts_text(request.get("file_name").or_else(|| request.get("fileName")));
        let name = if file_name.is_empty() {
            local_scripts_slug(&title, "script")
        } else {
            file_name
        };
        rel = if name.contains('.') {
            name
        } else {
            format!("{name}.{extension}")
        };
    }
    let rel = rel.replace('\\', "/");
    let mut parts = Vec::new();
    for part in rel.split('/') {
        let part = part.trim();
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." || part.contains('\0') {
            return Err("Script path cannot traverse outside the local scripts folder.".to_string());
        }
        parts.push(part.to_string());
    }
    if parts.is_empty() {
        return Err("Script path is required.".to_string());
    }
    let last = parts.pop().unwrap_or_else(|| "script".to_string());
    let normalized_leaf = if last.contains('.') {
        last
    } else {
        format!("{last}.{extension}")
    };
    parts.push(normalized_leaf);
    Ok(parts.join("/"))
}

fn local_scripts_abs_path(rel_path: &str) -> Result<PathBuf, String> {
    let root = local_scripts_root()?;
    let mut path = root.clone();
    for part in rel_path.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains('\0') {
            return Err("Invalid local script path.".to_string());
        }
        path.push(part);
    }
    if !path.starts_with(&root) {
        return Err("Script path escaped the local scripts directory.".to_string());
    }
    Ok(path)
}

fn local_scripts_reject_symlink_components(root: &Path, path: &Path) -> Result<(), String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "Script path escaped the local scripts directory.".to_string())?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return Err("Invalid local script path.".to_string());
        };
        current.push(part);
        if let Ok(metadata) = fs::symlink_metadata(&current) {
            if metadata.file_type().is_symlink() {
                return Err("Local script paths cannot contain symlinks.".to_string());
            }
        }
    }
    Ok(())
}

fn local_scripts_meta_path(script_path: &Path) -> PathBuf {
    let file_name = script_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("script");
    script_path.with_file_name(format!("{file_name}{LOCAL_SCRIPTS_META_SUFFIX}"))
}

fn local_scripts_read_meta(script_path: &Path) -> Value {
    let meta_path = local_scripts_meta_path(script_path);
    fs::read_to_string(meta_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

fn local_scripts_truncate_output(bytes: &[u8]) -> (String, bool) {
    if bytes.len() <= LOCAL_SCRIPTS_RUN_OUTPUT_LIMIT_BYTES {
        return (String::from_utf8_lossy(bytes).to_string(), false);
    }
    let mut output = String::from_utf8_lossy(&bytes[..LOCAL_SCRIPTS_RUN_OUTPUT_LIMIT_BYTES]).to_string();
    output.push_str("\n\n[Diff Forge truncated script output]");
    (output, true)
}

fn local_scripts_emit_run_event(app: &AppHandle, payload: Value) {
    let _ = app.emit(LOCAL_SCRIPT_RUN_EVENT, payload);
}

fn local_scripts_append_limited_output(target: &Arc<StdMutex<Vec<u8>>>, chunk: &[u8]) {
    if chunk.is_empty() {
        return;
    }
    if let Ok(mut output) = target.lock() {
        if output.len() >= LOCAL_SCRIPTS_RUN_OUTPUT_LIMIT_BYTES {
            return;
        }
        let remaining = LOCAL_SCRIPTS_RUN_OUTPUT_LIMIT_BYTES - output.len();
        output.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
    }
}

fn local_scripts_output_bytes(target: &Arc<StdMutex<Vec<u8>>>) -> Vec<u8> {
    target
        .lock()
        .map(|output| output.clone())
        .unwrap_or_default()
}

fn local_scripts_spawn_output_reader(
    app: AppHandle,
    run_id: String,
    rel_path: String,
    stream: &'static str,
    reader: impl Read + Send + 'static,
    output: Arc<StdMutex<Vec<u8>>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut reader = std::io::BufReader::new(reader);
        loop {
            let mut chunk = Vec::new();
            match std::io::BufRead::read_until(&mut reader, b'\n', &mut chunk) {
                Ok(0) => break,
                Ok(_) => {
                    local_scripts_append_limited_output(&output, &chunk);
                    local_scripts_emit_run_event(&app, json!({
                        "chunk": String::from_utf8_lossy(&chunk).to_string(),
                        "kind": "local_script_run",
                        "path_key": rel_path,
                        "run_id": run_id,
                        "stage": "output",
                        "stream": stream,
                    }));
                }
                Err(error) => {
                    local_scripts_emit_run_event(&app, json!({
                        "chunk": format!("[Diff Forge could not read {stream}: {error}]\n"),
                        "kind": "local_script_run",
                        "path_key": rel_path,
                        "run_id": run_id,
                        "stage": "output",
                        "stream": "stderr",
                    }));
                    break;
                }
            }
        }
    })
}

fn local_scripts_write_meta(script_path: &Path, meta: &Value) -> Result<(), String> {
    let meta_path = local_scripts_meta_path(script_path);
    if let Some(parent) = meta_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let data = serde_json::to_vec_pretty(meta).map_err(|error| error.to_string())?;
    fs::write(meta_path, data).map_err(|error| error.to_string())
}

fn local_scripts_rel_from_abs(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| {
            relative
                .components()
                .filter_map(|component| match component {
                    Component::Normal(value) => Some(value.to_string_lossy().to_string()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("/")
        })
        .filter(|value| !value.is_empty())
}

fn local_scripts_title_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("script")
        .replace(['_', '-'], " ")
}

fn local_scripts_value_for_path(root: &Path, path: &Path, include_content: bool) -> Option<Value> {
    let rel_path = local_scripts_rel_from_abs(root, path)?;
    if rel_path.ends_with(LOCAL_SCRIPTS_META_SUFFIX) {
        return None;
    }
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let meta = local_scripts_read_meta(path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("sh")
        .to_ascii_lowercase();
    let shell = local_scripts_normalized_shell(
        meta.get("shell").and_then(Value::as_str).unwrap_or(""),
        &extension,
    );
    let title = local_scripts_text(meta.get("title").or_else(|| meta.get("name")));
    let content = if include_content {
        fs::read_to_string(path).unwrap_or_default()
    } else {
        String::new()
    };
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_default();
    let content_hash = if include_content {
        format!("{:x}", Sha256::digest(content.as_bytes()))
    } else {
        String::new()
    };
    Some(json!({
        "content": if include_content { content } else { String::new() },
        "content_hash": content_hash,
        "created_at": local_scripts_text(meta.get("created_at")),
        "extension": extension,
        "file_name": path.file_name().and_then(|value| value.to_str()).unwrap_or("script.sh"),
        "id": rel_path,
        "local_path": path.to_string_lossy(),
        "loopspace_button_color": local_scripts_text(meta.get("loopspace_button_color")).if_empty(LOCAL_SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR),
        "loopspace_text_color": local_scripts_text(meta.get("loopspace_text_color")).if_empty(LOCAL_SCRIPT_DEFAULT_TEXT_COLOR),
        "modified_at": modified_at,
        "path_key": rel_path,
        "shell": shell,
        "size_bytes": metadata.len(),
        "title": if title.is_empty() { local_scripts_title_from_path(path) } else { title },
        "updated_at": local_scripts_text(meta.get("updated_at")),
        "workspace_button_color": local_scripts_text(meta.get("workspace_button_color")).if_empty(LOCAL_SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR),
        "workspace_text_color": local_scripts_text(meta.get("workspace_text_color")).if_empty(LOCAL_SCRIPT_DEFAULT_TEXT_COLOR),
        "working_directory": local_scripts_text(meta.get("working_directory")),
    }))
}

trait LocalScriptsEmptyDefault {
    fn if_empty(self, fallback: &str) -> String;
}

impl LocalScriptsEmptyDefault for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

fn local_scripts_collect_files(root: &Path, dir: &Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let mut entries = fs::read_dir(dir)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| a.to_string_lossy().cmp(&b.to_string_lossy()));
    for path in entries {
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if path.file_name().and_then(|value| value.to_str()).unwrap_or("").starts_with('.') {
            continue;
        }
        if metadata.is_dir() {
            local_scripts_collect_files(root, &path, output)?;
            continue;
        }
        if path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .ends_with(LOCAL_SCRIPTS_META_SUFFIX)
        {
            continue;
        }
        if path.starts_with(root) {
            output.push(path);
        }
    }
    Ok(())
}

#[tauri::command]
async fn local_scripts_list(request: Option<Value>) -> Result<Value, String> {
    let request = request.unwrap_or_else(|| json!({}));
    let include_content = request
        .get("include_content")
        .or_else(|| request.get("includeContent"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let root = local_scripts_root()?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let mut files = Vec::new();
    local_scripts_collect_files(&root, &root, &mut files)?;
    let scripts = files
        .iter()
        .filter_map(|path| local_scripts_value_for_path(&root, path, include_content))
        .collect::<Vec<_>>();
    Ok(json!({
        "kind": "local_scripts",
        "root": root.to_string_lossy(),
        "scripts": scripts,
    }))
}

#[tauri::command]
async fn local_scripts_read(request: Value) -> Result<Value, String> {
    let rel_path = local_scripts_rel_path_from_request(&request)?;
    let root = local_scripts_root()?;
    let path = local_scripts_abs_path(&rel_path)?;
    local_scripts_reject_symlink_components(&root, &path)?;
    let script = local_scripts_value_for_path(&root, &path, true)
        .ok_or_else(|| "Local script was not found.".to_string())?;
    Ok(json!({
        "kind": "local_script",
        "script": script,
    }))
}

#[tauri::command]
async fn local_scripts_save(request: Value) -> Result<Value, String> {
    let rel_path = local_scripts_rel_path_from_request(&request)?;
    let root = local_scripts_root()?;
    let path = local_scripts_abs_path(&rel_path)?;
    local_scripts_reject_symlink_components(&root, &path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let now = local_scripts_now_iso();
    let content = String::from(
        request
            .get("content")
            .or_else(|| request.get("content_md"))
            .and_then(Value::as_str)
            .unwrap_or(""),
    );
    fs::write(&path, content.as_bytes()).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&path)
            .map_err(|error| error.to_string())?
            .permissions();
        permissions.set_mode(0o755);
        let _ = fs::set_permissions(&path, permissions);
    }
    let existing_meta = local_scripts_read_meta(&path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("sh")
        .to_ascii_lowercase();
    let shell = local_scripts_normalized_shell(
        &local_scripts_text(request.get("shell")).if_empty(
            existing_meta
                .get("shell")
                .and_then(Value::as_str)
                .unwrap_or(""),
        ),
        &extension,
    );
    let title = local_scripts_text(request.get("title").or_else(|| request.get("name")))
        .if_empty(&local_scripts_text(existing_meta.get("title")).if_empty(&local_scripts_title_from_path(&path)));
    let created_at = local_scripts_text(existing_meta.get("created_at")).if_empty(&now);
    let meta = json!({
        "created_at": created_at,
        "loopspace_button_color": local_scripts_text(request.get("loopspace_button_color")).if_empty(&local_scripts_text(existing_meta.get("loopspace_button_color")).if_empty(LOCAL_SCRIPT_DEFAULT_LOOPSPACE_BUTTON_COLOR)),
        "loopspace_text_color": local_scripts_text(request.get("loopspace_text_color")).if_empty(&local_scripts_text(existing_meta.get("loopspace_text_color")).if_empty(LOCAL_SCRIPT_DEFAULT_TEXT_COLOR)),
        "shell": shell,
        "title": title,
        "updated_at": now,
        "workspace_button_color": local_scripts_text(request.get("workspace_button_color")).if_empty(&local_scripts_text(existing_meta.get("workspace_button_color")).if_empty(LOCAL_SCRIPT_DEFAULT_WORKSPACE_BUTTON_COLOR)),
        "workspace_text_color": local_scripts_text(request.get("workspace_text_color")).if_empty(&local_scripts_text(existing_meta.get("workspace_text_color")).if_empty(LOCAL_SCRIPT_DEFAULT_TEXT_COLOR)),
        "working_directory": local_scripts_text(request.get("working_directory")).if_empty(&local_scripts_text(existing_meta.get("working_directory"))),
    });
    local_scripts_write_meta(&path, &meta)?;
    let script = local_scripts_value_for_path(&root, &path, true)
        .ok_or_else(|| "Local script was saved but could not be read back.".to_string())?;
    Ok(json!({
        "kind": "local_script_saved",
        "script": script,
    }))
}

#[tauri::command]
async fn local_scripts_delete(request: Value) -> Result<Value, String> {
    let rel_path = local_scripts_rel_path_from_request(&request)?;
    let root = local_scripts_root()?;
    let path = local_scripts_abs_path(&rel_path)?;
    local_scripts_reject_symlink_components(&root, &path)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    let meta_path = local_scripts_meta_path(&path);
    if meta_path.exists() {
        let _ = fs::remove_file(meta_path);
    }
    Ok(json!({
        "kind": "local_script_deleted",
        "path_key": rel_path,
    }))
}

#[tauri::command]
async fn local_scripts_run(app: AppHandle, request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let rel_path = local_scripts_rel_path_from_request(&request)?;
        let root = local_scripts_root()?;
        let path = local_scripts_abs_path(&rel_path)?;
        local_scripts_reject_symlink_components(&root, &path)?;
        if !path.exists() {
            return Err("Local script was not found.".to_string());
        }
        let script = local_scripts_value_for_path(&root, &path, false)
            .ok_or_else(|| "Local script was not found.".to_string())?;
        let extension = script
            .get("extension")
            .and_then(Value::as_str)
            .unwrap_or("sh")
            .to_ascii_lowercase();
        let shell = local_scripts_normalized_shell(
            request
                .get("shell")
                .and_then(Value::as_str)
                .or_else(|| script.get("shell").and_then(Value::as_str))
                .unwrap_or(""),
            &extension,
        );
        let interpreter = match shell.as_str() {
            "python" | "python3" => "python3",
            "node" => "node",
            "bash" => "bash",
            "sh" => "sh",
            "powershell" => {
                if cfg!(target_os = "windows") {
                    "powershell"
                } else {
                    "pwsh"
                }
            }
            "pwsh" => "pwsh",
            "cmd" => "cmd",
            _ => "zsh",
        };
        let explicit_cwd = local_scripts_text(
            request
                .get("working_directory")
                .or_else(|| request.get("cwd")),
        );
        let default_cwd = local_scripts_text(
            request
                .get("default_working_directory")
                .or_else(|| request.get("defaultWorkingDirectory")),
        );
        let cwd = explicit_cwd
            .if_empty(script.get("working_directory").and_then(Value::as_str).unwrap_or(""))
            .if_empty(&default_cwd);
        let run_id = local_scripts_text(request.get("run_id"))
            .if_empty(&format!("script-run-{}", local_scripts_now_iso()));
        let started_at_iso = local_scripts_now_iso();
        let started_at = Instant::now();
        local_scripts_emit_run_event(&app, json!({
            "cwd": cwd,
            "kind": "local_script_run",
            "path_key": rel_path,
            "run_id": run_id,
            "script": script,
            "stage": "start",
            "started_at": started_at_iso,
        }));
        let mut command = Command::new(interpreter);
        match shell.as_str() {
            "cmd" => {
                command.arg("/C").arg(&path);
            }
            "powershell" | "pwsh" => {
                command
                    .arg("-NoProfile")
                    .arg("-ExecutionPolicy")
                    .arg("Bypass")
                    .arg("-File")
                    .arg(&path);
            }
            _ => {
                command.arg(&path);
            }
        }
        if !cwd.is_empty() {
            command.current_dir(cwd);
        }
        let mut child = command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| error.to_string())?;
        let stdout_output = Arc::new(StdMutex::new(Vec::new()));
        let stderr_output = Arc::new(StdMutex::new(Vec::new()));
        let mut readers = Vec::new();
        if let Some(stdout) = child.stdout.take() {
            readers.push(local_scripts_spawn_output_reader(
                app.clone(),
                run_id.clone(),
                rel_path.clone(),
                "stdout",
                stdout,
                stdout_output.clone(),
            ));
        }
        if let Some(stderr) = child.stderr.take() {
            readers.push(local_scripts_spawn_output_reader(
                app.clone(),
                run_id.clone(),
                rel_path.clone(),
                "stderr",
                stderr,
                stderr_output.clone(),
            ));
        }
        let (status, timed_out) = loop {
            if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                break (status, false);
            }
            if started_at.elapsed().as_millis() > LOCAL_SCRIPTS_RUN_TIMEOUT_MS {
                let _ = child.kill();
                let status = child.wait().map_err(|error| error.to_string())?;
                break (status, true);
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        for reader in readers {
            let _ = reader.join();
        }
        let duration_ms = started_at.elapsed().as_millis() as u64;
        let ended_at_iso = local_scripts_now_iso();
        let stdout_bytes = local_scripts_output_bytes(&stdout_output);
        let stderr_bytes = local_scripts_output_bytes(&stderr_output);
        let (stdout, stdout_truncated) = local_scripts_truncate_output(&stdout_bytes);
        let (stderr, stderr_truncated) = local_scripts_truncate_output(&stderr_bytes);
        let result = json!({
            "duration_ms": duration_ms,
            "ended_at": ended_at_iso,
            "error": if timed_out { "Script timed out after 120 seconds." } else { "" },
            "exit_code": status.code(),
            "kind": "local_script_run",
            "ok": status.success() && !timed_out,
            "path_key": rel_path,
            "run_id": run_id,
            "script": script,
            "started_at": started_at_iso,
            "stderr": stderr,
            "stderr_truncated": stderr_truncated,
            "stdout": stdout,
            "stdout_truncated": stdout_truncated,
            "timed_out": timed_out,
        });
        local_scripts_emit_run_event(&app, {
            let mut payload = result.clone();
            if let Some(object) = payload.as_object_mut() {
                object.insert("stage".to_string(), json!("finish"));
            }
            payload
        });
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

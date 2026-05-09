pub(crate) fn default_working_directory() -> Result<PathBuf, String> {
    let current_dir = env::current_dir()
        .map_err(|error| format!("Unable to read current working directory: {error}"))?;

    let working_directory = if current_dir
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == "src-tauri")
    {
        if let Some(parent) = current_dir.parent() {
            parent.to_path_buf()
        } else {
            current_dir
        }
    } else {
        current_dir
    };

    if should_fallback_default_working_directory(&working_directory) {
        if let Some(fallback_directory) = default_working_directory_fallback() {
            return Ok(fallback_directory);
        }
    }

    Ok(working_directory)
}

fn default_working_directory_fallback() -> Option<PathBuf> {
    source_project_directory().or_else(user_home_dir)
}

fn source_project_directory() -> Option<PathBuf> {
    let tauri_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = if tauri_root
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == "src-tauri")
    {
        tauri_root.parent().map(Path::to_path_buf)?
    } else {
        tauri_root
    };

    project_root
        .canonicalize()
        .ok()
        .filter(|directory| directory.is_dir())
}

fn should_fallback_default_working_directory(directory: &Path) -> bool {
    is_filesystem_root_directory(directory) || is_windows_system_startup_directory(directory)
}

pub(crate) fn is_filesystem_root_directory(directory: &Path) -> bool {
    #[cfg(windows)]
    {
        let _ = directory;
        false
    }

    #[cfg(not(windows))]
    {
        directory.has_root() && directory.parent().is_none()
    }
}

#[cfg(windows)]
fn is_windows_drive_path_text(value: &str) -> bool {
    let bytes = value.as_bytes();

    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

#[cfg(windows)]
fn windows_non_verbatim_path_text(path_text: &str) -> String {
    if let Some(rest) = path_text.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }

    if let Some(rest) = path_text.strip_prefix(r"\\?\") {
        if is_windows_drive_path_text(rest) {
            return rest.to_string();
        }
    }

    if let Some(rest) = path_text.strip_prefix("//?/UNC/") {
        return format!("//{rest}");
    }

    if let Some(rest) = path_text.strip_prefix("//?/") {
        if is_windows_drive_path_text(rest) {
            return rest.to_string();
        }
    }

    path_text.to_string()
}

#[cfg(windows)]
fn workspace_path_for_process(path: &Path) -> PathBuf {
    PathBuf::from(windows_non_verbatim_path_text(
        path.to_string_lossy().as_ref(),
    ))
}

#[cfg(not(windows))]
fn workspace_path_for_process(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn workspace_path_display(path: &Path) -> String {
    #[cfg(windows)]
    {
        windows_non_verbatim_path_text(path.to_string_lossy().as_ref())
    }

    #[cfg(not(windows))]
    {
        path.display().to_string()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorkspaceAgentsGitignoreUpdate {
    Added,
    AlreadyIgnored,
    NoAgentsDirectory,
}

fn trim_gitignore_ascii(value: &[u8]) -> &[u8] {
    let mut start = 0usize;
    let mut end = value.len();

    while start < end && matches!(value[start], b' ' | b'\t' | b'\r') {
        start += 1;
    }

    while end > start && matches!(value[end - 1], b' ' | b'\t' | b'\r') {
        end -= 1;
    }

    &value[start..end]
}

fn gitignore_pattern_ignores_agents(line: &[u8]) -> bool {
    let mut pattern = trim_gitignore_ascii(line);

    if pattern.is_empty() || pattern.starts_with(b"#") || pattern.starts_with(b"!") {
        return false;
    }

    if let Some(stripped) = pattern.strip_prefix(b"/") {
        pattern = stripped;
    }

    if let Some(stripped) = pattern.strip_suffix(b"/**") {
        pattern = stripped;
    }

    while let Some(stripped) = pattern.strip_suffix(b"/") {
        pattern = stripped;
    }

    pattern == b".agents"
}

fn workspace_agents_gitignore_update_label(update: WorkspaceAgentsGitignoreUpdate) -> &'static str {
    match update {
        WorkspaceAgentsGitignoreUpdate::Added => "added",
        WorkspaceAgentsGitignoreUpdate::AlreadyIgnored => "already_ignored",
        WorkspaceAgentsGitignoreUpdate::NoAgentsDirectory => "no_agents_directory",
    }
}

fn ensure_workspace_agents_gitignore(root: &Path) -> Result<WorkspaceAgentsGitignoreUpdate, String> {
    let agents_path = root.join(".agents");
    let agents_metadata = match fs::metadata(&agents_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WorkspaceAgentsGitignoreUpdate::NoAgentsDirectory);
        }
        Err(error) => {
            return Err(format!(
                "Unable to inspect workspace .agents directory: {error}"
            ));
        }
    };

    if !agents_metadata.is_dir() {
        return Ok(WorkspaceAgentsGitignoreUpdate::NoAgentsDirectory);
    }

    let gitignore_path = root.join(".gitignore");
    let existing = match fs::read(&gitignore_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => {
            return Err(format!(
                "Unable to read workspace .gitignore for .agents protection: {error}"
            ));
        }
    };

    if existing
        .split(|byte| *byte == b'\n')
        .any(gitignore_pattern_ignores_agents)
    {
        return Ok(WorkspaceAgentsGitignoreUpdate::AlreadyIgnored);
    }

    let mut addition = Vec::new();

    if !existing.is_empty() && !existing.ends_with(b"\n") {
        addition.push(b'\n');
    }

    addition.extend_from_slice(b".agents/\n");

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&gitignore_path)
        .map_err(|error| {
            format!("Unable to update workspace .gitignore for .agents protection: {error}")
        })?;
    file.write_all(&addition).map_err(|error| {
        format!("Unable to write workspace .gitignore for .agents protection: {error}")
    })?;

    Ok(WorkspaceAgentsGitignoreUpdate::Added)
}

fn normalized_path_key(path: &Path) -> String {
    workspace_path_display(path)
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn is_windows_system_startup_directory(directory: &Path) -> bool {
    #[cfg(windows)]
    {
        let directory_key = normalized_path_key(directory);
        let Some(system_root) = env::var_os("SystemRoot")
            .or_else(|| env::var_os("WINDIR"))
            .map(PathBuf::from)
        else {
            return false;
        };

        let system_root_key = normalized_path_key(&system_root);
        let system32_key = normalized_path_key(&system_root.join("System32"));
        let syswow64_key = normalized_path_key(&system_root.join("SysWOW64"));

        directory_key == system_root_key
            || directory_key == system32_key
            || directory_key == syswow64_key
            || directory_key.starts_with(&(system32_key + "/"))
            || directory_key.starts_with(&(syswow64_key + "/"))
    }

    #[cfg(not(windows))]
    {
        let _ = directory;
        false
    }
}

fn resolve_workspace_root_directory(value: Option<&str>) -> Result<PathBuf, String> {
    let Some(value) = value else {
        return default_working_directory();
    };
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return default_working_directory();
    }

    if trimmed.len() > MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH {
        return Err("Workspace root directory path is too long.".to_string());
    }

    if trimmed
        .bytes()
        .any(|byte| byte.is_ascii_control() || byte == b'\x7f')
    {
        return Err("Workspace root directory path is invalid.".to_string());
    }

    let directory = PathBuf::from(trimmed);
    let canonical = directory
        .canonicalize()
        .map_err(|error| format!("Unable to read workspace root directory: {error}"))?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("Unable to inspect workspace root directory: {error}"))?;

    if !metadata.is_dir() {
        return Err("Workspace root directory must be an existing directory.".to_string());
    }

    if is_filesystem_root_directory(&canonical) {
        return Err("Workspace root directory cannot be the filesystem root.".to_string());
    }

    if is_windows_system_startup_directory(&canonical) {
        return Err("Workspace root directory cannot be a Windows system folder.".to_string());
    }

    Ok(canonical)
}

fn clean_workspace_relative_path(value: &str) -> Result<PathBuf, String> {
    if value
        .bytes()
        .any(|byte| byte.is_ascii_control() || byte == b'\x7f')
    {
        return Err("Workspace path is invalid.".to_string());
    }

    let mut relative_path = PathBuf::new();

    for component in Path::new(value.trim()).components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => relative_path.push(part),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Workspace path must stay inside the workspace directory.".to_string());
            }
        }
    }

    Ok(relative_path)
}

fn workspace_relative_display(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
}

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn resolve_workspace_child_path(
    root: &Path,
    relative_path: &str,
) -> Result<(PathBuf, String), String> {
    let cleaned_relative = clean_workspace_relative_path(relative_path)?;
    let requested_path = root.join(&cleaned_relative);
    let canonical = requested_path
        .canonicalize()
        .map_err(|error| format!("Unable to read workspace path: {error}"))?;

    if !canonical.starts_with(root) {
        return Err("Workspace path must stay inside the workspace directory.".to_string());
    }

    Ok((canonical, workspace_relative_display(&cleaned_relative)))
}

fn child_relative_path(root: &Path, child: &Path) -> Option<String> {
    child
        .strip_prefix(root)
        .ok()
        .map(workspace_relative_display)
}

fn normalize_git_status_path(path: &str) -> String {
    path.replace('\\', "/").trim_matches('/').to_string()
}

fn git_status_priority(status: &str) -> u8 {
    match status {
        "conflicted" => 60,
        "deleted" => 50,
        "modified" => 40,
        "renamed" => 30,
        "copied" => 30,
        "added" => 20,
        "untracked" => 20,
        _ => 0,
    }
}

fn git_status_from_code(code: &str) -> Option<&'static str> {
    let mut chars = code.chars();
    let index = chars.next().unwrap_or(' ');
    let working_tree = chars.next().unwrap_or(' ');

    if index == '?' && working_tree == '?' {
        return Some("untracked");
    }

    if index == 'U'
        || working_tree == 'U'
        || matches!((index, working_tree), ('A', 'A') | ('D', 'D'))
    {
        return Some("conflicted");
    }

    if index == 'D' || working_tree == 'D' {
        return Some("deleted");
    }

    if index == 'A' || working_tree == 'A' {
        return Some("added");
    }

    if index == 'M' || working_tree == 'M' || index == 'T' || working_tree == 'T' {
        return Some("modified");
    }

    if index == 'R' || working_tree == 'R' {
        return Some("renamed");
    }

    if index == 'C' || working_tree == 'C' {
        return Some("copied");
    }

    None
}

fn parse_git_status_output(output: &str) -> HashMap<String, String> {
    let parts = output.split('\0').collect::<Vec<_>>();
    let mut statuses: HashMap<String, String> = HashMap::new();
    let mut index = 0;

    while index < parts.len() {
        let entry = parts[index];

        if entry.is_empty() {
            index += 1;
            continue;
        }

        let Some(code) = entry.get(0..2) else {
            index += 1;
            continue;
        };
        let path = normalize_git_status_path(entry.get(3..).unwrap_or(""));

        if !path.is_empty() {
            if let Some(status) = git_status_from_code(code) {
                let should_replace = statuses
                    .get(&path)
                    .map(|current| git_status_priority(status) > git_status_priority(current))
                    .unwrap_or(true);

                if should_replace {
                    statuses.insert(path, status.to_string());
                }
            }
        }

        if code.starts_with('R') || code.starts_with('C') {
            index += 2;
        } else {
            index += 1;
        }
    }

    statuses
}

fn workspace_git_statuses(root: &Path) -> HashMap<String, String> {
    let capture = match run_command_capture(
        "git",
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        None,
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        Some(root),
    ) {
        Ok(capture) => capture,
        Err(_) => return HashMap::new(),
    };

    if capture.exit_code != Some(0) {
        return HashMap::new();
    }

    parse_git_status_output(&capture.stdout)
}

fn git_status_for_relative_path(
    statuses: &HashMap<String, String>,
    relative_path: &str,
    kind: &str,
) -> Option<String> {
    let normalized = normalize_git_status_path(relative_path);

    if normalized.is_empty() {
        return None;
    }

    if let Some(status) = statuses.get(&normalized) {
        return Some(status.clone());
    }

    if kind != "directory" {
        return None;
    }

    let prefix = format!("{normalized}/");
    let mut best_status: Option<&String> = None;

    for (path, status) in statuses {
        if !path.starts_with(&prefix) {
            continue;
        }

        let should_replace = best_status
            .map(|current| git_status_priority(status) > git_status_priority(current))
            .unwrap_or(true);

        if should_replace {
            best_status = Some(status);
        }
    }

    best_status.cloned()
}

fn directory_entry_from_path(
    root: &Path,
    path: PathBuf,
    metadata: fs::Metadata,
    git_statuses: &HashMap<String, String>,
) -> Option<WorkspaceDirectoryEntry> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let kind = if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() {
        "file"
    } else {
        return None;
    };
    let relative_path = child_relative_path(root, &path)?;

    Some(WorkspaceDirectoryEntry {
        name,
        git_status: git_status_for_relative_path(git_statuses, &relative_path, kind),
        relative_path,
        kind: kind.to_string(),
        size: metadata.is_file().then_some(metadata.len()),
        modified_ms: modified_ms(&metadata),
    })
}

fn list_workspace_directory_for(
    root: String,
    relative_path: String,
) -> Result<WorkspaceDirectoryListing, String> {
    let workspace_root = resolve_workspace_root_directory(Some(&root))?;
    let (directory, normalized_relative_path) =
        resolve_workspace_child_path(&workspace_root, &relative_path)?;
    let metadata = fs::metadata(&directory)
        .map_err(|error| format!("Unable to inspect workspace folder: {error}"))?;

    if !metadata.is_dir() {
        return Err("Workspace path is not a folder.".to_string());
    }

    let mut entries = Vec::new();
    let mut truncated = false;
    let git_statuses = workspace_git_statuses(&workspace_root);
    let read_dir = fs::read_dir(&directory)
        .map_err(|error| format!("Unable to list workspace folder: {error}"))?;

    for entry in read_dir {
        if entries.len() >= MAX_FILE_EXPLORER_ENTRIES {
            truncated = true;
            break;
        }

        let Ok(entry) = entry else {
            continue;
        };
        let Ok(path) = entry.path().canonicalize() else {
            continue;
        };

        if !path.starts_with(&workspace_root) {
            continue;
        }

        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };

        if let Some(entry) =
            directory_entry_from_path(&workspace_root, path, metadata, &git_statuses)
        {
            entries.push(entry);
        }
    }

    entries.sort_by(|left, right| {
        let left_dir = left.kind == "directory";
        let right_dir = right.kind == "directory";

        right_dir
            .cmp(&left_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(WorkspaceDirectoryListing {
        root: workspace_path_display(&workspace_root),
        relative_path: normalized_relative_path,
        entries,
        truncated,
    })
}

fn read_workspace_file_for(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileText, String> {
    let workspace_root = resolve_workspace_root_directory(Some(&root))?;
    let (file_path, normalized_relative_path) =
        resolve_workspace_child_path(&workspace_root, &relative_path)?;
    let metadata = fs::metadata(&file_path)
        .map_err(|error| format!("Unable to inspect workspace file: {error}"))?;

    if !metadata.is_file() {
        return Err("Workspace path is not a file.".to_string());
    }

    if metadata.len() > MAX_WORKSPACE_FILE_READ_BYTES {
        return Err("Workspace file is too large to preview.".to_string());
    }

    let bytes =
        fs::read(&file_path).map_err(|error| format!("Unable to read workspace file: {error}"))?;
    let content = String::from_utf8(bytes)
        .map_err(|_| "Workspace file is not valid UTF-8 text.".to_string())?;

    Ok(WorkspaceFileText {
        root: workspace_path_display(&workspace_root),
        git_status: git_status_for_relative_path(
            &workspace_git_statuses(&workspace_root),
            &normalized_relative_path,
            "file",
        ),
        relative_path: normalized_relative_path,
        name: file_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string()),
        content,
        size: metadata.len(),
        modified_ms: modified_ms(&metadata),
    })
}

fn truncate_workspace_diff(diff: String) -> (String, bool) {
    if diff.len() <= MAX_WORKSPACE_FILE_DIFF_BYTES {
        return (diff, false);
    }

    let mut boundary = MAX_WORKSPACE_FILE_DIFF_BYTES;

    while boundary > 0 && !diff.is_char_boundary(boundary) {
        boundary -= 1;
    }

    let mut truncated = diff;
    truncated.truncate(boundary);
    truncated.push_str("\n... diff truncated ...\n");

    (truncated, true)
}

fn workspace_file_git_diff(root: &Path, relative_path: &str, cached: bool) -> String {
    let mut args = vec![
        "-c",
        "core.quotepath=false",
        "diff",
        "--no-ext-diff",
        "--unified=5",
    ];

    if cached {
        args.push("--cached");
    }

    args.push("--");
    args.push(relative_path);

    let capture = match run_command_capture(
        "git",
        &args,
        None,
        Duration::from_secs(GIT_DIFF_TIMEOUT_SECS),
        Some(root),
    ) {
        Ok(capture) => capture,
        Err(_) => return String::new(),
    };

    if capture.exit_code != Some(0) {
        return String::new();
    }

    capture.stdout
}

fn read_workspace_file_diff_for(
    root: String,
    relative_path: String,
) -> Result<WorkspaceFileDiff, String> {
    let workspace_root = resolve_workspace_root_directory(Some(&root))?;
    let (file_path, normalized_relative_path) =
        resolve_workspace_child_path(&workspace_root, &relative_path)?;
    let metadata = fs::metadata(&file_path)
        .map_err(|error| format!("Unable to inspect workspace file: {error}"))?;

    if !metadata.is_file() {
        return Err("Workspace path is not a file.".to_string());
    }

    let git_statuses = workspace_git_statuses(&workspace_root);
    let git_status = git_status_for_relative_path(&git_statuses, &normalized_relative_path, "file");

    if git_status.as_deref() != Some("modified") {
        return Ok(WorkspaceFileDiff {
            root: workspace_path_display(&workspace_root),
            relative_path: normalized_relative_path,
            diff: String::new(),
            truncated: false,
        });
    }

    let working_diff = workspace_file_git_diff(&workspace_root, &normalized_relative_path, false);
    let staged_diff = workspace_file_git_diff(&workspace_root, &normalized_relative_path, true);
    let diff = [working_diff, staged_diff]
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let (diff, truncated) = truncate_workspace_diff(diff);

    Ok(WorkspaceFileDiff {
        root: workspace_path_display(&workspace_root),
        relative_path: normalized_relative_path,
        diff,
        truncated,
    })
}

#[cfg(test)]
mod workspace_files_tests {
    use super::*;

    #[cfg(not(windows))]
    #[test]
    fn filesystem_root_is_not_a_valid_workspace_root() {
        let error = resolve_workspace_root_directory(Some("/")).unwrap_err();
        assert!(error.contains("filesystem root"));
    }

    #[cfg(not(windows))]
    #[test]
    fn filesystem_root_triggers_default_directory_fallback() {
        assert!(should_fallback_default_working_directory(Path::new("/")));
    }
}

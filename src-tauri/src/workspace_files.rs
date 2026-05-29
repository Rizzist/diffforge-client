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

    let working_directory = visible_workspace_root_for_directory(&working_directory);

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
        .map(|directory| visible_workspace_root_for_directory(&directory))
        .filter(|directory| directory.is_dir())
}

fn should_fallback_default_working_directory(directory: &Path) -> bool {
    is_filesystem_root_directory(directory) || is_windows_system_startup_directory(directory)
}

fn visible_workspace_root_for_directory(directory: &Path) -> PathBuf {
    coordination_worktree_visible_root(directory).unwrap_or_else(|| directory.to_path_buf())
}

fn coordination_worktree_visible_root(directory: &Path) -> Option<PathBuf> {
    let components = directory.components().collect::<Vec<_>>();

    for index in 0..components.len().saturating_sub(1) {
        if path_component_is_normal(components[index], ".agents")
            && path_component_is_normal(components[index + 1], "worktrees")
        {
            let mut root = PathBuf::new();
            for component in &components[..index] {
                root.push(component.as_os_str());
            }
            return (!root.as_os_str().is_empty()).then_some(root);
        }
    }

    None
}

fn path_component_is_normal(component: Component<'_>, expected: &str) -> bool {
    matches!(component, Component::Normal(value) if value == expected)
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceGitBootstrap {
    repo_path: String,
    branch: String,
    head_sha: String,
    initialized_repo: bool,
    created_initial_commit: bool,
    gitignore_update: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceProjectMount {
    mount_id: String,
    workspace_relative_path: String,
    project_root: String,
    project_name: String,
    has_agents: bool,
    has_spec_graph_cache: bool,
    #[serde(skip_serializing)]
    root_path: PathBuf,
}

#[derive(Clone)]
struct WorkspaceProjectFileContext {
    mount: WorkspaceProjectMount,
    project_relative_path: String,
    is_project_root: bool,
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

fn gitignore_pattern_ignores_workspace_dir(line: &[u8], directory: &[u8]) -> bool {
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

    pattern == directory
}

fn workspace_agents_gitignore_update_label(update: WorkspaceAgentsGitignoreUpdate) -> &'static str {
    match update {
        WorkspaceAgentsGitignoreUpdate::Added => "added",
        WorkspaceAgentsGitignoreUpdate::AlreadyIgnored => "already_ignored",
        WorkspaceAgentsGitignoreUpdate::NoAgentsDirectory => "no_agents_directory",
    }
}

fn workspace_git_marker_description(root: &Path) -> String {
    let marker = root.join(".git");

    match fs::metadata(&marker) {
        Ok(metadata) if metadata.is_dir() => "directory".to_string(),
        Ok(metadata) if metadata.is_file() => {
            let first_line = fs::read_to_string(&marker)
                .ok()
                .and_then(|contents| {
                    contents
                        .lines()
                        .map(str::trim)
                        .find(|line| !line.is_empty())
                        .map(str::to_string)
                })
                .unwrap_or_default();

            if first_line.is_empty() {
                "file".to_string()
            } else {
                format!("file ({first_line})")
            }
        }
        Ok(_) => "special filesystem entry".to_string(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => "missing".to_string(),
        Err(error) => format!("unreadable ({error})"),
    }
}

fn workspace_project_mount_skip_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".agents"
            | ".cache"
            | ".git"
            | ".gradle"
            | ".next"
            | ".nuxt"
            | ".parcel-cache"
            | ".svelte-kit"
            | ".turbo"
            | ".venv"
            | "build"
            | "coverage"
            | "dist"
            | "node_modules"
            | "out"
            | "target"
            | "vendor"
            | "venv"
    )
}

fn workspace_has_git_marker(root: &Path) -> bool {
    root.join(".git").exists()
}

fn workspace_git_top_level(root: &Path) -> Option<PathBuf> {
    if app_shutdown_requested() {
        return None;
    }

    let top_level = run_git_text(
        root,
        &["rev-parse", "--show-toplevel"],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        "git rev-parse --show-toplevel",
    )
    .ok()?;
    let path = PathBuf::from(top_level.trim());
    path.canonicalize().ok().or(Some(path))
}

fn workspace_is_exact_git_root(root: &Path) -> bool {
    if !workspace_has_git_marker(root) {
        return false;
    }

    let root_key = root
        .canonicalize()
        .map(|path| normalized_path_key(&path))
        .unwrap_or_else(|_| normalized_path_key(root));
    workspace_git_top_level(root)
        .map(|top_level| normalized_path_key(&top_level) == root_key)
        .unwrap_or(false)
}

fn workspace_project_mount_id(relative_path: &str) -> String {
    let normalized = normalize_git_status_path(relative_path);
    if normalized.is_empty() {
        "root".to_string()
    } else {
        normalized
    }
}

fn workspace_project_mount_from_root(
    workspace_root: &Path,
    project_root: PathBuf,
) -> Option<WorkspaceProjectMount> {
    let workspace_relative_path = child_relative_path(workspace_root, &project_root)?;
    let project_name = project_root
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| workspace_path_display(&project_root));
    let has_agents = project_root.join(".agents").is_dir();
    let has_spec_graph_cache = project_root.join(".agents").join("spec-graph").is_dir();

    Some(WorkspaceProjectMount {
        mount_id: workspace_project_mount_id(&workspace_relative_path),
        workspace_relative_path,
        project_root: workspace_path_display(&project_root),
        project_name,
        has_agents,
        has_spec_graph_cache,
        root_path: project_root,
    })
}

fn workspace_project_mounts(root: &Path) -> Vec<WorkspaceProjectMount> {
    let workspace_root = root
        .canonicalize()
        .unwrap_or_else(|_| root.to_path_buf());

    if workspace_is_exact_git_root(&workspace_root) {
        return workspace_project_mount_from_root(&workspace_root, workspace_root.clone())
            .into_iter()
            .collect();
    }

    let mut mounts = Vec::new();
    let mut seen = HashSet::new();
    let mut queue = VecDeque::new();
    queue.push_back((workspace_root.clone(), 0usize));

    while let Some((directory, depth)) = queue.pop_front() {
        if mounts.len() >= MAX_WORKSPACE_PROJECT_MOUNTS {
            break;
        }

        let read_dir = match fs::read_dir(&directory) {
            Ok(read_dir) => read_dir,
            Err(_) => continue,
        };

        for entry in read_dir {
            if mounts.len() >= MAX_WORKSPACE_PROJECT_MOUNTS {
                break;
            }

            let Ok(entry) = entry else {
                continue;
            };
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();

            if workspace_project_mount_skip_name(name) {
                continue;
            }

            let Ok(metadata) = fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                continue;
            }

            let Ok(canonical) = path.canonicalize() else {
                continue;
            };
            if !canonical.starts_with(&workspace_root) {
                continue;
            }

            if workspace_is_exact_git_root(&canonical) {
                let key = normalized_path_key(&canonical);
                if seen.insert(key) {
                    if let Some(mount) =
                        workspace_project_mount_from_root(&workspace_root, canonical.clone())
                    {
                        mounts.push(mount);
                    }
                }
                continue;
            }

            if depth + 1 < WORKSPACE_PROJECT_MOUNT_SCAN_MAX_DEPTH {
                queue.push_back((canonical, depth + 1));
            }
        }
    }

    mounts.sort_by(|left, right| {
        left.workspace_relative_path
            .cmp(&right.workspace_relative_path)
    });
    mounts
}

fn workspace_kind_for_mounts(root: &Path, mounts: &[WorkspaceProjectMount]) -> String {
    if mounts
        .iter()
        .any(|mount| normalized_path_key(&mount.root_path) == normalized_path_key(root))
    {
        "git_repo".to_string()
    } else if !mounts.is_empty() {
        "container".to_string()
    } else {
        "plain".to_string()
    }
}

fn workspace_active_project_root_for_mounts(
    mounts: &[WorkspaceProjectMount],
) -> Option<String> {
    if mounts.len() == 1 {
        mounts.first().map(|mount| mount.project_root.clone())
    } else {
        None
    }
}

fn workspace_root_response(root: &Path) -> ForgeWorkingDirectory {
    let mounts = workspace_project_mounts(root);
    ForgeWorkingDirectory {
        working_directory: workspace_path_display(root),
        workspace_kind: workspace_kind_for_mounts(root, &mounts),
        active_project_root: workspace_active_project_root_for_mounts(&mounts),
        project_mounts: mounts,
    }
}

fn workspace_git_bootstrap_for_selected_root(root: &Path) -> Result<WorkspaceGitBootstrap, String> {
    let mounts = workspace_project_mounts(root);
    let is_exact_repo = mounts
        .iter()
        .any(|mount| normalized_path_key(&mount.root_path) == normalized_path_key(root));

    if !is_exact_repo && !mounts.is_empty() {
        return Ok(WorkspaceGitBootstrap {
            repo_path: workspace_path_display(root),
            branch: String::new(),
            head_sha: String::new(),
            initialized_repo: false,
            created_initial_commit: false,
            gitignore_update: "container_project_mounts".to_string(),
        });
    }

    ensure_workspace_git_ready_for_coordination(root)
}

fn workspace_coordination_root_for_terminal(root: &Path) -> Result<PathBuf, String> {
    let mounts = workspace_project_mounts(root);
    let is_exact_repo = mounts
        .iter()
        .any(|mount| normalized_path_key(&mount.root_path) == normalized_path_key(root));

    if is_exact_repo || mounts.is_empty() {
        return Ok(root.to_path_buf());
    }

    if mounts.len() == 1 {
        return Ok(mounts[0].root_path.clone());
    }

    let labels = mounts
        .iter()
        .take(5)
        .map(|mount| mount.workspace_relative_path.clone())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Workspace root is a container with multiple Git projects ({labels}). Open or select a specific project before launching an isolated agent terminal."
    ))
}

fn ensure_workspace_agents_gitignore(root: &Path) -> Result<WorkspaceAgentsGitignoreUpdate, String> {
    let agents_path = root.join(".agents");
    match fs::metadata(&agents_path) {
        Ok(metadata) if !metadata.is_dir() => {
            return Ok(WorkspaceAgentsGitignoreUpdate::NoAgentsDirectory);
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Unable to inspect workspace .agents directory: {error}"
            ));
        }
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

    let mut agents_ignored = false;
    let mut logs_ignored = false;
    for line in existing.split(|byte| *byte == b'\n') {
        agents_ignored |= gitignore_pattern_ignores_workspace_dir(line, b".agents");
        logs_ignored |= gitignore_pattern_ignores_workspace_dir(line, b"logs");
    }

    if agents_ignored && logs_ignored {
        return Ok(WorkspaceAgentsGitignoreUpdate::AlreadyIgnored);
    }

    let mut addition = Vec::new();

    if !existing.is_empty() && !existing.ends_with(b"\n") {
        addition.push(b'\n');
    }

    if !agents_ignored {
        addition.extend_from_slice(b".agents/\n");
    }

    if !logs_ignored {
        addition.extend_from_slice(b"/logs/\n");
    }

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

    let canonical = visible_workspace_root_for_directory(&canonical);
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

fn ensure_workspace_git_ready_for_coordination(root: &Path) -> Result<WorkspaceGitBootstrap, String> {
    ensure_app_not_shutting_down("workspace Git setup")?;

    let repo_key = root
        .canonicalize()
        .map(|path| normalized_path_key(&path))
        .unwrap_or_else(|_| normalized_path_key(root));
    let mut initialized_repo = false;
    let mut created_initial_commit = false;
    let had_git_marker = root.join(".git").exists();

    if !had_git_marker {
        let capture =
            run_git_for_workspace(root, &["init"], Duration::from_secs(GIT_INIT_TIMEOUT_SECS))?;
        ensure_git_success(&capture, "git init")?;
        initialized_repo = true;
    }

    let gitignore_update = ensure_workspace_agents_gitignore(root)?;
    let top_level = match run_git_text(
        root,
        &["rev-parse", "--show-toplevel"],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        "git rev-parse --show-toplevel",
    ) {
        Ok(top_level) => top_level,
        Err(error) => {
            let setup = if initialized_repo {
                "created a new .git directory"
            } else if had_git_marker {
                "found an existing .git marker"
            } else {
                "checked the workspace Git marker"
            };
            return Err(format!(
                "{error}. Selected workspace root: {}. Diff Forge {setup}; current .git marker is {}.",
                workspace_path_display(root),
                workspace_git_marker_description(root)
            ));
        }
    };
    let top_level_path = PathBuf::from(top_level.trim());
    let top_level_key = top_level_path
        .canonicalize()
        .map(|path| normalized_path_key(&path))
        .unwrap_or_else(|_| normalized_path_key(&top_level_path));
    if top_level_key != repo_key {
        return Err(format!(
            "Workspace Git preflight resolved {}, but coordination must use the selected workspace root {}.",
            workspace_path_display(&top_level_path),
            workspace_path_display(root)
        ));
    }

    if run_git_text(
        root,
        &["rev-parse", "--verify", "HEAD"],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        "git rev-parse --verify HEAD",
    )
    .is_err()
    {
        ensure_workspace_git_identity(root)?;
        if root.join(".gitignore").exists() {
            let capture = run_git_for_workspace(
                root,
                &["add", "--", ".gitignore"],
                Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
            )?;
            ensure_git_success(&capture, "git add .gitignore")?;
        }
        let capture = run_git_for_workspace(
            root,
            &[
                "commit",
                "--allow-empty",
                "-m",
                "Initialize Diff Forge coordination workspace",
            ],
            Duration::from_secs(GIT_COMMIT_TIMEOUT_SECS),
        )?;
        ensure_git_success(&capture, "git commit --allow-empty")?;
        created_initial_commit = true;
    }

    let head_sha = run_git_text(
        root,
        &["rev-parse", "HEAD"],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        "git rev-parse HEAD",
    )?;
    let branch = run_git_text(
        root,
        &["branch", "--show-current"],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        "git branch --show-current",
    )
    .unwrap_or_default();

    Ok(WorkspaceGitBootstrap {
        repo_path: workspace_path_display(root),
        branch: branch.trim().to_string(),
        head_sha: head_sha.trim().to_string(),
        initialized_repo,
        created_initial_commit,
        gitignore_update: workspace_agents_gitignore_update_label(gitignore_update).to_string(),
    })
}

fn ensure_workspace_git_identity(root: &Path) -> Result<(), String> {
    let has_name = run_git_text(
        root,
        &["config", "--get", "user.name"],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        "git config --get user.name",
    )
    .map(|value| !value.trim().is_empty())
    .unwrap_or(false);
    let has_email = run_git_text(
        root,
        &["config", "--get", "user.email"],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        "git config --get user.email",
    )
    .map(|value| !value.trim().is_empty())
    .unwrap_or(false);

    if !has_name {
        let capture = run_git_for_workspace(
            root,
            &["config", "user.name", "Diff Forge AI"],
            Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        )?;
        ensure_git_success(&capture, "git config user.name")?;
    }
    if !has_email {
        let capture = run_git_for_workspace(
            root,
            &["config", "user.email", "local@diffforge.ai"],
            Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        )?;
        ensure_git_success(&capture, "git config user.email")?;
    }
    Ok(())
}

fn run_git_text(
    root: &Path,
    args: &[&str],
    timeout: Duration,
    operation: &str,
) -> Result<String, String> {
    let capture = run_git_for_workspace(root, args, timeout)?;
    ensure_git_success(&capture, operation)?;
    Ok(capture.stdout.trim().to_string())
}

fn run_git_for_workspace(
    root: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<CommandCapture, String> {
    let safe_directory = format!("safe.directory={}", git_safe_directory_value(root));
    let mut owned_args = Vec::with_capacity(args.len() + 2);
    owned_args.push("-c".to_string());
    owned_args.push(safe_directory);
    owned_args.extend(args.iter().map(|arg| (*arg).to_string()));
    let borrowed_args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
    run_command_capture("git", &borrowed_args, None, timeout, Some(root))
}

fn ensure_git_success(capture: &CommandCapture, operation: &str) -> Result<(), String> {
    if capture.exit_code == Some(0) {
        return Ok(());
    }
    let output = command_output_text(&capture.stdout, &capture.stderr);
    if output.is_empty() {
        Err(format!("{operation} failed."))
    } else {
        Err(format!("{operation} failed: {output}"))
    }
}

fn git_safe_directory_value(path: &Path) -> String {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    workspace_path_display(&canonical).replace('\\', "/")
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

fn workspace_project_context_for_path(
    path: &Path,
    mounts: &[WorkspaceProjectMount],
) -> Option<WorkspaceProjectFileContext> {
    let mut best: Option<&WorkspaceProjectMount> = None;

    for mount in mounts {
        if !path.starts_with(&mount.root_path) {
            continue;
        }

        let should_replace = best
            .map(|current| mount.root_path.components().count() > current.root_path.components().count())
            .unwrap_or(true);
        if should_replace {
            best = Some(mount);
        }
    }

    let mount = best?.clone();
    let project_relative_path = child_relative_path(&mount.root_path, path).unwrap_or_default();
    let is_project_root = project_relative_path.is_empty();
    Some(WorkspaceProjectFileContext {
        mount,
        project_relative_path,
        is_project_root,
    })
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
    if app_shutdown_requested() {
        return HashMap::new();
    }

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

fn git_status_for_project_context(
    statuses: &HashMap<String, String>,
    context: &WorkspaceProjectFileContext,
    kind: &str,
) -> Option<String> {
    if context.is_project_root && kind == "directory" {
        return statuses
            .values()
            .max_by_key(|status| git_status_priority(status))
            .cloned();
    }

    git_status_for_relative_path(statuses, &context.project_relative_path, kind)
}

fn git_status_for_container_directory(
    workspace_relative_path: &str,
    mounts: &[WorkspaceProjectMount],
    git_status_cache: &mut HashMap<String, HashMap<String, String>>,
) -> Option<String> {
    let normalized = normalize_git_status_path(workspace_relative_path);
    let prefix = if normalized.is_empty() {
        String::new()
    } else {
        format!("{normalized}/")
    };
    let mut best_status: Option<String> = None;

    for mount in mounts {
        if normalize_git_status_path(&mount.workspace_relative_path) == normalized
            || (!prefix.is_empty() && mount.workspace_relative_path.starts_with(&prefix))
        {
            let key = mount.project_root.clone();
            let statuses = git_status_cache
                .entry(key)
                .or_insert_with(|| workspace_git_statuses(&mount.root_path));
            if let Some(status) = statuses
                .values()
                .max_by_key(|status| git_status_priority(status))
                .cloned()
            {
                let should_replace = best_status
                    .as_ref()
                    .map(|current| git_status_priority(&status) > git_status_priority(current))
                    .unwrap_or(true);
                if should_replace {
                    best_status = Some(status);
                }
            }
        }
    }

    best_status
}

fn directory_entry_from_path(
    root: &Path,
    path: PathBuf,
    metadata: fs::Metadata,
    mounts: &[WorkspaceProjectMount],
    git_status_cache: &mut HashMap<String, HashMap<String, String>>,
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
    let project_context = workspace_project_context_for_path(&path, mounts);
    let git_status = if let Some(context) = project_context.as_ref() {
        let statuses = git_status_cache
            .entry(context.mount.project_root.clone())
            .or_insert_with(|| workspace_git_statuses(&context.mount.root_path));
        git_status_for_project_context(statuses, context, kind)
    } else if kind == "directory" {
        git_status_for_container_directory(&relative_path, mounts, git_status_cache)
    } else {
        None
    };

    Some(WorkspaceDirectoryEntry {
        name,
        git_status,
        project_root: project_context
            .as_ref()
            .map(|context| context.mount.project_root.clone()),
        project_relative_path: project_context
            .as_ref()
            .map(|context| context.project_relative_path.clone()),
        mount_id: project_context
            .as_ref()
            .map(|context| context.mount.mount_id.clone()),
        is_project_mount: project_context
            .as_ref()
            .map(|context| context.is_project_root)
            .unwrap_or(false),
        has_agents: project_context
            .as_ref()
            .map(|context| context.mount.has_agents)
            .unwrap_or(false),
        has_spec_graph_cache: project_context
            .as_ref()
            .map(|context| context.mount.has_spec_graph_cache)
            .unwrap_or(false),
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
    let project_mounts = workspace_project_mounts(&workspace_root);
    let workspace_kind = workspace_kind_for_mounts(&workspace_root, &project_mounts);
    let active_project_root = workspace_active_project_root_for_mounts(&project_mounts);
    let mut git_status_cache: HashMap<String, HashMap<String, String>> = HashMap::new();
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
            directory_entry_from_path(
                &workspace_root,
                path,
                metadata,
                &project_mounts,
                &mut git_status_cache,
            )
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
        workspace_kind,
        active_project_root,
        project_mounts,
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
    let project_mounts = workspace_project_mounts(&workspace_root);
    let project_context = workspace_project_context_for_path(&file_path, &project_mounts);
    let git_status = project_context.as_ref().and_then(|context| {
        let statuses = workspace_git_statuses(&context.mount.root_path);
        git_status_for_project_context(&statuses, context, "file")
    });

    Ok(WorkspaceFileText {
        root: workspace_path_display(&workspace_root),
        git_status,
        project_root: project_context
            .as_ref()
            .map(|context| context.mount.project_root.clone()),
        project_relative_path: project_context
            .as_ref()
            .map(|context| context.project_relative_path.clone()),
        mount_id: project_context
            .as_ref()
            .map(|context| context.mount.mount_id.clone()),
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
    if app_shutdown_requested() {
        return String::new();
    }

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

    let project_mounts = workspace_project_mounts(&workspace_root);
    let project_context = workspace_project_context_for_path(&file_path, &project_mounts);
    let git_status = project_context.as_ref().and_then(|context| {
        let statuses = workspace_git_statuses(&context.mount.root_path);
        git_status_for_project_context(&statuses, context, "file")
    });

    if git_status.as_deref() != Some("modified") {
        return Ok(WorkspaceFileDiff {
            root: workspace_path_display(&workspace_root),
            relative_path: normalized_relative_path,
            diff: String::new(),
            truncated: false,
            project_root: project_context
                .as_ref()
                .map(|context| context.mount.project_root.clone()),
            project_relative_path: project_context
                .as_ref()
                .map(|context| context.project_relative_path.clone()),
            mount_id: project_context
                .as_ref()
                .map(|context| context.mount.mount_id.clone()),
        });
    }

    let Some(context) = project_context.as_ref() else {
        return Ok(WorkspaceFileDiff {
            root: workspace_path_display(&workspace_root),
            relative_path: normalized_relative_path,
            diff: String::new(),
            truncated: false,
            project_root: None,
            project_relative_path: None,
            mount_id: None,
        });
    };

    let working_diff = workspace_file_git_diff(
        &context.mount.root_path,
        &context.project_relative_path,
        false,
    );
    let staged_diff = workspace_file_git_diff(
        &context.mount.root_path,
        &context.project_relative_path,
        true,
    );
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
        project_root: Some(context.mount.project_root.clone()),
        project_relative_path: Some(context.project_relative_path.clone()),
        mount_id: Some(context.mount.mount_id.clone()),
    })
}

#[cfg(test)]
mod workspace_files_tests {
    use super::*;

    fn test_workspace_root(prefix: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        env::temp_dir().join(format!("{prefix}-{suffix}"))
    }

    fn run_test_git(root: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .status()
            .unwrap_or_else(|error| panic!("failed to run git {args:?}: {error}"));
        assert!(status.success(), "git {args:?} failed with {status}");
    }

    fn init_test_git_repo(root: &Path) {
        fs::create_dir_all(root).unwrap();
        run_test_git(root, &["init"]);
        run_test_git(root, &["config", "user.name", "Diff Forge Test"]);
        run_test_git(root, &["config", "user.email", "test@diffforge.local"]);
        fs::write(root.join("tracked.txt"), "one\n").unwrap();
        run_test_git(root, &["add", "tracked.txt"]);
        run_test_git(root, &["commit", "-m", "initial"]);
    }

    #[test]
    fn git_preflight_initializes_selected_workspace_root_with_head() {
        let root = test_workspace_root("diffforge-git-preflight");
        fs::create_dir_all(&root).unwrap();

        let result = ensure_workspace_git_ready_for_coordination(&root).unwrap();

        assert!(root.join(".git").exists());
        assert!(root.join(".gitignore").exists());
        assert!(result.initialized_repo);
        assert!(result.created_initial_commit);
        assert!(!result.head_sha.is_empty());
        assert_eq!(
            normalized_path_key(&PathBuf::from(&result.repo_path).canonicalize().unwrap()),
            normalized_path_key(&root.canonicalize().unwrap())
        );
        let gitignore = fs::read_to_string(root.join(".gitignore")).unwrap();
        assert!(gitignore.contains(".agents/"));
        assert!(gitignore.contains("/logs/"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn git_preflight_reports_existing_invalid_git_marker() {
        let root = test_workspace_root("diffforge-invalid-git-marker");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(".git"), "gitdir: missing\n").unwrap();

        let error = match ensure_workspace_git_ready_for_coordination(&root) {
            Ok(_) => panic!("expected invalid .git marker to fail workspace Git preflight"),
            Err(error) => error,
        };

        assert!(error.contains("found an existing .git marker"));
        assert!(error.contains("gitdir: missing"));
        assert!(error.contains("Selected workspace root"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_gitignore_adds_logs_when_agents_already_ignored() {
        let root = test_workspace_root("diffforge-gitignore-logs");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(".gitignore"), ".agents/\n").unwrap();

        let update = ensure_workspace_agents_gitignore(&root).unwrap();

        assert!(matches!(update, WorkspaceAgentsGitignoreUpdate::Added));
        let gitignore = fs::read_to_string(root.join(".gitignore")).unwrap();
        assert_eq!(gitignore, ".agents/\n/logs/\n");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_root_directory_collapses_agent_worktree_to_project_root() {
        let root = test_workspace_root("diffforge-visible-root");
        let worktree = root.join(".agents").join("worktrees").join("codex-01");
        fs::create_dir_all(&worktree).unwrap();

        assert_eq!(visible_workspace_root_for_directory(&worktree), root);

        let resolved = resolve_workspace_root_directory(Some(worktree.to_str().unwrap())).unwrap();
        assert_eq!(
            normalized_path_key(&resolved),
            normalized_path_key(&root.canonicalize().unwrap())
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn git_preflight_does_not_initialize_container_with_project_mounts() {
        let root = test_workspace_root("diffforge-container-mounts");
        let project = root.join("rust-diffforge");
        init_test_git_repo(&project);
        fs::create_dir_all(project.join(".agents").join("spec-graph")).unwrap();

        let bootstrap = workspace_git_bootstrap_for_selected_root(&root).unwrap();
        let response = workspace_root_response(&root);

        assert!(!root.join(".git").exists());
        assert!(!root.join(".agents").exists());
        assert!(!bootstrap.initialized_repo);
        assert_eq!(bootstrap.gitignore_update, "container_project_mounts");
        assert_eq!(response.workspace_kind, "container");
        assert_eq!(response.project_mounts.len(), 1);
        assert_eq!(
            response.project_mounts[0].workspace_relative_path,
            "rust-diffforge"
        );
        assert!(response.project_mounts[0].has_agents);
        assert!(response.project_mounts[0].has_spec_graph_cache);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_file_git_state_uses_nested_project_mount() {
        let root = test_workspace_root("diffforge-container-file-state");
        let project = root.join("app");
        init_test_git_repo(&project);
        fs::write(project.join("tracked.txt"), "two\n").unwrap();

        let file = read_workspace_file_for(
            workspace_path_display(&root),
            "app/tracked.txt".to_string(),
        )
        .unwrap();
        assert_eq!(file.git_status.as_deref(), Some("modified"));
        assert_eq!(file.project_relative_path.as_deref(), Some("tracked.txt"));
        assert_eq!(file.mount_id.as_deref(), Some("app"));

        let diff = read_workspace_file_diff_for(
            workspace_path_display(&root),
            "app/tracked.txt".to_string(),
        )
        .unwrap();
        assert!(diff.diff.contains("-one"));
        assert!(diff.diff.contains("+two"));
        assert!(!root.join(".git").exists());

        let _ = fs::remove_dir_all(root);
    }

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

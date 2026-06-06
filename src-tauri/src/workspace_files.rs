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
    workspace_root_rejection_reason(directory).is_some()
}

fn workspace_common_broad_area_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "desktop"
            | "documents"
            | "downloads"
            | "home"
            | "users"
            | "pictures"
            | "music"
            | "movies"
            | "videos"
    )
}

fn workspace_root_is_broad_area_with_home(root: &Path, home: Option<PathBuf>) -> bool {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let root_key = normalized_path_key(&root);

    if let Some(home) = home {
        let home = home.canonicalize().unwrap_or(home);
        let home_key = normalized_path_key(&home);
        if root_key == home_key {
            return true;
        }

        if root
            .parent()
            .map(|parent| normalized_path_key(parent) == home_key)
            .unwrap_or(false)
            && root
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(workspace_common_broad_area_name)
        {
            return true;
        }
    }

    root.file_name()
        .and_then(|value| value.to_str())
        .filter(|name| matches!(name.to_ascii_lowercase().as_str(), "users" | "home"))
        .is_some()
        && root.parent().is_some_and(is_filesystem_root_directory)
}

fn workspace_root_is_broad_area_for_home(
    root: &Path,
    mounts: &[WorkspaceProjectMount],
    home: Option<PathBuf>,
) -> bool {
    mounts.is_empty() && workspace_root_is_broad_area_with_home(root, home)
}

fn workspace_root_is_broad_area(root: &Path, mounts: &[WorkspaceProjectMount]) -> bool {
    workspace_root_is_broad_area_for_home(root, mounts, user_home_dir())
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
        let text = windows_non_verbatim_path_text(directory.to_string_lossy().as_ref());
        let trimmed = text.trim_end_matches(|character| character == '\\' || character == '/');
        trimmed.len() == 2
            && trimmed.as_bytes()[0].is_ascii_alphabetic()
            && trimmed.as_bytes()[1] == b':'
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
    project_kind: String,
    mount_kind: String,
    parent_mount_id: Option<String>,
    mount_depth: usize,
    has_git: bool,
    has_agents: bool,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WorkspaceProjectKind {
    Git,
    Marker,
    Container,
}

impl WorkspaceProjectKind {
    fn as_str(self) -> &'static str {
        match self {
            WorkspaceProjectKind::Git => "git",
            WorkspaceProjectKind::Marker => "project",
            WorkspaceProjectKind::Container => "container",
        }
    }
}

fn workspace_has_any_file(root: &Path, names: &[&str]) -> bool {
    names.iter().any(|name| root.join(name).is_file())
}

fn workspace_has_any_dir(root: &Path, names: &[&str]) -> bool {
    names.iter().any(|name| root.join(name).is_dir())
}

fn workspace_package_json_declares_workspaces(root: &Path) -> bool {
    let package_json = root.join("package.json");
    let Ok(body) = fs::read_to_string(package_json) else {
        return false;
    };
    serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| value.get("workspaces").cloned())
        .is_some()
}

fn workspace_cargo_toml_declares_workspace(root: &Path) -> bool {
    fs::read_to_string(root.join("Cargo.toml"))
        .map(|body| body.lines().any(|line| line.trim() == "[workspace]"))
        .unwrap_or(false)
}

fn workspace_has_explicit_workspace_marker(root: &Path) -> bool {
    workspace_has_any_file(
        root,
        &[
            "pnpm-workspace.yaml",
            "pnpm-workspace.yml",
            "nx.json",
            "turbo.json",
            "go.work",
            "lerna.json",
            "rush.json",
            "workspace.json",
        ],
    ) || workspace_package_json_declares_workspaces(root)
        || workspace_cargo_toml_declares_workspace(root)
}

fn workspace_has_project_file_marker(root: &Path) -> bool {
    workspace_has_explicit_workspace_marker(root)
        || workspace_has_any_file(
            root,
            &[
                "package.json",
                "Cargo.toml",
                "pyproject.toml",
                "go.mod",
                "pom.xml",
                "build.gradle",
                "build.gradle.kts",
                "settings.gradle",
                "settings.gradle.kts",
                "deno.json",
                "deno.jsonc",
                "bun.lockb",
                "composer.json",
                "Gemfile",
                "mix.exs",
                "Makefile",
                "CMakeLists.txt",
            ],
        )
}

fn workspace_has_project_marker(root: &Path) -> bool {
    workspace_has_project_file_marker(root)
        || workspace_has_any_dir(root, &["src", "app"])
}

fn workspace_project_kind_for_selected_root(root: &Path) -> Option<WorkspaceProjectKind> {
    if workspace_is_exact_git_root(root) {
        Some(WorkspaceProjectKind::Git)
    } else if workspace_has_project_file_marker(root) {
        Some(WorkspaceProjectKind::Marker)
    } else {
        None
    }
}

fn workspace_project_kind_for_root(root: &Path) -> Option<WorkspaceProjectKind> {
    if workspace_is_exact_git_root(root) {
        Some(WorkspaceProjectKind::Git)
    } else if workspace_has_project_marker(root) {
        Some(WorkspaceProjectKind::Marker)
    } else {
        None
    }
}

fn workspace_project_mount_id(relative_path: &str) -> String {
    let normalized = normalize_git_status_path(relative_path);
    if normalized.is_empty() {
        "root".to_string()
    } else {
        normalized
    }
}

fn workspace_mount_depth(relative_path: &str) -> usize {
    normalize_git_status_path(relative_path)
        .split('/')
        .filter(|part| !part.trim().is_empty())
        .count()
}

fn workspace_mount_parent_id(relative_path: &str) -> Option<String> {
    let normalized = normalize_git_status_path(relative_path);
    let mut parts = normalized
        .split('/')
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>();
    if parts.len() <= 1 {
        return None;
    }
    parts.pop();
    Some(workspace_project_mount_id(&parts.join("/")))
}

fn workspace_project_mount_from_root(
    workspace_root: &Path,
    project_root: PathBuf,
    project_kind: WorkspaceProjectKind,
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
    let parent_mount_id = workspace_mount_parent_id(&workspace_relative_path);
    let mount_depth = workspace_mount_depth(&workspace_relative_path);

    Some(WorkspaceProjectMount {
        mount_id: workspace_project_mount_id(&workspace_relative_path),
        workspace_relative_path,
        project_root: workspace_path_display(&project_root),
        project_name,
        project_kind: project_kind.as_str().to_string(),
        mount_kind: if matches!(project_kind, WorkspaceProjectKind::Container) {
            "container".to_string()
        } else {
            "project".to_string()
        },
        parent_mount_id,
        mount_depth,
        has_git: matches!(project_kind, WorkspaceProjectKind::Git),
        has_agents,
        root_path: project_root,
    })
}

fn workspace_mount_is_project(mount: &WorkspaceProjectMount) -> bool {
    mount.mount_kind == "project" && mount.project_kind != "container"
}

fn workspace_mount_manifest_from_projects(
    workspace_root: &Path,
    project_mounts: &[WorkspaceProjectMount],
) -> Vec<WorkspaceProjectMount> {
    let workspace_root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let mut manifest = Vec::new();
    let mut seen = HashSet::new();

    for project_mount in project_mounts {
        let normalized_relative = normalize_git_status_path(&project_mount.workspace_relative_path);
        let parts = normalized_relative
            .split('/')
            .filter(|part| !part.trim().is_empty())
            .collect::<Vec<_>>();

        for depth in 1..parts.len() {
            if manifest.len() + project_mounts.len() >= MAX_WORKSPACE_PROJECT_MOUNTS {
                break;
            }
            let relative_path = parts[..depth].join("/");
            let path = workspace_root.join(relative_path);
            let Ok(canonical) = path.canonicalize() else {
                continue;
            };
            if !canonical.starts_with(&workspace_root) {
                continue;
            }
            let key = normalized_path_key(&canonical);
            if !seen.insert(key) {
                continue;
            }
            if let Some(mount) = workspace_project_mount_from_root(
                &workspace_root,
                canonical,
                WorkspaceProjectKind::Container,
            ) {
                manifest.push(mount);
            }
        }
    }

    manifest.extend(project_mounts.iter().filter(|mount| workspace_mount_is_project(mount)).cloned());
    manifest.sort_by(|left, right| {
        left.workspace_relative_path
            .cmp(&right.workspace_relative_path)
            .then_with(|| left.mount_kind.cmp(&right.mount_kind))
    });
    manifest
}

fn workspace_mount_is_selected_root(root: &Path, mount: &WorkspaceProjectMount) -> bool {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    normalized_path_key(&mount.root_path) == normalized_path_key(&root)
}

fn workspace_selected_root_mount<'a>(
    root: &Path,
    mounts: &'a [WorkspaceProjectMount],
) -> Option<&'a WorkspaceProjectMount> {
    mounts
        .iter()
        .find(|mount| workspace_mount_is_selected_root(root, mount))
}

fn workspace_project_mounts(root: &Path) -> Vec<WorkspaceProjectMount> {
    let workspace_root = root
        .canonicalize()
        .unwrap_or_else(|_| root.to_path_buf());

    let mut mounts = Vec::new();
    let mut seen = HashSet::new();

    if let Some(project_kind) = workspace_project_kind_for_selected_root(&workspace_root) {
        let key = normalized_path_key(&workspace_root);
        seen.insert(key);
        if let Some(mount) =
            workspace_project_mount_from_root(&workspace_root, workspace_root.clone(), project_kind)
        {
            mounts.push(mount);
        }
    }

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

            if let Some(project_kind) = workspace_project_kind_for_root(&canonical) {
                let key = normalized_path_key(&canonical);
                if seen.insert(key) {
                    if let Some(mount) =
                        workspace_project_mount_from_root(
                            &workspace_root,
                            canonical.clone(),
                            project_kind,
                        )
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

    if mounts.is_empty() && workspace_has_project_marker(&workspace_root) {
        return workspace_project_mount_from_root(
            &workspace_root,
            workspace_root.clone(),
            WorkspaceProjectKind::Marker,
        )
        .into_iter()
        .collect();
    }

    mounts.sort_by(|left, right| {
        left.mount_depth
            .cmp(&right.mount_depth)
            .then_with(|| left.workspace_relative_path.cmp(&right.workspace_relative_path))
    });
    mounts
}

fn workspace_kind_for_mounts(root: &Path, mounts: &[WorkspaceProjectMount]) -> String {
    if workspace_selected_root_mount(root, mounts).is_some_and(|mount| mount.has_git) {
        "git_repo".to_string()
    } else if workspace_selected_root_mount(root, mounts).is_some() {
        "project".to_string()
    } else if !mounts.is_empty() {
        "container".to_string()
    } else if workspace_root_is_broad_area(root, mounts) {
        "broad_area".to_string()
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

fn workspace_directory_is_empty(root: &Path) -> bool {
    fs::read_dir(root)
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(false)
}

fn workspace_gitignore_only_diff_forge_bootstrap_rules(path: &Path) -> bool {
    let existing = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };

    existing.split(|byte| *byte == b'\n').all(|line| {
        let trimmed = trim_gitignore_ascii(line);
        trimmed.is_empty()
            || trimmed.starts_with(b"#")
            || gitignore_pattern_ignores_workspace_dir(trimmed, b".agents")
            || gitignore_pattern_ignores_workspace_dir(trimmed, b"logs")
    })
}

fn workspace_logs_directory_only_diff_forge_bootstrap_files(path: &Path) -> bool {
    let read_dir = match fs::read_dir(path) {
        Ok(read_dir) => read_dir,
        Err(_) => return false,
    };

    for entry in read_dir {
        let Ok(entry) = entry else {
            return false;
        };
        let entry_path = entry.path();
        let name = entry_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        let Ok(metadata) = fs::symlink_metadata(&entry_path) else {
            return false;
        };

        if metadata.file_type().is_symlink() {
            return false;
        }

        if metadata.is_file() {
            if name == ".DS_Store" {
                continue;
            }
            if matches!(
                name,
                "coordination-alignment.jsonl" | "coordination-events.jsonl"
            ) {
                continue;
            }
        }

        return false;
    }

    true
}

fn workspace_root_entry_is_empty_git_bootstrap_metadata(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };

    if metadata.file_type().is_symlink() {
        return false;
    }

    match name {
        ".DS_Store" => metadata.is_file(),
        ".agents" => metadata.is_dir(),
        ".gitignore" => {
            metadata.is_file() && workspace_gitignore_only_diff_forge_bootstrap_rules(path)
        }
        "logs" => {
            metadata.is_dir() && workspace_logs_directory_only_diff_forge_bootstrap_files(path)
        }
        _ => false,
    }
}

fn workspace_directory_is_empty_for_git_bootstrap(root: &Path) -> bool {
    let read_dir = match fs::read_dir(root) {
        Ok(read_dir) => read_dir,
        Err(_) => return false,
    };

    for entry in read_dir {
        let Ok(entry) = entry else {
            return false;
        };
        if !workspace_root_entry_is_empty_git_bootstrap_metadata(&entry.path()) {
            return false;
        }
    }

    true
}

fn workspace_root_response(root: &Path) -> ForgeWorkingDirectory {
    let mounts = workspace_project_mounts(root);
    let workspace_mounts = workspace_mount_manifest_from_projects(root, &mounts);
    ForgeWorkingDirectory {
        working_directory: workspace_path_display(root),
        empty_directory: workspace_directory_is_empty(root),
        workspace_kind: workspace_kind_for_mounts(root, &mounts),
        active_project_root: workspace_active_project_root_for_mounts(&mounts),
        project_mounts: mounts,
        workspace_mounts,
    }
}

#[cfg_attr(not(test), allow(dead_code))]
fn workspace_git_bootstrap_for_selected_root(
    root: &Path,
    _selected_root_was_empty_at_selection: bool,
) -> Result<WorkspaceGitBootstrap, String> {
    let mounts = workspace_project_mounts(root);
    let is_selected_project = workspace_selected_root_mount(root, &mounts).is_some();

    if !is_selected_project && !mounts.is_empty() {
        return Ok(WorkspaceGitBootstrap {
            repo_path: workspace_path_display(root),
            branch: String::new(),
            head_sha: String::new(),
            initialized_repo: false,
            created_initial_commit: false,
            gitignore_update: "container_project_mounts".to_string(),
        });
    }

    if !root.join(".git").exists() && !workspace_directory_is_empty_for_git_bootstrap(root) {
        return Ok(WorkspaceGitBootstrap {
            repo_path: workspace_path_display(root),
            branch: String::new(),
            head_sha: String::new(),
            initialized_repo: false,
            created_initial_commit: false,
            gitignore_update: "selected_root_not_empty".to_string(),
        });
    }

    ensure_workspace_git_ready_for_coordination(root)
}

#[cfg_attr(not(test), allow(dead_code))]
fn workspace_coordination_root_for_terminal(
    root: &Path,
    requested_project_root: Option<&str>,
    requested_mount_id: Option<&str>,
) -> Result<PathBuf, String> {
    let workspace_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mounts = workspace_project_mounts(root);
    workspace_coordination_root_for_terminal_with_mounts(
        root,
        &workspace_root,
        &mounts,
        requested_project_root,
        requested_mount_id,
    )
}

fn workspace_coordination_root_for_terminal_with_mounts(
    root: &Path,
    workspace_root: &Path,
    mounts: &[WorkspaceProjectMount],
    requested_project_root: Option<&str>,
    requested_mount_id: Option<&str>,
) -> Result<PathBuf, String> {
    let selected_root_mount = workspace_selected_root_mount(workspace_root, mounts);

    if let Some(requested_mount_id) = requested_mount_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Some(mount) = mounts.iter().find(|mount| mount.mount_id == requested_mount_id) {
            return Ok(mount.root_path.clone());
        }
        return Err(format!(
            "Requested project mount {requested_mount_id} is not available in this workspace."
        ));
    }

    if let Some(requested_project_root) = requested_project_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let requested = PathBuf::from(requested_project_root)
            .canonicalize()
            .map_err(|error| format!("Unable to resolve requested project root: {error}"))?;
        if normalized_path_key(&requested) == normalized_path_key(workspace_root) {
            if selected_root_mount.is_some() {
                return Ok(workspace_root.to_path_buf());
            }
            if !mounts.is_empty() {
                return Err("Container aggregate root is not a project target. Select one of its mounted projects before launching an isolated agent terminal.".to_string());
            }
            if workspace_root_is_broad_area(workspace_root, mounts) {
                return Err("Broad workspace folders are discovery views, not project targets. Select or create a project folder before launching an isolated agent terminal.".to_string());
            }
            return Ok(workspace_root.to_path_buf());
        }
        if !requested.starts_with(workspace_root) && selected_root_mount.is_none() {
            return Err("Requested project root must stay inside the selected workspace.".to_string());
        }
        if selected_root_mount
            .is_some_and(|mount| normalized_path_key(&requested) == normalized_path_key(&mount.root_path))
        {
            return Ok(requested);
        }
        if let Some(mount) = mounts
            .iter()
            .find(|mount| normalized_path_key(&requested) == normalized_path_key(&mount.root_path))
        {
            return Ok(mount.root_path.clone());
        }
        if workspace_root_is_broad_area(workspace_root, mounts)
            && requested.starts_with(workspace_root)
            && workspace_project_kind_for_root(&requested).is_some()
        {
            return Ok(requested);
        }
        return Err(
            "Requested project root is not a discovered project in this workspace.".to_string(),
        );
    }

    if selected_root_mount.is_some() || mounts.is_empty() {
        if selected_root_mount.is_none() && workspace_root_is_broad_area(workspace_root, mounts) {
            return Err("Broad workspace folders are discovery views, not project targets. Select or create a project folder before launching an isolated agent terminal.".to_string());
        }
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
        "Workspace root is a container with multiple projects ({labels}). Open or select a specific project before launching an isolated agent terminal."
    ))
}

#[cfg_attr(not(test), allow(dead_code))]
fn workspace_direct_edit_root_for_terminal(
    root: &Path,
    requested_project_root: Option<&str>,
    requested_mount_id: Option<&str>,
) -> Result<PathBuf, String> {
    let workspace_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mounts = workspace_project_mounts(root);
    workspace_direct_edit_root_for_terminal_with_mounts(
        root,
        &workspace_root,
        &mounts,
        requested_project_root,
        requested_mount_id,
    )
}

fn workspace_direct_edit_root_for_terminal_with_mounts(
    _root: &Path,
    workspace_root: &Path,
    mounts: &[WorkspaceProjectMount],
    requested_project_root: Option<&str>,
    requested_mount_id: Option<&str>,
) -> Result<PathBuf, String> {
    let selected_root_mount = workspace_selected_root_mount(workspace_root, mounts);

    let ensure_non_git_direct_root = |candidate: &Path, label: &str| -> Result<PathBuf, String> {
        if workspace_has_git_marker(candidate) {
            return Err(format!(
                "{label} is a Git project. Use managed patch mode or free terminal mode instead of direct edit mode."
            ));
        }
        if workspace_root_is_broad_area(candidate, &[]) {
            return Err(format!(
                "{label} is a broad filesystem area. Choose a bounded project folder before using direct edit mode."
            ));
        }
        Ok(candidate.to_path_buf())
    };

    if let Some(requested_mount_id) = requested_mount_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let Some(mount) = mounts.iter().find(|mount| mount.mount_id == requested_mount_id) else {
            return Err(format!(
                "Requested project mount {requested_mount_id} is not available in this workspace."
            ));
        };
        if mount.has_git {
            return Err(
                "Requested project mount is a Git project. Use managed patch mode or free terminal mode instead of direct edit mode."
                    .to_string(),
            );
        }
        if mount.mount_kind != "project" {
            return Err("Direct edit mode requires a project mount, not a container mount.".to_string());
        }
        return ensure_non_git_direct_root(&mount.root_path, "Requested project mount");
    }

    if let Some(requested_project_root) = requested_project_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let requested = PathBuf::from(requested_project_root)
            .canonicalize()
            .map_err(|error| format!("Unable to resolve requested direct edit root: {error}"))?;

        if normalized_path_key(&requested) == normalized_path_key(workspace_root) {
            if let Some(mount) = selected_root_mount {
                if mount.has_git {
                    return Err("Selected workspace root is a Git project. Use managed patch mode or free terminal mode instead of direct edit mode.".to_string());
                }
                return ensure_non_git_direct_root(workspace_root, "Selected workspace root");
            }
            if !mounts.is_empty() {
                return Err("Container aggregate root is not a direct edit project. Select one of its non-Git mounted projects or use free terminal mode.".to_string());
            }
            return ensure_non_git_direct_root(workspace_root, "Selected workspace root");
        }

        if !requested.starts_with(workspace_root) && selected_root_mount.is_none() {
            return Err("Requested direct edit root must stay inside the selected workspace.".to_string());
        }
        if let Some(mount) = mounts
            .iter()
            .find(|mount| normalized_path_key(&requested) == normalized_path_key(&mount.root_path))
        {
            if mount.has_git {
                return Err("Requested direct edit root is a Git project. Use managed patch mode or free terminal mode instead of direct edit mode.".to_string());
            }
            if mount.mount_kind != "project" {
                return Err("Direct edit mode requires a project root, not a container root.".to_string());
            }
            return ensure_non_git_direct_root(&mount.root_path, "Requested direct edit root");
        }
        if selected_root_mount.is_some() {
            return Err("Requested direct edit root must match the selected project root.".to_string());
        }
        if workspace_root_is_broad_area(workspace_root, mounts)
            && workspace_project_kind_for_root(&requested)
                .is_some_and(|kind| matches!(kind, WorkspaceProjectKind::Marker))
        {
            return ensure_non_git_direct_root(&requested, "Requested direct edit root");
        }
        if requested.starts_with(workspace_root)
            && requested.is_dir()
            && !workspace_has_git_marker(&requested)
            && !workspace_root_is_broad_area(&requested, &[])
            && mounts.is_empty()
        {
            return Ok(requested);
        }
        return Err(
            "Requested direct edit root is not a bounded non-Git project in this workspace."
                .to_string(),
        );
    }

    if let Some(mount) = selected_root_mount {
        if mount.has_git {
            return Err("Selected workspace root is a Git project. Use managed patch mode or free terminal mode instead of direct edit mode.".to_string());
        }
        return ensure_non_git_direct_root(&mount.root_path, "Selected workspace root");
    }
    if !mounts.is_empty() {
        if mounts.len() == 1 && mounts[0].mount_kind == "project" {
            if mounts[0].has_git {
                return Err("Mounted project is a Git project. Use managed patch mode or free terminal mode instead of direct edit mode.".to_string());
            }
            return ensure_non_git_direct_root(&mounts[0].root_path, "Mounted project");
        }
        let labels = mounts
            .iter()
            .take(5)
            .map(|mount| mount.workspace_relative_path.clone())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "Workspace root is a container with multiple projects ({labels}). Select a non-Git project before using direct edit mode."
        ));
    }
    ensure_non_git_direct_root(&workspace_root, "Selected workspace root")
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

fn normalized_literal_path_key(path: &str) -> String {
    path.replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn normalized_path_key_is_same_or_child(path_key: &str, parent_key: &str) -> bool {
    if parent_key.is_empty() {
        return path_key.is_empty();
    }

    path_key == parent_key
        || path_key
            .strip_prefix(parent_key)
            .is_some_and(|rest| rest.starts_with('/'))
}

fn normalized_path_key_matches_literal(path_key: &str, literal: &str, include_children: bool) -> bool {
    let literal_key = normalized_literal_path_key(literal);
    if include_children {
        normalized_path_key_is_same_or_child(path_key, &literal_key)
    } else {
        path_key == literal_key
    }
}

fn workspace_path_is_same_or_child(path: &Path, parent: &Path) -> bool {
    let path_key = normalized_path_key(path);
    let parent_key = normalized_path_key(parent);
    normalized_path_key_is_same_or_child(&path_key, &parent_key)
}

fn workspace_root_is_user_collection_or_profile(root: &Path, home: Option<&Path>) -> bool {
    let root_key = normalized_path_key(root);

    if home.is_some_and(|home| root_key == normalized_path_key(home)) {
        return true;
    }

    #[cfg(windows)]
    {
        let parts = root_key
            .split('/')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        if parts.len() == 2 && parts[1] == "users" {
            return true;
        }
        if parts.len() == 3 && parts[1] == "users" {
            return true;
        }
    }

    #[cfg(not(windows))]
    {
        if root_key == "/users" || root_key == "/home" {
            return true;
        }

        let parts = root_key
            .split('/')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        if parts.len() == 2 && matches!(parts[0], "users" | "home") {
            return true;
        }
    }

    false
}

fn workspace_root_is_common_user_folder(root: &Path, home: Option<&Path>) -> bool {
    let Some(home) = home else {
        return false;
    };

    root.parent()
        .map(|parent| normalized_path_key(parent) == normalized_path_key(home))
        .unwrap_or(false)
        && root
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(workspace_common_broad_area_name)
}

fn workspace_root_is_cloud_storage_root(root: &Path, home: Option<&Path>) -> bool {
    let name_is_cloud_root = root
        .file_name()
        .and_then(|value| value.to_str())
        .map(|name| {
            matches!(
                name.to_ascii_lowercase().as_str(),
                "dropbox" | "google drive" | "icloud drive" | "onedrive"
            ) || name.to_ascii_lowercase().starts_with("onedrive - ")
        })
        .unwrap_or(false);

    if name_is_cloud_root
        && home.is_some_and(|home| {
            root.parent()
                .map(|parent| normalized_path_key(parent) == normalized_path_key(home))
                .unwrap_or(false)
        })
    {
        return true;
    }

    #[cfg(windows)]
    {
        let root_key = normalized_path_key(root);
        for key in ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"] {
            if let Some(path) = env::var_os(key).map(PathBuf::from) {
                if root_key == normalized_path_key(&path) {
                    return true;
                }
            }
        }
    }

    false
}

fn workspace_root_is_known_user_state_directory(root: &Path, home: Option<&Path>) -> bool {
    let Some(home) = home else {
        return false;
    };

    let candidates = [
        home.join(".cache"),
        home.join(".config"),
        home.join(".local"),
        home.join(".local").join("share"),
        home.join(".npm"),
        home.join(".cargo"),
        home.join(".rustup"),
        home.join(".pyenv"),
        home.join(".nvm"),
        home.join(".bun"),
    ];

    if candidates
        .iter()
        .any(|candidate| workspace_path_is_same_or_child(root, candidate))
    {
        return true;
    }

    #[cfg(target_os = "macos")]
    {
        let candidates = [
            home.join("Library"),
            home.join("Library").join("Application Support"),
            home.join("Library").join("Caches"),
            home.join("Library").join("Containers"),
            home.join("Library").join("Developer"),
            home.join("Library").join("Mobile Documents"),
        ];
        if candidates
            .iter()
            .any(|candidate| workspace_path_is_same_or_child(root, candidate))
        {
            return true;
        }
    }

    #[cfg(windows)]
    {
        let temp_dir = env::temp_dir();
        if workspace_path_is_same_or_child(root, &temp_dir) {
            return normalized_path_key(root) == normalized_path_key(&temp_dir);
        }

        let candidates = [
            home.join("AppData"),
            home.join("AppData").join("Local"),
            home.join("AppData").join("Roaming"),
            home.join("AppData").join("LocalLow"),
        ];
        if candidates
            .iter()
            .any(|candidate| workspace_path_is_same_or_child(root, candidate))
        {
            return true;
        }
    }

    false
}

fn workspace_root_is_known_system_or_app_directory(root: &Path) -> Option<&'static str> {
    let root_key = normalized_path_key(root);

    #[cfg(target_os = "macos")]
    {
        for literal in [
            "/Applications",
            "/System",
            "/Library",
            "/Network",
            "/bin",
            "/sbin",
            "/etc",
            "/usr",
        ] {
            if normalized_path_key_matches_literal(&root_key, literal, true) {
                return Some(
                    "Workspace root directory cannot be a system or application install folder.",
                );
            }
        }

        for literal in ["/Users", "/Volumes", "/private", "/private/tmp", "/private/var", "/tmp", "/var"] {
            if normalized_path_key_matches_literal(&root_key, literal, false) {
                return Some("Workspace root directory is too broad; choose a specific project folder.");
            }
        }

        if root
            .parent()
            .map(|parent| normalized_path_key(parent) == "/volumes")
            .unwrap_or(false)
        {
            return Some("Workspace root directory cannot be a mounted volume root.");
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for literal in [
            "/bin",
            "/boot",
            "/dev",
            "/etc",
            "/lib",
            "/lib64",
            "/proc",
            "/root",
            "/run",
            "/sbin",
            "/sys",
            "/usr",
            "/var/cache",
            "/var/lib",
            "/var/log",
            "/var/run",
        ] {
            if normalized_path_key_matches_literal(&root_key, literal, true) {
                return Some("Workspace root directory cannot be a system folder.");
            }
        }

        for literal in ["/home", "/media", "/mnt", "/opt", "/srv", "/tmp", "/var", "/var/tmp", "/lost+found"] {
            if normalized_path_key_matches_literal(&root_key, literal, false) {
                return Some("Workspace root directory is too broad; choose a specific project folder.");
            }
        }
    }

    #[cfg(windows)]
    {
        let mut protected_roots = Vec::new();
        for key in ["SystemRoot", "WINDIR", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData"] {
            if let Some(path) = env::var_os(key).map(PathBuf::from) {
                protected_roots.push(path);
            }
        }

        for protected_root in protected_roots {
            if workspace_path_is_same_or_child(root, &protected_root) {
                return Some(
                    "Workspace root directory cannot be a system or application install folder.",
                );
            }
        }

        let parts = root_key
            .split('/')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        if parts.len() >= 2
            && matches!(
                parts.get(1).copied().unwrap_or_default(),
                "$recycle.bin"
                    | "recovery"
                    | "system volume information"
                    | "perflogs"
                    | "windows.old"
            )
        {
            return Some("Workspace root directory cannot be a Windows system folder.");
        }

        if workspace_windows_unc_share_root(root) {
            return Some("Workspace root directory cannot be a network share root.");
        }
    }

    None
}

#[cfg(windows)]
fn workspace_windows_unc_share_root(root: &Path) -> bool {
    let text = windows_non_verbatim_path_text(root.to_string_lossy().as_ref()).replace('\\', "/");
    let trimmed = text.trim_matches('/');
    let parts = trimmed
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    text.starts_with("//") && parts.len() == 2
}

fn workspace_root_has_selected_project_signal(root: &Path) -> bool {
    workspace_project_kind_for_selected_root(root).is_some()
}

fn workspace_root_immediate_entry_count_exceeds(root: &Path, limit: usize) -> bool {
    let Ok(read_dir) = fs::read_dir(root) else {
        return false;
    };

    let mut count = 0usize;
    for entry in read_dir {
        if entry.is_ok() {
            count += 1;
            if count > limit {
                return true;
            }
        }
    }

    false
}

fn workspace_root_rejection_reason(root: &Path) -> Option<&'static str> {
    let home = user_home_dir()
        .and_then(|home| home.canonicalize().ok().or(Some(home)));
    workspace_root_rejection_reason_for_home(root, home.as_deref())
}

fn workspace_root_rejection_reason_for_home(
    root: &Path,
    home: Option<&Path>,
) -> Option<&'static str> {
    if is_filesystem_root_directory(root) {
        return Some("Workspace root directory cannot be the filesystem root.");
    }

    if is_windows_system_startup_directory(root) {
        return Some("Workspace root directory cannot be a Windows system folder.");
    }

    if let Some(reason) = workspace_root_is_known_system_or_app_directory(root) {
        return Some(reason);
    }

    if workspace_root_is_user_collection_or_profile(root, home) {
        return Some(
            "Workspace root directory cannot be a user account or user collection root.",
        );
    }

    if workspace_root_is_known_user_state_directory(root, home) {
        return Some(
            "Workspace root directory cannot be an application settings, cache, or package manager folder.",
        );
    }

    if workspace_root_is_cloud_storage_root(root, home) {
        return Some("Workspace root directory cannot be a cloud storage root.");
    }

    if workspace_root_is_common_user_folder(root, home) {
        return Some(
            "Workspace root directory is too broad; choose a specific project folder inside it.",
        );
    }

    if !workspace_root_has_selected_project_signal(root)
        && workspace_root_immediate_entry_count_exceeds(
            root,
            MAX_SAFE_WORKSPACE_ROOT_IMMEDIATE_ENTRIES,
        )
    {
        return Some(
            "Workspace root directory has too many immediate entries; choose a specific project folder.",
        );
    }

    None
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

    if let Some(reason) = workspace_root_rejection_reason(&canonical) {
        return Err(reason.to_string());
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
        let capture = run_git_for_workspace(
            root,
            &["add", "--all", "--", "."],
            Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        )?;
        ensure_git_success(&capture, "git add --all -- .")?;
        let has_staged_changes = run_git_for_workspace(
            root,
            &["diff", "--cached", "--quiet", "--exit-code"],
            Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        )
        .map(|capture| capture.exit_code != Some(0))
        .unwrap_or(true);
        let args = if has_staged_changes {
            vec![
                "commit",
                "-m",
                "Initialize Diff Forge coordination workspace",
            ]
        } else {
            vec![
                "commit",
                "--allow-empty",
                "-m",
                "Initialize Diff Forge coordination workspace",
            ]
        };
        let capture =
            run_git_for_workspace(root, &args, Duration::from_secs(GIT_COMMIT_TIMEOUT_SECS))?;
        ensure_git_success(&capture, "git commit initial workspace snapshot")?;
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
        workspace_mounts: workspace_mount_manifest_from_projects(&workspace_root, &project_mounts),
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

    fn create_package_project(root: &Path, body: &str) {
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("package.json"), body).unwrap();
        fs::write(root.join("src").join("app.js"), "console.log('ok');\n").unwrap();
    }

    #[test]
    fn git_preflight_initializes_selected_workspace_root_with_head() {
        let root = test_workspace_root("diffforge-git-preflight");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src").join("app.rs"), "fn main() {}\n").unwrap();
        fs::create_dir_all(root.join(".agents")).unwrap();
        fs::write(root.join(".agents").join("cache.json"), "{}\n").unwrap();

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
        let tracked = run_git_text(
            &root,
            &["ls-tree", "-r", "--name-only", "HEAD"],
            Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
            "git ls-tree",
        )
        .unwrap();
        assert!(tracked.contains("src/app.rs"));
        assert!(tracked.contains(".gitignore"));
        assert!(!tracked.contains(".agents/cache.json"));

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
        fs::create_dir_all(project.join(".agents")).unwrap();

        let bootstrap = workspace_git_bootstrap_for_selected_root(&root, false).unwrap();
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

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_root_response_reports_empty_directory_before_local_state_exists() {
        let root = test_workspace_root("diffforge-empty-root-response");
        fs::create_dir_all(&root).unwrap();

        let empty_response = workspace_root_response(&root);
        assert!(empty_response.empty_directory);

        fs::write(root.join("README.md"), "not empty\n").unwrap();
        let non_empty_response = workspace_root_response(&root);
        assert!(!non_empty_response.empty_directory);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_empty_git_bootstrap_check_ignores_diff_forge_metadata() {
        let root = test_workspace_root("diffforge-empty-bootstrap-metadata");
        fs::create_dir_all(root.join(".agents").join("cloud-mcp")).unwrap();
        fs::write(
            root.join(".agents").join("cloud-mcp").join("cloud-mcp.jsonl"),
            "{}\n",
        )
        .unwrap();
        fs::write(root.join(".gitignore"), ".agents/\n/logs/\n").unwrap();
        fs::create_dir_all(root.join("logs")).unwrap();
        fs::write(root.join("logs").join("coordination-events.jsonl"), "{}\n").unwrap();

        assert!(!workspace_directory_is_empty(&root));
        assert!(workspace_directory_is_empty_for_git_bootstrap(&root));

        fs::write(root.join("README.md"), "now a project\n").unwrap();
        assert!(!workspace_directory_is_empty_for_git_bootstrap(&root));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn selected_root_bootstrap_allows_reopened_metadata_only_folder_without_empty_selection() {
        let root = test_workspace_root("diffforge-reopened-empty-bootstrap");
        fs::create_dir_all(root.join(".agents").join("cloud-mcp")).unwrap();
        fs::write(root.join(".gitignore"), ".agents/\n/logs/\n").unwrap();
        fs::create_dir_all(root.join("logs")).unwrap();
        fs::write(root.join("logs").join("coordination-alignment.jsonl"), "{}\n").unwrap();

        let bootstrap = workspace_git_bootstrap_for_selected_root(&root, false).unwrap();

        assert!(root.join(".git").exists());
        assert!(bootstrap.initialized_repo);
        assert!(bootstrap.created_initial_commit);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn selected_root_bootstrap_skips_non_empty_plain_folder_without_empty_selection() {
        let root = test_workspace_root("diffforge-non-empty-bootstrap-skip");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("README.md"), "not empty\n").unwrap();

        let bootstrap = workspace_git_bootstrap_for_selected_root(&root, false).unwrap();

        assert!(!root.join(".git").exists());
        assert!(!bootstrap.initialized_repo);
        assert_eq!(bootstrap.gitignore_update, "selected_root_not_empty");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn selected_root_bootstrap_skips_non_empty_plain_folder_with_stale_empty_selection() {
        let root = test_workspace_root("diffforge-stale-empty-bootstrap-skip");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("README.md"), "not empty\n").unwrap();

        let bootstrap = workspace_git_bootstrap_for_selected_root(&root, true).unwrap();

        assert!(!root.join(".git").exists());
        assert!(!bootstrap.initialized_repo);
        assert_eq!(bootstrap.gitignore_update, "selected_root_not_empty");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn project_mounts_include_marker_projects_without_git() {
        let root = test_workspace_root("diffforge-marker-mounts");
        create_package_project(&root.join("frontend"), "{\"scripts\":{\"dev\":\"vite\"}}\n");
        init_test_git_repo(&root.join("backend"));
        create_package_project(&root.join("client"), "{\"scripts\":{\"dev\":\"vite\"}}\n");

        let response = workspace_root_response(&root);
        let mount_ids = response
            .project_mounts
            .iter()
            .map(|mount| (mount.mount_id.as_str(), mount.has_git, mount.project_kind.as_str()))
            .collect::<Vec<_>>();

        assert_eq!(response.workspace_kind, "container");
        assert_eq!(response.project_mounts.len(), 3);
        assert!(mount_ids.contains(&("backend", true, "git")));
        assert!(mount_ids.contains(&("client", false, "project")));
        assert!(mount_ids.contains(&("frontend", false, "project")));
        assert!(!root.join(".git").exists());
        assert!(!root.join(".agents").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn nested_container_mount_manifest_preserves_parent_container_layers() {
        let root = test_workspace_root("diffforge-nested-container-mounts");
        create_package_project(&root.join("portfolio").join("product-a").join("frontend"), "{}\n");
        create_package_project(&root.join("portfolio").join("product-a").join("backend"), "{}\n");
        create_package_project(&root.join("portfolio").join("product-b").join("api"), "{}\n");

        let response = workspace_root_response(&root);
        let project_mount_ids = response
            .project_mounts
            .iter()
            .map(|mount| mount.mount_id.as_str())
            .collect::<Vec<_>>();
        let workspace_mounts = response
            .workspace_mounts
            .iter()
            .map(|mount| {
                (
                    mount.mount_id.as_str(),
                    mount.mount_kind.as_str(),
                    mount.parent_mount_id.as_deref(),
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(response.workspace_kind, "container");
        assert_eq!(response.project_mounts.len(), 3);
        assert!(project_mount_ids.contains(&"portfolio/product-a/frontend"));
        assert!(project_mount_ids.contains(&"portfolio/product-a/backend"));
        assert!(project_mount_ids.contains(&"portfolio/product-b/api"));
        assert!(workspace_mounts.contains(&("portfolio", "container", None)));
        assert!(workspace_mounts.contains(&(
            "portfolio/product-a",
            "container",
            Some("portfolio")
        )));
        assert!(workspace_mounts.contains(&(
            "portfolio/product-a/frontend",
            "project",
            Some("portfolio/product-a")
        )));
        assert!(workspace_mounts.contains(&(
            "portfolio/product-b/api",
            "project",
            Some("portfolio/product-b")
        )));
        assert!(!root.join(".git").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn selected_marker_project_root_is_not_treated_as_container() {
        let root = test_workspace_root("diffforge-selected-marker-project");
        create_package_project(&root, "{}\n");

        let response = workspace_root_response(&root);
        let coordination_root =
            workspace_coordination_root_for_terminal(&root, None, None).unwrap();

        assert_eq!(response.workspace_kind, "project");
        assert_eq!(response.project_mounts.len(), 1);
        assert_eq!(response.project_mounts[0].mount_id, "root");
        assert!(!response.project_mounts[0].has_git);
        assert_eq!(
            normalized_path_key(&coordination_root.canonicalize().unwrap()),
            normalized_path_key(&root.canonicalize().unwrap())
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn selected_git_root_still_discovers_nested_git_project_mounts() {
        let root = test_workspace_root("diffforge-selected-git-with-nested-git");
        init_test_git_repo(&root);
        let child = root.join("packages").join("mobile");
        init_test_git_repo(&child);

        let response = workspace_root_response(&root);
        let coordination_root =
            workspace_coordination_root_for_terminal(&root, None, None).unwrap();
        let project_mount_ids = response
            .project_mounts
            .iter()
            .map(|mount| mount.mount_id.as_str())
            .collect::<HashSet<_>>();
        let workspace_mount_ids = response
            .workspace_mounts
            .iter()
            .map(|mount| (mount.mount_id.as_str(), mount.mount_kind.as_str()))
            .collect::<HashSet<_>>();

        assert_eq!(response.workspace_kind, "git_repo");
        assert!(project_mount_ids.contains("root"));
        assert!(project_mount_ids.contains("packages/mobile"));
        assert!(workspace_mount_ids.contains(&("packages", "container")));
        assert!(workspace_mount_ids.contains(&("packages/mobile", "project")));
        assert_eq!(
            normalized_path_key(&coordination_root.canonicalize().unwrap()),
            normalized_path_key(&root.canonicalize().unwrap())
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn project_mount_scan_ignores_git_boundaries_past_depth_limit() {
        let root = test_workspace_root("diffforge-deep-nested-git-mount");
        let child = root
            .join("cases")
            .join("client")
            .join("regions")
            .join("east")
            .join("apps")
            .join("mobile")
            .join("native");
        init_test_git_repo(&child);

        let response = workspace_root_response(&root);
        let mount_ids = response
            .project_mounts
            .iter()
            .map(|mount| mount.mount_id.as_str())
            .collect::<HashSet<_>>();

        assert_eq!(response.workspace_kind, "plain");
        assert!(!mount_ids.contains("cases/client/regions/east/apps/mobile/native"));
        assert!(!root.join(".git").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn terminal_coordination_selects_requested_project_mount() {
        let root = test_workspace_root("diffforge-select-project");
        create_package_project(&root.join("frontend"), "{}\n");
        create_package_project(&root.join("backend"), "{}\n");

        let error = workspace_coordination_root_for_terminal(&root, None, None).unwrap_err();
        assert!(error.contains("multiple projects"));

        let selected =
            workspace_coordination_root_for_terminal(&root, None, Some("frontend")).unwrap();
        assert_eq!(
            normalized_path_key(&selected.canonicalize().unwrap()),
            normalized_path_key(&root.join("frontend").canonicalize().unwrap())
        );

        let selected_by_root = workspace_coordination_root_for_terminal(
            &root,
            Some(root.join("backend").to_str().unwrap()),
            None,
        )
        .unwrap();
        assert_eq!(
            normalized_path_key(&selected_by_root.canonicalize().unwrap()),
            normalized_path_key(&root.join("backend").canonicalize().unwrap())
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn terminal_coordination_selects_nested_project_mounts_without_targeting_parent_containers() {
        let root = test_workspace_root("diffforge-select-nested-project");
        create_package_project(&root.join("portfolio").join("product-a").join("frontend"), "{}\n");
        create_package_project(&root.join("portfolio").join("product-a").join("backend"), "{}\n");
        create_package_project(&root.join("portfolio").join("product-b").join("api"), "{}\n");

        let error = workspace_coordination_root_for_terminal(&root, None, None).unwrap_err();
        assert!(error.contains("multiple projects"));

        let selected = workspace_coordination_root_for_terminal(
            &root,
            None,
            Some("portfolio/product-a/frontend"),
        )
        .unwrap();
        assert_eq!(
            normalized_path_key(&selected.canonicalize().unwrap()),
            normalized_path_key(
                &root
                    .join("portfolio")
                    .join("product-a")
                    .join("frontend")
                    .canonicalize()
                    .unwrap()
            )
        );

        let container_error =
            workspace_coordination_root_for_terminal(&root, None, Some("portfolio/product-a"))
                .unwrap_err();
        assert!(container_error.contains("is not available"));
        assert!(!root.join(".git").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn terminal_coordination_rejects_explicit_parent_container_target() {
        let root = test_workspace_root("diffforge-reject-parent-container-target");
        create_package_project(&root.join("frontend"), "{}\n");
        create_package_project(&root.join("backend"), "{}\n");

        let error = workspace_coordination_root_for_terminal(
            &root,
            Some(root.to_str().unwrap()),
            None,
        )
        .unwrap_err();

        assert!(error.contains("Container aggregate root is not a project target"));
        assert!(!root.join(".git").exists());
        assert!(!root.join(".agents").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn direct_edit_selects_bounded_non_git_mounts_and_rejects_container_or_git_targets() {
        let root = test_workspace_root("diffforge-direct-edit-container");
        create_package_project(&root.join("frontend"), "{}\n");
        init_test_git_repo(&root.join("backend"));

        let aggregate_error =
            workspace_direct_edit_root_for_terminal(&root, Some(root.to_str().unwrap()), None)
                .unwrap_err();
        assert!(aggregate_error.contains("Container aggregate root"));

        let ambiguous_error =
            workspace_direct_edit_root_for_terminal(&root, None, None).unwrap_err();
        assert!(ambiguous_error.contains("multiple projects"));

        let selected =
            workspace_direct_edit_root_for_terminal(&root, None, Some("frontend")).unwrap();
        assert_eq!(
            normalized_path_key(&selected.canonicalize().unwrap()),
            normalized_path_key(&root.join("frontend").canonicalize().unwrap())
        );

        let selected_by_root = workspace_direct_edit_root_for_terminal(
            &root,
            Some(root.join("frontend").to_str().unwrap()),
            None,
        )
        .unwrap();
        assert_eq!(
            normalized_path_key(&selected_by_root.canonicalize().unwrap()),
            normalized_path_key(&root.join("frontend").canonicalize().unwrap())
        );

        let git_error =
            workspace_direct_edit_root_for_terminal(&root, None, Some("backend")).unwrap_err();
        assert!(git_error.contains("Git project"));
        assert!(!root.join(".git").exists());
        assert!(!root.join(".agents").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn direct_edit_selects_nested_non_git_leaf_mount_without_promoting_container_layers() {
        let root = test_workspace_root("diffforge-direct-edit-nested");
        create_package_project(&root.join("portfolio").join("product-a").join("frontend"), "{}\n");
        create_package_project(&root.join("portfolio").join("product-a").join("backend"), "{}\n");

        let selected = workspace_direct_edit_root_for_terminal(
            &root,
            None,
            Some("portfolio/product-a/frontend"),
        )
        .unwrap();

        assert_eq!(
            normalized_path_key(&selected.canonicalize().unwrap()),
            normalized_path_key(
                &root
                    .join("portfolio")
                    .join("product-a")
                    .join("frontend")
                    .canonicalize()
                    .unwrap()
            )
        );
        let container_error =
            workspace_direct_edit_root_for_terminal(&root, None, Some("portfolio/product-a"))
                .unwrap_err();
        assert!(container_error.contains("is not available"));
        assert!(!root.join(".git").exists());
        assert!(!root.join("portfolio").join(".git").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn direct_edit_rejects_selected_git_root() {
        let root = test_workspace_root("diffforge-direct-edit-git-root");
        init_test_git_repo(&root);

        let error = workspace_direct_edit_root_for_terminal(&root, None, None).unwrap_err();

        assert!(error.contains("Git project"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn direct_edit_rejects_single_git_mount_without_initializing_container() {
        let root = test_workspace_root("diffforge-direct-edit-single-git-mount");
        init_test_git_repo(&root.join("app"));

        let error = workspace_direct_edit_root_for_terminal(&root, None, None).unwrap_err();

        assert!(error.contains("Mounted project is a Git project"));
        assert!(!root.join(".git").exists());
        assert!(!root.join(".agents").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn direct_edit_allows_explicit_plain_child_folder_without_initializing_parent_git() {
        let root = test_workspace_root("diffforge-direct-edit-plain-child");
        let case_folder = root.join("case-files").join("may-report");
        fs::create_dir_all(&case_folder).unwrap();
        fs::write(case_folder.join("notes.md"), "# Notes\n").unwrap();

        let selected = workspace_direct_edit_root_for_terminal(
            &root,
            Some(case_folder.to_str().unwrap()),
            None,
        )
        .unwrap();

        assert_eq!(
            normalized_path_key(&selected.canonicalize().unwrap()),
            normalized_path_key(&case_folder.canonicalize().unwrap())
        );
        assert!(!root.join(".git").exists());
        assert!(!root.join(".agents").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn direct_edit_rejects_symlink_escape_from_plain_workspace() {
        use std::os::unix::fs as unix_fs;

        let root = test_workspace_root("diffforge-direct-edit-symlink-root");
        let outside = test_workspace_root("diffforge-direct-edit-symlink-outside");
        fs::create_dir_all(&root).unwrap();
        create_package_project(&outside, "{}\n");
        unix_fs::symlink(&outside, root.join("outside-link")).unwrap();

        let error = workspace_direct_edit_root_for_terminal(
            &root,
            Some(root.join("outside-link").to_str().unwrap()),
            None,
        )
        .unwrap_err();

        assert!(error.contains("must stay inside"));

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn broad_area_detection_marks_home_and_personal_folders_as_discovery_views() {
        let home = test_workspace_root("diffforge-fake-home");
        let documents = home.join("Documents");
        let downloads = home.join("Downloads");
        let project = home.join("project");
        fs::create_dir_all(&documents).unwrap();
        fs::create_dir_all(&downloads).unwrap();
        create_package_project(&project, "{}\n");

        assert!(workspace_root_is_broad_area_for_home(
            &home,
            &[],
            Some(home.clone())
        ));
        assert!(workspace_root_is_broad_area_for_home(
            &documents,
            &[],
            Some(home.clone())
        ));
        assert!(workspace_root_is_broad_area_for_home(
            &downloads,
            &[],
            Some(home.clone())
        ));

        let project_mounts = workspace_project_mounts(&project);
        assert!(!workspace_root_is_broad_area_for_home(
            &project,
            &project_mounts,
            Some(home.clone())
        ));

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn lazy_project_bootstrap_stays_inside_selected_child_project() {
        let root = test_workspace_root("diffforge-child-bootstrap");
        create_package_project(&root.join("frontend"), "{}\n");
        create_package_project(&root.join("backend"), "{}\n");
        let project_root =
            workspace_coordination_root_for_terminal(&root, None, Some("frontend")).unwrap();

        let bootstrap = ensure_workspace_git_ready_for_coordination(&project_root).unwrap();

        assert!(bootstrap.initialized_repo);
        assert!(project_root.join(".git").exists());
        assert!(project_root.join(".agents").exists() || project_root.join(".gitignore").exists());
        assert!(!root.join(".git").exists());
        assert!(!root.join(".agents").exists());
        assert!(!root.join("backend").join(".git").exists());

        let tracked = run_git_text(
            &project_root,
            &["ls-tree", "-r", "--name-only", "HEAD"],
            Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
            "git ls-tree",
        )
        .unwrap();
        assert!(tracked.contains("package.json"));
        assert!(tracked.contains("src/app.js"));

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn project_mount_scan_ignores_symlinked_projects() {
        use std::os::unix::fs as unix_fs;

        let root = test_workspace_root("diffforge-symlink-scan");
        let outside = test_workspace_root("diffforge-symlink-outside");
        create_package_project(&outside, "{}\n");
        fs::create_dir_all(&root).unwrap();
        unix_fs::symlink(&outside, root.join("outside-link")).unwrap();

        let response = workspace_root_response(&root);

        assert_eq!(response.workspace_kind, "plain");
        assert!(response.project_mounts.is_empty());

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
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

    #[test]
    fn broad_user_folder_without_project_marker_is_not_a_valid_workspace_root() {
        let home = test_workspace_root("diffforge-policy-home");
        let documents = home.join("Documents");
        fs::create_dir_all(&documents).unwrap();

        let error = workspace_root_rejection_reason_for_home(&documents, Some(&home)).unwrap();
        assert!(error.contains("too broad"));

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn project_folder_with_project_marker_is_allowed() {
        let home = test_workspace_root("diffforge-policy-project-home");
        let project = home.join("Documents").join("app");
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("package.json"), "{}\n").unwrap();

        assert!(workspace_root_rejection_reason_for_home(&project, Some(&home)).is_none());

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn huge_plain_folder_is_not_a_valid_workspace_root() {
        let root = test_workspace_root("diffforge-policy-huge");
        fs::create_dir_all(&root).unwrap();
        for index in 0..=MAX_SAFE_WORKSPACE_ROOT_IMMEDIATE_ENTRIES {
            fs::create_dir_all(root.join(format!("entry-{index}"))).unwrap();
        }

        let error = workspace_root_rejection_reason_for_home(&root, None).unwrap();
        assert!(error.contains("too many immediate entries"));

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(not(windows))]
    #[test]
    fn filesystem_root_triggers_default_directory_fallback() {
        assert!(should_fallback_default_working_directory(Path::new("/")));
    }

    #[cfg(windows)]
    #[test]
    fn windows_drive_root_is_not_a_valid_workspace_root() {
        assert!(is_filesystem_root_directory(Path::new(r"C:\")));
        assert!(should_fallback_default_working_directory(Path::new(r"C:\")));
    }
}

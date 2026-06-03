const ARCHITECTURE_GRAPH_MAX_BYTES: u64 = 2 * 1024 * 1024;
const ARCHITECTURE_GRAPH_ID_MAX: usize = 96;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureRepositoryEntry {
    id: String,
    name: String,
    path: String,
    relative_path: String,
    has_git: bool,
    architecture_root: String,
    graph_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureRepositoryList {
    root_directory: String,
    repositories: Vec<ArchitectureRepositoryEntry>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureGraphSummary {
    id: String,
    title: String,
    kind: String,
    group_path: Vec<String>,
    node_count: usize,
    edge_count: usize,
    created_at: String,
    updated_at: String,
    file_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureGraphList {
    repo_path: String,
    architecture_root: String,
    graphs: Vec<ArchitectureGraphSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchitectureGraphSaveResult {
    repo_path: String,
    architecture_root: String,
    graph_id: String,
    file_path: String,
    graph: Value,
}

fn architecture_now_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn architecture_slug(value: &str) -> String {
    let mut output = String::new();
    let mut last_separator = false;

    for character in value.chars() {
        if output.len() >= ARCHITECTURE_GRAPH_ID_MAX {
            break;
        }
        if character.is_ascii_alphanumeric() {
            output.push(character.to_ascii_lowercase());
            last_separator = false;
        } else if !last_separator && !output.is_empty() {
            output.push('-');
            last_separator = true;
        }
    }

    while output.ends_with('-') {
        output.pop();
    }

    output
}

fn architecture_graph_id_from_graph(graph: &Value) -> Result<String, String> {
    let raw = graph
        .get("id")
        .and_then(Value::as_str)
        .or_else(|| graph.get("title").and_then(Value::as_str))
        .unwrap_or_default();
    let graph_id = architecture_slug(raw);
    if graph_id.is_empty() {
        return Err("Architecture graph requires a non-empty id or title.".to_string());
    }
    Ok(graph_id)
}

fn architecture_agents_root(repo: &Path) -> PathBuf {
    repo.join(".agents").join("architectures")
}

fn architecture_graphs_root(repo: &Path, create: bool) -> Result<PathBuf, String> {
    let root = architecture_agents_root(repo);
    let graphs_root = root.join("graphs");
    if create {
        fs::create_dir_all(&graphs_root)
            .map_err(|error| format!("Unable to create architecture graph directory: {error}"))?;
        let _ = ensure_workspace_agents_gitignore(repo);
    }
    Ok(graphs_root)
}

fn architecture_graph_path(repo: &Path, graph_id: &str) -> PathBuf {
    architecture_agents_root(repo)
        .join("graphs")
        .join(format!("{graph_id}.json"))
}

fn architecture_graph_group_path(graph: &Value) -> Vec<String> {
    graph
        .get("groupPath")
        .or_else(|| graph.get("group_path"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .take(12)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn architecture_graph_summary_from_value(
    graph: &Value,
    fallback_id: &str,
    file_path: &Path,
) -> Option<ArchitectureGraphSummary> {
    let object = graph.as_object()?;
    let id = graph
        .get("id")
        .and_then(Value::as_str)
        .map(architecture_slug)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback_id.to_string());
    let title = object
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(id.as_str())
        .to_string();
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("architecture")
        .to_string();
    let node_count = object
        .get("nodes")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let edge_count = object
        .get("edges")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let created_at = object
        .get("createdAt")
        .or_else(|| object.get("created_at"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let updated_at = object
        .get("updatedAt")
        .or_else(|| object.get("updated_at"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    Some(ArchitectureGraphSummary {
        id,
        title,
        kind,
        group_path: architecture_graph_group_path(graph),
        node_count,
        edge_count,
        created_at,
        updated_at,
        file_path: workspace_path_display(file_path),
    })
}

fn architecture_read_graph_file(path: &Path) -> Result<Value, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Unable to inspect architecture graph file: {error}"))?;
    if !metadata.is_file() {
        return Err("Architecture graph path is not a file.".to_string());
    }
    if metadata.len() > ARCHITECTURE_GRAPH_MAX_BYTES {
        return Err("Architecture graph file is too large.".to_string());
    }
    let bytes = fs::read(path)
        .map_err(|error| format!("Unable to read architecture graph file: {error}"))?;
    serde_json::from_slice::<Value>(&bytes)
        .map_err(|error| format!("Unable to parse architecture graph JSON: {error}"))
}

fn architecture_graph_summaries(repo: &Path) -> Result<Vec<ArchitectureGraphSummary>, String> {
    let graphs_root = architecture_graphs_root(repo, false)?;
    if !graphs_root.exists() {
        return Ok(Vec::new());
    }

    let read_dir = fs::read_dir(&graphs_root)
        .map_err(|error| format!("Unable to list architecture graphs: {error}"))?;
    let mut graphs = Vec::new();

    for entry in read_dir {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        if metadata.len() > ARCHITECTURE_GRAPH_MAX_BYTES {
            continue;
        }
        let fallback_id = path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(architecture_slug)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "architecture".to_string());
        let Ok(graph) = architecture_read_graph_file(&path) else {
            continue;
        };
        if let Some(summary) = architecture_graph_summary_from_value(&graph, &fallback_id, &path) {
            graphs.push(summary);
        }
    }

    graphs.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.title.cmp(&right.title))
    });
    Ok(graphs)
}

fn architecture_write_index(
    repo: &Path,
    graphs: &[ArchitectureGraphSummary],
) -> Result<(), String> {
    let root = architecture_agents_root(repo);
    fs::create_dir_all(&root)
        .map_err(|error| format!("Unable to create architecture index directory: {error}"))?;
    let index = json!({
        "kind": "architecture_index",
        "version": 1,
        "updatedAt": architecture_now_millis(),
        "graphs": graphs,
    });
    let bytes = serde_json::to_vec_pretty(&index)
        .map_err(|error| format!("Unable to serialize architecture index: {error}"))?;
    fs::write(root.join("index.json"), bytes)
        .map_err(|error| format!("Unable to write architecture index: {error}"))
}

fn architecture_graph_count(repo: &Path) -> usize {
    architecture_graph_summaries(repo)
        .map(|graphs| graphs.len())
        .unwrap_or(0)
}

fn architecture_repository_entry(
    workspace_root: &Path,
    repo: &Path,
    relative_path: String,
    has_git: bool,
) -> ArchitectureRepositoryEntry {
    let name = repo
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("repo")
        .to_string();
    let path = workspace_path_display(repo);
    let architecture_root = workspace_path_display(&architecture_agents_root(repo));
    let id = normalized_path_key(repo);
    let relative_path = if relative_path.is_empty() {
        if normalized_path_key(workspace_root) == id {
            ".".to_string()
        } else {
            path.clone()
        }
    } else {
        relative_path
    };

    ArchitectureRepositoryEntry {
        id,
        name,
        path,
        relative_path,
        has_git,
        architecture_root,
        graph_count: architecture_graph_count(repo),
    }
}

fn architecture_repositories_blocking(
    root_directory: Option<String>,
) -> Result<ArchitectureRepositoryList, String> {
    let root = resolve_workspace_root_directory(root_directory.as_deref())?;
    let mounts = workspace_project_mounts(&root);
    let mut seen = HashSet::new();
    let mut repositories = Vec::new();

    for mount in mounts.iter().filter(|mount| mount.has_git) {
        let key = normalized_path_key(&mount.root_path);
        if seen.insert(key) {
            repositories.push(architecture_repository_entry(
                &root,
                &mount.root_path,
                mount.workspace_relative_path.clone(),
                mount.has_git,
            ));
        }
    }

    if repositories.is_empty() {
        let key = normalized_path_key(&root);
        if seen.insert(key) {
            let has_git = workspace_is_exact_git_root(&root);
            repositories.push(architecture_repository_entry(
                &root,
                &root,
                ".".to_string(),
                has_git,
            ));
        }
    }

    repositories.sort_by(|left, right| {
        left.relative_path
            .cmp(&right.relative_path)
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(ArchitectureRepositoryList {
        root_directory: workspace_path_display(&root),
        repositories,
    })
}

fn architecture_graphs_list_blocking(repo_path: String) -> Result<ArchitectureGraphList, String> {
    let repo = resolve_workspace_root_directory(Some(repo_path.as_str()))?;
    let graphs = architecture_graph_summaries(&repo)?;
    if architecture_agents_root(&repo).exists() {
        let _ = architecture_write_index(&repo, &graphs);
    }
    Ok(ArchitectureGraphList {
        repo_path: workspace_path_display(&repo),
        architecture_root: workspace_path_display(&architecture_agents_root(&repo)),
        graphs,
    })
}

fn architecture_graph_read_blocking(repo_path: String, graph_id: String) -> Result<Value, String> {
    let repo = resolve_workspace_root_directory(Some(repo_path.as_str()))?;
    let graph_id = architecture_slug(&graph_id);
    if graph_id.is_empty() {
        return Err("Architecture graph id is required.".to_string());
    }
    let path = architecture_graph_path(&repo, &graph_id);
    if !path.exists() {
        return Err("Architecture graph was not found.".to_string());
    }
    architecture_read_graph_file(&path)
}

fn architecture_graph_save_blocking(
    repo_path: String,
    mut graph: Value,
) -> Result<ArchitectureGraphSaveResult, String> {
    let repo = resolve_workspace_root_directory(Some(repo_path.as_str()))?;
    let graph_id = architecture_graph_id_from_graph(&graph)?;
    let graphs_root = architecture_graphs_root(&repo, true)?;
    let graph_path = graphs_root.join(format!("{graph_id}.json"));
    let object = graph
        .as_object_mut()
        .ok_or_else(|| "Architecture graph must be a JSON object.".to_string())?;
    let now = architecture_now_millis();

    object.insert("id".to_string(), Value::String(graph_id.clone()));
    object
        .entry("kind".to_string())
        .or_insert_with(|| Value::String("architecture".to_string()));
    object
        .entry("version".to_string())
        .or_insert_with(|| Value::Number(1.into()));
    object
        .entry("createdAt".to_string())
        .or_insert_with(|| Value::String(now.clone()));
    object.insert("updatedAt".to_string(), Value::String(now));

    let bytes = serde_json::to_vec_pretty(&graph)
        .map_err(|error| format!("Unable to serialize architecture graph: {error}"))?;
    if bytes.len() as u64 > ARCHITECTURE_GRAPH_MAX_BYTES {
        return Err("Architecture graph is too large.".to_string());
    }

    let temp_path = graph_path.with_extension("json.tmp");
    fs::write(&temp_path, bytes)
        .map_err(|error| format!("Unable to write architecture graph: {error}"))?;
    if graph_path.exists() {
        fs::remove_file(&graph_path)
            .map_err(|error| format!("Unable to replace architecture graph: {error}"))?;
    }
    fs::rename(&temp_path, &graph_path)
        .map_err(|error| format!("Unable to commit architecture graph: {error}"))?;

    let graphs = architecture_graph_summaries(&repo)?;
    let _ = architecture_write_index(&repo, &graphs);

    Ok(ArchitectureGraphSaveResult {
        repo_path: workspace_path_display(&repo),
        architecture_root: workspace_path_display(&architecture_agents_root(&repo)),
        graph_id,
        file_path: workspace_path_display(&graph_path),
        graph,
    })
}

#[tauri::command]
async fn architecture_repositories(
    root_directory: Option<String>,
) -> Result<ArchitectureRepositoryList, String> {
    tauri::async_runtime::spawn_blocking(move || architecture_repositories_blocking(root_directory))
        .await
        .map_err(|error| format!("Architecture repository worker failed: {error}"))?
}

#[tauri::command]
async fn architecture_graphs_list(repo_path: String) -> Result<ArchitectureGraphList, String> {
    tauri::async_runtime::spawn_blocking(move || architecture_graphs_list_blocking(repo_path))
        .await
        .map_err(|error| format!("Architecture graph list worker failed: {error}"))?
}

#[tauri::command]
async fn architecture_graph_read(repo_path: String, graph_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        architecture_graph_read_blocking(repo_path, graph_id)
    })
    .await
    .map_err(|error| format!("Architecture graph read worker failed: {error}"))?
}

#[tauri::command]
async fn architecture_graph_save(
    repo_path: String,
    graph: Value,
) -> Result<ArchitectureGraphSaveResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        architecture_graph_save_blocking(repo_path, graph)
    })
    .await
    .map_err(|error| format!("Architecture graph save worker failed: {error}"))?
}

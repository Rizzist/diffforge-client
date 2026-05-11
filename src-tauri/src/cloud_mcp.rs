const CLOUD_MCP_DEFAULT_BASE_URL: &str = "http://127.0.0.1:8080";
const CLOUD_MCP_CONNECT_TIMEOUT_SECS: u64 = 3;
const CLOUD_MCP_SYNC_TIMEOUT_SECS: u64 = 60;
const CLOUD_MCP_FILETREE_LIMIT: usize = 900;
const CLOUD_MCP_FILETREE_MAX_DEPTH: usize = 8;
const CLOUD_MCP_TODO_MAX_BYTES: usize = 128 * 1024;
const CLOUD_MCP_RUST_CLIENT_ID: &str = "rust-diffforge-agent";

#[derive(Clone)]
struct CloudMcpState {
    inner: Arc<Mutex<CloudMcpRuntime>>,
    client: reqwest::Client,
}

struct CloudMcpRuntime {
    base_url: String,
    connected: bool,
    status: String,
    last_error: String,
    last_connected_ms: Option<u64>,
    registered_workspaces: HashMap<String, CloudMcpWorkspaceStatus>,
    terminal_contexts: HashMap<String, CloudMcpTerminalContextState>,
}

#[derive(Clone)]
struct CloudMcpTerminalContextState {
    last_prompt: String,
    repo_id: String,
    agent_id: String,
    lane: String,
    working_directory: PathBuf,
    created_ms: u64,
    last_changed_hash: String,
    last_checkpoint_ms: u64,
    context_task_id: Option<String>,
    local_task_id: Option<String>,
    reported_change: bool,
    stable_change_cycles: u8,
    saw_agent_activity: bool,
    work_brief: String,
    work_brief_reported: bool,
    done_reported: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CloudMcpStatus {
    base_url: String,
    connected: bool,
    status: String,
    last_error: String,
    last_connected_ms: Option<u64>,
    registered_workspace_count: usize,
    registered_workspaces: Vec<CloudMcpWorkspaceStatus>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CloudMcpWorkspaceStatus {
    root: String,
    workspace_id: String,
    workspace_name: String,
    last_registered_ms: Option<u64>,
    last_synced_ms: Option<u64>,
    last_error: String,
    file_count: usize,
    policy_graph_detected: bool,
    policy_graph_path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CloudMcpFileEntry {
    relative_path: String,
    kind: String,
    size: Option<u64>,
    modified_ms: Option<u64>,
}

struct CloudMcpPreparedWorkspace {
    root: PathBuf,
    root_display: String,
    workspace_id: String,
    workspace_name: String,
    filetree: Vec<CloudMcpFileEntry>,
    filetree_truncated: bool,
    policy_graph_path: String,
    policy_graph: Option<Value>,
    todo_queue: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudMcpWorkspaceRegistrationResult {
    status: CloudMcpStatus,
    workspace: CloudMcpWorkspaceStatus,
    server_response: Value,
    synced: bool,
    log_path: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudMcpTodoResult {
    status: CloudMcpStatus,
    text: String,
    saved_at_ms: Option<u64>,
    synced: bool,
    last_error: String,
}

impl CloudMcpState {
    fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(CLOUD_MCP_SYNC_TIMEOUT_SECS))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            inner: Arc::new(Mutex::new(CloudMcpRuntime {
                base_url: cloud_mcp_base_url(),
                connected: false,
                status: "starting".to_string(),
                last_error: String::new(),
                last_connected_ms: None,
                registered_workspaces: HashMap::new(),
                terminal_contexts: HashMap::new(),
            })),
            client,
        }
    }
}

fn cloud_mcp_base_url() -> String {
    [
        "RUST_DIFFFORGE_CLOUD_MCP_URL",
        "CLOUD_DIFFFORGE_CLOUD_MCP_URL",
        "CLOUD_DIFFFORGE_BASE_URL",
    ]
    .iter()
    .find_map(|key| {
        env::var(key).ok().and_then(|value| {
            let trimmed = value.trim().trim_end_matches('/').to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
    })
    .unwrap_or_else(|| CLOUD_MCP_DEFAULT_BASE_URL.to_string())
}

fn cloud_mcp_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn cloud_mcp_short_hash(value: &str) -> String {
    let digest = Sha1::digest(value.as_bytes());
    format!("{digest:x}").chars().take(12).collect()
}

fn cloud_mcp_repo_id_for_root(root: &Path) -> String {
    format!("repo-{}", cloud_mcp_short_hash(&workspace_path_display(root)))
}

fn cloud_mcp_snapshot(runtime: &CloudMcpRuntime) -> CloudMcpStatus {
    let mut registered_workspaces = runtime
        .registered_workspaces
        .values()
        .cloned()
        .collect::<Vec<_>>();
    registered_workspaces.sort_by(|left, right| left.root.cmp(&right.root));
    CloudMcpStatus {
        base_url: runtime.base_url.clone(),
        connected: runtime.connected,
        status: runtime.status.clone(),
        last_error: runtime.last_error.clone(),
        last_connected_ms: runtime.last_connected_ms,
        registered_workspace_count: registered_workspaces.len(),
        registered_workspaces,
    }
}

async fn cloud_mcp_status_snapshot(state: &CloudMcpState) -> CloudMcpStatus {
    let runtime = state.inner.lock().await;
    cloud_mcp_snapshot(&runtime)
}

async fn cloud_mcp_set_connection_error(state: &CloudMcpState, error: String) -> CloudMcpStatus {
    let mut runtime = state.inner.lock().await;
    runtime.connected = false;
    runtime.status = "blocked".to_string();
    runtime.last_error = error;
    cloud_mcp_snapshot(&runtime)
}

async fn cloud_mcp_connect_state(state: &CloudMcpState, reason: &str) -> Result<CloudMcpStatus, String> {
    let connect_started_at = Instant::now();
    let base_url = {
        let runtime = state.inner.lock().await;
        runtime.base_url.clone()
    };

    log_terminal_event(
        "cloud_mcp.connect.start",
        None,
        None,
        None,
        json!({
            "base_url": clean_terminal_telemetry_text(&base_url),
            "reason": clean_terminal_telemetry_text(reason),
        }),
    );

    let mut last_error = String::new();
    for endpoint in ["/v1/dev/connection", "/v1/status"] {
        let url = format!("{base_url}{endpoint}");
        let response = state
            .client
            .get(&url)
            .timeout(Duration::from_secs(CLOUD_MCP_CONNECT_TIMEOUT_SECS))
            .send()
            .await;

        match response {
            Ok(response) if response.status().is_success() => {
                let server_response = response.json::<Value>().await.unwrap_or(Value::Null);
                let mut runtime = state.inner.lock().await;
                runtime.connected = true;
                runtime.status = "connected".to_string();
                runtime.last_error.clear();
                runtime.last_connected_ms = Some(cloud_mcp_now_ms());
                let snapshot = cloud_mcp_snapshot(&runtime);
                drop(runtime);

                log_terminal_event(
                    "cloud_mcp.connect.done",
                    None,
                    None,
                    Some(connect_started_at.elapsed()),
                    json!({
                        "base_url": clean_terminal_telemetry_text(&base_url),
                        "endpoint": endpoint,
                        "reason": clean_terminal_telemetry_text(reason),
                        "server_response": server_response,
                    }),
                );

                return Ok(snapshot);
            }
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                last_error = format!(
                    "Cloud MCP {endpoint} returned HTTP {status}: {}",
                    clean_terminal_telemetry_text(&body)
                );
            }
            Err(error) => {
                last_error = format!("Unable to reach Cloud MCP {endpoint}: {error}");
            }
        }
    }

    let snapshot = cloud_mcp_set_connection_error(state, last_error.clone()).await;
    log_terminal_event(
        "cloud_mcp.connect.error",
        None,
        None,
        Some(connect_started_at.elapsed()),
        json!({
            "base_url": clean_terminal_telemetry_text(&base_url),
            "reason": clean_terminal_telemetry_text(reason),
            "error": clean_terminal_telemetry_text(&last_error),
        }),
    );

    Err(format!(
        "Cloud MCP is required before terminals can start. {}",
        snapshot.last_error
    ))
}

async fn cloud_mcp_connected_or_connect(
    state: &CloudMcpState,
    reason: &str,
) -> Result<CloudMcpStatus, String> {
    let current = cloud_mcp_status_snapshot(state).await;
    if current.connected {
        return Ok(current);
    }

    cloud_mcp_connect_state(state, reason).await
}

async fn require_cloud_mcp_connected_state(state: &CloudMcpState) -> Result<CloudMcpStatus, String> {
    Ok(cloud_mcp_status_snapshot(state).await)
}

fn cloud_mcp_workspace_control_dir(root: &Path) -> PathBuf {
    root.join(".agents").join("cloud-mcp")
}

fn cloud_mcp_workspace_log_path(root: &Path) -> PathBuf {
    cloud_mcp_workspace_control_dir(root).join("cloud-mcp.jsonl")
}

fn cloud_mcp_workspace_todo_path(root: &Path) -> PathBuf {
    cloud_mcp_workspace_control_dir(root).join("todo-queue.md")
}

fn cloud_mcp_workspace_log(
    root: &Path,
    phase: &str,
    workspace_id: &str,
    workspace_name: &str,
    fields: Value,
) -> Result<PathBuf, String> {
    let dir = cloud_mcp_workspace_control_dir(root);
    fs::create_dir_all(&dir).map_err(|error| {
        format!(
            "Unable to create Cloud MCP workspace log directory {}: {error}",
            workspace_path_display(&dir)
        )
    })?;

    let path = cloud_mcp_workspace_log_path(root);
    static CLOUD_MCP_WORKSPACE_LOG_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> =
        std::sync::OnceLock::new();
    let _guard = CLOUD_MCP_WORKSPACE_LOG_LOCK
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .map_err(|_| "Cloud MCP workspace log lock is poisoned.".to_string())?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| {
            format!(
                "Unable to open Cloud MCP workspace log {}: {error}",
                workspace_path_display(&path)
            )
        })?;

    let entry = json!({
        "ts_ms": cloud_mcp_now_ms(),
        "phase": phase,
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "root": workspace_path_display(root),
        "fields": fields,
    });

    writeln!(file, "{entry}").map_err(|error| {
        format!(
            "Unable to write Cloud MCP workspace log {}: {error}",
            workspace_path_display(&path)
        )
    })?;

    Ok(path)
}

fn cloud_mcp_read_todo(root: &Path) -> Result<String, String> {
    let path = cloud_mcp_workspace_todo_path(root);
    match fs::read_to_string(&path) {
        Ok(value) => Ok(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!(
            "Unable to read To Do Queue {}: {error}",
            workspace_path_display(&path)
        )),
    }
}

fn cloud_mcp_write_todo(root: &Path, text: &str) -> Result<PathBuf, String> {
    if text.len() > CLOUD_MCP_TODO_MAX_BYTES {
        return Err(format!(
            "To Do Queue is too large. Limit is {CLOUD_MCP_TODO_MAX_BYTES} bytes."
        ));
    }

    let dir = cloud_mcp_workspace_control_dir(root);
    fs::create_dir_all(&dir).map_err(|error| {
        format!(
            "Unable to create Cloud MCP workspace state directory {}: {error}",
            workspace_path_display(&dir)
        )
    })?;

    let path = cloud_mcp_workspace_todo_path(root);
    fs::write(&path, text).map_err(|error| {
        format!(
            "Unable to write To Do Queue {}: {error}",
            workspace_path_display(&path)
        )
    })?;

    Ok(path)
}

fn cloud_mcp_skip_filetree_name(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".next"
            | ".turbo"
            | ".cache"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | "__pycache__"
    )
}

fn cloud_mcp_modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
}

fn cloud_mcp_collect_filetree(root: &Path) -> (Vec<CloudMcpFileEntry>, bool) {
    let mut entries = Vec::new();
    let mut queue = VecDeque::new();
    queue.push_back((root.to_path_buf(), 0usize));
    let mut truncated = false;

    while let Some((directory, depth)) = queue.pop_front() {
        if entries.len() >= CLOUD_MCP_FILETREE_LIMIT {
            truncated = true;
            break;
        }
        if depth > CLOUD_MCP_FILETREE_MAX_DEPTH {
            truncated = true;
            continue;
        }

        let Ok(read_dir) = fs::read_dir(&directory) else {
            continue;
        };

        for entry in read_dir.flatten() {
            if entries.len() >= CLOUD_MCP_FILETREE_LIMIT {
                truncated = true;
                break;
            }

            let file_name = entry.file_name().to_string_lossy().to_string();
            if cloud_mcp_skip_filetree_name(&file_name) {
                continue;
            }

            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }

            let path = entry.path();
            let relative_path = path
                .strip_prefix(root)
                .unwrap_or(path.as_path())
                .to_string_lossy()
                .replace('\\', "/");

            if file_type.is_dir() {
                entries.push(CloudMcpFileEntry {
                    relative_path,
                    kind: "directory".to_string(),
                    size: None,
                    modified_ms: entry.metadata().ok().and_then(|metadata| cloud_mcp_modified_ms(&metadata)),
                });
                queue.push_back((path, depth + 1));
            } else if file_type.is_file() {
                let metadata = entry.metadata().ok();
                entries.push(CloudMcpFileEntry {
                    relative_path,
                    kind: "file".to_string(),
                    size: metadata.as_ref().map(fs::Metadata::len),
                    modified_ms: metadata
                        .as_ref()
                        .and_then(|metadata| cloud_mcp_modified_ms(metadata)),
                });
            }
        }
    }

    (entries, truncated)
}

fn cloud_mcp_policy_candidate(path: &Path) -> bool {
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let parent_name = path
        .parent()
        .and_then(Path::file_name)
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    matches!(
        file_name.as_str(),
        "policygraph.json" | "policy-graph.json" | "policy_graph.json"
    ) || (file_name == "graph.json" && (parent_name.contains("policy") || parent_name == "sql"))
}

fn cloud_mcp_find_policy_graph(root: &Path) -> Option<(String, Value)> {
    let mut candidates = Vec::new();

    for ancestor in root.ancestors().take(5) {
        candidates.push(ancestor.join("PolicyGraph.json"));
        candidates.push(ancestor.join("policygraph.json"));
        candidates.push(ancestor.join("policy-graph.json"));
        candidates.push(ancestor.join("policy_graph.json"));
        candidates.push(ancestor.join(".diffforge").join("policygraph.json"));
        candidates.push(ancestor.join(".agents").join("policygraph.json"));
        candidates.push(ancestor.join("sql").join("graph.json"));

        if let Ok(read_dir) = fs::read_dir(ancestor) {
            for entry in read_dir.flatten().take(96) {
                let path = entry.path();
                if path.is_file() {
                    candidates.push(path);
                    continue;
                }

                if path.is_dir() {
                    if let Ok(child_dir) = fs::read_dir(&path) {
                        for child in child_dir.flatten().take(96) {
                            candidates.push(child.path());
                        }
                    }
                }
            }
        }
    }

    let mut seen = HashSet::new();
    for candidate in candidates {
        if !cloud_mcp_policy_candidate(&candidate) {
            continue;
        }

        let key = workspace_path_display(&candidate);
        if !seen.insert(key.clone()) {
            continue;
        }

        let Ok(metadata) = fs::metadata(&candidate) else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > 256 * 1024 {
            continue;
        }

        let Ok(contents) = fs::read_to_string(&candidate) else {
            continue;
        };
        if let Ok(value) = serde_json::from_str::<Value>(&contents) {
            return Some((key, value));
        }
    }

    None
}

fn cloud_mcp_prepare_workspace(
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<CloudMcpPreparedWorkspace, String> {
    let root = resolve_workspace_root_directory(Some(&repo_path))?;
    cloud_mcp_prepare_workspace_from_root(root, workspace_id, workspace_name)
}

fn cloud_mcp_prepare_workspace_from_root(
    root: PathBuf,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<CloudMcpPreparedWorkspace, String> {
    let root_display = workspace_path_display(&root);
    let workspace_id = workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("local-{}", cloud_mcp_short_hash(&root_display)));
    let workspace_name = workspace_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            root.file_name()
                .map(|value| value.to_string_lossy().to_string())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "Local workspace".to_string())
        });
    let (filetree, filetree_truncated) = cloud_mcp_collect_filetree(&root);
    let (policy_graph_path, policy_graph) = cloud_mcp_find_policy_graph(&root)
        .map(|(path, value)| (path, Some(value)))
        .unwrap_or_else(|| (String::new(), None));
    let todo_queue = cloud_mcp_read_todo(&root).unwrap_or_default();

    Ok(CloudMcpPreparedWorkspace {
        root,
        root_display,
        workspace_id,
        workspace_name,
        filetree,
        filetree_truncated,
        policy_graph_path,
        policy_graph,
        todo_queue,
    })
}

async fn cloud_mcp_post_json_endpoint(
    state: &CloudMcpState,
    endpoint: &str,
    payload: &Value,
) -> Result<Value, String> {
    let base_url = {
        let runtime = state.inner.lock().await;
        runtime.base_url.clone()
    };
    let url = format!("{base_url}{endpoint}");
    let log_context = cloud_mcp_post_log_context(endpoint, payload);
    if let Some((root, workspace_id, workspace_name, fields)) = &log_context {
        let _ = cloud_mcp_workspace_log(
            root,
            "cloud_mcp.http.start",
            workspace_id,
            workspace_name,
            fields.clone(),
        );
    }

    let response = match state
        .client
        .post(&url)
        .header("x-diffforge-client-id", CLOUD_MCP_RUST_CLIENT_ID)
        .timeout(Duration::from_secs(CLOUD_MCP_SYNC_TIMEOUT_SECS))
        .json(payload)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            if let Some((root, workspace_id, workspace_name, fields)) = &log_context {
                let mut fields = fields.clone();
                fields["error"] = json!(error.to_string());
                let _ = cloud_mcp_workspace_log(
                    root,
                    "cloud_mcp.http.error",
                    workspace_id,
                    workspace_name,
                    fields,
                );
            }
            return Err(format!("Unable to POST {endpoint} to Cloud MCP: {error}"));
        }
    };

    if response.status().is_success() {
        let value = response.json::<Value>().await.unwrap_or(Value::Null);
        if let Some((root, workspace_id, workspace_name, fields)) = &log_context {
            let _ = cloud_mcp_workspace_log(
                root,
                "cloud_mcp.http.done",
                workspace_id,
                workspace_name,
                fields.clone(),
            );
        }
        return Ok(value);
    }

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if let Some((root, workspace_id, workspace_name, fields)) = &log_context {
        let mut fields = fields.clone();
        fields["status"] = json!(status.as_u16());
        fields["error"] = json!(clean_terminal_telemetry_text(&body));
        let _ = cloud_mcp_workspace_log(
            root,
            "cloud_mcp.http.error",
            workspace_id,
            workspace_name,
            fields,
        );
    }
    Err(format!(
        "Cloud MCP {endpoint} returned HTTP {status}: {}",
        clean_terminal_telemetry_text(&body)
    ))
}

fn cloud_mcp_post_log_context(
    endpoint: &str,
    payload: &Value,
) -> Option<(PathBuf, String, String, Value)> {
    let repo_path = cloud_mcp_payload_text(payload, &["repo_path"])
        .or_else(|| cloud_mcp_payload_text(payload, &["workspace_root"]))
        .or_else(|| cloud_mcp_payload_text(payload, &["payload", "repo_path"]))
        .or_else(|| cloud_mcp_payload_text(payload, &["payload", "workspace_root"]))?;
    let root = resolve_workspace_root_directory(Some(&repo_path)).unwrap_or_else(|_| PathBuf::from(&repo_path));
    let workspace_id = cloud_mcp_payload_text(payload, &["workspace_id"])
        .or_else(|| cloud_mcp_payload_text(payload, &["payload", "workspace_id"]))
        .unwrap_or_default();
    let workspace_name = cloud_mcp_payload_text(payload, &["workspace_name"])
        .or_else(|| cloud_mcp_payload_text(payload, &["payload", "workspace_name"]))
        .unwrap_or_default();
    let agent_id = cloud_mcp_payload_text(payload, &["agent_id"])
        .or_else(|| cloud_mcp_payload_text(payload, &["payload", "agent_id"]))
        .unwrap_or_else(|| "rust-diffforge".to_string());
    let pane_id = cloud_mcp_payload_text(payload, &["terminal_id"])
        .or_else(|| cloud_mcp_payload_text(payload, &["pane_id"]))
        .or_else(|| cloud_mcp_payload_text(payload, &["payload", "terminal_id"]))
        .or_else(|| cloud_mcp_payload_text(payload, &["payload", "pane_id"]));
    let terminal_instance_id = payload
        .get("terminal_instance_id")
        .or_else(|| payload.get("instance_id"))
        .or_else(|| payload.get("payload").and_then(|payload| payload.get("terminal_instance_id")))
        .or_else(|| payload.get("payload").and_then(|payload| payload.get("instance_id")))
        .cloned();
    let tool = match endpoint {
        "/v1/context/pack" => "cloud_get_context_pack",
        "/v1/context/subtasks/checkpoint" => "cloud_subtask_checkpoint",
        "/v1/context/history/events" => "cloud_record_history_event",
        "/v1/context/agents/claim-lane" => "cloud_claim_lane",
        "/v1/context/agents/release-lane" => "cloud_release_lane",
        _ => "cloud_mcp_http",
    };
    let mut fields = json!({
        "endpoint": endpoint,
        "tool": tool,
        "agentId": agent_id,
        "repoPath": repo_path,
    });
    if let Some(pane_id) = pane_id {
        fields["paneId"] = json!(pane_id);
    }
    if let Some(terminal_instance_id) = terminal_instance_id {
        fields["terminalInstanceId"] = terminal_instance_id;
    }

    Some((
        root,
        workspace_id,
        workspace_name,
        fields,
    ))
}

fn cloud_mcp_payload_text(payload: &Value, path: &[&str]) -> Option<String> {
    let mut current = payload;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
}

async fn cloud_mcp_register_prepared_workspace(
    state: &CloudMcpState,
    prepared: CloudMcpPreparedWorkspace,
    reason: &str,
) -> Result<CloudMcpWorkspaceRegistrationResult, String> {
    let now_ms = cloud_mcp_now_ms();
    let repo_id = format!("repo-{}", cloud_mcp_short_hash(&prepared.root_display));
    let policy_graph_detected = prepared.policy_graph.is_some();
    let workspace_status = CloudMcpWorkspaceStatus {
        root: prepared.root_display.clone(),
        workspace_id: prepared.workspace_id.clone(),
        workspace_name: prepared.workspace_name.clone(),
        last_registered_ms: if reason == "workspace_registration" {
            Some(now_ms)
        } else {
            None
        },
        last_synced_ms: Some(now_ms),
        last_error: String::new(),
        file_count: prepared.filetree.len(),
        policy_graph_detected,
        policy_graph_path: prepared.policy_graph_path.clone(),
    };
    let payload = json!({
        "source": "rust-diffforge",
        "repo_id": repo_id.clone(),
        "agent_id": "rust-diffforge",
        "event_kind": reason,
        "summary": format!("Workspace {} synced into the Cloud MCP context ledger.", prepared.workspace_name),
        "payload": {
            "reason": reason,
            "workspace_id": prepared.workspace_id,
            "workspace_name": prepared.workspace_name,
            "workspace_root": prepared.root_display,
            "file_count": workspace_status.file_count,
            "filetree_truncated": prepared.filetree_truncated,
            "policy_graph_detected": policy_graph_detected,
            "policy_graph_path": workspace_status.policy_graph_path,
            "todo_queue_bytes": prepared.todo_queue.len(),
            "context_pack_model": true,
        }
    });
    let server_response =
        cloud_mcp_post_json_endpoint(state, "/v1/context/history/events", &payload).await?;
    let log_path = cloud_mcp_workspace_log(
        &prepared.root,
        reason,
        &workspace_status.workspace_id,
        &workspace_status.workspace_name,
        json!({
            "repo_id": repo_id,
            "file_count": workspace_status.file_count,
            "filetree_truncated": prepared.filetree_truncated,
            "policy_graph_detected": policy_graph_detected,
            "synced": true,
        }),
    )?;
    {
        let mut runtime = state.inner.lock().await;
        runtime
            .registered_workspaces
            .insert(workspace_status.root.clone(), workspace_status.clone());
        runtime.connected = true;
        runtime.status = "connected".to_string();
        runtime.last_error.clear();
        runtime.last_connected_ms = Some(now_ms);
    }
    let status = cloud_mcp_status_snapshot(state).await;
    Ok(CloudMcpWorkspaceRegistrationResult {
        status,
        workspace: workspace_status,
        server_response,
        synced: true,
        log_path: workspace_path_display(&log_path),
        message: "Workspace synced to Cloud MCP context ledger.".to_string(),
    })
}

async fn cloud_mcp_get_json_endpoint(state: &CloudMcpState, endpoint: &str) -> Result<Value, String> {
    let base_url = {
        let runtime = state.inner.lock().await;
        runtime.base_url.clone()
    };
    let url = format!("{base_url}{endpoint}");
    let response = state
        .client
        .get(&url)
        .timeout(Duration::from_secs(CLOUD_MCP_SYNC_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|error| format!("Unable to GET {endpoint} from Cloud MCP: {error}"))?;

    if response.status().is_success() {
        return Ok(response.json::<Value>().await.unwrap_or(Value::Null));
    }

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    Err(format!(
        "Cloud MCP {endpoint} returned HTTP {status}: {}",
        clean_terminal_telemetry_text(&body)
    ))
}

async fn cloud_mcp_get_json_optional(state: &CloudMcpState, endpoint: &str) -> Value {
    cloud_mcp_get_json_endpoint(state, endpoint)
        .await
        .unwrap_or(Value::Null)
}

fn cloud_mcp_response_data(value: &Value) -> Value {
    value.get("data").cloned().unwrap_or_else(|| value.clone())
}

fn cloud_mcp_terminal_key(pane_id: &str, instance_id: u64) -> String {
    format!("{pane_id}::{instance_id}")
}

fn cloud_mcp_terminal_agent_id(
    pane_id: &str,
    instance_id: u64,
    coordination: Option<&TerminalCoordinationSession>,
) -> String {
    coordination
        .map(|coordination| coordination.agent_id.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("{pane_id}-{instance_id}"))
}

fn cloud_mcp_terminal_repo_id(
    working_directory: &Path,
    coordination: Option<&TerminalCoordinationSession>,
) -> String {
    coordination
        .map(|coordination| coordination.repo_path.clone())
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("repo-{}", cloud_mcp_short_hash(&value)))
        .unwrap_or_else(|| format!("repo-{}", cloud_mcp_short_hash(&workspace_path_display(working_directory))))
}

fn cloud_mcp_strip_terminal_sequences(value: &str) -> String {
    enum State {
        Ground,
        Escape,
        Csi,
        Osc,
        OscEscape,
        Ss3,
    }

    let mut state = State::Ground;
    let mut output = String::with_capacity(value.len());
    for character in value.chars() {
        match state {
            State::Ground => {
                if character == '\u{1b}' {
                    state = State::Escape;
                } else {
                    output.push(character);
                }
            }
            State::Escape => {
                state = match character {
                    '[' => State::Csi,
                    ']' | 'P' | '^' | '_' | 'X' => State::Osc,
                    'O' => State::Ss3,
                    _ => State::Ground,
                };
            }
            State::Csi => {
                let code = character as u32;
                if (0x40..=0x7e).contains(&code) {
                    state = State::Ground;
                }
            }
            State::Osc => {
                if character == '\u{1b}' {
                    state = State::OscEscape;
                } else if character == '\u{7}' {
                    state = State::Ground;
                }
            }
            State::OscEscape => {
                state = State::Ground;
            }
            State::Ss3 => {
                state = State::Ground;
            }
        }
    }
    output
}

fn cloud_mcp_strip_terminal_residue(value: &str) -> String {
    let chars = value.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(value.len());
    let mut index = 0;
    while index < chars.len() {
        let character = chars[index];
        if character == '[' && index + 1 < chars.len() {
            let next = chars[index + 1];
            if next == '?' || next.is_ascii_digit() {
                let mut end = index + 1;
                while end < chars.len() && end.saturating_sub(index) <= 48 {
                    let code = chars[end] as u32;
                    if (0x40..=0x7e).contains(&code) {
                        end += 1;
                        break;
                    }
                    end += 1;
                }
                if end > index + 1 && end <= chars.len() {
                    output.push(' ');
                    index = end;
                    continue;
                }
            }
            if matches!(next, 'O' | 'I') {
                output.push(' ');
                index += 2;
                continue;
            }
        }
        if character == ']' && index + 2 < chars.len() && chars[index + 1].is_ascii_digit() {
            let mut end = index + 1;
            while end < chars.len() && chars[end].is_ascii_digit() {
                end += 1;
            }
            if end < chars.len() && chars[end] == ';' {
                end += 1;
                while end < chars.len() && !chars[end].is_whitespace() {
                    if chars[end] == '\\' {
                        end += 1;
                        break;
                    }
                    end += 1;
                }
                output.push(' ');
                index = end;
                continue;
            }
        }
        output.push(character);
        index += 1;
    }
    output
}

fn cloud_mcp_clean_prompt_text(prompt: &str) -> String {
    cloud_mcp_strip_terminal_residue(&cloud_mcp_strip_terminal_sequences(prompt))
        .replace(|character: char| character.is_control(), " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn cloud_mcp_prompt_summary(prompt: &str) -> String {
    let cleaned = cloud_mcp_clean_prompt_text(prompt);
    cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(220)
        .collect()
}

fn cloud_mcp_extract_agent_work_brief(text: &str) -> Option<String> {
    let cleaned = cloud_mcp_clean_prompt_text(text);
    let lower = cleaned.to_ascii_lowercase();
    let markers = ["i'll ", "i’ll ", "i will ", "i'm ", "i’m ", "i am "];
    let (start, _) = markers
        .iter()
        .filter_map(|marker| lower.find(marker).map(|index| (index, *marker)))
        .min_by_key(|(index, _)| *index)?;
    let mut brief = cleaned[start..].trim().to_string();
    if let Some(index) = brief.find(". ") {
        brief.truncate(index + 1);
    }
    let brief = brief
        .trim_matches(|character: char| character == '•' || character == '-' || character.is_whitespace())
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if brief.len() < 18 {
        None
    } else {
        Some(brief.chars().take(280).collect())
    }
}

fn cloud_mcp_work_title_from_brief(brief: &str) -> String {
    let mut title = brief.trim().to_string();
    for prefix in ["I'll ", "I’ll ", "I will ", "I'm ", "I’m ", "I am "] {
        if title.starts_with(prefix) {
            title = title[prefix.len()..].trim().to_string();
            break;
        }
    }
    let lower = title.to_ascii_lowercase();
    for delimiter in [" now by ", " by ", " so ", " until ", " and then "] {
        if let Some(index) = lower.find(delimiter) {
            title.truncate(index);
            break;
        }
    }
    let title = title
        .trim_matches(|character: char| character == '.' || character == ':' || character.is_whitespace())
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if title.is_empty() {
        "Agent working on requested task".to_string()
    } else {
        let mut characters = title.chars();
        let first = characters
            .next()
            .map(|character| character.to_uppercase().collect::<String>())
            .unwrap_or_default();
        format!("{}{}", first, characters.collect::<String>())
            .chars()
            .take(160)
            .collect()
    }
}

fn cloud_mcp_work_subject(work_brief: &str) -> String {
    if work_brief.trim().is_empty() {
        "requested work".to_string()
    } else {
        cloud_mcp_work_title_from_brief(work_brief)
    }
}

fn cloud_mcp_title_from_changed_files(changed_files: &[Value]) -> Option<String> {
    if changed_files.is_empty() {
        return None;
    }
    if changed_files.len() == 1 {
        let file = &changed_files[0];
        let path = file["path"].as_str().unwrap_or_default().trim();
        if path.is_empty() {
            return Some("Update one file".to_string());
        }
        let action = match file["change_kind"].as_str().unwrap_or_default() {
            "added" => "Create",
            "deleted" => "Remove",
            "renamed" => "Rename",
            "copied" => "Copy",
            _ => "Update",
        };
        return Some(format!("{action} {path}").chars().take(160).collect());
    }
    Some(format!("Update {} files", changed_files.len()))
}

fn cloud_mcp_git_changed_files(root: &Path) -> Vec<Value> {
    let Ok(output) = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["status", "--porcelain", "-z", "--untracked-files=all"])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    let mut files = Vec::new();
    let mut parts = output.stdout.split(|byte| *byte == 0).filter(|part| !part.is_empty());
    while let Some(entry) = parts.next() {
        if entry.len() < 4 {
            continue;
        }
        let status = String::from_utf8_lossy(&entry[0..2]).to_string();
        let mut path = String::from_utf8_lossy(&entry[3..]).replace('\\', "/");
        let change_kind = if status.starts_with('R') || status.starts_with('C') {
            if let Some(next_path) = parts.next() {
                path = String::from_utf8_lossy(next_path).replace('\\', "/");
            }
            if status.starts_with('R') {
                "renamed"
            } else {
                "copied"
            }
        } else if status == "??" || status.contains('A') {
            "added"
        } else if status.contains('D') {
            "deleted"
        } else {
            "modified"
        };
        if path.starts_with(".agents/") || path.starts_with(".git/") {
            continue;
        }
        if path == ".DS_Store" || path.ends_with("/.DS_Store") {
            continue;
        }
        files.push(json!({
            "path": path,
            "change_kind": change_kind,
            "untracked": status == "??",
        }));
        if files.len() >= 100 {
            break;
        }
    }
    files
}

async fn cloud_mcp_claim_terminal_lane(
    state: &CloudMcpState,
    repo_id: &str,
    agent_id: &str,
    lane: &str,
    prompt: &str,
    working_directory: &Path,
    coordination: Option<&TerminalCoordinationSession>,
) {
    if lane.trim().is_empty() {
        return;
    }
    let payload = json!({
        "source": "rust-diffforge-terminal",
        "repo_id": repo_id,
        "agent_id": agent_id,
        "lane": lane,
        "reason": format!("Starting terminal task: {}", cloud_mcp_prompt_summary(prompt)),
        "metadata": {
            "workspace_root": workspace_path_display(working_directory),
            "session_id": coordination.map(|coordination| coordination.session_id.clone()),
        },
        "ts_ms": cloud_mcp_now_ms(),
    });
    if let Err(error) = cloud_mcp_post_json_endpoint(state, "/v1/context/agents/claim-lane", &payload).await {
        log_terminal_event(
            "cloud_mcp.context_pack.claim_lane.error",
            None,
            None,
            None,
            json!({
                "agent_id": clean_terminal_telemetry_text(agent_id),
                "lane": clean_terminal_telemetry_text(lane),
                "error": clean_terminal_telemetry_text(&error),
            }),
        );
    }
}

async fn cloud_mcp_create_terminal_context_task(
    state: &CloudMcpState,
    repo_id: &str,
    agent_id: &str,
    lane: &str,
    prompt: &str,
    pane_id: &str,
    instance_id: u64,
    working_directory: &Path,
    coordination: Option<&TerminalCoordinationSession>,
    local_task_id: Option<&str>,
    local_task_title: Option<&str>,
) -> Option<String> {
    let title = local_task_title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Agent preparing requested work");
    let clean_prompt = cloud_mcp_clean_prompt_text(prompt);
    let payload = json!({
        "source": "rust-diffforge-terminal",
        "repo_id": repo_id,
        "run_id": local_task_id,
        "agent_id": agent_id,
        "self_agent_id": agent_id,
        "current_agent_id": agent_id,
        "title": title,
        "body": "Rust created the local coordination task before the agent begins work. The agent should update this task with its concrete working brief.",
        "status": "active",
        "lane": lane,
        "source_prompt": clean_prompt,
        "metadata": {
            "terminal_id": pane_id,
            "terminal_instance_id": instance_id,
            "workspace_root": workspace_path_display(working_directory),
            "session_id": coordination.map(|coordination| coordination.session_id.clone()),
            "local_coordination_task_id": local_task_id,
            "coordination_task_id": local_task_id,
            "managed_by": "rust-diffforge",
            "title_source": if local_task_title.is_some() { "rust_prompt_summary" } else { "placeholder" },
        },
        "ts_ms": cloud_mcp_now_ms(),
    });
    match cloud_mcp_post_json_endpoint(state, "/v1/context/tasks", &payload).await {
        Ok(response) => {
            let data = cloud_mcp_response_data(&response);
            let task_id = data["task"]["id"].as_str().map(str::to_string);
            if let Some(task_id) = task_id.as_deref() {
                let _ = cloud_mcp_workspace_log(
                    working_directory,
                    "cloud_mcp.task.created",
                    "",
                    "",
                    json!({
                        "activity": "created task",
                        "detail": title,
                        "agent_id": clean_terminal_telemetry_text(agent_id),
                        "pane_id": clean_terminal_telemetry_text(pane_id),
                        "task_id": clean_terminal_telemetry_text(task_id),
                        "title": title,
                    }),
                );
            }
            task_id
        }
        Err(error) => {
            let _ = cloud_mcp_workspace_log(
                working_directory,
                "cloud_mcp.context_pack.task_create_error",
                "",
                "",
                json!({
                    "agent_id": clean_terminal_telemetry_text(agent_id),
                    "pane_id": clean_terminal_telemetry_text(pane_id),
                    "repo_id": clean_terminal_telemetry_text(repo_id),
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );
            None
        }
    }
}

async fn cloud_mcp_update_terminal_context_task(
    state: &CloudMcpState,
    repo_id: &str,
    agent_id: &str,
    task_id: &str,
    status: &str,
    lane: &str,
    title: Option<&str>,
    title_source: Option<&str>,
    brief: &str,
    changed_files: &[Value],
    working_directory: &Path,
    pane_id: Option<&str>,
) {
    if task_id.trim().is_empty() {
        return;
    }
    let payload = json!({
        "source": "rust-diffforge-terminal",
        "repo_id": repo_id,
        "agent_id": agent_id,
        "self_agent_id": agent_id,
        "current_agent_id": agent_id,
        "title": title,
        "status": status,
        "lane": lane,
        "body": brief,
        "metadata": {
            "managed_by": "rust-diffforge",
            "title_source": title_source,
            "changed_file_count": changed_files.len(),
            "changed_files": changed_files,
        },
        "ts_ms": cloud_mcp_now_ms(),
    });
    let endpoint = format!("/v1/context/tasks/{task_id}");
    if let Err(error) = cloud_mcp_post_json_endpoint(state, &endpoint, &payload).await {
        let _ = cloud_mcp_workspace_log(
            working_directory,
            "cloud_mcp.context_pack.task_update_error",
            "",
            "",
            json!({
                "agent_id": clean_terminal_telemetry_text(agent_id),
                "repo_id": clean_terminal_telemetry_text(repo_id),
                "task_id": clean_terminal_telemetry_text(task_id),
                "status": status,
                "error": clean_terminal_telemetry_text(&error),
            }),
        );
    } else {
        let activity = if status == "done" {
            "completed task"
        } else if title.is_some() {
            "named task"
        } else if !changed_files.is_empty() {
            "changed files"
        } else {
            "updated task"
        };
        let detail = title.unwrap_or(brief);
        let _ = cloud_mcp_workspace_log(
            working_directory,
            match activity {
                "completed task" => "cloud_mcp.task.completed",
                "named task" => "cloud_mcp.task.named",
                "changed files" => "cloud_mcp.task.changed_files",
                _ => "cloud_mcp.task.updated",
            },
            "",
            "",
            json!({
                "activity": activity,
                "detail": clean_terminal_telemetry_text(detail),
                "agent_id": clean_terminal_telemetry_text(agent_id),
                "pane_id": pane_id.map(clean_terminal_telemetry_text),
                "task_id": clean_terminal_telemetry_text(task_id),
                "status": status,
                "title_source": title_source,
                "changed_file_count": changed_files.len(),
            }),
        );
    }
}

pub(crate) async fn cloud_mcp_mark_terminal_task_lifecycle(
    state: &CloudMcpState,
    pane_id: &str,
    instance_id: u64,
    working_directory: &Path,
    coordination: Option<&TerminalCoordinationSession>,
    local_task_id: Option<&str>,
    title: Option<&str>,
    status: &str,
    lane: &str,
    brief: &str,
) -> Option<String> {
    if cloud_mcp_connected_or_connect(state, "terminal_task_lifecycle").await.is_err() {
        return None;
    }

    let agent_id = cloud_mcp_terminal_agent_id(pane_id, instance_id, coordination);
    let repo_id = cloud_mcp_terminal_repo_id(working_directory, coordination);
    let terminal_key = cloud_mcp_terminal_key(pane_id, instance_id);
    let mut context_task_id = {
        let runtime = state.inner.lock().await;
        runtime
            .terminal_contexts
            .get(&terminal_key)
            .and_then(|entry| entry.context_task_id.clone())
    };

    if context_task_id.is_none() {
        if let Some(local_task_id) = local_task_id {
            context_task_id = cloud_mcp_sync_terminal_context_task_from_cloud(
                state,
                &repo_id,
                &agent_id,
                lane,
                pane_id,
                instance_id,
                working_directory,
                Some(local_task_id),
            )
            .await;
        }
    }

    if context_task_id.is_none() {
        let payload = json!({
            "source": "rust-diffforge-terminal",
            "repo_id": repo_id.clone(),
            "run_id": local_task_id,
            "agent_id": agent_id.clone(),
            "self_agent_id": agent_id.clone(),
            "current_agent_id": agent_id.clone(),
            "title": title.unwrap_or("Terminal task"),
            "body": brief,
            "status": status,
            "lane": lane,
            "metadata": {
                "terminal_id": pane_id,
                "terminal_instance_id": instance_id,
                "workspace_root": workspace_path_display(working_directory),
                "session_id": coordination.map(|coordination| coordination.session_id.clone()),
                "local_coordination_task_id": local_task_id,
                "coordination_task_id": local_task_id,
                "managed_by": "rust-diffforge",
                "title_source": "rust_lifecycle",
            },
            "ts_ms": cloud_mcp_now_ms(),
        });
        if let Ok(response) = cloud_mcp_post_json_endpoint(state, "/v1/context/tasks", &payload).await {
            let data = cloud_mcp_response_data(&response);
            context_task_id = data["task"]["id"].as_str().map(str::to_string);
        }
    }

    if let Some(task_id) = context_task_id.as_deref() {
        cloud_mcp_update_terminal_context_task(
            state,
            &repo_id,
            &agent_id,
            task_id,
            status,
            lane,
            title,
            Some("rust_lifecycle"),
            brief,
            &[],
            working_directory,
            Some(pane_id),
        )
        .await;
        let mut runtime = state.inner.lock().await;
        if let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) {
            entry.context_task_id = Some(task_id.to_string());
            entry.lane = lane.to_string();
        }
    }

    context_task_id
}

async fn cloud_mcp_sync_terminal_context_task_from_cloud(
    state: &CloudMcpState,
    repo_id: &str,
    agent_id: &str,
    lane: &str,
    pane_id: &str,
    instance_id: u64,
    working_directory: &Path,
    local_task_id: Option<&str>,
) -> Option<String> {
    let payload = json!({
        "source": "rust-diffforge-terminal-sync",
        "repo_id": repo_id,
        "agent_id": agent_id,
        "self_agent_id": agent_id,
        "current_agent_id": agent_id,
        "terminal_id": pane_id,
        "terminal_instance_id": instance_id,
        "workspace_root": workspace_path_display(working_directory),
        "prompt": "",
        "record_prompt": false,
        "history_limit": 20,
        "task_limit": 100,
        "agent_limit": 50,
        "metadata": {
            "local_coordination_task_id": local_task_id,
            "sync_reason": "confirm_cloud_received_agent_task",
        },
        "ts_ms": cloud_mcp_now_ms(),
    });
    let response = match cloud_mcp_post_json_endpoint(state, "/v1/context/pack", &payload).await {
        Ok(response) => response,
        Err(error) => {
            let _ = cloud_mcp_workspace_log(
                working_directory,
                "cloud_mcp.task.sync_error",
                "",
                "",
                json!({
                    "activity": "sync task from cloud failed",
                    "agent_id": clean_terminal_telemetry_text(agent_id),
                    "pane_id": clean_terminal_telemetry_text(pane_id),
                    "repo_id": clean_terminal_telemetry_text(repo_id),
                    "local_task_id": local_task_id.map(clean_terminal_telemetry_text),
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );
            return None;
        }
    };
    let data = cloud_mcp_response_data(&response);
    let tasks = data["snapshot"]["tasks"].as_array()?;
    let task = cloud_mcp_select_synced_context_task(tasks, agent_id, local_task_id)?;
    let task_id = task["id"].as_str()?.to_string();
    let task_title = task["title"].as_str().unwrap_or("Cloud task").to_string();
    let task_status = task["status"].as_str().unwrap_or("active").to_string();
    let _ = cloud_mcp_workspace_log(
        working_directory,
        "cloud_mcp.task.synced_from_cloud",
        "",
        "",
        json!({
            "activity": "synced task from cloud",
            "detail": clean_terminal_telemetry_text(&task_title),
            "agent_id": clean_terminal_telemetry_text(agent_id),
            "pane_id": clean_terminal_telemetry_text(pane_id),
            "repo_id": clean_terminal_telemetry_text(repo_id),
            "task_id": clean_terminal_telemetry_text(&task_id),
            "local_task_id": local_task_id.map(clean_terminal_telemetry_text),
            "status": task_status,
            "lane": lane,
        }),
    );
    Some(task_id)
}

fn cloud_mcp_select_synced_context_task(
    tasks: &[Value],
    agent_id: &str,
    local_task_id: Option<&str>,
) -> Option<Value> {
    if let Some(local_task_id) = local_task_id.filter(|value| !value.trim().is_empty()) {
        if let Some(task) = tasks
            .iter()
            .find(|task| cloud_mcp_context_task_matches_local_task(task, local_task_id))
        {
            return Some(task.clone());
        }
    }

    tasks
        .iter()
        .find(|task| {
            task["agent_id"].as_str() == Some(agent_id)
                && matches!(
                    task["status"].as_str().unwrap_or(""),
                    "todo" | "active" | "blocked" | "review"
                )
        })
        .cloned()
}

fn cloud_mcp_context_task_matches_local_task(task: &Value, local_task_id: &str) -> bool {
    if task["run_id"].as_str() == Some(local_task_id) {
        return true;
    }
    let Some(metadata_text) = task["metadata_json"].as_str() else {
        return false;
    };
    let Ok(metadata) = serde_json::from_str::<Value>(metadata_text) else {
        return false;
    };
    metadata["local_coordination_task_id"].as_str() == Some(local_task_id)
        || metadata["coordination_task_id"].as_str() == Some(local_task_id)
}

fn cloud_mcp_terminal_output_looks_active(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    text.contains('•')
        || lower.contains("called ")
        || lower.contains("ran ")
        || lower.contains("edited ")
        || lower.contains("created ")
        || lower.contains("updated ")
        || lower.contains("modified ")
        || lower.contains("i'll ")
        || lower.contains("i’ll ")
        || lower.contains("i will ")
        || lower.contains("i'm ")
        || lower.contains("i’m ")
        || lower.contains("i am ")
        || lower.contains("context refresh")
}

fn cloud_mcp_terminal_output_looks_ready(text: &str) -> bool {
    text.contains("\n›")
        || text.contains("\r›")
        || text.contains("› ")
        || text.contains("\n> ")
        || text.contains("\r> ")
}

async fn cloud_mcp_observe_terminal_output(
    state: CloudMcpState,
    pane_id: &str,
    instance_id: u64,
    chunk: &[u8],
) {
    let text = String::from_utf8_lossy(chunk);
    if !cloud_mcp_terminal_output_looks_active(&text) && !cloud_mcp_terminal_output_looks_ready(&text) {
        return;
    }

    let terminal_key = cloud_mcp_terminal_key(pane_id, instance_id);
    let work_brief = cloud_mcp_extract_agent_work_brief(&text);
    let (work_update, completion) = {
        let mut runtime = state.inner.lock().await;
        let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) else {
            return;
        };
        if cloud_mcp_terminal_output_looks_active(&text) {
            entry.saw_agent_activity = true;
        }
        let work_update = if let Some(brief) = work_brief.clone() {
            if !entry.work_brief_reported && entry.work_brief.trim().is_empty() {
                entry.work_brief = brief.clone();
            }
            if entry.work_brief_reported {
                None
            } else if let Some(task_id) = entry.context_task_id.clone() {
                entry.work_brief_reported = true;
                Some((
                    task_id,
                    entry.repo_id.clone(),
                    entry.agent_id.clone(),
                    entry.lane.clone(),
                    brief,
                    entry.working_directory.clone(),
                ))
            } else {
                None
            }
        } else {
            None
        };
        let old_enough = cloud_mcp_now_ms().saturating_sub(entry.created_ms) >= 5_000;
        let completion = if entry.saw_agent_activity
            && !entry.done_reported
            && old_enough
            && cloud_mcp_terminal_output_looks_ready(&text)
            && entry.context_task_id.is_some()
        {
            entry.done_reported = true;
            entry.context_task_id.clone().map(|task_id| {
                (
                    task_id,
                    entry.repo_id.clone(),
                    entry.agent_id.clone(),
                    entry.lane.clone(),
                    entry.last_prompt.clone(),
                    entry.work_brief.clone(),
                    entry.working_directory.clone(),
                )
            })
        } else {
            None
        };
        (work_update, completion)
    };

    if let Some((task_id, repo_id, agent_id, lane, brief, working_directory)) = work_update {
        let title = cloud_mcp_work_title_from_brief(&brief);
        cloud_mcp_update_terminal_context_task(
            &state,
            &repo_id,
            &agent_id,
            &task_id,
            "active",
            &lane,
            Some(&title),
            Some("terminal_status"),
            &brief,
            &[],
            &working_directory,
            Some(pane_id),
        )
        .await;
    }

    let Some((task_id, repo_id, agent_id, lane, _prompt, work_brief, working_directory)) = completion else {
        return;
    };
    let scan_root = working_directory.clone();
    let changed_files = match tauri::async_runtime::spawn_blocking(move || {
        cloud_mcp_git_changed_files(&scan_root)
    })
    .await
    {
        Ok(files) => files,
        Err(_) => Vec::new(),
    };
    let brief = format!(
        "Ready for patch submission: {}",
        cloud_mcp_work_subject(&work_brief)
    );
    cloud_mcp_update_terminal_context_task(
        &state,
        &repo_id,
        &agent_id,
        &task_id,
        "review",
        &lane,
        None,
        None,
        &brief,
        &changed_files,
        &working_directory,
        Some(pane_id),
    )
    .await;
    let _ = cloud_mcp_workspace_log(
        &working_directory,
        "cloud_mcp.context_pack.task_review",
        "",
        "",
        json!({
            "agent_id": clean_terminal_telemetry_text(&agent_id),
            "pane_id": clean_terminal_telemetry_text(pane_id),
            "instance_id": instance_id,
            "repo_id": clean_terminal_telemetry_text(&repo_id),
            "task_id": clean_terminal_telemetry_text(&task_id),
            "source": "terminal_prompt_ready",
            "status": "review",
            "completion_gate": "submit_patch_required",
            "changed_file_count": changed_files.len(),
        }),
    );

    let mut runtime = state.inner.lock().await;
    runtime.terminal_contexts.remove(&terminal_key);
}

async fn cloud_mcp_terminal_context_pack_for_prompt(
    state: CloudMcpState,
    pane_id: String,
    instance_id: u64,
    working_directory: PathBuf,
    coordination: Option<TerminalCoordinationSession>,
    local_task_id: Option<String>,
    local_task_title: Option<String>,
    prompt: String,
) {
    let prompt = cloud_mcp_clean_prompt_text(&prompt);
    if prompt.trim().is_empty() {
        return;
    }
    let started_at = Instant::now();
    let agent_id = cloud_mcp_terminal_agent_id(&pane_id, instance_id, coordination.as_ref());
    let repo_id = cloud_mcp_terminal_repo_id(&working_directory, coordination.as_ref());
    let terminal_key = cloud_mcp_terminal_key(&pane_id, instance_id);
    {
        let mut runtime = state.inner.lock().await;
        runtime.terminal_contexts.insert(
            terminal_key.clone(),
            CloudMcpTerminalContextState {
                last_prompt: prompt.clone(),
                repo_id: repo_id.clone(),
                agent_id: agent_id.clone(),
                lane: String::new(),
                working_directory: working_directory.clone(),
                created_ms: cloud_mcp_now_ms(),
                last_changed_hash: String::new(),
                last_checkpoint_ms: 0,
                context_task_id: None,
                local_task_id: local_task_id.clone(),
                reported_change: false,
                stable_change_cycles: 0,
                saw_agent_activity: false,
                work_brief: String::new(),
                work_brief_reported: false,
                done_reported: false,
            },
        );
    }

    if let Err(error) = cloud_mcp_connected_or_connect(&state, "terminal_context_pack").await {
        let _ = cloud_mcp_workspace_log(
            &working_directory,
            "cloud_mcp.context_pack.error",
            "",
            "",
            json!({
                "agent_id": agent_id,
                "pane_id": pane_id,
                "instance_id": instance_id,
                "error": clean_terminal_telemetry_text(&error),
            }),
        );
        return;
    }

    let payload = json!({
        "source": "rust-diffforge-terminal",
        "repo_id": repo_id,
        "agent_id": agent_id,
        "self_agent_id": agent_id,
        "current_agent_id": agent_id,
        "terminal_id": pane_id,
        "terminal_instance_id": instance_id,
        "prompt": prompt,
        "record_prompt": true,
        "workspace_root": workspace_path_display(&working_directory),
        "coordination": coordination.as_ref().map(|coordination| json!({
            "agent_id": coordination.agent_id.clone(),
            "session_id": coordination.session_id.clone(),
            "repo_path": coordination.repo_path.clone(),
            "local_task_id": local_task_id.clone(),
            "local_task_title": local_task_title.clone(),
        })),
        "ts_ms": cloud_mcp_now_ms(),
    });

    match cloud_mcp_post_json_endpoint(&state, "/v1/context/pack", &payload).await {
        Ok(response) => {
            let data = cloud_mcp_response_data(&response);
            let suggested_lane = data["suggested_lane"].as_str().unwrap_or_default().to_string();
            let active_agent_count = data["snapshot"]["active_agents"]
                .as_array()
                .map(Vec::len)
                .unwrap_or(0);
            let lane_conflict_count = data["lane_conflicts"]
                .as_array()
                .map(Vec::len)
                .unwrap_or(0);
            let _ = cloud_mcp_workspace_log(
                &working_directory,
                "cloud_mcp.context_pack.prompt_started",
                "",
                "",
                json!({
                    "agent_id": agent_id,
                    "pane_id": pane_id,
                    "instance_id": instance_id,
                    "repo_id": repo_id,
                    "suggested_lane": suggested_lane,
                    "active_agent_count": active_agent_count,
                    "lane_conflict_count": lane_conflict_count,
                    "elapsed_ms": started_at.elapsed().as_secs_f64() * 1000.0,
                }),
            );
            let context_task_id = {
                let mut runtime = state.inner.lock().await;
                if let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) {
                    entry.lane = suggested_lane.clone();
                    entry.context_task_id.clone()
                } else {
                    None
                }
            };
            let context_task_id = if context_task_id.is_some() {
                context_task_id
            } else {
                cloud_mcp_sync_terminal_context_task_from_cloud(
                    &state,
                    &repo_id,
                    &agent_id,
                    &suggested_lane,
                    &pane_id,
                    instance_id,
                    &working_directory,
                    local_task_id.as_deref(),
                )
                .await
            };
            if let Some(context_task_id) = context_task_id {
                let pending_work_brief = {
                    let mut runtime = state.inner.lock().await;
                    if let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) {
                        entry.context_task_id = Some(context_task_id.clone());
                        entry.lane = suggested_lane.clone();
                        if !entry.work_brief_reported && !entry.work_brief.trim().is_empty() {
                            entry.work_brief_reported = true;
                            Some(entry.work_brief.clone())
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                };
                if let Some(brief) = pending_work_brief {
                    let title = cloud_mcp_work_title_from_brief(&brief);
                    cloud_mcp_update_terminal_context_task(
                        &state,
                        &repo_id,
                        &agent_id,
                        &context_task_id,
                        "active",
                        &suggested_lane,
                        Some(&title),
                        Some("terminal_status"),
                        &brief,
                        &[],
                        &working_directory,
                        Some(&pane_id),
                    )
                    .await;
                }
            }
            cloud_mcp_claim_terminal_lane(
                &state,
                &repo_id,
                &agent_id,
                &suggested_lane,
                payload["prompt"].as_str().unwrap_or_default(),
                &working_directory,
                coordination.as_ref(),
            )
            .await;
            let tracker_state = state.clone();
            tauri::async_runtime::spawn(async move {
                cloud_mcp_track_terminal_file_changes(
                    tracker_state,
                    terminal_key,
                    pane_id,
                    instance_id,
                    working_directory,
                    coordination,
                    repo_id,
                    agent_id,
                    suggested_lane,
                )
                .await;
            });
        }
        Err(error) => {
            let _ = cloud_mcp_workspace_log(
                &working_directory,
                "cloud_mcp.context_pack.prompt_error",
                "",
                "",
                json!({
                    "agent_id": agent_id,
                    "pane_id": pane_id,
                    "instance_id": instance_id,
                    "repo_id": repo_id,
                    "error": clean_terminal_telemetry_text(&error),
                    "elapsed_ms": started_at.elapsed().as_secs_f64() * 1000.0,
                }),
            );
        }
    }
}

async fn cloud_mcp_track_terminal_file_changes(
    state: CloudMcpState,
    terminal_key: String,
    pane_id: String,
    instance_id: u64,
    working_directory: PathBuf,
    coordination: Option<TerminalCoordinationSession>,
    repo_id: String,
    agent_id: String,
    lane: String,
) {
    for _ in 0..40 {
        tokio::time::sleep(Duration::from_secs(8)).await;
        let local_task_id_for_sync = {
            let runtime = state.inner.lock().await;
            runtime
                .terminal_contexts
                .get(&terminal_key)
                .and_then(|entry| {
                    if entry.context_task_id.is_none() {
                        entry.local_task_id.clone()
                    } else {
                        None
                    }
                })
        };
        if let Some(local_task_id) = local_task_id_for_sync.as_deref() {
            if let Some(task_id) = cloud_mcp_sync_terminal_context_task_from_cloud(
                &state,
                &repo_id,
                &agent_id,
                &lane,
                &pane_id,
                instance_id,
                &working_directory,
                Some(local_task_id),
            )
            .await
            {
                let mut runtime = state.inner.lock().await;
                if let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) {
                    entry.context_task_id = Some(task_id);
                    if entry.lane.trim().is_empty() {
                        entry.lane = lane.clone();
                    }
                }
            }
        }
        let scan_root = working_directory.clone();
        let changed_files = match tauri::async_runtime::spawn_blocking(move || {
            cloud_mcp_git_changed_files(&scan_root)
        })
        .await
        {
            Ok(files) => files,
            Err(_) => Vec::new(),
        };
        let changed_hash = if changed_files.is_empty() {
            String::new()
        } else {
            cloud_mcp_short_hash(&serde_json::to_string(&changed_files).unwrap_or_default())
        };
        let Some((should_report, should_complete, context_task_id, work_brief)) = ({
            let mut runtime = state.inner.lock().await;
            if let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) {
                let context_task_id = entry.context_task_id.clone();
                let work_brief = entry.work_brief.clone();
                if changed_hash.is_empty() {
                    entry.last_changed_hash.clear();
                    entry.stable_change_cycles = 0;
                    Some((false, false, context_task_id, work_brief))
                } else if entry.last_changed_hash == changed_hash {
                    if entry.reported_change {
                        entry.stable_change_cycles = entry.stable_change_cycles.saturating_add(1);
                    }
                    Some((
                        false,
                        entry.reported_change && !entry.done_reported && entry.stable_change_cycles >= 4,
                        context_task_id,
                        work_brief,
                    ))
                } else {
                    entry.last_changed_hash = changed_hash.clone();
                    entry.last_checkpoint_ms = cloud_mcp_now_ms();
                    entry.reported_change = true;
                    entry.stable_change_cycles = 0;
                    Some((true, false, context_task_id, work_brief))
                }
            } else {
                None
            }
        }) else {
            break;
        };
        let work_subject = cloud_mcp_work_subject(&work_brief);
        let fallback_title = if work_brief.trim().is_empty() {
            cloud_mcp_title_from_changed_files(&changed_files)
        } else {
            None
        };
        if should_complete {
            if let Some(task_id) = context_task_id.as_deref() {
                let brief = format!(
                    "Ready for patch submission: {}",
                    fallback_title.as_deref().unwrap_or(&work_subject)
                );
                cloud_mcp_update_terminal_context_task(
                    &state,
                    &repo_id,
                    &agent_id,
                    task_id,
                    "review",
                    &lane,
                    fallback_title.as_deref(),
                    fallback_title.as_deref().map(|_| "file_change_fallback"),
                    &brief,
                    &changed_files,
                    &working_directory,
                    Some(&pane_id),
                )
                .await;
                let _ = cloud_mcp_workspace_log(
                    &working_directory,
                    "cloud_mcp.context_pack.task_review",
                    "",
                    "",
                    json!({
                        "agent_id": agent_id,
                        "pane_id": pane_id,
                        "instance_id": instance_id,
                        "repo_id": repo_id,
                        "task_id": task_id,
                        "status": "review",
                        "completion_gate": "submit_patch_required",
                        "changed_file_count": changed_files.len(),
                    }),
                );
            }
            let mut runtime = state.inner.lock().await;
            if let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) {
                entry.done_reported = true;
            }
            runtime.terminal_contexts.remove(&terminal_key);
            break;
        }
        if !should_report {
            continue;
        }
        if cloud_mcp_connected_or_connect(&state, "terminal_subtask_checkpoint").await.is_err() {
            continue;
        }
        let brief = format!(
            "Updated {} file(s) while working on: {}",
            changed_files.len(),
            fallback_title.as_deref().unwrap_or(&work_subject)
        );
        let payload = json!({
            "source": "rust-diffforge-terminal",
            "repo_id": repo_id,
            "agent_id": agent_id,
            "self_agent_id": agent_id,
            "current_agent_id": agent_id,
            "terminal_id": pane_id,
            "terminal_instance_id": instance_id,
            "task_id": context_task_id,
            "subtask": work_subject,
            "brief": brief,
            "changed_files": changed_files,
            "agent_status": "active",
            "workspace_root": workspace_path_display(&working_directory),
            "metadata": {
                "session_id": coordination.as_ref().map(|coordination| coordination.session_id.clone()),
                "change_hash": changed_hash,
            },
            "ts_ms": cloud_mcp_now_ms(),
        });
        match cloud_mcp_post_json_endpoint(&state, "/v1/context/subtasks/checkpoint", &payload).await {
            Ok(response) => {
                if let Some(task_id) = payload["task_id"].as_str() {
                    cloud_mcp_update_terminal_context_task(
                        &state,
                        &repo_id,
                        &agent_id,
                        task_id,
                        "active",
                        &lane,
                        fallback_title.as_deref(),
                        fallback_title.as_deref().map(|_| "file_change_fallback"),
                        &brief,
                        payload["changed_files"].as_array().map(Vec::as_slice).unwrap_or(&[]),
                        &working_directory,
                        Some(&pane_id),
                    )
                    .await;
                }
                let data = cloud_mcp_response_data(&response);
                let other_agent_count = data["other_agents"].as_array().map(Vec::len).unwrap_or(0);
                let lane_conflict_count = data["lane_conflicts"].as_array().map(Vec::len).unwrap_or(0);
                let _ = cloud_mcp_workspace_log(
                    &working_directory,
                    "cloud_mcp.context_pack.subtask_checkpoint",
                    "",
                    "",
                    json!({
                        "agent_id": agent_id,
                        "pane_id": pane_id,
                        "instance_id": instance_id,
                        "repo_id": repo_id,
                        "changed_file_count": payload["changed_files"].as_array().map(Vec::len).unwrap_or(0),
                        "other_agent_count": other_agent_count,
                        "lane_conflict_count": lane_conflict_count,
                    }),
                );
            }
            Err(error) => {
                let _ = cloud_mcp_workspace_log(
                    &working_directory,
                    "cloud_mcp.context_pack.subtask_checkpoint_error",
                    "",
                    "",
                    json!({
                        "agent_id": agent_id,
                        "pane_id": pane_id,
                        "instance_id": instance_id,
                        "repo_id": repo_id,
                        "error": clean_terminal_telemetry_text(&error),
                    }),
                );
            }
        }
    }
}

async fn require_cloud_mcp_terminal_gate(
    state: &CloudMcpState,
    working_directory: Option<&str>,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
) -> Result<CloudMcpStatus, String> {
    let _ = working_directory;
    let _ = workspace_id;
    let _ = workspace_name;
    Ok(cloud_mcp_status_snapshot(state).await)
}

async fn require_cloud_mcp_terminal_gate_for_path(
    state: &CloudMcpState,
    working_directory: &Path,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
) -> Result<CloudMcpStatus, String> {
    require_cloud_mcp_terminal_gate(
        state,
        Some(&workspace_path_display(working_directory)),
        workspace_id,
        workspace_name,
    )
    .await
}

#[tauri::command]
async fn cloud_mcp_connect(state: State<'_, CloudMcpState>) -> Result<CloudMcpStatus, String> {
    cloud_mcp_connect_state(state.inner(), "manual").await
}

#[tauri::command]
async fn cloud_mcp_get_status(state: State<'_, CloudMcpState>) -> Result<CloudMcpStatus, String> {
    Ok(cloud_mcp_status_snapshot(state.inner()).await)
}

#[tauri::command]
async fn cloud_mcp_register_workspace(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<CloudMcpWorkspaceRegistrationResult, String> {
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        cloud_mcp_prepare_workspace(repo_path, workspace_id, workspace_name)
    })
    .await
    .map_err(|error| format!("Unable to prepare Cloud MCP registration: {error}"))??;

    cloud_mcp_register_prepared_workspace(state.inner(), prepared, "workspace_registration").await
}

#[tauri::command]
async fn cloud_mcp_sync_workspace(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<CloudMcpWorkspaceRegistrationResult, String> {
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        cloud_mcp_prepare_workspace(repo_path, workspace_id, workspace_name)
    })
    .await
    .map_err(|error| format!("Unable to prepare Cloud MCP sync: {error}"))??;

    cloud_mcp_register_prepared_workspace(state.inner(), prepared, "workspace_sync").await
}

#[tauri::command]
async fn cloud_mcp_get_todo(
    state: State<'_, CloudMcpState>,
    repo_path: String,
) -> Result<CloudMcpTodoResult, String> {
    let root = tauri::async_runtime::spawn_blocking(move || resolve_workspace_root_directory(Some(&repo_path)))
        .await
        .map_err(|error| format!("Unable to resolve To Do Queue root: {error}"))??;
    let text = cloud_mcp_read_todo(&root)?;
    let status = cloud_mcp_status_snapshot(state.inner()).await;

    Ok(CloudMcpTodoResult {
        status,
        text,
        saved_at_ms: None,
        synced: false,
        last_error: String::new(),
    })
}

#[tauri::command]
async fn cloud_mcp_save_todo(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    text: String,
) -> Result<CloudMcpTodoResult, String> {
    let workspace_id_for_log = workspace_id.clone().unwrap_or_default();
    let workspace_name_for_log = workspace_name.clone().unwrap_or_default();
    let (root, root_display) = tauri::async_runtime::spawn_blocking(move || {
        let root = resolve_workspace_root_directory(Some(&repo_path))?;
        cloud_mcp_write_todo(&root, &text)?;
        let _ = cloud_mcp_workspace_log(
            &root,
            "cloud_mcp.todo.save",
            &workspace_id_for_log,
            &workspace_name_for_log,
            json!({ "bytes": text.len() }),
        );
        let root_display = workspace_path_display(&root);
        Ok::<_, String>((root, root_display))
    })
    .await
    .map_err(|error| format!("Unable to save To Do Queue: {error}"))??;

    let saved_at_ms = cloud_mcp_now_ms();
    let text = cloud_mcp_read_todo(&root)?;
    let mut synced = false;
    let mut last_error = String::new();

    if cloud_mcp_connected_or_connect(state.inner(), "todo_sync").await.is_ok() {
        let payload = json!({
            "source": "rust-diffforge",
            "repo_id": format!("repo-{}", cloud_mcp_short_hash(&root_display)),
            "agent_id": "rust-diffforge",
            "event_kind": "todo_queue_saved",
            "summary": "Local To Do Queue saved from rust-diffforge.",
            "payload": {
                "reason": "todo_queue_save",
                "workspace_id": workspace_id.clone(),
                "workspace_name": workspace_name.clone(),
                "repo_path": root_display.clone(),
                "workspace_root": root_display.clone(),
                "todo_queue": text.clone(),
                "ts_ms": saved_at_ms,
            }
        });

        match cloud_mcp_post_json_endpoint(state.inner(), "/v1/context/history/events", &payload).await {
            Ok(_) => synced = true,
            Err(error) => last_error = error,
        }
    } else {
        last_error = "Cloud MCP is not connected; To Do Queue was saved locally only.".to_string();
    }

    let status = cloud_mcp_status_snapshot(state.inner()).await;
    Ok(CloudMcpTodoResult {
        status,
        text,
        saved_at_ms: Some(saved_at_ms),
        synced,
        last_error,
    })
}

#[tauri::command]
async fn cloud_mcp_get_activity(repo_path: String) -> Result<Value, String> {
    let root = resolve_workspace_root_directory(Some(&repo_path)).unwrap_or_else(|_| PathBuf::from(&repo_path));
    let log_path = root
        .join(".agents")
        .join("cloud-mcp")
        .join("cloud-mcp.jsonl");

    let mut entries: Vec<Value> = Vec::new();
    if let Ok(file) = fs::File::open(&log_path) {
        use std::io::BufRead as _;
        let reader = std::io::BufReader::new(file);
        for line in reader.lines().flatten() {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                entries.push(value);
            }
        }
    }

    let total = entries.len();
    if entries.len() > 60 {
        entries = entries.split_off(entries.len() - 60);
    }
    entries.reverse();

    Ok(json!({
        "ok": true,
        "repoPath": root.to_string_lossy(),
        "logPath": log_path.to_string_lossy(),
        "total": total,
        "entries": entries
    }))
}

#[tauri::command]
async fn cloud_mcp_get_kanban(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    let root = resolve_workspace_root_directory(Some(&repo_path)).unwrap_or_else(|_| PathBuf::from(&repo_path));
    let root_display = workspace_path_display(&root);
    let repo_id = cloud_mcp_repo_id_for_root(&root);

    cloud_mcp_connected_or_connect(state.inner(), "kanban_sync").await?;

    let payload = json!({
        "source": "rust-diffforge-kanban",
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "repo_id": repo_id,
        "agent_id": "rust-diffforge",
        "self_agent_id": "rust-diffforge",
        "current_agent_id": "rust-diffforge",
        "repo_path": root_display.clone(),
        "workspace_root": root_display.clone(),
        "workspace_id": workspace_id.clone(),
        "workspace_name": workspace_name.clone(),
        "prompt": "",
        "record_prompt": false,
        "history_limit": 40,
        "task_limit": 250,
        "agent_limit": 100,
        "ts_ms": cloud_mcp_now_ms(),
    });

    let response = cloud_mcp_post_json_endpoint(state.inner(), "/v1/context/pack", &payload).await?;
    let data = cloud_mcp_response_data(&response);
    let snapshot = data.get("snapshot").cloned().unwrap_or_else(|| data.clone());

    Ok(json!({
        "ok": true,
        "repoId": repo_id,
        "repoPath": root_display,
        "workspaceId": workspace_id,
        "workspaceName": workspace_name,
        "summary": data.get("summary").cloned().unwrap_or(Value::Null),
        "taskBoard": snapshot.get("task_board").cloned().unwrap_or_else(|| json!({})),
        "tasks": snapshot.get("tasks").cloned().unwrap_or_else(|| json!([])),
        "activeAgents": snapshot.get("active_agents").cloned().unwrap_or_else(|| json!([])),
        "laneClaims": snapshot.get("lane_claims").cloned().unwrap_or_else(|| json!([])),
        "historyLedger": snapshot.get("history_ledger").cloned().unwrap_or_else(|| json!({})),
        "sourceOfTruth": snapshot.get("source_of_truth").cloned().unwrap_or_else(|| json!({})),
        "raw": data
    }))
}

pub fn run_cloud_mcp_stdio_proxy(args: Vec<String>) -> Result<(), String> {
    let identity = CloudMcpProxyIdentity::from_args(&args);
    let base_url = identity
        .base_url
        .clone()
        .unwrap_or_else(|| CLOUD_MCP_DEFAULT_BASE_URL.to_string());

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = std::io::BufReader::new(stdin.lock());
    let mut writer = stdout.lock();

    loop {
        let Some((body, framed)) = cloud_mcp_proxy_read_message(&mut reader)? else {
            break;
        };

        let mut request = match serde_json::from_str::<Value>(&body) {
            Ok(value) => value,
            Err(error) => {
                let response = json!({
                    "jsonrpc": "2.0",
                    "id": Value::Null,
                    "error": {
                        "code": -32700,
                        "message": format!("Cloud MCP proxy could not parse JSON-RPC request: {error}")
                    }
                })
                .to_string();
                cloud_mcp_proxy_write_message(&mut writer, &response, framed)?;
                continue;
            }
        };

        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let expects_response = request.get("id").is_some();
        let tool_name = request
            .get("params")
            .and_then(|params| params.get("name"))
            .and_then(Value::as_str)
            .unwrap_or(&method)
            .to_string();

        request = cloud_mcp_proxy_enrich_request(request, &identity, &tool_name);
        if let Some(guard_detail) =
            cloud_mcp_proxy_apply_completion_guard(&mut request, &identity, &tool_name)
        {
            identity.log(
                "cloud_mcp.task.completion_guard",
                &tool_name,
                guard_detail,
            );
        }
        identity.log("cloud_mcp.tool_call.start", &tool_name, json!({
            "method": method,
            "tool": tool_name,
            "baseUrl": base_url
        }));

        match cloud_mcp_proxy_post_json(&base_url, &request.to_string()) {
            Ok(response) => {
                cloud_mcp_proxy_sync_after_task_created(&identity, &base_url, &tool_name, &response);
                identity.log("cloud_mcp.tool_call.done", &tool_name, json!({
                    "method": method,
                    "tool": tool_name,
                    "baseUrl": base_url
                }));
                if expects_response {
                    cloud_mcp_proxy_write_message(&mut writer, &response, framed)?;
                }
            }
            Err(error) => {
                identity.log("cloud_mcp.tool_call.error", &tool_name, json!({
                    "method": method,
                    "tool": tool_name,
                    "baseUrl": base_url,
                    "error": error
                }));
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                let response = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32000,
                        "message": format!("Cloud MCP proxy could not reach Cloud MCP at {base_url}/mcp: {error}")
                    }
                })
                .to_string();
                if expects_response {
                    cloud_mcp_proxy_write_message(&mut writer, &response, framed)?;
                }
            }
        }
    }

    Ok(())
}

#[derive(Clone, Debug)]
struct CloudMcpProxyIdentity {
    base_url: Option<String>,
    repo_path: Option<PathBuf>,
    repo_id: Option<String>,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    agent_id: Option<String>,
    session_id: Option<String>,
    coordination_db_path: Option<PathBuf>,
    pane_id: Option<String>,
    terminal_instance_id: Option<String>,
    slot_key: Option<String>,
    agent_label: Option<String>,
    client_id: String,
}

impl CloudMcpProxyIdentity {
    fn from_args(args: &[String]) -> Self {
        let mut values = std::collections::HashMap::<String, String>::new();
        let mut index = 0;
        while index < args.len() {
            if let Some(key) = args[index].strip_prefix("--") {
                if let Some(value) = args.get(index + 1) {
                    if !value.starts_with("--") {
                        values.insert(key.to_string(), value.to_string());
                        index += 2;
                        continue;
                    }
                }
                values.insert(key.to_string(), "true".to_string());
            }
            index += 1;
        }

        let repo_path = values
            .get("repo-path")
            .cloned()
            .or_else(|| env::var("CLOUD_MCP_REPO_PATH").ok())
            .or_else(|| env::current_dir().ok().map(|path| path.to_string_lossy().to_string()))
            .map(PathBuf::from);

        let repo_id = values
            .get("repo-id")
            .cloned()
            .or_else(|| env::var("CLOUD_MCP_REPO_ID").ok());

        let workspace_id = values
            .get("workspace-id")
            .cloned()
            .or_else(|| env::var("CLOUD_MCP_WORKSPACE_ID").ok());

        let workspace_name = values
            .get("workspace-name")
            .cloned()
            .or_else(|| env::var("CLOUD_MCP_WORKSPACE_NAME").ok());

        let agent_id = values
            .get("agent-id")
            .cloned()
            .or_else(|| env::var("CLOUD_MCP_AGENT_ID").ok())
            .or_else(|| env::var("DIFFFORGE_AGENT_ID").ok())
            .or_else(|| env::var("COORDINATION_AGENT_ID").ok());

        let session_id = values
            .get("session-id")
            .cloned()
            .or_else(|| env::var("CLOUD_MCP_SESSION_ID").ok())
            .or_else(|| env::var("DIFFFORGE_SESSION_ID").ok());

        let coordination_db_path = values
            .get("db-path")
            .cloned()
            .or_else(|| env::var("COORDINATION_DB_PATH").ok())
            .map(PathBuf::from);

        let pane_id = values
            .get("pane-id")
            .cloned()
            .or_else(|| env::var("CLOUD_MCP_PANE_ID").ok())
            .or_else(|| env::var("DIFFFORGE_PANE_ID").ok());

        let terminal_instance_id = values
            .get("terminal-instance-id")
            .cloned()
            .or_else(|| env::var("CLOUD_MCP_TERMINAL_INSTANCE_ID").ok())
            .or_else(|| env::var("DIFFFORGE_TERMINAL_INSTANCE_ID").ok());

        let slot_key = values
            .get("slot-key")
            .cloned()
            .or_else(|| env::var("COORDINATION_SLOT_KEY").ok())
            .or_else(|| env::var("CLOUD_MCP_SLOT_KEY").ok());

        let agent_label = values
            .get("agent-label")
            .cloned()
            .or_else(|| env::var("CLOUD_MCP_AGENT_LABEL").ok())
            .or_else(|| slot_key.as_deref().and_then(cloud_mcp_proxy_label_for_slot_key));

        let base_url = values
            .get("base-url")
            .cloned()
            .or_else(|| env::var("CLOUD_DIFFFORGE_BASE_URL").ok())
            .or_else(|| env::var("CLOUD_MCP_BASE_URL").ok());

        let client_id = values
            .get("client-id")
            .cloned()
            .or_else(|| env::var("CLOUD_MCP_CLIENT_ID").ok())
            .unwrap_or_else(|| "rust-diffforge-terminal".to_string());

        Self {
            base_url,
            repo_path,
            repo_id,
            workspace_id,
            workspace_name,
            agent_id,
            session_id,
            coordination_db_path,
            pane_id,
            terminal_instance_id,
            slot_key,
            agent_label,
            client_id,
        }
    }

    fn log(&self, phase: &str, tool_name: &str, fields: Value) {
        let Some(repo_path) = self.repo_path.as_ref() else {
            return;
        };
        let repo_path_text = repo_path.to_string_lossy().to_string();
        let root = resolve_workspace_root_directory(Some(&repo_path_text))
            .unwrap_or_else(|_| repo_path.clone());
        let mut payload = serde_json::Map::new();
        payload.insert("tool".to_string(), json!(tool_name));
        payload.insert("clientId".to_string(), json!(self.client_id));
        if let Some(repo_id) = self.repo_id.as_deref() {
            payload.insert("repoId".to_string(), json!(repo_id));
        }
        if let Some(agent_id) = self.agent_id.as_deref() {
            payload.insert("agentId".to_string(), json!(agent_id));
        }
        if let Some(session_id) = self.session_id.as_deref() {
            payload.insert("sessionId".to_string(), json!(session_id));
        }
        if let Some(pane_id) = self.pane_id.as_deref() {
            payload.insert("paneId".to_string(), json!(pane_id));
        }
        if let Some(slot_key) = self.slot_key.as_deref() {
            payload.insert("slotKey".to_string(), json!(slot_key));
        }
        if let Some(agent_label) = self.agent_label.as_deref() {
            payload.insert("agentLabel".to_string(), json!(agent_label));
        }
        if let Some(terminal_instance_id) = self.terminal_instance_id.as_deref() {
            payload.insert("terminalInstanceId".to_string(), json!(terminal_instance_id));
        }
        if let Some(extra) = fields.as_object() {
            for (key, value) in extra {
                payload.insert(key.clone(), value.clone());
            }
        }

        let _ = cloud_mcp_workspace_log(
            &root,
            phase,
            self.workspace_id.as_deref().unwrap_or(""),
            self.workspace_name.as_deref().unwrap_or(""),
            Value::Object(payload),
        );
    }
}

fn cloud_mcp_proxy_label_for_slot_key(slot_key: &str) -> Option<String> {
    let suffix = slot_key.strip_prefix("codex-")?;
    let index = suffix.parse::<u8>().ok()?;
    if index == 0 || index > 26 {
        return None;
    }
    Some(format!("CX{}", (b'A' + index - 1) as char))
}

fn cloud_mcp_proxy_sync_after_task_created(
    identity: &CloudMcpProxyIdentity,
    base_url: &str,
    tool_name: &str,
    response: &str,
) {
    if !matches!(
        tool_name,
        "cloud_create_context_task" | "cloud_update_context_task" | "cloud_get_context_pack"
    ) {
        return;
    }
    let Some(task_id) = cloud_mcp_proxy_context_task_id_from_response(response) else {
        return;
    };
    let local_task_id = cloud_mcp_proxy_sync_local_task_from_cloud(identity, response);
    identity.log("cloud_mcp.task.cloud_received", tool_name, json!({
        "activity": "cloud received task",
        "taskId": task_id,
        "localTaskId": local_task_id.as_deref(),
        "tool": tool_name,
    }));

    let mut arguments = serde_json::Map::new();
    arguments.insert("source".to_string(), json!("rust-diffforge-agent-proxy-sync"));
    arguments.insert("prompt".to_string(), json!(""));
    arguments.insert("record_prompt".to_string(), json!(false));
    arguments.insert("task_limit".to_string(), json!(100));
    arguments.insert("agent_limit".to_string(), json!(50));
    arguments.insert("client_id".to_string(), json!(identity.client_id.clone()));
    if let Some(repo_id) = identity.repo_id.as_deref() {
        arguments.insert("repo_id".to_string(), json!(repo_id));
    }
    if let Some(repo_path) = identity.repo_path.as_ref() {
        arguments.insert("repo_path".to_string(), json!(repo_path.to_string_lossy().to_string()));
        arguments.insert("workspace_root".to_string(), json!(repo_path.to_string_lossy().to_string()));
    }
    if let Some(workspace_id) = identity.workspace_id.as_deref() {
        arguments.insert("workspace_id".to_string(), json!(workspace_id));
    }
    if let Some(workspace_name) = identity.workspace_name.as_deref() {
        arguments.insert("workspace_name".to_string(), json!(workspace_name));
    }
    if let Some(agent_id) = identity.agent_id.as_deref() {
        arguments.insert("agent_id".to_string(), json!(agent_id));
        arguments.insert("self_agent_id".to_string(), json!(agent_id));
        arguments.insert("current_agent_id".to_string(), json!(agent_id));
    }
    if let Some(session_id) = identity.session_id.as_deref() {
        arguments.insert("session_id".to_string(), json!(session_id));
    }
    if let Some(slot_key) = identity.slot_key.as_deref() {
        arguments.insert("slot_key".to_string(), json!(slot_key));
    }
    if let Some(agent_label) = identity.agent_label.as_deref() {
        arguments.insert("agent_label".to_string(), json!(agent_label));
    }
    arguments.insert("confirmed_context_task_id".to_string(), json!(task_id.clone()));

    let sync_request = json!({
        "jsonrpc": "2.0",
        "id": "rust-diffforge-cloud-task-sync",
        "method": "tools/call",
        "params": {
            "name": "cloud_get_workspace_snapshot",
            "arguments": Value::Object(arguments),
        }
    });
    match cloud_mcp_proxy_post_json(base_url, &sync_request.to_string()) {
        Ok(sync_response) => {
            identity.log("cloud_mcp.task.synced_from_cloud", tool_name, json!({
                "activity": "synced task from cloud",
                "taskId": task_id,
                "localTaskId": local_task_id.as_deref(),
                "tool": tool_name,
                "confirmed": cloud_mcp_proxy_response_mentions_task(&sync_response, &task_id),
            }));
        }
        Err(error) => {
            identity.log("cloud_mcp.task.sync_error", tool_name, json!({
                "activity": "sync task from cloud failed",
                "taskId": task_id,
                "tool": tool_name,
                "error": error,
            }));
        }
    }
}

fn cloud_mcp_proxy_context_task_id_from_response(response: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(response).ok()?;
    cloud_mcp_proxy_context_task_id_from_value(&value)
}

fn cloud_mcp_proxy_sync_local_task_from_cloud(
    identity: &CloudMcpProxyIdentity,
    response: &str,
) -> Option<String> {
    let db_path = identity.coordination_db_path.as_ref()?;
    let repo_path = identity.repo_path.as_ref()?;
    let agent_id = identity.agent_id.as_deref()?;
    let session_id = identity.session_id.as_deref()?;
    let cloud_task = serde_json::from_str::<Value>(response)
        .ok()
        .and_then(|value| cloud_mcp_proxy_context_task_from_value(&value))?;
    let title = cloud_task["title"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Cloud MCP task");
    let body = cloud_task["body"]
        .as_str()
        .or_else(|| cloud_task["description"].as_str())
        .or_else(|| cloud_task["source_prompt"].as_str());
    let lane = cloud_task["lane"]
        .as_str()
        .or_else(|| cloud_task["status_lane"].as_str());
    let cloud_task_id = cloud_task["id"].as_str();
    let risk_level = cloud_task["risk_level"].as_i64().unwrap_or(1);
    let kernel = crate::coordination::CoordinationKernel::open(repo_path, Some(db_path.clone())).ok()?;
    if let Some(existing) = cloud_mcp_proxy_current_local_task_id(identity) {
        let _ = kernel.sync_task_cloud_context(&existing, cloud_task_id, Some(title), body, lane);
        return Some(existing);
    }
    let task = kernel
        .create_task(
            title,
            body,
            0,
            risk_level,
            cloud_task_id,
            None,
            lane.or(Some("cloud-mcp")),
            Some("Synced from Cloud MCP context task for local lease coordination."),
        )
        .ok()?;
    let task_id = task["id"].as_str()?.to_string();
    if kernel.claim_task(&task_id, agent_id, session_id).is_err() {
        return None;
    }
    Some(task_id)
}

fn cloud_mcp_proxy_context_task_from_value(value: &Value) -> Option<Value> {
    if value["data"]["task"].is_object() {
        return Some(value["data"]["task"].clone());
    }
    if value["task"].is_object() {
        return Some(value["task"].clone());
    }
    if value["task_sync"]["task"].is_object() {
        return Some(value["task_sync"]["task"].clone());
    }
    if value["result"]["data"]["task"].is_object() {
        return Some(value["result"]["data"]["task"].clone());
    }
    if value["result"]["task"].is_object() {
        return Some(value["result"]["task"].clone());
    }
    if let Some(content) = value["result"]["content"].as_array() {
        for item in content {
            let Some(text) = item["text"].as_str() else {
                continue;
            };
            if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                if let Some(task) = cloud_mcp_proxy_context_task_from_value(&parsed) {
                    return Some(task);
                }
            }
        }
    }
    None
}

fn cloud_mcp_proxy_context_task_id_from_value(value: &Value) -> Option<String> {
    if let Some(task) = cloud_mcp_proxy_context_task_from_value(value) {
        if let Some(task_id) = task["id"].as_str() {
            return Some(task_id.to_string());
        }
    }
    if let Some(task_id) = value["data"]["task"]["id"].as_str() {
        return Some(task_id.to_string());
    }
    if let Some(task_id) = value["task"]["id"].as_str() {
        return Some(task_id.to_string());
    }
    if let Some(task_id) = value["task_sync"]["task"]["id"].as_str() {
        return Some(task_id.to_string());
    }
    if let Some(task_id) = value["result"]["data"]["task"]["id"].as_str() {
        return Some(task_id.to_string());
    }
    if let Some(task_id) = value["result"]["task"]["id"].as_str() {
        return Some(task_id.to_string());
    }
    if let Some(content) = value["result"]["content"].as_array() {
        for item in content {
            let Some(text) = item["text"].as_str() else {
                continue;
            };
            if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                if let Some(task_id) = cloud_mcp_proxy_context_task_id_from_value(&parsed) {
                    return Some(task_id);
                }
            }
        }
    }
    None
}

fn cloud_mcp_proxy_response_mentions_task(response: &str, task_id: &str) -> bool {
    response.contains(task_id)
}

fn cloud_mcp_proxy_read_message<R: std::io::BufRead>(
    reader: &mut R,
) -> Result<Option<(String, bool)>, String> {
    use std::io::Read as _;

    let mut first_line = String::new();
    let bytes = reader
        .read_line(&mut first_line)
        .map_err(|error| format!("failed to read MCP stdin: {error}"))?;
    if bytes == 0 {
        return Ok(None);
    }
    if first_line.trim().is_empty() {
        return cloud_mcp_proxy_read_message(reader);
    }

    if !first_line.to_ascii_lowercase().starts_with("content-length:") {
        return Ok(Some((first_line, false)));
    }

    let mut content_length = first_line
        .split_once(':')
        .and_then(|(_, value)| value.trim().parse::<usize>().ok())
        .ok_or_else(|| "invalid MCP Content-Length header".to_string())?;

    loop {
        let mut header = String::new();
        reader
            .read_line(&mut header)
            .map_err(|error| format!("failed to read MCP header: {error}"))?;
        let trimmed = header.trim();
        if trimmed.is_empty() {
            break;
        }
        if trimmed.to_ascii_lowercase().starts_with("content-length:") {
            if let Some(length) = trimmed
                .split_once(':')
                .and_then(|(_, value)| value.trim().parse::<usize>().ok())
            {
                content_length = length;
            }
        }
    }

    let mut body = vec![0_u8; content_length];
    reader
        .read_exact(&mut body)
        .map_err(|error| format!("failed to read MCP body: {error}"))?;
    let body = String::from_utf8(body).map_err(|error| format!("invalid MCP UTF-8 body: {error}"))?;
    Ok(Some((body, true)))
}

fn cloud_mcp_proxy_write_message<W: std::io::Write>(
    writer: &mut W,
    body: &str,
    framed: bool,
) -> Result<(), String> {
    if framed {
        write!(writer, "Content-Length: {}\r\n\r\n{}", body.as_bytes().len(), body)
            .map_err(|error| format!("failed to write MCP response: {error}"))?;
    } else {
        writeln!(writer, "{body}").map_err(|error| format!("failed to write MCP response: {error}"))?;
    }
    writer
        .flush()
        .map_err(|error| format!("failed to flush MCP response: {error}"))
}

fn cloud_mcp_proxy_enrich_request(
    mut request: Value,
    identity: &CloudMcpProxyIdentity,
    tool_name: &str,
) -> Value {
    if request.get("method").and_then(Value::as_str) != Some("tools/call") {
        return request;
    }

    if !request.get("params").map(Value::is_object).unwrap_or(false) {
        request["params"] = json!({});
    }

    let Some(params) = request.get_mut("params").and_then(Value::as_object_mut) else {
        return request;
    };
    let arguments = params
        .entry("arguments".to_string())
        .or_insert_with(|| json!({}));
    if !arguments.is_object() {
        *arguments = json!({});
    }

    let Some(arguments) = arguments.as_object_mut() else {
        return request;
    };

    cloud_mcp_proxy_insert_if_missing(arguments, "client_id", Some(identity.client_id.as_str()));
    cloud_mcp_proxy_insert_if_missing(arguments, "repo_id", identity.repo_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "workspace_id", identity.workspace_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "workspace_name", identity.workspace_name.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "agent_id", identity.agent_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "self_agent_id", identity.agent_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "current_agent_id", identity.agent_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "actor", identity.agent_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "session_id", identity.session_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "desktop_session_id", identity.session_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "slot_key", identity.slot_key.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "slotKey", identity.slot_key.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "agent_label", identity.agent_label.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "agentLabel", identity.agent_label.as_deref());
    if let Some(task_id) = cloud_mcp_proxy_current_local_task_id(identity) {
        cloud_mcp_proxy_insert_if_missing(arguments, "run_id", Some(task_id.as_str()));
        cloud_mcp_proxy_insert_local_task_metadata(arguments, &task_id);
    }
    cloud_mcp_proxy_insert_if_missing(arguments, "pane_id", identity.pane_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "paneId", identity.pane_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "terminal_id", identity.pane_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "terminal_instance_id", identity.terminal_instance_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "terminalInstanceId", identity.terminal_instance_id.as_deref());
    if let Some(repo_path) = identity.repo_path.as_ref() {
        let value = repo_path.to_string_lossy().to_string();
        arguments
            .entry("repo_path".to_string())
            .or_insert_with(|| json!(value));
    }
    cloud_mcp_proxy_insert_identity_metadata(arguments, identity);
    cloud_mcp_proxy_insert_empty_task_defaults(arguments, identity, tool_name);

    request
}

fn cloud_mcp_proxy_insert_identity_metadata(
    arguments: &mut serde_json::Map<String, Value>,
    identity: &CloudMcpProxyIdentity,
) {
    let metadata = arguments
        .entry("metadata".to_string())
        .or_insert_with(|| json!({}));
    if !metadata.is_object() {
        *metadata = json!({"raw_metadata": metadata.clone()});
    }
    let Some(metadata) = metadata.as_object_mut() else {
        return;
    };
    if let Some(slot_key) = identity.slot_key.as_deref() {
        metadata
            .entry("slot_key".to_string())
            .or_insert_with(|| json!(slot_key));
    }
    if let Some(agent_label) = identity.agent_label.as_deref() {
        metadata
            .entry("agent_label".to_string())
            .or_insert_with(|| json!(agent_label));
    }
}

fn cloud_mcp_proxy_insert_empty_task_defaults(
    arguments: &mut serde_json::Map<String, Value>,
    identity: &CloudMcpProxyIdentity,
    tool_name: &str,
) {
    if tool_name != "cloud_create_context_task" {
        return;
    }
    let missing_title = arguments
        .get("title")
        .and_then(Value::as_str)
        .map(|value| value.trim().is_empty())
        .unwrap_or(true);
    if !missing_title {
        return;
    }
    let Some(local_task) = cloud_mcp_proxy_current_local_task(identity) else {
        arguments
            .entry("title".to_string())
            .or_insert_with(|| json!("Agent preparing requested work"));
        arguments
            .entry("body".to_string())
            .or_insert_with(|| json!("The agent is preparing the requested work and has not named the task yet."));
        arguments
            .entry("status".to_string())
            .or_insert_with(|| json!("active"));
        return;
    };
    let title = local_task["title"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Agent preparing requested work");
    let body = local_task["body"]
        .as_str()
        .or_else(|| local_task["expected_output"].as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("The agent is preparing the requested work.");
    arguments
        .entry("title".to_string())
        .or_insert_with(|| json!(title));
    arguments
        .entry("body".to_string())
        .or_insert_with(|| json!(body));
    arguments
        .entry("status".to_string())
        .or_insert_with(|| json!("active"));
    if let Some(role) = local_task["assigned_role"].as_str().filter(|value| !value.trim().is_empty()) {
        arguments
            .entry("lane".to_string())
            .or_insert_with(|| json!(role));
    }
    if let Some(task_id) = local_task["id"].as_str().filter(|value| !value.trim().is_empty()) {
        arguments
            .entry("run_id".to_string())
            .or_insert_with(|| json!(task_id));
        cloud_mcp_proxy_insert_local_task_metadata(arguments, task_id);
    }
}

fn cloud_mcp_proxy_apply_completion_guard(
    request: &mut Value,
    identity: &CloudMcpProxyIdentity,
    tool_name: &str,
) -> Option<Value> {
    if !matches!(tool_name, "cloud_update_context_task" | "cloud_subtask_checkpoint") {
        return None;
    }
    if request.get("method").and_then(Value::as_str) != Some("tools/call") {
        return None;
    }
    let arguments = request
        .get_mut("params")
        .and_then(|params| params.get_mut("arguments"))
        .and_then(Value::as_object_mut)?;

    let status_key = if tool_name == "cloud_subtask_checkpoint" {
        if json_string_field_eq(arguments, "task_status", "done") {
            Some("task_status")
        } else if json_string_field_eq(arguments, "taskStatus", "done") {
            Some("taskStatus")
        } else {
            None
        }
    } else if json_string_field_eq(arguments, "status", "done") {
        Some("status")
    } else {
        None
    }?;

    let submission = cloud_mcp_proxy_local_patch_submission(identity);
    if submission
        .as_ref()
        .map(|submission| submission.patch_submitted)
        == Some(true)
    {
        let metadata = cloud_mcp_proxy_completion_metadata(arguments);
        metadata
            .entry("local_patch_submitted".to_string())
            .or_insert_with(|| json!(true));
        metadata
            .entry("local_patch_applied".to_string())
            .or_insert_with(|| json!(true));
        if let Some(task_id) = submission.as_ref().and_then(|value| value.task_id.as_deref()) {
            metadata
                .entry("local_coordination_task_id".to_string())
                .or_insert_with(|| json!(task_id));
        }
        if let Some(patch_id) = submission.as_ref().and_then(|value| value.patch_id.as_deref()) {
            metadata
                .entry("local_patch_id".to_string())
                .or_insert_with(|| json!(patch_id));
        }
        return Some(json!({
            "activity": "completion allowed",
            "reason": "local_patch_applied",
            "localTaskId": submission.and_then(|value| value.task_id),
        }));
    }

    arguments.insert(status_key.to_string(), json!("review"));
    let metadata = cloud_mcp_proxy_completion_metadata(arguments);
    metadata.insert("requested_status".to_string(), json!("done"));
    metadata.insert("completion_blocked_until_submit_patch".to_string(), json!(true));
    metadata.insert("completion_gate".to_string(), json!("submit_patch_required"));
    if let Some(submission) = submission {
        if let Some(task_id) = submission.task_id {
            metadata.insert("local_coordination_task_id".to_string(), json!(task_id));
        }
        if let Some(task_status) = submission.task_status {
            metadata.insert("local_task_status".to_string(), json!(task_status));
        }
    }
    Some(json!({
        "activity": "completion downgraded to review",
        "reason": "submit_patch_required",
        "tool": tool_name,
    }))
}

fn json_string_field_eq(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
    expected: &str,
) -> bool {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(|value| value.eq_ignore_ascii_case(expected))
        .unwrap_or(false)
}

fn cloud_mcp_proxy_completion_metadata(
    arguments: &mut serde_json::Map<String, Value>,
) -> &mut serde_json::Map<String, Value> {
    let metadata = arguments
        .entry("metadata".to_string())
        .or_insert_with(|| json!({}));
    if !metadata.is_object() {
        *metadata = json!({"raw_metadata": metadata.clone()});
    }
    metadata.as_object_mut().expect("metadata is object")
}

struct CloudMcpProxyPatchSubmission {
    task_id: Option<String>,
    task_status: Option<String>,
    patch_id: Option<String>,
    patch_submitted: bool,
}

fn cloud_mcp_proxy_local_patch_submission(
    identity: &CloudMcpProxyIdentity,
) -> Option<CloudMcpProxyPatchSubmission> {
    let db_path = identity.coordination_db_path.as_ref()?;
    let task_id = cloud_mcp_proxy_current_local_task_id(identity)?;
    let conn = rusqlite::Connection::open(db_path).ok()?;
    let task_status = conn
        .query_row(
            "SELECT status FROM tasks WHERE id=?1 LIMIT 1",
            [&task_id],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let patch_id = conn
        .query_row(
            "SELECT id FROM patches
             WHERE task_id=?1 AND status='merged'
             ORDER BY created_at DESC LIMIT 1",
            [&task_id],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let patch_submitted = patch_id.is_some()
        || matches!(
            task_status.as_deref(),
            Some("merged") | Some("done") | Some("completed")
        );
    Some(CloudMcpProxyPatchSubmission {
        task_id: Some(task_id),
        task_status,
        patch_id,
        patch_submitted,
    })
}

fn cloud_mcp_proxy_insert_if_missing(
    arguments: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Option<&str>,
) {
    if let Some(value) = value {
        arguments
            .entry(key.to_string())
            .or_insert_with(|| json!(value));
    }
}

fn cloud_mcp_proxy_insert_local_task_metadata(
    arguments: &mut serde_json::Map<String, Value>,
    task_id: &str,
) {
    let metadata = arguments
        .entry("metadata".to_string())
        .or_insert_with(|| json!({}));
    if !metadata.is_object() {
        *metadata = json!({"raw_metadata": metadata.clone()});
    }
    let Some(metadata) = metadata.as_object_mut() else {
        return;
    };
    metadata
        .entry("local_coordination_task_id".to_string())
        .or_insert_with(|| json!(task_id));
    metadata
        .entry("coordination_task_id".to_string())
        .or_insert_with(|| json!(task_id));
    metadata
        .entry("local_task_sync_source".to_string())
        .or_insert_with(|| json!("rust-diffforge-cloud-mcp-proxy"));
}

fn cloud_mcp_proxy_current_local_task(identity: &CloudMcpProxyIdentity) -> Option<Value> {
    let db_path = identity.coordination_db_path.as_ref()?;
    let task_id = cloud_mcp_proxy_current_local_task_id(identity)?;
    let conn = rusqlite::Connection::open(db_path).ok()?;
    conn.query_row(
        "SELECT id, title, body, status, assigned_role, expected_output, risk_level
         FROM tasks
         WHERE id=?1
         LIMIT 1",
        [&task_id],
        |row| {
            let body: Option<String> = row.get(2)?;
            let assigned_role: Option<String> = row.get(4)?;
            let expected_output: Option<String> = row.get(5)?;
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "body": body,
                "status": row.get::<_, String>(3)?,
                "assigned_role": assigned_role,
                "expected_output": expected_output,
                "risk_level": row.get::<_, i64>(6)?,
            }))
        },
    )
    .ok()
}

fn cloud_mcp_proxy_current_local_task_id(identity: &CloudMcpProxyIdentity) -> Option<String> {
    let db_path = identity.coordination_db_path.as_ref()?;
    let session_id = identity.session_id.as_ref()?;
    let conn = rusqlite::Connection::open(db_path).ok()?;
    let task_id = conn
        .query_row(
            "SELECT task_id
             FROM agent_sessions
             WHERE id=?1 AND status='active'
             ORDER BY updated_at DESC
             LIMIT 1",
            [session_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
        .or_else(|| {
            conn.query_row(
                "SELECT id
                 FROM tasks
                 WHERE claimed_session_id=?1
                   AND status NOT IN ('done', 'completed', 'merged', 'cancelled', 'skipped')
                 ORDER BY updated_at DESC
                 LIMIT 1",
                [session_id],
                |row| row.get::<_, String>(0),
            )
            .ok()
        })?;
    let trimmed = task_id.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn cloud_mcp_proxy_post_json(base_url: &str, body: &str) -> Result<String, String> {
    use std::io::{Read as _, Write as _};

    let endpoint = cloud_mcp_proxy_parse_http_url(base_url)?;
    let mut stream = std::net::TcpStream::connect((endpoint.host.as_str(), endpoint.port))
        .map_err(|error| format!("connect failed: {error}"))?;
    let timeout = std::time::Duration::from_secs(CLOUD_MCP_CONNECT_TIMEOUT_SECS as u64);
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let mut headers = String::new();
    if let Ok(token) = env::var("CLOUD_DIFFFORGE_DEV_TOKEN").or_else(|_| env::var("CLOUD_MCP_DEV_TOKEN")) {
        if !token.trim().is_empty() {
            headers.push_str(&format!("Authorization: Bearer {}\r\n", token.trim()));
        }
    }

    let request = format!(
        "POST {} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nAccept: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n{}",
        endpoint.path,
        endpoint.host_header,
        body.as_bytes().len(),
        headers,
        body
    );

    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("write failed: {error}"))?;

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|error| format!("read failed: {error}"))?;
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "invalid HTTP response from Cloud MCP".to_string())?;
    let head = String::from_utf8_lossy(&response[..header_end]).to_string();
    let body = &response[header_end + 4..];
    if !head.starts_with("HTTP/1.1 2") && !head.starts_with("HTTP/1.0 2") {
        return Err(format!("Cloud MCP returned {}", head.lines().next().unwrap_or("non-2xx status")));
    }
    let body = if cloud_mcp_proxy_header_contains(&head, "transfer-encoding", "chunked") {
        cloud_mcp_proxy_decode_chunked_body(body)?
    } else {
        body.to_vec()
    };
    String::from_utf8(body).map_err(|error| format!("Cloud MCP returned invalid UTF-8: {error}"))
}

fn cloud_mcp_proxy_header_contains(head: &str, header_name: &str, expected_value: &str) -> bool {
    let header_name = header_name.to_ascii_lowercase();
    let expected_value = expected_value.to_ascii_lowercase();
    head.lines().any(|line| {
        let Some((name, value)) = line.split_once(':') else {
            return false;
        };
        name.trim().eq_ignore_ascii_case(&header_name)
            && value.to_ascii_lowercase().contains(&expected_value)
    })
}

fn cloud_mcp_proxy_decode_chunked_body(body: &[u8]) -> Result<Vec<u8>, String> {
    let mut cursor = 0usize;
    let mut decoded = Vec::new();

    loop {
        let line_end = body[cursor..]
            .windows(2)
            .position(|window| window == b"\r\n")
            .map(|offset| cursor + offset)
            .ok_or_else(|| "invalid chunked Cloud MCP response: missing chunk size".to_string())?;
        let size_line = std::str::from_utf8(&body[cursor..line_end])
            .map_err(|error| format!("invalid chunked Cloud MCP size line: {error}"))?;
        let size_text = size_line
            .split_once(';')
            .map(|(size, _)| size)
            .unwrap_or(size_line)
            .trim();
        let size = usize::from_str_radix(size_text, 16)
            .map_err(|error| format!("invalid chunked Cloud MCP chunk size '{size_text}': {error}"))?;
        cursor = line_end + 2;

        if size == 0 {
            break;
        }
        let chunk_end = cursor
            .checked_add(size)
            .ok_or_else(|| "invalid chunked Cloud MCP response: chunk size overflow".to_string())?;
        if chunk_end + 2 > body.len() {
            return Err("invalid chunked Cloud MCP response: chunk exceeds body".to_string());
        }
        decoded.extend_from_slice(&body[cursor..chunk_end]);
        if &body[chunk_end..chunk_end + 2] != b"\r\n" {
            return Err("invalid chunked Cloud MCP response: missing chunk terminator".to_string());
        }
        cursor = chunk_end + 2;
    }

    Ok(decoded)
}

#[derive(Clone, Debug)]
struct CloudMcpProxyEndpoint {
    host: String,
    host_header: String,
    port: u16,
    path: String,
}

fn cloud_mcp_proxy_parse_http_url(base_url: &str) -> Result<CloudMcpProxyEndpoint, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let without_scheme = trimmed
        .strip_prefix("http://")
        .ok_or_else(|| "Cloud MCP stdio proxy currently supports local http:// URLs only".to_string())?;
    let (authority, prefix) = without_scheme
        .split_once('/')
        .map(|(authority, path)| (authority, format!("/{path}")))
        .unwrap_or((without_scheme, String::new()));
    let (host, port) = authority
        .rsplit_once(':')
        .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host.to_string(), port)))
        .unwrap_or_else(|| (authority.to_string(), 80));
    let path = format!("{}/mcp", prefix.trim_end_matches('/'));
    let host_header = if port == 80 {
        host.clone()
    } else {
        format!("{host}:{port}")
    };

    Ok(CloudMcpProxyEndpoint {
        host,
        host_header,
        port,
        path,
    })
}

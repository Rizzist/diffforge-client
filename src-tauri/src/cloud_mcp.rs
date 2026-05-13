const CLOUD_MCP_DEFAULT_BASE_URL: &str = "http://127.0.0.1:8080";
const CLOUD_MCP_CONNECT_TIMEOUT_SECS: u64 = 3;
const CLOUD_MCP_SYNC_TIMEOUT_SECS: u64 = 60;
const CLOUD_MCP_FILETREE_LIMIT: usize = 900;
const CLOUD_MCP_FILETREE_MAX_DEPTH: usize = 8;
const CLOUD_MCP_RUST_CLIENT_ID: &str = "rust-diffforge-agent";
const CLOUD_MCP_SPEC_GRAPH_CACHE_EVENT: &str = "cloud-mcp-spec-graph-cache";
const CLOUD_MCP_SPEC_GRAPH_SYNC_INTERVAL_MS: u64 = 1_500;
const CLOUD_MCP_SPEC_GRAPH_ERROR_INTERVAL_MS: u64 = 4_000;

#[derive(Clone)]
struct CloudMcpState {
    inner: Arc<Mutex<CloudMcpRuntime>>,
    client: reqwest::Client,
    spec_graph_syncs: Arc<Mutex<HashMap<String, u64>>>,
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
    #[serde(skip_serializing_if = "Vec::is_empty")]
    references: Vec<String>,
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
            spec_graph_syncs: Arc::new(Mutex::new(HashMap::new())),
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

fn cloud_mcp_reference_scan_candidate(path: &Path, size: Option<u64>) -> bool {
    if size.is_some_and(|size| size > 256 * 1024) {
        return false;
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        extension.as_str(),
        "css" | "html" | "js" | "jsx" | "mjs" | "ts" | "tsx" | "vue" | "svelte"
    )
}

fn cloud_mcp_extract_quoted_references(line: &str, needles: &[&str], output: &mut Vec<String>) {
    let lower = line.to_ascii_lowercase();
    if !needles.iter().any(|needle| lower.contains(needle)) {
        return;
    }
    let bytes = line.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        let quote = bytes[index];
        if quote != b'"' && quote != b'\'' {
            index += 1;
            continue;
        }
        let start = index + 1;
        let mut end = start;
        while end < bytes.len() && bytes[end] != quote {
            end += 1;
        }
        if end <= bytes.len() {
            if let Some(value) = line.get(start..end) {
                let value = value.trim();
                if cloud_mcp_reference_looks_local(value) {
                    output.push(value.to_string());
                }
            }
        }
        index = end.saturating_add(1);
    }
}

fn cloud_mcp_reference_looks_local(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('#')
        && !value.starts_with("http://")
        && !value.starts_with("https://")
        && !value.starts_with("mailto:")
        && !value.starts_with("data:")
        && !value.starts_with("javascript:")
}

fn cloud_mcp_file_references(path: &Path, size: Option<u64>) -> Vec<String> {
    if !cloud_mcp_reference_scan_candidate(path, size) {
        return Vec::new();
    }
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut references = Vec::new();
    for line in text.lines().take(400) {
        cloud_mcp_extract_quoted_references(
            line,
            &[
                "import",
                "export",
                "require(",
                " from ",
                "src=",
                "href=",
                "@import",
                "url(",
            ],
            &mut references,
        );
        if references.len() >= 80 {
            break;
        }
    }
    references.sort();
    references.dedup();
    references
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
                    references: Vec::new(),
                });
                queue.push_back((path, depth + 1));
            } else if file_type.is_file() {
                let metadata = entry.metadata().ok();
                let size = metadata.as_ref().map(fs::Metadata::len);
                entries.push(CloudMcpFileEntry {
                    relative_path,
                    kind: "file".to_string(),
                    size,
                    modified_ms: metadata
                        .as_ref()
                        .and_then(|metadata| cloud_mcp_modified_ms(metadata)),
                    references: cloud_mcp_file_references(&path, size),
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

    Ok(CloudMcpPreparedWorkspace {
        root,
        root_display,
        workspace_id,
        workspace_name,
        filetree,
        filetree_truncated,
        policy_graph_path,
        policy_graph,
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

    let mut request = state
        .client
        .post(&url)
        .header("x-diffforge-client-id", CLOUD_MCP_RUST_CLIENT_ID);
    if let Some(workspace_id) = cloud_mcp_payload_text(payload, &["workspace_id"])
        .or_else(|| cloud_mcp_payload_text(payload, &["payload", "workspace_id"]))
    {
        request = request.header("x-diffforge-workspace-id", workspace_id);
    }
    if let Some(repo_id) = cloud_mcp_payload_text(payload, &["repo_id"])
        .or_else(|| cloud_mcp_payload_text(payload, &["payload", "repo_id"]))
    {
        request = request.header("x-diffforge-repo-id", repo_id);
    }
    let response = match request
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

async fn cloud_mcp_post_event_endpoint(
    state: &CloudMcpState,
    event_kind: &str,
    payload: &Value,
) -> Result<Value, String> {
    let envelope = json!({
        "event_kind": event_kind,
        "payload": payload,
        "ts_ms": cloud_mcp_now_ms(),
    });
    cloud_mcp_post_json_endpoint(state, "/v1/events", &envelope).await
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
        "/v1/spec/graph" => "cloud_get_spec_graph",
        "/v1/spec/graph/delta" => "cloud_get_spec_graph_delta",
        "/v1/spec/nodes" => "cloud_get_spec_node",
        "/v1/events" => payload
            .get("event_kind")
            .and_then(Value::as_str)
            .unwrap_or("cloud_event"),
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
            "context_pack_model": true,
        }
    });
    let server_response =
        cloud_mcp_post_event_endpoint(state, reason, &payload).await?;
    let filetree_response = cloud_mcp_push_filetree_snapshot(
        state,
        &repo_id,
        &prepared.root,
        Some(&prepared.workspace_id),
        Some(&prepared.workspace_name),
        prepared.filetree.clone(),
        prepared.filetree_truncated,
        reason,
    )
    .await;
    let log_path = cloud_mcp_workspace_log(
        &prepared.root,
        reason,
        &workspace_status.workspace_id,
        &workspace_status.workspace_name,
        json!({
            "repo_id": repo_id,
            "file_count": workspace_status.file_count,
            "filetree_truncated": prepared.filetree_truncated,
            "filetree_synced": filetree_response.is_ok(),
            "filetree_sync_error": filetree_response
                .as_ref()
                .err()
                .map(|error| clean_terminal_telemetry_text(error)),
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

fn cloud_mcp_response_data(value: &Value) -> Value {
    value.get("data").cloned().unwrap_or_else(|| value.clone())
}

async fn cloud_mcp_push_filetree_snapshot(
    state: &CloudMcpState,
    repo_id: &str,
    workspace_root: &Path,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
    filetree: Vec<CloudMcpFileEntry>,
    filetree_truncated: bool,
    reason: &str,
) -> Result<Value, String> {
    let payload = json!({
        "source": "rust-diffforge-filetree",
        "repo_id": repo_id,
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "workspace_root": workspace_path_display(workspace_root),
        "reason": reason,
        "filetree": filetree,
        "filetree_truncated": filetree_truncated,
        "ts_ms": cloud_mcp_now_ms(),
    });
    cloud_mcp_post_event_endpoint(state, "filetree_snapshot", &payload).await
}

async fn cloud_mcp_push_current_filetree_snapshot(
    state: &CloudMcpState,
    repo_id: &str,
    workspace_root: &Path,
    reason: &str,
) -> Result<Value, String> {
    let root = workspace_root.to_path_buf();
    let (filetree, filetree_truncated) = tauri::async_runtime::spawn_blocking(move || {
        cloud_mcp_collect_filetree(&root)
    })
    .await
    .map_err(|error| format!("Unable to scan Cloud MCP filetree: {error}"))?;
    cloud_mcp_push_filetree_snapshot(
        state,
        repo_id,
        workspace_root,
        None,
        None,
        filetree,
        filetree_truncated,
        reason,
    )
    .await
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
        .and_then(|coordination| cloud_mcp_stable_agent_id(Some(coordination.agent_id.as_str())))
        .unwrap_or_else(|| format!("{pane_id}-{instance_id}"))
}

fn cloud_mcp_stable_agent_id(agent_id: Option<&str>) -> Option<String> {
    let agent_id = agent_id?.trim();
    if agent_id.is_empty() {
        return None;
    }
    Some(agent_id.to_string())
}

fn cloud_mcp_short_agent_label(agent_id: &str) -> Option<String> {
    let agent_id = agent_id.trim();
    if agent_id.is_empty() || agent_id.starts_with("workspace-terminal-") {
        return None;
    }
    let label = agent_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(3)
        .collect::<String>();
    if label.is_empty() {
        None
    } else {
        Some(label)
    }
}

fn cloud_mcp_terminal_claimed_paths(
    coordination: Option<&TerminalCoordinationSession>,
    local_task_id: Option<&str>,
) -> Vec<Value> {
    let Some(coordination) = coordination else {
        return Vec::new();
    };
    let conn = match rusqlite::Connection::open(&coordination.db_path) {
        Ok(conn) => conn,
        Err(_) => return Vec::new(),
    };
    let mut claimed_paths = Vec::new();
    let mut seen = std::collections::HashSet::<String>::new();
    let mut statement = match conn.prepare(
        "SELECT r.resource_key, l.mode, l.reason
         FROM leases l
         JOIN resources r ON r.id=l.resource_id
         WHERE l.session_id=?1 AND l.status='active'
         ORDER BY l.acquired_at DESC
         LIMIT 50",
    ) {
        Ok(statement) => statement,
        Err(_) => return Vec::new(),
    };
    let rows = match statement.query_map(
        rusqlite::params![coordination.session_id.as_str()],
        |row| {
            let resource_key: String = row.get(0)?;
            let mode: String = row.get(1)?;
            let reason: Option<String> = row.get(2)?;
            let path = resource_key
                .strip_prefix("file:")
                .unwrap_or(resource_key.as_str())
                .to_string();
            Ok(json!({
                "resource_key": resource_key,
                "path": path,
                "mode": mode,
                "reason": reason,
            }))
        },
    ) {
        Ok(rows) => rows,
        Err(_) => return Vec::new(),
    };
    for row in rows.filter_map(Result::ok) {
        let key = row["resource_key"]
            .as_str()
            .or_else(|| row["path"].as_str())
            .unwrap_or_default()
            .to_string();
        if seen.insert(key) {
            claimed_paths.push(row);
        }
    }
    if let Some(local_task_id) = local_task_id.filter(|value| !value.trim().is_empty()) {
        if let Ok(mut statement) = conn.prepare(
            "SELECT resource_key, status, intent_summary
             FROM task_resource_intents
             WHERE task_id=?1
               AND status IN ('parked', 'parked_cycle_prevented', 'waiting', 'blocked', 'resume_ready')
             ORDER BY updated_at DESC
             LIMIT 50",
        ) {
            if let Ok(rows) = statement.query_map([local_task_id], |row| {
                let resource_key: String = row.get(0)?;
                let status: String = row.get(1)?;
                let reason: Option<String> = row.get(2)?;
                let path = resource_key
                    .strip_prefix("file:")
                    .unwrap_or(resource_key.as_str())
                    .to_string();
                Ok(json!({
                    "resource_key": resource_key,
                    "path": path,
                    "mode": "write",
                    "status": status,
                    "reason": reason,
                    "parked": true,
                }))
            }) {
                for row in rows.filter_map(Result::ok) {
                    let key = row["resource_key"]
                        .as_str()
                        .or_else(|| row["path"].as_str())
                        .unwrap_or_default()
                        .to_string();
                    if seen.insert(key) {
                        claimed_paths.push(row);
                    }
                }
            }
        }
    }
    claimed_paths
}

fn cloud_mcp_terminal_patch_changed_files(
    coordination: Option<&TerminalCoordinationSession>,
    local_task_id: Option<&str>,
) -> Vec<Value> {
    let Some(coordination) = coordination else {
        return Vec::new();
    };
    let Some(local_task_id) = local_task_id.filter(|value| !value.trim().is_empty()) else {
        return Vec::new();
    };
    let conn = match rusqlite::Connection::open(&coordination.db_path) {
        Ok(conn) => conn,
        Err(_) => return Vec::new(),
    };
    cloud_mcp_patch_changed_files_for_task(&conn, local_task_id)
}

fn cloud_mcp_terminal_changed_files_for_status(
    coordination: Option<&TerminalCoordinationSession>,
    local_task_id: Option<&str>,
    working_directory: &Path,
) -> Vec<Value> {
    let patch_changed_files = cloud_mcp_terminal_patch_changed_files(coordination, local_task_id);
    if !patch_changed_files.is_empty() {
        return patch_changed_files;
    }
    let scopes = cloud_mcp_terminal_claimed_paths(coordination, local_task_id);
    cloud_mcp_git_changed_files_for_scope(working_directory, &scopes)
}

fn cloud_mcp_patch_changed_files_for_task(
    conn: &rusqlite::Connection,
    local_task_id: &str,
) -> Vec<Value> {
    let patch_id = conn
        .query_row(
            "SELECT id FROM patches
             WHERE task_id=?1 AND status='merged'
             ORDER BY created_at DESC LIMIT 1",
            [local_task_id],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let Some(patch_id) = patch_id else {
        return Vec::new();
    };
    let mut statement = match conn.prepare(
        "SELECT path, change_kind
         FROM patch_files
         WHERE patch_id=?1
         ORDER BY path ASC
         LIMIT 200",
    ) {
        Ok(statement) => statement,
        Err(_) => return Vec::new(),
    };
    let rows = match statement.query_map([patch_id.as_str()], |row| {
        let path: String = row.get(0)?;
        let change_kind: Option<String> = row.get(1)?;
        Ok(json!({
            "path": path,
            "change_kind": change_kind,
            "patch_id": patch_id,
        }))
    }) {
        Ok(rows) => rows,
        Err(_) => return Vec::new(),
    };
    rows.filter_map(Result::ok).collect()
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

fn cloud_mcp_path_from_file_scope(scope: &Value) -> Option<String> {
    let value = scope["path"]
        .as_str()
        .or_else(|| scope["file"].as_str())
        .or_else(|| scope["file_path"].as_str())
        .or_else(|| scope["filePath"].as_str())
        .or_else(|| scope["resource_key"].as_str())
        .or_else(|| scope["resourceKey"].as_str())?;
    let path = value
        .trim()
        .trim_start_matches("file:")
        .trim_start_matches("./")
        .replace('\\', "/");
    if path.trim().is_empty() {
        None
    } else {
        Some(path)
    }
}

fn cloud_mcp_filter_git_changed_files_by_scope(
    changed_files: Vec<Value>,
    scopes: &[Value],
) -> Vec<Value> {
    let scope_paths = scopes
        .iter()
        .filter_map(cloud_mcp_path_from_file_scope)
        .collect::<std::collections::HashSet<_>>();
    if scope_paths.is_empty() {
        return changed_files;
    }
    changed_files
        .into_iter()
        .filter(|file| {
            let path = file["path"].as_str().unwrap_or_default();
            scope_paths.iter().any(|scope| {
                path == scope
                    || path.strip_prefix("./") == Some(scope.as_str())
                    || scope.strip_prefix("./") == Some(path)
            })
        })
        .collect()
}

fn cloud_mcp_git_changed_files_for_scope(root: &Path, scopes: &[Value]) -> Vec<Value> {
    cloud_mcp_filter_git_changed_files_by_scope(cloud_mcp_git_changed_files(root), scopes)
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
    let agent_label = cloud_mcp_short_agent_label(agent_id);
    let agent_label = agent_label.as_deref();
    let payload = json!({
        "source": "rust-diffforge-terminal",
        "repo_id": repo_id,
        "agent_id": agent_id,
        "agent_label": agent_label,
        "lane": lane,
        "reason": format!("Starting terminal task: {}", cloud_mcp_prompt_summary(prompt)),
        "metadata": {
            "agent_label": agent_label,
            "workspace_root": workspace_path_display(working_directory),
            "session_id": coordination.map(|coordination| coordination.session_id.clone()),
        },
        "ts_ms": cloud_mcp_now_ms(),
    });
    if let Err(error) = cloud_mcp_post_event_endpoint(state, "lane_claimed", &payload).await {
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

async fn cloud_mcp_release_terminal_lane(
    state: &CloudMcpState,
    repo_id: &str,
    agent_id: &str,
    lane: &str,
    working_directory: &Path,
    pane_id: &str,
    instance_id: u64,
    reason: &str,
) {
    let agent_label = cloud_mcp_short_agent_label(agent_id);
    let agent_label = agent_label.as_deref();
    let payload = json!({
        "source": "rust-diffforge-terminal-lifecycle",
        "repo_id": repo_id,
        "agent_id": agent_id,
        "agent_label": agent_label,
        "self_agent_id": agent_id,
        "current_agent_id": agent_id,
        "lane": lane,
        "workspace_root": workspace_path_display(working_directory),
        "terminal_id": pane_id,
        "terminal_instance_id": instance_id,
        "reason": reason,
        "metadata": {
            "agent_label": agent_label,
            "reason": reason,
            "terminal_id": pane_id,
            "terminal_instance_id": instance_id,
        },
        "ts_ms": cloud_mcp_now_ms(),
    });
    if let Err(error) = cloud_mcp_post_event_endpoint(state, "lane_released", &payload).await {
        log_terminal_event(
            "cloud_mcp.agent_lifecycle.release_lane_error",
            Some(pane_id),
            Some(instance_id),
            None,
            json!({
                "agent_id": clean_terminal_telemetry_text(agent_id),
                "repo_id": clean_terminal_telemetry_text(repo_id),
                "lane": clean_terminal_telemetry_text(lane),
                "reason": clean_terminal_telemetry_text(reason),
                "error": clean_terminal_telemetry_text(&error),
            }),
        );
    }
}

async fn cloud_mcp_sync_terminal_agent_status(
    state: &CloudMcpState,
    repo_id: &str,
    agent_id: &str,
    lane: &str,
    status: &str,
    current_prompt: Option<&str>,
    progress_summary: &str,
    working_directory: &Path,
    pane_id: &str,
    instance_id: u64,
    coordination: Option<&TerminalCoordinationSession>,
    local_task_id: Option<&str>,
    reason: &str,
) {
    let claimed_paths = cloud_mcp_terminal_claimed_paths(coordination, local_task_id);
    let has_claimed_paths = !claimed_paths.is_empty();
    let agent_label = cloud_mcp_short_agent_label(agent_id);
    let agent_label = agent_label.as_deref();
    let payload = json!({
        "source": "rust-diffforge-terminal-lifecycle",
        "spec_source": if has_claimed_paths { "rust_terminal_lease_scope" } else { "rust_terminal_lifecycle" },
        "record_spec_activity": has_claimed_paths,
        "repo_id": repo_id,
        "agent_id": agent_id,
        "agent_label": agent_label,
        "self_agent_id": agent_id,
        "current_agent_id": agent_id,
        "status": status,
        "lane": lane,
        "current_prompt": current_prompt,
        "progress_summary": progress_summary,
        "task_id": local_task_id,
        "claimed_paths": claimed_paths,
        "workspace_root": workspace_path_display(working_directory),
        "terminal_id": pane_id,
        "terminal_instance_id": instance_id,
        "metadata": {
            "agent_label": agent_label,
            "managed_by": "rust-diffforge",
            "reason": reason,
            "terminal_id": pane_id,
            "terminal_instance_id": instance_id,
            "workspace_root": workspace_path_display(working_directory),
            "session_id": coordination.map(|coordination| coordination.session_id.clone()),
            "local_coordination_task_id": local_task_id,
            "coordination_task_id": local_task_id,
            "local_lease_file_evidence": has_claimed_paths,
            "local_active_leases": claimed_paths,
        },
        "ts_ms": cloud_mcp_now_ms(),
    });
    match cloud_mcp_post_event_endpoint(state, "agent_heartbeat", &payload).await {
        Ok(_) => {
            log_terminal_event(
                "cloud_mcp.agent_lifecycle.synced",
                Some(pane_id),
                Some(instance_id),
                None,
                json!({
                    "agent_id": clean_terminal_telemetry_text(agent_id),
                    "repo_id": clean_terminal_telemetry_text(repo_id),
                    "status": status,
                    "lane": clean_terminal_telemetry_text(lane),
                    "reason": clean_terminal_telemetry_text(reason),
                    "local_task_id": local_task_id.map(clean_terminal_telemetry_text),
                }),
            );
        }
        Err(error) => {
            log_terminal_event(
                "cloud_mcp.agent_lifecycle.sync_error",
                Some(pane_id),
                Some(instance_id),
                None,
                json!({
                    "agent_id": clean_terminal_telemetry_text(agent_id),
                    "repo_id": clean_terminal_telemetry_text(repo_id),
                    "status": status,
                    "reason": clean_terminal_telemetry_text(reason),
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );
        }
    }
}

fn cloud_mcp_agent_status_for_lifecycle_status(status: &str) -> &'static str {
    match status {
        "starting" => "starting",
        "active" | "busy" => "active",
        "merged" | "completed" => "done",
        "blocked" => "blocked",
        "parked" => "parked",
        "waiting" => "waiting",
        "review" => "review",
        "done" => "done",
        "cancelled" => "cancelled",
        "interrupted" => "interrupted",
        "closed" => "closed",
        "stopped" => "stopped",
        "idle" => "idle",
        _ => "inactive",
    }
}

fn cloud_mcp_lifecycle_status_releases_lane(status: &str) -> bool {
    !matches!(status, "starting" | "active" | "busy")
}

pub(crate) async fn cloud_mcp_mark_terminal_task_lifecycle(
    state: &CloudMcpState,
    pane_id: &str,
    instance_id: u64,
    working_directory: &Path,
    coordination: Option<&TerminalCoordinationSession>,
    local_task_id: Option<&str>,
    _title: Option<&str>,
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
    let lifecycle_changed_files = if matches!(status, "done" | "review" | "merged" | "completed") {
        cloud_mcp_terminal_changed_files_for_status(coordination, local_task_id, working_directory)
    } else {
        Vec::new()
    };
    if matches!(status, "done" | "review" | "merged" | "completed") && !lifecycle_changed_files.is_empty() {
        if let Err(error) = cloud_mcp_push_current_filetree_snapshot(
            state,
            &repo_id,
            working_directory,
            "terminal_work_filetree_update",
        )
        .await
        {
            let _ = cloud_mcp_workspace_log(
                working_directory,
                "cloud_mcp.filetree.sync_error",
                "",
                "",
                json!({
                    "agent_id": clean_terminal_telemetry_text(&agent_id),
                    "pane_id": clean_terminal_telemetry_text(pane_id),
                    "local_task_id": local_task_id.map(clean_terminal_telemetry_text),
                    "status": status,
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );
        }
    }

    let agent_status = cloud_mcp_agent_status_for_lifecycle_status(status);
    cloud_mcp_sync_terminal_agent_status(
        state,
        &repo_id,
        &agent_id,
        lane,
        agent_status,
        None,
        brief,
        working_directory,
        pane_id,
        instance_id,
        coordination,
        local_task_id,
        "terminal_task_lifecycle",
    )
    .await;
    if cloud_mcp_lifecycle_status_releases_lane(status) {
        cloud_mcp_release_terminal_lane(
            state,
            &repo_id,
            &agent_id,
            lane,
            working_directory,
            pane_id,
            instance_id,
            status,
        )
        .await;
        let mut runtime = state.inner.lock().await;
        runtime.terminal_contexts.remove(&terminal_key);
    }

    let mut runtime = state.inner.lock().await;
    if let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) {
        entry.lane = lane.to_string();
    }

    None
}

pub(crate) async fn cloud_mcp_mark_terminal_closed(
    state: &CloudMcpState,
    pane_id: &str,
    instance_id: u64,
    instance: &TerminalInstance,
    reason: &str,
) {
    let closed_started_at = Instant::now();
    log_terminal_shutdown_detail_event(
        "terminal.shutdown_detail.cloud_mcp.closed_start",
        Some(pane_id),
        Some(instance_id),
        None,
        json!({
            "reason": clean_terminal_telemetry_text(reason),
        }),
    );
    let connect_started_at = Instant::now();
    if cloud_mcp_connected_or_connect(state, "terminal_closed").await.is_err() {
        let terminal_key = cloud_mcp_terminal_key(pane_id, instance_id);
        let mut runtime = state.inner.lock().await;
        runtime.terminal_contexts.remove(&terminal_key);
        log_terminal_shutdown_detail_event(
            "terminal.shutdown_detail.cloud_mcp.connect_error",
            Some(pane_id),
            Some(instance_id),
            Some(connect_started_at.elapsed()),
            json!({
                "reason": clean_terminal_telemetry_text(reason),
            }),
        );
        return;
    }
    log_terminal_shutdown_detail_event(
        "terminal.shutdown_detail.cloud_mcp.connect_done",
        Some(pane_id),
        Some(instance_id),
        Some(connect_started_at.elapsed()),
        json!({
            "reason": clean_terminal_telemetry_text(reason),
        }),
    );

    let coordination = instance.coordination.as_ref();
    let working_directory = instance.working_directory.as_ref();
    let agent_id = cloud_mcp_terminal_agent_id(pane_id, instance_id, coordination);
    let repo_id = cloud_mcp_terminal_repo_id(working_directory, coordination);
    let terminal_key = cloud_mcp_terminal_key(pane_id, instance_id);
    let active_task = instance.active_task.lock().await.clone();
    let context_entry = {
        let runtime = state.inner.lock().await;
        runtime.terminal_contexts.get(&terminal_key).cloned()
    };
    let lane = context_entry
        .as_ref()
        .map(|entry| entry.lane.as_str())
        .filter(|lane| !lane.trim().is_empty())
        .unwrap_or("terminal-agent")
        .to_string();
    let local_task_id = active_task
        .as_ref()
        .map(|task| task.task_id.as_str())
        .or_else(|| context_entry.as_ref().and_then(|entry| entry.local_task_id.as_deref()));
    let title = active_task.as_ref().map(|task| task.title.as_str());
    let last_prompt = context_entry
        .as_ref()
        .map(|entry| entry.last_prompt.as_str())
        .filter(|prompt| !prompt.trim().is_empty());
    log_terminal_shutdown_detail_event(
        "terminal.shutdown_detail.cloud_mcp.context_loaded",
        Some(pane_id),
        Some(instance_id),
        None,
        json!({
            "has_active_task": active_task.is_some(),
            "has_context_entry": context_entry.is_some(),
            "has_coordination": coordination.is_some(),
            "lane": clean_terminal_telemetry_text(&lane),
            "reason": clean_terminal_telemetry_text(reason),
        }),
    );
    let work_subject = context_entry
        .as_ref()
        .map(|entry| cloud_mcp_work_subject(&entry.work_brief))
        .unwrap_or_else(|| {
            title
                .map(str::to_string)
                .unwrap_or_else(|| "terminal task".to_string())
        });
    let brief = format!(
        "Terminal closed via {reason}; marking {} inactive.",
        cloud_mcp_work_subject(&work_subject)
    );

    if let Some(active_task) = active_task.as_ref() {
        let task_lifecycle_started_at = Instant::now();
        log_terminal_shutdown_detail_event(
            "terminal.shutdown_detail.cloud_mcp.task_lifecycle_start",
            Some(pane_id),
            Some(instance_id),
            None,
            json!({
                "local_task_id": clean_terminal_telemetry_text(&active_task.task_id),
                "reason": clean_terminal_telemetry_text(reason),
            }),
        );
        cloud_mcp_mark_terminal_task_lifecycle(
            state,
            pane_id,
            instance_id,
            working_directory,
            coordination,
            Some(&active_task.task_id),
            Some(&active_task.title),
            "interrupted",
            &lane,
            &brief,
        )
        .await;
        log_terminal_shutdown_detail_event(
            "terminal.shutdown_detail.cloud_mcp.task_lifecycle_done",
            Some(pane_id),
            Some(instance_id),
            Some(task_lifecycle_started_at.elapsed()),
            json!({
                "local_task_id": clean_terminal_telemetry_text(&active_task.task_id),
                "reason": clean_terminal_telemetry_text(reason),
            }),
        );
    }

    let status_sync_started_at = Instant::now();
    log_terminal_shutdown_detail_event(
        "terminal.shutdown_detail.cloud_mcp.closed_status_sync_start",
        Some(pane_id),
        Some(instance_id),
        None,
        json!({
            "agent_id": clean_terminal_telemetry_text(&agent_id),
            "lane": clean_terminal_telemetry_text(&lane),
            "reason": clean_terminal_telemetry_text(reason),
        }),
    );
    cloud_mcp_sync_terminal_agent_status(
        state,
        &repo_id,
        &agent_id,
        &lane,
        "closed",
        last_prompt,
        &brief,
        working_directory,
        pane_id,
        instance_id,
        coordination,
        local_task_id,
        reason,
    )
    .await;
    log_terminal_shutdown_detail_event(
        "terminal.shutdown_detail.cloud_mcp.closed_status_sync_done",
        Some(pane_id),
        Some(instance_id),
        Some(status_sync_started_at.elapsed()),
        json!({
            "agent_id": clean_terminal_telemetry_text(&agent_id),
            "lane": clean_terminal_telemetry_text(&lane),
            "reason": clean_terminal_telemetry_text(reason),
        }),
    );
    let release_started_at = Instant::now();
    log_terminal_shutdown_detail_event(
        "terminal.shutdown_detail.cloud_mcp.lane_release_start",
        Some(pane_id),
        Some(instance_id),
        None,
        json!({
            "agent_id": clean_terminal_telemetry_text(&agent_id),
            "lane": clean_terminal_telemetry_text(&lane),
            "reason": clean_terminal_telemetry_text(reason),
        }),
    );
    cloud_mcp_release_terminal_lane(
        state,
        &repo_id,
        &agent_id,
        &lane,
        working_directory,
        pane_id,
        instance_id,
        reason,
    )
    .await;
    log_terminal_shutdown_detail_event(
        "terminal.shutdown_detail.cloud_mcp.lane_release_done",
        Some(pane_id),
        Some(instance_id),
        Some(release_started_at.elapsed()),
        json!({
            "agent_id": clean_terminal_telemetry_text(&agent_id),
            "lane": clean_terminal_telemetry_text(&lane),
            "reason": clean_terminal_telemetry_text(reason),
        }),
    );

    let mut runtime = state.inner.lock().await;
    runtime.terminal_contexts.remove(&terminal_key);
    log_terminal_shutdown_detail_event(
        "terminal.shutdown_detail.cloud_mcp.closed_done",
        Some(pane_id),
        Some(instance_id),
        Some(closed_started_at.elapsed()),
        json!({
            "reason": clean_terminal_telemetry_text(reason),
        }),
    );
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
            } else {
                entry.work_brief_reported = true;
                Some((
                    entry.repo_id.clone(),
                    entry.agent_id.clone(),
                    entry.lane.clone(),
                    entry.local_task_id.clone(),
                    brief,
                    entry.working_directory.clone(),
                ))
            }
        } else {
            None
        };
        let old_enough = cloud_mcp_now_ms().saturating_sub(entry.created_ms) >= 5_000;
        let completion = if entry.saw_agent_activity
            && !entry.done_reported
            && old_enough
            && cloud_mcp_terminal_output_looks_ready(&text)
        {
            entry.done_reported = true;
            Some((
                entry.local_task_id.clone(),
                entry.repo_id.clone(),
                entry.agent_id.clone(),
                entry.lane.clone(),
                entry.last_prompt.clone(),
                entry.work_brief.clone(),
                entry.working_directory.clone(),
            ))
        } else {
            None
        };
        (work_update, completion)
    };

    if let Some((repo_id, agent_id, lane, local_task_id, brief, working_directory)) = work_update {
        cloud_mcp_sync_terminal_agent_status(
            &state,
            &repo_id,
            &agent_id,
            &lane,
            "active",
            None,
            &brief,
            &working_directory,
            pane_id,
            instance_id,
            None,
            local_task_id.as_deref(),
            "terminal_status",
        )
        .await;
    }

    let Some((local_task_id, repo_id, agent_id, lane, _prompt, work_brief, working_directory)) = completion else {
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
    let _ = cloud_mcp_workspace_log(
        &working_directory,
        "cloud_mcp.context_pack.work_review",
        "",
        "",
        json!({
            "agent_id": clean_terminal_telemetry_text(&agent_id),
            "pane_id": clean_terminal_telemetry_text(pane_id),
            "instance_id": instance_id,
            "repo_id": clean_terminal_telemetry_text(&repo_id),
            "local_task_id": local_task_id.as_deref().map(clean_terminal_telemetry_text),
            "source": "terminal_prompt_ready",
            "status": "review",
            "completion_gate": "submit_patch_required",
            "changed_file_count": changed_files.len(),
        }),
    );
    cloud_mcp_sync_terminal_agent_status(
        &state,
        &repo_id,
        &agent_id,
        &lane,
        "inactive",
        None,
        &brief,
        &working_directory,
        pane_id,
        instance_id,
        None,
        local_task_id.as_deref(),
        "terminal_prompt_ready",
    )
    .await;
    cloud_mcp_release_terminal_lane(
        &state,
        &repo_id,
        &agent_id,
        &lane,
        &working_directory,
        pane_id,
        instance_id,
        "terminal_prompt_ready",
    )
    .await;

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

    cloud_mcp_sync_terminal_agent_status(
        &state,
        &repo_id,
        &agent_id,
        "terminal-agent",
        "starting",
        Some(&prompt),
        "Terminal prompt submitted; preparing Spec Graph context.",
        &working_directory,
        &pane_id,
        instance_id,
        coordination.as_ref(),
        local_task_id.as_deref(),
        "terminal_prompt_submitted",
    )
    .await;

    let payload = json!({
        "source": "rust-diffforge-terminal",
        "repo_id": repo_id,
        "agent_id": agent_id,
        "self_agent_id": agent_id,
        "current_agent_id": agent_id,
        "terminal_id": pane_id,
        "terminal_instance_id": instance_id,
        "prompt": prompt,
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
            let suggested_lane = data["current_work"]["suggested_lane"]
                .as_str()
                .or_else(|| data["suggested_lane"].as_str())
                .unwrap_or_default()
                .to_string();
            let active_agent_count = data["peers"]
                .as_array()
                .map(Vec::len)
                .unwrap_or(0);
            let lane_conflict_count = data["conflicts"]["lanes"]
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
            {
                let mut runtime = state.inner.lock().await;
                if let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) {
                    entry.lane = suggested_lane.clone();
                }
            }
            cloud_mcp_sync_terminal_agent_status(
                &state,
                &repo_id,
                &agent_id,
                &suggested_lane,
                "active",
                payload["prompt"].as_str(),
                "Terminal context is ready; waiting for agent start_task intent.",
                &working_directory,
                &pane_id,
                instance_id,
                coordination.as_ref(),
                local_task_id.as_deref(),
                "terminal_context_ready",
            )
            .await;
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
        if let Some((local_task_id, work_brief)) = {
            let runtime = state.inner.lock().await;
            runtime.terminal_contexts.get(&terminal_key).map(|entry| {
                (
                    entry.local_task_id.clone(),
                    entry.work_brief.clone(),
                )
            })
        } {
            let heartbeat_brief = if work_brief.trim().is_empty() {
                "Terminal task is active.".to_string()
            } else {
                format!("Working on: {}", cloud_mcp_work_subject(&work_brief))
            };
            cloud_mcp_sync_terminal_agent_status(
                &state,
                &repo_id,
                &agent_id,
                &lane,
                "active",
                None,
                &heartbeat_brief,
                &working_directory,
                &pane_id,
                instance_id,
                coordination.as_ref(),
                local_task_id.as_deref(),
                "rust_terminal_activity_watch",
            )
            .await;
        }
        let local_task_id_for_scope = {
            let runtime = state.inner.lock().await;
            runtime
                .terminal_contexts
                .get(&terminal_key)
                .and_then(|entry| entry.local_task_id.clone())
        };
        let scopes =
            cloud_mcp_terminal_claimed_paths(coordination.as_ref(), local_task_id_for_scope.as_deref());
        let scan_root = working_directory.clone();
        let changed_files = match tauri::async_runtime::spawn_blocking(move || {
            cloud_mcp_git_changed_files_for_scope(&scan_root, &scopes)
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
        let Some((should_report, should_complete, local_task_id, work_brief)) = ({
            let mut runtime = state.inner.lock().await;
            if let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) {
                let local_task_id = entry.local_task_id.clone();
                let work_brief = entry.work_brief.clone();
                if changed_hash.is_empty() {
                    entry.last_changed_hash.clear();
                    entry.stable_change_cycles = 0;
                    Some((false, false, local_task_id, work_brief))
                } else if entry.last_changed_hash == changed_hash {
                    if entry.reported_change {
                        entry.stable_change_cycles = entry.stable_change_cycles.saturating_add(1);
                    }
                    Some((
                        false,
                        entry.reported_change && !entry.done_reported && entry.stable_change_cycles >= 4,
                        local_task_id,
                        work_brief,
                    ))
                } else {
                    entry.last_changed_hash = changed_hash.clone();
                    entry.last_checkpoint_ms = cloud_mcp_now_ms();
                    entry.reported_change = true;
                    entry.stable_change_cycles = 0;
                    Some((true, false, local_task_id, work_brief))
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
            let brief = format!(
                "Ready for patch submission: {}",
                fallback_title.as_deref().unwrap_or(&work_subject)
            );
            let _ = cloud_mcp_workspace_log(
                &working_directory,
                "cloud_mcp.context_pack.work_review",
                "",
                "",
                json!({
                    "agent_id": agent_id,
                    "pane_id": pane_id,
                    "instance_id": instance_id,
                    "repo_id": repo_id,
                    "local_task_id": local_task_id.as_deref(),
                    "status": "review",
                    "completion_gate": "submit_patch_required",
                    "changed_file_count": changed_files.len(),
                }),
            );
            cloud_mcp_sync_terminal_agent_status(
                &state,
                &repo_id,
                &agent_id,
                &lane,
                "review",
                None,
                &brief,
                &working_directory,
                &pane_id,
                instance_id,
                coordination.as_ref(),
                local_task_id.as_deref(),
                "stable_file_changes_ready",
            )
            .await;
            cloud_mcp_release_terminal_lane(
                &state,
                &repo_id,
                &agent_id,
                &lane,
                &working_directory,
                &pane_id,
                instance_id,
                "stable_file_changes_ready",
            )
            .await;
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
            "task_id": local_task_id,
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
        match cloud_mcp_post_event_endpoint(&state, "checkpoint_recorded", &payload).await {
            Ok(response) => {
                let data = cloud_mcp_response_data(&response);
                let other_agent_count = data["peers"].as_array().map(Vec::len).unwrap_or(0);
                let lane_conflict_count = data["conflicts"]["lanes"]
                    .as_array()
                    .map(Vec::len)
                    .unwrap_or(0);
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

#[derive(Clone)]
struct CloudMcpSpecGraphSyncRequest {
    root: PathBuf,
    root_display: String,
    repo_id: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
}

fn cloud_mcp_spec_graph_sync_request(
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> CloudMcpSpecGraphSyncRequest {
    let root = resolve_workspace_root_directory(Some(&repo_path)).unwrap_or_else(|_| PathBuf::from(&repo_path));
    let root_display = workspace_path_display(&root);
    let repo_id = cloud_mcp_repo_id_for_root(&root);
    CloudMcpSpecGraphSyncRequest {
        root,
        root_display,
        repo_id,
        workspace_id,
        workspace_name,
    }
}

fn cloud_mcp_spec_graph_cache_dir(root: &Path) -> PathBuf {
    root.join(".agents").join("spec-graph")
}

fn cloud_mcp_spec_graph_cache_path(root: &Path, repo_id: &str) -> PathBuf {
    cloud_mcp_spec_graph_cache_dir(root).join(format!("{repo_id}.json"))
}

fn cloud_mcp_spec_graph_empty_raw(req: &CloudMcpSpecGraphSyncRequest) -> Value {
    json!({
        "kind": "project_spec_graph",
        "version": 3,
        "repo_id": req.repo_id.clone(),
        "workspace_id": req.workspace_id.clone(),
        "nodes": [],
        "edges": [],
        "hidden_edges": [],
        "agent_work": {},
        "graph_stats": {},
    })
}

fn cloud_mcp_spec_graph_snapshot_from_data(
    req: &CloudMcpSpecGraphSyncRequest,
    data: Value,
    cache_path: &Path,
    sync_state: &str,
    sync_error: &str,
) -> Value {
    let nodes = data
        .get("nodes")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let edges = data
        .get("edges")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let agent_work = data
        .get("agent_work")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let graph_stats = data
        .get("graph_stats")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let cursor = data
        .get("cursor")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let node_hashes = data
        .get("node_hashes")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let edge_hashes = data
        .get("edge_hashes")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let agent_work_hash = data
        .get("agent_work_hash")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let graph_stats_hash = data
        .get("graph_stats_hash")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    json!({
        "ok": true,
        "repoId": req.repo_id.clone(),
        "repoPath": req.root_display.clone(),
        "workspaceId": req.workspace_id.clone(),
        "workspaceName": req.workspace_name.clone(),
        "cachePath": workspace_path_display(cache_path),
        "syncState": sync_state,
        "syncError": sync_error,
        "lastSyncedMs": cloud_mcp_now_ms(),
        "cursor": cursor,
        "nodeHashes": node_hashes,
        "edgeHashes": edge_hashes,
        "agentWorkHash": agent_work_hash,
        "graphStatsHash": graph_stats_hash,
        "specGraph": data.clone(),
        "specNodes": nodes,
        "specEdges": edges,
        "agentWork": agent_work,
        "graphStats": graph_stats,
        "sourceOfTruth": {
            "kind": "spec_graph",
            "repo_id": req.repo_id.clone(),
            "markdown_backed": true,
            "cached_under_agents": true
        },
        "raw": data
    })
}

fn cloud_mcp_stamp_spec_graph_snapshot(
    mut snapshot: Value,
    req: &CloudMcpSpecGraphSyncRequest,
    cache_path: &Path,
    sync_state: &str,
    sync_error: &str,
) -> Value {
    if !snapshot.is_object() {
        snapshot = cloud_mcp_spec_graph_snapshot_from_data(
            req,
            cloud_mcp_spec_graph_empty_raw(req),
            cache_path,
            sync_state,
            sync_error,
        );
    }
    if let Some(object) = snapshot.as_object_mut() {
        object.insert("ok".to_string(), json!(true));
        object.insert("repoId".to_string(), json!(req.repo_id.clone()));
        object.insert("repoPath".to_string(), json!(req.root_display.clone()));
        object.insert("workspaceId".to_string(), json!(req.workspace_id.clone()));
        object.insert("workspaceName".to_string(), json!(req.workspace_name.clone()));
        object.insert("cachePath".to_string(), json!(workspace_path_display(cache_path)));
        object.insert("syncState".to_string(), json!(sync_state));
        object.insert("syncError".to_string(), json!(sync_error));
        object.insert("sourceOfTruth".to_string(), json!({
            "kind": "spec_graph",
            "repo_id": req.repo_id.clone(),
            "markdown_backed": true,
            "cached_under_agents": true
        }));
    }
    snapshot
}

fn cloud_mcp_read_spec_graph_cache(
    req: &CloudMcpSpecGraphSyncRequest,
    sync_state: &str,
    sync_error: &str,
) -> Value {
    let cache_path = cloud_mcp_spec_graph_cache_path(&req.root, &req.repo_id);
    let snapshot = fs::read_to_string(&cache_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| {
            cloud_mcp_spec_graph_snapshot_from_data(
                req,
                cloud_mcp_spec_graph_empty_raw(req),
                &cache_path,
                "empty",
                "",
            )
        });
    cloud_mcp_stamp_spec_graph_snapshot(snapshot, req, &cache_path, sync_state, sync_error)
}

fn cloud_mcp_write_spec_graph_cache(
    req: &CloudMcpSpecGraphSyncRequest,
    snapshot: &Value,
) -> Result<PathBuf, String> {
    let cache_dir = cloud_mcp_spec_graph_cache_dir(&req.root);
    fs::create_dir_all(&cache_dir).map_err(|error| {
        format!(
            "Unable to create Spec Graph cache directory {}: {error}",
            workspace_path_display(&cache_dir)
        )
    })?;
    let cache_path = cloud_mcp_spec_graph_cache_path(&req.root, &req.repo_id);
    let body = serde_json::to_string_pretty(snapshot)
        .map_err(|error| format!("Unable to encode Spec Graph cache: {error}"))?;
    fs::write(&cache_path, body.as_bytes()).map_err(|error| {
        format!(
            "Unable to write Spec Graph cache {}: {error}",
            workspace_path_display(&cache_path)
        )
    })?;
    Ok(cache_path)
}

fn cloud_mcp_spec_graph_item_id(item: &Value) -> Option<String> {
    ["id", "node_id", "nodeId", "edge_id", "edgeId"]
        .iter()
        .find_map(|key| item.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

fn cloud_mcp_spec_graph_array(snapshot: &Value, camel_key: &str, raw_key: &str) -> Vec<Value> {
    snapshot
        .get(camel_key)
        .and_then(Value::as_array)
        .or_else(|| snapshot.get("raw").and_then(|raw| raw.get(raw_key)).and_then(Value::as_array))
        .cloned()
        .unwrap_or_default()
}

fn cloud_mcp_apply_spec_graph_items(
    existing_items: Vec<Value>,
    changed_items: Vec<Value>,
    removed_ids: Vec<String>,
) -> Vec<Value> {
    let removed = removed_ids.into_iter().collect::<HashSet<_>>();
    let mut changed_by_id = changed_items
        .into_iter()
        .filter_map(|item| cloud_mcp_spec_graph_item_id(&item).map(|id| (id, item)))
        .collect::<HashMap<_, _>>();
    let mut next_items = Vec::new();

    for item in existing_items {
        let Some(id) = cloud_mcp_spec_graph_item_id(&item) else {
            next_items.push(item);
            continue;
        };
        if removed.contains(&id) {
            continue;
        }
        if let Some(changed) = changed_by_id.remove(&id) {
            next_items.push(changed);
        } else {
            next_items.push(item);
        }
    }

    let mut appended = changed_by_id.into_iter().collect::<Vec<_>>();
    appended.sort_by(|left, right| left.0.cmp(&right.0));
    next_items.extend(appended.into_iter().map(|(_, item)| item));
    next_items
}

fn cloud_mcp_spec_graph_delta_array(delta: &Value, key: &str) -> Vec<Value> {
    delta
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn cloud_mcp_spec_graph_delta_string_array(delta: &Value, key: &str) -> Vec<String> {
    delta
        .get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn cloud_mcp_apply_spec_graph_delta(
    req: &CloudMcpSpecGraphSyncRequest,
    cache: Value,
    delta: Value,
    cache_path: &Path,
) -> Value {
    let nodes = cloud_mcp_apply_spec_graph_items(
        cloud_mcp_spec_graph_array(&cache, "specNodes", "nodes"),
        cloud_mcp_spec_graph_delta_array(&delta, "changed_nodes"),
        cloud_mcp_spec_graph_delta_string_array(&delta, "removed_node_ids"),
    );
    let edges = cloud_mcp_apply_spec_graph_items(
        cloud_mcp_spec_graph_array(&cache, "specEdges", "edges"),
        cloud_mcp_spec_graph_delta_array(&delta, "changed_edges"),
        cloud_mcp_spec_graph_delta_string_array(&delta, "removed_edge_ids"),
    );
    let agent_work = if delta.get("agent_work").is_some_and(|value| !value.is_null()) {
        delta["agent_work"].clone()
    } else {
        cache
            .get("agentWork")
            .cloned()
            .or_else(|| cache.get("raw").and_then(|raw| raw.get("agent_work")).cloned())
            .unwrap_or_else(|| json!({}))
    };
    let graph_stats = if delta.get("graph_stats").is_some_and(|value| !value.is_null()) {
        delta["graph_stats"].clone()
    } else {
        cache
            .get("graphStats")
            .cloned()
            .or_else(|| cache.get("raw").and_then(|raw| raw.get("graph_stats")).cloned())
            .unwrap_or_else(|| json!({}))
    };
    let raw = json!({
        "kind": "project_spec_graph",
        "version": 3,
        "repo_id": req.repo_id.clone(),
        "workspace_id": req.workspace_id.clone(),
        "nodes": nodes,
        "edges": edges,
        "hidden_edges": cache.get("raw").and_then(|raw| raw.get("hidden_edges")).cloned().unwrap_or_else(|| json!([])),
        "agent_work": agent_work,
        "graph_stats": graph_stats,
    });
    let mut snapshot = cloud_mcp_spec_graph_snapshot_from_data(req, raw, cache_path, "ready", "");
    if let Some(object) = snapshot.as_object_mut() {
        object.insert(
            "cursor".to_string(),
            delta.get("cursor").cloned().unwrap_or_else(|| json!("")),
        );
        object.insert(
            "nodeHashes".to_string(),
            delta.get("node_hashes").cloned().unwrap_or_else(|| json!({})),
        );
        object.insert(
            "edgeHashes".to_string(),
            delta.get("edge_hashes").cloned().unwrap_or_else(|| json!({})),
        );
        object.insert(
            "agentWorkHash".to_string(),
            delta.get("agent_work_hash").cloned().unwrap_or_else(|| json!("")),
        );
        object.insert(
            "graphStatsHash".to_string(),
            delta.get("graph_stats_hash").cloned().unwrap_or_else(|| json!("")),
        );
    }
    snapshot
}

fn cloud_mcp_spec_graph_sync_payload(req: &CloudMcpSpecGraphSyncRequest, cache: &Value) -> Value {
    json!({
        "source": "rust-diffforge-spec-graph-cache",
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "repo_id": req.repo_id.clone(),
        "agent_id": "rust-diffforge",
        "self_agent_id": "rust-diffforge",
        "current_agent_id": "rust-diffforge",
        "repo_path": req.root_display.clone(),
        "workspace_root": req.root_display.clone(),
        "workspace_id": req.workspace_id.clone(),
        "workspace_name": req.workspace_name.clone(),
        "history_limit": 40,
        "agent_limit": 100,
        "cursor": cache.get("cursor").cloned().unwrap_or_else(|| json!("")),
        "known_node_hashes": cache.get("nodeHashes").cloned().unwrap_or_else(|| json!({})),
        "known_edge_hashes": cache.get("edgeHashes").cloned().unwrap_or_else(|| json!({})),
        "agent_work_hash": cache.get("agentWorkHash").cloned().unwrap_or_else(|| json!("")),
        "graph_stats_hash": cache.get("graphStatsHash").cloned().unwrap_or_else(|| json!("")),
        "requested_sections": ["nodes", "edges", "agent_work", "graph_stats"],
        "ts_ms": cloud_mcp_now_ms(),
    })
}

async fn cloud_mcp_fetch_full_spec_graph_data(
    state: &CloudMcpState,
    req: &CloudMcpSpecGraphSyncRequest,
) -> Result<Value, String> {
    cloud_mcp_connected_or_connect(state, "spec_graph_sync").await?;
    let payload = json!({
        "source": "rust-diffforge-spec-graph",
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "repo_id": req.repo_id.clone(),
        "agent_id": "rust-diffforge",
        "self_agent_id": "rust-diffforge",
        "current_agent_id": "rust-diffforge",
        "repo_path": req.root_display.clone(),
        "workspace_root": req.root_display.clone(),
        "workspace_id": req.workspace_id.clone(),
        "workspace_name": req.workspace_name.clone(),
        "history_limit": 40,
        "agent_limit": 100,
        "ts_ms": cloud_mcp_now_ms(),
    });
    let response = cloud_mcp_post_json_endpoint(state, "/v1/spec/graph", &payload).await?;
    Ok(cloud_mcp_response_data(&response))
}

async fn cloud_mcp_sync_spec_graph_once(
    state: &CloudMcpState,
    req: &CloudMcpSpecGraphSyncRequest,
) -> Result<(Value, bool), String> {
    let cache_path = cloud_mcp_spec_graph_cache_path(&req.root, &req.repo_id);
    let current_cache = cloud_mcp_read_spec_graph_cache(req, "syncing", "");
    cloud_mcp_connected_or_connect(state, "spec_graph_background_sync").await?;
    let payload = cloud_mcp_spec_graph_sync_payload(req, &current_cache);
    let delta_response = match cloud_mcp_post_json_endpoint(state, "/v1/spec/graph/delta", &payload).await {
        Ok(response) => Some(response),
        Err(error) if error.contains("HTTP 404") => None,
        Err(error) => return Err(error),
    };
    let next_snapshot = if let Some(response) = delta_response {
        let delta = cloud_mcp_response_data(&response);
        if delta["requires_full_resync"].as_bool().unwrap_or(false) {
            let data = cloud_mcp_fetch_full_spec_graph_data(state, req).await?;
            cloud_mcp_spec_graph_snapshot_from_data(req, data, &cache_path, "ready", "")
        } else {
            cloud_mcp_apply_spec_graph_delta(req, current_cache.clone(), delta, &cache_path)
        }
    } else {
        let data = cloud_mcp_fetch_full_spec_graph_data(state, req).await?;
        cloud_mcp_spec_graph_snapshot_from_data(req, data, &cache_path, "ready", "")
    };
    let changed = current_cache
        .get("cursor")
        .and_then(Value::as_str)
        != next_snapshot.get("cursor").and_then(Value::as_str)
        || current_cache.get("syncState").and_then(Value::as_str) == Some("error");
    if changed {
        cloud_mcp_write_spec_graph_cache(req, &next_snapshot)?;
    }
    Ok((next_snapshot, changed))
}

fn cloud_mcp_emit_spec_graph_snapshot(app: &AppHandle, snapshot: Value) {
    let _ = app.emit(CLOUD_MCP_SPEC_GRAPH_CACHE_EVENT, snapshot);
}

async fn cloud_mcp_spec_graph_sync_loop(
    app: AppHandle,
    state: CloudMcpState,
    req: CloudMcpSpecGraphSyncRequest,
    generation: u64,
) {
    let mut first_sync = true;
    loop {
        let still_active = {
            let syncs = state.spec_graph_syncs.lock().await;
            syncs.get(&req.repo_id).copied() == Some(generation)
        };
        if !still_active {
            break;
        }

        let delay_ms = match cloud_mcp_sync_spec_graph_once(&state, &req).await {
            Ok((snapshot, changed)) => {
                if first_sync || changed {
                    cloud_mcp_emit_spec_graph_snapshot(&app, snapshot);
                }
                first_sync = false;
                CLOUD_MCP_SPEC_GRAPH_SYNC_INTERVAL_MS
            }
            Err(error) => {
                let snapshot = cloud_mcp_read_spec_graph_cache(
                    &req,
                    "error",
                    &clean_terminal_telemetry_text(&error),
                );
                let _ = cloud_mcp_write_spec_graph_cache(&req, &snapshot);
                cloud_mcp_emit_spec_graph_snapshot(&app, snapshot);
                first_sync = false;
                CLOUD_MCP_SPEC_GRAPH_ERROR_INTERVAL_MS
            }
        };
        sleep(Duration::from_millis(delay_ms)).await;
    }
}

#[tauri::command]
async fn cloud_mcp_get_cached_spec_graph(
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    let req = cloud_mcp_spec_graph_sync_request(repo_path, workspace_id, workspace_name);
    Ok(cloud_mcp_read_spec_graph_cache(&req, "cached", ""))
}

#[tauri::command]
async fn cloud_mcp_start_spec_graph_sync(
    app: AppHandle,
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    let req = cloud_mcp_spec_graph_sync_request(repo_path, workspace_id, workspace_name);
    let mut cached = cloud_mcp_read_spec_graph_cache(&req, "syncing", "");
    let requested_generation = cloud_mcp_now_ms();
    let mut active_generation = requested_generation;
    let mut should_spawn = false;
    {
        let mut syncs = state.spec_graph_syncs.lock().await;
        if let Some(existing_generation) = syncs.get(&req.repo_id).copied() {
            active_generation = existing_generation;
        } else {
            syncs.insert(req.repo_id.clone(), requested_generation);
            should_spawn = true;
        }
    }
    if let Some(object) = cached.as_object_mut() {
        object.insert("syncGeneration".to_string(), json!(active_generation));
    }
    if should_spawn {
        let app_for_task = app.clone();
        let state_for_task = state.inner().clone();
        let req_for_task = req.clone();
        tauri::async_runtime::spawn(async move {
            cloud_mcp_spec_graph_sync_loop(
                app_for_task,
                state_for_task,
                req_for_task,
                requested_generation,
            )
            .await;
        });
    }
    Ok(cached)
}

#[tauri::command]
async fn cloud_mcp_stop_spec_graph_sync(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    sync_generation: Option<u64>,
) -> Result<Value, String> {
    let req = cloud_mcp_spec_graph_sync_request(repo_path, None, None);
    let mut syncs = state.spec_graph_syncs.lock().await;
    let stopped = if sync_generation
        .map(|generation| syncs.get(&req.repo_id).copied() == Some(generation))
        .unwrap_or(true)
    {
        syncs.remove(&req.repo_id).is_some()
    } else {
        false
    };
    Ok(json!({
        "ok": true,
        "repoId": req.repo_id.clone(),
        "repoPath": req.root_display.clone(),
        "stopped": stopped,
    }))
}

#[tauri::command]
async fn cloud_mcp_get_spec_graph(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    let req = cloud_mcp_spec_graph_sync_request(repo_path, workspace_id, workspace_name);
    let data = cloud_mcp_fetch_full_spec_graph_data(state.inner(), &req).await?;
    let cache_path = cloud_mcp_spec_graph_cache_path(&req.root, &req.repo_id);
    let snapshot = cloud_mcp_spec_graph_snapshot_from_data(&req, data, &cache_path, "ready", "");
    let _ = cloud_mcp_write_spec_graph_cache(&req, &snapshot);
    Ok(snapshot)
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
                "cloud_mcp.work.completion_guard",
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
            .or_else(|| agent_id.as_deref().and_then(cloud_mcp_short_agent_label));

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

    fn cloud_agent_id(&self) -> Option<String> {
        cloud_mcp_stable_agent_id(self.agent_id.as_deref())
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

pub(crate) fn cloud_mcp_forward_agent_checkpoint(
    repo_path: Option<&str>,
    db_path: Option<&Path>,
    workspace_id: Option<&str>,
    agent_id: Option<&str>,
    session_id: Option<&str>,
    local_task_id: Option<&str>,
    worktree_id: Option<&str>,
    worktree_path: Option<&str>,
    lane: Option<&str>,
    summary: &str,
) -> Result<Value, String> {
    let repo_path_text = repo_path
        .or(worktree_path)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let repo_id = repo_path_text
        .as_deref()
        .map(|value| format!("repo-{}", cloud_mcp_short_hash(value)));
    let base_url = cloud_mcp_base_url();
    let identity = CloudMcpProxyIdentity {
        base_url: Some(base_url.clone()),
        repo_path: repo_path_text.as_ref().map(PathBuf::from),
        repo_id,
        workspace_id: workspace_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        workspace_name: None,
        agent_id: agent_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        session_id: session_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        coordination_db_path: db_path.map(Path::to_path_buf),
        pane_id: None,
        terminal_instance_id: None,
        slot_key: None,
        agent_label: agent_id.and_then(cloud_mcp_short_agent_label),
        client_id: "rust-diffforge-agent-checkpoint".to_string(),
    };
    let event_kind = "checkpoint_recorded";
    let mut metadata = serde_json::Map::new();
    metadata.insert("reported_by".to_string(), json!("coordination-kernel.checkpoint"));
    if let Some(local_task_id) = local_task_id {
        metadata.insert("local_coordination_task_id".to_string(), json!(local_task_id));
        metadata.insert("coordination_task_id".to_string(), json!(local_task_id));
    }
    if let Some(worktree_id) = worktree_id {
        metadata.insert("worktree_id".to_string(), json!(worktree_id));
    }
    if let Some(worktree_path) = worktree_path {
        metadata.insert("worktree_path".to_string(), json!(worktree_path));
    }

    let mut arguments = serde_json::Map::new();
    arguments.insert("source".to_string(), json!("rust-diffforge-agent-checkpoint"));
    arguments.insert("client_id".to_string(), json!(identity.client_id.clone()));
    arguments.insert("subtask".to_string(), json!(summary));
    arguments.insert("brief".to_string(), json!(summary));
    arguments.insert("summary".to_string(), json!(summary));
    arguments.insert("agent_status".to_string(), json!("active"));
    arguments.insert("metadata".to_string(), Value::Object(metadata));
    if let Some(lane) = lane.map(str::trim).filter(|value| !value.is_empty()) {
        arguments.insert("lane".to_string(), json!(lane));
    }
    if let Some(local_task_id) = local_task_id.map(str::trim).filter(|value| !value.is_empty()) {
        arguments.insert("task_id".to_string(), json!(local_task_id));
        arguments.insert("run_id".to_string(), json!(local_task_id));
    }
    if let Some(repo_id) = identity.repo_id.as_deref() {
        arguments.insert("repo_id".to_string(), json!(repo_id));
    }
    if let Some(repo_path) = identity.repo_path.as_ref() {
        let repo_path = repo_path.to_string_lossy().to_string();
        arguments.insert("repo_path".to_string(), json!(repo_path.clone()));
        arguments.insert("workspace_root".to_string(), json!(repo_path));
    }
    if let Some(workspace_id) = identity.workspace_id.as_deref() {
        arguments.insert("workspace_id".to_string(), json!(workspace_id));
    }
    if let Some(agent_id) = identity.cloud_agent_id() {
        arguments.insert("agent_id".to_string(), json!(agent_id.clone()));
        arguments.insert("self_agent_id".to_string(), json!(agent_id.clone()));
        arguments.insert("current_agent_id".to_string(), json!(agent_id));
    }
    if let Some(session_id) = identity.session_id.as_deref() {
        arguments.insert("session_id".to_string(), json!(session_id));
    }

    let request = json!({
        "event_kind": event_kind,
        "payload": Value::Object(arguments),
        "ts_ms": cloud_mcp_now_ms(),
    });
    identity.log("cloud_mcp.agent_checkpoint.start", event_kind, json!({
        "activity": "agent checkpoint",
        "baseUrl": base_url,
        "summary": clean_terminal_telemetry_text(summary),
    }));
    match cloud_mcp_proxy_post_json_endpoint(&base_url, "/v1/events", &request.to_string()) {
        Ok(response) => {
            identity.log("cloud_mcp.agent_checkpoint.done", event_kind, json!({
                "activity": "agent checkpoint synced",
                "baseUrl": base_url,
            }));
            let parsed = serde_json::from_str::<Value>(&response)
                .unwrap_or_else(|_| json!({"raw_response": response}));
            Ok(parsed)
        }
        Err(error) => {
            identity.log("cloud_mcp.agent_checkpoint.error", event_kind, json!({
                "activity": "agent checkpoint sync failed",
                "baseUrl": base_url,
                "error": clean_terminal_telemetry_text(&error),
            }));
            Err(error)
        }
    }
}

pub(crate) fn cloud_mcp_forward_agent_start_task(
    repo_path: Option<&str>,
    db_path: Option<&Path>,
    workspace_id: Option<&str>,
    agent_id: Option<&str>,
    session_id: Option<&str>,
    local_task_id: Option<&str>,
    worktree_id: Option<&str>,
    worktree_path: Option<&str>,
    lane: Option<&str>,
    task_title: Option<&str>,
    task_body: Option<&str>,
    plan: &str,
) -> Result<Value, String> {
    let plan = cloud_mcp_clean_prompt_text(plan);
    if plan.trim().is_empty() {
        return Err("start_task plan is required for Cloud MCP spec classification.".to_string());
    }
    let repo_path_text = repo_path
        .or(worktree_path)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let repo_id = repo_path_text
        .as_deref()
        .map(|value| format!("repo-{}", cloud_mcp_short_hash(value)));
    let base_url = cloud_mcp_base_url();
    let identity = CloudMcpProxyIdentity {
        base_url: Some(base_url.clone()),
        repo_path: repo_path_text.as_ref().map(PathBuf::from),
        repo_id,
        workspace_id: workspace_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        workspace_name: None,
        agent_id: agent_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        session_id: session_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        coordination_db_path: db_path.map(Path::to_path_buf),
        pane_id: None,
        terminal_instance_id: None,
        slot_key: None,
        agent_label: agent_id.and_then(cloud_mcp_short_agent_label),
        client_id: "rust-diffforge-agent-start-task".to_string(),
    };
    let title = task_title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| cloud_mcp_prompt_summary(&plan));
    let event_kind = "agent_started_work";
    let mut metadata = serde_json::Map::new();
    metadata.insert("reported_by".to_string(), json!("coordination-kernel.start_task"));
    metadata.insert("intent_phase".to_string(), json!("agent_start_task_plan"));
    metadata.insert("start_task_plan".to_string(), json!(plan.clone()));
    if let Some(local_task_id) = local_task_id {
        metadata.insert("local_coordination_task_id".to_string(), json!(local_task_id));
        metadata.insert("coordination_task_id".to_string(), json!(local_task_id));
    }
    if let Some(worktree_id) = worktree_id {
        metadata.insert("worktree_id".to_string(), json!(worktree_id));
    }
    if let Some(worktree_path) = worktree_path {
        metadata.insert("worktree_path".to_string(), json!(worktree_path));
    }

    let mut arguments = serde_json::Map::new();
    arguments.insert("source".to_string(), json!("rust-diffforge-agent-start-task"));
    arguments.insert("client_id".to_string(), json!(identity.client_id.clone()));
    arguments.insert("title".to_string(), json!(title));
    arguments.insert("body".to_string(), json!(plan.clone()));
    arguments.insert("summary".to_string(), json!(plan.clone()));
    arguments.insert("prompt".to_string(), json!(plan.clone()));
    arguments.insert("source_prompt".to_string(), json!(plan.clone()));
    arguments.insert("status".to_string(), json!("active"));
    arguments.insert("metadata".to_string(), Value::Object(metadata));
    if let Some(task_body) = task_body.map(str::trim).filter(|value| !value.is_empty()) {
        arguments.insert("expected_output".to_string(), json!(task_body));
    }
    if let Some(lane) = lane.map(str::trim).filter(|value| !value.is_empty()) {
        arguments.insert("lane".to_string(), json!(lane));
    }
    if let Some(local_task_id) = local_task_id.map(str::trim).filter(|value| !value.is_empty()) {
        arguments.insert("run_id".to_string(), json!(local_task_id));
        arguments.insert("task_id".to_string(), json!(local_task_id));
    }
    if let Some(repo_id) = identity.repo_id.as_deref() {
        arguments.insert("repo_id".to_string(), json!(repo_id));
    }
    if let Some(repo_path) = identity.repo_path.as_ref() {
        let repo_path = repo_path.to_string_lossy().to_string();
        arguments.insert("repo_path".to_string(), json!(repo_path.clone()));
        arguments.insert("workspace_root".to_string(), json!(repo_path));
    }
    if let Some(workspace_id) = identity.workspace_id.as_deref() {
        arguments.insert("workspace_id".to_string(), json!(workspace_id));
    }
    if let Some(agent_id) = identity.cloud_agent_id() {
        arguments.insert("agent_id".to_string(), json!(agent_id.clone()));
        arguments.insert("self_agent_id".to_string(), json!(agent_id.clone()));
        arguments.insert("current_agent_id".to_string(), json!(agent_id));
    }
    if let Some(session_id) = identity.session_id.as_deref() {
        arguments.insert("session_id".to_string(), json!(session_id));
    }

    let event_request = json!({
        "event_kind": event_kind,
        "payload": Value::Object(arguments.clone()),
        "ts_ms": cloud_mcp_now_ms(),
    });
    identity.log("cloud_mcp.agent_start_task.start", event_kind, json!({
        "activity": "agent start_task plan",
        "baseUrl": base_url,
        "plan": clean_terminal_telemetry_text(&plan),
    }));
    let event_response =
        cloud_mcp_proxy_post_json_endpoint(&base_url, "/v1/events", &event_request.to_string())?;
    let event_parsed =
        serde_json::from_str::<Value>(&event_response).unwrap_or_else(|_| json!({"raw_response": event_response}));
    let event_data = event_parsed
        .get("data")
        .cloned()
        .unwrap_or_else(|| event_parsed.clone());

    let mut context_payload = arguments;
    context_payload.insert("history_limit".to_string(), json!(30));
    context_payload.insert("agent_limit".to_string(), json!(50));
    let context_request = Value::Object(context_payload.clone());
    let context_pack = cloud_mcp_proxy_post_json_endpoint(
        &base_url,
        "/v1/context/pack",
        &context_request.to_string(),
    )
    .ok()
    .and_then(|response| serde_json::from_str::<Value>(&response).ok())
    .map(|value| {
        value
            .get("data")
            .cloned()
            .unwrap_or(value)
    })
    .unwrap_or_else(|| json!({"ok": false, "error": "context_pack_refresh_failed"}));
    let spec_graph = cloud_mcp_proxy_post_json_endpoint(
        &base_url,
        "/v1/spec/graph",
        &context_request.to_string(),
    )
    .ok()
    .and_then(|response| serde_json::from_str::<Value>(&response).ok())
    .map(|value| {
        value
            .get("data")
            .cloned()
            .unwrap_or(value)
    })
    .unwrap_or_else(|| json!({"ok": false, "error": "spec_graph_refresh_failed"}));

    identity.log("cloud_mcp.agent_start_task.done", event_kind, json!({
        "activity": "agent start_task synced",
        "baseUrl": base_url,
        "specRecorded": event_data["spec_activity"]["recorded"].as_bool(),
        "specNodeCount": event_data["spec_activity"]["node_ids"].as_array().map(Vec::len),
    }));

    Ok(json!({
        "event": event_data,
        "spec_activity": event_data["spec_activity"].clone(),
        "context_pack": context_pack,
        "spec_graph": {
            "kind": spec_graph["kind"].clone(),
            "version": spec_graph["version"].clone(),
            "repo_id": spec_graph["repo_id"].clone(),
            "workspace_id": spec_graph["workspace_id"].clone(),
            "graph_stats": spec_graph["graph_stats"].clone(),
            "agent_work": spec_graph["agent_work"].clone(),
            "node_count": spec_graph["nodes"].as_array().map(Vec::len).unwrap_or(0),
        },
    }))
}

fn cloud_mcp_proxy_read_message<R: std::io::BufRead>(
    reader: &mut R,
) -> Result<Option<(String, bool)>, String> {
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

    let cloud_agent_id = identity.cloud_agent_id();
    cloud_mcp_proxy_insert_if_missing(arguments, "client_id", Some(identity.client_id.as_str()));
    cloud_mcp_proxy_insert_if_missing(arguments, "repo_id", identity.repo_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "workspace_id", identity.workspace_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "workspace_name", identity.workspace_name.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "agent_id", cloud_agent_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "self_agent_id", cloud_agent_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "current_agent_id", cloud_agent_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "actor", cloud_agent_id.as_deref());
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
    cloud_mcp_proxy_insert_local_file_scope(arguments, identity, tool_name);

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
    if let Some(cloud_agent_id) = identity.cloud_agent_id() {
        metadata
            .entry("cloud_agent_id".to_string())
            .or_insert_with(|| json!(cloud_agent_id));
    }
    if let Some(agent_id) = identity.agent_id.as_deref() {
        metadata
            .entry("local_agent_id".to_string())
            .or_insert_with(|| json!(agent_id));
    }
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

fn cloud_mcp_proxy_insert_local_file_scope(
    arguments: &mut serde_json::Map<String, Value>,
    identity: &CloudMcpProxyIdentity,
    tool_name: &str,
) {
    let (active_leases, parked_intents) = cloud_mcp_proxy_local_file_scope(identity);
    let git_changed_files =
        cloud_mcp_proxy_git_changed_files(identity, &active_leases, &parked_intents);
    if active_leases.is_empty() && parked_intents.is_empty() && git_changed_files.is_empty() {
        return;
    }

    let mut combined = Vec::new();
    combined.extend(active_leases.iter().cloned());
    combined.extend(parked_intents.iter().cloned());
    if json_array_argument_empty(arguments, "claimed_paths")
        && json_array_argument_empty(arguments, "claimedPaths")
    {
        arguments.insert("claimed_paths".to_string(), json!(combined));
    }
    if !git_changed_files.is_empty()
        && json_array_argument_empty(arguments, "changed_files")
        && json_array_argument_empty(arguments, "changedFiles")
    {
        arguments.insert("changed_files".to_string(), json!(git_changed_files.clone()));
    }
    if matches!(
        tool_name,
        "agent_heartbeat" | "checkpoint_recorded" | "agent_started_work" | "agent_work_started"
    ) {
        arguments
            .entry("record_spec_activity".to_string())
            .or_insert_with(|| json!(true));
        arguments
            .entry("spec_source".to_string())
            .or_insert_with(|| {
                if git_changed_files.is_empty() {
                    json!("local_lease_scope")
                } else {
                    json!("local_git_worktree_changes")
                }
            });
    }

    let metadata = cloud_mcp_proxy_completion_metadata(arguments);
    if !active_leases.is_empty() || !parked_intents.is_empty() {
        metadata
            .entry("local_lease_file_evidence".to_string())
            .or_insert_with(|| json!(true));
    }
    if !active_leases.is_empty() {
        metadata
            .entry("local_active_leases".to_string())
            .or_insert_with(|| json!(active_leases));
    }
    if !parked_intents.is_empty() {
        metadata
            .entry("local_parked_resource_intents".to_string())
            .or_insert_with(|| json!(parked_intents));
    }
    if !git_changed_files.is_empty() {
        metadata
            .entry("local_git_changed_file_evidence".to_string())
            .or_insert_with(|| json!(true));
        metadata
            .entry("local_git_changed_files".to_string())
            .or_insert_with(|| json!(git_changed_files.clone()));
        metadata
            .entry("changed_files".to_string())
            .or_insert_with(|| json!(git_changed_files));
    }
}

fn cloud_mcp_proxy_local_file_scope(identity: &CloudMcpProxyIdentity) -> (Vec<Value>, Vec<Value>) {
    let Some(db_path) = identity.coordination_db_path.as_ref() else {
        return (Vec::new(), Vec::new());
    };
    let conn = match rusqlite::Connection::open(db_path) {
        Ok(conn) => conn,
        Err(_) => return (Vec::new(), Vec::new()),
    };
    let active_leases = identity
        .session_id
        .as_deref()
        .map(|session_id| cloud_mcp_proxy_active_leases_for_session(&conn, session_id))
        .unwrap_or_default();
    let parked_intents = cloud_mcp_proxy_current_local_task_id(identity)
        .map(|task_id| cloud_mcp_proxy_parked_intents_for_task(&conn, &task_id))
        .unwrap_or_default();
    (active_leases, parked_intents)
}

fn cloud_mcp_proxy_git_changed_files(
    identity: &CloudMcpProxyIdentity,
    active_leases: &[Value],
    parked_intents: &[Value],
) -> Vec<Value> {
    let Some(repo_path) = identity.repo_path.as_ref() else {
        return Vec::new();
    };
    let mut scopes = Vec::new();
    scopes.extend(active_leases.iter().cloned());
    scopes.extend(parked_intents.iter().cloned());
    cloud_mcp_git_changed_files_for_scope(repo_path, &scopes)
}

fn cloud_mcp_proxy_active_leases_for_session(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Vec<Value> {
    let mut statement = match conn.prepare(
        "SELECT r.resource_key, l.mode, l.reason
         FROM leases l
         JOIN resources r ON r.id=l.resource_id
         WHERE l.session_id=?1 AND l.status='active'
         ORDER BY l.acquired_at DESC
         LIMIT 50",
    ) {
        Ok(statement) => statement,
        Err(_) => return Vec::new(),
    };
    let rows = match statement.query_map([session_id], |row| {
        let resource_key: String = row.get(0)?;
        let mode: String = row.get(1)?;
        let reason: Option<String> = row.get(2)?;
        let path = resource_key
            .strip_prefix("file:")
            .unwrap_or(resource_key.as_str())
            .to_string();
        Ok(json!({
            "resource_key": resource_key,
            "path": path,
            "mode": mode,
            "reason": reason,
            "lease_state": "active",
        }))
    }) {
        Ok(rows) => rows,
        Err(_) => return Vec::new(),
    };
    rows.filter_map(Result::ok).collect()
}

fn cloud_mcp_proxy_parked_intents_for_task(
    conn: &rusqlite::Connection,
    task_id: &str,
) -> Vec<Value> {
    let mut statement = match conn.prepare(
        "SELECT resource_key, status, intent_summary
         FROM task_resource_intents
         WHERE task_id=?1
           AND status IN ('parked', 'parked_cycle_prevented', 'waiting', 'blocked', 'resume_ready')
         ORDER BY updated_at DESC
         LIMIT 50",
    ) {
        Ok(statement) => statement,
        Err(_) => return Vec::new(),
    };
    let rows = match statement.query_map([task_id], |row| {
        let resource_key: String = row.get(0)?;
        let status: String = row.get(1)?;
        let reason: Option<String> = row.get(2)?;
        let path = resource_key
            .strip_prefix("file:")
            .unwrap_or(resource_key.as_str())
            .to_string();
        Ok(json!({
            "resource_key": resource_key,
            "path": path,
            "mode": "write",
            "status": status,
            "reason": reason,
            "parked": true,
        }))
    }) {
        Ok(rows) => rows,
        Err(_) => return Vec::new(),
    };
    rows.filter_map(Result::ok).collect()
}

fn json_array_argument_empty(arguments: &serde_json::Map<String, Value>, key: &str) -> bool {
    arguments
        .get(key)
        .and_then(Value::as_array)
        .map(|values| values.is_empty())
        .unwrap_or(true)
}

fn json_array_argument_values(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> Option<Vec<Value>> {
    arguments
        .get(key)
        .and_then(Value::as_array)
        .map(|values| values.to_vec())
}

fn cloud_mcp_proxy_apply_completion_guard(
    request: &mut Value,
    identity: &CloudMcpProxyIdentity,
    tool_name: &str,
) -> Option<Value> {
    if tool_name != "checkpoint_recorded" {
        return None;
    }
    if request.get("method").and_then(Value::as_str) != Some("tools/call") {
        return None;
    }
    let arguments = request
        .get_mut("params")
        .and_then(|params| params.get_mut("arguments"))
        .and_then(Value::as_object_mut)?;

    let status_key = if json_string_field_eq(arguments, "task_status", "done") {
        Some("task_status")
    } else if json_string_field_eq(arguments, "taskStatus", "done") {
        Some("taskStatus")
    } else {
        None
    }?;

    let submission = cloud_mcp_proxy_local_patch_submission(identity);
    if submission
        .as_ref()
        .map(|submission| submission.patch_submitted)
        == Some(true)
    {
        let mut changed_files = submission
            .as_ref()
            .map(|submission| submission.changed_files.clone())
            .unwrap_or_default();
        if changed_files.is_empty() {
            changed_files = json_array_argument_values(arguments, "changed_files")
                .or_else(|| json_array_argument_values(arguments, "changedFiles"))
                .unwrap_or_default();
        }
        if !changed_files.is_empty()
            && json_array_argument_empty(arguments, "changed_files")
            && json_array_argument_empty(arguments, "changedFiles")
        {
            arguments.insert("changed_files".to_string(), json!(changed_files.clone()));
        }
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
        if !changed_files.is_empty() {
            metadata
                .entry("local_patch_changed_files".to_string())
                .or_insert_with(|| json!(changed_files.clone()));
            metadata
                .entry("changed_files".to_string())
                .or_insert_with(|| json!(changed_files));
        }
        let local_task_id = submission
            .as_ref()
            .and_then(|value| value.task_id.clone());
        return Some(json!({
            "activity": "completion allowed",
            "reason": "local_patch_applied",
            "localTaskId": local_task_id,
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
    changed_files: Vec<Value>,
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
    let changed_files = cloud_mcp_patch_changed_files_for_task(&conn, &task_id);
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
        changed_files,
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
    cloud_mcp_proxy_post_json_endpoint(base_url, "/mcp", body)
}

fn cloud_mcp_proxy_post_json_endpoint(
    base_url: &str,
    endpoint_path: &str,
    body: &str,
) -> Result<String, String> {
    use std::io::{Read as _, Write as _};

    let endpoint = cloud_mcp_proxy_parse_http_url(base_url, endpoint_path)?;
    let mut stream = std::net::TcpStream::connect((endpoint.host.as_str(), endpoint.port))
        .map_err(|error| format!("connect failed: {error}"))?;
    let timeout = std::time::Duration::from_secs(CLOUD_MCP_CONNECT_TIMEOUT_SECS as u64);
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let mut headers = String::new();
    let body_value = serde_json::from_str::<Value>(body).ok();
    let client_id = body_value
        .as_ref()
        .and_then(|value| {
            cloud_mcp_payload_text(value, &["client_id"])
                .or_else(|| cloud_mcp_payload_text(value, &["payload", "client_id"]))
        })
        .unwrap_or_else(|| CLOUD_MCP_RUST_CLIENT_ID.to_string());
    headers.push_str(&format!("x-diffforge-client-id: {}\r\n", client_id.trim()));
    if let Some(workspace_id) = body_value.as_ref().and_then(|value| {
        cloud_mcp_payload_text(value, &["workspace_id"])
            .or_else(|| cloud_mcp_payload_text(value, &["payload", "workspace_id"]))
    }) {
        headers.push_str(&format!("x-diffforge-workspace-id: {}\r\n", workspace_id.trim()));
    }
    if let Some(repo_id) = body_value.as_ref().and_then(|value| {
        cloud_mcp_payload_text(value, &["repo_id"])
            .or_else(|| cloud_mcp_payload_text(value, &["payload", "repo_id"]))
    }) {
        headers.push_str(&format!("x-diffforge-repo-id: {}\r\n", repo_id.trim()));
    }
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

fn cloud_mcp_proxy_parse_http_url(
    base_url: &str,
    endpoint_path: &str,
) -> Result<CloudMcpProxyEndpoint, String> {
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
    let path = format!(
        "{}/{}",
        prefix.trim_end_matches('/'),
        endpoint_path.trim_start_matches('/')
    );
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

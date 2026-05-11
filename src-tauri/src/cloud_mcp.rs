const CLOUD_MCP_DEFAULT_BASE_URL: &str = "http://127.0.0.1:8080";
const CLOUD_MCP_CONNECT_TIMEOUT_SECS: u64 = 3;
const CLOUD_MCP_SYNC_TIMEOUT_SECS: u64 = 8;
const CLOUD_MCP_FILETREE_LIMIT: usize = 900;
const CLOUD_MCP_FILETREE_MAX_DEPTH: usize = 8;
const CLOUD_MCP_TODO_MAX_BYTES: usize = 128 * 1024;

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
    plan_gates: HashMap<String, CloudMcpPlanGate>,
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
    pending_plan_count: usize,
    accepted_plan_count: usize,
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
struct CloudMcpPolicyResult {
    status: CloudMcpStatus,
    policy_graph: Value,
    proposals: Value,
    orchestration: Value,
    alignment_report: Value,
    server_status: Value,
    proposal_id: String,
    message: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudMcpPlanGate {
    root: String,
    prompt_hash: String,
    prompt_preview: String,
    run_id: String,
    local_run_id: String,
    status: String,
    plan: Value,
    cloud_response: Value,
    created_at_ms: u64,
    accepted_at_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudMcpPlanResult {
    status: CloudMcpStatus,
    run_id: String,
    prompt_hash: String,
    cloud_response: Value,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudMcpPlanDecisionResult {
    status: CloudMcpStatus,
    decision: String,
    run_id: String,
    server_response: Value,
    local_adoption: Value,
    recorded_at_ms: u64,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudMcpDecisionResult {
    status: CloudMcpStatus,
    decision: String,
    proposal_id: String,
    server_response: Value,
    recorded_at_ms: u64,
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
                plan_gates: HashMap::new(),
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

fn cloud_mcp_snapshot(runtime: &CloudMcpRuntime) -> CloudMcpStatus {
    let mut registered_workspaces = runtime
        .registered_workspaces
        .values()
        .cloned()
        .collect::<Vec<_>>();
    registered_workspaces.sort_by(|left, right| left.root.cmp(&right.root));
    let pending_plan_count = runtime
        .plan_gates
        .values()
        .filter(|gate| gate.status == "pending")
        .count();
    let accepted_plan_count = runtime
        .plan_gates
        .values()
        .filter(|gate| gate.status == "accepted")
        .count();

    CloudMcpStatus {
        base_url: runtime.base_url.clone(),
        connected: runtime.connected,
        status: runtime.status.clone(),
        last_error: runtime.last_error.clone(),
        last_connected_ms: runtime.last_connected_ms,
        registered_workspace_count: registered_workspaces.len(),
        registered_workspaces,
        pending_plan_count,
        accepted_plan_count,
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
    cloud_mcp_connected_or_connect(state, "terminal_gate").await
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

fn cloud_mcp_workspace_plan_dir(root: &Path) -> PathBuf {
    cloud_mcp_workspace_control_dir(root).join("plans")
}

fn cloud_mcp_plan_gate_path(root: &Path, run_id: &str) -> PathBuf {
    cloud_mcp_workspace_plan_dir(root).join(format!("{run_id}.json"))
}

fn cloud_mcp_write_plan_gate(root: &Path, gate: &CloudMcpPlanGate) -> Result<(), String> {
    let dir = cloud_mcp_workspace_plan_dir(root);
    fs::create_dir_all(&dir).map_err(|error| {
        format!(
            "Unable to create Cloud MCP plan gate directory {}: {error}",
            dir.display()
        )
    })?;
    let path = cloud_mcp_plan_gate_path(root, &gate.run_id);
    let body = serde_json::to_vec_pretty(gate)
        .map_err(|error| format!("Unable to serialize Cloud MCP plan gate: {error}"))?;
    fs::write(&path, body).map_err(|error| {
        format!(
            "Unable to write Cloud MCP plan gate {}: {error}",
            path.display()
        )
    })
}

fn cloud_mcp_read_plan_gate(root: &Path, run_id: &str) -> Option<CloudMcpPlanGate> {
    let path = cloud_mcp_plan_gate_path(root, run_id);
    let body = fs::read_to_string(path).ok()?;
    serde_json::from_str(&body).ok()
}

fn cloud_mcp_find_plan_gate_for_prompt(root: &Path, prompt_hash: &str) -> Option<CloudMcpPlanGate> {
    let dir = cloud_mcp_workspace_plan_dir(root);
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let body = fs::read_to_string(path).ok()?;
        let gate = serde_json::from_str::<CloudMcpPlanGate>(&body).ok()?;
        if gate.prompt_hash == prompt_hash {
            return Some(gate);
        }
    }
    None
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
    let response = state
        .client
        .post(&url)
        .timeout(Duration::from_secs(CLOUD_MCP_SYNC_TIMEOUT_SECS))
        .json(payload)
        .send()
        .await
        .map_err(|error| format!("Unable to POST {endpoint} to Cloud MCP: {error}"))?;

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

fn cloud_mcp_plan_key(root: &str, prompt_hash: &str) -> String {
    format!("{root}::{prompt_hash}")
}

fn cloud_mcp_prompt_hash(prompt: &str) -> String {
    cloud_mcp_short_hash(prompt.trim())
}

fn cloud_mcp_prompt_preview(prompt: &str) -> String {
    clean_terminal_telemetry_text(prompt)
        .chars()
        .take(180)
        .collect()
}

fn cloud_mcp_prompt_excerpt(value: &str, max_chars: usize) -> String {
    value
        .replace(|character: char| character.is_control(), " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

fn cloud_mcp_plan_array_text(value: &Value, max_items: usize, max_chars: usize) -> String {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .take(max_items)
                .filter_map(|item| item.as_str())
                .map(|item| cloud_mcp_prompt_excerpt(item, max_chars))
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
                .join("; ")
        })
        .unwrap_or_default()
}

fn cloud_mcp_enhanced_prompt(original_prompt: &str, gate: &CloudMcpPlanGate) -> String {
    let mut lines = vec![
        "Use this accepted Cloud MCP plan as the execution contract.".to_string(),
        String::new(),
        "Original user request:".to_string(),
        cloud_mcp_prompt_excerpt(original_prompt, 900),
        String::new(),
        format!("Cloud run id: {}", gate.run_id),
    ];
    if !gate.local_run_id.trim().is_empty() {
        lines.push(format!("Local coordination run id: {}", gate.local_run_id));
    }
    if let Some(summary) = gate.plan["summary"].as_str() {
        lines.push(format!(
            "Plan summary: {}",
            cloud_mcp_prompt_excerpt(summary, 900)
        ));
    }

    let items = gate.plan["items"].as_array().cloned().unwrap_or_default();
    if !items.is_empty() {
        lines.push(String::new());
        lines.push("Accepted plan tasks:".to_string());
        for (index, item) in items.iter().take(8).enumerate() {
            let title = item["title"]
                .as_str()
                .map(|value| cloud_mcp_prompt_excerpt(value, 160))
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "Untitled task".to_string());
            let role = item["role"]
                .as_str()
                .or_else(|| item["assigned_role"].as_str())
                .map(|value| cloud_mcp_prompt_excerpt(value, 80))
                .unwrap_or_else(|| "coding_agent".to_string());
            lines.push(format!("{}. {} [{}]", index + 1, title, role));
            if let Some(body) = item["body"].as_str() {
                lines.push(format!("   Scope: {}", cloud_mcp_prompt_excerpt(body, 420)));
            }
            let required = cloud_mcp_plan_array_text(&item["required_resources"], 8, 120);
            if !required.is_empty() {
                lines.push(format!("   Required resources: {required}"));
            }
            let outputs = cloud_mcp_plan_array_text(&item["expected_outputs"], 8, 140);
            if !outputs.is_empty() {
                lines.push(format!("   Expected outputs: {outputs}"));
            }
            let depends = cloud_mcp_plan_array_text(&item["depends_on"], 8, 120);
            if !depends.is_empty() {
                lines.push(format!("   Depends on: {depends}"));
            }
        }
    }

    let qa_checks = cloud_mcp_plan_array_text(&gate.plan["qa_checks"], 8, 160);
    if !qa_checks.is_empty() {
        lines.push(String::new());
        lines.push(format!("QA checks from plan: {qa_checks}"));
    }

    let contracts = gate.plan["contracts"].as_array().cloned().unwrap_or_default();
    if !contracts.is_empty() {
        lines.push(String::new());
        lines.push("Plan contracts:".to_string());
        for contract in contracts.iter().take(5) {
            let title = contract["title"]
                .as_str()
                .map(|value| cloud_mcp_prompt_excerpt(value, 140))
                .unwrap_or_else(|| "Contract".to_string());
            let body = contract["body"]
                .as_str()
                .map(|value| cloud_mcp_prompt_excerpt(value, 360))
                .unwrap_or_default();
            lines.push(format!("- {title}: {body}"));
        }
    }

    lines.extend([
        String::new(),
        "Execution rules:".to_string(),
        "- Follow AGENTS.md and the local policy-first workflow.".to_string(),
        "- Use the coordination-kernel MCP before edits: get brief, claim/adopt the relevant task, acquire leases, and submit through patch/merge gates.".to_string(),
        "- Do not bypass the accepted Cloud MCP plan; if repository evidence conflicts with it, stop and report the conflict.".to_string(),
        "- Keep the change scoped to the accepted plan and preserve unrelated user changes.".to_string(),
    ]);

    let prompt = lines.join("\n");
    prompt.chars().take(6_000).collect()
}

fn cloud_mcp_workspace_name_for_root(root: &Path) -> String {
    root.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Local workspace".to_string())
}

async fn cloud_mcp_prepare_task_plan_for_prompt(
    state: &CloudMcpState,
    root: &Path,
    prompt: &str,
    reason: &str,
) -> Result<CloudMcpPlanGate, String> {
    let prompt = prompt.trim();
    let root = root.to_path_buf();
    let root_display = workspace_path_display(&root);
    let prompt_hash = cloud_mcp_prompt_hash(prompt);
    let key = cloud_mcp_plan_key(&root_display, &prompt_hash);

    if let Some(existing) = {
        let runtime = state.inner.lock().await;
        runtime.plan_gates.get(&key).cloned()
    } {
        if existing.status != "rejected" {
            return Ok(existing);
        }
    }

    let workspace_id = format!("local-{}", cloud_mcp_short_hash(&root_display));
    let workspace_name = cloud_mcp_workspace_name_for_root(&root);
    let prepared_root = root.clone();
    let prepared_workspace_id = workspace_id.clone();
    let prepared_workspace_name = workspace_name.clone();
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        cloud_mcp_prepare_workspace_from_root(
            prepared_root,
            Some(prepared_workspace_id),
            Some(prepared_workspace_name),
        )
    })
    .await
    .map_err(|error| format!("Unable to prepare Cloud MCP prompt plan context: {error}"))??;
    let _ = cloud_mcp_register_prepared_workspace(state, prepared, reason).await?;

    let payload = json!({
        "source": "rust-diffforge-terminal-gate",
        "objective": prompt,
        "request_text": prompt,
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "repo_path": root_display,
        "prompt_hash": prompt_hash,
        "requires_local_acceptance": true,
        "ts_ms": cloud_mcp_now_ms(),
    });
    let cloud_response = cloud_mcp_post_json_endpoint(state, "/v1/orchestration/proposals", &payload).await?;
    let data = cloud_mcp_response_data(&cloud_response);
    let run_id = data["run_id"]
        .as_str()
        .or_else(|| data["proposal_id"].as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Cloud MCP plan proposal response did not include run_id.".to_string())?
        .to_string();
    let gate = CloudMcpPlanGate {
        root: root_display.clone(),
        prompt_hash: prompt_hash.clone(),
        prompt_preview: cloud_mcp_prompt_preview(prompt),
        run_id: run_id.clone(),
        local_run_id: String::new(),
        status: "pending".to_string(),
        plan: data["plan"].clone(),
        cloud_response: cloud_response.clone(),
        created_at_ms: cloud_mcp_now_ms(),
        accepted_at_ms: None,
    };
    cloud_mcp_write_plan_gate(&root, &gate)?;
    {
        let mut runtime = state.inner.lock().await;
        runtime.plan_gates.insert(key, gate.clone());
    }
    let _ = cloud_mcp_workspace_log(
        &root,
        "cloud_mcp.plan.proposal_created",
        "",
        "",
        json!({
            "run_id": run_id,
            "prompt_hash": prompt_hash,
            "reason": reason,
            "status": "pending",
        }),
    );
    Ok(gate)
}

async fn cloud_mcp_require_prompt_plan_accepted(
    state: &CloudMcpState,
    root: &Path,
    prompt: &str,
) -> Result<String, String> {
    let prompt = prompt.trim();
    let root_display = workspace_path_display(root);
    let prompt_hash = cloud_mcp_prompt_hash(prompt);
    let key = cloud_mcp_plan_key(&root_display, &prompt_hash);

    if let Some(gate) = {
        let runtime = state.inner.lock().await;
        runtime.plan_gates.get(&key).cloned()
    }
    .or_else(|| cloud_mcp_find_plan_gate_for_prompt(root, &prompt_hash))
    {
        return match gate.status.as_str() {
            "accepted" => Ok(cloud_mcp_enhanced_prompt(prompt, &gate)),
            "pending" => Err(format!(
                "Cloud MCP created plan {} for this prompt. Accept or reject it in the Policy tab before code can run.",
                gate.run_id
            )),
            "rejected" => Err(format!(
                "Cloud MCP plan {} was rejected. Revise the request before running code.",
                gate.run_id
            )),
            _ => Err(format!(
                "Cloud MCP plan {} is {}. Accept it before running code.",
                gate.run_id, gate.status
            )),
        };
    }

    let gate = cloud_mcp_prepare_task_plan_for_prompt(state, root, prompt, "terminal_prompt_gate").await?;
    Err(format!(
        "Cloud MCP created plan {} for this prompt. Open the Policy tab, review it, then Accept before the terminal sends this to the agent.",
        gate.run_id
    ))
}

fn cloud_mcp_adopt_plan_locally(
    root: &Path,
    cloud_run_id: &str,
    objective: &str,
    plan: &Value,
    endpoint_url: &str,
) -> Result<Value, String> {
    let kernel = crate::coordination::CoordinationKernel::init(root, None)?;
    let _ = kernel.update_cloud_orchestrator_config(&json!({
        "enabled": true,
        "mode": "http_stub",
        "endpoint_url": endpoint_url,
        "context_export_policy": "redacted_summaries",
        "auto_create_tasks": true,
        "auto_assign_agents": true,
        "auto_spawn_terminals": false,
        "allow_code_export": false,
        "allow_terminal_log_export": false,
        "allow_patch_export": false,
    }))?;
    let local_run = kernel.create_orchestration_run(
        objective,
        Some(json!({
            "source": "cloud_mcp",
            "cloud_run_id": cloud_run_id,
            "requires_human_acceptance": true,
        })),
    )?;
    let local_run_id = local_run["data"]["run_id"]
        .as_str()
        .ok_or_else(|| "Local orchestration run did not include run_id.".to_string())?
        .to_string();
    let imported = kernel.import_orchestration_plan(&local_run_id, plan)?;
    let adopted = kernel.adopt_orchestration_plan(&local_run_id)?;
    let assignments = kernel.propose_agent_assignments(&local_run_id)?;
    Ok(json!({
        "local_run_id": local_run_id,
        "local_run": local_run,
        "imported": imported,
        "adopted": adopted,
        "assignments": assignments,
    }))
}

async fn cloud_mcp_post_sync(state: &CloudMcpState, payload: &Value) -> Result<Value, String> {
    let mut last_error = String::new();
    for endpoint in ["/v1/sync/push", "/v1/sync/once"] {
        match cloud_mcp_post_json_endpoint(state, endpoint, payload).await {
            Ok(value) => return Ok(value),
            Err(error) => last_error = error,
        }
    }

    Err(last_error)
}

async fn cloud_mcp_register_prepared_workspace(
    state: &CloudMcpState,
    prepared: CloudMcpPreparedWorkspace,
    reason: &str,
) -> Result<CloudMcpWorkspaceRegistrationResult, String> {
    cloud_mcp_connected_or_connect(state, reason).await?;
    let register_started_at = Instant::now();
    let policy_graph_detected = prepared.policy_graph.is_some();
    let policy_graph_path = prepared.policy_graph_path.clone();
    let file_count = prepared.filetree.len();
    let log_path = cloud_mcp_workspace_log(
        &prepared.root,
        "cloud_mcp.workspace.registration.start",
        &prepared.workspace_id,
        &prepared.workspace_name,
        json!({
            "reason": reason,
            "file_count": file_count,
            "filetree_truncated": prepared.filetree_truncated,
            "policy_graph_detected": policy_graph_detected,
            "policy_graph_path": policy_graph_path,
        }),
    )?;

    let payload = json!({
        "source": "rust-diffforge",
        "client_id": env::var("RUST_DIFFFORGE_CLIENT_ID").unwrap_or_else(|_| "rust-diffforge-local".to_string()),
        "reason": reason,
        "workspace_id": prepared.workspace_id.clone(),
        "workspace_name": prepared.workspace_name.clone(),
        "repo_path": prepared.root_display.clone(),
        "workspace_root": prepared.root_display.clone(),
        "directory": prepared.root_display.clone(),
        "root": prepared.root_display.clone(),
        "filetree": {
            "root": prepared.root_display.clone(),
            "entries": prepared.filetree.clone(),
            "truncated": prepared.filetree_truncated,
        },
        "files": prepared.filetree.clone(),
        "policy_graph_detected": policy_graph_detected,
        "policy_graph_path": policy_graph_path.clone(),
        "policy_graph": prepared.policy_graph.clone(),
        "todo_queue": prepared.todo_queue.clone(),
        "ts_ms": cloud_mcp_now_ms(),
    });

    let server_response = match cloud_mcp_post_sync(state, &payload).await {
        Ok(value) => value,
        Err(error) => {
            let workspace = CloudMcpWorkspaceStatus {
                root: prepared.root_display.clone(),
                workspace_id: prepared.workspace_id.clone(),
                workspace_name: prepared.workspace_name.clone(),
                last_registered_ms: None,
                last_synced_ms: None,
                last_error: error.clone(),
                file_count,
                policy_graph_detected,
                policy_graph_path: policy_graph_path.clone(),
            };

            {
                let mut runtime = state.inner.lock().await;
                runtime
                    .registered_workspaces
                    .insert(prepared.root_display.clone(), workspace);
            }

            let _ = cloud_mcp_workspace_log(
                &prepared.root,
                "cloud_mcp.workspace.registration.error",
                &prepared.workspace_id,
                &prepared.workspace_name,
                json!({
                    "reason": reason,
                    "error": clean_terminal_telemetry_text(&error),
                    "elapsed_ms": register_started_at.elapsed().as_secs_f64() * 1000.0,
                }),
            );
            log_terminal_event(
                "cloud_mcp.workspace.registration.error",
                None,
                None,
                Some(register_started_at.elapsed()),
                json!({
                    "root": clean_terminal_telemetry_text(&prepared.root_display),
                    "workspace_id": clean_terminal_telemetry_text(&prepared.workspace_id),
                    "reason": clean_terminal_telemetry_text(reason),
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );

            return Err(format!(
                "Cloud MCP workspace registration failed for {}: {error}",
                prepared.root_display
            ));
        }
    };

    let now_ms = cloud_mcp_now_ms();
    let workspace = CloudMcpWorkspaceStatus {
        root: prepared.root_display.clone(),
        workspace_id: prepared.workspace_id.clone(),
        workspace_name: prepared.workspace_name.clone(),
        last_registered_ms: Some(now_ms),
        last_synced_ms: Some(now_ms),
        last_error: String::new(),
        file_count,
        policy_graph_detected,
        policy_graph_path: policy_graph_path.clone(),
    };

    let status = {
        let mut runtime = state.inner.lock().await;
        runtime.connected = true;
        runtime.status = "connected".to_string();
        runtime.last_error.clear();
        runtime.last_connected_ms = Some(now_ms);
        runtime
            .registered_workspaces
            .insert(prepared.root_display.clone(), workspace.clone());
        cloud_mcp_snapshot(&runtime)
    };

    let _ = cloud_mcp_workspace_log(
        &prepared.root,
        "cloud_mcp.workspace.registration.done",
        &prepared.workspace_id,
        &prepared.workspace_name,
        json!({
            "reason": reason,
            "file_count": file_count,
            "filetree_truncated": prepared.filetree_truncated,
            "policy_graph_detected": policy_graph_detected,
            "policy_graph_path": policy_graph_path,
            "elapsed_ms": register_started_at.elapsed().as_secs_f64() * 1000.0,
        }),
    );
    log_terminal_event(
        "cloud_mcp.workspace.registration.done",
        None,
        None,
        Some(register_started_at.elapsed()),
        json!({
            "root": clean_terminal_telemetry_text(&prepared.root_display),
            "workspace_id": clean_terminal_telemetry_text(&prepared.workspace_id),
            "workspace_name": clean_terminal_telemetry_text(&prepared.workspace_name),
            "reason": clean_terminal_telemetry_text(reason),
            "file_count": file_count,
            "policy_graph_detected": policy_graph_detected,
        }),
    );

    Ok(CloudMcpWorkspaceRegistrationResult {
        status,
        workspace,
        server_response,
        synced: true,
        log_path: workspace_path_display(&log_path),
        message: format!("Cloud MCP registered and synced {}", prepared.root_display),
    })
}

async fn require_cloud_mcp_terminal_gate(
    state: &CloudMcpState,
    working_directory: Option<&str>,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
) -> Result<CloudMcpStatus, String> {
    let status = require_cloud_mcp_connected_state(state).await?;
    let root = resolve_workspace_root_directory(working_directory)?;
    let root_display = workspace_path_display(&root);
    let already_registered = {
        let runtime = state.inner.lock().await;
        runtime
            .registered_workspaces
            .get(&root_display)
            .is_some_and(|workspace| workspace.last_registered_ms.is_some() && workspace.last_error.is_empty())
    };

    if already_registered {
        log_terminal_event(
            "cloud_mcp.terminal_gate.reuse",
            None,
            None,
            None,
            json!({
                "root": clean_terminal_telemetry_text(&root_display),
                "workspace_id": workspace_id.map(clean_terminal_telemetry_text),
            }),
        );
        return Ok(status);
    }

    let workspace_id = workspace_id.map(ToOwned::to_owned);
    let workspace_name = workspace_name.map(ToOwned::to_owned);
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        cloud_mcp_prepare_workspace_from_root(root, workspace_id, workspace_name)
    })
    .await
    .map_err(|error| format!("Unable to prepare Cloud MCP workspace gate: {error}"))??;

    cloud_mcp_register_prepared_workspace(state, prepared, "terminal_gate")
        .await
        .map(|result| result.status)
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

fn cloud_mcp_extract_proposal_id(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in ["proposal_id", "proposalId", "activeProposalId", "active_proposal_id"] {
                if let Some(id) = map.get(key).and_then(Value::as_str) {
                    if !id.trim().is_empty() {
                        return Some(id.trim().to_string());
                    }
                }
            }

            map.values().find_map(cloud_mcp_extract_proposal_id)
        }
        Value::Array(values) => values.iter().find_map(cloud_mcp_extract_proposal_id),
        _ => None,
    }
}

#[tauri::command]
async fn cloud_mcp_get_policy(
    state: State<'_, CloudMcpState>,
    repo_path: Option<String>,
    workspace_id: Option<String>,
) -> Result<CloudMcpPolicyResult, String> {
    let status = cloud_mcp_connected_or_connect(state.inner(), "policy_fetch").await?;
    let policy_graph = cloud_mcp_get_json_optional(state.inner(), "/v1/policy/graph").await;
    let proposals = cloud_mcp_get_json_optional(state.inner(), "/v1/policy/proposals").await;
    let orchestration = cloud_mcp_get_json_optional(state.inner(), "/v1/orchestration/kanban").await;
    let alignment_report = cloud_mcp_get_json_optional(state.inner(), "/v1/alignment/report").await;
    let server_status = cloud_mcp_get_json_optional(state.inner(), "/v1/status").await;
    let proposal_id = cloud_mcp_extract_proposal_id(&proposals)
        .or_else(|| cloud_mcp_extract_proposal_id(&policy_graph))
        .or_else(|| cloud_mcp_extract_proposal_id(&alignment_report))
        .unwrap_or_default();

    if let Some(repo_path) = repo_path.filter(|value| !value.trim().is_empty()) {
        let workspace_id = workspace_id.unwrap_or_default();
        let workspace_name = String::new();
        if let Ok(root) = resolve_workspace_root_directory(Some(&repo_path)) {
            let _ = cloud_mcp_workspace_log(
                &root,
                "cloud_mcp.policy.fetch",
                &workspace_id,
                &workspace_name,
                json!({
                    "proposal_id": proposal_id,
                    "has_policy_graph": !policy_graph.is_null(),
                    "has_policy_proposals": !proposals.is_null(),
                    "has_orchestration": !orchestration.is_null(),
                    "has_alignment_report": !alignment_report.is_null(),
                }),
            );
        }
    }

    Ok(CloudMcpPolicyResult {
        status,
        policy_graph,
        proposals,
        orchestration,
        alignment_report,
        server_status,
        proposal_id,
        message: "Policy fetched from Cloud MCP.".to_string(),
    })
}

#[tauri::command]
async fn cloud_mcp_prepare_task_plan(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    objective: String,
) -> Result<CloudMcpPlanResult, String> {
    let root = tauri::async_runtime::spawn_blocking(move || {
        resolve_workspace_root_directory(Some(&repo_path))
    })
    .await
    .map_err(|error| format!("Unable to resolve Cloud MCP plan root: {error}"))??;
    let gate = cloud_mcp_prepare_task_plan_for_prompt(
        state.inner(),
        &root,
        &objective,
        "manual_plan_request",
    )
    .await?;
    let status = cloud_mcp_status_snapshot(state.inner()).await;
    Ok(CloudMcpPlanResult {
        status,
        run_id: gate.run_id,
        prompt_hash: gate.prompt_hash,
        cloud_response: gate.cloud_response,
        message: "Cloud MCP plan proposal created. Review it in Policy before agents run code."
            .to_string(),
    })
}

#[tauri::command]
async fn cloud_mcp_decide_plan(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    decision: String,
    run_id: String,
) -> Result<CloudMcpPlanDecisionResult, String> {
    let normalized_decision = decision.trim().to_ascii_lowercase();
    if !matches!(normalized_decision.as_str(), "accept" | "reject") {
        return Err("Cloud MCP plan decision must be accept or reject.".to_string());
    }
    let run_id = run_id.trim().to_string();
    if run_id.is_empty() {
        return Err("Cloud MCP plan run_id is required.".to_string());
    }
    let root = tauri::async_runtime::spawn_blocking(move || {
        resolve_workspace_root_directory(Some(&repo_path))
    })
    .await
    .map_err(|error| format!("Unable to resolve Cloud MCP plan decision root: {error}"))??;
    let recorded_at_ms = cloud_mcp_now_ms();
    let endpoint = if normalized_decision == "accept" {
        format!("/v1/orchestration/runs/{run_id}/accept")
    } else {
        format!("/v1/orchestration/runs/{run_id}/reject")
    };
    let server_response = cloud_mcp_post_json_endpoint(
        state.inner(),
        &endpoint,
        &json!({
            "source": "rust-diffforge",
            "decision": normalized_decision,
            "reason": "User decision from rust-diffforge Cloud MCP dock.",
            "ts_ms": recorded_at_ms,
        }),
    )
    .await?;

    let root_display = workspace_path_display(&root);
    let mut gate = {
        let runtime = state.inner.lock().await;
        runtime
            .plan_gates
            .values()
            .find(|gate| gate.root == root_display && gate.run_id == run_id)
            .cloned()
    }
    .or_else(|| cloud_mcp_read_plan_gate(&root, &run_id))
    .ok_or_else(|| {
        format!(
            "Cloud MCP plan {run_id} was not found locally. Recreate the plan from the terminal prompt before accepting."
        )
    })?;

    let local_adoption = if normalized_decision == "accept" {
        let base_url = {
            let runtime = state.inner.lock().await;
            runtime.base_url.clone()
        };
        let adoption = cloud_mcp_adopt_plan_locally(
            &root,
            &run_id,
            &gate.prompt_preview,
            &gate.plan,
            &base_url,
        )?;
        gate.status = "accepted".to_string();
        gate.accepted_at_ms = Some(recorded_at_ms);
        gate.local_run_id = adoption["local_run_id"].as_str().unwrap_or_default().to_string();
        adoption
    } else {
        gate.status = "rejected".to_string();
        json!({"status": "rejected"})
    };

    cloud_mcp_write_plan_gate(&root, &gate)?;
    {
        let mut runtime = state.inner.lock().await;
        let key = cloud_mcp_plan_key(&gate.root, &gate.prompt_hash);
        runtime.plan_gates.insert(key, gate.clone());
    }
    let _ = cloud_mcp_workspace_log(
        &root,
        "cloud_mcp.plan.decision",
        "",
        "",
        json!({
            "run_id": run_id,
            "decision": normalized_decision,
            "status": gate.status,
            "local_run_id": gate.local_run_id,
        }),
    );
    let status = cloud_mcp_status_snapshot(state.inner()).await;
    Ok(CloudMcpPlanDecisionResult {
        status,
        decision: normalized_decision.clone(),
        run_id,
        server_response,
        local_adoption,
        recorded_at_ms,
        message: if normalized_decision == "accept" {
            "Cloud MCP plan accepted and adopted into the local coordination kernel. The matching terminal prompt can now run.".to_string()
        } else {
            "Cloud MCP plan rejected. Revise the prompt before running code.".to_string()
        },
    })
}

#[tauri::command]
async fn cloud_mcp_decide_policy(
    state: State<'_, CloudMcpState>,
    repo_path: Option<String>,
    workspace_id: Option<String>,
    decision: String,
    proposal_id: Option<String>,
) -> Result<CloudMcpDecisionResult, String> {
    let normalized_decision = decision.trim().to_ascii_lowercase();
    if !matches!(normalized_decision.as_str(), "accept" | "reject") {
        return Err("Policy decision must be accept or reject.".to_string());
    }

    let status = cloud_mcp_connected_or_connect(state.inner(), "policy_decision").await?;
    let proposal_id = proposal_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default();
    let recorded_at_ms = cloud_mcp_now_ms();

    let server_response = if proposal_id.is_empty() {
        Value::Null
    } else {
        let endpoint = if normalized_decision == "accept" {
            format!("/v1/policy/proposals/{proposal_id}/accept")
        } else {
            format!("/v1/policy/proposals/{proposal_id}/reject")
        };
        cloud_mcp_post_json_endpoint(
            state.inner(),
            &endpoint,
            &json!({
                "source": "rust-diffforge",
                "decision": normalized_decision,
                "workspace_id": workspace_id.clone(),
                "repo_path": repo_path.clone(),
                "ts_ms": recorded_at_ms,
            }),
        )
        .await?
    };

    if let Some(repo_path) = repo_path.filter(|value| !value.trim().is_empty()) {
        if let Ok(root) = resolve_workspace_root_directory(Some(&repo_path)) {
            let _ = cloud_mcp_workspace_log(
                &root,
                "cloud_mcp.policy.decision",
                workspace_id.as_deref().unwrap_or_default(),
                "",
                json!({
                    "decision": normalized_decision,
                    "proposal_id": proposal_id,
                    "server_backed": !proposal_id.is_empty(),
                }),
            );
        }
    }

    Ok(CloudMcpDecisionResult {
        status,
        decision: normalized_decision,
        proposal_id: proposal_id.clone(),
        server_response,
        recorded_at_ms,
        message: if proposal_id.is_empty() {
            "Policy decision recorded locally; no server proposal id was present.".to_string()
        } else {
            "Policy decision sent to Cloud MCP.".to_string()
        },
    })
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
            "reason": "todo_queue_save",
            "workspace_id": workspace_id.clone(),
            "workspace_name": workspace_name.clone(),
            "repo_path": root_display.clone(),
            "workspace_root": root_display.clone(),
            "todo_queue": text.clone(),
            "ts_ms": saved_at_ms,
        });

        match cloud_mcp_post_sync(state.inner(), &payload).await {
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

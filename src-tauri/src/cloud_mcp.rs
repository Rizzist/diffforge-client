use notify::{
    Config as NotifyConfig, Event as NotifyEvent, EventKind as NotifyEventKind, RecommendedWatcher,
    RecursiveMode, Watcher,
};

const CLOUD_MCP_DEFAULT_BASE_URL: &str = "http://127.0.0.1:8080";
const CLOUD_MCP_CONNECT_TIMEOUT_SECS: u64 = 3;
const CLOUD_MCP_SYNC_TIMEOUT_SECS: u64 = 60;
const CLOUD_MCP_FILETREE_LIMIT: usize = 2_000;
const CLOUD_MCP_FILETREE_MAX_DEPTH: usize = 8;
const CLOUD_MCP_RUST_CLIENT_ID: &str = "rust-diffforge-agent";
const CLOUD_MCP_SPEC_GRAPH_CACHE_EVENT: &str = "cloud-mcp-spec-graph-cache";
const CLOUD_MCP_KNOWLEDGE_GRAPH_CACHE_EVENT: &str = "cloud-mcp-knowledge-graph-cache";
const VOICE_PLAN_SERVER_RESULT_EVENT: &str = "diffforge-voice-plan-server-result";
const CLOUD_MCP_FILETREE_CHANGE_DEBOUNCE_MS: u64 = 120;
const CLOUD_MCP_KNOWLEDGE_GRAPH_DEBOUNCE_MS: u64 = 650;
const CLOUD_MCP_INITIAL_GITIGNORE_WAIT_MS: u64 = 3_000;
const CLOUD_MCP_LOCAL_IGNORED_OVERLAY_VERSION: u64 = 1;
const CLOUD_MCP_LOCAL_IGNORED_OVERLAY_FILE: &str = "local-ignored-whitelist.json";
const CLOUD_MCP_KNOWLEDGE_NOTE_LIMIT: usize = 300;
const CLOUD_MCP_KNOWLEDGE_MAX_NOTE_BYTES: u64 = 384 * 1024;

#[derive(Clone)]
struct CloudMcpState {
    inner: Arc<Mutex<CloudMcpRuntime>>,
    spec_graph_syncs: Arc<Mutex<HashMap<String, CloudMcpSpecGraphSyncRuntime>>>,
    spec_graph_filetree_sync_requests: Arc<Mutex<HashMap<String, u64>>>,
    knowledge_graph_syncs: Arc<Mutex<HashMap<String, CloudMcpKnowledgeGraphSyncRuntime>>>,
    global_ws_started: Arc<AtomicBool>,
    global_ws_tx: Arc<Mutex<Option<mpsc::UnboundedSender<Value>>>>,
    global_ws_pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    global_ws_events: tokio::sync::broadcast::Sender<Value>,
}

#[derive(Clone)]
struct CloudMcpSpecGraphSyncRuntime {
    generation: u64,
    stop: Arc<AtomicBool>,
    wake: Arc<tokio::sync::Notify>,
}

#[derive(Clone)]
struct CloudMcpKnowledgeGraphSyncRuntime {
    generation: u64,
    stop: Arc<AtomicBool>,
    wake: Arc<tokio::sync::Notify>,
}

struct CloudMcpRuntime {
    base_url: String,
    connected: bool,
    status: String,
    last_error: String,
    last_connected_ms: Option<u64>,
    global_ws_connected: bool,
    global_ws_status: String,
    global_ws_last_error: String,
    global_ws_last_connected_ms: Option<u64>,
    global_ws_connection_id: Option<String>,
    global_ws_message_token: Option<String>,
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
    prompt_event_id: Option<String>,
    prompt_event_source: Option<String>,
    prompt_event_submitted_at: Option<String>,
    terminal_index: Option<u16>,
    thread_id: Option<String>,
    workspace_id: String,
    workspace_name: String,
    created_ms: u64,
    last_changed_hash: String,
    last_checkpoint_ms: u64,
    local_task_id: Option<String>,
    reported_change: bool,
    stable_review_reported: bool,
    stable_change_cycles: u8,
    saw_agent_activity: bool,
    work_brief: String,
    work_brief_reported: bool,
    done_reported: bool,
}

#[derive(Clone)]
struct CloudMcpTerminalPromptMetadata {
    prompt_event_id: Option<String>,
    prompt_event_source: Option<String>,
    prompt_event_submitted_at: Option<String>,
    terminal_index: Option<u16>,
    thread_id: Option<String>,
    workspace_id: String,
    workspace_name: String,
}

#[derive(Clone)]
struct CloudMcpVoicePlanPromptParts {
    run_id: String,
    stage: String,
    step_ordinal: i64,
    task_id: String,
}

#[derive(Clone)]
struct CloudMcpVoicePlanPromptMetadata {
    prompt_event_id: String,
    prompt_event_source: Option<String>,
    prompt_event_submitted_at: Option<String>,
    terminal_index: Option<u16>,
    thread_id: Option<String>,
    workspace_id: String,
    workspace_name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CloudMcpStatus {
    base_url: String,
    connected: bool,
    status: String,
    last_error: String,
    last_connected_ms: Option<u64>,
    global_ws_connected: bool,
    global_ws_status: String,
    global_ws_last_error: String,
    global_ws_last_connected_ms: Option<u64>,
    connection_contract: String,
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CloudMcpKnowledgePathRef {
    path: String,
    kind: String,
    exists: bool,
    size: Option<u64>,
    modified_ms: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CloudMcpKnowledgeNote {
    id: String,
    note_path: String,
    node_type: String,
    title: String,
    summary: String,
    markdown: String,
    path_refs: Vec<CloudMcpKnowledgePathRef>,
    outbound_links: Vec<Value>,
    source: String,
    metadata: Value,
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
        let (global_ws_events, _) = tokio::sync::broadcast::channel(512);
        Self {
            inner: Arc::new(Mutex::new(CloudMcpRuntime {
                base_url: cloud_mcp_base_url(),
                connected: false,
                status: "starting".to_string(),
                last_error: String::new(),
                last_connected_ms: None,
                global_ws_connected: false,
                global_ws_status: "starting".to_string(),
                global_ws_last_error: String::new(),
                global_ws_last_connected_ms: None,
                global_ws_connection_id: None,
                global_ws_message_token: None,
                registered_workspaces: HashMap::new(),
                terminal_contexts: HashMap::new(),
            })),
            spec_graph_syncs: Arc::new(Mutex::new(HashMap::new())),
            spec_graph_filetree_sync_requests: Arc::new(Mutex::new(HashMap::new())),
            knowledge_graph_syncs: Arc::new(Mutex::new(HashMap::new())),
            global_ws_started: Arc::new(AtomicBool::new(false)),
            global_ws_tx: Arc::new(Mutex::new(None)),
            global_ws_pending: Arc::new(Mutex::new(HashMap::new())),
            global_ws_events,
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

fn cloud_mcp_dev_auth_token() -> Option<String> {
    env::var("CLOUD_DIFFFORGE_DEV_TOKEN")
        .or_else(|_| env::var("CLOUD_MCP_DEV_TOKEN"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
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
    format!(
        "repo-{}",
        cloud_mcp_short_hash(&workspace_path_display(root))
    )
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
        global_ws_connected: runtime.global_ws_connected,
        global_ws_status: runtime.global_ws_status.clone(),
        global_ws_last_error: runtime.global_ws_last_error.clone(),
        global_ws_last_connected_ms: runtime.global_ws_last_connected_ms,
        connection_contract: "diffforge.app_ws.v1".to_string(),
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
    runtime.global_ws_connected = false;
    runtime.global_ws_status = "blocked".to_string();
    runtime.global_ws_connection_id = None;
    runtime.global_ws_message_token = None;
    cloud_mcp_snapshot(&runtime)
}

async fn cloud_mcp_connect_state(state: &CloudMcpState) -> Result<CloudMcpStatus, String> {
    cloud_mcp_start_global_ws(state).await;
    match cloud_mcp_wait_for_ws_sender(state).await {
        Ok(_) => Ok(cloud_mcp_status_snapshot(state).await),
        Err(error) => {
            let snapshot = cloud_mcp_set_connection_error(state, error.clone()).await;
            Err(format!(
                "Cloud MCP app websocket is required before terminals can start. {}",
                snapshot.last_error
            ))
        }
    }
}

async fn cloud_mcp_connected_or_connect(state: &CloudMcpState) -> Result<CloudMcpStatus, String> {
    let current = cloud_mcp_status_snapshot(state).await;
    if current.connected && current.global_ws_connected {
        return Ok(current);
    }

    cloud_mcp_connect_state(state).await
}

async fn require_cloud_mcp_connected_state(
    state: &CloudMcpState,
) -> Result<CloudMcpStatus, String> {
    cloud_mcp_connected_or_connect(state).await
}

async fn cloud_mcp_start_global_ws(state: &CloudMcpState) {
    if state.global_ws_started.swap(true, Ordering::SeqCst) {
        return;
    }
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        cloud_mcp_global_ws_loop(state).await;
    });
}

async fn cloud_mcp_global_ws_loop(state: CloudMcpState) {
    loop {
        let base_url = {
            let runtime = state.inner.lock().await;
            runtime.base_url.clone()
        };
        let ws_url = cloud_mcp_app_ws_url(&base_url);
        {
            let mut runtime = state.inner.lock().await;
            runtime.global_ws_connected = false;
            runtime.global_ws_status = "connecting".to_string();
            runtime.status = if runtime.connected {
                "websocket_reconnecting".to_string()
            } else {
                "connecting".to_string()
            };
        }

        match cloud_mcp_open_global_ws(&state, &ws_url).await {
            Ok(()) => {}
            Err(error) => {
                {
                    let mut runtime = state.inner.lock().await;
                    runtime.connected = false;
                    runtime.status = "websocket_retrying".to_string();
                    runtime.last_error = format!("Cloud MCP websocket unavailable: {error}");
                    runtime.global_ws_connected = false;
                    runtime.global_ws_status = "retrying".to_string();
                    runtime.global_ws_last_error = clean_terminal_telemetry_text(&error);
                    runtime.global_ws_connection_id = None;
                    runtime.global_ws_message_token = None;
                }
                let _ = state.global_ws_tx.lock().await.take();
                cloud_mcp_fail_pending_ws_requests(&state, &error).await;
            }
        }

        sleep(Duration::from_secs(2)).await;
    }
}

async fn cloud_mcp_open_global_ws(state: &CloudMcpState, ws_url: &str) -> Result<(), String> {
    let mut request = ws_url
        .into_client_request()
        .map_err(|error| format!("Unable to create Cloud MCP websocket request: {error}"))?;
    request.headers_mut().insert(
        "x-diffforge-client-id",
        HeaderValue::from_static(CLOUD_MCP_RUST_CLIENT_ID),
    );
    if let Some(token) = cloud_mcp_dev_auth_token() {
        let value = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|error| format!("Invalid Cloud MCP dev token header: {error}"))?;
        request.headers_mut().insert("authorization", value);
    }

    let (stream, _) = connect_async(request)
        .await
        .map_err(|error| format!("Unable to open Cloud MCP app websocket: {error}"))?;
    let (mut write, mut read) = stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    {
        let mut tx_slot = state.global_ws_tx.lock().await;
        *tx_slot = Some(tx.clone());
    }
    {
        let mut runtime = state.inner.lock().await;
        runtime.connected = false;
        runtime.status = "websocket_handshaking".to_string();
        runtime.global_ws_connected = false;
        runtime.global_ws_status = "handshaking".to_string();
        runtime.global_ws_connection_id = None;
        runtime.global_ws_message_token = None;
    }

    loop {
        tokio::select! {
            outgoing = rx.recv() => {
                let Some(outgoing) = outgoing else {
                    return Ok(());
                };
                write
                    .send(Message::Text(outgoing.to_string().into()))
                    .await
                    .map_err(|error| format!("Cloud MCP app websocket write failed: {error}"))?;
            }
            incoming = read.next() => {
                let Some(incoming) = incoming else {
                    return Err("Cloud MCP app websocket closed by server.".to_string());
                };
                match incoming {
                    Ok(Message::Text(text)) => cloud_mcp_handle_global_ws_message(state, text.as_str()).await,
                    Ok(Message::Binary(bytes)) => {
                        if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                            cloud_mcp_handle_global_ws_message(state, &text).await;
                        }
                    }
                    Ok(Message::Ping(payload)) => {
                        write
                            .send(Message::Pong(payload))
                            .await
                            .map_err(|error| format!("Cloud MCP app websocket pong failed: {error}"))?;
                    }
                    Ok(Message::Close(_)) => return Err("Cloud MCP app websocket closed.".to_string()),
                    Err(error) => return Err(format!("Cloud MCP app websocket read failed: {error}")),
                    _ => {}
                }
            }
        }
    }
}

async fn cloud_mcp_handle_global_ws_message(state: &CloudMcpState, text: &str) {
    let Ok(message) = serde_json::from_str::<Value>(text) else {
        return;
    };
    if message.get("kind").and_then(Value::as_str) == Some("cloud_app_ws_ready") {
        let connection_id = message["message_auth"]["connection_id"]
            .as_str()
            .or_else(|| message["connection_id"].as_str())
            .map(str::to_string);
        let message_token = message["message_auth"]["message_token"]
            .as_str()
            .map(str::to_string);
        let (Some(connection_id), Some(message_token)) = (connection_id, message_token) else {
            let mut runtime = state.inner.lock().await;
            runtime.connected = false;
            runtime.status = "websocket_auth_missing".to_string();
            runtime.global_ws_connected = false;
            runtime.global_ws_status = "auth_missing".to_string();
            runtime.global_ws_last_error =
                "Cloud MCP app websocket ready message omitted message auth.".to_string();
            return;
        };
        {
            let mut runtime = state.inner.lock().await;
            runtime.connected = true;
            runtime.status = "connected".to_string();
            runtime.last_error.clear();
            runtime.last_connected_ms = Some(cloud_mcp_now_ms());
            runtime.global_ws_connected = true;
            runtime.global_ws_status = "connected".to_string();
            runtime.global_ws_last_error.clear();
            runtime.global_ws_last_connected_ms = Some(cloud_mcp_now_ms());
            runtime.global_ws_connection_id = Some(connection_id.clone());
            runtime.global_ws_message_token = Some(message_token.clone());
        }
        let hello = json!({
            "kind": "hello",
            "id": format!("hello-{}", cloud_mcp_now_ms()),
            "client_id": CLOUD_MCP_RUST_CLIENT_ID,
            "source": "rust-diffforge",
            "contract": "diffforge.app_ws.v1",
            "auth": {
                "connection_id": connection_id,
                "message_token": message_token,
            },
            "workspaces": cloud_mcp_registered_workspace_subscriptions(state).await,
        });
        if let Some(tx) = state.global_ws_tx.lock().await.as_ref().cloned() {
            let _ = tx.send(hello);
        }
        return;
    }
    if let Some(id) = message.get("id").and_then(Value::as_str) {
        if let Some(sender) = state.global_ws_pending.lock().await.remove(id) {
            let _ = sender.send(message);
            return;
        }
    }
    if message.get("kind").and_then(Value::as_str) == Some("cloud_event") {
        // The graph/spec/knowledge sync loops still own local cache materialization.
        // This global channel is the durable wake signal shared by every workspace.
        let event = message
            .get("event")
            .cloned()
            .unwrap_or_else(|| message.clone());
        let _ = state.global_ws_events.send(event);
        let mut runtime = state.inner.lock().await;
        runtime.connected = true;
        runtime.status = "connected".to_string();
        runtime.global_ws_connected = true;
        runtime.global_ws_status = "connected".to_string();
        runtime.global_ws_last_connected_ms = Some(cloud_mcp_now_ms());
    }
}

async fn cloud_mcp_registered_workspace_subscriptions(state: &CloudMcpState) -> Vec<Value> {
    let runtime = state.inner.lock().await;
    runtime
        .registered_workspaces
        .values()
        .map(|workspace| {
            json!({
                "workspace_id": workspace.workspace_id,
                "workspace_name": workspace.workspace_name,
                "repo_id": cloud_mcp_repo_id_for_root(Path::new(&workspace.root)),
                "workspace_root": workspace.root,
            })
        })
        .collect()
}

fn cloud_mcp_app_ws_url(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let ws_base = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        format!("ws://{base}")
    };
    format!("{ws_base}/v1/app/ws")
}

async fn cloud_mcp_fail_pending_ws_requests(state: &CloudMcpState, error: &str) {
    let mut pending = state.global_ws_pending.lock().await;
    let drained = std::mem::take(&mut *pending);
    drop(pending);
    for (_, sender) in drained {
        let _ = sender.send(json!({
            "kind": "error",
            "ok": false,
            "error": {
                "code": "cloud_ws_disconnected",
                "message": clean_terminal_telemetry_text(error),
            }
        }));
    }
}

async fn cloud_mcp_ws_request(
    state: &CloudMcpState,
    request_kind: &str,
    payload: &Value,
) -> Result<Value, String> {
    cloud_mcp_start_global_ws(state).await;
    let tx = cloud_mcp_wait_for_ws_sender(state).await?;
    let request_id = format!("ws-{}-{}", cloud_mcp_now_ms(), uuid::Uuid::new_v4());
    let auth = cloud_mcp_ws_auth_object(state).await?;
    let (response_tx, response_rx) = oneshot::channel::<Value>();
    state
        .global_ws_pending
        .lock()
        .await
        .insert(request_id.clone(), response_tx);
    let envelope = json!({
        "kind": request_kind,
        "id": request_id,
        "contract": "diffforge.app_ws.v1",
        "auth": auth,
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "repo_id": cloud_mcp_payload_text(payload, &["repo_id"])
            .or_else(|| cloud_mcp_payload_text(payload, &["payload", "repo_id"])),
        "workspace_id": cloud_mcp_payload_text(payload, &["workspace_id"])
            .or_else(|| cloud_mcp_payload_text(payload, &["payload", "workspace_id"])),
        "request": payload,
    });
    if tx.send(envelope).is_err() {
        state.global_ws_pending.lock().await.remove(&request_id);
        return Err("Cloud MCP app websocket is not accepting messages.".to_string());
    }
    let response = match timeout(
        Duration::from_secs(CLOUD_MCP_SYNC_TIMEOUT_SECS),
        response_rx,
    )
    .await
    {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => {
            state.global_ws_pending.lock().await.remove(&request_id);
            return Err("Cloud MCP app websocket response was cancelled.".to_string());
        }
        Err(_) => {
            state.global_ws_pending.lock().await.remove(&request_id);
            return Err("Cloud MCP app websocket request timed out.".to_string());
        }
    };
    if response.get("ok").and_then(Value::as_bool) == Some(false)
        || response.get("kind").and_then(Value::as_str) == Some("error")
    {
        let message = response["error"]["message"]
            .as_str()
            .unwrap_or("Cloud MCP app websocket request failed.");
        return Err(message.to_string());
    }
    let data = response
        .get("data")
        .cloned()
        .unwrap_or_else(|| response.clone());
    Ok(json!({
        "ok": true,
        "data": data,
        "warnings": [],
    }))
}

async fn cloud_mcp_ws_auth_object(state: &CloudMcpState) -> Result<Value, String> {
    let runtime = state.inner.lock().await;
    let connection_id = runtime
        .global_ws_connection_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Cloud MCP app websocket connection auth is not established.".to_string())?;
    let message_token = runtime
        .global_ws_message_token
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Cloud MCP app websocket message auth is not established.".to_string())?;
    Ok(json!({
        "connection_id": connection_id,
        "message_token": message_token,
    }))
}

async fn cloud_mcp_wait_for_ws_sender(
    state: &CloudMcpState,
) -> Result<mpsc::UnboundedSender<Value>, String> {
    let started = Instant::now();
    loop {
        let ready = {
            let runtime = state.inner.lock().await;
            runtime.global_ws_connected
                && runtime.global_ws_connection_id.is_some()
                && runtime.global_ws_message_token.is_some()
        };
        if ready {
            if let Some(tx) = state.global_ws_tx.lock().await.as_ref().cloned() {
                return Ok(tx);
            }
        }
        if started.elapsed() >= Duration::from_secs(CLOUD_MCP_CONNECT_TIMEOUT_SECS) {
            return Err("Cloud MCP app websocket is not connected yet.".to_string());
        }
        sleep(Duration::from_millis(80)).await;
    }
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
            | ".agents"
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
                "import", "export", "require(", " from ", "src=", "href=", "@import", "url(",
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

fn cloud_mcp_normalized_git_path(value: &[u8]) -> Option<String> {
    let path = String::from_utf8_lossy(value)
        .replace('\\', "/")
        .trim()
        .trim_matches('/')
        .to_string();
    if path.is_empty()
        || path == ".git"
        || path == ".agents"
        || matches!(
            path.as_str(),
            ".gitignore" | ".gitattributes" | ".gitmodules"
        )
        || path.starts_with(".git/")
        || path.starts_with(".agents/")
        || path.ends_with("/.gitignore")
        || path.ends_with("/.gitattributes")
        || path.ends_with("/.gitmodules")
        || path.starts_with("../")
        || path.contains("/../")
    {
        return None;
    }
    Some(path)
}

fn cloud_mcp_collect_gitignore_signatures(root: &Path) -> Vec<String> {
    let mut signatures = Vec::new();
    let mut queue = VecDeque::new();
    queue.push_back((root.to_path_buf(), 0usize));
    while let Some((directory, depth)) = queue.pop_front() {
        if depth > CLOUD_MCP_FILETREE_MAX_DEPTH {
            continue;
        }
        let Ok(read_dir) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name == ".git" || name == ".agents" {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                if cloud_mcp_skip_filetree_name(&name) {
                    continue;
                }
                queue.push_back((path, depth + 1));
                continue;
            }
            if name != ".gitignore" {
                continue;
            }
            let relative = path
                .strip_prefix(root)
                .ok()
                .map(workspace_path_display)
                .unwrap_or_else(|| workspace_path_display(&path));
            signatures.push(format!(
                "{}:{}:{}",
                relative.replace('\\', "/"),
                metadata.len(),
                cloud_mcp_modified_ms(&metadata).unwrap_or(0)
            ));
        }
    }
    if let Ok(metadata) = fs::metadata(root.join(".git").join("info").join("exclude")) {
        signatures.push(format!(
            ".git/info/exclude:{}:{}",
            metadata.len(),
            cloud_mcp_modified_ms(&metadata).unwrap_or(0)
        ));
    }
    signatures.sort();
    signatures
}

fn cloud_mcp_gitignore_signature(root: &Path) -> String {
    cloud_mcp_collect_gitignore_signatures(root).join("|")
}

async fn cloud_mcp_wait_for_initial_gitignore(root: &Path) {
    if root.join(".gitignore").exists() {
        return;
    }
    let started = cloud_mcp_now_ms();
    while cloud_mcp_now_ms().saturating_sub(started) < CLOUD_MCP_INITIAL_GITIGNORE_WAIT_MS {
        sleep(Duration::from_millis(150)).await;
        if root.join(".gitignore").exists() {
            break;
        }
    }
}

fn cloud_mcp_parent_folders_for_relative_path(path: &str) -> Vec<String> {
    let parts = path
        .split('/')
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>();
    if parts.len() < 2 {
        return Vec::new();
    }
    (1..parts.len()).map(|end| parts[..end].join("/")).collect()
}

#[derive(Clone, Debug)]
struct CloudMcpIgnoreRule {
    base_path: String,
    pattern: String,
    negated: bool,
    directory_only: bool,
    anchored: bool,
    has_slash: bool,
}

#[derive(Clone, Debug, Default)]
struct CloudMcpIgnoreMatcher {
    rules: Vec<CloudMcpIgnoreRule>,
}

impl CloudMcpIgnoreMatcher {
    fn from_root(root: &Path) -> Self {
        let mut rules = Vec::new();
        let mut queue = VecDeque::new();
        queue.push_back((root.to_path_buf(), 0usize));

        while let Some((directory, depth)) = queue.pop_front() {
            if depth > CLOUD_MCP_FILETREE_MAX_DEPTH {
                continue;
            }

            let ignore_path = directory.join(".gitignore");
            if let Ok(contents) = fs::read_to_string(&ignore_path) {
                let base_path = directory
                    .strip_prefix(root)
                    .ok()
                    .map(workspace_path_display)
                    .map(|path| path.replace('\\', "/").trim_matches('/').to_string())
                    .unwrap_or_default();
                rules.extend(cloud_mcp_parse_gitignore_rules(&base_path, &contents));
            }

            let Ok(read_dir) = fs::read_dir(&directory) else {
                continue;
            };
            for entry in read_dir.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if cloud_mcp_skip_filetree_name(&name) {
                    continue;
                }
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if file_type.is_dir() && !file_type.is_symlink() {
                    queue.push_back((entry.path(), depth + 1));
                }
            }
        }

        if let Ok(contents) = fs::read_to_string(root.join(".git").join("info").join("exclude")) {
            rules.extend(cloud_mcp_parse_gitignore_rules("", &contents));
        }

        Self { rules }
    }

    fn ignores(&self, relative_path: &str, is_dir: bool) -> bool {
        let normalized = relative_path.replace('\\', "/");
        let normalized = normalized.trim().trim_matches('/');
        if normalized.is_empty() {
            return false;
        }

        let mut ignored = false;
        for rule in &self.rules {
            if rule.matches(normalized, is_dir) {
                ignored = !rule.negated;
            }
        }
        ignored
    }
}

impl CloudMcpIgnoreRule {
    fn matches(&self, relative_path: &str, is_dir: bool) -> bool {
        let path_in_base = if self.base_path.is_empty() {
            relative_path
        } else if let Some(rest) = relative_path.strip_prefix(&format!("{}/", self.base_path)) {
            rest
        } else {
            return false;
        };
        if path_in_base.is_empty() {
            return false;
        }

        if self.directory_only {
            if is_dir && self.matches_relative(path_in_base) {
                return true;
            }
            return cloud_mcp_parent_folders_for_relative_path(path_in_base)
                .iter()
                .any(|parent| self.matches_relative(parent));
        }

        self.matches_relative(path_in_base)
    }

    fn matches_relative(&self, path: &str) -> bool {
        if self.has_slash || self.anchored {
            return cloud_mcp_gitignore_glob_matches(&self.pattern, path);
        }
        path.split('/')
            .any(|component| cloud_mcp_gitignore_glob_matches(&self.pattern, component))
    }
}

fn cloud_mcp_parse_gitignore_rules(base_path: &str, contents: &str) -> Vec<CloudMcpIgnoreRule> {
    contents
        .lines()
        .filter_map(|line| cloud_mcp_parse_gitignore_rule(base_path, line))
        .collect()
}

fn cloud_mcp_parse_gitignore_rule(base_path: &str, line: &str) -> Option<CloudMcpIgnoreRule> {
    let mut pattern = line.trim();
    if pattern.is_empty() || pattern.starts_with('#') {
        return None;
    }

    let mut negated = false;
    if let Some(rest) = pattern.strip_prefix('!') {
        negated = true;
        pattern = rest.trim_start();
    }
    if pattern.is_empty() {
        return None;
    }

    let anchored = pattern.starts_with('/');
    pattern = pattern.trim_start_matches('/');
    let directory_only = pattern.ends_with('/');
    pattern = pattern.trim_end_matches('/');
    if pattern.is_empty() {
        return None;
    }

    let pattern = pattern.replace('\\', "/");
    Some(CloudMcpIgnoreRule {
        base_path: base_path.trim_matches('/').to_string(),
        has_slash: pattern.contains('/'),
        pattern,
        negated,
        directory_only,
        anchored,
    })
}

fn cloud_mcp_gitignore_glob_matches(pattern: &str, value: &str) -> bool {
    let pattern = pattern.chars().collect::<Vec<_>>();
    let value = value.chars().collect::<Vec<_>>();
    let mut memo = vec![vec![None; value.len() + 1]; pattern.len() + 1];

    fn matches_from(
        pattern: &[char],
        value: &[char],
        memo: &mut [Vec<Option<bool>>],
        pattern_index: usize,
        value_index: usize,
    ) -> bool {
        if let Some(result) = memo[pattern_index][value_index] {
            return result;
        }

        let result = if pattern_index == pattern.len() {
            value_index == value.len()
        } else {
            match pattern[pattern_index] {
                '*' => {
                    let is_double_star = pattern.get(pattern_index + 1) == Some(&'*');
                    let next_pattern_index = pattern_index + if is_double_star { 2 } else { 1 };
                    if matches_from(pattern, value, memo, next_pattern_index, value_index) {
                        true
                    } else {
                        let mut next_value_index = value_index;
                        let mut matched = false;
                        while next_value_index < value.len()
                            && (is_double_star || value[next_value_index] != '/')
                        {
                            next_value_index += 1;
                            if matches_from(
                                pattern,
                                value,
                                memo,
                                next_pattern_index,
                                next_value_index,
                            ) {
                                matched = true;
                                break;
                            }
                        }
                        matched
                    }
                }
                '?' => {
                    value_index < value.len()
                        && value[value_index] != '/'
                        && matches_from(pattern, value, memo, pattern_index + 1, value_index + 1)
                }
                expected => {
                    value_index < value.len()
                        && expected == value[value_index]
                        && matches_from(pattern, value, memo, pattern_index + 1, value_index + 1)
                }
            }
        };

        memo[pattern_index][value_index] = Some(result);
        result
    }

    matches_from(&pattern, &value, &mut memo, 0, 0)
}

fn cloud_mcp_git_output(root: &Path, args: &[&str]) -> Option<Vec<u8>> {
    if app_shutdown_requested() {
        return None;
    }

    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(root)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().ok()?;
    loop {
        if app_shutdown_requested() {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }

        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(_) => {
                let _ = child.kill();
                return None;
            }
        }
    }

    let output = child.wait_with_output().ok()?;
    output.status.success().then_some(output.stdout)
}

fn cloud_mcp_collect_git_visible_filetree(root: &Path) -> Option<(Vec<CloudMcpFileEntry>, bool)> {
    let output = cloud_mcp_git_output(
        root,
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
    )?;

    let mut file_paths = output
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .filter_map(cloud_mcp_normalized_git_path)
        .collect::<Vec<_>>();
    file_paths.sort();
    file_paths.dedup();

    let mut folder_paths = HashSet::new();
    for file_path in &file_paths {
        for folder_path in cloud_mcp_parent_folders_for_relative_path(file_path) {
            folder_paths.insert(folder_path);
        }
    }
    let mut folder_paths = folder_paths.into_iter().collect::<Vec<_>>();
    folder_paths.sort();

    let mut entries = Vec::new();
    let mut truncated = false;
    for folder_path in folder_paths {
        if entries.len() >= CLOUD_MCP_FILETREE_LIMIT {
            truncated = true;
            break;
        }
        let path = root.join(&folder_path);
        let metadata = fs::symlink_metadata(&path).ok();
        if metadata
            .as_ref()
            .is_some_and(|metadata| metadata.file_type().is_symlink())
        {
            continue;
        }
        entries.push(CloudMcpFileEntry {
            relative_path: folder_path,
            kind: "directory".to_string(),
            size: None,
            modified_ms: metadata
                .as_ref()
                .and_then(|metadata| cloud_mcp_modified_ms(metadata)),
            references: Vec::new(),
        });
    }

    for file_path in file_paths {
        if entries.len() >= CLOUD_MCP_FILETREE_LIMIT {
            truncated = true;
            break;
        }
        let path = root.join(&file_path);
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        let size = Some(metadata.len());
        entries.push(CloudMcpFileEntry {
            relative_path: file_path,
            kind: "file".to_string(),
            size,
            modified_ms: cloud_mcp_modified_ms(&metadata),
            references: cloud_mcp_file_references(&path, size),
        });
    }

    Some((entries, truncated))
}

fn cloud_mcp_collect_filetree(root: &Path) -> (Vec<CloudMcpFileEntry>, bool) {
    if let Some(filetree) = cloud_mcp_collect_git_visible_filetree(root) {
        return filetree;
    }

    let ignore_matcher = CloudMcpIgnoreMatcher::from_root(root);
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
            let Some(relative_path) = cloud_mcp_normalized_git_path(relative_path.as_bytes())
            else {
                continue;
            };
            if ignore_matcher.ignores(&relative_path, file_type.is_dir()) {
                continue;
            }

            if file_type.is_dir() {
                entries.push(CloudMcpFileEntry {
                    relative_path,
                    kind: "directory".to_string(),
                    size: None,
                    modified_ms: entry
                        .metadata()
                        .ok()
                        .and_then(|metadata| cloud_mcp_modified_ms(&metadata)),
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
    let log_context = cloud_mcp_post_log_context(endpoint, payload);
    if let Some((root, workspace_id, workspace_name, fields)) = &log_context {
        let mut fields = fields.clone();
        fields["transport"] = json!("app_websocket");
        let _ = cloud_mcp_workspace_log(
            root,
            "cloud_mcp.ws.start",
            workspace_id,
            workspace_name,
            fields,
        );
    }

    let Some(ws_kind) = cloud_mcp_ws_kind_for_endpoint(endpoint) else {
        let error = format!(
            "Cloud MCP endpoint {endpoint} is not routed through the required app websocket"
        );
        if let Some((root, workspace_id, workspace_name, fields)) = &log_context {
            let mut fields = fields.clone();
            fields["transport"] = json!("app_websocket");
            fields["error"] = json!(error.clone());
            let _ = cloud_mcp_workspace_log(
                root,
                "cloud_mcp.ws.error",
                workspace_id,
                workspace_name,
                fields,
            );
        }
        return Err(error);
    };

    match cloud_mcp_ws_request(state, ws_kind, payload).await {
        Ok(value) => {
            if let Some((root, workspace_id, workspace_name, fields)) = &log_context {
                let mut fields = fields.clone();
                fields["transport"] = json!("app_websocket");
                let _ = cloud_mcp_workspace_log(
                    root,
                    "cloud_mcp.ws.done",
                    workspace_id,
                    workspace_name,
                    fields,
                );
            }
            Ok(value)
        }
        Err(error) => {
            if let Some((root, workspace_id, workspace_name, fields)) = &log_context {
                let mut fields = fields.clone();
                fields["transport"] = json!("app_websocket");
                fields["error"] = json!(clean_terminal_telemetry_text(&error));
                let _ = cloud_mcp_workspace_log(
                    root,
                    "cloud_mcp.ws.error",
                    workspace_id,
                    workspace_name,
                    fields,
                );
            }
            Err(error)
        }
    }
}

fn cloud_mcp_ws_kind_for_endpoint(endpoint: &str) -> Option<&'static str> {
    match endpoint {
        "/v1/events" => Some("event"),
        "/v1/sync/push" => Some("sync_push"),
        "/v1/sync/pull" => Some("sync_pull"),
        "/v1/context/pack" => Some("context_pack"),
        "/v1/spec/graph" => Some("spec_graph"),
        "/v1/spec/graph/delta" => Some("spec_graph_delta"),
        "/v1/spec/task-history" => Some("spec_task_history"),
        "/v1/spec/nodes" => Some("spec_node"),
        "/v1/knowledge/graph" => Some("knowledge_graph"),
        "/v1/knowledge/graph/delta" => Some("knowledge_graph_delta"),
        "/v1/knowledge/context" => Some("knowledge_context"),
        _ => None,
    }
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
    let root = resolve_workspace_root_directory(Some(&repo_path))
        .unwrap_or_else(|_| PathBuf::from(&repo_path));
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
        .or_else(|| {
            payload
                .get("payload")
                .and_then(|payload| payload.get("terminal_instance_id"))
        })
        .or_else(|| {
            payload
                .get("payload")
                .and_then(|payload| payload.get("instance_id"))
        })
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

    Some((root, workspace_id, workspace_name, fields))
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
    let server_response = cloud_mcp_post_event_endpoint(state, reason, &payload).await?;
    if reason == "workspace_registration" {
        let reconcile_payload = json!({
            "source": "rust-diffforge-terminal-lifecycle",
            "repo_id": repo_id.clone(),
            "agent_id": "rust-diffforge",
            "event_kind": "terminal_presence_reconciled",
            "reason": "workspace_registration",
            "workspace_id": prepared.workspace_id,
            "workspace_name": prepared.workspace_name,
            "workspace_root": prepared.root_display,
            "summary": format!("Workspace {} opened; reconciling stale terminal agent presence.", prepared.workspace_name),
            "payload": {
                "reason": "workspace_registration",
                "workspace_id": prepared.workspace_id,
                "workspace_name": prepared.workspace_name,
                "workspace_root": prepared.root_display,
                "managed_by": "rust-diffforge",
            }
        });
        let _ = cloud_mcp_post_event_endpoint(
            state,
            "terminal_presence_reconciled",
            &reconcile_payload,
        )
        .await;
    }
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
        runtime.connected = runtime.global_ws_connected;
        runtime.status = if runtime.global_ws_connected {
            "connected".to_string()
        } else {
            "websocket_required".to_string()
        };
        if runtime.global_ws_connected {
            runtime.last_error.clear();
        }
        runtime.last_connected_ms = Some(now_ms);
    }
    let _ = cloud_mcp_ws_send_workspace_subscription(state, &repo_id, &workspace_status).await;
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

async fn cloud_mcp_ws_send_workspace_subscription(
    state: &CloudMcpState,
    repo_id: &str,
    workspace: &CloudMcpWorkspaceStatus,
) -> Result<Value, String> {
    cloud_mcp_ws_request(
        state,
        "workspace_subscribe",
        &json!({
            "repo_id": repo_id,
            "workspace_id": workspace.workspace_id,
            "workspace_name": workspace.workspace_name,
            "workspace_root": workspace.root,
        }),
    )
    .await
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
        "filetree_authoritative": true,
        "ts_ms": cloud_mcp_now_ms(),
    });
    cloud_mcp_post_event_endpoint(state, "filetree_snapshot", &payload).await
}

async fn cloud_mcp_push_current_filetree_snapshot(
    state: &CloudMcpState,
    repo_id: &str,
    workspace_root: &Path,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
    reason: &str,
) -> Result<Value, String> {
    let root = workspace_root.to_path_buf();
    let (filetree, filetree_truncated) =
        tauri::async_runtime::spawn_blocking(move || cloud_mcp_collect_filetree(&root))
            .await
            .map_err(|error| format!("Unable to scan Cloud MCP filetree: {error}"))?;
    cloud_mcp_push_filetree_snapshot(
        state,
        repo_id,
        workspace_root,
        workspace_id,
        workspace_name,
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
    let Some(local_task_id) = local_task_id.filter(|value| !value.trim().is_empty()) else {
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
         WHERE l.session_id=?1 AND l.task_id=?2 AND l.status='active'
         ORDER BY l.acquired_at DESC
         LIMIT 50",
    ) {
        Ok(statement) => statement,
        Err(_) => return Vec::new(),
    };
    let rows = match statement.query_map(
        rusqlite::params![coordination.session_id.as_str(), local_task_id],
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
                "lease_state": "active",
                "file_state": "lease",
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
    claimed_paths
}

fn cloud_mcp_terminal_active_task_id(
    coordination: Option<&TerminalCoordinationSession>,
) -> Option<String> {
    let coordination = coordination?;
    let conn = rusqlite::Connection::open(&coordination.db_path).ok()?;
    let task_id = conn
        .query_row(
            "SELECT t.id
             FROM agent_sessions s
             JOIN tasks t ON t.id=s.task_id
             WHERE s.id=?1
               AND s.status='active'
               AND t.claimed_session_id=s.id
               AND t.status NOT IN ('done', 'completed', 'merged', 'cancelled', 'interrupted', 'skipped')
             ORDER BY t.updated_at DESC
             LIMIT 1",
            [coordination.session_id.as_str()],
            |row| row.get::<_, String>(0),
        )
        .ok()?;
    let task_id = task_id.trim();
    if task_id.is_empty() {
        None
    } else {
        Some(task_id.to_string())
    }
}

fn cloud_mcp_terminal_worktree_id(
    coordination: Option<&TerminalCoordinationSession>,
) -> Option<String> {
    let coordination = coordination?;
    let conn = rusqlite::Connection::open(&coordination.db_path).ok()?;
    let worktree_id = conn
        .query_row(
            "SELECT worktree_id
             FROM agent_sessions
             WHERE id=?1
             LIMIT 1",
            [coordination.session_id.as_str()],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()?;
    let worktree_id = worktree_id.trim();
    if worktree_id.is_empty() {
        None
    } else {
        Some(worktree_id.to_string())
    }
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
        .unwrap_or_else(|| {
            format!(
                "repo-{}",
                cloud_mcp_short_hash(&workspace_path_display(working_directory))
            )
        })
}

fn cloud_mcp_terminal_repo_root_path(
    working_directory: &Path,
    coordination: Option<&TerminalCoordinationSession>,
) -> PathBuf {
    coordination
        .map(|coordination| coordination.repo_path.trim())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| working_directory.to_path_buf())
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
        .trim_matches(|character: char| {
            character == '•' || character == '-' || character.is_whitespace()
        })
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
        .trim_matches(|character: char| {
            character == '.' || character == ':' || character.is_whitespace()
        })
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
    let Some(output) = cloud_mcp_git_output(
        root,
        &["status", "--porcelain", "-z", "--untracked-files=all"],
    ) else {
        return Vec::new();
    };

    let mut files = Vec::new();
    let mut parts = output
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty());
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
    let _ = cloud_mcp_post_event_endpoint(state, "lane_claimed", &payload).await;
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
    let _ = cloud_mcp_post_event_endpoint(state, "lane_released", &payload).await;
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
        "record_spec_activity": false,
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
            "agent_kind": coordination.map(|coordination| coordination.agent_kind.clone()),
            "coding_agent": coordination.map(|coordination| coordination.agent_kind.clone()),
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
    log_terminal_status_event(
        "backend.cloud_mcp.agent_status.send",
        json!({
            "endpoint": "agent_heartbeat",
            "payload": payload.clone(),
            "reason": reason,
            "server_status": status,
            "terminal_ground_truth_hint": progress_summary,
        }),
    );
    let result = cloud_mcp_post_event_endpoint(state, "agent_heartbeat", &payload).await;
    match &result {
        Ok(value) => log_terminal_status_event(
            "backend.cloud_mcp.agent_status.result",
            json!({
                "agent_id": agent_id,
                "endpoint": "agent_heartbeat",
                "ok": true,
                "reason": reason,
                "server_status": status,
                "terminal_id": pane_id,
                "terminal_instance_id": instance_id,
                "result": value,
            }),
        ),
        Err(error) => log_terminal_status_event(
            "backend.cloud_mcp.agent_status.error",
            json!({
                "agent_id": agent_id,
                "endpoint": "agent_heartbeat",
                "error": clean_terminal_telemetry_text(error),
                "reason": reason,
                "server_status": status,
                "terminal_id": pane_id,
                "terminal_instance_id": instance_id,
            }),
        ),
    }
}

fn cloud_mcp_agent_status_for_lifecycle_status(status: &str) -> &'static str {
    match status {
        "starting" => "starting",
        "active" | "busy" | "running" | "dispatched" | "resume_requested" => "active",
        "merged" | "completed" => "done",
        "blocked" => "blocked",
        "parked" => "parked",
        "resume_ready" => "waiting",
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

fn cloud_mcp_parse_voice_plan_prompt_event_id(value: &str) -> Option<CloudMcpVoicePlanPromptParts> {
    let task_id = value.trim();
    if !task_id.starts_with("voice-plan-") {
        return None;
    }

    let (before_task, _) = task_id.rsplit_once("-t")?;
    let (before_stage, stage) = before_task.rsplit_once('-')?;
    if !matches!(stage, "execution" | "revision") {
        return None;
    }
    let (run_id, step_text) = before_stage.rsplit_once("-s")?;
    let step_ordinal = step_text.parse::<i64>().ok()?;
    if run_id.trim().is_empty() {
        return None;
    }

    Some(CloudMcpVoicePlanPromptParts {
        run_id: run_id.to_string(),
        stage: stage.to_string(),
        step_ordinal,
        task_id: task_id.to_string(),
    })
}

async fn cloud_mcp_voice_plan_prompt_metadata_for_terminal_task(
    state: &CloudMcpState,
    pane_id: &str,
    instance_id: u64,
    _local_task_id: &str,
) -> Option<CloudMcpVoicePlanPromptMetadata> {
    let terminal_key = cloud_mcp_terminal_key(pane_id, instance_id);
    let runtime = state.inner.lock().await;
    let entry = runtime.terminal_contexts.get(&terminal_key)?;
    let prompt_event_id = entry
        .prompt_event_id
        .as_deref()
        .map(str::trim)
        .filter(|value| cloud_mcp_parse_voice_plan_prompt_event_id(value).is_some())?
        .to_string();

    Some(CloudMcpVoicePlanPromptMetadata {
        prompt_event_id,
        prompt_event_source: entry.prompt_event_source.clone(),
        prompt_event_submitted_at: entry.prompt_event_submitted_at.clone(),
        terminal_index: entry.terminal_index,
        thread_id: entry.thread_id.clone(),
        workspace_id: entry.workspace_id.clone(),
        workspace_name: entry.workspace_name.clone(),
    })
}

fn cloud_mcp_voice_plan_status_for_terminal_lifecycle(status: &str) -> Option<&'static str> {
    match status.trim().to_ascii_lowercase().replace([' ', '-'], "_").as_str() {
        "parked" | "blocked" | "waiting_on_dependency" => Some("parked"),
        "resume_ready" | "ready_to_resume" => Some("resume_ready"),
        "resume_requested" | "resuming" => Some("resume_requested"),
        "active" | "busy" | "running" | "starting" => Some("running"),
        "dispatched" | "redispatched" => Some("dispatched"),
        "cancelled" | "canceled" | "interrupted" => Some("cancelled"),
        _ => None,
    }
}

async fn cloud_mcp_record_voice_plan_terminal_lifecycle(
    app: &AppHandle,
    state: &CloudMcpState,
    parked: &TerminalParkedPrompt,
    status: &str,
    body: &str,
) {
    let Some(metadata) = parked.voice_plan_prompt.as_ref() else {
        log_terminal_status_event(
            "backend.voice_plan_task_status.terminal_lifecycle_skip",
            json!({
                "reason": "missing_voice_plan_prompt_metadata",
                "status": status,
                "task_id": parked.task_id.as_str(),
                "terminal_id": parked.pane_id.as_str(),
                "terminal_instance_id": parked.instance_id,
            }),
        );
        return;
    };
    let Some(parts) = cloud_mcp_parse_voice_plan_prompt_event_id(&metadata.prompt_event_id) else {
        return;
    };
    let Some(plan_status) = cloud_mcp_voice_plan_status_for_terminal_lifecycle(status) else {
        log_terminal_status_event(
            "backend.voice_plan_task_status.terminal_lifecycle_skip",
            json!({
                "prompt_event_id": metadata.prompt_event_id.as_str(),
                "reason": "unsupported_terminal_lifecycle_status",
                "status": status,
                "task_id": parked.task_id.as_str(),
            }),
        );
        return;
    };

    let req = cloud_mcp_spec_graph_sync_request(
        parked.working_directory.display().to_string(),
        if metadata.workspace_id.trim().is_empty() {
            None
        } else {
            Some(metadata.workspace_id.clone())
        },
        if metadata.workspace_name.trim().is_empty() {
            None
        } else {
            Some(metadata.workspace_name.clone())
        },
    );
    let agent_id = cloud_mcp_terminal_agent_id(
        &parked.pane_id,
        parked.instance_id,
        Some(&parked.coordination),
    );
    let payload = json!({
        "agentId": agent_id,
        "event_kind": "voice_plan_task_status",
        "lifecycleSource": "terminal_parked_lifecycle",
        "runId": parts.run_id.clone(),
        "run_id": parts.run_id.clone(),
        "planRunId": parts.run_id.clone(),
        "plan_run_id": parts.run_id.clone(),
        "planStage": parts.stage.clone(),
        "plan_stage": parts.stage.clone(),
        "planStepOrdinal": parts.step_ordinal,
        "plan_step_ordinal": parts.step_ordinal,
        "stage": parts.stage.clone(),
        "stepOrdinal": parts.step_ordinal,
        "step_ordinal": parts.step_ordinal,
        "taskId": parts.task_id.clone(),
        "task_id": parts.task_id.clone(),
        "planTaskId": parts.task_id.clone(),
        "plan_task_id": parts.task_id.clone(),
        "promptEventId": metadata.prompt_event_id.as_str(),
        "prompt_event_id": metadata.prompt_event_id.as_str(),
        "promptEventSource": metadata.prompt_event_source.as_deref().unwrap_or_default(),
        "prompt_event_source": metadata.prompt_event_source.as_deref().unwrap_or_default(),
        "promptEventSubmittedAt": metadata.prompt_event_submitted_at.as_deref().unwrap_or_default(),
        "prompt_event_submitted_at": metadata.prompt_event_submitted_at.as_deref().unwrap_or_default(),
        "repo_id": req.repo_id,
        "repo_path": req.root_display.clone(),
        "status": plan_status,
        "summary": body,
        "terminalId": parked.pane_id.as_str(),
        "terminal_id": parked.pane_id.as_str(),
        "terminalIndex": metadata.terminal_index,
        "terminal_index": metadata.terminal_index,
        "terminalInstanceId": parked.instance_id,
        "terminal_instance_id": parked.instance_id,
        "threadId": metadata.thread_id.as_deref().unwrap_or_default(),
        "thread_id": metadata.thread_id.as_deref().unwrap_or_default(),
        "workspace_id": metadata.workspace_id.as_str(),
        "workspaceId": metadata.workspace_id.as_str(),
        "workspace_name": metadata.workspace_name.as_str(),
        "workspace_root": req.root_display.clone(),
    });

    log_terminal_status_event(
        "backend.voice_plan_task_status.terminal_lifecycle_send",
        json!({
            "payload": payload.clone(),
            "reason": "terminal_parked_or_resume_lifecycle",
            "terminal_lifecycle_status": status,
            "voice_plan_status": plan_status,
        }),
    );
    let result = cloud_mcp_post_event_endpoint(state, "voice_plan_task_status", &payload).await;
    match &result {
        Ok(value) => {
            log_terminal_status_event(
                "backend.voice_plan_task_status.terminal_lifecycle_result",
                json!({
                    "ok": true,
                    "prompt_event_id": metadata.prompt_event_id.as_str(),
                    "result": value,
                    "voice_plan_status": plan_status,
                }),
            );
            let _ = app.emit(
                VOICE_PLAN_SERVER_RESULT_EVENT,
                json!({
                    "result": value,
                    "source": "backend_terminal_parked_lifecycle",
                    "statusPayload": payload,
                    "workspaceId": metadata.workspace_id.as_str(),
                }),
            );
        }
        Err(error) => log_terminal_status_event(
            "backend.voice_plan_task_status.terminal_lifecycle_error",
            json!({
                "error": clean_terminal_telemetry_text(error),
                "payload": payload,
                "prompt_event_id": metadata.prompt_event_id.as_str(),
                "voice_plan_status": plan_status,
            }),
        ),
    }
}

fn cloud_mcp_lifecycle_status_releases_lane(status: &str) -> bool {
    !matches!(
        status,
        "starting"
            | "active"
            | "busy"
            | "running"
            | "dispatched"
            | "parked"
            | "resume_ready"
            | "resume_requested"
    )
}

fn cloud_mcp_lifecycle_status_resyncs_main_filetree(status: &str) -> bool {
    matches!(status, "cancelled" | "interrupted")
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
    if cloud_mcp_connected_or_connect(state).await.is_err() {
        return None;
    }

    let agent_id = cloud_mcp_terminal_agent_id(pane_id, instance_id, coordination);
    let repo_id = cloud_mcp_terminal_repo_id(working_directory, coordination);
    let repo_root = cloud_mcp_terminal_repo_root_path(working_directory, coordination);
    let terminal_key = cloud_mcp_terminal_key(pane_id, instance_id);
    let lifecycle_changed_files = if matches!(status, "done" | "review" | "merged" | "completed") {
        cloud_mcp_terminal_changed_files_for_status(coordination, local_task_id, working_directory)
    } else {
        Vec::new()
    };
    let should_sync_main_filetree = cloud_mcp_lifecycle_status_resyncs_main_filetree(status);
    let should_sync_filetree = should_sync_main_filetree
        || matches!(status, "done" | "merged" | "completed")
        || (status == "review" && !lifecycle_changed_files.is_empty());
    if should_sync_filetree {
        let sync_reason = if should_sync_main_filetree {
            "terminal_task_stopped_main_repo_resync"
        } else {
            "terminal_work_filetree_update"
        };
        if let Err(error) = cloud_mcp_push_current_filetree_snapshot(
            state,
            &repo_id,
            &repo_root,
            None,
            None,
            sync_reason,
        )
        .await
        {
            let _ = cloud_mcp_workspace_log(
                &repo_root,
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
    if matches!(status, "cancelled" | "interrupted") {
        if let Some(local_task_id) = local_task_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let worktree_id = cloud_mcp_terminal_worktree_id(coordination);
            let prune_payload = json!({
                "source": "rust-diffforge-terminal-lifecycle",
                "repo_id": repo_id,
                "agent_id": agent_id,
                "self_agent_id": agent_id,
                "current_agent_id": agent_id,
                "status": cloud_mcp_agent_status_for_lifecycle_status(status),
                "task_status": status,
                "task_id": local_task_id,
                "run_id": local_task_id,
                "lane": lane,
                "workspace_root": workspace_path_display(&repo_root),
                "terminal_id": pane_id,
                "terminal_instance_id": instance_id,
                "worktree_id": worktree_id.clone(),
                "record_spec_activity": false,
                "prune_spec_activity": true,
                "remove_isolated_work": true,
                "claimed_paths": [],
                "summary": brief,
                "metadata": {
                    "reason": "terminal_task_stopped",
                    "terminal_lifecycle_status": status,
                    "coordination_task_id": local_task_id,
                    "local_coordination_task_id": local_task_id,
                    "worktree_id": worktree_id.clone(),
                },
                "ts_ms": cloud_mcp_now_ms(),
            });
            let _ =
                cloud_mcp_post_event_endpoint(state, "isolated_work_pruned", &prune_payload).await;
            let _ = cloud_mcp_prune_cached_isolated_spec_work(
                Some(&repo_root),
                Some(&repo_id),
                local_task_id,
                worktree_id.as_deref(),
                &[],
                "terminal_task_stopped",
            );
        }
    }
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

pub(crate) async fn cloud_mcp_mark_terminal_context_interrupted(
    state: &CloudMcpState,
    pane_id: &str,
    instance_id: u64,
    close_context: &TerminalCloudMcpCloseContext,
    _reason: &str,
    brief: &str,
) -> bool {
    let terminal_key = cloud_mcp_terminal_key(pane_id, instance_id);
    let context_entry = {
        let runtime = state.inner.lock().await;
        runtime.terminal_contexts.get(&terminal_key).cloned()
    };
    let active_task = close_context.active_task.lock().await.clone();
    if active_task.is_none() && context_entry.is_none() {
        return false;
    }

    if cloud_mcp_connected_or_connect(state).await.is_err() {
        let mut runtime = state.inner.lock().await;
        runtime.terminal_contexts.remove(&terminal_key);
        return false;
    }

    let coordination = close_context.coordination.as_ref();
    let working_directory = close_context.working_directory.as_ref();
    let lane = context_entry
        .as_ref()
        .map(|entry| entry.lane.as_str())
        .filter(|lane| !lane.trim().is_empty())
        .unwrap_or("terminal-agent")
        .to_string();
    let local_task_id = active_task
        .as_ref()
        .map(|task| task.task_id.as_str())
        .or_else(|| {
            context_entry
                .as_ref()
                .and_then(|entry| entry.local_task_id.as_deref())
        });
    let title = active_task
        .as_ref()
        .map(|task| task.title.as_str())
        .or_else(|| {
            context_entry
                .as_ref()
                .map(|entry| entry.work_brief.as_str())
                .filter(|value| !value.trim().is_empty())
        });

    cloud_mcp_mark_terminal_task_lifecycle(
        state,
        pane_id,
        instance_id,
        working_directory,
        coordination,
        local_task_id,
        title,
        "interrupted",
        &lane,
        brief,
    )
    .await;
    true
}

pub(crate) async fn cloud_mcp_mark_terminal_closed(
    state: &CloudMcpState,
    pane_id: &str,
    instance_id: u64,
    close_context: &TerminalCloudMcpCloseContext,
    reason: &str,
) {
    if cloud_mcp_connected_or_connect(state).await.is_err() {
        let terminal_key = cloud_mcp_terminal_key(pane_id, instance_id);
        let mut runtime = state.inner.lock().await;
        runtime.terminal_contexts.remove(&terminal_key);
        return;
    }

    let coordination = close_context.coordination.as_ref();
    let working_directory = close_context.working_directory.as_ref();
    let agent_id = cloud_mcp_terminal_agent_id(pane_id, instance_id, coordination);
    let repo_id = cloud_mcp_terminal_repo_id(working_directory, coordination);
    let terminal_key = cloud_mcp_terminal_key(pane_id, instance_id);
    let active_task = close_context.active_task.lock().await.clone();
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
        .or_else(|| {
            context_entry
                .as_ref()
                .and_then(|entry| entry.local_task_id.as_deref())
        });
    let title = active_task.as_ref().map(|task| task.title.as_str());
    let last_prompt = context_entry
        .as_ref()
        .map(|entry| entry.last_prompt.as_str())
        .filter(|prompt| !prompt.trim().is_empty());
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
    }

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

    let mut runtime = state.inner.lock().await;
    runtime.terminal_contexts.remove(&terminal_key);
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
    app: AppHandle,
    state: CloudMcpState,
    pane_id: &str,
    instance_id: u64,
    chunk: &[u8],
) {
    let observe_started_at = Instant::now();
    let decode_started_at = Instant::now();
    let text = String::from_utf8_lossy(chunk);
    let decode_ms = terminal_diagnostic_elapsed_ms(decode_started_at);
    let scan_started_at = Instant::now();
    let looks_active = cloud_mcp_terminal_output_looks_active(&text);
    let looks_ready = cloud_mcp_terminal_output_looks_ready(&text);
    let scan_ms = terminal_diagnostic_elapsed_ms(scan_started_at);
    if !looks_active && !looks_ready {
        let elapsed_ms = terminal_diagnostic_elapsed_ms(observe_started_at);
        if elapsed_ms >= TERMINAL_DIAGNOSTIC_SLOW_MS {
            log_terminal_diagnostic_event(
                &app,
                "backend.output_observer.inactive_slow",
                json!({
                    "bytes": chunk.len(),
                    "decode_ms": decode_ms,
                    "elapsed_ms": elapsed_ms,
                    "instance_id": instance_id,
                    "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                    "scan_ms": scan_ms,
                }),
            );
        }
        return;
    }

    log_terminal_status_event(
        "backend.terminal.ground_truth.output_observed",
        json!({
            "bytes": chunk.len(),
            "decoded_preview": clean_terminal_diagnostic_log_text(&text),
            "instance_id": instance_id,
            "looks_active": looks_active,
            "looks_ready": looks_ready,
            "pane_id": clean_terminal_diagnostic_log_text(pane_id),
            "status_truth": if looks_ready { "idle_or_prompt_ready" } else { "processing_or_active" },
        }),
    );

    let terminal_key = cloud_mcp_terminal_key(pane_id, instance_id);
    let work_brief = cloud_mcp_extract_agent_work_brief(&text);
    let (work_update, completion) = {
        let lock_started_at = Instant::now();
        let mut runtime = state.inner.lock().await;
        let lock_ms = terminal_diagnostic_elapsed_ms(lock_started_at);
        let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) else {
            log_terminal_status_event(
                "backend.terminal.ground_truth.missing_context",
                json!({
                    "bytes": chunk.len(),
                    "instance_id": instance_id,
                    "looks_active": looks_active,
                    "looks_ready": looks_ready,
                    "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                    "status_truth": if looks_ready { "idle_or_prompt_ready" } else { "processing_or_active" },
                }),
            );
            let elapsed_ms = terminal_diagnostic_elapsed_ms(observe_started_at);
            if elapsed_ms >= TERMINAL_DIAGNOSTIC_SLOW_MS {
                log_terminal_diagnostic_event(
                    &app,
                    "backend.output_observer.missing_context_slow",
                    json!({
                        "bytes": chunk.len(),
                        "decode_ms": decode_ms,
                        "elapsed_ms": elapsed_ms,
                        "instance_id": instance_id,
                        "lock_ms": lock_ms,
                        "looks_active": looks_active,
                        "looks_ready": looks_ready,
                        "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                        "scan_ms": scan_ms,
                    }),
                );
            }
            return;
        };
        if looks_active {
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
        let completion =
            if entry.saw_agent_activity && !entry.done_reported && old_enough && looks_ready {
                entry.done_reported = true;
                Some((
                    entry.local_task_id.clone(),
                    entry.repo_id.clone(),
                    entry.agent_id.clone(),
                    entry.lane.clone(),
                    entry.last_prompt.clone(),
                    entry.work_brief.clone(),
                    entry.working_directory.clone(),
                    entry.prompt_event_id.clone(),
                    entry.prompt_event_source.clone(),
                    entry.prompt_event_submitted_at.clone(),
                    entry.terminal_index,
                    entry.thread_id.clone(),
                    entry.workspace_id.clone(),
                    entry.workspace_name.clone(),
                ))
            } else {
                None
            };
        let elapsed_ms = terminal_diagnostic_elapsed_ms(observe_started_at);
        if elapsed_ms >= TERMINAL_DIAGNOSTIC_SLOW_MS {
            log_terminal_diagnostic_event(
                &app,
                "backend.output_observer.match_slow",
                json!({
                    "bytes": chunk.len(),
                    "decode_ms": decode_ms,
                    "elapsed_ms": elapsed_ms,
                    "instance_id": instance_id,
                    "lock_ms": lock_ms,
                    "looks_active": looks_active,
                    "looks_ready": looks_ready,
                    "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                    "scan_ms": scan_ms,
                    "will_complete": completion.is_some(),
                    "will_update": work_update.is_some(),
                }),
            );
        }
        (work_update, completion)
    };

    log_terminal_status_event(
        "backend.terminal.ground_truth.output_decision",
        json!({
            "bytes": chunk.len(),
            "instance_id": instance_id,
            "looks_active": looks_active,
            "looks_ready": looks_ready,
            "pane_id": clean_terminal_diagnostic_log_text(pane_id),
            "status_truth": if looks_ready { "idle_or_prompt_ready" } else { "processing_or_active" },
            "will_mark_done": completion.is_some(),
            "will_send_active_update": work_update.is_some(),
        }),
    );

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

    let Some((
        local_task_id,
        repo_id,
        agent_id,
        lane,
        _prompt,
        work_brief,
        working_directory,
        prompt_event_id,
        prompt_event_source,
        prompt_event_submitted_at,
        terminal_index,
        thread_id,
        workspace_id,
        _workspace_name,
    )) = completion
    else {
        return;
    };
    log_terminal_status_event(
        "backend.terminal.ground_truth.done_detected",
        json!({
            "agent_id": agent_id.clone(),
            "instance_id": instance_id,
            "lane": lane.clone(),
            "local_task_id": local_task_id.clone(),
            "pane_id": clean_terminal_diagnostic_log_text(pane_id),
            "prompt_event_id": prompt_event_id.clone(),
            "prompt_event_submitted_at": prompt_event_submitted_at.clone(),
            "repo_id": repo_id.clone(),
            "status_truth": "idle_or_prompt_ready",
            "thread_id": thread_id.clone(),
            "workspace_id": workspace_id.clone(),
            "work_brief": clean_terminal_diagnostic_log_text(&work_brief),
        }),
    );
    if let Some(prompt_event_id) = prompt_event_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        log_terminal_status_event(
            "backend.voice_plan_task_status.prompt_ready_not_final",
            json!({
                "agent_id": agent_id.clone(),
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "prompt_event_id": prompt_event_id,
                "prompt_event_source": prompt_event_source.clone(),
                "reason": "terminal_prompt_ready_is_not_provider_turn_complete",
                "terminal_index": terminal_index,
                "thread_id": thread_id.clone(),
                "workspace_id": workspace_id.clone(),
            }),
        );
    }
    let scan_root = working_directory.clone();
    let changed_files =
        match tauri::async_runtime::spawn_blocking(move || cloud_mcp_git_changed_files(&scan_root))
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
    prompt_metadata: Option<CloudMcpTerminalPromptMetadata>,
) {
    let prompt = cloud_mcp_clean_prompt_text(&prompt);
    if prompt.trim().is_empty() {
        return;
    }
    let started_at = Instant::now();
    let agent_id = cloud_mcp_terminal_agent_id(&pane_id, instance_id, coordination.as_ref());
    let repo_id = cloud_mcp_terminal_repo_id(&working_directory, coordination.as_ref());
    let terminal_key = cloud_mcp_terminal_key(&pane_id, instance_id);
    let prompt_metadata = prompt_metadata.unwrap_or_else(|| CloudMcpTerminalPromptMetadata {
        prompt_event_id: None,
        prompt_event_source: None,
        prompt_event_submitted_at: None,
        terminal_index: None,
        thread_id: None,
        workspace_id: String::new(),
        workspace_name: String::new(),
    });
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
                prompt_event_id: prompt_metadata.prompt_event_id.clone(),
                prompt_event_source: prompt_metadata.prompt_event_source.clone(),
                prompt_event_submitted_at: prompt_metadata.prompt_event_submitted_at.clone(),
                terminal_index: prompt_metadata.terminal_index,
                thread_id: prompt_metadata.thread_id.clone(),
                workspace_id: prompt_metadata.workspace_id.clone(),
                workspace_name: prompt_metadata.workspace_name.clone(),
                created_ms: cloud_mcp_now_ms(),
                last_changed_hash: String::new(),
                last_checkpoint_ms: 0,
                local_task_id: local_task_id.clone(),
                reported_change: false,
                stable_review_reported: false,
                stable_change_cycles: 0,
                saw_agent_activity: false,
                work_brief: String::new(),
                work_brief_reported: false,
                done_reported: false,
            },
        );
    }

    if let Err(error) = cloud_mcp_connected_or_connect(&state).await {
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
        "agent_kind": coordination.as_ref().map(|coordination| coordination.agent_kind.clone()),
        "coding_agent": coordination.as_ref().map(|coordination| coordination.agent_kind.clone()),
        "self_agent_id": agent_id,
        "current_agent_id": agent_id,
        "terminal_id": pane_id,
        "terminal_instance_id": instance_id,
        "terminal_index": prompt_metadata.terminal_index,
        "thread_id": prompt_metadata.thread_id,
        "workspace_id": prompt_metadata.workspace_id,
        "workspace_name": prompt_metadata.workspace_name,
        "prompt_event_id": prompt_metadata.prompt_event_id,
        "prompt_event_source": prompt_metadata.prompt_event_source,
        "prompt_event_submitted_at": prompt_metadata.prompt_event_submitted_at,
        "task_id": local_task_id.clone(),
        "run_id": local_task_id.clone(),
        "prompt": prompt,
        "workspace_root": workspace_path_display(&working_directory),
        "coordination": coordination.as_ref().map(|coordination| json!({
            "agent_id": coordination.agent_id.clone(),
            "agent_kind": coordination.agent_kind.clone(),
            "session_id": coordination.session_id.clone(),
            "repo_path": coordination.repo_path.clone(),
            "local_task_id": local_task_id.clone(),
            "local_task_title": local_task_title.clone(),
        })),
        "ts_ms": cloud_mcp_now_ms(),
    });

    let _ = cloud_mcp_post_event_endpoint(&state, "terminal_prompt_submitted", &payload).await;

    cloud_mcp_sync_terminal_agent_status(
        &state,
        &repo_id,
        &agent_id,
        "terminal-agent",
        "starting",
        Some(payload["prompt"].as_str().unwrap_or_default()),
        "Terminal prompt submitted; preparing Spec Graph context.",
        &working_directory,
        &pane_id,
        instance_id,
        coordination.as_ref(),
        local_task_id.as_deref(),
        "terminal_prompt_submitted",
    )
    .await;

    match cloud_mcp_post_json_endpoint(&state, "/v1/context/pack", &payload).await {
        Ok(response) => {
            let data = cloud_mcp_response_data(&response);
            let suggested_lane = data["current_work"]["suggested_lane"]
                .as_str()
                .or_else(|| data["suggested_lane"].as_str())
                .unwrap_or_default()
                .to_string();
            let active_agent_count = data["peers"].as_array().map(Vec::len).unwrap_or(0);
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
            runtime
                .terminal_contexts
                .get(&terminal_key)
                .map(|entry| (entry.local_task_id.clone(), entry.work_brief.clone()))
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
        let local_task_id_for_scope = local_task_id_for_scope
            .or_else(|| cloud_mcp_terminal_active_task_id(coordination.as_ref()));
        let Some(local_task_id_for_scope) = local_task_id_for_scope
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            let mut runtime = state.inner.lock().await;
            if let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) {
                entry.last_changed_hash.clear();
                entry.reported_change = false;
                entry.stable_review_reported = false;
                entry.stable_change_cycles = 0;
            } else {
                break;
            }
            continue;
        };
        {
            let mut runtime = state.inner.lock().await;
            if let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) {
                if entry.local_task_id.as_deref() != Some(local_task_id_for_scope.as_str()) {
                    entry.local_task_id = Some(local_task_id_for_scope.clone());
                    entry.last_changed_hash.clear();
                    entry.reported_change = false;
                    entry.stable_review_reported = false;
                    entry.stable_change_cycles = 0;
                }
            } else {
                break;
            }
        }
        let scopes = cloud_mcp_terminal_claimed_paths(
            coordination.as_ref(),
            Some(local_task_id_for_scope.as_str()),
        );
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
        let Some((should_report, should_complete, work_brief)) = ({
            let mut runtime = state.inner.lock().await;
            if let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) {
                let work_brief = entry.work_brief.clone();
                if changed_hash.is_empty() {
                    entry.last_changed_hash.clear();
                    entry.stable_change_cycles = 0;
                    Some((false, false, work_brief))
                } else if entry.last_changed_hash == changed_hash {
                    if entry.reported_change {
                        entry.stable_change_cycles = entry.stable_change_cycles.saturating_add(1);
                    }
                    Some((
                        false,
                        entry.reported_change
                            && !entry.stable_review_reported
                            && entry.stable_change_cycles >= 4,
                        work_brief,
                    ))
                } else {
                    entry.last_changed_hash = changed_hash.clone();
                    entry.last_checkpoint_ms = cloud_mcp_now_ms();
                    entry.reported_change = true;
                    entry.stable_review_reported = false;
                    entry.stable_change_cycles = 0;
                    Some((true, false, work_brief))
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
                "Changes look stable; waiting for terminal prompt: {}",
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
                    "local_task_id": local_task_id_for_scope.as_str(),
                    "status": "active",
                    "completion_gate": "terminal_prompt_ready_required",
                    "changed_file_count": changed_files.len(),
                }),
            );
            cloud_mcp_sync_terminal_agent_status(
                &state,
                &repo_id,
                &agent_id,
                &lane,
                "active",
                None,
                &brief,
                &working_directory,
                &pane_id,
                instance_id,
                coordination.as_ref(),
                Some(local_task_id_for_scope.as_str()),
                "stable_file_changes_ready",
            )
            .await;
            let mut runtime = state.inner.lock().await;
            if let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) {
                entry.reported_change = false;
                entry.stable_review_reported = true;
                entry.stable_change_cycles = 0;
            }
            continue;
        }
        if !should_report {
            continue;
        }
        if cloud_mcp_connected_or_connect(&state).await.is_err() {
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
            "task_id": local_task_id_for_scope.as_str(),
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
    cloud_mcp_connect_state(state.inner()).await
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
async fn cloud_mcp_sync_agent_installations(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    agent_statuses: Value,
    reason: Option<String>,
) -> Result<Value, String> {
    let clean_option = |value: Option<String>| {
        value
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let workspace_id = clean_option(workspace_id);
    let workspace_name = clean_option(workspace_name);
    let reason = clean_option(reason).unwrap_or_else(|| "agent_status_refresh".to_string());
    let req =
        cloud_mcp_spec_graph_sync_request(repo_path, workspace_id.clone(), workspace_name.clone());
    let agent_count = agent_statuses
        .as_array()
        .map(Vec::len)
        .ok_or_else(|| "Agent installation sync requires an agentStatuses array.".to_string())?;
    let snapshot_id = format!(
        "agent-installations-{}-{}",
        cloud_mcp_now_ms(),
        uuid::Uuid::new_v4()
    );
    let payload = json!({
        "source": "rust-diffforge-agent-installation-sync",
        "event_kind": "agent_installation_snapshot",
        "repo_id": req.repo_id,
        "repo_path": req.root_display,
        "workspace_root": req.root_display,
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "agent_id": "rust-diffforge",
        "agent_label": "Diff Forge Desktop",
        "reason": reason,
        "snapshot_id": snapshot_id,
        "agent_count": agent_count,
        "agents": agent_statuses,
        "summary": "Desktop installed agent inventory synced.",
        "ts_ms": cloud_mcp_now_ms(),
    });

    cloud_mcp_post_event_endpoint(state.inner(), "agent_installation_snapshot", &payload).await
}

#[tauri::command]
async fn cloud_mcp_record_spec_edit_intent(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: String,
    workspace_name: Option<String>,
    intent: Value,
) -> Result<Value, String> {
    let req = cloud_mcp_spec_graph_sync_request(
        repo_path.clone(),
        Some(workspace_id.clone()),
        workspace_name.clone(),
    );
    let mut payload = match intent {
        Value::Object(object) => Value::Object(object),
        _ => return Err("Spec edit intent payload must be an object.".to_string()),
    };
    let event_kind = cloud_mcp_payload_text(&payload, &["event_kind", "eventKind", "kind"])
        .unwrap_or_else(|| "spec_edit_requested".to_string());
    if let Some(object) = payload.as_object_mut() {
        object.insert("event_kind".to_string(), json!(event_kind.clone()));
        object.insert("repo_id".to_string(), json!(req.repo_id.clone()));
        object.insert("repo_path".to_string(), json!(req.root_display.clone()));
        object.insert(
            "workspace_root".to_string(),
            json!(req.root_display.clone()),
        );
        object.insert("workspace_id".to_string(), json!(workspace_id.clone()));
        if let Some(name) = workspace_name {
            object.insert("workspace_name".to_string(), json!(name));
        }
    }

    cloud_mcp_post_event_endpoint(state.inner(), &event_kind, &payload).await
}

#[tauri::command]
async fn cloud_mcp_record_voice_plan_task_status(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: String,
    workspace_name: Option<String>,
    status: Value,
) -> Result<Value, String> {
    let req = cloud_mcp_spec_graph_sync_request(
        repo_path.clone(),
        Some(workspace_id.clone()),
        workspace_name.clone(),
    );
    let mut payload = match status {
        Value::Object(object) => Value::Object(object),
        _ => return Err("Voice plan task status payload must be an object.".to_string()),
    };
    let plan_run_id = cloud_mcp_payload_text(&payload, &["planRunId"])
        .or_else(|| cloud_mcp_payload_text(&payload, &["plan_run_id"]))
        .or_else(|| cloud_mcp_payload_text(&payload, &["runId"]))
        .or_else(|| cloud_mcp_payload_text(&payload, &["run_id"]));
    let plan_task_id = cloud_mcp_payload_text(&payload, &["planTaskId"])
        .or_else(|| cloud_mcp_payload_text(&payload, &["plan_task_id"]))
        .or_else(|| cloud_mcp_payload_text(&payload, &["taskId"]))
        .or_else(|| cloud_mcp_payload_text(&payload, &["task_id"]));
    let plan_stage = cloud_mcp_payload_text(&payload, &["planStage"])
        .or_else(|| cloud_mcp_payload_text(&payload, &["plan_stage"]))
        .or_else(|| cloud_mcp_payload_text(&payload, &["stage"]));
    let prompt_event_id = cloud_mcp_payload_text(&payload, &["promptEventId"])
        .or_else(|| cloud_mcp_payload_text(&payload, &["prompt_event_id"]));
    let plan_step_ordinal = payload
        .get("planStepOrdinal")
        .or_else(|| payload.get("plan_step_ordinal"))
        .or_else(|| payload.get("stepOrdinal"))
        .or_else(|| payload.get("step_ordinal"))
        .cloned();
    if let Some(object) = payload.as_object_mut() {
        object.insert("event_kind".to_string(), json!("voice_plan_task_status"));
        object.insert("repo_id".to_string(), json!(req.repo_id.clone()));
        object.insert("repoId".to_string(), json!(req.repo_id.clone()));
        object.insert("repo_path".to_string(), json!(req.root_display.clone()));
        object.insert("repoPath".to_string(), json!(req.root_display.clone()));
        object.insert(
            "workspace_root".to_string(),
            json!(req.root_display.clone()),
        );
        object.insert("workspaceRoot".to_string(), json!(req.root_display.clone()));
        object.insert("workspace_id".to_string(), json!(workspace_id.clone()));
        object.insert("workspaceId".to_string(), json!(workspace_id.clone()));
        if let Some(name) = workspace_name {
            object.insert("workspace_name".to_string(), json!(name));
        }
        if let Some(value) = plan_run_id.as_deref() {
            for key in ["planRunId", "plan_run_id", "runId", "run_id"] {
                object.insert(key.to_string(), json!(value));
            }
        }
        if let Some(value) = plan_task_id.as_deref() {
            for key in ["planTaskId", "plan_task_id", "taskId", "task_id"] {
                object.insert(key.to_string(), json!(value));
            }
        }
        if let Some(value) = plan_stage.as_deref() {
            for key in ["planStage", "plan_stage", "stage"] {
                object.insert(key.to_string(), json!(value));
            }
        }
        if let Some(value) = plan_step_ordinal {
            for key in [
                "planStepOrdinal",
                "plan_step_ordinal",
                "stepOrdinal",
                "step_ordinal",
            ] {
                object.insert(key.to_string(), value.clone());
            }
        }
        if let Some(value) = prompt_event_id.as_deref() {
            for key in ["promptEventId", "prompt_event_id"] {
                object.insert(key.to_string(), json!(value));
            }
        }
    }

    log_terminal_status_event(
        "backend.voice_plan_task_status.send",
        json!({
            "endpoint": "voice_plan_task_status",
            "payload": payload.clone(),
            "workspace_id": workspace_id,
        }),
    );
    let result =
        cloud_mcp_post_event_endpoint(state.inner(), "voice_plan_task_status", &payload).await;
    match &result {
        Ok(value) => log_terminal_status_event(
            "backend.voice_plan_task_status.result",
            json!({
                "endpoint": "voice_plan_task_status",
                "ok": true,
                "result": value,
            }),
        ),
        Err(error) => log_terminal_status_event(
            "backend.voice_plan_task_status.error",
            json!({
                "endpoint": "voice_plan_task_status",
                "error": clean_terminal_telemetry_text(error),
                "payload": payload,
            }),
        ),
    }
    result
}

#[tauri::command]
async fn cloud_mcp_get_activity(repo_path: String) -> Result<Value, String> {
    let root = resolve_workspace_root_directory(Some(&repo_path))
        .unwrap_or_else(|_| PathBuf::from(&repo_path));
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
    let root = resolve_workspace_root_directory(Some(&repo_path))
        .unwrap_or_else(|_| PathBuf::from(&repo_path));
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

fn cloud_mcp_graph_ws_event_matches(req: &CloudMcpSpecGraphSyncRequest, event: &Value) -> bool {
    let kind = cloud_mcp_payload_text(event, &["kind"])
        .or_else(|| cloud_mcp_payload_text(event, &["type"]))
        .unwrap_or_default();
    if kind == "graph_sync_ready" {
        return false;
    }
    if !kind.is_empty() && kind != "graph_invalidated" {
        return false;
    }

    let repo_id = cloud_mcp_payload_text(event, &["repo_id"])
        .or_else(|| cloud_mcp_payload_text(event, &["repoId"]));
    if repo_id
        .as_deref()
        .is_some_and(|event_repo_id| event_repo_id != req.repo_id)
    {
        return false;
    }

    let workspace_id = cloud_mcp_payload_text(event, &["workspace_id"])
        .or_else(|| cloud_mcp_payload_text(event, &["workspaceId"]));
    if let (Some(expected), Some(actual)) = (req.workspace_id.as_deref(), workspace_id.as_deref()) {
        return expected == actual;
    }

    true
}

async fn cloud_mcp_graph_ws_event_forward_loop(
    state: CloudMcpState,
    req: CloudMcpSpecGraphSyncRequest,
    stop: Arc<AtomicBool>,
    wake: Arc<tokio::sync::Notify>,
    event_tx: tokio::sync::mpsc::Sender<Result<Value, String>>,
) {
    if stop.load(Ordering::SeqCst) || crate::app_shutdown_requested() {
        return;
    }

    cloud_mcp_start_global_ws(&state).await;
    let mut ws_events = state.global_ws_events.subscribe();

    loop {
        if stop.load(Ordering::SeqCst) || crate::app_shutdown_requested() {
            break;
        }
        let wake_signal = wake.notified();
        tokio::pin!(wake_signal);
        tokio::select! {
            _ = &mut wake_signal => break,
            event = ws_events.recv() => {
                match event {
                    Ok(event) if cloud_mcp_graph_ws_event_matches(&req, &event) => {
                        if event_tx.send(Ok(event)).await.is_err() {
                            break;
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let _ = event_tx
                            .send(Ok(json!({
                                "kind": "graph_invalidated",
                                "event_kind": "app_ws_event_lagged",
                                "repo_id": req.repo_id,
                                "workspace_id": req.workspace_id,
                            })))
                            .await;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        let _ = event_tx
                            .send(Err("Cloud MCP app websocket event channel closed.".to_string()))
                            .await;
                        break;
                    }
                }
            }
        }
    }
}

fn cloud_mcp_repo_display_name(root: &Path) -> String {
    root.file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| workspace_path_display(root))
}

fn cloud_mcp_repo_display_root(root: &Path) -> String {
    let name = cloud_mcp_repo_display_name(root);
    if name.trim().is_empty() {
        "Workspace".to_string()
    } else {
        format!("/{name}")
    }
}

fn cloud_mcp_spec_graph_cache_dir(root: &Path) -> PathBuf {
    root.join(".agents").join("spec-graph")
}

fn cloud_mcp_cache_file_stem(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let sanitized = sanitized
        .trim_matches('_')
        .chars()
        .take(96)
        .collect::<String>();
    if sanitized.is_empty() {
        format!("cache-{}", cloud_mcp_short_hash(value))
    } else {
        sanitized
    }
}

fn cloud_mcp_spec_graph_cache_path(root: &Path, repo_id: &str) -> PathBuf {
    cloud_mcp_spec_graph_cache_dir(root)
        .join(format!("{}.json", cloud_mcp_cache_file_stem(repo_id)))
}

fn cloud_mcp_safe_spec_graph_cache_file(root: &Path, file_name: &str) -> Result<PathBuf, String> {
    let file_path = Path::new(file_name);
    if file_path.components().count() != 1
        || !matches!(file_path.components().next(), Some(Component::Normal(_)))
    {
        return Err("invalid_spec_graph_cache_file_name".to_string());
    }
    let cache_dir = cloud_mcp_spec_graph_cache_dir(root);
    if cloud_mcp_path_contains_symlink_under(root, &cache_dir) {
        return Err(format!(
            "Refusing to use symlinked Spec Graph cache directory {}",
            workspace_path_display(&cache_dir)
        ));
    }
    fs::create_dir_all(&cache_dir).map_err(|error| {
        format!(
            "Unable to create Spec Graph cache directory {}: {error}",
            workspace_path_display(&cache_dir)
        )
    })?;
    if cloud_mcp_path_contains_symlink_under(root, &cache_dir) {
        return Err(format!(
            "Refusing to use symlinked Spec Graph cache directory {}",
            workspace_path_display(&cache_dir)
        ));
    }
    let cache_path = cache_dir.join(file_name);
    if !cache_path.starts_with(&cache_dir)
        || cloud_mcp_path_contains_symlink_under(root, &cache_path)
    {
        return Err(format!(
            "Refusing to use unsafe Spec Graph cache path {}",
            workspace_path_display(&cache_path)
        ));
    }
    Ok(cache_path)
}

fn cloud_mcp_safe_spec_graph_repo_cache_path(
    root: &Path,
    repo_id: &str,
) -> Result<PathBuf, String> {
    let file_name = format!("{}.json", cloud_mcp_cache_file_stem(repo_id));
    cloud_mcp_safe_spec_graph_cache_file(root, &file_name)
}

fn cloud_mcp_local_ignored_whitelist_candidates(root: &Path) -> Vec<(String, PathBuf)> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    for relative_path in [
        "AGENTS.md",
        "agents.md",
        "CLAUDE.md",
        "claude.md",
        ".mcp.json",
        ".gitignore",
        ".agents",
        ".codex",
    ] {
        let path = root.join(relative_path);
        if !path.exists() {
            continue;
        }
        let normalized = relative_path.to_ascii_lowercase();
        if seen.insert(normalized) {
            candidates.push((relative_path.to_string(), path));
        }
    }
    candidates.sort_by(|left, right| left.0.cmp(&right.0));
    candidates
}

fn cloud_mcp_local_ignored_entry_signature(relative_path: &str, path: &Path) -> Option<Value> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() {
        return None;
    }
    let kind = if metadata.is_dir() {
        "folder"
    } else if metadata.is_file() {
        "file"
    } else {
        return None;
    };
    Some(json!({
        "path": relative_path,
        "kind": kind,
        "size": metadata.is_file().then_some(metadata.len()),
        "modified_ms": metadata.is_file().then(|| cloud_mcp_modified_ms(&metadata)).flatten(),
    }))
}

fn cloud_mcp_local_ignored_title(relative_path: &str) -> String {
    Path::new(relative_path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(relative_path)
        .to_string()
}

fn cloud_mcp_local_ignored_summary(relative_path: &str, kind: &str) -> String {
    match relative_path {
        ".gitignore" => "Local git ignore rules file.".to_string(),
        ".mcp.json" => "Local MCP configuration file.".to_string(),
        ".agents" => "Local Diff Forge agent cache and coordination folder.".to_string(),
        ".codex" => "Local Codex configuration folder.".to_string(),
        "AGENTS.md" | "agents.md" => "Local agent instructions document.".to_string(),
        "CLAUDE.md" | "claude.md" => "Local Claude instructions document.".to_string(),
        _ if kind == "folder" => format!("Local ignored folder `{relative_path}`."),
        _ => format!("Local ignored file `{relative_path}`."),
    }
}

fn cloud_mcp_local_ignored_overlay_node(
    repo_id: &str,
    relative_path: &str,
    path: &Path,
) -> Option<Value> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() {
        return None;
    }
    let kind = if metadata.is_dir() {
        "folder"
    } else if metadata.is_file() {
        "file"
    } else {
        return None;
    };
    let title = cloud_mcp_local_ignored_title(relative_path);
    let summary = cloud_mcp_local_ignored_summary(relative_path, kind);
    let id = format!(
        "local-ignored-{}",
        cloud_mcp_short_hash(&format!("{repo_id}:{relative_path}"))
    );
    Some(json!({
        "id": id,
        "repo_id": repo_id,
        "node_type": kind,
        "title": title,
        "summary": summary,
        "purpose": summary,
        "path": relative_path,
        "freshness_state": "no_spec",
        "spec_state": "no_spec",
        "file_source": "local_ignored",
        "file_origin": "local",
        "local_only": true,
        "ignored_overlay": true,
        "provisional": false,
        "pending_main_sync": false,
        "active_agent_count": 0,
        "active_agents": [],
        "active_specs": [],
        "superseded_specs": [],
        "specs": [],
        "metadata": {
            "path": relative_path,
            "source": "local_ignored",
            "origin": "local",
            "local_only": true,
            "ignored_overlay": true,
            "whitelisted_ignored_path": true,
            "kind": kind,
            "size": metadata.is_file().then_some(metadata.len()),
            "modified_ms": metadata.is_file().then(|| cloud_mcp_modified_ms(&metadata)).flatten(),
        },
    }))
}

fn cloud_mcp_build_local_ignored_spec_graph_overlay(root: &Path) -> Result<Value, String> {
    let repo_id = cloud_mcp_repo_id_for_root(root);
    let root_display = workspace_path_display(root);
    let repo_name = cloud_mcp_repo_display_name(root);
    let display_root = cloud_mcp_repo_display_root(root);
    let cache_path =
        cloud_mcp_safe_spec_graph_cache_file(root, CLOUD_MCP_LOCAL_IGNORED_OVERLAY_FILE)?;
    let candidates = cloud_mcp_local_ignored_whitelist_candidates(root);
    let signatures = candidates
        .iter()
        .filter_map(|(relative_path, path)| {
            cloud_mcp_local_ignored_entry_signature(relative_path, path)
        })
        .collect::<Vec<_>>();
    let cache_key = cloud_mcp_short_hash(
        &json!({
            "version": CLOUD_MCP_LOCAL_IGNORED_OVERLAY_VERSION,
            "repo_id": repo_id,
            "root": root_display,
            "signatures": signatures,
        })
        .to_string(),
    );

    if let Some(mut cached) = fs::read_to_string(&cache_path)
        .ok()
        .and_then(|body| serde_json::from_str::<Value>(&body).ok())
        .filter(|cached| cached["cache_key"].as_str() == Some(cache_key.as_str()))
    {
        if let Some(object) = cached.as_object_mut() {
            object.insert("cache_hit".to_string(), json!(true));
            object.insert(
                "cache_path".to_string(),
                json!(workspace_path_display(&cache_path)),
            );
            object.insert("repo_name".to_string(), json!(repo_name.clone()));
            object.insert("display_root".to_string(), json!(display_root.clone()));
        }
        return Ok(cached);
    }

    let nodes = candidates
        .iter()
        .filter_map(|(relative_path, path)| {
            cloud_mcp_local_ignored_overlay_node(&repo_id, relative_path, path)
        })
        .collect::<Vec<_>>();
    let overlay = json!({
        "ok": true,
        "source": "rust-diffforge-local-ignored-overlay",
        "local_only": true,
        "cache_hit": false,
        "cache_key": cache_key,
        "cache_path": workspace_path_display(&cache_path),
        "repo_id": repo_id,
        "repo_path": root_display,
        "repo_name": repo_name,
        "display_root": display_root,
        "allowed_paths": ["AGENTS.md", "CLAUDE.md", ".mcp.json", ".gitignore", ".agents", ".codex"],
        "nodes": nodes,
        "edges": [],
        "updated_at_ms": cloud_mcp_now_ms(),
    });
    let body = serde_json::to_vec_pretty(&overlay)
        .map_err(|error| format!("Unable to encode local ignored Spec Graph overlay: {error}"))?;
    fs::write(&cache_path, body).map_err(|error| {
        format!(
            "Unable to write local ignored Spec Graph overlay cache {}: {error}",
            workspace_path_display(&cache_path)
        )
    })?;
    Ok(overlay)
}

fn cloud_mcp_knowledge_dir(root: &Path) -> PathBuf {
    root.join(".agents").join("knowledge")
}

fn cloud_mcp_path_contains_symlink(path: &Path) -> bool {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if fs::symlink_metadata(&current)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return true;
        }
    }
    false
}

fn cloud_mcp_path_contains_symlink_under(root: &Path, path: &Path) -> bool {
    if fs::symlink_metadata(root)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return true;
    }
    let Ok(relative) = path.strip_prefix(root) else {
        return cloud_mcp_path_contains_symlink(path);
    };
    let mut current = root.to_path_buf();
    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) {
            return true;
        }
        current.push(component.as_os_str());
        if fs::symlink_metadata(&current)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return true;
        }
    }
    false
}

fn cloud_mcp_safe_knowledge_target(
    knowledge_dir: &Path,
    relative_path: &Path,
) -> Result<PathBuf, String> {
    let target = knowledge_dir.join(relative_path);
    if !target.starts_with(knowledge_dir) {
        return Err("target_outside_knowledge_dir".to_string());
    }
    if cloud_mcp_path_contains_symlink(knowledge_dir) || cloud_mcp_path_contains_symlink(&target) {
        return Err("knowledge_path_contains_symlink".to_string());
    }
    Ok(target)
}

fn cloud_mcp_knowledge_authoring_result(response: &Value) -> Option<&Value> {
    response
        .pointer("/data/knowledge_authoring")
        .or_else(|| response.get("knowledge_authoring"))
}

fn cloud_mcp_knowledge_markdown_delta(response: &Value) -> Option<&Value> {
    response
        .pointer("/data/knowledge_markdown_delta")
        .or_else(|| response.get("knowledge_markdown_delta"))
        .or_else(|| response.pointer("/data/knowledge_authoring/knowledge_markdown_delta"))
        .or_else(|| response.pointer("/knowledge_authoring/knowledge_markdown_delta"))
}

fn cloud_mcp_knowledge_authoring_note_path(value: &str) -> Option<PathBuf> {
    let normalized = value.trim().replace('\\', "/");
    if normalized.is_empty() || normalized.starts_with('/') || normalized.contains(':') {
        return None;
    }
    let stripped = normalized
        .strip_prefix(".agents/knowledge/")
        .unwrap_or(&normalized)
        .trim_start_matches("./")
        .trim_end_matches('/');
    if stripped.is_empty()
        || stripped.starts_with('/')
        || stripped.contains(':')
        || !stripped.ends_with(".md")
    {
        return None;
    }
    let mut output = PathBuf::new();
    for part in stripped.split('/') {
        let part = part.trim();
        if part.is_empty() || part == "." || part == ".." || part == ".cache" {
            return None;
        }
        output.push(part);
    }
    (!output.as_os_str().is_empty()).then_some(output)
}

fn cloud_mcp_apply_knowledge_markdown_delta(repo_root: &Path, response: &Value) -> Value {
    let Some(delta) = cloud_mcp_knowledge_markdown_delta(response) else {
        return json!({"ok": true, "present": false, "applied": false, "reason": "no_markdown_delta"});
    };
    let repo_root_display = workspace_path_display(repo_root);
    let root = resolve_workspace_root_directory(Some(repo_root_display.as_str()))
        .unwrap_or_else(|_| repo_root.to_path_buf());
    let knowledge_dir = cloud_mcp_knowledge_dir(&root);
    if let Err(error) = fs::create_dir_all(&knowledge_dir) {
        return json!({
            "ok": false,
            "present": true,
            "applied": false,
            "error": format!("Unable to create knowledge atlas directory {}: {error}", workspace_path_display(&knowledge_dir)),
        });
    }
    if cloud_mcp_path_contains_symlink(&knowledge_dir) {
        return json!({
            "ok": false,
            "present": true,
            "applied": false,
            "error": "Knowledge atlas directory contains a symlink; refusing server markdown sync.",
        });
    }

    let mut applied = Vec::new();
    let mut deleted = Vec::new();
    let mut skipped = Vec::new();
    for file in delta
        .get("files")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let raw_path = file
            .get("path")
            .or_else(|| file.get("note_path"))
            .or_else(|| file.get("notePath"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(relative_path) = cloud_mcp_knowledge_authoring_note_path(raw_path) else {
            skipped.push(json!({"path": raw_path, "reason": "invalid_delta_path"}));
            continue;
        };
        let content = file
            .get("content")
            .or_else(|| file.get("markdown"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if content.trim().is_empty() {
            skipped.push(json!({"path": raw_path, "reason": "empty_content"}));
            continue;
        }
        let target = match cloud_mcp_safe_knowledge_target(&knowledge_dir, &relative_path) {
            Ok(target) => target,
            Err(reason) => {
                skipped.push(json!({"path": raw_path, "reason": reason}));
                continue;
            }
        };
        if let Some(parent) = target.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                skipped.push(json!({
                    "path": raw_path,
                    "reason": format!("create_parent_failed: {error}"),
                }));
                continue;
            }
            if cloud_mcp_path_contains_symlink(parent) {
                skipped.push(json!({"path": raw_path, "reason": "parent_contains_symlink"}));
                continue;
            }
        }
        let mut body = content.replace("\r\n", "\n");
        if !body.ends_with('\n') {
            body.push('\n');
        }
        if fs::read_to_string(&target).ok().as_deref() == Some(body.as_str()) {
            applied.push(json!({
                "path": relative_path.to_string_lossy(),
                "changed": false,
            }));
            continue;
        }
        match fs::write(&target, body) {
            Ok(_) => applied.push(json!({
                "path": relative_path.to_string_lossy(),
                "changed": true,
            })),
            Err(error) => skipped.push(json!({
                "path": raw_path,
                "reason": format!("write_failed: {error}"),
            })),
        }
    }
    for raw_path in delta
        .get("delete_paths")
        .or_else(|| delta.get("deletePaths"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let raw_path = raw_path.as_str().unwrap_or_default();
        let Some(relative_path) = cloud_mcp_knowledge_authoring_note_path(raw_path) else {
            skipped.push(json!({"path": raw_path, "reason": "invalid_delete_path"}));
            continue;
        };
        let target = match cloud_mcp_safe_knowledge_target(&knowledge_dir, &relative_path) {
            Ok(target) => target,
            Err(reason) => {
                skipped.push(json!({"path": raw_path, "reason": reason}));
                continue;
            }
        };
        match fs::remove_file(&target) {
            Ok(_) => deleted.push(json!({"path": relative_path.to_string_lossy()})),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => skipped.push(json!({
                "path": raw_path,
                "reason": format!("delete_failed: {error}"),
            })),
        }
    }

    json!({
        "ok": skipped.is_empty(),
        "present": true,
        "applied": !applied.is_empty() || !deleted.is_empty(),
        "root": workspace_path_display(&root),
        "mode": delta["mode"].clone(),
        "source_of_truth": delta["source_of_truth"].clone(),
        "files": applied,
        "deleted": deleted,
        "skipped": skipped,
    })
}

fn cloud_mcp_materialize_knowledge_graph_mirror(repo_root: &Path, data: &Value) -> Value {
    let mut files = Vec::new();
    let mut expected_paths = HashSet::new();
    for node in data
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let raw_path = node
            .get("note_path")
            .or_else(|| node.get("notePath"))
            .or_else(|| node.get("markdown_path"))
            .or_else(|| node.get("markdownPath"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(relative_path) = cloud_mcp_knowledge_authoring_note_path(raw_path) else {
            continue;
        };
        let markdown = node
            .get("markdown")
            .or_else(|| node.get("standard_capsule"))
            .or_else(|| node.get("standardCapsule"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if markdown.is_empty() {
            continue;
        }
        let relative = relative_path.to_string_lossy().replace('\\', "/");
        expected_paths.insert(relative.clone());
        files.push(json!({
            "path": format!(".agents/knowledge/{relative}"),
            "note_path": relative,
            "content": markdown,
        }));
    }
    let response = json!({
        "knowledge_markdown_delta": {
            "mode": "full_server_graph_mirror",
            "source_of_truth": "server_authored_knowledge_graph",
            "files": files,
            "delete_paths": [],
        }
    });
    let mut applied = cloud_mcp_apply_knowledge_markdown_delta(repo_root, &response);
    if expected_paths.is_empty() {
        return applied;
    }
    let knowledge_dir = cloud_mcp_knowledge_dir(repo_root);
    let mut deleted = Vec::new();
    let mut skipped = Vec::new();
    if !cloud_mcp_path_contains_symlink(&knowledge_dir) {
        for path in cloud_mcp_collect_knowledge_note_paths(repo_root) {
            let Some(relative) = path
                .strip_prefix(&knowledge_dir)
                .ok()
                .and_then(cloud_mcp_normalize_knowledge_relative_path)
            else {
                continue;
            };
            if expected_paths.contains(&relative) {
                continue;
            }
            match fs::remove_file(&path) {
                Ok(_) => deleted.push(json!({"path": relative})),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => skipped.push(json!({
                    "path": relative,
                    "reason": format!("delete_stale_mirror_failed: {error}"),
                })),
            }
        }
    }
    if let Some(object) = applied.as_object_mut() {
        object.insert("expected_paths".to_string(), json!(expected_paths.len()));
        object.insert("pruned".to_string(), Value::Array(deleted));
        object.insert("prune_skipped".to_string(), Value::Array(skipped));
    }
    applied
}

fn cloud_mcp_apply_knowledge_authoring_result(repo_root: Option<&Path>, response: &Value) -> Value {
    let Some(repo_root) = repo_root else {
        return json!({"ok": false, "applied": false, "reason": "missing_repo_root"});
    };
    let markdown_delta_apply = cloud_mcp_apply_knowledge_markdown_delta(repo_root, response);
    let Some(authoring) = cloud_mcp_knowledge_authoring_result(response) else {
        return if markdown_delta_apply["present"].as_bool() == Some(true) {
            markdown_delta_apply
        } else {
            json!({"ok": true, "applied": false, "reason": "no_authoring_plan"})
        };
    };
    if markdown_delta_apply["present"].as_bool() == Some(true)
        && markdown_delta_apply["source_of_truth"].as_str()
            == Some("server_authored_knowledge_graph")
    {
        return json!({
            "ok": markdown_delta_apply["ok"].as_bool().unwrap_or(true),
            "applied": markdown_delta_apply["applied"].as_bool().unwrap_or(false),
            "reason": "server_markdown_delta_applied",
            "status": authoring["status"].clone(),
            "provider": authoring["provider"].clone(),
            "markdown_delta": markdown_delta_apply,
        });
    }
    if authoring["record"].as_bool() != Some(true) {
        return json!({
            "ok": markdown_delta_apply["ok"].as_bool().unwrap_or(true),
            "applied": markdown_delta_apply["applied"].as_bool().unwrap_or(false),
            "reason": authoring["reason"].as_str().unwrap_or("knowledge_authoring_not_recorded"),
            "status": authoring["status"].clone(),
            "provider": authoring["provider"].clone(),
            "markdown_delta": markdown_delta_apply,
        });
    }
    json!({
        "ok": markdown_delta_apply["ok"].as_bool().unwrap_or(true),
        "applied": markdown_delta_apply["applied"].as_bool().unwrap_or(false),
        "reason": "server_markdown_delta_required",
        "provider": authoring["provider"].clone(),
        "status": authoring["status"].clone(),
        "markdown_delta": markdown_delta_apply,
    })
}

fn cloud_mcp_knowledge_cache_dir(root: &Path) -> PathBuf {
    cloud_mcp_knowledge_dir(root).join(".cache")
}

fn cloud_mcp_knowledge_graph_cache_path(root: &Path, repo_id: &str) -> PathBuf {
    cloud_mcp_knowledge_cache_dir(root).join(format!("{}.json", cloud_mcp_cache_file_stem(repo_id)))
}

fn cloud_mcp_knowledge_note_id(repo_id: &str, note_path: &str) -> String {
    format!(
        "knowledge-{}",
        cloud_mcp_short_hash(&format!("{repo_id}:{note_path}"))
    )
}

fn cloud_mcp_knowledge_node_key(note_path: &str) -> String {
    if note_path.replace('\\', "/") == "index.md" {
        return "repo_root".to_string();
    }
    let stem = note_path
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or(note_path)
        .trim_end_matches(".md")
        .to_string();
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in stem.chars().flat_map(|ch| ch.to_lowercase()) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    let slug = slug.trim_matches('-');
    format!(
        "concept.{}",
        if slug.is_empty() {
            "project-context"
        } else {
            slug
        }
    )
}

fn cloud_mcp_knowledge_edge_id(repo_id: &str, from: &str, to: &str, kind: &str) -> String {
    format!(
        "knowledge-edge-{}",
        cloud_mcp_short_hash(&format!("{repo_id}:{from}:{to}:{kind}"))
    )
}

fn cloud_mcp_normalize_knowledge_relative_path(path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => {
                let value = value.to_string_lossy();
                if value.is_empty() {
                    continue;
                }
                parts.push(value.to_string());
            }
            Component::CurDir => {}
            Component::ParentDir => {
                parts.pop()?;
            }
            _ => return None,
        }
    }
    let normalized = parts.join("/");
    (!normalized.is_empty()).then_some(normalized)
}

fn cloud_mcp_collect_knowledge_note_paths(root: &Path) -> Vec<PathBuf> {
    let knowledge_dir = cloud_mcp_knowledge_dir(root);
    let mut queue = VecDeque::new();
    let mut notes = Vec::new();
    queue.push_back(knowledge_dir.clone());
    while let Some(dir) = queue.pop_front() {
        if notes.len() >= CLOUD_MCP_KNOWLEDGE_NOTE_LIMIT {
            break;
        }
        let Ok(read_dir) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in read_dir.flatten() {
            if notes.len() >= CLOUD_MCP_KNOWLEDGE_NOTE_LIMIT {
                break;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name == ".cache" || file_name.starts_with('.') && file_name != ".keep" {
                continue;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                queue.push_back(path);
            } else if file_type.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
            {
                notes.push(path);
            }
        }
    }
    notes.sort();
    notes
}

fn cloud_mcp_ensure_knowledge_atlas(root: &Path) -> Result<(), String> {
    let knowledge_dir = cloud_mcp_knowledge_dir(root);
    fs::create_dir_all(&knowledge_dir).map_err(|error| {
        format!(
            "Unable to create knowledge atlas directory {}: {error}",
            workspace_path_display(&knowledge_dir)
        )
    })?;
    if cloud_mcp_path_contains_symlink(&knowledge_dir) {
        return Err(format!(
            "Refusing to initialize knowledge atlas through symlinked path {}",
            workspace_path_display(&knowledge_dir)
        ));
    }
    let index_path = cloud_mcp_safe_knowledge_target(&knowledge_dir, Path::new("index.md"))?;
    if !index_path.exists() {
        fs::write(&index_path, "").map_err(|error| {
            format!(
                "Unable to create empty knowledge atlas root {}: {error}",
                workspace_path_display(&index_path)
            )
        })?;
    }
    let cache_dir = cloud_mcp_knowledge_cache_dir(root);
    fs::create_dir_all(&cache_dir).map_err(|error| {
        format!(
            "Unable to create knowledge graph cache directory {}: {error}",
            workspace_path_display(&cache_dir)
        )
    })?;
    if cloud_mcp_path_contains_symlink(&cache_dir) {
        return Err(format!(
            "Refusing to use symlinked knowledge graph cache directory {}",
            workspace_path_display(&cache_dir)
        ));
    }
    Ok(())
}

fn cloud_mcp_markdown_title(markdown: &str, note_path: &str) -> String {
    markdown
        .lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim))
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            note_path
                .rsplit('/')
                .next()
                .unwrap_or(note_path)
                .trim_end_matches(".md")
                .replace(['-', '_'], " ")
        })
}

fn cloud_mcp_markdown_summary(markdown: &str) -> String {
    markdown
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.starts_with('#'))
        .next()
        .unwrap_or("Markdown knowledge note.")
        .trim_start_matches("- ")
        .chars()
        .take(220)
        .collect()
}

fn cloud_mcp_knowledge_node_type(note_path: &str) -> String {
    let lower = note_path.to_ascii_lowercase();
    let node_type = if lower == "index.md" || lower.ends_with("/index.md") {
        "repo_root"
    } else {
        "concept"
    };
    node_type.to_string()
}

fn cloud_mcp_markdown_link_targets(markdown: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let bytes = markdown.as_bytes();
    let mut index = 0usize;
    while index + 1 < bytes.len() {
        if bytes[index] == b']' && bytes[index + 1] == b'(' {
            let start = index + 2;
            let mut end = start;
            while end < bytes.len() && bytes[end] != b')' {
                end += 1;
            }
            if end < bytes.len() {
                if let Some(target) = markdown.get(start..end) {
                    targets.push(target.trim().to_string());
                }
            }
            index = end.saturating_add(1);
        } else if bytes[index] == b'[' && bytes[index + 1] == b'[' {
            let start = index + 2;
            let mut end = start;
            while end + 1 < bytes.len() && !(bytes[end] == b']' && bytes[end + 1] == b']') {
                end += 1;
            }
            if end + 1 < bytes.len() {
                if let Some(target) = markdown.get(start..end) {
                    targets.push(target.trim().to_string());
                }
            }
            index = end.saturating_add(2);
        } else {
            index += 1;
        }
    }
    targets
        .into_iter()
        .map(|target| {
            target
                .split(['#', '?'])
                .next()
                .unwrap_or("")
                .trim()
                .to_string()
        })
        .filter(|target| !target.is_empty())
        .filter(|target| {
            let lower = target.to_ascii_lowercase();
            !lower.starts_with("http://")
                && !lower.starts_with("https://")
                && !lower.starts_with("mailto:")
        })
        .collect()
}

fn cloud_mcp_markdown_code_spans(markdown: &str) -> Vec<String> {
    let mut spans = Vec::new();
    let bytes = markdown.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] != b'`' {
            index += 1;
            continue;
        }
        let start = index + 1;
        let mut end = start;
        while end < bytes.len() && bytes[end] != b'`' {
            end += 1;
        }
        if end < bytes.len() {
            if let Some(span) = markdown.get(start..end) {
                spans.push(span.trim().to_string());
            }
        }
        index = end.saturating_add(1);
    }
    spans
}

fn cloud_mcp_resolve_knowledge_note_link(current_note: &str, target: &str) -> Option<String> {
    if target.is_empty() || target.starts_with('#') {
        return None;
    }
    let target = target.trim().trim_matches('/');
    let target = if target.ends_with(".md") {
        target.to_string()
    } else {
        format!("{target}.md")
    };
    let base = Path::new(current_note)
        .parent()
        .unwrap_or_else(|| Path::new(""));
    let joined = if target.starts_with('/') {
        PathBuf::from(target.trim_start_matches('/'))
    } else {
        base.join(target)
    };
    cloud_mcp_normalize_knowledge_relative_path(&joined)
}

fn cloud_mcp_knowledge_path_ref_candidate(value: &str) -> Option<String> {
    let value = value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim_matches('`')
        .replace('\\', "/");
    if value.is_empty()
        || value.starts_with('#')
        || value.starts_with("http://")
        || value.starts_with("https://")
        || value.starts_with("mailto:")
        || value.starts_with("data:")
        || value.starts_with("javascript:")
    {
        return None;
    }
    if value.ends_with(".md") && !value.contains('/') {
        return None;
    }
    let looks_like_path = value.contains('/')
        || value.starts_with("./")
        || value.starts_with(".agents/")
        || value.contains('.')
            && !value.contains(' ')
            && value
                .rsplit('.')
                .next()
                .is_some_and(|ext| (1..=8).contains(&ext.len()));
    if !looks_like_path {
        return None;
    }
    cloud_mcp_normalized_git_path(value.trim_start_matches("./").as_bytes())
}

fn cloud_mcp_collect_knowledge_path_refs(
    root: &Path,
    markdown: &str,
    note_links: &HashSet<String>,
) -> Vec<CloudMcpKnowledgePathRef> {
    let mut candidates = Vec::new();
    for target in cloud_mcp_markdown_link_targets(markdown) {
        if let Some(candidate) = cloud_mcp_knowledge_path_ref_candidate(&target) {
            candidates.push(candidate);
        }
    }
    for span in cloud_mcp_markdown_code_spans(markdown) {
        if let Some(candidate) = cloud_mcp_knowledge_path_ref_candidate(&span) {
            candidates.push(candidate);
        }
    }
    candidates.sort();
    candidates.dedup();
    candidates
        .into_iter()
        .filter(|candidate| !note_links.contains(candidate))
        .take(120)
        .map(|path| {
            let absolute = root.join(&path);
            let metadata = fs::metadata(&absolute).ok();
            let exists = metadata.is_some();
            let kind = metadata
                .as_ref()
                .map(|metadata| {
                    if metadata.is_dir() {
                        "folder"
                    } else if metadata.is_file() {
                        "file"
                    } else {
                        "path"
                    }
                })
                .unwrap_or("missing")
                .to_string();
            let size = metadata
                .as_ref()
                .filter(|metadata| metadata.is_file())
                .map(fs::Metadata::len);
            let modified_ms = metadata.as_ref().and_then(cloud_mcp_modified_ms);
            CloudMcpKnowledgePathRef {
                path,
                kind,
                exists,
                size,
                modified_ms,
            }
        })
        .collect()
}

fn cloud_mcp_read_knowledge_notes(
    root: &Path,
    repo_id: &str,
) -> Result<Vec<CloudMcpKnowledgeNote>, String> {
    cloud_mcp_ensure_knowledge_atlas(root)?;
    let knowledge_dir = cloud_mcp_knowledge_dir(root);
    let note_paths = cloud_mcp_collect_knowledge_note_paths(root);
    let known_note_paths = note_paths
        .iter()
        .filter_map(|path| {
            path.strip_prefix(&knowledge_dir)
                .ok()
                .and_then(cloud_mcp_normalize_knowledge_relative_path)
        })
        .collect::<HashSet<_>>();
    let mut notes = Vec::new();
    for path in note_paths {
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > CLOUD_MCP_KNOWLEDGE_MAX_NOTE_BYTES {
            continue;
        }
        let Some(note_path) = path
            .strip_prefix(&knowledge_dir)
            .ok()
            .and_then(cloud_mcp_normalize_knowledge_relative_path)
        else {
            continue;
        };
        let markdown = fs::read_to_string(&path).map_err(|error| {
            format!(
                "Unable to read knowledge note {}: {error}",
                workspace_path_display(&path)
            )
        })?;
        let note_links = cloud_mcp_markdown_link_targets(&markdown)
            .into_iter()
            .filter_map(|target| cloud_mcp_resolve_knowledge_note_link(&note_path, &target))
            .filter(|target| known_note_paths.contains(target))
            .collect::<HashSet<_>>();
        let outbound_links = note_links
            .iter()
            .map(|target| {
                json!({
                    "target_path": target,
                    "target_id": cloud_mcp_knowledge_note_id(repo_id, target),
                    "kind": "links_to",
                })
            })
            .collect::<Vec<_>>();
        let path_refs = cloud_mcp_collect_knowledge_path_refs(root, &markdown, &note_links);
        let blank_root_note = note_path == "index.md" && markdown.trim().is_empty();
        notes.push(CloudMcpKnowledgeNote {
            id: cloud_mcp_knowledge_note_id(repo_id, &note_path),
            note_path: note_path.clone(),
            node_type: cloud_mcp_knowledge_node_type(&note_path),
            title: if blank_root_note {
                "index.md".to_string()
            } else {
                cloud_mcp_markdown_title(&markdown, &note_path)
            },
            summary: if blank_root_note {
                "".to_string()
            } else {
                cloud_mcp_markdown_summary(&markdown)
            },
            markdown,
            path_refs,
            outbound_links,
            source: "rust-diffforge-knowledge".to_string(),
            metadata: json!({
                "source": "markdown",
                "atlas_dir": ".agents/knowledge",
                "note_path": note_path,
                "modified_ms": cloud_mcp_modified_ms(&metadata),
            }),
        });
    }
    notes.sort_by(|left, right| {
        (left.node_type != "repo_root")
            .cmp(&(right.node_type != "repo_root"))
            .then_with(|| left.note_path.cmp(&right.note_path))
    });
    Ok(notes)
}

fn cloud_mcp_build_knowledge_edges(repo_id: &str, notes: &[CloudMcpKnowledgeNote]) -> Vec<Value> {
    let mut edges = Vec::new();
    let mut seen = HashSet::new();
    let note_by_path = notes
        .iter()
        .map(|note| (note.note_path.clone(), note.id.clone()))
        .collect::<HashMap<_, _>>();
    for note in notes {
        for link in &note.outbound_links {
            let Some(target_id) = link.get("target_id").and_then(Value::as_str) else {
                continue;
            };
            let kind = "links_to";
            let id = cloud_mcp_knowledge_edge_id(repo_id, &note.id, target_id, kind);
            if seen.insert(id.clone()) {
                edges.push(json!({
                    "id": id,
                    "from_note_id": note.id,
                    "to_note_id": target_id,
                    "edge_kind": kind,
                    "metadata": {
                        "source": "markdown_link",
                        "target_path": link.get("target_path").cloned().unwrap_or(Value::Null),
                    },
                }));
            }
        }
    }
    let root_id = note_by_path.get("index.md").cloned();
    for note in notes {
        if note.note_path == "index.md" {
            continue;
        }
        let parent_path = Path::new(&note.note_path)
            .parent()
            .and_then(cloud_mcp_normalize_knowledge_relative_path);
        let parent_id = parent_path
            .as_deref()
            .and_then(|parent| note_by_path.get(&format!("{parent}.md")).cloned())
            .or_else(|| {
                parent_path
                    .as_deref()
                    .and_then(|parent| note_by_path.get(&format!("{parent}/index.md")).cloned())
            })
            .or_else(|| root_id.clone());
        let Some(parent_id) = parent_id else {
            continue;
        };
        if parent_id == note.id {
            continue;
        }
        let kind = "contains";
        let id = cloud_mcp_knowledge_edge_id(repo_id, &parent_id, &note.id, kind);
        if seen.insert(id.clone()) {
            edges.push(json!({
                "id": id,
                "from_note_id": parent_id,
                "to_note_id": note.id,
                "edge_kind": kind,
                "metadata": {
                    "source": "atlas_hierarchy",
                    "target_path": note.note_path,
                },
            }));
        }
    }
    edges
}

fn cloud_mcp_knowledge_graph_stats(notes: &[Value], edges: &[Value]) -> Value {
    let missing_paths: usize = notes
        .iter()
        .map(|node| node["missing_path_count"].as_u64().unwrap_or(0) as usize)
        .sum();
    json!({
        "notes": notes.len(),
        "edges": edges.len(),
        "missing_paths": missing_paths,
        "root_notes": notes.iter().filter(|node| node["node_type"].as_str() == Some("repo_root")).count(),
        "concept_notes": notes.iter().filter(|node| node["node_type"].as_str() == Some("concept")).count(),
    })
}

fn cloud_mcp_knowledge_hashes(items: &[Value]) -> Value {
    let mut map = serde_json::Map::new();
    for item in items {
        if let Some(id) = item.get("id").and_then(Value::as_str) {
            map.insert(
                id.to_string(),
                json!(cloud_mcp_short_hash(&item.to_string())),
            );
        }
    }
    Value::Object(map)
}

fn cloud_mcp_programmatic_knowledge_root_node(req: &CloudMcpSpecGraphSyncRequest) -> Value {
    json!({
        "id": cloud_mcp_knowledge_note_id(&req.repo_id, "index.md"),
        "repo_id": req.repo_id.clone(),
        "workspace_id": req.workspace_id.clone(),
        "node_key": "repo_root",
        "node_type": "repo_root",
        "title": "index.md",
        "summary": "",
        "purpose": "",
        "note_path": "index.md",
        "markdown_path": "index.md",
        "markdown": "",
        "path_refs": [],
        "path_ref_count": 0,
        "missing_path_count": 0,
        "outbound_links": [],
        "freshness_state": "no_spec",
        "knowledge_state": "no_spec",
        "source": "rust-diffforge-programmatic-index-root",
        "metadata": {
            "source": "index_md_root",
            "atlas_dir": ".agents/knowledge",
            "markdown_mirror_path": ".agents/knowledge/index.md",
        },
    })
}

fn cloud_mcp_build_local_knowledge_graph_data(
    req: &CloudMcpSpecGraphSyncRequest,
) -> Result<Value, String> {
    let notes = cloud_mcp_read_knowledge_notes(&req.root, &req.repo_id)?;
    let edges = cloud_mcp_build_knowledge_edges(&req.repo_id, &notes);
    let nodes = notes
        .into_iter()
        .map(|note| {
            let path_refs = note
                .path_refs
                .iter()
                .map(|path_ref| serde_json::to_value(path_ref).unwrap_or_else(|_| json!({})))
                .collect::<Vec<_>>();
            let missing_path_count = path_refs
                .iter()
                .filter(|path_ref| path_ref["exists"].as_bool() == Some(false))
                .count();
            json!({
                "id": note.id,
                "repo_id": req.repo_id,
                "workspace_id": req.workspace_id,
                "node_key": cloud_mcp_knowledge_node_key(&note.note_path),
                "node_type": note.node_type,
                "title": note.title,
                "summary": note.summary,
                "purpose": note.summary,
                "note_path": note.note_path,
                "markdown_path": note.note_path,
                "markdown": note.markdown,
                "path_refs": path_refs,
                "path_ref_count": path_refs.len(),
                "missing_path_count": missing_path_count,
                "outbound_links": note.outbound_links,
                "freshness_state": if note.note_path == "index.md" && note.markdown.trim().is_empty() {
                    "no_spec"
                } else if missing_path_count > 0 {
                    "missing_path"
                } else {
                    "fresh"
                },
                "knowledge_state": if note.note_path == "index.md" && note.markdown.trim().is_empty() {
                    "no_spec"
                } else if missing_path_count > 0 {
                    "missing_path"
                } else {
                    "fresh"
                },
                "source": note.source,
                "metadata": note.metadata,
            })
        })
        .collect::<Vec<_>>();
    let graph_stats = cloud_mcp_knowledge_graph_stats(&nodes, &edges);
    let cursor = cloud_mcp_short_hash(&json!({"nodes": nodes, "edges": edges}).to_string());
    Ok(json!({
        "kind": "project_knowledge_graph",
        "version": 1,
        "repo_id": req.repo_id.clone(),
        "workspace_id": req.workspace_id.clone(),
        "nodes": nodes,
        "edges": edges,
        "graph_stats": graph_stats,
        "cursor": cursor,
        "node_hashes": cloud_mcp_knowledge_hashes(&nodes),
        "edge_hashes": cloud_mcp_knowledge_hashes(&edges),
        "graph_stats_hash": cloud_mcp_short_hash(&graph_stats.to_string()),
        "source_of_truth": {
            "kind": "server_markdown_mirror_cache",
            "directory": ".agents/knowledge",
            "local_first": false,
            "read_only_mirror": true,
            "spec_edges_encoded": false,
        },
    }))
}

fn cloud_mcp_knowledge_graph_empty_raw(req: &CloudMcpSpecGraphSyncRequest) -> Value {
    let nodes = vec![cloud_mcp_programmatic_knowledge_root_node(req)];
    let edges: Vec<Value> = Vec::new();
    json!({
        "kind": "project_knowledge_graph",
        "version": 1,
        "repo_id": req.repo_id.clone(),
        "workspace_id": req.workspace_id.clone(),
        "nodes": nodes,
        "edges": edges,
        "graph_stats": {},
    })
}

fn cloud_mcp_knowledge_graph_snapshot_from_data(
    req: &CloudMcpSpecGraphSyncRequest,
    data: Value,
    cache_path: &Path,
    sync_state: &str,
    sync_error: &str,
) -> Value {
    let repo_name = cloud_mcp_repo_display_name(&req.root);
    let display_root = cloud_mcp_repo_display_root(&req.root);
    let nodes = data
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let edges = data
        .get("edges")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let nodes = Value::Array(nodes);
    let edges = Value::Array(edges);
    let mut normalized_data = data.clone();
    if let Some(object) = normalized_data.as_object_mut() {
        object.insert("nodes".to_string(), nodes.clone());
        object.insert("edges".to_string(), edges.clone());
    }
    let graph_stats = data
        .get("graph_stats")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let cursor = data
        .get("cursor")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            cloud_mcp_short_hash(&json!({"nodes": nodes, "edges": edges}).to_string())
        });
    let node_hashes = data.get("node_hashes").cloned().unwrap_or_else(|| {
        cloud_mcp_knowledge_hashes(nodes.as_array().map(Vec::as_slice).unwrap_or(&[]))
    });
    let edge_hashes = data.get("edge_hashes").cloned().unwrap_or_else(|| {
        cloud_mcp_knowledge_hashes(edges.as_array().map(Vec::as_slice).unwrap_or(&[]))
    });
    let graph_stats_hash = data
        .get("graph_stats_hash")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| cloud_mcp_short_hash(&graph_stats.to_string()));
    json!({
        "ok": true,
        "repoId": req.repo_id.clone(),
        "repoPath": req.root_display.clone(),
        "repoName": repo_name.clone(),
        "displayRoot": display_root.clone(),
        "workspaceDisplay": {
            "repoName": repo_name,
            "displayRoot": display_root,
            "repoPath": req.root_display.clone(),
        },
        "workspaceId": req.workspace_id.clone(),
        "workspaceName": req.workspace_name.clone(),
        "cachePath": workspace_path_display(cache_path),
        "syncState": sync_state,
        "syncError": sync_error,
        "lastSyncedMs": cloud_mcp_now_ms(),
        "cursor": cursor,
        "nodeHashes": node_hashes,
        "edgeHashes": edge_hashes,
        "graphStatsHash": graph_stats_hash,
        "knowledgeGraph": normalized_data.clone(),
        "knowledgeNodes": nodes,
        "knowledgeEdges": edges,
        "graphStats": graph_stats,
        "sourceOfTruth": {
            "kind": "server_authored_knowledge_graph",
            "repo_id": req.repo_id.clone(),
            "markdown_directory": ".agents/knowledge",
            "client_mode": "read_only_markdown_sync",
            "cached_under_agents": true,
        },
        "raw": normalized_data
    })
}

fn cloud_mcp_stamp_knowledge_graph_snapshot(
    mut snapshot: Value,
    req: &CloudMcpSpecGraphSyncRequest,
    cache_path: &Path,
    sync_state: &str,
    sync_error: &str,
) -> Value {
    if !snapshot.is_object() {
        snapshot = cloud_mcp_knowledge_graph_snapshot_from_data(
            req,
            cloud_mcp_knowledge_graph_empty_raw(req),
            cache_path,
            sync_state,
            sync_error,
        );
    }
    if let Some(object) = snapshot.as_object_mut() {
        let repo_name = cloud_mcp_repo_display_name(&req.root);
        let display_root = cloud_mcp_repo_display_root(&req.root);
        object.insert("ok".to_string(), json!(true));
        object.insert("repoId".to_string(), json!(req.repo_id.clone()));
        object.insert("repoPath".to_string(), json!(req.root_display.clone()));
        object.insert("repoName".to_string(), json!(repo_name.clone()));
        object.insert("displayRoot".to_string(), json!(display_root.clone()));
        object.insert(
            "workspaceDisplay".to_string(),
            json!({
                "repoName": repo_name,
                "displayRoot": display_root,
                "repoPath": req.root_display.clone(),
            }),
        );
        object.insert("workspaceId".to_string(), json!(req.workspace_id.clone()));
        object.insert(
            "workspaceName".to_string(),
            json!(req.workspace_name.clone()),
        );
        object.insert(
            "cachePath".to_string(),
            json!(workspace_path_display(cache_path)),
        );
        object.insert("syncState".to_string(), json!(sync_state));
        object.insert("syncError".to_string(), json!(sync_error));
        object.insert(
            "sourceOfTruth".to_string(),
            json!({
                "kind": "server_authored_knowledge_graph",
                "repo_id": req.repo_id.clone(),
                "markdown_directory": ".agents/knowledge",
                "client_mode": "read_only_markdown_sync",
                "cached_under_agents": true,
            }),
        );
    }
    snapshot
}

fn cloud_mcp_read_knowledge_graph_cache(
    req: &CloudMcpSpecGraphSyncRequest,
    sync_state: &str,
    sync_error: &str,
) -> Value {
    let cache_path = cloud_mcp_knowledge_graph_cache_path(&req.root, &req.repo_id);
    let snapshot = fs::read_to_string(&cache_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| {
            cloud_mcp_build_local_knowledge_graph_data(req)
                .map(|data| {
                    cloud_mcp_knowledge_graph_snapshot_from_data(
                        req,
                        data,
                        &cache_path,
                        "local",
                        "",
                    )
                })
                .unwrap_or_else(|_| {
                    cloud_mcp_knowledge_graph_snapshot_from_data(
                        req,
                        cloud_mcp_knowledge_graph_empty_raw(req),
                        &cache_path,
                        "empty",
                        "",
                    )
                })
        });
    cloud_mcp_stamp_knowledge_graph_snapshot(snapshot, req, &cache_path, sync_state, sync_error)
}

fn cloud_mcp_read_knowledge_graph_cache_preserving_state(
    req: &CloudMcpSpecGraphSyncRequest,
    fallback_sync_state: &str,
    fallback_sync_error: &str,
) -> Value {
    let cache_path = cloud_mcp_knowledge_graph_cache_path(&req.root, &req.repo_id);
    let Some(snapshot) = fs::read_to_string(&cache_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
    else {
        return cloud_mcp_read_knowledge_graph_cache(req, fallback_sync_state, fallback_sync_error);
    };

    let sync_state = snapshot
        .get("syncState")
        .or_else(|| snapshot.get("sync_state"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback_sync_state)
        .to_string();
    let sync_error = snapshot
        .get("syncError")
        .or_else(|| snapshot.get("sync_error"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback_sync_error)
        .to_string();

    cloud_mcp_stamp_knowledge_graph_snapshot(snapshot, req, &cache_path, &sync_state, &sync_error)
}

fn cloud_mcp_write_knowledge_graph_cache(
    req: &CloudMcpSpecGraphSyncRequest,
    snapshot: &Value,
) -> Result<(), String> {
    let cache_path = cloud_mcp_knowledge_graph_cache_path(&req.root, &req.repo_id);
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Unable to create Knowledge Graph cache directory {}: {error}",
                workspace_path_display(parent)
            )
        })?;
    }
    let body = serde_json::to_vec_pretty(snapshot)
        .map_err(|error| format!("Unable to encode Knowledge Graph cache: {error}"))?;
    fs::write(&cache_path, body).map_err(|error| {
        format!(
            "Unable to write Knowledge Graph cache {}: {error}",
            workspace_path_display(&cache_path)
        )
    })
}

async fn cloud_mcp_fetch_full_knowledge_graph_data(
    state: &CloudMcpState,
    req: &CloudMcpSpecGraphSyncRequest,
) -> Result<Value, String> {
    cloud_mcp_connected_or_connect(state).await?;
    let repo_name = cloud_mcp_repo_display_name(&req.root);
    let display_root = cloud_mcp_repo_display_root(&req.root);
    let payload = json!({
        "source": "rust-diffforge-knowledge-graph",
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "repo_id": req.repo_id.clone(),
        "repo_name": repo_name,
        "display_root": display_root,
        "agent_id": "rust-diffforge",
        "self_agent_id": "rust-diffforge",
        "current_agent_id": "rust-diffforge",
        "repo_path": req.root_display.clone(),
        "workspace_root": req.root_display.clone(),
        "workspace_id": req.workspace_id.clone(),
        "workspace_name": req.workspace_name.clone(),
        "ts_ms": cloud_mcp_now_ms(),
    });
    let response = cloud_mcp_post_json_endpoint(state, "/v1/knowledge/graph", &payload).await?;
    Ok(cloud_mcp_response_data(&response))
}

async fn cloud_mcp_sync_knowledge_graph_once(
    state: &CloudMcpState,
    req: &CloudMcpSpecGraphSyncRequest,
) -> Result<(Value, bool), String> {
    let cache_path = cloud_mcp_knowledge_graph_cache_path(&req.root, &req.repo_id);
    let current_cache = cloud_mcp_read_knowledge_graph_cache(req, "syncing", "");
    cloud_mcp_write_knowledge_graph_cache(req, &current_cache)?;

    let next_snapshot = match cloud_mcp_connected_or_connect(state).await {
        Ok(_) => {
            let data = cloud_mcp_fetch_full_knowledge_graph_data(state, req).await?;
            let mirror_sync = cloud_mcp_materialize_knowledge_graph_mirror(&req.root, &data);
            let mut snapshot =
                cloud_mcp_knowledge_graph_snapshot_from_data(req, data, &cache_path, "ready", "");
            if let Some(object) = snapshot.as_object_mut() {
                object.insert("mirrorSync".to_string(), mirror_sync);
            }
            snapshot
        }
        Err(error) => {
            let mut snapshot = current_cache.clone();
            if let Some(object) = snapshot.as_object_mut() {
                object.insert("syncState".to_string(), json!("local"));
                object.insert(
                    "syncError".to_string(),
                    json!(clean_terminal_telemetry_text(&error)),
                );
            }
            snapshot
        }
    };
    let changed = current_cache.get("cursor").and_then(Value::as_str)
        != next_snapshot.get("cursor").and_then(Value::as_str)
        || current_cache.get("syncState").and_then(Value::as_str) == Some("error");
    cloud_mcp_write_knowledge_graph_cache(req, &next_snapshot)?;
    Ok((next_snapshot, changed))
}

fn cloud_mcp_emit_knowledge_graph_snapshot(app: &AppHandle, snapshot: Value) {
    let _ = app.emit(CLOUD_MCP_KNOWLEDGE_GRAPH_CACHE_EVENT, snapshot);
}

fn cloud_mcp_knowledge_cache_path_is_inside(root: &Path, path: &Path) -> bool {
    let cache_dir = cloud_mcp_knowledge_cache_dir(root);
    path.starts_with(cache_dir)
}

fn cloud_mcp_knowledge_event_should_sync(root: &Path, event: &NotifyEvent) -> bool {
    match event.kind {
        NotifyEventKind::Any
        | NotifyEventKind::Create(_)
        | NotifyEventKind::Modify(_)
        | NotifyEventKind::Remove(_) => {}
        _ => return false,
    }
    event
        .paths
        .iter()
        .any(|path| !cloud_mcp_knowledge_cache_path_is_inside(root, path))
}

fn cloud_mcp_filetree_path_is_scan_relevant(root: &Path, path: &Path) -> bool {
    let Ok(relative_path) = path.strip_prefix(root) else {
        return false;
    };
    !relative_path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(cloud_mcp_skip_filetree_name)
    })
}

fn cloud_mcp_filetree_event_should_sync(root: &Path, event: &NotifyEvent) -> bool {
    match event.kind {
        NotifyEventKind::Any
        | NotifyEventKind::Create(_)
        | NotifyEventKind::Modify(_)
        | NotifyEventKind::Remove(_) => {}
        _ => return false,
    }
    event
        .paths
        .iter()
        .any(|path| cloud_mcp_filetree_path_is_scan_relevant(root, path))
}

fn cloud_mcp_knowledge_event_action(event: &NotifyEvent) -> &'static str {
    match event.kind {
        NotifyEventKind::Create(_) => "added",
        NotifyEventKind::Modify(_) => "updated",
        NotifyEventKind::Remove(_) => "deleted",
        _ => "changed",
    }
}

fn cloud_mcp_knowledge_note_changes_from_event(root: &Path, event: &NotifyEvent) -> Vec<Value> {
    let knowledge_dir = cloud_mcp_knowledge_dir(root);
    let action = cloud_mcp_knowledge_event_action(event);
    let mut seen = HashSet::new();
    let mut changes = Vec::new();
    for path in &event.paths {
        if cloud_mcp_knowledge_cache_path_is_inside(root, path) {
            continue;
        }
        let Some(relative_path) = path
            .strip_prefix(&knowledge_dir)
            .ok()
            .and_then(cloud_mcp_normalize_knowledge_relative_path)
        else {
            continue;
        };
        if !relative_path.ends_with(".md") || !seen.insert((relative_path.clone(), action)) {
            continue;
        }
        changes.push(json!({
            "path": relative_path,
            "action": action,
            "absolute_path": workspace_path_display(path),
        }));
    }
    changes
}

fn cloud_mcp_merge_knowledge_note_changes(changes: &mut Vec<Value>, next: Vec<Value>) {
    let mut seen = changes
        .iter()
        .filter_map(|change| {
            let path = change.get("path").and_then(Value::as_str)?;
            let action = change
                .get("action")
                .and_then(Value::as_str)
                .unwrap_or("changed");
            Some(format!("{path}:{action}"))
        })
        .collect::<HashSet<_>>();
    for change in next {
        let Some(path) = change.get("path").and_then(Value::as_str) else {
            continue;
        };
        let action = change
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or("changed");
        if seen.insert(format!("{path}:{action}")) {
            changes.push(change);
        }
    }
}

async fn cloud_mcp_push_knowledge_atlas_file_invalidation(
    state: &CloudMcpState,
    req: &CloudMcpSpecGraphSyncRequest,
    note_changes: Vec<Value>,
) {
    if note_changes.is_empty() {
        return;
    }
    let changed_files = note_changes
        .iter()
        .filter_map(|change| change.get("path").and_then(Value::as_str))
        .map(|path| format!(".agents/knowledge/{path}"))
        .collect::<Vec<_>>();
    let payload = json!({
        "source": "rust-diffforge-knowledge-watcher",
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "repo_id": req.repo_id.clone(),
        "repo_path": req.root_display.clone(),
        "workspace_root": req.root_display.clone(),
        "workspace_id": req.workspace_id.clone(),
        "workspace_name": req.workspace_name.clone(),
        "agent_id": "rust-diffforge",
        "self_agent_id": "rust-diffforge",
        "current_agent_id": "rust-diffforge",
        "changed_files": changed_files.clone(),
        "markdown_files": changed_files.clone(),
        "knowledge_files": changed_files,
        "note_changes": note_changes,
        "ts_ms": cloud_mcp_now_ms(),
    });
    let _ = cloud_mcp_post_event_endpoint(state, "knowledge_atlas_files_changed", &payload).await;
}

fn cloud_mcp_existing_watch_parent(path: &Path) -> Option<PathBuf> {
    let mut current = path.parent();
    while let Some(parent) = current {
        if parent.exists() && parent.is_dir() {
            return Some(parent.to_path_buf());
        }
        current = parent.parent();
    }
    None
}

fn cloud_mcp_knowledge_watch_targets(
    req: &CloudMcpSpecGraphSyncRequest,
    snapshot: &Value,
) -> HashMap<PathBuf, bool> {
    let mut targets = HashMap::new();
    let mut insert_target = |path: PathBuf, recursive: bool| {
        let path = workspace_path_for_process(&path);
        targets
            .entry(path)
            .and_modify(|existing| *existing = *existing || recursive)
            .or_insert(recursive);
    };
    insert_target(cloud_mcp_knowledge_dir(&req.root), true);

    let nodes = snapshot
        .get("knowledgeNodes")
        .or_else(|| snapshot.get("raw").and_then(|raw| raw.get("nodes")))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for node in nodes {
        let path_refs = node
            .get("path_refs")
            .or_else(|| node.get("pathRefs"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for path_ref in path_refs {
            let Some(relative_path) = path_ref.get("path").and_then(Value::as_str) else {
                continue;
            };
            let absolute = req.root.join(relative_path);
            if absolute.exists() {
                insert_target(absolute.clone(), absolute.is_dir());
            } else if let Some(parent) = cloud_mcp_existing_watch_parent(&absolute) {
                insert_target(parent, false);
            }
        }
    }
    targets
}

fn cloud_mcp_reconfigure_knowledge_watcher(
    watcher: &mut RecommendedWatcher,
    watched: &mut HashMap<PathBuf, bool>,
    desired: HashMap<PathBuf, bool>,
) {
    let stale_paths = watched
        .keys()
        .filter(|path| !desired.contains_key(*path))
        .cloned()
        .collect::<Vec<_>>();
    for path in stale_paths {
        let _ = watcher.unwatch(&path);
        watched.remove(&path);
    }

    for (path, recursive) in desired {
        if watched.get(&path).copied() == Some(recursive) {
            continue;
        }
        if watched.contains_key(&path) {
            let _ = watcher.unwatch(&path);
            watched.remove(&path);
        }
        let mode = if recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        if watcher.watch(&path, mode).is_ok() {
            watched.insert(path, recursive);
        }
    }
}

async fn cloud_mcp_sync_knowledge_graph_and_rewatch(
    app: &AppHandle,
    state: &CloudMcpState,
    req: &CloudMcpSpecGraphSyncRequest,
    watcher: &mut RecommendedWatcher,
    watched: &mut HashMap<PathBuf, bool>,
    emit_even_if_unchanged: bool,
) {
    match cloud_mcp_sync_knowledge_graph_once(state, req).await {
        Ok((snapshot, changed)) => {
            let desired = cloud_mcp_knowledge_watch_targets(req, &snapshot);
            cloud_mcp_reconfigure_knowledge_watcher(watcher, watched, desired);
            if emit_even_if_unchanged || changed {
                cloud_mcp_emit_knowledge_graph_snapshot(app, snapshot);
            }
        }
        Err(error) => {
            let snapshot = cloud_mcp_read_knowledge_graph_cache(
                req,
                "error",
                &clean_terminal_telemetry_text(&error),
            );
            let desired = cloud_mcp_knowledge_watch_targets(req, &snapshot);
            cloud_mcp_reconfigure_knowledge_watcher(watcher, watched, desired);
            let _ = cloud_mcp_write_knowledge_graph_cache(req, &snapshot);
            cloud_mcp_emit_knowledge_graph_snapshot(app, snapshot);
        }
    }
}

enum CloudMcpKnowledgeGraphSyncSignal {
    File(Result<NotifyEvent, notify::Error>),
    Server(Result<Value, String>),
}

async fn cloud_mcp_knowledge_graph_watch_loop(
    app: AppHandle,
    state: CloudMcpState,
    req: CloudMcpSpecGraphSyncRequest,
    generation: u64,
    stop: Arc<AtomicBool>,
    wake: Arc<tokio::sync::Notify>,
) {
    let (event_tx, mut event_rx) =
        tokio::sync::mpsc::channel::<Result<NotifyEvent, notify::Error>>(256);
    let (server_event_tx, mut server_event_rx) =
        tokio::sync::mpsc::channel::<Result<Value, String>>(256);
    tauri::async_runtime::spawn(cloud_mcp_graph_ws_event_forward_loop(
        state.clone(),
        req.clone(),
        Arc::clone(&stop),
        Arc::clone(&wake),
        server_event_tx,
    ));
    let mut watcher = match RecommendedWatcher::new(
        move |event| {
            let _ = event_tx.blocking_send(event);
        },
        NotifyConfig::default(),
    ) {
        Ok(watcher) => watcher,
        Err(error) => {
            let snapshot = cloud_mcp_read_knowledge_graph_cache(
                &req,
                "error",
                &format!("Unable to start Knowledge Graph file watcher: {error}"),
            );
            cloud_mcp_emit_knowledge_graph_snapshot(&app, snapshot);
            let mut syncs = state.knowledge_graph_syncs.lock().await;
            let should_remove = syncs
                .get(&req.repo_id)
                .map(|runtime| runtime.generation == generation)
                .unwrap_or(false);
            if should_remove {
                syncs.remove(&req.repo_id);
            }
            return;
        }
    };
    let mut watched = HashMap::new();
    let initial_snapshot = cloud_mcp_read_knowledge_graph_cache(&req, "syncing", "");
    cloud_mcp_reconfigure_knowledge_watcher(
        &mut watcher,
        &mut watched,
        cloud_mcp_knowledge_watch_targets(&req, &initial_snapshot),
    );
    cloud_mcp_sync_knowledge_graph_and_rewatch(
        &app,
        &state,
        &req,
        &mut watcher,
        &mut watched,
        true,
    )
    .await;

    while !crate::app_shutdown_requested() {
        let wake_signal = wake.notified();
        tokio::pin!(wake_signal);
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let still_active = {
            let syncs = state.knowledge_graph_syncs.lock().await;
            syncs
                .get(&req.repo_id)
                .map(|runtime| {
                    runtime.generation == generation && !runtime.stop.load(Ordering::SeqCst)
                })
                .unwrap_or(false)
        };
        if !still_active {
            break;
        }

        let signal = tokio::select! {
            _ = &mut wake_signal => break,
            event_result = event_rx.recv() => event_result.map(CloudMcpKnowledgeGraphSyncSignal::File),
            server_event = server_event_rx.recv() => server_event.map(CloudMcpKnowledgeGraphSyncSignal::Server),
        };
        let Some(signal) = signal else {
            break;
        };
        match signal {
            CloudMcpKnowledgeGraphSyncSignal::Server(Ok(_)) => {
                while matches!(server_event_rx.try_recv(), Ok(Ok(_))) {}
                cloud_mcp_sync_knowledge_graph_and_rewatch(
                    &app,
                    &state,
                    &req,
                    &mut watcher,
                    &mut watched,
                    false,
                )
                .await;
            }
            CloudMcpKnowledgeGraphSyncSignal::Server(Err(error)) => {
                let snapshot = cloud_mcp_read_knowledge_graph_cache(
                    &req,
                    "error",
                    &clean_terminal_telemetry_text(&error),
                );
                let _ = cloud_mcp_write_knowledge_graph_cache(&req, &snapshot);
                cloud_mcp_emit_knowledge_graph_snapshot(&app, snapshot);
                break;
            }
            CloudMcpKnowledgeGraphSyncSignal::File(Ok(event))
                if cloud_mcp_knowledge_event_should_sync(&req.root, &event) =>
            {
                let mut note_changes =
                    cloud_mcp_knowledge_note_changes_from_event(&req.root, &event);
                let debounce_wake_signal = wake.notified();
                tokio::pin!(debounce_wake_signal);
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                tokio::select! {
                    _ = sleep(Duration::from_millis(CLOUD_MCP_KNOWLEDGE_GRAPH_DEBOUNCE_MS)) => {}
                    _ = &mut debounce_wake_signal => break,
                }
                while let Ok(next_event_result) = event_rx.try_recv() {
                    match next_event_result {
                        Ok(next_event) => {
                            cloud_mcp_merge_knowledge_note_changes(
                                &mut note_changes,
                                cloud_mcp_knowledge_note_changes_from_event(&req.root, &next_event),
                            );
                            let _ = cloud_mcp_knowledge_event_should_sync(&req.root, &next_event);
                        }
                        Err(error) => {
                            let snapshot = cloud_mcp_read_knowledge_graph_cache(
                                &req,
                                "error",
                                &format!("Knowledge Graph file watcher failed: {error}"),
                            );
                            cloud_mcp_emit_knowledge_graph_snapshot(&app, snapshot);
                        }
                    }
                }
                cloud_mcp_push_knowledge_atlas_file_invalidation(&state, &req, note_changes).await;
                cloud_mcp_sync_knowledge_graph_and_rewatch(
                    &app,
                    &state,
                    &req,
                    &mut watcher,
                    &mut watched,
                    false,
                )
                .await;
            }
            CloudMcpKnowledgeGraphSyncSignal::File(Ok(_)) => {}
            CloudMcpKnowledgeGraphSyncSignal::File(Err(error)) => {
                let snapshot = cloud_mcp_read_knowledge_graph_cache(
                    &req,
                    "error",
                    &format!("Knowledge Graph file watcher failed: {error}"),
                );
                cloud_mcp_emit_knowledge_graph_snapshot(&app, snapshot);
            }
        }
    }

    let mut syncs = state.knowledge_graph_syncs.lock().await;
    let should_remove = syncs
        .get(&req.repo_id)
        .map(|runtime| runtime.generation == generation)
        .unwrap_or(false);
    if should_remove {
        syncs.remove(&req.repo_id);
    }
}

async fn cloud_mcp_stop_all_knowledge_graph_syncs(state: &CloudMcpState) -> usize {
    let runtimes = {
        let mut syncs = state.knowledge_graph_syncs.lock().await;
        syncs
            .drain()
            .map(|(_, runtime)| runtime)
            .collect::<Vec<_>>()
    };
    let stopped = runtimes.len();
    for runtime in runtimes {
        runtime.stop.store(true, Ordering::SeqCst);
        runtime.wake.notify_waiters();
    }
    stopped
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
        "task_history": {"kind": "spec_task_history", "version": 1, "tasks": []},
    })
}

fn cloud_mcp_spec_graph_snapshot_from_data(
    req: &CloudMcpSpecGraphSyncRequest,
    data: Value,
    cache_path: &Path,
    sync_state: &str,
    sync_error: &str,
) -> Value {
    let repo_name = cloud_mcp_repo_display_name(&req.root);
    let display_root = cloud_mcp_repo_display_root(&req.root);
    let nodes = data.get("nodes").cloned().unwrap_or_else(|| json!([]));
    let edges = data.get("edges").cloned().unwrap_or_else(|| json!([]));
    let agent_work = data.get("agent_work").cloned().unwrap_or_else(|| json!({}));
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
    let task_history = data
        .get("task_history")
        .or_else(|| data.get("taskHistory"))
        .cloned()
        .unwrap_or_else(|| json!({"kind": "spec_task_history", "version": 1, "tasks": []}));
    let task_history_cursor = task_history
        .get("cursor")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    json!({
        "ok": true,
        "repoId": req.repo_id.clone(),
        "repoPath": req.root_display.clone(),
        "repoName": repo_name.clone(),
        "displayRoot": display_root.clone(),
        "workspaceDisplay": {
            "repoName": repo_name,
            "displayRoot": display_root,
            "repoPath": req.root_display.clone(),
        },
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
        "taskHistoryCursor": task_history_cursor,
        "taskHistory": task_history.clone(),
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

fn cloud_mcp_attach_spec_task_history(mut snapshot: Value, task_history: Value) -> Value {
    let task_history_cursor = task_history
        .get("cursor")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if let Some(object) = snapshot.as_object_mut() {
        object.insert("taskHistory".to_string(), task_history.clone());
        object.insert("taskHistoryCursor".to_string(), json!(task_history_cursor));
        if let Some(raw) = object.get_mut("raw").and_then(Value::as_object_mut) {
            raw.insert("task_history".to_string(), task_history.clone());
        }
        if let Some(spec_graph) = object.get_mut("specGraph").and_then(Value::as_object_mut) {
            spec_graph.insert("task_history".to_string(), task_history);
        }
    }
    snapshot
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
        let repo_name = cloud_mcp_repo_display_name(&req.root);
        let display_root = cloud_mcp_repo_display_root(&req.root);
        object.insert("ok".to_string(), json!(true));
        object.insert("repoId".to_string(), json!(req.repo_id.clone()));
        object.insert("repoPath".to_string(), json!(req.root_display.clone()));
        object.insert("repoName".to_string(), json!(repo_name.clone()));
        object.insert("displayRoot".to_string(), json!(display_root.clone()));
        object.insert(
            "workspaceDisplay".to_string(),
            json!({
                "repoName": repo_name,
                "displayRoot": display_root,
                "repoPath": req.root_display.clone(),
            }),
        );
        object.insert("workspaceId".to_string(), json!(req.workspace_id.clone()));
        object.insert(
            "workspaceName".to_string(),
            json!(req.workspace_name.clone()),
        );
        object.insert(
            "cachePath".to_string(),
            json!(workspace_path_display(cache_path)),
        );
        object.insert("syncState".to_string(), json!(sync_state));
        object.insert("syncError".to_string(), json!(sync_error));
        object.insert(
            "sourceOfTruth".to_string(),
            json!({
                "kind": "spec_graph",
                "repo_id": req.repo_id.clone(),
                "markdown_backed": true,
                "cached_under_agents": true
            }),
        );
        let task_history = object
            .get("taskHistory")
            .cloned()
            .or_else(|| {
                object
                    .get("raw")
                    .and_then(|raw| raw.get("task_history"))
                    .cloned()
            })
            .unwrap_or_else(|| json!({"kind": "spec_task_history", "version": 1, "tasks": []}));
        let task_history_cursor = task_history
            .get("cursor")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        object.insert("taskHistory".to_string(), task_history);
        object.insert("taskHistoryCursor".to_string(), json!(task_history_cursor));
    }
    snapshot
}

fn cloud_mcp_read_spec_graph_cache(
    req: &CloudMcpSpecGraphSyncRequest,
    sync_state: &str,
    sync_error: &str,
) -> Value {
    let cache_path = match cloud_mcp_safe_spec_graph_repo_cache_path(&req.root, &req.repo_id) {
        Ok(path) => path,
        Err(error) => {
            let fallback_path = cloud_mcp_spec_graph_cache_path(&req.root, &req.repo_id);
            let sync_error = clean_terminal_telemetry_text(&error);
            return cloud_mcp_spec_graph_snapshot_from_data(
                req,
                cloud_mcp_spec_graph_empty_raw(req),
                &fallback_path,
                "error",
                &sync_error,
            );
        }
    };
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

fn cloud_mcp_read_spec_graph_cache_preserving_state(
    req: &CloudMcpSpecGraphSyncRequest,
    fallback_sync_state: &str,
    fallback_sync_error: &str,
) -> Value {
    let Ok(cache_path) = cloud_mcp_safe_spec_graph_repo_cache_path(&req.root, &req.repo_id) else {
        return cloud_mcp_read_spec_graph_cache(req, fallback_sync_state, fallback_sync_error);
    };
    let Some(snapshot) = fs::read_to_string(&cache_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
    else {
        return cloud_mcp_read_spec_graph_cache(req, fallback_sync_state, fallback_sync_error);
    };

    let sync_state = snapshot
        .get("syncState")
        .or_else(|| snapshot.get("sync_state"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback_sync_state)
        .to_string();
    let sync_error = snapshot
        .get("syncError")
        .or_else(|| snapshot.get("sync_error"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback_sync_error)
        .to_string();

    cloud_mcp_stamp_spec_graph_snapshot(snapshot, req, &cache_path, &sync_state, &sync_error)
}

fn cloud_mcp_write_spec_graph_cache(
    req: &CloudMcpSpecGraphSyncRequest,
    snapshot: &Value,
) -> Result<PathBuf, String> {
    let cache_path = cloud_mcp_safe_spec_graph_repo_cache_path(&req.root, &req.repo_id)?;
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
        .or_else(|| {
            snapshot
                .get("raw")
                .and_then(|raw| raw.get(raw_key))
                .and_then(Value::as_array)
        })
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
    let agent_work = if delta
        .get("agent_work")
        .is_some_and(|value| !value.is_null())
    {
        delta["agent_work"].clone()
    } else {
        cache
            .get("agentWork")
            .cloned()
            .or_else(|| {
                cache
                    .get("raw")
                    .and_then(|raw| raw.get("agent_work"))
                    .cloned()
            })
            .unwrap_or_else(|| json!({}))
    };
    let graph_stats = if delta
        .get("graph_stats")
        .is_some_and(|value| !value.is_null())
    {
        delta["graph_stats"].clone()
    } else {
        cache
            .get("graphStats")
            .cloned()
            .or_else(|| {
                cache
                    .get("raw")
                    .and_then(|raw| raw.get("graph_stats"))
                    .cloned()
            })
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
        "task_history": cache.get("taskHistory").cloned().or_else(|| cache.get("raw").and_then(|raw| raw.get("task_history")).cloned()).unwrap_or_else(|| json!({"kind": "spec_task_history", "version": 1, "tasks": []})),
    });
    let mut snapshot = cloud_mcp_spec_graph_snapshot_from_data(req, raw, cache_path, "ready", "");
    if let Some(object) = snapshot.as_object_mut() {
        object.insert(
            "cursor".to_string(),
            delta.get("cursor").cloned().unwrap_or_else(|| json!("")),
        );
        object.insert(
            "nodeHashes".to_string(),
            delta
                .get("node_hashes")
                .cloned()
                .unwrap_or_else(|| json!({})),
        );
        object.insert(
            "edgeHashes".to_string(),
            delta
                .get("edge_hashes")
                .cloned()
                .unwrap_or_else(|| json!({})),
        );
        object.insert(
            "agentWorkHash".to_string(),
            delta
                .get("agent_work_hash")
                .cloned()
                .unwrap_or_else(|| json!("")),
        );
        object.insert(
            "graphStatsHash".to_string(),
            delta
                .get("graph_stats_hash")
                .cloned()
                .unwrap_or_else(|| json!("")),
        );
    }
    snapshot
}

fn cloud_mcp_spec_graph_sync_payload(req: &CloudMcpSpecGraphSyncRequest, cache: &Value) -> Value {
    let repo_name = cloud_mcp_repo_display_name(&req.root);
    let display_root = cloud_mcp_repo_display_root(&req.root);
    json!({
        "source": "rust-diffforge-spec-graph-cache",
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "repo_id": req.repo_id.clone(),
        "repo_name": repo_name,
        "display_root": display_root,
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
    cloud_mcp_connected_or_connect(state).await?;
    let repo_name = cloud_mcp_repo_display_name(&req.root);
    let display_root = cloud_mcp_repo_display_root(&req.root);
    let payload = json!({
        "source": "rust-diffforge-spec-graph",
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "repo_id": req.repo_id.clone(),
        "repo_name": repo_name,
        "display_root": display_root,
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

async fn cloud_mcp_fetch_spec_task_history_data(
    state: &CloudMcpState,
    req: &CloudMcpSpecGraphSyncRequest,
) -> Result<Value, String> {
    cloud_mcp_connected_or_connect(state).await?;
    let payload = json!({
        "source": "rust-diffforge-spec-task-history",
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "repo_id": req.repo_id.clone(),
        "agent_id": "rust-diffforge",
        "self_agent_id": "rust-diffforge",
        "current_agent_id": "rust-diffforge",
        "repo_path": req.root_display.clone(),
        "workspace_root": req.root_display.clone(),
        "workspace_id": req.workspace_id.clone(),
        "workspace_name": req.workspace_name.clone(),
        "limit": 120,
        "order": "asc",
        "ts_ms": cloud_mcp_now_ms(),
    });
    let response = cloud_mcp_post_json_endpoint(state, "/v1/spec/task-history", &payload).await?;
    Ok(cloud_mcp_response_data(&response))
}

async fn cloud_mcp_fetch_spec_task_history_or_empty(
    state: &CloudMcpState,
    req: &CloudMcpSpecGraphSyncRequest,
) -> Value {
    match cloud_mcp_fetch_spec_task_history_data(state, req).await {
        Ok(history) => history,
        Err(error) if error.contains("HTTP 404") => {
            json!({"kind": "spec_task_history", "version": 1, "tasks": []})
        }
        Err(error) => json!({
            "kind": "spec_task_history",
            "version": 1,
            "tasks": [],
            "sync_error": clean_terminal_telemetry_text(&error),
        }),
    }
}

async fn cloud_mcp_sync_spec_graph_once(
    state: &CloudMcpState,
    req: &CloudMcpSpecGraphSyncRequest,
) -> Result<(Value, bool), String> {
    let cache_path = cloud_mcp_spec_graph_cache_path(&req.root, &req.repo_id);
    let current_cache = cloud_mcp_read_spec_graph_cache(req, "syncing", "");
    cloud_mcp_connected_or_connect(state).await?;
    let payload = cloud_mcp_spec_graph_sync_payload(req, &current_cache);
    let delta_response =
        match cloud_mcp_post_json_endpoint(state, "/v1/spec/graph/delta", &payload).await {
            Ok(response) => Some(response),
            Err(error) if error.contains("HTTP 404") => None,
            Err(error) => return Err(error),
        };
    let mut next_snapshot = if let Some(response) = delta_response {
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
    let task_history = cloud_mcp_fetch_spec_task_history_or_empty(state, req).await;
    next_snapshot = cloud_mcp_attach_spec_task_history(next_snapshot, task_history);
    let changed = current_cache.get("cursor").and_then(Value::as_str)
        != next_snapshot.get("cursor").and_then(Value::as_str)
        || current_cache
            .get("taskHistoryCursor")
            .and_then(Value::as_str)
            != next_snapshot
                .get("taskHistoryCursor")
                .and_then(Value::as_str)
        || current_cache.get("syncState").and_then(Value::as_str) == Some("error");
    if changed {
        cloud_mcp_write_spec_graph_cache(req, &next_snapshot)?;
    }
    Ok((next_snapshot, changed))
}

fn cloud_mcp_emit_spec_graph_snapshot(app: &AppHandle, snapshot: Value) {
    let _ = app.emit(CLOUD_MCP_SPEC_GRAPH_CACHE_EVENT, snapshot);
}

enum CloudMcpSpecGraphSyncSignal {
    File(Result<NotifyEvent, notify::Error>),
    Refresh,
    Server(Result<Value, String>),
}

async fn cloud_mcp_sync_spec_graph_cycle(
    app: &AppHandle,
    state: &CloudMcpState,
    req: &CloudMcpSpecGraphSyncRequest,
    first_sync: &mut bool,
    needs_filetree_sync: &mut bool,
    handled_filetree_request: &mut u64,
    last_gitignore_signature: &mut String,
) {
    let requested_filetree_sync = {
        let requests = state.spec_graph_filetree_sync_requests.lock().await;
        requests.get(&req.repo_id).copied().unwrap_or(0)
    };
    if requested_filetree_sync > *handled_filetree_request {
        *handled_filetree_request = requested_filetree_sync;
        *needs_filetree_sync = true;
    }
    let gitignore_signature = cloud_mcp_gitignore_signature(&req.root);
    if !last_gitignore_signature.is_empty() && gitignore_signature != *last_gitignore_signature {
        *needs_filetree_sync = true;
    }

    let mut filetree_synced = false;
    let sync_result = async {
        if *needs_filetree_sync {
            if *first_sync {
                cloud_mcp_wait_for_initial_gitignore(&req.root).await;
            }
            let current_signature = cloud_mcp_gitignore_signature(&req.root);
            let reason = if *first_sync {
                "spec_graph_first_sync"
            } else {
                "spec_graph_filetree_resync"
            };
            cloud_mcp_push_current_filetree_snapshot(
                state,
                &req.repo_id,
                &req.root,
                req.workspace_id.as_deref(),
                req.workspace_name.as_deref(),
                reason,
            )
            .await?;
            *last_gitignore_signature = current_signature;
            *needs_filetree_sync = false;
            filetree_synced = true;
        }
        cloud_mcp_sync_spec_graph_once(state, req).await
    }
    .await;

    match sync_result {
        Ok((snapshot, changed)) => {
            if *first_sync || changed || filetree_synced {
                cloud_mcp_emit_spec_graph_snapshot(app, snapshot);
            }
            *first_sync = false;
        }
        Err(error) => {
            let snapshot = cloud_mcp_read_spec_graph_cache(
                req,
                "error",
                &clean_terminal_telemetry_text(&error),
            );
            let _ = cloud_mcp_write_spec_graph_cache(req, &snapshot);
            cloud_mcp_emit_spec_graph_snapshot(app, snapshot);
        }
    }
}

async fn cloud_mcp_spec_graph_sync_loop(
    app: AppHandle,
    state: CloudMcpState,
    req: CloudMcpSpecGraphSyncRequest,
    generation: u64,
    stop: Arc<AtomicBool>,
    wake: Arc<tokio::sync::Notify>,
    request_wake: Arc<tokio::sync::Notify>,
) {
    let (graph_event_tx, mut graph_event_rx) =
        tokio::sync::mpsc::channel::<Result<Value, String>>(256);
    let (file_event_tx, mut file_event_rx) =
        tokio::sync::mpsc::channel::<Result<NotifyEvent, notify::Error>>(256);
    tauri::async_runtime::spawn(cloud_mcp_graph_ws_event_forward_loop(
        state.clone(),
        req.clone(),
        Arc::clone(&stop),
        Arc::clone(&wake),
        graph_event_tx,
    ));
    let mut filetree_watcher = match RecommendedWatcher::new(
        move |event| {
            let _ = file_event_tx.blocking_send(event);
        },
        NotifyConfig::default(),
    ) {
        Ok(mut watcher) => match watcher.watch(&req.root, RecursiveMode::Recursive) {
            Ok(()) => Some(watcher),
            Err(error) => {
                let snapshot = cloud_mcp_read_spec_graph_cache(
                    &req,
                    "syncing",
                    &format!("Unable to watch workspace filetree changes: {error}"),
                );
                cloud_mcp_emit_spec_graph_snapshot(&app, snapshot);
                None
            }
        },
        Err(error) => {
            let snapshot = cloud_mcp_read_spec_graph_cache(
                &req,
                "syncing",
                &format!("Unable to start workspace filetree watcher: {error}"),
            );
            cloud_mcp_emit_spec_graph_snapshot(&app, snapshot);
            None
        }
    };

    let mut first_sync = true;
    let mut needs_filetree_sync = true;
    let mut handled_filetree_request = 0u64;
    let mut last_gitignore_signature = String::new();

    cloud_mcp_sync_spec_graph_cycle(
        &app,
        &state,
        &req,
        &mut first_sync,
        &mut needs_filetree_sync,
        &mut handled_filetree_request,
        &mut last_gitignore_signature,
    )
    .await;

    while !crate::app_shutdown_requested() {
        let wake_signal = wake.notified();
        let request_signal = request_wake.notified();
        tokio::pin!(wake_signal);
        tokio::pin!(request_signal);
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let still_active = {
            let syncs = state.spec_graph_syncs.lock().await;
            syncs
                .get(&req.repo_id)
                .map(|runtime| {
                    runtime.generation == generation && !runtime.stop.load(Ordering::SeqCst)
                })
                .unwrap_or(false)
        };
        if !still_active {
            break;
        }

        let signal = tokio::select! {
            _ = &mut wake_signal => break,
            _ = &mut request_signal => Some(CloudMcpSpecGraphSyncSignal::Refresh),
            file_event = file_event_rx.recv(), if filetree_watcher.is_some() => {
                file_event.map(CloudMcpSpecGraphSyncSignal::File)
            }
            graph_event = graph_event_rx.recv() => {
                graph_event.map(CloudMcpSpecGraphSyncSignal::Server)
            }
        };
        let Some(signal) = signal else {
            break;
        };
        match signal {
            CloudMcpSpecGraphSyncSignal::Refresh => {
                needs_filetree_sync = true;
                cloud_mcp_sync_spec_graph_cycle(
                    &app,
                    &state,
                    &req,
                    &mut first_sync,
                    &mut needs_filetree_sync,
                    &mut handled_filetree_request,
                    &mut last_gitignore_signature,
                )
                .await;
            }
            CloudMcpSpecGraphSyncSignal::Server(Ok(_)) => {
                while matches!(graph_event_rx.try_recv(), Ok(Ok(_))) {}
                cloud_mcp_sync_spec_graph_cycle(
                    &app,
                    &state,
                    &req,
                    &mut first_sync,
                    &mut needs_filetree_sync,
                    &mut handled_filetree_request,
                    &mut last_gitignore_signature,
                )
                .await;
            }
            CloudMcpSpecGraphSyncSignal::Server(Err(error)) => {
                let snapshot = cloud_mcp_read_spec_graph_cache(
                    &req,
                    "error",
                    &clean_terminal_telemetry_text(&error),
                );
                let _ = cloud_mcp_write_spec_graph_cache(&req, &snapshot);
                cloud_mcp_emit_spec_graph_snapshot(&app, snapshot);
                break;
            }
            CloudMcpSpecGraphSyncSignal::File(Ok(event))
                if cloud_mcp_filetree_event_should_sync(&req.root, &event) =>
            {
                needs_filetree_sync = true;
                let debounce_wake_signal = wake.notified();
                tokio::pin!(debounce_wake_signal);
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                tokio::select! {
                    _ = sleep(Duration::from_millis(CLOUD_MCP_FILETREE_CHANGE_DEBOUNCE_MS)) => {}
                    _ = &mut debounce_wake_signal => break,
                }
                while let Ok(next_event_result) = file_event_rx.try_recv() {
                    match next_event_result {
                        Ok(next_event) => {
                            if cloud_mcp_filetree_event_should_sync(&req.root, &next_event) {
                                needs_filetree_sync = true;
                            }
                        }
                        Err(error) => {
                            let snapshot = cloud_mcp_read_spec_graph_cache(
                                &req,
                                "error",
                                &format!("Workspace filetree watcher failed: {error}"),
                            );
                            cloud_mcp_emit_spec_graph_snapshot(&app, snapshot);
                        }
                    }
                }
                cloud_mcp_sync_spec_graph_cycle(
                    &app,
                    &state,
                    &req,
                    &mut first_sync,
                    &mut needs_filetree_sync,
                    &mut handled_filetree_request,
                    &mut last_gitignore_signature,
                )
                .await;
            }
            CloudMcpSpecGraphSyncSignal::File(Ok(_)) => {}
            CloudMcpSpecGraphSyncSignal::File(Err(error)) => {
                let snapshot = cloud_mcp_read_spec_graph_cache(
                    &req,
                    "error",
                    &format!("Workspace filetree watcher failed: {error}"),
                );
                cloud_mcp_emit_spec_graph_snapshot(&app, snapshot);
                filetree_watcher = None;
            }
        }
    }

    let mut syncs = state.spec_graph_syncs.lock().await;
    let should_remove = syncs
        .get(&req.repo_id)
        .map(|runtime| runtime.generation == generation)
        .unwrap_or(false);
    if should_remove {
        syncs.remove(&req.repo_id);
    }
}

#[tauri::command]
async fn cloud_mcp_get_cached_spec_graph(
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    let req = cloud_mcp_spec_graph_sync_request(repo_path, workspace_id, workspace_name);
    Ok(cloud_mcp_read_spec_graph_cache_preserving_state(
        &req, "empty", "",
    ))
}

#[tauri::command]
async fn cloud_mcp_get_local_ignored_spec_graph_overlay(
    repo_path: String,
) -> Result<Value, String> {
    let root = resolve_workspace_root_directory(Some(&repo_path))
        .unwrap_or_else(|_| PathBuf::from(&repo_path));
    let root = workspace_path_for_process(&root);
    tauri::async_runtime::spawn_blocking(move || {
        cloud_mcp_build_local_ignored_spec_graph_overlay(&root)
    })
    .await
    .map_err(|error| format!("Unable to scan local ignored Spec Graph overlay: {error}"))?
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
    let requested_generation = cloud_mcp_now_ms();
    let requested_stop = Arc::new(AtomicBool::new(false));
    let requested_wake = Arc::new(tokio::sync::Notify::new());
    let requested_request_wake = Arc::new(tokio::sync::Notify::new());
    let mut active_generation = requested_generation;
    let mut should_spawn = false;
    {
        let mut syncs = state.spec_graph_syncs.lock().await;
        if let Some(existing_runtime) = syncs
            .get(&req.repo_id)
            .filter(|runtime| !runtime.stop.load(Ordering::SeqCst))
        {
            active_generation = existing_runtime.generation;
        } else {
            syncs.insert(
                req.repo_id.clone(),
                CloudMcpSpecGraphSyncRuntime {
                    generation: requested_generation,
                    stop: Arc::clone(&requested_stop),
                    wake: Arc::clone(&requested_wake),
                },
            );
            should_spawn = true;
        }
    }
    if should_spawn {
        let mut requests = state.spec_graph_filetree_sync_requests.lock().await;
        requests.insert(req.repo_id.clone(), requested_generation);
    }
    let mut cached = if should_spawn {
        cloud_mcp_read_spec_graph_cache(&req, "syncing", "")
    } else {
        cloud_mcp_read_spec_graph_cache_preserving_state(&req, "syncing", "")
    };
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
                requested_stop,
                requested_wake,
                requested_request_wake,
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
    let removed = if sync_generation
        .map(|generation| {
            syncs
                .get(&req.repo_id)
                .map(|runtime| runtime.generation == generation)
                .unwrap_or(false)
        })
        .unwrap_or(true)
    {
        syncs.remove(&req.repo_id)
    } else {
        None
    };
    let stopped = removed.is_some();
    if let Some(runtime) = removed {
        runtime.stop.store(true, Ordering::SeqCst);
        runtime.wake.notify_waiters();
    }
    Ok(json!({
        "ok": true,
        "repoId": req.repo_id.clone(),
        "repoPath": req.root_display.clone(),
        "stopped": stopped,
    }))
}

#[tauri::command]
async fn cloud_mcp_get_cached_knowledge_graph(
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    let req = cloud_mcp_spec_graph_sync_request(repo_path, workspace_id, workspace_name);
    Ok(cloud_mcp_read_knowledge_graph_cache_preserving_state(
        &req, "local", "",
    ))
}

#[tauri::command]
async fn cloud_mcp_start_knowledge_graph_sync(
    app: AppHandle,
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    let req = cloud_mcp_spec_graph_sync_request(repo_path, workspace_id, workspace_name);
    let requested_generation = cloud_mcp_now_ms();
    let requested_stop = Arc::new(AtomicBool::new(false));
    let requested_wake = Arc::new(tokio::sync::Notify::new());
    let mut active_generation = requested_generation;
    let mut should_spawn = false;
    {
        let mut syncs = state.knowledge_graph_syncs.lock().await;
        if let Some(existing_runtime) = syncs
            .get(&req.repo_id)
            .filter(|runtime| !runtime.stop.load(Ordering::SeqCst))
        {
            active_generation = existing_runtime.generation;
        } else {
            syncs.insert(
                req.repo_id.clone(),
                CloudMcpKnowledgeGraphSyncRuntime {
                    generation: requested_generation,
                    stop: Arc::clone(&requested_stop),
                    wake: Arc::clone(&requested_wake),
                },
            );
            should_spawn = true;
        }
    }
    let mut cached = if should_spawn {
        cloud_mcp_read_knowledge_graph_cache(&req, "syncing", "")
    } else {
        cloud_mcp_read_knowledge_graph_cache_preserving_state(&req, "syncing", "")
    };
    if let Some(object) = cached.as_object_mut() {
        object.insert("syncGeneration".to_string(), json!(active_generation));
    }
    if should_spawn {
        let app_for_task = app.clone();
        let state_for_task = state.inner().clone();
        let req_for_task = req.clone();
        tauri::async_runtime::spawn(async move {
            cloud_mcp_knowledge_graph_watch_loop(
                app_for_task,
                state_for_task,
                req_for_task,
                requested_generation,
                requested_stop,
                requested_wake,
            )
            .await;
        });
    }
    Ok(cached)
}

#[tauri::command]
async fn cloud_mcp_stop_knowledge_graph_sync(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    sync_generation: Option<u64>,
) -> Result<Value, String> {
    let req = cloud_mcp_spec_graph_sync_request(repo_path, None, None);
    let mut syncs = state.knowledge_graph_syncs.lock().await;
    let removed = if sync_generation
        .map(|generation| {
            syncs
                .get(&req.repo_id)
                .map(|runtime| runtime.generation == generation)
                .unwrap_or(false)
        })
        .unwrap_or(true)
    {
        syncs.remove(&req.repo_id)
    } else {
        None
    };
    let stopped = removed.is_some();
    if let Some(runtime) = removed {
        runtime.stop.store(true, Ordering::SeqCst);
        runtime.wake.notify_waiters();
    }
    Ok(json!({
        "ok": true,
        "repoId": req.repo_id.clone(),
        "repoPath": req.root_display.clone(),
        "stopped": stopped,
    }))
}

#[tauri::command]
async fn cloud_mcp_get_knowledge_graph(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    let req = cloud_mcp_spec_graph_sync_request(repo_path, workspace_id, workspace_name);
    let cache_path = cloud_mcp_knowledge_graph_cache_path(&req.root, &req.repo_id);
    let cached_snapshot = cloud_mcp_read_knowledge_graph_cache(&req, "local", "");
    let snapshot = match cloud_mcp_connected_or_connect(state.inner()).await {
        Ok(_) => {
            let data = cloud_mcp_fetch_full_knowledge_graph_data(state.inner(), &req).await?;
            let mirror_sync = cloud_mcp_materialize_knowledge_graph_mirror(&req.root, &data);
            let mut snapshot =
                cloud_mcp_knowledge_graph_snapshot_from_data(&req, data, &cache_path, "ready", "");
            if let Some(object) = snapshot.as_object_mut() {
                object.insert("mirrorSync".to_string(), mirror_sync);
            }
            snapshot
        }
        Err(error) => {
            let mut snapshot = cached_snapshot;
            if let Some(object) = snapshot.as_object_mut() {
                object.insert(
                    "syncError".to_string(),
                    json!(clean_terminal_telemetry_text(&error)),
                );
            }
            snapshot
        }
    };
    let _ = cloud_mcp_write_knowledge_graph_cache(&req, &snapshot);
    Ok(snapshot)
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
    let task_history = cloud_mcp_fetch_spec_task_history_or_empty(state.inner(), &req).await;
    let snapshot = cloud_mcp_attach_spec_task_history(
        cloud_mcp_spec_graph_snapshot_from_data(&req, data, &cache_path, "ready", ""),
        task_history,
    );
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
            identity.log("cloud_mcp.work.completion_guard", &tool_name, guard_detail);
        }
        identity.log(
            "cloud_mcp.tool_call.start",
            &tool_name,
            json!({
                "method": method,
                "tool": tool_name,
                "baseUrl": base_url
            }),
        );

        match cloud_mcp_proxy_post_json(&base_url, &request.to_string()) {
            Ok(response) => {
                identity.log(
                    "cloud_mcp.tool_call.done",
                    &tool_name,
                    json!({
                        "method": method,
                        "tool": tool_name,
                        "baseUrl": base_url
                    }),
                );
                if expects_response {
                    cloud_mcp_proxy_write_message(&mut writer, &response, framed)?;
                }
            }
            Err(error) => {
                identity.log(
                    "cloud_mcp.tool_call.error",
                    &tool_name,
                    json!({
                        "method": method,
                        "tool": tool_name,
                        "baseUrl": base_url,
                        "error": error
                    }),
                );
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                let response = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32000,
                        "message": format!("Cloud MCP proxy could not reach Cloud MCP app websocket at {base_url}/v1/app/ws: {error}")
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

#[cfg(test)]
mod cloud_mcp_tests {
    use super::*;

    #[test]
    fn stopped_terminal_lifecycle_resyncs_main_filetree() {
        assert!(cloud_mcp_lifecycle_status_resyncs_main_filetree(
            "cancelled"
        ));
        assert!(cloud_mcp_lifecycle_status_resyncs_main_filetree(
            "interrupted"
        ));
        assert!(!cloud_mcp_lifecycle_status_resyncs_main_filetree("review"));
        assert!(!cloud_mcp_lifecycle_status_resyncs_main_filetree("done"));
        assert!(!cloud_mcp_lifecycle_status_resyncs_main_filetree("active"));
    }

    #[test]
    fn cloud_checkpoint_requires_active_local_task() {
        let error = cloud_mcp_forward_agent_checkpoint(
            None,
            None,
            None,
            Some("agent-test"),
            Some("session-test"),
            None,
            None,
            None,
            None,
            "Inspected files",
        )
        .unwrap_err();

        assert!(error.contains("active local task"));
    }

    #[test]
    fn cloud_acquire_lease_requires_started_task_id() {
        let error = cloud_mcp_forward_agent_acquire_lease(
            None,
            None,
            None,
            Some("agent-test"),
            Some("session-test"),
            None,
            None,
            None,
            "file:index.html",
            "write",
            Some("Edit index"),
            &json!({"ok": true, "data": {"lease_id": "lease-test"}}),
        )
        .unwrap_err();

        assert!(error.contains("task_id returned by start_task"));
    }

    #[test]
    fn local_ignored_overlay_only_returns_whitelisted_paths() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = env::temp_dir().join(format!("diffforge-local-ignored-overlay-{suffix}"));
        fs::create_dir_all(root.join(".agents")).unwrap();
        fs::create_dir_all(root.join(".codex")).unwrap();
        fs::write(root.join(".gitignore"), "*\n").unwrap();
        fs::write(root.join("AGENTS.md"), "agent instructions\n").unwrap();
        fs::write(root.join("CLAUDE.md"), "claude instructions\n").unwrap();
        fs::write(root.join(".mcp.json"), "{}\n").unwrap();
        fs::write(root.join("ignored.log"), "nope\n").unwrap();

        let first = cloud_mcp_build_local_ignored_spec_graph_overlay(&root).unwrap();
        let first_paths = first["nodes"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|node| node["path"].as_str().map(str::to_string))
            .collect::<HashSet<_>>();
        assert_eq!(first["local_only"].as_bool(), Some(true));
        assert_eq!(first["cache_hit"].as_bool(), Some(false));
        assert!(first["cache_path"]
            .as_str()
            .unwrap_or_default()
            .contains(".agents/spec-graph"));
        for allowed in [
            "AGENTS.md",
            "CLAUDE.md",
            ".mcp.json",
            ".gitignore",
            ".agents",
            ".codex",
        ] {
            assert!(first_paths.contains(allowed), "missing {allowed}");
        }
        assert!(!first_paths.contains("ignored.log"));

        let second = cloud_mcp_build_local_ignored_spec_graph_overlay(&root).unwrap();
        assert_eq!(second["cache_hit"].as_bool(), Some(true));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn spec_graph_cache_path_sanitizes_repo_id_filename() {
        let root = env::temp_dir().join("diffforge-spec-cache-path");
        let cache_path = cloud_mcp_spec_graph_cache_path(&root, "../repo:outside/name");
        let cache_dir = cloud_mcp_spec_graph_cache_dir(&root);

        assert!(cache_path.starts_with(&cache_dir));
        let file_name = cache_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        assert!(!file_name.contains('/'));
        assert!(!file_name.contains('\\'));
        assert!(!file_name.contains(':'));
        assert!(file_name.ends_with(".json"));
    }

    #[cfg(unix)]
    #[test]
    fn spec_graph_cache_write_rejects_symlinked_cache_dir() {
        use std::os::unix::fs::symlink;

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = env::temp_dir().join(format!("diffforge-spec-cache-symlink-{suffix}"));
        let outside = env::temp_dir().join(format!("diffforge-spec-cache-outside-{suffix}"));
        fs::create_dir_all(root.join(".agents")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join(".agents").join("spec-graph")).unwrap();
        let req = CloudMcpSpecGraphSyncRequest {
            root: root.clone(),
            root_display: workspace_path_display(&root),
            repo_id: "repo-test".to_string(),
            workspace_id: None,
            workspace_name: None,
        };

        let error = cloud_mcp_write_spec_graph_cache(&req, &json!({"ok": true})).unwrap_err();
        assert!(error.contains("symlinked Spec Graph cache directory"));

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[cfg(unix)]
    #[test]
    fn local_ignored_overlay_skips_symlinked_whitelist_paths() {
        use std::os::unix::fs::symlink;

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = env::temp_dir().join(format!("diffforge-local-ignored-symlink-{suffix}"));
        let outside = env::temp_dir().join(format!("diffforge-local-ignored-target-{suffix}.md"));
        fs::create_dir_all(&root).unwrap();
        fs::write(&outside, "outside instructions\n").unwrap();
        symlink(&outside, root.join("AGENTS.md")).unwrap();

        let overlay = cloud_mcp_build_local_ignored_spec_graph_overlay(&root).unwrap();
        let paths = overlay["nodes"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|node| node["path"].as_str().map(str::to_string))
            .collect::<HashSet<_>>();
        assert!(!paths.contains("AGENTS.md"));

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_file(outside);
    }

    #[test]
    fn knowledge_authoring_note_path_rejects_absolute_paths() {
        assert!(cloud_mcp_knowledge_authoring_note_path(".agents/knowledge/index.md").is_some());
        assert!(cloud_mcp_knowledge_authoring_note_path("systems/backend-runtime.md").is_some());
        assert!(cloud_mcp_knowledge_authoring_note_path("/tmp/outside.md").is_none());
        assert!(cloud_mcp_knowledge_authoring_note_path("../outside.md").is_none());
        assert!(cloud_mcp_knowledge_authoring_note_path("C:/outside.md").is_none());
    }

    #[test]
    fn server_markdown_delta_prevents_legacy_authoring_overwrite() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = env::temp_dir().join(format!("diffforge-knowledge-delta-{suffix}"));
        fs::create_dir_all(&root).unwrap();

        let response = json!({
            "knowledge_markdown_delta": {
                "mode": "server_markdown_delta",
                "source_of_truth": "server_authored_knowledge_graph",
                "files": [{
                    "path": ".agents/knowledge/systems/backend-runtime.md",
                    "content": "# Server Runtime\n\nPurpose: server-authored.\n"
                }],
                "delete_paths": []
            },
            "knowledge_authoring": {
                "record": true,
                "status": "planned",
                "provider": "legacy",
                "notes": [{
                    "path": "systems/backend-runtime.md",
                    "markdown": "# Legacy Runtime\n\nPurpose: should not overwrite.\n"
                }]
            }
        });

        let result = cloud_mcp_apply_knowledge_authoring_result(Some(&root), &response);
        assert_eq!(result["reason"], "server_markdown_delta_applied");
        let written = fs::read_to_string(
            root.join(".agents")
                .join("knowledge")
                .join("systems")
                .join("backend-runtime.md"),
        )
        .unwrap();
        assert!(written.contains("# Server Runtime"));
        assert!(!written.contains("# Legacy Runtime"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cloud_mcp_filetree_fallback_respects_gitignore_without_git_repo() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = env::temp_dir().join(format!("diffforge-cloud-filetree-no-git-{suffix}"));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("logs")).unwrap();
        fs::create_dir_all(root.join(".codex")).unwrap();
        fs::create_dir_all(root.join(".agents")).unwrap();
        fs::write(
            root.join(".gitignore"),
            "logs/\n.codex/\n.mcp.json\nignored.log\n",
        )
        .unwrap();
        fs::write(root.join("src").join("app.rs"), "fn main() {}\n").unwrap();
        fs::write(root.join("README.md"), "# visible\n").unwrap();
        fs::write(root.join("logs").join("events.jsonl"), "{}\n").unwrap();
        fs::write(root.join(".codex").join("config.toml"), "model = 'x'\n").unwrap();
        fs::write(root.join(".agents").join("cache.json"), "{}\n").unwrap();
        fs::write(root.join(".mcp.json"), "{}\n").unwrap();
        fs::write(root.join("ignored.log"), "ignored\n").unwrap();

        let (entries, truncated) = cloud_mcp_collect_filetree(&root);
        let paths = entries
            .iter()
            .map(|entry| entry.relative_path.as_str())
            .collect::<HashSet<_>>();

        assert!(!truncated);
        assert!(paths.contains("src"));
        assert!(paths.contains("src/app.rs"));
        assert!(paths.contains("README.md"));
        assert!(!paths.contains(".gitignore"));
        assert!(!paths.contains("logs"));
        assert!(!paths.contains("logs/events.jsonl"));
        assert!(!paths.contains(".codex"));
        assert!(!paths.contains(".codex/config.toml"));
        assert!(!paths.contains(".agents"));
        assert!(!paths.contains(".agents/cache.json"));
        assert!(!paths.contains(".mcp.json"));
        assert!(!paths.contains("ignored.log"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cloud_mcp_filetree_fallback_all_ignored_can_be_empty() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = env::temp_dir().join(format!("diffforge-cloud-filetree-empty-{suffix}"));
        fs::create_dir_all(root.join("logs")).unwrap();
        fs::write(root.join(".gitignore"), "*\n").unwrap();
        fs::write(root.join("logs").join("events.jsonl"), "{}\n").unwrap();
        fs::write(root.join("CLAUDE.md"), "ignored locally\n").unwrap();

        let (entries, truncated) = cloud_mcp_collect_filetree(&root);

        assert!(!truncated);
        assert!(entries.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cloud_mcp_filetree_uses_git_visible_paths() {
        if Command::new("git").arg("--version").output().is_err() {
            return;
        }

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = env::temp_dir().join(format!("diffforge-cloud-filetree-{suffix}"));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::create_dir_all(root.join("ignored_dir")).unwrap();
        fs::write(root.join(".gitignore"), "ignored.log\nignored_dir/\n").unwrap();
        fs::write(root.join("src").join("app.rs"), "fn main() {}\n").unwrap();
        fs::write(root.join("package-lock.json"), "{}\n").unwrap();
        fs::write(root.join("assets").join("logo.png"), b"png").unwrap();
        fs::write(root.join("ignored.log"), "ignored\n").unwrap();
        fs::write(root.join("ignored_dir").join("hidden.rs"), "ignored\n").unwrap();

        let init = Command::new("git")
            .arg("-C")
            .arg(&root)
            .arg("init")
            .output()
            .unwrap();
        if !init.status.success() {
            let _ = fs::remove_dir_all(&root);
            return;
        }

        let (entries, truncated) = cloud_mcp_collect_filetree(&root);
        let paths = entries
            .iter()
            .map(|entry| entry.relative_path.as_str())
            .collect::<HashSet<_>>();

        assert!(!truncated);
        assert!(paths.contains("src"));
        assert!(paths.contains("src/app.rs"));
        assert!(paths.contains("assets"));
        assert!(paths.contains("assets/logo.png"));
        assert!(paths.contains("package-lock.json"));
        assert!(!paths.contains(".gitignore"));
        assert!(!paths.contains("ignored.log"));
        assert!(!paths.contains("ignored_dir"));
        assert!(!paths.contains("ignored_dir/hidden.rs"));

        let _ = fs::remove_dir_all(root);
    }
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
            .or_else(|| {
                env::current_dir()
                    .ok()
                    .map(|path| path.to_string_lossy().to_string())
            })
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
            payload.insert(
                "terminalInstanceId".to_string(),
                json!(terminal_instance_id),
            );
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
    let active_task_id = local_task_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "checkpoint requires an active local task; read-only file inspection does not need checkpoints.".to_string()
        })?;
    let repo_path_text = repo_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let worktree_path_text = worktree_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let scan_path_text = worktree_path_text
        .as_ref()
        .or(repo_path_text.as_ref())
        .cloned();
    let repo_id = repo_path_text
        .as_deref()
        .or(scan_path_text.as_deref())
        .map(|value| format!("repo-{}", cloud_mcp_short_hash(value)));
    let base_url = cloud_mcp_base_url();
    let identity = CloudMcpProxyIdentity {
        base_url: Some(base_url.clone()),
        repo_path: scan_path_text.as_ref().map(PathBuf::from),
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
        client_id: CLOUD_MCP_RUST_CLIENT_ID.to_string(),
    };
    let event_kind = "checkpoint_recorded";
    let mut metadata = serde_json::Map::new();
    metadata.insert(
        "reported_by".to_string(),
        json!("coordination-kernel.checkpoint"),
    );
    metadata.insert(
        "local_coordination_task_id".to_string(),
        json!(active_task_id),
    );
    metadata.insert("coordination_task_id".to_string(), json!(active_task_id));
    if let Some(worktree_id) = worktree_id {
        metadata.insert("worktree_id".to_string(), json!(worktree_id));
    }
    if let Some(worktree_path) = worktree_path {
        metadata.insert("worktree_path".to_string(), json!(worktree_path));
    }

    let mut arguments = serde_json::Map::new();
    arguments.insert(
        "source".to_string(),
        json!("rust-diffforge-agent-checkpoint"),
    );
    arguments.insert("client_id".to_string(), json!(identity.client_id.clone()));
    arguments.insert("subtask".to_string(), json!(summary));
    arguments.insert("brief".to_string(), json!(summary));
    arguments.insert("summary".to_string(), json!(summary));
    arguments.insert("agent_status".to_string(), json!("active"));
    arguments.insert("metadata".to_string(), Value::Object(metadata));
    if let Some(lane) = lane.map(str::trim).filter(|value| !value.is_empty()) {
        arguments.insert("lane".to_string(), json!(lane));
    }
    arguments.insert("task_id".to_string(), json!(active_task_id));
    arguments.insert("run_id".to_string(), json!(active_task_id));
    if let Some(repo_id) = identity.repo_id.as_deref() {
        arguments.insert("repo_id".to_string(), json!(repo_id));
    }
    if let Some(repo_path) = repo_path_text.as_deref().or(scan_path_text.as_deref()) {
        arguments.insert("repo_path".to_string(), json!(repo_path));
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
    cloud_mcp_proxy_insert_local_file_scope(&mut arguments, &identity, event_kind);

    let request = json!({
        "event_kind": event_kind,
        "payload": Value::Object(arguments),
        "ts_ms": cloud_mcp_now_ms(),
    });
    identity.log(
        "cloud_mcp.agent_checkpoint.start",
        event_kind,
        json!({
            "activity": "agent checkpoint",
            "baseUrl": base_url,
            "summary": clean_terminal_telemetry_text(summary),
        }),
    );
    match cloud_mcp_proxy_post_json_endpoint(&base_url, "/v1/events", &request.to_string()) {
        Ok(response) => {
            identity.log(
                "cloud_mcp.agent_checkpoint.done",
                event_kind,
                json!({
                    "activity": "agent checkpoint synced",
                    "baseUrl": base_url,
                }),
            );
            let mut parsed = serde_json::from_str::<Value>(&response)
                .unwrap_or_else(|_| json!({"raw_response": response}));
            let knowledge_root = repo_path_text
                .as_deref()
                .or(scan_path_text.as_deref())
                .map(PathBuf::from);
            let knowledge_authoring_apply =
                cloud_mcp_apply_knowledge_authoring_result(knowledge_root.as_deref(), &parsed);
            if let Some(object) = parsed.as_object_mut() {
                object.insert(
                    "knowledge_authoring_apply".to_string(),
                    knowledge_authoring_apply,
                );
            }
            Ok(parsed)
        }
        Err(error) => {
            identity.log(
                "cloud_mcp.agent_checkpoint.error",
                event_kind,
                json!({
                    "activity": "agent checkpoint sync failed",
                    "baseUrl": base_url,
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );
            Err(error)
        }
    }
}

fn cloud_mcp_proxy_push_current_filetree_snapshot(
    base_url: &str,
    repo_id: &str,
    workspace_root: &Path,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
    reason: &str,
) -> Result<Value, String> {
    let (filetree, filetree_truncated) = cloud_mcp_collect_filetree(workspace_root);
    let payload = json!({
        "source": "rust-diffforge-filetree",
        "repo_id": repo_id,
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "workspace_root": workspace_path_display(workspace_root),
        "reason": reason,
        "filetree": filetree,
        "filetree_truncated": filetree_truncated,
        "filetree_authoritative": true,
        "ts_ms": cloud_mcp_now_ms(),
    });
    let request = json!({
        "event_kind": "filetree_snapshot",
        "payload": payload,
        "ts_ms": cloud_mcp_now_ms(),
    });
    let response =
        cloud_mcp_proxy_post_json_endpoint(base_url, "/v1/events", &request.to_string())?;
    Ok(serde_json::from_str::<Value>(&response)
        .unwrap_or_else(|_| json!({"raw_response": response})))
}

fn cloud_mcp_lease_path_from_resource_key(resource_key: &str) -> Option<String> {
    let trimmed = resource_key.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("glob:")
        || trimmed.starts_with("route:")
        || trimmed.starts_with("db:")
    {
        return None;
    }
    let path = trimmed.strip_prefix("file:").unwrap_or(trimmed);
    cloud_mcp_normalized_git_path(path.as_bytes())
}

pub(crate) fn cloud_mcp_forward_agent_acquire_lease(
    repo_path: Option<&str>,
    db_path: Option<&Path>,
    workspace_id: Option<&str>,
    agent_id: Option<&str>,
    session_id: Option<&str>,
    task_id: Option<&str>,
    worktree_id: Option<&str>,
    worktree_path: Option<&str>,
    resource_key: &str,
    mode: &str,
    reason: Option<&str>,
    acquire_result: &Value,
) -> Result<Value, String> {
    if acquire_result["ok"].as_bool() != Some(true) {
        return Ok(json!({"skipped": true, "reason": "lease_not_acquired"}));
    }
    let active_task_id = task_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "acquire_lease Cloud sync requires the task_id returned by start_task.".to_string()
        })?;
    let Some(path) = cloud_mcp_lease_path_from_resource_key(resource_key) else {
        return Ok(json!({"skipped": true, "reason": "non_file_resource"}));
    };
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
        client_id: CLOUD_MCP_RUST_CLIENT_ID.to_string(),
    };
    let data = acquire_result.get("data").unwrap_or(&Value::Null);
    let lease_id = data["lease_id"]
        .as_str()
        .or_else(|| data["lease"]["id"].as_str());
    let reason_text = reason
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Lease acquired for local agent work.");
    let lease_scope = json!({
        "resource_key": resource_key,
        "path": path,
        "mode": mode,
        "reason": reason_text,
        "lease_id": lease_id,
        "lease_state": "active",
        "file_state": "lease",
    });
    let mut metadata = serde_json::Map::new();
    metadata.insert(
        "reported_by".to_string(),
        json!("coordination-kernel.acquire_lease"),
    );
    metadata.insert("resource_key".to_string(), json!(resource_key));
    metadata.insert("path".to_string(), json!(path));
    metadata.insert("mode".to_string(), json!(mode));
    metadata.insert("lease_state".to_string(), json!("active"));
    metadata.insert("file_state".to_string(), json!("lease"));
    metadata.insert("local_lease_file_evidence".to_string(), json!(true));
    metadata.insert(
        "local_active_leases".to_string(),
        json!([lease_scope.clone()]),
    );
    metadata.insert("acquire_result".to_string(), acquire_result.clone());
    if let Some(lease_id) = lease_id {
        metadata.insert("lease_id".to_string(), json!(lease_id));
    }
    metadata.insert("cloud_task_id".to_string(), json!(active_task_id));
    metadata.insert("coordination_task_id".to_string(), json!(active_task_id));
    metadata.insert(
        "local_coordination_task_id".to_string(),
        json!(active_task_id),
    );
    if let Some(worktree_id) = worktree_id {
        metadata.insert("worktree_id".to_string(), json!(worktree_id));
    }
    if let Some(worktree_path) = worktree_path {
        metadata.insert("worktree_path".to_string(), json!(worktree_path));
    }

    let mut arguments = serde_json::Map::new();
    arguments.insert(
        "source".to_string(),
        json!("rust-diffforge-agent-acquire-lease"),
    );
    arguments.insert(
        "spec_source".to_string(),
        json!("rust_terminal_lease_scope"),
    );
    arguments.insert("record_spec_activity".to_string(), json!(true));
    arguments.insert("client_id".to_string(), json!(identity.client_id.clone()));
    arguments.insert("status".to_string(), json!("active"));
    arguments.insert("task_status".to_string(), json!("active"));
    arguments.insert("current_prompt".to_string(), json!(reason_text));
    arguments.insert("progress_summary".to_string(), json!(reason_text));
    arguments.insert("summary".to_string(), json!(reason_text));
    arguments.insert("claimed_paths".to_string(), json!([lease_scope]));
    arguments.insert("metadata".to_string(), Value::Object(metadata));
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
    arguments.insert("task_id".to_string(), json!(active_task_id));
    arguments.insert("run_id".to_string(), json!(active_task_id));

    let request = json!({
        "event_kind": "agent_heartbeat",
        "payload": Value::Object(arguments),
        "ts_ms": cloud_mcp_now_ms(),
    });
    identity.log(
        "cloud_mcp.agent_acquire_lease.start",
        "acquire_lease",
        json!({
            "activity": "agent acquire_lease",
            "baseUrl": base_url,
            "resourceKey": resource_key,
            "path": path,
            "taskId": active_task_id,
        }),
    );
    match cloud_mcp_proxy_post_json_endpoint(&base_url, "/v1/events", &request.to_string()) {
        Ok(response) => {
            let filetree_sync = if let (Some(repo_id), Some(repo_path)) =
                (identity.repo_id.as_deref(), identity.repo_path.as_ref())
            {
                match cloud_mcp_proxy_push_current_filetree_snapshot(
                    &base_url,
                    repo_id,
                    repo_path,
                    identity.workspace_id.as_deref(),
                    identity.workspace_name.as_deref(),
                    "acquire_lease_filetree_resync",
                ) {
                    Ok(response) => json!({"ok": true, "response": response}),
                    Err(error) => json!({"ok": false, "error": error}),
                }
            } else {
                json!({"ok": false, "skipped": true, "reason": "missing_repo_for_filetree_resync"})
            };
            identity.log(
                "cloud_mcp.agent_acquire_lease.done",
                "acquire_lease",
                json!({
                    "activity": "agent acquire_lease synced",
                    "baseUrl": base_url,
                    "filetreeSync": filetree_sync,
                }),
            );
            let mut parsed = serde_json::from_str::<Value>(&response)
                .unwrap_or_else(|_| json!({"raw_response": response}));
            if let Some(object) = parsed.as_object_mut() {
                object.insert("filetree_sync".to_string(), filetree_sync);
            }
            Ok(parsed)
        }
        Err(error) => {
            identity.log(
                "cloud_mcp.agent_acquire_lease.error",
                "acquire_lease",
                json!({
                    "activity": "agent acquire_lease sync failed",
                    "baseUrl": base_url,
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );
            Err(error)
        }
    }
}

pub(crate) fn cloud_mcp_forward_agent_submit_patch(
    repo_path: Option<&str>,
    db_path: Option<&Path>,
    workspace_id: Option<&str>,
    agent_id: Option<&str>,
    session_id: Option<&str>,
    task_id: Option<&str>,
    worktree_id: Option<&str>,
    worktree_path: Option<&str>,
    lane: Option<&str>,
    summary: Option<&str>,
    local_task_status: Option<&str>,
    submit_result: &Value,
) -> Result<Value, String> {
    let active_task_id = task_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "submit_patch Cloud sync requires the task_id returned by start_task.".to_string()
        })?;
    let main_repo_path = repo_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
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
        client_id: CLOUD_MCP_RUST_CLIENT_ID.to_string(),
    };
    let data = submit_result.get("data").unwrap_or(&Value::Null);
    let ok = submit_result["ok"].as_bool() == Some(true);
    let validation_status = data["validation_status"].as_str().unwrap_or_default();
    let auto_merge_status = data["auto_merge"]["status"].as_str().unwrap_or_default();
    let task_status = local_task_status
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            if data["noop"].as_bool() == Some(true) {
                "skipped".to_string()
            } else if ok && auto_merge_status == "applied" {
                "merged".to_string()
            } else if ok && validation_status == "passed" {
                "review".to_string()
            } else {
                "review".to_string()
            }
        });
    let changed_files = data
        .get("changed_files")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let changed_file_paths = cloud_mcp_submit_patch_changed_file_paths(submit_result);
    let mut metadata = serde_json::Map::new();
    metadata.insert(
        "reported_by".to_string(),
        json!("coordination-kernel.submit_patch"),
    );
    metadata.insert("submit_result".to_string(), submit_result.clone());
    metadata.insert("validation_status".to_string(), json!(validation_status));
    metadata.insert("auto_merge_status".to_string(), json!(auto_merge_status));
    metadata.insert("cloud_task_id".to_string(), json!(active_task_id));
    metadata.insert("coordination_task_id".to_string(), json!(active_task_id));
    metadata.insert(
        "local_coordination_task_id".to_string(),
        json!(active_task_id),
    );
    if let Some(patch_id) = data["patch_id"].as_str() {
        metadata.insert("local_patch_id".to_string(), json!(patch_id));
    }
    if let Some(diff_artifact_id) = data["diff_artifact_id"].as_str() {
        metadata.insert(
            "local_diff_artifact_id".to_string(),
            json!(diff_artifact_id),
        );
    }
    if let Some(worktree_id) = worktree_id {
        metadata.insert("worktree_id".to_string(), json!(worktree_id));
    }
    if let Some(worktree_path) = worktree_path {
        metadata.insert("worktree_path".to_string(), json!(worktree_path));
    }

    let mut arguments = serde_json::Map::new();
    let summary_text = summary.unwrap_or("Patch submitted through the local coordination kernel.");
    arguments.insert(
        "source".to_string(),
        json!("rust-diffforge-agent-submit-patch"),
    );
    arguments.insert("client_id".to_string(), json!(identity.client_id.clone()));
    arguments.insert("status".to_string(), json!(task_status.clone()));
    arguments.insert("task_status".to_string(), json!(task_status.clone()));
    arguments.insert("summary".to_string(), json!(summary_text));
    arguments.insert("brief".to_string(), json!(summary_text));
    arguments.insert("changed_files".to_string(), changed_files);
    arguments.insert("metadata".to_string(), Value::Object(metadata));
    arguments.insert("task_id".to_string(), json!(active_task_id));
    arguments.insert("run_id".to_string(), json!(active_task_id));
    if let Some(lane) = lane.map(str::trim).filter(|value| !value.is_empty()) {
        arguments.insert("lane".to_string(), json!(lane));
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
        "event_kind": "submit_patch",
        "payload": Value::Object(arguments),
        "ts_ms": cloud_mcp_now_ms(),
    });
    let should_sync_filetree_for_submit = ok
        && (auto_merge_status == "applied"
            || matches!(task_status.as_str(), "merged" | "done" | "completed"));
    let filetree_sync = if should_sync_filetree_for_submit {
        if let (Some(repo_id), Some(repo_path)) =
            (identity.repo_id.as_deref(), main_repo_path.as_ref())
        {
            match cloud_mcp_proxy_push_current_filetree_snapshot(
                &base_url,
                repo_id,
                repo_path,
                identity.workspace_id.as_deref(),
                identity.workspace_name.as_deref(),
                "submit_patch_pre_accept_filetree_resync",
            ) {
                Ok(response) => json!({"ok": true, "response": response}),
                Err(error) => json!({"ok": false, "error": error}),
            }
        } else {
            json!({"ok": false, "error": "missing_repo_for_filetree_resync"})
        }
    } else {
        json!({"ok": false, "skipped": true, "reason": "patch_not_applied_to_main"})
    };
    identity.log(
        "cloud_mcp.agent_submit_patch.start",
        "submit_patch",
        json!({
            "activity": "agent submit_patch",
            "baseUrl": base_url,
            "filetreeSync": filetree_sync,
            "taskStatus": task_status,
            "taskId": active_task_id,
        }),
    );
    match cloud_mcp_proxy_post_json_endpoint(&base_url, "/v1/events", &request.to_string()) {
        Ok(response) => {
            let isolated_prune = if ok {
                json!({"ok": false, "skipped": true, "reason": "patch_accepted"})
            } else {
                cloud_mcp_forward_isolated_work_pruned(
                    &base_url,
                    &identity,
                    active_task_id,
                    worktree_id,
                    worktree_path,
                    &changed_file_paths,
                    "submit_patch_rejected",
                    submit_result,
                )
                .unwrap_or_else(|error| json!({"ok": false, "error": error}))
            };
            identity.log(
                "cloud_mcp.agent_submit_patch.done",
                "submit_patch",
                json!({
                    "activity": "agent submit_patch synced",
                    "baseUrl": base_url,
                    "filetreeSync": filetree_sync,
                    "isolatedPrune": isolated_prune,
                }),
            );
            let mut parsed = serde_json::from_str::<Value>(&response)
                .unwrap_or_else(|_| json!({"raw_response": response}));
            let knowledge_root = main_repo_path.as_deref().or(identity.repo_path.as_deref());
            let knowledge_authoring_apply =
                cloud_mcp_apply_knowledge_authoring_result(knowledge_root, &parsed);
            if let Some(object) = parsed.as_object_mut() {
                object.insert("filetree_sync".to_string(), filetree_sync);
                object.insert("isolated_prune".to_string(), isolated_prune);
                object.insert(
                    "knowledge_authoring_apply".to_string(),
                    knowledge_authoring_apply,
                );
            }
            Ok(parsed)
        }
        Err(error) => {
            identity.log(
                "cloud_mcp.agent_submit_patch.error",
                "submit_patch",
                json!({
                    "activity": "agent submit_patch sync failed",
                    "baseUrl": base_url,
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );
            Err(error)
        }
    }
}

fn cloud_mcp_submit_patch_changed_file_paths(submit_result: &Value) -> Vec<String> {
    fn collect_from_array(paths: &mut Vec<String>, value: Option<&Value>) {
        if let Some(values) = value.and_then(Value::as_array) {
            for item in values {
                let path = item
                    .as_str()
                    .or_else(|| item.get("path").and_then(Value::as_str))
                    .or_else(|| item.get("file").and_then(Value::as_str))
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                if let Some(path) = path {
                    paths.push(path.replace('\\', "/"));
                }
            }
        }
    }

    let mut paths = Vec::new();
    collect_from_array(&mut paths, submit_result.pointer("/data/changed_files"));
    collect_from_array(
        &mut paths,
        submit_result.pointer("/error/details/changed_files"),
    );
    collect_from_array(&mut paths, submit_result.pointer("/error/details/paths"));
    if let Some(violations) = submit_result
        .pointer("/error/details/violations")
        .and_then(Value::as_array)
    {
        for violation in violations {
            for key in ["path", "file", "resource_key"] {
                if let Some(path) = violation[key]
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    paths.push(path.trim_start_matches("file:").replace('\\', "/"));
                }
            }
        }
    }
    paths.sort();
    paths.dedup();
    paths
}

fn cloud_mcp_forward_isolated_work_pruned(
    base_url: &str,
    identity: &CloudMcpProxyIdentity,
    task_id: &str,
    worktree_id: Option<&str>,
    worktree_path: Option<&str>,
    changed_file_paths: &[String],
    reason: &str,
    submit_result: &Value,
) -> Result<Value, String> {
    let mut metadata = serde_json::Map::new();
    metadata.insert("reported_by".to_string(), json!("rust-diffforge"));
    metadata.insert("reason".to_string(), json!(reason));
    metadata.insert("coordination_task_id".to_string(), json!(task_id));
    metadata.insert("local_coordination_task_id".to_string(), json!(task_id));
    metadata.insert("changed_files".to_string(), json!(changed_file_paths));
    metadata.insert("submit_result".to_string(), submit_result.clone());
    if let Some(worktree_id) = worktree_id {
        metadata.insert("worktree_id".to_string(), json!(worktree_id));
    }
    if let Some(worktree_path) = worktree_path {
        metadata.insert("worktree_path".to_string(), json!(worktree_path));
    }

    let mut payload = serde_json::Map::new();
    payload.insert(
        "source".to_string(),
        json!("rust-diffforge-isolated-work-prune"),
    );
    payload.insert("client_id".to_string(), json!(identity.client_id.clone()));
    payload.insert("status".to_string(), json!("interrupted"));
    payload.insert("task_status".to_string(), json!("interrupted"));
    payload.insert("task_id".to_string(), json!(task_id));
    payload.insert("run_id".to_string(), json!(task_id));
    payload.insert("record_spec_activity".to_string(), json!(false));
    payload.insert("prune_spec_activity".to_string(), json!(true));
    payload.insert("remove_isolated_work".to_string(), json!(true));
    payload.insert("claimed_paths".to_string(), json!([]));
    payload.insert("changed_files".to_string(), json!(changed_file_paths));
    payload.insert(
        "summary".to_string(),
        json!("Pruned rejected isolated work from the spec graph."),
    );
    payload.insert("metadata".to_string(), Value::Object(metadata));
    if let Some(repo_id) = identity.repo_id.as_deref() {
        payload.insert("repo_id".to_string(), json!(repo_id));
    }
    if let Some(repo_path) = identity.repo_path.as_ref() {
        let repo_path = repo_path.to_string_lossy().to_string();
        payload.insert("repo_path".to_string(), json!(repo_path.clone()));
        payload.insert("workspace_root".to_string(), json!(repo_path));
    }
    if let Some(workspace_id) = identity.workspace_id.as_deref() {
        payload.insert("workspace_id".to_string(), json!(workspace_id));
    }
    if let Some(agent_id) = identity.cloud_agent_id() {
        payload.insert("agent_id".to_string(), json!(agent_id.clone()));
        payload.insert("self_agent_id".to_string(), json!(agent_id.clone()));
        payload.insert("current_agent_id".to_string(), json!(agent_id));
    }
    if let Some(session_id) = identity.session_id.as_deref() {
        payload.insert("session_id".to_string(), json!(session_id));
    }

    let request = json!({
        "event_kind": "isolated_work_pruned",
        "payload": Value::Object(payload),
        "ts_ms": cloud_mcp_now_ms(),
    });
    let response = cloud_mcp_proxy_post_json_endpoint(base_url, "/v1/events", &request.to_string());
    let cache_prune = cloud_mcp_prune_cached_isolated_spec_work(
        identity.repo_path.as_deref(),
        identity.repo_id.as_deref(),
        task_id,
        worktree_id,
        changed_file_paths,
        reason,
    );
    match response {
        Ok(response) => {
            let mut parsed = serde_json::from_str::<Value>(&response)
                .unwrap_or_else(|_| json!({"raw_response": response}));
            if let Some(object) = parsed.as_object_mut() {
                object.insert("cache_prune".to_string(), cache_prune);
            }
            Ok(parsed)
        }
        Err(error) => Ok(json!({
            "ok": false,
            "error": error,
            "cache_prune": cache_prune,
        })),
    }
}

fn cloud_mcp_prune_cached_isolated_spec_work(
    repo_path: Option<&Path>,
    repo_id: Option<&str>,
    task_id: &str,
    worktree_id: Option<&str>,
    changed_file_paths: &[String],
    reason: &str,
) -> Value {
    let (Some(repo_path), Some(repo_id)) = (repo_path, repo_id) else {
        return json!({"ok": false, "skipped": true, "reason": "missing_repo_identity"});
    };
    let cache_path = match cloud_mcp_safe_spec_graph_repo_cache_path(repo_path, repo_id) {
        Ok(path) => path,
        Err(error) => {
            return json!({
                "ok": false,
                "skipped": true,
                "reason": "unsafe_cache_path",
                "error": clean_terminal_telemetry_text(&error),
            });
        }
    };
    let Ok(contents) = fs::read_to_string(&cache_path) else {
        return json!({"ok": false, "skipped": true, "reason": "cache_missing"});
    };
    let Ok(mut snapshot) = serde_json::from_str::<Value>(&contents) else {
        return json!({"ok": false, "skipped": true, "reason": "cache_invalid"});
    };
    let path_set = changed_file_paths
        .iter()
        .map(|path| path.trim_start_matches("file:").replace('\\', "/"))
        .collect::<HashSet<_>>();
    let nodes = cloud_mcp_spec_graph_array(&snapshot, "specNodes", "nodes");
    let mut removed_ids = HashSet::new();
    let mut kept_nodes = Vec::new();
    for node in nodes {
        let remove = cloud_mcp_cached_node_is_isolated(&node)
            && cloud_mcp_cached_node_matches_cleanup(&node, task_id, worktree_id, &path_set);
        if remove {
            if let Some(id) = cloud_mcp_spec_graph_item_id(&node) {
                removed_ids.insert(id);
            }
        } else {
            kept_nodes.push(node);
        }
    }
    if removed_ids.is_empty() {
        return json!({"ok": true, "removed_nodes": 0, "reason": "no_matching_cached_nodes"});
    }
    let edges = cloud_mcp_spec_graph_array(&snapshot, "specEdges", "edges")
        .into_iter()
        .filter(|edge| !cloud_mcp_cached_edge_touches_removed_node(edge, &removed_ids))
        .collect::<Vec<_>>();
    cloud_mcp_replace_cached_spec_graph_arrays(&mut snapshot, kept_nodes, edges);
    if let Some(object) = snapshot.as_object_mut() {
        object.insert("syncState".to_string(), json!("ready"));
        object.insert("lastPrunedMs".to_string(), json!(cloud_mcp_now_ms()));
        object.insert("lastPruneReason".to_string(), json!(reason));
    }
    match serde_json::to_string_pretty(&snapshot)
        .map_err(|error| error.to_string())
        .and_then(|contents| fs::write(&cache_path, contents).map_err(|error| error.to_string()))
    {
        Ok(()) => json!({
            "ok": true,
            "removed_nodes": removed_ids.len(),
            "cache_path": workspace_path_display(&cache_path),
        }),
        Err(error) => json!({"ok": false, "error": error}),
    }
}

fn cloud_mcp_cached_node_is_isolated(node: &Value) -> bool {
    let metadata = node.get("metadata").unwrap_or(&Value::Null);
    let file_source =
        cloud_mcp_cached_text(node, metadata, &["file_source", "fileSource", "source"]);
    file_source.eq_ignore_ascii_case("worktree")
        || cloud_mcp_cached_bool(node, metadata, &["provisional", "isProvisional"])
        || cloud_mcp_cached_bool(node, metadata, &["pending_main_sync", "pendingMainSync"])
        || cloud_mcp_cached_text(node, metadata, &["worktree_id", "worktreeId"]).len() > 0
}

fn cloud_mcp_cached_node_matches_cleanup(
    node: &Value,
    task_id: &str,
    worktree_id: Option<&str>,
    paths: &HashSet<String>,
) -> bool {
    let metadata = node.get("metadata").unwrap_or(&Value::Null);
    let node_task_id = cloud_mcp_cached_text(
        node,
        metadata,
        &[
            "task_id",
            "taskId",
            "run_id",
            "runId",
            "coordination_task_id",
            "local_coordination_task_id",
        ],
    );
    if node_task_id == task_id {
        return true;
    }
    if let Some(worktree_id) = worktree_id {
        let node_worktree_id =
            cloud_mcp_cached_text(node, metadata, &["worktree_id", "worktreeId"]);
        if node_worktree_id == worktree_id {
            return true;
        }
    }
    if !paths.is_empty() {
        let node_path = cloud_mcp_cached_text(node, metadata, &["path", "file", "resource_key"]);
        let node_path = node_path.trim_start_matches("file:").replace('\\', "/");
        if paths.contains(&node_path) {
            return true;
        }
    }
    false
}

fn cloud_mcp_cached_edge_touches_removed_node(edge: &Value, removed_ids: &HashSet<String>) -> bool {
    ["source", "target", "from", "to", "source_id", "target_id"]
        .iter()
        .filter_map(|key| edge.get(*key).and_then(Value::as_str))
        .any(|id| removed_ids.contains(id))
}

fn cloud_mcp_replace_cached_spec_graph_arrays(
    snapshot: &mut Value,
    nodes: Vec<Value>,
    edges: Vec<Value>,
) {
    if let Some(object) = snapshot.as_object_mut() {
        object.insert("specNodes".to_string(), json!(nodes.clone()));
        object.insert("specEdges".to_string(), json!(edges.clone()));
        if let Some(spec_graph) = object.get_mut("specGraph").and_then(Value::as_object_mut) {
            spec_graph.insert("nodes".to_string(), json!(nodes.clone()));
            spec_graph.insert("edges".to_string(), json!(edges.clone()));
        }
        if let Some(raw) = object.get_mut("raw").and_then(Value::as_object_mut) {
            raw.insert("nodes".to_string(), json!(nodes));
            raw.insert("edges".to_string(), json!(edges));
        }
    }
}

fn cloud_mcp_cached_text(node: &Value, metadata: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| {
            node.get(*key)
                .and_then(Value::as_str)
                .or_else(|| metadata.get(*key).and_then(Value::as_str))
        })
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

fn cloud_mcp_cached_bool(node: &Value, metadata: &Value, keys: &[&str]) -> bool {
    keys.iter().any(|key| {
        node.get(*key)
            .and_then(Value::as_bool)
            .or_else(|| metadata.get(*key).and_then(Value::as_bool))
            .unwrap_or(false)
    })
}

pub(crate) fn cloud_mcp_forward_agent_start_task(
    repo_path: Option<&str>,
    db_path: Option<&Path>,
    workspace_id: Option<&str>,
    base_url_override: Option<&str>,
    agent_id: Option<&str>,
    session_id: Option<&str>,
    local_task_id: Option<&str>,
    worktree_id: Option<&str>,
    worktree_path: Option<&str>,
    agent_kind: Option<&str>,
    lane: Option<&str>,
    task_title: Option<&str>,
    task_body: Option<&str>,
    plan: &str,
) -> Result<Value, String> {
    let plan = cloud_mcp_clean_prompt_text(plan);
    if plan.trim().is_empty() {
        return Err("start_task plan is required for Cloud MCP spec classification.".to_string());
    }
    let requested_task_id = local_task_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let repo_path_text = repo_path
        .or(worktree_path)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let repo_id = repo_path_text
        .as_deref()
        .map(|value| format!("repo-{}", cloud_mcp_short_hash(value)));
    let base_url = base_url_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches('/').to_string())
        .unwrap_or_else(cloud_mcp_base_url);
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
        client_id: CLOUD_MCP_RUST_CLIENT_ID.to_string(),
    };
    let title = task_title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| cloud_mcp_prompt_summary(&plan));
    let event_kind = "agent_started_work";
    let mut metadata = serde_json::Map::new();
    metadata.insert(
        "reported_by".to_string(),
        json!("coordination-kernel.start_task"),
    );
    metadata.insert("intent_phase".to_string(), json!("agent_start_task_plan"));
    metadata.insert("start_task_plan".to_string(), json!(plan.clone()));
    if let Some(agent_kind) = agent_kind.map(str::trim).filter(|value| !value.is_empty()) {
        metadata.insert("agent_kind".to_string(), json!(agent_kind));
        metadata.insert("coding_agent".to_string(), json!(agent_kind));
    }
    if let Some(requested_task_id) = requested_task_id.as_deref() {
        metadata.insert(
            "requested_coordination_task_id".to_string(),
            json!(requested_task_id),
        );
        metadata.insert("coordination_task_id".to_string(), json!(requested_task_id));
    }
    if let Some(worktree_id) = worktree_id {
        metadata.insert("worktree_id".to_string(), json!(worktree_id));
    }
    if let Some(worktree_path) = worktree_path {
        metadata.insert("worktree_path".to_string(), json!(worktree_path));
    }

    let mut arguments = serde_json::Map::new();
    arguments.insert(
        "source".to_string(),
        json!("rust-diffforge-agent-start-task"),
    );
    arguments.insert("client_id".to_string(), json!(identity.client_id.clone()));
    arguments.insert("title".to_string(), json!(title));
    arguments.insert("body".to_string(), json!(plan.clone()));
    arguments.insert("summary".to_string(), json!(plan.clone()));
    arguments.insert("prompt".to_string(), json!(plan.clone()));
    arguments.insert("source_prompt".to_string(), json!(plan.clone()));
    arguments.insert("status".to_string(), json!("active"));
    arguments.insert("metadata".to_string(), Value::Object(metadata));
    if let Some(agent_kind) = agent_kind.map(str::trim).filter(|value| !value.is_empty()) {
        arguments.insert("agent_kind".to_string(), json!(agent_kind));
        arguments.insert("coding_agent".to_string(), json!(agent_kind));
    }
    if let Some(task_body) = task_body.map(str::trim).filter(|value| !value.is_empty()) {
        arguments.insert("expected_output".to_string(), json!(task_body));
    }
    if let Some(lane) = lane.map(str::trim).filter(|value| !value.is_empty()) {
        arguments.insert("lane".to_string(), json!(lane));
    }
    if let Some(requested_task_id) = requested_task_id.as_deref() {
        arguments.insert("run_id".to_string(), json!(requested_task_id));
        arguments.insert("task_id".to_string(), json!(requested_task_id));
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
    identity.log(
        "cloud_mcp.agent_start_task.start",
        event_kind,
        json!({
            "activity": "agent start_task plan",
            "baseUrl": base_url,
            "plan": clean_terminal_telemetry_text(&plan),
        }),
    );
    let event_response =
        cloud_mcp_proxy_post_json_endpoint(&base_url, "/v1/events", &event_request.to_string())?;
    let event_parsed = serde_json::from_str::<Value>(&event_response)
        .unwrap_or_else(|_| json!({"raw_response": event_response}));
    let event_data = event_parsed
        .get("data")
        .cloned()
        .unwrap_or_else(|| event_parsed.clone());
    let knowledge_authoring_apply =
        cloud_mcp_apply_knowledge_authoring_result(identity.repo_path.as_deref(), &event_parsed);
    let server_task_id = event_data["task_id"]
        .as_str()
        .or_else(|| event_data["task"]["id"].as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            "Cloud start_task did not return a task_id; refusing to create a local task."
                .to_string()
        })?;
    if requested_task_id
        .as_deref()
        .is_some_and(|requested| requested != server_task_id)
    {
        return Err(format!(
            "Cloud start_task returned task_id {server_task_id}, but the local continuation expected {}.",
            requested_task_id.as_deref().unwrap_or_default()
        ));
    }

    let mut context_payload = arguments;
    context_payload.insert("task_id".to_string(), json!(server_task_id.as_str()));
    context_payload.insert("run_id".to_string(), json!(server_task_id.as_str()));
    if let Some(metadata) = context_payload
        .entry("metadata".to_string())
        .or_insert_with(|| json!({}))
        .as_object_mut()
    {
        metadata.insert("cloud_task_id".to_string(), json!(server_task_id.as_str()));
        metadata.insert(
            "coordination_task_id".to_string(),
            json!(server_task_id.as_str()),
        );
        metadata.insert(
            "local_coordination_task_id".to_string(),
            json!(server_task_id.as_str()),
        );
    }
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
    .map(|value| value.get("data").cloned().unwrap_or(value))
    .unwrap_or_else(|| json!({"ok": false, "error": "context_pack_refresh_failed"}));
    let spec_graph = cloud_mcp_proxy_post_json_endpoint(
        &base_url,
        "/v1/spec/graph",
        &context_request.to_string(),
    )
    .ok()
    .and_then(|response| serde_json::from_str::<Value>(&response).ok())
    .map(|value| value.get("data").cloned().unwrap_or(value))
    .unwrap_or_else(|| json!({"ok": false, "error": "spec_graph_refresh_failed"}));

    identity.log(
        "cloud_mcp.agent_start_task.done",
        event_kind,
        json!({
            "activity": "agent start_task synced",
            "baseUrl": base_url,
            "specRecorded": event_data["spec_activity"]["recorded"].as_bool(),
            "specNodeCount": event_data["spec_activity"]["node_ids"].as_array().map(Vec::len),
        }),
    );

    Ok(json!({
        "task_id": server_task_id,
        "task": event_data["task"].clone(),
        "event": event_data.clone(),
        "spec_activity": event_data["spec_activity"].clone(),
        "knowledge_authoring": event_data["knowledge_authoring"].clone(),
        "knowledge_authoring_apply": knowledge_authoring_apply,
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

    if !first_line
        .to_ascii_lowercase()
        .starts_with("content-length:")
    {
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
    let body =
        String::from_utf8(body).map_err(|error| format!("invalid MCP UTF-8 body: {error}"))?;
    Ok(Some((body, true)))
}

fn cloud_mcp_proxy_write_message<W: std::io::Write>(
    writer: &mut W,
    body: &str,
    framed: bool,
) -> Result<(), String> {
    if framed {
        write!(
            writer,
            "Content-Length: {}\r\n\r\n{}",
            body.as_bytes().len(),
            body
        )
        .map_err(|error| format!("failed to write MCP response: {error}"))?;
    } else {
        writeln!(writer, "{body}")
            .map_err(|error| format!("failed to write MCP response: {error}"))?;
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
    cloud_mcp_proxy_insert_if_missing(
        arguments,
        "workspace_name",
        identity.workspace_name.as_deref(),
    );
    cloud_mcp_proxy_insert_if_missing(arguments, "agent_id", cloud_agent_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "self_agent_id", cloud_agent_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "current_agent_id", cloud_agent_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "actor", cloud_agent_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(arguments, "session_id", identity.session_id.as_deref());
    cloud_mcp_proxy_insert_if_missing(
        arguments,
        "desktop_session_id",
        identity.session_id.as_deref(),
    );
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
    cloud_mcp_proxy_insert_if_missing(
        arguments,
        "terminal_instance_id",
        identity.terminal_instance_id.as_deref(),
    );
    cloud_mcp_proxy_insert_if_missing(
        arguments,
        "terminalInstanceId",
        identity.terminal_instance_id.as_deref(),
    );
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
    let Some(local_task_id) = cloud_mcp_proxy_current_local_task_id(identity) else {
        return;
    };
    let (active_leases, parked_intents) =
        cloud_mcp_proxy_local_file_scope(identity, local_task_id.as_str());
    let git_changed_files =
        cloud_mcp_proxy_git_changed_files(identity, &active_leases, &parked_intents);
    if active_leases.is_empty() && parked_intents.is_empty() && git_changed_files.is_empty() {
        return;
    }
    cloud_mcp_proxy_insert_if_missing(arguments, "task_id", Some(local_task_id.as_str()));
    cloud_mcp_proxy_insert_if_missing(arguments, "run_id", Some(local_task_id.as_str()));
    cloud_mcp_proxy_insert_local_task_metadata(arguments, &local_task_id);

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
        arguments.insert(
            "changed_files".to_string(),
            json!(git_changed_files.clone()),
        );
    }
    if matches!(tool_name, "checkpoint_recorded") {
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

fn cloud_mcp_proxy_local_file_scope(
    identity: &CloudMcpProxyIdentity,
    local_task_id: &str,
) -> (Vec<Value>, Vec<Value>) {
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
        .map(|session_id| {
            cloud_mcp_proxy_active_leases_for_session_task(&conn, session_id, local_task_id)
        })
        .unwrap_or_default();
    let parked_intents = cloud_mcp_proxy_parked_intents_for_task(&conn, local_task_id);
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

fn cloud_mcp_proxy_active_leases_for_session_task(
    conn: &rusqlite::Connection,
    session_id: &str,
    task_id: &str,
) -> Vec<Value> {
    let mut statement = match conn.prepare(
        "SELECT r.resource_key, l.mode, l.reason
         FROM leases l
         JOIN resources r ON r.id=l.resource_id
         WHERE l.session_id=?1 AND l.task_id=?2 AND l.status='active'
         ORDER BY l.acquired_at DESC
         LIMIT 50",
    ) {
        Ok(statement) => statement,
        Err(_) => return Vec::new(),
    };
    let rows = match statement.query_map([session_id, task_id], |row| {
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
            "file_state": "lease",
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
        if let Some(task_id) = submission
            .as_ref()
            .and_then(|value| value.task_id.as_deref())
        {
            metadata
                .entry("local_coordination_task_id".to_string())
                .or_insert_with(|| json!(task_id));
        }
        if let Some(patch_id) = submission
            .as_ref()
            .and_then(|value| value.patch_id.as_deref())
        {
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
        let local_task_id = submission.as_ref().and_then(|value| value.task_id.clone());
        return Some(json!({
            "activity": "completion allowed",
            "reason": "local_patch_applied",
            "localTaskId": local_task_id,
        }));
    }

    arguments.insert(status_key.to_string(), json!("review"));
    let metadata = cloud_mcp_proxy_completion_metadata(arguments);
    metadata.insert("requested_status".to_string(), json!("done"));
    metadata.insert(
        "completion_blocked_until_submit_patch".to_string(),
        json!(true),
    );
    metadata.insert(
        "completion_gate".to_string(),
        json!("submit_patch_required"),
    );
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
    use std::io::Write as _;

    let request_kind = if endpoint_path == "/mcp" {
        "mcp"
    } else {
        cloud_mcp_ws_kind_for_endpoint(endpoint_path).ok_or_else(|| {
            format!("Cloud MCP endpoint {endpoint_path} is not routed through the app websocket")
        })?
    };
    let endpoint = cloud_mcp_proxy_parse_http_url(base_url, "/v1/app/ws")?;
    let body_value = serde_json::from_str::<Value>(body)
        .map_err(|error| format!("invalid Cloud MCP websocket JSON payload: {error}"))?;
    let client_id = cloud_mcp_proxy_payload_text(&body_value, &["client_id"])
        .or_else(|| cloud_mcp_proxy_payload_text(&body_value, &["payload", "client_id"]))
        .or_else(|| {
            cloud_mcp_proxy_payload_text(&body_value, &["params", "arguments", "client_id"])
        })
        .unwrap_or_else(|| CLOUD_MCP_RUST_CLIENT_ID.to_string());
    let repo_id = cloud_mcp_proxy_payload_text(&body_value, &["repo_id"])
        .or_else(|| cloud_mcp_proxy_payload_text(&body_value, &["payload", "repo_id"]))
        .or_else(|| cloud_mcp_proxy_payload_text(&body_value, &["params", "arguments", "repo_id"]));
    let workspace_id = cloud_mcp_proxy_payload_text(&body_value, &["workspace_id"])
        .or_else(|| cloud_mcp_proxy_payload_text(&body_value, &["payload", "workspace_id"]))
        .or_else(|| {
            cloud_mcp_proxy_payload_text(&body_value, &["params", "arguments", "workspace_id"])
        });
    let mut stream = std::net::TcpStream::connect((endpoint.host.as_str(), endpoint.port))
        .map_err(|error| format!("connect failed: {error}"))?;
    let read_poll_timeout = Duration::from_secs(1);
    let write_timeout = Duration::from_secs(CLOUD_MCP_SYNC_TIMEOUT_SECS);
    let _ = stream.set_read_timeout(Some(read_poll_timeout));
    let _ = stream.set_write_timeout(Some(write_timeout));

    let websocket_key = general_purpose::STANDARD.encode(uuid::Uuid::new_v4().as_bytes());
    let expected_accept = cloud_mcp_proxy_ws_accept_key(&websocket_key);
    let mut headers = format!("x-diffforge-client-id: {}\r\n", client_id.trim());
    if let Some(workspace_id) = workspace_id.as_deref() {
        headers.push_str(&format!(
            "x-diffforge-workspace-id: {}\r\n",
            workspace_id.trim()
        ));
    }
    if let Some(repo_id) = repo_id.as_deref() {
        headers.push_str(&format!("x-diffforge-repo-id: {}\r\n", repo_id.trim()));
    }
    if let Some(token) = cloud_mcp_dev_auth_token() {
        headers.push_str(&format!("Authorization: Bearer {}\r\n", token));
    }

    let handshake = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {}\r\n{}\r\n",
        endpoint.path,
        endpoint.host_header,
        websocket_key,
        headers,
    );
    stream
        .write_all(handshake.as_bytes())
        .map_err(|error| format!("write failed: {error}"))?;
    let head = cloud_mcp_proxy_read_http_headers(&mut stream)?;
    if !head.starts_with("HTTP/1.1 101") && !head.starts_with("HTTP/1.0 101") {
        return Err(format!(
            "Cloud MCP websocket upgrade returned {}",
            head.lines().next().unwrap_or("non-101 status")
        ));
    }
    if let Some(actual_accept) = cloud_mcp_proxy_http_header(&head, "sec-websocket-accept") {
        if actual_accept.trim() != expected_accept {
            return Err("Cloud MCP websocket upgrade returned an invalid accept key".to_string());
        }
    }

    let ready_text = cloud_mcp_proxy_read_ws_text_frame(&mut stream)?;
    let ready = serde_json::from_str::<Value>(&ready_text)
        .map_err(|error| format!("Cloud MCP websocket ready frame was invalid JSON: {error}"))?;
    let (connection_id, message_token) = cloud_mcp_proxy_extract_ws_message_auth(&ready)?;
    let request_id = format!("proxy-ws-{}-{}", cloud_mcp_now_ms(), uuid::Uuid::new_v4());
    let envelope = json!({
        "kind": request_kind,
        "id": request_id,
        "contract": "diffforge.app_ws.v1",
        "auth": {
            "connection_id": connection_id,
            "message_token": message_token,
        },
        "client_id": client_id,
        "repo_id": repo_id,
        "workspace_id": workspace_id,
        "request": body_value,
    });
    cloud_mcp_proxy_write_ws_text_frame(&mut stream, &envelope.to_string())?;

    let deadline = Instant::now() + Duration::from_secs(CLOUD_MCP_SYNC_TIMEOUT_SECS);
    loop {
        if Instant::now() >= deadline {
            return Err("Cloud MCP websocket request timed out.".to_string());
        }
        let response_text = cloud_mcp_proxy_read_ws_text_frame(&mut stream)?;
        let response = serde_json::from_str::<Value>(&response_text)
            .map_err(|error| format!("Cloud MCP websocket response was invalid JSON: {error}"))?;
        if response.get("id").and_then(Value::as_str) != Some(request_id.as_str()) {
            continue;
        }
        if response.get("ok").and_then(Value::as_bool) == Some(false)
            || response.get("kind").and_then(Value::as_str) == Some("error")
        {
            let message = response["error"]["message"]
                .as_str()
                .unwrap_or("Cloud MCP websocket request failed.");
            return Err(message.to_string());
        }
        let data = response
            .get("data")
            .cloned()
            .unwrap_or_else(|| response.clone());
        if endpoint_path == "/mcp" {
            return Ok(data.to_string());
        }
        return Ok(json!({
            "ok": true,
            "data": data,
            "warnings": [],
        })
        .to_string());
    }
}

fn cloud_mcp_proxy_payload_text(value: &Value, path: &[&str]) -> Option<String> {
    let mut cursor = value;
    for segment in path {
        cursor = cursor.get(*segment)?;
    }
    cursor.as_str().map(str::to_string)
}

fn cloud_mcp_proxy_ws_accept_key(key: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(key.as_bytes());
    hasher.update(b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
    general_purpose::STANDARD.encode(hasher.finalize())
}

fn cloud_mcp_proxy_http_header(head: &str, header_name: &str) -> Option<String> {
    head.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.trim().eq_ignore_ascii_case(header_name) {
            Some(value.trim().to_string())
        } else {
            None
        }
    })
}

fn cloud_mcp_proxy_read_http_headers(stream: &mut std::net::TcpStream) -> Result<String, String> {
    use std::io::Read as _;

    let deadline = Instant::now() + Duration::from_secs(CLOUD_MCP_CONNECT_TIMEOUT_SECS);
    let mut response = Vec::new();
    let mut buffer = [0u8; 1];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => return Err("Cloud MCP websocket closed during handshake".to_string()),
            Ok(bytes_read) => {
                response.extend_from_slice(&buffer[..bytes_read]);
                if response.ends_with(b"\r\n\r\n") {
                    let header_len = response.len().saturating_sub(4);
                    return String::from_utf8(response[..header_len].to_vec()).map_err(|error| {
                        format!("Cloud MCP websocket returned invalid handshake headers: {error}")
                    });
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                if Instant::now() >= deadline {
                    return Err("Cloud MCP websocket handshake timed out".to_string());
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(error) => {
                return Err(format!(
                    "Cloud MCP websocket handshake read failed: {error}"
                ))
            }
        }
    }
}

fn cloud_mcp_proxy_extract_ws_message_auth(ready: &Value) -> Result<(String, String), String> {
    if ready.get("kind").and_then(Value::as_str) != Some("cloud_app_ws_ready") {
        return Err("Cloud MCP websocket did not send a ready frame".to_string());
    }
    let message_auth = ready.get("message_auth").unwrap_or(&Value::Null);
    let connection_id = message_auth
        .get("connection_id")
        .or_else(|| message_auth.get("connectionId"))
        .and_then(Value::as_str)
        .or_else(|| ready.get("connection_id").and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Cloud MCP websocket ready frame omitted connection_id".to_string())?;
    let message_token = message_auth
        .get("message_token")
        .or_else(|| message_auth.get("messageToken"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Cloud MCP websocket ready frame omitted message_token".to_string())?;
    Ok((connection_id.to_string(), message_token.to_string()))
}

fn cloud_mcp_proxy_write_ws_text_frame(
    stream: &mut std::net::TcpStream,
    text: &str,
) -> Result<(), String> {
    cloud_mcp_proxy_write_ws_frame(stream, 0x1, text.as_bytes())
}

fn cloud_mcp_proxy_write_ws_pong_frame(
    stream: &mut std::net::TcpStream,
    payload: &[u8],
) -> Result<(), String> {
    cloud_mcp_proxy_write_ws_frame(stream, 0xA, payload)
}

fn cloud_mcp_proxy_write_ws_frame(
    stream: &mut std::net::TcpStream,
    opcode: u8,
    payload: &[u8],
) -> Result<(), String> {
    use std::io::Write as _;

    let mut frame = Vec::with_capacity(payload.len() + 14);
    frame.push(0x80 | (opcode & 0x0F));
    if payload.len() <= 125 {
        frame.push(0x80 | payload.len() as u8);
    } else if payload.len() <= u16::MAX as usize {
        frame.push(0x80 | 126);
        frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    } else {
        frame.push(0x80 | 127);
        frame.extend_from_slice(&(payload.len() as u64).to_be_bytes());
    }
    let mask_seed = cloud_mcp_now_ms() ^ u64::from(uuid::Uuid::new_v4().as_bytes()[0]);
    let mask = (mask_seed as u32).to_be_bytes();
    frame.extend_from_slice(&mask);
    for (index, byte) in payload.iter().enumerate() {
        frame.push(*byte ^ mask[index % 4]);
    }
    stream
        .write_all(&frame)
        .map_err(|error| format!("Cloud MCP websocket write failed: {error}"))
}

fn cloud_mcp_proxy_read_ws_text_frame(stream: &mut std::net::TcpStream) -> Result<String, String> {
    loop {
        let (opcode, payload) = cloud_mcp_proxy_read_ws_frame(stream)?;
        match opcode {
            0x1 => {
                return String::from_utf8(payload).map_err(|error| {
                    format!("Cloud MCP websocket returned invalid UTF-8 text: {error}")
                });
            }
            0x8 => return Err("Cloud MCP websocket closed the connection".to_string()),
            0x9 => {
                cloud_mcp_proxy_write_ws_pong_frame(stream, &payload)?;
            }
            0xA => {}
            _ => {}
        }
    }
}

fn cloud_mcp_proxy_read_ws_frame(
    stream: &mut std::net::TcpStream,
) -> Result<(u8, Vec<u8>), String> {
    let mut header = [0u8; 2];
    cloud_mcp_proxy_read_exact(stream, &mut header)?;
    let opcode = header[0] & 0x0F;
    let masked = header[1] & 0x80 != 0;
    let mut length = u64::from(header[1] & 0x7F);
    if length == 126 {
        let mut extended = [0u8; 2];
        cloud_mcp_proxy_read_exact(stream, &mut extended)?;
        length = u64::from(u16::from_be_bytes(extended));
    } else if length == 127 {
        let mut extended = [0u8; 8];
        cloud_mcp_proxy_read_exact(stream, &mut extended)?;
        length = u64::from_be_bytes(extended);
    }
    if length > 16 * 1024 * 1024 {
        return Err("Cloud MCP websocket frame is too large".to_string());
    }
    let mask = if masked {
        let mut mask = [0u8; 4];
        cloud_mcp_proxy_read_exact(stream, &mut mask)?;
        Some(mask)
    } else {
        None
    };
    let mut payload = vec![0u8; length as usize];
    if !payload.is_empty() {
        cloud_mcp_proxy_read_exact(stream, &mut payload)?;
    }
    if let Some(mask) = mask {
        for (index, byte) in payload.iter_mut().enumerate() {
            *byte ^= mask[index % 4];
        }
    }
    Ok((opcode, payload))
}

fn cloud_mcp_proxy_read_exact(
    stream: &mut std::net::TcpStream,
    buffer: &mut [u8],
) -> Result<(), String> {
    use std::io::Read as _;

    let deadline = Instant::now() + Duration::from_secs(CLOUD_MCP_SYNC_TIMEOUT_SECS);
    let mut read = 0usize;
    while read < buffer.len() {
        match stream.read(&mut buffer[read..]) {
            Ok(0) => return Err("Cloud MCP websocket closed unexpectedly".to_string()),
            Ok(bytes_read) => read += bytes_read,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                if Instant::now() >= deadline {
                    return Err("Cloud MCP websocket read timed out".to_string());
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(error) => return Err(format!("Cloud MCP websocket read failed: {error}")),
        }
    }
    Ok(())
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
    let without_scheme = trimmed.strip_prefix("http://").ok_or_else(|| {
        "Cloud MCP stdio proxy currently supports local http:// URLs only".to_string()
    })?;
    let (authority, prefix) = without_scheme
        .split_once('/')
        .map(|(authority, path)| (authority, format!("/{path}")))
        .unwrap_or((without_scheme, String::new()));
    let (host, port) = authority
        .rsplit_once(':')
        .and_then(|(host, port)| {
            port.parse::<u16>()
                .ok()
                .map(|port| (host.to_string(), port))
        })
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

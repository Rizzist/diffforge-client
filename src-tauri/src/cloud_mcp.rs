const CLOUD_MCP_DEFAULT_BASE_URL: &str = "https://balancer.diffforge.ai";
const CLOUD_MCP_ALLOW_LOCAL_OVERRIDE_ENV: &str = "RUST_DIFFFORGE_ALLOW_LOCAL_CLOUD_MCP";
const CLOUD_MCP_LOCAL_DOCKER_APP_WS_OVERRIDE_ENABLED: bool = false;
const CLOUD_MCP_LOCAL_DOCKER_APP_WS_URL_ENV: &str = "RUST_DIFFFORGE_LOCAL_DOCKER_APP_WS_URL";
const CLOUD_MCP_LOCAL_DOCKER_VOICE_WS_URL_ENV: &str = "RUST_DIFFFORGE_LOCAL_DOCKER_VOICE_WS_URL";
const CLOUD_MCP_LOCAL_DOCKER_APP_WS_URL: &str = "ws://127.0.0.1:8080/v1/app/ws";
const CLOUD_MCP_LOCAL_DOCKER_PROBE_TIMEOUT_MS: u64 = 180;
const CLOUD_MCP_CONNECT_TIMEOUT_SECS: u64 = 25;
const CLOUD_MCP_SYNC_TIMEOUT_SECS: u64 = 60;
const CLOUD_MCP_AUTH_TIMEOUT_SECS: u64 = 8;
const CLOUD_MCP_WS_READY_TIMEOUT_SECS: u64 = 8;
const CLOUD_MCP_APPWRITE_JWT_DEFAULT_TTL_SECS: u64 = 840;
const CLOUD_MCP_APPWRITE_JWT_MIN_TTL_SECS: u64 = 60;
const CLOUD_MCP_APPWRITE_JWT_MAX_TTL_SECS: u64 = 3600;
const CLOUD_MCP_APPWRITE_JWT_REFRESH_MARGIN_MS: u64 = 60_000;
const CLOUD_MCP_MAX_BEARER_TOKEN_LENGTH: usize = 8192;
const CLOUD_MCP_FILETREE_LIMIT: usize = 2_000;
const CLOUD_MCP_FILETREE_MAX_DEPTH: usize = 8;
const CLOUD_MCP_RUST_CLIENT_ID: &str = "rust-diffforge-agent";
const CLOUD_MCP_DESKTOP_USER_AGENT: &str = "DiffForgeDesktop/0.1";
const CLOUD_MCP_REMOTE_COMMAND_EVENT: &str = "cloud-mcp-remote-command";
const CLOUD_MCP_DEVICE_DELETED_EVENT: &str = "cloud-mcp-device-deleted";
const CLOUD_MCP_CREDIT_WALLET_EVENT: &str = "cloud-mcp-credit-wallet";
const CLOUD_MCP_TOKENOMICS_REFRESH_EVENT: &str = "cloud-mcp-tokenomics-refresh";
const CLOUD_MCP_TASK_HISTORY_UPDATED_EVENT: &str = "cloud-mcp-task-history-updated";
const CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT: &str = "cloud-mcp-workspace-todos-updated";
const CLOUD_MCP_WORKSPACE_ARCHITECTURES_UPDATED_EVENT: &str =
    "cloud-mcp-workspace-architectures-updated";
const VOICE_PLAN_SERVER_RESULT_EVENT: &str = "diffforge-voice-plan-server-result";
const CLOUD_MCP_DEVICE_ID_FILE: &str = "device-id";
const CLOUD_MCP_WORKSPACE_TODO_TEXT_MAX_CHARS: usize = 2_000_000;
const CLOUD_MCP_WORKSPACE_TODO_MAX_ITEMS: usize = 120;
const CLOUD_MCP_TODO_BODY_CACHE_MAX_ITEMS: usize = 96;
const CLOUD_MCP_TODO_BODY_CACHE_FILE: &str = "todo-body-cache.json";
const CLOUD_MCP_REMOTE_COMMAND_RECEIPT_TTL_MS: u64 = 10 * 60 * 1000;
const CLOUD_MCP_REMOTE_COMMAND_RECEIPT_MAX: usize = 512;
const CLOUD_MCP_TERMINAL_CONTEXT_MISSING_BACKOFF_MS: u64 = 1_500;
const CLOUD_MCP_TERMINAL_CONTEXT_MISSING_CACHE_MAX: usize = 512;
const CLOUD_MCP_BACKGROUND_SYNC_DEBOUNCE_MS: u64 = 180;
const CLOUD_MCP_BACKGROUND_SYNC_IDLE_DELAY_MS: u64 = 20;
const CLOUD_MCP_BACKGROUND_SYNC_PRIORITY_HIGH: u8 = 0;
const CLOUD_MCP_BACKGROUND_SYNC_PRIORITY_MEDIUM: u8 = 1;
const CLOUD_MCP_BACKGROUND_SYNC_PRIORITY_LOW: u8 = 2;
const CLOUD_MCP_TOKENOMICS_BACKGROUND_SCAN_DEBOUNCE_MS: u64 = 350;
const CLOUD_MCP_TERMINAL_NICKNAMES: [&str; 50] = [
    "Al", "Bo", "Cy", "Ed", "Ev", "Jo", "Li", "Mo", "Oz", "Ty", "Ada", "Ali", "Amy",
    "Ari", "Ava", "Bea", "Ben", "Bob", "Cal", "Dan", "Eli", "Eva", "Gia", "Gus",
    "Hal", "Ian", "Ira", "Jay", "Kai", "Kim", "Leo", "Lia", "Lou", "Mac", "Max",
    "Mia", "Ned", "Ona", "Pam", "Ray", "Rex", "Sam", "Sue", "Taj", "Alex", "Matt",
    "Mike", "Noah", "Omar", "Ezra",
];

#[derive(Clone)]
struct CloudMcpBackgroundSync {
    pending: Arc<Mutex<HashMap<String, CloudMcpBackgroundSyncJob>>>,
    notify: Arc<tokio::sync::Notify>,
    started: Arc<AtomicBool>,
    tokenomics_pending: Arc<Mutex<Option<CloudMcpTokenomicsSyncJob>>>,
    tokenomics_notify: Arc<tokio::sync::Notify>,
    tokenomics_started: Arc<AtomicBool>,
    tokenomics_cursor: Arc<Mutex<HashMap<String, String>>>,
}

#[derive(Clone)]
struct CloudMcpBackgroundSyncJob {
    enqueued_ms: u64,
    event_kind: String,
    key: String,
    payload: Value,
    priority: u8,
    reason: String,
}

#[derive(Clone)]
struct CloudMcpTokenomicsSyncJob {
    enqueued_ms: u64,
    force_full: bool,
    force_resync: bool,
    reason: String,
}

#[derive(Clone)]
struct CloudMcpState {
    inner: Arc<Mutex<CloudMcpRuntime>>,
    auth: Arc<Mutex<CloudMcpAuthRuntime>>,
    runtime_snapshots: Arc<Mutex<CloudMcpRuntimeSnapshots>>,
    terminal_lifecycle_seq: Arc<AtomicU64>,
    global_ws_started: Arc<AtomicBool>,
    global_ws_registration_blocked: Arc<AtomicBool>,
    global_ws_epoch: Arc<AtomicU64>,
    global_ws_reconnect: Arc<tokio::sync::Notify>,
    global_ws_tx: Arc<Mutex<Option<mpsc::UnboundedSender<Value>>>>,
    global_ws_pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    global_ws_events: tokio::sync::broadcast::Sender<Value>,
    remote_command_listener_started: Arc<AtomicBool>,
    remote_command_receipts: Arc<Mutex<HashMap<String, u64>>>,
    terminal_context_missing_until_ms: Arc<StdMutex<HashMap<String, u64>>>,
    task_history_cache: Arc<Mutex<HashMap<String, Value>>>,
    task_history_refreshes: Arc<Mutex<HashSet<String>>>,
    todo_body_cache: Arc<Mutex<HashMap<String, Value>>>,
    background_sync: CloudMcpBackgroundSync,
}

#[derive(Clone, Default)]
struct CloudMcpAuthRuntime {
    desktop_session_token: Option<String>,
    appwrite_jwt: Option<String>,
    appwrite_jwt_expires_ms: Option<u64>,
    billing_scope_type: String,
    team_id: Option<String>,
    plan_name: String,
    device_limit: Option<u64>,
}

#[derive(Default)]
struct CloudMcpProcessAuthCache {
    desktop_session_token: Option<String>,
    appwrite_jwt: Option<String>,
    appwrite_jwt_expires_ms: Option<u64>,
    billing_scope_type: String,
    team_id: Option<String>,
    plan_name: String,
    device_limit: Option<u64>,
}

#[derive(Clone, Default)]
struct CloudMcpRuntimeSnapshots {
    terminal_presence: Option<Value>,
    workspace_mcps: Option<Value>,
    tokenomics: Option<Value>,
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
    live_runtime_status: Option<Value>,
    registered_workspaces: HashMap<String, CloudMcpWorkspaceStatus>,
    terminal_contexts: HashMap<String, CloudMcpTerminalContextState>,
}

#[derive(Clone)]
struct CloudMcpWsTarget {
    ws_url: String,
    route_token: Option<String>,
    transport: String,
}

#[derive(Clone)]
struct CloudMcpTerminalContextState {
    last_prompt: String,
    repo_id: String,
    agent_id: String,
    lane: String,
    working_directory: PathBuf,
    repo_root: PathBuf,
    prompt_event_id: Option<String>,
    prompt_event_source: Option<String>,
    prompt_event_submitted_at: Option<String>,
    terminal_index: Option<u16>,
    thread_id: Option<String>,
    workspace_id: String,
    workspace_name: String,
    session_mode: String,
    todo_id: Option<String>,
    todo_dispatch_id: Option<String>,
    todo_command_id: Option<String>,
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
    todo_id: Option<String>,
    todo_dispatch_id: Option<String>,
    todo_command_id: Option<String>,
    todo_action: Option<String>,
    todo_resume_requested: bool,
}

#[derive(Clone)]
struct CloudMcpDirectPromptTodoRefs {
    todo_id: String,
    dispatch_id: String,
    command_id: String,
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
    live_runtime_status: Option<Value>,
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
    workspace_kind: String,
    project_mounts: Vec<WorkspaceProjectMount>,
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
    child_workspaces: Vec<CloudMcpWorkspaceStatus>,
    server_response: Value,
    synced: bool,
    log_path: String,
    message: String,
}

struct CloudMcpPreparedWorkspaceBundle {
    primary: CloudMcpPreparedWorkspace,
    children: Vec<CloudMcpPreparedWorkspace>,
}

impl CloudMcpState {
    fn new() -> Self {
        let (global_ws_events, _) = tokio::sync::broadcast::channel(8192);
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
                live_runtime_status: None,
                registered_workspaces: HashMap::new(),
                terminal_contexts: HashMap::new(),
            })),
            auth: Arc::new(Mutex::new(CloudMcpAuthRuntime::default())),
            runtime_snapshots: Arc::new(Mutex::new(CloudMcpRuntimeSnapshots::default())),
            terminal_lifecycle_seq: Arc::new(AtomicU64::new(0)),
            global_ws_started: Arc::new(AtomicBool::new(false)),
            global_ws_registration_blocked: Arc::new(AtomicBool::new(false)),
            global_ws_epoch: Arc::new(AtomicU64::new(0)),
            global_ws_reconnect: Arc::new(tokio::sync::Notify::new()),
            global_ws_tx: Arc::new(Mutex::new(None)),
            global_ws_pending: Arc::new(Mutex::new(HashMap::new())),
            global_ws_events,
            remote_command_listener_started: Arc::new(AtomicBool::new(false)),
            remote_command_receipts: Arc::new(Mutex::new(HashMap::new())),
            terminal_context_missing_until_ms: Arc::new(StdMutex::new(HashMap::new())),
            task_history_cache: Arc::new(Mutex::new(HashMap::new())),
            task_history_refreshes: Arc::new(Mutex::new(HashSet::new())),
            todo_body_cache: Arc::new(Mutex::new(cloud_mcp_load_todo_body_cache())),
            background_sync: CloudMcpBackgroundSync {
                pending: Arc::new(Mutex::new(HashMap::new())),
                notify: Arc::new(tokio::sync::Notify::new()),
                started: Arc::new(AtomicBool::new(false)),
                tokenomics_pending: Arc::new(Mutex::new(None)),
                tokenomics_notify: Arc::new(tokio::sync::Notify::new()),
                tokenomics_started: Arc::new(AtomicBool::new(false)),
                tokenomics_cursor: Arc::new(Mutex::new(HashMap::new())),
            },
        }
    }
}

fn cloud_mcp_background_sync_ack(kind: &str, key: &str, reason: &str, extra: Value) -> Value {
    let mut object = serde_json::Map::new();
    object.insert("ok".to_string(), json!(true));
    object.insert("queued".to_string(), json!(true));
    object.insert("background".to_string(), json!(true));
    object.insert("kind".to_string(), json!(kind));
    object.insert("key".to_string(), json!(key));
    object.insert("reason".to_string(), json!(reason));
    object.insert("queued_at_ms".to_string(), json!(cloud_mcp_now_ms()));
    if let Some(extra_object) = extra.as_object() {
        for (extra_key, extra_value) in extra_object {
            object.insert(extra_key.clone(), extra_value.clone());
        }
    }
    Value::Object(object)
}

fn cloud_mcp_background_sync_ensure_started(state: &CloudMcpState) {
    if state.background_sync.started.swap(true, Ordering::SeqCst) {
        return;
    }

    let worker_state = state.clone();
    tauri::async_runtime::spawn(async move {
        cloud_mcp_background_sync_worker(worker_state).await;
    });
}

async fn cloud_mcp_enqueue_background_sync(
    state: &CloudMcpState,
    key: impl Into<String>,
    event_kind: impl Into<String>,
    payload: Value,
    priority: u8,
    reason: impl Into<String>,
) {
    cloud_mcp_background_sync_ensure_started(state);

    let key = key.into();
    let event_kind = event_kind.into();
    let reason = reason.into();
    let job = CloudMcpBackgroundSyncJob {
        enqueued_ms: cloud_mcp_now_ms(),
        event_kind,
        key: key.clone(),
        payload,
        priority,
        reason,
    };
    {
        let mut pending = state.background_sync.pending.lock().await;
        pending.insert(key, job);
    }
    state.background_sync.notify.notify_one();
}

async fn cloud_mcp_background_sync_worker(state: CloudMcpState) {
    loop {
        state.background_sync.notify.notified().await;
        sleep(Duration::from_millis(CLOUD_MCP_BACKGROUND_SYNC_DEBOUNCE_MS)).await;

        loop {
            let jobs = {
                let mut pending = state.background_sync.pending.lock().await;
                if pending.is_empty() {
                    Vec::new()
                } else {
                    let mut jobs = pending.drain().map(|(_, job)| job).collect::<Vec<_>>();
                    jobs.sort_by(|left, right| {
                        left.priority
                            .cmp(&right.priority)
                            .then_with(|| left.enqueued_ms.cmp(&right.enqueued_ms))
                    });
                    jobs
                }
            };

            if jobs.is_empty() {
                break;
            }

            for job in jobs {
                let result =
                    cloud_mcp_post_event_endpoint(&state, &job.event_kind, &job.payload).await;
                match result {
                    Ok(response) => {
                        log_terminal_status_event(
                            "backend.cloud_mcp.background_sync.done",
                            json!({
                                "event_kind": job.event_kind,
                                "key": job.key,
                                "reason": job.reason,
                                "response": response,
                            }),
                        );
                    }
                    Err(error) => {
                        log_terminal_status_event(
                            "backend.cloud_mcp.background_sync.error",
                            json!({
                                "error": clean_terminal_telemetry_text(&error),
                                "event_kind": job.event_kind,
                                "key": job.key,
                                "reason": job.reason,
                            }),
                        );
                    }
                }

                sleep(Duration::from_millis(
                    CLOUD_MCP_BACKGROUND_SYNC_IDLE_DELAY_MS,
                ))
                .await;
            }
        }
    }
}

fn cloud_mcp_tokenomics_sync_ensure_started(app: AppHandle, state: &CloudMcpState) {
    if state
        .background_sync
        .tokenomics_started
        .swap(true, Ordering::SeqCst)
    {
        return;
    }

    let worker_state = state.clone();
    tauri::async_runtime::spawn(async move {
        cloud_mcp_tokenomics_sync_worker(app, worker_state).await;
    });
}

fn cloud_mcp_merge_tokenomics_sync_jobs(
    existing: CloudMcpTokenomicsSyncJob,
    incoming: CloudMcpTokenomicsSyncJob,
) -> CloudMcpTokenomicsSyncJob {
    let enqueued_ms = existing.enqueued_ms.min(incoming.enqueued_ms);
    let force_resync = existing.force_resync || incoming.force_resync;
    let force_full = force_resync || existing.force_full || incoming.force_full;
    let reason = if incoming.force_resync
        || (!existing.force_resync && incoming.force_full)
        || (!existing.force_resync && !existing.force_full)
    {
        incoming.reason
    } else {
        existing.reason
    };

    CloudMcpTokenomicsSyncJob {
        enqueued_ms,
        force_full,
        force_resync,
        reason,
    }
}

async fn cloud_mcp_enqueue_tokenomics_sync(
    app: AppHandle,
    state: &CloudMcpState,
    reason: String,
    force_full: bool,
    force_resync: bool,
) -> CloudMcpTokenomicsSyncJob {
    cloud_mcp_tokenomics_sync_ensure_started(app, state);
    let incoming = CloudMcpTokenomicsSyncJob {
        enqueued_ms: cloud_mcp_now_ms(),
        force_full: force_full || force_resync,
        force_resync,
        reason,
    };

    let queued_job = {
        let mut pending = state.background_sync.tokenomics_pending.lock().await;
        let next = match pending.take() {
            Some(existing) => cloud_mcp_merge_tokenomics_sync_jobs(existing, incoming),
            None => incoming,
        };
        *pending = Some(next.clone());
        next
    };
    state.background_sync.tokenomics_notify.notify_one();
    queued_job
}

async fn cloud_mcp_tokenomics_sync_worker(app: AppHandle, state: CloudMcpState) {
    loop {
        state.background_sync.tokenomics_notify.notified().await;
        sleep(Duration::from_millis(
            CLOUD_MCP_TOKENOMICS_BACKGROUND_SCAN_DEBOUNCE_MS,
        ))
        .await;

        loop {
            let job = {
                let mut pending = state.background_sync.tokenomics_pending.lock().await;
                pending.take()
            };

            let Some(job) = job else {
                break;
            };

            cloud_mcp_run_tokenomics_sync_job(app.clone(), state.clone(), job).await;
        }
    }
}

async fn cloud_mcp_run_tokenomics_sync_job(
    app: AppHandle,
    worker_state: CloudMcpState,
    job: CloudMcpTokenomicsSyncJob,
) {
    let worker_state_for_summary = worker_state.clone();
    let force_resync = job.force_resync;
    let force_full = job.force_full;
    let reason_for_worker = job.reason.clone();
    let (billing_scope_type, team_id) = cloud_mcp_account_scope(&worker_state).await;
    let tokenomics_scope = tokenomics_billing_scope_from_parts(
        Some(billing_scope_type.as_str()),
        team_id.as_deref(),
        "cloud_sync_active_scope",
    );
    let tokenomics_scope_key = tokenomics_billing_scope_key(
        tokenomics_scope.scope_type.as_str(),
        tokenomics_scope.team_id.as_deref(),
    );
    let tokenomics_scope_key_for_summary = tokenomics_scope_key.clone();
    let summary_result = tauri::async_runtime::spawn_blocking(move || {
        if force_resync {
            tokenomics_scan_usage_for(&app, false, true)?;
            tokenomics_sync_summary_for_scope(&app, &tokenomics_scope)
        } else if force_full {
            tokenomics_scan_usage_for(&app, false, false)?;
            tokenomics_sync_summary_for_scope(&app, &tokenomics_scope)
        } else {
            tokenomics_scan_usage_for(&app, false, false)?;
            let cursor = worker_state_for_summary
                .background_sync
                .tokenomics_cursor
                .blocking_lock()
                .get(&tokenomics_scope_key_for_summary)
                .cloned()
                .unwrap_or_default();
            let conn = tokenomics_open_db(&app)?;
            tokenomics_reconcile_current_provider_accounts(&conn)?;
            tokenomics_sync_delta_from_conn(
                &conn,
                if cursor.trim().is_empty() {
                    None
                } else {
                    Some(cursor.as_str())
                },
                Some(&tokenomics_scope),
            )
        }
    })
    .await
    .map_err(|error| format!("Unable to join background Tokenomics sync: {error}"))
    .and_then(|result| result);

    let mut summary = match summary_result {
        Ok(summary) => summary,
        Err(error) => {
            log_terminal_status_event(
                "backend.cloud_mcp.tokenomics_background.error",
                json!({
                    "error": clean_terminal_telemetry_text(&error),
                    "reason": reason_for_worker,
                }),
            );
            return;
        }
    };

    let device_profile = cloud_mcp_desktop_device_profile();
    cloud_mcp_tag_tokenomics_summary_device(&mut summary, &device_profile);
    let hourly_count = summary
        .get("hourly")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or_default();
    let event_kind = if force_full || force_resync {
        "tokenomics_hourly_usage_snapshot"
    } else {
        "tokenomics_delta"
    };
    let payload = json!({
        "source": "rust-diffforge-tokenomics-sync",
        "event_kind": event_kind,
        "scope": "account",
        "billing_scope_type": billing_scope_type,
        "billing_scope_key": tokenomics_scope_key.as_str(),
        "team_id": team_id,
        "account_scoped": true,
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_id": device_profile["device_id"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "platform": device_profile["platform"].clone(),
        "form_factor": device_profile["form_factor"].clone(),
        "client_kind": device_profile["client_kind"].clone(),
        "agent_id": "rust-diffforge",
        "agent_label": "Diff Forge Desktop",
        "reason": reason_for_worker.clone(),
        "summary": summary.clone(),
        "hourly_count": hourly_count,
        "ts_ms": cloud_mcp_now_ms(),
    });

    if event_kind == "tokenomics_hourly_usage_snapshot" {
        let mut snapshots = worker_state.runtime_snapshots.lock().await;
        snapshots.tokenomics = Some(payload.clone());
    }

    if let Some(cursor) = cloud_mcp_tokenomics_cursor_from_summary(&summary) {
        let mut tokenomics_cursor = worker_state.background_sync.tokenomics_cursor.lock().await;
        tokenomics_cursor.insert(tokenomics_scope_key, cursor);
    }

    cloud_mcp_enqueue_background_sync(
        &worker_state,
        format!("tokenomics:{event_kind}"),
        event_kind,
        payload,
        CLOUD_MCP_BACKGROUND_SYNC_PRIORITY_LOW,
        reason_for_worker,
    )
    .await;
}

fn cloud_mcp_base_url() -> String {
    if !cloud_mcp_base_url_override_allowed() {
        return CLOUD_MCP_DEFAULT_BASE_URL.to_string();
    }

    [
        "RUST_DIFFFORGE_CLOUD_MCP_URL",
        "CLOUD_DIFFFORGE_CLOUD_MCP_URL",
        "CLOUD_DIFFFORGE_BASE_URL",
    ]
    .iter()
    .find_map(|key| {
        env::var(key)
            .ok()
            .and_then(|value| cloud_mcp_normalized_base_url(&value))
    })
    .unwrap_or_else(|| CLOUD_MCP_DEFAULT_BASE_URL.to_string())
}

fn cloud_mcp_normalized_base_url(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed)
}

fn cloud_mcp_base_url_override_allowed() -> bool {
    [
        CLOUD_MCP_ALLOW_LOCAL_OVERRIDE_ENV,
        "CLOUD_DIFFFORGE_ALLOW_LOCAL_CLOUD_MCP",
    ]
    .iter()
    .any(|key| {
        env::var(key).ok().is_some_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
    })
}

fn cloud_mcp_dev_auth_token() -> Option<String> {
    env::var("CLOUD_DIFFFORGE_DEV_TOKEN")
        .or_else(|_| env::var("CLOUD_MCP_DEV_TOKEN"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn cloud_mcp_process_auth_cache() -> &'static StdMutex<CloudMcpProcessAuthCache> {
    static CLOUD_MCP_PROCESS_AUTH_CACHE: OnceLock<StdMutex<CloudMcpProcessAuthCache>> =
        OnceLock::new();

    CLOUD_MCP_PROCESS_AUTH_CACHE.get_or_init(|| StdMutex::new(CloudMcpProcessAuthCache::default()))
}

fn cloud_mcp_clean_bearer_token(value: &str) -> Option<String> {
    let trimmed = value.trim();

    if trimmed.is_empty()
        || trimmed.len() > CLOUD_MCP_MAX_BEARER_TOKEN_LENGTH
        || trimmed
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn cloud_mcp_static_appwrite_jwt() -> Option<String> {
    [
        "RUST_DIFFFORGE_APPWRITE_JWT",
        "RUST_DIFFFORGE_BALANCER_JWT",
        "CLOUD_DIFFFORGE_APPWRITE_JWT",
        "BALANCER_APPWRITE_JWT",
        "APPWRITE_JWT",
    ]
    .iter()
    .find_map(|key| {
        env::var(key)
            .ok()
            .and_then(|value| cloud_mcp_clean_bearer_token(&value))
    })
}

fn cloud_mcp_jwt_is_fresh(expires_ms: Option<u64>, now_ms: u64) -> bool {
    expires_ms.is_some_and(|expires_ms| {
        expires_ms > now_ms.saturating_add(CLOUD_MCP_APPWRITE_JWT_REFRESH_MARGIN_MS)
    })
}

fn cloud_mcp_bearer_header(token: &str, label: &str) -> Result<HeaderValue, String> {
    let token = cloud_mcp_clean_bearer_token(token)
        .ok_or_else(|| format!("{label} is invalid for an Authorization header."))?;

    HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|error| format!("Invalid {label} header: {error}"))
}

fn cloud_mcp_parse_appwrite_jwt_response(body: Value) -> Result<(String, u64), String> {
    let jwt = body
        .get("jwt")
        .and_then(Value::as_str)
        .and_then(cloud_mcp_clean_bearer_token)
        .ok_or_else(|| "Diff Forge AI API did not return a valid Appwrite JWT.".to_string())?;
    let ttl_seconds = body
        .get("expiresInSeconds")
        .and_then(Value::as_u64)
        .unwrap_or(CLOUD_MCP_APPWRITE_JWT_DEFAULT_TTL_SECS)
        .clamp(
            CLOUD_MCP_APPWRITE_JWT_MIN_TTL_SECS,
            CLOUD_MCP_APPWRITE_JWT_MAX_TTL_SECS,
        );
    let expires_ms = cloud_mcp_now_ms().saturating_add(ttl_seconds.saturating_mul(1_000));

    Ok((jwt, expires_ms))
}

async fn cloud_mcp_fetch_appwrite_jwt(
    desktop_session_token: &str,
) -> Result<(String, u64), String> {
    validate_auth_value("Desktop session", desktop_session_token)?;

    let client = http_client(Duration::from_secs(CLOUD_MCP_AUTH_TIMEOUT_SECS))?;
    let response = client
        .post(format!("{API_BASE_URL}/desktop/appwrite-jwt"))
        .bearer_auth(desktop_session_token)
        .send()
        .await
        .map_err(|error| format!("Unable to prepare Cloud MCP Appwrite auth: {error}"))?;
    let body = read_api_response(response, "Unable to prepare Cloud MCP Appwrite auth.").await?;

    cloud_mcp_parse_appwrite_jwt_response(body)
}

async fn cloud_mcp_record_signin_diagnostic_with_token(
    desktop_session_token: String,
    step: &str,
    status: &str,
    message: &str,
    details: Value,
) {
    if !DESKTOP_SIGNIN_DIAGNOSTICS_ENABLED
        || validate_auth_value("Desktop session", &desktop_session_token).is_err()
    {
        return;
    }

    let Ok(client) = http_client(Duration::from_secs(DESKTOP_SIGNIN_DIAGNOSTIC_TIMEOUT_SECS))
    else {
        return;
    };
    let payload = DesktopSigninDiagnosticRequest {
        flow_id: Some("cloud-mcp-connect"),
        source: "rust-diffforge-cloud-mcp",
        step,
        status,
        message: if message.trim().is_empty() {
            None
        } else {
            Some(message)
        },
        details,
    };

    let _ = client
        .post(format!("{API_BASE_URL}/desktop/signin-diagnostics"))
        .bearer_auth(desktop_session_token)
        .json(&payload)
        .send()
        .await;
}

async fn cloud_mcp_record_signin_diagnostic(
    state: &CloudMcpState,
    step: &str,
    status: &str,
    message: &str,
    details: Value,
) {
    let token = {
        let auth = state.auth.lock().await;
        auth.desktop_session_token.clone()
    };

    if let Some(token) = token {
        cloud_mcp_record_signin_diagnostic_with_token(token, step, status, message, details).await;
    }
}

async fn cloud_mcp_record_connection_diagnostic_with_token(
    desktop_session_token: String,
    step: &str,
    status: &str,
    message: &str,
    details: Value,
) {
    if !DESKTOP_CONNECTION_DIAGNOSTICS_ENABLED
        || validate_auth_value("Desktop session", &desktop_session_token).is_err()
    {
        return;
    }

    let Ok(client) = http_client(Duration::from_secs(DESKTOP_SIGNIN_DIAGNOSTIC_TIMEOUT_SECS))
    else {
        return;
    };
    let payload = json!({
        "flowId": "cloud-mcp-runtime",
        "source": "rust-diffforge-cloud-mcp",
        "channel": "rust-cloud-mcp",
        "step": step,
        "status": status,
        "message": if message.trim().is_empty() { Value::Null } else { json!(message) },
        "details": details,
    });

    let _ = client
        .post(format!("{API_BASE_URL}/desktop/connection-diagnostics"))
        .bearer_auth(desktop_session_token)
        .json(&payload)
        .send()
        .await;
}

async fn cloud_mcp_record_connection_diagnostic(
    state: &CloudMcpState,
    step: &str,
    status: &str,
    message: &str,
    details: Value,
) {
    let token = {
        let auth = state.auth.lock().await;
        auth.desktop_session_token.clone()
    };

    if let Some(token) = token {
        cloud_mcp_record_connection_diagnostic_with_token(token, step, status, message, details)
            .await;
    }
}

fn cloud_mcp_read_blocking_api_response(
    response: reqwest::blocking::Response,
    fallback_message: &str,
) -> Result<Value, String> {
    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("Unable to read Diff Forge AI API response: {error}"))?;
    let response_body = if response_text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str::<Value>(&response_text).map_err(|error| {
            if status.is_success() {
                format!("Diff Forge AI API returned invalid JSON: {error}")
            } else {
                format!(
                    "{fallback_message} Diff Forge AI API returned {status} with a non-JSON response."
                )
            }
        })?
    };

    if status.is_success() {
        return Ok(response_body);
    }

    let api_error = response_body
        .get("error")
        .and_then(Value::as_str)
        .or_else(|| response_body.get("message").and_then(Value::as_str))
        .unwrap_or(fallback_message);

    Err(api_error.to_string())
}

fn cloud_mcp_fetch_appwrite_jwt_blocking(
    desktop_session_token: &str,
) -> Result<(String, u64), String> {
    validate_auth_value("Desktop session", desktop_session_token)?;

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(CLOUD_MCP_AUTH_TIMEOUT_SECS))
        .user_agent("Diff Forge AI Desktop/0.1.0")
        .build()
        .map_err(|error| format!("Unable to prepare Cloud MCP Appwrite auth: {error}"))?;
    let response = client
        .post(format!("{API_BASE_URL}/desktop/appwrite-jwt"))
        .bearer_auth(desktop_session_token)
        .send()
        .map_err(|error| format!("Unable to prepare Cloud MCP Appwrite auth: {error}"))?;
    let body = cloud_mcp_read_blocking_api_response(
        response,
        "Unable to prepare Cloud MCP Appwrite auth.",
    )?;

    cloud_mcp_parse_appwrite_jwt_response(body)
}

fn cloud_mcp_update_process_auth_cache(
    desktop_session_token: Option<String>,
    appwrite_jwt: Option<String>,
    appwrite_jwt_expires_ms: Option<u64>,
    billing_scope_type: Option<String>,
    team_id: Option<String>,
    plan_name: Option<String>,
    device_limit: Option<u64>,
) {
    let Ok(mut cache) = cloud_mcp_process_auth_cache().lock() else {
        return;
    };

    if let Some(desktop_session_token) = desktop_session_token {
        cache.desktop_session_token = Some(desktop_session_token);
    } else if appwrite_jwt.is_none() && appwrite_jwt_expires_ms.is_none() {
        cache.desktop_session_token = None;
    }

    if let Some(appwrite_jwt) = appwrite_jwt {
        cache.appwrite_jwt = Some(appwrite_jwt);
        cache.appwrite_jwt_expires_ms = appwrite_jwt_expires_ms;
    } else if appwrite_jwt_expires_ms.is_none() {
        cache.appwrite_jwt = None;
        cache.appwrite_jwt_expires_ms = None;
    }
    if let Some(billing_scope_type) = billing_scope_type {
        cache.billing_scope_type = billing_scope_type;
        cache.team_id = team_id;
    }
    if plan_name.is_some() || device_limit.is_some() {
        let plan_name = cloud_mcp_plan_name_from_value(plan_name.or_else(|| Some(cache.plan_name.clone())));
        cache.device_limit = cloud_mcp_device_limit_from_value(device_limit, &plan_name);
        cache.plan_name = plan_name;
    }
}

fn cloud_mcp_account_scope_from_values(
    scope_type: Option<String>,
    team_id: Option<String>,
) -> (String, Option<String>) {
    let scope_type = scope_type
        .unwrap_or_else(|| "personal".to_string())
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' '], "_");
    let team_id = team_id
        .map(|value| {
            value
                .replace(|character: char| character.is_control(), "")
                .trim()
                .to_string()
        })
        .filter(|value| !value.is_empty());

    if scope_type == "team" {
        if let Some(team_id) = team_id {
            return ("team".to_string(), Some(team_id));
        }
    }

    ("personal".to_string(), None)
}

fn cloud_mcp_plan_name_from_value(value: Option<String>) -> String {
    let Some(value) = value else {
        return "plus".to_string();
    };
    match value.trim().to_ascii_lowercase().as_str() {
        "free" => "free".to_string(),
        "plus" => "plus".to_string(),
        "pro" => "pro".to_string(),
        "ultra" => "ultra".to_string(),
        _ => "plus".to_string(),
    }
}

fn cloud_mcp_device_limit_for_plan(plan_name: &str) -> u64 {
    match plan_name {
        "free" => 0,
        "pro" => 7,
        "ultra" => 20,
        _ => 3,
    }
}

fn cloud_mcp_device_limit_from_value(value: Option<u64>, plan_name: &str) -> Option<u64> {
    value
        .filter(|limit| *limit <= 10_000)
        .or_else(|| Some(cloud_mcp_device_limit_for_plan(plan_name)))
}

async fn cloud_mcp_account_scope(state: &CloudMcpState) -> (String, Option<String>) {
    let auth = state.auth.lock().await;
    cloud_mcp_account_scope_from_values(Some(auth.billing_scope_type.clone()), auth.team_id.clone())
}

async fn cloud_mcp_account_plan(state: &CloudMcpState) -> (String, Option<u64>) {
    let auth = state.auth.lock().await;
    let plan_name = cloud_mcp_plan_name_from_value(Some(auth.plan_name.clone()));
    let device_limit = cloud_mcp_device_limit_from_value(auth.device_limit, &plan_name);
    (plan_name, device_limit)
}

fn cloud_mcp_process_account_scope() -> (String, Option<String>) {
    let Ok(cache) = cloud_mcp_process_auth_cache().lock() else {
        return ("personal".to_string(), None);
    };
    cloud_mcp_account_scope_from_values(
        Some(cache.billing_scope_type.clone()),
        cache.team_id.clone(),
    )
}

fn cloud_mcp_process_account_plan() -> (String, Option<u64>) {
    let Ok(cache) = cloud_mcp_process_auth_cache().lock() else {
        return ("plus".to_string(), Some(3));
    };
    let plan_name = cloud_mcp_plan_name_from_value(Some(cache.plan_name.clone()));
    let device_limit = cloud_mcp_device_limit_from_value(cache.device_limit, &plan_name);
    (plan_name, device_limit)
}

fn cloud_mcp_process_known_account_scope() -> Option<(String, Option<String>)> {
    let Ok(cache) = cloud_mcp_process_auth_cache().lock() else {
        return None;
    };
    if cache.desktop_session_token.is_none() && cache.appwrite_jwt.is_none() {
        return None;
    }
    Some(cloud_mcp_account_scope_from_values(
        Some(cache.billing_scope_type.clone()),
        cache.team_id.clone(),
    ))
}

async fn cloud_mcp_authorization_bearer(state: &CloudMcpState) -> Result<Option<String>, String> {
    if let Some(token) = cloud_mcp_static_appwrite_jwt() {
        return Ok(Some(token));
    }

    let now_ms = cloud_mcp_now_ms();
    let desktop_session_token = {
        let auth = state.auth.lock().await;
        if auth
            .appwrite_jwt
            .as_ref()
            .is_some_and(|_| cloud_mcp_jwt_is_fresh(auth.appwrite_jwt_expires_ms, now_ms))
        {
            return Ok(auth.appwrite_jwt.clone());
        }
        auth.desktop_session_token.clone()
    };

    if let Some(desktop_session_token) = desktop_session_token {
        cloud_mcp_record_signin_diagnostic_with_token(
            desktop_session_token.clone(),
            "appwrite_jwt.request",
            "start",
            "requesting Appwrite JWT for Cloud MCP",
            json!({}),
        )
        .await;
        let (jwt, expires_ms) = match cloud_mcp_fetch_appwrite_jwt(&desktop_session_token).await {
            Ok(result) => result,
            Err(error) => {
                cloud_mcp_record_signin_diagnostic_with_token(
                    desktop_session_token,
                    "appwrite_jwt.request",
                    "error",
                    &error,
                    json!({}),
                )
                .await;
                return Err(error);
            }
        };
        cloud_mcp_record_signin_diagnostic_with_token(
            desktop_session_token.clone(),
            "appwrite_jwt.request",
            "ok",
            "Appwrite JWT received for Cloud MCP",
            json!({"expires_ms": expires_ms}),
        )
        .await;
        {
            let mut auth = state.auth.lock().await;
            auth.appwrite_jwt = Some(jwt.clone());
            auth.appwrite_jwt_expires_ms = Some(expires_ms);
        }
        cloud_mcp_update_process_auth_cache(
            Some(desktop_session_token),
            Some(jwt.clone()),
            Some(expires_ms),
            None,
            None,
            None,
            None,
        );
        return Ok(Some(jwt));
    }

    if let Some(token) = cloud_mcp_process_authorization_bearer() {
        return Ok(Some(token));
    }

    Ok(cloud_mcp_dev_auth_token())
}

fn cloud_mcp_process_authorization_bearer() -> Option<String> {
    if let Some(token) = cloud_mcp_static_appwrite_jwt() {
        return Some(token);
    }

    let now_ms = cloud_mcp_now_ms();
    let desktop_session_token = {
        let Ok(cache) = cloud_mcp_process_auth_cache().lock() else {
            return cloud_mcp_dev_auth_token();
        };
        if cache
            .appwrite_jwt
            .as_ref()
            .is_some_and(|_| cloud_mcp_jwt_is_fresh(cache.appwrite_jwt_expires_ms, now_ms))
        {
            return cache.appwrite_jwt.clone();
        }
        cache.desktop_session_token.clone()
    };

    if let Some(desktop_session_token) = desktop_session_token {
        if let Ok((jwt, expires_ms)) = cloud_mcp_fetch_appwrite_jwt_blocking(&desktop_session_token)
        {
            cloud_mcp_update_process_auth_cache(
                Some(desktop_session_token),
                Some(jwt.clone()),
                Some(expires_ms),
                None,
                None,
                None,
                None,
            );
            return Some(jwt);
        }
    }

    cloud_mcp_dev_auth_token()
}

async fn cloud_mcp_runtime_env_vars(
    state: &CloudMcpState,
) -> Result<Vec<(String, String)>, String> {
    let base_url = {
        let runtime = state.inner.lock().await;
        runtime.base_url.clone()
    };
    let mut env_vars = vec![
        ("CLOUD_DIFFFORGE_BASE_URL".to_string(), base_url.clone()),
        ("CLOUD_MCP_BASE_URL".to_string(), base_url),
    ];

    if let Some(token) = cloud_mcp_authorization_bearer(state).await? {
        env_vars.push(("CLOUD_DIFFFORGE_APPWRITE_JWT".to_string(), token));
    }

    Ok(env_vars)
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

fn cloud_mcp_prompt_source_has_existing_todo(source: Option<&str>) -> bool {
    matches!(
        source
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_ascii_lowercase().replace(['_', ' '], "-"))
            .as_deref(),
        Some(
            "todo-auto-queue"
                | "voice-agent-queue"
                | "voice-plan-queue"
                | "remote-control"
                | "terminal-view-drop"
                | "tui-todo-auto-queue"
                | "tui-voice-agent-queue"
                | "tui-voice-plan-queue"
                | "next-remote-control"
        )
    )
}

fn cloud_mcp_clean_optional_text(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn cloud_mcp_direct_prompt_todo_refs(
    workspace_id: &str,
    pane_id: &str,
    instance_id: u64,
    terminal_index: Option<u16>,
    prompt: &str,
    prompt_metadata: &CloudMcpTerminalPromptMetadata,
) -> Option<CloudMcpDirectPromptTodoRefs> {
    let workspace_id = workspace_id.trim();
    let prompt = prompt.trim();
    if workspace_id.is_empty()
        || prompt.is_empty()
        || cloud_mcp_prompt_source_has_existing_todo(prompt_metadata.prompt_event_source.as_deref())
    {
        return None;
    }
    let seed = prompt_metadata
        .prompt_event_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("prompt-event:{workspace_id}:{value}"))
        .unwrap_or_else(|| {
            format!(
                "direct-prompt:{workspace_id}:{pane_id}:{instance_id}:{}:{prompt}",
                terminal_index
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "terminal".to_string())
            )
        });
    let hash = cloud_mcp_short_hash(&seed);
    Some(CloudMcpDirectPromptTodoRefs {
        todo_id: format!("direct-prompt-todo-{hash}"),
        dispatch_id: format!("direct-prompt-dispatch-{hash}"),
        command_id: format!("direct-prompt-command-{hash}"),
    })
}

fn cloud_mcp_direct_prompt_dispatch_status_for_turn(turn_status: &str) -> Option<&'static str> {
    match turn_status.trim().to_ascii_lowercase().as_str() {
        "completed" | "complete" | "done" => Some("completed"),
        "failed" | "error" => Some("failed"),
        "interrupted" | "cancelled" | "canceled" => Some("cancelled"),
        "running" | "queued" => Some("running"),
        _ => None,
    }
}

fn cloud_mcp_repo_id_for_root(root: &Path) -> String {
    format!(
        "repo-{}",
        cloud_mcp_short_hash(&workspace_path_display(root))
    )
}

fn cloud_mcp_git_repo_identity_id(prefix: &str, value: &str) -> String {
    format!("{prefix}-{}", cloud_mcp_short_hash(value))
}

fn cloud_mcp_git_remote_host_path_from_url(url: &str) -> Option<(String, String)> {
    let mut value = url.trim().trim_matches('"').trim_matches('\'').trim().to_string();
    if value.is_empty() {
        return None;
    }

    if let Some(index) = value.find(['?', '#']) {
        value.truncate(index);
    }
    value = value.trim_end_matches('/').to_string();
    if value.is_empty() {
        return None;
    }

    let without_scheme = if let Some(index) = value.find("://") {
        value[index + 3..].to_string()
    } else {
        value.clone()
    };

    if let Some(at_index) = without_scheme.find('@') {
        let host_path = &without_scheme[at_index + 1..];
        if let Some(colon_index) = host_path.find(':') {
            let before_slash = host_path.find('/').unwrap_or(usize::MAX);
            if colon_index < before_slash {
                let host = host_path[..colon_index].trim().to_ascii_lowercase();
                let path = host_path[colon_index + 1..].trim_matches('/').to_string();
                if !host.is_empty() && !path.is_empty() {
                    return Some((host, path));
                }
            }
        }
    }

    let host_path = without_scheme
        .rsplit_once('@')
        .map(|(_, rest)| rest)
        .unwrap_or(without_scheme.as_str());
    let mut parts = host_path.splitn(2, '/');
    let host = parts.next().unwrap_or_default().trim().to_ascii_lowercase();
    let path = parts.next().unwrap_or_default().trim_matches('/').to_string();
    if host.is_empty() || path.is_empty() || host.contains('\\') {
        return None;
    }
    Some((host, path))
}

fn cloud_mcp_normalized_git_remote_url(url: &str) -> Option<String> {
    let (host, mut path) = cloud_mcp_git_remote_host_path_from_url(url)?;
    path = path.replace('\\', "/");
    while path.ends_with('/') {
        path.pop();
    }
    if path.to_ascii_lowercase().ends_with(".git") {
        path.truncate(path.len().saturating_sub(4));
    }
    let normalized_path = path
        .split('/')
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("/");
    if normalized_path.is_empty() {
        return None;
    }
    Some(format!("{host}/{}", normalized_path.to_ascii_lowercase()))
}

fn cloud_mcp_git_remotes_for_identity(root: &Path) -> Vec<Value> {
    let mut seen = HashSet::new();
    let mut remotes = workspace_git_remotes(root)
        .into_iter()
        .filter_map(|remote| {
            let name = cloud_mcp_payload_text(&remote, &["name"]).unwrap_or_default();
            let direction = cloud_mcp_payload_text(&remote, &["direction"]).unwrap_or_default();
            let url = cloud_mcp_payload_text(&remote, &["url"])?;
            let canonical = cloud_mcp_normalized_git_remote_url(&url)?;
            if !seen.insert(canonical.clone()) {
                return None;
            }
            let canonical_hash = cloud_mcp_short_hash(&canonical);
            Some(json!({
                "name": name,
                "direction": direction,
                "canonical": canonical,
                "canonical_hash": canonical_hash,
                "canonicalHash": canonical_hash,
            }))
        })
        .collect::<Vec<_>>();
    remotes.sort_by(|left, right| {
        left["canonical"]
            .as_str()
            .unwrap_or_default()
            .cmp(right["canonical"].as_str().unwrap_or_default())
    });
    remotes
}

fn cloud_mcp_git_branch_for_identity(root: &Path) -> String {
    let branch = workspace_git_text_or_empty(
        root,
        &["branch", "--show-current"],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
    );
    if !branch.is_empty() {
        return branch;
    }
    workspace_git_text_or_empty(
        root,
        &["rev-parse", "--short", "HEAD"],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
    )
    .chars()
    .take(16)
    .collect()
}

fn cloud_mcp_git_repo_identity_for_path(path: &Path) -> Value {
    let git_root = workspace_git_top_level(path)
        .or_else(|| {
            if path.join(".git").exists() {
                Some(path.to_path_buf())
            } else {
                None
            }
        });
    let Some(git_root) = git_root else {
        return json!({
            "git_repo_present": false,
            "gitRepoPresent": false,
            "git_repo_identity_id": Value::Null,
            "gitRepoIdentityId": Value::Null,
            "git_repo_identity_kind": "none",
            "gitRepoIdentityKind": "none",
        });
    };

    let git_root = git_root.canonicalize().unwrap_or(git_root);
    let remotes = cloud_mcp_git_remotes_for_identity(&git_root);
    let canonical_remote = remotes
        .iter()
        .find(|remote| {
            cloud_mcp_payload_text(remote, &["name"])
                .map(|name| name == "origin")
                .unwrap_or(false)
        })
        .or_else(|| remotes.first())
        .and_then(|remote| cloud_mcp_payload_text(remote, &["canonical"]));
    let canonical_remote_hash = canonical_remote
        .as_deref()
        .map(cloud_mcp_short_hash)
        .unwrap_or_default();
    let root_display = workspace_path_display(&git_root);
    let identity_kind = if canonical_remote.is_some() {
        "remote"
    } else {
        "local_git_root"
    };
    let identity_seed = canonical_remote
        .clone()
        .unwrap_or_else(|| normalized_path_key(&git_root));
    let identity_id = if canonical_remote.is_some() {
        cloud_mcp_git_repo_identity_id("git-remote", &identity_seed)
    } else {
        cloud_mcp_git_repo_identity_id("git-local", &identity_seed)
    };
    let display_name = canonical_remote
        .as_deref()
        .and_then(|remote| remote.rsplit('/').next())
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            git_root
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "repository".to_string())
        });
    let head_sha = workspace_git_head_sha(&git_root);
    let branch = cloud_mcp_git_branch_for_identity(&git_root);
    json!({
        "git_repo_present": true,
        "gitRepoPresent": true,
        "git_repo_identity_id": identity_id.clone(),
        "gitRepoIdentityId": identity_id,
        "git_repo_identity_kind": identity_kind,
        "gitRepoIdentityKind": identity_kind,
        "git_repo_display_name": display_name.clone(),
        "gitRepoDisplayName": display_name,
        "git_repo_root": root_display.clone(),
        "gitRepoRoot": root_display,
        "git_repo_canonical_remote": canonical_remote.clone(),
        "gitRepoCanonicalRemote": canonical_remote,
        "git_repo_canonical_remote_hash": canonical_remote_hash.clone(),
        "gitRepoCanonicalRemoteHash": canonical_remote_hash,
        "git_repo_remote_count": remotes.len(),
        "gitRepoRemoteCount": remotes.len(),
        "git_repo_remotes": remotes.clone(),
        "gitRepoRemotes": remotes,
        "git_branch": branch.clone(),
        "gitBranch": branch,
        "git_head_sha": head_sha.clone(),
        "gitHeadSha": head_sha,
    })
}

fn cloud_mcp_git_identity_from_workspace_or_path(workspace: &Value, root_path: &str) -> Value {
    workspace
        .get("git_repo_identity")
        .or_else(|| workspace.get("gitRepoIdentity"))
        .filter(|identity| {
            cloud_mcp_payload_text(identity, &["git_repo_identity_id", "gitRepoIdentityId"])
                .is_some()
        })
        .cloned()
        .unwrap_or_else(|| cloud_mcp_git_repo_identity_for_path(Path::new(root_path)))
}

fn cloud_mcp_apply_git_identity_to_value(value: &mut Value, identity: &Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    object.insert("git_repo_identity".to_string(), identity.clone());
    object.insert("gitRepoIdentity".to_string(), identity.clone());
    for (field, aliases) in [
        ("git_repo_present", &["gitRepoPresent"][..]),
        ("git_repo_identity_id", &["gitRepoIdentityId"][..]),
        ("git_repo_identity_kind", &["gitRepoIdentityKind"][..]),
        ("git_repo_display_name", &["gitRepoDisplayName"][..]),
        ("git_repo_root", &["gitRepoRoot"][..]),
        ("git_repo_canonical_remote", &["gitRepoCanonicalRemote"][..]),
        (
            "git_repo_canonical_remote_hash",
            &["gitRepoCanonicalRemoteHash"][..],
        ),
        ("git_repo_remote_count", &["gitRepoRemoteCount"][..]),
        ("git_repo_remotes", &["gitRepoRemotes"][..]),
        ("git_branch", &["gitBranch"][..]),
        ("git_head_sha", &["gitHeadSha"][..]),
    ] {
        let item = identity
            .get(field)
            .or_else(|| aliases.iter().find_map(|alias| identity.get(*alias)))
            .cloned()
            .unwrap_or(Value::Null);
        object.insert(field.to_string(), item.clone());
        for alias in aliases {
            object.insert((*alias).to_string(), item.clone());
        }
    }
}

fn cloud_mcp_workspace_location_fingerprint(root: &Path) -> String {
    format!(
        "loc-{}",
        cloud_mcp_short_hash(&workspace_path_display(root).to_lowercase())
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
        live_runtime_status: runtime.live_runtime_status.clone(),
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
    runtime.live_runtime_status = None;
    cloud_mcp_snapshot(&runtime)
}

async fn cloud_mcp_connect_state(state: &CloudMcpState) -> Result<CloudMcpStatus, String> {
    cloud_mcp_record_signin_diagnostic(
        state,
        "cloud_mcp.connect",
        "start",
        "starting Cloud MCP websocket connection",
        json!({}),
    )
    .await;
    cloud_mcp_start_global_ws(state).await;
    match cloud_mcp_wait_for_ws_sender(state).await {
        Ok(_) => {
            let snapshot = cloud_mcp_status_snapshot(state).await;
            cloud_mcp_record_signin_diagnostic(
                state,
                "cloud_mcp.connect",
                "ok",
                "Cloud MCP websocket connected",
                json!({
                    "status": snapshot.status,
                    "global_ws_status": snapshot.global_ws_status,
                    "connected": snapshot.connected,
                    "global_ws_connected": snapshot.global_ws_connected,
                }),
            )
            .await;
            Ok(snapshot)
        }
        Err(error) => {
            let snapshot = cloud_mcp_set_connection_error(state, error.clone()).await;
            cloud_mcp_record_signin_diagnostic(
                state,
                "cloud_mcp.connect",
                "error",
                &snapshot.last_error,
                json!({
                    "status": snapshot.status,
                    "global_ws_status": snapshot.global_ws_status,
                    "global_ws_last_error": snapshot.global_ws_last_error,
                }),
            )
            .await;
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

async fn cloud_mcp_set_global_ws_phase(
    state: &CloudMcpState,
    status: &str,
    global_ws_status: &str,
) {
    let mut runtime = state.inner.lock().await;
    runtime.connected = false;
    runtime.status = status.to_string();
    runtime.global_ws_connected = false;
    runtime.global_ws_status = global_ws_status.to_string();
}

async fn require_cloud_mcp_connected_state(
    state: &CloudMcpState,
) -> Result<CloudMcpStatus, String> {
    cloud_mcp_connected_or_connect(state).await
}

async fn cloud_mcp_start_global_ws(state: &CloudMcpState) {
    if state.global_ws_registration_blocked.load(Ordering::SeqCst) {
        return;
    }
    if state.global_ws_started.swap(true, Ordering::SeqCst) {
        return;
    }
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        let loop_state = state.clone();
        let result = std::panic::AssertUnwindSafe(cloud_mcp_global_ws_loop(loop_state))
            .catch_unwind()
            .await;
        if result.is_err() {
            state.global_ws_started.store(false, Ordering::SeqCst);
            cloud_mcp_mark_global_ws_disconnected(
                &state,
                "Cloud MCP app websocket loop crashed and will be restarted.",
            )
            .await;
        }
    });
}

async fn cloud_mcp_global_ws_loop(state: CloudMcpState) {
    cloud_mcp_log_voice_shared_ws(
        "voice_agent.shared_ws.manager_started",
        "manager",
        "start",
        "Rust started the single shared app websocket manager.",
        json!({}),
    );
    loop {
        if state.global_ws_registration_blocked.load(Ordering::SeqCst) {
            state.global_ws_started.store(false, Ordering::SeqCst);
            return;
        }
        let base_url = {
            let runtime = state.inner.lock().await;
            runtime.base_url.clone()
        };
        cloud_mcp_set_global_ws_phase(&state, "resolving_route", "resolving_route").await;
        let target = cloud_mcp_resolve_ws_target(&state, &base_url, "/v1/app/ws").await;
        if state.global_ws_registration_blocked.load(Ordering::SeqCst) {
            state.global_ws_started.store(false, Ordering::SeqCst);
            return;
        }
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

        match cloud_mcp_open_global_ws(&state, &base_url, &target).await {
            Ok(()) => {}
            Err(error) => {
                if state.global_ws_registration_blocked.load(Ordering::SeqCst) {
                    state.global_ws_started.store(false, Ordering::SeqCst);
                    return;
                }
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
                    runtime.live_runtime_status = None;
                }
                cloud_mcp_mark_global_ws_disconnected(&state, &error).await;
            }
        }

        tokio::select! {
            _ = sleep(Duration::from_secs(2)) => {}
            _ = state.global_ws_reconnect.notified() => {}
        }
    }
}

fn cloud_mcp_voice_ws_kind(kind: &str) -> bool {
    kind.starts_with("voice_agent_")
}

fn cloud_mcp_log_voice_shared_ws(
    phase: &str,
    kind: &str,
    status: &str,
    reason: &str,
    details: Value,
) {
    log_voice_orchestrator_diagnostic_event(
        phase,
        json!({
            "source": "rust-diffforge",
            "surface": "voice_agent",
            "transport": "app_websocket",
            "kind": kind,
            "status": status,
            "reason": reason,
            "details": details,
        }),
    );
}

async fn cloud_mcp_open_global_ws(
    state: &CloudMcpState,
    base_url: &str,
    target: &CloudMcpWsTarget,
) -> Result<(), String> {
    cloud_mcp_record_signin_diagnostic(
        state,
        "websocket.open",
        "start",
        "opening Cloud MCP app websocket",
        json!({"ws_url": target.ws_url, "transport": target.transport}),
    )
    .await;
    cloud_mcp_record_connection_diagnostic(
        state,
        "rust.cloud_mcp.websocket.open",
        "start",
        "opening Cloud MCP app websocket",
        json!({
            "ws_url": target.ws_url,
            "transport": target.transport,
            "clientIdentity": "appwrite_account",
            "sourceClientId": CLOUD_MCP_RUST_CLIENT_ID,
            "hasDirectRouteHeader": target.route_token.is_some(),
        }),
    )
    .await;
    cloud_mcp_set_global_ws_phase(state, "authenticating", "authenticating").await;
    let auth_bearer = cloud_mcp_authorization_bearer(state).await?;
    let device_profile = cloud_mcp_desktop_device_profile();
    let device_id = cloud_mcp_payload_text(&device_profile, &["device_id", "deviceId"])
        .unwrap_or_else(|| "desktop-primary".to_string());
    let (billing_scope_type, team_id) = cloud_mcp_account_scope(state).await;
    let (plan_name, device_limit) = cloud_mcp_account_plan(state).await;
    let build_request = |target: &CloudMcpWsTarget| -> Result<
        tokio_tungstenite::tungstenite::http::Request<()>,
        String,
    > {
        let mut request = target
            .ws_url
            .as_str()
            .into_client_request()
            .map_err(|error| format!("Unable to create Cloud MCP websocket request: {error}"))?;
        request.headers_mut().insert(
            "x-diffforge-actor",
            HeaderValue::from_static(CLOUD_MCP_RUST_CLIENT_ID),
        );
        request.headers_mut().insert(
            "user-agent",
            HeaderValue::from_static(CLOUD_MCP_DESKTOP_USER_AGENT),
        );
        request.headers_mut().insert(
            "x-diffforge-device-id",
            HeaderValue::from_str(&device_id)
                .map_err(|error| format!("Invalid Cloud MCP device id header: {error}"))?,
        );
        request.headers_mut().insert(
            "x-diffforge-billing-scope-type",
            HeaderValue::from_str(&billing_scope_type)
                .map_err(|error| format!("Invalid Cloud MCP billing scope header: {error}"))?,
        );
        request.headers_mut().insert(
            "x-diffforge-scope-type",
            HeaderValue::from_str(&billing_scope_type)
                .map_err(|error| format!("Invalid Cloud MCP scope header: {error}"))?,
        );
        request.headers_mut().insert(
            "x-diffforge-plan-name",
            HeaderValue::from_str(&plan_name)
                .map_err(|error| format!("Invalid Cloud MCP plan header: {error}"))?,
        );
        if let Some(device_limit) = device_limit {
            request.headers_mut().insert(
                "x-diffforge-device-limit",
                HeaderValue::from_str(&device_limit.to_string())
                    .map_err(|error| format!("Invalid Cloud MCP device limit header: {error}"))?,
            );
        }
        if billing_scope_type == "team" {
            if let Some(team_id) = team_id.as_deref() {
                request.headers_mut().insert(
                    "x-diffforge-team-id",
                    HeaderValue::from_str(team_id)
                        .map_err(|error| format!("Invalid Cloud MCP team id header: {error}"))?,
                );
            }
        }
        if let Some(token) = auth_bearer.as_deref() {
            request.headers_mut().insert(
                "authorization",
                cloud_mcp_bearer_header(token, "Cloud MCP auth token")?,
            );
        }
        if let Some(route_token) = target.route_token.as_deref() {
            request.headers_mut().insert(
                "x-diffforge-direct-route-token",
                HeaderValue::from_str(route_token)
                    .map_err(|error| format!("Invalid Cloud MCP route token header: {error}"))?,
            );
        }
        Ok(request)
    };

    cloud_mcp_set_global_ws_phase(state, "opening_websocket", "opening_websocket").await;
    let mut opened_target = target.clone();
    let request = build_request(&opened_target)?;
    let (stream, response) = match connect_async(request).await {
        Ok(result) => result,
        Err(error)
            if opened_target.route_token.is_some()
                || opened_target.transport == "local_docker_cloud" =>
        {
            let direct_message = format!("Unable to open Cloud MCP app websocket: {error}");
            cloud_mcp_record_connection_diagnostic(
                state,
                "rust.cloud_mcp.websocket.open",
                "warn",
                "Selected Cloud MCP app websocket failed; retrying through balancer.",
                json!({
                    "ws_url": opened_target.ws_url,
                    "transport": opened_target.transport,
                    "clientIdentity": "appwrite_account",
                    "sourceClientId": CLOUD_MCP_RUST_CLIENT_ID,
                    "hasDirectRouteHeader": opened_target.route_token.is_some(),
                    "directError": clean_terminal_telemetry_text(&direct_message),
                }),
            )
            .await;
            let fallback = cloud_mcp_fallback_ws_target(base_url, "/v1/app/ws");
            let fallback_request = build_request(&fallback)?;
            match connect_async(fallback_request).await {
                Ok(result) => {
                    opened_target = fallback;
                    result
                }
                Err(fallback_error) => {
                    let message = format!(
                        "{direct_message}; fallback via balancer also failed: {fallback_error}"
                    );
                    cloud_mcp_record_signin_diagnostic(
                        state,
                        "websocket.open",
                        "error",
                        &message,
                        json!({"ws_url": opened_target.ws_url, "transport": opened_target.transport}),
                    )
                    .await;
                    cloud_mcp_record_connection_diagnostic(
                        state,
                        "rust.cloud_mcp.websocket.open",
                        "error",
                        &message,
                        json!({
                            "ws_url": opened_target.ws_url,
                            "transport": opened_target.transport,
                            "clientIdentity": "appwrite_account",
                            "sourceClientId": CLOUD_MCP_RUST_CLIENT_ID,
                            "hasDirectRouteHeader": true,
                            "fallbackTransport": "balancer_proxy",
                        }),
                    )
                    .await;
                    return Err(message);
                }
            }
        }
        Err(error) => {
            let message = format!("Unable to open Cloud MCP app websocket: {error}");
            cloud_mcp_record_signin_diagnostic(
                state,
                "websocket.open",
                "error",
                &message,
                json!({"ws_url": target.ws_url, "transport": target.transport}),
            )
            .await;
            cloud_mcp_record_connection_diagnostic(
                state,
                "rust.cloud_mcp.websocket.open",
                "error",
                &message,
                json!({
                    "ws_url": target.ws_url,
                    "transport": target.transport,
                    "clientIdentity": "appwrite_account",
                    "sourceClientId": CLOUD_MCP_RUST_CLIENT_ID,
                    "hasDirectRouteHeader": target.route_token.is_some(),
                }),
            )
            .await;
            return Err(message);
        }
    };
    cloud_mcp_record_signin_diagnostic(
        state,
        "websocket.open",
        "ok",
        "Cloud MCP app websocket opened",
        json!({
            "ws_url": opened_target.ws_url,
            "transport": opened_target.transport,
            "http_status": response.status().as_u16()
        }),
    )
    .await;
    cloud_mcp_record_connection_diagnostic(
        state,
        "rust.cloud_mcp.websocket.open",
        "ok",
        "Cloud MCP app websocket opened",
        json!({
            "ws_url": opened_target.ws_url,
            "transport": opened_target.transport,
            "http_status": response.status().as_u16(),
            "clientIdentity": "appwrite_account",
            "sourceClientId": CLOUD_MCP_RUST_CLIENT_ID,
            "hasDirectRouteHeader": opened_target.route_token.is_some(),
        }),
    )
    .await;
    let (mut write, mut read) = stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    let ws_epoch = state.global_ws_epoch.fetch_add(1, Ordering::SeqCst) + 1;
    cloud_mcp_log_voice_shared_ws(
        "voice_agent.shared_ws.epoch_opened",
        "manager",
        "start",
        "Rust opened a new active shared app websocket epoch.",
        json!({
            "epoch": ws_epoch,
            "transport": opened_target.transport,
            "ws_url": opened_target.ws_url,
        }),
    );
    {
        let mut tx_slot = state.global_ws_tx.lock().await;
        *tx_slot = Some(tx.clone());
    }
    drop(tx);
    {
        let mut runtime = state.inner.lock().await;
        runtime.connected = false;
        runtime.status = "websocket_handshaking".to_string();
        runtime.global_ws_connected = false;
        runtime.global_ws_status = "handshaking".to_string();
        runtime.global_ws_connection_id = None;
        runtime.global_ws_message_token = None;
        runtime.live_runtime_status = None;
    }

    let ready_timeout = sleep(Duration::from_secs(CLOUD_MCP_WS_READY_TIMEOUT_SECS));
    tokio::pin!(ready_timeout);
    let mut ready_seen = false;
    let result: Result<(), String> = loop {
        tokio::select! {
            biased;
            _ = &mut ready_timeout, if !ready_seen => {
                break Err(format!(
                    "Cloud MCP app websocket did not send a ready frame within {} seconds.",
                    CLOUD_MCP_WS_READY_TIMEOUT_SECS
                ));
            }
            incoming = read.next() => {
                let Some(incoming) = incoming else {
                    break Err("Cloud MCP app websocket closed by server.".to_string());
                };
                match incoming {
                    Ok(Message::Text(text)) => cloud_mcp_handle_global_ws_message(state, text.as_str()).await,
                    Ok(Message::Binary(bytes)) => {
                        if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                            cloud_mcp_handle_global_ws_message(state, &text).await;
                        }
                    }
                    Ok(Message::Ping(payload)) => {
                        if let Err(error) = write
                            .send(Message::Pong(payload))
                            .await
                        {
                            break Err(format!("Cloud MCP app websocket pong failed: {error}"));
                        }
                    }
                    Ok(Message::Close(_)) => break Err("Cloud MCP app websocket closed.".to_string()),
                    Err(error) => break Err(format!("Cloud MCP app websocket read failed: {error}")),
                    _ => {}
                }
                if !ready_seen {
                    let runtime = state.inner.lock().await;
                    ready_seen = runtime.global_ws_connected
                        && runtime.global_ws_connection_id.is_some()
                        && runtime.global_ws_message_token.is_some();
                }
            }
            outgoing = rx.recv() => {
                let Some(outgoing) = outgoing else {
                    break Err("Cloud MCP app websocket outgoing sender closed.".to_string());
                };
                let outgoing_kind = outgoing
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let outgoing_id = outgoing
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if cloud_mcp_voice_ws_kind(&outgoing_kind) {
                    cloud_mcp_log_voice_shared_ws(
                        "voice_agent.shared_ws.write_started",
                        &outgoing_kind,
                        "start",
                        "Rust websocket writer is sending a voice frame to cloud.",
                        json!({
                            "epoch": ws_epoch,
                            "id": outgoing_id,
                            "repo_id": outgoing.get("repo_id").cloned().unwrap_or(Value::Null),
                            "workspace_id": outgoing.get("workspace_id").cloned().unwrap_or(Value::Null),
                            "request_kind": outgoing.get("request").and_then(|request| request.get("kind")).cloned().unwrap_or(Value::Null),
                            "voice_session_id": outgoing.get("request").and_then(|request| request.get("voice_session_id").or_else(|| request.get("voiceSessionId"))).cloned().unwrap_or(Value::Null),
                        }),
                    );
                }
                if let Err(error) = write
                    .send(Message::Text(outgoing.to_string().into()))
                    .await
                {
                    break Err(format!("Cloud MCP app websocket write failed: {error}"));
                }
                if cloud_mcp_voice_ws_kind(&outgoing_kind) {
                    cloud_mcp_log_voice_shared_ws(
                        "voice_agent.shared_ws.write_finished",
                        &outgoing_kind,
                        "ok",
                        "Rust websocket writer sent a voice frame to cloud.",
                        json!({
                            "epoch": ws_epoch,
                            "id": outgoing_id,
                        }),
                    );
                }
            }
        }
    };

    cloud_mcp_clear_global_ws_sender_if_current(state, ws_epoch, result.as_ref().err()).await;
    result
}

async fn cloud_mcp_clear_global_ws_sender_if_current(
    state: &CloudMcpState,
    ws_epoch: u64,
    error: Option<&String>,
) {
    let cleared = if state.global_ws_epoch.load(Ordering::SeqCst) == ws_epoch {
        let mut tx_slot = state.global_ws_tx.lock().await;
        *tx_slot = None;
        true
    } else {
        false
    };

    if !cleared {
        return;
    }

    if state.global_ws_registration_blocked.load(Ordering::SeqCst) {
        let message = {
            let runtime = state.inner.lock().await;
            let primary = runtime.global_ws_last_error.trim();
            let fallback = runtime.last_error.trim();
            if !primary.is_empty() {
                primary.to_string()
            } else if !fallback.is_empty() {
                fallback.to_string()
            } else {
                "Device limit reached.".to_string()
            }
        };
        cloud_mcp_fail_pending_ws_requests(state, &message).await;
        return;
    }

    let message = error
        .map(|value| clean_terminal_telemetry_text(value))
        .unwrap_or_else(|| "Cloud MCP app websocket disconnected.".to_string());
    cloud_mcp_log_voice_shared_ws(
        "voice_agent.shared_ws.epoch_closed",
        "manager",
        "warn",
        "Rust shared app websocket epoch ended.",
        json!({
            "epoch": ws_epoch,
            "error": message.clone(),
        }),
    );
    {
        let mut runtime = state.inner.lock().await;
        runtime.connected = false;
        runtime.status = "websocket_retrying".to_string();
        runtime.last_error = format!("Cloud MCP websocket unavailable: {message}");
        runtime.global_ws_connected = false;
        runtime.global_ws_status = "retrying".to_string();
        runtime.global_ws_last_error = message.clone();
        runtime.global_ws_connection_id = None;
        runtime.global_ws_message_token = None;
        runtime.live_runtime_status = None;
    }
    cloud_mcp_fail_pending_ws_requests(state, &message).await;
}

async fn cloud_mcp_mark_global_ws_disconnected(state: &CloudMcpState, error: &str) {
    if state.global_ws_registration_blocked.load(Ordering::SeqCst) {
        return;
    }
    let message = clean_terminal_telemetry_text(error);
    state.global_ws_epoch.fetch_add(1, Ordering::SeqCst);
    {
        let mut runtime = state.inner.lock().await;
        runtime.connected = false;
        runtime.status = "websocket_retrying".to_string();
        runtime.last_error = format!("Cloud MCP websocket unavailable: {message}");
        runtime.global_ws_connected = false;
        runtime.global_ws_status = "retrying".to_string();
        runtime.global_ws_last_error = message.clone();
        runtime.global_ws_connection_id = None;
        runtime.global_ws_message_token = None;
        runtime.live_runtime_status = None;
    }
    let _ = state.global_ws_tx.lock().await.take();
    cloud_mcp_fail_pending_ws_requests(state, &message).await;
    state.global_ws_reconnect.notify_waiters();
}

fn cloud_mcp_registration_blocked_error(message: &Value) -> Option<(String, Value)> {
    if message.get("kind").and_then(Value::as_str) != Some("error")
        && message.get("ok").and_then(Value::as_bool) != Some(false)
    {
        return None;
    }
    let error = message.get("error").unwrap_or(&Value::Null);
    let code = cloud_mcp_payload_text(error, &["code"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(
        code.as_str(),
        "device_limit_reached" | "device_limit_exceeded"
    ) {
        return None;
    }
    let details = error.get("details").cloned().unwrap_or(Value::Null);
    let mut text = cloud_mcp_payload_text(error, &["message"]).unwrap_or_else(|| {
        "Device limit reached. Open the Diff Forge dashboard and remove a registered device, then reconnect the Rust client.".to_string()
    });
    if let Some(dashboard_url) =
        cloud_mcp_payload_text(&details, &["dashboard_url", "dashboardUrl"])
    {
        if !text.contains(&dashboard_url) {
            text = format!("{text} Dashboard: {dashboard_url}");
        }
    }
    Some((text, details))
}

fn cloud_mcp_error_text_is_device_limit(error: &str) -> bool {
    let error = error.to_ascii_lowercase();
    error.contains("device_limit_reached")
        || error.contains("device_limit_exceeded")
        || error.contains("device limit reached")
}

async fn cloud_mcp_mark_registration_blocked(
    state: &CloudMcpState,
    message: String,
    details: Value,
) {
    let message = clean_terminal_telemetry_text(&message);
    state
        .global_ws_registration_blocked
        .store(true, Ordering::SeqCst);
    state.global_ws_epoch.fetch_add(1, Ordering::SeqCst);
    {
        let mut runtime = state.inner.lock().await;
        runtime.connected = false;
        runtime.status = "device_limit_reached".to_string();
        runtime.last_error = message.clone();
        runtime.global_ws_connected = false;
        runtime.global_ws_status = "device_limit_reached".to_string();
        runtime.global_ws_last_error = message.clone();
        runtime.global_ws_connection_id = None;
        runtime.global_ws_message_token = None;
        runtime.live_runtime_status = None;
    }
    let _ = state.global_ws_tx.lock().await.take();
    cloud_mcp_fail_pending_ws_requests(state, &message).await;
    cloud_mcp_record_connection_diagnostic(
        state,
        "rust.cloud_mcp.device_registration",
        "error",
        &message,
        details,
    )
    .await;
    state.global_ws_reconnect.notify_waiters();
}

async fn cloud_mcp_handle_global_ws_message(state: &CloudMcpState, text: &str) {
    let Ok(message) = serde_json::from_str::<Value>(text) else {
        return;
    };
    if let Some((error_message, details)) = cloud_mcp_registration_blocked_error(&message) {
        cloud_mcp_mark_registration_blocked(state, error_message, details).await;
        return;
    }
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
            drop(runtime);
            cloud_mcp_record_signin_diagnostic(
                state,
                "websocket.ready",
                "error",
                "Cloud MCP app websocket ready message omitted message auth.",
                json!({}),
            )
            .await;
            cloud_mcp_record_connection_diagnostic(
                state,
                "rust.cloud_mcp.websocket.ready",
                "error",
                "Cloud MCP app websocket ready message omitted message auth.",
                json!({
                    "clientIdentity": "appwrite_account",
                    "sourceClientId": CLOUD_MCP_RUST_CLIENT_ID,
                }),
            )
            .await;
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
            runtime.live_runtime_status = message
                .get("initial_live_runtime")
                .cloned()
                .filter(|value| !value.is_null());
        }
        cloud_mcp_record_signin_diagnostic(
            state,
            "websocket.ready",
            "ok",
            "Cloud MCP app websocket ready frame received",
            json!({"connection_id": connection_id.clone()}),
        )
        .await;
        cloud_mcp_record_connection_diagnostic(
            state,
            "rust.cloud_mcp.websocket.ready",
            "ok",
            "Cloud MCP app websocket ready frame received",
            json!({
                "connection_id": connection_id.clone(),
                "clientIdentity": "appwrite_account",
                "helloClientId": CLOUD_MCP_RUST_CLIENT_ID,
            }),
        )
        .await;
        let device_profile = cloud_mcp_desktop_device_profile();
        let (plan_name, device_limit) = cloud_mcp_account_plan(state).await;
        let connection_epoch = state.global_ws_epoch.load(Ordering::SeqCst);
        let hello = json!({
            "kind": "hello",
            "id": format!("hello-{}", cloud_mcp_now_ms()),
            "client_id": CLOUD_MCP_RUST_CLIENT_ID,
            "source": "rust-diffforge",
            "connection_epoch": connection_epoch,
            "device": device_profile.clone(),
            "device_id": device_profile["device_id"].clone(),
            "device_name": device_profile["device_name"].clone(),
            "machine_name": device_profile["machine_name"].clone(),
            "platform": device_profile["platform"].clone(),
            "form_factor": device_profile["form_factor"].clone(),
            "client_kind": device_profile["client_kind"].clone(),
            "client_type": device_profile["client_type"].clone(),
            "connection_source": device_profile["connection_source"].clone(),
            "plan_name": plan_name,
            "device_limit": device_limit,
            "contract": "diffforge.app_ws.v1",
            "auth": {
                "connection_id": connection_id.clone(),
                "message_token": message_token.clone(),
            },
            "workspaces": cloud_mcp_lifecycle_workspaces(state).await,
        });
        if let Some(tx) = state.global_ws_tx.lock().await.as_ref().cloned() {
            let _ = tx.send(hello);
        }
        let _ = cloud_mcp_send_lifecycle_event(
            state,
            "desktop_client_online",
            "connected",
            Some("websocket_ready"),
        )
        .await;
        let _ = cloud_mcp_send_device_workspace_snapshot_event_with_auth(
            state,
            &connection_id,
            &message_token,
            "websocket_ready",
        )
        .await;
        cloud_mcp_replay_runtime_snapshots(state, &connection_id, &message_token).await;
        return;
    }
    if let Some(id) = message.get("id").and_then(Value::as_str) {
        if let Some(sender) = state.global_ws_pending.lock().await.remove(id) {
            let _ = sender.send(message);
            return;
        }
    }
    if message.get("kind").and_then(Value::as_str) == Some("cloud_event") {
        // The graph/spec sync loops still own local cache materialization.
        // This global channel is the durable wake signal shared by every workspace.
        let event = message
            .get("event")
            .cloned()
            .unwrap_or_else(|| message.clone());
        let event_kind = event
            .get("event_kind")
            .or_else(|| event.get("eventKind"))
            .or_else(|| event.get("kind"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let live_runtime_snapshot = if event_kind == "live_runtime_snapshot" {
            event.get("data").cloned().filter(|value| !value.is_null())
        } else {
            None
        };
        if event_kind.starts_with("voice_agent_") {
            cloud_mcp_log_voice_shared_ws(
                "voice_agent.shared_ws.event_received",
                &event_kind,
                "received",
                "Rust websocket reader received a voice event from cloud.",
                json!({
                    "repo_id": event.get("repo_id").or_else(|| event.get("repoId")).cloned().unwrap_or(Value::Null),
                    "workspace_id": event.get("workspace_id").or_else(|| event.get("workspaceId")).cloned().unwrap_or(Value::Null),
                    "voice_session_id": event.get("voice_session_id").or_else(|| event.get("voiceSessionId")).cloned().unwrap_or(Value::Null),
                }),
            );
        }
        if matches!(
            event_kind.as_str(),
            "client_liveness_ping" | "dashboard_liveness_ping"
        ) {
            let _ = cloud_mcp_send_liveness_pong_event(state, &event).await;
        }
        {
            let mut runtime = state.inner.lock().await;
            runtime.connected = true;
            runtime.status = "connected".to_string();
            runtime.global_ws_connected = true;
            runtime.global_ws_status = "connected".to_string();
            runtime.global_ws_last_connected_ms = Some(cloud_mcp_now_ms());
            if let Some(data) = live_runtime_snapshot {
                runtime.live_runtime_status = Some(data);
            }
        }
        let _ = state.global_ws_events.send(event);
    }
}

async fn cloud_mcp_send_liveness_pong_event(
    state: &CloudMcpState,
    event: &Value,
) -> Result<(), String> {
    let received_ms = cloud_mcp_now_ms();
    let ping_id = cloud_mcp_payload_text(event, &["ping_id"])
        .or_else(|| cloud_mcp_payload_text(event, &["pingId"]))
        .or_else(|| cloud_mcp_payload_text(event, &["payload", "ping_id"]))
        .or_else(|| cloud_mcp_payload_text(event, &["payload", "pingId"]))
        .unwrap_or_else(|| format!("rust-liveness-{received_ms}"));
    let snapshot = cloud_mcp_status_snapshot(state).await;
    let sent_ms = cloud_mcp_now_ms();
    let auth = cloud_mcp_ws_auth_object(state).await?;
    let device_profile = cloud_mcp_desktop_device_profile();
    let payload = json!({
        "source": "rust-diffforge-liveness",
        "event_kind": "desktop_liveness_pong",
        "agent_id": "rust-diffforge",
        "agent_label": "Diff Forge Desktop",
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "platform": device_profile["platform"].clone(),
        "form_factor": device_profile["form_factor"].clone(),
        "client_kind": device_profile["client_kind"].clone(),
        "client_type": device_profile["client_type"].clone(),
        "connection_source": device_profile["connection_source"].clone(),
        "ping_id": ping_id,
        "repo_id": cloud_mcp_payload_text(event, &["repo_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["repoId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "repo_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "repoId"])),
        "workspace_id": cloud_mcp_payload_text(event, &["workspace_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["workspaceId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "workspace_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "workspaceId"])),
        "origin_connection_id": cloud_mcp_payload_text(event, &["origin_connection_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["originConnectionId"])),
        "browser_sent_ms": cloud_mcp_payload_u64(event, &["browser_sent_ms"])
            .or_else(|| cloud_mcp_payload_u64(event, &["browserSentMs"]))
            .or_else(|| cloud_mcp_payload_u64(event, &["payload", "browser_sent_ms"]))
            .or_else(|| cloud_mcp_payload_u64(event, &["payload", "browserSentMs"])),
        "cloud_received_ms": cloud_mcp_payload_u64(event, &["cloud_received_ms"])
            .or_else(|| cloud_mcp_payload_u64(event, &["cloudReceivedMs"]))
            .or_else(|| cloud_mcp_payload_u64(event, &["payload", "cloud_received_ms"]))
            .or_else(|| cloud_mcp_payload_u64(event, &["payload", "cloudReceivedMs"])),
        "cloud_sent_ms": cloud_mcp_payload_u64(event, &["cloud_sent_ms"])
            .or_else(|| cloud_mcp_payload_u64(event, &["cloudSentMs"]))
            .or_else(|| cloud_mcp_payload_u64(event, &["payload", "cloud_sent_ms"]))
            .or_else(|| cloud_mcp_payload_u64(event, &["payload", "cloudSentMs"])),
        "rust_received_ms": received_ms,
        "rust_sent_ms": sent_ms,
        "rust_elapsed_ms": sent_ms.saturating_sub(received_ms),
        "registered_workspace_count": snapshot.registered_workspaces.len(),
        "global_ws_connected": snapshot.global_ws_connected,
        "status": "connected",
        "ts_ms": sent_ms,
    });
    let request = cloud_mcp_event_envelope("desktop_liveness_pong", &payload);
    let envelope = json!({
        "kind": "event",
        "id": format!("liveness-pong-{}-{}", sent_ms, uuid::Uuid::new_v4()),
        "contract": "diffforge.app_ws.v1",
        "auth": auth,
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "repo_id": cloud_mcp_payload_text(&request, &["repo_id"])
            .or_else(|| cloud_mcp_payload_text(&request, &["payload", "repo_id"])),
        "workspace_id": cloud_mcp_payload_text(&request, &["workspace_id"])
            .or_else(|| cloud_mcp_payload_text(&request, &["payload", "workspace_id"])),
        "request": request,
    });
    let Some(tx) = state.global_ws_tx.lock().await.as_ref().cloned() else {
        return Err("Cloud MCP app websocket is not connected.".to_string());
    };
    tx.send(envelope)
        .map_err(|_| "Cloud MCP app websocket sender is closed.".to_string())
}

async fn cloud_mcp_send_lifecycle_event(
    state: &CloudMcpState,
    event_kind: &str,
    status: &str,
    reason: Option<&str>,
) -> Result<Value, String> {
    let now = cloud_mcp_now_ms();
    let connection_epoch = state.global_ws_epoch.load(Ordering::SeqCst);
    let snapshot = cloud_mcp_status_snapshot(state).await;
    let auth = cloud_mcp_ws_auth_object(state).await?;
    let device_profile = cloud_mcp_desktop_device_profile();
    let payload = json!({
        "source": "rust-diffforge-lifecycle",
        "event_kind": event_kind,
        "agent_id": "rust-diffforge",
        "agent_label": "Diff Forge Desktop",
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "platform": device_profile["platform"].clone(),
        "form_factor": device_profile["form_factor"].clone(),
        "client_kind": device_profile["client_kind"].clone(),
        "client_type": device_profile["client_type"].clone(),
        "connection_source": device_profile["connection_source"].clone(),
        "reason": reason.unwrap_or(status),
        "status": status,
        "connection_epoch": connection_epoch,
        "registered_workspace_count": snapshot.registered_workspace_count,
        "global_ws_connected": snapshot.global_ws_connected,
        "workspaces": cloud_mcp_lifecycle_workspaces(state).await,
        "ts_ms": now,
    });
    let request = cloud_mcp_event_envelope(event_kind, &payload);
    let envelope = json!({
        "kind": "event",
        "id": format!("desktop-lifecycle-{}-{}", now, uuid::Uuid::new_v4()),
        "contract": "diffforge.app_ws.v1",
        "auth": auth,
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "repo_id": cloud_mcp_payload_text(&request, &["repo_id"])
            .or_else(|| cloud_mcp_payload_text(&request, &["payload", "repo_id"])),
        "workspace_id": cloud_mcp_payload_text(&request, &["workspace_id"])
            .or_else(|| cloud_mcp_payload_text(&request, &["payload", "workspace_id"])),
        "request": request,
    });
    let Some(tx) = state.global_ws_tx.lock().await.as_ref().cloned() else {
        return Err("Cloud MCP app websocket is not connected.".to_string());
    };
    tx.send(envelope)
        .map_err(|_| "Cloud MCP app websocket sender is closed.".to_string())?;

    Ok(json!({
        "ok": true,
        "sent": true,
        "event_kind": event_kind,
        "status": status,
        "ts_ms": now,
    }))
}

fn cloud_mcp_remote_command_matches_device(event: &Value) -> bool {
    let Some(target_device_id) = cloud_mcp_payload_text(event, &["target_device_id"])
        .or_else(|| cloud_mcp_payload_text(event, &["targetDeviceId"]))
        .or_else(|| cloud_mcp_payload_text(event, &["payload", "target_device_id"]))
        .or_else(|| cloud_mcp_payload_text(event, &["payload", "targetDeviceId"]))
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
    else {
        return true;
    };
    let device = cloud_mcp_desktop_device_profile();
    [
        cloud_mcp_payload_text(&device, &["device_id"]),
        cloud_mcp_payload_text(&device, &["deviceId"]),
        cloud_mcp_payload_text(&device, &["machine_name"]),
        cloud_mcp_payload_text(&device, &["machineName"]),
        cloud_mcp_payload_text(&device, &["device_name"]),
        cloud_mcp_payload_text(&device, &["deviceName"]),
    ]
    .into_iter()
    .flatten()
    .map(|value| value.trim().to_lowercase())
    .any(|value| value == target_device_id)
}

fn cloud_mcp_remote_command_receipt_key(event: &Value) -> Option<String> {
    let command_id = cloud_mcp_payload_text(event, &["command_id"])
        .or_else(|| cloud_mcp_payload_text(event, &["commandId"]))
        .or_else(|| cloud_mcp_payload_text(event, &["payload", "command_id"]))
        .or_else(|| cloud_mcp_payload_text(event, &["payload", "commandId"]))?
        .trim()
        .to_string();
    if command_id.is_empty() {
        return None;
    }

    let client_id = cloud_mcp_payload_text(event, &["client_id"])
        .or_else(|| cloud_mcp_payload_text(event, &["clientId"]))
        .unwrap_or_default();
    let workspace_id = cloud_mcp_payload_text(event, &["workspace_id"])
        .or_else(|| cloud_mcp_payload_text(event, &["workspaceId"]))
        .or_else(|| cloud_mcp_payload_text(event, &["payload", "workspace_id"]))
        .or_else(|| cloud_mcp_payload_text(event, &["payload", "workspaceId"]))
        .unwrap_or_default();
    Some(format!(
        "{}::{}::{}",
        client_id.trim(),
        workspace_id.trim(),
        command_id
    ))
}

async fn cloud_mcp_claim_remote_command_receipt(state: &CloudMcpState, event: &Value) -> bool {
    let Some(receipt_key) = cloud_mcp_remote_command_receipt_key(event) else {
        return true;
    };

    let now = cloud_mcp_now_ms();
    let mut receipts = state.remote_command_receipts.lock().await;
    receipts.retain(|_, received_ms| {
        now.saturating_sub(*received_ms) <= CLOUD_MCP_REMOTE_COMMAND_RECEIPT_TTL_MS
    });
    if receipts.contains_key(&receipt_key) {
        return false;
    }
    if receipts.len() >= CLOUD_MCP_REMOTE_COMMAND_RECEIPT_MAX {
        if let Some(oldest_key) = receipts
            .iter()
            .min_by_key(|(_, received_ms)| *received_ms)
            .map(|(key, _)| key.clone())
        {
            receipts.remove(&oldest_key);
        }
    }
    receipts.insert(receipt_key, now);
    true
}

async fn cloud_mcp_send_remote_command_status_event(
    state: &CloudMcpState,
    event: &Value,
    status: &str,
    message: &str,
    details: Option<&Value>,
) -> Result<Value, String> {
    let now = cloud_mcp_now_ms();
    let auth = cloud_mcp_ws_auth_object(state).await?;
    let device_profile = cloud_mcp_desktop_device_profile();
    let target_terminal_nickname = cloud_mcp_terminal_nickname_text(
        event,
        &[
            "target_terminal_nickname",
            "targetTerminalNickname",
            "terminal_nickname",
            "terminalNickname",
            "target_terminal_name",
            "targetTerminalName",
            "terminal_name",
            "terminalName",
            "target_name",
            "targetName",
            "name",
        ],
    )
    .or_else(|| {
        event.get("payload").and_then(|payload| {
            cloud_mcp_terminal_nickname_text(
                payload,
                &[
                    "target_terminal_nickname",
                    "targetTerminalNickname",
                    "terminal_nickname",
                    "terminalNickname",
                    "target_terminal_name",
                    "targetTerminalName",
                    "terminal_name",
                    "terminalName",
                    "target_name",
                    "targetName",
                    "name",
                ],
            )
        })
    });
    let status_kind = if matches!(
        status,
        "blocked" | "completed" | "failed" | "rejected" | "cancelled" | "canceled"
            | "paused" | "parked" | "resume_ready" | "resume_requested" | "interrupted"
            | "timed_out" | "timeout"
    ) {
        "remote_command_result"
    } else {
        "remote_command_ack"
    };
    let mut payload = json!({
        "source": "rust-diffforge-remote-control",
        "event_kind": status_kind,
        "command_id": cloud_mcp_payload_text(event, &["command_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["commandId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "command_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "commandId"])),
        "todo_dispatch_id": cloud_mcp_payload_text(event, &["todo_dispatch_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["todoDispatchId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "todo_dispatch_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "todoDispatchId"])),
        "todoDispatchId": cloud_mcp_payload_text(event, &["todo_dispatch_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["todoDispatchId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "todo_dispatch_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "todoDispatchId"])),
        "todo_id": cloud_mcp_payload_text(event, &["todo_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["todoId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "todo_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "todoId"])),
        "todo_workspace_id": cloud_mcp_payload_text(event, &["todo_workspace_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["todoWorkspaceId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "todo_workspace_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "todoWorkspaceId"])),
        "todo_device_id": cloud_mcp_payload_text(event, &["todo_device_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["todoDeviceId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "todo_device_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "todoDeviceId"])),
        "command_kind": cloud_mcp_payload_text(event, &["command_kind"])
            .or_else(|| cloud_mcp_payload_text(event, &["commandKind"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "command_kind"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "commandKind"])),
        "target_agent_id": cloud_mcp_payload_text(event, &["target_agent_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["targetAgentId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "target_agent_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "targetAgentId"])),
        "target_device_id": cloud_mcp_payload_text(event, &["target_device_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["targetDeviceId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "target_device_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "targetDeviceId"])),
        "target_terminal_id": cloud_mcp_payload_text(event, &["target_terminal_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["targetTerminalId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["terminal_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["terminalId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["pane_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["paneId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "target_terminal_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "targetTerminalId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "terminal_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "terminalId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "pane_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "paneId"])),
        "target_terminal_nickname": target_terminal_nickname.clone(),
        "targetTerminalNickname": target_terminal_nickname.clone(),
        "target_terminal_name": target_terminal_nickname.clone(),
        "targetTerminalName": target_terminal_nickname,
        "target_terminal_index": cloud_mcp_payload_text(event, &["target_terminal_index"])
            .or_else(|| cloud_mcp_payload_text(event, &["targetTerminalIndex"]))
            .or_else(|| cloud_mcp_payload_text(event, &["terminal_index"]))
            .or_else(|| cloud_mcp_payload_text(event, &["terminalIndex"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "target_terminal_index"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "targetTerminalIndex"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "terminal_index"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "terminalIndex"])),
        "target_thread_id": cloud_mcp_payload_text(event, &["target_thread_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["targetThreadId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["thread_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["threadId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "target_thread_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "targetThreadId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "thread_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "threadId"])),
        "target_terminal_color": cloud_mcp_payload_text(event, &["target_terminal_color"])
            .or_else(|| cloud_mcp_payload_text(event, &["targetTerminalColor"]))
            .or_else(|| cloud_mcp_payload_text(event, &["terminal_color"]))
            .or_else(|| cloud_mcp_payload_text(event, &["terminalColor"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "target_terminal_color"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "targetTerminalColor"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "terminal_color"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "terminalColor"])),
        "target_color_slot": cloud_mcp_payload_text(event, &["target_color_slot"])
            .or_else(|| cloud_mcp_payload_text(event, &["targetColorSlot"]))
            .or_else(|| cloud_mcp_payload_text(event, &["color_slot"]))
            .or_else(|| cloud_mcp_payload_text(event, &["colorSlot"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "target_color_slot"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "targetColorSlot"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "color_slot"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "colorSlot"])),
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "origin_connection_id": cloud_mcp_payload_text(event, &["origin_connection_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["originConnectionId"])),
        "repo_id": cloud_mcp_payload_text(event, &["repo_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["repoId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "repo_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "repoId"])),
        "workspace_id": cloud_mcp_payload_text(event, &["workspace_id"])
            .or_else(|| cloud_mcp_payload_text(event, &["workspaceId"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "workspace_id"]))
            .or_else(|| cloud_mcp_payload_text(event, &["payload", "workspaceId"])),
        "status": status,
        "message": message,
        "rust_received_ms": now,
        "ts_ms": now,
    });
    if let Some(dispatch_source) = cloud_mcp_payload_object(event, &["dispatch_source", "dispatchSource"])
        .or_else(|| {
            event.get("payload").and_then(|payload| {
                cloud_mcp_payload_object(payload, &["dispatch_source", "dispatchSource"])
            })
        })
    {
        payload["dispatch_source"] = dispatch_source.clone();
        payload["dispatchSource"] = dispatch_source;
    }
    if let Some(dispatch_target) = cloud_mcp_payload_object(event, &["dispatch_target", "dispatchTarget"])
        .or_else(|| {
            event.get("payload").and_then(|payload| {
                cloud_mcp_payload_object(payload, &["dispatch_target", "dispatchTarget"])
            })
        })
    {
        payload["dispatch_target"] = dispatch_target.clone();
        payload["dispatchTarget"] = dispatch_target;
    }
    if let Some(details) = details {
        if !details.is_null() {
            payload["details"] = details.clone();
            payload["result"] = details.clone();
        }
    }
    let request = cloud_mcp_event_envelope(status_kind, &payload);
    let envelope = json!({
        "kind": "event",
        "id": format!("remote-command-status-{}-{}", now, uuid::Uuid::new_v4()),
        "contract": "diffforge.app_ws.v1",
        "auth": auth,
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "repo_id": cloud_mcp_payload_text(&request, &["repo_id"])
            .or_else(|| cloud_mcp_payload_text(&request, &["payload", "repo_id"])),
        "workspace_id": cloud_mcp_payload_text(&request, &["workspace_id"])
            .or_else(|| cloud_mcp_payload_text(&request, &["payload", "workspace_id"])),
        "request": request,
    });
    let Some(tx) = state.global_ws_tx.lock().await.as_ref().cloned() else {
        return Err("Cloud MCP app websocket is not connected.".to_string());
    };
    tx.send(envelope)
        .map_err(|_| "Cloud MCP app websocket sender is closed.".to_string())?;
    if cloud_mcp_payload_text(&payload, &["todo_dispatch_id", "todoDispatchId"]).is_some() {
        let _ =
            cloud_mcp_post_event_endpoint(state, "workspace_todo_dispatch_status", &payload).await;
    }
    Ok(json!({"ok": true, "sent": true, "status": status}))
}

#[tauri::command]
async fn cloud_mcp_start_remote_command_listener(
    app: AppHandle,
    state: State<'_, CloudMcpState>,
) -> Result<Value, String> {
    if state
        .remote_command_listener_started
        .swap(true, Ordering::SeqCst)
    {
        return Ok(json!({"ok": true, "already_running": true}));
    }

    let state_clone = state.inner().clone();
    cloud_mcp_start_global_ws(&state_clone).await;
    let mut ws_events = state.global_ws_events.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            if crate::app_shutdown_requested() {
                break;
            }
            let event = match ws_events.recv().await {
                Ok(event) => event,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            };
            let event_kind = cloud_mcp_payload_text(&event, &["event_kind"])
                .or_else(|| cloud_mcp_payload_text(&event, &["eventKind"]))
                .or_else(|| cloud_mcp_payload_text(&event, &["kind"]))
                .unwrap_or_default();
            if event_kind.starts_with("credit_wallet_") {
                let _ = app.emit(CLOUD_MCP_CREDIT_WALLET_EVENT, event.clone());
                continue;
            }
            if event_kind == "tokenomics_refresh_requested" {
                let _ = app.emit(CLOUD_MCP_TOKENOMICS_REFRESH_EVENT, event.clone());
                continue;
            }
            if event_kind == "device_deleted" || event_kind == "device.removed" {
                if cloud_mcp_remote_command_matches_device(&event) {
                    let _ = app.emit(CLOUD_MCP_DEVICE_DELETED_EVENT, event.clone());
                }
                continue;
            }
            if cloud_mcp_is_tokenomics_state_event(&event_kind) {
                if let Err(error) = tokenomics_record_cloud_account_state(&app, &event) {
                    eprintln!("Unable to cache cloud Tokenomics state: {error}");
                }
                let _ = app.emit(CLOUD_MCP_TOKENOMICS_REFRESH_EVENT, event.clone());
                continue;
            }
            if cloud_mcp_is_workspace_todo_wake_event(&event_kind, &event) {
                let _ = app.emit(CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT, event.clone());
                if event_kind != "remote_command_requested" {
                    continue;
                }
            }
            if cloud_mcp_is_workspace_architecture_wake_event(&event_kind, &event) {
                let _ = app.emit(
                    CLOUD_MCP_WORKSPACE_ARCHITECTURES_UPDATED_EVENT,
                    event.clone(),
                );
                continue;
            }
            if cloud_mcp_is_voice_plan_result_event(&event_kind) {
                let result = event
                    .get("result")
                    .cloned()
                    .or_else(|| {
                        event
                            .get("stored")
                            .and_then(|stored| stored.get("result"))
                            .cloned()
                    })
                    .unwrap_or_else(|| event.clone());
                let workspace_id = cloud_mcp_payload_text(&event, &["workspace_id", "workspaceId"])
                    .or_else(|| cloud_mcp_payload_text(&result, &["workspace_id", "workspaceId"]))
                    .unwrap_or_default();
                let _ = app.emit(
                    VOICE_PLAN_SERVER_RESULT_EVENT,
                    json!({
                        "result": result,
                        "source": "cloud_voice_plan_graph_event",
                        "workspaceId": workspace_id,
                    }),
                );
                continue;
            }
            if event_kind != "remote_command_requested" {
                continue;
            }
            if !cloud_mcp_remote_command_matches_device(&event) {
                continue;
            }
            if !cloud_mcp_claim_remote_command_receipt(&state_clone, &event).await {
                let _ = cloud_mcp_send_remote_command_status_event(
                    &state_clone,
                    &event,
                    "duplicate_ignored",
                    "Duplicate remote command ignored by desktop.",
                    None,
                )
                .await;
                continue;
            }
            let emit_result = app.emit(CLOUD_MCP_REMOTE_COMMAND_EVENT, event.clone());
            let (status, message) = if emit_result.is_ok() {
                ("received", "Remote command received by desktop.")
            } else {
                (
                    "failed",
                    "Desktop UI was not available for the remote command.",
                )
            };
            let _ = cloud_mcp_send_remote_command_status_event(
                &state_clone,
                &event,
                status,
                message,
                None,
            )
            .await;
        }
    });
    Ok(json!({"ok": true, "started": true}))
}

fn cloud_mcp_is_tokenomics_state_event(event_kind: &str) -> bool {
    matches!(event_kind, "tokenomics_account_snapshot")
}

fn cloud_mcp_is_workspace_todo_wake_event(event_kind: &str, event: &Value) -> bool {
    if matches!(
        event_kind,
        "workspace_todo_snapshot"
            | "workspace_todos_snapshot"
            | "workspace_todo_listed_created"
            | "workspace_todo_remote_listed"
            | "todo_queue_snapshot"
            | "todo_queue_state"
            | "workspace_todo_dispatch_requested"
            | "todo_dispatch_requested"
            | "workspace_todo_dispatch_status"
            | "todo_dispatch_status"
            | "todo_dispatch_update"
            | "remote_command_ack"
            | "remote_command_result"
    ) {
        return true;
    }
    if event_kind != "live_runtime_snapshot" {
        return false;
    }
    event
        .get("data")
        .and_then(|data| data.get("workspace_todos").or_else(|| data.get("workspaceTodos")))
        .is_some()
}

fn cloud_mcp_is_workspace_architecture_wake_event(event_kind: &str, event: &Value) -> bool {
    if matches!(
        event_kind,
        "workspace_architecture_snapshot"
            | "workspace_architectures_snapshot"
            | "workspace_architecture_updated"
            | "workspace_architecture_graph_updated"
            | "architecture_graph_updated"
    ) {
        return true;
    }
    if event_kind != "live_runtime_snapshot" {
        return false;
    }
    event
        .get("data")
        .and_then(|data| {
            data.get("workspace_architectures")
                .or_else(|| data.get("workspaceArchitectures"))
        })
        .is_some()
}

fn cloud_mcp_is_voice_plan_result_event(event_kind: &str) -> bool {
    matches!(
        event_kind,
        "voice_plan_task_status"
            | "voice_plan_task_update"
            | "voice_plan_step_update"
            | "voice_plan_step_tasks_update"
            | "voice_plan_steps_update"
            | "voice_plan_plan_update"
    )
}

#[tauri::command]
async fn cloud_mcp_record_remote_command_status(
    state: State<'_, CloudMcpState>,
    event: Value,
    status: String,
    message: Option<String>,
    details: Option<Value>,
) -> Result<Value, String> {
    cloud_mcp_send_remote_command_status_event(
        state.inner(),
        &event,
        status.trim(),
        message.as_deref().unwrap_or(""),
        details.as_ref(),
    )
    .await
}

#[tauri::command]
async fn cloud_mcp_sync_device_workspace_snapshot(
    state: State<'_, CloudMcpState>,
    reason: Option<String>,
) -> Result<Value, String> {
    let reason = reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "manual_device_workspace_snapshot".to_string());
    cloud_mcp_send_device_workspace_snapshot_event(state.inner(), &reason).await?;
    Ok(json!({
        "ok": true,
        "sent": true,
        "reason": reason,
    }))
}

fn cloud_mcp_desktop_device_profile() -> Value {
    static DEVICE_PROFILE: OnceLock<Value> = OnceLock::new();
    DEVICE_PROFILE
        .get_or_init(|| {
            let platform = cloud_mcp_desktop_platform();
            let device_name = cloud_mcp_desktop_device_name();
            let device_id = cloud_mcp_stable_desktop_device_id(&device_name, platform);
            json!({
                "device_id": device_id,
                "device_name": device_name,
                "machine_name": device_name,
                "hostname": device_name,
                "platform": platform,
                "os": platform,
                "form_factor": "desktop",
                "device_type": "pc",
                "client_kind": "client",
                "client_type": "rust_desktop",
                "connection_source": "rust-diffforge",
            })
        })
        .clone()
}

#[tauri::command]
async fn cloud_mcp_get_desktop_device_profile() -> Result<Value, String> {
    Ok(cloud_mcp_desktop_device_profile())
}

fn cloud_mcp_stable_desktop_device_id(device_name: &str, platform: &str) -> String {
    if let Some(path) = cloud_mcp_desktop_device_id_path() {
        if let Ok(existing) = fs::read_to_string(&path) {
            let trimmed = existing.trim();
            if cloud_mcp_valid_device_id(trimmed) {
                return trimmed.to_string();
            }
        }

        let generated = format!("{}-{}", platform, uuid::Uuid::new_v4());
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if fs::write(&path, generated.as_bytes()).is_ok() {
            return generated;
        }
    }

    cloud_mcp_desktop_device_id(device_name, platform)
}

fn cloud_mcp_desktop_device_id_path() -> Option<PathBuf> {
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)?;
    Some(home.join(".diffforge").join(CLOUD_MCP_DEVICE_ID_FILE))
}

fn cloud_mcp_valid_device_id(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 120
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

fn cloud_mcp_desktop_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else if cfg!(target_os = "android") {
        "android"
    } else {
        "unknown"
    }
}

fn cloud_mcp_desktop_device_name() -> String {
    cloud_mcp_platform_device_name()
        .or_else(sysinfo::System::host_name)
        .or_else(|| env::var("COMPUTERNAME").ok())
        .or_else(|| env::var("HOSTNAME").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Diff Forge Desktop".to_string())
        .chars()
        .filter(|ch| !ch.is_control())
        .take(80)
        .collect()
}

fn cloud_mcp_platform_device_name() -> Option<String> {
    if cfg!(target_os = "macos") {
        cloud_mcp_device_name_from_command("scutil", &["--get", "ComputerName"])
    } else {
        None
    }
}

fn cloud_mcp_device_name_from_command(command: &str, args: &[&str]) -> Option<String> {
    Command::new(command)
        .args(args)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn cloud_mcp_desktop_device_id(device_name: &str, platform: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(platform.as_bytes());
    hasher.update(b":");
    hasher.update(device_name.as_bytes());
    let digest = hasher.finalize();
    let fingerprint = digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{}-{}", platform, fingerprint)
}

async fn cloud_mcp_lifecycle_workspaces(state: &CloudMcpState) -> Vec<Value> {
    let mut seen = HashSet::<String>::new();
    let mut workspaces = Vec::<Value>::new();

    {
        let snapshots = state.runtime_snapshots.lock().await;
        for snapshot in [
            snapshots.terminal_presence.as_ref(),
            snapshots.workspace_mcps.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            let Some(items) = snapshot.get("workspaces").and_then(Value::as_array) else {
                continue;
            };
            for workspace in items.iter().take(64) {
                let workspace_id =
                    cloud_mcp_payload_text(workspace, &["workspace_id", "workspaceId", "id"])
                        .unwrap_or_default();
                let repo_id =
                    cloud_mcp_payload_text(workspace, &["repo_id", "repoId"]).unwrap_or_default();
                let key = format!("{workspace_id}::{repo_id}");
                if workspace_id.is_empty() || repo_id.is_empty() || !seen.insert(key) {
                    continue;
                }
                let root_display = cloud_mcp_payload_text(workspace, &["workspace_root", "workspaceRoot", "repo_path", "repoPath"])
                    .unwrap_or_default();
                let git_identity = cloud_mcp_git_identity_from_workspace_or_path(workspace, &root_display);
                let mut workspace_value = json!({
                    "workspace_id": workspace_id,
                    "repo_id": repo_id,
                    "workspace_name": cloud_mcp_payload_text(workspace, &["workspace_name", "workspaceName", "name"]),
                    "workspace_root": root_display,
                    "workspace_location_fingerprint": cloud_mcp_payload_text(
                        workspace,
                        &[
                            "workspace_location_fingerprint",
                            "workspaceLocationFingerprint",
                            "root_fingerprint",
                            "rootFingerprint",
                        ],
                    ),
                    "workspace_status": cloud_mcp_payload_text(workspace, &["workspace_status", "workspaceStatus", "status"]),
                    "terminal_count": workspace.get("terminal_count")
                        .or_else(|| workspace.get("terminalCount"))
                        .cloned()
                        .unwrap_or_else(|| json!(0)),
                    "mcp_server_count": workspace.get("mcp_server_count")
                        .or_else(|| workspace.get("mcpServerCount"))
                        .or_else(|| workspace.get("server_count"))
                        .or_else(|| workspace.get("serverCount"))
                        .cloned()
                        .unwrap_or_else(|| json!(0)),
                    "workspace_active": workspace.get("workspace_active")
                        .or_else(|| workspace.get("workspaceActive"))
                        .cloned()
                        .unwrap_or_else(|| json!(false)),
                    "workspace_reported_active": workspace.get("workspace_active")
                        .or_else(|| workspace.get("workspaceActive"))
                        .cloned()
                        .unwrap_or_else(|| json!(false)),
                });
                cloud_mcp_apply_git_identity_to_value(&mut workspace_value, &git_identity);
                workspaces.push(workspace_value);
            }
        }
    }

    let runtime = state.inner.lock().await;
    for workspace in runtime.registered_workspaces.values() {
        let repo_id = cloud_mcp_repo_id_for_root(Path::new(&workspace.root));
        let key = format!("{}::{}", workspace.workspace_id, repo_id);
        if !seen.insert(key) {
            continue;
        }
        let git_identity = cloud_mcp_git_repo_identity_for_path(Path::new(&workspace.root));
        let mut workspace_value = json!({
            "workspace_id": workspace.workspace_id,
            "repo_id": repo_id,
            "workspace_name": workspace.workspace_name,
            "workspace_root": workspace.root,
            "workspace_location_fingerprint": cloud_mcp_workspace_location_fingerprint(Path::new(&workspace.root)),
            "workspace_active": false,
            "workspace_reported_active": false,
            "workspace_status": "registered",
            "terminal_count": 0,
            "mcp_server_count": 0,
        });
        cloud_mcp_apply_git_identity_to_value(&mut workspace_value, &git_identity);
        workspaces.push(workspace_value);
    }

    workspaces
}

async fn cloud_mcp_device_workspace_snapshot_payload(state: &CloudMcpState, reason: &str) -> Value {
    let device_profile = cloud_mcp_desktop_device_profile();
    let workspaces = cloud_mcp_lifecycle_workspaces(state).await;
    json!({
        "source": "rust-diffforge-device-workspace-catalog",
        "event_kind": "device_workspace_snapshot",
        "reason": reason,
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_id": device_profile["device_id"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "platform": device_profile["platform"].clone(),
        "form_factor": device_profile["form_factor"].clone(),
        "client_kind": device_profile["client_kind"].clone(),
        "snapshot_id": format!("device-workspaces-{}-{}", cloud_mcp_now_ms(), uuid::Uuid::new_v4()),
        "snapshot_full": true,
        "authoritative": true,
        "workspace_count": workspaces.len(),
        "workspaces": workspaces,
        "ts_ms": cloud_mcp_now_ms(),
    })
}

async fn cloud_mcp_send_device_workspace_snapshot_event_with_auth(
    state: &CloudMcpState,
    connection_id: &str,
    message_token: &str,
    reason: &str,
) -> Result<(), String> {
    let Some(tx) = state.global_ws_tx.lock().await.as_ref().cloned() else {
        return Err("Cloud MCP app websocket is not accepting messages.".to_string());
    };
    let auth = json!({
        "connection_id": connection_id,
        "message_token": message_token,
    });
    cloud_mcp_queue_device_workspace_snapshot_event(state, tx, auth, reason).await
}

async fn cloud_mcp_send_device_workspace_snapshot_event(
    state: &CloudMcpState,
    reason: &str,
) -> Result<(), String> {
    cloud_mcp_start_global_ws(state).await;
    let tx = cloud_mcp_wait_for_ws_sender(state).await?;
    let auth = cloud_mcp_ws_auth_object(state).await?;
    cloud_mcp_queue_device_workspace_snapshot_event(state, tx, auth, reason).await
}

async fn cloud_mcp_queue_device_workspace_snapshot_event(
    state: &CloudMcpState,
    tx: mpsc::UnboundedSender<Value>,
    auth: Value,
    reason: &str,
) -> Result<(), String> {
    let payload = cloud_mcp_device_workspace_snapshot_payload(state, reason).await;
    let request = cloud_mcp_event_envelope("device_workspace_snapshot", &payload);
    let workspace_count = payload["workspace_count"].as_u64().unwrap_or(0);
    let envelope = json!({
        "kind": "event",
        "id": format!("device-workspace-snapshot-{}-{}", cloud_mcp_now_ms(), uuid::Uuid::new_v4()),
        "contract": "diffforge.app_ws.v1",
        "auth": auth,
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "repo_id": cloud_mcp_payload_text(&request, &["repo_id"])
            .or_else(|| cloud_mcp_payload_text(&request, &["payload", "repo_id"])),
        "workspace_id": cloud_mcp_payload_text(&request, &["workspace_id"])
            .or_else(|| cloud_mcp_payload_text(&request, &["payload", "workspace_id"])),
        "request": request,
    });
    tx.send(envelope)
        .map_err(|_| "Cloud MCP app websocket is not accepting messages.".to_string())?;
    cloud_mcp_record_connection_diagnostic(
        state,
        "rust.cloud_mcp.device_workspace_snapshot.sent",
        "ok",
        "Rust sent the authoritative device workspace catalog snapshot.",
        json!({
            "reason": reason,
            "workspaceCount": workspace_count,
        }),
    )
    .await;
    Ok(())
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

async fn cloud_mcp_resolve_ws_target(
    state: &CloudMcpState,
    base_url: &str,
    endpoint_path: &str,
) -> CloudMcpWsTarget {
    if let Some(target) = cloud_mcp_local_docker_ws_target(endpoint_path) {
        if cloud_mcp_ws_target_reachable_async(&target.ws_url).await {
            cloud_mcp_record_signin_diagnostic(
                state,
                "route.resolve",
                "ok",
                "Cloud MCP local Docker websocket route is available",
                json!({"transport": target.transport, "ws_url": target.ws_url}),
            )
            .await;
            return target;
        }
        cloud_mcp_record_signin_diagnostic(
            state,
            "route.resolve",
            "warn",
            "Cloud MCP local Docker websocket route is not listening; falling back to balancer",
            json!({"transport": target.transport, "ws_url": target.ws_url}),
        )
        .await;
    }

    let fallback = cloud_mcp_fallback_ws_target(base_url, endpoint_path);
    cloud_mcp_set_global_ws_phase(state, "authenticating", "authenticating").await;
    let bearer = match cloud_mcp_authorization_bearer(state).await {
        Ok(token) => token,
        Err(error) => {
            if cloud_mcp_error_text_is_device_limit(&error) {
                cloud_mcp_mark_registration_blocked(
                    state,
                    error.clone(),
                    json!({"source": "route.resolve"}),
                )
                .await;
                return fallback;
            }
            cloud_mcp_record_signin_diagnostic(
                state,
                "route.resolve",
                "error",
                &format!("Unable to prepare Cloud MCP route auth: {error}"),
                json!({"transport": "balancer_fallback"}),
            )
            .await;
            return fallback;
        }
    };
    let Some(bearer) = bearer else {
        return fallback;
    };

    let (billing_scope_type, team_id) = cloud_mcp_account_scope(state).await;
    let (plan_name, device_limit) = cloud_mcp_account_plan(state).await;
    let device_profile = cloud_mcp_desktop_device_profile();
    let device_id = cloud_mcp_payload_text(&device_profile, &["device_id", "deviceId"]);
    cloud_mcp_set_global_ws_phase(state, "resolving_route", "resolving_route").await;
    match cloud_mcp_fetch_direct_route_async(
        base_url,
        endpoint_path,
        &bearer,
        &billing_scope_type,
        team_id.as_deref(),
        &plan_name,
        device_limit,
        device_id.as_deref(),
    )
    .await
    {
        Ok(Some(target)) => {
            cloud_mcp_record_signin_diagnostic(
                state,
                "route.resolve",
                "ok",
                "Cloud MCP direct route resolved",
                json!({"transport": target.transport, "ws_url": target.ws_url}),
            )
            .await;
            target
        }
        Ok(None) => fallback,
        Err(error) => {
            cloud_mcp_record_signin_diagnostic(
                state,
                "route.resolve",
                "error",
                &format!("Cloud MCP direct route unavailable: {error}"),
                json!({"transport": "balancer_fallback"}),
            )
            .await;
            fallback
        }
    }
}

fn cloud_mcp_rewrite_ws_endpoint(ws_url: &str, endpoint_path: &str) -> String {
    let ws_url = ws_url.trim();
    let endpoint_path = if endpoint_path.starts_with('/') {
        endpoint_path.to_string()
    } else {
        format!("/{endpoint_path}")
    };

    for suffix in ["/v1/app/ws", "/v1/voice/ws"] {
        if let Some(base) = ws_url.strip_suffix(suffix) {
            return format!("{base}{endpoint_path}");
        }
    }

    if let Some(index) = ws_url.find("/v1/") {
        return format!("{}{}", &ws_url[..index], endpoint_path);
    }

    format!("{}{}", ws_url.trim_end_matches('/'), endpoint_path)
}

fn cloud_mcp_local_docker_ws_target(endpoint_path: &str) -> Option<CloudMcpWsTarget> {
    let enabled = env::var("RUST_DIFFFORGE_USE_LOCAL_DOCKER_CLOUD")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(CLOUD_MCP_LOCAL_DOCKER_APP_WS_OVERRIDE_ENABLED);
    if !enabled {
        return None;
    }

    let explicit_voice_url = if endpoint_path == "/v1/voice/ws" {
        env::var(CLOUD_MCP_LOCAL_DOCKER_VOICE_WS_URL_ENV)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    } else {
        None
    };
    let configured_url = explicit_voice_url.or_else(|| {
        env::var(CLOUD_MCP_LOCAL_DOCKER_APP_WS_URL_ENV)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    });
    let ws_url = configured_url
        .map(|value| cloud_mcp_rewrite_ws_endpoint(&value, endpoint_path))
        .unwrap_or_else(|| {
            cloud_mcp_rewrite_ws_endpoint(CLOUD_MCP_LOCAL_DOCKER_APP_WS_URL, endpoint_path)
        });
    if !(ws_url.starts_with("ws://") || ws_url.starts_with("wss://")) {
        return None;
    }

    Some(CloudMcpWsTarget {
        ws_url,
        route_token: None,
        transport: "local_docker_cloud".to_string(),
    })
}

fn cloud_mcp_ws_target_host_port(ws_url: &str) -> Option<(String, u16)> {
    let parsed = tauri::Url::parse(ws_url).ok()?;
    let host = parsed.host_str()?.trim().to_string();
    if host.is_empty() {
        return None;
    }
    let port = parsed.port_or_known_default()?;
    Some((host, port))
}

async fn cloud_mcp_ws_target_reachable_async(ws_url: &str) -> bool {
    let Some((host, port)) = cloud_mcp_ws_target_host_port(ws_url) else {
        return false;
    };
    matches!(
        tokio::time::timeout(
            Duration::from_millis(CLOUD_MCP_LOCAL_DOCKER_PROBE_TIMEOUT_MS),
            tokio::net::TcpStream::connect((host.as_str(), port)),
        )
        .await,
        Ok(Ok(_))
    )
}

fn cloud_mcp_ws_target_reachable_blocking(ws_url: &str) -> bool {
    let Some((host, port)) = cloud_mcp_ws_target_host_port(ws_url) else {
        return false;
    };
    let Ok(addrs) = std::net::ToSocketAddrs::to_socket_addrs(&(host.as_str(), port)) else {
        return false;
    };
    let timeout = Duration::from_millis(CLOUD_MCP_LOCAL_DOCKER_PROBE_TIMEOUT_MS);
    addrs
        .into_iter()
        .any(|addr| std::net::TcpStream::connect_timeout(&addr, timeout).is_ok())
}

async fn cloud_mcp_fetch_direct_route_async(
    base_url: &str,
    endpoint_path: &str,
    bearer: &str,
    billing_scope_type: &str,
    team_id: Option<&str>,
    plan_name: &str,
    device_limit: Option<u64>,
    device_id: Option<&str>,
) -> Result<Option<CloudMcpWsTarget>, String> {
    let url = format!("{}/v1/route", base_url.trim_end_matches('/'));
    let body = json!({
        "requestedPath": endpoint_path,
        "billingScopeType": billing_scope_type,
        "scopeType": billing_scope_type,
        "teamId": team_id,
        "planName": plan_name,
        "deviceLimit": device_limit,
        "deviceId": device_id,
    });
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(CLOUD_MCP_AUTH_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("Unable to create Cloud MCP route client: {error}"))?
        .post(url)
        .header("Authorization", format!("Bearer {bearer}"))
        .header("x-diffforge-actor", CLOUD_MCP_RUST_CLIENT_ID)
        .header("x-diffforge-billing-scope-type", billing_scope_type)
        .header("x-diffforge-scope-type", billing_scope_type)
        .header("x-diffforge-plan-name", plan_name)
        .headers({
            let mut headers = reqwest::header::HeaderMap::new();
            if let Some(device_limit) = device_limit {
                if let Ok(value) = reqwest::header::HeaderValue::from_str(&device_limit.to_string()) {
                    headers.insert("x-diffforge-device-limit", value);
                }
            }
            if let Some(device_id) = device_id {
                if let Ok(value) = reqwest::header::HeaderValue::from_str(device_id) {
                    headers.insert("x-diffforge-device-id", value);
                }
            }
            if billing_scope_type == "team" {
                if let Some(team_id) = team_id {
                    if let Ok(value) = reqwest::header::HeaderValue::from_str(team_id) {
                        headers.insert("x-diffforge-team-id", value);
                    }
                }
            }
            headers
        })
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Cloud MCP route request failed: {error}"))?;
    let status = response.status();
    let parsed = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Cloud MCP route response was invalid JSON: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Cloud MCP route request returned {}: {}",
            status.as_u16(),
            parsed
                .get("message")
                .or_else(|| parsed.pointer("/error/message"))
                .and_then(Value::as_str)
                .unwrap_or("route rejected")
        ));
    }
    Ok(cloud_mcp_direct_target_from_route(&parsed, endpoint_path))
}

fn cloud_mcp_direct_target_from_route(
    route: &Value,
    endpoint_path: &str,
) -> Option<CloudMcpWsTarget> {
    let direct = route.get("direct")?;
    if direct.get("enabled").and_then(Value::as_bool) == Some(false) {
        return None;
    }
    let route_token = direct
        .get("route_token")
        .and_then(Value::as_str)
        .map(str::to_string)?;
    let preferred = if endpoint_path == "/v1/voice/ws" {
        direct
            .get("voice_websocket_url")
            .or_else(|| direct.get("voiceWebsocketUrl"))
    } else {
        None
    };
    let ws_url = preferred
        .or_else(|| direct.get("websocket_url"))
        .or_else(|| direct.get("websocketUrl"))
        .or_else(|| direct.get("browser_websocket_url"))
        .or_else(|| direct.get("browserWebsocketUrl"))
        .or_else(|| direct.get("app_websocket_url"))
        .or_else(|| direct.get("appWebsocketUrl"))
        .and_then(Value::as_str)?
        .trim()
        .to_string();
    if !(ws_url.starts_with("ws://") || ws_url.starts_with("wss://")) {
        return None;
    }
    let ws_url = cloud_mcp_rewrite_ws_endpoint(&ws_url, endpoint_path);
    Some(CloudMcpWsTarget {
        ws_url,
        route_token: Some(route_token),
        transport: direct
            .get("transport")
            .and_then(Value::as_str)
            .unwrap_or("direct_cloud_container")
            .to_string(),
    })
}

fn cloud_mcp_fallback_ws_target(base_url: &str, endpoint_path: &str) -> CloudMcpWsTarget {
    let ws_url = if endpoint_path == "/v1/app/ws" {
        cloud_mcp_app_ws_url(base_url)
    } else {
        cloud_mcp_proxy_websocket_url(base_url, endpoint_path)
            .unwrap_or_else(|_| cloud_mcp_app_ws_url(base_url))
    };
    CloudMcpWsTarget {
        ws_url,
        route_token: None,
        transport: "balancer_proxy".to_string(),
    }
}

async fn cloud_mcp_replay_runtime_snapshots(
    state: &CloudMcpState,
    connection_id: &str,
    message_token: &str,
) {
    let snapshots = {
        let snapshots = state.runtime_snapshots.lock().await;
        snapshots.clone()
    };
    let mut replay_items = Vec::new();
    if let Some(payload) = snapshots.terminal_presence {
        replay_items.push(("terminal_presence_snapshot", payload));
    }
    if let Some(payload) = snapshots.workspace_mcps {
        replay_items.push(("workspace_mcp_snapshot", payload));
    }
    if let Some(payload) = snapshots.tokenomics {
        replay_items.push(("tokenomics_account_snapshot", payload));
    }
    if replay_items.is_empty() {
        return;
    }

    let Some(tx) = state.global_ws_tx.lock().await.as_ref().cloned() else {
        return;
    };
    let replay_count = replay_items.len();
    for (event_kind, payload) in replay_items {
        let request = cloud_mcp_event_envelope(event_kind, &payload);
        let envelope = json!({
            "kind": "event",
            "id": format!("runtime-replay-{}-{}", cloud_mcp_now_ms(), uuid::Uuid::new_v4()),
            "contract": "diffforge.app_ws.v1",
            "auth": {
                "connection_id": connection_id,
                "message_token": message_token,
            },
            "client_id": CLOUD_MCP_RUST_CLIENT_ID,
            "repo_id": cloud_mcp_payload_text(&request, &["repo_id"])
                .or_else(|| cloud_mcp_payload_text(&request, &["payload", "repo_id"])),
            "workspace_id": cloud_mcp_payload_text(&request, &["workspace_id"])
                .or_else(|| cloud_mcp_payload_text(&request, &["payload", "workspace_id"])),
            "request": request,
        });
        let _ = tx.send(envelope);
    }

    cloud_mcp_record_connection_diagnostic(
        state,
        "rust.cloud_mcp.runtime_snapshot.replay",
        "ok",
        "Rust client replayed cached runtime snapshots after websocket reconnect.",
        json!({
            "snapshotCount": replay_count,
        }),
    )
    .await;
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
    cloud_mcp_ws_request_with_timeout(
        state,
        request_kind,
        payload,
        Duration::from_secs(CLOUD_MCP_SYNC_TIMEOUT_SECS),
    )
    .await
}

async fn cloud_mcp_ws_request_with_timeout(
    state: &CloudMcpState,
    request_kind: &str,
    payload: &Value,
    response_timeout: Duration,
) -> Result<Value, String> {
    let mut last_error = String::new();
    let retry_transient_errors = request_kind != "hard_reset_cloud_sqlite";
    for attempt in 0..2 {
        match cloud_mcp_ws_request_once_with_timeout(state, request_kind, payload, response_timeout)
            .await
        {
            Ok(response) => return Ok(response),
            Err(error) => {
                if !retry_transient_errors
                    || !cloud_mcp_ws_request_error_is_transient(&error)
                    || attempt > 0
                {
                    return Err(error);
                }
                last_error = error.clone();
                cloud_mcp_mark_global_ws_disconnected(state, &error).await;
                state.global_ws_reconnect.notify_waiters();
            }
        }
    }

    Err(last_error)
}

async fn cloud_mcp_ws_request_once_with_timeout(
    state: &CloudMcpState,
    request_kind: &str,
    payload: &Value,
    response_timeout: Duration,
) -> Result<Value, String> {
    cloud_mcp_start_global_ws(state).await;
    let tx = cloud_mcp_wait_for_ws_sender(state).await?;
    let request_id = format!("ws-{}-{}", cloud_mcp_now_ms(), uuid::Uuid::new_v4());
    let auth = cloud_mcp_ws_auth_object(state).await?;
    if cloud_mcp_voice_ws_kind(request_kind) {
        cloud_mcp_log_voice_shared_ws(
            "voice_agent.shared_ws.request_prepared",
            request_kind,
            "start",
            "Rust prepared an authenticated voice request for the shared app websocket.",
            json!({
                "id": request_id,
                "repo_id": cloud_mcp_payload_text(payload, &["repo_id"]),
                "workspace_id": cloud_mcp_payload_text(payload, &["workspace_id"]),
                "voice_session_id": cloud_mcp_payload_text(payload, &["voice_session_id", "voiceSessionId"]),
                "request_kind": cloud_mcp_payload_text(payload, &["kind"]),
                "timeout_ms": response_timeout.as_millis(),
            }),
        );
    }
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
        if cloud_mcp_voice_ws_kind(request_kind) {
            cloud_mcp_log_voice_shared_ws(
                "voice_agent.shared_ws.request_queue_failed",
                request_kind,
                "error",
                "Rust could not queue a voice request on the shared app websocket.",
                json!({
                    "id": request_id,
                }),
            );
        }
        return Err("Cloud MCP app websocket is not accepting messages.".to_string());
    }
    if cloud_mcp_voice_ws_kind(request_kind) {
        cloud_mcp_log_voice_shared_ws(
            "voice_agent.shared_ws.request_queued",
            request_kind,
            "ok",
            "Rust queued a voice request on the shared app websocket and is waiting for the cloud ack.",
            json!({
                "id": request_id,
            }),
        );
    }
    let response = match timeout(response_timeout, response_rx).await {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => {
            state.global_ws_pending.lock().await.remove(&request_id);
            if cloud_mcp_voice_ws_kind(request_kind) {
                cloud_mcp_log_voice_shared_ws(
                    "voice_agent.shared_ws.response_cancelled",
                    request_kind,
                    "error",
                    "Rust voice request response channel was cancelled before cloud ack.",
                    json!({
                        "id": request_id,
                    }),
                );
            }
            return Err("Cloud MCP app websocket response was cancelled.".to_string());
        }
        Err(_) => {
            state.global_ws_pending.lock().await.remove(&request_id);
            if cloud_mcp_voice_ws_kind(request_kind) {
                cloud_mcp_log_voice_shared_ws(
                    "voice_agent.shared_ws.response_timeout",
                    request_kind,
                    "error",
                    "Rust timed out waiting for the cloud ack for a voice request.",
                    json!({
                        "id": request_id,
                        "timeout_ms": response_timeout.as_millis(),
                    }),
                );
            }
            return Err("Cloud MCP app websocket request timed out.".to_string());
        }
    };
    if cloud_mcp_voice_ws_kind(request_kind) {
        cloud_mcp_log_voice_shared_ws(
            "voice_agent.shared_ws.response_received",
            request_kind,
            "ok",
            "Rust received the cloud ack for a voice request.",
            json!({
                "id": request_id,
                "response_kind": response.get("kind").and_then(Value::as_str),
                "ok": response.get("ok").and_then(Value::as_bool),
                "request_kind": response.get("request_kind").or_else(|| response.get("requestKind")).cloned().unwrap_or(Value::Null),
            }),
        );
    }
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

fn cloud_mcp_ws_request_error_is_transient(error: &str) -> bool {
    let error = error.to_ascii_lowercase();
    if !error.contains("cloud mcp app websocket") && !error.contains("cloud mcp websocket") {
        return false;
    }
    [
        "not accepting",
        "not connected",
        "sender",
        "timed out",
        "cancelled",
        "closed",
        "disconnected",
        "write failed",
        "read failed",
    ]
    .iter()
    .any(|needle| error.contains(needle))
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

async fn cloud_mcp_wait_for_app_ws_auth(state: &CloudMcpState) -> Result<Value, String> {
    cloud_mcp_start_global_ws(state).await;
    let _ = cloud_mcp_wait_for_ws_sender(state).await?;
    cloud_mcp_ws_auth_object(state).await
}

async fn cloud_mcp_wait_for_ws_sender(
    state: &CloudMcpState,
) -> Result<mpsc::UnboundedSender<Value>, String> {
    let started = Instant::now();
    loop {
        if state.global_ws_registration_blocked.load(Ordering::SeqCst) {
            let runtime = state.inner.lock().await;
            let primary = runtime.global_ws_last_error.trim();
            let fallback = runtime.last_error.trim();
            let detail = if !primary.is_empty() {
                primary.to_string()
            } else if !fallback.is_empty() {
                fallback.to_string()
            } else {
                "Device limit reached. Open the Diff Forge dashboard and remove a registered device, then reconnect the Rust client.".to_string()
            };
            return Err(detail.to_string());
        }
        let ready = {
            let runtime = state.inner.lock().await;
            runtime.global_ws_connected
                && runtime.global_ws_connection_id.is_some()
                && runtime.global_ws_message_token.is_some()
        };
        if ready {
            let tx = state.global_ws_tx.lock().await.as_ref().cloned();
            if let Some(tx) = tx {
                if !tx.is_closed() {
                    return Ok(tx);
                }
                cloud_mcp_mark_global_ws_disconnected(
                    state,
                    "Cloud MCP app websocket sender closed.",
                )
                .await;
                state.global_ws_reconnect.notify_waiters();
            }
        }
        if started.elapsed() >= Duration::from_secs(CLOUD_MCP_CONNECT_TIMEOUT_SECS) {
            let runtime = state.inner.lock().await;
            let detail = [
                runtime.global_ws_last_error.as_str(),
                runtime.last_error.as_str(),
            ]
            .into_iter()
            .map(str::trim)
            .find(|value| !value.is_empty())
            .unwrap_or("Cloud MCP app websocket is not connected yet.");
            return Err(detail.to_string());
        }
        sleep(Duration::from_millis(80)).await;
    }
}

fn cloud_mcp_workspace_control_dir(root: &Path) -> PathBuf {
    root.join(".agents").join("cloud-mcp")
}

fn cloud_mcp_visible_workspace_log_root(root: &Path) -> PathBuf {
    for ancestor in root.ancestors() {
        if ancestor.file_name().and_then(|value| value.to_str()) != Some("worktrees") {
            continue;
        }
        let Some(agents_dir) = ancestor.parent() else {
            continue;
        };
        if agents_dir.file_name().and_then(|value| value.to_str()) != Some(".agents") {
            continue;
        }
        if let Some(workspace_root) = agents_dir.parent() {
            return workspace_root.to_path_buf();
        }
    }
    root.to_path_buf()
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
    let root = cloud_mcp_visible_workspace_log_root(root);
    let root = root.as_path();
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

fn cloud_mcp_workspace_identity(
    root: &Path,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
) -> (String, String) {
    let root_display = workspace_path_display(root);
    let workspace_id = workspace_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("local-{}", cloud_mcp_short_hash(&root_display)));
    let workspace_name = workspace_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            root.file_name()
                .map(|value| value.to_string_lossy().to_string())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "Local workspace".to_string())
        });
    (workspace_id, workspace_name)
}

fn cloud_mcp_child_project_mounts(
    root: &Path,
    mounts: &[WorkspaceProjectMount],
) -> Vec<WorkspaceProjectMount> {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let root_key = normalized_path_key(&root);
    mounts
        .iter()
        .filter(|mount| mount.mount_kind == "project")
        .filter(|mount| normalized_path_key(&mount.root_path) != root_key)
        .cloned()
        .collect()
}

fn cloud_mcp_project_mounts_for_workspace_sync(
    root: &Path,
    workspace_kind: &str,
    mounts: &[WorkspaceProjectMount],
) -> Vec<WorkspaceProjectMount> {
    if cloud_mcp_workspace_kind_is_container(workspace_kind) {
        mounts
            .iter()
            .filter(|mount| mount.mount_kind == "project")
            .cloned()
            .collect()
    } else {
        cloud_mcp_child_project_mounts(root, mounts)
    }
}

fn cloud_mcp_workspace_kind_is_container(workspace_kind: &str) -> bool {
    workspace_kind == "container"
}

fn cloud_mcp_workspace_kind_filetree_authoritative(workspace_kind: &str) -> bool {
    matches!(workspace_kind, "git_repo" | "project")
}

fn cloud_mcp_prepare_workspace_bundle(
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<CloudMcpPreparedWorkspaceBundle, String> {
    let root = resolve_workspace_root_directory(Some(&repo_path))?;
    let primary =
        cloud_mcp_prepare_workspace_from_root(root.clone(), workspace_id.clone(), workspace_name)?;
    let mut children = Vec::new();
    let mut seen = HashSet::new();
    seen.insert(normalized_path_key(&primary.root));
    let mut pending_mounts = VecDeque::from(primary.project_mounts.clone());
    while let Some(mount) = pending_mounts.pop_front() {
        let key = normalized_path_key(&mount.root_path);
        if !seen.insert(key) {
            continue;
        }
        let child = cloud_mcp_prepare_workspace_from_root(
            mount.root_path.clone(),
            workspace_id.clone(),
            Some(mount.project_name.clone()),
        )?;
        pending_mounts.extend(child.project_mounts.clone());
        children.push(child);
    }

    Ok(CloudMcpPreparedWorkspaceBundle { primary, children })
}

fn cloud_mcp_container_mount_filetree(
    workspace_root: &Path,
    mounts: &[WorkspaceProjectMount],
) -> (Vec<CloudMcpFileEntry>, bool) {
    let manifest = workspace_mount_manifest_from_projects(workspace_root, mounts);
    let mut entries = manifest
        .iter()
        .map(|mount| CloudMcpFileEntry {
            relative_path: mount.workspace_relative_path.clone(),
            kind: if mount.mount_kind == "container" {
                "container".to_string()
            } else {
                "project".to_string()
            },
            size: None,
            modified_ms: fs::metadata(&mount.root_path)
                .ok()
                .and_then(|metadata| cloud_mcp_modified_ms(&metadata)),
            references: Vec::new(),
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    (entries, false)
}

fn cloud_mcp_apply_project_mount_boundaries(
    workspace_root: &Path,
    filetree: Vec<CloudMcpFileEntry>,
    filetree_truncated: bool,
    project_mounts: &[WorkspaceProjectMount],
) -> (Vec<CloudMcpFileEntry>, bool) {
    if project_mounts.is_empty() {
        return (filetree, filetree_truncated);
    }

    let project_paths = project_mounts
        .iter()
        .map(|mount| normalize_git_status_path(&mount.workspace_relative_path))
        .filter(|path| !path.is_empty())
        .collect::<Vec<_>>();
    if project_paths.is_empty() {
        return (filetree, filetree_truncated);
    }

    let manifest_paths = workspace_mount_manifest_from_projects(workspace_root, project_mounts)
        .into_iter()
        .map(|mount| normalize_git_status_path(&mount.workspace_relative_path))
        .filter(|path| !path.is_empty())
        .collect::<HashSet<_>>();
    let is_inside_project_mount = |entry_path: &str| {
        project_paths.iter().any(|project_path| {
            entry_path == project_path || entry_path.starts_with(&format!("{project_path}/"))
        })
    };

    let mut entries = filetree
        .into_iter()
        .filter(|entry| {
            let entry_path = normalize_git_status_path(&entry.relative_path);
            !manifest_paths.contains(&entry_path) && !is_inside_project_mount(&entry_path)
        })
        .collect::<Vec<_>>();
    let (mount_entries, _) = cloud_mcp_container_mount_filetree(workspace_root, project_mounts);
    entries.extend(mount_entries);
    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    entries.dedup_by(|left, right| left.relative_path == right.relative_path);

    let truncated = filetree_truncated || entries.len() > CLOUD_MCP_FILETREE_LIMIT;
    if entries.len() > CLOUD_MCP_FILETREE_LIMIT {
        entries.truncate(CLOUD_MCP_FILETREE_LIMIT);
    }

    (entries, truncated)
}

fn cloud_mcp_prepare_workspace_from_root(
    root: PathBuf,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<CloudMcpPreparedWorkspace, String> {
    let root_display = workspace_path_display(&root);
    let detected_mounts = workspace_project_mounts(&root);
    let workspace_kind = workspace_kind_for_mounts(&root, &detected_mounts);
    let project_mounts =
        cloud_mcp_project_mounts_for_workspace_sync(&root, &workspace_kind, &detected_mounts);
    let (workspace_id, workspace_name) =
        cloud_mcp_workspace_identity(&root, workspace_id.as_deref(), workspace_name.as_deref());
    let (filetree, filetree_truncated) =
        if cloud_mcp_workspace_kind_filetree_authoritative(&workspace_kind) {
            let (entries, truncated) = cloud_mcp_collect_filetree(&root);
            cloud_mcp_apply_project_mount_boundaries(&root, entries, truncated, &project_mounts)
        } else if cloud_mcp_workspace_kind_is_container(&workspace_kind) {
            cloud_mcp_container_mount_filetree(&root, &project_mounts)
        } else {
            (Vec::new(), false)
        };
    let (policy_graph_path, policy_graph) = cloud_mcp_find_policy_graph(&root)
        .map(|(path, value)| (path, Some(value)))
        .unwrap_or_else(|| (String::new(), None));

    Ok(CloudMcpPreparedWorkspace {
        root,
        root_display,
        workspace_kind,
        project_mounts,
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
        "/v1/status" => Some("status"),
        "/v1/events" => Some("event"),
        "/v1/sync/push" => Some("sync_push"),
        "/v1/sync/pull" => Some("sync_pull"),
        "/v1/context/pack" => Some("context_pack"),
        "/v1/task/history" => Some("task_history"),
        "/v1/workspace/todos/hydrate" => Some("workspace_todo_hydrate"),
        "/v1/workspace/architectures/list" => Some("workspace_architectures_list"),
        "/v1/workspace/architectures/hydrate" => Some("workspace_architecture_hydrate"),
        "/v1/cloud/sqlite/hard-reset" => Some("hard_reset_cloud_sqlite"),
        _ => None,
    }
}

async fn cloud_mcp_post_event_endpoint(
    state: &CloudMcpState,
    event_kind: &str,
    payload: &Value,
) -> Result<Value, String> {
    let envelope = cloud_mcp_event_envelope(event_kind, payload);
    cloud_mcp_post_json_endpoint(state, "/v1/events", &envelope).await
}

fn cloud_mcp_event_envelope(event_kind: &str, payload: &Value) -> Value {
    let mut workspace_ids = Vec::new();
    let mut repo_ids = Vec::new();
    if let Some(workspace_id) = cloud_mcp_payload_text(payload, &["workspace_id", "workspaceId"]) {
        if !workspace_ids
            .iter()
            .any(|value: &String| value == &workspace_id)
        {
            workspace_ids.push(workspace_id);
        }
    }
    if let Some(repo_id) = cloud_mcp_payload_text(payload, &["repo_id", "repoId"]) {
        if !repo_ids.iter().any(|value: &String| value == &repo_id) {
            repo_ids.push(repo_id);
        }
    }
    if let Some(items) = payload
        .get("workspace_ids")
        .or_else(|| payload.get("workspaceIds"))
        .and_then(Value::as_array)
    {
        for item in items.iter().filter_map(Value::as_str) {
            let item = item.trim().to_string();
            if !item.is_empty() && !workspace_ids.iter().any(|value| value == &item) {
                workspace_ids.push(item);
            }
        }
    }
    if let Some(items) = payload
        .get("repo_ids")
        .or_else(|| payload.get("repoIds"))
        .and_then(Value::as_array)
    {
        for item in items.iter().filter_map(Value::as_str) {
            let item = item.trim().to_string();
            if !item.is_empty() && !repo_ids.iter().any(|value| value == &item) {
                repo_ids.push(item);
            }
        }
    }
    if let Some(workspaces) = payload.get("workspaces").and_then(Value::as_array) {
        for workspace in workspaces.iter().take(64) {
            if let Some(workspace_id) =
                cloud_mcp_payload_text(workspace, &["workspace_id", "workspaceId", "id"])
            {
                if !workspace_ids
                    .iter()
                    .any(|value: &String| value == &workspace_id)
                {
                    workspace_ids.push(workspace_id);
                }
            }
            if let Some(repo_id) = cloud_mcp_payload_text(workspace, &["repo_id", "repoId"]) {
                if !repo_ids.iter().any(|value: &String| value == &repo_id) {
                    repo_ids.push(repo_id);
                }
            }
        }
    }
    let primary_workspace_id = (workspace_ids.len() == 1).then(|| workspace_ids[0].clone());
    let primary_repo_id = (repo_ids.len() == 1).then(|| repo_ids[0].clone());
    json!({
        "event_kind": event_kind,
        "payload": payload,
        "repo_id": primary_repo_id,
        "repo_ids": repo_ids,
        "ts_ms": cloud_mcp_now_ms(),
        "workspace_id": primary_workspace_id,
        "workspace_ids": workspace_ids,
    })
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
        "/v1/status" => "cloud_status",
        "/v1/context/pack" => "cloud_get_context_pack",
        "/v1/task/history" => "cloud_get_task_history",
        "/v1/workspace/todos/hydrate" => "cloud_hydrate_workspace_todos",
        "/v1/workspace/architectures/list" => "cloud_get_workspace_architectures",
        "/v1/workspace/architectures/hydrate" => "cloud_hydrate_workspace_architecture",
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
    for key in path {
        if let Some(value) = payload
            .get(*key)
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|value| !value.trim().is_empty())
        {
            return Some(value);
        }
    }

    let mut current = payload;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
}

fn cloud_mcp_terminal_nickname_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphabetic())
        .flat_map(char::to_lowercase)
        .collect()
}

fn cloud_mcp_normalize_terminal_nickname(value: &str) -> Option<String> {
    let key = cloud_mcp_terminal_nickname_key(value);
    if key.is_empty() {
        return None;
    }

    CLOUD_MCP_TERMINAL_NICKNAMES
        .iter()
        .find(|name| name.to_ascii_lowercase() == key)
        .map(|name| (*name).to_string())
}

fn cloud_mcp_terminal_nickname_text(payload: &Value, path: &[&str]) -> Option<String> {
    for key in path {
        if let Some(value) = payload
            .get(*key)
            .and_then(Value::as_str)
            .and_then(cloud_mcp_normalize_terminal_nickname)
        {
            return Some(value);
        }
    }

    let mut current = payload;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .and_then(cloud_mcp_normalize_terminal_nickname)
}

fn cloud_mcp_payload_object(payload: &Value, path: &[&str]) -> Option<Value> {
    for key in path {
        if let Some(value) = payload.get(*key).filter(|value| value.is_object()) {
            return Some(value.clone());
        }
    }

    let mut current = payload;
    for key in path {
        current = current.get(*key)?;
    }
    current.is_object().then(|| current.clone())
}

fn cloud_mcp_payload_u64(payload: &Value, path: &[&str]) -> Option<u64> {
    for key in path {
        if let Some(value) = payload.get(*key) {
            if let Some(number) = value.as_u64() {
                return Some(number);
            }
            if let Some(number) = value.as_i64().and_then(|number| u64::try_from(number).ok()) {
                return Some(number);
            }
            if let Some(number) = value
                .as_str()
                .and_then(|text| text.trim().parse::<u64>().ok())
            {
                return Some(number);
            }
        }
    }

    let mut current = payload;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_u64()
        .or_else(|| {
            current
                .as_i64()
                .and_then(|number| u64::try_from(number).ok())
        })
        .or_else(|| {
            current
                .as_str()
                .and_then(|text| text.trim().parse::<u64>().ok())
        })
}

fn cloud_mcp_payload_bool(payload: &Value, path: &[&str], fallback: bool) -> bool {
    let mut current = payload;
    for key in path {
        current = match current.get(*key) {
            Some(value) => value,
            None => return fallback,
        };
    }
    if let Some(value) = current.as_bool() {
        return value;
    }
    if let Some(text) = current.as_str() {
        return match text.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => true,
            "0" | "false" | "no" | "off" => false,
            _ => fallback,
        };
    }
    fallback
}

fn cloud_mcp_payload_usize(payload: &Value, keys: &[&str]) -> Option<usize> {
    keys.iter().find_map(|key| {
        payload.get(*key).and_then(|value| {
            value
                .as_u64()
                .and_then(|number| usize::try_from(number).ok())
                .or_else(|| {
                    value
                        .as_str()
                        .and_then(|text| text.trim().parse::<usize>().ok())
                })
        })
    })
}

fn cloud_mcp_payload_items(payload: &Value, keys: &[&str], limit: usize) -> Vec<Value> {
    for key in keys {
        let Some(value) = payload.get(*key) else {
            continue;
        };
        if let Some(items) = value.as_array() {
            return items.iter().take(limit).cloned().collect();
        }
        if let Some(object) = value.as_object() {
            let items = object.values().take(limit).cloned().collect::<Vec<_>>();
            if !items.is_empty() {
                return items;
            }
        }
    }
    Vec::new()
}

fn cloud_mcp_workspace_terminal_items(workspace: &Value) -> Vec<Value> {
    let items = cloud_mcp_payload_items(
        workspace,
        &[
            "terminals",
            "terminal_statuses",
            "terminalStatuses",
            "terminal_agents",
            "terminalAgents",
            "terminal_presence",
            "terminalPresence",
            "terminal_panes",
            "terminalPanes",
            "panes",
            "agents",
        ],
        64,
    );
    if !items.is_empty() {
        return items;
    }

    let indexes = workspace
        .get("logicalTerminalIndexes")
        .or_else(|| workspace.get("logical_terminal_indexes"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_i64)
                .take(64)
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| {
            let count = cloud_mcp_payload_usize(
                workspace,
                &[
                    "logicalTerminalCount",
                    "logical_terminal_count",
                    "terminalCount",
                    "terminal_count",
                    "activeTerminalCount",
                    "active_terminal_count",
                ],
            )
            .unwrap_or(0)
            .min(64);
            (0..count).map(|index| index as i64).collect::<Vec<_>>()
        });
    if indexes.is_empty() {
        return Vec::new();
    }

    let roles = workspace
        .get("terminalRolesByIndex")
        .or_else(|| workspace.get("terminal_roles_by_index"))
        .and_then(Value::as_object);
    let agents = workspace
        .get("terminalAgentsByIndex")
        .or_else(|| workspace.get("terminal_agents_by_index"))
        .and_then(Value::as_object);

    indexes
        .into_iter()
        .map(|index| {
            let key = index.to_string();
            let role = roles
                .and_then(|roles| roles.get(&key))
                .and_then(Value::as_str)
                .unwrap_or("terminal");
            let agent = agents.and_then(|agents| agents.get(&key));
            json!({
                "agent_kind": agent
                    .and_then(|agent| cloud_mcp_payload_text(agent, &["agent_kind", "agentKind", "id", "agent_id", "agentId"]))
                    .unwrap_or_else(|| role.to_string()),
                "agent_label": agent
                    .and_then(|agent| cloud_mcp_payload_text(agent, &["agent_label", "agentLabel", "label", "name"]))
                    .unwrap_or_else(|| role.to_string()),
                "status": "no_session",
                "session_state": "no_session",
                "terminal_index": index,
            })
        })
        .collect()
}

fn cloud_mcp_workspace_server_items(workspace: &Value) -> Vec<Value> {
    let direct = cloud_mcp_payload_items(
        workspace,
        &[
            "servers",
            "mcp_servers",
            "mcpServers",
            "workspace_servers",
            "workspaceServers",
            "installed_servers",
            "installedServers",
            "registry_servers",
            "registryServers",
            "items",
            "entries",
            "mcps",
        ],
        128,
    );
    if !direct.is_empty() {
        return direct;
    }
    for key in ["registry", "data", "payload"] {
        if let Some(nested) = workspace.get(key) {
            let nested_items = cloud_mcp_workspace_server_items(nested);
            if !nested_items.is_empty() {
                return nested_items;
            }
        }
    }
    Vec::new()
}

async fn cloud_mcp_register_prepared_workspace(
    state: &CloudMcpState,
    prepared: CloudMcpPreparedWorkspace,
    reason: &str,
) -> Result<CloudMcpWorkspaceRegistrationResult, String> {
    let now_ms = cloud_mcp_now_ms();
    let repo_id = cloud_mcp_repo_id_for_root(&prepared.root);
    let git_identity = cloud_mcp_git_repo_identity_for_path(&prepared.root);
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
    let mut payload = json!({
        "source": "rust-diffforge",
        "repo_id": repo_id.clone(),
        "agent_id": "rust-diffforge",
        "event_kind": reason,
        "summary": format!("Workspace {} synced into the Cloud MCP context ledger.", prepared.workspace_name),
        "payload": {
            "reason": reason,
            "workspace_id": prepared.workspace_id.clone(),
            "workspace_name": prepared.workspace_name.clone(),
            "workspace_root": prepared.root_display.clone(),
            "workspace_kind": prepared.workspace_kind.clone(),
            "project_mounts": prepared.project_mounts.clone(),
            "file_count": workspace_status.file_count,
            "filetree_truncated": prepared.filetree_truncated,
            "filetree_authoritative": cloud_mcp_workspace_kind_filetree_authoritative(&prepared.workspace_kind),
            "policy_graph_detected": policy_graph_detected,
            "policy_graph_path": workspace_status.policy_graph_path,
            "context_pack_model": true,
        }
    });
    cloud_mcp_apply_git_identity_to_value(&mut payload, &git_identity);
    if let Some(inner_payload) = payload.get_mut("payload") {
        cloud_mcp_apply_git_identity_to_value(inner_payload, &git_identity);
    }
    let event_response = cloud_mcp_post_event_endpoint(state, reason, &payload).await?;
    if reason == "workspace_registration" {
        let reconcile_payload = json!({
            "source": "rust-diffforge-terminal-lifecycle",
            "repo_id": repo_id.clone(),
            "agent_id": "rust-diffforge",
            "event_kind": "terminal_presence_reconciled",
            "reason": "workspace_registration",
            "workspace_id": prepared.workspace_id.clone(),
            "workspace_name": prepared.workspace_name.clone(),
            "workspace_root": prepared.root_display.clone(),
            "summary": format!("Workspace {} opened; reconciling stale terminal agent presence.", prepared.workspace_name),
            "payload": {
                "reason": "workspace_registration",
                "workspace_id": prepared.workspace_id.clone(),
                "workspace_name": prepared.workspace_name.clone(),
                "workspace_root": prepared.root_display.clone(),
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
    let filetree_response: Result<Value, String> = Ok(json!({
        "ok": true,
        "skipped": true,
        "reason": "filetree_sync_disabled",
        "repoId": repo_id.clone(),
        "repoPath": prepared.root_display.clone(),
    }));
    let log_path = cloud_mcp_workspace_log(
        &prepared.root,
        reason,
        &workspace_status.workspace_id,
        &workspace_status.workspace_name,
        json!({
            "repo_id": repo_id,
            "workspace_kind": prepared.workspace_kind.clone(),
            "project_mount_count": prepared.project_mounts.len(),
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
    let registration_response =
        cloud_mcp_ws_send_workspace_registration(state, &repo_id, &workspace_status).await?;
    let _ = cloud_mcp_send_device_workspace_snapshot_event(state, "workspace_registered").await;
    let status = cloud_mcp_status_snapshot(state).await;
    Ok(CloudMcpWorkspaceRegistrationResult {
        status,
        workspace: workspace_status,
        child_workspaces: Vec::new(),
        server_response: json!({
            "event": event_response,
            "workspaceRegistration": registration_response,
        }),
        synced: true,
        log_path: workspace_path_display(&log_path),
        message: "Workspace synced to Cloud MCP context ledger.".to_string(),
    })
}

async fn cloud_mcp_register_prepared_workspace_bundle(
    state: &CloudMcpState,
    bundle: CloudMcpPreparedWorkspaceBundle,
    reason: &str,
) -> Result<CloudMcpWorkspaceRegistrationResult, String> {
    let mut result = cloud_mcp_register_prepared_workspace(state, bundle.primary, reason).await?;
    let mut child_workspaces = Vec::new();
    let mut child_responses = Vec::new();

    for child in bundle.children {
        let child_result = cloud_mcp_register_prepared_workspace(state, child, reason).await?;
        child_workspaces.push(child_result.workspace);
        child_responses.push(child_result.server_response);
    }

    if !child_workspaces.is_empty() {
        if let Some(object) = result.server_response.as_object_mut() {
            object.insert(
                "childWorkspaceRegistrations".to_string(),
                Value::Array(child_responses),
            );
        }
        result.message = format!(
            "Workspace container synced with {} child project{}.",
            child_workspaces.len(),
            if child_workspaces.len() == 1 { "" } else { "s" }
        );
        result.child_workspaces = child_workspaces;
    }

    Ok(result)
}

async fn cloud_mcp_ws_send_workspace_registration(
    state: &CloudMcpState,
    repo_id: &str,
    workspace: &CloudMcpWorkspaceStatus,
) -> Result<Value, String> {
    let root = Path::new(&workspace.root);
    let git_identity = cloud_mcp_git_repo_identity_for_path(root);
    let mut payload = json!({
        "repo_id": repo_id,
        "workspace_id": workspace.workspace_id,
        "workspace_name": workspace.workspace_name,
        "workspace_location_fingerprint": cloud_mcp_workspace_location_fingerprint(root),
        "workspace_root": workspace.root,
        "schema_version": 1,
    });
    cloud_mcp_apply_git_identity_to_value(&mut payload, &git_identity);
    cloud_mcp_ws_request(
        state,
        "workspace_register",
        &payload,
    )
    .await
}

fn cloud_mcp_response_data(value: &Value) -> Value {
    value.get("data").cloned().unwrap_or_else(|| value.clone())
}

fn cloud_mcp_terminal_key(pane_id: &str, instance_id: u64) -> String {
    format!("{pane_id}::{instance_id}")
}

fn cloud_mcp_terminal_context_missing_backed_off(
    state: &CloudMcpState,
    terminal_key: &str,
    now_ms: u64,
) -> bool {
    let Ok(mut cache) = state.terminal_context_missing_until_ms.lock() else {
        return false;
    };
    match cache.get(terminal_key).copied() {
        Some(deadline_ms) if deadline_ms > now_ms => true,
        Some(_) => {
            cache.remove(terminal_key);
            false
        }
        None => false,
    }
}

fn cloud_mcp_mark_terminal_context_missing(state: &CloudMcpState, terminal_key: &str, now_ms: u64) {
    let Ok(mut cache) = state.terminal_context_missing_until_ms.lock() else {
        return;
    };
    if cache.len() > CLOUD_MCP_TERMINAL_CONTEXT_MISSING_CACHE_MAX {
        cache.retain(|_, deadline_ms| *deadline_ms > now_ms);
    }
    cache.insert(
        terminal_key.to_string(),
        now_ms.saturating_add(CLOUD_MCP_TERMINAL_CONTEXT_MISSING_BACKOFF_MS),
    );
}

fn cloud_mcp_clear_terminal_context_missing(state: &CloudMcpState, terminal_key: &str) {
    let Ok(mut cache) = state.terminal_context_missing_until_ms.lock() else {
        return;
    };
    cache.remove(terminal_key);
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
    if label.is_empty() { None } else { Some(label) }
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
           AND status IN ('parked', 'parked_cycle_prevented', 'waiting', 'blocked', 'resume_ready', 'resume_requested')
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
    let status_working_directory =
        cloud_mcp_terminal_repo_root_path(working_directory, coordination);
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
            "workspace_root": workspace_path_display(&status_working_directory),
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
    coordination: Option<&TerminalCoordinationSession>,
    pane_id: &str,
    instance_id: u64,
    reason: &str,
) {
    let status_working_directory =
        cloud_mcp_terminal_repo_root_path(working_directory, coordination);
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
        "workspace_root": workspace_path_display(&status_working_directory),
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
    session_mode: Option<&str>,
    reason: &str,
) {
    let status_working_directory =
        cloud_mcp_terminal_repo_root_path(working_directory, coordination);
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
        "session_mode": session_mode.unwrap_or(if coordination.is_some() { "managed_patch" } else { "free" }),
        "claimed_paths": claimed_paths,
        "workspace_root": workspace_path_display(&status_working_directory),
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
            "workspace_root": workspace_path_display(&status_working_directory),
            "session_id": coordination.map(|coordination| coordination.session_id.clone()),
            "session_mode": session_mode.unwrap_or(if coordination.is_some() { "managed_patch" } else { "free" }),
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
        "active" => "active",
        "busy" => "busy",
        "running" => "running",
        "dispatched" => "dispatched",
        "resume_requested" => "resume_requested",
        "merged" | "completed" => "done",
        "blocked" => "blocked",
        "parked" => "parked",
        "resume_ready" => "resume_ready",
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
    match status
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '-'], "_")
        .as_str()
    {
        "parked" | "blocked" | "waiting_on_dependency" => Some("parked"),
        "resume_ready" | "ready_to_resume" => Some("resume_ready"),
        "resume_requested" | "resuming" => Some("resume_requested"),
        "active" | "busy" | "running" | "starting" => Some("running"),
        "dispatched" | "redispatched" => Some("dispatched"),
        "cancelled" | "canceled" => Some("cancelled"),
        "interrupted" | "interrupt" | "stopped" => Some("interrupted"),
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

    let req = cloud_mcp_repo_request(
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
        Some(if coordination.is_some() {
            "managed_patch"
        } else {
            "free"
        }),
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
        }
    }
    if cloud_mcp_lifecycle_status_releases_lane(status) {
        cloud_mcp_release_terminal_lane(
            state,
            &repo_id,
            &agent_id,
            lane,
            working_directory,
            coordination,
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
    let close_preserves_parked_task =
        matches!(reason, "terminal_close" | "close_all" | "drop_fallback");
    let active_task_is_parked = close_preserves_parked_task
        && active_task.as_ref().is_some_and(|task| {
            coordination
                .and_then(|coordination| {
                    crate::coordination::CoordinationKernel::open(
                        &coordination.repo_path,
                        Some(PathBuf::from(&coordination.db_path)),
                    )
                    .ok()
                })
                .and_then(|kernel| kernel.task_has_parked_resource_intents(&task.task_id).ok())
                .unwrap_or(false)
        });

    if let Some(active_task) = active_task.as_ref() {
        let lifecycle_status = if active_task_is_parked {
            "parked"
        } else {
            "interrupted"
        };
        let lifecycle_brief = if active_task_is_parked {
            format!(
                "Terminal closed via {reason}; parked task {} remains waiting for dependency release or session recovery.",
                cloud_mcp_work_subject(&work_subject)
            )
        } else {
            brief.clone()
        };
        cloud_mcp_mark_terminal_task_lifecycle(
            state,
            pane_id,
            instance_id,
            working_directory,
            coordination,
            Some(&active_task.task_id),
            Some(&active_task.title),
            lifecycle_status,
            &lane,
            &lifecycle_brief,
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
        Some(close_context.session_mode.as_str()),
        reason,
    )
    .await;
    cloud_mcp_release_terminal_lane(
        state,
        &repo_id,
        &agent_id,
        &lane,
        working_directory,
        coordination,
        pane_id,
        instance_id,
        reason,
    )
    .await;

    let mut runtime = state.inner.lock().await;
    runtime.terminal_contexts.remove(&terminal_key);
}

fn cloud_mcp_clean_terminal_state_text(text: &str) -> String {
    let mut cleaned = String::with_capacity(text.len().min(2400));
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            match chars.peek().copied() {
                Some('[') => {
                    chars.next();
                    while let Some(next) = chars.next() {
                        if ('@'..='~').contains(&next) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    let mut escaped = false;
                    while let Some(next) = chars.next() {
                        if next == '\u{7}' {
                            break;
                        }
                        if escaped && next == '\\' {
                            break;
                        }
                        escaped = next == '\u{1b}';
                    }
                }
                _ => {
                    let _ = chars.next();
                }
            }
            cleaned.push(' ');
        } else if ch.is_control() {
            cleaned.push(' ');
        } else {
            cleaned.push(ch);
        }
    }

    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn cloud_mcp_terminal_output_has_working_indicator(cleaned_text: &str) -> bool {
    let lower = cleaned_text.to_lowercase();
    lower.contains("working (")
        || lower.contains("esc to interrupt")
        || lower.contains("context refresh")
}

fn cloud_mcp_terminal_output_has_prompt_marker(cleaned_text: &str) -> bool {
    cleaned_text.contains('›')
}

fn cloud_mcp_terminal_output_looks_active(text: &str) -> bool {
    let cleaned = cloud_mcp_clean_terminal_state_text(text);
    if cleaned.is_empty() {
        return false;
    }
    if cloud_mcp_terminal_output_has_working_indicator(&cleaned) {
        return true;
    }
    if cloud_mcp_terminal_output_has_prompt_marker(&cleaned) {
        return false;
    }

    let lower = cleaned.to_lowercase();
    let tool_action = [
        "• called",
        "• ran",
        "• edited",
        "• created",
        "• updated",
        "• modified",
        "• explored",
        "• exploring",
        "• read",
        "• listed",
        "• searched",
        "• checked",
        "• checking",
        "• wrote",
        "• applied",
        "• started",
        "• starting",
    ]
    .iter()
    .any(|needle| lower.contains(needle));

    tool_action
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
}

fn cloud_mcp_terminal_output_looks_ready(text: &str) -> bool {
    let cleaned = cloud_mcp_clean_terminal_state_text(text);
    if cloud_mcp_terminal_output_has_working_indicator(&cleaned) {
        return false;
    }

    text.contains("\n›")
        || text.contains("\r›")
        || text.contains("› ")
        || text.contains("\n> ")
        || text.contains("\r> ")
        || cloud_mcp_terminal_output_has_prompt_marker(&cleaned)
}

fn cloud_mcp_agent_uses_activity_hooks(agent_id: &str) -> bool {
    matches!(
        agent_id.trim().to_ascii_lowercase().as_str(),
        "claude" | "codex"
    )
}

async fn cloud_mcp_observe_terminal_output(
    app: AppHandle,
    state: CloudMcpState,
    pane_id: &str,
    instance_id: u64,
    chunk: &[u8],
) {
    let observe_started_at = Instant::now();
    let terminal_key = cloud_mcp_terminal_key(pane_id, instance_id);
    let hooks_own_turn_state = {
        let runtime = state.inner.lock().await;
        runtime
            .terminal_contexts
            .get(&terminal_key)
            .is_some_and(|entry| cloud_mcp_agent_uses_activity_hooks(&entry.agent_id))
    };
    if hooks_own_turn_state {
        return;
    }
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

    let now_ms = cloud_mcp_now_ms();
    let context_missing_backed_off =
        cloud_mcp_terminal_context_missing_backed_off(&state, &terminal_key, now_ms);
    if !context_missing_backed_off {
        log_terminal_status_event(
            "backend.terminal.ground_truth.output_observed",
            json!({
                "bytes": chunk.len(),
                "decoded_preview": clean_terminal_diagnostic_log_text(&text),
                "instance_id": instance_id,
                "looks_active": looks_active,
                "looks_ready": looks_ready,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "status_truth": if looks_active { "processing_or_active" } else { "idle_or_prompt_ready" },
            }),
        );
    }
    let _ = app.emit(
        TERMINAL_OUTPUT_STATE_EVENT,
        TerminalOutputStatePayload {
            pane_id: pane_id.to_string(),
            instance_id,
            looks_active,
            looks_ready,
            status_truth: if looks_active {
                "processing_or_active".to_string()
            } else {
                "idle_or_prompt_ready".to_string()
            },
            output_preview: clean_terminal_diagnostic_log_text(&text),
        },
    );
    if context_missing_backed_off {
        return;
    }
    let work_brief = cloud_mcp_extract_agent_work_brief(&text);
    let (work_update, completion, missing_context_lock_ms) = {
        let lock_started_at = Instant::now();
        let mut runtime = state.inner.lock().await;
        let lock_ms = terminal_diagnostic_elapsed_ms(lock_started_at);
        match runtime.terminal_contexts.get_mut(&terminal_key) {
            Some(entry) => {
                let hooks_own_turn_state = cloud_mcp_agent_uses_activity_hooks(&entry.agent_id);
                if looks_active && !hooks_own_turn_state {
                    entry.saw_agent_activity = true;
                }
                let work_update = if hooks_own_turn_state {
                    None
                } else if let Some(brief) = work_brief.clone() {
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
                            entry.session_mode.clone(),
                            brief,
                            entry.working_directory.clone(),
                            entry.repo_root.clone(),
                        ))
                    }
                } else {
                    None
                };
                let old_enough = cloud_mcp_now_ms().saturating_sub(entry.created_ms) >= 5_000;
                let completion = if !hooks_own_turn_state
                    && entry.saw_agent_activity
                    && !entry.done_reported
                    && old_enough
                    && looks_ready
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
                        entry.repo_root.clone(),
                        entry.prompt_event_id.clone(),
                        entry.prompt_event_source.clone(),
                        entry.prompt_event_submitted_at.clone(),
                        entry.terminal_index,
                        entry.thread_id.clone(),
                        entry.workspace_id.clone(),
                        entry.workspace_name.clone(),
                        entry.session_mode.clone(),
                        entry.todo_id.clone(),
                        entry.todo_dispatch_id.clone(),
                        entry.todo_command_id.clone(),
                    ))
                } else {
                    None
                };
                if hooks_own_turn_state && (looks_active || looks_ready) {
                    log_terminal_status_event(
                        "backend.terminal.ground_truth.output_hook_managed_ignored",
                        json!({
                            "agent_id": entry.agent_id.clone(),
                            "bytes": chunk.len(),
                            "instance_id": instance_id,
                            "looks_active": looks_active,
                            "looks_ready": looks_ready,
                            "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                            "status_truth": if looks_active { "processing_or_active" } else { "idle_or_prompt_ready" },
                        }),
                    );
                }
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
                (work_update, completion, None)
            }
            None => (None, None, Some(lock_ms)),
        }
    };
    if let Some(lock_ms) = missing_context_lock_ms {
        cloud_mcp_mark_terminal_context_missing(&state, &terminal_key, now_ms);
        log_terminal_status_event(
            "backend.terminal.ground_truth.missing_context",
            json!({
                "bytes": chunk.len(),
                "instance_id": instance_id,
                "looks_active": looks_active,
                "looks_ready": looks_ready,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "status_truth": if looks_active { "processing_or_active" } else { "idle_or_prompt_ready" },
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
    }

    log_terminal_status_event(
        "backend.terminal.ground_truth.output_decision",
        json!({
            "bytes": chunk.len(),
            "instance_id": instance_id,
            "looks_active": looks_active,
            "looks_ready": looks_ready,
            "pane_id": clean_terminal_diagnostic_log_text(pane_id),
            "status_truth": if looks_active { "processing_or_active" } else { "idle_or_prompt_ready" },
            "will_mark_done": completion.is_some(),
            "will_send_active_update": work_update.is_some(),
        }),
    );

    if let Some((
        repo_id,
        agent_id,
        lane,
        local_task_id,
        session_mode,
        brief,
        _working_directory,
        repo_root,
    )) = work_update
    {
        cloud_mcp_sync_terminal_agent_status(
            &state,
            &repo_id,
            &agent_id,
            &lane,
            "active",
            None,
            &brief,
            &repo_root,
            pane_id,
            instance_id,
            None,
            local_task_id.as_deref(),
            Some(session_mode.as_str()),
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
        repo_root,
        prompt_event_id,
        prompt_event_source,
        prompt_event_submitted_at,
        terminal_index,
        thread_id,
        workspace_id,
        _workspace_name,
        session_mode,
        todo_id,
        todo_dispatch_id,
        todo_command_id,
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
            "session_mode": session_mode.clone(),
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
    if let (Some(todo_id), Some(dispatch_id), Some(command_id)) =
        (todo_id, todo_dispatch_id, todo_command_id)
    {
        cloud_mcp_record_direct_prompt_todo_dispatch_status(
            &state,
            &CloudMcpDirectPromptTodoRefs {
                todo_id,
                dispatch_id,
                command_id,
            },
            &workspace_id,
            "completed",
            json!({
                "reason": "terminal_prompt_ready",
                "agent_id": agent_id,
                "pane_id": pane_id,
                "prompt_event_id": prompt_event_id,
                "thread_id": thread_id,
            }),
        )
        .await;
    }
    if session_mode != TerminalSessionMode::ManagedPatch.as_str() {
        let brief = if work_brief.trim().is_empty() {
            "Terminal activity is idle.".to_string()
        } else {
            format!(
                "Terminal activity ready: {}",
                cloud_mcp_work_subject(&work_brief)
            )
        };
        cloud_mcp_sync_terminal_agent_status(
            &state,
            &repo_id,
            &agent_id,
            &lane,
            "inactive",
            None,
            &brief,
            &repo_root,
            pane_id,
            instance_id,
            None,
            local_task_id.as_deref(),
            Some(session_mode.as_str()),
            "terminal_unmanaged_prompt_ready",
        )
        .await;

        let mut runtime = state.inner.lock().await;
        runtime.terminal_contexts.remove(&terminal_key);
        return;
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
        &repo_root,
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
        &repo_root,
        pane_id,
        instance_id,
        None,
        local_task_id.as_deref(),
        Some(session_mode.as_str()),
        "terminal_prompt_ready",
    )
    .await;
    cloud_mcp_release_terminal_lane(
        &state,
        &repo_id,
        &agent_id,
        &lane,
        &repo_root,
        None,
        pane_id,
        instance_id,
        "terminal_prompt_ready",
    )
    .await;

    let mut runtime = state.inner.lock().await;
    runtime.terminal_contexts.remove(&terminal_key);
}

async fn cloud_mcp_record_direct_prompt_todo_dispatch(
    state: &CloudMcpState,
    refs: &CloudMcpDirectPromptTodoRefs,
    repo_id: &str,
    repo_root: &Path,
    pane_id: &str,
    instance_id: u64,
    agent_id: &str,
    agent_kind: Option<&str>,
    prompt: &str,
    prompt_metadata: &CloudMcpTerminalPromptMetadata,
    session_mode: &str,
) {
    let workspace_id = prompt_metadata.workspace_id.trim();
    if workspace_id.is_empty() || prompt.trim().is_empty() {
        return;
    }
    let device_profile = cloud_mcp_desktop_device_profile();
    let device_id = device_profile["device_id"]
        .as_str()
        .unwrap_or("rust-diffforge-desktop")
        .to_string();
    let device_name = device_profile["device_name"]
        .as_str()
        .unwrap_or("Desktop")
        .to_string();
    let workspace_name = prompt_metadata.workspace_name.trim();
    let workspace_root = workspace_path_display(repo_root);
    let title = cloud_mcp_prompt_summary(prompt);
    let todo_id = refs.todo_id.as_str();
    let dispatch_id = refs.dispatch_id.as_str();
    let command_id = refs.command_id.as_str();
    let prompt_event_id = prompt_metadata.prompt_event_id.as_deref();
    let prompt_event_source = prompt_metadata.prompt_event_source.as_deref();
    let prompt_event_submitted_at = prompt_metadata.prompt_event_submitted_at.as_deref();
    let thread_id = prompt_metadata.thread_id.as_deref();
    let agent_kind = agent_kind.unwrap_or_default();
    let created_at = prompt_metadata
        .prompt_event_submitted_at
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let mut snapshot_payload = json!({
        "event_kind": "workspace_todo_snapshot",
        "source": "rust-diffforge-direct-prompt",
        "reason": "terminal_prompt_submitted",
        "repo_id": repo_id,
        "workspace_id": workspace_id,
        "workspaceId": workspace_id,
        "workspace_name": workspace_name,
        "workspaceName": workspace_name,
        "workspace_root": workspace_root,
        "workspaceRoot": workspace_root,
        "device": device_profile.clone(),
        "device_id": device_id.as_str(),
        "deviceId": device_id.as_str(),
        "machine_id": device_id.as_str(),
        "machineId": device_id.as_str(),
        "device_name": device_name.as_str(),
        "machine_name": device_name.as_str(),
        "snapshot_full": false,
        "snapshotFull": false,
        "prune_missing": false,
        "pruneMissing": false,
        "todos": [{
            "id": todo_id,
            "todo_id": todo_id,
            "todoId": todo_id,
            "todo_dispatch_id": dispatch_id,
            "todoDispatchId": dispatch_id,
            "command_id": command_id,
            "commandId": command_id,
            "text": prompt,
            "body": prompt,
            "title": title,
            "status": "running",
            "todo_status": "running",
            "todoStatus": "running",
            "source": "direct-terminal-prompt",
            "source_kind": "direct-terminal-prompt",
            "sourceKind": "direct-terminal-prompt",
            "prompt_event_id": prompt_event_id,
            "promptEventId": prompt_event_id,
            "prompt_event_source": prompt_event_source,
            "promptEventSource": prompt_event_source,
            "prompt_event_submitted_at": prompt_event_submitted_at,
            "promptEventSubmittedAt": prompt_event_submitted_at,
            "created_at": created_at,
            "createdAt": created_at,
            "agent_id": agent_id,
            "agentId": agent_id,
            "agent_kind": agent_kind,
            "agentKind": agent_kind,
            "terminal_id": pane_id,
            "terminalId": pane_id,
            "pane_id": pane_id,
            "paneId": pane_id,
            "terminal_instance_id": instance_id,
            "terminalInstanceId": instance_id,
            "terminal_index": prompt_metadata.terminal_index,
            "terminalIndex": prompt_metadata.terminal_index,
            "thread_id": thread_id,
            "threadId": thread_id,
            "session_mode": session_mode,
            "sessionMode": session_mode
        }],
        "ts_ms": cloud_mcp_now_ms(),
    });
    cloud_mcp_limit_workspace_todo_sync_payload(&mut snapshot_payload);
    if let Err(error) =
        cloud_mcp_post_event_endpoint(state, "workspace_todo_snapshot", &snapshot_payload).await
    {
        log_terminal_status_event(
            "backend.direct_prompt_todo.snapshot_error",
            json!({
                "dispatch_id": dispatch_id,
                "error": clean_terminal_telemetry_text(&error),
                "todo_id": todo_id,
                "workspace_id": workspace_id,
            }),
        );
        return;
    }

    let mut dispatch_payload = json!({
        "event_kind": "workspace_todo_dispatch_requested",
        "source": "rust-diffforge-direct-prompt",
        "reason": "terminal_prompt_submitted",
        "repo_id": repo_id,
        "workspace_id": workspace_id,
        "workspaceId": workspace_id,
        "workspace_name": workspace_name,
        "workspaceName": workspace_name,
        "workspace_root": workspace_root,
        "workspaceRoot": workspace_root,
        "device": device_profile,
        "device_id": device_id.as_str(),
        "deviceId": device_id.as_str(),
        "machine_id": device_id.as_str(),
        "machineId": device_id.as_str(),
        "device_name": device_name.as_str(),
        "machine_name": device_name.as_str(),
        "requested_by_device_id": device_id.as_str(),
        "requestedByDeviceId": device_id.as_str(),
        "requested_by_workspace_id": workspace_id,
        "requestedByWorkspaceId": workspace_id,
        "dispatch_id": dispatch_id,
        "dispatchId": dispatch_id,
        "todo_dispatch_id": dispatch_id,
        "todoDispatchId": dispatch_id,
        "command_id": command_id,
        "commandId": command_id,
        "dispatch_kind": "local",
        "dispatchKind": "local",
        "todo_id": todo_id,
        "todoId": todo_id,
        "todo_device_id": device_id.as_str(),
        "todoDeviceId": device_id.as_str(),
        "todo_workspace_id": workspace_id,
        "todoWorkspaceId": workspace_id,
        "target_device_id": device_id.as_str(),
        "targetDeviceId": device_id.as_str(),
        "target_workspace_id": workspace_id,
        "targetWorkspaceId": workspace_id,
        "target_workspace_name": workspace_name,
        "targetWorkspaceName": workspace_name,
        "target_device_name": device_name.as_str(),
        "targetDeviceName": device_name.as_str(),
        "target_agent_id": agent_id,
        "targetAgentId": agent_id,
        "target_terminal_id": pane_id,
        "targetTerminalId": pane_id,
        "target_terminal_index": prompt_metadata.terminal_index,
        "targetTerminalIndex": prompt_metadata.terminal_index,
        "target_thread_id": thread_id,
        "targetThreadId": thread_id,
        "prompt_event_id": prompt_event_id,
        "promptEventId": prompt_event_id,
        "session_mode": session_mode,
        "sessionMode": session_mode,
        "ts_ms": cloud_mcp_now_ms(),
    });
    cloud_mcp_limit_workspace_todo_sync_payload(&mut dispatch_payload);
    if let Err(error) = cloud_mcp_post_event_endpoint(
        state,
        "workspace_todo_dispatch_requested",
        &dispatch_payload,
    )
    .await
    {
        log_terminal_status_event(
            "backend.direct_prompt_todo.dispatch_error",
            json!({
                "dispatch_id": dispatch_id,
                "error": clean_terminal_telemetry_text(&error),
                "todo_id": todo_id,
                "workspace_id": workspace_id,
            }),
        );
        return;
    }

    cloud_mcp_record_direct_prompt_todo_dispatch_status(
        state,
        refs,
        workspace_id,
        "running",
        json!({
            "reason": "terminal_prompt_submitted",
            "terminal_id": pane_id,
            "terminal_instance_id": instance_id,
            "prompt_event_id": prompt_metadata.prompt_event_id,
        }),
    )
    .await;
}

async fn cloud_mcp_record_direct_prompt_todo_dispatch_status(
    state: &CloudMcpState,
    refs: &CloudMcpDirectPromptTodoRefs,
    workspace_id: &str,
    status: &str,
    details: Value,
) {
    if refs.dispatch_id.trim().is_empty() {
        return;
    }
    let device_profile = cloud_mcp_desktop_device_profile();
    let todo_id = refs.todo_id.as_str();
    let dispatch_id = refs.dispatch_id.as_str();
    let command_id = refs.command_id.as_str();
    let mut payload = json!({
        "event_kind": "workspace_todo_dispatch_status",
        "source": "rust-diffforge-direct-prompt",
        "todo_dispatch_id": dispatch_id,
        "todoDispatchId": dispatch_id,
        "dispatch_id": dispatch_id,
        "dispatchId": dispatch_id,
        "command_id": command_id,
        "commandId": command_id,
        "todo_id": todo_id,
        "todoId": todo_id,
        "workspace_id": workspace_id,
        "workspaceId": workspace_id,
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "deviceId": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "status": status,
        "dispatch_status": status,
        "dispatchStatus": status,
        "details": details,
        "ts_ms": cloud_mcp_now_ms(),
    });
    if let Some(dispatch_source) = cloud_mcp_payload_object(
        &details,
        &[
            "dispatchSource",
            "dispatch_source",
            "sourceContext",
            "source_context",
            "sourceEndpoint",
            "source_endpoint",
        ],
    ) {
        payload["dispatch_source"] = dispatch_source.clone();
        payload["dispatchSource"] = dispatch_source;
    }
    if let Some(dispatch_target) = cloud_mcp_payload_object(
        &details,
        &[
            "dispatchTarget",
            "dispatch_target",
            "targetContext",
            "target_context",
            "targetEndpoint",
            "target_endpoint",
        ],
    ) {
        payload["dispatch_target"] = dispatch_target.clone();
        payload["dispatchTarget"] = dispatch_target;
    }
    for (target_key, source_keys) in [
        (
            "target_agent_id",
            &["target_agent_id", "targetAgentId", "agent_id", "agentId"][..],
        ),
        (
            "target_terminal_id",
            &[
                "target_terminal_id",
                "targetTerminalId",
                "terminal_id",
                "terminalId",
                "pane_id",
                "paneId",
            ][..],
        ),
        (
            "target_terminal_index",
            &[
                "target_terminal_index",
                "targetTerminalIndex",
                "terminal_index",
                "terminalIndex",
            ][..],
        ),
        (
            "target_thread_id",
            &["target_thread_id", "targetThreadId", "thread_id", "threadId"][..],
        ),
        (
            "target_color_slot",
            &["target_color_slot", "targetColorSlot", "color_slot", "colorSlot"][..],
        ),
        (
            "target_terminal_color",
            &[
                "target_terminal_color",
                "targetTerminalColor",
                "terminal_color",
                "terminalColor",
                "color",
            ][..],
        ),
    ] {
        if let Some(value) = cloud_mcp_payload_text(&details, source_keys) {
            payload[target_key] = json!(value);
        }
    }
    cloud_mcp_limit_workspace_todo_sync_payload(&mut payload);
    if let Err(error) =
        cloud_mcp_post_event_endpoint(state, "workspace_todo_dispatch_status", &payload).await
    {
        log_terminal_status_event(
            "backend.direct_prompt_todo.status_error",
            json!({
                "dispatch_id": dispatch_id,
                "error": clean_terminal_telemetry_text(&error),
                "status": status,
                "todo_id": todo_id,
                "workspace_id": workspace_id,
            }),
        );
    }
}

async fn cloud_mcp_terminal_context_pack_for_prompt(
    state: CloudMcpState,
    pane_id: String,
    instance_id: u64,
    working_directory: PathBuf,
    coordination: Option<TerminalCoordinationSession>,
    session_mode: TerminalSessionMode,
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
    let status_working_directory =
        cloud_mcp_terminal_repo_root_path(&working_directory, coordination.as_ref());
    let terminal_key = cloud_mcp_terminal_key(&pane_id, instance_id);
    let prompt_metadata = prompt_metadata.unwrap_or_else(|| CloudMcpTerminalPromptMetadata {
        prompt_event_id: None,
        prompt_event_source: None,
        prompt_event_submitted_at: None,
        terminal_index: None,
        thread_id: None,
        workspace_id: String::new(),
        workspace_name: String::new(),
        todo_id: None,
        todo_dispatch_id: None,
        todo_command_id: None,
        todo_action: None,
        todo_resume_requested: false,
    });
    let direct_prompt_todo_refs = cloud_mcp_direct_prompt_todo_refs(
        &prompt_metadata.workspace_id,
        &pane_id,
        instance_id,
        prompt_metadata.terminal_index,
        &prompt,
        &prompt_metadata,
    );
    let effective_todo_id = cloud_mcp_clean_optional_text(&prompt_metadata.todo_id)
        .or_else(|| direct_prompt_todo_refs.as_ref().map(|refs| refs.todo_id.clone()));
    let effective_todo_dispatch_id = cloud_mcp_clean_optional_text(&prompt_metadata.todo_dispatch_id)
        .or_else(|| {
            direct_prompt_todo_refs
                .as_ref()
                .map(|refs| refs.dispatch_id.clone())
        });
    let effective_todo_command_id = cloud_mcp_clean_optional_text(&prompt_metadata.todo_command_id)
        .or_else(|| {
            direct_prompt_todo_refs
                .as_ref()
                .map(|refs| refs.command_id.clone())
        });
    let effective_todo_action = cloud_mcp_clean_optional_text(&prompt_metadata.todo_action);
    let effective_todo_resume_requested = prompt_metadata.todo_resume_requested;
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
                repo_root: status_working_directory.clone(),
                prompt_event_id: prompt_metadata.prompt_event_id.clone(),
                prompt_event_source: prompt_metadata.prompt_event_source.clone(),
                prompt_event_submitted_at: prompt_metadata.prompt_event_submitted_at.clone(),
                terminal_index: prompt_metadata.terminal_index,
                thread_id: prompt_metadata.thread_id.clone(),
                workspace_id: prompt_metadata.workspace_id.clone(),
                workspace_name: prompt_metadata.workspace_name.clone(),
                session_mode: session_mode.as_str().to_string(),
                todo_id: effective_todo_id.clone(),
                todo_dispatch_id: effective_todo_dispatch_id.clone(),
                todo_command_id: effective_todo_command_id.clone(),
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
    cloud_mcp_clear_terminal_context_missing(&state, &terminal_key);

    if let Err(error) = cloud_mcp_connected_or_connect(&state).await {
        let _ = cloud_mcp_workspace_log(
            &status_working_directory,
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

    if let Some(refs) = direct_prompt_todo_refs.as_ref() {
        cloud_mcp_record_direct_prompt_todo_dispatch(
            &state,
            refs,
            &repo_id,
            &status_working_directory,
            &pane_id,
            instance_id,
            &agent_id,
            coordination
                .as_ref()
                .map(|coordination| coordination.agent_kind.as_str()),
            &prompt,
            &prompt_metadata,
            session_mode.as_str(),
        )
        .await;
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
        "todo_id": effective_todo_id.as_deref(),
        "todoId": effective_todo_id.as_deref(),
        "todo_dispatch_id": effective_todo_dispatch_id.as_deref(),
        "todoDispatchId": effective_todo_dispatch_id.as_deref(),
        "command_id": effective_todo_command_id.as_deref(),
        "commandId": effective_todo_command_id.as_deref(),
        "todo_action": effective_todo_action.as_deref(),
        "todoAction": effective_todo_action.as_deref(),
        "todo_resume_requested": effective_todo_resume_requested,
        "todoResumeRequested": effective_todo_resume_requested,
        "resume_requested": effective_todo_resume_requested,
        "resumeRequested": effective_todo_resume_requested,
        "task_id": local_task_id.clone(),
        "run_id": local_task_id.clone(),
        "prompt": prompt,
        "session_mode": session_mode.as_str(),
        "file_authority": session_mode.file_authority(),
        "workspace_root": workspace_path_display(&status_working_directory),
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
        if session_mode.should_request_cloud_context_pack() {
            "Terminal prompt submitted; preparing Task History context."
        } else {
            "Terminal prompt submitted without managed patch coordination."
        },
        &status_working_directory,
        &pane_id,
        instance_id,
        coordination.as_ref(),
        local_task_id.as_deref(),
        Some(session_mode.as_str()),
        "terminal_prompt_submitted",
    )
    .await;

    if !session_mode.should_request_cloud_context_pack() {
        let lane = format!("terminal-{}", session_mode.as_str());
        {
            let mut runtime = state.inner.lock().await;
            if let Some(entry) = runtime.terminal_contexts.get_mut(&terminal_key) {
                entry.lane = lane.clone();
            }
        }
        cloud_mcp_sync_terminal_agent_status(
            &state,
            &repo_id,
            &agent_id,
            &lane,
            "active",
            payload["prompt"].as_str(),
            "Terminal activity is running outside managed patch mode.",
            &status_working_directory,
            &pane_id,
            instance_id,
            coordination.as_ref(),
            local_task_id.as_deref(),
            Some(session_mode.as_str()),
            "terminal_unmanaged_context_ready",
        )
        .await;
        return;
    }

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
                &status_working_directory,
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
                &status_working_directory,
                &pane_id,
                instance_id,
                coordination.as_ref(),
                local_task_id.as_deref(),
                Some(session_mode.as_str()),
                "terminal_context_ready",
            )
            .await;
            cloud_mcp_claim_terminal_lane(
                &state,
                &repo_id,
                &agent_id,
                &suggested_lane,
                payload["prompt"].as_str().unwrap_or_default(),
                &status_working_directory,
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
                &status_working_directory,
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
    let status_working_directory =
        cloud_mcp_terminal_repo_root_path(&working_directory, coordination.as_ref());
    for _ in 0..40 {
        tokio::time::sleep(Duration::from_secs(8)).await;
        if let Some((local_task_id, work_brief, session_mode)) = {
            let runtime = state.inner.lock().await;
            runtime.terminal_contexts.get(&terminal_key).map(|entry| {
                (
                    entry.local_task_id.clone(),
                    entry.work_brief.clone(),
                    entry.session_mode.clone(),
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
                Some(session_mode.as_str()),
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
                &status_working_directory,
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
                Some("managed_patch"),
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
            "workspace_root": workspace_path_display(&status_working_directory),
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
                    &status_working_directory,
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
                    &status_working_directory,
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

async fn cloud_mcp_signal_desktop_closing(app: &AppHandle, reason: &str) -> Result<Value, String> {
    let state = app.state::<CloudMcpState>().inner().clone();
    if !cloud_mcp_status_snapshot(&state).await.global_ws_connected {
        return Ok(json!({
            "ok": true,
            "sent": false,
            "reason": "websocket_not_connected",
        }));
    }

    let reason = reason.trim();
    let result = timeout(
        Duration::from_millis(900),
        cloud_mcp_send_lifecycle_event(
            &state,
            "desktop_client_closing",
            "closing",
            Some(if reason.is_empty() {
                "app_shutdown"
            } else {
                reason
            }),
        ),
    )
    .await
    .map_err(|_| "Timed out sending desktop close signal to Cloud MCP.".to_string())??;
    sleep(Duration::from_millis(150)).await;
    Ok(result)
}

#[tauri::command]
async fn cloud_mcp_set_desktop_session_token(
    state: State<'_, CloudMcpState>,
    token: Option<String>,
    scope_type: Option<String>,
    team_id: Option<String>,
    plan_name: Option<String>,
    device_limit: Option<u64>,
) -> Result<CloudMcpStatus, String> {
    let token = token
        .unwrap_or_default()
        .replace(|character: char| character.is_control(), "")
        .trim()
        .to_string();
    let desktop_session_token = if token.is_empty() {
        None
    } else {
        validate_auth_value("Desktop session", &token)?;
        Some(token)
    };
    let (billing_scope_type, team_id) = cloud_mcp_account_scope_from_values(scope_type, team_id);
    let plan_name = cloud_mcp_plan_name_from_value(plan_name);
    let device_limit = cloud_mcp_device_limit_from_value(device_limit, &plan_name);

    {
        let mut auth = state.auth.lock().await;
        auth.desktop_session_token = desktop_session_token.clone();
        auth.appwrite_jwt = None;
        auth.appwrite_jwt_expires_ms = None;
        auth.billing_scope_type = billing_scope_type.clone();
        auth.team_id = team_id.clone();
        auth.plan_name = plan_name.clone();
        auth.device_limit = device_limit;
    }
    cloud_mcp_update_process_auth_cache(
        desktop_session_token,
        None,
        None,
        Some(billing_scope_type),
        team_id,
        Some(plan_name),
        device_limit,
    );
    if state
        .global_ws_registration_blocked
        .swap(false, Ordering::SeqCst)
    {
        let mut runtime = state.inner.lock().await;
        if runtime.global_ws_status == "device_limit_reached" {
            runtime.connected = false;
            runtime.status = "starting".to_string();
            runtime.last_error.clear();
            runtime.global_ws_connected = false;
            runtime.global_ws_status = "starting".to_string();
            runtime.global_ws_last_error.clear();
            runtime.global_ws_connection_id = None;
            runtime.global_ws_message_token = None;
            runtime.live_runtime_status = None;
        }
        drop(runtime);
        state.global_ws_reconnect.notify_waiters();
    }

    Ok(cloud_mcp_status_snapshot(state.inner()).await)
}

#[tauri::command]
async fn cloud_mcp_get_status(state: State<'_, CloudMcpState>) -> Result<CloudMcpStatus, String> {
    Ok(cloud_mcp_status_snapshot(state.inner()).await)
}

#[tauri::command]
async fn cloud_mcp_get_billing_status(state: State<'_, CloudMcpState>) -> Result<Value, String> {
    let token = cloud_mcp_authorization_bearer(state.inner())
        .await?
        .ok_or_else(|| "Cloud MCP auth token is not available.".to_string())?;
    let (billing_scope_type, team_id) = cloud_mcp_account_scope(state.inner()).await;

    let client = http_client(Duration::from_secs(DEFAULT_API_TIMEOUT_SECS))?;
    let response = client
        .post(format!("{API_BASE_URL}/billing/status"))
        .bearer_auth(token)
        .json(&json!({
            "scopeType": billing_scope_type,
            "teamId": team_id,
        }))
        .send()
        .await
        .map_err(|error| format!("Unable to load billing status: {error}"))?;

    read_api_response(response, "Unable to load billing status.").await
}

#[tauri::command]
async fn cloud_mcp_register_workspace(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<CloudMcpWorkspaceRegistrationResult, String> {
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        cloud_mcp_prepare_workspace_bundle(repo_path, workspace_id, workspace_name)
    })
    .await
    .map_err(|error| format!("Unable to prepare Cloud MCP registration: {error}"))??;

    cloud_mcp_register_prepared_workspace_bundle(state.inner(), prepared, "workspace_registration")
        .await
}

#[tauri::command]
async fn cloud_mcp_sync_workspace(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<CloudMcpWorkspaceRegistrationResult, String> {
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        cloud_mcp_prepare_workspace_bundle(repo_path, workspace_id, workspace_name)
    })
    .await
    .map_err(|error| format!("Unable to prepare Cloud MCP sync: {error}"))??;

    cloud_mcp_register_prepared_workspace_bundle(state.inner(), prepared, "workspace_sync").await
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
    let req = cloud_mcp_repo_request(repo_path, workspace_id.clone(), workspace_name.clone());
    let snapshot_id = format!(
        "agent-installations-{}-{}",
        cloud_mcp_now_ms(),
        uuid::Uuid::new_v4()
    );
    let device_profile = cloud_mcp_desktop_device_profile();
    let mut tagged_agent_statuses = agent_statuses;
    let agent_items = tagged_agent_statuses
        .as_array_mut()
        .ok_or_else(|| "Agent installation sync requires an agentStatuses array.".to_string())?;
    let agent_count = agent_items.len();
    for agent in agent_items {
        let Some(object) = agent.as_object_mut() else {
            continue;
        };
        cloud_mcp_set_missing_agent_device_field(
            object,
            "device_id",
            device_profile["device_id"].clone(),
        );
        cloud_mcp_set_missing_agent_device_field(
            object,
            "deviceId",
            device_profile["device_id"].clone(),
        );
        cloud_mcp_set_missing_agent_device_field(
            object,
            "machine_id",
            device_profile["device_id"].clone(),
        );
        cloud_mcp_set_missing_agent_device_field(
            object,
            "machineId",
            device_profile["device_id"].clone(),
        );
        cloud_mcp_set_missing_agent_device_field(
            object,
            "device_name",
            device_profile["device_name"].clone(),
        );
        cloud_mcp_set_missing_agent_device_field(
            object,
            "deviceName",
            device_profile["device_name"].clone(),
        );
        cloud_mcp_set_missing_agent_device_field(
            object,
            "machine_name",
            device_profile["machine_name"].clone(),
        );
        cloud_mcp_set_missing_agent_device_field(
            object,
            "machineName",
            device_profile["machine_name"].clone(),
        );
        cloud_mcp_set_missing_agent_device_field(
            object,
            "platform",
            device_profile["platform"].clone(),
        );
        cloud_mcp_set_missing_agent_device_field(
            object,
            "form_factor",
            device_profile["form_factor"].clone(),
        );
        cloud_mcp_set_missing_agent_device_field(
            object,
            "formFactor",
            device_profile["form_factor"].clone(),
        );
        cloud_mcp_set_missing_agent_device_field(
            object,
            "client_kind",
            device_profile["client_kind"].clone(),
        );
        cloud_mcp_set_missing_agent_device_field(
            object,
            "clientKind",
            device_profile["client_kind"].clone(),
        );
    }
    let payload = json!({
        "source": "rust-diffforge-agent-installation-sync",
        "event_kind": "agent_installation_snapshot",
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_id": device_profile["device_id"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "platform": device_profile["platform"].clone(),
        "form_factor": device_profile["form_factor"].clone(),
        "client_kind": device_profile["client_kind"].clone(),
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
        "agents": tagged_agent_statuses,
        "summary": "Desktop installed agent inventory synced.",
        "ts_ms": cloud_mcp_now_ms(),
    });

    cloud_mcp_post_event_endpoint(state.inner(), "agent_installation_snapshot", &payload).await
}

fn cloud_mcp_set_missing_agent_device_field(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Value,
) {
    let has_value = object.get(key).is_some_and(|current| match current {
        Value::String(text) => !text.trim().is_empty(),
        Value::Null => false,
        _ => true,
    });
    if !has_value {
        object.insert(key.to_string(), value);
    }
}

#[tauri::command]
async fn cloud_mcp_sync_terminal_presence(
    state: State<'_, CloudMcpState>,
    workspaces: Value,
    reason: Option<String>,
) -> Result<Value, String> {
    let clean_option = |value: Option<String>| {
        value
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let reason = clean_option(reason).unwrap_or_else(|| "terminal_presence_snapshot".to_string());
    let workspace_items = workspaces
        .as_array()
        .ok_or_else(|| "Terminal presence sync requires a workspaces array.".to_string())?;
    let mut normalized_workspaces = Vec::new();
    let device_profile = cloud_mcp_desktop_device_profile();

    for workspace in workspace_items.iter().take(64) {
        let repo_path = cloud_mcp_payload_text(
            workspace,
            &[
                "repo_path",
                "repoPath",
                "workspace_root",
                "workspaceRoot",
                "workspace_root_directory",
                "workspaceRootDirectory",
                "workingDirectory",
                "rootDirectory",
                "terminalWorkspaceWorkingDirectory",
            ],
        )
        .unwrap_or_default();
        if repo_path.trim().is_empty() {
            continue;
        }

        let workspace_id =
            cloud_mcp_payload_text(workspace, &["workspace_id", "workspaceId", "id"]);
        let workspace_name =
            cloud_mcp_payload_text(workspace, &["workspace_name", "workspaceName", "name"]);
        let workspace_active = workspace
            .get("workspace_active")
            .or_else(|| workspace.get("workspaceActive"))
            .or_else(|| workspace.get("active"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let workspace_status = cloud_mcp_payload_text(
            workspace,
            &["workspace_status", "workspaceStatus", "status"],
        )
        .unwrap_or_else(|| {
            if workspace_active {
                "active".to_string()
            } else {
                "deactivated".to_string()
            }
        });
        let req = cloud_mcp_repo_request(repo_path, workspace_id.clone(), workspace_name.clone());
        let git_identity = cloud_mcp_git_repo_identity_for_path(Path::new(&req.root_display));
        let terminal_items = cloud_mcp_workspace_terminal_items(workspace);
        let terminals = terminal_items
            .iter()
            .enumerate()
            .map(|(index, terminal)| {
                let terminal_index = terminal
                    .get("terminal_index")
                    .or_else(|| terminal.get("terminalIndex"))
                    .and_then(Value::as_i64)
                    .unwrap_or(index as i64)
                    .clamp(0, 255);
                let agent_kind = cloud_mcp_payload_text(
                    terminal,
                    &[
                        "agent_kind",
                        "agentKind",
                        "agent_id",
                        "agentId",
                        "role",
                        "provider",
                        "binary",
                        "kind",
                    ],
                )
                .unwrap_or_else(|| "terminal".to_string());
                let agent_label =
                    cloud_mcp_payload_text(terminal, &["agent_label", "agentLabel", "label"])
                        .unwrap_or_else(|| agent_kind.clone());
                let terminal_nickname = cloud_mcp_terminal_nickname_text(
                    terminal,
                    &[
                        "terminal_nickname",
                        "terminalNickname",
                        "terminal_name",
                        "terminalName",
                        "display_name",
                        "displayName",
                    ],
                );
                let status = cloud_mcp_payload_text(terminal, &["status", "state"])
                    .unwrap_or_else(|| "active".to_string());
                let session_state =
                    cloud_mcp_payload_text(terminal, &["session_state", "sessionState"])
                        .unwrap_or_else(|| "unknown".to_string());
                let terminal_instance_id = terminal
                    .get("terminal_instance_id")
                    .or_else(|| terminal.get("terminalInstanceId"))
                    .cloned()
                    .unwrap_or(Value::Null);
                let status_seq = terminal
                    .get("status_seq")
                    .or_else(|| terminal.get("statusSeq"))
                    .cloned()
                    .unwrap_or(Value::Null);
                let input_ready = terminal
                    .get("input_ready")
                    .or_else(|| terminal.get("inputReady"))
                    .cloned()
                    .unwrap_or(Value::Null);
                json!({
                    "device": device_profile.clone(),
                    "device_id": device_profile["device_id"].clone(),
                    "machine_id": device_profile["device_id"].clone(),
                    "presence_agent_id": cloud_mcp_payload_text(
                        terminal,
                        &["presence_agent_id", "presenceAgentId", "id"],
                    ),
                    "agent_kind": agent_kind,
                    "agent_label": agent_label,
                    "display_name": terminal_nickname.clone(),
                    "status": status,
                    "session_state": session_state,
                    "terminal_name": terminal_nickname.clone(),
                    "terminal_nickname": terminal_nickname,
                    "terminal_index": terminal_index,
                    "terminal_epoch": cloud_mcp_payload_text(terminal, &["terminal_epoch", "terminalEpoch"]),
                    "terminal_instance_id": terminal_instance_id,
                    "terminal_lifecycle": cloud_mcp_payload_text(terminal, &["terminal_lifecycle", "terminalLifecycle", "lifecycle"]),
                    "native_rail_state": cloud_mcp_payload_text(terminal, &["native_rail_state", "nativeRailState", "rail_state", "railState", "top_rail_state", "topRailState"]),
                    "native_rail_label": cloud_mcp_payload_text(terminal, &["native_rail_label", "nativeRailLabel", "rail_label", "railLabel", "top_rail_label", "topRailLabel"]),
                    "readiness": cloud_mcp_payload_text(terminal, &["readiness", "terminal_readiness", "terminalReadiness"]),
                    "turn_id": cloud_mcp_payload_text(terminal, &["turn_id", "turnId", "latest_turn_id", "latestTurnId"]),
                    "turn_status": cloud_mcp_payload_text(terminal, &["turn_status", "turnStatus", "latest_turn_status", "latestTurnStatus"]),
                    "status_seq": status_seq,
                    "input_ready": input_ready,
                    "parked": terminal
                        .get("parked")
                        .or_else(|| terminal.get("terminal_parked"))
                        .or_else(|| terminal.get("terminalParked"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "parked_prompt_title": cloud_mcp_payload_text(
                        terminal,
                        &[
                            "parked_prompt_title",
                            "parkedPromptTitle",
                            "parked_title",
                            "parkedTitle",
                        ],
                    ),
                    "pane_id": cloud_mcp_payload_text(terminal, &["pane_id", "paneId"]),
                    "terminal_id": cloud_mcp_payload_text(terminal, &["terminal_id", "terminalId", "pane_id", "paneId"]),
                    "thread_id": cloud_mcp_payload_text(terminal, &["thread_id", "threadId"]),
                    "color": cloud_mcp_payload_text(terminal, &["color", "accent", "accentColor"]),
                    "color_slot": cloud_mcp_payload_text(terminal, &["color_slot", "colorSlot", "color_index", "colorIndex", "slot"]),
                    "waiting_on": terminal
                        .get("waiting_on")
                        .or_else(|| terminal.get("waitingOn"))
                        .cloned()
                        .unwrap_or(Value::Null),
                })
            })
            .collect::<Vec<_>>();

        let terminal_count = terminals.len();
        let mut workspace_value = json!({
            "device": device_profile.clone(),
            "device_id": device_profile["device_id"].clone(),
            "device_name": device_profile["device_name"].clone(),
            "machine_id": device_profile["device_id"].clone(),
            "machine_name": device_profile["machine_name"].clone(),
            "platform": device_profile["platform"].clone(),
            "form_factor": device_profile["form_factor"].clone(),
            "client_kind": device_profile["client_kind"].clone(),
            "repo_id": req.repo_id,
            "workspace_root": req.root_display,
            "workspace_active": workspace_active,
            "workspace_id": req.workspace_id,
            "workspace_name": req.workspace_name,
            "workspace_status": workspace_status,
            "terminal_count": terminal_count,
            "terminals": terminals,
        });
        cloud_mcp_apply_git_identity_to_value(&mut workspace_value, &git_identity);
        normalized_workspaces.push(workspace_value);
    }
    let terminal_count = normalized_workspaces
        .iter()
        .map(|workspace| {
            workspace
                .get("terminals")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or_default()
        })
        .sum::<usize>();
    let workspace_count = normalized_workspaces.len();

    let reason_for_ack = reason.clone();
    let payload = json!({
        "source": "rust-diffforge-terminal-presence-sync",
        "event_kind": "terminal_presence_snapshot",
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_id": device_profile["device_id"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "platform": device_profile["platform"].clone(),
        "form_factor": device_profile["form_factor"].clone(),
        "client_kind": device_profile["client_kind"].clone(),
        "agent_id": "rust-diffforge",
        "agent_label": "Diff Forge Desktop",
        "reason": reason,
        "workspace_count": workspace_count,
        "terminal_count": terminal_count,
        "workspaces": normalized_workspaces,
        "summary": "Desktop terminal presence synced.",
        "ts_ms": cloud_mcp_now_ms(),
    });

    {
        let mut snapshots = state.inner().runtime_snapshots.lock().await;
        snapshots.terminal_presence = Some(payload.clone());
    }

    let sync_key = "terminal_presence_snapshot".to_string();
    cloud_mcp_enqueue_background_sync(
        state.inner(),
        sync_key.clone(),
        "terminal_presence_snapshot",
        payload,
        CLOUD_MCP_BACKGROUND_SYNC_PRIORITY_MEDIUM,
        reason_for_ack.clone(),
    )
    .await;
    Ok(cloud_mcp_background_sync_ack(
        "terminal_presence_snapshot",
        &sync_key,
        &reason_for_ack,
        json!({
            "stored": {
                "stored_count": terminal_count,
                "terminal_count": terminal_count,
                "workspace_count": workspace_count,
            },
            "stored_count": terminal_count,
            "terminal_count": terminal_count,
            "workspace_count": workspace_count,
        }),
    ))
}

fn cloud_mcp_lifecycle_status_key(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace([' ', '-'], "_")
}

fn cloud_mcp_terminal_lifecycle_state(
    event_type: &str,
    status: &str,
    activity_status: &str,
    readiness: &str,
    execution_phase: &str,
    turn_status: &str,
) -> &'static str {
    let event_type = cloud_mcp_lifecycle_status_key(event_type);
    let status = cloud_mcp_lifecycle_status_key(status);
    let activity_status = cloud_mcp_lifecycle_status_key(activity_status);
    let readiness = cloud_mcp_lifecycle_status_key(readiness);
    let execution_phase = cloud_mcp_lifecycle_status_key(execution_phase);
    let turn_status = cloud_mcp_lifecycle_status_key(turn_status);
    let values = [
        event_type.as_str(),
        status.as_str(),
        activity_status.as_str(),
        readiness.as_str(),
        execution_phase.as_str(),
        turn_status.as_str(),
    ];

    if values
        .iter()
        .any(|value| matches!(*value, "closed" | "closing" | "exited" | "offline"))
    {
        return "closed";
    }
    if values
        .iter()
        .any(|value| matches!(*value, "error" | "failed" | "failure"))
    {
        return "error";
    }
    if values.iter().any(|value| {
        matches!(
            *value,
            "paused"
                | "parked"
                | "needs_input"
                | "awaiting_input"
                | "awaiting_user"
                | "provider_user_prompt_started"
                | "resume_ready"
        )
    }) {
        return "paused";
    }
    if values.iter().any(|value| {
        matches!(
            *value,
            "complete"
                | "completed"
                | "done"
                | "idle"
                | "input_ready"
                | "interrupted"
                | "interrupt"
                | "cancelled"
                | "canceled"
                | "ready"
                | "provider_turn_completed"
                | "provider_turn_interrupted"
        )
    }) {
        return "idle";
    }

    "thinking"
}

fn cloud_mcp_terminal_lifecycle_turn_status(
    event_type: &str,
    turn_status: &str,
    state: &str,
) -> &'static str {
    let event_type = cloud_mcp_lifecycle_status_key(event_type);
    let turn_status = cloud_mcp_lifecycle_status_key(turn_status);
    match turn_status.as_str() {
        "complete" | "completed" | "done" => "completed",
        "cancelled" | "canceled" => "cancelled",
        "interrupted" | "interrupt" => "interrupted",
        "failed" | "error" => "failed",
        "queued" | "submitted" | "pending" => "queued",
        "running" | "thinking" | "working" | "reasoning" => "running",
        _ => match event_type.as_str() {
            "provider_turn_completed" => "completed",
            "provider_turn_error" => "failed",
            "provider_turn_interrupted" => "interrupted",
            "remote_control_close" | "closed" | "exited" => "interrupted",
            _ => match state {
                "idle" => "completed",
                "error" => "failed",
                "closed" => "interrupted",
                _ => "running",
            },
        },
    }
}

fn cloud_mcp_terminal_lifecycle_readiness(state: &str, input_ready: Option<bool>) -> &'static str {
    if input_ready.unwrap_or(false) {
        return "ready";
    }
    match state {
        "idle" => "ready",
        "closed" => "closed",
        "error" => "error",
        "paused" => "needs_input",
        _ => "busy",
    }
}

fn cloud_mcp_next_terminal_lifecycle_seq(state: &CloudMcpState, candidate: Option<u64>) -> u64 {
    let now = cloud_mcp_now_ms();
    let candidate = candidate.unwrap_or(0).max(now);
    let mut previous = state.terminal_lifecycle_seq.load(Ordering::SeqCst);
    loop {
        let next = previous.saturating_add(1).max(candidate);
        match state.terminal_lifecycle_seq.compare_exchange(
            previous,
            next,
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            Ok(_) => return next,
            Err(current) => previous = current,
        }
    }
}

async fn cloud_mcp_enqueue_terminal_lifecycle_delta(
    state: &CloudMcpState,
    payload: Value,
    terminal_id: &str,
    reason: &str,
    priority: u8,
) {
    let workspace_id = cloud_mcp_payload_text(&payload, &["workspace_id", "workspaceId"])
        .unwrap_or_else(|| "workspace".to_string());
    let instance_id =
        cloud_mcp_payload_text(&payload, &["terminal_instance_id", "terminalInstanceId"])
            .unwrap_or_else(|| "0".to_string());
    let sync_key = format!("terminal_lifecycle:{workspace_id}:{terminal_id}:{instance_id}");
    cloud_mcp_enqueue_background_sync(
        state,
        sync_key,
        "terminal_lifecycle_delta",
        payload,
        priority,
        reason.to_string(),
    )
    .await;
}

pub(crate) async fn cloud_mcp_sync_terminal_activity_hook_delta(
    state: &CloudMcpState,
    payload: &TerminalActivityHookPayload,
) {
    let terminal_id = payload.pane_id.as_str();
    let terminal_key = cloud_mcp_terminal_key(terminal_id, payload.instance_id);
    let context_entry = {
        let runtime = state.inner.lock().await;
        runtime.terminal_contexts.get(&terminal_key).cloned()
    };
    let repo_id = context_entry
        .as_ref()
        .map(|entry| entry.repo_id.clone())
        .filter(|value| !value.trim().is_empty());
    let workspace_root = context_entry
        .as_ref()
        .map(|entry| workspace_path_display(&entry.repo_root))
        .or_else(|| payload.cwd.clone())
        .unwrap_or_default();
    let direct_prompt_refs = context_entry.as_ref().and_then(|entry| {
        Some(CloudMcpDirectPromptTodoRefs {
            todo_id: entry.todo_id.clone()?,
            dispatch_id: entry.todo_dispatch_id.clone()?,
            command_id: entry.todo_command_id.clone()?,
        })
    });
    let prompt_event_id = context_entry
        .as_ref()
        .and_then(|entry| entry.prompt_event_id.as_deref());
    let state_value = cloud_mcp_terminal_lifecycle_state(
        &payload.event_type,
        &payload.status,
        &payload.activity_status,
        "",
        &payload.command_phase,
        "",
    );
    let turn_status =
        cloud_mcp_terminal_lifecycle_turn_status(&payload.event_type, "", state_value);
    let readiness = cloud_mcp_terminal_lifecycle_readiness(state_value, Some(payload.input_ready));
    let status_seq = cloud_mcp_next_terminal_lifecycle_seq(state, Some(payload.observed_at_ms));
    let reason = payload.source.as_str();
    let delta = json!({
        "source": "rust-diffforge-activity-hook",
        "event_kind": "terminal_lifecycle_delta",
        "v": 1,
        "repo_id": repo_id,
        "workspace_root": workspace_root,
        "workspace_id": payload.workspace_id,
        "workspace_name": payload.workspace_name,
        "terminal_id": terminal_id,
        "pane_id": terminal_id,
        "terminal_instance_id": payload.instance_id,
        "terminal_index": payload.terminal_index,
        "terminal_epoch": format!("{}:{}", terminal_id, payload.instance_id),
        "agent_kind": payload.agent_kind,
        "agent_type": payload.agent_type.as_str(),
        "agentType": payload.agent_type.as_str(),
        "agent_display_name": payload.agent_display_name.as_str(),
        "agentDisplayName": payload.agent_display_name.as_str(),
        "provider": payload.provider,
        "event_type": payload.event_type,
        "hook_event_name": payload.hook_event_name,
        "state": state_value,
        "status": state_value,
        "activity_status": state_value,
        "readiness": readiness,
        "turn_status": turn_status,
        "command_phase": payload.command_phase,
        "input_ready": payload.input_ready,
        "status_seq": status_seq,
        "observed_at_ms": payload.observed_at_ms,
        "hook_timestamp_ms": payload.hook_timestamp_ms,
        "turn_id": payload.turn_id,
        "provider_turn_id": payload.provider_turn_id,
        "provider_session_id": payload.provider_session_id,
        "native_session_id": payload.native_session_id,
        "prompt_event_id": prompt_event_id,
        "promptEventId": prompt_event_id,
        "todo_id": direct_prompt_refs.as_ref().map(|refs| refs.todo_id.as_str()),
        "todoId": direct_prompt_refs.as_ref().map(|refs| refs.todo_id.as_str()),
        "todo_dispatch_id": direct_prompt_refs.as_ref().map(|refs| refs.dispatch_id.as_str()),
        "todoDispatchId": direct_prompt_refs.as_ref().map(|refs| refs.dispatch_id.as_str()),
        "command_id": direct_prompt_refs.as_ref().map(|refs| refs.command_id.as_str()),
        "commandId": direct_prompt_refs.as_ref().map(|refs| refs.command_id.as_str()),
        "thread_id": payload.thread_id,
        "reason": reason,
        "summary": format!("Terminal {}.", state_value),
        "ts_ms": cloud_mcp_now_ms(),
    });
    let priority = if matches!(state_value, "idle" | "paused" | "error" | "closed") {
        CLOUD_MCP_BACKGROUND_SYNC_PRIORITY_HIGH
    } else {
        CLOUD_MCP_BACKGROUND_SYNC_PRIORITY_MEDIUM
    };
    cloud_mcp_enqueue_terminal_lifecycle_delta(state, delta, terminal_id, reason, priority).await;
    if let (Some(refs), Some(status)) = (
        direct_prompt_refs.as_ref(),
        cloud_mcp_direct_prompt_dispatch_status_for_turn(turn_status),
    ) {
        cloud_mcp_record_direct_prompt_todo_dispatch_status(
            state,
            refs,
            &payload.workspace_id,
            status,
            json!({
                "reason": reason,
                "event_type": payload.event_type,
                "hook_event_name": payload.hook_event_name,
                "turn_status": turn_status,
                "state": state_value,
                "pane_id": terminal_id,
                "terminal_instance_id": payload.instance_id,
                "prompt_event_id": prompt_event_id,
            }),
        )
        .await;
    }
}

#[tauri::command]
async fn cloud_mcp_sync_terminal_status_event(
    state: State<'_, CloudMcpState>,
    workspace: Value,
    terminal: Value,
    reason: Option<String>,
) -> Result<Value, String> {
    let clean_option = |value: Option<String>| {
        value
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let reason = clean_option(reason).unwrap_or_else(|| "terminal_status_event".to_string());
    let device_profile = cloud_mcp_desktop_device_profile();
    let repo_path = cloud_mcp_payload_text(
        &workspace,
        &[
            "repo_path",
            "repoPath",
            "workspace_root",
            "workspaceRoot",
            "workspace_root_directory",
            "workspaceRootDirectory",
            "workingDirectory",
            "rootDirectory",
            "terminalWorkspaceWorkingDirectory",
        ],
    )
    .or_else(|| {
        cloud_mcp_payload_text(
            &terminal,
            &[
                "repo_path",
                "repoPath",
                "workspace_root",
                "workspaceRoot",
                "workingDirectory",
                "rootDirectory",
            ],
        )
    })
    .unwrap_or_default();
    if repo_path.trim().is_empty() {
        return Err("Terminal status events require a workspace root.".to_string());
    }

    let workspace_id = cloud_mcp_payload_text(&workspace, &["workspace_id", "workspaceId", "id"])
        .or_else(|| cloud_mcp_payload_text(&terminal, &["workspace_id", "workspaceId"]));
    let workspace_name = cloud_mcp_payload_text(
        &workspace,
        &["workspace_name", "workspaceName", "name", "label"],
    );
    let workspace_active = workspace
        .get("workspace_active")
        .or_else(|| workspace.get("workspaceActive"))
        .or_else(|| workspace.get("active"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let workspace_status = cloud_mcp_payload_text(
        &workspace,
        &["workspace_status", "workspaceStatus", "status"],
    )
    .unwrap_or_else(|| {
        if workspace_active {
            "active".to_string()
        } else {
            "deactivated".to_string()
        }
    });
    let req = cloud_mcp_repo_request(repo_path, workspace_id, workspace_name);

    let terminal_index = terminal
        .get("terminal_index")
        .or_else(|| terminal.get("terminalIndex"))
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .clamp(0, 255);
    let agent_kind = cloud_mcp_payload_text(
        &terminal,
        &[
            "agent_kind",
            "agentKind",
            "agent_id",
            "agentId",
            "role",
            "provider",
            "binary",
            "kind",
        ],
    )
    .unwrap_or_else(|| "terminal".to_string());
    let status = cloud_mcp_payload_text(
        &terminal,
        &["status_after", "statusAfter", "status", "state"],
    )
    .unwrap_or_else(|| "idle".to_string());
    let activity_status = cloud_mcp_payload_text(
        &terminal,
        &[
            "activity_status",
            "activityStatus",
            "display_status",
            "displayStatus",
            "native_rail_state",
            "nativeRailState",
        ],
    )
    .unwrap_or_else(|| status.clone());
    let readiness = cloud_mcp_payload_text(
        &terminal,
        &[
            "readiness_after",
            "readinessAfter",
            "readiness",
            "terminal_readiness",
            "terminalReadiness",
        ],
    );
    let event_type = cloud_mcp_payload_text(
        &terminal,
        &[
            "event_type",
            "eventType",
            "type",
            "terminal_event_type",
            "terminalEventType",
        ],
    )
    .unwrap_or_else(|| "terminal.status".to_string());
    let command_phase = cloud_mcp_payload_text(&terminal, &["command_phase", "commandPhase"]);
    let execution_phase = cloud_mcp_payload_text(&terminal, &["execution_phase", "executionPhase"]);
    let pane_id = cloud_mcp_payload_text(&terminal, &["pane_id", "paneId"]);
    let terminal_id = cloud_mcp_payload_text(&terminal, &["terminal_id", "terminalId"])
        .or_else(|| pane_id.clone())
        .unwrap_or_else(|| "terminal".to_string());
    let terminal_instance_id = cloud_mcp_payload_u64(
        &terminal,
        &[
            "terminal_instance_id",
            "terminalInstanceId",
            "instance_id",
            "instanceId",
        ],
    )
    .unwrap_or(0);
    let turn_status = cloud_mcp_payload_text(
        &terminal,
        &[
            "turn_status",
            "turnStatus",
            "latest_turn_status",
            "latestTurnStatus",
        ],
    )
    .unwrap_or_default();
    let input_ready = terminal
        .get("input_ready")
        .or_else(|| terminal.get("inputReady"))
        .and_then(Value::as_bool);
    let state_value = cloud_mcp_terminal_lifecycle_state(
        &event_type,
        &status,
        &activity_status,
        readiness.as_deref().unwrap_or_default(),
        execution_phase.as_deref().unwrap_or_default(),
        &turn_status,
    );
    let turn_status =
        cloud_mcp_terminal_lifecycle_turn_status(&event_type, &turn_status, state_value);
    let readiness = readiness.unwrap_or_else(|| {
        cloud_mcp_terminal_lifecycle_readiness(state_value, input_ready).to_string()
    });
    let status_seq = cloud_mcp_next_terminal_lifecycle_seq(
        state.inner(),
        cloud_mcp_payload_u64(&terminal, &["status_seq", "statusSeq"]),
    );
    let observed_at_ms = cloud_mcp_payload_u64(&terminal, &["observed_at_ms", "observedAtMs"])
        .unwrap_or_else(cloud_mcp_now_ms);
    let terminal_epoch = cloud_mcp_payload_text(&terminal, &["terminal_epoch", "terminalEpoch"])
        .unwrap_or_else(|| format!("{terminal_id}:{terminal_instance_id}"));
    let terminal_nickname = cloud_mcp_terminal_nickname_text(
        &terminal,
        &[
            "terminal_nickname",
            "terminalNickname",
            "terminal_name",
            "terminalName",
            "display_name",
            "displayName",
        ],
    );
    let payload = json!({
        "source": "rust-diffforge-terminal-lifecycle-delta",
        "event_kind": "terminal_lifecycle_delta",
        "v": 1,
        "device_id": device_profile["device_id"].clone(),
        "machine_id": device_profile["device_id"].clone(),
        "repo_id": req.repo_id,
        "workspace_root": req.root_display,
        "workspace_active": workspace_active,
        "workspace_id": req.workspace_id,
        "workspace_name": req.workspace_name,
        "workspace_status": workspace_status,
        "display_name": terminal_nickname.clone(),
        "terminal_id": terminal_id,
        "pane_id": pane_id,
        "terminal_instance_id": terminal_instance_id,
        "terminal_index": terminal_index,
        "terminal_epoch": terminal_epoch,
        "terminal_name": terminal_nickname.clone(),
        "terminal_nickname": terminal_nickname,
        "agent_kind": agent_kind,
        "provider": cloud_mcp_payload_text(&terminal, &["provider", "agentKind", "agent_kind"]),
        "event_type": event_type,
        "state": state_value,
        "status": state_value,
        "activity_status": state_value,
        "readiness": readiness,
        "turn_status": turn_status,
        "command_phase": command_phase,
        "execution_phase": execution_phase,
        "input_ready": input_ready,
        "turn_id": cloud_mcp_payload_text(&terminal, &["turn_id", "turnId", "latest_turn_id", "latestTurnId", "active_turn_id", "activeTurnId"]),
        "thread_id": cloud_mcp_payload_text(&terminal, &["thread_id", "threadId"]),
        "status_seq": status_seq,
        "observed_at_ms": observed_at_ms,
        "reason": reason.clone(),
        "ts_ms": cloud_mcp_now_ms(),
    });
    let reason_for_ack = reason.clone();
    let priority = if matches!(state_value, "closed" | "error" | "idle" | "paused") {
        CLOUD_MCP_BACKGROUND_SYNC_PRIORITY_HIGH
    } else {
        CLOUD_MCP_BACKGROUND_SYNC_PRIORITY_MEDIUM
    };
    log_terminal_status_event(
        "backend.cloud_mcp.terminal_lifecycle_delta.queue",
        json!({
            "event_type": payload["event_type"].clone(),
            "reason": reason,
            "state": payload["state"].clone(),
            "terminal_id": payload["terminal_id"].clone(),
            "workspace_id": payload["workspace_id"].clone(),
        }),
    );
    cloud_mcp_enqueue_terminal_lifecycle_delta(
        state.inner(),
        payload,
        &terminal_id,
        &reason_for_ack,
        priority,
    )
    .await;
    Ok(cloud_mcp_background_sync_ack(
        "terminal_lifecycle_delta",
        &format!("terminal_lifecycle:{}", terminal_id),
        &reason_for_ack,
        json!({
            "stored": {
                "stored_count": 1,
                "terminal_count": 1,
                "workspace_count": 1,
            },
            "stored_count": 1,
            "terminal_count": 1,
            "workspace_count": 1,
        }),
    ))
}

#[tauri::command]
async fn cloud_mcp_sync_workspace_mcp_snapshot(
    state: State<'_, CloudMcpState>,
    workspaces: Value,
    reason: Option<String>,
) -> Result<Value, String> {
    let clean_option = |value: Option<String>| {
        value
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let reason = clean_option(reason).unwrap_or_else(|| "workspace_mcp_snapshot".to_string());
    let workspace_items = workspaces
        .as_array()
        .ok_or_else(|| "Workspace MCP sync requires a workspaces array.".to_string())?;
    let mut normalized_workspaces = Vec::new();
    let device_profile = cloud_mcp_desktop_device_profile();

    for workspace in workspace_items.iter().take(64) {
        let repo_path = cloud_mcp_payload_text(
            workspace,
            &[
                "repo_path",
                "repoPath",
                "workspace_root",
                "workspaceRoot",
                "workspace_root_directory",
                "workspaceRootDirectory",
                "workingDirectory",
                "rootDirectory",
                "terminalWorkspaceWorkingDirectory",
            ],
        )
        .unwrap_or_default();
        if repo_path.trim().is_empty() {
            continue;
        }

        let workspace_id =
            cloud_mcp_payload_text(workspace, &["workspace_id", "workspaceId", "id"]);
        let workspace_name =
            cloud_mcp_payload_text(workspace, &["workspace_name", "workspaceName", "name"]);
        let workspace_active = workspace
            .get("workspace_active")
            .or_else(|| workspace.get("workspaceActive"))
            .or_else(|| workspace.get("active"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let workspace_status = cloud_mcp_payload_text(
            workspace,
            &["workspace_status", "workspaceStatus", "status"],
        )
        .unwrap_or_else(|| {
            if workspace_active {
                "active".to_string()
            } else {
                "deactivated".to_string()
            }
        });
        let req = cloud_mcp_repo_request(repo_path, workspace_id.clone(), workspace_name.clone());
        let server_items = cloud_mcp_workspace_server_items(workspace);
        let servers = server_items
            .iter()
            .enumerate()
            .filter_map(|(index, server)| {
                if !server.is_object() {
                    return None;
                }
                let server_key = cloud_mcp_payload_text(
                    server,
                    &[
                        "server_key",
                        "serverKey",
                        "key",
                        "id",
                        "name",
                        "label",
                        "slug",
                        "package_ref",
                        "packageRef",
                    ],
                )
                .unwrap_or_else(|| format!("server-{}", index + 1));
                if server_key == "secrets" {
                    return None;
                }
                let name = cloud_mcp_payload_text(
                    server,
                    &["name", "label", "display_name", "displayName"],
                )
                .unwrap_or_else(|| server_key.clone());
                Some(json!({
                    "id": cloud_mcp_payload_text(server, &["id"]).unwrap_or_else(|| server_key.clone()),
                    "server_key": server_key,
                    "name": name,
                    "source_kind": cloud_mcp_payload_text(server, &["source_kind", "sourceKind"]),
                    "source_label": cloud_mcp_payload_text(server, &["source_label", "sourceLabel"]),
                    "package_ref": cloud_mcp_payload_text(server, &["package_ref", "packageRef"]),
                    "version": cloud_mcp_payload_text(server, &["version"]),
                    "transport": cloud_mcp_payload_text(server, &["transport"]).unwrap_or_else(|| "stdio".to_string()),
                    "built_in": cloud_mcp_payload_bool(server, &["built_in"], false)
                        || cloud_mcp_payload_bool(server, &["builtIn"], false),
                    "install_state": cloud_mcp_payload_text(server, &["install_state", "installState"]).unwrap_or_else(|| "installed".to_string()),
                    "workspace_enabled": cloud_mcp_payload_bool(server, &["workspace_enabled"], true)
                        && cloud_mcp_payload_bool(server, &["workspaceEnabled"], true),
                    "approval_policy": cloud_mcp_payload_text(server, &["approval_policy", "approvalPolicy"]).unwrap_or_else(|| "always_allow".to_string()),
                    "agent_config_access_enabled": cloud_mcp_payload_bool(server, &["agent_config_access_enabled"], true)
                        && cloud_mcp_payload_bool(server, &["agentConfigAccessEnabled"], true),
                    "agent_secret_config_access_enabled": cloud_mcp_payload_bool(server, &["agent_secret_config_access_enabled"], false)
                        || cloud_mcp_payload_bool(server, &["agentSecretConfigAccessEnabled"], false),
                    "agent_env_file_write_enabled": cloud_mcp_payload_bool(server, &["agent_env_file_write_enabled"], true)
                        && cloud_mcp_payload_bool(server, &["agentEnvFileWriteEnabled"], true),
                    "last_probe_status": cloud_mcp_payload_text(server, &["last_probe_status", "lastProbeStatus"]),
                    "last_probe_message": cloud_mcp_payload_text(server, &["last_probe_message", "lastProbeMessage"]),
                    "config_schema": server
                        .get("config_schema")
                        .or_else(|| server.get("configSchema"))
                        .or_else(|| server.get("env_schema_json"))
                        .or_else(|| server.get("envSchema"))
                        .cloned()
                        .unwrap_or_else(|| json!([])),
                    "tools": server
                        .get("tools")
                        .or_else(|| server.get("tools_json"))
                        .or_else(|| server.get("toolsJson"))
                        .cloned()
                        .unwrap_or_else(|| json!([])),
                    "config_summary": server
                        .get("config_summary")
                        .or_else(|| server.get("configSummary"))
                        .cloned()
                        .unwrap_or_else(|| json!({})),
                }))
            })
            .collect::<Vec<_>>();

        let server_count = servers.len();
        let git_identity = cloud_mcp_git_repo_identity_for_path(Path::new(&req.root_display));
        let mut workspace_value = json!({
            "device": device_profile.clone(),
            "device_id": device_profile["device_id"].clone(),
            "device_name": device_profile["device_name"].clone(),
            "machine_id": device_profile["device_id"].clone(),
            "machine_name": device_profile["machine_name"].clone(),
            "platform": device_profile["platform"].clone(),
            "form_factor": device_profile["form_factor"].clone(),
            "client_kind": device_profile["client_kind"].clone(),
            "repo_id": req.repo_id,
            "workspace_root": req.root_display,
            "workspace_id": req.workspace_id,
            "workspace_active": workspace_active,
            "workspace_name": req.workspace_name,
            "workspace_status": workspace_status,
            "server_count": server_count,
            "servers": servers,
        });
        cloud_mcp_apply_git_identity_to_value(&mut workspace_value, &git_identity);
        normalized_workspaces.push(workspace_value);
    }

    let snapshot_id = format!(
        "workspace-mcps-{}-{}",
        cloud_mcp_now_ms(),
        uuid::Uuid::new_v4()
    );
    let server_count = normalized_workspaces
        .iter()
        .map(|workspace| {
            workspace
                .get("servers")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or_default()
        })
        .sum::<usize>();
    let workspace_count = normalized_workspaces.len();
    let reason_for_ack = reason.clone();
    let payload = json!({
        "source": "rust-diffforge-workspace-mcp-sync",
        "event_kind": "workspace_mcp_snapshot",
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_id": device_profile["device_id"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "platform": device_profile["platform"].clone(),
        "form_factor": device_profile["form_factor"].clone(),
        "client_kind": device_profile["client_kind"].clone(),
        "agent_id": "rust-diffforge",
        "agent_label": "Diff Forge Desktop",
        "reason": reason,
        "snapshot_id": snapshot_id,
        "workspace_count": workspace_count,
        "server_count": server_count,
        "workspaces": normalized_workspaces,
        "summary": "Desktop workspace MCP settings synced without secret values.",
        "ts_ms": cloud_mcp_now_ms(),
    });

    {
        let mut snapshots = state.inner().runtime_snapshots.lock().await;
        snapshots.workspace_mcps = Some(payload.clone());
    }

    let sync_key = "workspace_mcp_snapshot".to_string();
    cloud_mcp_enqueue_background_sync(
        state.inner(),
        sync_key.clone(),
        "workspace_mcp_snapshot",
        payload,
        CLOUD_MCP_BACKGROUND_SYNC_PRIORITY_LOW,
        reason_for_ack.clone(),
    )
    .await;
    Ok(cloud_mcp_background_sync_ack(
        "workspace_mcp_snapshot",
        &sync_key,
        &reason_for_ack,
        json!({
            "stored": {
                "stored_count": server_count,
                "server_count": server_count,
                "workspace_count": workspace_count,
            },
            "stored_count": server_count,
            "server_count": server_count,
            "workspace_count": workspace_count,
        }),
    ))
}

fn cloud_mcp_workspace_payload_matches_delete(value: &Value, workspace_id: &str) -> bool {
    cloud_mcp_payload_text(value, &["workspace_id", "workspaceId", "id"])
        .as_deref()
        .map(|value| value == workspace_id)
        .unwrap_or(false)
}

fn cloud_mcp_filter_deleted_workspace_snapshot(
    snapshot: &mut Option<Value>,
    workspace_id: &str,
    count_kind: &str,
) -> usize {
    let (removed, should_clear) = {
        let Some(snapshot_value) = snapshot.as_mut() else {
            return 0;
        };
        let Some(object) = snapshot_value.as_object_mut() else {
            return 0;
        };
        let Some(workspaces) = object.get_mut("workspaces").and_then(Value::as_array_mut) else {
            return 0;
        };

        let before = workspaces.len();
        workspaces.retain(|workspace| {
            !cloud_mcp_workspace_payload_matches_delete(workspace, workspace_id)
        });
        let removed = before.saturating_sub(workspaces.len());
        if removed == 0 {
            return 0;
        }

        let workspace_count = workspaces.len();
        let terminal_count = (count_kind == "terminals").then(|| {
            workspaces
                .iter()
                .map(|workspace| {
                    workspace
                        .get("terminals")
                        .and_then(Value::as_array)
                        .map(Vec::len)
                        .unwrap_or_default()
                })
                .sum::<usize>()
        });
        let server_count = (count_kind == "mcps").then(|| {
            workspaces
                .iter()
                .map(|workspace| {
                    workspace
                        .get("servers")
                        .and_then(Value::as_array)
                        .map(Vec::len)
                        .unwrap_or_default()
                })
                .sum::<usize>()
        });
        object.insert("workspace_count".to_string(), json!(workspace_count));
        object.insert("workspaceCount".to_string(), json!(workspace_count));
        if let Some(terminal_count) = terminal_count {
            object.insert("terminal_count".to_string(), json!(terminal_count));
            object.insert("terminalCount".to_string(), json!(terminal_count));
        }
        if let Some(server_count) = server_count {
            object.insert("server_count".to_string(), json!(server_count));
            object.insert("serverCount".to_string(), json!(server_count));
        }
        (removed, workspace_count == 0)
    };

    if should_clear {
        *snapshot = None;
    }

    removed
}

#[tauri::command]
async fn cloud_mcp_delete_workspace(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: String,
    workspace_name: Option<String>,
    include_child_projects: Option<bool>,
) -> Result<Value, String> {
    let workspace_id = workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("Workspace delete requires a workspace id.".to_string());
    }

    let root = resolve_workspace_root_directory(Some(&repo_path))?;
    let root_display = workspace_path_display(&root);
    let root_repo_id = cloud_mcp_repo_id_for_root(&root);
    let workspace_name = workspace_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| workspace_id.clone());
    let include_child_projects = include_child_projects.unwrap_or(false);
    let mounts = cloud_mcp_container_project_mounts(&root);
    let child_repo_ids = mounts
        .iter()
        .map(|mount| cloud_mcp_repo_id_for_root(&mount.root_path))
        .collect::<Vec<_>>();
    let mut cloud_delete_repo_ids = vec![root_repo_id.clone()];
    if include_child_projects {
        cloud_delete_repo_ids.extend(child_repo_ids.iter().cloned());
        cloud_delete_repo_ids.sort();
        cloud_delete_repo_ids.dedup();
    }

    let (removed_terminal_snapshots, removed_mcp_snapshots) = {
        let mut snapshots = state.runtime_snapshots.lock().await;
        let terminal_removed = cloud_mcp_filter_deleted_workspace_snapshot(
            &mut snapshots.terminal_presence,
            &workspace_id,
            "terminals",
        );
        let mcp_removed = cloud_mcp_filter_deleted_workspace_snapshot(
            &mut snapshots.workspace_mcps,
            &workspace_id,
            "mcps",
        );
        (terminal_removed, mcp_removed)
    };
    {
        let mut runtime = state.inner.lock().await;
        runtime
            .registered_workspaces
            .retain(|_, workspace| workspace.workspace_id != workspace_id);
        runtime
            .terminal_contexts
            .retain(|_, terminal| terminal.workspace_id != workspace_id);
    }

    let device_profile = cloud_mcp_desktop_device_profile();
    let payload = json!({
        "source": "rust-diffforge-workspace-delete",
        "event_kind": "workspace_deleted",
        "repo_id": root_repo_id,
        "repo_ids": cloud_delete_repo_ids,
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "workspace_location_fingerprint": cloud_mcp_workspace_location_fingerprint(&root),
        "workspace_root": root_display,
        "include_child_projects": include_child_projects,
        "child_repo_count": child_repo_ids.len(),
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_id": device_profile["device_id"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "platform": device_profile["platform"].clone(),
        "form_factor": device_profile["form_factor"].clone(),
        "client_kind": device_profile["client_kind"].clone(),
        "agent_id": "rust-diffforge",
        "agent_label": "Diff Forge Desktop",
        "reason": "workspace_delete",
        "summary": "Desktop workspace deleted from Diff Forge.",
        "ts_ms": cloud_mcp_now_ms(),
    });

    let workspace_unregister_response = match cloud_mcp_ws_request_with_timeout(
        state.inner(),
        "workspace_unregister",
        &payload,
        Duration::from_secs(5),
    )
    .await
    {
        Ok(response) => json!({"ok": true, "response": response}),
        Err(error) => json!({"ok": false, "error": error}),
    };
    let _ =
        cloud_mcp_send_device_workspace_snapshot_event(state.inner(), "workspace_deleted").await;

    let response =
        cloud_mcp_post_event_endpoint(state.inner(), "workspace_deleted", &payload).await?;
    Ok(json!({
        "ok": true,
        "workspaceId": payload["workspace_id"].clone(),
        "repoIds": payload["repo_ids"].clone(),
        "includeChildProjects": include_child_projects,
        "removedTerminalSnapshots": removed_terminal_snapshots,
        "removedMcpSnapshots": removed_mcp_snapshots,
        "workspaceUnregister": workspace_unregister_response,
        "serverResponse": response,
    }))
}

#[tauri::command]
async fn cloud_mcp_sync_tokenomics_state(
    state: State<'_, CloudMcpState>,
    mut summary: Value,
    reason: Option<String>,
    delta: Option<bool>,
) -> Result<Value, String> {
    let clean_reason = reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "tokenomics_hourly_usage_snapshot".to_string());
    let is_delta = delta.unwrap_or(false);
    let device_profile = cloud_mcp_desktop_device_profile();
    cloud_mcp_tag_tokenomics_summary_device(&mut summary, &device_profile);
    let (billing_scope_type, team_id) = cloud_mcp_account_scope(state.inner()).await;
    let hourly_count = summary
        .get("hourly")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or_default();
    let event_kind = if is_delta {
        "tokenomics_delta"
    } else {
        "tokenomics_hourly_usage_snapshot"
    };
    let reason_for_ack = clean_reason.clone();
    let event_kind_for_job = event_kind.to_string();
    let sync_key = format!("tokenomics:{event_kind_for_job}");
    let payload = json!({
        "source": "rust-diffforge-tokenomics-sync",
        "event_kind": event_kind,
        "scope": "account",
        "billing_scope_type": billing_scope_type,
        "team_id": team_id,
        "account_scoped": true,
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_id": device_profile["device_id"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "platform": device_profile["platform"].clone(),
        "form_factor": device_profile["form_factor"].clone(),
        "client_kind": device_profile["client_kind"].clone(),
        "agent_id": "rust-diffforge",
        "agent_label": "Diff Forge Desktop",
        "reason": clean_reason,
        "summary": summary,
        "hourly_count": hourly_count,
        "ts_ms": cloud_mcp_now_ms(),
    });

    if !is_delta {
        let mut snapshots = state.inner().runtime_snapshots.lock().await;
        snapshots.tokenomics = Some(payload.clone());
    }

    cloud_mcp_enqueue_background_sync(
        state.inner(),
        sync_key.clone(),
        event_kind_for_job.clone(),
        payload,
        CLOUD_MCP_BACKGROUND_SYNC_PRIORITY_LOW,
        reason_for_ack.clone(),
    )
    .await;
    Ok(cloud_mcp_background_sync_ack(
        &event_kind_for_job,
        &sync_key,
        &reason_for_ack,
        json!({
            "hourly_count": hourly_count,
            "delta": is_delta,
        }),
    ))
}

#[tauri::command]
async fn cloud_mcp_schedule_tokenomics_sync(
    app: AppHandle,
    state: State<'_, CloudMcpState>,
    reason: Option<String>,
    full: Option<bool>,
    resync_last_30_days: Option<bool>,
) -> Result<Value, String> {
    let clean_reason = reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "tokenomics_delta".to_string());
    let force_full = full.unwrap_or(false);
    let force_resync = resync_last_30_days.unwrap_or(false);
    cloud_mcp_background_sync_ensure_started(state.inner());
    let queued_job = cloud_mcp_enqueue_tokenomics_sync(
        app,
        state.inner(),
        clean_reason.clone(),
        force_full,
        force_resync,
    )
    .await;

    Ok(cloud_mcp_background_sync_ack(
        "tokenomics_sync",
        "tokenomics:scan",
        &clean_reason,
        json!({
            "full": queued_job.force_full,
            "resync_last_30_days": queued_job.force_resync,
            "queued_reason": queued_job.reason,
        }),
    ))
}

fn cloud_mcp_tokenomics_cursor_from_summary(summary: &Value) -> Option<String> {
    let direct = summary
        .get("sync_cursor")
        .or_else(|| summary.get("syncCursor"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if direct.is_some() {
        return direct;
    }

    summary
        .get("hourly")
        .and_then(Value::as_array)
        .and_then(|rows| {
            rows.iter()
                .filter_map(|row| {
                    row.get("updated_at")
                        .or_else(|| row.get("updatedAt"))
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                })
                .max()
        })
}

fn cloud_mcp_tag_tokenomics_summary_device(summary: &mut Value, device_profile: &Value) {
    let Some(device_id) = cloud_mcp_payload_text(
        device_profile,
        &["device_id", "deviceId", "machine_id", "machineId"],
    ) else {
        return;
    };
    let device_name = cloud_mcp_payload_text(device_profile, &["device_name", "deviceName"]);
    for key in ["hourly", "limits"] {
        if let Some(rows) = summary.get_mut(key).and_then(Value::as_array_mut) {
            for row in rows {
                let Some(object) = row.as_object_mut() else {
                    continue;
                };
                let has_device = object
                    .get("device_id")
                    .or_else(|| object.get("deviceId"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .is_some_and(|value| !value.is_empty());
                if !has_device {
                    object.insert("device_id".to_string(), json!(device_id.as_str()));
                    object.insert("deviceId".to_string(), json!(device_id.as_str()));
                }
                if let Some(name) = device_name.as_deref() {
                    object
                        .entry("device_name".to_string())
                        .or_insert_with(|| json!(name));
                    object
                        .entry("deviceName".to_string())
                        .or_insert_with(|| json!(name));
                }
            }
        }
    }
}

#[tauri::command]
async fn cloud_mcp_hard_reset_cloud_sqlite(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: String,
    workspace_name: Option<String>,
    reset_scope: Option<String>,
) -> Result<Value, String> {
    let req = cloud_mcp_repo_request(
        repo_path.clone(),
        Some(workspace_id.clone()),
        workspace_name.clone(),
    );
    let device_profile = cloud_mcp_desktop_device_profile();
    let requested_reset_scope = reset_scope
        .as_deref()
        .map(str::trim)
        .filter(|scope| !scope.is_empty())
        .unwrap_or("repo")
        .to_ascii_lowercase();
    if requested_reset_scope == "account" {
        return Err(
            "Account cloud SQLite reset has been removed; select a repository to reset."
                .to_string(),
        );
    }
    let reset_scope = match requested_reset_scope.as_str() {
        "repo" | "repository" | "git_repo" | "git-repo" => "repo",
        "client" | "current" | "workspace" => "repo",
        _ => "repo",
    };
    let payload = json!({
        "source": "rust-diffforge-cloud-sqlite-hard-reset",
        "client_id": CLOUD_MCP_RUST_CLIENT_ID,
        "repo_id": req.repo_id,
        "repo_path": req.root_display,
        "workspace_root": req.root_display,
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "scope": reset_scope,
        "confirm": "hard_reset_cloud_sqlite",
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_id": device_profile["device_id"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "platform": device_profile["platform"].clone(),
        "form_factor": device_profile["form_factor"].clone(),
        "client_kind": device_profile["client_kind"].clone(),
        "agent_id": "rust-diffforge",
        "self_agent_id": "rust-diffforge",
        "current_agent_id": "rust-diffforge",
        "ts_ms": cloud_mcp_now_ms(),
    });
    let response =
        cloud_mcp_post_json_endpoint(state.inner(), "/v1/cloud/sqlite/hard-reset", &payload)
            .await?;
    {
        let mut snapshots = state.runtime_snapshots.lock().await;
        *snapshots = CloudMcpRuntimeSnapshots::default();
    }
    Ok(cloud_mcp_response_data(&response))
}

#[tauri::command]
async fn cloud_mcp_record_voice_plan_task_status(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: String,
    workspace_name: Option<String>,
    status: Value,
) -> Result<Value, String> {
    let req = cloud_mcp_repo_request(
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
async fn cloud_mcp_update_voice_plan_steps(
    app: AppHandle,
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: String,
    workspace_name: Option<String>,
    update: Value,
) -> Result<Value, String> {
    let req = cloud_mcp_repo_request(
        repo_path.clone(),
        Some(workspace_id.clone()),
        workspace_name.clone(),
    );
    let mut payload = match update {
        Value::Object(object) => Value::Object(object),
        _ => return Err("Voice plan step update payload must be an object.".to_string()),
    };
    if let Some(object) = payload.as_object_mut() {
        object.insert("event_kind".to_string(), json!("voice_plan_step_update"));
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
    }

    log_terminal_status_event(
        "backend.voice_plan_step_update.send",
        json!({
            "endpoint": "voice_plan_step_update",
            "payload": payload.clone(),
            "workspace_id": workspace_id,
        }),
    );
    let result =
        cloud_mcp_post_event_endpoint(state.inner(), "voice_plan_step_update", &payload).await;
    match &result {
        Ok(value) => {
            log_terminal_status_event(
                "backend.voice_plan_step_update.result",
                json!({
                    "endpoint": "voice_plan_step_update",
                    "ok": true,
                    "result": value,
                }),
            );
            let _ = app.emit(
                VOICE_PLAN_SERVER_RESULT_EVENT,
                json!({
                    "result": value,
                    "source": "backend_voice_plan_step_update",
                    "workspaceId": workspace_id,
                }),
            );
        }
        Err(error) => log_terminal_status_event(
            "backend.voice_plan_step_update.error",
            json!({
                "endpoint": "voice_plan_step_update",
                "error": clean_terminal_telemetry_text(error),
                "payload": payload,
            }),
        ),
    }
    result
}

fn cloud_mcp_architecture_payload_base(
    req: &CloudMcpRepoRequest,
    workspace_id: &str,
    workspace_name: Option<&str>,
    reason: &str,
) -> Value {
    let device_profile = cloud_mcp_desktop_device_profile();
    let mut payload = json!({
        "source": "rust-diffforge-architecture",
        "reason": reason,
        "repo_id": req.repo_id,
        "repoId": req.repo_id,
        "repo_path": req.root_display,
        "repoPath": req.root_display,
        "workspace_root": req.root_display,
        "workspaceRoot": req.root_display,
        "workspace_id": workspace_id,
        "workspaceId": workspace_id,
        "workspace_name": workspace_name.unwrap_or_default(),
        "workspaceName": workspace_name.unwrap_or_default(),
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "deviceId": device_profile["device_id"].clone(),
        "machine_id": device_profile["device_id"].clone(),
        "machineId": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "ts_ms": cloud_mcp_now_ms(),
    });
    let identity = cloud_mcp_git_repo_identity_for_path(Path::new(&req.root_display));
    cloud_mcp_apply_git_identity_to_value(&mut payload, &identity);
    payload
}

fn cloud_mcp_architecture_graphs_payload(value: Value) -> Vec<Value> {
    if let Some(items) = value.as_array() {
        return items.clone();
    }
    for key in ["graphs", "architectures", "items"] {
        if let Some(items) = value.get(key).and_then(Value::as_array) {
            return items.clone();
        }
    }
    value
        .get("graph")
        .or_else(|| value.get("architecture"))
        .or_else(|| value.get("item"))
        .filter(|item| item.is_object())
        .cloned()
        .or_else(|| value.is_object().then(|| value.clone()))
        .into_iter()
        .collect()
}

fn cloud_mcp_architecture_refs_array(value: &Value) -> Vec<Value> {
    if let Some(items) = value.as_array() {
        return items.clone();
    }
    for key in ["refs", "graphs", "architectures", "items"] {
        if let Some(items) = value.get(key).and_then(Value::as_array) {
            return items.clone();
        }
    }
    value
        .get("ref")
        .or_else(|| value.get("graph"))
        .or_else(|| value.get("architecture"))
        .or_else(|| value.get("item"))
        .filter(|item| item.is_object())
        .cloned()
        .or_else(|| value.is_object().then(|| value.clone()))
        .into_iter()
        .collect()
}

fn cloud_mcp_prepare_architecture_graph(mut graph: Value) -> Value {
    let hash = graph
        .get("contentHash")
        .or_else(|| graph.get("content_hash"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            graph
                .get("source")
                .and_then(Value::as_str)
                .map(architecture_content_hash)
        });
    if let Some(object) = graph.as_object_mut() {
        if let Some(hash) = hash {
            object
                .entry("contentHash".to_string())
                .or_insert_with(|| json!(hash.clone()));
            object
                .entry("content_hash".to_string())
                .or_insert_with(|| json!(hash.clone()));
            object
                .entry("contentRevision".to_string())
                .or_insert_with(|| json!(hash.clone()));
            object
                .entry("content_revision".to_string())
                .or_insert_with(|| json!(hash));
        }
        object
            .entry("sourceFormat".to_string())
            .or_insert_with(|| json!("eraserDsl"));
        object
            .entry("source_format".to_string())
            .or_insert_with(|| json!("eraserDsl"));
    }
    graph
}

fn cloud_mcp_architecture_hydrated_graph(mut item: Value) -> Option<Value> {
    let source = cloud_mcp_payload_text(&item, &["source", "source_text", "sourceText"])?;
    let graph_id = cloud_mcp_payload_text(
        &item,
        &[
            "id",
            "architecture_id",
            "architectureId",
            "graph_id",
            "graphId",
        ],
    )?;
    let object = item.as_object_mut()?;
    object.insert("id".to_string(), json!(graph_id));
    object.insert("source".to_string(), json!(source));
    object
        .entry("sourceFormat".to_string())
        .or_insert_with(|| json!("eraserDsl"));
    object
        .entry("source_format".to_string())
        .or_insert_with(|| json!("eraserDsl"));
    Some(item)
}

#[tauri::command]
async fn cloud_mcp_get_workspace_architectures(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    let req = cloud_mcp_repo_request(repo_path, workspace_id.clone(), workspace_name.clone());
    let payload = cloud_mcp_architecture_payload_base(
        &req,
        workspace_id.as_deref().unwrap_or_default(),
        workspace_name.as_deref(),
        "architecture_index_pull",
    );
    let response =
        cloud_mcp_post_json_endpoint(state.inner(), "/v1/workspace/architectures/list", &payload)
            .await?;
    Ok(response.get("data").cloned().unwrap_or(response))
}

#[tauri::command]
async fn cloud_mcp_sync_workspace_architectures(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: String,
    workspace_name: Option<String>,
    graphs: Value,
    reason: Option<String>,
) -> Result<Value, String> {
    let req = cloud_mcp_repo_request(
        repo_path,
        Some(workspace_id.clone()),
        workspace_name.clone(),
    );
    let mut payload = cloud_mcp_architecture_payload_base(
        &req,
        &workspace_id,
        workspace_name.as_deref(),
        reason.as_deref().unwrap_or("architecture_index_sync"),
    );
    let graph_items = cloud_mcp_architecture_graphs_payload(graphs)
        .into_iter()
        .map(cloud_mcp_prepare_architecture_graph)
        .collect::<Vec<_>>();
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "event_kind".to_string(),
            json!("workspace_architecture_snapshot"),
        );
        object.insert("graphs".to_string(), json!(graph_items.clone()));
        object.insert("architectures".to_string(), json!(graph_items));
        object.insert("content_transport".to_string(), json!("refs"));
        object.insert("contentTransport".to_string(), json!("refs"));
    }
    cloud_mcp_post_event_endpoint(state.inner(), "workspace_architecture_snapshot", &payload).await
}

#[tauri::command]
async fn cloud_mcp_sync_workspace_architecture(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: String,
    workspace_name: Option<String>,
    graph: Value,
    reason: Option<String>,
) -> Result<Value, String> {
    let req = cloud_mcp_repo_request(
        repo_path,
        Some(workspace_id.clone()),
        workspace_name.clone(),
    );
    let mut payload = cloud_mcp_architecture_payload_base(
        &req,
        &workspace_id,
        workspace_name.as_deref(),
        reason.as_deref().unwrap_or("architecture_graph_save"),
    );
    let graph = cloud_mcp_prepare_architecture_graph(graph);
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "event_kind".to_string(),
            json!("workspace_architecture_updated"),
        );
        object.insert("graph".to_string(), graph.clone());
        object.insert("graphs".to_string(), json!([graph.clone()]));
        object.insert("architecture".to_string(), graph.clone());
        object.insert("architectures".to_string(), json!([graph]));
        object.insert("content_transport".to_string(), json!("inline"));
        object.insert("contentTransport".to_string(), json!("inline"));
    }
    cloud_mcp_post_event_endpoint(state.inner(), "workspace_architecture_updated", &payload).await
}

#[tauri::command]
async fn cloud_mcp_hydrate_workspace_architecture(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    refs: Value,
) -> Result<Value, String> {
    let req = cloud_mcp_repo_request(repo_path.clone(), workspace_id.clone(), workspace_name.clone());
    let refs_array = cloud_mcp_architecture_refs_array(&refs);
    if refs_array.is_empty() {
        return Ok(json!({
            "kind": "workspace_architecture_hydration",
            "items": [],
            "missing": [],
            "hydratedCount": 0,
            "hydrated_count": 0,
        }));
    }
    let mut payload = cloud_mcp_architecture_payload_base(
        &req,
        workspace_id.as_deref().unwrap_or_default(),
        workspace_name.as_deref(),
        "architecture_content_hydrate",
    );
    if let Some(object) = payload.as_object_mut() {
        object.insert("refs".to_string(), json!(refs_array));
    }
    let response =
        cloud_mcp_post_json_endpoint(state.inner(), "/v1/workspace/architectures/hydrate", &payload)
            .await?;
    let mut data = response.get("data").cloned().unwrap_or(response);
    let hydrated_items = data
        .get("items")
        .or_else(|| data.get("graphs"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut saved_items = Vec::new();
    for item in hydrated_items {
        let Some(graph) = cloud_mcp_architecture_hydrated_graph(item.clone()) else {
            saved_items.push(item);
            continue;
        };
        let repo_for_write = repo_path.clone();
        let saved = tauri::async_runtime::spawn_blocking(move || {
            architecture_graph_write_cloud_arch_blocking(repo_for_write, graph)
        })
        .await
        .map_err(|error| format!("Architecture hydration worker failed: {error}"))??;
        saved_items.push(saved.graph);
    }
    if let Some(object) = data.as_object_mut() {
        let saved_count = saved_items.len();
        object.insert("items".to_string(), json!(saved_items.clone()));
        object.insert("graphs".to_string(), json!(saved_items));
        object.insert("hydrated_count".to_string(), json!(saved_count));
        object.insert("hydratedCount".to_string(), json!(saved_count));
    }
    Ok(data)
}

#[tauri::command]
async fn cloud_mcp_sync_workspace_todos(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: String,
    workspace_name: Option<String>,
    todos: Value,
    reason: Option<String>,
) -> Result<Value, String> {
    let req = cloud_mcp_repo_request(
        repo_path.clone(),
        Some(workspace_id.clone()),
        workspace_name.clone(),
    );
    let device_profile = cloud_mcp_desktop_device_profile();
    let mut payload = match todos {
        Value::Object(object) => Value::Object(object),
        Value::Array(items) => json!({ "todos": items }),
        _ => return Err("Workspace todo sync payload must be an object or array.".to_string()),
    };
    cloud_mcp_limit_workspace_todo_sync_payload(&mut payload);

    if let Some(object) = payload.as_object_mut() {
        object.insert("event_kind".to_string(), json!("workspace_todo_snapshot"));
        object.insert("source".to_string(), json!("rust-diffforge-todo-queue"));
        object.insert(
            "reason".to_string(),
            json!(reason.unwrap_or_else(|| "todo_queue_sync".to_string())),
        );
        object.insert("workspace_id".to_string(), json!(workspace_id.clone()));
        object.insert("workspaceId".to_string(), json!(workspace_id.clone()));
        object.insert(
            "workspace_name".to_string(),
            json!(workspace_name.clone().unwrap_or_default()),
        );
        object.insert(
            "workspaceName".to_string(),
            json!(workspace_name.unwrap_or_default()),
        );
        object.insert("device".to_string(), device_profile.clone());
        object.insert("device_id".to_string(), device_profile["device_id"].clone());
        object.insert("deviceId".to_string(), device_profile["device_id"].clone());
        object.insert("machine_id".to_string(), device_profile["device_id"].clone());
        object.insert("machineId".to_string(), device_profile["device_id"].clone());
        object.insert("device_name".to_string(), device_profile["device_name"].clone());
        object.insert("machine_name".to_string(), device_profile["machine_name"].clone());
        object.insert("snapshot_full".to_string(), json!(true));
        object.insert("snapshotFull".to_string(), json!(true));
        object.insert("prune_missing".to_string(), json!(false));
        object.insert("pruneMissing".to_string(), json!(false));
        object.insert("ts_ms".to_string(), json!(cloud_mcp_now_ms()));
    }

    log_terminal_status_event(
        "backend.workspace_todos.sync_send",
        json!({
            "repoPath": req.root_display,
            "workspaceId": workspace_id,
            "todoCount": payload
                .get("todos")
                .and_then(Value::as_array)
                .map(|items| items.len())
                .unwrap_or(0),
        }),
    );
    let result = cloud_mcp_post_event_endpoint(
        state.inner(),
        "workspace_todo_snapshot",
        &payload,
    )
    .await;
    match &result {
        Ok(value) => log_terminal_status_event(
            "backend.workspace_todos.sync_result",
            json!({
                "ok": true,
                "result": value,
                "workspaceId": workspace_id,
            }),
        ),
        Err(error) => log_terminal_status_event(
            "backend.workspace_todos.sync_error",
            json!({
                "error": clean_terminal_telemetry_text(error),
                "workspaceId": workspace_id,
            }),
        ),
    }
    result
}

#[tauri::command]
async fn cloud_mcp_request_workspace_todo_dispatch(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: String,
    workspace_name: Option<String>,
    todo: Value,
    target: Value,
    dispatch_kind: Option<String>,
    reason: Option<String>,
) -> Result<Value, String> {
    let req = cloud_mcp_repo_request(
        repo_path.clone(),
        Some(workspace_id.clone()),
        workspace_name.clone(),
    );
    let device_profile = cloud_mcp_desktop_device_profile();
    let workspace_name_value = workspace_name.clone().unwrap_or_default();
    let dispatch_source = cloud_mcp_payload_object(
        &todo,
        &[
            "dispatchSource",
            "dispatch_source",
            "sourceContext",
            "source_context",
            "sourceEndpoint",
            "source_endpoint",
        ],
    )
    .unwrap_or_else(|| {
        json!({
            "accountId": "",
            "channel": "native_desktop",
            "clientKind": "rust_desktop",
            "clientType": "rust_desktop",
            "deviceId": device_profile["device_id"].clone(),
            "deviceName": device_profile["device_name"].clone(),
            "formFactor": device_profile["form_factor"].clone(),
            "origin": "todo_dispatch",
            "platform": device_profile["platform"].clone(),
            "surface": "rust-diffforge",
            "workspaceId": workspace_id.clone(),
            "workspaceName": workspace_name_value.clone(),
        })
    });
    let dispatch_target = cloud_mcp_payload_object(
        &target,
        &[
            "dispatchTarget",
            "dispatch_target",
            "targetContext",
            "target_context",
            "targetEndpoint",
            "target_endpoint",
        ],
    )
    .unwrap_or_else(|| {
        json!({
            "accountId": cloud_mcp_payload_text(&target, &["target_account_id", "targetAccountId", "account_id", "accountId"]).unwrap_or_default(),
            "clientId": cloud_mcp_payload_text(&target, &["target_client_id", "targetClientId", "client_id", "clientId"]).unwrap_or_default(),
            "clientKind": cloud_mcp_payload_text(&target, &["target_client_kind", "targetClientKind", "target_client_type", "targetClientType", "client_kind", "clientKind", "client_type", "clientType"]).unwrap_or_else(|| "rust_desktop".to_string()),
            "deviceId": cloud_mcp_payload_text(&target, &["target_device_id", "targetDeviceId", "device_id", "deviceId"]).unwrap_or_default(),
            "deviceName": cloud_mcp_payload_text(&target, &["target_device_name", "targetDeviceName", "device_name", "deviceName"]).unwrap_or_default(),
            "surface": "native_rust_app",
            "workspaceId": cloud_mcp_payload_text(&target, &["target_workspace_id", "targetWorkspaceId", "workspace_id", "workspaceId"]).unwrap_or_default(),
            "workspaceName": cloud_mcp_payload_text(&target, &["target_workspace_name", "targetWorkspaceName", "workspace_name", "workspaceName"]).unwrap_or_default(),
        })
    });
    let mut payload = json!({
        "event_kind": "workspace_todo_dispatch_requested",
        "source": "rust-diffforge-todo-dispatch",
        "reason": reason.unwrap_or_else(|| "todo_dispatch_requested".to_string()),
        "repo_id": req.repo_id,
        "workspace_id": workspace_id,
        "workspaceId": workspace_id,
        "workspace_name": workspace_name_value.clone(),
        "workspaceName": workspace_name_value,
        "requested_by_device_id": device_profile["device_id"].clone(),
        "requestedByDeviceId": device_profile["device_id"].clone(),
        "dispatch_source": dispatch_source.clone(),
        "dispatchSource": dispatch_source,
        "dispatch_source_kind": "rust_desktop",
        "dispatchSourceKind": "rust_desktop",
        "dispatch_target": dispatch_target.clone(),
        "dispatchTarget": dispatch_target,
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "deviceId": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "dispatch_kind": dispatch_kind.unwrap_or_else(|| "remote".to_string()),
        "todo": todo,
        "target": target,
        "ts_ms": cloud_mcp_now_ms(),
    });
    if let Value::Object(object) = &mut payload {
        if let Some(todo_object) = object.get("todo").and_then(Value::as_object).cloned() {
            for (key, value) in todo_object {
                object.entry(key).or_insert(value);
            }
        }
        if let Some(target_object) = object.get("target").and_then(Value::as_object).cloned() {
            for (key, value) in target_object {
                object.entry(key).or_insert(value);
            }
        }
    }
    cloud_mcp_limit_workspace_todo_sync_payload(&mut payload);
    log_terminal_status_event(
        "backend.workspace_todos.dispatch_request",
        json!({
            "workspaceId": workspace_id,
            "targetDeviceId": cloud_mcp_payload_text(&payload, &["target_device_id", "targetDeviceId"]),
            "targetWorkspaceId": cloud_mcp_payload_text(&payload, &["target_workspace_id", "targetWorkspaceId"]),
            "todoId": cloud_mcp_payload_text(&payload, &["todo_id", "todoId", "id"]),
        }),
    );
    cloud_mcp_post_event_endpoint(
        state.inner(),
        "workspace_todo_dispatch_requested",
        &payload,
    )
    .await
}

#[tauri::command]
async fn cloud_mcp_record_todo_dispatch_status(
    state: State<'_, CloudMcpState>,
    dispatch_id: String,
    command_id: Option<String>,
    workspace_id: Option<String>,
    status: String,
    details: Option<Value>,
) -> Result<Value, String> {
    let device_profile = cloud_mcp_desktop_device_profile();
    let mut payload = json!({
        "event_kind": "workspace_todo_dispatch_status",
        "source": "rust-diffforge-todo-dispatch",
        "todo_dispatch_id": dispatch_id,
        "todoDispatchId": dispatch_id,
        "command_id": command_id.clone().unwrap_or_default(),
        "commandId": command_id.unwrap_or_default(),
        "workspace_id": workspace_id.clone().unwrap_or_default(),
        "workspaceId": workspace_id.unwrap_or_default(),
        "device": device_profile.clone(),
        "device_id": device_profile["device_id"].clone(),
        "deviceId": device_profile["device_id"].clone(),
        "device_name": device_profile["device_name"].clone(),
        "machine_name": device_profile["machine_name"].clone(),
        "status": status,
        "dispatch_status": status,
        "dispatchStatus": status,
        "ts_ms": cloud_mcp_now_ms(),
    });
    if let Some(details) = details {
        if !details.is_null() {
            if let Some(dispatch_source) = cloud_mcp_payload_object(
                &details,
                &[
                    "dispatchSource",
                    "dispatch_source",
                    "sourceContext",
                    "source_context",
                    "sourceEndpoint",
                    "source_endpoint",
                ],
            ) {
                payload["dispatch_source"] = dispatch_source.clone();
                payload["dispatchSource"] = dispatch_source;
            }
            if let Some(dispatch_target) = cloud_mcp_payload_object(
                &details,
                &[
                    "dispatchTarget",
                    "dispatch_target",
                    "targetContext",
                    "target_context",
                    "targetEndpoint",
                    "target_endpoint",
                ],
            ) {
                payload["dispatch_target"] = dispatch_target.clone();
                payload["dispatchTarget"] = dispatch_target;
            }
            for (target_key, source_keys) in [
                (
                    "target_agent_id",
                    &["target_agent_id", "targetAgentId", "agent_id", "agentId"][..],
                ),
                (
                    "target_terminal_id",
                    &[
                        "target_terminal_id",
                        "targetTerminalId",
                        "terminal_id",
                        "terminalId",
                        "pane_id",
                        "paneId",
                    ][..],
                ),
                (
                    "target_terminal_index",
                    &[
                        "target_terminal_index",
                        "targetTerminalIndex",
                        "terminal_index",
                        "terminalIndex",
                    ][..],
                ),
                (
                    "target_thread_id",
                    &[
                        "target_thread_id",
                        "targetThreadId",
                        "thread_id",
                        "threadId",
                    ][..],
                ),
                (
                    "target_color_slot",
                    &["target_color_slot", "targetColorSlot", "color_slot", "colorSlot"][..],
                ),
                (
                    "target_terminal_color",
                    &[
                        "target_terminal_color",
                        "targetTerminalColor",
                        "terminal_color",
                        "terminalColor",
                        "color",
                    ][..],
                ),
                (
                    "status_reason",
                    &["status_reason", "statusReason", "reason", "message", "error"][..],
                ),
            ] {
                if cloud_mcp_payload_text(&payload, &[target_key]).is_none() {
                    if let Some(value) = cloud_mcp_payload_text(&details, source_keys) {
                        payload[target_key] = json!(value);
                    }
                }
            }
            payload["details"] = details;
        }
    }
    cloud_mcp_limit_workspace_todo_sync_payload(&mut payload);
    cloud_mcp_post_event_endpoint(state.inner(), "workspace_todo_dispatch_status", &payload).await
}

fn cloud_mcp_todo_body_refs_array(value: &Value) -> Vec<Value> {
    if let Some(items) = value.as_array() {
        return items.clone();
    }
    for key in ["refs", "todoRefs", "todo_refs", "todos", "items"] {
        if let Some(items) = value.get(key).and_then(Value::as_array) {
            return items.clone();
        }
    }
    value
        .get("todo")
        .or_else(|| value.get("ref"))
        .or_else(|| value.get("item"))
        .filter(|item| item.is_object())
        .cloned()
        .or_else(|| value.is_object().then(|| value.clone()))
        .into_iter()
        .collect()
}

fn cloud_mcp_todo_body_cache_key(value: &Value) -> Option<String> {
    let todo_id = cloud_mcp_payload_text(value, &["todo_id", "todoId", "id"])?;
    let device_id = cloud_mcp_payload_text(
        value,
        &[
            "todo_device_id",
            "todoDeviceId",
            "device_id",
            "deviceId",
            "source_device_id",
            "sourceDeviceId",
        ],
    )?;
    let workspace_id = cloud_mcp_payload_text(
        value,
        &[
            "todo_workspace_id",
            "todoWorkspaceId",
            "workspace_id",
            "workspaceId",
            "source_workspace_id",
            "sourceWorkspaceId",
        ],
    )?;
    let revision = cloud_mcp_payload_text(
        value,
        &[
            "todo_revision",
            "todoRevision",
            "body_revision",
            "bodyRevision",
            "revision",
        ],
    )
    .unwrap_or_default();
    let body_hash = cloud_mcp_payload_text(
        value,
        &[
            "todo_body_hash",
            "todoBodyHash",
            "body_hash",
            "bodyHash",
            "hash",
        ],
    )
    .unwrap_or_default();
    if revision.trim().is_empty() && body_hash.trim().is_empty() {
        return None;
    }
    let account_id = cloud_mcp_payload_text(value, &["todo_account_id", "todoAccountId", "account_id", "accountId"])
        .unwrap_or_default();
    Some(format!(
        "{}::{}::{}::{}::{}::{}",
        account_id, device_id, workspace_id, todo_id, revision, body_hash
    ))
}

fn cloud_mcp_todo_body_cache_path() -> Option<PathBuf> {
    let base = env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("APPDATA").map(PathBuf::from))?;
    Some(
        base.join(".diffforge")
            .join("cache")
            .join(CLOUD_MCP_TODO_BODY_CACHE_FILE),
    )
}

fn cloud_mcp_load_todo_body_cache() -> HashMap<String, Value> {
    let Some(path) = cloud_mcp_todo_body_cache_path() else {
        return HashMap::new();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .map(|object| {
            object
                .into_iter()
                .filter(|(_, value)| value.is_object())
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default()
}

fn cloud_mcp_save_todo_body_cache(cache: &HashMap<String, Value>) {
    let Some(path) = cloud_mcp_todo_body_cache_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    if let Ok(text) = serde_json::to_string(cache) {
        let _ = fs::write(path, text);
    }
}

fn cloud_mcp_prune_todo_body_cache(cache: &mut HashMap<String, Value>) {
    if cache.len() <= CLOUD_MCP_TODO_BODY_CACHE_MAX_ITEMS {
        return;
    }
    let mut entries = cache
        .iter()
        .map(|(key, value)| {
            (
                key.clone(),
                value
                    .get("lastAccessedMs")
                    .and_then(Value::as_u64)
                    .or_else(|| value.get("cachedAtMs").and_then(Value::as_u64))
                    .unwrap_or(0),
            )
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|(_, last_accessed_ms)| *last_accessed_ms);
    let remove_count = cache.len().saturating_sub(CLOUD_MCP_TODO_BODY_CACHE_MAX_ITEMS);
    for (key, _) in entries.into_iter().take(remove_count) {
        cache.remove(&key);
    }
}

#[tauri::command]
async fn cloud_mcp_hydrate_workspace_todos(
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    refs: Value,
) -> Result<Value, String> {
    let req = cloud_mcp_repo_request(repo_path, workspace_id.clone(), workspace_name.clone());
    let refs_array = cloud_mcp_todo_body_refs_array(&refs);
    if refs_array.is_empty() {
        return Ok(json!({
            "kind": "workspace_todo_hydration",
            "items": [],
            "missing": [],
            "cachedCount": 0,
            "hydratedCount": 0,
        }));
    }

    let now_ms = cloud_mcp_now_ms();
    let mut cached_items = Vec::new();
    let mut misses = Vec::new();
    let mut cache_changed = false;
    {
        let mut cache = state.todo_body_cache.lock().await;
        for item in refs_array.iter() {
            let Some(key) = cloud_mcp_todo_body_cache_key(item) else {
                misses.push(item.clone());
                continue;
            };
            if let Some(cached) = cache.get_mut(&key) {
                if let Some(object) = cached.as_object_mut() {
                    object.insert("cached".to_string(), json!(true));
                    object.insert("lastAccessedMs".to_string(), json!(now_ms));
                }
                cached_items.push(cached.clone());
                cache_changed = true;
            } else {
                misses.push(item.clone());
            }
        }
        if cache_changed {
            cloud_mcp_prune_todo_body_cache(&mut cache);
            cloud_mcp_save_todo_body_cache(&cache);
        }
    }

    let mut hydrated_items = Vec::new();
    let mut missing_items = Vec::new();
    if !misses.is_empty() {
        let payload = json!({
            "repo_id": req.repo_id,
            "repo_path": req.root_display,
            "workspace_root": req.root_display,
            "workspace_id": req.workspace_id.clone().unwrap_or_default(),
            "workspaceId": req.workspace_id.clone().unwrap_or_default(),
            "workspace_name": req.workspace_name.clone().unwrap_or_default(),
            "workspaceName": req.workspace_name.clone().unwrap_or_default(),
            "refs": misses,
        });
        let response =
            cloud_mcp_post_json_endpoint(state.inner(), "/v1/workspace/todos/hydrate", &payload)
                .await?;
        let data = response.get("data").cloned().unwrap_or(response);
        hydrated_items = data
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        missing_items = data
            .get("missing")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if !hydrated_items.is_empty() {
            let mut cache = state.todo_body_cache.lock().await;
            for item in &hydrated_items {
                if let Some(key) = cloud_mcp_todo_body_cache_key(item) {
                    let mut cached = item.clone();
                    if let Some(object) = cached.as_object_mut() {
                        object.insert("cached".to_string(), json!(false));
                        object.insert("cachedAtMs".to_string(), json!(now_ms));
                        object.insert("lastAccessedMs".to_string(), json!(now_ms));
                    }
                    cache.insert(key, cached);
                }
            }
            cloud_mcp_prune_todo_body_cache(&mut cache);
            cloud_mcp_save_todo_body_cache(&cache);
        }
    }

    let mut items = cached_items;
    items.extend(hydrated_items);
    let cached_count = items
        .iter()
        .filter(|item| item.get("cached").and_then(Value::as_bool).unwrap_or(false))
        .count();
    let hydrated_count = items.len().saturating_sub(cached_count);
    Ok(json!({
        "kind": "workspace_todo_hydration",
        "version": 1,
        "items": items,
        "missing": missing_items,
        "cached_count": cached_count,
        "cachedCount": cached_count,
        "hydrated_count": hydrated_count,
        "hydratedCount": hydrated_count,
    }))
}

fn cloud_mcp_limit_workspace_todo_sync_payload(value: &mut Value) {
    match value {
        Value::Array(items) => {
            items.truncate(CLOUD_MCP_WORKSPACE_TODO_MAX_ITEMS);
            for item in items.iter_mut() {
                cloud_mcp_limit_workspace_todo_sync_payload(item);
            }
        }
        Value::Object(object) => {
            if let Some(items) = object.get_mut("todos").and_then(Value::as_array_mut) {
                items.truncate(CLOUD_MCP_WORKSPACE_TODO_MAX_ITEMS);
            }
            for (key, child) in object.iter_mut() {
                let normalized_key = key.to_ascii_lowercase();
                if matches!(
                    normalized_key.as_str(),
                    "src" | "dataurl" | "data_url" | "image_data" | "imagedata"
                ) {
                    *child = Value::Null;
                    continue;
                }
                if matches!(
                    normalized_key.as_str(),
                    "text" | "title" | "body" | "prompt" | "notetext" | "note_text"
                ) {
                    if let Value::String(text) = child {
                        *text = cloud_mcp_truncate_chars(
                            text,
                            CLOUD_MCP_WORKSPACE_TODO_TEXT_MAX_CHARS,
                        );
                    }
                    continue;
                }
                cloud_mcp_limit_workspace_todo_sync_payload(child);
            }
        }
        Value::String(text) => {
            if text.chars().count() > CLOUD_MCP_WORKSPACE_TODO_TEXT_MAX_CHARS {
                *text = cloud_mcp_truncate_chars(text, CLOUD_MCP_WORKSPACE_TODO_TEXT_MAX_CHARS);
            }
        }
        _ => {}
    }
}

fn cloud_mcp_truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    value.chars().take(max_chars).collect()
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
struct CloudMcpRepoRequest {
    root_display: String,
    repo_id: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
}

fn cloud_mcp_repo_request(
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> CloudMcpRepoRequest {
    let root = resolve_workspace_root_directory(Some(&repo_path))
        .unwrap_or_else(|_| PathBuf::from(&repo_path));
    let root_display = workspace_path_display(&root);
    let repo_id = cloud_mcp_repo_id_for_root(&root);
    CloudMcpRepoRequest {
        root_display,
        repo_id,
        workspace_id,
        workspace_name,
    }
}

fn cloud_mcp_task_history_cache_key(req: &CloudMcpRepoRequest) -> String {
    format!(
        "{}:{}",
        req.repo_id,
        req.workspace_id.clone().unwrap_or_default()
    )
}

fn cloud_mcp_task_history_loading_snapshot(req: &CloudMcpRepoRequest, cached: bool) -> Value {
    json!({
        "kind": "task_history",
        "version": 1,
        "cached": cached,
        "loading": !cached,
        "repoId": req.repo_id.clone(),
        "repo_id": req.repo_id.clone(),
        "repoPath": req.root_display.clone(),
        "repo_path": req.root_display.clone(),
        "workspaceId": req.workspace_id.clone().unwrap_or_default(),
        "workspace_id": req.workspace_id.clone().unwrap_or_default(),
        "workspaceName": req.workspace_name.clone().unwrap_or_default(),
        "workspace_name": req.workspace_name.clone().unwrap_or_default(),
        "syncState": if cached { "cached" } else { "loading" },
        "tasks": [],
    })
}

fn cloud_mcp_task_history_enrich_snapshot(req: &CloudMcpRepoRequest, data: Value) -> Value {
    let mut object = data
        .as_object()
        .cloned()
        .unwrap_or_else(serde_json::Map::new);
    object
        .entry("kind".to_string())
        .or_insert_with(|| json!("task_history"));
    object
        .entry("version".to_string())
        .or_insert_with(|| json!(1));
    object.insert("cached".to_string(), json!(false));
    object.insert("loading".to_string(), json!(false));
    object.insert("repoId".to_string(), json!(req.repo_id.clone()));
    object.insert("repo_id".to_string(), json!(req.repo_id.clone()));
    object.insert("repoPath".to_string(), json!(req.root_display.clone()));
    object.insert("repo_path".to_string(), json!(req.root_display.clone()));
    object.insert(
        "workspaceId".to_string(),
        json!(req.workspace_id.clone().unwrap_or_default()),
    );
    object.insert(
        "workspace_id".to_string(),
        json!(req.workspace_id.clone().unwrap_or_default()),
    );
    object.insert(
        "workspaceName".to_string(),
        json!(req.workspace_name.clone().unwrap_or_default()),
    );
    object.insert(
        "workspace_name".to_string(),
        json!(req.workspace_name.clone().unwrap_or_default()),
    );
    object.insert("syncState".to_string(), json!("ready"));
    Value::Object(object)
}

fn cloud_mcp_schedule_task_history_refresh(
    app: AppHandle,
    state: CloudMcpState,
    req: CloudMcpRepoRequest,
    cache_key: String,
    payload: Value,
) {
    tauri::async_runtime::spawn(async move {
        let response = cloud_mcp_post_json_endpoint(&state, "/v1/task/history", &payload).await;
        {
            let mut refreshes = state.task_history_refreshes.lock().await;
            refreshes.remove(&cache_key);
        }

        match response {
            Ok(response) => {
                let snapshot = cloud_mcp_task_history_enrich_snapshot(
                    &req,
                    response.get("data").cloned().unwrap_or(response),
                );
                {
                    let mut cache = state.task_history_cache.lock().await;
                    cache.insert(cache_key.clone(), snapshot.clone());
                }
                let _ = app.emit(
                    CLOUD_MCP_TASK_HISTORY_UPDATED_EVENT,
                    json!({
                        "cacheKey": cache_key,
                        "repoId": req.repo_id,
                        "repoPath": req.root_display,
                        "workspaceId": req.workspace_id.unwrap_or_default(),
                        "workspaceName": req.workspace_name.unwrap_or_default(),
                        "taskHistory": snapshot,
                    }),
                );
            }
            Err(error) => {
                log_terminal_status_event(
                    "backend.cloud_mcp.task_history_refresh.error",
                    json!({
                        "cacheKey": cache_key,
                        "error": clean_terminal_telemetry_text(&error),
                        "repoId": req.repo_id.clone(),
                        "repoPath": req.root_display.clone(),
                        "workspaceId": req.workspace_id.clone().unwrap_or_default(),
                    }),
                );
                let _ = app.emit(
                    CLOUD_MCP_TASK_HISTORY_UPDATED_EVENT,
                    json!({
                        "cacheKey": cache_key,
                        "error": clean_terminal_telemetry_text(&error),
                        "repoId": req.repo_id.clone(),
                        "repoPath": req.root_display.clone(),
                        "workspaceId": req.workspace_id.unwrap_or_default(),
                        "workspaceName": req.workspace_name.unwrap_or_default(),
                    }),
                );
            }
        }
    });
}

#[tauri::command]
async fn cloud_mcp_get_task_history(
    app: AppHandle,
    state: State<'_, CloudMcpState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
) -> Result<Value, String> {
    let req = cloud_mcp_repo_request(repo_path, workspace_id, workspace_name);
    let cache_key = cloud_mcp_task_history_cache_key(&req);
    let payload = json!({
        "repo_id": req.repo_id.clone(),
        "repo_path": req.root_display.clone(),
        "workspace_root": req.root_display.clone(),
        "workspace_id": req.workspace_id.clone().unwrap_or_default(),
        "workspace_name": req.workspace_name.clone().unwrap_or_default(),
        "history_limit": 80,
        "task_limit": 120,
    });
    let cached_snapshot = {
        let cache = state.task_history_cache.lock().await;
        cache.get(&cache_key).cloned()
    };
    let should_refresh = {
        let mut refreshes = state.task_history_refreshes.lock().await;
        if refreshes.contains(&cache_key) {
            false
        } else {
            refreshes.insert(cache_key.clone());
            true
        }
    };

    if should_refresh {
        cloud_mcp_schedule_task_history_refresh(
            app,
            state.inner().clone(),
            req.clone(),
            cache_key,
            payload,
        );
    }

    Ok(cached_snapshot.unwrap_or_else(|| cloud_mcp_task_history_loading_snapshot(&req, false)))
}

fn cloud_mcp_container_project_mounts(root: &Path) -> Vec<WorkspaceProjectMount> {
    let mounts = workspace_project_mounts(root);
    let workspace_kind = workspace_kind_for_mounts(root, &mounts);
    cloud_mcp_project_mounts_for_workspace_sync(root, &workspace_kind, &mounts)
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

    fn test_cloud_root(prefix: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        env::temp_dir().join(format!("{prefix}-{suffix}"))
    }

    fn create_cloud_package_project(root: &Path) {
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("package.json"), "{}\n").unwrap();
        fs::write(root.join("src").join("app.js"), "console.log('ok');\n").unwrap();
    }

    fn init_cloud_git_repo(root: &Path) -> bool {
        fs::create_dir_all(root).unwrap();
        Command::new("git")
            .arg("-C")
            .arg(root)
            .arg("init")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    #[tokio::test]
    async fn remote_command_receipt_claim_dedupes_command_ids() {
        let state = CloudMcpState::new();
        let event = json!({
            "client_id": "client-1",
            "workspace_id": "workspace-1",
            "command_id": "remote-command-123",
            "event_kind": "remote_command_requested",
        });

        assert!(cloud_mcp_claim_remote_command_receipt(&state, &event).await);
        assert!(!cloud_mcp_claim_remote_command_receipt(&state, &event).await);

        let other_workspace = json!({
            "client_id": "client-1",
            "workspace_id": "workspace-2",
            "command_id": "remote-command-123",
            "event_kind": "remote_command_requested",
        });
        assert!(cloud_mcp_claim_remote_command_receipt(&state, &other_workspace).await);
    }

    #[test]
    fn terminal_nickname_text_only_allows_workspace_pool_names() {
        let payload = json!({
            "terminal_nickname": "b-o-b",
            "terminalName": "Codex",
        });
        assert_eq!(
            cloud_mcp_terminal_nickname_text(
                &payload,
                &["terminal_nickname", "terminalName"],
            ),
            Some("Bob".to_string()),
        );

        let fallback = json!({
            "terminal_nickname": "Codex",
            "terminalName": "ali",
        });
        assert_eq!(
            cloud_mcp_terminal_nickname_text(
                &fallback,
                &["terminal_nickname", "terminalName"],
            ),
            Some("Ali".to_string()),
        );

        let rejected = json!({
            "terminal_nickname": "Charlie",
            "terminalName": "Codex",
        });
        assert_eq!(
            cloud_mcp_terminal_nickname_text(
                &rejected,
                &["terminal_nickname", "terminalName"],
            ),
            None,
        );
    }

    #[test]
    fn terminal_output_classifier_handles_codex_ready_redraw() {
        let finished_screen = "\u{1b}[39;49m\u{1b}[K\u{1b}[2m•  \u{1b}[22mThe project is basically empty.\u{1b}[39m\u{1b}[49m\u{1b}[0m\
\u{1b}[r\u{1b}[47;3H\u{1b}[45;2H\u{1b}[0m\u{1b}[49m\u{1b}[K\
\u{1b}[47;1H\u{1b}[1m›\u{1b}[47;3H\u{1b}[22m\u{1b}[2mExplain this codebase\
\u{1b}[49;3H\u{1b}[38;2;246;226;183;49mgpt-5.5 xhigh\u{1b}[39;49m · \
\u{1b}[38;2;171;223;167;49m~/Documents/CODING/testforge\u{1b}[39m\u{1b}[49m";

        assert!(cloud_mcp_terminal_output_looks_ready(finished_screen));
        assert!(!cloud_mcp_terminal_output_looks_active(finished_screen));
    }

    #[test]
    fn terminal_output_classifier_keeps_codex_working_screen_active() {
        let working_screen = "\u{1b}[44;3H\u{1b}[2mWorking\u{1b}[22m \u{1b}[2m(10s • esc to interrupt)\u{1b}[39m\
\u{1b}[47;1H\u{1b}[22m\u{1b}[1m›\u{1b}[47;3H\u{1b}[22m\u{1b}[2mExplain this codebase";

        assert!(!cloud_mcp_terminal_output_looks_ready(working_screen));
        assert!(cloud_mcp_terminal_output_looks_active(working_screen));
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
            None,
        )
        .unwrap_err();

        assert!(error.contains("active local task"));
    }

    #[test]
    fn cloud_workspace_bundle_prepares_container_manifest_and_child_filetrees() {
        let root = test_cloud_root("diffforge-cloud-container-bundle");
        create_cloud_package_project(&root.join("frontend"));
        create_cloud_package_project(&root.join("backend"));
        fs::write(root.join("README.md"), "# container only\n").unwrap();

        let bundle = cloud_mcp_prepare_workspace_bundle(
            workspace_path_display(&root),
            Some("workspace-test".to_string()),
            Some("Suite".to_string()),
        )
        .unwrap();
        let primary_paths = bundle
            .primary
            .filetree
            .iter()
            .map(|entry| entry.relative_path.as_str())
            .collect::<HashSet<_>>();

        assert_eq!(bundle.primary.workspace_kind, "container");
        assert_eq!(bundle.primary.project_mounts.len(), 2);
        assert_eq!(bundle.children.len(), 2);
        assert!(primary_paths.contains("backend"));
        assert!(primary_paths.contains("frontend"));
        assert!(!primary_paths.contains("README.md"));
        assert!(
            bundle
                .children
                .iter()
                .all(|child| child.workspace_kind == "project")
        );
        assert!(bundle.children.iter().all(|child| {
            child
                .filetree
                .iter()
                .any(|entry| entry.relative_path == "src/app.js")
        }));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn git_workspace_bundle_splits_nested_git_repo_into_child_mount() {
        let root = test_cloud_root("diffforge-cloud-git-nested-bundle");
        if !init_cloud_git_repo(&root) {
            let _ = fs::remove_dir_all(root);
            return;
        }
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("README.md"), "# parent\n").unwrap();
        fs::write(root.join("src").join("root.rs"), "fn main() {}\n").unwrap();
        let child = root.join("packages").join("mobile");
        create_cloud_package_project(&child);
        if !init_cloud_git_repo(&child) {
            let _ = fs::remove_dir_all(root);
            return;
        }

        let bundle = cloud_mcp_prepare_workspace_bundle(
            workspace_path_display(&root),
            Some("workspace-test".to_string()),
            Some("Suite".to_string()),
        )
        .unwrap();
        let primary_paths = bundle
            .primary
            .filetree
            .iter()
            .map(|entry| (entry.relative_path.as_str(), entry.kind.as_str()))
            .collect::<HashSet<_>>();

        assert_eq!(bundle.primary.workspace_kind, "git_repo");
        assert_eq!(bundle.primary.project_mounts.len(), 1);
        assert_eq!(
            bundle.primary.project_mounts[0].workspace_relative_path,
            "packages/mobile"
        );
        assert_eq!(bundle.children.len(), 1);
        assert!(primary_paths.contains(&("README.md", "file")));
        assert!(primary_paths.contains(&("src", "directory")));
        assert!(primary_paths.contains(&("src/root.rs", "file")));
        assert!(primary_paths.contains(&("packages", "container")));
        assert!(primary_paths.contains(&("packages/mobile", "project")));
        assert!(
            !primary_paths
                .iter()
                .any(|(path, _)| *path == "packages/mobile/src/app.js")
        );
        assert!(
            bundle.children[0]
                .filetree
                .iter()
                .any(|entry| entry.relative_path == "src/app.js")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn container_filetree_payload_is_mount_manifest_not_authoritative_tree() {
        let root = test_cloud_root("diffforge-cloud-container-filetree-payload");
        create_cloud_package_project(&root.join("frontend"));
        fs::write(root.join("README.md"), "# parent only\n").unwrap();

        let project_mounts = cloud_mcp_container_project_mounts(&root);
        let (filetree, truncated) = cloud_mcp_container_mount_filetree(&root, &project_mounts);
        let paths = filetree
            .iter()
            .map(|entry| entry.relative_path.as_str())
            .collect::<HashSet<_>>();

        assert!(!project_mounts.is_empty());
        assert!(!truncated);
        assert!(paths.contains("frontend"));
        assert!(!paths.contains("README.md"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn nested_container_filetree_payload_preserves_container_layers() {
        let root = test_cloud_root("diffforge-cloud-nested-container-filetree");
        create_cloud_package_project(&root.join("product-a").join("frontend"));
        create_cloud_package_project(&root.join("product-a").join("backend"));
        create_cloud_package_project(&root.join("product-b").join("api"));
        fs::write(root.join("README.md"), "# parent only\n").unwrap();

        let project_mounts = cloud_mcp_container_project_mounts(&root);
        let (filetree, truncated) = cloud_mcp_container_mount_filetree(&root, &project_mounts);
        let path_kinds = filetree
            .iter()
            .map(|entry| (entry.relative_path.as_str(), entry.kind.as_str()))
            .collect::<HashSet<_>>();

        assert_eq!(project_mounts.len(), 3);
        assert!(!truncated);
        assert!(path_kinds.contains(&("product-a", "container")));
        assert!(path_kinds.contains(&("product-b", "container")));
        assert!(path_kinds.contains(&("product-a/frontend", "project")));
        assert!(path_kinds.contains(&("product-a/backend", "project")));
        assert!(path_kinds.contains(&("product-b/api", "project")));
        assert!(!path_kinds.iter().any(|(path, _)| *path == "README.md"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn plain_unknown_workspace_bundle_is_discovery_only_not_authoritative_filetree() {
        let root = test_cloud_root("diffforge-cloud-plain-discovery-filetree");
        fs::create_dir_all(root.join("archive")).unwrap();
        fs::write(
            root.join("private-notes.txt"),
            "do not sync this filename as a project\n",
        )
        .unwrap();
        fs::write(root.join("archive").join("large.log"), "metadata only\n").unwrap();

        let bundle = cloud_mcp_prepare_workspace_bundle(
            workspace_path_display(&root),
            Some("workspace-test".to_string()),
            Some("Plain Folder".to_string()),
        )
        .unwrap();

        assert_eq!(bundle.primary.workspace_kind, "plain");
        assert!(bundle.primary.filetree.is_empty());
        assert!(bundle.primary.project_mounts.is_empty());
        assert!(bundle.children.is_empty());
        assert!(!cloud_mcp_workspace_kind_filetree_authoritative("plain"));

        let _ = fs::remove_dir_all(root);
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

        let base_url = cloud_mcp_base_url_override_allowed()
            .then(|| {
                values
                    .get("base-url")
                    .cloned()
                    .or_else(|| env::var("CLOUD_DIFFFORGE_BASE_URL").ok())
                    .or_else(|| env::var("CLOUD_MCP_BASE_URL").ok())
                    .and_then(|value| cloud_mcp_normalized_base_url(&value))
            })
            .flatten();

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

pub(crate) fn cloud_mcp_forward_agent_list_todo_targets(
    repo_path: Option<&str>,
    db_path: Option<&Path>,
    workspace_id: Option<&str>,
    base_url_override: Option<&str>,
    agent_id: Option<&str>,
    session_id: Option<&str>,
) -> Result<Value, String> {
    let repo_path_text = repo_path
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
    let request = cloud_mcp_proxy_agent_base_payload(
        &identity,
        "rust-diffforge-agent-list-todo-targets",
    );
    identity.log(
        "cloud_mcp.agent_list_todo_targets.start",
        "list_todo_targets",
        json!({
            "activity": "agent list todo targets",
            "baseUrl": base_url,
        }),
    );
    match cloud_mcp_proxy_post_json_endpoint(&base_url, "/v1/status", &request.to_string()) {
        Ok(response) => {
            let parsed = serde_json::from_str::<Value>(&response)
                .unwrap_or_else(|_| json!({"raw_response": response}));
            let data = parsed.get("data").cloned().unwrap_or(parsed);
            let workspace_todos = data
                .get("workspace_todos")
                .or_else(|| data.get("workspaceTodos"))
                .cloned()
                .unwrap_or_else(|| json!({}));
            let targets = cloud_mcp_proxy_todo_targets_from_workspace_todos(
                &workspace_todos,
                identity.workspace_id.as_deref(),
            );
            identity.log(
                "cloud_mcp.agent_list_todo_targets.done",
                "list_todo_targets",
                json!({
                    "activity": "agent todo targets listed",
                    "baseUrl": base_url,
                    "targetCount": targets.len(),
                }),
            );
            Ok(json!({
                "kind": "todo_targets",
                "mode_support": ["listed", "queued"],
                "workspace_id": identity.workspace_id,
                "targets": targets,
                "workspace_todos": workspace_todos,
            }))
        }
        Err(error) => {
            identity.log(
                "cloud_mcp.agent_list_todo_targets.error",
                "list_todo_targets",
                json!({
                    "activity": "agent list todo targets failed",
                    "baseUrl": base_url,
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );
            Err(error)
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn cloud_mcp_forward_agent_send_todo_to_device(
    repo_path: Option<&str>,
    db_path: Option<&Path>,
    workspace_id: Option<&str>,
    base_url_override: Option<&str>,
    agent_id: Option<&str>,
    session_id: Option<&str>,
    mode: &str,
    text: &str,
    title: Option<&str>,
    target_device_id: &str,
    target_workspace_id: &str,
    target_workspace_name: Option<&str>,
    target_device_name: Option<&str>,
    target_client_id: Option<&str>,
    target_agent_id: Option<&str>,
    target_terminal_id: Option<&str>,
    target_terminal_index: Option<i64>,
    target_thread_id: Option<&str>,
    target_color_slot: Option<i64>,
    target_terminal_color: Option<&str>,
    todo_id: Option<&str>,
    client_request_id: Option<&str>,
) -> Result<Value, String> {
    let mode = cloud_mcp_proxy_normalize_todo_send_mode(mode)?;
    let text = cloud_mcp_clean_prompt_text(text);
    if text.trim().is_empty() {
        return Err("send_todo_to_device requires non-empty text.".to_string());
    }
    let target_device_id = target_device_id.trim();
    if target_device_id.is_empty() {
        return Err("send_todo_to_device requires target_device_id.".to_string());
    }
    let target_workspace_id = target_workspace_id.trim();
    if target_workspace_id.is_empty() {
        return Err("send_todo_to_device requires target_workspace_id.".to_string());
    }
    let repo_path_text = repo_path
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
    let source_workspace_id = identity.workspace_id.as_deref().unwrap_or_default();
    let device_profile = cloud_mcp_desktop_device_profile();
    let source_device_id = cloud_mcp_payload_text(&device_profile, &["device_id", "deviceId"])
        .unwrap_or_else(|| "desktop-primary".to_string());
    let request_id = client_request_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let todo_id = todo_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("agent-todo-{request_id}"));
    let title = title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| cloud_mcp_prompt_summary(&text));
    let mut payload = cloud_mcp_proxy_agent_base_payload(
        &identity,
        if mode == "queued" {
            "cloud-agent-todo-dispatch"
        } else {
            "cloud-agent-listed-todo"
        },
    );
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "event_kind".to_string(),
            json!(if mode == "queued" {
                "workspace_todo_dispatch_requested"
            } else {
                "workspace_todo_listed_created"
            }),
        );
        object.insert("mode".to_string(), json!(mode.as_str()));
        object.insert("todo_id".to_string(), json!(todo_id.as_str()));
        object.insert("todoId".to_string(), json!(todo_id.as_str()));
        object.insert("title".to_string(), json!(title.as_str()));
        object.insert("text".to_string(), json!(text.as_str()));
        object.insert("body".to_string(), json!(text.as_str()));
        object.insert("target_device_id".to_string(), json!(target_device_id));
        object.insert("targetDeviceId".to_string(), json!(target_device_id));
        object.insert(
            "target_workspace_id".to_string(),
            json!(target_workspace_id),
        );
        object.insert(
            "targetWorkspaceId".to_string(),
            json!(target_workspace_id),
        );
        object.insert("requested_by_device_id".to_string(), json!(source_device_id));
        object.insert("requestedByDeviceId".to_string(), json!(source_device_id));
        if !source_workspace_id.is_empty() {
            object.insert(
                "requested_by_workspace_id".to_string(),
                json!(source_workspace_id),
            );
            object.insert(
                "requestedByWorkspaceId".to_string(),
                json!(source_workspace_id),
            );
            object.insert("todo_workspace_id".to_string(), json!(source_workspace_id));
            object.insert("todoWorkspaceId".to_string(), json!(source_workspace_id));
        }
        object.insert("todo_device_id".to_string(), json!(source_device_id));
        object.insert("todoDeviceId".to_string(), json!(source_device_id));
        if let Some(value) = target_workspace_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            object.insert("target_workspace_name".to_string(), json!(value));
            object.insert("targetWorkspaceName".to_string(), json!(value));
        }
        if let Some(value) = target_device_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            object.insert("target_device_name".to_string(), json!(value));
            object.insert("targetDeviceName".to_string(), json!(value));
        }
        if let Some(value) = target_client_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            object.insert("target_client_id".to_string(), json!(value));
            object.insert("targetClientId".to_string(), json!(value));
        }
        cloud_mcp_proxy_insert_todo_assignment(
            object,
            target_agent_id,
            target_terminal_id,
            target_terminal_index,
            target_thread_id,
            target_color_slot,
            target_terminal_color,
        );
        let todo_id_value = object.get("todoId").cloned().unwrap_or(Value::Null);
        object.insert(
            "todo".to_string(),
            json!({
                "id": todo_id_value.clone(),
                "todoId": todo_id_value,
                "title": title.as_str(),
                "text": text.as_str(),
            }),
        );
        object.insert(
            "target".to_string(),
            json!({
                "targetDeviceId": target_device_id,
                "targetWorkspaceId": target_workspace_id,
                "targetWorkspaceName": target_workspace_name.unwrap_or_default(),
                "targetDeviceName": target_device_name.unwrap_or_default(),
                "targetClientId": target_client_id.unwrap_or_default(),
            }),
        );
        if mode == "queued" {
            let dispatch_id = format!("todo-dispatch-{request_id}");
            let command_id = format!("todo-command-{request_id}");
            object.insert("dispatch_id".to_string(), json!(dispatch_id.as_str()));
            object.insert("dispatchId".to_string(), json!(dispatch_id.as_str()));
            object.insert("command_id".to_string(), json!(command_id.as_str()));
            object.insert("commandId".to_string(), json!(command_id.as_str()));
            object.insert("dispatch_kind".to_string(), json!("remote"));
            object.insert("dispatchKind".to_string(), json!("remote"));
        }
    }

    let event_kind = payload["event_kind"]
        .as_str()
        .unwrap_or("workspace_todo_listed_created");
    let request = cloud_mcp_event_envelope(event_kind, &payload);
    identity.log(
        "cloud_mcp.agent_send_todo_to_device.start",
        "send_todo_to_device",
        json!({
            "activity": "agent send todo to device",
            "baseUrl": base_url,
            "mode": mode,
            "targetDeviceId": target_device_id,
            "targetWorkspaceId": target_workspace_id,
        }),
    );
    match cloud_mcp_proxy_post_json_endpoint(&base_url, "/v1/events", &request.to_string()) {
        Ok(response) => {
            let parsed = serde_json::from_str::<Value>(&response)
                .unwrap_or_else(|_| json!({"raw_response": response}));
            identity.log(
                "cloud_mcp.agent_send_todo_to_device.done",
                "send_todo_to_device",
                json!({
                    "activity": "agent sent todo to device",
                    "baseUrl": base_url,
                    "mode": mode,
                    "targetDeviceId": target_device_id,
                    "targetWorkspaceId": target_workspace_id,
                }),
            );
            Ok(json!({
                "mode": mode,
                "event_kind": event_kind,
                "target_device_id": target_device_id,
                "target_workspace_id": target_workspace_id,
                "response": parsed,
            }))
        }
        Err(error) => {
            identity.log(
                "cloud_mcp.agent_send_todo_to_device.error",
                "send_todo_to_device",
                json!({
                    "activity": "agent send todo to device failed",
                    "baseUrl": base_url,
                    "mode": mode,
                    "targetDeviceId": target_device_id,
                    "targetWorkspaceId": target_workspace_id,
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );
            Err(error)
        }
    }
}

fn cloud_mcp_proxy_agent_base_payload(identity: &CloudMcpProxyIdentity, source: &str) -> Value {
    let mut payload = serde_json::Map::new();
    payload.insert("source".to_string(), json!(source));
    payload.insert("client_id".to_string(), json!(identity.client_id));
    payload.insert("ts_ms".to_string(), json!(cloud_mcp_now_ms()));
    if let Some(repo_id) = identity.repo_id.as_deref() {
        payload.insert("repo_id".to_string(), json!(repo_id));
        payload.insert("repoId".to_string(), json!(repo_id));
    }
    if let Some(repo_path) = identity.repo_path.as_ref() {
        let repo_path = repo_path.to_string_lossy().to_string();
        payload.insert("repo_path".to_string(), json!(repo_path.clone()));
        payload.insert("workspace_root".to_string(), json!(repo_path));
    }
    if let Some(workspace_id) = identity.workspace_id.as_deref() {
        payload.insert("workspace_id".to_string(), json!(workspace_id));
        payload.insert("workspaceId".to_string(), json!(workspace_id));
    }
    if let Some(agent_id) = identity.cloud_agent_id() {
        payload.insert("agent_id".to_string(), json!(agent_id.clone()));
        payload.insert("self_agent_id".to_string(), json!(agent_id.clone()));
        payload.insert("current_agent_id".to_string(), json!(agent_id));
    }
    if let Some(session_id) = identity.session_id.as_deref() {
        payload.insert("session_id".to_string(), json!(session_id));
    }
    Value::Object(payload)
}

fn cloud_mcp_proxy_normalize_todo_send_mode(mode: &str) -> Result<String, String> {
    let normalized = mode
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' ', '.'], "_");
    match normalized.as_str() {
        "" | "list" | "listed" | "listed_only" | "todo_list" => Ok("listed".to_string()),
        "queue" | "queued" | "dispatch" | "active_queue" | "run_if_online" => {
            Ok("queued".to_string())
        }
        _ => Err("send_todo_to_device mode must be listed or queued.".to_string()),
    }
}

#[allow(clippy::too_many_arguments)]
fn cloud_mcp_proxy_insert_todo_assignment(
    object: &mut serde_json::Map<String, Value>,
    target_agent_id: Option<&str>,
    target_terminal_id: Option<&str>,
    target_terminal_index: Option<i64>,
    target_thread_id: Option<&str>,
    target_color_slot: Option<i64>,
    target_terminal_color: Option<&str>,
) {
    if let Some(value) = target_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        object.insert("target_agent_id".to_string(), json!(value));
        object.insert("targetAgentId".to_string(), json!(value));
    }
    if let Some(value) = target_terminal_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        object.insert("target_terminal_id".to_string(), json!(value));
        object.insert("targetTerminalId".to_string(), json!(value));
    }
    if let Some(value) = target_terminal_index {
        object.insert("target_terminal_index".to_string(), json!(value));
        object.insert("targetTerminalIndex".to_string(), json!(value));
    }
    if let Some(value) = target_thread_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        object.insert("target_thread_id".to_string(), json!(value));
        object.insert("targetThreadId".to_string(), json!(value));
    }
    if let Some(value) = target_color_slot {
        object.insert("target_color_slot".to_string(), json!(value));
        object.insert("targetColorSlot".to_string(), json!(value));
    }
    if let Some(value) = target_terminal_color
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        object.insert("target_terminal_color".to_string(), json!(value));
        object.insert("targetTerminalColor".to_string(), json!(value));
    }
}

fn cloud_mcp_proxy_todo_targets_from_workspace_todos(
    workspace_todos: &Value,
    workspace_id: Option<&str>,
) -> Vec<Value> {
    let mut targets = Vec::<Value>::new();
    let mut seen = std::collections::HashSet::<String>::new();
    cloud_mcp_proxy_collect_todo_targets(
        workspace_todos.get("dispatchTargets").or_else(|| workspace_todos.get("dispatch_targets")),
        workspace_id,
        &mut seen,
        &mut targets,
    );
    cloud_mcp_proxy_collect_todo_targets_by_workspace(
        workspace_todos
            .get("dispatchTargetsByWorkspace")
            .or_else(|| workspace_todos.get("dispatch_targets_by_workspace")),
        workspace_id,
        &mut seen,
        &mut targets,
    );
    targets
}

fn cloud_mcp_proxy_collect_todo_targets(
    collection: Option<&Value>,
    workspace_id: Option<&str>,
    seen: &mut std::collections::HashSet<String>,
    targets: &mut Vec<Value>,
) {
    let Some(collection) = collection else {
        return;
    };
    let items = collection
        .get("items")
        .and_then(Value::as_array)
        .or_else(|| collection.as_array());
    let Some(items) = items else {
        return;
    };
    for item in items {
        cloud_mcp_proxy_push_todo_target(item.clone(), workspace_id, seen, targets);
    }
}

fn cloud_mcp_proxy_collect_todo_targets_by_workspace(
    collection: Option<&Value>,
    workspace_id: Option<&str>,
    seen: &mut std::collections::HashSet<String>,
    targets: &mut Vec<Value>,
) {
    let Some(collection) = collection else {
        return;
    };
    let entries = collection
        .get("items")
        .and_then(Value::as_array)
        .or_else(|| collection.as_array());
    let Some(entries) = entries else {
        return;
    };
    for entry in entries {
        let observer_workspace_id = cloud_mcp_payload_text(
            entry,
            &[
                "workspace_id",
                "workspaceId",
                "observer_workspace_id",
                "observerWorkspaceId",
            ],
        )
        .unwrap_or_default();
        if workspace_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some_and(|workspace_id| observer_workspace_id != workspace_id)
        {
            continue;
        }
        if let Some(items) = entry.get("items").and_then(Value::as_array) {
            for item in items {
                let mut item = item.clone();
                if let Some(object) = item.as_object_mut() {
                    object
                        .entry("observer_workspace_id".to_string())
                        .or_insert_with(|| json!(observer_workspace_id));
                }
                cloud_mcp_proxy_push_todo_target(item, workspace_id, seen, targets);
            }
        }
    }
}

fn cloud_mcp_proxy_push_todo_target(
    mut item: Value,
    workspace_id: Option<&str>,
    seen: &mut std::collections::HashSet<String>,
    targets: &mut Vec<Value>,
) {
    let target_device_id = cloud_mcp_payload_text(
        &item,
        &["targetDeviceId", "target_device_id", "deviceId", "device_id"],
    )
    .unwrap_or_default();
    let target_workspace_id = cloud_mcp_payload_text(
        &item,
        &[
            "targetWorkspaceId",
            "target_workspace_id",
            "workspaceId",
            "workspace_id",
        ],
    )
    .unwrap_or_default();
    if target_device_id.trim().is_empty() || target_workspace_id.trim().is_empty() {
        return;
    }
    if workspace_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some_and(|workspace_id| {
            cloud_mcp_payload_text(
                &item,
                &[
                    "observer_workspace_id",
                    "observerWorkspaceId",
                    "workspace_id",
                    "workspaceId",
                ],
            )
            .as_deref()
                != Some(workspace_id)
        })
    {
        return;
    }
    let key = format!("{target_device_id}::{target_workspace_id}");
    if !seen.insert(key) {
        return;
    }
    if let Some(object) = item.as_object_mut() {
        object.insert("targetDeviceId".to_string(), json!(target_device_id));
        object.insert("targetWorkspaceId".to_string(), json!(target_workspace_id));
        object.insert("sameAccount".to_string(), json!(true));
        object.insert("same_account".to_string(), json!(true));
        object.insert("supportsListed".to_string(), json!(true));
        object.insert("supportsQueued".to_string(), json!(true));
    }
    targets.push(item);
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
    terminal_task_plan: Option<&Value>,
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
    if let Some(plan) = terminal_task_plan.filter(|value| !value.is_null()) {
        metadata.insert("terminal_task_plan".to_string(), plan.clone());
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
    if let Some(plan) = terminal_task_plan.filter(|value| !value.is_null()) {
        arguments.insert("terminal_task_plan".to_string(), plan.clone());
    }
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
            let parsed = serde_json::from_str::<Value>(&response)
                .unwrap_or_else(|_| json!({"raw_response": response}));
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

pub(crate) fn cloud_mcp_forward_terminal_task_plan_update(
    repo_path: Option<&str>,
    db_path: Option<&Path>,
    workspace_id: Option<&str>,
    agent_id: Option<&str>,
    session_id: Option<&str>,
    local_task_id: Option<&str>,
    worktree_id: Option<&str>,
    worktree_path: Option<&str>,
    update_reason: &str,
    terminal_task_plan: &Value,
) -> Result<Value, String> {
    let active_task_id = local_task_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "terminal plan sync requires an active task_id.".to_string())?;
    if terminal_task_plan.is_null() {
        return Err("terminal plan sync requires a compact terminal_task_plan.".to_string());
    }
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
    let event_kind = "terminal_task_plan_updated";
    let mut metadata = serde_json::Map::new();
    metadata.insert(
        "reported_by".to_string(),
        json!("coordination-kernel.terminal_task_plan"),
    );
    metadata.insert(
        "local_coordination_task_id".to_string(),
        json!(active_task_id),
    );
    metadata.insert("coordination_task_id".to_string(), json!(active_task_id));
    metadata.insert("terminal_task_plan".to_string(), terminal_task_plan.clone());
    if let Some(worktree_id) = worktree_id {
        metadata.insert("worktree_id".to_string(), json!(worktree_id));
    }
    if let Some(worktree_path) = worktree_path {
        metadata.insert("worktree_path".to_string(), json!(worktree_path));
    }

    let mut arguments = serde_json::Map::new();
    arguments.insert(
        "source".to_string(),
        json!("rust-diffforge-terminal-task-plan"),
    );
    arguments.insert("client_id".to_string(), json!(identity.client_id.clone()));
    arguments.insert("task_id".to_string(), json!(active_task_id));
    arguments.insert("run_id".to_string(), json!(active_task_id));
    arguments.insert("summary".to_string(), json!("Terminal task plan updated."));
    arguments.insert("update_reason".to_string(), json!(update_reason));
    arguments.insert("metadata".to_string(), Value::Object(metadata));
    arguments.insert("terminal_task_plan".to_string(), terminal_task_plan.clone());
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
        "cloud_mcp.terminal_task_plan.start",
        event_kind,
        json!({
            "activity": "terminal task plan sync",
            "baseUrl": base_url,
            "taskId": active_task_id,
            "reason": clean_terminal_telemetry_text(update_reason),
        }),
    );
    match cloud_mcp_proxy_post_json_endpoint(&base_url, "/v1/events", &request.to_string()) {
        Ok(response) => {
            identity.log(
                "cloud_mcp.terminal_task_plan.done",
                event_kind,
                json!({
                    "activity": "terminal task plan synced",
                    "baseUrl": base_url,
                }),
            );
            let parsed = serde_json::from_str::<Value>(&response)
                .unwrap_or_else(|_| json!({"raw_response": response}));
            Ok(parsed)
        }
        Err(error) => {
            identity.log(
                "cloud_mcp.terminal_task_plan.error",
                event_kind,
                json!({
                    "activity": "terminal task plan sync failed",
                    "baseUrl": base_url,
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );
            Err(error)
        }
    }
}

fn cloud_mcp_proxy_push_current_filetree_snapshot(
    _base_url: &str,
    repo_id: &str,
    workspace_root: &Path,
    _workspace_id: Option<&str>,
    _workspace_name: Option<&str>,
    _reason: &str,
) -> Result<Value, String> {
    Ok(json!({
        "ok": true,
        "skipped": true,
        "reason": "filetree_sync_disabled",
        "repoId": repo_id,
        "repoPath": workspace_path_display(workspace_root),
    }))
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
    terminal_task_plan: Option<&Value>,
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
    if let Some(plan) = terminal_task_plan.filter(|value| !value.is_null()) {
        metadata.insert("terminal_task_plan".to_string(), plan.clone());
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
    if let Some(plan) = terminal_task_plan.filter(|value| !value.is_null()) {
        arguments.insert("terminal_task_plan".to_string(), plan.clone());
    }
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
            if let Some(object) = parsed.as_object_mut() {
                object.insert("filetree_sync".to_string(), filetree_sync);
                object.insert("isolated_prune".to_string(), isolated_prune);
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

pub(crate) fn cloud_mcp_forward_agent_complete_task(
    repo_path: Option<&str>,
    db_path: Option<&Path>,
    workspace_id: Option<&str>,
    agent_id: Option<&str>,
    session_id: Option<&str>,
    task_id: Option<&str>,
    lane: Option<&str>,
    summary: Option<&str>,
    local_task_status: Option<&str>,
    session_mode: Option<&str>,
    file_authority: Option<&str>,
    enforcement_mode: Option<&str>,
    completion_mode: Option<&str>,
    complete_result: &Value,
    terminal_task_plan: Option<&Value>,
) -> Result<Value, String> {
    let active_task_id = task_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "complete_task Cloud sync requires the task_id returned by start_task.".to_string()
        })?;
    let repo_path_text = repo_path
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
    let task_status = local_task_status
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("done");
    let summary_text = summary.unwrap_or("Task completed through the local coordination kernel.");
    let session_mode_text = session_mode
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("activity");
    let file_authority_text = file_authority
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("none");
    let enforcement_mode_text = enforcement_mode
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("coordination_only");
    let completion_mode_text = completion_mode
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("complete_task");

    let mut metadata = serde_json::Map::new();
    metadata.insert(
        "reported_by".to_string(),
        json!("coordination-kernel.complete_task"),
    );
    metadata.insert("complete_result".to_string(), complete_result.clone());
    metadata.insert("cloud_task_id".to_string(), json!(active_task_id));
    metadata.insert("coordination_task_id".to_string(), json!(active_task_id));
    metadata.insert(
        "local_coordination_task_id".to_string(),
        json!(active_task_id),
    );
    metadata.insert("session_mode".to_string(), json!(session_mode_text));
    metadata.insert("sessionMode".to_string(), json!(session_mode_text));
    metadata.insert("file_authority".to_string(), json!(file_authority_text));
    metadata.insert("fileAuthority".to_string(), json!(file_authority_text));
    metadata.insert("enforcement_mode".to_string(), json!(enforcement_mode_text));
    metadata.insert("enforcementMode".to_string(), json!(enforcement_mode_text));
    metadata.insert("completion_mode".to_string(), json!(completion_mode_text));
    metadata.insert("completionMode".to_string(), json!(completion_mode_text));
    if let Some(plan) = terminal_task_plan.filter(|value| !value.is_null()) {
        metadata.insert("terminal_task_plan".to_string(), plan.clone());
    }

    let mut arguments = serde_json::Map::new();
    arguments.insert(
        "source".to_string(),
        json!("rust-diffforge-agent-complete-task"),
    );
    arguments.insert("client_id".to_string(), json!(identity.client_id.clone()));
    arguments.insert("status".to_string(), json!(task_status));
    arguments.insert("task_status".to_string(), json!(task_status));
    arguments.insert("summary".to_string(), json!(summary_text));
    arguments.insert("brief".to_string(), json!(summary_text));
    arguments.insert("metadata".to_string(), Value::Object(metadata));
    arguments.insert("task_id".to_string(), json!(active_task_id));
    arguments.insert("run_id".to_string(), json!(active_task_id));
    arguments.insert("session_mode".to_string(), json!(session_mode_text));
    arguments.insert("file_authority".to_string(), json!(file_authority_text));
    arguments.insert("enforcement_mode".to_string(), json!(enforcement_mode_text));
    arguments.insert("completion_mode".to_string(), json!(completion_mode_text));
    arguments.insert("record_spec_activity".to_string(), json!(false));
    if let Some(plan) = terminal_task_plan.filter(|value| !value.is_null()) {
        arguments.insert("terminal_task_plan".to_string(), plan.clone());
    }
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
        "event_kind": "task_completed",
        "payload": Value::Object(arguments),
        "ts_ms": cloud_mcp_now_ms(),
    });
    let should_sync_filetree = file_authority_text == "bounded_direct_edit"
        && matches!(task_status, "done" | "completed" | "merged");
    let filetree_sync = if should_sync_filetree {
        if let (Some(repo_id), Some(repo_path)) =
            (identity.repo_id.as_deref(), identity.repo_path.as_ref())
        {
            match cloud_mcp_proxy_push_current_filetree_snapshot(
                &base_url,
                repo_id,
                repo_path,
                identity.workspace_id.as_deref(),
                identity.workspace_name.as_deref(),
                "direct_edit_complete_filetree_resync",
            ) {
                Ok(response) => json!({"ok": true, "response": response}),
                Err(error) => json!({"ok": false, "error": error}),
            }
        } else {
            json!({"ok": false, "skipped": true, "reason": "missing_repo_for_filetree_resync"})
        }
    } else {
        json!({"ok": false, "skipped": true, "reason": "non_file_authority_completion"})
    };
    identity.log(
        "cloud_mcp.agent_complete_task.start",
        "complete_task",
        json!({
            "activity": "agent complete_task",
            "baseUrl": base_url,
            "filetreeSync": filetree_sync,
            "taskStatus": task_status,
            "taskId": active_task_id,
        }),
    );
    match cloud_mcp_proxy_post_json_endpoint(&base_url, "/v1/events", &request.to_string()) {
        Ok(response) => {
            identity.log(
                "cloud_mcp.agent_complete_task.done",
                "complete_task",
                json!({
                    "activity": "agent complete_task synced",
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
                "cloud_mcp.agent_complete_task.error",
                "complete_task",
                json!({
                    "activity": "agent complete_task sync failed",
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
        json!("Pruned rejected isolated work."),
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
    let cache_prune = json!({
        "ok": true,
        "skipped": true,
        "reason": "legacy_local_cache_removed",
    });
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
    session_mode: Option<&str>,
    file_authority: Option<&str>,
    enforcement_mode: Option<&str>,
    completion_mode: Option<&str>,
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
    if let Some(session_mode) = session_mode
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        metadata.insert("session_mode".to_string(), json!(session_mode));
        metadata.insert("sessionMode".to_string(), json!(session_mode));
    }
    if let Some(file_authority) = file_authority
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        metadata.insert("file_authority".to_string(), json!(file_authority));
        metadata.insert("fileAuthority".to_string(), json!(file_authority));
    }
    if let Some(enforcement_mode) = enforcement_mode
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        metadata.insert("enforcement_mode".to_string(), json!(enforcement_mode));
        metadata.insert("enforcementMode".to_string(), json!(enforcement_mode));
    }
    if let Some(completion_mode) = completion_mode
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        metadata.insert("completion_mode".to_string(), json!(completion_mode));
        metadata.insert("completionMode".to_string(), json!(completion_mode));
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
    if let Some(session_mode) = session_mode
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        arguments.insert("session_mode".to_string(), json!(session_mode));
    }
    if let Some(file_authority) = file_authority
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        arguments.insert("file_authority".to_string(), json!(file_authority));
    }
    if let Some(enforcement_mode) = enforcement_mode
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        arguments.insert("enforcement_mode".to_string(), json!(enforcement_mode));
    }
    if let Some(completion_mode) = completion_mode
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        arguments.insert("completion_mode".to_string(), json!(completion_mode));
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
    let task_history = cloud_mcp_proxy_post_json_endpoint(
        &base_url,
        "/v1/task/history",
        &context_request.to_string(),
    )
    .ok()
    .and_then(|response| serde_json::from_str::<Value>(&response).ok())
    .map(|value| value.get("data").cloned().unwrap_or(value))
    .unwrap_or_else(|| json!({"kind": "task_history", "version": 1, "tasks": []}));

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
        "context_pack": context_pack,
        "task_history": task_history,
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
           AND status IN ('parked', 'parked_cycle_prevented', 'waiting', 'blocked', 'resume_ready', 'resume_requested')
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
    let request_kind = if endpoint_path == "/mcp" {
        "mcp"
    } else {
        cloud_mcp_ws_kind_for_endpoint(endpoint_path).ok_or_else(|| {
            format!("Cloud MCP endpoint {endpoint_path} is not routed through the app websocket")
        })?
    };
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
    let device_profile = cloud_mcp_desktop_device_profile();
    let device_id = cloud_mcp_payload_text(&device_profile, &["device_id", "deviceId"])
        .unwrap_or_else(|| "desktop-primary".to_string());
    let (billing_scope_type, team_id) = cloud_mcp_process_account_scope();
    let (plan_name, device_limit) = cloud_mcp_process_account_plan();
    let target = cloud_mcp_proxy_resolve_blocking_target(base_url, "/v1/app/ws");
    let build_request = |target: &CloudMcpWsTarget| -> Result<
        tokio_tungstenite::tungstenite::http::Request<()>,
        String,
    > {
        let mut request = target
            .ws_url
            .as_str()
            .into_client_request()
            .map_err(|error| format!("Unable to create Cloud MCP websocket request: {error}"))?;
        request.headers_mut().insert(
            "x-diffforge-actor",
            HeaderValue::from_str(client_id.trim())
                .map_err(|error| format!("Invalid Cloud MCP actor header: {error}"))?,
        );
        request.headers_mut().insert(
            "user-agent",
            HeaderValue::from_static(CLOUD_MCP_DESKTOP_USER_AGENT),
        );
        request.headers_mut().insert(
            "x-diffforge-device-id",
            HeaderValue::from_str(&device_id)
                .map_err(|error| format!("Invalid Cloud MCP device id header: {error}"))?,
        );
        request.headers_mut().insert(
            "x-diffforge-billing-scope-type",
            HeaderValue::from_str(&billing_scope_type)
                .map_err(|error| format!("Invalid Cloud MCP billing scope header: {error}"))?,
        );
        request.headers_mut().insert(
            "x-diffforge-scope-type",
            HeaderValue::from_str(&billing_scope_type)
                .map_err(|error| format!("Invalid Cloud MCP scope header: {error}"))?,
        );
        request.headers_mut().insert(
            "x-diffforge-plan-name",
            HeaderValue::from_str(&plan_name)
                .map_err(|error| format!("Invalid Cloud MCP plan header: {error}"))?,
        );
        if let Some(device_limit) = device_limit {
            request.headers_mut().insert(
                "x-diffforge-device-limit",
                HeaderValue::from_str(&device_limit.to_string())
                    .map_err(|error| format!("Invalid Cloud MCP device limit header: {error}"))?,
            );
        }
        if billing_scope_type == "team" {
            if let Some(team_id) = team_id.as_deref() {
                request.headers_mut().insert(
                    "x-diffforge-team-id",
                    HeaderValue::from_str(team_id)
                        .map_err(|error| format!("Invalid Cloud MCP team id header: {error}"))?,
                );
            }
        }
        if let Some(workspace_id) = workspace_id.as_deref() {
            request.headers_mut().insert(
                "x-diffforge-workspace-id",
                HeaderValue::from_str(workspace_id.trim())
                    .map_err(|error| format!("Invalid Cloud MCP workspace id header: {error}"))?,
            );
        }
        if let Some(repo_id) = repo_id.as_deref() {
            request.headers_mut().insert(
                "x-diffforge-repo-id",
                HeaderValue::from_str(repo_id.trim())
                    .map_err(|error| format!("Invalid Cloud MCP repo id header: {error}"))?,
            );
        }
        if let Some(token) = cloud_mcp_process_authorization_bearer() {
            request.headers_mut().insert(
                "authorization",
                cloud_mcp_bearer_header(&token, "Cloud MCP auth token")?,
            );
        }
        if let Some(route_token) = target.route_token.as_deref() {
            request.headers_mut().insert(
                "x-diffforge-direct-route-token",
                HeaderValue::from_str(route_token)
                    .map_err(|error| format!("Invalid Cloud MCP route token header: {error}"))?,
            );
        }
        Ok(request)
    };

    let request = build_request(&target)?;
    let (mut websocket, _) = match tokio_tungstenite::tungstenite::connect(request) {
        Ok(result) => result,
        Err(error) if target.route_token.is_some() || target.transport == "local_docker_cloud" => {
            let fallback = cloud_mcp_fallback_ws_target(base_url, "/v1/app/ws");
            let fallback_request = build_request(&fallback)?;
            tokio_tungstenite::tungstenite::connect(fallback_request).map_err(|fallback_error| {
                format!(
                    "Unable to open Cloud MCP websocket via direct route ({error}); fallback via balancer also failed: {fallback_error}"
                )
            })?
        }
        Err(error) => return Err(format!("Unable to open Cloud MCP websocket: {error}")),
    };
    let ready_text = cloud_mcp_proxy_read_blocking_ws_text(&mut websocket)?;
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
        "billing_scope_type": billing_scope_type,
        "team_id": team_id,
        "plan_name": plan_name,
        "device_limit": device_limit,
        "request": body_value,
    });
    websocket
        .send(Message::Text(envelope.to_string().into()))
        .map_err(|error| format!("Cloud MCP websocket write failed: {error}"))?;

    let deadline = Instant::now() + Duration::from_secs(CLOUD_MCP_SYNC_TIMEOUT_SECS);
    loop {
        if Instant::now() >= deadline {
            return Err("Cloud MCP websocket request timed out.".to_string());
        }
        let response_text = cloud_mcp_proxy_read_blocking_ws_text(&mut websocket)?;
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

fn cloud_mcp_proxy_websocket_url(base_url: &str, endpoint_path: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let websocket_base = if let Some(rest) = trimmed.strip_prefix("http://") {
        format!("ws://{rest}")
    } else if let Some(rest) = trimmed.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if trimmed.starts_with("ws://") || trimmed.starts_with("wss://") {
        trimmed.to_string()
    } else {
        return Err(
            "Cloud MCP URL must start with http://, https://, ws://, or wss://".to_string(),
        );
    };

    Ok(format!(
        "{}/{}",
        websocket_base.trim_end_matches('/'),
        endpoint_path.trim_start_matches('/')
    ))
}

fn cloud_mcp_proxy_resolve_blocking_target(
    base_url: &str,
    endpoint_path: &str,
) -> CloudMcpWsTarget {
    let fallback = cloud_mcp_fallback_ws_target(base_url, endpoint_path);
    if let Some(target) = cloud_mcp_local_docker_ws_target(endpoint_path) {
        if cloud_mcp_ws_target_reachable_blocking(&target.ws_url) {
            return target;
        }
    }
    let Some(bearer) = cloud_mcp_process_authorization_bearer() else {
        return fallback;
    };
    let (billing_scope_type, team_id) = cloud_mcp_process_account_scope();
    let (plan_name, device_limit) = cloud_mcp_process_account_plan();
    let device_profile = cloud_mcp_desktop_device_profile();
    let device_id = cloud_mcp_payload_text(&device_profile, &["device_id", "deviceId"]);
    match cloud_mcp_fetch_direct_route_blocking(
        base_url,
        endpoint_path,
        &bearer,
        &billing_scope_type,
        team_id.as_deref(),
        &plan_name,
        device_limit,
        device_id.as_deref(),
    ) {
        Ok(Some(target)) => target,
        _ => fallback,
    }
}

fn cloud_mcp_fetch_direct_route_blocking(
    base_url: &str,
    endpoint_path: &str,
    bearer: &str,
    billing_scope_type: &str,
    team_id: Option<&str>,
    plan_name: &str,
    device_limit: Option<u64>,
    device_id: Option<&str>,
) -> Result<Option<CloudMcpWsTarget>, String> {
    let url = format!("{}/v1/route", base_url.trim_end_matches('/'));
    let body = json!({
        "requestedPath": endpoint_path,
        "billingScopeType": billing_scope_type,
        "scopeType": billing_scope_type,
        "teamId": team_id,
        "planName": plan_name,
        "deviceLimit": device_limit,
        "deviceId": device_id,
    });
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(CLOUD_MCP_AUTH_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("Unable to create Cloud MCP route client: {error}"))?
        .post(url)
        .header("Authorization", format!("Bearer {bearer}"))
        .header("x-diffforge-actor", CLOUD_MCP_RUST_CLIENT_ID)
        .header("x-diffforge-billing-scope-type", billing_scope_type)
        .header("x-diffforge-scope-type", billing_scope_type)
        .header("x-diffforge-plan-name", plan_name)
        .headers({
            let mut headers = reqwest::header::HeaderMap::new();
            if let Some(device_limit) = device_limit {
                if let Ok(value) = reqwest::header::HeaderValue::from_str(&device_limit.to_string()) {
                    headers.insert("x-diffforge-device-limit", value);
                }
            }
            if let Some(device_id) = device_id {
                if let Ok(value) = reqwest::header::HeaderValue::from_str(device_id) {
                    headers.insert("x-diffforge-device-id", value);
                }
            }
            if billing_scope_type == "team" {
                if let Some(team_id) = team_id {
                    if let Ok(value) = reqwest::header::HeaderValue::from_str(team_id) {
                        headers.insert("x-diffforge-team-id", value);
                    }
                }
            }
            headers
        })
        .json(&body)
        .send()
        .map_err(|error| format!("Cloud MCP route request failed: {error}"))?;
    let status = response.status();
    let parsed = response
        .json::<Value>()
        .map_err(|error| format!("Cloud MCP route response was invalid JSON: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Cloud MCP route request returned {}",
            status.as_u16()
        ));
    }
    Ok(cloud_mcp_direct_target_from_route(&parsed, endpoint_path))
}

fn cloud_mcp_proxy_read_blocking_ws_text<S>(
    websocket: &mut tokio_tungstenite::tungstenite::WebSocket<S>,
) -> Result<String, String>
where
    S: Read + Write,
{
    loop {
        match websocket
            .read()
            .map_err(|error| format!("Cloud MCP websocket read failed: {error}"))?
        {
            Message::Text(text) => return Ok(text.to_string()),
            Message::Binary(bytes) => {
                return String::from_utf8(bytes.to_vec()).map_err(|error| {
                    format!("Cloud MCP websocket returned invalid UTF-8: {error}")
                });
            }
            Message::Ping(payload) => websocket
                .send(Message::Pong(payload))
                .map_err(|error| format!("Cloud MCP websocket pong failed: {error}"))?,
            Message::Close(_) => return Err("Cloud MCP websocket closed.".to_string()),
            _ => {}
        }
    }
}

fn cloud_mcp_proxy_payload_text(value: &Value, path: &[&str]) -> Option<String> {
    let mut cursor = value;
    for segment in path {
        cursor = cursor.get(*segment)?;
    }
    cursor.as_str().map(str::to_string)
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

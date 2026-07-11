const APP_CONTROL_MCP_REQUEST_EVENT: &str = "forge-app-control-mcp-request";
const APP_CONTROL_MCP_SERVER_NAME: &str = "diffforge-app-control";
const APP_CONTROL_MCP_TIMEOUT_MS: u64 = 20_000;
const APP_CONTROL_MCP_SCRIPT_RUN_TIMEOUT_MS: u64 = 60 * 60 * 1000;
const APP_CONTROL_MCP_BRIDGE_READ_TIMEOUT_MS: u64 = 15_000;
const APP_CONTROL_MCP_BRIDGE_MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;
const DIFFFORGE_APP_BRIDGE_ENDPOINT_ENV: &str = "DIFFFORGE_APP_BRIDGE_ENDPOINT";
const DIFFFORGE_APP_BRIDGE_TOKEN_ENV: &str = "DIFFFORGE_APP_BRIDGE_TOKEN";
const VIDEO_MCP_NO_WORKSPACE_MESSAGE: &str =
    "No video workspace here — open a Video Editor pane (media/ folder) first.";

#[derive(Clone, Serialize, Deserialize)]
struct AppControlMcpEndpoint {
    host: String,
    port: u16,
    token: String,
    url: String,
}

#[derive(Clone)]
struct AppControlMcpState {
    endpoint: Arc<StdMutex<Option<AppControlMcpEndpoint>>>,
    pending: Arc<StdMutex<HashMap<String, oneshot::Sender<Value>>>>,
    next_request_id: Arc<AtomicU64>,
}

impl AppControlMcpState {
    fn new() -> Self {
        Self {
            endpoint: Arc::new(StdMutex::new(None)),
            pending: Arc::new(StdMutex::new(HashMap::new())),
            next_request_id: Arc::new(AtomicU64::new(1)),
        }
    }
}

#[derive(Deserialize)]
struct AppControlMcpBridgeRequest {
    token: String,
    tool: String,
    input: Value,
}

#[tauri::command(rename_all = "snake_case")]
async fn app_control_mcp_reply(
    state: State<'_, AppControlMcpState>,
    request_id: String,
    response: Value,
) -> Result<(), String> {
    let sender = state
        .pending
        .lock()
        .map_err(|_| "Unable to lock app-control MCP pending replies.".to_string())?
        .remove(&request_id);
    let Some(sender) = sender else {
        return Err("App-control MCP request is no longer pending.".to_string());
    };
    sender
        .send(response)
        .map_err(|_| "Unable to deliver app-control MCP reply.".to_string())
}

async fn app_control_mcp_endpoint_for_state(
    app: AppHandle,
    state: &AppControlMcpState,
) -> Result<AppControlMcpEndpoint, String> {
    if let Ok(endpoint) = state.endpoint.lock() {
        if let Some(endpoint) = endpoint.clone() {
            publish_app_control_mcp_bridge_env(&endpoint);
            return Ok(endpoint);
        }
    } else {
        return Err("Unable to read app-control MCP endpoint.".to_string());
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| format!("Unable to start app-control MCP bridge: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Unable to read app-control MCP bridge address: {error}"))?
        .port();
    let endpoint = AppControlMcpEndpoint {
        host: "127.0.0.1".to_string(),
        port,
        token: uuid::Uuid::new_v4().to_string(),
        url: format!("tcp://127.0.0.1:{port}"),
    };

    {
        let mut existing = state
            .endpoint
            .lock()
            .map_err(|_| "Unable to save app-control MCP endpoint.".to_string())?;
        if let Some(endpoint) = existing.clone() {
            return Ok(endpoint);
        }
        *existing = Some(endpoint.clone());
    }

    spawn_app_control_mcp_bridge_listener(app, state, listener, endpoint.token.clone());
    publish_app_control_mcp_bridge_env(&endpoint);
    Ok(endpoint)
}

fn app_control_mcp_bridge_endpoint_text(endpoint: &AppControlMcpEndpoint) -> String {
    format!("{}:{}", endpoint.host, endpoint.port)
}

fn publish_app_control_mcp_bridge_env(endpoint: &AppControlMcpEndpoint) {
    env::set_var(
        DIFFFORGE_APP_BRIDGE_ENDPOINT_ENV,
        app_control_mcp_bridge_endpoint_text(endpoint),
    );
    env::set_var(DIFFFORGE_APP_BRIDGE_TOKEN_ENV, &endpoint.token);
}

fn app_control_mcp_command() -> String {
    env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "rust-diffforge".to_string())
}

fn app_control_mcp_args_for_endpoint(endpoint: &AppControlMcpEndpoint) -> Vec<String> {
    vec![
        "--app-control-mcp".to_string(),
        "--endpoint".to_string(),
        format!("{}:{}", endpoint.host, endpoint.port),
        "--token".to_string(),
        endpoint.token.clone(),
    ]
}

fn spawn_app_control_mcp_bridge_listener(
    app: AppHandle,
    state: &AppControlMcpState,
    listener: TcpListener,
    expected_token: String,
) {
    let pending = Arc::clone(&state.pending);
    let counter = Arc::clone(&state.next_request_id);
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((stream, _addr)) = listener.accept().await else {
                break;
            };
            let app = app.clone();
            let pending = Arc::clone(&pending);
            let expected_token = expected_token.clone();
            let counter = Arc::clone(&counter);
            tauri::async_runtime::spawn(async move {
                let _ = handle_app_control_mcp_bridge_connection(
                    app,
                    pending,
                    counter,
                    expected_token,
                    stream,
                )
                .await;
            });
        }
    });
}

async fn handle_app_control_mcp_bridge_connection(
    app: AppHandle,
    pending: Arc<StdMutex<HashMap<String, oneshot::Sender<Value>>>>,
    counter: Arc<AtomicU64>,
    expected_token: String,
    mut stream: TcpStream,
) -> Result<(), String> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let read = match timeout(
            Duration::from_millis(APP_CONTROL_MCP_BRIDGE_READ_TIMEOUT_MS),
            stream.read(&mut chunk),
        )
        .await
        {
            Ok(Ok(read)) => read,
            Ok(Err(error)) => {
                return Err(format!(
                    "Unable to read app-control MCP bridge request: {error}"
                ));
            }
            Err(_) => return Ok(()),
        };
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..read]);
        if bytes.len() > APP_CONTROL_MCP_BRIDGE_MAX_REQUEST_BYTES {
            return Ok(());
        }
        if bytes.contains(&b'\n') {
            break;
        }
    }
    let line = String::from_utf8_lossy(&bytes);
    let request: AppControlMcpBridgeRequest = serde_json::from_str(line.trim())
        .map_err(|error| format!("Invalid app-control MCP bridge request: {error}"))?;
    if request.token != expected_token {
        let response = json!({
            "ok": false,
            "error": {
                "code": "unauthorized",
                "message": "Invalid app-control MCP bridge token."
            }
        });
        write_app_control_mcp_bridge_response(&mut stream, response).await?;
        return Ok(());
    }

    if request.tool == "run_local_script" {
        let mut input = request.input;
        if let Some(object) = input.as_object_mut() {
            object.insert("cause".to_string(), json!("orchestrator_terminal"));
            object.insert("source_kind".to_string(), json!("app_control_mcp"));
        }
        let response = match local_scripts_enqueue_run(app.clone(), input).await {
            Ok(result) => {
                json!({
                "ok": true,
                "data": {
                    "accepted": true,
                    "message": "Local script queued in Diff Forge. Check Scripts logs or history for output.",
                    "result": result,
                },
                })
            }
            Err(error) => json!({
                "ok": false,
                "error": {
                    "code": "local_script_run_failed",
                    "message": error,
                },
            }),
        };
        write_app_control_mcp_bridge_response(&mut stream, response).await?;
        return Ok(());
    }

    if request.tool == "list_local_scripts" || request.tool == "list_scripts" {
        let include_content = request
            .input
            .get("include_content")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let response =
            match local_scripts_list(Some(json!({ "include_content": include_content }))).await {
                Ok(result) => {
                    let scripts = result.get("scripts").cloned().unwrap_or_else(|| json!([]));
                    let count = scripts.as_array().map(|scripts| scripts.len()).unwrap_or(0);
                    let root = result.get("root").cloned().unwrap_or_else(|| json!(""));
                    json!({
                        "ok": true,
                        "data": {
                            "count": count,
                            "inventory": result,
                            "root": root,
                            "scripts": scripts,
                        },
                    })
                }
                Err(error) => json!({
                    "ok": false,
                    "error": {
                        "code": "local_scripts_list_failed",
                        "message": error,
                    },
                }),
            };
        write_app_control_mcp_bridge_response(&mut stream, response).await?;
        return Ok(());
    }

    if request.tool == "get_script" {
        let response = match local_scripts_read(request.input).await {
            Ok(result) => {
                let script = result
                    .get("script")
                    .cloned()
                    .unwrap_or_else(|| result.clone());
                json!({
                    "ok": true,
                    "data": {
                        "result": result,
                        "script": script,
                    },
                })
            }
            Err(error) => json!({
                "ok": false,
                "error": {
                    "code": "local_script_not_found",
                    "message": error,
                },
            }),
        };
        write_app_control_mcp_bridge_response(&mut stream, response).await?;
        return Ok(());
    }

    if matches!(
        request.tool.as_str(),
        "video_context"
            | "video_edit"
            | "video_transcribe"
            | "video_look"
            | "video_media"
            | "video_generate"
            | "video_export"
    ) {
        let response = handle_app_control_mcp_video_tool(
            app.clone(),
            Arc::clone(&pending),
            Arc::clone(&counter),
            request.tool.as_str(),
            request.input,
        )
        .await;
        write_app_control_mcp_bridge_response(&mut stream, response).await?;
        return Ok(());
    }

    let request_id = format!(
        "app-control-mcp-{}",
        counter.fetch_add(1, Ordering::Relaxed)
    );
    let (sender, receiver) = oneshot::channel();
    pending
        .lock()
        .map_err(|_| "Unable to lock app-control MCP pending map.".to_string())?
        .insert(request_id.clone(), sender);

    let emit_result = app.emit(
        APP_CONTROL_MCP_REQUEST_EVENT,
        json!({
            "request_id": request_id,
            "tool": request.tool,
            "input": request.input,
        }),
    );
    if let Err(error) = emit_result {
        let _ = pending
            .lock()
            .map_err(|_| "Unable to lock app-control MCP pending map.".to_string())?
            .remove(&request_id);
        let response = json!({
            "ok": false,
            "error": {
                "code": "emit_failed",
                "message": format!("Unable to send app-control MCP request to the UI: {error}")
            }
        });
        write_app_control_mcp_bridge_response(&mut stream, response).await?;
        return Ok(());
    }

    let ui_timeout_ms = app_control_mcp_tool_timeout_ms(&request.tool);
    let response = match timeout(Duration::from_millis(ui_timeout_ms), receiver).await {
        Ok(Ok(value)) => value,
        Ok(Err(_)) => json!({
            "ok": false,
            "error": {
                "code": "reply_cancelled",
                "message": "The app-control MCP reply was cancelled."
            }
        }),
        Err(_) => {
            let _ = pending
                .lock()
                .map_err(|_| "Unable to lock app-control MCP pending map.".to_string())?
                .remove(&request_id);
            json!({
                "ok": false,
                "error": {
                    "code": "timeout",
                    "message": "Timed out waiting for the app UI to handle the MCP request."
                }
            })
        }
    };
    write_app_control_mcp_bridge_response(&mut stream, response).await
}

async fn app_control_mcp_ui_tool_request(
    app: AppHandle,
    pending: Arc<StdMutex<HashMap<String, oneshot::Sender<Value>>>>,
    counter: Arc<AtomicU64>,
    tool: &str,
    input: Value,
) -> Result<Value, String> {
    let request_id = format!(
        "app-control-mcp-{}",
        counter.fetch_add(1, Ordering::Relaxed)
    );
    let (sender, receiver) = oneshot::channel();
    pending
        .lock()
        .map_err(|_| "Unable to lock app-control MCP pending map.".to_string())?
        .insert(request_id.clone(), sender);

    let emit_result = app.emit(
        APP_CONTROL_MCP_REQUEST_EVENT,
        json!({
            "request_id": request_id,
            "tool": tool,
            "input": input,
        }),
    );
    if let Err(error) = emit_result {
        let _ = pending
            .lock()
            .map_err(|_| "Unable to lock app-control MCP pending map.".to_string())?
            .remove(&request_id);
        return Err(format!(
            "Unable to send app-control MCP request to the UI: {error}"
        ));
    }

    let ui_timeout_ms = app_control_mcp_tool_timeout_ms(tool);
    match timeout(Duration::from_millis(ui_timeout_ms), receiver).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => Err("The app-control MCP reply was cancelled.".to_string()),
        Err(_) => {
            let _ = pending
                .lock()
                .map_err(|_| "Unable to lock app-control MCP pending map.".to_string())?
                .remove(&request_id);
            Err("Timed out waiting for the app UI to handle the MCP request.".to_string())
        }
    }
}

fn app_control_mcp_input_text(input: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| input.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn app_control_mcp_state_workspace_root(state: &Value, key: &str) -> Option<String> {
    state
        .get(key)
        .and_then(|workspace| workspace.get("root_directory"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn app_control_mcp_repo_path_from_state_response(response: &Value) -> Option<String> {
    let state = response.get("data").unwrap_or(response);
    app_control_mcp_state_workspace_root(state, "selected_workspace")
        .or_else(|| app_control_mcp_state_workspace_root(state, "activated_workspace"))
        .or_else(|| {
            state
                .get("workspaces")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|workspace| {
                    workspace.get("selected").and_then(Value::as_bool) == Some(true)
                        || workspace.get("active").and_then(Value::as_bool) == Some(true)
                })
                .find_map(|workspace| {
                    workspace
                        .get("root_directory")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned)
                })
        })
}

async fn app_control_mcp_resolve_video_repo_path(
    app: AppHandle,
    pending: Arc<StdMutex<HashMap<String, oneshot::Sender<Value>>>>,
    counter: Arc<AtomicU64>,
    input: &Value,
) -> Result<String, String> {
    if let Some(repo_path) = app_control_mcp_input_text(input, &["repo_path"]) {
        return Ok(repo_path);
    }

    let state =
        app_control_mcp_ui_tool_request(app, pending, counter, "get_state", json!({})).await?;
    app_control_mcp_repo_path_from_state_response(&state).ok_or_else(|| {
        "No workspace repo path is active. Pass repo_path or select a workspace.".to_string()
    })
}

fn app_control_mcp_json_error(code: &str, message: impl Into<String>) -> Value {
    json!({
        "ok": false,
        "error": {
            "code": code,
            "message": message.into(),
        },
    })
}

fn app_control_mcp_present(input: &Value, keys: &[&str]) -> bool {
    keys.iter()
        .any(|key| input.get(*key).is_some_and(|value| !value.is_null()))
}

fn app_control_mcp_video_look_times(input: &Value) -> Result<Vec<u64>, String> {
    let has_at = app_control_mcp_present(input, &["at_ms"]);
    let has_times = app_control_mcp_present(input, &["times_ms"]);
    let has_range = app_control_mcp_present(input, &["range"]);
    if [has_at, has_times, has_range]
        .into_iter()
        .filter(|present| *present)
        .count()
        != 1
    {
        return Err("Pass exactly one of at_ms, times_ms, or range.".to_string());
    }
    if has_at {
        let at_ms = input
            .get("at_ms")
            .and_then(video_mcp_value_u64)
            .ok_or_else(|| "at_ms must be a non-negative number.".to_string())?;
        return Ok(vec![at_ms]);
    }
    if has_times {
        let values = input
            .get("times_ms")
            .and_then(Value::as_array)
            .ok_or_else(|| "times_ms must be an array.".to_string())?;
        let mut times = Vec::new();
        for value in values {
            times.push(
                video_mcp_value_u64(value)
                    .ok_or_else(|| "times_ms entries must be non-negative numbers.".to_string())?,
            );
        }
        if times.is_empty() {
            return Err("times_ms must include at least one timestamp.".to_string());
        }
        return Ok(times);
    }
    let range = input
        .get("range")
        .and_then(Value::as_object)
        .ok_or_else(|| "range must be an object.".to_string())?;
    let start_ms = range
        .get("start_ms")
        .and_then(video_mcp_value_u64)
        .ok_or_else(|| "range.start_ms is required.".to_string())?;
    let end_ms = range
        .get("end_ms")
        .and_then(video_mcp_value_u64)
        .ok_or_else(|| "range.end_ms is required.".to_string())?;
    let frames = range
        .get("frames")
        .and_then(video_mcp_value_u64)
        .unwrap_or(2)
        .clamp(2, VIDEO_MCP_LOOK_MAX_FRAMES as u64) as usize;
    let from = start_ms.min(end_ms);
    let to = start_ms.max(end_ms);
    if frames == 1 || from == to {
        return Ok(vec![from]);
    }
    Ok((0..frames)
        .map(|index| {
            let ratio = index as f64 / (frames.saturating_sub(1)) as f64;
            from.saturating_add(((to - from) as f64 * ratio).round() as u64)
        })
        .collect())
}

// Compact per-tool detail for the pane's Agent activity feed. Keep tiny —
// the feed renders icons, not payloads.
fn app_control_mcp_video_activity_detail(tool: &str, input: &Value) -> Value {
    match tool {
        "video_context" => json!({ "include": input.get("include").cloned().unwrap_or(Value::Null) }),
        "video_edit" => {
            let ops = input.get("ops").and_then(Value::as_array);
            let kinds: Vec<String> = ops
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|op| op.get("op").and_then(Value::as_str))
                        .map(ToOwned::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            json!({ "ops": kinds.len(), "op_kinds": kinds })
        }
        "video_look" => json!({
            "at_ms": input.get("at_ms").cloned().unwrap_or(Value::Null),
            "times_ms": input.get("times_ms").cloned().unwrap_or(Value::Null),
            "range": input.get("range").cloned().unwrap_or(Value::Null),
        }),
        "video_media" => json!({
            "action": input.get("action").cloned().unwrap_or(Value::Null),
            "query": input.get("query").cloned().unwrap_or(Value::Null),
        }),
        "video_generate" => json!({
            "action": input.get("action").cloned().unwrap_or(Value::Null),
            "model": input.get("model").cloned().unwrap_or(Value::Null),
        }),
        "video_export" => json!({ "action": input.get("action").cloned().unwrap_or(Value::Null) }),
        "video_transcribe" => json!({
            "paths": input.get("paths").cloned().unwrap_or(Value::Null),
            "scope": input.get("scope").cloned().unwrap_or(Value::Null),
        }),
        _ => Value::Null,
    }
}

// Result fragments worth surfacing in the feed (job ids, edit summaries,
// transcript statuses) — never full payloads (look frames are megabytes).
fn app_control_mcp_video_activity_result(tool: &str, result: &Value) -> Value {
    let data = result.get("data");
    match (tool, data) {
        ("video_edit", Some(data)) => json!({
            "summary": data.get("summary").cloned().unwrap_or(Value::Null),
            "changed_clip_ids": data.get("changed_clip_ids").cloned().unwrap_or(Value::Null),
        }),
        ("video_generate", Some(data)) => json!({
            "job_id": data.get("job_id").cloned().unwrap_or(Value::Null),
        }),
        ("video_export", Some(data)) => json!({
            "job_id": data.get("job_id").cloned().unwrap_or(Value::Null),
            "output_path": data.get("output_path").cloned().unwrap_or(Value::Null),
        }),
        ("video_transcribe", Some(data)) => json!({
            "results": data
                .get("results")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .map(|item| {
                            json!({
                                "asset_path": item.get("asset_path").cloned().unwrap_or(Value::Null),
                                "status": item.get("status").cloned().unwrap_or(Value::Null),
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
        }),
        ("video_media", Some(data)) => json!({
            "moments": data.get("moments").and_then(Value::as_array).map(|m| m.len()),
            "assets": data.get("assets").and_then(Value::as_array).map(|a| a.len()),
        }),
        ("video_look", Some(data)) => json!({
            "frames": data.get("frames").and_then(Value::as_array).map(|f| f.len()),
        }),
        _ => Value::Null,
    }
}

async fn handle_app_control_mcp_video_tool(
    app: AppHandle,
    pending: Arc<StdMutex<HashMap<String, oneshot::Sender<Value>>>>,
    counter: Arc<AtomicU64>,
    tool: &str,
    input: Value,
) -> Value {
    let repo_path = match app_control_mcp_resolve_video_repo_path(
        app.clone(),
        pending,
        counter,
        &input,
    )
    .await
    {
        Ok(repo_path) => repo_path,
        Err(error) => return app_control_mcp_json_error("repo_path_required", error),
    };
    if !video_workspace_has_media(&repo_path) {
        return app_control_mcp_json_error("no_video_workspace", VIDEO_MCP_NO_WORKSPACE_MESSAGE);
    }

    // Every agent tool call is mirrored to the pane's Agent activity feed:
    // one start event, one done/error event, matched by id.
    let activity_id = format!("mcp-{}", uuid::Uuid::new_v4().simple());
    let start_detail = app_control_mcp_video_activity_detail(tool, &input);
    let _ = app.emit(
        "video-agent-activity",
        json!({
            "id": activity_id,
            "tool": tool,
            "repo_path": repo_path,
            "phase": "start",
            "detail": start_detail,
        }),
    );

    let result = handle_app_control_mcp_video_tool_inner(app.clone(), repo_path.clone(), tool, input).await;

    let ok = result.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let error_message = result
        .get("error")
        .and_then(|error| error.get("message"))
        .cloned()
        .unwrap_or(Value::Null);
    let _ = app.emit(
        "video-agent-activity",
        json!({
            "id": activity_id,
            "tool": tool,
            "repo_path": repo_path,
            "phase": if ok { "done" } else { "error" },
            "error": error_message,
            "result": app_control_mcp_video_activity_result(tool, &result),
        }),
    );
    result
}

async fn handle_app_control_mcp_video_tool_inner(
    app: AppHandle,
    repo_path: String,
    tool: &str,
    input: Value,
) -> Value {
    match tool {
        "video_context" => {
            let include = input
                .get("include")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned)
                        .collect::<Vec<_>>()
                })
                .filter(|items| !items.is_empty())
                .unwrap_or_else(|| {
                    ["timeline", "selection", "transcripts", "jobs"]
                        .into_iter()
                        .map(str::to_string)
                        .collect()
                });
            match video_mcp_context(app, repo_path, include).await {
                Ok(data) => json!({"ok": true, "data": data}),
                Err(error) => app_control_mcp_json_error("video_context_failed", error),
            }
        }
        "video_edit" => {
            let project_path = app_control_mcp_input_text(&input, &["project_path"]);
            let ops = input.get("ops").cloned().unwrap_or_else(|| json!([]));
            let include_pipe = input
                .get("include_pipe")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            match video_mcp_edit(app, repo_path, project_path, ops, include_pipe).await {
                Ok(data) => json!({"ok": true, "data": data}),
                Err(error) => app_control_mcp_json_error("video_edit_failed", error),
            }
        }
        "video_look" => {
            let project_path = app_control_mcp_input_text(&input, &["project_path"]);
            let times_ms = match app_control_mcp_video_look_times(&input) {
                Ok(times_ms) => times_ms,
                Err(error) => return app_control_mcp_json_error("video_look_bad_input", error),
            };
            match video_mcp_look(app, repo_path, project_path, times_ms).await {
                Ok(data) => json!({"ok": true, "data": data}),
                Err(error) => app_control_mcp_json_error("video_look_failed", error),
            }
        }
        "video_media" => match video_mcp_media(app, repo_path, input).await {
            Ok(data) => json!({"ok": true, "data": data}),
            Err(error) => app_control_mcp_json_error("video_media_failed", error),
        },
        "video_generate" => match video_mcp_generate(app, repo_path, input).await {
            Ok(data) => json!({"ok": true, "data": data}),
            Err(error) => app_control_mcp_json_error("video_generate_failed", error),
        },
        "video_export" => match video_mcp_export(app, repo_path, input).await {
            Ok(data) => json!({"ok": true, "data": data}),
            Err(error) => app_control_mcp_json_error("video_export_failed", error),
        },
        "video_transcribe" => {
            let paths = input
                .get("paths")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let scope_selection = input
                .get("scope")
                .and_then(Value::as_str)
                .map(str::trim)
                .is_some_and(|scope| scope.eq_ignore_ascii_case("selection"));
            let wait = input.get("wait").and_then(Value::as_bool).unwrap_or(true);
            let from_ms = input.get("from_ms").and_then(Value::as_u64);
            let to_ms = input.get("to_ms").and_then(Value::as_u64);
            match video_mcp_transcribe(app, repo_path, paths, scope_selection, wait, from_ms, to_ms)
                .await
            {
                Ok(data) => json!({"ok": true, "data": data}),
                Err(error) => app_control_mcp_json_error("video_transcribe_failed", error),
            }
        }
        _ => app_control_mcp_json_error("unknown_tool", format!("Unknown video tool: {tool}")),
    }
}

async fn write_app_control_mcp_bridge_response(
    stream: &mut TcpStream,
    response: Value,
) -> Result<(), String> {
    let mut text = response.to_string();
    text.push('\n');
    stream
        .write_all(text.as_bytes())
        .await
        .map_err(|error| format!("Unable to write app-control MCP bridge response: {error}"))
}

#[derive(Clone, Copy)]
enum AppControlMcpTransport {
    JsonLine,
    ContentLength,
}

pub fn run_app_control_mcp_stdio_server(args: Vec<String>) -> Result<(), String> {
    let context = AppControlMcpContext::from_args(args)?;
    let stdin = std::io::stdin();
    let mut reader = std::io::BufReader::new(stdin.lock());
    let mut stdout = std::io::stdout();

    while let Some((message, transport)) = read_app_control_mcp_message(&mut reader)? {
        let response = handle_app_control_mcp_json_rpc(&context, message);
        if !response.is_null() {
            write_app_control_mcp_message(&mut stdout, transport, &response)?;
        }
    }

    Ok(())
}

struct AppControlMcpContext {
    endpoint: String,
    token: String,
}

impl AppControlMcpContext {
    fn from_args(args: Vec<String>) -> Result<Self, String> {
        let mut endpoint = String::new();
        let mut token = String::new();
        let mut index = 0usize;
        while index < args.len() {
            match args[index].as_str() {
                "--endpoint" => {
                    endpoint = args.get(index + 1).cloned().unwrap_or_default();
                    index += 2;
                }
                "--token" => {
                    token = args.get(index + 1).cloned().unwrap_or_default();
                    index += 2;
                }
                _ => {
                    index += 1;
                }
            }
        }
        if endpoint.trim().is_empty() {
            return Err("--endpoint is required for app-control MCP.".to_string());
        }
        if token.trim().is_empty() {
            return Err("--token is required for app-control MCP.".to_string());
        }
        Ok(Self { endpoint, token })
    }
}

fn read_app_control_mcp_message<R: std::io::BufRead>(
    reader: &mut R,
) -> Result<Option<(Value, AppControlMcpTransport)>, String> {
    let mut first = String::new();
    let read = reader
        .read_line(&mut first)
        .map_err(|error| format!("Unable to read MCP request: {error}"))?;
    if read == 0 {
        return Ok(None);
    }
    let first_trimmed = first.trim_end_matches(['\r', '\n']);
    if first_trimmed
        .to_ascii_lowercase()
        .starts_with("content-length:")
    {
        let length_text = first_trimmed
            .split_once(':')
            .map(|(_, value)| value.trim())
            .unwrap_or("");
        let length = length_text
            .parse::<usize>()
            .map_err(|_| "Invalid MCP Content-Length header.".to_string())?;
        loop {
            let mut header = String::new();
            reader
                .read_line(&mut header)
                .map_err(|error| format!("Unable to read MCP header: {error}"))?;
            if header.trim().is_empty() {
                break;
            }
        }
        let mut body = vec![0u8; length];
        reader
            .read_exact(&mut body)
            .map_err(|error| format!("Unable to read MCP body: {error}"))?;
        let value = serde_json::from_slice::<Value>(&body)
            .map_err(|error| format!("Invalid MCP JSON body: {error}"))?;
        return Ok(Some((value, AppControlMcpTransport::ContentLength)));
    }

    let value = serde_json::from_str::<Value>(first_trimmed)
        .map_err(|error| format!("Invalid MCP JSON line: {error}"))?;
    Ok(Some((value, AppControlMcpTransport::JsonLine)))
}

fn write_app_control_mcp_message<W: std::io::Write>(
    writer: &mut W,
    transport: AppControlMcpTransport,
    response: &Value,
) -> Result<(), String> {
    let text = response.to_string();
    match transport {
        AppControlMcpTransport::JsonLine => {
            writer
                .write_all(text.as_bytes())
                .and_then(|_| writer.write_all(b"\n"))
                .map_err(|error| format!("Unable to write MCP response: {error}"))?;
        }
        AppControlMcpTransport::ContentLength => {
            let header = format!("Content-Length: {}\r\n\r\n", text.as_bytes().len());
            writer
                .write_all(header.as_bytes())
                .and_then(|_| writer.write_all(text.as_bytes()))
                .map_err(|error| format!("Unable to write MCP response: {error}"))?;
        }
    }
    writer
        .flush()
        .map_err(|error| format!("Unable to flush MCP response: {error}"))
}

fn handle_app_control_mcp_json_rpc(context: &AppControlMcpContext, request: Value) -> Value {
    let id_value = request.get("id").cloned();
    let id = id_value.clone().unwrap_or(Value::Null);
    let method = request["method"].as_str().unwrap_or("");
    if id_value.is_none() && method.starts_with("notifications/") {
        return Value::Null;
    }
    match method {
        "initialize" => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": "2024-11-05",
                "serverInfo": {"name": APP_CONTROL_MCP_SERVER_NAME, "version": "0.1.0"},
                "capabilities": {"tools": {"listChanged": true}}
            }
        }),
        "tools/list" => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {"tools": app_control_mcp_tools()}
        }),
        "tools/call" => {
            let params = &request["params"];
            let name = params["name"].as_str().unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let result = app_control_mcp_call_tool(context, name, args);
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [{"type": "text", "text": result.to_string()}],
                    "isError": result["ok"].as_bool() == Some(false)
                }
            })
        }
        "notifications/initialized" | "initialized" => Value::Null,
        "ping" => json!({"jsonrpc": "2.0", "id": id, "result": {}}),
        _ => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {"code": -32601, "message": "Method not found"}
        }),
    }
}

fn app_control_mcp_tools() -> Vec<Value> {
    vec![
        json!({
            "name": "get_state",
            "description": "Return the current Diff Forge app view, selected workspace, active workspace, compact account_docs and local_scripts inventories, available navigation targets, and a compact visible-context summary. Call this before app-control actions when the target tab, workspace, document, script, or selection is unclear.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false}
        }),
        json!({
            "name": "get_visible_context",
            "description": "Return the currently visible Diff Forge context, including selected Tools document or local script metadata, highlighted range, and compact state inventories when available. Use this first for prompts like explain this selected skill, create a draft here, modify/delete this selection, run the selected local script, or what is selected. For background inventory questions that should not disturb the user's view, use list_docs/list_scripts instead. Use local_path only for direct file edits when appropriate. For unsaved Tools document drafts, use update_selected_document; for unsaved local scripts, use update_selected_script.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "include_content": {"type": "boolean", "description": "When true, include any small in-memory draft preview the UI can safely expose."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "selected_context",
            "description": "Alias for get_visible_context with selection snapshots enabled. Return the selected live document/script context from global Tools or a workspace Docs panel, including highlighted range metadata when available.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "include_content": {"type": "boolean", "description": "When true, include any small in-memory draft preview the UI can safely expose."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "list_docs",
            "description": "Return the account Tools documents inventory in the background without changing the visible tab, active view, selected document, or highlighted range. Use this for questions like how many docs exist, list docs, find a document by name/path, or compare docs while the user keeps working elsewhere.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "refresh": {"type": "boolean", "description": "When true, force a Cloud/cache refresh before returning cached inventory."},
                    "include_content": {"type": "boolean", "description": "When true, include only already cached inline document content. This does not hydrate every document."},
                    "include_drafts": {"type": "boolean", "description": "When true or omitted, include the current unsaved document draft as a draft item when present."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "get_doc",
            "description": "Return one account Tools document by document_key, doc_id/document_id, path_key, file_path, title, or name without changing the visible tab, active view, selected document, or highlighted range. Use include_content=true to hydrate and return content for that one document. Do not directly edit local_path; call prepare_doc_draft for file-backed edits.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "document_key": {"type": "string"},
                    "doc_id": {"type": "string"},
                    "document_id": {"type": "string"},
                    "id": {"type": "string"},
                    "path_key": {"type": "string"},
                    "file_path": {"type": "string"},
                    "title": {"type": "string"},
                    "name": {"type": "string"},
                    "include_content": {"type": "boolean", "description": "When true or omitted, include document content, hydrating this single document if needed."},
                    "refresh": {"type": "boolean", "description": "When true, force a Cloud/cache refresh before resolving the document."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "prepare_doc_draft",
            "description": "Prepare a separate file-backed draft for an account Tools document without switching tabs. Edit the returned draft_path directly on disk, then call save_doc with draft_path/draft_id/base_content_hash and the document key to promote it. This keeps hydration and canonical local_path untouched until save.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "document_key": {"type": "string"},
                    "doc_id": {"type": "string"},
                    "document_id": {"type": "string"},
                    "id": {"type": "string"},
                    "path_key": {"type": "string"},
                    "file_path": {"type": "string"},
                    "title": {"type": "string"},
                    "name": {"type": "string"},
                    "content": {"type": "string"},
                    "content_md": {"type": "string"},
                    "reuse_existing": {"type": "boolean"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "save_doc",
            "description": "Register and save an account Tools document by document_key, doc_id/document_id, path_key, file_path, title, name, draft_path, or draft_id without switching tabs. Prefer prepare_doc_draft, edit the returned draft_path, then save_doc with draft_path, draft_id, base_content_hash, and document_key/path_key to promote it. If content/content_md is supplied, Diff Forge writes that content. Default mode is publish/sync so other clients can see it; use mode=local only for local-only saves. Empty overwrites require allow_empty_overwrite=true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "document_key": {"type": "string"},
                    "doc_id": {"type": "string"},
                    "document_id": {"type": "string"},
                    "id": {"type": "string"},
                    "path_key": {"type": "string"},
                    "file_path": {"type": "string"},
                    "local_path": {"type": "string"},
                    "draft_path": {"type": "string"},
                    "draft_id": {"type": "string"},
                    "base_content_hash": {"type": "string", "description": "Required when promoting a draft over an existing canonical document; use the value returned by prepare_doc_draft."},
                    "base_hash": {"type": "string"},
                    "title": {"type": "string"},
                    "name": {"type": "string"},
                    "content": {"type": "string"},
                    "content_md": {"type": "string"},
                    "mode": {"type": "string", "description": "publish, push, sync, save, or local. save aliases publish; use local only for local-only saves."},
                    "allow_empty_overwrite": {"type": "boolean"},
                    "allow_conflict": {"type": "boolean", "description": "Force-promote a draft even if the canonical document changed after prepare_doc_draft."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "write_doc",
            "description": "Alias for save_doc. Promote an account document draft_path/draft_id or save content/content_md.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": true
            }
        }),
        json!({
            "name": "get_selected_document_context",
            "description": "Return the selected Tools document context, including local backing file path, document type, sync state, and current highlighted range. Use this for questions about the currently selected skill, instruction, architecture, or document.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "include_content": {"type": "boolean"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "get_selected_script_context",
            "description": "Return the selected local Tools script context, including local backing file path, shell, button colors, and current highlighted range. Use this for questions about the currently selected script.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "include_content": {"type": "boolean"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "list_local_scripts",
            "description": "Return every saved local Tools script available on this device without changing the visible tab, active view, selected script, or highlighted range, including stable script_id, exact script name, path_key, file_name, and shell. Alias: list_scripts. Use this before run_local_script when the user names a script that is not selected or when more than one script exists.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "include_content": {"type": "boolean", "description": "When true, include script file contents."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "list_scripts",
            "description": "Return every saved local Tools script available on this device without changing the visible tab, active view, selected script, or highlighted range, including stable script_id, exact script name, path_key, file_name, and shell. Use this for background script inventory questions.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "include_content": {"type": "boolean", "description": "When true, include script file contents."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "get_script",
            "description": "Return one saved local Tools script by script_id, path_key, file_path, filename/stem, title, or name without changing the visible tab, active view, selected script, or highlighted range.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "script_id": {"type": "string"},
                    "id": {"type": "string"},
                    "script_name": {"type": "string"},
                    "name": {"type": "string"},
                    "title": {"type": "string"},
                    "path_key": {"type": "string"},
                    "file_path": {"type": "string"},
                    "path": {"type": "string"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "get_selection_context",
            "description": "Return only the current highlighted selection/range context for the visible document or local script surface. Use this before modify/delete/rewrite/replace-this-selection requests, then preserve surrounding content when applying an edit.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": true}
        }),
        json!({
            "name": "save_selected_document",
            "description": "Save the currently selected Tools document from Diff Forge's live editor state. Default mode is publish/sync so other clients can see it. Use mode=local only for local-only pending save.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "mode": {"type": "string", "description": "local, publish, push, sync, or save."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "update_selected_document",
            "description": "Create or patch the currently selected Tools document or unsaved draft inside Diff Forge. Use this for make/create skill, HTML page, create a draft, modify/delete highlighted selection, rewrite selected text, or update architecture requests. Send the full updated content/content_md when changing text. Default to mode=draft unless the user asks for local save or publish. Never write legacy account-skills.md.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "New document title/name."},
                    "content": {"type": "string", "description": "Full markdown, architecture, or HTML content to place in the editor."},
                    "content_md": {"type": "string", "description": "Full document content to place in the editor."},
                    "document_kind": {"type": "string", "description": "skill, architecture, html, or document."},
                    "extension": {"type": "string", "description": "md, arch, or html."},
                    "mode": {"type": "string", "description": "draft, local, publish, push, sync, or save. draft updates the editor without persisting."},
                    "save": {"type": "boolean", "description": "When true, save after applying the patch. mode controls local vs publish."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "selected_update",
            "description": "Update the currently selected live editor item. Routes to update_selected_document for selected documents, including workspace Docs panels, or update_selected_script for selected local scripts.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "content": {"type": "string"},
                    "content_md": {"type": "string"},
                    "document_kind": {"type": "string"},
                    "extension": {"type": "string"},
                    "mode": {"type": "string"},
                    "save": {"type": "boolean"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "save_selected_script",
            "description": "Save the currently selected local Tools script from Diff Forge's live editor state. Script content stays local; script id/name metadata syncs to Cloud for device routing.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": true
            }
        }),
        json!({
            "name": "update_selected_script",
            "description": "Create or patch the currently selected local Tools script or unsaved script draft inside Diff Forge. Send the full updated content/content_md when changing text. Default to mode=draft unless the user asks to save locally or run.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "New script title/name."},
                    "content": {"type": "string", "description": "Full script content to place in the editor."},
                    "content_md": {"type": "string", "description": "Full script content to place in the editor."},
                    "shell": {"type": "string", "description": "zsh, bash, python3, or node."},
                    "workspace_button_color": {"type": "string", "description": "Hex background color for the Workspaces-mode bottom run button."},
                    "workspace_text_color": {"type": "string", "description": "Hex text color for the Workspaces-mode bottom run button."},
                    "loopspace_button_color": {"type": "string", "description": "Hex background color for the Loopspaces-mode bottom run button."},
                    "loopspace_text_color": {"type": "string", "description": "Hex text color for the Loopspaces-mode bottom run button."},
                    "mode": {"type": "string", "description": "draft, local, save, run, or execute."},
                    "save": {"type": "boolean", "description": "When true, save after applying the patch."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "run_selected_script",
            "description": "Save if needed, then start the currently selected local Tools script on this device. This returns after the run is accepted; do not wait or poll unless the user explicitly asks for logs.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": true
            }
        }),
        json!({
            "name": "run_local_script",
            "description": "Start a saved local Tools script on this device by exact script_id, script_name/name, or path_key. This returns immediately after the run is accepted; do not wait or poll unless the user explicitly asks for logs. Use this when the user asks to run a known script that is not necessarily selected in the editor.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "script_id": {"type": "string", "description": "Stable script_id from the local scripts inventory."},
                    "script_name": {"type": "string", "description": "Exact visible script name if script_id is unavailable."},
                    "name": {"type": "string", "description": "Alias for script_name."},
                    "path_key": {"type": "string", "description": "Local path key such as scripts/deploy.sh or deploy.sh."},
                    "working_directory": {"type": "string", "description": "Optional cwd override."},
                    "shell": {"type": "string", "description": "Optional shell override: zsh, bash, python3, node, powershell, cmd."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "list_assets",
            "description": "List compact account asset rows from the local Rust asset mirror without changing tabs, including local/cloud availability and recent transfer status. Use asset_id/asset_ids, kind, status, transfer_status, active_only, device_id/device_ids, and limit to filter.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string"},
                    "asset_ids": {"type": "array", "items": {"type": "string"}},
                    "kind": {"type": "string", "description": "Optional asset kind filter, for example image, video, audio, pdf, archive, or document."},
                    "status": {"type": "string", "description": "Optional asset status filter."},
                    "transfer_status": {"type": "string", "description": "Optional transfer status filter. Use active for in-flight transfers."},
                    "active_only": {"type": "boolean"},
                    "device_id": {"type": "string"},
                    "device_ids": {"type": "array", "items": {"type": "string"}},
                    "limit": {"type": "integer", "default": 100, "maximum": 1000}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "get_asset_root",
            "description": "Return the managed Diff Forge account asset root and a safe suggested local_path for a generated/reusable asset. Write the file to local_path, then call upload_asset with that path so Rust tracks, hashes, dedupes, and uploads it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string", "description": "Optional caller-provided asset id. Omit to let Diff Forge suggest one."},
                    "name": {"type": "string", "description": "Preferred filename, for example qa-screenshot.png."},
                    "filename": {"type": "string", "description": "Alias for name."},
                    "mime_type": {"type": "string", "description": "Optional MIME type used to infer an extension."},
                    "extension": {"type": "string", "description": "Optional extension without a leading dot."},
                    "group": {"type": "string", "description": "Optional managed library subfolder. Defaults to generated."},
                    "source_kind": {"type": "string", "description": "Optional provenance/source label."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "upload_asset",
            "description": "Track and upload one local generated asset. Rust computes sha256/size, stores the local mirror row, asks Cloud to dedupe or prepare upload, and streams bytes only when Cloud needs the blob. Call get_asset_root first for generated files.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Required local file path to track and upload."},
                    "local_path": {"type": "string", "description": "Alias for path."},
                    "asset_id": {"type": "string", "description": "Optional caller-provided asset id."},
                    "name": {"type": "string", "description": "Optional display name."},
                    "filename": {"type": "string", "description": "Alias for name."},
                    "mime_type": {"type": "string", "description": "Optional MIME type override."},
                    "kind": {"type": "string", "description": "Optional asset kind override."},
                    "source_kind": {"type": "string", "description": "Optional provenance/source label."},
                    "group": {"type": "string", "description": "Optional managed library subfolder."},
                    "metadata": {"type": "object", "additionalProperties": true}
                },
                "required": ["path"],
                "additionalProperties": true
            }
        }),
        json!({
            "name": "upload_asset_status",
            "description": "Read recent upload transfer status from the local Rust asset mirror. Filter by asset_id/asset_ids, transfer_id/transfer_ids, device_id/device_ids, active_only, status, or limit.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string"},
                    "asset_ids": {"type": "array", "items": {"type": "string"}},
                    "transfer_id": {"type": "string"},
                    "transfer_ids": {"type": "array", "items": {"type": "string"}},
                    "device_id": {"type": "string"},
                    "device_ids": {"type": "array", "items": {"type": "string"}},
                    "active_only": {"type": "boolean"},
                    "status": {"type": "string", "description": "Optional upload transfer status. Use active for in-flight uploads."},
                    "limit": {"type": "integer", "default": 100, "maximum": 1000}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "download_asset",
            "description": "Download one Cloud asset into the device-level Diff Forge asset library by default, or a caller-provided target directory. Use this when list_assets shows an input asset but no local_path/local copy is available.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string", "description": "Required Cloud asset id to download."},
                    "target_directory": {"type": "string", "description": "Optional download directory. Defaults to the device-level Diff Forge asset library."}
                },
                "required": ["asset_id"],
                "additionalProperties": true
            }
        }),
        json!({
            "name": "download_asset_status",
            "description": "Read recent download transfer status from the local Rust asset mirror. Filter by asset_id/asset_ids, transfer_id/transfer_ids, device_id/device_ids, active_only, status, or limit.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string"},
                    "asset_ids": {"type": "array", "items": {"type": "string"}},
                    "transfer_id": {"type": "string"},
                    "transfer_ids": {"type": "array", "items": {"type": "string"}},
                    "device_id": {"type": "string"},
                    "device_ids": {"type": "array", "items": {"type": "string"}},
                    "active_only": {"type": "boolean"},
                    "status": {"type": "string", "description": "Optional download transfer status. Use active for in-flight downloads."},
                    "limit": {"type": "integer", "default": 100, "maximum": 1000}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "select_workspace",
            "description": "Activate, select, or deactivate a Diff Forge workspace by id or name.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"},
                    "active": {"type": "boolean", "description": "true activates/selects; false deactivates."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "list_loopspace_triggers",
            "description": "List reusable Loopspace trigger inventory. Use this before editing a Loopspace graph that references cron, webhook, or manual triggers.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "remote": {"type": "boolean", "description": "When true or omitted, refresh from Cloud before returning the local trigger inventory."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "create_loopspace_trigger",
            "description": "Create a reusable Loopspace trigger inventory item. Always pass trigger_type explicitly: cron, webhook, or manual. Webhook triggers are inbound and default to signed_hmac; use public_token only when the user explicitly asks for a public URL and public_webhook_confirmed=true. To put the trigger in a graph, call patch_loopspace_graph with {op:'attach_trigger', trigger_id:'...'} after this succeeds.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "trigger_name": {"type": "string", "description": "Visible trigger name, for example BasicCron."},
                    "name": {"type": "string", "description": "Alias for trigger_name."},
                    "trigger_type": {"type": "string", "description": "cron, webhook, or manual."},
                    "type": {"type": "string", "description": "Alias for trigger_type."},
                    "loopspace_ids": {"type": "array", "items": {"type": "string"}, "description": "Optional loopspace ids this trigger belongs to."},
                    "config": {"type": "object", "description": "Trigger config. Cron supports {schedule:'@every 5m'}."},
                    "webhook_auth_mode": {"type": "string", "description": "For webhook triggers: signed_hmac by default, or public_token when the user explicitly wants a public URL."},
                    "webhook_signature_tolerance_sec": {"type": "integer", "description": "Signed webhook timestamp tolerance in seconds. Default 300."},
                    "public_webhook_confirmed": {"type": "boolean", "description": "Required true when webhook_auth_mode is public_token."},
                    "enabled": {"type": "boolean"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "update_loopspace_trigger",
            "description": "Update, enable/disable, or rotate a reusable Loopspace trigger. For webhook public_token mode, public_webhook_confirmed must be true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "trigger_id": {"type": "string"},
                    "id": {"type": "string"},
                    "trigger_name": {"type": "string", "description": "New visible trigger name."},
                    "name": {"type": "string", "description": "Alias for trigger_name."},
                    "enabled": {"type": "boolean"},
                    "loopspace_ids": {"type": "array", "items": {"type": "string"}},
                    "config": {"type": "object", "description": "Replacement trigger config. Cron supports {schedule:'@every 5m'}."},
                    "rotate_secret": {"type": "boolean", "description": "Rotate webhook public URL token or signing secret."},
                    "webhook_auth_mode": {"type": "string", "description": "signed_hmac or public_token."},
                    "webhook_signature_tolerance_sec": {"type": "integer", "description": "Signed webhook timestamp tolerance in seconds."},
                    "public_webhook_confirmed": {"type": "boolean", "description": "Required true when webhook_auth_mode is public_token."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "delete_loopspace_trigger",
            "description": "Delete a reusable Loopspace trigger inventory item by trigger_id or trigger_name. Use only when the user clearly asks to remove/delete a trigger. Removing inventory also removes the reusable trigger from the right-side Triggers tab; graph edits should use patch_loopspace_graph remove_node/remove_trigger when only detaching from one graph.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "trigger_id": {"type": "string"},
                    "id": {"type": "string"},
                    "trigger_name": {"type": "string"},
                    "name": {"type": "string"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "run_loopspace_trigger",
            "description": "Run a manual Loopspace trigger by trigger id or trigger name. Use this when the user asks the terminal orchestrator to kick, fire, invoke, or manually run a Loopspace trigger.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "trigger_id": {"type": "string"},
                    "id": {"type": "string"},
                    "trigger_name": {"type": "string"},
                    "name": {"type": "string"},
                    "payload": {"type": "object", "description": "Optional structured payload to record with the manual run."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "record_loopspace_step_progress",
            "description": "Record progress for the current Loopspace send-message or dispatch-todo checkpoint. Use this for Diff Forge internal action steps: call with status='running' when starting a step and status='completed' when that step is done. If a checkpoint generated assets, include asset_id or asset_ids after upload_asset succeeds. For Dispatch Todo, todo queue status remains the final source of completed/failed/interrupted state; checkpoint progress only updates the internal step display. Include loop runtime ids, wait for the response, and follow next_checkpoint before moving to the next checkpoint.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "loopspace_id": {"type": "string"},
                    "loop_runtime_run_id": {"type": "string"},
                    "loop_runtime_node_id": {"type": "string"},
                    "loop_runtime_edge_id": {"type": "string"},
                    "trigger_id": {"type": "string"},
                    "trigger_run_id": {"type": "string"},
                    "step_index": {"type": "integer", "minimum": 1},
                    "step_id": {"type": "string"},
                    "step_title": {"type": "string"},
                    "status": {"type": "string", "description": "running, completed, failed, or skipped."},
                    "asset_id": {"type": "string", "description": "Generated/uploaded asset id for this checkpoint."},
                    "asset_ids": {"type": "array", "items": {"type": "string"}, "description": "Generated/uploaded asset ids for this checkpoint."},
                    "produced_assets": {"type": "array", "items": {"type": "object", "additionalProperties": true}, "description": "Optional compact generated asset rows returned by upload_asset."},
                    "message": {"type": "string"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "get_loopspace_graph",
            "description": "Return the selected Loopspace .dfblueprint graph document, parsed blueprint AST, source format, runtime head, and graph metadata. Use this before editing a Loopspace graph.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "loopspace_id": {"type": "string"},
                    "id": {"type": "string"},
                    "loopspace_name": {"type": "string"},
                    "name": {"type": "string"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "update_loopspace_graph",
            "description": "Replace a Loopspace graph document with full .dfblueprint source. The source field is required; prefer patch_loopspace_graph for small edits. Call get_loopspace_graph and list_loopspace_triggers first. Trigger nodes must reference registered inventory ids; create missing triggers with create_loopspace_trigger, then attach by trigger_id. Edges must use explicit legal node.port endpoints: trigger.out, run_script/send_message/dispatch_todos/notify_device exec|success|failure|interrupt, docs, assets, and target .in ports. Never create new action .out edges. For terminal-orchestrator/coding-agent messages, use a send_message action region with child step nodes parented to it. For queued workspace todos, use a dispatch_todos action region; it may be direct with todo_lines or include child step checkpoints parented to the dispatch_todos node. Route docs/assets through child step docs/assets ports, and never connect action execution branches directly to document_write or asset_write. Returns after the client hydrates the Cloud-accepted graph, unless queued/offline.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "loopspace_id": {"type": "string"},
                    "id": {"type": "string"},
                    "loopspace_name": {"type": "string"},
                    "name": {"type": "string"},
                    "source": {"type": "string"},
                    "source_format": {"type": "string", "description": "Use dfblueprint.v1."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "edit_loopspace_graph",
            "description": "Alias for update_loopspace_graph. Replace a Loopspace graph document with full .dfblueprint source after reading the current graph and trigger inventory. The source field is required. Trigger nodes must reference registered inventory ids; create missing triggers first. Edges must use explicit legal node.port endpoints: trigger.out, run_script/send_message/dispatch_todos/notify_device exec|success|failure|interrupt, docs, assets, and target .in ports. Never create new action .out edges. Use send_message action regions for terminal-orchestrator/coding-agent messages and dispatch_todos action regions for queued workspace todos; both can contain child step checkpoints parented to the action node. Route docs/assets through child step docs/assets ports, and never connect action execution branches directly to document_write or asset_write.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "loopspace_id": {"type": "string"},
                    "id": {"type": "string"},
                    "loopspace_name": {"type": "string"},
                    "name": {"type": "string"},
                    "source": {"type": "string"},
                    "source_format": {"type": "string", "description": "Use dfblueprint.v1."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "patch_loopspace_graph",
            "description": "Patch a Loopspace .dfblueprint graph without rewriting the whole source. Call get_loopspace_graph and list_loopspace_triggers first. Trigger graph nodes must reference inventory: use attach_trigger with trigger_id, or create_loopspace_trigger first with explicit trigger_type. Do not invent standalone cron/manual/webhook nodes. For add_node, use supported node kinds: document_read, document_write, asset_read, asset_write, run_script, send_message, dispatch_todos, notify_device, or step. Device nodes are legacy saved-graph compatibility only; target devices are selected on send_message, dispatch_todos, run_script, and notify_device nodes. When the graph should send a message to the terminal orchestrator or a coding agent, create a send_message node as the outer action/target region; do not model that as queue_todo, dispatch_todos, or a free-floating terminal edge. When the graph should dispatch queued todos to workspace terminals, create a dispatch_todos node as the outer action/target region; it may be direct with target_workspace_ids and todo_lines or have child step nodes with parent_id set to the dispatch_todos node id. Edges are explicit node_id.port -> node_id.port connections. Trigger nodes expose out; run_script/send_message/dispatch_todos/notify_device expose exec, success, failure, interrupt; document_read/document_write expose docs; asset_read/asset_write expose assets; step nodes expose success, docs, and assets; executable/resource targets generally accept in. Specify from_port and to_port on connect operations, especially from action nodes. For internal steps on send_message or dispatch_todos, connect trigger.out -> action.in; document_read.docs or asset_read.assets -> step.in for readable context; step.docs -> document_write.in for generated documents; step.assets -> asset_write.in for generated assets; and step.success -> run_script.in, send_message.in, dispatch_todos.in, or notify_device.in when a completed substep should start another action. Do not connect send_message.exec, send_message.success, dispatch_todos.exec, dispatch_todos.success, run_script.exec, run_script.success, or other action execution branches directly into document_write or asset_write; for generated documents/assets, prefer the child step docs/assets ports. Use doc_refs for document selections, asset_refs for asset selections, h for resource node height, and target_mode for selection/create behavior. Write nodes may include create_name for a new/generated resource name. Send-message nodes use prompt plus optional device_id/target_device_id, device_label/target_device_label, target_agent_id, target_terminal_id, model, reasoning_effort, and speed. Dispatch todo nodes use target_workspace_ids, todo_lines, target_terminal_mode auto|pinned, optional target_terminal_id/index/name, and optional target_agent_id/model/reasoning_effort/speed. Notify device nodes send a native/push notification when reached and use optional device_id (empty targets all account devices), title, body, url, and delivery auto|native|push; title/body support {{loop_name}}, {{node_title}}, {{from_node}}, {{branch}}, {{device_name}}, {{run_id}}, and {{date}} template variables. add_node and update_node_props accept resource metadata as top-level fields or nested under props.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "loopspace_id": {"type": "string"},
                    "id": {"type": "string"},
                    "loopspace_name": {"type": "string"},
                    "name": {"type": "string"},
                    "operations": {
                        "type": "array",
                        "items": {"type": "object", "additionalProperties": true},
                        "description": "Examples: {op:'attach_trigger', trigger_id:'trigger-...', x:0, y:0}; {op:'add_node', id:'read_doc', kind:'document_read', label:'Read document'}; {op:'add_node', id:'write_doc', kind:'document_write', label:'Write document', create_name:'research.md'}; {op:'add_node', id:'message_agent', kind:'send_message', label:'Message agent', device_id:'device-id', target_agent_id:'codex'}; {op:'add_node', id:'step_research', kind:'step', label:'Step 1', parent_id:'message_agent'}; {op:'connect', from:'trigger-basic', from_port:'out', to:'message_agent', to_port:'in'}; {op:'connect', from:'read_doc', from_port:'docs', to:'step_research', to_port:'in'}; {op:'connect', from:'step_research', from_port:'docs', to:'write_doc', to_port:'in'}; {op:'add_node', id:'dispatch_todos', kind:'dispatch_todos', label:'Dispatch todos', target_workspace_ids:'workspace-1', target_terminal_mode:'auto', todo_lines:'Audit UI\\nFix bug'}; {op:'add_node', id:'dispatch_step', kind:'step', label:'Step 1', parent_id:'dispatch_todos'}; {op:'add_node', id:'notify_me', kind:'notify_device', label:'Notify device', body:'\"{{from_node}}\" -> {{branch}}'}."
                    },
                    "ops": {
                        "type": "array",
                        "items": {"type": "object", "additionalProperties": true}
                    }
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "select_tab",
            "description": "Switch the visible Diff Forge app tab. Supports terminals, files, history, tools, documents, mcps, clis, scripts, assets, audio, tokenomics, snipping, settings, and the Loopspaces-only right-side triggers tool tab.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tab": {"type": "string"},
                    "view": {"type": "string"},
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "list_panels",
            "description": "List live workspace panels in the selected workspace by default, including Docs, Web, PCB, and terminal pane metadata. Use this before controlling a workspace panel when the pane id or selected workspace is unclear.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"},
                    "kind": {"type": "string", "description": "Optional panel kind filter: docs, web, pcb, terminal, or all."},
                    "include_context": {"type": "boolean", "description": "When true, include compact kind-specific context such as current URL, selected board path, or selected document metadata."},
                    "include_state": {"type": "boolean", "description": "When true, include broader app-control state."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "get_panel_context",
            "description": "Return one live workspace panel context, defaulting to the active/selected panel in the selected workspace. Docs panels expose selected document/range metadata, PCB panels expose selected board paths, and Web panels expose current URL/search state.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"},
                    "pane_id": {"type": "string"},
                    "panel_id": {"type": "string"},
                    "terminal_index": {"type": "integer", "minimum": 0},
                    "kind": {"type": "string", "description": "docs, web, pcb, or terminal."},
                    "include_content": {"type": "boolean", "description": "When true, include already-live editor content when available. Large or native webview content is not captured."},
                    "include_state": {"type": "boolean"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "focus_panel",
            "description": "Focus or reveal a live workspace panel by kind, pane id, panel id, or terminal index. Defaults to the selected workspace.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"},
                    "pane_id": {"type": "string"},
                    "panel_id": {"type": "string"},
                    "terminal_index": {"type": "integer", "minimum": 0},
                    "kind": {"type": "string", "description": "docs, web, pcb, or terminal."},
                    "include_state": {"type": "boolean"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "open_panel",
            "description": "Open a workspace panel in the selected workspace by default. Kinds: docs, web, pcb. Web may accept url/search; PCB may accept create/name or board_path/board_name to switch to an existing board.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"},
                    "kind": {"type": "string", "description": "docs, web, or pcb."},
                    "url": {"type": "string", "description": "Initial web URL or search text for web panels."},
                    "search": {"type": "string", "description": "Search text for web panels."},
                    "name": {"type": "string", "description": "Optional board name for PCB create flows."},
                    "board_path": {"type": "string", "description": "Repo-relative PCB board path to open or switch to, for example hardware/blinky/blinky.board.tsx."},
                    "board_name": {"type": "string", "description": "Existing PCB board name to open or switch to."},
                    "focus": {"type": "boolean", "description": "When true or omitted, show/focus the panel after opening."},
                    "include_state": {"type": "boolean"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "close_panel",
            "description": "Close a workspace panel by kind, pane id, panel id, or terminal index. Defaults to the selected workspace.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"},
                    "pane_id": {"type": "string"},
                    "panel_id": {"type": "string"},
                    "terminal_index": {"type": "integer", "minimum": 0},
                    "kind": {"type": "string", "description": "docs, web, pcb, or terminal."},
                    "include_state": {"type": "boolean"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "panel_action",
            "description": "Perform a bounded action on a live workspace panel. Web supports navigate/search/reload/back/forward/focus/open/return/screenshot; PCB supports create/select/open-board/refresh/focus/open/return; Docs supports focus/open/close/context. Screenshot focuses the target panel, then saves a native full-screen capture through Snipping.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"},
                    "pane_id": {"type": "string"},
                    "panel_id": {"type": "string"},
                    "terminal_index": {"type": "integer", "minimum": 0},
                    "kind": {"type": "string", "description": "docs, web, pcb, or terminal."},
                    "action": {"type": "string", "description": "navigate, search, reload, back, forward, screenshot, create, select, open-board, refresh, focus, open, return, close, or context."},
                    "url": {"type": "string"},
                    "search": {"type": "string"},
                    "query": {"type": "string"},
                    "name": {"type": "string"},
                    "board_path": {"type": "string", "description": "Repo-relative PCB board path for select/open-board/switch actions."},
                    "board_name": {"type": "string", "description": "PCB board name for select/open-board/switch actions."},
                    "args": {"type": "object", "additionalProperties": true},
                    "include_state": {"type": "boolean"}
                },
                "required": ["action"],
                "additionalProperties": true
            }
        }),
        json!({
            "name": "list_terminals",
            "description": "List workspace terminals, including their slot index, agent type, pane id, thread id, live status, and configured workspace.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"},
                    "verbose": {"type": "boolean", "description": "When true, include root directories, status arrays, idle reasons, and extra terminal details."},
                    "include_state": {"type": "boolean", "description": "When true, include the broader app-control state. Defaults false to keep live routing token-light."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "list_todo_targets",
            "description": "List queueable workspace todo targets for terminal orchestrator agents, including selected/activated workspaces, live workspace state, configured terminals, live terminals, idle/busy status, agent type, pane id, thread id, and terminal indexes. Use this before queue_todo/send_todo when the target workspace or terminal is unclear.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"},
                    "verbose": {"type": "boolean"},
                    "include_state": {"type": "boolean"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "list_workspace_todo_targets",
            "description": "Alias for list_todo_targets. Return live queueable workspace/terminal todo targets without changing the user's selected todo.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"},
                    "verbose": {"type": "boolean"},
                    "include_state": {"type": "boolean"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "queue_todo",
            "description": "Queue an immediate todo/prompt into a workspace terminal queue from the terminal orchestrator. Pass workspace_id or workspace_name plus text/prompt/message/body/title/task. Omit terminal selectors for the next available terminal, or pass terminal_index, pane_id, target_terminal_id, target_thread_id, or target_terminal_name for a specific coding-agent terminal. Optional agent/target_agent_id constrains to claude, codex, or opencode; shell terminals are not queueable. By default this activates the workspace so its queue can receive the item; set open_workspace=false to avoid switching views. For Loopspace graph design, use send_message for future terminal-orchestrator messages and dispatch_todos for future queued workspace todo dispatches instead of queue_todo/send_todo.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"},
                    "text": {"type": "string"},
                    "prompt": {"type": "string"},
                    "message": {"type": "string"},
                    "body": {"type": "string"},
                    "title": {"type": "string"},
                    "task": {"type": "string"},
                    "agent": {"type": "string"},
                    "target_agent_id": {"type": "string"},
                    "terminal_index": {"type": "integer", "minimum": 0},
                    "terminal_number": {"type": "integer", "minimum": 1},
                    "pane_id": {"type": "string"},
                    "target_terminal_id": {"type": "string"},
                    "target_terminal_name": {"type": "string"},
                    "target_thread_id": {"type": "string"},
                    "model": {"type": "string"},
                    "reasoning_effort": {"type": "string"},
                    "speed": {"type": "string"},
                    "open_workspace": {"type": "boolean"},
                    "open_terminals": {"type": "boolean"},
                    "ensure_terminal": {"type": "boolean"},
                    "terminal_count": {"type": "integer", "minimum": 1},
                    "command_id": {"type": "string"},
                    "verbose": {"type": "boolean", "description": "When true, echo the full queued item and detailed terminal target snapshot. Defaults false."},
                    "include_state": {"type": "boolean", "description": "When true, include broader app-control state. Defaults false."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "send_todo",
            "description": "Alias for queue_todo. Queue an immediate todo/prompt for workspace terminal dispatch; the existing terminal queue decides when it can send safely. For Loopspace graph design, use dispatch_todos for queued workspace todo dispatches instead of this tool.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": true}
        }),
        json!({
            "name": "create_todo",
            "description": "Alias for queue_todo. Create and queue a workspace todo for a specific workspace or terminal.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": true}
        }),
        json!({
            "name": "queue_workspace_todo",
            "description": "Alias for queue_todo. Queue a workspace todo generally or to a selected terminal.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": true}
        }),
        json!({
            "name": "open_terminals",
            "description": "Open one or more terminals in a workspace. Agent types are claude, codex, opencode, and shell/terminal.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"},
                    "agent": {"type": "string", "description": "claude, codex, opencode, shell, terminal, or generic."},
                    "agent_type": {"type": "string"},
                    "count": {"type": "integer", "minimum": 1},
                    "mode": {"type": "string", "description": "spawn opens count new terminals; ensure ensures count terminals of that agent exist."},
                    "focus": {"type": "boolean", "description": "When true, show the workspace terminals tab and focus the newest opened terminal."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "close_terminals",
            "description": "Close workspace terminals by index, pane id, agent type, count, or all=true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"},
                    "terminal_index": {"type": "integer", "minimum": 0},
                    "terminal_indexes": {"type": "array", "items": {"type": "integer", "minimum": 0}},
                    "pane_id": {"type": "string"},
                    "pane_ids": {"type": "array", "items": {"type": "string"}},
                    "agent": {"type": "string"},
                    "agent_type": {"type": "string"},
                    "count": {"type": "integer", "minimum": 1},
                    "all": {"type": "boolean"},
                    "force": {"type": "boolean", "description": "Close busy terminals too. Without force, busy terminals are skipped."},
                    "only_idle": {"type": "boolean", "description": "Close only terminals that appear idle."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "focus_terminal",
            "description": "Focus a workspace terminal by index, pane id, or agent type and show the terminals tab.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_name": {"type": "string"},
                    "terminal_index": {"type": "integer", "minimum": 0},
                    "pane_id": {"type": "string"},
                    "agent": {"type": "string"},
                    "agent_type": {"type": "string"}
                },
                "additionalProperties": true
            }
        }),
    ]
}

fn app_control_mcp_call_tool(context: &AppControlMcpContext, tool: &str, input: Value) -> Value {
    if ![
        "get_state",
        "get_visible_context",
        "selected_context",
        "list_docs",
        "get_doc",
        "prepare_doc_draft",
        "save_doc",
        "write_doc",
        "get_selected_document_context",
        "get_selected_script_context",
        "get_selection_context",
        "save_selected_document",
        "update_selected_document",
        "selected_update",
        "save_selected_script",
        "update_selected_script",
        "run_selected_script",
        "run_local_script",
        "list_assets",
        "get_asset_root",
        "upload_asset",
        "upload_asset_status",
        "download_asset",
        "download_asset_status",
        "list_local_scripts",
        "list_scripts",
        "get_script",
        "select_workspace",
        "list_loopspace_triggers",
        "create_loopspace_trigger",
        "update_loopspace_trigger",
        "delete_loopspace_trigger",
        "run_loopspace_trigger",
        "record_loopspace_step_progress",
        "get_loopspace_graph",
        "update_loopspace_graph",
        "edit_loopspace_graph",
        "patch_loopspace_graph",
        "select_tab",
        "list_panels",
        "get_panel_context",
        "focus_panel",
        "open_panel",
        "close_panel",
        "panel_action",
        "list_terminals",
        "list_todo_targets",
        "list_workspace_todo_targets",
        "queue_todo",
        "send_todo",
        "create_todo",
        "queue_workspace_todo",
        "open_terminals",
        "close_terminals",
        "focus_terminal",
    ]
    .contains(&tool)
    {
        return json!({
            "ok": false,
            "error": {
                "code": "unknown_tool",
                "message": format!("Unknown app-control tool: {tool}")
            }
        });
    }
    app_control_mcp_forward_to_app(context, tool, input).unwrap_or_else(|error| {
        json!({
            "ok": false,
            "error": {
                "code": "bridge_failed",
                "message": error
            }
        })
    })
}

fn app_control_mcp_forward_to_app(
    context: &AppControlMcpContext,
    tool: &str,
    input: Value,
) -> Result<Value, String> {
    app_control_mcp_forward_bridge_request(
        &context.endpoint,
        &context.token,
        tool,
        input,
        app_control_mcp_tool_timeout_ms(tool).saturating_add(1000),
    )
}

pub(crate) fn app_control_mcp_forward_bridge_request(
    endpoint: &str,
    token: &str,
    tool: &str,
    input: Value,
    timeout_ms: u64,
) -> Result<Value, String> {
    let endpoint = endpoint
        .trim()
        .strip_prefix("tcp://")
        .unwrap_or_else(|| endpoint.trim());
    let mut stream = std::net::TcpStream::connect(endpoint)
        .map_err(|error| format!("Unable to connect to app-control bridge: {error}"))?;
    let timeout_duration = Duration::from_millis(timeout_ms);
    let _ = stream.set_read_timeout(Some(timeout_duration));
    let _ = stream.set_write_timeout(Some(timeout_duration));
    let mut request = json!({
        "token": token,
        "tool": tool,
        "input": input,
    })
    .to_string();
    request.push('\n');
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("Unable to write app-control bridge request: {error}"))?;
    stream
        .flush()
        .map_err(|error| format!("Unable to flush app-control bridge request: {error}"))?;
    let mut reader = std::io::BufReader::new(stream);
    let mut response = String::new();
    std::io::BufRead::read_line(&mut reader, &mut response)
        .map_err(|error| format!("Unable to read app-control bridge response: {error}"))?;
    serde_json::from_str(response.trim())
        .map_err(|error| format!("Invalid app-control bridge response: {error}"))
}

fn app_control_mcp_tool_timeout_ms(tool: &str) -> u64 {
    if matches!(
        tool,
        "run_local_script"
            | "upload_asset"
            | "download_asset"
            | "video_transcribe"
            | "video_look"
            | "video_media"
    ) {
        APP_CONTROL_MCP_SCRIPT_RUN_TIMEOUT_MS
    } else {
        APP_CONTROL_MCP_TIMEOUT_MS
    }
}

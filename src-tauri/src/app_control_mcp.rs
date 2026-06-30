const APP_CONTROL_MCP_REQUEST_EVENT: &str = "forge-app-control-mcp-request";
const APP_CONTROL_MCP_SERVER_NAME: &str = "diffforge-app-control";
const APP_CONTROL_MCP_TIMEOUT_MS: u64 = 20_000;
const APP_CONTROL_MCP_SCRIPT_RUN_TIMEOUT_MS: u64 = 60 * 60 * 1000;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppControlMcpEndpoint {
    host: String,
    port: u16,
    token: String,
    url: String,
}

struct AppControlMcpState {
    endpoint: Arc<StdMutex<Option<AppControlMcpEndpoint>>>,
    pending: Arc<StdMutex<HashMap<String, oneshot::Sender<Value>>>>,
    next_request_id: AtomicU64,
}

impl AppControlMcpState {
    fn new() -> Self {
        Self {
            endpoint: Arc::new(StdMutex::new(None)),
            pending: Arc::new(StdMutex::new(HashMap::new())),
            next_request_id: AtomicU64::new(1),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppControlMcpBridgeRequest {
    token: String,
    tool: String,
    input: Value,
}

#[tauri::command]
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
    Ok(endpoint)
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
    let request_counter = state.next_request_id.load(Ordering::Relaxed);
    let counter = Arc::new(AtomicU64::new(request_counter));
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
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| format!("Unable to read app-control MCP bridge request: {error}"))?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..read]);
        if bytes.contains(&b'\n') || bytes.len() > 1024 * 1024 {
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
            .or_else(|| request.input.get("includeContent"))
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
            "requestId": request_id,
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
            "description": "Return the current Diff Forge app view, selected workspace, active workspace, compact accountDocs and localScripts inventories, available navigation targets, and a compact visible-context summary. Call this before app-control actions when the target tab, workspace, document, script, or selection is unclear.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false}
        }),
        json!({
            "name": "get_visible_context",
            "description": "Return the currently visible Diff Forge context, including selected Tools document or local script metadata, highlighted range, and compact state inventories when available. Use this first for prompts like explain this selected skill, create a draft here, modify/delete this selection, run the selected local script, or what is selected. For background inventory questions that should not disturb the user's view, use list_docs/list_scripts instead. Use localPath only for direct file edits when appropriate. For unsaved Tools document drafts, use update_selected_document; for unsaved local scripts, use update_selected_script.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "includeContent": {"type": "boolean", "description": "When true, include any small in-memory draft preview the UI can safely expose."}
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
                    "includeContent": {"type": "boolean", "description": "When true, include any small in-memory draft preview the UI can safely expose."}
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
                    "includeContent": {"type": "boolean", "description": "When true, include only already cached inline document content. This does not hydrate every document."},
                    "includeDrafts": {"type": "boolean", "description": "When true or omitted, include the current unsaved document draft as a draft item when present."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "get_doc",
            "description": "Return one account Tools document by document_key, doc_id/document_id, path_key, file_path, title, or name without changing the visible tab, active view, selected document, or highlighted range. Use includeContent=true to hydrate and return content for that one document. Do not directly edit local_path; call prepare_doc_draft for file-backed edits.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "document_key": {"type": "string"},
                    "documentKey": {"type": "string"},
                    "doc_id": {"type": "string"},
                    "document_id": {"type": "string"},
                    "id": {"type": "string"},
                    "path_key": {"type": "string"},
                    "pathKey": {"type": "string"},
                    "file_path": {"type": "string"},
                    "filePath": {"type": "string"},
                    "title": {"type": "string"},
                    "name": {"type": "string"},
                    "includeContent": {"type": "boolean", "description": "When true or omitted, include document content, hydrating this single document if needed."},
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
                    "documentKey": {"type": "string"},
                    "doc_id": {"type": "string"},
                    "document_id": {"type": "string"},
                    "id": {"type": "string"},
                    "path_key": {"type": "string"},
                    "pathKey": {"type": "string"},
                    "file_path": {"type": "string"},
                    "filePath": {"type": "string"},
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
                    "documentKey": {"type": "string"},
                    "doc_id": {"type": "string"},
                    "document_id": {"type": "string"},
                    "id": {"type": "string"},
                    "path_key": {"type": "string"},
                    "pathKey": {"type": "string"},
                    "file_path": {"type": "string"},
                    "filePath": {"type": "string"},
                    "local_path": {"type": "string"},
                    "localPath": {"type": "string"},
                    "draft_path": {"type": "string"},
                    "draftPath": {"type": "string"},
                    "draft_id": {"type": "string"},
                    "draftId": {"type": "string"},
                    "base_content_hash": {"type": "string", "description": "Required when promoting a draft over an existing canonical document; use the value returned by prepare_doc_draft."},
                    "baseContentHash": {"type": "string"},
                    "base_hash": {"type": "string"},
                    "baseHash": {"type": "string"},
                    "title": {"type": "string"},
                    "name": {"type": "string"},
                    "content": {"type": "string"},
                    "content_md": {"type": "string"},
                    "mode": {"type": "string", "description": "publish, push, sync, save, or local. save aliases publish; use local only for local-only saves."},
                    "allow_empty_overwrite": {"type": "boolean"},
                    "allowEmptyOverwrite": {"type": "boolean"},
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
                    "includeContent": {"type": "boolean"}
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
                    "includeContent": {"type": "boolean"}
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
                    "includeContent": {"type": "boolean", "description": "When true, include script file contents."}
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
                    "includeContent": {"type": "boolean", "description": "When true, include script file contents."}
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
                    "scriptName": {"type": "string"},
                    "name": {"type": "string"},
                    "title": {"type": "string"},
                    "path_key": {"type": "string"},
                    "pathKey": {"type": "string"},
                    "file_path": {"type": "string"},
                    "filePath": {"type": "string"},
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
                    "assetId": {"type": "string", "description": "Alias for asset_id."},
                    "target_directory": {"type": "string", "description": "Optional download directory. Defaults to the device-level Diff Forge asset library."},
                    "targetDirectory": {"type": "string", "description": "Alias for target_directory."}
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
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"},
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
            "description": "Record progress for the current Loopspace send-message checkpoint. Use this for Diff Forge internal send-message steps: call with status='running' when starting a step and status='completed' when that step is done. If a checkpoint generated assets, include asset_id or asset_ids after upload_asset succeeds. This updates checkpoint UI only; it does not complete the whole send-message node.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "loopspace_id": {"type": "string"},
                    "loopspaceId": {"type": "string"},
                    "loop_runtime_run_id": {"type": "string"},
                    "loopRuntimeRunId": {"type": "string"},
                    "loop_runtime_node_id": {"type": "string"},
                    "loopRuntimeNodeId": {"type": "string"},
                    "loop_runtime_edge_id": {"type": "string"},
                    "loopRuntimeEdgeId": {"type": "string"},
                    "trigger_id": {"type": "string"},
                    "triggerId": {"type": "string"},
                    "trigger_run_id": {"type": "string"},
                    "triggerRunId": {"type": "string"},
                    "step_index": {"type": "integer", "minimum": 1},
                    "stepIndex": {"type": "integer", "minimum": 1},
                    "step_id": {"type": "string"},
                    "stepId": {"type": "string"},
                    "step_title": {"type": "string"},
                    "stepTitle": {"type": "string"},
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
            "description": "Replace a Loopspace graph document with full .dfblueprint source. The source field is required; prefer patch_loopspace_graph for small edits. Call get_loopspace_graph and list_loopspace_triggers first. Trigger nodes must reference registered inventory ids; create missing triggers with create_loopspace_trigger, then attach by trigger_id. Edges must use explicit legal node.port endpoints: trigger.out, run_script/send_message/dispatch_todos exec|success|failure|interrupt, docs, assets, and target .in ports. Never create new action .out edges. Never connect action execution branches directly to asset_write. Returns after the client hydrates the Cloud-accepted graph, unless queued/offline.",
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
            "description": "Alias for update_loopspace_graph. Replace a Loopspace graph document with full .dfblueprint source after reading the current graph and trigger inventory. The source field is required. Trigger nodes must reference registered inventory ids; create missing triggers first. Edges must use explicit legal node.port endpoints: trigger.out, run_script/send_message/dispatch_todos exec|success|failure|interrupt, docs, assets, and target .in ports. Never create new action .out edges. Never connect action execution branches directly to asset_write.",
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
            "description": "Patch a Loopspace .dfblueprint graph without rewriting the whole source. Call get_loopspace_graph and list_loopspace_triggers first. Trigger graph nodes must reference inventory: use attach_trigger with trigger_id, or create_loopspace_trigger first with explicit trigger_type. Do not invent standalone cron/manual/webhook nodes. For add_node, use supported node kinds: document_read, document_write, asset_read, asset_write, run_script, send_message, dispatch_todos, or step. Device nodes are legacy saved-graph compatibility only; target devices are selected on send_message, dispatch_todos, and run_script nodes. Edges are explicit node_id.port -> node_id.port connections. Trigger nodes expose out; run_script/send_message/dispatch_todos expose exec, success, failure, interrupt; document_read/document_write expose docs; asset_read/asset_write expose assets; executable/resource targets generally accept in. Specify from_port/fromPort and to_port/toPort on connect operations, especially from action nodes. For send-message substeps, use step.success -> run_script.in, send_message.in, or dispatch_todos.in when a completed substep should start another action. For substep resource guidance, use document_read.docs or document_write.docs -> step.in for readable document context, asset_read.assets or asset_write.assets -> step.in for readable asset context, step.docs -> document_write.in for generated documents, and step.assets -> asset_write.in for generated assets. Do not connect send_message.exec, send_message.success, dispatch_todos.exec, dispatch_todos.success, run_script.exec, run_script.success, or other action execution branches directly into asset_write. Use doc_refs for document selections, asset_refs for asset selections, h for resource node height, and target_mode for selection/create behavior. Write nodes may include create_name for a new/generated resource name. Dispatch todo nodes use target_workspace_ids, todo_lines, optional target_terminal_id, and optional target_agent_id/model/reasoning_effort/speed. add_node and update_node_props accept resource metadata as top-level fields or nested under props.",
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
                        "description": "Examples: {op:'attach_trigger', trigger_id:'trigger-...', x:0, y:0}; {op:'add_node', id:'read_doc', kind:'document_read', label:'Read document'}; {op:'add_node', id:'make_asset', kind:'asset_write', label:'Create screenshot asset', create_name:'qa-screenshot.png'}; {op:'add_node', id:'message_agent', kind:'send_message', label:'Message agent'}; {op:'add_node', id:'dispatch_todos', kind:'dispatch_todos', label:'Dispatch todos', target_workspace_ids:'workspace-1', todo_lines:'Audit UI\\nFix bug'}; {op:'connect', from:'trigger-basic', from_port:'out', to:'message_agent', to_port:'in'}; {op:'connect', from:'message_agent', from_port:'success', to:'next_message', to_port:'in'}."
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
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"}
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
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"},
                    "kind": {"type": "string", "description": "Optional panel kind filter: docs, web, pcb, terminal, or all."},
                    "includeContext": {"type": "boolean", "description": "When true, include compact kind-specific context such as current URL, selected board path, or selected document metadata."},
                    "includeState": {"type": "boolean", "description": "When true, include broader app-control state."}
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
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"},
                    "paneId": {"type": "string"},
                    "panelId": {"type": "string"},
                    "terminalIndex": {"type": "integer", "minimum": 0},
                    "kind": {"type": "string", "description": "docs, web, pcb, or terminal."},
                    "includeContent": {"type": "boolean", "description": "When true, include already-live editor content when available. Large or native webview content is not captured."},
                    "includeState": {"type": "boolean"}
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
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"},
                    "paneId": {"type": "string"},
                    "panelId": {"type": "string"},
                    "terminalIndex": {"type": "integer", "minimum": 0},
                    "kind": {"type": "string", "description": "docs, web, pcb, or terminal."},
                    "includeState": {"type": "boolean"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "open_panel",
            "description": "Open a workspace panel in the selected workspace by default. Kinds: docs, web, pcb. Web may accept url/search; PCB may accept create/name.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"},
                    "kind": {"type": "string", "description": "docs, web, or pcb."},
                    "url": {"type": "string", "description": "Initial web URL or search text for web panels."},
                    "search": {"type": "string", "description": "Search text for web panels."},
                    "name": {"type": "string", "description": "Optional board name for PCB create/open flows."},
                    "focus": {"type": "boolean", "description": "When true or omitted, show/focus the panel after opening."},
                    "includeState": {"type": "boolean"}
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
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"},
                    "paneId": {"type": "string"},
                    "panelId": {"type": "string"},
                    "terminalIndex": {"type": "integer", "minimum": 0},
                    "kind": {"type": "string", "description": "docs, web, pcb, or terminal."},
                    "includeState": {"type": "boolean"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "panel_action",
            "description": "Perform a bounded action on a live workspace panel. Web supports navigate/search/reload/back/forward/focus/open/return/screenshot; PCB supports create/refresh/focus/open/return; Docs supports focus/open/close/context. Screenshot focuses the target panel, then saves a native full-screen capture through Snipping.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"},
                    "paneId": {"type": "string"},
                    "panelId": {"type": "string"},
                    "terminalIndex": {"type": "integer", "minimum": 0},
                    "kind": {"type": "string", "description": "docs, web, pcb, or terminal."},
                    "action": {"type": "string", "description": "navigate, search, reload, back, forward, screenshot, create, refresh, focus, open, return, close, or context."},
                    "url": {"type": "string"},
                    "search": {"type": "string"},
                    "query": {"type": "string"},
                    "name": {"type": "string"},
                    "args": {"type": "object", "additionalProperties": true},
                    "includeState": {"type": "boolean"}
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
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"},
                    "verbose": {"type": "boolean", "description": "When true, include root directories, status arrays, idle reasons, and extra terminal details."},
                    "includeState": {"type": "boolean", "description": "When true, include the broader app-control state. Defaults false to keep live routing token-light."}
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
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"},
                    "verbose": {"type": "boolean"},
                    "includeState": {"type": "boolean"}
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
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"},
                    "verbose": {"type": "boolean"},
                    "includeState": {"type": "boolean"}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "queue_todo",
            "description": "Queue a todo/prompt into a workspace terminal queue from the terminal orchestrator. Pass workspaceId or workspaceName plus text/prompt/message/body/title/task. Omit terminal selectors for the next available terminal, or pass terminalIndex, paneId, targetTerminalId, targetThreadId, or targetTerminalName for a specific coding-agent terminal. Optional agent/targetAgentId constrains to claude, codex, or opencode; shell terminals are not queueable. By default this activates the workspace so its queue can receive the item; set openWorkspace=false to avoid switching views.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"},
                    "text": {"type": "string"},
                    "prompt": {"type": "string"},
                    "message": {"type": "string"},
                    "body": {"type": "string"},
                    "title": {"type": "string"},
                    "task": {"type": "string"},
                    "agent": {"type": "string"},
                    "targetAgentId": {"type": "string"},
                    "terminalIndex": {"type": "integer", "minimum": 0},
                    "terminalNumber": {"type": "integer", "minimum": 1},
                    "paneId": {"type": "string"},
                    "targetTerminalId": {"type": "string"},
                    "targetTerminalName": {"type": "string"},
                    "targetThreadId": {"type": "string"},
                    "model": {"type": "string"},
                    "reasoningEffort": {"type": "string"},
                    "speed": {"type": "string"},
                    "openWorkspace": {"type": "boolean"},
                    "openTerminals": {"type": "boolean"},
                    "ensureTerminal": {"type": "boolean"},
                    "terminalCount": {"type": "integer", "minimum": 1},
                    "commandId": {"type": "string"},
                    "verbose": {"type": "boolean", "description": "When true, echo the full queued item and detailed terminal target snapshot. Defaults false."},
                    "includeState": {"type": "boolean", "description": "When true, include broader app-control state. Defaults false."}
                },
                "additionalProperties": true
            }
        }),
        json!({
            "name": "send_todo",
            "description": "Alias for queue_todo. Queue a todo/prompt for workspace terminal dispatch; the existing terminal queue decides when it can send safely.",
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
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"},
                    "agent": {"type": "string", "description": "claude, codex, opencode, shell, terminal, or generic."},
                    "agentType": {"type": "string"},
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
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"},
                    "terminalIndex": {"type": "integer", "minimum": 0},
                    "terminalIndexes": {"type": "array", "items": {"type": "integer", "minimum": 0}},
                    "paneId": {"type": "string"},
                    "paneIds": {"type": "array", "items": {"type": "string"}},
                    "agent": {"type": "string"},
                    "agentType": {"type": "string"},
                    "count": {"type": "integer", "minimum": 1},
                    "all": {"type": "boolean"},
                    "force": {"type": "boolean", "description": "Close busy terminals too. Without force, busy terminals are skipped."},
                    "onlyIdle": {"type": "boolean", "description": "Close only terminals that appear idle."}
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
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"},
                    "terminalIndex": {"type": "integer", "minimum": 0},
                    "paneId": {"type": "string"},
                    "agent": {"type": "string"},
                    "agentType": {"type": "string"}
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
    let mut stream = std::net::TcpStream::connect(context.endpoint.trim())
        .map_err(|error| format!("Unable to connect to app-control bridge: {error}"))?;
    let bridge_timeout_ms = app_control_mcp_tool_timeout_ms(tool).saturating_add(1000);
    let timeout_duration = Duration::from_millis(bridge_timeout_ms);
    let _ = stream.set_read_timeout(Some(timeout_duration));
    let _ = stream.set_write_timeout(Some(timeout_duration));
    let mut request = json!({
        "token": context.token,
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
    if tool == "run_local_script" || tool == "upload_asset" || tool == "download_asset" {
        APP_CONTROL_MCP_SCRIPT_RUN_TIMEOUT_MS
    } else {
        APP_CONTROL_MCP_TIMEOUT_MS
    }
}

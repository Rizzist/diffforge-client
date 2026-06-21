const APP_CONTROL_MCP_REQUEST_EVENT: &str = "forge-app-control-mcp-request";
const APP_CONTROL_MCP_SERVER_NAME: &str = "diffforge-app-control";
const APP_CONTROL_MCP_TIMEOUT_MS: u64 = 20_000;

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

    let request_id = format!("app-control-mcp-{}", counter.fetch_add(1, Ordering::Relaxed));
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

    let response = match timeout(Duration::from_millis(APP_CONTROL_MCP_TIMEOUT_MS), receiver).await {
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
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
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
            "description": "Return the current Diff Forge app view, selected workspace, active workspace, and available navigation targets.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false}
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
            "name": "select_tab",
            "description": "Switch the visible Diff Forge app tab. Supports terminals, files, history, tools, architectures, mcps, assets, audio, tokenomics, snipping, and settings.",
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
            "name": "list_terminals",
            "description": "List workspace terminals, including their slot index, agent type, pane id, thread id, live status, and configured workspace.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspaceId": {"type": "string"},
                    "workspaceName": {"type": "string"}
                },
                "additionalProperties": true
            }
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
        "select_workspace",
        "select_tab",
        "list_terminals",
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
    let timeout_duration = Duration::from_millis(APP_CONTROL_MCP_TIMEOUT_MS + 1000);
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

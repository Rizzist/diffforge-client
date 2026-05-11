use std::{
    collections::HashMap,
    io::{self, BufRead, Write},
    path::PathBuf,
};

use serde_json::{json, Value};

use super::{
    db::REPO_ID,
    kernel::{api_error, api_ok, CoordinationKernel, EventRefs},
    watcher,
};

pub const TOOL_NAMES: &[&str] = &[
    "get_brief",
    "claim_task",
    "post_plan",
    "acquire_lease",
    "renew_lease",
    "release_lease",
    "list_resources",
    "list_active_leases",
    "list_task_dependencies",
    "announce_change",
    "validate_patch",
    "submit_patch",
    "list_workspace_violations",
    "list_workspace_changes",
    "file_watcher_status",
    "watcher_scan",
    "get_slot_status",
    "search_memory",
    "write_memory",
    "db_get_mode",
    "db_classify_sql",
    "db_request_change",
    "db_list_change_requests",
    "db_get_change_request",
    "db_attach_migration_proposal",
    "db_propose_migration",
    "db_request_approval",
    "request_approval",
];

#[derive(Debug, Clone, Default)]
pub struct McpContext {
    pub repo_path: Option<String>,
    pub db_path: Option<String>,
    pub agent_id: Option<String>,
    pub agent_slot_id: Option<String>,
    pub slot_key: Option<String>,
    pub session_id: Option<String>,
    pub task_id: Option<String>,
    pub worktree_id: Option<String>,
    pub worktree_path: Option<String>,
    pub workspace_id: Option<String>,
    pub objective_key: Option<String>,
}

impl McpContext {
    pub fn from_args(args: &[String]) -> Self {
        let mut context = Self::default();
        let mut index = 0usize;
        while index < args.len() {
            let key = args[index].as_str();
            let value = args.get(index + 1).cloned();
            match (key, value) {
                ("--repo-path", Some(value)) => context.repo_path = Some(value),
                ("--db-path", Some(value)) => context.db_path = Some(value),
                ("--agent-id", Some(value)) => context.agent_id = Some(value),
                ("--agent-slot-id", Some(value)) => context.agent_slot_id = Some(value),
                ("--slot-key", Some(value)) => context.slot_key = Some(value),
                ("--session-id", Some(value)) => context.session_id = Some(value),
                ("--task-id", Some(value)) => context.task_id = Some(value),
                ("--worktree-id", Some(value)) => context.worktree_id = Some(value),
                ("--worktree-path", Some(value)) => context.worktree_path = Some(value),
                ("--workspace-id", Some(value)) => context.workspace_id = Some(value),
                ("--objective-key", Some(value)) => context.objective_key = Some(value),
                _ => {}
            }
            index += 2;
        }
        context.apply_env_defaults();
        context
    }

    fn apply_env_defaults(&mut self) {
        set_default_from_env(&mut self.repo_path, &["COORDINATION_REPO_PATH", "DIFFFORGE_REPO_PATH"]);
        set_default_from_env(&mut self.db_path, &["COORDINATION_DB_PATH"]);
        set_default_from_env(
            &mut self.agent_id,
            &["COORDINATION_AGENT_ID", "DIFFFORGE_AGENT_ID", "CLOUD_MCP_AGENT_ID"],
        );
        set_default_from_env(&mut self.agent_slot_id, &["COORDINATION_AGENT_SLOT_ID"]);
        set_default_from_env(&mut self.slot_key, &["COORDINATION_SLOT_KEY"]);
        set_default_from_env(
            &mut self.session_id,
            &["COORDINATION_SESSION_ID", "DIFFFORGE_SESSION_ID", "CLOUD_MCP_SESSION_ID"],
        );
        set_default_from_env(&mut self.task_id, &["COORDINATION_TASK_ID"]);
        set_default_from_env(&mut self.worktree_id, &["COORDINATION_WORKTREE_ID"]);
        set_default_from_env(
            &mut self.worktree_path,
            &["COORDINATION_WORKTREE_PATH", "COORDINATION_AGENT_BRANCH_ROOT"],
        );
        set_default_from_env(&mut self.workspace_id, &["COORDINATION_WORKSPACE_ID", "CLOUD_MCP_WORKSPACE_ID"]);
        set_default_from_env(&mut self.objective_key, &["COORDINATION_OBJECTIVE_KEY"]);
    }
}

fn set_default_from_env(target: &mut Option<String>, keys: &[&str]) {
    if target.as_ref().is_some_and(|value| !value.trim().is_empty()) {
        return;
    }
    for key in keys {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                *target = Some(value);
                return;
            }
        }
    }
}

pub fn run_stdio_server(context: McpContext) -> Result<(), String> {
    record_mcp_client_event(
        &context,
        "mcp_agent_server_started",
        json!({"transport": "stdio"}),
    );

    let stdin = io::stdin();
    let mut reader = io::BufReader::new(stdin.lock());
    let mut stdout = io::stdout();

    while let Some(read_result) = read_rpc_message(&mut reader)? {
        let (request, transport) = match read_result {
            Ok(value) => value,
            Err((transport, message)) => {
                write_rpc_response(
                    &mut stdout,
                    transport,
                    &json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":message}}),
                )?;
                continue;
            }
        };
        let response = handle_json_rpc(&context, request);
        if !response.is_null() {
            write_rpc_response(&mut stdout, transport, &response)?;
        }
    }

    Ok(())
}

#[derive(Clone, Copy)]
enum RpcTransport {
    JsonLine,
    ContentLength,
}

type RpcReadResult = Result<(Value, RpcTransport), (RpcTransport, String)>;

fn read_rpc_message(reader: &mut impl BufRead) -> Result<Option<RpcReadResult>, String> {
    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|error| format!("Unable to read MCP stdin: {error}"))?;
        if bytes == 0 {
            return Ok(None);
        }

        let first_line = trim_line_end(&line);
        if first_line.trim().is_empty() {
            continue;
        }

        if parse_content_length_header(first_line).is_some() || looks_like_header_line(first_line) {
            let mut content_length = parse_content_length_header(first_line);
            loop {
                let mut header = String::new();
                let bytes = reader
                    .read_line(&mut header)
                    .map_err(|error| format!("Unable to read MCP header: {error}"))?;
                if bytes == 0 {
                    return Ok(None);
                }

                let header = trim_line_end(&header);
                if header.is_empty() {
                    break;
                }
                if let Some(value) = parse_content_length_header(header) {
                    content_length = Some(value);
                }
            }

            let Some(content_length) = content_length else {
                return Ok(Some(Err((
                    RpcTransport::ContentLength,
                    "Missing Content-Length header.".to_string(),
                ))));
            };
            let mut buffer = vec![0u8; content_length];
            reader
                .read_exact(&mut buffer)
                .map_err(|error| format!("Unable to read MCP content body: {error}"))?;
            let message = String::from_utf8(buffer)
                .map_err(|error| format!("MCP content body was not valid UTF-8: {error}"))?;
            return Ok(Some(parse_rpc_json(&message, RpcTransport::ContentLength)));
        }

        return Ok(Some(parse_rpc_json(first_line, RpcTransport::JsonLine)));
    }
}

fn write_rpc_response(
    stdout: &mut impl Write,
    transport: RpcTransport,
    response: &Value,
) -> Result<(), String> {
    let text = response.to_string();
    match transport {
        RpcTransport::JsonLine => {
            writeln!(stdout, "{text}")
                .map_err(|error| format!("Unable to write MCP JSON-line response: {error}"))?;
        }
        RpcTransport::ContentLength => {
            write!(
                stdout,
                "Content-Length: {}\r\n\r\n{}",
                text.as_bytes().len(),
                text
            )
            .map_err(|error| format!("Unable to write MCP framed response: {error}"))?;
        }
    }
    stdout.flush().ok();
    Ok(())
}

fn parse_rpc_json(message: &str, transport: RpcTransport) -> RpcReadResult {
    serde_json::from_str(message)
        .map(|value| (value, transport))
        .map_err(|error| (transport, format!("Parse error: {error}")))
}

fn parse_content_length_header(line: &str) -> Option<usize> {
    let (name, value) = line.split_once(':')?;
    if !name.trim().eq_ignore_ascii_case("content-length") {
        return None;
    }
    value.trim().parse::<usize>().ok()
}

fn looks_like_header_line(line: &str) -> bool {
    line.contains(':') && !line.trim_start().starts_with('{')
}

fn trim_line_end(line: &str) -> &str {
    line.trim_end_matches(['\r', '\n'])
}

fn handle_json_rpc(context: &McpContext, request: Value) -> Value {
    let id_value = request.get("id").cloned();
    let id = id_value.clone().unwrap_or(Value::Null);
    let method = request["method"].as_str().unwrap_or("");
    if id_value.is_none() && method.starts_with("notifications/") {
        return Value::Null;
    }
    match method {
        "initialize" => {
            record_mcp_client_event(
                context,
                "mcp_agent_client_initialized",
                json!({
                    "method": "initialize",
                    "protocol_version": "2024-11-05",
                    "server_name": "diffforge-coordination-kernel",
                }),
            );
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "serverInfo": {"name": "diffforge-coordination-kernel", "version": "0.1.0"},
                    "capabilities": {"tools": {}}
                }
            })
        }
        "tools/list" => {
            record_mcp_client_event(
                context,
                "mcp_agent_tools_listed",
                json!({
                    "method": "tools/list",
                    "tool_count": TOOL_NAMES.len(),
                    "tools": TOOL_NAMES,
                }),
            );
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "tools": TOOL_NAMES.iter().map(|name| json!({
                        "name": name,
                        "description": format!("Diffforge local coordination tool: {name}"),
                        "inputSchema": {"type": "object", "additionalProperties": true}
                    })).collect::<Vec<_>>()
                }
            })
        }
        "tools/call" => {
            let params = &request["params"];
            let name = params["name"].as_str().unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let result = dispatch_tool(context, name, args);
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
        "ping" => json!({"jsonrpc":"2.0","id":id,"result":{}}),
        _ => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Method not found"}}),
    }
}

fn record_mcp_client_event(context: &McpContext, event_type: &str, details: Value) {
    if context.agent_id.is_none()
        && context.agent_slot_id.is_none()
        && context.session_id.is_none()
        && context.slot_key.is_none()
    {
        return;
    }

    let Some(repo_path) = context.repo_path.as_deref() else {
        return;
    };
    let db_path = context.db_path.as_deref().map(PathBuf::from);
    let Ok(kernel) = CoordinationKernel::open(repo_path, db_path) else {
        return;
    };
    let actor_id = context.agent_id.as_deref().unwrap_or(REPO_ID);
    let _ = kernel.emit_event(
        event_type,
        "agent_mcp_client",
        actor_id,
        EventRefs {
            task_id: context.task_id.clone(),
            agent_id: context.agent_id.clone(),
            agent_slot_id: context.agent_slot_id.clone(),
            session_id: context.session_id.clone(),
            ..EventRefs::default()
        },
        json!({
            "slot_key": context.slot_key.clone(),
            "worktree_id": context.worktree_id.clone(),
            "worktree_path": context.worktree_path.clone(),
            "workspace_id": context.workspace_id.clone(),
            "objective_key": context.objective_key.clone(),
            "details": details,
        }),
    );
}

pub fn dispatch_tool(context: &McpContext, tool: &str, mut input: Value) -> Value {
    if !TOOL_NAMES.contains(&tool) {
        record_mcp_client_event(
            context,
            "mcp_agent_tool_failed",
            json!({
                "method": "tools/call",
                "tool": tool,
                "ok": false,
                "error_code": "unknown_tool",
            }),
        );
        return api_error(
            "unknown_tool",
            format!("Unknown coordination tool: {tool}"),
            json!({"allowed_tools": TOOL_NAMES}),
        );
    }
    apply_context_defaults(context, &mut input);
    let result = match dispatch_tool_result(context, tool, input) {
        Ok(value) => value,
        Err(error) => api_error("tool_failed", error, json!({"tool": tool})),
    };
    let ok = result["ok"].as_bool() != Some(false);
    record_mcp_client_event(
        context,
        if ok {
            "mcp_agent_tool_called"
        } else {
            "mcp_agent_tool_failed"
        },
        json!({
            "method": "tools/call",
            "tool": tool,
            "ok": ok,
            "error_code": result["error"]["code"].as_str(),
        }),
    );
    result
}

fn dispatch_tool_result(context: &McpContext, tool: &str, mut input: Value) -> Result<Value, String> {
    let Some(repo_path) = input["repo_path"].as_str().or(context.repo_path.as_deref()) else {
        return Ok(api_error(
            "missing_repo_path",
            "repo_path is required.",
            json!({}),
        ));
    };
    let db_path = input["db_path"]
        .as_str()
        .or(context.db_path.as_deref())
        .map(PathBuf::from);
    let kernel = match CoordinationKernel::open(repo_path, db_path) {
        Ok(kernel) => kernel,
        Err(error) => return Ok(api_error("kernel_open_failed", error, json!({}))),
    };
    apply_live_session_defaults(&kernel, &mut input);
    match tool {
        "get_brief" => kernel.get_brief(
            input["agent_id"].as_str(),
            input["session_id"].as_str(),
            input["task_id"].as_str(),
            None,
        ),
        "claim_task" => kernel.claim_task(
            req(&input, "task_id")?,
            req(&input, "agent_id")?,
            req(&input, "session_id")?,
        ),
        "post_plan" => kernel.post_plan(
            req(&input, "task_id")?,
            req(&input, "agent_id")?,
            req(&input, "session_id")?,
            req(&input, "plan")?,
        ),
        "acquire_lease" | "db_acquire_lease" => kernel.acquire_lease(
            req(&input, "task_id")?,
            req(&input, "agent_id")?,
            req(&input, "session_id")?,
            req(&input, "resource_key")?,
            input["mode"].as_str().unwrap_or("write"),
            input["ttl_seconds"].as_i64(),
            input["reason"].as_str(),
        ),
        "renew_lease" => kernel.renew_lease(
            req(&input, "lease_id")?,
            input["fence_token"].as_i64().unwrap_or(0),
            input["ttl_seconds"].as_i64(),
        ),
        "release_lease" => kernel.release_lease(
            req(&input, "lease_id")?,
            input["fence_token"].as_i64().unwrap_or(0),
        ),
        "list_resources" => kernel.list_resources(
            input["resource_type"].as_str(),
            input["min_risk_level"].as_i64(),
        ),
        "list_active_leases" => kernel.list_active_leases(
            input["task_id"].as_str(),
            input["agent_id"].as_str(),
            input["resource_key"].as_str(),
        ),
        "list_task_dependencies" => kernel.list_task_dependencies(input["task_id"].as_str()),
        "announce_change" => kernel.announce_change(
            req(&input, "task_id")?,
            req(&input, "agent_id")?,
            req(&input, "session_id")?,
            input["paths"]
                .as_array()
                .map(|values| strings(values))
                .unwrap_or_default(),
            input["summary"].as_str(),
        ),
        "validate_patch" => kernel.validate_patch(
            req(&input, "task_id")?,
            req(&input, "agent_id")?,
            req(&input, "session_id")?,
            input["worktree_id"].as_str(),
            input["summary"].as_str(),
        ),
        "submit_patch" => kernel.submit_patch(
            req(&input, "task_id")?,
            req(&input, "agent_id")?,
            req(&input, "session_id")?,
            input["worktree_id"].as_str(),
            input["summary"].as_str(),
        ),
        "list_workspace_violations" => kernel.list_workspace_violations(
            input["task_id"].as_str(),
            input["agent_id"].as_str(),
            input["session_id"].as_str(),
            input["worktree_id"].as_str(),
            input["status"].as_str().or(Some("open")),
        ),
        "list_workspace_changes" => kernel.list_workspace_changes(
            input["task_id"].as_str(),
            input["agent_id"].as_str(),
            input["session_id"].as_str(),
            input["worktree_id"].as_str(),
            input["resource_key"].as_str(),
            input["limit"].as_i64(),
        ),
        "file_watcher_status" => watcher::file_watcher_status(&kernel),
        "watcher_scan" => watcher::scan_known_violations(&kernel),
        "get_slot_status" => {
            kernel.get_slot_status(input["agent_slot_id"].as_str(), input["slot_key"].as_str())
        }
        "search_memory" => kernel.search_memory(
            input["query"].as_str(),
            input["memory_kind"].as_str(),
            input["trust_level"].as_str(),
        ),
        "write_memory" => kernel.write_memory(
            req(&input, "memory_kind")?,
            req(&input, "title")?,
            req(&input, "body")?,
            input["trust_level"].as_str(),
            input["task_id"].as_str(),
            input["evidence_artifact_id"].as_str(),
            input["context_run_id"].as_str(),
            input["agent_id"].as_str(),
            None,
        ),
        "write_contract_memory" => kernel.write_contract_memory(&input),
        "write_handoff_memory" => kernel.write_handoff_memory(&input),
        "db_get_mode" => kernel.db_get_mode(),
        "db_classify_sql" => kernel.db_classify_sql(req(&input, "sql")?),
        "db_request_change" => kernel.db_request_change(&input),
        "db_list_change_requests" => {
            kernel.db_list_change_requests(input["status"].as_str(), input["task_id"].as_str())
        }
        "db_get_change_request" => {
            kernel.db_get_change_request(req(&input, "db_change_request_id")?)
        }
        "db_propose_migration" | "db_attach_migration_proposal" => kernel.db_propose_migration(
            req(&input, "task_id")?,
            req(&input, "agent_id")?,
            req(&input, "session_id")?,
            req(&input, "migration_name")?,
            input["engine"].as_str().unwrap_or("unknown"),
            req(&input, "up_sql")?,
            input["down_sql_or_rollforward_plan"]
                .as_str()
                .or_else(|| input["down_sql_or_rollback_plan"].as_str())
                .unwrap_or("Roll forward manually after review."),
            input["summary"].as_str(),
        ),
        "db_request_approval" if input["db_change_request_id"].as_str().is_some() => kernel
            .db_request_approval(
                req(&input, "db_change_request_id")?,
                req(&input, "agent_id")?,
                input["session_id"].as_str(),
                input["reason"].as_str(),
                input["risk_summary"].as_str(),
            ),
        "request_approval" | "db_request_approval" => kernel.request_approval(
            req(&input, "task_id")?,
            req(&input, "agent_id")?,
            input["session_id"].as_str(),
            req(&input, "approval_kind")?,
            req(&input, "reason")?,
            input["risk_summary"].as_str(),
        ),
        _ => Ok(api_error(
            "unknown_tool",
            format!("Unknown coordination tool: {tool}"),
            json!({}),
        )),
    }
}

fn apply_context_defaults(context: &McpContext, input: &mut Value) {
    let Some(object) = input.as_object_mut() else {
        return;
    };
    let defaults: HashMap<&str, &Option<String>> = HashMap::from([
        ("repo_path", &context.repo_path),
        ("db_path", &context.db_path),
        ("agent_id", &context.agent_id),
        ("agent_slot_id", &context.agent_slot_id),
        ("slot_key", &context.slot_key),
        ("session_id", &context.session_id),
        ("task_id", &context.task_id),
        ("worktree_id", &context.worktree_id),
        ("worktree_path", &context.worktree_path),
        ("workspace_id", &context.workspace_id),
        ("objective_key", &context.objective_key),
    ]);
    for (key, value) in defaults {
        if !object.contains_key(key) {
            if let Some(value) = value {
                object.insert(key.to_string(), Value::String(value.clone()));
            }
        }
    }
}

fn apply_live_session_defaults(kernel: &CoordinationKernel, input: &mut Value) {
    let Some(object) = input.as_object_mut() else {
        return;
    };
    let missing_task_id = object
        .get("task_id")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty());
    let missing_agent_id = object
        .get("agent_id")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty());
    let missing_session_id = object
        .get("session_id")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty());
    if !missing_task_id && !missing_agent_id && !missing_session_id {
        return;
    }

    let session_rows = if let Some(session_id) = object.get("session_id").and_then(Value::as_str) {
        kernel
            .query_json(
                "SELECT * FROM agent_sessions WHERE id=?1 ORDER BY updated_at DESC LIMIT 1",
                &[&session_id],
            )
            .unwrap_or_default()
    } else if let Some(agent_id) = object.get("agent_id").and_then(Value::as_str) {
        kernel
            .query_json(
                "SELECT * FROM agent_sessions WHERE agent_id=?1 AND status='active' ORDER BY updated_at DESC LIMIT 1",
                &[&agent_id],
            )
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let Some(session) = session_rows.first() else {
        return;
    };
    for key in ["agent_id", "session_id", "task_id", "worktree_id"] {
        let missing = object
            .get(key)
            .and_then(Value::as_str)
            .is_none_or(|value| value.trim().is_empty());
        if missing {
            if let Some(value) = session[key].as_str().filter(|value| !value.trim().is_empty()) {
                object.insert(key.to_string(), Value::String(value.to_string()));
            }
        }
    }
}

fn req<'a>(input: &'a Value, key: &str) -> Result<&'a str, String> {
    input[key]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{key} is required."))
}

fn strings(values: &[Value]) -> Vec<String> {
    values
        .iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect()
}

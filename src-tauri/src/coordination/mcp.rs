use std::{
    collections::HashMap,
    fs,
    io::{self, BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex, OnceLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};
use uuid::Uuid;

use super::{
    db::REPO_ID,
    kernel::{api_error, api_ok, CoordinationKernel, EventRefs},
};

pub const TOOL_NAMES: &[&str] = &["start_task", "acquire_lease", "checkpoint", "submit_patch"];
const SHARED_DAEMON_INFO_RELATIVE_PATH: &[&str] = &[".agents", "mcp", "coordination.daemon.json"];
static SHARED_DAEMONS: OnceLock<StdMutex<HashMap<String, SharedMcpDaemonInfo>>> = OnceLock::new();

#[derive(Debug, Clone)]
struct SharedMcpDaemonInfo {
    endpoint: String,
    token: String,
    repo_path: String,
    db_path: String,
    info_path: PathBuf,
    started_at_ms: u64,
    shutdown: Arc<AtomicBool>,
}

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

    fn from_value(value: &Value) -> Self {
        let mut context = Self {
            repo_path: string_field(value, "repo_path"),
            db_path: string_field(value, "db_path"),
            agent_id: string_field(value, "agent_id"),
            agent_slot_id: string_field(value, "agent_slot_id"),
            slot_key: string_field(value, "slot_key"),
            session_id: string_field(value, "session_id"),
            task_id: string_field(value, "task_id"),
            worktree_id: string_field(value, "worktree_id"),
            worktree_path: string_field(value, "worktree_path"),
            workspace_id: string_field(value, "workspace_id"),
            objective_key: string_field(value, "objective_key"),
        };
        context.apply_env_defaults();
        context
    }

    fn to_value(&self) -> Value {
        json!({
            "repo_path": self.repo_path,
            "db_path": self.db_path,
            "agent_id": self.agent_id,
            "agent_slot_id": self.agent_slot_id,
            "slot_key": self.slot_key,
            "session_id": self.session_id,
            "task_id": self.task_id,
            "worktree_id": self.worktree_id,
            "worktree_path": self.worktree_path,
            "workspace_id": self.workspace_id,
            "objective_key": self.objective_key,
        })
    }

    fn apply_env_defaults(&mut self) {
        set_default_from_env(
            &mut self.repo_path,
            &["COORDINATION_REPO_PATH", "DIFFFORGE_REPO_PATH"],
        );
        set_default_from_env(&mut self.db_path, &["COORDINATION_DB_PATH"]);
        set_default_from_env(
            &mut self.agent_id,
            &[
                "COORDINATION_AGENT_ID",
                "DIFFFORGE_AGENT_ID",
                "CLOUD_MCP_AGENT_ID",
            ],
        );
        set_default_from_env(&mut self.agent_slot_id, &["COORDINATION_AGENT_SLOT_ID"]);
        set_default_from_env(&mut self.slot_key, &["COORDINATION_SLOT_KEY"]);
        set_default_from_env(
            &mut self.session_id,
            &[
                "COORDINATION_SESSION_ID",
                "DIFFFORGE_SESSION_ID",
                "CLOUD_MCP_SESSION_ID",
            ],
        );
        set_default_from_env(&mut self.task_id, &["COORDINATION_TASK_ID"]);
        set_default_from_env(&mut self.worktree_id, &["COORDINATION_WORKTREE_ID"]);
        set_default_from_env(
            &mut self.worktree_path,
            &[
                "COORDINATION_WORKTREE_PATH",
                "COORDINATION_AGENT_BRANCH_ROOT",
            ],
        );
        set_default_from_env(
            &mut self.workspace_id,
            &["COORDINATION_WORKSPACE_ID", "CLOUD_MCP_WORKSPACE_ID"],
        );
        set_default_from_env(&mut self.objective_key, &["COORDINATION_OBJECTIVE_KEY"]);
    }
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value[key]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn set_default_from_env(target: &mut Option<String>, keys: &[&str]) {
    if target
        .as_ref()
        .is_some_and(|value| !value.trim().is_empty())
    {
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

fn mcp_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

pub fn daemon_info_path_for_repo(repo_path: impl AsRef<Path>) -> PathBuf {
    let mut path = repo_path.as_ref().to_path_buf();
    for part in SHARED_DAEMON_INFO_RELATIVE_PATH {
        path.push(part);
    }
    path
}

pub fn proxy_args_for_repo(repo_path: impl AsRef<Path>) -> Vec<String> {
    vec![
        "--coordination-mcp-proxy".to_string(),
        "--daemon-info".to_string(),
        daemon_info_path_for_repo(repo_path).display().to_string(),
    ]
}

pub fn ensure_shared_daemon_for_workspace(
    repo_path: impl AsRef<Path>,
    db_path: Option<PathBuf>,
) -> Result<Value, String> {
    let kernel = CoordinationKernel::init(repo_path, db_path)?;
    ensure_shared_daemon_for_paths(&kernel.paths.repo_path, &kernel.paths.db_path)
}

pub fn ensure_shared_daemon_for_paths(repo_path: &Path, db_path: &Path) -> Result<Value, String> {
    let repo_path = repo_path
        .canonicalize()
        .unwrap_or_else(|_| repo_path.to_path_buf());
    let repo_path_text = repo_path.display().to_string();
    let db_path_text = db_path.display().to_string();
    let key = shared_daemon_registry_key(&repo_path_text);

    let daemons = SHARED_DAEMONS.get_or_init(|| StdMutex::new(HashMap::new()));
    let existing = {
        let guard = daemons
            .lock()
            .map_err(|_| "Unable to lock shared MCP daemon registry.".to_string())?;
        guard.get(&key).cloned()
    };
    if let Some(info) = existing {
        write_shared_daemon_info_file(&info)?;
        return Ok(shared_daemon_info_value(&info, false));
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Unable to bind shared coordination MCP daemon: {error}"))?;
    let endpoint = listener
        .local_addr()
        .map_err(|error| format!("Unable to read shared MCP daemon address: {error}"))?
        .to_string();
    let token = Uuid::new_v4().to_string();
    let info_path = daemon_info_path_for_repo(&repo_path);
    let info = SharedMcpDaemonInfo {
        endpoint: endpoint.clone(),
        token: token.clone(),
        repo_path: repo_path_text.clone(),
        db_path: db_path_text.clone(),
        info_path,
        started_at_ms: mcp_now_ms(),
        shutdown: Arc::new(AtomicBool::new(false)),
    };

    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Unable to configure shared MCP daemon listener: {error}"))?;
    let installed = {
        let mut guard = daemons
            .lock()
            .map_err(|_| "Unable to lock shared MCP daemon registry.".to_string())?;
        if let Some(existing) = guard.get(&key).cloned() {
            Some(existing)
        } else {
            guard.insert(key.clone(), info.clone());
            None
        }
    };
    if let Some(existing) = installed {
        write_shared_daemon_info_file(&existing)?;
        return Ok(shared_daemon_info_value(&existing, false));
    }

    if let Err(error) = write_shared_daemon_info_file(&info) {
        if let Ok(mut guard) = daemons.lock() {
            if guard
                .get(&key)
                .is_some_and(|current| current.token == info.token)
            {
                guard.remove(&key);
            }
        }
        return Err(error);
    }

    let listener_repo_path = repo_path_text.clone();
    let listener_db_path = db_path_text.clone();
    let listener_token = token.clone();
    let listener_shutdown = Arc::clone(&info.shutdown);
    thread::spawn(move || {
        run_shared_daemon_listener(
            listener,
            listener_token,
            listener_repo_path,
            listener_db_path,
            listener_shutdown,
        );
    });

    if let Ok((kernel, _)) = CoordinationKernel::open_for_terminal_launch(
        &repo_path_text,
        Some(PathBuf::from(&db_path_text)),
    ) {
        let _ = kernel.emit_event(
            "mcp_shared_daemon_started",
            "kernel",
            REPO_ID,
            EventRefs::default(),
            json!({
                "endpoint": endpoint,
                "info_path": info.info_path.display().to_string(),
                "repo_path": repo_path_text,
            }),
        );
    }

    let value = shared_daemon_info_value(&info, true);
    Ok(value)
}

pub fn stop_shared_daemon_for_repo(
    repo_path: impl AsRef<Path>,
    reason: &str,
) -> Result<Value, String> {
    let repo_path = repo_path
        .as_ref()
        .canonicalize()
        .unwrap_or_else(|_| repo_path.as_ref().to_path_buf());
    let repo_path_text = repo_path.display().to_string();
    let key = shared_daemon_registry_key(&repo_path_text);
    let daemons = SHARED_DAEMONS.get_or_init(|| StdMutex::new(HashMap::new()));
    let info = {
        let mut guard = daemons
            .lock()
            .map_err(|_| "Unable to lock shared MCP daemon registry.".to_string())?;
        guard.remove(&key)
    };

    if let Some(info) = info {
        stop_shared_daemon_info(info, reason)
    } else {
        let info_path = daemon_info_path_for_repo(&repo_path);
        let info_file_removed = remove_shared_daemon_info_file(&info_path);
        Ok(json!({
            "status": "not_running",
            "stopped": false,
            "reason": reason,
            "repo_path": repo_path_text,
            "info_path": info_path.display().to_string(),
            "info_file_removed": info_file_removed,
        }))
    }
}

pub fn stop_all_shared_daemons(reason: &str) -> Result<Value, String> {
    let daemons = SHARED_DAEMONS.get_or_init(|| StdMutex::new(HashMap::new()));
    let infos = {
        let mut guard = daemons
            .lock()
            .map_err(|_| "Unable to lock shared MCP daemon registry.".to_string())?;
        guard.drain().map(|(_, info)| info).collect::<Vec<_>>()
    };
    let total = infos.len();
    let stopped = infos
        .into_iter()
        .map(|info| stop_shared_daemon_info(info, reason))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(json!({
        "status": "stopped",
        "reason": reason,
        "stopped": stopped.len(),
        "total": total,
        "daemons": stopped,
    }))
}

fn shared_daemon_registry_key(repo_path_text: &str) -> String {
    #[cfg(windows)]
    {
        repo_path_text.to_ascii_lowercase()
    }
    #[cfg(not(windows))]
    {
        repo_path_text.to_string()
    }
}

fn stop_shared_daemon_info(info: SharedMcpDaemonInfo, reason: &str) -> Result<Value, String> {
    info.shutdown.store(true, Ordering::SeqCst);
    let info_file_removed = remove_shared_daemon_info_file(&info.info_path);

    if let Ok(kernel) =
        CoordinationKernel::open(&info.repo_path, Some(PathBuf::from(&info.db_path)))
    {
        let _ = kernel.emit_event(
            "mcp_shared_daemon_stopped",
            "kernel",
            REPO_ID,
            EventRefs::default(),
            json!({
                "endpoint": &info.endpoint,
                "info_path": info.info_path.display().to_string(),
                "reason": reason,
                "repo_path": &info.repo_path,
            }),
        );
    }

    Ok(json!({
        "status": "stopped",
        "stopped": true,
        "endpoint": &info.endpoint,
        "info_path": info.info_path.display().to_string(),
        "info_file_removed": info_file_removed,
        "reason": reason,
        "repo_path": &info.repo_path,
        "started_at_ms": info.started_at_ms,
    }))
}

fn remove_shared_daemon_info_file(path: &Path) -> bool {
    match fs::remove_file(path) {
        Ok(()) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(_) => false,
    }
}

fn shared_daemon_info_value(info: &SharedMcpDaemonInfo, started: bool) -> Value {
    json!({
        "status": "ready",
        "started": started,
        "endpoint": info.endpoint,
        "info_path": info.info_path.display().to_string(),
        "repo_path": info.repo_path,
        "db_path": info.db_path,
        "started_at_ms": info.started_at_ms,
    })
}

fn write_shared_daemon_info_file(info: &SharedMcpDaemonInfo) -> Result<(), String> {
    if let Some(parent) = info.info_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create shared MCP daemon directory: {error}"))?;
    }
    let payload = json!({
        "endpoint": info.endpoint,
        "token": info.token,
        "repo_path": info.repo_path,
        "db_path": info.db_path,
        "pid": std::process::id(),
        "started_at_ms": info.started_at_ms,
        "transport": "tcp-json-line",
    });
    fs::write(&info.info_path, payload.to_string())
        .map_err(|error| format!("Unable to write shared MCP daemon info file: {error}"))
}

fn run_shared_daemon_listener(
    listener: TcpListener,
    token: String,
    repo_path: String,
    db_path: String,
    shutdown: Arc<AtomicBool>,
) {
    while !shutdown.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                if stream.set_nonblocking(false).is_err() {
                    continue;
                }
                let token = token.clone();
                let repo_path = repo_path.clone();
                let db_path = db_path.clone();
                thread::spawn(move || {
                    let _ = handle_shared_daemon_connection(stream, token, repo_path, db_path);
                });
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(_) => break,
        }
    }
}

fn handle_shared_daemon_connection(
    stream: TcpStream,
    token: String,
    repo_path: String,
    db_path: String,
) -> Result<(), String> {
    let reader_stream = stream
        .try_clone()
        .map_err(|error| format!("Unable to clone shared MCP daemon stream: {error}"))?;
    let mut reader = BufReader::new(reader_stream);
    let mut writer = stream;

    let mut hello_line = String::new();
    if reader
        .read_line(&mut hello_line)
        .map_err(|error| format!("Unable to read shared MCP daemon hello: {error}"))?
        == 0
    {
        return Ok(());
    }
    let hello: Value = serde_json::from_str(hello_line.trim_end())
        .map_err(|error| format!("Shared MCP daemon hello was not JSON: {error}"))?;
    if hello["token"].as_str() != Some(token.as_str()) {
        writeln!(
            writer,
            "{}",
            json!({"ok": false, "error": "invalid shared MCP daemon token"})
        )
        .ok();
        writer.flush().ok();
        return Ok(());
    }

    let mut context = McpContext::from_value(&hello["context"]);
    if context.repo_path.is_none() {
        context.repo_path = Some(repo_path);
    }
    if context.db_path.is_none() {
        context.db_path = Some(db_path);
    }
    record_mcp_client_event_async(
        &context,
        "mcp_agent_daemon_connection_opened",
        json!({"transport": "stdio_proxy_tcp", "daemon": "shared"}),
    );
    writeln!(writer, "{}", json!({"ok": true}))
        .map_err(|error| format!("Unable to write shared MCP daemon hello response: {error}"))?;
    writer.flush().ok();

    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|error| format!("Unable to read shared MCP daemon request: {error}"))?;
        if bytes == 0 {
            return Ok(());
        }
        let envelope: Value = match serde_json::from_str(line.trim_end()) {
            Ok(value) => value,
            Err(error) => {
                writeln!(
                    writer,
                    "{}",
                    json!({"id": Value::Null, "response": {"jsonrpc": "2.0", "id": Value::Null, "error": {"code": -32700, "message": format!("Proxy envelope parse error: {error}")}}})
                )
                .ok();
                writer.flush().ok();
                continue;
            }
        };
        let request = envelope["request"].clone();
        let response = handle_json_rpc(&context, request);
        writeln!(
            writer,
            "{}",
            json!({"id": envelope["id"].clone(), "response": response})
        )
        .map_err(|error| format!("Unable to write shared MCP daemon response: {error}"))?;
        writer.flush().ok();
    }
}

pub fn run_shared_daemon_stdio_proxy(args: Vec<String>) -> Result<(), String> {
    let context = McpContext::from_args(&args);
    record_mcp_client_event_async(
        &context,
        "mcp_agent_server_started",
        json!({"transport": "stdio_proxy", "daemon": "shared"}),
    );

    let daemon_info_path = parse_arg_value(&args, "--daemon-info")
        .map(PathBuf::from)
        .or_else(|| context.repo_path.as_deref().map(daemon_info_path_for_repo))
        .ok_or_else(|| "Shared MCP proxy requires --daemon-info or --repo-path.".to_string())?;
    let daemon_info_text = fs::read_to_string(&daemon_info_path).map_err(|error| {
        format!(
            "Unable to read shared MCP daemon info {}: {error}",
            daemon_info_path.display()
        )
    })?;
    let daemon_info: Value = serde_json::from_str(&daemon_info_text)
        .map_err(|error| format!("Shared MCP daemon info was not JSON: {error}"))?;
    let endpoint = daemon_info["endpoint"]
        .as_str()
        .ok_or_else(|| "Shared MCP daemon info has no endpoint.".to_string())?;
    let token = daemon_info["token"]
        .as_str()
        .ok_or_else(|| "Shared MCP daemon info has no token.".to_string())?;

    let stream = TcpStream::connect(endpoint).map_err(|error| {
        format!("Unable to connect to shared MCP daemon at {endpoint}: {error}")
    })?;
    let reader_stream = stream
        .try_clone()
        .map_err(|error| format!("Unable to clone shared MCP proxy stream: {error}"))?;
    let mut daemon_reader = BufReader::new(reader_stream);
    let mut daemon_writer = stream;
    writeln!(
        daemon_writer,
        "{}",
        json!({
            "type": "hello",
            "token": token,
            "context": context.to_value(),
        })
    )
    .map_err(|error| format!("Unable to send shared MCP proxy hello: {error}"))?;
    daemon_writer.flush().ok();

    let mut hello_response = String::new();
    daemon_reader
        .read_line(&mut hello_response)
        .map_err(|error| format!("Unable to read shared MCP proxy hello response: {error}"))?;
    let hello_response: Value = serde_json::from_str(hello_response.trim_end())
        .map_err(|error| format!("Shared MCP proxy hello response was not JSON: {error}"))?;
    if hello_response["ok"].as_bool() != Some(true) {
        return Err(format!(
            "Shared MCP daemon rejected proxy connection: {}",
            hello_response["error"].as_str().unwrap_or("unknown error")
        ));
    }

    let stdin = io::stdin();
    let mut reader = io::BufReader::new(stdin.lock());
    let mut stdout = io::stdout();
    let mut sequence = 0u64;

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

        sequence += 1;
        writeln!(
            daemon_writer,
            "{}",
            json!({"id": sequence, "request": request})
        )
        .map_err(|error| format!("Unable to forward MCP request to shared daemon: {error}"))?;
        daemon_writer.flush().ok();

        let mut response_line = String::new();
        if daemon_reader
            .read_line(&mut response_line)
            .map_err(|error| format!("Unable to read shared daemon MCP response: {error}"))?
            == 0
        {
            return Err("Shared MCP daemon closed the proxy connection.".to_string());
        }
        let envelope: Value = serde_json::from_str(response_line.trim_end())
            .map_err(|error| format!("Shared daemon MCP response was not JSON: {error}"))?;
        let response = envelope["response"].clone();
        if !response.is_null() {
            write_rpc_response(&mut stdout, transport, &response)?;
        }
    }

    Ok(())
}

fn parse_arg_value(args: &[String], key: &str) -> Option<String> {
    args.windows(2)
        .find_map(|items| (items[0] == key).then(|| items[1].clone()))
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
            record_mcp_client_event_async(
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
            record_mcp_client_event_async(
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
                        "description": tool_description(name),
                        "inputSchema": tool_input_schema(name)
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
    let live_session = active_session_for_identity(
        &kernel,
        context.session_id.as_deref(),
        context.agent_slot_id.as_deref(),
        context.slot_key.as_deref(),
        context.agent_id.as_deref(),
    );
    let agent_id = context
        .agent_id
        .clone()
        .or_else(|| session_string_field(live_session.as_ref(), "agent_id"));
    let agent_slot_id = context
        .agent_slot_id
        .clone()
        .or_else(|| session_string_field(live_session.as_ref(), "agent_slot_id"));
    let session_id = context
        .session_id
        .clone()
        .or_else(|| session_string_field(live_session.as_ref(), "id"));
    let task_id = context
        .task_id
        .clone()
        .or_else(|| session_string_field(live_session.as_ref(), "task_id"));
    let worktree_id = context
        .worktree_id
        .clone()
        .or_else(|| session_string_field(live_session.as_ref(), "worktree_id"));
    let worktree_path = context
        .worktree_path
        .clone()
        .or_else(|| session_string_field(live_session.as_ref(), "write_root"));
    let actor_id = agent_id.clone().unwrap_or_else(|| REPO_ID.to_string());
    let _ = kernel.emit_event(
        event_type,
        "agent_mcp_client",
        actor_id.as_str(),
        EventRefs {
            task_id,
            agent_id,
            agent_slot_id,
            session_id,
            ..EventRefs::default()
        },
        json!({
            "slot_key": context.slot_key.clone(),
            "worktree_id": worktree_id,
            "worktree_path": worktree_path,
            "workspace_id": context.workspace_id.clone(),
            "objective_key": context.objective_key.clone(),
            "identity_resolved_from_active_session": live_session.is_some(),
            "details": details,
        }),
    );
}

fn record_mcp_client_event_async(context: &McpContext, event_type: &'static str, details: Value) {
    let context = context.clone();
    thread::spawn(move || {
        record_mcp_client_event(&context, event_type, details);
    });
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

fn dispatch_tool_result(
    context: &McpContext,
    tool: &str,
    mut input: Value,
) -> Result<Value, String> {
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
        "start_task" => kernel_start_task(&kernel, &input),
        "acquire_lease" => kernel_acquire_lease(&kernel, &input),
        "checkpoint" => kernel_checkpoint(&kernel, &input),
        "submit_patch" => kernel_submit_patch(&kernel, &input),
        _ => Ok(api_error(
            "unknown_tool",
            format!("Unknown coordination tool: {tool}"),
            json!({}),
        )),
    }
}

fn kernel_start_task(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let start_plan = optional_start_task_text(input).ok_or_else(|| {
        "start_task requires a short plan explaining what the agent is about to do.".to_string()
    })?;
    let agent_id = input["agent_id"]
        .as_str()
        .filter(|value| !value.trim().is_empty());
    let session_id = input["session_id"]
        .as_str()
        .filter(|value| !value.trim().is_empty());
    let task_id = input["task_id"]
        .as_str()
        .filter(|value| !value.trim().is_empty());
    let input_task_id_is_session_id =
        task_id.is_some_and(|task_id| session_id == Some(task_id.trim()));
    let requested_lane = input["lane"]
        .as_str()
        .filter(|value| !value.trim().is_empty());
    let requested_title = input["title"]
        .as_str()
        .filter(|value| !value.trim().is_empty());
    let local_task_hint = existing_local_task_id_for_start(kernel, task_id, session_id)?;
    let lane = requested_lane.map(str::to_string).or_else(|| {
        local_task_hint.as_deref().and_then(|task_id| {
            kernel
                .query_json(
                    "SELECT assigned_role FROM tasks WHERE id=?1 LIMIT 1",
                    &[&task_id],
                )
                .ok()
                .and_then(|rows| rows.into_iter().next())
                .and_then(|task| task["assigned_role"].as_str().map(str::to_string))
        })
    });
    let task_title = requested_title.map(str::to_string);

    let cloud = match crate::cloud_mcp_forward_agent_start_task(
        input["repo_path"].as_str(),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        agent_id,
        session_id,
        local_task_hint.as_deref(),
        input["worktree_id"].as_str(),
        input["worktree_path"].as_str(),
        lane.as_deref(),
        task_title.as_deref(),
        None,
        &start_plan,
    ) {
        Ok(response) => json!({"ok": true, "response": response}),
        Err(error) => json!({"ok": false, "error": error}),
    };
    let cloud_task_id = cloud["response"]
        .as_object()
        .and_then(|_| cloud_start_task_id(&cloud["response"]));
    let local_start_task_id = cloud_task_id
        .as_deref()
        .or(local_task_hint.as_deref())
        .or(task_id);

    let started = kernel.start_task(
        agent_id,
        session_id,
        local_start_task_id,
        None,
        Some(&start_plan),
        requested_title,
        requested_lane,
    )?;
    if started["ok"].as_bool() == Some(false) {
        return Ok(started);
    }

    let mut data = started["data"].clone();

    if let Some(object) = data.as_object_mut() {
        object.insert("start_plan".to_string(), json!(start_plan));
        object.insert("cloud".to_string(), cloud);
        object.insert(
            "task_id_source".to_string(),
            json!(if cloud_task_id.is_some() {
                "cloud"
            } else if local_task_hint.is_some() {
                "local_existing"
            } else {
                "local_fallback"
            }),
        );
        if input_task_id_is_session_id {
            object.insert("ignored_session_id_task_id".to_string(), json!(true));
        }
    }
    Ok(api_ok(data))
}

fn kernel_acquire_lease(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let task_id = req(input, "task_id")?;
    let agent_id = req(input, "agent_id")?;
    let session_id = req(input, "session_id")?;
    let resource_key = req(input, "resource_key")?;
    let mode = input["mode"].as_str().unwrap_or("write");
    let acquired = kernel.acquire_lease(
        task_id,
        agent_id,
        session_id,
        resource_key,
        mode,
        input["ttl_seconds"].as_i64(),
        input["reason"].as_str(),
    )?;
    let task_intent = input["reason"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            kernel
                .query_json(
                    "SELECT title, body FROM tasks WHERE id=?1 LIMIT 1",
                    &[&task_id],
                )
                .ok()
                .and_then(|rows| rows.into_iter().next())
                .map(|task| {
                    [
                        task["title"].as_str().unwrap_or_default(),
                        task["body"].as_str().unwrap_or_default(),
                    ]
                    .into_iter()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<_>>()
                    .join(": ")
                })
                .filter(|value| !value.trim().is_empty())
        });
    let cloud = match crate::cloud_mcp_forward_agent_acquire_lease(
        input["repo_path"].as_str(),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        Some(agent_id),
        Some(session_id),
        Some(task_id),
        input["worktree_id"].as_str(),
        input["worktree_path"].as_str(),
        resource_key,
        mode,
        task_intent.as_deref(),
        &acquired,
    ) {
        Ok(response) => json!({"ok": true, "response": response}),
        Err(error) => json!({"ok": false, "error": error}),
    };
    let mut response = acquired;
    if let Some(data) = response.get_mut("data").and_then(Value::as_object_mut) {
        data.insert("cloud".to_string(), cloud);
    }
    Ok(response)
}

fn existing_local_task_id_for_start(
    kernel: &CoordinationKernel,
    requested_task_id: Option<&str>,
    session_id: Option<&str>,
) -> Result<Option<String>, String> {
    if let Some(task_id) = requested_task_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if !kernel
            .query_json("SELECT id FROM tasks WHERE id=?1 LIMIT 1", &[&task_id])?
            .is_empty()
        {
            return Ok(Some(task_id.to_string()));
        }
    }

    let Some(session_id) = session_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let session = kernel.query_json(
        "SELECT task_id FROM agent_sessions WHERE id=?1 LIMIT 1",
        &[&session_id],
    )?;
    let task_id = session
        .into_iter()
        .next()
        .and_then(|row| row["task_id"].as_str().map(str::to_string))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(task_id) = task_id else {
        return Ok(None);
    };
    if kernel
        .query_json("SELECT id FROM tasks WHERE id=?1 LIMIT 1", &[&task_id])?
        .is_empty()
    {
        return Ok(None);
    }
    Ok(Some(task_id))
}

fn cloud_start_task_id(response: &Value) -> Option<String> {
    response["task_id"]
        .as_str()
        .or_else(|| response["data"]["task_id"].as_str())
        .or_else(|| response["data"]["task"]["id"].as_str())
        .or_else(|| response["task"]["id"].as_str())
        .or_else(|| response["event"]["task_id"].as_str())
        .or_else(|| response["event"]["task"]["id"].as_str())
        .or_else(|| response["data"]["event"]["task_id"].as_str())
        .or_else(|| response["data"]["event"]["task"]["id"].as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn optional_start_task_text(input: &Value) -> Option<String> {
    [
        "plan",
        "summary",
        "explanation",
        "intent",
        "objective",
        "what_i_will_do",
        "whatIWillDo",
    ]
    .iter()
    .find_map(|key| input.get(*key).and_then(Value::as_str))
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(str::to_string)
}

fn kernel_checkpoint(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let summary = req(input, "summary")?.trim();
    let agent_id = input["agent_id"]
        .as_str()
        .filter(|value| !value.trim().is_empty());
    let session_id = input["session_id"]
        .as_str()
        .filter(|value| !value.trim().is_empty());
    let task_id = input["task_id"]
        .as_str()
        .filter(|value| !value.trim().is_empty());
    let task = task_id
        .and_then(|task_id| {
            kernel
                .query_json(
                    "SELECT id, assigned_role FROM tasks WHERE id=?1 LIMIT 1",
                    &[&task_id],
                )
                .ok()
                .and_then(|rows| rows.into_iter().next())
        })
        .unwrap_or_else(|| json!({}));
    let lane = input["lane"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| task["assigned_role"].as_str());
    let actor_id = agent_id.unwrap_or(REPO_ID);
    let event_id = kernel.emit_event(
        "agent_checkpoint",
        "agent_mcp_client",
        actor_id,
        EventRefs {
            task_id: task_id.map(str::to_string),
            agent_id: agent_id.map(str::to_string),
            session_id: session_id.map(str::to_string),
            ..EventRefs::default()
        },
        json!({
            "summary": summary,
            "lane": lane,
            "source": "coordination-kernel.checkpoint",
        }),
    )?;

    let cloud = match crate::cloud_mcp_forward_agent_checkpoint(
        input["repo_path"].as_str(),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        agent_id,
        session_id,
        task_id,
        input["worktree_id"].as_str(),
        input["worktree_path"].as_str(),
        lane,
        summary,
    ) {
        Ok(response) => json!({"ok": true, "response": response}),
        Err(error) => json!({"ok": false, "error": error}),
    };

    Ok(api_ok(json!({
        "event_id": event_id,
        "summary": summary,
        "cloud": cloud,
    })))
}

fn kernel_submit_patch(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let task_id = req(input, "task_id")?;
    let agent_id = req(input, "agent_id")?;
    let session_id = req(input, "session_id")?;
    let task = kernel
        .query_json(
            "SELECT id, status, assigned_role FROM tasks WHERE id=?1 LIMIT 1",
            &[&task_id],
        )?
        .into_iter()
        .next()
        .unwrap_or_else(|| json!({}));
    let lane = input["lane"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| task["assigned_role"].as_str());
    let submitted = kernel.submit_patch(
        task_id,
        agent_id,
        session_id,
        input["worktree_id"].as_str(),
        input["summary"].as_str(),
    )?;
    let task_after = kernel
        .query_json(
            "SELECT id, status, assigned_role FROM tasks WHERE id=?1 LIMIT 1",
            &[&task_id],
        )
        .ok()
        .and_then(|rows| rows.into_iter().next())
        .unwrap_or_else(|| task.clone());
    let cloud = match crate::cloud_mcp_forward_agent_submit_patch(
        input["repo_path"].as_str(),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        Some(agent_id),
        Some(session_id),
        Some(task_id),
        input["worktree_id"].as_str(),
        input["worktree_path"].as_str(),
        lane,
        input["summary"].as_str(),
        task_after["status"].as_str(),
        &submitted,
    ) {
        Ok(response) => json!({"ok": true, "response": response}),
        Err(error) => json!({"ok": false, "error": error}),
    };
    let mut response = submitted;
    if let Some(data) = response.get_mut("data").and_then(Value::as_object_mut) {
        data.insert("cloud".to_string(), cloud);
    }
    Ok(response)
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

    let session = active_session_for_identity(
        kernel,
        object.get("session_id").and_then(Value::as_str),
        object.get("agent_slot_id").and_then(Value::as_str),
        object.get("slot_key").and_then(Value::as_str),
        object.get("agent_id").and_then(Value::as_str),
    );

    let Some(session) = session.as_ref() else {
        return;
    };
    for (key, session_key) in [
        ("agent_id", "agent_id"),
        ("agent_slot_id", "agent_slot_id"),
        ("session_id", "id"),
        ("task_id", "task_id"),
        ("worktree_id", "worktree_id"),
    ] {
        let missing = object
            .get(key)
            .and_then(Value::as_str)
            .is_none_or(|value| value.trim().is_empty());
        if missing {
            if let Some(value) = session[session_key]
                .as_str()
                .filter(|value| !value.trim().is_empty())
            {
                object.insert(key.to_string(), Value::String(value.to_string()));
            }
        }
    }
    let missing_worktree_path = object
        .get("worktree_path")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty());
    if missing_worktree_path
        && session["worktree_id"]
            .as_str()
            .is_some_and(|value| !value.trim().is_empty())
    {
        if let Some(value) = session["write_root"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
        {
            object.insert(
                "worktree_path".to_string(),
                Value::String(value.to_string()),
            );
        }
    }
}

fn session_string_field(session: Option<&Value>, key: &str) -> Option<String> {
    session
        .and_then(|session| session[key].as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn active_session_for_identity(
    kernel: &CoordinationKernel,
    session_id: Option<&str>,
    agent_slot_id: Option<&str>,
    slot_key: Option<&str>,
    agent_id: Option<&str>,
) -> Option<Value> {
    if let Some(session_id) = clean_identity(session_id) {
        return kernel
            .query_json(
                "SELECT * FROM agent_sessions WHERE id=?1 ORDER BY updated_at DESC LIMIT 1",
                &[&session_id],
            )
            .ok()
            .and_then(|rows| rows.into_iter().next());
    }
    if let Some(agent_slot_id) = clean_identity(agent_slot_id) {
        return kernel
            .query_json(
                "SELECT * FROM agent_sessions WHERE agent_slot_id=?1 AND status='active' ORDER BY updated_at DESC LIMIT 1",
                &[&agent_slot_id],
            )
            .ok()
            .and_then(|rows| rows.into_iter().next());
    }
    if let Some(slot_key) = clean_identity(slot_key) {
        return kernel
            .query_json(
                "SELECT s.* FROM agent_sessions s
                 JOIN agent_slots sl ON sl.id=s.agent_slot_id
                 WHERE sl.slot_key=?1 AND s.status='active'
                 ORDER BY s.updated_at DESC LIMIT 1",
                &[&slot_key],
            )
            .ok()
            .and_then(|rows| rows.into_iter().next());
    }
    if let Some(agent_id) = clean_identity(agent_id) {
        return kernel
            .query_json(
                "SELECT * FROM agent_sessions WHERE agent_id=?1 AND status='active' ORDER BY updated_at DESC LIMIT 1",
                &[&agent_id],
            )
            .ok()
            .and_then(|rows| rows.into_iter().next());
    }
    None
}

fn clean_identity(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn tool_description(name: &str) -> String {
    match name {
        "start_task" => "Start the Cloud-created coordination task for this session. Omit task_id on the first call; Rust mirrors the returned server task_id locally for leases, checkpoints, and patches.".to_string(),
        "acquire_lease" => "Acquire a lease for an already-created task. Use resource_key such as file:index.html, glob:src/**, route:GET /api/users, or db:table:users.".to_string(),
        "checkpoint" => "Send one short summary of what has been done so far. Rust attaches task/session/file context and forwards it to Cloud MCP.".to_string(),
        "submit_patch" => "Submit the current task patch for validation and automatic safe integration when possible.".to_string(),
        _ => format!("Diffforge local coordination tool: {name}"),
    }
}

fn tool_input_schema(name: &str) -> Value {
    match name {
        "start_task" => json!({
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Optional existing server task_id returned by start_task. Omit this on the first call."},
                "plan": {"type": "string", "description": "Required short explanation of what you are about to do before editing."}
            },
            "required": ["plan"],
            "additionalProperties": true
        }),
        "acquire_lease" => json!({
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Existing local task id; defaults to the current session task when available."},
                "resource_key": {"type": "string", "description": "Required normalized resource key, for example file:index.html or glob:src/**. Do not send paths[]."},
                "mode": {"type": "string", "description": "Lease mode, usually write.", "default": "write"},
                "ttl_seconds": {"type": "integer", "description": "Optional lease TTL."},
                "reason": {"type": "string", "description": "Short public reason for the lease."}
            },
            "required": ["resource_key"],
            "additionalProperties": true
        }),
        "checkpoint" => json!({
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One short public summary of what has been done so far."}
            },
            "required": ["summary"],
            "additionalProperties": true
        }),
        "submit_patch" => json!({
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Existing local task id; defaults to the current session task when available."},
                "worktree_id": {"type": "string", "description": "Optional; defaults to the current session worktree when available."},
                "summary": {"type": "string", "description": "Short public summary of the completed changes."}
            },
            "additionalProperties": true
        }),
        _ => json!({"type": "object", "additionalProperties": true}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_start_task_id_accepts_event_response_data_shape() {
        let response = json!({
            "ok": true,
            "data": {
                "task_id": "server-task-123",
                "task": {"id": "server-task-123"}
            }
        });
        assert_eq!(
            cloud_start_task_id(&response).as_deref(),
            Some("server-task-123")
        );
    }

    #[test]
    fn shared_daemon_handles_initialize_for_bound_context() {
        let root =
            std::env::temp_dir().join(format!("diffforge_shared_mcp_test_{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();

        let status = ensure_shared_daemon_for_workspace(&root, None).unwrap();
        assert_eq!(status["status"].as_str(), Some("ready"));

        let info_text = fs::read_to_string(daemon_info_path_for_repo(&root)).unwrap();
        let info: Value = serde_json::from_str(&info_text).unwrap();
        let mut stream = TcpStream::connect(info["endpoint"].as_str().unwrap()).unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());

        writeln!(
            stream,
            "{}",
            json!({
                "type": "hello",
                "token": info["token"].as_str().unwrap(),
                "context": {
                    "repo_path": root.display().to_string(),
                    "db_path": info["db_path"].as_str().unwrap(),
                    "agent_id": "agent-test",
                    "session_id": "session-test"
                }
            })
        )
        .unwrap();
        stream.flush().unwrap();

        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let hello: Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(hello["ok"].as_bool(), Some(true));

        writeln!(
            stream,
            "{}",
            json!({
                "id": 1,
                "request": {
                    "jsonrpc": "2.0",
                    "id": 7,
                    "method": "initialize",
                    "params": {}
                }
            })
        )
        .unwrap();
        stream.flush().unwrap();

        line.clear();
        reader.read_line(&mut line).unwrap();
        let response: Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(response["id"].as_u64(), Some(1));
        assert_eq!(
            response["response"]["result"]["serverInfo"]["name"].as_str(),
            Some("diffforge-coordination-kernel")
        );

        let stopped = stop_shared_daemon_for_repo(&root, "test_cleanup").unwrap();
        assert_eq!(stopped["status"].as_str(), Some("stopped"));
        assert!(!daemon_info_path_for_repo(&root).exists());

        let _ = fs::remove_dir_all(root);
    }
}

fn req<'a>(input: &'a Value, key: &str) -> Result<&'a str, String> {
    input[key]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{key} is required."))
}

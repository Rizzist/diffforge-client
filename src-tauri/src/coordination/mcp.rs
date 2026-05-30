use std::{
    collections::HashMap,
    fs,
    io::{self, BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex, OnceLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Map, Value};
use uuid::Uuid;

use super::{
    db::REPO_ID,
    kernel::{api_error, api_ok, CoordinationKernel, EventRefs},
};

pub const TOOL_NAMES: &[&str] = &[
    "start_task",
    "acquire_lease",
    "checkpoint",
    "complete_task",
    "submit_patch",
    "submit_patch_status",
];
const WORKSPACE_GATEWAY_BUILTIN_TOOLS: &[&str] = &[
    "workspace_mcp__sync_manifest",
    "workspace_mcp__list_servers",
    "workspace_mcp__get_server_status",
    "workspace_mcp__get_server_config",
    "workspace_mcp__write_env_file",
];
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
    pub agent_kind: Option<String>,
    pub agent_slot_id: Option<String>,
    pub slot_key: Option<String>,
    pub session_id: Option<String>,
    pub terminal_launch_epoch: Option<String>,
    pub task_id: Option<String>,
    pub worktree_id: Option<String>,
    pub worktree_path: Option<String>,
    pub workspace_id: Option<String>,
    pub objective_key: Option<String>,
    pub enforcement_mode: Option<String>,
    pub file_authority: Option<String>,
    pub session_mode: Option<String>,
    pub completion_mode: Option<String>,
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
                ("--agent-kind", Some(value)) => context.agent_kind = Some(value),
                ("--agent-slot-id", Some(value)) => context.agent_slot_id = Some(value),
                ("--slot-key", Some(value)) => context.slot_key = Some(value),
                ("--session-id", Some(value)) => context.session_id = Some(value),
                ("--terminal-launch-epoch", Some(value)) => {
                    context.terminal_launch_epoch = Some(value)
                }
                ("--task-id", Some(value)) => context.task_id = Some(value),
                ("--worktree-id", Some(value)) => context.worktree_id = Some(value),
                ("--worktree-path", Some(value)) => context.worktree_path = Some(value),
                ("--workspace-id", Some(value)) => context.workspace_id = Some(value),
                ("--objective-key", Some(value)) => context.objective_key = Some(value),
                ("--enforcement-mode", Some(value)) => context.enforcement_mode = Some(value),
                ("--file-authority", Some(value)) => context.file_authority = Some(value),
                ("--session-mode", Some(value)) => context.session_mode = Some(value),
                ("--completion-mode", Some(value)) => context.completion_mode = Some(value),
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
            agent_kind: string_field(value, "agent_kind"),
            agent_slot_id: string_field(value, "agent_slot_id"),
            slot_key: string_field(value, "slot_key"),
            session_id: string_field(value, "session_id"),
            terminal_launch_epoch: string_field(value, "terminal_launch_epoch"),
            task_id: string_field(value, "task_id"),
            worktree_id: string_field(value, "worktree_id"),
            worktree_path: string_field(value, "worktree_path"),
            workspace_id: string_field(value, "workspace_id"),
            objective_key: string_field(value, "objective_key"),
            enforcement_mode: string_field(value, "enforcement_mode"),
            file_authority: string_field(value, "file_authority"),
            session_mode: string_field(value, "session_mode"),
            completion_mode: string_field(value, "completion_mode"),
        };
        context.apply_env_defaults();
        context
    }

    fn to_value(&self) -> Value {
        json!({
            "repo_path": self.repo_path,
            "db_path": self.db_path,
            "agent_id": self.agent_id,
            "agent_kind": self.agent_kind,
            "agent_slot_id": self.agent_slot_id,
            "slot_key": self.slot_key,
            "session_id": self.session_id,
            "terminal_launch_epoch": self.terminal_launch_epoch,
            "task_id": self.task_id,
            "worktree_id": self.worktree_id,
            "worktree_path": self.worktree_path,
            "workspace_id": self.workspace_id,
            "objective_key": self.objective_key,
            "enforcement_mode": self.enforcement_mode,
            "file_authority": self.file_authority,
            "session_mode": self.session_mode,
            "completion_mode": self.completion_mode,
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
        set_default_from_env(
            &mut self.agent_kind,
            &[
                "COORDINATION_AGENT_KIND",
                "DIFFFORGE_AGENT_KIND",
                "CLOUD_MCP_AGENT_KIND",
            ],
        );
        set_default_from_env(&mut self.agent_slot_id, &["COORDINATION_AGENT_SLOT_ID"]);
        set_default_from_env(&mut self.slot_key, &["COORDINATION_SLOT_KEY"]);
        set_default_from_env(
            &mut self.terminal_launch_epoch,
            &["COORDINATION_TERMINAL_LAUNCH_EPOCH"],
        );
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
        set_default_from_env(&mut self.worktree_path, &["COORDINATION_WORKTREE_PATH"]);
        set_default_from_env(
            &mut self.workspace_id,
            &["COORDINATION_WORKSPACE_ID", "CLOUD_MCP_WORKSPACE_ID"],
        );
        set_default_from_env(&mut self.objective_key, &["COORDINATION_OBJECTIVE_KEY"]);
        set_default_from_env(
            &mut self.enforcement_mode,
            &["COORDINATION_ENFORCEMENT_MODE"],
        );
        set_default_from_env(&mut self.file_authority, &["COORDINATION_FILE_AUTHORITY"]);
        set_default_from_env(&mut self.session_mode, &["COORDINATION_SESSION_MODE"]);
        set_default_from_env(&mut self.completion_mode, &["COORDINATION_COMPLETION_MODE"]);
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

pub fn run_workspace_gateway_stdio_server(context: McpContext) -> Result<(), String> {
    record_mcp_client_event(
        &context,
        "mcp_agent_server_started",
        json!({
            "transport": "stdio",
            "server_name": "diffforge-workspace-mcp-gateway",
            "workspace_id": context.workspace_id,
        }),
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
        let response = handle_workspace_gateway_json_rpc(&context, request);
        if !response.is_null() {
            write_rpc_response(&mut stdout, transport, &response)?;
        }
    }

    Ok(())
}

fn handle_workspace_gateway_json_rpc(context: &McpContext, request: Value) -> Value {
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
                    "server_name": "diffforge-workspace-mcp-gateway",
                }),
            );
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "serverInfo": {"name": "diffforge-workspace-mcp-gateway", "version": "0.1.0"},
                    "capabilities": {"tools": {"listChanged": true}}
                }
            })
        }
        "tools/list" => {
            let tools = workspace_gateway_tools(context);
            let tool_count = tools.len();
            record_mcp_client_event_async(
                context,
                "mcp_agent_tools_listed",
                json!({
                    "method": "tools/list",
                    "server_name": "diffforge-workspace-mcp-gateway",
                    "tool_count": tool_count,
                }),
            );
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {"tools": tools}
            })
        }
        "tools/call" => {
            let params = &request["params"];
            let name = params["name"].as_str().unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let result = workspace_gateway_dispatch_tool(context, name, args);
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": result,
            })
        }
        "notifications/initialized" | "initialized" => Value::Null,
        "ping" => json!({"jsonrpc":"2.0","id":id,"result":{}}),
        _ => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Method not found"}}),
    }
}

fn workspace_gateway_tools(context: &McpContext) -> Vec<Value> {
    let mut tools = WORKSPACE_GATEWAY_BUILTIN_TOOLS
        .iter()
        .map(|name| {
            json!({
                "name": name,
                "description": workspace_gateway_builtin_tool_description(name),
                "inputSchema": workspace_gateway_builtin_tool_input_schema(name),
            })
        })
        .collect::<Vec<_>>();

    let Ok((kernel, workspace_id)) = workspace_gateway_kernel(context) else {
        return tools;
    };
    let Ok(servers) = workspace_gateway_servers(&kernel, &workspace_id) else {
        return tools;
    };

    for server in servers
        .iter()
        .filter(|server| workspace_gateway_server_runtime_enabled(server))
    {
        let server_key = server["server_key"].as_str().unwrap_or_default();
        if server_key.is_empty() {
            continue;
        }
        let child_tools = match workspace_gateway_child_list_tools(server) {
            Ok(child_tools) => {
                let tools = child_tools
                    .iter()
                    .filter_map(|tool| tool["name"].as_str().filter(|value| !value.is_empty()))
                    .map(str::to_string)
                    .collect::<Vec<_>>();
                let _ = kernel.record_workspace_mcp_probe_result(
                    &workspace_id,
                    server_key,
                    "healthy",
                    &format!(
                        "Workspace gateway listed {} tool{} from this MCP.",
                        tools.len(),
                        if tools.len() == 1 { "" } else { "s" }
                    ),
                    Some(json!(tools)),
                );
                child_tools
            }
            Err(error) => {
                let _ = kernel.record_workspace_mcp_probe_result(
                    &workspace_id,
                    server_key,
                    workspace_gateway_connection_error_status(&error),
                    &error,
                    Some(json!([])),
                );
                continue;
            }
        };
        for tool in child_tools {
            let Some(tool_name) = tool["name"].as_str().filter(|value| !value.is_empty()) else {
                continue;
            };
            let name = workspace_gateway_tool_name(server_key, tool_name);
            let server_name = server["name"].as_str().unwrap_or(server_key);
            let description = tool["description"].as_str().unwrap_or("");
            tools.push(json!({
                "name": name,
                "description": if description.is_empty() {
                    format!("{server_name} workspace MCP tool.")
                } else {
                    format!("{server_name}: {description}")
                },
                "inputSchema": tool.get("inputSchema").cloned().unwrap_or_else(|| json!({"type": "object"})),
            }));
        }
    }
    tools
}

pub(crate) fn workspace_gateway_dispatch_tool(
    context: &McpContext,
    tool: &str,
    input: Value,
) -> Value {
    let result = if WORKSPACE_GATEWAY_BUILTIN_TOOLS.contains(&tool) {
        workspace_gateway_builtin_tool(context, tool, input)
    } else {
        workspace_gateway_external_tool(context, tool, input)
    };
    let ok = result["isError"].as_bool() != Some(true);
    record_mcp_client_event(
        context,
        if ok {
            "mcp_agent_tool_called"
        } else {
            "mcp_agent_tool_failed"
        },
        json!({
            "method": "tools/call",
            "server_name": "diffforge-workspace-mcp-gateway",
            "tool": tool,
            "ok": ok,
        }),
    );
    result
}

fn workspace_gateway_builtin_tool(context: &McpContext, tool: &str, input: Value) -> Value {
    match tool {
        "workspace_mcp__sync_manifest" => match workspace_gateway_manifest(context) {
            Ok(manifest) => {
                let text = workspace_gateway_manifest_text(&manifest);
                workspace_gateway_content(json!({
                    "ok": true,
                    "manifest": manifest,
                    "message": text,
                }))
            }
            Err(error) => workspace_gateway_error_content(error),
        },
        "workspace_mcp__list_servers" => match workspace_gateway_manifest(context) {
            Ok(manifest) => workspace_gateway_content(json!({
                "ok": true,
                "generation": manifest["generation"],
                "servers": manifest["servers"],
            })),
            Err(error) => workspace_gateway_error_content(error),
        },
        "workspace_mcp__get_server_status" => match workspace_gateway_manifest(context) {
            Ok(manifest) => {
                let key = input["server_key"].as_str().unwrap_or_default();
                let server = manifest["servers"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|server| server["server_key"].as_str() == Some(key))
                    .cloned();
                match server {
                    Some(server) => workspace_gateway_content(json!({
                        "ok": true,
                        "generation": manifest["generation"],
                        "server": server,
                    })),
                    None => workspace_gateway_error_content(format!(
                        "Unknown workspace MCP server: {key}"
                    )),
                }
            }
            Err(error) => workspace_gateway_error_content(error),
        },
        "workspace_mcp__get_server_config" => {
            match workspace_gateway_get_server_config(context, &input) {
                Ok(config) => workspace_gateway_content(config),
                Err(error) => workspace_gateway_error_content(error),
            }
        }
        "workspace_mcp__write_env_file" => {
            match workspace_gateway_write_env_file(context, &input) {
                Ok(result) => workspace_gateway_content(result),
                Err(error) => workspace_gateway_error_content(error),
            }
        }
        _ => workspace_gateway_error_content(format!("Unknown gateway tool: {tool}")),
    }
}

fn workspace_gateway_external_tool(context: &McpContext, tool: &str, input: Value) -> Value {
    let Some((server_key, child_tool)) = tool.split_once("__") else {
        return workspace_gateway_error_content(format!(
            "Unknown workspace MCP tool `{tool}`. Call workspace_mcp__sync_manifest for the current manifest."
        ));
    };
    let (kernel, workspace_id) = match workspace_gateway_kernel(context) {
        Ok(value) => value,
        Err(error) => return workspace_gateway_error_content(error),
    };
    let server = match workspace_gateway_server_by_key(&kernel, &workspace_id, server_key) {
        Ok(Some(server)) => server,
        Ok(None) => {
            return workspace_gateway_error_content(format!(
                "Workspace MCP `{server_key}` is not installed. Call workspace_mcp__sync_manifest for current MCPs."
            ));
        }
        Err(error) => return workspace_gateway_error_content(error),
    };
    if !workspace_gateway_server_runtime_enabled(&server) {
        return workspace_gateway_error_content(format!(
            "Workspace MCP `{server_key}` is not enabled or configured for this workspace. Call workspace_mcp__sync_manifest for current MCPs."
        ));
    }
    match workspace_gateway_child_call_tool(&server, child_tool, input) {
        Ok(result) => result,
        Err(error) => {
            let _ = kernel.record_workspace_mcp_probe_result(
                &workspace_id,
                server_key,
                workspace_gateway_connection_error_status(&error),
                &error,
                None,
            );
            workspace_gateway_error_content(error)
        }
    }
}

fn workspace_gateway_builtin_tool_description(tool: &str) -> &'static str {
    match tool {
        "workspace_mcp__sync_manifest" => {
            "Refresh the agent's knowledge of enabled workspace MCPs, their namespaces, and config status."
        }
        "workspace_mcp__list_servers" => "List installed workspace MCP servers and runtime status.",
        "workspace_mcp__get_server_status" => "Inspect one workspace MCP server by server_key.",
        "workspace_mcp__get_server_config" => {
            "Read agent-visible workspace MCP configuration. Non-secret values are exposed by default; secret values are redacted unless explicitly enabled for that MCP."
        }
        "workspace_mcp__write_env_file" => {
            "Write agent-visible workspace MCP configuration into an env file without returning secret values in the tool result."
        }
        _ => "Workspace MCP gateway tool.",
    }
}

fn workspace_gateway_builtin_tool_input_schema(tool: &str) -> Value {
    match tool {
        "workspace_mcp__get_server_status" | "workspace_mcp__get_server_config" => json!({
            "type": "object",
            "properties": {
                "server_key": {"type": "string", "description": "The workspace MCP server key."}
            },
            "required": ["server_key"]
        }),
        "workspace_mcp__write_env_file" => json!({
            "type": "object",
            "properties": {
                "server_key": {"type": "string", "description": "The workspace MCP server key."},
                "path": {
                    "type": "string",
                    "description": "Env file path relative to the agent worktree when available. Defaults to .env.local."
                },
                "include_secrets": {
                    "type": "boolean",
                    "description": "Also write secret config values. Requires secret config access to be enabled for the MCP."
                },
                "include_public_aliases": {
                    "type": "boolean",
                    "description": "Also write known public frontend aliases such as NEXT_PUBLIC_APPWRITE_PROJECT_ID. Defaults to true."
                }
            },
            "required": ["server_key"]
        }),
        _ => json!({"type": "object", "properties": {}}),
    }
}

fn workspace_gateway_builtin_server(
    context: &McpContext,
    input: &Value,
) -> Result<(CoordinationKernel, String, String, Value), String> {
    let server_key = input["server_key"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "server_key is required.".to_string())?;
    let (kernel, workspace_id) = workspace_gateway_kernel(context)?;
    let generation = workspace_gateway_generation(&kernel, &workspace_id)?;
    let server = workspace_gateway_server_by_key(&kernel, &workspace_id, server_key)?
        .ok_or_else(|| format!("Unknown workspace MCP server: {server_key}"))?;
    Ok((kernel, workspace_id, generation, server))
}

fn workspace_gateway_get_server_config(
    context: &McpContext,
    input: &Value,
) -> Result<Value, String> {
    let (_kernel, workspace_id, generation, server) =
        workspace_gateway_builtin_server(context, input)?;
    if !workspace_gateway_agent_config_access_enabled(&server) {
        return Err(format!(
            "Agent config access is disabled for workspace MCP `{}`.",
            server["server_key"].as_str().unwrap_or("unknown")
        ));
    }
    let reveal_secrets = workspace_gateway_agent_secret_config_access_enabled(&server);
    let variables = workspace_gateway_config_variables(&server, reveal_secrets);
    Ok(json!({
        "ok": true,
        "workspace_id": workspace_id,
        "generation": generation,
        "server": workspace_gateway_server_public(&server),
        "access": workspace_gateway_config_access_summary(&server),
        "variables": variables,
        "env_file": {
            "write_enabled": workspace_gateway_agent_env_file_write_enabled(&server),
            "default_path": ".env.local",
            "include_public_aliases_by_default": true,
            "secret_values_are_redacted_unless_enabled": true
        },
    }))
}

fn workspace_gateway_write_env_file(context: &McpContext, input: &Value) -> Result<Value, String> {
    let (_kernel, workspace_id, generation, server) =
        workspace_gateway_builtin_server(context, input)?;
    if !workspace_gateway_agent_config_access_enabled(&server) {
        return Err(format!(
            "Agent config access is disabled for workspace MCP `{}`.",
            server["server_key"].as_str().unwrap_or("unknown")
        ));
    }
    if !workspace_gateway_agent_env_file_write_enabled(&server) {
        return Err(format!(
            "Env file writes are disabled for workspace MCP `{}`.",
            server["server_key"].as_str().unwrap_or("unknown")
        ));
    }
    let include_secrets = input["include_secrets"].as_bool().unwrap_or(false);
    if include_secrets && !workspace_gateway_agent_secret_config_access_enabled(&server) {
        return Err(format!(
            "Secret config access is disabled for workspace MCP `{}`; refusing to write secret values.",
            server["server_key"].as_str().unwrap_or("unknown")
        ));
    }
    let include_public_aliases = input["include_public_aliases"].as_bool().unwrap_or(true);
    let target = workspace_gateway_env_file_path(context, input["path"].as_str())?;
    let updates =
        workspace_gateway_env_file_updates(&server, include_secrets, include_public_aliases);
    if updates.is_empty() {
        return Err("No configured MCP values are available to write.".to_string());
    }
    workspace_gateway_write_env_updates(&target, &updates)?;
    let written = updates
        .iter()
        .map(|update| {
            json!({
                "key": update.key,
                "source_key": update.source_key,
                "secret": update.secret,
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "ok": true,
        "workspace_id": workspace_id,
        "generation": generation,
        "server_key": server["server_key"],
        "path": target.display().to_string(),
        "written": written,
        "secret_values_returned": false,
    }))
}

fn workspace_gateway_config_access_summary(server: &Value) -> Value {
    json!({
        "non_secret_config_read_enabled": workspace_gateway_agent_config_access_enabled(server),
        "secret_config_read_enabled": workspace_gateway_agent_secret_config_access_enabled(server),
        "env_file_write_enabled": workspace_gateway_agent_env_file_write_enabled(server),
    })
}

fn workspace_gateway_agent_config_access_enabled(server: &Value) -> bool {
    server["agent_config_access_enabled"].as_i64().unwrap_or(1) != 0
}

fn workspace_gateway_agent_secret_config_access_enabled(server: &Value) -> bool {
    server["agent_secret_config_access_enabled"]
        .as_i64()
        .unwrap_or_default()
        != 0
}

fn workspace_gateway_agent_env_file_write_enabled(server: &Value) -> bool {
    server["agent_env_file_write_enabled"].as_i64().unwrap_or(1) != 0
}

fn workspace_gateway_config_variables(server: &Value, reveal_secrets: bool) -> Vec<Value> {
    server["env_schema_json"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let key = entry["key"].as_str()?.trim();
            if key.is_empty() {
                return None;
            }
            let secret = entry["secret"].as_bool().unwrap_or(false);
            let value = workspace_gateway_config_value(&server["config_values_json"], key);
            let public_alias = (!secret)
                .then(|| workspace_gateway_public_env_alias(key))
                .flatten();
            Some(json!({
                "key": key,
                "label": entry["label"].as_str().unwrap_or(key),
                "required": entry["required"].as_bool().unwrap_or(false),
                "secret": secret,
                "available": value.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "value": if secret && !reveal_secrets {
                    Value::Null
                } else {
                    value.clone().map(Value::String).unwrap_or(Value::Null)
                },
                "redacted": secret && !reveal_secrets && value.is_some(),
                "public_env_alias": public_alias,
            }))
        })
        .collect()
}

#[derive(Debug, Clone)]
struct WorkspaceGatewayEnvUpdate {
    key: String,
    source_key: String,
    value: String,
    secret: bool,
}

fn workspace_gateway_env_file_updates(
    server: &Value,
    include_secrets: bool,
    include_public_aliases: bool,
) -> Vec<WorkspaceGatewayEnvUpdate> {
    let mut updates = Vec::new();
    for entry in server["env_schema_json"].as_array().into_iter().flatten() {
        let Some(key) = entry["key"]
            .as_str()
            .map(str::trim)
            .filter(|key| !key.is_empty())
        else {
            continue;
        };
        let secret = entry["secret"].as_bool().unwrap_or(false);
        if secret && !include_secrets {
            continue;
        }
        let Some(value) = workspace_gateway_config_value(&server["config_values_json"], key)
            .filter(|value| !value.trim().is_empty())
        else {
            continue;
        };
        updates.push(WorkspaceGatewayEnvUpdate {
            key: key.to_string(),
            source_key: key.to_string(),
            value: value.clone(),
            secret,
        });
        if include_public_aliases && !secret {
            if let Some(alias) =
                workspace_gateway_public_env_alias(key).filter(|alias| alias != key)
            {
                updates.push(WorkspaceGatewayEnvUpdate {
                    key: alias,
                    source_key: key.to_string(),
                    value,
                    secret: false,
                });
            }
        }
    }
    updates
}

fn workspace_gateway_public_env_alias(key: &str) -> Option<String> {
    let key = key.trim();
    if key.starts_with("NEXT_PUBLIC_") {
        return Some(key.to_string());
    }
    match key {
        "APPWRITE_ENDPOINT" => Some("NEXT_PUBLIC_APPWRITE_ENDPOINT".to_string()),
        "APPWRITE_PROJECT_ID" => Some("NEXT_PUBLIC_APPWRITE_PROJECT_ID".to_string()),
        _ => None,
    }
}

fn workspace_gateway_env_file_path(
    context: &McpContext,
    requested: Option<&str>,
) -> Result<PathBuf, String> {
    let base = context
        .worktree_path
        .as_deref()
        .or(context.repo_path.as_deref())
        .map(PathBuf::from)
        .ok_or_else(|| {
            "Workspace MCP gateway needs a repo or worktree path to write env files.".to_string()
        })?;
    let requested = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(".env.local");
    if requested.contains('\0') {
        return Err("Env file path contains an invalid NUL byte.".to_string());
    }
    let requested_path = PathBuf::from(requested);
    let target = if requested_path.is_absolute() {
        requested_path
    } else {
        if requested_path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            return Err("Env file path cannot contain `..`.".to_string());
        }
        base.join(requested_path)
    };
    let base_canonical = base.canonicalize().map_err(|error| {
        format!(
            "Unable to resolve env file base {}: {error}",
            base.display()
        )
    })?;
    let parent = target
        .parent()
        .ok_or_else(|| "Env file path must have a parent directory.".to_string())?;
    if !parent.exists() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Unable to create env file directory {}: {error}",
                parent.display()
            )
        })?;
    }
    let parent_canonical = parent.canonicalize().map_err(|error| {
        format!(
            "Unable to resolve env file directory {}: {error}",
            parent.display()
        )
    })?;
    if !parent_canonical.starts_with(&base_canonical) {
        return Err(format!(
            "Refusing to write env file outside {}.",
            base_canonical.display()
        ));
    }
    Ok(target)
}

fn workspace_gateway_write_env_updates(
    path: &Path,
    updates: &[WorkspaceGatewayEnvUpdate],
) -> Result<(), String> {
    let existing = fs::read_to_string(path).unwrap_or_default();
    let mut lines = existing.lines().map(str::to_string).collect::<Vec<_>>();
    let mut applied = HashMap::new();
    for update in updates {
        applied.insert(update.key.clone(), false);
    }

    for line in &mut lines {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') || !trimmed.contains('=') {
            continue;
        }
        let Some((raw_key, _)) = trimmed.split_once('=') else {
            continue;
        };
        let key = raw_key.trim();
        if let Some(update) = updates.iter().find(|update| update.key == key) {
            *line = format!(
                "{}={}",
                update.key,
                workspace_gateway_env_escape(&update.value)
            );
            applied.insert(update.key.clone(), true);
        }
    }

    if !lines.is_empty() && lines.last().is_some_and(|line| !line.trim().is_empty()) {
        lines.push(String::new());
    }
    for update in updates {
        if applied.get(&update.key).copied() == Some(true) {
            continue;
        }
        lines.push(format!(
            "{}={}",
            update.key,
            workspace_gateway_env_escape(&update.value)
        ));
    }
    let mut body = lines.join("\n");
    body.push('\n');
    fs::write(path, body).map_err(|error| format!("Unable to write {}: {error}", path.display()))
}

fn workspace_gateway_env_escape(value: &str) -> String {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/' | ':' | '@'))
    {
        return value.to_string();
    }
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    format!("\"{escaped}\"")
}

fn workspace_gateway_kernel(context: &McpContext) -> Result<(CoordinationKernel, String), String> {
    let Some(repo_path) = context.repo_path.as_deref() else {
        return Err("Workspace MCP gateway requires repo_path.".to_string());
    };
    let db_path = context.db_path.as_deref().map(PathBuf::from);
    let kernel = CoordinationKernel::open(repo_path, db_path)?;
    let workspace_id = workspace_gateway_workspace_id(&kernel, context)?;
    Ok((kernel, workspace_id))
}

fn workspace_gateway_workspace_id(
    kernel: &CoordinationKernel,
    context: &McpContext,
) -> Result<String, String> {
    if let Some(workspace_id) = context
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(workspace_id.to_string());
    }
    let rows = kernel.query_json(
        "SELECT workspace_id FROM workspace_mcp_servers
         UNION
         SELECT workspace_id FROM workspace_mcp_marketplaces
         ORDER BY workspace_id ASC",
        &[],
    )?;
    let ids = rows
        .iter()
        .filter_map(|row| row["workspace_id"].as_str())
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>();
    match ids.as_slice() {
        [workspace_id] => Ok((*workspace_id).to_string()),
        [] => Err("No workspace MCP registry exists yet for this repo.".to_string()),
        _ => Err(
            "Multiple workspace MCP registries exist; launch the gateway with --workspace-id."
                .to_string(),
        ),
    }
}

fn workspace_gateway_servers(
    kernel: &CoordinationKernel,
    workspace_id: &str,
) -> Result<Vec<Value>, String> {
    kernel.query_json(
        "SELECT * FROM workspace_mcp_servers
         WHERE workspace_id=?1 AND install_state='installed'
         ORDER BY workspace_enabled DESC, name ASC",
        &[&workspace_id],
    )
}

fn workspace_gateway_server_by_key(
    kernel: &CoordinationKernel,
    workspace_id: &str,
    server_key: &str,
) -> Result<Option<Value>, String> {
    let mut rows = kernel.query_json(
        "SELECT * FROM workspace_mcp_servers
         WHERE workspace_id=?1 AND server_key=?2 AND install_state='installed'
         ORDER BY updated_at DESC LIMIT 1",
        &[&workspace_id, &server_key],
    )?;
    Ok(rows.pop())
}

fn workspace_gateway_generation(
    kernel: &CoordinationKernel,
    workspace_id: &str,
) -> Result<String, String> {
    let rows = kernel.query_json(
        "SELECT MAX(updated_at) AS generation FROM (
            SELECT updated_at FROM workspace_mcp_servers WHERE workspace_id=?1
            UNION ALL
            SELECT updated_at FROM workspace_mcp_marketplaces WHERE workspace_id=?1
            UNION ALL
            SELECT updated_at FROM workspace_mcp_marketplace_indexes WHERE workspace_id=?1
         )",
        &[&workspace_id],
    )?;
    Ok(rows
        .first()
        .and_then(|row| row["generation"].as_str())
        .unwrap_or("0")
        .to_string())
}

fn workspace_gateway_manifest(context: &McpContext) -> Result<Value, String> {
    let (kernel, workspace_id) = workspace_gateway_kernel(context)?;
    let generation = workspace_gateway_generation(&kernel, &workspace_id)?;
    let servers = workspace_gateway_servers(&kernel, &workspace_id)?;
    let public_servers = servers
        .iter()
        .map(workspace_gateway_server_public)
        .collect::<Vec<_>>();
    let enabled_count = public_servers
        .iter()
        .filter(|server| server["runtime_status"].as_str() == Some("enabled"))
        .count();
    let config_required_count = public_servers
        .iter()
        .filter(|server| server["runtime_status"].as_str() == Some("config_required"))
        .count();
    Ok(json!({
        "workspace_id": workspace_id,
        "generation": generation,
        "gateway": {
            "server_name": "diffforge-workspace-mcp-gateway",
            "tool_namespace_separator": "__",
            "hot_reload": "enabled",
        },
        "summary": {
            "installed_count": public_servers.len(),
            "enabled_count": enabled_count,
            "config_required_count": config_required_count,
        },
        "servers": public_servers,
    }))
}

fn workspace_gateway_server_public(server: &Value) -> Value {
    let missing = workspace_gateway_missing_required_config(server);
    let workspace_enabled = server["workspace_enabled"].as_i64().unwrap_or_default() != 0;
    let runtime_status = if !workspace_enabled {
        "disabled"
    } else if !missing.is_empty() {
        "config_required"
    } else if (server["transport"].as_str() == Some("stdio")
        && server["command"]
            .as_str()
            .is_none_or(|value| value.trim().is_empty()))
        || (matches!(
            server["transport"].as_str(),
            Some("http" | "streamable-http")
        ) && server["url"]
            .as_str()
            .is_none_or(|value| value.trim().is_empty()))
    {
        "config_required"
    } else {
        "enabled"
    };
    let server_key = server["server_key"].as_str().unwrap_or_default();
    json!({
        "id": server["id"].clone(),
        "server_key": server_key,
        "name": server["name"].clone(),
        "source_kind": server["source_kind"].clone(),
        "source_label": server["source_label"].clone(),
        "package_ref": server["package_ref"].clone(),
        "transport": server["transport"].clone(),
        "workspace_enabled": workspace_enabled,
        "approval_policy": server["approval_policy"].clone(),
        "agent_config_access_enabled": workspace_gateway_agent_config_access_enabled(server),
        "agent_secret_config_access_enabled": workspace_gateway_agent_secret_config_access_enabled(server),
        "agent_env_file_write_enabled": workspace_gateway_agent_env_file_write_enabled(server),
        "runtime_status": runtime_status,
        "missing_required_config": missing,
        "tool_namespace": server_key,
        "tool_prefix": format!("{server_key}__"),
    })
}

fn workspace_gateway_manifest_text(manifest: &Value) -> String {
    let enabled = manifest["servers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|server| server["runtime_status"].as_str() == Some("enabled"))
        .map(|server| {
            format!(
                "{} under `{}`",
                server["name"].as_str().unwrap_or("Workspace MCP"),
                server["tool_prefix"].as_str().unwrap_or("")
            )
        })
        .collect::<Vec<_>>();
    if enabled.is_empty() {
        return format!(
            "Workspace MCP manifest generation {} is current. No enabled workspace MCPs are available.",
            manifest["generation"].as_str().unwrap_or("0")
        );
    }
    format!(
        "Workspace MCP manifest generation {} is current. Enabled MCPs: {}.",
        manifest["generation"].as_str().unwrap_or("0"),
        enabled.join(", ")
    )
}

fn workspace_gateway_server_runtime_enabled(server: &Value) -> bool {
    server["workspace_enabled"].as_i64().unwrap_or_default() != 0
        && workspace_gateway_missing_required_config(server).is_empty()
        && server["install_state"].as_str().unwrap_or("installed") == "installed"
}

fn workspace_gateway_missing_required_config(server: &Value) -> Vec<Value> {
    server["env_schema_json"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|entry| entry["required"].as_bool() == Some(true))
        .filter_map(|entry| {
            let key = entry["key"].as_str()?.trim();
            if key.is_empty()
                || workspace_gateway_config_value(&server["config_values_json"], key)
                    .is_some_and(|value| !value.trim().is_empty())
            {
                None
            } else {
                Some(json!({
                    "key": key,
                    "label": entry["label"].as_str().unwrap_or(key),
                    "secret": entry["secret"].as_bool().unwrap_or(false),
                }))
            }
        })
        .collect::<Vec<_>>()
}

fn workspace_gateway_config_value(config_values: &Value, key: &str) -> Option<String> {
    let value = config_values.get(key)?;
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    if let Some(object) = value.as_object() {
        return object
            .get("value")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    None
}

pub(super) fn probe_workspace_mcp_server_connection(server: &Value) -> Value {
    match workspace_gateway_child_list_tools(server) {
        Ok(child_tools) => {
            let tools = child_tools
                .iter()
                .filter_map(|tool| tool["name"].as_str().filter(|value| !value.is_empty()))
                .map(str::to_string)
                .collect::<Vec<_>>();
            json!({
                "status": "healthy",
                "message": format!(
                    "Workspace gateway listed {} tool{} from this MCP.",
                    tools.len(),
                    if tools.len() == 1 { "" } else { "s" }
                ),
                "tools": tools,
            })
        }
        Err(error) => json!({
            "status": workspace_gateway_connection_error_status(&error),
            "message": error,
            "tools": [],
        }),
    }
}

fn workspace_gateway_connection_error_status(error: &str) -> &'static str {
    let lower = error.to_ascii_lowercase();
    if lower.contains("unable to start")
        || lower.contains("no such file or directory")
        || lower.contains("os error 2")
        || lower.contains("not found")
    {
        "spawn_failed"
    } else if lower.contains("timed out") || lower.contains("timeout") {
        "timeout"
    } else if lower.contains("closed before")
        || lower.contains("initialize")
        || lower.contains("handshake")
        || lower.contains("parse error")
        || lower.contains("content-length")
        || lower.contains("framed")
    {
        "handshake_failed"
    } else {
        "not_connected"
    }
}

fn workspace_gateway_child_list_tools(server: &Value) -> Result<Vec<Value>, String> {
    let result = workspace_gateway_child_request(server, "tools/list", json!({}))?;
    Ok(result["tools"].as_array().cloned().unwrap_or_default())
}

fn workspace_gateway_child_call_tool(
    server: &Value,
    tool: &str,
    arguments: Value,
) -> Result<Value, String> {
    workspace_gateway_child_request(
        server,
        "tools/call",
        json!({
            "name": tool,
            "arguments": arguments,
        }),
    )
}

fn workspace_gateway_child_request(
    server: &Value,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let timeout = if method == "tools/list" {
        Duration::from_secs(15)
    } else {
        Duration::from_secs(180)
    };
    let transport = server["transport"].as_str().unwrap_or("stdio");
    if transport == "stdio" {
        let mut errors = Vec::new();
        for rpc_transport in [RpcTransport::JsonLine, RpcTransport::ContentLength] {
            match workspace_gateway_child_request_with_timeout(
                server.clone(),
                method.to_string(),
                params.clone(),
                timeout,
                rpc_transport,
            ) {
                Ok(value) => return Ok(value),
                Err(error) => {
                    errors.push(format!("{}: {error}", rpc_transport_label(rpc_transport)));
                }
            }
        }
        return Err(format!(
            "Workspace MCP stdio request `{method}` failed with JSON-line and Content-Length framing. {}",
            errors.join(" | ")
        ));
    }
    workspace_gateway_child_request_with_timeout(
        server.clone(),
        method.to_string(),
        params,
        timeout,
        RpcTransport::ContentLength,
    )
}

fn workspace_gateway_child_request_with_timeout(
    server: Value,
    method: String,
    params: Value,
    timeout: Duration,
    rpc_transport: RpcTransport,
) -> Result<Value, String> {
    let (result_tx, result_rx) = mpsc::channel();
    let (pid_tx, pid_rx) = mpsc::channel();
    let worker_method = method.clone();
    thread::spawn(move || {
        let result = workspace_gateway_child_request_blocking(
            &server,
            &worker_method,
            params,
            pid_tx,
            rpc_transport,
        );
        let _ = result_tx.send(result);
    });
    match result_rx.recv_timeout(timeout) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            if let Ok(pid) = pid_rx.try_recv() {
                terminate_workspace_gateway_child(pid);
            }
            Err(format!(
                "Workspace MCP child timed out while handling `{method}`."
            ))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err(format!("Workspace MCP child request `{method}` failed."))
        }
    }
}

fn workspace_gateway_child_request_blocking(
    server: &Value,
    method: &str,
    params: Value,
    pid_tx: mpsc::Sender<u32>,
    rpc_transport: RpcTransport,
) -> Result<Value, String> {
    let transport = server["transport"].as_str().unwrap_or("stdio");
    if matches!(transport, "http" | "streamable-http") {
        return workspace_gateway_http_request(server, method, params);
    }
    if transport != "stdio" {
        return Err(format!(
            "Workspace MCP gateway supports stdio and streamable HTTP MCPs. `{}` uses `{transport}`.",
            server["name"].as_str().unwrap_or("Workspace MCP")
        ));
    }
    let command = server["command"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "Workspace MCP `{}` has no command configured.",
                server["name"].as_str().unwrap_or("unknown")
            )
        })?;
    let args = server["args_json"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect::<Vec<_>>();
    let mut child = Command::new(command)
        .args(&args)
        .envs(workspace_gateway_child_env(server))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "Unable to start workspace MCP `{}` with `{command}`: {error}",
                server["name"].as_str().unwrap_or(command)
            )
        })?;
    let _ = pid_tx.send(child.id());
    let mut child_stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Workspace MCP child stdin was unavailable.".to_string())?;
    let child_stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Workspace MCP child stdout was unavailable.".to_string())?;
    let stderr_reader = child.stderr.take().map(|stderr| {
        thread::spawn(move || {
            let mut text = String::new();
            let mut reader = BufReader::new(stderr);
            let _ = reader.read_to_string(&mut text);
            text
        })
    });
    let mut child_reader = BufReader::new(child_stdout);
    let result = (|| {
        workspace_gateway_child_send(
            &mut child_stdin,
            &mut child_reader,
            1,
            "initialize",
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "diffforge-workspace-mcp-gateway", "version": "0.1.0"}
            }),
            rpc_transport,
        )?;
        write_rpc_response(
            &mut child_stdin,
            rpc_transport,
            &json!({"jsonrpc":"2.0","method":"notifications/initialized","params":{}}),
        )?;
        workspace_gateway_child_send(
            &mut child_stdin,
            &mut child_reader,
            2,
            method,
            params,
            rpc_transport,
        )
    })();
    let _ = child.kill();
    let _ = child.wait();
    match result {
        Ok(value) => Ok(value),
        Err(error) => Err(workspace_gateway_error_with_stderr(error, stderr_reader)),
    }
}

fn workspace_gateway_error_with_stderr(
    error: String,
    stderr_reader: Option<thread::JoinHandle<String>>,
) -> String {
    let stderr = stderr_reader
        .and_then(|reader| reader.join().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(stderr) = stderr else {
        return error;
    };
    let snippet = if stderr.chars().count() > 1200 {
        format!("{}...", stderr.chars().take(1200).collect::<String>())
    } else {
        stderr
    };
    format!("{error}. Child stderr: {snippet}")
}

fn workspace_gateway_http_request(
    server: &Value,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let url = server["url"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "Workspace MCP `{}` has no HTTP URL configured.",
                server["name"].as_str().unwrap_or("unknown")
            )
        })?
        .to_string();
    let method = method.to_string();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("Unable to create HTTP MCP runtime: {error}"))?;
    runtime.block_on(async move {
        let client = reqwest::Client::new();
        let (initialize, session_id) = workspace_gateway_http_post(
            &client,
            &url,
            None,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "diffforge-workspace-mcp-gateway", "version": "0.1.0"}
                }
            }),
        )
        .await?;
        if !initialize["error"].is_null() {
            return Err(format!(
                "HTTP MCP initialize failed: {}",
                initialize["error"]
            ));
        }
        let _ = workspace_gateway_http_post(
            &client,
            &url,
            session_id.as_deref(),
            json!({"jsonrpc":"2.0","method":"notifications/initialized","params":{}}),
        )
        .await;
        let (response, _) = workspace_gateway_http_post(
            &client,
            &url,
            session_id.as_deref(),
            json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": method,
                "params": params,
            }),
        )
        .await?;
        if !response["error"].is_null() {
            return Err(format!("HTTP MCP request failed: {}", response["error"]));
        }
        Ok(response["result"].clone())
    })
}

async fn workspace_gateway_http_post(
    client: &reqwest::Client,
    url: &str,
    session_id: Option<&str>,
    request: Value,
) -> Result<(Value, Option<String>), String> {
    let mut builder = client
        .post(url)
        .header("accept", "application/json, text/event-stream")
        .header("content-type", "application/json")
        .json(&request);
    if let Some(session_id) = session_id.filter(|value| !value.trim().is_empty()) {
        builder = builder.header("mcp-session-id", session_id);
    }
    let response = builder
        .send()
        .await
        .map_err(|error| format!("Unable to contact HTTP MCP {url}: {error}"))?;
    let status = response.status();
    let next_session_id = response
        .headers()
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response
        .text()
        .await
        .map_err(|error| format!("Unable to read HTTP MCP response: {error}"))?;
    if !status.is_success() {
        return Err(format!("HTTP MCP {url} returned {status}: {body}"));
    }
    if body.trim().is_empty() {
        return Ok((Value::Null, next_session_id));
    }
    let value = workspace_gateway_parse_http_rpc_response(&body)?;
    Ok((value, next_session_id))
}

fn workspace_gateway_parse_http_rpc_response(body: &str) -> Result<Value, String> {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        return Ok(value);
    }
    for line in body.lines() {
        let trimmed = line.trim();
        let Some(data) = trimmed.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" || data.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(data) {
            return Ok(value);
        }
    }
    Err("HTTP MCP response was not JSON or JSON SSE data.".to_string())
}

fn terminate_workspace_gateway_child(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}

fn workspace_gateway_child_send(
    stdin: &mut impl Write,
    reader: &mut impl BufRead,
    id: i64,
    method: &str,
    params: Value,
    transport: RpcTransport,
) -> Result<Value, String> {
    write_rpc_response(
        stdin,
        transport,
        &json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }),
    )?;
    for _ in 0..50 {
        let Some(read) = read_rpc_message(reader)? else {
            return Err(format!("MCP child closed before responding to {method}."));
        };
        let (message, _) = read.map_err(|(_, error)| error)?;
        if message["id"].as_i64() != Some(id) {
            continue;
        }
        if !message["error"].is_null() {
            return Err(format!("MCP child {method} failed: {}", message["error"]));
        }
        return Ok(message["result"].clone());
    }
    Err(format!("MCP child did not answer {method}."))
}

fn workspace_gateway_child_env(server: &Value) -> HashMap<String, String> {
    let mut env = HashMap::new();
    for entry in server["env_schema_json"].as_array().into_iter().flatten() {
        let Some(key) = entry["key"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
        else {
            continue;
        };
        if let Some(value) = workspace_gateway_config_value(&server["config_values_json"], key) {
            env.insert(key.to_string(), value);
        }
    }
    env
}

fn workspace_gateway_tool_name(server_key: &str, tool_name: &str) -> String {
    format!("{server_key}__{tool_name}")
}

fn workspace_gateway_content(value: Value) -> Value {
    json!({
        "content": [{"type": "text", "text": value.to_string()}],
        "isError": value["ok"].as_bool() == Some(false),
    })
}

fn workspace_gateway_error_content(error: impl Into<String>) -> Value {
    workspace_gateway_content(json!({
        "ok": false,
        "error": error.into(),
    }))
}

#[derive(Clone, Copy)]
enum RpcTransport {
    JsonLine,
    ContentLength,
}

fn rpc_transport_label(transport: RpcTransport) -> &'static str {
    match transport {
        RpcTransport::JsonLine => "JSON-line",
        RpcTransport::ContentLength => "Content-Length",
    }
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
    let worktree_path = context.worktree_path.clone().or_else(|| {
        worktree_id
            .as_ref()
            .and_then(|_| session_string_field(live_session.as_ref(), "write_root"))
    });
    let enforcement_mode = context
        .enforcement_mode
        .clone()
        .or_else(|| session_string_field(live_session.as_ref(), "enforcement_mode"));
    let (session_mode, file_authority, completion_mode) = enforcement_mode
        .as_deref()
        .map(coordination_authority_for_enforcement_mode)
        .unwrap_or(("free", "external_unmanaged", "complete_task"));
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
            "terminal_launch_epoch": context.terminal_launch_epoch.clone(),
            "worktree_id": worktree_id,
            "worktree_path": worktree_path,
            "enforcement_mode": enforcement_mode,
            "session_mode": context.session_mode.clone().unwrap_or_else(|| session_mode.to_string()),
            "file_authority": context.file_authority.clone().unwrap_or_else(|| file_authority.to_string()),
            "completion_mode": context.completion_mode.clone().unwrap_or_else(|| completion_mode.to_string()),
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
    let explicit_task_id = value_has_nonempty_string(&input, "task_id");
    if let Some(object) = input.as_object_mut() {
        object.insert(
            "__explicit_task_id_provided".to_string(),
            json!(explicit_task_id),
        );
    }
    apply_context_defaults(context, &mut input);
    if matches!(
        tool,
        "acquire_lease" | "checkpoint" | "complete_task" | "submit_patch"
    ) && !explicit_task_id
    {
        if let Some(object) = input.as_object_mut() {
            object.insert("__explicit_task_id_missing".to_string(), json!(true));
        }
    }
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
    reconnect_mcp_session_if_needed(&kernel, &input, tool)?;
    match tool {
        "start_task" => kernel_start_task(&kernel, &input),
        "acquire_lease" => kernel_acquire_lease(&kernel, &input),
        "checkpoint" => kernel_checkpoint(&kernel, &input),
        "complete_task" => kernel_complete_task(&kernel, &input),
        "submit_patch" => kernel_submit_patch(&kernel, &input),
        "submit_patch_status" => kernel_submit_patch_status(&kernel, &input),
        _ => Ok(api_error(
            "unknown_tool",
            format!("Unknown coordination tool: {tool}"),
            json!({}),
        )),
    }
}

fn reconnect_mcp_session_if_needed(
    kernel: &CoordinationKernel,
    input: &Value,
    tool: &str,
) -> Result<(), String> {
    let Some(agent_id) = input["agent_id"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(());
    };
    let Some(session_id) = input["session_id"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(());
    };
    if session_is_active_for_agent(kernel, session_id, agent_id)? {
        return Ok(());
    }
    let reason = format!("mcp_{tool}_reconnect");
    let _ = kernel.reactivate_interrupted_session_for_agent(
        session_id,
        agent_id,
        input["terminal_launch_epoch"].as_str(),
        &reason,
    )?;
    Ok(())
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
    let explicit_task_id_provided = input["__explicit_task_id_provided"]
        .as_bool()
        .unwrap_or(false);
    let requested_task_is_existing_non_reusable = if input_task_id_is_session_id {
        false
    } else if let Some(task_id) = task_id {
        existing_local_task_status(kernel, task_id)?
            .as_deref()
            .is_some_and(|status| !CoordinationKernel::task_status_allows_start_reuse(status))
    } else {
        false
    };
    let requested_lane = input["lane"]
        .as_str()
        .filter(|value| !value.trim().is_empty());
    let agent_kind = input["agent_kind"]
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

    if let (Some(agent_id), Some(session_id)) = (agent_id, session_id) {
        if !session_is_active_for_agent(kernel, session_id, agent_id)? {
            let reactivated = kernel.reactivate_interrupted_session_for_agent(
                session_id,
                agent_id,
                input["terminal_launch_epoch"].as_str(),
                "mcp_start_task_reconnect",
            )?;
            if reactivated.is_none() && !session_is_active_for_agent(kernel, session_id, agent_id)?
            {
                return Ok(api_error(
                    "mcp_session_inactive_reconnect_required",
                    "This MCP session is no longer active. Reconnect the agent session before starting a task so Cloud and local coordination stay in sync.",
                    json!({
                        "session_id": session_id,
                        "agent_id": agent_id,
                        "contract": "diffforge.app_ws.v1",
                    }),
                ));
            }
        }
    }

    let cloud = match crate::cloud_mcp_forward_agent_start_task(
        input["repo_path"].as_str(),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        input["cloud_mcp_base_url"].as_str(),
        agent_id,
        session_id,
        local_task_hint.as_deref().or_else(|| {
            task_id.and_then(|task_id| {
                (explicit_task_id_provided
                    && !input_task_id_is_session_id
                    && !requested_task_is_existing_non_reusable)
                    .then_some(task_id)
            })
        }),
        input["worktree_id"].as_str(),
        input["worktree_path"].as_str(),
        agent_kind,
        lane.as_deref(),
        task_title.as_deref(),
        None,
        input["session_mode"].as_str(),
        input["file_authority"].as_str(),
        input["enforcement_mode"].as_str(),
        input["completion_mode"].as_str(),
        &start_plan,
    ) {
        Ok(response) => response,
        Err(error) => {
            return Ok(api_error(
                "cloud_start_task_failed",
                "Cloud start_task must return a task_id before Rust creates local task state.",
                json!({"error": error}),
            ))
        }
    };
    let Some(cloud_task_id) = cloud_start_task_id(&cloud) else {
        return Ok(api_error(
            "cloud_start_task_missing_task_id",
            "Cloud start_task did not return a task_id; refusing to create a local task.",
            json!({"cloud": cloud}),
        ));
    };
    let started = kernel.start_task(
        agent_id,
        session_id,
        Some(cloud_task_id.as_str()),
        None,
        Some(&start_plan),
        requested_title,
        requested_lane,
    )?;
    if started["ok"].as_bool() == Some(false) {
        return Ok(started);
    }

    let mut data = started["data"].clone();
    let Some(started_task_id) = data["task_id"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
    else {
        return Ok(api_error(
            "start_task_requires_active_session",
            "start_task must create or reuse a concrete task before leases, checkpoints, or spec sync.",
            json!({}),
        ));
    };
    if started_task_id != cloud_task_id {
        return Ok(api_error(
            "cloud_local_task_id_mismatch",
            "Rust refused to continue because the local task id did not match Cloud start_task.",
            json!({"cloud_task_id": cloud_task_id, "local_task_id": started_task_id}),
        ));
    }

    if let Some(object) = data.as_object_mut() {
        let brief = object
            .get("brief")
            .cloned()
            .map(|brief| start_task_brief_for_agent(&brief))
            .unwrap_or_else(|| json!({}));
        object.insert("brief".to_string(), brief);
        object.insert("start_plan".to_string(), json!(start_plan));
        object.insert("cloud".to_string(), cloud_start_task_for_agent(&cloud));
        object.insert("cloud_task_id".to_string(), json!(cloud_task_id));
        object.insert(
            "task_id_source".to_string(),
            json!(if local_task_hint.is_some() {
                "cloud_confirmed_existing"
            } else if task_id.is_some() {
                "cloud_confirmed_explicit"
            } else {
                "cloud"
            }),
        );
        if input_task_id_is_session_id {
            object.insert("ignored_session_id_task_id".to_string(), json!(true));
        }
    }
    Ok(api_ok(data))
}

fn start_task_brief_for_agent(brief: &Value) -> Value {
    pick_fields(
        brief,
        &[
            "task_dependencies",
            "scheduler",
            "active_leases",
            "pending_approvals",
            "db_change_requests",
            "open_workspace_violations",
        ],
    )
}

fn cloud_start_task_for_agent(response: &Value) -> Value {
    let context_pack = &response["context_pack"];
    let mut view = Map::new();
    view.insert("ok".to_string(), json!(true));
    if let Some(task_id) = cloud_start_task_id(response) {
        view.insert("task_id".to_string(), json!(task_id));
    }
    insert_if_present(
        &mut view,
        "current_work",
        cloud_current_work_for_agent(&context_pack["current_work"]),
    );
    insert_if_present(
        &mut view,
        "peer_work",
        array_map(&context_pack["peers"], cloud_peer_work_for_agent),
    );
    insert_if_present(
        &mut view,
        "lane_conflicts",
        array_map(
            &context_pack["conflicts"]["lanes"],
            cloud_lane_conflict_for_agent,
        ),
    );
    insert_if_present(
        &mut view,
        "context_error",
        pick_fields(context_pack, &["ok", "error", "message"]),
    );
    insert_if_present(
        &mut view,
        "spec_summary",
        cloud_spec_summary_for_agent(&context_pack["spec"]),
    );
    insert_if_present(
        &mut view,
        "spec_graph_summary",
        cloud_spec_graph_summary_for_agent(&response["spec_graph"]),
    );
    insert_if_present(
        &mut view,
        "spec_activity",
        pick_fields(
            &response["spec_activity"],
            &["recorded", "node_ids", "reason", "warnings", "error"],
        ),
    );
    insert_if_present(&mut view, "guidance", context_pack["guidance"].clone());
    Value::Object(view)
}

fn cloud_current_work_for_agent(current_work: &Value) -> Value {
    pick_fields(
        current_work,
        &[
            "status",
            "lane",
            "suggested_lane",
            "summary",
            "claimed_paths",
            "local_task_id",
            "prompt_summary",
        ],
    )
}

fn cloud_peer_work_for_agent(peer: &Value) -> Value {
    pick_fields(
        peer,
        &[
            "agent_id",
            "agent_label",
            "status",
            "lane",
            "progress",
            "claimed_paths",
            "local_task_id",
            "last_seen_at",
        ],
    )
}

fn cloud_lane_conflict_for_agent(conflict: &Value) -> Value {
    pick_fields(
        conflict,
        &["agent_id", "lane", "claimed_paths", "reason", "updated_at"],
    )
}

fn cloud_spec_summary_for_agent(spec: &Value) -> Value {
    pick_fields(
        spec,
        &[
            "nodes",
            "active_specs",
            "warnings",
            "guards",
            "active_agents",
            "candidate_slugs",
        ],
    )
}

fn cloud_spec_graph_summary_for_agent(spec_graph: &Value) -> Value {
    pick_fields(
        spec_graph,
        &[
            "ok",
            "error",
            "message",
            "graph_stats",
            "agent_work",
            "node_count",
        ],
    )
}

fn pick_fields(source: &Value, fields: &[&str]) -> Value {
    let mut view = Map::new();
    if let Some(source) = source.as_object() {
        for field in fields {
            if let Some(value) = source.get(*field) {
                insert_if_present(&mut view, field, value.clone());
            }
        }
    }
    Value::Object(view)
}

fn array_map(source: &Value, mapper: fn(&Value) -> Value) -> Value {
    let values = source
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(mapper)
                .filter(value_has_content)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Value::Array(values)
}

fn insert_if_present(view: &mut Map<String, Value>, key: &str, value: Value) {
    if value_has_content(&value) {
        view.insert(key.to_string(), value);
    }
}

fn value_has_content(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(text) => !text.trim().is_empty(),
        Value::Array(values) => !values.is_empty(),
        Value::Object(values) => !values.is_empty(),
        _ => true,
    }
}

fn kernel_acquire_lease(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    if input["__explicit_task_id_missing"].as_bool() == Some(true) {
        return Ok(api_error(
            "task_id_required_after_start_task",
            "acquire_lease requires the task_id returned by start_task; implicit session task defaults are not allowed for write leases.",
            json!({}),
        ));
    }
    let task_id = req(input, "task_id")?;
    let agent_id = req(input, "agent_id")?;
    let session_id = req(input, "session_id")?;
    if !mcp_start_task_seen_for_task(kernel, task_id, session_id)? {
        return Ok(api_error(
            "start_task_required_before_lease",
            "Call start_task for this session and pass its returned task_id before acquiring a write lease.",
            json!({"task_id": task_id, "session_id": session_id}),
        ));
    }
    let resource_key = req(input, "resource_key")?;
    let file_authority = input["file_authority"].as_str().unwrap_or("none");
    let enforcement_mode = input["enforcement_mode"].as_str().unwrap_or_default();
    let no_local_file_authority = matches!(enforcement_mode, "activity_only" | "remote_unmanaged")
        || matches!(file_authority, "remote_unmanaged" | "external_unmanaged")
        || (file_authority == "none"
            && matches!(enforcement_mode, "activity_only" | "remote_unmanaged"));
    if no_local_file_authority && cloud_file_resource_key(resource_key) {
        return Ok(api_error(
            "no_local_file_authority",
            "This terminal mode has no local file editing authority. Use direct_edit or managed_patch for local file leases, or use complete_task for non-file work.",
            json!({
                "resource_key": resource_key,
                "file_authority": file_authority,
                "enforcement_mode": enforcement_mode,
            }),
        ));
    }
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
        if existing_local_task_status(kernel, task_id)?
            .as_deref()
            .is_some_and(CoordinationKernel::task_status_allows_start_reuse)
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
    if existing_local_task_status(kernel, &task_id)?
        .as_deref()
        .is_some_and(CoordinationKernel::task_status_allows_start_reuse)
    {
        Ok(Some(task_id))
    } else {
        Ok(None)
    }
}

fn existing_local_task_status(
    kernel: &CoordinationKernel,
    task_id: &str,
) -> Result<Option<String>, String> {
    Ok(kernel
        .query_json("SELECT status FROM tasks WHERE id=?1 LIMIT 1", &[&task_id])?
        .into_iter()
        .next()
        .and_then(|task| task["status"].as_str().map(str::to_string)))
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
    if input["__explicit_task_id_missing"].as_bool() == Some(true) {
        return Ok(api_error(
            "task_id_required_after_start_task",
            "checkpoint requires the task_id returned by start_task; implicit session task defaults are not allowed for spec activity.",
            json!({}),
        ));
    }
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
    let Some(task_id) = task_id else {
        return Ok(api_error(
            "checkpoint_requires_active_task",
            "checkpoint is only available after start_task has created an active task. Read-only file inspection does not need tasks or checkpoints.",
            json!({"policy": "read_only_exploration_is_free"}),
        ));
    };
    let task = match kernel
        .query_json(
            "SELECT t.id,
                    t.assigned_role,
                    t.status,
                    t.claimed_session_id,
                    COALESCE(s.status, '') AS claimed_session_status
             FROM tasks t
             LEFT JOIN agent_sessions s ON s.id=t.claimed_session_id
             WHERE t.id=?1
             LIMIT 1",
            &[&task_id],
        )?
        .into_iter()
        .next()
    {
        Some(task) => task,
        None => {
            return Ok(api_error(
                "checkpoint_task_not_found",
                "checkpoint requires an existing active task.",
                json!({"task_id": task_id}),
            ))
        }
    };
    let task_status = task["status"].as_str().unwrap_or_default();
    if matches!(
        task_status,
        "done"
            | "completed"
            | "merged"
            | "cancelled"
            | "interrupted"
            | "skipped"
            | "patch_submitted"
            | "resolved_patch_submitted"
    ) {
        return Ok(api_error(
            "checkpoint_task_not_active",
            "checkpoint is only available while the task is active.",
            json!({"task_id": task_id, "status": task_status}),
        ));
    }
    let claimed_session_id = task["claimed_session_id"].as_str().unwrap_or_default();
    if claimed_session_id.is_empty() {
        return Ok(api_error(
            "checkpoint_task_not_active",
            "checkpoint is only available while the task is claimed by an active session.",
            json!({"task_id": task_id, "status": task_status}),
        ));
    }
    let claimed_session_status = task["claimed_session_status"].as_str().unwrap_or_default();
    if claimed_session_status != "active" {
        return Ok(api_error(
            "checkpoint_task_not_active",
            "checkpoint is only available while the task's claimed session is active.",
            json!({
                "task_id": task_id,
                "status": task_status,
                "claimed_session_id": claimed_session_id,
                "claimed_session_status": claimed_session_status,
            }),
        ));
    }
    if let Some(session_id) = session_id {
        if claimed_session_id != session_id {
            return Ok(api_error(
                "checkpoint_task_claimed_by_another_session",
                "checkpoint cannot be recorded for a task claimed by another session.",
                json!({
                    "task_id": task_id,
                    "claimed_session_id": claimed_session_id,
                    "session_id": session_id,
                }),
            ));
        }
        if !mcp_start_task_seen_for_task(kernel, task_id, session_id)? {
            return Ok(api_error(
                "start_task_required_before_checkpoint",
                "Call start_task for this session and pass its returned task_id before checkpointing.",
                json!({"task_id": task_id, "session_id": session_id}),
            ));
        }
    }
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
            task_id: Some(task_id.to_string()),
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
        Some(task_id),
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

fn kernel_complete_task(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    if input["__explicit_task_id_missing"].as_bool() == Some(true) {
        return Ok(api_error(
            "task_id_required_after_start_task",
            "complete_task requires the task_id returned by start_task; implicit session task defaults are not allowed.",
            json!({}),
        ));
    }
    let task_id = req(input, "task_id")?;
    let agent_id = req(input, "agent_id")?;
    let session_id = req(input, "session_id")?;
    if !mcp_start_task_seen_for_task(kernel, task_id, session_id)? {
        return Ok(api_error(
            "start_task_required_before_complete_task",
            "Call start_task for this session and pass its returned task_id before completing the task.",
            json!({"task_id": task_id, "session_id": session_id}),
        ));
    }
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
    let status = input["status"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let summary = input["summary"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let completed =
        kernel.complete_terminal_task(task_id, agent_id, session_id, status, summary)?;
    if completed["ok"].as_bool() == Some(false) {
        return Ok(completed);
    }
    let completed_status = completed["data"]["status"]
        .as_str()
        .or(status)
        .or(Some("done"));
    let cloud = match crate::cloud_mcp_forward_agent_complete_task(
        input["repo_path"].as_str(),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        Some(agent_id),
        Some(session_id),
        Some(task_id),
        lane,
        summary,
        completed_status,
        input["session_mode"].as_str(),
        input["file_authority"].as_str(),
        input["enforcement_mode"].as_str(),
        input["completion_mode"].as_str(),
        &completed,
    ) {
        Ok(response) => json!({"ok": true, "response": response}),
        Err(error) => json!({"ok": false, "error": error}),
    };
    let mut response = completed;
    if let Some(data) = response.get_mut("data").and_then(Value::as_object_mut) {
        data.insert("cloud".to_string(), cloud);
    }
    Ok(response)
}

fn kernel_submit_patch(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    if input["__explicit_task_id_missing"].as_bool() == Some(true) {
        return Ok(api_error(
            "task_id_required_after_start_task",
            "submit_patch requires the task_id returned by start_task; implicit session task defaults are not allowed.",
            json!({}),
        ));
    }
    let task_id = req(input, "task_id")?;
    let agent_id = req(input, "agent_id")?;
    let session_id = req(input, "session_id")?;
    let enforcement_mode = input["enforcement_mode"]
        .as_str()
        .unwrap_or("coordination_only");
    if enforcement_mode != "worktree_required" || !value_has_nonempty_string(input, "worktree_id") {
        return Ok(api_error(
            "not_patch_capable",
            "submit_patch is only available from managed patch sessions with an isolated git worktree. Use complete_task for direct, activity, or remote work.",
            json!({
                "enforcement_mode": enforcement_mode,
                "file_authority": input["file_authority"].as_str(),
                "completion_mode": input["completion_mode"].as_str().unwrap_or("complete_task"),
            }),
        ));
    }
    if !mcp_start_task_seen_for_task(kernel, task_id, session_id)? {
        return Ok(api_error(
            "start_task_required_before_submit_patch",
            "Call start_task for this session and pass its returned task_id before submitting a patch.",
            json!({"task_id": task_id, "session_id": session_id}),
        ));
    }
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
    let job = kernel.enqueue_submit_patch_job(
        task_id,
        agent_id,
        session_id,
        input["worktree_id"].as_str(),
        input["summary"].as_str(),
        lane,
        input["client_request_id"].as_str(),
    )?;
    let submit_job_id = job["data"]["submit_job_id"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let reused = job["data"]["reused"].as_bool() == Some(true);
    if !submit_job_id.is_empty() && !reused {
        let repo_path = input["repo_path"].as_str().unwrap_or_default().to_string();
        let db_path = input["db_path"].as_str().map(PathBuf::from);
        let workspace_id = input["workspace_id"].as_str().map(str::to_string);
        let agent_id = agent_id.to_string();
        let session_id = session_id.to_string();
        let task_id = task_id.to_string();
        let worktree_id = input["worktree_id"].as_str().map(str::to_string);
        let worktree_path = input["worktree_path"].as_str().map(str::to_string);
        let lane = lane.map(str::to_string);
        let summary = input["summary"].as_str().map(str::to_string);
        thread::spawn(move || {
            run_submit_patch_job_worker(
                submit_job_id,
                repo_path,
                db_path,
                workspace_id,
                agent_id,
                session_id,
                task_id,
                worktree_id,
                worktree_path,
                lane,
                summary,
            );
        });
    }
    Ok(job)
}

fn run_submit_patch_job_worker(
    submit_job_id: String,
    repo_path: String,
    db_path: Option<PathBuf>,
    workspace_id: Option<String>,
    agent_id: String,
    session_id: String,
    task_id: String,
    worktree_id: Option<String>,
    worktree_path: Option<String>,
    lane: Option<String>,
    summary: Option<String>,
) {
    let kernel = match CoordinationKernel::open(&repo_path, db_path.clone()) {
        Ok(kernel) => kernel,
        Err(error) => {
            eprintln!("submit_patch worker failed to open kernel: {error}");
            return;
        }
    };
    let submitted = match kernel.submit_patch_with_job(
        &task_id,
        &agent_id,
        &session_id,
        worktree_id.as_deref(),
        summary.as_deref(),
        Some(&submit_job_id),
    ) {
        Ok(value) => value,
        Err(error) => {
            let _ = kernel.finish_submit_job_failure(
                &submit_job_id,
                "failed",
                &error,
                Some(&api_error("submit_patch_failed", error.clone(), json!({}))),
            );
            return;
        }
    };

    if submitted["ok"].as_bool() == Some(false) {
        let message = submitted["error"]["message"]
            .as_str()
            .unwrap_or("submit_patch failed")
            .to_string();
        let _ =
            kernel.finish_submit_job_failure(&submit_job_id, "failed", &message, Some(&submitted));
        return;
    }

    let _ = kernel.set_submit_job_phase(
        &submit_job_id,
        "running",
        "cloud_syncing",
        Some("Local patch submission completed; syncing advisory cloud context."),
    );
    let task_after = kernel
        .query_json(
            "SELECT id, status, assigned_role FROM tasks WHERE id=?1 LIMIT 1",
            &[&task_id],
        )
        .ok()
        .and_then(|rows| rows.into_iter().next())
        .unwrap_or_else(|| json!({}));
    let cloud = match crate::cloud_mcp_forward_agent_submit_patch(
        Some(repo_path.as_str()),
        db_path.as_deref(),
        workspace_id.as_deref(),
        Some(agent_id.as_str()),
        Some(session_id.as_str()),
        Some(task_id.as_str()),
        worktree_id.as_deref(),
        worktree_path.as_deref(),
        lane.as_deref(),
        summary.as_deref(),
        task_after["status"].as_str(),
        &submitted,
    ) {
        Ok(response) => json!({"ok": true, "response": response}),
        Err(error) => json!({"ok": false, "error": error}),
    };
    let mut result = submitted;
    if let Some(data) = result.get_mut("data").and_then(Value::as_object_mut) {
        data.insert("cloud".to_string(), cloud);
    }
    let _ = kernel.finish_submit_job_success(&submit_job_id, &result);
}

fn kernel_submit_patch_status(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    kernel.submit_patch_job_status(
        input["submit_job_id"].as_str(),
        input["task_id"].as_str(),
        input["session_id"].as_str(),
    )
}

fn apply_context_defaults(context: &McpContext, input: &mut Value) {
    let Some(object) = input.as_object_mut() else {
        return;
    };
    let defaults: HashMap<&str, &Option<String>> = HashMap::from([
        ("repo_path", &context.repo_path),
        ("db_path", &context.db_path),
        ("agent_id", &context.agent_id),
        ("agent_kind", &context.agent_kind),
        ("agent_slot_id", &context.agent_slot_id),
        ("slot_key", &context.slot_key),
        ("session_id", &context.session_id),
        ("terminal_launch_epoch", &context.terminal_launch_epoch),
        ("task_id", &context.task_id),
        ("worktree_id", &context.worktree_id),
        ("worktree_path", &context.worktree_path),
        ("workspace_id", &context.workspace_id),
        ("objective_key", &context.objective_key),
        ("enforcement_mode", &context.enforcement_mode),
        ("file_authority", &context.file_authority),
        ("session_mode", &context.session_mode),
        ("completion_mode", &context.completion_mode),
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
    let missing_terminal_launch_epoch = object
        .get("terminal_launch_epoch")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty());
    if !missing_task_id
        && !missing_agent_id
        && !missing_session_id
        && !missing_terminal_launch_epoch
    {
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
        ("agent_kind", "agent_kind"),
        ("agent_slot_id", "agent_slot_id"),
        ("session_id", "id"),
        ("terminal_launch_epoch", "terminal_launch_epoch"),
        ("task_id", "task_id"),
        ("worktree_id", "worktree_id"),
        ("enforcement_mode", "enforcement_mode"),
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
    let enforcement_mode = object
        .get("enforcement_mode")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            session["enforcement_mode"]
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .unwrap_or("coordination_only");
    let (session_mode, file_authority, completion_mode) =
        coordination_authority_for_enforcement_mode(enforcement_mode);
    for (key, value) in [
        ("session_mode", session_mode),
        ("file_authority", file_authority),
        ("completion_mode", completion_mode),
    ] {
        let missing = object
            .get(key)
            .and_then(Value::as_str)
            .is_none_or(|value| value.trim().is_empty());
        if missing {
            object.insert(key.to_string(), Value::String(value.to_string()));
        }
    }
}

fn coordination_authority_for_enforcement_mode(
    enforcement_mode: &str,
) -> (&'static str, &'static str, &'static str) {
    match enforcement_mode {
        "worktree_required" => ("managed_patch", "git_worktree_patch", "submit_patch"),
        "bounded_direct_edit" => ("direct_edit", "bounded_direct_edit", "complete_task"),
        "activity_only" => ("activity", "none", "complete_task"),
        "remote_unmanaged" => ("remote_ops", "remote_unmanaged", "complete_task"),
        "read_only" | "coordination_only" => ("activity", "none", "complete_task"),
        _ => ("free", "external_unmanaged", "complete_task"),
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
                "SELECT s.*, COALESCE(sl.agent_kind, a.kind) AS agent_kind
                 FROM agent_sessions s
                 LEFT JOIN agents a ON a.id=s.agent_id
                 LEFT JOIN agent_slots sl ON sl.id=s.agent_slot_id
                 WHERE s.id=?1 AND s.status='active'
                 ORDER BY s.updated_at DESC LIMIT 1",
                &[&session_id],
            )
            .ok()
            .and_then(|rows| rows.into_iter().next());
    }
    if let Some(agent_slot_id) = clean_identity(agent_slot_id) {
        return kernel
            .query_json(
                "SELECT s.*, COALESCE(sl.agent_kind, a.kind) AS agent_kind
                 FROM agent_sessions s
                 LEFT JOIN agents a ON a.id=s.agent_id
                 LEFT JOIN agent_slots sl ON sl.id=s.agent_slot_id
                 WHERE s.agent_slot_id=?1 AND s.status='active'
                 ORDER BY s.updated_at DESC LIMIT 1",
                &[&agent_slot_id],
            )
            .ok()
            .and_then(|rows| rows.into_iter().next());
    }
    if let Some(slot_key) = clean_identity(slot_key) {
        return kernel
            .query_json(
                "SELECT s.*, COALESCE(sl.agent_kind, a.kind) AS agent_kind
                 FROM agent_sessions s
                 JOIN agent_slots sl ON sl.id=s.agent_slot_id
                 LEFT JOIN agents a ON a.id=s.agent_id
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
                "SELECT s.*, COALESCE(sl.agent_kind, a.kind) AS agent_kind
                 FROM agent_sessions s
                 LEFT JOIN agents a ON a.id=s.agent_id
                 LEFT JOIN agent_slots sl ON sl.id=s.agent_slot_id
                 WHERE s.agent_id=?1 AND s.status='active'
                 ORDER BY s.updated_at DESC LIMIT 1",
                &[&agent_id],
            )
            .ok()
            .and_then(|rows| rows.into_iter().next());
    }
    None
}

fn session_is_active_for_agent(
    kernel: &CoordinationKernel,
    session_id: &str,
    agent_id: &str,
) -> Result<bool, String> {
    let rows = kernel.query_json(
        "SELECT status
         FROM agent_sessions
         WHERE id=?1 AND agent_id=?2
         LIMIT 1",
        &[&session_id, &agent_id],
    )?;
    Ok(rows
        .into_iter()
        .next()
        .and_then(|session| session["status"].as_str().map(str::to_string))
        .is_some_and(|status| status == "active"))
}

fn clean_identity(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn value_has_nonempty_string(input: &Value, key: &str) -> bool {
    input[key]
        .as_str()
        .is_some_and(|value| !value.trim().is_empty())
}

fn cloud_file_resource_key(resource_key: &str) -> bool {
    let trimmed = resource_key.trim();
    if trimmed.is_empty() || trimmed.starts_with("route:") || trimmed.starts_with("db:") {
        return false;
    }
    trimmed.starts_with("file:")
        || trimmed.starts_with("glob:")
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('.')
}

fn mcp_start_task_seen_for_task(
    kernel: &CoordinationKernel,
    task_id: &str,
    session_id: &str,
) -> Result<bool, String> {
    let rows = kernel.query_json(
        "SELECT payload_json
         FROM events
         WHERE event_type='mcp_agent_tool_called'
           AND task_id=?1
           AND session_id=?2
         ORDER BY seq DESC
         LIMIT 50",
        &[&task_id, &session_id],
    )?;
    Ok(rows.into_iter().any(|event| {
        event["payload_json"]["details"]["tool"].as_str() == Some("start_task")
            && event["payload_json"]["details"]["ok"].as_bool() != Some(false)
    }))
}

fn tool_description(name: &str) -> String {
    match name {
        "start_task" => "Start the coordination task only after read-only inspection, immediately before active work. Omit task_id on the first call; Cloud must return the task_id before Rust mirrors it locally for leases, checkpoints, patches, or direct/activity completion.".to_string(),
        "acquire_lease" => "Acquire a lease for a task that was explicitly started in this session. You must pass the task_id returned by start_task; implicit session defaults are rejected.".to_string(),
        "checkpoint" => "Send one short summary only while an active started task exists. You must pass the task_id returned by start_task; read-only file inspection should not create checkpoints.".to_string(),
        "complete_task" => "Mark a started direct, activity, or remote task complete without submitting a git worktree patch. You must pass the task_id returned by start_task.".to_string(),
        "submit_patch" => "Queue the current task patch for asynchronous validation and safe local integration. Returns submit_job_id quickly; poll submit_patch_status for progress.".to_string(),
        "submit_patch_status" => "Check an asynchronous submit_patch job by submit_job_id, or the latest submit job for a task.".to_string(),
        _ => format!("Diffforge local coordination tool: {name}"),
    }
}

fn tool_input_schema(name: &str) -> Value {
    match name {
        "start_task" => json!({
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Optional existing task_id when continuing a previously started task. Omit this on the first call."},
                "plan": {"type": "string", "description": "Required short explanation of the edit you are about to make. Do not call start_task for read-only inspection."}
            },
            "required": ["plan"],
            "additionalProperties": true
        }),
        "acquire_lease" => json!({
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Required task_id returned by start_task. Do not rely on implicit session defaults."},
                "resource_key": {"type": "string", "description": "Required normalized resource key, for example file:index.html or glob:src/**. Do not send paths[]."},
                "mode": {"type": "string", "description": "Lease mode, usually write.", "default": "write"},
                "ttl_seconds": {"type": "integer", "description": "Optional lease TTL."},
                "reason": {"type": "string", "description": "Short public reason for the lease."}
            },
            "required": ["task_id", "resource_key"],
            "additionalProperties": true
        }),
        "checkpoint" => json!({
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Required task_id returned by start_task. Do not rely on implicit session defaults."},
                "summary": {"type": "string", "description": "One short public summary of active task progress. Do not call checkpoint before start_task."}
            },
            "required": ["task_id", "summary"],
            "additionalProperties": true
        }),
        "complete_task" => json!({
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Required task_id returned by start_task. Do not rely on implicit session defaults."},
                "summary": {"type": "string", "description": "Short public summary of the completed direct/activity/remote work."},
                "status": {"type": "string", "description": "Optional completion status: done, completed, or skipped.", "default": "done"}
            },
            "required": ["task_id"],
            "additionalProperties": true
        }),
        "submit_patch" => json!({
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Required task_id returned by start_task. Do not rely on implicit session defaults."},
                "worktree_id": {"type": "string", "description": "Optional; defaults to the current session worktree when available."},
                "summary": {"type": "string", "description": "Short public summary of the completed changes."},
                "client_request_id": {"type": "string", "description": "Optional caller-provided idempotency key. Reusing it returns the existing submit job."}
            },
            "required": ["task_id"],
            "additionalProperties": true
        }),
        "submit_patch_status" => json!({
            "type": "object",
            "properties": {
                "submit_job_id": {"type": "string", "description": "Preferred submit_job_id returned by submit_patch."},
                "task_id": {"type": "string", "description": "Fallback: return the latest submit job for this task."}
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
    fn cloud_start_task_agent_view_keeps_peer_and_spec_summary_only() {
        let response = json!({
            "task_id": "task-cloud-1",
            "task": {
                "id": "task-cloud-1",
                "title": "Verbose Cloud task",
                "body": "This full task body should not be echoed to the agent."
            },
            "event": {
                "history": "noisy event payload"
            },
            "spec_activity": {
                "recorded": true,
                "node_ids": ["spec-node-1"],
                "raw": "drop"
            },
            "context_pack": {
                "kind": "cloud_context_pack",
                "identity": {
                    "repo_id": "repo-test",
                    "workspace_id": "workspace-test"
                },
                "current_work": {
                    "status": "active",
                    "lane": "cloud-mcp-context",
                    "suggested_lane": "cloud-mcp-context",
                    "summary": "Trimming start_task payloads.",
                    "local_task_id": "task-cloud-1",
                    "metadata_json": {"drop": true}
                },
                "peers": [{
                    "agent_id": "agent-peer",
                    "agent_label": "Codex 2",
                    "status": "active",
                    "lane": "desktop-ui",
                    "progress": "Updating the terminal toolbar.",
                    "claimed_paths": ["file:src/App.tsx"],
                    "local_task_id": "peer-task",
                    "metadata_json": {"drop": true}
                }],
                "conflicts": {
                    "lanes": [{
                        "agent_id": "agent-peer",
                        "lane": "desktop-ui",
                        "claimed_paths": ["file:src/App.tsx"],
                        "reason": "Editing toolbar",
                        "payload": {"drop": true}
                    }],
                    "spec_warnings": [{"message": "duplicated in spec summary"}]
                },
                "spec": {
                    "nodes": [{"id": "spec-node-1", "title": "Terminal coordination"}],
                    "active_specs": [{"statement": "Agents must use start_task before leases."}],
                    "warnings": [{"message": "A peer may be editing nearby UI."}],
                    "guards": ["Do not edit the shared project root."],
                    "active_agents": [{"agent_id": "agent-peer", "summary": "Toolbar work"}],
                    "candidate_slugs": ["terminal-coordination"]
                },
                "history": {
                    "events": [{"summary": "old noisy history"}]
                },
                "guidance": ["Account for active peers before editing."]
            },
            "spec_graph": {
                "kind": "project_spec_graph",
                "repo_id": "repo-test",
                "workspace_id": "workspace-test",
                "graph_stats": {"node_count": 5},
                "agent_work": {"active": 2},
                "node_count": 5
            }
        });

        let view = cloud_start_task_for_agent(&response);

        assert_eq!(view["ok"].as_bool(), Some(true));
        assert_eq!(view["task_id"].as_str(), Some("task-cloud-1"));
        assert_eq!(
            view["peer_work"][0]["progress"].as_str(),
            Some("Updating the terminal toolbar.")
        );
        assert_eq!(
            view["spec_summary"]["active_specs"][0]["statement"].as_str(),
            Some("Agents must use start_task before leases.")
        );
        assert_eq!(view["spec_graph_summary"]["node_count"].as_u64(), Some(5));
        assert_eq!(view["spec_activity"]["recorded"].as_bool(), Some(true));
        assert!(view.get("event").is_none());
        assert!(view.get("context_pack").is_none());
        assert!(view["peer_work"][0].get("metadata_json").is_none());
        assert!(view["lane_conflicts"][0].get("payload").is_none());
        assert!(view["spec_graph_summary"].get("repo_id").is_none());
    }

    #[test]
    fn checkpoint_without_active_task_is_rejected_before_event() {
        let root =
            std::env::temp_dir().join(format!("diffforge_checkpoint_guard_{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let kernel = CoordinationKernel::init(&root, None).unwrap();

        let result = kernel_checkpoint(
            &kernel,
            &json!({
                "summary": "Inspected files",
                "agent_id": "agent-test",
                "session_id": "session-test",
            }),
        )
        .unwrap();

        assert_eq!(result["ok"].as_bool(), Some(false));
        assert_eq!(
            result["error"]["code"].as_str(),
            Some("checkpoint_requires_active_task")
        );
        let checkpoint_events = kernel
            .query_json(
                "SELECT event_type FROM events WHERE event_type='agent_checkpoint'",
                &[],
            )
            .unwrap();
        assert!(checkpoint_events.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn checkpoint_for_unclaimed_task_is_rejected_before_event() {
        let root =
            std::env::temp_dir().join(format!("diffforge_checkpoint_unclaimed_{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let kernel = CoordinationKernel::init(&root, None).unwrap();
        let task = kernel
            .create_task("Read-only exploration", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_id = task["id"].as_str().unwrap();

        let result = kernel_checkpoint(
            &kernel,
            &json!({
                "summary": "Inspected files",
                "task_id": task_id,
            }),
        )
        .unwrap();

        assert_eq!(result["ok"].as_bool(), Some(false));
        assert_eq!(
            result["error"]["code"].as_str(),
            Some("checkpoint_task_not_active")
        );
        let checkpoint_events = kernel
            .query_json(
                "SELECT event_type FROM events WHERE event_type='agent_checkpoint'",
                &[],
            )
            .unwrap();
        assert!(checkpoint_events.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn submit_patch_rejects_non_worktree_authority_before_patch_queue() {
        let root =
            std::env::temp_dir().join(format!("diffforge_submit_direct_guard_{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let kernel = CoordinationKernel::init(&root, None).unwrap();

        let result = kernel_submit_patch(
            &kernel,
            &json!({
                "task_id": "task-direct",
                "agent_id": "agent-direct",
                "session_id": "session-direct",
                "enforcement_mode": "bounded_direct_edit",
                "file_authority": "bounded_direct_edit",
                "completion_mode": "complete_task",
            }),
        )
        .unwrap();

        assert_eq!(result["ok"].as_bool(), Some(false));
        assert_eq!(result["error"]["code"].as_str(), Some("not_patch_capable"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn activity_file_lease_is_rejected_without_local_file_authority() {
        let root =
            std::env::temp_dir().join(format!("diffforge_activity_file_guard_{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let kernel = CoordinationKernel::init(&root, None).unwrap();
        let agent = kernel
            .create_or_get_agent("Research", "shell", None)
            .unwrap();
        let agent_id = agent["id"].as_str().unwrap();
        let session = kernel
            .create_session(agent_id, None, None, false, None, None)
            .unwrap();
        let session_id = session["id"].as_str().unwrap();
        let task = kernel
            .create_task("Research only", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_id = task["id"].as_str().unwrap();
        kernel.claim_task(task_id, agent_id, session_id).unwrap();
        kernel
            .emit_event(
                "mcp_agent_tool_called",
                "agent_mcp_client",
                agent_id,
                EventRefs {
                    task_id: Some(task_id.to_string()),
                    agent_id: Some(agent_id.to_string()),
                    session_id: Some(session_id.to_string()),
                    ..EventRefs::default()
                },
                json!({"details": {"tool": "start_task", "ok": true}}),
            )
            .unwrap();

        let result = kernel_acquire_lease(
            &kernel,
            &json!({
                "task_id": task_id,
                "agent_id": agent_id,
                "session_id": session_id,
                "resource_key": "file:src/main.rs",
                "file_authority": "none",
                "enforcement_mode": "activity_only",
            }),
        )
        .unwrap();

        assert_eq!(result["ok"].as_bool(), Some(false));
        assert_eq!(
            result["error"]["code"].as_str(),
            Some("no_local_file_authority")
        );

        let _ = fs::remove_dir_all(root);
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

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
    db::{coordination_daemon_info_path, REPO_ID},
    kernel::{api_error, api_ok, CoordinationKernel, EventRefs},
};

pub const TOOL_NAMES: &[&str] = &[
    "start_task",
    "architecture_context",
    "architecture_list",
    "architecture_icon_reference",
    "architecture_revision_list",
    "architecture_revision_read",
    "architecture_revision_restore",
    "list_todo_targets",
    "send_todos",
    "get_todo_status",
    "wait_for_todos",
    "list_todo_history",
    "list_assets",
    "get_asset_root",
    "upload_asset",
    "upload_asset_status",
    "download_asset",
    "download_asset_status",
    "delete_local_asset",
    "delete_cloud_asset",
    "acquire_lease",
    "checkpoint",
    "complete_task",
    "submit_patch",
    "submit_patch_status",
];
const TERMINAL_SESSION_TOOL_NAMES: &[&str] = &[
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
    "workspace_mcp__search_tools",
    "workspace_mcp__list_tools",
    "workspace_mcp__get_tool_schema",
    "workspace_mcp__call_tool",
    "workspace_mcp__get_server_status",
    "workspace_mcp__get_server_config",
    "workspace_mcp__write_env_file",
    "secrets__list",
    "secrets__get",
    "secrets__write_env_file",
];
const WORKSPACE_MCP_EXPOSURE_LAZY: &str = "lazy";
const WORKSPACE_MCP_EXPOSURE_PINNED: &str = "pinned";
const WORKSPACE_MCP_EXPOSURE_HIDDEN: &str = "hidden";
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
    coordination_daemon_info_path(repo_path.as_ref())
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

struct SharedDaemonProxyConnection {
    reader: BufReader<TcpStream>,
    writer: TcpStream,
}

fn shared_daemon_info_path_for_proxy(
    args: &[String],
    context: &McpContext,
) -> Result<PathBuf, String> {
    parse_arg_value(args, "--daemon-info")
        .map(PathBuf::from)
        .or_else(|| context.repo_path.as_deref().map(daemon_info_path_for_repo))
        .ok_or_else(|| "Shared MCP proxy requires --daemon-info or --repo-path.".to_string())
}

fn read_shared_daemon_info(path: &Path) -> Result<Value, String> {
    let daemon_info_text = fs::read_to_string(path).map_err(|error| {
        format!(
            "Unable to read shared MCP daemon info {}: {error}",
            path.display()
        )
    })?;
    serde_json::from_str(&daemon_info_text)
        .map_err(|error| format!("Shared MCP daemon info was not JSON: {error}"))
}

fn ensure_shared_daemon_for_proxy_context(context: &McpContext) -> Result<Value, String> {
    let repo_path = context
        .repo_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Shared MCP proxy self-heal requires --repo-path.".to_string())?;
    if let Some(db_path) = context
        .db_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        ensure_shared_daemon_for_paths(Path::new(repo_path), Path::new(db_path))
    } else {
        ensure_shared_daemon_for_workspace(Path::new(repo_path), None)
    }
}

fn connect_shared_daemon_proxy_from_info(
    context: &McpContext,
    daemon_info: &Value,
) -> Result<SharedDaemonProxyConnection, String> {
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

    Ok(SharedDaemonProxyConnection {
        reader: daemon_reader,
        writer: daemon_writer,
    })
}

fn connect_shared_daemon_stdio_proxy(
    args: &[String],
    context: &McpContext,
) -> Result<SharedDaemonProxyConnection, String> {
    let daemon_info_path = shared_daemon_info_path_for_proxy(args, context)?;
    let first_attempt = read_shared_daemon_info(&daemon_info_path)
        .and_then(|info| connect_shared_daemon_proxy_from_info(context, &info));
    match first_attempt {
        Ok(connection) => Ok(connection),
        Err(first_error) => {
            record_mcp_client_event_async(
                context,
                "mcp_shared_daemon_proxy_self_heal",
                json!({
                    "daemon_info_path": daemon_info_path.display().to_string(),
                    "first_error": first_error,
                }),
            );
            let refreshed = ensure_shared_daemon_for_proxy_context(context)?;
            let refreshed_info_path = refreshed["info_path"]
                .as_str()
                .map(PathBuf::from)
                .unwrap_or(daemon_info_path);
            let refreshed_info = read_shared_daemon_info(&refreshed_info_path)?;
            connect_shared_daemon_proxy_from_info(context, &refreshed_info).map_err(|error| {
                format!(
                    "Unable to connect to shared MCP daemon after self-heal via {}: {error}",
                    refreshed_info_path.display()
                )
            })
        }
    }
}

pub fn run_shared_daemon_stdio_proxy(args: Vec<String>) -> Result<(), String> {
    let context = McpContext::from_args(&args);
    record_mcp_client_event_async(
        &context,
        "mcp_agent_server_started",
        json!({"transport": "stdio_proxy", "daemon": "shared"}),
    );

    let SharedDaemonProxyConnection {
        reader: mut daemon_reader,
        writer: mut daemon_writer,
    } = connect_shared_daemon_stdio_proxy(&args, &context)?;

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
    let secrets_enabled = workspace_gateway_secrets_enabled(context);
    let mut tools = WORKSPACE_GATEWAY_BUILTIN_TOOLS
        .iter()
        .filter(|name| secrets_enabled || !name.starts_with("secrets__"))
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
        .filter(|server| workspace_gateway_server_pinned(server))
    {
        let server_key = server["server_key"].as_str().unwrap_or_default();
        if server_key.is_empty() {
            continue;
        }
        let child_tools =
            match workspace_gateway_refresh_child_tools(&kernel, &workspace_id, server) {
                Ok(child_tools) => child_tools,
                Err(_) => continue,
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

/// The built-in Secrets MCP is opt-in per workspace; its tools disappear
/// from the gateway until the user enables it in the MCPs tab.
fn workspace_gateway_secrets_enabled(context: &McpContext) -> bool {
    workspace_gateway_kernel(context)
        .ok()
        .and_then(|(kernel, workspace_id)| kernel.workspace_mcp_secrets_enabled(&workspace_id).ok())
        .unwrap_or(false)
}

fn workspace_gateway_builtin_tool(context: &McpContext, tool: &str, input: Value) -> Value {
    if tool.starts_with("secrets__") && !workspace_gateway_secrets_enabled(context) {
        return workspace_gateway_error_content(
            "The Secrets MCP is disabled for this workspace. Enable it in the Diff Forge MCPs tab before using secrets tools."
                .to_string(),
        );
    }
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
        "workspace_mcp__search_tools" => match workspace_gateway_search_tools(context, &input) {
            Ok(result) => workspace_gateway_content(result),
            Err(error) => workspace_gateway_error_content(error),
        },
        "workspace_mcp__list_tools" => match workspace_gateway_list_tools(context, &input) {
            Ok(result) => workspace_gateway_content(result),
            Err(error) => workspace_gateway_error_content(error),
        },
        "workspace_mcp__get_tool_schema" => {
            match workspace_gateway_get_tool_schema(context, &input) {
                Ok(result) => workspace_gateway_content(result),
                Err(error) => workspace_gateway_error_content(error),
            }
        }
        "workspace_mcp__call_tool" => match workspace_gateway_call_tool(context, &input) {
            Ok(result) => result,
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
        "secrets__list" => match workspace_gateway_list_secrets(context) {
            Ok(result) => workspace_gateway_content(result),
            Err(error) => workspace_gateway_error_content(error),
        },
        "secrets__get" => match workspace_gateway_get_secret(context, &input) {
            Ok(result) => workspace_gateway_content(result),
            Err(error) => workspace_gateway_error_content(error),
        },
        "secrets__write_env_file" => {
            match workspace_gateway_write_secrets_env_file(context, &input) {
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
    if workspace_gateway_server_hidden(&server) {
        return workspace_gateway_error_content(format!(
            "Workspace MCP `{server_key}` is hidden from coding agents."
        ));
    }
    if !workspace_gateway_server_pinned(&server) {
        return workspace_gateway_error_content(format!(
            "Workspace MCP `{server_key}` is in lazy exposure mode. Use workspace_mcp__call_tool with server_key `{server_key}` and tool_name `{child_tool}`."
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
        "workspace_mcp__search_tools" => {
            "Search enabled lazy or pinned workspace MCP tools by server, name, or description without loading every tool schema into model context."
        }
        "workspace_mcp__list_tools" => {
            "List compact tool metadata for enabled lazy or pinned workspace MCPs. Use get_tool_schema for one full schema when needed."
        }
        "workspace_mcp__get_tool_schema" => {
            "Return the full child MCP tool schema for exactly one enabled workspace MCP tool."
        }
        "workspace_mcp__call_tool" => {
            "Call one enabled workspace MCP child tool by server_key and tool_name. Use search_tools or get_tool_schema first when arguments are unclear."
        }
        "workspace_mcp__get_server_status" => "Inspect one workspace MCP server by server_key.",
        "workspace_mcp__get_server_config" => {
            "Read agent-visible workspace MCP configuration. Non-secret values are exposed by default; secret values are redacted unless explicitly enabled for that MCP."
        }
        "workspace_mcp__write_env_file" => {
            "Write agent-visible workspace MCP configuration into an env file without returning secret values in the tool result."
        }
        "secrets__list" => {
            "List local-only workspace secret keys and metadata without returning secret values."
        }
        "secrets__get" => {
            "Read one local-only workspace secret value. The secret must be explicitly enabled for agent access by the user."
        }
        "secrets__write_env_file" => {
            "Write selected local-only workspace secrets into an env file without returning secret values in the tool result. Each secret must be enabled for agent access."
        }
        _ => "Workspace MCP gateway tool.",
    }
}

fn workspace_gateway_builtin_tool_input_schema(tool: &str) -> Value {
    match tool {
        "workspace_mcp__search_tools" => json!({
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Optional search text matched against server names, tool names, and descriptions."},
                "server_key": {"type": "string", "description": "Optional workspace MCP server key to restrict search."},
                "limit": {"type": "integer", "description": "Maximum compact results to return.", "default": 25, "maximum": 100}
            },
            "additionalProperties": true
        }),
        "workspace_mcp__list_tools" => json!({
            "type": "object",
            "properties": {
                "server_key": {"type": "string", "description": "Optional workspace MCP server key. Omit to list compact tools for all enabled MCPs."},
                "limit": {"type": "integer", "description": "Maximum compact results to return.", "default": 100, "maximum": 200}
            },
            "additionalProperties": true
        }),
        "workspace_mcp__get_tool_schema" => json!({
            "type": "object",
            "properties": {
                "server_key": {"type": "string", "description": "Required workspace MCP server key unless qualified_name is provided."},
                "tool_name": {"type": "string", "description": "Required child MCP tool name unless qualified_name is provided."},
                "qualified_name": {"type": "string", "description": "Optional namespaced tool name formatted as server_key__tool_name."}
            },
            "additionalProperties": true
        }),
        "workspace_mcp__call_tool" => json!({
            "type": "object",
            "properties": {
                "server_key": {"type": "string", "description": "Required workspace MCP server key unless qualified_name is provided."},
                "tool_name": {"type": "string", "description": "Required child MCP tool name unless qualified_name is provided."},
                "qualified_name": {"type": "string", "description": "Optional namespaced tool name formatted as server_key__tool_name."},
                "arguments": {"type": "object", "description": "Arguments passed to the child MCP tool.", "additionalProperties": true}
            },
            "additionalProperties": true
        }),
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
        "secrets__list" => json!({
            "type": "object",
            "properties": {},
            "additionalProperties": true
        }),
        "secrets__get" => json!({
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "Required local workspace secret key."}
            },
            "required": ["key"],
            "additionalProperties": true
        }),
        "secrets__write_env_file" => json!({
            "type": "object",
            "properties": {
                "keys": {
                    "type": "array",
                    "description": "Required local workspace secret keys to write.",
                    "items": {"type": "string"},
                    "minItems": 1
                },
                "path": {
                    "type": "string",
                    "description": "Env file path relative to the agent worktree when available. Defaults to .env.local."
                }
            },
            "required": ["keys"],
            "additionalProperties": true
        }),
        _ => json!({"type": "object", "properties": {}}),
    }
}

fn workspace_gateway_search_tools(context: &McpContext, input: &Value) -> Result<Value, String> {
    let query = input["query"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .to_string();
    let terms = query
        .to_ascii_lowercase()
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let server_key = input["server_key"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let limit = workspace_gateway_limit(input, 25, 100);
    let mut rows = workspace_gateway_collect_tool_rows(context, server_key, 200)?;
    if !terms.is_empty() {
        rows.retain(|row| {
            let haystack = [
                row["server_key"].as_str().unwrap_or_default(),
                row["server_name"].as_str().unwrap_or_default(),
                row["tool_name"].as_str().unwrap_or_default(),
                row["qualified_name"].as_str().unwrap_or_default(),
                row["description"].as_str().unwrap_or_default(),
            ]
            .join(" ")
            .to_ascii_lowercase();
            terms.iter().all(|term| haystack.contains(term))
        });
    }
    let total_matches = rows.len();
    rows.truncate(limit);
    let (kernel, workspace_id) = workspace_gateway_kernel(context)?;
    let generation = workspace_gateway_generation(&kernel, &workspace_id)?;
    Ok(json!({
        "ok": true,
        "workspace_id": workspace_id,
        "generation": generation,
        "query": query,
        "server_key": server_key,
        "total_matches": total_matches,
        "returned_count": rows.len(),
        "tools": rows,
        "schema_hint": "Call workspace_mcp__get_tool_schema for the full schema of one result, then workspace_mcp__call_tool to invoke it."
    }))
}

fn workspace_gateway_list_tools(context: &McpContext, input: &Value) -> Result<Value, String> {
    let server_key = input["server_key"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let limit = workspace_gateway_limit(input, 100, 200);
    let rows = workspace_gateway_collect_tool_rows(context, server_key, limit)?;
    let (kernel, workspace_id) = workspace_gateway_kernel(context)?;
    let generation = workspace_gateway_generation(&kernel, &workspace_id)?;
    Ok(json!({
        "ok": true,
        "workspace_id": workspace_id,
        "generation": generation,
        "server_key": server_key,
        "returned_count": rows.len(),
        "tools": rows,
        "schema_hint": "Compact rows omit full inputSchema. Call workspace_mcp__get_tool_schema for one tool."
    }))
}

fn workspace_gateway_get_tool_schema(context: &McpContext, input: &Value) -> Result<Value, String> {
    let (server_key, tool_name) = workspace_gateway_tool_identity(input)?;
    let (kernel, workspace_id) = workspace_gateway_kernel(context)?;
    let server = workspace_gateway_required_callable_server(&kernel, &workspace_id, &server_key)?;
    let generation = workspace_gateway_generation(&kernel, &workspace_id)?;
    let child_tools = workspace_gateway_refresh_child_tools(&kernel, &workspace_id, &server)?;
    let tool = child_tools
        .into_iter()
        .find(|tool| tool["name"].as_str() == Some(tool_name.as_str()))
        .ok_or_else(|| format!("Workspace MCP `{server_key}` has no tool `{tool_name}`."))?;
    Ok(json!({
        "ok": true,
        "workspace_id": workspace_id,
        "generation": generation,
        "server": workspace_gateway_server_public(&server),
        "tool": {
            "server_key": server_key,
            "server_name": server["name"].as_str().unwrap_or(server_key.as_str()),
            "tool_name": tool_name,
            "qualified_name": workspace_gateway_tool_name(&server_key, tool["name"].as_str().unwrap_or_default()),
            "description": tool["description"].as_str().unwrap_or(""),
            "inputSchema": tool.get("inputSchema").cloned().unwrap_or_else(|| json!({"type": "object"})),
        }
    }))
}

fn workspace_gateway_call_tool(context: &McpContext, input: &Value) -> Result<Value, String> {
    let (server_key, tool_name) = workspace_gateway_tool_identity(input)?;
    let arguments = input.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let (kernel, workspace_id) = workspace_gateway_kernel(context)?;
    let server = workspace_gateway_required_callable_server(&kernel, &workspace_id, &server_key)?;
    match workspace_gateway_child_call_tool(&server, &tool_name, arguments) {
        Ok(result) => Ok(result),
        Err(error) => {
            let _ = kernel.record_workspace_mcp_probe_result(
                &workspace_id,
                &server_key,
                workspace_gateway_connection_error_status(&error),
                &error,
                None,
            );
            Err(error)
        }
    }
}

fn workspace_gateway_collect_tool_rows(
    context: &McpContext,
    server_key_filter: Option<&str>,
    limit: usize,
) -> Result<Vec<Value>, String> {
    let (kernel, workspace_id) = workspace_gateway_kernel(context)?;
    let generation = workspace_gateway_generation(&kernel, &workspace_id)?;
    let explicit_server = server_key_filter.is_some();
    let servers =
        workspace_gateway_candidate_tool_servers(&kernel, &workspace_id, server_key_filter)?;
    let mut rows = Vec::new();
    for server in servers {
        let child_tools =
            match workspace_gateway_refresh_child_tools(&kernel, &workspace_id, &server) {
                Ok(child_tools) => child_tools,
                Err(error) if explicit_server => return Err(error),
                Err(_) => continue,
            };
        for tool in child_tools {
            let Some(tool_name) = tool["name"].as_str().filter(|value| !value.is_empty()) else {
                continue;
            };
            rows.push(workspace_gateway_compact_tool_row(
                &server,
                &tool,
                &generation,
                tool_name,
            ));
            if rows.len() >= limit {
                return Ok(rows);
            }
        }
    }
    Ok(rows)
}

fn workspace_gateway_candidate_tool_servers(
    kernel: &CoordinationKernel,
    workspace_id: &str,
    server_key_filter: Option<&str>,
) -> Result<Vec<Value>, String> {
    if let Some(server_key) = server_key_filter {
        let server = workspace_gateway_required_callable_server(kernel, workspace_id, server_key)?;
        return Ok(vec![server]);
    }
    let servers = workspace_gateway_servers(kernel, workspace_id)?
        .into_iter()
        .filter(|server| workspace_gateway_server_agent_callable(server))
        .collect::<Vec<_>>();
    Ok(servers)
}

fn workspace_gateway_required_callable_server(
    kernel: &CoordinationKernel,
    workspace_id: &str,
    server_key: &str,
) -> Result<Value, String> {
    let server = workspace_gateway_server_by_key(kernel, workspace_id, server_key)?
        .ok_or_else(|| format!("Workspace MCP `{server_key}` is not installed."))?;
    if !workspace_gateway_server_runtime_enabled(&server) {
        return Err(format!(
            "Workspace MCP `{server_key}` is not enabled or configured for this workspace."
        ));
    }
    if workspace_gateway_server_hidden(&server) {
        return Err(format!(
            "Workspace MCP `{server_key}` is hidden from coding agents."
        ));
    }
    Ok(server)
}

fn workspace_gateway_refresh_child_tools(
    kernel: &CoordinationKernel,
    workspace_id: &str,
    server: &Value,
) -> Result<Vec<Value>, String> {
    let server_key = server["server_key"].as_str().unwrap_or_default();
    match workspace_gateway_child_list_tools(server) {
        Ok(child_tools) => {
            let tools = child_tools
                .iter()
                .filter_map(|tool| tool["name"].as_str().filter(|value| !value.is_empty()))
                .map(str::to_string)
                .collect::<Vec<_>>();
            let _ = kernel.record_workspace_mcp_probe_result(
                workspace_id,
                server_key,
                "healthy",
                &format!(
                    "Workspace gateway listed {} tool{} from this MCP.",
                    tools.len(),
                    if tools.len() == 1 { "" } else { "s" }
                ),
                Some(json!(tools)),
            );
            Ok(child_tools)
        }
        Err(error) => {
            let _ = kernel.record_workspace_mcp_probe_result(
                workspace_id,
                server_key,
                workspace_gateway_connection_error_status(&error),
                &error,
                Some(json!([])),
            );
            Err(error)
        }
    }
}

fn workspace_gateway_compact_tool_row(
    server: &Value,
    tool: &Value,
    generation: &str,
    tool_name: &str,
) -> Value {
    let server_key = server["server_key"].as_str().unwrap_or_default();
    json!({
        "server_key": server_key,
        "server_name": server["name"].as_str().unwrap_or(server_key),
        "tool_name": tool_name,
        "qualified_name": workspace_gateway_tool_name(server_key, tool_name),
        "description": tool["description"].as_str().unwrap_or(""),
        "exposure_mode": workspace_gateway_server_exposure_mode(server),
        "generation": generation,
        "input_summary": workspace_gateway_input_schema_summary(tool.get("inputSchema")),
    })
}

fn workspace_gateway_input_schema_summary(schema: Option<&Value>) -> Value {
    let Some(schema) = schema else {
        return json!({"type": "object", "property_count": 0});
    };
    let properties = schema["properties"]
        .as_object()
        .map(|object| {
            object
                .iter()
                .take(12)
                .map(|(name, value)| {
                    json!({
                        "name": name,
                        "type": value["type"].as_str().unwrap_or("unknown"),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "type": schema["type"].as_str().unwrap_or("object"),
        "property_count": schema["properties"].as_object().map(|object| object.len()).unwrap_or_default(),
        "properties": properties,
        "required": schema["required"].as_array().cloned().unwrap_or_default(),
        "additional_properties": schema["additionalProperties"].clone(),
    })
}

fn workspace_gateway_tool_identity(input: &Value) -> Result<(String, String), String> {
    if let Some(qualified) = input["qualified_name"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Some((server_key, tool_name)) = qualified.split_once("__") {
            if !server_key.trim().is_empty() && !tool_name.trim().is_empty() {
                return Ok((server_key.trim().to_string(), tool_name.trim().to_string()));
            }
        }
        return Err("qualified_name must be formatted as server_key__tool_name.".to_string());
    }

    let server_key = input["server_key"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let tool_name = input["tool_name"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match (server_key, tool_name) {
        (Some(server_key), Some(tool_name)) => Ok((server_key.to_string(), tool_name.to_string())),
        _ => Err(
            "server_key and tool_name are required unless qualified_name is provided.".to_string(),
        ),
    }
}

fn workspace_gateway_limit(input: &Value, default: usize, maximum: usize) -> usize {
    input["limit"]
        .as_u64()
        .map(|value| value as usize)
        .unwrap_or(default)
        .clamp(1, maximum)
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

fn workspace_gateway_list_secrets(context: &McpContext) -> Result<Value, String> {
    let (kernel, workspace_id) = workspace_gateway_kernel(context)?;
    let generation = workspace_gateway_generation(&kernel, &workspace_id)?;
    let secrets = kernel.workspace_mcp_secrets(&workspace_id)?;
    Ok(json!({
        "ok": true,
        "workspace_id": workspace_id,
        "generation": generation,
        "server_key": "secrets",
        "secrets": secrets["secrets"].clone(),
        "summary": secrets["summary"].clone(),
        "values_returned": false,
    }))
}

fn workspace_gateway_get_secret(context: &McpContext, input: &Value) -> Result<Value, String> {
    let key = input["key"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "key is required.".to_string())?;
    let (kernel, workspace_id) = workspace_gateway_kernel(context)?;
    let generation = workspace_gateway_generation(&kernel, &workspace_id)?;
    let secret = kernel.read_workspace_mcp_secret_for_agent(&workspace_id, key)?;
    Ok(json!({
        "ok": true,
        "workspace_id": workspace_id,
        "generation": generation,
        "server_key": "secrets",
        "secret": secret,
        "secret_values_returned": true,
        "handling": "Use this value only for the requested local operation. Do not print it, checkpoint it, summarize it, or include it in todos, architecture files, patches, logs, or cloud payloads.",
    }))
}

fn workspace_gateway_write_secrets_env_file(
    context: &McpContext,
    input: &Value,
) -> Result<Value, String> {
    let keys = workspace_gateway_secret_keys_from_input(input)?;
    let (kernel, workspace_id) = workspace_gateway_kernel(context)?;
    let generation = workspace_gateway_generation(&kernel, &workspace_id)?;
    let target = workspace_gateway_env_file_path(context, input["path"].as_str())?;
    let mut updates = Vec::new();
    for key in keys {
        let secret = kernel.read_workspace_mcp_secret_for_agent(&workspace_id, &key)?;
        let value = secret["value"].as_str().unwrap_or_default().to_string();
        if value.is_empty() {
            continue;
        }
        updates.push(WorkspaceGatewayEnvUpdate {
            key: secret["key"].as_str().unwrap_or(&key).to_string(),
            source_key: secret["key"].as_str().unwrap_or(&key).to_string(),
            value,
            secret: true,
        });
    }
    if updates.is_empty() {
        return Err("No enabled workspace secrets are available to write.".to_string());
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
        "server_key": "secrets",
        "path": target.display().to_string(),
        "written": written,
        "secret_values_returned": false,
    }))
}

fn workspace_gateway_secret_keys_from_input(input: &Value) -> Result<Vec<String>, String> {
    let mut keys = Vec::new();
    if let Some(array) = input["keys"].as_array() {
        keys.extend(
            array
                .iter()
                .filter_map(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
        );
    }
    if keys.is_empty() {
        if let Some(key) = input["key"]
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            keys.push(key.to_string());
        }
    }
    if keys.is_empty() {
        return Err("keys is required.".to_string());
    }
    keys.sort();
    keys.dedup();
    Ok(keys)
}

fn workspace_gateway_config_access_summary(server: &Value) -> Value {
    json!({
        "non_secret_config_read_enabled": workspace_gateway_agent_config_access_enabled(server),
        "secret_config_read_enabled": workspace_gateway_agent_secret_config_access_enabled(server),
        "env_file_write_enabled": workspace_gateway_agent_env_file_write_enabled(server),
    })
}

fn workspace_gateway_agent_config_access_enabled(server: &Value) -> bool {
    server["agent_config_access_enabled"]
        .as_bool()
        .unwrap_or_else(|| server["agent_config_access_enabled"].as_i64().unwrap_or(1) != 0)
}

fn workspace_gateway_agent_secret_config_access_enabled(server: &Value) -> bool {
    server["agent_secret_config_access_enabled"]
        .as_bool()
        .unwrap_or_else(|| {
            server["agent_secret_config_access_enabled"]
                .as_i64()
                .unwrap_or_default()
                != 0
        })
}

fn workspace_gateway_agent_env_file_write_enabled(server: &Value) -> bool {
    server["agent_env_file_write_enabled"]
        .as_bool()
        .unwrap_or_else(|| server["agent_env_file_write_enabled"].as_i64().unwrap_or(1) != 0)
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
         UNION
         SELECT workspace_id FROM workspace_mcp_secrets
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
    if server_key == "secrets" {
        return workspace_gateway_secrets_server_public(kernel, workspace_id).map(Some);
    }
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
            UNION ALL
            SELECT updated_at FROM workspace_mcp_secrets WHERE workspace_id=?1
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
    let mut public_servers = servers
        .iter()
        .map(workspace_gateway_server_public)
        .collect::<Vec<_>>();
    public_servers.insert(
        0,
        workspace_gateway_secrets_server_public(&kernel, &workspace_id)?,
    );
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
            "default_exposure_mode": WORKSPACE_MCP_EXPOSURE_LAZY,
            "lazy_tools": ["workspace_mcp__search_tools", "workspace_mcp__list_tools", "workspace_mcp__get_tool_schema", "workspace_mcp__call_tool"],
        },
        "summary": {
            "installed_count": public_servers.len(),
            "enabled_count": enabled_count,
            "config_required_count": config_required_count,
        },
        "servers": public_servers,
    }))
}

fn workspace_gateway_secrets_server_public(
    kernel: &CoordinationKernel,
    workspace_id: &str,
) -> Result<Value, String> {
    let secrets = kernel.workspace_mcp_secrets(workspace_id)?;
    Ok(json!({
        "id": "secrets",
        "server_key": "secrets",
        "name": "Secrets MCP",
        "source_kind": "built_in",
        "source_label": "Diff Forge",
        "package_ref": "local-only",
        "transport": "stdio",
        "workspace_enabled": true,
        "approval_policy": "always_allow",
        "agent_config_access_enabled": true,
        "agent_secret_config_access_enabled": true,
        "agent_env_file_write_enabled": true,
        "runtime_status": "enabled",
        "missing_required_config": [],
        "tool_namespace": "secrets",
        "tool_prefix": "secrets__",
        "tools": ["list", "get", "write_env_file"],
        "secret_count": secrets["summary"]["secret_count"].clone(),
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
        "exposure_mode": workspace_gateway_server_exposure_mode(server),
        "agent_config_access_enabled": workspace_gateway_agent_config_access_enabled(server),
        "agent_secret_config_access_enabled": workspace_gateway_agent_secret_config_access_enabled(server),
        "agent_env_file_write_enabled": workspace_gateway_agent_env_file_write_enabled(server),
        "runtime_status": runtime_status,
        "agent_callable": workspace_gateway_server_agent_callable(server),
        "direct_tools_exposed": workspace_gateway_server_pinned(server),
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

fn workspace_gateway_server_agent_callable(server: &Value) -> bool {
    workspace_gateway_server_runtime_enabled(server) && !workspace_gateway_server_hidden(server)
}

fn workspace_gateway_server_pinned(server: &Value) -> bool {
    workspace_gateway_server_exposure_mode(server) == WORKSPACE_MCP_EXPOSURE_PINNED
}

fn workspace_gateway_server_hidden(server: &Value) -> bool {
    workspace_gateway_server_exposure_mode(server) == WORKSPACE_MCP_EXPOSURE_HIDDEN
}

fn workspace_gateway_server_exposure_mode(server: &Value) -> &'static str {
    workspace_gateway_exposure_mode(server["exposure_mode"].as_str())
}

fn workspace_gateway_exposure_mode(value: Option<&str>) -> &'static str {
    match value.unwrap_or(WORKSPACE_MCP_EXPOSURE_LAZY).trim() {
        WORKSPACE_MCP_EXPOSURE_PINNED => WORKSPACE_MCP_EXPOSURE_PINNED,
        WORKSPACE_MCP_EXPOSURE_HIDDEN => WORKSPACE_MCP_EXPOSURE_HIDDEN,
        _ => WORKSPACE_MCP_EXPOSURE_LAZY,
    }
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
            let tools = coordination_tools_for_context(context);
            record_mcp_client_event_async(
                context,
                "mcp_agent_tools_listed",
                json!({
                    "method": "tools/list",
                    "tool_count": tools.len(),
                    "tools": tools,
                }),
            );
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "tools": tools.iter().map(|name| json!({
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

fn coordination_context_has_terminal_session(context: &McpContext) -> bool {
    context
        .session_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
}

fn coordination_context_repo_session_mode(context: &McpContext) -> Option<&'static str> {
    if context
        .enforcement_mode
        .as_deref()
        .map(str::trim)
        .is_some_and(|mode| mode.eq_ignore_ascii_case("direct_unmanaged"))
    {
        return Some(super::kernel::AGENT_SESSION_MODE_DIRECT_UNMANAGED);
    }
    let repo_path = context
        .repo_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let db_path = context
        .db_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let kernel = CoordinationKernel::open(PathBuf::from(repo_path), db_path).ok()?;
    let policy = kernel.repo_policy().ok()?;
    Some(super::kernel::repo_policy_agent_session_mode(&policy))
}

fn coordination_tools_for_context(context: &McpContext) -> Vec<&'static str> {
    // Unsafe direct workspaces never expose the coordination lifecycle:
    // agents physically cannot start tasks, take leases, or submit patches.
    if coordination_context_repo_session_mode(context)
        == Some(super::kernel::AGENT_SESSION_MODE_DIRECT_UNMANAGED)
    {
        return TOOL_NAMES
            .iter()
            .copied()
            .filter(|tool| !TERMINAL_SESSION_TOOL_NAMES.contains(tool))
            .collect();
    }
    if coordination_context_has_terminal_session(context) {
        return TOOL_NAMES.to_vec();
    }
    TOOL_NAMES
        .iter()
        .copied()
        .filter(|tool| !TERMINAL_SESSION_TOOL_NAMES.contains(tool))
        .collect()
}

pub fn dispatch_tool(context: &McpContext, tool: &str, mut input: Value) -> Value {
    let allowed_tools = coordination_tools_for_context(context);
    if !allowed_tools.contains(&tool) {
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
            json!({"allowed_tools": allowed_tools}),
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
        "architecture_context" => kernel_architecture_context(&kernel, &input),
        "architecture_list" => kernel_architecture_list(&kernel, &input),
        "architecture_icon_reference" => kernel_architecture_icon_reference(&kernel, &input),
        "architecture_revision_list" => kernel_architecture_revision_list(&kernel, &input),
        "architecture_revision_read" => kernel_architecture_revision_read(&kernel, &input),
        "architecture_revision_restore" => kernel_architecture_revision_restore(&kernel, &input),
        "list_todo_targets" => kernel_list_todo_targets(&kernel, &input),
        "send_todos" => kernel_send_todos(&kernel, &input),
        "get_todo_status" => kernel_get_todo_status(&kernel, &input),
        "wait_for_todos" => kernel_wait_for_todos(&kernel, &input),
        "list_todo_history" => kernel_list_todo_history(&kernel, &input),
        "list_assets" => kernel_list_assets(&kernel, &input),
        "get_asset_root" => kernel_get_asset_root(&kernel, &input),
        "upload_asset" => kernel_upload_asset(&kernel, &input),
        "upload_asset_status" => kernel_upload_asset_status(&kernel, &input),
        "download_asset" => kernel_download_asset(&kernel, &input),
        "download_asset_status" => kernel_download_asset_status(&kernel, &input),
        "delete_local_asset" => kernel_delete_local_asset(&kernel, &input),
        "delete_cloud_asset" => kernel_delete_cloud_asset(&kernel, &input),
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

fn architecture_tool_repo_path(kernel: &CoordinationKernel, input: &Value) -> String {
    input["repo_path"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| kernel.paths.repo_path.display().to_string())
}

fn kernel_architecture_context(
    kernel: &CoordinationKernel,
    input: &Value,
) -> Result<Value, String> {
    Ok(api_ok(crate::architecture_context_value(
        architecture_tool_repo_path(kernel, input),
    )?))
}

fn kernel_architecture_list(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    Ok(api_ok(crate::architecture_graphs_list_value(
        architecture_tool_repo_path(kernel, input),
    )?))
}

fn kernel_architecture_icon_reference(
    kernel: &CoordinationKernel,
    input: &Value,
) -> Result<Value, String> {
    Ok(api_ok(crate::architecture_icon_reference_value(
        architecture_tool_repo_path(kernel, input),
    )?))
}

fn kernel_architecture_revision_list(
    kernel: &CoordinationKernel,
    input: &Value,
) -> Result<Value, String> {
    let graph_id = input["graph_id"]
        .as_str()
        .or_else(|| input["graphId"].as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Ok(api_ok(crate::architecture_graph_revisions_list_value(
        architecture_tool_repo_path(kernel, input),
        graph_id,
    )?))
}

fn kernel_architecture_revision_read(
    kernel: &CoordinationKernel,
    input: &Value,
) -> Result<Value, String> {
    let graph_id = input["graph_id"]
        .as_str()
        .or_else(|| input["graphId"].as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "architecture_revision_read requires graph_id.".to_string())?
        .to_string();
    let revision_id = input["revision_id"]
        .as_str()
        .or_else(|| input["revisionId"].as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "architecture_revision_read requires revision_id.".to_string())?
        .to_string();
    Ok(api_ok(crate::architecture_graph_revision_read_value(
        architecture_tool_repo_path(kernel, input),
        graph_id,
        revision_id,
    )?))
}

fn kernel_architecture_revision_restore(
    kernel: &CoordinationKernel,
    input: &Value,
) -> Result<Value, String> {
    let graph_id = input["graph_id"]
        .as_str()
        .or_else(|| input["graphId"].as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "architecture_revision_restore requires graph_id.".to_string())?
        .to_string();
    let revision_id = input["revision_id"]
        .as_str()
        .or_else(|| input["revisionId"].as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "architecture_revision_restore requires revision_id.".to_string())?
        .to_string();
    Ok(api_ok(crate::architecture_graph_revision_restore_value(
        architecture_tool_repo_path(kernel, input),
        graph_id,
        revision_id,
    )?))
}

fn kernel_list_todo_targets(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let repo_path_fallback = kernel.paths.repo_path.to_string_lossy().to_string();
    let repo_path = input["repo_path"]
        .as_str()
        .unwrap_or(repo_path_fallback.as_str());
    let cloud = crate::cloud_mcp_forward_agent_list_todo_targets(
        Some(repo_path),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        input["cloud_mcp_base_url"].as_str(),
        input["agent_id"].as_str(),
        input["session_id"].as_str(),
    )?;
    Ok(api_ok(cloud))
}

fn kernel_send_todos(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let repo_path_fallback = kernel.paths.repo_path.to_string_lossy().to_string();
    let repo_path = input["repo_path"]
        .as_str()
        .unwrap_or(repo_path_fallback.as_str());
    let has_items = input
        .get("items")
        .or_else(|| input.get("todos"))
        .and_then(Value::as_array)
        .is_some_and(|items| !items.is_empty())
        || mcp_input_text(input, &["text", "body", "prompt", "message"]).is_some();
    if !has_items {
        return Err("send_todos requires items[] or text.".to_string());
    }
    let has_targets = input
        .get("targets")
        .and_then(Value::as_array)
        .is_some_and(|items| !items.is_empty())
        || (mcp_input_text(input, &["target_device_id", "targetDeviceId"]).is_some()
            && mcp_input_text(input, &["target_workspace_id", "targetWorkspaceId"]).is_some());
    if !has_targets {
        return Err(
            "send_todos requires targets[] or target_device_id/target_workspace_id.".to_string(),
        );
    }
    let cloud = crate::cloud_mcp_forward_agent_send_todos(
        Some(repo_path),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        input["cloud_mcp_base_url"].as_str(),
        input["agent_id"].as_str(),
        input["session_id"].as_str(),
        input,
    )?;
    Ok(api_ok(cloud))
}

fn kernel_get_todo_status(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let repo_path_fallback = kernel.paths.repo_path.to_string_lossy().to_string();
    let repo_path = input["repo_path"]
        .as_str()
        .unwrap_or(repo_path_fallback.as_str());
    let cloud = crate::cloud_mcp_forward_agent_get_todo_status(
        Some(repo_path),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        input["cloud_mcp_base_url"].as_str(),
        input["agent_id"].as_str(),
        input["session_id"].as_str(),
        input,
    )?;
    Ok(api_ok(cloud))
}

fn kernel_wait_for_todos(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let repo_path_fallback = kernel.paths.repo_path.to_string_lossy().to_string();
    let repo_path = input["repo_path"]
        .as_str()
        .unwrap_or(repo_path_fallback.as_str());
    let cloud = crate::cloud_mcp_forward_agent_wait_for_todos(
        Some(repo_path),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        input["cloud_mcp_base_url"].as_str(),
        input["agent_id"].as_str(),
        input["session_id"].as_str(),
        input,
    )?;
    Ok(api_ok(cloud))
}

fn kernel_list_todo_history(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let repo_path_fallback = kernel.paths.repo_path.to_string_lossy().to_string();
    let repo_path = input["repo_path"]
        .as_str()
        .unwrap_or(repo_path_fallback.as_str());
    let cloud = crate::cloud_mcp_forward_agent_list_todo_history(
        Some(repo_path),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        input["cloud_mcp_base_url"].as_str(),
        input["agent_id"].as_str(),
        input["session_id"].as_str(),
        input,
    )?;
    Ok(api_ok(cloud))
}

fn kernel_list_assets(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let repo_path_fallback = kernel.paths.repo_path.to_string_lossy().to_string();
    let repo_path = input["repo_path"]
        .as_str()
        .unwrap_or(repo_path_fallback.as_str());
    Ok(api_ok(crate::cloud_mcp_forward_agent_list_assets(
        Some(repo_path),
        input["workspace_id"].as_str(),
        input,
    )?))
}

fn kernel_get_asset_root(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let repo_path_fallback = kernel.paths.repo_path.to_string_lossy().to_string();
    let repo_path = input["repo_path"]
        .as_str()
        .unwrap_or(repo_path_fallback.as_str());
    Ok(api_ok(crate::cloud_mcp_forward_agent_get_asset_root(
        Some(repo_path),
        input["workspace_id"].as_str(),
        input,
    )?))
}

fn kernel_upload_asset(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let repo_path_fallback = kernel.paths.repo_path.to_string_lossy().to_string();
    let repo_path = input["repo_path"]
        .as_str()
        .unwrap_or(repo_path_fallback.as_str());
    Ok(api_ok(crate::cloud_mcp_forward_agent_upload_asset(
        Some(repo_path),
        input["workspace_id"].as_str(),
        input["cloud_mcp_base_url"].as_str(),
        input,
    )?))
}

fn kernel_upload_asset_status(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let repo_path_fallback = kernel.paths.repo_path.to_string_lossy().to_string();
    let repo_path = input["repo_path"]
        .as_str()
        .unwrap_or(repo_path_fallback.as_str());
    Ok(api_ok(crate::cloud_mcp_forward_agent_upload_asset_status(
        Some(repo_path),
        input["workspace_id"].as_str(),
        input["cloud_mcp_base_url"].as_str(),
        input,
    )?))
}

fn kernel_download_asset(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let repo_path_fallback = kernel.paths.repo_path.to_string_lossy().to_string();
    let repo_path = input["repo_path"]
        .as_str()
        .unwrap_or(repo_path_fallback.as_str());
    Ok(api_ok(crate::cloud_mcp_forward_agent_download_asset(
        Some(repo_path),
        input["workspace_id"].as_str(),
        input["cloud_mcp_base_url"].as_str(),
        input,
    )?))
}

fn kernel_download_asset_status(
    kernel: &CoordinationKernel,
    input: &Value,
) -> Result<Value, String> {
    let repo_path_fallback = kernel.paths.repo_path.to_string_lossy().to_string();
    let repo_path = input["repo_path"]
        .as_str()
        .unwrap_or(repo_path_fallback.as_str());
    Ok(api_ok(
        crate::cloud_mcp_forward_agent_download_asset_status(
            Some(repo_path),
            input["workspace_id"].as_str(),
            input["cloud_mcp_base_url"].as_str(),
            input,
        )?,
    ))
}

fn kernel_delete_local_asset(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let repo_path_fallback = kernel.paths.repo_path.to_string_lossy().to_string();
    let repo_path = input["repo_path"]
        .as_str()
        .unwrap_or(repo_path_fallback.as_str());
    Ok(api_ok(crate::cloud_mcp_forward_agent_delete_local_asset(
        Some(repo_path),
        input["workspace_id"].as_str(),
        input,
    )?))
}

fn kernel_delete_cloud_asset(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let repo_path_fallback = kernel.paths.repo_path.to_string_lossy().to_string();
    let repo_path = input["repo_path"]
        .as_str()
        .unwrap_or(repo_path_fallback.as_str());
    Ok(api_ok(crate::cloud_mcp_forward_agent_delete_cloud_asset(
        Some(repo_path),
        input["workspace_id"].as_str(),
        input["cloud_mcp_base_url"].as_str(),
        input,
    )?))
}

fn mcp_input_text(input: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        input
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn kernel_start_task(kernel: &CoordinationKernel, input: &Value) -> Result<Value, String> {
    let start_plan = optional_start_task_text(input).ok_or_else(|| {
        "start_task requires a short plan explaining what the agent is about to do.".to_string()
    })?;
    if start_task_plan_is_direct_architecture_graph_work(&start_plan) {
        return Ok(api_error(
            "architecture_graph_direct_edit",
            "Do not create a normal task for architecture graph-only work. Call architecture_context/list/reference as needed, edit .agents/architectures/graphs/*.arch directly in the visible repo root, and report the graph path when done. If this work also edits code or docs, call start_task again with a plan naming the non-architecture files.",
            json!({
                "direct_artifact_root": ".agents/architectures/graphs",
                "plan": start_plan,
            }),
        ));
    }
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
    let agent_kind = input["agent_kind"]
        .as_str()
        .filter(|value| !value.trim().is_empty());
    let requested_title = input["title"]
        .as_str()
        .filter(|value| !value.trim().is_empty());
    let local_task_hint = existing_local_task_id_for_start(kernel, task_id, session_id)?;
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

    let requested_local_task_id = local_task_hint.as_deref().or_else(|| {
        task_id.and_then(|task_id| {
            (explicit_task_id_provided
                && !input_task_id_is_session_id
                && !requested_task_is_existing_non_reusable)
                .then_some(task_id)
        })
    });
    let started = kernel.start_task(
        agent_id,
        session_id,
        requested_local_task_id,
        None,
        Some(&start_plan),
        requested_title,
        None,
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

    let cloud = match crate::cloud_mcp_forward_agent_start_task(
        input["repo_path"].as_str(),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        input["cloud_mcp_base_url"].as_str(),
        agent_id,
        session_id,
        Some(&started_task_id),
        input["worktree_id"].as_str(),
        input["worktree_path"].as_str(),
        agent_kind,
        task_title.as_deref(),
        None,
        input["session_mode"].as_str(),
        input["file_authority"].as_str(),
        input["enforcement_mode"].as_str(),
        input["completion_mode"].as_str(),
        &start_plan,
    ) {
        Ok(response) => response,
        Err(error) => json!({
            "ok": false,
            "queued": false,
            "coordination_authority": "local",
            "cloud_sync_mode": "history_reference",
            "error": error,
        }),
    };

    let start_authority_resolution = if let (Some(agent_id), Some(session_id)) =
        (agent_id, session_id)
    {
        match kernel.promote_late_git_direct_session_file_authority(
            agent_id,
            session_id,
            Some(&started_task_id),
        ) {
            Ok(resolution) if resolution["changed"].as_bool() == Some(true) => resolution,
            Ok(_) => Value::Null,
            Err(error) => {
                return Ok(api_error(
                    "late_git_promotion_failed",
                    "Git appeared after this terminal launched, but Diff Forge could not promote the running session to an isolated worktree. Do not edit the visible repo root.",
                    json!({"error": error, "task_id": started_task_id}),
                ));
            }
        }
    } else {
        Value::Null
    };

    let source_todo_refs = cloud_start_task_source_refs(input);
    let attached_source_refs = if value_has_content(&source_todo_refs) {
        let attached = kernel.attach_task_source_refs(&started_task_id, &source_todo_refs)?;
        if attached["ok"].as_bool() == Some(false) {
            return Ok(attached);
        }
        Some(attached["data"].clone())
    } else {
        None
    };
    let refreshed_brief = if !start_authority_resolution.is_null() {
        Some(kernel.get_brief(agent_id, session_id, Some(&started_task_id), None)?["data"].clone())
    } else {
        None
    };

    if let Some(object) = data.as_object_mut() {
        let brief = refreshed_brief
            .as_ref()
            .or_else(|| object.get("brief"))
            .cloned()
            .map(|brief| start_task_brief_for_agent(&brief))
            .unwrap_or_else(|| json!({}));
        object.insert("brief".to_string(), brief);
        object.insert("start_plan".to_string(), json!(start_plan));
        object.insert("cloud".to_string(), cloud_start_task_for_agent(&cloud));
        object.insert("cloud_task_id".to_string(), json!(started_task_id));
        object.insert("coordination_authority".to_string(), json!("local"));
        object.insert(
            "cloud_sync_mode".to_string(),
            json!("background_history_reference"),
        );
        if !start_authority_resolution.is_null() {
            object.insert("authority".to_string(), start_authority_resolution);
        }
        if let Some(attached) = attached_source_refs.as_ref() {
            insert_if_present(object, "source_todo", attached["source_todo"].clone());
            insert_if_present(object, "task", attached["task"].clone());
        }
        object.insert(
            "task_id_source".to_string(),
            json!(if local_task_hint.is_some() {
                "local_existing"
            } else if requested_local_task_id.is_some() {
                "local_explicit"
            } else {
                "local_created"
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
    view.insert(
        "ok".to_string(),
        json!(response["ok"].as_bool().unwrap_or(true)),
    );
    if let Some(task_id) = cloud_start_task_id(response) {
        view.insert("task_id".to_string(), json!(task_id));
    }
    for field in ["coordination_authority", "cloud_sync_mode", "sync", "error"] {
        insert_if_present(&mut view, field, response[field].clone());
    }
    let source_refs = cloud_start_task_source_refs(response);
    insert_if_present(&mut view, "source_todo", source_refs["source_todo"].clone());
    insert_if_present(
        &mut view,
        "account_data",
        context_pack
            .get("account_data")
            .or_else(|| context_pack.get("accountData"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    insert_if_present(
        &mut view,
        "todo_compression",
        context_pack
            .get("todo_compression")
            .or_else(|| context_pack.get("todoCompression"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    insert_if_present(
        &mut view,
        "context_error",
        pick_fields(context_pack, &["ok", "error", "message"]),
    );
    insert_if_present(
        &mut view,
        "task_history",
        cloud_task_history_for_agent(&response["task_history"]),
    );
    insert_if_present(
        &mut view,
        "spec_activity",
        pick_fields(
            &response["spec_activity"],
            &["recorded", "node_ids", "reason", "warnings", "error"],
        ),
    );
    Value::Object(view)
}

fn cloud_task_history_for_agent(history: &Value) -> Value {
    let mut view = Map::new();
    insert_if_present(
        &mut view,
        "context_error",
        pick_fields(history, &["ok", "error", "message"]),
    );
    if let Some(tasks) = history.get("tasks").and_then(Value::as_array) {
        view.insert("task_count".to_string(), json!(tasks.len()));
        view.insert(
            "recent_tasks".to_string(),
            Value::Array(
                tasks
                    .iter()
                    .rev()
                    .take(8)
                    .map(|task| {
                        pick_fields(
                            task,
                            &[
                                "task_id",
                                "status",
                                "title",
                                "original_prompt",
                                "source_todo",
                                "todo_id",
                                "todo_dispatch_id",
                                "prompt_event_id",
                                "coding_agent",
                                "updated_at",
                            ],
                        )
                    })
                    .collect(),
            ),
        );
    }
    Value::Object(view)
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

fn cloud_start_task_source_refs(response: &Value) -> Value {
    let todo_id = cloud_start_task_source_ref_text(
        response,
        &["todo_id", "todoId", "source_todo_id", "sourceTodoId"],
    );
    let todo_dispatch_id = cloud_start_task_source_ref_text(
        response,
        &[
            "todo_dispatch_id",
            "todoDispatchId",
            "source_todo_dispatch_id",
            "sourceTodoDispatchId",
        ],
    );
    let prompt_event_id = cloud_start_task_source_ref_text(
        response,
        &[
            "prompt_event_id",
            "promptEventId",
            "source_prompt_event_id",
            "sourcePromptEventId",
        ],
    );
    let command_id = cloud_start_task_source_ref_text(
        response,
        &[
            "command_id",
            "commandId",
            "source_command_id",
            "sourceCommandId",
        ],
    );
    let mut source = Map::new();
    if let Some(todo_id) = todo_id.as_deref() {
        source.insert("todo_id".to_string(), json!(todo_id));
        source.insert("todoId".to_string(), json!(todo_id));
    }
    if let Some(todo_dispatch_id) = todo_dispatch_id.as_deref() {
        source.insert("todo_dispatch_id".to_string(), json!(todo_dispatch_id));
        source.insert("todoDispatchId".to_string(), json!(todo_dispatch_id));
    }
    if let Some(prompt_event_id) = prompt_event_id.as_deref() {
        source.insert("prompt_event_id".to_string(), json!(prompt_event_id));
        source.insert("promptEventId".to_string(), json!(prompt_event_id));
    }
    if let Some(command_id) = command_id.as_deref() {
        source.insert("command_id".to_string(), json!(command_id));
        source.insert("commandId".to_string(), json!(command_id));
    }
    let mut refs = Map::new();
    if let Some(todo_id) = todo_id.as_deref() {
        refs.insert("source_todo_id".to_string(), json!(todo_id));
        refs.insert("sourceTodoId".to_string(), json!(todo_id));
        refs.insert("todo_id".to_string(), json!(todo_id));
        refs.insert("todoId".to_string(), json!(todo_id));
    }
    if let Some(todo_dispatch_id) = todo_dispatch_id.as_deref() {
        refs.insert(
            "source_todo_dispatch_id".to_string(),
            json!(todo_dispatch_id),
        );
        refs.insert("sourceTodoDispatchId".to_string(), json!(todo_dispatch_id));
        refs.insert("todo_dispatch_id".to_string(), json!(todo_dispatch_id));
        refs.insert("todoDispatchId".to_string(), json!(todo_dispatch_id));
    }
    if let Some(prompt_event_id) = prompt_event_id.as_deref() {
        refs.insert("source_prompt_event_id".to_string(), json!(prompt_event_id));
        refs.insert("sourcePromptEventId".to_string(), json!(prompt_event_id));
        refs.insert("prompt_event_id".to_string(), json!(prompt_event_id));
        refs.insert("promptEventId".to_string(), json!(prompt_event_id));
    }
    if let Some(command_id) = command_id.as_deref() {
        refs.insert("source_command_id".to_string(), json!(command_id));
        refs.insert("sourceCommandId".to_string(), json!(command_id));
        refs.insert("command_id".to_string(), json!(command_id));
        refs.insert("commandId".to_string(), json!(command_id));
    }
    if !source.is_empty() {
        refs.insert("source_todo".to_string(), Value::Object(source));
    }
    Value::Object(refs)
}

fn cloud_start_task_source_ref_text(response: &Value, keys: &[&str]) -> Option<String> {
    let containers = [
        response,
        &response["task"],
        &response["data"]["task"],
        &response["event"],
        &response["event"]["task"],
        &response["data"]["event"],
        &response["data"]["event"]["task"],
    ];
    for container in containers {
        for key in keys {
            if let Some(value) = container
                .get(*key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Some(value.to_string());
            }
            if let Some(value) = container
                .get("source_todo")
                .and_then(|source| source.get(*key))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Some(value.to_string());
            }
        }
    }
    for metadata in cloud_start_task_metadata_values(response) {
        for key in keys {
            if let Some(value) = metadata
                .get(*key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn cloud_start_task_metadata_values(response: &Value) -> Vec<Value> {
    let containers = [
        response,
        &response["task"],
        &response["data"]["task"],
        &response["event"],
        &response["event"]["task"],
        &response["data"]["event"],
        &response["data"]["event"]["task"],
    ];
    let mut values = Vec::new();
    for container in containers {
        for key in ["metadata", "metadata_json", "metadataJson"] {
            let Some(value) = container.get(key) else {
                continue;
            };
            if value.is_object() {
                values.push(value.clone());
            } else if let Some(raw) = value.as_str() {
                if let Ok(parsed) = serde_json::from_str::<Value>(raw) {
                    if parsed.is_object() {
                        values.push(parsed);
                    }
                }
            }
        }
    }
    values
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
    let mut file_authority = input["file_authority"]
        .as_str()
        .unwrap_or("none")
        .to_string();
    let mut enforcement_mode = input["enforcement_mode"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let mut authority_resolution = Value::Null;
    if enforcement_mode == "general_worker" && cloud_file_resource_key(resource_key) {
        authority_resolution =
            kernel.resolve_general_worker_file_authority(agent_id, session_id, Some(task_id))?;
        if let Some(value) = authority_resolution["enforcement_mode"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
        {
            enforcement_mode = value.to_string();
        }
        if let Some(value) = authority_resolution["file_authority"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
        {
            file_authority = value.to_string();
        }
    }
    if enforcement_mode == "bounded_direct_edit" && cloud_file_resource_key(resource_key) {
        let resolution = kernel.promote_late_git_direct_session_file_authority(
            agent_id,
            session_id,
            Some(task_id),
        )?;
        if resolution["changed"].as_bool() == Some(true) {
            if let Some(value) = resolution["enforcement_mode"]
                .as_str()
                .filter(|value| !value.trim().is_empty())
            {
                enforcement_mode = value.to_string();
            }
            if let Some(value) = resolution["file_authority"]
                .as_str()
                .filter(|value| !value.trim().is_empty())
            {
                file_authority = value.to_string();
            }
            authority_resolution = resolution;
        }
    }
    let no_local_file_authority = matches!(
        enforcement_mode.as_str(),
        "activity_only" | "remote_unmanaged"
    ) || matches!(
        file_authority.as_str(),
        "remote_unmanaged" | "external_unmanaged"
    ) || (file_authority == "none"
        && matches!(
            enforcement_mode.as_str(),
            "activity_only" | "remote_unmanaged"
        ));
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
    let forward_worktree_id = authority_resolution["worktree_id"]
        .as_str()
        .or_else(|| input["worktree_id"].as_str());
    let forward_worktree_path = authority_resolution["worktree_path"]
        .as_str()
        .or_else(|| authority_resolution["agent_branch_root"].as_str())
        .or_else(|| input["worktree_path"].as_str());
    let cloud = match crate::cloud_mcp_forward_agent_acquire_lease(
        input["repo_path"].as_str(),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        Some(agent_id),
        Some(session_id),
        Some(task_id),
        forward_worktree_id,
        forward_worktree_path,
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
        if !authority_resolution.is_null() {
            data.insert("authority".to_string(), authority_resolution);
        }
        if cloud_file_resource_key(resource_key) {
            let write_guidance = match enforcement_mode.as_str() {
                "worktree_required" => {
                    "After this lease, use normal edit tools against the assigned agent branch root in COORDINATION_AGENT_BRANCH_ROOT; Diff Forge blocks anything outside the lease."
                }
                "bounded_direct_edit" => {
                    "After this lease, edit the leased files directly under the selected repo root; Diff Forge still validates lease coverage and this task finishes with complete_task."
                }
                _ => {
                    "After this lease, use normal edit tools only within the granted local file authority and finish with the reported completion_mode."
                }
            };
            data.insert("write_guidance".to_string(), json!(write_guidance));
        }
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

fn start_task_plan_is_direct_architecture_graph_work(plan: &str) -> bool {
    let normalized = plan.to_ascii_lowercase();
    let graph_intent = [
        ".agents/architectures/graphs",
        ".arch",
        "architecture graph",
        "architecture diagram",
        "system graph",
        "system map",
        "deployment diagram",
        "data-flow diagram",
        "data flow diagram",
        "control graph",
        "state machine",
        "dependency graph",
        "api corridor",
        "api pathway",
    ]
    .iter()
    .any(|term| normalized.contains(term));
    if !graph_intent {
        return false;
    }
    let non_graph_intent = [
        "implement code",
        "edit code",
        "modify code",
        "change code",
        "update code",
        "source code",
        "code file",
        "src/",
        "package.json",
        "cargo.toml",
        "index.html",
        "readme",
        "docs/",
    ]
    .iter()
    .any(|term| normalized.contains(term));
    !non_graph_intent
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
            ));
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
            "source": "coordination-kernel.checkpoint",
        }),
    )?;
    let terminal_plan_update =
        kernel.checkpoint_terminal_todo_plan(task_id, agent_id, session_id, input)?;
    let terminal_plan_compact = terminal_plan_update.as_ref().and_then(|value| {
        value
            .get("compact_plan")
            .filter(|compact| value_has_content(compact))
    });

    let cloud = match crate::cloud_mcp_forward_agent_checkpoint(
        input["repo_path"].as_str(),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        agent_id,
        session_id,
        Some(task_id),
        input["worktree_id"].as_str(),
        input["worktree_path"].as_str(),
        summary,
        terminal_plan_compact,
    ) {
        Ok(response) => json!({"ok": true, "response": response}),
        Err(error) => json!({"ok": false, "error": error}),
    };

    Ok(api_ok(json!({
        "event_id": event_id,
        "summary": summary,
        "terminal_plan": terminal_plan_update,
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
    let terminal_plan_update = kernel.finish_terminal_todo_plan_for_task(
        task_id,
        completed_status.unwrap_or("done"),
        Some(agent_id),
        Some(session_id),
    )?;
    let terminal_plan_compact = terminal_plan_update.as_ref().and_then(|value| {
        value
            .get("compact_plan")
            .filter(|compact| value_has_content(compact))
    });
    let cloud = match crate::cloud_mcp_forward_agent_complete_task(
        input["repo_path"].as_str(),
        input["db_path"].as_str().map(PathBuf::from).as_deref(),
        input["workspace_id"].as_str(),
        Some(agent_id),
        Some(session_id),
        Some(task_id),
        summary,
        completed_status,
        input["session_mode"].as_str(),
        input["file_authority"].as_str(),
        input["enforcement_mode"].as_str(),
        input["completion_mode"].as_str(),
        &completed,
        terminal_plan_compact,
    ) {
        Ok(response) => json!({"ok": true, "response": response}),
        Err(error) => json!({"ok": false, "error": error}),
    };
    let mut response = completed;
    if let Some(data) = response.get_mut("data").and_then(Value::as_object_mut) {
        data.insert("terminal_plan".to_string(), json!(terminal_plan_update));
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
    let job = kernel.enqueue_submit_patch_job(
        task_id,
        agent_id,
        session_id,
        input["worktree_id"].as_str(),
        input["summary"].as_str(),
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
            "SELECT id, status FROM tasks WHERE id=?1 LIMIT 1",
            &[&task_id],
        )
        .ok()
        .and_then(|rows| rows.into_iter().next())
        .unwrap_or_else(|| json!({}));
    let terminal_plan_update = kernel
        .finish_terminal_todo_plan_for_task(
            &task_id,
            "completed",
            Some(&agent_id),
            Some(&session_id),
        )
        .unwrap_or_else(|error| {
            Some(json!({
                "ok": false,
                "error": error,
            }))
        });
    let terminal_plan_compact = terminal_plan_update.as_ref().and_then(|value| {
        value
            .get("compact_plan")
            .filter(|compact| value_has_content(compact))
    });
    let cloud = match crate::cloud_mcp_forward_agent_submit_patch(
        Some(repo_path.as_str()),
        db_path.as_deref(),
        workspace_id.as_deref(),
        Some(agent_id.as_str()),
        Some(session_id.as_str()),
        Some(task_id.as_str()),
        worktree_id.as_deref(),
        worktree_path.as_deref(),
        summary.as_deref(),
        task_after["status"].as_str(),
        &submitted,
        terminal_plan_compact,
    ) {
        Ok(response) => json!({"ok": true, "response": response}),
        Err(error) => json!({"ok": false, "error": error}),
    };
    let mut result = submitted;
    if let Some(data) = result.get_mut("data").and_then(Value::as_object_mut) {
        data.insert("terminal_plan".to_string(), json!(terminal_plan_update));
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
    let session_enforcement = session["enforcement_mode"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("coordination_only");
    let current_enforcement = object
        .get("enforcement_mode")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    let refresh_authority = current_enforcement.is_empty()
        || matches!(
            current_enforcement,
            "general_worker" | "coordination_only" | "activity_only" | "read_only"
        )
        || session_enforcement == "worktree_required";
    if refresh_authority {
        object.insert(
            "enforcement_mode".to_string(),
            Value::String(session_enforcement.to_string()),
        );
        if let Some(value) = session["worktree_id"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
        {
            object.insert("worktree_id".to_string(), Value::String(value.to_string()));
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
        .unwrap_or(session_enforcement);
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
        if missing || refresh_authority {
            object.insert(key.to_string(), Value::String(value.to_string()));
        }
    }
}

fn coordination_authority_for_enforcement_mode(
    enforcement_mode: &str,
) -> (&'static str, &'static str, &'static str) {
    match enforcement_mode {
        "general_worker" => ("general", "task_scoped", "complete_task"),
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
        "start_task" => "Start the local coordination task only after read-only inspection, immediately before active work. Omit task_id on the first call; Rust creates the task immediately for leases, checkpoints, patches, or direct/activity completion, then preserves its lifecycle to Cloud history in the background.".to_string(),
        "architecture_context" => "Return the repo-scoped Diff Forge architecture/system-graph contract, storage paths, semantic schema, DSL rules, existing graph summaries, compact actor-node guidance, API corridor guidance, run-target guidance, and icon-reference path, plus globalArchitecturesRoot/globalGraphsRoot for account-global graphs that sync across devices. Call this before architecture, diagram, deployment, API pathway, API corridor, data-flow, control-graph, state-machine, dependency-graph, run-target, or subsystem visualization work, then edit .agents/architectures/graphs/*.arch directly (or write into globalGraphsRoot for account-wide cross-repo graphs) so the Architectures tab reloads file changes live.".to_string(),
        "architecture_list" => "List repo-scoped architecture graphs stored under .agents/architectures/graphs/*.arch for the selected repo.".to_string(),
        "architecture_icon_reference" => "Return supported architecture icon aliases, semantic group/node/edge schema, and package-resolution rules for semantic, cloud, tech, company, product, framework, and fallback icons. Use this when choosing icon names and semantic props for .arch DSL groups, nodes, and edges.".to_string(),
        "architecture_revision_list" => "List local-only architecture revision snapshots for one graph or the repo. Use only for explicit history, comparison, recovery, or deleted-graph restore work; normal latest graph context never reads revisions.".to_string(),
        "architecture_revision_read" => "Read one local-only architecture revision snapshot by graph_id and revision_id. Use explicit revision reads only when the user asks to compare, recover, or reuse old architecture content.".to_string(),
        "architecture_revision_restore" => "Restore one local-only architecture revision into .agents/architectures/graphs/<graph-id>.arch or .json and record the restore as a fresh revision. Use only after the user requests recovery or chooses a revision.".to_string(),
        "list_todo_targets" => "List same-account device/workspace targets from the local Rust SQLite todo mirror. Rust sync keeps this mirror current; this tool does not refresh Cloud during the call. Use this before send_todos instead of guessing device ids.".to_string(),
        "send_todos" => "Send one or more cloud todos to one or more same-account device/workspace targets and return a batch id plus child dispatch ids. Supports single text/target shortcuts and multi-item/multi-target fanout. mode=listed leaves normal listed todos; mode=queued actively queues online targets and lets Cloud fall back for offline targets.".to_string(),
        "get_todo_status" => "Return compact current status rows for todo batches, dispatch ids, todo ids, or target filters from the local Rust SQLite todo mirror only. Rust sync keeps this mirror current; this tool does not refresh Cloud during the call.".to_string(),
        "wait_for_todos" => "Wait inside the local Rust proxy over local SQLite todo status until selected todo dispatches satisfy until=terminal, accepted, or running, then return compact status. Do not manually sleep/poll from the coding agent.".to_string(),
        "list_todo_history" => "List compact recent todo dispatch history from the local Rust SQLite mirror for this workspace/repo, including origin/target devices, statuses, dispatch ids, batch ids, and body refs/previews. Rust sync keeps this mirror current; this tool does not refresh Cloud during the call.".to_string(),
        "list_assets" => "List compact asset library rows from the local Rust SQLite mirror for this workspace/repo, including local/cloud availability, hashes, sizes, recent transfer status, and transfer device metadata. Rust sync keeps this mirror current; this tool does not refresh Cloud during the call.".to_string(),
        "get_asset_root" => "Return the cross-platform account/device Diff Forge asset root. For generated or reusable media, write files under this root, then call upload_asset with the written path.".to_string(),
        "upload_asset" => "Upload one local file as an account-wide Diff Forge asset. Rust computes sha256/size, updates the local asset mirror, asks Cloud to dedupe or prepare upload, and streams bytes only when Cloud needs the blob.".to_string(),
        "upload_asset_status" => "Read recent upload transfer status from the local Rust asset mirror, including uploads started by other devices after app-level realtime sync. Filter by asset_id, asset_ids, transfer_id, transfer_ids, device_id, active_only, or status.".to_string(),
        "download_asset" => "Download one Cloud asset into the device-level Diff Forge asset library by default, or a caller-provided target directory. Copy into a repo only when the project explicitly needs a static project file.".to_string(),
        "download_asset_status" => "Read recent download transfer status from the local Rust asset mirror, including downloads started by other devices after app-level realtime sync. Filter by asset_id, asset_ids, transfer_id, transfer_ids, device_id, active_only, or status.".to_string(),
        "delete_local_asset" => "Delete this device's local asset file/copy and clear the active local path in the Rust SQLite mirror while preserving the Cloud copy for download later.".to_string(),
        "delete_cloud_asset" => "Delete the Cloud durable copy/reference for an asset, including backing blob storage when no active cloud references remain, while keeping any local file path recorded in the Rust SQLite mirror so it can be uploaded again.".to_string(),
        "acquire_lease" => "Acquire a lease for a task that was explicitly started in this session. You must pass the task_id returned by start_task; implicit session defaults are rejected.".to_string(),
        "checkpoint" => "Send one short summary only while an active started task exists. You may also advance or revise the terminal todo plan with current/next/completed step fields, step title/detail fields, or step_updates. You must pass the task_id returned by start_task; read-only file inspection should not create checkpoints.".to_string(),
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
        "architecture_context" => json!({
            "type": "object",
            "properties": {
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."}
            },
            "additionalProperties": true
        }),
        "architecture_list" => json!({
            "type": "object",
            "properties": {
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."}
            },
            "additionalProperties": true
        }),
        "architecture_icon_reference" => json!({
            "type": "object",
            "properties": {
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."}
            },
            "additionalProperties": true
        }),
        "architecture_revision_list" => json!({
            "type": "object",
            "properties": {
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."},
                "graph_id": {"type": "string", "description": "Optional architecture graph id. Omit to list local-only revisions across the repo, including deleted graph snapshots."}
            },
            "additionalProperties": true
        }),
        "architecture_revision_read" => json!({
            "type": "object",
            "properties": {
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."},
                "graph_id": {"type": "string", "description": "Required architecture graph id."},
                "revision_id": {"type": "string", "description": "Required local-only architecture revision id from architecture_revision_list."}
            },
            "required": ["graph_id", "revision_id"],
            "additionalProperties": true
        }),
        "architecture_revision_restore" => json!({
            "type": "object",
            "properties": {
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."},
                "graph_id": {"type": "string", "description": "Required architecture graph id."},
                "revision_id": {"type": "string", "description": "Required local-only architecture revision id to restore."}
            },
            "required": ["graph_id", "revision_id"],
            "additionalProperties": true
        }),
        "list_todo_targets" => json!({
            "type": "object",
            "properties": {
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."},
                "workspace_id": {"type": "string", "description": "Optional observer/source workspace id. Defaults to the current coordination workspace."}
            },
            "additionalProperties": true
        }),
        "send_todos" => json!({
            "type": "object",
            "properties": {
                "client_request_id": {"type": "string", "description": "Optional caller label for retrying the same batch. When omitted, Cloud derives stable ids from the synced todo text and targets."},
                "batch_id": {"type": "string", "description": "Optional stable batch id. When omitted, Cloud derives one and returns it as todo_batch_id/batch_id."},
                "mode": {"type": "string", "enum": ["queued", "listed"], "description": "queued creates remote dispatches for online targets and lets Cloud fall back for offline targets. listed creates listed todos only.", "default": "queued"},
                "fanout": {"type": "string", "enum": ["matrix", "pairs"], "description": "matrix sends every item to every target; pairs zips items and targets.", "default": "matrix"},
                "items": {
                    "type": "array",
                    "description": "Todo items. Each item should include text/body/prompt and optional item_id/title/todo_id.",
                    "items": {"type": "object", "additionalProperties": true}
                },
                "targets": {
                    "type": "array",
                    "description": "Targets from list_todo_targets. Each target requires target_device_id and target_workspace_id.",
                    "items": {"type": "object", "additionalProperties": true}
                },
                "text": {"type": "string", "description": "Shortcut for a single-item batch."},
                "target_device_id": {"type": "string", "description": "Shortcut for a single-target batch."},
                "target_workspace_id": {"type": "string", "description": "Shortcut for a single-target batch."},
                "target_workspace_name": {"type": "string", "description": "Optional target workspace label from list_todo_targets."},
                "target_device_name": {"type": "string", "description": "Optional target device label from list_todo_targets."},
                "target_terminal_index": {"type": "integer", "description": "Optional terminal index on the target device when mode=queued."},
                "target_agent_id": {"type": "string", "description": "Optional target agent id/role when mode=queued."},
                "target_terminal_id": {"type": "string", "description": "Optional target terminal pane id when mode=queued."},
                "target_thread_id": {"type": "string", "description": "Optional target thread id when mode=queued."},
                "todo_id": {"type": "string", "description": "Optional caller-provided todo id for idempotency."},
                "workspace_id": {"type": "string", "description": "Optional source workspace id."}
            },
            "additionalProperties": true
        }),
        "get_todo_status" => json!({
            "type": "object",
            "properties": {
                "batch_id": {"type": "string", "description": "Optional batch id returned by send_todos."},
                "dispatch_id": {"type": "string", "description": "Optional dispatch id."},
                "dispatch_ids": {"type": "array", "items": {"type": "string"}},
                "todo_id": {"type": "string", "description": "Optional todo id."},
                "target_device_id": {"type": "string"},
                "target_workspace_id": {"type": "string"},
                "status": {"type": "string"},
                "limit": {"type": "integer", "description": "Maximum compact rows to return.", "default": 100}
            },
            "additionalProperties": true
        }),
        "wait_for_todos" => json!({
            "type": "object",
            "properties": {
                "batch_id": {"type": "string", "description": "Batch id returned by send_todos."},
                "dispatch_id": {"type": "string", "description": "Optional single dispatch id."},
                "dispatch_ids": {"type": "array", "items": {"type": "string"}},
                "until": {"type": "string", "enum": ["terminal", "accepted", "running"], "default": "terminal"},
                "timeout_ms": {"type": "integer", "description": "Bounded wait timeout. Values above 30000 are capped locally.", "default": 30000, "maximum": 30000}
            },
            "additionalProperties": true
        }),
        "list_todo_history" => json!({
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Maximum recent compact rows.", "default": 50},
                "batch_id": {"type": "string"},
                "target_device_id": {"type": "string"},
                "target_workspace_id": {"type": "string"},
                "origin_device_id": {"type": "string"},
                "origin_workspace_id": {"type": "string"},
                "status": {"type": "string"}
            },
            "additionalProperties": true
        }),
        "list_assets" => json!({
            "type": "object",
            "properties": {
                "workspace_id": {"type": "string", "description": "Optional workspace id. Defaults to the current coordination workspace."},
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."},
                "asset_id": {"type": "string", "description": "Optional asset id filter."},
                "asset_ids": {"type": "array", "description": "Optional asset id filters.", "items": {"type": "string"}},
                "status": {"type": "string", "description": "Optional asset status filter."},
                "kind": {"type": "string", "description": "Optional asset kind filter, for example image, video, audio, pdf, archive, or document."},
                "direction": {"type": "string", "description": "Optional transfer direction filter: upload or download."},
                "transfer_status": {"type": "string", "description": "Optional transfer status filter. Use active for in-flight transfers."},
                "active_only": {"type": "boolean", "description": "When true, return active/in-flight transfers only.", "default": false},
                "device_id": {"type": "string", "description": "Optional device/machine id filter for asset origin or transfer owner."},
                "device_ids": {"type": "array", "description": "Optional device/machine id filters.", "items": {"type": "string"}},
                "limit": {"type": "integer", "description": "Maximum compact rows to return.", "default": 100, "maximum": 1000}
            },
            "additionalProperties": true
        }),
        "get_asset_root" => json!({
            "type": "object",
            "properties": {
                "workspace_id": {"type": "string", "description": "Optional requesting workspace id. Defaults to the current coordination workspace."},
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."},
                "asset_id": {"type": "string", "description": "Optional caller-provided account asset id for a suggested local path."},
                "name": {"type": "string", "description": "Optional preferred filename for a suggested local path, for example chocolate.png."},
                "filename": {"type": "string", "description": "Alias for name."},
                "mime_type": {"type": "string", "description": "Optional MIME type used to infer an extension for the suggested local path."},
                "extension": {"type": "string", "description": "Optional extension without a leading dot."},
                "group": {"type": "string", "description": "Optional managed library subfolder, defaults to generated."},
                "source_kind": {"type": "string", "description": "Optional provenance/source label used for the suggested subfolder."}
            },
            "additionalProperties": true
        }),
        "upload_asset" => json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Required local path to upload as an account-wide asset."},
                "local_path": {"type": "string", "description": "Alias for path."},
                "workspace_id": {"type": "string", "description": "Optional requesting workspace id. Defaults to the current coordination workspace."},
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."},
                "asset_id": {"type": "string", "description": "Optional caller-provided account asset id. Omit to let Rust derive one from file metadata."},
                "name": {"type": "string", "description": "Optional display name."},
                "filename": {"type": "string", "description": "Alias for name."},
                "mime_type": {"type": "string", "description": "Optional MIME type override."},
                "kind": {"type": "string", "description": "Optional asset kind override."},
                "source_kind": {"type": "string", "description": "Optional provenance/source label."},
                "metadata": {"type": "object", "description": "Optional metadata to store with the asset.", "additionalProperties": true}
            },
            "required": ["path"],
            "additionalProperties": true
        }),
        "upload_asset_status" => json!({
            "type": "object",
            "properties": {
                "asset_id": {"type": "string", "description": "Optional asset id filter."},
                "asset_ids": {"type": "array", "description": "Optional asset id filters.", "items": {"type": "string"}},
                "transfer_id": {"type": "string", "description": "Optional upload transfer id filter."},
                "transfer_ids": {"type": "array", "description": "Optional upload transfer id filters.", "items": {"type": "string"}},
                "device_id": {"type": "string", "description": "Optional uploading device/machine id filter."},
                "device_ids": {"type": "array", "description": "Optional uploading device/machine id filters.", "items": {"type": "string"}},
                "active_only": {"type": "boolean", "description": "When true, return active/in-flight uploads only.", "default": false},
                "status": {"type": "string", "description": "Optional upload transfer status filter. Use active for in-flight uploads."},
                "workspace_id": {"type": "string", "description": "Optional workspace id. Defaults to the current coordination workspace."},
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."},
                "limit": {"type": "integer", "description": "Maximum recent transfer rows.", "default": 100, "maximum": 1000}
            },
            "additionalProperties": true
        }),
        "download_asset" => json!({
            "type": "object",
            "properties": {
                "asset_id": {"type": "string", "description": "Required Cloud asset id to download."},
                "workspace_id": {"type": "string", "description": "Optional workspace id. Defaults to the current coordination workspace."},
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."},
                "target_directory": {"type": "string", "description": "Optional download directory. Defaults to the device-level Diff Forge asset library."}
            },
            "required": ["asset_id"],
            "additionalProperties": true
        }),
        "download_asset_status" => json!({
            "type": "object",
            "properties": {
                "asset_id": {"type": "string", "description": "Optional asset id filter."},
                "asset_ids": {"type": "array", "description": "Optional asset id filters.", "items": {"type": "string"}},
                "transfer_id": {"type": "string", "description": "Optional download transfer id filter."},
                "transfer_ids": {"type": "array", "description": "Optional download transfer id filters.", "items": {"type": "string"}},
                "device_id": {"type": "string", "description": "Optional downloading device/machine id filter."},
                "device_ids": {"type": "array", "description": "Optional downloading device/machine id filters.", "items": {"type": "string"}},
                "active_only": {"type": "boolean", "description": "When true, return active/in-flight downloads only.", "default": false},
                "status": {"type": "string", "description": "Optional download transfer status filter. Use active for in-flight downloads."},
                "workspace_id": {"type": "string", "description": "Optional workspace id. Defaults to the current coordination workspace."},
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."},
                "limit": {"type": "integer", "description": "Maximum recent transfer rows.", "default": 100, "maximum": 1000}
            },
            "additionalProperties": true
        }),
        "delete_local_asset" => json!({
            "type": "object",
            "properties": {
                "asset_id": {"type": "string", "description": "Required asset id whose local device copy should be deleted."},
                "workspace_id": {"type": "string", "description": "Optional workspace id. Defaults to the current coordination workspace."},
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."},
                "delete_file": {"type": "boolean", "description": "When true, remove the file from disk as well as clearing the active local path.", "default": true}
            },
            "required": ["asset_id"],
            "additionalProperties": true
        }),
        "delete_cloud_asset" => json!({
            "type": "object",
            "properties": {
                "asset_id": {"type": "string", "description": "Required asset id whose Cloud copy/reference should be deleted."},
                "workspace_id": {"type": "string", "description": "Optional workspace id. Defaults to the current coordination workspace."},
                "repo_path": {"type": "string", "description": "Optional repo path. Defaults to the coordination context repo."}
            },
            "required": ["asset_id"],
            "additionalProperties": true
        }),
        "checkpoint" => json!({
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Required task_id returned by start_task. Do not rely on implicit session defaults."},
                "summary": {"type": "string", "description": "One short public summary of active task progress. Do not call checkpoint before start_task."},
                "completed_step_index": {"type": "integer", "description": "Optional zero-based plan step index to mark completed."},
                "next_step_index": {"type": "integer", "description": "Optional zero-based plan step index to mark current/in progress."},
                "current_step_index": {"type": "integer", "description": "Optional zero-based plan step index to mark current/in progress."},
                "current_step_title": {"type": "string", "description": "Optional title revision for the current/next step touched by this checkpoint."},
                "next_step_title": {"type": "string", "description": "Optional title revision for the current/next step touched by this checkpoint."},
                "next_step_detail": {"type": "string", "description": "Optional detail to attach to the next/current step when it begins."},
                "step_updates": {"type": "array", "description": "Optional step title/detail/status revisions. Each item may include step_index, title, detail, and status."},
                "plan_status": {"type": "string", "description": "Optional terminal todo plan status: active, completed, interrupted, or blocked."}
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
    fn architecture_graph_only_start_task_plan_is_direct_live_work() {
        assert!(start_task_plan_is_direct_architecture_graph_work(
            "Create a new architecture graph for the React context auth flow."
        ));
        assert!(start_task_plan_is_direct_architecture_graph_work(
            "Update .agents/architectures/graphs/auth-flow.arch with the new API corridor."
        ));
        assert!(!start_task_plan_is_direct_architecture_graph_work(
            "Implement code for the auth flow based on the architecture graph."
        ));
        assert!(!start_task_plan_is_direct_architecture_graph_work(
            "Run architecture target Deploy and update src/deploy.ts."
        ));
    }

    #[test]
    fn lifecycle_tools_are_hidden_for_direct_unmanaged_policy() {
        let repo = std::env::temp_dir().join(format!(
            "diffforge-mcp-direct-unmanaged-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&repo).unwrap();
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        kernel
            .update_repo_policy(&json!({"agent_session_mode": "direct_unmanaged"}))
            .unwrap();

        let session_context = McpContext {
            repo_path: Some(repo.display().to_string()),
            db_path: Some(kernel.paths.db_path.display().to_string()),
            session_id: Some("session-direct".to_string()),
            ..McpContext::default()
        };
        let tools = coordination_tools_for_context(&session_context);
        for tool in TERMINAL_SESSION_TOOL_NAMES {
            assert!(
                !tools.contains(tool),
                "{tool} must be hidden in direct mode"
            );
        }
        for tool in [
            "architecture_context",
            "list_assets",
            "get_asset_root",
            "upload_asset",
            "upload_asset_status",
            "download_asset",
            "download_asset_status",
        ] {
            assert!(tools.contains(&tool), "{tool} must remain available");
        }

        let denied = dispatch_tool(
            &session_context,
            "start_task",
            json!({"plan": "Patch code"}),
        );
        assert_eq!(denied["ok"].as_bool(), Some(false));
        assert_eq!(denied["error"]["code"].as_str(), Some("unknown_tool"));

        kernel
            .update_repo_policy(&json!({"agent_session_mode": "direct_coordination"}))
            .unwrap();
        let restored = coordination_tools_for_context(&session_context);
        assert!(restored.contains(&"start_task"));
    }

    #[test]
    fn lifecycle_tools_are_hidden_without_terminal_session_context() {
        let external_context = McpContext::default();
        let external_tools = coordination_tools_for_context(&external_context);
        for tool in TERMINAL_SESSION_TOOL_NAMES {
            assert!(!external_tools.contains(tool));
        }
        assert!(!external_tools.contains(&"create_plan"));
        assert!(!external_tools.contains(&"update_plan"));

        let denied = dispatch_tool(
            &external_context,
            "start_task",
            json!({"plan": "Patch code"}),
        );
        assert_eq!(denied["ok"].as_bool(), Some(false));
        assert_eq!(denied["error"]["code"].as_str(), Some("unknown_tool"));
        assert!(!denied["error"]["details"]["allowed_tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool.as_str() == Some("start_task")));

        let session_context = McpContext {
            session_id: Some("session-1".to_string()),
            ..McpContext::default()
        };
        let session_tools = coordination_tools_for_context(&session_context);
        for tool in TERMINAL_SESSION_TOOL_NAMES {
            assert!(session_tools.contains(tool));
        }
    }

    #[test]
    fn cloud_start_task_agent_view_keeps_account_and_todo_context_only() {
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
                "account_data": {
                    "account_sync": {
                        "connected_device_count": 2,
                        "workspace_count": 3
                    },
                    "devices_connected_sync": {
                        "items": [{"device_id": "device-1", "metadata_json": {"keep": "ok"}}]
                    }
                },
                "todo_compression": {
                    "mode": "todos_with_cloud_llm_compression",
                    "todo_count": 13,
                    "chunk_count": 1,
                    "summary_items": [
                        {"item_kind": "compressed_todo_chunk", "summary": "Ten older todos"},
                        {"item_kind": "raw_todo", "todo_id": "todo-10"}
                    ]
                }
            },
            "task_history": {
                "kind": "task_history",
                "repo_id": "repo-test",
                "workspace_id": "workspace-test",
                "tasks": [
                    {"task_id": "task-old", "status": "done", "title": "Old task"},
                    {"task_id": "task-cloud-1", "status": "active", "title": "Cloud task"}
                ]
            }
        });

        let view = cloud_start_task_for_agent(&response);

        assert_eq!(view["ok"].as_bool(), Some(true));
        assert_eq!(view["task_id"].as_str(), Some("task-cloud-1"));
        assert_eq!(
            view["account_data"]["account_sync"]["connected_device_count"].as_u64(),
            Some(2)
        );
        assert_eq!(
            view["todo_compression"]["chunk_count"].as_u64(),
            Some(1)
        );
        assert_eq!(view["task_history"]["task_count"].as_u64(), Some(2));
        assert_eq!(view["spec_activity"]["recorded"].as_bool(), Some(true));
        assert!(view.get("event").is_none());
        assert!(view.get("context_pack").is_none());
        assert!(view.get("peer_work").is_none());
        assert!(view.get("spec_summary").is_none());
        assert!(view["task_history"].get("repo_id").is_none());
    }

    #[test]
    fn cloud_start_task_agent_view_exposes_source_todo_refs() {
        let response = json!({
            "task_id": "task-cloud-source",
            "task": {
                "id": "task-cloud-source",
                "todo_id": "todo-direct-1",
                "todo_dispatch_id": "dispatch-direct-1",
                "prompt_event_id": "prompt-event-direct-1",
                "metadata_json": {
                    "source_command_id": "command-direct-1"
                }
            },
            "spec_activity": {},
            "context_pack": {},
            "task_history": {"tasks": []}
        });

        let refs = cloud_start_task_source_refs(&response);
        assert_eq!(refs["source_todo_id"].as_str(), Some("todo-direct-1"));
        assert_eq!(
            refs["source_todo_dispatch_id"].as_str(),
            Some("dispatch-direct-1")
        );
        assert_eq!(
            refs["source_prompt_event_id"].as_str(),
            Some("prompt-event-direct-1")
        );
        assert_eq!(refs["source_command_id"].as_str(), Some("command-direct-1"));

        let view = cloud_start_task_for_agent(&response);
        assert_eq!(
            view["source_todo"]["todo_id"].as_str(),
            Some("todo-direct-1")
        );
        assert_eq!(
            view["source_todo"]["todo_dispatch_id"].as_str(),
            Some("dispatch-direct-1")
        );
        assert_eq!(
            view["source_todo"]["command_id"].as_str(),
            Some("command-direct-1")
        );
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

        let info_path = PathBuf::from(status["info_path"].as_str().unwrap_or_default());
        let info_text = fs::read_to_string(&info_path).unwrap();
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
        assert!(!info_path.exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn shared_daemon_stdio_proxy_self_heals_missing_info_file_and_initializes() {
        let root = std::env::temp_dir().join(format!(
            "diffforge_shared_mcp_proxy_self_heal_{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let kernel = CoordinationKernel::init(&root, None).unwrap();
        let info_path = daemon_info_path_for_repo(&kernel.paths.repo_path);
        let _ = fs::remove_file(&info_path);

        let args = vec![
            "--daemon-info".to_string(),
            info_path.display().to_string(),
            "--repo-path".to_string(),
            kernel.paths.repo_path.display().to_string(),
            "--db-path".to_string(),
            kernel.paths.db_path.display().to_string(),
            "--agent-id".to_string(),
            "agent-test".to_string(),
            "--session-id".to_string(),
            "session-test".to_string(),
        ];
        let context = McpContext::from_args(&args);
        let SharedDaemonProxyConnection {
            reader: mut daemon_reader,
            writer: mut daemon_writer,
        } = connect_shared_daemon_stdio_proxy(&args, &context).unwrap();

        assert!(info_path.exists());

        writeln!(
            daemon_writer,
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
        daemon_writer.flush().unwrap();

        let mut line = String::new();
        daemon_reader.read_line(&mut line).unwrap();
        let response: Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(response["id"].as_u64(), Some(1));
        assert_eq!(
            response["response"]["result"]["serverInfo"]["name"].as_str(),
            Some("diffforge-coordination-kernel")
        );

        let stopped = stop_shared_daemon_for_repo(&root, "test_cleanup").unwrap();
        assert_eq!(stopped["status"].as_str(), Some("stopped"));
        assert!(!info_path.exists());

        let _ = fs::remove_dir_all(root);
    }
}

fn req<'a>(input: &'a Value, key: &str) -> Result<&'a str, String> {
    input[key]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{key} is required."))
}

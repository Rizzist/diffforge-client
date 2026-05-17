use sysinfo::{
    Pid as SysPid, ProcessRefreshKind, ProcessesToUpdate, System as SysSystem, UpdateKind,
};

const DEVELOPER_PROCESS_CPU_WARNING_PERCENT: f64 = 65.0;
const DEVELOPER_PROCESS_MEMORY_WARNING_BYTES: u64 = 1024 * 1024 * 1024;
const DEVELOPER_PROCESS_COMMAND_LIMIT: usize = 4096;
const DOCKER_DEVELOPER_OUTPUT_LIMIT: usize = 4096;
const DOCKER_DEVELOPER_INSPECT_LIMIT: usize = 120;
const DEVELOPER_PROCESS_PORT_SCAN_LIMIT: usize = 2048;

struct DeveloperProcessMonitorState {
    system: Arc<StdMutex<SysSystem>>,
}

impl DeveloperProcessMonitorState {
    fn new() -> Self {
        let mut system = SysSystem::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            developer_process_refresh_kind(),
        );

        Self {
            system: Arc::new(StdMutex::new(system)),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeveloperProcessSnapshot {
    platform: &'static str,
    sampled_at_ms: u64,
    processes: Vec<DeveloperProcessInfo>,
    groups: Vec<DeveloperProcessGroup>,
    total_cpu_percent: f64,
    total_memory_bytes: u64,
    high_activity_count: usize,
    protected_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeveloperProcessInfo {
    pid: u32,
    parent_pid: Option<u32>,
    child_pids: Vec<u32>,
    child_count: usize,
    name: String,
    display_name: String,
    group_id: String,
    group_label: String,
    group_kind: String,
    icon_hint: String,
    command: String,
    executable: String,
    cwd: String,
    cpu_percent: f64,
    memory_bytes: u64,
    virtual_memory_bytes: u64,
    start_time: u64,
    run_time_seconds: u64,
    attribution: String,
    attribution_label: String,
    workspace_root: String,
    risk: String,
    killable: bool,
    kill_disabled_reason: String,
    kill_tree_default: bool,
    terminal_owned: bool,
    terminal_pane_id: String,
    terminal_instance_id: Option<u64>,
    terminal_workspace_id: String,
    terminal_workspace_name: String,
    terminal_index: Option<u16>,
    terminal_thread_id: String,
    terminal_agent_id: String,
    terminal_agent_kind: String,
    terminal_root_pid: Option<u32>,
    bound_ports: Vec<DeveloperProcessPort>,
}

#[derive(Serialize, Clone, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
struct DeveloperProcessPort {
    protocol: String,
    address: String,
    port: u16,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeveloperProcessGroup {
    id: String,
    label: String,
    kind: String,
    icon_hint: String,
    count: usize,
    pids: Vec<u32>,
    killable_count: usize,
    cpu_percent: f64,
    memory_bytes: u64,
    attribution: String,
    attribution_label: String,
    risk: String,
    child_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeveloperProcessKillResult {
    requested_pid: u32,
    include_tree: bool,
    force: bool,
    killed_pids: Vec<u32>,
    failed_pids: Vec<u32>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DockerDeveloperActionResult {
    action: String,
    target_count: usize,
    succeeded: usize,
    failed: usize,
    skipped: Vec<String>,
    commands: Vec<DockerDeveloperCommandResult>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DockerDeveloperCommandResult {
    program: String,
    args: Vec<String>,
    cwd: String,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    success: bool,
    duration_ms: u64,
    target_label: String,
    target_container_id: String,
    target_container_name: String,
    target_compose_project: String,
    target_compose_service: String,
    target_compose_working_dir: String,
    target_compose_config_files: Vec<String>,
    target_workspace_links: Vec<String>,
}

#[derive(Clone)]
struct DockerDeveloperTarget {
    container_id: String,
    container_name: String,
    compose_project: String,
    compose_service: String,
    compose_working_dir: String,
    compose_config_files: Vec<String>,
    workspace_linked: bool,
    workspace_links: Vec<String>,
}

#[derive(Clone, Copy)]
enum DockerDeveloperAction {
    Relaunch,
    RebuildRelaunch,
    RemountData,
}

enum DockerComposeCommand {
    Plugin,
    Standalone,
}

#[derive(Clone)]
struct DeveloperProcessClassification {
    group_id: &'static str,
    group_label: &'static str,
    group_kind: &'static str,
    icon_hint: &'static str,
    display_name: &'static str,
    risk_hint: &'static str,
    protected: bool,
}

struct DeveloperProcessAttribution {
    id: &'static str,
    label: &'static str,
    workspace_root: String,
}

struct DeveloperProcessGroupBuilder {
    id: String,
    label: String,
    kind: String,
    icon_hint: String,
    count: usize,
    pids: Vec<u32>,
    killable_count: usize,
    cpu_percent: f64,
    memory_bytes: u64,
    attribution_ids: HashSet<String>,
    risk: String,
    child_count: usize,
}

#[derive(Clone)]
struct DeveloperTerminalProcessRoot {
    root_pid: u32,
    pane_id: String,
    instance_id: u64,
    workspace_id: String,
    workspace_name: String,
    terminal_index: Option<u16>,
    thread_id: String,
    agent_id: String,
    agent_kind: String,
}

#[tauri::command]
async fn list_developer_processes(
    state: State<'_, DeveloperProcessMonitorState>,
    terminal_state: State<'_, TerminalState>,
    active_workspace_root: Option<String>,
    workspace_roots: Vec<String>,
) -> Result<DeveloperProcessSnapshot, String> {
    let active_workspace_root = normalize_optional_process_root(active_workspace_root.as_deref());
    let workspace_roots =
        normalize_process_roots(workspace_roots, active_workspace_root.as_deref());
    let app_pid = std::process::id();

    let terminal_roots = developer_terminal_process_roots(&terminal_state).await;
    let bound_ports_by_pid = tauri::async_runtime::spawn_blocking(developer_bound_ports_by_pid)
        .await
        .unwrap_or_default();

    let (
        processes,
        groups,
        total_cpu_percent,
        total_memory_bytes,
        high_activity_count,
        protected_count,
    ) = {
        let mut system = state
            .system
            .lock()
            .map_err(|_| "Process monitor state is unavailable.".to_string())?;
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            developer_process_refresh_kind(),
        );

        let parent_map = developer_parent_map(&system);
        let child_map = developer_child_map(&system);
        let terminal_roots_by_pid = terminal_roots
            .iter()
            .map(|root| (root.root_pid, root))
            .collect::<HashMap<_, _>>();
        let mut processes = Vec::new();

        for (pid, process) in system.processes() {
            let pid_u32 = pid.as_u32();
            if pid_u32 == app_pid {
                continue;
            }

            let parent_pid = process.parent().map(|value| value.as_u32());
            let terminal_link =
                developer_terminal_link_for_process(pid_u32, &terminal_roots_by_pid, &parent_map);
            let name = clean_process_text(&process.name().to_string_lossy());
            let command = process_command_text(process.cmd());
            let executable = process.exe().map(process_path_display).unwrap_or_default();
            let cwd = process.cwd().map(process_path_display).unwrap_or_default();
            let attribution = if terminal_link.is_some() {
                DeveloperProcessAttribution {
                    id: "diffForge",
                    label: "Diff Forge terminal",
                    workspace_root: String::new(),
                }
            } else {
                developer_process_attribution(
                    &cwd,
                    &executable,
                    &command,
                    &active_workspace_root,
                    &workspace_roots,
                    pid_u32,
                    app_pid,
                    &parent_map,
                )
            };
            let is_attributed = attribution.id != "system";
            let Some(classification) =
                classify_developer_process(&name, &executable, &command, is_attributed)
            else {
                continue;
            };

            let child_pids = child_map.get(&pid_u32).cloned().unwrap_or_default();
            let child_count = developer_descendant_count(pid_u32, &child_map);
            let risk = developer_process_risk(&classification, &attribution);
            let kill_disabled_reason =
                developer_kill_disabled_reason(pid_u32, &classification, &risk);
            let killable = kill_disabled_reason.is_empty();

            processes.push(DeveloperProcessInfo {
                pid: pid_u32,
                parent_pid,
                child_pids,
                child_count,
                name,
                display_name: classification.display_name.to_string(),
                group_id: classification.group_id.to_string(),
                group_label: classification.group_label.to_string(),
                group_kind: classification.group_kind.to_string(),
                icon_hint: classification.icon_hint.to_string(),
                command,
                executable,
                cwd,
                cpu_percent: f64::from(process.cpu_usage()).max(0.0),
                memory_bytes: process.memory(),
                virtual_memory_bytes: process.virtual_memory(),
                start_time: process.start_time(),
                run_time_seconds: process.run_time(),
                attribution: attribution.id.to_string(),
                attribution_label: attribution.label.to_string(),
                workspace_root: attribution.workspace_root,
                risk,
                killable,
                kill_disabled_reason,
                kill_tree_default: matches!(
                    attribution.id,
                    "currentWorkspace" | "workspace" | "diffForge"
                ),
                terminal_owned: terminal_link.is_some(),
                terminal_pane_id: terminal_link
                    .map(|link| link.pane_id.clone())
                    .unwrap_or_default(),
                terminal_instance_id: terminal_link.map(|link| link.instance_id),
                terminal_workspace_id: terminal_link
                    .map(|link| link.workspace_id.clone())
                    .unwrap_or_default(),
                terminal_workspace_name: terminal_link
                    .map(|link| link.workspace_name.clone())
                    .unwrap_or_default(),
                terminal_index: terminal_link.and_then(|link| link.terminal_index),
                terminal_thread_id: terminal_link
                    .map(|link| link.thread_id.clone())
                    .unwrap_or_default(),
                terminal_agent_id: terminal_link
                    .map(|link| link.agent_id.clone())
                    .unwrap_or_default(),
                terminal_agent_kind: terminal_link
                    .map(|link| link.agent_kind.clone())
                    .unwrap_or_default(),
                terminal_root_pid: terminal_link.map(|link| link.root_pid),
                bound_ports: bound_ports_by_pid
                    .get(&pid_u32)
                    .cloned()
                    .unwrap_or_default(),
            });
        }

        processes.sort_by(|left, right| {
            developer_attribution_rank(&left.attribution)
                .cmp(&developer_attribution_rank(&right.attribution))
                .then_with(|| {
                    developer_risk_rank(&right.risk).cmp(&developer_risk_rank(&left.risk))
                })
                .then_with(|| {
                    right
                        .cpu_percent
                        .partial_cmp(&left.cpu_percent)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .then_with(|| right.memory_bytes.cmp(&left.memory_bytes))
                .then_with(|| left.group_label.cmp(&right.group_label))
                .then_with(|| left.pid.cmp(&right.pid))
        });

        let groups = developer_process_groups(&processes);
        let total_cpu_percent = processes.iter().map(|process| process.cpu_percent).sum();
        let total_memory_bytes = processes
            .iter()
            .map(|process| process.memory_bytes)
            .fold(0u64, u64::saturating_add);
        let high_activity_count = processes
            .iter()
            .filter(|process| {
                process.cpu_percent >= DEVELOPER_PROCESS_CPU_WARNING_PERCENT
                    || process.memory_bytes >= DEVELOPER_PROCESS_MEMORY_WARNING_BYTES
            })
            .count();
        let protected_count = processes.iter().filter(|process| !process.killable).count();

        (
            processes,
            groups,
            total_cpu_percent,
            total_memory_bytes,
            high_activity_count,
            protected_count,
        )
    };

    Ok(DeveloperProcessSnapshot {
        platform: developer_process_platform(),
        sampled_at_ms: current_time_ms(),
        processes,
        groups,
        total_cpu_percent,
        total_memory_bytes,
        high_activity_count,
        protected_count,
    })
}

async fn developer_terminal_process_roots(
    terminal_state: &TerminalState,
) -> Vec<DeveloperTerminalProcessRoot> {
    let instances = {
        let terminals = terminal_state.terminals.read().await;
        terminals
            .iter()
            .map(|(pane_id, instance)| (pane_id.clone(), instance.clone()))
            .collect::<Vec<_>>()
    };

    let mut roots = Vec::new();
    for (pane_id, instance) in instances {
        let child = instance.child.lock().await;
        let Some(root_pid) = child.as_ref().and_then(|child| child.process_id()) else {
            continue;
        };
        if root_pid == 0 {
            continue;
        }

        let metadata = instance.metadata.clone();
        roots.push(DeveloperTerminalProcessRoot {
            root_pid,
            pane_id: if metadata.pane_id.is_empty() {
                pane_id
            } else {
                metadata.pane_id
            },
            instance_id: instance.id,
            workspace_id: metadata.workspace_id,
            workspace_name: metadata.workspace_name,
            terminal_index: metadata.terminal_index,
            thread_id: metadata.thread_id,
            agent_id: metadata.agent_id,
            agent_kind: metadata.agent_kind,
        });
    }

    roots
}

fn developer_terminal_link_for_process<'a>(
    pid: u32,
    terminal_roots_by_pid: &HashMap<u32, &'a DeveloperTerminalProcessRoot>,
    parent_map: &HashMap<u32, u32>,
) -> Option<&'a DeveloperTerminalProcessRoot> {
    let mut seen = HashSet::new();
    let mut current = pid;

    loop {
        if let Some(root) = terminal_roots_by_pid.get(&current) {
            return Some(*root);
        }
        if !seen.insert(current) {
            return None;
        }
        let Some(parent) = parent_map.get(&current) else {
            return None;
        };
        current = *parent;
    }
}

fn developer_bound_ports_by_pid() -> HashMap<u32, Vec<DeveloperProcessPort>> {
    let mut ports_by_pid = developer_bound_ports_by_pid_platform();

    for ports in ports_by_pid.values_mut() {
        ports.sort_by(|left, right| {
            left.port
                .cmp(&right.port)
                .then_with(|| left.protocol.cmp(&right.protocol))
                .then_with(|| left.address.cmp(&right.address))
        });
        ports.dedup();
        if ports.len() > 8 {
            ports.truncate(8);
        }
    }

    ports_by_pid
}

#[cfg(windows)]
fn developer_bound_ports_by_pid_platform() -> HashMap<u32, Vec<DeveloperProcessPort>> {
    developer_bound_ports_from_netstat()
}

#[cfg(target_os = "linux")]
fn developer_bound_ports_by_pid_platform() -> HashMap<u32, Vec<DeveloperProcessPort>> {
    let ss_ports = developer_bound_ports_from_ss();
    if !ss_ports.is_empty() {
        return ss_ports;
    }

    developer_bound_ports_from_lsof()
}

#[cfg(all(unix, not(target_os = "linux")))]
fn developer_bound_ports_by_pid_platform() -> HashMap<u32, Vec<DeveloperProcessPort>> {
    developer_bound_ports_from_lsof()
}

#[cfg(not(any(windows, unix)))]
fn developer_bound_ports_by_pid_platform() -> HashMap<u32, Vec<DeveloperProcessPort>> {
    HashMap::new()
}

#[cfg(windows)]
fn developer_bound_ports_from_netstat() -> HashMap<u32, Vec<DeveloperProcessPort>> {
    let output = Command::new("netstat")
        .args(["-ano"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    let Ok(output) = output else {
        return HashMap::new();
    };
    if !output.status.success() {
        return HashMap::new();
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut ports_by_pid = HashMap::new();

    for line in text.lines().take(DEVELOPER_PROCESS_PORT_SCAN_LIMIT) {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.is_empty() {
            continue;
        }

        let protocol = parts[0].to_ascii_lowercase();
        if protocol == "tcp" {
            if parts.len() < 5 || !parts[3].eq_ignore_ascii_case("LISTENING") {
                continue;
            }
            let Some(port) = developer_process_port_from_address(parts[1], &protocol) else {
                continue;
            };
            if let Ok(pid) = parts[4].parse::<u32>() {
                ports_by_pid.entry(pid).or_insert_with(Vec::new).push(port);
            }
        } else if protocol == "udp" {
            if parts.len() < 4 {
                continue;
            }
            let Some(port) = developer_process_port_from_address(parts[1], &protocol) else {
                continue;
            };
            if let Some(pid_text) = parts.last() {
                if let Ok(pid) = pid_text.parse::<u32>() {
                    ports_by_pid.entry(pid).or_insert_with(Vec::new).push(port);
                }
            }
        }
    }

    ports_by_pid
}

#[cfg(target_os = "linux")]
fn developer_bound_ports_from_ss() -> HashMap<u32, Vec<DeveloperProcessPort>> {
    let output = Command::new("ss")
        .args(["-H", "-ltnup"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    let Ok(output) = output else {
        return HashMap::new();
    };
    if !output.status.success() {
        return HashMap::new();
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut ports_by_pid = HashMap::new();

    for line in text.lines().take(DEVELOPER_PROCESS_PORT_SCAN_LIMIT) {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 5 {
            continue;
        }

        let protocol = parts[0].to_ascii_lowercase();
        if !(protocol.starts_with("tcp") || protocol.starts_with("udp")) {
            continue;
        }
        if protocol.starts_with("tcp") && !line.to_ascii_lowercase().contains("listen") {
            continue;
        }

        let Some(port) = developer_process_port_from_address(parts[4], &protocol) else {
            continue;
        };
        for pid in developer_process_pids_from_ss_line(line) {
            ports_by_pid
                .entry(pid)
                .or_insert_with(Vec::new)
                .push(port.clone());
        }
    }

    ports_by_pid
}

#[cfg(unix)]
fn developer_bound_ports_from_lsof() -> HashMap<u32, Vec<DeveloperProcessPort>> {
    let output = Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-iUDP"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    let Ok(output) = output else {
        return HashMap::new();
    };
    if !output.status.success() {
        return HashMap::new();
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut ports_by_pid = HashMap::new();

    for line in text.lines().skip(1).take(DEVELOPER_PROCESS_PORT_SCAN_LIMIT) {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 9 {
            continue;
        }
        let Ok(pid) = parts[1].parse::<u32>() else {
            continue;
        };

        let Some(protocol_index) = parts
            .iter()
            .position(|part| part.eq_ignore_ascii_case("tcp") || part.eq_ignore_ascii_case("udp"))
        else {
            continue;
        };
        let protocol = parts[protocol_index].to_ascii_lowercase();
        if protocol == "tcp" && !line.to_ascii_lowercase().contains("(listen)") {
            continue;
        }
        let Some(address) = parts.get(protocol_index + 1) else {
            continue;
        };
        let Some(port) = developer_process_port_from_address(address, &protocol) else {
            continue;
        };

        ports_by_pid.entry(pid).or_insert_with(Vec::new).push(port);
    }

    ports_by_pid
}

fn developer_process_port_from_address(
    value: &str,
    protocol: &str,
) -> Option<DeveloperProcessPort> {
    let mut text = value.trim().trim_end_matches(',');
    if let Some(index) = text.rfind("->") {
        text = &text[..index];
    }
    if text.ends_with(":*") {
        return None;
    }

    let port_start = text.rfind(':')?;
    let port_text = text[port_start + 1..].trim_matches('*');
    let port = port_text.parse::<u16>().ok()?;
    let mut address = text[..port_start].trim().to_string();
    if address.starts_with('[') && address.ends_with(']') {
        address = address[1..address.len().saturating_sub(1)].to_string();
    }
    if address.is_empty() {
        address = "*".to_string();
    }

    Some(DeveloperProcessPort {
        protocol: if protocol.starts_with("udp") {
            "udp".to_string()
        } else {
            "tcp".to_string()
        },
        address,
        port,
    })
}

#[cfg(target_os = "linux")]
fn developer_process_pids_from_ss_line(line: &str) -> Vec<u32> {
    let mut pids = Vec::new();
    let mut remainder = line;

    while let Some(index) = remainder.find("pid=") {
        let after_pid = &remainder[index + 4..];
        let pid_text = after_pid
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .collect::<String>();
        if let Ok(pid) = pid_text.parse::<u32>() {
            pids.push(pid);
        }
        remainder = after_pid;
    }

    pids.sort_unstable();
    pids.dedup();
    pids
}

#[tauri::command]
fn kill_developer_process(
    state: State<'_, DeveloperProcessMonitorState>,
    pid: u32,
    include_tree: Option<bool>,
    force: Option<bool>,
) -> Result<DeveloperProcessKillResult, String> {
    let include_tree = include_tree.unwrap_or(false);
    let force = force.unwrap_or(true);
    validate_developer_process_kill_pid(pid)?;

    let mut system = state
        .system
        .lock()
        .map_err(|_| "Process monitor state is unavailable.".to_string())?;
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        developer_process_refresh_kind(),
    );

    if system.process(SysPid::from_u32(pid)).is_none() {
        return Err(format!("Process {pid} is no longer running."));
    }

    let child_map = developer_child_map(&system);
    let candidate_pids = if include_tree {
        developer_process_tree_child_first(pid, &child_map)
    } else {
        vec![pid]
    };

    for candidate in &candidate_pids {
        validate_developer_process_kill_pid(*candidate)?;
    }

    #[cfg(windows)]
    {
        let result = windows_taskkill_developer_process(pid, include_tree, force, &candidate_pids)?;
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            developer_process_refresh_kind(),
        );
        return Ok(result);
    }

    #[cfg(not(windows))]
    {
        let signal = if force {
            sysinfo::Signal::Kill
        } else {
            sysinfo::Signal::Term
        };
        let mut killed_pids = Vec::new();
        let mut failed_pids = Vec::new();

        for candidate in &candidate_pids {
            match system.process(SysPid::from_u32(*candidate)) {
                Some(process) => match process.kill_with(signal) {
                    Some(true) => killed_pids.push(*candidate),
                    _ => failed_pids.push(*candidate),
                },
                None => failed_pids.push(*candidate),
            }
        }

        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            developer_process_refresh_kind(),
        );

        if killed_pids.is_empty() {
            return Err(format!("Unable to terminate process {pid}."));
        }

        let message = if include_tree {
            format!(
                "Termination signal sent to {} processes.",
                killed_pids.len()
            )
        } else {
            format!("Termination signal sent to process {pid}.")
        };

        Ok(DeveloperProcessKillResult {
            requested_pid: pid,
            include_tree,
            force,
            killed_pids,
            failed_pids,
            message,
        })
    }
}

#[tauri::command]
async fn docker_developer_action(
    action: String,
    workspace_roots: Vec<String>,
) -> Result<DockerDeveloperActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        docker_developer_action_blocking(&action, workspace_roots)
    })
    .await
    .map_err(|error| format!("Unable to join Docker action worker: {error}"))?
}

fn docker_developer_action_blocking(
    action: &str,
    workspace_roots: Vec<String>,
) -> Result<DockerDeveloperActionResult, String> {
    let action = parse_docker_developer_action(action)?;
    let workspace_roots = normalize_process_roots(workspace_roots, None);
    let targets = discover_docker_developer_targets(&workspace_roots)?;
    let linked_targets = targets
        .into_iter()
        .filter(|target| target.workspace_linked)
        .collect::<Vec<_>>();

    if linked_targets.is_empty() {
        return Ok(DockerDeveloperActionResult {
            action: docker_developer_action_id(action).to_string(),
            target_count: 0,
            succeeded: 0,
            failed: 0,
            skipped: Vec::new(),
            commands: Vec::new(),
            message: "No workspace-linked Docker containers were found.".to_string(),
        });
    }

    let mut commands = Vec::new();
    let mut skipped = Vec::new();

    match action {
        DockerDeveloperAction::Relaunch => {
            let compose = docker_compose_command();
            for target in docker_developer_unique_service_targets(&linked_targets) {
                if target.is_compose() {
                    let Some(compose) = compose.as_ref() else {
                        skipped.push(format!(
                            "{}: Docker Compose is not available.",
                            target.display_name()
                        ));
                        continue;
                    };
                    commands.push(run_docker_compose_service_command(
                        compose,
                        &target,
                        &["restart"],
                    ));
                } else {
                    let result = run_developer_docker_command(
                        "docker",
                        &[String::from("restart"), target.container_id.clone()],
                        None,
                    );
                    commands.push(docker_command_result_with_target(result, &target));
                }
            }
        }
        DockerDeveloperAction::RebuildRelaunch => {
            let compose = docker_compose_command();
            let Some(compose) = compose.as_ref() else {
                for target in docker_developer_unique_service_targets(&linked_targets) {
                    if target.is_compose() {
                        skipped.push(format!(
                            "{}: Docker Compose is not available.",
                            target.display_name()
                        ));
                    } else {
                        skipped.push(format!(
                            "{}: standalone containers cannot be rebuilt safely without Compose metadata.",
                            target.display_name()
                        ));
                    }
                }
                return docker_developer_action_result(action, linked_targets.len(), commands, skipped);
            };

            let mut failed_down_projects = HashSet::new();
            for target in docker_developer_unique_project_targets(&linked_targets) {
                if !target.is_compose() {
                    continue;
                }

                let result = run_docker_compose_project_command(compose, &target, &["down"]);
                if !result.success {
                    failed_down_projects.insert(docker_developer_project_key(&target));
                }
                commands.push(result);
            }

            for target in docker_developer_unique_service_targets(&linked_targets) {
                if !target.is_compose() {
                    skipped.push(format!(
                        "{}: standalone containers cannot be rebuilt safely without Compose metadata.",
                        target.display_name()
                    ));
                    continue;
                }

                if failed_down_projects.contains(&docker_developer_project_key(&target)) {
                    skipped.push(format!(
                        "{}: rebuild skipped because Docker Compose down failed.",
                        target.display_name()
                    ));
                    continue;
                }

                commands.push(run_docker_compose_service_command(
                    compose,
                    &target,
                    &["up", "-d", "--build", "--force-recreate"],
                ));
            }
        }
        DockerDeveloperAction::RemountData => {
            let compose = docker_compose_command();
            for target in docker_developer_unique_project_targets(&linked_targets) {
                if !target.is_compose() {
                    skipped.push(format!(
                        "{}: standalone containers cannot be recreated safely for a clean data remount.",
                        target.display_name()
                    ));
                    continue;
                }
                let Some(compose) = compose.as_ref() else {
                    skipped.push(format!(
                        "{}: Docker Compose is not available.",
                        target.display_name()
                    ));
                    continue;
                };
                commands.push(run_docker_compose_project_command(
                    compose,
                    &target,
                    &["down", "-v"],
                ));
                commands.push(run_docker_compose_project_command(
                    compose,
                    &target,
                    &["up", "-d", "--build"],
                ));
            }
        }
    }

    docker_developer_action_result(action, linked_targets.len(), commands, skipped)
}

fn docker_developer_action_result(
    action: DockerDeveloperAction,
    target_count: usize,
    commands: Vec<DockerDeveloperCommandResult>,
    skipped: Vec<String>,
) -> Result<DockerDeveloperActionResult, String> {
    let succeeded = commands.iter().filter(|command| command.success).count();
    let failed = commands.iter().filter(|command| !command.success).count();
    let message =
        docker_developer_action_message(action, target_count, succeeded, failed, skipped.len());

    Ok(DockerDeveloperActionResult {
        action: docker_developer_action_id(action).to_string(),
        target_count,
        succeeded,
        failed,
        skipped,
        commands,
        message,
    })
}

impl DockerDeveloperTarget {
    fn is_compose(&self) -> bool {
        !self.compose_project.is_empty() && !self.compose_service.is_empty()
    }

    fn display_name(&self) -> String {
        if self.is_compose() {
            return format!("{}/{}", self.compose_project, self.compose_service);
        }
        if !self.container_name.is_empty() {
            return self.container_name.clone();
        }
        self.container_id.clone()
    }
}

fn parse_docker_developer_action(value: &str) -> Result<DockerDeveloperAction, String> {
    match value {
        "relaunch" => Ok(DockerDeveloperAction::Relaunch),
        "rebuildRelaunch" => Ok(DockerDeveloperAction::RebuildRelaunch),
        "remountData" => Ok(DockerDeveloperAction::RemountData),
        _ => Err("Unsupported Docker action.".to_string()),
    }
}

fn docker_developer_action_id(action: DockerDeveloperAction) -> &'static str {
    match action {
        DockerDeveloperAction::Relaunch => "relaunch",
        DockerDeveloperAction::RebuildRelaunch => "rebuildRelaunch",
        DockerDeveloperAction::RemountData => "remountData",
    }
}

fn docker_developer_action_message(
    action: DockerDeveloperAction,
    target_count: usize,
    succeeded: usize,
    failed: usize,
    skipped: usize,
) -> String {
    let label = match action {
        DockerDeveloperAction::Relaunch => "Relaunch",
        DockerDeveloperAction::RebuildRelaunch => "Rebuild/relaunch",
        DockerDeveloperAction::RemountData => "Clean-slate remount",
    };

    if target_count == 0 {
        return format!("{label}: no workspace-linked Docker targets found.");
    }

    if failed == 0 && skipped == 0 {
        return format!("{label} completed for {target_count} Docker target(s).");
    }

    format!(
        "{label} finished with {succeeded} command(s) succeeded, {failed} failed, {skipped} skipped."
    )
}

fn discover_docker_developer_targets(
    workspace_roots: &[String],
) -> Result<Vec<DockerDeveloperTarget>, String> {
    let ps = run_developer_docker_command(
        "docker",
        &[String::from("ps"), String::from("-a"), String::from("-q")],
        None,
    );
    if !ps.success {
        return Err(docker_command_error_message(
            "Unable to list Docker containers.",
            &ps,
        ));
    }

    let container_ids = ps
        .stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(DOCKER_DEVELOPER_INSPECT_LIMIT)
        .map(str::to_string)
        .collect::<Vec<_>>();

    let mut targets = Vec::new();
    for container_id in container_ids {
        let inspect = run_developer_docker_command(
            "docker",
            &[String::from("inspect"), container_id.clone()],
            None,
        );
        if !inspect.success {
            continue;
        }

        let Ok(value) = serde_json::from_str::<Value>(&inspect.stdout) else {
            continue;
        };
        let Some(container) = value.as_array().and_then(|items| items.first()) else {
            continue;
        };
        targets.push(docker_developer_target_from_inspect(container, workspace_roots));
    }

    Ok(targets)
}

fn docker_developer_target_from_inspect(
    container: &Value,
    workspace_roots: &[String],
) -> DockerDeveloperTarget {
    let container_id = container["Id"]
        .as_str()
        .unwrap_or_default()
        .chars()
        .take(12)
        .collect::<String>();
    let container_name = container["Name"]
        .as_str()
        .unwrap_or_default()
        .trim_start_matches('/')
        .to_string();
    let labels = &container["Config"]["Labels"];
    let compose_project = docker_label(labels, "com.docker.compose.project");
    let compose_service = docker_label(labels, "com.docker.compose.service");
    let compose_working_dir = docker_label(labels, "com.docker.compose.project.working_dir");
    let compose_config_files = docker_label(labels, "com.docker.compose.project.config_files")
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();

    let mut bind_sources = Vec::new();
    let mut named_volumes = Vec::new();
    if let Some(mounts) = container["Mounts"].as_array() {
        for mount in mounts {
            let mount_type = mount["Type"].as_str().unwrap_or_default();
            let source = mount["Source"].as_str().unwrap_or_default();
            let name = mount["Name"].as_str().unwrap_or_default();

            if mount_type == "bind" && !source.is_empty() {
                bind_sources.push(source.to_string());
            } else if mount_type == "volume" {
                if !name.is_empty() {
                    named_volumes.push(name.to_string());
                } else if !source.is_empty() {
                    named_volumes.push(source.to_string());
                }
            }
        }
    }

    let workspace_links = docker_target_workspace_links(
        &compose_working_dir,
        &compose_config_files,
        &bind_sources,
        workspace_roots,
    );
    let workspace_linked = !workspace_links.is_empty();

    DockerDeveloperTarget {
        container_id,
        container_name,
        compose_project,
        compose_service,
        compose_working_dir,
        compose_config_files,
        workspace_linked,
        workspace_links,
    }
}

fn docker_label(labels: &Value, key: &str) -> String {
    labels[key].as_str().unwrap_or_default().to_string()
}

fn docker_target_workspace_links(
    compose_working_dir: &str,
    compose_config_files: &[String],
    bind_sources: &[String],
    workspace_roots: &[String],
) -> Vec<String> {
    if workspace_roots.is_empty() {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    if !compose_working_dir.is_empty() {
        candidates.push(compose_working_dir.to_string());
    }
    candidates.extend(compose_config_files.iter().cloned());
    candidates.extend(bind_sources.iter().cloned());

    let mut seen = HashSet::new();
    let mut links = Vec::new();

    for candidate in candidates {
        let matched = docker_normalized_path_variants(&candidate).iter().any(|normalized| {
            workspace_roots.iter().any(|root| {
                !normalized.is_empty()
                    && !root.is_empty()
                    && (normalized == root
                        || normalized.starts_with(&format!("{root}/"))
                        || root.starts_with(&format!("{normalized}/")))
            })
        });

        if matched {
            let link = clean_process_text(&candidate);
            let key = normalize_process_text_for_compare(&link);
            if !link.is_empty() && seen.insert(key) {
                links.push(link);
            }
        }
    }

    links
}

fn docker_normalized_path_variants(value: &str) -> Vec<String> {
    let normalized = normalize_process_path_text(value);
    let mut variants = vec![normalized.clone()];
    let text = normalized.trim_start_matches('/');

    for prefix in ["run/desktop/mnt/host/", "host_mnt/"] {
        let Some(rest) = text.strip_prefix(prefix) else {
            continue;
        };
        let mut parts = rest.splitn(2, '/');
        let drive = parts.next().unwrap_or_default();
        if drive.len() == 1 && drive.chars().all(|ch| ch.is_ascii_alphabetic()) {
            let path = parts.next().unwrap_or_default();
            variants.push(normalize_process_text_for_compare(&format!(
                "{}:/{}",
                drive,
                path
            )));
        }
    }

    variants.sort();
    variants.dedup();
    variants
}

fn docker_developer_unique_service_targets(
    targets: &[DockerDeveloperTarget],
) -> Vec<DockerDeveloperTarget> {
    let mut seen = HashSet::new();
    let mut unique = Vec::new();

    for target in targets {
        let key = if target.is_compose() {
            format!(
                "compose:{}:{}:{}",
                target.compose_project,
                target.compose_service,
                target.compose_config_files.join("|")
            )
        } else {
            format!("container:{}", target.container_id)
        };
        if seen.insert(key) {
            unique.push(target.clone());
        }
    }

    unique
}

fn docker_developer_unique_project_targets(
    targets: &[DockerDeveloperTarget],
) -> Vec<DockerDeveloperTarget> {
    let mut seen = HashSet::new();
    let mut unique = Vec::new();

    for target in targets {
        let key = if target.is_compose() {
            format!(
                "compose:{}:{}",
                target.compose_project,
                target.compose_config_files.join("|")
            )
        } else {
            format!("container:{}", target.container_id)
        };
        if seen.insert(key) {
            unique.push(target.clone());
        }
    }

    unique
}

fn docker_developer_project_key(target: &DockerDeveloperTarget) -> String {
    if target.is_compose() {
        return format!(
            "compose:{}:{}",
            target.compose_project,
            target.compose_config_files.join("|")
        );
    }

    format!("container:{}", target.container_id)
}

fn docker_compose_command() -> Option<DockerComposeCommand> {
    let plugin = run_developer_docker_command(
        "docker",
        &[String::from("compose"), String::from("version")],
        None,
    );
    if plugin.success {
        return Some(DockerComposeCommand::Plugin);
    }

    let standalone = run_developer_docker_command(
        "docker-compose",
        &[String::from("version")],
        None,
    );
    if standalone.success {
        return Some(DockerComposeCommand::Standalone);
    }

    None
}

fn run_docker_compose_service_command(
    compose: &DockerComposeCommand,
    target: &DockerDeveloperTarget,
    action_args: &[&str],
) -> DockerDeveloperCommandResult {
    let mut args = docker_compose_base_args(compose, target);
    args.extend(action_args.iter().map(|arg| (*arg).to_string()));
    args.push(target.compose_service.clone());
    let cwd = docker_compose_cwd(target);
    let program = docker_compose_program(compose);

    let result = run_developer_docker_command(&program, &args, cwd.as_deref());
    docker_command_result_with_target(result, target)
}

fn run_docker_compose_project_command(
    compose: &DockerComposeCommand,
    target: &DockerDeveloperTarget,
    action_args: &[&str],
) -> DockerDeveloperCommandResult {
    let mut args = docker_compose_base_args(compose, target);
    args.extend(action_args.iter().map(|arg| (*arg).to_string()));
    let cwd = docker_compose_cwd(target);
    let program = docker_compose_program(compose);

    let result = run_developer_docker_command(&program, &args, cwd.as_deref());
    docker_command_result_with_target(result, target)
}

fn docker_compose_program(compose: &DockerComposeCommand) -> String {
    match compose {
        DockerComposeCommand::Plugin => "docker".to_string(),
        DockerComposeCommand::Standalone => "docker-compose".to_string(),
    }
}

fn docker_compose_base_args(
    compose: &DockerComposeCommand,
    target: &DockerDeveloperTarget,
) -> Vec<String> {
    let mut args = Vec::new();
    if matches!(compose, DockerComposeCommand::Plugin) {
        args.push("compose".to_string());
    }

    for config_file in &target.compose_config_files {
        args.push("-f".to_string());
        args.push(config_file.clone());
    }

    if !target.compose_project.is_empty() {
        args.push("-p".to_string());
        args.push(target.compose_project.clone());
    }

    args
}

fn docker_compose_cwd(target: &DockerDeveloperTarget) -> Option<PathBuf> {
    if !target.compose_working_dir.is_empty() {
        return Some(PathBuf::from(&target.compose_working_dir));
    }

    target
        .compose_config_files
        .first()
        .and_then(|config_file| Path::new(config_file).parent().map(Path::to_path_buf))
}

fn docker_command_result_with_target(
    mut result: DockerDeveloperCommandResult,
    target: &DockerDeveloperTarget,
) -> DockerDeveloperCommandResult {
    result.target_label = target.display_name();
    result.target_container_id = target.container_id.clone();
    result.target_container_name = target.container_name.clone();
    result.target_compose_project = target.compose_project.clone();
    result.target_compose_service = target.compose_service.clone();
    result.target_compose_working_dir = target.compose_working_dir.clone();
    result.target_compose_config_files = target.compose_config_files.clone();
    result.target_workspace_links = target.workspace_links.clone();
    result
}

fn run_developer_docker_command(
    program: &str,
    args: &[String],
    cwd: Option<&Path>,
) -> DockerDeveloperCommandResult {
    let started_at = Instant::now();
    let mut command = Command::new(program);
    command.args(args);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    match command.output() {
        Ok(output) => DockerDeveloperCommandResult {
            program: program.to_string(),
            args: args.to_vec(),
            cwd: cwd
                .map(process_path_display)
                .unwrap_or_else(String::new),
            exit_code: output.status.code(),
            stdout: limit_docker_developer_output(&String::from_utf8_lossy(&output.stdout)),
            stderr: limit_docker_developer_output(&String::from_utf8_lossy(&output.stderr)),
            success: output.status.success(),
            duration_ms: docker_command_duration_ms(started_at),
            target_label: String::new(),
            target_container_id: String::new(),
            target_container_name: String::new(),
            target_compose_project: String::new(),
            target_compose_service: String::new(),
            target_compose_working_dir: String::new(),
            target_compose_config_files: Vec::new(),
            target_workspace_links: Vec::new(),
        },
        Err(error) => DockerDeveloperCommandResult {
            program: program.to_string(),
            args: args.to_vec(),
            cwd: cwd
                .map(process_path_display)
                .unwrap_or_else(String::new),
            exit_code: None,
            stdout: String::new(),
            stderr: error.to_string(),
            success: false,
            duration_ms: docker_command_duration_ms(started_at),
            target_label: String::new(),
            target_container_id: String::new(),
            target_container_name: String::new(),
            target_compose_project: String::new(),
            target_compose_service: String::new(),
            target_compose_working_dir: String::new(),
            target_compose_config_files: Vec::new(),
            target_workspace_links: Vec::new(),
        },
    }
}

fn docker_command_duration_ms(started_at: Instant) -> u64 {
    started_at
        .elapsed()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn limit_docker_developer_output(value: &str) -> String {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    let mut output = normalized
        .chars()
        .filter(|ch| *ch == '\n' || *ch == '\t' || !ch.is_control())
        .collect::<String>()
        .trim()
        .to_string();
    if output.len() > DOCKER_DEVELOPER_OUTPUT_LIMIT {
        output.truncate(DOCKER_DEVELOPER_OUTPUT_LIMIT);
        output.push_str("\n...");
    }
    output
}

fn docker_command_error_message(prefix: &str, result: &DockerDeveloperCommandResult) -> String {
    let detail = if !result.stderr.trim().is_empty() {
        result.stderr.trim()
    } else if !result.stdout.trim().is_empty() {
        result.stdout.trim()
    } else {
        "Docker command failed."
    };

    format!("{prefix} {detail}")
}

fn developer_process_refresh_kind() -> ProcessRefreshKind {
    ProcessRefreshKind::nothing()
        .with_cpu()
        .with_memory()
        .with_cmd(UpdateKind::Always)
        .with_exe(UpdateKind::Always)
        .with_cwd(UpdateKind::Always)
        .with_tasks()
}

fn developer_process_platform() -> &'static str {
    #[cfg(windows)]
    {
        "windows"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "linux"
    }
    #[cfg(not(any(windows, target_os = "macos", all(unix, not(target_os = "macos")))))]
    {
        "unknown"
    }
}

fn developer_parent_map(system: &SysSystem) -> HashMap<u32, u32> {
    system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            process
                .parent()
                .map(|parent| (pid.as_u32(), parent.as_u32()))
        })
        .collect()
}

fn developer_child_map(system: &SysSystem) -> HashMap<u32, Vec<u32>> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();

    for (pid, process) in system.processes() {
        if let Some(parent) = process.parent() {
            children
                .entry(parent.as_u32())
                .or_default()
                .push(pid.as_u32());
        }
    }

    for child_pids in children.values_mut() {
        child_pids.sort_unstable();
    }

    children
}

fn developer_descendant_count(pid: u32, child_map: &HashMap<u32, Vec<u32>>) -> usize {
    let mut seen = HashSet::new();
    developer_collect_descendants(pid, child_map, &mut seen);
    seen.len()
}

fn developer_process_tree_child_first(pid: u32, child_map: &HashMap<u32, Vec<u32>>) -> Vec<u32> {
    fn visit(
        pid: u32,
        child_map: &HashMap<u32, Vec<u32>>,
        seen: &mut HashSet<u32>,
        ordered: &mut Vec<u32>,
    ) {
        if !seen.insert(pid) {
            return;
        }

        if let Some(children) = child_map.get(&pid) {
            for child in children {
                visit(*child, child_map, seen, ordered);
            }
        }

        ordered.push(pid);
    }

    let mut seen = HashSet::new();
    let mut ordered = Vec::new();
    visit(pid, child_map, &mut seen, &mut ordered);
    ordered
}

fn developer_collect_descendants(
    pid: u32,
    child_map: &HashMap<u32, Vec<u32>>,
    seen: &mut HashSet<u32>,
) {
    if let Some(children) = child_map.get(&pid) {
        for child in children {
            if seen.insert(*child) {
                developer_collect_descendants(*child, child_map, seen);
            }
        }
    }
}

fn developer_process_attribution(
    cwd: &str,
    executable: &str,
    command: &str,
    active_workspace_root: &Option<String>,
    workspace_roots: &[String],
    pid: u32,
    app_pid: u32,
    parent_map: &HashMap<u32, u32>,
) -> DeveloperProcessAttribution {
    if let Some(root) = active_workspace_root {
        if process_text_matches_root(cwd, root)
            || process_text_matches_root(executable, root)
            || process_text_contains_root(command, root)
        {
            return DeveloperProcessAttribution {
                id: "currentWorkspace",
                label: "Current workspace",
                workspace_root: root.clone(),
            };
        }
    }

    for root in workspace_roots {
        if active_workspace_root.as_ref() == Some(root) {
            continue;
        }

        if process_text_matches_root(cwd, root)
            || process_text_matches_root(executable, root)
            || process_text_contains_root(command, root)
        {
            return DeveloperProcessAttribution {
                id: "workspace",
                label: "Known workspace",
                workspace_root: root.clone(),
            };
        }
    }

    if developer_process_is_app_descendant(pid, app_pid, parent_map) {
        return DeveloperProcessAttribution {
            id: "diffForge",
            label: "Diff Forge child",
            workspace_root: String::new(),
        };
    }

    DeveloperProcessAttribution {
        id: "system",
        label: "System",
        workspace_root: String::new(),
    }
}

fn developer_process_is_app_descendant(
    pid: u32,
    app_pid: u32,
    parent_map: &HashMap<u32, u32>,
) -> bool {
    let mut seen = HashSet::new();
    let mut current = pid;

    while let Some(parent) = parent_map.get(&current) {
        if *parent == app_pid {
            return true;
        }
        if !seen.insert(*parent) {
            return false;
        }
        current = *parent;
    }

    false
}

fn classify_developer_process(
    name: &str,
    executable: &str,
    command: &str,
    is_attributed: bool,
) -> Option<DeveloperProcessClassification> {
    let haystack = format!(
        "{} {} {}",
        name.to_ascii_lowercase(),
        executable.to_ascii_lowercase(),
        command.to_ascii_lowercase()
    );
    let name_lower = name.to_ascii_lowercase();
    let exe_name = process_file_name(executable).unwrap_or_else(|| name_lower.clone());

    if haystack.contains("@openai/codex")
        || haystack.contains("openai-codex")
        || process_name_matches(&exe_name, &["codex"])
    {
        return Some(developer_classification(
            "codex", "Codex", "agent", "code", "Codex", "caution", false,
        ));
    }

    if haystack.contains("@anthropic-ai/claude-code")
        || haystack.contains("claude-code")
        || process_name_matches(&exe_name, &["claude"])
    {
        return Some(developer_classification(
            "claude",
            "Claude Code",
            "agent",
            "bot",
            "Claude Code",
            "caution",
            false,
        ));
    }

    if haystack.contains("opencode-ai")
        || haystack.contains("opencode")
        || process_name_matches(&exe_name, &["opencode"])
    {
        return Some(developer_classification(
            "opencode", "OpenCode", "agent", "code", "OpenCode", "caution", false,
        ));
    }

    if process_name_matches(&exe_name, &["dockerd", "containerd"])
        || haystack.contains("com.docker.backend")
        || haystack.contains("docker desktop")
    {
        return Some(developer_classification(
            "docker-daemon",
            "Docker daemon",
            "docker",
            "hub",
            "Docker daemon",
            "protected",
            true,
        ));
    }

    if process_name_matches(&exe_name, &["docker", "docker-compose"])
        || haystack.contains("docker-compose")
    {
        return Some(developer_classification(
            "docker", "Docker", "docker", "hub", "Docker", "caution", false,
        ));
    }

    if process_name_matches(&exe_name, &["node", "nodejs", "npm", "npx", "pnpm", "yarn"]) {
        if haystack.contains("vite") {
            return Some(developer_classification(
                "vite", "Vite", "node", "code", "Vite", "caution", false,
            ));
        }

        if haystack.contains("next") || haystack.contains("next-server") {
            return Some(developer_classification(
                "next", "Next.js", "node", "code", "Next.js", "caution", false,
            ));
        }

        return Some(developer_classification(
            "node", "Node.js", "node", "code", "Node.js", "caution", false,
        ));
    }

    if process_name_matches(&exe_name, &["bun", "deno"]) {
        return Some(developer_classification(
            "js-runtime",
            "JS runtime",
            "node",
            "code",
            "JS runtime",
            "caution",
            false,
        ));
    }

    if process_name_matches(&exe_name, &["cargo", "rustc", "rust-analyzer"]) {
        return Some(developer_classification(
            "rust", "Rust", "runtime", "terminal", "Rust", "caution", false,
        ));
    }

    if process_name_matches(&exe_name, &["python", "python3", "py", "uv", "pip", "pip3"]) {
        return Some(developer_classification(
            "python", "Python", "runtime", "terminal", "Python", "caution", false,
        ));
    }

    if process_name_matches(&exe_name, &["git"]) {
        return Some(developer_classification(
            "git", "Git", "tool", "terminal", "Git", "caution", false,
        ));
    }

    if process_name_matches(&exe_name, &["go", "gopls"]) {
        return Some(developer_classification(
            "go", "Go", "runtime", "terminal", "Go", "caution", false,
        ));
    }

    if process_name_matches(&exe_name, &["java", "gradle", "mvn"]) {
        return Some(developer_classification(
            "java", "Java", "runtime", "terminal", "Java", "caution", false,
        ));
    }

    if is_attributed
        && process_name_matches(
            &exe_name,
            &[
                "bash",
                "zsh",
                "fish",
                "sh",
                "cmd",
                "cmd.exe",
                "powershell",
                "powershell.exe",
                "pwsh",
                "pwsh.exe",
                "nu",
            ],
        )
    {
        return Some(developer_classification(
            "terminal-shell",
            "Terminal shell",
            "terminal",
            "terminal",
            "Terminal shell",
            "caution",
            false,
        ));
    }

    if is_attributed {
        return Some(developer_classification(
            "workspace-process",
            "Workspace process",
            "workspace",
            "terminal",
            "Workspace process",
            "caution",
            false,
        ));
    }

    None
}

fn developer_classification(
    group_id: &'static str,
    group_label: &'static str,
    group_kind: &'static str,
    icon_hint: &'static str,
    display_name: &'static str,
    risk_hint: &'static str,
    protected: bool,
) -> DeveloperProcessClassification {
    DeveloperProcessClassification {
        group_id,
        group_label,
        group_kind,
        icon_hint,
        display_name,
        risk_hint,
        protected,
    }
}

fn developer_process_risk(
    classification: &DeveloperProcessClassification,
    attribution: &DeveloperProcessAttribution,
) -> String {
    if classification.protected || classification.risk_hint == "protected" {
        return "protected".to_string();
    }

    if classification.risk_hint == "danger" {
        return "danger".to_string();
    }

    if matches!(
        attribution.id,
        "currentWorkspace" | "workspace" | "diffForge"
    ) {
        return "safe".to_string();
    }

    "caution".to_string()
}

fn developer_kill_disabled_reason(
    pid: u32,
    classification: &DeveloperProcessClassification,
    risk: &str,
) -> String {
    if pid == std::process::id() {
        return "Diff Forge cannot terminate itself.".to_string();
    }

    if is_reserved_process_pid(pid) {
        return "Reserved system process.".to_string();
    }

    if classification.protected || risk == "protected" {
        return "Protected daemon.".to_string();
    }

    String::new()
}

fn developer_process_groups(processes: &[DeveloperProcessInfo]) -> Vec<DeveloperProcessGroup> {
    let mut builders: HashMap<String, DeveloperProcessGroupBuilder> = HashMap::new();

    for process in processes {
        let builder = builders.entry(process.group_id.clone()).or_insert_with(|| {
            DeveloperProcessGroupBuilder {
                id: process.group_id.clone(),
                label: process.group_label.clone(),
                kind: process.group_kind.clone(),
                icon_hint: process.icon_hint.clone(),
                count: 0,
                pids: Vec::new(),
                killable_count: 0,
                cpu_percent: 0.0,
                memory_bytes: 0,
                attribution_ids: HashSet::new(),
                risk: process.risk.clone(),
                child_count: 0,
            }
        });

        builder.count += 1;
        builder.pids.push(process.pid);
        if process.killable {
            builder.killable_count += 1;
        }
        builder.cpu_percent += process.cpu_percent;
        builder.memory_bytes = builder.memory_bytes.saturating_add(process.memory_bytes);
        builder.attribution_ids.insert(process.attribution.clone());
        builder.risk = developer_higher_risk(&builder.risk, &process.risk).to_string();
        builder.child_count += process.child_count;
    }

    let mut groups = builders
        .into_values()
        .map(|mut builder| {
            builder.pids.sort_unstable();
            let (attribution, attribution_label) =
                developer_group_attribution(&builder.attribution_ids);
            DeveloperProcessGroup {
                id: builder.id,
                label: builder.label,
                kind: builder.kind,
                icon_hint: builder.icon_hint,
                count: builder.count,
                pids: builder.pids,
                killable_count: builder.killable_count,
                cpu_percent: builder.cpu_percent,
                memory_bytes: builder.memory_bytes,
                attribution,
                attribution_label,
                risk: builder.risk,
                child_count: builder.child_count,
            }
        })
        .collect::<Vec<_>>();

    groups.sort_by(|left, right| {
        developer_group_sort_rank(left)
            .cmp(&developer_group_sort_rank(right))
            .then_with(|| {
                right
                    .cpu_percent
                    .partial_cmp(&left.cpu_percent)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| right.memory_bytes.cmp(&left.memory_bytes))
            .then_with(|| left.label.cmp(&right.label))
    });

    groups
}

fn developer_group_attribution(attributions: &HashSet<String>) -> (String, String) {
    if attributions.len() > 1 {
        return ("mixed".to_string(), "Mixed".to_string());
    }

    match attributions.iter().next().map(String::as_str) {
        Some("currentWorkspace") => (
            "currentWorkspace".to_string(),
            "Current workspace".to_string(),
        ),
        Some("workspace") => ("workspace".to_string(), "Known workspace".to_string()),
        Some("diffForge") => ("diffForge".to_string(), "Diff Forge child".to_string()),
        Some("system") => ("system".to_string(), "System".to_string()),
        _ => ("system".to_string(), "System".to_string()),
    }
}

fn developer_group_sort_rank(group: &DeveloperProcessGroup) -> u8 {
    if group.attribution == "currentWorkspace" {
        return 0;
    }

    match group.kind.as_str() {
        "agent" => 1,
        "node" => 2,
        "docker" => 3,
        "runtime" => 4,
        "terminal" => 5,
        _ => 6,
    }
}

fn developer_attribution_rank(attribution: &str) -> u8 {
    match attribution {
        "currentWorkspace" => 0,
        "workspace" => 1,
        "diffForge" => 2,
        _ => 3,
    }
}

fn developer_higher_risk<'a>(left: &'a str, right: &'a str) -> &'a str {
    if developer_risk_rank(right) > developer_risk_rank(left) {
        right
    } else {
        left
    }
}

fn developer_risk_rank(risk: &str) -> u8 {
    match risk {
        "protected" => 4,
        "danger" => 3,
        "caution" => 2,
        "safe" => 1,
        _ => 0,
    }
}

fn validate_developer_process_kill_pid(pid: u32) -> Result<(), String> {
    if pid == std::process::id() {
        return Err("Diff Forge cannot terminate itself.".to_string());
    }

    if is_reserved_process_pid(pid) {
        return Err(format!("Process {pid} is a reserved system process."));
    }

    Ok(())
}

fn is_reserved_process_pid(pid: u32) -> bool {
    #[cfg(windows)]
    {
        pid <= 4
    }
    #[cfg(not(windows))]
    {
        pid <= 1
    }
}

#[cfg(windows)]
fn windows_taskkill_developer_process(
    pid: u32,
    include_tree: bool,
    force: bool,
    candidate_pids: &[u32],
) -> Result<DeveloperProcessKillResult, String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut command = Command::new("taskkill");
    command.arg("/PID").arg(pid.to_string());
    if include_tree {
        command.arg("/T");
    }
    if force {
        command.arg("/F");
    }
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|error| format!("Unable to start taskkill: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let message = clean_process_text(if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        });
        return Err(if message.is_empty() {
            format!("Unable to terminate process {pid}.")
        } else {
            message
        });
    }

    let killed_pids = candidate_pids.to_vec();
    let message = if include_tree {
        format!("Requested termination for process tree {pid}.")
    } else {
        format!("Requested termination for process {pid}.")
    };

    Ok(DeveloperProcessKillResult {
        requested_pid: pid,
        include_tree,
        force,
        killed_pids,
        failed_pids: Vec::new(),
        message,
    })
}

fn normalize_optional_process_root(value: Option<&str>) -> Option<String> {
    value.and_then(|text| {
        let normalized = normalize_process_path_text(text);
        if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        }
    })
}

fn normalize_process_roots(values: Vec<String>, active_root: Option<&str>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut roots = Vec::new();

    if let Some(root) = active_root {
        let root = normalize_process_path_text(root);
        if !root.is_empty() && seen.insert(root.clone()) {
            roots.push(root);
        }
    }

    for value in values {
        let root = normalize_process_path_text(&value);
        if !root.is_empty() && seen.insert(root.clone()) {
            roots.push(root);
        }
    }

    roots
}

fn normalize_process_path_text(value: &str) -> String {
    let trimmed = value.trim().trim_matches('"').trim_matches('\'');
    if trimmed.is_empty() {
        return String::new();
    }

    let path = PathBuf::from(trimmed);
    let resolved = fs::canonicalize(&path).unwrap_or(path);
    normalize_process_text_for_compare(&process_path_display(&resolved))
}

fn process_text_matches_root(value: &str, root: &str) -> bool {
    let normalized = normalize_process_text_for_compare(value);
    !normalized.is_empty()
        && !root.is_empty()
        && (normalized == root || normalized.starts_with(&format!("{root}/")))
}

fn process_text_contains_root(value: &str, root: &str) -> bool {
    let normalized = normalize_process_text_for_compare(value);
    !normalized.is_empty() && !root.is_empty() && normalized.contains(root)
}

fn normalize_process_text_for_compare(value: &str) -> String {
    let mut text = value.trim().replace('\\', "/");
    while text.ends_with('/') && text.len() > 1 {
        text.pop();
    }

    if cfg!(windows) || cfg!(target_os = "macos") {
        text = text.to_ascii_lowercase();
    }

    text
}

fn process_command_text(command: &[std::ffi::OsString]) -> String {
    let text = command
        .iter()
        .map(|part| clean_process_text(&part.to_string_lossy()))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    if text.chars().count() > DEVELOPER_PROCESS_COMMAND_LIMIT {
        let truncated = text
            .chars()
            .take(DEVELOPER_PROCESS_COMMAND_LIMIT)
            .collect::<String>();
        format!("{truncated}...")
    } else {
        text
    }
}

fn process_path_display(path: &Path) -> String {
    clean_process_text(&path.display().to_string())
}

fn clean_process_text(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !ch.is_control())
        .collect::<String>()
        .trim()
        .to_string()
}

fn process_file_name(path: &str) -> Option<String> {
    let file_name = Path::new(path)
        .file_stem()
        .or_else(|| Path::new(path).file_name())?
        .to_string_lossy()
        .to_ascii_lowercase();
    if file_name.is_empty() {
        None
    } else {
        Some(file_name)
    }
}

fn process_name_matches(name: &str, candidates: &[&str]) -> bool {
    let normalized = name.trim().trim_end_matches(".exe").to_ascii_lowercase();
    candidates
        .iter()
        .any(|candidate| normalized == candidate.trim_end_matches(".exe"))
}

use sysinfo::{
    Pid as SysPid, ProcessRefreshKind, ProcessesToUpdate, System as SysSystem, UpdateKind,
};

const DEVELOPER_PROCESS_CPU_WARNING_PERCENT: f64 = 65.0;
const DEVELOPER_PROCESS_MEMORY_WARNING_BYTES: u64 = 1024 * 1024 * 1024;
const DEVELOPER_PROCESS_COMMAND_LIMIT: usize = 4096;
const DOCKER_DEVELOPER_OUTPUT_LIMIT: usize = 4096;
const DOCKER_DEVELOPER_INSPECT_LIMIT: usize = 120;
const DEVELOPER_PROCESS_PORT_SCAN_LIMIT: usize = 2048;
const DEVELOPER_PROCESS_SNAPSHOT_CACHE_MS: u64 = 1500;
const DEVELOPER_PROCESS_PORT_CACHE_MS: u64 = 60_000;
const DOCKER_CONTAINER_SNAPSHOT_CACHE_MS: u64 = 25_000;

struct DeveloperProcessMonitorState {
    system: Arc<StdMutex<SysSystem>>,
    port_cache: Arc<StdMutex<DeveloperProcessPortCache>>,
    snapshot_cache: Arc<StdMutex<Option<DeveloperProcessSnapshotCache>>>,
    docker_container_cache: Arc<StdMutex<Option<DockerContainerSnapshotCache>>>,
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
            port_cache: Arc::new(StdMutex::new(DeveloperProcessPortCache::default())),
            snapshot_cache: Arc::new(StdMutex::new(None)),
            docker_container_cache: Arc::new(StdMutex::new(None)),
        }
    }

    fn invalidate_process_snapshot_cache(&self) {
        if let Ok(mut cache) = self.snapshot_cache.lock() {
            *cache = None;
        }
    }

    fn invalidate_docker_container_cache(&self) {
        if let Ok(mut cache) = self.docker_container_cache.lock() {
            *cache = None;
        }
    }
}

#[derive(Default)]
struct DeveloperProcessPortCache {
    sampled_at_ms: u64,
    ports_by_pid: HashMap<u32, Vec<DeveloperProcessPort>>,
}

#[derive(Clone)]
struct DeveloperProcessSnapshotCache {
    key: String,
    sampled_at_ms: u64,
    snapshot: DeveloperProcessSnapshot,
}

#[derive(Clone)]
struct DockerContainerSnapshotCache {
    include_stats: bool,
    sampled_at_ms: u64,
    snapshot: Value,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeveloperProcessSnapshot {
    platform: &'static str,
    sampled_at_ms: u64,
    energy: DeveloperEnergySnapshot,
    processes: Vec<DeveloperProcessInfo>,
    groups: Vec<DeveloperProcessGroup>,
    total_cpu_percent: f64,
    total_memory_bytes: u64,
    high_activity_count: usize,
    protected_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeveloperEnergySnapshot {
    sampled_at_ms: u64,
    total_score: f64,
    active_group_count: usize,
    top_label: String,
    top_cause: String,
    groups: Vec<DeveloperEnergyGroup>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeveloperEnergyGroup {
    id: String,
    label: String,
    description: String,
    cause: String,
    score: f64,
    cpu_percent: f64,
    memory_bytes: u64,
    process_count: usize,
    pids: Vec<u32>,
    confidence: String,
    intensity: String,
}

#[derive(Clone)]
struct DeveloperEnergyGroupBuilder {
    id: &'static str,
    label: &'static str,
    description: &'static str,
    cause: &'static str,
    confidence: &'static str,
    score: f64,
    cpu_percent: f64,
    memory_bytes: u64,
    process_count: usize,
    pids: Vec<u32>,
}

struct DeveloperEnergyBuildContext {
    sampled_at_ms: u64,
    seen_pids: HashSet<u32>,
    groups: HashMap<&'static str, DeveloperEnergyGroupBuilder>,
    app_core: Option<DeveloperEnergyCoreProcess>,
}

#[derive(Clone)]
struct DeveloperEnergyCoreProcess {
    pid: u32,
    cpu_percent: f64,
    memory_bytes: u64,
}

#[derive(Clone, Copy)]
struct DeveloperEnergyInternalSignals {
    terminal_root_count: usize,
    workspace_root_count: usize,
    visible_process_count: usize,
    docker_process_count: usize,
    cloud: DeveloperEnergyCloudSignals,
}

#[derive(Clone, Copy, Default)]
struct DeveloperEnergyCloudSignals {
    global_ws_connected: bool,
    global_ws_retrying: bool,
    outbox_pending_count: usize,
    outbox_retrying_count: usize,
    outbox_dead_letter_count: usize,
    registered_workspace_count: usize,
    terminal_context_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalActivitySnapshot {
    platform: &'static str,
    sampled_at_ms: u64,
    pane_id: String,
    terminal_found: bool,
    terminal_root_pid: Option<u32>,
    terminal_instance_id: Option<u64>,
    terminal_workspace_id: String,
    terminal_workspace_name: String,
    terminal_index: Option<u16>,
    terminal_thread_id: String,
    terminal_agent_id: String,
    terminal_agent_kind: String,
    activity_events_path: String,
    processes: Vec<DeveloperProcessInfo>,
    dev_servers: Vec<DeveloperProcessInfo>,
    subagents: Vec<TerminalActivitySubagent>,
    total_cpu_percent: f64,
    total_memory_bytes: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalActivitySubagent {
    id: String,
    provider: String,
    agent_id: String,
    agent_type: String,
    label: String,
    description: String,
    status: String,
    started_at_ms: Option<u64>,
    finished_at_ms: Option<u64>,
    updated_at_ms: u64,
    transcript_path: String,
    agent_transcript_path: String,
    last_message: String,
    source: String,
    confidence: String,
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
    target_container_image: String,
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
    container_image: String,
    compose_project: String,
    compose_service: String,
    compose_working_dir: String,
    compose_config_files: Vec<String>,
    workspace_linked: bool,
    workspace_links: Vec<String>,
}

#[derive(Deserialize)]
struct DockerComposeLsProject {
    #[serde(default, rename = "Name")]
    name: String,
    #[serde(default, rename = "ConfigFiles")]
    config_files: String,
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
    cloud_state: State<'_, CloudMcpState>,
    terminal_state: State<'_, TerminalState>,
    active_workspace_root: Option<String>,
    workspace_roots: Vec<String>,
    force: Option<bool>,
) -> Result<DeveloperProcessSnapshot, String> {
    collect_developer_process_snapshot(
        state.inner(),
        Some(cloud_state.inner()),
        terminal_state.inner(),
        active_workspace_root,
        workspace_roots,
        force.unwrap_or(false),
    )
    .await
}

async fn collect_developer_process_snapshot(
    state: &DeveloperProcessMonitorState,
    cloud_state: Option<&CloudMcpState>,
    terminal_state: &TerminalState,
    active_workspace_root: Option<String>,
    workspace_roots: Vec<String>,
    force: bool,
) -> Result<DeveloperProcessSnapshot, String> {
    let active_workspace_root = normalize_optional_process_root(active_workspace_root.as_deref());
    let workspace_roots =
        normalize_process_roots(workspace_roots, active_workspace_root.as_deref());
    let app_pid = std::process::id();
    let sampled_at_ms = current_time_ms();
    let cache_key =
        developer_process_snapshot_cache_key(active_workspace_root.as_deref(), &workspace_roots);
    if !force {
        if let Some(snapshot) =
            developer_cached_process_snapshot(state, &cache_key, sampled_at_ms)
        {
            return Ok(snapshot);
        }
    }

    let terminal_roots = developer_terminal_process_roots(&terminal_state).await;
    let cloud_signals = developer_energy_cloud_signals(cloud_state).await;
    let bound_ports_by_pid = developer_bound_ports_by_pid_cached(state, sampled_at_ms, force).await;

    let (
        processes,
        groups,
        total_cpu_percent,
        total_memory_bytes,
        high_activity_count,
        protected_count,
        energy,
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
        let app_descendant_pids = developer_descendant_pid_set(app_pid, &child_map);
        let terminal_roots_by_pid = terminal_roots
            .iter()
            .map(|root| (root.root_pid, root))
            .collect::<HashMap<_, _>>();
        let mut energy = DeveloperEnergyBuildContext::new(sampled_at_ms);
        let mut processes = Vec::new();

        for (pid, process) in system.processes() {
            let pid_u32 = pid.as_u32();
            let parent_pid = process.parent().map(|value| value.as_u32());
            let terminal_link =
                developer_terminal_link_for_process(pid_u32, &terminal_roots_by_pid, &parent_map);
            let name = clean_process_text(&process.name().to_string_lossy());
            let command = process_command_text(process.cmd());
            let executable = process.exe().map(process_path_display).unwrap_or_default();
            let cwd = process.cwd().map(process_path_display).unwrap_or_default();
            let in_app_family = pid_u32 == app_pid || app_descendant_pids.contains(&pid_u32);
            energy.add_process(
                pid_u32,
                &name,
                &command,
                &executable,
                &cwd,
                f64::from(process.cpu_usage()).max(0.0),
                process.memory(),
                pid_u32 == app_pid,
                in_app_family,
                terminal_link.is_some(),
            );

            if pid_u32 == app_pid {
                continue;
            }

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
        let energy_signals = DeveloperEnergyInternalSignals {
            terminal_root_count: terminal_roots.len(),
            workspace_root_count: workspace_roots.len(),
            visible_process_count: processes.len(),
            docker_process_count: processes
                .iter()
                .filter(|process| process.group_kind == "docker")
                .count(),
            cloud: cloud_signals,
        };

        (
            processes,
            groups,
            total_cpu_percent,
            total_memory_bytes,
            high_activity_count,
            protected_count,
            energy.finish(energy_signals),
        )
    };

    let snapshot = DeveloperProcessSnapshot {
        platform: developer_process_platform(),
        sampled_at_ms,
        energy,
        processes,
        groups,
        total_cpu_percent,
        total_memory_bytes,
        high_activity_count,
        protected_count,
    };
    developer_store_process_snapshot_cache(state, cache_key, sampled_at_ms, &snapshot);
    Ok(snapshot)
}

fn developer_process_snapshot_cache_key(
    active_workspace_root: Option<&str>,
    workspace_roots: &[String],
) -> String {
    let mut roots = workspace_roots.to_vec();
    roots.sort();
    format!(
        "active={}\nroots={}",
        active_workspace_root.unwrap_or_default(),
        roots.join("\n")
    )
}

fn developer_cached_process_snapshot(
    state: &DeveloperProcessMonitorState,
    cache_key: &str,
    now_ms: u64,
) -> Option<DeveloperProcessSnapshot> {
    let cache = state.snapshot_cache.lock().ok()?;
    let cache = cache.as_ref()?;
    if cache.key != cache_key {
        return None;
    }
    if now_ms.saturating_sub(cache.sampled_at_ms) > DEVELOPER_PROCESS_SNAPSHOT_CACHE_MS {
        return None;
    }
    Some(cache.snapshot.clone())
}

fn developer_store_process_snapshot_cache(
    state: &DeveloperProcessMonitorState,
    cache_key: String,
    sampled_at_ms: u64,
    snapshot: &DeveloperProcessSnapshot,
) {
    if let Ok(mut cache) = state.snapshot_cache.lock() {
        *cache = Some(DeveloperProcessSnapshotCache {
            key: cache_key,
            sampled_at_ms,
            snapshot: snapshot.clone(),
        });
    }
}

async fn developer_bound_ports_by_pid_cached(
    state: &DeveloperProcessMonitorState,
    now_ms: u64,
    force: bool,
) -> HashMap<u32, Vec<DeveloperProcessPort>> {
    if !force {
        if let Ok(cache) = state.port_cache.lock() {
            if now_ms.saturating_sub(cache.sampled_at_ms) <= DEVELOPER_PROCESS_PORT_CACHE_MS {
                return cache.ports_by_pid.clone();
            }
        }
    }

    let ports_by_pid = tauri::async_runtime::spawn_blocking(developer_bound_ports_by_pid)
        .await
        .unwrap_or_default();
    if let Ok(mut cache) = state.port_cache.lock() {
        cache.sampled_at_ms = now_ms;
        cache.ports_by_pid = ports_by_pid.clone();
    }
    ports_by_pid
}

async fn developer_energy_cloud_signals(
    state: Option<&CloudMcpState>,
) -> DeveloperEnergyCloudSignals {
    let Some(state) = state else {
        return DeveloperEnergyCloudSignals::default();
    };

    let (global_ws_connected, global_ws_retrying, registered_workspace_count, terminal_context_count) = {
        let runtime = state.inner.lock().await;
        let ws_status = runtime.global_ws_status.to_ascii_lowercase();
        (
            runtime.global_ws_connected,
            !runtime.global_ws_connected
                && (ws_status.contains("retry")
                    || ws_status.contains("connecting")
                    || ws_status.contains("resolving")
                    || ws_status.contains("authenticating")),
            runtime.registered_workspaces.len(),
            runtime.terminal_contexts.len(),
        )
    };
    let (
        outbox_pending_count,
        outbox_retrying_count,
        outbox_dead_letter_count,
        _outbox_oldest_pending_ms,
    ) = cloud_mcp_outbox_status_counts();

    DeveloperEnergyCloudSignals {
        global_ws_connected,
        global_ws_retrying,
        outbox_pending_count,
        outbox_retrying_count,
        outbox_dead_letter_count,
        registered_workspace_count,
        terminal_context_count,
    }
}

#[tauri::command]
async fn terminal_activity_snapshot(
    state: State<'_, DeveloperProcessMonitorState>,
    terminal_state: State<'_, TerminalState>,
    pane_id: String,
) -> Result<TerminalActivitySnapshot, String> {
    let pane_id = pane_id.trim().to_string();
    validate_terminal_pane_id(&pane_id)?;

    let terminal_roots = developer_terminal_process_roots(terminal_state.inner()).await;
    let terminal_root = terminal_roots
        .iter()
        .find(|root| root.pane_id == pane_id)
        .cloned();
    let activity_events_path = terminal_root
        .as_ref()
        .map(|root| terminal_activity_events_path(&pane_id, root.instance_id))
        .unwrap_or_else(|| terminal_activity_events_path(&pane_id, 0));
    let activity_events_path_text = activity_events_path.to_string_lossy().to_string();
    let process_snapshot = collect_developer_process_snapshot(
        state.inner(),
        None,
        terminal_state.inner(),
        None,
        Vec::new(),
        false,
    )
    .await?;

    let mut processes = process_snapshot
        .processes
        .into_iter()
        .filter(|process| {
            process.terminal_owned
                && process.terminal_pane_id == pane_id
                && developer_terminal_activity_process_visible(process)
        })
        .collect::<Vec<_>>();
    processes.sort_by(|left, right| {
        developer_terminal_activity_process_rank(right)
            .cmp(&developer_terminal_activity_process_rank(left))
            .then_with(|| {
                right
                    .cpu_percent
                    .partial_cmp(&left.cpu_percent)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| right.memory_bytes.cmp(&left.memory_bytes))
            .then_with(|| left.pid.cmp(&right.pid))
    });

    let dev_servers = processes
        .iter()
        .filter(|process| developer_terminal_process_is_dev_server(process))
        .cloned()
        .collect::<Vec<_>>();
    let total_cpu_percent = processes.iter().map(|process| process.cpu_percent).sum();
    let total_memory_bytes = processes
        .iter()
        .map(|process| process.memory_bytes)
        .fold(0u64, u64::saturating_add);
    let subagents = terminal_activity_subagents_from_events(
        &activity_events_path,
        terminal_root
            .as_ref()
            .map(|root| root.agent_kind.as_str())
            .unwrap_or_default(),
    );

    Ok(TerminalActivitySnapshot {
        platform: developer_process_platform(),
        sampled_at_ms: current_time_ms(),
        pane_id,
        terminal_found: terminal_root.is_some(),
        terminal_root_pid: terminal_root.as_ref().map(|root| root.root_pid),
        terminal_instance_id: terminal_root.as_ref().map(|root| root.instance_id),
        terminal_workspace_id: terminal_root
            .as_ref()
            .map(|root| root.workspace_id.clone())
            .unwrap_or_default(),
        terminal_workspace_name: terminal_root
            .as_ref()
            .map(|root| root.workspace_name.clone())
            .unwrap_or_default(),
        terminal_index: terminal_root.as_ref().and_then(|root| root.terminal_index),
        terminal_thread_id: terminal_root
            .as_ref()
            .map(|root| root.thread_id.clone())
            .unwrap_or_default(),
        terminal_agent_id: terminal_root
            .as_ref()
            .map(|root| root.agent_id.clone())
            .unwrap_or_default(),
        terminal_agent_kind: terminal_root
            .as_ref()
            .map(|root| root.agent_kind.clone())
            .unwrap_or_default(),
        activity_events_path: activity_events_path_text,
        processes,
        dev_servers,
        subagents,
        total_cpu_percent,
        total_memory_bytes,
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

fn developer_terminal_activity_process_visible(process: &DeveloperProcessInfo) -> bool {
    if process
        .terminal_root_pid
        .is_some_and(|root_pid| process.pid == root_pid)
    {
        return false;
    }
    if developer_process_is_diff_forge_mcp_sidecar(process) {
        return false;
    }
    if developer_terminal_process_is_dev_server(process) {
        return true;
    }
    if !process.bound_ports.is_empty() {
        return true;
    }

    let text = developer_process_search_text(process);
    if developer_process_text_is_shell_noise(&text) {
        return false;
    }
    if developer_process_is_agent_root_noise(process) {
        return false;
    }

    true
}

fn developer_process_is_diff_forge_mcp_sidecar(process: &DeveloperProcessInfo) -> bool {
    let command = process.command.to_ascii_lowercase();
    if !command.contains("--coordination-mcp-proxy")
        && !command.contains("--workspace-mcp-gateway")
    {
        return false;
    }

    let text = [
        process.name.as_str(),
        process.executable.as_str(),
        process.command.as_str(),
    ]
    .join(" ")
    .to_ascii_lowercase();

    text.contains("rust-diffforge") || text.contains("diff forge ai.app")
}

fn developer_terminal_activity_process_rank(process: &DeveloperProcessInfo) -> u8 {
    if developer_terminal_process_is_dev_server(process) {
        return 4;
    }
    if !process.bound_ports.is_empty() {
        return 3;
    }
    if process.cpu_percent >= DEVELOPER_PROCESS_CPU_WARNING_PERCENT
        || process.memory_bytes >= DEVELOPER_PROCESS_MEMORY_WARNING_BYTES
    {
        return 2;
    }
    1
}

fn developer_terminal_process_is_dev_server(process: &DeveloperProcessInfo) -> bool {
    let text = developer_process_search_text(process);
    let has_port = !process.bound_ports.is_empty();
    let dev_command = [
        "npm run dev",
        "npm start",
        "pnpm dev",
        "pnpm run dev",
        "yarn dev",
        "yarn start",
        "bun dev",
        "bun run dev",
        "vite",
        "next dev",
        "astro dev",
        "nuxt dev",
        "svelte-kit",
        "webpack serve",
        "parcel",
        "rails server",
        "flask run",
        "uvicorn",
        "gunicorn",
        "python -m http.server",
        "python3 -m http.server",
        "cargo run",
        "trunk serve",
        "tauri dev",
    ]
    .iter()
    .any(|needle| text.contains(needle));

    if dev_command {
        return true;
    }
    has_port
        && [
            "node",
            "npm",
            "pnpm",
            "yarn",
            "bun",
            "vite",
            "next",
            "python",
            "ruby",
            "rails",
            "cargo",
            "rust",
            "go",
            "java",
            "deno",
            "tsx",
        ]
        .iter()
        .any(|needle| text.contains(needle))
}

fn developer_process_search_text(process: &DeveloperProcessInfo) -> String {
    [
        process.name.as_str(),
        process.display_name.as_str(),
        process.group_id.as_str(),
        process.group_label.as_str(),
        process.command.as_str(),
        process.executable.as_str(),
        process.cwd.as_str(),
    ]
    .join(" ")
    .to_ascii_lowercase()
}

fn developer_process_text_is_shell_noise(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }
    [
        " zsh ",
        " bash ",
        " sh ",
        " fish ",
        " powershell",
        " pwsh",
        " cmd.exe",
        " login ",
        "/zsh",
        "/bash",
        "/sh",
        "/fish",
        "-zsh",
        "-bash",
        "-sh",
        "-fish",
    ]
    .iter()
    .any(|needle| format!(" {trimmed} ").contains(needle))
}

fn developer_process_text_is_agent_root_noise(text: &str) -> bool {
    [
        " codex ",
        "/codex",
        "\\codex",
        " claude ",
        "/claude",
        "\\claude",
        " claude-code ",
        "/claude-code",
        "\\claude-code",
        " opencode ",
        "/opencode",
        "\\opencode",
    ]
        .iter()
        .any(|needle| format!(" {text} ").contains(needle))
}

fn developer_process_is_agent_root_noise(process: &DeveloperProcessInfo) -> bool {
    let text = [
        process.name.as_str(),
        process.display_name.as_str(),
        process.group_id.as_str(),
        process.group_label.as_str(),
        process.command.as_str(),
        process.executable.as_str(),
    ]
    .join(" ")
    .to_ascii_lowercase();
    developer_process_text_is_agent_root_noise(&text)
}

fn terminal_activity_event_string(event: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| event.get(*key).and_then(Value::as_str))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn terminal_activity_event_bool(event: &Value, keys: &[&str]) -> bool {
    keys.iter()
        .any(|key| event.get(*key).and_then(Value::as_bool).unwrap_or(false))
}

fn terminal_activity_event_key(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn terminal_activity_subagent_event_is_pending(event: &Value) -> bool {
    let status = terminal_activity_event_key(&terminal_activity_event_string(
        event,
        &[
            "permissionStatus",
            "permission_status",
            "approvalStatus",
            "approval_status",
            "status",
        ],
    ));
    let decision = terminal_activity_event_key(&terminal_activity_event_string(
        event,
        &[
            "permissionDecision",
            "permission_decision",
            "approvalDecision",
            "approval_decision",
            "decision",
        ],
    ));
    let resolved = matches!(
        decision.as_str(),
        "allow"
            | "allowed"
            | "approve"
            | "approved"
            | "auto"
            | "autoallow"
            | "autoallowed"
            | "autoapprove"
            | "autoapproved"
            | "deny"
            | "denied"
            | "reject"
            | "rejected"
    ) || matches!(
        status.as_str(),
        "allow"
            | "allowed"
            | "approve"
            | "approved"
            | "auto"
            | "autoallow"
            | "autoallowed"
            | "autoapprove"
            | "autoapproved"
            | "deny"
            | "denied"
            | "reject"
            | "rejected"
            | "resolved"
    );
    if resolved {
        return false;
    }

    matches!(
        status.as_str(),
        "approvalrequired"
            | "awaitingapproval"
            | "awaitinginput"
            | "awaitinginstruction"
            | "awaitinguser"
            | "manualapprovalrequired"
            | "needsuser"
            | "needsuserinput"
            | "pending"
            | "requested"
            | "requiresapproval"
            | "requiresinput"
            | "requiresuserinput"
            | "reviewrequested"
            | "waitingforapproval"
            | "waitingforuser"
    ) || terminal_activity_event_bool(
        event,
        &[
            "manualApprovalRequired",
            "manual_approval_required",
            "providerBlockedForUser",
            "provider_blocked_for_user",
            "requiresUserInput",
            "requires_user_input",
            "terminalIsPromptingUser",
            "terminal_is_prompting_user",
            "promptingUser",
            "prompting_user",
        ],
    )
}

fn terminal_activity_subagent_event_status(event_key: &str, event: &Value) -> String {
    if terminal_activity_subagent_event_is_pending(event) {
        return "awaiting_instruction".to_string();
    }

    let status = terminal_activity_event_key(&terminal_activity_event_string(
        event,
        &["status", "activityStatus", "activity_status", "commandPhase", "command_phase"],
    ));
    if matches!(
        status.as_str(),
        "done" | "complete" | "completed" | "finished" | "success" | "toolcompleted"
    ) {
        return "done".to_string();
    }
    if matches!(
        status.as_str(),
        "blocked" | "failed" | "failure" | "error" | "interrupted" | "stopped"
    ) {
        return "failed".to_string();
    }

    if event_key == "subagentstop" || event_key == "posttooluse" {
        return "done".to_string();
    }
    "running".to_string()
}

fn terminal_activity_subagents_from_events(
    activity_events_path: &Path,
    fallback_provider: &str,
) -> Vec<TerminalActivitySubagent> {
    let Ok(body) = fs::read_to_string(activity_events_path) else {
        return Vec::new();
    };
    let mut subagents = HashMap::<String, TerminalActivitySubagent>::new();

    for line in body.lines().rev().take(500).collect::<Vec<_>>().into_iter().rev() {
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let event_name = event["eventName"]
            .as_str()
            .or_else(|| event["hookEventName"].as_str())
            .unwrap_or_default();
        let event_key = event_name.to_ascii_lowercase();
        let provider = event["provider"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(fallback_provider)
            .to_string();
        let timestamp_ms = event["timestampMs"]
            .as_u64()
            .unwrap_or_else(current_time_ms);
        let agent_id = event["agentId"].as_str().unwrap_or_default().trim();
        let tool_use_id = event["toolUseId"].as_str().unwrap_or_default().trim();
        let agent_type = event["agentType"]
            .as_str()
            .or_else(|| event["subagentType"].as_str())
            .unwrap_or_default()
            .trim();
        let description = event["description"].as_str().unwrap_or_default().trim();
        let is_agent_tool = event["toolName"]
            .as_str()
            .is_some_and(|tool| tool.eq_ignore_ascii_case("Agent") || tool.eq_ignore_ascii_case("Task"));
        let is_subagent_event = event_key == "subagentstart" || event_key == "subagentstop";
        let event_status = terminal_activity_subagent_event_status(&event_key, &event);
        let is_agent_prompt = event_status == "awaiting_instruction"
            && (!agent_id.is_empty() || !tool_use_id.is_empty() || !agent_type.is_empty());
        if !is_subagent_event && !is_agent_tool && !is_agent_prompt {
            continue;
        }
        let key = if !agent_id.is_empty() {
            format!("agent:{agent_id}")
        } else if !tool_use_id.is_empty() {
            format!("tool:{tool_use_id}")
        } else if !agent_type.is_empty() {
            format!("type:{agent_type}:{timestamp_ms}")
        } else {
            continue;
        };
        let entry = subagents.entry(key.clone()).or_insert_with(|| {
            let label = terminal_activity_subagent_label(agent_type, description);
            TerminalActivitySubagent {
                id: key.clone(),
                provider: provider.clone(),
                agent_id: agent_id.to_string(),
                agent_type: agent_type.to_string(),
                label,
                description: description.to_string(),
                status: event_status.clone(),
                started_at_ms: Some(timestamp_ms),
                finished_at_ms: None,
                updated_at_ms: timestamp_ms,
                transcript_path: event["transcriptPath"].as_str().unwrap_or_default().to_string(),
                agent_transcript_path: event["agentTranscriptPath"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                last_message: String::new(),
                source: "provider-hook".to_string(),
                confidence: if is_subagent_event { "named" } else { "inferred" }.to_string(),
            }
        });

        if !provider.trim().is_empty() {
            entry.provider = provider;
        }
        if !agent_id.is_empty() {
            entry.agent_id = agent_id.to_string();
        }
        if !agent_type.is_empty() {
            entry.agent_type = agent_type.to_string();
        }
        if !description.is_empty() {
            entry.description = description.to_string();
        }
        entry.label = terminal_activity_subagent_label(&entry.agent_type, &entry.description);
        entry.updated_at_ms = timestamp_ms;
        if event_status == "done" {
            entry.status = event_status;
            entry.finished_at_ms = Some(timestamp_ms);
        } else if event_status == "awaiting_instruction" || event_status == "failed" {
            entry.status = event_status;
        } else if event_key == "subagentstart" || event_key == "pretooluse" {
            entry.status = event_status;
            entry.started_at_ms = entry.started_at_ms.or(Some(timestamp_ms));
        }
        if let Some(value) = event["transcriptPath"].as_str().filter(|value| !value.trim().is_empty()) {
            entry.transcript_path = value.to_string();
        }
        if let Some(value) = event["agentTranscriptPath"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
        {
            entry.agent_transcript_path = value.to_string();
        }
        let last_message = terminal_activity_event_string(
            &event,
            &[
                "promptingUserText",
                "prompting_user_text",
                "lastMessage",
                "last_message",
                "message",
            ],
        );
        if !last_message.is_empty() {
            entry.last_message = last_message;
        } else if let Some(value) = event["lastMessage"].as_str().filter(|value| !value.trim().is_empty()) {
            entry.last_message = value.to_string();
        }
        if is_subagent_event {
            entry.confidence = "named".to_string();
        }
    }

    let mut values = subagents.into_values().collect::<Vec<_>>();
    values.sort_by(|left, right| {
        terminal_activity_subagent_status_rank(&right.status)
            .cmp(&terminal_activity_subagent_status_rank(&left.status))
            .then_with(|| right.updated_at_ms.cmp(&left.updated_at_ms))
            .then_with(|| left.label.cmp(&right.label))
    });
    values
}

fn terminal_activity_subagent_label(agent_type: &str, description: &str) -> String {
    let agent_type = agent_type.trim();
    if !agent_type.is_empty() {
        return agent_type.to_string();
    }
    let description = description.trim();
    if !description.is_empty() {
        return description
            .split_whitespace()
            .take(6)
            .collect::<Vec<_>>()
            .join(" ");
    }
    "Subagent".to_string()
}

fn terminal_activity_subagent_status_rank(status: &str) -> u8 {
    match status.trim().to_ascii_lowercase().as_str() {
        "awaiting_instruction" | "awaiting_input" | "awaiting_user" | "blocked" => 4,
        "running" | "active" => 3,
        "failed" => 2,
        "done" | "completed" => 1,
        _ => 0,
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
        state.invalidate_process_snapshot_cache();
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

        state.invalidate_process_snapshot_cache();
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
    state: State<'_, DeveloperProcessMonitorState>,
    action: String,
    workspace_roots: Vec<String>,
) -> Result<DockerDeveloperActionResult, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        docker_developer_action_blocking(&action, workspace_roots)
    })
    .await
    .map_err(|error| format!("Unable to join Docker action worker: {error}"))?;
    state.invalidate_docker_container_cache();
    state.invalidate_process_snapshot_cache();
    result
}

const DOCKER_CONTAINER_LIST_LIMIT: usize = 200;
const DOCKER_CONTAINER_SNAPSHOT_OUTPUT_LIMIT: usize = 512 * 1024;
const DOCKER_CONTAINER_LOGS_DEFAULT_TAIL: u32 = 200;
const DOCKER_CONTAINER_LOGS_MAX_TAIL: u32 = 2000;
const DOCKER_CONTAINER_LOGS_OUTPUT_LIMIT: usize = 24 * 1024;
const DOCKER_CONTAINER_ACTIONS: &[&str] =
    &["start", "stop", "restart", "pause", "unpause", "remove"];

fn validate_docker_container_ref(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 {
        return Err("A Docker container id or name is required.".to_string());
    }
    let valid = value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
        && value
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphanumeric());
    if !valid {
        return Err("Docker container reference contains unsupported characters.".to_string());
    }
    Ok(value.to_string())
}

fn docker_ps_labels_value(labels: &str, key: &str) -> String {
    labels
        .split(',')
        .filter_map(|pair| pair.split_once('='))
        .find(|(label_key, _)| label_key.trim() == key)
        .map(|(_, value)| value.trim().to_string())
        .unwrap_or_default()
}

fn docker_container_from_ps_line(line: &Value) -> Option<Value> {
    let id = line["ID"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .chars()
        .take(12)
        .collect::<String>();
    let name = line["Names"]
        .as_str()
        .unwrap_or_default()
        .split(',')
        .map(|value| value.trim().trim_start_matches('/'))
        .find(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string();
    let labels = line["Labels"].as_str().unwrap_or_default();
    let status = line["Status"].as_str().unwrap_or_default().to_string();
    let health = if status.contains("(healthy)") {
        "healthy"
    } else if status.contains("(unhealthy)") {
        "unhealthy"
    } else if status.contains("(health: starting)") {
        "starting"
    } else {
        ""
    };

    Some(json!({
        "id": id,
        "name": name,
        "image": line["Image"].as_str().unwrap_or_default(),
        "state": line["State"].as_str().unwrap_or_default().to_ascii_lowercase(),
        "status": status,
        "health": health,
        "ports": line["Ports"].as_str().unwrap_or_default(),
        "command": line["Command"].as_str().unwrap_or_default().trim_matches('"'),
        "createdAt": line["CreatedAt"].as_str().unwrap_or_default(),
        "runningFor": line["RunningFor"].as_str().unwrap_or_default(),
        "networks": line["Networks"].as_str().unwrap_or_default(),
        "composeProject": docker_ps_labels_value(labels, "com.docker.compose.project"),
        "composeService": docker_ps_labels_value(labels, "com.docker.compose.service"),
    }))
}

fn docker_container_state_rank(state: &str) -> u8 {
    match state {
        "running" => 0,
        "restarting" => 1,
        "paused" => 2,
        "created" => 3,
        "exited" => 4,
        "dead" => 5,
        _ => 6,
    }
}

fn docker_stats_percent(value: &str) -> Option<f64> {
    value.trim().trim_end_matches('%').parse::<f64>().ok()
}

fn docker_cli_is_missing(result: &DockerDeveloperCommandResult) -> bool {
    if result.exit_code.is_some() {
        return false;
    }
    let stderr = result.stderr.to_ascii_lowercase();
    stderr.contains("no such file")
        || stderr.contains("not found")
        || stderr.contains("cannot find")
        || stderr.contains("os error 2")
}

/// Containers panel snapshot: lists every Docker container (not just
/// workspace-linked ones) with identity, state, ports, and optional live
/// stats. Runs entirely through the Rust CLI bridge so the panel keeps
/// working in background/headless mode.
#[tauri::command]
async fn docker_containers_snapshot(
    state: State<'_, DeveloperProcessMonitorState>,
    include_stats: Option<bool>,
    force: Option<bool>,
) -> Result<Value, String> {
    let include_stats = include_stats.unwrap_or(false);
    let now_ms = current_time_ms();
    if !force.unwrap_or(false) {
        if let Some(snapshot) =
            docker_cached_container_snapshot(state.inner(), include_stats, now_ms)
        {
            return Ok(snapshot);
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        docker_containers_snapshot_blocking(include_stats)
    })
    .await
    .map_err(|error| format!("Unable to join Docker snapshot worker: {error}"))?
    .map(|snapshot| {
        docker_store_container_snapshot(state.inner(), include_stats, now_ms, &snapshot);
        snapshot
    })
}

fn docker_cached_container_snapshot(
    state: &DeveloperProcessMonitorState,
    include_stats: bool,
    now_ms: u64,
) -> Option<Value> {
    let cache = state.docker_container_cache.lock().ok()?;
    let cache = cache.as_ref()?;
    if include_stats && !cache.include_stats {
        return None;
    }
    if now_ms.saturating_sub(cache.sampled_at_ms) > DOCKER_CONTAINER_SNAPSHOT_CACHE_MS {
        return None;
    }
    Some(cache.snapshot.clone())
}

fn docker_store_container_snapshot(
    state: &DeveloperProcessMonitorState,
    include_stats: bool,
    sampled_at_ms: u64,
    snapshot: &Value,
) {
    if let Ok(mut cache) = state.docker_container_cache.lock() {
        *cache = Some(DockerContainerSnapshotCache {
            include_stats,
            sampled_at_ms,
            snapshot: snapshot.clone(),
        });
    }
}

fn docker_containers_snapshot_blocking(include_stats: bool) -> Result<Value, String> {
    let ps = run_developer_docker_command_with_limit(
        "docker",
        &[
            String::from("ps"),
            String::from("--all"),
            String::from("--no-trunc"),
            String::from("--format"),
            String::from("{{json .}}"),
        ],
        None,
        DOCKER_CONTAINER_SNAPSHOT_OUTPUT_LIMIT,
    );

    if !ps.success {
        if docker_cli_is_missing(&ps) {
            return Ok(json!({
                "available": false,
                "daemonRunning": false,
                "state": "cli_missing",
                "message": "The docker CLI is not installed.",
                "containers": [],
            }));
        }
        let stderr = ps.stderr.to_ascii_lowercase();
        if stderr.contains("cannot connect to the docker daemon")
            || stderr.contains("docker daemon")
            || stderr.contains("dockerdesktoplinuxengine")
            || stderr.contains("error during connect")
            || stderr.contains("is the docker daemon running")
        {
            return Ok(json!({
                "available": true,
                "daemonRunning": false,
                "state": "daemon_unreachable",
                "message": ps.stderr.lines().next().unwrap_or("The Docker daemon is not running."),
                "containers": [],
            }));
        }
        return Err(docker_command_error_message(
            "Unable to list Docker containers.",
            &ps,
        ));
    }

    let mut containers = ps
        .stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|line| docker_container_from_ps_line(&line))
        .take(DOCKER_CONTAINER_LIST_LIMIT)
        .collect::<Vec<_>>();

    let any_running = containers
        .iter()
        .any(|container| container["state"].as_str() == Some("running"));
    let mut stats_sampled = false;
    if include_stats && any_running {
        let stats = run_developer_docker_command_with_limit(
            "docker",
            &[
                String::from("stats"),
                String::from("--no-stream"),
                String::from("--format"),
                String::from("{{json .}}"),
            ],
            None,
            DOCKER_CONTAINER_SNAPSHOT_OUTPUT_LIMIT,
        );
        if stats.success {
            stats_sampled = true;
            let mut stats_by_id = HashMap::new();
            for line in stats.stdout.lines() {
                let Ok(entry) = serde_json::from_str::<Value>(line.trim()) else {
                    continue;
                };
                let id = entry["ID"]
                    .as_str()
                    .or_else(|| entry["Container"].as_str())
                    .unwrap_or_default()
                    .chars()
                    .take(12)
                    .collect::<String>();
                if !id.is_empty() {
                    stats_by_id.insert(id, entry);
                }
            }
            for container in containers.iter_mut() {
                let id = container["id"].as_str().unwrap_or_default().to_string();
                if let Some(entry) = stats_by_id.get(&id) {
                    container["cpuPercent"] = json!(docker_stats_percent(
                        entry["CPUPerc"].as_str().unwrap_or_default()
                    ));
                    container["memPercent"] = json!(docker_stats_percent(
                        entry["MemPerc"].as_str().unwrap_or_default()
                    ));
                    container["memUsage"] = json!(entry["MemUsage"].as_str().unwrap_or_default());
                    container["pids"] = entry["PIDs"]
                        .as_str()
                        .and_then(|value| value.trim().parse::<u64>().ok())
                        .map(|value| json!(value))
                        .unwrap_or(Value::Null);
                }
            }
        }
    }

    containers.sort_by(|left, right| {
        let left_rank = docker_container_state_rank(left["state"].as_str().unwrap_or_default());
        let right_rank = docker_container_state_rank(right["state"].as_str().unwrap_or_default());
        left_rank.cmp(&right_rank).then_with(|| {
            left["name"]
                .as_str()
                .unwrap_or_default()
                .cmp(right["name"].as_str().unwrap_or_default())
        })
    });

    Ok(json!({
        "available": true,
        "daemonRunning": true,
        "state": "ok",
        "containers": containers,
        "statsSampled": stats_sampled,
        "fetchedAtMs": current_time_ms(),
    }))
}

/// Per-container control (start/stop/restart/pause/unpause/remove) with a
/// feedback payload the Processes tab renders inline.
#[tauri::command]
async fn docker_container_action(
    state: State<'_, DeveloperProcessMonitorState>,
    container_ref: String,
    action: String,
) -> Result<Value, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        docker_container_action_blocking(&container_ref, &action)
    })
    .await
    .map_err(|error| format!("Unable to join Docker container action worker: {error}"))?;
    state.invalidate_docker_container_cache();
    state.invalidate_process_snapshot_cache();
    result
}

fn docker_container_action_blocking(container_ref: &str, action: &str) -> Result<Value, String> {
    let container_ref = validate_docker_container_ref(container_ref)?;
    let action = action.trim().to_ascii_lowercase();
    if !DOCKER_CONTAINER_ACTIONS.contains(&action.as_str()) {
        return Err(format!(
            "Unsupported Docker container action: {action}. Use one of {}.",
            DOCKER_CONTAINER_ACTIONS.join(", ")
        ));
    }
    let cli_verb = if action == "remove" { "rm" } else { action.as_str() };
    let result = run_developer_docker_command(
        "docker",
        &[cli_verb.to_string(), container_ref.clone()],
        None,
    );

    let message = if result.success {
        match action.as_str() {
            "start" => "Container started.",
            "stop" => "Container stopped.",
            "restart" => "Container restarted.",
            "pause" => "Container paused.",
            "unpause" => "Container unpaused.",
            "remove" => "Container removed.",
            _ => "Docker action completed.",
        }
        .to_string()
    } else {
        result
            .stderr
            .lines()
            .next()
            .filter(|line| !line.trim().is_empty())
            .unwrap_or("The Docker command failed.")
            .to_string()
    };

    Ok(json!({
        "ok": result.success,
        "action": action,
        "containerRef": container_ref,
        "exitCode": result.exit_code,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "durationMs": result.duration_ms,
        "message": message,
    }))
}

/// Tail of a container's logs for the Processes tab detail view.
#[tauri::command]
async fn docker_container_logs(container_ref: String, tail: Option<u32>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        docker_container_logs_blocking(&container_ref, tail)
    })
    .await
    .map_err(|error| format!("Unable to join Docker logs worker: {error}"))?
}

fn docker_container_logs_blocking(container_ref: &str, tail: Option<u32>) -> Result<Value, String> {
    let container_ref = validate_docker_container_ref(container_ref)?;
    let tail = tail
        .unwrap_or(DOCKER_CONTAINER_LOGS_DEFAULT_TAIL)
        .clamp(1, DOCKER_CONTAINER_LOGS_MAX_TAIL);
    let result = run_developer_docker_command_with_limit(
        "docker",
        &[
            String::from("logs"),
            String::from("--tail"),
            tail.to_string(),
            container_ref.clone(),
        ],
        None,
        DOCKER_CONTAINER_LOGS_OUTPUT_LIMIT,
    );
    if !result.success {
        return Err(docker_command_error_message(
            "Unable to read container logs.",
            &result,
        ));
    }

    // Container logs commonly land on stderr; merge both streams.
    let mut output = String::new();
    if !result.stdout.trim().is_empty() {
        output.push_str(&result.stdout);
    }
    if !result.stderr.trim().is_empty() {
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str(&result.stderr);
    }
    let truncated = output.chars().count() > DOCKER_CONTAINER_LOGS_OUTPUT_LIMIT;
    let output = output
        .chars()
        .take(DOCKER_CONTAINER_LOGS_OUTPUT_LIMIT)
        .collect::<String>();

    Ok(json!({
        "ok": true,
        "containerRef": container_ref,
        "tail": tail,
        "output": output,
        "truncated": truncated,
        "durationMs": result.duration_ms,
    }))
}

fn docker_developer_action_blocking(
    action: &str,
    workspace_roots: Vec<String>,
) -> Result<DockerDeveloperActionResult, String> {
    let action = parse_docker_developer_action(action)?;
    let workspace_roots = normalize_process_roots(workspace_roots, None);
    let targets = discover_docker_developer_targets(&workspace_roots)?;
    let linked_targets = docker_developer_unique_service_targets(
        &targets
            .into_iter()
            .filter(|target| target.workspace_linked)
            .collect::<Vec<_>>(),
    );

    if linked_targets.is_empty() {
        return Ok(DockerDeveloperActionResult {
            action: docker_developer_action_id(action).to_string(),
            target_count: 0,
            succeeded: 0,
            failed: 0,
            skipped: Vec::new(),
            commands: Vec::new(),
            message: "No workspace-linked Docker targets were found.".to_string(),
        });
    }

    let mut commands = Vec::new();
    let mut skipped = Vec::new();

    match action {
        DockerDeveloperAction::Relaunch => {
            let compose = docker_compose_command();
            for target in docker_developer_unique_service_targets(&linked_targets) {
                if target.is_compose_project() {
                    let Some(compose) = compose.as_ref() else {
                        skipped.push(format!(
                            "{}: Docker Compose is not available.",
                            target.display_name()
                        ));
                        continue;
                    };
                    let result = if target.container_id.is_empty() {
                        run_docker_compose_target_command(compose, &target, &["up", "-d"])
                    } else {
                        run_docker_compose_target_command(compose, &target, &["restart"])
                    };
                    commands.push(result);
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
                    if target.is_compose_project() {
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
                if !target.is_compose_project() {
                    continue;
                }

                let result = run_docker_compose_project_command(compose, &target, &["down"]);
                if !result.success {
                    failed_down_projects.insert(docker_developer_project_key(&target));
                }
                commands.push(result);
            }

            for target in docker_developer_unique_service_targets(&linked_targets) {
                if !target.is_compose_project() {
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

                commands.push(run_docker_compose_target_command(
                    compose,
                    &target,
                    &["up", "-d", "--build", "--force-recreate"],
                ));
            }
        }
        DockerDeveloperAction::RemountData => {
            let compose = docker_compose_command();
            for target in docker_developer_unique_project_targets(&linked_targets) {
                if !target.is_compose_project() {
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
    fn has_compose_service(&self) -> bool {
        !self.compose_service.is_empty()
    }

    fn is_compose_project(&self) -> bool {
        !self.compose_project.is_empty()
            || !self.compose_config_files.is_empty()
            || !self.compose_working_dir.is_empty()
    }

    fn display_name(&self) -> String {
        if !self.container_name.is_empty()
            && (!self.compose_project.is_empty() || !self.compose_service.is_empty())
        {
            let compose_label = [self.compose_project.as_str(), self.compose_service.as_str()]
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("/");
            if !compose_label.is_empty() && compose_label != self.container_name {
                return format!("{} / {}", self.container_name, compose_label);
            }
        }
        if !self.container_name.is_empty() {
            return self.container_name.clone();
        }
        if !self.compose_project.is_empty() && !self.compose_service.is_empty() {
            return format!("{}/{}", self.compose_project, self.compose_service);
        }
        if !self.compose_project.is_empty() {
            return self.compose_project.clone();
        }
        if !self.compose_service.is_empty() {
            return self.compose_service.clone();
        }
        if let Some(config_file) = self.compose_config_files.first() {
            if let Some(parent) = Path::new(config_file).parent() {
                if let Some(name) = parent.file_name().and_then(|value| value.to_str()) {
                    if !name.is_empty() {
                        return name.to_string();
                    }
                }
            }
            return config_file.clone();
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
        docker_developer_push_unique_target(
            &mut targets,
            docker_developer_target_from_inspect(container, workspace_roots),
        );
    }

    discover_docker_compose_project_targets(workspace_roots, &mut targets);
    discover_workspace_compose_file_targets(workspace_roots, &mut targets);

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
    let container_image = container["Config"]["Image"]
        .as_str()
        .or_else(|| container["Image"].as_str())
        .unwrap_or_default()
        .to_string();
    let labels = &container["Config"]["Labels"];
    let compose_project = docker_label(labels, "com.docker.compose.project");
    let compose_service = docker_label(labels, "com.docker.compose.service");
    let compose_working_dir = docker_label(labels, "com.docker.compose.project.working_dir");
    let compose_config_files = docker_split_compose_config_files(&docker_label(
        labels,
        "com.docker.compose.project.config_files",
    ));

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

    let identifier_candidates = docker_target_identifier_candidates(
        &container_name,
        &container_image,
        &compose_project,
        &compose_service,
    );
    let workspace_links = docker_target_workspace_links(
        &compose_working_dir,
        &compose_config_files,
        &bind_sources,
        &identifier_candidates,
        workspace_roots,
    );
    let workspace_linked = !workspace_links.is_empty();

    DockerDeveloperTarget {
        container_id,
        container_name,
        container_image,
        compose_project,
        compose_service,
        compose_working_dir,
        compose_config_files,
        workspace_linked,
        workspace_links,
    }
}

fn discover_docker_compose_project_targets(
    workspace_roots: &[String],
    targets: &mut Vec<DockerDeveloperTarget>,
) {
    let Some(compose) = docker_compose_command() else {
        return;
    };
    let mut args = Vec::new();
    if matches!(compose, DockerComposeCommand::Plugin) {
        args.push("compose".to_string());
    }
    args.extend([
        "ls".to_string(),
        "-a".to_string(),
        "--format".to_string(),
        "json".to_string(),
    ]);

    let result = run_developer_docker_command(&docker_compose_program(&compose), &args, None);
    if !result.success {
        return;
    }

    let Ok(projects) = serde_json::from_str::<Vec<DockerComposeLsProject>>(&result.stdout) else {
        return;
    };

    for project in projects {
        let config_files = docker_split_compose_config_files(&project.config_files);
        if config_files.is_empty() {
            continue;
        }
        let working_dir = docker_compose_working_dir_from_config_files(&config_files);
        let services =
            docker_compose_services_for_project(&compose, &project.name, &working_dir, &config_files);

        if services.is_empty() {
            docker_developer_push_unique_target(
                targets,
                docker_developer_compose_target(
                    project.name,
                    String::new(),
                    working_dir,
                    config_files,
                    workspace_roots,
                ),
            );
            continue;
        }

        for service in services {
            docker_developer_push_unique_target(
                targets,
                docker_developer_compose_target(
                    project.name.clone(),
                    service,
                    working_dir.clone(),
                    config_files.clone(),
                    workspace_roots,
                ),
            );
        }
    }
}

fn discover_workspace_compose_file_targets(
    workspace_roots: &[String],
    targets: &mut Vec<DockerDeveloperTarget>,
) {
    if workspace_roots.is_empty() {
        return;
    }
    let Some(compose) = docker_compose_command() else {
        return;
    };

    for root in workspace_roots {
        let config_files = docker_compose_files_in_directory(root);
        if config_files.is_empty() {
            continue;
        }
        let working_dir = docker_compose_working_dir_from_config_files(&config_files);
        let services = docker_compose_services_for_project(&compose, "", &working_dir, &config_files);

        if services.is_empty() {
            docker_developer_push_unique_target(
                targets,
                docker_developer_compose_target(
                    String::new(),
                    String::new(),
                    working_dir,
                    config_files,
                    workspace_roots,
                ),
            );
            continue;
        }

        for service in services {
            docker_developer_push_unique_target(
                targets,
                docker_developer_compose_target(
                    String::new(),
                    service,
                    working_dir.clone(),
                    config_files.clone(),
                    workspace_roots,
                ),
            );
        }
    }
}

fn docker_developer_compose_target(
    compose_project: String,
    compose_service: String,
    compose_working_dir: String,
    compose_config_files: Vec<String>,
    workspace_roots: &[String],
) -> DockerDeveloperTarget {
    let identifier_candidates =
        docker_target_identifier_candidates("", "", &compose_project, &compose_service);
    let workspace_links = docker_target_workspace_links(
        &compose_working_dir,
        &compose_config_files,
        &[],
        &identifier_candidates,
        workspace_roots,
    );
    let workspace_linked = !workspace_links.is_empty();

    DockerDeveloperTarget {
        container_id: String::new(),
        container_name: String::new(),
        container_image: String::new(),
        compose_project,
        compose_service,
        compose_working_dir,
        compose_config_files,
        workspace_linked,
        workspace_links,
    }
}

fn docker_developer_push_unique_target(
    targets: &mut Vec<DockerDeveloperTarget>,
    target: DockerDeveloperTarget,
) {
    let key = docker_developer_target_identity(&target);
    if targets
        .iter()
        .any(|existing| docker_developer_target_identity(existing) == key)
    {
        return;
    }
    targets.push(target);
}

fn docker_developer_target_identity(target: &DockerDeveloperTarget) -> String {
    if target.is_compose_project() {
        return format!(
            "compose:{}:{}:{}:{}",
            target.compose_project,
            target.compose_service,
            target.compose_working_dir,
            target.compose_config_files.join("|")
        );
    }
    format!("container:{}", target.container_id)
}

fn docker_label(labels: &Value, key: &str) -> String {
    labels[key].as_str().unwrap_or_default().to_string()
}

fn docker_target_identifier_candidates(
    container_name: &str,
    container_image: &str,
    compose_project: &str,
    compose_service: &str,
) -> Vec<(String, String)> {
    [
        ("container", container_name),
        ("image", container_image),
        ("compose project", compose_project),
        ("compose service", compose_service),
    ]
    .into_iter()
    .filter_map(|(kind, value)| {
        let value = clean_process_text(value);
        (!value.is_empty()).then(|| (kind.to_string(), value))
    })
    .collect()
}

fn docker_split_compose_config_files(value: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .filter_map(|item| {
            let key = normalize_process_text_for_compare(item);
            if seen.insert(key) {
                Some(item.to_string())
            } else {
                None
            }
        })
        .collect()
}

fn docker_compose_working_dir_from_config_files(config_files: &[String]) -> String {
    config_files
        .first()
        .and_then(|config_file| Path::new(config_file).parent().map(Path::to_path_buf))
        .map(|path| fs::canonicalize(&path).unwrap_or(path))
        .map(|path| process_path_display(&path))
        .unwrap_or_default()
}

fn docker_compose_files_in_directory(root: &str) -> Vec<String> {
    let root_path = PathBuf::from(root);
    for name in [
        "compose.yaml",
        "compose.yml",
        "docker-compose.yaml",
        "docker-compose.yml",
    ] {
        let candidate = root_path.join(name);
        if candidate.is_file() {
            let resolved = fs::canonicalize(&candidate).unwrap_or(candidate);
            return vec![process_path_display(&resolved)];
        }
    }

    Vec::new()
}

fn docker_compose_services_for_project(
    compose: &DockerComposeCommand,
    compose_project: &str,
    compose_working_dir: &str,
    compose_config_files: &[String],
) -> Vec<String> {
    if compose_config_files.is_empty() {
        return Vec::new();
    }

    let target = DockerDeveloperTarget {
        container_id: String::new(),
        container_name: String::new(),
        container_image: String::new(),
        compose_project: compose_project.to_string(),
        compose_service: String::new(),
        compose_working_dir: compose_working_dir.to_string(),
        compose_config_files: compose_config_files.to_vec(),
        workspace_linked: false,
        workspace_links: Vec::new(),
    };
    let mut args = docker_compose_base_args(compose, &target);
    args.extend(["config".to_string(), "--services".to_string()]);
    let cwd = docker_compose_cwd(&target);
    let result = run_developer_docker_command(
        &docker_compose_program(compose),
        &args,
        cwd.as_deref(),
    );
    if !result.success {
        return Vec::new();
    }

    let mut seen = HashSet::new();
    result
        .stdout
        .lines()
        .map(str::trim)
        .filter(|service| !service.is_empty())
        .filter_map(|service| {
            if seen.insert(service.to_string()) {
                Some(service.to_string())
            } else {
                None
            }
        })
        .collect()
}

fn docker_target_workspace_links(
    compose_working_dir: &str,
    compose_config_files: &[String],
    bind_sources: &[String],
    identifier_candidates: &[(String, String)],
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
            workspace_roots
                .iter()
                .any(|root| docker_path_matches_workspace_root(normalized, root))
        });

        if matched {
            let link = clean_process_text(&candidate);
            let key = normalize_process_text_for_compare(&link);
            if !link.is_empty() && seen.insert(key) {
                links.push(link);
            }
        }
    }

    for (kind, value) in identifier_candidates {
        if docker_identifier_matches_workspace_roots(value, workspace_roots) {
            let link = format!("{kind}: {}", clean_process_text(value));
            let key = normalize_process_text_for_compare(&link);
            if seen.insert(key) {
                links.push(link);
            }
        }
    }

    links
}

fn docker_path_matches_workspace_root(candidate: &str, root: &str) -> bool {
    if candidate.is_empty() || root.is_empty() {
        return false;
    }

    candidate == root
        || candidate.starts_with(&format!("{root}/"))
        || root.starts_with(&format!("{candidate}/"))
        || docker_paths_are_workspace_family_siblings(candidate, root)
}

fn docker_identifier_matches_workspace_roots(identifier: &str, workspace_roots: &[String]) -> bool {
    let identifier_variants = docker_identifier_variants(identifier);
    if identifier_variants.is_empty() {
        return false;
    }

    workspace_roots.iter().any(|root| {
        let root_variants = docker_workspace_identifier_variants(root);
        root_variants.iter().any(|root_variant| {
            identifier_variants.iter().any(|identifier_variant| {
                docker_identifier_variant_matches_workspace(identifier_variant, root_variant)
            })
        })
    })
}

fn docker_identifier_variant_matches_workspace(identifier: &str, workspace: &str) -> bool {
    if identifier.is_empty() || workspace.is_empty() {
        return false;
    }
    if workspace.len() >= 3
        && (identifier == workspace
            || identifier.starts_with(&format!("{workspace}-"))
            || identifier.ends_with(&format!("-{workspace}"))
            || identifier.contains(&format!("-{workspace}-")))
    {
        return true;
    }
    if identifier.len() >= 4
        && (workspace.starts_with(&format!("{identifier}-"))
            || workspace.ends_with(&format!("-{identifier}"))
            || workspace.contains(&format!("-{identifier}-")))
    {
        return true;
    }

    let identifier_tokens = docker_identifier_tokens(identifier);
    let workspace_tokens = docker_identifier_tokens(workspace);
    identifier_tokens
        .iter()
        .any(|token| token.len() >= 4 && workspace_tokens.contains(token))
}

fn docker_workspace_identifier_variants(root: &str) -> Vec<String> {
    docker_identifier_variants(&docker_path_leaf(root))
}

fn docker_identifier_variants(value: &str) -> Vec<String> {
    let trimmed = value.trim().trim_start_matches('/').trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let without_digest = trimmed.split('@').next().unwrap_or(trimmed);
    let mut candidates = vec![without_digest.to_string()];
    if let Some(last) = without_digest.rsplit('/').next() {
        candidates.push(last.to_string());
    }

    let mut variants = Vec::new();
    for candidate in candidates {
        let without_tag = docker_identifier_without_tag(&candidate);
        for value in [candidate, without_tag] {
            let slug = docker_identifier_slug(&value);
            if !slug.is_empty() && !variants.contains(&slug) {
                variants.push(slug);
            }
        }
    }

    variants
}

fn docker_identifier_without_tag(value: &str) -> String {
    let Some((before, after)) = value.rsplit_once(':') else {
        return value.to_string();
    };
    if before.is_empty() || after.contains('/') {
        return value.to_string();
    }
    before.to_string()
}

fn docker_identifier_slug(value: &str) -> String {
    docker_identifier_token_list(value).join("-")
}

fn docker_identifier_tokens(value: &str) -> HashSet<String> {
    docker_identifier_token_list(value).into_iter().collect()
}

fn docker_identifier_token_list(value: &str) -> Vec<String> {
    value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .map(str::trim)
        .filter(|token| token.len() >= 2)
        .map(|token| token.to_ascii_lowercase())
        .collect()
}

fn docker_normalized_path_variants(value: &str) -> Vec<String> {
    let normalized = normalize_process_path_text(value);
    let mut variants = vec![normalized.clone()];
    let text = normalized.trim_start_matches('/');

    for prefix in ["run/desktop/mnt/host/", "host_mnt/", "mnt/"] {
        let Some(rest) = text.strip_prefix(prefix) else {
            continue;
        };
        let mut parts = rest.splitn(2, '/');
        let first_part = parts.next().unwrap_or_default();
        if first_part.len() == 1 && first_part.chars().all(|ch| ch.is_ascii_alphabetic()) {
            let path = parts.next().unwrap_or_default();
            variants.push(normalize_process_text_for_compare(&format!(
                "{}:/{}",
                first_part,
                path
            )));
        } else if !first_part.is_empty() {
            variants.push(normalize_process_text_for_compare(&format!("/{rest}")));
        }
    }

    variants.sort();
    variants.dedup();
    variants
}

fn docker_paths_are_workspace_family_siblings(candidate: &str, root: &str) -> bool {
    let candidate_dir = docker_workspace_scope_directory(candidate);
    let root_dir = docker_workspace_scope_directory(root);
    if candidate_dir.is_empty() || root_dir.is_empty() || candidate_dir == root_dir {
        return false;
    }

    let Some(candidate_parent) = docker_path_parent(&candidate_dir) else {
        return false;
    };
    let Some(root_parent) = docker_path_parent(&root_dir) else {
        return false;
    };
    if candidate_parent != root_parent || docker_path_depth(&candidate_parent) < 3 {
        return false;
    }

    let candidate_leaf = docker_path_leaf(&candidate_dir);
    let root_leaf = docker_path_leaf(&root_dir);
    if candidate_leaf.is_empty() || root_leaf.is_empty() {
        return false;
    }

    let candidate_tokens = docker_workspace_name_tokens(&candidate_leaf);
    let root_tokens = docker_workspace_name_tokens(&root_leaf);
    candidate_tokens
        .iter()
        .any(|token| root_tokens.contains(token))
}

fn docker_workspace_scope_directory(value: &str) -> String {
    let text = value.trim().trim_end_matches('/');
    if text.is_empty() {
        return String::new();
    }

    let leaf = docker_path_leaf(text);
    if docker_compose_file_name_matches(&leaf) {
        return docker_path_parent(text).unwrap_or_default();
    }

    text.to_string()
}

fn docker_compose_file_name_matches(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "compose.yaml" | "compose.yml" | "docker-compose.yaml" | "docker-compose.yml"
    )
}

fn docker_path_parent(value: &str) -> Option<String> {
    let text = value.trim().trim_end_matches('/');
    let index = text.rfind('/')?;
    (index > 0).then(|| text[..index].to_string())
}

fn docker_path_leaf(value: &str) -> String {
    value
        .trim()
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string()
}

fn docker_path_depth(value: &str) -> usize {
    value.split('/').filter(|part| !part.is_empty()).count()
}

fn docker_workspace_name_tokens(value: &str) -> HashSet<String> {
    value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .map(str::trim)
        .filter(|token| token.len() >= 4)
        .map(|token| token.to_ascii_lowercase())
        .collect()
}

fn docker_developer_unique_service_targets(
    targets: &[DockerDeveloperTarget],
) -> Vec<DockerDeveloperTarget> {
    let mut seen = HashSet::new();
    let mut unique = Vec::new();

    for target in targets {
        let key = if target.is_compose_project() {
            format!(
                "compose:{}:{}:{}:{}",
                target.compose_project,
                target.compose_service,
                target.compose_working_dir,
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
        let key = if target.is_compose_project() {
            format!(
                "compose:{}:{}:{}",
                target.compose_project,
                target.compose_working_dir,
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
    if target.is_compose_project() {
        return format!(
            "compose:{}:{}:{}",
            target.compose_project,
            target.compose_working_dir,
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

fn run_docker_compose_target_command(
    compose: &DockerComposeCommand,
    target: &DockerDeveloperTarget,
    action_args: &[&str],
) -> DockerDeveloperCommandResult {
    if target.has_compose_service() {
        run_docker_compose_service_command(compose, target, action_args)
    } else {
        run_docker_compose_project_command(compose, target, action_args)
    }
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
    result.target_container_image = target.container_image.clone();
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
    run_developer_docker_command_with_limit(program, args, cwd, DOCKER_DEVELOPER_OUTPUT_LIMIT)
}

fn run_developer_docker_command_with_limit(
    program: &str,
    args: &[String],
    cwd: Option<&Path>,
    output_limit: usize,
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
            stdout: limit_docker_developer_output_with(
                &String::from_utf8_lossy(&output.stdout),
                output_limit,
            ),
            stderr: limit_docker_developer_output_with(
                &String::from_utf8_lossy(&output.stderr),
                output_limit,
            ),
            success: output.status.success(),
            duration_ms: docker_command_duration_ms(started_at),
            target_label: String::new(),
            target_container_id: String::new(),
            target_container_name: String::new(),
            target_container_image: String::new(),
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
            target_container_image: String::new(),
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
    limit_docker_developer_output_with(value, DOCKER_DEVELOPER_OUTPUT_LIMIT)
}

fn limit_docker_developer_output_with(value: &str, limit: usize) -> String {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    let mut output = normalized
        .chars()
        .filter(|ch| *ch == '\n' || *ch == '\t' || !ch.is_control())
        .collect::<String>()
        .trim()
        .to_string();
    if output.len() > limit {
        let mut end = limit;
        while end > 0 && !output.is_char_boundary(end) {
            end -= 1;
        }
        output.truncate(end);
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
        .with_cmd(UpdateKind::OnlyIfNotSet)
        .with_exe(UpdateKind::OnlyIfNotSet)
        .with_cwd(UpdateKind::OnlyIfNotSet)
        .without_tasks()
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

fn developer_descendant_pid_set(pid: u32, child_map: &HashMap<u32, Vec<u32>>) -> HashSet<u32> {
    let mut seen = HashSet::new();
    developer_collect_descendants(pid, child_map, &mut seen);
    seen
}

impl DeveloperEnergyBuildContext {
    fn new(sampled_at_ms: u64) -> Self {
        Self {
            sampled_at_ms,
            seen_pids: HashSet::new(),
            groups: HashMap::new(),
            app_core: None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn add_process(
        &mut self,
        pid: u32,
        name: &str,
        command: &str,
        executable: &str,
        cwd: &str,
        cpu_percent: f64,
        memory_bytes: u64,
        is_app_process: bool,
        in_app_family: bool,
        terminal_owned: bool,
    ) {
        if !self.seen_pids.insert(pid) {
            return;
        }
        if is_app_process {
            self.app_core = Some(DeveloperEnergyCoreProcess {
                pid,
                cpu_percent: cpu_percent.max(0.0),
                memory_bytes,
            });
            return;
        }

        let Some(category) = developer_energy_category_for_process(
            name,
            command,
            executable,
            cwd,
            in_app_family,
            terminal_owned,
        ) else {
            return;
        };
        let (label, description, cause, confidence) = developer_energy_category_metadata(category);
        let builder = self.groups.entry(category).or_insert_with(|| DeveloperEnergyGroupBuilder {
            id: category,
            label,
            description,
            cause,
            confidence,
            score: 0.0,
            cpu_percent: 0.0,
            memory_bytes: 0,
            process_count: 0,
            pids: Vec::new(),
        });
        let cpu_percent = cpu_percent.max(0.0);
        builder.score += developer_process_energy_score(category, cpu_percent, memory_bytes);
        builder.cpu_percent += cpu_percent;
        builder.memory_bytes = builder.memory_bytes.saturating_add(memory_bytes);
        builder.process_count += 1;
        builder.pids.push(pid);
    }

    fn finish(mut self, signals: DeveloperEnergyInternalSignals) -> DeveloperEnergySnapshot {
        self.add_internal_app_core_breakdown(signals);

        let mut groups = self
            .groups
            .into_values()
            .map(|mut builder| {
                builder.pids.sort_unstable();
                DeveloperEnergyGroup {
                    id: builder.id.to_string(),
                    label: builder.label.to_string(),
                    description: builder.description.to_string(),
                    cause: builder.cause.to_string(),
                    score: developer_round_energy(builder.score),
                    cpu_percent: developer_round_energy(builder.cpu_percent),
                    memory_bytes: builder.memory_bytes,
                    process_count: builder.process_count,
                    pids: builder.pids,
                    confidence: builder.confidence.to_string(),
                    intensity: developer_energy_intensity(builder.score).to_string(),
                }
            })
            .collect::<Vec<_>>();

        groups.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.label.cmp(&right.label))
        });

        let total_score = developer_round_energy(groups.iter().map(|group| group.score).sum());
        let active_group_count = groups.iter().filter(|group| group.score >= 1.0).count();
        let top_label = groups
            .first()
            .map(|group| group.label.clone())
            .unwrap_or_else(|| "Idle".to_string());
        let top_cause = groups
            .first()
            .map(|group| group.cause.clone())
            .unwrap_or_else(|| "No notable Diff Forge energy activity detected.".to_string());

        DeveloperEnergySnapshot {
            sampled_at_ms: self.sampled_at_ms,
            total_score,
            active_group_count,
            top_label,
            top_cause,
            groups,
        }
    }

    fn add_internal_app_core_breakdown(&mut self, signals: DeveloperEnergyInternalSignals) {
        let Some(core) = self.app_core.clone() else {
            return;
        };

        let has_terminals = signals.terminal_root_count > 0;
        let has_workspaces = signals.workspace_root_count > 0;
        let has_docker = signals.docker_process_count > 0;
        let active_processes = signals.visible_process_count > 0;
        let mut weights = vec![
            (
                "activityMonitor",
                if active_processes { 0.42 } else { 0.28 },
            ),
            (
                "terminalBackend",
                if has_terminals { 0.15 } else { 0.03 },
            ),
            (
                "workspaceFiles",
                if has_workspaces { 0.10 } else { 0.04 },
            ),
            (
                "dockerBridge",
                if has_docker { 0.07 } else { 0.02 },
            ),
            ("appLifecycle", 0.08),
            ("audioNative", 0.02),
            ("snippingNative", 0.02),
        ];
        weights.extend(developer_energy_coordination_cloud_weights(
            signals.cloud,
            has_terminals,
            has_workspaces,
        ));
        let total_weight = weights
            .iter()
            .map(|(_, weight)| *weight)
            .sum::<f64>()
            .max(1.0);

        for (category, weight) in weights.drain(..) {
            let normalized_weight = weight / total_weight;
            self.add_weighted_internal_core_group(
                category,
                core.pid,
                core.cpu_percent * normalized_weight,
                (core.memory_bytes as f64 * normalized_weight).round() as u64,
            );
        }
    }

    fn add_weighted_internal_core_group(
        &mut self,
        category: &'static str,
        pid: u32,
        cpu_percent: f64,
        memory_bytes: u64,
    ) {
        let (label, description, cause, confidence) = developer_energy_category_metadata(category);
        let builder = self.groups.entry(category).or_insert_with(|| DeveloperEnergyGroupBuilder {
            id: category,
            label,
            description,
            cause,
            confidence,
            score: 0.0,
            cpu_percent: 0.0,
            memory_bytes: 0,
            process_count: 0,
            pids: Vec::new(),
        });
        builder.score += developer_process_energy_score(category, cpu_percent, memory_bytes);
        builder.cpu_percent += cpu_percent;
        builder.memory_bytes = builder.memory_bytes.saturating_add(memory_bytes);
        builder.process_count = builder.process_count.max(1);
        if !builder.pids.contains(&pid) {
            builder.pids.push(pid);
        }
    }
}

fn developer_energy_coordination_cloud_weights(
    cloud: DeveloperEnergyCloudSignals,
    has_terminals: bool,
    has_workspaces: bool,
) -> Vec<(&'static str, f64)> {
    const COORDINATION_CLOUD_BUDGET: f64 = 0.14;

    let outbox_depth =
        cloud.outbox_pending_count + cloud.outbox_retrying_count + cloud.outbox_dead_letter_count;
    let mut relative = vec![
        ("coordinationKernel", 0.22),
        (
            "cloudWebSocket",
            if cloud.global_ws_connected {
                0.20
            } else if cloud.global_ws_retrying {
                0.24
            } else {
                0.12
            },
        ),
        (
            "sqliteOutbox",
            if outbox_depth > 0 {
                0.22 + (outbox_depth.min(24) as f64 / 24.0) * 0.08
            } else {
                0.10
            },
        ),
        (
            "mcpBridge",
            if has_terminals || cloud.terminal_context_count > 0 {
                0.16
            } else {
                0.10
            },
        ),
        (
            "deviceLiveState",
            if has_workspaces || cloud.registered_workspace_count > 0 {
                0.15
            } else {
                0.08
            },
        ),
        ("tokenomicsSync", 0.08),
        ("cloudBackgroundWatchers", 0.10),
    ];
    let total = relative
        .iter()
        .map(|(_, weight)| *weight)
        .sum::<f64>()
        .max(f64::EPSILON);

    relative
        .drain(..)
        .map(|(category, weight)| (category, COORDINATION_CLOUD_BUDGET * weight / total))
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn developer_energy_category_for_process(
    name: &str,
    command: &str,
    executable: &str,
    cwd: &str,
    in_app_family: bool,
    terminal_owned: bool,
) -> Option<&'static str> {
    if terminal_owned {
        return Some("terminals");
    }
    if !in_app_family {
        return None;
    }

    let haystack = [name, command, executable, cwd]
        .join(" ")
        .to_lowercase();

    if haystack.contains("audio")
        || haystack.contains("voice")
        || haystack.contains("microphone")
        || haystack.contains("whisper")
        || haystack.contains("deepgram")
    {
        return Some("audio");
    }
    if haystack.contains("network")
        || haystack.contains("cloud")
        || haystack.contains("mcp")
        || haystack.contains("reqwest")
        || haystack.contains("websocket")
    {
        return Some("networking");
    }
    if haystack.contains("graphics")
        || haystack.contains("media")
        || haystack.contains("gpu")
        || haystack.contains("compositor")
    {
        return Some("graphicsMedia");
    }
    if haystack.contains("activity monitor") || haystack.contains("process monitor") {
        return Some("activityMonitor");
    }
    if haystack.contains("tauri://localhost")
        || haystack.contains("webcontent")
        || haystack.contains("webkit")
        || haystack.contains("webview")
        || haystack.contains("renderer")
        || haystack.contains("localhost")
    {
        return Some("workspaceUi");
    }
    if haystack.contains("docker")
        || haystack.contains("node")
        || haystack.contains("npm")
        || haystack.contains("vite")
        || haystack.contains("cargo")
        || haystack.contains("python")
    {
        return Some("workspaceServices");
    }

    Some("background")
}

fn developer_energy_category_metadata(
    category: &str,
) -> (&'static str, &'static str, &'static str, &'static str) {
    match category {
        "workspaceUi" => (
            "Workspace UI/WebViews",
            "Tauri/WebKit views that host workspaces, tabs, files, settings, and panels.",
            "WebView rendering, mounted tabs, visible panels, or browser-side work.",
            "measured helper estimate",
        ),
        "graphicsMedia" => (
            "Graphics and media",
            "macOS graphics/media helpers used by WebViews, canvases, previews, and media.",
            "Rendering, media compositing, canvas/WebGL, previews, or animation.",
            "measured helper estimate",
        ),
        "networking" => (
            "Networking and MCP",
            "Network helpers, cloud sync, API requests, MCP bridges, and websocket traffic.",
            "Cloud/API traffic, MCP calls, websocket work, or background sync.",
            "measured helper estimate",
        ),
        "terminals" => (
            "Terminals and agents",
            "Diff Forge-owned terminal shells, coding agents, PTYs, and their child tools.",
            "Agent CPU, terminal output, PTY activity, shell tools, or builds.",
            "measured process estimate",
        ),
        "audio" => (
            "Audio and voice",
            "Audio capture, voice widgets, transcription helpers, and voice network paths.",
            "Microphone capture, VAD, transcription, or voice streaming.",
            "measured helper estimate",
        ),
        "activityMonitor" => (
            "Process monitor",
            "Process and energy sampling, process classification, port lookup, and Docker/process refresh work.",
            "Processes tab sampling, CPU/memory refresh, process classification, or port scans.",
            "internal estimate",
        ),
        "terminalBackend" => (
            "Terminal backend",
            "PTY management, terminal I/O transport, terminal cleanup, and terminal activity mapping.",
            "PTY I/O, terminal output transport, terminal lifecycle, or agent terminal mapping.",
            "internal estimate",
        ),
        "coordinationKernel" => (
            "Coordination kernel",
            "Task/session state, leases, checkpoints, patch lifecycle, and local coordination events.",
            "Local task/session bookkeeping, lease checks, checkpoint writes, or patch state updates.",
            "internal estimate",
        ),
        "cloudWebSocket" => (
            "Cloud websocket",
            "Cloud app websocket connection, route resolution, keepalive pings, reconnects, and live message routing.",
            "Websocket keepalive, reconnecting, route lookup, cloud auth, or live cloud messages.",
            "internal estimate",
        ),
        "sqliteOutbox" => (
            "SQLite sync outbox",
            "Durable Cloud sync queue, coalescing, retry bookkeeping, acknowledgement writes, and pending status counts.",
            "Queued cloud events, retry rows, outbox SQLite reads/writes, or sync status updates.",
            "internal estimate",
        ),
        "mcpBridge" => (
            "MCP bridge",
            "Coordination MCP proxy, workspace MCP gateway, tool routing, and agent metadata enrichment.",
            "MCP calls, local proxy routing, workspace gateway traffic, or agent coordination tool activity.",
            "internal estimate",
        ),
        "deviceLiveState" => (
            "Device live state",
            "Live workspace, terminal, server, architecture, and device snapshots published to Cloud.",
            "Device/workspace/terminal snapshot publishing or live-state convergence.",
            "internal estimate",
        ),
        "tokenomicsSync" => (
            "Tokenomics sync",
            "Usage scanning, account/provider reconciliation, tokenomics deltas, and billing-scope summary sync.",
            "Tokenomics scans, local usage database reads, account reconciliation, or usage snapshot publishing.",
            "internal estimate",
        ),
        "cloudBackgroundWatchers" => (
            "Cloud watchers",
            "Headless architecture checks, agent inventory checks, remote command listeners, and todo/cloud maintenance loops.",
            "Background cloud watchers, remote command handling, inventory checks, or todo/cloud maintenance.",
            "internal estimate",
        ),
        "workspaceFiles" => (
            "Workspace and files",
            "Workspace validation, file browsing, file actions, workspace metadata, and native file services.",
            "Workspace/file requests, metadata work, validation, or file service activity.",
            "internal estimate",
        ),
        "dockerBridge" => (
            "Docker bridge",
            "Docker container snapshots, stats, logs, lifecycle actions, and Compose-related checks.",
            "Docker stats, container refresh, logs, or Compose bridge work.",
            "internal estimate",
        ),
        "appLifecycle" => (
            "App lifecycle and windows",
            "Tauri IPC, app lifecycle, windows, deep links, tray/background mode, notifications, and shortcuts.",
            "Tauri command handling, windows, background mode, shortcuts, or app lifecycle work.",
            "internal estimate",
        ),
        "audioNative" => (
            "Audio native services",
            "Native audio capture state, voice plumbing, shortcuts, and transcription orchestration.",
            "Audio capture state, voice routing, transcription setup, or audio shortcuts.",
            "internal estimate",
        ),
        "snippingNative" => (
            "Snipping and capture",
            "Snipping windows, screen capture, frozen frames, backdrop refresh, and image processing.",
            "Screen capture, snipping windows, preview refresh, or image processing.",
            "internal estimate",
        ),
        "workspaceServices" => (
            "Workspace services",
            "Workspace-bound dev servers, package managers, Docker commands, and local tools.",
            "Dev servers, builds, package scripts, Docker CLI work, or local tooling.",
            "measured process estimate",
        ),
        _ => (
            "Background helpers",
            "Diff Forge child helpers that do not map cleanly to another bucket yet.",
            "Background helper process activity.",
            "measured helper estimate",
        ),
    }
}

fn developer_process_energy_score(category: &str, cpu_percent: f64, memory_bytes: u64) -> f64 {
    let memory_gb = memory_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
    let category_weight = match category {
        "activityMonitor" => 1.16,
        "graphicsMedia" => 1.12,
        "cloudWebSocket" => 1.08,
        "networking" => 1.08,
        "audio" => 1.08,
        "audioNative" => 1.08,
        "sqliteOutbox" => 1.04,
        "mcpBridge" => 1.04,
        "terminals" => 1.04,
        "terminalBackend" => 1.04,
        "tokenomicsSync" => 1.02,
        _ => 1.0,
    };
    ((cpu_percent * category_weight) + (memory_gb * 1.35)).max(0.0)
}

fn developer_energy_intensity(score: f64) -> &'static str {
    if score >= 20.0 {
        "hot"
    } else if score >= 6.0 {
        "warm"
    } else if score >= 1.0 {
        "active"
    } else {
        "idle"
    }
}

fn developer_round_energy(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    (value.max(0.0) * 10.0).round() / 10.0
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

#[cfg(test)]
mod developer_process_docker_tests {
    use super::*;

    #[test]
    fn docker_container_from_ps_line_parses_identity_and_compose_labels() {
        let line = json!({
            "ID": "0123456789abcdef0123",
            "Names": "/web-1",
            "Image": "nginx:1.27",
            "State": "Running",
            "Status": "Up 3 hours (healthy)",
            "Ports": "0.0.0.0:8080->80/tcp",
            "Command": "\"nginx -g daemon off\"",
            "CreatedAt": "2026-06-10 10:00:00 +0000 UTC",
            "RunningFor": "3 hours ago",
            "Networks": "app_default",
            "Labels": "com.docker.compose.project=shop,com.docker.compose.service=web,other=1",
        });
        let container = docker_container_from_ps_line(&line).unwrap();
        assert_eq!(container["id"], "0123456789ab");
        assert_eq!(container["name"], "web-1");
        assert_eq!(container["state"], "running");
        assert_eq!(container["health"], "healthy");
        assert_eq!(container["composeProject"], "shop");
        assert_eq!(container["composeService"], "web");
        assert_eq!(container["ports"], "0.0.0.0:8080->80/tcp");
    }

    #[test]
    fn docker_container_action_rejects_bad_refs_and_actions() {
        assert!(validate_docker_container_ref("web-1").is_ok());
        assert!(validate_docker_container_ref("0123456789ab").is_ok());
        assert!(validate_docker_container_ref("").is_err());
        assert!(validate_docker_container_ref("-flag").is_err());
        assert!(validate_docker_container_ref("a;rm -rf /").is_err());
        assert!(validate_docker_container_ref("a b").is_err());

        let unsupported = docker_container_action_blocking("web-1", "explode");
        assert!(unsupported.unwrap_err().contains("Unsupported"));
    }

    #[test]
    fn docker_container_state_rank_orders_running_first() {
        assert!(docker_container_state_rank("running") < docker_container_state_rank("paused"));
        assert!(docker_container_state_rank("paused") < docker_container_state_rank("exited"));
        assert!(docker_container_state_rank("exited") < docker_container_state_rank("unknown"));
    }

    #[test]
    fn docker_cli_missing_detection_matches_spawn_errors() {
        let missing = DockerDeveloperCommandResult {
            program: "docker".to_string(),
            args: Vec::new(),
            cwd: String::new(),
            exit_code: None,
            stdout: String::new(),
            stderr: "No such file or directory (os error 2)".to_string(),
            success: false,
            duration_ms: 1,
            target_label: String::new(),
            target_container_id: String::new(),
            target_container_name: String::new(),
            target_container_image: String::new(),
            target_compose_project: String::new(),
            target_compose_service: String::new(),
            target_compose_working_dir: String::new(),
            target_compose_config_files: Vec::new(),
            target_workspace_links: Vec::new(),
        };
        assert!(docker_cli_is_missing(&missing));

        let daemon_down = DockerDeveloperCommandResult {
            exit_code: Some(1),
            stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock"
                .to_string(),
            ..missing
        };
        assert!(!docker_cli_is_missing(&daemon_down));
    }


    fn test_developer_process_info(name: &str, command: &str) -> DeveloperProcessInfo {
        DeveloperProcessInfo {
            pid: 42,
            parent_pid: Some(7),
            child_pids: Vec::new(),
            child_count: 0,
            name: name.to_string(),
            display_name: name.to_string(),
            group_id: "workspace-process".to_string(),
            group_label: "Workspace process".to_string(),
            group_kind: "workspace".to_string(),
            icon_hint: "terminal".to_string(),
            command: command.to_string(),
            executable: format!("/Applications/Diff Forge AI.app/Contents/MacOS/{name}"),
            cwd: "/Users/dev/project".to_string(),
            cpu_percent: 0.0,
            memory_bytes: 0,
            virtual_memory_bytes: 0,
            start_time: 0,
            run_time_seconds: 0,
            attribution: "diffForge".to_string(),
            attribution_label: "Diff Forge terminal".to_string(),
            workspace_root: String::new(),
            risk: "safe".to_string(),
            killable: true,
            kill_disabled_reason: String::new(),
            kill_tree_default: true,
            terminal_owned: true,
            terminal_pane_id: "terminal-1".to_string(),
            terminal_instance_id: Some(1),
            terminal_workspace_id: "workspace".to_string(),
            terminal_workspace_name: "Workspace".to_string(),
            terminal_index: Some(0),
            terminal_thread_id: "thread".to_string(),
            terminal_agent_id: "agent".to_string(),
            terminal_agent_kind: "codex".to_string(),
            terminal_root_pid: Some(1),
            bound_ports: Vec::new(),
        }
    }

    #[test]
    fn terminal_activity_hides_diff_forge_mcp_sidecars() {
        let process = test_developer_process_info(
            "rust-diffforge",
            "/Applications/Diff Forge AI.app/Contents/MacOS/rust-diffforge --workspace-mcp-gateway --repo-path /tmp/repo",
        );

        assert!(!developer_terminal_activity_process_visible(&process));
    }

    #[test]
    fn terminal_activity_keeps_real_dev_server_processes() {
        let mut process = test_developer_process_info(
            "node",
            "node /Users/dev/project/node_modules/.bin/vite --host 127.0.0.1",
        );
        process.executable = "/Users/dev/.nvm/versions/node/bin/node".to_string();

        assert!(developer_terminal_activity_process_visible(&process));
    }

    #[test]
    fn terminal_activity_subagent_preserves_awaiting_instruction_status() {
        let path = std::env::temp_dir().join(format!(
            "diffforge-subagent-activity-{}.jsonl",
            current_time_ms(),
        ));
        let body = [
            json!({
                "timestampMs": 1000,
                "eventName": "PreToolUse",
                "provider": "claude",
                "toolName": "Task",
                "toolUseId": "tool-1",
                "agentType": "Halley",
                "description": "Check the database",
            })
            .to_string(),
            json!({
                "timestampMs": 1100,
                "eventName": "PermissionPrompt",
                "provider": "claude",
                "toolUseId": "tool-1",
                "agentType": "Halley",
                "requiresUserInput": true,
                "promptingUserText": "Approve database inspection",
            })
            .to_string(),
        ]
        .join("\n");
        fs::write(&path, body).unwrap();

        let subagents = terminal_activity_subagents_from_events(&path, "claude");
        let _ = fs::remove_file(&path);

        assert_eq!(subagents.len(), 1);
        assert_eq!(subagents[0].label, "Halley");
        assert_eq!(subagents[0].status, "awaiting_instruction");
        assert_eq!(subagents[0].last_message, "Approve database inspection");
    }

    #[test]
    fn docker_workspace_links_match_related_compose_sibling_project() {
        let workspace_root = normalize_process_text_for_compare(
            r"C:\Users\dev\projects\inventory-ui",
        );
        let compose_file =
            r"C:\Users\dev\projects\inventory-api\docker-compose.yml"
                .to_string();

        let links = docker_target_workspace_links(
            r"C:\Users\dev\projects\inventory-api",
            &[compose_file.clone()],
            &[],
            &[],
            &[workspace_root],
        );

        assert!(links.iter().any(|link| link == &compose_file));
    }

    #[test]
    fn docker_workspace_links_reject_unrelated_sibling_project() {
        let workspace_root = normalize_process_text_for_compare(
            r"C:\Users\dev\projects\inventory-ui",
        );

        let links = docker_target_workspace_links(
            r"C:\Users\dev\projects\redis",
            &[r"C:\Users\dev\projects\redis\docker-compose.yml".to_string()],
            &[],
            &[],
            &[workspace_root],
        );

        assert!(links.is_empty());
    }

    #[test]
    fn docker_workspace_links_match_container_and_image_names() {
        let workspace_root = normalize_process_text_for_compare("/srv/checkouts/payments-api");
        let identifiers = docker_target_identifier_candidates(
            "payments-api-1",
            "ghcr.io/example/payments-api:dev",
            "",
            "",
        );

        let links = docker_target_workspace_links("", &[], &[], &identifiers, &[workspace_root]);

        assert!(links
            .iter()
            .any(|link| link == "container: payments-api-1"));
        assert!(links
            .iter()
            .any(|link| link == "image: ghcr.io/example/payments-api:dev"));
    }

    #[test]
    fn docker_path_variants_include_desktop_host_mounts() {
        let windows_variants = docker_normalized_path_variants(
            "/run/desktop/mnt/host/c/Users/dev/projects/inventory-api",
        );
        let mac_variants = docker_normalized_path_variants("/host_mnt/Users/dev/projects/inventory-api");

        assert!(windows_variants.iter().any(|variant| {
            variant
                .to_ascii_lowercase()
                .ends_with("/users/dev/projects/inventory-api")
        }));
        assert!(mac_variants.iter().any(|variant| {
            variant
                .to_ascii_lowercase()
                .ends_with("/users/dev/projects/inventory-api")
        }));
    }
}

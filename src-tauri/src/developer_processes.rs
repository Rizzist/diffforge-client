use sysinfo::{
    Pid as SysPid, ProcessRefreshKind, ProcessesToUpdate, System as SysSystem, UpdateKind,
};

const DEVELOPER_PROCESS_CPU_WARNING_PERCENT: f64 = 65.0;
const DEVELOPER_PROCESS_MEMORY_WARNING_BYTES: u64 = 1024 * 1024 * 1024;
const DEVELOPER_PROCESS_COMMAND_LIMIT: usize = 4096;
const DOCKER_DEVELOPER_OUTPUT_LIMIT: usize = 4096;
const DEVELOPER_PROCESS_PORT_SCAN_LIMIT: usize = 2048;
const DEVELOPER_PROCESS_SNAPSHOT_CACHE_MS: u64 = 1500;
const DEVELOPER_PROCESS_PORT_CACHE_MS: u64 = 60_000;
const TERMINAL_ACTIVITY_SUBAGENT_TOOL_TTL_MS: u64 = 10 * 60 * 1000;
const TERMINAL_ACTIVITY_SUBAGENT_LABEL_MAX_CHARS: usize = 96;

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
            developer_process_refresh_kind(true),
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
struct DeveloperEnergySnapshot {
    sampled_at_ms: u64,
    total_score: f64,
    active_group_count: usize,
    top_label: String,
    top_cause: String,
    groups: Vec<DeveloperEnergyGroup>,
}

impl DeveloperEnergySnapshot {
    fn idle(sampled_at_ms: u64) -> Self {
        Self {
            sampled_at_ms,
            total_score: 0.0,
            active_group_count: 0,
            top_label: "Diagnostics off".to_string(),
            top_cause: "Energy diagnostics are disabled for the low-power process list.".to_string(),
            groups: Vec::new(),
        }
    }
}

#[derive(Serialize, Clone)]
struct DeveloperEnergyGroup {
    id: String,
    label: String,
    description: String,
    cause: String,
    score: f64,
    share_percent: f64,
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
    coordination_activity_count: usize,
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
struct DeveloperProcessPort {
    protocol: String,
    address: String,
    port: u16,
}

#[derive(Serialize, Clone)]
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
struct DeveloperProcessKillResult {
    requested_pid: u32,
    include_tree: bool,
    force: bool,
    killed_pids: Vec<u32>,
    failed_pids: Vec<u32>,
    message: String,
}

#[derive(Serialize)]
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

#[derive(Deserialize)]
struct DockerComposeLsProject {
    #[serde(default, rename = "Name")]
    name: String,
    #[serde(default, rename = "ConfigFiles")]
    config_files: String,
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

async fn collect_developer_process_snapshot(
    state: &DeveloperProcessMonitorState,
    cloud_state: Option<&CloudMcpState>,
    terminal_state: &TerminalState,
    active_workspace_root: Option<String>,
    workspace_roots: Vec<String>,
    force: bool,
    include_diagnostics: bool,
    include_ports: bool,
) -> Result<DeveloperProcessSnapshot, String> {
    let active_workspace_root = normalize_optional_process_root(active_workspace_root.as_deref());
    let workspace_roots =
        normalize_process_roots(workspace_roots, active_workspace_root.as_deref());
    let app_pid = std::process::id();
    let sampled_at_ms = current_time_ms();
    let cache_key = developer_process_snapshot_cache_key(
        active_workspace_root.as_deref(),
        &workspace_roots,
        include_diagnostics,
        include_ports,
    );
    if !force {
        let _span = BackendCpuSpan::new("developer_processes.snapshot.cache_lookup");
        if let Some(snapshot) =
            developer_cached_process_snapshot(state, &cache_key, sampled_at_ms)
        {
            return Ok(snapshot);
        }
    }

    let terminal_roots = developer_terminal_process_roots(&terminal_state).await;
    let cloud_signals = if include_diagnostics {
        developer_energy_cloud_signals(cloud_state).await
    } else {
        DeveloperEnergyCloudSignals::default()
    };
    let coordination_activity_count = if include_diagnostics {
        let _span = BackendCpuSpan::new("developer_processes.snapshot.coordination_activity");
        developer_energy_coordination_activity_count(&workspace_roots)
    } else {
        0
    };
    let bound_ports_by_pid = if include_ports {
        developer_bound_ports_by_pid_cached(state, sampled_at_ms, force).await
    } else {
        HashMap::new()
    };

    let (
        processes,
        groups,
        total_cpu_percent,
        total_memory_bytes,
        high_activity_count,
        protected_count,
        energy,
    ) = {
        let _span = BackendCpuSpan::new("developer_processes.snapshot.sysinfo_and_build");
        let mut system = state
            .system
            .lock()
            .map_err(|_| "Process monitor state is unavailable.".to_string())?;
        // Phase 1: a cheap, tree-only enumeration (no per-process CPU/memory
        // syscalls) so we can build the parent/child maps and figure out which
        // processes actually matter.
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().without_tasks(),
        );

        let parent_map = developer_parent_map(&system);
        let child_map = developer_child_map(&system);
        let app_descendant_pids = if include_diagnostics {
            developer_descendant_pid_set(app_pid, &child_map)
        } else {
            HashSet::new()
        };
        let terminal_roots_by_pid = terminal_roots
            .iter()
            .map(|root| (root.root_pid, root))
            .collect::<HashMap<_, _>>();

        // Phase 2: per-process CPU/memory sampling is the expensive part on
        // macOS (a syscall per process), so restrict it to the processes we
        // actually report — the terminal process trees — instead of every
        // process on the machine. The legacy deep scan still samples all.
        let detail_pids: Vec<SysPid> = if include_diagnostics {
            system.processes().keys().copied().collect()
        } else {
            let mut pids: HashSet<u32> = HashSet::new();
            for root in &terminal_roots {
                for descendant in developer_process_tree_child_first(root.root_pid, &child_map) {
                    pids.insert(descendant);
                }
            }
            pids.into_iter().map(SysPid::from_u32).collect()
        };
        if !detail_pids.is_empty() {
            system.refresh_processes_specifics(
                ProcessesToUpdate::Some(&detail_pids),
                false,
                developer_process_refresh_kind(include_diagnostics),
            );
        }

        let mut energy = DeveloperEnergyBuildContext::new(sampled_at_ms);
        let mut processes = Vec::new();

        for (pid, process) in system.processes() {
            let pid_u32 = pid.as_u32();
            let parent_pid = process.parent().map(|value| value.as_u32());
            let terminal_link =
                developer_terminal_link_for_process(pid_u32, &terminal_roots_by_pid, &parent_map);
            // Terminal activity only reports terminal-owned processes; skip the
            // rest so we never build entries (or sample detail) for every
            // process on the system. The deep scan still reports everything.
            if !include_diagnostics && terminal_link.is_none() {
                continue;
            }
            let name = clean_process_text(&process.name().to_string_lossy());
            let command = if include_diagnostics {
                process_command_text(process.cmd())
            } else {
                String::new()
            };
            let executable = if include_diagnostics {
                process.exe().map(process_path_display).unwrap_or_default()
            } else {
                String::new()
            };
            let cwd = if include_diagnostics {
                process.cwd().map(process_path_display).unwrap_or_default()
            } else {
                String::new()
            };
            if include_diagnostics {
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
            }

            if pid_u32 == app_pid {
                continue;
            }

            let attribution = if terminal_link.is_some() {
                DeveloperProcessAttribution {
                    id: "diffForge",
                    label: "Diff Forge terminal",
                    workspace_root: String::new(),
                }
            } else if !include_diagnostics {
                DeveloperProcessAttribution {
                    id: "system",
                    label: "System",
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
            let child_count = if include_diagnostics {
                developer_descendant_count(pid_u32, &child_map)
            } else {
                child_pids.len()
            };
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
            coordination_activity_count,
            cloud: cloud_signals,
        };

        (
            processes,
            groups,
            total_cpu_percent,
            total_memory_bytes,
            high_activity_count,
            protected_count,
            if include_diagnostics {
                energy.finish(energy_signals)
            } else {
                DeveloperEnergySnapshot::idle(sampled_at_ms)
            },
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
    include_diagnostics: bool,
    include_ports: bool,
) -> String {
    let mut roots = workspace_roots.to_vec();
    roots.sort();
    format!(
        "active={}\ndiagnostics={}\nports={}\nroots={}",
        active_workspace_root.unwrap_or_default(),
        include_diagnostics,
        include_ports,
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

#[tauri::command(rename_all = "snake_case")]
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
    let expected_instance_id = terminal_root
        .as_ref()
        .map(|root| root.instance_id)
        .unwrap_or(0);
    let expected_workspace_id = terminal_root
        .as_ref()
        .map(|root| root.workspace_id.as_str())
        .unwrap_or_default();
    let activity_events_path = terminal_activity_events_path(
        &pane_id,
        expected_instance_id,
        Some(expected_workspace_id),
    );
    let activity_events_path_text = activity_events_path.to_string_lossy().to_string();
    let process_snapshot = collect_developer_process_snapshot(
        state.inner(),
        None,
        terminal_state.inner(),
        None,
        Vec::new(),
        false,
        false,
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
        &pane_id,
        expected_instance_id,
        expected_workspace_id,
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

/// Lightweight companion to `terminal_activity_snapshot`: returns only the
/// subagents an agent has spawned inside a terminal, read from the harness hook
/// events (SubagentStart/SubagentStop/Task). No OS process scan — this is cheap
/// enough to poll for the per-terminal subagent overlay. Empty for harnesses
/// that don't surface subagent lifecycle (e.g. plain OpenCode sessions).
#[tauri::command]
async fn terminal_subagents_snapshot(
    terminal_state: State<'_, TerminalState>,
    pane_id: String,
) -> Result<Vec<TerminalActivitySubagent>, String> {
    let pane_id = pane_id.trim().to_string();
    validate_terminal_pane_id(&pane_id)?;

    let terminal_roots = developer_terminal_process_roots(terminal_state.inner()).await;
    let terminal_root = terminal_roots
        .iter()
        .find(|root| root.pane_id == pane_id)
        .cloned();
    let expected_instance_id = terminal_root
        .as_ref()
        .map(|root| root.instance_id)
        .unwrap_or(0);
    let expected_workspace_id = terminal_root
        .as_ref()
        .map(|root| root.workspace_id.as_str())
        .unwrap_or_default();
    let activity_events_path = terminal_activity_events_path(
        &pane_id,
        expected_instance_id,
        Some(expected_workspace_id),
    );

    let subagents = terminal_activity_subagents_from_events(
        &activity_events_path,
        terminal_root
            .as_ref()
            .map(|root| root.agent_kind.as_str())
            .unwrap_or_default(),
        &pane_id,
        expected_instance_id,
        expected_workspace_id,
    );
    Ok(subagents)
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

fn terminal_activity_value_string(value: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .unwrap_or_default()
        .trim()
        .to_string()
}

#[derive(Default)]
struct TerminalActivitySubagentBridge {
    agent_id: String,
    tool_use_id: String,
    correlation_id: String,
    status: String,
}

fn terminal_activity_subagent_bridge_merge(
    target: &mut TerminalActivitySubagentBridge,
    source: TerminalActivitySubagentBridge,
) {
    if target.agent_id.is_empty() && !source.agent_id.is_empty() {
        target.agent_id = source.agent_id;
    }
    if target.tool_use_id.is_empty() && !source.tool_use_id.is_empty() {
        target.tool_use_id = source.tool_use_id;
    }
    if target.correlation_id.is_empty() && !source.correlation_id.is_empty() {
        target.correlation_id = source.correlation_id;
    }
    if target.status.is_empty() && !source.status.is_empty() {
        target.status = source.status;
    }
}

fn terminal_activity_subagent_bridge_from_value(
    value: &Value,
    allow_generic_agent_id: bool,
    depth: usize,
) -> TerminalActivitySubagentBridge {
    if depth > 6 {
        return TerminalActivitySubagentBridge::default();
    }
    let mut bridge = TerminalActivitySubagentBridge::default();
    let Some(object) = value.as_object() else {
        if allow_generic_agent_id {
            bridge.agent_id = value.as_str().unwrap_or_default().trim().to_string();
        }
        return bridge;
    };

    bridge.agent_id = terminal_activity_value_string(
        value,
        &[
            "spawned_agent_id",
            "spawnedAgentId",
            "child_agent_id",
            "childAgentId",
            "subagent_id",
            "subagentId",
            "agent_id",
            "agentId",
        ],
    );
    if bridge.agent_id.is_empty() && allow_generic_agent_id {
        bridge.agent_id = terminal_activity_value_string(value, &["id"]);
    }
    bridge.tool_use_id = terminal_activity_value_string(
        value,
        &[
            "launch_tool_use_id",
            "launchToolUseId",
            "agent_tool_use_id",
            "agentToolUseId",
            "tool_use_id",
            "toolUseId",
            "toolUseID",
            "tool_call_id",
            "toolCallId",
            "call_id",
            "callId",
            "callID",
        ],
    );
    bridge.correlation_id = terminal_activity_value_string(
        value,
        &[
            "subagent_correlation_id",
            "subagentCorrelationId",
            "launch_correlation_id",
            "launchCorrelationId",
        ],
    );
    bridge.status = terminal_activity_value_string(
        value,
        &[
            "status",
            "state",
            "phase",
            "activity_status",
            "activityStatus",
            "command_phase",
            "commandPhase",
        ],
    );

    for key in [
        "agentId",
        "agent_id",
        "spawnedAgentId",
        "spawned_agent_id",
        "childAgentId",
        "child_agent_id",
        "subagent",
        "subagent_id",
        "agent",
        "child",
        "result",
        "data",
        "metadata",
    ] {
        if let Some(nested) = object.get(key) {
            terminal_activity_subagent_bridge_merge(
                &mut bridge,
                terminal_activity_subagent_bridge_from_value(
                    nested,
                    matches!(
                        key,
                        "agentId"
                            | "agent_id"
                            | "spawnedAgentId"
                            | "spawned_agent_id"
                            | "childAgentId"
                            | "child_agent_id"
                            | "subagent_id"
                    ),
                    depth + 1,
                ),
            );
        }
    }
    bridge
}

fn terminal_activity_subagent_bridge_from_event(event: &Value) -> TerminalActivitySubagentBridge {
    let mut bridge = TerminalActivitySubagentBridge {
        agent_id: terminal_activity_event_string(
            event,
            &[
                "spawned_agent_id",
                "spawnedAgentId",
                "child_agent_id",
                "childAgentId",
                "subagent_id",
                "subagentId",
            ],
        ),
        tool_use_id: terminal_activity_event_string(
            event,
            &[
                "launch_tool_use_id",
                "launchToolUseId",
                "agent_tool_use_id",
                "agentToolUseId",
            ],
        ),
        correlation_id: terminal_activity_event_string(
            event,
            &[
                "subagent_correlation_id",
                "subagentCorrelationId",
                "launch_correlation_id",
                "launchCorrelationId",
            ],
        ),
        status: terminal_activity_event_string(
            event,
            &[
                "spawned_agent_status",
                "spawnedAgentStatus",
                "subagent_status",
                "subagentStatus",
            ],
        ),
    };
    for key in [
        "tool_output",
        "toolOutput",
        "tool_response",
        "toolResponse",
        "output",
        "result",
        "response",
    ] {
        if let Some(value) = event.get(key) {
            terminal_activity_subagent_bridge_merge(
                &mut bridge,
                terminal_activity_subagent_bridge_from_value(value, false, 0),
            );
        }
    }
    bridge
}

fn terminal_activity_event_is_agent_tool(event: &Value) -> bool {
    event["tool_name"]
        .as_str()
        .is_some_and(|tool| matches!(terminal_activity_event_key(tool).as_str(), "agent" | "task"))
}

fn terminal_activity_event_key_is_subagent_lifecycle(event_key: &str) -> bool {
    matches!(event_key, "subagentstart" | "subagentstop")
}

fn terminal_activity_subagent_bridge_allowed(event_key: &str, event: &Value) -> bool {
    terminal_activity_event_key_is_subagent_lifecycle(event_key)
        || terminal_activity_event_is_agent_tool(event)
}

fn terminal_activity_subagent_event_is_pending(event: &Value) -> bool {
    let status = terminal_activity_event_key(&terminal_activity_event_string(
        event,
        &["permission_status", "approval_status", "status"],
    ));
    let decision = terminal_activity_event_key(&terminal_activity_event_string(
        event,
        &["permission_decision", "approval_decision", "decision"],
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
        &["manual_approval_required", "provider_blocked_for_user", "requires_user_input", "terminal_is_prompting_user", "prompting_user"],
    )
}

fn terminal_activity_subagent_event_status(event_key: &str, event: &Value) -> String {
    if terminal_activity_subagent_event_is_pending(event) {
        return "awaiting_instruction".to_string();
    }

    let bridge = if terminal_activity_subagent_bridge_allowed(event_key, event) {
        terminal_activity_subagent_bridge_from_event(event)
    } else {
        TerminalActivitySubagentBridge::default()
    };
    let statuses = [
        terminal_activity_event_string(event, &["status", "activity_status", "command_phase"]),
        bridge.status,
    ]
    .into_iter()
    .map(|status| terminal_activity_event_key(&status))
    .filter(|status| !status.is_empty())
    .collect::<Vec<_>>();
    if event_key == "posttoolusefailure"
        || statuses.iter().any(|status| {
            matches!(
                status.as_str(),
                "blocked" | "failed" | "failure" | "error" | "interrupted" | "stopped"
            )
        })
    {
        return "failed".to_string();
    }
    if statuses.iter().any(|status| {
        matches!(
            status.as_str(),
            "active" | "asynclaunched" | "asyncstarted" | "launched" | "running" | "started"
        )
    }) {
        return "running".to_string();
    }
    if statuses.iter().any(|status| {
        matches!(
            status.as_str(),
            "done" | "complete" | "completed" | "finished" | "success" | "toolcompleted"
        )
    }) {
        return "done".to_string();
    }

    if event_key == "subagentstop" || event_key == "posttooluse" {
        return "done".to_string();
    }
    "running".to_string()
}

struct TerminalActivitySubagentEntry {
    subagent: TerminalActivitySubagent,
    aliases: HashSet<String>,
    status_updated_at_ms: u64,
    label_quality: u8,
}

fn terminal_activity_subagent_identity_key(prefix: &str, value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| format!("{prefix}:{value}"))
}

fn terminal_activity_subagent_resolve_alias(
    aliases: &HashMap<String, String>,
    key: &str,
) -> String {
    aliases
        .get(key)
        .cloned()
        .unwrap_or_else(|| key.to_string())
}

fn terminal_activity_subagent_update_alias_targets(
    aliases: &mut HashMap<String, String>,
    from: &str,
    to: &str,
) {
    for target in aliases.values_mut() {
        if target == from {
            *target = to.to_string();
        }
    }
}

fn terminal_activity_subagent_status_merge_rank(status: &str) -> u8 {
    match status.trim().to_ascii_lowercase().as_str() {
        "failed" => 4,
        "done" | "completed" => 3,
        "awaiting_instruction" | "awaiting_input" | "awaiting_user" | "blocked" => 2,
        "running" | "active" => 1,
        _ => 0,
    }
}

fn terminal_activity_subagent_label_quality(agent_type: &str, description: &str) -> u8 {
    if !agent_type.trim().is_empty() {
        3
    } else if !description.trim().is_empty() {
        2
    } else {
        1
    }
}

fn terminal_activity_subagent_merge_entries(
    target: &mut TerminalActivitySubagentEntry,
    source: TerminalActivitySubagentEntry,
) {
    target.aliases.extend(source.aliases);
    if target.subagent.provider.trim().is_empty() && !source.subagent.provider.trim().is_empty() {
        target.subagent.provider = source.subagent.provider.clone();
    }
    if target.subagent.agent_id.trim().is_empty() && !source.subagent.agent_id.trim().is_empty() {
        target.subagent.agent_id = source.subagent.agent_id.clone();
    }
    if target.subagent.agent_type.trim().is_empty() && !source.subagent.agent_type.trim().is_empty() {
        target.subagent.agent_type = source.subagent.agent_type.clone();
    }
    if target.subagent.description.trim().is_empty() && !source.subagent.description.trim().is_empty()
    {
        target.subagent.description = source.subagent.description.clone();
    }
    if source.label_quality > target.label_quality
        || (source.label_quality == target.label_quality
            && source.subagent.updated_at_ms >= target.subagent.updated_at_ms)
    {
        target.subagent.label = source.subagent.label.clone();
        if !source.subagent.agent_type.trim().is_empty() {
            target.subagent.agent_type = source.subagent.agent_type.clone();
        }
        if !source.subagent.description.trim().is_empty() {
            target.subagent.description = source.subagent.description.clone();
        }
        target.label_quality = source.label_quality;
    }
    target.subagent.started_at_ms = match (
        target.subagent.started_at_ms,
        source.subagent.started_at_ms,
    ) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    };
    if source.status_updated_at_ms > target.status_updated_at_ms
        || (source.status_updated_at_ms == target.status_updated_at_ms
            && terminal_activity_subagent_status_merge_rank(&source.subagent.status)
                > terminal_activity_subagent_status_merge_rank(&target.subagent.status))
    {
        target.subagent.status = source.subagent.status.clone();
        target.status_updated_at_ms = source.status_updated_at_ms;
    }
    target.subagent.finished_at_ms = match (
        target.subagent.finished_at_ms,
        source.subagent.finished_at_ms,
    ) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    };
    target.subagent.updated_at_ms = target
        .subagent
        .updated_at_ms
        .max(source.subagent.updated_at_ms);
    if target.subagent.transcript_path.trim().is_empty()
        && !source.subagent.transcript_path.trim().is_empty()
    {
        target.subagent.transcript_path = source.subagent.transcript_path.clone();
    }
    if target.subagent.agent_transcript_path.trim().is_empty()
        && !source.subagent.agent_transcript_path.trim().is_empty()
    {
        target.subagent.agent_transcript_path = source.subagent.agent_transcript_path.clone();
    }
    if !source.subagent.last_message.trim().is_empty() {
        target.subagent.last_message = source.subagent.last_message.clone();
    }
    if target.subagent.confidence != "named" && source.subagent.confidence == "named" {
        target.subagent.confidence = source.subagent.confidence.clone();
    }
}

fn terminal_activity_subagent_merge_aliases(
    subagents: &mut HashMap<String, TerminalActivitySubagentEntry>,
    aliases: &mut HashMap<String, String>,
    preferred_key: &str,
    identity_keys: &[String],
) -> String {
    let target_key = if preferred_key.starts_with("agent:") {
        preferred_key.to_string()
    } else {
        terminal_activity_subagent_resolve_alias(aliases, preferred_key)
    };
    let mut keys = vec![preferred_key.to_string()];
    for key in identity_keys {
        if !keys.contains(key) {
            keys.push(key.clone());
        }
    }
    for key in &keys {
        let resolved = terminal_activity_subagent_resolve_alias(aliases, key);
        if resolved != target_key {
            if let Some(source) = subagents.remove(&resolved) {
                if let Some(target) = subagents.get_mut(&target_key) {
                    terminal_activity_subagent_merge_entries(target, source);
                } else {
                    subagents.insert(target_key.clone(), source);
                }
            }
            terminal_activity_subagent_update_alias_targets(aliases, &resolved, &target_key);
        }
        aliases.insert(key.clone(), target_key.clone());
    }
    if let Some(entry) = subagents.get_mut(&target_key) {
        entry.aliases.extend(keys);
        entry.subagent.id = target_key.clone();
    }
    target_key
}

fn terminal_activity_subagent_bounded_text(value: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= TERMINAL_ACTIVITY_SUBAGENT_LABEL_MAX_CHARS {
        normalized
    } else {
        normalized
            .chars()
            .take(TERMINAL_ACTIVITY_SUBAGENT_LABEL_MAX_CHARS)
            .collect()
    }
}

fn terminal_activity_subagents_from_events(
    activity_events_path: &Path,
    fallback_provider: &str,
    expected_pane_id: &str,
    expected_instance_id: u64,
    expected_workspace_id: &str,
) -> Vec<TerminalActivitySubagent> {
    let Ok(body) = fs::read_to_string(activity_events_path) else {
        return Vec::new();
    };
    let mut subagents = HashMap::<String, TerminalActivitySubagentEntry>::new();
    let mut aliases = HashMap::<String, String>::new();

    for line in body.lines().rev().take(500).collect::<Vec<_>>().into_iter().rev() {
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if !terminal_activity_event_matches_terminal(
            &event,
            expected_pane_id,
            expected_instance_id,
            expected_workspace_id,
        ) {
            continue;
        }
        let event_name = event["event_name"]
            .as_str()
            .or_else(|| event["hook_event_name"].as_str())
            .unwrap_or_default();
        let event_key = event_name.to_ascii_lowercase();
        let provider = event["provider"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(fallback_provider)
            .to_string();
        let timestamp_ms = event["timestamp_ms"]
            .as_u64()
            .unwrap_or_else(current_time_ms);
        let top_level_agent_id = event["agent_id"].as_str().unwrap_or_default().trim();
        let tool_use_id = event["tool_use_id"].as_str().unwrap_or_default().trim();
        let agent_type = event["agent_type"]
            .as_str()
            .or_else(|| event["subagent_type"].as_str())
            .unwrap_or_default()
            .trim();
        let description = event["description"].as_str().unwrap_or_default().trim();
        let is_agent_tool = terminal_activity_event_is_agent_tool(&event);
        let is_subagent_event = terminal_activity_event_key_is_subagent_lifecycle(&event_key);
        let bridge = if is_agent_tool || is_subagent_event {
            terminal_activity_subagent_bridge_from_event(&event)
        } else {
            TerminalActivitySubagentBridge::default()
        };
        let agent_id = if is_subagent_event {
            top_level_agent_id
        } else {
            bridge.agent_id.as_str()
        };
        let launch_tool_use_id = if bridge.tool_use_id.is_empty() {
            tool_use_id
        } else {
            bridge.tool_use_id.as_str()
        };
        let event_status = terminal_activity_subagent_event_status(&event_key, &event);
        let is_agent_prompt = event_status == "awaiting_instruction"
            && (!agent_id.is_empty()
                || !tool_use_id.is_empty()
                || !launch_tool_use_id.is_empty()
                || !bridge.correlation_id.is_empty()
                || !agent_type.is_empty());
        let has_subagent_bridge = !bridge.agent_id.is_empty()
            || !bridge.tool_use_id.is_empty()
            || !bridge.correlation_id.is_empty();
        if !is_subagent_event && !is_agent_tool && !is_agent_prompt && !has_subagent_bridge {
            continue;
        }
        let mut identity_keys = Vec::new();
        if let Some(key) = terminal_activity_subagent_identity_key("agent", agent_id) {
            identity_keys.push(key);
        }
        if let Some(key) = terminal_activity_subagent_identity_key("tool", tool_use_id) {
            identity_keys.push(key);
        }
        if let Some(key) = terminal_activity_subagent_identity_key("tool", launch_tool_use_id) {
            if !identity_keys.contains(&key) {
                identity_keys.push(key);
            }
        }
        if let Some(key) = terminal_activity_subagent_identity_key("launch", &bridge.correlation_id) {
            identity_keys.push(key);
        }
        let preferred_key = if let Some(key) = terminal_activity_subagent_identity_key("agent", agent_id)
        {
            key
        } else if let Some(key) =
            terminal_activity_subagent_identity_key("launch", &bridge.correlation_id)
        {
            terminal_activity_subagent_resolve_alias(&aliases, &key)
        } else if let Some(key) =
            terminal_activity_subagent_identity_key("tool", launch_tool_use_id)
        {
            terminal_activity_subagent_resolve_alias(&aliases, &key)
        } else if let Some(key) = terminal_activity_subagent_identity_key("tool", tool_use_id) {
            terminal_activity_subagent_resolve_alias(&aliases, &key)
        } else {
            continue;
        };
        let key = terminal_activity_subagent_merge_aliases(
            &mut subagents,
            &mut aliases,
            &preferred_key,
            &identity_keys,
        );
        let last_message = terminal_activity_event_string(
            &event,
            &["prompting_user_text", "last_message", "message"],
        );
        let mut event_aliases = HashSet::new();
        event_aliases.extend(identity_keys);
        let bounded_agent_type = terminal_activity_subagent_bounded_text(agent_type);
        let label = terminal_activity_subagent_label(&bounded_agent_type, description);
        let event_entry = TerminalActivitySubagentEntry {
            subagent: TerminalActivitySubagent {
                id: key.clone(),
                provider: provider.clone(),
                agent_id: agent_id.to_string(),
                agent_type: bounded_agent_type.clone(),
                label,
                description: description.to_string(),
                status: event_status.clone(),
                started_at_ms: Some(timestamp_ms),
                finished_at_ms: matches!(event_status.as_str(), "done" | "failed")
                    .then_some(timestamp_ms),
                updated_at_ms: timestamp_ms,
                transcript_path: event["transcript_path"].as_str().unwrap_or_default().to_string(),
                agent_transcript_path: event["agent_transcript_path"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                last_message,
                source: "provider-hook".to_string(),
                confidence: if is_subagent_event { "named" } else { "inferred" }.to_string(),
            },
            aliases: event_aliases,
            status_updated_at_ms: timestamp_ms,
            label_quality: terminal_activity_subagent_label_quality(&bounded_agent_type, description),
        };
        if let Some(entry) = subagents.get_mut(&key) {
            terminal_activity_subagent_merge_entries(entry, event_entry);
        } else {
            subagents.insert(key.clone(), event_entry);
        }
        terminal_activity_subagent_merge_aliases(
            &mut subagents,
            &mut aliases,
            &key,
            &[key.clone()],
        );
    }

    let now_ms = current_time_ms();
    let mut values = subagents
        .into_values()
        .filter(|entry| {
            let unresolved_tool_only = entry.subagent.agent_id.trim().is_empty()
                && !entry.aliases.iter().any(|alias| alias.starts_with("agent:"))
                && matches!(entry.subagent.status.as_str(), "running" | "active");
            !(unresolved_tool_only
                && now_ms.saturating_sub(entry.subagent.updated_at_ms)
                    > TERMINAL_ACTIVITY_SUBAGENT_TOOL_TTL_MS)
        })
        .map(|entry| entry.subagent)
        .collect::<Vec<_>>();
    values.sort_by(|left, right| {
        terminal_activity_subagent_status_rank(&right.status)
            .cmp(&terminal_activity_subagent_status_rank(&left.status))
            .then_with(|| right.updated_at_ms.cmp(&left.updated_at_ms))
            .then_with(|| left.label.cmp(&right.label))
    });
    values
}

fn terminal_activity_event_matches_terminal(
    event: &Value,
    expected_pane_id: &str,
    expected_instance_id: u64,
    expected_workspace_id: &str,
) -> bool {
    if let Some(value) = event.get("pane_id") {
        if value.as_str() != Some(expected_pane_id) {
            return false;
        }
    }
    if let Some(value) = event.get("instance_id") {
        let instance_id = value
            .as_u64()
            .or_else(|| value.as_str().and_then(|value| value.parse::<u64>().ok()));
        if instance_id != Some(expected_instance_id) {
            return false;
        }
    }
    if let Some(value) = event.get("workspace_id") {
        if value.as_str() != Some(expected_workspace_id) {
            return false;
        }
    }
    true
}

fn terminal_activity_subagent_label(agent_type: &str, description: &str) -> String {
    let agent_type = agent_type.trim();
    if !agent_type.is_empty() {
        return terminal_activity_subagent_bounded_text(agent_type);
    }
    let description = description.trim();
    if !description.is_empty() {
        let label = description
            .split_whitespace()
            .take(6)
            .collect::<Vec<_>>()
            .join(" ");
        return terminal_activity_subagent_bounded_text(&label);
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

#[tauri::command(rename_all = "snake_case")]
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
        developer_process_refresh_kind(true),
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
            developer_process_refresh_kind(true),
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
            developer_process_refresh_kind(true),
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
        "created_at": line["CreatedAt"].as_str().unwrap_or_default(),
        "running_for": line["RunningFor"].as_str().unwrap_or_default(),
        "networks": line["Networks"].as_str().unwrap_or_default(),
        "compose_project": docker_ps_labels_value(labels, "com.docker.compose.project"),
        "compose_service": docker_ps_labels_value(labels, "com.docker.compose.service"),
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
        "container_ref": container_ref,
        "exit_code": result.exit_code,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "duration_ms": result.duration_ms,
        "message": message,
    }))
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

fn developer_process_refresh_kind(include_metadata: bool) -> ProcessRefreshKind {
    let kind = ProcessRefreshKind::nothing().with_cpu().with_memory();
    if include_metadata {
        kind.with_cmd(UpdateKind::OnlyIfNotSet)
            .with_exe(UpdateKind::OnlyIfNotSet)
            .with_cwd(UpdateKind::OnlyIfNotSet)
            .without_tasks()
    } else {
        kind.without_tasks()
    }
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
        self.add_internal_app_core_breakdown(signals, true);
        self.into_snapshot()
    }

    fn into_snapshot(self) -> DeveloperEnergySnapshot {
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
                    share_percent: 0.0,
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
        for group in groups.iter_mut() {
            group.share_percent = if total_score > 0.0 {
                developer_round_energy((group.score / total_score) * 100.0)
            } else {
                0.0
            };
        }
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

    fn add_internal_app_core_breakdown(
        &mut self,
        signals: DeveloperEnergyInternalSignals,
        include_activity_monitor: bool,
    ) {
        let Some(core) = self.app_core.clone() else {
            return;
        };

        let has_terminals = signals.terminal_root_count > 0;
        let has_workspaces = signals.workspace_root_count > 0;
        let has_docker = signals.docker_process_count > 0;
        let active_processes = signals.visible_process_count > 0;
        let mut weights = vec![
            ("terminalBackend", if has_terminals { 0.15 } else { 0.03 }),
            (
                "dockerBridge",
                if has_docker { 0.07 } else { 0.02 },
            ),
            ("appLifecycle", 0.08),
            ("audioNative", 0.02),
            ("snippingNative", 0.02),
        ];
        if has_workspaces {
            weights.push(("workspaceFiles", 0.10));
        }
        if include_activity_monitor {
            weights.push((
                "activityMonitor",
                if active_processes { 0.42 } else { 0.28 },
            ));
        }
        weights.extend(developer_energy_coordination_cloud_weights(
            signals.cloud,
            has_terminals,
            has_workspaces,
            signals.coordination_activity_count,
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
    coordination_activity_count: usize,
) -> Vec<(&'static str, f64)> {
    const COORDINATION_CLOUD_BUDGET: f64 = 0.14;

    let outbox_depth =
        cloud.outbox_pending_count + cloud.outbox_retrying_count + cloud.outbox_dead_letter_count;
    let mut relative = Vec::new();
    if coordination_activity_count > 0 {
        relative.push((
            "coordinationKernel",
            0.18 + (coordination_activity_count.min(12) as f64 / 12.0) * 0.12,
        ));
    }
    if cloud.global_ws_connected || cloud.global_ws_retrying {
        relative.push((
            "cloudWebSocket",
            if cloud.global_ws_connected { 0.20 } else { 0.24 },
        ));
    }
    if outbox_depth > 0 {
        relative.push((
            "sqliteOutbox",
            0.22 + (outbox_depth.min(24) as f64 / 24.0) * 0.08,
        ));
    }
    if has_terminals || cloud.terminal_context_count > 0 {
        relative.push(("mcpBridge", 0.16));
    }
    if has_workspaces || cloud.registered_workspace_count > 0 {
        relative.push(("deviceLiveState", 0.15));
    }
    relative.extend([
        ("tokenomicsSync", 0.08),
        ("cloudBackgroundWatchers", 0.10),
    ]);
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

fn developer_energy_coordination_activity_count(workspace_roots: &[String]) -> usize {
    let mut seen = HashSet::new();
    workspace_roots
        .iter()
        .flat_map(|root| developer_energy_coordination_db_paths(root))
        .filter(|path| seen.insert(process_path_display(path)))
        .map(|path| developer_energy_coordination_db_activity_count(&path))
        .sum()
}

fn developer_energy_coordination_db_paths(root: &str) -> Vec<PathBuf> {
    let root = PathBuf::from(root);
    vec![
        root.join(".agents").join("kernel.sqlite"),
        root.join(".agents").join("coordination.db"),
        root.join(".agents").join("kernel.sqlite"),
    ]
}

fn developer_energy_coordination_db_activity_count(path: &Path) -> usize {
    if !path.exists() {
        return 0;
    }
    let Ok(conn) = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) else {
        return 0;
    };

    [
        (
            "agent_sessions",
            "status IN ('active', 'running')",
        ),
        (
            "tasks",
            "status IN ('ready', 'claimed', 'blocked')",
        ),
        ("leases", "status='lease_granted'"),
        (
            "task_resource_intents",
            "status IN ('lease_granted', 'parked', 'parked_cycle_prevented', 'resume_ready', 'resume_requested')",
        ),
        ("submit_jobs", "status IN ('queued', 'running')"),
        ("patches", "status='submitted'"),
        ("file_watchers", "status NOT IN ('disabled', 'stopped')"),
    ]
        .iter()
        .map(|(table, predicate)| {
            developer_energy_coordination_table_count(&conn, table, predicate)
        })
        .sum()
}

fn developer_energy_coordination_table_count(
    conn: &rusqlite::Connection,
    table: &str,
    predicate: &str,
) -> usize {
    let table_exists = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;
    if !table_exists {
        return 0;
    }
    let sql = format!("SELECT COUNT(*) FROM {table} WHERE {predicate}");
    conn.query_row(&sql, [], |row| row.get::<_, i64>(0))
        .unwrap_or(0)
        .max(0) as usize
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
        assert_eq!(container["compose_project"], "shop");
        assert_eq!(container["compose_service"], "web");
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
                "timestamp_ms": 1000,
                "event_name": "PreToolUse",
                "provider": "claude",
                "tool_name": "Task",
                "tool_use_id": "tool-1",
                "agent_type": "Halley",
                "description": "Check the database",
            })
            .to_string(),
            json!({
                "timestamp_ms": 1100,
                "event_name": "PermissionPrompt",
                "provider": "claude",
                "tool_use_id": "tool-1",
                "agent_type": "Halley",
                "requires_user_input": true,
                "prompting_user_text": "Approve database inspection",
            })
            .to_string(),
        ]
        .join("\n");
        fs::write(&path, body).unwrap();

        let subagents =
            terminal_activity_subagents_from_events(&path, "claude", "pane-1", 7, "workspace-a");
        let _ = fs::remove_file(&path);

        assert_eq!(subagents.len(), 1);
        assert_eq!(subagents[0].label, "Halley");
        assert_eq!(subagents[0].status, "awaiting_instruction");
        assert_eq!(subagents[0].last_message, "Approve database inspection");
    }

    #[test]
    fn terminal_activity_subagents_drop_mismatched_terminal_events() {
        let path = std::env::temp_dir().join(format!(
            "diffforge-subagent-scope-{}.jsonl",
            uuid::Uuid::new_v4(),
        ));
        let event = |agent_id: &str, pane_id: Option<&str>, instance_id: Option<u64>, workspace_id: Option<&str>| {
            let mut event = json!({
                "timestamp_ms": 1000,
                "event_name": "SubagentStart",
                "provider": "claude",
                "agent_id": agent_id,
                "agent_type": agent_id,
            });
            if let Some(pane_id) = pane_id {
                event["pane_id"] = json!(pane_id);
            }
            if let Some(instance_id) = instance_id {
                event["instance_id"] = json!(instance_id);
            }
            if let Some(workspace_id) = workspace_id {
                event["workspace_id"] = json!(workspace_id);
            }
            event.to_string()
        };
        let body = [
            event("matching", Some("pane-1"), Some(7), Some("workspace-a")),
            event("wrong-pane", Some("pane-2"), Some(7), Some("workspace-a")),
            event("wrong-instance", Some("pane-1"), Some(8), Some("workspace-a")),
            event("wrong-workspace", Some("pane-1"), Some(7), Some("workspace-b")),
            event("legacy-unstamped", None, None, None),
        ]
        .join("\n");
        fs::write(&path, body).unwrap();

        let subagents =
            terminal_activity_subagents_from_events(&path, "claude", "pane-1", 7, "workspace-a");
        let _ = fs::remove_file(&path);
        let agent_ids = subagents
            .iter()
            .map(|subagent| subagent.agent_id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(agent_ids.len(), 2);
        assert!(agent_ids.contains(&"matching"));
        assert!(agent_ids.contains(&"legacy-unstamped"));
    }

    #[test]
    fn terminal_activity_subagents_are_isolated_between_workspace_files() {
        let suffix = uuid::Uuid::new_v4();
        let workspace_a = format!("workspace-a-{suffix}");
        let workspace_b = format!("workspace-b-{suffix}");
        let path_a = terminal_activity_events_path("pane-1", 7, Some(&workspace_a));
        let path_b = terminal_activity_events_path("pane-1", 7, Some(&workspace_b));
        fs::create_dir_all(path_a.parent().unwrap()).unwrap();
        let event = |agent_id: &str, workspace_id: &str| {
            json!({
                "timestamp_ms": 1000,
                "event_name": "SubagentStart",
                "provider": "claude",
                "pane_id": "pane-1",
                "instance_id": 7,
                "workspace_id": workspace_id,
                "agent_id": agent_id,
                "agent_type": agent_id,
                "_diffforge_transport_delivered": true,
            })
            .to_string()
        };
        fs::write(&path_a, event("agent-a", &workspace_a)).unwrap();
        fs::write(&path_b, event("agent-b", &workspace_b)).unwrap();

        let subagents_a =
            terminal_activity_subagents_from_events(&path_a, "claude", "pane-1", 7, &workspace_a);
        let subagents_b =
            terminal_activity_subagents_from_events(&path_b, "claude", "pane-1", 7, &workspace_b);
        let _ = fs::remove_file(&path_a);
        let _ = fs::remove_file(&path_b);

        assert_ne!(path_a, path_b);
        assert_eq!(subagents_a.len(), 1);
        assert_eq!(subagents_a[0].agent_id, "agent-a");
        assert_eq!(subagents_b.len(), 1);
        assert_eq!(subagents_b[0].agent_id, "agent-b");
    }

    #[test]
    fn terminal_activity_subagents_are_empty_without_subagent_events() {
        let path = std::env::temp_dir().join(format!(
            "diffforge-subagent-empty-{}.jsonl",
            uuid::Uuid::new_v4(),
        ));
        fs::write(
            &path,
            json!({
                "timestamp_ms": 1000,
                "event_name": "SessionStart",
                "pane_id": "pane-1",
                "instance_id": 7,
                "workspace_id": "workspace-a",
            })
            .to_string(),
        )
        .unwrap();

        let subagents =
            terminal_activity_subagents_from_events(&path, "claude", "pane-1", 7, "workspace-a");
        let _ = fs::remove_file(&path);

        assert!(subagents.is_empty());
    }

    fn subagent_activity_test_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "diffforge-{name}-{}.jsonl",
            uuid::Uuid::new_v4()
        ))
    }

    fn extract_test_subagents(path: &Path) -> Vec<TerminalActivitySubagent> {
        terminal_activity_subagents_from_events(path, "claude", "pane-1", 7, "workspace-a")
    }

    fn write_subagent_events(path: &Path, events: Vec<Value>) {
        fs::write(
            path,
            events
                .into_iter()
                .map(|event| event.to_string())
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
    }

    fn scoped_event(mut event: Value) -> Value {
        event["provider"] = json!("claude");
        event["pane_id"] = json!("pane-1");
        event["instance_id"] = json!(7);
        event["workspace_id"] = json!("workspace-a");
        event
    }

    #[test]
    fn terminal_activity_subagent_alias_merge_collapses_doubling_scenario() {
        let path = subagent_activity_test_path("subagent-doubling");
        let without_stop = vec![
            scoped_event(json!({
                "timestamp_ms": 1000,
                "event_name": "PreToolUse",
                "tool_name": "Agent",
                "tool_use_id": "tool-1",
                "agent_type": "Researcher",
                "description": "Inspect the failing test"
            })),
            scoped_event(json!({
                "timestamp_ms": 1100,
                "event_name": "SubagentStart",
                "agent_id": "agent-1",
                "agent_type": "Researcher",
                "agent_transcript_path": "/tmp/agent-1.jsonl"
            })),
            scoped_event(json!({
                "timestamp_ms": 1200,
                "event_name": "PostToolUse",
                "tool_name": "Agent",
                "tool_use_id": "tool-1",
                "spawned_agent_id": "agent-1",
                "launch_tool_use_id": "tool-1",
                "status": "async_launched"
            })),
        ];
        write_subagent_events(&path, without_stop);
        let running = extract_test_subagents(&path);
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].id, "agent:agent-1");
        assert_eq!(running[0].agent_id, "agent-1");
        assert_eq!(running[0].status, "running");

        write_subagent_events(
            &path,
            vec![
                scoped_event(json!({
                    "timestamp_ms": 1000,
                    "event_name": "PreToolUse",
                    "tool_name": "Agent",
                    "tool_use_id": "tool-1",
                    "agent_type": "Researcher",
                    "description": "Inspect the failing test"
                })),
                scoped_event(json!({
                    "timestamp_ms": 1100,
                    "event_name": "SubagentStart",
                    "agent_id": "agent-1",
                    "agent_type": "Researcher"
                })),
                scoped_event(json!({
                    "timestamp_ms": 1200,
                    "event_name": "PostToolUse",
                    "tool_name": "Agent",
                    "tool_use_id": "tool-1",
                    "spawned_agent_id": "agent-1",
                    "launch_tool_use_id": "tool-1",
                    "status": "async_launched"
                })),
                scoped_event(json!({
                    "timestamp_ms": 1300,
                    "event_name": "SubagentStop",
                    "agent_id": "agent-1",
                    "agent_type": "Researcher"
                })),
            ],
        );
        let done = extract_test_subagents(&path);
        let _ = fs::remove_file(&path);
        assert_eq!(done.len(), 1);
        assert_eq!(done[0].id, "agent:agent-1");
        assert_eq!(done[0].status, "done");
        assert_eq!(done[0].started_at_ms, Some(1000));
        assert_eq!(done[0].finished_at_ms, Some(1300));
    }

    #[test]
    fn terminal_activity_subagent_alias_merge_is_order_independent() {
        let path = subagent_activity_test_path("subagent-order");
        write_subagent_events(
            &path,
            vec![
                scoped_event(json!({
                    "timestamp_ms": 1000,
                    "event_name": "SubagentStart",
                    "agent_id": "agent-first",
                    "agent_type": "Planner"
                })),
                scoped_event(json!({
                    "timestamp_ms": 1100,
                    "event_name": "PreToolUse",
                    "tool_name": "Agent",
                    "tool_use_id": "tool-first",
                    "agent_type": "Planner"
                })),
                scoped_event(json!({
                    "timestamp_ms": 1200,
                    "event_name": "PostToolUse",
                    "tool_name": "Agent",
                    "tool_use_id": "tool-first",
                    "tool_output": {
                        "agentId": {
                            "agent_id": "agent-first",
                            "tool_use_id": "tool-first"
                        },
                        "status": "async_launched"
                    }
                })),
            ],
        );
        let subagents = extract_test_subagents(&path);
        let _ = fs::remove_file(&path);
        assert_eq!(subagents.len(), 1);
        assert_eq!(subagents[0].id, "agent:agent-first");
        assert_eq!(subagents[0].status, "running");
    }

    #[test]
    fn terminal_activity_subagent_old_files_merge_from_nested_bridge() {
        let path = subagent_activity_test_path("subagent-old-bridge");
        write_subagent_events(
            &path,
            vec![
                scoped_event(json!({
                    "timestamp_ms": 1000,
                    "event_name": "PreToolUse",
                    "tool_name": "Agent",
                    "tool_use_id": "legacy-tool",
                    "agent_type": "Legacy"
                })),
                scoped_event(json!({
                    "timestamp_ms": 1100,
                    "event_name": "SubagentStart",
                    "agent_id": "legacy-agent",
                    "agent_type": "Legacy"
                })),
                scoped_event(json!({
                    "timestamp_ms": 1200,
                    "event_name": "PostToolUse",
                    "tool_name": "Agent",
                    "tool_use_id": "legacy-tool",
                    "tool_output": {
                        "agentId": {
                            "agent_id": "legacy-agent",
                            "tool_use_id": "legacy-tool"
                        },
                        "status": "async_launched"
                    }
                })),
            ],
        );
        let subagents = extract_test_subagents(&path);
        let _ = fs::remove_file(&path);
        assert_eq!(subagents.len(), 1);
        assert_eq!(subagents[0].id, "agent:legacy-agent");
    }

    #[test]
    fn terminal_activity_subagent_async_launched_stays_running() {
        let path = subagent_activity_test_path("subagent-async");
        write_subagent_events(
            &path,
            vec![scoped_event(json!({
                "timestamp_ms": current_time_ms(),
                "event_name": "PostToolUse",
                "tool_name": "Agent",
                "tool_use_id": "async-tool",
                "tool_output": {
                    "agentId": {
                        "agent_id": "async-agent",
                        "tool_use_id": "async-tool"
                    },
                    "status": "async_launched"
                }
            }))],
        );
        let subagents = extract_test_subagents(&path);
        let _ = fs::remove_file(&path);
        assert_eq!(subagents.len(), 1);
        assert_eq!(subagents[0].status, "running");
    }

    #[test]
    fn terminal_activity_subagent_nested_failure_resolves_failed() {
        let path = subagent_activity_test_path("subagent-failure");
        write_subagent_events(
            &path,
            vec![
                scoped_event(json!({
                    "timestamp_ms": 1000,
                    "event_name": "PreToolUse",
                    "tool_name": "Agent",
                    "tool_use_id": "fail-tool",
                    "agent_type": "Debugger"
                })),
                scoped_event(json!({
                    "timestamp_ms": 1100,
                    "event_name": "PostToolUseFailure",
                    "tool_name": "Agent",
                    "tool_use_id": "fail-tool",
                    "tool_output": {
                        "agentId": {
                            "agent_id": "fail-agent",
                            "tool_use_id": "fail-tool"
                        },
                        "status": "failed"
                    }
                })),
            ],
        );
        let subagents = extract_test_subagents(&path);
        let _ = fs::remove_file(&path);
        assert_eq!(subagents.len(), 1);
        assert_eq!(subagents[0].id, "agent:fail-agent");
        assert_eq!(subagents[0].status, "failed");
    }

    #[test]
    fn terminal_activity_subagent_expires_unbridged_tool_rows() {
        let path = subagent_activity_test_path("subagent-ttl");
        write_subagent_events(
            &path,
            vec![scoped_event(json!({
                "timestamp_ms": current_time_ms() - TERMINAL_ACTIVITY_SUBAGENT_TOOL_TTL_MS - 1,
                "event_name": "PreToolUse",
                "tool_name": "Agent",
                "tool_use_id": "stale-tool",
                "agent_type": "Stale"
            }))],
        );
        let subagents = extract_test_subagents(&path);
        let _ = fs::remove_file(&path);
        assert!(subagents.is_empty());
    }

    #[test]
    fn terminal_activity_subagent_label_has_character_cap() {
        let path = subagent_activity_test_path("subagent-label");
        write_subagent_events(
            &path,
            vec![scoped_event(json!({
                "timestamp_ms": 1000,
                "event_name": "SubagentStart",
                "agent_id": "label-agent",
                "agent_type": format!("{}{}", "Verifier ".repeat(20), "tail")
            }))],
        );
        let subagents = extract_test_subagents(&path);
        let _ = fs::remove_file(&path);
        assert_eq!(subagents.len(), 1);
        assert!(subagents[0].label.chars().count() <= TERMINAL_ACTIVITY_SUBAGENT_LABEL_MAX_CHARS);
        assert!(subagents[0].agent_type.chars().count() <= TERMINAL_ACTIVITY_SUBAGENT_LABEL_MAX_CHARS);
    }

    #[test]
    fn terminal_activity_subagent_identical_agent_launches_stay_distinct_by_correlation() {
        let path = subagent_activity_test_path("subagent-identical-correlations");
        write_subagent_events(
            &path,
            vec![
                scoped_event(json!({
                    "timestamp_ms": 1000,
                    "event_name": "PreToolUse",
                    "tool_name": "Agent",
                    "tool_use_id": "",
                    "subagent_correlation_id": "launch-one",
                    "description": "Run the same delegated check"
                })),
                scoped_event(json!({
                    "timestamp_ms": 1001,
                    "event_name": "PreToolUse",
                    "tool_name": "Agent",
                    "tool_use_id": "",
                    "subagent_correlation_id": "launch-two",
                    "description": "Run the same delegated check"
                })),
                scoped_event(json!({
                    "timestamp_ms": 1010,
                    "event_name": "PostToolUse",
                    "tool_name": "Agent",
                    "tool_use_id": "",
                    "subagent_correlation_id": "launch-two",
                    "tool_output": {
                        "agentId": {
                            "agent_id": "child-agent-two"
                        },
                        "status": "async_launched"
                    }
                })),
                scoped_event(json!({
                    "timestamp_ms": 1011,
                    "event_name": "PostToolUse",
                    "tool_name": "Agent",
                    "tool_use_id": "",
                    "subagent_correlation_id": "launch-one",
                    "tool_output": {
                        "agentId": {
                            "agent_id": "child-agent-one"
                        },
                        "status": "async_launched"
                    }
                })),
            ],
        );
        let subagents = extract_test_subagents(&path);
        let _ = fs::remove_file(&path);
        let ids = subagents
            .iter()
            .map(|subagent| subagent.id.as_str())
            .collect::<HashSet<_>>();
        assert_eq!(subagents.len(), 2);
        assert!(ids.contains("agent:child-agent-one"));
        assert!(ids.contains("agent:child-agent-two"));
    }

    #[test]
    fn terminal_activity_subagent_marathon_shape_produces_one_row_per_agent() {
        let path = subagent_activity_test_path("subagent-marathon");
        let mut events = Vec::new();
        for index in 0..22 {
            let tool_use_id = format!("tool-{index}");
            let agent_id = format!("agent-{index}");
            events.push(scoped_event(json!({
                "timestamp_ms": 1000 + index * 10,
                "event_name": "PreToolUse",
                "tool_name": "Agent",
                "tool_use_id": tool_use_id,
                "agent_type": "Worker"
            })));
            events.push(scoped_event(json!({
                "timestamp_ms": 1001 + index * 10,
                "event_name": "PostToolUse",
                "tool_name": "Agent",
                "tool_use_id": tool_use_id,
                "tool_output": {
                    "agentId": {
                        "agent_id": agent_id,
                        "tool_use_id": tool_use_id
                    },
                    "status": "async_launched"
                }
            })));
            events.push(scoped_event(json!({
                "timestamp_ms": 1002 + index * 10,
                "event_name": "SubagentStop",
                "agent_id": agent_id,
                "tool_use_id": "",
                "agent_type": "Worker"
            })));
        }
        events.push(scoped_event(json!({
            "timestamp_ms": 2000,
            "event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_use_id": "bash-tool",
            "tool_input": { "command": "echo untouched" }
        })));
        events.push(scoped_event(json!({
            "timestamp_ms": 2001,
            "event_name": "PostToolUse",
            "tool_name": "Bash",
            "tool_use_id": "bash-tool",
            "tool_output": { "stdout": "untouched" }
        })));
        write_subagent_events(&path, events);
        let subagents = extract_test_subagents(&path);
        let _ = fs::remove_file(&path);
        assert_eq!(subagents.len(), 22);
        for index in 0..22 {
            let agent_id = format!("agent-{index}");
            let row = subagents
                .iter()
                .find(|subagent| subagent.agent_id == agent_id)
                .expect("subagent row exists");
            assert_eq!(row.id, format!("agent:{agent_id}"));
            assert_eq!(row.status, "done");
        }
        assert!(!subagents
            .iter()
            .any(|subagent| subagent.id.contains("bash-tool")));
    }

    #[test]
    fn terminal_activity_subagent_ignores_bridge_shaped_json_from_non_agent_tool() {
        let path = subagent_activity_test_path("subagent-non-agent-bridge");
        write_subagent_events(
            &path,
            vec![scoped_event(json!({
                "timestamp_ms": 1000,
                "event_name": "PostToolUse",
                "tool_name": "Bash",
                "tool_use_id": "bash-tool-json",
                "tool_output": {
                    "agentId": {
                        "agent_id": "fake-child-agent",
                        "tool_use_id": "bash-tool-json"
                    },
                    "child": {
                        "agent_id": "fake-nested-agent"
                    },
                    "status": "async_launched",
                    "stdout": "{\"agentId\":\"fake-child-agent\"}"
                }
            }))],
        );
        let subagents = extract_test_subagents(&path);
        let _ = fs::remove_file(&path);
        assert!(subagents.is_empty());
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

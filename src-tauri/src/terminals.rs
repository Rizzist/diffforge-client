fn terminal_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

#[cfg(windows)]
fn terminal_windows_build_number() -> Option<u32> {
    use windows_sys::Wdk::System::SystemServices::RtlGetVersion;
    use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;

    let mut info = OSVERSIONINFOW {
        dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32,
        ..Default::default()
    };
    let status = unsafe { RtlGetVersion(&mut info) };

    if status >= 0 && info.dwBuildNumber > 0 {
        Some(info.dwBuildNumber)
    } else {
        None
    }
}

#[cfg(not(windows))]
fn terminal_windows_build_number() -> Option<u32> {
    None
}

#[tauri::command]
async fn terminal_windows_pty_info() -> Result<Value, String> {
    Ok(json!({
        "backend": if cfg!(windows) { "conpty" } else { "native" },
        "buildNumber": terminal_windows_build_number(),
        "term": TERMINAL_EMULATION_TERM,
        "termProgram": TERMINAL_EMULATION_PROGRAM,
    }))
}

fn clean_terminal_telemetry_text(value: &str) -> String {
    value
        .replace(|character: char| character.is_control(), " ")
        .trim()
        .chars()
        .take(TERMINAL_TELEMETRY_MAX_TEXT)
        .collect()
}

fn validate_terminal_size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(TERMINAL_MIN_COLS..=TERMINAL_MAX_COLS).contains(&cols) {
        return Err(format!(
            "Terminal columns must be between {TERMINAL_MIN_COLS} and {TERMINAL_MAX_COLS}."
        ));
    }

    if !(TERMINAL_MIN_ROWS..=TERMINAL_MAX_ROWS).contains(&rows) {
        return Err(format!(
            "Terminal rows must be between {TERMINAL_MIN_ROWS} and {TERMINAL_MAX_ROWS}."
        ));
    }

    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn terminal_size_from_request(cols: Option<u16>, rows: Option<u16>) -> Result<PtySize, String> {
    validate_terminal_size(
        cols.unwrap_or(TERMINAL_DEFAULT_COLS),
        rows.unwrap_or(TERMINAL_DEFAULT_ROWS),
    )
}

fn terminal_launch_provider(kind: &str, provider: Option<&str>) -> Result<AgentProvider, String> {
    Ok(match kind {
        "console" => provider
            .map(parse_agent_provider)
            .transpose()?
            .unwrap_or(AgentProvider::Codex),
        "codex" => AgentProvider::Codex,
        "claude" => AgentProvider::Claude,
        "opencode" => AgentProvider::OpenCode,
        _ => {
            if let Some(provider) = provider {
                parse_agent_provider(provider)?
            } else {
                return Err("Terminal kind is invalid.".to_string());
            }
        }
    })
}

fn terminal_launch(
    kind: &str,
    provider: Option<String>,
    model: Option<String>,
    provider_session_id: Option<String>,
) -> Result<(Vec<String>, Vec<String>, String), String> {
    let provider = terminal_launch_provider(kind, provider.as_deref())?;
    let definition = agent_definition(provider);
    let mut args = Vec::new();
    if let Some(session_id) = provider_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        match provider {
            AgentProvider::Codex => {
                args.push("resume".to_string());
                args.push(session_id.to_string());
            }
            AgentProvider::Claude => {
                args.push("--resume".to_string());
                args.push(session_id.to_string());
            }
            AgentProvider::OpenCode => {
                args.push("--session".to_string());
                args.push(session_id.to_string());
            }
        }
    }

    if let Some(model) = normalize_forge_model(model)? {
        args.push("--model".to_string());
        args.push(model);
    }

    Ok((
        agent_command_candidates(definition),
        args,
        definition.label.to_string(),
    ))
}

async fn remove_terminal_instance_if_current(
    terminals: &Arc<RwLock<HashMap<String, TerminalInstance>>>,
    pane_id: &str,
    instance_id: u64,
) -> Option<TerminalInstance> {
    let mut terminals = terminals.write().await;
    let is_current = terminals
        .get(pane_id)
        .map(|instance| instance.id == instance_id)
        .unwrap_or(false);

    if is_current {
        terminals.remove(pane_id)
    } else {
        None
    }
}

async fn get_terminal_instance(
    state: &TerminalState,
    pane_id: &str,
) -> Result<TerminalInstance, String> {
    let terminals = state.terminals.read().await;

    terminals
        .get(pane_id)
        .cloned()
        .ok_or_else(|| "Terminal session is not running.".to_string())
}

async fn get_terminal_instance_if_current(
    state: &TerminalState,
    pane_id: &str,
    instance_id: Option<u64>,
) -> Result<Option<TerminalInstance>, String> {
    let terminals = state.terminals.read().await;
    let Some(instance) = terminals.get(pane_id).cloned() else {
        return if instance_id.is_some() {
            Ok(None)
        } else {
            Err("Terminal session is not running.".to_string())
        };
    };

    if instance_id.is_some_and(|expected_id| expected_id != instance.id) {
        return Ok(None);
    }

    Ok(Some(instance))
}

fn terminal_audio_input_target_matches(
    target: &TerminalAudioInputTarget,
    pane_id: &str,
    instance_id: Option<u64>,
) -> bool {
    target.pane_id == pane_id && target.instance_id == instance_id
}

fn active_terminal_audio_input_target(
    state: &TerminalState,
) -> Result<Option<TerminalAudioInputTarget>, String> {
    state
        .active_audio_input_target
        .lock()
        .map(|target| target.clone())
        .map_err(|_| "Unable to read focused terminal input target.".to_string())
}

fn clear_terminal_audio_input_target_if_matches(
    state: &TerminalState,
    pane_id: &str,
    instance_id: Option<u64>,
) -> Result<(), String> {
    let mut active_target = state
        .active_audio_input_target
        .lock()
        .map_err(|_| "Unable to clear focused terminal input target.".to_string())?;

    if active_target
        .as_ref()
        .is_some_and(|target| terminal_audio_input_target_matches(target, pane_id, instance_id))
    {
        *active_target = None;
    }

    Ok(())
}

fn clear_terminal_audio_input_target(state: &TerminalState) -> Result<(), String> {
    let mut active_target = state
        .active_audio_input_target
        .lock()
        .map_err(|_| "Unable to clear focused terminal input target.".to_string())?;

    *active_target = None;

    Ok(())
}

fn set_terminal_audio_input_target_for(
    state: &TerminalState,
    pane_id: String,
    instance_id: Option<u64>,
    active: bool,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
    write_thread_bridge_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": "backend.audio_input_target.set_request",
        "source": "backend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": {
            "active": active,
            "instance_id": instance_id,
            "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
        },
    }));

    if !active {
        return clear_terminal_audio_input_target_if_matches(state, &pane_id, instance_id);
    }

    let mut active_target = state
        .active_audio_input_target
        .lock()
        .map_err(|_| "Unable to update focused terminal input target.".to_string())?;

    *active_target = Some(TerminalAudioInputTarget {
        pane_id,
        instance_id,
    });

    Ok(())
}

fn emit_terminal_audio_input_refocus(
    app: &AppHandle,
    target: &TerminalAudioInputTarget,
    inserted_text: Option<&str>,
) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }

    let _ = app.emit(
        TERMINAL_AUDIO_INPUT_REFOCUS_EVENT,
        TerminalAudioInputRefocusPayload {
            pane_id: target.pane_id.clone(),
            instance_id: target.instance_id,
            inserted_text: inserted_text.map(str::to_string),
        },
    );
}

fn webview_window_is_focused(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label)
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false)
}

fn app_has_focused_audio_input_window(app: &AppHandle) -> bool {
    webview_window_is_focused(app, "main")
        || webview_window_is_focused(app, AUDIO_WIDGET_WINDOW_LABEL)
}

async fn write_terminal_input(
    app: Option<&AppHandle>,
    state: &TerminalState,
    pane_id: &str,
    instance_id: Option<u64>,
    data: &str,
    _skipped_phase: &str,
) -> Result<bool, String> {
    validate_terminal_pane_id(pane_id)?;

    if data.is_empty() {
        return Ok(true);
    }

    if data.len() > MAX_TERMINAL_WRITE_BYTES {
        return Err("Terminal input chunk is too large.".to_string());
    }

    let Some(instance) = get_terminal_instance_if_current(state, pane_id, instance_id).await?
    else {
        return Ok(false);
    };
    let input_kind = terminal_input_forensics_kind(data);
    log_terminal_crash_forensics_event(
        "backend.terminal_input.write.begin",
        json!({
            "bytes": data.len(),
            "input_kind": input_kind,
            "instance_id": instance.id,
            "pane_id": clean_terminal_diagnostic_log_text(pane_id),
        }),
    );
    let lock_started_at = Instant::now();
    let mut writer = instance.writer.lock().await;
    let lock_wait_ms = terminal_diagnostic_elapsed_ms(lock_started_at);
    let write_started_at = Instant::now();

    if let Err(error) = writer.write_all(data.as_bytes()) {
        log_terminal_crash_forensics_event(
            "backend.terminal_input.write.error",
            json!({
                "bytes": data.len(),
                "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                "input_kind": input_kind,
                "instance_id": instance.id,
                "lock_wait_ms": lock_wait_ms,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "stage": "write_all",
            }),
        );
        return Err(format!("Unable to write terminal input: {error}"));
    }
    if let Err(error) = writer.flush() {
        log_terminal_crash_forensics_event(
            "backend.terminal_input.write.error",
            json!({
                "bytes": data.len(),
                "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                "input_kind": input_kind,
                "instance_id": instance.id,
                "lock_wait_ms": lock_wait_ms,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "stage": "flush",
            }),
        );
        return Err(format!("Unable to flush terminal input: {error}"));
    }
    let write_ms = terminal_diagnostic_elapsed_ms(write_started_at);
    let elapsed_ms = lock_wait_ms + write_ms;
    log_terminal_crash_forensics_event(
        "backend.terminal_input.write.done",
        json!({
            "bytes": data.len(),
            "elapsed_ms": elapsed_ms,
            "input_kind": input_kind,
            "instance_id": instance.id,
            "lock_wait_ms": lock_wait_ms,
            "pane_id": clean_terminal_diagnostic_log_text(pane_id),
            "write_ms": write_ms,
        }),
    );

    if elapsed_ms >= TERMINAL_DIAGNOSTIC_SLOW_MS {
        if let Some(app) = app {
            log_terminal_diagnostic_event(
                app,
                "backend.input_write.slow",
                json!({
                    "bytes": data.len(),
                    "elapsed_ms": elapsed_ms,
                    "instance_id": instance.id,
                    "lock_wait_ms": lock_wait_ms,
                    "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                    "write_ms": write_ms,
                }),
            );
        }
    }

    Ok(true)
}

async fn write_to_active_terminal_audio_input_target(
    app: &AppHandle,
    state: &TerminalState,
    cloud_mcp_state: &CloudMcpState,
    data: &str,
) -> Result<bool, String> {
    let Some(target) = active_terminal_audio_input_target(state)? else {
        return Ok(false);
    };

    if !app_has_focused_audio_input_window(app) {
        clear_terminal_audio_input_target_if_matches(state, &target.pane_id, target.instance_id)?;
        return Ok(false);
    }

    if get_terminal_instance_if_current(state, &target.pane_id, target.instance_id)
        .await?
        .is_none()
    {
        clear_terminal_audio_input_target_if_matches(state, &target.pane_id, target.instance_id)?;
        return Ok(false);
    }

    terminal_write_inner(
        app.clone(),
        state,
        cloud_mcp_state,
        target.pane_id.clone(),
        target.instance_id,
        data.to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        true,
    )
    .await?;
    emit_terminal_audio_input_refocus(app, &target, Some(data));

    Ok(true)
}

fn poll_terminal_child_exit(child: &mut dyn Child) -> bool {
    for _ in 0..TERMINAL_SHUTDOWN_POLL_ATTEMPTS {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => thread::sleep(Duration::from_millis(TERMINAL_SHUTDOWN_POLL_INTERVAL_MS)),
            Err(_) => return true,
        }
    }

    false
}

#[derive(Default)]
struct TerminalKillReport {
    pid: Option<u32>,
    taskkill_exit_code: Option<i32>,
    taskkill_success: Option<bool>,
    taskkill_error: Option<String>,
    child_kill_ok: bool,
    child_kill_error: Option<String>,
}

fn terminal_kill_report_json(report: &TerminalKillReport) -> Value {
    json!({
        "child_kill_error": report.child_kill_error.clone(),
        "child_kill_ok": report.child_kill_ok,
        "pid": report.pid,
        "taskkill_error": report.taskkill_error.clone(),
        "taskkill_exit_code": report.taskkill_exit_code,
        "taskkill_success": report.taskkill_success,
    })
}

fn terminal_metadata_forensics_json(metadata: &TerminalInstanceMetadata) -> Value {
    json!({
        "agent_id": clean_terminal_diagnostic_log_text(&metadata.agent_id),
        "agent_kind": clean_terminal_diagnostic_log_text(&metadata.agent_kind),
        "pane_id": clean_terminal_diagnostic_log_text(&metadata.pane_id),
        "terminal_index": metadata.terminal_index,
        "thread_id": clean_terminal_diagnostic_log_text(&metadata.thread_id),
        "workspace_id": clean_terminal_diagnostic_log_text(&metadata.workspace_id),
        "workspace_name": clean_terminal_diagnostic_log_text(&metadata.workspace_name),
    })
}

fn terminal_input_forensics_kind(data: &str) -> &'static str {
    match data {
        "\r" | "\n" | "\r\n" => "plain_enter",
        TERMINAL_ENTER_SEQUENCE | TERMINAL_ENTER_SEQUENCE_MOD1 => "enhanced_enter_sequence",
        TERMINAL_SHIFT_ENTER_SEQUENCE => "shift_enter_sequence",
        _ if data.chars().any(|character| character.is_control()) => "control_or_escape",
        _ => "text",
    }
}

#[cfg(windows)]
fn kill_terminal_process_tree(child: &mut dyn Child) -> TerminalKillReport {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut report = TerminalKillReport {
        pid: child.process_id(),
        ..TerminalKillReport::default()
    };

    if let Some(pid) = report.pid {
        let mut taskkill = Command::new("taskkill");
        taskkill.creation_flags(CREATE_NO_WINDOW);

        match taskkill
            .arg("/PID")
            .arg(pid.to_string())
            .arg("/T")
            .arg("/F")
            .current_dir(safe_background_command_working_directory())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
        {
            Ok(status) => {
                report.taskkill_exit_code = status.code();
                report.taskkill_success = Some(status.success());
            }
            Err(error) => {
                report.taskkill_success = Some(false);
                report.taskkill_error = Some(clean_terminal_telemetry_text(&error.to_string()));
            }
        }
    }

    match child.kill() {
        Ok(()) => report.child_kill_ok = true,
        Err(error) => {
            report.child_kill_error = Some(clean_terminal_telemetry_text(&error.to_string()));
        }
    }

    report
}

fn terminal_metadata_is_opencode(metadata: &TerminalInstanceMetadata) -> bool {
    let agent_id = metadata.agent_id.trim().to_ascii_lowercase();
    let agent_kind = metadata.agent_kind.trim().to_ascii_lowercase();

    agent_id.contains("opencode") || agent_kind.contains("opencode")
}

#[cfg(not(windows))]
fn terminal_process_matches_opencode(process: &sysinfo::Process) -> bool {
    let name = clean_process_text(&process.name().to_string_lossy()).to_ascii_lowercase();
    let command = process_command_text(process.cmd()).to_ascii_lowercase();
    let executable = process
        .exe()
        .map(process_path_display)
        .unwrap_or_default()
        .to_ascii_lowercase();

    name.contains("opencode") || command.contains("opencode") || executable.contains("opencode")
}

#[cfg(not(windows))]
fn signal_opencode_theme_refresh(root_pid: u32) -> Result<Vec<u32>, String> {
    let mut system = SysSystem::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        developer_process_refresh_kind(),
    );

    let child_map = developer_child_map(&system);
    let candidates = developer_process_tree_child_first(root_pid, &child_map);
    let mut signaled = Vec::new();
    let mut failed = Vec::new();

    for candidate in candidates {
        let Some(process) = system.process(SysPid::from_u32(candidate)) else {
            continue;
        };
        if !terminal_process_matches_opencode(process) {
            continue;
        }
        match process.kill_with(sysinfo::Signal::User2) {
            Some(true) => signaled.push(candidate),
            _ => failed.push(candidate),
        }
    }

    if signaled.is_empty() && !failed.is_empty() {
        return Err("Unable to refresh OpenCode terminal theme.".to_string());
    }

    Ok(signaled)
}

#[cfg(windows)]
fn signal_opencode_theme_refresh(_root_pid: u32) -> Result<Vec<u32>, String> {
    Ok(Vec::new())
}

#[cfg(not(windows))]
fn kill_terminal_process_tree(child: &mut dyn Child) -> TerminalKillReport {
    let mut report = TerminalKillReport {
        pid: child.process_id(),
        ..TerminalKillReport::default()
    };

    match child.kill() {
        Ok(()) => report.child_kill_ok = true,
        Err(error) => {
            report.child_kill_error = Some(clean_terminal_telemetry_text(&error.to_string()));
        }
    }

    report
}

fn interrupt_terminal_coordination_session(
    coordination: &TerminalCoordinationSession,
    reason: &str,
) {
    let kernel = match crate::coordination::CoordinationKernel::open_for_shutdown_cleanup(
        &coordination.repo_path,
        Some(PathBuf::from(&coordination.db_path)),
    ) {
        Ok(kernel) => kernel,
        Err(_) => return,
    };

    let _ = kernel.interrupt_session_for_terminal_launch(
        &coordination.session_id,
        reason,
        coordination.terminal_launch_epoch.as_deref(),
    );
}

fn terminal_coordination_session_from_context(
    context: &crate::coordination::models::TerminalCoordinationContext,
) -> TerminalCoordinationSession {
    TerminalCoordinationSession {
        repo_path: context.repo_path.clone(),
        db_path: context.db_path.clone(),
        mcp_command: context.mcp_command.clone(),
        agent_id: context.agent_id.clone(),
        agent_kind: context.agent_kind.clone(),
        session_id: context.session_id.clone(),
        terminal_launch_epoch: context.terminal_launch_epoch.clone(),
        env_vars: context.env_vars(),
    }
}

fn clear_terminal_activity_hook_files(pane_id: &str, instance_id: u64) {
    let _ = fs::remove_file(terminal_activity_events_path(pane_id, instance_id));
    let _ = fs::remove_file(terminal_activity_debug_path(pane_id, instance_id));
}

fn refresh_codex_activity_hook_profile_for_launch(
    coordination: Option<&TerminalCoordinationSession>,
    provider_id: &str,
    pane_id: &str,
    instance_id: u64,
    workspace_id: Option<&str>,
    terminal_index: Option<u16>,
) {
    if !provider_id.to_ascii_lowercase().contains("codex") || coordination.is_none() {
        return;
    }
    clear_terminal_activity_hook_files(pane_id, instance_id);
    match refresh_codex_activity_hook_profile_for_terminal(
        coordination,
        provider_id,
        pane_id,
        instance_id,
        workspace_id,
        terminal_index,
    ) {
        Ok(updated) => log_terminal_status_event(
            "backend.terminal_activity_hook.profile_scoped",
            json!({
                "activity_debug_path": terminal_activity_debug_path(pane_id, instance_id).to_string_lossy().to_string(),
                "activity_events_path": terminal_activity_events_path(pane_id, instance_id).to_string_lossy().to_string(),
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "provider_id": provider_id,
                "terminal_index": terminal_index,
                "updated": updated,
                "workspace_id": workspace_id.unwrap_or_default(),
            }),
        ),
        Err(error) => log_terminal_status_event(
            "backend.terminal_activity_hook.profile_scope_error",
            json!({
                "error": clean_terminal_diagnostic_log_text(&error),
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "provider_id": provider_id,
                "terminal_index": terminal_index,
                "workspace_id": workspace_id.unwrap_or_default(),
            }),
        ),
    }
}

fn ensure_terminal_coordination_ready_for_prompt(
    coordination: &TerminalCoordinationSession,
) -> Result<(), String> {
    let kernel = crate::coordination::CoordinationKernel::open_for_shutdown_cleanup(
        &coordination.repo_path,
        Some(PathBuf::from(&coordination.db_path)),
    )?;

    if kernel.heartbeat_session(&coordination.session_id).is_ok() {
        return Ok(());
    }

    match kernel.reactivate_interrupted_session_for_agent(
        &coordination.session_id,
        &coordination.agent_id,
        coordination.terminal_launch_epoch.as_deref(),
        "terminal_prompt_submit_reconnect",
    )? {
        Some(_) => Ok(()),
        None => Err(
            "Coordination session is not active. Reconnect the terminal before sending a prompt."
                .to_string(),
        ),
    }
}

#[derive(Clone, Copy)]
enum TerminalCoordinationCleanupMode {
    InterruptAfterProcess,
    Preserve,
    DeferToShutdownBatch,
}

impl TerminalCoordinationCleanupMode {
    fn as_str(self) -> &'static str {
        match self {
            TerminalCoordinationCleanupMode::InterruptAfterProcess => "interrupt_after_process",
            TerminalCoordinationCleanupMode::Preserve => "preserve",
            TerminalCoordinationCleanupMode::DeferToShutdownBatch => "defer_to_shutdown_batch",
        }
    }
}

#[derive(Clone)]
struct TerminalShutdownCoordinationCleanup {
    repo_path: String,
    db_path: String,
    session_id: String,
    terminal_launch_epoch: Option<String>,
}

fn terminal_shutdown_coordination_cleanup_from_instance(
    instance: &TerminalInstance,
) -> Option<TerminalShutdownCoordinationCleanup> {
    let coordination = instance.coordination.as_ref()?;
    Some(TerminalShutdownCoordinationCleanup {
        repo_path: coordination.repo_path.clone(),
        db_path: coordination.db_path.clone(),
        session_id: coordination.session_id.clone(),
        terminal_launch_epoch: coordination.terminal_launch_epoch.clone(),
    })
}

fn cleanup_terminal_shutdown_coordination_batch_with_timeout(
    cleanups: Vec<TerminalShutdownCoordinationCleanup>,
    reason: &'static str,
    timeout: Duration,
) {
    if cleanups.is_empty() {
        return;
    }

    let (summary_tx, summary_rx) = std::sync::mpsc::channel();
    thread::spawn(move || {
        cleanup_terminal_shutdown_coordination_batch(cleanups, reason);
        let _ = summary_tx.send(());
    });

    let _ = summary_rx.recv_timeout(timeout);
}

fn cleanup_terminal_shutdown_coordination_batch(
    cleanups: Vec<TerminalShutdownCoordinationCleanup>,
    reason: &'static str,
) {
    let mut grouped: HashMap<(String, String), Vec<TerminalShutdownCoordinationCleanup>> =
        HashMap::new();
    for cleanup in cleanups {
        grouped
            .entry((cleanup.repo_path.clone(), cleanup.db_path.clone()))
            .or_default()
            .push(cleanup);
    }

    for ((repo_path, db_path), group) in grouped {
        let kernel = match crate::coordination::CoordinationKernel::open_for_shutdown_cleanup(
            &repo_path,
            Some(PathBuf::from(&db_path)),
        ) {
            Ok(kernel) => kernel,
            Err(_) => continue,
        };

        for cleanup in group {
            let _ = kernel.interrupt_session_for_terminal_launch(
                &cleanup.session_id,
                reason,
                cleanup.terminal_launch_epoch.as_deref(),
            );
        }
    }
}

fn interrupt_terminal_coordination_after_process_cleanup(
    coordination: Option<&TerminalCoordinationSession>,
    reason: &'static str,
    coordination_cleanup_mode: TerminalCoordinationCleanupMode,
) {
    if !matches!(
        coordination_cleanup_mode,
        TerminalCoordinationCleanupMode::InterruptAfterProcess
    ) {
        return;
    }

    let Some(coordination) = coordination else {
        return;
    };

    interrupt_terminal_coordination_session(coordination, reason);
}

fn cleanup_terminal_instance_with_context(
    instance: TerminalInstance,
    kill_first: bool,
    reason: &'static str,
    coordination_cleanup_mode: TerminalCoordinationCleanupMode,
) {
    let TerminalInstance {
        id,
        child,
        master,
        writer,
        size,
        headless_output: _,
        working_directory,
        agent_started,
        input_gate,
        input_queue,
        active_task,
        coordination,
        session_mode: _,
        metadata,
    } = instance;
    let metadata_fields = terminal_metadata_forensics_json(&metadata);
    log_terminal_crash_forensics_event(
        "backend.terminal_cleanup.begin",
        json!({
            "coordination_cleanup_mode": coordination_cleanup_mode.as_str(),
            "instance_id": id,
            "kill_first": kill_first,
            "metadata": metadata_fields,
            "reason": reason,
        }),
    );

    let maybe_child = {
        let mut child = child.blocking_lock();
        child.take()
    };
    let Some(mut child) = maybe_child else {
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup.no_child",
            json!({
                "instance_id": id,
                "reason": reason,
            }),
        );
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup.drop_writer.begin",
            json!({
                "instance_id": id,
                "reason": reason,
            }),
        );
        drop(writer);
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup.drop_writer.done",
            json!({
                "instance_id": id,
                "reason": reason,
            }),
        );
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup.drop_master.begin",
            json!({
                "instance_id": id,
                "reason": reason,
            }),
        );
        drop(master);
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup.drop_master.done",
            json!({
                "instance_id": id,
                "reason": reason,
            }),
        );
        drop(size);
        drop(working_directory);
        drop(agent_started);
        drop(input_gate);
        drop(input_queue);
        drop(active_task);
        drop(metadata);
        interrupt_terminal_coordination_after_process_cleanup(
            coordination.as_ref(),
            reason,
            coordination_cleanup_mode,
        );
        drop(coordination);
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup.done",
            json!({
                "instance_id": id,
                "reason": reason,
            }),
        );
        return;
    };
    if kill_first {
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup.kill.begin",
            json!({
                "instance_id": id,
                "reason": reason,
                "stage": "initial_kill_first",
            }),
        );
        let report = kill_terminal_process_tree(child.as_mut());
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup.kill.done",
            json!({
                "instance_id": id,
                "reason": reason,
                "report": terminal_kill_report_json(&report),
                "stage": "initial_kill_first",
            }),
        );
    } else if !poll_terminal_child_exit(child.as_mut()) {
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup.kill.begin",
            json!({
                "instance_id": id,
                "reason": reason,
                "stage": "poll_timeout",
            }),
        );
        let report = kill_terminal_process_tree(child.as_mut());
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup.kill.done",
            json!({
                "instance_id": id,
                "reason": reason,
                "report": terminal_kill_report_json(&report),
                "stage": "poll_timeout",
            }),
        );
    }

    if !poll_terminal_child_exit(child.as_mut()) {
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup.kill.begin",
            json!({
                "instance_id": id,
                "reason": reason,
                "stage": "final_poll_timeout",
            }),
        );
        let report = kill_terminal_process_tree(child.as_mut());
        log_terminal_crash_forensics_event(
            "backend.terminal_cleanup.kill.done",
            json!({
                "instance_id": id,
                "reason": reason,
                "report": terminal_kill_report_json(&report),
                "stage": "final_poll_timeout",
            }),
        );
        poll_terminal_child_exit(child.as_mut());
    }

    log_terminal_crash_forensics_event(
        "backend.terminal_cleanup.drop_child.begin",
        json!({
            "instance_id": id,
            "reason": reason,
        }),
    );
    drop(child);
    log_terminal_crash_forensics_event(
        "backend.terminal_cleanup.drop_child.done",
        json!({
            "instance_id": id,
            "reason": reason,
        }),
    );
    log_terminal_crash_forensics_event(
        "backend.terminal_cleanup.drop_writer.begin",
        json!({
            "instance_id": id,
            "reason": reason,
        }),
    );
    drop(writer);
    log_terminal_crash_forensics_event(
        "backend.terminal_cleanup.drop_writer.done",
        json!({
            "instance_id": id,
            "reason": reason,
        }),
    );
    log_terminal_crash_forensics_event(
        "backend.terminal_cleanup.drop_master.begin",
        json!({
            "instance_id": id,
            "reason": reason,
        }),
    );
    drop(master);
    log_terminal_crash_forensics_event(
        "backend.terminal_cleanup.drop_master.done",
        json!({
            "instance_id": id,
            "reason": reason,
        }),
    );
    drop(size);
    drop(working_directory);
    drop(agent_started);
    drop(input_gate);
    drop(input_queue);
    drop(active_task);
    drop(metadata);
    interrupt_terminal_coordination_after_process_cleanup(
        coordination.as_ref(),
        reason,
        coordination_cleanup_mode,
    );
    drop(coordination);
    log_terminal_crash_forensics_event(
        "backend.terminal_cleanup.done",
        json!({
            "instance_id": id,
            "reason": reason,
        }),
    );
}

fn cleanup_terminal_instance_async(
    instance: TerminalInstance,
    kill_first: bool,
    reason: &'static str,
    preserve_coordination_session: bool,
    cleanup_tracker: Option<Arc<TerminalCleanupTracker>>,
) {
    thread::spawn(move || {
        let instance_id = instance.id;
        let _cleanup_guard = cleanup_tracker
            .as_ref()
            .map(|tracker| tracker.begin(reason, Some(instance_id)));
        let coordination_cleanup_mode = if preserve_coordination_session {
            TerminalCoordinationCleanupMode::Preserve
        } else {
            TerminalCoordinationCleanupMode::InterruptAfterProcess
        };
        cleanup_terminal_instance_with_context(
            instance,
            kill_first,
            reason,
            coordination_cleanup_mode,
        );
    });
}

fn emit_terminal_close_all_progress(
    app: &AppHandle,
    closed: usize,
    total: usize,
    pane_id: Option<String>,
    instance_id: Option<u64>,
    workspace_id: Option<String>,
) {
    let _ = app.emit(
        TERMINAL_CLOSE_ALL_PROGRESS_EVENT,
        TerminalCloseAllProgressPayload {
            closed,
            total,
            pane_id,
            instance_id,
            workspace_id,
        },
    );
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalLiveActiveTaskSummary {
    task_id: String,
    title: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalLiveCoordinationSummary {
    repo_path: String,
    agent_id: String,
    agent_kind: String,
    session_id: String,
    terminal_launch_epoch: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalLiveParkedPromptSummary {
    pane_id: String,
    instance_id: u64,
    task_id: String,
    title: String,
    prompt_preview: String,
    waiting_on: Vec<TerminalParkedWaitingOn>,
    resume_claimed: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalLiveSessionSummary {
    pane_id: String,
    instance_id: u64,
    workspace_id: String,
    workspace_name: String,
    terminal_index: Option<u16>,
    thread_id: String,
    agent_id: String,
    agent_kind: String,
    working_directory: String,
    session_mode: String,
    file_authority: String,
    coordination: Option<TerminalLiveCoordinationSummary>,
    active_task: Option<TerminalLiveActiveTaskSummary>,
    parked_prompt: Option<TerminalLiveParkedPromptSummary>,
    has_active_task: bool,
    parked: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalLiveSessionsResult {
    generated_at_ms: u64,
    sessions: Vec<TerminalLiveSessionSummary>,
    parked_prompts: Vec<TerminalLiveParkedPromptSummary>,
}

fn terminal_live_prompt_preview(prompt: &str) -> String {
    const MAX_PROMPT_PREVIEW_CHARS: usize = 240;
    prompt.chars().take(MAX_PROMPT_PREVIEW_CHARS).collect()
}

fn terminal_live_parked_prompt_summary(
    parked: &TerminalParkedPrompt,
) -> TerminalLiveParkedPromptSummary {
    TerminalLiveParkedPromptSummary {
        pane_id: parked.pane_id.clone(),
        instance_id: parked.instance_id,
        task_id: parked.task_id.clone(),
        title: parked.title.clone(),
        prompt_preview: terminal_live_prompt_preview(&parked.prompt),
        waiting_on: parked.waiting_on.clone(),
        resume_claimed: parked.resume_claimed,
    }
}

fn terminal_instance_matches_workspace(
    instance: &TerminalInstance,
    workspace_id: Option<&str>,
) -> bool {
    let Some(workspace_id) = workspace_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return true;
    };

    instance.metadata.workspace_id == workspace_id
}

fn workspace_git_bootstrap_cache() -> &'static StdMutex<HashMap<String, WorkspaceGitBootstrap>> {
    static CACHE: OnceLock<StdMutex<HashMap<String, WorkspaceGitBootstrap>>> = OnceLock::new();
    CACHE.get_or_init(|| StdMutex::new(HashMap::new()))
}

type WorkspaceGitBootstrapResult = Result<WorkspaceGitBootstrap, String>;

#[derive(Clone)]
struct WorkspaceGitBootstrapFlight {
    id: u64,
    future: Shared<BoxFuture<'static, WorkspaceGitBootstrapResult>>,
}

fn workspace_git_bootstrap_flights()
-> &'static StdMutex<HashMap<String, WorkspaceGitBootstrapFlight>> {
    static FLIGHTS: OnceLock<StdMutex<HashMap<String, WorkspaceGitBootstrapFlight>>> =
        OnceLock::new();
    FLIGHTS.get_or_init(|| StdMutex::new(HashMap::new()))
}

static WORKSPACE_GIT_BOOTSTRAP_FLIGHT_ID: AtomicU64 = AtomicU64::new(1);

fn workspace_git_bootstrap_cache_key(root: &Path) -> String {
    root.canonicalize()
        .map(|path| normalized_path_key(&path))
        .unwrap_or_else(|_| normalized_path_key(root))
}

fn cached_workspace_git_bootstrap(root: &Path) -> Option<WorkspaceGitBootstrap> {
    let key = workspace_git_bootstrap_cache_key(root);
    workspace_git_bootstrap_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(&key).cloned())
}

fn remember_workspace_git_bootstrap(root: &Path, bootstrap: &WorkspaceGitBootstrap) {
    let key = workspace_git_bootstrap_cache_key(root);
    if let Ok(mut cache) = workspace_git_bootstrap_cache().lock() {
        if cache.len() > 128 {
            cache.clear();
        }
        cache.insert(key, bootstrap.clone());
    }
}

fn forget_workspace_git_bootstrap_flight(key: &str, id: u64) {
    if let Ok(mut flights) = workspace_git_bootstrap_flights().lock() {
        if flights.get(key).is_some_and(|flight| flight.id == id) {
            flights.remove(key);
        }
    }
}

async fn ensure_workspace_git_bootstrap_for_terminal(
    root: &Path,
    allow_git_init: bool,
) -> Result<WorkspaceGitBootstrap, String> {
    ensure_app_not_shutting_down("workspace Git bootstrap")?;

    if !allow_git_init && !root.join(".git").exists() {
        return Err(format!(
            "Workspace Git bootstrap refused to initialize Git for {}. Diff Forge only initializes Git automatically when the selected workspace folder was empty.",
            workspace_path_display(root)
        ));
    }

    if let Some(bootstrap) = cached_workspace_git_bootstrap(root) {
        return Ok(bootstrap);
    }

    let key = workspace_git_bootstrap_cache_key(root);
    let root_for_flight = root.to_path_buf();
    let (flight_id, flight) = {
        let mut flights = workspace_git_bootstrap_flights()
            .lock()
            .map_err(|_| "Unable to lock workspace Git bootstrap flight registry.".to_string())?;
        if let Some(existing) = flights.get(&key).cloned() {
            (existing.id, existing.future)
        } else {
            let id = WORKSPACE_GIT_BOOTSTRAP_FLIGHT_ID.fetch_add(1, Ordering::Relaxed);
            let future = async move {
                match tauri::async_runtime::spawn_blocking(move || {
                    ensure_workspace_git_ready_for_coordination(&root_for_flight)
                })
                .await
                {
                    Ok(result) => result,
                    Err(error) => Err(format!(
                        "Workspace Git bootstrap worker failed before completion: {error}"
                    )),
                }
            }
            .boxed()
            .shared();
            flights.insert(
                key.clone(),
                WorkspaceGitBootstrapFlight {
                    id,
                    future: future.clone(),
                },
            );
            (id, future)
        }
    };

    let result = flight.await;
    forget_workspace_git_bootstrap_flight(&key, flight_id);

    match result {
        Ok(bootstrap) => {
            remember_workspace_git_bootstrap(root, &bootstrap);
            Ok(bootstrap)
        }
        Err(error) => Err(format!(
            "Unable to initialize workspace Git for terminal isolation: {error}"
        )),
    }
}

#[derive(Debug)]
struct TerminalCoordinationLaunchTarget {
    root: PathBuf,
    enforcement_mode: &'static str,
    requires_git_bootstrap: bool,
    allows_git_init: bool,
}

fn terminal_workspace_topology_cache_key(root: &Path) -> String {
    root.canonicalize()
        .map(|path| normalized_path_key(&path))
        .unwrap_or_else(|_| normalized_path_key(root))
}

fn terminal_workspace_topology_cache_fresh(
    snapshot: &TerminalWorkspaceTopologySnapshot,
    now_ms: u64,
) -> bool {
    now_ms.saturating_sub(snapshot.scanned_ms) <= TERMINAL_WORKSPACE_TOPOLOGY_CACHE_FRESH_MS
}

struct TerminalWorkspaceTopologyScan {
    mounts: Vec<WorkspaceProjectMount>,
    cache_key: String,
    cache_status: &'static str,
    cache_hit: bool,
    scanned_ms: u64,
}

async fn terminal_workspace_topology_cached_scan(
    cache: &Arc<RwLock<HashMap<String, TerminalWorkspaceTopologySnapshot>>>,
    workspace_root: &Path,
    now_ms: u64,
) -> TerminalWorkspaceTopologyScan {
    let key = terminal_workspace_topology_cache_key(workspace_root);
    let cache = cache.read().await;
    if let Some(snapshot) = cache.get(&key) {
        return TerminalWorkspaceTopologyScan {
            mounts: snapshot.mounts.clone(),
            cache_key: key,
            cache_status: if terminal_workspace_topology_cache_fresh(snapshot, now_ms) {
                "hit"
            } else {
                "stale_cached"
            },
            cache_hit: true,
            scanned_ms: snapshot.scanned_ms,
        };
    }

    TerminalWorkspaceTopologyScan {
        mounts: Vec::new(),
        cache_key: key,
        cache_status: "missing",
        cache_hit: false,
        scanned_ms: now_ms,
    }
}

async fn terminal_workspace_topology_scan_for_launch_from_cache(
    cache: &Arc<RwLock<HashMap<String, TerminalWorkspaceTopologySnapshot>>>,
    workspace_root: &Path,
    now_ms: u64,
    scanned_ms_override: Option<u64>,
) -> TerminalWorkspaceTopologyScan {
    let key = terminal_workspace_topology_cache_key(workspace_root);
    let mut stale_age_ms = None;
    {
        let cache = cache.read().await;
        if let Some(snapshot) = cache.get(&key) {
            let age_ms = now_ms.saturating_sub(snapshot.scanned_ms);
            if terminal_workspace_topology_cache_fresh(snapshot, now_ms) {
                return TerminalWorkspaceTopologyScan {
                    mounts: snapshot.mounts.clone(),
                    cache_key: key,
                    cache_status: "hit",
                    cache_hit: true,
                    scanned_ms: snapshot.scanned_ms,
                };
            }
            stale_age_ms = Some(age_ms);
        }
    }

    let mounts = workspace_project_mounts(workspace_root);
    let scanned_ms = scanned_ms_override.unwrap_or_else(terminal_now_ms);
    let mut cache = cache.write().await;
    cache.insert(
        key.clone(),
        TerminalWorkspaceTopologySnapshot {
            mounts: mounts.clone(),
            scanned_ms,
        },
    );
    TerminalWorkspaceTopologyScan {
        mounts,
        cache_key: key,
        cache_status: if stale_age_ms.is_some() {
            "stale_refresh"
        } else {
            "miss"
        },
        cache_hit: false,
        scanned_ms,
    }
}

async fn terminal_workspace_topology_mounts_for_launch_from_cache(
    cache: &Arc<RwLock<HashMap<String, TerminalWorkspaceTopologySnapshot>>>,
    workspace_root: &Path,
    now_ms: u64,
    scanned_ms_override: Option<u64>,
) -> Vec<WorkspaceProjectMount> {
    terminal_workspace_topology_scan_for_launch_from_cache(
        cache,
        workspace_root,
        now_ms,
        scanned_ms_override,
    )
    .await
    .mounts
}

async fn terminal_workspace_topology_mounts_for_launch(
    state: &TerminalState,
    workspace_root: &Path,
) -> Vec<WorkspaceProjectMount> {
    terminal_workspace_topology_mounts_for_launch_from_cache(
        &state.workspace_topology_cache,
        workspace_root,
        terminal_now_ms(),
        None,
    )
    .await
}

async fn terminal_workspace_topology_scan_for_launch(
    state: &TerminalState,
    workspace_root: &Path,
) -> TerminalWorkspaceTopologyScan {
    terminal_workspace_topology_scan_for_launch_from_cache(
        &state.workspace_topology_cache,
        workspace_root,
        terminal_now_ms(),
        None,
    )
    .await
}

fn workspace_git_repo_root(repo_path: &str) -> Result<PathBuf, String> {
    let requested = resolve_workspace_root_directory(Some(repo_path))?;
    let top_level = workspace_git_top_level(&requested).ok_or_else(|| {
        format!(
            "No Git repository was found for {}.",
            workspace_path_display(&requested)
        )
    })?;
    let metadata = fs::metadata(&top_level)
        .map_err(|error| format!("Unable to inspect Git repository root: {error}"))?;
    if !metadata.is_dir() {
        return Err("Git repository root is not a directory.".to_string());
    }
    Ok(top_level)
}

fn workspace_git_repo_key(path: &Path) -> String {
    path.canonicalize()
        .map(|path| normalized_path_key(&path))
        .unwrap_or_else(|_| normalized_path_key(path))
}

fn workspace_git_run_owned(
    root: &Path,
    args: Vec<String>,
    timeout: Duration,
) -> Result<CommandCapture, String> {
    let borrowed = args.iter().map(String::as_str).collect::<Vec<_>>();
    run_git_for_workspace(root, &borrowed, timeout)
}

fn workspace_git_run_noninteractive(
    root: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<CommandCapture, String> {
    let safe_directory = format!("safe.directory={}", git_safe_directory_value(root));
    let mut owned_args = Vec::with_capacity(args.len() + 2);
    owned_args.push("-c".to_string());
    owned_args.push(safe_directory);
    owned_args.extend(args.iter().map(|arg| (*arg).to_string()));
    let borrowed_args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
    run_command_capture_with_env(
        "git",
        &borrowed_args,
        None,
        timeout,
        Some(root),
        &[
            ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
            ("GCM_INTERACTIVE".to_string(), "Never".to_string()),
        ],
    )
}

fn workspace_git_text_or_empty(root: &Path, args: &[&str], timeout: Duration) -> String {
    run_git_text(root, args, timeout, "git")
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

fn workspace_git_output_or_empty(root: &Path, args: &[&str], timeout: Duration) -> String {
    run_git_for_workspace(root, args, timeout)
        .ok()
        .filter(|capture| capture.exit_code == Some(0))
        .map(|capture| capture.stdout)
        .unwrap_or_default()
}

fn workspace_git_current_branch(root: &Path) -> String {
    let branch = workspace_git_text_or_empty(
        root,
        &["branch", "--show-current"],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
    );
    if !branch.is_empty() {
        return branch;
    }
    let short_head = workspace_git_text_or_empty(
        root,
        &["rev-parse", "--short", "HEAD"],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
    );
    if short_head.is_empty() {
        "unborn".to_string()
    } else {
        format!("detached:{short_head}")
    }
}

fn workspace_git_head_sha(root: &Path) -> String {
    workspace_git_text_or_empty(
        root,
        &["rev-parse", "HEAD"],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
    )
}

fn workspace_git_upstream(root: &Path) -> String {
    workspace_git_text_or_empty(
        root,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
    )
}

fn workspace_git_remotes(root: &Path) -> Vec<Value> {
    let output = workspace_git_output_or_empty(
        root,
        &["remote", "-v"],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
    );
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let name = parts.next()?.trim();
            let url = parts.next()?.trim();
            let direction = parts
                .next()
                .unwrap_or_default()
                .trim_matches(|character| character == '(' || character == ')');
            if name.is_empty() || url.is_empty() {
                return None;
            }
            Some(json!({
                "name": name,
                "url": url,
                "direction": direction,
            }))
        })
        .collect()
}

fn workspace_git_ahead_behind(root: &Path, upstream: &str) -> (u64, u64) {
    if upstream.trim().is_empty() {
        return (0, 0);
    }
    let output = workspace_git_text_or_empty(
        root,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
    );
    let mut parts = output.split_whitespace();
    let ahead = parts
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let behind = parts
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    (ahead, behind)
}

fn workspace_git_path_exists(root: &Path, git_path: &str) -> bool {
    let path = workspace_git_text_or_empty(
        root,
        &["rev-parse", "--git-path", git_path],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
    );
    if path.is_empty() {
        return false;
    }
    let candidate = PathBuf::from(path);
    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        root.join(candidate)
    };
    resolved.exists()
}

fn workspace_git_operation_state(root: &Path) -> Value {
    let merge = workspace_git_path_exists(root, "MERGE_HEAD");
    let cherry_pick = workspace_git_path_exists(root, "CHERRY_PICK_HEAD");
    let rebase = workspace_git_path_exists(root, "rebase-merge")
        || workspace_git_path_exists(root, "rebase-apply");
    let clean = !(merge || cherry_pick || rebase);
    json!({
        "clean": clean,
        "merge": merge,
        "cherryPick": cherry_pick,
        "rebase": rebase,
        "state": if merge {
            "merge"
        } else if cherry_pick {
            "cherry_pick"
        } else if rebase {
            "rebase"
        } else {
            "clean"
        },
    })
}

fn workspace_git_status_kind(code: &str) -> &'static str {
    let bytes = code.as_bytes();
    let index = bytes.first().copied().unwrap_or(b' ');
    let worktree = bytes.get(1).copied().unwrap_or(b' ');
    if code == "??" {
        return "untracked";
    }
    if [index, worktree].iter().any(|value| matches!(*value, b'U'))
        || matches!((index, worktree), (b'A', b'A') | (b'D', b'D'))
    {
        return "conflicted";
    }
    if [index, worktree].iter().any(|value| matches!(*value, b'R')) {
        return "renamed";
    }
    if [index, worktree].iter().any(|value| matches!(*value, b'C')) {
        return "copied";
    }
    if [index, worktree].iter().any(|value| matches!(*value, b'A')) {
        return "added";
    }
    if [index, worktree].iter().any(|value| matches!(*value, b'D')) {
        return "deleted";
    }
    if [index, worktree].iter().any(|value| matches!(*value, b'T')) {
        return "typechange";
    }
    if [index, worktree].iter().any(|value| matches!(*value, b'M')) {
        return "modified";
    }
    "changed"
}

fn workspace_git_status_label(kind: &str) -> &'static str {
    match kind {
        "added" => "Added",
        "conflicted" => "Conflicted",
        "copied" => "Copied",
        "deleted" => "Deleted",
        "modified" => "Modified",
        "renamed" => "Renamed",
        "typechange" => "Type changed",
        "untracked" => "Untracked",
        _ => "Changed",
    }
}

fn workspace_git_status_files(root: &Path) -> Vec<Value> {
    let capture = match run_git_for_workspace(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
        ],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
    ) {
        Ok(capture) if capture.exit_code == Some(0) => capture,
        _ => return Vec::new(),
    };
    let parts = capture.stdout.split('\0').collect::<Vec<_>>();
    let mut files = Vec::new();
    let mut index = 0usize;
    while index < parts.len() {
        let entry = parts[index];
        if entry.is_empty() {
            index += 1;
            continue;
        }
        let code = entry.get(0..2).unwrap_or("  ");
        let path = normalize_git_status_path(entry.get(3..).unwrap_or(""));
        if path.is_empty() {
            index += 1;
            continue;
        }
        let old_path = if code.starts_with('R') || code.starts_with('C') {
            index += 1;
            parts
                .get(index)
                .map(|value| normalize_git_status_path(value))
                .filter(|value| !value.is_empty())
        } else {
            None
        };
        let kind = workspace_git_status_kind(code);
        let bytes = code.as_bytes();
        let index_status = bytes.first().copied().unwrap_or(b' ') as char;
        let worktree_status = bytes.get(1).copied().unwrap_or(b' ') as char;
        files.push(json!({
            "path": path,
            "oldPath": old_path,
            "code": code,
            "kind": kind,
            "label": workspace_git_status_label(kind),
            "staged": index_status != ' ' && index_status != '?',
            "unstaged": worktree_status != ' ' || code == "??",
            "untracked": code == "??",
            "conflicted": kind == "conflicted",
        }));
        index += 1;
    }
    files.sort_by(|left, right| {
        let left_path = left["path"].as_str().unwrap_or_default();
        let right_path = right["path"].as_str().unwrap_or_default();
        left_path.cmp(right_path)
    });
    files
}

fn workspace_git_status_counts(files: &[Value]) -> Value {
    let staged = files
        .iter()
        .filter(|file| file["staged"].as_bool().unwrap_or(false))
        .count();
    let unstaged = files
        .iter()
        .filter(|file| file["unstaged"].as_bool().unwrap_or(false))
        .count();
    let untracked = files
        .iter()
        .filter(|file| file["untracked"].as_bool().unwrap_or(false))
        .count();
    let conflicted = files
        .iter()
        .filter(|file| file["conflicted"].as_bool().unwrap_or(false))
        .count();
    json!({
        "total": files.len(),
        "staged": staged,
        "unstaged": unstaged,
        "untracked": untracked,
        "conflicted": conflicted,
    })
}

fn workspace_git_history(root: &Path) -> Vec<Value> {
    let output = workspace_git_output_or_empty(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "log",
            "--name-status",
            "--date=iso-strict",
            "--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s",
            "-n",
            "40",
        ],
        Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
    );
    output
        .split('\x1e')
        .filter_map(|record| {
            let trimmed = record.trim_matches('\n');
            if trimmed.trim().is_empty() {
                return None;
            }
            let mut lines = trimmed.lines();
            let header = lines.next().unwrap_or_default();
            let fields = header.split('\x1f').collect::<Vec<_>>();
            if fields.len() < 6 {
                return None;
            }
            let files = lines
                .filter_map(|line| {
                    let mut parts = line.split('\t');
                    let status = parts.next()?.trim();
                    let path = parts.next()?.trim();
                    if status.is_empty() || path.is_empty() {
                        return None;
                    }
                    let old_path = parts
                        .next()
                        .map(str::trim)
                        .filter(|value| !value.is_empty());
                    Some(json!({
                        "status": status,
                        "path": normalize_git_status_path(path),
                        "oldPath": old_path.map(normalize_git_status_path),
                    }))
                })
                .collect::<Vec<_>>();
            Some(json!({
                "sha": fields[0],
                "shortSha": fields[1],
                "authorName": fields[2],
                "authorEmail": fields[3],
                "date": fields[4],
                "subject": fields[5],
                "files": files,
            }))
        })
        .collect()
}

fn workspace_git_discovered_repositories(
    workspace_root: &Path,
    mounts: &[WorkspaceProjectMount],
) -> Vec<PathBuf> {
    let mut repos = Vec::new();
    let mut seen = HashSet::new();
    let mut push_repo = |path: PathBuf| {
        let key = workspace_git_repo_key(&path);
        if seen.insert(key) {
            repos.push(path);
        }
    };

    if let Some(top_level) = workspace_git_top_level(workspace_root) {
        if top_level.starts_with(workspace_root) {
            push_repo(top_level);
        }
    } else if workspace_is_exact_git_root(workspace_root) {
        push_repo(workspace_root.to_path_buf());
    }

    for mount in mounts {
        if mount.has_git {
            push_repo(mount.root_path.clone());
        }
    }

    repos.sort_by(|left, right| {
        child_relative_path(workspace_root, left)
            .unwrap_or_else(|| workspace_path_display(left))
            .cmp(
                &child_relative_path(workspace_root, right)
                    .unwrap_or_else(|| workspace_path_display(right)),
            )
    });
    repos
}

fn workspace_git_snapshot_for(root: &Path) -> Value {
    let upstream = workspace_git_upstream(root);
    let (ahead, behind) = workspace_git_ahead_behind(root, &upstream);
    let files = workspace_git_status_files(root);
    let counts = workspace_git_status_counts(&files);
    json!({
        "generatedAtMs": terminal_now_ms(),
        "repo": {
            "path": workspace_path_display(root),
            "name": root.file_name().and_then(|value| value.to_str()).unwrap_or("repository"),
            "branch": workspace_git_current_branch(root),
            "headSha": workspace_git_head_sha(root),
            "upstream": upstream,
            "ahead": ahead,
            "behind": behind,
            "remotes": workspace_git_remotes(root),
        },
        "operationState": workspace_git_operation_state(root),
        "status": {
            "dirty": !files.is_empty(),
            "counts": counts,
            "files": files,
        },
        "history": workspace_git_history(root),
    })
}

fn workspace_git_limited_output(stdout: &str, stderr: &str) -> String {
    command_output_text(stdout, stderr)
        .chars()
        .take(4000)
        .collect::<String>()
}

fn workspace_git_fetch(root: &Path) -> Result<String, String> {
    let capture = workspace_git_run_noninteractive(
        root,
        &["fetch", "--prune", "--quiet"],
        Duration::from_secs(60),
    )?;
    if capture.exit_code == Some(0) {
        return Ok(workspace_git_limited_output(
            &capture.stdout,
            &capture.stderr,
        ));
    }
    let output = workspace_git_limited_output(&capture.stdout, &capture.stderr);
    if output.trim().is_empty() {
        Err("git fetch failed.".to_string())
    } else {
        Err(output)
    }
}

fn workspace_git_pull_candidate_summary(root: &Path, workspace_root: &Path) -> Value {
    let branch = workspace_git_current_branch(root);
    let upstream = workspace_git_upstream(root);
    let files = workspace_git_status_files(root);
    let counts = workspace_git_status_counts(&files);
    let dirty = !files.is_empty();
    let operation_state = workspace_git_operation_state(root);
    let operation_clean = operation_state["clean"].as_bool().unwrap_or(false);
    let (fetch_ok, fetch_error) = if upstream.trim().is_empty() || !operation_clean {
        (false, String::new())
    } else {
        match workspace_git_fetch(root) {
            Ok(_) => (true, String::new()),
            Err(error) => (false, error),
        }
    };
    let (ahead, behind) = workspace_git_ahead_behind(root, &upstream);
    let pullable = !upstream.trim().is_empty()
        && operation_clean
        && !dirty
        && fetch_ok
        && behind > 0
        && ahead == 0;
    let reason = if upstream.trim().is_empty() {
        "No upstream branch configured.".to_string()
    } else if !operation_clean {
        format!(
            "Repository is in {} state.",
            operation_state["state"]
                .as_str()
                .unwrap_or("an active operation")
        )
    } else if dirty {
        "Working tree has local changes.".to_string()
    } else if !fetch_ok {
        if fetch_error.trim().is_empty() {
            "Unable to fetch upstream changes.".to_string()
        } else {
            fetch_error.clone()
        }
    } else if ahead > 0 && behind > 0 {
        "Branch has diverged from upstream.".to_string()
    } else if ahead > 0 {
        "Local branch is ahead of upstream.".to_string()
    } else if behind == 0 {
        "Already up to date.".to_string()
    } else {
        format!(
            "Behind upstream by {behind} commit{}.",
            if behind == 1 { "" } else { "s" }
        )
    };

    json!({
        "path": workspace_path_display(root),
        "name": root.file_name().and_then(|value| value.to_str()).unwrap_or("repository"),
        "relativePath": child_relative_path(workspace_root, root).unwrap_or_default(),
        "branch": branch,
        "headSha": workspace_git_head_sha(root),
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
        "dirty": dirty,
        "operationState": operation_state,
        "statusCounts": counts,
        "fetchOk": fetch_ok,
        "fetchError": fetch_error,
        "pullable": pullable,
        "selected": pullable,
        "reason": reason,
    })
}

fn workspace_git_pull_repository_once(root: &Path) -> Value {
    let before_head_sha = workspace_git_head_sha(root);
    let operation_state = workspace_git_operation_state(root);
    if !operation_state["clean"].as_bool().unwrap_or(false) {
        return json!({
            "path": workspace_path_display(root),
            "name": root.file_name().and_then(|value| value.to_str()).unwrap_or("repository"),
            "ok": false,
            "pulled": false,
            "beforeHeadSha": before_head_sha,
            "afterHeadSha": before_head_sha,
            "error": format!(
                "Cannot pull while repository is in {} state.",
                operation_state["state"].as_str().unwrap_or("an active operation")
            ),
            "snapshot": workspace_git_snapshot_for(root),
        });
    }

    let files = workspace_git_status_files(root);
    if !files.is_empty() {
        return json!({
            "path": workspace_path_display(root),
            "name": root.file_name().and_then(|value| value.to_str()).unwrap_or("repository"),
            "ok": false,
            "pulled": false,
            "beforeHeadSha": before_head_sha,
            "afterHeadSha": before_head_sha,
            "error": "Cannot pull with local working tree changes.",
            "snapshot": workspace_git_snapshot_for(root),
        });
    }

    let upstream = workspace_git_upstream(root);
    if upstream.trim().is_empty() {
        return json!({
            "path": workspace_path_display(root),
            "name": root.file_name().and_then(|value| value.to_str()).unwrap_or("repository"),
            "ok": false,
            "pulled": false,
            "beforeHeadSha": before_head_sha,
            "afterHeadSha": before_head_sha,
            "error": "No upstream branch configured.",
            "snapshot": workspace_git_snapshot_for(root),
        });
    }

    if let Err(error) = workspace_git_fetch(root) {
        return json!({
            "path": workspace_path_display(root),
            "name": root.file_name().and_then(|value| value.to_str()).unwrap_or("repository"),
            "ok": false,
            "pulled": false,
            "beforeHeadSha": before_head_sha,
            "afterHeadSha": before_head_sha,
            "error": error,
            "snapshot": workspace_git_snapshot_for(root),
        });
    }

    let (ahead, behind) = workspace_git_ahead_behind(root, &upstream);
    if ahead > 0 {
        return json!({
            "path": workspace_path_display(root),
            "name": root.file_name().and_then(|value| value.to_str()).unwrap_or("repository"),
            "ok": false,
            "pulled": false,
            "beforeHeadSha": before_head_sha,
            "afterHeadSha": before_head_sha,
            "ahead": ahead,
            "behind": behind,
            "error": if behind > 0 {
                "Branch has diverged from upstream."
            } else {
                "Local branch is ahead of upstream."
            },
            "snapshot": workspace_git_snapshot_for(root),
        });
    }

    if behind == 0 {
        return json!({
            "path": workspace_path_display(root),
            "name": root.file_name().and_then(|value| value.to_str()).unwrap_or("repository"),
            "ok": true,
            "pulled": false,
            "alreadyUpToDate": true,
            "beforeHeadSha": before_head_sha,
            "afterHeadSha": before_head_sha,
            "ahead": ahead,
            "behind": behind,
            "output": "Already up to date.",
            "snapshot": workspace_git_snapshot_for(root),
        });
    }

    let pull_capture = match workspace_git_run_noninteractive(
        root,
        &["pull", "--ff-only"],
        Duration::from_secs(120),
    ) {
        Ok(capture) => capture,
        Err(error) => {
            return json!({
                "path": workspace_path_display(root),
                "name": root.file_name().and_then(|value| value.to_str()).unwrap_or("repository"),
                "ok": false,
                "pulled": false,
                "beforeHeadSha": before_head_sha,
                "afterHeadSha": before_head_sha,
                "ahead": ahead,
                "behind": behind,
                "error": error,
                "snapshot": workspace_git_snapshot_for(root),
            });
        }
    };
    let output = workspace_git_limited_output(&pull_capture.stdout, &pull_capture.stderr);
    if pull_capture.exit_code != Some(0) {
        return json!({
            "path": workspace_path_display(root),
            "name": root.file_name().and_then(|value| value.to_str()).unwrap_or("repository"),
            "ok": false,
            "pulled": false,
            "beforeHeadSha": before_head_sha,
            "afterHeadSha": workspace_git_head_sha(root),
            "ahead": ahead,
            "behind": behind,
            "error": if output.trim().is_empty() { "git pull --ff-only failed.".to_string() } else { output.clone() },
            "output": output,
            "snapshot": workspace_git_snapshot_for(root),
        });
    }

    let after_head_sha = workspace_git_head_sha(root);
    json!({
        "path": workspace_path_display(root),
        "name": root.file_name().and_then(|value| value.to_str()).unwrap_or("repository"),
        "ok": true,
        "pulled": after_head_sha != before_head_sha,
        "alreadyUpToDate": after_head_sha == before_head_sha,
        "beforeHeadSha": before_head_sha,
        "afterHeadSha": after_head_sha,
        "ahead": ahead,
        "behind": behind,
        "output": output,
        "snapshot": workspace_git_snapshot_for(root),
    })
}

fn workspace_git_generated_commit_message(root: &Path) -> Value {
    let files = workspace_git_status_files(root);
    if files.is_empty() {
        return json!({
            "message": "",
            "summary": "No changes to commit.",
            "files": [],
        });
    }
    let added = files
        .iter()
        .filter(|file| {
            file["kind"].as_str() == Some("added") || file["kind"].as_str() == Some("untracked")
        })
        .count();
    let deleted = files
        .iter()
        .filter(|file| file["kind"].as_str() == Some("deleted"))
        .count();
    let renamed = files
        .iter()
        .filter(|file| file["kind"].as_str() == Some("renamed"))
        .count();
    let title = if files.len() == 1 {
        let file = &files[0];
        let path = file["path"].as_str().unwrap_or("workspace");
        let leaf = path.rsplit('/').next().unwrap_or(path);
        match file["kind"].as_str().unwrap_or("changed") {
            "added" | "untracked" => format!("Add {leaf}"),
            "deleted" => format!("Remove {leaf}"),
            "renamed" => format!("Rename {leaf}"),
            _ => format!("Update {leaf}"),
        }
    } else if added == files.len() {
        format!("Add {} files", files.len())
    } else if deleted == files.len() {
        format!("Remove {} files", files.len())
    } else if renamed == files.len() {
        format!("Rename {} files", files.len())
    } else {
        format!("Update {} files", files.len())
    };

    let mut body = Vec::new();
    body.push(String::new());
    body.push("Changed files:".to_string());
    for file in files.iter().take(16) {
        let code = file["code"].as_str().unwrap_or("??");
        let path = file["path"].as_str().unwrap_or("");
        if !path.is_empty() {
            body.push(format!("- {code} {path}"));
        }
    }
    if files.len() > 16 {
        body.push(format!("- ... {} more files", files.len() - 16));
    }
    let message = format!("{title}\n{}", body.join("\n"))
        .trim_end()
        .chars()
        .take(4000)
        .collect::<String>();
    json!({
        "message": message,
        "summary": title,
        "files": files,
    })
}

#[tauri::command]
async fn workspace_git_pull_candidates(
    state: State<'_, TerminalState>,
    repo_path: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    refresh: Option<bool>,
) -> Result<Value, String> {
    ensure_app_not_shutting_down("workspace Git pull check")?;
    let workspace_root = resolve_workspace_root_directory(Some(&repo_path))?;
    let force_refresh = refresh.unwrap_or(false);
    let mut topology = if force_refresh {
        terminal_workspace_topology_scan_for_launch(state.inner(), &workspace_root).await
    } else {
        terminal_workspace_topology_cached_scan(
            &state.workspace_topology_cache,
            &workspace_root,
            terminal_now_ms(),
        )
        .await
    };
    if !force_refresh && topology.cache_status == "missing" {
        topology =
            terminal_workspace_topology_scan_for_launch(state.inner(), &workspace_root).await;
    }
    let cache = json!({
        "key": topology.cache_key,
        "status": topology.cache_status,
        "hit": topology.cache_hit,
        "scannedAtMs": topology.scanned_ms,
        "ageMs": terminal_now_ms().saturating_sub(topology.scanned_ms),
    });
    let repos = workspace_git_discovered_repositories(&workspace_root, &topology.mounts);
    let workspace_root_for_worker = workspace_root.clone();
    let repositories = tauri::async_runtime::spawn_blocking(move || {
        repos
            .into_iter()
            .map(|repo| workspace_git_pull_candidate_summary(&repo, &workspace_root_for_worker))
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|error| format!("Unable to join Git pull check worker: {error}"))?;
    let pullable_count = repositories
        .iter()
        .filter(|repo| repo["pullable"].as_bool().unwrap_or(false))
        .count();
    let blocked_count = repositories
        .iter()
        .filter(|repo| {
            repo["behind"].as_u64().unwrap_or(0) > 0 && !repo["pullable"].as_bool().unwrap_or(false)
        })
        .count();
    let repository_count = repositories.len();
    Ok(json!({
        "generatedAtMs": terminal_now_ms(),
        "workspaceId": workspace_id.unwrap_or_default(),
        "workspaceName": workspace_name.unwrap_or_default(),
        "root": workspace_path_display(&workspace_root),
        "repositories": repositories,
        "repositoryCount": repository_count,
        "pullableCount": pullable_count,
        "blockedCount": blocked_count,
        "cache": cache,
    }))
}

#[tauri::command]
async fn workspace_git_pull_repositories(repo_paths: Vec<String>) -> Result<Value, String> {
    ensure_app_not_shutting_down("workspace Git pull")?;
    if repo_paths.is_empty() {
        return Err("Choose at least one Git repository to pull.".to_string());
    }
    if repo_paths.len() > 64 {
        return Err("Too many Git repositories selected for one pull.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut seen = HashSet::new();
        let mut results = Vec::new();
        for repo_path in repo_paths {
            match workspace_git_repo_root(&repo_path) {
                Ok(root) => {
                    let key = workspace_git_repo_key(&root);
                    if !seen.insert(key) {
                        continue;
                    }
                    results.push(workspace_git_pull_repository_once(&root));
                }
                Err(error) => {
                    results.push(json!({
                        "path": repo_path,
                        "name": "repository",
                        "ok": false,
                        "pulled": false,
                        "error": error,
                    }));
                }
            }
        }
        let ok_count = results
            .iter()
            .filter(|result| result["ok"].as_bool().unwrap_or(false))
            .count();
        let pulled_count = results
            .iter()
            .filter(|result| result["pulled"].as_bool().unwrap_or(false))
            .count();
        let result_count = results.len();
        Ok(json!({
            "generatedAtMs": terminal_now_ms(),
            "ok": ok_count == result_count,
            "okCount": ok_count,
            "pulledCount": pulled_count,
            "failedCount": result_count.saturating_sub(ok_count),
            "results": results,
        }))
    })
    .await
    .map_err(|error| format!("Unable to join Git pull worker: {error}"))?
}

#[tauri::command]
async fn workspace_git_snapshot(repo_path: String) -> Result<Value, String> {
    ensure_app_not_shutting_down("workspace Git snapshot")?;
    let root = workspace_git_repo_root(&repo_path)?;
    tauri::async_runtime::spawn_blocking(move || Ok(workspace_git_snapshot_for(&root)))
        .await
        .map_err(|error| format!("Unable to join Git snapshot worker: {error}"))?
}

#[tauri::command]
async fn workspace_git_file_diff(
    repo_path: String,
    file_path: String,
    staged: Option<bool>,
) -> Result<Value, String> {
    ensure_app_not_shutting_down("workspace Git file diff")?;
    let root = workspace_git_repo_root(&repo_path)?;
    let cleaned = clean_workspace_relative_path(&file_path)?;
    let relative_path = workspace_relative_display(&cleaned);
    if relative_path.trim().is_empty() {
        return Err("Git file path is required.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut args = vec![
            "-c".to_string(),
            "core.quotepath=false".to_string(),
            "diff".to_string(),
            "--no-ext-diff".to_string(),
            "--unified=5".to_string(),
        ];
        if staged.unwrap_or(false) {
            args.push("--cached".to_string());
        }
        args.push("--".to_string());
        args.push(relative_path.clone());
        let capture =
            workspace_git_run_owned(&root, args, Duration::from_secs(GIT_DIFF_TIMEOUT_SECS))?;
        ensure_git_success(&capture, "git diff")?;
        let (diff, truncated) = truncate_workspace_diff(capture.stdout);
        Ok(json!({
            "repoPath": workspace_path_display(&root),
            "filePath": relative_path,
            "staged": staged.unwrap_or(false),
            "diff": diff,
            "truncated": truncated,
        }))
    })
    .await
    .map_err(|error| format!("Unable to join Git diff worker: {error}"))?
}

#[tauri::command]
async fn workspace_git_generate_commit_message(repo_path: String) -> Result<Value, String> {
    ensure_app_not_shutting_down("workspace Git commit message")?;
    let root = workspace_git_repo_root(&repo_path)?;
    tauri::async_runtime::spawn_blocking(move || Ok(workspace_git_generated_commit_message(&root)))
        .await
        .map_err(|error| format!("Unable to join Git message worker: {error}"))?
}

#[tauri::command]
async fn workspace_git_commit_and_push(
    repo_path: String,
    message: String,
    push: Option<bool>,
) -> Result<Value, String> {
    ensure_app_not_shutting_down("workspace Git commit")?;
    let root = workspace_git_repo_root(&repo_path)?;
    let push_after_commit = push.unwrap_or(true);
    let commit_message = message
        .replace('\r', "\n")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .chars()
        .take(4000)
        .collect::<String>();
    if commit_message.is_empty() {
        return Err("Commit message is required.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let operation_state = workspace_git_operation_state(&root);
        if !operation_state["clean"].as_bool().unwrap_or(false) {
            return Err(format!(
                "Cannot commit while repository is in {} state.",
                operation_state["state"]
                    .as_str()
                    .unwrap_or("an active operation")
            ));
        }
        let before_files = workspace_git_status_files(&root);
        if before_files.is_empty() {
            return Err("No Git changes to commit.".to_string());
        }
        ensure_workspace_git_identity(&root)?;
        let add_capture = run_git_for_workspace(
            &root,
            &["add", "-A"],
            Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        )?;
        ensure_git_success(&add_capture, "git add -A")?;
        let diff_capture = run_git_for_workspace(
            &root,
            &["diff", "--cached", "--quiet", "--exit-code"],
            Duration::from_secs(GIT_STATUS_TIMEOUT_SECS),
        )?;
        if diff_capture.exit_code == Some(0) {
            return Err("No staged Git changes to commit after git add -A.".to_string());
        }
        if diff_capture.exit_code != Some(1) {
            ensure_git_success(&diff_capture, "git diff --cached --quiet")?;
        }
        let commit_capture = run_git_for_workspace(
            &root,
            &["commit", "-m", commit_message.as_str()],
            Duration::from_secs(GIT_COMMIT_TIMEOUT_SECS),
        )?;
        ensure_git_success(&commit_capture, "git commit")?;
        let commit_sha = workspace_git_head_sha(&root);
        let mut pushed = false;
        let mut push_error = String::new();
        let upstream = workspace_git_upstream(&root);
        if push_after_commit {
            let push_result = if !upstream.trim().is_empty() {
                run_git_for_workspace(&root, &["push"], Duration::from_secs(120))
            } else {
                let has_origin = workspace_git_remotes(&root)
                    .iter()
                    .any(|remote| remote["name"].as_str() == Some("origin"));
                if has_origin {
                    run_git_for_workspace(
                        &root,
                        &["push", "-u", "origin", "HEAD"],
                        Duration::from_secs(120),
                    )
                } else {
                    Err("No upstream branch or origin remote is configured.".to_string())
                }
            };
            match push_result {
                Ok(capture) if capture.exit_code == Some(0) => {
                    pushed = true;
                }
                Ok(capture) => {
                    push_error = command_output_text(&capture.stdout, &capture.stderr);
                    if push_error.is_empty() {
                        push_error = "git push failed.".to_string();
                    }
                }
                Err(error) => {
                    push_error = error;
                }
            }
        }
        Ok(json!({
            "repoPath": workspace_path_display(&root),
            "commitSha": commit_sha,
            "committed": true,
            "pushed": pushed,
            "pushError": push_error,
            "snapshot": workspace_git_snapshot_for(&root),
        }))
    })
    .await
    .map_err(|error| format!("Unable to join Git commit worker: {error}"))?
}

fn terminal_git_root_for_coordination_target(root: &Path) -> Option<PathBuf> {
    let top_level = workspace_git_top_level(root)?;
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    if root.starts_with(&top_level) {
        Some(top_level)
    } else {
        None
    }
}

#[cfg(test)]
fn terminal_coordination_launch_target(
    workspace_root: &Path,
    requested_project_root: Option<&str>,
    requested_mount_id: Option<&str>,
    _selected_workspace_was_empty_at_selection: bool,
    session_mode: TerminalSessionMode,
) -> Result<TerminalCoordinationLaunchTarget, String> {
    terminal_coordination_launch_target_with_mounts(
        workspace_root,
        None,
        requested_project_root,
        requested_mount_id,
        _selected_workspace_was_empty_at_selection,
        session_mode,
    )
}

fn terminal_coordination_launch_target_with_mounts(
    workspace_root: &Path,
    topology_mounts: Option<&[WorkspaceProjectMount]>,
    requested_project_root: Option<&str>,
    requested_mount_id: Option<&str>,
    _selected_workspace_was_empty_at_selection: bool,
    session_mode: TerminalSessionMode,
) -> Result<TerminalCoordinationLaunchTarget, String> {
    let workspace_root_canonical = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let owned_mounts;
    let mounts = if let Some(mounts) = topology_mounts {
        mounts
    } else {
        owned_mounts = workspace_project_mounts(&workspace_root_canonical);
        owned_mounts.as_slice()
    };
    let requested_target = requested_project_root
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
        || requested_mount_id
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
    let mut target_root = match session_mode {
        TerminalSessionMode::ManagedPatch => workspace_coordination_root_for_terminal_with_mounts(
            workspace_root,
            &workspace_root_canonical,
            mounts,
            requested_project_root,
            requested_mount_id,
        )?,
        TerminalSessionMode::General => {
            if !requested_target {
                let selected_root =
                    workspace_selected_root_mount(&workspace_root_canonical, mounts);
                let project_count = mounts
                    .iter()
                    .filter(|mount| mount.mount_kind == "project")
                    .count();
                if selected_root.is_none() && project_count > 1 {
                    return Ok(TerminalCoordinationLaunchTarget {
                        root: workspace_root.to_path_buf(),
                        enforcement_mode: "activity_only",
                        requires_git_bootstrap: false,
                        allows_git_init: false,
                    });
                }
            }
            workspace_coordination_root_for_terminal_with_mounts(
                workspace_root,
                &workspace_root_canonical,
                mounts,
                requested_project_root,
                requested_mount_id,
            )?
        }
        TerminalSessionMode::DirectEdit => {
            let coordination_root = workspace_coordination_root_for_terminal_with_mounts(
                workspace_root,
                &workspace_root_canonical,
                mounts,
                requested_project_root,
                requested_mount_id,
            )?;
            if terminal_git_root_for_coordination_target(&coordination_root).is_some() {
                coordination_root
            } else {
                workspace_direct_edit_root_for_terminal_with_mounts(
                    workspace_root,
                    &workspace_root_canonical,
                    mounts,
                    requested_project_root,
                    requested_mount_id,
                )?
            }
        }
        TerminalSessionMode::Activity
        | TerminalSessionMode::RemoteOps
        | TerminalSessionMode::Free => workspace_root.to_path_buf(),
    };

    if matches!(
        session_mode,
        TerminalSessionMode::ManagedPatch | TerminalSessionMode::General
    ) {
        if let Some(git_root) = terminal_git_root_for_coordination_target(&target_root) {
            target_root = git_root;
        }
    }

    let has_git = terminal_git_root_for_coordination_target(&target_root).is_some();
    let has_requested_project_root = requested_project_root
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    let has_requested_mount_id = requested_mount_id
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    let selected_workspace_empty_git_bootstrap = !has_git
        && !has_requested_project_root
        && !has_requested_mount_id
        && terminal_path_key_after_canonicalize(workspace_root)
            == terminal_path_key_after_canonicalize(&target_root)
        && workspace_directory_is_empty_for_git_bootstrap(&target_root)
        && matches!(
            session_mode,
            TerminalSessionMode::ManagedPatch | TerminalSessionMode::General
        );
    let has_git_or_selected_empty_bootstrap = has_git || selected_workspace_empty_git_bootstrap;
    let enforcement_mode = match session_mode {
        TerminalSessionMode::ManagedPatch if has_git_or_selected_empty_bootstrap => {
            "worktree_required"
        }
        TerminalSessionMode::ManagedPatch => {
            return Err(
                "Managed patch mode requires an existing Git repo. Diff Forge only initializes Git automatically when the selected workspace folder was empty."
                    .to_string(),
            );
        }
        TerminalSessionMode::General if has_git_or_selected_empty_bootstrap => "worktree_required",
        TerminalSessionMode::General => "bounded_direct_edit",
        TerminalSessionMode::DirectEdit if has_git => "worktree_required",
        TerminalSessionMode::DirectEdit => "bounded_direct_edit",
        TerminalSessionMode::Activity => "activity_only",
        TerminalSessionMode::RemoteOps => "remote_unmanaged",
        TerminalSessionMode::Free => "external_unmanaged",
    };

    Ok(TerminalCoordinationLaunchTarget {
        root: target_root,
        enforcement_mode,
        requires_git_bootstrap: if matches!(session_mode, TerminalSessionMode::General) {
            selected_workspace_empty_git_bootstrap
        } else {
            enforcement_mode == "worktree_required"
        },
        allows_git_init: selected_workspace_empty_git_bootstrap,
    })
}

fn terminal_context_requires_isolated_worktree(
    context: &crate::coordination::models::TerminalCoordinationContext,
) -> bool {
    context.enforcement_mode == "worktree_required"
}

fn terminal_process_working_directory_for_context(
    context: &crate::coordination::models::TerminalCoordinationContext,
    discovery_working_directory: &Path,
) -> PathBuf {
    if terminal_context_requires_isolated_worktree(context) {
        if context.repo_path.trim().is_empty() {
            workspace_path_for_process(discovery_working_directory)
        } else {
            workspace_path_for_process(Path::new(context.repo_path.trim()))
        }
    } else {
        workspace_path_for_process(discovery_working_directory)
    }
}

fn terminal_session_mode_from_context(
    context: &crate::coordination::models::TerminalCoordinationContext,
    fallback: TerminalSessionMode,
) -> TerminalSessionMode {
    TerminalSessionMode::from_request(Some(context.session_mode()), fallback).unwrap_or(fallback)
}

fn terminal_path_key_after_canonicalize(path: &Path) -> String {
    path.canonicalize()
        .map(|path| normalized_path_key(&path))
        .unwrap_or_else(|_| normalized_path_key(path))
}

fn terminal_is_slot_worktree_path(path: &Path, worktrees_root: &Path, slot_key: &str) -> bool {
    let slot_key = slot_key.trim();
    if slot_key.is_empty() {
        return false;
    }
    let relative = path.strip_prefix(worktrees_root).ok();
    let Some(slot_segment) =
        relative
            .and_then(|path| path.components().next())
            .and_then(|component| match component {
                std::path::Component::Normal(value) => Some(value.to_string_lossy().to_string()),
                _ => None,
            })
    else {
        return false;
    };

    slot_segment == slot_key || slot_segment.starts_with(&format!("{slot_key}-"))
}

fn validate_terminal_isolated_worktree_context(
    context: &crate::coordination::models::TerminalCoordinationContext,
    label: &str,
) -> Result<(), String> {
    if !terminal_context_requires_isolated_worktree(context) {
        return Ok(());
    }

    let has_worktree_id = context
        .worktree_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let has_worktree_path = context
        .worktree_path
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let write_root = PathBuf::from(&context.write_root);
    let worktree_path = context
        .worktree_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from);
    let repo_root = PathBuf::from(&context.repo_path);
    let worktrees_root = repo_root.join(".agents").join("worktrees");
    let write_root_key = terminal_path_key_after_canonicalize(&write_root);
    let repo_root_key = terminal_path_key_after_canonicalize(&repo_root);
    let worktrees_root_canonical = worktrees_root
        .canonicalize()
        .unwrap_or_else(|_| worktrees_root.clone());
    let write_root_canonical = write_root
        .canonicalize()
        .unwrap_or_else(|_| write_root.clone());
    let write_root_matches_repo_root = write_root_key == repo_root_key;
    let write_root_under_worktrees = write_root
        .canonicalize()
        .ok()
        .zip(worktrees_root.canonicalize().ok())
        .map(|(write_root, worktrees_root)| write_root.starts_with(worktrees_root))
        .unwrap_or_else(|| write_root.starts_with(&worktrees_root));
    let write_root_matches_worktree_path = worktree_path.as_ref().is_some_and(|worktree_path| {
        write_root_key == terminal_path_key_after_canonicalize(worktree_path)
    });
    let slot_key = context
        .slot_key
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let write_root_matches_slot = slot_key.is_some_and(|slot_key| {
        terminal_is_slot_worktree_path(&write_root_canonical, &worktrees_root_canonical, slot_key)
    });

    if has_worktree_id
        && has_worktree_path
        && !write_root_matches_repo_root
        && write_root_under_worktrees
        && write_root_matches_worktree_path
        && write_root_matches_slot
    {
        return Ok(());
    }

    let reason = if !has_worktree_id {
        "coordination did not return a worktree id"
    } else if write_root_matches_repo_root {
        "coordination write root points at the repository root"
    } else if !write_root_under_worktrees {
        "coordination write root is outside .agents/worktrees"
    } else if !has_worktree_path {
        "coordination did not return a worktree path"
    } else if !write_root_matches_worktree_path {
        "coordination write root does not match the assigned worktree path"
    } else if slot_key.is_none() {
        "coordination did not return a slot key"
    } else if !write_root_matches_slot {
        "coordination write root points at another slot's worktree"
    } else {
        "coordination returned an invalid isolated worktree context"
    };
    Err(format!("Terminal isolation failed for {label}: {reason}."))
}

async fn prepare_terminal_coordination_launch(
    pty_id: String,
    terminal_launch_epoch: String,
    working_directory: PathBuf,
    discovery_working_directory: PathBuf,
    kind: String,
    provider_for_coordination: Option<String>,
    label: String,
    terminal_slot_key: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
    enforcement_mode: &'static str,
) -> Result<
    (
        crate::coordination::models::TerminalCoordinationContext,
        Value,
        PathBuf,
    ),
    String,
> {
    let launch_pty_id = pty_id.clone();
    let task_result = tauri::async_runtime::spawn_blocking(move || {
        let (coordination_kernel, _) =
            match crate::coordination::CoordinationKernel::open_for_terminal_launch(
                &working_directory,
                None,
            ) {
                Ok(result) => result,
                Err(error) => {
                    return Err(format!(
                        "Unable to open terminal coordination kernel: {error}"
                    ));
                }
            };

        if let Err(error) = crate::coordination::mcp::ensure_shared_daemon_for_paths(
            &coordination_kernel.paths.repo_path,
            &coordination_kernel.paths.db_path,
        ) {
            return Err(format!(
                "Unable to start shared coordination MCP daemon: {error}"
            ));
        }

        let launch_provider_id = provider_for_coordination
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| match kind.as_str() {
                "console" => "codex".to_string(),
                _ => kind.clone(),
            });
        let agent_kind = launch_provider_id.as_str();
        let agent_name = label.clone();
        match coordination_kernel.prepare_terminal_context_for_slot(
            &agent_name,
            agent_kind,
            &terminal_slot_key,
            Some(&launch_pty_id),
            workspace_id.as_deref(),
            workspace_name.as_deref(),
            None,
            None,
            None,
            Some(&terminal_launch_epoch),
            Some(enforcement_mode),
        ) {
            Ok(context) => {
                if let Err(error) = validate_terminal_isolated_worktree_context(&context, &label) {
                    let coordination = terminal_coordination_session_from_context(&context);
                    interrupt_terminal_coordination_session(
                        &coordination,
                        "coding_agent_requires_isolated_worktree",
                    );
                    return Err(error);
                }

                let launch_worktree = if context.worktree_id.is_some() {
                    let branch_name = context
                        .slot_key
                        .as_ref()
                        .map(|slot_key| format!("agent/{slot_key}"));
                    json!({
                        "agentId": context.agent_id.clone(),
                        "branchName": branch_name.clone(),
                        "id": context.worktree_id.clone(),
                        "path": context.write_root.clone(),
                        "sessionId": context.session_id.clone(),
                        "slotKey": context.slot_key.clone(),
                    })
                } else {
                    json!({
                        "agentId": context.agent_id.clone(),
                        "branchName": Value::Null,
                        "id": Value::Null,
                        "path": context.write_root.clone(),
                        "sessionId": context.session_id.clone(),
                        "slotKey": context.slot_key.clone(),
                    })
                };
                let process_working_directory = terminal_process_working_directory_for_context(
                    &context,
                    &discovery_working_directory,
                );
                Ok((context, launch_worktree, process_working_directory))
            }
            Err(error) => Err(format!(
                "Unable to prepare terminal coordination MCP/worktree: {error}"
            )),
        }
    })
    .await
    .map_err(|error| format!("Terminal coordination worker failed before completion: {error}"))?;
    task_result
}

fn terminal_output_transport_key(pane_id: &str, instance_id: u64) -> String {
    format!("{pane_id}:{instance_id}")
}

fn send_terminal_output_transport_frame(
    subscribers: &Arc<StdMutex<HashMap<String, Vec<TerminalOutputTransportSubscriber>>>>,
    pane_id: &str,
    instance_id: u64,
    chunk: &[u8],
) -> bool {
    if chunk.is_empty() {
        return true;
    }

    let key = terminal_output_transport_key(pane_id, instance_id);
    let mut sent = false;
    let Ok(mut subscribers_by_terminal) = subscribers.lock() else {
        return false;
    };
    let Some(terminal_subscribers) = subscribers_by_terminal.get_mut(&key) else {
        return false;
    };

    terminal_subscribers.retain(|subscriber| {
        let ok = subscriber.sender.send(chunk.to_vec()).is_ok();
        sent = sent || ok;
        ok
    });
    if terminal_subscribers.is_empty() {
        subscribers_by_terminal.remove(&key);
    }

    sent
}

fn spawn_terminal_reader(
    app: AppHandle,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    cleanup_tracker: Arc<TerminalCleanupTracker>,
    output_subscribers: Arc<StdMutex<HashMap<String, Vec<TerminalOutputTransportSubscriber>>>>,
    pane_id: String,
    instance_id: u64,
    headless_output: Arc<StdMutex<TerminalHeadlessOutputBuffer>>,
    cloud_mcp_state: CloudMcpState,
    output_channel: Channel<InvokeResponseBody>,
    prefer_output_transport: bool,
    cloud_output_observer_enabled: bool,
    mut reader: Box<dyn Read + Send>,
) {
    fn send_terminal_output_frame(
        app: &AppHandle,
        chunk: Vec<u8>,
        pane_id: &str,
        instance_id: u64,
        cloud_mcp_state: &CloudMcpState,
        output_channel: &Channel<InvokeResponseBody>,
        output_subscribers: &Arc<StdMutex<HashMap<String, Vec<TerminalOutputTransportSubscriber>>>>,
        prefer_output_transport: bool,
        cloud_output_observer_enabled: bool,
    ) -> (bool, f64, f64) {
        if chunk.is_empty() {
            return (true, 0.0, 0.0);
        }

        let observe_started_at = Instant::now();
        if cloud_output_observer_enabled {
            let observer_app = app.clone();
            let observer_state = cloud_mcp_state.clone();
            let observer_pane_id = pane_id.to_string();
            let observer_chunk = chunk.clone();
            tauri::async_runtime::spawn(async move {
                cloud_mcp_observe_terminal_output(
                    observer_app,
                    observer_state,
                    &observer_pane_id,
                    instance_id,
                    &observer_chunk,
                )
                .await;
            });
        }
        let observe_schedule_ms = terminal_diagnostic_elapsed_ms(observe_started_at);

        let send_started_at = Instant::now();
        let transport_sent =
            send_terminal_output_transport_frame(output_subscribers, pane_id, instance_id, &chunk);
        let channel_sent = if prefer_output_transport && transport_sent {
            true
        } else {
            output_channel.send(InvokeResponseBody::Raw(chunk)).is_ok()
        };
        let sent = transport_sent || channel_sent;
        (
            sent,
            terminal_diagnostic_elapsed_ms(send_started_at),
            observe_schedule_ms,
        )
    }

    let reader_pane_id = pane_id.clone();

    log_terminal_crash_forensics_event(
        "backend.terminal_reader.spawn",
        json!({
            "instance_id": instance_id,
            "pane_id": clean_terminal_diagnostic_log_text(&reader_pane_id),
        }),
    );
    thread::spawn(move || {
        log_terminal_crash_forensics_event(
            "backend.terminal_reader.begin",
            json!({
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(&reader_pane_id),
            }),
        );
        let (output_frame_tx, output_frame_rx) =
            std::sync::mpsc::sync_channel::<Vec<u8>>(TERMINAL_OUTPUT_COALESCE_QUEUE_CAPACITY);
        let output_channel_closed = Arc::new(AtomicBool::new(false));
        let output_sender_closed = Arc::clone(&output_channel_closed);
        let output_app = app.clone();
        let output_cloud_mcp_state = cloud_mcp_state.clone();
        let output_pane_id = reader_pane_id.clone();
        let output_subscribers = Arc::clone(&output_subscribers);
        let output_sender_handle = thread::spawn(move || {
            let coalesce_window = Duration::from_millis(TERMINAL_OUTPUT_COALESCE_WINDOW_MS);
            let mut pending = Vec::with_capacity(TERMINAL_OUTPUT_COALESCE_MAX_BYTES);
            let mut pending_started_at: Option<Instant> = None;
            let mut pending_source_chunks: u64 = 0;
            let mut stats_started_at = Instant::now();
            let mut stats_frames: u64 = 0;
            let mut stats_source_chunks: u64 = 0;
            let mut stats_bytes: u64 = 0;
            let mut stats_slow_sends: u64 = 0;
            let mut stats_total_send_ms = 0.0f64;
            let mut stats_max_send_ms = 0.0f64;
            let mut stats_slow_observer_schedules: u64 = 0;
            let mut stats_total_observer_schedule_ms = 0.0f64;
            let mut stats_max_observer_schedule_ms = 0.0f64;
            let mut forensics_started_at = Instant::now();
            let mut forensics_frames: u64 = 0;
            let mut forensics_source_chunks: u64 = 0;
            let mut forensics_bytes: u64 = 0;
            let mut forensics_total_frames: u64 = 0;
            let mut forensics_total_source_chunks: u64 = 0;
            let mut forensics_total_bytes: u64 = 0;

            let exit_reason = loop {
                let mut input_closed_after_flush = false;
                let receive_result = if pending.is_empty() {
                    output_frame_rx
                        .recv()
                        .map(Some)
                        .map_err(|_| std::sync::mpsc::RecvTimeoutError::Disconnected)
                } else {
                    let elapsed = pending_started_at
                        .map(|started_at| started_at.elapsed())
                        .unwrap_or_default();
                    let remaining = coalesce_window
                        .checked_sub(elapsed)
                        .unwrap_or_else(|| Duration::from_millis(0));
                    if remaining.as_millis() == 0 {
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout)
                    } else {
                        output_frame_rx.recv_timeout(remaining).map(Some)
                    }
                };

                match receive_result {
                    Ok(Some(chunk)) => {
                        if chunk.is_empty() {
                            continue;
                        }
                        if pending.is_empty() {
                            pending_started_at = Some(Instant::now());
                        }
                        pending_source_chunks += 1;
                        pending.extend_from_slice(&chunk);
                        if pending.len() < TERMINAL_OUTPUT_COALESCE_MAX_BYTES {
                            continue;
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        if pending.is_empty() {
                            continue;
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        if pending.is_empty() {
                            break "input_closed";
                        }
                        input_closed_after_flush = true;
                    }
                    Ok(None) => continue,
                }

                let frame_started_at = pending_started_at.unwrap_or_else(Instant::now);
                let frame = std::mem::replace(
                    &mut pending,
                    Vec::with_capacity(TERMINAL_OUTPUT_COALESCE_MAX_BYTES),
                );
                let source_chunks = pending_source_chunks;
                let frame_bytes = frame.len();
                pending_started_at = None;
                pending_source_chunks = 0;

                let (sent, send_ms, observer_schedule_ms) = send_terminal_output_frame(
                    &output_app,
                    frame,
                    &output_pane_id,
                    instance_id,
                    &output_cloud_mcp_state,
                    &output_channel,
                    &output_subscribers,
                    prefer_output_transport,
                    cloud_output_observer_enabled,
                );
                let coalesced_ms = terminal_diagnostic_elapsed_ms(frame_started_at);
                forensics_frames += 1;
                forensics_source_chunks += source_chunks;
                forensics_bytes += frame_bytes as u64;
                forensics_total_frames += 1;
                forensics_total_source_chunks += source_chunks;
                forensics_total_bytes += frame_bytes as u64;
                if terminal_diagnostics_enabled_for_app(&output_app)
                    && forensics_started_at.elapsed() >= Duration::from_secs(2)
                {
                    log_terminal_crash_forensics_event(
                        "backend.terminal_reader.output_window",
                        json!({
                            "bytes": forensics_bytes,
                            "coalesce_window_ms": TERMINAL_OUTPUT_COALESCE_WINDOW_MS,
                            "elapsed_ms": terminal_diagnostic_elapsed_ms(forensics_started_at),
                            "frames": forensics_frames,
                            "instance_id": instance_id,
                            "last_coalesced_ms": coalesced_ms,
                            "last_observer_schedule_ms": observer_schedule_ms,
                            "last_send_ms": send_ms,
                            "pane_id": clean_terminal_diagnostic_log_text(&output_pane_id),
                            "source_chunks": forensics_source_chunks,
                            "total_bytes": forensics_total_bytes,
                            "total_frames": forensics_total_frames,
                            "total_source_chunks": forensics_total_source_chunks,
                        }),
                    );
                    forensics_started_at = Instant::now();
                    forensics_frames = 0;
                    forensics_source_chunks = 0;
                    forensics_bytes = 0;
                }
                if terminal_diagnostics_enabled_for_app(&output_app) {
                    stats_frames += 1;
                    stats_source_chunks += source_chunks;
                    stats_bytes += frame_bytes as u64;
                    stats_total_send_ms += send_ms;
                    stats_max_send_ms = stats_max_send_ms.max(send_ms);
                    stats_total_observer_schedule_ms += observer_schedule_ms;
                    stats_max_observer_schedule_ms =
                        stats_max_observer_schedule_ms.max(observer_schedule_ms);
                    if send_ms >= TERMINAL_DIAGNOSTIC_SLOW_MS {
                        stats_slow_sends += 1;
                        log_terminal_diagnostic_event(
                            &output_app,
                            "backend.output_channel_send.slow",
                            json!({
                                "bytes": frame_bytes,
                                "elapsed_ms": send_ms,
                                "instance_id": instance_id,
                                "pane_id": clean_terminal_diagnostic_log_text(&output_pane_id),
                                "source_chunks": source_chunks,
                            }),
                        );
                    }
                    if observer_schedule_ms >= TERMINAL_DIAGNOSTIC_SLOW_MS {
                        stats_slow_observer_schedules += 1;
                        log_terminal_diagnostic_event(
                            &output_app,
                            "backend.output_observer_schedule.slow",
                            json!({
                                "bytes": frame_bytes,
                                "elapsed_ms": observer_schedule_ms,
                                "instance_id": instance_id,
                                "pane_id": clean_terminal_diagnostic_log_text(&output_pane_id),
                                "source_chunks": source_chunks,
                            }),
                        );
                    }

                    if stats_started_at.elapsed() >= Duration::from_secs(1) {
                        log_terminal_diagnostic_event(
                            &output_app,
                            "backend.output_window",
                            json!({
                                "bytes": stats_bytes,
                                "elapsed_ms": terminal_diagnostic_elapsed_ms(stats_started_at),
                                "frames": stats_frames,
                                "instance_id": instance_id,
                                "max_observer_schedule_ms": stats_max_observer_schedule_ms,
                                "max_send_ms": stats_max_send_ms,
                                "pane_id": clean_terminal_diagnostic_log_text(&output_pane_id),
                                "slow_observer_schedules": stats_slow_observer_schedules,
                                "slow_sends": stats_slow_sends,
                                "source_chunks": stats_source_chunks,
                                "total_observer_schedule_ms": stats_total_observer_schedule_ms,
                                "total_send_ms": stats_total_send_ms,
                            }),
                        );
                        stats_started_at = Instant::now();
                        stats_frames = 0;
                        stats_source_chunks = 0;
                        stats_bytes = 0;
                        stats_slow_sends = 0;
                        stats_total_send_ms = 0.0;
                        stats_max_send_ms = 0.0;
                        stats_slow_observer_schedules = 0;
                        stats_total_observer_schedule_ms = 0.0;
                        stats_max_observer_schedule_ms = 0.0;
                    }
                }

                if !sent {
                    output_sender_closed.store(true, Ordering::SeqCst);
                    log_terminal_crash_forensics_event(
                        "backend.terminal_reader.output_channel_closed",
                        json!({
                            "bytes": frame_bytes,
                            "frames": forensics_total_frames,
                            "instance_id": instance_id,
                            "pane_id": clean_terminal_diagnostic_log_text(&output_pane_id),
                            "source_chunks": source_chunks,
                            "total_bytes": forensics_total_bytes,
                            "total_source_chunks": forensics_total_source_chunks,
                        }),
                    );
                    break "output_channel_closed";
                }

                if input_closed_after_flush {
                    break "input_closed";
                }
            };

            log_terminal_crash_forensics_event(
                "backend.terminal_reader.output_sender_exit",
                json!({
                    "exit_reason": exit_reason,
                    "instance_id": instance_id,
                    "pane_id": clean_terminal_diagnostic_log_text(&output_pane_id),
                    "trailing_window_bytes": forensics_bytes,
                    "trailing_window_frames": forensics_frames,
                    "trailing_window_source_chunks": forensics_source_chunks,
                    "total_bytes": forensics_total_bytes,
                    "total_frames": forensics_total_frames,
                    "total_source_chunks": forensics_total_source_chunks,
                }),
            );
        });

        let mut buffer = [0u8; TERMINAL_OUTPUT_READ_BUFFER_BYTES];
        let mut forensics_started_at = Instant::now();
        let mut forensics_chunks: u64 = 0;
        let mut forensics_bytes: u64 = 0;
        let mut forensics_total_chunks: u64 = 0;
        let mut forensics_total_bytes: u64 = 0;
        let exit_reason = loop {
            if output_channel_closed.load(Ordering::SeqCst) {
                break "output_channel_closed";
            }

            match reader.read(&mut buffer) {
                Ok(0) => {
                    log_terminal_crash_forensics_event(
                        "backend.terminal_reader.eof",
                        json!({
                            "instance_id": instance_id,
                            "pane_id": clean_terminal_diagnostic_log_text(&reader_pane_id),
                            "total_bytes": forensics_total_bytes,
                            "total_chunks": forensics_total_chunks,
                        }),
                    );
                    break "eof";
                }
                Ok(bytes_read) => {
                    let chunk = &buffer[..bytes_read];
                    if let Ok(mut headless_output) = headless_output.lock() {
                        headless_output.append(chunk);
                    }

                    forensics_chunks += 1;
                    forensics_bytes += bytes_read as u64;
                    forensics_total_chunks += 1;
                    forensics_total_bytes += bytes_read as u64;
                    if terminal_diagnostics_enabled_for_app(&app)
                        && forensics_started_at.elapsed() >= Duration::from_secs(2)
                    {
                        log_terminal_crash_forensics_event(
                            "backend.terminal_reader.read_window",
                            json!({
                                "bytes": forensics_bytes,
                                "chunks": forensics_chunks,
                                "elapsed_ms": terminal_diagnostic_elapsed_ms(forensics_started_at),
                                "instance_id": instance_id,
                                "pane_id": clean_terminal_diagnostic_log_text(&reader_pane_id),
                                "total_bytes": forensics_total_bytes,
                                "total_chunks": forensics_total_chunks,
                            }),
                        );
                        forensics_started_at = Instant::now();
                        forensics_chunks = 0;
                        forensics_bytes = 0;
                    }

                    if output_frame_tx.send(chunk.to_vec()).is_err() {
                        log_terminal_crash_forensics_event(
                            "backend.terminal_reader.output_sender_closed",
                            json!({
                                "bytes": bytes_read,
                                "instance_id": instance_id,
                                "pane_id": clean_terminal_diagnostic_log_text(&reader_pane_id),
                                "total_bytes": forensics_total_bytes,
                                "total_chunks": forensics_total_chunks,
                            }),
                        );
                        break "output_sender_closed";
                    }

                    if output_channel_closed.load(Ordering::SeqCst) {
                        break "output_channel_closed";
                    }
                }
                Err(error) => {
                    log_terminal_crash_forensics_event(
                        "backend.terminal_reader.read_error",
                        json!({
                            "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                            "instance_id": instance_id,
                            "pane_id": clean_terminal_diagnostic_log_text(&reader_pane_id),
                            "total_bytes": forensics_total_bytes,
                            "total_chunks": forensics_total_chunks,
                        }),
                    );
                    break "read_error";
                }
            }
        };
        drop(output_frame_tx);
        let _ = output_sender_handle.join();
        log_terminal_crash_forensics_event(
            "backend.terminal_reader.exit",
            json!({
                "exit_reason": exit_reason,
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(&reader_pane_id),
                "trailing_window_bytes": forensics_bytes,
                "trailing_window_chunks": forensics_chunks,
                "total_bytes": forensics_total_bytes,
                "total_chunks": forensics_total_chunks,
            }),
        );

        let cleanup_app = app.clone();
        let cleanup_terminals = Arc::clone(&terminals);
        let cleanup_tracker = Arc::clone(&cleanup_tracker);
        let cleanup_state = cloud_mcp_state.clone();
        let cleanup_pane_id = reader_pane_id.clone();
        tauri::async_runtime::spawn(async move {
            if let Some(instance) = remove_terminal_instance_if_current(
                &cleanup_terminals,
                &cleanup_pane_id,
                instance_id,
            )
            .await
            {
                let notify_state = cleanup_state.clone();
                let notify_pane_id = cleanup_pane_id.clone();
                let notify_context = TerminalCloudMcpCloseContext::from_instance(&instance);
                let notify_task = tauri::async_runtime::spawn(async move {
                    cloud_mcp_mark_terminal_closed(
                        &notify_state,
                        &notify_pane_id,
                        instance_id,
                        &notify_context,
                        "reader_exit",
                    )
                    .await;
                });
                let _ = tokio::time::timeout(Duration::from_millis(2_000), notify_task).await;
                cleanup_terminal_instance_async(
                    instance,
                    false,
                    "reader_exit",
                    false,
                    Some(cleanup_tracker),
                );
            }

            let _ = cleanup_app.emit(
                "forge-terminal-exit",
                TerminalExitPayload {
                    pane_id: cleanup_pane_id,
                    instance_id,
                    exit_code: None,
                    exited_at_ms: terminal_now_ms(),
                },
            );
        });
    });
}

async fn remove_terminal_parked_prompts_for_close(
    state: &TerminalState,
    pane_id: &str,
    instance_id: u64,
    reason: &str,
) -> usize {
    let removed = {
        let mut parked = state.parked_prompts.write().await;
        let matching_keys = parked
            .iter()
            .filter_map(|(key, value)| {
                (value.pane_id == pane_id && value.instance_id == instance_id).then(|| key.clone())
            })
            .collect::<Vec<_>>();
        let count = matching_keys.len();
        for key in matching_keys {
            parked.remove(&key);
        }
        count
    };

    if removed > 0 {
        log_terminal_crash_forensics_event(
            "backend.terminal_parked_prompts.preserved_on_close",
            json!({
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "reason": reason,
                "removed_from_memory": removed,
                "resume_policy": "kernel_task_preserved_for_recovery",
            }),
        );
    }

    removed
}

async fn close_terminal_session(
    state: &TerminalState,
    cloud_mcp_state: Option<&CloudMcpState>,
    pane_id: &str,
    instance_id: Option<u64>,
    preserve_coordination_session: bool,
    wait_for_cleanup: bool,
) -> Result<bool, String> {
    validate_terminal_pane_id(pane_id)?;
    log_terminal_crash_forensics_event(
        "backend.terminal_close.begin",
        json!({
            "expected_instance_id": instance_id,
            "pane_id": clean_terminal_diagnostic_log_text(pane_id),
            "preserve_coordination_session": preserve_coordination_session,
            "wait_for_cleanup": wait_for_cleanup,
        }),
    );

    let instance = {
        let mut terminals = state.terminals.write().await;

        if let Some(expected_id) = instance_id {
            let is_current = terminals
                .get(pane_id)
                .map(|instance| instance.id == expected_id)
                .unwrap_or(false);

            if !is_current {
                log_terminal_crash_forensics_event(
                    "backend.terminal_close.skip",
                    json!({
                        "expected_instance_id": expected_id,
                        "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                        "reason": "instance_mismatch_or_missing",
                    }),
                );
                return Ok(false);
            }
        }

        terminals.remove(pane_id)
    };

    if let Some(instance) = instance {
        let cleanup_instance_id = instance.id;
        remove_terminal_parked_prompts_for_close(
            state,
            pane_id,
            cleanup_instance_id,
            "terminal_close",
        )
        .await;
        log_terminal_crash_forensics_event(
            "backend.terminal_close.removed",
            json!({
                "instance_id": cleanup_instance_id,
                "metadata": terminal_metadata_forensics_json(&instance.metadata),
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
            }),
        );
        if let Some(cloud_mcp_state) = cloud_mcp_state {
            let notify_state = cloud_mcp_state.clone();
            let notify_context = TerminalCloudMcpCloseContext::from_instance(&instance);
            let notify_pane_id = pane_id.to_string();
            let notify_task = tauri::async_runtime::spawn(async move {
                cloud_mcp_mark_terminal_closed(
                    &notify_state,
                    &notify_pane_id,
                    cleanup_instance_id,
                    &notify_context,
                    "terminal_close",
                )
                .await;
            });
            if wait_for_cleanup {
                let _ = tokio::time::timeout(Duration::from_millis(2_000), notify_task).await;
            }
        }
        let cleanup_tracker = Arc::clone(&state.cleanup_tracker);
        let cleanup_task = tauri::async_runtime::spawn_blocking(move || {
            let _cleanup_guard = cleanup_tracker.begin("terminal_close", Some(cleanup_instance_id));
            let coordination_cleanup_mode = if preserve_coordination_session {
                TerminalCoordinationCleanupMode::Preserve
            } else {
                TerminalCoordinationCleanupMode::InterruptAfterProcess
            };
            cleanup_terminal_instance_with_context(
                instance,
                true,
                "terminal_close",
                coordination_cleanup_mode,
            );
        });
        if !wait_for_cleanup {
            let cleanup_pane_id = pane_id.to_string();
            tauri::async_runtime::spawn(async move {
                let cleanup_wait_result = tokio::time::timeout(
                    Duration::from_millis(TERMINAL_CLOSE_COMMAND_WAIT_MS),
                    cleanup_task,
                )
                .await;
                let (cleanup_joined, cleanup_timed_out, cleanup_join_error) =
                    match cleanup_wait_result {
                        Ok(Ok(())) => (true, false, None),
                        Ok(Err(error)) => (
                            false,
                            false,
                            Some(clean_terminal_telemetry_text(&error.to_string())),
                        ),
                        Err(_) => (false, true, None),
                    };
                log_terminal_crash_forensics_event(
                    "backend.terminal_close.cleanup_wait.done",
                    json!({
                        "cleanup_join_error": cleanup_join_error.as_deref(),
                        "cleanup_joined": cleanup_joined,
                        "cleanup_timed_out": cleanup_timed_out,
                        "instance_id": cleanup_instance_id,
                        "pane_id": clean_terminal_diagnostic_log_text(&cleanup_pane_id),
                        "wait_for_cleanup": false,
                    }),
                );
            });
            log_terminal_crash_forensics_event(
                "backend.terminal_close.done",
                json!({
                    "cleanup_joined": false,
                    "instance_id": cleanup_instance_id,
                    "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                    "wait_for_cleanup": wait_for_cleanup,
                }),
            );
            return Ok(true);
        }
        let cleanup_wait_result = tokio::time::timeout(
            Duration::from_millis(TERMINAL_CLOSE_COMMAND_WAIT_MS),
            cleanup_task,
        )
        .await;

        let (cleanup_joined, cleanup_timed_out, cleanup_join_error) = match cleanup_wait_result {
            Ok(Ok(())) => (true, false, None),
            Ok(Err(error)) => (
                false,
                false,
                Some(clean_terminal_telemetry_text(&error.to_string())),
            ),
            Err(_) => (false, true, None),
        };

        log_terminal_crash_forensics_event(
            "backend.terminal_close.done",
            json!({
                "instance_id": cleanup_instance_id,
                "cleanup_join_error": cleanup_join_error.as_deref(),
                "cleanup_joined": cleanup_joined,
                "cleanup_timed_out": cleanup_timed_out,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "wait_for_cleanup": wait_for_cleanup,
            }),
        );
        if cleanup_timed_out {
            return Err("Timed out waiting for terminal cleanup.".to_string());
        }
        if let Some(error) = cleanup_join_error {
            return Err(format!("Unable to join terminal cleanup: {error}"));
        }
        return Ok(true);
    }

    log_terminal_crash_forensics_event(
        "backend.terminal_close.skip",
        json!({
            "expected_instance_id": instance_id,
            "pane_id": clean_terminal_diagnostic_log_text(pane_id),
            "reason": "not_running",
        }),
    );
    Ok(false)
}

async fn close_all_terminal_sessions(
    app: AppHandle,
    state: &TerminalState,
    cloud_mcp_state: &CloudMcpState,
    workspace_id: Option<&str>,
) -> Result<usize, String> {
    let target_workspace_id = workspace_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let instances = {
        let mut terminals = state.terminals.write().await;
        if target_workspace_id.is_some() {
            let pane_ids = terminals
                .iter()
                .filter_map(|(pane_id, instance)| {
                    terminal_instance_matches_workspace(instance, target_workspace_id.as_deref())
                        .then(|| pane_id.clone())
                })
                .collect::<Vec<_>>();

            pane_ids
                .into_iter()
                .filter_map(|pane_id| terminals.remove_entry(&pane_id))
                .collect::<Vec<(String, TerminalInstance)>>()
        } else {
            terminals
                .drain()
                .collect::<Vec<(String, TerminalInstance)>>()
        }
    };
    let pty_pool = Arc::clone(&state.pty_pool);
    let cleanup_tracker = Arc::clone(&state.cleanup_tracker);
    let scoped_close = target_workspace_id.is_some();
    let warm_ptys = if scoped_close {
        Vec::new()
    } else {
        pty_pool.drain_for_shutdown()
    };
    let closed = instances.len();
    let total = closed;
    let warm_total = warm_ptys.len();
    log_terminal_crash_forensics_event(
        "backend.terminal_close_all.begin",
        json!({
            "active_count": closed,
            "workspace_id": target_workspace_id.as_deref().unwrap_or(""),
            "warm_count": warm_total,
        }),
    );
    let coordination_cleanups = instances
        .iter()
        .filter_map(|(_, instance)| terminal_shutdown_coordination_cleanup_from_instance(instance))
        .collect::<Vec<_>>();

    for (pane_id, instance) in &instances {
        remove_terminal_parked_prompts_for_close(state, pane_id, instance.id, "close_all").await;
    }

    let mut notify_tasks = Vec::new();
    for (pane_id, instance) in &instances {
        let notify_state = cloud_mcp_state.clone();
        let notify_pane_id = pane_id.clone();
        let notify_instance_id = instance.id;
        let notify_context = TerminalCloudMcpCloseContext::from_instance(instance);
        notify_tasks.push(tauri::async_runtime::spawn(async move {
            cloud_mcp_mark_terminal_closed(
                &notify_state,
                &notify_pane_id,
                notify_instance_id,
                &notify_context,
                "close_all",
            )
            .await;
        }));
    }
    if !notify_tasks.is_empty() {
        let _ = tokio::time::timeout(
            Duration::from_millis(2_000),
            futures_util::future::join_all(notify_tasks),
        )
        .await;
    }

    emit_terminal_close_all_progress(&app, 0, total, None, None, target_workspace_id.clone());

    if scoped_close && total == 0 {
        log_terminal_crash_forensics_event(
            "backend.terminal_close_all.done",
            json!({
                "active_done": 0,
                "active_total": 0,
                "scope": "workspace",
                "timed_out": false,
                "workspace_id": target_workspace_id.as_deref().unwrap_or(""),
                "warm_done": 0,
                "warm_total": 0,
            }),
        );
        return Ok(0);
    }

    tauri::async_runtime::spawn_blocking(move || {
        enum CleanupSignal {
            Active,
            Warm,
            Login,
        }

        let closed_count = Arc::new(AtomicUsize::new(0));
        let (cleanup_tx, cleanup_rx) = std::sync::mpsc::channel::<CleanupSignal>();

        for (pane_id, instance) in instances {
            let app = app.clone();
            let cleanup_tx = cleanup_tx.clone();
            let closed_count = Arc::clone(&closed_count);
            let cleanup_tracker = Arc::clone(&cleanup_tracker);
            let progress_workspace_id = instance.metadata.workspace_id.clone();

            thread::spawn(move || {
                let instance_id = instance.id;
                let _cleanup_guard = cleanup_tracker.begin("close_all", Some(instance_id));
                log_terminal_crash_forensics_event(
                    "backend.terminal_close_all.active_cleanup_thread.begin",
                    json!({
                        "instance_id": instance_id,
                        "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                    }),
                );

                cleanup_terminal_instance_with_context(
                    instance,
                    true,
                    "close_all",
                    TerminalCoordinationCleanupMode::DeferToShutdownBatch,
                );
                log_terminal_crash_forensics_event(
                    "backend.terminal_close_all.active_cleanup_thread.done",
                    json!({
                        "instance_id": instance_id,
                        "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                    }),
                );
                let closed = closed_count.fetch_add(1, Ordering::Relaxed) + 1;
                emit_terminal_close_all_progress(
                    &app,
                    closed,
                    total,
                    Some(pane_id),
                    Some(instance_id),
                    Some(progress_workspace_id),
                );
                let _ = cleanup_tx.send(CleanupSignal::Active);
            });
        }

        for warm_pty in warm_ptys {
            let cleanup_tx = cleanup_tx.clone();

            thread::spawn(move || {
                log_terminal_crash_forensics_event(
                    "backend.terminal_close_all.warm_cleanup_thread.begin",
                    json!({}),
                );
                cleanup_warm_pty_with_context(warm_pty);
                log_terminal_crash_forensics_event(
                    "backend.terminal_close_all.warm_cleanup_thread.done",
                    json!({}),
                );
                let _ = cleanup_tx.send(CleanupSignal::Warm);
            });
        }

        if !scoped_close {
            let cleanup_tx = cleanup_tx.clone();

            thread::spawn(move || {
                log_terminal_crash_forensics_event(
                    "backend.terminal_close_all.login_cleanup_thread.begin",
                    json!({}),
                );
                cleanup_login_terminal_children();
                log_terminal_crash_forensics_event(
                    "backend.terminal_close_all.login_cleanup_thread.done",
                    json!({}),
                );
                let _ = cleanup_tx.send(CleanupSignal::Login);
            });
        }

        drop(cleanup_tx);

        let wait_started_at = Instant::now();
        let wait_timeout = Duration::from_millis(TERMINAL_CLOSE_ALL_WAIT_MS);
        let mut active_done = 0usize;
        let mut warm_done = 0usize;
        let mut login_closed = scoped_close.then_some(());
        let mut timed_out = false;

        while active_done < total || warm_done < warm_total || login_closed.is_none() {
            let elapsed = wait_started_at.elapsed();

            if elapsed >= wait_timeout {
                timed_out = true;
                break;
            }

            match cleanup_rx.recv_timeout(wait_timeout.saturating_sub(elapsed)) {
                Ok(CleanupSignal::Active) => {
                    active_done += 1;
                }
                Ok(CleanupSignal::Warm) => {
                    warm_done += 1;
                }
                Ok(CleanupSignal::Login) => {
                    login_closed = Some(());
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    timed_out = true;
                    break;
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    break;
                }
            }
        }

        if !timed_out {
            cleanup_terminal_shutdown_coordination_batch_with_timeout(
                coordination_cleanups,
                "close_all",
                Duration::from_millis(TERMINAL_CLOSE_ALL_COORDINATION_WAIT_MS),
            );
            if !scoped_close {
                pty_pool.wait_for_refill_idle();
            }
        }
        let cleanup_tracker_active_before_sweep = cleanup_tracker.active();
        let conhosts_closed = if scoped_close {
            0
        } else {
            cleanup_windows_headless_console_hosts()
        };
        let cleanup_tracker_idle_after_sweep = if scoped_close {
            true
        } else {
            cleanup_tracker.wait_for_idle(
                "close_all_after_conhost_sweep",
                Duration::from_millis(TERMINAL_CLOSE_ALL_WAIT_MS),
            )
        };
        log_terminal_crash_forensics_event(
            "backend.terminal_close_all.done",
            json!({
                "active_done": active_done,
                "active_total": total,
                "cleanup_tracker_active_before_sweep": cleanup_tracker_active_before_sweep,
                "cleanup_tracker_active_after_sweep": cleanup_tracker.active(),
                "cleanup_tracker_idle_after_sweep": cleanup_tracker_idle_after_sweep,
                "conhosts_closed": conhosts_closed,
                "login_done": login_closed.is_some(),
                "scope": if scoped_close { "workspace" } else { "all" },
                "timed_out": timed_out,
                "warm_done": warm_done,
                "warm_total": warm_total,
            }),
        );
    })
    .await
    .map_err(|error| format!("Unable to join terminal shutdown cleanup: {error}"))?;

    Ok(closed)
}

fn choose_terminal_command_path(command_candidates: &[String]) -> Option<String> {
    command_candidates
        .iter()
        .find(|candidate| Path::new(candidate.as_str()).exists())
        .or_else(|| command_candidates.first())
        .cloned()
}

fn write_agent_start_input_to_writer(
    writer: &mut dyn Write,
    input: &str,
    context: &str,
) -> Result<(), String> {
    log_terminal_crash_forensics_event(
        "backend.agent_start_input.write.begin",
        json!({
            "bytes": input.len(),
            "context": clean_terminal_diagnostic_log_text(context),
            "input_kind": terminal_input_forensics_kind(input),
        }),
    );
    if let Err(error) = writer.write_all(input.as_bytes()) {
        log_terminal_crash_forensics_event(
            "backend.agent_start_input.write.error",
            json!({
                "bytes": input.len(),
                "context": clean_terminal_diagnostic_log_text(context),
                "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                "stage": "write_all",
            }),
        );
        return Err(format!("Unable to write {context}: {error}"));
    }
    if let Err(error) = writer.flush() {
        log_terminal_crash_forensics_event(
            "backend.agent_start_input.write.error",
            json!({
                "bytes": input.len(),
                "context": clean_terminal_diagnostic_log_text(context),
                "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                "stage": "flush",
            }),
        );
        return Err(format!("Unable to flush {context}: {error}"));
    }
    log_terminal_crash_forensics_event(
        "backend.agent_start_input.write.done",
        json!({
            "bytes": input.len(),
            "context": clean_terminal_diagnostic_log_text(context),
            "input_kind": terminal_input_forensics_kind(input),
        }),
    );
    Ok(())
}

fn terminal_request_is_plain_shell(
    kind: &str,
    provider: Option<&str>,
    plain_shell: Option<bool>,
) -> bool {
    if let Some(plain_shell) = plain_shell {
        return plain_shell;
    }

    let has_provider = provider
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    if has_provider {
        return false;
    }

    matches!(
        kind.trim().to_ascii_lowercase().as_str(),
        "shell" | "plain-shell" | "plain_shell" | "generic" | "generic-shell" | "generic_shell"
    )
}

fn terminal_slot_key_from_request(
    pane_id: &str,
    terminal_index: Option<u16>,
    slot_key: Option<&str>,
) -> Result<String, String> {
    if let Some(slot_key) = slot_key.filter(|value| !value.trim().is_empty()) {
        return crate::coordination::CoordinationKernel::normalize_slot_key_static(slot_key);
    }
    if let Some(index) = terminal_index {
        let slot_number = usize::from(index) + 1;
        return crate::coordination::CoordinationKernel::normalize_slot_key_static(
            &slot_number.to_string(),
        );
    }

    let parts = pane_id.split('-').collect::<Vec<_>>();
    for part in parts.iter().rev().skip(1) {
        if let Ok(index) = part.parse::<usize>() {
            return crate::coordination::CoordinationKernel::normalize_slot_key_static(
                &(index + 1).to_string(),
            );
        }
    }

    crate::coordination::CoordinationKernel::normalize_slot_key_static("1")
}

#[tauri::command]
async fn terminal_open(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    request: TerminalOpenRequest,
    output_channel: Channel<InvokeResponseBody>,
) -> Result<TerminalOpenResult, String> {
    let open_started_at = Instant::now();
    validate_terminal_pane_id(&request.pane_id)?;
    ensure_app_not_shutting_down("terminal open")?;
    let lifecycle_lock = Arc::clone(&state.lifecycle_lock);
    let _lifecycle_guard = lifecycle_lock.lock().await;
    ensure_app_not_shutting_down("terminal open")?;
    let pane_id = request.pane_id;
    let requested_cols = request.cols;
    let requested_rows = request.rows;
    let kind = request.kind;
    let provider = request.provider;
    let provider_for_coordination = provider.clone();
    let provider_session_id = request.provider_session_id;
    let model = request.model;
    let plain_shell =
        terminal_request_is_plain_shell(&kind, provider.as_deref(), request.plain_shell);
    let fresh_session = request.fresh_session.unwrap_or(false) && !plain_shell;
    let working_directory_request = request.working_directory;
    let workspace_root_was_empty_at_selection = request
        .workspace_root_was_empty_at_selection
        .unwrap_or(false);
    let requested_project_root = request.project_root;
    let requested_mount_id = request.mount_id;
    let requested_session_mode = request.session_mode;
    let workspace_id = request.workspace_id;
    let workspace_name = request.workspace_name;
    let terminal_index = request.terminal_index;
    let thread_id = request.thread_id;
    let requested_slot_key = request.slot_key;
    let prefer_output_transport = request.output_transport.unwrap_or(false);
    let terminal_slot_key =
        terminal_slot_key_from_request(&pane_id, terminal_index, requested_slot_key.as_deref())?;
    let is_prewarm_pty = is_terminal_prewarm_kind(&kind);
    let default_session_mode = if is_prewarm_pty {
        TerminalSessionMode::Free
    } else {
        TerminalSessionMode::General
    };
    let session_mode =
        TerminalSessionMode::from_request(requested_session_mode.as_deref(), default_session_mode)?;
    if plain_shell && session_mode.requires_managed_patch_worktree() {
        return Err(
            "Plain shell terminals cannot be forced into managed patch mode. Use the default general worker authority for shell work."
                .to_string(),
        );
    }
    log_terminal_crash_forensics_event(
        "backend.terminal_open.begin",
        json!({
            "fresh_session": request.fresh_session.unwrap_or(false),
            "kind": clean_terminal_diagnostic_log_text(&kind),
            "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
            "provider": provider
                .as_deref()
                .map(clean_terminal_diagnostic_log_text),
            "requested_cols": requested_cols,
            "requested_rows": requested_rows,
            "requested_instance_id": request.instance_id,
            "session_mode": session_mode.as_str(),
            "terminal_index": terminal_index,
            "thread_id": thread_id
                .as_deref()
                .map(clean_terminal_diagnostic_log_text),
            "workspace_root_was_empty_at_selection": workspace_root_was_empty_at_selection,
            "output_transport": prefer_output_transport,
        }),
    );

    let preserve_coordination_session = request.preserve_coordination_session.unwrap_or(false)
        && !fresh_session
        && session_mode.should_prepare_coordination();
    close_terminal_session(
        &state,
        Some(cloud_mcp_state.inner()),
        &pane_id,
        None,
        preserve_coordination_session,
        true,
    )
    .await?;

    if !state
        .cleanup_tracker
        .wait_for_idle_async(
            "terminal_open_before_launch",
            Duration::from_millis(TERMINAL_CLOSE_COMMAND_WAIT_MS),
        )
        .await
    {
        let conhosts_closed = cleanup_windows_headless_console_hosts();
        log_terminal_crash_forensics_event(
            "backend.terminal_open.cleanup_wait.sweep",
            json!({
                "cleanup_tracker_active": state.cleanup_tracker.active(),
                "conhosts_closed": conhosts_closed,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
            }),
        );

        if !state
            .cleanup_tracker
            .wait_for_idle_async(
                "terminal_open_after_conhost_sweep",
                Duration::from_millis(TERMINAL_DROP_CLEANUP_TRACKER_WAIT_MS),
            )
            .await
        {
            return Err("Timed out waiting for previous terminal cleanup.".to_string());
        }
    }
    ensure_app_not_shutting_down("terminal open")?;

    let working_directory =
        match resolve_workspace_root_directory(working_directory_request.as_deref()) {
            Ok(working_directory) => working_directory,
            Err(error) => {
                return Err(error);
            }
        };
    if !is_prewarm_pty && !plain_shell {
        let launch_provider = terminal_launch_provider(&kind, provider.as_deref())?;
        if matches!(launch_provider, AgentProvider::Codex) {
            if let Some(provider_session_id) = provider_session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                let _ = prepare_codex_rollout_for_resume(
                    provider_session_id,
                    &working_directory.to_string_lossy(),
                );
            }
        }
    }
    let mut terminal_project_root = working_directory.clone();
    let mut process_working_directory = workspace_path_for_process(&working_directory);
    let mut launch_worktree: Option<Value> = None;
    let mut coordination_context: Option<crate::coordination::models::TerminalCoordinationContext> =
        None;

    let (command_candidates, args, label) = if is_prewarm_pty || plain_shell {
        (Vec::new(), Vec::new(), "Prepared PTY".to_string())
    } else {
        terminal_launch(&kind, provider, model, provider_session_id)?
    };
    let instance_id = request.instance_id.filter(|id| *id > 0).unwrap_or_else(|| {
        state
            .next_terminal_instance_id
            .fetch_add(1, Ordering::Relaxed)
    });
    clear_terminal_activity_hook_files(&pane_id, instance_id);
    ensure_app_not_shutting_down("terminal open")?;
    let terminal_launch_epoch = format!("{pane_id}:{instance_id}");
    if (!is_prewarm_pty || !plain_shell) && session_mode.should_prepare_coordination() {
        let topology_mounts =
            terminal_workspace_topology_mounts_for_launch(&state, &working_directory).await;
        let coordination_target = terminal_coordination_launch_target_with_mounts(
            &working_directory,
            Some(&topology_mounts),
            requested_project_root.as_deref(),
            requested_mount_id.as_deref(),
            workspace_root_was_empty_at_selection,
            session_mode,
        )?;
        let coordination_working_directory = coordination_target.root;
        terminal_project_root = coordination_working_directory.clone();
        if coordination_target.requires_git_bootstrap {
            ensure_workspace_git_bootstrap_for_terminal(
                &coordination_working_directory,
                coordination_target.allows_git_init,
            )
            .await?;
        }

        let coordination_pty_id = if fresh_session {
            format!("{pane_id}-fresh-{instance_id}")
        } else {
            pane_id.clone()
        };
        let (context, worktree, prepared_working_directory) = prepare_terminal_coordination_launch(
            coordination_pty_id,
            terminal_launch_epoch,
            coordination_working_directory,
            working_directory.clone(),
            kind.clone(),
            provider_for_coordination.clone(),
            label.clone(),
            terminal_slot_key.clone(),
            workspace_id.clone(),
            workspace_name.clone(),
            coordination_target.enforcement_mode,
        )
        .await?;
        process_working_directory = prepared_working_directory;
        if context.worktree_id.is_some() {
            launch_worktree = Some(worktree);
        }
        coordination_context = Some(context);
    }

    let size = terminal_size_from_request(requested_cols, requested_rows)?;

    let mut command = "prepared-shell".to_string();
    let mut agent_started = false;
    let terminal_coordination = coordination_context
        .as_ref()
        .map(terminal_coordination_session_from_context);
    let effective_session_mode = coordination_context
        .as_ref()
        .map(|context| terminal_session_mode_from_context(context, session_mode))
        .unwrap_or(session_mode);

    let shell_pty = is_prewarm_pty || plain_shell;
    let warm_pty = if shell_pty {
        ensure_app_not_shutting_down("terminal open")?;
        let mut coordination_env_vars = terminal_coordination
            .as_ref()
            .map(|coordination| coordination.env_vars.clone())
            .unwrap_or_default();
        let activity_provider_id = provider_for_coordination
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(if plain_shell {
                "generic"
            } else if kind == "console" {
                "codex"
            } else {
                kind.as_str()
            });
        extend_terminal_activity_env_vars(
            &mut coordination_env_vars,
            &pane_id,
            instance_id,
            workspace_id.as_deref(),
            terminal_index,
            activity_provider_id,
        );
        if terminal_coordination.is_some() {
            coordination_env_vars
                .extend(cloud_mcp_runtime_env_vars(cloud_mcp_state.inner()).await?);
        }
        match create_warm_shell_pty_in_directory_with_env(
            size,
            &process_working_directory,
            &coordination_env_vars,
        ) {
            Ok(warm_pty) => warm_pty,
            Err(error) => {
                return Err(error);
            }
        }
    } else {
        ensure_app_not_shutting_down("terminal open")?;
        let Some(command_path) = choose_terminal_command_path(&command_candidates) else {
            let error = format!("{label} is not installed or not available on PATH.");
            return Err(error);
        };

        let launch_provider_id = provider_for_coordination
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                if kind == "console" {
                    "codex"
                } else {
                    kind.as_str()
                }
            });
        refresh_codex_activity_hook_profile_for_launch(
            terminal_coordination.as_ref(),
            launch_provider_id,
            &pane_id,
            instance_id,
            workspace_id.as_deref(),
            terminal_index,
        );
        let launch_args = terminal_args_with_codex_mcp_identity(
            launch_provider_id,
            &args,
            terminal_coordination.as_ref(),
            &pane_id,
            instance_id,
        );
        validate_terminal_agent_launch_args_for_platform(launch_provider_id, &launch_args)?;
        let mut coordination_env_vars = terminal_coordination
            .as_ref()
            .map(|coordination| coordination.env_vars.clone())
            .unwrap_or_default();
        extend_terminal_activity_env_vars(
            &mut coordination_env_vars,
            &pane_id,
            instance_id,
            workspace_id.as_deref(),
            terminal_index,
            launch_provider_id,
        );
        coordination_env_vars.extend(cloud_mcp_runtime_env_vars(cloud_mcp_state.inner()).await?);
        let launch_env_vars =
            terminal_env_vars_with_opencode_tui_config(launch_provider_id, &coordination_env_vars)?;

        let warm_pty = match create_agent_terminal_pty(
            size,
            &command_path,
            &launch_args,
            &process_working_directory,
            &launch_env_vars,
            None,
        ) {
            Ok(warm_pty) => warm_pty,
            Err(error) => {
                return Err(error);
            }
        };

        command = command_path;
        agent_started = true;
        warm_pty
    };

    if let Err(error) = ensure_app_not_shutting_down("terminal open") {
        cleanup_warm_pty_with_context(warm_pty);
        return Err(error);
    }

    let terminal_metadata = TerminalInstanceMetadata {
        pane_id: pane_id.clone(),
        workspace_id: workspace_id.clone().unwrap_or_default(),
        workspace_name: workspace_name.clone().unwrap_or_default(),
        terminal_index,
        thread_id: thread_id.clone().unwrap_or_default(),
        agent_id: provider_for_coordination.clone().unwrap_or_else(|| {
            if plain_shell {
                "generic".to_string()
            } else if kind == "console" {
                "codex".to_string()
            } else {
                kind.clone()
            }
        }),
        agent_kind: if plain_shell {
            "generic".to_string()
        } else if kind == "console" {
            provider_for_coordination
                .clone()
                .unwrap_or_else(|| "codex".to_string())
        } else {
            kind.clone()
        },
    };
    let terminal_metadata_for_log = terminal_metadata.clone();

    let (instance, reader) = TerminalInstance::from_warm_shell(
        instance_id,
        warm_pty,
        process_working_directory.clone(),
        agent_started,
        terminal_coordination.clone(),
        effective_session_mode,
        terminal_metadata,
    );
    let headless_output = Arc::clone(&instance.headless_output);

    let displaced_instance = state
        .terminals
        .write()
        .await
        .insert(pane_id.clone(), instance);
    log_terminal_crash_forensics_event(
        "backend.terminal_open.inserted",
        json!({
            "displaced_instance_id": displaced_instance.as_ref().map(|instance| instance.id),
            "instance_id": instance_id,
            "metadata": terminal_metadata_forensics_json(&terminal_metadata_for_log),
            "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
        }),
    );
    if let Some(displaced_instance) = displaced_instance {
        cleanup_terminal_instance_async(
            displaced_instance,
            true,
            "terminal_open_displaced",
            preserve_coordination_session,
            Some(Arc::clone(&state.cleanup_tracker)),
        );
    }

    let cloud_output_observer_enabled = !cloud_mcp_agent_uses_activity_hooks(
        &terminal_metadata_for_log.agent_id,
    ) && !cloud_mcp_agent_uses_activity_hooks(&terminal_metadata_for_log.agent_kind);
    spawn_terminal_reader(
        app.clone(),
        Arc::clone(&state.terminals),
        Arc::clone(&state.cleanup_tracker),
        Arc::clone(&state.terminal_output_transport_subscribers),
        pane_id.clone(),
        instance_id,
        headless_output,
        cloud_mcp_state.inner().clone(),
        output_channel,
        prefer_output_transport,
        cloud_output_observer_enabled,
        reader,
    );
    spawn_terminal_activity_hook_watcher(
        app.clone(),
        Arc::clone(&state.terminals),
        cloud_mcp_state.inner().clone(),
        pane_id.clone(),
        instance_id,
    );

    log_terminal_crash_forensics_event(
        "backend.terminal_open.done",
        json!({
            "agent_started": agent_started,
            "cols": size.cols,
            "elapsed_ms": terminal_diagnostic_elapsed_ms(open_started_at),
            "instance_id": instance_id,
            "kind": clean_terminal_diagnostic_log_text(&kind),
            "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
            "plain_shell": plain_shell,
            "rows": size.rows,
            "completion_mode": effective_session_mode.completion_mode(),
            "requested_session_mode": session_mode.as_str(),
            "session_mode": effective_session_mode.as_str(),
            "shell_pty": shell_pty,
        }),
    );
    log_terminal_diagnostic_event(
        &app,
        "backend.terminal_open.done",
        json!({
            "agent_started": agent_started,
            "cols": size.cols,
            "elapsed_ms": terminal_diagnostic_elapsed_ms(open_started_at),
            "instance_id": instance_id,
            "kind": clean_terminal_diagnostic_log_text(&kind),
            "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
            "plain_shell": plain_shell,
            "rows": size.rows,
            "completion_mode": effective_session_mode.completion_mode(),
            "requested_session_mode": session_mode.as_str(),
            "session_mode": effective_session_mode.as_str(),
            "shell_pty": shell_pty,
        }),
    );
    log_windows_terminal_diagnostic_event(
        &app,
        "backend.windows_terminal_open.done",
        json!({
            "agent_started": agent_started,
            "colorterm": TERMINAL_EMULATION_COLORTERM,
            "cols": size.cols,
            "force_color": TERMINAL_EMULATION_FORCE_COLOR,
            "instance_id": instance_id,
            "kind": clean_terminal_diagnostic_log_text(&kind),
            "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
            "plain_shell": plain_shell,
            "pty_backend": if cfg!(windows) { "conpty" } else { "native" },
            "rows": size.rows,
            "completion_mode": effective_session_mode.completion_mode(),
            "requested_session_mode": session_mode.as_str(),
            "session_mode": effective_session_mode.as_str(),
            "shell_pty": shell_pty,
            "term": TERMINAL_EMULATION_TERM,
            "term_program": TERMINAL_EMULATION_PROGRAM,
            "windows_build_number": terminal_windows_build_number(),
        }),
    );

    Ok(TerminalOpenResult {
        pane_id,
        instance_id,
        command,
        working_directory: workspace_path_display(&process_working_directory),
        project_root: workspace_path_display(&terminal_project_root),
        agent_id: coordination_context
            .as_ref()
            .map(|context| context.agent_id.clone())
            .or_else(|| {
                launch_worktree
                    .as_ref()
                    .and_then(|worktree| worktree["agentId"].as_str())
                    .map(str::to_string)
            }),
        session_id: coordination_context
            .as_ref()
            .map(|context| context.session_id.clone()),
        agent_branch_root: coordination_context
            .as_ref()
            .map(|context| context.write_root.clone())
            .or_else(|| {
                launch_worktree
                    .as_ref()
                    .and_then(|worktree| worktree["path"].as_str())
                    .map(str::to_string)
            }),
        agent_branch: launch_worktree
            .as_ref()
            .and_then(|worktree| worktree["branchName"].as_str())
            .map(str::to_string),
        slot_key: coordination_context
            .as_ref()
            .and_then(|context| context.slot_key.clone())
            .or_else(|| {
                launch_worktree
                    .as_ref()
                    .and_then(|worktree| worktree["slotKey"].as_str())
                    .map(str::to_string)
            }),
        thread_id,
        coordination_mode: coordination_context
            .as_ref()
            .map(|context| context.enforcement_mode.clone())
            .or_else(|| {
                launch_worktree
                    .as_ref()
                    .map(|_| "worktree_only".to_string())
            }),
        session_mode: coordination_context
            .as_ref()
            .map(|context| context.session_mode().to_string())
            .unwrap_or_else(|| effective_session_mode.as_str().to_string()),
        file_authority: coordination_context
            .as_ref()
            .map(|context| context.file_authority().to_string())
            .unwrap_or_else(|| effective_session_mode.file_authority().to_string()),
    })
}

struct TerminalCrashRecoveryTarget {
    repo_path: PathBuf,
    db_path: Option<PathBuf>,
    label: String,
    source: String,
}

fn terminal_crash_recovery_targets(
    roots: Option<Vec<String>>,
) -> (Vec<TerminalCrashRecoveryTarget>, Vec<Value>) {
    let requested_roots = roots.unwrap_or_default();
    let mut targets = Vec::new();
    let mut errors = Vec::new();

    if requested_roots.is_empty() {
        match crate::coordination::db::remembered_initialized_kernel_storages() {
            Ok(storages) => {
                for storage in storages {
                    let db_label = workspace_path_display(&storage.db_path);
                    if !storage.db_path.exists() {
                        errors.push(json!({
                            "source": "initialized_kernel_registry",
                            "dbPath": db_label,
                            "repoPath": workspace_path_display(&storage.repo_path),
                            "error": "Coordination database no longer exists.",
                        }));
                        continue;
                    }
                    targets.push(TerminalCrashRecoveryTarget {
                        label: workspace_path_display(&storage.repo_path),
                        repo_path: storage.repo_path,
                        db_path: Some(storage.db_path),
                        source: "initialized_kernel_registry".to_string(),
                    });
                }
            }
            Err(error) => {
                errors.push(json!({
                    "source": "initialized_kernel_registry",
                    "error": clean_terminal_telemetry_text(&error),
                }));
            }
        }

        return (targets, errors);
    }

    for root in requested_roots {
        let root_option = if root.trim().is_empty() {
            None
        } else {
            Some(root.as_str())
        };
        let working_directory = match resolve_workspace_root_directory(root_option) {
            Ok(directory) => directory,
            Err(error) => {
                errors.push(json!({
                    "root": clean_terminal_telemetry_text(&root),
                    "error": clean_terminal_telemetry_text(&error),
                }));
                continue;
            }
        };
        let mounts = workspace_project_mounts(&working_directory);
        let exact_repo = mounts.iter().any(|mount| {
            normalized_path_key(&mount.root_path) == normalized_path_key(&working_directory)
        });
        let recovery_roots = if !exact_repo && !mounts.is_empty() {
            mounts
                .iter()
                .filter(|mount| mount.has_git || mount.has_agents)
                .map(|mount| mount.root_path.clone())
                .collect::<Vec<_>>()
        } else {
            vec![working_directory]
        };

        for recovery_root in recovery_roots {
            targets.push(TerminalCrashRecoveryTarget {
                label: workspace_path_display(&recovery_root),
                repo_path: recovery_root,
                db_path: None,
                source: "requested_root".to_string(),
            });
        }
    }

    (targets, errors)
}

fn terminal_recover_crashed_sessions_report(roots: Option<Vec<String>>) -> Result<Value, String> {
    let (targets, mut errors) = terminal_crash_recovery_targets(roots);
    let mut seen_targets = HashSet::new();
    let mut workspace_reports = Vec::new();
    let mut interrupted_tasks = Vec::new();
    let mut crashed_terminals = Vec::new();
    let mut scanned_sessions = 0u64;
    let mut idle_sessions_interrupted = 0u64;
    let mut finished_sessions_interrupted = 0u64;

    for target in targets {
        let target_key = target
            .db_path
            .as_ref()
            .map(|path| format!("db:{}", workspace_path_display(path)))
            .unwrap_or_else(|| format!("repo:{}", workspace_path_display(&target.repo_path)));
        if !seen_targets.insert(target_key) {
            continue;
        }

        let repo_key = target.label.clone();
        let db_key = target.db_path.as_ref().map(|path| workspace_path_display(path));
        match crate::coordination::CoordinationKernel::init(&target.repo_path, target.db_path.clone())
            .and_then(|kernel| kernel.recover_crashed_terminal_sessions())
        {
            Ok(mut report) => {
                scanned_sessions += report["scannedSessions"].as_u64().unwrap_or(0);
                idle_sessions_interrupted +=
                    report["idleSessionsInterrupted"].as_u64().unwrap_or(0);
                finished_sessions_interrupted +=
                    report["finishedSessionsInterrupted"].as_u64().unwrap_or(0);

                if let Some(tasks) = report["interruptedTasks"].as_array_mut() {
                    for task in tasks.iter_mut() {
                        if let Some(object) = task.as_object_mut() {
                            object.insert("repoPath".to_string(), json!(repo_key.clone()));
                            if let Some(db_key) = &db_key {
                                object.insert("dbPath".to_string(), json!(db_key));
                            }
                            object.insert(
                                "recoverySource".to_string(),
                                json!(target.source.clone()),
                            );
                        }
                        interrupted_tasks.push(task.clone());
                    }
                }

                if let Some(terminals) = report["crashedTerminals"].as_array_mut() {
                    for terminal in terminals.iter_mut() {
                        if let Some(object) = terminal.as_object_mut() {
                            object.insert("repoPath".to_string(), json!(repo_key.clone()));
                            if let Some(db_key) = &db_key {
                                object.insert("dbPath".to_string(), json!(db_key));
                            }
                            object.insert(
                                "recoverySource".to_string(),
                                json!(target.source.clone()),
                            );
                        }
                        crashed_terminals.push(terminal.clone());
                    }
                }

                if let Some(object) = report.as_object_mut() {
                    object.insert("repoPath".to_string(), json!(repo_key));
                    if let Some(db_key) = db_key {
                        object.insert("dbPath".to_string(), json!(db_key));
                    }
                    object.insert(
                        "recoverySource".to_string(),
                        json!(target.source.clone()),
                    );
                }
                workspace_reports.push(report);
            }
            Err(error) => {
                errors.push(json!({
                    "root": repo_key,
                    "dbPath": db_key,
                    "source": target.source,
                    "error": clean_terminal_telemetry_text(&error),
                }));
            }
        }
    }

    Ok(json!({
        "interruptedTasks": interrupted_tasks,
        "crashedTerminals": crashed_terminals,
        "idleSessionsInterrupted": idle_sessions_interrupted,
        "finishedSessionsInterrupted": finished_sessions_interrupted,
        "scannedSessions": scanned_sessions,
        "workspaceReports": workspace_reports,
        "errors": errors,
    }))
}

fn terminal_recover_crashed_sessions_on_startup() {
    thread::spawn(|| {
        let report = terminal_recover_crashed_sessions_report(None);
        match report {
            Ok(report) => log_terminal_crash_forensics_event(
                "terminal.crash_recovery.startup_scan",
                json!({
                    "ok": true,
                    "scanned_sessions": report["scannedSessions"].as_u64().unwrap_or(0),
                    "crashed_terminal_count": report["crashedTerminals"].as_array().map(Vec::len).unwrap_or(0),
                    "interrupted_task_count": report["interruptedTasks"].as_array().map(Vec::len).unwrap_or(0),
                    "idle_sessions_interrupted": report["idleSessionsInterrupted"].as_u64().unwrap_or(0),
                    "finished_sessions_interrupted": report["finishedSessionsInterrupted"].as_u64().unwrap_or(0),
                    "workspace_report_count": report["workspaceReports"].as_array().map(Vec::len).unwrap_or(0),
                    "error_count": report["errors"].as_array().map(Vec::len).unwrap_or(0),
                    "crashed_terminals": report["crashedTerminals"].clone(),
                }),
            ),
            Err(error) => log_terminal_crash_forensics_event(
                "terminal.crash_recovery.startup_scan",
                json!({
                    "ok": false,
                    "error": clean_terminal_telemetry_text(&error),
                }),
            ),
        }
    });
}

#[tauri::command]
async fn terminal_recover_crashed_sessions(roots: Option<Vec<String>>) -> Result<Value, String> {
    terminal_recover_crashed_sessions_report(roots)
}

#[tauri::command]
async fn terminal_start_agent(
    _app: AppHandle,
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    pane_id: String,
    instance_id: Option<u64>,
    provider: String,
    model: Option<String>,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
    ensure_app_not_shutting_down("terminal agent start")?;
    let lifecycle_lock = Arc::clone(&state.lifecycle_lock);
    let _lifecycle_guard = lifecycle_lock.lock().await;
    ensure_app_not_shutting_down("terminal agent start")?;
    let provider = parse_agent_provider(&provider)?;
    let definition = agent_definition(provider);
    let mut args = Vec::new();

    if let Some(model) = normalize_forge_model(model)? {
        args.push("--model".to_string());
        args.push(model);
    }

    let command_candidates = agent_command_candidates(definition);
    let command_path = command_candidates
        .iter()
        .find(|candidate| Path::new(candidate.as_str()).exists())
        .or_else(|| {
            command_candidates
                .iter()
                .find(|candidate| candidate.as_str() == definition.binary)
        })
        .or_else(|| command_candidates.first())
        .cloned()
        .ok_or_else(|| {
            format!(
                "{} is not installed or not available on PATH.",
                definition.label
            )
        })?;

    let Some(instance) = get_terminal_instance_if_current(&state, &pane_id, instance_id).await?
    else {
        return Err("Terminal session is not running.".to_string());
    };
    if instance.coordination.is_none() && instance.session_mode.should_prepare_coordination() {
        return Err(
            "Deferred agent start is blocked because this terminal has no coordination session."
                .to_string(),
        );
    }
    require_cloud_mcp_terminal_gate_for_path(
        cloud_mcp_state.inner(),
        instance.working_directory.as_ref(),
        None,
        None,
    )
    .await?;
    refresh_codex_activity_hook_profile_for_launch(
        instance.coordination.as_ref(),
        definition.id,
        &pane_id,
        instance.id,
        Some(instance.metadata.workspace_id.as_str()),
        instance.metadata.terminal_index,
    );
    let launch_args = terminal_args_with_codex_mcp_identity(
        definition.id,
        &args,
        instance.coordination.as_ref(),
        &pane_id,
        instance.id,
    );
    validate_terminal_agent_launch_args_for_platform(definition.id, &launch_args)?;
    let mut coordination_env_vars = instance
        .coordination
        .as_ref()
        .map(|coordination| coordination.env_vars.clone())
        .unwrap_or_default();
    extend_terminal_activity_env_vars(
        &mut coordination_env_vars,
        &pane_id,
        instance.id,
        Some(instance.metadata.workspace_id.as_str()),
        instance.metadata.terminal_index,
        definition.id,
    );
    coordination_env_vars.extend(cloud_mcp_runtime_env_vars(cloud_mcp_state.inner()).await?);
    let launch_env_vars =
        terminal_env_vars_with_opencode_tui_config(definition.id, &coordination_env_vars)?;
    let input = terminal_agent_start_input_with_env_in_directory(
        &command_path,
        &launch_args,
        instance.working_directory.as_ref(),
        &launch_env_vars,
    );

    if input.len() > MAX_TERMINAL_WRITE_BYTES {
        return Err("Terminal launch input is too large.".to_string());
    }

    let mut agent_started = instance.agent_started.lock().await;

    if *agent_started {
        return Ok(());
    }

    let mut writer = instance.writer.lock().await;

    write_agent_start_input_to_writer(writer.as_mut(), &input, "terminal agent launch")?;
    *agent_started = true;

    Ok(())
}

async fn start_terminal_agent_in_prepared_pty(
    _app: AppHandle,
    cloud_mcp_state: CloudMcpState,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    _parked_prompts: Arc<RwLock<HashMap<String, TerminalParkedPrompt>>>,
    request: TerminalStartAgentRequest,
) -> TerminalStartAgentPaneResult {
    let pane_id = request.pane_id;
    let instance_id = request.instance_id;

    if app_shutdown_requested() {
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id,
            started: false,
            skipped: true,
            message: app_shutdown_blocked_message("terminal agent batch start"),
        };
    }

    if let Err(error) = validate_terminal_pane_id(&pane_id) {
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id,
            started: false,
            skipped: true,
            message: error,
        };
    }

    let provider = match parse_agent_provider(&request.provider) {
        Ok(provider) => provider,
        Err(error) => {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id,
                started: false,
                skipped: true,
                message: error,
            };
        }
    };
    let definition = agent_definition(provider);
    let mut args = Vec::new();
    if let Some(session_id) = request
        .provider_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        match provider {
            AgentProvider::Codex => {
                args.push("resume".to_string());
                args.push(session_id.to_string());
            }
            AgentProvider::Claude => {
                args.push("--resume".to_string());
                args.push(session_id.to_string());
            }
            AgentProvider::OpenCode => {
                args.push("--session".to_string());
                args.push(session_id.to_string());
            }
        }
    }

    match normalize_forge_model(request.model) {
        Ok(Some(model)) => {
            args.push("--model".to_string());
            args.push(model);
        }
        Ok(None) => {}
        Err(error) => {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id,
                started: false,
                skipped: true,
                message: error,
            };
        }
    }

    let Some(instance) = ({
        let terminals = terminals.read().await;
        terminals.get(&pane_id).cloned()
    }) else {
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id,
            started: false,
            skipped: true,
            message: "Terminal session is not running.".to_string(),
        };
    };
    if matches!(provider, AgentProvider::Codex) {
        if let Some(provider_session_id) = request
            .provider_session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let _ = prepare_codex_rollout_for_resume(
                provider_session_id,
                &instance.working_directory.to_string_lossy(),
            );
        }
    }

    if instance_id.is_some_and(|expected_id| expected_id != instance.id) {
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id,
            started: false,
            skipped: true,
            message: "Terminal session was replaced before agent start.".to_string(),
        };
    }

    if instance.coordination.is_none() && instance.session_mode.should_prepare_coordination() {
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id: Some(instance.id),
            started: false,
            skipped: true,
            message:
                "Prepared terminal has no coordination session; restart through terminal_open."
                    .to_string(),
        };
    }

    let mut agent_started_guard = instance.agent_started.lock().await;

    if *agent_started_guard {
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id: Some(instance.id),
            started: false,
            skipped: true,
            message: "Terminal agent has already been started.".to_string(),
        };
    }

    let child_guard = instance.child.lock().await;

    if child_guard.is_some() {
        let command_candidates = agent_command_candidates(definition);
        let Some(command_path) = choose_terminal_command_path(&command_candidates) else {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id: Some(instance.id),
                started: false,
                skipped: false,
                message: format!(
                    "{} is not installed or not available on PATH.",
                    definition.label
                ),
            };
        };
        refresh_codex_activity_hook_profile_for_launch(
            instance.coordination.as_ref(),
            definition.id,
            &pane_id,
            instance.id,
            Some(instance.metadata.workspace_id.as_str()),
            instance.metadata.terminal_index,
        );
        let launch_args = terminal_args_with_codex_mcp_identity(
            definition.id,
            &args,
            instance.coordination.as_ref(),
            &pane_id,
            instance.id,
        );
        if let Err(error) =
            validate_terminal_agent_launch_args_for_platform(definition.id, &launch_args)
        {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id: Some(instance.id),
                started: false,
                skipped: false,
                message: error,
            };
        }
        let mut coordination_env_vars = instance
            .coordination
            .as_ref()
            .map(|coordination| coordination.env_vars.clone())
            .unwrap_or_default();
        extend_terminal_activity_env_vars(
            &mut coordination_env_vars,
            &pane_id,
            instance.id,
            Some(instance.metadata.workspace_id.as_str()),
            instance.metadata.terminal_index,
            definition.id,
        );
        let cloud_env_vars = match cloud_mcp_runtime_env_vars(&cloud_mcp_state).await {
            Ok(env_vars) => env_vars,
            Err(error) => {
                return TerminalStartAgentPaneResult {
                    pane_id,
                    instance_id: Some(instance.id),
                    started: false,
                    skipped: false,
                    message: error,
                };
            }
        };
        coordination_env_vars.extend(cloud_env_vars);
        let launch_env_vars =
            match terminal_env_vars_with_opencode_tui_config(definition.id, &coordination_env_vars)
            {
                Ok(env_vars) => env_vars,
                Err(error) => {
                    return TerminalStartAgentPaneResult {
                        pane_id,
                        instance_id: Some(instance.id),
                        started: false,
                        skipped: false,
                        message: error,
                    };
                }
            };
        let input = terminal_agent_start_input_with_env_in_directory(
            &command_path,
            &launch_args,
            instance.working_directory.as_ref(),
            &launch_env_vars,
        );

        if input.len() > MAX_TERMINAL_WRITE_BYTES {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id: Some(instance.id),
                started: false,
                skipped: false,
                message: "Terminal launch input is too large.".to_string(),
            };
        }

        drop(child_guard);
        let mut writer = instance.writer.lock().await;

        match write_agent_start_input_to_writer(writer.as_mut(), &input, "terminal agent launch") {
            Ok(()) => {
                *agent_started_guard = true;
                return TerminalStartAgentPaneResult {
                    pane_id,
                    instance_id: Some(instance.id),
                    started: true,
                    skipped: false,
                    message: "Agent started.".to_string(),
                };
            }
            Err(error) => {
                return TerminalStartAgentPaneResult {
                    pane_id,
                    instance_id: Some(instance.id),
                    started: false,
                    skipped: false,
                    message: error,
                };
            }
        }
    }
    TerminalStartAgentPaneResult {
        pane_id,
        instance_id: Some(instance.id),
        started: false,
        skipped: true,
        message: "Terminal shell is not available for deferred agent launch.".to_string(),
    }
}

#[tauri::command]
async fn terminal_start_agent_many(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    requests: Vec<TerminalStartAgentRequest>,
) -> Result<TerminalStartAgentManyResult, String> {
    ensure_app_not_shutting_down("terminal agent batch start")?;
    let lifecycle_lock = Arc::clone(&state.lifecycle_lock);
    let _lifecycle_guard = lifecycle_lock.lock().await;
    ensure_app_not_shutting_down("terminal agent batch start")?;
    if requests.len() > MAX_TERMINAL_START_AGENT_BATCH {
        return Err(format!(
            "Cannot start more than {MAX_TERMINAL_START_AGENT_BATCH} terminal agents at once."
        ));
    }
    require_cloud_mcp_connected_state(cloud_mcp_state.inner()).await?;

    let mut join_set = tokio::task::JoinSet::new();

    for request in requests {
        let terminals = Arc::clone(&state.terminals);
        let parked_prompts = Arc::clone(&state.parked_prompts);
        let app = app.clone();
        let cloud_mcp_state = cloud_mcp_state.inner().clone();

        join_set.spawn(async move {
            start_terminal_agent_in_prepared_pty(
                app,
                cloud_mcp_state,
                terminals,
                parked_prompts,
                request,
            )
            .await
        });
    }

    let mut results = Vec::new();

    while let Some(result) = join_set.join_next().await {
        match result {
            Ok(result) => results.push(result),
            Err(error) => results.push(TerminalStartAgentPaneResult {
                pane_id: String::new(),
                instance_id: None,
                started: false,
                skipped: false,
                message: format!("Unable to join terminal agent start task: {error}"),
            }),
        }
    }

    let started = results.iter().filter(|result| result.started).count();
    let skipped = results.iter().filter(|result| result.skipped).count();

    Ok(TerminalStartAgentManyResult {
        started,
        skipped,
        results,
    })
}

#[tauri::command]
fn set_terminal_audio_input_target(
    state: State<'_, TerminalState>,
    pane_id: String,
    instance_id: Option<u64>,
    active: bool,
) -> Result<(), String> {
    set_terminal_audio_input_target_for(&state, pane_id, instance_id, active)
}

#[tauri::command]
async fn terminal_write_to_audio_input_target(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    data: String,
) -> Result<bool, String> {
    if active_terminal_audio_input_target(&state)?.is_none() {
        write_thread_bridge_diagnostic_log_entry(json!({
            "ts_ms": current_time_ms(),
            "phase": "backend.audio_input_target.write_skip",
            "source": "backend",
            "app_pid": std::process::id(),
            "thread": terminal_diagnostic_thread_label(),
            "fields": {
                "data": terminal_write_data_diagnostic(&data),
                "reason": "missing_active_target",
            },
        }));
        return Ok(false);
    }

    let wrote =
        write_to_active_terminal_audio_input_target(&app, &state, &cloud_mcp_state, &data).await?;
    write_thread_bridge_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": "backend.audio_input_target.write_done",
        "source": "backend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": {
            "data": terminal_write_data_diagnostic(&data),
            "wrote": wrote,
        },
    }));

    Ok(wrote)
}

fn terminal_input_gate_line_char_len(gate: &TerminalInputGate) -> usize {
    gate.current_line.chars().count()
}

fn terminal_input_gate_clamp_cursor(gate: &mut TerminalInputGate) {
    let len = terminal_input_gate_line_char_len(gate);
    if gate.cursor_position > len {
        gate.cursor_position = len;
    }
}

fn terminal_input_gate_byte_index(line: &str, char_index: usize) -> usize {
    if char_index == 0 {
        return 0;
    }

    line.char_indices()
        .nth(char_index)
        .map(|(index, _)| index)
        .unwrap_or(line.len())
}

fn terminal_input_gate_previous_word_boundary(line: &str, cursor: usize) -> usize {
    let chars = line.chars().collect::<Vec<_>>();
    let mut index = cursor.min(chars.len());
    while index > 0 && chars[index - 1].is_whitespace() {
        index -= 1;
    }
    while index > 0 && !chars[index - 1].is_whitespace() {
        index -= 1;
    }
    index
}

fn terminal_input_gate_next_word_boundary(line: &str, cursor: usize) -> usize {
    let chars = line.chars().collect::<Vec<_>>();
    let mut index = cursor.min(chars.len());
    while index < chars.len() && chars[index].is_whitespace() {
        index += 1;
    }
    while index < chars.len() && !chars[index].is_whitespace() {
        index += 1;
    }
    index
}

fn terminal_input_gate_replace_char_range(
    gate: &mut TerminalInputGate,
    start: usize,
    end: usize,
    replacement: &str,
) {
    terminal_input_gate_clamp_cursor(gate);
    let len = terminal_input_gate_line_char_len(gate);
    let safe_start = start.min(len);
    let safe_end = end.min(len).max(safe_start);
    let byte_start = terminal_input_gate_byte_index(&gate.current_line, safe_start);
    let byte_end = terminal_input_gate_byte_index(&gate.current_line, safe_end);
    gate.current_line
        .replace_range(byte_start..byte_end, replacement);
    gate.cursor_position = safe_start + replacement.chars().count();
    gate.current_line_user_touched = true;
}

fn terminal_input_gate_insert_char(gate: &mut TerminalInputGate, character: char) {
    terminal_input_gate_clamp_cursor(gate);
    let byte_index = terminal_input_gate_byte_index(&gate.current_line, gate.cursor_position);
    gate.current_line.insert(byte_index, character);
    gate.cursor_position += 1;
    gate.current_line_user_touched = true;
}

fn terminal_input_gate_delete_before_cursor(gate: &mut TerminalInputGate) {
    terminal_input_gate_clamp_cursor(gate);
    if gate.cursor_position == 0 {
        return;
    }

    let start = terminal_input_gate_byte_index(&gate.current_line, gate.cursor_position - 1);
    let end = terminal_input_gate_byte_index(&gate.current_line, gate.cursor_position);
    gate.current_line.replace_range(start..end, "");
    gate.cursor_position -= 1;
    gate.current_line_user_touched = true;
}

fn terminal_input_gate_delete_at_cursor(gate: &mut TerminalInputGate) {
    terminal_input_gate_clamp_cursor(gate);
    if gate.cursor_position >= terminal_input_gate_line_char_len(gate) {
        return;
    }

    let start = terminal_input_gate_byte_index(&gate.current_line, gate.cursor_position);
    let end = terminal_input_gate_byte_index(&gate.current_line, gate.cursor_position + 1);
    gate.current_line.replace_range(start..end, "");
    gate.current_line_user_touched = true;
}

fn terminal_input_gate_delete_before_word(gate: &mut TerminalInputGate) {
    terminal_input_gate_clamp_cursor(gate);
    let start =
        terminal_input_gate_previous_word_boundary(&gate.current_line, gate.cursor_position);
    terminal_input_gate_replace_char_range(gate, start, gate.cursor_position, "");
}

fn terminal_input_gate_delete_after_word(gate: &mut TerminalInputGate) {
    terminal_input_gate_clamp_cursor(gate);
    let end = terminal_input_gate_next_word_boundary(&gate.current_line, gate.cursor_position);
    terminal_input_gate_replace_char_range(gate, gate.cursor_position, end, "");
}

fn terminal_input_gate_apply_csi(gate: &mut TerminalInputGate) {
    let Some(final_char) = gate.ansi_csi_buffer.chars().last() else {
        return;
    };
    let params_text = gate
        .ansi_csi_buffer
        .strip_suffix(final_char)
        .unwrap_or_default();
    let params = params_text
        .split(';')
        .filter_map(|part| {
            let clean = part.trim_start_matches('?');
            if clean.is_empty() {
                None
            } else {
                clean.parse::<usize>().ok()
            }
        })
        .collect::<Vec<_>>();
    let amount = params.first().copied().unwrap_or(1).max(1);
    let modifier = params.get(1).copied().unwrap_or(1);
    let word_mode = matches!(modifier, 3 | 4 | 5 | 6 | 7 | 8);

    match final_char {
        'C' => {
            if word_mode {
                gate.cursor_position = terminal_input_gate_next_word_boundary(
                    &gate.current_line,
                    gate.cursor_position,
                );
            } else {
                gate.cursor_position =
                    (gate.cursor_position + amount).min(terminal_input_gate_line_char_len(gate));
            }
        }
        'D' => {
            if word_mode {
                gate.cursor_position = terminal_input_gate_previous_word_boundary(
                    &gate.current_line,
                    gate.cursor_position,
                );
            } else {
                gate.cursor_position = gate.cursor_position.saturating_sub(amount);
            }
        }
        'H' => {
            gate.cursor_position = 0;
        }
        'F' => {
            gate.cursor_position = terminal_input_gate_line_char_len(gate);
        }
        '~' => match params.first().copied().unwrap_or_default() {
            1 | 7 => gate.cursor_position = 0,
            3 => terminal_input_gate_delete_at_cursor(gate),
            4 | 8 => gate.cursor_position = terminal_input_gate_line_char_len(gate),
            _ => {}
        },
        _ => {}
    }
}

fn terminal_observe_input_gate_submitted_prompt(
    gate: &mut TerminalInputGate,
    data: &str,
) -> Option<String> {
    let mut submitted = None;

    if data == TERMINAL_SHIFT_ENTER_SEQUENCE {
        terminal_input_gate_insert_char(gate, '\n');
        gate.current_line_user_touched = true;
        return None;
    }

    let normalized_data;
    let data =
        if data.contains(TERMINAL_ENTER_SEQUENCE) || data.contains(TERMINAL_ENTER_SEQUENCE_MOD1) {
            normalized_data = data
                .replace(TERMINAL_ENTER_SEQUENCE_MOD1, "\r")
                .replace(TERMINAL_ENTER_SEQUENCE, "\r");
            normalized_data.as_str()
        } else {
            data
        };
    let stripped_color_reply_data = strip_bare_terminal_color_reply_input(data);
    let data = stripped_color_reply_data.as_deref().unwrap_or(data);

    for character in data.chars() {
        if gate.ansi_osc_active {
            if gate.ansi_osc_escape_pending {
                gate.ansi_osc_escape_pending = false;
                if character == '\\' {
                    gate.ansi_osc_active = false;
                    gate.ansi_escape_active = false;
                }
                continue;
            }
            if character == '\u{1b}' {
                gate.ansi_osc_escape_pending = true;
                continue;
            }
            if character == '\u{7}' {
                gate.ansi_osc_active = false;
                gate.ansi_escape_active = false;
                continue;
            }
            continue;
        }

        if gate.ansi_csi_active {
            gate.ansi_csi_buffer.push(character);
            let code = character as u32;
            if (0x40..=0x7e).contains(&code) {
                terminal_input_gate_apply_csi(gate);
                gate.ansi_csi_buffer.clear();
                gate.ansi_csi_active = false;
                gate.ansi_escape_active = false;
            }
            continue;
        }

        if gate.ansi_ss3_active {
            match character {
                'C' => {
                    gate.cursor_position =
                        (gate.cursor_position + 1).min(terminal_input_gate_line_char_len(gate));
                }
                'D' => {
                    gate.cursor_position = gate.cursor_position.saturating_sub(1);
                }
                'H' => {
                    gate.cursor_position = 0;
                }
                'F' => {
                    gate.cursor_position = terminal_input_gate_line_char_len(gate);
                }
                _ => {}
            }
            gate.ansi_ss3_active = false;
            gate.ansi_escape_active = false;
            continue;
        }

        if gate.ansi_escape_active {
            match character {
                '[' => {
                    gate.ansi_csi_active = true;
                    gate.ansi_csi_buffer.clear();
                }
                ']' | 'P' | '^' | '_' | 'X' => {
                    gate.ansi_osc_active = true;
                    gate.ansi_osc_escape_pending = false;
                }
                'O' => {
                    gate.ansi_ss3_active = true;
                }
                'b' | 'B' => {
                    gate.cursor_position = terminal_input_gate_previous_word_boundary(
                        &gate.current_line,
                        gate.cursor_position,
                    );
                    gate.ansi_escape_active = false;
                }
                'f' | 'F' => {
                    gate.cursor_position = terminal_input_gate_next_word_boundary(
                        &gate.current_line,
                        gate.cursor_position,
                    );
                    gate.ansi_escape_active = false;
                }
                'd' => {
                    terminal_input_gate_delete_after_word(gate);
                    gate.ansi_escape_active = false;
                }
                '\u{7f}' => {
                    terminal_input_gate_delete_before_word(gate);
                    gate.ansi_escape_active = false;
                }
                _ => {
                    gate.ansi_escape_active = false;
                }
            }
            continue;
        }

        match character {
            '\r' | '\n' => {
                let prompt = gate.current_line.trim().to_string();
                gate.current_line.clear();
                gate.cursor_position = 0;
                gate.current_line_user_touched = false;
                if !prompt.is_empty() && !is_terminal_color_reply_prompt(&prompt) {
                    submitted = Some(prompt);
                }
            }
            '\u{7f}' | '\u{8}' => {
                terminal_input_gate_delete_before_cursor(gate);
            }
            '\u{15}' => {
                gate.current_line.clear();
                gate.cursor_position = 0;
                gate.current_line_user_touched = true;
            }
            '\u{11}' => {
                let start = gate
                    .cursor_position
                    .min(terminal_input_gate_line_char_len(gate));
                let end = terminal_input_gate_line_char_len(gate);
                terminal_input_gate_replace_char_range(gate, start, end, "");
            }
            '\u{17}' => {
                terminal_input_gate_delete_before_word(gate);
            }
            '\u{1}' => {
                gate.cursor_position = 0;
            }
            '\u{5}' => {
                gate.cursor_position = terminal_input_gate_line_char_len(gate);
            }
            '\u{1b}' => {
                gate.ansi_escape_active = true;
                gate.ansi_csi_active = false;
                gate.ansi_csi_buffer.clear();
                gate.ansi_osc_active = false;
                gate.ansi_osc_escape_pending = false;
                gate.ansi_ss3_active = false;
            }
            character if character.is_control() => {}
            character => {
                terminal_input_gate_insert_char(gate, character);
                if gate.current_line.len() > 8192 {
                    let drain_to = gate.current_line.len().saturating_sub(4096);
                    gate.current_line.drain(..drain_to);
                    gate.cursor_position = terminal_input_gate_line_char_len(gate);
                }
            }
        }
    }

    submitted
}

fn terminal_input_gate_diagnostic_snapshot(gate: &TerminalInputGate) -> Value {
    let current_line = gate.current_line.as_str();
    json!({
        "ansi_csi_active": gate.ansi_csi_active,
        "ansi_csi_buffer": clean_terminal_diagnostic_log_text(&gate.ansi_csi_buffer),
        "ansi_escape_active": gate.ansi_escape_active,
        "ansi_osc_active": gate.ansi_osc_active,
        "ansi_osc_escape_pending": gate.ansi_osc_escape_pending,
        "ansi_ss3_active": gate.ansi_ss3_active,
        "current_line_len": current_line.len(),
        "current_line_preview": clean_terminal_diagnostic_log_text(current_line),
        "current_line_tail": clean_terminal_diagnostic_log_text(
            &current_line
                .chars()
                .rev()
                .take(180)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>(),
        ),
        "current_line_user_touched": gate.current_line_user_touched,
        "cursor_position": gate.cursor_position,
        "trimmed_line_len": current_line.trim().len(),
    })
}

fn terminal_write_data_hex_prefix(data: &str) -> String {
    data.as_bytes()
        .iter()
        .take(64)
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn terminal_write_data_diagnostic(data: &str) -> Value {
    json!({
        "byte_hex_prefix": terminal_write_data_hex_prefix(data),
        "contains_enter_sequence": data.contains(TERMINAL_ENTER_SEQUENCE),
        "contains_enter_sequence_mod1": data.contains(TERMINAL_ENTER_SEQUENCE_MOD1),
        "contains_shift_enter_sequence": data.contains(TERMINAL_SHIFT_ENTER_SEQUENCE),
        "data_len": data.len(),
        "has_backspace": data.contains('\u{8}') || data.contains('\u{7f}'),
        "has_carriage_return": data.contains('\r'),
        "has_escape": data.contains('\u{1b}'),
        "has_line_feed": data.contains('\n'),
        "is_only_submit": matches!(data, "\r" | "\n"),
        "is_only_carriage_return": data == "\r",
        "is_only_enter_sequence": data == TERMINAL_ENTER_SEQUENCE || data == TERMINAL_ENTER_SEQUENCE_MOD1,
        "is_only_line_feed": data == "\n",
        "is_only_shift_enter_sequence": data == TERMINAL_SHIFT_ENTER_SEQUENCE,
        "preview": clean_terminal_diagnostic_log_text(data),
        "starts_with_escape": data.starts_with('\u{1b}'),
    })
}

fn terminal_input_write_has_prompt_event(
    prompt_event_id: &Option<String>,
    prompt_event_text: &Option<String>,
) -> bool {
    prompt_event_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || prompt_event_text
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
}

fn terminal_input_write_diagnostic_kind(
    data: &str,
    prompt_event_id: &Option<String>,
    prompt_event_text: &Option<String>,
) -> Option<&'static str> {
    let has_prompt_event =
        terminal_input_write_has_prompt_event(prompt_event_id, prompt_event_text);
    if has_prompt_event && matches!(data, "\r" | "\n") {
        return Some("prompt_submit");
    }
    if has_prompt_event {
        return Some("prompt_event");
    }
    if data.contains('\u{15}') {
        return Some("force_replace_sync");
    }
    if data.contains(TERMINAL_SHIFT_ENTER_SEQUENCE) {
        return Some("shift_enter_sync");
    }
    if data.contains("\u{1b}[I") {
        return Some("focus_in");
    }
    if data.contains("\u{1b}[O") {
        return Some("focus_out");
    }
    if matches!(data, "\r" | "\n") {
        return Some("submit_without_prompt_event");
    }

    None
}

fn terminal_input_gate_snapshot_u64(snapshot: &Value, key: &str) -> u64 {
    snapshot
        .get(key)
        .and_then(Value::as_u64)
        .unwrap_or_default()
}

fn terminal_prompt_observer_not_observed_reason(
    data: &str,
    input_gate_before: &Value,
    input_gate_after: &Value,
) -> &'static str {
    if matches!(data, "\r" | "\n")
        && terminal_input_gate_snapshot_u64(input_gate_before, "trimmed_line_len") == 0
    {
        return "submit_with_empty_input_gate";
    }
    if data.contains('\r') || data.contains('\n') {
        return "submit_boundary_without_accepted_prompt";
    }
    if data.contains(TERMINAL_SHIFT_ENTER_SEQUENCE) {
        return "shift_enter_without_submit";
    }
    if terminal_input_gate_snapshot_u64(input_gate_after, "trimmed_line_len") > 0 {
        return "input_buffered_without_submit_boundary";
    }

    "control_or_empty_input"
}

fn find_bare_terminal_color_reply_start(data: &str) -> Option<usize> {
    let lower = data.to_ascii_lowercase();
    ["]10;rgb:", "]11;rgb:", "]12;rgb:"]
        .iter()
        .filter_map(|pattern| lower.find(pattern))
        .filter(|index| *index == 0 || data.as_bytes().get(index.saturating_sub(1)) != Some(&0x1b))
        .min()
}

fn strip_bare_terminal_color_reply_input(data: &str) -> Option<String> {
    let mut cursor = 0;
    let mut output = String::new();
    let mut changed = false;

    while cursor < data.len() {
        let Some(mut start) =
            find_bare_terminal_color_reply_start(&data[cursor..]).map(|index| cursor + index)
        else {
            output.push_str(&data[cursor..]);
            break;
        };

        if start > cursor && data.as_bytes().get(start - 1) == Some(&b'\\') {
            start -= 1;
        }

        output.push_str(&data[cursor..start]);
        let mut end = data.len();
        for (offset, character) in data[start..].char_indices() {
            if character == '\\' || character == '\u{7}' {
                end = start + offset + character.len_utf8();
                break;
            }
            if character == '\r' || character == '\n' {
                end = start + offset;
                break;
            }
        }
        cursor = end;
        changed = true;
    }

    changed.then_some(output)
}

fn is_terminal_color_reply_prompt(prompt: &str) -> bool {
    let text = prompt
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>()
        .to_ascii_lowercase();

    ["]10;rgb:", "]11;rgb:", "]12;rgb:"]
        .iter()
        .any(|pattern| text.contains(pattern))
}

fn normalize_terminal_enter_sequences_for_pty(data: String) -> String {
    if data.contains(TERMINAL_ENTER_SEQUENCE) || data.contains(TERMINAL_ENTER_SEQUENCE_MOD1) {
        return data
            .replace(TERMINAL_ENTER_SEQUENCE_MOD1, "\r")
            .replace(TERMINAL_ENTER_SEQUENCE, "\r");
    }

    data
}

async fn terminal_observe_submitted_prompt(
    instance: &TerminalInstance,
    data: &str,
) -> (Option<String>, Value, Value) {
    let mut gate = instance.input_gate.lock().await;
    let before = terminal_input_gate_diagnostic_snapshot(&gate);
    let submitted = terminal_observe_input_gate_submitted_prompt(&mut gate, data);
    let after = terminal_input_gate_diagnostic_snapshot(&gate);

    (submitted, before, after)
}

fn is_terminal_control_prompt(prompt: &str) -> bool {
    prompt.trim_start().starts_with('/') || is_terminal_model_picker_ui_prompt(prompt)
}

fn normalize_terminal_control_prompt_text(prompt: &str) -> String {
    let mut text = prompt
        .replace('\u{00a0}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    loop {
        let trimmed = text.trim_start();
        let mut chars = trimmed.chars();
        let Some(first) = chars.next() else {
            return String::new();
        };
        if matches!(
            first,
            '›' | '❯' | '❱' | '>' | '*' | '•' | '●' | '○' | '◉' | '✓' | '✔' | '+' | '-'
        ) {
            text = chars.as_str().trim_start().to_string();
            continue;
        }
        return trimmed.to_string();
    }
}

fn is_numbered_terminal_model_picker_row(text: &str) -> bool {
    let Some((index, rest)) = text.split_once('.') else {
        return false;
    };
    !index.is_empty()
        && index.chars().all(|character| character.is_ascii_digit())
        && rest.trim_start().to_ascii_lowercase().starts_with("gpt-")
}

fn is_numbered_terminal_reasoning_picker_row(text: &str) -> bool {
    let Some((index, rest)) = text.split_once('.') else {
        return false;
    };
    if index.is_empty() || !index.chars().all(|character| character.is_ascii_digit()) {
        return false;
    }

    matches!(
        rest.trim_start().to_ascii_lowercase().as_str(),
        value if value.starts_with("low")
            || value.starts_with("medium")
            || value.starts_with("high")
            || value.starts_with("xhigh")
            || value.starts_with("extra high")
    )
}

fn is_terminal_model_picker_ui_prompt(prompt: &str) -> bool {
    let text = normalize_terminal_control_prompt_text(prompt);
    if text.is_empty() {
        return false;
    }

    if is_numbered_terminal_model_picker_row(&text)
        || is_numbered_terminal_reasoning_picker_row(&text)
    {
        return true;
    }

    let lower = text.to_ascii_lowercase();
    lower.contains("select model and effort")
        || lower.contains("access legacy models by running codex -m")
        || (lower.contains("select model") && lower.contains("gpt-"))
        || lower.contains("select reasoning level")
        || (lower.contains("press enter to confirm")
            && lower.contains("esc")
            && lower.contains("go back"))
}

fn terminal_prompt_task_title(prompt: &str) -> String {
    let cleaned = clean_terminal_telemetry_text(prompt)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if cleaned.is_empty() {
        return "Complete requested terminal task".to_string();
    }

    let lower = cleaned.to_ascii_lowercase();
    let action = if lower.contains("pricing") && (lower.contains("half") || lower.contains("halve"))
    {
        "Halve pricing values"
    } else if lower.contains("pricing") && lower.contains("double") {
        "Double pricing values"
    } else if lower.contains("pricing") && (lower.contains("redesign") || lower.contains("style")) {
        "Redesign pricing page"
    } else if lower.contains("pricing") || lower.contains("price") {
        "Update pricing page"
    } else if lower.contains("test") {
        "Write tests"
    } else if lower.contains("fix") || lower.contains("bug") {
        "Fix requested issue"
    } else if lower.contains("audit") || lower.contains("review") {
        "Audit requested work"
    } else if lower.contains("html")
        || lower.contains("landing")
        || lower.contains("splash")
        || lower.contains("slash page")
    {
        "Create landing page"
    } else if lower.contains("create") || lower.contains("make") || lower.contains("add") {
        "Create requested implementation"
    } else {
        "Complete requested terminal task"
    };
    let subject = if lower.contains("black") && lower.contains("supercar") {
        " for black supercar"
    } else if lower.contains("supercar") {
        " for supercar"
    } else if lower.contains("car") {
        " for car project"
    } else if lower.contains("waitlist") || lower.contains("wishlist") {
        " with list flow"
    } else {
        ""
    };
    let qualifier = if lower.contains("minimal") || lower.contains("simple") {
        " minimally"
    } else {
        ""
    };
    format!("{action}{subject}{qualifier}")
}

fn terminal_placeholder_task_title(value: &str) -> bool {
    matches!(
        value.trim(),
        "Agent preparing requested work" | "Complete requested terminal task"
    )
}

fn terminal_placeholder_task_body(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    lower.is_empty()
        || lower.contains("has not named the task yet")
        || lower == "the agent is preparing the requested work and has not named the task yet."
}

#[derive(Clone)]
struct TerminalParkingSnapshot {
    task_id: String,
    title: String,
    prompt: String,
    ready: bool,
    terminal: bool,
    waiting_on: Vec<TerminalParkedWaitingOn>,
    parked_resource_intents: Vec<Value>,
}

fn terminal_parked_prompt_key(pane_id: &str, instance_id: u64, task_id: &str) -> String {
    format!("{pane_id}:{instance_id}:{task_id}")
}

fn terminal_waiting_agent_label(agent_id: &str) -> String {
    let short = agent_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(3)
        .collect::<String>();
    if short.is_empty() {
        "agt".to_string()
    } else {
        short
    }
}

fn terminal_waiting_slot_label(slot_key: &str) -> String {
    let short = slot_key
        .trim()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(3)
        .collect::<String>();
    if short.is_empty() {
        "slot".to_string()
    } else {
        short
    }
}

fn terminal_push_unique_waiting_on(
    waiting_on: &mut Vec<TerminalParkedWaitingOn>,
    next: TerminalParkedWaitingOn,
) {
    let next_key = (
        next.task_id.clone(),
        next.agent_id.clone(),
        next.agent_label.clone(),
        next.slot_key.clone(),
    );
    if waiting_on.iter().any(|existing| {
        (
            existing.task_id.clone(),
            existing.agent_id.clone(),
            existing.agent_label.clone(),
            existing.slot_key.clone(),
        ) == next_key
    }) {
        return;
    }
    waiting_on.push(next);
}

fn terminal_parked_waiting_on_from_blocking_dependencies(
    dependencies: &Value,
) -> Vec<TerminalParkedWaitingOn> {
    let mut waiting_on = Vec::new();
    let Some(items) = dependencies.as_array() else {
        return waiting_on;
    };
    for item in items {
        if item["satisfied"].as_bool() == Some(true) {
            continue;
        }
        let agent_id = item["depends_on_agent_id"].as_str().map(str::to_string);
        let slot_key = item["depends_on_slot_key"].as_str().map(str::to_string);
        let agent_label = agent_id
            .as_deref()
            .map(terminal_waiting_agent_label)
            .or_else(|| slot_key.as_deref().map(terminal_waiting_slot_label));
        terminal_push_unique_waiting_on(
            &mut waiting_on,
            TerminalParkedWaitingOn {
                agent_id,
                agent_label,
                slot_key,
                task_id: item["depends_on_task_id"].as_str().map(str::to_string),
                task_title: item["depends_on_title"].as_str().map(str::to_string),
                resource_key: item["resource_key"].as_str().map(str::to_string),
            },
        );
    }
    waiting_on
}

fn terminal_task_status_is_terminal(status: &str) -> bool {
    matches!(
        status,
        "merged" | "done" | "completed" | "cancelled" | "interrupted" | "skipped"
    )
}

fn terminal_parking_snapshot_from_kernel(
    coordination: &TerminalCoordinationSession,
) -> Result<Option<TerminalParkingSnapshot>, String> {
    let kernel = crate::coordination::CoordinationKernel::open(
        &coordination.repo_path,
        Some(PathBuf::from(&coordination.db_path)),
    )?;
    let _ = kernel.recover_resume_ready_task_for_session(
        &coordination.session_id,
        "terminal_parking_snapshot_event",
    );
    let session_rows = kernel.query_json(
        "SELECT s.task_id,
                s.status AS session_status,
                t.title,
                t.body,
                t.status AS task_status
         FROM agent_sessions s
         LEFT JOIN tasks t ON t.id = s.task_id
         WHERE s.id=?1
         LIMIT 1",
        &[&coordination.session_id],
    )?;
    let Some(session_row) = session_rows.first() else {
        return Ok(None);
    };
    let Some(task_id) = session_row["task_id"]
        .as_str()
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };

    let raw_title = session_row["title"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Parked Diff Forge task")
        .to_string();
    let raw_body = session_row["body"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Continue the queued work now that the dependency has cleared.")
        .to_string();
    let body = if terminal_placeholder_task_body(&raw_body) {
        "Continue the queued work now that the dependency has cleared.".to_string()
    } else {
        raw_body
    };
    let title = if terminal_placeholder_task_title(&raw_title) {
        terminal_prompt_task_title(&body)
    } else {
        raw_title
    };
    let task_status = session_row["task_status"]
        .as_str()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let session_status = session_row["session_status"]
        .as_str()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let terminal = terminal_task_status_is_terminal(&task_status);
    let blocking_dependencies = kernel.query_json(
        "SELECT d.task_id,
                d.depends_on_task_id,
                d.dependency_kind,
                d.created_at,
                dependency.title AS depends_on_title,
                dependency.status AS depends_on_status,
                dependency_session.agent_id AS depends_on_agent_id,
                dependency_slot.slot_key AS depends_on_slot_key,
                intent.resource_key AS resource_key,
                0 AS satisfied
         FROM task_dependencies d
         LEFT JOIN tasks dependency ON dependency.id = d.depends_on_task_id
         LEFT JOIN agent_sessions dependency_session
           ON dependency_session.id = (
                SELECT s.id
                FROM agent_sessions s
                WHERE s.task_id = d.depends_on_task_id
                ORDER BY CASE WHEN s.status='active' THEN 0 ELSE 1 END,
                         s.updated_at DESC,
                         s.created_at DESC
                LIMIT 1
              )
         LEFT JOIN agent_slots dependency_slot ON dependency_slot.id = dependency_session.agent_slot_id
         LEFT JOIN task_resource_intents intent
           ON intent.task_id = d.task_id
          AND intent.depends_on_task_id = d.depends_on_task_id
         WHERE d.task_id=?1
           AND (dependency.status IS NULL OR dependency.status NOT IN ('done', 'completed', 'merged', 'cancelled', 'interrupted', 'skipped'))
         ORDER BY d.created_at ASC",
        &[&task_id],
    )?;
    let parked_resource_intents = kernel.query_json(
        "SELECT i.task_id,
                i.resource_key,
                i.status,
                i.intent_summary,
                i.depends_on_task_id,
                i.lease_id,
                i.updated_at,
                dependency.title AS depends_on_title,
                dependency.status AS depends_on_status,
                dependency_session.agent_id AS depends_on_agent_id,
                dependency_slot.slot_key AS depends_on_slot_key,
                dependency_lease.id AS depends_on_lease_id,
                dependency_lease.status AS depends_on_lease_status,
                dependency_lease.reason AS depends_on_lease_reason,
                dependency_lease.released_at AS depends_on_lease_released_at,
                0 AS satisfied
         FROM task_resource_intents i
         LEFT JOIN tasks dependency ON dependency.id = i.depends_on_task_id
         LEFT JOIN agent_sessions dependency_session
           ON dependency_session.id = (
                SELECT s.id
                FROM agent_sessions s
                WHERE s.task_id = i.depends_on_task_id
                ORDER BY CASE WHEN s.status='active' THEN 0 ELSE 1 END,
                         s.updated_at DESC,
                         s.created_at DESC
                LIMIT 1
              )
         LEFT JOIN agent_slots dependency_slot ON dependency_slot.id = dependency_session.agent_slot_id
         LEFT JOIN leases dependency_lease
           ON dependency_lease.id = (
                SELECT l.id
                FROM leases l
                JOIN resources leased_resource ON leased_resource.id = l.resource_id
                WHERE l.task_id = i.depends_on_task_id
                  AND leased_resource.resource_key = i.resource_key
                ORDER BY CASE WHEN l.status='active' THEN 0 ELSE 1 END,
                         COALESCE(l.released_at, l.last_heartbeat_at, l.acquired_at) DESC,
                         l.acquired_at DESC
                LIMIT 1
              )
         WHERE i.task_id=?1
           AND i.status IN ('parked', 'parked_cycle_prevented', 'resume_ready', 'resume_requested')
         ORDER BY i.updated_at ASC",
        &[&task_id],
    )?;

    let mut waiting_on = terminal_parked_waiting_on_from_blocking_dependencies(&Value::Array(
        blocking_dependencies.clone(),
    ));
    for blocker in terminal_parked_waiting_on_from_blocking_dependencies(&Value::Array(
        parked_resource_intents.clone(),
    )) {
        terminal_push_unique_waiting_on(&mut waiting_on, blocker);
    }

    let ready = !terminal
        && blocking_dependencies.is_empty()
        && !parked_resource_intents.is_empty()
        && matches!(task_status.as_str(), "ready" | "claimed")
        && session_status == "active";

    Ok(Some(TerminalParkingSnapshot {
        task_id,
        title: title.clone(),
        prompt: body,
        ready,
        terminal,
        waiting_on,
        parked_resource_intents,
    }))
}

fn terminal_resume_state_prompt(state: &Value) -> String {
    let raw_title = state["data"]["task"]["title"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Parked Diff Forge task");
    let raw_body = state["data"]["task"]["body"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Continue the queued work now that the dependency has cleared.");
    let body = if terminal_placeholder_task_body(raw_body) {
        "Continue the queued work now that the dependency has cleared."
    } else {
        raw_body
    };
    if terminal_placeholder_task_title(raw_title) {
        body.to_string()
    } else {
        format!("{raw_title}\n\n{body}")
    }
}

fn terminal_resume_clean_text(value: &str, max_chars: usize) -> String {
    let normalized = value.replace('\r', "\n");
    let mut lines = Vec::new();
    for line in normalized.lines() {
        let safe = line
            .chars()
            .map(|character| {
                if character.is_control() {
                    ' '
                } else {
                    character
                }
            })
            .collect::<String>();
        let compact = safe.split_whitespace().collect::<Vec<_>>().join(" ");
        if !compact.is_empty() {
            lines.push(compact);
        }
    }

    let cleaned = lines.join("\n").trim().to_string();
    if cleaned.chars().count() <= max_chars {
        return cleaned;
    }

    let take_chars = max_chars.saturating_sub(3);
    format!(
        "{}...",
        cleaned.chars().take(take_chars).collect::<String>()
    )
}

fn terminal_resume_value_text(value: Option<&str>, fallback: &str, max_chars: usize) -> String {
    let cleaned = value
        .map(|value| terminal_resume_clean_text(value, max_chars))
        .unwrap_or_default();
    if cleaned.is_empty() {
        terminal_resume_clean_text(fallback, max_chars)
    } else {
        cleaned
    }
}

fn terminal_resume_resource_label(resource_key: &str) -> String {
    let cleaned = terminal_resume_clean_text(resource_key, 120);
    cleaned
        .strip_prefix("file:")
        .map(str::to_string)
        .unwrap_or(cleaned)
}

fn terminal_resume_dependency_actor(intent: &Value) -> String {
    if let Some(agent_id) = intent["depends_on_agent_id"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return format!("agent {}", terminal_waiting_agent_label(agent_id));
    }
    if let Some(slot_key) = intent["depends_on_slot_key"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return format!("agent {}", terminal_waiting_slot_label(slot_key));
    }
    "another agent".to_string()
}

fn terminal_resume_dependency_title(intent: &Value) -> String {
    terminal_resume_value_text(
        intent["depends_on_title"].as_str(),
        "the blocking task",
        180,
    )
}

fn terminal_resume_original_task(
    fallback_title: &str,
    fallback_prompt: &str,
    resume_state: Option<&Value>,
) -> String {
    let state_prompt = resume_state.map(terminal_resume_state_prompt);
    let raw_prompt = state_prompt.as_deref().unwrap_or(fallback_prompt);
    let prompt = terminal_resume_clean_text(raw_prompt, 1400);
    let title = terminal_resume_clean_text(fallback_title, 300);
    let prompt_is_generic = terminal_placeholder_task_body(&prompt)
        || prompt
            .eq_ignore_ascii_case("Continue the queued work now that the dependency has cleared.");

    if prompt_is_generic || prompt.is_empty() {
        title
    } else if title.is_empty()
        || terminal_placeholder_task_title(&title)
        || prompt
            .to_ascii_lowercase()
            .contains(&title.to_ascii_lowercase())
    {
        prompt
    } else {
        format!("{title}\n{prompt}")
    }
}

fn terminal_resume_park_reason_lines(snapshot: &TerminalParkingSnapshot) -> Vec<String> {
    let mut lines = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for intent in &snapshot.parked_resource_intents {
        let resource = terminal_resume_resource_label(
            intent["resource_key"]
                .as_str()
                .unwrap_or("the requested resource"),
        );
        let actor = terminal_resume_dependency_actor(intent);
        let dependency_title = terminal_resume_dependency_title(intent);
        let intent_summary = terminal_resume_value_text(intent["intent_summary"].as_str(), "", 180);
        let blocker_reason =
            terminal_resume_value_text(intent["depends_on_lease_reason"].as_str(), "", 180);
        let key =
            format!("{resource}:{actor}:{dependency_title}:{intent_summary}:{blocker_reason}");
        if !seen.insert(key) {
            continue;
        }

        let line = if !intent_summary.is_empty() && !blocker_reason.is_empty() {
            format!(
                "- {resource}: you needed this for \"{intent_summary}\", but {actor} had leased it for \"{blocker_reason}\"."
            )
        } else if !intent_summary.is_empty() {
            format!(
                "- {resource}: you needed this for \"{intent_summary}\" and were waiting on {actor}'s task \"{dependency_title}\"."
            )
        } else if !blocker_reason.is_empty() {
            format!("- {resource}: parked because {actor} had leased it for \"{blocker_reason}\".")
        } else {
            format!("- {resource}: parked behind {actor}'s task \"{dependency_title}\".")
        };
        lines.push(line);
    }

    if lines.is_empty() {
        lines.push(
            "- The task was parked behind a local coordination dependency that has now cleared."
                .to_string(),
        );
    }
    lines
}

fn terminal_resume_dependency_resolution_lines(snapshot: &TerminalParkingSnapshot) -> Vec<String> {
    let mut lines = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for intent in &snapshot.parked_resource_intents {
        let resource = terminal_resume_resource_label(
            intent["resource_key"]
                .as_str()
                .unwrap_or("the requested resource"),
        );
        let actor = terminal_resume_dependency_actor(intent);
        let dependency_title = terminal_resume_dependency_title(intent);
        let task_status =
            terminal_resume_value_text(intent["depends_on_status"].as_str(), "cleared", 60);
        let lease_status =
            terminal_resume_value_text(intent["depends_on_lease_status"].as_str(), "", 60);
        let key = format!("{resource}:{actor}:{dependency_title}:{task_status}:{lease_status}");
        if !seen.insert(key) {
            continue;
        }

        let status_note = if lease_status.is_empty() {
            format!("task status is `{task_status}`")
        } else {
            format!("task status is `{task_status}` and lease status is `{lease_status}`")
        };
        lines.push(format!(
            "- {actor}'s dependency \"{dependency_title}\" has cleared for {resource}; {status_note}."
        ));
    }

    if lines.is_empty() {
        lines.push("- The dependency monitor marked this parked task resume-ready.".to_string());
    }
    lines
}

fn terminal_resume_refresh_note(resume_state: Option<&Value>) -> Option<String> {
    let refresh_count = resume_state
        .and_then(|state| state["data"]["worktree_refreshes"].as_array())
        .map(|items| items.len())
        .unwrap_or(0);
    if refresh_count == 0 {
        None
    } else {
        Some(format!(
            "- Diff Forge requested a worktree refresh for {refresh_count} checked-out worktree(s) before resuming."
        ))
    }
}

fn terminal_rich_parked_resume_prompt(
    snapshot: &TerminalParkingSnapshot,
    fallback_title: &str,
    fallback_prompt: &str,
    resume_state: Option<&Value>,
) -> String {
    let original_task =
        terminal_resume_original_task(fallback_title, fallback_prompt, resume_state);
    let parked_lines = terminal_resume_park_reason_lines(snapshot).join("\n");
    let resolved_lines = terminal_resume_dependency_resolution_lines(snapshot).join("\n");
    let refresh_note = terminal_resume_refresh_note(resume_state)
        .map(|line| format!("\n\nContext refresh:\n{line}"))
        .unwrap_or_default();

    format!(
        "Diff Forge parked task is ready to resume.\n\n\
Original task:\n{original_task}\n\n\
Why you were parked:\n{parked_lines}\n\n\
Dependency now resolved:\n{resolved_lines}{refresh_note}\n\n\
Continue now:\n\
1. Inspect the current target file(s) before editing so you do not work from stale context.\n\
2. Call coordination-kernel.start_task only when you are ready to edit, with a short continuation plan.\n\
3. Re-acquire the needed lease(s) using the task_id returned by start_task, continue the original task above, and submit the patch with that task_id when finished."
    )
}

fn emit_terminal_parked_prompt_event(
    app: &AppHandle,
    parked: &TerminalParkedPrompt,
    status: &str,
    reason: Option<&str>,
) {
    let _ = app.emit(
        TERMINAL_PARKED_PROMPT_EVENT,
        TerminalParkedPromptPayload {
            pane_id: parked.pane_id.clone(),
            instance_id: parked.instance_id,
            task_id: parked.task_id.clone(),
            title: parked.title.clone(),
            status: status.to_string(),
            waiting_on: parked.waiting_on.clone(),
            reason: reason.map(str::to_string),
            prompt_event_id: parked
                .voice_plan_prompt
                .as_ref()
                .map(|metadata| metadata.prompt_event_id.clone()),
            prompt_event_source: parked
                .voice_plan_prompt
                .as_ref()
                .and_then(|metadata| metadata.prompt_event_source.clone()),
            terminal_index: parked
                .voice_plan_prompt
                .as_ref()
                .and_then(|metadata| metadata.terminal_index),
            thread_id: parked
                .voice_plan_prompt
                .as_ref()
                .and_then(|metadata| metadata.thread_id.clone()),
            workspace_id: parked
                .voice_plan_prompt
                .as_ref()
                .map(|metadata| metadata.workspace_id.clone()),
            workspace_name: parked
                .voice_plan_prompt
                .as_ref()
                .map(|metadata| metadata.workspace_name.clone()),
        },
    );
}

static TERMINAL_COORDINATION_EVENT_APP: OnceLock<AppHandle> = OnceLock::new();

fn register_terminal_coordination_event_bridge(app: &tauri::App) {
    let _ = TERMINAL_COORDINATION_EVENT_APP.set(app.handle().clone());
}

pub(crate) fn observe_terminal_coordination_event(
    repo_path: PathBuf,
    db_path: PathBuf,
    event_type: String,
    refs: crate::coordination::kernel::EventRefs,
    payload: Value,
) {
    if matches!(
        event_type.as_str(),
        "terminal_todo_plan_checkpoint"
            | "terminal_todo_plan_step_title_edited"
            | "terminal_todo_plan_finished"
    ) {
        let Some(app) = TERMINAL_COORDINATION_EVENT_APP.get().cloned() else {
            return;
        };
        let refs_payload = json!({
            "taskId": refs.task_id,
            "agentId": refs.agent_id,
            "agentSlotId": refs.agent_slot_id,
            "sessionId": refs.session_id,
            "resourceId": refs.resource_id,
            "artifactId": refs.artifact_id,
            "contextRunId": refs.context_run_id,
        });
        let task_id = refs.task_id.clone();
        let agent_id = refs.agent_id.clone();
        let session_id = refs.session_id.clone();

        tauri::async_runtime::spawn(async move {
            sleep(Duration::from_millis(35)).await;
            let plan_repo_path = repo_path.clone();
            let plan_db_path = db_path.clone();
            let plan_task_id = task_id.clone();
            let plan_agent_id = agent_id.clone();
            let plan_session_id = session_id.clone();
            let plan_snapshot = tauri::async_runtime::spawn_blocking(move || {
                crate::coordination::CoordinationKernel::open(plan_repo_path, Some(plan_db_path))?
                    .terminal_todo_plan_event_snapshot(
                        plan_task_id.as_deref(),
                        plan_session_id.as_deref(),
                        plan_agent_id.as_deref(),
                    )
            })
            .await
            .ok()
            .and_then(Result::ok)
            .and_then(|value| value.get("data").cloned().or(Some(value)))
            .filter(|value| !value.is_null());
            let selected_plan = plan_snapshot
                .as_ref()
                .and_then(|snapshot| {
                    snapshot
                        .get("selected_plan")
                        .or_else(|| snapshot.get("selectedPlan"))
                })
                .cloned()
                .filter(|value| !value.is_null());
            let plan_history = plan_snapshot
                .as_ref()
                .and_then(|snapshot| snapshot.get("history"))
                .cloned()
                .unwrap_or_else(|| json!([]));
            let _ = app.emit(
                TERMINAL_TODO_PLAN_UPDATED_EVENT,
                json!({
                    "source": "coordination",
                    "repoPath": repo_path.display().to_string(),
                    "dbPath": db_path.display().to_string(),
                    "eventType": event_type,
                    "taskId": task_id,
                    "agentId": agent_id,
                    "sessionId": session_id,
                    "refs": refs_payload,
                    "plan": selected_plan.clone(),
                    "selectedPlan": selected_plan,
                    "history": plan_history,
                    "planSnapshot": plan_snapshot,
                    "payload": payload,
                }),
            );
        });
        return;
    }

    if !matches!(
        event_type.as_str(),
        "task_claimed"
            | "mcp_agent_tool_called"
            | "task_parked_for_resource_queue"
            | "active_file_lease_queue_waiter_released"
            | "task_resume_ready"
            | "task_unblocked"
            | "patch_submitted"
            | "task_noop_submitted"
            | "task_cancelled"
            | "task_interrupted"
            | "terminal_crash_recovery_interrupted_task"
            | "merge_succeeded"
    ) {
        return;
    }

    if event_type == "mcp_agent_tool_called"
        && payload["details"]["tool"].as_str() != Some("start_task")
    {
        return;
    }

    let Some(app) = TERMINAL_COORDINATION_EVENT_APP.get().cloned() else {
        return;
    };

    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(35)).await;
        terminal_handle_coordination_event(app, event_type, refs, payload).await;
    });
}

pub(crate) fn observe_workspace_notification_coordination_event(
    repo_path: PathBuf,
    db_path: PathBuf,
    event_id: String,
    event_seq: Option<i64>,
    created_at: String,
    event_type: String,
    refs: crate::coordination::kernel::EventRefs,
    payload: Value,
) {
    if !matches!(
        event_type.as_str(),
        "approval_requested"
            | "approval_request_reused"
            | "db_change_approval_required"
            | "approval_granted"
            | "approval_denied"
            | "db_change_approved"
            | "db_change_rejected"
            | "task_parked_for_resource_queue"
            | "active_file_lease_queue_waiter_released"
            | "task_resume_ready"
            | "task_unblocked"
            | "patch_submitted"
            | "task_noop_submitted"
            | "task_cancelled"
            | "task_interrupted"
            | "terminal_crash_recovery_interrupted_task"
            | "merge_succeeded"
            | "mcp_agent_tool_failed"
    ) {
        return;
    }

    let Some(app) = TERMINAL_COORDINATION_EVENT_APP.get().cloned() else {
        return;
    };

    let refs_payload = json!({
        "taskId": refs.task_id,
        "agentId": refs.agent_id,
        "agentSlotId": refs.agent_slot_id,
        "sessionId": refs.session_id,
        "resourceId": refs.resource_id,
        "artifactId": refs.artifact_id,
        "contextRunId": refs.context_run_id,
    });

    let notification_kind = match event_type.as_str() {
        "approval_requested" | "approval_request_reused" | "db_change_approval_required" => {
            "approval.required"
        }
        "approval_granted" | "approval_denied" | "db_change_approved" | "db_change_rejected" => {
            "approval.resolved"
        }
        "task_parked_for_resource_queue" => "task.parked",
        "active_file_lease_queue_waiter_released" | "task_resume_ready" | "task_unblocked" => {
            "task.resume_ready"
        }
        "patch_submitted" => "task.patch_submitted",
        "task_noop_submitted" => "task.skipped",
        "merge_succeeded" => "task.completed",
        "task_cancelled" | "task_interrupted" | "terminal_crash_recovery_interrupted_task" => {
            "task.stopped"
        }
        "mcp_agent_tool_failed" => "tool.failed",
        _ => "coordination.event",
    };

    let severity = match notification_kind {
        "approval.required" | "task.resume_ready" => "action_required",
        "task.completed" => "success",
        "tool.failed" | "task.stopped" => "warning",
        _ => "info",
    };

    let actionability = match notification_kind {
        "approval.required" => "approve_deny",
        "task.resume_ready" => "resume_task",
        "task.patch_submitted" => "review_patch",
        _ => "open_thread",
    };

    let _ = app.emit(
        WORKSPACE_NOTIFICATION_EVENT,
        json!({
            "source": "coordination",
            "eventId": event_id,
            "sourceEventId": event_id,
            "seq": event_seq,
            "createdAt": created_at,
            "repoPath": repo_path.display().to_string(),
            "dbPath": db_path.display().to_string(),
            "eventType": event_type,
            "kind": notification_kind,
            "severity": severity,
            "actionability": actionability,
            "refs": refs_payload,
            "payload": payload,
        }),
    );
}

async fn terminal_handle_coordination_event(
    app: AppHandle,
    event_type: String,
    refs: crate::coordination::kernel::EventRefs,
    payload: Value,
) {
    let (terminals, parked_prompts) = {
        let state = app.state::<TerminalState>();
        (state.terminals.clone(), state.parked_prompts.clone())
    };
    let cloud_mcp_state = app.state::<CloudMcpState>().inner().clone();

    log_terminal_diagnostic_event(
        &app,
        "backend.coordination_event_bridge",
        json!({
            "event_type": event_type.as_str(),
            "session_id": refs.session_id.as_deref().unwrap_or_default(),
            "task_id": refs.task_id.as_deref().unwrap_or_default(),
        }),
    );

    match event_type.as_str() {
        "task_claimed" => {
            terminal_handle_task_started_event(app, terminals, refs).await;
        }
        "mcp_agent_tool_called" if payload["details"]["tool"].as_str() == Some("start_task") => {
            terminal_handle_task_started_event(app, terminals, refs).await;
        }
        "task_parked_for_resource_queue" => {
            terminal_handle_task_parked_for_resource_event(
                app,
                cloud_mcp_state,
                terminals,
                parked_prompts,
                refs,
            )
            .await;
        }
        "active_file_lease_queue_waiter_released" | "task_resume_ready" | "task_unblocked" => {
            terminal_handle_resume_ready_event(
                app,
                cloud_mcp_state,
                terminals,
                parked_prompts,
                refs,
            )
            .await;
        }
        "patch_submitted"
        | "task_noop_submitted"
        | "task_cancelled"
        | "task_interrupted"
        | "terminal_crash_recovery_interrupted_task"
        | "merge_succeeded" => {
            terminal_handle_task_lifecycle_end_event(app, terminals, refs, payload, &event_type)
                .await;
        }
        _ => {}
    }
}

async fn terminal_handle_task_started_event(
    app: AppHandle,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    refs: crate::coordination::kernel::EventRefs,
) {
    let Some(task_id) = refs
        .task_id
        .as_deref()
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
    else {
        return;
    };

    let Some((pane_id, instance)) = terminal_find_instance_for_coordination_event(
        &terminals,
        refs.session_id.as_deref(),
        Some(&task_id),
    )
    .await
    else {
        return;
    };

    let title = instance
        .coordination
        .as_ref()
        .and_then(|coordination| {
            crate::coordination::CoordinationKernel::open(
                &coordination.repo_path,
                Some(PathBuf::from(&coordination.db_path)),
            )
            .ok()
            .and_then(|kernel| {
                kernel
                    .query_json("SELECT title FROM tasks WHERE id=?1 LIMIT 1", &[&task_id])
                    .ok()
                    .and_then(|rows| rows.into_iter().next())
                    .and_then(|task| {
                        task["title"]
                            .as_str()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(str::to_string)
                    })
            })
        })
        .unwrap_or_else(|| "Active terminal task".to_string());

    let mut active_task = instance.active_task.lock().await;
    if active_task
        .as_ref()
        .is_some_and(|active| active.task_id == task_id)
    {
        return;
    }
    *active_task = Some(TerminalActiveTask {
        task_id: task_id.clone(),
        title: title.clone(),
    });
    drop(active_task);

    log_terminal_diagnostic_event(
        &app,
        "backend.terminal_active_task.started",
        json!({
            "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
            "session_id": refs.session_id.as_deref().unwrap_or_default(),
            "task_id": task_id,
            "title": clean_terminal_diagnostic_log_text(&title),
        }),
    );
}

async fn terminal_handle_task_lifecycle_end_event(
    app: AppHandle,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    refs: crate::coordination::kernel::EventRefs,
    payload: Value,
    event_type: &str,
) {
    let Some(task_id) = refs
        .task_id
        .as_deref()
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
    else {
        return;
    };

    let Some((pane_id, instance)) = terminal_find_instance_for_coordination_event(
        &terminals,
        refs.session_id.as_deref(),
        Some(&task_id),
    )
    .await
    else {
        return;
    };

    let keep_active_for_resume = terminal_task_remains_active_for_resume(&instance, &task_id);
    if keep_active_for_resume {
        log_terminal_diagnostic_event(
            &app,
            "backend.terminal_active_task.kept_for_resume",
            json!({
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "session_id": refs.session_id.as_deref().unwrap_or_default(),
                "task_id": task_id,
                "event_type": event_type,
            }),
        );
        return;
    }

    let mut active_task = instance.active_task.lock().await;
    let cleared = active_task
        .as_ref()
        .is_some_and(|active| active.task_id == task_id);
    if cleared {
        *active_task = None;
    }
    drop(active_task);

    if cleared {
        log_terminal_diagnostic_event(
            &app,
            "backend.terminal_active_task.ended",
            json!({
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "session_id": refs.session_id.as_deref().unwrap_or_default(),
                "task_id": task_id,
                "event_type": event_type,
                "task_status": payload["task_status"]
                    .as_str()
                    .or_else(|| payload["status"].as_str())
                    .unwrap_or_default(),
            }),
        );
    }
}

fn terminal_task_remains_active_for_resume(instance: &TerminalInstance, task_id: &str) -> bool {
    let Some(coordination) = instance.coordination.as_ref() else {
        return false;
    };
    let Ok(kernel) = crate::coordination::CoordinationKernel::open(
        &coordination.repo_path,
        Some(PathBuf::from(&coordination.db_path)),
    ) else {
        return false;
    };
    let task = kernel
        .query_json("SELECT status FROM tasks WHERE id=?1 LIMIT 1", &[&task_id])
        .ok()
        .and_then(|rows| rows.into_iter().next());
    let status = task
        .as_ref()
        .and_then(|task| task["status"].as_str())
        .unwrap_or_default();
    if status == "claimed" {
        return true;
    }
    if !matches!(status, "ready" | "blocked" | "patch_submitted") {
        return false;
    }
    let parked_intent_count = kernel
        .query_json(
            "SELECT COUNT(1)
                    AS parked_intent_count
             FROM task_resource_intents
             WHERE task_id=?1
               AND status IN ('parked', 'parked_cycle_prevented', 'resume_ready', 'resume_requested')",
            &[&task_id],
        )
        .ok()
        .and_then(|rows| rows.into_iter().next())
        .and_then(|row| row["parked_intent_count"].as_i64())
        .unwrap_or(0);
    parked_intent_count > 0
}

async fn terminal_find_instance_for_coordination_event(
    terminals: &Arc<RwLock<HashMap<String, TerminalInstance>>>,
    session_id: Option<&str>,
    task_id: Option<&str>,
) -> Option<(String, TerminalInstance)> {
    let instances = {
        let guard = terminals.read().await;
        guard
            .iter()
            .map(|(pane_id, instance)| (pane_id.clone(), instance.clone()))
            .collect::<Vec<_>>()
    };

    if let Some(session_id) = session_id.filter(|value| !value.trim().is_empty()) {
        for (pane_id, instance) in &instances {
            if instance
                .coordination
                .as_ref()
                .is_some_and(|coordination| coordination.session_id == session_id)
            {
                return Some((pane_id.clone(), instance.clone()));
            }
        }
    }

    if let Some(task_id) = task_id.filter(|value| !value.trim().is_empty()) {
        for (pane_id, instance) in instances {
            let active_task_matches = {
                let active_task = instance.active_task.lock().await;
                active_task
                    .as_ref()
                    .is_some_and(|active| active.task_id == task_id)
            };
            if active_task_matches {
                return Some((pane_id, instance));
            }
        }
    }

    None
}

async fn terminal_find_parked_prompt_for_task(
    parked_prompts: &Arc<RwLock<HashMap<String, TerminalParkedPrompt>>>,
    task_id: &str,
) -> Option<TerminalParkedPrompt> {
    let guard = parked_prompts.read().await;
    guard
        .values()
        .find(|parked| parked.task_id == task_id && !parked.resume_claimed)
        .cloned()
}

async fn terminal_handle_task_parked_for_resource_event(
    app: AppHandle,
    cloud_mcp_state: CloudMcpState,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    parked_prompts: Arc<RwLock<HashMap<String, TerminalParkedPrompt>>>,
    refs: crate::coordination::kernel::EventRefs,
) {
    let task_id = refs.task_id.as_deref();
    let Some((pane_id, instance)) = terminal_find_instance_for_coordination_event(
        &terminals,
        refs.session_id.as_deref(),
        task_id,
    )
    .await
    else {
        return;
    };
    let Some(coordination) = instance.coordination.clone() else {
        return;
    };
    let Ok(Some(snapshot)) = terminal_parking_snapshot_from_kernel(&coordination) else {
        return;
    };
    if task_id.is_some_and(|expected| snapshot.task_id != expected) {
        return;
    }

    terminal_register_parked_prompt_from_snapshot(
        app,
        cloud_mcp_state,
        terminals,
        parked_prompts,
        pane_id,
        instance,
        coordination,
        snapshot,
        "lease_blocked_event",
    )
    .await;
}

async fn terminal_handle_resume_ready_event(
    app: AppHandle,
    cloud_mcp_state: CloudMcpState,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    parked_prompts: Arc<RwLock<HashMap<String, TerminalParkedPrompt>>>,
    refs: crate::coordination::kernel::EventRefs,
) {
    let Some(task_id) = refs
        .task_id
        .as_deref()
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
    else {
        return;
    };

    if let Some(parked) = terminal_find_parked_prompt_for_task(&parked_prompts, &task_id).await {
        terminal_resume_parked_prompt_once(app, cloud_mcp_state, terminals, parked_prompts, parked)
            .await;
        return;
    }

    let Some((pane_id, instance)) = terminal_find_instance_for_coordination_event(
        &terminals,
        refs.session_id.as_deref(),
        Some(&task_id),
    )
    .await
    else {
        return;
    };
    let Some(coordination) = instance.coordination.clone() else {
        return;
    };
    let Ok(Some(snapshot)) = terminal_parking_snapshot_from_kernel(&coordination) else {
        return;
    };
    if snapshot.task_id != task_id {
        return;
    }

    terminal_register_parked_prompt_from_snapshot(
        app,
        cloud_mcp_state,
        terminals,
        parked_prompts,
        pane_id,
        instance,
        coordination,
        snapshot,
        "dependency_ready_event",
    )
    .await;
}

async fn terminal_register_parked_prompt_from_snapshot(
    app: AppHandle,
    cloud_mcp_state: CloudMcpState,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    parked_prompts: Arc<RwLock<HashMap<String, TerminalParkedPrompt>>>,
    pane_id: String,
    instance: TerminalInstance,
    coordination: TerminalCoordinationSession,
    snapshot: TerminalParkingSnapshot,
    reason: &'static str,
) {
    let task_id = snapshot.task_id.clone();
    let title = snapshot.title.clone();
    let parked_key = terminal_parked_prompt_key(&pane_id, instance.id, &task_id);
    let voice_plan_prompt = cloud_mcp_voice_plan_prompt_metadata_for_terminal_task(
        &cloud_mcp_state,
        &pane_id,
        instance.id,
        &task_id,
    )
    .await;

    if snapshot.terminal {
        if let Some(parked) = parked_prompts.write().await.remove(&parked_key) {
            emit_terminal_parked_prompt_event(&app, &parked, "resumed", Some("task_terminal"));
        }
        let mut active_task = instance.active_task.lock().await;
        if active_task
            .as_ref()
            .is_some_and(|active| active.task_id == task_id)
        {
            *active_task = None;
        }
        return;
    }

    let waiting_on = snapshot.waiting_on.clone();
    let ready = snapshot.ready;
    if waiting_on.is_empty() && !ready {
        return;
    }

    {
        let mut active_task = instance.active_task.lock().await;
        if !active_task
            .as_ref()
            .is_some_and(|active| active.task_id == task_id)
        {
            *active_task = Some(TerminalActiveTask {
                task_id: task_id.clone(),
                title: title.clone(),
            });
        }
    }

    let mut prompt_to_emit = None;
    let mut prompt_to_mark = None;
    let mut prompt_to_resume = None;
    {
        let mut guard = parked_prompts.write().await;
        if let Some(existing) = guard.get_mut(&parked_key) {
            let mut changed = false;
            if existing.waiting_on != waiting_on {
                existing.waiting_on = waiting_on;
                changed = true;
            }
            if existing.title != title {
                existing.title = title.clone();
                changed = true;
            }
            if existing.prompt != snapshot.prompt {
                existing.prompt = snapshot.prompt.clone();
                changed = true;
            }
            if existing.voice_plan_prompt.is_none() && voice_plan_prompt.is_some() {
                existing.voice_plan_prompt = voice_plan_prompt.clone();
                changed = true;
            }
            if changed {
                prompt_to_emit = Some(existing.clone());
            }
            if ready && !existing.resume_claimed {
                prompt_to_resume = Some(existing.clone());
                prompt_to_mark = Some(existing.clone());
            }
        } else {
            let parked = TerminalParkedPrompt {
                pane_id: pane_id.clone(),
                instance_id: instance.id,
                task_id: task_id.clone(),
                title,
                prompt: snapshot.prompt.clone(),
                waiting_on,
                voice_plan_prompt: voice_plan_prompt.clone(),
                coordination,
                working_directory: instance.working_directory.as_ref().clone(),
                resume_claimed: false,
            };
            guard.insert(parked_key, parked.clone());
            prompt_to_emit = Some(parked.clone());
            prompt_to_mark = Some(parked.clone());
            if ready {
                prompt_to_resume = Some(parked);
            }
        }
    }

    if let Some(parked) = prompt_to_emit {
        emit_terminal_parked_prompt_event(&app, &parked, "parked", Some(reason));
    }

    if let Some(parked) = prompt_to_mark {
        mark_terminal_parked_prompt_lifecycle_in_cloud(
            &app,
            &cloud_mcp_state,
            &parked,
            if ready { "resume_ready" } else { "parked" },
            if ready {
                "Dependency completed; the parked task is being resumed automatically."
            } else {
                "Parked: waiting for another agent's accepted patch before continuing."
            },
        )
        .await;
    }

    if let Some(parked) = prompt_to_resume {
        terminal_resume_parked_prompt_once(app, cloud_mcp_state, terminals, parked_prompts, parked)
            .await;
    }
}

async fn terminal_emit_parked_prompt_interrupted(
    app: &AppHandle,
    cloud_mcp_state: &CloudMcpState,
    parked: &TerminalParkedPrompt,
    reason: &str,
    body: &str,
) {
    mark_terminal_parked_prompt_lifecycle_in_cloud(
        app,
        cloud_mcp_state,
        parked,
        "interrupted",
        body,
    )
    .await;
    emit_terminal_parked_prompt_event(app, parked, "interrupted", Some(reason));
}

async fn terminal_resume_parked_prompt_once(
    app: AppHandle,
    cloud_mcp_state: CloudMcpState,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    parked_prompts: Arc<RwLock<HashMap<String, TerminalParkedPrompt>>>,
    parked: TerminalParkedPrompt,
) -> bool {
    let parked_key =
        terminal_parked_prompt_key(&parked.pane_id, parked.instance_id, &parked.task_id);
    let snapshot = match terminal_parking_snapshot_from_kernel(&parked.coordination) {
        Ok(Some(snapshot)) if snapshot.task_id == parked.task_id => snapshot,
        _ => return false,
    };

    if snapshot.terminal {
        if let Some(parked) = parked_prompts.write().await.remove(&parked_key) {
            emit_terminal_parked_prompt_event(&app, &parked, "resumed", Some("task_terminal"));
        }
        return true;
    }

    if !snapshot.ready {
        let waiting_on = snapshot.waiting_on;
        if !waiting_on.is_empty() {
            let parked_update = {
                let mut guard = parked_prompts.write().await;
                if let Some(parked) = guard.get_mut(&parked_key) {
                    if parked.waiting_on != waiting_on {
                        parked.waiting_on = waiting_on;
                        Some(parked.clone())
                    } else {
                        None
                    }
                } else {
                    None
                }
            };
            if let Some(parked) = parked_update {
                emit_terminal_parked_prompt_event(
                    &app,
                    &parked,
                    "parked",
                    Some("waiting_for_dependency"),
                );
            }
        }
        return false;
    }

    let Some(parked) = ({
        let mut guard = parked_prompts.write().await;
        match guard.get_mut(&parked_key) {
            Some(parked) if parked.resume_claimed => {
                log_terminal_crash_forensics_event(
                    "backend.parked_resume.duplicate_claim_skipped",
                    json!({
                        "instance_id": parked.instance_id,
                        "pane_id": clean_terminal_diagnostic_log_text(&parked.pane_id),
                        "task_id": clean_terminal_diagnostic_log_text(&parked.task_id),
                    }),
                );
                None
            }
            Some(parked) => {
                parked.resume_claimed = true;
                Some(parked.clone())
            }
            None => None,
        }
    }) else {
        return false;
    };

    let resume_state = if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
        &parked.coordination.repo_path,
        Some(PathBuf::from(&parked.coordination.db_path)),
    ) {
        kernel
            .task_resume_state(&parked.task_id, &parked.coordination.session_id)
            .ok()
    } else {
        None
    };

    let Some(instance) = ({
        let guard = terminals.read().await;
        guard.get(&parked.pane_id).cloned()
    }) else {
        parked_prompts.write().await.remove(&parked_key);
        log_terminal_crash_forensics_event(
            "backend.terminal_parked_resume.deferred_terminal_missing",
            json!({
                "instance_id": parked.instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(&parked.pane_id),
                "task_id": parked.task_id,
                "resume_policy": "leave_kernel_task_resume_ready_for_session_recovery",
            }),
        );
        return false;
    };

    if instance.id != parked.instance_id {
        parked_prompts.write().await.remove(&parked_key);
        log_terminal_crash_forensics_event(
            "backend.terminal_parked_resume.deferred_terminal_replaced",
            json!({
                "expected_instance_id": parked.instance_id,
                "actual_instance_id": instance.id,
                "pane_id": clean_terminal_diagnostic_log_text(&parked.pane_id),
                "task_id": parked.task_id,
                "resume_policy": "leave_kernel_task_resume_ready_for_session_recovery",
            }),
        );
        return false;
    }

    let resume_request = terminal_rich_parked_resume_prompt(
        &snapshot,
        &parked.title,
        &parked.prompt,
        resume_state.as_ref(),
    );
    let resume_input_bytes = resume_request.len() + TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE.len();
    if resume_input_bytes > MAX_TERMINAL_WRITE_BYTES {
        parked_prompts.write().await.remove(&parked_key);
        terminal_emit_parked_prompt_interrupted(
            &app,
            &cloud_mcp_state,
            &parked,
            "resume_input_too_large",
            "Interrupted while parked: the resume prompt was too large to send safely.",
        )
        .await;
        return false;
    }

    let _input_guard = instance.input_queue.lock().await;
    let still_current = {
        let guard = terminals.read().await;
        guard
            .get(&parked.pane_id)
            .map(|current| current.id == parked.instance_id)
            .unwrap_or(false)
    };
    if !still_current {
        parked_prompts.write().await.remove(&parked_key);
        terminal_emit_parked_prompt_interrupted(
            &app,
            &cloud_mcp_state,
            &parked,
            "terminal_replaced",
            "Interrupted while parked: the terminal session changed before the task could resume.",
        )
        .await;
        return false;
    }

    emit_terminal_parked_prompt_event(
        &app,
        &parked,
        "resume_requested",
        Some("dependency_ready_resume_start"),
    );
    mark_terminal_parked_prompt_lifecycle_in_cloud(
        &app,
        &cloud_mcp_state,
        &parked,
        "resume_requested",
        "Dependency completed; the parked task is being sent back to the terminal.",
    )
    .await;

    {
        let mut writer = instance.writer.lock().await;
        log_terminal_crash_forensics_event(
            "backend.parked_resume.write_prompt.begin",
            json!({
                "bytes": resume_request.len(),
                "instance_id": instance.id,
                "pane_id": clean_terminal_diagnostic_log_text(&parked.pane_id),
                "task_id": clean_terminal_diagnostic_log_text(&parked.task_id),
            }),
        );
        if writer.write_all(resume_request.as_bytes()).is_err() || writer.flush().is_err() {
            log_terminal_crash_forensics_event(
                "backend.parked_resume.write_prompt.error",
                json!({
                    "bytes": resume_request.len(),
                    "instance_id": instance.id,
                    "pane_id": clean_terminal_diagnostic_log_text(&parked.pane_id),
                    "task_id": clean_terminal_diagnostic_log_text(&parked.task_id),
                }),
            );
            parked_prompts.write().await.remove(&parked_key);
            terminal_emit_parked_prompt_interrupted(
                &app,
                &cloud_mcp_state,
                &parked,
                "resume_write_failed",
                "Interrupted while parked: the terminal write failed when resuming the task.",
            )
            .await;
            return false;
        }
        log_terminal_crash_forensics_event(
            "backend.parked_resume.write_prompt.done",
            json!({
                "bytes": resume_request.len(),
                "instance_id": instance.id,
                "pane_id": clean_terminal_diagnostic_log_text(&parked.pane_id),
                "task_id": clean_terminal_diagnostic_log_text(&parked.task_id),
            }),
        );
    }

    tokio::time::sleep(Duration::from_millis(
        TERMINAL_PARKED_RESUME_SUBMIT_DELAY_MS,
    ))
    .await;
    let still_current = {
        let guard = terminals.read().await;
        guard
            .get(&parked.pane_id)
            .map(|current| current.id == parked.instance_id)
            .unwrap_or(false)
    };
    if !still_current {
        parked_prompts.write().await.remove(&parked_key);
        terminal_emit_parked_prompt_interrupted(
            &app,
            &cloud_mcp_state,
            &parked,
            "terminal_replaced",
            "Interrupted while parked: the terminal session changed before the resume submit could be sent.",
        )
        .await;
        return false;
    }
    {
        let mut writer = instance.writer.lock().await;
        log_terminal_crash_forensics_event(
            "backend.parked_resume.submit.begin",
            json!({
                "bytes": TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE.len(),
                "instance_id": instance.id,
                "pane_id": clean_terminal_diagnostic_log_text(&parked.pane_id),
                "task_id": clean_terminal_diagnostic_log_text(&parked.task_id),
            }),
        );
        if writer
            .write_all(TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE.as_bytes())
            .is_err()
            || writer.flush().is_err()
        {
            log_terminal_crash_forensics_event(
                "backend.parked_resume.submit.error",
                json!({
                    "bytes": TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE.len(),
                    "instance_id": instance.id,
                    "pane_id": clean_terminal_diagnostic_log_text(&parked.pane_id),
                    "task_id": clean_terminal_diagnostic_log_text(&parked.task_id),
                }),
            );
            parked_prompts.write().await.remove(&parked_key);
            terminal_emit_parked_prompt_interrupted(
                &app,
                &cloud_mcp_state,
                &parked,
                "resume_write_failed",
                "Interrupted while parked: the terminal write failed when resuming the task.",
            )
            .await;
            return false;
        }
        log_terminal_crash_forensics_event(
            "backend.parked_resume.submit.done",
            json!({
                "bytes": TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE.len(),
                "instance_id": instance.id,
                "pane_id": clean_terminal_diagnostic_log_text(&parked.pane_id),
                "task_id": clean_terminal_diagnostic_log_text(&parked.task_id),
            }),
        );
    }

    let resumed_prompt_submitted_at = crate::coordination::kernel::now_rfc3339();
    let prompt_metadata = parked.voice_plan_prompt.as_ref();
    let resumed_prompt_event_id = prompt_metadata.map(|metadata| metadata.prompt_event_id.as_str());
    let resumed_prompt_event_source = prompt_metadata
        .and_then(|metadata| metadata.prompt_event_source.as_deref())
        .or(Some("terminal-parked-resume"));
    let resumed_thread_id = prompt_metadata.and_then(|metadata| metadata.thread_id.as_deref());
    emit_terminal_prompt_submitted(
        &app,
        &instance,
        &resume_request,
        resumed_prompt_event_id,
        None,
        resumed_prompt_event_source,
        Some(&resumed_prompt_submitted_at),
        None,
        None,
        None,
        None,
        false,
        Some(&resume_request),
        Some(&resume_request),
        true,
        "parked_resume_backend_submit",
        resumed_thread_id,
    );
    if *instance.agent_started.lock().await {
        let cloud_state = cloud_mcp_state.clone();
        let pane_id_for_context = parked.pane_id.clone();
        let working_directory = parked.working_directory.clone();
        let coordination = Some(parked.coordination.clone());
        let terminal_instance_id = instance.id;
        let local_task_id = Some(parked.task_id.clone());
        let local_task_title = Some(parked.title.clone());
        let metadata = instance.metadata.clone();
        let prompt_metadata = CloudMcpTerminalPromptMetadata {
            prompt_event_id: resumed_prompt_event_id.map(str::to_string),
            prompt_event_source: resumed_prompt_event_source.map(str::to_string),
            prompt_event_submitted_at: Some(resumed_prompt_submitted_at.clone()),
            terminal_index: prompt_metadata
                .and_then(|metadata| metadata.terminal_index)
                .or(metadata.terminal_index),
            thread_id: resumed_thread_id
                .map(str::to_string)
                .or_else(|| Some(metadata.thread_id.clone())),
            workspace_id: prompt_metadata
                .map(|metadata| metadata.workspace_id.clone())
                .unwrap_or_else(|| metadata.workspace_id.clone()),
            workspace_name: prompt_metadata
                .map(|metadata| metadata.workspace_name.clone())
                .unwrap_or_else(|| metadata.workspace_name.clone()),
            todo_id: None,
            todo_dispatch_id: None,
            todo_command_id: None,
            todo_action: None,
            todo_resume_requested: false,
        };
        let prompt_for_cloud = resume_request.clone();
        tauri::async_runtime::spawn(async move {
            cloud_mcp_terminal_context_pack_for_prompt(
                cloud_state,
                pane_id_for_context,
                terminal_instance_id,
                working_directory,
                coordination,
                TerminalSessionMode::ManagedPatch,
                local_task_id,
                local_task_title,
                prompt_for_cloud,
                Some(prompt_metadata),
            )
            .await;
        });
    }

    if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
        &parked.coordination.repo_path,
        Some(PathBuf::from(&parked.coordination.db_path)),
    ) {
        let _ = kernel.mark_task_resume_requested(
            &parked.task_id,
            &parked.coordination.session_id,
            "dependency_ready_original_request_submitted",
        );
    }

    mark_terminal_parked_prompt_lifecycle_in_cloud(
        &app,
        &cloud_mcp_state,
        &parked,
        "dispatched",
        "Dependency completed; the parked task is resuming in the terminal.",
    )
    .await;
    parked_prompts.write().await.remove(&parked_key);
    emit_terminal_parked_prompt_event(&app, &parked, "resumed", Some("dependency_ready"));
    true
}

fn terminal_crash_todo_resume_prompt(candidate: &Value, provider_session_id: &str) -> String {
    let todo_id = terminal_resume_value_text(candidate["todo_id"].as_str(), "unknown todo", 180);
    let old_task_id =
        terminal_resume_value_text(candidate["old_task_id"].as_str(), "interrupted task", 180);
    let title = terminal_resume_value_text(
        candidate["task_title"].as_str(),
        "Interrupted todo work",
        300,
    );
    let body = terminal_resume_value_text(
        candidate["task_body"].as_str(),
        "Continue the todo from the point before the desktop app crashed.",
        1800,
    );
    let provider_session_id = terminal_resume_clean_text(provider_session_id, 160);

    format!(
        "Diff Forge crash recovery is resuming a todo in this restored agent session.\n\n\
Todo id:\n{todo_id}\n\n\
Previous task attempt:\n- task_id: {old_task_id}\n- status: interrupted_by_crash\n- provider session confirmed: {provider_session_id}\n\n\
Todo request:\n{title}\n\n{body}\n\n\
Continue now:\n\
1. Treat this as the same todo, but a fresh local execution attempt after the app crash.\n\
2. Inspect the current repo state before editing so you do not work from stale filesystem assumptions.\n\
3. When you are ready to edit, call coordination-kernel.start_task with this todo as the source context if the tool schema exposes todo/source refs.\n\
4. Do not reuse the old interrupted task_id above for new leases or patch submission."
    )
}

async fn terminal_try_crash_todo_resume_prompt_once(
    app: AppHandle,
    cloud_mcp_state: CloudMcpState,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    payload: TerminalActivityHookPayload,
) -> bool {
    if !payload.input_ready {
        return false;
    }
    let Some(provider_session_id) = payload
        .provider_session_id
        .as_deref()
        .or(payload.native_session_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    else {
        return false;
    };
    let Some(instance) = ({
        let guard = terminals.read().await;
        guard
            .get(&payload.pane_id)
            .filter(|instance| instance.id == payload.instance_id)
            .cloned()
    }) else {
        return false;
    };
    let Some(coordination) = instance.coordination.clone() else {
        return false;
    };
    let coordination_repo_path = coordination.repo_path.clone();
    let coordination_db_path = coordination.db_path.clone();
    let coordination_session_id = coordination.session_id.clone();
    let coordination_agent_kind = coordination.agent_kind.clone();

    let candidate = match crate::coordination::CoordinationKernel::open(
        &coordination_repo_path,
        Some(PathBuf::from(&coordination_db_path)),
    )
    .and_then(|kernel| {
        let _ =
            kernel.record_session_provider_session_id(&coordination_session_id, &provider_session_id);
        kernel.claim_crashed_todo_resume_for_provider_session(
            &coordination_session_id,
            &provider_session_id,
            Some(&payload.pane_id),
            Some(&coordination_agent_kind),
        )
    }) {
        Ok(Some(candidate)) => candidate,
        Ok(None) => return false,
        Err(error) => {
            log_terminal_crash_forensics_event(
                "backend.crash_todo_resume.claim_error",
                json!({
                    "error": clean_terminal_diagnostic_log_text(&error),
                    "instance_id": payload.instance_id,
                    "pane_id": clean_terminal_diagnostic_log_text(&payload.pane_id),
                    "provider_session_present": true,
                }),
            );
            return false;
        }
    };

    let candidate_id = candidate["id"].as_str().unwrap_or_default().to_string();
    let prompt = terminal_crash_todo_resume_prompt(&candidate, &provider_session_id);
    let input_bytes = prompt.len() + TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE.len();
    if input_bytes > MAX_TERMINAL_WRITE_BYTES {
        if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
            &coordination_repo_path,
            Some(PathBuf::from(&coordination_db_path)),
        ) {
            let _ = kernel.finish_crashed_todo_resume(
                &candidate_id,
                "failed",
                Some("resume_input_too_large"),
            );
        }
        return false;
    }

    let _input_guard = instance.input_queue.lock().await;
    let still_current = {
        let guard = terminals.read().await;
        guard
            .get(&payload.pane_id)
            .map(|current| current.id == payload.instance_id)
            .unwrap_or(false)
    };
    if !still_current {
        if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
            &coordination_repo_path,
            Some(PathBuf::from(&coordination_db_path)),
        ) {
            let _ = kernel.finish_crashed_todo_resume(
                &candidate_id,
                "skipped",
                Some("terminal_replaced_before_resume_write"),
            );
        }
        return false;
    }

    {
        let mut writer = instance.writer.lock().await;
        log_terminal_crash_forensics_event(
            "backend.crash_todo_resume.write_prompt.begin",
            json!({
                "bytes": prompt.len(),
                "candidate_id": candidate_id,
                "instance_id": instance.id,
                "old_task_id": candidate["old_task_id"].as_str().unwrap_or_default(),
                "pane_id": clean_terminal_diagnostic_log_text(&payload.pane_id),
                "todo_id": candidate["todo_id"].as_str().unwrap_or_default(),
            }),
        );
        if writer.write_all(prompt.as_bytes()).is_err() || writer.flush().is_err() {
            if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
                &coordination_repo_path,
                Some(PathBuf::from(&coordination_db_path)),
            ) {
                let _ = kernel.finish_crashed_todo_resume(
                    &candidate_id,
                    "failed",
                    Some("resume_write_failed"),
                );
            }
            return false;
        }
    }

    tokio::time::sleep(Duration::from_millis(
        TERMINAL_PARKED_RESUME_SUBMIT_DELAY_MS,
    ))
    .await;
    let still_current = {
        let guard = terminals.read().await;
        guard
            .get(&payload.pane_id)
            .map(|current| current.id == payload.instance_id)
            .unwrap_or(false)
    };
    if !still_current {
        if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
            &coordination_repo_path,
            Some(PathBuf::from(&coordination_db_path)),
        ) {
            let _ = kernel.finish_crashed_todo_resume(
                &candidate_id,
                "skipped",
                Some("terminal_replaced_before_resume_submit"),
            );
        }
        return false;
    }

    {
        let mut writer = instance.writer.lock().await;
        if writer
            .write_all(TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE.as_bytes())
            .is_err()
            || writer.flush().is_err()
        {
            if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
                &coordination_repo_path,
                Some(PathBuf::from(&coordination_db_path)),
            ) {
                let _ = kernel.finish_crashed_todo_resume(
                    &candidate_id,
                    "failed",
                    Some("resume_submit_failed"),
                );
            }
            return false;
        }
    }

    let submitted_at = crate::coordination::kernel::now_rfc3339();
    let prompt_event_id = candidate["resume_prompt_event_id"].as_str();
    let todo_id = candidate["todo_id"].as_str();
    let todo_dispatch_id = candidate["resume_dispatch_id"].as_str();
    let todo_command_id = candidate["resume_command_id"].as_str();
    emit_terminal_prompt_submitted(
        &app,
        &instance,
        &prompt,
        prompt_event_id,
        None,
        Some("terminal-crash-todo-resume"),
        Some(&submitted_at),
        todo_id,
        todo_dispatch_id,
        todo_command_id,
        Some("crash_resume"),
        true,
        Some(&prompt),
        Some(&prompt),
        true,
        "crash_todo_resume_backend_submit",
        Some(&payload.thread_id),
    );

    if *instance.agent_started.lock().await {
        let metadata = instance.metadata.clone();
        let prompt_metadata = CloudMcpTerminalPromptMetadata {
            prompt_event_id: prompt_event_id.map(str::to_string),
            prompt_event_source: Some("terminal-crash-todo-resume".to_string()),
            prompt_event_submitted_at: Some(submitted_at.clone()),
            terminal_index: metadata.terminal_index,
            thread_id: Some(payload.thread_id.clone()).filter(|value| !value.trim().is_empty()),
            workspace_id: metadata.workspace_id.clone(),
            workspace_name: metadata.workspace_name.clone(),
            todo_id: todo_id.map(str::to_string),
            todo_dispatch_id: todo_dispatch_id.map(str::to_string),
            todo_command_id: todo_command_id.map(str::to_string),
            todo_action: Some("crash_resume".to_string()),
            todo_resume_requested: true,
        };
        let prompt_for_cloud = prompt.clone();
        let working_directory = instance.working_directory.as_ref().clone();
        let coordination_for_cloud = coordination.clone();
        let session_mode = instance.session_mode;
        let pane_id_for_cloud = payload.pane_id.clone();
        let instance_id_for_cloud = payload.instance_id;
        tauri::async_runtime::spawn(async move {
            cloud_mcp_terminal_context_pack_for_prompt(
                cloud_mcp_state,
                pane_id_for_cloud,
                instance_id_for_cloud,
                working_directory,
                Some(coordination_for_cloud),
                session_mode,
                None,
                None,
                prompt_for_cloud,
                Some(prompt_metadata),
            )
            .await;
        });
    }

    if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
        &coordination_repo_path,
        Some(PathBuf::from(&coordination_db_path)),
    ) {
        let _ = kernel.finish_crashed_todo_resume(&candidate_id, "dispatched", None);
    }

    log_terminal_crash_forensics_event(
        "backend.crash_todo_resume.dispatched",
        json!({
            "candidate_id": candidate_id,
            "instance_id": payload.instance_id,
            "old_task_id": candidate["old_task_id"].as_str().unwrap_or_default(),
            "pane_id": clean_terminal_diagnostic_log_text(&payload.pane_id),
            "todo_id": todo_id.unwrap_or_default(),
        }),
    );
    true
}

fn emit_terminal_input_error(
    app: &AppHandle,
    pane_id: String,
    instance_id: Option<u64>,
    message: String,
) {
    let _ = app.emit(
        TERMINAL_INPUT_ERROR_EVENT,
        TerminalInputErrorPayload {
            pane_id,
            instance_id,
            message,
        },
    );
}

fn emit_terminal_prompt_submitted(
    app: &AppHandle,
    instance: &TerminalInstance,
    prompt: &str,
    prompt_event_id: Option<&str>,
    prompt_event_revision: Option<u64>,
    prompt_event_source: Option<&str>,
    prompt_event_submitted_at: Option<&str>,
    todo_id: Option<&str>,
    todo_dispatch_id: Option<&str>,
    todo_command_id: Option<&str>,
    todo_action: Option<&str>,
    todo_resume_requested: bool,
    expected_prompt: Option<&str>,
    observed_prompt: Option<&str>,
    prompt_match: bool,
    prompt_source: &str,
    thread_id_override: Option<&str>,
) {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return;
    }
    if !terminal_prompt_submitted_source_is_authoritative(
        prompt_source,
        prompt_match,
        observed_prompt,
    ) {
        let metadata = instance.metadata.clone();
        log_terminal_status_event(
            "backend.terminal.prompt_submitted_untrusted_skip",
            json!({
                "agent_id": metadata.agent_id.clone(),
                "agent_kind": metadata.agent_kind.clone(),
                "expected_prompt_len": expected_prompt.map(str::len).unwrap_or_default(),
                "instance_id": instance.id,
                "observed_prompt_len": observed_prompt.map(str::len).unwrap_or_default(),
                "pane_id": metadata.pane_id.clone(),
                "prompt_event_id": prompt_event_id.unwrap_or_default(),
                "prompt_event_source": prompt_event_source.unwrap_or_default(),
                "prompt_len": prompt.len(),
                "prompt_match": prompt_match,
                "prompt_source": prompt_source,
                "status_truth": "prompt_submit_not_authoritative",
                "terminal_index": metadata.terminal_index,
                "thread_id": thread_id_override
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(metadata.thread_id.as_str()),
                "workspace_id": metadata.workspace_id.clone(),
            }),
        );
        return;
    }

    let metadata = instance.metadata.clone();
    log_terminal_status_event(
        "backend.terminal.prompt_submitted",
        json!({
            "agent_id": metadata.agent_id.clone(),
            "agent_kind": metadata.agent_kind.clone(),
            "expected_prompt_len": expected_prompt.map(str::len).unwrap_or_default(),
            "instance_id": instance.id,
            "observed_prompt_len": observed_prompt.map(str::len).unwrap_or_default(),
            "pane_id": metadata.pane_id.clone(),
            "prompt_event_id": prompt_event_id.unwrap_or_default(),
            "prompt_event_source": prompt_event_source.unwrap_or_default(),
            "todo_action": todo_action.unwrap_or_default(),
            "todo_id": todo_id.unwrap_or_default(),
            "todo_resume_requested": todo_resume_requested,
            "prompt_len": prompt.len(),
            "prompt_match": prompt_match,
            "prompt_source": prompt_source,
            "status_truth": "processing_request_submitted",
            "terminal_index": metadata.terminal_index,
            "thread_id": thread_id_override
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(metadata.thread_id.as_str()),
            "workspace_id": metadata.workspace_id.clone(),
        }),
    );
    let _ = app.emit(
        TERMINAL_PROMPT_SUBMITTED_EVENT,
        TerminalPromptSubmittedPayload {
            pane_id: metadata.pane_id,
            instance_id: instance.id,
            workspace_id: metadata.workspace_id,
            workspace_name: metadata.workspace_name,
            terminal_index: metadata.terminal_index,
            thread_id: thread_id_override
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or(metadata.thread_id),
            agent_id: metadata.agent_id,
            agent_kind: metadata.agent_kind,
            prompt_event_id: prompt_event_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            prompt_event_revision,
            prompt_event_source: prompt_event_source
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            prompt_event_submitted_at: prompt_event_submitted_at
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            todo_id: todo_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            todo_dispatch_id: todo_dispatch_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            todo_command_id: todo_command_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            todo_action: todo_action
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            todo_resume_requested,
            expected_prompt: expected_prompt
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            observed_prompt: observed_prompt
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            prompt_match,
            prompt_source: prompt_source.to_string(),
            prompt: prompt.to_string(),
        },
    );
}

fn terminal_activity_hook_string(event: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(value) = event.get(*key).and_then(Value::as_str) else {
            continue;
        };
        let value = value.trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }

    None
}

fn terminal_activity_hook_name_key(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn terminal_activity_hook_display_text(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .chars()
        .take(96)
        .collect()
}

fn terminal_activity_hook_agent_display_name(
    agent_type: Option<&str>,
    provider: &str,
    fallback: &str,
) -> String {
    for candidate in [agent_type, Some(provider), Some(fallback)] {
        let Some(value) = candidate else {
            continue;
        };
        let value = terminal_activity_hook_display_text(value);
        if !value.is_empty() {
            return value;
        }
    }

    String::new()
}

fn terminal_activity_hook_bool(event: &Value, keys: &[&str]) -> bool {
    keys.iter()
        .any(|key| event.get(*key).and_then(Value::as_bool).unwrap_or(false))
}

fn terminal_activity_hook_status_key(event: &Value, keys: &[&str]) -> Option<String> {
    terminal_activity_hook_string(event, keys).map(|value| terminal_activity_hook_name_key(&value))
}

#[derive(Debug, Clone)]
struct TerminalActivityHookManualPrompt {
    kind: String,
    text: Option<String>,
    approval_id: Option<String>,
    permission_prompt_id: Option<String>,
    permission_request_id: Option<String>,
}

fn terminal_activity_hook_manual_prompt(
    hook_event_name: &str,
    event: &Value,
) -> Option<TerminalActivityHookManualPrompt> {
    let hook_key = terminal_activity_hook_name_key(hook_event_name);
    let manual_event = matches!(
        hook_key.as_str(),
        "manualapprovalrequired"
            | "manualprompt"
            | "permissionprompt"
            | "permissionpromptstarted"
            | "providerblockedforuser"
            | "userinputrequired"
            | "userinputrequested"
            | "userpromptrequired"
            | "userpromptstarted"
    );
    let resolved_decision = terminal_activity_hook_status_key(
        event,
        &[
            "permissionDecision",
            "permission_decision",
            "decision",
            "approvalDecision",
            "approval_decision",
        ],
    )
    .is_some_and(|status| {
        matches!(
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
                | "autodeny"
                | "autodenied"
                | "deny"
                | "denied"
                | "reject"
                | "rejected"
        )
    });
    let resolved_status = terminal_activity_hook_status_key(
        event,
        &[
            "permissionStatus",
            "permission_status",
            "approvalStatus",
            "approval_status",
            "status",
        ],
    )
    .is_some_and(|status| {
        matches!(
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
                | "autodeny"
                | "autodenied"
                | "deny"
                | "denied"
                | "reject"
                | "rejected"
                | "resolved"
        )
    });
    if resolved_decision || resolved_status {
        return None;
    }

    let pending_status = terminal_activity_hook_status_key(
        event,
        &[
            "permissionStatus",
            "permission_status",
            "approvalStatus",
            "approval_status",
            "status",
        ],
    )
    .is_some_and(|status| {
        matches!(
            status.as_str(),
            "approvalrequired"
                | "awaitingapproval"
                | "awaitinginput"
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
        )
    });
    let explicit_pending = manual_event
        || pending_status
        || terminal_activity_hook_bool(
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
        );
    if !explicit_pending {
        return None;
    }

    let approval_id = terminal_activity_hook_string(event, &["approvalId", "approval_id"]);
    let permission_prompt_id =
        terminal_activity_hook_string(event, &["permissionPromptId", "permission_prompt_id"]);
    let permission_request_id =
        terminal_activity_hook_string(event, &["permissionRequestId", "permission_request_id"]);
    let tool_use_id = terminal_activity_hook_string(event, &["toolUseId", "tool_use_id"]);
    let has_action_token = approval_id.is_some()
        || permission_prompt_id.is_some()
        || permission_request_id.is_some()
        || tool_use_id.is_some();
    if !manual_event && !has_action_token {
        return None;
    }

    let kind = terminal_activity_hook_string(
        event,
        &[
            "promptingUserKind",
            "prompting_user_kind",
            "promptingKind",
            "prompting_kind",
        ],
    )
    .map(|value| terminal_activity_hook_name_key(&value))
    .filter(|value| matches!(value.as_str(), "approval" | "permission"))
    .unwrap_or_else(|| {
        if terminal_activity_hook_bool(
            event,
            &["manualApprovalRequired", "manual_approval_required"],
        ) || hook_key.contains("approval")
        {
            "approval".to_string()
        } else {
            "permission".to_string()
        }
    });
    let text = terminal_activity_hook_string(
        event,
        &[
            "promptingUserText",
            "prompting_user_text",
            "promptingText",
            "prompting_text",
            "description",
            "message",
            "prompt",
            "lastMessage",
            "last_message",
        ],
    );

    Some(TerminalActivityHookManualPrompt {
        kind,
        text,
        approval_id,
        permission_prompt_id,
        permission_request_id,
    })
}

fn terminal_activity_hook_lifecycle_kind(
    hook_event_name: &str,
) -> Option<(&'static str, &'static str, &'static str, &'static str, bool)> {
    match terminal_activity_hook_name_key(hook_event_name).as_str() {
        "userpromptsubmit" | "userpromptsubmitted" | "promptsubmit" | "promptsubmitted" => Some((
            "provider-turn-started",
            "thinking",
            "active",
            "running",
            false,
        )),
        "stop" | "turnstop" | "assistantstop" => Some((
            "provider-turn-completed",
            "idle",
            "active",
            "completed",
            true,
        )),
        "error" | "turnerror" | "assistantturnerror" => {
            Some(("provider-turn-error", "error", "error", "failed", true))
        }
        "interrupt"
        | "interrupted"
        | "turninterrupt"
        | "turninterrupted"
        | "assistantinterrupt"
        | "assistantturninterrupted"
        | "userinterrupt"
        | "userinterrupted" => Some((
            "provider-turn-interrupted",
            "idle",
            "active",
            "interrupted",
            true,
        )),
        _ => None,
    }
}

fn terminal_activity_hook_tool_activity_status(event: &Value) -> &'static str {
    let tool_name =
        terminal_activity_hook_string(event, &["toolName", "tool_name"]).unwrap_or_default();
    let tool_key = terminal_activity_hook_name_key(&tool_name);
    if tool_key.contains("mcp") {
        return "mcp";
    }
    if tool_key.contains("applypatch")
        || tool_key == "edit"
        || tool_key == "write"
        || tool_key.contains("multiedit")
        || tool_key.contains("notebookedit")
    {
        return "editing";
    }
    if tool_key.contains("bash")
        || tool_key.contains("shell")
        || tool_key.contains("execcommand")
        || tool_key.contains("runcommand")
        || tool_key == "command"
        || tool_key.contains("powershell")
    {
        return "shell";
    }

    "tool_running"
}

fn terminal_activity_hook_activity_kind(
    hook_event_name: &str,
    event: &Value,
) -> Option<(
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    bool,
    &'static str,
)> {
    match terminal_activity_hook_name_key(hook_event_name).as_str() {
        "pretooluse" => Some((
            "provider-tool-started",
            terminal_activity_hook_tool_activity_status(event),
            "active",
            "tool_running",
            false,
            "cli_hook_tool_start",
        )),
        "posttooluse" => Some((
            "provider-tool-completed",
            "thinking",
            "active",
            "tool_completed",
            false,
            "cli_hook_tool_complete",
        )),
        "subagentstart" => Some((
            "provider-subagent-started",
            "subagent_running",
            "active",
            "subagent_running",
            false,
            "cli_hook_subagent_start",
        )),
        "subagentstop" => Some((
            "provider-subagent-completed",
            "thinking",
            "active",
            "subagent_completed",
            false,
            "cli_hook_subagent_complete",
        )),
        _ => None,
    }
}

fn terminal_activity_hook_non_lifecycle_is_expected(hook_event_name: &str) -> bool {
    matches!(
        terminal_activity_hook_name_key(hook_event_name).as_str(),
        "pretooluse" | "posttooluse" | "subagentstart" | "subagentstop"
    )
}

fn terminal_architecture_graph_path_from_text(value: &str) -> String {
    let haystack = value.trim();
    if haystack.is_empty() {
        return String::new();
    }
    let lower = haystack.to_ascii_lowercase();
    let markers = [
        ".agents/architectures/graphs/",
        ".agents\\architectures\\graphs\\",
    ];
    let Some(marker_index) = markers.iter().find_map(|marker| lower.find(marker)) else {
        return String::new();
    };
    let is_boundary = |ch: char| {
        ch.is_whitespace() || matches!(ch, '"' | '\'' | '`' | '<' | '>' | '(' | ')' | '[' | ']' | '{' | '}' | '=' | ',')
    };
    let mut start = 0usize;
    for (index, ch) in haystack[..marker_index].char_indices() {
        if is_boundary(ch) {
            start = index + ch.len_utf8();
        }
    }
    let mut end = haystack.len();
    for (offset, ch) in haystack[marker_index..].char_indices() {
        if is_boundary(ch) {
            end = marker_index + offset;
            break;
        }
    }
    let path = haystack[start..end].trim_matches(|ch: char| matches!(ch, ':' | ';'));
    if path.to_ascii_lowercase().ends_with(".arch") {
        path.to_string()
    } else {
        String::new()
    }
}

fn terminal_architecture_graph_path_from_event(event: &Value) -> String {
    [
        "graphFilePath",
        "graph_file_path",
        "architectureGraphFilePath",
        "architecture_graph_file_path",
        "filePath",
        "file_path",
        "path",
        "command",
        "description",
        "message",
        "prompt",
    ]
    .iter()
    .find_map(|key| {
        event
            .get(*key)
            .and_then(Value::as_str)
            .map(terminal_architecture_graph_path_from_text)
            .filter(|path| !path.is_empty())
    })
    .unwrap_or_default()
}

fn terminal_architecture_graph_id_from_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn terminal_architecture_graph_title_from_id(graph_id: &str) -> String {
    graph_id
        .replace(['_', '-'], " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn terminal_architecture_activity_payload(
    instance: &TerminalInstance,
    event: &Value,
) -> Option<TerminalArchitectureActivityPayload> {
    let hook_event_name = terminal_activity_hook_string(
        event,
        &[
            "hookEventName",
            "hook_event_name",
            "eventName",
            "event_name",
        ],
    )?;
    let tool_name =
        terminal_activity_hook_string(event, &["toolName", "tool_name"]).unwrap_or_default();
    let tool_key = terminal_activity_hook_name_key(&tool_name);
    let graph_file_path = terminal_architecture_graph_path_from_event(event);
    let is_architecture_tool = tool_key.contains("architecturecontext")
        || tool_key.contains("architecturelist")
        || tool_key.contains("architectureiconreference")
        || tool_key.contains("architecturerevision");
    if !is_architecture_tool && graph_file_path.is_empty() {
        return None;
    }

    let hook_key = terminal_activity_hook_name_key(&hook_event_name);
    let phase = if !graph_file_path.is_empty() {
        if hook_key.contains("post") || hook_key.contains("stop") {
            "graph_changed"
        } else {
            "graph_editing"
        }
    } else if tool_key.contains("architecturecontext") || tool_key.contains("architecturelist") {
        "context"
    } else if tool_key.contains("architecturerevision") {
        "history"
    } else {
        "reference"
    };
    let metadata = instance.metadata.clone();
    let repo_path = instance
        .coordination
        .as_ref()
        .map(|coordination| coordination.repo_path.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| instance.working_directory.display().to_string());
    let cwd = terminal_activity_hook_string(event, &["cwd"]).unwrap_or_else(|| repo_path.clone());
    let graph_id = terminal_activity_hook_string(
        event,
        &["graphId", "graph_id", "architectureGraphId", "architecture_graph_id"],
    )
    .unwrap_or_else(|| terminal_architecture_graph_id_from_path(&graph_file_path));
    let graph_title = terminal_activity_hook_string(
        event,
        &[
            "graphTitle",
            "graph_title",
            "architectureGraphTitle",
            "architecture_graph_title",
        ],
    )
    .unwrap_or_else(|| terminal_architecture_graph_title_from_id(&graph_id));

    Some(TerminalArchitectureActivityPayload {
        pane_id: metadata.pane_id,
        instance_id: instance.id,
        workspace_id: metadata.workspace_id,
        workspace_name: metadata.workspace_name,
        terminal_index: metadata.terminal_index,
        thread_id: metadata.thread_id,
        agent_id: metadata.agent_id,
        agent_kind: metadata.agent_kind,
        provider: terminal_activity_hook_string(event, &["provider"]).unwrap_or_default(),
        hook_event_name,
        tool_name,
        phase: phase.to_string(),
        repo_path,
        cwd,
        graph_file_path,
        graph_id,
        graph_title,
        source: "terminal-hook".to_string(),
        observed_at_ms: terminal_now_ms(),
    })
}

fn terminal_activity_hook_payload(
    instance: &TerminalInstance,
    event: &Value,
) -> Option<TerminalActivityHookPayload> {
    let hook_event_name = terminal_activity_hook_string(
        event,
        &[
            "hookEventName",
            "hook_event_name",
            "eventName",
            "event_name",
        ],
    )?;
    let manual_prompt = terminal_activity_hook_manual_prompt(&hook_event_name, event);
    let (event_type, activity_status, status, command_phase, input_ready, completion_evidence) =
        if manual_prompt.is_some() {
            (
                "provider-user-prompt-started",
                "paused",
                "active",
                "awaiting_input",
                false,
                "cli_hook_manual_prompt",
            )
        } else {
            let (event_type, activity_status, status, command_phase, input_ready, evidence) =
                if let Some((event_type, activity_status, status, command_phase, input_ready)) =
                    terminal_activity_hook_lifecycle_kind(&hook_event_name)
                {
                    (
                        event_type,
                        activity_status,
                        status,
                        command_phase,
                        input_ready,
                        if input_ready {
                            "cli_hook_stop"
                        } else {
                            "cli_hook_prompt_submit"
                        },
                    )
                } else {
                    terminal_activity_hook_activity_kind(&hook_event_name, event)?
                };
            (
                event_type,
                activity_status,
                status,
                command_phase,
                input_ready,
                evidence,
            )
        };
    let metadata = instance.metadata.clone();
    let now_ms = terminal_now_ms();
    let event_time_ms = event
        .get("timestampMs")
        .or_else(|| event.get("timestamp_ms"))
        .and_then(Value::as_u64)
        .unwrap_or(now_ms);
    let event_time = crate::coordination::kernel::now_rfc3339();
    let provider = terminal_activity_hook_string(event, &["provider"])
        .unwrap_or_else(|| metadata.agent_kind.clone());
    let agent_type = terminal_activity_hook_string(
        event,
        &["agentType", "agent_type", "subagentType", "subagent_type"],
    );
    let agent_display_name = terminal_activity_hook_agent_display_name(
        agent_type.as_deref(),
        &provider,
        &metadata.agent_kind,
    );
    let provider_session_id = terminal_activity_hook_string(event, &["sessionId", "session_id"]);
    let provider_turn_id = terminal_activity_hook_string(event, &["turnId", "turn_id"]);
    let user_message = terminal_activity_hook_string(
        event,
        &[
            "prompt",
            "userPrompt",
            "user_prompt",
            "message",
            "description",
            "lastMessage",
            "last_message",
        ],
    );
    let input_ready_at = input_ready.then(|| event_time.clone());
    let prompt_ready_at = input_ready.then(|| event_time.clone());
    let completed_at = input_ready.then(|| event_time.clone());
    let permission_mode =
        terminal_activity_hook_string(event, &["permissionMode", "permission_mode"]);
    let manual_prompt_source = manual_prompt.as_ref().map(|_| "hook".to_string());
    let manual_approval_required = manual_prompt
        .as_ref()
        .is_some_and(|prompt| prompt.kind == "approval")
        || terminal_activity_hook_bool(
            event,
            &["manualApprovalRequired", "manual_approval_required"],
        );
    let provider_blocked_for_user = manual_prompt.is_some()
        || terminal_activity_hook_bool(
            event,
            &["providerBlockedForUser", "provider_blocked_for_user"],
        );
    let terminal_is_prompting_user = manual_prompt.is_some();
    let prompting_user_kind = manual_prompt.as_ref().map(|prompt| prompt.kind.clone());
    let prompting_user_text = manual_prompt
        .as_ref()
        .and_then(|prompt| prompt.text.clone());
    let approval_id = manual_prompt
        .as_ref()
        .and_then(|prompt| prompt.approval_id.clone());
    let permission_prompt_id = manual_prompt
        .as_ref()
        .and_then(|prompt| prompt.permission_prompt_id.clone());
    let permission_request_id = manual_prompt
        .as_ref()
        .and_then(|prompt| prompt.permission_request_id.clone());

    Some(TerminalActivityHookPayload {
        pane_id: metadata.pane_id,
        instance_id: instance.id,
        workspace_id: metadata.workspace_id,
        workspace_name: metadata.workspace_name,
        terminal_index: metadata.terminal_index,
        thread_id: metadata.thread_id,
        agent_id: metadata.agent_id,
        agent_kind: metadata.agent_kind,
        agent_type: agent_type.unwrap_or_default(),
        agent_display_name,
        provider,
        event_type: event_type.to_string(),
        hook_event_name,
        source: if manual_prompt.is_some() {
            "cli-hook:manual-prompt".to_string()
        } else {
            format!("cli-hook:{event_type}")
        },
        status: status.to_string(),
        activity_status: activity_status.to_string(),
        command_phase: command_phase.to_string(),
        input_ready,
        input_ready_at,
        prompt_ready_at,
        completed_at,
        provider_session_id: provider_session_id.clone(),
        native_session_id: provider_session_id,
        provider_turn_id: provider_turn_id.clone(),
        turn_id: provider_turn_id,
        transcript_path: terminal_activity_hook_string(
            event,
            &["transcriptPath", "transcript_path"],
        ),
        cwd: terminal_activity_hook_string(event, &["cwd"]),
        user_message: user_message.clone(),
        message: user_message,
        tool_name: terminal_activity_hook_string(event, &["toolName", "tool_name"]),
        tool_use_id: terminal_activity_hook_string(event, &["toolUseId", "tool_use_id"]),
        approval_id,
        permission_prompt_id,
        permission_request_id,
        permission_mode,
        manual_prompt_source,
        manual_approval_required,
        provider_blocked_for_user,
        terminal_is_prompting_user,
        prompting_user_kind,
        prompting_user_source: manual_prompt
            .as_ref()
            .map(|_| "cli-hook:manual-prompt".to_string()),
        prompting_user_confidence: manual_prompt
            .as_ref()
            .map(|_| "cli_hook_manual_prompt".to_string()),
        prompting_user_text,
        hook_health_status: "ok".to_string(),
        hook_health_event: "event_observed".to_string(),
        hook_health_observed_at_ms: now_ms,
        hook_timestamp_ms: event_time_ms,
        observed_at_ms: now_ms,
        completion_evidence: completion_evidence.to_string(),
    })
}

async fn terminal_activity_hook_current_instance(
    terminals: &Arc<RwLock<HashMap<String, TerminalInstance>>>,
    pane_id: &str,
    instance_id: u64,
) -> Option<TerminalInstance> {
    let terminals = terminals.read().await;
    terminals
        .get(pane_id)
        .filter(|instance| instance.id == instance_id)
        .cloned()
}

async fn read_terminal_activity_hook_chunk(
    path: &Path,
    offset: u64,
) -> Result<(u64, String), String> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|error| format!("Unable to read activity hook metadata: {error}"))?;
    let length = metadata.len();
    if length <= offset {
        return Ok((length, String::new()));
    }

    let mut file = tokio::fs::OpenOptions::new()
        .read(true)
        .open(path)
        .await
        .map_err(|error| format!("Unable to open activity hook events: {error}"))?;
    file.seek(SeekFrom::Start(offset))
        .await
        .map_err(|error| format!("Unable to seek activity hook events: {error}"))?;
    let mut chunk = String::new();
    file.read_to_string(&mut chunk)
        .await
        .map_err(|error| format!("Unable to read activity hook events: {error}"))?;
    let next_offset = offset.saturating_add(chunk.as_bytes().len() as u64);

    Ok((next_offset, chunk))
}

fn spawn_terminal_activity_hook_watcher(
    app: AppHandle,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    cloud_mcp_state: CloudMcpState,
    pane_id: String,
    instance_id: u64,
) {
    let activity_events_path = terminal_activity_events_path(&pane_id, instance_id);
    let activity_debug_path = terminal_activity_debug_path(&pane_id, instance_id);
    tauri::async_runtime::spawn(async move {
        let mut offset = 0u64;
        let mut debug_offset = 0u64;
        let mut partial = String::new();
        let mut debug_partial = String::new();
        loop {
            if app_shutdown_requested() {
                break;
            }
            let Some(instance) =
                terminal_activity_hook_current_instance(&terminals, &pane_id, instance_id).await
            else {
                break;
            };

            match read_terminal_activity_hook_chunk(&activity_events_path, offset).await {
                Ok((next_offset, chunk)) => {
                    if next_offset < offset {
                        partial.clear();
                    }
                    offset = next_offset;
                    if !chunk.is_empty() {
                        partial.push_str(&chunk);
                        let has_complete_tail = partial.ends_with('\n');
                        let mut lines = partial.lines().map(str::to_string).collect::<Vec<_>>();
                        partial = if has_complete_tail {
                            String::new()
                        } else {
                            lines.pop().unwrap_or_default()
                        };

                        for line in lines {
                            let line = line.trim();
                            if line.is_empty() {
                                continue;
                            }
                            let Ok(event) = serde_json::from_str::<Value>(line) else {
                                continue;
                            };
                            let architecture_payload =
                                terminal_architecture_activity_payload(&instance, &event);
                            let Some(payload) = terminal_activity_hook_payload(&instance, &event)
                            else {
                                if let Some(payload) = architecture_payload {
                                    let _ = app.emit(TERMINAL_ARCHITECTURE_ACTIVITY_EVENT, payload);
                                }
                                let hook_event_name = terminal_activity_hook_string(
                                    &event,
                                    &[
                                        "hookEventName",
                                        "hook_event_name",
                                        "eventName",
                                        "event_name",
                                    ],
                                )
                                .unwrap_or_default();
                                if terminal_activity_hook_non_lifecycle_is_expected(
                                    &hook_event_name,
                                ) {
                                    continue;
                                }
                                let event_keys = event
                                    .as_object()
                                    .map(|object| {
                                        object.keys().take(16).cloned().collect::<Vec<_>>()
                                    })
                                    .unwrap_or_default();
                                log_terminal_status_event(
                                    "backend.terminal_activity_hook.unmapped",
                                    json!({
                                        "event_keys": event_keys,
                                        "hook_event_name": clean_terminal_diagnostic_log_text(&hook_event_name),
                                        "instance_id": instance_id,
                                        "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                                        "reason": if hook_event_name.is_empty() {
                                            "missing_hook_event_name"
                                        } else {
                                            "unsupported_hook_event_name"
                                        },
                                    }),
                                );
                                continue;
                            };
                            log_terminal_status_event(
                                "backend.terminal_activity_hook.lifecycle",
                                json!({
                                    "activity_status": payload.activity_status.clone(),
                                    "event_type": payload.event_type.clone(),
                                    "hook_health_event": payload.hook_health_event.clone(),
                                    "hook_health_status": payload.hook_health_status.clone(),
                                    "hook_event_name": payload.hook_event_name.clone(),
                                    "instance_id": payload.instance_id,
                                    "pane_id": payload.pane_id.clone(),
                                    "provider_session_id_present": payload.provider_session_id.is_some(),
                                    "thread_id": payload.thread_id.clone(),
                                    "workspace_id": payload.workspace_id.clone(),
                                }),
                            );
                            let cloud_payload = payload.clone();
                            let cloud_state = cloud_mcp_state.clone();
                            tauri::async_runtime::spawn(async move {
                                cloud_mcp_sync_terminal_activity_hook_delta(
                                    &cloud_state,
                                    &cloud_payload,
                                )
                                .await;
                            });
                            if let Some(provider_session_id) = payload
                                .provider_session_id
                                .as_deref()
                                .or(payload.native_session_id.as_deref())
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(str::to_string)
                            {
                                if let Some(coordination) = instance.coordination.clone() {
                                    tauri::async_runtime::spawn_blocking(move || {
                                        match crate::coordination::CoordinationKernel::open(
                                            &coordination.repo_path,
                                            Some(PathBuf::from(&coordination.db_path)),
                                        ) {
                                            Ok(kernel) => {
                                                let _ = kernel.record_session_provider_session_id(
                                                    &coordination.session_id,
                                                    &provider_session_id,
                                                );
                                            }
                                            Err(error) => log_terminal_status_event(
                                                "backend.terminal_activity_hook.provider_session_record_error",
                                                json!({
                                                    "error": clean_terminal_diagnostic_log_text(&error),
                                                }),
                                            ),
                                        }
                                    });
                                }
                            }
                            let resume_app = app.clone();
                            let resume_cloud_state = cloud_mcp_state.clone();
                            let resume_terminals = Arc::clone(&terminals);
                            let resume_payload = payload.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = terminal_try_crash_todo_resume_prompt_once(
                                    resume_app,
                                    resume_cloud_state,
                                    resume_terminals,
                                    resume_payload,
                                )
                                .await;
                            });
                            let _ = app.emit(TERMINAL_ACTIVITY_HOOK_EVENT, payload);
                            if let Some(payload) = architecture_payload {
                                let _ = app.emit(TERMINAL_ARCHITECTURE_ACTIVITY_EVENT, payload);
                            }
                        }
                    }
                }
                Err(error) => {
                    if activity_events_path.exists() {
                        log_terminal_status_event(
                            "backend.terminal_activity_hook.read_error",
                            json!({
                                "error": clean_terminal_diagnostic_log_text(&error),
                                "instance_id": instance_id,
                                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                            }),
                        );
                    }
                }
            }

            match read_terminal_activity_hook_chunk(&activity_debug_path, debug_offset).await {
                Ok((next_offset, chunk)) => {
                    if next_offset < debug_offset {
                        debug_partial.clear();
                    }
                    debug_offset = next_offset;
                    if !chunk.is_empty() {
                        debug_partial.push_str(&chunk);
                        let has_complete_tail = debug_partial.ends_with('\n');
                        let mut lines = debug_partial
                            .lines()
                            .map(str::to_string)
                            .collect::<Vec<_>>();
                        debug_partial = if has_complete_tail {
                            String::new()
                        } else {
                            lines.pop().unwrap_or_default()
                        };

                        for line in lines {
                            let line = line.trim();
                            if line.is_empty() {
                                continue;
                            }
                            let Ok(event) = serde_json::from_str::<Value>(line) else {
                                continue;
                            };
                            log_terminal_status_event(
                                "backend.terminal_activity_hook.debug",
                                json!({
                                    "activity_path": event.get("activityPath").and_then(Value::as_str).unwrap_or_default(),
                                    "debug_phase": event.get("phase").and_then(Value::as_str).unwrap_or_default(),
                                    "details": event.get("details").cloned().unwrap_or(Value::Null),
                                    "hook_instance_id": event.get("instanceId").and_then(Value::as_u64).unwrap_or_default(),
                                    "hook_pane_id": clean_terminal_diagnostic_log_text(event.get("paneId").and_then(Value::as_str).unwrap_or_default()),
                                    "hook_provider": event.get("provider").and_then(Value::as_str).unwrap_or_default(),
                                    "instance_id": instance_id,
                                    "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                                    "terminal_index": event.get("terminalIndex").and_then(Value::as_str).unwrap_or_default(),
                                    "workspace_id": event.get("workspaceId").and_then(Value::as_str).unwrap_or_default(),
                                }),
                            );
                        }
                    }
                }
                Err(error) => {
                    if activity_debug_path.exists() {
                        log_terminal_status_event(
                            "backend.terminal_activity_hook.debug_read_error",
                            json!({
                                "error": clean_terminal_diagnostic_log_text(&error),
                                "instance_id": instance_id,
                                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                            }),
                        );
                    }
                }
            }

            sleep(Duration::from_millis(TERMINAL_ACTIVITY_HOOK_POLL_MS)).await;
        }
        log_terminal_status_event(
            "backend.terminal_activity_hook.watcher_stopped",
            json!({
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
            }),
        );
    });
}

fn terminal_prompt_submitted_source_is_authoritative(
    prompt_source: &str,
    prompt_match: bool,
    observed_prompt: Option<&str>,
) -> bool {
    if !prompt_match {
        return false;
    }

    match prompt_source {
        "activity_hook_user_prompt_submit" | "cli_hook_user_prompt_submit" => true,
        "observed_input_gate" => observed_prompt
            .map(str::trim)
            .is_some_and(|value| !value.is_empty()),
        "parked_resume_backend_submit" | "crash_todo_resume_backend_submit" => true,
        _ => false,
    }
}

fn terminal_input_queue_key(pane_id: &str, instance_id: Option<u64>) -> String {
    format!("{pane_id}:{}", instance_id.unwrap_or_default())
}

fn spawn_terminal_input_queue_worker(
    app: AppHandle,
    queue_key: String,
    queue_id: u64,
    mut receiver: mpsc::Receiver<TerminalInputQueueItem>,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            let item = match timeout(
                Duration::from_secs(TERMINAL_INPUT_QUEUE_IDLE_SECS),
                receiver.recv(),
            )
            .await
            {
                Ok(Some(payload)) => payload,
                Ok(None) | Err(_) => break,
            };

            let TerminalInputQueueItem { payload, ack } = item;
            let pane_id = payload.pane_id.clone();
            let instance_id = payload.instance_id;
            let state = app.state::<TerminalState>();
            let cloud_mcp_state = app.state::<CloudMcpState>();
            let write_result = terminal_write_inner(
                app.clone(),
                state.inner(),
                cloud_mcp_state.inner(),
                payload.pane_id,
                payload.instance_id,
                payload.data,
                payload.prompt_event_id,
                payload.prompt_event_revision,
                payload.prompt_event_source,
                payload.prompt_event_submitted_at,
                payload.prompt_event_text,
                payload.todo_id,
                payload.todo_dispatch_id,
                payload.todo_command_id,
                payload.todo_action,
                payload.todo_resume_requested,
                payload.thread_id,
                true,
            )
            .await;

            match write_result {
                Ok(()) => {
                    if let Some(ack) = ack {
                        let _ = ack.send(Ok(()));
                    }
                }
                Err(error) => {
                    emit_terminal_input_error(&app, pane_id, instance_id, error.clone());
                    if let Some(ack) = ack {
                        let _ = ack.send(Err(error));
                    }
                }
            }
        }

        let state = app.state::<TerminalState>();
        if let Ok(mut queues) = state.terminal_input_queues.lock() {
            if queues
                .get(&queue_key)
                .is_some_and(|handle| handle.id == queue_id)
            {
                queues.remove(&queue_key);
            }
        };
    });
}

fn enqueue_terminal_input_event(app: &AppHandle, payload: TerminalInputEventPayload) {
    enqueue_terminal_input_queue_item(app, payload, None);
}

fn enqueue_terminal_input_event_with_ack(
    app: &AppHandle,
    payload: TerminalInputEventPayload,
) -> oneshot::Receiver<Result<(), String>> {
    let (ack_sender, ack_receiver) = oneshot::channel();
    enqueue_terminal_input_queue_item(app, payload, Some(ack_sender));
    ack_receiver
}

fn send_terminal_input_queue_ack(
    ack: Option<oneshot::Sender<Result<(), String>>>,
    result: Result<(), String>,
) {
    if let Some(ack) = ack {
        let _ = ack.send(result);
    }
}

fn enqueue_terminal_input_queue_item(
    app: &AppHandle,
    payload: TerminalInputEventPayload,
    ack: Option<oneshot::Sender<Result<(), String>>>,
) {
    let pane_id = payload.pane_id.clone();
    let instance_id = payload.instance_id;

    if let Err(error) = validate_terminal_pane_id(&pane_id) {
        emit_terminal_input_error(app, pane_id, instance_id, error.clone());
        send_terminal_input_queue_ack(ack, Err(error));
        return;
    }

    if payload.data.len() > MAX_TERMINAL_WRITE_BYTES {
        let error = "Terminal input chunk is too large.".to_string();
        emit_terminal_input_error(app, pane_id, instance_id, error.clone());
        send_terminal_input_queue_ack(ack, Err(error));
        return;
    }

    let state = app.state::<TerminalState>();
    let queue_key = terminal_input_queue_key(&payload.pane_id, payload.instance_id);
    let mut item = TerminalInputQueueItem { payload, ack };

    loop {
        let handle = match state.terminal_input_queues.lock() {
            Ok(mut queues) => {
                if let Some(handle) = queues.get(&queue_key).cloned() {
                    handle
                } else {
                    let (sender, receiver) = mpsc::channel(TERMINAL_INPUT_QUEUE_CAPACITY);
                    let handle = TerminalInputQueueHandle {
                        id: state
                            .next_terminal_input_queue_id
                            .fetch_add(1, Ordering::AcqRel),
                        sender,
                    };
                    queues.insert(queue_key.clone(), handle.clone());
                    spawn_terminal_input_queue_worker(
                        app.clone(),
                        queue_key.clone(),
                        handle.id,
                        receiver,
                    );
                    handle
                }
            }
            Err(_) => {
                let error = "Unable to queue terminal input.".to_string();
                emit_terminal_input_error(app, pane_id, instance_id, error.clone());
                send_terminal_input_queue_ack(item.ack, Err(error));
                return;
            }
        };

        match handle.sender.try_send(item) {
            Ok(()) => return,
            Err(mpsc::error::TrySendError::Full(returned_item)) => {
                let error = "Terminal input queue is full.".to_string();
                emit_terminal_input_error(app, pane_id, instance_id, error.clone());
                send_terminal_input_queue_ack(returned_item.ack, Err(error));
                return;
            }
            Err(mpsc::error::TrySendError::Closed(returned_item)) => {
                if let Ok(mut queues) = state.terminal_input_queues.lock() {
                    if queues
                        .get(&queue_key)
                        .is_some_and(|current| current.id == handle.id)
                    {
                        queues.remove(&queue_key);
                    }
                }
                item = returned_item;
            }
        }
    }
}

#[tauri::command]
async fn terminal_input_transport_endpoint(
    app: AppHandle,
    state: State<'_, TerminalState>,
) -> Result<TerminalInputTransportEndpoint, String> {
    if let Ok(transport) = state.terminal_input_transport.lock() {
        if let Some(endpoint) = transport.clone() {
            return Ok(endpoint);
        }
    } else {
        return Err("Unable to read terminal input transport.".to_string());
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| format!("Unable to start terminal input transport: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Unable to read terminal input transport address: {error}"))?
        .port();
    let endpoint = TerminalInputTransportEndpoint {
        url: format!("ws://127.0.0.1:{port}/terminal-input"),
        token: uuid::Uuid::new_v4().to_string(),
    };

    {
        let mut transport = state
            .terminal_input_transport
            .lock()
            .map_err(|_| "Unable to save terminal input transport.".to_string())?;
        if let Some(existing) = transport.clone() {
            return Ok(existing);
        }
        *transport = Some(endpoint.clone());
    }

    spawn_terminal_input_transport_listener(app, listener, endpoint.token.clone());
    Ok(endpoint)
}

#[tauri::command]
async fn terminal_output_transport_endpoint(
    app: AppHandle,
    state: State<'_, TerminalState>,
) -> Result<TerminalOutputTransportEndpoint, String> {
    if let Ok(transport) = state.terminal_output_transport.lock() {
        if let Some(endpoint) = transport.clone() {
            return Ok(endpoint);
        }
    } else {
        return Err("Unable to read terminal output transport.".to_string());
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| format!("Unable to start terminal output transport: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Unable to read terminal output transport address: {error}"))?
        .port();
    let endpoint = TerminalOutputTransportEndpoint {
        url: format!("ws://127.0.0.1:{port}/terminal-output"),
        token: uuid::Uuid::new_v4().to_string(),
    };

    {
        let mut transport = state
            .terminal_output_transport
            .lock()
            .map_err(|_| "Unable to save terminal output transport.".to_string())?;
        if let Some(existing) = transport.clone() {
            return Ok(existing);
        }
        *transport = Some(endpoint.clone());
    }

    spawn_terminal_output_transport_listener(app, listener, endpoint.token.clone());
    Ok(endpoint)
}

fn spawn_terminal_input_transport_listener(
    app: AppHandle,
    listener: TcpListener,
    expected_token: String,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let app_handle = app.clone();
            let token = expected_token.clone();
            tauri::async_runtime::spawn(async move {
                handle_terminal_input_transport_connection(app_handle, stream, token).await;
            });
        }
    });
}

fn spawn_terminal_output_transport_listener(
    app: AppHandle,
    listener: TcpListener,
    expected_token: String,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let app_handle = app.clone();
            let token = expected_token.clone();
            tauri::async_runtime::spawn(async move {
                handle_terminal_output_transport_connection(app_handle, stream, token).await;
            });
        }
    });
}

async fn handle_terminal_input_transport_connection(
    app: AppHandle,
    stream: TcpStream,
    expected_token: String,
) {
    let Ok(mut socket) = accept_async(stream).await else {
        return;
    };

    while let Some(message) = socket.next().await {
        match message {
            Ok(Message::Text(text)) => {
                let Some(ack) =
                    handle_terminal_input_transport_message(&app, &expected_token, text.as_ref())
                        .await
                else {
                    let _ = socket.close(None).await;
                    break;
                };
                if let Some(ack) = ack {
                    let _ = socket
                        .send(Message::Text(
                            serde_json::to_string(&ack)
                                .unwrap_or_else(|_| {
                                    "{\"type\":\"terminal-input-ack\",\"messageId\":\"\",\"ok\":false,\"error\":\"Unable to serialize terminal input acknowledgement.\"}".to_string()
                                })
                                .into(),
                        ))
                        .await;
                }
            }
            Ok(Message::Binary(bytes)) => {
                let Ok(text) = std::str::from_utf8(bytes.as_ref()) else {
                    continue;
                };
                let Some(ack) =
                    handle_terminal_input_transport_message(&app, &expected_token, text).await
                else {
                    let _ = socket.close(None).await;
                    break;
                };
                if let Some(ack) = ack {
                    let _ = socket
                        .send(Message::Text(
                            serde_json::to_string(&ack)
                                .unwrap_or_else(|_| {
                                    "{\"type\":\"terminal-input-ack\",\"messageId\":\"\",\"ok\":false,\"error\":\"Unable to serialize terminal input acknowledgement.\"}".to_string()
                                })
                                .into(),
                        ))
                        .await;
                }
            }
            Ok(Message::Ping(payload)) => {
                let _ = socket.send(Message::Pong(payload)).await;
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(_) => break,
        }
    }
}

async fn handle_terminal_output_transport_connection(
    app: AppHandle,
    stream: TcpStream,
    expected_token: String,
) {
    let Ok(mut socket) = accept_async(stream).await else {
        return;
    };

    let subscribe_text = loop {
        let Some(message) = socket.next().await else {
            return;
        };
        match message {
            Ok(Message::Text(text)) => break text.to_string(),
            Ok(Message::Binary(bytes)) => {
                let Ok(text) = std::str::from_utf8(bytes.as_ref()) else {
                    continue;
                };
                break text.to_string();
            }
            Ok(Message::Ping(payload)) => {
                let _ = socket.send(Message::Pong(payload)).await;
            }
            Ok(Message::Close(_)) | Err(_) => return,
            Ok(_) => {}
        }
    };

    if subscribe_text.len() > MAX_TERMINAL_INPUT_TRANSPORT_MESSAGE_BYTES {
        let _ = socket.close(None).await;
        return;
    }

    let Ok(subscribe) = serde_json::from_str::<TerminalOutputTransportSubscribe>(&subscribe_text)
    else {
        let _ = socket.close(None).await;
        return;
    };

    if subscribe.token != expected_token || subscribe.r#type != "subscribe" {
        let _ = socket.close(None).await;
        return;
    }
    if validate_terminal_pane_id(&subscribe.pane_id).is_err() || subscribe.instance_id == 0 {
        let _ = socket.close(None).await;
        return;
    }

    let state = app.state::<TerminalState>();
    let subscriber_id = state
        .next_terminal_output_subscriber_id
        .fetch_add(1, Ordering::Relaxed);
    let key = terminal_output_transport_key(&subscribe.pane_id, subscribe.instance_id);
    let (sender, mut receiver) = mpsc::unbounded_channel::<Vec<u8>>();

    {
        let Ok(mut subscribers) = state.terminal_output_transport_subscribers.lock() else {
            let _ = socket.close(None).await;
            return;
        };
        subscribers
            .entry(key.clone())
            .or_default()
            .push(TerminalOutputTransportSubscriber {
                id: subscriber_id,
                sender,
            });
    }

    let ready_message = json!({
        "type": "ready",
        "id": subscribe.id.as_deref().unwrap_or_default(),
        "paneId": subscribe.pane_id,
        "instanceId": subscribe.instance_id,
    });
    if socket
        .send(Message::Text(ready_message.to_string().into()))
        .await
        .is_err()
    {
        remove_terminal_output_transport_subscriber(&state, &key, subscriber_id);
        return;
    }

    let (mut writer, mut reader) = socket.split();
    let writer_task = tauri::async_runtime::spawn(async move {
        while let Some(bytes) = receiver.recv().await {
            if writer.send(Message::Binary(bytes.into())).await.is_err() {
                break;
            }
        }
    });

    while let Some(message) = reader.next().await {
        match message {
            Ok(Message::Close(_)) | Err(_) => break,
            Ok(_) => {}
        }
    }

    writer_task.abort();
    remove_terminal_output_transport_subscriber(&state, &key, subscriber_id);
}

fn remove_terminal_output_transport_subscriber(
    state: &TerminalState,
    key: &str,
    subscriber_id: u64,
) {
    let Ok(mut subscribers) = state.terminal_output_transport_subscribers.lock() else {
        return;
    };
    let Some(terminal_subscribers) = subscribers.get_mut(key) else {
        return;
    };
    terminal_subscribers.retain(|subscriber| subscriber.id != subscriber_id);
    if terminal_subscribers.is_empty() {
        subscribers.remove(key);
    }
}

async fn handle_terminal_input_transport_message(
    app: &AppHandle,
    expected_token: &str,
    text: &str,
) -> Option<Option<TerminalInputTransportAck>> {
    if text.len() > MAX_TERMINAL_INPUT_TRANSPORT_MESSAGE_BYTES {
        emit_terminal_input_error(
            app,
            String::new(),
            None,
            "Terminal input transport message is too large.".to_string(),
        );
        return Some(None);
    }

    let envelope = match serde_json::from_str::<TerminalInputTransportEnvelope>(text) {
        Ok(envelope) => envelope,
        Err(error) => {
            emit_terminal_input_error(
                app,
                String::new(),
                None,
                format!("Unable to parse terminal input transport message: {error}"),
            );
            return Some(None);
        }
    };
    let message_id = envelope
        .message_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if envelope.token != expected_token {
        emit_terminal_input_error(
            app,
            envelope.payload.pane_id,
            envelope.payload.instance_id,
            "Terminal input transport authentication failed.".to_string(),
        );
        return None;
    }

    let Some(message_id) = message_id else {
        enqueue_terminal_input_event(app, envelope.payload);
        return Some(None);
    };

    let ack_payload_log = json!({
        "data": terminal_write_data_diagnostic(&envelope.payload.data),
        "has_prompt_event_id": envelope
            .payload
            .prompt_event_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty()),
        "has_prompt_event_text": envelope
            .payload
            .prompt_event_text
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty()),
        "instance_id": envelope.payload.instance_id,
        "message_id": clean_terminal_diagnostic_log_text(&message_id),
        "pane_id": clean_terminal_diagnostic_log_text(&envelope.payload.pane_id),
        "prompt_event_id": envelope.payload.prompt_event_id.as_deref().unwrap_or_default(),
        "prompt_event_source": envelope.payload.prompt_event_source.as_deref().unwrap_or_default(),
        "prompt_text_len": envelope.payload.prompt_event_text.as_deref().map(str::len).unwrap_or_default(),
        "thread_id": envelope.payload.thread_id.as_deref().unwrap_or_default(),
    });
    log_terminal_status_event(
        "backend.terminal_input_transport.submit_received",
        ack_payload_log.clone(),
    );
    let ack_receiver = enqueue_terminal_input_event_with_ack(app, envelope.payload);
    let result = match timeout(Duration::from_secs(8), ack_receiver).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Terminal input acknowledgement channel closed.".to_string()),
        Err(_) => Err("Terminal input write acknowledgement timed out.".to_string()),
    };
    let ok = result.is_ok();
    log_terminal_status_event(
        "backend.terminal_input_transport.submit_ack",
        json!({
            "error": result.as_ref().err().map(|value| clean_terminal_diagnostic_log_text(value)).unwrap_or_default(),
            "message_id": clean_terminal_diagnostic_log_text(&message_id),
            "ok": ok,
            "payload": ack_payload_log,
        }),
    );

    Some(Some(TerminalInputTransportAck {
        r#type: "terminal-input-ack",
        message_id,
        ok,
        error: result.err(),
    }))
}

fn register_terminal_input_event_listener(app: &tauri::App) {
    let app_handle = app.handle().clone();

    app.listen(TERMINAL_INPUT_EVENT, move |event| {
        let payload = match serde_json::from_str::<TerminalInputEventPayload>(event.payload()) {
            Ok(payload) => payload,
            Err(error) => {
                emit_terminal_input_error(
                    &app_handle,
                    String::new(),
                    None,
                    format!("Unable to parse terminal input event: {error}"),
                );
                return;
            }
        };
        enqueue_terminal_input_event(&app_handle, payload);
    });
}

async fn mark_terminal_parked_prompt_lifecycle_in_cloud(
    app: &AppHandle,
    cloud_mcp_state: &CloudMcpState,
    parked: &TerminalParkedPrompt,
    status: &str,
    body: &str,
) {
    cloud_mcp_mark_terminal_task_lifecycle(
        cloud_mcp_state,
        &parked.pane_id,
        parked.instance_id,
        &parked.working_directory,
        Some(&parked.coordination),
        Some(&parked.task_id),
        Some(&parked.title),
        status,
        "terminal-agent",
        body,
    )
    .await;
    cloud_mcp_record_voice_plan_terminal_lifecycle(app, cloud_mcp_state, parked, status, body)
        .await;
}

async fn terminal_write_inner(
    app: AppHandle,
    state: &TerminalState,
    cloud_mcp_state: &CloudMcpState,
    pane_id: String,
    instance_id: Option<u64>,
    data: String,
    prompt_event_id: Option<String>,
    prompt_event_revision: Option<u64>,
    prompt_event_source: Option<String>,
    prompt_event_submitted_at: Option<String>,
    prompt_event_text: Option<String>,
    todo_id: Option<String>,
    todo_dispatch_id: Option<String>,
    todo_command_id: Option<String>,
    todo_action: Option<String>,
    todo_resume_requested: Option<bool>,
    thread_id: Option<String>,
    _realtime_write: bool,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
    let Some(instance) = get_terminal_instance_if_current(state, &pane_id, instance_id).await?
    else {
        write_thread_bridge_diagnostic_log_entry(json!({
            "ts_ms": current_time_ms(),
            "phase": "backend.bridge.terminal_write.missing_session_any_input",
            "source": "backend",
            "app_pid": std::process::id(),
            "thread": terminal_diagnostic_thread_label(),
            "fields": {
                "data": terminal_write_data_diagnostic(&data),
                "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "has_prompt_event_text": prompt_event_text.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "thread_id": thread_id.as_deref().unwrap_or_default(),
            },
        }));
        if prompt_event_text
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        {
            write_thread_bridge_diagnostic_log_entry(json!({
                "ts_ms": current_time_ms(),
                "phase": "backend.bridge.terminal_write.missing_session",
                "source": "backend",
                "app_pid": std::process::id(),
                "thread": terminal_diagnostic_thread_label(),
                "fields": {
                    "data_len": data.len(),
                    "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                    "has_prompt_event_text": true,
                    "instance_id": instance_id,
                    "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                    "thread_id": thread_id.as_deref().unwrap_or_default(),
                },
            }));
            return Err("Terminal session is not running.".to_string());
        }
        return Ok(());
    };
    let prompt_submission_requested = prompt_event_text
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    if prompt_submission_requested {
        log_terminal_status_event(
            "backend.terminal_write.prompt_start",
            json!({
                "data": terminal_write_data_diagnostic(&data),
                "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "instance_id": instance.id,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "prompt_event_id": prompt_event_id.as_deref().unwrap_or_default(),
                "prompt_event_source": prompt_event_source.as_deref().unwrap_or_default(),
                "prompt_text_len": prompt_event_text.as_deref().map(str::len).unwrap_or_default(),
                "thread_id": thread_id.as_deref().unwrap_or_default(),
            }),
        );
    }
    if prompt_submission_requested {
        if let Some(coordination) = instance.coordination.clone() {
            let readiness = tauri::async_runtime::spawn_blocking(move || {
                ensure_terminal_coordination_ready_for_prompt(&coordination)
            })
            .await
            .map_err(|error| {
                format!("Unable to validate coordination session before prompt submit: {error}")
            })?;
            if let Err(error) = readiness {
                log_terminal_status_event(
                    "backend.terminal_write.prompt_coordination_not_ready",
                    json!({
                        "error": clean_terminal_diagnostic_log_text(&error),
                        "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                        "instance_id": instance.id,
                        "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                        "prompt_event_id": prompt_event_id.as_deref().unwrap_or_default(),
                        "prompt_event_source": prompt_event_source.as_deref().unwrap_or_default(),
                        "prompt_text_len": prompt_event_text.as_deref().map(str::len).unwrap_or_default(),
                        "thread_id": thread_id.as_deref().unwrap_or_default(),
                    }),
                );
                write_thread_bridge_diagnostic_log_entry(json!({
                    "ts_ms": current_time_ms(),
                    "phase": "backend.bridge.terminal_write.coordination_not_ready",
                    "source": "backend",
                    "app_pid": std::process::id(),
                    "thread": terminal_diagnostic_thread_label(),
                    "fields": {
                        "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                        "has_prompt_event_text": true,
                        "instance_id": instance.id,
                        "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                        "thread_id": thread_id.as_deref().unwrap_or_default(),
                    },
                }));
                return Err(error);
            }
        }
    }
    let _input_guard = instance.input_queue.lock().await;
    let original_data_diagnostic = terminal_write_data_diagnostic(&data);
    let data = normalize_terminal_enter_sequences_for_pty(data);
    let normalized_data_diagnostic = terminal_write_data_diagnostic(&data);
    let input_write_diagnostic_kind =
        terminal_input_write_diagnostic_kind(&data, &prompt_event_id, &prompt_event_text);
    write_thread_bridge_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": "backend.bridge.input_write_any_start",
        "source": "backend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": {
            "diagnostic_kind": input_write_diagnostic_kind.unwrap_or("raw_input"),
            "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
            "has_prompt_event_text": prompt_event_text.as_deref().is_some_and(|value| !value.trim().is_empty()),
            "instance_id": instance.id,
            "normalized_data": normalized_data_diagnostic.clone(),
            "original_data": original_data_diagnostic.clone(),
            "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
            "thread_id": thread_id.as_deref().unwrap_or_default(),
        },
    }));

    let escape_interrupt_task_id = if data == "\x1b" && instance.coordination.is_some() {
        instance
            .active_task
            .lock()
            .await
            .as_ref()
            .map(|task| task.task_id.clone())
    } else {
        None
    };
    if let Some(active_task_id) = escape_interrupt_task_id.as_deref() {
        write_terminal_interrupt_escape(&instance).await?;
        mark_terminal_active_task_interrupted(
            cloud_mcp_state,
            &pane_id,
            &instance,
            "escape_key",
            "Interrupted by Escape; the terminal remains open for follow-up instructions.",
        )
        .await?;
        interrupt_terminal_parked_prompts(
            &app,
            state,
            cloud_mcp_state,
            &pane_id,
            &instance,
            "escape_key",
            Some(active_task_id),
        )
        .await?;
        return Ok(());
    }

    if let Some(diagnostic_kind) = input_write_diagnostic_kind {
        let input_gate_before_write = {
            let gate = instance.input_gate.lock().await;
            terminal_input_gate_diagnostic_snapshot(&gate)
        };
        write_thread_bridge_diagnostic_log_entry(json!({
            "ts_ms": current_time_ms(),
            "phase": "backend.bridge.input_write_start",
            "source": "backend",
            "app_pid": std::process::id(),
            "thread": terminal_diagnostic_thread_label(),
            "fields": {
                "diagnostic_kind": diagnostic_kind,
                "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "has_prompt_event_text": prompt_event_text.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "input_gate_before_write": input_gate_before_write,
                "instance_id": instance.id,
                "normalized_data": normalized_data_diagnostic.clone(),
                "original_data": original_data_diagnostic.clone(),
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "thread_id": thread_id.as_deref().unwrap_or_default(),
            },
        }));
    }

    let input_write_started_at = Instant::now();
    let input_write_result = match write_terminal_input(
        Some(&app),
        state,
        &pane_id,
        instance_id,
        &data,
        "terminal.write.skipped_stale_or_missing",
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            if prompt_submission_requested {
                log_terminal_status_event(
                    "backend.terminal_write.prompt_write_error",
                    json!({
                        "elapsed_ms": terminal_diagnostic_elapsed_ms(input_write_started_at),
                        "error": clean_terminal_diagnostic_log_text(&error),
                        "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                        "instance_id": instance.id,
                        "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                        "prompt_event_id": prompt_event_id.as_deref().unwrap_or_default(),
                        "prompt_event_source": prompt_event_source.as_deref().unwrap_or_default(),
                        "prompt_text_len": prompt_event_text.as_deref().map(str::len).unwrap_or_default(),
                        "thread_id": thread_id.as_deref().unwrap_or_default(),
                    }),
                );
            }
            return Err(error);
        }
    };
    let input_write_elapsed_ms = terminal_diagnostic_elapsed_ms(input_write_started_at);
    if prompt_submission_requested {
        log_terminal_status_event(
            "backend.terminal_write.prompt_write_done",
            json!({
                "elapsed_ms": input_write_elapsed_ms,
                "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "instance_id": instance.id,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "prompt_event_id": prompt_event_id.as_deref().unwrap_or_default(),
                "prompt_event_source": prompt_event_source.as_deref().unwrap_or_default(),
                "prompt_text_len": prompt_event_text.as_deref().map(str::len).unwrap_or_default(),
                "thread_id": thread_id.as_deref().unwrap_or_default(),
                "wrote": input_write_result,
            }),
        );
    }
    write_thread_bridge_diagnostic_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": "backend.bridge.input_write_any_done",
        "source": "backend",
        "app_pid": std::process::id(),
        "thread": terminal_diagnostic_thread_label(),
        "fields": {
            "diagnostic_kind": input_write_diagnostic_kind.unwrap_or("raw_input"),
            "elapsed_ms": input_write_elapsed_ms,
            "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
            "has_prompt_event_text": prompt_event_text.as_deref().is_some_and(|value| !value.trim().is_empty()),
            "instance_id": instance.id,
            "normalized_data": normalized_data_diagnostic.clone(),
            "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
            "thread_id": thread_id.as_deref().unwrap_or_default(),
            "wrote": input_write_result,
        },
    }));
    if let Some(diagnostic_kind) = input_write_diagnostic_kind {
        write_thread_bridge_diagnostic_log_entry(json!({
            "ts_ms": current_time_ms(),
            "phase": "backend.bridge.input_write_done",
            "source": "backend",
            "app_pid": std::process::id(),
            "thread": terminal_diagnostic_thread_label(),
            "fields": {
                "diagnostic_kind": diagnostic_kind,
                "elapsed_ms": input_write_elapsed_ms,
                "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "has_prompt_event_text": prompt_event_text.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "instance_id": instance.id,
                "normalized_data": normalized_data_diagnostic.clone(),
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "thread_id": thread_id.as_deref().unwrap_or_default(),
                "wrote": input_write_result,
            },
        }));
    }

    let (observed_prompt, input_gate_before, input_gate_after) =
        terminal_observe_submitted_prompt(&instance, &data).await;
    if let Some(prompt) = observed_prompt {
        let requested_event_prompt = prompt_event_text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if is_terminal_control_prompt(&prompt) {
            write_thread_bridge_diagnostic_log_entry(json!({
                "ts_ms": current_time_ms(),
                "phase": "backend.bridge.prompt_observed_control_skip",
                "source": "backend",
                "app_pid": std::process::id(),
                "thread": terminal_diagnostic_thread_label(),
                "fields": {
                    "data_len": data.len(),
                    "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                    "has_prompt_event_text": prompt_event_text.as_deref().is_some_and(|value| !value.trim().is_empty()),
                    "instance_id": instance.id,
                    "normalized_data": normalized_data_diagnostic.clone(),
                    "observed_prompt_len": prompt.len(),
                    "original_data": original_data_diagnostic.clone(),
                    "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                    "prompt_prefix": clean_terminal_diagnostic_log_text(prompt.split_whitespace().next().unwrap_or_default()),
                    "thread_id": thread_id.as_deref().unwrap_or_default(),
                },
            }));
            return Ok(());
        }
        let prompt_event_text_matches_observed = requested_event_prompt
            .as_ref()
            .map(|value| value == &prompt)
            .unwrap_or(true);
        let event_prompt = prompt.clone();
        let submitted_prompt_source = if prompt_event_text_matches_observed {
            "observed_input_gate"
        } else {
            "observed_input_gate_mismatch"
        };
        let submitted_prompt_authoritative = terminal_prompt_submitted_source_is_authoritative(
            submitted_prompt_source,
            prompt_event_text_matches_observed,
            Some(&prompt),
        );
        emit_terminal_prompt_submitted(
            &app,
            &instance,
            &event_prompt,
            prompt_event_id.as_deref(),
            prompt_event_revision,
            prompt_event_source.as_deref(),
            prompt_event_submitted_at.as_deref(),
            todo_id.as_deref(),
            todo_dispatch_id.as_deref(),
            todo_command_id.as_deref(),
            todo_action.as_deref(),
            todo_resume_requested.unwrap_or(false),
            requested_event_prompt.as_deref(),
            Some(&prompt),
            prompt_event_text_matches_observed,
            submitted_prompt_source,
            thread_id.as_deref(),
        );
        log_terminal_status_event(
            "backend.terminal_write.prompt_observed",
            json!({
                "event_prompt_len": event_prompt.len(),
                "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "input_gate_after": input_gate_after,
                "input_gate_before": input_gate_before,
                "instance_id": instance.id,
                "observed_prompt_len": prompt.len(),
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "prompt_event_id": prompt_event_id.as_deref().unwrap_or_default(),
                "prompt_event_source": prompt_event_source.as_deref().unwrap_or_default(),
                "prompt_event_text_matches_observed": prompt_event_text_matches_observed,
                "submitted_event_prompt_authoritative": submitted_prompt_authoritative,
                "submitted_event_prompt_source": submitted_prompt_source,
                "thread_id": thread_id.as_deref().unwrap_or_default(),
            }),
        );
        write_thread_bridge_diagnostic_log_entry(json!({
            "ts_ms": current_time_ms(),
            "phase": "backend.bridge.prompt_observed",
            "source": "backend",
            "app_pid": std::process::id(),
            "thread": terminal_diagnostic_thread_label(),
            "fields": {
                "data_len": data.len(),
                "event_prompt_len": event_prompt.len(),
                "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "has_prompt_event_text": prompt_event_text.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "input_gate_after": input_gate_after,
                "input_gate_before": input_gate_before,
                "instance_id": instance.id,
                "normalized_data": normalized_data_diagnostic,
                "observed_prompt_len": prompt.len(),
                "observer_reason": "submitted_prompt_observed",
                "original_data": original_data_diagnostic,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "prompt_event_text_len": requested_event_prompt.as_deref().map(str::len).unwrap_or_default(),
                "prompt_event_text_matches_observed": prompt_event_text_matches_observed,
                "submitted_event_prompt_authoritative": submitted_prompt_authoritative,
                "submitted_event_prompt_source": submitted_prompt_source,
                "thread_id": thread_id.as_deref().unwrap_or_default(),
            },
        }));
        if submitted_prompt_authoritative && *instance.agent_started.lock().await {
            let cloud_state = cloud_mcp_state.clone();
            let pane_id_for_context = pane_id.clone();
            let working_directory = instance.working_directory.as_ref().clone();
            let coordination = instance.coordination.clone();
            let session_mode = instance.session_mode;
            let terminal_instance_id = instance.id;
            let active_task = instance.active_task.lock().await.clone();
            let local_task_id = active_task.as_ref().map(|task| task.task_id.clone());
            let local_task_title = active_task.as_ref().map(|task| task.title.clone());
            let metadata = instance.metadata.clone();
            let prompt_metadata = CloudMcpTerminalPromptMetadata {
                prompt_event_id: prompt_event_id.clone(),
                prompt_event_source: prompt_event_source.clone(),
                prompt_event_submitted_at: prompt_event_submitted_at.clone(),
                todo_id: todo_id.clone(),
                todo_dispatch_id: todo_dispatch_id.clone(),
                todo_command_id: todo_command_id.clone(),
                todo_action: todo_action.clone(),
                todo_resume_requested: todo_resume_requested.unwrap_or(false),
                terminal_index: metadata.terminal_index,
                thread_id: thread_id
                    .clone()
                    .or_else(|| Some(metadata.thread_id.clone())),
                workspace_id: metadata.workspace_id.clone(),
                workspace_name: metadata.workspace_name.clone(),
            };
            let prompt_for_cloud = prompt.clone();
            tauri::async_runtime::spawn(async move {
                cloud_mcp_terminal_context_pack_for_prompt(
                    cloud_state,
                    pane_id_for_context,
                    terminal_instance_id,
                    working_directory,
                    coordination,
                    session_mode,
                    local_task_id,
                    local_task_title,
                    prompt_for_cloud,
                    Some(prompt_metadata),
                )
                .await;
            });
        }
    } else if prompt_event_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || prompt_event_text
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        let observer_reason = terminal_prompt_observer_not_observed_reason(
            &data,
            &input_gate_before,
            &input_gate_after,
        );
        write_thread_bridge_diagnostic_log_entry(json!({
            "ts_ms": current_time_ms(),
            "phase": "backend.bridge.prompt_not_observed",
            "source": "backend",
            "app_pid": std::process::id(),
            "thread": terminal_diagnostic_thread_label(),
            "fields": {
                "data_len": data.len(),
                "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "has_prompt_event_text": prompt_event_text.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "input_gate_after": input_gate_after,
                "input_gate_before": input_gate_before,
                "instance_id": instance.id,
                "normalized_data": normalized_data_diagnostic,
                "observer_reason": observer_reason,
                "original_data": original_data_diagnostic,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "thread_id": thread_id.as_deref().unwrap_or_default(),
            },
        }));
        log_terminal_status_event(
            "backend.terminal_write.prompt_not_observed",
            json!({
                "data_len": data.len(),
                "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                "input_gate_after": input_gate_after,
                "input_gate_before": input_gate_before,
                "instance_id": instance.id,
                "observer_reason": observer_reason,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "prompt_event_id": prompt_event_id.as_deref().unwrap_or_default(),
                "prompt_event_source": prompt_event_source.as_deref().unwrap_or_default(),
                "prompt_text_len": prompt_event_text.as_deref().map(str::len).unwrap_or_default(),
                "thread_id": thread_id.as_deref().unwrap_or_default(),
            }),
        );
        if let Some(event_prompt) = prompt_event_text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
        {
            if observer_reason == "submit_with_empty_input_gate" {
                log_terminal_status_event(
                    "backend.terminal_write.prompt_event_text_empty_gate_skip",
                    json!({
                        "data_len": data.len(),
                        "instance_id": instance.id,
                        "observer_reason": observer_reason,
                        "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                        "prompt_event_id": prompt_event_id.as_deref().unwrap_or_default(),
                        "prompt_event_source": prompt_event_source.as_deref().unwrap_or_default(),
                        "prompt_text_len": event_prompt.len(),
                        "thread_id": thread_id.as_deref().unwrap_or_default(),
                    }),
                );
                write_thread_bridge_diagnostic_log_entry(json!({
                    "ts_ms": current_time_ms(),
                    "phase": "backend.bridge.prompt_event_text_empty_gate_skip",
                    "source": "backend",
                    "app_pid": std::process::id(),
                    "thread": terminal_diagnostic_thread_label(),
                    "fields": {
                        "data_len": data.len(),
                        "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                        "has_prompt_event_text": true,
                        "instance_id": instance.id,
                        "normalized_data": normalized_data_diagnostic.clone(),
                        "observer_reason": observer_reason,
                        "original_data": original_data_diagnostic.clone(),
                        "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                        "prompt_event_id": prompt_event_id.as_deref().unwrap_or_default(),
                        "prompt_event_source": prompt_event_source.as_deref().unwrap_or_default(),
                        "prompt_text_len": event_prompt.len(),
                        "thread_id": thread_id.as_deref().unwrap_or_default(),
                    },
                }));
                return Ok(());
            }
            if is_terminal_control_prompt(&event_prompt) {
                write_thread_bridge_diagnostic_log_entry(json!({
                    "ts_ms": current_time_ms(),
                    "phase": "backend.bridge.prompt_event_text_control_skip",
                    "source": "backend",
                    "app_pid": std::process::id(),
                    "thread": terminal_diagnostic_thread_label(),
                    "fields": {
                        "data_len": data.len(),
                        "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                        "has_prompt_event_text": true,
                        "instance_id": instance.id,
                        "normalized_data": normalized_data_diagnostic.clone(),
                        "original_data": original_data_diagnostic.clone(),
                        "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                        "prompt_prefix": clean_terminal_diagnostic_log_text(event_prompt.split_whitespace().next().unwrap_or_default()),
                        "thread_id": thread_id.as_deref().unwrap_or_default(),
                    },
                }));
                return Ok(());
            }
            log_terminal_status_event(
                "backend.terminal_write.prompt_event_text_unobserved_skip",
                json!({
                    "data_len": data.len(),
                    "instance_id": instance.id,
                    "observer_reason": observer_reason,
                    "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                    "prompt_event_id": prompt_event_id.as_deref().unwrap_or_default(),
                    "prompt_event_source": prompt_event_source.as_deref().unwrap_or_default(),
                    "prompt_text_len": event_prompt.len(),
                    "status_truth": "prompt_submit_not_authoritative",
                    "thread_id": thread_id.as_deref().unwrap_or_default(),
                }),
            );
            write_thread_bridge_diagnostic_log_entry(json!({
                "ts_ms": current_time_ms(),
                "phase": "backend.bridge.prompt_event_text_unobserved_skip",
                "source": "backend",
                "app_pid": std::process::id(),
                "thread": terminal_diagnostic_thread_label(),
                "fields": {
                    "data_len": data.len(),
                    "has_prompt_event_id": prompt_event_id.as_deref().is_some_and(|value| !value.trim().is_empty()),
                    "has_prompt_event_text": true,
                    "instance_id": instance.id,
                    "observer_reason": observer_reason,
                    "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                    "prompt_event_id": prompt_event_id.as_deref().unwrap_or_default(),
                    "prompt_event_source": prompt_event_source.as_deref().unwrap_or_default(),
                    "prompt_text_len": event_prompt.len(),
                    "thread_id": thread_id.as_deref().unwrap_or_default(),
                },
            }));
            return Ok(());
        }
    } else if let Some(diagnostic_kind) = input_write_diagnostic_kind {
        let observer_reason = terminal_prompt_observer_not_observed_reason(
            &data,
            &input_gate_before,
            &input_gate_after,
        );
        write_thread_bridge_diagnostic_log_entry(json!({
            "ts_ms": current_time_ms(),
            "phase": "backend.bridge.input_observed_no_submit",
            "source": "backend",
            "app_pid": std::process::id(),
            "thread": terminal_diagnostic_thread_label(),
            "fields": {
                "data_len": data.len(),
                "diagnostic_kind": diagnostic_kind,
                "input_gate_after": input_gate_after,
                "input_gate_before": input_gate_before,
                "instance_id": instance.id,
                "normalized_data": normalized_data_diagnostic,
                "observer_reason": observer_reason,
                "original_data": original_data_diagnostic,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "thread_id": thread_id.as_deref().unwrap_or_default(),
            },
        }));
    }

    Ok(())
}

#[tauri::command]
async fn terminal_write(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    pane_id: String,
    instance_id: Option<u64>,
    data: String,
    prompt_event_id: Option<String>,
    prompt_event_revision: Option<u64>,
    prompt_event_source: Option<String>,
    prompt_event_submitted_at: Option<String>,
    prompt_event_text: Option<String>,
    todo_id: Option<String>,
    todo_dispatch_id: Option<String>,
    todo_command_id: Option<String>,
    todo_action: Option<String>,
    todo_resume_requested: Option<bool>,
    thread_id: Option<String>,
) -> Result<(), String> {
    terminal_write_inner(
        app,
        state.inner(),
        cloud_mcp_state.inner(),
        pane_id,
        instance_id,
        data,
        prompt_event_id,
        prompt_event_revision,
        prompt_event_source,
        prompt_event_submitted_at,
        prompt_event_text,
        todo_id,
        todo_dispatch_id,
        todo_command_id,
        todo_action,
        todo_resume_requested,
        thread_id,
        false,
    )
    .await
}

#[tauri::command]
async fn terminal_write_realtime(
    app: AppHandle,
    pane_id: String,
    instance_id: Option<u64>,
    data: String,
    prompt_event_id: Option<String>,
    prompt_event_revision: Option<u64>,
    prompt_event_source: Option<String>,
    prompt_event_submitted_at: Option<String>,
    prompt_event_text: Option<String>,
    todo_id: Option<String>,
    todo_dispatch_id: Option<String>,
    todo_command_id: Option<String>,
    todo_action: Option<String>,
    todo_resume_requested: Option<bool>,
    thread_id: Option<String>,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
    if data.len() > MAX_TERMINAL_WRITE_BYTES {
        return Err("Terminal input chunk is too large.".to_string());
    }

    let task_app = app.clone();
    let error_pane_id = pane_id.clone();
    let error_instance_id = instance_id;
    tauri::async_runtime::spawn(async move {
        let state = task_app.state::<TerminalState>();
        let cloud_mcp_state = task_app.state::<CloudMcpState>();
        if let Err(error) = terminal_write_inner(
            task_app.clone(),
            state.inner(),
            cloud_mcp_state.inner(),
            pane_id,
            instance_id,
            data,
            prompt_event_id,
            prompt_event_revision,
            prompt_event_source,
            prompt_event_submitted_at,
            prompt_event_text,
            todo_id,
            todo_dispatch_id,
            todo_command_id,
            todo_action,
            todo_resume_requested,
            thread_id,
            true,
        )
        .await
        {
            emit_terminal_input_error(&task_app, error_pane_id, error_instance_id, error);
        }
    });

    Ok(())
}

fn terminal_provider_turn_should_reconcile_coordination(
    reconcile_coordination: Option<bool>,
) -> bool {
    reconcile_coordination.unwrap_or(false)
}

#[tauri::command]
async fn terminal_provider_turn_completed(
    app: AppHandle,
    state: State<'_, TerminalState>,
    pane_id: String,
    instance_id: Option<u64>,
    reason: Option<String>,
    reconcile_coordination: Option<bool>,
) -> Result<Value, String> {
    validate_terminal_pane_id(&pane_id)?;
    if !terminal_provider_turn_should_reconcile_coordination(reconcile_coordination) {
        return Ok(json!({
            "ok": true,
            "status": "skipped",
            "reason": "provider_turn_not_coordination_scoped",
        }));
    }
    let Some(instance) = get_terminal_instance_if_current(&state, &pane_id, instance_id).await?
    else {
        return Ok(json!({
            "ok": true,
            "status": "skipped",
            "reason": "stale_or_missing_terminal",
        }));
    };
    let Some(coordination) = instance.coordination.clone() else {
        return Ok(json!({
            "ok": true,
            "status": "skipped",
            "reason": "terminal_has_no_coordination_session",
        }));
    };
    let kernel = crate::coordination::CoordinationKernel::open(
        &coordination.repo_path,
        Some(PathBuf::from(&coordination.db_path)),
    )?;
    let active_task_id = {
        let active_task = instance.active_task.lock().await;
        active_task.as_ref().map(|task| task.task_id.clone())
    };
    let session_task_id = kernel
        .query_json(
            "SELECT task_id
             FROM agent_sessions
             WHERE id=?1
             LIMIT 1",
            &[&coordination.session_id],
        )
        .ok()
        .and_then(|rows| rows.into_iter().next())
        .and_then(|row| row["task_id"].as_str().map(str::to_string));
    let latest_session_task_id = kernel
        .query_json(
            "SELECT id
             FROM tasks
             WHERE claimed_session_id=?1
             ORDER BY updated_at DESC, created_at DESC
             LIMIT 1",
            &[&coordination.session_id],
        )
        .ok()
        .and_then(|rows| rows.into_iter().next())
        .and_then(|row| row["id"].as_str().map(str::to_string));
    let Some(task_id) = active_task_id
        .or(session_task_id)
        .or(latest_session_task_id)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(json!({
            "ok": true,
            "status": "skipped",
            "reason": "terminal_has_no_known_coordination_task",
        }));
    };

    let result = kernel.reconcile_provider_turn_completed(
        &task_id,
        Some(&coordination.session_id),
        reason.as_deref(),
    )?;
    log_terminal_diagnostic_event(
        &app,
        "backend.provider_turn_completed.reconciled",
        json!({
            "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
            "session_id": coordination.session_id,
            "task_id": task_id,
            "result": result.clone(),
        }),
    );
    Ok(result)
}

#[tauri::command]
async fn terminal_refresh_theme(
    state: State<'_, TerminalState>,
    pane_id: String,
    instance_id: Option<u64>,
) -> Result<bool, String> {
    validate_terminal_pane_id(&pane_id)?;
    let Some(instance) = get_terminal_instance_if_current(&state, &pane_id, instance_id).await?
    else {
        return Ok(false);
    };

    if !terminal_metadata_is_opencode(&instance.metadata) {
        return Ok(false);
    }

    if !*instance.agent_started.lock().await {
        return Ok(false);
    }

    let root_pid = {
        let child = instance.child.lock().await;
        child.as_ref().and_then(|child| child.process_id())
    };
    let Some(root_pid) = root_pid.filter(|pid| *pid > 0) else {
        return Ok(false);
    };

    Ok(!signal_opencode_theme_refresh(root_pid)?.is_empty())
}

#[tauri::command]
async fn terminal_delete_selection(
    state: State<'_, TerminalState>,
    pane_id: String,
    instance_id: Option<u64>,
    selection: String,
    current_line: Option<String>,
    selection_start: Option<usize>,
    selection_end: Option<usize>,
) -> Result<Value, String> {
    validate_terminal_pane_id(&pane_id)?;
    let selected_text = selection
        .chars()
        .filter(|character| !matches!(character, '\r' | '\n'))
        .collect::<String>();

    if selected_text.is_empty() {
        return Ok(json!({
            "deleted": false,
            "reason": "empty_selection",
        }));
    }

    let Some(instance) = get_terminal_instance_if_current(&state, &pane_id, instance_id).await?
    else {
        return Ok(json!({
            "deleted": false,
            "reason": "stale_or_missing_terminal",
        }));
    };

    let _input_guard = instance.input_queue.lock().await;
    let mut gate = instance.input_gate.lock().await;
    let observed_line = current_line
        .unwrap_or_default()
        .chars()
        .filter(|character| !matches!(character, '\r' | '\n'))
        .collect::<String>();
    let current_line = if observed_line.trim().is_empty() {
        gate.current_line.clone()
    } else {
        observed_line
    };
    let line_char_len = current_line.chars().count();
    let offset_range = selection_start
        .zip(selection_end)
        .map(|(start, end)| (start.min(end), start.max(end)))
        .filter(|(start, end)| *end > *start && *end <= line_char_len);
    let text_range = if offset_range.is_some() {
        offset_range
    } else {
        current_line.rfind(&selected_text).map(|start_byte| {
            let start = current_line[..start_byte].chars().count();
            let end = start + selected_text.chars().count();
            (start, end)
        })
    };
    let Some((start, end)) = text_range else {
        return Ok(json!({
            "deleted": false,
            "reason": "selection_not_in_current_input",
        }));
    };

    let start_byte = terminal_input_gate_byte_index(&current_line, start);
    let end_byte = terminal_input_gate_byte_index(&current_line, end);
    let mut next_line = current_line;
    next_line.replace_range(start_byte..end_byte, "");
    let rewrite_input = format!("\u{15}{next_line}");
    if rewrite_input.len() > MAX_TERMINAL_WRITE_BYTES {
        return Err("Terminal rewrite input is too large.".to_string());
    }

    {
        let mut writer = instance.writer.lock().await;
        log_terminal_crash_forensics_event(
            "backend.terminal_selection_delete.write.begin",
            json!({
                "bytes": rewrite_input.len(),
                "instance_id": instance.id,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
            }),
        );
        if let Err(error) = writer.write_all(rewrite_input.as_bytes()) {
            log_terminal_crash_forensics_event(
                "backend.terminal_selection_delete.write.error",
                json!({
                    "bytes": rewrite_input.len(),
                    "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                    "instance_id": instance.id,
                    "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                    "stage": "write_all",
                }),
            );
            return Err(format!(
                "Unable to write terminal selection delete: {error}"
            ));
        }
        if let Err(error) = writer.flush() {
            log_terminal_crash_forensics_event(
                "backend.terminal_selection_delete.write.error",
                json!({
                    "bytes": rewrite_input.len(),
                    "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                    "instance_id": instance.id,
                    "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                    "stage": "flush",
                }),
            );
            return Err(format!(
                "Unable to flush terminal selection delete: {error}"
            ));
        }
        log_terminal_crash_forensics_event(
            "backend.terminal_selection_delete.write.done",
            json!({
                "bytes": rewrite_input.len(),
                "instance_id": instance.id,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
            }),
        );
    }

    gate.current_line = next_line;
    gate.cursor_position = terminal_input_gate_line_char_len(&gate);
    gate.current_line_user_touched = true;

    Ok(json!({
        "deleted": true,
        "remainingLine": gate.current_line,
        "remainingChars": gate.current_line.chars().count(),
        "remaining_chars": gate.current_line.chars().count(),
        "removedChars": selected_text.chars().count(),
        "removed_chars": selected_text.chars().count(),
    }))
}

#[tauri::command]
async fn terminal_cancel_parked_task(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    pane_id: String,
    instance_id: u64,
    task_id: String,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
    let parked_key = terminal_parked_prompt_key(&pane_id, instance_id, &task_id);
    let Some(parked) = state.parked_prompts.write().await.remove(&parked_key) else {
        return Ok(());
    };

    if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
        &parked.coordination.repo_path,
        Some(PathBuf::from(&parked.coordination.db_path)),
    ) {
        let _ = kernel.mark_terminal_task_stopped(
            &parked.task_id,
            &parked.coordination.session_id,
            "cancelled",
            "parked_task_cancel_button",
        );
    }

    if let Some(instance) =
        get_terminal_instance_if_current(&state, &pane_id, Some(instance_id)).await?
    {
        let mut active_task = instance.active_task.lock().await;
        if active_task
            .as_ref()
            .is_some_and(|task| task.task_id == parked.task_id)
        {
            *active_task = None;
        }
    }

    emit_terminal_parked_prompt_event(&app, &parked, "cancelled", Some("cancel_button"));

    let app_for_cloud = app.clone();
    let cloud_state = cloud_mcp_state.inner().clone();
    tauri::async_runtime::spawn(async move {
        mark_terminal_parked_prompt_lifecycle_in_cloud(
            &app_for_cloud,
            &cloud_state,
            &parked,
            "cancelled",
            "Cancelled before resuming: the parked task was cancelled from the terminal bar.",
        )
        .await;
    });

    Ok(())
}

async fn write_terminal_interrupt_escape(instance: &TerminalInstance) -> Result<(), String> {
    let mut writer = instance.writer.lock().await;
    log_terminal_crash_forensics_event(
        "backend.terminal_interrupt.write.begin",
        json!({
            "bytes": 1,
            "instance_id": instance.id,
            "metadata": terminal_metadata_forensics_json(&instance.metadata),
        }),
    );
    if let Err(error) = writer.write_all(b"\x1b") {
        log_terminal_crash_forensics_event(
            "backend.terminal_interrupt.write.error",
            json!({
                "bytes": 1,
                "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                "instance_id": instance.id,
                "stage": "write_all",
            }),
        );
        return Err(format!("Unable to send terminal interrupt: {error}"));
    }
    if let Err(error) = writer.flush() {
        log_terminal_crash_forensics_event(
            "backend.terminal_interrupt.write.error",
            json!({
                "bytes": 1,
                "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                "instance_id": instance.id,
                "stage": "flush",
            }),
        );
        return Err(format!("Unable to flush terminal interrupt: {error}"));
    }
    log_terminal_crash_forensics_event(
        "backend.terminal_interrupt.write.done",
        json!({
            "bytes": 1,
            "instance_id": instance.id,
        }),
    );
    Ok(())
}

async fn mark_terminal_active_task_interrupted(
    cloud_mcp_state: &CloudMcpState,
    pane_id: &str,
    instance: &TerminalInstance,
    reason: &str,
    lifecycle_message: &str,
) -> Result<bool, String> {
    let active_task = instance.active_task.lock().await.clone();
    let (Some(coordination), Some(active_task)) =
        (instance.coordination.as_ref(), active_task.as_ref())
    else {
        return Ok(false);
    };

    if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
        &coordination.repo_path,
        Some(PathBuf::from(&coordination.db_path)),
    ) {
        let _ = kernel.mark_terminal_task_stopped(
            &active_task.task_id,
            &coordination.session_id,
            "interrupted",
            reason,
        );
    }
    cloud_mcp_mark_terminal_task_lifecycle(
        cloud_mcp_state,
        pane_id,
        instance.id,
        instance.working_directory.as_ref(),
        Some(coordination),
        Some(&active_task.task_id),
        Some(&active_task.title),
        "interrupted",
        "terminal-agent",
        lifecycle_message,
    )
    .await;
    let mut stored_active_task = instance.active_task.lock().await;
    if stored_active_task
        .as_ref()
        .is_some_and(|task| task.task_id == active_task.task_id)
    {
        *stored_active_task = None;
    }
    Ok(true)
}

fn mark_terminal_parked_prompt_stopped(parked: &TerminalParkedPrompt, status: &str, reason: &str) {
    if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
        &parked.coordination.repo_path,
        Some(PathBuf::from(&parked.coordination.db_path)),
    ) {
        let _ = kernel.mark_terminal_task_stopped(
            &parked.task_id,
            &parked.coordination.session_id,
            status,
            reason,
        );
    }
}

async fn interrupt_terminal_parked_prompts(
    app: &AppHandle,
    state: &TerminalState,
    cloud_mcp_state: &CloudMcpState,
    pane_id: &str,
    instance: &TerminalInstance,
    reason: &str,
    skip_kernel_task_id: Option<&str>,
) -> Result<usize, String> {
    let parked_to_interrupt = {
        let mut parked = state.parked_prompts.write().await;
        let matching_keys = parked
            .iter()
            .filter_map(|(key, value)| {
                (value.pane_id == pane_id && value.instance_id == instance.id).then(|| key.clone())
            })
            .collect::<Vec<_>>();
        matching_keys
            .into_iter()
            .filter_map(|key| parked.remove(&key))
            .collect::<Vec<_>>()
    };
    let interrupted_count = parked_to_interrupt.len();
    for parked in parked_to_interrupt {
        if skip_kernel_task_id != Some(parked.task_id.as_str()) {
            mark_terminal_parked_prompt_stopped(&parked, "interrupted", reason);
        }
        cloud_mcp_mark_terminal_task_lifecycle(
            cloud_mcp_state,
            &parked.pane_id,
            parked.instance_id,
            &parked.working_directory,
            Some(&parked.coordination),
            Some(&parked.task_id),
            Some(&parked.title),
            "interrupted",
            "terminal-agent",
            "Interrupted by Escape while parked; the task was not marked cancelled.",
        )
        .await;
        emit_terminal_parked_prompt_event(app, &parked, "interrupted", Some("escape_key"));
    }
    Ok(interrupted_count)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalInterruptAgentResult {
    interrupted_active_task: bool,
    interrupted_parked_prompt_count: usize,
    wrote_escape: bool,
}

#[tauri::command]
async fn terminal_interrupt_agent(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    pane_id: String,
    instance_id: Option<u64>,
    reason: Option<String>,
) -> Result<TerminalInterruptAgentResult, String> {
    validate_terminal_pane_id(&pane_id)?;
    let Some(instance) = get_terminal_instance_if_current(&state, &pane_id, instance_id).await?
    else {
        return Ok(TerminalInterruptAgentResult {
            interrupted_active_task: false,
            interrupted_parked_prompt_count: 0,
            wrote_escape: false,
        });
    };
    let reason = reason.unwrap_or_else(|| "escape_key".to_string());

    let active_task_id = instance
        .active_task
        .lock()
        .await
        .as_ref()
        .map(|task| task.task_id.clone());
    write_terminal_interrupt_escape(&instance).await?;
    let interrupted_active_task = mark_terminal_active_task_interrupted(
        cloud_mcp_state.inner(),
        &pane_id,
        &instance,
        &reason,
        "Interrupted by Escape; the terminal remains open for follow-up instructions.",
    )
    .await?;
    if !interrupted_active_task {
        log_terminal_status_event(
            "backend.terminal_interrupt.manual_escape",
            json!({
                "instance_id": instance.id,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "reason": clean_terminal_diagnostic_log_text(&reason),
            }),
        );
    }
    let interrupted_parked_prompt_count = interrupt_terminal_parked_prompts(
        &app,
        state.inner(),
        cloud_mcp_state.inner(),
        &pane_id,
        &instance,
        &reason,
        active_task_id.as_deref(),
    )
    .await?;

    Ok(TerminalInterruptAgentResult {
        interrupted_active_task,
        interrupted_parked_prompt_count,
        wrote_escape: true,
    })
}

async fn resize_terminal_instance(
    app: Option<&AppHandle>,
    instance: &TerminalInstance,
    size: PtySize,
    force: bool,
) -> Result<(), String> {
    let resize_started_at = Instant::now();
    log_terminal_crash_forensics_event(
        "backend.terminal_resize.begin",
        json!({
            "cols": size.cols,
            "force": force,
            "instance_id": instance.id,
            "rows": size.rows,
        }),
    );
    let mut current_size = instance.size.lock().await;

    if *current_size == size && !force {
        log_terminal_crash_forensics_event(
            "backend.terminal_resize.skip",
            json!({
                "cols": size.cols,
                "instance_id": instance.id,
                "reason": "unchanged",
                "rows": size.rows,
            }),
        );
        return Ok(());
    }

    let master = instance.master.lock().await;

    if let Err(error) = master.resize(size) {
        log_terminal_crash_forensics_event(
            "backend.terminal_resize.error",
            json!({
                "cols": size.cols,
                "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                "instance_id": instance.id,
                "rows": size.rows,
            }),
        );
        return Err(format!("Unable to resize terminal: {error}"));
    }
    *current_size = size;
    let elapsed_ms = terminal_diagnostic_elapsed_ms(resize_started_at);
    log_terminal_crash_forensics_event(
        "backend.terminal_resize.done",
        json!({
            "cols": size.cols,
            "elapsed_ms": elapsed_ms,
            "instance_id": instance.id,
            "rows": size.rows,
        }),
    );
    if elapsed_ms >= TERMINAL_DIAGNOSTIC_SLOW_MS {
        if let Some(app) = app {
            log_terminal_diagnostic_event(
                app,
                "backend.resize_pty.slow",
                json!({
                    "cols": size.cols,
                    "elapsed_ms": elapsed_ms,
                    "instance_id": instance.id,
                    "rows": size.rows,
                }),
            );
        }
    }

    Ok(())
}

async fn resolve_terminal_for_resize(
    state: &TerminalState,
    pane_id: Option<String>,
    instance_id: Option<u64>,
) -> Result<Option<(String, TerminalInstance)>, String> {
    if let Some(pane_id) = pane_id.filter(|value| !value.trim().is_empty()) {
        validate_terminal_pane_id(&pane_id)?;
        return get_terminal_instance_if_current(state, &pane_id, instance_id)
            .await
            .map(|instance| instance.map(|instance| (pane_id, instance)));
    }

    let terminals = state.terminals.read().await;

    if terminals.is_empty() {
        return Err("Terminal session is not running.".to_string());
    }

    if terminals.len() > 1 {
        return Err(
            "Terminal pane id is required when multiple terminal sessions are running.".to_string(),
        );
    }

    let Some((resolved_pane_id, instance)) = terminals
        .iter()
        .next()
        .map(|(resolved_pane_id, instance)| (resolved_pane_id.clone(), instance.clone()))
    else {
        return Err("Terminal session is not running.".to_string());
    };

    if instance_id.is_some_and(|expected_id| expected_id != instance.id) {
        return Ok(None);
    }

    Ok(Some((resolved_pane_id, instance)))
}

#[tauri::command]
async fn resize_terminal(
    app: AppHandle,
    state: State<'_, TerminalState>,
    pane_id: Option<String>,
    instance_id: Option<u64>,
    cols: u16,
    rows: u16,
    force: Option<bool>,
) -> Result<(), String> {
    let size = match validate_terminal_size(cols, rows) {
        Ok(size) => size,
        Err(error) => {
            return Err(error);
        }
    };
    let resolved = match resolve_terminal_for_resize(&state, pane_id.clone(), instance_id).await {
        Ok(resolved) => resolved,
        Err(error) => {
            return Err(error);
        }
    };
    let Some((_, instance)) = resolved else {
        return Ok(());
    };

    resize_terminal_instance(Some(&app), &instance, size, force.unwrap_or(false)).await?;

    Ok(())
}

#[tauri::command]
async fn terminal_resize(
    app: AppHandle,
    state: State<'_, TerminalState>,
    pane_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if let Err(error) = validate_terminal_pane_id(&pane_id) {
        return Err(error);
    }

    let size = match validate_terminal_size(cols, rows) {
        Ok(size) => size,
        Err(error) => {
            return Err(error);
        }
    };
    let instance = match get_terminal_instance(&state, &pane_id).await {
        Ok(instance) => instance,
        Err(error) => {
            return Err(error);
        }
    };
    resize_terminal_instance(Some(&app), &instance, size, false).await?;

    Ok(())
}

#[tauri::command]
async fn terminal_close(
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    pane_id: String,
    instance_id: Option<u64>,
    preserve_coordination_session: Option<bool>,
    wait_for_cleanup: Option<bool>,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
    let preserve_coordination_session = preserve_coordination_session.unwrap_or(false);
    let wait_for_cleanup = wait_for_cleanup.unwrap_or(false);
    let lifecycle_lock = Arc::clone(&state.lifecycle_lock);
    let _lifecycle_guard = lifecycle_lock.lock().await;

    close_terminal_session(
        &state,
        Some(cloud_mcp_state.inner()),
        &pane_id,
        instance_id,
        preserve_coordination_session,
        wait_for_cleanup,
    )
    .await?;

    Ok(())
}

#[tauri::command]
async fn terminal_close_all(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
) -> Result<TerminalCloseAllResult, String> {
    let lifecycle_lock = Arc::clone(&state.lifecycle_lock);
    let _lifecycle_guard = lifecycle_lock.lock().await;
    let closed = close_all_terminal_sessions(app, &state, cloud_mcp_state.inner(), None).await?;

    Ok(TerminalCloseAllResult { closed })
}

#[tauri::command]
async fn terminal_headless_output_snapshot(
    state: State<'_, TerminalState>,
    pane_id: String,
    instance_id: Option<u64>,
) -> Result<TerminalHeadlessOutputSnapshot, String> {
    validate_terminal_pane_id(&pane_id)?;
    let instance = {
        let terminals = state.terminals.read().await;
        terminals
            .get(&pane_id)
            .cloned()
            .ok_or_else(|| "Terminal session not found.".to_string())?
    };
    if instance_id.is_some_and(|expected| expected != instance.id) {
        return Err("Terminal session is stale.".to_string());
    }

    let output = instance
        .headless_output
        .lock()
        .map_err(|_| "Terminal output snapshot lock poisoned.".to_string())?;
    Ok(output.snapshot(&pane_id, instance.id))
}

#[tauri::command]
async fn terminal_headless_output_delta(
    state: State<'_, TerminalState>,
    pane_id: String,
    instance_id: Option<u64>,
    since_total_bytes: Option<u64>,
) -> Result<TerminalHeadlessOutputDelta, String> {
    validate_terminal_pane_id(&pane_id)?;
    let instance = {
        let terminals = state.terminals.read().await;
        terminals
            .get(&pane_id)
            .cloned()
            .ok_or_else(|| "Terminal session not found.".to_string())?
    };
    if instance_id.is_some_and(|expected| expected != instance.id) {
        return Err("Terminal session is stale.".to_string());
    }

    let output = instance
        .headless_output
        .lock()
        .map_err(|_| "Terminal output delta lock poisoned.".to_string())?;
    Ok(output.delta_since(&pane_id, instance.id, since_total_bytes.unwrap_or(0)))
}

#[tauri::command]
async fn terminal_live_sessions(
    state: State<'_, TerminalState>,
) -> Result<TerminalLiveSessionsResult, String> {
    let sessions = {
        let terminals = state.terminals.read().await;
        terminals
            .iter()
            .map(|(pane_id, instance)| (pane_id.clone(), instance.clone()))
            .collect::<Vec<_>>()
    };

    let parked_prompts = {
        let parked = state.parked_prompts.read().await;
        parked
            .values()
            .cloned()
            .map(|prompt| {
                let key = terminal_parked_prompt_key(
                    &prompt.pane_id,
                    prompt.instance_id,
                    &prompt.task_id,
                );
                (key, terminal_live_parked_prompt_summary(&prompt))
            })
            .collect::<HashMap<_, _>>()
    };

    let mut summaries = Vec::with_capacity(sessions.len());

    for (pane_id, instance) in sessions {
        let active_task =
            instance
                .active_task
                .lock()
                .await
                .clone()
                .map(|task| TerminalLiveActiveTaskSummary {
                    task_id: task.task_id,
                    title: task.title,
                });
        let parked_prompt = parked_prompts
            .values()
            .find(|prompt| prompt.pane_id == pane_id && prompt.instance_id == instance.id)
            .cloned();
        let coordination =
            instance
                .coordination
                .as_ref()
                .map(|coordination| TerminalLiveCoordinationSummary {
                    repo_path: coordination.repo_path.clone(),
                    agent_id: coordination.agent_id.clone(),
                    agent_kind: coordination.agent_kind.clone(),
                    session_id: coordination.session_id.clone(),
                    terminal_launch_epoch: coordination.terminal_launch_epoch.clone(),
                });
        let metadata = instance.metadata.clone();
        let has_active_task = active_task.is_some();
        let parked = parked_prompt.is_some();

        summaries.push(TerminalLiveSessionSummary {
            pane_id,
            instance_id: instance.id,
            workspace_id: metadata.workspace_id,
            workspace_name: metadata.workspace_name,
            terminal_index: metadata.terminal_index,
            thread_id: metadata.thread_id,
            agent_id: metadata.agent_id,
            agent_kind: metadata.agent_kind,
            working_directory: instance.working_directory.to_string_lossy().to_string(),
            session_mode: instance.session_mode.as_str().to_string(),
            file_authority: instance.session_mode.file_authority().to_string(),
            coordination,
            active_task,
            parked_prompt,
            has_active_task,
            parked,
        });
    }

    summaries.sort_by(|left, right| {
        left.workspace_name
            .cmp(&right.workspace_name)
            .then_with(|| left.workspace_id.cmp(&right.workspace_id))
            .then_with(|| left.terminal_index.cmp(&right.terminal_index))
            .then_with(|| left.pane_id.cmp(&right.pane_id))
    });

    let mut parked_prompt_summaries = parked_prompts.into_values().collect::<Vec<_>>();
    parked_prompt_summaries.sort_by(|left, right| {
        left.pane_id
            .cmp(&right.pane_id)
            .then_with(|| left.instance_id.cmp(&right.instance_id))
            .then_with(|| left.task_id.cmp(&right.task_id))
    });

    Ok(TerminalLiveSessionsResult {
        generated_at_ms: terminal_now_ms(),
        sessions: summaries,
        parked_prompts: parked_prompt_summaries,
    })
}

#[cfg(test)]
mod terminal_tests {
    use super::*;

    #[test]
    fn provider_turn_completion_reconciliation_requires_explicit_opt_in() {
        assert!(!terminal_provider_turn_should_reconcile_coordination(None));
        assert!(!terminal_provider_turn_should_reconcile_coordination(Some(
            false
        )));
        assert!(terminal_provider_turn_should_reconcile_coordination(Some(
            true
        )));
    }

    fn terminal_test_repo(name: &str) -> PathBuf {
        let repo = std::env::temp_dir().join(format!(
            "diffforge_terminal_test_{}_{}",
            name,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&repo).unwrap();
        let status = Command::new("git").arg("init").arg(&repo).status().unwrap();
        assert!(status.success());
        repo
    }

    fn terminal_test_repo_with_commit(name: &str) -> PathBuf {
        let repo = terminal_test_repo(name);
        fs::write(repo.join("README.md"), "initial\n").unwrap();
        for args in [
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Diff Forge Test"],
            vec!["add", "README.md"],
            vec!["commit", "-m", "initial"],
        ] {
            let status = Command::new("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .status()
                .unwrap();
            assert!(status.success());
        }
        repo
    }

    fn terminal_test_git(path: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .status()
            .unwrap();
        assert!(status.success());
    }

    fn terminal_test_directory(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "diffforge_terminal_test_{}_{}",
            name,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn terminal_test_task_guard_identity(
        repo: &Path,
        slot_key: &str,
        lease_resource: Option<&str>,
    ) -> (DiffForgeWriteGuardIdentity, PathBuf) {
        let kernel = crate::coordination::CoordinationKernel::init(repo, None).unwrap();
        let session = kernel
            .create_terminal_session_for_slot_key(
                slot_key,
                "Codex",
                "codex",
                None,
                None,
                Some(&format!("terminal-{slot_key}")),
                true,
                None,
                None,
                Some("test-launch"),
                Some("worktree_required"),
            )
            .unwrap();
        let agent_id = session["agentId"].as_str().unwrap().to_string();
        let session_id = session["id"].as_str().unwrap().to_string();
        let worktree_path = PathBuf::from(session["writeRoot"].as_str().unwrap());
        let task = kernel
            .create_task("Task", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_id = task["id"].as_str().unwrap();
        kernel.claim_task(task_id, &agent_id, &session_id).unwrap();
        if let Some(resource_key) = lease_resource {
            kernel
                .acquire_lease(
                    task_id,
                    &agent_id,
                    &session_id,
                    resource_key,
                    "write",
                    Some(600),
                    None,
                )
                .unwrap();
        }
        let identity = DiffForgeWriteGuardIdentity::new(
            Some(agent_id),
            Some(session_id),
            Some(kernel.paths.db_path.clone()),
        );
        (identity, worktree_path)
    }

    fn terminal_test_plain_project(name: &str) -> PathBuf {
        let repo = terminal_test_directory(name);
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("package.json"), "{}\n").unwrap();
        repo
    }

    fn terminal_test_coordination(name: &str) -> TerminalCoordinationSession {
        let repo = terminal_test_repo(name);
        let kernel = crate::coordination::CoordinationKernel::init(&repo, None).unwrap();
        let agent = kernel.create_or_get_agent("Codex", "codex", None).unwrap();
        let agent_id = agent["id"].as_str().unwrap().to_string();
        let session = kernel
            .create_session(
                &agent_id,
                None,
                Some("workspace-terminal-test-0-codex"),
                false,
                None,
                None,
            )
            .unwrap();
        let session_id = session["id"].as_str().unwrap().to_string();
        let db_path = kernel.paths.db_path.display().to_string();
        drop(kernel);

        TerminalCoordinationSession {
            repo_path: repo.display().to_string(),
            db_path,
            mcp_command: "coordination_mcp".to_string(),
            agent_id,
            agent_kind: "codex".to_string(),
            session_id,
            terminal_launch_epoch: None,
            env_vars: Vec::new(),
        }
    }

    fn terminal_test_isolated_context(
        repo: &Path,
        slot_key: &str,
        worktree_path: &Path,
        write_root: &Path,
    ) -> crate::coordination::models::TerminalCoordinationContext {
        crate::coordination::models::TerminalCoordinationContext {
            agent_id: "agent-1".to_string(),
            agent_kind: "codex".to_string(),
            agent_slot_id: Some(format!("slot-{slot_key}")),
            slot_key: Some(slot_key.to_string()),
            session_id: "session-1".to_string(),
            terminal_launch_epoch: None,
            task_id: None,
            worktree_id: Some(format!("worktree-{slot_key}")),
            worktree_path: Some(worktree_path.display().to_string()),
            write_root: write_root.display().to_string(),
            enforcement_mode: "worktree_required".to_string(),
            db_path: repo
                .join(".agents")
                .join("coordination.sqlite")
                .display()
                .to_string(),
            repo_path: repo.display().to_string(),
            mcp_config_path: String::new(),
            codex_mcp_config_path: String::new(),
            codex_home_path: None,
            codex_profile: None,
            codex_bypass_hook_trust: false,
            claude_mcp_config_path: String::new(),
            mcp_command: String::new(),
            workspace_id: Some("workspace-1".to_string()),
            workspace_mcp_allowed_tools: Vec::new(),
            objective_key: "workspace-1".to_string(),
            context_run_id: None,
            context_role: None,
            warnings: Vec::new(),
        }
    }

    #[test]
    fn terminal_session_mode_defaults_aliases_and_authority_are_stable() {
        assert_eq!(
            TerminalSessionMode::from_request(None, TerminalSessionMode::Free).unwrap(),
            TerminalSessionMode::Free
        );
        assert_eq!(
            TerminalSessionMode::from_request(Some("patch-mode"), TerminalSessionMode::Free)
                .unwrap(),
            TerminalSessionMode::ManagedPatch
        );
        assert_eq!(
            TerminalSessionMode::from_request(Some("worktree"), TerminalSessionMode::Free).unwrap(),
            TerminalSessionMode::ManagedPatch
        );
        assert_eq!(
            TerminalSessionMode::from_request(Some("general-worker"), TerminalSessionMode::Free)
                .unwrap(),
            TerminalSessionMode::General
        );
        assert_eq!(
            TerminalSessionMode::from_request(Some("task_scoped"), TerminalSessionMode::Free)
                .unwrap(),
            TerminalSessionMode::General
        );
        assert_eq!(
            TerminalSessionMode::from_request(Some("direct"), TerminalSessionMode::ManagedPatch)
                .unwrap(),
            TerminalSessionMode::DirectEdit
        );
        assert_eq!(
            TerminalSessionMode::from_request(
                Some("free-terminal"),
                TerminalSessionMode::ManagedPatch
            )
            .unwrap(),
            TerminalSessionMode::Free
        );
        assert_eq!(
            TerminalSessionMode::from_request(Some("ssh"), TerminalSessionMode::ManagedPatch)
                .unwrap(),
            TerminalSessionMode::RemoteOps
        );

        let invalid = TerminalSessionMode::from_request(
            Some("root-sync-everything"),
            TerminalSessionMode::Free,
        )
        .unwrap_err();
        assert!(invalid.contains("managed_patch"));

        assert_eq!(TerminalSessionMode::General.file_authority(), "task_scoped");
        assert_eq!(
            TerminalSessionMode::ManagedPatch.file_authority(),
            "git_worktree_patch"
        );
        assert_eq!(
            TerminalSessionMode::DirectEdit.file_authority(),
            "bounded_direct_edit"
        );
        assert_eq!(TerminalSessionMode::Activity.file_authority(), "none");
        assert_eq!(
            TerminalSessionMode::Free.file_authority(),
            "external_unmanaged"
        );
        assert_eq!(
            TerminalSessionMode::RemoteOps.file_authority(),
            "remote_unmanaged"
        );
    }

    #[test]
    fn codex_coordination_context_uses_private_home_and_profile_env() {
        let repo = terminal_test_repo("codex_profile_env");
        let worktree = repo.join(".agents").join("worktrees").join("1");
        fs::create_dir_all(&worktree).unwrap();
        let mut context = terminal_test_isolated_context(&repo, "1", &worktree, &worktree);
        context.codex_profile = Some("diffforge-test-profile".to_string());
        context.codex_home_path = Some("/tmp/diffforge-managed-codex-home".to_string());

        let env_vars = context.env_vars();

        assert!(env_vars.iter().any(|(key, value)| {
            key == "DIFFFORGE_CODEX_PROFILE" && value == "diffforge-test-profile"
        }));
        assert!(env_vars.iter().any(|(key, value)| {
            key == "CODEX_HOME" && value == "/tmp/diffforge-managed-codex-home"
        }));
        assert!(env_vars.iter().any(|(key, value)| {
            key == "DIFFFORGE_CODEX_HOME" && value == "/tmp/diffforge-managed-codex-home"
        }));
    }

    #[test]
    fn codex_home_candidates_include_managed_private_coordination_home() {
        let repo = terminal_test_repo("codex_managed_home_candidates");
        let worktree = repo.join(".agents").join("worktrees").join("1");
        fs::create_dir_all(&worktree).unwrap();
        let managed_home = coordination::db::coordination_repo_state_root(&repo)
            .join("codex-home")
            .join("coordinated")
            .join("1");
        fs::create_dir_all(&managed_home).unwrap();

        let candidates = codex_home_candidates(&worktree.display().to_string());

        assert!(candidates.iter().any(|path| path == &managed_home));
    }

    #[test]
    fn non_free_modes_prepare_coordination_but_only_managed_patch_refreshes_context_pack() {
        let modes = [
            TerminalSessionMode::General,
            TerminalSessionMode::ManagedPatch,
            TerminalSessionMode::DirectEdit,
            TerminalSessionMode::Activity,
            TerminalSessionMode::Free,
            TerminalSessionMode::RemoteOps,
        ];

        for mode in modes {
            assert_eq!(
                mode.should_prepare_coordination(),
                mode != TerminalSessionMode::Free,
                "{mode:?} coordination gate changed"
            );
            assert_eq!(
                mode.requires_managed_patch_worktree(),
                mode == TerminalSessionMode::ManagedPatch,
                "{mode:?} worktree gate changed"
            );
            assert_eq!(
                mode.should_request_cloud_context_pack(),
                mode == TerminalSessionMode::ManagedPatch,
                "{mode:?} cloud context-pack gate changed"
            );
            assert_eq!(
                mode.completion_mode(),
                if mode == TerminalSessionMode::ManagedPatch {
                    "submit_patch"
                } else {
                    "complete_task"
                },
                "{mode:?} completion mode changed"
            );
        }
    }

    #[test]
    fn general_terminal_launch_target_uses_worktree_for_git_root() {
        let repo = terminal_test_repo("general_git_launch_target");

        let target = terminal_coordination_launch_target(
            &repo,
            None,
            None,
            false,
            TerminalSessionMode::General,
        )
        .unwrap();

        assert_eq!(target.enforcement_mode, "worktree_required");
        assert!(!target.requires_git_bootstrap);
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&repo.canonicalize().unwrap())
        );
    }

    #[test]
    fn general_terminal_launch_target_keeps_non_git_project_direct() {
        let project = terminal_test_plain_project("general_non_git_launch_target");

        let target = terminal_coordination_launch_target(
            &project,
            None,
            None,
            false,
            TerminalSessionMode::General,
        )
        .unwrap();

        assert_eq!(target.enforcement_mode, "bounded_direct_edit");
        assert!(!target.requires_git_bootstrap);
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&project.canonicalize().unwrap())
        );
    }

    #[test]
    fn general_terminal_launch_target_bootstraps_only_empty_selected_workspace() {
        let empty_workspace = terminal_test_directory("general_empty_selected_launch_target");

        let target = terminal_coordination_launch_target(
            &empty_workspace,
            None,
            None,
            true,
            TerminalSessionMode::General,
        )
        .unwrap();

        assert_eq!(target.enforcement_mode, "worktree_required");
        assert!(target.requires_git_bootstrap);
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&empty_workspace.canonicalize().unwrap())
        );
        assert!(!empty_workspace.join(".git").exists());
    }

    #[test]
    fn general_terminal_launch_target_bootstraps_reopened_metadata_only_workspace() {
        let workspace = terminal_test_directory("general_reopened_empty_launch_target");
        fs::create_dir_all(workspace.join(".agents").join("cloud-mcp")).unwrap();
        fs::write(workspace.join(".gitignore"), ".agents/\n/logs/\n").unwrap();
        fs::create_dir_all(workspace.join("logs")).unwrap();
        fs::write(
            workspace.join("logs").join("coordination-events.jsonl"),
            "{}\n",
        )
        .unwrap();

        let target = terminal_coordination_launch_target(
            &workspace,
            None,
            None,
            false,
            TerminalSessionMode::General,
        )
        .unwrap();

        assert_eq!(target.enforcement_mode, "worktree_required");
        assert!(target.requires_git_bootstrap);
        assert!(target.allows_git_init);
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&workspace.canonicalize().unwrap())
        );
        assert!(!workspace.join(".git").exists());
    }

    #[test]
    fn general_terminal_launch_target_does_not_bootstrap_stale_empty_flag_with_user_files() {
        let project = terminal_test_plain_project("general_stale_empty_flag_user_files");

        let target = terminal_coordination_launch_target(
            &project,
            None,
            None,
            true,
            TerminalSessionMode::General,
        )
        .unwrap();

        assert_eq!(target.enforcement_mode, "bounded_direct_edit");
        assert!(!target.requires_git_bootstrap);
        assert!(!target.allows_git_init);
        assert!(!project.join(".git").exists());
    }

    #[test]
    fn general_terminal_launch_target_does_not_bootstrap_requested_project_root() {
        let workspace = terminal_test_directory("general_empty_parent_requested_project");
        let project = workspace.join("app");
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("package.json"), "{}\n").unwrap();

        let target = terminal_coordination_launch_target(
            &workspace,
            Some(project.to_str().unwrap()),
            None,
            true,
            TerminalSessionMode::General,
        )
        .unwrap();

        assert_eq!(target.enforcement_mode, "bounded_direct_edit");
        assert!(!target.requires_git_bootstrap);
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&project.canonicalize().unwrap())
        );
        assert!(!project.join(".git").exists());
    }

    #[test]
    fn managed_patch_launch_target_rejects_non_git_non_empty_workspace() {
        let project = terminal_test_plain_project("managed_patch_non_git_non_empty");

        let error = terminal_coordination_launch_target(
            &project,
            None,
            None,
            false,
            TerminalSessionMode::ManagedPatch,
        )
        .unwrap_err();

        assert!(error.contains("requires an existing Git repo"));
        assert!(error.contains("empty"));
        assert!(!project.join(".git").exists());
    }

    #[test]
    fn general_terminal_launch_target_promotes_git_subdirectory_to_top_level() {
        let repo = terminal_test_repo("general_git_subdir_launch_target");
        let subdir = repo.join("src").join("client");
        fs::create_dir_all(&subdir).unwrap();

        let target = terminal_coordination_launch_target(
            &subdir,
            None,
            None,
            false,
            TerminalSessionMode::General,
        )
        .unwrap();

        assert_eq!(target.enforcement_mode, "worktree_required");
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&repo.canonicalize().unwrap())
        );
    }

    #[test]
    fn general_terminal_launch_target_makes_ambiguous_container_activity_only_until_project_selected()
     {
        let container = terminal_test_directory("general_multi_repo_container");
        let frontend = container.join("frontend");
        let backend = container.join("backend");
        fs::create_dir_all(&frontend).unwrap();
        fs::create_dir_all(&backend).unwrap();
        let status = Command::new("git")
            .arg("init")
            .arg(&frontend)
            .status()
            .unwrap();
        assert!(status.success());
        let status = Command::new("git")
            .arg("init")
            .arg(&backend)
            .status()
            .unwrap();
        assert!(status.success());

        let container_target = terminal_coordination_launch_target(
            &container,
            None,
            None,
            false,
            TerminalSessionMode::General,
        )
        .unwrap();
        assert_eq!(container_target.enforcement_mode, "activity_only");
        assert!(!container_target.requires_git_bootstrap);
        assert_eq!(
            normalized_path_key(&container_target.root.canonicalize().unwrap()),
            normalized_path_key(&container.canonicalize().unwrap())
        );

        let selected = terminal_coordination_launch_target(
            &container,
            None,
            Some("frontend"),
            false,
            TerminalSessionMode::General,
        )
        .unwrap();
        assert_eq!(selected.enforcement_mode, "worktree_required");
        assert_eq!(
            normalized_path_key(&selected.root.canonicalize().unwrap()),
            normalized_path_key(&frontend.canonicalize().unwrap())
        );
    }

    #[test]
    fn terminal_workspace_topology_cache_reuses_fresh_burst_snapshot_then_rechecks() {
        let container = terminal_test_directory("topology_cache_burst");
        let frontend = container.join("frontend");
        fs::create_dir_all(&frontend).unwrap();
        let status = Command::new("git")
            .arg("init")
            .arg(&frontend)
            .status()
            .unwrap();
        assert!(status.success());

        let cache = Arc::new(RwLock::new(HashMap::new()));
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let first = runtime.block_on(terminal_workspace_topology_mounts_for_launch_from_cache(
            &cache,
            &container,
            1_000,
            Some(1_000),
        ));
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].workspace_relative_path, "frontend");

        let backend = container.join("backend");
        fs::create_dir_all(&backend).unwrap();
        let status = Command::new("git")
            .arg("init")
            .arg(&backend)
            .status()
            .unwrap();
        assert!(status.success());

        let burst = runtime.block_on(terminal_workspace_topology_mounts_for_launch_from_cache(
            &cache,
            &container,
            1_000 + TERMINAL_WORKSPACE_TOPOLOGY_CACHE_FRESH_MS - 1,
            Some(1_000 + TERMINAL_WORKSPACE_TOPOLOGY_CACHE_FRESH_MS - 1),
        ));
        assert_eq!(burst.len(), 1);
        assert_eq!(burst[0].workspace_relative_path, "frontend");

        let later = runtime.block_on(terminal_workspace_topology_mounts_for_launch_from_cache(
            &cache,
            &container,
            1_000 + TERMINAL_WORKSPACE_TOPOLOGY_CACHE_FRESH_MS + 1,
            Some(1_000 + TERMINAL_WORKSPACE_TOPOLOGY_CACHE_FRESH_MS + 1),
        ));
        let mount_paths = later
            .iter()
            .map(|mount| mount.workspace_relative_path.as_str())
            .collect::<HashSet<_>>();
        assert_eq!(mount_paths.len(), 2);
        assert!(mount_paths.contains("frontend"));
        assert!(mount_paths.contains("backend"));
    }

    #[test]
    fn general_terminal_launch_target_auto_selects_single_git_mount() {
        let container = terminal_test_directory("general_single_repo_container");
        let frontend = container.join("frontend");
        fs::create_dir_all(&frontend).unwrap();
        let status = Command::new("git")
            .arg("init")
            .arg(&frontend)
            .status()
            .unwrap();
        assert!(status.success());

        let target = terminal_coordination_launch_target(
            &container,
            None,
            None,
            false,
            TerminalSessionMode::General,
        )
        .unwrap();

        assert_eq!(target.enforcement_mode, "worktree_required");
        assert!(!target.requires_git_bootstrap);
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&frontend.canonicalize().unwrap())
        );
    }

    #[test]
    fn general_terminal_launch_target_finds_deep_selected_git_mount() {
        let container = terminal_test_directory("general_deep_repo_container");
        let deep_repo = container
            .join("clients")
            .join("acme")
            .join("services")
            .join("api");
        fs::create_dir_all(&deep_repo).unwrap();
        let status = Command::new("git")
            .arg("init")
            .arg(&deep_repo)
            .status()
            .unwrap();
        assert!(status.success());

        let selected = terminal_coordination_launch_target(
            &container,
            None,
            Some("clients/acme/services/api"),
            false,
            TerminalSessionMode::General,
        )
        .unwrap();

        assert_eq!(selected.enforcement_mode, "worktree_required");
        assert!(!selected.requires_git_bootstrap);
        assert_eq!(
            normalized_path_key(&selected.root.canonicalize().unwrap()),
            normalized_path_key(&deep_repo.canonicalize().unwrap())
        );
    }

    #[test]
    fn direct_edit_launch_target_uses_worktree_policy_for_git_root() {
        let repo = terminal_test_repo("direct_edit_git_launch_target");

        let target = terminal_coordination_launch_target(
            &repo,
            None,
            None,
            false,
            TerminalSessionMode::DirectEdit,
        )
        .unwrap();

        assert_eq!(target.enforcement_mode, "worktree_required");
        assert!(target.requires_git_bootstrap);
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&repo.canonicalize().unwrap())
        );
    }

    #[test]
    fn worktree_required_context_process_cwd_is_visible_project_root() {
        let repo = terminal_test_directory("isolated_context_process_cwd");
        let worktree = repo.join(".agents").join("worktrees").join("1");
        fs::create_dir_all(&worktree).unwrap();
        let context = terminal_test_isolated_context(&repo, "1", &worktree, &worktree);
        let process_cwd = terminal_process_working_directory_for_context(&context, &repo);

        assert_eq!(
            normalized_path_key(&process_cwd),
            normalized_path_key(&repo)
        );
    }

    #[test]
    fn worktree_required_context_advertises_visible_root_with_explicit_worktree_writes() {
        let repo = terminal_test_directory("isolated_context_visible_root_env");
        let worktree = repo.join(".agents").join("worktrees").join("1");
        fs::create_dir_all(&worktree).unwrap();
        let context = terminal_test_isolated_context(&repo, "1", &worktree, &worktree);
        let env = context.env_vars();

        assert!(env.contains(&(
            "COORDINATION_SHELL_CWD_POLICY".to_string(),
            "visible_project_root_with_explicit_worktree_writes".to_string()
        )));
        assert!(env.contains(&(
            "COORDINATION_SHELL_CWD_IS_PROJECT_ROOT".to_string(),
            "1".to_string()
        )));
        assert!(env.contains(&(
            "COORDINATION_DIRECT_PROJECT_ROOT_WRITES_POLICY".to_string(),
            "deny_root_except_architecture_graph_sources_use_agent_branch_root".to_string()
        )));
        assert!(env.contains(&(
            "COORDINATION_VISIBLE_ROOT".to_string(),
            repo.display().to_string()
        )));
        assert!(env.contains(&(
            "COORDINATION_AGENT_BRANCH_ROOT".to_string(),
            worktree.display().to_string()
        )));
    }

    #[test]
    fn worktree_required_context_promotes_live_session_mode_to_managed_patch() {
        let repo = terminal_test_directory("isolated_context_effective_mode");
        let worktree = repo.join(".agents").join("worktrees").join("1");
        fs::create_dir_all(&worktree).unwrap();
        let context = terminal_test_isolated_context(&repo, "1", &worktree, &worktree);

        assert_eq!(
            terminal_session_mode_from_context(&context, TerminalSessionMode::General),
            TerminalSessionMode::ManagedPatch
        );
    }

    #[test]
    fn isolated_worktree_context_validation_rejects_repo_root_write_root() {
        let repo = terminal_test_directory("isolated_context_repo_root");
        fs::create_dir_all(repo.join(".agents").join("worktrees")).unwrap();
        let context = terminal_test_isolated_context(&repo, "1", &repo, &repo);

        let error = validate_terminal_isolated_worktree_context(&context, "Codex").unwrap_err();

        assert!(error.contains("repository root"));
    }

    #[test]
    fn isolated_worktree_context_validation_accepts_slot_worktree() {
        let repo = terminal_test_directory("isolated_context_worktree");
        let worktree = repo.join(".agents").join("worktrees").join("1");
        fs::create_dir_all(&worktree).unwrap();
        let context = terminal_test_isolated_context(&repo, "1", &worktree, &worktree);

        validate_terminal_isolated_worktree_context(&context, "Codex").unwrap();
    }

    #[test]
    fn isolated_worktree_context_validation_rejects_cross_slot_worktree() {
        let repo = terminal_test_directory("isolated_context_cross_slot");
        let other_slot_worktree = repo.join(".agents").join("worktrees").join("2");
        fs::create_dir_all(&other_slot_worktree).unwrap();
        let context =
            terminal_test_isolated_context(&repo, "1", &other_slot_worktree, &other_slot_worktree);

        let error = validate_terminal_isolated_worktree_context(&context, "Codex").unwrap_err();

        assert!(error.contains("another slot"));
    }

    #[test]
    fn isolated_worktree_context_validation_rejects_mismatched_assigned_worktree() {
        let repo = terminal_test_directory("isolated_context_mismatched_worktree");
        let assigned = repo.join(".agents").join("worktrees").join("1");
        let write_root = repo.join(".agents").join("worktrees").join("1-shadow");
        fs::create_dir_all(&assigned).unwrap();
        fs::create_dir_all(&write_root).unwrap();
        let context = terminal_test_isolated_context(&repo, "1", &assigned, &write_root);

        let error = validate_terminal_isolated_worktree_context(&context, "Codex").unwrap_err();

        assert!(error.contains("assigned worktree path"));
    }

    #[test]
    fn shift_enter_sequence_adds_line_break_without_prompt_submission() {
        let mut gate = TerminalInputGate::default();

        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(&mut gate, "first line"),
            None
        );
        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(&mut gate, TERMINAL_SHIFT_ENTER_SEQUENCE),
            None
        );
        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(&mut gate, "second line\r"),
            Some("first line\nsecond line".to_string())
        );
    }

    #[test]
    fn enhanced_enter_sequence_submits_prompt() {
        let mut gate = TerminalInputGate::default();

        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(
                &mut gate,
                &format!("send from overlay{TERMINAL_ENTER_SEQUENCE}"),
            ),
            Some("send from overlay".to_string())
        );
    }

    #[test]
    fn split_composer_sync_then_enter_submits_prompt() {
        let mut gate = TerminalInputGate::default();

        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(&mut gate, "\x15hey there"),
            None
        );
        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(&mut gate, "\r"),
            Some("hey there".to_string())
        );
    }

    #[test]
    fn prompt_submitted_authority_requires_observed_matching_submit() {
        assert!(terminal_prompt_submitted_source_is_authoritative(
            "observed_input_gate",
            true,
            Some("what else is there"),
        ));
        assert!(terminal_prompt_submitted_source_is_authoritative(
            "activity_hook_user_prompt_submit",
            true,
            None,
        ));
        assert!(terminal_prompt_submitted_source_is_authoritative(
            "parked_resume_backend_submit",
            true,
            None,
        ));
        assert!(terminal_prompt_submitted_source_is_authoritative(
            "crash_todo_resume_backend_submit",
            true,
            None,
        ));
        assert!(!terminal_prompt_submitted_source_is_authoritative(
            "observed_input_gate",
            false,
            Some("different prompt"),
        ));
        assert!(!terminal_prompt_submitted_source_is_authoritative(
            "observed_input_gate",
            true,
            None,
        ));
        assert!(!terminal_prompt_submitted_source_is_authoritative(
            "prompt_event_text_unobserved",
            false,
            None,
        ));
        assert!(!terminal_prompt_submitted_source_is_authoritative(
            "prompt_event_text_unobserved",
            true,
            Some("what else is there"),
        ));
    }

    #[test]
    fn cli_activity_hooks_map_lifecycle_tool_and_subagent_events() {
        assert_eq!(
            terminal_activity_hook_lifecycle_kind("UserPromptSubmit"),
            Some((
                "provider-turn-started",
                "thinking",
                "active",
                "running",
                false
            ))
        );
        assert_eq!(
            terminal_activity_hook_lifecycle_kind("Stop"),
            Some((
                "provider-turn-completed",
                "idle",
                "active",
                "completed",
                true
            ))
        );
        assert_eq!(
            terminal_activity_hook_lifecycle_kind("Interrupt"),
            Some((
                "provider-turn-interrupted",
                "idle",
                "active",
                "interrupted",
                true
            ))
        );
        assert_eq!(terminal_activity_hook_lifecycle_kind("SubagentStop"), None);
        assert_eq!(
            terminal_activity_hook_activity_kind("PreToolUse", &json!({})),
            Some((
                "provider-tool-started",
                "tool_running",
                "active",
                "tool_running",
                false,
                "cli_hook_tool_start"
            ))
        );
        assert_eq!(
            terminal_activity_hook_activity_kind("PreToolUse", &json!({ "toolName": "Bash" })),
            Some((
                "provider-tool-started",
                "shell",
                "active",
                "tool_running",
                false,
                "cli_hook_tool_start"
            ))
        );
        assert_eq!(
            terminal_activity_hook_activity_kind(
                "PreToolUse",
                &json!({ "toolName": "apply_patch" })
            ),
            Some((
                "provider-tool-started",
                "editing",
                "active",
                "tool_running",
                false,
                "cli_hook_tool_start"
            ))
        );
        assert_eq!(
            terminal_activity_hook_activity_kind(
                "PreToolUse",
                &json!({ "toolName": "mcp__github__get_issue" })
            ),
            Some((
                "provider-tool-started",
                "mcp",
                "active",
                "tool_running",
                false,
                "cli_hook_tool_start"
            ))
        );
        assert_eq!(
            terminal_activity_hook_activity_kind("PostToolUse", &json!({})),
            Some((
                "provider-tool-completed",
                "thinking",
                "active",
                "tool_completed",
                false,
                "cli_hook_tool_complete"
            ))
        );
        assert_eq!(
            terminal_activity_hook_activity_kind("SubagentStart", &json!({})),
            Some((
                "provider-subagent-started",
                "subagent_running",
                "active",
                "subagent_running",
                false,
                "cli_hook_subagent_start"
            ))
        );
        assert_eq!(
            terminal_activity_hook_activity_kind("SubagentStop", &json!({})),
            Some((
                "provider-subagent-completed",
                "thinking",
                "active",
                "subagent_completed",
                false,
                "cli_hook_subagent_complete"
            ))
        );
        assert!(terminal_activity_hook_non_lifecycle_is_expected(
            "SubagentStop"
        ));
        assert!(terminal_activity_hook_non_lifecycle_is_expected(
            "SubagentStart"
        ));
        assert!(terminal_activity_hook_non_lifecycle_is_expected(
            "PreToolUse"
        ));
        assert!(terminal_activity_hook_non_lifecycle_is_expected(
            "PostToolUse"
        ));
        assert!(!terminal_activity_hook_non_lifecycle_is_expected("Stop"));
    }

    #[test]
    fn cli_activity_hook_manual_prompt_requires_explicit_pending_evidence() {
        let prompt = terminal_activity_hook_manual_prompt(
            "PreToolUse",
            &json!({
                "hookEventName": "PreToolUse",
                "manualApprovalRequired": true,
                "toolUseId": "tool-1",
                "promptingUserKind": "approval",
                "description": "Approve this edit?"
            }),
        )
        .unwrap();
        assert_eq!(prompt.kind, "approval");
        assert_eq!(prompt.text.as_deref(), Some("Approve this edit?"));

        assert!(
            terminal_activity_hook_manual_prompt(
                "PreToolUse",
                &json!({
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow",
                    "toolUseId": "tool-auto",
                    "promptingUserKind": "approval"
                }),
            )
            .is_none()
        );
        assert!(
            terminal_activity_hook_manual_prompt(
                "PreToolUse",
                &json!({
                    "hookEventName": "PreToolUse",
                    "toolUseId": "tool-observed"
                }),
            )
            .is_none()
        );
    }

    #[test]
    fn input_gate_tracks_cursor_edits_before_submit() {
        let mut gate = TerminalInputGate::default();

        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(&mut gate, "hello\u{1b}[D!\r"),
            Some("hell!o".to_string())
        );

        let mut gate = TerminalInputGate::default();
        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(&mut gate, "hello\u{1b}[3DXX\r"),
            Some("heXXllo".to_string())
        );
    }

    #[test]
    fn input_gate_tracks_delete_at_cursor_and_line_anchors() {
        let mut gate = TerminalInputGate::default();

        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(&mut gate, "hello\u{1b}[D\u{1b}[3~\r"),
            Some("hell".to_string())
        );

        let mut gate = TerminalInputGate::default();
        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(&mut gate, "ice\u{1}nice \u{5}!\r"),
            Some("nice ice!".to_string())
        );
    }

    #[test]
    fn input_gate_tracks_word_cursor_edits_before_submit() {
        let mut gate = TerminalInputGate::default();

        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(
                &mut gate,
                "alpha beta gamma\u{1b}[1;5D!\r"
            ),
            Some("alpha beta !gamma".to_string())
        );

        let mut gate = TerminalInputGate::default();
        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(&mut gate, "alpha beta gamma\u{1b}b!\r"),
            Some("alpha beta !gamma".to_string())
        );
    }

    #[test]
    fn enhanced_enter_sequence_is_normalized_before_pty_write() {
        assert_eq!(
            normalize_terminal_enter_sequences_for_pty(format!(
                "send from overlay{TERMINAL_ENTER_SEQUENCE}"
            )),
            "send from overlay\r"
        );
        assert_eq!(
            normalize_terminal_enter_sequences_for_pty(format!(
                "send from overlay{TERMINAL_ENTER_SEQUENCE_MOD1}"
            )),
            "send from overlay\r"
        );
        assert_eq!(
            normalize_terminal_enter_sequences_for_pty(format!(
                "first line{TERMINAL_SHIFT_ENTER_SEQUENCE}second line"
            )),
            format!("first line{TERMINAL_SHIFT_ENTER_SEQUENCE}second line")
        );
    }

    #[test]
    fn bare_osc_color_reply_is_not_submitted_as_prompt() {
        let mut gate = TerminalInputGate::default();

        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(
                &mut gate,
                "]10;rgb:e8e8/eeee/f8f8\\]11;rgb:0202/0303/0404\\\r",
            ),
            None
        );
        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(&mut gate, "idk\r"),
            Some("idk".to_string())
        );
    }

    #[test]
    fn bare_osc_color_reply_is_stripped_around_real_prompt_text() {
        let mut gate = TerminalInputGate::default();

        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(
                &mut gate,
                "]10;rgb:e8e8/eeee/f8f8\\idk\r",
            ),
            Some("idk".to_string())
        );
    }

    #[test]
    fn submitted_prompt_observation_does_not_create_local_task() {
        let coordination = terminal_test_coordination("prompt_observation_no_task");
        let mut gate = TerminalInputGate::default();

        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(
                &mut gate,
                "make an index.html entry page for icecream wishlist\r",
            ),
            Some("make an index.html entry page for icecream wishlist".to_string())
        );

        let inspect = crate::coordination::CoordinationKernel::open(
            PathBuf::from(&coordination.repo_path),
            Some(PathBuf::from(&coordination.db_path)),
        )
        .unwrap();
        let tasks = inspect.query_json("SELECT id FROM tasks", &[]).unwrap();
        assert!(tasks.is_empty());
    }

    #[test]
    fn parked_resume_prompt_includes_dependency_context() {
        let snapshot = TerminalParkingSnapshot {
            task_id: "task-resume".to_string(),
            title: "Darken pricing page".to_string(),
            prompt: "Nice redesign the pricing to be more dark tones.".to_string(),
            ready: true,
            terminal: false,
            waiting_on: Vec::new(),
            parked_resource_intents: vec![json!({
                "resource_key": "file:pricing.html",
                "intent_summary": "Darken the pricing page visual treatment",
                "depends_on_task_id": "task-pricing-create",
                "depends_on_title": "Create ice cream pricing page",
                "depends_on_status": "done",
                "depends_on_agent_id": "90385961-4fb5-4ec2-9b63-8155a7e0e56b",
                "depends_on_lease_status": "released",
                "depends_on_lease_reason": "Create standalone pricing page for ice cream wishlist site",
            })],
        };

        let prompt =
            terminal_rich_parked_resume_prompt(&snapshot, &snapshot.title, &snapshot.prompt, None);

        assert!(prompt.contains("Diff Forge parked task is ready to resume."));
        assert!(prompt.contains("Original task:"));
        assert!(prompt.contains("Why you were parked:"));
        assert!(prompt.contains("pricing.html"));
        assert!(prompt.contains("Create standalone pricing page for ice cream wishlist site"));
        assert!(prompt.contains("Dependency now resolved:"));
        assert!(prompt.contains("Re-acquire the needed lease"));
        assert!(!prompt.ends_with('\r'));
    }

    #[test]
    fn coordinated_codex_launch_auto_approves_edits_in_worktree() {
        let mut coordination = terminal_test_coordination("codex_auto_approval_args");
        coordination.env_vars.push((
            "COORDINATION_AGENT_BRANCH_ROOT".to_string(),
            "/tmp/diffforge-agent-worktree".to_string(),
        ));
        coordination.env_vars.push((
            "DIFFFORGE_CODEX_PROFILE".to_string(),
            "diffforge-test-profile".to_string(),
        ));
        coordination.env_vars.push((
            "COORDINATION_WORKSPACE_ID".to_string(),
            "workspace-1".to_string(),
        ));
        coordination.env_vars.push((
            "COORDINATION_OBJECTIVE_KEY".to_string(),
            "workspace-1".to_string(),
        ));
        coordination
            .env_vars
            .push(("COORDINATION_SLOT_KEY".to_string(), "1".to_string()));
        coordination.env_vars.push((
            "DIFFFORGE_WORKSPACE_MCP_ALLOWED_TOOLS".to_string(),
            "appwrite-api__appwrite_search_tools".to_string(),
        ));

        let args = terminal_args_with_codex_mcp_identity(
            "codex",
            &["--model".to_string(), "gpt-5.2".to_string()],
            Some(&coordination),
            "pane-auto",
            42,
        );

        assert!(
            args.windows(2)
                .any(|pair| pair == ["--ask-for-approval", "never"])
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--profile", "diffforge-test-profile"])
        );
        assert!(args.windows(2).any(|pair| pair == ["--disable", "apps"]));
        assert!(args.windows(2).any(|pair| pair == ["--enable", "hooks"]));
        assert!(
            !args
                .iter()
                .any(|arg| arg == "--dangerously-bypass-hook-trust")
        );
        assert!(!args.iter().any(|arg| arg == "--sandbox"));
        assert!(!args.iter().any(|arg| arg == "--cd"));
        assert!(
            args.iter()
                .any(|arg| { arg.starts_with("mcp_servers.coordination-kernel.args=") })
        );
        assert!(
            args.iter()
                .any(|arg| arg.contains("--coordination-mcp-proxy"))
        );
        assert!(!args.iter().any(|arg| arg.contains("--coordination-mcp''")));
        assert!(
            args.iter()
                .any(|arg| { arg.starts_with("mcp_servers.coordination-kernel.command=") })
        );
        assert!(args.iter().any(|arg| {
            arg.starts_with("mcp_servers.coordination-kernel.tools.start_task.approval_mode=")
        }));
        assert!(
            args.iter()
                .any(|arg| { arg.starts_with("mcp_servers.workspace-mcp-gateway.command=") })
        );
        assert!(
            args.iter()
                .any(|arg| { arg.starts_with("mcp_servers.workspace-mcp-gateway.args=") })
        );
        assert!(
            args.iter()
                .any(|arg| { arg.contains("--workspace-mcp-gateway") })
        );
        assert!(args.iter().any(|arg| {
            arg.starts_with(
                "mcp_servers.workspace-mcp-gateway.tools.workspace_mcp__sync_manifest.approval_mode="
            )
        }));
        assert!(args.iter().any(|arg| {
            arg.starts_with(
                "mcp_servers.workspace-mcp-gateway.tools.appwrite-api__appwrite_search_tools.approval_mode="
            )
        }));
        assert!(
            !args
                .iter()
                .any(|arg| { arg.starts_with("mcp_servers.cloud-diffforge.args=") })
        );
        assert!(
            !args
                .iter()
                .any(|arg| arg.starts_with("mcp_servers.codex_apps."))
        );
        assert_eq!(
            args.iter()
                .filter(|arg| arg.as_str() == "--no-alt-screen")
                .count(),
            1
        );
    }

    #[test]
    fn coordinated_codex_secondary_untrusted_hook_launch_uses_bypass_flag() {
        let mut coordination = terminal_test_coordination("codex_hook_bypass_args");
        coordination.env_vars.push((
            "COORDINATION_AGENT_BRANCH_ROOT".to_string(),
            "/tmp/diffforge-agent-worktree".to_string(),
        ));
        coordination.env_vars.push((
            "DIFFFORGE_CODEX_PROFILE".to_string(),
            "diffforge-test-profile".to_string(),
        ));
        coordination.env_vars.push((
            "DIFFFORGE_CODEX_BYPASS_HOOK_TRUST".to_string(),
            "1".to_string(),
        ));

        let args = terminal_args_with_codex_mcp_identity(
            "codex",
            &[],
            Some(&coordination),
            "pane-auto",
            42,
        );

        assert!(
            args.iter()
                .any(|arg| arg == "--dangerously-bypass-hook-trust")
        );
    }

    #[test]
    fn coordinated_codex_activity_hook_profile_refresh_scopes_commands() {
        let mut coordination = terminal_test_coordination("codex_hook_profile_scope");
        let home = terminal_test_directory("codex_hook_profile_home");
        let profile = "diffforge-test-profile";
        let hooks_path = home.join(format!("{profile}.hooks.json"));
        let profile_path = home.join(format!("{profile}.config.toml"));
        fs::create_dir_all(&home).unwrap();
        fs::write(
            &profile_path,
            "default_permissions = \"diffforge-coordinated\"\n",
        )
        .unwrap();
        fs::write(
            &hooks_path,
            serde_json::to_string_pretty(&json!({
                "hooks": {
                    "Stop": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "'coordination_mcp' --diff-forge-activity-hook --provider 'codex'",
                                    "timeout": 5
                                }
                            ]
                        }
                    ],
                    "PreToolUse": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "'coordination_mcp' --diff-forge-write-guard --provider 'codex'",
                                    "timeout": 30
                                }
                            ],
                            "matcher": "functions.apply_patch"
                        }
                    ],
                    "PostToolUse": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "'coordination_mcp' --diff-forge-activity-hook --provider 'codex'",
                                    "timeout": 5
                                }
                            ],
                            "matcher": "Bash|Shell"
                        }
                    ]
                }
            }))
            .unwrap(),
        )
        .unwrap();
        let home_text = home.to_string_lossy().to_string();
        coordination
            .env_vars
            .push(("DIFFFORGE_CODEX_HOME".to_string(), home_text.clone()));
        coordination
            .env_vars
            .push(("CODEX_HOME".to_string(), home_text));
        coordination
            .env_vars
            .push(("DIFFFORGE_CODEX_PROFILE".to_string(), profile.to_string()));

        let updated = refresh_codex_activity_hook_profile_for_terminal(
            Some(&coordination),
            "codex",
            "workspace-terminal/workspace-1-0-codex",
            42,
            Some("workspace-1"),
            Some(2),
        )
        .unwrap();

        assert!(updated);
        let hooks = fs::read_to_string(&hooks_path).unwrap();
        assert!(hooks.contains("--diff-forge-activity-hook"));
        assert!(hooks.contains("UserPromptSubmit"));
        assert!(hooks.contains("Stop"));
        assert!(hooks.contains("Error"));
        assert!(hooks.contains("Interrupt"));
        assert!(hooks.contains("PreToolUse"));
        assert!(hooks.contains("PostToolUse"));
        assert!(hooks.contains("SubagentStart"));
        assert!(hooks.contains("SubagentStop"));
        assert!(hooks.contains("--pane-id"));
        assert!(hooks.contains("workspace-terminal/workspace-1-0-codex"));
        assert!(hooks.contains("--instance-id"));
        assert!(hooks.contains("42"));
        assert!(hooks.contains("--workspace-id"));
        assert!(hooks.contains("workspace-1"));
        assert!(hooks.contains("--terminal-index"));
        assert!(hooks.contains("--events-path"));
        assert!(hooks.contains("--debug-path"));
        assert!(hooks.contains("--diff-forge-write-guard"));
        assert_eq!(hooks.matches("--pane-id").count(), 8);
        let profile_config = fs::read_to_string(&profile_path).unwrap();
        assert!(profile_config.contains("[[hooks.UserPromptSubmit]]"));
        assert!(profile_config.contains("[[hooks.Stop]]"));
        assert!(profile_config.contains("[[hooks.Error]]"));
        assert!(profile_config.contains("[[hooks.Interrupt]]"));
        assert!(profile_config.contains("[[hooks.PreToolUse]]"));
        assert!(profile_config.contains("[[hooks.PostToolUse]]"));
        assert!(profile_config.contains("[[hooks.SubagentStart]]"));
        assert!(profile_config.contains("[[hooks.SubagentStop]]"));
        assert!(profile_config.contains("--diff-forge-activity-hook"));
        assert!(profile_config.contains("--pane-id"));
        assert!(profile_config.contains("workspace-terminal/workspace-1-0-codex"));
        assert!(profile_config.contains("--debug-path"));
        assert!(profile_config.contains("--diff-forge-write-guard"));
        assert!(!profile_config.contains("hooksPath ="));
    }

    #[test]
    fn coordinated_codex_launch_has_no_global_plugin_disable_shims() {
        let coordination = terminal_test_coordination("codex_no_global_plugin_shims");
        let args = terminal_args_with_codex_mcp_identity(
            "codex",
            &["--model".to_string(), "gpt-5.2".to_string()],
            Some(&coordination),
            "pane-auto",
            42,
        );

        assert!(args.windows(2).any(|pair| pair == ["--disable", "apps"]));
        assert!(!args.iter().any(|arg| arg.starts_with("plugins.")));
        assert!(!args.iter().any(|arg| arg.contains("computer-use")));
        assert!(
            !args
                .iter()
                .any(|arg| arg.contains("browser@openai-bundled"))
        );
        assert!(!args.iter().any(|arg| arg.contains("codex_apps")));
        assert!(
            args.iter()
                .any(|arg| arg.starts_with("mcp_servers.coordination-kernel."))
        );
        assert!(
            args.iter()
                .any(|arg| arg.starts_with("mcp_servers.workspace-mcp-gateway."))
        );
    }

    #[test]
    fn coordinated_claude_launch_auto_approves_repo_views_and_coordination_tools() {
        let mut coordination = terminal_test_coordination("claude_auto_approval_args");
        let claude_config_path = PathBuf::from(&coordination.repo_path)
            .join(".agents")
            .join("mcp")
            .join("agents")
            .join("1.claude.json")
            .display()
            .to_string();
        let worktree_path = PathBuf::from(&coordination.repo_path)
            .join(".agents")
            .join("worktrees")
            .join("1")
            .display()
            .to_string();
        coordination
            .env_vars
            .push(("CLAUDE_MCP_CONFIG".to_string(), claude_config_path.clone()));
        coordination.env_vars.push((
            "COORDINATION_AGENT_BRANCH_ROOT".to_string(),
            worktree_path.clone(),
        ));
        coordination.env_vars.push((
            "COORDINATION_WORKTREE_PATH".to_string(),
            worktree_path.clone(),
        ));
        coordination.env_vars.push((
            "COORDINATION_VISIBLE_ROOT".to_string(),
            coordination.repo_path.clone(),
        ));
        coordination.env_vars.push((
            "COORDINATION_ENFORCEMENT_MODE".to_string(),
            "worktree_required".to_string(),
        ));
        coordination.env_vars.push((
            "COORDINATION_FILE_AUTHORITY".to_string(),
            "git_worktree_patch".to_string(),
        ));
        coordination
            .env_vars
            .push(("COORDINATION_SLOT_KEY".to_string(), "1".to_string()));
        coordination.env_vars.push((
            "DIFFFORGE_WORKSPACE_MCP_ALLOWED_TOOLS".to_string(),
            "appwrite-api__appwrite_search_tools".to_string(),
        ));

        let args = terminal_args_with_codex_mcp_identity(
            "claude",
            &[
                "--model".to_string(),
                "sonnet".to_string(),
                "--add-dir".to_string(),
                "/tmp/repo-root-override".to_string(),
                "--allowedTools".to_string(),
                "Bash,Write".to_string(),
                "--mcp-config".to_string(),
                "/tmp/unsafe-claude-mcp.json".to_string(),
                "--permission-mode".to_string(),
                "bypassPermissions".to_string(),
                "--settings".to_string(),
                "{\"disableAllHooks\":true}".to_string(),
                "--allow-dangerously-skip-permissions".to_string(),
                "--dangerously-skip-permissions".to_string(),
            ],
            Some(&coordination),
            "pane-auto",
            42,
        );

        assert!(
            args.windows(2)
                .any(|pair| pair == ["--add-dir", coordination.repo_path.as_str()])
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--add-dir", worktree_path.as_str()])
        );
        assert!(
            !args
                .windows(2)
                .any(|pair| pair == ["--add-dir", "/tmp/repo-root-override"])
        );
        let allowed_tools = args
            .windows(2)
            .find_map(|pair| {
                (pair[0] == "--allowedTools" || pair[0] == "--allowed-tools")
                    .then(|| pair[1].as_str())
            })
            .unwrap();
        for tool in [
            "Read",
            "Glob",
            "Grep",
            "LS",
            "mcp__coordination-kernel__start_task",
            "mcp__coordination-kernel__acquire_lease",
            "mcp__coordination-kernel__checkpoint",
            "mcp__coordination-kernel__submit_patch",
            "mcp__workspace-mcp-gateway__workspace_mcp__sync_manifest",
            "mcp__workspace-mcp-gateway__appwrite-api__appwrite_search_tools",
        ] {
            assert!(allowed_tools.split(',').any(|allowed| allowed == tool));
        }
        assert!(
            allowed_tools
                .split(',')
                .any(|allowed| allowed.starts_with("Edit(//") && allowed.ends_with("/**)"))
        );
        assert!(!allowed_tools.split(',').any(|allowed| allowed == "Bash"));
        assert!(!allowed_tools.split(',').any(|allowed| allowed == "Write"));
        let mcp_config = args
            .windows(2)
            .find_map(|pair| (pair[0] == "--mcp-config").then(|| pair[1].as_str()))
            .unwrap();
        assert_eq!(mcp_config, claude_config_path);
        assert!(
            !args
                .windows(2)
                .any(|pair| pair == ["--mcp-config", "/tmp/unsafe-claude-mcp.json"])
        );
        assert!(args.iter().any(|arg| arg == "--strict-mcp-config"));
        assert!(!mcp_config.contains("\"coordination-kernel\""));
        assert!(!mcp_config.contains("terminal_launch_args"));
        assert!(
            !args
                .iter()
                .any(|arg| arg == "--dangerously-skip-permissions")
        );
        assert!(
            !args
                .iter()
                .any(|arg| arg == "--allow-dangerously-skip-permissions")
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--permission-mode", "acceptEdits"])
        );
        assert!(
            !args
                .windows(2)
                .any(|pair| pair == ["--permission-mode", "bypassPermissions"])
        );
        let settings_arg = args
            .windows(2)
            .find_map(|pair| (pair[0] == "--settings").then(|| pair[1].as_str()))
            .unwrap();
        let settings: Value = serde_json::from_str(settings_arg).unwrap();
        assert_eq!(
            settings["disableBypassPermissionsMode"].as_str(),
            Some("disable")
        );
        assert_eq!(
            settings["permissions"]["defaultMode"].as_str(),
            Some("acceptEdits")
        );
        assert!(
            settings["hooks"]["PreToolUse"]
                .as_array()
                .unwrap()
                .iter()
                .any(|hook| hook["matcher"].as_str() == Some("Edit|Write|NotebookEdit"))
        );
        assert_eq!(settings["sandbox"]["enabled"].as_bool(), Some(true));
        assert_eq!(
            settings["sandbox"]["allowUnsandboxedCommands"].as_bool(),
            Some(false)
        );
        assert_eq!(
            settings["sandbox"]["filesystem"]["allowWrite"][0].as_str(),
            Some(worktree_path.as_str())
        );
        let guard_command = settings["hooks"]["PreToolUse"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|entry| {
                entry["hooks"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|hook| hook["command"].as_str())
            })
            .find(|command| command.contains("--diff-forge-write-guard"))
            .unwrap_or_default();
        assert!(guard_command.contains("--diff-forge-write-guard"));
        assert!(!guard_command.contains("--claude-worktree-guard"));
        assert!(!args.iter().any(|arg| arg == "--no-alt-screen"));
    }

    #[test]
    fn coordinated_claude_direct_edit_adds_git_route_guard_for_bounded_root() {
        let direct_root = terminal_test_directory("claude_direct_edit_args");
        let direct_root_text = direct_root.display().to_string();
        let mut coordination = terminal_test_coordination("claude_direct_edit_kernel");
        coordination.repo_path = direct_root_text.clone();
        coordination.env_vars.push((
            "COORDINATION_AGENT_BRANCH_ROOT".to_string(),
            direct_root_text.clone(),
        ));
        coordination.env_vars.push((
            "COORDINATION_ENFORCEMENT_MODE".to_string(),
            "bounded_direct_edit".to_string(),
        ));
        coordination.env_vars.push((
            "COORDINATION_FILE_AUTHORITY".to_string(),
            "bounded_direct_edit".to_string(),
        ));

        let args = terminal_args_with_codex_mcp_identity(
            "claude",
            &[
                "--permission-mode".to_string(),
                "bypassPermissions".to_string(),
            ],
            Some(&coordination),
            "pane-direct",
            43,
        );

        assert!(
            args.windows(2)
                .any(|pair| pair == ["--add-dir", direct_root_text.as_str()])
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--permission-mode", "acceptEdits"])
        );
        assert!(
            !args
                .windows(2)
                .any(|pair| pair == ["--permission-mode", "bypassPermissions"])
        );
        let settings_arg = args
            .windows(2)
            .find_map(|pair| (pair[0] == "--settings").then(|| pair[1].as_str()))
            .unwrap();
        let settings: Value = serde_json::from_str(settings_arg).unwrap();
        assert!(
            settings["hooks"]["PreToolUse"]
                .as_array()
                .unwrap()
                .iter()
                .any(|hook| hook["matcher"].as_str() == Some("Edit|Write|NotebookEdit"))
        );
        assert!(settings_arg.contains("--diff-forge-write-guard"));
        let allowed_tools = args
            .windows(2)
            .find_map(|pair| {
                (pair[0] == "--allowedTools" || pair[0] == "--allowed-tools")
                    .then(|| pair[1].as_str())
            })
            .unwrap();
        assert!(
            allowed_tools
                .split(',')
                .any(|allowed| allowed.starts_with("Edit(//") && allowed.ends_with("/**)"))
        );
        assert!(
            allowed_tools
                .split(',')
                .any(|allowed| allowed.starts_with("Write(//") && allowed.ends_with("/**)"))
        );
        assert!(!allowed_tools.split(',').any(|allowed| allowed == "Bash"));
    }

    #[test]
    fn coordinated_claude_general_worker_starts_in_repo_without_raw_worktree_write() {
        let mut coordination = terminal_test_coordination("claude_general_worker_args");
        let repo = PathBuf::from(&coordination.repo_path);
        fs::write(repo.join("README.md"), "initial\n").unwrap();
        for args in [
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Diff Forge Test"],
            vec!["add", "README.md"],
            vec!["commit", "-m", "initial"],
        ] {
            let status = Command::new("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .status()
                .unwrap();
            assert!(status.success());
        }
        let repo_text = repo.display().to_string();
        coordination.env_vars.push((
            "COORDINATION_AGENT_BRANCH_ROOT".to_string(),
            repo_text.clone(),
        ));
        coordination.env_vars.push((
            "COORDINATION_ENFORCEMENT_MODE".to_string(),
            "general_worker".to_string(),
        ));
        coordination.env_vars.push((
            "COORDINATION_FILE_AUTHORITY".to_string(),
            "task_scoped".to_string(),
        ));
        coordination
            .env_vars
            .push(("COORDINATION_SLOT_KEY".to_string(), "1".to_string()));

        let args = terminal_args_with_codex_mcp_identity(
            "claude",
            &[
                "--permission-mode".to_string(),
                "bypassPermissions".to_string(),
            ],
            Some(&coordination),
            "pane-general",
            44,
        );

        assert!(
            args.windows(2)
                .any(|pair| pair == ["--add-dir", repo_text.as_str()])
        );
        assert!(
            !args
                .windows(2)
                .any(|pair| pair[0] == "--add-dir" && pair[1].contains(".agents/worktrees/1"))
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--permission-mode", "acceptEdits"])
        );
        assert!(
            !args
                .windows(2)
                .any(|pair| pair == ["--permission-mode", "bypassPermissions"])
        );
        assert!(!args.windows(2).any(|pair| pair[0] == "--settings"));
        let allowed_tools = args
            .windows(2)
            .find_map(|pair| {
                (pair[0] == "--allowedTools" || pair[0] == "--allowed-tools")
                    .then(|| pair[1].as_str())
            })
            .unwrap();
        assert!(
            !allowed_tools
                .split(',')
                .any(|allowed| allowed.starts_with("Edit(//") || allowed.starts_with("Write(//"))
        );
        assert!(
            !allowed_tools
                .split(',')
                .any(|allowed| allowed.contains(&format!("{}/**", repo_text)))
        );
    }

    #[test]
    fn claude_worktree_guard_denies_root_file_edit() {
        let repo = terminal_test_repo_with_commit("claude_guard_root_edit");
        let (identity, worktree) =
            terminal_test_task_guard_identity(&repo, "1", Some("file:pricing.html"));
        fs::write(repo.join("pricing.html"), "<h1>Root</h1>\n").unwrap();
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Edit",
            "cwd": worktree.display().to_string(),
            "tool_input": {
                "file_path": repo.join("pricing.html").display().to_string()
            }
        });

        let reason =
            claude_worktree_guard_denial_reason(&hook_input, &repo, &worktree, "1", &identity)
                .unwrap();

        assert!(reason.contains("outside terminal slot"));
    }

    #[test]
    fn claude_worktree_guard_allows_architecture_root_graph_edit_without_task() {
        let repo = terminal_test_repo_with_commit("claude_guard_architecture_root_edit");
        let worktree = repo.join(".agents").join("worktrees").join("1");
        fs::create_dir_all(&worktree).unwrap();
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Write",
            "cwd": worktree.display().to_string(),
            "tool_input": {
                "file_path": repo
                    .join(".agents")
                    .join("architectures")
                    .join("graphs")
                    .join("auth-flow.arch")
                    .display()
                    .to_string()
            }
        });

        let reason = claude_worktree_guard_denial_reason(
            &hook_input,
            &repo,
            &worktree,
            "1",
            &DiffForgeWriteGuardIdentity::default(),
        );

        assert!(reason.is_none());
    }

    #[test]
    fn claude_worktree_guard_denies_assigned_worktree_edit_without_task() {
        let repo = terminal_test_repo_with_commit("claude_guard_worktree_no_task");
        let worktree = repo.join(".agents").join("worktrees").join("1");
        fs::create_dir_all(&worktree).unwrap();
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Write",
            "cwd": worktree.display().to_string(),
            "tool_input": {
                "file_path": worktree.join("pricing.html").display().to_string()
            }
        });

        let reason = claude_worktree_guard_denial_reason(
            &hook_input,
            &repo,
            &worktree,
            "1",
            &DiffForgeWriteGuardIdentity::default(),
        )
        .unwrap();

        assert!(reason.contains("no active task-owned worktree"));
    }

    #[test]
    fn claude_worktree_guard_allows_assigned_worktree_edit_with_task_and_lease() {
        let repo = terminal_test_repo_with_commit("claude_guard_worktree_edit");
        let (identity, worktree) =
            terminal_test_task_guard_identity(&repo, "1", Some("file:pricing.html"));
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Write",
            "cwd": worktree.display().to_string(),
            "tool_input": {
                "file_path": worktree.join("pricing.html").display().to_string()
            }
        });

        let reason =
            claude_worktree_guard_denial_reason(&hook_input, &repo, &worktree, "1", &identity);

        assert!(reason.is_none());
    }

    #[test]
    fn claude_worktree_guard_denies_other_slot_worktree_edit() {
        let repo = terminal_test_repo_with_commit("claude_guard_cross_slot_edit");
        let (identity, worktree) =
            terminal_test_task_guard_identity(&repo, "1", Some("file:pricing.html"));
        let other = repo.join(".agents").join("worktrees").join("2");
        fs::create_dir_all(&other).unwrap();
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Write",
            "cwd": worktree.display().to_string(),
            "tool_input": {
                "file_path": other.join("pricing.html").display().to_string()
            }
        });

        let reason =
            claude_worktree_guard_denial_reason(&hook_input, &repo, &worktree, "1", &identity)
                .unwrap();

        assert!(reason.contains("outside terminal slot"));
    }

    #[test]
    fn claude_worktree_guard_denies_unsandboxed_shell_escape() {
        let repo = terminal_test_directory("claude_guard_unsandboxed_shell");
        let worktree = repo.join(".agents").join("worktrees").join("1");
        fs::create_dir_all(&worktree).unwrap();
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "cwd": worktree.display().to_string(),
            "tool_input": {
                "command": "python -c 'print(1)'",
                "dangerouslyDisableSandbox": true
            }
        });

        let reason = claude_worktree_guard_denial_reason(
            &hook_input,
            &repo,
            &worktree,
            "1",
            &DiffForgeWriteGuardIdentity::default(),
        )
        .unwrap();

        assert!(reason.contains("unsandboxed"));
    }

    #[test]
    fn claude_worktree_guard_denies_mutating_shell_without_lease() {
        let repo = terminal_test_repo_with_commit("claude_guard_shell_no_lease");
        let (identity, worktree) = terminal_test_task_guard_identity(&repo, "1", None);
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "cwd": worktree.display().to_string(),
            "tool_input": {
                "command": "echo '<h1>Updated</h1>' > pricing.html"
            }
        });

        let reason =
            claude_worktree_guard_denial_reason(&hook_input, &repo, &worktree, "1", &identity)
                .unwrap();

        assert!(reason.contains("no active write lease"));
    }

    #[test]
    fn claude_worktree_guard_allows_mutating_shell_with_lease() {
        let repo = terminal_test_repo_with_commit("claude_guard_shell_with_lease");
        let (identity, worktree) =
            terminal_test_task_guard_identity(&repo, "1", Some("file:pricing.html"));
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "cwd": worktree.display().to_string(),
            "tool_input": {
                "command": "echo '<h1>Updated</h1>' > pricing.html"
            }
        });

        let reason =
            claude_worktree_guard_denial_reason(&hook_input, &repo, &worktree, "1", &identity);

        assert!(reason.is_none());
    }

    #[test]
    fn diff_forge_apply_patch_guard_denies_git_root_paths() {
        let repo = terminal_test_repo_with_commit("codex_apply_patch_route");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("src/main.rs"), "fn main() {}\n").unwrap();
        let (identity, _worktree) =
            terminal_test_task_guard_identity(&repo, "slot1", Some("file:src/main.rs"));
        let patch = format!(
            "*** Begin Patch\n*** Update File: {}\n@@\n-fn main() {{}}\n+fn main() {{ println!(\"hi\"); }}\n*** End Patch\n",
            repo.join("src/main.rs").display()
        );

        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "functions.apply_patch",
            "cwd": repo.display().to_string(),
            "tool_input": {
                "command": patch
            }
        });
        let error = diff_forge_write_guard_decision(
            "codex",
            &hook_input,
            &repo,
            "slot1",
            "codex",
            &identity,
        )
        .unwrap_err();

        assert!(error.contains("direct Git repository edit"));
        assert!(
            error.contains(
                "apply_patch must target this terminal's assigned worktree path explicitly"
            )
        );
    }

    #[test]
    fn diff_forge_apply_patch_guard_denies_visible_root_relative_paths() {
        let repo = terminal_test_repo_with_commit("codex_apply_patch_relative_root");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("src/main.rs"), "fn main() {}\n").unwrap();
        let (identity, _worktree) =
            terminal_test_task_guard_identity(&repo, "slot1", Some("file:src/main.rs"));
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "functions.apply_patch",
            "cwd": repo.display().to_string(),
            "tool_input": {
                "command": "*** Begin Patch\n*** Update File: src/main.rs\n@@\n-fn main() {}\n+fn main() { println!(\"hi\"); }\n*** End Patch\n"
            }
        });

        let error = diff_forge_write_guard_decision(
            "codex",
            &hook_input,
            &repo,
            "slot1",
            "codex",
            &identity,
        )
        .unwrap_err();

        assert!(error.contains("direct Git repository edit"));
        assert!(error.contains(".agents/worktrees/slot1"));
    }

    #[test]
    fn diff_forge_apply_patch_guard_allows_explicit_worktree_paths() {
        let repo = terminal_test_repo_with_commit("codex_apply_patch_route_relative");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("src/main.rs"), "fn main() {}\n").unwrap();
        let (identity, worktree) =
            terminal_test_task_guard_identity(&repo, "slot1", Some("file:src/main.rs"));
        fs::create_dir_all(worktree.join("src")).unwrap();
        fs::write(worktree.join("src/main.rs"), "fn main() {}\n").unwrap();
        let patch = "*** Begin Patch\n*** Update File: src/main.rs\n@@\n-fn main() {}\n+fn main() { println!(\"hi\"); }\n*** End Patch\n";

        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "functions.apply_patch",
            "cwd": worktree.display().to_string(),
            "tool_input": {
                "command": patch
            }
        });
        let decision = diff_forge_write_guard_decision(
            "codex",
            &hook_input,
            &repo,
            "slot1",
            "codex",
            &identity,
        )
        .unwrap();

        assert!(decision.is_none());
    }

    #[test]
    fn diff_forge_write_guard_denies_shell_apply_patch_in_git_root() {
        let repo = terminal_test_repo_with_commit("write_guard_shell_apply_patch_root");
        let (identity, _worktree) =
            terminal_test_task_guard_identity(&repo, "slot1", Some("file:index.html"));
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "cwd": repo.display().to_string(),
            "tool_input": {
                "command": "apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: index.html\n+hello\n*** End Patch\nPATCH"
            }
        });

        let error = diff_forge_write_guard_decision(
            "codex",
            &hook_input,
            &repo,
            "slot1",
            "codex",
            &identity,
        )
        .unwrap_err();

        assert!(error.contains("direct Git repository edit"));
        assert!(error.contains("Shell commands that mutate Git repositories"));
    }

    #[test]
    fn diff_forge_write_guard_allows_non_git_direct_edit() {
        let root = terminal_test_directory("write_guard_non_git");
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Write",
            "cwd": root.display().to_string(),
            "tool_input": {
                "file_path": root.join("notes.txt").display().to_string()
            }
        });

        let decision = diff_forge_write_guard_decision(
            "claude",
            &hook_input,
            &root,
            "slot1",
            "claude",
            &DiffForgeWriteGuardIdentity::default(),
        )
        .unwrap();

        assert!(decision.is_none());
    }

    #[test]
    fn diff_forge_write_guard_promotes_late_git_direct_session_and_denies_root_edit() {
        let repo = terminal_test_directory("write_guard_late_git_direct");
        let kernel = crate::coordination::CoordinationKernel::init(&repo, None).unwrap();
        let session = kernel
            .create_terminal_session_for_slot_key(
                "slot1",
                "Codex",
                "codex",
                None,
                None,
                Some("terminal-slot1"),
                true,
                None,
                None,
                Some("test-launch"),
                Some("bounded_direct_edit"),
            )
            .unwrap();
        assert_eq!(
            session["enforcementMode"].as_str(),
            Some("bounded_direct_edit")
        );
        let agent_id = session["agentId"].as_str().unwrap().to_string();
        let session_id = session["id"].as_str().unwrap().to_string();
        let task = kernel
            .create_task("Late Git guarded edit", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_id = task["id"].as_str().unwrap().to_string();
        kernel.claim_task(&task_id, &agent_id, &session_id).unwrap();
        kernel
            .acquire_lease(
                &task_id,
                &agent_id,
                &session_id,
                "file:pricing.html",
                "write",
                Some(600),
                None,
            )
            .unwrap();

        terminal_test_git(&repo, &["init"]);
        let identity = DiffForgeWriteGuardIdentity::new(
            Some(agent_id),
            Some(session_id.clone()),
            Some(kernel.paths.db_path.clone()),
        );
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Write",
            "cwd": repo.display().to_string(),
            "tool_input": {
                "file_path": repo.join("pricing.html").display().to_string()
            }
        });

        let error = diff_forge_write_guard_decision(
            "codex",
            &hook_input,
            &repo,
            "slot1",
            "codex",
            &identity,
        )
        .unwrap_err();

        assert!(error.contains("direct Git repository edit"));
        assert!(error.contains(".agents/worktrees/slot1"));
        let session = kernel
            .query_json(
                "SELECT enforcement_mode, worktree_id, write_root FROM agent_sessions WHERE id=?1",
                &[&session_id],
            )
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        assert_eq!(
            session["enforcement_mode"].as_str(),
            Some("worktree_required")
        );
        assert!(session["worktree_id"].as_str().is_some());
        assert!(
            session["write_root"]
                .as_str()
                .is_some_and(|value| value.contains(".agents/worktrees/slot1"))
        );
    }

    #[test]
    fn diff_forge_write_guard_allows_architecture_graph_direct_root_edit_without_task() {
        let repo = terminal_test_repo_with_commit("write_guard_architecture_root_edit");
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Write",
            "cwd": repo.display().to_string(),
            "tool_input": {
                "file_path": repo
                    .join(".agents")
                    .join("architectures")
                    .join("graphs")
                    .join("deployment.arch")
                    .display()
                    .to_string()
            }
        });

        let decision = diff_forge_write_guard_decision(
            "codex",
            &hook_input,
            &repo,
            "slot1",
            "codex",
            &DiffForgeWriteGuardIdentity::default(),
        )
        .unwrap();

        assert!(decision.is_none());
    }

    #[test]
    fn diff_forge_write_guard_allows_architecture_shell_direct_root_edit_without_task() {
        let repo = terminal_test_repo_with_commit("write_guard_architecture_shell_edit");
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "cwd": repo.display().to_string(),
            "tool_input": {
                "command": "mkdir -p .agents/architectures/graphs && printf 'title \"Auth\"\\n' > .agents/architectures/graphs/auth.arch"
            }
        });

        let decision = diff_forge_write_guard_decision(
            "codex",
            &hook_input,
            &repo,
            "slot1",
            "codex",
            &DiffForgeWriteGuardIdentity::default(),
        )
        .unwrap();

        assert!(decision.is_none());
    }

    #[test]
    fn diff_forge_write_guard_denies_real_git_root_edit_with_worktree_path() {
        let repo = terminal_test_repo_with_commit("write_guard_git_root");
        fs::write(repo.join("pricing.html"), "<h1>Root</h1>\n").unwrap();
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Edit",
            "cwd": repo.display().to_string(),
            "tool_input": {
                "file_path": repo.join("pricing.html").display().to_string()
            }
        });

        let error = diff_forge_write_guard_decision(
            "claude",
            &hook_input,
            &repo,
            "slot1",
            "claude",
            &DiffForgeWriteGuardIdentity::default(),
        )
        .unwrap_err();

        if !error.contains("no active task-owned worktree") {
            panic!("nested guard error: {error}");
        }
    }

    #[test]
    fn diff_forge_write_guard_denies_worktree_edit_without_active_lease() {
        let repo = terminal_test_repo_with_commit("write_guard_worktree_no_lease");
        let (identity, worktree) = terminal_test_task_guard_identity(&repo, "slot1", None);
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Write",
            "cwd": worktree.display().to_string(),
            "tool_input": {
                "file_path": worktree.join("pricing.html").display().to_string()
            }
        });

        let error = diff_forge_write_guard_decision(
            "codex",
            &hook_input,
            &repo,
            "slot1",
            "codex",
            &identity,
        )
        .unwrap_err();

        assert!(error.contains("no active write lease"));
    }

    #[test]
    fn diff_forge_write_guard_allows_worktree_edit_with_active_lease() {
        let repo = terminal_test_repo_with_commit("write_guard_worktree_with_lease");
        let (identity, worktree) =
            terminal_test_task_guard_identity(&repo, "slot1", Some("file:pricing.html"));
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Write",
            "cwd": worktree.display().to_string(),
            "tool_input": {
                "file_path": worktree.join("pricing.html").display().to_string()
            }
        });

        let decision = diff_forge_write_guard_decision(
            "codex",
            &hook_input,
            &repo,
            "slot1",
            "codex",
            &identity,
        )
        .unwrap();

        assert!(decision.is_none());
    }

    #[test]
    fn diff_forge_write_guard_denies_real_git_root_edit_with_active_task_route() {
        let repo = terminal_test_repo_with_commit("write_guard_git_root_active");
        fs::write(repo.join("pricing.html"), "<h1>Root</h1>\n").unwrap();
        let (identity, _worktree) =
            terminal_test_task_guard_identity(&repo, "slot1", Some("file:pricing.html"));
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Edit",
            "cwd": repo.display().to_string(),
            "tool_input": {
                "file_path": repo.join("pricing.html").display().to_string()
            }
        });

        let error = diff_forge_write_guard_decision(
            "claude",
            &hook_input,
            &repo,
            "slot1",
            "claude",
            &identity,
        )
        .unwrap_err();

        assert!(error.contains("direct Git repository edit"));
        assert!(error.contains(".agents/worktrees/slot1"));
    }

    #[test]
    fn diff_forge_write_guard_denies_nested_git_edit_from_direct_container() {
        let root = terminal_test_directory("write_guard_nested_git_container");
        let repo = root.join("packages").join("nested-app");
        fs::create_dir_all(&repo).unwrap();
        terminal_test_git(&repo, &["init"]);
        fs::write(repo.join("pricing.html"), "<h1>Nested</h1>\n").unwrap();
        terminal_test_git(&repo, &["config", "user.email", "test@example.com"]);
        terminal_test_git(&repo, &["config", "user.name", "Diff Forge Test"]);
        terminal_test_git(&repo, &["add", "pricing.html"]);
        terminal_test_git(&repo, &["commit", "-m", "init"]);
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Edit",
            "cwd": root.display().to_string(),
            "tool_input": {
                "file_path": repo.join("pricing.html").display().to_string()
            }
        });

        let error = diff_forge_write_guard_decision(
            "claude",
            &hook_input,
            &root,
            "slot1",
            "claude",
            &DiffForgeWriteGuardIdentity::default(),
        )
        .unwrap_err();

        if !error.contains("no active task-owned worktree") {
            panic!("nested guard error: {error}");
        }
    }

    #[test]
    fn diff_forge_write_guard_denies_nested_git_inside_outer_slot_without_child_task() {
        let root = terminal_test_directory("write_guard_nested_git_inside_slot");
        terminal_test_git(&root, &["init"]);
        fs::write(root.join("README.md"), "root\n").unwrap();
        terminal_test_git(&root, &["config", "user.email", "test@example.com"]);
        terminal_test_git(&root, &["config", "user.name", "Diff Forge Test"]);
        terminal_test_git(&root, &["add", "README.md"]);
        terminal_test_git(&root, &["commit", "-m", "root"]);
        let (identity, outer_slot) = terminal_test_task_guard_identity(
            &root,
            "slot1",
            Some("file:packages/nested-app/pricing.html"),
        );
        let repo = outer_slot.join("packages").join("nested-app");
        fs::create_dir_all(&repo).unwrap();
        terminal_test_git(&repo, &["init"]);
        fs::write(repo.join("pricing.html"), "<h1>Nested</h1>\n").unwrap();
        terminal_test_git(&repo, &["config", "user.email", "test@example.com"]);
        terminal_test_git(&repo, &["config", "user.name", "Diff Forge Test"]);
        terminal_test_git(&repo, &["add", "pricing.html"]);
        terminal_test_git(&repo, &["commit", "-m", "init"]);

        let error = diff_forge_git_write_route(
            &repo.join("pricing.html"),
            "slot1",
            "codex",
            &identity,
            true,
        )
        .unwrap_err();

        if !error.contains("no active task-owned worktree") {
            panic!("nested guard error: {error}");
        }
    }

    #[test]
    fn diff_forge_write_guard_denies_mutating_shell_in_git_root() {
        let repo = terminal_test_repo_with_commit("write_guard_shell_git_root");
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "cwd": repo.display().to_string(),
            "tool_input": {
                "command": "echo '<h1>Root</h1>' > pricing.html"
            }
        });

        let (identity, _worktree) =
            terminal_test_task_guard_identity(&repo, "slot1", Some("file:pricing.html"));
        let error = diff_forge_write_guard_decision(
            "codex",
            &hook_input,
            &repo,
            "slot1",
            "codex",
            &identity,
        )
        .unwrap_err();

        assert!(error.contains("direct Git repository edit"));
        assert!(error.contains("Shell commands that mutate Git repositories"));
    }

    #[test]
    fn diff_forge_write_guard_denies_mutating_shell_in_worktree_without_lease() {
        let repo = terminal_test_repo_with_commit("write_guard_shell_worktree_no_lease");
        let (identity, worktree) = terminal_test_task_guard_identity(&repo, "slot1", None);
        let hook_input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "cwd": worktree.display().to_string(),
            "tool_input": {
                "command": "echo '<h1>Root</h1>' > pricing.html"
            }
        });

        let error = diff_forge_write_guard_decision(
            "codex",
            &hook_input,
            &repo,
            "slot1",
            "codex",
            &identity,
        )
        .unwrap_err();

        assert!(error.contains("no active write lease"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_claude_launch_rejects_inline_mcp_json() {
        let inline_config =
            r#"{"mcpServers":{"coordination-kernel":{"command":"coordination_mcp"}}}"#;
        let args = vec!["--mcp-config".to_string(), inline_config.to_string()];

        let error = validate_terminal_agent_launch_args_for_platform("claude", &args).unwrap_err();

        assert!(error.contains("file-backed MCP config"));
    }

    #[test]
    fn codex_launch_args_disable_alt_screen_without_coordination() {
        let args = terminal_args_with_codex_mcp_identity(
            "codex",
            &["--model".to_string(), "gpt-5.4".to_string()],
            None,
            "pane-auto",
            42,
        );

        assert!(args.iter().any(|arg| arg == "--no-alt-screen"));
        assert!(!args.windows(2).any(|pair| pair == ["--disable", "apps"]));
    }

    #[test]
    fn codex_launch_args_preserve_explicit_apps_disable() {
        let args = terminal_args_with_codex_mcp_identity(
            "codex",
            &["--disable".to_string(), "apps".to_string()],
            None,
            "pane-auto",
            42,
        );

        assert_eq!(
            args.windows(2)
                .filter(|pair| pair[0] == "--disable" && pair[1] == "apps")
                .count(),
            1
        );
    }

    #[test]
    fn coordinated_codex_launch_disables_apps_without_codex_apps_mcp_config() {
        let coordination = terminal_test_coordination("codex_disable_apps");
        let args = terminal_args_with_codex_mcp_identity(
            "codex",
            &[
                "--enable".to_string(),
                "apps".to_string(),
                "--disable".to_string(),
                "apps".to_string(),
            ],
            Some(&coordination),
            "pane-auto",
            42,
        );

        assert!(!args.windows(2).any(|pair| pair == ["--enable", "apps"]));
        assert_eq!(
            args.windows(2)
                .filter(|pair| pair[0] == "--disable" && pair[1] == "apps")
                .count(),
            1
        );
        assert!(
            !args
                .iter()
                .any(|arg| arg.starts_with("mcp_servers.codex_apps."))
        );
    }

    #[test]
    fn opencode_launch_env_uses_system_tui_theme_config() {
        let env_vars = terminal_env_vars_with_opencode_tui_config(
            "opencode",
            &[
                ("COORDINATION_ENABLED".to_string(), "1".to_string()),
                (
                    OPENCODE_TUI_CONFIG_ENV.to_string(),
                    "/tmp/user-opencode-tui.json".to_string(),
                ),
            ],
        )
        .unwrap();

        assert!(
            env_vars
                .iter()
                .any(|(key, value)| key == "COORDINATION_ENABLED" && value == "1")
        );
        let config_paths = env_vars
            .iter()
            .filter_map(|(key, value)| (key == OPENCODE_TUI_CONFIG_ENV).then_some(value))
            .collect::<Vec<_>>();
        assert_eq!(config_paths.len(), 1);
        let config: Value =
            serde_json::from_str(&fs::read_to_string(config_paths[0]).unwrap()).unwrap();
        assert_eq!(
            config["$schema"].as_str(),
            Some("https://opencode.ai/tui.json")
        );
        assert_eq!(config["theme"].as_str(), Some(OPENCODE_TUI_SYSTEM_THEME));
    }

    #[test]
    fn non_opencode_launch_env_does_not_add_tui_config() {
        let env_vars = terminal_env_vars_with_opencode_tui_config(
            "codex",
            &[("COORDINATION_ENABLED".to_string(), "1".to_string())],
        )
        .unwrap();

        assert_eq!(
            env_vars,
            vec![("COORDINATION_ENABLED".to_string(), "1".to_string())]
        );
    }

    #[cfg(windows)]
    #[test]
    fn codex_mcp_args_override_uses_windows_safe_toml_literals() {
        let toml = terminal_toml_string_array(&[
            "--coordination-mcp".to_string(),
            "--repo-path".to_string(),
            r"C:\Users\O'Reilly\repo".to_string(),
        ]);

        assert_eq!(
            toml,
            r"['''--coordination-mcp''', '''--repo-path''', '''C:\Users\O'Reilly\repo''']"
        );
    }

    #[test]
    fn coordinated_codex_launch_uses_managed_permissions_without_overriding_cwd() {
        let mut coordination = terminal_test_coordination("codex_existing_approval_args");
        coordination.env_vars.push((
            "COORDINATION_AGENT_BRANCH_ROOT".to_string(),
            "/tmp/diffforge-agent-worktree".to_string(),
        ));
        coordination.env_vars.push((
            "COORDINATION_ENFORCEMENT_MODE".to_string(),
            "worktree_required".to_string(),
        ));
        coordination.env_vars.push((
            "COORDINATION_FILE_AUTHORITY".to_string(),
            "git_worktree_patch".to_string(),
        ));
        coordination.env_vars.push((
            "DIFFFORGE_CODEX_PROFILE".to_string(),
            "diffforge-test-profile".to_string(),
        ));
        let base = vec![
            "--ask-for-approval".to_string(),
            "on-request".to_string(),
            "--sandbox".to_string(),
            "read-only".to_string(),
            "--cd".to_string(),
            "/tmp/custom-cwd".to_string(),
            "--dangerously-bypass-approvals-and-sandbox".to_string(),
        ];

        let args = terminal_args_with_codex_mcp_identity(
            "codex",
            &base,
            Some(&coordination),
            "pane-auto",
            42,
        );

        assert_eq!(
            args.iter()
                .filter(|arg| arg.as_str() == "--ask-for-approval")
                .count(),
            1
        );
        assert_eq!(
            args.iter()
                .filter(|arg| arg.as_str() == "--sandbox")
                .count(),
            0
        );
        assert_eq!(args.iter().filter(|arg| arg.as_str() == "--cd").count(), 0);
        assert_eq!(
            args.iter()
                .filter(|arg| arg.as_str() == "--profile")
                .count(),
            1
        );
        assert!(
            !args
                .iter()
                .any(|arg| arg == "--dangerously-bypass-approvals-and-sandbox")
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--ask-for-approval", "never"])
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--profile", "diffforge-test-profile"])
        );
        assert!(args.windows(2).any(|pair| pair == ["--enable", "hooks"]));
        assert!(
            !args
                .iter()
                .any(|arg| arg == "--dangerously-bypass-hook-trust")
        );
        assert!(!args.iter().any(|arg| arg == "--sandbox"));
        assert!(
            !args
                .windows(2)
                .any(|pair| pair == ["--cd", "/tmp/custom-cwd"])
        );
    }

    #[test]
    fn coordinated_codex_activity_launch_is_read_only() {
        let mut coordination = terminal_test_coordination("codex_activity_args");
        coordination.env_vars.push((
            "COORDINATION_AGENT_BRANCH_ROOT".to_string(),
            "/tmp/diffforge-activity-root".to_string(),
        ));
        coordination.env_vars.push((
            "COORDINATION_ENFORCEMENT_MODE".to_string(),
            "activity_only".to_string(),
        ));
        coordination.env_vars.push((
            "COORDINATION_FILE_AUTHORITY".to_string(),
            "none".to_string(),
        ));
        coordination.env_vars.push((
            "DIFFFORGE_CODEX_PROFILE".to_string(),
            "diffforge-activity-profile".to_string(),
        ));

        let args = terminal_args_with_codex_mcp_identity(
            "codex",
            &["--model".to_string(), "gpt-5.4".to_string()],
            Some(&coordination),
            "pane-activity",
            7,
        );

        assert!(
            args.windows(2)
                .any(|pair| pair == ["--ask-for-approval", "never"])
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--profile", "diffforge-activity-profile"])
        );
        assert!(args.windows(2).any(|pair| pair == ["--enable", "hooks"]));
        assert!(!args.iter().any(|arg| arg == "--sandbox"));
    }
}

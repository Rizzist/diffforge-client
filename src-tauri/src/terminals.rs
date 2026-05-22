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

fn terminal_launch(
    kind: &str,
    provider: Option<String>,
    model: Option<String>,
    provider_session_id: Option<String>,
) -> Result<(Vec<String>, Vec<String>, String), String> {
    let provider = match kind {
        "console" => provider
            .as_deref()
            .map(parse_agent_provider)
            .transpose()?
            .unwrap_or(AgentProvider::Codex),
        "codex" => AgentProvider::Codex,
        "claude" => AgentProvider::Claude,
        "opencode" => AgentProvider::OpenCode,
        _ => {
            if let Some(provider) = provider {
                parse_agent_provider(&provider)?
            } else {
                return Err("Terminal kind is invalid.".to_string());
            }
        }
    };
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
        "\r" | "\n" | "\r\n" => "enter",
        TERMINAL_ENTER_SEQUENCE | TERMINAL_ENTER_SEQUENCE_MOD1 | TERMINAL_SHIFT_ENTER_SEQUENCE => {
            "enter_escape_sequence"
        }
        _ if data.chars().any(|character| character.is_control()) => "control_or_escape",
        _ => "text",
    }
}

#[cfg(windows)]
fn kill_terminal_process_tree(child: &mut dyn Child) -> TerminalKillReport {
    let mut report = TerminalKillReport {
        pid: child.process_id(),
        ..TerminalKillReport::default()
    };

    if let Some(pid) = report.pid {
        match Command::new("taskkill")
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
        working_directory,
        agent_started,
        input_gate,
        input_queue,
        active_task,
        coordination,
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
) {
    thread::spawn(move || {
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
) {
    let _ = app.emit(
        TERMINAL_CLOSE_ALL_PROGRESS_EVENT,
        TerminalCloseAllProgressPayload {
            closed,
            total,
            pane_id,
            instance_id,
        },
    );
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

fn workspace_git_bootstrap_flights(
) -> &'static StdMutex<HashMap<String, WorkspaceGitBootstrapFlight>> {
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
) -> Result<WorkspaceGitBootstrap, String> {
    ensure_app_not_shutting_down("workspace Git bootstrap")?;

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

async fn prepare_terminal_coordination_launch(
    pty_id: String,
    terminal_launch_epoch: String,
    working_directory: PathBuf,
    kind: String,
    provider_for_coordination: Option<String>,
    label: String,
    terminal_slot_key: String,
    workspace_id: Option<String>,
    workspace_name: Option<String>,
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
        ) {
            Ok(context) => {
                let worktree_required = context.enforcement_mode == "worktree_required";
                let has_worktree_id = context
                    .worktree_id
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty());
                let has_worktree_path = context
                    .worktree_path
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty());
                let write_root_display =
                    workspace_path_display(&PathBuf::from(&context.write_root));
                let repo_root_display = workspace_path_display(&working_directory);
                #[cfg(windows)]
                let write_root_matches_repo_root =
                    write_root_display.eq_ignore_ascii_case(&repo_root_display);
                #[cfg(not(windows))]
                let write_root_matches_repo_root = write_root_display == repo_root_display;
                if !worktree_required
                    || !has_worktree_id
                    || !has_worktree_path
                    || write_root_matches_repo_root
                {
                    let coordination = terminal_coordination_session_from_context(&context);
                    interrupt_terminal_coordination_session(
                        &coordination,
                        "coding_agent_requires_isolated_worktree",
                    );
                    let reason = if context.enforcement_mode == "coordination_only" {
                        "coordination returned coordination_only instead of an isolated worktree"
                    } else if !has_worktree_id {
                        "coordination did not return a worktree id"
                    } else if write_root_matches_repo_root {
                        "coordination write root points at the repository root"
                    } else {
                        "coordination did not return a worktree path"
                    };
                    return Err(format!("Terminal isolation failed for {label}: {reason}."));
                }

                let process_working_directory =
                    workspace_path_for_process(&PathBuf::from(&context.write_root));
                let branch_name = context
                    .slot_key
                    .as_ref()
                    .map(|slot_key| format!("agent/{slot_key}"));
                let launch_worktree = json!({
                    "agentId": context.agent_id.clone(),
                    "branchName": branch_name.clone(),
                    "id": context.worktree_id.clone(),
                    "path": context.write_root.clone(),
                    "sessionId": context.session_id.clone(),
                    "slotKey": context.slot_key.clone(),
                });
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

fn spawn_terminal_reader(
    app: AppHandle,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    pane_id: String,
    instance_id: u64,
    cloud_mcp_state: CloudMcpState,
    output_channel: Channel<InvokeResponseBody>,
    mut reader: Box<dyn Read + Send>,
) {
    fn send_terminal_output_frame(
        app: &AppHandle,
        chunk: Vec<u8>,
        pane_id: &str,
        instance_id: u64,
        cloud_mcp_state: &CloudMcpState,
        output_channel: &Channel<InvokeResponseBody>,
    ) -> (bool, f64, f64) {
        if chunk.is_empty() {
            return (true, 0.0, 0.0);
        }

        let observe_started_at = Instant::now();
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
        let observe_schedule_ms = terminal_diagnostic_elapsed_ms(observe_started_at);

        let send_started_at = Instant::now();
        let sent = output_channel.send(InvokeResponseBody::Raw(chunk)).is_ok();
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
        let mut buffer = [0u8; TERMINAL_OUTPUT_READ_BUFFER_BYTES];
        let mut stats_started_at = Instant::now();
        let mut stats_chunks: u64 = 0;
        let mut stats_bytes: u64 = 0;
        let mut stats_slow_sends: u64 = 0;
        let mut stats_total_send_ms = 0.0f64;
        let mut stats_max_send_ms = 0.0f64;
        let mut stats_slow_observer_schedules: u64 = 0;
        let mut stats_total_observer_schedule_ms = 0.0f64;
        let mut stats_max_observer_schedule_ms = 0.0f64;
        let mut forensics_started_at = Instant::now();
        let mut forensics_chunks: u64 = 0;
        let mut forensics_bytes: u64 = 0;
        let mut forensics_total_chunks: u64 = 0;
        let mut forensics_total_bytes: u64 = 0;
        let exit_reason = loop {
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

                    let (sent, send_ms, observer_schedule_ms) = send_terminal_output_frame(
                        &app,
                        chunk.to_vec(),
                        &reader_pane_id,
                        instance_id,
                        &cloud_mcp_state,
                        &output_channel,
                    );
                    forensics_chunks += 1;
                    forensics_bytes += bytes_read as u64;
                    forensics_total_chunks += 1;
                    forensics_total_bytes += bytes_read as u64;
                    if forensics_started_at.elapsed() >= Duration::from_secs(2) {
                        log_terminal_crash_forensics_event(
                            "backend.terminal_reader.output_window",
                            json!({
                                "bytes": forensics_bytes,
                                "chunks": forensics_chunks,
                                "elapsed_ms": terminal_diagnostic_elapsed_ms(forensics_started_at),
                                "instance_id": instance_id,
                                "last_send_ms": send_ms,
                                "last_observer_schedule_ms": observer_schedule_ms,
                                "pane_id": clean_terminal_diagnostic_log_text(&reader_pane_id),
                                "total_bytes": forensics_total_bytes,
                                "total_chunks": forensics_total_chunks,
                            }),
                        );
                        forensics_started_at = Instant::now();
                        forensics_chunks = 0;
                        forensics_bytes = 0;
                    }
                    if terminal_diagnostics_enabled_for_app(&app) {
                        stats_chunks += 1;
                        stats_bytes += bytes_read as u64;
                        stats_total_send_ms += send_ms;
                        stats_max_send_ms = stats_max_send_ms.max(send_ms);
                        stats_total_observer_schedule_ms += observer_schedule_ms;
                        stats_max_observer_schedule_ms =
                            stats_max_observer_schedule_ms.max(observer_schedule_ms);
                        if send_ms >= TERMINAL_DIAGNOSTIC_SLOW_MS {
                            stats_slow_sends += 1;
                            log_terminal_diagnostic_event(
                                &app,
                                "backend.output_channel_send.slow",
                                json!({
                                    "bytes": bytes_read,
                                    "elapsed_ms": send_ms,
                                    "instance_id": instance_id,
                                    "pane_id": clean_terminal_diagnostic_log_text(&reader_pane_id),
                                }),
                            );
                        }
                        if observer_schedule_ms >= TERMINAL_DIAGNOSTIC_SLOW_MS {
                            stats_slow_observer_schedules += 1;
                            log_terminal_diagnostic_event(
                                &app,
                                "backend.output_observer_schedule.slow",
                                json!({
                                    "bytes": bytes_read,
                                    "elapsed_ms": observer_schedule_ms,
                                    "instance_id": instance_id,
                                    "pane_id": clean_terminal_diagnostic_log_text(&reader_pane_id),
                                }),
                            );
                        }

                        if stats_started_at.elapsed() >= Duration::from_secs(1) {
                            log_terminal_diagnostic_event(
                                &app,
                                "backend.output_window",
                                json!({
                                    "bytes": stats_bytes,
                                    "chunks": stats_chunks,
                                    "elapsed_ms": terminal_diagnostic_elapsed_ms(stats_started_at),
                                    "instance_id": instance_id,
                                    "max_send_ms": stats_max_send_ms,
                                    "max_observer_schedule_ms": stats_max_observer_schedule_ms,
                                    "pane_id": clean_terminal_diagnostic_log_text(&reader_pane_id),
                                    "slow_observer_schedules": stats_slow_observer_schedules,
                                    "slow_sends": stats_slow_sends,
                                    "total_observer_schedule_ms": stats_total_observer_schedule_ms,
                                    "total_send_ms": stats_total_send_ms,
                                }),
                            );
                            stats_started_at = Instant::now();
                            stats_chunks = 0;
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
                        log_terminal_crash_forensics_event(
                            "backend.terminal_reader.output_channel_closed",
                            json!({
                                "bytes": bytes_read,
                                "instance_id": instance_id,
                                "pane_id": clean_terminal_diagnostic_log_text(&reader_pane_id),
                                "total_bytes": forensics_total_bytes,
                                "total_chunks": forensics_total_chunks,
                            }),
                        );
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
                cleanup_terminal_instance_async(instance, false, "reader_exit", false);
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
        let cleanup_task = tauri::async_runtime::spawn_blocking(move || {
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
            tauri::async_runtime::spawn(async move {
                let _ = tokio::time::timeout(
                    Duration::from_millis(TERMINAL_CLOSE_COMMAND_WAIT_MS),
                    cleanup_task,
                )
                .await;
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
        let _ = tokio::time::timeout(
            Duration::from_millis(TERMINAL_CLOSE_COMMAND_WAIT_MS),
            cleanup_task,
        )
        .await;

        log_terminal_crash_forensics_event(
            "backend.terminal_close.done",
            json!({
                "instance_id": cleanup_instance_id,
                "cleanup_joined": true,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "wait_for_cleanup": wait_for_cleanup,
            }),
        );
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
) -> Result<usize, String> {
    let instances = {
        let mut terminals = state.terminals.write().await;
        terminals
            .drain()
            .collect::<Vec<(String, TerminalInstance)>>()
    };
    let pty_pool = Arc::clone(&state.pty_pool);
    let warm_ptys = pty_pool.drain_for_shutdown();
    let closed = instances.len();
    let total = closed;
    let warm_total = warm_ptys.len();
    log_terminal_crash_forensics_event(
        "backend.terminal_close_all.begin",
        json!({
            "active_count": closed,
            "warm_count": warm_total,
        }),
    );
    let coordination_cleanups = instances
        .iter()
        .filter_map(|(_, instance)| terminal_shutdown_coordination_cleanup_from_instance(instance))
        .collect::<Vec<_>>();

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

    emit_terminal_close_all_progress(&app, 0, total, None, None);

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

            thread::spawn(move || {
                let instance_id = instance.id;
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

        {
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
        let mut login_closed = None;
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
            pty_pool.wait_for_refill_idle();
        }
        cleanup_windows_headless_console_hosts();
        log_terminal_crash_forensics_event(
            "backend.terminal_close_all.done",
            json!({
                "active_done": active_done,
                "active_total": total,
                "login_done": login_closed.is_some(),
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
    let workspace_id = request.workspace_id;
    let workspace_name = request.workspace_name;
    let terminal_index = request.terminal_index;
    let thread_id = request.thread_id;
    let requested_slot_key = request.slot_key;
    let terminal_slot_key =
        terminal_slot_key_from_request(&pane_id, terminal_index, requested_slot_key.as_deref())?;
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
            "terminal_index": terminal_index,
            "thread_id": thread_id
                .as_deref()
                .map(clean_terminal_diagnostic_log_text),
        }),
    );

    let preserve_coordination_session =
        request.preserve_coordination_session.unwrap_or(false) && !plain_shell && !fresh_session;
    let _ = close_terminal_session(
        &state,
        Some(cloud_mcp_state.inner()),
        &pane_id,
        None,
        preserve_coordination_session,
        fresh_session,
    )
    .await
    .unwrap_or(false);

    let working_directory =
        match resolve_workspace_root_directory(working_directory_request.as_deref()) {
            Ok(working_directory) => working_directory,
            Err(error) => {
                return Err(error);
            }
        };
    let mut process_working_directory = workspace_path_for_process(&working_directory);
    let mut launch_worktree: Option<Value> = None;
    let mut coordination_context: Option<crate::coordination::models::TerminalCoordinationContext> =
        None;

    let is_prewarm_pty = is_terminal_prewarm_kind(&kind);
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
    let terminal_launch_epoch = format!("{pane_id}:{instance_id}");
    if plain_shell {
    } else if !is_prewarm_pty {
        ensure_workspace_git_bootstrap_for_terminal(&working_directory).await?;

        let coordination_pty_id = if fresh_session {
            format!("{pane_id}-fresh-{instance_id}")
        } else {
            pane_id.clone()
        };
        let (context, worktree, prepared_working_directory) = prepare_terminal_coordination_launch(
            coordination_pty_id,
            terminal_launch_epoch,
            working_directory.clone(),
            kind.clone(),
            provider_for_coordination.clone(),
            label.clone(),
            terminal_slot_key.clone(),
            workspace_id.clone(),
            workspace_name.clone(),
        )
        .await?;
        process_working_directory = prepared_working_directory;
        launch_worktree = Some(worktree);
        coordination_context = Some(context);
    }

    let size = terminal_size_from_request(requested_cols, requested_rows)?;

    let mut command = "prepared-shell".to_string();
    let mut agent_started = false;
    let terminal_coordination = coordination_context
        .as_ref()
        .map(terminal_coordination_session_from_context);

    let shell_pty = is_prewarm_pty || plain_shell;
    let warm_pty = if shell_pty {
        match create_warm_shell_pty_in_directory(size, &process_working_directory) {
            Ok(warm_pty) => warm_pty,
            Err(error) => {
                return Err(error);
            }
        }
    } else {
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
        let launch_args = terminal_args_with_codex_mcp_identity(
            launch_provider_id,
            &args,
            terminal_coordination.as_ref(),
            &pane_id,
            instance_id,
        );
        validate_terminal_agent_launch_args_for_platform(launch_provider_id, &launch_args)?;
        let coordination_env_vars = terminal_coordination
            .as_ref()
            .map(|coordination| coordination.env_vars.as_slice())
            .unwrap_or(&[]);
        let launch_env_vars =
            terminal_env_vars_with_opencode_tui_config(launch_provider_id, coordination_env_vars)?;

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
        terminal_metadata,
    );

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
        );
    }

    spawn_terminal_reader(
        app.clone(),
        Arc::clone(&state.terminals),
        pane_id.clone(),
        instance_id,
        cloud_mcp_state.inner().clone(),
        output_channel,
        reader,
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
        project_root: workspace_path_display(&working_directory),
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
    })
}

#[tauri::command]
async fn terminal_recover_crashed_sessions(roots: Option<Vec<String>>) -> Result<Value, String> {
    let mut requested_roots = roots.unwrap_or_default();

    if requested_roots.is_empty() {
        requested_roots.push(String::new());
    }

    let mut seen_roots = HashSet::new();
    let mut workspace_reports = Vec::new();
    let mut interrupted_tasks = Vec::new();
    let mut errors = Vec::new();
    let mut scanned_sessions = 0u64;
    let mut idle_sessions_interrupted = 0u64;
    let mut finished_sessions_interrupted = 0u64;

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
        let root_key = workspace_path_display(&working_directory);

        if !seen_roots.insert(root_key.clone()) {
            continue;
        }

        match crate::coordination::CoordinationKernel::init(&working_directory, None)
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
                            object.insert("repoPath".to_string(), json!(root_key.clone()));
                        }
                        interrupted_tasks.push(task.clone());
                    }
                }

                if let Some(object) = report.as_object_mut() {
                    object.insert("repoPath".to_string(), json!(root_key));
                }
                workspace_reports.push(report);
            }
            Err(error) => {
                errors.push(json!({
                    "root": root_key,
                    "error": clean_terminal_telemetry_text(&error),
                }));
            }
        }
    }

    Ok(json!({
        "interruptedTasks": interrupted_tasks,
        "idleSessionsInterrupted": idle_sessions_interrupted,
        "finishedSessionsInterrupted": finished_sessions_interrupted,
        "scannedSessions": scanned_sessions,
        "workspaceReports": workspace_reports,
        "errors": errors,
    }))
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
    if instance.coordination.is_none() {
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
    let launch_args = terminal_args_with_codex_mcp_identity(
        definition.id,
        &args,
        instance.coordination.as_ref(),
        &pane_id,
        instance.id,
    );
    validate_terminal_agent_launch_args_for_platform(definition.id, &launch_args)?;
    let coordination_env_vars = instance
        .coordination
        .as_ref()
        .map(|coordination| coordination.env_vars.as_slice())
        .unwrap_or(&[]);
    let launch_env_vars =
        terminal_env_vars_with_opencode_tui_config(definition.id, coordination_env_vars)?;
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
    _cloud_mcp_state: CloudMcpState,
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

    if instance_id.is_some_and(|expected_id| expected_id != instance.id) {
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id,
            started: false,
            skipped: true,
            message: "Terminal session was replaced before agent start.".to_string(),
        };
    }

    if instance.coordination.is_none() {
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
        let coordination_env_vars = instance
            .coordination
            .as_ref()
            .map(|coordination| coordination.env_vars.as_slice())
            .unwrap_or(&[]);
        let launch_env_vars =
            match terminal_env_vars_with_opencode_tui_config(definition.id, coordination_env_vars)
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
                gate.cursor_position =
                    terminal_input_gate_next_word_boundary(&gate.current_line, gate.cursor_position);
            } else {
                gate.cursor_position = (gate.cursor_position + amount)
                    .min(terminal_input_gate_line_char_len(gate));
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
    let data = if data.contains(TERMINAL_ENTER_SEQUENCE)
        || data.contains(TERMINAL_ENTER_SEQUENCE_MOD1)
    {
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
                    gate.cursor_position = (gate.cursor_position + 1)
                        .min(terminal_input_gate_line_char_len(gate));
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
                    gate.cursor_position =
                        terminal_input_gate_next_word_boundary(&gate.current_line, gate.cursor_position);
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
                let start = gate.cursor_position.min(terminal_input_gate_line_char_len(gate));
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

fn terminal_write_data_diagnostic(data: &str) -> Value {
    json!({
        "contains_enter_sequence": data.contains(TERMINAL_ENTER_SEQUENCE),
        "contains_enter_sequence_mod1": data.contains(TERMINAL_ENTER_SEQUENCE_MOD1),
        "contains_shift_enter_sequence": data.contains(TERMINAL_SHIFT_ENTER_SEQUENCE),
        "data_len": data.len(),
        "has_backspace": data.contains('\u{8}') || data.contains('\u{7f}'),
        "has_carriage_return": data.contains('\r'),
        "has_escape": data.contains('\u{1b}'),
        "has_line_feed": data.contains('\n'),
        "is_only_submit": matches!(data, "\r" | "\n"),
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
    let has_prompt_event = terminal_input_write_has_prompt_event(prompt_event_id, prompt_event_text);
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
        .filter(|index| {
            *index == 0 || data.as_bytes().get(index.saturating_sub(1)) != Some(&0x1b)
        })
        .min()
}

fn strip_bare_terminal_color_reply_input(data: &str) -> Option<String> {
    let mut cursor = 0;
    let mut output = String::new();
    let mut changed = false;

    while cursor < data.len() {
        let Some(mut start) = find_bare_terminal_color_reply_start(&data[cursor..])
            .map(|index| cursor + index)
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

fn is_terminal_model_picker_ui_prompt(prompt: &str) -> bool {
    let text = normalize_terminal_control_prompt_text(prompt);
    if text.is_empty() {
        return false;
    }

    if is_numbered_terminal_model_picker_row(&text) {
        return true;
    }

    let lower = text.to_ascii_lowercase();
    lower.contains("press enter to confirm") && lower.contains("esc") && lower.contains("go back")
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
            .or_else(|| {
                slot_key
                    .as_deref()
                    .map(terminal_waiting_slot_label)
            });
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
    let active_lease_count = kernel
        .query_json(
            "SELECT COUNT(1) AS active_lease_count
             FROM leases
             WHERE task_id=?1 AND status='active'",
            &[&task_id],
        )?
        .first()
        .and_then(|row| row["active_lease_count"].as_i64())
        .unwrap_or(0);

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
        && active_lease_count == 0
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
    _repo_path: PathBuf,
    _db_path: PathBuf,
    event_type: String,
    refs: crate::coordination::kernel::EventRefs,
    payload: Value,
) {
    if !matches!(
        event_type.as_str(),
        "task_claimed"
            | "mcp_agent_tool_called"
            | "task_parked_for_resource_queue"
            | "active_file_lease_queue_waiter_released"
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
        "active_file_lease_queue_waiter_released" => "task.resume_ready",
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
        "active_file_lease_queue_waiter_released" => {
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
        .find(|parked| parked.task_id == task_id)
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
            if ready {
                prompt_to_resume = Some(existing.clone());
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
    mark_terminal_parked_prompt_lifecycle_in_cloud(app, cloud_mcp_state, parked, "interrupted", body)
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

    let Some(parked) = parked_prompts.write().await.remove(&parked_key) else {
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
        terminal_emit_parked_prompt_interrupted(
            &app,
            &cloud_mcp_state,
            &parked,
            "terminal_missing",
            "Interrupted while parked: the terminal disappeared before the task could resume.",
        )
        .await;
        return false;
    };

    if instance.id != parked.instance_id {
        terminal_emit_parked_prompt_interrupted(
            &app,
            &cloud_mcp_state,
            &parked,
            "terminal_replaced",
            "Interrupted while parked: the terminal session was replaced before the task could resume.",
        )
        .await;
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
        "running",
        "Dependency completed; the parked task is resuming in the terminal.",
    )
    .await;
    emit_terminal_parked_prompt_event(&app, &parked, "resumed", Some("dependency_ready"));
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
        let app = app_handle.clone();

        tauri::async_runtime::spawn(async move {
            let pane_id = payload.pane_id.clone();
            let instance_id = payload.instance_id;
            let state = app.state::<TerminalState>();
            let cloud_mcp_state = app.state::<CloudMcpState>();
            if let Err(error) = terminal_write_inner(
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
                payload.thread_id,
            )
            .await
            {
                emit_terminal_input_error(&app, pane_id, instance_id, error);
            }
        });
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
    thread_id: Option<String>,
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
        if let Some(coordination) = instance.coordination.clone() {
            let readiness = tauri::async_runtime::spawn_blocking(move || {
                ensure_terminal_coordination_ready_for_prompt(&coordination)
            })
            .await
            .map_err(|error| {
                format!("Unable to validate coordination session before prompt submit: {error}")
            })?;
            if let Err(error) = readiness {
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
    let input_write_result = write_terminal_input(
        Some(&app),
        state,
        &pane_id,
        instance_id,
        &data,
        "terminal.write.skipped_stale_or_missing",
    )
    .await?;
    let input_write_elapsed_ms = terminal_diagnostic_elapsed_ms(input_write_started_at);
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
        emit_terminal_prompt_submitted(
            &app,
            &instance,
            &event_prompt,
            prompt_event_id.as_deref(),
            prompt_event_revision,
            prompt_event_source.as_deref(),
            prompt_event_submitted_at.as_deref(),
            requested_event_prompt.as_deref(),
            Some(&prompt),
            prompt_event_text_matches_observed,
            if prompt_event_text_matches_observed {
                "observed_input_gate"
            } else {
                "observed_input_gate_mismatch"
            },
            thread_id.as_deref(),
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
                "submitted_event_prompt_source": "observed_input_gate",
                "thread_id": thread_id.as_deref().unwrap_or_default(),
            },
        }));
        if *instance.agent_started.lock().await {
            let cloud_state = cloud_mcp_state.clone();
            let pane_id_for_context = pane_id.clone();
            let working_directory = instance.working_directory.as_ref().clone();
            let coordination = instance.coordination.clone();
            let terminal_instance_id = instance.id;
            let active_task = instance.active_task.lock().await.clone();
            let local_task_id = active_task.as_ref().map(|task| task.task_id.clone());
            let local_task_title = active_task.as_ref().map(|task| task.title.clone());
            let metadata = instance.metadata.clone();
            let prompt_metadata = CloudMcpTerminalPromptMetadata {
                prompt_event_id: prompt_event_id.clone(),
                prompt_event_source: prompt_event_source.clone(),
                prompt_event_submitted_at: prompt_event_submitted_at.clone(),
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
        if let Some(event_prompt) = prompt_event_text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
        {
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
            emit_terminal_prompt_submitted(
                &app,
                &instance,
                &event_prompt,
                prompt_event_id.as_deref(),
                prompt_event_revision,
                prompt_event_source.as_deref(),
                prompt_event_submitted_at.as_deref(),
                Some(&event_prompt),
                None,
                false,
                "prompt_event_text_unobserved",
                thread_id.as_deref(),
            );
            if *instance.agent_started.lock().await {
                let cloud_state = cloud_mcp_state.clone();
                let pane_id_for_context = pane_id.clone();
                let working_directory = instance.working_directory.as_ref().clone();
                let coordination = instance.coordination.clone();
                let terminal_instance_id = instance.id;
                let active_task = instance.active_task.lock().await.clone();
                let local_task_id = active_task.as_ref().map(|task| task.task_id.clone());
                let local_task_title = active_task.as_ref().map(|task| task.title.clone());
                let metadata = instance.metadata.clone();
                let prompt_metadata = CloudMcpTerminalPromptMetadata {
                    prompt_event_id: prompt_event_id.clone(),
                    prompt_event_source: prompt_event_source.clone(),
                    prompt_event_submitted_at: prompt_event_submitted_at.clone(),
                    terminal_index: metadata.terminal_index,
                    thread_id: thread_id
                        .clone()
                        .or_else(|| Some(metadata.thread_id.clone())),
                    workspace_id: metadata.workspace_id.clone(),
                    workspace_name: metadata.workspace_name.clone(),
                };
                tauri::async_runtime::spawn(async move {
                    cloud_mcp_terminal_context_pack_for_prompt(
                        cloud_state,
                        pane_id_for_context,
                        terminal_instance_id,
                        working_directory,
                        coordination,
                        local_task_id,
                        local_task_title,
                        event_prompt,
                        Some(prompt_metadata),
                    )
                    .await;
                });
            }
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
        thread_id,
    )
    .await
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
            return Err(format!("Unable to write terminal selection delete: {error}"));
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
            return Err(format!("Unable to flush terminal selection delete: {error}"));
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
) -> Result<(), String> {
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
    Ok(())
}

#[tauri::command]
async fn terminal_interrupt_agent(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    pane_id: String,
    instance_id: Option<u64>,
    reason: Option<String>,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
    let Some(instance) = get_terminal_instance_if_current(&state, &pane_id, instance_id).await?
    else {
        return Ok(());
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
        let close_context = TerminalCloudMcpCloseContext::from_instance(&instance);
        cloud_mcp_mark_terminal_context_interrupted(
            cloud_mcp_state.inner(),
            &pane_id,
            instance.id,
            &close_context,
            &reason,
            "Interrupted by Escape before an active task was attached; clearing terminal presence.",
        )
        .await;
    }
    interrupt_terminal_parked_prompts(
        &app,
        state.inner(),
        cloud_mcp_state.inner(),
        &pane_id,
        &instance,
        &reason,
        active_task_id.as_deref(),
    )
    .await?;

    Ok(())
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
    let closed = close_all_terminal_sessions(app, &state, cloud_mcp_state.inner()).await?;

    Ok(TerminalCloseAllResult { closed })
}

#[cfg(test)]
mod terminal_tests {
    use super::*;

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

        let args = terminal_args_with_codex_mcp_identity(
            "codex",
            &["--model".to_string(), "gpt-5.2".to_string()],
            Some(&coordination),
            "pane-auto",
            42,
        );

        assert!(args
            .windows(2)
            .any(|pair| pair == ["--ask-for-approval", "never"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "workspace-write"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--cd", "/tmp/diffforge-agent-worktree"]));
        assert!(args
            .iter()
            .any(|arg| { arg.starts_with("mcp_servers.coordination-kernel.args=") }));
        assert!(args
            .iter()
            .any(|arg| arg.contains("--coordination-mcp-proxy")));
        assert!(!args.iter().any(|arg| arg.contains("--coordination-mcp''")));
        assert!(args
            .iter()
            .any(|arg| { arg.starts_with("mcp_servers.coordination-kernel.command=") }));
        assert!(args.iter().any(|arg| {
            arg.starts_with("mcp_servers.coordination-kernel.tools.start_task.approval_mode=")
        }));
        assert!(!args
            .iter()
            .any(|arg| { arg.starts_with("mcp_servers.cloud-diffforge.args=") }));
        assert_eq!(
            args.iter()
                .filter(|arg| arg.as_str() == "--no-alt-screen")
                .count(),
            1
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
        coordination
            .env_vars
            .push(("CLAUDE_MCP_CONFIG".to_string(), claude_config_path.clone()));

        let args = terminal_args_with_codex_mcp_identity(
            "claude",
            &["--model".to_string(), "sonnet".to_string()],
            Some(&coordination),
            "pane-auto",
            42,
        );

        assert!(args
            .windows(2)
            .any(|pair| pair == ["--add-dir", coordination.repo_path.as_str()]));
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
        ] {
            assert!(allowed_tools.split(',').any(|allowed| allowed == tool));
        }
        let mcp_config = args
            .windows(2)
            .find_map(|pair| (pair[0] == "--mcp-config").then(|| pair[1].as_str()))
            .unwrap();
        assert_eq!(mcp_config, claude_config_path);
        assert!(!mcp_config.contains("\"coordination-kernel\""));
        assert!(!mcp_config.contains("terminal_launch_args"));
        assert!(!args
            .iter()
            .any(|arg| arg == "--dangerously-skip-permissions"));
        assert!(!args.iter().any(|arg| arg == "--no-alt-screen"));
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

        assert!(env_vars
            .iter()
            .any(|(key, value)| key == "COORDINATION_ENABLED" && value == "1"));
        let config_paths = env_vars
            .iter()
            .filter_map(|(key, value)| (key == OPENCODE_TUI_CONFIG_ENV).then_some(value))
            .collect::<Vec<_>>();
        assert_eq!(config_paths.len(), 1);
        let config: Value =
            serde_json::from_str(&fs::read_to_string(config_paths[0]).unwrap()).unwrap();
        assert_eq!(config["$schema"].as_str(), Some("https://opencode.ai/tui.json"));
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
    fn coordinated_codex_launch_respects_explicit_approval_flags() {
        let mut coordination = terminal_test_coordination("codex_existing_approval_args");
        coordination.env_vars.push((
            "COORDINATION_AGENT_BRANCH_ROOT".to_string(),
            "/tmp/diffforge-agent-worktree".to_string(),
        ));
        let base = vec![
            "--ask-for-approval".to_string(),
            "on-request".to_string(),
            "--sandbox".to_string(),
            "read-only".to_string(),
            "--cd".to_string(),
            "/tmp/custom-cwd".to_string(),
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
            1
        );
        assert_eq!(args.iter().filter(|arg| arg.as_str() == "--cd").count(), 1);
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--ask-for-approval", "on-request"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "read-only"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--cd", "/tmp/custom-cwd"]));
    }
}

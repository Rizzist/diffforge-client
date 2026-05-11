fn terminal_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn terminal_telemetry_log_path() -> PathBuf {
    let tauri_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = tauri_root
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(tauri_root);

    project_root
        .join(TERMINAL_TELEMETRY_LOG_DIR)
        .join(TERMINAL_TELEMETRY_LOG_FILE)
}

fn clean_terminal_telemetry_text(value: &str) -> String {
    value
        .replace(|character: char| character.is_control(), " ")
        .trim()
        .chars()
        .take(TERMINAL_TELEMETRY_MAX_TEXT)
        .collect()
}

fn write_terminal_telemetry_entries(entries: Vec<Value>) {
    if !TERMINAL_TELEMETRY_LOGGING_ENABLED || entries.is_empty() {
        return;
    }

    let log_path = terminal_telemetry_log_path();
    let Some(log_dir) = log_path.parent() else {
        return;
    };

    if fs::create_dir_all(log_dir).is_err() {
        return;
    }

    let lock = TERMINAL_TELEMETRY_LOCK.get_or_init(|| StdMutex::new(()));
    let Ok(_guard) = lock.lock() else {
        return;
    };

    let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    else {
        return;
    };

    for entry in entries {
        let _ = writeln!(file, "{entry}");
    }
}

fn write_terminal_telemetry(entry: Value) {
    write_terminal_telemetry_entries(vec![entry]);
}

fn log_terminal_event(
    phase: &str,
    pane_id: Option<&str>,
    instance_id: Option<u64>,
    elapsed: Option<Duration>,
    fields: Value,
) {
    write_terminal_telemetry(json!({
        "ts_ms": terminal_now_ms(),
        "phase": clean_terminal_telemetry_text(phase),
        "pane_id": pane_id.map(clean_terminal_telemetry_text),
        "instance_id": instance_id,
        "elapsed_ms": elapsed.map(|duration| duration.as_secs_f64() * 1000.0),
        "fields": fields,
    }));
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
) -> Result<(Vec<String>, Vec<String>, String), String> {
    let provider = match kind {
        "console" => provider
            .as_deref()
            .map(parse_agent_provider)
            .transpose()?
            .unwrap_or(AgentProvider::Codex),
        "codex" => AgentProvider::Codex,
        "claude" => AgentProvider::Claude,
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

fn emit_terminal_audio_input_refocus(app: &AppHandle, target: &TerminalAudioInputTarget) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }

    let _ = app.emit(
        TERMINAL_AUDIO_INPUT_REFOCUS_EVENT,
        TerminalAudioInputRefocusPayload {
            pane_id: target.pane_id.clone(),
            instance_id: target.instance_id,
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
    state: &TerminalState,
    pane_id: &str,
    instance_id: Option<u64>,
    data: &str,
    skipped_phase: &str,
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
        log_terminal_event(
            skipped_phase,
            Some(pane_id),
            instance_id,
            None,
            json!({ "bytes": data.len() }),
        );
        return Ok(false);
    };
    let mut writer = instance.writer.lock().await;

    writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("Unable to write terminal input: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("Unable to flush terminal input: {error}"))?;

    Ok(true)
}

async fn write_to_active_terminal_audio_input_target(
    app: &AppHandle,
    state: &TerminalState,
    data: &str,
) -> Result<bool, String> {
    let Some(target) = active_terminal_audio_input_target(state)? else {
        return Ok(false);
    };

    if !app_has_focused_audio_input_window(app) {
        log_terminal_event(
            "terminal.audio_input.skipped_app_unfocused",
            Some(&target.pane_id),
            target.instance_id,
            None,
            json!({ "bytes": data.len() }),
        );
        clear_terminal_audio_input_target_if_matches(
            state,
            &target.pane_id,
            target.instance_id,
        )?;
        return Ok(false);
    }

    let wrote = write_terminal_input(
        state,
        &target.pane_id,
        target.instance_id,
        data,
        "terminal.audio_input.skipped_stale_or_missing",
    )
    .await?;

    if wrote {
        emit_terminal_audio_input_refocus(app, &target);
    } else {
        clear_terminal_audio_input_target_if_matches(
            state,
            &target.pane_id,
            target.instance_id,
        )?;
    }

    Ok(wrote)
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

impl TerminalKillReport {
    fn to_json(&self) -> Value {
        json!({
            "pid": self.pid,
            "taskkill_exit_code": self.taskkill_exit_code,
            "taskkill_success": self.taskkill_success,
            "taskkill_error": self.taskkill_error,
            "child_kill_ok": self.child_kill_ok,
            "child_kill_error": self.child_kill_error,
        })
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

fn terminal_coordination_session_from_context(
    context: &crate::coordination::models::TerminalCoordinationContext,
) -> TerminalCoordinationSession {
    TerminalCoordinationSession {
        repo_path: context.repo_path.clone(),
        db_path: context.db_path.clone(),
        agent_id: context.agent_id.clone(),
        session_id: context.session_id.clone(),
        env_vars: context.env_vars(),
    }
}

fn interrupt_terminal_coordination_session(
    coordination: &TerminalCoordinationSession,
    pane_id: Option<&str>,
    instance_id: Option<u64>,
    reason: &str,
) {
    let interrupt_started_at = Instant::now();
    match crate::coordination::CoordinationKernel::open(
        &coordination.repo_path,
        Some(PathBuf::from(&coordination.db_path)),
    )
    .and_then(|kernel| kernel.interrupt_session(&coordination.session_id, reason).map(|_| ()))
    {
        Ok(()) => {
            log_terminal_event(
                "terminal.coordination_session_interrupted",
                pane_id,
                instance_id,
                Some(interrupt_started_at.elapsed()),
                json!({
                    "agent_id": clean_terminal_telemetry_text(&coordination.agent_id),
                    "session_id": clean_terminal_telemetry_text(&coordination.session_id),
                    "reason": clean_terminal_telemetry_text(reason),
                }),
            );
        }
        Err(error) => {
            log_terminal_event(
                "terminal.coordination_session_interrupt_error",
                pane_id,
                instance_id,
                Some(interrupt_started_at.elapsed()),
                json!({
                    "agent_id": clean_terminal_telemetry_text(&coordination.agent_id),
                    "session_id": clean_terminal_telemetry_text(&coordination.session_id),
                    "reason": clean_terminal_telemetry_text(reason),
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );
        }
    }
}

fn cleanup_terminal_instance_with_context(
    instance: TerminalInstance,
    kill_first: bool,
    pane_id: Option<String>,
    reason: &'static str,
) {
    let cleanup_started_at = Instant::now();
    let TerminalInstance {
        id: instance_id,
        child,
        master,
        writer,
        size,
        working_directory,
        agent_started,
        input_gate,
        active_task,
        coordination,
    } = instance;

    log_terminal_event(
        "terminal.cleanup.start",
        pane_id.as_deref(),
        Some(instance_id),
        None,
        json!({
            "app_pid": std::process::id(),
            "kill_first": kill_first,
            "reason": reason,
        }),
    );

    if let Some(coordination) = coordination.as_ref() {
        interrupt_terminal_coordination_session(
            coordination,
            pane_id.as_deref(),
            Some(instance_id),
            reason,
        );
    }

    let maybe_child = {
        let mut child = child.blocking_lock();
        child.take()
    };
    let Some(mut child) = maybe_child else {
        drop(writer);
        drop(master);
        drop(size);
        drop(working_directory);
        drop(agent_started);
        drop(input_gate);
        drop(active_task);
        drop(coordination);
        log_terminal_event(
            "terminal.cleanup.no_child",
            pane_id.as_deref(),
            Some(instance_id),
            Some(cleanup_started_at.elapsed()),
            json!({
                "app_pid": std::process::id(),
                "reason": reason,
            }),
        );
        return;
    };
    let pid = child.process_id();
    let mut initial_exit_observed = false;
    let mut final_exit_observed;
    let mut primary_kill = None;
    let mut fallback_kill = None;

    if kill_first {
        primary_kill = Some(kill_terminal_process_tree(child.as_mut()));
    } else {
        initial_exit_observed = poll_terminal_child_exit(child.as_mut());

        if !initial_exit_observed {
            primary_kill = Some(kill_terminal_process_tree(child.as_mut()));
        }
    }

    final_exit_observed = poll_terminal_child_exit(child.as_mut());

    if !final_exit_observed {
        fallback_kill = Some(kill_terminal_process_tree(child.as_mut()));
        final_exit_observed = poll_terminal_child_exit(child.as_mut());
    }

    log_terminal_event(
        "terminal.cleanup.done",
        pane_id.as_deref(),
        Some(instance_id),
        Some(cleanup_started_at.elapsed()),
        json!({
            "app_pid": std::process::id(),
            "fallback_kill": fallback_kill.as_ref().map(TerminalKillReport::to_json),
            "final_exit_observed": final_exit_observed,
            "initial_exit_observed": initial_exit_observed,
            "kill_first": kill_first,
            "pid": pid,
            "primary_kill": primary_kill.as_ref().map(TerminalKillReport::to_json),
            "reason": reason,
        }),
    );

    drop(child);
    drop(writer);
    drop(master);
    drop(size);
    drop(working_directory);
    drop(agent_started);
    drop(input_gate);
    drop(active_task);
    drop(coordination);
}

fn cleanup_terminal_instance_async(
    instance: TerminalInstance,
    kill_first: bool,
    pane_id: Option<String>,
    reason: &'static str,
) {
    thread::spawn(move || {
        cleanup_terminal_instance_with_context(instance, kill_first, pane_id, reason);
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

fn spawn_terminal_reader(
    app: AppHandle,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    pane_id: String,
    instance_id: u64,
    cloud_mcp_state: CloudMcpState,
    output_channel: Channel<InvokeResponseBody>,
    mut reader: Box<dyn Read + Send>,
) {
    let (output_tx, mut output_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let reader_pane_id = pane_id.clone();

    thread::spawn(move || {
        log_terminal_event(
            "terminal.reader.thread_start",
            Some(&reader_pane_id),
            Some(instance_id),
            None,
            json!({}),
        );

        let mut buffer = [0u8; TERMINAL_OUTPUT_READ_BUFFER_BYTES];
        let mut saw_first_output = false;

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(bytes_read) => {
                    if !saw_first_output {
                        saw_first_output = true;
                        log_terminal_event(
                            "terminal.reader.first_output",
                            Some(&reader_pane_id),
                            Some(instance_id),
                            None,
                            json!({ "bytes": bytes_read }),
                        );
                    }

                    if output_tx.send(buffer[..bytes_read].to_vec()).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    log_terminal_event(
                        "terminal.reader.error",
                        Some(&reader_pane_id),
                        Some(instance_id),
                        None,
                        json!({ "error": clean_terminal_telemetry_text(&error.to_string()) }),
                    );
                    break;
                }
            }
        }

        log_terminal_event(
            "terminal.reader.closed",
            Some(&reader_pane_id),
            Some(instance_id),
            None,
            json!({ "saw_first_output": saw_first_output }),
        );
    });

    tauri::async_runtime::spawn(async move {
        let mut ticker = interval(Duration::from_micros(TERMINAL_OUTPUT_FRAME_MICROS));
        ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut pending = Vec::with_capacity(TERMINAL_OUTPUT_READ_BUFFER_BYTES * 2);
        let mut reader_closed = false;
        let mut flushed_chunks = 0usize;
        let mut flushed_bytes = 0usize;
        let mut channel_failed = false;

        loop {
            tokio::select! {
                maybe_chunk = output_rx.recv(), if !reader_closed => {
                    match maybe_chunk {
                        Some(chunk) => pending.extend_from_slice(&chunk),
                        None => reader_closed = true,
                    }
                }
                _ = ticker.tick() => {
                    while let Ok(chunk) = output_rx.try_recv() {
                        pending.extend_from_slice(&chunk);
                    }

                    if !pending.is_empty() {
                        let bytes = pending.len();
                        let chunk = std::mem::take(&mut pending);
                        let observer_state = cloud_mcp_state.clone();
                        let observer_pane_id = pane_id.clone();
                        let observer_chunk = chunk.clone();
                        tauri::async_runtime::spawn(async move {
                            cloud_mcp_observe_terminal_output(
                                observer_state,
                                &observer_pane_id,
                                instance_id,
                                &observer_chunk,
                            )
                            .await;
                        });

                        if output_channel.send(InvokeResponseBody::Raw(chunk)).is_err() {
                            channel_failed = true;
                            break;
                        }

                        flushed_chunks += 1;
                        flushed_bytes += bytes;
                    }

                    if reader_closed {
                        break;
                    }
                }
            }
        }

        if !channel_failed && !pending.is_empty() {
            let bytes = pending.len();

            if output_channel
                .send(InvokeResponseBody::Raw(std::mem::take(&mut pending)))
                .is_ok()
            {
                flushed_chunks += 1;
                flushed_bytes += bytes;
            }
        }

        log_terminal_event(
            "terminal.reader.frame_flush_closed",
            Some(&pane_id),
            Some(instance_id),
            None,
            json!({
                "channel_failed": channel_failed,
                "flushed_bytes": flushed_bytes,
                "flushed_chunks": flushed_chunks,
                "frame_micros": TERMINAL_OUTPUT_FRAME_MICROS,
            }),
        );

        if let Some(instance) = remove_terminal_instance_if_current(&terminals, &pane_id, instance_id)
            .await
        {
            cleanup_terminal_instance_async(
                instance,
                false,
                Some(pane_id.clone()),
                "reader_exit",
            );
        }

        let _ = app.emit(
            "forge-terminal-exit",
            TerminalExitPayload {
                pane_id,
                instance_id,
                exit_code: None,
                exited_at_ms: terminal_now_ms(),
            },
        );
    });
}

async fn close_terminal_session(
    state: &TerminalState,
    pane_id: &str,
    instance_id: Option<u64>,
) -> Result<bool, String> {
    validate_terminal_pane_id(pane_id)?;

    let instance = {
        let mut terminals = state.terminals.write().await;

        if let Some(expected_id) = instance_id {
            let is_current = terminals
                .get(pane_id)
                .map(|instance| instance.id == expected_id)
                .unwrap_or(false);

            if !is_current {
                return Ok(false);
            }
        }

        terminals.remove(pane_id)
    };

    if let Some(instance) = instance {
        let cleanup_started_at = Instant::now();
        let cleanup_instance_id = instance.id;
        let cleanup_pane_id = pane_id.to_string();
        let cleanup_task = tauri::async_runtime::spawn_blocking(move || {
            cleanup_terminal_instance_with_context(
                instance,
                true,
                Some(cleanup_pane_id),
                "terminal_close",
            );
        });
        let mut join_error = None;
        let cleanup_finished = match tokio::time::timeout(
            Duration::from_millis(TERMINAL_CLOSE_COMMAND_WAIT_MS),
            cleanup_task,
        )
        .await
        {
            Ok(Ok(())) => true,
            Ok(Err(error)) => {
                join_error = Some(clean_terminal_telemetry_text(&error.to_string()));
                false
            }
            Err(_) => false,
        };
        log_terminal_event(
            "terminal.close.cleanup_wait",
            Some(pane_id),
            Some(cleanup_instance_id),
            Some(cleanup_started_at.elapsed()),
            json!({
                "app_pid": std::process::id(),
                "cleanup_finished": cleanup_finished,
                "detached": !cleanup_finished,
                "join_error": join_error,
                "timeout_ms": TERMINAL_CLOSE_COMMAND_WAIT_MS,
            }),
        );

        return Ok(true);
    }

    Ok(false)
}

async fn close_all_terminal_sessions(
    app: AppHandle,
    state: &TerminalState,
) -> Result<usize, String> {
    let close_started_at = Instant::now();
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

    emit_terminal_close_all_progress(&app, 0, total, None, None);

    log_terminal_event(
        "terminal.close_all.start",
        None,
        None,
        None,
        json!({
            "active_count": closed,
            "app_pid": std::process::id(),
            "warm_count": warm_total,
        }),
    );

    let cleanup_summary = tauri::async_runtime::spawn_blocking(move || {
        enum CleanupSignal {
            Active,
            Warm,
            Login(usize),
        }

        let cleanup_started_at = Instant::now();
        let closed_count = Arc::new(AtomicUsize::new(0));
        let (cleanup_tx, cleanup_rx) = std::sync::mpsc::channel::<CleanupSignal>();

        for (pane_id, instance) in instances {
            let app = app.clone();
            let cleanup_tx = cleanup_tx.clone();
            let closed_count = Arc::clone(&closed_count);

            thread::spawn(move || {
                let instance_id = instance.id;

                cleanup_terminal_instance_with_context(
                    instance,
                    true,
                    Some(pane_id.clone()),
                    "close_all",
                );
                let closed = closed_count.fetch_add(1, Ordering::Relaxed) + 1;
                log_terminal_event(
                    "terminal.close_all.cleanup_done",
                    Some(&pane_id),
                    Some(instance_id),
                    None,
                    json!({}),
                );
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
                cleanup_warm_pty_with_context(warm_pty, "close_all");
                let _ = cleanup_tx.send(CleanupSignal::Warm);
            });
        }

        {
            let cleanup_tx = cleanup_tx.clone();

            thread::spawn(move || {
                let login_closed = cleanup_login_terminal_children_with_context("close_all");
                let _ = cleanup_tx.send(CleanupSignal::Login(login_closed));
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
                Ok(CleanupSignal::Active) => active_done += 1,
                Ok(CleanupSignal::Warm) => warm_done += 1,
                Ok(CleanupSignal::Login(closed)) => login_closed = Some(closed),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    timed_out = true;
                    break;
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        let refill_idle = if timed_out {
            false
        } else {
            pty_pool.wait_for_refill_idle()
        };
        let login_closed = login_closed.unwrap_or(0);
        let console_hosts_closed = cleanup_windows_headless_console_hosts("close_all");

        log_terminal_event(
            "terminal.close_all.cleanup_finished",
            None,
            None,
            Some(cleanup_started_at.elapsed()),
            json!({
                "app_pid": std::process::id(),
                "closed": active_done,
                "console_hosts_closed": console_hosts_closed,
                "detached_active": total.saturating_sub(active_done),
                "detached_warm": warm_total.saturating_sub(warm_done),
                "login_closed": login_closed,
                "total": total,
                "refill_idle": refill_idle,
                "timed_out": timed_out,
                "warm_closed": warm_done,
            }),
        );
        (
            active_done,
            warm_done,
            login_closed,
            console_hosts_closed,
            refill_idle,
            timed_out,
        )
    })
    .await
    .map_err(|error| format!("Unable to join terminal shutdown cleanup: {error}"))?;
    let (active_done, warm_done, login_closed, console_hosts_closed, refill_idle, timed_out) =
        cleanup_summary;

    log_terminal_event(
        "terminal.close_all.done",
        None,
        None,
        Some(close_started_at.elapsed()),
        json!({
            "active_done": active_done,
            "app_pid": std::process::id(),
            "closed": closed,
            "console_hosts_closed": console_hosts_closed,
            "warm_closed": warm_done,
            "warm_total": warm_total,
            "login_closed": login_closed,
            "refill_idle": refill_idle,
            "cleanup_detached": timed_out,
        }),
    );

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
    writer
        .write_all(input.as_bytes())
        .map_err(|error| format!("Unable to write {context}: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("Unable to flush {context}: {error}"))
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

#[tauri::command]
async fn terminal_open(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    request: TerminalOpenRequest,
    output_channel: Channel<InvokeResponseBody>,
) -> Result<TerminalOpenResult, String> {
    validate_terminal_pane_id(&request.pane_id)?;
    let lifecycle_lock = Arc::clone(&state.lifecycle_lock);
    let _lifecycle_guard = lifecycle_lock.lock().await;
    let pane_id = request.pane_id;
    let open_started_at = Instant::now();
    let requested_cols = request.cols;
    let requested_rows = request.rows;
    let kind = request.kind;
    let provider = request.provider;
    let provider_for_coordination = provider.clone();
    let model = request.model;
    let plain_shell = terminal_request_is_plain_shell(
        &kind,
        provider.as_deref(),
        request.plain_shell,
    );
    let working_directory_request = request.working_directory;
    let workspace_id = request.workspace_id;
    let workspace_name = request.workspace_name;

    log_terminal_event(
        "terminal.open.start",
        Some(&pane_id),
        request.instance_id,
        None,
        json!({
            "kind": clean_terminal_telemetry_text(&kind),
            "provider": provider.as_deref().map(clean_terminal_telemetry_text),
            "plain_shell": plain_shell,
            "cols": requested_cols,
            "rows": requested_rows,
            "has_working_directory": working_directory_request
                .as_deref()
                .map(|directory| !directory.trim().is_empty())
                .unwrap_or(false),
            "working_directory_request": working_directory_request
                .as_deref()
                .map(clean_terminal_telemetry_text),
            "workspace_id": workspace_id.as_deref().map(clean_terminal_telemetry_text),
        }),
    );

    if plain_shell {
        log_terminal_event(
            "terminal.open.cloud_mcp_gate_skipped_plain_shell",
            Some(&pane_id),
            request.instance_id,
            None,
            json!({
                "workspace_id": workspace_id.as_deref().map(clean_terminal_telemetry_text),
            }),
        );
    } else {
        let cloud_gate_started_at = Instant::now();
        match require_cloud_mcp_terminal_gate(
            cloud_mcp_state.inner(),
            working_directory_request.as_deref(),
            workspace_id.as_deref(),
            workspace_name.as_deref(),
        )
        .await
        {
            Ok(status) => log_terminal_event(
                "terminal.open.cloud_mcp_gate_ready",
                Some(&pane_id),
                request.instance_id,
                Some(cloud_gate_started_at.elapsed()),
                json!({
                    "base_url": clean_terminal_telemetry_text(&status.base_url),
                    "registered_workspace_count": status.registered_workspace_count,
                    "workspace_id": workspace_id.as_deref().map(clean_terminal_telemetry_text),
                }),
            ),
            Err(error) => {
                log_terminal_event(
                    "terminal.open.cloud_mcp_gate_blocked",
                    Some(&pane_id),
                    request.instance_id,
                    Some(cloud_gate_started_at.elapsed()),
                    json!({
                        "error": clean_terminal_telemetry_text(&error),
                        "workspace_id": workspace_id.as_deref().map(clean_terminal_telemetry_text),
                    }),
                );
                return Err(error);
            }
        }
    }

    let close_started_at = Instant::now();
    let closed_existing = close_terminal_session(&state, &pane_id, None)
        .await
        .unwrap_or(false);
    log_terminal_event(
        "terminal.open.close_existing",
        Some(&pane_id),
        request.instance_id,
        Some(close_started_at.elapsed()),
        json!({ "closed_existing": closed_existing }),
    );

    let resolve_started_at = Instant::now();
    let working_directory = match resolve_workspace_root_directory(working_directory_request.as_deref()) {
        Ok(working_directory) => working_directory,
        Err(error) => {
            log_terminal_event(
                "terminal.open.resolve_working_directory_error",
                Some(&pane_id),
                request.instance_id,
                Some(resolve_started_at.elapsed()),
                json!({
                    "error": clean_terminal_telemetry_text(&error),
                    "working_directory_request": working_directory_request
                        .as_deref()
                        .map(clean_terminal_telemetry_text),
                }),
            );
            return Err(error);
        }
    };
    log_terminal_event(
        "terminal.open.resolve_working_directory",
        Some(&pane_id),
        request.instance_id,
        Some(resolve_started_at.elapsed()),
        json!({ "working_directory": workspace_path_display(&working_directory) }),
    );
    let mut process_working_directory = workspace_path_for_process(&working_directory);
    let mut coordination_context = None;

    let command_started_at = Instant::now();
    let is_prewarm_pty = is_terminal_prewarm_kind(&kind);
    let (command_candidates, args, label) = if is_prewarm_pty {
        (Vec::new(), Vec::new(), "Prepared PTY".to_string())
    } else {
        terminal_launch(&kind, provider, model)?
    };
    if !is_prewarm_pty && !plain_shell {
        let git_started_at = Instant::now();
        let git_bootstrap = match ensure_workspace_git_ready_for_coordination(&working_directory) {
            Ok(result) => result,
            Err(error) => {
                log_terminal_event(
                    "terminal.open.git_preflight_error",
                    Some(&pane_id),
                    request.instance_id,
                    Some(git_started_at.elapsed()),
                    json!({
                        "error": clean_terminal_telemetry_text(&error),
                        "working_directory": workspace_path_display(&working_directory),
                    }),
                );
                return Err(format!(
                    "Unable to prepare Git for coordinated agent work in {}: {error}",
                    workspace_path_display(&working_directory)
                ));
            }
        };
        log_terminal_event(
            "terminal.open.git_preflight_ready",
            Some(&pane_id),
            request.instance_id,
            Some(git_started_at.elapsed()),
            serde_json::to_value(&git_bootstrap).unwrap_or_else(|_| json!({})),
        );

        let coordination_started_at = Instant::now();
        let agent_kind = provider_for_coordination
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(kind.as_str());
        match crate::coordination::CoordinationKernel::init(&working_directory, None)
            .and_then(|kernel| {
                kernel.prepare_terminal_context(
                    &label,
                    agent_kind,
                    Some(&pane_id),
                    workspace_id.as_deref(),
                    workspace_name.as_deref(),
                    None,
                    None,
                    None,
                )
            }) {
            Ok(context) => {
                let write_root = workspace_path_for_process(&PathBuf::from(&context.write_root));
                if context.enforcement_mode == "worktree_required" {
                    process_working_directory = write_root.clone();
                }
                log_terminal_event(
                    "terminal.open.coordination_ready",
                    Some(&pane_id),
                    request.instance_id,
                    Some(coordination_started_at.elapsed()),
                    json!({
                        "agent_id": clean_terminal_telemetry_text(&context.agent_id),
                        "session_id": clean_terminal_telemetry_text(&context.session_id),
                        "workspace_id": context.workspace_id.as_deref().map(clean_terminal_telemetry_text),
                        "objective_key": clean_terminal_telemetry_text(&context.objective_key),
                        "worktree_id": context.worktree_id.as_deref().map(clean_terminal_telemetry_text),
                        "enforcement_mode": clean_terminal_telemetry_text(&context.enforcement_mode),
                        "write_root": workspace_path_display(&write_root),
                        "launch_cwd": workspace_path_display(&process_working_directory),
                        "cwd_policy": "assigned_worktree_only",
                    }),
                );
                if context.enforcement_mode == "coordination_only"
                    && working_directory.join(".git").exists()
                {
                    let coordination = terminal_coordination_session_from_context(&context);
                    interrupt_terminal_coordination_session(
                        &coordination,
                        Some(&pane_id),
                        request.instance_id,
                        "unsafe_coordination_only_launch_blocked",
                    );
                    let error = "Unable to create an isolated git worktree for this agent; refusing to launch a write-enabled agent in the shared repo root.".to_string();
                    log_terminal_event(
                        "terminal.open.coordination_unsafe_mode_blocked",
                        Some(&pane_id),
                        request.instance_id,
                        Some(coordination_started_at.elapsed()),
                        json!({ "error": clean_terminal_telemetry_text(&error) }),
                    );
                    return Err(error);
                }
                coordination_context = Some(context);
            }
            Err(error) => {
                log_terminal_event(
                    "terminal.open.coordination_error",
                    Some(&pane_id),
                    request.instance_id,
                    Some(coordination_started_at.elapsed()),
                    json!({ "error": clean_terminal_telemetry_text(&error) }),
                );
                return Err(format!("Unable to prepare coordination kernel for agent terminal: {error}"));
            }
        }
    }
    log_terminal_event(
        "terminal.open.resolve_command",
        Some(&pane_id),
        request.instance_id,
        Some(command_started_at.elapsed()),
        json!({
            "label": label,
            "candidate_count": command_candidates.len(),
            "arg_count": args.len(),
            "prewarm_pty": is_prewarm_pty,
        }),
    );

    let size_started_at = Instant::now();
    let size = terminal_size_from_request(requested_cols, requested_rows)?;
    let instance_id = request.instance_id.filter(|id| *id > 0).unwrap_or_else(|| {
        state
            .next_terminal_instance_id
            .fetch_add(1, Ordering::Relaxed)
    });
    log_terminal_event(
        "terminal.open.size",
        Some(&pane_id),
        Some(instance_id),
        Some(size_started_at.elapsed()),
        json!({ "cols": size.cols, "rows": size.rows }),
    );

    let mut command = "prepared-shell".to_string();
    let mut agent_started = false;
    let spawn_started_at = Instant::now();

    let warm_pty = if is_prewarm_pty {
        match create_warm_shell_pty_in_directory(size, &process_working_directory) {
            Ok(warm_pty) => warm_pty,
            Err(error) => {
                log_terminal_event(
                    "terminal.open.prewarm_spawn_error",
                    Some(&pane_id),
                    Some(instance_id),
                    Some(spawn_started_at.elapsed()),
                    json!({ "error": clean_terminal_telemetry_text(&error) }),
                );
                return Err(error);
            }
        }
    } else {
        let Some(command_path) = choose_terminal_command_path(&command_candidates) else {
            let error = format!("{label} is not installed or not available on PATH.");
            if let Some(context) = coordination_context.as_ref() {
                let coordination = terminal_coordination_session_from_context(context);
                interrupt_terminal_coordination_session(
                    &coordination,
                    Some(&pane_id),
                    Some(instance_id),
                    "command_unavailable",
                );
            }
            log_terminal_event(
                "terminal.open.error",
                Some(&pane_id),
                Some(instance_id),
                Some(open_started_at.elapsed()),
                json!({ "error": clean_terminal_telemetry_text(&error) }),
            );
            return Err(error);
        };

        let coordination_env_vars = coordination_context
            .as_ref()
            .map(|context| context.env_vars())
            .unwrap_or_default();
        let launch_coordination = coordination_context
            .as_ref()
            .map(terminal_coordination_session_from_context);
        let launch_provider_id = provider_for_coordination
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(kind.as_str());
        let launch_args = terminal_args_with_codex_mcp_identity(
            launch_provider_id,
            &args,
            launch_coordination.as_ref(),
            &pane_id,
            instance_id,
        );
        let warm_pty = match create_agent_terminal_pty(
            size,
            &command_path,
            &launch_args,
            &process_working_directory,
            coordination_env_vars.as_slice(),
            None,
        ) {
            Ok(warm_pty) => warm_pty,
            Err(error) => {
                if let Some(context) = coordination_context.as_ref() {
                    let coordination = terminal_coordination_session_from_context(context);
                    interrupt_terminal_coordination_session(
                        &coordination,
                        Some(&pane_id),
                        Some(instance_id),
                        "agent_spawn_error",
                    );
                }
                log_terminal_event(
                    "terminal.open.agent_spawn_error",
                    Some(&pane_id),
                    Some(instance_id),
                    Some(spawn_started_at.elapsed()),
                    json!({
                        "command": clean_terminal_telemetry_text(&command_path),
                        "error": clean_terminal_telemetry_text(&error),
                    }),
                );
                return Err(error);
            }
        };

        command = command_path;
        agent_started = true;
        warm_pty
    };

    let terminal_coordination = coordination_context
        .as_ref()
        .map(terminal_coordination_session_from_context);
    let terminal_coordination_for_monitor = terminal_coordination.clone();

    log_terminal_event(
        if is_prewarm_pty {
            "terminal.open.prewarm_spawn"
        } else {
            "terminal.open.agent_spawn"
        },
        Some(&pane_id),
        Some(instance_id),
        Some(spawn_started_at.elapsed()),
        json!({
            "agent_started": agent_started,
            "arg_count": args.len(),
            "launch_arg_count": if is_prewarm_pty { args.len() } else { terminal_args_with_codex_mcp_identity(provider_for_coordination.as_deref().unwrap_or(kind.as_str()), &args, terminal_coordination.as_ref(), &pane_id, instance_id).len() },
            "command": clean_terminal_telemetry_text(&command),
            "prewarm_pty": is_prewarm_pty,
            "repo_working_directory": workspace_path_display(&working_directory),
            "working_directory": workspace_path_display(&process_working_directory),
            "agent_branch_root": coordination_context
                .as_ref()
                .map(|context| clean_terminal_telemetry_text(&context.write_root)),
            "cwd_policy": if coordination_context.is_some() {
                "assigned_worktree_only"
            } else {
                "plain_project_root"
            },
        }),
    );

    let (instance, reader) = TerminalInstance::from_warm_shell(
        instance_id,
        warm_pty,
        process_working_directory.clone(),
        agent_started,
        terminal_coordination,
    );

    let insert_started_at = Instant::now();
    let displaced_instance = state
        .terminals
        .write()
        .await
        .insert(pane_id.clone(), instance);
    let displaced_existing = displaced_instance.is_some();
    if let Some(displaced_instance) = displaced_instance {
        cleanup_terminal_instance_async(
            displaced_instance,
            true,
            Some(pane_id.clone()),
            "terminal_open_displaced",
        );
    }
    log_terminal_event(
        "terminal.open.insert_instance",
        Some(&pane_id),
        Some(instance_id),
        Some(insert_started_at.elapsed()),
        json!({
            "prewarm_pty": is_prewarm_pty,
            "agent_started": agent_started,
            "displaced_existing": displaced_existing,
        }),
    );

    spawn_terminal_reader(
        app.clone(),
        Arc::clone(&state.terminals),
        pane_id.clone(),
        instance_id,
        cloud_mcp_state.inner().clone(),
        output_channel,
        reader,
    );
    if let Some(coordination) = terminal_coordination_for_monitor {
        spawn_terminal_session_parking_monitor(
            app.clone(),
            cloud_mcp_state.inner().clone(),
            state.terminals.clone(),
            state.parked_prompts.clone(),
            pane_id.clone(),
            instance_id,
            coordination,
            "terminal_open",
        );
    }
    log_terminal_event(
        if is_prewarm_pty {
            "terminal.open.prewarm_ready"
        } else {
            "terminal.open.success"
        },
        Some(&pane_id),
        Some(instance_id),
        Some(open_started_at.elapsed()),
        json!({
            "command": clean_terminal_telemetry_text(&command),
            "repo_working_directory": workspace_path_display(&working_directory),
            "working_directory": workspace_path_display(&process_working_directory),
            "agent_branch_root": coordination_context
                .as_ref()
                .map(|context| clean_terminal_telemetry_text(&context.write_root)),
            "cwd_policy": if coordination_context.is_some() {
                "assigned_worktree_only"
            } else {
                "plain_project_root"
            },
        }),
    );

    Ok(TerminalOpenResult {
        pane_id,
        instance_id,
        command,
        working_directory: workspace_path_display(&process_working_directory),
        project_root: workspace_path_display(&working_directory),
        agent_branch_root: coordination_context
            .as_ref()
            .map(|context| context.write_root.clone()),
        agent_branch: coordination_context.as_ref().and_then(|context| {
            context
                .slot_key
                .as_deref()
                .map(|slot_key| format!("agent/{slot_key}"))
        }),
        slot_key: coordination_context
            .as_ref()
            .and_then(|context| context.slot_key.clone()),
        coordination_mode: coordination_context
            .as_ref()
            .map(|context| context.enforcement_mode.clone()),
    })
}

fn terminal_telemetry_entry(request: TerminalTelemetryLogRequest) -> Option<Value> {
    if request.phase.trim().is_empty() {
        return None;
    }

    Some(json!({
        "ts_ms": request.ts_ms.unwrap_or_else(terminal_now_ms),
        "phase": clean_terminal_telemetry_text(&request.phase),
        "pane_id": request.pane_id.as_deref().map(clean_terminal_telemetry_text),
        "instance_id": request.instance_id,
        "message": request.message.as_deref().map(clean_terminal_telemetry_text),
        "cols": request.cols,
        "rows": request.rows,
        "elapsed_ms": request.elapsed_ms,
        "fields": request.fields.unwrap_or_else(|| json!({})),
    }))
}

#[tauri::command]
fn terminal_telemetry_log(request: TerminalTelemetryLogRequest) -> Result<(), String> {
    if let Some(entry) = terminal_telemetry_entry(request) {
        write_terminal_telemetry(entry);
    }

    Ok(())
}

#[tauri::command]
fn terminal_telemetry_log_many(requests: Vec<TerminalTelemetryLogRequest>) -> Result<(), String> {
    let entries = requests
        .into_iter()
        .filter_map(terminal_telemetry_entry)
        .collect::<Vec<_>>();

    write_terminal_telemetry_entries(entries);

    Ok(())
}

#[tauri::command]
async fn terminal_recover_crashed_sessions(roots: Option<Vec<String>>) -> Result<Value, String> {
    let recovery_started_at = Instant::now();
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

    log_terminal_event(
        "terminal.crash_recovery.scan_completed",
        None,
        None,
        Some(recovery_started_at.elapsed()),
        json!({
            "workspace_count": workspace_reports.len(),
            "scanned_sessions": scanned_sessions,
            "interrupted_tasks": interrupted_tasks.len(),
            "idle_sessions_interrupted": idle_sessions_interrupted,
            "finished_sessions_interrupted": finished_sessions_interrupted,
            "errors": errors.len(),
            "modal_policy": "frontend_modal_only_for_interrupted_tasks_no_auto_input",
        }),
    );

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
    app: AppHandle,
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    pane_id: String,
    instance_id: Option<u64>,
    provider: String,
    model: Option<String>,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
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
        log_terminal_event(
            "terminal.agent_start.skipped_stale_or_missing",
            Some(&pane_id),
            instance_id,
            None,
            json!({ "provider": definition.id }),
        );
        return Err("Terminal session is not running.".to_string());
    };
    if instance.coordination.is_none() {
        log_terminal_event(
            "terminal.agent_start.blocked_uncoordinated",
            Some(&pane_id),
            Some(instance.id),
            None,
            json!({ "provider": definition.id }),
        );
        return Err(
            "Deferred agent start is blocked because this terminal has no coordination session."
                .to_string(),
        );
    }
    let cloud_gate_started_at = Instant::now();
    match require_cloud_mcp_terminal_gate_for_path(
        cloud_mcp_state.inner(),
        instance.working_directory.as_ref(),
        None,
        None,
    )
    .await
    {
        Ok(status) => log_terminal_event(
            "terminal.agent_start.cloud_mcp_gate_ready",
            Some(&pane_id),
            Some(instance.id),
            Some(cloud_gate_started_at.elapsed()),
            json!({
                "base_url": clean_terminal_telemetry_text(&status.base_url),
                "provider": definition.id,
            }),
        ),
        Err(error) => {
            log_terminal_event(
                "terminal.agent_start.cloud_mcp_gate_blocked",
                Some(&pane_id),
                Some(instance.id),
                Some(cloud_gate_started_at.elapsed()),
                json!({
                    "provider": definition.id,
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );
            return Err(error);
        }
    }
    let launch_args = terminal_args_with_codex_mcp_identity(
        definition.id,
        &args,
        instance.coordination.as_ref(),
        &pane_id,
        instance.id,
    );
    let input = terminal_agent_start_input_with_env_in_directory(
        &command_path,
        &launch_args,
        instance.working_directory.as_ref(),
        instance
            .coordination
            .as_ref()
            .map(|coordination| coordination.env_vars.as_slice())
            .unwrap_or(&[]),
    );

    if input.len() > MAX_TERMINAL_WRITE_BYTES {
        return Err("Terminal launch input is too large.".to_string());
    }

    let write_started_at = Instant::now();
    let mut agent_started = instance.agent_started.lock().await;

    if *agent_started {
        log_terminal_event(
            "terminal.agent_start.skipped_already_started",
            Some(&pane_id),
            Some(instance.id),
            Some(write_started_at.elapsed()),
            json!({ "provider": definition.id }),
        );
        return Ok(());
    }

    let mut writer = instance.writer.lock().await;

    write_agent_start_input_to_writer(writer.as_mut(), &input, "terminal agent launch")?;
    *agent_started = true;
    if let Some(coordination) = instance.coordination.clone() {
        spawn_terminal_session_parking_monitor(
            app,
            cloud_mcp_state.inner().clone(),
            state.terminals.clone(),
            state.parked_prompts.clone(),
            pane_id.clone(),
            instance.id,
            coordination,
            "terminal_start_agent",
        );
    }
    log_terminal_event(
        "terminal.agent_start.write",
        Some(&pane_id),
        Some(instance.id),
        Some(write_started_at.elapsed()),
        json!({
            "provider": definition.id,
            "command": clean_terminal_telemetry_text(&command_path),
            "arg_count": args.len(),
            "launch_arg_count": launch_args.len(),
            "bytes": input.len(),
            "working_directory": workspace_path_display(instance.working_directory.as_ref()),
        }),
    );

    Ok(())
}

async fn start_terminal_agent_in_prepared_pty(
    app: AppHandle,
    cloud_mcp_state: CloudMcpState,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    parked_prompts: Arc<RwLock<HashMap<String, TerminalParkedPrompt>>>,
    request: TerminalStartAgentRequest,
) -> TerminalStartAgentPaneResult {
    let pane_id = request.pane_id;
    let instance_id = request.instance_id;
    let workspace_id = request.workspace_id;
    let start_started_at = Instant::now();

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
        log_terminal_event(
            "terminal.agent_start_many.skipped_missing",
            Some(&pane_id),
            instance_id,
            Some(start_started_at.elapsed()),
            json!({
                "provider": definition.id,
                "workspace_id": workspace_id.as_deref().map(clean_terminal_telemetry_text),
            }),
        );
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id,
            started: false,
            skipped: true,
            message: "Terminal session is not running.".to_string(),
        };
    };

    if instance_id.is_some_and(|expected_id| expected_id != instance.id) {
        log_terminal_event(
            "terminal.agent_start_many.skipped_stale",
            Some(&pane_id),
            instance_id,
            Some(start_started_at.elapsed()),
            json!({
                "current_instance_id": instance.id,
                "provider": definition.id,
                "workspace_id": workspace_id.as_deref().map(clean_terminal_telemetry_text),
            }),
        );
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id,
            started: false,
            skipped: true,
            message: "Terminal session was replaced before agent start.".to_string(),
        };
    }

    if instance.coordination.is_none() {
        log_terminal_event(
            "terminal.agent_start_many.blocked_uncoordinated",
            Some(&pane_id),
            Some(instance.id),
            Some(start_started_at.elapsed()),
            json!({
                "provider": definition.id,
                "workspace_id": workspace_id.as_deref().map(clean_terminal_telemetry_text),
            }),
        );
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id: Some(instance.id),
            started: false,
            skipped: true,
            message: "Prepared terminal has no coordination session; restart through terminal_open."
                .to_string(),
        };
    }

    let mut agent_started_guard = instance.agent_started.lock().await;

    if *agent_started_guard {
        log_terminal_event(
            "terminal.agent_start_many.skipped_already_started",
            Some(&pane_id),
            Some(instance.id),
            Some(start_started_at.elapsed()),
            json!({
                "provider": definition.id,
                "workspace_id": workspace_id.as_deref().map(clean_terminal_telemetry_text),
            }),
        );
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
        let input = terminal_agent_start_input_with_env_in_directory(
            &command_path,
            &launch_args,
            instance.working_directory.as_ref(),
            instance
                .coordination
                .as_ref()
                .map(|coordination| coordination.env_vars.as_slice())
                .unwrap_or(&[]),
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
        let write_started_at = Instant::now();
        let mut writer = instance.writer.lock().await;

        match write_agent_start_input_to_writer(writer.as_mut(), &input, "terminal agent launch") {
            Ok(()) => {
                *agent_started_guard = true;
                if let Some(coordination) = instance.coordination.clone() {
                    spawn_terminal_session_parking_monitor(
                        app,
                        cloud_mcp_state,
                        Arc::clone(&terminals),
                        parked_prompts,
                        pane_id.clone(),
                        instance.id,
                        coordination,
                        "terminal_start_agent_many",
                    );
                }
                log_terminal_event(
                    "terminal.agent_start_many.write_done",
                    Some(&pane_id),
                    Some(instance.id),
                    Some(write_started_at.elapsed()),
                    json!({
                        "provider": definition.id,
                        "command": clean_terminal_telemetry_text(&command_path),
                        "arg_count": args.len(),
                        "launch_arg_count": launch_args.len(),
                        "bytes": input.len(),
                        "workspace_id": workspace_id.as_deref().map(clean_terminal_telemetry_text),
                        "working_directory": workspace_path_display(instance.working_directory.as_ref()),
                    }),
                );
                return TerminalStartAgentPaneResult {
                    pane_id,
                    instance_id: Some(instance.id),
                    started: true,
                    skipped: false,
                    message: "Agent started.".to_string(),
                };
            }
            Err(error) => {
                log_terminal_event(
                    "terminal.agent_start_many.write_error",
                    Some(&pane_id),
                    Some(instance.id),
                    Some(write_started_at.elapsed()),
                    json!({
                        "provider": definition.id,
                        "command": clean_terminal_telemetry_text(&command_path),
                        "error": clean_terminal_telemetry_text(&error),
                        "workspace_id": workspace_id.as_deref().map(clean_terminal_telemetry_text),
                    }),
                );
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

    log_terminal_event(
        "terminal.agent_start_many.skipped_not_warm_shell",
        Some(&pane_id),
        Some(instance.id),
        Some(start_started_at.elapsed()),
        json!({
            "provider": definition.id,
            "workspace_id": workspace_id.as_deref().map(clean_terminal_telemetry_text),
        }),
    );
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
    let lifecycle_lock = Arc::clone(&state.lifecycle_lock);
    let _lifecycle_guard = lifecycle_lock.lock().await;
    if requests.len() > MAX_TERMINAL_START_AGENT_BATCH {
        return Err(format!(
            "Cannot start more than {MAX_TERMINAL_START_AGENT_BATCH} terminal agents at once."
        ));
    }
    let cloud_gate_started_at = Instant::now();
    match require_cloud_mcp_connected_state(cloud_mcp_state.inner()).await {
        Ok(status) => log_terminal_event(
            "terminal.agent_start_many.cloud_mcp_gate_ready",
            None,
            None,
            Some(cloud_gate_started_at.elapsed()),
            json!({
                "base_url": clean_terminal_telemetry_text(&status.base_url),
                "request_count": requests.len(),
            }),
        ),
        Err(error) => {
            log_terminal_event(
                "terminal.agent_start_many.cloud_mcp_gate_blocked",
                None,
                None,
                Some(cloud_gate_started_at.elapsed()),
                json!({
                    "request_count": requests.len(),
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );
            return Err(error);
        }
    }

    let batch_started_at = Instant::now();
    log_terminal_event(
        "terminal.agent_start_many.start",
        None,
        None,
        None,
        json!({ "request_count": requests.len() }),
    );

    let mut join_set = tokio::task::JoinSet::new();

    for request in requests {
        let terminals = Arc::clone(&state.terminals);
        let parked_prompts = Arc::clone(&state.parked_prompts);
        let app = app.clone();
        let cloud_mcp_state = cloud_mcp_state.inner().clone();

        join_set
            .spawn(async move {
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

    log_terminal_event(
        "terminal.agent_start_many.done",
        None,
        None,
        Some(batch_started_at.elapsed()),
        json!({
            "request_count": results.len(),
            "started": started,
            "skipped": skipped,
        }),
    );

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

async fn terminal_observe_submitted_prompt(
    instance: &TerminalInstance,
    data: &str,
) -> Option<String> {
    let mut gate = instance.input_gate.lock().await;
    let mut submitted = None;

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
            let code = character as u32;
            if (0x40..=0x7e).contains(&code) {
                gate.ansi_csi_active = false;
                gate.ansi_escape_active = false;
            }
            continue;
        }

        if gate.ansi_ss3_active {
            gate.ansi_ss3_active = false;
            gate.ansi_escape_active = false;
            continue;
        }

        if gate.ansi_escape_active {
            match character {
                '[' => {
                    gate.ansi_csi_active = true;
                }
                ']' | 'P' | '^' | '_' | 'X' => {
                    gate.ansi_osc_active = true;
                    gate.ansi_osc_escape_pending = false;
                }
                'O' => {
                    gate.ansi_ss3_active = true;
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
                gate.current_line_user_touched = false;
                if !prompt.is_empty() {
                    submitted = Some(prompt);
                }
            }
            '\u{7f}' | '\u{8}' => {
                gate.current_line.pop();
                gate.current_line_user_touched = true;
            }
            '\u{15}' => {
                gate.current_line.clear();
                gate.current_line_user_touched = true;
            }
            '\u{1b}' => {
                gate.ansi_escape_active = true;
                gate.ansi_csi_active = false;
                gate.ansi_osc_active = false;
                gate.ansi_osc_escape_pending = false;
                gate.ansi_ss3_active = false;
            }
            character if character.is_control() => {}
            character => {
                gate.current_line.push(character);
                gate.current_line_user_touched = true;
                if gate.current_line.len() > 8192 {
                    let drain_to = gate.current_line.len().saturating_sub(4096);
                    gate.current_line.drain(..drain_to);
                }
            }
        }
    }

    submitted
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
    let action = if lower.contains("pricing") && (lower.contains("half") || lower.contains("halve")) {
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
    } else if lower.contains("html") || lower.contains("landing") || lower.contains("splash") || lower.contains("slash page") {
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

struct TerminalPreparedCoordinationTask {
    task_id: String,
    title: String,
    parked: bool,
    partial: bool,
    parking_details: Value,
    intent_resources: Vec<String>,
    runnable_resources: Vec<String>,
    parked_resources: Vec<String>,
}

#[derive(Clone)]
struct TerminalParkingSnapshot {
    task_id: String,
    title: String,
    prompt: String,
    task_status: String,
    session_status: String,
    ready: bool,
    terminal: bool,
    waiting_on: Vec<TerminalParkedWaitingOn>,
}

fn terminal_parking_snapshot_signature(snapshot: &TerminalParkingSnapshot) -> String {
    let waiting_on = snapshot
        .waiting_on
        .iter()
        .map(|item| {
            format!(
                "{}:{}:{}",
                item.task_id.as_deref().unwrap_or(""),
                item.agent_label.as_deref().or(item.agent_id.as_deref()).unwrap_or(""),
                item.resource_key.as_deref().unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join("|");
    format!(
        "{}:{}:{}:{}:{}:{}",
        snapshot.task_id,
        snapshot.task_status,
        snapshot.session_status,
        snapshot.ready,
        snapshot.terminal,
        waiting_on
    )
}

fn terminal_parked_prompt_key(pane_id: &str, instance_id: u64, task_id: &str) -> String {
    format!("{pane_id}:{instance_id}:{task_id}")
}

fn terminal_waiting_agent_label(agent_id: &str) -> String {
    let short = agent_id
        .split('-')
        .next()
        .unwrap_or(agent_id)
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(3)
        .collect::<String>()
        .to_ascii_uppercase();
    if short.is_empty() {
        "AGT".to_string()
    } else {
        short
    }
}

fn terminal_waiting_slot_label(slot_key: &str) -> String {
    let lower = slot_key.trim().to_ascii_lowercase();
    if let Some(number) = lower.strip_prefix("codex-").and_then(|value| value.parse::<u8>().ok()) {
        if (1..=26).contains(&number) {
            return format!("CX{}", (b'A' + number - 1) as char);
        }
    }
    slot_key.to_ascii_uppercase()
}

fn terminal_parked_waiting_on_from_details(details: &Value) -> Vec<TerminalParkedWaitingOn> {
    let mut waiting_on = Vec::new();
    let Some(items) = details.as_array() else {
        return waiting_on;
    };
    for item in items {
        let resource_key = item["error"]["details"]["resource_key"]
            .as_str()
            .or_else(|| item["resource_key"].as_str())
            .map(str::to_string);
        let mut blockers = item["error"]["details"]["blockers"]
            .as_array()
            .map(|items| items.iter().collect::<Vec<_>>())
            .unwrap_or_default();
        let single_blocker = item["error"]["details"]["blocker"]
            .as_object()
            .map(|blocker| Value::Object(blocker.clone()));
        if let Some(blocker) = single_blocker.as_ref() {
            blockers.push(blocker);
        }
        for blocker in blockers {
            let agent_id = blocker["agent_id"].as_str().map(str::to_string);
            let agent_label = blocker["agent_label"]
                .as_str()
                .map(str::to_string)
                .or_else(|| blocker["slot_key"].as_str().map(terminal_waiting_slot_label))
                .or_else(|| agent_id.as_deref().map(terminal_waiting_agent_label));
            terminal_push_unique_waiting_on(
                &mut waiting_on,
                TerminalParkedWaitingOn {
                    agent_id,
                    agent_label,
                    task_id: blocker["task_id"].as_str().map(str::to_string),
                    task_title: blocker["task_title"]
                        .as_str()
                        .or_else(|| blocker["title"].as_str())
                        .map(str::to_string),
                    resource_key: resource_key.clone(),
                },
            );
        }
    }
    waiting_on
}

fn terminal_push_unique_waiting_on(
    waiting_on: &mut Vec<TerminalParkedWaitingOn>,
    next: TerminalParkedWaitingOn,
) {
    let next_key = (
        next.task_id.clone(),
        next.agent_id.clone(),
        next.agent_label.clone(),
    );
    if waiting_on.iter().any(|existing| {
        (
            existing.task_id.clone(),
            existing.agent_id.clone(),
            existing.agent_label.clone(),
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
        let agent_label = item["depends_on_slot_key"]
            .as_str()
            .map(terminal_waiting_slot_label)
            .or_else(|| agent_id.as_deref().map(terminal_waiting_agent_label));
        terminal_push_unique_waiting_on(
            &mut waiting_on,
            TerminalParkedWaitingOn {
                agent_id,
                agent_label,
                task_id: item["depends_on_task_id"].as_str().map(str::to_string),
                task_title: item["depends_on_title"].as_str().map(str::to_string),
                resource_key: item["resource_key"].as_str().map(str::to_string),
            },
        );
    }
    waiting_on
}

fn terminal_parked_waiting_on_from_resume_state(state: &Value) -> Vec<TerminalParkedWaitingOn> {
    let mut waiting_on = terminal_parked_waiting_on_from_blocking_dependencies(
        &state["data"]["blocking_dependencies"],
    );
    for blocker in terminal_parked_waiting_on_from_blocking_dependencies(
        &state["data"]["blocked_slices"],
    ) {
        terminal_push_unique_waiting_on(&mut waiting_on, blocker);
    }
    for blocker in terminal_parked_waiting_on_from_blocking_dependencies(
        &state["data"]["parked_resource_intents"],
    ) {
        terminal_push_unique_waiting_on(&mut waiting_on, blocker);
    }
    waiting_on
}

fn terminal_task_status_is_terminal(status: &str) -> bool {
    matches!(
        status,
        "merged" | "done" | "completed" | "cancelled" | "interrupted" | "skipped"
    )
}

fn terminal_resume_state_has_parked_intents(state: &Value) -> bool {
    state["data"]["parked_resource_intents"]
        .as_array()
        .is_some_and(|items| !items.is_empty())
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
        "terminal_parking_snapshot_poll",
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
         WHERE i.task_id=?1
           AND i.status IN ('parked', 'parked_cycle_prevented', 'resume_ready')
         ORDER BY i.updated_at ASC",
        &[&task_id],
    )?;

    let mut waiting_on = terminal_parked_waiting_on_from_blocking_dependencies(
        &Value::Array(blocking_dependencies.clone()),
    );
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
        task_status,
        session_status,
        ready,
        terminal,
        waiting_on,
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
        },
    );
}

async fn mark_terminal_parked_prompt_lifecycle_in_cloud(
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
}

fn emit_terminal_monitor_coordination_event(
    coordination: &TerminalCoordinationSession,
    event_type: &str,
    pane_id: &str,
    instance_id: u64,
    task_id: Option<&str>,
    payload: Value,
) {
    log_terminal_event(
        "terminal.coordination_monitor_event",
        Some(pane_id),
        Some(instance_id),
        None,
        json!({
            "event_type": clean_terminal_telemetry_text(event_type),
            "task_id": task_id.map(clean_terminal_telemetry_text),
            "session_id": clean_terminal_telemetry_text(&coordination.session_id),
            "agent_id": clean_terminal_telemetry_text(&coordination.agent_id),
            "source": "terminal_parking_supervisor",
            "payload": payload.clone(),
        }),
    );
    if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
        &coordination.repo_path,
        Some(PathBuf::from(&coordination.db_path)),
    ) {
        let _ = kernel.emit_event(
            event_type,
            "terminal",
            &coordination.session_id,
            crate::coordination::kernel::EventRefs {
                task_id: task_id.map(str::to_string),
                agent_id: Some(coordination.agent_id.clone()),
                session_id: Some(coordination.session_id.clone()),
                ..crate::coordination::kernel::EventRefs::default()
            },
            json!({
                "pane_id": pane_id,
                "instance_id": instance_id,
                "source": "terminal_parking_supervisor",
                "payload": payload,
            }),
        );
    }
}

fn spawn_terminal_session_parking_monitor(
    app: AppHandle,
    cloud_mcp_state: CloudMcpState,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    parked_prompts: Arc<RwLock<HashMap<String, TerminalParkedPrompt>>>,
    pane_id: String,
    instance_id: u64,
    coordination: TerminalCoordinationSession,
    source: &'static str,
) {
    emit_terminal_monitor_coordination_event(
        &coordination,
        "terminal_session_parking_monitor_spawned",
        &pane_id,
        instance_id,
        None,
        json!({
            "source": source,
            "session_id": coordination.session_id.clone(),
        }),
    );
    tauri::async_runtime::spawn(terminal_monitor_session_parking(
        app,
        cloud_mcp_state,
        terminals,
        parked_prompts,
        pane_id,
        instance_id,
        coordination,
    ));
}

fn terminal_prompt_intent_resource_keys(prompt: &str) -> Vec<String> {
    let lower = prompt.to_ascii_lowercase();
    let mut resources = Vec::new();
    for token in prompt.split(|ch: char| ch.is_whitespace() || matches!(ch, ',' | ';' | ':' | '(' | ')' | '[' | ']' | '{' | '}')) {
        let cleaned = token
            .trim_matches(|ch: char| matches!(ch, '`' | '"' | '\'' | '<' | '>' | '.' | '!' | '?'))
            .replace('\\', "/");
        if cleaned.starts_with('/')
            || cleaned.starts_with("http")
            || cleaned.starts_with('@')
            || cleaned.contains("..")
        {
            continue;
        }
        let lower_token = cleaned.to_ascii_lowercase();
        let looks_like_path = cleaned.contains('/')
            || lower_token.ends_with(".html")
            || lower_token.ends_with(".css")
            || lower_token.ends_with(".js")
            || lower_token.ends_with(".jsx")
            || lower_token.ends_with(".ts")
            || lower_token.ends_with(".tsx")
            || lower_token.ends_with(".json")
            || lower_token.ends_with(".md")
            || lower_token.ends_with(".rs")
            || lower_token.ends_with(".py")
            || lower_token.ends_with(".go")
            || lower_token.ends_with(".toml")
            || lower_token.ends_with(".lock");
        if looks_like_path && !cleaned.is_empty() {
            resources.push(format!("file:{cleaned}"));
        }
    }
    for manifest in [
        "package.json",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "bun.lockb",
        "Cargo.toml",
        "Cargo.lock",
        "requirements.txt",
        "pyproject.toml",
    ] {
        if prompt.contains(manifest) {
            resources.push(format!("file:{manifest}"));
        }
    }
    if lower.contains("index.html") {
        resources.push("file:index.html".to_string());
    }
    if lower.contains("html")
        || lower.contains("landing")
        || lower.contains("splash")
        || lower.contains("slash page")
        || lower.contains("wishlist")
        || lower.contains("wish list")
        || lower.contains("waitlist")
        || lower.contains("front end")
        || lower.contains("frontend")
        || lower.contains("single page")
    {
        resources.push("file:index.html".to_string());
    }
    if lower.contains("pricing") || (lower.contains("price") && lower.contains("page")) {
        resources.push("file:pricing.html".to_string());
    }
    resources.sort();
    resources.dedup();
    resources
}

fn terminal_partial_parking_prompt(
    prompt: &str,
    runnable_resources: &[String],
    parked_resources: &[String],
) -> String {
    let runnable = if runnable_resources.is_empty() {
        "- none".to_string()
    } else {
        runnable_resources
            .iter()
            .map(|resource| format!("- {resource}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let parked = if parked_resources.is_empty() {
        "- none".to_string()
    } else {
        parked_resources
            .iter()
            .map(|resource| format!("- {resource}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "Diff Forge scheduler partially parked this task.\n\n\
Work only on these granted resources now:\n{runnable}\n\n\
Do not edit these parked resources yet:\n{parked}\n\n\
When the runnable slice is complete, call coordination-kernel.submit_patch. Rust will resume this terminal later for the parked resources after their queue/resolver dependencies clear.\n\n\
Original request:\n{prompt}\r"
    )
}

fn terminal_prepare_coordination_task_for_prompt(
    coordination: &TerminalCoordinationSession,
    prompt: &str,
    pane_id: &str,
    instance_id: u64,
) -> Result<Option<TerminalPreparedCoordinationTask>, String> {
    let kernel = crate::coordination::CoordinationKernel::open(
        &coordination.repo_path,
        Some(PathBuf::from(&coordination.db_path)),
    )?;
    let title = terminal_prompt_task_title(prompt);
    let task = kernel.create_task(
        &title,
        Some(prompt),
        0,
        1,
        None,
        None,
        Some("terminal-agent"),
        Some("Complete the direct terminal prompt in the assigned agent worktree."),
    )?;
    let Some(task_id) = task["id"].as_str().map(str::to_string) else {
        return Ok(None);
    };
    kernel.claim_task(&task_id, &coordination.agent_id, &coordination.session_id)?;
    let intent_resources = terminal_prompt_intent_resource_keys(prompt);
    let mut parked = false;
    let mut runnable_resources = Vec::new();
    let mut parked_resources = Vec::new();
    let mut parking_details = Vec::new();
    for resource_key in &intent_resources {
        match kernel.acquire_lease(
            &task_id,
            &coordination.agent_id,
            &coordination.session_id,
            resource_key,
            "write",
            Some(900),
            Some("Prompt intent lease: park later agents behind this likely target file until the accepted patch lands."),
        ) {
            Ok(value) => {
                if value["ok"].as_bool() == Some(false) {
                    let code = value["error"]["code"].as_str().unwrap_or_default();
                    if code.contains("queued") || code.contains("lease_conflict") || code.contains("cycle_prevented") {
                        parked = true;
                        parked_resources.push(resource_key.clone());
                    }
                    let mut value = value;
                    if let Some(object) = value.as_object_mut() {
                        object.insert("resource_key".to_string(), json!(resource_key));
                    }
                    parking_details.push(value);
                } else {
                    runnable_resources.push(resource_key.clone());
                    parking_details.push(json!({
                        "resource_key": resource_key,
                        "status": "intent_lease_acquired",
                        "lease": value,
                    }));
                }
            }
            Err(error) => {
                parking_details.push(json!({
                    "resource_key": resource_key,
                    "status": "intent_lease_error",
                    "error": clean_terminal_telemetry_text(&error),
                }));
            }
        }
    }
    if !parked {
        let _ = kernel.task_resume_state(&task_id, &coordination.session_id);
    }
    log_terminal_event(
        "terminal.prompt.coordination_task_ready",
        Some(pane_id),
        Some(instance_id),
        None,
        json!({
            "agent_id": clean_terminal_telemetry_text(&coordination.agent_id),
            "session_id": clean_terminal_telemetry_text(&coordination.session_id),
            "task_id": clean_terminal_telemetry_text(&task_id),
            "title": clean_terminal_telemetry_text(&title),
            "intent_resources": intent_resources.clone(),
            "parked": parked,
            "partial": parked && !runnable_resources.is_empty(),
            "runnable_resources": runnable_resources.clone(),
            "parked_resources": parked_resources.clone(),
            "parking_details": parking_details.clone(),
        }),
    );
    Ok(Some(TerminalPreparedCoordinationTask {
        task_id,
        title,
        parked: parked && runnable_resources.is_empty(),
        partial: parked && !runnable_resources.is_empty(),
        parking_details: Value::Array(parking_details),
        intent_resources,
        runnable_resources,
        parked_resources,
    }))
}

async fn terminal_resume_parked_prompt_when_ready(
    app: AppHandle,
    cloud_mcp_state: CloudMcpState,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    parked_prompts: Arc<RwLock<HashMap<String, TerminalParkedPrompt>>>,
    pane_id: String,
    instance_id: u64,
    coordination: TerminalCoordinationSession,
    task_id: String,
    title: String,
    prompt: String,
) {
    let parked_key = terminal_parked_prompt_key(&pane_id, instance_id, &task_id);
    let mut last_resume_snapshot_signature: Option<String> = None;
    log_terminal_event(
        "terminal.prompt.parked",
        Some(&pane_id),
        Some(instance_id),
        None,
        json!({
            "task_id": clean_terminal_telemetry_text(&task_id),
            "title": clean_terminal_telemetry_text(&title),
            "resume_policy": "wait_for_dependency_then_refresh_worktree",
        }),
    );
    for _ in 0..7200 {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        let still_parked = {
            let guard = parked_prompts.read().await;
            guard.contains_key(&parked_key)
        };
        if !still_parked {
            log_terminal_event(
                "terminal.prompt.parked_resume_abandoned",
                Some(&pane_id),
                Some(instance_id),
                None,
                json!({
                    "task_id": clean_terminal_telemetry_text(&task_id),
                    "reason": "parked_task_removed",
                }),
            );
            return;
        }
        let snapshot = match terminal_parking_snapshot_from_kernel(&coordination) {
            Ok(Some(snapshot)) if snapshot.task_id == task_id => snapshot,
            Ok(_) => continue,
            Err(_) => continue,
        };
        let resume_snapshot_signature = terminal_parking_snapshot_signature(&snapshot);
        if last_resume_snapshot_signature.as_deref() != Some(resume_snapshot_signature.as_str()) {
            emit_terminal_monitor_coordination_event(
                &coordination,
                "terminal_parked_resume_snapshot",
                &pane_id,
                instance_id,
                Some(&task_id),
                json!({
                    "task_status": snapshot.task_status.clone(),
                    "session_status": snapshot.session_status.clone(),
                    "ready": snapshot.ready,
                    "terminal": snapshot.terminal,
                    "waiting_on_count": snapshot.waiting_on.len(),
                    "waiting_on": snapshot.waiting_on.clone(),
                    "signature": resume_snapshot_signature.clone(),
                }),
            );
            last_resume_snapshot_signature = Some(resume_snapshot_signature);
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
            continue;
        }
        emit_terminal_monitor_coordination_event(
            &coordination,
            "terminal_parked_resume_ready_to_write",
            &pane_id,
            instance_id,
            Some(&task_id),
            json!({
                "title": clean_terminal_telemetry_text(&title),
                "prompt_bytes": prompt.len(),
                "resume_input_policy": "submit_original_parked_request_to_existing_terminal",
            }),
        );
        if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
            &coordination.repo_path,
            Some(PathBuf::from(&coordination.db_path)),
        ) {
            let _ = kernel.task_resume_state(&task_id, &coordination.session_id);
        }
        let Some(instance) = ({
            let guard = terminals.read().await;
            guard.get(&pane_id).cloned()
        }) else {
            emit_terminal_monitor_coordination_event(
                &coordination,
                "terminal_parked_resume_abandoned",
                &pane_id,
                instance_id,
                Some(&task_id),
                json!({
                    "reason": "terminal_missing",
                }),
            );
            log_terminal_event(
                "terminal.prompt.parked_resume_abandoned",
                Some(&pane_id),
                Some(instance_id),
                None,
                json!({
                    "task_id": clean_terminal_telemetry_text(&task_id),
                    "reason": "terminal_missing",
                }),
            );
            if let Some(parked) = parked_prompts.write().await.remove(&parked_key) {
                mark_terminal_parked_prompt_lifecycle_in_cloud(
                    &cloud_mcp_state,
                    &parked,
                    "interrupted",
                    "Interrupted while parked: the terminal disappeared before the task could resume.",
                )
                .await;
                emit_terminal_parked_prompt_event(&app, &parked, "interrupted", Some("terminal_missing"));
            }
            return;
        };
        if instance.id != instance_id {
            emit_terminal_monitor_coordination_event(
                &coordination,
                "terminal_parked_resume_abandoned",
                &pane_id,
                instance_id,
                Some(&task_id),
                json!({
                    "reason": "terminal_replaced",
                    "current_instance_id": instance.id,
                }),
            );
            log_terminal_event(
                "terminal.prompt.parked_resume_abandoned",
                Some(&pane_id),
                Some(instance_id),
                None,
                json!({
                    "task_id": clean_terminal_telemetry_text(&task_id),
                    "reason": "terminal_replaced",
                    "current_instance_id": instance.id,
                }),
            );
            if let Some(parked) = parked_prompts.write().await.remove(&parked_key) {
                mark_terminal_parked_prompt_lifecycle_in_cloud(
                    &cloud_mcp_state,
                    &parked,
                    "interrupted",
                    "Interrupted while parked: the terminal session was replaced before the task could resume.",
                )
                .await;
                emit_terminal_parked_prompt_event(&app, &parked, "interrupted", Some("terminal_replaced"));
            }
            return;
        }
        let compact_title = clean_terminal_telemetry_text(&title)
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let compact_prompt = clean_terminal_telemetry_text(&prompt)
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let resume_request = if terminal_placeholder_task_body(&compact_prompt)
            || compact_prompt.eq_ignore_ascii_case("Continue the queued work now that the dependency has cleared.")
        {
            compact_title
        } else {
            compact_prompt
        };
        let resume_input_bytes =
            resume_request.len() + TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE.len();
        if resume_input_bytes > MAX_TERMINAL_WRITE_BYTES {
            emit_terminal_monitor_coordination_event(
                &coordination,
                "terminal_parked_resume_abandoned",
                &pane_id,
                instance_id,
                Some(&task_id),
                json!({
                    "reason": "resume_input_too_large",
                    "bytes": resume_input_bytes,
                }),
            );
            log_terminal_event(
                "terminal.prompt.parked_resume_abandoned",
                Some(&pane_id),
                Some(instance_id),
                None,
                json!({
                    "task_id": clean_terminal_telemetry_text(&task_id),
                    "reason": "resume_input_too_large",
                    "bytes": resume_input_bytes,
                }),
            );
            if let Some(parked) = parked_prompts.write().await.remove(&parked_key) {
                mark_terminal_parked_prompt_lifecycle_in_cloud(
                    &cloud_mcp_state,
                    &parked,
                    "interrupted",
                    "Interrupted while parked: the resume prompt was too large to send safely.",
                )
                .await;
                emit_terminal_parked_prompt_event(&app, &parked, "interrupted", Some("resume_input_too_large"));
            }
            return;
        }
        {
            let mut writer = instance.writer.lock().await;
            if let Err(error) = writer.write_all(resume_request.as_bytes()) {
                emit_terminal_monitor_coordination_event(
                    &coordination,
                    "terminal_parked_resume_write_failed",
                    &pane_id,
                    instance_id,
                    Some(&task_id),
                    json!({
                        "stage": "text",
                        "error": clean_terminal_telemetry_text(&error.to_string()),
                    }),
                );
                log_terminal_event(
                    "terminal.prompt.parked_resume_write_failed",
                    Some(&pane_id),
                    Some(instance_id),
                    None,
                    json!({
                        "task_id": clean_terminal_telemetry_text(&task_id),
                        "stage": "text",
                        "error": clean_terminal_telemetry_text(&error.to_string()),
                    }),
                );
                if let Some(parked) = parked_prompts.write().await.remove(&parked_key) {
                    mark_terminal_parked_prompt_lifecycle_in_cloud(
                        &cloud_mcp_state,
                        &parked,
                        "interrupted",
                        "Interrupted while parked: the terminal write failed when resuming the task.",
                    )
                    .await;
                    emit_terminal_parked_prompt_event(&app, &parked, "interrupted", Some("resume_write_failed"));
                }
                return;
            }
            if let Err(error) = writer.flush() {
                emit_terminal_monitor_coordination_event(
                    &coordination,
                    "terminal_parked_resume_write_failed",
                    &pane_id,
                    instance_id,
                    Some(&task_id),
                    json!({
                        "stage": "text_flush",
                        "error": clean_terminal_telemetry_text(&error.to_string()),
                    }),
                );
                log_terminal_event(
                    "terminal.prompt.parked_resume_write_failed",
                    Some(&pane_id),
                    Some(instance_id),
                    None,
                    json!({
                        "task_id": clean_terminal_telemetry_text(&task_id),
                        "stage": "text_flush",
                        "error": clean_terminal_telemetry_text(&error.to_string()),
                    }),
                );
                if let Some(parked) = parked_prompts.write().await.remove(&parked_key) {
                    mark_terminal_parked_prompt_lifecycle_in_cloud(
                        &cloud_mcp_state,
                        &parked,
                        "interrupted",
                        "Interrupted while parked: the terminal write failed when resuming the task.",
                    )
                    .await;
                    emit_terminal_parked_prompt_event(&app, &parked, "interrupted", Some("resume_write_failed"));
                }
                return;
            }
        }
        emit_terminal_monitor_coordination_event(
            &coordination,
            "terminal_parked_resume_text_written",
            &pane_id,
            instance_id,
            Some(&task_id),
            json!({
                "title": clean_terminal_telemetry_text(&title),
                "text_bytes": resume_request.len(),
                "submit_delay_ms": TERMINAL_PARKED_RESUME_SUBMIT_DELAY_MS,
                "submit_policy": "split_text_then_enter",
            }),
        );
        log_terminal_event(
            "terminal.prompt.parked_resume_text_written",
            Some(&pane_id),
            Some(instance_id),
            None,
            json!({
                "task_id": clean_terminal_telemetry_text(&task_id),
                "title": clean_terminal_telemetry_text(&title),
                "text_bytes": resume_request.len(),
                "submit_delay_ms": TERMINAL_PARKED_RESUME_SUBMIT_DELAY_MS,
                "submit_policy": "split_text_then_enter",
            }),
        );
        tokio::time::sleep(Duration::from_millis(TERMINAL_PARKED_RESUME_SUBMIT_DELAY_MS)).await;
        let mut writer = instance.writer.lock().await;
        if let Err(error) = writer.write_all(TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE.as_bytes()) {
            emit_terminal_monitor_coordination_event(
                &coordination,
                "terminal_parked_resume_write_failed",
                &pane_id,
                instance_id,
                Some(&task_id),
                json!({
                    "stage": "submit",
                    "error": clean_terminal_telemetry_text(&error.to_string()),
                }),
            );
            log_terminal_event(
                "terminal.prompt.parked_resume_write_failed",
                Some(&pane_id),
                Some(instance_id),
                None,
                json!({
                    "task_id": clean_terminal_telemetry_text(&task_id),
                    "stage": "submit",
                    "error": clean_terminal_telemetry_text(&error.to_string()),
                }),
            );
            if let Some(parked) = parked_prompts.write().await.remove(&parked_key) {
                mark_terminal_parked_prompt_lifecycle_in_cloud(
                    &cloud_mcp_state,
                    &parked,
                    "interrupted",
                    "Interrupted while parked: the terminal write failed when resuming the task.",
                )
                .await;
                emit_terminal_parked_prompt_event(&app, &parked, "interrupted", Some("resume_write_failed"));
            }
            return;
        }
        if let Err(error) = writer.flush() {
            emit_terminal_monitor_coordination_event(
                &coordination,
                "terminal_parked_resume_write_failed",
                &pane_id,
                instance_id,
                Some(&task_id),
                json!({
                    "stage": "submit_flush",
                    "error": clean_terminal_telemetry_text(&error.to_string()),
                }),
            );
            log_terminal_event(
                "terminal.prompt.parked_resume_write_failed",
                Some(&pane_id),
                Some(instance_id),
                None,
                json!({
                    "task_id": clean_terminal_telemetry_text(&task_id),
                    "stage": "submit_flush",
                    "error": clean_terminal_telemetry_text(&error.to_string()),
                }),
            );
            if let Some(parked) = parked_prompts.write().await.remove(&parked_key) {
                mark_terminal_parked_prompt_lifecycle_in_cloud(
                    &cloud_mcp_state,
                    &parked,
                    "interrupted",
                    "Interrupted while parked: the terminal write failed when resuming the task.",
                )
                .await;
                emit_terminal_parked_prompt_event(&app, &parked, "interrupted", Some("resume_write_failed"));
            }
            return;
        }
        if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
            &coordination.repo_path,
            Some(PathBuf::from(&coordination.db_path)),
        ) {
            let _ = kernel.mark_task_resume_requested(
                &task_id,
                &coordination.session_id,
                "dependency_ready_original_request_submitted",
            );
        }
        if let Some(parked) = parked_prompts.write().await.remove(&parked_key) {
            mark_terminal_parked_prompt_lifecycle_in_cloud(
                &cloud_mcp_state,
                &parked,
                "active",
                "Dependency completed; the parked task is resuming in the terminal.",
            )
            .await;
            emit_terminal_parked_prompt_event(&app, &parked, "resumed", Some("dependency_ready"));
        }
        emit_terminal_monitor_coordination_event(
            &coordination,
            "terminal_parked_resume_sent",
            &pane_id,
            instance_id,
            Some(&task_id),
            json!({
                "title": clean_terminal_telemetry_text(&title),
                "resume_input_bytes": resume_input_bytes,
                "submit_policy": "split_text_then_enter",
            }),
        );
        log_terminal_event(
            "terminal.prompt.parked_resume_sent",
            Some(&pane_id),
            Some(instance_id),
            None,
            json!({
                "task_id": clean_terminal_telemetry_text(&task_id),
                "title": clean_terminal_telemetry_text(&title),
                "resume_input_bytes": resume_input_bytes,
                "submit_policy": "split_text_then_enter",
            }),
        );
        return;
    }
    emit_terminal_monitor_coordination_event(
        &coordination,
        "terminal_parked_resume_timeout",
        &pane_id,
        instance_id,
        Some(&task_id),
        json!({
            "title": clean_terminal_telemetry_text(&title),
            "reason": "dependency_did_not_become_ready_before_timeout",
        }),
    );
    log_terminal_event(
        "terminal.prompt.parked_resume_timeout",
        Some(&pane_id),
        Some(instance_id),
        None,
        json!({
            "task_id": clean_terminal_telemetry_text(&task_id),
            "title": clean_terminal_telemetry_text(&title),
        }),
    );
    if let Some(parked) = parked_prompts.write().await.remove(&parked_key) {
        mark_terminal_parked_prompt_lifecycle_in_cloud(
            &cloud_mcp_state,
            &parked,
            "interrupted",
            "Interrupted while parked: the dependency did not become ready before the resume timeout.",
        )
        .await;
        emit_terminal_parked_prompt_event(&app, &parked, "interrupted", Some("resume_timeout"));
    }
}

async fn terminal_monitor_active_task_for_late_parking(
    app: AppHandle,
    cloud_mcp_state: CloudMcpState,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    parked_prompts: Arc<RwLock<HashMap<String, TerminalParkedPrompt>>>,
    pane_id: String,
    instance_id: u64,
    coordination: TerminalCoordinationSession,
    task_id: String,
    title: String,
    prompt: String,
) {
    let parked_key = terminal_parked_prompt_key(&pane_id, instance_id, &task_id);
    for _ in 0..1800 {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        if parked_prompts.read().await.contains_key(&parked_key) {
            return;
        }
        let Some(instance) = ({
            let guard = terminals.read().await;
            guard.get(&pane_id).cloned()
        }) else {
            return;
        };
        if instance.id != instance_id {
            return;
        }
        let active_task_matches = {
            let active_task = instance.active_task.lock().await;
            active_task
                .as_ref()
                .is_some_and(|active| active.task_id == task_id)
        };
        if !active_task_matches {
            return;
        }
        let snapshot = match terminal_parking_snapshot_from_kernel(&coordination) {
            Ok(Some(snapshot)) if snapshot.task_id == task_id => snapshot,
            Ok(_) => continue,
            Err(_) => continue,
        };
        if snapshot.terminal {
            return;
        }
        if snapshot.waiting_on.is_empty() && !snapshot.ready {
            continue;
        }

        let parked = TerminalParkedPrompt {
            pane_id: pane_id.clone(),
            instance_id,
            task_id: task_id.clone(),
            title: title.clone(),
            prompt: prompt.clone(),
            waiting_on: snapshot.waiting_on,
            coordination: coordination.clone(),
            working_directory: instance.working_directory.as_ref().clone(),
        };
        parked_prompts
            .write()
            .await
            .insert(parked_key.clone(), parked.clone());
        emit_terminal_parked_prompt_event(&app, &parked, "parked", Some("late_mcp_lease_block"));
        mark_terminal_parked_prompt_lifecycle_in_cloud(
            &cloud_mcp_state,
            &parked,
            "blocked",
            "Parked: the agent hit a local coordination lease block after the prompt was already running.",
        )
        .await;
        log_terminal_event(
            "terminal.prompt.late_parked_from_kernel_state",
            Some(&pane_id),
            Some(instance_id),
            None,
            json!({
                "task_id": clean_terminal_telemetry_text(&task_id),
                "title": clean_terminal_telemetry_text(&title),
                "task_status": snapshot.task_status,
                "session_status": snapshot.session_status,
                "ready": snapshot.ready,
            }),
        );
        tauri::async_runtime::spawn(terminal_resume_parked_prompt_when_ready(
            app,
            cloud_mcp_state,
            terminals,
            parked_prompts,
            pane_id,
            instance_id,
            coordination,
            task_id,
            title,
            prompt,
        ));
        return;
    }
}

async fn terminal_monitor_session_parking(
    app: AppHandle,
    cloud_mcp_state: CloudMcpState,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    parked_prompts: Arc<RwLock<HashMap<String, TerminalParkedPrompt>>>,
    pane_id: String,
    mut instance_id: u64,
    coordination: TerminalCoordinationSession,
) {
    log_terminal_event(
        "terminal.prompt.session_parking_monitor_started",
        Some(&pane_id),
        Some(instance_id),
        None,
        json!({
            "session_id": clean_terminal_telemetry_text(&coordination.session_id),
            "agent_id": clean_terminal_telemetry_text(&coordination.agent_id),
        }),
    );
    emit_terminal_monitor_coordination_event(
        &coordination,
        "terminal_session_parking_monitor_started",
        &pane_id,
        instance_id,
        None,
        json!({
            "session_id": coordination.session_id.clone(),
            "agent_id": coordination.agent_id.clone(),
        }),
    );

    let mut registered_parked_keys = HashSet::new();
    let mut missing_pane_ticks = 0usize;
    let mut last_observed_task_id: Option<String> = None;
    let mut last_snapshot_signature: Option<String> = None;
    let mut last_skip_signature: Option<String> = None;

    for tick in 0..7200 {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        let Some(instance) = ({
            let guard = terminals.read().await;
            guard.get(&pane_id).cloned()
        }) else {
            missing_pane_ticks += 1;
            if missing_pane_ticks >= 10 {
                emit_terminal_monitor_coordination_event(
                    &coordination,
                    "terminal_session_parking_monitor_stopped",
                    &pane_id,
                    instance_id,
                    None,
                    json!({
                        "reason": "pane_missing",
                        "missing_ticks": missing_pane_ticks,
                    }),
                );
                return;
            }
            continue;
        };
        missing_pane_ticks = 0;
        if instance.id != instance_id {
            let same_session = instance
                .coordination
                .as_ref()
                .is_some_and(|active| active.session_id == coordination.session_id);
            if same_session {
                let previous_instance_id = instance_id;
                instance_id = instance.id;
                emit_terminal_monitor_coordination_event(
                    &coordination,
                    "terminal_session_parking_monitor_rebound_instance",
                    &pane_id,
                    instance_id,
                    None,
                    json!({
                        "previous_instance_id": previous_instance_id,
                        "current_instance_id": instance_id,
                        "reason": "same_session_new_terminal_instance",
                    }),
                );
            } else {
                emit_terminal_monitor_coordination_event(
                    &coordination,
                    "terminal_session_parking_monitor_stopped",
                    &pane_id,
                    instance_id,
                    None,
                    json!({
                        "reason": "terminal_instance_replaced_by_different_session",
                        "current_instance_id": instance.id,
                        "current_session_id": instance.coordination.as_ref().map(|active| active.session_id.clone()),
                    }),
                );
                return;
            }
        }

        let snapshot = match terminal_parking_snapshot_from_kernel(&coordination) {
            Ok(Some(snapshot)) => snapshot,
            Ok(None) => {
                let skip_signature = format!("no_snapshot:{tick}");
                if tick < 5 || tick % 30 == 0 {
                    emit_terminal_monitor_coordination_event(
                        &coordination,
                        "terminal_session_parking_monitor_no_snapshot",
                        &pane_id,
                        instance_id,
                        None,
                        json!({
                            "reason": "session_has_no_attached_task_or_missing_task",
                            "tick": tick,
                            "session_id": coordination.session_id.clone(),
                        }),
                    );
                    last_skip_signature = Some(skip_signature);
                }
                continue;
            }
            Err(error) => {
                log_terminal_event(
                    "terminal.prompt.session_parking_monitor_error",
                    Some(&pane_id),
                    Some(instance_id),
                    None,
                    json!({
                        "error": clean_terminal_telemetry_text(&error),
                    }),
                );
                emit_terminal_monitor_coordination_event(
                    &coordination,
                    "terminal_session_parking_monitor_snapshot_error",
                    &pane_id,
                    instance_id,
                    None,
                    json!({
                        "error": clean_terminal_telemetry_text(&error),
                        "tick": tick,
                    }),
                );
                continue;
            }
        };

        let task_id = snapshot.task_id.clone();
        let snapshot_signature = terminal_parking_snapshot_signature(&snapshot);
        if last_snapshot_signature.as_deref() != Some(snapshot_signature.as_str()) {
            emit_terminal_monitor_coordination_event(
                &coordination,
                "terminal_session_parking_monitor_snapshot",
                &pane_id,
                instance_id,
                Some(&task_id),
                json!({
                    "tick": tick,
                    "task_status": snapshot.task_status.clone(),
                    "session_status": snapshot.session_status.clone(),
                    "ready": snapshot.ready,
                    "terminal": snapshot.terminal,
                    "waiting_on_count": snapshot.waiting_on.len(),
                    "waiting_on": snapshot.waiting_on.clone(),
                    "signature": snapshot_signature.clone(),
                }),
            );
            last_snapshot_signature = Some(snapshot_signature.clone());
        }
        if last_observed_task_id.as_deref() != Some(task_id.as_str()) {
            emit_terminal_monitor_coordination_event(
                &coordination,
                "terminal_session_parking_monitor_task_observed",
                &pane_id,
                instance_id,
                Some(&task_id),
                json!({
                    "previous_task_id": last_observed_task_id.clone(),
                    "task_id": task_id.clone(),
                    "task_status": snapshot.task_status.clone(),
                    "session_status": snapshot.session_status.clone(),
                }),
            );
            last_observed_task_id = Some(task_id.clone());
        }
        let title = snapshot.title.clone();
        let task_status = snapshot.task_status.clone();
        let parked_key = terminal_parked_prompt_key(&pane_id, instance_id, &task_id);

        if snapshot.terminal {
            let skip_signature = format!("terminal:{snapshot_signature}");
            if last_skip_signature.as_deref() != Some(skip_signature.as_str()) {
                emit_terminal_monitor_coordination_event(
                    &coordination,
                    "terminal_session_parking_monitor_skip",
                    &pane_id,
                    instance_id,
                    Some(&task_id),
                    json!({
                        "reason": "task_status_is_terminal",
                        "task_status": task_status.clone(),
                        "session_status": snapshot.session_status.clone(),
                        "ready": snapshot.ready,
                        "waiting_on_count": snapshot.waiting_on.len(),
                    }),
                );
                last_skip_signature = Some(skip_signature);
            }
            if let Some(parked) = parked_prompts.write().await.remove(&parked_key) {
                emit_terminal_parked_prompt_event(&app, &parked, "resumed", Some("task_terminal"));
            }
            let mut active_task = instance.active_task.lock().await;
            if active_task
                .as_ref()
                .is_some_and(|task| task.task_id == task_id)
            {
                *active_task = None;
            }
            continue;
        }

        {
            let mut active_task = instance.active_task.lock().await;
            if !active_task
                .as_ref()
                .is_some_and(|task| task.task_id == task_id)
            {
                *active_task = Some(TerminalActiveTask {
                    task_id: task_id.clone(),
                    title: title.clone(),
                });
            }
        }

        let waiting_on = snapshot.waiting_on.clone();
        let ready = snapshot.ready;
        let should_register_parked_prompt = !waiting_on.is_empty() || ready;
        if !should_register_parked_prompt {
            let skip_signature = format!("empty:{snapshot_signature}");
            if last_skip_signature.as_deref() != Some(skip_signature.as_str()) {
                emit_terminal_monitor_coordination_event(
                    &coordination,
                    "terminal_session_parking_monitor_skip",
                    &pane_id,
                    instance_id,
                    Some(&task_id),
                    json!({
                        "reason": "no_waiting_on_and_not_ready",
                        "task_status": task_status.clone(),
                        "session_status": snapshot.session_status.clone(),
                        "ready": ready,
                        "terminal": snapshot.terminal,
                        "waiting_on_count": snapshot.waiting_on.len(),
                    }),
                );
                last_skip_signature = Some(skip_signature);
            }
            continue;
        }

        let mut inserted = None;
        let mut updated = None;
        {
            let mut guard = parked_prompts.write().await;
            if let Some(existing) = guard.get_mut(&parked_key) {
                if existing.waiting_on != waiting_on {
                    existing.waiting_on = waiting_on;
                    updated = Some(existing.clone());
                }
            } else if registered_parked_keys.contains(&parked_key) {
                emit_terminal_monitor_coordination_event(
                    &coordination,
                    "terminal_session_parked_prompt_duplicate_suppressed",
                    &pane_id,
                    instance_id,
                    Some(&task_id),
                    json!({
                        "reason": "registered_key_already_seen_without_in_memory_prompt",
                        "ready": ready,
                        "task_status": task_status.clone(),
                        "session_status": snapshot.session_status.clone(),
                        "waiting_on_count": snapshot.waiting_on.len(),
                    }),
                );
                continue;
            } else {
                let parked = TerminalParkedPrompt {
                    pane_id: pane_id.clone(),
                    instance_id,
                    task_id: task_id.clone(),
                    title: title.clone(),
                    prompt: snapshot.prompt.clone(),
                    waiting_on,
                    coordination: coordination.clone(),
                    working_directory: instance.working_directory.as_ref().clone(),
                };
                guard.insert(parked_key.clone(), parked.clone());
                registered_parked_keys.insert(parked_key.clone());
                inserted = Some(parked);
            }
        }

        if let Some(parked) = updated {
            emit_terminal_parked_prompt_event(
                &app,
                &parked,
                "parked",
                Some("session_blocker_list_updated"),
            );
        }

        if let Some(parked) = inserted {
            let reason = if ready {
                "missed_ready_parked_task_recovered"
            } else {
                "session_task_blocked"
            };
            emit_terminal_parked_prompt_event(&app, &parked, "parked", Some(reason));
            emit_terminal_monitor_coordination_event(
                &coordination,
                "terminal_session_parked_prompt_registered",
                &pane_id,
                instance_id,
                Some(&task_id),
                json!({
                    "reason": reason,
                    "ready": ready,
                    "task_status": task_status,
                    "session_status": snapshot.session_status,
                    "waiting_on": parked.waiting_on.clone(),
                }),
            );
            mark_terminal_parked_prompt_lifecycle_in_cloud(
                &cloud_mcp_state,
                &parked,
                if ready { "active" } else { "blocked" },
                if ready {
                    "Dependency completed; the parked task is being resumed automatically."
                } else {
                    "Parked: waiting for another agent's accepted patch before continuing."
                },
            )
            .await;
            log_terminal_event(
                "terminal.prompt.session_parked_from_kernel_state",
                Some(&pane_id),
                Some(instance_id),
                None,
                json!({
                    "task_id": clean_terminal_telemetry_text(&task_id),
                    "title": clean_terminal_telemetry_text(&title),
                    "task_status": task_status,
                    "ready": ready,
                    "reason": reason,
                }),
            );
            tauri::async_runtime::spawn(terminal_resume_parked_prompt_when_ready(
                app.clone(),
                cloud_mcp_state.clone(),
                terminals.clone(),
                parked_prompts.clone(),
                pane_id.clone(),
                instance_id,
                coordination.clone(),
                task_id,
                title,
                parked.prompt,
            ));
        }
    }

    log_terminal_event(
        "terminal.prompt.session_parking_monitor_timeout",
        Some(&pane_id),
        Some(instance_id),
        None,
        json!({
            "session_id": clean_terminal_telemetry_text(&coordination.session_id),
            "agent_id": clean_terminal_telemetry_text(&coordination.agent_id),
        }),
    );
}

#[tauri::command]
async fn terminal_write(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    pane_id: String,
    instance_id: Option<u64>,
    data: String,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
    let Some(instance) = get_terminal_instance_if_current(&state, &pane_id, instance_id).await?
    else {
        log_terminal_event(
            "terminal.write.skipped_stale_or_missing",
            Some(&pane_id),
            instance_id,
            None,
            json!({ "bytes": data.len() }),
        );
        return Ok(());
    };
    let mut data_to_write = data.clone();

    if let Some(prompt) = terminal_observe_submitted_prompt(&instance, &data).await {
        if *instance.agent_started.lock().await {
            let prepared_coordination_task = if let Some(coordination) = instance.coordination.as_ref() {
                match terminal_prepare_coordination_task_for_prompt(
                    coordination,
                    &prompt,
                    &pane_id,
                    instance.id,
                ) {
                    Ok(task) => task,
                    Err(error) => {
                        log_terminal_event(
                            "terminal.prompt.coordination_task_error",
                            Some(&pane_id),
                            Some(instance.id),
                            None,
                            json!({
                                "agent_id": clean_terminal_telemetry_text(&coordination.agent_id),
                                "session_id": clean_terminal_telemetry_text(&coordination.session_id),
                                "error": clean_terminal_telemetry_text(&error),
                            }),
                        );
                        None
                    }
                }
            } else {
                None
            };
            let cloud_state = cloud_mcp_state.inner().clone();
            let pane_id_for_context = pane_id.clone();
            let working_directory = instance.working_directory.as_ref().clone();
            let coordination = instance.coordination.clone();
            let terminal_instance_id = instance.id;
            if let Some(task) = prepared_coordination_task.as_ref() {
                let mut active_task = instance.active_task.lock().await;
                *active_task = Some(TerminalActiveTask {
                    task_id: task.task_id.clone(),
                    title: task.title.clone(),
                });
                if task.partial {
                    data_to_write = terminal_partial_parking_prompt(
                        &prompt,
                        &task.runnable_resources,
                        &task.parked_resources,
                    );
                    log_terminal_event(
                        "terminal.prompt.partial_park",
                        Some(&pane_id),
                        Some(instance.id),
                        None,
                        json!({
                            "task_id": clean_terminal_telemetry_text(&task.task_id),
                            "runnable_resources": task.runnable_resources.clone(),
                            "parked_resources": task.parked_resources.clone(),
                        }),
                    );
                }
            }
            let local_task_id = prepared_coordination_task
                .as_ref()
                .map(|task| task.task_id.clone());
            let local_task_title = prepared_coordination_task
                .as_ref()
                .map(|task| task.title.clone());
            let parked_task = prepared_coordination_task.as_ref().and_then(|task| {
                (task.parked || task.partial).then(|| {
                    (
                        task.task_id.clone(),
                        task.title.clone(),
                        task.parking_details.clone(),
                        task.intent_resources.clone(),
                        task.parked,
                    )
                })
            });
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
                )
                .await;
            });
            if let (Some(coordination), Some(task)) =
                (instance.coordination.clone(), prepared_coordination_task.as_ref())
            {
                if !task.parked && !task.partial {
                    tauri::async_runtime::spawn(terminal_monitor_active_task_for_late_parking(
                        app.clone(),
                        cloud_mcp_state.inner().clone(),
                        state.terminals.clone(),
                        state.parked_prompts.clone(),
                        pane_id.clone(),
                        instance.id,
                        coordination,
                        task.task_id.clone(),
                        task.title.clone(),
                        prompt.clone(),
                    ));
                }
            }
            if let (Some(coordination), Some((task_id, title, parking_details, intent_resources, fully_parked))) =
                (instance.coordination.clone(), parked_task)
            {
                let waiting_on = terminal_parked_waiting_on_from_details(&parking_details);
                let parked = TerminalParkedPrompt {
                    pane_id: pane_id.clone(),
                    instance_id: instance.id,
                    task_id: task_id.clone(),
                    title: title.clone(),
                    prompt: prompt.clone(),
                    waiting_on,
                    coordination: coordination.clone(),
                    working_directory: instance.working_directory.as_ref().clone(),
                };
                let parked_key = terminal_parked_prompt_key(&pane_id, instance.id, &task_id);
                state
                    .parked_prompts
                    .write()
                    .await
                    .insert(parked_key, parked.clone());
                emit_terminal_parked_prompt_event(&app, &parked, "parked", Some("waiting_for_dependency"));
                let cloud_state_for_parked = cloud_mcp_state.inner().clone();
                let parked_for_cloud = parked.clone();
                tauri::async_runtime::spawn(async move {
                    cloud_mcp_mark_terminal_task_lifecycle(
                        &cloud_state_for_parked,
                        &parked_for_cloud.pane_id,
                        parked_for_cloud.instance_id,
                        &parked_for_cloud.working_directory,
                        Some(&parked_for_cloud.coordination),
                        Some(&parked_for_cloud.task_id),
                        Some(&parked_for_cloud.title),
                        "blocked",
                        "terminal-agent",
                        "Parked: waiting for another agent's accepted patch before continuing.",
                    )
                    .await;
                });
                log_terminal_event(
                    "terminal.prompt.write_parked",
                    Some(&pane_id),
                    Some(instance.id),
                    None,
                    json!({
                        "task_id": clean_terminal_telemetry_text(&task_id),
                        "title": clean_terminal_telemetry_text(&title),
                        "intent_resources": intent_resources,
                        "parking_details": parking_details,
                    }),
                );
                tauri::async_runtime::spawn(terminal_resume_parked_prompt_when_ready(
                    app.clone(),
                    cloud_mcp_state.inner().clone(),
                    state.terminals.clone(),
                    state.parked_prompts.clone(),
                    pane_id.clone(),
                    instance.id,
                    coordination,
                    task_id,
                    title,
                    prompt,
                ));
                if fully_parked {
                    return Ok(());
                }
            }
        }
    }

    write_terminal_input(
        &state,
        &pane_id,
        instance_id,
        &data_to_write,
        "terminal.write.skipped_stale_or_missing",
    )
    .await
    .map(|_| ())
}

#[tauri::command]
async fn terminal_delete_selection(
    state: State<'_, TerminalState>,
    pane_id: String,
    instance_id: Option<u64>,
    selection: String,
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
        log_terminal_event(
            "terminal.selection_delete.skipped_stale_or_missing",
            Some(&pane_id),
            instance_id,
            None,
            json!({ "selected_chars": selected_text.chars().count() }),
        );
        return Ok(json!({
            "deleted": false,
            "reason": "stale_or_missing_terminal",
        }));
    };

    let mut gate = instance.input_gate.lock().await;
    let current_line = gate.current_line.clone();
    let Some(start) = current_line.rfind(&selected_text) else {
        log_terminal_event(
            "terminal.selection_delete.selection_not_in_current_input",
            Some(&pane_id),
            Some(instance.id),
            None,
            json!({
                "current_line_chars": current_line.chars().count(),
                "selected_chars": selected_text.chars().count(),
            }),
        );
        return Ok(json!({
            "deleted": false,
            "reason": "selection_not_in_current_input",
        }));
    };

    let end = start + selected_text.len();
    let mut next_line = current_line;
    next_line.replace_range(start..end, "");
    let rewrite_input = format!("\u{15}{next_line}");
    if rewrite_input.len() > MAX_TERMINAL_WRITE_BYTES {
        return Err("Terminal rewrite input is too large.".to_string());
    }

    {
        let mut writer = instance.writer.lock().await;
        writer
            .write_all(rewrite_input.as_bytes())
            .map_err(|error| format!("Unable to write terminal selection delete: {error}"))?;
        writer
            .flush()
            .map_err(|error| format!("Unable to flush terminal selection delete: {error}"))?;
    }

    gate.current_line = next_line;
    gate.current_line_user_touched = true;
    log_terminal_event(
        "terminal.selection_delete.applied",
        Some(&pane_id),
        Some(instance.id),
        None,
        json!({
            "remaining_chars": gate.current_line.chars().count(),
            "removed_chars": selected_text.chars().count(),
        }),
    );

    Ok(json!({
        "deleted": true,
        "remaining_chars": gate.current_line.chars().count(),
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

    if let Some(instance) = get_terminal_instance_if_current(&state, &pane_id, Some(instance_id)).await? {
        let mut active_task = instance.active_task.lock().await;
        if active_task
            .as_ref()
            .is_some_and(|task| task.task_id == parked.task_id)
        {
            *active_task = None;
        }
    }

    cloud_mcp_mark_terminal_task_lifecycle(
        cloud_mcp_state.inner(),
        &parked.pane_id,
        parked.instance_id,
        &parked.working_directory,
        Some(&parked.coordination),
        Some(&parked.task_id),
        Some(&parked.title),
        "cancelled",
        "terminal-agent",
        "Cancelled before resuming: the parked task was cancelled from the terminal bar.",
    )
    .await;
    emit_terminal_parked_prompt_event(&app, &parked, "cancelled", Some("cancel_button"));
    log_terminal_event(
        "terminal.prompt.parked_cancelled",
        Some(&pane_id),
        Some(instance_id),
        None,
        json!({
            "task_id": clean_terminal_telemetry_text(&task_id),
        }),
    );

    Ok(())
}

#[tauri::command]
async fn terminal_get_parked_prompt(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    pane_id: String,
    instance_id: Option<u64>,
) -> Result<Option<TerminalParkedPromptPayload>, String> {
    validate_terminal_pane_id(&pane_id)?;
    if let Some(existing) = {
        let guard = state.parked_prompts.read().await;
        guard
            .values()
            .find(|parked| {
                parked.pane_id == pane_id
                    && instance_id.map_or(true, |expected| expected == parked.instance_id)
            })
            .cloned()
    } {
        emit_terminal_monitor_coordination_event(
            &existing.coordination,
            "terminal_parked_prompt_poll_existing",
            &existing.pane_id,
            existing.instance_id,
            Some(&existing.task_id),
            json!({
                "reason": "existing_backend_prompt",
                "waiting_on_count": existing.waiting_on.len(),
                "waiting_on": existing.waiting_on.clone(),
                "requested_instance_id": instance_id,
            }),
        );
        return Ok(Some(TerminalParkedPromptPayload {
            pane_id: existing.pane_id,
            instance_id: existing.instance_id,
            task_id: existing.task_id,
            title: existing.title,
            status: "parked".to_string(),
            waiting_on: existing.waiting_on,
            reason: Some("existing_backend_prompt".to_string()),
        }));
    }

    let Some(instance) = get_terminal_instance_if_current(&state, &pane_id, instance_id).await?
    else {
        return Ok(None);
    };
    let Some(coordination) = instance.coordination.clone() else {
        return Ok(None);
    };
    emit_terminal_monitor_coordination_event(
        &coordination,
        "terminal_parked_prompt_poll_invoked",
        &pane_id,
        instance.id,
        None,
        json!({
            "requested_instance_id": instance_id,
            "session_id": coordination.session_id.clone(),
            "agent_id": coordination.agent_id.clone(),
        }),
    );
    let snapshot = match terminal_parking_snapshot_from_kernel(&coordination) {
        Ok(Some(snapshot)) => snapshot,
        Ok(None) => {
            emit_terminal_monitor_coordination_event(
                &coordination,
                "terminal_parked_prompt_poll_skip",
                &pane_id,
                instance.id,
                None,
                json!({
                    "reason": "no_snapshot",
                    "session_id": coordination.session_id.clone(),
                }),
            );
            return Ok(None);
        }
        Err(error) => {
            emit_terminal_monitor_coordination_event(
                &coordination,
                "terminal_parked_prompt_poll_error",
                &pane_id,
                instance.id,
                None,
                json!({
                    "error": clean_terminal_telemetry_text(&error),
                }),
            );
            return Err(error);
        }
    };

    let task_id = snapshot.task_id.clone();
    let title = snapshot.title.clone();
    let task_status = snapshot.task_status.clone();
    let session_status = snapshot.session_status.clone();
    if snapshot.terminal {
        emit_terminal_monitor_coordination_event(
            &coordination,
            "terminal_parked_prompt_poll_skip",
            &pane_id,
            instance.id,
            Some(&task_id),
            json!({
                "reason": "task_status_is_terminal",
                "task_status": task_status,
                "session_status": session_status,
                "ready": snapshot.ready,
                "waiting_on_count": snapshot.waiting_on.len(),
            }),
        );
        return Ok(None);
    }

    let waiting_on = snapshot.waiting_on.clone();
    let ready = snapshot.ready;
    if waiting_on.is_empty() && !ready {
        emit_terminal_monitor_coordination_event(
            &coordination,
            "terminal_parked_prompt_poll_skip",
            &pane_id,
            instance.id,
            Some(&task_id),
            json!({
                "reason": "no_waiting_on_and_not_ready",
                "task_status": task_status,
                "session_status": session_status,
                "ready": ready,
                "waiting_on_count": waiting_on.len(),
                "signature": terminal_parking_snapshot_signature(&snapshot),
            }),
        );
        return Ok(None);
    }

    let parked = TerminalParkedPrompt {
        pane_id: pane_id.clone(),
        instance_id: instance.id,
        task_id: task_id.clone(),
        title: title.clone(),
        prompt: snapshot.prompt.clone(),
        waiting_on: waiting_on.clone(),
        coordination: coordination.clone(),
        working_directory: instance.working_directory.as_ref().clone(),
    };
    let parked_key = terminal_parked_prompt_key(&pane_id, instance.id, &task_id);
    let inserted = {
        let mut guard = state.parked_prompts.write().await;
        if guard.contains_key(&parked_key) {
            false
        } else {
            guard.insert(parked_key, parked.clone());
            true
        }
    };
    if inserted {
        emit_terminal_parked_prompt_event(
            &app,
            &parked,
            "parked",
            Some("frontend_poll_recovered"),
        );
        emit_terminal_monitor_coordination_event(
            &coordination,
            "terminal_session_parked_prompt_recovered_by_poll",
            &pane_id,
            instance.id,
            Some(&task_id),
            json!({
                "ready": ready,
                "task_status": task_status,
                "session_status": session_status,
                "waiting_on": waiting_on.clone(),
            }),
        );
        tauri::async_runtime::spawn(terminal_resume_parked_prompt_when_ready(
            app.clone(),
            cloud_mcp_state.inner().clone(),
            state.terminals.clone(),
            state.parked_prompts.clone(),
            pane_id.clone(),
            instance.id,
            coordination.clone(),
            task_id.clone(),
            title.clone(),
            parked.prompt.clone(),
        ));
    } else {
        emit_terminal_monitor_coordination_event(
            &coordination,
            "terminal_parked_prompt_poll_existing_after_race",
            &pane_id,
            instance.id,
            Some(&task_id),
            json!({
                "ready": ready,
                "task_status": task_status,
                "session_status": session_status,
                "waiting_on_count": waiting_on.len(),
            }),
        );
    }

    Ok(Some(TerminalParkedPromptPayload {
        pane_id,
        instance_id: instance.id,
        task_id,
        title,
        status: "parked".to_string(),
        waiting_on,
        reason: Some("frontend_poll".to_string()),
    }))
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

    {
        let mut writer = instance.writer.lock().await;
        writer
            .write_all(b"\x1b")
            .map_err(|error| format!("Unable to send terminal interrupt: {error}"))?;
        writer
            .flush()
            .map_err(|error| format!("Unable to flush terminal interrupt: {error}"))?;
    }

    let active_task = instance.active_task.lock().await.clone();
    if let (Some(coordination), Some(active_task)) = (instance.coordination.as_ref(), active_task.as_ref()) {
        if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
            &coordination.repo_path,
            Some(PathBuf::from(&coordination.db_path)),
        ) {
            let _ = kernel.mark_terminal_task_stopped(
                &active_task.task_id,
                &coordination.session_id,
                "interrupted",
                &reason,
            );
        }
        cloud_mcp_mark_terminal_task_lifecycle(
            cloud_mcp_state.inner(),
            &pane_id,
            instance.id,
            instance.working_directory.as_ref(),
            Some(coordination),
            Some(&active_task.task_id),
            Some(&active_task.title),
            "interrupted",
            "terminal-agent",
            "Interrupted by Escape; the terminal remains open for follow-up instructions.",
        )
        .await;
        let mut stored_active_task = instance.active_task.lock().await;
        if stored_active_task
            .as_ref()
            .is_some_and(|task| task.task_id == active_task.task_id)
        {
            *stored_active_task = None;
        }
    }

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
        cloud_mcp_mark_terminal_task_lifecycle(
            cloud_mcp_state.inner(),
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
        emit_terminal_parked_prompt_event(&app, &parked, "interrupted", Some("escape_key"));
    }

    log_terminal_event(
        "terminal.agent_interrupted_by_escape",
        Some(&pane_id),
        Some(instance.id),
        None,
        json!({
            "reason": clean_terminal_telemetry_text(&reason),
            "task_id": active_task.as_ref().map(|task| clean_terminal_telemetry_text(&task.task_id)),
        }),
    );

    Ok(())
}

async fn resize_terminal_instance(
    instance: &TerminalInstance,
    size: PtySize,
) -> Result<bool, String> {
    let mut current_size = instance.size.lock().await;

    if *current_size == size {
        return Ok(false);
    }

    let master = instance.master.lock().await;

    master
        .resize(size)
        .map_err(|error| format!("Unable to resize terminal: {error}"))?;
    *current_size = size;

    Ok(true)
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
    state: State<'_, TerminalState>,
    pane_id: Option<String>,
    instance_id: Option<u64>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let resize_started_at = Instant::now();
    log_terminal_event(
        "terminal.resize_terminal.start",
        pane_id.as_deref(),
        instance_id,
        None,
        json!({ "cols": cols, "rows": rows }),
    );

    let size = validate_terminal_size(cols, rows)?;
    let Some((resolved_pane_id, instance)) =
        resolve_terminal_for_resize(&state, pane_id.clone(), instance_id).await?
    else {
        log_terminal_event(
            "terminal.resize_terminal.skipped_stale",
            pane_id.as_deref(),
            instance_id,
            Some(resize_started_at.elapsed()),
            json!({ "cols": cols, "rows": rows }),
        );
        return Ok(());
    };

    let applied = resize_terminal_instance(&instance, size).await?;
    log_terminal_event(
        "terminal.resize_terminal.done",
        Some(&resolved_pane_id),
        Some(instance.id),
        Some(resize_started_at.elapsed()),
        json!({ "cols": cols, "rows": rows, "applied": applied }),
    );

    Ok(())
}

#[tauri::command]
async fn terminal_resize(
    state: State<'_, TerminalState>,
    pane_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let resize_started_at = Instant::now();
    log_terminal_event(
        "terminal.resize.start",
        Some(&pane_id),
        None,
        None,
        json!({ "cols": cols, "rows": rows }),
    );
    validate_terminal_pane_id(&pane_id)?;

    let size = validate_terminal_size(cols, rows)?;
    let instance = get_terminal_instance(&state, &pane_id).await?;
    let applied = resize_terminal_instance(&instance, size).await?;
    log_terminal_event(
        "terminal.resize.done",
        Some(&pane_id),
        Some(instance.id),
        Some(resize_started_at.elapsed()),
        json!({ "cols": cols, "rows": rows, "applied": applied }),
    );

    Ok(())
}

#[tauri::command]
async fn terminal_close(
    state: State<'_, TerminalState>,
    pane_id: String,
    instance_id: Option<u64>,
) -> Result<(), String> {
    let lifecycle_lock = Arc::clone(&state.lifecycle_lock);
    let _lifecycle_guard = lifecycle_lock.lock().await;
    let close_started_at = Instant::now();
    log_terminal_event(
        "terminal.close.start",
        Some(&pane_id),
        instance_id,
        None,
        json!({}),
    );

    match close_terminal_session(&state, &pane_id, instance_id).await {
        Ok(closed) => {
            log_terminal_event(
                "terminal.close.done",
                Some(&pane_id),
                instance_id,
                Some(close_started_at.elapsed()),
                json!({ "closed": closed }),
            );
        }
        Err(error) => {
            log_terminal_event(
                "terminal.close.error",
                Some(&pane_id),
                instance_id,
                Some(close_started_at.elapsed()),
                json!({ "error": error }),
            );
            return Err(error);
        }
    }

    Ok(())
}

#[tauri::command]
async fn terminal_close_all(
    app: AppHandle,
    state: State<'_, TerminalState>,
) -> Result<TerminalCloseAllResult, String> {
    let lifecycle_lock = Arc::clone(&state.lifecycle_lock);
    let _lifecycle_guard = lifecycle_lock.lock().await;
    let closed = close_all_terminal_sessions(app, &state).await?;

    Ok(TerminalCloseAllResult { closed })
}

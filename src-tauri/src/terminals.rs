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
    let process_working_directory = workspace_path_for_process(&working_directory);
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
                        "cwd_policy": "project_root_visible_branch_root_editable",
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
        let warm_pty = match create_agent_terminal_pty(
            size,
            &command_path,
            &args,
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
            "command": clean_terminal_telemetry_text(&command),
            "prewarm_pty": is_prewarm_pty,
            "repo_working_directory": workspace_path_display(&working_directory),
            "working_directory": workspace_path_display(&process_working_directory),
            "agent_branch_root": coordination_context
                .as_ref()
                .map(|context| clean_terminal_telemetry_text(&context.write_root)),
            "cwd_policy": if coordination_context.is_some() {
                "project_root_visible_branch_root_editable"
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
        output_channel,
        reader,
    );
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
                "project_root_visible_branch_root_editable"
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
async fn terminal_start_agent(
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
    let input = terminal_agent_start_input_in_directory(
        &command_path,
        &args,
        instance.working_directory.as_ref(),
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
    log_terminal_event(
        "terminal.agent_start.write",
        Some(&pane_id),
        Some(instance.id),
        Some(write_started_at.elapsed()),
        json!({
            "provider": definition.id,
            "command": clean_terminal_telemetry_text(&command_path),
            "arg_count": args.len(),
            "bytes": input.len(),
            "working_directory": workspace_path_display(instance.working_directory.as_ref()),
        }),
    );

    Ok(())
}

async fn start_terminal_agent_in_prepared_pty(
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
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
        let input = terminal_agent_start_input_in_directory(
            &command_path,
            &args,
            instance.working_directory.as_ref(),
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
                log_terminal_event(
                    "terminal.agent_start_many.write_done",
                    Some(&pane_id),
                    Some(instance.id),
                    Some(write_started_at.elapsed()),
                    json!({
                        "provider": definition.id,
                        "command": clean_terminal_telemetry_text(&command_path),
                        "arg_count": args.len(),
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

        join_set
            .spawn(async move { start_terminal_agent_in_prepared_pty(terminals, request).await });
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

struct TerminalSubmittedPrompt {
    prompt: String,
    bypass_cloud_plan: bool,
    stale_restored_prompt: bool,
}

fn terminal_normalize_prompt_for_gate(prompt: &str) -> String {
    let mut normalized = prompt
        .replace("[200~", "")
        .replace("[201~", "")
        .replace("\u{1b}[200~", "")
        .replace("\u{1b}[201~", "");
    normalized.retain(|character| !character.is_control());
    let mut normalized = normalized.trim().to_string();

    loop {
        let next = normalized
            .strip_prefix('>')
            .or_else(|| normalized.strip_prefix('›'))
            .or_else(|| normalized.strip_prefix('$'))
            .or_else(|| normalized.strip_prefix('#'))
            .map(str::trim_start);
        let Some(next) = next else {
            break;
        };
        normalized = next.to_string();
    }

    normalized
}

fn terminal_control_followup_bypass_count(prompt: &str) -> usize {
    let prompt = terminal_normalize_prompt_for_gate(prompt);
    let lower = prompt.to_ascii_lowercase();
    if lower.starts_with("/model") {
        return 1;
    }

    0
}

fn terminal_is_control_prompt(prompt: &str) -> bool {
    let prompt = terminal_normalize_prompt_for_gate(prompt);
    if prompt.is_empty() {
        return true;
    }
    if prompt.starts_with('/') {
        return true;
    }

    matches!(
        prompt.to_ascii_lowercase().as_str(),
        "exit"
            | "quit"
            | "clear"
            | "cls"
            | "reset"
            | "y"
            | "yes"
            | "n"
            | "no"
            | "cancel"
    )
}

fn terminal_prompt_requires_cloud_plan(prompt: &str) -> bool {
    let prompt = terminal_normalize_prompt_for_gate(prompt);
    !terminal_is_control_prompt(&prompt)
}

fn terminal_capture_submitted_prompt_from_gate(
    gate: &mut TerminalInputGate,
    data: &str,
) -> Option<TerminalSubmittedPrompt> {
    let mut submitted = None;

    for character in data.chars() {
        if gate.ansi_escape_active {
            if gate.ansi_csi_active {
                if ('@'..='~').contains(&character) {
                    gate.ansi_escape_active = false;
                    gate.ansi_csi_active = false;
                }
            } else if character == '[' {
                gate.ansi_csi_active = true;
            } else {
                gate.ansi_escape_active = false;
                gate.ansi_csi_active = false;
            }
            continue;
        }

        match character {
            '\u{1b}' => {
                gate.ansi_escape_active = true;
                gate.ansi_csi_active = false;
            }
            '\r' | '\n' => {
                let prompt = gate.current_line.trim().to_string();
                let normalized_prompt = terminal_normalize_prompt_for_gate(&prompt);
                let line_user_touched = gate.current_line_user_touched;
                let control_prompt = terminal_is_control_prompt(&prompt);
                let bypass_followup = gate.control_command_bypass_submits > 0;
                if bypass_followup {
                    gate.control_command_bypass_submits =
                        gate.control_command_bypass_submits.saturating_sub(1);
                }
                gate.control_command_bypass_submits =
                    terminal_control_followup_bypass_count(&prompt);
                gate.current_line.clear();
                gate.current_line_user_touched = false;
                if !normalized_prompt.is_empty() {
                    submitted = Some(TerminalSubmittedPrompt {
                        prompt,
                        bypass_cloud_plan: control_prompt || bypass_followup || !line_user_touched,
                        stale_restored_prompt: !line_user_touched,
                    });
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

async fn terminal_capture_submitted_prompt(
    instance: &TerminalInstance,
    data: &str,
) -> Option<TerminalSubmittedPrompt> {
    let mut gate = instance.input_gate.lock().await;
    terminal_capture_submitted_prompt_from_gate(&mut gate, data)
}

async fn terminal_instance_requires_cloud_prompt_gate(instance: &TerminalInstance) -> bool {
    if instance.coordination.is_none() {
        return false;
    }

    *instance.agent_started.lock().await
}

#[cfg(test)]
mod terminal_input_gate_tests {
    use super::*;

    #[test]
    fn empty_enter_does_not_submit_prompt() {
        let mut gate = TerminalInputGate::default();

        let submitted = terminal_capture_submitted_prompt_from_gate(&mut gate, "\r");

        assert!(submitted.is_none());
    }

    #[test]
    fn typed_prompt_submits_when_enter_arrives_separately() {
        let mut gate = TerminalInputGate::default();

        assert!(terminal_capture_submitted_prompt_from_gate(&mut gate, "fix the bug").is_none());
        let submitted = terminal_capture_submitted_prompt_from_gate(&mut gate, "\r").unwrap();

        assert_eq!(submitted.prompt, "fix the bug");
        assert!(!submitted.bypass_cloud_plan);
        assert!(!submitted.stale_restored_prompt);
    }

    #[test]
    fn stale_restored_prompt_is_marked_on_blank_enter() {
        let mut gate = TerminalInputGate {
            current_line: "fix the bug".to_string(),
            current_line_user_touched: false,
            ..TerminalInputGate::default()
        };

        let submitted = terminal_capture_submitted_prompt_from_gate(&mut gate, "\r").unwrap();

        assert_eq!(submitted.prompt, "fix the bug");
        assert!(submitted.bypass_cloud_plan);
        assert!(submitted.stale_restored_prompt);
        assert!(gate.current_line.is_empty());
        assert!(!gate.current_line_user_touched);
    }

    #[test]
    fn prompt_marker_only_input_does_not_submit_prompt() {
        let mut gate = TerminalInputGate::default();

        let submitted = terminal_capture_submitted_prompt_from_gate(&mut gate, "$\r");

        assert!(submitted.is_none());
    }
}

#[tauri::command]
async fn terminal_write(
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

    if let Some(submitted) = terminal_capture_submitted_prompt(&instance, &data).await {
        let prompt = submitted.prompt;
        if submitted.stale_restored_prompt {
            log_terminal_event(
                "terminal.write.stale_restored_prompt_enter_ignored",
                Some(&pane_id),
                Some(instance.id),
                None,
                json!({
                    "prompt_hash": clean_terminal_telemetry_text(&cloud_mcp_prompt_hash(&prompt)),
                    "bytes": data.len(),
                }),
            );
            write_terminal_input(
                &state,
                &pane_id,
                Some(instance.id),
                "\u{15}",
                "terminal.write.stale_restored_prompt_clear_skipped",
            )
            .await
            .map(|_| ())?;
            return Ok(());
        }

        if terminal_instance_requires_cloud_prompt_gate(&instance).await
            && !submitted.bypass_cloud_plan
            && terminal_prompt_requires_cloud_plan(&prompt)
        {
            match cloud_mcp_require_prompt_plan_accepted(
                cloud_mcp_state.inner(),
                instance.working_directory.as_ref(),
                &prompt,
            )
            .await
            {
                Ok(enhanced_prompt) => {
                    let enhanced_input = format!("\u{15}{enhanced_prompt}\r");
                    if enhanced_input.len() > MAX_TERMINAL_WRITE_BYTES {
                        return Err(
                            "Enhanced Cloud MCP prompt is too large for terminal input.".to_string(),
                        );
                    }
                    log_terminal_event(
                        "terminal.write.cloud_mcp_plan_accepted",
                        Some(&pane_id),
                        Some(instance.id),
                        None,
                        json!({
                            "prompt_hash": clean_terminal_telemetry_text(&cloud_mcp_prompt_hash(&prompt)),
                            "original_bytes": data.len(),
                            "enhanced_bytes": enhanced_input.len(),
                        }),
                    );
                    write_terminal_input(
                        &state,
                        &pane_id,
                        Some(instance.id),
                        &enhanced_input,
                        "terminal.write.enhanced_prompt_skipped_stale_or_missing",
                    )
                    .await
                    .map(|_| ())?;
                    return Ok(());
                }
                Err(error) => {
                    let data_without_submit = data
                        .chars()
                        .filter(|character| !matches!(character, '\r' | '\n'))
                        .collect::<String>();
                    if !data_without_submit.is_empty() {
                        let _ = write_terminal_input(
                            &state,
                            &pane_id,
                            Some(instance.id),
                            &data_without_submit,
                            "terminal.write.cloud_mcp_plan_echo_skipped",
                        )
                        .await;
                    }
                    {
                        let mut gate = instance.input_gate.lock().await;
                        if gate.current_line.trim().is_empty() {
                            gate.current_line = prompt.clone();
                            gate.current_line_user_touched = false;
                        }
                    }
                    log_terminal_event(
                        "terminal.write.cloud_mcp_plan_blocked",
                        Some(&pane_id),
                        Some(instance.id),
                        None,
                        json!({
                            "prompt_hash": clean_terminal_telemetry_text(&cloud_mcp_prompt_hash(&prompt)),
                            "error": clean_terminal_telemetry_text(&error),
                        }),
                    );
                    return Err(error);
                }
            }
        }
    }

    write_terminal_input(
        &state,
        &pane_id,
        instance_id,
        &data,
        "terminal.write.skipped_stale_or_missing",
    )
    .await
    .map(|_| ())
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

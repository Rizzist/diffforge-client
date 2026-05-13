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

fn terminal_input_contains_escape(data: &str) -> bool {
    data.as_bytes().contains(&0x1b)
}

fn terminal_input_debug_fields(data: &str) -> Value {
    let bytes = data.as_bytes();
    let control_byte_hex = bytes
        .iter()
        .copied()
        .filter(|byte| *byte < 32 || *byte == 127)
        .take(12)
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>();
    let prefix_hex = bytes
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>();
    let escape_count = bytes.iter().filter(|byte| **byte == 0x1b).count();

    json!({
        "bytes": bytes.len(),
        "chars": data.chars().count(),
        "controlByteHex": control_byte_hex,
        "escapeCount": escape_count,
        "hasEscape": escape_count > 0,
        "isBareEscape": bytes == b"\x1b",
        "prefixHex": prefix_hex,
        "startsWithEscape": bytes.first().is_some_and(|byte| *byte == 0x1b),
    })
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

fn terminal_parked_logging_enabled() -> bool {
    TERMINAL_PARKED_LOGGING_ENABLED
}

fn terminal_phase_is_parked_log(phase: &str) -> bool {
    let phase = phase.to_ascii_lowercase();
    phase.contains("parked")
        || phase.contains("parking")
        || phase.ends_with(".partial_park")
}

fn log_terminal_event(
    phase: &str,
    pane_id: Option<&str>,
    instance_id: Option<u64>,
    elapsed: Option<Duration>,
    fields: Value,
) {
    if !terminal_parked_logging_enabled() && terminal_phase_is_parked_log(phase) {
        return;
    }

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
    let has_escape = terminal_input_contains_escape(data);

    if has_escape {
        log_terminal_event(
            "terminal.input.escape.write_start",
            Some(pane_id),
            instance_id,
            None,
            terminal_input_debug_fields(data),
        );
    }

    if data.is_empty() {
        return Ok(true);
    }

    if data.len() > MAX_TERMINAL_WRITE_BYTES {
        return Err("Terminal input chunk is too large.".to_string());
    }

    let Some(instance) = get_terminal_instance_if_current(state, pane_id, instance_id).await?
    else {
        if has_escape {
            log_terminal_event(
                "terminal.input.escape.write_skipped_stale_or_missing",
                Some(pane_id),
                instance_id,
                None,
                terminal_input_debug_fields(data),
            );
        }
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

    if has_escape {
        log_terminal_event(
            "terminal.input.escape.write_done",
            Some(pane_id),
            instance_id,
            None,
            terminal_input_debug_fields(data),
        );
    }

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
        clear_terminal_audio_input_target_if_matches(state, &target.pane_id, target.instance_id)?;
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
        clear_terminal_audio_input_target_if_matches(state, &target.pane_id, target.instance_id)?;
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
    .and_then(|kernel| {
        kernel
            .interrupt_session(&coordination.session_id, reason)
            .map(|_| ())
    }) {
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

fn terminal_coordination_session_from_context(
    context: &crate::coordination::models::TerminalCoordinationContext,
) -> TerminalCoordinationSession {
    TerminalCoordinationSession {
        repo_path: context.repo_path.clone(),
        db_path: context.db_path.clone(),
        mcp_command: context.mcp_command.clone(),
        agent_id: context.agent_id.clone(),
        session_id: context.session_id.clone(),
        env_vars: context.env_vars(),
    }
}

fn cleanup_terminal_instance_with_context(
    instance: TerminalInstance,
    kill_first: bool,
    pane_id: Option<String>,
    reason: &'static str,
    preserve_coordination_session: bool,
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
            "preserve_coordination_session": preserve_coordination_session,
            "reason": reason,
        }),
    );

    if let Some(coordination) = coordination
        .as_ref()
        .filter(|_| !preserve_coordination_session)
    {
        interrupt_terminal_coordination_session(
            coordination,
            pane_id.as_deref(),
            Some(instance_id),
            reason,
        );
    } else if let Some(coordination) = coordination.as_ref() {
        log_terminal_event(
            "terminal.coordination_session_preserved",
            pane_id.as_deref(),
            Some(instance_id),
            None,
            json!({
                "agent_id": clean_terminal_telemetry_text(&coordination.agent_id),
                "session_id": clean_terminal_telemetry_text(&coordination.session_id),
                "reason": clean_terminal_telemetry_text(reason),
            }),
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
    preserve_coordination_session: bool,
) {
    thread::spawn(move || {
        cleanup_terminal_instance_with_context(
            instance,
            kill_first,
            pane_id,
            reason,
            preserve_coordination_session,
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

fn workspace_bootstrap_lock_for_path(state: &TerminalState, root: &Path) -> Arc<Mutex<()>> {
    let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let key = workspace_path_display(&canonical_root);
    #[cfg(windows)]
    let key = key.to_ascii_lowercase();

    match state.workspace_bootstrap_locks.lock() {
        Ok(mut locks) => Arc::clone(
            locks
                .entry(key)
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        ),
        Err(_) => Arc::new(Mutex::new(())),
    }
}

fn terminal_output_debug_fields(bytes: &[u8]) -> Value {
    let text = String::from_utf8_lossy(bytes);
    let display_text = terminal_output_display_text(&text);
    let prefix_hex = bytes
        .iter()
        .take(24)
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>();
    let control_byte_hex = bytes
        .iter()
        .copied()
        .filter(|byte| *byte < 32 || *byte == 127)
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>();
    let printable_chars = display_text.chars().count();
    let visible_chars = display_text
        .chars()
        .filter(|character| !character.is_whitespace())
        .count();
    let safe_preview = display_text
        .chars()
        .take(120)
        .collect::<String>()
        .trim()
        .to_string();

    json!({
        "bytes": bytes.len(),
        "controlBytes": bytes.iter().filter(|byte| **byte < 32 || **byte == 127).count(),
        "controlByteHex": control_byte_hex,
        "escapeBytes": bytes.iter().filter(|byte| **byte == 0x1b).count(),
        "hasEscape": bytes.iter().any(|byte| *byte == 0x1b),
        "prefixHex": prefix_hex,
        "printableChars": printable_chars,
        "safePreview": clean_terminal_telemetry_text(&safe_preview),
        "startsWithEscape": bytes.first().is_some_and(|byte| *byte == 0x1b),
        "visibleChars": visible_chars,
    })
}

fn terminal_output_display_text(text: &str) -> String {
    let mut output = String::new();
    let mut chars = text.chars().peekable();

    while let Some(character) = chars.next() {
        if character == '\u{1b}' {
            match chars.peek().copied() {
                Some('[') => {
                    chars.next();
                    while let Some(next) = chars.next() {
                        let code = next as u32;
                        if (0x40..=0x7e).contains(&code) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    let mut escape_pending = false;
                    while let Some(next) = chars.next() {
                        if escape_pending {
                            if next == '\\' {
                                break;
                            }
                            escape_pending = false;
                        }
                        if next == '\u{1b}' {
                            escape_pending = true;
                        } else if next == '\u{7}' {
                            break;
                        }
                    }
                }
                Some(_) => {
                    chars.next();
                }
                None => {}
            }
            continue;
        }

        if !character.is_control() {
            output.push(character);
        }
    }

    output
}

fn terminal_output_has_visible_text(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(bytes);
    terminal_output_display_text(&text)
        .chars()
        .any(|character| !character.is_whitespace())
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
    fn flush_terminal_output_frame(
        pending: &mut Vec<u8>,
        pane_id: &str,
        instance_id: u64,
        cloud_mcp_state: &CloudMcpState,
        output_channel: &Channel<InvokeResponseBody>,
        sent_frame_sequence: &mut usize,
        flushed_chunks: &mut usize,
        flushed_bytes: &mut usize,
        frame_log_limit: usize,
        reason: &str,
    ) -> bool {
        if pending.is_empty() {
            return true;
        }

        let bytes = pending.len();
        let chunk = std::mem::take(pending);
        let observer_state = cloud_mcp_state.clone();
        let observer_pane_id = pane_id.to_string();
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

        *sent_frame_sequence += 1;
        if *sent_frame_sequence <= frame_log_limit {
            log_terminal_event(
                "terminal.reader.frame_sent",
                Some(pane_id),
                Some(instance_id),
                None,
                json!({
                    "sequence": *sent_frame_sequence,
                    "frame": terminal_output_debug_fields(&chunk),
                    "flush_reason": reason,
                }),
            );
        }

        if output_channel.send(InvokeResponseBody::Raw(chunk)).is_err() {
            return false;
        }

        *flushed_chunks += 1;
        *flushed_bytes += bytes;
        true
    }

    let (output_tx, mut output_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let reader_pane_id = pane_id.clone();
    const FRAME_LOG_LIMIT: usize = 10;

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
        let mut saw_first_visible_output = false;
        let mut read_frame_sequence = 0usize;

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(bytes_read) => {
                    read_frame_sequence += 1;
                    let chunk = &buffer[..bytes_read];
                    let debug_fields = terminal_output_debug_fields(chunk);
                    let has_visible_output = terminal_output_has_visible_text(chunk);

                    if !saw_first_output {
                        saw_first_output = true;
                        log_terminal_event(
                            "terminal.reader.first_pty_frame",
                            Some(&reader_pane_id),
                            Some(instance_id),
                            None,
                            debug_fields.clone(),
                        );
                        log_terminal_event(
                            "terminal.reader.first_output",
                            Some(&reader_pane_id),
                            Some(instance_id),
                            None,
                            json!({
                                "bytes": bytes_read,
                                "classification": "pty_bytes",
                                "frame": debug_fields.clone(),
                            }),
                        );
                    }

                    if has_visible_output && !saw_first_visible_output {
                        saw_first_visible_output = true;
                        log_terminal_event(
                            "terminal.reader.first_visible_output",
                            Some(&reader_pane_id),
                            Some(instance_id),
                            None,
                            debug_fields.clone(),
                        );
                    }

                    if read_frame_sequence <= FRAME_LOG_LIMIT {
                        log_terminal_event(
                            "terminal.reader.frame_read",
                            Some(&reader_pane_id),
                            Some(instance_id),
                            None,
                            json!({
                                "sequence": read_frame_sequence,
                                "frame": debug_fields,
                            }),
                        );
                    }

                    if output_tx.send(chunk.to_vec()).is_err() {
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
            json!({
                "readFrames": read_frame_sequence,
                "saw_first_output": saw_first_output,
                "saw_first_visible_output": saw_first_visible_output,
            }),
        );
    });

    tauri::async_runtime::spawn(async move {
        let mut ticker = interval(Duration::from_micros(TERMINAL_OUTPUT_FRAME_MICROS));
        ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut pending = Vec::with_capacity(TERMINAL_OUTPUT_READ_BUFFER_BYTES * 2);
        let mut pending_since: Option<Instant> = None;
        let mut reader_closed = false;
        let mut flushed_chunks = 0usize;
        let mut flushed_bytes = 0usize;
        let mut channel_failed = false;
        let mut sent_frame_sequence = 0usize;

        loop {
            tokio::select! {
                biased;
                _ = ticker.tick() => {
                    while let Ok(chunk) = output_rx.try_recv() {
                        pending.extend_from_slice(&chunk);
                    }

                    if !pending.is_empty()
                        && !flush_terminal_output_frame(
                            &mut pending,
                            &pane_id,
                            instance_id,
                            &cloud_mcp_state,
                            &output_channel,
                            &mut sent_frame_sequence,
                            &mut flushed_chunks,
                            &mut flushed_bytes,
                            FRAME_LOG_LIMIT,
                            "frame_tick",
                        )
                    {
                            channel_failed = true;
                            break;
                    }
                    pending_since = None;

                    if reader_closed {
                        break;
                    }
                }
                maybe_chunk = output_rx.recv(), if !reader_closed => {
                    match maybe_chunk {
                        Some(chunk) => {
                            if pending.is_empty() {
                                pending_since = Some(Instant::now());
                            }
                            pending.extend_from_slice(&chunk);
                            while let Ok(chunk) = output_rx.try_recv() {
                                pending.extend_from_slice(&chunk);
                            }

                            let pending_is_over_frame_budget = pending_since
                                .map(|started| {
                                    started.elapsed()
                                        >= Duration::from_micros(TERMINAL_OUTPUT_FRAME_MICROS)
                                })
                                .unwrap_or(false);
                            let pending_is_large = pending.len() >= TERMINAL_OUTPUT_READ_BUFFER_BYTES;
                            if pending_is_over_frame_budget || pending_is_large {
                                let reason = if pending_is_large {
                                    "max_frame_bytes"
                                } else {
                                    "max_frame_latency"
                                };
                                if !flush_terminal_output_frame(
                                    &mut pending,
                                    &pane_id,
                                    instance_id,
                                    &cloud_mcp_state,
                                    &output_channel,
                                    &mut sent_frame_sequence,
                                    &mut flushed_chunks,
                                    &mut flushed_bytes,
                                    FRAME_LOG_LIMIT,
                                    reason,
                                ) {
                                    channel_failed = true;
                                    break;
                                }
                                pending_since = None;
                            }
                        }
                        None => reader_closed = true,
                    }
                }
            }
        }

        if !channel_failed && !pending.is_empty() {
            if !flush_terminal_output_frame(
                &mut pending,
                &pane_id,
                instance_id,
                &cloud_mcp_state,
                &output_channel,
                &mut sent_frame_sequence,
                &mut flushed_chunks,
                &mut flushed_bytes,
                FRAME_LOG_LIMIT,
                "reader_closed",
            ) {
                channel_failed = true;
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
                "sent_frames": sent_frame_sequence,
            }),
        );

        if let Some(instance) =
            remove_terminal_instance_if_current(&terminals, &pane_id, instance_id).await
        {
            let notify_state = cloud_mcp_state.clone();
            let notify_pane_id = pane_id.clone();
            let notify_instance = instance.clone();
            let notify_task = tauri::async_runtime::spawn(async move {
                cloud_mcp_mark_terminal_closed(
                    &notify_state,
                    &notify_pane_id,
                    instance_id,
                    &notify_instance,
                    "reader_exit",
                )
                .await;
            });
            let _ = tokio::time::timeout(Duration::from_millis(2_000), notify_task).await;
            cleanup_terminal_instance_async(
                instance,
                false,
                Some(pane_id.clone()),
                "reader_exit",
                false,
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
    cloud_mcp_state: Option<&CloudMcpState>,
    pane_id: &str,
    instance_id: Option<u64>,
    preserve_coordination_session: bool,
    wait_for_cleanup: bool,
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
        if let Some(cloud_mcp_state) = cloud_mcp_state {
            let notify_state = cloud_mcp_state.clone();
            let notify_instance = instance.clone();
            let notify_pane_id = pane_id.to_string();
            let notify_task = tauri::async_runtime::spawn(async move {
                cloud_mcp_mark_terminal_closed(
                    &notify_state,
                    &notify_pane_id,
                    cleanup_instance_id,
                    &notify_instance,
                    "terminal_close",
                )
                .await;
            });
            if wait_for_cleanup {
                let _ = tokio::time::timeout(Duration::from_millis(2_000), notify_task).await;
            }
        }
        let cleanup_task_pane_id = cleanup_pane_id.clone();
        let cleanup_task = tauri::async_runtime::spawn_blocking(move || {
            cleanup_terminal_instance_with_context(
                instance,
                true,
                Some(cleanup_task_pane_id),
                "terminal_close",
                preserve_coordination_session,
            );
        });
        if !wait_for_cleanup {
            log_terminal_event(
                "terminal.close.cleanup_scheduled",
                Some(pane_id),
                Some(cleanup_instance_id),
                Some(cleanup_started_at.elapsed()),
                json!({
                    "app_pid": std::process::id(),
                    "detached": true,
                    "preserve_coordination_session": preserve_coordination_session,
                }),
            );
            tauri::async_runtime::spawn(async move {
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
                    Some(&cleanup_pane_id),
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
            });
            return Ok(true);
        }
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
    cloud_mcp_state: &CloudMcpState,
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

    let lifecycle_notifications = instances
        .iter()
        .map(|(pane_id, instance)| {
            let notify_state = cloud_mcp_state.clone();
            let notify_pane_id = pane_id.clone();
            let notify_instance = instance.clone();
            tauri::async_runtime::spawn(async move {
                cloud_mcp_mark_terminal_closed(
                    &notify_state,
                    &notify_pane_id,
                    notify_instance.id,
                    &notify_instance,
                    "close_all",
                )
                .await;
            })
        })
        .collect::<Vec<_>>();
    let _ = tokio::time::timeout(
        Duration::from_millis(2_000),
        futures_util::future::join_all(lifecycle_notifications),
    )
    .await;

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
                    false,
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
    validate_terminal_pane_id(&request.pane_id)?;
    log_terminal_event(
        "terminal.open.lifecycle_lock_skipped",
        Some(&request.pane_id),
        request.instance_id,
        None,
        json!({"reason": "persistent_numbered_slots_fast_attach"}),
    );
    let pane_id = request.pane_id;
    let open_started_at = Instant::now();
    let requested_cols = request.cols;
    let requested_rows = request.rows;
    let kind = request.kind;
    let provider = request.provider;
    let provider_for_coordination = provider.clone();
    let model = request.model;
    let plain_shell =
        terminal_request_is_plain_shell(&kind, provider.as_deref(), request.plain_shell);
    let working_directory_request = request.working_directory;
    let workspace_id = request.workspace_id;
    let workspace_name = request.workspace_name;
    let terminal_index = request.terminal_index;
    let requested_slot_key = request.slot_key;
    let terminal_slot_key =
        terminal_slot_key_from_request(&pane_id, terminal_index, requested_slot_key.as_deref())?;

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
            "terminal_index": terminal_index,
            "slot_key": clean_terminal_telemetry_text(&terminal_slot_key),
        }),
    );

    log_terminal_event(
        "terminal.open.cloud_mcp_gate_skipped",
        Some(&pane_id),
        request.instance_id,
        None,
        json!({
            "reason": "simple_worktree_launch",
            "workspace_id": workspace_id.as_deref().map(clean_terminal_telemetry_text),
        }),
    );

    let preserve_coordination_session =
        request.preserve_coordination_session.unwrap_or(false) && !plain_shell;
    let close_started_at = Instant::now();
    let closed_existing = close_terminal_session(
        &state,
        Some(cloud_mcp_state.inner()),
        &pane_id,
        None,
        preserve_coordination_session,
        false,
    )
    .await
    .unwrap_or(false);
    log_terminal_event(
        "terminal.open.close_existing",
        Some(&pane_id),
        request.instance_id,
        Some(close_started_at.elapsed()),
        json!({
            "closed_existing": closed_existing,
            "preserve_coordination_session": preserve_coordination_session,
        }),
    );

    let resolve_started_at = Instant::now();
    let working_directory =
        match resolve_workspace_root_directory(working_directory_request.as_deref()) {
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
    let mut launch_worktree: Option<Value> = None;
    let mut coordination_context: Option<crate::coordination::models::TerminalCoordinationContext> =
        None;

    let command_started_at = Instant::now();
    let is_prewarm_pty = is_terminal_prewarm_kind(&kind);
    let (command_candidates, args, label) = if is_prewarm_pty || plain_shell {
        (Vec::new(), Vec::new(), "Prepared PTY".to_string())
    } else {
        terminal_launch(&kind, provider, model)?
    };
    if plain_shell {
        log_terminal_event(
            "terminal.open.plain_shell_project_root_ready",
            Some(&pane_id),
            request.instance_id,
            Some(command_started_at.elapsed()),
            json!({
                "plain_shell": plain_shell,
                "slot_key": clean_terminal_telemetry_text(&terminal_slot_key),
                "working_directory": workspace_path_display(&process_working_directory),
            }),
        );
    } else if !is_prewarm_pty {
        {
            let bootstrap_lock = workspace_bootstrap_lock_for_path(state.inner(), &working_directory);
            let bootstrap_wait_started_at = Instant::now();
            log_terminal_event(
                "terminal.open.git_bootstrap_lock_wait_start",
                Some(&pane_id),
                request.instance_id,
                None,
                json!({
                    "working_directory": workspace_path_display(&working_directory),
                }),
            );
            let _bootstrap_guard = bootstrap_lock.lock().await;
            log_terminal_event(
                "terminal.open.git_bootstrap_lock_acquired",
                Some(&pane_id),
                request.instance_id,
                Some(bootstrap_wait_started_at.elapsed()),
                json!({
                    "working_directory": workspace_path_display(&working_directory),
                }),
            );

            let git_started_at = Instant::now();
            match ensure_workspace_git_ready_for_coordination(&working_directory) {
                Ok(bootstrap) => {
                    log_terminal_event(
                        "terminal.open.git_bootstrap_ready",
                        Some(&pane_id),
                        request.instance_id,
                        Some(git_started_at.elapsed()),
                        serde_json::to_value(&bootstrap).unwrap_or_else(|_| json!({})),
                    );
                }
                Err(error) => {
                    log_terminal_event(
                        "terminal.open.git_bootstrap_error",
                        Some(&pane_id),
                        request.instance_id,
                        Some(git_started_at.elapsed()),
                        json!({
                            "error": clean_terminal_telemetry_text(&error),
                            "working_directory": workspace_path_display(&working_directory),
                        }),
                    );
                    return Err(format!(
                        "Unable to initialize workspace Git for terminal isolation: {error}"
                    ));
                }
            }
        }

        let kernel_started_at = Instant::now();
        let (coordination_kernel, kernel_open_mode) =
            match crate::coordination::CoordinationKernel::open_for_terminal_launch(
                &working_directory,
                None,
            ) {
                Ok(result) => result,
                Err(error) => {
                    log_terminal_event(
                        "terminal.open.coordination_kernel_error",
                        Some(&pane_id),
                        request.instance_id,
                        Some(kernel_started_at.elapsed()),
                        json!({
                            "error": clean_terminal_telemetry_text(&error),
                            "working_directory": workspace_path_display(&working_directory),
                        }),
                    );
                    return Err(format!(
                        "Unable to open terminal coordination kernel: {error}"
                    ));
                }
            };
        log_terminal_event(
            "terminal.open.coordination_kernel_ready",
            Some(&pane_id),
            request.instance_id,
            Some(kernel_started_at.elapsed()),
            json!({
                "db_path": workspace_path_display(&coordination_kernel.paths.db_path),
                "open_mode": kernel_open_mode,
                "repo_path": workspace_path_display(&coordination_kernel.paths.repo_path),
            }),
        );

        let daemon_started_at = Instant::now();
        match crate::coordination::mcp::ensure_shared_daemon_for_paths(
            &coordination_kernel.paths.repo_path,
            &coordination_kernel.paths.db_path,
        ) {
            Ok(status) => {
                log_terminal_event(
                    "terminal.open.shared_mcp_daemon_ready",
                    Some(&pane_id),
                    request.instance_id,
                    Some(daemon_started_at.elapsed()),
                    status,
                );
            }
            Err(error) => {
                log_terminal_event(
                    "terminal.open.shared_mcp_daemon_error",
                    Some(&pane_id),
                    request.instance_id,
                    Some(daemon_started_at.elapsed()),
                    json!({
                        "error": clean_terminal_telemetry_text(&error),
                        "working_directory": workspace_path_display(&working_directory),
                    }),
                );
                return Err(format!(
                    "Unable to start shared coordination MCP daemon: {error}"
                ));
            }
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
        let worktree_started_at = Instant::now();
        match coordination_kernel.prepare_terminal_context_for_slot(
            &agent_name,
            agent_kind,
            &terminal_slot_key,
            Some(&pane_id),
            workspace_id.as_deref(),
            workspace_name.as_deref(),
            None,
            None,
            None,
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
                            Some(&pane_id),
                            request.instance_id,
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
                        log_terminal_event(
                            "terminal.open.coordination_rejected",
                            Some(&pane_id),
                            request.instance_id,
                            Some(worktree_started_at.elapsed()),
                            json!({
                                "agent_kind": clean_terminal_telemetry_text(agent_kind),
                                "enforcement_mode": clean_terminal_telemetry_text(&context.enforcement_mode),
                                "reason": clean_terminal_telemetry_text(reason),
                                "slot_key": context.slot_key.as_deref().map(clean_terminal_telemetry_text),
                                "worktree_id": context.worktree_id.as_deref().map(clean_terminal_telemetry_text),
                                "worktree_path": context.worktree_path.as_deref().map(clean_terminal_telemetry_text),
                                "write_root": clean_terminal_telemetry_text(&context.write_root),
                            }),
                        );
                        return Err(format!(
                            "Terminal isolation failed for {label}: {reason}."
                        ));
                    }

                    process_working_directory =
                        workspace_path_for_process(&PathBuf::from(&context.write_root));
                    let branch_name = context
                        .slot_key
                        .as_ref()
                        .map(|slot_key| format!("agent/{slot_key}"));
                    launch_worktree = Some(json!({
                        "agentId": context.agent_id.clone(),
                        "branchName": branch_name.clone(),
                        "id": context.worktree_id.clone(),
                        "path": context.write_root.clone(),
                        "sessionId": context.session_id.clone(),
                        "slotKey": context.slot_key.clone(),
                    }));
                    log_terminal_event(
                        "terminal.open.coordination_ready",
                        Some(&pane_id),
                        request.instance_id,
                        Some(worktree_started_at.elapsed()),
                        json!({
                            "agent_kind": clean_terminal_telemetry_text(agent_kind),
                            "branch_name": branch_name.as_deref().map(clean_terminal_telemetry_text),
                            "mcp_config_path": clean_terminal_telemetry_text(&context.mcp_config_path),
                            "plain_shell": plain_shell,
                            "slot_key": context.slot_key.as_deref().map(clean_terminal_telemetry_text),
                            "worktree_id": context.worktree_id.as_deref().map(clean_terminal_telemetry_text),
                            "working_directory": workspace_path_display(&process_working_directory),
                        }),
                    );
                    coordination_context = Some(context);
                }
                Err(error) => {
                    log_terminal_event(
                        "terminal.open.coordination_error",
                        Some(&pane_id),
                        request.instance_id,
                        Some(worktree_started_at.elapsed()),
                        json!({
                            "error": clean_terminal_telemetry_text(&error),
                            "slot_key": clean_terminal_telemetry_text(&terminal_slot_key),
                        }),
                    );
                    return Err(format!(
                        "Unable to prepare terminal coordination MCP/worktree: {error}"
                    ));
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
    let mut launch_arg_count = args.len();
    let terminal_coordination = coordination_context
        .as_ref()
        .map(terminal_coordination_session_from_context);

    let shell_pty = is_prewarm_pty || plain_shell;
    let warm_pty = if shell_pty {
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
            log_terminal_event(
                "terminal.open.error",
                Some(&pane_id),
                Some(instance_id),
                Some(open_started_at.elapsed()),
                json!({ "error": clean_terminal_telemetry_text(&error) }),
            );
            return Err(error);
        };

        let launch_args = terminal_args_with_codex_mcp_identity(
            provider_for_coordination
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| {
                    if kind == "console" {
                        "codex"
                    } else {
                        kind.as_str()
                    }
                }),
            &args,
            terminal_coordination.as_ref(),
            &pane_id,
            instance_id,
        );
        launch_arg_count = launch_args.len();
        let coordination_env_vars = terminal_coordination
            .as_ref()
            .map(|coordination| coordination.env_vars.as_slice())
            .unwrap_or(&[]);

        let warm_pty = match create_agent_terminal_pty(
            size,
            &command_path,
            &launch_args,
            &process_working_directory,
            coordination_env_vars,
            None,
        ) {
            Ok(warm_pty) => warm_pty,
            Err(error) => {
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
            "launch_arg_count": launch_arg_count,
            "command": clean_terminal_telemetry_text(&command),
            "prewarm_pty": is_prewarm_pty,
            "repo_working_directory": workspace_path_display(&working_directory),
            "working_directory": workspace_path_display(&process_working_directory),
            "agent_branch_root": launch_worktree
                .as_ref()
                .and_then(|worktree| worktree["path"].as_str())
                .map(clean_terminal_telemetry_text),
            "cwd_policy": if launch_worktree.is_some() {
                "worktree_only"
            } else {
                "project_root"
            },
        }),
    );

    let (instance, reader) = TerminalInstance::from_warm_shell(
        instance_id,
        warm_pty,
        process_working_directory.clone(),
        agent_started,
        terminal_coordination.clone(),
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
            preserve_coordination_session,
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
    if agent_started {
        if let Some(coordination) = terminal_coordination.clone() {
            spawn_terminal_session_parking_monitor(
                app.clone(),
                cloud_mcp_state.inner().clone(),
                Arc::clone(&state.terminals),
                Arc::clone(&state.parked_prompts),
                pane_id.clone(),
                instance_id,
                coordination,
                "terminal_open",
            );
        }
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
            "agent_branch_root": launch_worktree
                .as_ref()
                .and_then(|worktree| worktree["path"].as_str())
                .map(clean_terminal_telemetry_text),
            "cwd_policy": if launch_worktree.is_some() {
                "worktree_only"
            } else {
                "project_root"
            },
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

fn terminal_telemetry_entry(request: TerminalTelemetryLogRequest) -> Option<Value> {
    if request.phase.trim().is_empty() {
        return None;
    }

    if !terminal_parked_logging_enabled() && terminal_phase_is_parked_log(&request.phase) {
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
            "modal_policy": "frontend_modal_only_for_interrupted_tasks_with_active_work_signals_no_auto_input",
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
            message:
                "Prepared terminal has no coordination session; restart through terminal_open."
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

#[tauri::command]
async fn terminal_write_to_audio_input_target(
    app: AppHandle,
    state: State<'_, TerminalState>,
    data: String,
) -> Result<bool, String> {
    let Some(target) = active_terminal_audio_input_target(&state)? else {
        log_terminal_event(
            "terminal.audio_input.write.skipped_no_target",
            None,
            None,
            None,
            json!({
                "bytes": data.len(),
                "has_escape": terminal_input_contains_escape(&data),
            }),
        );
        return Ok(false);
    };

    if terminal_input_contains_escape(&data) {
        log_terminal_event(
            "terminal.audio_input.escape.command_received",
            Some(&target.pane_id),
            target.instance_id,
            None,
            terminal_input_debug_fields(&data),
        );
    }

    let wrote = write_to_active_terminal_audio_input_target(&app, &state, &data).await?;

    if terminal_input_contains_escape(&data) {
        log_terminal_event(
            "terminal.audio_input.escape.command_done",
            Some(&target.pane_id),
            target.instance_id,
            None,
            json!({
                "wrote": wrote,
                "bytes": data.len(),
            }),
        );
    }

    Ok(wrote)
}

fn terminal_observe_input_gate_submitted_prompt(
    gate: &mut TerminalInputGate,
    data: &str,
) -> Option<String> {
    let mut submitted = None;

    if data == TERMINAL_SHIFT_ENTER_SEQUENCE {
        gate.current_line.push('\n');
        gate.current_line_user_touched = true;
        return None;
    }

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

async fn terminal_observe_submitted_prompt(
    instance: &TerminalInstance,
    data: &str,
) -> Option<String> {
    let mut gate = instance.input_gate.lock().await;

    terminal_observe_input_gate_submitted_prompt(&mut gate, data)
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
    parked_resource_intents: Vec<Value>,
}

fn terminal_parking_snapshot_signature(snapshot: &TerminalParkingSnapshot) -> String {
    let waiting_on = snapshot
        .waiting_on
        .iter()
        .map(|item| {
            format!(
                "{}:{}:{}",
                item.task_id.as_deref().unwrap_or(""),
                item.agent_label
                    .as_deref()
                    .or(item.agent_id.as_deref())
                    .unwrap_or(""),
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
                .or_else(|| agent_id.as_deref().map(terminal_waiting_agent_label))
                .or_else(|| {
                    blocker["slot_key"]
                        .as_str()
                        .map(terminal_waiting_slot_label)
                });
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
        let agent_label = agent_id
            .as_deref()
            .map(terminal_waiting_agent_label)
            .or_else(|| {
                item["depends_on_slot_key"]
                    .as_str()
                    .map(terminal_waiting_slot_label)
            });
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
    for blocker in
        terminal_parked_waiting_on_from_blocking_dependencies(&state["data"]["blocked_slices"])
    {
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
           AND i.status IN ('parked', 'parked_cycle_prevented', 'resume_ready')
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
        task_status,
        session_status,
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
1. Call coordination-kernel.start_task with a short continuation plan to refresh coordination state.\n\
2. Inspect the current target file(s) before editing so you do not work from stale context.\n\
3. Re-acquire the needed lease(s), continue the original task above, and submit the patch when finished."
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
    if !terminal_parked_logging_enabled() {
        return;
    }

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

fn terminal_prompt_is_agent_command(prompt: &str) -> bool {
    let trimmed = prompt.trim();
    if !trimmed.starts_with('/') || trimmed.starts_with("//") {
        return false;
    }
    trimmed
        .chars()
        .nth(1)
        .is_some_and(|character| character.is_ascii_alphabetic() || character == '?')
}

fn terminal_existing_session_task_with_active_leases(
    kernel: &crate::coordination::CoordinationKernel,
    coordination: &TerminalCoordinationSession,
) -> Result<Option<(String, String, usize)>, String> {
    let now = crate::coordination::kernel::now_rfc3339();
    let rows = kernel.query_json(
        "SELECT l.task_id,
                t.title,
                t.body,
                t.status AS task_status,
                COUNT(1) AS active_lease_count,
                MAX(l.acquired_at) AS latest_lease_at,
                CASE WHEN s.task_id=l.task_id THEN 0 ELSE 1 END AS session_task_rank
         FROM leases l
         LEFT JOIN tasks t ON t.id = l.task_id
         LEFT JOIN agent_sessions s ON s.id = l.session_id
         WHERE l.status='active'
           AND l.expires_at >= ?1
           AND l.agent_id=?2
           AND l.session_id=?3
           AND COALESCE(t.status, '') NOT IN ('done', 'completed', 'merged', 'cancelled', 'interrupted', 'skipped')
         GROUP BY l.task_id
         ORDER BY session_task_rank ASC, latest_lease_at DESC
         LIMIT 1",
        &[&now, &coordination.agent_id, &coordination.session_id],
    )?;
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let Some(task_id) = row["task_id"]
        .as_str()
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    let title = row["title"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "Continue terminal task".to_string());
    let active_lease_count = row["active_lease_count"].as_i64().unwrap_or(0).max(0) as usize;

    Ok(Some((task_id, title, active_lease_count)))
}

fn terminal_attach_session_to_reused_task(
    kernel: &crate::coordination::CoordinationKernel,
    coordination: &TerminalCoordinationSession,
    task_id: &str,
) -> Result<(), String> {
    let changed = kernel
        .conn
        .execute(
            "UPDATE agent_sessions
             SET task_id=?1, updated_at=?2
             WHERE id=?3
               AND agent_id=?4
               AND status='active'",
            rusqlite::params![
                task_id,
                crate::coordination::kernel::now_rfc3339(),
                coordination.session_id.as_str(),
                coordination.agent_id.as_str()
            ],
        )
        .map_err(|error| format!("Unable to reattach terminal session to reused task: {error}"))?;
    if changed == 0 {
        return Err("Unable to reattach terminal session to reused task.".to_string());
    }
    Ok(())
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
    if terminal_prompt_is_agent_command(prompt) {
        log_terminal_event(
            "terminal.prompt.coordination_task_skipped",
            Some(pane_id),
            Some(instance_id),
            None,
            json!({
                "agent_id": clean_terminal_telemetry_text(&coordination.agent_id),
                "session_id": clean_terminal_telemetry_text(&coordination.session_id),
                "reason": "agent_slash_command",
                "prompt": clean_terminal_telemetry_text(prompt),
            }),
        );
        return Ok(None);
    }

    let kernel = crate::coordination::CoordinationKernel::open(
        &coordination.repo_path,
        Some(PathBuf::from(&coordination.db_path)),
    )?;
    if let Some((task_id, title, active_lease_count)) =
        terminal_existing_session_task_with_active_leases(&kernel, coordination)?
    {
        terminal_attach_session_to_reused_task(&kernel, coordination, &task_id)?;
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
                "intent_resources": [],
                "parked": false,
                "partial": false,
                "runnable_resources": [],
                "parked_resources": [],
                "parking_details": [],
                "reused_existing_session_task": true,
                "reuse_reason": "same terminal session already owns active leases",
                "active_lease_count": active_lease_count,
            }),
        );
        return Ok(Some(TerminalPreparedCoordinationTask {
            task_id,
            title,
            parked: false,
            partial: false,
            parking_details: Value::Array(Vec::new()),
            intent_resources: Vec::new(),
            runnable_resources: Vec::new(),
            parked_resources: Vec::new(),
        }));
    }

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
    let _ = kernel.task_resume_state(&task_id, &coordination.session_id);
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
            "intent_resources": [],
            "parked": false,
            "partial": false,
            "runnable_resources": [],
            "parked_resources": [],
            "parking_details": [],
            "reused_existing_session_task": false,
            "prompt_resource_parking": "disabled",
        }),
    );
    Ok(Some(TerminalPreparedCoordinationTask {
        task_id,
        title,
        parked: false,
        partial: false,
        parking_details: Value::Array(Vec::new()),
        intent_resources: Vec::new(),
        runnable_resources: Vec::new(),
        parked_resources: Vec::new(),
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
                "resume_input_policy": "submit_structured_parked_resume_context_to_existing_terminal",
            }),
        );
        let resume_state = if let Ok(kernel) = crate::coordination::CoordinationKernel::open(
            &coordination.repo_path,
            Some(PathBuf::from(&coordination.db_path)),
        ) {
            kernel
                .task_resume_state(&task_id, &coordination.session_id)
                .ok()
        } else {
            None
        };
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
                emit_terminal_parked_prompt_event(
                    &app,
                    &parked,
                    "interrupted",
                    Some("terminal_missing"),
                );
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
                emit_terminal_parked_prompt_event(
                    &app,
                    &parked,
                    "interrupted",
                    Some("terminal_replaced"),
                );
            }
            return;
        }
        let resume_request =
            terminal_rich_parked_resume_prompt(&snapshot, &title, &prompt, resume_state.as_ref());
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
                emit_terminal_parked_prompt_event(
                    &app,
                    &parked,
                    "interrupted",
                    Some("resume_input_too_large"),
                );
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
                    emit_terminal_parked_prompt_event(
                        &app,
                        &parked,
                        "interrupted",
                        Some("resume_write_failed"),
                    );
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
                    emit_terminal_parked_prompt_event(
                        &app,
                        &parked,
                        "interrupted",
                        Some("resume_write_failed"),
                    );
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
        tokio::time::sleep(Duration::from_millis(
            TERMINAL_PARKED_RESUME_SUBMIT_DELAY_MS,
        ))
        .await;
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
                emit_terminal_parked_prompt_event(
                    &app,
                    &parked,
                    "interrupted",
                    Some("resume_write_failed"),
                );
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
                emit_terminal_parked_prompt_event(
                    &app,
                    &parked,
                    "interrupted",
                    Some("resume_write_failed"),
                );
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
    if terminal_input_contains_escape(&data) {
        log_terminal_event(
            "terminal.write.escape.command_received",
            Some(&pane_id),
            instance_id,
            None,
            terminal_input_debug_fields(&data),
        );
    }
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
            let prepared_coordination_task = if let Some(coordination) =
                instance.coordination.as_ref()
            {
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
            if let (Some(coordination), Some(task)) = (
                instance.coordination.clone(),
                prepared_coordination_task.as_ref(),
            ) {
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
            if let (
                Some(coordination),
                Some((task_id, title, parking_details, intent_resources, fully_parked)),
            ) = (instance.coordination.clone(), parked_task)
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
                emit_terminal_parked_prompt_event(
                    &app,
                    &parked,
                    "parked",
                    Some("waiting_for_dependency"),
                );
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

    if terminal_input_contains_escape(&data_to_write) {
        log_terminal_event(
            "terminal.write.escape.forward_to_pty",
            Some(&pane_id),
            instance_id,
            None,
            terminal_input_debug_fields(&data_to_write),
        );
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
        emit_terminal_parked_prompt_event(&app, &parked, "parked", Some("frontend_poll_recovered"));
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
    if let (Some(coordination), Some(active_task)) =
        (instance.coordination.as_ref(), active_task.as_ref())
    {
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
    cloud_mcp_state: State<'_, CloudMcpState>,
    pane_id: String,
    instance_id: Option<u64>,
    preserve_coordination_session: Option<bool>,
    wait_for_cleanup: Option<bool>,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
    let preserve_coordination_session = preserve_coordination_session.unwrap_or(false);
    let wait_for_cleanup = wait_for_cleanup.unwrap_or(false);
    let lifecycle_wait_started_at = Instant::now();
    log_terminal_event(
        "terminal.close.lifecycle_lock_wait_start",
        Some(&pane_id),
        instance_id,
        None,
        json!({
            "preserve_coordination_session": preserve_coordination_session,
            "wait_for_cleanup": wait_for_cleanup,
        }),
    );
    let lifecycle_lock = Arc::clone(&state.lifecycle_lock);
    let _lifecycle_guard = lifecycle_lock.lock().await;
    log_terminal_event(
        "terminal.close.lifecycle_lock_acquired",
        Some(&pane_id),
        instance_id,
        Some(lifecycle_wait_started_at.elapsed()),
        json!({
            "preserve_coordination_session": preserve_coordination_session,
            "wait_for_cleanup": wait_for_cleanup,
        }),
    );
    let close_started_at = Instant::now();
    log_terminal_event(
        "terminal.close.start",
        Some(&pane_id),
        instance_id,
        None,
        json!({
            "preserve_coordination_session": preserve_coordination_session,
            "wait_for_cleanup": wait_for_cleanup,
        }),
    );

    match close_terminal_session(
        &state,
        Some(cloud_mcp_state.inner()),
        &pane_id,
        instance_id,
        preserve_coordination_session,
        wait_for_cleanup,
    )
    .await
    {
        Ok(closed) => {
            log_terminal_event(
                "terminal.close.done",
                Some(&pane_id),
                instance_id,
                Some(close_started_at.elapsed()),
                json!({
                    "closed": closed,
                    "preserve_coordination_session": preserve_coordination_session,
                    "wait_for_cleanup": wait_for_cleanup,
                }),
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
            session_id,
            env_vars: Vec::new(),
        }
    }

    #[test]
    fn slash_command_does_not_create_coordination_task() {
        assert!(terminal_prompt_is_agent_command("/model"));
        assert!(terminal_prompt_is_agent_command(" /fast "));
        assert!(!terminal_prompt_is_agent_command("make /api docs page"));
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
    fn parked_resume_prompt_includes_dependency_context() {
        let snapshot = TerminalParkingSnapshot {
            task_id: "task-resume".to_string(),
            title: "Darken pricing page".to_string(),
            prompt: "Nice redesign the pricing to be more dark tones.".to_string(),
            task_status: "ready".to_string(),
            session_status: "active".to_string(),
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
        assert!(args.iter().any(|arg| arg.contains("--coordination-mcp-proxy")));
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

    #[test]
    fn prompt_preparation_does_not_create_prompt_intent_leases() {
        let coordination = terminal_test_coordination("prompt_parking_disabled");

        let first = terminal_prepare_coordination_task_for_prompt(
            &coordination,
            "make an index.html entry page for icecream wishlist",
            "pane",
            1,
        )
        .unwrap()
        .unwrap();
        assert!(!first.parked);
        assert!(!first.partial);
        assert!(first.intent_resources.is_empty());
        assert!(first.runnable_resources.is_empty());
        assert!(first.parked_resources.is_empty());

        let inspect = crate::coordination::CoordinationKernel::open(
            PathBuf::from(&coordination.repo_path),
            Some(PathBuf::from(&coordination.db_path)),
        )
        .unwrap();
        let active_leases = inspect
            .query_json("SELECT id FROM leases WHERE status='active'", &[])
            .unwrap();
        assert!(active_leases.is_empty());
        let intents = inspect
            .query_json("SELECT id FROM task_resource_intents", &[])
            .unwrap();
        assert!(intents.is_empty());
    }

    #[test]
    fn retry_prompt_reuses_same_session_active_lease_task() {
        let coordination = terminal_test_coordination("retry_reuses_session_lease");

        let first = terminal_prepare_coordination_task_for_prompt(
            &coordination,
            "make an index.html entry page for icecream wishlist",
            "pane",
            1,
        )
        .unwrap()
        .unwrap();
        assert!(!first.parked);

        let lease_kernel = crate::coordination::CoordinationKernel::open(
            PathBuf::from(&coordination.repo_path),
            Some(PathBuf::from(&coordination.db_path)),
        )
        .unwrap();
        lease_kernel
            .acquire_lease(
                &first.task_id,
                &coordination.agent_id,
                &coordination.session_id,
                "file:index.html",
                "write",
                Some(900),
                Some("test lease acquired by the agent after inspecting the repo"),
            )
            .unwrap();
        drop(lease_kernel);

        let retry = terminal_prepare_coordination_task_for_prompt(
            &coordination,
            "make the index.html for my icecream page",
            "pane",
            1,
        )
        .unwrap()
        .unwrap();
        assert_eq!(retry.task_id, first.task_id);
        assert!(!retry.parked);
        assert!(retry.intent_resources.is_empty());
        assert!(retry.runnable_resources.is_empty());

        let inspect = crate::coordination::CoordinationKernel::open(
            PathBuf::from(&coordination.repo_path),
            Some(PathBuf::from(&coordination.db_path)),
        )
        .unwrap();
        let retry_tasks = inspect
            .query_json(
                "SELECT id FROM tasks WHERE body='make the index.html for my icecream page'",
                &[],
            )
            .unwrap();
        assert!(retry_tasks.is_empty());
        let session_rows = inspect
            .query_json(
                "SELECT task_id FROM agent_sessions WHERE id=?1",
                &[&coordination.session_id],
            )
            .unwrap();
        assert_eq!(
            session_rows[0]["task_id"].as_str(),
            Some(first.task_id.as_str())
        );
        let active_index_leases = inspect
            .query_json(
                "SELECT l.id
                 FROM leases l
                 JOIN resources r ON r.id=l.resource_id
                 WHERE l.status='active' AND r.resource_key='file:index.html'",
                &[],
            )
            .unwrap();
        assert_eq!(active_index_leases.len(), 1);
    }
}

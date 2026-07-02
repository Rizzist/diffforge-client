fn terminal_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

const TERMINAL_STARTING_IDLE_BUFFER_MS: u64 = 5_000;
const TERMINAL_ACTIVITY_IDLE_QUIESCE_MS: u64 = 1_750;
const TERMINAL_PROMPT_READY_BUSY_DEBOUNCE_MS: u64 = 750;
const TERMINAL_STARTUP_READY_SCAN_BYTES: usize = 16 * 1024;

fn terminal_output_latest_working_indicator_index(text: &str) -> Option<usize> {
    let lower = text.to_lowercase();
    ["working (", "esc to interrupt", "context refresh"]
        .into_iter()
        .filter_map(|needle| lower.rfind(needle))
        .max()
}

fn terminal_output_latest_prompt_marker_index(text: &str) -> Option<usize> {
    let lower = text.to_ascii_lowercase();
    let mut latest = ["›", "❯", "❱"]
        .into_iter()
        .filter_map(|needle| text.rfind(needle))
        .max();

    if (lower.contains("opencode") || lower.contains("build "))
        && lower.contains("ctrl+p commands")
    {
        latest = latest.max(lower.rfind("ctrl+p commands"));
    }

    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let line_without_newline = line.trim_end_matches(|ch| ch == '\r' || ch == '\n');
        let trimmed_start = line_without_newline.trim_start();
        if trimmed_start == ">" || trimmed_start.starts_with("> ") {
            latest = latest.max(Some(offset + (line_without_newline.len() - trimmed_start.len())));
        }
        offset += line.len();
    }

    latest
}

fn terminal_output_prompt_marker_after_working_indicator(text: &str) -> bool {
    let Some(prompt_index) = terminal_output_latest_prompt_marker_index(text) else {
        return false;
    };
    terminal_output_latest_working_indicator_index(text)
        .map(|working_index| prompt_index > working_index)
        .unwrap_or(true)
}

fn terminal_output_current_prompt_marker(text: &str) -> bool {
    let cleaned = cloud_mcp_clean_terminal_state_text(text);
    if cleaned.is_empty() {
        return false;
    }
    terminal_output_prompt_marker_after_working_indicator(text)
        || terminal_output_prompt_marker_after_working_indicator(&cleaned)
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

fn terminal_normalize_agent_kind(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    if normalized.contains("claude") {
        return Some("claude".to_string());
    }
    if normalized.contains("opencode") || normalized.contains("open-code") {
        return Some("opencode".to_string());
    }
    if normalized.contains("codex") || normalized == "console" {
        return Some("codex".to_string());
    }
    if matches!(
        normalized.as_str(),
        "generic" | "shell" | "terminal" | "plain-shell" | "plain_shell" | "generic-shell" | "generic_shell"
    ) {
        return Some("generic".to_string());
    }
    None
}

fn terminal_clean_provider_session_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn terminal_provider_session_id_is_recordable_for_agent(
    agent_id: &str,
    agent_kind: &str,
    provider_session_id: &str,
) -> bool {
    let provider_session_id = provider_session_id.trim();
    if provider_session_id.is_empty() {
        return false;
    }
    let normalized_agent = terminal_normalize_agent_kind(Some(agent_kind))
        .or_else(|| terminal_normalize_agent_kind(Some(agent_id)));
    if normalized_agent.as_deref() == Some("opencode") {
        return provider_session_id.starts_with("ses_");
    }
    true
}

fn terminal_recordable_provider_session_id_for_metadata(
    metadata: &TerminalInstanceMetadata,
    provider_session_id: Option<&str>,
) -> Option<String> {
    let provider_session_id = terminal_clean_provider_session_id(provider_session_id)?;
    terminal_provider_session_id_is_recordable_for_agent(
        &metadata.agent_id,
        &metadata.agent_kind,
        &provider_session_id,
    )
    .then_some(provider_session_id)
}

fn terminal_provider_resume_args(
    provider: AgentProvider,
    provider_session_id: Option<&str>,
) -> Vec<String> {
    let Some(session_id) = terminal_clean_provider_session_id(provider_session_id) else {
        return Vec::new();
    };

    match provider {
        AgentProvider::Codex => vec!["resume".to_string(), session_id],
        AgentProvider::Claude => vec!["--resume".to_string(), session_id],
        AgentProvider::OpenCode => vec!["--session".to_string(), session_id],
    }
}

fn terminal_provider_fork_args(
    provider: AgentProvider,
    provider_session_id: Option<&str>,
) -> Vec<String> {
    let Some(session_id) = terminal_clean_provider_session_id(provider_session_id) else {
        return Vec::new();
    };

    match provider {
        AgentProvider::Codex => vec!["fork".to_string(), session_id],
        AgentProvider::Claude => {
            vec!["--resume".to_string(), session_id, "--fork-session".to_string()]
        }
        AgentProvider::OpenCode => vec!["--session".to_string(), session_id, "--fork".to_string()],
    }
}

fn terminal_provider_session_fork_error(provider: AgentProvider) -> String {
    format!(
        "Unable to fork this {} session because it is not available locally.",
        agent_definition(provider).label
    )
}

fn terminal_resolve_provider_resume_session(
    provider: AgentProvider,
    requested_resume_session_id: Option<String>,
    working_directory: &str,
) -> (Option<String>, Option<String>) {
    let Some(requested_session_id) = requested_resume_session_id else {
        return (None, None);
    };

    match provider {
        AgentProvider::Codex => match resolve_codex_resume_session(&requested_session_id, working_directory) {
            Ok((session_id, home)) => {
                let _ = prepare_codex_rollout_for_resume(&session_id, working_directory);
                (Some(session_id), Some(home.to_string_lossy().to_string()))
            }
            Err(error) => {
                log_terminal_status_event(
                    "backend.terminal_provider_session.resume_drop",
                    json!({
                        "error": clean_terminal_diagnostic_log_text(&error),
                        "provider": "codex",
                    }),
                );
                (None, None)
            }
        },
        AgentProvider::Claude => (Some(requested_session_id), None),
        AgentProvider::OpenCode => match resolve_opencode_resume_session(&requested_session_id, working_directory) {
            Ok(session_id) => (Some(session_id), None),
            Err(error) => {
                log_terminal_status_event(
                    "backend.terminal_provider_session.resume_drop",
                    json!({
                        "error": clean_terminal_diagnostic_log_text(&error),
                        "provider": "opencode",
                    }),
                );
                (None, None)
            }
        },
    }
}

#[derive(Clone, Default)]
struct TerminalProviderLaunchOptions {
    model: Option<String>,
    reasoning_effort: Option<String>,
    speed: Option<String>,
    permission_mode: Option<String>,
}

#[derive(Clone, Default)]
struct TerminalProviderResolvedLaunchOptions {
    model: Option<String>,
    model_source: Option<String>,
    reasoning_effort: Option<String>,
    speed: Option<String>,
    permission_mode: Option<String>,
}

fn terminal_launch_runtime_metadata_from_resolved(
    launch: &TerminalProviderResolvedLaunchOptions,
) -> TerminalLaunchRuntimeMetadata {
    TerminalLaunchRuntimeMetadata {
        model: launch.model.clone(),
        model_source: launch.model_source.clone(),
        reasoning_effort: launch.reasoning_effort.clone(),
        speed: launch.speed.clone(),
        permission_mode: launch.permission_mode.clone(),
    }
}

fn terminal_apply_launch_runtime_metadata(
    instance: &TerminalInstance,
    launch: &TerminalProviderResolvedLaunchOptions,
) {
    if let Ok(mut metadata) = instance.launch_metadata.lock() {
        *metadata = terminal_launch_runtime_metadata_from_resolved(launch);
    }
}

fn terminal_normalize_launch_keyword(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty() && value != "default")
}

fn terminal_provider_model_supports_codex_fast(model: Option<&str>) -> bool {
    let model = model.unwrap_or_default().trim().to_ascii_lowercase();
    model == "gpt-5.5" || model == "gpt-5.4"
}

fn terminal_provider_model_supports_claude_fast(model: Option<&str>) -> bool {
    let model = model.unwrap_or_default().trim().to_ascii_lowercase();
    model == "opus" || model.contains("opus")
}

fn terminal_normalize_launch_reasoning_effort(
    provider: AgentProvider,
    effort: Option<String>,
) -> Result<Option<String>, String> {
    let Some(effort) = terminal_normalize_launch_keyword(effort) else {
        return Ok(None);
    };

    let valid = match provider {
        AgentProvider::Codex => matches!(effort.as_str(), "low" | "medium" | "high" | "xhigh"),
        AgentProvider::Claude => {
            matches!(effort.as_str(), "low" | "medium" | "high" | "xhigh" | "max")
        }
        AgentProvider::OpenCode => false,
    };

    if valid {
        Ok(Some(effort))
    } else if matches!(provider, AgentProvider::OpenCode) {
        Err(
            "OpenCode launch effort is configured through OpenCode model variants, not a global CLI flag."
                .to_string(),
        )
    } else {
        Err("Launch effort is invalid for this provider.".to_string())
    }
}

fn terminal_normalize_launch_speed(
    provider: AgentProvider,
    model: Option<&str>,
    speed: Option<String>,
) -> Result<Option<String>, String> {
    let Some(speed) = speed.map(|value| value.trim().to_ascii_lowercase()) else {
        return Ok(None);
    };
    if speed.is_empty() || speed == "default" {
        return Ok(None);
    }
    if speed == "standard" {
        return Ok(Some("standard".to_string()));
    }
    if speed != "fast" {
        return Err("Launch speed is invalid.".to_string());
    }

    let supported = match provider {
        AgentProvider::Codex => terminal_provider_model_supports_codex_fast(model),
        AgentProvider::Claude => terminal_provider_model_supports_claude_fast(model),
        AgentProvider::OpenCode => false,
    };

    if supported {
        Ok(Some("fast".to_string()))
    } else {
        Err("Fast launch speed is not supported for this provider/model.".to_string())
    }
}

fn terminal_append_provider_launch_args(
    provider: AgentProvider,
    args: &mut Vec<String>,
    launch: &TerminalProviderResolvedLaunchOptions,
) {
    if matches!(provider, AgentProvider::Codex) {
        args.push("-c".to_string());
        args.push("check_for_update_on_startup=false".to_string());
    }

    if let Some(model) = launch.model.as_ref() {
        args.push("--model".to_string());
        args.push(model.clone());
    }

    match provider {
        AgentProvider::Codex => {
            if let Some(effort) = launch.reasoning_effort.as_ref() {
                args.push("-c".to_string());
                args.push(format!("model_reasoning_effort=\"{effort}\""));
            }
            if launch.speed.as_deref() == Some("fast") {
                args.push("-c".to_string());
                args.push("service_tier=\"fast\"".to_string());
                args.push("--enable".to_string());
                args.push("fast_mode".to_string());
            }
        }
        AgentProvider::Claude => {
            if let Some(effort) = launch.reasoning_effort.as_ref() {
                args.push("--effort".to_string());
                args.push(effort.clone());
            }
            if launch.speed.as_deref() == Some("fast") {
                args.push("--settings".to_string());
                args.push("{\"fastMode\":true}".to_string());
            }
        }
        AgentProvider::OpenCode => {}
    }
}

fn terminal_uuid_session_id_from_text(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    for window in bytes.windows(36) {
        let Ok(text) = std::str::from_utf8(window) else {
            continue;
        };
        let hyphenated = text
            .chars()
            .enumerate()
            .all(|(index, character)| match index {
                8 | 13 | 18 | 23 => character == '-',
                _ => character.is_ascii_hexdigit(),
            });
        if hyphenated {
            if let Ok(uuid) = uuid::Uuid::parse_str(text) {
                return Some(uuid.to_string());
            }
        }
    }
    for window in bytes.windows(32) {
        let Ok(text) = std::str::from_utf8(window) else {
            continue;
        };
        if text.chars().all(|character| character.is_ascii_hexdigit()) {
            if let Ok(uuid) = uuid::Uuid::parse_str(text) {
                return Some(uuid.to_string());
            }
        }
    }
    None
}

fn terminal_provider_session_id_from_transcript_path(event: &Value) -> Option<String> {
    terminal_activity_hook_string(
        event,
        &[
            "transcriptPath",
            "transcript_path",
            "agentTranscriptPath",
            "agent_transcript_path",
        ],
    )
    .and_then(|path| terminal_uuid_session_id_from_text(&path))
}

fn terminal_activity_hook_provider_session_id(event: &Value) -> Option<String> {
    terminal_activity_hook_string(
        event,
        &[
            "sessionId",
            "session_id",
            "providerSessionId",
            "provider_session_id",
            "nativeSessionId",
            "native_session_id",
            "conversationId",
            "conversation_id",
        ],
    )
    .or_else(|| terminal_provider_session_id_from_transcript_path(event))
}

fn terminal_runtime_snapshot(instance: &TerminalInstance) -> TerminalRuntimeSnapshot {
    instance
        .runtime
        .lock()
        .map(|snapshot| snapshot.clone())
        .unwrap_or_else(|_| TerminalRuntimeSnapshot::opened_idle(None))
}

fn terminal_runtime_apply_opened(
    instance: &TerminalInstance,
    provider_session_id: Option<&str>,
    fork_from_provider_session_id: Option<&str>,
    source: &str,
) -> TerminalRuntimeSnapshot {
    let provider_session_id =
        terminal_recordable_provider_session_id_for_metadata(&instance.metadata, provider_session_id);
    let fork_from_provider_session_id = terminal_recordable_provider_session_id_for_metadata(
        &instance.metadata,
        fork_from_provider_session_id,
    );
    let snapshot = if cloud_mcp_agent_uses_activity_hooks(&instance.metadata.agent_id)
        || cloud_mcp_agent_uses_activity_hooks(&instance.metadata.agent_kind)
    {
        let mut snapshot = TerminalRuntimeSnapshot::opened_starting(provider_session_id, source);
        snapshot.fork_from_provider_session_id = fork_from_provider_session_id;
        snapshot
    } else {
        let mut snapshot = TerminalRuntimeSnapshot::opened_idle(provider_session_id);
        snapshot.fork_from_provider_session_id = fork_from_provider_session_id;
        snapshot
    };
    if let Ok(mut runtime) = instance.runtime.lock() {
        *runtime = snapshot.clone();
    }
    snapshot
}

fn terminal_runtime_apply_provider_session_id(
    instance: &TerminalInstance,
    provider_session_id: &str,
    source: &str,
) -> Option<TerminalRuntimeSnapshot> {
    let provider_session_id = terminal_recordable_provider_session_id_for_metadata(
        &instance.metadata,
        Some(provider_session_id),
    )?;
    let mut runtime = instance.runtime.lock().ok()?;
    runtime.provider_session_id = Some(provider_session_id);
    runtime.native_session_id = runtime.provider_session_id.clone();
    runtime.source = source.to_string();
    runtime.updated_at_ms = terminal_now_ms();
    Some(runtime.clone())
}

fn terminal_runtime_apply_activity_payload(
    instance: &TerminalInstance,
    payload: &TerminalActivityHookPayload,
) -> TerminalRuntimeSnapshot {
    let previous = terminal_runtime_snapshot(instance);
    let provider_session_id = terminal_recordable_provider_session_id_for_metadata(
        &instance.metadata,
        payload.provider_session_id.as_deref(),
    )
    .or_else(|| {
        terminal_recordable_provider_session_id_for_metadata(
            &instance.metadata,
            previous.provider_session_id.as_deref(),
        )
    });
    let native_session_id = terminal_recordable_provider_session_id_for_metadata(
        &instance.metadata,
        payload.native_session_id.as_deref(),
    )
    .or(provider_session_id.clone())
    .or_else(|| {
        terminal_recordable_provider_session_id_for_metadata(
            &instance.metadata,
            previous.native_session_id.as_deref(),
        )
    });
    let fork_from_provider_session_id = terminal_recordable_provider_session_id_for_metadata(
        &instance.metadata,
        payload.fork_from_provider_session_id.as_deref(),
    )
    .or(previous.fork_from_provider_session_id);
    let snapshot = TerminalRuntimeSnapshot {
        status: payload.status.clone(),
        activity_status: payload.activity_status.clone(),
        command_phase: payload.command_phase.clone(),
        input_ready: payload.input_ready,
        input_ready_at: payload.input_ready_at.clone(),
        prompt_ready_at: payload.prompt_ready_at.clone(),
        completed_at: payload.completed_at.clone(),
        provider_session_id,
        native_session_id,
        fork_from_provider_session_id,
        provider_turn_id: payload
            .provider_turn_id
            .clone()
            .or(previous.provider_turn_id),
        turn_id: payload.turn_id.clone().or(previous.turn_id),
        source: payload.source.clone(),
        event_type: payload.event_type.clone(),
        hook_event_name: payload.hook_event_name.clone(),
        updated_at_ms: payload.observed_at_ms,
    };
    if let Ok(mut runtime) = instance.runtime.lock() {
        *runtime = snapshot.clone();
    }
    snapshot
}

fn terminal_runtime_snapshot_is_starting(runtime: &TerminalRuntimeSnapshot) -> bool {
    matches!(
        terminal_projection_text(&runtime.status, "").as_str(),
        "starting" | "prewarmed"
    ) || matches!(
        terminal_projection_text(&runtime.activity_status, "").as_str(),
        "starting" | "prewarmed"
    ) || terminal_projection_text(&runtime.command_phase, "") == "starting"
}

fn terminal_runtime_snapshot_is_busy_turn(runtime: &TerminalRuntimeSnapshot) -> bool {
    let status = terminal_projection_text(&runtime.status, "");
    let activity = terminal_projection_text(&runtime.activity_status, "");
    let command_phase = terminal_projection_text(&runtime.command_phase, "");
    let event_type = terminal_projection_text(&runtime.event_type, "");
    let hook_event_name = terminal_projection_text(&runtime.hook_event_name, "");

    if runtime.input_ready
        || terminal_projection_state_is_error(&status)
        || terminal_projection_state_is_error(&activity)
        || terminal_projection_state_is_paused(&status)
        || terminal_projection_state_is_paused(&activity)
        || terminal_projection_state_is_closed(&status)
        || terminal_projection_state_is_finished(&activity)
        || matches!(command_phase.as_str(), "completed" | "complete" | "done")
    {
        return false;
    }

    terminal_projection_state_is_busy(&status)
        || terminal_projection_state_is_busy(&activity)
        || terminal_projection_state_is_busy(&command_phase)
        || matches!(
            event_type.as_str(),
            "message_submitted"
                | "message-submitted"
                | "provider_turn_started"
                | "provider-turn-started"
                | "agent_output"
                | "agent-output"
                | "pending_prompt_sent"
                | "pending-prompt-sent"
        )
        || matches!(
            hook_event_name.as_str(),
            "backendpromptsubmit"
                | "userpromptsubmit"
                | "userpromptsubmitted"
                | "promptsubmit"
                | "promptsubmitted"
        )
}

fn terminal_prompt_ready_recovery_allowed(
    metadata: &TerminalInstanceMetadata,
    runtime: &TerminalRuntimeSnapshot,
) -> bool {
    if terminal_runtime_snapshot_is_starting(runtime) {
        return true;
    }

    // Provider Stop/session-idle hooks remain the primary completion signal,
    // but running terminals can predate the latest hook install or miss one
    // hook write. A prompt marker after the busy debounce is a recovery signal
    // for hook-managed providers that do not emit reliable turn-end hooks.
    // Codex has full hooks.json coverage, and prompt-ready recovery can race
    // ahead of its real Stop hook while an answer is still streaming.
    if terminal_metadata_is_codex(metadata) {
        return false;
    }

    terminal_runtime_snapshot_is_busy_turn(runtime)
}

fn terminal_runtime_startup_idle_fingerprint(runtime: &TerminalRuntimeSnapshot) -> Value {
    json!({
        "status": runtime.status,
        "activity_status": runtime.activity_status,
        "command_phase": runtime.command_phase,
        "input_ready": runtime.input_ready,
        "input_ready_at": runtime.input_ready_at,
        "prompt_ready_at": runtime.prompt_ready_at,
        "completed_at": runtime.completed_at,
        "provider_session_id": runtime.provider_session_id,
        "native_session_id": runtime.native_session_id,
        "fork_from_provider_session_id": runtime.fork_from_provider_session_id,
        "provider_turn_id": runtime.provider_turn_id,
        "turn_id": runtime.turn_id,
        "source": runtime.source,
        "event_type": runtime.event_type,
        "hook_event_name": runtime.hook_event_name,
        "updated_at_ms": runtime.updated_at_ms,
    })
}

fn terminal_projection_text(value: &str, fallback: &str) -> String {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '-'], "_");
    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized
    }
}

fn terminal_projection_state_is_busy(value: &str) -> bool {
    matches!(
        terminal_projection_text(value, "").as_str(),
        "busy"
            | "compacting"
            | "compaction"
            | "delegating"
            | "dispatched"
            | "editing"
            | "implementing"
            | "mcp"
            | "pending"
            | "queued"
            | "reasoning"
            | "resume_requested"
            | "resumed"
            | "running"
            | "shell"
            | "starting"
            | "subagent"
            | "subagent_completed"
            | "subagent_running"
            | "submitted"
            | "thinking"
            | "tool"
            | "tool_completed"
            | "tool_running"
            | "working"
    )
}

fn terminal_projection_state_is_idle(value: &str) -> bool {
    matches!(
        terminal_projection_text(value, "").as_str(),
        "complete" | "completed" | "done" | "idle" | "input_ready" | "interrupted" | "ready"
    )
}

fn terminal_projection_state_is_paused(value: &str) -> bool {
    matches!(
        terminal_projection_text(value, "").as_str(),
        "needs_input" | "parked" | "paused" | "prompting_user" | "resume_ready" | "waiting"
    )
}

fn terminal_projection_state_is_error(value: &str) -> bool {
    matches!(
        terminal_projection_text(value, "").as_str(),
        "error" | "failed" | "failure"
    )
}

fn terminal_projection_state_is_closed(value: &str) -> bool {
    matches!(
        terminal_projection_text(value, "").as_str(),
        "closed" | "closing" | "exited" | "no_session" | "offline" | "stopped" | "terminated"
    )
}

fn terminal_projection_state_is_finished(value: &str) -> bool {
    matches!(
        terminal_projection_text(value, "").as_str(),
        "cancelled" | "canceled" | "complete" | "completed" | "done" | "interrupted"
    )
}

fn terminal_projection_state_is_compacting(value: &str) -> bool {
    matches!(
        terminal_projection_text(value, "").as_str(),
        "compacting" | "compaction"
    )
}

fn terminal_projection_readiness(status: &str) -> &'static str {
    let status = terminal_projection_text(status, "idle");
    if terminal_projection_state_is_busy(&status) {
        "busy"
    } else if terminal_projection_state_is_paused(&status) {
        "needs_input"
    } else if terminal_projection_state_is_error(&status) {
        "error"
    } else if status == "closing" {
        "closing"
    } else if terminal_projection_state_is_closed(&status) {
        "closed"
    } else {
        "ready"
    }
}

fn terminal_projection_turn_status(activity_status: &str, status: &str) -> &'static str {
    let activity = terminal_projection_text(
        activity_status,
        &terminal_projection_text(status, "idle"),
    );
    if matches!(activity.as_str(), "cancelled" | "canceled" | "interrupted") {
        "interrupted"
    } else if terminal_projection_state_is_compacting(&activity) {
        "running"
    } else if terminal_projection_state_is_busy(&activity) {
        "running"
    } else if terminal_projection_state_is_error(&activity) {
        "failed"
    } else if terminal_projection_state_is_paused(&activity) {
        "pending"
    } else if terminal_projection_state_is_closed(&activity) {
        "interrupted"
    } else {
        "completed"
    }
}

fn terminal_projection_execution_phase(
    event_type: &str,
    command_phase: &str,
    activity_status: &str,
    status: &str,
    readiness: &str,
    turn_status: &str,
    terminal_lifecycle: &str,
) -> &'static str {
    let event_type = terminal_projection_text(event_type, "");
    let command_phase = terminal_projection_text(command_phase, "");
    let activity = terminal_projection_text(activity_status, "");
    let status = terminal_projection_text(status, "");
    let readiness = terminal_projection_text(readiness, "");
    let turn = terminal_projection_text(turn_status, "");
    let lifecycle = terminal_projection_text(terminal_lifecycle, "");

    if matches!(activity.as_str(), "starting" | "prewarmed")
        || matches!(status.as_str(), "starting" | "prewarmed")
        || command_phase == "starting"
    {
        return "starting";
    }
    if lifecycle == "offline" || activity == "offline" || status == "offline" {
        return "offline";
    }
    if lifecycle == "exited" || activity == "exited" || status == "exited" {
        return "exited";
    }
    if ["closed", "closing", "terminated"].contains(&lifecycle.as_str())
        || ["closed", "closing", "terminated"].contains(&status.as_str())
    {
        return if lifecycle == "closing" || status == "closing" {
            "closing"
        } else {
            "closed"
        };
    }
    if matches!(
        event_type.as_str(),
        "provider_turn_compacting" | "context_compaction_started"
    ) || terminal_projection_state_is_compacting(&command_phase)
        || terminal_projection_state_is_compacting(&activity)
        || terminal_projection_state_is_compacting(&turn)
    {
        return "compacting";
    }
    if event_type == "provider_turn_interrupted" || turn == "interrupted" {
        return "interrupted";
    }
    if matches!(turn.as_str(), "cancelled" | "canceled")
        || matches!(command_phase.as_str(), "cancelled" | "canceled")
    {
        return "cancelled";
    }
    if matches!(event_type.as_str(), "provider_turn_error" | "pending_prompt_error")
        || matches!(turn.as_str(), "failed" | "error")
        || terminal_projection_state_is_error(&activity)
        || readiness == "error"
        || status == "error"
    {
        return "failed";
    }
    if terminal_projection_state_is_paused(&activity)
        || matches!(readiness.as_str(), "needs_input" | "paused")
    {
        return "needs_input";
    }
    if command_phase == "queued" {
        return "queued";
    }
    if matches!(
        command_phase.as_str(),
        "submitted" | "input_written" | "accepted" | "running"
    ) || matches!(
        event_type.as_str(),
        "message_submitted" | "provider_turn_started" | "agent_output" | "pending_prompt_sent"
    ) || terminal_projection_state_is_busy(&activity)
        || matches!(
            turn.as_str(),
            "queued" | "submitted" | "pending" | "running" | "thinking" | "reasoning" | "working"
        )
        || (readiness == "busy" && !terminal_projection_state_is_finished(&turn))
    {
        return "running";
    }
    if event_type == "provider_turn_completed"
        || matches!(
            command_phase.as_str(),
            "completed" | "complete" | "done"
        )
        || terminal_projection_state_is_finished(&turn)
        || terminal_projection_state_is_idle(&activity)
        || matches!(readiness.as_str(), "ready" | "input_ready")
    {
        return "idle";
    }

    "idle"
}

fn terminal_projection_rail_state(execution_phase: &str, fallback: &str) -> String {
    match terminal_projection_text(execution_phase, "").as_str() {
        "starting" | "prewarmed" => "starting".to_string(),
        "offline" | "closed" | "closing" | "exited" => {
            terminal_projection_text(execution_phase, "closed")
        }
        "failed" => "error".to_string(),
        "needs_input" | "paused" | "parked" | "resume_ready" => "paused".to_string(),
        "compacting" | "compaction" => "compacting".to_string(),
        "queued" | "submitted" | "input_written" | "accepted" | "running" | "cancelling" => {
            "thinking".to_string()
        }
        "cancelled" | "canceled" | "interrupted" => "interrupted".to_string(),
        "completed" | "complete" | "done" | "idle" => {
            "idle".to_string()
        }
        _ => terminal_projection_text(fallback, "idle"),
    }
}

fn terminal_projection_label(value: &str) -> String {
    terminal_projection_text(value, "unknown").replace(['_', '-'], " ")
}

fn terminal_projection_display_name(metadata: &TerminalInstanceMetadata) -> String {
    [
        metadata.terminal_nickname.as_str(),
        metadata.terminal_name.as_str(),
        metadata.agent_kind.as_str(),
        metadata.agent_id.as_str(),
        "Terminal",
    ]
    .iter()
    .map(|value| value.trim())
    .find(|value| !value.is_empty())
    .unwrap_or("Terminal")
    .to_string()
}

#[derive(Clone)]
struct TerminalProjectedRuntime {
    display_name: String,
    terminal_name: String,
    terminal_nickname: String,
    execution_phase: String,
    native_rail_state: String,
    native_rail_label: String,
    readiness: String,
    terminal_lifecycle: String,
    terminal_status: String,
    terminal_work_state: String,
    turn_status: String,
    session_state: String,
}

fn terminal_project_runtime(
    metadata: &TerminalInstanceMetadata,
    runtime: &TerminalRuntimeSnapshot,
    parked: bool,
) -> TerminalProjectedRuntime {
    let terminal_lifecycle = if terminal_projection_state_is_closed(&runtime.status) {
        "closed"
    } else {
        "open"
    };
    let raw_activity = terminal_projection_text(&runtime.activity_status, "");
    let raw_event_type = terminal_projection_text(&runtime.event_type, "");
    let raw_command_phase = terminal_projection_text(&runtime.command_phase, "");
    let raw_status = terminal_projection_text(&runtime.status, "");
    let status = if terminal_lifecycle == "closed" {
        "closed".to_string()
    } else if matches!(raw_activity.as_str(), "starting" | "prewarmed")
        || matches!(raw_status.as_str(), "starting" | "prewarmed")
        || raw_command_phase == "starting"
    {
        "starting".to_string()
    } else if raw_event_type == "provider_turn_interrupted"
        || matches!(raw_command_phase.as_str(), "cancelled" | "canceled" | "interrupted")
        || matches!(raw_activity.as_str(), "cancelled" | "canceled" | "interrupted")
    {
        "interrupted".to_string()
    } else if matches!(
        raw_event_type.as_str(),
        "provider_turn_compacting" | "context_compaction_started"
    ) || terminal_projection_state_is_compacting(&raw_activity)
        || terminal_projection_state_is_compacting(&raw_command_phase)
    {
        "compacting".to_string()
    } else if parked || terminal_projection_state_is_paused(&raw_activity) {
        "paused".to_string()
    } else if terminal_projection_state_is_error(&raw_activity)
        || terminal_projection_state_is_error(&runtime.status)
    {
        "error".to_string()
    } else if terminal_projection_state_is_busy(&raw_activity)
        || terminal_projection_state_is_busy(&raw_command_phase)
    {
        "thinking".to_string()
    } else if terminal_projection_state_is_idle(&raw_activity) || runtime.input_ready {
        "idle".to_string()
    } else {
        terminal_projection_text(&runtime.status, "idle")
    };
    let readiness = terminal_projection_readiness(&status).to_string();
    let turn_status = terminal_projection_turn_status(&raw_activity, &status).to_string();
    let execution_phase = terminal_projection_execution_phase(
        &runtime.event_type,
        &runtime.command_phase,
        &raw_activity,
        &status,
        &readiness,
        &turn_status,
        terminal_lifecycle,
    )
    .to_string();
    let native_rail_state = terminal_projection_rail_state(&execution_phase, &status);
    let native_rail_label = terminal_projection_label(&native_rail_state);
    let terminal_work_state = if terminal_lifecycle == "closed" {
        "closed"
    } else if parked || terminal_projection_state_is_paused(&native_rail_state) {
        "prompting_user"
    } else if terminal_projection_state_is_error(&native_rail_state) {
        "error"
    } else if terminal_projection_state_is_busy(&native_rail_state) {
        "running"
    } else {
        "complete"
    }
    .to_string();
    let display_name = terminal_projection_display_name(metadata);
    let terminal_name = metadata
        .terminal_name
        .trim()
        .to_string()
        .if_empty_then(|| display_name.clone());

    TerminalProjectedRuntime {
        display_name,
        terminal_name,
        terminal_nickname: metadata.terminal_nickname.trim().to_string(),
        execution_phase,
        native_rail_state,
        native_rail_label,
        readiness,
        terminal_lifecycle: terminal_lifecycle.to_string(),
        terminal_status: status,
        terminal_work_state,
        turn_status,
        session_state: if terminal_lifecycle == "closed" {
            "no_session".to_string()
        } else {
            "session_attached".to_string()
        },
    }
}

trait TerminalIfEmptyThen {
    fn if_empty_then<F: FnOnce() -> String>(self, fallback: F) -> String;
}

impl TerminalIfEmptyThen for String {
    fn if_empty_then<F: FnOnce() -> String>(self, fallback: F) -> String {
        if self.trim().is_empty() {
            fallback()
        } else {
            self
        }
    }
}

fn terminal_record_coordination_provider_session_id(
    coordination: TerminalCoordinationSession,
    provider_session_id: String,
    source: impl Into<String>,
) {
    let source = source.into();
    if !terminal_provider_session_id_is_recordable_for_agent(
        &coordination.agent_id,
        &coordination.agent_kind,
        &provider_session_id,
    ) {
        log_terminal_status_event(
            "backend.terminal_provider_session.record_skip",
            json!({
                "provider": coordination.agent_kind,
                "reason": "invalid-provider-session-id",
                "source": source.clone(),
            }),
        );
        return;
    }
    tauri::async_runtime::spawn_blocking(
        move || match crate::coordination::CoordinationKernel::open(
            &coordination.repo_path,
            Some(PathBuf::from(&coordination.db_path)),
        ) {
            Ok(kernel) => {
                if let Err(error) = kernel.record_session_provider_session_id(
                    &coordination.session_id,
                    &provider_session_id,
                ) {
                    log_terminal_status_event(
                        "backend.terminal_provider_session.record_error",
                        json!({
                            "error": clean_terminal_diagnostic_log_text(&error),
                            "source": source.clone(),
                        }),
                    );
                }
            }
            Err(error) => log_terminal_status_event(
                "backend.terminal_provider_session.kernel_open_error",
                json!({
                    "error": clean_terminal_diagnostic_log_text(&error),
                    "source": source.clone(),
                }),
            ),
        },
    );
}

fn terminal_provider_session_binding_root(instance: &TerminalInstance) -> String {
    instance
        .coordination
        .as_ref()
        .map(|coordination| coordination.repo_path.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| instance.working_directory.to_string_lossy().to_string())
}

fn terminal_provider_session_binding_payload(
    instance: &TerminalInstance,
    provider_session_id: &str,
    source: &str,
) -> Option<WorkspaceThreadProviderSessionBinding> {
    let metadata = instance.metadata.clone();
    let provider_session_id =
        terminal_recordable_provider_session_id_for_metadata(&metadata, Some(provider_session_id))?;
    let runtime = terminal_runtime_snapshot(instance);
    let fork_from_provider_session_id = runtime.fork_from_provider_session_id.clone().unwrap_or_default();
    let shared_history_id = workspace_agent_session_history_shared_history_id(
        &metadata.workspace_id,
        &metadata.agent_kind,
        &provider_session_id,
        &fork_from_provider_session_id,
    );
    Some(WorkspaceThreadProviderSessionBinding {
        workspace_id: metadata.workspace_id,
        thread_id: metadata.thread_id,
        agent_id: metadata.agent_id,
        provider_session_id: provider_session_id.clone(),
        native_session_id: provider_session_id,
        fork_from_provider_session_id,
        shared_history_id,
        native_session_kind: "session".to_string(),
        native_session_source: source.to_string(),
        pane_id: metadata.pane_id,
        instance_id: Some(instance.id),
        terminal_index: metadata.terminal_index.map(i64::from),
        provider: metadata.agent_kind,
        session_title: String::new(),
        model_id: String::new(),
        source: source.to_string(),
        cwd: instance.working_directory.to_string_lossy().to_string(),
        observed_at_ms: terminal_now_ms(),
    })
}

fn terminal_emit_provider_session_binding(
    app: &AppHandle,
    binding: &WorkspaceThreadProviderSessionBinding,
    recorded: Option<bool>,
) {
    let mut payload = serde_json::to_value(binding).unwrap_or_else(|_| json!({}));
    if let Some(object) = payload.as_object_mut() {
        object.insert("type".to_string(), json!("provider-session"));
        object.insert("recorded".to_string(), json!(recorded));
        object.insert(
            "sessionId".to_string(),
            json!(binding.provider_session_id.clone()),
        );
        object.insert(
            "providerSessionId".to_string(),
            json!(binding.provider_session_id.clone()),
        );
        object.insert(
            "nativeSessionId".to_string(),
            json!(binding.native_session_id.clone()),
        );
        object.insert(
            "nativeSessionKind".to_string(),
            json!(binding.native_session_kind.clone()),
        );
        object.insert(
            "nativeSessionSource".to_string(),
            json!(binding.native_session_source.clone()),
        );
    }
    let _ = app.emit(TERMINAL_PROVIDER_SESSION_BOUND_EVENT, payload);
}

fn terminal_workspace_agent_session_status_requires_input(
    event_type: &str,
    activity_status: &str,
    command_phase: &str,
) -> bool {
    let event_type = terminal_projection_text(event_type, "");
    let activity_status = terminal_projection_text(activity_status, "");
    let command_phase = terminal_projection_text(command_phase, "");
    matches!(
        event_type.as_str(),
        "provider_user_prompt_started" | "provider-user-prompt-started"
    ) || matches!(
        activity_status.as_str(),
        "awaiting_input" | "awaiting_user" | "needs_input" | "prompting_user"
    ) || matches!(
        command_phase.as_str(),
        "awaiting_input"
            | "awaiting_user"
            | "needs_input"
            | "prompting_user"
            | "requires_input"
            | "requires_user_input"
    )
}

fn terminal_workspace_agent_session_status_from_runtime(
    runtime: &TerminalRuntimeSnapshot,
) -> String {
    if terminal_workspace_agent_session_status_requires_input(
        &runtime.event_type,
        &runtime.activity_status,
        &runtime.command_phase,
    ) {
        return "needs_input".to_string();
    }
    terminal_projection_text(
        &runtime.activity_status,
        &terminal_projection_text(&runtime.status, "active"),
    )
}

fn terminal_workspace_agent_session_status_from_payload(
    payload: &TerminalActivityHookPayload,
) -> String {
    if payload.terminal_is_prompting_user
        || terminal_workspace_agent_session_status_requires_input(
            &payload.event_type,
            &payload.activity_status,
            &payload.command_phase,
        )
    {
        return "needs_input".to_string();
    }
    terminal_projection_text(
        &payload.activity_status,
        &terminal_projection_text(&payload.status, "active"),
    )
}

fn terminal_record_workspace_provider_session_binding(
    app: Option<AppHandle>,
    instance: &TerminalInstance,
    provider_session_id: String,
    source: impl Into<String>,
) {
    let source = source.into();
    let Some(binding) =
        terminal_provider_session_binding_payload(instance, &provider_session_id, &source)
    else {
        return;
    };
    if let Some(app) = app.as_ref() {
        terminal_emit_provider_session_binding(app, &binding, None);
    }
    let history_status =
        terminal_workspace_agent_session_status_from_runtime(&terminal_runtime_snapshot(instance));
    terminal_record_workspace_agent_session_history(
        app.clone(),
        instance,
        None,
        None,
            &history_status,
        format!("{source}:provider-session"),
        None,
    );
    let root_directory = terminal_provider_session_binding_root(instance);
    let emit_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        match workspace_threads_record_provider_session_binding(
            Some(root_directory.as_str()),
            binding.clone(),
        ) {
            Ok(recorded) => {
                if let Some(app) = emit_app.as_ref() {
                    terminal_emit_provider_session_binding(app, &binding, Some(recorded));
                }
            }
            Err(error) => log_terminal_status_event(
                "backend.terminal_provider_session.binding_record_error",
                json!({
                    "error": clean_terminal_diagnostic_log_text(&error),
                    "source": source,
                }),
            ),
        }
    });
}

fn terminal_workspace_agent_session_slot_key(
    instance: &TerminalInstance,
    override_slot_key: Option<&str>,
) -> String {
    override_slot_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            instance
                .coordination
                .as_ref()
                .and_then(|coordination| terminal_coordination_env_value(coordination, "COORDINATION_SLOT_KEY"))
        })
        .unwrap_or_default()
}

fn terminal_workspace_agent_session_title(instance: &TerminalInstance) -> String {
    let metadata = &instance.metadata;
    [
        metadata.terminal_nickname.as_str(),
        metadata.terminal_name.as_str(),
        metadata.agent_kind.as_str(),
        metadata.agent_id.as_str(),
    ]
    .into_iter()
    .map(str::trim)
    .find(|value| !value.is_empty())
    .unwrap_or("Coding agent session")
    .to_string()
}

fn terminal_emit_workspace_agent_session_history_changed(
    app: &AppHandle,
    record: &WorkspaceAgentSessionHistoryRecord,
    recorded: Option<bool>,
) {
    let mut payload = serde_json::to_value(record).unwrap_or_else(|_| json!({}));
    if let Some(object) = payload.as_object_mut() {
        object.insert("type".to_string(), json!("workspace-agent-session-history"));
        object.insert("recorded".to_string(), json!(recorded));
        object.insert("workspaceId".to_string(), json!(record.workspace_id.clone()));
        object.insert("sessionHistoryId".to_string(), json!(record.id.clone()));
    }
    let _ = app.emit(WORKSPACE_AGENT_SESSION_HISTORY_CHANGED_EVENT, payload);
}

fn terminal_record_workspace_agent_session_history(
    app: Option<AppHandle>,
    instance: &TerminalInstance,
    model_id: Option<&str>,
    model_source: Option<&str>,
    status: &str,
    source: impl Into<String>,
    slot_key_override: Option<&str>,
) {
    let source = source.into();
    let metadata = instance.metadata.clone();
    if metadata.workspace_id.trim().is_empty() {
        return;
    }
    let launch_metadata = instance
        .launch_metadata
        .lock()
        .map(|metadata| metadata.clone())
        .unwrap_or_default();
    let runtime = terminal_runtime_snapshot(instance);
    let provider_session_id = terminal_recordable_provider_session_id_for_metadata(
        &metadata,
        runtime.provider_session_id.as_deref(),
    );
    let native_session_id = terminal_recordable_provider_session_id_for_metadata(
        &metadata,
        runtime.native_session_id.as_deref(),
    )
    .or(provider_session_id.clone());
    if provider_session_id.is_none() && native_session_id.is_none() {
        return;
    }
    let visible_session_id = provider_session_id
        .as_deref()
        .or(native_session_id.as_deref())
        .unwrap_or_default()
        .to_string();
    let canonical_history_id = workspace_agent_session_history_record_id(
        &metadata.workspace_id,
        &metadata.agent_kind,
        &visible_session_id,
    );
    let coordination_session_id = instance
        .coordination
        .as_ref()
        .map(|coordination| coordination.session_id.clone())
        .unwrap_or_default();
    let record = WorkspaceAgentSessionHistoryRecord {
        id: canonical_history_id,
        workspace_id: metadata.workspace_id.clone(),
        workspace_name: metadata.workspace_name,
        coordination_session_id,
        provider_session_id: provider_session_id.clone().unwrap_or_default(),
        native_session_id: native_session_id.clone().unwrap_or_default(),
        fork_from_provider_session_id: runtime.fork_from_provider_session_id.clone().unwrap_or_default(),
        shared_history_id: workspace_agent_session_history_shared_history_id(
            &metadata.workspace_id,
            &metadata.agent_kind,
            provider_session_id
                .as_deref()
                .or(native_session_id.as_deref())
                .unwrap_or_default(),
            runtime.fork_from_provider_session_id.as_deref().unwrap_or_default(),
        ),
        agent_id: metadata.agent_id,
        provider: metadata.agent_kind,
        model_id: model_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .or(launch_metadata.model.as_deref())
            .unwrap_or_default()
            .trim()
            .to_string(),
        model_source: model_source
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .or(launch_metadata.model_source.as_deref())
            .unwrap_or_default()
            .trim()
            .to_string(),
        session_mode: instance.session_mode.as_str().to_string(),
        file_authority: instance.session_mode.file_authority().to_string(),
        coordination_mode: instance
            .coordination
            .as_ref()
            .and_then(|coordination| {
                terminal_coordination_env_value(coordination, "COORDINATION_ENFORCEMENT_MODE")
            })
            .unwrap_or_default(),
        thread_id: metadata.thread_id,
        pane_id: metadata.pane_id,
        terminal_instance_id: Some(instance.id),
        terminal_index: metadata.terminal_index.map(i64::from),
        slot_key: terminal_workspace_agent_session_slot_key(instance, slot_key_override),
        cwd: instance.working_directory.to_string_lossy().to_string(),
        status: status.trim().to_string(),
        title: terminal_workspace_agent_session_title(instance),
        source: source.clone(),
        observed_at_ms: Some(terminal_now_ms()),
        created_at_ms: None,
    };
    let root_directory = terminal_provider_session_binding_root(instance);
    let emit_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        match workspace_agent_session_history_upsert_blocking(
            Some(root_directory.as_str()),
            record.clone(),
        ) {
            Ok(recorded) => {
                if let Some(app) = emit_app.as_ref() {
                    terminal_emit_workspace_agent_session_history_changed(app, &record, Some(recorded));
                    agent_chat_session_sync_spawn_from_history_record(
                        app.clone(),
                        record.clone(),
                        "terminal_session_history",
                    );
                }
            }
            Err(error) => log_terminal_status_event(
                "backend.workspace_agent_session_history.record_error",
                json!({
                    "error": clean_terminal_diagnostic_log_text(&error),
                    "source": source,
                }),
            ),
        }
    });
}

const TERMINAL_CODEX_SESSION_DISCOVERY_DELAYS_MS: [u64; 6] =
    [700, 1_500, 3_000, 6_000, 12_000, 20_000];

fn terminal_runtime_has_provider_session(instance: &TerminalInstance) -> bool {
    terminal_runtime_snapshot(instance)
        .provider_session_id
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
}

fn terminal_current_recordable_provider_session_id(
    instance: &TerminalInstance,
) -> Option<String> {
    let runtime = terminal_runtime_snapshot(instance);
    runtime
        .provider_session_id
        .or(runtime.native_session_id)
        .and_then(|session_id| {
            terminal_recordable_provider_session_id_for_metadata(
                &instance.metadata,
                Some(&session_id),
            )
        })
}

fn spawn_terminal_codex_session_discovery(
    app: AppHandle,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    pane_id: String,
    instance_id: u64,
    launched_at_ms: u64,
    source: impl Into<String>,
) {
    let source = source.into();
    tauri::async_runtime::spawn(async move {
        for delay_ms in TERMINAL_CODEX_SESSION_DISCOVERY_DELAYS_MS {
            sleep(Duration::from_millis(delay_ms)).await;

            let Some(instance) =
                terminal_activity_hook_current_instance(&terminals, &pane_id, instance_id).await
            else {
                break;
            };
            if !terminal_metadata_is_codex(&instance.metadata) {
                break;
            }
            if terminal_runtime_has_provider_session(&instance) {
                break;
            }

            let cwd = instance.working_directory.to_string_lossy().to_string();
            let discovered = match tauri::async_runtime::spawn_blocking(move || {
                discover_latest_codex_session_for_cwd(&cwd, launched_at_ms)
            })
            .await
            {
                Ok(Ok(discovered)) => discovered,
                Ok(Err(error)) => {
                    log_terminal_status_event(
                        "backend.terminal_provider_session.codex_discovery_error",
                        json!({
                            "error": clean_terminal_diagnostic_log_text(&error),
                            "instance_id": instance_id,
                            "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                            "source": source.clone(),
                        }),
                    );
                    None
                }
                Err(error) => {
                    log_terminal_status_event(
                        "backend.terminal_provider_session.codex_discovery_join_error",
                        json!({
                            "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                            "instance_id": instance_id,
                            "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                            "source": source.clone(),
                        }),
                    );
                    None
                }
            };

            let Some(discovered) = discovered else {
                continue;
            };
            let provider_session_id =
                match terminal_clean_provider_session_id(Some(&discovered.session_id)) {
                    Some(provider_session_id) => provider_session_id,
                    None => continue,
                };

            let Some(current_instance) =
                terminal_activity_hook_current_instance(&terminals, &pane_id, instance_id).await
            else {
                break;
            };
            if terminal_runtime_has_provider_session(&current_instance) {
                break;
            }

            terminal_runtime_apply_provider_session_id(
                &current_instance,
                &provider_session_id,
                "codex-transcript-discovery",
            );
            terminal_record_workspace_provider_session_binding(
                Some(app.clone()),
                &current_instance,
                provider_session_id.clone(),
                "codex-transcript-discovery",
            );
            if let Some(coordination) = current_instance.coordination.clone() {
                terminal_record_coordination_provider_session_id(
                    coordination,
                    provider_session_id.clone(),
                    "codex-transcript-discovery",
                );
            }
            log_terminal_status_event(
                "backend.terminal_provider_session.codex_discovered",
                json!({
                    "cwd": clean_terminal_diagnostic_log_text(&discovered.cwd),
                    "instance_id": instance_id,
                    "latest_timestamp": discovered.latest_timestamp,
                    "modified_at_ms": discovered.modified_at_ms,
                    "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                    "provider_session_id_present": true,
                    "rollout_path": clean_terminal_diagnostic_log_text(&discovered.rollout_path),
                    "session_title_present": !discovered.session_title.trim().is_empty(),
                    "source": source.clone(),
                }),
            );
            break;
        }
    });
}

fn terminal_launch(
    kind: &str,
    provider: Option<String>,
    launch_options: TerminalProviderLaunchOptions,
    provider_session_id: Option<String>,
    fork_from_provider_session_id: Option<String>,
    working_directory: &str,
) -> Result<(
    Vec<String>,
    Vec<String>,
    String,
    Option<String>,
    TerminalProviderResolvedLaunchOptions,
    Option<String>,
), String> {
    let provider = terminal_launch_provider(kind, provider.as_deref())?;
    let definition = agent_definition(provider);
    let requested_resume_session_id = provider_session_id
        .as_deref()
        .and_then(|session_id| terminal_clean_provider_session_id(Some(session_id)));
    let requested_fork_session_id = fork_from_provider_session_id
        .as_deref()
        .and_then(|session_id| terminal_clean_provider_session_id(Some(session_id)));
    let is_fork_launch = requested_fork_session_id.is_some();
    let (source_session_id, codex_resume_home) = if is_fork_launch {
        let (session_id, codex_resume_home) = terminal_resolve_provider_resume_session(
            provider,
            requested_fork_session_id,
            working_directory,
        );
        let Some(session_id) = session_id else {
            return Err(terminal_provider_session_fork_error(provider));
        };
        (Some(session_id), codex_resume_home)
    } else {
        terminal_resolve_provider_resume_session(
            provider,
            requested_resume_session_id,
            working_directory,
        )
    };
    let mut args = if is_fork_launch {
        terminal_provider_fork_args(provider, source_session_id.as_deref())
    } else {
        terminal_provider_resume_args(provider, source_session_id.as_deref())
    };

    // When resuming, the session transcript knows the exact model that was
    // active when the session closed — including in-session `/model`
    // switches the stored binding never saw. Prefer it over the caller's
    // default so a reopened terminal continues on the same model.
    let session_model = source_session_id
        .as_deref()
        .and_then(|session_id| agent_session_last_model(provider, session_id))
        .and_then(|model| normalize_forge_model(Some(model)).ok().flatten());
    let request_model = normalize_forge_model(launch_options.model)?;
    let mut resolved_launch = match session_model {
        Some(model) => TerminalProviderResolvedLaunchOptions {
            model: Some(model),
            model_source: Some("session-current".to_string()),
            ..Default::default()
        },
        None => {
            let source = if request_model.is_some() {
                Some("request".to_string())
            } else {
                None
            };
            TerminalProviderResolvedLaunchOptions {
                model: request_model,
                model_source: source,
                ..Default::default()
            }
        }
    };
    resolved_launch.reasoning_effort = terminal_normalize_launch_reasoning_effort(
        provider,
        launch_options.reasoning_effort,
    )?;
    resolved_launch.speed = terminal_normalize_launch_speed(
        provider,
        resolved_launch.model.as_deref(),
        launch_options.speed,
    )?;
    resolved_launch.permission_mode =
        terminal_normalize_permission_mode(launch_options.permission_mode)?;
    terminal_append_provider_launch_args(provider, &mut args, &resolved_launch);

    Ok((
        agent_command_candidates(definition),
        args,
        definition.label.to_string(),
        codex_resume_home,
        resolved_launch,
        if is_fork_launch { None } else { source_session_id },
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

fn terminal_audio_route_gate(state: &TerminalState) -> Result<TerminalAudioRouteGate, String> {
    state
        .audio_route_gate
        .lock()
        .map(|gate| gate.clone())
        .map_err(|_| "Unable to read the terminal audio route gate.".to_string())
}

fn set_terminal_audio_route_gate_for(
    state: &TerminalState,
    allow_terminal: bool,
) -> Result<(), String> {
    let mut gate = state
        .audio_route_gate
        .lock()
        .map_err(|_| "Unable to update the terminal audio route gate.".to_string())?;

    if gate.allow_terminal != allow_terminal {
        write_thread_bridge_diagnostic_log_entry(json!({
            "ts_ms": current_time_ms(),
            "phase": "backend.audio_input_target.route_gate",
            "source": "backend",
            "app_pid": std::process::id(),
            "thread": terminal_diagnostic_thread_label(),
            "fields": {
                "allow_terminal": allow_terminal,
            },
        }));
    }
    gate.allow_terminal = allow_terminal;

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

fn app_has_focused_terminal_window(app: &AppHandle) -> bool {
    app.webview_windows().into_iter().any(|(label, window)| {
        label.starts_with(TERMINAL_WINDOW_LABEL_PREFIX) && window.is_focused().unwrap_or(false)
    })
}

fn app_has_focused_audio_input_window(app: &AppHandle) -> bool {
    webview_window_is_focused(app, "main")
        || webview_window_is_focused(app, AUDIO_WIDGET_WINDOW_LABEL)
        || app_has_focused_terminal_window(app)
}

fn terminal_audio_input_target_window_is_focused(
    app: &AppHandle,
    target: &TerminalAudioInputTarget,
) -> bool {
    webview_window_is_focused(app, &terminal_window_label(&target.pane_id))
}

fn app_has_focused_audio_input_window_for_target(
    app: &AppHandle,
    target: &TerminalAudioInputTarget,
) -> bool {
    webview_window_is_focused(app, "main")
        || webview_window_is_focused(app, AUDIO_WIDGET_WINDOW_LABEL)
        || terminal_audio_input_target_window_is_focused(app, target)
}

fn terminal_audio_target_should_own_insert(
    app: &AppHandle,
    state: &TerminalState,
    target: Option<&TerminalAudioInputTarget>,
) -> Result<bool, String> {
    let Some(target) = target else {
        return Ok(false);
    };

    if terminal_audio_input_target_window_is_focused(app, target) {
        return Ok(true);
    }

    if !terminal_audio_route_gate(state)?.allow_terminal {
        return Ok(false);
    }

    Ok(webview_window_is_focused(app, "main")
        || webview_window_is_focused(app, AUDIO_WIDGET_WINDOW_LABEL))
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

    let instance = {
        let terminals = state.terminals.read().await;
        let Some(instance) = terminals.get(pane_id).cloned() else {
            return if instance_id.is_some() {
                Ok(false)
            } else {
                Err("Terminal session is not running.".to_string())
            };
        };

        if instance_id.is_some_and(|expected_id| expected_id != instance.id) {
            return Ok(false);
        }

        instance
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
    let terminals = state.terminals.read().await;
    let mut writer = instance.writer.lock().await;
    let lock_wait_ms = terminal_diagnostic_elapsed_ms(lock_started_at);
    if terminals
        .get(pane_id)
        .map(|current| current.id != instance.id)
        .unwrap_or(true)
    {
        return Ok(false);
    }
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

    // The webview gates the terminal route by what the user is actually
    // looking at: another tab in front of the Terminals view, or focus in a
    // non-terminal editable (for example the todo list), routes dictation to
    // that input instead. The pane selection is kept so the terminal becomes
    // the target again once it is back in view.
    let target_terminal_window_focused = terminal_audio_input_target_window_is_focused(app, &target);
    if !terminal_audio_route_gate(state)?.allow_terminal && !target_terminal_window_focused {
        write_thread_bridge_diagnostic_log_entry(json!({
            "ts_ms": current_time_ms(),
            "phase": "backend.audio_input_target.write_skip",
            "source": "backend",
            "app_pid": std::process::id(),
            "thread": terminal_diagnostic_thread_label(),
            "fields": {
                "pane_id": clean_terminal_diagnostic_log_text(&target.pane_id),
                "reason": "route_gate_blocked",
            },
        }));
        return Ok(false);
    }

    if !app_has_focused_audio_input_window_for_target(app, &target) {
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

fn terminal_metadata_is_claude(metadata: &TerminalInstanceMetadata) -> bool {
    let agent_id = metadata.agent_id.trim().to_ascii_lowercase();
    let agent_kind = metadata.agent_kind.trim().to_ascii_lowercase();

    agent_id.contains("claude") || agent_kind.contains("claude")
}

fn terminal_metadata_is_codex(metadata: &TerminalInstanceMetadata) -> bool {
    let agent_id = metadata.agent_id.trim().to_ascii_lowercase();
    let agent_kind = metadata.agent_kind.trim().to_ascii_lowercase();

    agent_id.contains("codex") || agent_kind.contains("codex")
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
        developer_process_refresh_kind(true),
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
        runtime: _,
        launch_metadata: _,
        app_control_mcp_requested: _,
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
struct TerminalSessionCapabilities {
    provider: String,
    current_model: Option<String>,
    current_model_source: Option<String>,
    current_effort: Option<String>,
    current_speed: Option<String>,
    permission_mode: Option<String>,
    available_reasoning_efforts: Vec<String>,
    available_permission_modes: Vec<String>,
    can_prompt_answer: bool,
    can_interrupt: bool,
    can_raw_input: bool,
    can_close: bool,
    can_change_model_now: bool,
    can_change_effort_now: bool,
    can_change_permission_mode_now: bool,
    prompt_answer_mechanism: String,
    interrupt_mechanism: String,
    raw_input_mechanism: String,
}

fn terminal_session_capabilities(
    agent_kind: &str,
    launch_metadata: &TerminalLaunchRuntimeMetadata,
) -> TerminalSessionCapabilities {
    let provider = terminal_normalize_agent_kind(Some(agent_kind))
        .unwrap_or_else(|| agent_kind.trim().to_ascii_lowercase())
        .replace('-', "_");
    let available_reasoning_efforts = match provider.as_str() {
        "codex" => ["low", "medium", "high", "xhigh"]
            .into_iter()
            .map(str::to_string)
            .collect(),
        "claude" => ["low", "medium", "high", "xhigh", "max"]
            .into_iter()
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    };
    let available_permission_modes = match provider.as_str() {
        "codex" | "claude" | "opencode" => [
            TERMINAL_PERMISSION_MODE_PLAN,
            TERMINAL_PERMISSION_MODE_ASK,
            TERMINAL_PERMISSION_MODE_ACCEPT_EDITS,
            TERMINAL_PERMISSION_MODE_BYPASS,
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
        _ => Vec::new(),
    };
    let can_change_model_now = matches!(provider.as_str(), "codex" | "claude");
    let can_change_effort_now = matches!(provider.as_str(), "codex" | "claude");
    TerminalSessionCapabilities {
        provider,
        current_model: launch_metadata.model.clone(),
        current_model_source: launch_metadata.model_source.clone(),
        current_effort: launch_metadata.reasoning_effort.clone(),
        current_speed: launch_metadata.speed.clone(),
        permission_mode: launch_metadata.permission_mode.clone(),
        available_reasoning_efforts,
        available_permission_modes,
        can_prompt_answer: true,
        can_interrupt: true,
        can_raw_input: false,
        can_close: true,
        can_change_model_now,
        can_change_effort_now,
        can_change_permission_mode_now: false,
        prompt_answer_mechanism: "pty_keystroke".to_string(),
        interrupt_mechanism: "pty_escape".to_string(),
        raw_input_mechanism: "unsupported_cloud_lane".to_string(),
    }
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
    display_name: String,
    terminal_name: String,
    terminal_nickname: String,
    status: String,
    activity_status: String,
    command_phase: String,
    execution_phase: String,
    native_rail_state: String,
    native_rail_label: String,
    readiness: String,
    terminal_lifecycle: String,
    terminal_status: String,
    terminal_work_state: String,
    turn_status: String,
    session_state: String,
    input_ready: bool,
    input_ready_at: Option<String>,
    prompt_ready_at: Option<String>,
    completed_at: Option<String>,
    provider_session_id: Option<String>,
    native_session_id: Option<String>,
    fork_from_provider_session_id: Option<String>,
    provider_turn_id: Option<String>,
    turn_id: Option<String>,
    runtime_source: String,
    runtime_event_type: String,
    runtime_hook_event_name: String,
    runtime_updated_at_ms: u64,
    working_directory: String,
    session_mode: String,
    file_authority: String,
    capabilities: TerminalSessionCapabilities,
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

#[derive(Debug)]
struct TerminalCoordinationLaunchTarget {
    root: PathBuf,
    enforcement_mode: &'static str,
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

    // The mount scan walks the filesystem and may shell out to git; keep it off
    // the async runtime threads so a slow disk cannot stall unrelated commands.
    let mounts = {
        let scan_root = workspace_root.to_path_buf();
        tauri::async_runtime::spawn_blocking(move || workspace_project_mounts(&scan_root))
            .await
            .unwrap_or_default()
    };
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

fn workspace_git_path_same_or_child(path: &Path, parent: &Path) -> bool {
    normalized_path_key_is_same_or_child(&workspace_git_repo_key(path), &workspace_git_repo_key(parent))
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
            "--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%P%x1f%D%x1f%s",
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
            if fields.len() < 8 {
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
                "parents": fields[5].split_whitespace().collect::<Vec<_>>(),
                "refs": fields[6]
                    .split(", ")
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<_>>(),
                "subject": fields[7],
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
        if workspace_git_path_same_or_child(&top_level, workspace_root)
            || workspace_git_path_same_or_child(workspace_root, &top_level)
        {
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

fn workspace_git_pull_candidate_summary(
    root: &Path,
    workspace_root: &Path,
    fetch_remote: bool,
) -> Value {
    let branch = workspace_git_current_branch(root);
    let upstream = workspace_git_upstream(root);
    let files = workspace_git_status_files(root);
    let counts = workspace_git_status_counts(&files);
    let dirty = !files.is_empty();
    let operation_state = workspace_git_operation_state(root);
    let operation_clean = operation_state["clean"].as_bool().unwrap_or(false);
    let (fetch_ok, fetch_error, fetch_skipped) = if upstream.trim().is_empty() || !operation_clean {
        (false, String::new(), false)
    } else if !fetch_remote {
        (true, String::new(), true)
    } else {
        match workspace_git_fetch(root) {
            Ok(_) => (true, String::new(), false),
            Err(error) => (false, error, false),
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
        "fetchSkipped": fetch_skipped,
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
    fetch_remote: Option<bool>,
) -> Result<Value, String> {
    ensure_app_not_shutting_down("workspace Git pull check")?;
    let workspace_root = resolve_workspace_root_directory(Some(&repo_path))?;
    let force_refresh = refresh.unwrap_or(false);
    let topology = if force_refresh {
        terminal_workspace_topology_scan_for_launch(state.inner(), &workspace_root).await
    } else {
        terminal_workspace_topology_cached_scan(
            &state.workspace_topology_cache,
            &workspace_root,
            terminal_now_ms(),
        )
        .await
    };
    let cache = json!({
        "key": topology.cache_key,
        "status": topology.cache_status,
        "hit": topology.cache_hit,
        "scannedAtMs": topology.scanned_ms,
        "ageMs": terminal_now_ms().saturating_sub(topology.scanned_ms),
    });
    let repos = workspace_git_discovered_repositories(&workspace_root, &topology.mounts);
    let workspace_root_for_worker = workspace_root.clone();
    let fetch_remote = fetch_remote.unwrap_or(false);
    let repositories = tauri::async_runtime::spawn_blocking(move || {
        repos
            .into_iter()
            .map(|repo| {
                workspace_git_pull_candidate_summary(&repo, &workspace_root_for_worker, fetch_remote)
            })
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

#[cfg(test)]
fn terminal_coordination_launch_target(
    workspace_root: &Path,
    _requested_project_root: Option<&str>,
    _requested_mount_id: Option<&str>,
    _selected_workspace_was_empty_at_selection: bool,
    session_mode: TerminalSessionMode,
) -> Result<TerminalCoordinationLaunchTarget, String> {
    terminal_coordination_launch_target_with_mounts(
        workspace_root,
        None,
        _requested_project_root,
        _requested_mount_id,
        _selected_workspace_was_empty_at_selection,
        session_mode,
    )
}

fn terminal_coordination_launch_target_with_mounts(
    workspace_root: &Path,
    _topology_mounts: Option<&[WorkspaceProjectMount]>,
    _requested_project_root: Option<&str>,
    _requested_mount_id: Option<&str>,
    _selected_workspace_was_empty_at_selection: bool,
    session_mode: TerminalSessionMode,
) -> Result<TerminalCoordinationLaunchTarget, String> {
    let target_root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let has_git = workspace_is_exact_git_root(&target_root);
    let agent_session_mode = terminal_agent_session_mode_for_root(&target_root);
    let git_worktrees_enabled = has_git
        && agent_session_mode
            == crate::coordination::kernel::AGENT_SESSION_MODE_WORKTREE_COORDINATION;
    let direct_unmanaged_workspace =
        agent_session_mode == crate::coordination::kernel::AGENT_SESSION_MODE_DIRECT_UNMANAGED;
    let enforcement_mode = match session_mode {
        TerminalSessionMode::ManagedPatch if git_worktrees_enabled => "worktree_required",
        TerminalSessionMode::ManagedPatch if direct_unmanaged_workspace => "direct_unmanaged",
        TerminalSessionMode::ManagedPatch if has_git => "bounded_direct_edit",
        TerminalSessionMode::ManagedPatch => {
            return Err(
                "Managed patch mode requires the selected workspace root to be an existing Git repo."
                    .to_string(),
            );
        }
        TerminalSessionMode::General if git_worktrees_enabled => "worktree_required",
        TerminalSessionMode::General if direct_unmanaged_workspace => "direct_unmanaged",
        TerminalSessionMode::General => "bounded_direct_edit",
        TerminalSessionMode::DirectEdit if direct_unmanaged_workspace => "direct_unmanaged",
        TerminalSessionMode::DirectEdit => "bounded_direct_edit",
        TerminalSessionMode::Activity => "activity_only",
        TerminalSessionMode::RemoteOps => "remote_unmanaged",
        TerminalSessionMode::Free => "external_unmanaged",
    };

    Ok(TerminalCoordinationLaunchTarget {
        root: target_root,
        enforcement_mode,
    })
}

fn terminal_agent_session_mode_for_root(root: &Path) -> &'static str {
    let Ok((kernel, _)) =
        crate::coordination::CoordinationKernel::open_for_terminal_launch(root, None)
    else {
        return crate::coordination::kernel::AGENT_SESSION_MODE_DIRECT_COORDINATION;
    };
    kernel
        .repo_policy()
        .ok()
        .map(|policy| crate::coordination::kernel::repo_policy_agent_session_mode(&policy))
        .unwrap_or(crate::coordination::kernel::AGENT_SESSION_MODE_DIRECT_COORDINATION)
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
    rust_readiness_observer_enabled: bool,
    mut reader: Box<dyn Read + Send>,
) {
    fn terminal_headless_tail_has_prompt_marker(
        headless_output: &Arc<StdMutex<TerminalHeadlessOutputBuffer>>,
    ) -> bool {
        let Ok(output) = headless_output.lock() else {
            return false;
        };
        let tail = output.tail.iter().copied().collect::<Vec<_>>();
        if tail.is_empty() {
            return false;
        }
        let start = tail.len().saturating_sub(TERMINAL_STARTUP_READY_SCAN_BYTES);
        let text = String::from_utf8_lossy(&tail[start..]);
        let mut recent_lines = text.lines().rev().take(8).collect::<Vec<_>>();
        recent_lines.reverse();
        let recent_text = recent_lines.join("\n");
        terminal_output_current_prompt_marker(&recent_text)
    }

    async fn observe_terminal_prompt_ready(
        app: AppHandle,
        terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
        cloud_mcp_state: CloudMcpState,
        headless_output: Arc<StdMutex<TerminalHeadlessOutputBuffer>>,
        pane_id: String,
        instance_id: u64,
    ) {
        if !terminal_headless_tail_has_prompt_marker(&headless_output) {
            return;
        }
        let mut instance =
            match terminal_activity_hook_current_instance(&terminals, &pane_id, instance_id).await {
                Some(instance) => instance,
                None => return,
            };
        if !cloud_mcp_agent_uses_activity_hooks(&instance.metadata.agent_id)
            && !cloud_mcp_agent_uses_activity_hooks(&instance.metadata.agent_kind)
        {
            return;
        }
        let mut runtime = terminal_runtime_snapshot(&instance);
        if runtime.input_ready {
            return;
        }
        let startup_ready = terminal_runtime_snapshot_is_starting(&runtime);
        if !terminal_prompt_ready_recovery_allowed(&instance.metadata, &runtime) {
            return;
        }
        if !startup_ready {
            let busy_age_ms = terminal_now_ms().saturating_sub(runtime.updated_at_ms);
            if busy_age_ms < TERMINAL_PROMPT_READY_BUSY_DEBOUNCE_MS {
                sleep(Duration::from_millis(
                    TERMINAL_PROMPT_READY_BUSY_DEBOUNCE_MS.saturating_sub(busy_age_ms),
                ))
                .await;
                instance =
                    match terminal_activity_hook_current_instance(&terminals, &pane_id, instance_id)
                        .await
                    {
                        Some(instance) => instance,
                        None => return,
                    };
                runtime = terminal_runtime_snapshot(&instance);
                if runtime.input_ready
                    || !terminal_prompt_ready_recovery_allowed(&instance.metadata, &runtime)
                {
                    return;
                }
                if !terminal_headless_tail_has_prompt_marker(&headless_output) {
                    return;
                }
            }
        }

        let recovery_source = if terminal_runtime_snapshot_is_starting(&runtime) {
            "backend-startup-prompt-ready"
        } else {
            "backend-output-prompt-ready"
        };
        let mut event = json!({
            "hookEventName": "Stop",
            "provider": instance.metadata.agent_kind.clone(),
            "source": recovery_source,
            "timestamp": crate::coordination::kernel::now_rfc3339(),
        });
        if let Some(object) = event.as_object_mut() {
            if let Some(provider_session_id) = runtime
                .provider_session_id
                .as_deref()
                .or(runtime.native_session_id.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                object.insert("sessionId".to_string(), json!(provider_session_id));
                object.insert("providerSessionId".to_string(), json!(provider_session_id));
                object.insert("nativeSessionId".to_string(), json!(provider_session_id));
            }
            if let Some(turn_id) = runtime
                .turn_id
                .as_deref()
                .or(runtime.provider_turn_id.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                object.insert("turnId".to_string(), json!(turn_id));
            }
        }

        process_terminal_activity_hook_event(
            &app,
            &terminals,
            &cloud_mcp_state,
            &pane_id,
            instance_id,
            &instance,
            &event,
            recovery_source,
        )
        .await;
    }

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
    let prompt_ready_observer_in_flight = Arc::new(AtomicBool::new(false));

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
            let mut cloud_output_seq: u64 = 0;
            let mut cloud_output_total_bytes: u64 = 0;
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
                let cloud_from_total_bytes = cloud_output_total_bytes;
                cloud_output_total_bytes =
                    cloud_output_total_bytes.saturating_add(frame_bytes as u64);
                cloud_output_seq = cloud_output_seq.saturating_add(1);
                cloud_mcp_publish_terminal_output_delta(
                    &output_cloud_mcp_state,
                    &output_pane_id,
                    instance_id,
                    cloud_output_seq,
                    cloud_from_total_bytes,
                    cloud_output_total_bytes,
                    &frame,
                );

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
        let mut auth_failure_scan_tail = String::new();
        let mut auth_failure_marked = false;
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
                    if rust_readiness_observer_enabled
                        && terminal_headless_tail_has_prompt_marker(&headless_output)
                        && prompt_ready_observer_in_flight
                            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                            .is_ok()
                    {
                        let readiness_app = app.clone();
                        let readiness_terminals = Arc::clone(&terminals);
                        let readiness_cloud_state = cloud_mcp_state.clone();
                        let readiness_headless_output = Arc::clone(&headless_output);
                        let readiness_pane_id = reader_pane_id.clone();
                        let readiness_observer_in_flight =
                            Arc::clone(&prompt_ready_observer_in_flight);
                        tauri::async_runtime::spawn(async move {
                            observe_terminal_prompt_ready(
                                readiness_app,
                                readiness_terminals,
                                readiness_cloud_state,
                                readiness_headless_output,
                                readiness_pane_id,
                                instance_id,
                            )
                            .await;
                            readiness_observer_in_flight.store(false, Ordering::Release);
                        });
                    }
                    if !auth_failure_marked
                        && agent_accounts_observe_terminal_auth_output(
                            &app,
                            &reader_pane_id,
                            &mut auth_failure_scan_tail,
                            chunk,
                        )
                    {
                        auth_failure_marked = true;
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
                terminal_record_workspace_agent_session_history(
                    Some(cleanup_app.clone()),
                    &instance,
                    None,
                    None,
                    "detached",
                    "reader_exit:terminal_detached",
                    None,
                );
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
    app: Option<AppHandle>,
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
        terminal_record_workspace_agent_session_history(
            app.clone(),
            &instance,
            None,
            None,
            "detached",
            "terminal_close:terminal_detached",
            None,
        );
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

    let close_reason = if scoped_close {
        "workspace_close_all"
    } else {
        "close_all"
    };

    for (_, instance) in &instances {
        terminal_record_workspace_agent_session_history(
            Some(app.clone()),
            instance,
            None,
            None,
            "detached",
            format!("{close_reason}:terminal_detached"),
            None,
        );
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
                close_reason,
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

// Long agent launch commands (Codex/Claude with many `-c`/MCP overrides) can
// exceed the PTY line-discipline canonical limit (~1 KB on macOS, ~4 KB on
// Linux; POSIX `MAX_CANON`). When such a command is injected into a prewarmed
// login shell before its line editor switches the tty into raw mode, the kernel
// truncates the line mid-token and the shell drops to a `quote>` continuation
// prompt, so the agent never starts. The documented workaround for long
// terminal input is to read it from a file: stage the full launch sequence in a
// 0600 temp script and inject only a short `. <script>` line, which is immune to
// both the canonical-length limit and the shell-startup timing race.
#[cfg(not(windows))]
fn stage_agent_launch_input_as_source_command(input: &str) -> Option<String> {
    use std::io::Write as _;
    use std::os::unix::fs::OpenOptionsExt as _;

    if input.trim().is_empty() {
        return None;
    }

    static LAUNCH_SCRIPT_COUNTER: std::sync::atomic::AtomicU64 =
        std::sync::atomic::AtomicU64::new(0);
    let counter = LAUNCH_SCRIPT_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!(
        "difflaunch-{}-{}-{}.sh",
        std::process::id(),
        nanos,
        counter
    ));

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .ok()?;

    let quoted_path = quote_shell_literal(&path.to_string_lossy());
    // Self-delete first: on Unix the shell keeps its already-open source fd valid
    // after the path is unlinked, so the script still runs to completion and the
    // file never lingers on disk (even if the agent runs for hours).
    let script = format!("command rm -f -- {quoted_path}\n{input}");
    file.write_all(script.as_bytes()).ok()?;
    file.flush().ok()?;
    drop(file);

    Some(format!(". {quoted_path}\n"))
}

#[cfg(windows)]
fn stage_agent_launch_input_as_source_command(_input: &str) -> Option<String> {
    None
}

fn write_agent_start_input_to_writer(
    writer: &mut dyn Write,
    input: &str,
    context: &str,
) -> Result<(), String> {
    let staged_source_command = stage_agent_launch_input_as_source_command(input);
    let payload = staged_source_command.as_deref().unwrap_or(input);
    let delivery = if staged_source_command.is_some() {
        "source_script"
    } else {
        "inline"
    };
    log_terminal_crash_forensics_event(
        "backend.agent_start_input.write.begin",
        json!({
            "bytes": input.len(),
            "payloadBytes": payload.len(),
            "delivery": delivery,
            "context": clean_terminal_diagnostic_log_text(context),
            "input_kind": terminal_input_forensics_kind(input),
        }),
    );
    if let Err(error) = writer.write_all(payload.as_bytes()) {
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
    app_control_mcp_state: State<'_, AppControlMcpState>,
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
    let requested_agent_id = terminal_normalize_agent_kind(request.agent_id.as_deref())
        .or_else(|| terminal_normalize_agent_kind(request.agent_kind.as_deref()));
    let provider = request.provider;
    let provider_for_coordination = provider.clone();
    let provider_session_id = request.provider_session_id;
    let requested_provider_session_id =
        terminal_clean_provider_session_id(provider_session_id.as_deref());
    let fork_from_provider_session_id = request.fork_from_provider_session_id;
    let requested_fork_provider_session_id =
        terminal_clean_provider_session_id(fork_from_provider_session_id.as_deref());
    let launch_options = TerminalProviderLaunchOptions {
        model: request.model,
        reasoning_effort: request.reasoning_effort,
        speed: request.speed,
        permission_mode: request.permission_mode,
    };
    let plain_shell =
        terminal_request_is_plain_shell(&kind, provider.as_deref(), request.plain_shell);
    if plain_shell && requested_fork_provider_session_id.is_some() {
        return Err("Shell terminals do not have provider sessions to fork.".to_string());
    }
    let fresh_session = request.fresh_session.unwrap_or(false) && !plain_shell;
    let working_directory_request = request.working_directory;
    let workspace_root_was_empty_at_selection = request
        .workspace_root_was_empty_at_selection
        .unwrap_or(false);
    let _legacy_project_root = request.project_root;
    let _legacy_mount_id = request.mount_id;
    let requested_session_mode = request.session_mode;
    let workspace_id = request.workspace_id;
    let workspace_name = request.workspace_name;
    let terminal_name = request.terminal_name.unwrap_or_default();
    let terminal_nickname = request.terminal_nickname.unwrap_or_default();
    let terminal_index = request.terminal_index;
    let thread_id = request.thread_id;
    let requested_slot_key = request.slot_key;
    let app_control_mcp_requested = request.app_control_mcp.unwrap_or(false);
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
            "app_control_mcp_requested": app_control_mcp_requested,
            "provider_session_id_present": requested_provider_session_id.is_some(),
            "fork_from_provider_session_id_present": requested_fork_provider_session_id.is_some(),
        }),
    );

    let preserve_coordination_session = request.preserve_coordination_session.unwrap_or(false)
        && !fresh_session
        && session_mode.should_prepare_coordination();
    close_terminal_session(
        Some(app.clone()),
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
    let working_directory_text = working_directory.to_string_lossy().to_string();
    let mut terminal_project_root = working_directory.clone();
    let mut process_working_directory = workspace_path_for_process(&working_directory);
    let mut launch_worktree: Option<Value> = None;
    let mut coordination_context: Option<crate::coordination::models::TerminalCoordinationContext> =
        None;

    let (
        command_candidates,
        args,
        label,
        codex_resume_home,
        resolved_launch,
        effective_provider_session_id,
    ) = if is_prewarm_pty || plain_shell {
        (
            Vec::new(),
            Vec::new(),
            "Prepared PTY".to_string(),
            None,
            TerminalProviderResolvedLaunchOptions::default(),
            if requested_fork_provider_session_id.is_some() {
                None
            } else {
                requested_provider_session_id.clone()
            },
        )
    } else {
        terminal_launch(
            &kind,
            provider,
            launch_options,
            requested_provider_session_id.clone(),
            requested_fork_provider_session_id.clone(),
            &working_directory_text,
        )?
    };
    let instance_id = request.instance_id.filter(|id| *id > 0).unwrap_or_else(|| {
        state
            .next_terminal_instance_id
            .fetch_add(1, Ordering::Relaxed)
    });
    clear_terminal_activity_hook_files(&pane_id, instance_id);
    let activity_transport = match terminal_activity_transport_for_terminal(
        app.clone(),
        state.inner(),
        &pane_id,
        instance_id,
    )
    .await
    {
        Ok(endpoint) => Some(endpoint),
        Err(error) => {
            log_terminal_status_event(
                "backend.terminal_activity_transport.start_error",
                json!({
                    "error": clean_terminal_diagnostic_log_text(&error),
                    "instance_id": instance_id,
                    "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                }),
            );
            None
        }
    };
    let activity_hook_poll_ms = if activity_transport.is_some() {
        TERMINAL_ACTIVITY_HOOK_FALLBACK_POLL_MS
    } else {
        TERMINAL_ACTIVITY_HOOK_POLL_MS
    };
    ensure_app_not_shutting_down("terminal open")?;
    let terminal_launch_epoch = format!("{pane_id}:{instance_id}");
    if (!is_prewarm_pty || !plain_shell) && session_mode.should_prepare_coordination() {
        let coordination_target = terminal_coordination_launch_target_with_mounts(
            &working_directory,
            None,
            None,
            None,
            workspace_root_was_empty_at_selection,
            session_mode,
        )?;
        let coordination_working_directory = coordination_target.root;
        terminal_project_root = coordination_working_directory.clone();

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
    let provider_session_discovery_started_at_ms = terminal_now_ms();

    let shell_pty = is_prewarm_pty || plain_shell;
    let warm_pty = if shell_pty {
        ensure_app_not_shutting_down("terminal open")?;
        let mut coordination_env_vars = terminal_coordination
            .as_ref()
            .map(|coordination| coordination.env_vars.clone())
            .unwrap_or_default();
        if let Some(home) = codex_resume_home.as_deref() {
            apply_codex_resume_home_env(&mut coordination_env_vars, home);
        }
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
            activity_transport.as_ref(),
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
        let mut launch_args = terminal_args_with_codex_mcp_identity(
            launch_provider_id,
            &args,
            terminal_coordination.as_ref(),
            resolved_launch.permission_mode.as_deref(),
            &pane_id,
            instance_id,
            activity_transport.as_ref(),
        );
        let app_control_mcp_launch = if app_control_mcp_requested {
            let endpoint =
                app_control_mcp_endpoint_for_state(app.clone(), app_control_mcp_state.inner())
                    .await?;
            let app_control_command = app_control_mcp_command();
            let app_control_args = app_control_mcp_args_for_endpoint(&endpoint);
            launch_args = terminal_args_with_app_control_mcp_identity(
                launch_provider_id,
                &launch_args,
                &app_control_command,
                &app_control_args,
            )?;
            Some((app_control_command, app_control_args))
        } else {
            None
        };
        validate_terminal_agent_launch_args_for_platform(launch_provider_id, &launch_args)?;
        let mut coordination_env_vars = terminal_coordination
            .as_ref()
            .map(|coordination| coordination.env_vars.clone())
            .unwrap_or_default();
        if let Some(home) = codex_resume_home.as_deref() {
            apply_codex_resume_home_env(&mut coordination_env_vars, home);
        }
        extend_terminal_activity_env_vars(
            &mut coordination_env_vars,
            &pane_id,
            instance_id,
            workspace_id.as_deref(),
            terminal_index,
            launch_provider_id,
            activity_transport.as_ref(),
        );
        coordination_env_vars.extend(cloud_mcp_runtime_env_vars(cloud_mcp_state.inner()).await?);
        let mut launch_env_vars =
            terminal_env_vars_with_opencode_tui_config(launch_provider_id, &coordination_env_vars)?;
        if let Some((app_control_command, app_control_args)) = app_control_mcp_launch.as_ref() {
            launch_env_vars = terminal_env_vars_with_app_control_mcp_identity(
                launch_provider_id,
                &launch_env_vars,
                app_control_command,
                app_control_args,
            )?;
        }
        launch_env_vars = terminal_env_vars_with_opencode_coordination_config(
            launch_provider_id,
            &launch_env_vars,
            terminal_coordination.as_ref(),
            resolved_launch.permission_mode.as_deref(),
        )?;

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

    let semantic_agent_kind = requested_agent_id
        .clone()
        .or_else(|| terminal_normalize_agent_kind(provider_for_coordination.as_deref()))
        .unwrap_or_else(|| {
            if plain_shell {
                "generic".to_string()
            } else if kind == "console" {
                "codex".to_string()
            } else {
                kind.clone()
            }
        });
    let terminal_metadata = TerminalInstanceMetadata {
        pane_id: pane_id.clone(),
        workspace_id: workspace_id.clone().unwrap_or_default(),
        workspace_name: workspace_name.clone().unwrap_or_default(),
        terminal_index,
        thread_id: thread_id.clone().unwrap_or_default(),
        agent_id: semantic_agent_kind.clone(),
        agent_kind: semantic_agent_kind,
        terminal_name,
        terminal_nickname,
    };
    let terminal_metadata_for_log = terminal_metadata.clone();
    let launch_metadata = terminal_launch_runtime_metadata_from_resolved(&resolved_launch);

    let (instance, reader) = TerminalInstance::from_warm_shell(
        instance_id,
        warm_pty,
        process_working_directory.clone(),
        agent_started,
        terminal_coordination.clone(),
        effective_session_mode,
        terminal_metadata,
        launch_metadata,
        app_control_mcp_requested,
    );
    let runtime_snapshot = terminal_runtime_apply_opened(
        &instance,
        effective_provider_session_id.as_deref(),
        requested_fork_provider_session_id.as_deref(),
        "terminal-open",
    );
    terminal_record_workspace_agent_session_history(
        Some(app.clone()),
        &instance,
        resolved_launch.model.as_deref(),
        resolved_launch.model_source.as_deref(),
        &runtime_snapshot.activity_status,
        "terminal_open",
        Some(terminal_slot_key.as_str()),
    );
    if let (Some(coordination), Some(provider_session_id)) = (
        terminal_coordination.clone(),
        effective_provider_session_id.clone(),
    ) {
        terminal_record_coordination_provider_session_id(
            coordination,
            provider_session_id.clone(),
            "terminal_open",
        );
        terminal_record_workspace_provider_session_binding(
            Some(app.clone()),
            &instance,
            provider_session_id,
            "terminal_open",
        );
    }
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
    let runtime_shared_history_id = Some(workspace_agent_session_history_shared_history_id(
        &terminal_metadata_for_log.workspace_id,
        &terminal_metadata_for_log.agent_kind,
        runtime_snapshot
            .provider_session_id
            .as_deref()
            .or(runtime_snapshot.native_session_id.as_deref())
            .unwrap_or_default(),
        runtime_snapshot
            .fork_from_provider_session_id
            .as_deref()
            .unwrap_or_default(),
    ))
    .filter(|value| !value.trim().is_empty());
    cloud_mcp_mark_terminal_opened(
        cloud_mcp_state.inner(),
        &pane_id,
        instance_id,
        &process_working_directory,
        terminal_coordination.as_ref(),
        effective_session_mode,
        &terminal_metadata_for_log,
        runtime_snapshot.provider_session_id.as_deref(),
        runtime_snapshot.fork_from_provider_session_id.as_deref(),
        runtime_shared_history_id.as_deref(),
        "terminal_open",
    )
    .await;
    if let Some(displaced_instance) = displaced_instance {
        cleanup_terminal_instance_async(
            displaced_instance,
            true,
            "terminal_open_displaced",
            preserve_coordination_session,
            Some(Arc::clone(&state.cleanup_tracker)),
        );
    }

    let cloud_output_observer_enabled =
        !cloud_mcp_agent_uses_activity_hooks(&terminal_metadata_for_log.agent_id)
            && !cloud_mcp_agent_uses_activity_hooks(&terminal_metadata_for_log.agent_kind);
    let rust_readiness_observer_enabled =
        cloud_mcp_agent_uses_activity_hooks(&terminal_metadata_for_log.agent_id)
            || cloud_mcp_agent_uses_activity_hooks(&terminal_metadata_for_log.agent_kind);
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
        rust_readiness_observer_enabled,
        reader,
    );
    spawn_terminal_activity_hook_watcher(
        app.clone(),
        Arc::clone(&state.terminals),
        cloud_mcp_state.inner().clone(),
        pane_id.clone(),
        instance_id,
        activity_hook_poll_ms,
    );
    spawn_terminal_codex_session_discovery(
        app.clone(),
        Arc::clone(&state.terminals),
        pane_id.clone(),
        instance_id,
        provider_session_discovery_started_at_ms,
        "terminal_open",
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
            "provider_session_id_present": runtime_snapshot.provider_session_id.is_some(),
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
            "provider_session_id_present": runtime_snapshot.provider_session_id.is_some(),
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
            "provider_session_id_present": runtime_snapshot.provider_session_id.is_some(),
        }),
    );

    let projected_runtime = terminal_project_runtime(&terminal_metadata_for_log, &runtime_snapshot, false);
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
        provider_session_id: runtime_snapshot.provider_session_id.clone(),
        native_session_id: runtime_snapshot.native_session_id.clone(),
        fork_from_provider_session_id: runtime_snapshot.fork_from_provider_session_id.clone(),
        shared_history_id: runtime_shared_history_id,
        requested_provider_session_id,
        model: resolved_launch.model,
        model_source: resolved_launch.model_source,
        reasoning_effort: resolved_launch.reasoning_effort,
        speed: resolved_launch.speed,
        permission_mode: resolved_launch.permission_mode,
        activity_status: runtime_snapshot.activity_status,
        command_phase: runtime_snapshot.command_phase,
        input_ready: runtime_snapshot.input_ready,
        input_ready_at: runtime_snapshot.input_ready_at,
        terminal_work_state: projected_runtime.terminal_work_state,
    })
}

#[tauri::command]
async fn terminal_record_provider_session(
    app: AppHandle,
    state: State<'_, TerminalState>,
    request: TerminalProviderSessionRecordRequest,
) -> Result<TerminalProviderSessionRecordResult, String> {
    validate_terminal_pane_id(&request.pane_id)?;
    let provider_session_id =
        terminal_clean_provider_session_id(Some(&request.provider_session_id))
            .ok_or_else(|| "Provider session id is required.".to_string())?;
    let source = request
        .source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("provider-session-record")
        .to_string();

    let Some(instance) = ({
        let terminals = state.terminals.read().await;
        terminals.get(&request.pane_id).cloned()
    }) else {
        return Err("Terminal session is not running.".to_string());
    };
    if request
        .instance_id
        .is_some_and(|expected_id| expected_id != instance.id)
    {
        return Err("Terminal session was replaced before provider session record.".to_string());
    }
    if !terminal_provider_session_id_is_recordable_for_agent(
        &instance.metadata.agent_id,
        &instance.metadata.agent_kind,
        &provider_session_id,
    ) {
        log_terminal_status_event(
            "backend.terminal_provider_session.record_skip",
            json!({
                "agent_kind": instance.metadata.agent_kind.clone(),
                "instance_id": instance.id,
                "pane_id": clean_terminal_diagnostic_log_text(&request.pane_id),
                "reason": "invalid-provider-session-id",
                "source": source.clone(),
            }),
        );
        return Ok(TerminalProviderSessionRecordResult {
            pane_id: request.pane_id,
            instance_id: instance.id,
            provider_session_id,
            recorded: false,
            source,
        });
    }

    terminal_runtime_apply_provider_session_id(&instance, &provider_session_id, &source);
    terminal_record_workspace_provider_session_binding(
        Some(app),
        &instance,
        provider_session_id.clone(),
        source.clone(),
    );
    if let Some(coordination) = instance.coordination.clone() {
        terminal_record_coordination_provider_session_id(
            coordination,
            provider_session_id.clone(),
            source.clone(),
        );
    }
    log_terminal_status_event(
        "backend.terminal_provider_session.recorded",
        json!({
            "instance_id": instance.id,
            "pane_id": clean_terminal_diagnostic_log_text(&request.pane_id),
            "provider_session_id_present": true,
            "source": source.clone(),
        }),
    );

    Ok(TerminalProviderSessionRecordResult {
        pane_id: request.pane_id,
        instance_id: instance.id,
        provider_session_id,
        recorded: true,
        source,
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
        targets.push(TerminalCrashRecoveryTarget {
            label: workspace_path_display(&working_directory),
            repo_path: working_directory,
            db_path: None,
            source: "requested_root".to_string(),
        });
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
        let db_key = target
            .db_path
            .as_ref()
            .map(|path| workspace_path_display(path));
        match crate::coordination::CoordinationKernel::init(
            &target.repo_path,
            target.db_path.clone(),
        )
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
                            object
                                .insert("recoverySource".to_string(), json!(target.source.clone()));
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
                            object
                                .insert("recoverySource".to_string(), json!(target.source.clone()));
                        }
                        crashed_terminals.push(terminal.clone());
                    }
                }

                if let Some(object) = report.as_object_mut() {
                    object.insert("repoPath".to_string(), json!(repo_key));
                    if let Some(db_key) = db_key {
                        object.insert("dbPath".to_string(), json!(db_key));
                    }
                    object.insert("recoverySource".to_string(), json!(target.source.clone()));
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

// Resolves the app-control orchestrator MCP launch (command + args) for a pane
// that was opened with it requested. Returns None when not requested. Used by
// the deferred/resume agent-start paths so app-control survives a relaunch the
// same way `terminal_open` wires it on first launch.
async fn resolve_app_control_mcp_launch(
    app: &AppHandle,
    requested: bool,
) -> Result<Option<(String, Vec<String>)>, String> {
    if !requested {
        return Ok(None);
    }
    let app_control_state = app.state::<AppControlMcpState>();
    let endpoint =
        app_control_mcp_endpoint_for_state(app.clone(), app_control_state.inner()).await?;
    Ok(Some((
        app_control_mcp_command(),
        app_control_mcp_args_for_endpoint(&endpoint),
    )))
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
    ensure_app_not_shutting_down("terminal agent start")?;
    let lifecycle_lock = Arc::clone(&state.lifecycle_lock);
    let _lifecycle_guard = lifecycle_lock.lock().await;
    ensure_app_not_shutting_down("terminal agent start")?;
    let provider = parse_agent_provider(&provider)?;
    let definition = agent_definition(provider);
    let mut args = Vec::new();
    let launch = TerminalProviderResolvedLaunchOptions {
        model: normalize_forge_model(model)?,
        ..Default::default()
    };
    terminal_append_provider_launch_args(provider, &mut args, &launch);

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
    let activity_transport = match terminal_activity_transport_for_terminal(
        app.clone(),
        state.inner(),
        &pane_id,
        instance.id,
    )
    .await
    {
        Ok(endpoint) => Some(endpoint),
        Err(error) => {
            log_terminal_status_event(
                "backend.terminal_activity_transport.start_error",
                json!({
                    "error": clean_terminal_diagnostic_log_text(&error),
                    "instance_id": instance.id,
                    "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                }),
            );
            None
        }
    };
    refresh_codex_activity_hook_profile_for_launch(
        instance.coordination.as_ref(),
        definition.id,
        &pane_id,
        instance.id,
        Some(instance.metadata.workspace_id.as_str()),
        instance.metadata.terminal_index,
    );
    let mut launch_args = terminal_args_with_codex_mcp_identity(
        definition.id,
        &args,
        instance.coordination.as_ref(),
        launch.permission_mode.as_deref(),
        &pane_id,
        instance.id,
        activity_transport.as_ref(),
    );
    let app_control_mcp_launch =
        resolve_app_control_mcp_launch(&app, instance.app_control_mcp_requested).await?;
    if let Some((app_control_command, app_control_args)) = app_control_mcp_launch.as_ref() {
        launch_args = terminal_args_with_app_control_mcp_identity(
            definition.id,
            &launch_args,
            app_control_command,
            app_control_args,
        )?;
    }
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
        activity_transport.as_ref(),
    );
    coordination_env_vars.extend(cloud_mcp_runtime_env_vars(cloud_mcp_state.inner()).await?);
    let mut launch_env_vars =
        terminal_env_vars_with_opencode_tui_config(definition.id, &coordination_env_vars)?;
    if let Some((app_control_command, app_control_args)) = app_control_mcp_launch.as_ref() {
        launch_env_vars = terminal_env_vars_with_app_control_mcp_identity(
            definition.id,
            &launch_env_vars,
            app_control_command,
            app_control_args,
        )?;
    }
    let launch_env_vars = terminal_env_vars_with_opencode_coordination_config(
        definition.id,
        &launch_env_vars,
        instance.coordination.as_ref(),
        launch.permission_mode.as_deref(),
    )?;
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
    app: AppHandle,
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
            model: None,
            model_source: None,
            started: false,
            skipped: true,
            message: app_shutdown_blocked_message("terminal agent batch start"),
        };
    }

    if let Err(error) = validate_terminal_pane_id(&pane_id) {
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id,
            model: None,
            model_source: None,
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
                model: None,
                model_source: None,
                started: false,
                skipped: true,
                message: error,
            };
        }
    };
    let definition = agent_definition(provider);
    let requested_resume_session_id = request
        .provider_session_id
        .as_deref()
        .and_then(|session_id| terminal_clean_provider_session_id(Some(session_id)));
    let requested_fork_session_id = request
        .fork_from_provider_session_id
        .as_deref()
        .and_then(|session_id| terminal_clean_provider_session_id(Some(session_id)));
    let is_fork_launch = requested_fork_session_id.is_some();
    let fork_source_for_runtime = requested_fork_session_id.clone();

    let Some(instance) = ({
        let terminals = terminals.read().await;
        terminals.get(&pane_id).cloned()
    }) else {
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id,
            model: None,
            model_source: None,
            started: false,
            skipped: true,
            message: "Terminal session is not running.".to_string(),
        };
    };
    let working_directory_text = terminal_provider_session_binding_root(&instance);
    let (source_session_id, codex_resume_home) = if is_fork_launch {
        let (session_id, codex_resume_home) = terminal_resolve_provider_resume_session(
            provider,
            requested_fork_session_id,
            &working_directory_text,
        );
        let Some(session_id) = session_id else {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id: Some(instance.id),
                model: None,
                model_source: None,
                started: false,
                skipped: true,
                message: terminal_provider_session_fork_error(provider),
            };
        };
        (Some(session_id), codex_resume_home)
    } else {
        terminal_resolve_provider_resume_session(
            provider,
            requested_resume_session_id,
            &working_directory_text,
        )
    };
    let mut args = if is_fork_launch {
        terminal_provider_fork_args(provider, source_session_id.as_deref())
    } else {
        terminal_provider_resume_args(provider, source_session_id.as_deref())
    };

    // Resumed sessions continue on the exact model they last used; the
    // transcript outranks the caller's default (it sees `/model` switches).
    let session_model = source_session_id
        .as_deref()
        .and_then(|session_id| agent_session_last_model(provider, session_id))
        .and_then(|model| normalize_forge_model(Some(model)).ok().flatten());
    let request_model = match normalize_forge_model(request.model) {
        Ok(model) => model,
        Err(error) => {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id,
                model: None,
                model_source: None,
                started: false,
                skipped: true,
                message: error,
            };
        }
    };
    let mut resolved_launch = match session_model {
        Some(model) => TerminalProviderResolvedLaunchOptions {
            model: Some(model),
            model_source: Some("session-current".to_string()),
            ..Default::default()
        },
        None => {
            let source = if request_model.is_some() {
                Some("request".to_string())
            } else {
                None
            };
            TerminalProviderResolvedLaunchOptions {
                model: request_model,
                model_source: source,
                ..Default::default()
            }
        }
    };
    resolved_launch.reasoning_effort = match terminal_normalize_launch_reasoning_effort(
        provider,
        request.reasoning_effort,
    ) {
        Ok(effort) => effort,
        Err(error) => {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id,
                model: None,
                model_source: None,
                started: false,
                skipped: true,
                message: error,
            };
        }
    };
    resolved_launch.speed = match terminal_normalize_launch_speed(
        provider,
        resolved_launch.model.as_deref(),
        request.speed,
    ) {
        Ok(speed) => speed,
        Err(error) => {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id,
                model: None,
                model_source: None,
                started: false,
                skipped: true,
                message: error,
            };
        }
    };
    resolved_launch.permission_mode = match terminal_normalize_permission_mode(request.permission_mode) {
        Ok(permission_mode) => permission_mode,
        Err(error) => {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id,
                model: None,
                model_source: None,
                started: false,
                skipped: true,
                message: error,
            };
        }
    };
    terminal_append_provider_launch_args(provider, &mut args, &resolved_launch);

    if instance_id.is_some_and(|expected_id| expected_id != instance.id) {
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id,
            model: None,
            model_source: None,
            started: false,
            skipped: true,
            message: "Terminal session was replaced before agent start.".to_string(),
        };
    }

    if instance.coordination.is_none() && instance.session_mode.should_prepare_coordination() {
        return TerminalStartAgentPaneResult {
            pane_id,
            instance_id: Some(instance.id),
            model: None,
            model_source: None,
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
            model: None,
            model_source: None,
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
                model: None,
                model_source: None,
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
        let terminal_state = app.state::<TerminalState>();
        let activity_transport = match terminal_activity_transport_for_terminal(
            app.clone(),
            terminal_state.inner(),
            &pane_id,
            instance.id,
        )
        .await
        {
            Ok(endpoint) => Some(endpoint),
            Err(error) => {
                log_terminal_status_event(
                    "backend.terminal_activity_transport.start_error",
                    json!({
                        "error": clean_terminal_diagnostic_log_text(&error),
                        "instance_id": instance.id,
                        "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                    }),
                );
                None
            }
        };
        let mut launch_args = terminal_args_with_codex_mcp_identity(
            definition.id,
            &args,
            instance.coordination.as_ref(),
            resolved_launch.permission_mode.as_deref(),
            &pane_id,
            instance.id,
            activity_transport.as_ref(),
        );
        let app_control_mcp_launch =
            match resolve_app_control_mcp_launch(&app, instance.app_control_mcp_requested).await {
                Ok(value) => value,
                Err(error) => {
                    return TerminalStartAgentPaneResult {
                        pane_id,
                        instance_id: Some(instance.id),
                        model: None,
                        model_source: None,
                        started: false,
                        skipped: false,
                        message: error,
                    };
                }
            };
        if let Some((app_control_command, app_control_args)) = app_control_mcp_launch.as_ref() {
            match terminal_args_with_app_control_mcp_identity(
                definition.id,
                &launch_args,
                app_control_command,
                app_control_args,
            ) {
                Ok(next) => launch_args = next,
                Err(error) => {
                    return TerminalStartAgentPaneResult {
                        pane_id,
                        instance_id: Some(instance.id),
                        model: None,
                        model_source: None,
                        started: false,
                        skipped: false,
                        message: error,
                    };
                }
            }
        }
        if let Err(error) =
            validate_terminal_agent_launch_args_for_platform(definition.id, &launch_args)
        {
            return TerminalStartAgentPaneResult {
                pane_id,
                instance_id: Some(instance.id),
                model: None,
                model_source: None,
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
        if let Some(home) = codex_resume_home.as_deref() {
            apply_codex_resume_home_env(&mut coordination_env_vars, home);
        }
        extend_terminal_activity_env_vars(
            &mut coordination_env_vars,
            &pane_id,
            instance.id,
            Some(instance.metadata.workspace_id.as_str()),
            instance.metadata.terminal_index,
            definition.id,
            activity_transport.as_ref(),
        );
        let cloud_env_vars = match cloud_mcp_runtime_env_vars(&cloud_mcp_state).await {
            Ok(env_vars) => env_vars,
            Err(error) => {
                return TerminalStartAgentPaneResult {
                    pane_id,
                    instance_id: Some(instance.id),
                    model: None,
                    model_source: None,
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
                        model: None,
                        model_source: None,
                        started: false,
                        skipped: false,
                        message: error,
                    };
                }
            };
        let launch_env_vars = if let Some((app_control_command, app_control_args)) =
            app_control_mcp_launch.as_ref()
        {
            match terminal_env_vars_with_app_control_mcp_identity(
                definition.id,
                &launch_env_vars,
                app_control_command,
                app_control_args,
            ) {
                Ok(env_vars) => env_vars,
                Err(error) => {
                    return TerminalStartAgentPaneResult {
                        pane_id,
                        instance_id: Some(instance.id),
                        model: None,
                        model_source: None,
                        started: false,
                        skipped: false,
                        message: error,
                    };
                }
            }
        } else {
            launch_env_vars
        };
        let launch_env_vars = match terminal_env_vars_with_opencode_coordination_config(
            definition.id,
            &launch_env_vars,
            instance.coordination.as_ref(),
            resolved_launch.permission_mode.as_deref(),
        ) {
            Ok(env_vars) => env_vars,
            Err(error) => {
                return TerminalStartAgentPaneResult {
                    pane_id,
                    instance_id: Some(instance.id),
                    model: None,
                    model_source: None,
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
                model: None,
                model_source: None,
                started: false,
                skipped: false,
                message: "Terminal launch input is too large.".to_string(),
            };
        }

        drop(child_guard);
        let mut writer = instance.writer.lock().await;
        let provider_session_discovery_started_at_ms = terminal_now_ms();

        match write_agent_start_input_to_writer(writer.as_mut(), &input, "terminal agent launch") {
            Ok(()) => {
                *agent_started_guard = true;
                let effective_provider_session_id = if is_fork_launch {
                    None
                } else {
                    source_session_id.clone()
                };
                terminal_runtime_apply_opened(
                    &instance,
                    effective_provider_session_id.as_deref(),
                    fork_source_for_runtime.as_deref(),
                    "terminal-start-agent",
                );
                terminal_apply_launch_runtime_metadata(&instance, &resolved_launch);
                terminal_record_workspace_agent_session_history(
                    Some(app.clone()),
                    &instance,
                    resolved_launch.model.as_deref(),
                    resolved_launch.model_source.as_deref(),
                    "starting",
                    "terminal_start_agent",
                    None,
                );
                if let (Some(coordination), Some(provider_session_id)) =
                    (instance.coordination.clone(), effective_provider_session_id.clone())
                {
                    terminal_record_coordination_provider_session_id(
                        coordination,
                        provider_session_id.clone(),
                        "terminal_start_agent",
                    );
                    terminal_record_workspace_provider_session_binding(
                        Some(app.clone()),
                        &instance,
                        provider_session_id,
                        "terminal_start_agent",
                    );
                }
                spawn_terminal_codex_session_discovery(
                    app.clone(),
                    Arc::clone(&terminals),
                    pane_id.clone(),
                    instance.id,
                    provider_session_discovery_started_at_ms,
                    "terminal_start_agent",
                );
                return TerminalStartAgentPaneResult {
                    pane_id,
                    instance_id: Some(instance.id),
                    model: resolved_launch.model,
                    model_source: resolved_launch.model_source,
                    started: true,
                    skipped: false,
                    message: "Agent started.".to_string(),
                };
            }
            Err(error) => {
                return TerminalStartAgentPaneResult {
                    pane_id,
                    instance_id: Some(instance.id),
                    model: None,
                    model_source: None,
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
        model: None,
        model_source: None,
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
                model: None,
                model_source: None,
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
fn set_terminal_audio_route_gate(
    state: State<'_, TerminalState>,
    allow_terminal: bool,
) -> Result<(), String> {
    set_terminal_audio_route_gate_for(&state, allow_terminal)
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
    const SHIFT_ENTER_MARKER: char = '\u{e000}';
    let mut submitted = None;

    if data == TERMINAL_SHIFT_ENTER_SEQUENCE {
        terminal_input_gate_insert_char(gate, '\n');
        gate.current_line_user_touched = true;
        return None;
    }

    let normalized_data;
    let data =
        if data.contains(TERMINAL_SHIFT_ENTER_SEQUENCE)
            || data.contains(TERMINAL_ENTER_SEQUENCE)
            || data.contains(TERMINAL_ENTER_SEQUENCE_MOD1)
        {
            normalized_data = data
                .replace(TERMINAL_SHIFT_ENTER_SEQUENCE, &SHIFT_ENTER_MARKER.to_string())
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
            SHIFT_ENTER_MARKER => {
                terminal_input_gate_insert_char(gate, '\n');
                gate.current_line_user_touched = true;
            }
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
    // Codex relies on the enhanced-enter escape sequence at the PTY boundary.
    // The input-gate observer normalizes this sequence separately when it
    // decides whether a submitted prompt was really observed.
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
        "terminal_todo_plan_created"
            | "terminal_todo_plan_checkpoint"
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
        let plan_ref = refs.resource_id.clone();

        tauri::async_runtime::spawn(async move {
            sleep(Duration::from_millis(35)).await;
            let plan_repo_path = repo_path.clone();
            let plan_db_path = db_path.clone();
            let plan_task_id = task_id.clone();
            let plan_agent_id = agent_id.clone();
            let plan_session_id = session_id.clone();
            let plan_resource_id = plan_ref.clone();
            let plan_snapshot = tauri::async_runtime::spawn_blocking(move || {
                crate::coordination::CoordinationKernel::open(plan_repo_path, Some(plan_db_path))?
                    .terminal_todo_plan_event_snapshot(
                        plan_task_id.as_deref(),
                        plan_session_id.as_deref(),
                        plan_agent_id.as_deref(),
                        plan_resource_id.as_deref(),
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
                    "planId": plan_ref,
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
        let _ = kernel
            .record_session_provider_session_id(&coordination_session_id, &provider_session_id);
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

async fn terminal_preview_submitted_prompt(
    instance: &TerminalInstance,
    data: &str,
) -> Option<String> {
    let gate = instance.input_gate.lock().await;
    let mut preview = gate.clone();
    terminal_observe_input_gate_submitted_prompt(&mut preview, data)
}

fn terminal_prompt_is_app_fork_command(prompt: &str) -> bool {
    prompt.replace('\u{00a0}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .eq_ignore_ascii_case("fork")
}

fn emit_terminal_fork_requested(
    app: &AppHandle,
    instance: &TerminalInstance,
    provider_session_id: String,
) {
    let payload = TerminalForkRequestedPayload {
        pane_id: instance.metadata.pane_id.clone(),
        instance_id: instance.id,
        workspace_id: instance.metadata.workspace_id.clone(),
        terminal_index: instance.metadata.terminal_index,
        thread_id: instance.metadata.thread_id.clone(),
        agent_id: instance.metadata.agent_id.clone(),
        agent_kind: instance.metadata.agent_kind.clone(),
        provider_session_id,
    };
    let _ = app.emit(TERMINAL_FORK_REQUESTED_EVENT, payload);
}

async fn terminal_try_emit_app_fork_request(
    app: &AppHandle,
    instance: &TerminalInstance,
    pane_id: &str,
    thread_id: Option<&str>,
    data: &str,
    source: &str,
) -> bool {
    let Some(prompt) = terminal_preview_submitted_prompt(instance, data).await else {
        return false;
    };
    if !terminal_prompt_is_app_fork_command(&prompt) {
        return false;
    }

    let Some(provider_session_id) = terminal_current_recordable_provider_session_id(instance) else {
        return false;
    };

    let (_observed_prompt, input_gate_before, input_gate_after) =
        terminal_observe_submitted_prompt(instance, data).await;
    log_terminal_status_event(
        "backend.terminal_write.fork_command_intercepted",
        json!({
            "input_gate_after": input_gate_after,
            "input_gate_before": input_gate_before,
            "instance_id": instance.id,
            "pane_id": clean_terminal_diagnostic_log_text(pane_id),
            "provider_session_id_present": true,
            "source": source,
            "thread_id": thread_id.unwrap_or_default(),
        }),
    );
    emit_terminal_fork_requested(app, instance, provider_session_id);
    true
}

fn terminal_prompt_submitted_should_emit_synthetic_activity(
    metadata: &TerminalInstanceMetadata,
    prompt_source: &str,
) -> bool {
    if matches!(
        prompt_source,
        "activity_hook_user_prompt_submit" | "cli_hook_user_prompt_submit"
    ) {
        return false;
    }
    cloud_mcp_agent_uses_activity_hooks(&metadata.agent_id)
        || cloud_mcp_agent_uses_activity_hooks(&metadata.agent_kind)
}

fn terminal_prompt_fallback_event_id(
    pane_id: &str,
    instance_id: u64,
    observed_at_ms: u64,
    prompt: &str,
) -> String {
    use std::hash::{Hash, Hasher};

    let pane_key = pane_id
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(80)
        .collect::<String>();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    prompt.hash(&mut hasher);
    format!(
        "terminal-prompt:{}:{}:{}:{:016x}",
        if pane_key.is_empty() { "pane" } else { pane_key.as_str() },
        instance_id,
        observed_at_ms,
        hasher.finish(),
    )
}

fn emit_terminal_prompt_submitted_activity_started(
    app: &AppHandle,
    instance: &TerminalInstance,
    prompt: &str,
    prompt_event_id: Option<&str>,
    prompt_event_submitted_at: Option<&str>,
    prompt_source: &str,
    thread_id_override: Option<&str>,
) {
    let metadata = instance.metadata.clone();
    if !terminal_prompt_submitted_should_emit_synthetic_activity(&metadata, prompt_source) {
        return;
    }
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return;
    }
    let now_ms = terminal_now_ms();
    let event_time = prompt_event_submitted_at
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(crate::coordination::kernel::now_rfc3339);
    let prompt_event_id = prompt_event_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            terminal_prompt_fallback_event_id(&metadata.pane_id, instance.id, now_ms, prompt)
        });
    let fork_from_provider_session_id =
        terminal_runtime_snapshot(instance).fork_from_provider_session_id;
    let thread_id = thread_id_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(metadata.thread_id.as_str())
        .to_string();
    let synthetic_runtime = TerminalRuntimeSnapshot {
        status: "active".to_string(),
        activity_status: "thinking".to_string(),
        command_phase: "running".to_string(),
        input_ready: false,
        input_ready_at: None,
        prompt_ready_at: Some(event_time.clone()),
        completed_at: None,
        provider_session_id: None,
        native_session_id: None,
        fork_from_provider_session_id: fork_from_provider_session_id.clone(),
        provider_turn_id: Some(prompt_event_id.clone()),
        turn_id: Some(prompt_event_id.clone()),
        source: "backend:prompt-submitted".to_string(),
        event_type: "provider-turn-started".to_string(),
        hook_event_name: "BackendPromptSubmit".to_string(),
        updated_at_ms: now_ms,
    };
    let projected_runtime = terminal_project_runtime(&metadata, &synthetic_runtime, false);
    let payload = TerminalActivityHookPayload {
        pane_id: metadata.pane_id.clone(),
        instance_id: instance.id,
        workspace_id: metadata.workspace_id.clone(),
        workspace_name: metadata.workspace_name.clone(),
        terminal_index: metadata.terminal_index,
        thread_id,
        agent_id: metadata.agent_id.clone(),
        agent_kind: metadata.agent_kind.clone(),
        agent_type: String::new(),
        agent_display_name: String::new(),
        display_name: projected_runtime.display_name,
        terminal_name: projected_runtime.terminal_name,
        terminal_nickname: projected_runtime.terminal_nickname,
        provider: metadata.agent_kind.clone(),
        event_type: "provider-turn-started".to_string(),
        hook_event_name: "BackendPromptSubmit".to_string(),
        source: "backend:prompt-submitted".to_string(),
        status: "active".to_string(),
        activity_status: "thinking".to_string(),
        command_phase: "running".to_string(),
        execution_phase: projected_runtime.execution_phase,
        native_rail_state: projected_runtime.native_rail_state,
        native_rail_label: projected_runtime.native_rail_label,
        readiness: projected_runtime.readiness,
        terminal_lifecycle: projected_runtime.terminal_lifecycle,
        terminal_status: projected_runtime.terminal_status,
        terminal_work_state: projected_runtime.terminal_work_state,
        turn_status: projected_runtime.turn_status,
        session_state: projected_runtime.session_state,
        input_ready: false,
        input_ready_at: None,
        prompt_ready_at: Some(event_time),
        completed_at: None,
        provider_session_id: None,
        native_session_id: None,
        fork_from_provider_session_id,
        provider_turn_id: Some(prompt_event_id.clone()),
        turn_id: Some(prompt_event_id),
        transcript_path: None,
        cwd: Some(instance.working_directory.display().to_string()),
        user_message: Some(prompt.to_string()),
        message: Some(prompt.to_string()),
        live_text_delta: None,
        live_text_snapshot: None,
        live_text_kind: None,
        tool_name: None,
        tool_use_id: None,
        tool_server: None,
        tool_input: None,
        tool_output: None,
        tool_error: None,
        raw_tool_payload: None,
        command: None,
        file_path: None,
        duration_ms: None,
        exit_code: None,
        approval_id: None,
        permission_prompt_id: None,
        permission_request_id: None,
        permission_mode: None,
        prompt_id: None,
        prompt_kind: None,
        prompt_default_option: None,
        prompt_ttl_ms: None,
        prompt_options: Vec::new(),
        prompt_answer_option: None,
        manual_prompt_source: None,
        manual_approval_required: false,
        provider_blocked_for_user: false,
        terminal_is_prompting_user: false,
        prompting_user_kind: None,
        prompting_user_source: None,
        prompting_user_confidence: None,
        prompting_user_text: None,
        hook_health_status: "ok".to_string(),
        hook_health_event: "backend_prompt_submit".to_string(),
        hook_health_observed_at_ms: now_ms,
        hook_timestamp_ms: now_ms,
        observed_at_ms: now_ms,
        completion_evidence: "backend_prompt_submit".to_string(),
    };
    terminal_runtime_apply_activity_payload(instance, &payload);
    todo_dispatch_observe_activity_hook(app, &payload);
    let cloud_payload = payload.clone();
    let cloud_state = app.state::<CloudMcpState>().inner().clone();
    tauri::async_runtime::spawn(async move {
        cloud_mcp_sync_terminal_activity_hook_delta(&cloud_state, &cloud_payload).await;
    });
    let _ = app.emit(TERMINAL_ACTIVITY_HOOK_EVENT, payload);
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
    let resolved_prompt_event_id = prompt_event_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            terminal_prompt_fallback_event_id(
                &instance.metadata.pane_id,
                instance.id,
                terminal_now_ms(),
                prompt,
            )
        });
    let prompt_event_id = Some(resolved_prompt_event_id.as_str());
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
    todo_dispatch_observe_prompt_submitted(
        &metadata.workspace_id,
        &metadata.workspace_name,
        &metadata.pane_id,
        metadata.terminal_index,
        thread_id_override
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(metadata.thread_id.as_str()),
        &metadata.agent_id,
        &metadata.agent_kind,
        instance.id,
        prompt_event_id,
        prompt_event_submitted_at,
        prompt_source,
    );
    emit_terminal_prompt_submitted_activity_started(
        app,
        instance,
        prompt,
        prompt_event_id,
        prompt_event_submitted_at,
        prompt_source,
        thread_id_override,
    );
    // Prompts typed directly into a coding-agent terminal (no queue todo
    // attached) are captured Rust-side as running todos, so terminal-first
    // work shows up in todo history even with the window closed. The shared
    // per-pane registry guarantees one capture per prompt across observers
    // (input gate at write time + UserPromptSubmit hook), and queue/resume
    // prompts mark the registry so their hook echo never double-counts.
    let direct_capture_candidate = todo_id.is_none()
        && todo_dispatch_id.is_none()
        && todo_command_id.is_none()
        && !todo_resume_requested;
    // Typed prompts ride with the webview's synthetic terminal-direct refs,
    // which used to suppress this capture and leave running-status visibility
    // entirely to the webview's materializer chain (lifecycle event → source
    // gates → React state → debounced sync). When any link missed, the store
    // never held a running row until settlement, so the activity overlay
    // showed nothing while the agent worked. Capture synthetic-ref
    // submissions here too, converging on the exact item id the webview
    // minted so both writers land on one row.
    let app_control_terminal_prompt =
        todo_dispatch_is_app_control_terminal_surface(&metadata.workspace_id, &metadata.pane_id);
    let synthetic_direct_todo_id = if !app_control_terminal_prompt
        && !direct_capture_candidate
        && !todo_resume_requested
    {
        terminal_prompt_synthetic_direct_todo_id(todo_id, todo_dispatch_id, todo_command_id)
    } else {
        None
    };
    let mut direct_todo_item_id: Option<String> = None;
    if app_control_terminal_prompt {
        terminal_direct_prompt_mark_seen(&metadata.pane_id, prompt);
        log_terminal_status_event(
            "backend.terminal.direct_capture_app_control_skip",
            json!({
                "agent_id": metadata.agent_id.clone(),
                "agent_kind": metadata.agent_kind.clone(),
                "instance_id": instance.id,
                "pane_id": metadata.pane_id.clone(),
                "prompt_event_id": prompt_event_id.unwrap_or_default(),
                "prompt_len": prompt.len(),
                "terminal_index": metadata.terminal_index,
                "workspace_id": metadata.workspace_id.clone(),
            }),
        );
    } else if direct_capture_candidate || synthetic_direct_todo_id.is_some() {
        if terminal_direct_prompt_should_capture(&metadata.pane_id, prompt) {
            direct_todo_item_id = todo_dispatch_capture_direct_prompt_todo(
                app,
                &metadata.workspace_id,
                &metadata.workspace_name,
                &metadata.pane_id,
                metadata.terminal_index.map(u64::from).unwrap_or(0),
                thread_id_override
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(metadata.thread_id.as_str()),
                &metadata.agent_kind,
                prompt,
                prompt_event_id,
                synthetic_direct_todo_id.as_deref(),
            );
        }
    } else {
        terminal_direct_prompt_mark_seen(&metadata.pane_id, prompt);
    }
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
            direct_todo_item_id,
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

fn terminal_activity_hook_value(event: &Value, keys: &[&str]) -> Option<Value> {
    for key in keys {
        let Some(value) = event.get(*key) else {
            continue;
        };
        if value.is_null() {
            continue;
        }
        if value.as_str().is_some_and(|text| text.trim().is_empty()) {
            continue;
        }
        return Some(value.clone());
    }

    None
}

fn terminal_activity_hook_u64(event: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        event
            .get(*key)
            .and_then(|value| value.as_u64().or_else(|| value.as_str()?.trim().parse::<u64>().ok()))
    })
}

fn terminal_activity_hook_i64(event: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| {
        event
            .get(*key)
            .and_then(|value| value.as_i64().or_else(|| value.as_str()?.trim().parse::<i64>().ok()))
    })
}

fn terminal_activity_hook_text_from_value(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => {
            let value = value.trim();
            (!value.is_empty()).then(|| value.to_string())
        }
        Value::Array(items) => {
            let text = items
                .iter()
                .filter_map(terminal_activity_hook_text_from_value)
                .collect::<Vec<_>>()
                .join("\n");
            (!text.trim().is_empty()).then(|| text)
        }
        Value::Object(object) => {
            for key in [
                "text",
                "content",
                "delta",
                "message",
                "assistantMessage",
                "assistant_message",
                "outputText",
                "output_text",
                "summary",
                "thinking",
                "reasoning",
            ] {
                if let Some(text) = object
                    .get(key)
                    .and_then(terminal_activity_hook_text_from_value)
                {
                    return Some(text);
                }
            }
            None
        }
        _ => None,
    }
}

fn terminal_activity_hook_lossless_text_from_value(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => (!value.is_empty()).then(|| value.to_string()),
        Value::Array(items) => {
            let text = items
                .iter()
                .filter_map(terminal_activity_hook_lossless_text_from_value)
                .collect::<Vec<_>>()
                .join("\n");
            (!text.is_empty()).then_some(text)
        }
        Value::Object(object) => {
            for key in [
                "text",
                "content",
                "delta",
                "message",
                "assistantMessage",
                "assistant_message",
                "assistantMessageSnapshot",
                "assistant_message_snapshot",
                "outputText",
                "output_text",
                "summary",
                "thinking",
                "reasoning",
            ] {
                if let Some(text) = object
                    .get(key)
                    .and_then(terminal_activity_hook_lossless_text_from_value)
                {
                    return Some(text);
                }
            }
            None
        }
        _ => None,
    }
}

fn terminal_activity_hook_message_text(event: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = event
            .get(*key)
            .and_then(terminal_activity_hook_text_from_value)
        {
            return Some(text);
        }
    }
    None
}

fn terminal_activity_hook_lossless_message_text(event: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = event
            .get(*key)
            .and_then(terminal_activity_hook_lossless_text_from_value)
        {
            if !text.is_empty() {
                return Some(text);
            }
        }
    }
    None
}

fn terminal_activity_stream_debug_enabled() -> bool {
    cfg!(debug_assertions)
        && [
            "RUST_DIFFFORGE_AGENT_STREAM_DEBUG",
            "RUST_DIFFFORGE_USE_LOCAL_DOCKER_CLOUD",
        ]
        .iter()
        .any(|key| {
            std::env::var(key).ok().is_some_and(|value| {
                matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on" | "debug"
                )
            })
        })
}

fn terminal_activity_text_debug_summary(value: Option<&str>) -> Value {
    let Some(value) = value else {
        return json!({ "present": false });
    };
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    json!({
        "present": true,
        "bytes": value.len(),
        "chars": value.chars().count(),
        "hash": format!("{:016x}", hasher.finish()),
    })
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

fn terminal_activity_hook_background_status_is_active(status: &str) -> bool {
    let status = terminal_activity_hook_name_key(status);
    matches!(
        status.as_str(),
        "active"
            | "busy"
            | "dispatching"
            | "executing"
            | "inprogress"
            | "pending"
            | "processing"
            | "queued"
            | "running"
            | "starting"
            | "working"
    )
}

fn terminal_activity_hook_background_value_is_active(value: &Value) -> bool {
    match value {
        Value::Bool(value) => *value,
        Value::String(value) => terminal_activity_hook_background_status_is_active(value),
        Value::Number(number) => number.as_i64().is_some_and(|value| value > 0),
        Value::Array(items) => items
            .iter()
            .any(terminal_activity_hook_background_value_is_active),
        Value::Object(object) => {
            for key in [
                "status",
                "state",
                "phase",
                "commandPhase",
                "command_phase",
                "activityStatus",
                "activity_status",
                "turnStatus",
                "turn_status",
            ] {
                if let Some(value) = object.get(key) {
                    match value {
                        Value::String(status)
                            if terminal_activity_hook_background_status_is_active(status) =>
                        {
                            return true;
                        }
                        Value::Bool(flag) if *flag => return true,
                        _ => {}
                    }
                }
            }
            [
                "active",
                "busy",
                "inProgress",
                "in_progress",
                "pending",
                "queued",
                "running",
            ]
            .iter()
            .any(|key| object.get(*key).and_then(Value::as_bool).unwrap_or(false))
        }
        _ => false,
    }
}

fn terminal_activity_hook_background_field_is_active(event: &Value, keys: &[&str]) -> bool {
    keys.iter()
        .filter_map(|key| event.get(*key))
        .any(terminal_activity_hook_background_value_is_active)
}

fn terminal_activity_hook_claude_stop_has_background_work(event: &Value) -> bool {
    terminal_activity_hook_background_field_is_active(
        event,
        &[
            "backgroundTasks",
            "background_tasks",
            "sessionCrons",
            "session_crons",
        ],
    )
}

fn terminal_activity_hook_status_key(event: &Value, keys: &[&str]) -> Option<String> {
    terminal_activity_hook_string(event, keys).map(|value| terminal_activity_hook_name_key(&value))
}

fn terminal_activity_hook_resolution_is_failure(event: &Value) -> bool {
    terminal_activity_hook_status_key(
        event,
        &[
            "permissionDecision",
            "permission_decision",
            "decision",
            "approvalDecision",
            "approval_decision",
            "permissionStatus",
            "permission_status",
            "approvalStatus",
            "approval_status",
            "status",
            "result",
            "outcome",
        ],
    )
    .is_some_and(|status| {
        matches!(
            status.as_str(),
            "cancel"
                | "cancelled"
                | "canceled"
                | "deny"
                | "denied"
                | "error"
                | "failed"
                | "failure"
                | "no"
                | "reject"
                | "rejected"
                | "timeout"
                | "timedout"
        )
    })
}

#[derive(Debug, Clone)]
struct TerminalActivityHookManualPrompt {
    kind: String,
    text: Option<String>,
    approval_id: Option<String>,
    permission_prompt_id: Option<String>,
    permission_request_id: Option<String>,
    default_option: Option<String>,
    ttl_ms: Option<u64>,
    options: Vec<TerminalActivityHookPromptOption>,
}

fn terminal_activity_hook_prompt_option_id(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .split('_')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("_")
}

fn terminal_activity_hook_prompt_option_from_value(
    value: &Value,
) -> Option<TerminalActivityHookPromptOption> {
    if let Some(text) = value.as_str().map(str::trim).filter(|text| !text.is_empty()) {
        let id = terminal_activity_hook_prompt_option_id(text);
        return (!id.is_empty()).then(|| TerminalActivityHookPromptOption {
            id,
            label: text.chars().take(80).collect(),
            description: None,
            value: Some(text.to_string()),
        });
    }
    if let Some(items) = value.as_array() {
        let id_source = items
            .first()
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string);
        let raw_value = items
            .get(2)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
            .or_else(|| id_source.clone());
        let id = id_source
            .as_deref()
            .or(raw_value.as_deref())
            .map(terminal_activity_hook_prompt_option_id)
            .unwrap_or_default();
        let label = items
            .get(1)
            .and_then(Value::as_str)
            .or_else(|| items.first().and_then(Value::as_str))
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| id.clone());
        let description = items
            .get(3)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(|text| text.chars().take(240).collect());
        return (!id.is_empty()).then(|| TerminalActivityHookPromptOption {
            id,
            label: label.chars().take(80).collect(),
            description,
            value: raw_value,
        });
    }
    let object = value.as_object()?;
    let id_source = [
        "id",
        "key",
        "option",
        "choice",
        "action",
        "decision",
    ]
    .iter()
    .find_map(|key| object.get(*key).and_then(Value::as_str))
    .map(str::trim)
    .filter(|text| !text.is_empty())
    .map(str::to_string);
    let raw_value = [
        "value",
        "rawValue",
        "raw_value",
        "answer",
        "input",
        "selection",
    ]
    .iter()
    .find_map(|key| object.get(*key).and_then(Value::as_str))
    .map(str::trim)
    .filter(|text| !text.is_empty())
    .map(str::to_string)
    .or_else(|| id_source.clone());
    let explicit_label = [
        "label",
        "title",
        "name",
        "text",
        "message",
    ]
    .iter()
    .find_map(|key| object.get(*key).and_then(Value::as_str))
    .map(str::trim)
    .filter(|text| !text.is_empty())
    .map(str::to_string);
    let description_text = [
        "description",
        "detail",
        "help",
        "hint",
        "summary",
    ]
    .iter()
    .find_map(|key| object.get(*key).and_then(Value::as_str))
    .map(str::trim)
    .filter(|text| !text.is_empty())
    .map(str::to_string);
    let label = explicit_label
        .clone()
        .or_else(|| raw_value.clone())
        .or_else(|| description_text.clone())
        .or_else(|| id_source.clone())
        .unwrap_or_default();
    let id = id_source
        .as_deref()
        .or(raw_value.as_deref())
        .or_else(|| (!label.is_empty()).then_some(label.as_str()))
        .map(terminal_activity_hook_prompt_option_id)
        .unwrap_or_default();
    let description = description_text
        .filter(|text| text != &label)
        .map(|text| text.chars().take(240).collect());
    (!id.is_empty()).then(|| TerminalActivityHookPromptOption {
        id,
        label: label.chars().take(80).collect(),
        description,
        value: raw_value,
    })
}

fn terminal_activity_hook_prompt_options_from_event(
    event: &Value,
    prompt_kind: &str,
) -> Vec<TerminalActivityHookPromptOption> {
    let mut options = [
        "promptOptions",
        "prompt_options",
        "options",
        "choices",
        "actions",
        "decisions",
    ]
    .iter()
    .filter_map(|key| event.get(*key))
    .flat_map(|value| {
        value
            .as_array()
            .cloned()
            .unwrap_or_else(|| vec![value.clone()])
            .into_iter()
    })
    .filter_map(|value| terminal_activity_hook_prompt_option_from_value(&value))
    .collect::<Vec<_>>();

    if options.is_empty() && matches!(prompt_kind, "approval" | "permission") {
        options.extend([
            TerminalActivityHookPromptOption {
                id: "allow_once".to_string(),
                label: "Allow once".to_string(),
                description: None,
                value: None,
            },
            TerminalActivityHookPromptOption {
                id: "allow_always".to_string(),
                label: "Allow always".to_string(),
                description: None,
                value: None,
            },
            TerminalActivityHookPromptOption {
                id: "reject".to_string(),
                label: "Reject".to_string(),
                description: None,
                value: None,
            },
        ]);
    } else if options.is_empty() {
        options.push(TerminalActivityHookPromptOption {
            id: "continue".to_string(),
            label: "Continue".to_string(),
            description: None,
            value: None,
        });
    }

    let mut deduped = Vec::<TerminalActivityHookPromptOption>::new();
    for option in options {
        if option.id.is_empty() || deduped.iter().any(|existing| existing.id == option.id) {
            continue;
        }
        deduped.push(option);
    }
    deduped
}

fn terminal_activity_hook_manual_prompt(
    hook_event_name: &str,
    event: &Value,
) -> Option<TerminalActivityHookManualPrompt> {
    let hook_key = terminal_activity_hook_name_key(hook_event_name);
    let manual_event = matches!(
        hook_key.as_str(),
        "manualapprovalrequired"
            | "elicitation"
            | "elicitationrequest"
            | "elicitationrequested"
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
    let permission_request_id = terminal_activity_hook_string(
        event,
        &[
            "permissionRequestId",
            "permission_request_id",
            "promptId",
            "prompt_id",
            "questionId",
            "question_id",
            "selectionId",
            "selection_id",
            "id",
        ],
    );
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
    .filter(|value| {
        matches!(
            value.as_str(),
            "approval" | "permission" | "question" | "selection" | "input" | "text" | "choice"
        )
    })
        .unwrap_or_else(|| {
            if terminal_activity_hook_bool(
                event,
                &["manualApprovalRequired", "manual_approval_required"],
            ) || hook_key.contains("approval")
            {
                "approval".to_string()
            } else if hook_key.contains("elicitation") {
                "selection".to_string()
            } else if hook_key.contains("selection") {
                "selection".to_string()
            } else if hook_key.contains("question") {
            "question".to_string()
        } else if hook_key.contains("input") {
            "input".to_string()
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
            "question",
            "title",
            "description",
            "message",
            "prompt",
            "lastMessage",
            "last_message",
        ],
    );
    let default_option = terminal_activity_hook_string(
        event,
        &[
            "promptDefaultOption",
            "prompt_default_option",
            "defaultOption",
            "default_option",
            "default",
            "defaultDecision",
            "default_decision",
        ],
    )
    .map(|value| terminal_activity_hook_prompt_option_id(&value))
    .filter(|value| !value.is_empty())
    .or_else(|| {
        if matches!(kind.as_str(), "approval" | "permission") {
            Some("reject".to_string())
        } else {
            None
        }
    });
    let ttl_ms = [
        "promptTtlMs",
        "prompt_ttl_ms",
        "ttlMs",
        "ttl_ms",
        "timeoutMs",
        "timeout_ms",
    ]
    .iter()
    .find_map(|key| {
        event
            .get(*key)
            .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse::<u64>().ok()))
    });
    let mut options = terminal_activity_hook_prompt_options_from_event(event, &kind);
    if let Some(default_option) = default_option.as_deref() {
        if !options.iter().any(|option| option.id == default_option) {
            options.push(TerminalActivityHookPromptOption {
                id: default_option.to_string(),
                label: default_option.replace('_', " "),
                description: None,
                value: None,
            });
        }
    }

    Some(TerminalActivityHookManualPrompt {
        kind,
        text,
        approval_id,
        permission_prompt_id,
        permission_request_id,
        default_option,
        ttl_ms,
        options,
    })
}

fn terminal_activity_hook_lifecycle_kind(
    hook_event_name: &str,
) -> Option<(&'static str, &'static str, &'static str, &'static str, bool)> {
    let hook_key = terminal_activity_hook_name_key(hook_event_name);
    match hook_key.as_str() {
        key if terminal_activity_hook_is_prompt_submit_key(key) => Some((
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
        "error" | "turnerror" | "assistantturnerror" | "stopfailure" => {
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
            "interrupted",
            "active",
            "interrupted",
            true,
        )),
        _ => None,
    }
}

fn terminal_activity_hook_is_prompt_submit_key(hook_key: &str) -> bool {
    matches!(
        hook_key,
        "userpromptsubmit" | "userpromptsubmitted" | "promptsubmit" | "promptsubmitted"
    )
}

fn terminal_activity_hook_is_prompt_submit(hook_event_name: &str) -> bool {
    terminal_activity_hook_is_prompt_submit_key(&terminal_activity_hook_name_key(hook_event_name))
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
        "posttoolusefailure" => Some((
            "provider-tool-failed",
            "thinking",
            "active",
            "tool_failed",
            false,
            "cli_hook_tool_failed",
        )),
        "posttoolbatch" => Some((
            "provider-tool-batch-completed",
            "thinking",
            "active",
            "tool_completed",
            false,
            "cli_hook_tool_batch",
        )),
        "messagedisplay" | "assistantmessagedisplay" | "assistantmessagedelta" | "messagedelta" => Some((
            "provider-message-displayed",
            "thinking",
            "active",
            "message_delta",
            false,
            "cli_hook_message_display",
        )),
        "thinking"
        | "thinkingdelta"
        | "assistantthinkingdelta"
        | "reasoning"
        | "reasoningdelta"
        | "assistantreasoningdelta" => Some((
            "provider-turn-started",
            "reasoning",
            "active",
            "running",
            false,
            "cli_hook_reasoning",
        )),
        "precompact" | "contextcompactionstarted" | "compactionstarted" => Some((
            "provider-turn-compacting",
            "compacting",
            "active",
            "compacting",
            false,
            "cli_hook_compacting",
        )),
        "postcompact" | "contextcompactioncompleted" | "compactioncompleted" => Some((
            "provider-turn-compacted",
            "thinking",
            "active",
            "running",
            false,
            "cli_hook_compacted",
        )),
        "permissionrequest"
        | "userpromptrequired"
        | "manualprompt"
        | "permissionprompt"
        | "permissionpromptstarted"
        | "userinputrequired"
        | "userinputrequested"
        | "userpromptstarted"
        | "elicitation" => Some((
            "provider-permission-requested",
            "paused",
            "active",
            "awaiting_permission",
            false,
            "cli_hook_permission_request",
        )),
        "permissiondenied" => Some((
            "provider-tool-failed",
            "thinking",
            "active",
            "tool_failed",
            false,
            "cli_hook_permission_resolved",
        )),
        "elicitationresult" => {
            if terminal_activity_hook_resolution_is_failure(event) {
                Some((
                    "provider-tool-failed",
                    "thinking",
                    "active",
                    "tool_failed",
                    false,
                    "cli_hook_permission_resolved",
                ))
            } else {
                Some((
                    "provider-user-prompt-answered",
                    "thinking",
                    "active",
                    "running",
                    false,
                    "cli_hook_prompt_answered",
                ))
            }
        }
        "notification" => Some((
            "provider-work-update",
            "thinking",
            "active",
            "running",
            false,
            "cli_hook_notification",
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
        "taskcreated" => Some((
            "provider-task-created",
            "subagent_running",
            "active",
            "subagent_running",
            false,
            "cli_hook_task_created",
        )),
        "taskcompleted" => Some((
            "provider-task-completed",
            "thinking",
            "active",
            "subagent_completed",
            false,
            "cli_hook_task_completed",
        )),
        _ => None,
    }
}

fn terminal_activity_hook_non_lifecycle_is_expected(hook_event_name: &str) -> bool {
    matches!(
        terminal_activity_hook_name_key(hook_event_name).as_str(),
        "assistantmessagedelta"
            | "assistantmessagedisplay"
            | "assistantreasoningdelta"
            | "assistantthinkingdelta"
            | "compactioncompleted"
            | "compactionstarted"
            | "contextcompactioncompleted"
            | "contextcompactionstarted"
            | "elicitation"
            | "elicitationresult"
            | "manualprompt"
            | "messagedelta"
            | "messagedisplay"
            | "notification"
            | "permissiondenied"
            | "permissionprompt"
            | "permissionpromptstarted"
            | "permissionrequest"
            | "postcompact"
            | "posttoolbatch"
            | "posttooluse"
            | "posttoolusefailure"
            | "precompact"
            | "pretooluse"
            | "reasoning"
            | "reasoningdelta"
            | "subagentstart"
            | "subagentstop"
            | "taskcompleted"
            | "taskcreated"
            | "thinking"
            | "thinkingdelta"
            | "userinputrequired"
            | "userinputrequested"
            | "userpromptrequired"
            | "userpromptstarted"
    )
}

fn terminal_activity_strip_terminal_sequences(value: &str) -> String {
    enum State {
        Ground,
        Escape,
        Csi,
        Osc,
        OscEscape,
        Ss3,
    }

    let mut state = State::Ground;
    let mut output = String::with_capacity(value.len());
    for character in value.chars() {
        match state {
            State::Ground => match character {
                '\u{1b}' => state = State::Escape,
                '\u{8}' => {
                    if !output.ends_with('\n') {
                        output.pop();
                    }
                }
                '\r' | '\n' => output.push('\n'),
                '\t' => output.push(' '),
                _ if character.is_control() => output.push(' '),
                _ => output.push(character),
            },
            State::Escape => {
                state = match character {
                    '[' => State::Csi,
                    ']' | 'P' | '^' | '_' | 'X' => State::Osc,
                    'O' => State::Ss3,
                    _ => State::Ground,
                };
            }
            State::Csi => {
                let code = character as u32;
                if (0x40..=0x7e).contains(&code) {
                    state = State::Ground;
                }
            }
            State::Osc => {
                if character == '\u{1b}' {
                    state = State::OscEscape;
                } else if character == '\u{7}' {
                    state = State::Ground;
                }
            }
            State::OscEscape => {
                state = if character == '\\' {
                    State::Ground
                } else if character == '\u{1b}' {
                    State::OscEscape
                } else {
                    State::Osc
                };
            }
            State::Ss3 => state = State::Ground,
        }
    }
    output
}

fn terminal_activity_compact_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn terminal_activity_collapse_duplicate_runs(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut previous = None;
    for character in value.chars() {
        if Some(character) != previous {
            output.push(character);
        }
        previous = Some(character);
    }
    output
}

fn terminal_activity_line_is_tui_context(line: &str) -> bool {
    let compact = terminal_activity_compact_text(line);
    let lower = compact.to_ascii_lowercase();
    let deduped_lower = terminal_activity_collapse_duplicate_runs(&lower);
    let status_line = |value: &str| {
        value.contains("esc to interrupt")
            || value == "working"
            || (value.starts_with("working ") && value.contains(" esc "))
            || (value.starts_with("working ") && value.contains(" interrupt"))
            || value.contains("context refresh")
    };
    if status_line(&lower) || status_line(&deduped_lower) {
        return true;
    }

    let has_footer_separator = lower.contains(" · ") || lower.contains('·');
    let has_path_hint = lower.contains("~/") || lower.contains('/') || lower.contains('\\');
    let has_model_hint = lower.starts_with("gpt-")
        || lower.starts_with("claude")
        || lower.contains(" xhigh")
        || lower.contains(" high")
        || lower.contains(" medium")
        || lower.contains(" low")
        || lower.contains(" opus")
        || lower.contains(" sonnet")
        || lower.contains(" haiku");
    if has_footer_separator && has_path_hint && has_model_hint {
        return true;
    }

    lower.contains("ctrl+p commands")
        && (lower.contains("opencode") || lower.contains("build "))
}

fn terminal_activity_line_is_prompt_chrome(line: &str) -> bool {
    let compact = terminal_activity_compact_text(line);

    let prompt_trimmed = compact
        .trim_start_matches(|character: char| {
            character.is_whitespace() || matches!(character, '│' | '┃' | '┆' | '┊')
        })
        .trim();
    prompt_trimmed == ">"
        || prompt_trimmed.starts_with("> ")
        || prompt_trimmed.starts_with('›')
        || prompt_trimmed.starts_with('❯')
        || prompt_trimmed.starts_with('❱')
}

fn terminal_activity_line_is_tui_chrome(line: &str, tui_context: bool) -> bool {
    terminal_activity_line_is_tui_context(line)
        || (tui_context && terminal_activity_line_is_prompt_chrome(line))
}

fn terminal_activity_tui_activity_text(value: &str) -> Option<String> {
    let cleaned = terminal_activity_strip_terminal_sequences(value);
    let compact = terminal_activity_compact_text(&cleaned);
    let lower = compact.to_ascii_lowercase();
    let deduped_lower = terminal_activity_collapse_duplicate_runs(&lower);
    if lower.contains("working")
        || lower.contains("esc to interrupt")
        || deduped_lower.contains("working")
        || deduped_lower.contains("esc to interrupt")
    {
        return Some("Working".to_string());
    }
    if lower.contains("context refresh") || deduped_lower.contains("context refresh") {
        return Some("Context refresh".to_string());
    }
    None
}

fn terminal_activity_hook_live_message_text(value: &str) -> Option<String> {
    let cleaned = terminal_activity_strip_terminal_sequences(value);
    let compact_lines = cleaned
        .lines()
        .map(terminal_activity_compact_text)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let tui_context = compact_lines
        .iter()
        .any(|line| terminal_activity_line_is_tui_context(line));
    let lines = compact_lines
        .into_iter()
        .filter(|line| !terminal_activity_line_is_tui_chrome(line, tui_context))
        .collect::<Vec<_>>();
    let text = lines.join("\n");
    (!text.trim().is_empty()).then_some(text)
}

fn terminal_activity_hook_structured_live_message_text(value: &str) -> Option<String> {
    let cleaned = terminal_activity_strip_terminal_sequences(value);
    (!cleaned.is_empty()).then_some(cleaned)
}

fn terminal_activity_hook_activity_message_text(value: &str) -> Option<String> {
    terminal_activity_hook_live_message_text(value)
        .or_else(|| terminal_activity_tui_activity_text(value))
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
        ch.is_whitespace()
            || matches!(
                ch,
                '"' | '\'' | '`' | '<' | '>' | '(' | ')' | '[' | ']' | '{' | '}' | '=' | ','
            )
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
        &[
            "graphId",
            "graph_id",
            "architectureGraphId",
            "architecture_graph_id",
        ],
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
    let metadata = instance.metadata.clone();
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
                    let hook_key = terminal_activity_hook_name_key(&hook_event_name);
                    let claude_stop_has_background_work = hook_key == "stop"
                        && terminal_metadata_is_claude(&metadata)
                        && terminal_activity_hook_claude_stop_has_background_work(event);
                    if claude_stop_has_background_work {
                        (
                            "provider-turn-background-active",
                            "thinking",
                            "active",
                            "background_running",
                            false,
                            "cli_hook_stop_background_active",
                        )
                    } else {
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
                    }
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
    let hook_key = terminal_activity_hook_name_key(&hook_event_name);
    let provider_session_id = terminal_activity_hook_provider_session_id(event);
    let provider_turn_id = terminal_activity_hook_string(event, &["turnId", "turn_id"]).or_else(|| {
        terminal_activity_hook_is_prompt_submit_key(&hook_key)
            .then(|| format!("hook-turn-{}-{event_time_ms}", metadata.pane_id))
    });
    let final_message_hook = matches!(
        hook_key.as_str(),
        "stop" | "turnstop" | "assistantstop" | "subagentstop"
    );
    let user_message_keys: &[&str] = if final_message_hook {
        &[
            "lastMessage",
            "last_message",
            "lastAssistantMessage",
            "last_assistant_message",
            "assistantMessageSnapshot",
            "assistant_message_snapshot",
            "assistantMessage",
            "assistant_message",
            "outputText",
            "output_text",
            "content",
            "response",
            "output",
            "text",
            "message",
        ]
    } else {
        &[
            "assistantMessage",
            "assistant_message",
            "assistantDelta",
            "assistant_delta",
            "outputText",
            "output_text",
            "content",
            "delta",
            "response",
            "output",
            "thinking",
            "reasoning",
            "prompt",
            "userPrompt",
            "user_prompt",
            "text",
            "message",
            "description",
            "lastMessage",
            "last_message",
        ]
    };
    let raw_user_message = terminal_activity_hook_message_text(event, user_message_keys);
    let live_text_kind = if final_message_hook && raw_user_message.as_deref().is_some_and(|value| !value.trim().is_empty()) {
        Some("assistant".to_string())
    } else if matches!(
        hook_key.as_str(),
        "messagedisplay"
            | "assistantmessagedisplay"
            | "assistantmessagedelta"
            | "messagedelta"
    ) {
        Some("assistant".to_string())
    } else if matches!(
        hook_key.as_str(),
        "thinking" | "thinkingdelta" | "assistantthinkingdelta"
            | "reasoning" | "reasoningdelta" | "assistantreasoningdelta"
    ) {
        Some("reasoning".to_string())
    } else {
        None
    };
    let live_delta_hook = matches!(
        hook_key.as_str(),
        "messagedisplay"
            | "assistantmessagedisplay"
            | "assistantmessagedelta"
            | "messagedelta"
            | "thinkingdelta"
            | "assistantthinkingdelta"
            | "reasoningdelta"
            | "assistantreasoningdelta"
    );
    let explicit_live_text_delta = if live_text_kind.is_some() && live_delta_hook {
        terminal_activity_hook_lossless_message_text(
            event,
            &[
                "assistantDelta",
                "assistant_delta",
                "textDelta",
                "text_delta",
                "delta",
                "contentDelta",
                "content_delta",
                "thinkingDelta",
                "thinking_delta",
                "reasoningDelta",
                "reasoning_delta",
            ],
        )
    } else {
        None
    };
    let raw_live_text_delta = explicit_live_text_delta.clone().or_else(|| {
        if live_text_kind.is_some() && live_delta_hook {
            terminal_activity_hook_message_text(
                event,
                &[
                    "assistantMessage",
                    "assistant_message",
                    "outputText",
                    "output_text",
                    "text",
                    "message",
                ],
            )
            .or_else(|| raw_user_message.clone())
            .filter(|value| !value.trim().is_empty())
        } else {
            None
        }
    });
    let live_text_delta = raw_live_text_delta.as_deref().and_then(|value| {
        if explicit_live_text_delta.is_some() {
            terminal_activity_hook_structured_live_message_text(value)
        } else {
            terminal_activity_hook_live_message_text(value)
        }
    });
    let explicit_live_text_snapshot = terminal_activity_hook_lossless_message_text(
        event,
        &[
            "assistantMessageSnapshot",
            "assistant_message_snapshot",
            "assistantSnapshot",
            "assistant_snapshot",
            "messageSnapshot",
            "message_snapshot",
            "cumulativeText",
            "cumulative_text",
            "reasoningSnapshot",
            "reasoning_snapshot",
            "thinkingSnapshot",
            "thinking_snapshot",
            "snapshot",
        ],
    );
    let raw_live_text_snapshot = if final_message_hook && live_text_kind.is_some() {
        explicit_live_text_snapshot.clone().or_else(|| raw_user_message
            .clone()
            .filter(|value| !value.trim().is_empty()))
    } else {
        explicit_live_text_snapshot.clone()
    };
    let live_text_snapshot = raw_live_text_snapshot.as_deref().and_then(|value| {
        if explicit_live_text_snapshot.is_some() {
            terminal_activity_hook_structured_live_message_text(value)
        } else {
            terminal_activity_hook_live_message_text(value)
        }
    });
    if terminal_activity_stream_debug_enabled()
        && (live_text_delta.is_some() || live_text_snapshot.is_some() || final_message_hook)
    {
        log_terminal_status_event(
            "backend.terminal_activity_hook.live_text",
            json!({
                "event_type": event_type,
                "final_message_hook": final_message_hook,
                "hook_event_name": hook_event_name.as_str(),
                "hook_key": hook_key.as_str(),
                "live_text_kind": live_text_kind.as_deref().unwrap_or_default(),
                "pane_id": clean_terminal_diagnostic_log_text(&metadata.pane_id),
                "provider": provider.as_str(),
                "raw_delta": terminal_activity_text_debug_summary(raw_live_text_delta.as_deref()),
                "raw_snapshot": terminal_activity_text_debug_summary(raw_live_text_snapshot.as_deref()),
                "session_id_present": provider_session_id.is_some(),
                "structured_delta": explicit_live_text_delta.is_some(),
                "structured_snapshot": explicit_live_text_snapshot.is_some(),
                "sanitized_delta": terminal_activity_text_debug_summary(live_text_delta.as_deref()),
                "sanitized_snapshot": terminal_activity_text_debug_summary(live_text_snapshot.as_deref()),
            }),
        );
    }
    let user_message = if live_text_kind.is_some() {
        raw_user_message
            .as_deref()
            .and_then(terminal_activity_hook_activity_message_text)
    } else {
        raw_user_message.clone()
    };
    let input_ready_at = input_ready.then(|| event_time.clone());
    let prompt_ready_at = input_ready.then(|| event_time.clone());
    let completed_at = input_ready.then(|| event_time.clone());
    let permission_mode =
        terminal_activity_hook_string(event, &["permissionMode", "permission_mode"]);
    let prompt_is_open = matches!(
        event_type,
        "provider-permission-requested" | "provider-user-prompt-started"
    );
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
    let explicit_prompt_kind = terminal_activity_hook_string(
        event,
        &[
            "promptKind",
            "prompt_kind",
            "promptingUserKind",
            "prompting_user_kind",
            "promptingKind",
            "prompting_kind",
        ],
    )
    .map(|value| terminal_activity_hook_name_key(&value))
    .filter(|value| {
        matches!(
            value.as_str(),
            "approval" | "permission" | "question" | "selection" | "input" | "text" | "choice"
        )
    });
    let prompt_kind = manual_prompt
        .as_ref()
        .map(|prompt| prompt.kind.clone())
        .or_else(|| explicit_prompt_kind.clone())
        .or_else(|| {
            if event_type == "provider-permission-requested" {
                Some("permission".to_string())
            } else if event_type == "provider-user-prompt-started" {
                Some("prompt".to_string())
            } else {
                None
            }
        });
    let terminal_is_prompting_user = manual_prompt.is_some() || prompt_is_open;
    let prompting_user_kind = manual_prompt
        .as_ref()
        .map(|prompt| prompt.kind.clone())
        .or_else(|| prompt_kind.clone());
    let prompting_user_text = manual_prompt
        .as_ref()
        .and_then(|prompt| prompt.text.clone())
        .or_else(|| {
            terminal_activity_hook_string(
                event,
                &[
                    "promptingUserText",
                    "prompting_user_text",
                    "promptingText",
                    "prompting_text",
                    "question",
                    "title",
                    "description",
                    "message",
                    "prompt",
                ],
            )
        });
    let event_approval_id = terminal_activity_hook_string(event, &["approvalId", "approval_id"]);
    let event_permission_prompt_id =
        terminal_activity_hook_string(event, &["permissionPromptId", "permission_prompt_id"]);
    let event_permission_request_id = terminal_activity_hook_string(
        event,
        &[
            "permissionRequestId",
            "permission_request_id",
            "promptId",
            "prompt_id",
            "questionId",
            "question_id",
            "selectionId",
            "selection_id",
            "id",
        ],
    );
    let approval_id = manual_prompt
        .as_ref()
        .and_then(|prompt| prompt.approval_id.clone())
        .or_else(|| event_approval_id.clone());
    let permission_prompt_id = manual_prompt
        .as_ref()
        .and_then(|prompt| prompt.permission_prompt_id.clone())
        .or_else(|| event_permission_prompt_id.clone());
    let permission_request_id = manual_prompt
        .as_ref()
        .and_then(|prompt| prompt.permission_request_id.clone())
        .or_else(|| event_permission_request_id.clone());
    let prompt_id = manual_prompt.as_ref().and_then(|prompt| {
        prompt
            .approval_id
            .clone()
            .or_else(|| prompt.permission_prompt_id.clone())
            .or_else(|| prompt.permission_request_id.clone())
            .or_else(|| terminal_activity_hook_string(event, &["toolUseId", "tool_use_id"]))
    })
    .or_else(|| event_approval_id.clone())
    .or_else(|| event_permission_prompt_id.clone())
    .or_else(|| event_permission_request_id.clone())
    .or_else(|| terminal_activity_hook_string(event, &["toolUseId", "tool_use_id"]));
    let explicit_default_option = terminal_activity_hook_string(
        event,
        &[
            "promptDefaultOption",
            "prompt_default_option",
            "defaultOption",
            "default_option",
            "default",
            "defaultDecision",
            "default_decision",
        ],
    )
    .map(|value| terminal_activity_hook_prompt_option_id(&value))
    .filter(|value| !value.is_empty());
    let prompt_default_option = manual_prompt
        .as_ref()
        .and_then(|prompt| prompt.default_option.clone())
        .or(explicit_default_option)
        .or_else(|| {
            (prompt_is_open && matches!(prompt_kind.as_deref(), Some("approval" | "permission")))
                .then(|| "reject".to_string())
        });
    let event_prompt_ttl_ms = [
        "promptTtlMs",
        "prompt_ttl_ms",
        "ttlMs",
        "ttl_ms",
        "timeoutMs",
        "timeout_ms",
    ]
    .iter()
    .find_map(|key| {
        event
            .get(*key)
            .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse::<u64>().ok()))
    });
    let prompt_ttl_ms = manual_prompt
        .as_ref()
        .and_then(|prompt| prompt.ttl_ms)
        .or(event_prompt_ttl_ms);
    let prompt_options = manual_prompt
        .as_ref()
        .map(|prompt| prompt.options.clone())
        .unwrap_or_else(|| {
            if prompt_is_open {
                terminal_activity_hook_prompt_options_from_event(
                    event,
                    prompt_kind.as_deref().unwrap_or_default(),
                )
            } else {
                Vec::new()
            }
        });
    let prompt_answer_option = if matches!(
        event_type,
        "provider-user-prompt-answered" | "provider-user-prompt-completed"
    ) {
        terminal_activity_hook_string(
            event,
            &[
                "optionId",
                "option_id",
                "selectedOptionId",
                "selected_option_id",
                "selectedOption",
                "selected_option",
                "answer",
                "choice",
                "permissionDecision",
                "permission_decision",
                "decision",
                "response",
            ],
        )
    } else {
        None
    };
    let current_runtime = terminal_runtime_snapshot(instance);
    let projected_runtime = terminal_project_runtime(
        &metadata,
        &TerminalRuntimeSnapshot {
            status: status.to_string(),
            activity_status: activity_status.to_string(),
            command_phase: command_phase.to_string(),
            input_ready,
            input_ready_at: input_ready_at.clone(),
            prompt_ready_at: prompt_ready_at.clone(),
            completed_at: completed_at.clone(),
            provider_session_id: provider_session_id.clone(),
            native_session_id: provider_session_id.clone(),
            fork_from_provider_session_id: current_runtime.fork_from_provider_session_id.clone(),
            provider_turn_id: provider_turn_id.clone(),
            turn_id: provider_turn_id.clone(),
            source: if manual_prompt.is_some() {
                "cli-hook:manual-prompt".to_string()
            } else {
                format!("cli-hook:{event_type}")
            },
            event_type: event_type.to_string(),
            hook_event_name: hook_event_name.clone(),
            updated_at_ms: now_ms,
        },
        terminal_is_prompting_user,
    );

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
        display_name: projected_runtime.display_name,
        terminal_name: projected_runtime.terminal_name,
        terminal_nickname: projected_runtime.terminal_nickname,
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
        execution_phase: projected_runtime.execution_phase,
        native_rail_state: projected_runtime.native_rail_state,
        native_rail_label: projected_runtime.native_rail_label,
        readiness: projected_runtime.readiness,
        terminal_lifecycle: projected_runtime.terminal_lifecycle,
        terminal_status: projected_runtime.terminal_status,
        terminal_work_state: projected_runtime.terminal_work_state,
        turn_status: projected_runtime.turn_status,
        session_state: projected_runtime.session_state,
        input_ready,
        input_ready_at,
        prompt_ready_at,
        completed_at,
        provider_session_id: provider_session_id.clone(),
        native_session_id: provider_session_id.clone(),
        fork_from_provider_session_id: current_runtime.fork_from_provider_session_id,
        provider_turn_id: provider_turn_id.clone(),
        turn_id: provider_turn_id,
        transcript_path: terminal_activity_hook_string(
            event,
            &["transcriptPath", "transcript_path"],
        ),
        cwd: terminal_activity_hook_string(event, &["cwd"]),
        user_message: user_message.clone(),
        message: user_message,
        live_text_delta,
        live_text_snapshot,
        live_text_kind,
        tool_name: terminal_activity_hook_string(event, &["toolName", "tool_name"]),
        tool_use_id: terminal_activity_hook_string(event, &["toolUseId", "tool_use_id"]),
        tool_server: terminal_activity_hook_string(event, &["toolServer", "tool_server", "server"]),
        tool_input: terminal_activity_hook_value(event, &["toolInput", "tool_input", "input", "arguments", "args"]),
        tool_output: terminal_activity_hook_value(
            event,
            &[
                "toolOutput",
                "tool_output",
                "toolResponse",
                "tool_response",
                "output",
                "result",
                "response",
                "stdout",
            ],
        ),
        tool_error: terminal_activity_hook_value(
            event,
            &["toolError", "tool_error", "error", "stderr"],
        ),
        raw_tool_payload: terminal_activity_hook_value(
            event,
            &["rawToolPayload", "raw_tool_payload", "rawPayload", "raw_payload", "raw"],
        ),
        command: terminal_activity_hook_string(event, &["command"]),
        file_path: terminal_activity_hook_string(event, &["filePath", "file_path", "path"]),
        duration_ms: terminal_activity_hook_u64(event, &["durationMs", "duration_ms", "elapsedMs", "elapsed_ms"]),
        exit_code: terminal_activity_hook_i64(event, &["exitCode", "exit_code", "code"]),
        approval_id,
        permission_prompt_id,
        permission_request_id,
        permission_mode,
        prompt_id,
        prompt_kind,
        prompt_default_option,
        prompt_ttl_ms,
        prompt_options,
        prompt_answer_option,
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

const TERMINAL_NATIVE_PLAN_BACKFILL_MAX_BYTES: u64 = 512 * 1024;

/// Recovery source for native plan capture: Claude Code persists the live
/// TodoWrite list to ~/.claude/todos/<sessionId>*.json. Reading it at turn
/// boundaries backfills plans whose PostToolUse events were missed (app
/// restart, hook gap).
fn terminal_native_plan_update_from_claude_todos_file(session_id: &str) -> Option<Value> {
    let todos_dir = std::env::var_os("HOME")
        .map(PathBuf::from)?
        .join(".claude")
        .join("todos");
    let entries = std::fs::read_dir(&todos_dir).ok()?;
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(session_id) || !name.ends_with(".json") {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.len() > TERMINAL_NATIVE_PLAN_BACKFILL_MAX_BYTES {
            continue;
        }
        let modified = metadata
            .modified()
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        if newest.as_ref().map_or(true, |(time, _)| modified > *time) {
            newest = Some((modified, entry.path()));
        }
    }
    let (_, path) = newest?;
    let contents = std::fs::read_to_string(path).ok()?;
    let todos = serde_json::from_str::<Value>(&contents).ok()?;
    let steps = todos
        .as_array()?
        .iter()
        .filter_map(|item| {
            let title = item
                .get("content")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())?;
            let status = item
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("pending");
            Some(json!({
                "title": title.chars().take(500).collect::<String>(),
                "status": status,
            }))
        })
        .take(120)
        .collect::<Vec<_>>();
    if steps.is_empty() {
        return None;
    }
    Some(json!({ "tool": "todowrite", "steps": steps }))
}

// Window for treating two observations of the SAME submission (write-time
// input-gate emulation + the provider's UserPromptSubmit hook echo) as one
// prompt. Those echoes land within ~1-2s of each other; keeping the window
// short means a user deliberately re-sending the same prompt text gets a NEW
// todo instead of being swallowed as a duplicate.
const TERMINAL_DIRECT_PROMPT_DEDUPE_WINDOW_MS: u64 = 8_000;
const TERMINAL_DIRECT_PROMPT_DEDUPE_MAX_PER_PANE: usize = 12;

static TERMINAL_RECENT_SUBMITTED_PROMPTS: OnceLock<StdMutex<HashMap<String, Vec<(u64, String)>>>> =
    OnceLock::new();

fn terminal_direct_prompt_dedupe_key(prompt: &str) -> String {
    prompt
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(400)
        .collect()
}

/// One shared per-pane registry keeps every direct-capture source honest: a
/// prompt only becomes a terminal-direct todo once, no matter how many
/// observers see it (input-gate emulation at write time, the provider's
/// UserPromptSubmit hook moments later, or a queue dispatch that already owns
/// a todo).
fn terminal_direct_prompt_registry_apply(pane_id: &str, prompt: &str, record: bool) -> bool {
    let key = terminal_direct_prompt_dedupe_key(prompt);
    if key.is_empty() {
        return true;
    }
    let registry = TERMINAL_RECENT_SUBMITTED_PROMPTS.get_or_init(|| StdMutex::new(HashMap::new()));
    let Ok(mut map) = registry.lock() else {
        return false;
    };
    let now = current_time_ms();
    let entries = map.entry(pane_id.to_string()).or_default();
    entries.retain(|(at, _)| now.saturating_sub(*at) <= TERMINAL_DIRECT_PROMPT_DEDUPE_WINDOW_MS);
    let seen = entries.iter().any(|(_, existing)| existing == &key);
    if !seen && record {
        if entries.len() >= TERMINAL_DIRECT_PROMPT_DEDUPE_MAX_PER_PANE {
            entries.remove(0);
        }
        entries.push((now, key));
    }
    seen
}

fn terminal_direct_prompt_recently_seen(pane_id: &str, prompt: &str) -> bool {
    terminal_direct_prompt_registry_apply(pane_id, prompt, false)
}

fn terminal_direct_prompt_mark_seen(pane_id: &str, prompt: &str) {
    let _ = terminal_direct_prompt_registry_apply(pane_id, prompt, true);
}

/// Returns true exactly once per (pane, prompt) inside the dedupe window.
fn terminal_direct_prompt_should_capture(pane_id: &str, prompt: &str) -> bool {
    !terminal_direct_prompt_registry_apply(pane_id, prompt, true)
}

/// The webview mints synthetic `terminal-direct-*` todo refs for prompts the
/// user types straight into a coding-agent terminal, so its queue tracking
/// has ids before any store row exists. Returns that synthetic item id when
/// every attached ref belongs to the family. A real queue dispatch — even a
/// requeued terminal-direct todo, whose dispatch/command ids come from the
/// queue machinery — keeps returning None.
fn terminal_prompt_synthetic_direct_todo_id(
    todo_id: Option<&str>,
    todo_dispatch_id: Option<&str>,
    todo_command_id: Option<&str>,
) -> Option<String> {
    let todo_id = todo_id.map(str::trim).filter(|value| !value.is_empty())?;
    if !todo_id.starts_with("terminal-direct-")
        || todo_id.starts_with("terminal-direct-dispatch-")
        || todo_id.starts_with("terminal-direct-command-")
    {
        return None;
    }
    let ref_in_family = |value: Option<&str>, prefix: &str| {
        value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.starts_with(prefix))
            .unwrap_or(true)
    };
    if !ref_in_family(todo_dispatch_id, "terminal-direct-dispatch-")
        || !ref_in_family(todo_command_id, "terminal-direct-command-")
    {
        return None;
    }
    Some(todo_id.to_string())
}

/// Hook-driven prompt registration: the provider's own UserPromptSubmit hook
/// reports every submitted prompt verbatim — typed, pasted, or recalled from
/// the TUI history — so prompts entered directly in the CLI register todos
/// even when the write-time input-gate emulation missed them. Prompts the
/// app dispatched (queue/composer/resume) were already marked seen at write
/// time, so this never double-counts.
fn terminal_hook_prompt_submitted_observe(
    app: &AppHandle,
    instance: &TerminalInstance,
    payload: &TerminalActivityHookPayload,
) {
    if !terminal_activity_hook_is_prompt_submit(&payload.hook_event_name) {
        return;
    }
    let Some(prompt) = payload
        .user_message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return;
    };
    if is_terminal_control_prompt(prompt) {
        return;
    }
    if terminal_direct_prompt_recently_seen(&payload.pane_id, prompt) {
        return;
    }

    emit_terminal_prompt_submitted(
        app,
        instance,
        prompt,
        payload
            .turn_id
            .as_deref()
            .or(payload.provider_turn_id.as_deref()),
        None,
        Some("cli-activity-hook"),
        payload
            .prompt_ready_at
            .as_deref()
            .or(payload.input_ready_at.as_deref()),
        None,
        None,
        None,
        None,
        false,
        None,
        Some(prompt),
        true,
        "cli_hook_user_prompt_submit",
        Some(payload.thread_id.as_str()).filter(|value| !value.trim().is_empty()),
    );
}

/// Native plan capture: when a provider's own plan/todo tool fires (Claude
/// TodoWrite/ExitPlanMode, Codex update_plan, OpenCode todowrite), the hook
/// record carries a normalized planUpdate. Forward it into the coordination
/// kernel's Plans-tab store; the kernel event bridge then pushes the live
/// snapshot to the UI. The agent never calls a plan MCP tool.
fn terminal_native_plan_capture_observe(
    instance: &TerminalInstance,
    event: &Value,
    payload: &TerminalActivityHookPayload,
) {
    let Some(coordination) = instance.coordination.clone() else {
        return;
    };

    let hook_key = terminal_activity_hook_name_key(&payload.hook_event_name);
    let plan_update = if hook_key == "posttooluse" {
        event
            .get("planUpdate")
            .filter(|value| value.is_object())
            .cloned()
    } else {
        None
    };
    let backfill_session_id = if plan_update.is_none()
        && payload.provider == "claude"
        && matches!(hook_key.as_str(), "stop" | "sessionstart" | "sessionend")
    {
        payload
            .provider_session_id
            .clone()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    } else {
        None
    };
    if plan_update.is_none() && backfill_session_id.is_none() {
        return;
    }

    let workspace_id = payload.workspace_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let plan_update = plan_update.or_else(|| {
            backfill_session_id
                .as_deref()
                .and_then(terminal_native_plan_update_from_claude_todos_file)
        });
        let Some(plan_update) = plan_update else {
            return;
        };
        if plan_update
            .get("steps")
            .and_then(Value::as_array)
            .map_or(true, |steps| steps.is_empty())
        {
            return;
        }
        match crate::coordination::CoordinationKernel::open(
            &coordination.repo_path,
            Some(PathBuf::from(&coordination.db_path)),
        ) {
            Ok(kernel) => {
                if let Err(error) = kernel.record_terminal_todo_plan_from_native_update(
                    &coordination.session_id,
                    Some(coordination.agent_id.as_str()),
                    Some(workspace_id.as_str()).filter(|value| !value.trim().is_empty()),
                    &plan_update,
                ) {
                    log_terminal_status_event(
                        "backend.terminal_native_plan.record_error",
                        json!({
                            "error": clean_terminal_diagnostic_log_text(&error),
                        }),
                    );
                }
            }
            Err(error) => log_terminal_status_event(
                "backend.terminal_native_plan.kernel_open_error",
                json!({
                    "error": clean_terminal_diagnostic_log_text(&error),
                }),
            ),
        }
    });
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

async fn handle_terminal_activity_hook_event(
    app: &AppHandle,
    terminals: &Arc<RwLock<HashMap<String, TerminalInstance>>>,
    cloud_mcp_state: &CloudMcpState,
    pane_id: &str,
    instance_id: u64,
    event: Value,
    source: &str,
) -> Result<(), String> {
    let Some(instance) =
        terminal_activity_hook_current_instance(terminals, pane_id, instance_id).await
    else {
        return Err("Terminal activity event target is not active.".to_string());
    };
    process_terminal_activity_hook_event(
        app,
        terminals,
        cloud_mcp_state,
        pane_id,
        instance_id,
        &instance,
        &event,
        source,
    )
    .await;
    Ok(())
}

fn terminal_activity_hook_startup_idle_candidate(event: &Value) -> bool {
    terminal_activity_hook_bool(
        event,
        &[
            "startupIdleCandidate",
            "startup_idle_candidate",
            "sessionIdleWithoutPrompt",
            "session_idle_without_prompt",
        ],
    )
}

fn terminal_activity_hook_startup_idle_buffered(event: &Value) -> bool {
    terminal_activity_hook_bool(
        event,
        &[
            "startupIdleBuffered",
            "startup_idle_buffered",
            "startingIdleBuffered",
            "starting_idle_buffered",
        ],
    )
}

fn terminal_activity_hook_codex_idle_quiesce_buffered(event: &Value) -> bool {
    terminal_activity_hook_bool(
        event,
        &[
            "terminalIdleQuiesceBuffered",
            "terminal_idle_quiesce_buffered",
            "activityIdleQuiesceBuffered",
            "activity_idle_quiesce_buffered",
            "codexIdleQuiesceBuffered",
            "codex_idle_quiesce_buffered",
        ],
    )
}

fn terminal_activity_payload_is_idle_ready(payload: &TerminalActivityHookPayload) -> bool {
    payload.input_ready
        && (terminal_projection_state_is_idle(&payload.activity_status)
            || terminal_projection_state_is_idle(&payload.status)
            || matches!(
                terminal_projection_text(&payload.command_phase, "").as_str(),
                "completed" | "complete" | "done"
            ))
}

fn terminal_activity_hook_should_ignore_startup_idle_candidate(
    event: &Value,
    current_runtime_is_starting: bool,
) -> bool {
    terminal_activity_hook_startup_idle_candidate(event)
        && !terminal_activity_hook_startup_idle_buffered(event)
        && !current_runtime_is_starting
}

fn terminal_activity_hook_session_id_mismatches_busy_runtime(
    payload: &TerminalActivityHookPayload,
    current_runtime: &TerminalRuntimeSnapshot,
    current_runtime_is_busy_turn: bool,
) -> bool {
    if !current_runtime_is_busy_turn || !terminal_activity_payload_is_idle_ready(payload) {
        return false;
    }

    let payload_session_id = payload
        .provider_session_id
        .as_deref()
        .or(payload.native_session_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let runtime_session_id = current_runtime
        .provider_session_id
        .as_deref()
        .or(current_runtime.native_session_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());

    matches!(
        (payload_session_id, runtime_session_id),
        (Some(payload_session_id), Some(runtime_session_id))
            if payload_session_id != runtime_session_id
    ) || (payload_session_id.is_none()
        && runtime_session_id.is_some()
        && terminal_activity_hook_is_idle_stop_payload(payload))
}

fn terminal_activity_hook_should_quiesce_idle(
    metadata: &TerminalInstanceMetadata,
    event: &Value,
    payload: &TerminalActivityHookPayload,
    current_runtime_is_starting: bool,
    current_runtime_is_busy_turn: bool,
) -> bool {
    (cloud_mcp_agent_uses_activity_hooks(&metadata.agent_id)
        || cloud_mcp_agent_uses_activity_hooks(&metadata.agent_kind))
        && !terminal_activity_hook_codex_idle_quiesce_buffered(event)
        && !terminal_activity_hook_startup_idle_buffered(event)
        && !terminal_activity_hook_startup_idle_candidate(event)
        && !current_runtime_is_starting
        && current_runtime_is_busy_turn
        && terminal_activity_payload_is_idle_ready(payload)
        && matches!(
            terminal_activity_hook_name_key(&payload.hook_event_name).as_str(),
            "stop" | "turnstop" | "assistantstop"
        )
}

fn terminal_activity_hook_should_skip_todo_settlement(event: &Value, source: &str) -> bool {
    let source = source.trim().to_ascii_lowercase();
    terminal_activity_hook_startup_idle_candidate(event)
        || terminal_activity_hook_startup_idle_buffered(event)
        || source == "startup-idle-buffer"
        || source == "backend-startup-prompt-ready"
        || event
            .get("source")
            .and_then(Value::as_str)
            .map(str::trim)
            .is_some_and(|value| value.eq_ignore_ascii_case("backend-startup-prompt-ready"))
}

#[derive(Clone)]
struct PendingTerminalFinalStopCandidate {
    generation: u64,
    session_id: String,
    turn_id: String,
    event: Value,
}

static TERMINAL_PENDING_FINAL_STOPS: OnceLock<
    StdMutex<HashMap<String, PendingTerminalFinalStopCandidate>>,
> = OnceLock::new();
static TERMINAL_PENDING_FINAL_STOP_GENERATION: AtomicU64 = AtomicU64::new(0);

fn terminal_pending_final_stops(
) -> &'static StdMutex<HashMap<String, PendingTerminalFinalStopCandidate>> {
    TERMINAL_PENDING_FINAL_STOPS.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn terminal_pending_final_stop_key(pane_id: &str, instance_id: u64) -> String {
    format!("{pane_id}:{instance_id}")
}

fn terminal_activity_payload_session_id(payload: &TerminalActivityHookPayload) -> String {
    payload
        .provider_session_id
        .as_deref()
        .or(payload.native_session_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_string()
}

fn terminal_activity_runtime_session_id(runtime: &TerminalRuntimeSnapshot) -> String {
    runtime
        .provider_session_id
        .as_deref()
        .or(runtime.native_session_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_string()
}

fn terminal_activity_payload_turn_id(payload: &TerminalActivityHookPayload) -> String {
    payload
        .turn_id
        .as_deref()
        .or(payload.provider_turn_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_string()
}

fn terminal_activity_runtime_turn_id(runtime: &TerminalRuntimeSnapshot) -> String {
    runtime
        .turn_id
        .as_deref()
        .or(runtime.provider_turn_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_string()
}

fn terminal_activity_hook_is_idle_stop_payload(payload: &TerminalActivityHookPayload) -> bool {
    terminal_activity_payload_is_idle_ready(payload)
        && matches!(
            terminal_activity_hook_name_key(&payload.hook_event_name).as_str(),
            "stop" | "turnstop" | "assistantstop"
        )
}

fn terminal_pending_final_stop_activity_matches(
    candidate: &PendingTerminalFinalStopCandidate,
    runtime: &TerminalRuntimeSnapshot,
    payload: &TerminalActivityHookPayload,
) -> bool {
    let payload_session_id = terminal_activity_payload_session_id(payload);
    let runtime_session_id = terminal_activity_runtime_session_id(runtime);
    let session_id = if payload_session_id.is_empty() {
        runtime_session_id.as_str()
    } else {
        payload_session_id.as_str()
    };
    if !candidate.session_id.is_empty()
        && !session_id.is_empty()
        && candidate.session_id != session_id
    {
        return false;
    }

    let payload_turn_id = terminal_activity_payload_turn_id(payload);
    let runtime_turn_id = terminal_activity_runtime_turn_id(runtime);
    let turn_id = if payload_turn_id.is_empty() {
        runtime_turn_id.as_str()
    } else {
        payload_turn_id.as_str()
    };
    candidate.turn_id.is_empty() || turn_id.is_empty() || candidate.turn_id == turn_id
}

fn terminal_activity_hook_cancels_pending_final_stop(
    payload: &TerminalActivityHookPayload,
) -> bool {
    let hook_key = terminal_activity_hook_name_key(&payload.hook_event_name);
    terminal_activity_hook_is_prompt_submit_key(&hook_key)
        || matches!(
            terminal_projection_text(&payload.event_type, "").as_str(),
            "provider_turn_error"
                | "provider-turn-error"
                | "provider_turn_interrupted"
                | "provider-turn-interrupted"
                | "provider_permission_requested"
                | "provider-permission-requested"
                | "provider_user_prompt_started"
                | "provider-user-prompt-started"
        )
        || matches!(
            hook_key.as_str(),
            "error"
                | "turnerror"
                | "assistantturnerror"
                | "stopfailure"
                | "interrupt"
                | "interrupted"
                | "turninterrupt"
                | "turninterrupted"
                | "assistantinterrupt"
                | "assistantturninterrupted"
                | "userinterrupt"
                | "userinterrupted"
                | "permissionrequest"
                | "userpromptrequired"
                | "manualprompt"
                | "permissionprompt"
                | "permissionpromptstarted"
                | "userinputrequired"
                | "userinputrequested"
                | "userpromptstarted"
                | "elicitation"
        )
}

fn terminal_activity_hook_idle_stop_already_settled(
    payload: &TerminalActivityHookPayload,
    current_runtime: &TerminalRuntimeSnapshot,
    current_runtime_is_busy_turn: bool,
) -> bool {
    if current_runtime_is_busy_turn || !terminal_activity_hook_is_idle_stop_payload(payload) {
        return false;
    }
    let runtime_session_id = terminal_activity_runtime_session_id(current_runtime);
    let payload_session_id = terminal_activity_payload_session_id(payload);
    if !runtime_session_id.is_empty()
        && (!payload_session_id.is_empty() && payload_session_id != runtime_session_id
            || payload_session_id.is_empty())
    {
        return true;
    }
    let runtime_turn_id = terminal_activity_runtime_turn_id(current_runtime);
    let payload_turn_id = terminal_activity_payload_turn_id(payload);
    !runtime_turn_id.is_empty()
        && (!payload_turn_id.is_empty() && payload_turn_id == runtime_turn_id
            || payload_turn_id.is_empty())
}

fn terminal_activity_hook_update_pending_final_stop_for_activity(
    pane_id: &str,
    instance_id: u64,
    runtime: &TerminalRuntimeSnapshot,
    payload: &TerminalActivityHookPayload,
    source: &str,
) {
    if terminal_activity_hook_is_idle_stop_payload(payload) {
        return;
    }
    let key = terminal_pending_final_stop_key(pane_id, instance_id);
    let Ok(mut pending) = terminal_pending_final_stops().lock() else {
        return;
    };
    let Some(candidate) = pending.get_mut(&key) else {
        return;
    };
    if terminal_activity_hook_cancels_pending_final_stop(payload)
        || !terminal_pending_final_stop_activity_matches(candidate, runtime, payload)
    {
        pending.remove(&key);
        log_terminal_status_event(
            "backend.terminal_activity_hook.pending_final_stop_cancelled",
            json!({
                "hook_event_name": payload.hook_event_name.clone(),
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "reason": "new_turn_or_mismatch",
                "source": source,
            }),
        );
        return;
    }
    candidate.generation = TERMINAL_PENDING_FINAL_STOP_GENERATION
        .fetch_add(1, Ordering::SeqCst)
        .wrapping_add(1);
    log_terminal_status_event(
        "backend.terminal_activity_hook.pending_final_stop_extended",
        json!({
            "buffer_ms": TERMINAL_ACTIVITY_IDLE_QUIESCE_MS,
            "hook_event_name": payload.hook_event_name.clone(),
            "instance_id": instance_id,
            "pane_id": clean_terminal_diagnostic_log_text(pane_id),
            "source": source,
        }),
    );
}

fn terminal_activity_hook_buffer_final_stop_candidate(
    app: &AppHandle,
    terminals: &Arc<RwLock<HashMap<String, TerminalInstance>>>,
    cloud_mcp_state: &CloudMcpState,
    pane_id: &str,
    instance_id: u64,
    current_runtime: &TerminalRuntimeSnapshot,
    event: &Value,
    payload: &TerminalActivityHookPayload,
    source: &str,
) {
    let key = terminal_pending_final_stop_key(pane_id, instance_id);
    let generation = TERMINAL_PENDING_FINAL_STOP_GENERATION
        .fetch_add(1, Ordering::SeqCst)
        .wrapping_add(1);
    let session_id = {
        let payload_session_id = terminal_activity_payload_session_id(payload);
        if payload_session_id.is_empty() {
            terminal_activity_runtime_session_id(current_runtime)
        } else {
            payload_session_id
        }
    };
    let turn_id = {
        let payload_turn_id = terminal_activity_payload_turn_id(payload);
        if payload_turn_id.is_empty() {
            terminal_activity_runtime_turn_id(current_runtime)
        } else {
            payload_turn_id
        }
    };
    let mut buffered_event = event.clone();
    if let Some(object) = buffered_event.as_object_mut() {
        object.insert("terminalIdleQuiesceBuffered".to_string(), json!(true));
        object.insert("codexIdleQuiesceBuffered".to_string(), json!(true));
    }
    if let Ok(mut pending) = terminal_pending_final_stops().lock() {
        pending.insert(
            key.clone(),
            PendingTerminalFinalStopCandidate {
                generation,
                session_id,
                turn_id,
                event: buffered_event,
            },
        );
    }
    log_terminal_status_event(
        "backend.terminal_activity_hook.idle_quiesce_buffered",
        json!({
            "buffer_ms": TERMINAL_ACTIVITY_IDLE_QUIESCE_MS,
            "hook_event_name": payload.hook_event_name.clone(),
            "instance_id": instance_id,
            "pane_id": clean_terminal_diagnostic_log_text(pane_id),
            "source": source,
        }),
    );
    let app = app.clone();
    let terminals = Arc::clone(terminals);
    let cloud_mcp_state = cloud_mcp_state.clone();
    let pane_id = pane_id.to_string();
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(TERMINAL_ACTIVITY_IDLE_QUIESCE_MS)).await;
        let candidate = {
            let Ok(mut pending) = terminal_pending_final_stops().lock() else {
                return;
            };
            let Some(candidate) = pending.get(&key) else {
                return;
            };
            if candidate.generation != generation {
                return;
            }
            pending.remove(&key)
        };
        let Some(candidate) = candidate else {
            return;
        };
        let Some(current_instance) =
            terminal_activity_hook_current_instance(&terminals, &pane_id, instance_id).await
        else {
            return;
        };
        let runtime = terminal_runtime_snapshot(&current_instance);
        if runtime.input_ready || !terminal_runtime_snapshot_is_busy_turn(&runtime) {
            log_terminal_status_event(
                "backend.terminal_activity_hook.idle_quiesce_cancelled",
                json!({
                    "instance_id": instance_id,
                    "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                    "reason": "already_settled",
                }),
            );
            return;
        }
        let runtime_session_id = terminal_activity_runtime_session_id(&runtime);
        if !candidate.session_id.is_empty()
            && !runtime_session_id.is_empty()
            && candidate.session_id != runtime_session_id
        {
            log_terminal_status_event(
                "backend.terminal_activity_hook.idle_quiesce_cancelled",
                json!({
                    "instance_id": instance_id,
                    "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                    "reason": "session_changed",
                }),
            );
            return;
        }
        let runtime_turn_id = terminal_activity_runtime_turn_id(&runtime);
        if !candidate.turn_id.is_empty()
            && !runtime_turn_id.is_empty()
            && candidate.turn_id != runtime_turn_id
        {
            log_terminal_status_event(
                "backend.terminal_activity_hook.idle_quiesce_cancelled",
                json!({
                    "instance_id": instance_id,
                    "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                    "reason": "turn_changed",
                }),
            );
            return;
        }
        let Some(delayed_payload) =
            terminal_activity_hook_payload(&current_instance, &candidate.event)
        else {
            return;
        };
        let delayed_architecture_payload =
            terminal_architecture_activity_payload(&current_instance, &candidate.event);
        apply_terminal_activity_hook_payload(
            &app,
            &terminals,
            &cloud_mcp_state,
            &current_instance,
            &candidate.event,
            delayed_payload,
            delayed_architecture_payload,
            "terminal-idle-quiesce",
        );
    });
}

fn apply_terminal_activity_hook_payload(
    app: &AppHandle,
    terminals: &Arc<RwLock<HashMap<String, TerminalInstance>>>,
    cloud_mcp_state: &CloudMcpState,
    instance: &TerminalInstance,
    event: &Value,
    payload: TerminalActivityHookPayload,
    architecture_payload: Option<TerminalArchitectureActivityPayload>,
    source: &str,
) {
    let runtime_snapshot = terminal_runtime_apply_activity_payload(instance, &payload);
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
            "runtime_provider_session_id_present": runtime_snapshot.provider_session_id.is_some(),
            "source": source,
            "thread_id": payload.thread_id.clone(),
            "workspace_id": payload.workspace_id.clone(),
        }),
    );
    let mut cloud_payload = payload.clone();
    if cloud_payload.provider_session_id.is_none() {
        cloud_payload.provider_session_id = runtime_snapshot.provider_session_id.clone();
    }
    if cloud_payload.native_session_id.is_none() {
        cloud_payload.native_session_id = runtime_snapshot.native_session_id.clone();
    }
    if cloud_payload.provider_turn_id.is_none() {
        cloud_payload.provider_turn_id = runtime_snapshot.provider_turn_id.clone();
    }
    if cloud_payload.turn_id.is_none() {
        cloud_payload.turn_id = runtime_snapshot.turn_id.clone();
    }
    let cloud_state = cloud_mcp_state.clone();
    tauri::async_runtime::spawn(async move {
        cloud_mcp_sync_terminal_activity_hook_delta(&cloud_state, &cloud_payload).await;
    });
    if payload.provider_session_id.is_none() {
        let history_status = terminal_workspace_agent_session_status_from_payload(&payload);
        terminal_record_workspace_agent_session_history(
            Some(app.clone()),
            instance,
            None,
            None,
            &history_status,
            "terminal_activity_hook",
            None,
        );
    }
    if let Some(provider_session_id) = payload
        .provider_session_id
        .as_deref()
        .and_then(|value| {
            terminal_recordable_provider_session_id_for_metadata(&instance.metadata, Some(value))
        })
    {
        terminal_record_workspace_provider_session_binding(
            Some(app.clone()),
            instance,
            provider_session_id.clone(),
            "terminal_activity_hook",
        );
        if let Some(coordination) = instance.coordination.clone() {
            terminal_record_coordination_provider_session_id(
                coordination,
                provider_session_id,
                "terminal_activity_hook",
            );
        }
    }
    let resume_app = app.clone();
    let resume_cloud_state = cloud_mcp_state.clone();
    let resume_terminals = Arc::clone(terminals);
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
    if terminal_activity_hook_should_skip_todo_settlement(event, source) {
        log_terminal_status_event(
            "backend.terminal_activity_hook.todo_settlement_skipped",
            json!({
                "hook_event_name": payload.hook_event_name.clone(),
                "instance_id": payload.instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(&payload.pane_id),
                "reason": "startup_derived",
                "source": source,
            }),
        );
    } else {
        todo_dispatch_observe_activity_hook(app, &payload);
    }
    terminal_hook_prompt_submitted_observe(app, instance, &payload);
    terminal_native_plan_capture_observe(instance, event, &payload);
    let _ = app.emit(TERMINAL_ACTIVITY_HOOK_EVENT, payload);
    if let Some(payload) = architecture_payload {
        let _ = app.emit(TERMINAL_ARCHITECTURE_ACTIVITY_EVENT, payload);
    }
}

async fn process_terminal_activity_hook_event(
    app: &AppHandle,
    terminals: &Arc<RwLock<HashMap<String, TerminalInstance>>>,
    cloud_mcp_state: &CloudMcpState,
    pane_id: &str,
    instance_id: u64,
    instance: &TerminalInstance,
    event: &Value,
    source: &str,
) {
    let architecture_payload = terminal_architecture_activity_payload(instance, event);
    let Some(payload) = terminal_activity_hook_payload(instance, event) else {
        if let Some(payload) = architecture_payload {
            let _ = app.emit(TERMINAL_ARCHITECTURE_ACTIVITY_EVENT, payload);
        }
        let hook_event_name = terminal_activity_hook_string(
            event,
            &[
                "hookEventName",
                "hook_event_name",
                "eventName",
                "event_name",
            ],
        )
        .unwrap_or_default();
        if terminal_activity_hook_non_lifecycle_is_expected(&hook_event_name) {
            return;
        }
        let event_keys = event
            .as_object()
            .map(|object| object.keys().take(16).cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        log_terminal_status_event(
            "backend.terminal_activity_hook.unmapped",
            json!({
                "event_keys": event_keys,
                "hook_event_name": clean_terminal_diagnostic_log_text(&hook_event_name),
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "reason": if hook_event_name.is_empty() {
                    "missing_hook_event_name"
                } else {
                    "unsupported_hook_event_name"
                },
                "source": source,
            }),
        );
        return;
    };
    let current_runtime = terminal_runtime_snapshot(instance);
    let current_runtime_is_starting = terminal_runtime_snapshot_is_starting(&current_runtime);
    let current_runtime_is_busy_turn = terminal_runtime_snapshot_is_busy_turn(&current_runtime);
    if terminal_activity_hook_should_ignore_startup_idle_candidate(event, current_runtime_is_starting)
    {
        log_terminal_status_event(
            "backend.terminal_activity_hook.startup_idle_candidate_ignored",
            json!({
                "hook_event_name": payload.hook_event_name.clone(),
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "reason": if current_runtime_is_busy_turn {
                    "runtime_busy"
                } else {
                    "runtime_not_starting"
                },
                "source": source,
            }),
        );
        return;
    }
    if terminal_activity_hook_session_id_mismatches_busy_runtime(
        &payload,
        &current_runtime,
        current_runtime_is_busy_turn,
    ) {
        log_terminal_status_event(
            "backend.terminal_activity_hook.idle_session_mismatch_ignored",
            json!({
                "hook_event_name": payload.hook_event_name.clone(),
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "payload_provider_session_id": payload.provider_session_id.clone(),
                "runtime_provider_session_id": current_runtime.provider_session_id.clone(),
                "source": source,
            }),
        );
        return;
    }
    if terminal_activity_hook_idle_stop_already_settled(
        &payload,
        &current_runtime,
        current_runtime_is_busy_turn,
    ) {
        log_terminal_status_event(
            "backend.terminal_activity_hook.duplicate_idle_stop_ignored",
            json!({
                "hook_event_name": payload.hook_event_name.clone(),
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(pane_id),
                "payload_provider_session_id": payload.provider_session_id.clone(),
                "runtime_provider_session_id": current_runtime.provider_session_id.clone(),
                "source": source,
            }),
        );
        return;
    }
    if !terminal_activity_hook_startup_idle_buffered(event)
        && current_runtime_is_starting
        && terminal_activity_payload_is_idle_ready(&payload)
    {
        let scheduled_runtime_fingerprint =
            terminal_runtime_startup_idle_fingerprint(&current_runtime);
        let app = app.clone();
        let terminals = Arc::clone(terminals);
        let cloud_mcp_state = cloud_mcp_state.clone();
        let pane_id = pane_id.to_string();
        let mut buffered_event = event.clone();
        if let Some(object) = buffered_event.as_object_mut() {
            object.insert("startupIdleBuffered".to_string(), json!(true));
        }
        log_terminal_status_event(
            "backend.terminal_activity_hook.startup_idle_buffered",
            json!({
                "buffer_ms": TERMINAL_STARTING_IDLE_BUFFER_MS,
                "hook_event_name": payload.hook_event_name.clone(),
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "source": source,
            }),
        );
        tauri::async_runtime::spawn(async move {
            sleep(Duration::from_millis(TERMINAL_STARTING_IDLE_BUFFER_MS)).await;
            let Some(current_instance) =
                terminal_activity_hook_current_instance(&terminals, &pane_id, instance_id).await
            else {
                return;
            };
            let runtime = terminal_runtime_snapshot(&current_instance);
            if !terminal_runtime_snapshot_is_starting(&runtime)
                || runtime.input_ready
                || terminal_runtime_startup_idle_fingerprint(&runtime)
                    != scheduled_runtime_fingerprint
            {
                log_terminal_status_event(
                    "backend.terminal_activity_hook.startup_idle_buffer_cancelled",
                    json!({
                        "instance_id": instance_id,
                        "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                        "reason": "runtime_changed",
                    }),
                );
                return;
            }
            let Some(delayed_payload) =
                terminal_activity_hook_payload(&current_instance, &buffered_event)
            else {
                return;
            };
            let delayed_architecture_payload =
                terminal_architecture_activity_payload(&current_instance, &buffered_event);
            apply_terminal_activity_hook_payload(
                &app,
                &terminals,
                &cloud_mcp_state,
                &current_instance,
                &buffered_event,
                delayed_payload,
                delayed_architecture_payload,
                "startup-idle-buffer",
            );
        });
        return;
    }
    if terminal_activity_hook_should_quiesce_idle(
        &instance.metadata,
        event,
        &payload,
        current_runtime_is_starting,
        current_runtime_is_busy_turn,
    ) {
        terminal_activity_hook_buffer_final_stop_candidate(
            app,
            terminals,
            cloud_mcp_state,
            pane_id,
            instance_id,
            &current_runtime,
            event,
            &payload,
            source,
        );
        return;
    }
    terminal_activity_hook_update_pending_final_stop_for_activity(
        pane_id,
        instance_id,
        &current_runtime,
        &payload,
        source,
    );
    apply_terminal_activity_hook_payload(
        app,
        terminals,
        cloud_mcp_state,
        instance,
        event,
        payload,
        architecture_payload,
        source,
    );
}

fn spawn_terminal_activity_hook_watcher(
    app: AppHandle,
    terminals: Arc<RwLock<HashMap<String, TerminalInstance>>>,
    cloud_mcp_state: CloudMcpState,
    pane_id: String,
    instance_id: u64,
    poll_ms: u64,
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
                            process_terminal_activity_hook_event(
                                &app,
                                &terminals,
                                &cloud_mcp_state,
                                &pane_id,
                                instance_id,
                                &instance,
                                &event,
                                "jsonl",
                            )
                            .await;
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

            sleep(Duration::from_millis(poll_ms)).await;
        }
        log_terminal_status_event(
            "backend.terminal_activity_hook.watcher_stopped",
            json!({
                "instance_id": instance_id,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "poll_ms": poll_ms,
            }),
        );
        let state = app.state::<TerminalState>();
        if let Ok(mut tokens) = state.terminal_activity_transport_tokens.lock() {
            tokens.remove(&terminal_output_transport_key(&pane_id, instance_id));
        };
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
        "parked_resume_backend_submit"
        | "crash_todo_resume_backend_submit"
        | "todo_queue_backend_submit" => true,
        _ => false,
    }
}

fn terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(
    prompt_event_source: Option<&str>,
) -> bool {
    let source = prompt_event_source
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-");

    matches!(
        source.as_str(),
        "tui-terminal-direct-input"
            | "terminal-direct-input"
            | "tui-manual-input"
            | "observed-terminal-prompt"
            | "terminal-prompt-submitted"
            | "terminal-view-drop"
            | "todo-auto-queue"
            | "voice-agent-queue"
            | "voice-plan-queue"
            | "remote-control"
    ) || source.starts_with("tui-manual-input:")
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
                payload.app_fork_enabled,
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

async fn terminal_activity_transport_endpoint_for_state(
    app: AppHandle,
    state: &TerminalState,
) -> Result<TerminalActivityTransportEndpoint, String> {
    if let Ok(transport) = state.terminal_activity_transport.lock() {
        if let Some(endpoint) = transport.clone() {
            return Ok(endpoint);
        }
    } else {
        return Err("Unable to read terminal activity transport.".to_string());
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| format!("Unable to start terminal activity transport: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Unable to read terminal activity transport address: {error}"))?
        .port();
    let endpoint = TerminalActivityTransportEndpoint {
        host: "127.0.0.1".to_string(),
        port,
        token: uuid::Uuid::new_v4().to_string(),
    };

    {
        let mut transport = state
            .terminal_activity_transport
            .lock()
            .map_err(|_| "Unable to save terminal activity transport.".to_string())?;
        if let Some(existing) = transport.clone() {
            return Ok(existing);
        }
        *transport = Some(endpoint.clone());
    }

    spawn_terminal_activity_transport_listener(app, listener);
    Ok(endpoint)
}

async fn terminal_activity_transport_for_terminal(
    app: AppHandle,
    state: &TerminalState,
    pane_id: &str,
    instance_id: u64,
) -> Result<TerminalActivityTransportEndpoint, String> {
    let endpoint = terminal_activity_transport_endpoint_for_state(app, state).await?;
    let token = terminal_activity_transport_token_for_terminal(state, pane_id, instance_id)?;
    Ok(TerminalActivityTransportEndpoint {
        host: endpoint.host,
        port: endpoint.port,
        token,
    })
}

fn terminal_activity_transport_token_for_terminal(
    state: &TerminalState,
    pane_id: &str,
    instance_id: u64,
) -> Result<String, String> {
    let key = terminal_output_transport_key(pane_id, instance_id);
    let mut tokens = state
        .terminal_activity_transport_tokens
        .lock()
        .map_err(|_| "Unable to save terminal activity transport token.".to_string())?;
    Ok(tokens
        .entry(key)
        .or_insert_with(|| uuid::Uuid::new_v4().to_string())
        .clone())
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

fn spawn_terminal_activity_transport_listener(app: AppHandle, listener: TcpListener) {
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                handle_terminal_activity_transport_connection(app_handle, stream).await;
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

async fn handle_terminal_activity_transport_connection(app: AppHandle, mut stream: TcpStream) {
    let result = match read_terminal_activity_transport_message(&mut stream).await {
        Ok(text) => handle_terminal_activity_transport_message(&app, &text).await,
        Err(error) => Err(error),
    };
    let ack = TerminalActivityTransportAck {
        r#type: "terminal-activity-ack",
        ok: result.is_ok(),
        error: result.err(),
    };
    let response = serde_json::to_string(&ack).unwrap_or_else(|_| {
        "{\"type\":\"terminal-activity-ack\",\"ok\":false,\"error\":\"Unable to serialize terminal activity acknowledgement.\"}".to_string()
    });
    let response_line = format!("{response}\n");
    let _ = stream.write_all(response_line.as_bytes()).await;
}

async fn read_terminal_activity_transport_message(
    stream: &mut TcpStream,
) -> Result<String, String> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let read = timeout(
            Duration::from_millis(TERMINAL_ACTIVITY_TRANSPORT_IO_TIMEOUT_MS),
            stream.read(&mut chunk),
        )
        .await
        .map_err(|_| "Timed out reading activity transport message.".to_string())?
        .map_err(|error| format!("Unable to read activity transport message: {error}"))?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_TERMINAL_ACTIVITY_TRANSPORT_MESSAGE_BYTES {
            return Err("Terminal activity transport message is too large.".to_string());
        }
        if buffer.iter().any(|byte| *byte == b'\n') {
            break;
        }
    }

    if buffer.is_empty() {
        return Err("Terminal activity transport message was empty.".to_string());
    }
    let end = buffer
        .iter()
        .position(|byte| *byte == b'\n')
        .unwrap_or(buffer.len());
    String::from_utf8(buffer[..end].to_vec())
        .map_err(|error| format!("Terminal activity transport message was not UTF-8: {error}"))
}

async fn handle_terminal_activity_transport_message(
    app: &AppHandle,
    text: &str,
) -> Result<(), String> {
    if text.len() > MAX_TERMINAL_ACTIVITY_TRANSPORT_MESSAGE_BYTES {
        return Err("Terminal activity transport message is too large.".to_string());
    }
    let envelope = serde_json::from_str::<TerminalActivityTransportEnvelope>(text)
        .map_err(|error| format!("Unable to parse terminal activity transport message: {error}"))?;
    if envelope.r#type != "terminal-activity-hook" {
        return Err("Terminal activity transport message had an unsupported type.".to_string());
    }

    let pane_id = terminal_activity_hook_string(&envelope.event, &["paneId", "pane_id"])
        .ok_or_else(|| "Terminal activity event is missing pane id.".to_string())?;
    validate_terminal_pane_id(&pane_id)?;
    let instance_id = envelope
        .event
        .get("instanceId")
        .or_else(|| envelope.event.get("instance_id"))
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .ok_or_else(|| "Terminal activity event is missing instance id.".to_string())?;
    let state = app.state::<TerminalState>();
    let expected_token = {
        let tokens = state
            .terminal_activity_transport_tokens
            .lock()
            .map_err(|_| "Unable to read terminal activity transport token.".to_string())?;
        tokens
            .get(&terminal_output_transport_key(&pane_id, instance_id))
            .cloned()
    }
    .ok_or_else(|| "Terminal activity event target is not registered.".to_string())?;
    if envelope.token != expected_token {
        return Err("Terminal activity transport authentication failed.".to_string());
    }
    let cloud_mcp_state = app.state::<CloudMcpState>();
    handle_terminal_activity_hook_event(
        app,
        &state.terminals,
        cloud_mcp_state.inner(),
        &pane_id,
        instance_id,
        envelope.event,
        "transport",
    )
    .await
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
        body,
    )
    .await;
    cloud_mcp_record_voice_plan_terminal_lifecycle(app, cloud_mcp_state, parked, status, body)
        .await;
}

fn terminal_write_is_prompt_answer(
    prompt_event_source: Option<&str>,
    todo_action: Option<&str>,
) -> bool {
    [prompt_event_source, todo_action]
        .into_iter()
        .flatten()
        .any(|value| {
            matches!(
                terminal_projection_text(value, "").as_str(),
                "agent_prompt_answer"
                    | "answer_agent_prompt"
                    | "agent_input_answer"
                    | "terminal_prompt_answer"
                    | "prompt_answer"
            )
        })
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
    app_fork_enabled: Option<bool>,
    _realtime_write: bool,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
    let prompt_answer_requested = terminal_write_is_prompt_answer(
        prompt_event_source.as_deref(),
        todo_action.as_deref(),
    );
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
        if prompt_answer_requested {
            return Err("Terminal session is not running.".to_string());
        }
        return Ok(());
    };
    let mut prompt_event_id = prompt_event_id;
    let prompt_submission_text = prompt_event_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let prompt_submission_requested = prompt_submission_text.is_some();
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
    if app_fork_enabled.unwrap_or(false) {
        let fork_preview_data = normalize_terminal_enter_sequences_for_pty(data.clone());
        if terminal_try_emit_app_fork_request(
            &app,
            &instance,
            &pane_id,
            thread_id.as_deref(),
            &fork_preview_data,
            "terminal_write",
        )
        .await
        {
            return Ok(());
        }
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
    if let Some(event_prompt) = prompt_submission_text
        .as_deref()
        .filter(|value| !is_terminal_control_prompt(value))
    {
        let resolved_prompt_event_id = prompt_event_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                terminal_prompt_fallback_event_id(&pane_id, instance.id, terminal_now_ms(), event_prompt)
            });
        prompt_event_id = Some(resolved_prompt_event_id);
        emit_terminal_prompt_submitted_activity_started(
            &app,
            &instance,
            event_prompt,
            prompt_event_id.as_deref(),
            prompt_event_submitted_at.as_deref(),
            "terminal_write_prompt_submit",
            thread_id.as_deref(),
        );
        log_terminal_status_event(
            "backend.terminal_write.prompt_first_paint_emitted",
            json!({
                "has_prompt_event_id": true,
                "instance_id": instance.id,
                "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                "prompt_event_id": prompt_event_id.as_deref().unwrap_or_default(),
                "prompt_event_source": prompt_event_source.as_deref().unwrap_or_default(),
                "prompt_text_len": event_prompt.len(),
                "thread_id": thread_id.as_deref().unwrap_or_default(),
            }),
        );
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
        todo_dispatch_mark_active_for_pane_interrupted(
            &app,
            &instance.metadata.workspace_id,
            &pane_id,
            "escape_key",
        );
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
    if prompt_answer_requested && !input_write_result {
        return Err("Agent prompt answer was not written to the terminal.".to_string());
    }
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
                if terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(
                    prompt_event_source.as_deref(),
                ) {
                    log_terminal_status_event(
                        "backend.terminal_write.prompt_event_text_empty_gate_diagnostic",
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
                        "phase": "backend.bridge.prompt_event_text_empty_gate_diagnostic",
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
                } else {
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
                            "status_truth": "prompt_submit_not_authoritative",
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
            if data.contains('\r') || data.contains('\n') {
                log_terminal_status_event(
                    "backend.terminal_write.prompt_event_submit_metadata_skip",
                    json!({
                        "data_len": data.len(),
                        "instance_id": instance.id,
                        "observer_reason": observer_reason,
                        "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
                        "prompt_event_id": prompt_event_id.as_deref().unwrap_or_default(),
                        "prompt_event_source": prompt_event_source.as_deref().unwrap_or_default(),
                        "prompt_text_len": event_prompt.len(),
                        "status_truth": "prompt_submit_not_observed",
                        "thread_id": thread_id.as_deref().unwrap_or_default(),
                    }),
                );
                write_thread_bridge_diagnostic_log_entry(json!({
                    "ts_ms": current_time_ms(),
                    "phase": "backend.bridge.prompt_event_submit_metadata_skip",
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
    app_fork_enabled: Option<bool>,
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
        app_fork_enabled,
        false,
    )
    .await
}

fn terminal_agent_kind_is_opencode(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized.contains("opencode")
        || normalized.contains("open-code")
        || normalized.contains("open_code")
}

fn terminal_opencode_prompt_answer_input(key: &str) -> Option<String> {
    match key {
        "1" | "allow" | "allow_once" | "approve" | "approved" | "once" | "yes" | "y" => {
            Some("\r".to_string())
        }
        "2" | "allow_always" | "always" | "approve_always" => Some("\x1b[C\r\r".to_string()),
        "3" | "deny" | "denied" | "no" | "n" | "reject" | "rejected" => {
            Some("\x1b[C\x1b[C\r".to_string())
        }
        "cancel" | "escape" | "interrupt" | "park" | "skip" => Some("\x1b".to_string()),
        "continue" | "default" | "enter" | "ok" => Some("\r".to_string()),
        _ => None,
    }
}

fn terminal_agent_prompt_answer_input(
    agent_kind: &str,
    option_id: &str,
    option_label: &str,
    option_value: Option<&str>,
) -> String {
    let option_key = terminal_activity_hook_prompt_option_id(option_id);
    let label_key = terminal_activity_hook_prompt_option_id(option_label);
    let value_key = option_value
        .map(terminal_activity_hook_prompt_option_id)
        .unwrap_or_default();
    let key = [
        option_key.as_str(),
        label_key.as_str(),
        value_key.as_str(),
    ]
    .into_iter()
    .find(|value| !value.is_empty())
    .unwrap_or_default();
    if terminal_agent_kind_is_opencode(agent_kind) {
        if let Some(input) = terminal_opencode_prompt_answer_input(key) {
            return input;
        }
    }
    if let Some(value) = option_value.map(str::trim).filter(|value| !value.is_empty()) {
        return format!("{value}\r");
    }
    let key = if key.is_empty() {
        option_id
    } else {
        key
    };
    match key {
        "allow" | "allow_once" | "approve" | "approved" | "once" | "yes" | "y" => "y\r".to_string(),
        "allow_always" | "always" | "approve_always" => "a\r".to_string(),
        "deny" | "denied" | "no" | "n" | "reject" | "rejected" => "n\r".to_string(),
        "cancel" | "escape" | "interrupt" | "park" | "skip" => "\x1b".to_string(),
        "continue" | "default" | "enter" | "ok" => "\r".to_string(),
        _ if key.len() == 1 => format!("{key}\r"),
        _ => format!("{option_id}\r"),
    }
}

fn terminal_remote_command_string(event: &Value, keys: &[&str]) -> Option<String> {
    terminal_activity_hook_string(event, keys)
        .or_else(|| {
            event
                .get("payload")
                .and_then(|payload| terminal_activity_hook_string(payload, keys))
        })
        .or_else(|| {
            event
                .get("request")
                .and_then(|request| terminal_activity_hook_string(request, keys))
        })
}

fn terminal_remote_command_u64(event: &Value, keys: &[&str]) -> Option<u64> {
    let value_from = |root: &Value| {
        keys.iter().find_map(|key| {
            root.get(*key)
                .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse::<u64>().ok()))
        })
    };
    value_from(event)
        .or_else(|| event.get("payload").and_then(|payload| value_from(payload)))
        .or_else(|| event.get("request").and_then(|request| value_from(request)))
}

pub(crate) async fn terminal_answer_agent_prompt_remote_command(
    app: AppHandle,
    event: Value,
) -> Result<Value, String> {
    let pane_id = terminal_remote_command_string(
        &event,
        &[
            "target_terminal_id",
            "targetTerminalId",
            "terminal_id",
            "terminalId",
            "pane_id",
            "paneId",
        ],
    )
    .ok_or_else(|| "Prompt answer requires a target terminal id.".to_string())?;
    let instance_id =
        terminal_remote_command_u64(&event, &["terminal_instance_id", "terminalInstanceId"]);
    let prompt_id = terminal_remote_command_string(&event, &["prompt_id", "promptId"])
        .ok_or_else(|| "Prompt answer requires a prompt id.".to_string())?;
    let option_id = terminal_remote_command_string(&event, &["option_id", "optionId", "choice"])
        .ok_or_else(|| "Prompt answer requires an option id.".to_string())?;
    let option_label = terminal_remote_command_string(&event, &["option_label", "optionLabel"])
        .unwrap_or_else(|| option_id.clone());
    let option_value =
        terminal_remote_command_string(&event, &["option_value", "optionValue", "value"]);
    let state_app = app.clone();
    let cloud_app = app.clone();
    let state = state_app.state::<TerminalState>();
    let cloud_mcp_state = cloud_app.state::<CloudMcpState>();
    let Some(instance) = get_terminal_instance_if_current(state.inner(), &pane_id, instance_id)
        .await?
    else {
        return Err("Terminal session is not running.".to_string());
    };
    let data = terminal_agent_prompt_answer_input(
        &instance.metadata.agent_kind,
        &option_id,
        &option_label,
        option_value.as_deref(),
    );
    terminal_write_inner(
        app,
        state.inner(),
        cloud_mcp_state.inner(),
        pane_id.clone(),
        instance_id,
        data,
        Some(prompt_id.clone()).filter(|value| !value.trim().is_empty()),
        None,
        Some("agent_prompt_answer".to_string()),
        Some(crate::coordination::kernel::now_rfc3339()),
        None,
        None,
        None,
        None,
        Some("prompt_answer".to_string()),
        Some(false),
        None,
        Some(false),
        true,
    )
    .await?;
    let runtime = match get_terminal_instance_if_current(state.inner(), &pane_id, instance_id).await {
        Ok(Some(instance)) => Some(terminal_runtime_snapshot(&instance)),
        _ => None,
    };
    Ok(json!({
        "prompt_id": prompt_id,
        "option_id": option_id,
        "option_value": option_value.unwrap_or_default(),
        "pane_id": pane_id,
        "terminal_instance_id": instance_id,
        "turn_id": runtime
            .as_ref()
            .and_then(|snapshot| snapshot.turn_id.clone())
            .unwrap_or_default(),
        "provider_turn_id": runtime
            .as_ref()
            .and_then(|snapshot| snapshot.provider_turn_id.clone())
            .unwrap_or_default(),
        "provider_session_id": runtime
            .as_ref()
            .and_then(|snapshot| snapshot.provider_session_id.clone())
            .unwrap_or_default(),
        "native_session_id": runtime
            .as_ref()
            .and_then(|snapshot| snapshot.native_session_id.clone())
            .unwrap_or_default(),
        "answered": true,
    }))
}

#[tauri::command]
async fn terminal_request_fork(
    app: AppHandle,
    state: State<'_, TerminalState>,
    pane_id: String,
    instance_id: Option<u64>,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
    let Some(instance) = get_terminal_instance_if_current(state.inner(), &pane_id, instance_id).await?
    else {
        return Err("Terminal session is not running.".to_string());
    };
    let Some(provider_session_id) = terminal_current_recordable_provider_session_id(&instance) else {
        return Err("This terminal does not have a provider session to fork yet.".to_string());
    };

    log_terminal_status_event(
        "backend.terminal_request_fork.accepted",
        json!({
            "agent_kind": clean_terminal_diagnostic_log_text(&instance.metadata.agent_kind),
            "instance_id": instance.id,
            "pane_id": clean_terminal_diagnostic_log_text(&pane_id),
            "provider_session_id_present": true,
            "thread_id": clean_terminal_diagnostic_log_text(&instance.metadata.thread_id),
            "workspace_id": clean_terminal_diagnostic_log_text(&instance.metadata.workspace_id),
        }),
    );
    emit_terminal_fork_requested(&app, &instance, provider_session_id);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalCaptureDirectPromptTodoRequest {
    workspace_id: String,
    workspace_name: Option<String>,
    pane_id: String,
    terminal_index: Option<u64>,
    thread_id: String,
    agent_kind: String,
    prompt: String,
    prompt_event_id: Option<String>,
    item_id: Option<String>,
}

#[tauri::command]
async fn terminal_capture_direct_prompt_todo(
    app: AppHandle,
    request: TerminalCaptureDirectPromptTodoRequest,
) -> Result<Option<String>, String> {
    validate_terminal_pane_id(&request.pane_id)?;
    let workspace_id = request.workspace_id.trim();
    let pane_id = request.pane_id.trim();
    let prompt = request.prompt.trim();
    if workspace_id.is_empty() || prompt.is_empty() {
        return Ok(None);
    }
    if todo_dispatch_is_app_control_terminal_surface(workspace_id, pane_id) {
        log_terminal_status_event(
            "backend.terminal.capture_direct_prompt_app_control_skip",
            json!({
                "agent_kind": request.agent_kind.trim(),
                "pane_id": pane_id,
                "prompt_len": prompt.len(),
                "workspace_id": workspace_id,
            }),
        );
        return Ok(None);
    }
    Ok(todo_dispatch_capture_direct_prompt_todo(
        &app,
        workspace_id,
        request.workspace_name.as_deref().unwrap_or_default(),
        pane_id,
        request.terminal_index.unwrap_or(0),
        request.thread_id.trim(),
        request.agent_kind.trim(),
        prompt,
        request.prompt_event_id.as_deref(),
        request.item_id.as_deref(),
    ))
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
    app_fork_enabled: Option<bool>,
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
            app_fork_enabled,
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
    interrupted_todo_count: usize,
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
    terminal_interrupt_agent_inner(
        &app,
        state.inner(),
        cloud_mcp_state.inner(),
        pane_id,
        instance_id,
        reason,
    )
    .await
}

/// Headless entry point for the cloud `terminal_interrupt` remote command:
/// resolves the target pane and writes the Escape interrupt through the same
/// machinery as the local Escape key, with no webview involvement.
pub(crate) async fn terminal_interrupt_agent_remote(
    app: AppHandle,
    pane_id: String,
    instance_id: Option<u64>,
    reason: String,
) -> Result<TerminalInterruptAgentResult, String> {
    let state_app = app.clone();
    let cloud_app = app.clone();
    let state = state_app.state::<TerminalState>();
    let cloud_mcp_state = cloud_app.state::<CloudMcpState>();
    terminal_interrupt_agent_inner(
        &app,
        state.inner(),
        cloud_mcp_state.inner(),
        pane_id,
        instance_id,
        Some(reason),
    )
    .await
}

async fn terminal_interrupt_agent_inner(
    app: &AppHandle,
    state: &TerminalState,
    cloud_mcp_state: &CloudMcpState,
    pane_id: String,
    instance_id: Option<u64>,
    reason: Option<String>,
) -> Result<TerminalInterruptAgentResult, String> {
    validate_terminal_pane_id(&pane_id)?;
    let Some(instance) = get_terminal_instance_if_current(state, &pane_id, instance_id).await?
    else {
        return Ok(TerminalInterruptAgentResult {
            interrupted_active_task: false,
            interrupted_parked_prompt_count: 0,
            interrupted_todo_count: 0,
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
        cloud_mcp_state,
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
        app,
        state,
        cloud_mcp_state,
        &pane_id,
        &instance,
        &reason,
        active_task_id.as_deref(),
    )
    .await?;
    let interrupted_todo_count = todo_dispatch_mark_active_for_pane_interrupted(
        app,
        &instance.metadata.workspace_id,
        &pane_id,
        &reason,
    );

    Ok(TerminalInterruptAgentResult {
        interrupted_active_task,
        interrupted_parked_prompt_count,
        interrupted_todo_count,
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
    app: AppHandle,
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
        Some(app),
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

const TERMINAL_WINDOW_LABEL_PREFIX: &str = "terminal-window-";
const TERMINAL_WINDOW_CLOSED_EVENT: &str = "forge-terminal-window-closed";
const TERMINAL_WINDOW_DEFAULT_WIDTH: f64 = 760.0;
const TERMINAL_WINDOW_DEFAULT_HEIGHT: f64 = 520.0;

fn terminal_window_label(pane_id: &str) -> String {
    let safe = pane_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .take(160)
        .collect::<String>();
    format!("{TERMINAL_WINDOW_LABEL_PREFIX}{safe}")
}

fn emit_terminal_window_closed(app: &AppHandle, pane_id: &str) {
    let _ = app.emit(
        TERMINAL_WINDOW_CLOSED_EVENT,
        json!({
            "paneId": pane_id,
        }),
    );
}

/// Window Breakout: hosts one running terminal pane in its own native window.
/// The PTY stays untouched; the window attaches as an extra output-transport
/// subscriber, so opening and closing windows never restarts agents.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn terminal_window_open(
    app: AppHandle,
    state: State<'_, TerminalState>,
    pane_id: String,
    title: Option<String>,
    agent_kind: Option<String>,
    agent_label: Option<String>,
    color_slot: Option<String>,
    theme: Option<String>,
    workspace_id: Option<String>,
    terminal_index: Option<i64>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
    let _ = get_terminal_instance(&state, &pane_id).await?;

    let label = terminal_window_label(&pane_id);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let title_text = title
        .map(|value| value.trim().chars().take(120).collect::<String>())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Terminal".to_string());
    let mut url = format!(
        "index.html#/terminal-window?paneId={}&title={}",
        percent_encode_query_component(&pane_id),
        percent_encode_query_component(&title_text),
    );
    for (key, value) in [
        ("agentKind", agent_kind),
        ("agentLabel", agent_label),
        ("colorSlot", color_slot),
        ("theme", theme),
        ("workspaceId", workspace_id),
    ] {
        let Some(value) = value else {
            continue;
        };
        let trimmed = value.trim().chars().take(120).collect::<String>();
        if trimmed.is_empty() {
            continue;
        }
        url.push_str(&format!(
            "&{key}={}",
            percent_encode_query_component(&trimmed)
        ));
    }
    if let Some(terminal_index) = terminal_index.filter(|value| *value >= 0) {
        url.push_str(&format!("&terminalIndex={terminal_index}"));
    }

    // Open at the pane's current grid size so the terminal carries its exact
    // shape into the window; the OS resize handles take over from there.
    let window_width = width
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(420.0, 2400.0))
        .unwrap_or(TERMINAL_WINDOW_DEFAULT_WIDTH);
    let window_height = height
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(260.0, 1600.0))
        .unwrap_or(TERMINAL_WINDOW_DEFAULT_HEIGHT);

    let window = WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::App(url.into()))
        .title(format!("{title_text} - Diff Forge"))
        .inner_size(window_width, window_height)
        .min_inner_size(420.0, 260.0)
        .resizable(true)
        .decorations(false)
        .focused(true)
        .accept_first_mouse(true)
        .transparent(true)
        .background_color(Color(2, 3, 4, 255))
        .shadow(true)
        .build()
        .map_err(|error| format!("Unable to create terminal window: {error}"))?;

    let app_for_events = app.clone();
    let pane_for_events = pane_id.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            emit_terminal_window_closed(&app_for_events, &pane_for_events);
        }
    });

    Ok(())
}

#[tauri::command]
async fn terminal_window_close(app: AppHandle, pane_id: String) -> Result<(), String> {
    validate_terminal_pane_id(&pane_id)?;
    let label = terminal_window_label(&pane_id);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    } else {
        // The window is already gone; still notify so toggles converge.
        emit_terminal_window_closed(&app, &pane_id);
    }
    Ok(())
}

#[tauri::command]
async fn terminal_window_focus(app: AppHandle, pane_id: String) -> Result<bool, String> {
    validate_terminal_pane_id(&pane_id)?;
    let label = terminal_window_label(&pane_id);
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(false);
    };
    let _ = window.show();
    let _ = window.set_focus();
    Ok(true)
}

// === Cross-window terminal drag-and-drop ===
//
// When a terminal is popped into its own native window (Window Breakout), the
// main window's DOM-based drop detection cannot see it: separate webviews do
// not share a document, so `elementFromPoint` and HTML5 drag events stop at the
// main window edge. To let todo/doc drags land on a popped-out terminal we run
// a short-lived watcher while a drag is active. It reads the OS cursor position
// in screen space (independent of which window has focus), hit-tests every open
// breakout terminal window, highlights the one under the cursor, and reports
// the resolved terminal index back to the main window. The main window owns the
// payload and commits the drop by terminal index — the PTY lives in the main
// process, so index routing reaches a pane in any window. Reuses the same
// cross-platform mouse-button probe as the snip-preview drag system.
const TERMINAL_DRAG_MOVE_EVENT: &str = "forge-terminal-drag-move";
const TERMINAL_DRAG_RELEASE_EVENT: &str = "forge-terminal-drag-release";
const TERMINAL_DRAG_TARGET_EVENT: &str = "forge-terminal-drag-target";
const TERMINAL_DRAG_POLL_MS: u64 = 16;
const TERMINAL_DRAG_MOVE_THROTTLE_MS: u64 = 40;
// Hard backstop so a watcher can never spin forever if the end signal is lost
// (e.g. the main window crashes mid-drag). No real drag runs this long.
const TERMINAL_DRAG_MAX_MS: u64 = 120_000;

#[derive(Clone)]
struct TerminalDragTarget {
    label: String,
    terminal_index: i64,
}

struct TerminalDragSession {
    generation: u64,
    targets: Vec<TerminalDragTarget>,
}

static TERMINAL_DRAG_SESSION: OnceLock<StdMutex<Option<TerminalDragSession>>> = OnceLock::new();
static TERMINAL_DRAG_GENERATION: AtomicU64 = AtomicU64::new(0);

fn terminal_drag_session_slot() -> &'static StdMutex<Option<TerminalDragSession>> {
    TERMINAL_DRAG_SESSION.get_or_init(|| StdMutex::new(None))
}

#[derive(Deserialize)]
struct TerminalDragTargetInput {
    #[serde(rename = "paneId")]
    pane_id: String,
    #[serde(rename = "terminalIndex")]
    terminal_index: i64,
}

/// True when the physical-pixel screen cursor sits inside this window's outer
/// rect and the window is actually on screen.
fn terminal_drag_cursor_in_window(app: &AppHandle, label: &str, cursor: (f64, f64)) -> bool {
    let Some(window) = app.get_webview_window(label) else {
        return false;
    };
    if !window.is_visible().unwrap_or(false) {
        return false;
    }
    let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return false;
    };
    let left = f64::from(position.x);
    let top = f64::from(position.y);
    let right = left + f64::from(size.width);
    let bottom = top + f64::from(size.height);
    cursor.0 >= left && cursor.0 <= right && cursor.1 >= top && cursor.1 <= bottom
}

/// The breakout terminal window under the cursor, if any. There is no portable
/// Tauri z-order query, so when overlapping windows both contain the cursor we
/// prefer the focused one (the window the user is most likely looking at);
/// otherwise the first match in list order wins.
fn terminal_drag_hit_test(
    app: &AppHandle,
    targets: &[TerminalDragTarget],
) -> Option<(String, i64)> {
    let cursor = app.cursor_position().ok()?;
    let point = (cursor.x, cursor.y);
    let mut first_match: Option<(String, i64)> = None;
    for target in targets {
        if !terminal_drag_cursor_in_window(app, &target.label, point) {
            continue;
        }
        let focused = app
            .get_webview_window(&target.label)
            .and_then(|window| window.is_focused().ok())
            .unwrap_or(false);
        if focused {
            return Some((target.label.clone(), target.terminal_index));
        }
        if first_match.is_none() {
            first_match = Some((target.label.clone(), target.terminal_index));
        }
    }
    first_match
}

fn terminal_drag_set_highlight(app: &AppHandle, label: &str, active: bool) {
    let _ = app.emit_to(label, TERMINAL_DRAG_TARGET_EVENT, json!({ "active": active }));
}

fn terminal_drag_take_session() -> Option<TerminalDragSession> {
    terminal_drag_session_slot()
        .lock()
        .ok()
        .and_then(|mut guard| guard.take())
}

fn terminal_drag_clear(app: &AppHandle) {
    if let Some(session) = terminal_drag_take_session() {
        for target in &session.targets {
            terminal_drag_set_highlight(app, &target.label, false);
        }
    }
}

fn terminal_drag_spawn_watcher(app: AppHandle, generation: u64) {
    tauri::async_runtime::spawn(async move {
        let button_state_supported = snipping_mouse_button_state_supported();
        let started_ms = terminal_now_ms();
        let mut active_label: Option<String> = None;
        let mut last_index: Option<i64> = None;
        let mut last_emit_ms: u64 = 0;
        // Clears this watcher's lingering highlight before it exits for any
        // reason (supersede, end, backstop), so a breakout window never gets
        // stuck showing "Drop here".
        let clear_active = |active_label: &Option<String>| {
            if let Some(label) = active_label {
                terminal_drag_set_highlight(&app, label, false);
            }
        };
        loop {
            sleep(Duration::from_millis(TERMINAL_DRAG_POLL_MS)).await;

            // Backstop: never outlive the main window or a sane drag duration.
            if app.get_webview_window("main").is_none()
                || terminal_now_ms().saturating_sub(started_ms) > TERMINAL_DRAG_MAX_MS
            {
                clear_active(&active_label);
                if let Ok(mut guard) = terminal_drag_session_slot().lock() {
                    if guard.as_ref().map(|session| session.generation) == Some(generation) {
                        *guard = None;
                    }
                }
                return;
            }

            // Bail the moment a newer session supersedes this one or the drag ends.
            let targets = {
                let guard = match terminal_drag_session_slot().lock() {
                    Ok(guard) => guard,
                    Err(_) => {
                        clear_active(&active_label);
                        return;
                    }
                };
                match guard.as_ref() {
                    Some(session) if session.generation == generation => session.targets.clone(),
                    _ => {
                        clear_active(&active_label);
                        return;
                    }
                }
            };

            // Where the platform can answer "is the button still down?", resolve
            // the drop the instant it releases. Where it cannot (Linux), the main
            // window's own dragend/pointerup ends the session via the end command.
            if button_state_supported && !snipping_left_mouse_button_pressed() {
                let final_index = terminal_drag_hit_test(&app, &targets).map(|(_, index)| index);
                if let Some(ref label) = active_label {
                    terminal_drag_set_highlight(&app, label, false);
                }
                let _ = app.emit_to(
                    "main",
                    TERMINAL_DRAG_RELEASE_EVENT,
                    json!({ "terminalIndex": final_index }),
                );
                if let Ok(mut guard) = terminal_drag_session_slot().lock() {
                    if guard.as_ref().map(|session| session.generation) == Some(generation) {
                        *guard = None;
                    }
                }
                return;
            }

            let matched = terminal_drag_hit_test(&app, &targets);
            let matched_label = matched.as_ref().map(|(label, _)| label.clone());
            let matched_index = matched.as_ref().map(|(_, index)| *index);

            if matched_label != active_label {
                if let Some(ref label) = active_label {
                    terminal_drag_set_highlight(&app, label, false);
                }
                if let Some(ref label) = matched_label {
                    terminal_drag_set_highlight(&app, label, true);
                }
                active_label = matched_label.clone();
            }

            let now_ms = terminal_now_ms();
            if matched_index != last_index
                || now_ms.saturating_sub(last_emit_ms) >= TERMINAL_DRAG_MOVE_THROTTLE_MS
            {
                let _ = app.emit_to(
                    "main",
                    TERMINAL_DRAG_MOVE_EVENT,
                    json!({
                        "terminalIndex": matched_index,
                        "overBreakout": matched_index.is_some(),
                    }),
                );
                last_index = matched_index;
                last_emit_ms = now_ms;
            }
        }
    });
}

/// Starts the cross-window drag watcher for the supplied breakout terminal
/// windows. A no-op (and an immediate highlight clear) when no terminals are
/// popped out — the in-grid case needs no watcher.
#[tauri::command]
async fn terminal_drag_session_begin(
    app: AppHandle,
    targets: Vec<TerminalDragTargetInput>,
) -> Result<(), String> {
    let resolved: Vec<TerminalDragTarget> = targets
        .into_iter()
        .filter(|target| !target.pane_id.trim().is_empty())
        .map(|target| TerminalDragTarget {
            label: terminal_window_label(&target.pane_id),
            terminal_index: target.terminal_index,
        })
        .collect();

    if resolved.is_empty() {
        terminal_drag_clear(&app);
        return Ok(());
    }

    let generation = TERMINAL_DRAG_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut guard = terminal_drag_session_slot()
            .lock()
            .map_err(|_| "terminal drag state poisoned".to_string())?;
        *guard = Some(TerminalDragSession {
            generation,
            targets: resolved,
        });
    }
    terminal_drag_spawn_watcher(app, generation);
    Ok(())
}

/// Ends the active drag watcher and clears any breakout-window highlight.
#[tauri::command]
async fn terminal_drag_session_end(app: AppHandle) -> Result<(), String> {
    terminal_drag_clear(&app);
    Ok(())
}

#[tauri::command]
async fn terminal_pane_runtime_info(
    state: State<'_, TerminalState>,
    pane_id: String,
) -> Result<Value, String> {
    validate_terminal_pane_id(&pane_id)?;
    let instance = get_terminal_instance(&state, &pane_id).await?;
    let size = *instance.size.lock().await;
    Ok(json!({
        "instanceId": instance.id,
        "cols": size.cols,
        "rows": size.rows,
    }))
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
        let runtime = terminal_runtime_snapshot(&instance);
        let has_active_task = active_task.is_some();
        let parked = parked_prompt.is_some();
        let projected_runtime = terminal_project_runtime(&metadata, &runtime, parked);
        let launch_metadata = instance
            .launch_metadata
            .lock()
            .map(|metadata| metadata.clone())
            .unwrap_or_default();
        let capabilities = terminal_session_capabilities(&metadata.agent_kind, &launch_metadata);

        summaries.push(TerminalLiveSessionSummary {
            pane_id,
            instance_id: instance.id,
            workspace_id: metadata.workspace_id,
            workspace_name: metadata.workspace_name,
            terminal_index: metadata.terminal_index,
            thread_id: metadata.thread_id,
            agent_id: metadata.agent_id,
            agent_kind: metadata.agent_kind,
            display_name: projected_runtime.display_name,
            terminal_name: projected_runtime.terminal_name,
            terminal_nickname: projected_runtime.terminal_nickname,
            status: runtime.status,
            activity_status: runtime.activity_status,
            command_phase: runtime.command_phase,
            execution_phase: projected_runtime.execution_phase,
            native_rail_state: projected_runtime.native_rail_state,
            native_rail_label: projected_runtime.native_rail_label,
            readiness: projected_runtime.readiness,
            terminal_lifecycle: projected_runtime.terminal_lifecycle,
            terminal_status: projected_runtime.terminal_status,
            terminal_work_state: projected_runtime.terminal_work_state,
            turn_status: projected_runtime.turn_status,
            session_state: projected_runtime.session_state,
            input_ready: runtime.input_ready,
            input_ready_at: runtime.input_ready_at,
            prompt_ready_at: runtime.prompt_ready_at,
            completed_at: runtime.completed_at,
            provider_session_id: runtime.provider_session_id,
            native_session_id: runtime.native_session_id,
            fork_from_provider_session_id: runtime.fork_from_provider_session_id,
            provider_turn_id: runtime.provider_turn_id,
            turn_id: runtime.turn_id,
            runtime_source: runtime.source,
            runtime_event_type: runtime.event_type,
            runtime_hook_event_name: runtime.hook_event_name,
            runtime_updated_at_ms: runtime.updated_at_ms,
            working_directory: instance.working_directory.to_string_lossy().to_string(),
            session_mode: instance.session_mode.as_str().to_string(),
            file_authority: instance.session_mode.file_authority().to_string(),
            capabilities,
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
    fn terminal_agent_kind_normalization_keeps_prewarm_from_becoming_identity() {
        assert_eq!(
            terminal_normalize_agent_kind(Some("claude-code")).as_deref(),
            Some("claude")
        );
        assert_eq!(
            terminal_normalize_agent_kind(Some("OpenCode")).as_deref(),
            Some("opencode")
        );
        assert_eq!(
            terminal_normalize_agent_kind(Some("console")).as_deref(),
            Some("codex")
        );
        assert_eq!(
            terminal_normalize_agent_kind(Some("shell")).as_deref(),
            Some("generic")
        );
        assert_eq!(terminal_normalize_agent_kind(Some("prewarm-pty")), None);
    }

    #[test]
    fn provider_resume_args_are_provider_specific() {
        assert_eq!(
            terminal_provider_resume_args(AgentProvider::Codex, Some("codex-session-1")),
            vec!["resume".to_string(), "codex-session-1".to_string()]
        );
        assert_eq!(
            terminal_provider_resume_args(AgentProvider::Claude, Some("claude-session-1")),
            vec!["--resume".to_string(), "claude-session-1".to_string()]
        );
        assert_eq!(
            terminal_provider_resume_args(AgentProvider::OpenCode, Some("opencode-session-1")),
            vec!["--session".to_string(), "opencode-session-1".to_string()]
        );
        assert!(terminal_provider_resume_args(AgentProvider::Codex, Some("   ")).is_empty());
    }

    #[test]
    fn provider_fork_args_are_provider_specific() {
        assert_eq!(
            terminal_provider_fork_args(AgentProvider::Codex, Some("codex-session-1")),
            vec!["fork".to_string(), "codex-session-1".to_string()]
        );
        assert_eq!(
            terminal_provider_fork_args(AgentProvider::Claude, Some("claude-session-1")),
            vec![
                "--resume".to_string(),
                "claude-session-1".to_string(),
                "--fork-session".to_string(),
            ]
        );
        assert_eq!(
            terminal_provider_fork_args(AgentProvider::OpenCode, Some("opencode-session-1")),
            vec![
                "--session".to_string(),
                "opencode-session-1".to_string(),
                "--fork".to_string(),
            ]
        );
        assert!(terminal_provider_fork_args(AgentProvider::Codex, Some("   ")).is_empty());
    }

    #[test]
    fn app_fork_prompt_matcher_is_exact() {
        assert!(terminal_prompt_is_app_fork_command("fork"));
        assert!(terminal_prompt_is_app_fork_command("  fork  "));
        assert!(terminal_prompt_is_app_fork_command("FORK"));
        assert!(!terminal_prompt_is_app_fork_command("/fork"));
        assert!(!terminal_prompt_is_app_fork_command("fork please"));
    }

    #[test]
    fn opencode_provider_session_recording_requires_native_session_id() {
        assert!(terminal_provider_session_id_is_recordable_for_agent(
            "opencode",
            "opencode",
            "ses_0f32849b3ffeGn2tL6DnSIUCsZ",
        ));
        assert!(!terminal_provider_session_id_is_recordable_for_agent(
            "opencode",
            "opencode",
            "019f0cd7-1347-7273-b20f-e959c3772a01",
        ));
        assert!(terminal_provider_session_id_is_recordable_for_agent(
            "codex",
            "codex",
            "019f0cd7-1347-7273-b20f-e959c3772a01",
        ));
    }

    #[test]
    fn codex_launch_args_disable_startup_update_checks() {
        let mut args = Vec::new();
        terminal_append_provider_launch_args(
            AgentProvider::Codex,
            &mut args,
            &TerminalProviderResolvedLaunchOptions::default(),
        );

        assert!(args.windows(2).any(|pair| {
            pair[0] == "-c" && pair[1] == "check_for_update_on_startup=false"
        }));
    }

    #[test]
    fn transcript_path_session_fallback_extracts_uuid() {
        let session_id = "550e8400-e29b-41d4-a716-446655440000";
        let event = json!({
            "transcriptPath": format!("/tmp/codex/rollout-{session_id}.jsonl"),
        });

        assert_eq!(
            terminal_provider_session_id_from_transcript_path(&event).as_deref(),
            Some(session_id),
        );
    }

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

    fn terminal_enable_agent_worktrees(repo: &Path) {
        let (kernel, _) =
            crate::coordination::CoordinationKernel::open_for_terminal_launch(repo, None).unwrap();
        kernel
            .update_repo_policy(&json!({"agent_worktree_required": true}))
            .unwrap();
    }

    fn terminal_enable_direct_unmanaged_agents(repo: &Path) {
        let (kernel, _) =
            crate::coordination::CoordinationKernel::open_for_terminal_launch(repo, None).unwrap();
        kernel
            .update_repo_policy(&json!({"agent_session_mode": "direct_unmanaged"}))
            .unwrap();
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

    #[test]
    fn workspace_git_discovery_includes_enclosing_repo_for_nested_workspace() {
        let repo = terminal_test_repo_with_commit("git_discovery_enclosing_repo");
        let nested_workspace = repo.join("packages").join("app");
        fs::create_dir_all(&nested_workspace).unwrap();

        let repositories = workspace_git_discovered_repositories(&nested_workspace, &[]);

        assert_eq!(repositories.len(), 1);
        assert_eq!(workspace_git_repo_key(&repositories[0]), workspace_git_repo_key(&repo));
    }

    #[test]
    fn workspace_git_discovery_includes_repo_under_workspace() {
        let workspace = terminal_test_directory("git_discovery_child_repo");
        let repo = workspace.join("packages").join("app");
        fs::create_dir_all(&repo).unwrap();
        terminal_test_git(&repo, &["init"]);

        let repositories = workspace_git_discovered_repositories(
            &workspace,
            &[WorkspaceProjectMount {
                mount_id: "packages/app".to_string(),
                workspace_relative_path: "packages/app".to_string(),
                project_root: workspace_path_display(&repo),
                project_name: "app".to_string(),
                project_kind: "git_repo".to_string(),
                mount_kind: "project".to_string(),
                parent_mount_id: Some("packages".to_string()),
                mount_depth: 2,
                has_git: true,
                has_agents: false,
                root_path: repo.clone(),
            }],
        );

        assert_eq!(repositories.len(), 1);
        assert_eq!(workspace_git_repo_key(&repositories[0]), workspace_git_repo_key(&repo));
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
    fn non_free_modes_prepare_coordination_and_only_managed_patch_requires_worktree() {
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
    fn general_terminal_launch_target_uses_direct_edit_for_git_root_by_default() {
        let repo = terminal_test_repo("general_git_launch_target");

        let target = terminal_coordination_launch_target(
            &repo,
            None,
            None,
            false,
            TerminalSessionMode::General,
        )
        .unwrap();

        assert_eq!(target.enforcement_mode, "bounded_direct_edit");
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&repo.canonicalize().unwrap())
        );
    }

    #[test]
    fn general_terminal_launch_target_uses_worktree_when_policy_enabled() {
        let repo = terminal_test_repo("general_git_worktree_policy_launch_target");
        terminal_enable_agent_worktrees(&repo);

        let target = terminal_coordination_launch_target(
            &repo,
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
    fn general_terminal_launch_target_uses_direct_unmanaged_authority_when_policy_enabled() {
        let repo = terminal_test_repo("general_git_unmanaged_policy_launch_target");
        terminal_enable_direct_unmanaged_agents(&repo);

        let target = terminal_coordination_launch_target(
            &repo,
            None,
            None,
            false,
            TerminalSessionMode::General,
        )
        .unwrap();

        assert_eq!(target.enforcement_mode, "direct_unmanaged");
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
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&project.canonicalize().unwrap())
        );
    }

    #[test]
    fn general_terminal_launch_target_keeps_empty_selected_workspace_direct_by_default() {
        let empty_workspace = terminal_test_directory("general_empty_selected_launch_target");

        let target = terminal_coordination_launch_target(
            &empty_workspace,
            None,
            None,
            true,
            TerminalSessionMode::General,
        )
        .unwrap();

        assert_eq!(target.enforcement_mode, "bounded_direct_edit");
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&empty_workspace.canonicalize().unwrap())
        );
        assert!(!empty_workspace.join(".git").exists());
    }

    #[test]
    fn general_terminal_launch_target_keeps_empty_workspace_direct_when_policy_enabled() {
        let empty_workspace =
            terminal_test_directory("general_empty_selected_worktree_policy_launch_target");
        terminal_enable_agent_worktrees(&empty_workspace);

        let target = terminal_coordination_launch_target(
            &empty_workspace,
            None,
            None,
            true,
            TerminalSessionMode::General,
        )
        .unwrap();

        assert_eq!(target.enforcement_mode, "bounded_direct_edit");
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&empty_workspace.canonicalize().unwrap())
        );
        assert!(!empty_workspace.join(".git").exists());
    }

    #[test]
    fn general_terminal_launch_target_keeps_reopened_metadata_only_workspace_direct() {
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

        assert_eq!(target.enforcement_mode, "bounded_direct_edit");
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
        assert!(!project.join(".git").exists());
    }

    #[test]
    fn general_terminal_launch_target_ignores_requested_project_root() {
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
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&workspace.canonicalize().unwrap())
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

        assert!(error.contains("requires the selected workspace root"));
        assert!(!project.join(".git").exists());
    }

    #[test]
    fn general_terminal_launch_target_keeps_git_subdirectory_as_selected_root() {
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

        assert_eq!(target.enforcement_mode, "bounded_direct_edit");
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&subdir.canonicalize().unwrap())
        );
    }

    #[test]
    fn general_terminal_launch_target_uses_workspace_root_until_project_selected() {
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
        assert_eq!(container_target.enforcement_mode, "bounded_direct_edit");
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
        assert_eq!(selected.enforcement_mode, "bounded_direct_edit");
        assert_eq!(
            normalized_path_key(&selected.root.canonicalize().unwrap()),
            normalized_path_key(&container.canonicalize().unwrap())
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
        let first = runtime
            .block_on(terminal_workspace_topology_scan_for_launch_from_cache(
                &cache,
                &container,
                1_000,
                Some(1_000),
            ))
            .mounts;
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

        let burst = runtime
            .block_on(terminal_workspace_topology_scan_for_launch_from_cache(
                &cache,
                &container,
                1_000 + TERMINAL_WORKSPACE_TOPOLOGY_CACHE_FRESH_MS - 1,
                Some(1_000 + TERMINAL_WORKSPACE_TOPOLOGY_CACHE_FRESH_MS - 1),
            ))
            .mounts;
        assert_eq!(burst.len(), 1);
        assert_eq!(burst[0].workspace_relative_path, "frontend");

        let later = runtime
            .block_on(terminal_workspace_topology_scan_for_launch_from_cache(
                &cache,
                &container,
                1_000 + TERMINAL_WORKSPACE_TOPOLOGY_CACHE_FRESH_MS + 1,
                Some(1_000 + TERMINAL_WORKSPACE_TOPOLOGY_CACHE_FRESH_MS + 1),
            ))
            .mounts;
        let mount_paths = later
            .iter()
            .map(|mount| mount.workspace_relative_path.as_str())
            .collect::<HashSet<_>>();
        assert_eq!(mount_paths.len(), 2);
        assert!(mount_paths.contains("frontend"));
        assert!(mount_paths.contains("backend"));
    }

    #[test]
    fn general_terminal_launch_target_does_not_auto_select_single_git_mount() {
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

        assert_eq!(target.enforcement_mode, "bounded_direct_edit");
        assert_eq!(
            normalized_path_key(&target.root.canonicalize().unwrap()),
            normalized_path_key(&container.canonicalize().unwrap())
        );
    }

    #[test]
    fn general_terminal_launch_target_ignores_deep_selected_git_mount() {
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

        assert_eq!(selected.enforcement_mode, "bounded_direct_edit");
        assert_eq!(
            normalized_path_key(&selected.root.canonicalize().unwrap()),
            normalized_path_key(&container.canonicalize().unwrap())
        );
    }

    #[test]
    fn direct_edit_launch_target_uses_direct_policy_for_git_root_by_default() {
        let repo = terminal_test_repo("direct_edit_git_launch_target");

        let target = terminal_coordination_launch_target(
            &repo,
            None,
            None,
            false,
            TerminalSessionMode::DirectEdit,
        )
        .unwrap();

        assert_eq!(target.enforcement_mode, "bounded_direct_edit");
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
    fn embedded_shift_enter_sequence_preserves_multiline_prompt_sync() {
        let mut gate = TerminalInputGate::default();

        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(
                &mut gate,
                &format!("\x15first line{TERMINAL_SHIFT_ENTER_SEQUENCE}second line"),
            ),
            None
        );
        assert_eq!(
            terminal_observe_input_gate_submitted_prompt(&mut gate, "\r"),
            Some("first line\nsecond line".to_string())
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
            "cli_hook_user_prompt_submit",
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
        assert!(terminal_prompt_submitted_source_is_authoritative(
            "todo_queue_backend_submit",
            true,
            None,
        ));
        assert!(!terminal_prompt_submitted_source_is_authoritative(
            "prompt_event_submit_metadata",
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

    fn terminal_projection_test_metadata() -> TerminalInstanceMetadata {
        TerminalInstanceMetadata {
            pane_id: "pane-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            workspace_name: "Workspace".to_string(),
            terminal_index: Some(0),
            thread_id: "thread-1".to_string(),
            agent_id: "codex".to_string(),
            agent_kind: "codex".to_string(),
            terminal_name: "Codex".to_string(),
            terminal_nickname: String::new(),
        }
    }

    fn terminal_activity_hook_test_payload(
        event_type: &str,
        activity_status: &str,
        command_phase: &str,
        input_ready: bool,
        provider_session_id: Option<&str>,
    ) -> TerminalActivityHookPayload {
        TerminalActivityHookPayload {
            pane_id: "pane-1".to_string(),
            instance_id: 1,
            workspace_id: "workspace-1".to_string(),
            workspace_name: "Workspace".to_string(),
            terminal_index: Some(0),
            thread_id: "thread-1".to_string(),
            agent_id: "opencode".to_string(),
            agent_kind: "opencode".to_string(),
            agent_type: String::new(),
            agent_display_name: String::new(),
            display_name: "OpenCode".to_string(),
            terminal_name: "OpenCode".to_string(),
            terminal_nickname: String::new(),
            provider: "opencode".to_string(),
            event_type: event_type.to_string(),
            hook_event_name: "Stop".to_string(),
            source: "cli-hook:provider-turn-completed".to_string(),
            status: "active".to_string(),
            activity_status: activity_status.to_string(),
            command_phase: command_phase.to_string(),
            execution_phase: if input_ready { "idle" } else { "running" }.to_string(),
            native_rail_state: if input_ready { "idle" } else { "thinking" }.to_string(),
            native_rail_label: if input_ready { "idle" } else { "thinking" }.to_string(),
            readiness: if input_ready { "ready" } else { "busy" }.to_string(),
            terminal_lifecycle: "open".to_string(),
            terminal_status: if input_ready { "idle" } else { "thinking" }.to_string(),
            terminal_work_state: if input_ready { "complete" } else { "running" }.to_string(),
            turn_status: if input_ready { "completed" } else { "running" }.to_string(),
            session_state: "session_attached".to_string(),
            input_ready,
            input_ready_at: input_ready.then(|| "2026-07-02T00:00:00Z".to_string()),
            prompt_ready_at: None,
            completed_at: input_ready.then(|| "2026-07-02T00:00:00Z".to_string()),
            provider_session_id: provider_session_id.map(str::to_string),
            native_session_id: provider_session_id.map(str::to_string),
            fork_from_provider_session_id: None,
            provider_turn_id: None,
            turn_id: None,
            transcript_path: None,
            cwd: None,
            user_message: None,
            message: None,
            live_text_delta: None,
            live_text_snapshot: None,
            live_text_kind: None,
            tool_name: None,
            tool_use_id: None,
            tool_server: None,
            tool_input: None,
            tool_output: None,
            tool_error: None,
            raw_tool_payload: None,
            command: None,
            file_path: None,
            duration_ms: None,
            exit_code: None,
            approval_id: None,
            permission_prompt_id: None,
            permission_request_id: None,
            permission_mode: None,
            prompt_id: None,
            prompt_kind: None,
            prompt_default_option: None,
            prompt_ttl_ms: None,
            prompt_options: Vec::new(),
            prompt_answer_option: None,
            manual_prompt_source: None,
            manual_approval_required: false,
            provider_blocked_for_user: false,
            terminal_is_prompting_user: false,
            prompting_user_kind: None,
            prompting_user_source: None,
            prompting_user_confidence: None,
            prompting_user_text: None,
            hook_health_status: "ok".to_string(),
            hook_health_event: "event_observed".to_string(),
            hook_health_observed_at_ms: 1,
            hook_timestamp_ms: 1,
            observed_at_ms: 1,
            completion_evidence: "test".to_string(),
        }
    }

    #[test]
    fn terminal_workspace_agent_session_status_preserves_prompt_wait() {
        let mut payload = terminal_activity_hook_test_payload(
            "provider-user-prompt-started",
            "paused",
            "awaiting_input",
            false,
            Some("session-a"),
        );
        payload.terminal_is_prompting_user = true;

        assert_eq!(
            terminal_workspace_agent_session_status_from_payload(&payload),
            "needs_input"
        );
    }

    #[test]
    fn terminal_projection_running_command_phase_overrides_stale_input_ready() {
        let runtime = TerminalRuntimeSnapshot {
            status: "active".to_string(),
            activity_status: "idle".to_string(),
            command_phase: "running".to_string(),
            input_ready: true,
            input_ready_at: Some("2026-06-19T00:00:00Z".to_string()),
            prompt_ready_at: None,
            completed_at: None,
            provider_session_id: None,
            native_session_id: None,
            fork_from_provider_session_id: None,
            provider_turn_id: Some("turn-1".to_string()),
            turn_id: Some("turn-1".to_string()),
            source: "test".to_string(),
            event_type: "message-submitted".to_string(),
            hook_event_name: "BackendPromptSubmit".to_string(),
            updated_at_ms: 1,
        };

        let projected =
            terminal_project_runtime(&terminal_projection_test_metadata(), &runtime, false);

        assert_eq!(projected.readiness, "busy");
        assert_eq!(projected.terminal_status, "thinking");
        assert_eq!(projected.terminal_work_state, "running");
        assert_eq!(projected.execution_phase, "running");
        assert_eq!(projected.native_rail_state, "thinking");
    }

    #[test]
    fn terminal_projection_idle_requires_ready_command_phase() {
        let runtime = TerminalRuntimeSnapshot::opened_idle(None);

        let projected =
            terminal_project_runtime(&terminal_projection_test_metadata(), &runtime, false);

        assert_eq!(projected.readiness, "ready");
        assert_eq!(projected.terminal_status, "idle");
        assert_eq!(projected.terminal_work_state, "complete");
        assert_eq!(projected.execution_phase, "idle");
        assert_eq!(projected.native_rail_state, "idle");
    }

    #[test]
    fn terminal_projection_preserves_starting_until_readiness_event() {
        let runtime = TerminalRuntimeSnapshot::opened_starting(None, "test");

        let projected =
            terminal_project_runtime(&terminal_projection_test_metadata(), &runtime, false);

        assert_eq!(projected.readiness, "busy");
        assert_eq!(projected.terminal_status, "starting");
        assert_eq!(projected.terminal_work_state, "running");
        assert_eq!(projected.execution_phase, "starting");
        assert_eq!(projected.native_rail_state, "starting");
    }

    #[test]
    fn terminal_prompt_ready_recovery_only_targets_busy_turns() {
        let mut runtime = TerminalRuntimeSnapshot {
            status: "active".to_string(),
            activity_status: "thinking".to_string(),
            command_phase: "running".to_string(),
            input_ready: false,
            input_ready_at: None,
            prompt_ready_at: Some("2026-06-19T00:00:00Z".to_string()),
            completed_at: None,
            provider_session_id: Some("session-1".to_string()),
            native_session_id: Some("session-1".to_string()),
            fork_from_provider_session_id: None,
            provider_turn_id: Some("turn-1".to_string()),
            turn_id: Some("turn-1".to_string()),
            source: "backend:prompt-submitted".to_string(),
            event_type: "provider-turn-started".to_string(),
            hook_event_name: "BackendPromptSubmit".to_string(),
            updated_at_ms: 1,
        };
        let codex_metadata = terminal_projection_test_metadata();
        let mut claude_metadata = codex_metadata.clone();
        claude_metadata.agent_id = "claude".to_string();
        claude_metadata.agent_kind = "claude".to_string();

        assert!(terminal_runtime_snapshot_is_busy_turn(&runtime));
        assert!(!terminal_prompt_ready_recovery_allowed(
            &codex_metadata,
            &runtime
        ));
        assert!(terminal_prompt_ready_recovery_allowed(
            &claude_metadata,
            &runtime
        ));

        runtime.status = "starting".to_string();
        runtime.activity_status = "starting".to_string();
        runtime.command_phase = "starting".to_string();
        assert!(terminal_prompt_ready_recovery_allowed(
            &claude_metadata,
            &runtime
        ));

        runtime.input_ready = true;
        runtime.activity_status = "idle".to_string();
        runtime.command_phase = "completed".to_string();
        assert!(!terminal_runtime_snapshot_is_busy_turn(&runtime));

        runtime.input_ready = false;
        runtime.activity_status = "paused".to_string();
        runtime.command_phase = "awaiting_permission".to_string();
        assert!(!terminal_runtime_snapshot_is_busy_turn(&runtime));

        runtime.activity_status = "error".to_string();
        runtime.command_phase = "failed".to_string();
        assert!(!terminal_runtime_snapshot_is_busy_turn(&runtime));
    }

    #[test]
    fn codex_busy_prompt_ready_recovery_is_blocked() {
        let runtime = TerminalRuntimeSnapshot {
            status: "active".to_string(),
            activity_status: "thinking".to_string(),
            command_phase: "running".to_string(),
            input_ready: false,
            input_ready_at: None,
            prompt_ready_at: None,
            completed_at: None,
            provider_session_id: Some("session-1".to_string()),
            native_session_id: Some("session-1".to_string()),
            fork_from_provider_session_id: None,
            provider_turn_id: Some("turn-1".to_string()),
            turn_id: Some("turn-1".to_string()),
            source: "cli-hook:provider-turn-started".to_string(),
            event_type: "provider-turn-started".to_string(),
            hook_event_name: "UserPromptSubmit".to_string(),
            updated_at_ms: 1,
        };
        let mut codex_metadata = terminal_projection_test_metadata();
        codex_metadata.agent_id = "codex".to_string();
        codex_metadata.agent_kind = "codex".to_string();
        let mut opencode_metadata = codex_metadata.clone();
        opencode_metadata.agent_id = "opencode".to_string();
        opencode_metadata.agent_kind = "opencode".to_string();

        assert!(terminal_runtime_snapshot_is_busy_turn(&runtime));
        assert!(!terminal_prompt_ready_recovery_allowed(
            &codex_metadata,
            &runtime
        ));
        assert!(terminal_prompt_ready_recovery_allowed(
            &opencode_metadata,
            &runtime
        ));
    }

    #[test]
    fn stray_startup_idle_is_ignored_during_busy_turns() {
        let startup_idle = json!({
            "hookEventName": "Stop",
            "startupIdleCandidate": true,
            "sessionIdleWithoutPrompt": true,
        });
        assert!(terminal_activity_hook_should_ignore_startup_idle_candidate(
            &startup_idle,
            false,
        ));
        assert!(!terminal_activity_hook_should_ignore_startup_idle_candidate(
            &startup_idle,
            true,
        ));
    }

    #[test]
    fn hook_idle_completion_is_quiesced_for_activity_hook_agents() {
        let mut opencode_metadata = terminal_projection_test_metadata();
        opencode_metadata.agent_id = "opencode".to_string();
        opencode_metadata.agent_kind = "opencode".to_string();
        let idle_payload = terminal_activity_hook_test_payload(
            "provider-turn-completed",
            "idle",
            "completed",
            true,
            Some("session-main"),
        );

        assert!(terminal_activity_hook_should_quiesce_idle(
            &opencode_metadata,
            &json!({ "hookEventName": "Stop" }),
            &idle_payload,
            false,
            true,
        ));
        assert!(!terminal_activity_hook_should_quiesce_idle(
            &opencode_metadata,
            &json!({
                "hookEventName": "Stop",
                "terminalIdleQuiesceBuffered": true,
            }),
            &idle_payload,
            false,
            true,
        ));
        assert!(!terminal_activity_hook_should_quiesce_idle(
            &opencode_metadata,
            &json!({
                "hookEventName": "Stop",
                "startupIdleCandidate": true,
            }),
            &idle_payload,
            false,
            true,
        ));
    }

    #[test]
    fn busy_runtime_rejects_idle_completion_from_different_session() {
        let runtime = TerminalRuntimeSnapshot {
            status: "active".to_string(),
            activity_status: "thinking".to_string(),
            command_phase: "running".to_string(),
            input_ready: false,
            input_ready_at: None,
            prompt_ready_at: None,
            completed_at: None,
            provider_session_id: Some("session-main".to_string()),
            native_session_id: Some("session-main".to_string()),
            fork_from_provider_session_id: None,
            provider_turn_id: Some("turn-1".to_string()),
            turn_id: Some("turn-1".to_string()),
            source: "cli-hook:provider-turn-started".to_string(),
            event_type: "provider-turn-started".to_string(),
            hook_event_name: "UserPromptSubmit".to_string(),
            updated_at_ms: 1,
        };
        let child_idle_payload = terminal_activity_hook_test_payload(
            "provider-turn-completed",
            "idle",
            "completed",
            true,
            Some("session-child"),
        );

        assert!(terminal_runtime_snapshot_is_busy_turn(&runtime));
        assert!(terminal_activity_hook_session_id_mismatches_busy_runtime(
            &child_idle_payload,
            &runtime,
            true,
        ));
        assert!(!terminal_activity_hook_session_id_mismatches_busy_runtime(
            &child_idle_payload,
            &runtime,
            false,
        ));
    }

    #[test]
    fn busy_runtime_rejects_idle_completion_without_session() {
        let runtime = TerminalRuntimeSnapshot {
            status: "active".to_string(),
            activity_status: "thinking".to_string(),
            command_phase: "running".to_string(),
            input_ready: false,
            input_ready_at: None,
            prompt_ready_at: None,
            completed_at: None,
            provider_session_id: Some("session-main".to_string()),
            native_session_id: Some("session-main".to_string()),
            fork_from_provider_session_id: None,
            provider_turn_id: Some("turn-1".to_string()),
            turn_id: Some("turn-1".to_string()),
            source: "cli-hook:provider-turn-started".to_string(),
            event_type: "provider-turn-started".to_string(),
            hook_event_name: "UserPromptSubmit".to_string(),
            updated_at_ms: 1,
        };
        let missing_session_idle_payload = terminal_activity_hook_test_payload(
            "provider-turn-completed",
            "idle",
            "completed",
            true,
            None,
        );

        assert!(terminal_activity_hook_session_id_mismatches_busy_runtime(
            &missing_session_idle_payload,
            &runtime,
            true,
        ));
    }

    #[test]
    fn same_turn_activity_matches_pending_final_stop() {
        let runtime = TerminalRuntimeSnapshot {
            status: "active".to_string(),
            activity_status: "thinking".to_string(),
            command_phase: "running".to_string(),
            input_ready: false,
            input_ready_at: None,
            prompt_ready_at: None,
            completed_at: None,
            provider_session_id: Some("session-main".to_string()),
            native_session_id: Some("session-main".to_string()),
            fork_from_provider_session_id: None,
            provider_turn_id: Some("turn-1".to_string()),
            turn_id: Some("turn-1".to_string()),
            source: "cli-hook:provider-turn-started".to_string(),
            event_type: "provider-turn-started".to_string(),
            hook_event_name: "UserPromptSubmit".to_string(),
            updated_at_ms: 1,
        };
        let candidate = PendingTerminalFinalStopCandidate {
            generation: 1,
            session_id: "session-main".to_string(),
            turn_id: "turn-1".to_string(),
            event: json!({}),
        };
        let mut tool_payload = terminal_activity_hook_test_payload(
            "provider-tool-completed",
            "thinking",
            "tool_completed",
            false,
            Some("session-main"),
        );
        tool_payload.hook_event_name = "PostToolUse".to_string();
        tool_payload.turn_id = Some("turn-1".to_string());
        tool_payload.provider_turn_id = Some("turn-1".to_string());

        assert!(terminal_pending_final_stop_activity_matches(
            &candidate,
            &runtime,
            &tool_payload,
        ));

        tool_payload.turn_id = Some("turn-2".to_string());
        tool_payload.provider_turn_id = Some("turn-2".to_string());
        assert!(!terminal_pending_final_stop_activity_matches(
            &candidate,
            &runtime,
            &tool_payload,
        ));
    }

    #[test]
    fn duplicate_idle_stop_is_ignored_after_settle() {
        let runtime = TerminalRuntimeSnapshot {
            status: "active".to_string(),
            activity_status: "idle".to_string(),
            command_phase: "completed".to_string(),
            input_ready: true,
            input_ready_at: Some("2026-07-02T00:00:00Z".to_string()),
            prompt_ready_at: None,
            completed_at: Some("2026-07-02T00:00:00Z".to_string()),
            provider_session_id: Some("session-main".to_string()),
            native_session_id: Some("session-main".to_string()),
            fork_from_provider_session_id: None,
            provider_turn_id: Some("turn-1".to_string()),
            turn_id: Some("turn-1".to_string()),
            source: "cli-hook:provider-turn-completed".to_string(),
            event_type: "provider-turn-completed".to_string(),
            hook_event_name: "Stop".to_string(),
            updated_at_ms: 1,
        };
        let mut duplicate = terminal_activity_hook_test_payload(
            "provider-turn-completed",
            "idle",
            "completed",
            true,
            Some("session-main"),
        );
        duplicate.turn_id = Some("turn-1".to_string());
        duplicate.provider_turn_id = Some("turn-1".to_string());

        assert!(terminal_activity_hook_idle_stop_already_settled(
            &duplicate,
            &runtime,
            false,
        ));
    }

    #[test]
    fn approval_prompt_fallback_matches_opencode_tui_choices() {
        let options = terminal_activity_hook_prompt_options_from_event(&json!({}), "permission");
        let ids = options
            .iter()
            .map(|option| option.id.as_str())
            .collect::<Vec<_>>();
        let labels = options
            .iter()
            .map(|option| option.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["allow_once", "allow_always", "reject"]);
        assert_eq!(labels, vec!["Allow once", "Allow always", "Reject"]);
    }

    #[test]
    fn manual_approval_prompt_default_uses_reject_not_stale_deny() {
        let prompt = terminal_activity_hook_manual_prompt(
            "PermissionAsked",
            &json!({
                "hookEventName": "PermissionAsked",
                "manualApprovalRequired": true,
                "permissionRequestId": "permission-1",
            }),
        )
        .expect("manual permission prompt");

        assert_eq!(prompt.default_option.as_deref(), Some("reject"));
        assert!(prompt.options.iter().any(|option| option.id == "reject"));
        assert!(!prompt.options.iter().any(|option| option.id == "deny"));
    }

    #[test]
    fn opencode_prompt_answer_uses_selection_navigation() {
        assert_eq!(
            terminal_agent_prompt_answer_input("opencode", "allow_once", "Allow once", None),
            "\r"
        );
        assert_eq!(
            terminal_agent_prompt_answer_input(
                "open-code",
                "allow_always",
                "Allow always",
                None
            ),
            "\x1b[C\r\r"
        );
        assert_eq!(
            terminal_agent_prompt_answer_input("opencode", "reject", "Reject", None),
            "\x1b[C\x1b[C\r"
        );
        assert_eq!(
            terminal_agent_prompt_answer_input("codex", "allow_once", "Allow once", None),
            "y\r"
        );
    }

    #[test]
    fn prompt_ready_marker_must_follow_working_indicator() {
        assert!(terminal_output_current_prompt_marker(
            "working (press esc to interrupt)\ncompleted\n> "
        ));
        assert!(!terminal_output_current_prompt_marker(
            "> \nworking (press esc to interrupt)"
        ));
    }

    #[test]
    fn claude_stop_background_metadata_blocks_ready_completion() {
        assert!(!terminal_activity_hook_claude_stop_has_background_work(&json!({
            "stopHookActive": true,
        })));
        assert!(terminal_activity_hook_claude_stop_has_background_work(&json!({
            "backgroundTasks": [{ "id": "task-1", "status": "running" }],
        })));
        assert!(terminal_activity_hook_claude_stop_has_background_work(&json!({
            "session_crons": [{ "id": "cron-1", "state": "queued" }],
        })));
        assert!(!terminal_activity_hook_claude_stop_has_background_work(&json!({
            "backgroundTasks": [{ "id": "task-1", "status": "completed" }],
            "session_crons": [{ "id": "cron-1", "state": "done" }],
        })));
        assert!(!terminal_activity_hook_claude_stop_has_background_work(&json!({
            "stopHookActive": false,
            "backgroundTasks": [],
            "sessionCrons": [],
        })));
    }

    #[test]
    fn provider_display_and_extended_tool_hooks_are_mapped() {
        assert_eq!(
            terminal_activity_hook_activity_kind("MessageDisplay", &json!({}))
                .map(|value| value.0),
            Some("provider-message-displayed")
        );
        assert_eq!(
            terminal_activity_hook_activity_kind("PreCompact", &json!({})).map(|value| value.0),
            Some("provider-turn-compacting")
        );
        assert_eq!(
            terminal_activity_hook_activity_kind("PostCompact", &json!({})).map(|value| value.0),
            Some("provider-turn-compacted")
        );
        assert_eq!(
            terminal_activity_hook_activity_kind("ThinkingDelta", &json!({})).map(|value| value.1),
            Some("reasoning")
        );
        assert_eq!(
            terminal_activity_hook_activity_kind("PostToolUseFailure", &json!({}))
                .map(|value| value.0),
            Some("provider-tool-failed")
        );
        assert!(terminal_activity_hook_non_lifecycle_is_expected("TaskCompleted"));
    }

    #[test]
    fn activity_hook_message_text_accepts_nested_delta_shapes() {
        let message = terminal_activity_hook_message_text(
            &json!({
                "delta": {"text": "streamed token"},
            }),
            &["assistantMessage", "delta"],
        );
        assert_eq!(message.as_deref(), Some("streamed token"));
    }

    #[test]
    fn live_text_sanitizer_drops_codex_tui_chrome() {
        let tui = "\u{1b}[44;3H\u{1b}[2mWorking\u{1b}[22m\
 \u{1b}[2m(51s • esc to interrupt)\u{1b}[39m\
\u{1b}[47;1H\u{1b}[1m›\u{1b}[47;3H\u{1b}[22mRun /review on my current changes\
\u{1b}[49;3H\u{1b}[38;2;246;226;183;49mgpt-5.5 xhigh\u{1b}[39;49m · \
\u{1b}[38;2;171;223;167;49m~/Documents/CODING/testforge\u{1b}[39m";

        assert_eq!(terminal_activity_hook_live_message_text(tui), None);
        assert_eq!(
            terminal_activity_hook_activity_message_text(tui).as_deref(),
            Some("Working")
        );
    }

    #[test]
    fn live_text_sanitizer_keeps_prose_without_footer() {
        let tui = "I’ll inspect the hook path first.\n\
\u{1b}[49;3H\u{1b}[38;2;246;226;183;49mgpt-5.5 xhigh\u{1b}[39;49m · \
\u{1b}[38;2;171;223;167;49m~/Documents/CODING/testforge\u{1b}[39m";

        assert_eq!(
            terminal_activity_hook_live_message_text(tui).as_deref(),
            Some("I’ll inspect the hook path first.")
        );
    }

    #[test]
    fn live_text_sanitizer_keeps_prompt_prefixed_prose_without_tui_context() {
        assert_eq!(
            terminal_activity_hook_live_message_text("›-prefixed prose should stay").as_deref(),
            Some("›-prefixed prose should stay")
        );
    }

    #[test]
    fn live_text_sanitizer_keeps_working_parenthetical_prose() {
        assert_eq!(
            terminal_activity_hook_live_message_text("Working (through the parser case) is content.")
                .as_deref(),
            Some("Working (through the parser case) is content.")
        );
    }

    #[test]
    fn structured_live_text_preserves_markdown_table_spacing() {
        let table = "| Component | Name |\n| --- | --- |\n|  R1  | 1kΩ |";
        assert_eq!(
            terminal_activity_hook_structured_live_message_text(table).as_deref(),
            Some(table)
        );
        assert_eq!(
            terminal_activity_hook_lossless_message_text(
                &json!({ "assistant_message_snapshot": table }),
                &["assistant_message_snapshot"],
            )
            .as_deref(),
            Some(table)
        );
    }

    #[test]
    fn activity_hook_provider_session_id_accepts_provider_aliases() {
        assert_eq!(
            terminal_activity_hook_provider_session_id(&json!({
                "providerSessionId": "codex-session-123",
            }))
            .as_deref(),
            Some("codex-session-123")
        );
        assert_eq!(
            terminal_activity_hook_provider_session_id(&json!({
                "native_session_id": "claude-session-456",
            }))
            .as_deref(),
            Some("claude-session-456")
        );
        assert_eq!(
            terminal_activity_hook_provider_session_id(&json!({
                "threadId": "workspace-thread-not-provider-session",
            })),
            None
        );
    }

    #[test]
    fn prompt_submit_hook_aliases_are_shared_by_lifecycle_and_direct_capture() {
        for hook_name in [
            "UserPromptSubmit",
            "UserPromptSubmitted",
            "PromptSubmit",
            "PromptSubmitted",
        ] {
            assert!(terminal_activity_hook_is_prompt_submit(hook_name));
            assert!(terminal_activity_hook_lifecycle_kind(hook_name).is_some());
        }

        assert!(!terminal_activity_hook_is_prompt_submit("Stop"));
    }

    #[test]
    fn prompt_fallback_event_id_is_non_empty_and_prompt_stable() {
        let first = terminal_prompt_fallback_event_id("pane/one", 7, 42, "build the pcb");
        let second = terminal_prompt_fallback_event_id("pane/one", 7, 42, "build the pcb");
        let different_prompt = terminal_prompt_fallback_event_id("pane/one", 7, 42, "route traces");

        assert!(first.starts_with("terminal-prompt:pane-one:7:42:"));
        assert_eq!(first, second);
        assert_ne!(first, different_prompt);
    }

    #[test]
    fn empty_gate_prompt_metadata_diagnostic_allows_known_local_submit_sources() {
        assert!(
            terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(Some(
                "tui-terminal-direct-input"
            ),)
        );
        assert!(
            terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(Some(
                "terminal-direct-input"
            ),)
        );
        assert!(
            terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(Some(
                "tui-manual-input"
            ),)
        );
        assert!(
            terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(Some(
                "tui-manual-input:terminal-screen-reconciled"
            ),)
        );
        assert!(
            terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(Some(
                "observed_terminal_prompt"
            ),)
        );
        assert!(
            terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(Some(
                "terminal-prompt-submitted"
            ),)
        );
        assert!(
            terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(Some(
                "terminal-view-drop"
            ),)
        );
        assert!(
            terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(Some(
                "todo-auto-queue"
            ),)
        );
        assert!(
            terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(Some(
                "voice-agent-queue"
            ),)
        );
        assert!(
            terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(Some(
                "voice-plan-queue"
            ),)
        );
        assert!(
            terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(Some(
                "remote-control"
            ),)
        );

        assert!(
            !terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(Some(
                "pending-prompt"
            ),)
        );
        assert!(!terminal_prompt_event_source_allows_empty_gate_metadata_diagnostic(None));
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
            terminal_activity_hook_lifecycle_kind("StopFailure"),
            Some(("provider-turn-error", "error", "error", "failed", true))
        );
        assert_eq!(
            terminal_activity_hook_activity_kind("PermissionRequest", &json!({})),
            Some((
                "provider-permission-requested",
                "paused",
                "active",
                "awaiting_permission",
                false,
                "cli_hook_permission_request"
            ))
        );
    }

    #[test]
    fn direct_prompt_registry_captures_once_per_pane_and_prompt() {
        let pane = format!("test-pane-{}", current_time_ms());

        // First observer wins; the echo (hook after gate, or gate after hook)
        // is suppressed.
        assert!(terminal_direct_prompt_should_capture(
            &pane,
            "fix the login bug"
        ));
        assert!(!terminal_direct_prompt_should_capture(
            &pane,
            "fix the login bug"
        ));
        assert!(terminal_direct_prompt_recently_seen(
            &pane,
            "  fix   the login bug "
        ));

        // A different prompt on the same pane still captures.
        assert!(terminal_direct_prompt_should_capture(
            &pane,
            "now run the tests"
        ));

        // Queue-dispatched prompts mark the registry up front so the
        // UserPromptSubmit hook echo never creates a duplicate todo.
        let queue_pane = format!("{pane}-queue");
        terminal_direct_prompt_mark_seen(&queue_pane, "queued todo prompt");
        assert!(terminal_direct_prompt_recently_seen(
            &queue_pane,
            "queued todo prompt"
        ));
        assert!(!terminal_direct_prompt_should_capture(
            &queue_pane,
            "queued todo prompt"
        ));

        // Other panes are independent.
        let other_pane = format!("{pane}-other");
        assert!(!terminal_direct_prompt_recently_seen(
            &other_pane,
            "fix the login bug"
        ));
        assert_eq!(
            terminal_activity_hook_lifecycle_kind("Interrupt"),
            Some((
                "provider-turn-interrupted",
                "interrupted",
                "active",
                "interrupted",
                true
            ))
        );
    }

    #[test]
    fn synthetic_direct_todo_refs_are_recognized() {
        // The typed-prompt bridge: all three refs from the webview's
        // terminal-direct family resolve to the synthetic item id.
        assert_eq!(
            terminal_prompt_synthetic_direct_todo_id(
                Some("terminal-direct-terminal-prompt-abc123"),
                Some("terminal-direct-dispatch-terminal-prompt-abc123"),
                Some("terminal-direct-command-terminal-prompt-abc123"),
            ),
            Some("terminal-direct-terminal-prompt-abc123".to_string())
        );
        // Dispatch/command refs are optional but must stay in the family.
        assert_eq!(
            terminal_prompt_synthetic_direct_todo_id(
                Some("terminal-direct-terminal-prompt-abc123"),
                None,
                None,
            ),
            Some("terminal-direct-terminal-prompt-abc123".to_string())
        );
        // A real queue dispatch keeps suppressing the capture.
        assert_eq!(
            terminal_prompt_synthetic_direct_todo_id(Some("todo-42"), None, None),
            None
        );
        // A requeued terminal-direct todo dispatched through the queue
        // carries queue-family dispatch ids — not a synthetic submission.
        assert_eq!(
            terminal_prompt_synthetic_direct_todo_id(
                Some("terminal-direct-terminal-prompt-abc123"),
                Some("dispatch-9f3a"),
                None,
            ),
            None
        );
        // Dispatch/command ids passed in the todo id slot never match.
        assert_eq!(
            terminal_prompt_synthetic_direct_todo_id(
                Some("terminal-direct-dispatch-terminal-prompt-abc123"),
                None,
                None,
            ),
            None
        );
        assert_eq!(
            terminal_prompt_synthetic_direct_todo_id(None, None, None),
            None
        );
    }

    #[test]
    fn activity_hook_kind_mappings_cover_tools_and_subagents() {
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

        assert!(terminal_activity_hook_manual_prompt(
            "PreToolUse",
            &json!({
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
                "toolUseId": "tool-auto",
                "promptingUserKind": "approval"
            }),
        )
        .is_none());
        assert!(terminal_activity_hook_manual_prompt(
            "PreToolUse",
            &json!({
                "hookEventName": "PreToolUse",
                "toolUseId": "tool-observed"
            }),
        )
        .is_none());
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
    fn enhanced_enter_sequence_is_preserved_before_pty_write() {
        assert_eq!(
            normalize_terminal_enter_sequences_for_pty(format!(
                "send from overlay{TERMINAL_ENTER_SEQUENCE}"
            )),
            format!("send from overlay{TERMINAL_ENTER_SEQUENCE}")
        );
        assert_eq!(
            normalize_terminal_enter_sequences_for_pty(format!(
                "send from overlay{TERMINAL_ENTER_SEQUENCE_MOD1}"
            )),
            format!("send from overlay{TERMINAL_ENTER_SEQUENCE_MOD1}")
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
            None,
            "pane-auto",
            42,
            None,
        );

        assert!(args
            .windows(2)
            .any(|pair| pair == ["--ask-for-approval", "never"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--profile", "diffforge-test-profile"]));
        assert!(args.windows(2).any(|pair| pair == ["--disable", "apps"]));
        assert!(args.windows(2).any(|pair| pair == ["--enable", "hooks"]));
        assert!(!args
            .iter()
            .any(|arg| arg == "--dangerously-bypass-hook-trust"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "workspace-write"]));
        assert!(!args.iter().any(|arg| arg == "--cd"));
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
        assert!(args
            .iter()
            .any(|arg| { arg.starts_with("mcp_servers.workspace-mcp-gateway.command=") }));
        assert!(args
            .iter()
            .any(|arg| { arg.starts_with("mcp_servers.workspace-mcp-gateway.args=") }));
        assert!(args
            .iter()
            .any(|arg| { arg.contains("--workspace-mcp-gateway") }));
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
        assert!(!args
            .iter()
            .any(|arg| { arg.starts_with("mcp_servers.cloud-diffforge.args=") }));
        assert!(!args
            .iter()
            .any(|arg| arg.starts_with("mcp_servers.codex_apps.")));
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
            None,
            "pane-auto",
            42,
            None,
        );

        assert!(args
            .iter()
            .any(|arg| arg == "--dangerously-bypass-hook-trust"));
    }

    #[test]
    fn coordinated_codex_activity_hook_profile_refresh_scopes_commands() {
        let mut coordination = terminal_test_coordination("codex_hook_profile_scope");
        let home = terminal_test_directory("codex_hook_profile_home");
        let profile = "diffforge-test-profile";
        // Codex only loads hooks from the home-level hooks.json.
        let hooks_path = home.join("hooks.json");
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
        assert!(hooks.contains("PreToolUse"));
        assert!(hooks.contains("PostToolUse"));
        assert!(hooks.contains("PermissionRequest"));
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
        assert!(!hooks.contains("--diff-forge-write-guard"));
        // One scoped command per ensured activity-hook event.
        assert_eq!(hooks.matches("--pane-id").count(), 17);
        let profile_config = fs::read_to_string(&profile_path).unwrap();
        assert!(profile_config.contains("[[hooks.UserPromptSubmit]]"));
        assert!(profile_config.contains("[[hooks.Stop]]"));
        assert!(profile_config.contains("[[hooks.PreToolUse]]"));
        assert!(profile_config.contains("[[hooks.PostToolUse]]"));
        assert!(profile_config.contains("[[hooks.PermissionRequest]]"));
        assert!(profile_config.contains("[[hooks.SubagentStart]]"));
        assert!(profile_config.contains("[[hooks.SubagentStop]]"));
        assert!(profile_config.contains("--diff-forge-activity-hook"));
        assert!(profile_config.contains("--pane-id"));
        assert!(profile_config.contains("workspace-terminal/workspace-1-0-codex"));
        assert!(profile_config.contains("--debug-path"));
        assert!(!profile_config.contains("--diff-forge-write-guard"));
        assert!(!profile_config.contains("hooksPath ="));
    }

    #[test]
    fn coordinated_codex_activity_hook_profile_refresh_creates_missing_hooks_file() {
        let mut coordination = terminal_test_coordination("codex_hook_profile_create");
        let home = terminal_test_directory("codex_hook_profile_create_home");
        let profile = "diffforge-test-profile";
        // Codex only loads hooks from the home-level hooks.json.
        let hooks_path = home.join("hooks.json");
        let profile_path = home.join(format!("{profile}.config.toml"));
        fs::create_dir_all(&home).unwrap();
        fs::write(
            &profile_path,
            "default_permissions = \"diffforge-coordinated\"\n",
        )
        .unwrap();
        coordination.env_vars.push((
            "DIFFFORGE_CODEX_HOME".to_string(),
            home.to_string_lossy().to_string(),
        ));
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
        assert!(hooks.contains("UserPromptSubmit"));
        assert!(hooks.contains("--diff-forge-activity-hook"));
        let profile_config = fs::read_to_string(&profile_path).unwrap();
        assert!(profile_config.contains("[[hooks.UserPromptSubmit]]"));
        assert!(profile_config.contains("--diff-forge-activity-hook"));
    }

    #[test]
    fn coordinated_codex_launch_has_no_global_plugin_disable_shims() {
        let coordination = terminal_test_coordination("codex_no_global_plugin_shims");
        let args = terminal_args_with_codex_mcp_identity(
            "codex",
            &["--model".to_string(), "gpt-5.2".to_string()],
            Some(&coordination),
            None,
            "pane-auto",
            42,
            None,
        );

        assert!(args.windows(2).any(|pair| pair == ["--disable", "apps"]));
        assert!(!args.iter().any(|arg| arg.starts_with("plugins.")));
        assert!(!args.iter().any(|arg| arg.contains("computer-use")));
        assert!(!args
            .iter()
            .any(|arg| arg.contains("browser@openai-bundled")));
        assert!(!args.iter().any(|arg| arg.contains("codex_apps")));
        assert!(args
            .iter()
            .any(|arg| arg.starts_with("mcp_servers.coordination-kernel.")));
        assert!(args
            .iter()
            .any(|arg| arg.starts_with("mcp_servers.workspace-mcp-gateway.")));
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
            None,
            "pane-auto",
            42,
            None,
        );

        assert!(args
            .windows(2)
            .any(|pair| pair == ["--add-dir", coordination.repo_path.as_str()]));
        assert!(!args
            .windows(2)
            .any(|pair| pair == ["--add-dir", worktree_path.as_str()]));
        assert!(!args
            .windows(2)
            .any(|pair| pair == ["--add-dir", "/tmp/repo-root-override"]));
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
        assert!(allowed_tools
            .split(',')
            .any(|allowed| allowed == format!("Edit({}/**)", coordination.repo_path)));
        assert!(allowed_tools
            .split(',')
            .any(|allowed| allowed == format!("Write({}/**)", coordination.repo_path)));
        assert!(allowed_tools
            .split(',')
            .any(|allowed| allowed == format!("NotebookEdit({}/**)", coordination.repo_path)));
        assert!(!allowed_tools.split(',').any(|allowed| allowed == "Bash"));
        assert!(!allowed_tools.split(',').any(|allowed| allowed == "Write"));
        let mcp_config = args
            .windows(2)
            .find_map(|pair| (pair[0] == "--mcp-config").then(|| pair[1].as_str()))
            .unwrap();
        assert_eq!(mcp_config, claude_config_path);
        assert!(!args
            .windows(2)
            .any(|pair| pair == ["--mcp-config", "/tmp/unsafe-claude-mcp.json"]));
        assert!(args.iter().any(|arg| arg == "--strict-mcp-config"));
        assert!(!mcp_config.contains("\"coordination-kernel\""));
        assert!(!mcp_config.contains("terminal_launch_args"));
        assert!(!args
            .iter()
            .any(|arg| arg == "--dangerously-skip-permissions"));
        assert!(!args
            .iter()
            .any(|arg| arg == "--allow-dangerously-skip-permissions"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "acceptEdits"]));
        assert!(!args
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "bypassPermissions"]));
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
        assert!(settings["hooks"]["PreToolUse"]
            .as_array()
            .unwrap()
            .iter()
            .any(|hook| hook["hooks"]
                .as_array()
                .is_some_and(|hooks| !hooks.is_empty())));
        assert_eq!(settings["sandbox"]["enabled"].as_bool(), Some(true));
        assert_eq!(
            settings["sandbox"]["allowUnsandboxedCommands"].as_bool(),
            Some(true)
        );
        assert_eq!(
            settings["sandbox"]["filesystem"]["allowWrite"][0].as_str(),
            Some(coordination.repo_path.as_str())
        );
        let hook_commands = settings["hooks"]["PreToolUse"]
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
            .collect::<Vec<_>>();
        assert!(hook_commands
            .iter()
            .any(|command| command.contains("--diff-forge-activity-hook")));
        assert!(!hook_commands
            .iter()
            .any(|command| command.contains("--diff-forge-write-guard")));
        assert!(!hook_commands
            .iter()
            .any(|command| command.contains("--claude-worktree-guard")));
        assert!(!args.iter().any(|arg| arg == "--no-alt-screen"));
    }

    #[test]
    fn coordinated_claude_direct_edit_scopes_edits_to_workspace() {
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
            None,
            "pane-direct",
            43,
            None,
        );

        assert!(args
            .windows(2)
            .any(|pair| pair == ["--add-dir", direct_root_text.as_str()]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "acceptEdits"]));
        assert!(!args
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "bypassPermissions"]));
        let settings_arg = args
            .windows(2)
            .find_map(|pair| (pair[0] == "--settings").then(|| pair[1].as_str()))
            .unwrap();
        let settings: Value = serde_json::from_str(settings_arg).unwrap();
        assert!(settings["hooks"]["PreToolUse"]
            .as_array()
            .unwrap()
            .iter()
            .any(|hook| hook["hooks"]
                .as_array()
                .is_some_and(|hooks| !hooks.is_empty())));
        assert_eq!(
            settings["sandbox"]["filesystem"]["allowWrite"][0].as_str(),
            Some(direct_root_text.as_str())
        );
        assert!(!settings_arg.contains("--diff-forge-write-guard"));
        let allowed_tools = args
            .windows(2)
            .find_map(|pair| {
                (pair[0] == "--allowedTools" || pair[0] == "--allowed-tools")
                    .then(|| pair[1].as_str())
            })
            .unwrap();
        assert!(allowed_tools
            .split(',')
            .any(|allowed| allowed == format!("Edit({direct_root_text}/**)")));
        assert!(allowed_tools
            .split(',')
            .any(|allowed| allowed == format!("Write({direct_root_text}/**)")));
        assert!(allowed_tools
            .split(',')
            .any(|allowed| allowed == format!("NotebookEdit({direct_root_text}/**)")));
        assert!(!allowed_tools.split(',').any(|allowed| allowed == "Bash"));
    }

    #[test]
    fn coordinated_claude_general_worker_scopes_edits_to_workspace() {
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
            None,
            "pane-general",
            44,
            None,
        );

        assert!(args
            .windows(2)
            .any(|pair| pair == ["--add-dir", repo_text.as_str()]));
        assert!(!args
            .windows(2)
            .any(|pair| pair[0] == "--add-dir" && pair[1].contains(".agents/worktrees/1")));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "acceptEdits"]));
        assert!(!args
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "bypassPermissions"]));
        let settings_arg = args
            .windows(2)
            .find_map(|pair| (pair[0] == "--settings").then(|| pair[1].as_str()))
            .unwrap();
        assert!(!settings_arg.contains("--diff-forge-write-guard"));
        let settings: Value = serde_json::from_str(settings_arg).unwrap();
        assert_eq!(
            settings["sandbox"]["filesystem"]["allowWrite"][0].as_str(),
            Some(repo_text.as_str())
        );
        let allowed_tools = args
            .windows(2)
            .find_map(|pair| {
                (pair[0] == "--allowedTools" || pair[0] == "--allowed-tools")
                    .then(|| pair[1].as_str())
            })
            .unwrap();
        assert!(allowed_tools
            .split(',')
            .any(|allowed| allowed == format!("Edit({repo_text}/**)")));
        assert!(allowed_tools
            .split(',')
            .any(|allowed| allowed == format!("Write({repo_text}/**)")));
        assert!(allowed_tools
            .split(',')
            .any(|allowed| allowed == format!("NotebookEdit({repo_text}/**)")));
    }

    #[test]
    fn claude_worktree_guard_allows_root_file_edit() {
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
            claude_worktree_guard_denial_reason(&hook_input, &repo, &worktree, "1", &identity);

        assert!(reason.is_none());
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
    fn claude_worktree_guard_allows_assigned_worktree_edit_without_task() {
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
        );

        assert!(reason.is_none());
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
    fn claude_worktree_guard_allows_other_slot_worktree_edit() {
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
            claude_worktree_guard_denial_reason(&hook_input, &repo, &worktree, "1", &identity);

        assert!(reason.is_none());
    }

    #[test]
    fn claude_worktree_guard_allows_unsandboxed_shell_escape() {
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
        );

        assert!(reason.is_none());
    }

    #[test]
    fn claude_worktree_guard_allows_mutating_shell_without_lease() {
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
            claude_worktree_guard_denial_reason(&hook_input, &repo, &worktree, "1", &identity);

        assert!(reason.is_none());
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
    fn diff_forge_apply_patch_guard_allows_git_root_paths() {
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
    fn diff_forge_apply_patch_guard_allows_visible_root_relative_paths() {
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
    fn diff_forge_write_guard_allows_shell_apply_patch_in_git_root() {
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
    fn diff_forge_write_guard_allows_late_git_direct_session_with_active_lease() {
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
            Some("bounded_direct_edit")
        );
        assert!(session["worktree_id"].as_str().is_none());
        let write_root = PathBuf::from(session["write_root"].as_str().unwrap_or_default())
            .canonicalize()
            .unwrap();
        assert_eq!(write_root, repo.canonicalize().unwrap());
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
                "command": "mkdir -p \"$DIFFFORGE_ARCHITECTURE_GRAPHS_ROOT\" && printf 'title \"Auth\"\\n' > \"$DIFFFORGE_ARCHITECTURE_GRAPHS_ROOT/auth.arch\""
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
    fn diff_forge_write_guard_allows_real_git_root_edit_with_worktree_path() {
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

        let decision = diff_forge_write_guard_decision(
            "claude",
            &hook_input,
            &repo,
            "slot1",
            "claude",
            &DiffForgeWriteGuardIdentity::default(),
        )
        .unwrap();

        assert!(decision.is_none());
    }

    #[test]
    fn diff_forge_write_guard_allows_worktree_edit_without_active_lease() {
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
    fn diff_forge_write_guard_allows_real_git_root_edit_with_active_task_route() {
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

        let decision = diff_forge_write_guard_decision(
            "claude",
            &hook_input,
            &repo,
            "slot1",
            "claude",
            &identity,
        )
        .unwrap();

        assert!(decision.is_none());
    }

    #[test]
    fn diff_forge_write_guard_allows_nested_git_edit_from_direct_container() {
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
    fn diff_forge_write_guard_allows_nested_git_inside_outer_slot_without_child_task() {
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

        let route = diff_forge_git_write_route(
            &repo.join("pricing.html"),
            "slot1",
            "codex",
            &identity,
            true,
        )
        .unwrap();

        assert!(route.is_none());
    }

    #[test]
    fn diff_forge_write_guard_allows_mutating_shell_in_git_root() {
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
    fn diff_forge_write_guard_allows_mutating_shell_in_worktree_without_lease() {
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
            None,
            "pane-auto",
            42,
            None,
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
            None,
            "pane-auto",
            42,
            None,
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
            None,
            "pane-auto",
            42,
            None,
        );

        assert!(!args.windows(2).any(|pair| pair == ["--enable", "apps"]));
        assert_eq!(
            args.windows(2)
                .filter(|pair| pair[0] == "--disable" && pair[1] == "apps")
                .count(),
            1
        );
        assert!(!args
            .iter()
            .any(|arg| arg.starts_with("mcp_servers.codex_apps.")));
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

        assert!(env_vars
            .iter()
            .any(|(key, value)| key == "COORDINATION_ENABLED" && value == "1"));
        assert!(env_vars
            .iter()
            .any(|(key, value)| key == "DIFFFORGE_MANAGED_AGENT_TERMINAL" && value == "1"));
        assert!(env_vars
            .iter()
            .any(|(key, value)| key == "DIFFFORGE_CODEX_UPDATE_CHECK_DISABLED" && value == "1"));
        assert!(!env_vars
            .iter()
            .any(|(key, _)| key == OPENCODE_TUI_CONFIG_ENV));
    }

    #[test]
    fn opencode_coordination_config_registers_activity_plugin() {
        let env_vars = terminal_env_vars_with_opencode_coordination_config("opencode", &[], None, None)
            .expect("opencode config injection should succeed");

        // The activity-hook binary must be advertised to the plugin.
        assert!(env_vars
            .iter()
            .any(|(key, value)| key == "DIFFFORGE_OPENCODE_ACTIVITY_HOOK_BIN" && !value.is_empty()));

        let config_text = env_vars
            .iter()
            .rev()
            .find_map(|(key, value)| (key == "OPENCODE_CONFIG_CONTENT").then_some(value))
            .expect("inline opencode config should be set");
        let config: Value = serde_json::from_str(config_text).unwrap();

        // The generated plugin file is registered and exists on disk.
        let plugins = config["plugin"].as_array().expect("plugin array present");
        let plugin_path = plugins
            .iter()
            .find_map(|value| value.as_str())
            .expect("plugin path registered");
        assert!(plugin_path.ends_with("diffforge-activity-plugin.js"));
        let plugin_body = fs::read_to_string(plugin_path).expect("plugin file written");
        assert!(plugin_body.contains("--diff-forge-activity-hook"));
        assert!(plugin_body.contains("session.idle"));
        assert!(plugin_body.contains("[\"allow_always\", \"Allow always\"]"));
        assert!(plugin_body.contains("[\"reject\", \"Reject\"]"));

        // Without coordination there is no MCP block or permission override.
        assert!(config.get("mcp").is_none());
        assert!(config.get("permission").is_none());
    }

    #[test]
    fn non_opencode_coordination_config_is_untouched() {
        let env_vars = terminal_env_vars_with_opencode_coordination_config(
            "claude",
            &[("COORDINATION_ENABLED".to_string(), "1".to_string())],
            None,
            None,
        )
        .unwrap();
        assert_eq!(env_vars.len(), 1);
        assert!(!env_vars
            .iter()
            .any(|(key, _)| key == "OPENCODE_CONFIG_CONTENT"
                || key == "DIFFFORGE_OPENCODE_ACTIVITY_HOOK_BIN"));
    }

    #[test]
    fn claude_launch_env_disables_background_autoupdater() {
        let env_vars = terminal_env_vars_with_opencode_tui_config("claude", &[]).unwrap();

        assert!(env_vars
            .iter()
            .any(|(key, value)| key == "DIFFFORGE_MANAGED_AGENT_TERMINAL" && value == "1"));
        assert!(env_vars
            .iter()
            .any(|(key, value)| key == "DISABLE_AUTOUPDATER" && value == "1"));
        assert!(!env_vars
            .iter()
            .any(|(key, _)| key == OPENCODE_TUI_CONFIG_ENV));
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
            None,
            "pane-auto",
            42,
            None,
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
        assert_eq!(args.iter().filter(|arg| arg.as_str() == "--cd").count(), 0);
        assert_eq!(
            args.iter()
                .filter(|arg| arg.as_str() == "--profile")
                .count(),
            1
        );
        assert!(!args
            .iter()
            .any(|arg| arg == "--dangerously-bypass-approvals-and-sandbox"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--ask-for-approval", "never"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--profile", "diffforge-test-profile"]));
        assert!(args.windows(2).any(|pair| pair == ["--enable", "hooks"]));
        assert!(!args
            .iter()
            .any(|arg| arg == "--dangerously-bypass-hook-trust"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "workspace-write"]));
        assert!(!args
            .windows(2)
            .any(|pair| pair == ["--cd", "/tmp/custom-cwd"]));
    }

    #[test]
    fn coordinated_codex_activity_launch_uses_workspace_write_access() {
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
            None,
            "pane-activity",
            7,
            None,
        );

        assert!(args
            .windows(2)
            .any(|pair| pair == ["--ask-for-approval", "never"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--profile", "diffforge-activity-profile"]));
        assert!(args.windows(2).any(|pair| pair == ["--enable", "hooks"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "workspace-write"]));
    }

    #[test]
    fn coordinated_codex_permission_modes_map_to_launch_flags() {
        let coordination = terminal_test_coordination("codex_permission_modes");
        let launch_args = |mode: Option<&str>| {
            terminal_args_with_codex_mcp_identity(
                "codex",
                &[
                    "--ask-for-approval".to_string(),
                    "on-request".to_string(),
                    "--sandbox".to_string(),
                    "read-only".to_string(),
                    "--dangerously-bypass-approvals-and-sandbox".to_string(),
                ],
                Some(&coordination),
                mode,
                "pane-permissions",
                11,
                None,
            )
        };

        let plan_args = launch_args(Some("plan"));
        assert!(plan_args
            .windows(2)
            .any(|pair| pair == ["--ask-for-approval", "never"]));
        assert!(plan_args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "read-only"]));
        assert!(!plan_args
            .iter()
            .any(|arg| arg == "--dangerously-bypass-approvals-and-sandbox"));

        let ask_args = launch_args(Some("ask"));
        assert!(ask_args
            .windows(2)
            .any(|pair| pair == ["--ask-for-approval", "on-request"]));
        assert!(ask_args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "workspace-write"]));

        let bypass_args = launch_args(Some("bypass"));
        assert!(bypass_args
            .iter()
            .any(|arg| arg == "--dangerously-bypass-approvals-and-sandbox"));
        assert!(!bypass_args
            .iter()
            .any(|arg| arg == "--ask-for-approval" || arg == "--sandbox"));
    }

    #[test]
    fn coordinated_claude_permission_modes_scope_workspace_authority() {
        let coordination = terminal_test_coordination("claude_permission_modes");
        let launch_args = |mode: Option<&str>| {
            terminal_args_with_codex_mcp_identity(
                "claude",
                &[
                    "--allowedTools".to_string(),
                    "Write,Bash".to_string(),
                    "--permission-mode".to_string(),
                    "bypassPermissions".to_string(),
                ],
                Some(&coordination),
                mode,
                "pane-permissions",
                12,
                None,
            )
        };

        let workspace_glob = format!("{}/**", coordination.repo_path);
        let plan_args = launch_args(Some("plan"));
        let plan_tools = plan_args
            .windows(2)
            .find_map(|pair| (pair[0] == "--allowedTools").then_some(pair[1].as_str()))
            .unwrap();
        assert!(plan_args
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "plan"]));
        assert!(!plan_tools.contains("Write("));
        let plan_settings: Value = serde_json::from_str(
            plan_args
                .windows(2)
                .find_map(|pair| (pair[0] == "--settings").then_some(pair[1].as_str()))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(plan_settings["permissions"]["allow"].as_array().unwrap().len(), 0);
        assert_eq!(
            plan_settings["sandbox"]["filesystem"]["allowWrite"]
                .as_array()
                .unwrap()
                .len(),
            0
        );

        let accept_args = launch_args(Some("accept_edits"));
        let accept_tools = accept_args
            .windows(2)
            .find_map(|pair| (pair[0] == "--allowedTools").then_some(pair[1].as_str()))
            .unwrap();
        assert!(accept_args
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "acceptEdits"]));
        assert!(accept_tools.contains(&format!("Write({workspace_glob})")));
        assert!(accept_tools.contains(&format!("Edit({workspace_glob})")));

        let bypass_args = launch_args(Some("bypass"));
        assert!(bypass_args
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "bypassPermissions"]));
        assert!(!bypass_args.iter().any(|arg| arg == "--allowedTools"));
        let bypass_settings: Value = serde_json::from_str(
            bypass_args
                .windows(2)
                .find_map(|pair| (pair[0] == "--settings").then_some(pair[1].as_str()))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            bypass_settings["disableBypassPermissionsMode"].as_str(),
            Some("allow")
        );
    }

    #[test]
    fn coordinated_opencode_permission_modes_map_to_inline_config() {
        let coordination = terminal_test_coordination("opencode_permission_modes");
        let permission_for = |mode: Option<&str>| -> Value {
            let env_vars =
                terminal_env_vars_with_opencode_coordination_config("opencode", &[], Some(&coordination), mode)
                    .expect("opencode coordination config should be generated");
            let config_text = env_vars
                .iter()
                .rev()
                .find_map(|(key, value)| (key == "OPENCODE_CONFIG_CONTENT").then_some(value))
                .expect("inline opencode config should be set");
            serde_json::from_str::<Value>(config_text).unwrap()["permission"].clone()
        };

        assert_eq!(permission_for(Some("plan"))["edit"].as_str(), Some("deny"));
        assert_eq!(permission_for(Some("plan"))["bash"].as_str(), Some("deny"));
        assert_eq!(permission_for(Some("ask"))["edit"].as_str(), Some("ask"));
        assert_eq!(permission_for(Some("ask"))["external_directory"].as_str(), Some("ask"));
        assert_eq!(
            permission_for(Some("accept_edits"))["edit"].as_str(),
            Some("allow")
        );
        assert_eq!(
            permission_for(Some("accept_edits"))["external_directory"].as_str(),
            Some("deny")
        );
        assert_eq!(permission_for(Some("bypass"))["bash"].as_str(), Some("allow"));
        assert_eq!(
            permission_for(Some("bypass"))["external_directory"].as_str(),
            Some("allow")
        );
    }
}

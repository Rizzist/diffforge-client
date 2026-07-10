const ORCHESTRATOR_POOL_MAX_TERMINALS: usize = 4;
const ORCHESTRATOR_POOL_READY_TIMEOUT_SECS: u64 = 30;
const ORCHESTRATOR_POOL_READY_POLL_MS: u64 = 250;
const ORCHESTRATOR_POOL_ACK_TIMEOUT_SECS: u64 = 10;
const ORCHESTRATOR_POOL_DEFAULT_AGENT: &str = "claude";
// An in-flight send whose turn never settles must not block the pane forever.
const ORCHESTRATOR_POOL_IN_FLIGHT_STALE_MS: u64 = 30 * 60 * 1000;

#[derive(Clone, Debug)]
struct OrchestratorPoolEntry {
    pane_id: String,
    instance_id: u64,
    terminal_index: u16,
    agent_id: String,
    thread_id: String,
    last_used_ms: u64,
    // false while a spawn is claiming this slot — concurrent senders for the
    // same key wait for readiness instead of double-spawning.
    ready: bool,
}

static ORCHESTRATOR_POOL_ENTRIES: OnceLock<StdMutex<HashMap<String, OrchestratorPoolEntry>>> =
    OnceLock::new();

fn orchestrator_pool_entries() -> &'static StdMutex<HashMap<String, OrchestratorPoolEntry>> {
    ORCHESTRATOR_POOL_ENTRIES.get_or_init(|| StdMutex::new(HashMap::new()))
}

// Turn-tracked send lifecycle: a send is "completed" when the agent's TURN
// settles (provider-turn-completed via the activity hook), not when the
// prompt bytes reach the PTY — matching the webview's orchestrator-send
// status contract. Busy panes queue sends; settlement drains the queue.
struct OrchestratorInFlightSend {
    event: Value,
    state: CloudMcpState,
    submitted_at_ms: u64,
}

struct OrchestratorQueuedSend {
    event: Value,
    state: CloudMcpState,
    prompt: String,
    entry: OrchestratorPoolEntry,
}

#[derive(Default)]
struct OrchestratorPaneSendState {
    in_flight: Option<OrchestratorInFlightSend>,
    queued: VecDeque<OrchestratorQueuedSend>,
}

static ORCHESTRATOR_POOL_SENDS: OnceLock<StdMutex<HashMap<String, OrchestratorPaneSendState>>> =
    OnceLock::new();

fn orchestrator_pool_sends() -> &'static StdMutex<HashMap<String, OrchestratorPaneSendState>> {
    ORCHESTRATOR_POOL_SENDS.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn orchestrator_pool_event_text(event: &Value, keys: &[&str]) -> String {
    cloud_mcp_remote_command_field_text(event, keys)
        .or_else(|| cloud_mcp_payload_text(event, keys))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn orchestrator_pool_key(event: &Value) -> String {
    let run_id = orchestrator_pool_event_text(
        event,
        &[
            "loop_runtime_run_id",
            "loopRuntimeRunId",
            "run_id",
            "runId",
        ],
    );
    if !run_id.is_empty() {
        return format!("run:{run_id}");
    }
    let loopspace_id =
        orchestrator_pool_event_text(event, &["loopspace_id", "loopspaceId", "loopspace"]);
    if !loopspace_id.is_empty() {
        return format!("loopspace:{loopspace_id}");
    }
    let command_id = cloud_mcp_remote_command_id(event);
    if command_id.is_empty() {
        format!("command:{:x}", cloud_mcp_now_ms())
    } else {
        format!("command:{command_id}")
    }
}

fn orchestrator_pool_agent_id(event: &Value) -> String {
    let agent = orchestrator_pool_event_text(
        event,
        &[
            "agent_id",
            "agentId",
            "target_agent_id",
            "targetAgentId",
            "provider",
        ],
    );
    let agent = if agent.is_empty() {
        ORCHESTRATOR_POOL_DEFAULT_AGENT
    } else {
        agent.as_str()
    };
    workspace_activation_clean_role(Some(agent))
}

fn orchestrator_pool_agent_label(agent_id: &str) -> String {
    match workspace_activation_clean_role(Some(agent_id)).as_str() {
        "claude" => "Claude Code".to_string(),
        "codex" => "Codex".to_string(),
        "generic" => "Terminal".to_string(),
        "opencode" => "OpenCode".to_string(),
        other => other.to_string(),
    }
}

// Codex terminals submit on the CSI-u enter; every other agent expects a
// plain carriage return (same split as todo_dispatch_backend_submit_sequence).
fn orchestrator_pool_submit_sequence(agent_id: &str) -> &'static str {
    if agent_id.contains("codex") {
        TERMINAL_ENTER_SEQUENCE
    } else {
        TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE
    }
}

// Pool indexes are 1-based: index 0's pane id is the app-control agent
// terminal's identity, which headless todo dispatch owns separately —
// sharing it would let pool spawns replace the app-control terminal and
// app-control todos land inside loop-run conversations.
fn orchestrator_pool_pane_id(index: u16) -> String {
    format!("{CLOUD_MCP_APP_CONTROL_PANE_ID}-{index}")
}

fn orchestrator_pool_working_directory(event: &Value) -> String {
    let requested = orchestrator_pool_event_text(
        event,
        &[
            "workspace_root",
            "workspaceRoot",
            "repo_path",
            "repoPath",
            "working_directory",
            "workingDirectory",
            "root_directory",
            "rootDirectory",
            "cwd",
        ],
    );
    if !requested.is_empty() {
        return requested;
    }
    // Never the daemon's cwd: a launchd/systemd daemon runs from `/`, and an
    // agent with edit permissions must not land there. Home is the same
    // stable default the app-control terminal uses.
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| ".".to_string())
}

fn orchestrator_pool_prompt_text(event: &Value) -> String {
    orchestrator_pool_event_text(
        event,
        &[
            "body",
            "message",
            "prompt",
            "text",
            "input",
            "content",
        ],
    )
}

fn orchestrator_pool_prompt_id(event: &Value) -> String {
    let prompt_id = orchestrator_pool_event_text(
        event,
        &[
            "prompt_event_id",
            "promptEventId",
            "prompt_id",
            "promptId",
            "id",
        ],
    );
    if !prompt_id.is_empty() {
        return prompt_id;
    }
    let command_id = cloud_mcp_remote_command_id(event);
    if command_id.is_empty() {
        format!("orchestrator-prompt-{:x}", cloud_mcp_now_ms())
    } else {
        format!("orchestrator-{command_id}")
    }
}

fn orchestrator_pool_requested_index(event: &Value) -> Option<u16> {
    cloud_mcp_remote_command_field_text(
        event,
        &[
            "target_terminal_index",
            "targetTerminalIndex",
            "terminal_index",
            "terminalIndex",
        ],
    )
    .or_else(|| {
        cloud_mcp_payload_text(
            event,
            &[
                "target_terminal_index",
                "targetTerminalIndex",
                "terminal_index",
                "terminalIndex",
            ],
        )
    })
    .and_then(|value| value.trim().parse::<u16>().ok())
    .filter(|index| usize::from(*index) < ORCHESTRATOR_POOL_MAX_TERMINALS)
    // External indexes are 0-based; the pool's own slots start at 1.
    .map(|index| index + 1)
}

fn orchestrator_pool_permission_mode(agent_id: &str) -> Option<String> {
    match workspace_activation_clean_role(Some(agent_id)).as_str() {
        "claude" => Some("auto".to_string()),
        "codex" => Some("full_access".to_string()),
        "generic" => None,
        _ => Some("accept_edits".to_string()),
    }
}

fn orchestrator_pool_session_mode(agent_id: &str) -> &'static str {
    if workspace_activation_clean_role(Some(agent_id)) == "generic" {
        "general"
    } else {
        "direct_edit"
    }
}

async fn orchestrator_pool_entry_current(app: &AppHandle, entry: &OrchestratorPoolEntry) -> bool {
    let terminal_state = app.state::<TerminalState>();
    let guard = terminal_state.terminals.read().await;
    guard
        .get(&entry.pane_id)
        .is_some_and(|instance| instance.id == entry.instance_id)
}

async fn orchestrator_pool_entry_ready(app: &AppHandle, entry: &OrchestratorPoolEntry) -> bool {
    workspace_activation_terminal_ready(app, &entry.pane_id, entry.instance_id).await == Some(true)
}

async fn orchestrator_pool_reap_stale(app: &AppHandle) {
    let entries = {
        let Ok(guard) = orchestrator_pool_entries().lock() else {
            return;
        };
        guard
            .iter()
            // Spawning placeholders are not reapable — the spawner owns them.
            .filter(|(_, entry)| entry.ready)
            .map(|(key, entry)| (key.clone(), entry.clone()))
            .collect::<Vec<_>>()
    };
    let mut stale_keys = Vec::new();
    for (key, entry) in entries {
        if !orchestrator_pool_entry_current(app, &entry).await {
            stale_keys.push(key);
        }
    }
    if stale_keys.is_empty() {
        return;
    }
    if let Ok(mut guard) = orchestrator_pool_entries().lock() {
        for key in stale_keys {
            // Re-check under the lock: the spawner may have replaced it.
            if guard.get(&key).is_some_and(|entry| entry.ready) {
                guard.remove(&key);
            }
        }
    }
}

async fn orchestrator_pool_wait_ready(app: &AppHandle, entry: &OrchestratorPoolEntry) -> bool {
    let deadline = Instant::now() + Duration::from_secs(ORCHESTRATOR_POOL_READY_TIMEOUT_SECS);
    loop {
        if orchestrator_pool_entry_ready(app, entry).await {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        sleep(Duration::from_millis(ORCHESTRATOR_POOL_READY_POLL_MS)).await;
    }
}

// Waits for another sender's in-progress spawn of the same pool key.
async fn orchestrator_pool_wait_for_claimed_entry(
    pool_key: &str,
) -> Result<OrchestratorPoolEntry, String> {
    let deadline = Instant::now()
        + Duration::from_secs(ORCHESTRATOR_POOL_READY_TIMEOUT_SECS + 5);
    loop {
        let snapshot = orchestrator_pool_entries()
            .lock()
            .ok()
            .and_then(|guard| guard.get(pool_key).cloned());
        match snapshot {
            Some(entry) if entry.ready => return Ok(entry),
            Some(_) if Instant::now() < deadline => {
                sleep(Duration::from_millis(ORCHESTRATOR_POOL_READY_POLL_MS)).await;
            }
            Some(_) => {
                return Err(
                    "orchestrator terminal spawn in progress did not become ready".to_string(),
                )
            }
            None => return Err("orchestrator terminal spawn was abandoned".to_string()),
        }
    }
}

async fn orchestrator_pool_spawn_entry(
    app: &AppHandle,
    event: &Value,
    pool_key: &str,
    index: u16,
) -> Result<OrchestratorPoolEntry, String> {
    let agent_id = orchestrator_pool_agent_id(event);
    let plain_shell = agent_id == "generic";
    let kind = if plain_shell {
        "shell".to_string()
    } else {
        agent_id.clone()
    };
    let thread_id = format!("orchestrator:{pool_key}:{index}");
    let pane_id = orchestrator_pool_pane_id(index);
    let request = TerminalOpenRequest {
        pane_id: pane_id.clone(),
        instance_id: None,
        kind,
        agent_id: Some(agent_id.clone()),
        agent_kind: Some(agent_id.clone()),
        provider: (!plain_shell).then(|| agent_id.clone()),
        provider_session_id: None,
        fork_from_provider_session_id: None,
        model: cloud_mcp_remote_command_field_text(event, &["model", "model_id", "modelId"]),
        reasoning_effort: cloud_mcp_remote_command_field_text(
            event,
            &[
                "reasoning_effort",
                "reasoningEffort",
                "effort",
                "thinking_power",
                "thinkingPower",
            ],
        ),
        speed: cloud_mcp_remote_command_field_text(event, &["speed", "service_tier", "serviceTier"]),
        permission_mode: orchestrator_pool_permission_mode(&agent_id),
        plain_shell: Some(plain_shell),
        fresh_session: Some(false),
        preserve_coordination_session: Some(true),
        session_mode: Some(orchestrator_pool_session_mode(&agent_id).to_string()),
        slot_key: Some((usize::from(index) + 1).to_string()),
        terminal_index: Some(index),
        thread_id: Some(thread_id.clone()),
        working_directory: Some(orchestrator_pool_working_directory(event)),
        workspace_root_was_empty_at_selection: Some(false),
        project_root: None,
        mount_id: None,
        workspace_id: Some(CLOUD_MCP_APP_CONTROL_WORKSPACE_ID.to_string()),
        workspace_name: Some("App Control".to_string()),
        terminal_name: Some(orchestrator_pool_agent_label(&agent_id)),
        terminal_nickname: Some(orchestrator_pool_agent_label(&agent_id)),
        app_control_mcp: Some(!plain_shell),
        cols: Some(TERMINAL_DEFAULT_COLS),
        rows: Some(TERMINAL_DEFAULT_ROWS),
        output_transport: Some(false),
    };
    let output_channel = Channel::new(|_body: InvokeResponseBody| Ok(()));
    let open_result = terminal_open(
        app.clone(),
        app.state::<TerminalState>(),
        app.state::<CloudMcpState>(),
        app.state::<AppControlMcpState>(),
        request,
        output_channel,
    )
    .await?;
    let entry = OrchestratorPoolEntry {
        pane_id,
        instance_id: open_result.instance_id,
        terminal_index: index,
        agent_id,
        thread_id,
        last_used_ms: cloud_mcp_now_ms(),
        ready: true,
    };
    if !orchestrator_pool_wait_ready(app, &entry).await {
        return Err("orchestrator terminal did not become input-ready".to_string());
    }
    Ok(entry)
}

async fn orchestrator_pool_get_or_spawn(
    app: &AppHandle,
    event: &Value,
    pool_key: &str,
) -> Result<OrchestratorPoolEntry, String> {
    orchestrator_pool_reap_stale(app).await;
    let requested_agent = orchestrator_pool_agent_id(event);
    let requested_index = orchestrator_pool_requested_index(event);

    // Single lock section decides everything: existing entry, reuse, or an
    // atomically reserved (key + index) placeholder. Two concurrent sends
    // can therefore never double-spawn or pick the same index.
    enum PoolClaim {
        Existing(OrchestratorPoolEntry),
        WaitForSpawn,
        Spawn(u16),
        Reuse(OrchestratorPoolEntry),
        Exhausted,
    }
    let claim = {
        let Ok(mut guard) = orchestrator_pool_entries().lock() else {
            return Err("orchestrator pool lock poisoned".to_string());
        };
        if let Some(entry) = guard.get_mut(pool_key) {
            if entry.ready {
                entry.last_used_ms = cloud_mcp_now_ms();
                PoolClaim::Existing(entry.clone())
            } else {
                PoolClaim::WaitForSpawn
            }
        } else {
            let used_indexes = guard
                .values()
                .map(|entry| entry.terminal_index)
                .collect::<HashSet<_>>();
            let free_index = requested_index
                .filter(|index| !used_indexes.contains(index))
                .or_else(|| {
                    (1..=ORCHESTRATOR_POOL_MAX_TERMINALS as u16)
                        .find(|index| !used_indexes.contains(index))
                });
            if let Some(index) = free_index {
                // Reserve key + index before spawning.
                guard.insert(
                    pool_key.to_string(),
                    OrchestratorPoolEntry {
                        pane_id: orchestrator_pool_pane_id(index),
                        instance_id: 0,
                        terminal_index: index,
                        agent_id: requested_agent.clone(),
                        thread_id: String::new(),
                        last_used_ms: cloud_mcp_now_ms(),
                        ready: false,
                    },
                );
                PoolClaim::Spawn(index)
            } else {
                // Pool full: reuse the least-recently-used READY entry, but
                // only one running the SAME agent — delivering into another
                // agent's (and another run's) conversation is worse than
                // failing.
                let reusable = guard
                    .iter()
                    .filter(|(_, entry)| entry.ready && entry.agent_id == requested_agent)
                    .min_by_key(|(_, entry)| entry.last_used_ms)
                    .map(|(key, entry)| (key.clone(), entry.clone()));
                if let Some((old_key, mut entry)) = reusable {
                    entry.last_used_ms = cloud_mcp_now_ms();
                    guard.remove(&old_key);
                    guard.insert(pool_key.to_string(), entry.clone());
                    PoolClaim::Reuse(entry)
                } else {
                    PoolClaim::Exhausted
                }
            }
        }
    };

    match claim {
        PoolClaim::Existing(entry) | PoolClaim::Reuse(entry) => Ok(entry),
        PoolClaim::WaitForSpawn => orchestrator_pool_wait_for_claimed_entry(pool_key).await,
        PoolClaim::Exhausted => Err("orchestrator pool exhausted".to_string()),
        PoolClaim::Spawn(index) => {
            match orchestrator_pool_spawn_entry(app, event, pool_key, index).await {
                Ok(entry) => {
                    if let Ok(mut guard) = orchestrator_pool_entries().lock() {
                        guard.insert(pool_key.to_string(), entry.clone());
                    }
                    Ok(entry)
                }
                Err(error) => {
                    if let Ok(mut guard) = orchestrator_pool_entries().lock() {
                        guard.remove(pool_key);
                    }
                    Err(error)
                }
            }
        }
    }
}

async fn orchestrator_pool_submit_prompt(
    app: &AppHandle,
    event: &Value,
    entry: &OrchestratorPoolEntry,
    prompt: String,
) -> Result<String, String> {
    let prompt_id = orchestrator_pool_prompt_id(event);
    let submit_sequence = orchestrator_pool_submit_sequence(&entry.agent_id);
    let payload = TerminalInputEventPayload {
        pane_id: entry.pane_id.clone(),
        instance_id: Some(entry.instance_id),
        data: format!("{prompt}{submit_sequence}"),
        app_fork_enabled: Some(false),
        prompt_event_id: Some(prompt_id.clone()),
        prompt_event_revision: None,
        prompt_event_source: Some("orchestrator_pool".to_string()),
        prompt_event_submitted_at: Some(cloud_mcp_now_ms().to_string()),
        prompt_event_text: Some(prompt),
        todo_id: None,
        todo_dispatch_id: None,
        todo_command_id: Some(cloud_mcp_remote_command_id(event)),
        todo_action: None,
        todo_resume_requested: None,
        thread_id: Some(entry.thread_id.clone()),
    };
    let ack = enqueue_terminal_input_event_with_ack(app, payload);
    match timeout(Duration::from_secs(ORCHESTRATOR_POOL_ACK_TIMEOUT_SECS), ack).await {
        Ok(Ok(Ok(()))) => Ok(prompt_id),
        Ok(Ok(Err(error))) => Err(error),
        Ok(Err(_)) => Err("Terminal input acknowledgement channel closed.".to_string()),
        Err(_) => Err("Terminal input write acknowledgement timed out.".to_string()),
    }
}

fn orchestrator_pool_result_details(
    entry: &OrchestratorPoolEntry,
    pool_key: &str,
    prompt_id: &str,
    queued: bool,
) -> Value {
    json!({
        "agentId": entry.agent_id,
        "instanceId": entry.instance_id,
        "paneId": entry.pane_id,
        "poolKey": pool_key,
        "promptId": prompt_id,
        "queuedBehindTurn": queued,
        "targetThreadId": entry.thread_id,
        "targetTerminalIndex": entry.terminal_index,
        "workspaceId": CLOUD_MCP_APP_CONTROL_WORKSPACE_ID,
    })
}

// Ok(Some(details)) = submitted, completion follows via turn settlement.
// Ok(None means never used) — kept as Result<Value,_> with "queued" marker.
async fn orchestrator_pool_deliver(
    app: &AppHandle,
    state: &CloudMcpState,
    event: &Value,
) -> Result<Value, String> {
    let prompt = todo_dispatch_text_with_remote_attachments(
        orchestrator_pool_prompt_text(event),
        event,
        CLOUD_MCP_APP_CONTROL_WORKSPACE_ID,
    )
    .await;
    if prompt.is_empty() {
        return Err("orchestrator send message is empty".to_string());
    }
    if prompt.len() + TERMINAL_ENTER_SEQUENCE.len() > MAX_TERMINAL_WRITE_BYTES {
        return Err("orchestrator send message is too large".to_string());
    }
    let pool_key = orchestrator_pool_key(event);
    let entry = orchestrator_pool_get_or_spawn(app, event, &pool_key).await?;

    // A pane with an in-flight (or otherwise busy) turn queues the send —
    // never interrupt: the webview contract queues busy sends and drains
    // after settlement, and an interrupt here would kill someone else's turn.
    let stale_in_flight = {
        let Ok(mut guard) = orchestrator_pool_sends().lock() else {
            return Err("orchestrator sends lock poisoned".to_string());
        };
        let pane_state = guard.entry(entry.pane_id.clone()).or_default();
        match pane_state.in_flight.as_ref() {
            Some(in_flight)
                if cloud_mcp_now_ms().saturating_sub(in_flight.submitted_at_ms)
                    < ORCHESTRATOR_POOL_IN_FLIGHT_STALE_MS =>
            {
                pane_state.queued.push_back(OrchestratorQueuedSend {
                    event: event.clone(),
                    state: state.clone(),
                    prompt,
                    entry: entry.clone(),
                });
                return Ok(orchestrator_pool_result_details(
                    &entry,
                    &pool_key,
                    &orchestrator_pool_prompt_id(event),
                    true,
                ));
            }
            Some(_) => pane_state.in_flight.take(),
            None => None,
        }
    };
    if let Some(stale) = stale_in_flight {
        let stale_state = stale.state.clone();
        let stale_event = stale.event.clone();
        tauri::async_runtime::spawn(async move {
            let _ = cloud_mcp_send_remote_command_status_event(
                &stale_state,
                &stale_event,
                "timed_out",
                "Terminal orchestrator turn did not settle.",
                None,
            )
            .await;
        });
    }

    if !orchestrator_pool_entry_ready(app, &entry).await {
        // Busy from non-pool traffic: queue and let the turn hook drain it.
        if let Ok(mut guard) = orchestrator_pool_sends().lock() {
            let pane_state = guard.entry(entry.pane_id.clone()).or_default();
            pane_state.queued.push_back(OrchestratorQueuedSend {
                event: event.clone(),
                state: state.clone(),
                prompt,
                entry: entry.clone(),
            });
            return Ok(orchestrator_pool_result_details(
                &entry,
                &pool_key,
                &orchestrator_pool_prompt_id(event),
                true,
            ));
        }
        return Err("orchestrator sends lock poisoned".to_string());
    }

    let prompt_id = orchestrator_pool_submit_prompt(app, event, &entry, prompt).await?;
    if let Ok(mut guard) = orchestrator_pool_sends().lock() {
        let pane_state = guard.entry(entry.pane_id.clone()).or_default();
        pane_state.in_flight = Some(OrchestratorInFlightSend {
            event: event.clone(),
            state: state.clone(),
            submitted_at_ms: cloud_mcp_now_ms(),
        });
    }
    if let Ok(mut guard) = orchestrator_pool_entries().lock() {
        if let Some(stored) = guard.get_mut(&pool_key) {
            stored.last_used_ms = cloud_mcp_now_ms();
        }
    }
    Ok(orchestrator_pool_result_details(
        &entry, &pool_key, &prompt_id, false,
    ))
}

// Called from the terminal activity hook on every turn settlement: completes
// the pane's in-flight orchestrator send with the REAL turn outcome, then
// drains the next queued send. Cheap no-op for panes the pool doesn't own.
pub(crate) fn orchestrator_pool_observe_turn_settled(
    app: &AppHandle,
    pane_id: &str,
    settle_status: &str,
) {
    let (finished, next) = {
        let Ok(mut guard) = orchestrator_pool_sends().lock() else {
            return;
        };
        let Some(pane_state) = guard.get_mut(pane_id) else {
            return;
        };
        (pane_state.in_flight.take(), pane_state.queued.pop_front())
    };
    if let Some(finished) = finished {
        let (status, message) = match settle_status {
            "completed" => (
                "completed",
                "Terminal orchestrator turn completed.",
            ),
            "interrupted" => ("interrupted", "Terminal orchestrator turn was interrupted."),
            _ => ("failed", "Terminal orchestrator turn failed."),
        };
        tauri::async_runtime::spawn(async move {
            let _ = cloud_mcp_send_remote_command_status_event(
                &finished.state,
                &finished.event,
                status,
                message,
                None,
            )
            .await;
        });
    }
    if let Some(queued) = next {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            match orchestrator_pool_submit_prompt(&app, &queued.event, &queued.entry, queued.prompt)
                .await
            {
                Ok(prompt_id) => {
                    let _ = cloud_mcp_send_client_action_ack(
                        &queued.state,
                        &queued.event,
                        "message",
                        "applied",
                        Some(&prompt_id),
                        None,
                    )
                    .await;
                    if let Ok(mut guard) = orchestrator_pool_sends().lock() {
                        let pane_state = guard.entry(queued.entry.pane_id.clone()).or_default();
                        pane_state.in_flight = Some(OrchestratorInFlightSend {
                            event: queued.event,
                            state: queued.state,
                            submitted_at_ms: cloud_mcp_now_ms(),
                        });
                    }
                }
                Err(error) => {
                    let entity_id = cloud_mcp_remote_command_id(&queued.event);
                    let _ = cloud_mcp_send_client_action_ack(
                        &queued.state,
                        &queued.event,
                        "message",
                        "failed",
                        (!entity_id.is_empty()).then_some(entity_id.as_str()),
                        Some(&error),
                    )
                    .await;
                    let details = json!({
                        "error": clean_terminal_telemetry_text(&error),
                        "reason": "orchestrator_pool_queued_delivery_failed",
                    });
                    let _ = cloud_mcp_send_remote_command_status_event(
                        &queued.state,
                        &queued.event,
                        "failed",
                        "Terminal orchestrator message could not be submitted.",
                        Some(&details),
                    )
                    .await;
                }
            }
        });
    }
}

pub(crate) fn orchestrator_pool_apply_remote_send_lever(
    app: &AppHandle,
    state: &CloudMcpState,
    event: &Value,
) -> bool {
    if todo_dispatch_webview_dispatcher_active() {
        return false;
    }
    if !todo_dispatch_remote_command_is_message_intent(event) {
        return false;
    }
    let workspace_id = cloud_mcp_remote_command_field_text(event, &["workspace_id", "workspaceId"])
        .unwrap_or_default();
    if !workspace_id.trim().is_empty() && !cloud_mcp_is_app_control_workspace_id(&workspace_id) {
        return false;
    }
    let app = app.clone();
    let state = state.clone();
    let event = event.clone();
    tauri::async_runtime::spawn(async move {
        let _ = cloud_mcp_send_remote_command_status_event(
            &state,
            &event,
            "running",
            "Preparing terminal orchestrator message.",
            None,
        )
        .await;
        match orchestrator_pool_deliver(&app, &state, &event).await {
            Ok(details) => {
                if details
                    .get("queuedBehindTurn")
                    .and_then(Value::as_bool)
                    != Some(true)
                {
                    let entity_id = details
                        .get("promptId")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or_else(|| {
                            let command_id = cloud_mcp_remote_command_id(&event);
                            (!command_id.is_empty()).then_some(command_id)
                        });
                    let _ = cloud_mcp_send_client_action_ack(
                        &state,
                        &event,
                        "message",
                        "applied",
                        entity_id.as_deref(),
                        None,
                    )
                    .await;
                }
                // NOT terminal: the send completes when the agent's turn
                // settles (orchestrator_pool_observe_turn_settled).
                let _ = cloud_mcp_send_remote_command_status_event(
                    &state,
                    &event,
                    "running",
                    "Terminal orchestrator message submitted; awaiting turn completion.",
                    Some(&details),
                )
                .await;
            }
            Err(error) => {
                let entity_id = cloud_mcp_remote_command_id(&event);
                let _ = cloud_mcp_send_client_action_ack(
                    &state,
                    &event,
                    "message",
                    "failed",
                    (!entity_id.is_empty()).then_some(entity_id.as_str()),
                    Some(&error),
                )
                .await;
                let details = json!({
                    "error": clean_terminal_telemetry_text(&error),
                    "reason": "orchestrator_pool_delivery_failed",
                });
                let _ = cloud_mcp_send_remote_command_status_event(
                    &state,
                    &event,
                    "failed",
                    "Terminal orchestrator message could not be submitted.",
                    Some(&details),
                )
                .await;
            }
        }
    });
    true
}

#[cfg(test)]
#[test]
fn orchestrator_pool_agent_spawns_use_auto_direct_edit_authority() {
    assert_eq!(
        orchestrator_pool_permission_mode("claude").as_deref(),
        Some("auto")
    );
    assert_eq!(
        orchestrator_pool_permission_mode("codex").as_deref(),
        Some("full_access")
    );
    assert_eq!(orchestrator_pool_session_mode("claude"), "direct_edit");
    assert_eq!(orchestrator_pool_session_mode("codex"), "direct_edit");
}

#[cfg(test)]
#[test]
fn orchestrator_pool_plain_shell_keeps_agent_permission_flags_empty() {
    assert_eq!(orchestrator_pool_permission_mode("generic"), None);
    assert_eq!(orchestrator_pool_session_mode("generic"), "general");
}

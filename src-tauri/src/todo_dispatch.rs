// Compatibility surface for callers that still report terminal lifecycle or
// remote-message metadata. Haider owns todo persistence and dispatch.

const TODO_DISPATCH_APP_CONTROL_WORKSPACE_ID: &str = "__diffforge_app_control__";
const TODO_DISPATCH_APP_CONTROL_WORKSPACE_ID_NORMALIZED: &str = "diffforge_app_control";
const TODO_DISPATCH_APP_CONTROL_PANE_ID: &str = "forge-app-control-agent-terminal";

fn todo_dispatch_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn chrono_like_now_iso() -> String {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs() as i64;
    let millis = duration.subsec_millis();
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year,
        month,
        day,
        secs_of_day / 3_600,
        (secs_of_day % 3_600) / 60,
        secs_of_day % 60,
        millis,
    )
}

fn todo_dispatch_value_text(value: &Value, keys: &[&str]) -> String {
    let payload = value.get("payload").filter(|nested| nested.is_object());
    let request = value.get("request").filter(|nested| nested.is_object());
    let payload_request = payload
        .and_then(|nested| nested.get("request"))
        .filter(|nested| nested.is_object());
    let remote_command = value
        .get("remote_command")
        .filter(|nested| nested.is_object());
    for key in keys {
        for source in [Some(value), payload, request, payload_request, remote_command]
            .into_iter()
            .flatten()
        {
            if let Some(text) = source
                .get(*key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty())
            {
                return text.to_string();
            }
        }
    }
    String::new()
}

fn todo_dispatch_value_arrays(value: &Value, keys: &[&str]) -> Vec<Value> {
    let payload = value.get("payload").filter(|nested| nested.is_object());
    let request = value.get("request").filter(|nested| nested.is_object());
    let payload_request = payload
        .and_then(|nested| nested.get("request"))
        .filter(|nested| nested.is_object());
    let remote_command = value
        .get("remote_command")
        .filter(|nested| nested.is_object());
    for key in keys {
        for source in [Some(value), payload, request, payload_request, remote_command]
            .into_iter()
            .flatten()
        {
            if let Some(values) = source.get(*key).and_then(Value::as_array) {
                return values.clone();
            }
        }
    }
    Vec::new()
}

fn todo_dispatch_is_app_control_pane_id(pane_id: &str) -> bool {
    let pane_id = pane_id.trim().to_ascii_lowercase();
    if pane_id == TODO_DISPATCH_APP_CONTROL_PANE_ID {
        return true;
    }
    pane_id
        .strip_prefix(TODO_DISPATCH_APP_CONTROL_PANE_ID)
        .and_then(|suffix| suffix.strip_prefix('-'))
        .is_some_and(|index| !index.is_empty() && index.bytes().all(|byte| byte.is_ascii_digit()))
}

pub(crate) fn todo_dispatch_is_app_control_terminal_surface(
    workspace_id: &str,
    pane_id: &str,
) -> bool {
    workspace_id
        .trim()
        .eq_ignore_ascii_case(TODO_DISPATCH_APP_CONTROL_WORKSPACE_ID)
        || workspace_id
            .trim()
            .eq_ignore_ascii_case(TODO_DISPATCH_APP_CONTROL_WORKSPACE_ID_NORMALIZED)
        || todo_dispatch_is_app_control_pane_id(pane_id)
}

fn todo_dispatch_remote_command_is_message_intent(event: &Value) -> bool {
    match todo_dispatch_value_text(event, &["action_kind"])
        .to_ascii_lowercase()
        .as_str()
    {
        "message" => true,
        "todo" => false,
        _ => matches!(
            todo_dispatch_value_text(event, &["command_kind", "action", "command"])
                .to_ascii_lowercase()
                .replace(['.', ' ', '-'], "_")
                .as_str(),
            "terminal_orchestrator_send_message"
                | "terminal_send_message"
                | "orchestrator_send_message"
                | "loopspace_send_message"
                | "send_message"
        ),
    }
}

fn todo_dispatch_normalize_activity_hook_event_type(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(['_', ' '], "-")
}

pub(crate) fn todo_dispatch_observe_activity_hook_readiness(
    _app: &AppHandle,
    _payload: &TerminalActivityHookPayload,
) {
}

pub(crate) fn todo_dispatch_observe_activity_hook(
    app: &AppHandle,
    payload: &TerminalActivityHookPayload,
) {
    let event_type = todo_dispatch_normalize_activity_hook_event_type(&payload.event_type);
    let settled = match event_type.as_str() {
        "provider-turn-completed" if payload.turn_settlement_accepted => Some("completed"),
        "provider-turn-error" => Some("failed"),
        "provider-turn-interrupted" if payload.turn_settlement_accepted => Some("interrupted"),
        _ => None,
    };
    if let Some(status) = settled {
        orchestrator_pool_observe_turn_settled(app, payload.pane_id.trim(), status);
    }
}

pub(crate) fn todo_dispatch_observe_prompt_submitted(
    _workspace_id: &str,
    _workspace_name: &str,
    _pane_id: &str,
    _terminal_index: Option<u16>,
    _thread_id: &str,
    _agent_id: &str,
    _agent_kind: &str,
    _instance_id: u64,
    _prompt_event_id: Option<&str>,
    _submitted_at: Option<&str>,
    _source: &str,
) {
}

pub(crate) fn todo_store_orphan_sweep_shutdown_notify() {}

pub(crate) fn todo_store_orphan_sweep_trigger(_reason: &'static str) {}

pub(crate) fn todo_store_tombstone_ids(_workspace_id: &str) -> HashSet<String> {
    HashSet::new()
}

pub(crate) fn todo_store_all_tombstone_ids() -> HashSet<String> {
    HashSet::new()
}

#[derive(Clone, Debug)]
pub(crate) struct TodoStoreAccountResumeReconcileCommit {
    pub(crate) item_count: usize,
    pub(crate) operation: &'static str,
    pub(crate) payload: Value,
    pub(crate) workspace_id: String,
}

pub(crate) fn todo_store_account_resume_reconciliation_commits(
    _event: &Value,
) -> Vec<TodoStoreAccountResumeReconcileCommit> {
    Vec::new()
}

pub(crate) fn todo_dispatch_pane_has_running_or_in_flight_todo(
    _workspace_id: &str,
    _pane_id: &str,
) -> bool {
    false
}

pub(crate) fn todo_dispatch_mark_active_for_pane_interrupted(
    _app: Option<&AppHandle>,
    _workspace_id: &str,
    _pane_id: &str,
    _reason: &str,
) -> usize {
    0
}

pub(crate) fn todo_dispatch_mark_active_for_swarm_completed(
    _app: Option<&AppHandle>,
    _workspace_id: &str,
    _swarm_id: &str,
    _run_id: &str,
    _run_status: &str,
    _dispatch_attempt_seq: Option<u64>,
) -> usize {
    0
}

pub(crate) fn todo_dispatch_workspace_has_busy_terminals(_workspace_id: &str) -> bool {
    false
}

pub(crate) fn todo_dispatch_capture_direct_prompt_todo(
    _app: &AppHandle,
    _workspace_id: &str,
    _workspace_name: &str,
    _pane_id: &str,
    _terminal_index: u64,
    _thread_id: &str,
    _agent_kind: &str,
    _prompt: &str,
    _prompt_event_id: Option<&str>,
    _item_id_override: Option<&str>,
) -> Option<String> {
    None
}

pub(crate) fn todo_dispatch_pane_input_ready(_pane_id: &str) -> Option<bool> {
    None
}

fn todo_dispatch_core_terminal_ready_for_submit(
    runtime: &TerminalRuntimeSnapshot,
    _projected: &TerminalProjectedRuntime,
    parked: bool,
) -> Option<bool> {
    Some(
        !parked
            && runtime.terminal_state_contract_version == 1
            && runtime.canonical_state == "idle"
            && !runtime.turn_active
            && runtime.completed_turn_generation == runtime.turn_generation
            && runtime.active_interaction_id.is_none()
            && runtime.canonical_state_seq > 0,
    )
}

pub(crate) fn todo_dispatch_webview_dispatcher_active() -> bool {
    false
}

pub(crate) fn todo_dispatch_record_remote_intake(
    _app: &AppHandle,
    _event: &Value,
) -> Option<Value> {
    None
}

pub(crate) fn todo_dispatch_apply_remote_delete(
    _app: &AppHandle,
    _event: &Value,
) -> Option<Value> {
    None
}

pub(crate) fn todo_dispatch_wake_background_dispatcher(_app: AppHandle) {}

pub(crate) fn todo_dispatch_mark_active_receipts_interrupted(
    _app: Option<&AppHandle>,
    _reason: &str,
) -> usize {
    0
}

#[derive(Clone, Debug)]
struct TodoDispatchPreparedPrompt {
    text: String,
    attachments: Vec<SavedTodoImageAttachment>,
}

impl TodoDispatchPreparedPrompt {
    fn text_only(text: String) -> Self {
        Self {
            text,
            attachments: Vec::new(),
        }
    }

    fn has_content(&self) -> bool {
        !self.text.trim().is_empty() || !self.attachments.is_empty()
    }
}

fn todo_dispatch_chat_attachment_refs(value: &Value) -> Vec<ChatAttachmentRef> {
    let mut seen = HashSet::new();
    todo_dispatch_value_arrays(value, &["attachments", "chat_attachments"])
        .into_iter()
        .filter_map(|entry| {
            let attachment_id = todo_dispatch_value_text(&entry, &["attachment_id", "id"]);
            let sha256 = todo_dispatch_value_text(&entry, &["sha256", "hash"]);
            let mime = todo_dispatch_value_text(&entry, &["mime", "mime_type", "type"]);
            let name = todo_dispatch_value_text(&entry, &["name", "file_name"]);
            let bytes = entry
                .get("bytes")
                .or_else(|| entry.get("size"))
                .or_else(|| entry.get("size_bytes"))
                .and_then(|value| {
                    value
                        .as_u64()
                        .or_else(|| value.as_str()?.trim().parse::<u64>().ok())
                })?;
            if attachment_id.is_empty() || sha256.is_empty() || mime.is_empty() {
                return None;
            }
            Some(ChatAttachmentRef {
                attachment_id,
                sha256,
                bytes,
                mime,
                name,
            })
        })
        .filter(|entry| {
            let key = normalized_chat_attachment_sha(&entry.sha256);
            !key.is_empty() && seen.insert(key)
        })
        .collect()
}

fn todo_dispatch_staged_attachment_log_summary(attachments: &[SavedTodoImageAttachment]) -> Value {
    Value::Array(
        attachments
            .iter()
            .map(|attachment| {
                json!({
                    "mime": clean_terminal_diagnostic_log_text(&attachment.mime_type),
                    "name": clean_terminal_diagnostic_log_text(&attachment.name),
                    "path": clean_terminal_diagnostic_log_text(&attachment.path),
                })
            })
            .collect(),
    )
}

async fn todo_dispatch_text_with_remote_attachments(
    text: String,
    item: &Value,
    workspace_id: &str,
) -> TodoDispatchPreparedPrompt {
    let attachments = todo_dispatch_chat_attachment_refs(item);
    if attachments.is_empty() {
        return TodoDispatchPreparedPrompt::text_only(text);
    }
    let request = ChatAttachmentStageRequest {
        workspace_id: workspace_id.trim().to_string(),
        attachments,
        ack_cloud: true,
        marker_start_index: 0,
    };
    match tauri::async_runtime::spawn_blocking(move || {
        stage_chat_attachment_refs_for_dispatch(request)
    })
    .await
    {
        Ok(result) => TodoDispatchPreparedPrompt {
            text: [text.trim(), result.warning_block.trim()]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n"),
            attachments: result.attachments,
        },
        Err(error) => TodoDispatchPreparedPrompt::text_only(format!(
            "{}\n\n[attachment staging unavailable: {error}]",
            text.trim()
        )),
    }
}

fn todo_dispatch_native_attachment_paste_sequence(
    attachments: &[SavedTodoImageAttachment],
) -> String {
    attachments
        .iter()
        .filter_map(|attachment| {
            let path = attachment.path.trim();
            (!path.is_empty() && !path.chars().any(char::is_control))
                .then(|| format!("\u{1b}[200~{path}\u{1b}[201~ "))
        })
        .collect::<Vec<_>>()
        .join("")
}

fn todo_dispatch_prepared_terminal_input(
    prepared: &TodoDispatchPreparedPrompt,
    submit_sequence: &str,
) -> String {
    format!(
        "{}{}{}",
        todo_dispatch_native_attachment_paste_sequence(&prepared.attachments),
        prepared.text,
        submit_sequence,
    )
}

fn todo_dispatch_attachment_model_support(agent: &str, model: &str) -> &'static str {
    let agent = agent.trim().to_ascii_lowercase();
    if !(agent.contains("opencode") || agent.contains("open-code")) {
        return "supported";
    }
    match opencode_model_supports_images(model) {
        Some(true) => "supported",
        Some(false) => "text_only",
        None => "unknown",
    }
}

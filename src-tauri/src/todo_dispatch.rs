// Rust-owned todo dispatch ledger.
//
// This module is the authoritative store for remote-command receipts and the
// lifecycle logic that must survive without a visible window: remote intake recording,
// hook-driven settlement of submitted prompts, queue-drain detection, and
// native notifications. The webview mirrors state and requests mutations;
// hook-managed todo submission is actuated here so the same path runs in
// foreground, background, and startup recovery.

const TODO_DISPATCH_RECEIPTS_UPDATED_EVENT: &str = "todo-dispatch-receipts-updated";
const TODO_DISPATCH_QUEUE_DRAINED_EVENT: &str = "todo-dispatch-queue-drained";
const TODO_DISPATCH_RECEIPT_TTL_MS: u64 = 24 * 60 * 60 * 1000;
const TODO_DISPATCH_RECEIPT_MAX_ITEMS: usize = 400;
const TODO_DISPATCH_DRAIN_NOTIFY_DEDUPE_MS: u64 = 5_000;
const TODO_DISPATCH_ATTENTION_DEDUPE_MS: u64 = 120_000;
const TODO_DISPATCH_MODEL_SWITCH_INPUT_READY_TIMEOUT_MS: u64 = 8_000;
const TODO_DISPATCH_WORKSPACE_ACTIVATION_THROTTLE_MS: u64 = 5 * 60 * 1000;
const TODO_DISPATCH_APP_CONTROL_WORKSPACE_ID: &str = "__diffforge_app_control__";
const TODO_DISPATCH_APP_CONTROL_WORKSPACE_ID_NORMALIZED: &str = "diffforge_app_control";
const TODO_DISPATCH_APP_CONTROL_PANE_ID: &str = "forge-app-control-agent-terminal";

static TODO_DISPATCH_RECEIPTS_CACHE: OnceLock<StdMutex<HashMap<String, Value>>> = OnceLock::new();
static TODO_DISPATCH_DRAIN_NOTIFIED_AT: OnceLock<StdMutex<HashMap<String, u64>>> = OnceLock::new();
#[derive(Default)]
struct TodoDispatchAttentionNotificationState {
    in_flight: HashSet<(String, u64)>,
    notified_at: HashMap<(String, u64), u64>,
}

static TODO_DISPATCH_ATTENTION_NOTIFICATIONS: OnceLock<
    StdMutex<TodoDispatchAttentionNotificationState>,
> = OnceLock::new();
static TODO_DISPATCH_APP_STARTED_MS: OnceLock<u64> = OnceLock::new();
static TODO_STORE_ORPHAN_SWEEP_NOTIFY: OnceLock<Arc<tokio::sync::Notify>> = OnceLock::new();
static TODO_STORE_ORPHAN_SWEEP_DEBOUNCE_PENDING: AtomicBool = AtomicBool::new(false);
static TODO_DISPATCH_WORKSPACE_ACTIVATION_ATTEMPTS: OnceLock<StdMutex<HashMap<String, u64>>> =
    OnceLock::new();
static TODO_DISPATCH_LOOPSPACE_BATCH_LIFECYCLE: OnceLock<StdMutex<HashMap<String, String>>> =
    OnceLock::new();
static TODO_DISPATCH_LOOPSPACE_BATCH_PENDING_QUEUED_ACK: OnceLock<StdMutex<HashSet<String>>> =
    OnceLock::new();

#[derive(Clone, Debug)]
struct TodoDispatchLoopspaceBatchLifecycle {
    batch_id: String,
    run_id: String,
    status: String,
    status_counts: Value,
    children: Vec<Value>,
    representative: Value,
}

fn todo_dispatch_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn todo_dispatch_app_started_ms() -> u64 {
    *TODO_DISPATCH_APP_STARTED_MS.get_or_init(todo_dispatch_now_ms)
}

fn todo_dispatch_text(value: &Value, keys: &[&str]) -> String {
    let payload = value.get("payload").filter(|nested| nested.is_object());
    let request = value.get("request").filter(|nested| nested.is_object());
    let payload_request = payload
        .and_then(|nested| nested.get("request"))
        .filter(|nested| nested.is_object());
    for key in keys {
        for source in [Some(value), payload, request, payload_request]
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

fn todo_dispatch_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    let payload = value.get("payload").filter(|nested| nested.is_object());
    let request = value.get("request").filter(|nested| nested.is_object());
    let payload_request = payload
        .and_then(|nested| nested.get("request"))
        .filter(|nested| nested.is_object());
    for key in keys {
        for source in [Some(value), payload, request, payload_request]
            .into_iter()
            .flatten()
        {
            if let Some(number) = source.get(*key).and_then(Value::as_i64) {
                return Some(number);
            }
            if let Some(number) = source
                .get(*key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .and_then(|text| text.parse::<i64>().ok())
            {
                return Some(number);
            }
        }
    }
    None
}

fn todo_dispatch_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    let payload = value.get("payload").filter(|nested| nested.is_object());
    let request = value.get("request").filter(|nested| nested.is_object());
    let payload_request = payload
        .and_then(|nested| nested.get("request"))
        .filter(|nested| nested.is_object());
    for key in keys {
        for source in [Some(value), payload, request, payload_request]
            .into_iter()
            .flatten()
        {
            if let Some(number) = source.get(*key).and_then(Value::as_u64) {
                return Some(number);
            }
            if let Some(number) = source
                .get(*key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .and_then(|text| text.parse::<u64>().ok())
            {
                return Some(number);
            }
        }
    }
    None
}

fn todo_dispatch_array(value: &Value, keys: &[&str]) -> Vec<Value> {
    let payload = value.get("payload").filter(|nested| nested.is_object());
    let request = value.get("request").filter(|nested| nested.is_object());
    let payload_request = payload
        .and_then(|nested| nested.get("request"))
        .filter(|nested| nested.is_object());
    let remote_command = value
        .get("remote_command")
        .filter(|nested| nested.is_object());
    for key in keys {
        for source in [
            Some(value),
            payload,
            request,
            payload_request,
            remote_command,
        ]
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

fn todo_dispatch_chat_attachment_ref(value: &Value) -> Option<ChatAttachmentRef> {
    let attachment_id = todo_dispatch_text(value, &["attachment_id", "id"]);
    let sha256 = todo_dispatch_text(value, &["sha256", "hash"]);
    let mime = todo_dispatch_text(value, &["mime", "mime_type", "type"]);
    let name = todo_dispatch_text(value, &["name", "file_name"]);
    let bytes = todo_dispatch_u64(value, &["bytes", "size", "size_bytes"])?;
    if attachment_id.trim().is_empty() || sha256.trim().is_empty() || mime.trim().is_empty() {
        return None;
    }
    Some(ChatAttachmentRef {
        attachment_id,
        sha256,
        bytes,
        mime,
        name,
    })
}

fn todo_dispatch_chat_attachment_refs(value: &Value) -> Vec<ChatAttachmentRef> {
    let mut seen = HashSet::new();
    todo_dispatch_array(value, &["attachments", "chat_attachments"])
        .into_iter()
        .filter_map(|entry| todo_dispatch_chat_attachment_ref(&entry))
        .filter(|entry| {
            let key = normalized_chat_attachment_sha(&entry.sha256);
            if key.is_empty() || seen.contains(&key) {
                return false;
            }
            seen.insert(key);
            true
        })
        .collect()
}

fn todo_dispatch_chat_attachment_refs_value(refs: &[ChatAttachmentRef]) -> Value {
    Value::Array(
        refs.iter()
            .map(|entry| {
                json!({
                    "attachment_id": sanitized_chat_attachment_id(&entry.attachment_id),
                    "sha256": normalized_chat_attachment_sha(&entry.sha256),
                    "bytes": entry.bytes,
                    "mime": normalized_chat_attachment_mime(&entry.mime),
                    "name": entry.name.trim(),
                })
            })
            .collect(),
    )
}

fn todo_dispatch_nested_text(value: &Value, keys: &[&str], containers: &[&str]) -> String {
    let direct = todo_dispatch_text(value, keys);
    if !direct.is_empty() {
        return direct;
    }
    containers
        .iter()
        .filter_map(|container| value.get(*container))
        .map(|nested| todo_dispatch_text(nested, keys))
        .find(|text| !text.is_empty())
        .unwrap_or_default()
}

fn todo_dispatch_is_app_control_workspace_id(workspace_id: &str) -> bool {
    let workspace_id = workspace_id.trim();
    workspace_id.eq_ignore_ascii_case(TODO_DISPATCH_APP_CONTROL_WORKSPACE_ID)
        || workspace_id.eq_ignore_ascii_case(TODO_DISPATCH_APP_CONTROL_WORKSPACE_ID_NORMALIZED)
}

fn todo_dispatch_is_app_control_pane_id(pane_id: &str) -> bool {
    let pane_id = pane_id.trim().to_ascii_lowercase();
    if pane_id == TODO_DISPATCH_APP_CONTROL_PANE_ID {
        return true;
    }
    let Some(suffix) = pane_id.strip_prefix(TODO_DISPATCH_APP_CONTROL_PANE_ID) else {
        return false;
    };
    let Some(index) = suffix.strip_prefix('-') else {
        return false;
    };
    !index.is_empty() && index.bytes().all(|byte| byte.is_ascii_digit())
}

pub(crate) fn todo_dispatch_is_app_control_terminal_surface(
    workspace_id: &str,
    pane_id: &str,
) -> bool {
    todo_dispatch_is_app_control_workspace_id(workspace_id)
        || todo_dispatch_is_app_control_pane_id(pane_id)
}

/// Keeps ledger filenames aligned with the workspace identity normalization
/// used by webview callers.
fn todo_dispatch_safe_workspace_id(workspace_id: &str) -> String {
    let safe = workspace_id
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '-') {
                character
            } else {
                '_'
            }
        })
        .take(120)
        .collect::<String>();
    if safe.is_empty() {
        "default".to_string()
    } else {
        safe
    }
}

/// Port of the webview's receipt status normalization.
fn todo_dispatch_normalize_status(value: &str) -> String {
    let status = value.trim().to_ascii_lowercase();
    let known = [
        "queued",
        "listed",
        "sending",
        "submitted",
        "running",
        "dispatching",
        "completed",
        "done",
        "failed",
        "cancelled",
        "canceled",
        "paused",
        "parked",
        "resume_ready",
        "resume_requested",
        "interrupted",
        "timed_out",
        "timeout",
        "duplicate_ignored",
        "released",
    ];
    if !known.contains(&status.as_str()) {
        return "queued".to_string();
    }
    match status.as_str() {
        "canceled" => "cancelled".to_string(),
        "timeout" => "timed_out".to_string(),
        "parked" | "resume_ready" | "resume_requested" => "paused".to_string(),
        other => other.to_string(),
    }
}

fn todo_dispatch_remote_intake_status(event: &Value) -> String {
    todo_dispatch_normalize_status(&todo_dispatch_text(
        event,
        &["todo_status", "status", "mode"],
    ))
}

fn todo_store_normalize_lifecycle_status(value: &str) -> String {
    let status = value.trim().to_ascii_lowercase().replace(['-', ' '], "_");
    match status.as_str() {
        "queued" | "pending" | "requested" => "queued".to_string(),
        "sending" | "submitted" | "running" | "dispatching" | "in_flight" | "active"
        | "processing" => "running".to_string(),
        "complete" | "completed" | "done" | "finished" | "success" => "completed".to_string(),
        "cancelled" | "canceled" => "cancelled".to_string(),
        "paused" | "parked" | "resume_ready" | "resume_requested" | "needs_input"
        | "awaiting_input" => "paused".to_string(),
        "interrupted" | "aborted" => "interrupted".to_string(),
        "timed_out" | "timeout" | "expired" => "timed_out".to_string(),
        "failed" | "failure" | "error" | "blocked" | "rejected" => "failed".to_string(),
        "deleted" | "removed" => "deleted".to_string(),
        "listed"
        | "list"
        | "in_list"
        | "ready"
        | "released"
        | "unqueued"
        | "unqueue"
        | "terminal_closed"
        | "terminal_unavailable"
        | "target_terminal_closed"
        | "target_terminal_unavailable"
        | "terminal_instance_changed"
        | "terminal_thread_changed" => "listed".to_string(),
        _ => String::new(),
    }
}

fn todo_dispatch_wire_status(value: &str) -> String {
    match value.trim() {
        "completed" => "done".to_string(),
        status => status.to_string(),
    }
}

fn todo_dispatch_status_is_active(status: &str) -> bool {
    let status = status.trim().to_ascii_lowercase().replace(['-', ' '], "_");
    matches!(
        status.as_str(),
        "queued"
            | "sending"
            | "submitted"
            | "running"
            | "dispatching"
            | "paused"
            | "parked"
            | "resume_ready"
            | "resume_requested"
    )
}

fn todo_dispatch_status_is_settled(status: &str) -> bool {
    matches!(
        status,
        "completed" | "done" | "failed" | "interrupted" | "cancelled" | "timed_out"
    )
}

const TODO_DISPATCH_PERSISTED_CAMEL_KEYS: &[&str] = &[
    "actionKind",
    "activityStatus",
    "agentDisplayName",
    "agentId",
    "agentKind",
    "aliasIds",
    "appendedInput",
    "atMs",
    "attachmentId",
    "attemptId",
    "batchId",
    "browserClientId",
    "browserDeviceId",
    "canceledAt",
    "cancelledAt",
    "chatAttachments",
    "checkpointPlan",
    "clientActionId",
    "clientDeviceId",
    "clientId",
    "clientTodoId",
    "cloudStatus",
    "colorSlot",
    "commandId",
    "commandKind",
    "commandPhase",
    "completedAt",
    "completedAtMs",
    "createdAt",
    "currentEffort",
    "currentModel",
    "currentReasoningEffort",
    "currentStatus",
    "deleteMode",
    "deleteReason",
    "deletedAt",
    "deletedAtMs",
    "deletedIds",
    "deletionMode",
    "deviceId",
    "deviceName",
    "dispatchId",
    "displayName",
    "durationMs",
    "edgeId",
    "elapsedMs",
    "eventType",
    "expectedCommandId",
    "expectedDispatchId",
    "expectedStatus",
    "expectedTargetTerminalId",
    "expectedTargetThreadId",
    "expectedTodoStatus",
    "explicitTarget",
    "failedAt",
    "fileName",
    "hardDeletedIds",
    "headlessInterrupt",
    "headlessInterruptError",
    "headlessInterruptResult",
    "identityTokens",
    "imageAttachments",
    "imageDataUrl",
    "imageSrc",
    "inputCount",
    "inputId",
    "inputReady",
    "inputReadyAt",
    "instanceId",
    "intentId",
    "interruptInstanceId",
    "interruptPaneId",
    "interruptedAt",
    "itemCount",
    "itemId",
    "lastDispatchId",
    "lastInputAt",
    "lastPromptEventId",
    "lastTodoText",
    "lifecycleOwner",
    "llmTitle",
    "longText",
    "loopRuntimeEdgeId",
    "loopRuntimeNodeId",
    "loopRuntimeRunId",
    "loopspaceId",
    "matchedInStore",
    "messageId",
    "mimeType",
    "modelId",
    "nodeId",
    "noteText",
    "observedAtMs",
    "originClientId",
    "originDeviceId",
    "originWorkspaceId",
    "paneId",
    "pausedAt",
    "pendingPromptId",
    "planTask",
    "projectRoot",
    "promptEventId",
    "promptId",
    "promptReadyAt",
    "promptSubmittedAt",
    "promptText",
    "providerSessionId",
    "providerTurnId",
    "queueState",
    "queuedAt",
    "queuedCount",
    "reasoningEffort",
    "receivedAt",
    "receivedAtMs",
    "rejectedIds",
    "remainingMs",
    "remoteCommand",
    "remoteIntake",
    "removedCount",
    "repoPath",
    "requestDeviceId",
    "resumePending",
    "rootDirectory",
    "runId",
    "runningAt",
    "rustAuthoritative",
    "rustOwned",
    "rustTodoSeq",
    "scheduledAtMs",
    "sentAt",
    "serviceTier",
    "sessionId",
    "settledCount",
    "sizeBytes",
    "sourceDeviceId",
    "sourceKind",
    "sourceWorkspaceId",
    "startedAt",
    "startedAtMs",
    "statusReason",
    "statusUpdatedAt",
    "submittedAt",
    "swarmId",
    "swarmRunId",
    "targetAgentId",
    "targetAgentLabel",
    "targetColorSlot",
    "targetDeviceId",
    "targetExplicit",
    "targetKind",
    "targetName",
    "targetRole",
    "targetSwarmId",
    "targetTerminalColor",
    "targetTerminalId",
    "targetTerminalIndex",
    "targetTerminalMode",
    "targetTerminalName",
    "targetThreadId",
    "targetWorkspaceId",
    "targetWorkspaceIds",
    "taskId",
    "terminalColor",
    "terminalId",
    "terminalIndex",
    "terminalInstanceId",
    "terminalMode",
    "terminalName",
    "terminalNickname",
    "terminalPrompt",
    "terminalStatus",
    "terminalWorkState",
    "thinkingPower",
    "threadId",
    "timedOutAt",
    "timeoutAt",
    "todoAliasIds",
    "todoBatchId",
    "todoCancelledAt",
    "todoCompletedAt",
    "todoDeletedAt",
    "todoDeviceId",
    "todoDispatchId",
    "todoFailedAt",
    "todoId",
    "todoInputCount",
    "todoInputs",
    "todoInterruptedAt",
    "todoItems",
    "todoLines",
    "todoNumber",
    "todoPausedAt",
    "todoSequence",
    "todoStatus",
    "todoStatusReason",
    "todoStatusUpdatedAt",
    "todoStatusUpdatedAtMs",
    "todoText",
    "todoTimedOutAt",
    "tombstonedIds",
    "triggerId",
    "triggerRunId",
    "turnId",
    "untilMs",
    "updatedAt",
    "updatedAtMs",
    "userMessage",
    "userPinnedTarget",
    "workspaceId",
    "workspaceIds",
    "workspaceName",
    "workspaceRoot",
    "workspaceTitle",
];

fn todo_dispatch_camel_to_snake_key(key: &str) -> String {
    let mut output = String::with_capacity(key.len() + 4);
    for character in key.chars() {
        if character.is_ascii_uppercase() {
            output.push('_');
            output.push(character.to_ascii_lowercase());
        } else {
            output.push(character);
        }
    }
    output
}

fn todo_dispatch_persisted_key(key: String, to_runtime: bool) -> String {
    if to_runtime {
        if TODO_DISPATCH_PERSISTED_CAMEL_KEYS.contains(&key.as_str()) {
            return todo_dispatch_camel_to_snake_key(&key);
        }
        return key;
    }
    TODO_DISPATCH_PERSISTED_CAMEL_KEYS
        .iter()
        .find(|camel| todo_dispatch_camel_to_snake_key(camel) == key)
        .map(|camel| (*camel).to_string())
        .unwrap_or(key)
}

fn todo_dispatch_map_persisted_keys(value: Value, to_runtime: bool) -> Value {
    match value {
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| todo_dispatch_map_persisted_keys(item, to_runtime))
                .collect(),
        ),
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(key, item)| {
                    (
                        todo_dispatch_persisted_key(key, to_runtime),
                        todo_dispatch_map_persisted_keys(item, to_runtime),
                    )
                })
                .collect(),
        ),
        other => other,
    }
}

fn todo_dispatch_map_persisted_receipts(value: Value, to_runtime: bool) -> Value {
    let Value::Object(object) = value else {
        return json!({});
    };
    Value::Object(
        object
            .into_iter()
            .map(|(receipt_id, receipt)| {
                (
                    receipt_id,
                    todo_dispatch_map_persisted_keys(receipt, to_runtime),
                )
            })
            .collect(),
    )
}

fn todo_dispatch_store_path(workspace_id: &str) -> Option<PathBuf> {
    let root = cloud_mcp_local_data_file_path("todo-dispatch")?.join("receipts");
    fs::create_dir_all(&root).ok()?;
    Some(root.join(format!(
        "{}.json",
        todo_dispatch_safe_workspace_id(workspace_id)
    )))
}

fn todo_dispatch_normalize_receipt(key: &str, receipt: &Value, now_ms: u64) -> Option<Value> {
    let received_at_ms = receipt
        .get("received_at_ms")
        .and_then(Value::as_u64)
        .or_else(|| receipt.get("updated_at_ms").and_then(Value::as_u64))
        .unwrap_or(0);
    let updated_at_ms = receipt
        .get("updated_at_ms")
        .and_then(Value::as_u64)
        .unwrap_or(received_at_ms);
    if key.is_empty()
        || updated_at_ms == 0
        || now_ms.saturating_sub(updated_at_ms) > TODO_DISPATCH_RECEIPT_TTL_MS
    {
        return None;
    }
    let text = receipt
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .chars()
        .take(180)
        .collect::<String>();
    let mut normalized = json!({
        "command_id": receipt
            .get("command_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(key),
        "item_id": receipt.get("item_id").and_then(Value::as_str).unwrap_or_default(),
        "received_at_ms": received_at_ms,
        "status": todo_dispatch_normalize_status(
            receipt.get("status").and_then(Value::as_str).unwrap_or_default(),
        ),
        "text": text,
        "updated_at_ms": updated_at_ms,
        "workspace_id": receipt.get("workspace_id").and_then(Value::as_str).unwrap_or_default(),
    });
    // Extra routing/identity fields survive in the Rust store: pane hints let
    // hook settlement match receipts to terminals; device ids keep every todo
    // attributable; status reasons and resume flags drive crash recovery.
    if let Some(object) = normalized.as_object_mut() {
        for key in [
            "pane_id",
            "terminal_index",
            "terminal_id",
            "terminal_instance_id",
            "agent_kind",
            "provider_session_id",
            "session_id",
            "thread_id",
            "device_id",
            "origin_device_id",
            "target_device_id",
            "target_kind",
            "target_swarm_id",
            "swarm_run_id",
            "workspace_name",
            "status_reason",
            "resume_pending",
        ] {
            if let Some(value) = receipt.get(key).filter(|value| !value.is_null()) {
                object.insert(key.to_string(), value.clone());
            }
        }
    }
    Some(normalized)
}

fn todo_dispatch_prune(receipts: &Value, now_ms: u64) -> Value {
    let mut entries = receipts
        .as_object()
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, receipt)| {
                    todo_dispatch_normalize_receipt(key, receipt, now_ms)
                        .map(|normalized| (key.clone(), normalized))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    entries.sort_by(|left, right| {
        right
            .1
            .get("updated_at_ms")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .cmp(
                &left
                    .1
                    .get("updated_at_ms")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
            )
    });
    entries.truncate(TODO_DISPATCH_RECEIPT_MAX_ITEMS);
    Value::Object(entries.into_iter().collect())
}

fn todo_dispatch_load(workspace_id: &str) -> Value {
    let safe_id = todo_dispatch_safe_workspace_id(workspace_id);
    let cache = TODO_DISPATCH_RECEIPTS_CACHE.get_or_init(|| StdMutex::new(HashMap::new()));
    if let Some(cached) = cache.lock().ok().and_then(|map| map.get(&safe_id).cloned()) {
        return cached;
    }
    let loaded = todo_dispatch_store_path(workspace_id)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .map(|value| todo_dispatch_map_persisted_receipts(value, true))
        .map(|value| todo_dispatch_prune(&value, todo_dispatch_now_ms()))
        .unwrap_or_else(|| json!({}));
    if let Ok(mut map) = cache.lock() {
        map.insert(safe_id, loaded.clone());
    }
    loaded
}

fn todo_dispatch_save(workspace_id: &str, receipts: &Value) {
    let safe_id = todo_dispatch_safe_workspace_id(workspace_id);
    if let Ok(mut map) = TODO_DISPATCH_RECEIPTS_CACHE
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
    {
        map.insert(safe_id, receipts.clone());
    }
    if let Some(path) = todo_dispatch_store_path(workspace_id) {
        let persisted = todo_dispatch_map_persisted_receipts(receipts.clone(), false);
        if let Ok(bytes) = serde_json::to_vec(&persisted) {
            let _ = fs::write(path, bytes);
        }
    }
}

fn todo_dispatch_active_count(receipts: &Value) -> usize {
    receipts
        .as_object()
        .map(|object| {
            object
                .values()
                .filter(|receipt| {
                    todo_dispatch_status_is_active(
                        receipt
                            .get("status")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                    )
                })
                .count()
        })
        .unwrap_or(0)
}

fn todo_dispatch_receipts_payload(workspace_id: &str, receipts: &Value, reason: &str) -> Value {
    json!({
        "workspace_id": workspace_id,
        "receipts": receipts,
        "reason": reason,
        "updated_at_ms": todo_dispatch_now_ms(),
    })
}

/// Send a native notification unless the main window is focused (matching the
/// webview's `suppressWhenFocused` behavior).
fn todo_dispatch_native_notify(app: &AppHandle, title: &str, body: &str) {
    let _ = diffforge_native_notify(app, title, body, NativeNotificationUrgency::Normal, true);
}

fn todo_dispatch_native_attention_notify(app: &AppHandle, title: &str, body: &str) -> bool {
    diffforge_native_notify_with_outcome(
        app,
        title,
        body,
        NativeNotificationUrgency::Attention,
        false,
    )
    .unwrap_or(false)
}

fn todo_dispatch_maybe_notify_drained(
    app: &AppHandle,
    workspace_id: &str,
    workspace_name: &str,
    last_todo_text: &str,
) {
    let now = todo_dispatch_now_ms();
    let dedupe = TODO_DISPATCH_DRAIN_NOTIFIED_AT.get_or_init(|| StdMutex::new(HashMap::new()));
    if let Ok(mut map) = dedupe.lock() {
        let key = todo_dispatch_safe_workspace_id(workspace_id);
        if map
            .get(&key)
            .is_some_and(|at| now.saturating_sub(*at) < TODO_DISPATCH_DRAIN_NOTIFY_DEDUPE_MS)
        {
            return;
        }
        map.insert(key, now);
    }
    let _ = app.emit(
        TODO_DISPATCH_QUEUE_DRAINED_EVENT,
        json!({
            "workspace_id": workspace_id,
            "workspace_name": workspace_name,
            "last_todo_text": last_todo_text,
            "at_ms": now,
        }),
    );
    let title = if workspace_name.is_empty() {
        "Diff Forge: all todos done".to_string()
    } else {
        format!("Diff Forge: all todos done in {workspace_name}")
    };
    let body = if last_todo_text.is_empty() {
        "The last queued todo finished.".to_string()
    } else {
        format!("Finished: {last_todo_text}")
    };
    todo_dispatch_native_notify(app, &title, &body);
}

/// Upsert one receipt and run drain detection. `app` is optional so storage
/// can be exercised without an active Tauri context (tests, early startup).
pub(crate) fn todo_dispatch_record_receipt_internal(
    app: Option<&AppHandle>,
    workspace_id: &str,
    receipt: Value,
    reason: &str,
) -> Result<Value, String> {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return Err("workspace_id is required.".to_string());
    }
    let command_id = receipt
        .get("command_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Receipt commandId is required.".to_string())?
        .to_string();

    let now_ms = todo_dispatch_now_ms();
    let current = todo_dispatch_load(workspace_id);
    let before_active = todo_dispatch_active_count(&current);
    let existing = current.get(&command_id).cloned().unwrap_or(Value::Null);

    let mut merged = existing.as_object().cloned().unwrap_or_default();
    if let Some(incoming) = receipt.as_object() {
        for (key, value) in incoming {
            if !value.is_null() {
                merged.insert(key.clone(), value.clone());
            }
        }
    }
    merged.insert("command_id".to_string(), json!(command_id));
    merged.insert("workspace_id".to_string(), json!(workspace_id));
    merged.insert("updated_at_ms".to_string(), json!(now_ms));
    if !merged.contains_key("received_at_ms") {
        merged.insert("received_at_ms".to_string(), json!(now_ms));
    }
    // Every receipt carries the executing device id so todos are always
    // attributable to a device + workspace pair.
    let has_device_id = merged
        .get("device_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    if !has_device_id {
        let device_profile = cloud_mcp_desktop_device_profile();
        if let Some(device_id) = device_profile
            .get("device_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            merged.insert("device_id".to_string(), json!(device_id));
        }
    }
    let status = todo_dispatch_normalize_status(
        merged
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    );
    merged.insert("status".to_string(), json!(status.clone()));
    let last_text = merged
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let workspace_name = merged
        .get("workspace_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let notify_completion_is_fresh = status != "completed"
        || todo_dispatch_completed_receipt_fresh_for_notification(&Value::Object(merged.clone()));

    let mut next = current.clone();
    if let Some(object) = next.as_object_mut() {
        object.insert(command_id.clone(), Value::Object(merged));
    }
    let next = todo_dispatch_prune(&next, now_ms);
    let after_active = todo_dispatch_active_count(&next);
    todo_dispatch_save(workspace_id, &next);
    if before_active != after_active || todo_dispatch_status_is_active(&status) {
        todo_store_orphan_sweep_trigger("todo_dispatch_receipt_status_changed");
    }

    if let Some(app) = app {
        let _ = app.emit(
            TODO_DISPATCH_RECEIPTS_UPDATED_EVENT,
            todo_dispatch_receipts_payload(workspace_id, &next, reason),
        );
        if before_active > 0
            && after_active == 0
            && status == "completed"
            && notify_completion_is_fresh
        {
            todo_dispatch_maybe_notify_drained(app, workspace_id, &workspace_name, &last_text);
        }
    }
    Ok(next)
}

/// Record remote command intake at the websocket loop, before the webview ever
/// sees the event. Create-task commands land in the ledger as `queued` and
/// raise the arrival notification even when no window is alive.
fn todo_dispatch_remote_command_is_queue_action(command_kind: &str) -> bool {
    let command_kind = command_kind
        .trim()
        .to_ascii_lowercase()
        .replace(['.', ' ', '-'], "_");
    matches!(
        command_kind.as_str(),
        "" | "create_task"
            | "remote_command_create_task"
            | "task_create"
            | "todo_create"
            | "todo_queue"
            | "queue_todo"
            | "workspace_todo_queue"
            | "terminal_orchestrator_send_message"
            | "terminal_send_message"
            | "orchestrator_send_message"
            | "loopspace_send_message"
            | "dispatch_todos"
            | "loopspace_dispatch_todos"
            | "loopspace_workspace_todo_dispatch"
            | "send_message"
    )
}

fn todo_dispatch_remote_command_is_orchestrator_send_message(command_kind: &str) -> bool {
    let command_kind = command_kind
        .trim()
        .to_ascii_lowercase()
        .replace(['.', ' ', '-'], "_");
    matches!(
        command_kind.as_str(),
        "terminal_orchestrator_send_message"
            | "terminal_send_message"
            | "orchestrator_send_message"
            | "loopspace_send_message"
            | "send_message"
    )
}

fn todo_dispatch_remote_command_is_message_intent(event: &Value) -> bool {
    match todo_dispatch_text(event, &["action_kind"])
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "message" => true,
        "todo" => false,
        _ => todo_dispatch_remote_command_is_orchestrator_send_message(&todo_dispatch_text(
            event,
            &["command_kind", "action", "command"],
        )),
    }
}

fn todo_dispatch_post_injection_message_ack_kind(
    item: &Value,
    injection_completed: bool,
) -> Option<&'static str> {
    (injection_completed
        && todo_dispatch_remote_command_is_message_intent(item)
        && !todo_dispatch_nested_text(item, &["client_action_id"], &["remote_command"]).is_empty())
    .then_some("message")
}

#[derive(Debug, Eq, PartialEq)]
enum TodoDispatchRemoteIntakeScopeDecision {
    Continue,
    MissingScope,
    DeferLoopspaceTodoBatch,
    IgnoreOrchestratorSend,
    RustOrchestratorSend,
}

fn todo_dispatch_remote_intake_scope_decision_for_webview(
    command_kind: &str,
    command_id: &str,
    workspace_id: &str,
    webview_dispatcher_active: bool,
) -> TodoDispatchRemoteIntakeScopeDecision {
    let command_kind = command_kind
        .trim()
        .to_ascii_lowercase()
        .replace(['.', ' ', '-'], "_");
    if matches!(
        command_kind.as_str(),
        "dispatch_todos"
            | "loopspace_dispatch_todos"
            | "loopspace_workspace_todo_dispatch"
    ) {
        return TodoDispatchRemoteIntakeScopeDecision::DeferLoopspaceTodoBatch;
    }
    if (workspace_id.is_empty() || todo_dispatch_is_app_control_workspace_id(workspace_id))
        && todo_dispatch_remote_command_is_orchestrator_send_message(&command_kind)
    {
        return if webview_dispatcher_active {
            TodoDispatchRemoteIntakeScopeDecision::IgnoreOrchestratorSend
        } else {
            TodoDispatchRemoteIntakeScopeDecision::RustOrchestratorSend
        };
    }
    if command_id.is_empty() || workspace_id.is_empty() {
        return TodoDispatchRemoteIntakeScopeDecision::MissingScope;
    }
    TodoDispatchRemoteIntakeScopeDecision::Continue
}

fn todo_dispatch_remote_intake_field_matches(item: &Value, keys: &[&str], expected: &str) -> bool {
    let expected = expected.trim();
    if expected.is_empty() {
        return true;
    }
    todo_dispatch_text(item, keys).trim() == expected
}

fn todo_dispatch_remote_intake_i64_field_matches(
    item: &Value,
    keys: &[&str],
    expected: Option<i64>,
) -> bool {
    let Some(expected) = expected else {
        return true;
    };
    todo_dispatch_i64(item, keys) == Some(expected)
}

fn todo_dispatch_remote_intake_already_current(
    item: &Value,
    text: &str,
    status: &str,
    todo_id: &str,
    attachments: &[ChatAttachmentRef],
    target_terminal_id: &str,
    target_terminal_index: Option<i64>,
    target_terminal_name: &str,
    target_thread_id: &str,
    target_agent_id: &str,
    target_color_slot: Option<i64>,
    target_terminal_color: &str,
    requested_model: &str,
    requested_reasoning_effort: &str,
    requested_speed: &str,
    client_action_id: &str,
    action_kind: &str,
    command_kind: &str,
) -> bool {
    if todo_store_item_status(item) != status {
        return false;
    }
    if todo_dispatch_backend_item_text_for_sync(item).trim() != text.trim() {
        return false;
    }
    if !todo_id.trim().is_empty()
        && !todo_store_item_matches_id(item, todo_id)
        && todo_dispatch_text(item, &["todo_id"]).trim() != todo_id.trim()
    {
        return false;
    }
    if todo_dispatch_chat_attachment_refs_value(&todo_dispatch_chat_attachment_refs(item))
        != todo_dispatch_chat_attachment_refs_value(attachments)
    {
        return false;
    }
    todo_dispatch_remote_intake_field_matches(
        item,
        &["target_terminal_id", "pane_id"],
        target_terminal_id,
    ) && todo_dispatch_remote_intake_i64_field_matches(
        item,
        &["target_terminal_index", "terminal_index"],
        target_terminal_index,
    ) && todo_dispatch_remote_intake_field_matches(
        item,
        &["target_terminal_name", "terminal_name"],
        target_terminal_name,
    ) && todo_dispatch_remote_intake_field_matches(
        item,
        &["target_thread_id", "thread_id"],
        target_thread_id,
    ) && todo_dispatch_remote_intake_field_matches(
        item,
        &["target_agent_id", "agent_id"],
        target_agent_id,
    ) && todo_dispatch_remote_intake_i64_field_matches(
        item,
        &["target_color_slot", "color_slot"],
        target_color_slot,
    ) && todo_dispatch_remote_intake_field_matches(
        item,
        &["target_terminal_color", "terminal_color"],
        target_terminal_color,
    ) && todo_dispatch_remote_intake_field_matches(item, &["model", "model_id"], requested_model)
        && todo_dispatch_remote_intake_field_matches(
            item,
            &["reasoning_effort", "effort"],
            requested_reasoning_effort,
        )
        && todo_dispatch_remote_intake_field_matches(
            item,
            &["speed", "service_tier"],
            requested_speed,
        )
        && todo_dispatch_remote_intake_field_matches(item, &["client_action_id"], client_action_id)
        && todo_dispatch_remote_intake_field_matches(item, &["action_kind"], action_kind)
        && todo_dispatch_remote_intake_field_matches(item, &["command_kind"], command_kind)
}

fn todo_dispatch_remote_intake_is_stale(existing: &Value, incoming: &Value) -> bool {
    let existing_updated_ms = todo_store_item_updated_ms(existing);
    let incoming_updated_ms = todo_store_item_updated_ms(incoming);
    incoming_updated_ms > 0 && existing_updated_ms > incoming_updated_ms
}

fn todo_dispatch_remote_intake_success_outcome(
    event: &Value,
    command_id: &str,
    todo_id: &str,
    workspace_id: &str,
    todo_status: &str,
    reason: &str,
) -> Value {
    let target_terminal_id =
        todo_dispatch_text(event, &["target_terminal_id", "terminal_id", "pane_id"]);
    let target_terminal_index = (!target_terminal_id.is_empty())
        .then(|| todo_dispatch_i64(event, &["target_terminal_index", "terminal_index"]))
        .flatten();
    json!({
        "status": "queued",
        "message": "Remote todo intent was accepted by Rust.",
        "details": {
            "reason": reason,
            "command_id": command_id,
            "todo_id": todo_id,
            "todo_status": todo_status,
            "workspace_id": workspace_id,
            "target_device_id": todo_dispatch_text(event, &["target_device_id", "todo_device_id", "device_id"]),
            "target_workspace_id": workspace_id,
            "target_terminal_id": target_terminal_id,
            "target_terminal_index": target_terminal_index,
            "intent_id": todo_dispatch_text(event, &["intent_id"]),
            "origin_client_id": todo_dispatch_text(event, &["origin_client_id", "client_id"]),
            "origin_device_id": todo_dispatch_text(event, &["origin_device_id", "request_device_id", "browser_device_id", "client_device_id"]),
        },
    })
}

/// Cloud keeps a Next-created todo intent pending until it receives one
/// Rust-authoritative todo commit. Only a genuinely new/updated intake needs
/// that acknowledgement; duplicate redeliveries and conflicts must stay
/// side-effect-free so they cannot form an echo loop.
fn todo_dispatch_remote_intake_should_ack_cloud(changed_kind: &str) -> bool {
    matches!(
        changed_kind.trim(),
        "remote_todo_created" | "remote_todo_updated" | "remote_todo_stale_ignored"
    )
}

pub(crate) fn todo_dispatch_record_remote_intake(app: &AppHandle, event: &Value) -> Option<Value> {
    let command_kind = todo_dispatch_text(event, &["command_kind", "action", "command"]);
    if !todo_dispatch_remote_command_is_queue_action(&command_kind) {
        return None;
    }
    let command_id = todo_dispatch_text(event, &["command_id"]);
    let workspace_id = todo_dispatch_text(event, &["workspace_id"]);
    let message_intent = todo_dispatch_remote_command_is_message_intent(event);
    let scope_command_kind = if message_intent {
        "send_message"
    } else {
        command_kind.as_str()
    };
    match todo_dispatch_remote_intake_scope_decision_for_webview(
        scope_command_kind,
        &command_id,
        &workspace_id,
        todo_dispatch_webview_dispatcher_active(),
    ) {
        TodoDispatchRemoteIntakeScopeDecision::DeferLoopspaceTodoBatch => {
            // The webview owns list expansion and calls the Rust batch primitive.
            return None;
        }
        TodoDispatchRemoteIntakeScopeDecision::IgnoreOrchestratorSend => {
            // Orchestrator-targeted sends have no workspace scope; failing them
            // here makes cloud kill the loop runtime run while delivery still
            // succeeds through the webview orchestrator route.
            return None;
        }
        TodoDispatchRemoteIntakeScopeDecision::RustOrchestratorSend => {
            // The Rust orchestrator-pool lever accepts this no-workspace send
            // later in the cloud remote-command loop when no webview owns it.
            return None;
        }
        TodoDispatchRemoteIntakeScopeDecision::MissingScope => {
            return Some(json!({
                "status": "failed",
                "message": "Remote todo intent was missing workspace or command id.",
                "details": {
                    "reason": "missing_scope",
                    "command_id": command_id,
                    "workspace_id": workspace_id,
                    "intent_id": todo_dispatch_text(event, &["intent_id"]),
                },
            }));
        }
        TodoDispatchRemoteIntakeScopeDecision::Continue => {}
    }
    let text = todo_dispatch_text(event, &["body", "message", "prompt", "text"]);
    let chat_attachments = todo_dispatch_chat_attachment_refs(event);
    let chat_attachments_value = todo_dispatch_chat_attachment_refs_value(&chat_attachments);
    let workspace_name = todo_dispatch_text(event, &["workspace_name"]);
    let intake_status = todo_dispatch_remote_intake_status(event);
    let intake_status = intake_status.as_str();
    let client_action_id = todo_dispatch_text(event, &["client_action_id"]);
    let action_kind = if message_intent { "message" } else { "todo" };
    let origin_device_id = todo_dispatch_text(
        event,
        &[
            "origin_device_id",
            "request_device_id",
            "browser_device_id",
            "client_device_id",
        ],
    );
    let origin_client_id = todo_dispatch_text(
        event,
        &["origin_client_id", "client_id", "browser_client_id"],
    );
    let origin_workspace_id = todo_dispatch_text(event, &["origin_workspace_id"]);
    let webview_dispatcher_active = todo_dispatch_webview_dispatcher_active();
    let lifecycle_owner = if webview_dispatcher_active {
        "webview"
    } else {
        "rust"
    };
    let remote_intake_source = if webview_dispatcher_active {
        "remote_intake_webview"
    } else {
        "remote_intake_headless"
    };
    let receipt = json!({
        "command_id": command_id,
        "item_id": command_id,
        "origin_device_id": origin_device_id,
        "client_action_id": client_action_id,
        "action_kind": action_kind,
        "command_kind": command_kind,
        "remote_intake": true,
        "source": remote_intake_source,
        "status": intake_status,
        "text": text.chars().take(180).collect::<String>(),
        "workspace_name": workspace_name.clone(),
    });
    let _ =
        todo_dispatch_record_receipt_internal(Some(app), &workspace_id, receipt, "remote_intake");
    let mut outcome: Option<Value> = None;
    let mut notify_remote_arrival = false;
    // Headless intake: the remote todo is appended into the Rust queue store
    // (matching the webview's commandId-keyed item id) so the background
    // dispatcher can submit it and a later webview mount adopts it from the
    // journal. A mounted TerminalView appends the same id itself and its next
    // queue sync rewrites the store — both paths converge on one item.
    {
        let _store_guard = todo_dispatch_queue_store_guard();
        let queue_path = todo_dispatch_data_path("queues", &workspace_id);
        let tombstoned = todo_store_tombstone_ids(&workspace_id);
        let todo_id = todo_dispatch_text(event, &["todo_id"]);
        let tombstoned_remote = tombstoned.contains(command_id.as_str())
            || (!todo_id.is_empty() && tombstoned.contains(todo_id.as_str()));
        if tombstoned_remote {
            outcome = Some(json!({
                "status": "rejected",
                "message": "Remote todo intent was rejected because Rust has already deleted that todo.",
                "details": {
                    "reason": "already_deleted",
                    "command_id": command_id,
                    "todo_id": todo_id,
                    "workspace_id": workspace_id,
                    "intent_id": todo_dispatch_text(event, &["intent_id"]),
                },
            }));
        } else if text.trim().is_empty() {
            outcome = Some(json!({
                "status": "rejected",
                "message": "Remote todo intent was rejected because it was empty.",
                "details": {
                    "reason": "empty_todo",
                    "command_id": command_id,
                    "todo_id": todo_id,
                    "workspace_id": workspace_id,
                    "intent_id": todo_dispatch_text(event, &["intent_id"]),
                },
            }));
        } else {
            let now_iso = chrono_like_now_iso();
            let requested_model = todo_dispatch_text(event, &["model", "model_id"]);
            let requested_reasoning_effort =
                todo_dispatch_text(event, &["reasoning_effort", "effort", "thinking_power"]);
            let requested_speed = todo_dispatch_text(event, &["speed", "service_tier"]);
            let target_terminal_id = todo_dispatch_text(event, &["target_terminal_id"]);
            let has_terminal_assignment = !target_terminal_id.is_empty();
            let target_terminal_index = has_terminal_assignment
                .then(|| todo_dispatch_i64(event, &["target_terminal_index", "terminal_index"]))
                .flatten();
            let target_terminal_name = has_terminal_assignment
                .then(|| {
                    todo_dispatch_text(
                        event,
                        &["target_terminal_name", "terminal_name", "target_name"],
                    )
                })
                .unwrap_or_default();
            let target_thread_id = has_terminal_assignment
                .then(|| todo_dispatch_text(event, &["target_thread_id"]))
                .unwrap_or_default();
            let target_agent_id = todo_dispatch_text(event, &["target_agent_id", "agent_id"]);
            let target_color_slot = has_terminal_assignment
                .then(|| todo_dispatch_i64(event, &["target_color_slot", "color_slot"]))
                .flatten();
            let target_terminal_color = has_terminal_assignment
                .then(|| {
                    todo_dispatch_text(event, &["target_terminal_color", "terminal_color", "color"])
                })
                .unwrap_or_default();
            let target_explicit = has_terminal_assignment;
            if let Some(path) = queue_path.as_deref() {
                let mut items = todo_dispatch_queue_read(path)
                    .get("items")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let changed_item: Option<Value>;
                let mut changed_kind = "remote_todo_created";
                if let Some(existing) = items.iter_mut().find(|item| {
                    todo_store_item_matches_id(item, &command_id)
                        || (!todo_id.is_empty() && todo_store_item_matches_id(item, &todo_id))
                }) {
                    let current_status = todo_store_item_status(existing);
                    if matches!(
                        current_status.as_str(),
                        "" | "listed" | "queued" | "pending" | "requested"
                    ) {
                        if todo_dispatch_remote_intake_is_stale(existing, event) {
                            changed_item = Some(existing.clone());
                            changed_kind = "remote_todo_stale_ignored";
                        } else if todo_dispatch_remote_intake_already_current(
                            existing,
                            &text,
                            intake_status,
                            &todo_id,
                            &chat_attachments,
                            &target_terminal_id,
                            target_terminal_index,
                            &target_terminal_name,
                            &target_thread_id,
                            &target_agent_id,
                            target_color_slot,
                            &target_terminal_color,
                            &requested_model,
                            &requested_reasoning_effort,
                            &requested_speed,
                            &client_action_id,
                            action_kind,
                            &command_kind,
                        ) {
                            changed_item = Some(existing.clone());
                            changed_kind = "remote_todo_already_current";
                        } else {
                            if let Some(object) = existing.as_object_mut() {
                                if !target_explicit {
                                    for key in [
                                        "target_agent_id",
                                        "target_color_slot",
                                        "target_explicit",
                                        "target_terminal_color",
                                        "target_terminal_id",
                                        "target_terminal_index",
                                        "target_terminal_name",
                                        "target_thread_id",
                                    ] {
                                        object.remove(key);
                                    }
                                }
                                object.insert("text".to_string(), json!(text.clone()));
                                object.insert("body".to_string(), json!(text.clone()));
                                object.insert(
                                    "title".to_string(),
                                    json!(text.chars().take(120).collect::<String>()),
                                );
                                object.insert("updated_at".to_string(), json!(now_iso.clone()));
                                object.insert(
                                    "updated_at_ms".to_string(),
                                    json!(todo_dispatch_now_ms()),
                                );
                                object.insert(
                                    "workspace_id".to_string(),
                                    json!(workspace_id.clone()),
                                );
                                if !target_terminal_id.is_empty() {
                                    object.insert(
                                        "target_terminal_id".to_string(),
                                        json!(target_terminal_id.clone()),
                                    );
                                }
                                if let Some(index) = target_terminal_index {
                                    object
                                        .insert("target_terminal_index".to_string(), json!(index));
                                }
                                if !target_terminal_name.is_empty() {
                                    object.insert(
                                        "target_terminal_name".to_string(),
                                        json!(target_terminal_name.clone()),
                                    );
                                }
                                if !target_thread_id.is_empty() {
                                    object.insert(
                                        "target_thread_id".to_string(),
                                        json!(target_thread_id.clone()),
                                    );
                                }
                                if !target_agent_id.is_empty() {
                                    object.insert(
                                        "target_agent_id".to_string(),
                                        json!(target_agent_id.clone()),
                                    );
                                }
                                if let Some(color_slot) = target_color_slot {
                                    object
                                        .insert("target_color_slot".to_string(), json!(color_slot));
                                }
                                if !target_terminal_color.is_empty() {
                                    object.insert(
                                        "target_terminal_color".to_string(),
                                        json!(target_terminal_color.clone()),
                                    );
                                }
                                if !requested_model.is_empty() {
                                    object.insert(
                                        "model".to_string(),
                                        json!(requested_model.clone()),
                                    );
                                    object.insert(
                                        "model_id".to_string(),
                                        json!(requested_model.clone()),
                                    );
                                }
                                if !requested_reasoning_effort.is_empty() {
                                    object.insert(
                                        "reasoning_effort".to_string(),
                                        json!(requested_reasoning_effort.clone()),
                                    );
                                    object.insert(
                                        "effort".to_string(),
                                        json!(requested_reasoning_effort.clone()),
                                    );
                                }
                                if !requested_speed.is_empty() {
                                    object.insert(
                                        "speed".to_string(),
                                        json!(requested_speed.clone()),
                                    );
                                }
                                if target_explicit {
                                    object.insert("target_explicit".to_string(), json!(true));
                                }
                                if chat_attachments.is_empty() {
                                    object.remove("attachments");
                                } else {
                                    object.insert(
                                        "attachments".to_string(),
                                        chat_attachments_value.clone(),
                                    );
                                }
                                if !todo_id.is_empty() {
                                    object.insert("todo_id".to_string(), json!(todo_id.clone()));
                                }
                                if !origin_client_id.is_empty() {
                                    object.insert(
                                        "origin_client_id".to_string(),
                                        json!(origin_client_id.clone()),
                                    );
                                }
                                if !client_action_id.is_empty() {
                                    object.insert(
                                        "client_action_id".to_string(),
                                        json!(client_action_id.clone()),
                                    );
                                }
                                object.insert("action_kind".to_string(), json!(action_kind));
                                object.insert(
                                    "command_kind".to_string(),
                                    json!(command_kind.clone()),
                                );
                                if !origin_device_id.is_empty() {
                                    object.insert(
                                        "origin_device_id".to_string(),
                                        json!(origin_device_id.clone()),
                                    );
                                }
                                if !origin_workspace_id.is_empty() {
                                    object.insert(
                                        "origin_workspace_id".to_string(),
                                        json!(origin_workspace_id.clone()),
                                    );
                                }
                                let remote = object
                                    .entry("remote_command".to_string())
                                    .or_insert_with(|| json!({}));
                                if let Some(remote_object) = remote.as_object_mut() {
                                    if !target_explicit {
                                        for key in [
                                            "target_agent_id",
                                            "target_color_slot",
                                            "target_terminal_color",
                                            "target_terminal_id",
                                            "target_terminal_index",
                                            "target_terminal_name",
                                            "target_thread_id",
                                        ] {
                                            remote_object.remove(key);
                                        }
                                    }
                                    remote_object.insert(
                                        "command_id".to_string(),
                                        json!(command_id.clone()),
                                    );
                                    remote_object
                                        .insert("todo_id".to_string(), json!(todo_id.clone()));
                                    if !target_terminal_id.is_empty() {
                                        remote_object.insert(
                                            "target_terminal_id".to_string(),
                                            json!(target_terminal_id.clone()),
                                        );
                                    }
                                    if let Some(index) = target_terminal_index {
                                        remote_object.insert(
                                            "target_terminal_index".to_string(),
                                            json!(index),
                                        );
                                    }
                                    if !target_terminal_name.is_empty() {
                                        remote_object.insert(
                                            "target_terminal_name".to_string(),
                                            json!(target_terminal_name.clone()),
                                        );
                                    }
                                    if !target_thread_id.is_empty() {
                                        remote_object.insert(
                                            "target_thread_id".to_string(),
                                            json!(target_thread_id.clone()),
                                        );
                                    }
                                    if !target_agent_id.is_empty() {
                                        remote_object.insert(
                                            "target_agent_id".to_string(),
                                            json!(target_agent_id.clone()),
                                        );
                                    }
                                    if let Some(color_slot) = target_color_slot {
                                        remote_object.insert(
                                            "target_color_slot".to_string(),
                                            json!(color_slot),
                                        );
                                    }
                                    if !target_terminal_color.is_empty() {
                                        remote_object.insert(
                                            "target_terminal_color".to_string(),
                                            json!(target_terminal_color.clone()),
                                        );
                                    }
                                    if !requested_model.is_empty() {
                                        remote_object.insert(
                                            "model".to_string(),
                                            json!(requested_model.clone()),
                                        );
                                        remote_object.insert(
                                            "model_id".to_string(),
                                            json!(requested_model.clone()),
                                        );
                                    }
                                    if !requested_reasoning_effort.is_empty() {
                                        remote_object.insert(
                                            "reasoning_effort".to_string(),
                                            json!(requested_reasoning_effort.clone()),
                                        );
                                        remote_object.insert(
                                            "effort".to_string(),
                                            json!(requested_reasoning_effort.clone()),
                                        );
                                    }
                                    if !requested_speed.is_empty() {
                                        remote_object.insert(
                                            "speed".to_string(),
                                            json!(requested_speed.clone()),
                                        );
                                    }
                                    remote_object.insert(
                                        "origin_client_id".to_string(),
                                        json!(origin_client_id.clone()),
                                    );
                                    remote_object.insert(
                                        "origin_device_id".to_string(),
                                        json!(origin_device_id.clone()),
                                    );
                                    remote_object.insert(
                                        "origin_workspace_id".to_string(),
                                        json!(origin_workspace_id.clone()),
                                    );
                                    if !client_action_id.is_empty() {
                                        remote_object.insert(
                                            "client_action_id".to_string(),
                                            json!(client_action_id.clone()),
                                        );
                                    }
                                    remote_object
                                        .insert("action_kind".to_string(), json!(action_kind));
                                    remote_object.insert(
                                        "command_kind".to_string(),
                                        json!(command_kind.clone()),
                                    );
                                    if chat_attachments.is_empty() {
                                        remote_object.remove("attachments");
                                    } else {
                                        remote_object.insert(
                                            "attachments".to_string(),
                                            chat_attachments_value.clone(),
                                        );
                                    }
                                    remote_object
                                        .insert("source".to_string(), json!(remote_intake_source));
                                }
                            }
                            todo_store_set_item_status(
                                existing,
                                intake_status,
                                "remote_todo_intake",
                            );
                            todo_store_set_item_lifecycle_owner(existing, lifecycle_owner);
                            changed_item = Some(existing.clone());
                            changed_kind = "remote_todo_updated";
                        }
                    } else {
                        changed_item = Some(existing.clone());
                        changed_kind = "remote_todo_conflict_current";
                        outcome = Some(json!({
                            "status": "rejected",
                            "message": "Remote todo intent was rejected because Rust has a newer todo state.",
                            "details": {
                                "reason": "state_changed",
                                "command_id": command_id,
                                "todo_id": todo_id,
                                "workspace_id": workspace_id,
                                "current_status": current_status,
                                "current": existing.clone(),
                                "intent_id": todo_dispatch_text(event, &["intent_id"]),
                            },
                        }));
                    }
                } else {
                    let item = json!({
                    "id": command_id,
                    "kind": "todo",
                    "text": text,
                    "body": text,
                    "title": text.chars().take(120).collect::<String>(),
                    "todo_id": todo_id,
                    "todo_status": intake_status,
                    "status": intake_status,
                    "created_at": now_iso,
                    "updated_at": now_iso,
                    "workspace_id": workspace_id,
                    "target_terminal_id": target_terminal_id,
                    "target_terminal_index": target_terminal_index,
                    "target_terminal_name": target_terminal_name,
                    "target_thread_id": target_thread_id,
                    "target_agent_id": target_agent_id,
                    "target_color_slot": target_color_slot,
                    "target_terminal_color": target_terminal_color,
                    "target_explicit": target_explicit,
                    "origin_client_id": origin_client_id,
                    "origin_device_id": origin_device_id,
                    "origin_workspace_id": origin_workspace_id,
                    "client_action_id": client_action_id,
                    "action_kind": action_kind,
                    "command_kind": command_kind,
                    "model": requested_model.clone(),
                    "model_id": requested_model.clone(),
                    "reasoning_effort": requested_reasoning_effort.clone(),
                    "effort": requested_reasoning_effort.clone(),
                    "speed": requested_speed.clone(),
                    "attachments": chat_attachments_value.clone(),
                        "remote_command": {
                        "command_id": command_id,
                        "todo_id": todo_id,
                        "target_terminal_id": target_terminal_id,
                        "target_terminal_index": target_terminal_index,
                        "target_terminal_name": target_terminal_name,
                        "target_thread_id": target_thread_id,
                        "target_agent_id": target_agent_id,
                        "target_color_slot": target_color_slot,
                        "target_terminal_color": target_terminal_color,
                        "origin_client_id": origin_client_id,
                        "origin_device_id": origin_device_id,
                        "origin_workspace_id": origin_workspace_id,
                        "client_action_id": client_action_id,
                        "action_kind": action_kind,
                        "command_kind": command_kind,
                        "model": requested_model.clone(),
                        "model_id": requested_model.clone(),
                        "model_id": requested_model,
                        "reasoning_effort": requested_reasoning_effort.clone(),
                        "effort": requested_reasoning_effort,
                        "speed": requested_speed,
                        "attachments": chat_attachments_value,
                            "source": remote_intake_source,
                        },
                        "lifecycle_owner": lifecycle_owner,
                        "rust_owned": lifecycle_owner == "rust",
                    });
                    items.push(item.clone());
                    changed_item = Some(item);
                }
                if let Some(item) = changed_item {
                    if changed_kind != "remote_todo_conflict_current"
                        && changed_kind != "remote_todo_already_current"
                        && changed_kind != "remote_todo_stale_ignored"
                    {
                        todo_dispatch_queue_write(&workspace_id, &items);
                        todo_store_orphan_sweep_trigger("remote_todo_intake");
                        todo_store_emit_changed(app, &workspace_id, "remote_todo_intake", "store");
                        notify_remote_arrival = true;
                    }
                    todo_dispatch_journal_append(
                        &workspace_id,
                        json!({
                            "kind": changed_kind,
                            "item_id": command_id,
                            "command_id": command_id,
                            "todo_id": todo_id,
                            "item": item.clone(),
                            "at": chrono_like_now_iso(),
                        }),
                    );
                    if todo_dispatch_remote_intake_should_ack_cloud(changed_kind) {
                        todo_store_enqueue_item_todo_sync_commit(
                            app,
                            &workspace_id,
                            item,
                            "remote_todo_intake_ack",
                            "rust-diffforge-todo-store",
                        );
                    }
                    if changed_kind != "remote_todo_conflict_current" {
                        outcome = Some(todo_dispatch_remote_intake_success_outcome(
                            event,
                            &command_id,
                            &todo_id,
                            &workspace_id,
                            intake_status,
                            changed_kind,
                        ));
                    }
                }
            } else {
                outcome = Some(json!({
                    "status": "failed",
                    "message": "Remote todo intent could not open the Rust todo store.",
                    "details": {
                        "reason": "store_unavailable",
                        "command_id": command_id,
                        "todo_id": todo_id,
                        "workspace_id": workspace_id,
                        "intent_id": todo_dispatch_text(event, &["intent_id"]),
                    },
                }));
            }
        }
    }
    let title = if workspace_name.is_empty() {
        "Diff Forge: remote todo arrived".to_string()
    } else {
        format!("Diff Forge: todo arrived for {workspace_name}")
    };
    let body = if text.is_empty() {
        "A remote todo arrived for this device.".to_string()
    } else {
        text.chars().take(200).collect::<String>()
    };
    if notify_remote_arrival {
        todo_dispatch_native_notify(app, &title, &body);
    }
    outcome
}

#[cfg(test)]
fn todo_dispatch_attention_recently_notified(key: &(String, u64)) -> bool {
    let now = todo_dispatch_now_ms();
    let dedupe = TODO_DISPATCH_ATTENTION_NOTIFICATIONS
        .get_or_init(|| StdMutex::new(TodoDispatchAttentionNotificationState::default()));
    let Ok(mut state) = dedupe.lock() else {
        return false;
    };
    state
        .notified_at
        .retain(|_, at| now.saturating_sub(*at) < TODO_DISPATCH_ATTENTION_DEDUPE_MS);
    state.notified_at.contains_key(key)
}

fn todo_dispatch_attention_interaction_key_parts(
    active_interaction_id: Option<&str>,
    active_interaction_revision: Option<u64>,
    event_interaction_id: Option<&str>,
    event_interaction_revision: Option<u64>,
) -> Option<(String, u64)> {
    let pair = match (
        active_interaction_id,
        active_interaction_revision,
    ) {
        (Some(interaction_id), Some(revision)) => Some((interaction_id, revision)),
        _ => match (event_interaction_id, event_interaction_revision) {
            (Some(interaction_id), Some(revision)) => Some((interaction_id, revision)),
            _ => None,
        },
    };
    pair.and_then(|(interaction_id, revision)| {
        let interaction_id = interaction_id.trim();
        (!interaction_id.is_empty() && revision > 0)
            .then(|| (interaction_id.to_string(), revision))
    })
}

fn todo_dispatch_attention_interaction_key(
    payload: &TerminalActivityHookPayload,
) -> Option<(String, u64)> {
    todo_dispatch_attention_interaction_key_parts(
        payload.active_interaction_id.as_deref(),
        payload.active_interaction_revision,
        payload.interaction_id.as_deref(),
        payload.interaction_revision,
    )
}

fn todo_dispatch_try_attention_notification<F>(
    key: (String, u64),
    watched: bool,
    notify: F,
) -> bool
where
    F: FnOnce() -> bool,
{
    if watched {
        return false;
    }
    let dedupe = TODO_DISPATCH_ATTENTION_NOTIFICATIONS
        .get_or_init(|| StdMutex::new(TodoDispatchAttentionNotificationState::default()));
    let claimed = if let Ok(mut state) = dedupe.lock() {
        let now = todo_dispatch_now_ms();
        state
            .notified_at
            .retain(|_, at| now.saturating_sub(*at) < TODO_DISPATCH_ATTENTION_DEDUPE_MS);
        if state.notified_at.contains_key(&key) || state.in_flight.contains(&key) {
            false
        } else {
            state.in_flight.insert(key.clone());
            true
        }
    } else {
        true
    };
    if !claimed {
        return false;
    }
    let shown = notify();
    if let Ok(mut state) = dedupe.lock() {
        state.in_flight.remove(&key);
        if shown {
            state.notified_at.insert(key, todo_dispatch_now_ms());
        }
    }
    shown
}

fn todo_dispatch_normalize_activity_hook_event_type(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(['_', ' '], "-")
}

fn todo_dispatch_activity_hook_should_wake_queue(
    payload: &TerminalActivityHookPayload,
    _event_type: &str,
) -> bool {
    !payload.workspace_id.trim().is_empty()
        && payload.terminal_state_contract_version == 1
        && !payload.background_work_active
        && payload.canonical_state == "idle"
        && !payload.turn_active
        && payload.completed_turn_generation == payload.turn_generation
        && payload.active_interaction_id.is_none()
        && payload.canonical_state_seq > 0
}

fn todo_dispatch_activity_hook_settle_status(
    payload: &TerminalActivityHookPayload,
    event_type: &str,
) -> Option<&'static str> {
    match event_type {
        // WAITING settlement gate: a Stop that arrives while the harness
        // still owns live background work must never settle COMPLETED — the
        // canonical reducer withholds turn_settlement_accepted for it, and
        // this guard keeps the invariant even for payloads that bypass the
        // reducer. Errors and interrupts remain terminal and still settle.
        "provider-turn-completed" if payload.background_work_active => None,
        "provider-turn-completed" if payload.turn_settlement_accepted => Some("completed"),
        "provider-turn-error" => Some("failed"),
        "provider-turn-interrupted" if payload.turn_settlement_accepted => Some("interrupted"),
        _ => None,
    }
}

/// Propagate authoritative terminal readiness into the Rust dispatch runtime.
/// This queue-boundary update must run for startup/recovery-derived events even
/// when those events are not allowed to settle the currently submitted todo.
pub(crate) fn todo_dispatch_observe_activity_hook_readiness(
    app: &AppHandle,
    payload: &TerminalActivityHookPayload,
) {
    todo_dispatch_update_terminal_runtime(payload);
    todo_dispatch_note_startup_reconciliation_evidence(app, "activity_hook");
    let event_type = todo_dispatch_normalize_activity_hook_event_type(&payload.event_type);
    if todo_dispatch_activity_hook_should_wake_queue(payload, &event_type) {
        todo_dispatch_wake_background_dispatcher(app.clone());
    }
}

/// Observe terminal activity hook lifecycle payloads at their Rust emit site.
/// Handles: readiness propagation, attention notifications (approval / user
/// input required), and settlement of submitted receipts on provider turn
/// completion.
pub(crate) fn todo_dispatch_observe_activity_hook(
    app: &AppHandle,
    payload: &TerminalActivityHookPayload,
) {
    todo_dispatch_observe_activity_hook_readiness(app, payload);
    let event_type = todo_dispatch_normalize_activity_hook_event_type(&payload.event_type);

    let needs_attention = payload.manual_approval_required
        || payload.terminal_is_prompting_user
        || matches!(
            event_type.as_str(),
            "provider-manual-approval-required" | "provider-user-input-required"
    );
    if needs_attention {
        // Watching the workspace's terminals means the pane chip and in-app
        // attention cue are already on screen — a time-sensitive native
        // banner on top of them is noise. Suppression must not claim the
        // interaction generation's notification edge.
        let watched = native_attention_watching_workspace(payload.workspace_id.trim());
        let notify = || {
            let workspace_name = payload.workspace_name.trim();
            let title = "Diff Forge: approval required";
            let body = if workspace_name.is_empty() {
                "A coding agent terminal is waiting on a tool approval.".to_string()
            } else {
                format!("A coding agent in {workspace_name} is waiting on a tool approval.")
            };
            todo_dispatch_native_attention_notify(app, title, &body)
        };
        if let Some(dedupe_key) = todo_dispatch_attention_interaction_key(payload) {
            todo_dispatch_try_attention_notification(dedupe_key, watched, notify);
        } else if !watched {
            notify();
        }
    }

    let settle_status = todo_dispatch_activity_hook_settle_status(payload, &event_type);
    let Some(settle_status) = settle_status else {
        return;
    };
    // Orchestrator-pool sends complete on turn settlement, not PTY write —
    // cheap map-miss no-op for every pane the pool doesn't own.
    orchestrator_pool_observe_turn_settled(app, payload.pane_id.trim(), settle_status);
    let settled_prompt_text = payload
        .user_message
        .as_deref()
        .or(payload.message.as_deref())
        .unwrap_or_default()
        .trim_start();
    if settled_prompt_text.starts_with("/model") {
        log_terminal_status_event(
            "backend.todo_dispatch.hook_settle_skip",
            json!({
                "event_type": event_type,
                "pane_id": payload.pane_id,
                "reason": "model_command_turn",
                "status": settle_status,
            }),
        );
        return;
    }
    let workspace_id = payload.workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        log_terminal_status_event(
            "backend.todo_dispatch.hook_settle_skip",
            json!({
                "event_type": event_type,
                "pane_id": payload.pane_id,
                "reason": "missing_workspace",
                "status": settle_status,
            }),
        );
        return;
    }
    let receipts = todo_dispatch_load(&workspace_id);
    let pane_id = payload.pane_id.trim();
    let turn_refs = [
        payload.provider_turn_id.as_deref(),
        payload.turn_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(str::to_string)
    .collect::<Vec<_>>();
    let matched = receipts.as_object().and_then(|entries| {
        let active = entries
            .iter()
            .filter(|(_, receipt)| todo_dispatch_receipt_active_for_settlement(receipt))
            .filter(|(_, receipt)| todo_dispatch_receipt_submitted_after_app_start(receipt))
            .map(|(command_id, receipt)| {
                let receipt_pane_id = receipt
                    .get("pane_id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .unwrap_or_default();
                let pane_score = if !pane_id.is_empty() && receipt_pane_id == pane_id {
                    100u16
                } else {
                    0u16
                };
                let receipt_turn_refs = [
                    todo_dispatch_text(
                        receipt,
                        &[
                            "prompt_event_id",
                            "prompt_id",
                            "provider_turn_id",
                            "turn_id",
                        ],
                    ),
                    command_id.clone(),
                ];
                let turn_score = if !turn_refs.is_empty()
                    && receipt_turn_refs.iter().any(|candidate| {
                        let candidate = candidate.trim();
                        !candidate.is_empty()
                            && turn_refs.iter().any(|turn_ref| turn_ref == candidate)
                    }) {
                    1_000u16
                } else {
                    0u16
                };
                (
                    command_id.clone(),
                    receipt.clone(),
                    todo_dispatch_receipt_submitted_at_ms(receipt),
                    turn_score + pane_score,
                )
            })
            .collect::<Vec<_>>();
        if active.is_empty() {
            return None;
        }

        let mut matches = active
            .iter()
            .filter(|(_, _, _, score)| *score > 0)
            .cloned()
            .collect::<Vec<_>>();
        if matches.is_empty() && active.len() == 1 && turn_refs.is_empty() {
            matches = active.clone();
        }
        matches.sort_by(|left, right| right.3.cmp(&left.3).then_with(|| right.2.cmp(&left.2)));
        matches
            .first()
            .cloned()
            .map(|(command_id, receipt, _, score)| {
                let match_source = if score >= 1_000 {
                    "receipt_turn"
                } else if score >= 100 {
                    "receipt_pane"
                } else {
                    "receipt_single"
                };
                (command_id, receipt, match_source.to_string())
            })
    });

    let (command_id, receipt, match_source) = if let Some(matched) = matched {
        matched
    } else {
        if !turn_refs.is_empty() {
            log_terminal_status_event(
                "backend.todo_dispatch.hook_settle_skip",
                json!({
                    "event_type": event_type,
                    "pane_id": payload.pane_id,
                    "reason": "turn_refs_without_receipt_match",
                    "status": settle_status,
                    "turn_refs": turn_refs,
                    "workspace_id": workspace_id,
                }),
            );
            return;
        }
        if settled_prompt_text.is_empty() {
            log_terminal_status_event(
                "backend.todo_dispatch.hook_settle_skip",
                json!({
                    "event_type": event_type,
                    "pane_id": payload.pane_id,
                    "reason": "promptless_turn_without_receipt",
                    "status": settle_status,
                    "workspace_id": workspace_id,
                }),
            );
            return;
        }
        let queue_candidates =
            todo_dispatch_fresh_active_queue_item_ids_for_pane(&workspace_id, pane_id);
        let Some(command_id) = queue_candidates.first().cloned() else {
            log_terminal_status_event(
                "backend.todo_dispatch.hook_settle_skip",
                json!({
                    "event_type": event_type,
                    "pane_id": payload.pane_id,
                    "reason": "no_submitted_receipt_or_active_queue_item",
                    "status": settle_status,
                    "workspace_id": workspace_id,
                }),
            );
            return;
        };
        (
            command_id.clone(),
            json!({
                "command_id": command_id,
                "item_id": command_id,
                "pane_id": pane_id,
                "status": "submitted",
                "text": payload.message.as_deref().or(payload.user_message.as_deref()).unwrap_or_default().chars().take(180).collect::<String>(),
                "workspace_id": workspace_id,
                "workspace_name": payload.workspace_name.trim(),
            }),
            "active_queue_pane_fallback".to_string(),
        )
    };
    let mut update = receipt;
    if let Some(object) = update.as_object_mut() {
        object.insert("status".to_string(), json!(settle_status));
        if settle_status == "completed" {
            let completed_at = payload
                .completed_at
                .as_deref()
                .or(payload.input_ready_at.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or_else(chrono_like_now_iso);
            object.insert("completed_at".to_string(), json!(completed_at.clone()));
            object.insert("todo_completed_at".to_string(), json!(completed_at));
        }
        if object
            .get("workspace_name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .is_empty()
            && !payload.workspace_name.trim().is_empty()
        {
            object.insert(
                "workspace_name".to_string(),
                json!(payload.workspace_name.trim()),
            );
        }
    }
    let _ = todo_dispatch_record_receipt_internal(
        Some(app),
        &workspace_id,
        update,
        "activity_hook_settled",
    );
    todo_dispatch_queue_mark_settled(Some(app), &workspace_id, &command_id, settle_status);
    log_terminal_status_event(
        "backend.todo_dispatch.hook_settled",
        json!({
            "command_id": command_id,
            "event_type": event_type,
            "match_source": match_source,
            "pane_id": payload.pane_id,
            "status": settle_status,
            "workspace_id": workspace_id,
        }),
    );
}

// ---------------------------------------------------------------------------
// Background dispatcher readiness: queue snapshots, terminal runtime
// registry, backend prompt submission, and the replay journal. Rust owns
// queued-todo submission in foreground and background; the webview only
// mirrors store state and asks Rust for explicit user mutations.
// ---------------------------------------------------------------------------

const TODO_DISPATCH_DISPATCHER_LEASE_MS: u64 = 15_000;
const TODO_DISPATCH_BACKEND_TICK_MS: u64 = 5_000;
const TODO_DISPATCH_BACKEND_SAFETY_FULL_PASS_TICKS: u64 = 12;
const TODO_DISPATCH_TERMINAL_RUNTIME_TTL_MS: u64 = 6 * 60 * 60 * 1000;
const TODO_DISPATCH_JOURNAL_MAX_ENTRIES: usize = 200;
const TODO_DISPATCH_STARTUP_RECONCILE_EVENT: &str = "todo-dispatch-startup-reconcile";
const TODO_DISPATCH_STARTUP_RECONCILE_MS: u64 = 45_000;
const TODO_DISPATCH_STARTUP_RECONCILE_MIN_MS: u64 = 1_500;
const TODO_STORE_DRAFT_TEXT_MAX_CHARS: usize = 2_000_000;

static TODO_DISPATCH_WEBVIEW_HEARTBEAT_MS: AtomicU64 = AtomicU64::new(0);
static TODO_DISPATCH_TERMINAL_RUNTIME: OnceLock<StdMutex<HashMap<String, Value>>> = OnceLock::new();
static TODO_DISPATCH_BACKEND_TICK_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static TODO_DISPATCH_QUEUE_STORE_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static TODO_DISPATCH_STARTUP_RECONCILE_STARTED_MS: AtomicU64 = AtomicU64::new(0);
static TODO_DISPATCH_STARTUP_RECONCILE_UNTIL_MS: AtomicU64 = AtomicU64::new(0);
static TODO_DISPATCH_STARTUP_RECONCILE_OBSERVED_MS: AtomicU64 = AtomicU64::new(0);

fn todo_dispatch_queue_store_guard() -> std::sync::MutexGuard<'static, ()> {
    TODO_DISPATCH_QUEUE_STORE_LOCK
        .get_or_init(|| StdMutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn todo_dispatch_data_path(kind: &str, workspace_id: &str) -> Option<PathBuf> {
    let root = cloud_mcp_local_data_file_path("todo-dispatch")?.join(kind);
    fs::create_dir_all(&root).ok()?;
    Some(root.join(format!(
        "{}.json",
        todo_dispatch_safe_workspace_id(workspace_id)
    )))
}

fn todo_dispatch_data_workspace_files(kind: &str) -> Vec<PathBuf> {
    let Some(root) = cloud_mcp_local_data_file_path("todo-dispatch").map(|root| root.join(kind))
    else {
        return Vec::new();
    };
    let Ok(read_dir) = fs::read_dir(&root) else {
        return Vec::new();
    };
    read_dir
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("json"))
        .collect()
}

#[derive(Clone, Eq, PartialEq)]
struct TodoDispatchQueueFileFingerprint {
    path: PathBuf,
    len: Option<u64>,
    modified: Option<SystemTime>,
}

fn todo_dispatch_queue_files_fingerprint() -> Vec<TodoDispatchQueueFileFingerprint> {
    let mut paths = todo_dispatch_data_workspace_files("queues");
    paths.sort();
    paths
        .into_iter()
        .map(|path| {
            let metadata = fs::metadata(&path).ok();
            TodoDispatchQueueFileFingerprint {
                path,
                len: metadata.as_ref().map(|metadata| metadata.len()),
                modified: metadata.and_then(|metadata| metadata.modified().ok()),
            }
        })
        .collect()
}

fn todo_dispatch_workspace_is_deleted(workspace_id: &str) -> bool {
    let workspace_id = workspace_id.trim();
    !workspace_id.is_empty() && cloud_mcp_deleted_workspace_ids().contains(workspace_id)
}

fn todo_dispatch_queue_read(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .map(|value| todo_dispatch_map_persisted_keys(value, true))
        .unwrap_or_else(|| json!({}))
}

fn todo_store_enforce_terminal_id_assignment(item: &mut Value) {
    let direct_terminal_id = todo_dispatch_text(item, &["target_terminal_id"]);
    let direct_terminal_index = todo_dispatch_i64(item, &["target_terminal_index"]);
    let direct_terminal_name = todo_dispatch_text(item, &["target_terminal_name"]);
    let direct_thread_id = todo_dispatch_text(item, &["target_thread_id"]);
    let has_direct_selector = !direct_terminal_id.is_empty()
        || direct_terminal_index.is_some()
        || !direct_terminal_name.is_empty()
        || !direct_thread_id.is_empty();
    let remote = item.get("remote_command");
    let target_terminal_id = if has_direct_selector {
        direct_terminal_id
    } else {
        remote
            .map(|value| todo_dispatch_text(value, &["target_terminal_id"]))
            .unwrap_or_default()
    };
    let target_terminal_index = if has_direct_selector {
        direct_terminal_index
    } else {
        remote.and_then(|value| todo_dispatch_i64(value, &["target_terminal_index"]))
    };
    let target_terminal_name = if has_direct_selector {
        direct_terminal_name
    } else {
        remote
            .map(|value| todo_dispatch_text(value, &["target_terminal_name"]))
            .unwrap_or_default()
    };
    let target_thread_id = if has_direct_selector {
        direct_thread_id
    } else {
        remote
            .map(|value| todo_dispatch_text(value, &["target_thread_id"]))
            .unwrap_or_default()
    };
    let has_terminal_selector = !target_terminal_id.is_empty()
        || target_terminal_index.is_some()
        || !target_terminal_name.is_empty()
        || !target_thread_id.is_empty();
    let target_keys = [
        "target_color_slot",
        "target_terminal_color",
        "target_terminal_id",
        "target_terminal_index",
        "target_terminal_name",
        "target_thread_id",
        "target_explicit",
        "explicit_target",
        "user_pinned_target",
    ];
    if let Some(object) = item.as_object_mut() {
        if !has_terminal_selector {
            for key in target_keys {
                object.remove(key);
            }
        } else {
            for key in [
                "target_terminal_id",
                "target_terminal_index",
                "target_terminal_name",
                "target_thread_id",
            ] {
                object.remove(key);
            }
            if !target_terminal_id.is_empty() {
                object.insert(
                    "target_terminal_id".to_string(),
                    json!(target_terminal_id.clone()),
                );
            }
            if let Some(index) = target_terminal_index {
                object.insert("target_terminal_index".to_string(), json!(index));
            }
            if !target_terminal_name.is_empty() {
                object.insert(
                    "target_terminal_name".to_string(),
                    json!(target_terminal_name.clone()),
                );
            }
            if !target_thread_id.is_empty() {
                object.insert(
                    "target_thread_id".to_string(),
                    json!(target_thread_id.clone()),
                );
            }
            object.insert("target_explicit".to_string(), json!(true));
            object.insert("explicit_target".to_string(), json!(true));
            object.insert("user_pinned_target".to_string(), json!(true));
        }
        if let Some(remote) = object
            .get_mut("remote_command")
            .and_then(Value::as_object_mut)
        {
            if !has_terminal_selector {
                for key in target_keys {
                    remote.remove(key);
                }
            } else {
                for key in [
                    "target_terminal_id",
                    "target_terminal_index",
                    "target_terminal_name",
                    "target_thread_id",
                ] {
                    remote.remove(key);
                }
                if !target_terminal_id.is_empty() {
                    remote.insert(
                        "target_terminal_id".to_string(),
                        json!(target_terminal_id),
                    );
                }
                if let Some(index) = target_terminal_index {
                    remote.insert("target_terminal_index".to_string(), json!(index));
                }
                if !target_terminal_name.is_empty() {
                    remote.insert(
                        "target_terminal_name".to_string(),
                        json!(target_terminal_name),
                    );
                }
                if !target_thread_id.is_empty() {
                    remote.insert("target_thread_id".to_string(), json!(target_thread_id));
                }
            }
        }
    }
}

fn todo_dispatch_queue_write(workspace_id: &str, items: &[Value]) {
    let Some(path) = todo_dispatch_data_path("queues", workspace_id) else {
        return;
    };
    let normalized_items = items
        .iter()
        .cloned()
        .map(|mut item| {
            todo_store_enforce_terminal_id_assignment(&mut item);
            item
        })
        .collect();
    let items =
        todo_store_dedupe_logical_items(todo_store_canonicalize_settled_items(normalized_items));
    let snapshot = json!({
        "workspace_id": workspace_id,
        "items": items,
        "updated_at_ms": todo_dispatch_now_ms(),
    });
    let persisted = todo_dispatch_map_persisted_keys(snapshot, false);
    if let Ok(bytes) = serde_json::to_vec(&persisted) {
        let _ = fs::write(path, bytes);
    }
}

fn todo_dispatch_startup_reconcile_active() -> bool {
    let until = TODO_DISPATCH_STARTUP_RECONCILE_UNTIL_MS.load(Ordering::Acquire);
    until != 0 && todo_dispatch_now_ms() < until
}

fn todo_dispatch_startup_reconcile_payload(reason: &str) -> Value {
    let now = todo_dispatch_now_ms();
    let started = TODO_DISPATCH_STARTUP_RECONCILE_STARTED_MS.load(Ordering::Acquire);
    let until = TODO_DISPATCH_STARTUP_RECONCILE_UNTIL_MS.load(Ordering::Acquire);
    let observed = TODO_DISPATCH_STARTUP_RECONCILE_OBSERVED_MS.load(Ordering::Acquire);
    let active = until != 0 && now < until;
    json!({
        "active": active,
        "duration_ms": TODO_DISPATCH_STARTUP_RECONCILE_MS,
        "elapsed_ms": if started == 0 { 0 } else { now.saturating_sub(started) },
        "observed_at_ms": observed,
        "reason": reason,
        "remaining_ms": if active { until.saturating_sub(now) } else { 0 },
        "started_at_ms": started,
        "until_ms": until,
    })
}

fn todo_dispatch_emit_startup_reconcile(app: &AppHandle, reason: &str) {
    let _ = app.emit(
        TODO_DISPATCH_STARTUP_RECONCILE_EVENT,
        todo_dispatch_startup_reconcile_payload(reason),
    );
}

fn todo_dispatch_startup_reconcile_pending_workspace_ids() -> HashSet<String> {
    let mut workspace_ids = HashSet::new();
    for path in todo_dispatch_data_workspace_files("queues") {
        let snapshot = todo_dispatch_queue_read(&path);
        let workspace_id = snapshot
            .get("workspace_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .to_string();
        if workspace_id.is_empty() {
            continue;
        }
        let has_pending = snapshot
            .get("items")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items.iter().any(|item| {
                    matches!(
                        todo_store_item_status(item).as_str(),
                        "queued" | "sending" | "submitted" | "running" | "dispatching"
                    )
                })
            });
        if has_pending {
            workspace_ids.insert(workspace_id);
        }
    }
    workspace_ids
}

async fn todo_dispatch_startup_reconcile_observed_workspace_ids(
    app: &AppHandle,
) -> HashSet<String> {
    let mut workspace_ids = {
        let terminal_state = app.state::<TerminalState>();
        let guard = terminal_state.terminals.read().await;
        guard
            .values()
            .map(|instance| instance.metadata.workspace_id.trim().to_string())
            .filter(|workspace_id| !workspace_id.is_empty())
            .collect::<HashSet<_>>()
    };
    let registry = TODO_DISPATCH_TERMINAL_RUNTIME.get_or_init(|| StdMutex::new(HashMap::new()));
    if let Ok(map) = registry.lock() {
        let now = todo_dispatch_now_ms();
        for entry in map.values() {
            let fresh = entry
                .get("updated_at_ms")
                .and_then(Value::as_u64)
                .is_some_and(|at| now.saturating_sub(at) < TODO_DISPATCH_TERMINAL_RUNTIME_TTL_MS);
            if !fresh {
                continue;
            }
            if let Some(workspace_id) = entry
                .get("workspace_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|workspace_id| !workspace_id.is_empty())
            {
                workspace_ids.insert(workspace_id.to_string());
            }
        }
    }
    workspace_ids
}

async fn todo_dispatch_startup_reconcile_ready(app: &AppHandle) -> bool {
    let pending = todo_dispatch_startup_reconcile_pending_workspace_ids();
    if pending.is_empty() {
        return true;
    }
    let observed = todo_dispatch_startup_reconcile_observed_workspace_ids(app).await;
    !observed.is_empty()
        && pending
            .iter()
            .all(|workspace_id| observed.contains(workspace_id))
}

async fn todo_store_item_has_recovered_inflight(app: &AppHandle, item: &Value) -> bool {
    let pane_id = todo_store_item_pane_id(item);
    if pane_id.is_empty() {
        return false;
    }
    let target_instance_id = item
        .get("terminal_instance_id")
        .or_else(|| item.get("instance_id"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    todo_dispatch_pane_input_ready_authoritative(app, &pane_id, target_instance_id).await
        == Some(false)
}

async fn todo_store_startup_reconcile_finalize_queues(app: &AppHandle) -> usize {
    let mut changed_count = 0usize;
    for path in todo_dispatch_data_workspace_files("queues") {
        let snapshot = todo_dispatch_queue_read(&path);
        let workspace_id = snapshot
            .get("workspace_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .to_string();
        if workspace_id.is_empty() {
            continue;
        }
        let items = snapshot
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut planned_corrections = Vec::<(Value, String, String)>::new();
        for item_snapshot in items {
            match todo_store_item_status(&item_snapshot).as_str() {
                "queued" => {}
                "sending" | "dispatching" => {
                    planned_corrections.push((
                        item_snapshot,
                        "queued".to_string(),
                        "app_restart_requeued".to_string(),
                    ));
                }
                "submitted" | "running" => {
                    if todo_store_item_has_recovered_inflight(app, &item_snapshot).await {
                        continue;
                    }
                    planned_corrections.push((
                        item_snapshot,
                        "interrupted".to_string(),
                        "app_restart".to_string(),
                    ));
                }
                _ => {}
            }
        }
        if planned_corrections.is_empty() {
            continue;
        }
        let mut corrections = Vec::new();
        {
            let _store_guard = todo_dispatch_queue_store_guard();
            let current_snapshot = todo_dispatch_queue_read(&path);
            let mut current_items = current_snapshot
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for (planned_item, next_status, reason) in planned_corrections {
                for item in &mut current_items {
                    if !todo_store_items_share_identity(item, &planned_item) {
                        continue;
                    }
                    let current_status = todo_store_item_status(item);
                    let eligible = match next_status.as_str() {
                        "queued" => matches!(current_status.as_str(), "sending" | "dispatching"),
                        "interrupted" => {
                            matches!(current_status.as_str(), "submitted" | "running")
                        }
                        _ => false,
                    };
                    if !eligible {
                        continue;
                    }
                    todo_store_set_item_status(item, &next_status, &reason);
                    corrections.push(item.clone());
                }
            }
            if corrections.is_empty() {
                continue;
            }
            todo_dispatch_queue_write(&workspace_id, &current_items);
        }
        changed_count += corrections.len();
        todo_store_push_corrections(
            app,
            &workspace_id,
            corrections.clone(),
            "app_restart_reconcile",
        );
        todo_store_emit_changed(app, &workspace_id, "app_restart_reconcile", "store");
        todo_dispatch_emit_loopspace_batch_lifecycles(app, &corrections);
    }

    let stale = cloud_mcp_todo_mirror_device_items_in_statuses(
        &["running", "sending", "submitted", "dispatching"],
        0,
    );
    let mut by_workspace: HashMap<String, Vec<Value>> = HashMap::new();
    for (workspace_id, mut item) in stale {
        if workspace_id.is_empty() {
            continue;
        }
        let tracked = todo_dispatch_data_path("queues", &workspace_id)
            .map(|path| {
                let _store_guard = todo_dispatch_queue_store_guard();
                todo_dispatch_queue_read(&path)
                    .get("items")
                    .and_then(Value::as_array)
                    .is_some_and(|items| {
                        items
                            .iter()
                            .any(|candidate| todo_store_items_share_identity(candidate, &item))
                    })
            })
            .unwrap_or(false);
        if tracked {
            continue;
        }
        todo_store_set_item_status(&mut item, "interrupted", "app_restart");
        by_workspace.entry(workspace_id).or_default().push(item);
    }
    let mut lifecycle_items = Vec::new();
    for (workspace_id, items) in by_workspace {
        changed_count += items.len();
        lifecycle_items.extend(items.iter().cloned());
        todo_store_push_corrections(
            app,
            &workspace_id,
            items.clone(),
            "app_restart_reconcile",
        );
        todo_store_emit_changed(app, &workspace_id, "app_restart_reconcile", "store");
    }
    todo_dispatch_emit_loopspace_batch_lifecycles(app, &lifecycle_items);
    changed_count
}

async fn todo_dispatch_finish_startup_reconciliation(app: &AppHandle, reason: &str) {
    let previous_until = TODO_DISPATCH_STARTUP_RECONCILE_UNTIL_MS.swap(0, Ordering::AcqRel);
    if previous_until == 0 {
        return;
    }
    let changed = todo_store_startup_reconcile_finalize_queues(app).await;
    let marked_receipts =
        todo_dispatch_mark_active_receipts_interrupted(Some(app), "app_crash_recovered");
    log_terminal_status_event(
        "backend.todo_dispatch.startup_reconcile_finish",
        json!({
            "changed": changed,
            "marked_receipts": marked_receipts,
            "reason": reason,
        }),
    );
    todo_dispatch_emit_startup_reconcile(app, reason);
    todo_dispatch_wake_background_dispatcher(app.clone());
}

fn todo_dispatch_note_startup_reconciliation_evidence(app: &AppHandle, reason: &str) {
    if !todo_dispatch_startup_reconcile_active() {
        return;
    }
    TODO_DISPATCH_STARTUP_RECONCILE_OBSERVED_MS.store(todo_dispatch_now_ms(), Ordering::Release);
    todo_dispatch_emit_startup_reconcile(app, reason);
}

pub(crate) fn todo_dispatch_begin_startup_reconciliation(app: AppHandle) {
    let now = todo_dispatch_now_ms();
    let _ = TODO_DISPATCH_APP_STARTED_MS.set(now);
    let until = now.saturating_add(TODO_DISPATCH_STARTUP_RECONCILE_MS);
    TODO_DISPATCH_STARTUP_RECONCILE_STARTED_MS.store(now, Ordering::Release);
    TODO_DISPATCH_STARTUP_RECONCILE_OBSERVED_MS.store(0, Ordering::Release);
    TODO_DISPATCH_STARTUP_RECONCILE_UNTIL_MS.store(until, Ordering::Release);
    todo_dispatch_emit_startup_reconcile(&app, "startup_reconcile_begin");

    tauri::async_runtime::spawn(async move {
        loop {
            sleep(Duration::from_millis(500)).await;
            if APP_SHUTDOWN_PHASE.load(Ordering::Acquire) != APP_SHUTDOWN_PHASE_RUNNING {
                return;
            }
            if !todo_dispatch_startup_reconcile_active() {
                return;
            }
            let now = todo_dispatch_now_ms();
            let started = TODO_DISPATCH_STARTUP_RECONCILE_STARTED_MS.load(Ordering::Acquire);
            if now.saturating_sub(started) >= TODO_DISPATCH_STARTUP_RECONCILE_MIN_MS
                && todo_dispatch_startup_reconcile_ready(&app).await
            {
                todo_dispatch_finish_startup_reconciliation(&app, "startup_authoritative_ready")
                    .await;
                return;
            }
            let until = TODO_DISPATCH_STARTUP_RECONCILE_UNTIL_MS.load(Ordering::Acquire);
            if until != 0 && now >= until {
                todo_dispatch_finish_startup_reconciliation(&app, "startup_reconcile_timeout")
                    .await;
                return;
            }
        }
    });
}

/// Terminal runtime registry, fed by activity hook payloads and authoritative
/// prompt-submit observations: pane id -> workspace, agent kind, thread,
/// index, instance, input-ready state, and latest lifecycle state. This is
/// what lets Rust pick a dispatch target and settle queue state without the
/// webview.
fn todo_dispatch_update_terminal_runtime(payload: &TerminalActivityHookPayload) {
    let pane_id = payload.pane_id.trim();
    if pane_id.is_empty() || payload.workspace_id.trim().is_empty() {
        return;
    }
    let registry = TODO_DISPATCH_TERMINAL_RUNTIME.get_or_init(|| StdMutex::new(HashMap::new()));
    let Ok(mut map) = registry.lock() else {
        return;
    };
    let now = todo_dispatch_now_ms();
    map.retain(|_, entry| {
        entry
            .get("updated_at_ms")
            .and_then(Value::as_u64)
            .is_some_and(|at| now.saturating_sub(at) < TODO_DISPATCH_TERMINAL_RUNTIME_TTL_MS)
    });
    map.insert(
        pane_id.to_string(),
        json!({
            "terminal_state_contract_version": payload.terminal_state_contract_version,
            "background_work_active": payload.background_work_active,
            "canonical_state": payload.canonical_state.clone(),
            "canonical_badge_label": payload.canonical_badge_label.clone(),
            "canonical_state_seq": payload.canonical_state_seq,
            "prompt_state_seq": payload.prompt_state_seq,
            "turn_active": payload.turn_active,
            "turn_generation": payload.turn_generation,
            "completed_turn_generation": payload.completed_turn_generation,
            "active_interaction_id": payload.active_interaction_id.clone(),
            "active_interaction_revision": payload.active_interaction_revision,
            "interaction_actionable": payload.interaction_actionable,
            "activity_status": payload.activity_status.clone(),
            "agent_id": payload.agent_id.clone(),
            "agent_display_name": payload.agent_display_name.clone(),
            "agent_kind": payload.agent_kind.clone(),
            "command_phase": payload.command_phase.clone(),
            "completed_at": payload.completed_at.clone(),
            "display_name": payload.display_name.clone(),
            "event_type": payload.event_type.clone(),
            "input_ready": payload.input_ready,
            "input_ready_at": payload.input_ready_at.clone(),
            "instance_id": payload.instance_id,
            "pane_id": pane_id,
            "pending_prompt_id": payload.provider_turn_id.clone().or_else(|| payload.turn_id.clone()),
            "prompt_ready_at": payload.prompt_ready_at.clone(),
            "provider": payload.provider.clone(),
            "provider_session_id": payload.provider_session_id.clone(),
            "provider_turn_id": payload.provider_turn_id.clone(),
            "status": payload.status.clone(),
            "terminal_index": payload.terminal_index,
            "terminal_name": payload.terminal_name.clone(),
            "terminal_nickname": payload.terminal_nickname.clone(),
            "thread_id": payload.thread_id.clone(),
            "updated_at_ms": now,
            "workspace_id": payload.workspace_id.trim(),
            "workspace_name": payload.workspace_name.trim(),
        }),
    );
}

pub(crate) fn todo_dispatch_observe_prompt_submitted(
    workspace_id: &str,
    workspace_name: &str,
    pane_id: &str,
    terminal_index: Option<u16>,
    thread_id: &str,
    agent_id: &str,
    agent_kind: &str,
    instance_id: u64,
    prompt_event_id: Option<&str>,
    submitted_at: Option<&str>,
    source: &str,
) {
    let workspace_id = workspace_id.trim();
    let pane_id = pane_id.trim();
    if workspace_id.is_empty() || pane_id.is_empty() {
        return;
    }
    let registry = TODO_DISPATCH_TERMINAL_RUNTIME.get_or_init(|| StdMutex::new(HashMap::new()));
    let Ok(mut map) = registry.lock() else {
        return;
    };
    let now = todo_dispatch_now_ms();
    map.retain(|_, entry| {
        entry
            .get("updated_at_ms")
            .and_then(Value::as_u64)
            .is_some_and(|at| now.saturating_sub(at) < TODO_DISPATCH_TERMINAL_RUNTIME_TTL_MS)
    });
    let mut entry = map
        .get(pane_id)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let prompt_event_id = prompt_event_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let submitted_at = submitted_at
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    entry.insert("activity_status".to_string(), json!("thinking"));
    entry.insert("agent_id".to_string(), json!(agent_id));
    entry.insert("agent_kind".to_string(), json!(agent_kind));
    entry.insert("command_phase".to_string(), json!("running"));
    entry.insert("event_type".to_string(), json!("message-submitted"));
    entry.insert("input_ready".to_string(), json!(false));
    entry.insert("instance_id".to_string(), json!(instance_id));
    entry.insert("pane_id".to_string(), json!(pane_id));
    entry.insert("source".to_string(), json!(source.trim()));
    entry.insert("status".to_string(), json!("active"));
    entry.insert("terminal_index".to_string(), json!(terminal_index));
    entry.insert("thread_id".to_string(), json!(thread_id));
    entry.insert("updated_at_ms".to_string(), json!(now));
    entry.insert("workspace_id".to_string(), json!(workspace_id));
    entry.insert("workspace_name".to_string(), json!(workspace_name.trim()));
    if let Some(prompt_event_id) = prompt_event_id {
        entry.insert("prompt_event_id".to_string(), json!(prompt_event_id));
        entry.insert("pending_prompt_id".to_string(), json!(prompt_event_id));
    }
    if let Some(submitted_at) = submitted_at {
        entry.insert("prompt_submitted_at".to_string(), json!(submitted_at));
    }
    map.insert(pane_id.to_string(), Value::Object(entry));
}

fn todo_dispatch_terminal_runtime_mark_busy(pane_id: &str) {
    let registry = TODO_DISPATCH_TERMINAL_RUNTIME.get_or_init(|| StdMutex::new(HashMap::new()));
    if let Ok(mut map) = registry.lock() {
        if let Some(entry) = map.get_mut(pane_id) {
            if let Some(object) = entry.as_object_mut() {
                object.insert("activity_status".to_string(), json!("thinking"));
                object.insert("command_phase".to_string(), json!("running"));
                object.insert("event_type".to_string(), json!("message-submitted"));
                object.insert("input_ready".to_string(), json!(false));
                object.insert("status".to_string(), json!("active"));
                object.insert("updated_at_ms".to_string(), json!(todo_dispatch_now_ms()));
            }
        }
    }
}

fn todo_dispatch_journal_append(workspace_id: &str, entry: Value) {
    let Some(path) = todo_dispatch_data_path("journal", workspace_id) else {
        return;
    };
    let mut entries = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<Value>>(&raw).ok())
        .unwrap_or_default();
    entries.push(entry);
    if entries.len() > TODO_DISPATCH_JOURNAL_MAX_ENTRIES {
        let overflow = entries.len() - TODO_DISPATCH_JOURNAL_MAX_ENTRIES;
        entries.drain(0..overflow);
    }
    if let Ok(bytes) = serde_json::to_vec(&entries) {
        let _ = fs::write(path, bytes);
    }
}

// ---------------------------------------------------------------------------
// Authoritative todo store layer.
//
// The queue store file is the device's single todo truth. Tombstones are
// terminal and live beside it: once a todo id is tombstoned nothing — journal
// adoption, remote intake, webview snapshots, cloud echoes — may bring it
// back. Every store mutation emits TODO_STORE_CHANGED_EVENT so the webview
// (a renderer, not an owner) re-pulls the snapshot; account convergence rides
// the supported todo sync/content contracts.
// ---------------------------------------------------------------------------

pub(crate) const TODO_STORE_CHANGED_EVENT: &str = "todo-store-changed";
pub(crate) const TODO_STORE_CANCEL_REQUESTED_EVENT: &str = "todo-store-cancel-requested";
const TODO_STORE_TOMBSTONE_MAX: usize = 2000;
const TODO_STORE_ORPHAN_AFTER_MS: u64 = 15 * 60 * 1000;
const TODO_STORE_ORPHAN_SWEEP_INTERVAL_SECS: u64 = 30 * 60;
const TODO_STORE_ORPHAN_SWEEP_INITIAL_DELAY_SECS: u64 = 90;
const TODO_STORE_ORPHAN_SWEEP_DEBOUNCE_MS: u64 = 7_000;
const TODO_STORE_ACTIVE_RUN_STATUSES: [&str; 2] = ["running", "sending"];

fn todo_store_orphan_sweep_notify() -> Arc<tokio::sync::Notify> {
    TODO_STORE_ORPHAN_SWEEP_NOTIFY
        .get_or_init(|| Arc::new(tokio::sync::Notify::new()))
        .clone()
}

pub(crate) fn todo_store_orphan_sweep_shutdown_notify() {
    todo_store_orphan_sweep_notify().notify_one();
}

pub(crate) fn todo_store_orphan_sweep_trigger(_reason: &'static str) {
    if APP_SHUTDOWN_PHASE.load(Ordering::Acquire) != APP_SHUTDOWN_PHASE_RUNNING {
        return;
    }
    let notify = todo_store_orphan_sweep_notify();
    if TODO_STORE_ORPHAN_SWEEP_DEBOUNCE_PENDING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(TODO_STORE_ORPHAN_SWEEP_DEBOUNCE_MS)).await;
        TODO_STORE_ORPHAN_SWEEP_DEBOUNCE_PENDING.store(false, Ordering::Release);
        if APP_SHUTDOWN_PHASE.load(Ordering::Acquire) != APP_SHUTDOWN_PHASE_RUNNING {
            return;
        }
        notify.notify_one();
    });
}

fn todo_store_tombstones_read(workspace_id: &str) -> serde_json::Map<String, Value> {
    let Some(path) = todo_dispatch_data_path("tombstones", workspace_id) else {
        return serde_json::Map::new();
    };
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn todo_store_tombstones_write(workspace_id: &str, tombstones: &serde_json::Map<String, Value>) {
    let Some(path) = todo_dispatch_data_path("tombstones", workspace_id) else {
        return;
    };
    if let Ok(bytes) = serde_json::to_vec(&Value::Object(tombstones.clone())) {
        let _ = fs::write(path, bytes);
    }
}

pub(crate) fn todo_store_tombstone_ids(workspace_id: &str) -> HashSet<String> {
    todo_store_tombstones_read(workspace_id)
        .keys()
        .map(|key| key.to_string())
        .collect()
}

/// Union of every workspace's tombstoned todo ids. The cloud mirror is
/// account-scoped (peer devices, repo-peer workspaces), so mirror writes must
/// honor deletions no matter which workspace the delete happened under.
pub(crate) fn todo_store_all_tombstone_ids() -> HashSet<String> {
    let mut ids = HashSet::new();
    for path in todo_dispatch_data_workspace_files("tombstones") {
        let Some(entries) = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .and_then(|value| value.as_object().cloned())
        else {
            continue;
        };
        ids.extend(
            entries
                .keys()
                .map(|key| key.trim().to_string())
                .filter(|key| !key.is_empty()),
        );
    }
    ids
}

/// Records terminal tombstones for the given todo ids. Returns the ids that
/// were newly tombstoned (already-tombstoned ids are skipped so callers can
/// avoid duplicate downstream pushes).
pub(crate) fn todo_store_add_tombstones(
    workspace_id: &str,
    todo_ids: &[String],
    reason: &str,
    origin: &str,
) -> Vec<String> {
    let cleaned = todo_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if cleaned.is_empty() {
        return Vec::new();
    }
    let mut tombstones = todo_store_tombstones_read(workspace_id);
    let now_ms = todo_dispatch_now_ms();
    let mut added = Vec::new();
    for todo_id in cleaned {
        if tombstones.contains_key(&todo_id) {
            continue;
        }
        tombstones.insert(
            todo_id.clone(),
            json!({
                "deleted_at_ms": now_ms,
                "deleted_at": chrono_like_now_iso(),
                "reason": reason,
                "origin": origin,
            }),
        );
        added.push(todo_id);
    }
    if added.is_empty() {
        return added;
    }
    if tombstones.len() > TODO_STORE_TOMBSTONE_MAX {
        let mut entries = tombstones
            .iter()
            .map(|(key, value)| {
                (
                    key.clone(),
                    value
                        .get("deleted_at_ms")
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                )
            })
            .collect::<Vec<_>>();
        entries.sort_by_key(|(_, deleted_at)| *deleted_at);
        let overflow = tombstones.len() - TODO_STORE_TOMBSTONE_MAX;
        for (key, _) in entries.into_iter().take(overflow) {
            tombstones.remove(&key);
        }
    }
    todo_store_tombstones_write(workspace_id, &tombstones);
    added
}

pub(crate) fn todo_store_emit_changed(
    app: &AppHandle,
    workspace_id: &str,
    reason: &str,
    origin: &str,
) {
    let _ = app.emit(
        TODO_STORE_CHANGED_EVENT,
        json!({
            "workspace_id": workspace_id,
            "reason": reason,
            "origin": origin,
            "updated_at_ms": todo_dispatch_now_ms(),
        }),
    );
}

fn todo_store_item_matches_id(item: &Value, todo_id: &str) -> bool {
    if todo_id.is_empty() {
        return false;
    }
    let mut ids = vec![
        todo_dispatch_text(item, &["id", "todo_id", "item_id"]),
        todo_dispatch_queue_item_command_id(item),
    ];
    if let Some(remote) = item.get("remote_command") {
        ids.push(todo_dispatch_text(
            remote,
            &["todo_id", "command_id", "item_id"],
        ));
    }
    ids.into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .any(|id| id == todo_id)
}

fn todo_store_item_is_tombstoned(item: &Value, tombstoned: &HashSet<String>) -> bool {
    tombstoned
        .iter()
        .any(|id| todo_store_item_matches_id(item, id))
}

/// Splits incoming items into the kept set and the ids rejected because a
/// tombstone exists for them. This is the resurrection gate every write path
/// goes through.
fn todo_store_filter_tombstoned(
    items: Vec<Value>,
    tombstoned: &HashSet<String>,
) -> (Vec<Value>, Vec<String>) {
    if tombstoned.is_empty() {
        return (items, Vec::new());
    }
    let mut kept = Vec::with_capacity(items.len());
    let mut rejected = Vec::new();
    for item in items {
        if todo_store_item_is_tombstoned(&item, tombstoned) {
            if let Some(id) = item.get("id").and_then(Value::as_str).map(str::trim) {
                rejected.push(id.to_string());
            }
            continue;
        }
        kept.push(item);
    }
    (kept, rejected)
}

fn todo_store_item_status(item: &Value) -> String {
    let explicit = todo_store_item_explicit_status(item);
    if let Some((settled_status, settled_at)) = todo_store_item_settled_status_evidence(item) {
        if todo_store_settled_evidence_wins(item, &explicit, &settled_status, &settled_at) {
            return settled_status;
        }
    }
    explicit
}

fn todo_store_item_explicit_status(item: &Value) -> String {
    todo_store_normalize_lifecycle_status(&todo_dispatch_text(
        item,
        &["todo_status", "cloud_status", "status"],
    ))
}

fn todo_store_status_is_hard_delete_eligible(status: &str) -> bool {
    matches!(
        todo_store_normalize_lifecycle_status(status).as_str(),
        "" | "listed" | "queued"
    )
}

fn todo_store_status_is_terminal_touched(status: &str) -> bool {
    matches!(
        todo_store_normalize_lifecycle_status(status).as_str(),
        "running" | "paused" | "completed" | "failed" | "cancelled" | "interrupted" | "timed_out"
    )
}

fn todo_store_item_has_terminal_touch_evidence(item: &Value) -> bool {
    if todo_store_status_is_terminal_touched(&todo_store_item_status(item)) {
        return true;
    }
    !todo_dispatch_text(
        item,
        &[
            "last_dispatch_id",
            "dispatch_id",
            "submitted_at",
            "sent_at",
            "started_at",
            "running_at",
            "completed_at",
            "failed_at",
            "interrupted_at",
            "cancelled_at",
            "timed_out_at",
        ],
    )
    .is_empty()
}

fn todo_store_item_hard_delete_eligible(item: &Value) -> bool {
    todo_store_status_is_hard_delete_eligible(&todo_store_item_status(item))
        && !todo_store_item_has_terminal_touch_evidence(item)
}

fn todo_store_item_status_stamp_ms(item: &Value) -> u64 {
    let stamp = todo_dispatch_text(
        item,
        &["todo_status_updated_at", "status_updated_at", "updated_at"],
    );
    todo_dispatch_parse_iso_ms(&stamp).unwrap_or(0)
}

fn todo_store_item_settled_status_evidence(item: &Value) -> Option<(String, String)> {
    let evidence_fields: [(&str, &[&str]); 6] = [
        ("completed", &["todo_completed_at", "completed_at"]),
        (
            "cancelled",
            &["todo_cancelled_at", "cancelled_at", "canceled_at"],
        ),
        ("failed", &["todo_failed_at", "failed_at"]),
        ("interrupted", &["todo_interrupted_at", "interrupted_at"]),
        (
            "timed_out",
            &["todo_timed_out_at", "timed_out_at", "timeout_at"],
        ),
        ("deleted", &["todo_deleted_at", "deleted_at"]),
    ];
    let mut best: Option<(String, String, u64)> = None;
    for (status, keys) in evidence_fields {
        let at = todo_dispatch_text(item, keys);
        if at.is_empty() {
            continue;
        }
        let at_ms = todo_dispatch_parse_iso_ms(&at).unwrap_or(0);
        let replace = match &best {
            None => true,
            Some((_, best_at, best_ms)) if at_ms > 0 && *best_ms > 0 => at_ms > *best_ms,
            Some((_, _, best_ms)) if at_ms > 0 => *best_ms == 0,
            Some((_, best_at, best_ms)) => *best_ms == 0 && at > *best_at,
        };
        if replace {
            best = Some((status.to_string(), at, at_ms));
        }
    }
    best.map(|(status, at, _)| (status, at))
}

fn todo_store_settled_evidence_wins(
    item: &Value,
    explicit_status: &str,
    settled_status: &str,
    settled_at: &str,
) -> bool {
    if settled_status.is_empty() {
        return false;
    }
    let settled_rank = todo_store_status_rank(settled_status);
    let explicit_rank = todo_store_status_rank(explicit_status);
    if settled_rank == 0 || settled_rank <= explicit_rank {
        return false;
    }
    if explicit_status.trim().is_empty() {
        return true;
    }
    let status_ms = todo_store_item_status_stamp_ms(item);
    let settled_ms = todo_dispatch_parse_iso_ms(settled_at).unwrap_or(0);
    status_ms == 0 || settled_ms == 0 || settled_ms >= status_ms
}

fn todo_store_canonicalize_settled_evidence(item: &mut Value) -> bool {
    let explicit_status = todo_store_item_explicit_status(item);
    let Some((settled_status, settled_at)) = todo_store_item_settled_status_evidence(item) else {
        return false;
    };
    if !todo_store_settled_evidence_wins(item, &explicit_status, &settled_status, &settled_at) {
        return false;
    }
    let reason = todo_dispatch_text(item, &["reason", "todo_status_reason", "status_reason"]);
    let reason = if reason.is_empty() {
        "todo_store_settled_evidence".to_string()
    } else {
        reason
    };
    let Some(object) = item.as_object_mut() else {
        return false;
    };
    object.insert("todo_status".to_string(), json!(settled_status.clone()));
    object.insert("status".to_string(), json!(settled_status.clone()));
    object.insert("todo_status_reason".to_string(), json!(reason.clone()));
    object.insert("status_reason".to_string(), json!(reason));
    object.insert(
        "todo_status_updated_at".to_string(),
        json!(settled_at.clone()),
    );
    object.insert("updated_at".to_string(), json!(settled_at.clone()));
    match settled_status.as_str() {
        "completed" => {
            object.insert("todo_completed_at".to_string(), json!(settled_at.clone()));
            object.insert("completed_at".to_string(), json!(settled_at.clone()));
        }
        "cancelled" => {
            object.insert("todo_cancelled_at".to_string(), json!(settled_at.clone()));
            object.insert("cancelled_at".to_string(), json!(settled_at.clone()));
        }
        "failed" => {
            object.insert("todo_failed_at".to_string(), json!(settled_at.clone()));
            object.insert("failed_at".to_string(), json!(settled_at.clone()));
        }
        "interrupted" => {
            object.insert("todo_interrupted_at".to_string(), json!(settled_at.clone()));
            object.insert("interrupted_at".to_string(), json!(settled_at.clone()));
        }
        "timed_out" => {
            object.insert("todo_timed_out_at".to_string(), json!(settled_at.clone()));
            object.insert("timed_out_at".to_string(), json!(settled_at.clone()));
        }
        "deleted" => {
            object.insert("todo_deleted_at".to_string(), json!(settled_at.clone()));
            object.insert("deleted_at".to_string(), json!(settled_at.clone()));
        }
        _ => {}
    }
    if let Some(settled_ms) = todo_dispatch_parse_iso_ms(&settled_at) {
        object.insert("updated_at_ms".to_string(), json!(settled_ms));
    }
    true
}

fn todo_store_canonicalize_status_fields(item: &mut Value) -> bool {
    let status = todo_store_item_status(item);
    if status.is_empty() {
        return false;
    }
    let reason = todo_dispatch_text(item, &["reason", "todo_status_reason", "status_reason"]);
    let status_updated_at = todo_dispatch_text(
        item,
        &[
            "todo_status_updated_at",
            "status_updated_at",
            "updated_at",
            "created_at",
        ],
    );
    let Some(object) = item.as_object_mut() else {
        return false;
    };
    let mut changed = false;
    for key in ["todo_status", "status"] {
        if object.get(key).and_then(Value::as_str) != Some(status.as_str()) {
            object.insert(key.to_string(), json!(status.clone()));
            changed = true;
        }
    }
    if !status_updated_at.is_empty() {
        if object.get("todo_status_updated_at").and_then(Value::as_str)
            != Some(status_updated_at.as_str())
        {
            object.insert(
                "todo_status_updated_at".to_string(),
                json!(status_updated_at.clone()),
            );
            changed = true;
        }
        let has_updated_at = object
            .get("updated_at")
            .and_then(Value::as_str)
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
        if !has_updated_at {
            object.insert("updated_at".to_string(), json!(status_updated_at));
            changed = true;
        }
    }
    if !reason.is_empty() {
        if object.get("todo_status_reason").and_then(Value::as_str) != Some(reason.as_str()) {
            object.insert("todo_status_reason".to_string(), json!(reason.clone()));
            changed = true;
        }
        if object.get("status_reason").and_then(Value::as_str) != Some(reason.as_str()) {
            object.insert("status_reason".to_string(), json!(reason));
            changed = true;
        }
    }
    changed
}

fn todo_store_strip_legacy_queue_state(item: &mut Value) -> bool {
    let Some(object) = item.as_object_mut() else {
        return false;
    };
    let mut changed = false;
    for key in ["queue_state", "queueState"] {
        if object.remove(key).is_some() {
            changed = true;
        }
    }
    changed
}

fn todo_store_canonicalize_settled_items(items: Vec<Value>) -> Vec<Value> {
    items
        .into_iter()
        .map(|mut item| {
            todo_store_strip_legacy_queue_state(&mut item);
            todo_store_canonicalize_settled_evidence(&mut item);
            todo_store_canonicalize_status_fields(&mut item);
            item
        })
        .collect()
}

fn todo_store_item_pane_id(item: &Value) -> String {
    todo_dispatch_text(item, &["target_terminal_id", "pane_id"])
}

fn todo_store_set_item_status(item: &mut Value, status: &str, reason: &str) {
    let status = todo_store_normalize_lifecycle_status(status);
    if status.is_empty() {
        return;
    }
    let now_iso = chrono_like_now_iso();
    if let Some(object) = item.as_object_mut() {
        object.insert("todo_status".to_string(), json!(status.clone()));
        object.insert("status".to_string(), json!(status.clone()));
        object.insert("todo_status_reason".to_string(), json!(reason));
        object.insert("status_reason".to_string(), json!(reason));
        object.insert("todo_status_updated_at".to_string(), json!(now_iso.clone()));
        object.insert("updated_at".to_string(), json!(now_iso.clone()));
        object.insert("updated_at_ms".to_string(), json!(todo_dispatch_now_ms()));
        object.insert("lifecycle_owner".to_string(), json!("rust"));
        object.insert("rust_owned".to_string(), json!(true));
        object.remove("queue_state");
        object.remove("queueState");
        match status.as_str() {
            "queued" => {
                object
                    .entry("queued_at".to_string())
                    .or_insert_with(|| json!(now_iso.clone()));
            }
            "listed" => {}
            "completed" => {
                object.insert("todo_completed_at".to_string(), json!(now_iso.clone()));
                object.insert("completed_at".to_string(), json!(now_iso));
            }
            "cancelled" => {
                object.insert("todo_cancelled_at".to_string(), json!(now_iso.clone()));
                object.insert("cancelled_at".to_string(), json!(now_iso));
            }
            "failed" => {
                object.insert("todo_failed_at".to_string(), json!(now_iso.clone()));
                object.insert("failed_at".to_string(), json!(now_iso));
            }
            "interrupted" => {
                object.insert("todo_interrupted_at".to_string(), json!(now_iso.clone()));
                object.insert("interrupted_at".to_string(), json!(now_iso));
            }
            "timed_out" => {
                object.insert("todo_timed_out_at".to_string(), json!(now_iso.clone()));
                object.insert("timed_out_at".to_string(), json!(now_iso));
            }
            "deleted" => {
                object.insert("todo_deleted_at".to_string(), json!(now_iso.clone()));
                object.insert("deleted_at".to_string(), json!(now_iso));
            }
            _ => {}
        }
    }
}

fn todo_store_set_item_lifecycle_owner(item: &mut Value, owner: &str) {
    let owner = owner.trim();
    if owner.is_empty() {
        return;
    }
    if let Some(object) = item.as_object_mut() {
        object.insert("lifecycle_owner".to_string(), json!(owner));
        object.insert("rust_owned".to_string(), json!(owner == "rust"));
    }
}

fn todo_store_item_attempt_id(item: &Value, todo_id: &str) -> String {
    let attempt_id = todo_dispatch_text(
        item,
        &[
            "attempt_id",
            "last_dispatch_id",
            "dispatch_id",
            "prompt_event_id",
            "command_id",
        ],
    );
    if attempt_id.is_empty() {
        format!("todo-attempt-{todo_id}")
    } else {
        attempt_id
    }
}

fn todo_store_item_run_id(item: &Value, attempt_id: &str) -> String {
    let run_id = todo_dispatch_text(
        item,
        &["run_id", "provider_turn_id", "turn_id", "prompt_event_id"],
    );
    if run_id.is_empty() {
        attempt_id.to_string()
    } else {
        run_id
    }
}

fn todo_store_authority_key(todo_id: &str, attempt_id: &str) -> String {
    format!("{todo_id}::{attempt_id}")
}

fn todo_store_next_authority_seq(workspace_id: &str, todo_id: &str, attempt_id: &str) -> u64 {
    let Some(path) = todo_dispatch_data_path("authority", workspace_id) else {
        return todo_dispatch_now_ms();
    };
    let key = todo_store_authority_key(todo_id, attempt_id);
    let mut state = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    let previous = state.get(&key).and_then(Value::as_u64).unwrap_or(0);
    let next = previous.saturating_add(1);
    state.insert(key, json!(next));
    if let Ok(bytes) = serde_json::to_vec(&Value::Object(state)) {
        let _ = fs::write(path, bytes);
    }
    next
}

fn todo_store_item_sync_id(item: &Value) -> String {
    todo_dispatch_text(item, &["id", "todo_id", "client_todo_id", "command_id"])
}

fn todo_store_item_created_at(item: &Value, fallback: &str) -> String {
    let created_at = todo_dispatch_text(item, &["created_at"]);
    if created_at.is_empty() {
        fallback.to_string()
    } else {
        created_at
    }
}

fn todo_store_item_updated_at(item: &Value, fallback: &str) -> String {
    let updated_at = todo_dispatch_text(item, &["updated_at", "todo_status_updated_at"]);
    if updated_at.is_empty() {
        fallback.to_string()
    } else {
        updated_at
    }
}

fn todo_dispatch_backend_item_text_for_sync(item: &Value) -> String {
    let text = todo_dispatch_backend_item_text(item);
    if text.is_empty() {
        todo_dispatch_text(item, &["body", "prompt"])
    } else {
        text
    }
}

fn todo_dispatch_copy_todo_input_aliases(item: &Value, target: &mut Value) {
    let Some(target_object) = target.as_object_mut() else {
        return;
    };
    for key in ["inputs", "todo_inputs", "input_count", "todo_input_count"] {
        if let Some(value) = item.get(key).filter(|value| !value.is_null()).cloned() {
            target_object.insert(key.to_string(), value);
        }
    }
}

fn todo_dispatch_todo_sync_commit_payload(
    workspace_id: &str,
    workspace_name: &str,
    repo_path: &str,
    item: &Value,
    reason: &str,
    source: &str,
) -> Option<Value> {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return None;
    }
    let todo_id = todo_store_item_sync_id(item);
    if todo_id.is_empty() {
        return None;
    }
    let item_workspace_id = todo_dispatch_text(item, &["workspace_id", "target_workspace_id"]);
    let item_pane_id = todo_dispatch_text(item, &["target_terminal_id", "pane_id"]);
    if todo_dispatch_is_app_control_workspace_id(&item_workspace_id)
        || todo_dispatch_is_app_control_terminal_surface(workspace_id, &item_pane_id)
    {
        log_terminal_status_event(
            "backend.todo_store.todo_sync_app_control_skip",
            json!({
                "item_id": todo_id,
                "pane_id": item_pane_id,
                "reason": reason,
                "workspace_id": workspace_id,
            }),
        );
        return None;
    }
    let device_profile = cloud_mcp_desktop_device_profile();
    let device_id = device_profile
        .get("device_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    if device_id.is_empty() {
        return None;
    }
    let now_iso = chrono_like_now_iso();
    let status = match todo_dispatch_wire_status(&todo_store_item_status(item)).as_str() {
        "" => "listed".to_string(),
        value => value.to_string(),
    };
    let text = todo_dispatch_backend_item_text_for_sync(item);
    let title = text.chars().take(120).collect::<String>();
    let created_at = todo_store_item_created_at(item, &now_iso);
    let updated_at = todo_store_item_updated_at(item, &created_at);
    let item_source = todo_dispatch_text(item, &["source", "source_kind"]);
    let source_kind = if item_source.is_empty() {
        source.to_string()
    } else {
        item_source
    };
    let attempt_id = todo_store_item_attempt_id(item, &todo_id);
    let run_id = todo_store_item_run_id(item, &attempt_id);
    let rust_todo_seq = todo_store_next_authority_seq(workspace_id, &todo_id, &attempt_id);
    let requested_model = todo_dispatch_text(item, &["model", "model_id"]);
    let requested_reasoning_effort =
        todo_dispatch_text(item, &["reasoning_effort", "effort", "thinking_power"]);
    let requested_speed = todo_dispatch_text(item, &["speed", "service_tier"]);
    let attachments = todo_dispatch_chat_attachment_refs(item);
    let attachments_value = todo_dispatch_chat_attachment_refs_value(&attachments);
    let client_action_id =
        todo_dispatch_nested_text(item, &["client_action_id"], &["remote_command"]);
    let action_kind = if todo_dispatch_remote_command_is_message_intent(item) {
        "message"
    } else {
        "todo"
    };
    let command_kind = todo_dispatch_nested_text(item, &["command_kind"], &["remote_command"]);
    let origin_client_id = todo_dispatch_nested_text(
        item,
        &["origin_client_id", "client_id", "browser_client_id"],
        &["remote_command"],
    );
    let origin_device_id = todo_dispatch_nested_text(
        item,
        &[
            "origin_device_id",
            "request_device_id",
            "browser_device_id",
            "client_device_id",
        ],
        &["remote_command"],
    );
    let origin_workspace_id =
        todo_dispatch_nested_text(item, &["origin_workspace_id"], &["remote_command"]);
    let mut meta = json!({
        "rust_authoritative": true,
        "rust_todo_seq": rust_todo_seq,
        "attempt_id": attempt_id.clone(),
        "run_id": run_id.clone(),
        "source": source_kind,
        "source_kind": source_kind,
        "source_device_id": device_id,
        "source_workspace_id": workspace_id,
        "target_device_id": device_id,
        "target_workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "batch_id": todo_dispatch_text(item, &["batch_id", "todo_batch_id"]),
        "created_at": created_at,
        "dispatch_id": todo_dispatch_text(item, &["dispatch_id", "todo_dispatch_id"]),
        "kind": todo_dispatch_text(item, &["kind", "type"]),
        "loop_runtime_node_id": todo_dispatch_text(item, &["loop_runtime_node_id", "node_id"]),
        "loopspace_id": todo_dispatch_text(item, &["loopspace_id"]),
        "reason": reason,
        "status_reason": todo_dispatch_text(
            item,
            &["todo_status_reason", "status_reason", "reason"],
        ),
        "text": text,
        "body": text,
        "todo_text": text,
        "todo_id": todo_id,
        "todo_batch_id": todo_dispatch_text(item, &["todo_batch_id", "batch_id"]),
        "todo_number": todo_dispatch_text(item, &["todo_number", "todo_sequence"]),
        "todo_sequence": todo_dispatch_text(item, &["todo_sequence", "todo_number"]),
        "title": title,
        "updated_at": updated_at,
        "last_dispatch_id": todo_dispatch_text(item, &["last_dispatch_id", "dispatch_id"]),
        "command_id": todo_dispatch_text(item, &["command_id"]),
        "target_agent_id": todo_dispatch_text(item, &["target_agent_id", "agent_id"]),
        "model": requested_model.clone(),
        "model_id": requested_model,
        "reasoning_effort": requested_reasoning_effort.clone(),
        "effort": requested_reasoning_effort,
        "speed": requested_speed,
        "target_terminal_id": todo_dispatch_text(item, &["target_terminal_id", "pane_id"]),
        "target_thread_id": todo_dispatch_text(item, &["target_thread_id", "thread_id"]),
        "provider_session_id": todo_dispatch_text(item, &["provider_session_id", "session_id"])});
    if let Some(meta_object) = meta.as_object_mut() {
        if !attachments.is_empty() {
            meta_object.insert("attachments".to_string(), attachments_value);
        }
        if !client_action_id.is_empty() {
            meta_object.insert(
                "client_action_id".to_string(),
                json!(client_action_id.clone()),
            );
        }
        meta_object.insert("action_kind".to_string(), json!(action_kind));
        if !command_kind.is_empty() {
            meta_object.insert("command_kind".to_string(), json!(command_kind.clone()));
        }
        if !origin_client_id.is_empty() {
            meta_object.insert(
                "origin_client_id".to_string(),
                json!(origin_client_id.clone()),
            );
        }
        if !origin_device_id.is_empty() {
            meta_object.insert(
                "origin_device_id".to_string(),
                json!(origin_device_id.clone()),
            );
            meta_object.insert(
                "request_device_id".to_string(),
                json!(origin_device_id.clone()),
            );
        }
        if !origin_workspace_id.is_empty() {
            meta_object.insert(
                "origin_workspace_id".to_string(),
                json!(origin_workspace_id),
            );
        }
    }
    todo_dispatch_copy_todo_input_aliases(item, &mut meta);
    Some(json!({
        "c": "todo.sync",
        "contract": "diffforge.todo.live_state.v1",
        "cid": format!("rust-todo-dispatch-{todo_id}-{status}-{rust_todo_seq}"),
        "device_id": device_id,
        "did": device_id,
        "rust_authoritative": true,
        "rust_todo_seq": rust_todo_seq,
        "m": "commit",
        "ops": [
            ["u", 0, todo_id, device_id, workspace_id, status, "", meta],
        ],
        "repo_path": repo_path,
        "source": source,
        "v": 1,
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
    }))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TodoStoreDeleteMode {
    Hard,
    Tombstone,
}

impl TodoStoreDeleteMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Hard => "hard",
            Self::Tombstone => "tombstone",
        }
    }

    fn op_status(self) -> &'static str {
        match self {
            Self::Hard => "removed",
            Self::Tombstone => "deleted",
        }
    }
}

fn todo_store_delete_mode_from_text(value: &str) -> Option<TodoStoreDeleteMode> {
    match value
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' '], "_")
        .as_str()
    {
        "hard" | "permanent" | "permanent_delete" | "purge" => Some(TodoStoreDeleteMode::Hard),
        "tombstone" | "soft" | "legacy" | "deleted" | "delete" => {
            Some(TodoStoreDeleteMode::Tombstone)
        }
        _ => None,
    }
}

fn todo_dispatch_remote_delete_mode(event: &Value) -> Option<TodoStoreDeleteMode> {
    todo_store_delete_mode_from_text(&todo_dispatch_text(
        event,
        &["delete_mode", "deletion_mode"],
    ))
}

fn todo_store_delete_references_hard_eligible(reference_items: &[Value]) -> bool {
    !reference_items.is_empty()
        && reference_items
            .iter()
            .all(todo_store_item_hard_delete_eligible)
}

fn todo_store_classify_delete_mode(
    reference_items: &[Value],
    requested_delete_mode: Option<TodoStoreDeleteMode>,
) -> TodoStoreDeleteMode {
    if requested_delete_mode == Some(TodoStoreDeleteMode::Tombstone) {
        return TodoStoreDeleteMode::Tombstone;
    }
    if todo_store_delete_references_hard_eligible(reference_items) {
        TodoStoreDeleteMode::Hard
    } else {
        TodoStoreDeleteMode::Tombstone
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct TodoStoreDeleteResult {
    pub(crate) removed_ids: Vec<String>,
    pub(crate) hard_deleted_ids: Vec<String>,
    pub(crate) tombstoned_ids: Vec<String>,
}

fn todo_dispatch_delete_todo_sync_commit_payload(
    workspace_id: &str,
    todo_ids: &[String],
    reason: &str,
    origin: &str,
    delete_mode: TodoStoreDeleteMode,
) -> Option<Value> {
    let safe_todo_ids = todo_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if safe_todo_ids.is_empty() {
        return None;
    }
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return None;
    }
    if todo_dispatch_is_app_control_workspace_id(workspace_id) {
        log_terminal_status_event(
            "backend.todo_store.delete_todo_sync_app_control_skip",
            json!({
                "reason": reason,
                "removed_count": safe_todo_ids.len(),
                "workspace_id": workspace_id,
            }),
        );
        return None;
    }
    let device_profile = cloud_mcp_desktop_device_profile();
    let device_id = device_profile
        .get("device_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    if device_id.is_empty() {
        return None;
    }
    let deleted_at = chrono_like_now_iso();
    let delete_mode_str = delete_mode.as_str();
    let op_status = delete_mode.op_status();
    let ops = safe_todo_ids
        .iter()
        .map(|todo_id| {
            let attempt_id = format!("todo-delete-{todo_id}");
            let run_id = attempt_id.clone();
            let rust_todo_seq = todo_store_next_authority_seq(workspace_id, todo_id, &attempt_id);
            json!([
                "d",
                0,
                todo_id,
                device_id,
                workspace_id,
                op_status,
                {
                    "rust_authoritative": true,
                    "rust_todo_seq": rust_todo_seq,
                    "attempt_id": attempt_id.clone(),
                    "run_id": run_id.clone(),
                    "source": "rust-diffforge-todo-store",
                    "source_kind": "rust-diffforge-todo-store",
                    "source_device_id": device_id,
                    "source_workspace_id": workspace_id,
                    "target_device_id": device_id,
                    "target_workspace_id": workspace_id,
                    "deleted_at": deleted_at,
                    "delete_mode": delete_mode_str,
                    "delete_reason": reason,
                    "origin": origin,
                    "reason": reason,
                }
            ])
        })
        .collect::<Vec<_>>();
    Some(json!({
        "c": "todo.sync",
        "contract": "diffforge.todo.live_state.v1",
        "cid": format!("rust-todo-delete-{workspace_id}-{}", todo_dispatch_now_ms()),
        "device_id": device_id,
        "did": device_id,
        "rust_authoritative": true,
        "m": "commit",
        "ops": ops,
        "source": "rust-diffforge-todo-store",
        "v": 1,
        "workspace_id": workspace_id,
    }))
}

#[derive(Clone, Debug)]
pub(crate) struct TodoStoreAccountResumeReconcileCommit {
    pub(crate) item_count: usize,
    pub(crate) operation: &'static str,
    pub(crate) payload: Value,
    pub(crate) workspace_id: String,
}

fn todo_store_account_resume_snapshot_is_full(event: &Value) -> bool {
    let sources = [
        Some(event),
        event.get("data"),
        event.get("payload"),
        event.get("live_state"),
    ];
    sources.into_iter().flatten().any(|source| {
        source
            .get("snapshot_full")
            .or_else(|| source.get("full_snapshot"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || todo_dispatch_text(source, &["sync_mode"]) == "latest_per_workspace"
    })
}

fn todo_store_account_resume_cloud_queue_rows(event: &Value) -> Vec<(String, Value)> {
    let device_id = cloud_mcp_desktop_device_profile()
        .get("device_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    if device_id.is_empty() {
        return Vec::new();
    }
    let sources = [
        Some(event),
        event.get("data"),
        event.get("payload"),
        event.get("live_state"),
    ];
    let mut rows = Vec::<Value>::new();
    for source in sources.into_iter().flatten() {
        for container in [source.get("accepted"), source.get("current")] {
            let Some(container) = container else {
                continue;
            };
            if let Some(items) = container.as_array() {
                rows.extend(items.iter().cloned());
            } else if let Some(items) = container.get("items").and_then(Value::as_array) {
                rows.extend(items.iter().cloned());
            }
        }
    }
    let mut seen = HashSet::<String>::new();
    rows.into_iter()
        .filter_map(|row| {
            let todo_id = todo_dispatch_text(&row, &["todo_id", "id", "item_id"]);
            let workspace_id = todo_dispatch_text(
                &row,
                &["workspace_id", "source_workspace_id", "target_workspace_id"],
            );
            let source_device_id =
                todo_dispatch_text(&row, &["source_device_id", "device_id", "target_device_id"]);
            let status = todo_store_item_status(&row);
            let current = row.get("current").and_then(Value::as_bool).unwrap_or(true);
            let deleted = row.get("deleted").and_then(Value::as_bool).unwrap_or(false);
            let key = format!("{workspace_id}::{todo_id}");
            if todo_id.is_empty()
                || workspace_id.is_empty()
                || source_device_id != device_id
                || !current
                || deleted
                || !matches!(status.as_str(), "listed" | "queued")
                || !seen.insert(key)
            {
                return None;
            }
            Some((workspace_id, row))
        })
        .collect()
}

fn todo_store_account_resume_reconciliation_plan(
    cloud_rows: &[(String, Value)],
    local_by_workspace: &HashMap<String, Vec<Value>>,
    allow_missing_cloud_deletes: bool,
) -> (Vec<(String, Value)>, HashMap<String, Vec<String>>) {
    let mut upserts = Vec::<(String, Value)>::new();
    let mut deletes = HashMap::<String, Vec<String>>::new();
    for (workspace_id, local_items) in local_by_workspace {
        let workspace_cloud_rows = cloud_rows
            .iter()
            .filter(|(cloud_workspace_id, _)| cloud_workspace_id == workspace_id)
            .map(|(_, row)| row)
            .collect::<Vec<_>>();
        for item in local_items {
            let status = todo_store_item_status(item);
            let matches_cloud_queue_row = workspace_cloud_rows.iter().any(|cloud_row| {
                let cloud_id = todo_dispatch_text(cloud_row, &["todo_id", "id", "item_id"]);
                todo_store_item_matches_id(item, &cloud_id)
            });
            if matches!(status.as_str(), "listed" | "queued") || matches_cloud_queue_row {
                upserts.push((workspace_id.clone(), item.clone()));
            }
        }
        if !allow_missing_cloud_deletes {
            continue;
        }
        for cloud_row in workspace_cloud_rows {
            let cloud_id = todo_dispatch_text(cloud_row, &["todo_id", "id", "item_id"]);
            if cloud_id.is_empty()
                || local_items
                    .iter()
                    .any(|local_item| todo_store_item_matches_id(local_item, &cloud_id))
            {
                continue;
            }
            let ids = deletes.entry(workspace_id.clone()).or_default();
            if !ids.contains(&cloud_id) {
                ids.push(cloud_id);
            }
        }
    }
    (upserts, deletes)
}

pub(crate) fn todo_store_account_resume_reconciliation_commits(
    event: &Value,
) -> Vec<TodoStoreAccountResumeReconcileCommit> {
    let cloud_rows = todo_store_account_resume_cloud_queue_rows(event);
    let local_by_workspace = {
        let _store_guard = todo_dispatch_queue_store_guard();
        let mut queues = HashMap::<String, Vec<Value>>::new();
        for path in todo_dispatch_data_workspace_files("queues") {
            let snapshot = todo_dispatch_queue_read(&path);
            let workspace_id = todo_dispatch_text(&snapshot, &["workspace_id"]);
            if workspace_id.is_empty() || todo_dispatch_is_app_control_workspace_id(&workspace_id) {
                continue;
            }
            let items = snapshot
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            queues.insert(workspace_id, items);
        }
        queues
    };
    let (upserts, deletes) = todo_store_account_resume_reconciliation_plan(
        &cloud_rows,
        &local_by_workspace,
        todo_store_account_resume_snapshot_is_full(event),
    );
    let mut commits = Vec::<TodoStoreAccountResumeReconcileCommit>::new();
    for (workspace_id, item) in upserts {
        let workspace_name = todo_dispatch_text(&item, &["workspace_name"]);
        let repo_path = todo_dispatch_text(&item, &["repo_path", "workspace_root", "project_root"]);
        let Some(payload) = todo_dispatch_todo_sync_commit_payload(
            &workspace_id,
            &workspace_name,
            &repo_path,
            &item,
            "account_sync_resume_authoritative_reconcile",
            "rust-diffforge-account-resume",
        ) else {
            continue;
        };
        commits.push(TodoStoreAccountResumeReconcileCommit {
            item_count: 1,
            operation: "upsert",
            payload,
            workspace_id,
        });
    }
    for (workspace_id, todo_ids) in deletes {
        let Some(payload) = todo_dispatch_delete_todo_sync_commit_payload(
            &workspace_id,
            &todo_ids,
            "account_sync_resume_missing_from_rust_queue",
            "account_sync_resume_authoritative_reconcile",
            TodoStoreDeleteMode::Hard,
        ) else {
            continue;
        };
        commits.push(TodoStoreAccountResumeReconcileCommit {
            item_count: todo_ids.len(),
            operation: "hard_delete",
            payload,
            workspace_id,
        });
    }
    commits
}

fn todo_store_enqueue_delete_todo_sync_commit(
    app: &AppHandle,
    workspace_id: &str,
    todo_ids: &[String],
    reason: &str,
    origin: &str,
    delete_mode: TodoStoreDeleteMode,
) {
    let Some(payload) = todo_dispatch_delete_todo_sync_commit_payload(
        workspace_id,
        todo_ids,
        reason,
        origin,
        delete_mode,
    ) else {
        return;
    };
    let app = app.clone();
    let workspace_id = workspace_id.to_string();
    let reason = reason.to_string();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<CloudMcpState>().inner().clone();
        let response = cloud_mcp_enqueue_workspace_todo_sync_commit(&state, payload, &reason).await;
        let _ = app.emit(
            CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT,
            json!({
                "reason": reason,
                "source": "todo_store_delete_todo_sync_commit",
                "workspace_id": workspace_id,
            }),
        );
        log_terminal_status_event(
            "backend.todo_store.delete_todo_sync_commit_queued",
            json!({
                "reason": reason,
                "delete_mode": delete_mode.as_str(),
                "response": response,
                "workspace_id": workspace_id,
            }),
        );
    });
}

fn todo_store_enqueue_item_todo_sync_commit(
    app: &AppHandle,
    workspace_id: &str,
    item: Value,
    reason: &str,
    source: &str,
) {
    let workspace_name = todo_dispatch_text(&item, &["workspace_name"]);
    let repo_path = todo_dispatch_text(&item, &["repo_path", "workspace_root", "project_root"]);
    let Some(payload) = todo_dispatch_todo_sync_commit_payload(
        workspace_id,
        &workspace_name,
        &repo_path,
        &item,
        reason,
        source,
    ) else {
        return;
    };
    let app = app.clone();
    let workspace_id = workspace_id.to_string();
    let reason = reason.to_string();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<CloudMcpState>().inner().clone();
        let response = cloud_mcp_enqueue_workspace_todo_sync_commit(&state, payload, &reason).await;
        let _ = app.emit(
            CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT,
            json!({
                "reason": reason,
                "source": "todo_store_status_todo_sync_commit",
                "workspace_id": workspace_id,
            }),
        );
        log_terminal_status_event(
            "backend.todo_store.status_todo_sync_commit_queued",
            json!({
                "reason": reason,
                "response": response,
                "workspace_id": workspace_id,
            }),
        );
    });
}

async fn todo_dispatch_enqueue_todo_sync_commit(
    app: &AppHandle,
    workspace_id: &str,
    workspace_name: &str,
    repo_path: &str,
    item: Value,
    reason: &str,
) {
    let Some(payload) = todo_dispatch_todo_sync_commit_payload(
        workspace_id,
        workspace_name,
        repo_path,
        &item,
        reason,
        "rust-diffforge-todo-dispatch",
    ) else {
        return;
    };
    let state = app.state::<CloudMcpState>().inner().clone();
    let response = cloud_mcp_enqueue_workspace_todo_sync_commit(&state, payload, reason).await;
    let _ = app.emit(
        CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT,
        json!({
            "reason": reason,
            "source": "todo_dispatch_todo_sync_commit",
            "workspace_id": workspace_id,
        }),
    );
    log_terminal_status_event(
        "backend.todo_dispatch.todo_sync_commit_queued",
        json!({
            "reason": reason,
            "response": response,
            "workspace_id": workspace_id,
        }),
    );
}

fn todo_store_changed_items_for_sync(previous: &[Value], next: &[Value]) -> Vec<Value> {
    let mut previous_by_id = HashMap::<String, String>::new();
    for item in previous.iter().filter(|item| item.is_object()) {
        let item_id = todo_store_item_sync_id(item);
        if item_id.is_empty() {
            continue;
        }
        previous_by_id.insert(
            item_id,
            serde_json::to_string(item).unwrap_or_else(|_| String::new()),
        );
    }
    next.iter()
        .filter(|item| item.is_object())
        .filter_map(|item| {
            let item_id = todo_store_item_sync_id(item);
            if item_id.is_empty() {
                return None;
            }
            let signature = serde_json::to_string(item).unwrap_or_else(|_| String::new());
            (previous_by_id.get(&item_id) != Some(&signature)).then(|| item.clone())
        })
        .collect()
}

fn todo_store_push_items(app: &AppHandle, workspace_id: &str, items: Vec<Value>, reason: &str) {
    let workspace_id = workspace_id.trim();
    if todo_dispatch_is_app_control_workspace_id(workspace_id) {
        log_terminal_status_event(
            "backend.todo_store.cloud_push_app_control_skip",
            json!({
                "item_count": items.len(),
                "reason": reason,
                "workspace_id": workspace_id,
            }),
        );
        return;
    }
    let items = items
        .into_iter()
        .filter(|item| item.is_object() && !todo_store_item_sync_id(item).is_empty())
        .collect::<Vec<_>>();
    if items.is_empty() {
        return;
    }
    let item_count = items.len();
    for item in items {
        todo_store_enqueue_item_todo_sync_commit(
            app,
            workspace_id,
            item,
            reason,
            "rust-diffforge-todo-store",
        );
    }
    log_terminal_status_event(
        "backend.todo_store.cloud_push_enqueued",
        json!({
            "item_count": item_count,
            "reason": reason,
            "workspace_id": workspace_id,
        }),
    );
}

/// Local-only removal marker: `todo.live_state`/`todo.content` own account sync now,
/// so this no longer writes legacy workspace todo events.
fn todo_store_push_removals(
    app: &AppHandle,
    workspace_id: &str,
    removed_todo_ids: Vec<String>,
    reason: &str,
) {
    if removed_todo_ids.is_empty() {
        return;
    }
    let _ = app;
    log_terminal_status_event(
        "backend.todo_store.cloud_delete_retired",
        json!({
            "removed_count": removed_todo_ids.len(),
            "reason": reason,
            "workspace_id": workspace_id,
        }),
    );
}

/// Status-correction push: upserts only the given rows (used to heal stale
/// "running" mirror rows nothing will ever settle).
fn todo_store_push_corrections(
    app: &AppHandle,
    workspace_id: &str,
    items: Vec<Value>,
    reason: &str,
) {
    if items.is_empty() {
        return;
    }
    // Client-authoritative: stamp the corrected statuses onto the local
    // mirror so every view settles instantly. Account sync is handled by
    // todo.live_state/todo.content rather than the retired workspace todo events.
    if cloud_mcp_todo_mirror_apply_local_corrections(&items) > 0 {
        let _ = app.emit(
            CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT,
            json!({
                "reason": reason,
                "source": "todo_store_correction",
                "workspace_id": workspace_id,
            }),
        );
    }
    let workspace_id = workspace_id.to_string();
    todo_store_push_items(app, &workspace_id, items, reason);
}

/// Queue-store removal + journal update in one place. Unsent listed/queued
/// todos are hard-deleted; terminal-touched todos still get tombstones so
/// execution history cannot be resurrected by a stale replica.
pub(crate) fn todo_store_delete_internal(
    app: &AppHandle,
    workspace_id: &str,
    todo_ids: &[String],
    reason: &str,
    origin: &str,
) -> TodoStoreDeleteResult {
    todo_store_delete_internal_with_mode(app, workspace_id, todo_ids, reason, origin, None)
}

fn todo_store_delete_internal_with_mode(
    app: &AppHandle,
    workspace_id: &str,
    todo_ids: &[String],
    reason: &str,
    origin: &str,
    requested_delete_mode: Option<TodoStoreDeleteMode>,
) -> TodoStoreDeleteResult {
    let all_ids = todo_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if all_ids.is_empty() {
        return TodoStoreDeleteResult::default();
    }
    let mut hard_deleted_ids = Vec::new();
    let mut tombstone_candidate_ids = Vec::new();
    let mut next_items = None;
    let queue_path = todo_dispatch_data_path("queues", workspace_id);
    let items = queue_path
        .as_deref()
        .map(|path| {
            todo_dispatch_queue_read(path)
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        })
        .unwrap_or_default();
    for todo_id in &all_ids {
        let matching_items = items
            .iter()
            .filter(|item| todo_store_item_matches_id(item, todo_id))
            .cloned()
            .collect::<Vec<_>>();
        let reference_items = if matching_items.is_empty() {
            cloud_mcp_todo_mirror_lookup_todo_item(workspace_id, todo_id)
                .into_iter()
                .collect::<Vec<_>>()
        } else {
            matching_items
        };
        match todo_store_classify_delete_mode(&reference_items, requested_delete_mode) {
            TodoStoreDeleteMode::Hard => hard_deleted_ids.push(todo_id.clone()),
            TodoStoreDeleteMode::Tombstone => tombstone_candidate_ids.push(todo_id.clone()),
        }
    }
    if queue_path.is_some() {
        let before = items.len();
        let filtered_items = items
            .into_iter()
            .filter(|item| {
                !all_ids
                    .iter()
                    .any(|id| todo_store_item_matches_id(item, id))
            })
            .collect::<Vec<_>>();
        if filtered_items.len() != before {
            next_items = Some(filtered_items);
        }
    }
    let tombstoned_ids =
        todo_store_add_tombstones(workspace_id, &tombstone_candidate_ids, reason, origin);
    if let Some(next_items) = next_items {
        todo_dispatch_queue_write(workspace_id, &next_items);
    }
    for todo_id in &all_ids {
        let hard_deleted = hard_deleted_ids.iter().any(|id| id == todo_id);
        todo_dispatch_journal_append(
            workspace_id,
            json!({
                "kind": if hard_deleted { "remote_todo_hard_deleted" } else { "remote_todo_deleted" },
                "item_id": todo_id,
                "at": chrono_like_now_iso(),
                "delete_mode": if hard_deleted { "hard" } else { "tombstone" },
                "reason": reason,
                "origin": origin,
            }),
        );
    }
    // Client-authoritative: purge the local mirror right away so every view
    // converges instantly; the cloud removal below syncs in the background.
    let purged = cloud_mcp_todo_mirror_purge_todo_ids(&all_ids);
    if !hard_deleted_ids.is_empty() {
        todo_store_enqueue_delete_todo_sync_commit(
            app,
            workspace_id,
            &hard_deleted_ids,
            reason,
            origin,
            TodoStoreDeleteMode::Hard,
        );
    }
    if !tombstoned_ids.is_empty() {
        todo_store_enqueue_delete_todo_sync_commit(
            app,
            workspace_id,
            &tombstoned_ids,
            reason,
            origin,
            TodoStoreDeleteMode::Tombstone,
        );
    }
    todo_store_push_removals(app, workspace_id, all_ids.clone(), reason);
    todo_store_emit_changed(app, workspace_id, reason, "store");
    if purged > 0 {
        let _ = app.emit(
            CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT,
            json!({
                "reason": reason,
                "source": "todo_store_delete",
                "workspace_id": workspace_id,
            }),
        );
    }
    TodoStoreDeleteResult {
        removed_ids: all_ids,
        hard_deleted_ids,
        tombstoned_ids,
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn todo_store_snapshot(workspace_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_id = workspace_id.trim().to_string();
        if workspace_id.is_empty() {
            return Err("workspace_id is required.".to_string());
        }
        if todo_dispatch_workspace_is_deleted(&workspace_id) {
            return Ok(json!({
                "workspace_id": workspace_id,
                "items": [],
                "tombstoned_ids": [],
                "updated_at_ms": todo_dispatch_now_ms(),
            }));
        }
        let tombstoned = todo_store_tombstone_ids(&workspace_id);
        let snapshot = todo_dispatch_data_path("queues", &workspace_id)
            .map(|path| todo_dispatch_queue_read(&path))
            .unwrap_or_else(|| json!({}));
        let items = snapshot
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let (items, _) = todo_store_filter_tombstoned(items, &tombstoned);
        let items = todo_store_canonicalize_settled_items(items);
        Ok(json!({
            "workspace_id": workspace_id,
            "items": items,
            "tombstoned_ids": tombstoned.into_iter().collect::<Vec<_>>(),
            "updated_at_ms": snapshot.get("updated_at_ms").and_then(Value::as_u64).unwrap_or(0),
        }))
    })
    .await
    .map_err(|error| format!("Todo store snapshot worker failed: {error}"))?
}

fn todo_store_normalize_draft_text(value: &str, max_chars: usize) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .chars()
        .take(max_chars)
        .collect()
}

fn todo_store_draft_text(draft: &Value, keys: &[&str], max_chars: usize) -> String {
    todo_store_normalize_draft_text(&todo_dispatch_text(draft, keys), max_chars)
}

fn todo_store_draft_images(draft: &Value) -> Vec<Value> {
    let mut images = draft
        .get("images")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|image| image.is_object())
        .collect::<Vec<_>>();
    if let Some(image) = draft.get("image").filter(|image| image.is_object()) {
        images.insert(0, image.clone());
    }
    images
}

fn todo_store_draft_note(draft: &Value) -> Option<Value> {
    let note = draft.get("note").filter(|note| note.is_object())?;
    let title = todo_store_draft_text(note, &["title", "name"], TODO_STORE_DRAFT_TEXT_MAX_CHARS);
    let text = todo_store_draft_text(
        note,
        &["text", "body", "content"],
        TODO_STORE_DRAFT_TEXT_MAX_CHARS,
    );
    if title.is_empty() && text.is_empty() {
        return None;
    }
    Some(json!({
        "title": title,
        "text": text,
    }))
}

fn todo_store_insert_if_present(
    target: &mut serde_json::Map<String, Value>,
    draft: &Value,
    target_key: &str,
    source_keys: &[&str],
) {
    for key in source_keys {
        if let Some(value) = draft.get(*key).filter(|value| !value.is_null()) {
            target.insert(target_key.to_string(), value.clone());
            return;
        }
    }
}

fn todo_store_build_created_item(
    workspace_id: &str,
    draft: &Value,
    reason: &str,
) -> Result<Value, String> {
    let text = todo_store_draft_text(
        draft,
        &["text", "body", "title"],
        TODO_STORE_DRAFT_TEXT_MAX_CHARS,
    );
    let images = todo_store_draft_images(draft);
    let note = todo_store_draft_note(draft);
    if text.is_empty() && images.is_empty() && note.is_none() {
        return Err("Todo text, image, or note is required.".to_string());
    }

    let now_iso = chrono_like_now_iso();
    let now_ms = todo_dispatch_now_ms();
    let requested_id = todo_dispatch_text(draft, &["id", "todo_id", "command_id", "dispatch_id"]);
    let id = if requested_id.is_empty() {
        format!("todo-{}-{}", now_ms, uuid::Uuid::new_v4())
    } else {
        requested_id
    };
    let kind = todo_dispatch_text(draft, &["kind", "type"]);
    let kind = if kind.is_empty() {
        "todo".to_string()
    } else {
        kind
    };
    let source = todo_dispatch_text(draft, &["source", "source_kind"]);
    let source = if source.is_empty() {
        "tui-todo-auto-queue".to_string()
    } else {
        source
    };
    let requested_status = todo_store_normalize_lifecycle_status(&todo_dispatch_text(
        draft,
        &["todo_status", "status"],
    ));
    let status = if requested_status.is_empty() {
        "listed".to_string()
    } else {
        requested_status
    };

    let mut object = serde_json::Map::new();
    object.insert("created_at".to_string(), json!(now_iso.clone()));
    object.insert(
        "device_id".to_string(),
        json!(todo_dispatch_text(draft, &["device_id"])),
    );
    object.insert("id".to_string(), json!(id.clone()));
    object.insert("kind".to_string(), json!(kind));
    object.insert("lifecycle_owner".to_string(), json!("rust"));
    object.insert("rust_owned".to_string(), json!(true));
    object.insert("source".to_string(), json!(source));
    object.insert("status".to_string(), json!(status.clone()));
    object.insert("status_reason".to_string(), json!(reason));
    object.insert("text".to_string(), json!(text));
    object.insert("todo_id".to_string(), json!(id));
    object.insert("todo_status".to_string(), json!(status));
    object.insert("todo_status_reason".to_string(), json!(reason));
    object.insert("todo_status_updated_at".to_string(), json!(now_iso.clone()));
    object.insert("updated_at".to_string(), json!(now_iso));
    object.insert("updated_at_ms".to_string(), json!(now_ms));
    object.insert("workspace_id".to_string(), json!(workspace_id));

    if let Some(image) = images.first() {
        object.insert("image".to_string(), image.clone());
    }
    if images.len() > 1 {
        object.insert("images".to_string(), json!(images));
    }
    if let Some(note) = note {
        object.insert("note".to_string(), note);
    }

    for (target_key, source_keys) in [
        ("title", &["title", "name"][..]),
        ("plan_task", &["plan_task"][..]),
        ("remote_command", &["remote_command"][..]),
        ("inputs", &["inputs", "todo_inputs"][..]),
        ("model", &["model", "model_id"][..]),
        ("model_id", &["model_id", "model"][..]),
        ("effort", &["effort", "reasoning_effort"][..]),
        ("reasoning_effort", &["reasoning_effort", "effort"][..]),
        ("speed", &["speed"][..]),
        ("batch_id", &["batch_id", "todo_batch_id"][..]),
        ("todo_batch_id", &["todo_batch_id", "batch_id"][..]),
        ("command_id", &["command_id"][..]),
        ("dispatch_id", &["dispatch_id", "todo_dispatch_id"][..]),
        ("last_dispatch_id", &["last_dispatch_id", "dispatch_id"][..]),
        ("loopspace_id", &["loopspace_id"][..]),
        (
            "loop_runtime_node_id",
            &["loop_runtime_node_id", "node_id"][..],
        ),
        ("node_id", &["node_id", "loop_runtime_node_id"][..]),
        (
            "loop_runtime_run_id",
            &["loop_runtime_run_id", "run_id"][..],
        ),
        (
            "loop_runtime_edge_id",
            &["loop_runtime_edge_id", "edge_id"][..],
        ),
        ("trigger_id", &["trigger_id"][..]),
        ("trigger_run_id", &["trigger_run_id"][..]),
        (
            "command_kind",
            &["command_kind", "kind", "type", "action"][..],
        ),
        (
            "target_terminal_mode",
            &["target_terminal_mode", "terminal_mode"][..],
        ),
        ("todo_number", &["todo_number", "todo_sequence"][..]),
        ("todo_sequence", &["todo_sequence", "todo_number"][..]),
        ("target_agent_id", &["target_agent_id", "target_role"][..]),
        ("target_agent_label", &["target_agent_label"][..]),
        (
            "target_terminal_id",
            &["target_terminal_id", "terminal_id", "pane_id"][..],
        ),
        (
            "target_terminal_index",
            &["target_terminal_index", "terminal_index"][..],
        ),
        (
            "target_terminal_name",
            &["target_terminal_name", "terminal_name"][..],
        ),
        ("target_thread_id", &["target_thread_id", "thread_id"][..]),
        (
            "target_color_slot",
            &["target_color_slot", "color_slot"][..],
        ),
        (
            "target_terminal_color",
            &["target_terminal_color", "terminal_color"][..],
        ),
    ] {
        todo_store_insert_if_present(&mut object, draft, target_key, source_keys);
    }

    let item_source = Value::Object(object.clone());
    let loop_runtime_run_id = todo_dispatch_text(&item_source, &["loop_runtime_run_id", "run_id"]);
    let source_kind = todo_dispatch_text(&item_source, &["source", "source_kind"]);
    let existing_remote_command = object
        .get("remote_command")
        .and_then(Value::as_object)
        .cloned();
    if existing_remote_command.is_some()
        || !loop_runtime_run_id.is_empty()
        || source_kind == "loopspace-dispatch-todos"
    {
        let mut remote_command = existing_remote_command.unwrap_or_default();
        for (target_key, source_keys) in [
            ("command_id", &["command_id", "id"][..]),
            ("command_kind", &["command_kind"][..]),
            ("loopspace_id", &["loopspace_id"][..]),
            (
                "loop_runtime_run_id",
                &["loop_runtime_run_id", "run_id"][..],
            ),
            (
                "loop_runtime_node_id",
                &["loop_runtime_node_id", "node_id"][..],
            ),
            (
                "loop_runtime_edge_id",
                &["loop_runtime_edge_id", "edge_id"][..],
            ),
            ("trigger_id", &["trigger_id"][..]),
            ("trigger_run_id", &["trigger_run_id"][..]),
            ("source", &["source", "source_kind"][..]),
            ("target_terminal_mode", &["target_terminal_mode"][..]),
        ] {
            let value = todo_dispatch_text(&item_source, source_keys);
            if !value.is_empty() {
                remote_command.insert(target_key.to_string(), json!(value));
            }
        }
        if source_kind == "loopspace-dispatch-todos" && !remote_command.contains_key("command_kind")
        {
            remote_command.insert(
                "command_kind".to_string(),
                json!("loopspace_dispatch_todos"),
            );
        }
        if source_kind == "loopspace-dispatch-todos" {
            remote_command.remove("checkpoint_plan");
        }
        object.insert("remote_command".to_string(), Value::Object(remote_command));
    }

    if draft.get("target_explicit").and_then(Value::as_bool) == Some(true)
        || draft.get("explicit_target").and_then(Value::as_bool) == Some(true)
        || draft.get("user_pinned_target").and_then(Value::as_bool) == Some(true)
    {
        object.insert("target_explicit".to_string(), json!(true));
        object.insert("explicit_target".to_string(), json!(true));
        object.insert("user_pinned_target".to_string(), json!(true));
    }

    let mut item = Value::Object(object);
    todo_store_enforce_terminal_id_assignment(&mut item);
    todo_store_canonicalize_status_fields(&mut item);
    Ok(item)
}

#[tauri::command(rename_all = "snake_case")]
async fn todo_store_create(
    app: AppHandle,
    workspace_id: String,
    draft: Value,
    reason: Option<String>,
) -> Result<Value, String> {
    let workspace_id = workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id is required.".to_string());
    }
    if todo_dispatch_workspace_is_deleted(&workspace_id) {
        return Err("workspace has been deleted.".to_string());
    }
    let reason = reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "todo_store_create".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        let item = todo_store_build_created_item(&workspace_id, &draft, &reason)?;
        let item_id = todo_store_item_sync_id(&item);
        if item_id.is_empty() {
            return Err("Created todo is missing an id.".to_string());
        }
        let tombstoned = todo_store_tombstone_ids(&workspace_id);
        if todo_store_item_is_tombstoned(&item, &tombstoned) {
            return Err("Created todo id is tombstoned.".to_string());
        }

        let _store_guard = todo_dispatch_queue_store_guard();
        let mut items = todo_dispatch_data_path("queues", &workspace_id)
            .map(|path| {
                todo_dispatch_queue_read(&path)
                    .get("items")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        items.retain(|candidate| !todo_store_item_matches_id(candidate, &item_id));
        items.push(item.clone());
        todo_dispatch_queue_write(&workspace_id, &items);
        todo_store_push_items(&app, &workspace_id, vec![item.clone()], &reason);
        todo_store_emit_changed(&app, &workspace_id, &reason, "store");
        if todo_store_item_status(&item) == "queued" {
            todo_dispatch_wake_background_dispatcher(app.clone());
        }
        Ok(json!({
            "ok": true,
            "workspace_id": workspace_id,
            "item": item,
        }))
    })
    .await
    .map_err(|error| format!("Todo store create worker failed: {error}"))?
}

fn todo_store_dispatch_batch_id_part(value: &str, fallback: &str) -> String {
    let safe = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '-') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(96)
        .collect::<String>();
    if safe.is_empty() {
        fallback.to_string()
    } else {
        safe
    }
}

fn todo_store_dispatch_split_ids(value: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    value
        .split(|character| matches!(character, '\n' | '\r' | ',' | ';'))
        .map(|part| part.trim().trim_matches('"').trim_matches('\'').to_string())
        .filter(|part| !part.is_empty())
        .filter(|part| seen.insert(part.clone()))
        .collect()
}

fn todo_store_dispatch_array_field(value: &Value, keys: &[&str]) -> Option<Vec<Value>> {
    let payload = value.get("payload").filter(|nested| nested.is_object());
    for key in keys {
        for source in [Some(value), payload].into_iter().flatten() {
            if let Some(items) = source.get(*key).and_then(Value::as_array) {
                return Some(items.clone());
            }
        }
    }
    None
}

fn todo_store_dispatch_workspace_ids(request: &Value) -> Vec<String> {
    if let Some(items) = todo_store_dispatch_array_field(
        request,
        &["workspace_ids", "target_workspace_ids", "workspaces"],
    ) {
        let mut seen = HashSet::new();
        return items
            .into_iter()
            .filter_map(|item| {
                let id = if item.is_object() {
                    todo_dispatch_text(&item, &["workspace_id", "id", "target_workspace_id"])
                } else {
                    item.as_str().unwrap_or_default().trim().to_string()
                };
                (!id.is_empty() && seen.insert(id.clone())).then_some(id)
            })
            .collect();
    }
    todo_store_dispatch_split_ids(&todo_dispatch_text(
        request,
        &[
            "workspace_ids",
            "target_workspace_ids",
            "workspace_id",
            "target_workspace_id",
        ],
    ))
}

fn todo_store_dispatch_todo_drafts(request: &Value) -> Result<Vec<Value>, String> {
    if let Some(items) = todo_store_dispatch_array_field(request, &["todo_items"]) {
        let mut drafts = Vec::with_capacity(items.len());
        for (index, item) in items.into_iter().enumerate() {
            if item.is_object() {
                let body = todo_store_draft_text(
                    &item,
                    &["text", "body", "message", "prompt", "long_text", "note_text"],
                    TODO_STORE_DRAFT_TEXT_MAX_CHARS,
                );
                if body.is_empty() {
                    return Err(format!(
                        "todo_items[{}] requires usable todo text or body.",
                        index
                    ));
                }
                drafts.push(item);
            } else {
                let text = todo_store_normalize_draft_text(
                    item.as_str().unwrap_or_default(),
                    TODO_STORE_DRAFT_TEXT_MAX_CHARS,
                );
                if text.is_empty() {
                    return Err(format!(
                        "todo_items[{}] requires usable todo text or body.",
                        index
                    ));
                }
                drafts.push(json!({ "text": text }));
            }
        }
        return Ok(drafts);
    }
    if let Some(items) = todo_store_dispatch_array_field(request, &["todos", "items"]) {
        return Ok(items
            .into_iter()
            .filter_map(|item| {
                if item.is_object() {
                    Some(item)
                } else {
                    let text = item.as_str().unwrap_or_default().trim().to_string();
                    (!text.is_empty()).then(|| json!({ "text": text }))
                }
            })
            .collect());
    }

    // Legacy todo_lines/todos strings were historically line-oriented. Keep
    // that wire contract while allowing a structured todo_items[{text}]
    // payload to carry one intentionally multiline body.
    let legacy_lines = todo_dispatch_text(request, &["todo_lines", "todos"]);
    if !legacy_lines.is_empty() {
        let normalized =
            todo_store_normalize_draft_text(&legacy_lines, TODO_STORE_DRAFT_TEXT_MAX_CHARS);
        return Ok(normalized
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(|line| json!({ "text": line }))
            .collect());
    }

    let text = todo_dispatch_text(request, &["items", "text", "prompt", "message", "body"]);
    let text = todo_store_normalize_draft_text(&text, TODO_STORE_DRAFT_TEXT_MAX_CHARS);
    Ok(text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| json!({ "text": line }))
        .collect())
}

fn todo_store_normalize_loopspace_dispatch_draft(
    draft_object: &mut serde_json::Map<String, Value>,
    sequence: usize,
) {
    let draft = Value::Object(draft_object.clone());
    let text = todo_store_draft_text(
        &draft,
        &[
            "text",
            "body",
            "message",
            "prompt",
            "long_text",
            "note_text",
            "title",
        ],
        TODO_STORE_DRAFT_TEXT_MAX_CHARS,
    );
    if !text.is_empty() {
        draft_object.insert("text".to_string(), json!(text));
    }
    if todo_dispatch_text(&draft, &["title", "name"]).is_empty() {
        draft_object.insert(
            "title".to_string(),
            json!(format!("Loopspace Dispatch Todo #{}", sequence)),
        );
    }
}

fn todo_dispatch_loopspace_batch_lifecycle_from_items(
    items: &[Value],
) -> Option<TodoDispatchLoopspaceBatchLifecycle> {
    let representative = items.first()?.clone();
    let run_id = todo_dispatch_text(&representative, &["loop_runtime_run_id", "run_id"]);
    let batch_id = todo_dispatch_text(&representative, &["todo_batch_id", "batch_id"]);
    if run_id.is_empty() || batch_id.is_empty() {
        return None;
    }

    let mut queued = 0usize;
    let mut running = 0usize;
    let mut completed = 0usize;
    let mut failed = 0usize;
    let mut interrupted = 0usize;
    let mut cancelled = 0usize;
    let mut timed_out = 0usize;
    let mut other = 0usize;
    let mut children = items
        .iter()
        .filter(|item| {
            todo_dispatch_text(item, &["loop_runtime_run_id", "run_id"]) == run_id
                && todo_dispatch_text(item, &["todo_batch_id", "batch_id"]) == batch_id
        })
        .map(|item| {
            let status = todo_store_item_status(item);
            match status.as_str() {
                "queued" | "listed" | "sending" | "dispatching" => queued += 1,
                "running" | "submitted" | "paused" => running += 1,
                "completed" => completed += 1,
                "failed" => failed += 1,
                "interrupted" => interrupted += 1,
                "cancelled" => cancelled += 1,
                "timed_out" => timed_out += 1,
                _ => other += 1,
            }
            json!({
                "command_id": todo_dispatch_text(item, &["command_id"]),
                "dispatch_id": todo_dispatch_text(item, &["dispatch_id", "last_dispatch_id"]),
                "status": status,
                "todo_id": todo_dispatch_text(item, &["todo_id", "id"]),
                "workspace_id": todo_dispatch_text(item, &["workspace_id", "target_workspace_id"]),
            })
        })
        .collect::<Vec<_>>();
    children.sort_by(|left, right| {
        todo_dispatch_text(left, &["workspace_id"])
            .cmp(&todo_dispatch_text(right, &["workspace_id"]))
            .then_with(|| {
                todo_dispatch_text(left, &["todo_id"]).cmp(&todo_dispatch_text(right, &["todo_id"]))
            })
    });
    let total = children.len();
    if total == 0 {
        return None;
    }
    let settled = completed + failed + interrupted + cancelled + timed_out;
    // Batch policy: a terminal callback is emitted only after every child is
    // settled. Failure/cancellation/timeout dominates interruption, which in
    // turn dominates success. Until then, the first submitted or settled child
    // advances the aggregate to running while untouched children may remain queued.
    let status = if settled == total {
        if failed + cancelled + timed_out > 0 {
            "failed"
        } else if interrupted > 0 {
            "interrupted"
        } else if completed == total {
            "completed"
        } else {
            "failed"
        }
    } else if running + settled > 0 {
        "running"
    } else {
        "queued"
    }
    .to_string();
    Some(TodoDispatchLoopspaceBatchLifecycle {
        batch_id,
        run_id,
        status,
        status_counts: json!({
            "cancelled": cancelled,
            "completed": completed,
            "failed": failed,
            "interrupted": interrupted,
            "other": other,
            "queued": queued,
            "running": running,
            "settled": settled,
            "timed_out": timed_out,
            "total": total,
        }),
        children,
        representative,
    })
}

fn todo_dispatch_loopspace_batch_lifecycle_items(item: &Value) -> Vec<Value> {
    let run_id = todo_dispatch_text(item, &["loop_runtime_run_id", "run_id"]);
    let batch_id = todo_dispatch_text(item, &["todo_batch_id", "batch_id"]);
    if run_id.is_empty() || batch_id.is_empty() {
        return Vec::new();
    }
    let _store_guard = todo_dispatch_queue_store_guard();
    todo_dispatch_data_workspace_files("queues")
        .into_iter()
        .flat_map(|path| {
            todo_dispatch_queue_read(&path)
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        })
        .filter(|candidate| {
            todo_dispatch_text(candidate, &["loop_runtime_run_id", "run_id"]) == run_id
                && todo_dispatch_text(candidate, &["todo_batch_id", "batch_id"]) == batch_id
        })
        .collect()
}

fn todo_dispatch_loopspace_batch_lifecycle_items_with_overrides(
    item: &Value,
    overrides: &[Value],
) -> Vec<Value> {
    let run_id = todo_dispatch_text(item, &["loop_runtime_run_id", "run_id"]);
    let batch_id = todo_dispatch_text(item, &["todo_batch_id", "batch_id"]);
    let mut items = todo_dispatch_loopspace_batch_lifecycle_items(item);
    for override_item in overrides.iter().filter(|candidate| {
        todo_dispatch_text(candidate, &["loop_runtime_run_id", "run_id"]) == run_id
            && todo_dispatch_text(candidate, &["todo_batch_id", "batch_id"]) == batch_id
    }) {
        if let Some(existing) = items
            .iter_mut()
            .find(|candidate| todo_store_items_share_identity(candidate, override_item))
        {
            *existing = override_item.clone();
        } else {
            // Startup/orphan reconciliation can originate from a durable mirror
            // row after its queue file disappeared. Include that corrected row
            // in the aggregate instead of leaving the batch lifecycle running.
            items.push(override_item.clone());
        }
    }
    items
}

fn todo_dispatch_loopspace_batch_lifecycle_claim(
    lifecycle: &TodoDispatchLoopspaceBatchLifecycle,
) -> bool {
    let state = TODO_DISPATCH_LOOPSPACE_BATCH_LIFECYCLE
        .get_or_init(|| StdMutex::new(HashMap::new()));
    let Ok(mut state) = state.lock() else {
        return false;
    };
    let key = format!("{}:{}", lifecycle.run_id, lifecycle.batch_id);
    let previous = state.get(&key).map(String::as_str).unwrap_or_default();
    let previous_terminal = matches!(previous, "completed" | "failed" | "interrupted");
    let next_rank = match lifecycle.status.as_str() {
        "queued" => 0,
        "running" => 1,
        "completed" | "failed" | "interrupted" => 2,
        _ => return false,
    };
    let previous_rank = match previous {
        "running" => 1,
        "completed" | "failed" | "interrupted" => 2,
        _ => 0,
    };
    if previous_terminal || previous == lifecycle.status || next_rank < previous_rank {
        return false;
    }
    state.insert(key, lifecycle.status.clone());
    true
}

fn todo_dispatch_loopspace_batch_pending_queued_ack_key(run_id: &str, batch_id: &str) -> String {
    format!("{}:{}", run_id.trim(), batch_id.trim())
}

fn todo_dispatch_loopspace_batch_pending_queued_ack_set(
    run_id: &str,
    batch_id: &str,
    pending: bool,
) {
    if run_id.trim().is_empty() || batch_id.trim().is_empty() {
        return;
    }
    let state = TODO_DISPATCH_LOOPSPACE_BATCH_PENDING_QUEUED_ACK
        .get_or_init(|| StdMutex::new(HashSet::new()));
    if let Ok(mut state) = state.lock() {
        let key = todo_dispatch_loopspace_batch_pending_queued_ack_key(run_id, batch_id);
        if pending {
            state.insert(key);
        } else {
            state.remove(&key);
        }
    }
}

fn todo_dispatch_loopspace_batch_pending_queued_ack(run_id: &str, batch_id: &str) -> bool {
    let state = TODO_DISPATCH_LOOPSPACE_BATCH_PENDING_QUEUED_ACK
        .get_or_init(|| StdMutex::new(HashSet::new()));
    state.lock().ok().is_some_and(|state| {
        state.contains(&todo_dispatch_loopspace_batch_pending_queued_ack_key(
            run_id, batch_id,
        ))
    })
}

fn todo_dispatch_emit_loopspace_batch_lifecycle_with_overrides(
    app: &AppHandle,
    item: &Value,
    overrides: &[Value],
) {
    let run_id = todo_dispatch_text(item, &["loop_runtime_run_id", "run_id"]);
    let batch_id = todo_dispatch_text(item, &["todo_batch_id", "batch_id"]);
    // The queue can be picked up by an already-scheduled dispatcher while the
    // command is still durably enqueueing its queued acknowledgement. Hold
    // later lifecycle callbacks at this boundary, then recompute immediately
    // after the queued acknowledgement is recorded.
    if todo_dispatch_loopspace_batch_pending_queued_ack(&run_id, &batch_id) {
        return;
    }
    let items = todo_dispatch_loopspace_batch_lifecycle_items_with_overrides(item, overrides);
    let Some(lifecycle) = todo_dispatch_loopspace_batch_lifecycle_from_items(&items) else {
        return;
    };
    if lifecycle.status == "queued" || !todo_dispatch_loopspace_batch_lifecycle_claim(&lifecycle) {
        return;
    }
    let mut event = lifecycle.representative.clone();
    let lifecycle_event_id = format!(
        "loopspace-todo-batch:{}:{}:{}",
        lifecycle.run_id, lifecycle.batch_id, lifecycle.status
    );
    if let Some(object) = event.as_object_mut() {
        object.insert("command_id".to_string(), json!(lifecycle.run_id.clone()));
        object.insert(
            "command_kind".to_string(),
            json!("loopspace_dispatch_todos"),
        );
        object.insert("status_event_id".to_string(), json!(lifecycle_event_id.clone()));
        object.insert("todo_batch_id".to_string(), json!(lifecycle.batch_id.clone()));
    }
    let message = match lifecycle.status.as_str() {
        "running" => "Loopspace todo batch started running.",
        "completed" => "All todos in the Loopspace batch completed.",
        "interrupted" => "The Loopspace todo batch was interrupted.",
        _ => "The Loopspace todo batch failed.",
    };
    let details = json!({
        "aggregate_policy": "all_settled_failure_then_interrupted_then_completed",
        "child_todos": lifecycle.children,
        "idempotency_key": lifecycle_event_id,
        "status_counts": lifecycle.status_counts,
        "todo_batch_id": lifecycle.batch_id,
    });
    let status = lifecycle.status;
    let state = app.state::<CloudMcpState>().inner().clone();
    tauri::async_runtime::spawn(async move {
        let _ = cloud_mcp_send_remote_command_status_event(
            &state,
            &event,
            &status,
            message,
            Some(&details),
        )
        .await;
    });
}

fn todo_dispatch_emit_loopspace_batch_lifecycle(app: &AppHandle, item: &Value) {
    todo_dispatch_emit_loopspace_batch_lifecycle_with_overrides(app, item, &[]);
}

fn todo_dispatch_emit_loopspace_batch_lifecycles(app: &AppHandle, items: &[Value]) {
    let mut emitted = HashSet::new();
    for item in items {
        let run_id = todo_dispatch_text(item, &["loop_runtime_run_id", "run_id"]);
        let batch_id = todo_dispatch_text(item, &["todo_batch_id", "batch_id"]);
        if run_id.is_empty() || batch_id.is_empty() {
            continue;
        }
        if emitted.insert(format!("{run_id}:{batch_id}")) {
            todo_dispatch_emit_loopspace_batch_lifecycle_with_overrides(app, item, items);
        }
    }
}

fn todo_store_dispatch_optional_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    let payload = value.get("payload").filter(|nested| nested.is_object());
    for key in keys {
        for source in [Some(value), payload].into_iter().flatten() {
            if let Some(number) = source.get(*key).and_then(Value::as_i64) {
                return Some(number);
            }
            if let Some(number) = source
                .get(*key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .and_then(|text| text.parse::<i64>().ok())
            {
                return Some(number);
            }
        }
    }
    None
}

fn todo_store_dispatch_insert_text(
    object: &mut serde_json::Map<String, Value>,
    request: &Value,
    target_key: &str,
    source_keys: &[&str],
) {
    let value = todo_dispatch_text(request, source_keys);
    if !value.is_empty() {
        object.insert(target_key.to_string(), json!(value));
    }
}

fn todo_store_dispatch_terminal_selector_from_value(
    value: &Value,
    include_terminal_id: bool,
) -> serde_json::Map<String, Value> {
    let target_terminal_id = include_terminal_id
        .then(|| todo_dispatch_text(value, &["target_terminal_id", "terminal_id", "pane_id"]))
        .unwrap_or_default();
    let target_terminal_index = todo_store_dispatch_optional_i64(
        value,
        &["target_terminal_index", "terminal_index"],
    );
    let target_terminal_name =
        todo_dispatch_text(value, &["target_terminal_name", "terminal_name"]);
    let target_thread_id = todo_dispatch_text(value, &["target_thread_id", "thread_id"]);
    let has_selector = !target_terminal_id.is_empty()
        || target_terminal_index.is_some()
        || !target_terminal_name.is_empty()
        || !target_thread_id.is_empty();
    let mut selector = serde_json::Map::new();
    selector.insert(
        "target_terminal_mode".to_string(),
        json!(if has_selector { "pinned" } else { "auto" }),
    );
    if !target_terminal_id.is_empty() {
        selector.insert(
            "target_terminal_id".to_string(),
            json!(target_terminal_id),
        );
    }
    if let Some(index) = target_terminal_index {
        selector.insert("target_terminal_index".to_string(), json!(index));
    }
    if !target_terminal_name.is_empty() {
        selector.insert(
            "target_terminal_name".to_string(),
            json!(target_terminal_name),
        );
    }
    if !target_thread_id.is_empty() {
        selector.insert("target_thread_id".to_string(), json!(target_thread_id));
    }
    if has_selector {
        selector.insert("target_explicit".to_string(), json!(true));
        selector.insert("explicit_target".to_string(), json!(true));
        selector.insert("user_pinned_target".to_string(), json!(true));
    }
    selector
}

fn todo_store_dispatch_terminal_selector_for_workspace(
    request: &Value,
    workspace_id: &str,
    workspace_count: usize,
) -> serde_json::Map<String, Value> {
    if let Some(selectors) = todo_store_dispatch_array_field(
        request,
        &["target_terminal_selectors", "workspace_terminal_selectors"],
    ) {
        return selectors
            .iter()
            .find(|selector| {
                todo_dispatch_text(
                    selector,
                    &["workspace_id", "target_workspace_id", "id"],
                ) == workspace_id
            })
            .map(|selector| todo_store_dispatch_terminal_selector_from_value(selector, true))
            .unwrap_or_else(|| {
                todo_store_dispatch_terminal_selector_from_value(&json!({}), false)
            });
    }

    let target_terminal_id =
        todo_dispatch_text(request, &["target_terminal_id", "terminal_id", "pane_id"]);
    let target_terminal_workspace_id = todo_dispatch_text(
        request,
        &[
            "target_terminal_workspace_id",
            "terminal_workspace_id",
        ],
    );
    let include_terminal_id = target_terminal_id.is_empty()
        || workspace_count == 1
        || (!target_terminal_workspace_id.is_empty()
            && target_terminal_workspace_id == workspace_id);
    todo_store_dispatch_terminal_selector_from_value(request, include_terminal_id)
}

fn todo_store_dispatch_apply_terminal_selector(
    object: &mut serde_json::Map<String, Value>,
    selector: &serde_json::Map<String, Value>,
) {
    let selector_keys = [
        "target_terminal_id",
        "terminal_id",
        "pane_id",
        "target_terminal_index",
        "terminal_index",
        "target_terminal_mode",
        "terminal_mode",
        "target_terminal_name",
        "terminal_name",
        "target_thread_id",
        "thread_id",
        "target_explicit",
        "explicit_target",
        "user_pinned_target",
    ];
    for key in selector_keys {
        object.remove(key);
    }
    if let Some(remote_command) = object
        .get_mut("remote_command")
        .and_then(Value::as_object_mut)
    {
        for key in selector_keys {
            remote_command.remove(key);
        }
        remote_command.extend(selector.clone());
    }
    object.extend(selector.clone());
}

#[tauri::command(rename_all = "snake_case")]
async fn todo_store_dispatch_loopspace_batch(
    app: AppHandle,
    request: Value,
    reason: Option<String>,
) -> Result<Value, String> {
    if !request.is_object() {
        return Err("Dispatch request must be an object.".to_string());
    }
    let workspace_ids = todo_store_dispatch_workspace_ids(&request);
    if workspace_ids.is_empty() {
        return Err("Dispatch todos requires at least one workspace id.".to_string());
    }
    let todo_drafts = todo_store_dispatch_todo_drafts(&request)?;
    if todo_drafts.is_empty() {
        return Err("Dispatch todos requires at least one todo.".to_string());
    }
    let reason = reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "loopspace_dispatch_todos".to_string());
    let loopspace_id = todo_dispatch_text(&request, &["loopspace_id"]);
    let node_id = todo_dispatch_text(&request, &["node_id", "loop_runtime_node_id"]);
    let requested_batch_id = todo_dispatch_text(&request, &["todo_batch_id", "batch_id"]);
    let batch_id = if requested_batch_id.is_empty() {
        format!(
            "loopspace-{}-{}-{}",
            todo_store_dispatch_batch_id_part(&loopspace_id, "loop"),
            todo_store_dispatch_batch_id_part(&node_id, "node"),
            uuid::Uuid::new_v4()
        )
    } else {
        requested_batch_id
    };
    let loop_runtime_run_id = todo_dispatch_text(
        &request,
        &["loop_runtime_run_id", "run_id", "command_id"],
    );
    todo_dispatch_loopspace_batch_pending_queued_ack_set(
        &loop_runtime_run_id,
        &batch_id,
        true,
    );
    let status_event = request.clone();
    let worker_app = app.clone();
    let worker_batch_id = batch_id.clone();

    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let app = worker_app;
        let batch_id = worker_batch_id;
        let mut base = serde_json::Map::new();
        for (target_key, source_keys) in [
            ("device_id", &["device_id", "source_device_id"][..]),
            ("target_device_id", &["target_device_id", "device_id"][..]),
            ("target_agent_id", &["target_agent_id", "agent_id"][..]),
            ("model", &["model", "model_id"][..]),
            ("reasoning_effort", &["reasoning_effort", "effort"][..]),
            ("effort", &["effort", "reasoning_effort"][..]),
            ("speed", &["speed", "service_tier"][..]),
            ("loopspace_id", &["loopspace_id"][..]),
            (
                "loop_runtime_node_id",
                &["loop_runtime_node_id", "node_id"][..],
            ),
            ("node_id", &["node_id", "loop_runtime_node_id"][..]),
            (
                "loop_runtime_run_id",
                &["loop_runtime_run_id", "run_id"][..],
            ),
            (
                "loop_runtime_edge_id",
                &["loop_runtime_edge_id", "edge_id"][..],
            ),
            ("trigger_id", &["trigger_id"][..]),
            ("trigger_run_id", &["trigger_run_id"][..]),
            (
                "command_kind",
                &["command_kind", "kind", "type", "action"][..],
            ),
        ] {
            todo_store_dispatch_insert_text(&mut base, &request, target_key, source_keys);
        }
        if !base.contains_key("command_kind") {
            base.insert(
                "command_kind".to_string(),
                json!("loopspace_dispatch_todos"),
            );
        }
        base.insert("batch_id".to_string(), json!(batch_id.clone()));
        base.insert("todo_batch_id".to_string(), json!(batch_id.clone()));
        base.insert("kind".to_string(), json!("todo"));
        base.insert("source".to_string(), json!("loopspace-dispatch-todos"));
        base.insert("status".to_string(), json!("queued"));
        base.insert("todo_status".to_string(), json!("queued"));

        let _store_guard = todo_dispatch_queue_store_guard();
        let mut all_items = Vec::new();
        let mut workspace_results = Vec::new();
        let mut total_queued = 0usize;

        let workspace_count = workspace_ids.len();
        for workspace_id in workspace_ids {
            let workspace_id = workspace_id.trim().to_string();
            if workspace_id.is_empty() || todo_dispatch_workspace_is_deleted(&workspace_id) {
                continue;
            }
            let terminal_selector = todo_store_dispatch_terminal_selector_for_workspace(
                &request,
                &workspace_id,
                workspace_count,
            );
            let mut stored_items = todo_dispatch_data_path("queues", &workspace_id)
                .map(|path| {
                    todo_dispatch_queue_read(&path)
                        .get("items")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default()
                })
                .unwrap_or_default();
            let mut changed_items = Vec::new();
            let mut result_items = Vec::new();

            for (todo_index, todo_draft) in todo_drafts.iter().enumerate() {
                let sequence = todo_index + 1;
                let mut draft_object = base.clone();
                if let Some(todo_object) = todo_draft.as_object() {
                    for (key, value) in todo_object {
                        draft_object.insert(key.clone(), value.clone());
                    }
                }
                todo_store_dispatch_apply_terminal_selector(
                    &mut draft_object,
                    &terminal_selector,
                );
                todo_store_normalize_loopspace_dispatch_draft(&mut draft_object, sequence);
                let requested_todo_id = todo_dispatch_text(
                    &Value::Object(draft_object.clone()),
                    &["id", "todo_id", "command_id"],
                );
                let todo_id = if requested_todo_id.is_empty() {
                    format!(
                        "{}-{}-{}",
                        todo_store_dispatch_batch_id_part(&batch_id, "batch"),
                        todo_store_dispatch_batch_id_part(&workspace_id, "workspace"),
                        sequence
                    )
                } else {
                    requested_todo_id
                };
                let dispatch_id = todo_dispatch_text(
                    &Value::Object(draft_object.clone()),
                    &["dispatch_id", "todo_dispatch_id"],
                );
                let dispatch_id = if dispatch_id.is_empty() {
                    format!("{todo_id}-dispatch")
                } else {
                    dispatch_id
                };
                draft_object.insert("id".to_string(), json!(todo_id.clone()));
                draft_object.insert("todo_id".to_string(), json!(todo_id.clone()));
                draft_object.insert("command_id".to_string(), json!(todo_id.clone()));
                draft_object.insert("dispatch_id".to_string(), json!(dispatch_id.clone()));
                draft_object.insert("last_dispatch_id".to_string(), json!(dispatch_id.clone()));
                draft_object.insert(
                    "target_workspace_id".to_string(),
                    json!(workspace_id.clone()),
                );
                draft_object.insert("workspace_id".to_string(), json!(workspace_id.clone()));
                draft_object.insert("todo_number".to_string(), json!(sequence));
                draft_object.insert("todo_sequence".to_string(), json!(sequence));

                let mut item = todo_store_build_created_item(
                    &workspace_id,
                    &Value::Object(draft_object),
                    &reason,
                )?;
                todo_store_set_item_status(&mut item, "queued", &reason);
                let item_id = todo_store_item_sync_id(&item);
                if item_id.is_empty() {
                    continue;
                }

                let mut existing_index = None;
                for (index, existing) in stored_items.iter().enumerate() {
                    if todo_store_item_matches_id(existing, &item_id) {
                        existing_index = Some(index);
                        break;
                    }
                }
                if let Some(index) = existing_index {
                    let current_status = todo_store_item_status(&stored_items[index]);
                    if matches!(
                        current_status.as_str(),
                        "running"
                            | "completed"
                            | "failed"
                            | "cancelled"
                            | "interrupted"
                            | "timed_out"
                            | "deleted"
                    ) {
                        result_items.push(stored_items[index].clone());
                        all_items.push(stored_items[index].clone());
                        continue;
                    }
                    stored_items[index] = item.clone();
                } else {
                    stored_items.push(item.clone());
                }
                changed_items.push(item.clone());
                result_items.push(item.clone());
                all_items.push(item);
            }

            if !changed_items.is_empty() {
                todo_dispatch_queue_write(&workspace_id, &stored_items);
                todo_store_push_items(&app, &workspace_id, changed_items.clone(), &reason);
                todo_store_emit_changed(&app, &workspace_id, &reason, "loopspace_dispatch_todos");
                total_queued += changed_items.len();
            }
            workspace_results.push(json!({
                "workspace_id": workspace_id,
                "queued_count": changed_items.len(),
                "items": result_items,
            }));
        }

        let batch_lifecycle = todo_dispatch_loopspace_batch_lifecycle_from_items(&all_items);
        if let Some(lifecycle) = batch_lifecycle.as_ref() {
            if lifecycle.status == "queued" {
                let _ = todo_dispatch_loopspace_batch_lifecycle_claim(lifecycle);
            }
        }
        let child_todos = batch_lifecycle
            .as_ref()
            .map(|lifecycle| lifecycle.children.clone())
            .unwrap_or_default();
        let status_counts = batch_lifecycle
            .as_ref()
            .map(|lifecycle| lifecycle.status_counts.clone())
            .unwrap_or_else(|| json!({
                "queued": total_queued,
                "settled": 0,
                "total": total_queued,
            }));

        Ok(json!({
            "ok": true,
            "batch_id": batch_id.clone(),
            "todo_batch_id": batch_id,
            "queued_count": total_queued,
            "child_todos": child_todos,
            "status_counts": status_counts,
            "items": all_items,
            "workspaces": workspace_results}))
    })
    .await
    .map_err(|error| format!("Loopspace todo dispatch worker failed: {error}"));
    let result = match result {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => {
            todo_dispatch_loopspace_batch_pending_queued_ack_set(
                &loop_runtime_run_id,
                &batch_id,
                false,
            );
            return Err(error);
        }
        Err(error) => {
            todo_dispatch_loopspace_batch_pending_queued_ack_set(
                &loop_runtime_run_id,
                &batch_id,
                false,
            );
            return Err(error);
        }
    };

    let queued_count = result
        .get("queued_count")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let loopspace_id = todo_dispatch_text(&status_event, &["loopspace_id"]);
    if queued_count > 0 && !loop_runtime_run_id.is_empty() && !loopspace_id.is_empty() {
        let batch_id = todo_dispatch_text(&result, &["todo_batch_id", "batch_id"]);
        let lifecycle_event_id = format!(
            "loopspace-todo-batch:{loop_runtime_run_id}:{batch_id}:queued"
        );
        let mut queued_event = status_event.clone();
        if let Some(object) = queued_event.as_object_mut() {
            object.insert("status_event_id".to_string(), json!(lifecycle_event_id.clone()));
        }
        let workspace_count = result
            .get("workspaces")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or_default();
        let details = json!({
            "child_todos": result.get("child_todos").cloned().unwrap_or_else(|| json!([])),
            "command_kind": "loopspace_dispatch_todos",
            "idempotency_key": lifecycle_event_id,
            "queued_count": queued_count,
            "status_counts": result.get("status_counts").cloned().unwrap_or_else(|| json!({})),
            "todo_batch_id": result.get("todo_batch_id").cloned().unwrap_or(Value::Null),
            "workspace_count": workspace_count,
        });
        let state = app.state::<CloudMcpState>().inner().clone();
        let _ = cloud_mcp_send_remote_command_status_event(
            &state,
            &queued_event,
            "queued",
            &format!(
                "Queued {queued_count} todo{} across {workspace_count} workspace{}.",
                if queued_count == 1 { "" } else { "s" },
                if workspace_count == 1 { "" } else { "s" },
            ),
            Some(&details),
        )
        .await;
    }
    todo_dispatch_loopspace_batch_pending_queued_ack_set(
        &loop_runtime_run_id,
        &batch_id,
        false,
    );
    if let Some(item) = result
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
    {
        todo_dispatch_emit_loopspace_batch_lifecycle(&app, item);
    }
    if queued_count > 0 {
        todo_dispatch_wake_background_dispatcher(app);
    }
    Ok(result)
}

fn todo_store_apply_update_patch(item: &mut Value, patch: &Value) -> bool {
    let Some(object) = item.as_object_mut() else {
        return false;
    };
    let mut changed = false;
    let text_patch = patch
        .get("text")
        .or_else(|| patch.get("body"))
        .or_else(|| patch.get("title"));
    if let Some(value) = text_patch {
        let text = todo_store_normalize_draft_text(
            value.as_str().unwrap_or_default(),
            TODO_STORE_DRAFT_TEXT_MAX_CHARS,
        );
        if object.get("text").and_then(Value::as_str) != Some(text.as_str()) {
            object.insert("text".to_string(), json!(text));
            changed = true;
        }
    }
    if changed {
        let now_iso = chrono_like_now_iso();
        object.insert("updated_at".to_string(), json!(now_iso));
        object.insert("updated_at_ms".to_string(), json!(todo_dispatch_now_ms()));
    }
    changed
}

#[tauri::command(rename_all = "snake_case")]
async fn todo_store_update(
    app: AppHandle,
    workspace_id: String,
    todo_id: String,
    patch: Value,
    reason: Option<String>,
) -> Result<Value, String> {
    let workspace_id = workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id is required.".to_string());
    }
    let todo_id = todo_id.trim().to_string();
    if todo_id.is_empty() {
        return Err("todo_id is required.".to_string());
    }
    let reason = reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "todo_store_update".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        let _store_guard = todo_dispatch_queue_store_guard();
        let tombstoned = todo_store_tombstone_ids(&workspace_id);
        if tombstoned.contains(&todo_id) {
            return Err("Todo id is tombstoned.".to_string());
        }
        let Some(path) = todo_dispatch_data_path("queues", &workspace_id) else {
            return Err("Todo store path is unavailable.".to_string());
        };
        let mut items = todo_dispatch_queue_read(&path)
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut updated_item: Option<Value> = None;
        for item in items.iter_mut() {
            if !todo_store_item_matches_id(item, &todo_id) {
                continue;
            }
            if todo_store_item_is_tombstoned(item, &tombstoned) {
                return Err("Todo id is tombstoned.".to_string());
            }
            todo_store_apply_update_patch(item, &patch);
            todo_store_canonicalize_settled_evidence(item);
            todo_store_canonicalize_status_fields(item);
            updated_item = Some(item.clone());
            break;
        }
        let Some(item) = updated_item else {
            return Err("Todo was not found in the Rust store.".to_string());
        };
        todo_dispatch_queue_write(&workspace_id, &items);
        todo_store_push_items(&app, &workspace_id, vec![item.clone()], &reason);
        todo_store_emit_changed(&app, &workspace_id, &reason, "store");
        Ok(json!({
            "ok": true,
            "workspace_id": workspace_id,
            "item": item,
        }))
    })
    .await
    .map_err(|error| format!("Todo store update worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn todo_store_delete(
    app: AppHandle,
    workspace_id: String,
    todo_ids: Vec<String>,
    reason: Option<String>,
) -> Result<Value, String> {
    let workspace_id = workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id is required.".to_string());
    }
    let reason = reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "todo_store_delete".to_string());
    let result = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let workspace_id = workspace_id.clone();
        move || {
            let _store_guard = todo_dispatch_queue_store_guard();
            todo_store_delete_internal(&app, &workspace_id, &todo_ids, &reason, "user_delete")
        }
    })
    .await
    .map_err(|error| format!("Todo store delete worker failed: {error}"))?;
    Ok(json!({
        "workspace_id": workspace_id,
        "deleted_ids": result.removed_ids,
        "hard_deleted_ids": result.hard_deleted_ids,
        "tombstoned_ids": result.tombstoned_ids,
    }))
}

/// Cancel with a guaranteed outcome. If the todo's pane is mid-turn and a
/// webview is alive, the webview actuator is asked to interrupt the terminal;
/// in every case the store row (or, for rows that only exist in the cloud
/// mirror, a pushed correction) ends up `cancelled` so the UI can never show
/// a running todo that nothing can stop.
#[tauri::command(rename_all = "snake_case")]
async fn todo_store_cancel(
    app: AppHandle,
    workspace_id: String,
    todo_id: Option<String>,
    command_id: Option<String>,
    dispatch_id: Option<String>,
    reason: Option<String>,
) -> Result<Value, String> {
    let workspace_id = workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id is required.".to_string());
    }
    let reason = reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "todo_history_cancel".to_string());
    let refs = [todo_id, command_id, dispatch_id]
        .into_iter()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if refs.is_empty() {
        return Err("A todo id, command id, or dispatch id is required.".to_string());
    }

    let mut result = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            let _store_guard = todo_dispatch_queue_store_guard();
            let mut matched_item: Option<Value> = None;
            let mut lifecycle_items = Vec::new();
            let mut interrupt_pane_id = String::new();
            let mut interrupt_instance_id: Option<u64> = None;
            if let Some(path) = todo_dispatch_data_path("queues", &workspace_id) {
                let mut items = todo_dispatch_queue_read(&path)
                    .get("items")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                for item in items.iter_mut() {
                    if refs
                        .iter()
                        .any(|reference| todo_store_item_matches_id(item, reference))
                    {
                        todo_store_set_item_status(item, "cancelled", &reason);
                        matched_item = Some(item.clone());
                        break;
                    }
                }
                if matched_item.is_some() {
                    todo_dispatch_queue_write(&workspace_id, &items);
                }
            }

            let mut actuated = false;
            let mut corrected = false;
            if let Some(item) = matched_item.as_ref() {
                let pane_id = todo_store_item_pane_id(item);
                // inputReady == false means the pane is mid-turn: ask the webview
                // actuator to interrupt the terminal itself.
                if !pane_id.is_empty() && todo_dispatch_pane_input_ready(&pane_id) == Some(false) {
                    interrupt_pane_id = pane_id.clone();
                    interrupt_instance_id = item
                        .get("terminal_instance_id")
                        .or_else(|| item.get("instance_id"))
                        .and_then(Value::as_u64);
                    let _ = app.emit(
                        TODO_STORE_CANCEL_REQUESTED_EVENT,
                        json!({
                            "workspace_id": workspace_id,
                            "item_id": item.get("id").cloned().unwrap_or(Value::Null),
                            "pane_id": pane_id,
                            "refs": refs,
                            "reason": reason,
                        }),
                    );
                    actuated = true;
                }
                todo_store_push_corrections(
                    &app,
                    &workspace_id,
                    vec![item.clone()],
                    "todo_store_cancel",
                );
                lifecycle_items.push(item.clone());
            } else {
                // Not in the device store: the row the user is looking at lives in
                // the cloud mirror (stale "running" from a dead session or another
                // replica). Push a cancelled correction built from the mirror row
                // so every view converges instead of erroring.
                for reference in &refs {
                    if let Some(mut item) =
                        cloud_mcp_todo_mirror_correction_item(&workspace_id, reference)
                    {
                        todo_store_set_item_status(&mut item, "cancelled", &reason);
                        todo_store_push_corrections(
                            &app,
                            &workspace_id,
                            vec![item.clone()],
                            "todo_store_cancel_correction",
                        );
                        lifecycle_items.push(item);
                        corrected = true;
                        break;
                    }
                }
                if !corrected {
                    // No replica knows this row beyond its id: push a minimal
                    // cancelled correction so even an id-only zombie converges.
                    let reference = refs[0].clone();
                    let mut item = json!({
                        "id": reference,
                        "todo_id": reference,
                        "kind": "todo",
                        "workspace_id": workspace_id,
                    });
                    todo_store_set_item_status(&mut item, "cancelled", &reason);
                    todo_store_push_corrections(
                        &app,
                        &workspace_id,
                        vec![item.clone()],
                        "todo_store_cancel_correction",
                    );
                    lifecycle_items.push(item);
                    corrected = true;
                }
            }
            todo_store_emit_changed(&app, &workspace_id, "todo_store_cancel", "store");
            drop(_store_guard);
            todo_dispatch_emit_loopspace_batch_lifecycles(&app, &lifecycle_items);
            Ok::<Value, String>(json!({
                "ok": true,
                "workspace_id": workspace_id,
                "status": "cancelled",
                "actuated": actuated,
                "corrected": corrected,
                "interrupt_pane_id": interrupt_pane_id,
                "interrupt_instance_id": interrupt_instance_id,
                "matched_in_store": matched_item.is_some(),
            }))
        }
    })
    .await
    .map_err(|error| format!("Todo store cancel worker failed: {error}"))??;
    if !todo_dispatch_webview_dispatcher_active() {
        let interrupt_pane_id = todo_dispatch_text(&result, &["interrupt_pane_id"]);
        let interrupt_instance_id = result.get("interrupt_instance_id").and_then(Value::as_u64);
        if !interrupt_pane_id.is_empty() {
            let interrupt_result = terminal_interrupt_agent_remote(
                app,
                interrupt_pane_id.clone(),
                interrupt_instance_id,
                "todo_store_cancel".to_string(),
            )
            .await;
            if let Some(object) = result.as_object_mut() {
                match interrupt_result {
                    Ok(value) => {
                        object.insert("headless_interrupt".to_string(), json!(true));
                        object.insert("headless_interrupt_result".to_string(), json!(value));
                    }
                    Err(error) => {
                        object.insert("headless_interrupt".to_string(), json!(false));
                        object.insert(
                            "headless_interrupt_error".to_string(),
                            json!(clean_terminal_telemetry_text(&error)),
                        );
                    }
                }
            }
        }
    }
    Ok(result)
}

const TODO_DROP_IMAGE_MAX_BYTES: u64 = 16 * 1024 * 1024;

/// Reads an OS-dropped image file into a data URL so it can attach to a todo
/// (draft or existing). Restricted to image extensions with a size cap — this
/// is a UI attachment path, not a general file reader.
#[tauri::command(rename_all = "snake_case")]
async fn todo_read_image_data_url(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path.trim());
        let extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();
        if !matches!(
            extension.as_str(),
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "avif" | "heic"
        ) {
            return Err(format!("Not an image file: .{extension}"));
        }
        let metadata =
            fs::metadata(&path).map_err(|error| format!("Unable to read dropped file: {error}"))?;
        if !metadata.is_file() {
            return Err("Dropped path is not a file.".to_string());
        }
        if metadata.len() > TODO_DROP_IMAGE_MAX_BYTES {
            return Err("Dropped image is too large to attach (16 MB cap).".to_string());
        }
        let bytes =
            fs::read(&path).map_err(|error| format!("Unable to read dropped image: {error}"))?;
        let mime = cloud_mcp_asset_mime_for_path(&path);
        let mime = if mime.trim().is_empty() {
            "image/png".to_string()
        } else {
            mime
        };
        Ok(format!(
            "data:{mime};base64,{}",
            general_purpose::STANDARD.encode(bytes)
        ))
    })
    .await
    .map_err(|error| format!("Todo image read worker failed: {error}"))?
}

/// Status correction with the same guaranteed-outcome shape as cancel but no
/// terminal actuation: flips the store row when the device tracks it, else
/// pushes a correction built from the mirror row (or the bare id). This is
/// what lets history-view Unqueue work on rows no webview owns.
/// Optional terminal-target stamping for status flips driven from the history
/// view (Queue / retarget). `clear_target` wins over the individual fields.
fn todo_store_apply_target_fields(
    item: &mut Value,
    clear_target: bool,
    target_terminal_index: Option<i64>,
    target_terminal_id: Option<&str>,
    target_thread_id: Option<&str>,
    target_agent_id: Option<&str>,
) {
    let Some(object) = item.as_object_mut() else {
        return;
    };
    let requested_target_terminal_id = target_terminal_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let terminal_assignment_requested = target_terminal_id.is_some()
        || target_terminal_index.is_some()
        || target_thread_id.is_some();
    let assignment_requested_without_id =
        terminal_assignment_requested && requested_target_terminal_id.is_none();
    if clear_target || assignment_requested_without_id {
        for key in [
            "target_color_slot",
            "target_terminal_color",
            "target_terminal_id",
            "target_terminal_index",
            "target_terminal_name",
            "target_thread_id",
            "target_explicit",
            "explicit_target",
            "user_pinned_target",
        ] {
            object.remove(key);
        }
        return;
    }
    if let Some(target_terminal_id) = requested_target_terminal_id {
        object.insert("target_terminal_id".to_string(), json!(target_terminal_id));
        if let Some(index) = target_terminal_index {
            object.insert("target_terminal_index".to_string(), json!(index));
        }
        for (key, value) in [
            ("target_thread_id", target_thread_id),
            ("target_agent_id", target_agent_id),
        ] {
            if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
                object.insert(key.to_string(), json!(value));
            }
        }
        object.insert("target_explicit".to_string(), json!(true));
        object.insert("explicit_target".to_string(), json!(true));
        object.insert("user_pinned_target".to_string(), json!(true));
    } else if target_terminal_id.is_none() {
        // Agent affinity may be updated without assigning a specific terminal.
        let key = "target_agent_id";
        let value = target_agent_id;
        if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
            object.insert(key.to_string(), json!(value));
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
async fn todo_store_set_status(
    app: AppHandle,
    workspace_id: String,
    todo_id: Option<String>,
    command_id: Option<String>,
    dispatch_id: Option<String>,
    item: Option<Value>,
    status: String,
    reason: Option<String>,
    target_terminal_index: Option<i64>,
    target_terminal_id: Option<String>,
    target_thread_id: Option<String>,
    target_agent_id: Option<String>,
    clear_target: Option<bool>,
) -> Result<Value, String> {
    let workspace_id = workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id is required.".to_string());
    }
    let status = todo_store_normalize_lifecycle_status(&status);
    if !matches!(
        status.as_str(),
        "listed"
            | "queued"
            | "running"
            | "paused"
            | "cancelled"
            | "interrupted"
            | "completed"
            | "failed"
            | "timed_out"
            | "deleted"
    ) {
        return Err(format!("Unsupported todo status: {status}"));
    }
    let reason = reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "todo_store_set_status".to_string());
    let refs = [todo_id, command_id, dispatch_id]
        .into_iter()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if refs.is_empty() {
        return Err("A todo id, command id, or dispatch id is required.".to_string());
    }
    let item_payload = item.filter(|value| value.is_object());

    tauri::async_runtime::spawn_blocking(move || {
        let _store_guard = todo_dispatch_queue_store_guard();
        let clear_target = clear_target.unwrap_or(false);
        let apply_targets = |item: &mut Value| {
            todo_store_apply_target_fields(
                item,
                clear_target,
                target_terminal_index,
                target_terminal_id.as_deref(),
                target_thread_id.as_deref(),
                target_agent_id.as_deref(),
            );
        };
        let mut matched_item: Option<Value> = None;
        if let Some(path) = todo_dispatch_data_path("queues", &workspace_id) {
            let mut items = todo_dispatch_queue_read(&path)
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for item in items.iter_mut() {
                if refs
                    .iter()
                    .any(|reference| todo_store_item_matches_id(item, reference))
                {
                    todo_store_set_item_status(item, &status, &reason);
                    if status == "queued" {
                        todo_store_set_item_lifecycle_owner(item, "rust");
                    }
                    apply_targets(item);
                    matched_item = Some(item.clone());
                    break;
                }
            }
            if matched_item.is_some() {
                todo_dispatch_queue_write(&workspace_id, &items);
            }
        }

        let correction = match matched_item.clone() {
            Some(item) => item,
            None => {
                let mut item = refs
                    .iter()
                    .find_map(|reference| {
                        cloud_mcp_todo_mirror_correction_item(&workspace_id, reference)
                    })
                    .or_else(|| item_payload.clone())
                    .unwrap_or_else(|| {
                        json!({
                            "id": refs[0],
                            "todo_id": refs[0],
                            "kind": "todo",
                            "workspace_id": workspace_id,
                        })
                    });
                if let Some(object) = item.as_object_mut() {
                    object
                        .entry("id".to_string())
                        .or_insert_with(|| json!(refs[0].clone()));
                    object
                        .entry("todo_id".to_string())
                        .or_insert_with(|| json!(refs[0].clone()));
                    object
                        .entry("kind".to_string())
                        .or_insert_with(|| json!("todo"));
                    object.insert("workspace_id".to_string(), json!(workspace_id.clone()));
                }
                todo_store_set_item_status(&mut item, &status, &reason);
                if status == "queued" {
                    todo_store_set_item_lifecycle_owner(&mut item, "rust");
                }
                apply_targets(&mut item);
                item
            }
        };
        if matched_item.is_none() {
            if let Some(path) = todo_dispatch_data_path("queues", &workspace_id) {
                let mut items = todo_dispatch_queue_read(&path)
                    .get("items")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                items.retain(|candidate| {
                    !refs
                        .iter()
                        .any(|reference| todo_store_item_matches_id(candidate, reference))
                });
                items.push(correction.clone());
                todo_dispatch_queue_write(&workspace_id, &items);
            }
        }
        todo_store_push_corrections(&app, &workspace_id, vec![correction.clone()], &reason);
        todo_store_enqueue_item_todo_sync_commit(
            &app,
            &workspace_id,
            correction.clone(),
            &reason,
            "rust-diffforge-todo-store",
        );
        todo_store_emit_changed(&app, &workspace_id, &reason, "store");
        if status == "queued" {
            todo_dispatch_wake_background_dispatcher(app.clone());
        }
        Ok(json!({
            "ok": true,
            "workspace_id": workspace_id,
            "status": status,
            "item": correction,
            "matched_in_store": matched_item.is_some(),
        }))
    })
    .await
    .map_err(|error| format!("Todo store set-status worker failed: {error}"))?
}

fn todo_store_queue_all_apply_core(
    mut stored_items: Vec<Value>,
    requested_items: Vec<Value>,
    workspace_id: &str,
    reason: &str,
) -> (Vec<Value>, Vec<Value>) {
    let mut corrections = Vec::new();
    let mut queued_ids = HashSet::new();

    for requested_item in requested_items {
        if !requested_item.is_object() {
            continue;
        }
        let item_id = todo_store_item_sync_id(&requested_item);
        if item_id.is_empty() || queued_ids.contains(&item_id) {
            continue;
        }
        let text = todo_dispatch_backend_item_text(&requested_item);
        if text.is_empty() || todo_dispatch_backend_item_has_image_attachment(&requested_item) {
            continue;
        }
        queued_ids.insert(item_id.clone());

        let mut updated = None;
        for stored_item in &mut stored_items {
            if !todo_store_item_matches_id(stored_item, &item_id) {
                continue;
            }
            let status = todo_store_item_status(stored_item);
            if matches!(
                status.as_str(),
                "queued" | "running" | "completed" | "deleted"
            ) {
                updated = Some(stored_item.clone());
                break;
            }
            todo_store_set_item_status(stored_item, "queued", reason);
            todo_store_apply_target_fields(stored_item, true, None, None, None, None);
            updated = Some(stored_item.clone());
            break;
        }
        if updated.is_none() {
            let mut item = requested_item.clone();
            if let Some(object) = item.as_object_mut() {
                object.insert("id".to_string(), json!(item_id.clone()));
                object
                    .entry("todo_id".to_string())
                    .or_insert_with(|| json!(item_id.clone()));
                object
                    .entry("kind".to_string())
                    .or_insert_with(|| json!("todo"));
                object.insert("workspace_id".to_string(), json!(workspace_id));
            }
            todo_store_set_item_status(&mut item, "queued", reason);
            todo_store_apply_target_fields(&mut item, true, None, None, None, None);
            stored_items.push(item.clone());
            updated = Some(item);
        }
        if let Some(item) = updated {
            if todo_store_item_status(&item) == "queued" {
                corrections.push(item);
            }
        }
    }

    (stored_items, corrections)
}

#[tauri::command(rename_all = "snake_case")]
async fn todo_store_queue_all(
    app: AppHandle,
    workspace_id: String,
    items: Value,
    reason: Option<String>,
) -> Result<Value, String> {
    let workspace_id = workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id is required.".to_string());
    }
    let requested_items = items.as_array().cloned().unwrap_or_default();
    if requested_items.is_empty() {
        return Ok(json!({
            "ok": true,
            "workspace_id": workspace_id,
            "queued_count": 0,
            "items": [],
        }));
    }
    let reason = reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "todo_store_queue_all".to_string());

    let tick_lock = TODO_DISPATCH_BACKEND_TICK_LOCK.get_or_init(|| Mutex::new(()));
    let _tick_guard = tick_lock.lock().await;

    let result = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let workspace_id = workspace_id.clone();
        let reason = reason.clone();
        move || {
            let _store_guard = todo_dispatch_queue_store_guard();
            let stored_items = todo_dispatch_data_path("queues", &workspace_id)
                .map(|path| {
                    todo_dispatch_queue_read(&path)
                        .get("items")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default()
                })
                .unwrap_or_default();
            let (stored_items, corrections) = todo_store_queue_all_apply_core(
                stored_items,
                requested_items,
                &workspace_id,
                &reason,
            );

            if !corrections.is_empty() {
                todo_dispatch_queue_write(&workspace_id, &stored_items);
                todo_store_push_corrections(&app, &workspace_id, corrections.clone(), &reason);
                for item in &corrections {
                    todo_store_enqueue_item_todo_sync_commit(
                        &app,
                        &workspace_id,
                        item.clone(),
                        &reason,
                        "rust-diffforge-todo-store",
                    );
                }
                todo_store_emit_changed(&app, &workspace_id, &reason, "store");
            }

            Ok::<Value, String>(json!({
                "ok": true,
                "workspace_id": workspace_id,
                "queued_count": corrections.len(),
                "items": corrections,
            }))
        }
    })
    .await
    .map_err(|error| format!("Todo store queue-all worker failed: {error}"))??;

    todo_dispatch_wake_background_dispatcher(app.clone());
    Ok(result)
}

/// Standing orphan sweep: running/sending rows that nothing is actually
/// driving flip to `interrupted` instead of haunting every view forever.
/// Rust owns queue-store settlement in foreground and background; stale
/// device-local mirror rows are healed too, because nothing else will ever
/// settle them.
async fn todo_store_orphan_sweep_tick(app: &AppHandle) {
    let now_ms = todo_dispatch_now_ms();
    let _store_guard = todo_dispatch_queue_store_guard();
    let mut lifecycle_items = Vec::new();

    for path in todo_dispatch_data_workspace_files("queues") {
        let snapshot = todo_dispatch_queue_read(&path);
        let workspace_id = snapshot
            .get("workspace_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .to_string();
        if workspace_id.is_empty() {
            continue;
        }
        let file_age_ms = now_ms.saturating_sub(
            snapshot
                .get("updated_at_ms")
                .and_then(Value::as_u64)
                .unwrap_or(0),
        );
        if file_age_ms < TODO_STORE_ORPHAN_AFTER_MS {
            continue;
        }
        let mut items = snapshot
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut flipped = Vec::new();
        for item in items.iter_mut() {
            let status = todo_store_item_status(item);
            if !TODO_STORE_ACTIVE_RUN_STATUSES.contains(&status.as_str()) {
                continue;
            }
            let pane_id = todo_store_item_pane_id(item);
            // A pane mid-turn (inputReady == false) is legitimately busy;
            // everything else (idle pane, dead pane, no pane) is orphaned.
            if !pane_id.is_empty() && todo_dispatch_pane_input_ready(&pane_id) == Some(false) {
                continue;
            }
            todo_store_set_item_status(item, "interrupted", "todo_store_orphan_sweep");
            flipped.push(item.clone());
        }
        if flipped.is_empty() {
            continue;
        }
        todo_dispatch_queue_write(&workspace_id, &items);
        todo_store_push_corrections(
            app,
            &workspace_id,
            flipped.clone(),
            "todo_store_orphan_sweep",
        );
        todo_store_emit_changed(app, &workspace_id, "todo_store_orphan_sweep", "store");
        lifecycle_items.extend(flipped);
    }

    // Device-local mirror rows stuck running/sending that the queue store no
    // longer tracks: no settlement will ever arrive, so push corrections.
    let stale = cloud_mcp_todo_mirror_stale_active_items(TODO_STORE_ORPHAN_AFTER_MS);
    let mut by_workspace: HashMap<String, Vec<Value>> = HashMap::new();
    for (workspace_id, mut item) in stale {
        if workspace_id.is_empty() {
            continue;
        }
        let tracked = todo_dispatch_data_path("queues", &workspace_id)
            .map(|path| {
                todo_dispatch_queue_read(&path)
                    .get("items")
                    .and_then(Value::as_array)
                    .is_some_and(|items| {
                        items.iter().any(|candidate| {
                            let id = item
                                .get("id")
                                .and_then(Value::as_str)
                                .map(str::trim)
                                .unwrap_or_default();
                            todo_store_item_matches_id(candidate, id)
                        })
                    })
            })
            .unwrap_or(false);
        if tracked {
            // The queue-store pass above owns this row.
            continue;
        }
        todo_store_set_item_status(&mut item, "interrupted", "todo_store_orphan_sweep");
        by_workspace.entry(workspace_id).or_default().push(item);
    }
    for (workspace_id, items) in by_workspace {
        todo_store_push_corrections(
            app,
            &workspace_id,
            items.clone(),
            "todo_store_orphan_sweep",
        );
        todo_store_emit_changed(app, &workspace_id, "todo_store_orphan_sweep", "store");
        lifecycle_items.extend(items);
    }
    drop(_store_guard);
    todo_dispatch_emit_loopspace_batch_lifecycles(app, &lifecycle_items);
}

/// App-start reconciliation: queued todos are durable and must not be swept
/// just because the app restarted. Instead, start a bounded gate that waits
/// for Rust terminal/workspace evidence or times out, then classifies only
/// ambiguous in-flight rows.
pub(crate) fn todo_store_startup_sweep(app: &AppHandle) {
    todo_dispatch_begin_startup_reconciliation(app.clone());
}

pub(crate) fn todo_store_orphan_sweep_start(app: AppHandle) {
    let notify = todo_store_orphan_sweep_notify();
    tauri::async_runtime::spawn(async move {
        let initial_delay = sleep(Duration::from_secs(
            TODO_STORE_ORPHAN_SWEEP_INITIAL_DELAY_SECS,
        ));
        tokio::pin!(initial_delay);
        loop {
            tokio::select! {
                _ = &mut initial_delay => break,
                _ = notify.notified() => {
                    if APP_SHUTDOWN_PHASE.load(Ordering::Acquire) != APP_SHUTDOWN_PHASE_RUNNING {
                        return;
                    }
                }
            }
        }
        if APP_SHUTDOWN_PHASE.load(Ordering::Acquire) != APP_SHUTDOWN_PHASE_RUNNING {
            return;
        }
        todo_store_orphan_sweep_tick(&app).await;
        if APP_SHUTDOWN_PHASE.load(Ordering::Acquire) != APP_SHUTDOWN_PHASE_RUNNING {
            return;
        }
        loop {
            tokio::select! {
                _ = notify.notified() => {}
                _ = sleep(Duration::from_secs(TODO_STORE_ORPHAN_SWEEP_INTERVAL_SECS)) => {}
            }
            if APP_SHUTDOWN_PHASE.load(Ordering::Acquire) != APP_SHUTDOWN_PHASE_RUNNING {
                return;
            }
            todo_store_orphan_sweep_tick(&app).await;
            if APP_SHUTDOWN_PHASE.load(Ordering::Acquire) != APP_SHUTDOWN_PHASE_RUNNING {
                return;
            }
        }
    });
}

const TODO_STORE_SWEEP_REASONS: [&str; 3] = [
    "app_restart",
    "app_crash_recovered",
    "todo_store_orphan_sweep",
];
const TODO_STORE_SWEPT_ACTIVE_STATUSES: [&str; 5] =
    ["queued", "sending", "submitted", "running", "dispatching"];

/// Sweep flips are sticky against stale replicas: a stale webview snapshot may
/// still claim queued/running for items the store already settled. An incoming active
/// claim only wins over a sweep-settled row when its status timestamp is
/// strictly newer than the flip (a real user re-queue stamps a fresh one).
fn todo_store_keep_settled_sweep_flips_core(
    stored_items: Vec<Value>,
    items: Vec<Value>,
) -> Vec<Value> {
    let swept = stored_items
        .into_iter()
        .filter(|item| {
            let reason = todo_dispatch_text(item, &["todo_status_reason", "status_reason"]);
            matches!(
                todo_store_item_status(item).as_str(),
                "interrupted" | "cancelled"
            ) && TODO_STORE_SWEEP_REASONS.contains(&reason.as_str())
        })
        .collect::<Vec<_>>();
    if swept.is_empty() {
        return items;
    }
    items
        .into_iter()
        .map(|item| {
            if !TODO_STORE_SWEPT_ACTIVE_STATUSES.contains(&todo_store_item_status(&item).as_str()) {
                return item;
            }
            let item_id = item
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default()
                .to_string();
            let Some(swept_item) = swept
                .iter()
                .find(|candidate| todo_store_item_matches_id(candidate, &item_id))
            else {
                return item;
            };
            let incoming_at = todo_dispatch_text(&item, &["todo_status_updated_at"]);
            let swept_at = todo_dispatch_text(swept_item, &["todo_status_updated_at"]);
            // Both sides stamp 24-char "YYYY-MM-DDTHH:MM:SS.mmmZ", so the
            // lexicographic comparison is chronological.
            if !incoming_at.is_empty() && !swept_at.is_empty() && incoming_at > swept_at {
                return item;
            }
            swept_item.clone()
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Todo history ledger.
//
// The queue store retains settled rows (completed/cancelled/failed/
// interrupted/timed_out) so finished todos stay visible in Todos History
// without any cloud round trip, and `todo_store_history` is the single read
// door the history view uses: queue-store rows only, deduped by the todo's whole
// id family so one logical todo is always one history entry.
// ---------------------------------------------------------------------------

const TODO_STORE_SETTLED_RETENTION_STATUSES: [&str; 5] = [
    "completed",
    "cancelled",
    "failed",
    "interrupted",
    "timed_out",
];
const TODO_STORE_SETTLED_RETENTION_MAX: usize = 200;
const TODO_STORE_HISTORY_MAX_ITEMS: usize = 300;

/// Every id the item is known by: its own id, todo/command/dispatch aliases,
/// and the remote-command id. Two items sharing any token are the same todo.
fn todo_store_history_item_tokens(item: &Value) -> Vec<String> {
    let mut tokens = Vec::new();
    for key in [
        "id",
        "todo_id",
        "command_id",
        "dispatch_id",
        "todo_dispatch_id",
        "last_dispatch_id",
        "prompt_event_id",
        "prompt_id",
        "pending_prompt_id",
    ] {
        if let Some(value) = item
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if !tokens.iter().any(|token| token == value) {
                tokens.push(value.to_string());
            }
        }
    }
    for key in ["identity_tokens", "alias_ids", "todo_alias_ids"] {
        if let Some(values) = item.get(key).and_then(Value::as_array) {
            for value in values {
                if let Some(value) = value
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    if !tokens.iter().any(|token| token == value) {
                        tokens.push(value.to_string());
                    }
                }
            }
        }
    }
    let command_id = todo_dispatch_queue_item_command_id(item);
    if !command_id.is_empty() && !tokens.iter().any(|token| token == &command_id) {
        tokens.push(command_id);
    }
    tokens
}

fn todo_store_apply_identity_tokens(item: &mut Value, mut tokens: Vec<String>) {
    for token in todo_store_history_item_tokens(item) {
        if !tokens.iter().any(|existing| existing == &token) {
            tokens.push(token);
        }
    }
    if tokens.is_empty() {
        return;
    }
    if let Some(object) = item.as_object_mut() {
        object.insert("identity_tokens".to_string(), json!(tokens));
    }
}

/// Best-effort updated-at in epoch ms, accepting both the numeric stamps the
/// store writes and the ISO strings replicas exchange.
fn todo_store_item_updated_ms(item: &Value) -> u64 {
    if let Some(ms) = item.get("updated_at_ms").and_then(Value::as_u64) {
        return ms;
    }
    for key in [
        "todo_status_updated_at",
        "updated_at",
        "completed_at",
        "created_at",
    ] {
        if let Some(ms) = item
            .get(key)
            .and_then(Value::as_str)
            .and_then(todo_dispatch_parse_iso_ms)
        {
            return ms;
        }
    }
    0
}

/// Parses "YYYY-MM-DDTHH:MM:SS(.fff)Z" into epoch ms (the inverse of
/// `chrono_like_now_iso`); returns None for anything else.
fn todo_dispatch_parse_iso_ms(value: &str) -> Option<u64> {
    let value = value.trim();
    let bytes = value.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    let year: i64 = value.get(0..4)?.parse().ok()?;
    let month: i64 = value.get(5..7)?.parse().ok()?;
    let day: i64 = value.get(8..10)?.parse().ok()?;
    let hour: i64 = value.get(11..13)?.parse().ok()?;
    let minute: i64 = value.get(14..16)?.parse().ok()?;
    let second: i64 = value.get(17..19)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let millis: i64 = match bytes.get(19) {
        Some(b'.') => {
            let fraction = value.get(20..)?.trim_end_matches('Z');
            let digits = fraction.chars().take_while(char::is_ascii_digit).count();
            if digits == 0 {
                0
            } else {
                let parsed: i64 = fraction.get(0..digits.min(3))?.parse().ok()?;
                match digits.min(3) {
                    1 => parsed * 100,
                    2 => parsed * 10,
                    _ => parsed,
                }
            }
        }
        _ => 0,
    };
    // Howard Hinnant's days_from_civil.
    let adjusted_year = if month <= 2 { year - 1 } else { year };
    let era = if adjusted_year >= 0 {
        adjusted_year
    } else {
        adjusted_year - 399
    } / 400;
    let yoe = adjusted_year - era * 400;
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + hour * 3_600 + minute * 60 + second;
    if secs < 0 {
        return None;
    }
    Some((secs * 1_000 + millis) as u64)
}

/// Status decisions are last-writer-wins by their stamp: a store row whose
/// `todoStatusUpdatedAt` is strictly newer than the incoming claim's carries
/// a deliberate flip (history Queue/Unqueue/retarget issued while this
/// webview held a stale replica) — graft that status and its target fields
/// onto the incoming row instead of letting the stale claim overwrite it.
/// Lifecycle progress rank for the forward-only status rule on Rust-owned
/// rows: listed (or missing) < queued < running family < settled family.
fn todo_store_status_rank(status: &str) -> u8 {
    let status = todo_store_normalize_lifecycle_status(status);
    match status.as_str() {
        "queued" => 1,
        "paused" | "running" => 2,
        "completed" | "cancelled" | "failed" | "interrupted" | "timed_out" | "deleted" => 3,
        _ => 0,
    }
}

fn todo_store_clear_lifecycle_fields(object: &mut serde_json::Map<String, Value>) {
    for key in [
        "queue_state",
        "queued_at",
        "todo_completed_at",
        "completed_at",
        "todo_cancelled_at",
        "cancelled_at",
        "canceled_at",
        "todo_paused_at",
        "paused_at",
        "todo_failed_at",
        "failed_at",
        "todo_interrupted_at",
        "interrupted_at",
        "todo_timed_out_at",
        "timed_out_at",
        "timeout_at",
        "todo_deleted_at",
        "deleted_at",
    ] {
        object.remove(key);
    }
}

fn todo_store_force_webview_snapshot_listed(item: &mut Value) {
    let stamp = todo_dispatch_text(
        item,
        &["updated_at", "todo_status_updated_at", "created_at"],
    );
    let stamp = if stamp.is_empty() {
        chrono_like_now_iso()
    } else {
        stamp
    };
    if let Some(object) = item.as_object_mut() {
        todo_store_clear_lifecycle_fields(object);
        object.insert("todo_status".to_string(), json!("listed"));
        object.insert("status".to_string(), json!("listed"));
        object.insert(
            "todo_status_reason".to_string(),
            json!("webview_snapshot_lifecycle_ignored"),
        );
        object.insert(
            "status_reason".to_string(),
            json!("webview_snapshot_lifecycle_ignored"),
        );
        object.insert("todo_status_updated_at".to_string(), json!(stamp.clone()));
        object.insert("updated_at".to_string(), json!(stamp));
        object.remove("rust_owned");
        object.remove("lifecycle_owner");
    }
}

fn todo_store_copy_lifecycle_fields_from_stored(stored: &Value, item: &mut Value) {
    let Some(object) = item.as_object_mut() else {
        return;
    };
    todo_store_clear_lifecycle_fields(object);
    for key in [
        "todo_status",
        "status",
        "todo_status_reason",
        "status_reason",
        "todo_status_updated_at",
        "updated_at",
        "updated_at_ms",
        "lifecycle_owner",
        "rust_owned",
        "queued_at",
        "todo_completed_at",
        "completed_at",
        "todo_cancelled_at",
        "cancelled_at",
        "todo_paused_at",
        "paused_at",
        "todo_failed_at",
        "failed_at",
        "todo_interrupted_at",
        "interrupted_at",
        "todo_timed_out_at",
        "timed_out_at",
        "todo_deleted_at",
        "deleted_at",
        "target_agent_id",
        "target_color_slot",
        "target_terminal_color",
        "target_terminal_id",
        "target_terminal_index",
        "target_thread_id",
        "target_kind",
        "target_swarm_id",
        "swarm_run_id",
        "target_explicit",
        "explicit_target",
        "user_pinned_target",
        "identity_tokens",
        "alias_ids",
    ] {
        match stored.get(key).filter(|value| !value.is_null()) {
            Some(value) => {
                object.insert(key.to_string(), value.clone());
            }
            None => {
                object.remove(key);
            }
        }
    }
    object.insert("lifecycle_owner".to_string(), json!("rust"));
    object.insert("rust_owned".to_string(), json!(true));
}

fn todo_store_find_stored_logical_item<'a>(
    stored_items: &'a [Value],
    item: &Value,
) -> Option<&'a Value> {
    let item_id = todo_store_item_sync_id(item);
    stored_items.iter().find(|candidate| {
        todo_store_items_share_identity(candidate, item)
            || (!item_id.is_empty() && todo_store_item_matches_id(candidate, &item_id))
    })
}

fn todo_store_sanitize_webview_snapshot_lifecycle(
    stored_items: &[Value],
    items: Vec<Value>,
) -> Vec<Value> {
    items
        .into_iter()
        .map(|mut item| {
            let stored = todo_store_find_stored_logical_item(stored_items, &item);
            if let Some(stored) = stored.filter(|stored| todo_store_item_is_rust_owned(stored)) {
                todo_store_copy_lifecycle_fields_from_stored(stored, &mut item);
                return item;
            }
            let incoming_status = todo_store_item_status(&item);
            if !incoming_status.is_empty() && incoming_status != "listed" {
                todo_store_force_webview_snapshot_listed(&mut item);
            }
            item
        })
        .collect()
}

fn todo_store_apply_newer_store_status_core(
    stored_items: &[Value],
    items: Vec<Value>,
) -> Vec<Value> {
    if stored_items.is_empty() {
        return items;
    }
    items
        .into_iter()
        .map(|mut item| {
            let Some(stored) = todo_store_find_stored_logical_item(stored_items, &item) else {
                return item;
            };
            let mut stored = stored.clone();
            todo_store_canonicalize_settled_evidence(&mut stored);
            let stored_status = todo_store_item_status(&stored);
            if stored_status.is_empty() {
                return item;
            }
            let stored_is_rust_owned = todo_store_item_is_rust_owned(&stored);
            if stored_is_rust_owned {
                if let Some(object) = item.as_object_mut() {
                    object.insert("rust_owned".to_string(), json!(true));
                    object.insert("lifecycle_owner".to_string(), json!("rust"));
                }
            }
            let stored_at = todo_dispatch_text(&stored, &["todo_status_updated_at"]);
            let incoming_at = todo_dispatch_text(&item, &["todo_status_updated_at"]);
            // Both sides stamp identical 24-char ISO; lexicographic compare
            // is chronological. The store only wins when strictly newer.
            let store_wins_by_stamp =
                !stored_at.is_empty() && (incoming_at.is_empty() || incoming_at < stored_at);
            // Rust-owned rows additionally obey a forward-only lifecycle
            // through sync: a webview snapshot echo may advance them
            // (queued → running → settled) but never drag one backwards —
            // a stale or status-less replica copy of a running direct
            // capture must not demote it to listed. Backward flips for
            // these rows only happen through the Rust doors
            // (todo_store_set_status / settlement), which write the store
            // directly with a fresh stamp.
            let store_wins_by_rank = stored_is_rust_owned
                && todo_store_status_rank(&todo_store_item_status(&item))
                    < todo_store_status_rank(&stored_status);
            if !store_wins_by_stamp && !store_wins_by_rank {
                return item;
            }
            if let Some(object) = item.as_object_mut() {
                for key in [
                    "todo_status",
                    "status",
                    "todo_status_reason",
                    "status_reason",
                    "todo_status_updated_at",
                    "updated_at",
                    "updated_at_ms",
                    "todo_completed_at",
                    "completed_at",
                    "todo_cancelled_at",
                    "cancelled_at",
                    "todo_failed_at",
                    "failed_at",
                    "todo_interrupted_at",
                    "interrupted_at",
                    "todo_timed_out_at",
                    "timed_out_at",
                    "todo_deleted_at",
                    "deleted_at",
                ] {
                    if let Some(value) = stored.get(key) {
                        object.insert(key.to_string(), value.clone());
                    }
                }
                // Targets travel with the flip (retarget / clear-target).
                for key in [
                    "target_agent_id",
                    "target_color_slot",
                    "target_terminal_color",
                    "target_terminal_id",
                    "target_terminal_index",
                    "target_thread_id",
                    "target_kind",
                    "target_swarm_id",
                    "swarm_run_id",
                ] {
                    match stored.get(key).filter(|value| !value.is_null()) {
                        Some(value) => {
                            object.insert(key.to_string(), value.clone());
                        }
                        None => {
                            object.remove(key);
                        }
                    }
                }
            }
            item
        })
        .collect()
}

/// Rust-owned rows: todos the Rust store created itself (direct-prompt
/// captures, backend dispatches, headless remote intake). The webview is a
/// renderer for these, not the owner — its full-snapshot sync must never be
/// able to erase one it doesn't know about.
fn todo_store_item_is_rust_owned(item: &Value) -> bool {
    if item.get("rust_owned").and_then(Value::as_bool) == Some(true)
        || todo_dispatch_text(item, &["lifecycle_owner"]) == "rust"
    {
        return true;
    }
    let source = todo_dispatch_text(item, &["source", "source_kind"]);
    if source == "rust-diffforge-todo-store" || source == "rust-ui-draft" {
        return true;
    }
    // "terminal_direct" is the Rust capture's own source; the webview's
    // prompt-submit bridge materializes the SAME item id with its
    // "tui-terminal-direct-input" source, and its full-snapshot echo replaces
    // the row wholesale — the rewritten row must stay recognizable as
    // Rust-owned or every downstream protection silently disarms.
    if source == "terminal_direct" || source.starts_with("tui-terminal-direct") {
        return true;
    }
    if todo_dispatch_text(item, &["todo_status_reason", "status_reason"])
        == "todo_queue_backend_submit"
    {
        return true;
    }
    item.get("remote_command")
        .and_then(|remote| remote.get("source"))
        .and_then(Value::as_str)
        .is_some_and(|source| source.starts_with("remote_intake_"))
}

/// Keeps store-owned rows alive across webview snapshot rewrites:
/// 1. Settled rows (the webview consumes completed items from its visible
///    list, so its full-snapshot sync omits them — without this merge every
///    finished todo would vanish from Todos History on the next sync).
/// 2. ACTIVE Rust-owned rows the webview never adopted (direct captures,
///    backend dispatches, headless intake) — hook settlement and the orphan
///    sweeps own their lifecycle, not the webview's replica.
/// Tombstoned ids stay dead, and settled retention is capped so the file
/// stays bounded.
fn todo_store_retain_settled_items_core(
    stored_items: Vec<Value>,
    items: Vec<Value>,
    tombstoned: &HashSet<String>,
) -> Vec<Value> {
    let incoming_tokens = items
        .iter()
        .flat_map(|item| todo_store_history_item_tokens(item))
        .collect::<HashSet<_>>();
    let (mut retained_settled, mut retained_active): (Vec<Value>, Vec<Value>) =
        (Vec::new(), Vec::new());
    for item in stored_items {
        let settled =
            TODO_STORE_SETTLED_RETENTION_STATUSES.contains(&todo_store_item_status(&item).as_str());
        if !settled && !todo_store_item_is_rust_owned(&item) {
            continue;
        }
        if todo_store_history_item_tokens(&item)
            .iter()
            .any(|token| incoming_tokens.contains(token) || tombstoned.contains(token))
        {
            continue;
        }
        if settled {
            retained_settled.push(item);
        } else {
            retained_active.push(item);
        }
    }
    if retained_settled.is_empty() && retained_active.is_empty() {
        return items;
    }
    retained_settled.sort_by_key(|item| std::cmp::Reverse(todo_store_item_updated_ms(item)));
    retained_settled.truncate(TODO_STORE_SETTLED_RETENTION_MAX);
    let mut items = items;
    items.extend(retained_active);
    items.extend(retained_settled);
    items
}

/// One history list per workspace. Queue-store rows are device truth; the
/// optional mirror vector exists only for tests/future imports and never acts
/// as a frontend source. Anything tombstoned anywhere on this device is dropped.
fn todo_store_history_merge(
    queue_items: Vec<Value>,
    mirror_items: Vec<Value>,
    tombstoned: &HashSet<String>,
) -> Vec<Value> {
    const ENRICH_KEYS: [&str; 5] = [
        "llm_title",
        "device_id",
        "device_name",
        "workspace_name",
        "completed_at",
    ];
    let mut merged: Vec<Value> = Vec::new();
    let mut index_by_token: HashMap<String, usize> = HashMap::new();
    for (is_mirror, source) in [(false, queue_items), (true, mirror_items)] {
        for item in source {
            if !item.is_object() {
                continue;
            }
            let tokens = todo_store_history_item_tokens(&item);
            if tokens.is_empty() || tokens.iter().any(|token| tombstoned.contains(token)) {
                continue;
            }
            if let Some(existing_index) = tokens
                .iter()
                .find_map(|token| index_by_token.get(token).copied())
            {
                if is_mirror {
                    if let Some(existing) = merged
                        .get_mut(existing_index)
                        .and_then(Value::as_object_mut)
                    {
                        for key in ENRICH_KEYS {
                            let missing = existing
                                .get(key)
                                .map(|value| {
                                    value.is_null()
                                        || value.as_str().is_some_and(|text| text.trim().is_empty())
                                })
                                .unwrap_or(true);
                            if missing {
                                if let Some(value) = item.get(key).filter(|value| !value.is_null())
                                {
                                    existing.insert(key.to_string(), value.clone());
                                }
                            }
                        }
                    }
                }
                for token in tokens {
                    index_by_token.entry(token).or_insert(existing_index);
                }
                continue;
            }
            let index = merged.len();
            for token in tokens {
                index_by_token.insert(token, index);
            }
            merged.push(item);
        }
    }
    merged.sort_by_key(|item| std::cmp::Reverse(todo_store_item_updated_ms(item)));
    merged.truncate(TODO_STORE_HISTORY_MAX_ITEMS);
    merged
}

/// The single read door for the Todos History view: every Rust-store todo this
/// workspace knows about — listed, queued, running, AND retained finished rows —
/// one entry per logical todo.
#[tauri::command(rename_all = "snake_case")]
async fn todo_store_history(workspace_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_id = workspace_id.trim().to_string();
        if workspace_id.is_empty() {
            return Err("workspace_id is required.".to_string());
        }
        if todo_dispatch_workspace_is_deleted(&workspace_id) {
            return Ok(json!({
                "workspace_id": workspace_id,
                "items": [],
                "updated_at_ms": todo_dispatch_now_ms(),
            }));
        }
        let tombstoned = todo_store_all_tombstone_ids();
        let queue_items = todo_dispatch_data_path("queues", &workspace_id)
            .map(|path| {
                todo_dispatch_queue_read(&path)
                    .get("items")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        let items = todo_store_history_merge(queue_items, Vec::new(), &tombstoned);
        Ok(json!({
            "workspace_id": workspace_id,
            "items": items,
            "updated_at_ms": todo_dispatch_now_ms(),
        }))
    })
    .await
    .map_err(|error| format!("Todo store history worker failed: {error}"))?
}

fn todo_dispatch_queue_item_command_id(item: &Value) -> String {
    item.get("remote_command")
        .and_then(|remote| remote.get("command_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            item.get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_default()
        .to_string()
}

fn todo_dispatch_queue_item_active_for_settlement(item: &Value) -> bool {
    matches!(
        todo_store_item_status(item).as_str(),
        "queued" | "sending" | "submitted" | "running" | "dispatching" | "paused"
    )
}

fn todo_dispatch_queue_item_owns_terminal_input(item: &Value) -> bool {
    matches!(
        todo_store_item_status(item).as_str(),
        "sending" | "submitted" | "running" | "dispatching" | "paused"
    )
}

fn todo_dispatch_receipt_active_for_settlement(receipt: &Value) -> bool {
    todo_dispatch_status_is_active(
        receipt
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )
}

fn todo_dispatch_receipt_submitted_at_ms(receipt: &Value) -> u64 {
    ["submitted_at", "updated_at", "received_at"]
        .iter()
        .find_map(|key| {
            receipt
                .get(*key)
                .and_then(Value::as_str)
                .and_then(todo_dispatch_parse_iso_ms)
        })
        .or_else(|| receipt.get("updated_at_ms").and_then(Value::as_u64))
        .or_else(|| receipt.get("received_at_ms").and_then(Value::as_u64))
        .unwrap_or(0)
}

fn todo_dispatch_receipt_completion_at_ms(receipt: &Value) -> u64 {
    ["todo_completed_at", "completed_at"]
        .iter()
        .find_map(|key| {
            receipt
                .get(*key)
                .and_then(Value::as_str)
                .and_then(todo_dispatch_parse_iso_ms)
        })
        .or_else(|| receipt.get("completed_at_ms").and_then(Value::as_u64))
        .unwrap_or(0)
}

fn todo_dispatch_receipt_submitted_after_app_start(receipt: &Value) -> bool {
    let submitted_at_ms = todo_dispatch_receipt_submitted_at_ms(receipt);
    submitted_at_ms >= todo_dispatch_app_started_ms().saturating_sub(1_000)
}

fn todo_dispatch_completed_receipt_fresh_for_notification(receipt: &Value) -> bool {
    let completed_at_ms = todo_dispatch_receipt_completion_at_ms(receipt);
    completed_at_ms >= todo_dispatch_app_started_ms().saturating_sub(1_000)
}

fn todo_dispatch_queue_item_fresh_for_completion_settlement(item: &Value) -> bool {
    let updated_ms = todo_store_item_updated_ms(item).max(todo_store_item_status_stamp_ms(item));
    updated_ms >= todo_dispatch_app_started_ms().saturating_sub(1_000)
}

fn todo_dispatch_active_queue_item_ids_for_pane_from_items(
    items: &[Value],
    pane_id: &str,
) -> Vec<String> {
    let pane_id = pane_id.trim();
    if pane_id.is_empty() {
        return Vec::new();
    }
    let mut matches = items
        .iter()
        .filter(|item| {
            todo_dispatch_queue_item_active_for_settlement(item)
                && todo_store_item_pane_id(item) == pane_id
        })
        .map(|item| {
            (
                todo_store_item_updated_ms(item),
                todo_dispatch_queue_item_command_id(item),
            )
        })
        .filter(|(_, id)| !id.is_empty())
        .collect::<Vec<_>>();
    matches.sort_by_key(|(updated_ms, _)| std::cmp::Reverse(*updated_ms));
    matches.into_iter().map(|(_, id)| id).collect()
}

fn todo_dispatch_fresh_active_queue_item_ids_for_pane(
    workspace_id: &str,
    pane_id: &str,
) -> Vec<String> {
    if workspace_id.trim().is_empty() {
        return Vec::new();
    }
    let Some(path) = todo_dispatch_data_path("queues", workspace_id) else {
        return Vec::new();
    };
    let snapshot = todo_dispatch_queue_read(&path);
    let Some(items) = snapshot.get("items").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut matches = items
        .iter()
        .filter(|item| {
            // Identity-less fallback settlement: only items whose prompt was
            // actually DISPATCHED into this terminal may be completed by an
            // anonymous turn end. `queued` items never ran (their turn cannot
            // have ended) and `paused` items with a real submission match via
            // their receipt earlier in the settle chain — including either
            // here let unrelated turns mark untouched todos completed.
            matches!(
                todo_store_item_status(item).as_str(),
                "sending" | "submitted" | "running" | "dispatching"
            ) && todo_store_item_pane_id(item) == pane_id.trim()
                && todo_dispatch_queue_item_fresh_for_completion_settlement(item)
        })
        .map(|item| {
            (
                todo_store_item_updated_ms(item),
                todo_dispatch_queue_item_command_id(item),
            )
        })
        .filter(|(_, id)| !id.is_empty())
        .collect::<Vec<_>>();
    matches.sort_by_key(|(updated_ms, _)| std::cmp::Reverse(*updated_ms));
    matches.into_iter().map(|(_, id)| id).collect()
}

fn todo_dispatch_active_queue_item_ids_for_pane(workspace_id: &str, pane_id: &str) -> Vec<String> {
    if workspace_id.trim().is_empty() {
        return Vec::new();
    }
    let Some(path) = todo_dispatch_data_path("queues", workspace_id) else {
        return Vec::new();
    };
    let snapshot = todo_dispatch_queue_read(&path);
    let Some(items) = snapshot.get("items").and_then(Value::as_array) else {
        return Vec::new();
    };
    todo_dispatch_active_queue_item_ids_for_pane_from_items(items, pane_id)
}

fn todo_dispatch_prompt_identity_matches_value(
    value: &Value,
    prompt_event_id: &str,
    prompt_text: &str,
) -> bool {
    if todo_dispatch_prompt_identity_matches_single_value(value, prompt_event_id, prompt_text) {
        return true;
    }

    todo_dispatch_value_inputs(value).iter().any(|input| {
        todo_dispatch_prompt_identity_matches_single_value(input, prompt_event_id, prompt_text)
    })
}

fn todo_dispatch_prompt_identity_matches_single_value(
    value: &Value,
    prompt_event_id: &str,
    prompt_text: &str,
) -> bool {
    let prompt_event_id = prompt_event_id.trim();
    let prompt_text_key = todo_dispatch_direct_prompt_text_key(prompt_text);
    if prompt_event_id.is_empty() && prompt_text_key.is_empty() {
        return true;
    }

    if !prompt_event_id.is_empty() {
        let direct_item_id = todo_dispatch_direct_prompt_item_id(Some(prompt_event_id));
        if todo_store_history_item_tokens(value)
            .iter()
            .any(|token| token == prompt_event_id || token == &direct_item_id)
        {
            return true;
        }
        let prompt_ref = todo_dispatch_text(
            value,
            &[
                "prompt_event_id",
                "prompt_id",
                "pending_prompt_id",
                "provider_turn_id",
                "turn_id",
                "message_id",
            ],
        );
        if prompt_ref == prompt_event_id {
            return true;
        }
    }

    if !prompt_text_key.is_empty() {
        let value_text = todo_dispatch_text(
            value,
            &[
                "text",
                "todo_text",
                "message",
                "user_message",
                "prompt_text",
                "terminal_prompt",
            ],
        );
        return todo_dispatch_direct_prompt_text_key(&value_text) == prompt_text_key;
    }

    false
}

fn todo_store_items_share_identity(left: &Value, right: &Value) -> bool {
    let left_tokens = todo_store_history_item_tokens(left)
        .into_iter()
        .collect::<HashSet<_>>();
    if left_tokens.is_empty() {
        return false;
    }
    todo_store_history_item_tokens(right)
        .iter()
        .any(|token| left_tokens.contains(token))
}

fn todo_store_prefer_logical_item(existing: Value, candidate: Value) -> Value {
    let existing_rank = todo_store_status_rank(&todo_store_item_status(&existing));
    let candidate_rank = todo_store_status_rank(&todo_store_item_status(&candidate));
    if candidate_rank != existing_rank {
        return if candidate_rank > existing_rank {
            candidate
        } else {
            existing
        };
    }
    if todo_store_item_updated_ms(&candidate) >= todo_store_item_updated_ms(&existing) {
        candidate
    } else {
        existing
    }
}

fn todo_store_dedupe_logical_items(items: Vec<Value>) -> Vec<Value> {
    let mut merged = Vec::<Option<Value>>::new();
    let mut index_by_token = HashMap::<String, usize>::new();
    for item in items {
        let tokens = todo_store_history_item_tokens(&item);
        let mut existing_indexes = tokens
            .iter()
            .filter_map(|token| index_by_token.get(token).copied())
            .filter(|index| merged.get(*index).and_then(Option::as_ref).is_some())
            .collect::<Vec<_>>();
        existing_indexes.sort_unstable();
        existing_indexes.dedup();
        if let Some((&survivor_index, rest)) = existing_indexes.split_first() {
            let mut all_tokens = tokens;
            let mut preferred = item;
            if let Some(existing) = merged.get_mut(survivor_index).and_then(Option::take) {
                all_tokens.extend(todo_store_history_item_tokens(&existing));
                preferred = todo_store_prefer_logical_item(existing, preferred);
            }
            for index in rest {
                if let Some(existing) = merged.get_mut(*index).and_then(Option::take) {
                    all_tokens.extend(todo_store_history_item_tokens(&existing));
                    preferred = todo_store_prefer_logical_item(preferred, existing);
                }
            }
            todo_store_apply_identity_tokens(&mut preferred, all_tokens.clone());
            if let Some(slot) = merged.get_mut(survivor_index) {
                *slot = Some(preferred);
            }
            if let Some(preferred) = merged[survivor_index].as_ref() {
                for token in todo_store_history_item_tokens(preferred) {
                    index_by_token.insert(token, survivor_index);
                }
            }
            for token in all_tokens {
                index_by_token.insert(token, survivor_index);
            }
            continue;
        }
        let index = merged.len();
        for token in tokens {
            index_by_token.insert(token, index);
        }
        merged.push(Some(item));
    }
    merged.into_iter().flatten().collect()
}

fn todo_dispatch_active_queue_item_ids_for_pane_matching(
    workspace_id: &str,
    pane_id: &str,
    prompt_event_id: &str,
    prompt_text: &str,
) -> Vec<String> {
    if workspace_id.trim().is_empty() {
        return Vec::new();
    }
    let Some(path) = todo_dispatch_data_path("queues", workspace_id) else {
        return Vec::new();
    };
    let snapshot = todo_dispatch_queue_read(&path);
    let Some(items) = snapshot.get("items").and_then(Value::as_array) else {
        return Vec::new();
    };
    let has_identity = !prompt_event_id.trim().is_empty()
        || !todo_dispatch_direct_prompt_text_key(prompt_text).is_empty();
    if !has_identity {
        // Same rule as the receipt path: readiness without prompt identity
        // must not complete "the newest queue item" — it proved nothing about
        // which todo (if any) finished.
        return Vec::new();
    }
    let mut matches = items
        .iter()
        .filter(|item| {
            todo_dispatch_queue_item_active_for_settlement(item)
                && !todo_dispatch_value_has_swarm_target(item)
                && todo_store_item_pane_id(item) == pane_id.trim()
                && todo_dispatch_queue_item_fresh_for_completion_settlement(item)
                && todo_dispatch_prompt_identity_matches_value(item, prompt_event_id, prompt_text)
        })
        .map(|item| {
            (
                todo_store_item_updated_ms(item),
                todo_dispatch_queue_item_command_id(item),
            )
        })
        .filter(|(_, id)| !id.is_empty())
        .collect::<Vec<_>>();
    matches.sort_by_key(|(updated_ms, _)| std::cmp::Reverse(*updated_ms));
    matches.into_iter().map(|(_, id)| id).collect()
}

/// Settlement bridge from receipts into the queue snapshot. Every settled
/// item KEEPS its row with the final status — the queue store doubles as the
/// device's todo history ledger, so completed todos must not vanish from the
/// Todos History view the moment the turn ends. The webview's visible queue
/// list still drops completed items via the journal prune entry below.
fn todo_dispatch_queue_mark_settled(
    app: Option<&AppHandle>,
    workspace_id: &str,
    command_id: &str,
    status: &str,
) {
    let Some(path) = todo_dispatch_data_path("queues", workspace_id) else {
        return;
    };
    let _store_guard = todo_dispatch_queue_store_guard();
    let snapshot = todo_dispatch_queue_read(&path);
    let Some(items) = snapshot.get("items").and_then(Value::as_array).cloned() else {
        return;
    };
    let mut changed = false;
    let mut completed_item_id = String::new();
    let mut settled_items = Vec::new();
    let now_iso = chrono_like_now_iso();
    let next_items = items
        .into_iter()
        .map(|mut item| {
            if todo_dispatch_queue_item_command_id(&item) != command_id {
                return item;
            }
            changed = true;
            todo_store_set_item_status(&mut item, status, "todo_queue_backend_settled");
            if status == "completed" {
                completed_item_id = item
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or(command_id)
                    .to_string();
                if let Some(object) = item.as_object_mut() {
                    object.insert("completed_at".to_string(), json!(now_iso.clone()));
                }
            }
            settled_items.push(item.clone());
            item
        })
        .collect::<Vec<_>>();
    let lifecycle_item = settled_items.first().cloned();
    if changed {
        todo_dispatch_queue_write(workspace_id, &next_items);
        todo_store_orphan_sweep_trigger("todo_queue_backend_settled");
        if let Some(app) = app {
            let settled_items_for_sync = settled_items.clone();
            todo_store_push_corrections(
                app,
                workspace_id,
                settled_items,
                "todo_queue_backend_settled",
            );
            todo_store_emit_changed(app, workspace_id, "todo_queue_backend_settled", "store");
            let app_for_sync = app.clone();
            let workspace_id_for_sync = workspace_id.to_string();
            tauri::async_runtime::spawn(async move {
                for item in settled_items_for_sync {
                    let workspace_name = todo_dispatch_text(&item, &["workspace_name"]);
                    let repo_path = todo_dispatch_text(
                        &item,
                        &["repo_path", "workspace_root", "root_directory"],
                    );
                    todo_dispatch_enqueue_todo_sync_commit(
                        &app_for_sync,
                        &workspace_id_for_sync,
                        &workspace_name,
                        &repo_path,
                        item,
                        "todo_queue_backend_settled",
                    )
                    .await;
                }
            });
        }
    }
    // The webview's visible queue consumes completed items; journal the prune
    // so a webview that mounts later drops its stale visible copy. The store
    // row itself stays (history retention) — the prune entry only governs the
    // webview list, and the next queue sync keeps settled rows via the
    // retention merge.
    if !completed_item_id.is_empty() {
        todo_dispatch_journal_append(
            workspace_id,
            json!({
                "kind": "remote_todo_deleted",
                "item_id": completed_item_id,
                "command_id": command_id,
                "at": now_iso,
                "reason": "todo_queue_backend_settled",
            }),
        );
    }
    drop(_store_guard);
    if let (Some(app), Some(item)) = (app, lifecycle_item.as_ref()) {
        todo_dispatch_emit_loopspace_batch_lifecycle(app, item);
    }
}

pub(crate) fn todo_dispatch_mark_active_for_pane_interrupted(
    app: &AppHandle,
    workspace_id: &str,
    pane_id: &str,
    reason: &str,
) -> usize {
    let workspace_id = workspace_id.trim();
    let pane_id = pane_id.trim();
    if workspace_id.is_empty() || pane_id.is_empty() {
        return 0;
    }

    let now_iso = chrono_like_now_iso();
    let reason = reason.trim();
    let reason = if reason.is_empty() {
        "terminal_interrupt"
    } else {
        reason
    };
    let mut settled = HashSet::<String>::new();

    let receipts = todo_dispatch_load(workspace_id);
    if let Some(entries) = receipts.as_object() {
        let receipt_matches = entries
            .iter()
            .filter(|(_, receipt)| {
                todo_dispatch_receipt_active_for_settlement(receipt)
                    && todo_dispatch_text(receipt, &["pane_id"]) == pane_id
            })
            .map(|(command_id, receipt)| (command_id.clone(), receipt.clone()))
            .collect::<Vec<_>>();
        for (command_id, mut receipt) in receipt_matches {
            if let Some(object) = receipt.as_object_mut() {
                object.insert("status".to_string(), json!("interrupted"));
                object.insert("status_reason".to_string(), json!(reason));
                object.insert("interrupted_at".to_string(), json!(now_iso.clone()));
                object.insert("todo_interrupted_at".to_string(), json!(now_iso.clone()));
                object.insert("updated_at".to_string(), json!(now_iso.clone()));
                object.insert("updated_at_ms".to_string(), json!(todo_dispatch_now_ms()));
            }
            let _ = todo_dispatch_record_receipt_internal(
                Some(app),
                workspace_id,
                receipt,
                "terminal_interrupt_settled",
            );
            if !command_id.trim().is_empty() {
                settled.insert(command_id);
            }
        }
    }

    for command_id in todo_dispatch_active_queue_item_ids_for_pane(workspace_id, pane_id) {
        if command_id.trim().is_empty() {
            continue;
        }
        todo_dispatch_queue_mark_settled(Some(app), workspace_id, &command_id, "interrupted");
        settled.insert(command_id);
    }

    if !settled.is_empty() {
        log_terminal_status_event(
            "backend.todo_dispatch.terminal_interrupt_settled",
            json!({
                "count": settled.len(),
                "pane_id": pane_id,
                "reason": reason,
                "workspace_id": workspace_id,
            }),
        );
    }

    settled.len()
}

fn todo_dispatch_mark_active_for_pane_completed(
    app: &AppHandle,
    workspace_id: &str,
    pane_id: &str,
    prompt_event_id: &str,
    prompt_text: &str,
    completed_at: &str,
    reason: &str,
) -> usize {
    let workspace_id = workspace_id.trim();
    let pane_id = pane_id.trim();
    if workspace_id.is_empty() || pane_id.is_empty() {
        return 0;
    }

    let completed_at = completed_at.trim();
    let completed_at = if completed_at.is_empty() {
        chrono_like_now_iso()
    } else {
        completed_at.to_string()
    };
    let reason = reason.trim();
    let reason = if reason.is_empty() {
        "terminal_input_ready"
    } else {
        reason
    };
    let has_identity = !prompt_event_id.trim().is_empty()
        || !todo_dispatch_direct_prompt_text_key(prompt_text).is_empty();
    let mut settled = HashSet::<String>::new();

    let receipts = todo_dispatch_load(workspace_id);
    if let Some(entries) = receipts.as_object() {
        let mut receipt_matches = entries
            .iter()
            .filter(|(_, receipt)| {
                todo_dispatch_receipt_active_for_settlement(receipt)
                    && !todo_dispatch_value_has_swarm_target(receipt)
                    && todo_dispatch_receipt_submitted_after_app_start(receipt)
                    && todo_dispatch_text(receipt, &["pane_id"]) == pane_id
                    && todo_dispatch_prompt_identity_matches_value(
                        receipt,
                        prompt_event_id,
                        prompt_text,
                    )
            })
            .map(|(command_id, receipt)| {
                (
                    command_id.clone(),
                    receipt.clone(),
                    todo_dispatch_receipt_submitted_at_ms(receipt),
                )
            })
            .collect::<Vec<_>>();
        receipt_matches.sort_by_key(|(_, _, submitted_at)| std::cmp::Reverse(*submitted_at));
        if !has_identity {
            // Terminal readiness without prompt identity proves nothing about
            // WHICH todo finished — completing "the newest receipt" here
            // marked unrelated todos done (user-visible false completions).
            // Identity-less readiness is an attention signal only; real
            // settlement comes from the hook Stop path or an identified
            // readiness event.
            receipt_matches.clear();
        }
        for (command_id, mut receipt, _) in receipt_matches {
            if let Some(object) = receipt.as_object_mut() {
                object.insert("status".to_string(), json!("completed"));
                object.insert("status_reason".to_string(), json!(reason));
                object.insert("completed_at".to_string(), json!(completed_at.clone()));
                object.insert("todo_completed_at".to_string(), json!(completed_at.clone()));
                object.insert("updated_at".to_string(), json!(completed_at.clone()));
                object.insert("updated_at_ms".to_string(), json!(todo_dispatch_now_ms()));
            }
            let _ = todo_dispatch_record_receipt_internal(
                Some(app),
                workspace_id,
                receipt,
                "terminal_input_ready_settled",
            );
            if !command_id.trim().is_empty() {
                todo_dispatch_queue_mark_settled(Some(app), workspace_id, &command_id, "completed");
                settled.insert(command_id);
            }
        }
    }

    for command_id in todo_dispatch_active_queue_item_ids_for_pane_matching(
        workspace_id,
        pane_id,
        prompt_event_id,
        prompt_text,
    ) {
        if command_id.trim().is_empty() || settled.contains(&command_id) {
            continue;
        }
        todo_dispatch_queue_mark_settled(Some(app), workspace_id, &command_id, "completed");
        settled.insert(command_id);
    }

    log_terminal_status_event(
        if settled.is_empty() {
            "backend.todo_dispatch.terminal_input_ready_settle_skip"
        } else {
            "backend.todo_dispatch.terminal_input_ready_settled"
        },
        json!({
            "count": settled.len(),
            "has_identity": has_identity,
            "pane_id": pane_id,
            "prompt_event_id": prompt_event_id.trim(),
            "prompt_text_len": prompt_text.trim().len(),
            "reason": reason,
            "workspace_id": workspace_id,
        }),
    );

    settled.len()
}

fn todo_dispatch_swarm_run_status_to_todo_status(status: &str) -> &'static str {
    match status.trim().to_ascii_lowercase().as_str() {
        "done" | "complete" | "completed" | "success" => "completed",
        "cancelled" | "canceled" => "cancelled",
        "interrupted" | "aborted" => "interrupted",
        "timed_out" | "timeout" => "timed_out",
        "failed" | "error" => "failed",
        _ => "failed",
    }
}

fn todo_dispatch_value_matches_swarm_run(
    value: &Value,
    swarm_id: &str,
    run_id: &str,
    allow_missing_run_id: bool,
) -> bool {
    if todo_dispatch_text(value, &["target_swarm_id", "swarm_id"]) != swarm_id {
        return false;
    }
    let value_run_id = todo_dispatch_text(value, &["swarm_run_id", "run_id"]);
    value_run_id == run_id || (allow_missing_run_id && value_run_id.is_empty())
}

fn todo_dispatch_active_queue_item_ids_for_swarm(
    workspace_id: &str,
    swarm_id: &str,
    run_id: &str,
) -> Vec<String> {
    let Some(path) = todo_dispatch_data_path("queues", workspace_id) else {
        return Vec::new();
    };
    let snapshot = todo_dispatch_queue_read(&path);
    let Some(items) = snapshot.get("items").and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .filter(|item| {
            todo_dispatch_queue_item_active_for_settlement(item)
                && todo_dispatch_value_matches_swarm_run(item, swarm_id, run_id, false)
        })
        .map(todo_dispatch_queue_item_command_id)
        .filter(|id| !id.trim().is_empty())
        .collect()
}

pub(crate) fn todo_dispatch_mark_active_for_swarm_completed(
    app: &AppHandle,
    workspace_id: &str,
    swarm_id: &str,
    run_id: &str,
    run_status: &str,
) -> usize {
    let workspace_id = workspace_id.trim();
    let swarm_id = swarm_id.trim();
    let run_id = run_id.trim();
    if workspace_id.is_empty() || swarm_id.is_empty() || run_id.is_empty() {
        return 0;
    }

    let todo_status = todo_dispatch_swarm_run_status_to_todo_status(run_status);
    let reason = format!("swarm_run_{run_status}");
    let now_iso = chrono_like_now_iso();
    let mut settled = HashSet::<String>::new();

    let receipts = todo_dispatch_load(workspace_id);
    if let Some(entries) = receipts.as_object() {
        let receipt_matches = entries
            .iter()
            .filter(|(_, receipt)| {
                todo_dispatch_receipt_active_for_settlement(receipt)
                    && todo_dispatch_value_matches_swarm_run(receipt, swarm_id, run_id, true)
            })
            .map(|(command_id, receipt)| (command_id.clone(), receipt.clone()))
            .collect::<Vec<_>>();
        for (command_id, mut receipt) in receipt_matches {
            if let Some(object) = receipt.as_object_mut() {
                object.insert("status".to_string(), json!(todo_status));
                object.insert("status_reason".to_string(), json!(reason.clone()));
                object.insert("target_kind".to_string(), json!("swarm"));
                object.insert("target_swarm_id".to_string(), json!(swarm_id));
                object.insert("swarm_run_id".to_string(), json!(run_id));
                object.insert("updated_at".to_string(), json!(now_iso.clone()));
                object.insert("updated_at_ms".to_string(), json!(todo_dispatch_now_ms()));
                match todo_status {
                    "completed" => {
                        object.insert("completed_at".to_string(), json!(now_iso.clone()));
                        object.insert("todo_completed_at".to_string(), json!(now_iso.clone()));
                    }
                    "cancelled" => {
                        object.insert("cancelled_at".to_string(), json!(now_iso.clone()));
                        object.insert("todo_cancelled_at".to_string(), json!(now_iso.clone()));
                    }
                    "failed" => {
                        object.insert("failed_at".to_string(), json!(now_iso.clone()));
                        object.insert("todo_failed_at".to_string(), json!(now_iso.clone()));
                    }
                    "interrupted" => {
                        object.insert("interrupted_at".to_string(), json!(now_iso.clone()));
                        object.insert("todo_interrupted_at".to_string(), json!(now_iso.clone()));
                    }
                    "timed_out" => {
                        object.insert("timed_out_at".to_string(), json!(now_iso.clone()));
                        object.insert("todo_timed_out_at".to_string(), json!(now_iso.clone()));
                    }
                    _ => {}
                }
            }
            let _ = todo_dispatch_record_receipt_internal(
                Some(app),
                workspace_id,
                receipt,
                "swarm_run_settled",
            );
            if !command_id.trim().is_empty() {
                todo_dispatch_queue_mark_settled(Some(app), workspace_id, &command_id, todo_status);
                settled.insert(command_id);
            }
        }
    }

    for command_id in todo_dispatch_active_queue_item_ids_for_swarm(workspace_id, swarm_id, run_id)
    {
        if settled.contains(&command_id) {
            continue;
        }
        todo_dispatch_queue_mark_settled(Some(app), workspace_id, &command_id, todo_status);
        settled.insert(command_id);
    }

    log_terminal_status_event(
        if settled.is_empty() {
            "backend.todo_dispatch.swarm_run_settle_skip"
        } else {
            "backend.todo_dispatch.swarm_run_settled"
        },
        json!({
            "count": settled.len(),
            "run_id": run_id,
            "run_status": run_status,
            "swarm_id": swarm_id,
            "todo_status": todo_status,
            "workspace_id": workspace_id,
        }),
    );

    settled.len()
}

#[derive(Deserialize)]
struct TodoDispatchTerminalInputReadySettleRequest {
    workspace_id: String,
    pane_id: String,
    prompt_event_id: Option<String>,
    prompt_text: Option<String>,
    input_ready_at: Option<String>,
    reason: Option<String>,
}

#[tauri::command(rename_all = "snake_case")]
async fn todo_dispatch_settle_terminal_input_ready(
    app: AppHandle,
    request: TodoDispatchTerminalInputReadySettleRequest,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_id = request.workspace_id.trim().to_string();
        let pane_id = request.pane_id.trim().to_string();
        if workspace_id.is_empty() {
            return Err("workspace_id is required.".to_string());
        }
        if pane_id.is_empty() {
            return Err("pane_id is required.".to_string());
        }
        let settled_count = todo_dispatch_mark_active_for_pane_completed(
            &app,
            &workspace_id,
            &pane_id,
            request.prompt_event_id.as_deref().unwrap_or_default(),
            request.prompt_text.as_deref().unwrap_or_default(),
            request.input_ready_at.as_deref().unwrap_or_default(),
            request.reason.as_deref().unwrap_or("terminal_input_ready"),
        );
        Ok(json!({
            "pane_id": pane_id,
            "settled_count": settled_count,
            "workspace_id": workspace_id,
        }))
    })
    .await
    .map_err(|error| format!("Todo input-ready settlement worker failed: {error}"))?
}

fn chrono_like_now_iso() -> String {
    // kernel::now_rfc3339 returns "<epoch_secs>.<millis>Z", which Date.parse
    // rejects; captured todos flow into the webview/cloud where createdAt
    // must be real ISO-8601.
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs() as i64;
    let millis = duration.subsec_millis();
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400);
    // Howard Hinnant's civil_from_days.
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

#[cfg(test)]
mod todo_store_tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn attention_notification_watched_suppression_does_not_consume_generation() {
        let key = ("test-watched-attention-generation".to_string(), 101);
        let calls = Cell::new(0_u8);

        assert!(!todo_dispatch_try_attention_notification(
            key.clone(),
            true,
            || {
                calls.set(calls.get() + 1);
                true
            },
        ));
        assert_eq!(calls.get(), 0);
        assert!(!todo_dispatch_attention_recently_notified(&key));

        assert!(todo_dispatch_try_attention_notification(
            key.clone(),
            false,
            || {
                calls.set(calls.get() + 1);
                true
            },
        ));
        assert_eq!(calls.get(), 1);
        assert!(todo_dispatch_attention_recently_notified(&key));
        assert!(!todo_dispatch_try_attention_notification(key, false, || {
            calls.set(calls.get() + 1);
            true
        }));
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn attention_notification_only_consumes_generation_after_show() {
        let key = ("test-failed-attention-generation".to_string(), 202);

        assert!(!todo_dispatch_try_attention_notification(
            key.clone(),
            false,
            || false,
        ));
        assert!(!todo_dispatch_attention_recently_notified(&key));
        assert!(todo_dispatch_try_attention_notification(
            key.clone(),
            false,
            || true,
        ));
        assert!(todo_dispatch_attention_recently_notified(&key));
    }

    #[test]
    fn attention_notification_reserves_generation_while_show_is_in_flight() {
        let key = ("test-concurrent-attention-generation".to_string(), 250);
        let worker_key = key.clone();
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            todo_dispatch_try_attention_notification(worker_key, false, || {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                true
            })
        });
        entered_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("first notification should enter the show path");

        let duplicate_called = Cell::new(false);
        assert!(!todo_dispatch_try_attention_notification(
            key.clone(),
            false,
            || {
                duplicate_called.set(true);
                true
            },
        ));
        assert!(!duplicate_called.get());

        release_tx.send(()).unwrap();
        assert!(worker.join().unwrap());
        assert!(todo_dispatch_attention_recently_notified(&key));
    }

    #[test]
    fn attention_notification_dedup_is_scoped_to_interaction_revision() {
        let first = ("test-attention-edge".to_string(), 303);
        let new_revision = ("test-attention-edge".to_string(), 304);
        let new_interaction = ("test-attention-edge-next".to_string(), 303);

        assert!(todo_dispatch_try_attention_notification(
            first.clone(),
            false,
            || true,
        ));
        assert!(!todo_dispatch_try_attention_notification(
            first,
            false,
            || true,
        ));
        assert!(todo_dispatch_try_attention_notification(
            new_revision,
            false,
            || true,
        ));
        assert!(todo_dispatch_try_attention_notification(
            new_interaction,
            false,
            || true,
        ));
    }

    #[test]
    fn attention_notification_key_uses_one_canonical_interaction_pair() {
        assert_eq!(
            todo_dispatch_attention_interaction_key_parts(
                Some("uir:active"),
                Some(401),
                Some("uir:event"),
                Some(400),
            ),
            Some(("uir:active".to_string(), 401)),
        );
        assert_eq!(
            todo_dispatch_attention_interaction_key_parts(
                Some("uir:active-without-revision"),
                None,
                Some("uir:event"),
                Some(402),
            ),
            Some(("uir:event".to_string(), 402)),
        );
        assert_eq!(
            todo_dispatch_attention_interaction_key_parts(
                Some("uir:must-not-mix"),
                None,
                None,
                Some(403),
            ),
            None,
        );
    }

    #[test]
    fn remote_intake_accepts_loop_send_message_aliases() {
        for command_kind in [
            "",
            "create_task",
            "todo_queue",
            "workspace.todo-queue",
            "terminal_orchestrator_send_message",
            "terminal.orchestrator.send-message",
            "loopspace-send-message",
            "send_message",
        ] {
            assert!(
                todo_dispatch_remote_command_is_queue_action(command_kind),
                "{command_kind} should queue"
            );
        }
        assert!(!todo_dispatch_remote_command_is_queue_action("asset_track"));
    }

    #[test]
    fn chat_attachment_push_app_control_sentinel_routes_orchestrator_send_by_owner() {
        for workspace_id in ["", TODO_DISPATCH_APP_CONTROL_WORKSPACE_ID] {
            let event = json!({
                "command_kind": "terminal_orchestrator_send_message",
                "command_id": "run-1",
                "workspace_id": workspace_id,
            });
            let command_kind = todo_dispatch_text(&event, &["command_kind", "action", "command"]);
            let command_id = todo_dispatch_text(&event, &["command_id"]);
            let workspace_id = todo_dispatch_text(&event, &["workspace_id"]);

            assert_eq!(
                todo_dispatch_remote_intake_scope_decision_for_webview(
                    &command_kind,
                    &command_id,
                    &workspace_id,
                    true,
                ),
                TodoDispatchRemoteIntakeScopeDecision::IgnoreOrchestratorSend
            );
            assert_eq!(
                todo_dispatch_remote_intake_scope_decision_for_webview(
                    &command_kind,
                    &command_id,
                    &workspace_id,
                    false,
                ),
                TodoDispatchRemoteIntakeScopeDecision::RustOrchestratorSend
            );
        }
    }

    #[test]
    fn remote_intake_defers_loopspace_todo_batches_without_singular_workspace() {
        for command_kind in [
            "dispatch_todos",
            "loopspace.dispatch-todos",
            "loopspace_workspace_todo_dispatch",
        ] {
            assert_eq!(
                todo_dispatch_remote_intake_scope_decision_for_webview(
                    command_kind,
                    "looprun-1",
                    "",
                    true,
                ),
                TodoDispatchRemoteIntakeScopeDecision::DeferLoopspaceTodoBatch
            );
            assert_eq!(
                todo_dispatch_remote_intake_scope_decision_for_webview(
                    command_kind,
                    "looprun-1",
                    "",
                    false,
                ),
                TodoDispatchRemoteIntakeScopeDecision::DeferLoopspaceTodoBatch
            );
        }
    }

    #[test]
    fn todo_dispatch_intake_keeps_workspace_send_message_in_queue_flow() {
        let event = json!({
            "command_kind": "terminal_orchestrator_send_message",
            "command_id": "run-1",
            "workspace_id": "workspace-1",
        });
        let command_kind = todo_dispatch_text(&event, &["command_kind", "action", "command"]);
        let command_id = todo_dispatch_text(&event, &["command_id"]);
        let workspace_id = todo_dispatch_text(&event, &["workspace_id"]);

        assert_eq!(
            todo_dispatch_remote_intake_scope_decision_for_webview(
                &command_kind,
                &command_id,
                &workspace_id,
                true,
            ),
            TodoDispatchRemoteIntakeScopeDecision::Continue
        );
    }

    #[test]
    fn todo_dispatch_intake_still_fails_create_task_without_workspace() {
        let event = json!({
            "command_kind": "create_task",
            "command_id": "command-1",
            "workspace_id": "",
        });
        let command_kind = todo_dispatch_text(&event, &["command_kind", "action", "command"]);
        let command_id = todo_dispatch_text(&event, &["command_id"]);
        let workspace_id = todo_dispatch_text(&event, &["workspace_id"]);

        assert_eq!(
            todo_dispatch_remote_intake_scope_decision_for_webview(
                &command_kind,
                &command_id,
                &workspace_id,
                true,
            ),
            TodoDispatchRemoteIntakeScopeDecision::MissingScope
        );
    }

    #[test]
    fn remote_intake_success_ack_is_progress_not_completion() {
        let event = json!({
            "command_kind": "todo_queue",
            "command_id": "command-1",
            "workspace_id": "workspace-1",
            "target_terminal_id": "pane-1",
        });

        let outcome = todo_dispatch_remote_intake_success_outcome(
            &event,
            "command-1",
            "todo-1",
            "workspace-1",
            &todo_dispatch_normalize_status(""),
            "created",
        );

        assert_eq!(outcome["status"], "queued");
        assert_ne!(outcome["status"], "completed");
        assert_eq!(outcome["details"]["todo_status"], "queued");
    }

    #[test]
    fn remote_intake_only_acks_new_or_updated_rows() {
        assert!(todo_dispatch_remote_intake_should_ack_cloud(
            "remote_todo_created"
        ));
        assert!(todo_dispatch_remote_intake_should_ack_cloud(
            "remote_todo_updated"
        ));
        assert!(todo_dispatch_remote_intake_should_ack_cloud(
            "remote_todo_stale_ignored"
        ));
        assert!(!todo_dispatch_remote_intake_should_ack_cloud(
            "remote_todo_already_current"
        ));
        assert!(!todo_dispatch_remote_intake_should_ack_cloud(
            "remote_todo_conflict_current"
        ));
    }

    #[test]
    fn remote_intake_cannot_undo_a_newer_local_edit() {
        let existing = json!({
            "id": "todo-1",
            "status": "listed",
            "text": "new local text",
            "updated_at": "2026-07-12T07:13:00.000Z",
        });
        let stale_remote = json!({
            "command_id": "todo-1",
            "status": "listed",
            "text": "old cloud text",
            "updated_at": "2026-07-12T07:12:00.000Z",
        });
        let newer_remote = json!({
            "command_id": "todo-1",
            "status": "listed",
            "text": "newer web text",
            "updated_at": "2026-07-12T07:14:00.000Z",
        });

        assert!(todo_dispatch_remote_intake_is_stale(
            &existing,
            &stale_remote
        ));
        assert!(!todo_dispatch_remote_intake_is_stale(
            &existing,
            &newer_remote
        ));
    }

    #[test]
    fn startup_epoch_gates_receipt_and_queue_completion_settlement() {
        let app_started_ms = todo_dispatch_app_started_ms();
        let stale_ms = app_started_ms.saturating_sub(10_000);
        let stale_iso = "1970-01-01T00:00:01.250Z";
        let fresh_iso = chrono_like_now_iso();

        assert!(!todo_dispatch_receipt_submitted_after_app_start(
            &json!({ "submitted_at": stale_iso })
        ));
        assert!(todo_dispatch_receipt_submitted_after_app_start(
            &json!({ "submitted_at": fresh_iso })
        ));
        assert!(!todo_dispatch_completed_receipt_fresh_for_notification(
            &json!({ "completed_at_ms": stale_ms })
        ));
        assert!(todo_dispatch_completed_receipt_fresh_for_notification(
            &json!({ "completed_at_ms": app_started_ms })
        ));
        assert!(!todo_dispatch_queue_item_fresh_for_completion_settlement(
            &json!({
                "id": "stale-running",
                "status": "running",
                "todo_status_updated_at_ms": stale_ms,
                "updated_at_ms": stale_ms,
            })
        ));
        assert!(todo_dispatch_queue_item_fresh_for_completion_settlement(
            &json!({
                "id": "fresh-running",
                "status": "running",
                "todo_status_updated_at_ms": app_started_ms,
                "updated_at_ms": app_started_ms,
            })
        ));
    }

    #[test]
    fn tombstone_filter_rejects_by_item_id_and_command_id() {
        let tombstoned: HashSet<String> =
            ["dead-id".to_string(), "dead-command".to_string()].into();
        let items = vec![
            json!({ "id": "alive", "text": "keep me" }),
            json!({ "id": "dead-id", "text": "ghost by id" }),
            json!({
                "id": "other",
                "remote_command": { "command_id": "dead-command" },
                "text": "ghost by command id",
            }),
        ];
        let (kept, rejected) = todo_store_filter_tombstoned(items, &tombstoned);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0]["id"], "alive");
        assert_eq!(rejected, vec!["dead-id".to_string(), "other".to_string()]);
    }

    #[test]
    fn activity_hook_event_type_normalizes_provider_variants() {
        assert_eq!(
            todo_dispatch_normalize_activity_hook_event_type("provider_turn_completed"),
            "provider-turn-completed"
        );
        assert_eq!(
            todo_dispatch_normalize_activity_hook_event_type(" Provider Turn Error "),
            "provider-turn-error"
        );
    }

    #[test]
    fn tombstone_filter_passes_everything_when_no_tombstones() {
        let items = vec![json!({ "id": "a" }), json!({ "id": "b" })];
        let (kept, rejected) = todo_store_filter_tombstoned(items, &HashSet::new());
        assert_eq!(kept.len(), 2);
        assert!(rejected.is_empty());
    }

    #[test]
    fn backend_ready_gate_rejects_starting_even_with_input_ready() {
        let entry = json!({
            "agent_id": "codex",
            "input_ready": true,
            "readiness": "ready",
            "terminal_status": "starting",
            "terminal_work_state": "running",
        });

        assert!(!todo_dispatch_backend_ready_entry_allows_submit(&entry));
    }

    #[test]
    fn backend_ready_gate_accepts_only_idle_ready_terminal() {
        let entry = json!({
            "activity_status": "idle",
            "agent_id": "codex",
            "input_ready": true,
            "readiness": "ready",
            "terminal_status": "idle",
            "terminal_work_state": "complete",
        });

        assert!(todo_dispatch_backend_ready_entry_allows_submit(&entry));
    }

    #[test]
    fn backend_ready_gate_rejects_shell_terminal() {
        let entry = json!({
            "activity_status": "idle",
            "agent_id": "shell",
            "agent_kind": "shell",
            "input_ready": true,
            "readiness": "ready",
            "terminal_status": "idle",
            "terminal_work_state": "complete",
        });

        assert!(!todo_dispatch_backend_ready_entry_allows_submit(&entry));
    }

    #[test]
    fn backend_ready_entries_sort_by_terminal_index_then_pane() {
        let mut entries = vec![
            json!({ "pane_id": "pane-z", "terminal_index": 2 }),
            json!({ "pane_id": "pane-b", "terminal_index": 1 }),
            json!({ "pane_id": "pane-a", "terminal_index": 1 }),
        ];

        todo_dispatch_sort_backend_ready_entries(&mut entries);

        let pane_ids = entries
            .iter()
            .map(|entry| todo_dispatch_text(entry, &["pane_id"]))
            .collect::<Vec<_>>();
        assert_eq!(pane_ids, vec!["pane-a", "pane-b", "pane-z"]);
    }

    #[test]
    fn backend_dispatcher_rejects_image_todos() {
        assert!(!todo_dispatch_backend_item_dispatchable(&json!({
            "id": "todo-image-1",
            "image_data_url": "data:image/png;base64,AAAA",
            "status": "queued",
            "text": "look at this",
            "todo_status": "queued",
        })));
    }

    #[test]
    fn queue_all_does_not_demote_running_item() {
        let mut running_item = json!({
            "id": "todo-running-queue-all",
            "kind": "todo",
            "status": "running",
            "text": "already claimed",
            "todo_status": "running",
            "workspace_id": "workspace-a",
        });
        todo_store_set_item_status(
            &mut running_item,
            "running",
            "todo_queue_backend_dispatch_claim",
        );

        let (items, corrections) = todo_store_queue_all_apply_core(
            vec![running_item],
            vec![json!({
                "id": "todo-running-queue-all",
                "kind": "todo",
                "status": "listed",
                "text": "already claimed",
                "todo_status": "listed",
                "workspace_id": "workspace-a",
            })],
            "workspace-a",
            "todo_store_queue_all",
        );

        assert!(corrections.is_empty());
        assert_eq!(items.len(), 1);
        assert_eq!(todo_store_item_status(&items[0]), "running");
    }

    #[test]
    fn logical_dedupe_prefers_running_alias_over_stale_queued_copy() {
        let mut running_item = json!({
            "id": "todo-alias-1",
            "kind": "todo",
            "status": "running",
            "text": "do the thing",
            "todo_status": "running",
            "workspace_id": "workspace-a",
        });
        todo_store_set_item_status(
            &mut running_item,
            "running",
            "todo_queue_backend_dispatch_claim",
        );
        let queued_copy = json!({
            "id": "todo-alias-1",
            "kind": "todo",
            "status": "queued",
            "text": "do the thing",
            "todo_status": "queued",
            "workspace_id": "workspace-a",
        });

        let items = todo_store_dedupe_logical_items(vec![queued_copy, running_item]);

        assert_eq!(items.len(), 1);
        assert_eq!(todo_store_item_status(&items[0]), "running");
    }

    #[test]
    fn logical_identity_includes_prompt_event_aliases() {
        let queued_copy = json!({
            "id": "todo-local-copy",
            "prompt_event_id": "prompt-abc",
            "status": "queued",
            "text": "same prompt",
            "todo_status": "queued",
        });
        let running_copy = json!({
            "id": "todo-rust-copy",
            "prompt_event_id": "prompt-abc",
            "status": "running",
            "text": "same prompt",
            "todo_status": "running",
        });

        assert!(todo_store_items_share_identity(&queued_copy, &running_copy));
        let items = todo_store_dedupe_logical_items(vec![queued_copy, running_copy]);

        assert_eq!(items.len(), 1);
        assert_eq!(todo_store_item_status(&items[0]), "running");
    }

    #[test]
    fn logical_dedupe_collapses_transitive_alias_family() {
        let mut running_copy = json!({
            "id": "todo-rust-copy",
            "prompt_event_id": "prompt-abc",
            "status": "running",
            "text": "same prompt",
            "todo_status": "running",
        });
        todo_store_set_item_status(
            &mut running_copy,
            "running",
            "todo_queue_backend_dispatch_claim",
        );
        let queued_copy = json!({
            "id": "todo-command-copy",
            "command_id": "command-xyz",
            "status": "queued",
            "text": "same prompt",
            "todo_status": "queued",
        });
        let bridge_copy = json!({
            "id": "todo-bridge-copy",
            "prompt_event_id": "prompt-abc",
            "command_id": "command-xyz",
            "status": "listed",
            "text": "same prompt",
            "todo_status": "listed",
        });

        let items = todo_store_dedupe_logical_items(vec![running_copy, queued_copy, bridge_copy]);

        assert_eq!(items.len(), 1);
        assert_eq!(todo_store_item_status(&items[0]), "running");
        let tokens = todo_store_history_item_tokens(&items[0]);
        assert!(tokens.iter().any(|token| token == "prompt-abc"));
        assert!(tokens.iter().any(|token| token == "command-xyz"));
        assert!(tokens.iter().any(|token| token == "todo-command-copy"));
    }

    #[test]
    fn webview_snapshot_preserves_rust_owned_running_alias_lifecycle() {
        let mut stored = json!({
            "id": "todo-rust-copy",
            "kind": "todo",
            "prompt_event_id": "prompt-abc",
            "rust_owned": true,
            "lifecycle_owner": "rust",
            "status": "running",
            "text": "same prompt",
            "todo_status": "running",
        });
        todo_store_set_item_status(&mut stored, "running", "todo_queue_backend_dispatch_claim");
        let items = todo_store_sanitize_webview_snapshot_lifecycle(
            &[stored],
            vec![json!({
                "id": "todo-ui-alias",
                "kind": "todo",
                "prompt_event_id": "prompt-abc",
                "status": "listed",
                "text": "same prompt",
                "todo_status": "listed",
            })],
        );

        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["id"], "todo-ui-alias");
        assert_eq!(todo_store_item_status(&items[0]), "running");
        assert_eq!(items[0]["rust_owned"], true);
        assert_eq!(items[0]["lifecycle_owner"], "rust");
    }

    #[test]
    fn webview_snapshot_cannot_create_queued_lifecycle() {
        let items = todo_store_sanitize_webview_snapshot_lifecycle(
            &[],
            vec![json!({
                "id": "todo-js-queued",
                "kind": "todo",
                "queued_at": "2026-06-28T00:00:00.000Z",
                "status": "queued",
                "text": "queued from js snapshot",
                "todo_status": "queued",
            })],
        );

        assert_eq!(items.len(), 1);
        assert_eq!(todo_store_item_status(&items[0]), "listed");
        assert!(items[0].get("queued_at").is_none());
    }

    #[test]
    fn webview_snapshot_preserves_rust_owned_running_lifecycle() {
        let mut stored = json!({
            "id": "todo-rust-running",
            "kind": "todo",
            "status": "running",
            "text": "rust owns me",
            "todo_status": "running",
        });
        todo_store_set_item_status(&mut stored, "running", "todo_queue_backend_dispatch_claim");
        let items = todo_store_sanitize_webview_snapshot_lifecycle(
            &[stored],
            vec![json!({
                "id": "todo-rust-running",
                "kind": "todo",
                "status": "listed",
                "text": "rust owns me",
                "todo_status": "listed",
            })],
        );

        assert_eq!(items.len(), 1);
        assert_eq!(todo_store_item_status(&items[0]), "running");
        assert_eq!(items[0]["lifecycle_owner"], "rust");
    }

    #[test]
    fn immediate_backend_prepare_rejects_existing_running_item() {
        let workspace_id = format!("test-immediate-claim-{}", todo_dispatch_now_ms());
        let Some(path) = todo_dispatch_data_path("queues", &workspace_id) else {
            panic!("queue path available");
        };
        todo_dispatch_queue_write(
            &workspace_id,
            &[json!({
                "id": "todo-claim-1",
                "status": "running",
                "text": "already running",
                "todo_status": "running",
            })],
        );

        let result = todo_dispatch_prepare_immediate_backend_item(
            &workspace_id,
            json!({
                "id": "todo-claim-1",
                "status": "queued",
                "text": "already running",
                "todo_status": "queued",
            }),
            &json!({
                "pane_id": "pane-1",
                "terminal_index": 0,
                "thread_id": "thread-1",
            }),
            Some("prompt-1"),
        );

        assert_eq!(result.unwrap_err(), "todo_already_in_flight");
        let snapshot = todo_dispatch_queue_read(&path);
        let items = snapshot
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        assert_eq!(items.len(), 1);
        assert_eq!(todo_store_item_status(&items[0]), "running");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn item_matcher_covers_id_and_command_id_and_rejects_empty() {
        let item = json!({
            "id": "item-1",
            "remote_command": { "command_id": "command-1" },
        });
        assert!(todo_store_item_matches_id(&item, "item-1"));
        assert!(todo_store_item_matches_id(&item, "command-1"));
        assert!(!todo_store_item_matches_id(&item, "unrelated"));
        assert!(!todo_store_item_matches_id(&item, ""));
    }

    #[test]
    fn account_resume_plan_republishes_local_rows_and_retires_cloud_ghosts() {
        let cloud_rows = vec![
            (
                "workspace-a".to_string(),
                json!({ "todo_id": "todo-kept", "todo_status": "listed" }),
            ),
            (
                "workspace-a".to_string(),
                json!({ "todo_id": "todo-cloud-ghost", "todo_status": "listed" }),
            ),
            (
                "workspace-untracked".to_string(),
                json!({ "todo_id": "todo-other-workspace", "todo_status": "listed" }),
            ),
        ];
        let local_by_workspace = HashMap::from([(
            "workspace-a".to_string(),
            vec![
                json!({ "id": "todo-kept", "status": "completed" }),
                json!({ "id": "todo-local-listed", "status": "listed" }),
            ],
        )]);

        let (upserts, deletes) =
            todo_store_account_resume_reconciliation_plan(&cloud_rows, &local_by_workspace, true);

        assert_eq!(upserts.len(), 2);
        assert!(upserts.iter().any(|(_, item)| item["id"] == "todo-kept"));
        assert!(upserts
            .iter()
            .any(|(_, item)| item["id"] == "todo-local-listed"));
        assert_eq!(
            deletes.get("workspace-a"),
            Some(&vec!["todo-cloud-ghost".to_string()]),
        );
        assert!(!deletes.contains_key("workspace-untracked"));
    }

    #[test]
    fn account_resume_delta_never_deletes_rows_missing_from_partial_payload() {
        let cloud_rows = vec![(
            "workspace-a".to_string(),
            json!({ "todo_id": "todo-cloud-only", "todo_status": "listed" }),
        )];
        let local_by_workspace = HashMap::from([(
            "workspace-a".to_string(),
            vec![json!({ "id": "todo-local", "status": "listed" })],
        )]);

        let (upserts, deletes) =
            todo_store_account_resume_reconciliation_plan(&cloud_rows, &local_by_workspace, false);

        assert_eq!(upserts.len(), 1);
        assert!(deletes.is_empty());
    }

    #[test]
    fn account_resume_reads_full_accepted_snapshot_shape() {
        let device_id = cloud_mcp_desktop_device_profile()["device_id"]
            .as_str()
            .unwrap()
            .to_string();
        let event = json!({
            "contract": "diffforge.todo.live_state.v1",
            "snapshot_full": true,
            "sync_mode": "latest_per_workspace",
            "accepted": {
                "items": [
                    {
                        "todo_id": "todo-current",
                        "source_device_id": device_id,
                        "source_workspace_id": "workspace-a",
                        "todo_status": "listed",
                        "current": true,
                    },
                    {
                        "todo_id": "todo-history",
                        "source_device_id": device_id,
                        "source_workspace_id": "workspace-a",
                        "todo_status": "done",
                        "current": true,
                    }
                ]
            }
        });

        assert!(todo_store_account_resume_snapshot_is_full(&event));
        let rows = todo_store_account_resume_cloud_queue_rows(&event);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "workspace-a");
        assert_eq!(rows[0].1["todo_id"], "todo-current");
    }

    #[test]
    fn pane_settlement_fallback_picks_newest_active_item_for_pane() {
        let items = vec![
            json!({
                "id": "old-running",
                "status": "running",
                "target_terminal_id": "pane-a",
                "updated_at_ms": 100,
            }),
            json!({
                "id": "new-running",
                "remote_command": { "command_id": "command-new" },
                "status": "submitted",
                "target_terminal_id": "pane-a",
                "updated_at_ms": 300,
            }),
            json!({
                "id": "other-pane",
                "status": "running",
                "target_terminal_id": "pane-b",
                "updated_at_ms": 500,
            }),
            json!({
                "id": "done",
                "status": "completed",
                "target_terminal_id": "pane-a",
                "updated_at_ms": 900,
            }),
        ];

        assert_eq!(
            todo_dispatch_active_queue_item_ids_for_pane_from_items(&items, "pane-a"),
            vec!["command-new".to_string(), "old-running".to_string()]
        );
    }

    #[test]
    fn input_ready_prompt_identity_matches_direct_id_and_text() {
        let item = json!({
            "id": "terminal-direct-terminal-prompt-abc",
            "status": "running",
            "target_terminal_id": "pane-a",
            "text": "ship the fix",
        });
        assert!(todo_dispatch_prompt_identity_matches_value(
            &item,
            "terminal-prompt-abc",
            "",
        ));
        assert!(todo_dispatch_prompt_identity_matches_value(
            &item,
            "",
            "ship   the\nfix",
        ));
        assert!(!todo_dispatch_prompt_identity_matches_value(
            &item,
            "terminal-prompt-other",
            "different prompt",
        ));
    }

    #[test]
    fn direct_prompt_inputs_append_and_match_latest_prompt() {
        let mut item = json!({
            "id": "terminal-direct-prompt-1",
            "status": "running",
            "target_terminal_id": "pane-a",
            "text": "first message",
            "prompt_event_id": "prompt-1",
            "created_at": "2026-06-19T00:00:00Z",
        });
        let second = todo_dispatch_direct_prompt_input_entry(
            "second message",
            Some("prompt-2"),
            "2026-06-19T00:01:00Z",
            "pane-a",
            1,
            "thread-a",
            "codex",
        );
        assert!(todo_dispatch_append_input_to_value(&mut item, &second));
        let inputs = todo_dispatch_value_inputs(&item);
        assert_eq!(inputs.len(), 2);
        assert_eq!(item["input_count"].as_u64(), Some(2));
        assert!(todo_dispatch_prompt_identity_matches_value(
            &item, "prompt-1", "",
        ));
        assert!(todo_dispatch_prompt_identity_matches_value(
            &item, "prompt-2", "",
        ));
    }

    #[test]
    fn direct_prompt_inputs_keep_repeated_text_when_prompt_ids_differ() {
        let mut item = json!({
            "id": "terminal-direct-prompt-1",
            "status": "running",
            "target_terminal_id": "pane-a",
            "text": "repeat this",
            "prompt_event_id": "prompt-1",
            "created_at": "2026-06-19T00:00:00Z",
        });
        let second = todo_dispatch_direct_prompt_input_entry(
            "repeat this",
            Some("prompt-2"),
            "2026-06-19T00:01:00Z",
            "pane-a",
            1,
            "thread-a",
            "codex",
        );
        assert!(todo_dispatch_append_input_to_value(&mut item, &second));
        let duplicate_second = todo_dispatch_direct_prompt_input_entry(
            "repeat this",
            Some("prompt-2"),
            "2026-06-19T00:01:01Z",
            "pane-a",
            1,
            "thread-a",
            "codex",
        );
        assert!(!todo_dispatch_append_input_to_value(
            &mut item,
            &duplicate_second
        ));
        let third = todo_dispatch_direct_prompt_input_entry(
            "repeat this",
            Some("prompt-3"),
            "2026-06-19T00:02:00Z",
            "pane-a",
            1,
            "thread-a",
            "codex",
        );
        assert!(todo_dispatch_append_input_to_value(&mut item, &third));
        assert_eq!(todo_dispatch_value_inputs(&item).len(), 3);
    }

    #[test]
    fn status_setter_stamps_both_field_families_and_timestamps() {
        let mut item = json!({
            "id": "item-1",
            "queueState": { "phase": "sending" },
            "queue_state": { "phase": "queued" },
            "todo_status": "running",
            "status": "running",
        });
        todo_store_set_item_status(&mut item, "cancelled", "todo_history_cancel");
        assert_eq!(item["todo_status"], "cancelled");
        assert_eq!(item["status"], "cancelled");
        assert_eq!(item["todo_status_reason"], "todo_history_cancel");
        assert_eq!(item["status_reason"], "todo_history_cancel");
        assert!(item["updated_at_ms"].as_u64().unwrap() > 0);
        assert!(item["updated_at"].as_str().unwrap().ends_with('Z'));
        assert!(item.get("queueState").is_none());
        assert!(item.get("queue_state").is_none());
    }

    #[test]
    fn queue_snapshot_canonicalization_strips_js_queue_state() {
        let items = todo_store_canonicalize_settled_items(vec![json!({
            "id": "item-1",
            "queueState": { "phase": "sending" },
            "queue_state": { "phase": "queued" },
            "status": "running",
        })]);
        assert_eq!(items.len(), 1);
        assert!(items[0].get("queueState").is_none());
        assert!(items[0].get("queue_state").is_none());
        assert_eq!(items[0]["status"], "running");
    }

    #[test]
    fn lifecycle_status_aliases_normalize_in_rust() {
        assert_eq!(todo_store_normalize_lifecycle_status("done"), "completed");
        assert_eq!(
            todo_store_normalize_lifecycle_status("in-flight"),
            "running"
        );
        assert_eq!(
            todo_store_normalize_lifecycle_status("timeout"),
            "timed_out"
        );
        assert_eq!(
            todo_store_normalize_lifecycle_status("terminal unavailable"),
            "listed"
        );
        assert_eq!(todo_store_normalize_lifecycle_status("unknown"), "");
    }

    #[test]
    fn hard_delete_eligibility_allows_only_unsent_items() {
        let listed = json!({ "id": "todo-listed", "status": "listed" });
        let queued =
            json!({ "id": "todo-queued", "status": "queued", "target_terminal_id": "pane-a" });
        let running = json!({ "id": "todo-running", "status": "running" });
        let dispatched = json!({
            "id": "todo-dispatched",
            "status": "queued",
            "last_dispatch_id": "dispatch-1"
        });
        let completed = json!({ "id": "todo-completed", "status": "completed" });

        assert!(todo_store_item_hard_delete_eligible(&listed));
        assert!(todo_store_item_hard_delete_eligible(&queued));
        assert!(!todo_store_item_hard_delete_eligible(&running));
        assert!(!todo_store_item_hard_delete_eligible(&dispatched));
        assert!(!todo_store_item_hard_delete_eligible(&completed));
    }

    #[test]
    fn delete_classifier_preserves_explicit_tombstone_mode() {
        let listed = vec![json!({ "id": "todo-listed", "status": "listed" })];

        assert_eq!(
            todo_store_classify_delete_mode(&listed, None),
            TodoStoreDeleteMode::Hard
        );
        assert_eq!(
            todo_store_classify_delete_mode(&listed, Some(TodoStoreDeleteMode::Tombstone)),
            TodoStoreDeleteMode::Tombstone
        );
        assert_eq!(
            todo_store_classify_delete_mode(&listed, Some(TodoStoreDeleteMode::Hard)),
            TodoStoreDeleteMode::Hard
        );
        assert_eq!(
            todo_store_classify_delete_mode(&[], None),
            TodoStoreDeleteMode::Tombstone
        );
    }

    #[test]
    fn delete_classifier_handles_mirror_only_listed_rows() {
        let mirror_only = vec![json!({
            "todo_id": "todo-mirror-only",
            "status": "listed",
            "workspace_id": "workspace-a",
        })];
        let dispatched = vec![json!({
            "todo_id": "todo-dispatched",
            "status": "queued",
            "last_dispatch_id": "dispatch-1",
        })];

        assert_eq!(
            todo_store_classify_delete_mode(&mirror_only, None),
            TodoStoreDeleteMode::Hard
        );
        assert_eq!(
            todo_store_classify_delete_mode(&dispatched, None),
            TodoStoreDeleteMode::Tombstone
        );
    }

    #[test]
    fn draft_create_builds_rust_owned_canonical_item() {
        let item = todo_store_build_created_item(
            "workspace-1",
            &json!({
                "device_id": "device-1",
                "note": { "title": " Context ", "body": " Use the cache " },
                "plan_task": { "task_id": "task-1", "title": "Ship task" },
                "status": "done",
                "target_explicit": true,
                "target_terminal_id": "pane-2",
                "target_terminal_index": 2,
                "text": " ship\r\nit ",
                "title": "Ship it",
            }),
            "todo_queue_draft_submitted",
        )
        .expect("draft should create");

        assert!(item["id"].as_str().unwrap().starts_with("todo-"));
        assert_eq!(item["text"], "ship\nit");
        assert_eq!(item["workspace_id"], "workspace-1");
        assert_eq!(item["device_id"], "device-1");
        assert_eq!(item["source"], "tui-todo-auto-queue");
        assert_eq!(item["rust_owned"], true);
        assert_eq!(item["lifecycle_owner"], "rust");
        assert_eq!(item["todo_status"], "completed");
        assert_eq!(item["status"], "completed");
        assert_eq!(item["todo_status_reason"], "todo_queue_draft_submitted");
        assert_eq!(item["status_reason"], "todo_queue_draft_submitted");
        assert_eq!(item["note"]["title"], "Context");
        assert_eq!(item["note"]["text"], "Use the cache");
        assert_eq!(item["plan_task"]["task_id"], "task-1");
        assert_eq!(item["title"], "Ship it");
        assert_eq!(item["target_explicit"], true);
        assert_eq!(item["target_terminal_id"], "pane-2");
        assert_eq!(item["target_terminal_index"], 2);
        assert!(item["todo_status_updated_at"]
            .as_str()
            .unwrap()
            .ends_with('Z'));
    }

    #[test]
    fn draft_create_preserves_loopspace_dispatch_runtime_identity() {
        let item = todo_store_build_created_item(
            "workspace-1",
            &json!({
                "command_kind": "loopspace_dispatch_todos",
                "loop_runtime_edge_id": "edge-1",
                "loop_runtime_node_id": "dispatch-1",
                "loop_runtime_run_id": "run-1",
                "loopspace_id": "loopspace-1",
                "remote_command": {
                    "checkpoint_plan": [{ "id": "step-1" }],
                    "source": "loopspace-dispatch-todos"
                },
                "source": "loopspace-dispatch-todos",
                "target_terminal_mode": "auto",
                "text": "Run the dispatched todo",
                "trigger_id": "trigger-1",
                "trigger_run_id": "trigger-run-1"
            }),
            "loopspace_dispatch",
        )
        .expect("dispatch todo should create");

        assert_eq!(item["loop_runtime_run_id"], "run-1");
        assert_eq!(item["loop_runtime_node_id"], "dispatch-1");
        assert_eq!(item["loop_runtime_edge_id"], "edge-1");
        assert_eq!(item["trigger_id"], "trigger-1");
        assert_eq!(item["trigger_run_id"], "trigger-run-1");
        assert_eq!(item["command_kind"], "loopspace_dispatch_todos");
        assert_eq!(
            item["remote_command"]["command_kind"],
            "loopspace_dispatch_todos"
        );
        assert_eq!(item["remote_command"]["loop_runtime_run_id"], "run-1");
        assert_eq!(item["remote_command"]["loop_runtime_node_id"], "dispatch-1");
        assert!(item["remote_command"].get("checkpoint_plan").is_none());
    }

    #[test]
    fn loopspace_dispatch_structured_body_survives_store_and_pty_preparation() {
        let full_body = "1. Audit the startup transition.\n\n2. Preserve this explanatory paragraph exactly, including hard line breaks.\n   - Verify the queued todo wakes immediately.\n   - Report the lifecycle result.";
        let request = json!({
            "todo_items": [{ "text": full_body }],
        });
        let drafts = todo_store_dispatch_todo_drafts(&request).unwrap();
        assert_eq!(drafts.len(), 1, "one structured todo must remain one item");

        let mut draft = drafts[0].as_object().cloned().expect("draft object");
        todo_store_normalize_loopspace_dispatch_draft(&mut draft, 1);
        let item = todo_store_build_created_item(
            "workspace-1",
            &Value::Object(draft),
            "loopspace_dispatch_todos_remote_command",
        )
        .expect("dispatch todo should create");
        assert_eq!(item["text"], full_body);
        assert_eq!(item["title"], "Loopspace Dispatch Todo #1");

        let terminal_body = todo_dispatch_backend_item_text(&item);
        assert_eq!(terminal_body, full_body);
        let terminal_input = todo_dispatch_prepared_terminal_input(
            &TodoDispatchPreparedPrompt::text_only(terminal_body),
            "\r",
        );
        assert!(terminal_input.contains(full_body));
        assert!(terminal_input.ends_with('\r'));
    }

    #[test]
    fn loopspace_dispatch_batch_parses_workspace_todo_and_terminal_contract() {
        let request = json!({
            "payload": {
                "target_workspace_ids": ["workspace-a", "workspace-b", "workspace-a"],
                "todo_lines": "First todo\nSecond todo",
                "target_terminal_index": "2"
            }
        });

        assert_eq!(
            todo_store_dispatch_workspace_ids(&request),
            vec!["workspace-a".to_string(), "workspace-b".to_string()]
        );
        assert_eq!(
            todo_store_dispatch_todo_drafts(&request).unwrap(),
            vec![
                json!({ "text": "First todo" }),
                json!({ "text": "Second todo" })
            ]
        );

        let structured = json!({
            "todo_items": [{
                "text": "1. First line\n\n2. Second paragraph"
            }],
            "todos": ["legacy", "split", "items"]
        });
        assert_eq!(
            todo_store_dispatch_todo_drafts(&structured).unwrap(),
            vec![json!({ "text": "1. First line\n\n2. Second paragraph" })]
        );
        for legacy in [
            json!({ "todos": "First todo\nSecond todo" }),
            json!({ "text": "First todo\nSecond todo" }),
        ] {
            assert_eq!(
                todo_store_dispatch_todo_drafts(&legacy).unwrap(),
                vec![
                    json!({ "text": "First todo" }),
                    json!({ "text": "Second todo" })
                ]
            );
        }
        assert_eq!(
            todo_store_dispatch_optional_i64(
                &request,
                &["target_terminal_index", "terminal_index"]
            ),
            Some(2)
        );
    }

    #[test]
    fn loopspace_dispatch_rejects_empty_structured_todo_item() {
        let error = todo_store_dispatch_todo_drafts(&json!({
            "todo_items": [{}],
        }))
        .unwrap_err();
        assert!(error.contains("todo_items[0]"));
        assert!(error.contains("usable todo text or body"));

        let title_only = todo_store_dispatch_todo_drafts(&json!({
            "todo_items": [{"title": "Run identity, not a body"}],
        }));
        assert!(title_only.is_err());
    }

    #[test]
    fn loopspace_dispatch_batch_lifecycle_aggregates_children_monotonically() {
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let batch_id = format!("batch-{}", uuid::Uuid::new_v4());
        let item = |workspace_id: &str, todo_id: &str, status: &str| {
            json!({
                "command_id": todo_id,
                "command_kind": "loopspace_dispatch_todos",
                "dispatch_id": format!("{todo_id}-dispatch"),
                "loop_runtime_run_id": run_id,
                "loopspace_id": "loopspace-1",
                "status": status,
                "todo_batch_id": batch_id,
                "todo_id": todo_id,
                "todo_status": status,
                "workspace_id": workspace_id,
            })
        };

        let queued_items = vec![
            item("workspace-a", "todo-a", "queued"),
            item("workspace-b", "todo-b", "queued"),
        ];
        let queued =
            todo_dispatch_loopspace_batch_lifecycle_from_items(&queued_items).expect("queued");
        assert_eq!(queued.status, "queued");
        assert_eq!(queued.status_counts["queued"], 2);
        assert_eq!(queued.children.len(), 2);
        todo_dispatch_loopspace_batch_pending_queued_ack_set(&run_id, &batch_id, true);
        assert!(todo_dispatch_loopspace_batch_pending_queued_ack(
            &run_id, &batch_id
        ));
        todo_dispatch_loopspace_batch_pending_queued_ack_set(&run_id, &batch_id, false);
        assert!(!todo_dispatch_loopspace_batch_pending_queued_ack(
            &run_id, &batch_id
        ));
        assert!(todo_dispatch_loopspace_batch_lifecycle_claim(&queued));
        assert!(!todo_dispatch_loopspace_batch_lifecycle_claim(&queued));

        let partly_running = vec![
            item("workspace-a", "todo-a", "running"),
            item("workspace-b", "todo-b", "queued"),
        ];
        let running = todo_dispatch_loopspace_batch_lifecycle_from_items(&partly_running)
            .expect("running");
        assert_eq!(running.status, "running");
        assert!(todo_dispatch_loopspace_batch_lifecycle_claim(&running));

        let partly_completed = vec![
            item("workspace-a", "todo-a", "completed"),
            item("workspace-b", "todo-b", "queued"),
        ];
        assert_eq!(
            todo_dispatch_loopspace_batch_lifecycle_from_items(&partly_completed)
                .unwrap()
                .status,
            "running",
            "a partial batch must not complete",
        );

        let completed_items = vec![
            item("workspace-a", "todo-a", "completed"),
            item("workspace-b", "todo-b", "completed"),
        ];
        let completed = todo_dispatch_loopspace_batch_lifecycle_from_items(&completed_items)
            .expect("completed");
        assert_eq!(completed.status, "completed");
        assert_eq!(completed.status_counts["settled"], 2);
        assert!(todo_dispatch_loopspace_batch_lifecycle_claim(&completed));
        assert!(!todo_dispatch_loopspace_batch_lifecycle_claim(&running));

        let failed_items = vec![
            item("workspace-a", "todo-a", "failed"),
            item("workspace-b", "todo-b", "completed"),
        ];
        assert_eq!(
            todo_dispatch_loopspace_batch_lifecycle_from_items(&failed_items)
                .unwrap()
                .status,
            "failed",
        );
        let interrupted_items = vec![
            item("workspace-a", "todo-a", "interrupted"),
            item("workspace-b", "todo-b", "completed"),
        ];
        assert_eq!(
            todo_dispatch_loopspace_batch_lifecycle_from_items(&interrupted_items)
                .unwrap()
                .status,
            "interrupted",
        );
        let cancelled_items = vec![
            item("workspace-a", "todo-a", "completed"),
            item("workspace-b", "todo-b", "cancelled"),
        ];
        let cancelled = todo_dispatch_loopspace_batch_lifecycle_from_items(&cancelled_items)
            .expect("cancelled child settles batch");
        assert_eq!(cancelled.status, "failed");
        assert_eq!(cancelled.status_counts["cancelled"], 1);
        assert_eq!(cancelled.status_counts["settled"], 2);
    }

    fn loopspace_dispatch_post_batch_test_item(
        request: &Value,
        workspace_id: &str,
        workspace_count: usize,
    ) -> Value {
        let selector = todo_store_dispatch_terminal_selector_for_workspace(
            request,
            workspace_id,
            workspace_count,
        );
        let mut draft = json!({
            "command_kind": "loopspace_dispatch_todos",
            "id": format!("todo-{workspace_id}"),
            "source": "loopspace-dispatch-todos",
            "text": "Run the dispatched todo"
        })
        .as_object()
        .cloned()
        .expect("dispatch draft object");
        todo_store_dispatch_apply_terminal_selector(&mut draft, &selector);
        todo_store_build_created_item(
            workspace_id,
            &Value::Object(draft),
            "loopspace_dispatch_test",
        )
        .expect("post-batch item")
    }

    #[test]
    fn loopspace_dispatch_batch_assigns_index_within_each_workspace() {
        let request = json!({
            "target_terminal_selectors": [
                { "workspace_id": "workspace-a", "target_terminal_index": 2 },
                { "workspace_id": "workspace-b", "target_terminal_index": 2 }
            ]
        });
        let item_a = loopspace_dispatch_post_batch_test_item(&request, "workspace-a", 2);
        let selector_b = todo_store_dispatch_terminal_selector_for_workspace(
            &request,
            "workspace-b",
            2,
        );
        let mut stale_b_draft = json!({
            "command_kind": "loopspace_dispatch_todos",
            "id": "todo-workspace-b",
            "remote_command": {
                "target_terminal_id": "pane-a-2",
                "target_terminal_index": 2
            },
            "source": "loopspace-dispatch-todos",
            "target_terminal_id": "pane-a-2",
            "target_terminal_index": 2,
            "text": "Run the dispatched todo"
        })
        .as_object()
        .cloned()
        .expect("workspace-b stale dispatch draft");
        todo_store_dispatch_apply_terminal_selector(&mut stale_b_draft, &selector_b);
        let item_b = todo_store_build_created_item(
            "workspace-b",
            &Value::Object(stale_b_draft),
            "loopspace_dispatch_test",
        )
        .expect("workspace-b post-batch item");
        let entries_a = vec![
            json!({ "pane_id": "pane-a-0", "terminal_index": 0 }),
            json!({ "pane_id": "pane-a-2", "terminal_index": 2 }),
        ];
        let entries_b = vec![
            json!({ "pane_id": "pane-b-0", "terminal_index": 0 }),
            json!({ "pane_id": "pane-b-2", "terminal_index": 2 }),
        ];

        assert_eq!(item_a["target_terminal_index"], 2);
        assert_eq!(item_b["target_terminal_index"], 2);
        assert!(item_b["remote_command"]
            .get("target_terminal_id")
            .is_none());
        assert_eq!(
            todo_dispatch_backend_pick_target_from_entries(&entries_a, &item_a)
                .map(|entry| todo_dispatch_text(&entry, &["pane_id"])),
            Some("pane-a-2".to_string())
        );
        assert_eq!(
            todo_dispatch_backend_pick_target_from_entries(&entries_b, &item_b)
                .map(|entry| todo_dispatch_text(&entry, &["pane_id"])),
            Some("pane-b-2".to_string())
        );
    }

    #[test]
    fn loopspace_dispatch_batch_scopes_pane_id_to_its_workspace() {
        let request = json!({
            "target_terminal_selectors": [
                {
                    "workspace_id": "workspace-a",
                    "target_terminal_id": "pane-a-2",
                    "target_terminal_index": 2
                },
                { "workspace_id": "workspace-b", "target_terminal_mode": "auto" }
            ]
        });
        let item_a = loopspace_dispatch_post_batch_test_item(&request, "workspace-a", 2);
        let selector_b = todo_store_dispatch_terminal_selector_for_workspace(
            &request,
            "workspace-b",
            2,
        );
        let mut stale_b_draft = json!({
            "command_kind": "loopspace_dispatch_todos",
            "id": "todo-workspace-b",
            "remote_command": {
                "pane_id": "pane-a-2",
                "target_terminal_index": 2
            },
            "source": "loopspace-dispatch-todos",
            "pane_id": "pane-a-2",
            "target_terminal_index": 2,
            "text": "Run the dispatched todo"
        })
        .as_object()
        .cloned()
        .expect("workspace-b stale dispatch draft");
        todo_store_dispatch_apply_terminal_selector(&mut stale_b_draft, &selector_b);
        let item_b = todo_store_build_created_item(
            "workspace-b",
            &Value::Object(stale_b_draft),
            "loopspace_dispatch_test",
        )
        .expect("workspace-b post-batch item");
        let entries_a = vec![json!({ "pane_id": "pane-a-2", "terminal_index": 2 })];
        let entries_b = vec![json!({ "pane_id": "pane-b-0", "terminal_index": 0 })];

        assert_eq!(item_a["target_terminal_id"], "pane-a-2");
        assert!(item_b.get("target_terminal_id").is_none());
        assert!(item_b.get("target_terminal_index").is_none());
        assert!(item_b["remote_command"]
            .get("target_terminal_id")
            .is_none());
        assert!(item_b["remote_command"].get("pane_id").is_none());
        assert_eq!(
            todo_dispatch_backend_pick_target_from_entries(&entries_a, &item_a)
                .map(|entry| todo_dispatch_text(&entry, &["pane_id"])),
            Some("pane-a-2".to_string())
        );
        assert_eq!(
            todo_dispatch_backend_pick_target_from_entries(&entries_b, &item_b)
                .map(|entry| todo_dispatch_text(&entry, &["pane_id"])),
            Some("pane-b-0".to_string())
        );
    }

    #[test]
    fn loopspace_dispatch_batch_keeps_any_terminal_per_workspace() {
        let request = json!({
            "target_terminal_selectors": [
                { "workspace_id": "workspace-a", "target_terminal_mode": "auto" },
                { "workspace_id": "workspace-b", "target_terminal_mode": "auto" }
            ]
        });
        let item_a = loopspace_dispatch_post_batch_test_item(&request, "workspace-a", 2);
        let item_b = loopspace_dispatch_post_batch_test_item(&request, "workspace-b", 2);

        assert_eq!(item_a["target_terminal_mode"], "auto");
        assert_eq!(item_b["target_terminal_mode"], "auto");
        assert!(item_a.get("target_terminal_id").is_none());
        assert!(item_b.get("target_terminal_id").is_none());
        assert_eq!(
            todo_dispatch_backend_pick_target_from_entries(
                &[json!({ "pane_id": "pane-a-0", "terminal_index": 0 })],
                &item_a,
            )
            .map(|entry| todo_dispatch_text(&entry, &["pane_id"])),
            Some("pane-a-0".to_string())
        );
        assert_eq!(
            todo_dispatch_backend_pick_target_from_entries(
                &[json!({ "pane_id": "pane-b-0", "terminal_index": 0 })],
                &item_b,
            )
            .map(|entry| todo_dispatch_text(&entry, &["pane_id"])),
            Some("pane-b-0".to_string())
        );
    }

    #[test]
    fn update_patch_changes_text_without_restamping_status() {
        let mut item = json!({
            "id": "todo-1",
            "lifecycle_owner": "rust",
            "rust_owned": true,
            "status": "listed",
            "text": "old text",
            "todo_status": "listed",
            "todo_status_reason": "todo_queue_draft_submitted",
            "todo_status_updated_at": "2026-06-11T10:00:00.000Z",
        });
        assert!(todo_store_apply_update_patch(
            &mut item,
            &json!({ "text": " new\r\ntext " }),
        ));
        todo_store_canonicalize_status_fields(&mut item);
        assert_eq!(item["text"], "new\ntext");
        assert_eq!(item["todo_status"], "listed");
        assert_eq!(item["status"], "listed");
        assert_eq!(item["todo_status_reason"], "todo_queue_draft_submitted");
        assert_eq!(item["todo_status_updated_at"], "2026-06-11T10:00:00.000Z");
        assert!(item["updated_at"].as_str().unwrap().ends_with('Z'));
        assert_ne!(item["updated_at"], "2026-06-11T10:00:00.000Z");
    }

    #[test]
    fn settled_evidence_overrides_stale_running_status_fields() {
        let mut item = json!({
            "id": "terminal-direct-1",
            "todo_status": "running",
            "status": "running",
            "todo_status_reason": "todo_queue_backend_submit",
            "todo_status_updated_at": "2026-06-12T18:52:33.543Z",
            "completed_at": "2026-06-12T18:53:48.276Z",
            "reason": "todo_queue_backend_settled",
        });
        assert_eq!(todo_store_item_status(&item), "completed");
        assert!(todo_store_canonicalize_settled_evidence(&mut item));
        assert_eq!(item["todo_status"], "completed");
        assert_eq!(item["status"], "completed");
        assert_eq!(item["todo_status_reason"], "todo_queue_backend_settled");
        assert_eq!(item["status_reason"], "todo_queue_backend_settled");
        assert_eq!(item["todo_status_updated_at"], "2026-06-12T18:53:48.276Z");
        assert_eq!(item["todo_completed_at"], "2026-06-12T18:53:48.276Z");
        assert_eq!(item["completed_at"], "2026-06-12T18:53:48.276Z");
    }

    #[test]
    fn settled_evidence_does_not_override_fresh_requeue_status() {
        let mut item = json!({
            "id": "terminal-direct-1",
            "todo_status": "queued",
            "status": "queued",
            "todo_status_reason": "todo_history_queue",
            "todo_status_updated_at": "2026-06-12T18:55:00.000Z",
            "completed_at": "2026-06-12T18:53:48.276Z",
        });
        assert_eq!(todo_store_item_status(&item), "queued");
        assert!(!todo_store_canonicalize_settled_evidence(&mut item));
        assert_eq!(item["todo_status"], "queued");
        assert_eq!(item["status"], "queued");
        assert_eq!(item["todo_status_updated_at"], "2026-06-12T18:55:00.000Z");
    }

    #[test]
    fn newer_store_status_merge_copies_canonical_settled_fields() {
        let stored = vec![json!({
            "id": "terminal-direct-1",
            "source": "terminal_direct",
            "todo_status": "running",
            "status": "running",
            "todo_status_reason": "todo_queue_backend_submit",
            "todo_status_updated_at": "2026-06-12T18:52:33.543Z",
            "completed_at": "2026-06-12T18:53:48.276Z",
        })];
        let incoming = vec![json!({
            "id": "terminal-direct-1",
            "text": "hi",
            "todo_status": "running",
            "status": "running",
            "todo_status_updated_at": "2026-06-12T18:52:33.543Z",
        })];
        let merged = todo_store_apply_newer_store_status_core(&stored, incoming);
        assert_eq!(merged.len(), 1);
        assert_eq!(todo_store_item_status(&merged[0]), "completed");
        assert_eq!(merged[0]["todo_status"], "completed");
        assert_eq!(merged[0]["status"], "completed");
        assert_eq!(merged[0]["completed_at"], "2026-06-12T18:53:48.276Z");
        assert_eq!(merged[0]["todo_completed_at"], "2026-06-12T18:53:48.276Z");
    }

    #[test]
    fn store_item_status_and_pane_read_both_field_families() {
        let item = json!({
            "todo_status": "Running",
            "target_terminal_id": "pane-9",
        });
        assert_eq!(todo_store_item_status(&item), "running");
        assert_eq!(todo_store_item_pane_id(&item), "pane-9");
    }

    #[test]
    fn sweep_flip_outranks_stale_active_replica() {
        let stored = vec![json!({
            "id": "todo-1",
            "todo_status": "interrupted",
            "todo_status_reason": "app_restart",
            "todo_status_updated_at": "2026-06-11T10:00:00.000Z",
        })];
        let incoming = vec![json!({
            "id": "todo-1",
            "todo_status": "queued",
            "todo_status_updated_at": "2026-06-11T09:00:00.000Z",
        })];
        let merged = todo_store_keep_settled_sweep_flips_core(stored, incoming);
        assert_eq!(merged.len(), 1);
        assert_eq!(todo_store_item_status(&merged[0]), "interrupted");
    }

    #[test]
    fn fresh_requeue_outranks_sweep_flip() {
        let stored = vec![json!({
            "id": "todo-1",
            "todo_status": "interrupted",
            "todo_status_reason": "app_restart",
            "todo_status_updated_at": "2026-06-11T10:00:00.000Z",
        })];
        let incoming = vec![json!({
            "id": "todo-1",
            "todo_status": "queued",
            "todo_status_updated_at": "2026-06-11T10:05:00.000Z",
        })];
        let merged = todo_store_keep_settled_sweep_flips_core(stored, incoming);
        assert_eq!(merged.len(), 1);
        assert_eq!(todo_store_item_status(&merged[0]), "queued");
    }

    #[test]
    fn sweep_guard_ignores_user_settled_rows_and_inactive_incoming() {
        // A row the USER cancelled (not a sweep) must not hijack incoming
        // updates, and non-active incoming statuses pass through untouched.
        let stored = vec![
            json!({
                "id": "todo-user",
                "todo_status": "cancelled",
                "todo_status_reason": "todo_history_cancel",
                "todo_status_updated_at": "2026-06-11T10:00:00.000Z",
            }),
            json!({
                "id": "todo-swept",
                "todo_status": "interrupted",
                "todo_status_reason": "app_restart",
                "todo_status_updated_at": "2026-06-11T10:00:00.000Z",
            }),
        ];
        let incoming = vec![
            json!({
                "id": "todo-user",
                "todo_status": "queued",
                "todo_status_updated_at": "2026-06-11T09:00:00.000Z",
            }),
            json!({
                "id": "todo-swept",
                "todo_status": "listed",
                "todo_status_updated_at": "2026-06-11T09:00:00.000Z",
            }),
        ];
        let merged = todo_store_keep_settled_sweep_flips_core(stored, incoming);
        assert_eq!(todo_store_item_status(&merged[0]), "queued");
        assert_eq!(todo_store_item_status(&merged[1]), "listed");
    }

    #[test]
    fn newer_store_status_outranks_stale_webview_claim() {
        let stored = vec![json!({
            "id": "todo-1",
            "todo_status": "queued",
            "todo_status_reason": "todo_history_queue",
            "todo_status_updated_at": "2026-06-11T10:05:00.000Z",
            "target_terminal_index": 2,
        })];
        let incoming = vec![json!({
            "id": "todo-1",
            "text": "edited text survives",
            "todo_status": "listed",
            "todo_status_updated_at": "2026-06-11T10:00:00.000Z",
        })];
        let merged = todo_store_apply_newer_store_status_core(&stored, incoming);
        assert_eq!(merged.len(), 1);
        assert_eq!(todo_store_item_status(&merged[0]), "queued");
        assert_eq!(merged[0]["target_terminal_index"], 2);
        // Non-status fields stay from the incoming row (text edits survive).
        assert_eq!(merged[0]["text"], "edited text survives");
    }

    #[test]
    fn newer_webview_claim_beats_older_store_status() {
        let stored = vec![json!({
            "id": "todo-1",
            "todo_status": "queued",
            "todo_status_updated_at": "2026-06-11T10:00:00.000Z",
        })];
        let incoming = vec![json!({
            "id": "todo-1",
            "todo_status": "listed",
            "todo_status_updated_at": "2026-06-11T10:05:00.000Z",
        })];
        let merged = todo_store_apply_newer_store_status_core(&stored, incoming);
        assert_eq!(todo_store_item_status(&merged[0]), "listed");
    }

    #[test]
    fn rust_owned_running_row_survives_statusless_webview_echo() {
        // The webview prompt-submit bridge materializes the same item id with
        // its own source and no lifecycle status; its snapshot echo must not
        // demote the Rust capture's running row back to listed.
        let stored = vec![json!({
            "id": "direct-1",
            "todo_status": "running",
            "source": "terminal_direct",
        })];
        let incoming = vec![json!({
            "id": "direct-1",
            "text": "what do you think about balancer-diffforge?",
            "source": "tui-terminal-direct-input",
            "todo_status_updated_at": "2026-06-11T10:05:00.000Z",
        })];
        let merged = todo_store_apply_newer_store_status_core(&stored, incoming);
        assert_eq!(todo_store_item_status(&merged[0]), "running");
        // The row stays recognizable as Rust-owned under the webview source.
        assert!(todo_store_item_is_rust_owned(&merged[0]));
    }

    #[test]
    fn rust_owned_marker_survives_same_status_webview_echo() {
        let stored = vec![json!({
            "id": "todo-rust-created",
            "lifecycle_owner": "rust",
            "rust_owned": true,
            "source": "tui-todo-auto-queue",
            "todo_status": "listed",
            "todo_status_updated_at": "2026-06-11T10:00:00.000Z",
        })];
        let incoming = vec![json!({
            "id": "todo-rust-created",
            "source": "tui-todo-auto-queue",
            "todo_status": "listed",
            "todo_status_updated_at": "2026-06-11T10:05:00.000Z",
        })];
        let merged = todo_store_apply_newer_store_status_core(&stored, incoming);
        assert_eq!(todo_store_item_status(&merged[0]), "listed");
        assert_eq!(merged[0]["rust_owned"], true);
        assert_eq!(merged[0]["lifecycle_owner"], "rust");
        assert!(todo_store_item_is_rust_owned(&merged[0]));
    }

    #[test]
    fn rust_owned_forward_transition_from_webview_is_accepted() {
        // queued → running is a legitimate forward flip; the rank rule only
        // blocks backward movement.
        let stored = vec![json!({
            "id": "remote-1",
            "todo_status": "queued",
            "todo_status_reason": "todo_queue_backend_submit",
            "todo_status_updated_at": "2026-06-11T10:00:00.000Z",
        })];
        let incoming = vec![json!({
            "id": "remote-1",
            "todo_status": "running",
            "todo_status_updated_at": "2026-06-11T10:05:00.000Z",
        })];
        let merged = todo_store_apply_newer_store_status_core(&stored, incoming);
        assert_eq!(todo_store_item_status(&merged[0]), "running");
    }

    #[test]
    fn webview_owned_rows_keep_plain_lww_semantics() {
        // Non-Rust-owned rows are webview property: a fresher listed claim
        // still downgrades queued, exactly as before the rank rule.
        let stored = vec![json!({
            "id": "ui-1",
            "todo_status": "queued",
            "todo_status_updated_at": "2026-06-11T10:00:00.000Z",
        })];
        let incoming = vec![json!({
            "id": "ui-1",
            "todo_status": "listed",
            "todo_status_updated_at": "2026-06-11T10:05:00.000Z",
        })];
        let merged = todo_store_apply_newer_store_status_core(&stored, incoming);
        assert_eq!(todo_store_item_status(&merged[0]), "listed");
    }

    #[test]
    fn settled_retention_keeps_consumed_completed_rows() {
        let stored = vec![
            json!({
                "id": "todo-done",
                "todo_status": "completed",
                "todo_status_updated_at": "2026-06-11T10:00:00.000Z",
            }),
            json!({
                "id": "todo-live",
                "todo_status": "queued",
            }),
        ];
        // The webview's snapshot omits the completed item (it consumed it)
        // and rewrites the live one.
        let incoming = vec![json!({ "id": "todo-live", "todo_status": "queued" })];
        let merged = todo_store_retain_settled_items_core(stored, incoming, &HashSet::new());
        assert_eq!(merged.len(), 2);
        assert!(merged
            .iter()
            .any(|item| item["id"] == "todo-done" && todo_store_item_status(item) == "completed"));
    }

    #[test]
    fn rust_owned_active_rows_survive_webview_snapshot_rewrites() {
        let stored = vec![
            // Direct-prompt capture the webview never adopted: must survive.
            json!({
                "id": "terminal-direct-abc",
                "source": "terminal_direct",
                "todo_status": "running",
                "todo_status_reason": "todo_queue_backend_submit",
            }),
            // Headless remote intake awaiting dispatch: must survive.
            json!({
                "id": "remote-cmd-1",
                "todo_status": "queued",
                "remote_command": { "command_id": "remote-cmd-1", "source": "remote_intake_headless" },
            }),
            // A mounted-webview intake is still created by the Rust store
            // before React observes it. A concurrent stale snapshot must not
            // erase the newly listed row.
            json!({
                "id": "remote-listed-1",
                "todo_status": "listed",
                "lifecycle_owner": "webview",
                "remote_command": { "command_id": "remote-listed-1", "source": "remote_intake_webview" },
            }),
            // Plain webview-owned active row missing from incoming: webview
            // replica is authoritative for these, so it drops.
            json!({ "id": "webview-owned", "todo_status": "queued" }),
        ];
        let incoming = vec![json!({ "id": "other", "todo_status": "listed" })];
        let merged = todo_store_retain_settled_items_core(stored, incoming, &HashSet::new());
        let ids = merged
            .iter()
            .map(|item| item["id"].as_str().unwrap_or_default())
            .collect::<Vec<_>>();
        assert!(ids.contains(&"terminal-direct-abc"));
        assert!(ids.contains(&"remote-cmd-1"));
        assert!(ids.contains(&"remote-listed-1"));
        assert!(ids.contains(&"other"));
        assert!(!ids.contains(&"webview-owned"));
    }

    #[test]
    fn settled_retention_respects_tombstones_and_incoming_claims() {
        let stored = vec![
            json!({ "id": "todo-deleted", "todo_status": "completed" }),
            json!({ "id": "todo-requeued", "todo_status": "interrupted" }),
        ];
        let incoming = vec![json!({ "id": "todo-requeued", "todo_status": "queued" })];
        let tombstoned: HashSet<String> = ["todo-deleted".to_string()].into();
        let merged = todo_store_retain_settled_items_core(stored, incoming, &tombstoned);
        // The tombstoned row stays dead and the re-queued row is not doubled.
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0]["id"], "todo-requeued");
        assert_eq!(todo_store_item_status(&merged[0]), "queued");
    }

    #[test]
    fn history_merge_dedupes_across_id_families_and_enriches() {
        let queue_items = vec![json!({
            "id": "todo-1",
            "text": "ship it",
            "todo_status": "running",
            "todo_status_updated_at": "2026-06-11T10:00:00.000Z",
        })];
        let mirror_items = vec![
            json!({
                "todo_id": "todo-1",
                "last_dispatch_id": "dispatch-9",
                "llm_title": "Ship the release",
                "device_name": "MacBook",
                "status": "queued",
                "updated_at": "2026-06-11T09:00:00.000Z",
            }),
            json!({
                "todo_id": "todo-peer",
                "status": "completed",
                "text": "peer todo",
                "updated_at": "2026-06-11T08:00:00.000Z",
            }),
        ];
        let merged = todo_store_history_merge(queue_items, mirror_items, &HashSet::new());
        assert_eq!(merged.len(), 2);
        let lead = merged
            .iter()
            .find(|item| item["id"] == "todo-1")
            .expect("queue item leads");
        // Device truth wins on status; mirror enrichment grafts display fields.
        assert_eq!(todo_store_item_status(lead), "running");
        assert_eq!(lead["llm_title"], "Ship the release");
        assert_eq!(lead["device_name"], "MacBook");
        assert!(merged.iter().any(|item| item["todo_id"] == "todo-peer"));
    }

    #[test]
    fn history_merge_drops_tombstoned_aliases() {
        let mirror_items = vec![json!({
            "todo_id": "todo-ghost",
            "last_dispatch_id": "dispatch-ghost",
            "status": "running",
        })];
        let tombstoned: HashSet<String> = ["dispatch-ghost".to_string()].into();
        let merged = todo_store_history_merge(Vec::new(), mirror_items, &tombstoned);
        assert!(merged.is_empty());
    }

    #[test]
    fn iso_parse_roundtrips_store_stamps() {
        assert_eq!(
            todo_dispatch_parse_iso_ms("2026-06-11T10:00:00.000Z"),
            Some(1_781_172_000_000),
        );
        assert_eq!(
            todo_dispatch_parse_iso_ms("1970-01-01T00:00:01.250Z"),
            Some(1_250),
        );
        assert!(todo_dispatch_parse_iso_ms("not a date").is_none());
        let now_iso = chrono_like_now_iso();
        let parsed = todo_dispatch_parse_iso_ms(&now_iso).expect("own stamps parse");
        let now_ms = todo_dispatch_now_ms();
        assert!(
            now_ms.abs_diff(parsed) < 5_000,
            "{now_iso} -> {parsed} vs {now_ms}"
        );
    }
}

#[cfg(test)]
mod todo_dispatch_time_tests {
    #[test]
    fn chrono_like_now_iso_is_parseable_iso8601() {
        let value = super::chrono_like_now_iso();
        let bytes = value.as_bytes();
        assert_eq!(bytes.len(), 24, "unexpected length: {value}");
        assert_eq!(bytes[4], b'-');
        assert_eq!(bytes[7], b'-');
        assert_eq!(bytes[10], b'T');
        assert_eq!(bytes[13], b':');
        assert_eq!(bytes[16], b':');
        assert_eq!(bytes[19], b'.');
        assert_eq!(bytes[23], b'Z');
        let year: i32 = value[0..4].parse().unwrap();
        assert!(year >= 2026);
        let month: u32 = value[5..7].parse().unwrap();
        assert!((1..=12).contains(&month));
        let day: u32 = value[8..10].parse().unwrap();
        assert!((1..=31).contains(&day));
    }
}

/// Best-effort headless idle assessment from the activity-hook runtime
/// registry: a pane that last reported input-not-ready is treated as busy.
pub(crate) fn todo_dispatch_workspace_has_busy_terminals(workspace_id: &str) -> bool {
    let registry = TODO_DISPATCH_TERMINAL_RUNTIME.get_or_init(|| StdMutex::new(HashMap::new()));
    let Ok(map) = registry.lock() else {
        return false;
    };
    let now = todo_dispatch_now_ms();
    map.values().any(|entry| {
        entry.get("workspace_id").and_then(Value::as_str) == Some(workspace_id)
            && entry.get("input_ready").and_then(Value::as_bool) == Some(false)
            && entry
                .get("updated_at_ms")
                .and_then(Value::as_u64)
                .is_some_and(|at| now.saturating_sub(at) < TODO_DISPATCH_TERMINAL_RUNTIME_TTL_MS)
    })
}

const TODO_DISPATCH_DIRECT_CAPTURE_EVENT: &str = "todo-dispatch-direct-todo-captured";
const TODO_DISPATCH_DIRECT_CAPTURE_SETTLED_DEDUPE_MS: u64 = 10 * 60 * 1000;

/// Captures a prompt the user typed directly into a coding-agent terminal as
/// a running todo: it lands in the Rust queue store (history truth), the
/// receipts ledger (hook settlement completes it when the turn ends), the
/// journal (a later webview mount adopts it), a live webview event (an open
/// queue panel adopts it immediately and syncs it to cloud), and the cloud
/// snapshot directly when no webview is alive.
/// Mirrors the webview's `getTodoQueueTerminalDirectItemId`: both sides must
/// derive the SAME item id from the prompt event so one direct prompt is one
/// todo everywhere (queue store, journal, receipts, webview item, cloud row).
fn todo_dispatch_direct_prompt_item_id(prompt_event_id: Option<&str>) -> String {
    if let Some(event_id) = prompt_event_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let mut safe = String::new();
        let mut last_was_separator = false;
        for character in event_id.chars() {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | ':' | '-') {
                safe.push(character);
                last_was_separator = false;
            } else if !last_was_separator {
                safe.push('_');
                last_was_separator = true;
            }
            if safe.len() >= 160 {
                break;
            }
        }
        if !safe.is_empty() {
            return format!("terminal-direct-{safe}");
        }
    }
    format!("direct-{}-{}", todo_dispatch_now_ms(), uuid::Uuid::new_v4())
}

fn todo_dispatch_direct_prompt_text_key(prompt: &str) -> String {
    prompt
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(400)
        .collect()
}

fn todo_dispatch_direct_prompt_input_id(prompt_event_id: Option<&str>, prompt: &str) -> String {
    if let Some(prompt_event_id) = prompt_event_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return prompt_event_id.to_string();
    }
    let prompt_key = todo_dispatch_direct_prompt_text_key(prompt);
    if prompt_key.is_empty() {
        format!("direct-input-{}", todo_dispatch_now_ms())
    } else {
        let mut hash: u64 = 0xcbf29ce484222325;
        for byte in prompt_key.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        format!("direct-input-{hash:016x}")
    }
}

fn todo_dispatch_direct_prompt_input_entry(
    prompt: &str,
    prompt_event_id: Option<&str>,
    submitted_at: &str,
    pane_id: &str,
    terminal_index: u64,
    thread_id: &str,
    agent_kind: &str,
) -> Value {
    let prompt_event_id = prompt_event_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let input_id = todo_dispatch_direct_prompt_input_id(prompt_event_id.as_deref(), prompt);
    json!({
        "id": input_id,
        "input_id": input_id,
        "kind": "input",
        "source": "terminal_direct",
        "text": prompt,
        "prompt_event_id": prompt_event_id.clone(),
        "submitted_at": submitted_at,
        "created_at": submitted_at,
        "pane_id": pane_id,
        "target_terminal_id": pane_id,
        "target_terminal_index": terminal_index,
        "thread_id": thread_id,
        "target_thread_id": thread_id,
        "target_agent_id": agent_kind,
    })
}

fn todo_dispatch_value_inputs(value: &Value) -> Vec<Value> {
    for key in ["inputs", "todo_inputs"] {
        if let Some(inputs) = value.get(key).and_then(Value::as_array) {
            return inputs
                .iter()
                .filter(|input| input.is_object())
                .cloned()
                .collect();
        }
    }
    Vec::new()
}

fn todo_dispatch_primary_input_from_value(value: &Value) -> Option<Value> {
    let text = todo_dispatch_text(
        value,
        &[
            "text",
            "todo_text",
            "message",
            "user_message",
            "prompt_text",
            "terminal_prompt",
        ],
    );
    if text.is_empty() {
        return None;
    }
    let submitted_at = todo_dispatch_text(value, &["submitted_at", "created_at", "updated_at"]);
    let submitted_at = if submitted_at.is_empty() {
        chrono_like_now_iso()
    } else {
        submitted_at
    };
    let prompt_event_id = todo_dispatch_text(
        value,
        &[
            "prompt_event_id",
            "prompt_id",
            "pending_prompt_id",
            "provider_turn_id",
            "turn_id",
            "message_id",
        ],
    );
    let pane_id = todo_dispatch_text(value, &["target_terminal_id", "pane_id"]);
    let thread_id = todo_dispatch_text(value, &["target_thread_id", "thread_id"]);
    let agent_kind = todo_dispatch_text(value, &["target_agent_id", "agent_id"]);
    let terminal_index = value
        .get("target_terminal_index")
        .or_else(|| value.get("terminal_index"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    Some(todo_dispatch_direct_prompt_input_entry(
        &text,
        (!prompt_event_id.is_empty()).then_some(prompt_event_id.as_str()),
        &submitted_at,
        &pane_id,
        terminal_index,
        &thread_id,
        &agent_kind,
    ))
}

fn todo_dispatch_set_value_inputs(value: &mut Value, inputs: Vec<Value>) {
    if let Some(object) = value.as_object_mut() {
        object.insert("inputs".to_string(), json!(inputs));
        object.insert(
            "input_count".to_string(),
            json!(object
                .get("inputs")
                .and_then(Value::as_array)
                .map(|items| items.len())
                .unwrap_or(0)),
        );
        if let Some(inputs) = object.get("inputs").cloned() {
            object.insert("todo_inputs".to_string(), inputs);
        }
    }
}

fn todo_dispatch_append_input_to_value(value: &mut Value, input: &Value) -> bool {
    if !value.is_object() || !input.is_object() {
        return false;
    }
    let prompt_event_id =
        todo_dispatch_text(input, &["prompt_event_id", "prompt_id", "input_id", "id"]);
    let prompt_text = todo_dispatch_text(input, &["text", "message", "prompt_text"]);
    let mut inputs = todo_dispatch_value_inputs(value);
    let mut changed = false;
    if inputs.is_empty() {
        if let Some(primary) = todo_dispatch_primary_input_from_value(value) {
            inputs.push(primary);
            changed = true;
        }
    }
    let duplicate = inputs.iter().any(|existing| {
        if !prompt_event_id.is_empty() {
            todo_dispatch_prompt_identity_matches_value(existing, &prompt_event_id, "")
        } else {
            todo_dispatch_prompt_identity_matches_value(existing, "", &prompt_text)
        }
    });
    if duplicate {
        if changed {
            todo_dispatch_set_value_inputs(value, inputs);
        }
        return changed;
    }
    inputs.push(input.clone());
    todo_dispatch_set_value_inputs(value, inputs);
    true
}

fn todo_dispatch_find_recent_settled_direct_prompt(
    items: &[Value],
    pane_id: &str,
    prompt: &str,
    now_ms: u64,
) -> Option<Value> {
    let prompt_key = todo_dispatch_direct_prompt_text_key(prompt);
    if prompt_key.is_empty() {
        return None;
    }
    items
        .iter()
        .find(|item| {
            if !todo_store_item_is_rust_owned(item) {
                return false;
            }
            let status = todo_store_item_status(item);
            if !TODO_STORE_SETTLED_RETENTION_STATUSES.contains(&status.as_str()) {
                return false;
            }
            let item_pane_id = todo_store_item_pane_id(item);
            if !pane_id.trim().is_empty() && item_pane_id != pane_id.trim() {
                return false;
            }
            let item_text_key =
                todo_dispatch_direct_prompt_text_key(&todo_dispatch_text(item, &["text"]));
            if item_text_key != prompt_key {
                return false;
            }
            let updated_ms = todo_store_item_updated_ms(item);
            updated_ms > 0
                && now_ms.saturating_sub(updated_ms)
                    <= TODO_DISPATCH_DIRECT_CAPTURE_SETTLED_DEDUPE_MS
        })
        .cloned()
}

fn todo_dispatch_direct_prompt_agent_kind(agent_kind: &str) -> Option<&'static str> {
    let key = agent_kind
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '-', '_'], "");
    if key.contains("codex") {
        return Some("codex");
    }
    if key.contains("claude") {
        return Some("claude");
    }
    if key.contains("opencode") {
        return Some("opencode");
    }
    None
}

pub(crate) fn todo_dispatch_capture_direct_prompt_todo(
    app: &AppHandle,
    workspace_id: &str,
    workspace_name: &str,
    pane_id: &str,
    terminal_index: u64,
    thread_id: &str,
    agent_kind: &str,
    prompt: &str,
    prompt_event_id: Option<&str>,
    item_id_override: Option<&str>,
) -> Option<String> {
    let workspace_id = workspace_id.trim();
    let pane_id = pane_id.trim();
    let prompt = prompt.trim();
    if workspace_id.is_empty() || prompt.is_empty() {
        return None;
    }
    if todo_dispatch_is_app_control_terminal_surface(workspace_id, pane_id) {
        log_terminal_status_event(
            "backend.todo_dispatch.direct_capture_app_control_skip",
            json!({
                "agent_kind": agent_kind.chars().take(80).collect::<String>(),
                "pane_id": pane_id,
                "prompt_len": prompt.len(),
                "workspace_id": workspace_id,
            }),
        );
        return None;
    }
    // Only managed coding agents: shell terminals would turn every command
    // line into a phantom todo.
    let Some(canonical_agent_kind) = todo_dispatch_direct_prompt_agent_kind(agent_kind) else {
        log_terminal_status_event(
            "backend.todo_dispatch.direct_capture_unsupported_agent_skip",
            json!({
                "agent_kind": agent_kind.chars().take(80).collect::<String>(),
                "pane_id": pane_id,
                "prompt_len": prompt.len(),
                "workspace_id": workspace_id,
            }),
        );
        return None;
    };
    let now_ms = todo_dispatch_now_ms();
    let now_iso = chrono_like_now_iso();
    // Typed prompts arrive with the item id the webview already minted for
    // this submission; converging on it keeps webview/store/cloud at ONE row.
    let item_id = item_id_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| todo_dispatch_direct_prompt_item_id(prompt_event_id));
    let prompt_event_id_value = prompt_event_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if todo_store_tombstone_ids(workspace_id).contains(&item_id) {
        // The user already deleted this exact prompt's todo: never re-create.
        return None;
    }
    let input_entry = todo_dispatch_direct_prompt_input_entry(
        prompt,
        prompt_event_id_value.as_deref(),
        &now_iso,
        pane_id,
        terminal_index,
        thread_id,
        canonical_agent_kind,
    );
    let item = json!({
        "id": item_id,
        "kind": "todo",
        "text": prompt,
        "inputs": [input_entry.clone()],
        "todo_inputs": [input_entry.clone()],
        "input_count": 1,
        "todo_status": "running",
        "status": "running",
        // The stamp gives the running status LWW teeth against webview
        // snapshot echoes; the forward-only rank rule is the backstop.
        "todo_status_updated_at": now_iso,
        // Backend-submit reason routes the item through the existing Rust
        // ledger settlement machinery (crash sweep exclusion, drain reconcile).
        "todo_status_reason": "todo_queue_backend_submit",
        "source": "terminal_direct",
        "prompt_event_id": prompt_event_id_value.clone(),
        "created_at": now_iso,
        "updated_at": now_iso,
        "workspace_id": workspace_id,
        "target_terminal_id": pane_id,
        "target_terminal_index": terminal_index,
        "target_thread_id": thread_id,
        "target_agent_id": canonical_agent_kind,
    });
    let unkeyed_hook_capture = item_id_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
        && prompt_event_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none();
    let mut capture_item = item.clone();
    if let Some(path) = todo_dispatch_data_path("queues", workspace_id) {
        let _store_guard = todo_dispatch_queue_store_guard();
        let mut items = todo_dispatch_queue_read(&path)
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if unkeyed_hook_capture {
            if let Some(existing) =
                todo_dispatch_find_recent_settled_direct_prompt(&items, pane_id, prompt, now_ms)
            {
                let existing_id = existing
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(item_id.as_str())
                    .to_string();
                log_terminal_status_event(
                    "backend.todo_dispatch.direct_capture_settled_duplicate_skip",
                    json!({
                        "item_id": existing_id,
                        "pane_id": pane_id,
                        "prompt_len": prompt.len(),
                        "workspace_id": workspace_id,
                    }),
                );
                return Some(existing_id);
            }
        }
        // Ids are deterministic per prompt event now, so a second observer of
        // the same prompt converges on the existing row instead of doubling.
        // When the webview's materialization landed first (its copy carries
        // no lifecycle status), graft the running flip onto that row so the
        // prompt never sits status-less in history while the agent works.
        let mut wrote = false;
        let mut sync_item: Option<Value> = None;
        let active_parent_index = items
            .iter()
            .enumerate()
            .filter(|(_, existing)| {
                todo_dispatch_queue_item_owns_terminal_input(existing)
                    && todo_store_item_pane_id(existing) == pane_id
                    && !todo_store_item_matches_id(existing, &item_id)
            })
            .map(|(index, existing)| (todo_store_item_updated_ms(existing), index))
            .max_by_key(|(updated_ms, _)| *updated_ms)
            .map(|(_, index)| index);
        if let Some(parent_index) = active_parent_index {
            let parent_command_id;
            let parent_item_id;
            {
                let parent = &mut items[parent_index];
                parent_command_id = todo_dispatch_queue_item_command_id(parent);
                parent_item_id = parent
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(parent_command_id.as_str())
                    .to_string();
                if let Some(object) = parent.as_object_mut() {
                    object.insert("updated_at".to_string(), json!(now_iso.clone()));
                    object.insert("updated_at_ms".to_string(), json!(now_ms));
                    object.insert(
                        "last_prompt_event_id".to_string(),
                        json!(prompt_event_id_value.clone()),
                    );
                    object.insert("last_input_at".to_string(), json!(now_iso.clone()));
                }
                let _ = todo_dispatch_append_input_to_value(parent, &input_entry);
                capture_item = parent.clone();
            }
            todo_dispatch_queue_write(workspace_id, &items);
            todo_store_orphan_sweep_trigger("terminal_direct_input_appended");
            todo_store_push_items(
                app,
                workspace_id,
                vec![capture_item.clone()],
                "terminal_direct_input_appended",
            );
            let mut receipt = todo_dispatch_load(workspace_id)
                .get(&parent_command_id)
                .cloned()
                .unwrap_or_else(|| {
                    json!({
                        "command_id": parent_command_id,
                        "item_id": parent_item_id,
                        "pane_id": pane_id,
                        "status": "running",
                        "text": todo_dispatch_text(&capture_item, &["text"]),
                        "workspace_id": workspace_id,
                        "workspace_name": workspace_name,
                    })
                });
            if let Some(object) = receipt.as_object_mut() {
                object.insert("command_id".to_string(), json!(parent_command_id.clone()));
                object.insert("item_id".to_string(), json!(parent_item_id.clone()));
                object.insert("pane_id".to_string(), json!(pane_id));
                object.insert("status".to_string(), json!("running"));
                object.insert("updated_at".to_string(), json!(now_iso.clone()));
                object.insert(
                    "last_prompt_event_id".to_string(),
                    json!(prompt_event_id_value.clone()),
                );
                object.insert("last_input_at".to_string(), json!(now_iso.clone()));
            }
            let _ = todo_dispatch_append_input_to_value(&mut receipt, &input_entry);
            let _ = todo_dispatch_record_receipt_internal(
                Some(app),
                workspace_id,
                receipt,
                "terminal_direct_input_appended",
            );
            todo_dispatch_journal_append(
                workspace_id,
                json!({
                    "kind": "remote_todo_updated",
                    "item_id": parent_item_id,
                    "command_id": parent_command_id,
                    "item": capture_item,
                    "at": now_iso,
                    "reason": "terminal_direct_input_appended",
                }),
            );
            let _ = app.emit(
                TODO_DISPATCH_DIRECT_CAPTURE_EVENT,
                json!({
                    "workspace_id": workspace_id,
                    "item": capture_item,
                    "appended_input": input_entry,
                }),
            );
            todo_store_emit_changed(app, workspace_id, "terminal_direct_input_appended", "store");
            if !todo_dispatch_webview_dispatcher_active() {
                todo_dispatch_push_queue_snapshot(
                    app,
                    workspace_id,
                    Vec::new(),
                    "terminal_direct_input_appended",
                );
            }
            log_terminal_status_event(
                "backend.todo_dispatch.direct_capture_input_appended",
                json!({
                    "item_id": parent_item_id,
                    "pane_id": pane_id,
                    "prompt_event_id": prompt_event_id_value.as_deref().unwrap_or_default(),
                    "prompt_len": prompt.len(),
                    "workspace_id": workspace_id,
                }),
            );
            return Some(parent_item_id);
        }
        if let Some(existing) = items
            .iter_mut()
            .find(|existing| todo_store_item_matches_id(existing, &item_id))
        {
            let existing_status = todo_store_item_status(existing);
            if TODO_STORE_SETTLED_RETENTION_STATUSES.contains(&existing_status.as_str()) {
                log_terminal_status_event(
                    "backend.todo_dispatch.direct_capture_settled_id_skip",
                    json!({
                        "item_id": item_id,
                        "pane_id": pane_id,
                        "prompt_len": prompt.len(),
                        "status": existing_status,
                        "workspace_id": workspace_id,
                    }),
                );
                return Some(item_id);
            }
            let inputs_changed = todo_dispatch_append_input_to_value(existing, &input_entry);
            if todo_store_status_rank(&existing_status) < todo_store_status_rank("running") {
                todo_store_set_item_status(existing, "running", "todo_queue_backend_submit");
                sync_item = Some(existing.clone());
                capture_item = existing.clone();
                wrote = true;
            } else {
                if inputs_changed {
                    if let Some(object) = existing.as_object_mut() {
                        object.insert("updated_at".to_string(), json!(now_iso.clone()));
                        object.insert("updated_at_ms".to_string(), json!(now_ms));
                    }
                    sync_item = Some(existing.clone());
                    wrote = true;
                }
                capture_item = existing.clone();
            }
        } else {
            items.push(item.clone());
            sync_item = Some(item.clone());
            wrote = true;
        }
        if wrote {
            todo_dispatch_queue_write(workspace_id, &items);
            todo_store_orphan_sweep_trigger("terminal_direct_submit");
            if let Some(sync_item) = sync_item {
                todo_store_push_items(app, workspace_id, vec![sync_item], "terminal_direct_submit");
            }
        }
    }
    todo_dispatch_journal_append(
        workspace_id,
        json!({
            "kind": "remote_todo_created",
            "item_id": item_id,
            "command_id": item_id,
            "item": capture_item,
            "at": now_iso,
        }),
    );
    let receipt = json!({
        "command_id": item_id,
        "item_id": item_id,
        "pane_id": pane_id,
        "prompt_event_id": prompt_event_id_value.clone(),
        "submitted_at": now_iso,
        "status": "running",
        "text": prompt.chars().take(180).collect::<String>(),
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
    });
    let _ = todo_dispatch_record_receipt_internal(
        Some(app),
        workspace_id,
        receipt,
        "terminal_direct_submit",
    );
    let _ = app.emit(
        TODO_DISPATCH_DIRECT_CAPTURE_EVENT,
        json!({
            "workspace_id": workspace_id,
            "item": capture_item,
        }),
    );
    // History views refresh on store changes; without this the direct todo
    // only appears after the next poll tick.
    todo_store_emit_changed(app, workspace_id, "terminal_direct_submit", "store");
    if !todo_dispatch_webview_dispatcher_active() {
        todo_dispatch_push_queue_snapshot(app, workspace_id, Vec::new(), "terminal_direct_submit");
    }
    Some(item_id)
}

/// Last hook-reported input-ready state for one pane (None when the pane has
/// no fresh registry entry — for example a plain shell with no agent hooks).
pub(crate) fn todo_dispatch_pane_input_ready(pane_id: &str) -> Option<bool> {
    let registry = TODO_DISPATCH_TERMINAL_RUNTIME.get_or_init(|| StdMutex::new(HashMap::new()));
    let map = registry.lock().ok()?;
    let entry = map.get(pane_id)?;
    let updated_at = entry.get("updated_at_ms").and_then(Value::as_u64)?;
    if todo_dispatch_now_ms().saturating_sub(updated_at) >= TODO_DISPATCH_TERMINAL_RUNTIME_TTL_MS {
        return None;
    }
    entry.get("input_ready").and_then(Value::as_bool)
}

fn todo_dispatch_core_terminal_ready_for_submit(
    runtime: &TerminalRuntimeSnapshot,
    _projected: &TerminalProjectedRuntime,
    parked: bool,
) -> Option<bool> {
    Some(!parked && todo_dispatch_runtime_is_canonical_idle(runtime))
}

fn todo_dispatch_runtime_is_canonical_idle(runtime: &TerminalRuntimeSnapshot) -> bool {
    runtime.terminal_state_contract_version == 1
        && runtime.canonical_state == "idle"
        && !runtime.turn_active
        && runtime.completed_turn_generation == runtime.turn_generation
        && runtime.active_interaction_id.is_none()
        && runtime.canonical_state_seq > 0
}

fn todo_dispatch_runtime_matches_queue_target(
    runtime: &TerminalRuntimeSnapshot,
    expected_canonical_state_seq: u64,
    expected_provider_session_id: Option<&str>,
) -> bool {
    let expected_provider_session_id = expected_provider_session_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let current_provider_session_id = runtime
        .provider_session_id
        .as_deref()
        .or(runtime.native_session_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let session_is_current = current_provider_session_id == expected_provider_session_id;
    todo_dispatch_runtime_is_canonical_idle(runtime)
        && runtime.canonical_state_seq == expected_canonical_state_seq
        && session_is_current
}

fn todo_dispatch_refresh_terminal_runtime_from_core(
    pane_id: &str,
    instance: &TerminalInstance,
    runtime: &TerminalRuntimeSnapshot,
    projected: &TerminalProjectedRuntime,
    input_ready: bool,
) {
    let pane_id = pane_id.trim();
    if pane_id.is_empty() {
        return;
    }
    let metadata = instance.metadata.clone();
    let registry = TODO_DISPATCH_TERMINAL_RUNTIME.get_or_init(|| StdMutex::new(HashMap::new()));
    if let Ok(mut map) = registry.lock() {
        map.insert(
            pane_id.to_string(),
            json!({
                "terminal_state_contract_version": runtime.terminal_state_contract_version,
                "canonical_state": runtime.canonical_state.clone(),
                "canonical_badge_label": runtime.canonical_badge_label.clone(),
                "canonical_state_seq": runtime.canonical_state_seq,
                "prompt_state_seq": runtime.prompt_state_seq,
                "turn_active": runtime.turn_active,
                "turn_generation": runtime.turn_generation,
                "completed_turn_generation": runtime.completed_turn_generation,
                "active_interaction_id": runtime.active_interaction_id.clone(),
                "active_interaction_revision": runtime.active_interaction_revision,
                "interaction_actionable": runtime.interaction_actionable,
                "activity_status": runtime.activity_status.clone(),
                "agent_id": metadata.agent_id.clone(),
                "agent_kind": metadata.agent_kind.clone(),
                "command_phase": runtime.command_phase.clone(),
                "completed_at": runtime.completed_at.clone(),
                "display_name": projected.display_name.clone(),
                "event_type": runtime.event_type.clone(),
                "input_ready": input_ready,
                "input_ready_at": runtime.input_ready_at.clone(),
                "instance_id": instance.id,
                "pane_id": pane_id,
                "pending_prompt_id": runtime.provider_turn_id.clone().or(runtime.turn_id.clone()),
                "prompt_ready_at": runtime.prompt_ready_at.clone(),
                "provider_session_id": runtime.provider_session_id.clone(),
                "provider_turn_id": runtime.provider_turn_id.clone(),
                "readiness": projected.readiness.clone(),
                "status": runtime.status.clone(),
                "terminal_index": metadata.terminal_index,
                "terminal_name": projected.terminal_name.clone(),
                "terminal_nickname": projected.terminal_nickname.clone(),
                "terminal_status": projected.terminal_status.clone(),
                "terminal_work_state": projected.terminal_work_state.clone(),
                "thread_id": metadata.thread_id.clone(),
                "updated_at_ms": todo_dispatch_now_ms(),
                "workspace_id": metadata.workspace_id.trim(),
                "workspace_name": metadata.workspace_name.trim(),
            }),
        );
    }
}

async fn todo_dispatch_pane_input_ready_authoritative(
    app: &AppHandle,
    pane_id: &str,
    target_instance_id: u64,
) -> Option<bool> {
    let pane_id = pane_id.trim();
    if pane_id.is_empty() {
        return None;
    }
    let registry_ready = todo_dispatch_pane_input_ready(pane_id);
    let terminal_state = app.state::<TerminalState>();
    let instance = {
        let guard = terminal_state.terminals.read().await;
        guard
            .get(pane_id)
            .filter(|instance| target_instance_id == 0 || instance.id == target_instance_id)
            .cloned()
    };
    let Some(instance) = instance else {
        return registry_ready;
    };
    let parked = {
        let guard = terminal_state.parked_prompts.read().await;
        guard
            .values()
            .any(|prompt| prompt.pane_id == pane_id && prompt.instance_id == instance.id)
    };
    let runtime = terminal_runtime_snapshot(&instance);
    let projected = terminal_project_runtime(&instance.metadata, &runtime, parked);
    if let Some(core_ready) =
        todo_dispatch_core_terminal_ready_for_submit(&runtime, &projected, parked)
    {
        todo_dispatch_refresh_terminal_runtime_from_core(
            pane_id, &instance, &runtime, &projected, core_ready,
        );
        return Some(core_ready);
    }

    registry_ready
}

async fn todo_dispatch_wait_for_pane_input_ready_after_model(
    app: &AppHandle,
    pane_id: &str,
    target_instance_id: u64,
) -> bool {
    let deadline =
        todo_dispatch_now_ms().saturating_add(TODO_DISPATCH_MODEL_SWITCH_INPUT_READY_TIMEOUT_MS);
    loop {
        match todo_dispatch_pane_input_ready_authoritative(app, pane_id, target_instance_id).await {
            Some(true) => return true,
            Some(false) => {
                if todo_dispatch_now_ms() >= deadline {
                    return false;
                }
            }
            None => {
                if todo_dispatch_now_ms() >= deadline {
                    return true;
                }
            }
        }
        sleep(Duration::from_millis(150)).await;
    }
}

pub(crate) fn todo_dispatch_webview_dispatcher_active() -> bool {
    let heartbeat = TODO_DISPATCH_WEBVIEW_HEARTBEAT_MS.load(Ordering::Acquire);
    heartbeat != 0
        && todo_dispatch_now_ms().saturating_sub(heartbeat) < TODO_DISPATCH_DISPATCHER_LEASE_MS
}

/// Headless local convergence marker after a Rust-side queue mutation.
/// Account sync is handled by the supported todo sync contracts.
fn todo_dispatch_push_queue_snapshot(
    app: &AppHandle,
    workspace_id: &str,
    removed_todo_ids: Vec<String>,
    reason: &str,
) {
    let Some(path) = todo_dispatch_data_path("queues", workspace_id) else {
        return;
    };
    let snapshot = todo_dispatch_queue_read(&path);
    let items = snapshot
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if items.is_empty() && removed_todo_ids.is_empty() {
        return;
    }
    todo_store_push_items(app, workspace_id, items.clone(), reason);
    if !removed_todo_ids.is_empty() {
        todo_store_enqueue_delete_todo_sync_commit(
            app,
            workspace_id,
            &removed_todo_ids,
            reason,
            "todo_dispatch_push_queue_snapshot",
            TodoStoreDeleteMode::Tombstone,
        );
    }
    log_terminal_status_event(
        "backend.todo_dispatch.cloud_snapshot_enqueued",
        json!({
            "item_count": items.len(),
            "reason": reason,
            "removed_count": removed_todo_ids.len(),
            "workspace_id": workspace_id,
        }),
    );
}

/// Headless remote todo delete: applied directly to the Rust queue store so
fn todo_dispatch_remote_delete_expected_status(event: &Value) -> String {
    let expected = todo_dispatch_text(
        event,
        &[
            "expected_status",
            "expected_todo_status",
            "todo_status",
            "mode",
            "status",
        ],
    );
    let normalized = todo_store_normalize_lifecycle_status(&expected);
    if normalized.is_empty() {
        "listed".to_string()
    } else {
        normalized
    }
}

fn todo_dispatch_remote_delete_field_matches(
    item: &Value,
    event: &Value,
    event_keys: &[&str],
    item_keys: &[&str],
) -> bool {
    let expected = todo_dispatch_text(event, event_keys);
    if expected.is_empty() {
        return true;
    }
    todo_dispatch_text(item, item_keys) == expected
}

fn todo_dispatch_remote_delete_binding_matches(item: &Value, event: &Value) -> bool {
    todo_dispatch_remote_delete_field_matches(
        item,
        event,
        &["expected_target_terminal_id", "target_terminal_id"],
        &["target_terminal_id", "pane_id", "terminal_id"],
    ) && todo_dispatch_remote_delete_field_matches(
        item,
        event,
        &["expected_target_thread_id", "target_thread_id"],
        &["target_thread_id", "thread_id"],
    ) && todo_dispatch_remote_delete_field_matches(
        item,
        event,
        &["expected_dispatch_id", "dispatch_id", "last_dispatch_id"],
        &["last_dispatch_id", "dispatch_id"],
    ) && todo_dispatch_remote_delete_field_matches(
        item,
        event,
        &["expected_command_id"],
        &["command_id", "id"],
    )
}

fn todo_dispatch_remote_delete_reject_details(
    event: &Value,
    workspace_id: &str,
    todo_id: &str,
    reason: &str,
    item: Option<&Value>,
) -> Value {
    let current_status = item.map(todo_store_item_status).unwrap_or_default();
    json!({
        "reason": reason,
        "workspace_id": workspace_id,
        "todo_id": todo_id,
        "intent_id": todo_dispatch_text(event, &["intent_id"]),
        "expected_status": todo_dispatch_remote_delete_expected_status(event),
        "current_status": current_status,
        "current": item.cloned().unwrap_or(Value::Null),
    })
}

/// the lever works with the window closed; the journal entry reconciles any
/// mounted webview replica. Deletes are guarded by the state the requester saw:
/// stale web deletes are rejected and Rust publishes its current todo instead.
pub(crate) fn todo_dispatch_apply_remote_delete(app: &AppHandle, event: &Value) -> Option<Value> {
    let command_kind = todo_dispatch_text(event, &["command_kind", "action", "command"])
        .to_ascii_lowercase()
        .replace(['.', ' ', '-'], "_");
    if !matches!(
        command_kind.as_str(),
        "workspace_todo_delete"
            | "todo_delete"
            | "delete_todo"
            | "delete_task"
            | "remote_todo_delete"
    ) {
        return None;
    }
    let workspace_id = todo_dispatch_text(event, &["workspace_id"]);
    let todo_id = todo_dispatch_text(event, &["todo_id", "item_id"]);
    if workspace_id.is_empty() || todo_id.is_empty() {
        return Some(json!({
            "status": "failed",
            "message": "Remote todo delete was missing workspace or todo id.",
            "details": todo_dispatch_remote_delete_reject_details(event, &workspace_id, &todo_id, "missing_scope", None),
        }));
    }
    let _store_guard = todo_dispatch_queue_store_guard();
    let tombstoned = todo_store_tombstone_ids(&workspace_id);
    if tombstoned.contains(todo_id.as_str()) {
        return Some(json!({
            "status": "completed",
            "message": "Remote todo delete was already applied.",
            "details": todo_dispatch_remote_delete_reject_details(event, &workspace_id, &todo_id, "already_deleted", None),
        }));
    }
    let items = todo_dispatch_data_path("queues", &workspace_id)
        .as_deref()
        .map(|path| {
            todo_dispatch_queue_read(path)
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        })
        .unwrap_or_default();
    let item = items
        .iter()
        .find(|item| todo_store_item_matches_id(item, &todo_id))
        .cloned();
    let Some(item) = item else {
        let details = todo_dispatch_remote_delete_reject_details(
            event,
            &workspace_id,
            &todo_id,
            "not_found",
            None,
        );
        return Some(json!({
            "status": "rejected",
            "message": "Remote todo delete was rejected because Rust no longer has that listed todo.",
            "details": details,
        }));
    };
    let expected_status = todo_dispatch_remote_delete_expected_status(event);
    let requested_delete_mode =
        todo_dispatch_remote_delete_mode(event).unwrap_or(TodoStoreDeleteMode::Tombstone);
    let current_status = todo_store_item_status(&item);
    let current_status = if current_status.is_empty() {
        "listed".to_string()
    } else {
        current_status
    };
    let status_matches = match expected_status.as_str() {
        "listed" | "open" | "todo" => matches!(current_status.as_str(), "listed" | "open" | "todo"),
        "queued" | "pending" | "requested" => {
            matches!(current_status.as_str(), "queued" | "pending" | "requested")
                && todo_dispatch_remote_delete_binding_matches(&item, event)
        }
        value => {
            current_status == value && todo_dispatch_remote_delete_binding_matches(&item, event)
        }
    };
    let terminal_state = todo_store_item_has_terminal_touch_evidence(&item)
        || matches!(
            current_status.as_str(),
            "running"
                | "sending"
                | "submitted"
                | "dispatching"
                | "dispatched"
                | "completed"
                | "failed"
                | "cancelled"
                | "interrupted"
        );
    if !status_matches || terminal_state {
        todo_store_enqueue_item_todo_sync_commit(
            app,
            &workspace_id,
            item.clone(),
            "remote_todo_delete_rejected",
            "rust-diffforge-todo-store",
        );
        let reason = if terminal_state {
            "state_changed"
        } else {
            "guard_mismatch"
        };
        let details = todo_dispatch_remote_delete_reject_details(
            event,
            &workspace_id,
            &todo_id,
            reason,
            Some(&item),
        );
        return Some(json!({
            "status": "rejected",
            "message": "Remote todo delete was rejected because Rust has a newer todo state.",
            "details": details,
        }));
    }
    // One funnel for accepted deletes: hard-delete unsent rows, tombstone
    // terminal-touched rows, update the queue store, and sync Rust truth.
    let delete_result = todo_store_delete_internal_with_mode(
        app,
        &workspace_id,
        &[todo_id.clone()],
        "remote_todo_delete",
        "remote_command",
        Some(requested_delete_mode),
    );
    Some(json!({
        "status": "completed",
        "message": "Remote todo delete was accepted by Rust.",
        "details": {
            "reason": "accepted",
            "delete_mode": requested_delete_mode.as_str(),
            "removed": delete_result.removed_ids,
            "deleted_ids": delete_result.removed_ids,
            "hard_deleted_ids": delete_result.hard_deleted_ids,
            "tombstoned_ids": delete_result.tombstoned_ids,
            "workspace_id": workspace_id,
            "todo_id": todo_id,
            "intent_id": todo_dispatch_text(event, &["intent_id"]),
        },
    }))
}

#[tauri::command(rename_all = "snake_case")]
fn todo_dispatch_dispatcher_heartbeat(app: AppHandle) -> Result<Value, String> {
    let now = todo_dispatch_now_ms();
    let previous = TODO_DISPATCH_WEBVIEW_HEARTBEAT_MS.swap(now, Ordering::AcqRel);
    todo_dispatch_note_startup_reconciliation_evidence(&app, "webview_heartbeat");
    // Webview just came (back) alive: replay remote commands that were
    // deferred while no webview could actuate them (for example terminal
    // relaunches requested via voice/dashboard in background mode).
    let was_stale =
        previous == 0 || now.saturating_sub(previous) >= TODO_DISPATCH_DISPATCHER_LEASE_MS;
    if was_stale {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            // Give the webview's remote-command listener time to subscribe.
            sleep(Duration::from_secs(3)).await;
            todo_dispatch_flush_deferred_remote_commands(&app);
        });
    } else if CLOUD_MCP_REMOTE_COMMAND_HANDOFF_PENDING.load(Ordering::Acquire) {
        // A successful handler removes its journal entry. Re-emitting any
        // entry that remains lets a transient local ack failure retry without
        // waiting for an app restart; AppShell dedupes in-flight handlers and
        // only acknowledges duplicates already known to have completed.
        todo_dispatch_flush_deferred_remote_commands(&app);
    }
    let mut payload = todo_dispatch_startup_reconcile_payload("webview_heartbeat");
    if let Some(object) = payload.as_object_mut() {
        object.insert("webview_dispatcher_resumed".to_string(), json!(was_stale));
    }
    Ok(payload)
}

#[tauri::command(rename_all = "snake_case")]
fn todo_dispatch_dispatcher_ready(app: AppHandle) -> Result<Value, String> {
    TODO_DISPATCH_WEBVIEW_HEARTBEAT_MS.store(todo_dispatch_now_ms(), Ordering::Release);
    todo_dispatch_note_startup_reconciliation_evidence(&app, "webview_dispatcher_ready");
    // This call is made only after AppShell's event listener is installed, so
    // it is a stronger delivery signal than a visibility/focus heartbeat.
    todo_dispatch_flush_deferred_remote_commands(&app);
    let mut payload = todo_dispatch_startup_reconcile_payload("webview_dispatcher_ready");
    if let Some(object) = payload.as_object_mut() {
        object.insert("webview_dispatcher_ready".to_string(), json!(true));
    }
    Ok(payload)
}

#[tauri::command(rename_all = "snake_case")]
fn todo_dispatch_startup_reconciliation_state() -> Result<Value, String> {
    Ok(todo_dispatch_startup_reconcile_payload("get"))
}

pub(crate) fn todo_dispatch_flush_deferred_remote_commands(app: &AppHandle) {
    let pending = {
        let lock = CLOUD_MCP_REMOTE_COMMAND_HANDOFF_LOCK.get_or_init(|| StdMutex::new(()));
        let Ok(_guard) = lock.lock() else {
            return;
        };
        let intents = app_local_state_read(app, CLOUD_MCP_REMOTE_COMMAND_HANDOFF_STATE_KEY);
        intents
            .get("pendingRemoteCommands")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    if pending.is_empty() {
        CLOUD_MCP_REMOTE_COMMAND_HANDOFF_PENDING.store(false, Ordering::Release);
        return;
    }
    CLOUD_MCP_REMOTE_COMMAND_HANDOFF_PENDING.store(true, Ordering::Release);
    // Keep commands journaled until the mounted AppShell handler finishes the
    // command without an unhandled exception. Tauri emit success alone does
    // not prove that any JavaScript listener consumed or applied the event.
    for event in pending {
        let _ = app.emit(CLOUD_MCP_REMOTE_COMMAND_EVENT, event);
    }
}

fn todo_dispatch_ack_deferred_remote_commands(
    pending: Vec<Value>,
    command_id: &str,
) -> (Vec<Value>, bool) {
    let command_id = command_id.trim();
    if command_id.is_empty() {
        return (pending, false);
    }
    let before = pending.len();
    let pending = pending
        .into_iter()
        .filter(|event| todo_dispatch_text(event, &["command_id"]) != command_id)
        .collect::<Vec<_>>();
    let acknowledged = pending.len() != before;
    (pending, acknowledged)
}

#[tauri::command(rename_all = "snake_case")]
fn todo_dispatch_ack_deferred_remote_command(
    app: AppHandle,
    command_id: String,
) -> Result<Value, String> {
    let command_id = command_id.trim();
    if command_id.is_empty() {
        return Err("command_id is required".to_string());
    }
    let lock = CLOUD_MCP_REMOTE_COMMAND_HANDOFF_LOCK.get_or_init(|| StdMutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "remote command handoff lock is poisoned".to_string())?;
    let intents = app_local_state_read(&app, CLOUD_MCP_REMOTE_COMMAND_HANDOFF_STATE_KEY);
    let pending = intents
        .get("pendingRemoteCommands")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let (remaining, acknowledged) = todo_dispatch_ack_deferred_remote_commands(pending, command_id);
    if acknowledged {
        app_local_state_merge(
            &app,
            CLOUD_MCP_REMOTE_COMMAND_HANDOFF_STATE_KEY,
            &json!({
                "pendingRemoteCommands": if remaining.is_empty() {
                    Value::Null
                } else {
                    Value::Array(remaining.clone())
                },
            }),
        )?;
    }
    CLOUD_MCP_REMOTE_COMMAND_HANDOFF_PENDING.store(!remaining.is_empty(), Ordering::Release);
    Ok(json!({
        "acknowledged": acknowledged,
        "command_id": command_id,
        "pending_count": remaining.len(),
    }))
}

#[tauri::command(rename_all = "snake_case")]
async fn todo_dispatch_queue_sync(
    app: AppHandle,
    workspace_id: String,
    items: Value,
    reason: Option<String>,
    removed_ids: Option<Vec<String>>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _store_guard = todo_dispatch_queue_store_guard();
        let workspace_id = workspace_id.trim().to_string();
        if workspace_id.is_empty() {
            return Err("workspace_id is required.".to_string());
        }
        let reason = reason.unwrap_or_default();
        // Webview removals use the same Rust-authoritative delete funnel as
        // direct deletes, so Cloud and peers see the tombstone immediately.
        let removed_ids = removed_ids
            .unwrap_or_default()
            .into_iter()
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty())
            .collect::<Vec<_>>();
        let mut locally_removed_ids = Vec::new();
        if !removed_ids.is_empty() {
            let delete_result = todo_store_delete_internal(
                &app,
                &workspace_id,
                &removed_ids,
                &reason,
                "webview_sync",
            );
            locally_removed_ids.extend(delete_result.removed_ids);
        }
        let mut tombstoned = todo_store_tombstone_ids(&workspace_id);
        tombstoned.extend(locally_removed_ids);
        let items = items
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|item| item.is_object())
            .collect::<Vec<_>>();
        let (items, rejected_ids) = todo_store_filter_tombstoned(items, &tombstoned);
        let items = todo_store_canonicalize_settled_items(items);
        let stored_items = todo_dispatch_data_path("queues", &workspace_id)
            .map(|path| {
                todo_dispatch_queue_read(&path)
                    .get("items")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        let stored_items = todo_store_canonicalize_settled_items(stored_items);
        let previous_items = stored_items.clone();
        let items = todo_store_sanitize_webview_snapshot_lifecycle(&stored_items, items);
        let items = todo_store_keep_settled_sweep_flips_core(stored_items.clone(), items);
        // Status LWW: deliberate flips made through the store (history
        // Queue/Unqueue/retarget) outrank stale webview claims by stamp.
        let items = todo_store_apply_newer_store_status_core(&stored_items, items);
        // History retention: settled rows the webview consumed from its
        // visible list (completed todos above all) survive the full-snapshot
        // rewrite so Todos History keeps showing them.
        let items = todo_store_retain_settled_items_core(stored_items, items, &tombstoned);
        let changed_items = todo_store_changed_items_for_sync(&previous_items, &items);
        todo_dispatch_queue_write(&workspace_id, &items);
        todo_store_orphan_sweep_trigger("todo_dispatch_queue_sync");
        todo_store_push_items(&app, &workspace_id, changed_items, &reason);
        // Origin "webview": the webview's own changed-listener skips these to
        // avoid sync feedback loops; other windows still refresh.
        todo_store_emit_changed(&app, &workspace_id, &reason, "webview");
        Ok(json!({
            "workspace_id": workspace_id,
            "item_count": items.len(),
            "rejected_ids": rejected_ids,
            "reason": reason,
        }))
    })
    .await
    .map_err(|error| format!("Todo dispatch queue sync worker failed: {error}"))?
}

/// Returns and clears the backend-submission journal for a workspace so the
/// restored webview can reconcile statuses and thread state.
#[tauri::command(rename_all = "snake_case")]
async fn todo_dispatch_backend_submissions_drain(workspace_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = todo_dispatch_data_path("journal", &workspace_id) else {
            return Ok(json!({ "entries": [] }));
        };
        let entries = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<Value>>(&raw).ok())
            .unwrap_or_default();
        if !entries.is_empty() {
            let _ = fs::write(&path, b"[]");
        }
        // Tombstones are terminal: a creation entry for a later-deleted todo
        // must never be re-adopted by the restored webview (this was the ghost
        // "delete it and it comes back listed" path).
        let tombstoned = todo_store_tombstone_ids(&workspace_id);
        let entries = entries
            .into_iter()
            .filter(|entry| {
                let kind = entry
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !matches!(kind, "remote_todo_created" | "remote_todo_updated") {
                    return true;
                }
                let item_id = entry
                    .get("item_id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .unwrap_or_default();
                !tombstoned.contains(item_id)
            })
            .collect::<Vec<_>>();
        Ok(json!({ "entries": entries, "workspace_id": workspace_id }))
    })
    .await
    .map_err(|error| format!("Todo dispatch journal drain worker failed: {error}"))?
}

/// Full queue snapshot for one workspace, as last pushed by the webview (or
/// updated by backend dispatch/settlement). This is the local-first source
/// the Todos History view reads so listed todos show without any cloud
/// round-trip.
#[tauri::command(rename_all = "snake_case")]
async fn todo_dispatch_queue_get(workspace_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_id = workspace_id.trim().to_string();
        if workspace_id.is_empty() {
            return Err("workspace_id is required.".to_string());
        }
        if todo_dispatch_workspace_is_deleted(&workspace_id) {
            return Ok(json!({
                "workspace_id": workspace_id,
                "items": [],
                "updated_at_ms": todo_dispatch_now_ms(),
            }));
        }
        let snapshot = todo_dispatch_data_path("queues", &workspace_id)
            .map(|path| todo_dispatch_queue_read(&path))
            .unwrap_or_else(|| json!({}));
        let items = todo_store_canonicalize_settled_items(
            snapshot
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        );
        Ok(json!({
            "workspace_id": workspace_id,
            "items": items,
            "updated_at_ms": snapshot.get("updated_at_ms").cloned().unwrap_or(json!(0)),
        }))
    })
    .await
    .map_err(|error| format!("Todo dispatch queue get worker failed: {error}"))?
}

/// Aggregated view of every workspace queue snapshot for the background
/// monitor window: items grouped by lifecycle bucket with workspace labels
/// resolved best-effort from the terminal runtime registry.
#[tauri::command(rename_all = "snake_case")]
async fn todo_dispatch_overview() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let workspace_names = TODO_DISPATCH_TERMINAL_RUNTIME
            .get_or_init(|| StdMutex::new(HashMap::new()))
            .lock()
            .map(|map| {
                map.values()
                    .filter_map(|entry| {
                        let workspace_id = entry.get("workspace_id").and_then(Value::as_str)?;
                        let workspace_name = entry
                            .get("workspace_name")
                            .and_then(Value::as_str)
                            .filter(|value| !value.trim().is_empty())?;
                        Some((workspace_id.to_string(), workspace_name.to_string()))
                    })
                    .collect::<HashMap<_, _>>()
            })
            .unwrap_or_default();
        let mut workspaces = Vec::new();
        let mut running = 0usize;
        let mut queued = 0usize;
        let mut listed = 0usize;
        let deleted_workspace_ids = cloud_mcp_deleted_workspace_ids();
        for path in todo_dispatch_data_workspace_files("queues") {
            let snapshot = todo_dispatch_queue_read(&path);
            let workspace_id = snapshot
                .get("workspace_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default()
                .to_string();
            if workspace_id.is_empty() {
                continue;
            }
            if deleted_workspace_ids.contains(&workspace_id) {
                continue;
            }
            let tombstoned = todo_store_tombstone_ids(&workspace_id);
            let (kept_items, _) = todo_store_filter_tombstoned(
                snapshot
                    .get("items")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
                &tombstoned,
            );
            let items = todo_store_canonicalize_settled_items(kept_items)
                .into_iter()
                .map(|item| {
                    let status = match todo_store_item_status(&item).as_str() {
                        "" => "listed".to_string(),
                        value => value.to_string(),
                    };
                    let bucket = match status.as_str() {
                        "running" | "sending" | "submitted" | "paused" => "running",
                        "queued" => "queued",
                        "listed" | "" => "listed",
                        _ => "finished",
                    };
                    match bucket {
                        "running" => running += 1,
                        "queued" => queued += 1,
                        "listed" => listed += 1,
                        _ => {}
                    }
                    json!({
                        "bucket": bucket,
                        "id": item.get("id").cloned().unwrap_or(Value::Null),
                        "status": status,
                        "target_terminal_index": item.get("target_terminal_index").cloned().unwrap_or(Value::Null),
                        "text": item
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .chars()
                            .take(180)
                            .collect::<String>(),
                        "updated_at": item.get("updated_at").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect::<Vec<_>>();
            if items.is_empty() {
                continue;
            }
            workspaces.push(json!({
                "items": items,
                "workspace_id": workspace_id.clone(),
                "workspace_name": workspace_names.get(&workspace_id).cloned().unwrap_or_default(),
            }));
        }
        Ok(json!({
            "counts": { "listed": listed, "queued": queued, "running": running },
            "updated_at_ms": todo_dispatch_now_ms(),
            "workspaces": workspaces,
        }))
    })
    .await
    .map_err(|error| format!("Todo dispatch overview worker failed: {error}"))?
}

fn todo_dispatch_backend_item_text(item: &Value) -> String {
    let text = item
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let note_text = item
        .get("note")
        .and_then(|note| note.get("text").or_else(|| note.get("body")))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    match (text.is_empty(), note_text.is_empty()) {
        (false, false) => format!("{text}\n\n{note_text}"),
        (false, true) => text.to_string(),
        (true, false) => note_text.to_string(),
        (true, true) => String::new(),
    }
}

fn todo_dispatch_attachment_warning_block(refs: &[ChatAttachmentRef]) -> String {
    refs.iter()
        .enumerate()
        .map(|(index, attachment)| {
            format!(
                "[attachment {} unavailable]",
                chat_attachment_display_name(attachment, index)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn todo_dispatch_append_attachment_blocks(
    text: &str,
    marker_block: &str,
    warning_block: &str,
) -> String {
    [text.trim(), marker_block.trim(), warning_block.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[derive(Clone, Debug)]
struct TodoDispatchPreparedPrompt {
    text: String,
    attachments: Vec<SavedTodoImageAttachment>,
    requested_attachment_count: usize,
    failed_attachment_count: usize,
    cloud_acked: bool,
    cloud_ack_error: String,
    staging_elapsed_ms: u64,
}

impl TodoDispatchPreparedPrompt {
    fn text_only(text: String) -> Self {
        Self {
            text,
            attachments: Vec::new(),
            requested_attachment_count: 0,
            failed_attachment_count: 0,
            cloud_acked: false,
            cloud_ack_error: String::new(),
            staging_elapsed_ms: 0,
        }
    }

    fn has_content(&self) -> bool {
        !self.text.trim().is_empty() || !self.attachments.is_empty()
    }
}

fn todo_dispatch_attachment_ref_log_summary(attachments: &[ChatAttachmentRef]) -> Value {
    Value::Array(
        attachments
            .iter()
            .enumerate()
            .map(|(index, attachment)| {
                let sha256 = normalized_chat_attachment_sha(&attachment.sha256);
                json!({
                    "attachment_id": sanitized_chat_attachment_id(&attachment.attachment_id),
                    "bytes": attachment.bytes,
                    "mime": normalized_chat_attachment_mime(&attachment.mime),
                    "name": clean_terminal_diagnostic_log_text(&chat_attachment_display_name(attachment, index)),
                    "sha256_prefix": sha256.chars().take(12).collect::<String>(),
                })
            })
            .collect(),
    )
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

async fn todo_dispatch_backend_item_text_with_remote_attachments(
    item: &Value,
    workspace_id: &str,
) -> TodoDispatchPreparedPrompt {
    let text = todo_dispatch_backend_item_text(item);
    todo_dispatch_text_with_remote_attachments(text, item, workspace_id).await
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
    let started_at_ms = todo_dispatch_now_ms();
    log_terminal_status_event(
        "backend.todo_dispatch.attachments_stage_start",
        json!({
            "attachment_count": attachments.len(),
            "attachments": todo_dispatch_attachment_ref_log_summary(&attachments),
            "workspace_id": workspace_id,
        }),
    );
    let request = ChatAttachmentStageRequest {
        workspace_id: workspace_id.trim().to_string(),
        attachments: attachments.clone(),
        ack_cloud: true,
        marker_start_index: 0,
    };
    match timeout(
        Duration::from_secs(30),
        tauri::async_runtime::spawn_blocking(move || {
            stage_chat_attachment_refs_for_dispatch(request)
        }),
    )
    .await
    {
        Ok(Ok(result)) => {
            let elapsed_ms = todo_dispatch_now_ms().saturating_sub(started_at_ms);
            let prepared = TodoDispatchPreparedPrompt {
                // Successful attachments are injected through the terminal's
                // bracketed-paste channel and become native composer image
                // parts. Only failed attachment warnings belong in text.
                text: todo_dispatch_append_attachment_blocks(&text, "", &result.warning_block),
                attachments: result.attachments,
                requested_attachment_count: attachments.len(),
                failed_attachment_count: result.failed.len(),
                cloud_acked: result.cloud_acked,
                cloud_ack_error: result.cloud_ack_error,
                staging_elapsed_ms: elapsed_ms,
            };
            log_terminal_status_event(
                "backend.todo_dispatch.attachments_stage_ready",
                json!({
                    "attachment_count": prepared.requested_attachment_count,
                    "cloud_ack_error": clean_terminal_diagnostic_log_text(&prepared.cloud_ack_error),
                    "cloud_acked": prepared.cloud_acked,
                    "elapsed_ms": prepared.staging_elapsed_ms,
                    "failed_count": prepared.failed_attachment_count,
                    "staged": todo_dispatch_staged_attachment_log_summary(&prepared.attachments),
                    "staged_count": prepared.attachments.len(),
                    "workspace_id": workspace_id,
                }),
            );
            prepared
        }
        Ok(Err(error)) => {
            let elapsed_ms = todo_dispatch_now_ms().saturating_sub(started_at_ms);
            log_terminal_status_event(
                "backend.todo_dispatch.attachments_stage_failed",
                json!({
                    "attachment_count": attachments.len(),
                    "elapsed_ms": elapsed_ms,
                    "error": clean_terminal_diagnostic_log_text(&error.to_string()),
                    "reason": "stage_error",
                    "workspace_id": workspace_id,
                }),
            );
            TodoDispatchPreparedPrompt {
                text: todo_dispatch_append_attachment_blocks(
                    &text,
                    "",
                    &format!(
                        "{}\n[attachment staging unavailable: {}]",
                        todo_dispatch_attachment_warning_block(&attachments),
                        error
                    ),
                ),
                attachments: Vec::new(),
                requested_attachment_count: attachments.len(),
                failed_attachment_count: attachments.len(),
                cloud_acked: false,
                cloud_ack_error: String::new(),
                staging_elapsed_ms: elapsed_ms,
            }
        }
        Err(_) => {
            let elapsed_ms = todo_dispatch_now_ms().saturating_sub(started_at_ms);
            log_terminal_status_event(
                "backend.todo_dispatch.attachments_stage_failed",
                json!({
                    "attachment_count": attachments.len(),
                    "elapsed_ms": elapsed_ms,
                    "reason": "timeout",
                    "workspace_id": workspace_id,
                }),
            );
            TodoDispatchPreparedPrompt {
                text: todo_dispatch_append_attachment_blocks(
                    &text,
                    "",
                    &format!(
                        "{}\n[attachment staging unavailable: timed out]",
                        todo_dispatch_attachment_warning_block(&attachments)
                    ),
                ),
                attachments: Vec::new(),
                requested_attachment_count: attachments.len(),
                failed_attachment_count: attachments.len(),
                cloud_acked: false,
                cloud_ack_error: String::new(),
                staging_elapsed_ms: elapsed_ms,
            }
        }
    }
}

fn todo_dispatch_native_attachment_paste_sequence(
    attachments: &[SavedTodoImageAttachment],
) -> String {
    attachments
        .iter()
        .filter_map(|attachment| {
            let path = attachment.path.trim();
            if path.is_empty() || path.chars().any(char::is_control) {
                None
            } else {
                // Codex, Claude Code, and OpenCode receive terminal paste as a
                // bracketed-paste event. Supplying the verified local image
                // path this way makes their composers create native image
                // parts (for example `[Image #1]`) instead of prompt text.
                Some(format!("\u{1b}[200~{path}\u{1b}[201~ "))
            }
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

fn todo_dispatch_prepared_text_fallback(prepared: &TodoDispatchPreparedPrompt) -> String {
    todo_dispatch_append_attachment_blocks(
        &prepared.text,
        &format_saved_todo_image_attachment_markers(&prepared.attachments, 0),
        "",
    )
}

fn todo_dispatch_attachment_model_support(agent: &str, model: &str) -> &'static str {
    if todo_dispatch_backend_agent_id(agent) != "opencode" {
        return "supported";
    }
    match opencode_model_supports_images(model) {
        Some(true) => "supported",
        Some(false) => "text_only",
        None => "unknown",
    }
}

fn todo_dispatch_backend_agent_id(value: &str) -> String {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.contains("claude") {
        return "claude".to_string();
    }
    if normalized.contains("codex") {
        return "codex".to_string();
    }
    if normalized.contains("opencode") || normalized.contains("open-code") {
        return "opencode".to_string();
    }
    normalized
}

fn todo_dispatch_backend_agent_is_queueable(value: &str) -> bool {
    matches!(
        todo_dispatch_backend_agent_id(value).as_str(),
        "codex" | "claude" | "opencode"
    )
}

fn todo_dispatch_backend_agent_value(value: &Value, keys: &[&str]) -> String {
    todo_dispatch_backend_agent_id(&todo_dispatch_text(value, keys))
}

fn todo_dispatch_backend_target_agent(item: &Value, target: &Value) -> String {
    [
        todo_dispatch_text(target, &["agent_kind"]),
        todo_dispatch_text(target, &["agent_id", "provider", "target_agent_id"]),
        todo_dispatch_text(item, &["target_agent_id", "agent_id"]),
    ]
    .into_iter()
    .map(|value| todo_dispatch_backend_agent_id(&value))
    .find(|value| !value.is_empty())
    .unwrap_or_default()
}

fn todo_dispatch_backend_entry_agent_is_queueable(entry: &Value) -> bool {
    let agent = todo_dispatch_backend_agent_value(entry, &["agent_id", "agent_kind", "provider"]);
    !agent.is_empty() && todo_dispatch_backend_agent_is_queueable(&agent)
}

fn todo_dispatch_backend_submit_sequence(item: &Value, target: &Value) -> &'static str {
    let agent = todo_dispatch_backend_target_agent(item, target);
    if agent.contains("codex") {
        TERMINAL_ENTER_SEQUENCE
    } else {
        TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE
    }
}

fn todo_dispatch_canonical_model_id(agent: &str, model: &str) -> String {
    let model = model.trim();
    if model.is_empty() {
        return String::new();
    }
    let agent = todo_dispatch_backend_agent_id(agent);
    let mut normalized = String::new();
    let mut previous_dash = false;
    for character in model.chars().flat_map(char::to_lowercase) {
        let mapped = if character.is_ascii_alphanumeric() || character == '.' {
            Some(character)
        } else if matches!(character, '-' | '_' | ':' | '/' | ' ') {
            Some('-')
        } else {
            None
        };
        let Some(mapped) = mapped else {
            continue;
        };
        if mapped == '-' {
            if !previous_dash && !normalized.is_empty() {
                normalized.push(mapped);
                previous_dash = true;
            }
        } else {
            normalized.push(mapped);
            previous_dash = false;
        }
    }
    let normalized = normalized.trim_matches('-').to_string();
    let model_id = ["anthropic-", "claude-", "openai-", "codex-"]
        .iter()
        .find_map(|prefix| normalized.strip_prefix(prefix))
        .unwrap_or(&normalized);

    if agent.contains("claude")
        || model_id.contains("sonnet")
        || model_id.contains("opus")
        || model_id.contains("haiku")
    {
        if model_id.contains("sonnet") {
            return "claude:sonnet".to_string();
        }
        if model_id.contains("opus") {
            return "claude:opus".to_string();
        }
        if model_id.contains("haiku") {
            return "claude:haiku".to_string();
        }
    }

    if agent.contains("codex") || model_id.contains("gpt") {
        if model_id.contains("gpt-5.5")
            || model_id.contains("gpt-5-5")
            || model_id.contains("gpt55")
        {
            return "codex:gpt-5.5".to_string();
        }
        return format!("codex:{model_id}");
    }

    format!("{agent}:{model_id}")
}

fn todo_dispatch_canonical_model_equal(agent: &str, left: &str, right: &str) -> bool {
    let left = todo_dispatch_canonical_model_id(agent, left);
    let right = todo_dispatch_canonical_model_id(agent, right);
    !left.is_empty() && left == right
}

fn todo_dispatch_backend_model_command(item: &Value, target: &Value) -> String {
    let agent = todo_dispatch_backend_target_agent(item, target);
    if !agent.contains("codex") && !agent.contains("claude") {
        return String::new();
    }
    let model = todo_dispatch_text(item, &["model", "model_id"]);
    let current_model = todo_dispatch_text(target, &["current_model", "model_id", "model"]);
    let effort = todo_dispatch_text(item, &["reasoning_effort", "thinking_power", "effort"])
        .to_ascii_lowercase();
    let current_effort = todo_dispatch_text(
        target,
        &[
            "current_reasoning_effort",
            "reasoning_effort",
            "thinking_power",
            "effort",
        ],
    )
    .to_ascii_lowercase();
    let valid_codex_effort =
        agent.contains("codex") && matches!(effort.as_str(), "low" | "medium" | "high" | "xhigh");
    if model.is_empty() || model.len() > 120 {
        return String::new();
    }
    if !current_model.is_empty()
        && todo_dispatch_canonical_model_equal(&agent, &current_model, &model)
    {
        if !valid_codex_effort || (!current_effort.is_empty() && current_effort == effort) {
            return String::new();
        }
    }
    if !model.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '/' | '-')
    }) {
        return String::new();
    }
    if agent.contains("codex") {
        // Codex's TUI treats an inline `/model <id>` as ordinary prompt text.
        // The caller drives its native picker with the requested model/effort
        // instead; returning the bare command here makes that distinction
        // impossible to accidentally regress into a chat submission.
        return "/model".to_string();
    }
    format!("/model {model}")
}

fn todo_dispatch_backend_codex_model_picker(
    item: &Value,
    target: &Value,
) -> Option<(String, Option<String>)> {
    let agent = todo_dispatch_backend_target_agent(item, target);
    if !agent.contains("codex") || todo_dispatch_backend_model_command(item, target) != "/model" {
        return None;
    }
    let model = todo_dispatch_text(item, &["model", "model_id"]);
    let effort = todo_dispatch_text(item, &["reasoning_effort", "thinking_power", "effort"])
        .to_ascii_lowercase();
    let effort = matches!(effort.as_str(), "low" | "medium" | "high" | "xhigh").then_some(effort);
    Some((model, effort))
}

#[cfg(test)]
mod todo_dispatch_backend_tests {
    use super::*;

    #[test]
    fn deferred_remote_commands_remain_until_exact_ui_handler_ack() {
        let pending = vec![
            json!({ "command_id": "activate-one", "command_kind": "workspace_activate" }),
            json!({
                "payload": {
                    "command_id": "activate-two",
                    "command_kind": "workspace_activate"
                }
            }),
        ];

        let (unchanged, acknowledged) =
            todo_dispatch_ack_deferred_remote_commands(pending.clone(), "missing");
        assert!(!acknowledged);
        assert_eq!(unchanged, pending);

        let (remaining, acknowledged) =
            todo_dispatch_ack_deferred_remote_commands(pending, "activate-two");
        assert!(acknowledged);
        assert_eq!(remaining.len(), 1);
        assert_eq!(
            todo_dispatch_text(&remaining[0], &["command_id"]),
            "activate-one"
        );
    }

    #[test]
    fn hook_managed_backend_targets_normalize_agent_names_and_submit_sequences() {
        assert_eq!(todo_dispatch_backend_agent_id("Claude Code"), "claude");
        assert_eq!(todo_dispatch_backend_agent_id("open-code"), "opencode");
        assert_eq!(todo_dispatch_backend_agent_id("OpenAI Codex"), "codex");
        assert!(todo_dispatch_backend_agent_is_queueable("OpenAI Codex"));
        assert!(todo_dispatch_backend_agent_is_queueable("Claude Code"));
        assert!(todo_dispatch_backend_agent_is_queueable("open-code"));
        assert!(!todo_dispatch_backend_agent_is_queueable("shell"));
        assert!(!todo_dispatch_backend_agent_is_queueable("generic"));

        let codex_item =
            json!({ "id": "todo-codex", "text": "ship it", "target_agent_id": "OpenAI Codex" });
        let claude_item =
            json!({ "id": "todo-claude", "text": "ship it", "target_agent_id": "Claude Code" });
        let generic_target = json!({});

        assert_eq!(
            todo_dispatch_backend_submit_sequence(&codex_item, &generic_target),
            TERMINAL_ENTER_SEQUENCE,
        );
        assert_eq!(
            todo_dispatch_backend_submit_sequence(&claude_item, &generic_target),
            TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE,
        );
    }

    #[test]
    fn dispatch_attachment_refs_parse_payload_and_remote_command() {
        let event = json!({
            "payload": {
                "attachments": [
                    {
                        "attachment_id": "att-1",
                        "sha256": "A".repeat(64),
                        "bytes": "120",
                        "mime": "image/png",
                        "name": "one.png"
                    },
                    {
                        "attachment_id": "att-duplicate",
                        "sha256": "a".repeat(64),
                        "bytes": 120,
                        "mime_type": "image/png",
                        "name": "duplicate.png"
                    }
                ]
            }
        });
        let refs = todo_dispatch_chat_attachment_refs(&event);
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].attachment_id, "att-1");
        assert_eq!(refs[0].sha256, "A".repeat(64));

        let item = json!({
            "remote_command": {
                "attachments": [{
                    "id": "att-remote",
                    "hash": "b".repeat(64),
                    "size_bytes": 64,
                    "type": "image/webp",
                    "file_name": "remote.webp"
                }]
            }
        });
        let refs = todo_dispatch_chat_attachment_refs(&item);
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].attachment_id, "att-remote");
        assert_eq!(refs[0].mime, "image/webp");

        let nested_request = json!({
            "payload": {
                "request": {
                    "workspace_id": "workspace-nested",
                    "attachments": [{
                        "id": "att-nested",
                        "sha256": "d".repeat(64),
                        "bytes": 32,
                        "mime": "image/gif",
                        "name": "nested.gif"
                    }]
                }
            }
        });
        let refs = todo_dispatch_chat_attachment_refs(&nested_request);
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].attachment_id, "att-nested");
        assert_eq!(
            todo_dispatch_text(&nested_request, &["workspace_id"]),
            "workspace-nested"
        );
    }

    #[test]
    fn dispatch_attachment_prompt_blocks_keep_markers_and_unavailable_lines() {
        assert_eq!(
            todo_dispatch_append_attachment_blocks(
                "ship it",
                "[image-attached 1] one.png -> /tmp/one.png",
                "[attachment lost.png unavailable]",
            ),
            "ship it\n\n[image-attached 1] one.png -> /tmp/one.png\n\n[attachment lost.png unavailable]",
        );

        let warning = todo_dispatch_attachment_warning_block(&[ChatAttachmentRef {
            attachment_id: "att-lost".to_string(),
            sha256: "c".repeat(64),
            bytes: 1,
            mime: "image/png".to_string(),
            name: "lost.png".to_string(),
        }]);
        assert_eq!(
            todo_dispatch_append_attachment_blocks("text only", "", &warning),
            "text only\n\n[attachment lost.png unavailable]",
        );
    }

    #[test]
    fn dispatch_native_images_use_bracketed_paste_not_visible_markers() {
        let prepared = TodoDispatchPreparedPrompt {
            text: "inspect these".to_string(),
            attachments: vec![
                SavedTodoImageAttachment {
                    name: "one.png".to_string(),
                    mime_type: "image/png".to_string(),
                    path: "/tmp/one.png".to_string(),
                },
                SavedTodoImageAttachment {
                    name: "two.webp".to_string(),
                    mime_type: "image/webp".to_string(),
                    path: "/tmp/two.webp".to_string(),
                },
            ],
            requested_attachment_count: 2,
            failed_attachment_count: 0,
            cloud_acked: true,
            cloud_ack_error: String::new(),
            staging_elapsed_ms: 4,
        };

        assert_eq!(
            todo_dispatch_prepared_terminal_input(&prepared, "\r"),
            "\u{1b}[200~/tmp/one.png\u{1b}[201~ \u{1b}[200~/tmp/two.webp\u{1b}[201~ inspect these\r",
        );
        assert!(!todo_dispatch_prepared_terminal_input(&prepared, "\r").contains("[image-attached"));
        assert_eq!(
            todo_dispatch_attachment_model_support("codex", ""),
            "supported"
        );
        assert_eq!(
            todo_dispatch_attachment_model_support("claude", ""),
            "supported"
        );
        assert_eq!(
            todo_dispatch_attachment_model_support("opencode", "gpt-4o"),
            "supported"
        );
        assert_eq!(
            todo_dispatch_attachment_model_support("opencode", "deepseek-v3"),
            "text_only"
        );
    }

    #[test]
    fn backend_model_command_includes_codex_effort() {
        let codex_target = json!({ "agent_kind": "codex" });
        let codex_item = json!({
            "model": "gpt-5.1-codex",
            "reasoning_effort": "high",
        });
        assert_eq!(
            todo_dispatch_backend_model_command(&codex_item, &codex_target),
            "/model",
        );
        assert_eq!(
            todo_dispatch_backend_codex_model_picker(&codex_item, &codex_target),
            Some(("gpt-5.1-codex".to_string(), Some("high".to_string()))),
        );

        let claude_target = json!({ "agent_kind": "claude" });
        let claude_item = json!({
            "model": "sonnet-4.6",
            "reasoning_effort": "high",
        });
        assert_eq!(
            todo_dispatch_backend_model_command(&claude_item, &claude_target),
            "/model sonnet-4.6",
        );

        let current_model_target = json!({
            "agent_kind": "codex",
            "current_model": "gpt-5.1-codex",
            "current_reasoning_effort": "high",
        });
        assert_eq!(
            todo_dispatch_backend_model_command(&codex_item, &current_model_target),
            "",
        );

        let claude_alias_target = json!({
            "agent_kind": "claude",
            "current_model": "Sonnet 5",
        });
        let claude_alias_item = json!({
            "model": "claude-sonnet-5",
        });
        assert_eq!(
            todo_dispatch_backend_model_command(&claude_alias_item, &claude_alias_target),
            "",
        );

        let codex_alias_target = json!({
            "agent_kind": "codex",
            "current_model": "gpt 5.5",
        });
        let codex_alias_item = json!({
            "model": "openai/gpt-5-5",
            "reasoning_effort": "xhigh",
        });
        assert_eq!(
            todo_dispatch_backend_model_command(&codex_alias_item, &codex_alias_target),
            "/model",
        );

        let codex_alias_same_effort_target = json!({
            "agent_kind": "codex",
            "current_model": "gpt 5.5",
            "current_reasoning_effort": "xhigh",
        });
        assert_eq!(
            todo_dispatch_backend_model_command(&codex_alias_item, &codex_alias_same_effort_target,),
            "",
        );
    }

    #[test]
    fn remote_intake_defaults_missing_status_to_queued() {
        let intake_status = todo_dispatch_normalize_status("");
        assert_eq!(intake_status, "queued");
        assert!(todo_dispatch_backend_item_dispatchable(&json!({
            "id": "command-1",
            "status": intake_status,
            "text": "ship it",
        })));
    }

    #[test]
    fn remote_intake_applies_explicit_queued_status_as_queued() {
        let event = json!({
            "todo_status": "queued",
        });
        let intake_status = todo_dispatch_remote_intake_status(&event);
        let mut item = json!({"id": "todo-queued"});
        todo_store_set_item_status(&mut item, &intake_status, "remote_todo_intake");

        assert_eq!(intake_status, "queued");
        assert_eq!(todo_store_item_status(&item), "queued");
    }

    #[test]
    fn message_intent_ack_is_deferred_until_post_injection() {
        let event = json!({
            "command_kind": "todo_queue",
            "action_kind": "message",
            "client_action_id": "client-action-message-1",
        });

        assert!(todo_dispatch_remote_command_is_message_intent(&event));
        assert_eq!(
            cloud_mcp_remote_todo_intake_ack_action_kind(&event, false),
            None
        );
        assert_eq!(
            todo_dispatch_post_injection_message_ack_kind(&event, false),
            None
        );
        assert_eq!(
            todo_dispatch_post_injection_message_ack_kind(&event, true),
            Some("message")
        );
        assert_eq!(
            todo_dispatch_text(&event, &["client_action_id"]),
            "client-action-message-1"
        );

        let explicit_todo = json!({
            "command_kind": "send_message",
            "action_kind": "todo",
            "client_action_id": "client-action-todo-1",
        });
        assert!(!todo_dispatch_remote_command_is_message_intent(
            &explicit_todo
        ));
        assert_eq!(
            cloud_mcp_remote_todo_intake_ack_action_kind(&explicit_todo, false),
            Some("todo")
        );
    }

    #[test]
    fn backend_target_picker_resolves_index_name_and_thread_without_terminal_id() {
        let entries = vec![
            json!({
                "agent_id": "codex",
                "pane_id": "pane-a",
                "terminal_index": 0,
                "terminal_name": "Codex Primary",
                "thread_id": "thread-a",
            }),
            json!({
                "agent_id": "claude",
                "pane_id": "pane-b",
                "terminal_index": 1,
                "terminal_nickname": "Build Claude",
                "thread_id": "thread-b",
            }),
        ];

        assert_eq!(
            todo_dispatch_backend_pick_target_from_entries(
                &entries,
                &json!({ "target_thread_id": "thread-b" }),
            )
            .map(|entry| todo_dispatch_text(&entry, &["pane_id"])),
            Some("pane-b".to_string()),
        );
        assert_eq!(
            todo_dispatch_backend_pick_target_from_entries(
                &entries,
                &json!({ "target_terminal_index": 1 }),
            )
            .map(|entry| todo_dispatch_text(&entry, &["pane_id"])),
            Some("pane-b".to_string()),
        );
        assert_eq!(
            todo_dispatch_backend_pick_target_from_entries(
                &entries,
                &json!({ "target_terminal_name": " build   claude " }),
            )
            .map(|entry| todo_dispatch_text(&entry, &["pane_id"])),
            Some("pane-b".to_string()),
        );
        assert_eq!(
            todo_dispatch_backend_pick_target_from_entries(
                &entries,
                &json!({ "target_terminal_id": "pane-b", "target_terminal_index": 0 }),
            )
            .map(|entry| todo_dispatch_text(&entry, &["pane_id"])),
            Some("pane-b".to_string()),
        );
        assert!(todo_dispatch_backend_pick_target_from_entries(
            &entries,
            &json!({ "target_terminal_id": "missing-pane", "target_terminal_index": 0 }),
        )
        .is_none());
    }

    #[test]
    fn todo_store_retains_terminal_assignment_fields_without_terminal_id() {
        let mut generic = json!({
            "id": "todo-generic",
            "target_explicit": true,
            "target_terminal_index": 2,
            "target_terminal_name": "orange terminal",
            "target_thread_id": "thread-2",
            "target_terminal_color": "#ff9d48",
            "remote_command": {
                "target_terminal_index": 2,
                "target_thread_id": "thread-2"
            }
        });
        todo_store_enforce_terminal_id_assignment(&mut generic);
        assert_eq!(generic["target_terminal_index"], 2);
        assert_eq!(generic["target_terminal_name"], "orange terminal");
        assert_eq!(generic["target_thread_id"], "thread-2");
        assert_eq!(generic["target_explicit"], true);
        assert_eq!(generic["remote_command"]["target_terminal_index"], 2);
        assert_eq!(generic["remote_command"]["target_thread_id"], "thread-2");

        let mut targeted = json!({
            "id": "todo-targeted",
            "target_terminal_id": "pane-2",
            "target_terminal_index": 2,
        });
        todo_store_enforce_terminal_id_assignment(&mut targeted);
        assert_eq!(targeted["target_terminal_id"], "pane-2");
        assert_eq!(targeted["target_terminal_index"], 2);
        assert_eq!(targeted["target_explicit"], true);
    }

    #[test]
    fn backend_target_picker_accepts_swarm_without_terminal_entries() {
        let target = todo_dispatch_backend_pick_target_from_entries(
            &[],
            &json!({
                "target_kind": "swarm",
                "target_swarm_id": "swarm-workspace-s1",
                "target_terminal_id": "swarm-pane",
            }),
        )
        .unwrap();
        assert_eq!(todo_dispatch_text(&target, &["target_kind"]), "swarm");
        assert_eq!(
            todo_dispatch_text(&target, &["target_swarm_id"]),
            "swarm-workspace-s1"
        );
        assert_eq!(todo_dispatch_text(&target, &["pane_id"]), "swarm-pane");
    }

    #[test]
    fn swarm_run_status_maps_to_todo_settlement_status() {
        assert_eq!(
            todo_dispatch_swarm_run_status_to_todo_status("done"),
            "completed"
        );
        assert_eq!(
            todo_dispatch_swarm_run_status_to_todo_status("cancelled"),
            "cancelled"
        );
        assert_eq!(
            todo_dispatch_swarm_run_status_to_todo_status("error"),
            "failed"
        );
        assert_eq!(
            todo_dispatch_swarm_run_status_to_todo_status("failed"),
            "failed"
        );
    }

    #[test]
    fn direct_prompt_capture_accepts_coding_agent_aliases_and_running_receipts() {
        assert_eq!(
            todo_dispatch_direct_prompt_agent_kind("OpenAI Codex"),
            Some("codex")
        );
        assert_eq!(
            todo_dispatch_direct_prompt_agent_kind("Claude Code"),
            Some("claude")
        );
        assert_eq!(
            todo_dispatch_direct_prompt_agent_kind("open-code"),
            Some("opencode")
        );
        assert_eq!(todo_dispatch_direct_prompt_agent_kind("bash"), None);
        assert_eq!(todo_dispatch_normalize_status("running"), "running");
        assert_eq!(todo_dispatch_normalize_status("listed"), "listed");
        assert!(todo_dispatch_status_is_active("running"));
    }

    fn backend_submit_runtime(
        status: &str,
        activity_status: &str,
        command_phase: &str,
        input_ready: bool,
    ) -> TerminalRuntimeSnapshot {
        TerminalRuntimeSnapshot {
            terminal_state_contract_version: 1,
            canonical_state: if activity_status == "idle" {
                "idle"
            } else {
                "thinking"
            }
            .to_string(),
            canonical_badge_label: if activity_status == "idle" {
                "idle"
            } else {
                "thinking"
            }
            .to_string(),
            canonical_state_seq: 1,
            prompt_state_seq: 0,
            turn_generation: if activity_status == "idle" { 0 } else { 1 },
            completed_turn_generation: 0,
            turn_active: activity_status != "idle",
            active_interaction_id: None,
            active_interaction_revision: None,
            interaction_actionable: false,
            status: status.to_string(),
            activity_status: activity_status.to_string(),
            command_phase: command_phase.to_string(),
            input_ready,
            input_ready_at: input_ready.then(|| "2026-06-19T00:00:00Z".to_string()),
            prompt_ready_at: None,
            completed_at: None,
            provider_session_id: None,
            native_session_id: None,
            fork_from_provider_session_id: None,
            provider_turn_id: None,
            turn_id: None,
            source: "test".to_string(),
            event_type: "test".to_string(),
            hook_event_name: "test".to_string(),
            updated_at_ms: 1,
            waiting_origin_ms: 0,
        }
    }

    fn backend_submit_projected(
        readiness: &str,
        terminal_status: &str,
        terminal_work_state: &str,
    ) -> TerminalProjectedRuntime {
        TerminalProjectedRuntime {
            display_name: "Agent".to_string(),
            terminal_name: "Agent".to_string(),
            terminal_nickname: String::new(),
            execution_phase: terminal_work_state.to_string(),
            native_rail_state: terminal_status.to_string(),
            native_rail_label: terminal_status.to_string(),
            readiness: readiness.to_string(),
            terminal_lifecycle: "open".to_string(),
            terminal_status: terminal_status.to_string(),
            terminal_work_state: terminal_work_state.to_string(),
            turn_status: "completed".to_string(),
            session_state: "session_attached".to_string(),
        }
    }

    #[test]
    fn backend_submit_readiness_accepts_core_idle_projection_without_input_ready_bit() {
        let mut runtime = backend_submit_runtime("active", "idle", "ready", false);
        let projected = backend_submit_projected("ready", "idle", "complete");
        assert_eq!(
            todo_dispatch_core_terminal_ready_for_submit(&runtime, &projected, false),
            Some(true),
        );
        assert!(todo_dispatch_runtime_matches_queue_target(
            &runtime,
            runtime.canonical_state_seq,
            None,
        ));
        runtime.provider_session_id = Some("session-2".to_string());
        assert!(!todo_dispatch_runtime_matches_queue_target(
            &runtime,
            runtime.canonical_state_seq,
            None,
        ));
        assert!(todo_dispatch_runtime_matches_queue_target(
            &runtime,
            runtime.canonical_state_seq,
            Some("session-2"),
        ));
        assert!(!todo_dispatch_runtime_matches_queue_target(
            &runtime,
            runtime.canonical_state_seq.saturating_add(1),
            Some("session-2"),
        ));
        assert!(!todo_dispatch_runtime_matches_queue_target(
            &runtime,
            runtime.canonical_state_seq,
            Some("session-old"),
        ));
    }

    #[test]
    fn backend_submit_readiness_rejects_busy_runtime_even_with_input_ready_bit() {
        let runtime = backend_submit_runtime("active", "thinking", "running", true);
        let projected = backend_submit_projected("busy", "thinking", "running");
        assert_eq!(
            todo_dispatch_core_terminal_ready_for_submit(&runtime, &projected, false),
            Some(false),
        );
    }

    #[test]
    fn backend_submit_readiness_requires_matching_completed_generation_and_no_interaction() {
        let projected = backend_submit_projected("ready", "idle", "complete");
        let mut runtime = backend_submit_runtime("active", "idle", "ready", true);
        runtime.turn_generation = 2;
        runtime.completed_turn_generation = 1;
        assert_eq!(
            todo_dispatch_core_terminal_ready_for_submit(&runtime, &projected, false),
            Some(false),
        );

        runtime.completed_turn_generation = 2;
        runtime.active_interaction_id = Some("uir:2".to_string());
        assert_eq!(
            todo_dispatch_core_terminal_ready_for_submit(&runtime, &projected, false),
            Some(false),
        );

        runtime.active_interaction_id = None;
        assert_eq!(
            todo_dispatch_core_terminal_ready_for_submit(&runtime, &projected, false),
            Some(true),
        );
    }

    fn activity_hook_payload(
        workspace_id: &str,
        event_type: &str,
        activity_status: &str,
        terminal_status: &str,
        readiness: &str,
        terminal_work_state: &str,
        input_ready: bool,
    ) -> TerminalActivityHookPayload {
        TerminalActivityHookPayload {
            pane_id: "pane-1".to_string(),
            instance_id: 1,
            terminal_process_epoch: "test-process-epoch".to_string(),
            workspace_id: workspace_id.to_string(),
            workspace_name: "Workspace".to_string(),
            terminal_index: Some(0),
            thread_id: "thread-1".to_string(),
            agent_id: "codex".to_string(),
            agent_kind: "codex".to_string(),
            agent_type: "codex".to_string(),
            agent_display_name: "Codex".to_string(),
            display_name: "Codex".to_string(),
            terminal_name: "Codex".to_string(),
            terminal_nickname: "Cy".to_string(),
            provider: "codex".to_string(),
            terminal_state_contract_version: 1,
            canonical_state: if activity_status == "idle" {
                "idle"
            } else {
                "thinking"
            }
            .to_string(),
            canonical_badge_label: if activity_status == "idle" {
                "idle"
            } else {
                "thinking"
            }
            .to_string(),
            canonical_state_seq: 1,
            prompt_state_seq: 0,
            turn_generation: if activity_status == "idle" { 0 } else { 1 },
            turn_generation_explicit: true,
            completed_turn_generation: 0,
            turn_active: activity_status != "idle",
            active_interaction_id: None,
            active_interaction_revision: None,
            interaction_actionable: false,
            turn_settlement_accepted: false,
            event_type: event_type.to_string(),
            hook_event_name: event_type.to_string(),
            source: "test".to_string(),
            status: activity_status.to_string(),
            activity_status: activity_status.to_string(),
            command_phase: terminal_work_state.to_string(),
            execution_phase: terminal_work_state.to_string(),
            native_rail_state: terminal_status.to_string(),
            native_rail_label: terminal_status.to_string(),
            readiness: readiness.to_string(),
            terminal_lifecycle: "open".to_string(),
            terminal_status: terminal_status.to_string(),
            terminal_work_state: terminal_work_state.to_string(),
            turn_status: "completed".to_string(),
            session_state: "session_attached".to_string(),
            input_ready,
            background_work_active: false,
            input_ready_at: input_ready.then(|| "2026-06-19T00:00:00Z".to_string()),
            prompt_ready_at: None,
            completed_at: None,
            provider_session_id: Some("provider-session-1".to_string()),
            native_session_id: Some("native-session-1".to_string()),
            fork_from_provider_session_id: None,
            provider_turn_id: None,
            turn_id: None,
            provider_error: None,
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
            prompt_questions: None,
            prompt_schema: None,
            prompt_url: None,
            provider_payload: None,
            allows_free_text: false,
            prompt_answer_option: None,
            interaction_id: None,
            interaction_revision: None,
            event_interaction_id: None,
            event_interaction_revision: None,
            interaction_source: None,
            interaction_response_mode: None,
            provider_request_id: None,
            manual_prompt_source: None,
            manual_approval_required: false,
            provider_blocked_for_user: false,
            terminal_is_prompting_user: false,
            prompting_user_kind: None,
            prompting_user_source: None,
            prompting_user_confidence: None,
            prompting_user_text: None,
            hook_health_status: "healthy".to_string(),
            hook_health_event: "ready".to_string(),
            hook_health_observed_at_ms: 1,
            hook_timestamp_ms: 1,
            observed_at_ms: 1,
            completion_evidence: String::new(),
        }
    }

    #[test]
    fn activity_hook_ready_idle_state_wakes_queue_dispatcher() {
        let payload = activity_hook_payload(
            "workspace-a",
            "provider-turn-completed",
            "idle",
            "idle",
            "ready",
            "complete",
            false,
        );
        let event_type = todo_dispatch_normalize_activity_hook_event_type(&payload.event_type);

        assert!(todo_dispatch_activity_hook_should_wake_queue(
            &payload,
            &event_type
        ));
    }

    #[test]
    fn rejected_completion_or_interrupt_cannot_settle_todo_receipt() {
        let mut completion = activity_hook_payload(
            "workspace-a",
            "provider-turn-completed",
            "thinking",
            "active",
            "busy",
            "running",
            false,
        );
        completion.turn_settlement_accepted = false;
        assert_eq!(
            todo_dispatch_activity_hook_settle_status(&completion, "provider-turn-completed"),
            None,
        );
        completion.turn_settlement_accepted = true;
        assert_eq!(
            todo_dispatch_activity_hook_settle_status(&completion, "provider-turn-completed"),
            Some("completed"),
        );

        completion.event_type = "provider-turn-interrupted".to_string();
        completion.turn_settlement_accepted = false;
        assert_eq!(
            todo_dispatch_activity_hook_settle_status(&completion, "provider-turn-interrupted"),
            None,
        );
    }

    #[test]
    fn activity_hook_empty_workspace_does_not_wake_queue_dispatcher() {
        let payload = activity_hook_payload(
            "",
            "provider-turn-completed",
            "idle",
            "idle",
            "ready",
            "complete",
            true,
        );
        let event_type = todo_dispatch_normalize_activity_hook_event_type(&payload.event_type);

        assert!(!todo_dispatch_activity_hook_should_wake_queue(
            &payload,
            &event_type
        ));
    }

    #[test]
    fn claude_background_active_hook_does_not_wake_queue_dispatcher() {
        let payload = activity_hook_payload(
            "workspace-a",
            "provider-turn-background-active",
            "thinking",
            "active",
            "busy",
            "background_running",
            false,
        );
        let event_type = todo_dispatch_normalize_activity_hook_event_type(&payload.event_type);

        assert!(!todo_dispatch_activity_hook_should_wake_queue(
            &payload,
            &event_type
        ));
    }

    #[test]
    fn backend_running_sync_payload_advances_account_todo_status() {
        let mut item = json!({
            "id": "todo-running-1",
            "kind": "todo",
            "text": "Run the queued todo",
            "target_terminal_id": "pane-1",
            "attachments": [{
                "attachment_id": "attachment-1",
                "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "bytes": 128,
                "mime": "image/png",
                "name": "diagram.png",
            }],
        });
        todo_store_set_item_status(&mut item, "running", "todo_queue_backend_submit");
        if let Some(object) = item.as_object_mut() {
            object.insert("command_id".to_string(), json!("command-1"));
            object.insert("last_dispatch_id".to_string(), json!("dispatch-1"));
        }

        let payload = todo_dispatch_todo_sync_commit_payload(
            "workspace-a",
            "Workspace A",
            "/tmp/workspace-a",
            &item,
            "todo_queue_backend_submit",
            "rust-diffforge-todo-dispatch",
        )
        .expect("running payload");

        assert_eq!(payload["c"].as_str(), Some("todo.sync"));
        assert_eq!(payload["ops"][0][1].as_i64(), Some(0));
        assert_eq!(payload["ops"][0][2].as_str(), Some("todo-running-1"));
        assert_eq!(payload["ops"][0][5].as_str(), Some("running"));
        assert_eq!(
            payload["ops"][0][7]["reason"].as_str(),
            Some("todo_queue_backend_submit")
        );
        assert_eq!(
            payload["ops"][0][7]["attachments"][0]["sha256"].as_str(),
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        );

        let entries = cloud_mcp_todo_sync_entries_from_ops(&payload);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["todo_status"].as_str(), Some("running"));
        assert_eq!(
            entries[0]["payload"]["todo_status"].as_str(),
            Some("running")
        );
    }

    #[test]
    fn done_status_round_trips_on_todo_wire_as_done() {
        let mut item = json!({
            "id": "todo-done-1",
            "kind": "todo",
            "text": "Completed todo",
            "target_terminal_id": "pane-1",
        });
        todo_store_set_item_status(&mut item, "done", "remote_todo_intake");
        assert_eq!(todo_store_item_status(&item), "completed");

        let payload = todo_dispatch_todo_sync_commit_payload(
            "workspace-a",
            "Workspace A",
            "/tmp/workspace-a",
            &item,
            "remote_todo_intake",
            "rust-diffforge-todo-dispatch",
        )
        .expect("done payload");

        assert_eq!(payload["ops"][0][5], json!("done"));
        let entries = cloud_mcp_todo_sync_entries_from_ops(&payload);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["todo_status"], json!("done"));
        assert_eq!(entries[0]["payload"]["todo_status"], json!("done"));
    }
}

fn todo_dispatch_backend_item_has_image_attachment(item: &Value) -> bool {
    [
        "image",
        "images",
        "image_attachments",
        "image_data_url",
        "image_src",
    ]
    .iter()
    .any(|key| match item.get(*key) {
        Some(Value::Null) | None => false,
        Some(Value::Array(values)) => !values.is_empty(),
        Some(Value::String(value)) => !value.trim().is_empty(),
        Some(_) => true,
    })
}

fn todo_dispatch_backend_item_dispatchable(item: &Value) -> bool {
    let status = item
        .get("todo_status")
        .or_else(|| item.get("status"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if status != "queued" {
        return false;
    }
    if todo_dispatch_webview_dispatcher_active()
        && todo_dispatch_text(item, &["lifecycle_owner"]) == "webview"
        && item
            .get("remote_command")
            .and_then(|remote| remote.get("source").or_else(|| remote.get("source_kind")))
            .and_then(Value::as_str)
            == Some("remote_intake_webview")
    {
        return false;
    }
    // Background policy: text-only todos (image attachments need the webview).
    if todo_dispatch_backend_item_has_image_attachment(item) {
        return false;
    }
    !todo_dispatch_backend_item_text(item).is_empty()
}

fn todo_dispatch_prepare_immediate_backend_item(
    workspace_id: &str,
    item: Value,
    target: &Value,
    prompt_event_id: Option<&str>,
) -> Result<Value, String> {
    if !item.is_object() {
        return Err("Todo item must be an object.".to_string());
    }

    let mut item = item;
    let item_id = todo_store_item_sync_id(&item);
    if item_id.is_empty() {
        return Err("Todo item id is required.".to_string());
    }
    if todo_dispatch_backend_item_has_image_attachment(&item) {
        return Err("image_todo_requires_webview_submission".to_string());
    }
    if todo_dispatch_backend_item_text(&item).is_empty() {
        return Err("Todo text is required.".to_string());
    }

    let pane_id = todo_dispatch_text(target, &["pane_id", "target_terminal_id"]);
    let thread_id = todo_dispatch_text(target, &["thread_id", "target_thread_id"]);
    let target_agent = todo_dispatch_backend_target_agent(&item, target);
    let target_kind = todo_dispatch_text(target, &["target_kind"]);
    let target_swarm_id = todo_dispatch_text(target, &["target_swarm_id"]);
    let terminal_index = target
        .get("terminal_index")
        .or_else(|| target.get("target_terminal_index"))
        .and_then(Value::as_i64);

    if let Some(object) = item.as_object_mut() {
        object.insert("id".to_string(), json!(item_id.clone()));
        object.insert("workspace_id".to_string(), json!(workspace_id));
        if !pane_id.is_empty() {
            object.insert("target_terminal_id".to_string(), json!(pane_id));
        }
        if !pane_id.is_empty() && !thread_id.is_empty() {
            object.insert("target_thread_id".to_string(), json!(thread_id));
        }
        if !target_agent.is_empty() {
            object.insert("target_agent_id".to_string(), json!(target_agent));
        }
        if target_kind.eq_ignore_ascii_case("swarm") && !target_swarm_id.is_empty() {
            object.insert("target_kind".to_string(), json!("swarm"));
            object.insert(
                "target_swarm_id".to_string(),
                json!(target_swarm_id.clone()),
            );
        }
        if !pane_id.is_empty() {
            if let Some(index) = terminal_index {
                object.insert("target_terminal_index".to_string(), json!(index));
            }
        }
        if let Some(prompt_event_id) = prompt_event_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            object.insert("prompt_event_id".to_string(), json!(prompt_event_id));
        }
    }

    todo_store_set_item_status(&mut item, "queued", "todo_queue_backend_submit_requested");

    if let Some(path) = todo_dispatch_data_path("queues", workspace_id) {
        let _store_guard = todo_dispatch_queue_store_guard();
        let snapshot = todo_dispatch_queue_read(&path);
        let mut items = snapshot
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut replaced = false;
        for existing in &mut items {
            if todo_store_item_matches_id(existing, &item_id) {
                let existing_status = todo_store_item_status(existing);
                if matches!(
                    existing_status.as_str(),
                    "running" | "sending" | "submitted" | "dispatching"
                ) {
                    return Err("todo_already_in_flight".to_string());
                }
                if TODO_STORE_SETTLED_RETENTION_STATUSES.contains(&existing_status.as_str())
                    || existing_status == "deleted"
                {
                    return Err("todo_already_settled".to_string());
                }
                *existing = item.clone();
                replaced = true;
                break;
            }
        }
        if !replaced {
            items.push(item.clone());
        }
        todo_dispatch_queue_write(workspace_id, &items);
    }

    Ok(item)
}

async fn todo_dispatch_backend_core_ready_entries(
    app: &AppHandle,
    workspace_id: &str,
    busy: &HashSet<String>,
) -> Vec<Value> {
    let terminal_state = app.state::<TerminalState>();
    let instances = {
        let guard = terminal_state.terminals.read().await;
        guard
            .iter()
            .map(|(pane_id, instance)| (pane_id.clone(), instance.clone()))
            .collect::<Vec<_>>()
    };
    let parked = {
        let guard = terminal_state.parked_prompts.read().await;
        guard
            .values()
            .map(|prompt| (prompt.pane_id.clone(), prompt.instance_id))
            .collect::<HashSet<_>>()
    };

    let mut entries = Vec::new();
    for (pane_id, instance) in instances {
        if busy.contains(&pane_id) {
            continue;
        }
        let metadata = instance.metadata.clone();
        if metadata.workspace_id.trim() != workspace_id {
            continue;
        }
        let metadata_agent = if metadata.agent_id.trim().is_empty() {
            &metadata.agent_kind
        } else {
            &metadata.agent_id
        };
        if !todo_dispatch_backend_agent_is_queueable(metadata_agent) {
            continue;
        }
        let launch_metadata = instance
            .launch_metadata
            .lock()
            .map(|metadata| metadata.clone())
            .unwrap_or_default();
        let runtime = terminal_runtime_snapshot(&instance);
        let is_parked = parked.contains(&(pane_id.clone(), instance.id));
        let projected = terminal_project_runtime(&metadata, &runtime, is_parked);
        if todo_dispatch_core_terminal_ready_for_submit(&runtime, &projected, is_parked)
            != Some(true)
        {
            continue;
        }
        todo_dispatch_refresh_terminal_runtime_from_core(
            &pane_id, &instance, &runtime, &projected, true,
        );
        entries.push(json!({
            "terminal_state_contract_version": runtime.terminal_state_contract_version,
            "canonical_state": runtime.canonical_state.clone(),
            "canonical_badge_label": runtime.canonical_badge_label.clone(),
            "canonical_state_seq": runtime.canonical_state_seq,
            "prompt_state_seq": runtime.prompt_state_seq,
            "turn_active": runtime.turn_active,
            "turn_generation": runtime.turn_generation,
            "completed_turn_generation": runtime.completed_turn_generation,
            "active_interaction_id": runtime.active_interaction_id.clone(),
            "active_interaction_revision": runtime.active_interaction_revision,
            "interaction_actionable": runtime.interaction_actionable,
            "activity_status": runtime.activity_status.clone(),
            "agent_id": metadata.agent_id.clone(),
            "agent_kind": metadata.agent_kind.clone(),
            "current_effort": launch_metadata.reasoning_effort.clone(),
            "current_model": launch_metadata.model.clone(),
            "display_name": projected.display_name.clone(),
            "model": launch_metadata.model.clone(),
            "input_ready": true,
            "input_ready_at": runtime.input_ready_at.clone(),
            "instance_id": instance.id,
            "pane_id": pane_id,
            "provider_session_id": runtime.provider_session_id.clone(),
            "readiness": projected.readiness.clone(),
            "terminal_index": metadata.terminal_index,
            "terminal_name": projected.terminal_name.clone(),
            "terminal_nickname": projected.terminal_nickname.clone(),
            "terminal_status": projected.terminal_status.clone(),
            "terminal_work_state": projected.terminal_work_state.clone(),
            "thread_id": metadata.thread_id.clone(),
            "workspace_id": metadata.workspace_id.clone(),
            "workspace_name": metadata.workspace_name.clone(),
        }));
    }
    todo_dispatch_sort_backend_ready_entries(&mut entries);
    entries
}

fn todo_dispatch_backend_registry_ready_entries(
    workspace_id: &str,
    busy: &HashSet<String>,
) -> Vec<Value> {
    let registry = TODO_DISPATCH_TERMINAL_RUNTIME.get_or_init(|| StdMutex::new(HashMap::new()));
    let Ok(map) = registry.lock() else {
        return Vec::new();
    };
    let mut entries = map
        .values()
        .filter(|entry| {
            entry.get("workspace_id").and_then(Value::as_str) == Some(workspace_id)
                && entry.get("input_ready").and_then(Value::as_bool) == Some(true)
                && todo_dispatch_backend_entry_agent_is_queueable(entry)
                && todo_dispatch_backend_ready_entry_allows_submit(entry)
                && entry
                    .get("pane_id")
                    .and_then(Value::as_str)
                    .is_some_and(|pane| !busy.contains(pane))
        })
        .cloned()
        .collect::<Vec<_>>();
    todo_dispatch_sort_backend_ready_entries(&mut entries);
    entries
}

fn todo_dispatch_backend_ready_entry_allows_submit(entry: &Value) -> bool {
    if !todo_dispatch_backend_entry_agent_is_queueable(entry) {
        return false;
    }
    entry
        .get("terminal_state_contract_version")
        .and_then(Value::as_u64)
        == Some(1)
        && entry.get("canonical_state").and_then(Value::as_str) == Some("idle")
        && entry.get("turn_active").and_then(Value::as_bool) == Some(false)
        && entry.get("turn_generation").and_then(Value::as_u64)
            == entry
                .get("completed_turn_generation")
                .and_then(Value::as_u64)
        && entry
            .get("active_interaction_id")
            .is_none_or(Value::is_null)
        && entry
            .get("canonical_state_seq")
            .and_then(Value::as_u64)
            .is_some_and(|seq| seq > 0)
}

fn todo_dispatch_sort_backend_ready_entries(entries: &mut [Value]) {
    entries.sort_by(|left, right| {
        let left_index = left
            .get("terminal_index")
            .and_then(Value::as_i64)
            .unwrap_or(i64::MAX);
        let right_index = right
            .get("terminal_index")
            .and_then(Value::as_i64)
            .unwrap_or(i64::MAX);
        left_index.cmp(&right_index).then_with(|| {
            todo_dispatch_text(left, &["pane_id"]).cmp(&todo_dispatch_text(right, &["pane_id"]))
        })
    });
}

fn todo_dispatch_item_target_kind(item: &Value) -> String {
    todo_dispatch_text(item, &["target_kind"])
        .trim()
        .to_ascii_lowercase()
}

fn todo_dispatch_item_target_swarm_id(item: &Value) -> String {
    todo_dispatch_text(item, &["target_swarm_id", "swarm_id"])
        .trim()
        .to_string()
}

fn todo_dispatch_target_is_swarm(target: &Value) -> bool {
    todo_dispatch_text(target, &["target_kind"])
        .trim()
        .eq_ignore_ascii_case("swarm")
}

fn todo_dispatch_value_has_swarm_target(value: &Value) -> bool {
    todo_dispatch_target_is_swarm(value) || !todo_dispatch_item_target_swarm_id(value).is_empty()
}

fn todo_dispatch_backend_swarm_target(item: &Value, workspace_id: Option<&str>) -> Option<Value> {
    if todo_dispatch_item_target_kind(item) != "swarm" {
        return None;
    }
    let swarm_id = todo_dispatch_item_target_swarm_id(item);
    if swarm_id.is_empty() {
        return None;
    }
    let workspace_id = workspace_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| todo_dispatch_text(item, &["workspace_id"]));
    let pane_id = todo_dispatch_text(item, &["target_terminal_id", "pane_id"]);
    let mut target = json!({
        "target_kind": "swarm",
        "target_swarm_id": swarm_id,
        "workspace_id": workspace_id,
    });
    if let Some(object) = target.as_object_mut() {
        if !pane_id.is_empty() {
            object.insert("pane_id".to_string(), json!(pane_id.clone()));
            object.insert("target_terminal_id".to_string(), json!(pane_id));
        }
        if !pane_id.is_empty() {
            if let Some(index) = item.get("target_terminal_index").and_then(Value::as_i64) {
                object.insert("target_terminal_index".to_string(), json!(index));
            }
        }
    }
    Some(target)
}

fn todo_dispatch_backend_terminal_name_key(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn todo_dispatch_backend_pick_target_from_entries(
    entries: &[Value],
    item: &Value,
) -> Option<Value> {
    if let Some(target) = todo_dispatch_backend_swarm_target(item, None) {
        return Some(target);
    }
    if entries.is_empty() {
        return None;
    }
    let target_pane = todo_dispatch_text(item, &["target_terminal_id", "terminal_id", "pane_id"]);
    let target_thread = todo_dispatch_text(item, &["target_thread_id", "thread_id"]);
    let target_index = todo_dispatch_i64(item, &["target_terminal_index", "terminal_index"]);
    let target_name = todo_dispatch_backend_terminal_name_key(&todo_dispatch_text(
        item,
        &["target_terminal_name", "terminal_name"],
    ));
    let has_equivalent_selector =
        !target_thread.is_empty() || target_index.is_some() || !target_name.is_empty();
    let target_agent =
        todo_dispatch_backend_agent_value(item, &["target_agent_id", "agent_id", "agent_kind"]);
    let target_agent = if target_agent.is_empty() {
        None
    } else {
        Some(target_agent)
    };
    let matched = entries
        .iter()
        .find(|entry| {
            !target_pane.is_empty()
                && todo_dispatch_text(entry, &["pane_id", "target_terminal_id", "terminal_id"])
                    == target_pane
        })
        .or_else(|| {
            if !target_pane.is_empty() {
                // A persisted assignment is exact-id-only. If that id is no
                // longer live, do not silently redirect the todo by index,
                // name, thread, or array position.
                None
            } else if has_equivalent_selector {
                entries
                    .iter()
                    .find(|entry| {
                        !target_thread.is_empty()
                            && todo_dispatch_text(entry, &["thread_id", "target_thread_id"])
                                == target_thread
                    })
                    .or_else(|| {
                        target_index.and_then(|index| {
                            entries.iter().find(|entry| {
                                todo_dispatch_i64(entry, &["terminal_index", "index"])
                                    == Some(index)
                            })
                        })
                    })
                    .or_else(|| {
                        (!target_name.is_empty()).then(|| {
                            entries.iter().find(|entry| {
                                [
                                    "terminal_nickname",
                                    "terminal_name",
                                    "display_name",
                                    "agent_display_name",
                                    "name",
                                ]
                                .iter()
                                .any(|key| {
                                    todo_dispatch_backend_terminal_name_key(
                                        entry.get(*key).and_then(Value::as_str).unwrap_or_default(),
                                    ) == target_name
                                })
                            })
                        })
                        .flatten()
                    })
            } else if let Some(agent) = target_agent.as_deref() {
                entries.iter().find(|entry| {
                    todo_dispatch_backend_agent_value(entry, &["agent_id"]) == agent
                        || todo_dispatch_backend_agent_value(entry, &["agent_kind"]) == agent
                })
            } else {
                entries.first()
            }
        });
    matched.cloned()
}

async fn todo_dispatch_backend_pick_target(
    app: &AppHandle,
    workspace_id: &str,
    item: &Value,
    busy: &HashSet<String>,
) -> Option<Value> {
    if let Some(target) = todo_dispatch_backend_swarm_target(item, Some(workspace_id)) {
        return Some(target);
    }
    let mut entries = todo_dispatch_backend_core_ready_entries(app, workspace_id, busy).await;
    for entry in todo_dispatch_backend_registry_ready_entries(workspace_id, busy) {
        let pane_id = entry
            .get("pane_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let already_present = entries.iter().any(|existing| {
            existing
                .get("pane_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                == pane_id
        });
        if !already_present {
            entries.push(entry);
        }
    }
    todo_dispatch_backend_pick_target_from_entries(&entries, item)
}

fn todo_dispatch_maybe_schedule_workspace_activation(
    app: &AppHandle,
    workspace_id: &str,
    item: &Value,
) {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() || todo_dispatch_webview_dispatcher_active() {
        return;
    }
    let now = todo_dispatch_now_ms();
    let attempts =
        TODO_DISPATCH_WORKSPACE_ACTIVATION_ATTEMPTS.get_or_init(|| StdMutex::new(HashMap::new()));
    {
        let Ok(mut guard) = attempts.lock() else {
            return;
        };
        let last_attempt = guard.get(workspace_id).copied().unwrap_or(0);
        if now.saturating_sub(last_attempt) < TODO_DISPATCH_WORKSPACE_ACTIVATION_THROTTLE_MS {
            return;
        }
        guard.insert(workspace_id.to_string(), now);
    }
    let item_id = todo_store_item_sync_id(item);
    let command_id = todo_dispatch_queue_item_command_id(item);
    todo_dispatch_journal_append(
        workspace_id,
        json!({
            "command_id": command_id,
            "event": "workspace_activation_scheduled",
            "item_id": item_id,
            "reason": "no_ready_terminal",
            "scheduled_at_ms": now,
            "workspace_id": workspace_id,
        }),
    );
    log_terminal_status_event(
        "backend.todo_dispatch.workspace_activation_scheduled",
        json!({
            "command_id": command_id,
            "item_id": item_id,
            "reason": "no_ready_terminal",
            "workspace_id": workspace_id,
        }),
    );
    let app = app.clone();
    let workspace_id = workspace_id.to_string();
    tauri::async_runtime::spawn(async move {
        // "No ready target" is NOT "no terminals": a workspace whose
        // terminals are merely mid-turn must never be re-activated —
        // terminal_open closes an existing pane's session first, so
        // activating here would kill in-flight agent turns. Only activate
        // when the workspace has zero live terminals at all.
        {
            let terminal_state = app.state::<TerminalState>();
            let guard = terminal_state.terminals.read().await;
            let has_live_terminal = guard
                .values()
                .any(|instance| instance.metadata.workspace_id.trim() == workspace_id);
            if has_live_terminal {
                log_terminal_status_event(
                    "backend.todo_dispatch.workspace_activation_skipped",
                    json!({
                        "reason": "workspace_has_live_terminals",
                        "workspace_id": workspace_id,
                    }),
                );
                return;
            }
        }
        let result = workspace_activate_runtime_internal(
            &app,
            &workspace_id,
            "todo_dispatch_no_ready_terminal",
        )
        .await;
        match result {
            Ok(value) => {
                log_terminal_status_event(
                    "backend.todo_dispatch.workspace_activation_complete",
                    json!({
                        "result": value,
                        "workspace_id": workspace_id,
                    }),
                );
                todo_dispatch_wake_background_dispatcher(app);
            }
            Err(error) => {
                log_terminal_status_event(
                    "backend.todo_dispatch.workspace_activation_failed",
                    json!({
                        "error": clean_terminal_telemetry_text(&error),
                        "workspace_id": workspace_id,
                    }),
                );
            }
        }
    });
}

fn todo_dispatch_backend_try_claim_item(
    workspace_id: &str,
    item: &Value,
    target: &Value,
) -> Option<Value> {
    let item_id = todo_store_item_sync_id(item);
    if item_id.is_empty() {
        return None;
    }
    let _store_guard = todo_dispatch_queue_store_guard();
    let path = todo_dispatch_data_path("queues", workspace_id)?;
    let snapshot = todo_dispatch_queue_read(&path);
    let mut items = snapshot
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut claimed = None;
    for entry in &mut items {
        if !todo_store_items_share_identity(entry, item)
            || todo_store_item_status(entry) != "queued"
        {
            continue;
        }
        todo_store_set_item_status(entry, "running", "todo_queue_backend_dispatch_claim");
        todo_store_set_item_lifecycle_owner(entry, "rust");
        if let Some(object) = entry.as_object_mut() {
            if let Some(pane_id) = target
                .get("pane_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                object.insert("target_terminal_id".to_string(), json!(pane_id));
                object.insert("pane_id".to_string(), json!(pane_id));
            }
            if let Some(terminal_index) = target.get("terminal_index").cloned() {
                object.insert("target_terminal_index".to_string(), terminal_index);
            }
            if let Some(thread_id) = target
                .get("thread_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                object.insert("target_thread_id".to_string(), json!(thread_id));
                object.insert("thread_id".to_string(), json!(thread_id));
            }
            if todo_dispatch_target_is_swarm(target) {
                object.insert("target_kind".to_string(), json!("swarm"));
                if let Some(swarm_id) = target
                    .get("target_swarm_id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    object.insert("target_swarm_id".to_string(), json!(swarm_id));
                }
            }
        }
        if claimed.is_none() {
            claimed = Some(entry.clone());
        }
    }
    if claimed.is_some() {
        todo_dispatch_queue_write(workspace_id, &items);
        todo_store_orphan_sweep_trigger("todo_queue_backend_dispatch_claim");
    }
    claimed
}

fn todo_dispatch_backend_release_claim(workspace_id: &str, item: &Value, reason: &str) {
    let item_id = todo_store_item_sync_id(item);
    if item_id.is_empty() {
        return;
    }
    let _store_guard = todo_dispatch_queue_store_guard();
    let Some(path) = todo_dispatch_data_path("queues", workspace_id) else {
        return;
    };
    let snapshot = todo_dispatch_queue_read(&path);
    let mut items = snapshot
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut changed = false;
    for entry in &mut items {
        if !todo_store_items_share_identity(entry, item) {
            continue;
        }
        if todo_store_item_status(entry) == "running"
            && todo_dispatch_text(entry, &["todo_status_reason", "status_reason"])
                == "todo_queue_backend_dispatch_claim"
        {
            todo_store_set_item_status(entry, "queued", reason);
            changed = true;
        }
    }
    if changed {
        todo_dispatch_queue_write(workspace_id, &items);
        todo_store_orphan_sweep_trigger("todo_queue_backend_release_claim");
    }
}

async fn todo_dispatch_terminal_instance_still_current(
    terminal_state: &TerminalState,
    pane_id: &str,
    instance: &TerminalInstance,
) -> bool {
    let guard = terminal_state.terminals.read().await;
    guard
        .get(pane_id)
        .map(|current| current.id == instance.id)
        .unwrap_or(false)
}

async fn todo_dispatch_write_current_terminal_chunks(
    terminal_state: &TerminalState,
    pane_id: &str,
    instance: &TerminalInstance,
    chunks: &[&[u8]],
) -> bool {
    let guard = terminal_state.terminals.read().await;
    let mut writer = instance.writer.lock().await;
    if guard
        .get(pane_id)
        .map(|current| current.id != instance.id)
        .unwrap_or(true)
    {
        return false;
    }
    for chunk in chunks {
        if writer.write_all(chunk).is_err() {
            return false;
        }
    }
    writer.flush().is_ok()
}

async fn todo_dispatch_write_submit_if_still_ready(
    terminal_state: &TerminalState,
    pane_id: &str,
    instance: &TerminalInstance,
    expected_canonical_state_seq: u64,
    expected_provider_session_id: Option<&str>,
    submit_sequence: &[u8],
) -> bool {
    // Acquire every authority that can invalidate queue readiness before the
    // final check, then keep those guards through the Enter write. No await
    // occurs after the std mutex guards are taken.
    let terminals = terminal_state.terminals.read().await;
    let mut writer = instance.writer.lock().await;
    let parked = terminal_state.parked_prompts.read().await;
    let Ok(interactions) = terminal_state.terminal_structured_interactions.lock() else {
        return false;
    };
    let Ok(runtime) = instance.runtime.lock() else {
        return false;
    };
    let instance_is_current = terminals
        .get(pane_id)
        .is_some_and(|current| current.id == instance.id);
    let interaction_is_closed = !interactions.values().any(|interaction| {
        interaction.pane_id == pane_id && interaction.instance_id == instance.id
    });
    let task_is_unparked = !parked
        .values()
        .any(|prompt| prompt.pane_id == pane_id && prompt.instance_id == instance.id);
    if !instance_is_current
        || !interaction_is_closed
        || !task_is_unparked
        || !todo_dispatch_runtime_matches_queue_target(
            &runtime,
            expected_canonical_state_seq,
            expected_provider_session_id,
        )
    {
        return false;
    }
    writer.write_all(submit_sequence).is_ok() && writer.flush().is_ok()
}

async fn todo_dispatch_backend_swarm_can_start(
    app: &AppHandle,
    workspace_id: &str,
    target: &Value,
) -> bool {
    let swarm_id = todo_dispatch_text(target, &["target_swarm_id"]);
    if swarm_id.is_empty() {
        return false;
    }
    let swarm_state = app.state::<SwarmRuntimeState>();
    let terminal_state = app.state::<TerminalState>();
    match swarm_can_submit_task_internal(
        swarm_state.inner(),
        terminal_state.inner(),
        workspace_id,
        &swarm_id,
    )
    .await
    {
        Ok(()) => true,
        Err(error) => {
            log_terminal_status_event(
                "backend.todo_dispatch.swarm_submit_not_ready",
                json!({
                    "reason": error,
                    "swarm_id": swarm_id,
                    "workspace_id": workspace_id,
                }),
            );
            false
        }
    }
}

async fn todo_dispatch_backend_submit_swarm(
    app: &AppHandle,
    workspace_id: &str,
    item: &Value,
    target: &Value,
) -> bool {
    let swarm_id = todo_dispatch_text(target, &["target_swarm_id"]);
    let prepared =
        todo_dispatch_backend_item_text_with_remote_attachments(item, workspace_id).await;
    // Swarm submission is not an interactive TUI input channel, so preserve
    // verified paths as explicit context instead of pretending they became
    // native composer attachments.
    let prompt = todo_dispatch_prepared_text_fallback(&prepared);
    if swarm_id.is_empty() || prompt.is_empty() {
        return false;
    }
    let swarm_state = app.state::<SwarmRuntimeState>();
    let terminal_state = app.state::<TerminalState>();
    let run_id = match swarm_submit_task_internal(
        app,
        swarm_state.inner(),
        terminal_state.inner(),
        workspace_id,
        &swarm_id,
        &prompt,
        "implement",
    )
    .await
    {
        Ok(run_id) => run_id,
        Err(error) => {
            log_terminal_status_event(
                "backend.todo_dispatch.swarm_submit_failed",
                json!({
                    "reason": error,
                    "swarm_id": swarm_id,
                    "workspace_id": workspace_id,
                }),
            );
            return false;
        }
    };

    let item_id = item
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let command_id = todo_dispatch_queue_item_command_id(item);
    let todo_id = item
        .get("todo_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&item_id)
        .to_string();
    let dispatch_id = format!("backend-swarm-dispatch-{item_id}");
    let submitted_at = crate::coordination::kernel::now_rfc3339();
    let workspace_name = todo_dispatch_text(item, &["workspace_name", "workspace_title"]);
    let repo_path = todo_dispatch_text(item, &["repo_path", "workspace_root", "root_directory"]);
    let pane_id = todo_dispatch_text(target, &["pane_id", "target_terminal_id"]);
    let origin_device_id = todo_dispatch_text(item, &["origin_device_id"]);

    let mut receipt = json!({
        "command_id": command_id,
        "item_id": item_id,
        "submitted_at": submitted_at.clone(),
        "status": "running",
        "status_reason": "todo_queue_swarm_run_started",
        "target_kind": "swarm",
        "target_swarm_id": swarm_id,
        "swarm_run_id": run_id,
        "text": prompt.chars().take(180).collect::<String>(),
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
    });
    if let Some(object) = receipt.as_object_mut() {
        if !pane_id.is_empty() {
            object.insert("pane_id".to_string(), json!(pane_id.clone()));
            object.insert("target_terminal_id".to_string(), json!(pane_id.clone()));
        }
        if !origin_device_id.is_empty() {
            object.insert(
                "origin_device_id".to_string(),
                json!(origin_device_id.clone()),
            );
        }
    }
    let _ = todo_dispatch_record_receipt_internal(
        Some(app),
        workspace_id,
        receipt,
        "backend_swarm_dispatch",
    );

    todo_dispatch_journal_append(
        workspace_id,
        json!({
            "command_id": command_id,
            "dispatch_id": dispatch_id,
            "item_id": item_id,
            "target_kind": "swarm",
            "target_swarm_id": swarm_id,
            "swarm_run_id": run_id,
            "submitted_at": submitted_at,
            "text": prompt.chars().take(500).collect::<String>(),
            "todo_id": todo_id,
            "workspace_id": workspace_id,
        }),
    );

    let mut running_item = None;
    if let Some(path) = todo_dispatch_data_path("queues", workspace_id) {
        let _store_guard = todo_dispatch_queue_store_guard();
        let snapshot = todo_dispatch_queue_read(&path);
        if let Some(items) = snapshot.get("items").and_then(Value::as_array) {
            let next_items = items
                .iter()
                .cloned()
                .map(|mut entry| {
                    if todo_store_items_share_identity(&entry, item) {
                        todo_store_set_item_status(
                            &mut entry,
                            "running",
                            "todo_queue_swarm_run_started",
                        );
                        if let Some(object) = entry.as_object_mut() {
                            object.insert("command_id".to_string(), json!(command_id.clone()));
                            object.insert("dispatch_id".to_string(), json!(dispatch_id.clone()));
                            object
                                .insert("last_dispatch_id".to_string(), json!(dispatch_id.clone()));
                            object.insert("todo_id".to_string(), json!(todo_id.clone()));
                            object.insert("target_kind".to_string(), json!("swarm"));
                            object.insert("target_swarm_id".to_string(), json!(swarm_id.clone()));
                            object.insert("swarm_run_id".to_string(), json!(run_id.clone()));
                            if !pane_id.is_empty() {
                                object.insert(
                                    "target_terminal_id".to_string(),
                                    json!(pane_id.clone()),
                                );
                                object.insert("pane_id".to_string(), json!(pane_id.clone()));
                            }
                            if let Some(terminal_index) =
                                target.get("target_terminal_index").cloned()
                            {
                                object.insert("target_terminal_index".to_string(), terminal_index);
                            }
                        }
                        running_item = Some(entry.clone());
                    }
                    entry
                })
                .collect::<Vec<_>>();
            todo_dispatch_queue_write(workspace_id, &next_items);
            todo_store_orphan_sweep_trigger("todo_queue_swarm_run_started");
        }
    }
    if let Some(running_item) = running_item {
        todo_store_push_corrections(
            app,
            workspace_id,
            vec![running_item.clone()],
            "todo_queue_swarm_run_started",
        );
        todo_store_emit_changed(app, workspace_id, "todo_queue_swarm_run_started", "store");
        todo_dispatch_emit_loopspace_batch_lifecycle(app, &running_item);
        todo_dispatch_enqueue_todo_sync_commit(
            app,
            workspace_id,
            &workspace_name,
            &repo_path,
            running_item,
            "todo_queue_swarm_run_started",
        )
        .await;
    }

    log_terminal_status_event(
        "backend.todo_dispatch.swarm_submitted",
        json!({
            "command_id": command_id,
            "item_id": item_id,
            "swarm_id": swarm_id,
            "swarm_run_id": run_id,
            "workspace_id": workspace_id,
        }),
    );
    true
}

fn todo_dispatch_backend_ready_target_is_current(
    terminal_state: &TerminalState,
    pane_id: &str,
    instance: &TerminalInstance,
    expected_canonical_state_seq: u64,
    expected_provider_session_id: Option<&str>,
) -> bool {
    let runtime = terminal_runtime_snapshot(instance);
    let instance_is_current = terminal_state
        .terminals
        .try_read()
        .ok()
        .and_then(|terminals| {
            terminals
                .get(pane_id)
                .map(|current| current.id == instance.id)
        })
        == Some(true);
    let interaction_is_closed = terminal_state
        .terminal_structured_interactions
        .lock()
        .ok()
        .is_some_and(|interactions| {
            !interactions.values().any(|interaction| {
                interaction.pane_id == pane_id && interaction.instance_id == instance.id
            })
        });
    let task_is_unparked = terminal_state
        .parked_prompts
        .try_read()
        .ok()
        .is_some_and(|parked| {
            !parked
                .values()
                .any(|prompt| prompt.pane_id == pane_id && prompt.instance_id == instance.id)
        });
    instance_is_current
        && todo_dispatch_runtime_matches_queue_target(
            &runtime,
            expected_canonical_state_seq,
            expected_provider_session_id,
        )
        && interaction_is_closed
        && task_is_unparked
}

async fn todo_dispatch_backend_submit(
    app: &AppHandle,
    workspace_id: &str,
    item: &Value,
    target: &Value,
) -> bool {
    if todo_dispatch_target_is_swarm(target) {
        return todo_dispatch_backend_submit_swarm(app, workspace_id, item, target).await;
    }
    let pane_id = target
        .get("pane_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let target_instance_id = target
        .get("instance_id")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let prepared =
        todo_dispatch_backend_item_text_with_remote_attachments(item, workspace_id).await;
    if pane_id.is_empty() || !prepared.has_content() {
        return false;
    }
    let submit_sequence = todo_dispatch_backend_submit_sequence(item, target);
    let model_switch_command = todo_dispatch_backend_model_command(item, target);
    let codex_model_picker = todo_dispatch_backend_codex_model_picker(item, target);
    let prepared_input = todo_dispatch_prepared_terminal_input(&prepared, "");
    if prepared_input.len() + submit_sequence.len() + 1 > MAX_TERMINAL_WRITE_BYTES {
        return false;
    }
    if !model_switch_command.is_empty()
        && model_switch_command.len() + submit_sequence.len() + 1 > MAX_TERMINAL_WRITE_BYTES
    {
        return false;
    }
    let terminal_state = app.state::<TerminalState>();
    let Some(instance) = ({
        let guard = terminal_state.terminals.read().await;
        guard
            .get(&pane_id)
            .filter(|instance| target_instance_id == 0 || instance.id == target_instance_id)
            .cloned()
    }) else {
        return false;
    };
    let target_canonical_state_seq = target
        .get("canonical_state_seq")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let target_provider_session_id = target
        .get("provider_session_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let fresh_runtime = terminal_runtime_snapshot(&instance);
    let has_open_interaction = terminal_state
        .terminal_structured_interactions
        .lock()
        .ok()
        .is_none_or(|interactions| {
            interactions.values().any(|interaction| {
                interaction.pane_id == pane_id && interaction.instance_id == instance.id
            })
        });
    if !todo_dispatch_runtime_matches_queue_target(
        &fresh_runtime,
        target_canonical_state_seq,
        target_provider_session_id,
    ) || has_open_interaction
    {
        return false;
    }
    let instance_agent = todo_dispatch_backend_agent_id(&instance.metadata.agent_id);
    let requested_agent = todo_dispatch_backend_target_agent(item, target);
    if !todo_dispatch_backend_agent_is_queueable(&instance_agent) {
        log_terminal_status_event(
            "backend.todo_dispatch.backend_submit_unsupported_agent_skip",
            json!({
                "instance_agent": instance_agent,
                "pane_id": pane_id,
                "requested_agent": requested_agent,
                "workspace_id": workspace_id,
            }),
        );
        return false;
    }
    if !requested_agent.is_empty() && requested_agent != instance_agent {
        log_terminal_status_event(
            "backend.todo_dispatch.backend_submit_agent_mismatch_skip",
            json!({
                "instance_agent": instance_agent,
                "pane_id": pane_id,
                "requested_agent": requested_agent,
                "workspace_id": workspace_id,
            }),
        );
        return false;
    }
    if todo_dispatch_pane_input_ready_authoritative(app, &pane_id, target_instance_id).await
        != Some(true)
    {
        return false;
    }

    let item_id = item
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let command_id = todo_dispatch_queue_item_command_id(item);
    let todo_id = item
        .get("todo_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&item_id)
        .to_string();
    let dispatch_id = format!("backend-dispatch-{item_id}");
    let prompt_event_id = todo_dispatch_text(item, &["prompt_event_id"]);
    let prompt_event_id = if prompt_event_id.is_empty() {
        format!("backend-todo-{item_id}-{:x}", todo_dispatch_now_ms())
    } else {
        prompt_event_id
    };
    let thread_id = target
        .get("thread_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let workspace_name = target
        .get("workspace_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let workspace_name = if workspace_name.trim().is_empty() {
        instance.metadata.workspace_name.clone()
    } else {
        workspace_name
    };
    let repo_path = instance
        .coordination
        .as_ref()
        .map(|coordination| coordination.repo_path.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| instance.working_directory.display().to_string());
    let attachment_model = [
        todo_dispatch_text(item, &["model", "model_id"]),
        todo_dispatch_text(target, &["current_model", "model_id", "model"]),
    ]
    .into_iter()
    .find(|value| !value.is_empty())
    .unwrap_or_default();
    let attachment_inject_started_at_ms = todo_dispatch_now_ms();

    if !prepared.attachments.is_empty() {
        log_terminal_status_event(
            "backend.todo_dispatch.attachments_inject_start",
            json!({
                "agent_id": instance_agent,
                "attachment_count": prepared.attachments.len(),
                "attachments": todo_dispatch_staged_attachment_log_summary(&prepared.attachments),
                "delivery": "native_bracketed_paste",
                "item_id": item_id,
                "model": clean_terminal_diagnostic_log_text(&attachment_model),
                "model_image_support": todo_dispatch_attachment_model_support(&instance_agent, &attachment_model),
                "pane_id": pane_id,
                "workspace_id": workspace_id,
            }),
        );
    }

    // Mirror the proven crash-resume backend submit mechanics: serialize on
    // the input queue, write the prompt, settle, then the submit sequence.
    let _input_guard = instance.input_queue.lock().await;
    if !todo_dispatch_backend_ready_target_is_current(
        &terminal_state,
        &pane_id,
        &instance,
        target_canonical_state_seq,
        target_provider_session_id,
    ) {
        return false;
    }
    if !model_switch_command.is_empty() {
        // Ctrl-U clears any stale TUI input before applying the requested
        // loop agent model/effort settings.
        if !todo_dispatch_write_current_terminal_chunks(
            &terminal_state,
            &pane_id,
            &instance,
            &[b"\x15".as_ref(), model_switch_command.as_bytes()],
        )
        .await
        {
            return false;
        }
        sleep(Duration::from_millis(
            TERMINAL_PARKED_RESUME_SUBMIT_DELAY_MS,
        ))
        .await;
        if !todo_dispatch_write_current_terminal_chunks(
            &terminal_state,
            &pane_id,
            &instance,
            &[submit_sequence.as_bytes()],
        )
        .await
        {
            return false;
        }
        if let Some((picker_model, picker_effort)) = codex_model_picker.as_ref() {
            // `/model` opens Codex's native picker. Select the model and, when
            // requested, the following effort screen as one serialized PTY
            // transaction before the queued prompt is injected.
            sleep(Duration::from_millis(220)).await;
            if !todo_dispatch_write_current_terminal_chunks(
                &terminal_state,
                &pane_id,
                &instance,
                &[picker_model.as_bytes(), submit_sequence.as_bytes()],
            )
            .await
            {
                return false;
            }
            if let Some(picker_effort) = picker_effort.as_ref() {
                sleep(Duration::from_millis(220)).await;
                if !todo_dispatch_write_current_terminal_chunks(
                    &terminal_state,
                    &pane_id,
                    &instance,
                    &[picker_effort.as_bytes(), submit_sequence.as_bytes()],
                )
                .await
                {
                    return false;
                }
            }
        }
        if !todo_dispatch_wait_for_pane_input_ready_after_model(app, &pane_id, target_instance_id)
            .await
        {
            return false;
        }
        if !todo_dispatch_terminal_instance_still_current(&terminal_state, &pane_id, &instance)
            .await
        {
            return false;
        }
        if !todo_dispatch_backend_ready_target_is_current(
            &terminal_state,
            &pane_id,
            &instance,
            target_canonical_state_seq,
            target_provider_session_id,
        ) {
            return false;
        }
    }
    // Ctrl-U clears any stale TUI input left by a previous interrupted or
    // failed UI write before Rust submits the queued todo.
    if !todo_dispatch_write_current_terminal_chunks(
        &terminal_state,
        &pane_id,
        &instance,
        &[b"\x15".as_ref(), prepared_input.as_bytes()],
    )
    .await
    {
        return false;
    }
    sleep(Duration::from_millis(
        TERMINAL_PARKED_RESUME_SUBMIT_DELAY_MS,
    ))
    .await;
    if !todo_dispatch_write_submit_if_still_ready(
        &terminal_state,
        &pane_id,
        &instance,
        target_canonical_state_seq,
        target_provider_session_id,
        submit_sequence.as_bytes(),
    )
    .await
    {
        return false;
    }

    if !prepared.attachments.is_empty() {
        log_terminal_status_event(
            "backend.todo_dispatch.attachments_injected",
            json!({
                "agent_id": instance_agent,
                "attachment_count": prepared.attachments.len(),
                "delivery": "native_bracketed_paste",
                "elapsed_ms": todo_dispatch_now_ms().saturating_sub(attachment_inject_started_at_ms),
                "item_id": item_id,
                "model": clean_terminal_diagnostic_log_text(&attachment_model),
                "model_image_support": todo_dispatch_attachment_model_support(&instance_agent, &attachment_model),
                "pane_id": pane_id,
                "workspace_id": workspace_id,
            }),
        );
    }

    let prompt = prepared.text.clone();

    let submitted_at = crate::coordination::kernel::now_rfc3339();
    emit_terminal_prompt_submitted(
        app,
        &instance,
        &prompt,
        Some(&prompt_event_id),
        None,
        Some("todo-queue-backend"),
        Some(&submitted_at),
        Some(&todo_id),
        Some(&dispatch_id),
        Some(&command_id),
        Some("backend_dispatch"),
        false,
        Some(&prompt),
        Some(&prompt),
        true,
        "todo_queue_backend_submit",
        Some(&thread_id),
    );

    if let Some(action_kind) = todo_dispatch_post_injection_message_ack_kind(item, true) {
        let state = app.state::<CloudMcpState>().inner().clone();
        let ack_event = item.clone();
        let ack_entity_id = prompt_event_id.clone();
        tauri::async_runtime::spawn(async move {
            let _ = cloud_mcp_send_client_action_ack(
                &state,
                &ack_event,
                action_kind,
                "applied",
                Some(&ack_entity_id),
                None,
            )
            .await;
        });
    }

    todo_dispatch_terminal_runtime_mark_busy(&pane_id);
    let _ = todo_dispatch_record_receipt_internal(
        Some(app),
        workspace_id,
        json!({
            "command_id": command_id,
            "item_id": item_id,
            "pane_id": pane_id,
            "prompt_event_id": prompt_event_id.clone(),
            "submitted_at": submitted_at.clone(),
            "status": "submitted",
            "status_reason": "todo_queue_backend_submit",
            "attachment_count": prepared.attachments.len(),
            "attachment_delivery": if prepared.attachments.is_empty() { "none" } else { "native_bracketed_paste" },
            "text": prompt.chars().take(180).collect::<String>(),
            "thread_id": thread_id,
            "workspace_id": workspace_id,
            "workspace_name": workspace_name,
        }),
        "backend_dispatch",
    );
    todo_dispatch_journal_append(
        workspace_id,
        json!({
            "command_id": command_id,
            "dispatch_id": dispatch_id,
            "item_id": item_id,
            "pane_id": pane_id,
            "prompt_event_id": prompt_event_id,
            "submitted_at": submitted_at,
            "terminal_index": target.get("terminal_index").cloned().unwrap_or(Value::Null),
            "attachment_count": prepared.attachments.len(),
            "attachment_delivery": if prepared.attachments.is_empty() { "none" } else { "native_bracketed_paste" },
            "text": prompt.chars().take(500).collect::<String>(),
            "thread_id": thread_id,
            "todo_id": todo_id,
            "workspace_id": workspace_id,
        }),
    );

    // Mark the queue snapshot item running so restarts and the restored
    // webview see the dispatch.
    let mut running_item = None;
    if let Some(path) = todo_dispatch_data_path("queues", workspace_id) {
        let _store_guard = todo_dispatch_queue_store_guard();
        let snapshot = todo_dispatch_queue_read(&path);
        if let Some(items) = snapshot.get("items").and_then(Value::as_array) {
            let next_items = items
                .iter()
                .cloned()
                .map(|mut entry| {
                    if todo_store_items_share_identity(&entry, item) {
                        todo_store_set_item_status(
                            &mut entry,
                            "running",
                            "todo_queue_backend_submit",
                        );
                        let target_agent = todo_dispatch_backend_target_agent(&entry, target);
                        if let Some(object) = entry.as_object_mut() {
                            object.insert("command_id".to_string(), json!(command_id.clone()));
                            object.insert("dispatch_id".to_string(), json!(dispatch_id.clone()));
                            object
                                .insert("last_dispatch_id".to_string(), json!(dispatch_id.clone()));
                            object.insert("todo_id".to_string(), json!(todo_id.clone()));
                            object.insert("target_terminal_id".to_string(), json!(pane_id.clone()));
                            object.insert("pane_id".to_string(), json!(pane_id.clone()));
                            object.insert("terminal_instance_id".to_string(), json!(instance.id));
                            object.insert("target_thread_id".to_string(), json!(thread_id.clone()));
                            object.insert("thread_id".to_string(), json!(thread_id.clone()));
                            object.insert(
                                "workspace_name".to_string(),
                                json!(workspace_name.clone()),
                            );
                            if let Some(terminal_index) = target.get("terminal_index").cloned() {
                                object.insert("target_terminal_index".to_string(), terminal_index);
                            }
                            if !target_agent.is_empty() {
                                object.insert("target_agent_id".to_string(), json!(target_agent));
                            }
                            if let Some(provider_session_id) = target
                                .get("provider_session_id")
                                .and_then(Value::as_str)
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                            {
                                object.insert(
                                    "provider_session_id".to_string(),
                                    json!(provider_session_id),
                                );
                            }
                        }
                        running_item = Some(entry.clone());
                    }
                    entry
                })
                .collect::<Vec<_>>();
            todo_dispatch_queue_write(workspace_id, &next_items);
            todo_store_orphan_sweep_trigger("todo_queue_backend_submit");
        }
    }
    if let Some(running_item) = running_item {
        todo_store_push_corrections(
            app,
            workspace_id,
            vec![running_item.clone()],
            "todo_queue_backend_submit",
        );
        todo_store_emit_changed(app, workspace_id, "todo_queue_backend_submit", "store");
        todo_dispatch_emit_loopspace_batch_lifecycle(app, &running_item);
        todo_dispatch_enqueue_todo_sync_commit(
            app,
            workspace_id,
            &workspace_name,
            &repo_path,
            running_item,
            "todo_queue_backend_submit",
        )
        .await;
    }

    log_terminal_status_event(
        "backend.todo_dispatch.backend_submitted",
        json!({
            "command_id": command_id,
            "item_id": item_id,
            "attachment_count": prepared.attachments.len(),
            "attachment_delivery": if prepared.attachments.is_empty() { "none" } else { "native_bracketed_paste" },
            "pane_id": pane_id,
            "workspace_id": workspace_id,
        }),
    );
    true
}

#[tauri::command(rename_all = "snake_case")]
async fn todo_dispatch_backend_submit_now(
    app: AppHandle,
    workspace_id: String,
    item: Value,
    target: Value,
    prompt_event_id: Option<String>,
) -> Result<Value, String> {
    let workspace_id = workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id is required.".to_string());
    }
    if todo_dispatch_startup_reconcile_active() {
        return Err("startup_reconciliation_active".to_string());
    }
    let tick_lock = TODO_DISPATCH_BACKEND_TICK_LOCK.get_or_init(|| Mutex::new(()));
    let _tick_guard = tick_lock.lock().await;

    let item = tauri::async_runtime::spawn_blocking({
        let workspace_id = workspace_id.clone();
        let target = target.clone();
        let prompt_event_id = prompt_event_id.clone();
        move || {
            todo_dispatch_prepare_immediate_backend_item(
                &workspace_id,
                item,
                &target,
                prompt_event_id.as_deref(),
            )
        }
    })
    .await
    .map_err(|error| format!("Todo backend submit worker failed: {error}"))??;

    if todo_dispatch_target_is_swarm(&target)
        && !todo_dispatch_backend_swarm_can_start(&app, &workspace_id, &target).await
    {
        return Err("target_swarm_not_ready".to_string());
    }

    let Some(claimed_item) = todo_dispatch_backend_try_claim_item(&workspace_id, &item, &target)
    else {
        return Err("todo_dispatch_claim_failed".to_string());
    };
    let submitted = todo_dispatch_backend_submit(&app, &workspace_id, &claimed_item, &target).await;
    if !submitted {
        todo_dispatch_backend_release_claim(
            &workspace_id,
            &claimed_item,
            "todo_queue_backend_submit_failed_requeue",
        );
        let pane_id = todo_dispatch_text(&target, &["pane_id", "target_terminal_id"]);
        let target_instance_id = target
            .get("instance_id")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        if !pane_id.is_empty()
            && todo_dispatch_pane_input_ready_authoritative(&app, &pane_id, target_instance_id)
                .await
                != Some(true)
        {
            return Err("target_terminal_not_input_ready".to_string());
        }
        return Err("Unable to submit todo to the target terminal.".to_string());
    }

    Ok(json!({
        "ok": true,
        "item_id": todo_store_item_sync_id(&claimed_item),
        "prompt_event_id": prompt_event_id.unwrap_or_default(),
        "workspace_id": workspace_id,
    }))
}

async fn todo_dispatch_backend_tick(app: &AppHandle) {
    let tick_lock = TODO_DISPATCH_BACKEND_TICK_LOCK.get_or_init(|| Mutex::new(()));
    let Ok(_tick_guard) = tick_lock.try_lock() else {
        log_terminal_status_event(
            "backend.todo_dispatch.backend_tick_skip",
            json!({
                "reason": "dispatch_already_running",
            }),
        );
        return;
    };
    if todo_dispatch_startup_reconcile_active() {
        log_terminal_status_event(
            "backend.todo_dispatch.backend_tick_wait",
            json!({
                "reason": "startup_reconciliation_active",
                "remaining_ms": todo_dispatch_startup_reconcile_payload("backend_tick")
                    .get("remaining_ms")
                    .cloned()
                    .unwrap_or(Value::Null),
            }),
        );
        return;
    }
    let mut busy = HashSet::new();
    for path in todo_dispatch_data_workspace_files("queues") {
        let snapshot = todo_dispatch_queue_read(&path);
        let workspace_id = snapshot
            .get("workspace_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .to_string();
        if workspace_id.is_empty() {
            continue;
        }
        let items = snapshot
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for item in items {
            if !todo_dispatch_backend_item_dispatchable(&item) {
                continue;
            }
            let Some(target) =
                todo_dispatch_backend_pick_target(app, &workspace_id, &item, &busy).await
            else {
                todo_dispatch_maybe_schedule_workspace_activation(app, &workspace_id, &item);
                continue;
            };
            if todo_dispatch_target_is_swarm(&target)
                && !todo_dispatch_backend_swarm_can_start(app, &workspace_id, &target).await
            {
                continue;
            }
            let pane_id = target
                .get("pane_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let Some(claimed_item) =
                todo_dispatch_backend_try_claim_item(&workspace_id, &item, &target)
            else {
                continue;
            };
            if todo_dispatch_backend_submit(app, &workspace_id, &claimed_item, &target).await {
                if !todo_dispatch_target_is_swarm(&target) && !pane_id.is_empty() {
                    busy.insert(pane_id);
                }
            } else {
                todo_dispatch_backend_release_claim(
                    &workspace_id,
                    &claimed_item,
                    "todo_queue_backend_submit_failed_requeue",
                );
            }
        }
    }
}

pub(crate) fn todo_dispatch_wake_background_dispatcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(25)).await;
        if APP_SHUTDOWN_PHASE.load(Ordering::Acquire) != APP_SHUTDOWN_PHASE_RUNNING {
            return;
        }
        todo_dispatch_backend_tick(&app).await;
    });
}

/// Rust-owned queued-todo dispatcher. Most work is event-woken; this periodic
/// tick catches missed readiness events without polling aggressively.
pub(crate) fn todo_dispatch_start_background_dispatcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut queue_fingerprint: Option<Vec<TodoDispatchQueueFileFingerprint>> = None;
        let mut tick_count = 0u64;
        loop {
            sleep(Duration::from_millis(TODO_DISPATCH_BACKEND_TICK_MS)).await;
            if APP_SHUTDOWN_PHASE.load(Ordering::Acquire) != APP_SHUTDOWN_PHASE_RUNNING {
                continue;
            }
            tick_count = tick_count.wrapping_add(1);
            let next_queue_fingerprint = todo_dispatch_queue_files_fingerprint();
            let queue_changed = queue_fingerprint.as_ref() != Some(&next_queue_fingerprint);
            let force_full_pass = tick_count % TODO_DISPATCH_BACKEND_SAFETY_FULL_PASS_TICKS == 0;
            if queue_changed || force_full_pass {
                queue_fingerprint = Some(next_queue_fingerprint);
                todo_dispatch_backend_tick(&app).await;
            } else {
                queue_fingerprint = Some(next_queue_fingerprint);
            }
        }
    });
}

fn todo_dispatch_store_workspace_ids() -> Vec<String> {
    let Some(root) =
        cloud_mcp_local_data_file_path("todo-dispatch").map(|root| root.join("receipts"))
    else {
        return Vec::new();
    };
    let Ok(read_dir) = fs::read_dir(&root) else {
        return Vec::new();
    };
    read_dir
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            name.strip_suffix(".json").map(str::to_string)
        })
        .filter(|name| !name.is_empty())
        .collect()
}

/// Mark every in-flight receipt (sending/submitted) as interrupted. Runs on
/// graceful app shutdown (`app_shutdown`) and on startup for crash leftovers
/// (`app_crash_recovered` — nothing can legitimately be in flight when the
/// process has just started). Marked receipts carry `resumePending` so the
/// workspace resume modal can offer to re-dispatch them; queued receipts are
/// durable and stay queued. This also guarantees no receipt can stay
/// "running" forever with no owning process (no orphans).
pub(crate) fn todo_dispatch_mark_active_receipts_interrupted(
    app: Option<&AppHandle>,
    reason: &str,
) -> usize {
    let mut marked = 0usize;
    for workspace_id in todo_dispatch_store_workspace_ids() {
        let receipts = todo_dispatch_load(&workspace_id);
        let Some(entries) = receipts.as_object() else {
            continue;
        };
        let in_flight = entries
            .iter()
            .filter(|(_, receipt)| {
                matches!(
                    receipt.get("status").and_then(Value::as_str),
                    Some("sending") | Some("submitted") | Some("running") | Some("dispatching")
                )
            })
            .map(|(command_id, receipt)| (command_id.clone(), receipt.clone()))
            .collect::<Vec<_>>();
        for (command_id, receipt) in in_flight {
            let mut update = receipt;
            if let Some(object) = update.as_object_mut() {
                object.insert("status".to_string(), json!("interrupted"));
                object.insert("status_reason".to_string(), json!(reason));
                object.insert("resume_pending".to_string(), json!(true));
            }
            if todo_dispatch_record_receipt_internal(app, &workspace_id, update, reason).is_ok() {
                marked += 1;
            }
            log_terminal_status_event(
                "backend.todo_dispatch.interrupted_on_lifecycle",
                json!({
                    "command_id": command_id,
                    "reason": reason,
                    "workspace_id": workspace_id,
                }),
            );
        }
    }
    marked
}

#[tauri::command(rename_all = "snake_case")]
async fn todo_dispatch_receipts_get(workspace_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let receipts = todo_dispatch_load(&workspace_id);
        Ok(todo_dispatch_receipts_payload(
            &workspace_id,
            &receipts,
            "get",
        ))
    })
    .await
    .map_err(|error| format!("Todo dispatch receipts worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn todo_dispatch_receipt_record(
    app: AppHandle,
    workspace_id: String,
    receipt: Value,
    reason: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let command_id = receipt
            .get("command_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let status = receipt
            .get("status")
            .and_then(Value::as_str)
            .map(todo_dispatch_normalize_status)
            .unwrap_or_else(|| "queued".to_string());
        let receipts = todo_dispatch_record_receipt_internal(
            Some(&app),
            &workspace_id,
            receipt,
            reason.as_deref().unwrap_or("frontend_record"),
        )?;
        if let Some(command_id) = command_id.as_deref() {
            if todo_dispatch_status_is_settled(&status) {
                todo_dispatch_queue_mark_settled(Some(&app), &workspace_id, command_id, &status);
            }
        }
        Ok(todo_dispatch_receipts_payload(
            &workspace_id,
            &receipts,
            "record",
        ))
    })
    .await
    .map_err(|error| format!("Todo dispatch record worker failed: {error}"))?
}

/// Frontend-driven drain notification (covers local, receipt-less todos).
/// Routed through Rust so notification policy and dedupe live in one place.
#[tauri::command(rename_all = "snake_case")]
async fn todo_dispatch_notify_queue_drained(
    app: AppHandle,
    workspace_id: String,
    workspace_name: Option<String>,
    last_todo_text: Option<String>,
) -> Result<(), String> {
    todo_dispatch_maybe_notify_drained(
        &app,
        workspace_id.trim(),
        workspace_name.as_deref().unwrap_or_default().trim(),
        last_todo_text.as_deref().unwrap_or_default().trim(),
    );
    Ok(())
}

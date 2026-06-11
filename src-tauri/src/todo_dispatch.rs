// Rust-owned todo dispatch ledger.
//
// This module is the authoritative store for remote-command receipts (the
// ledger the webview previously kept in localStorage), plus the lifecycle
// logic that must survive without a visible window: remote intake recording,
// hook-driven settlement of submitted prompts, queue-drain detection, and
// native notifications. The webview remains the submission actuator and a
// renderer; every state transition flows through here so a background process
// can run the full loop later.

const TODO_DISPATCH_RECEIPTS_UPDATED_EVENT: &str = "todo-dispatch-receipts-updated";
const TODO_DISPATCH_QUEUE_DRAINED_EVENT: &str = "todo-dispatch-queue-drained";
const TODO_DISPATCH_RECEIPT_TTL_MS: u64 = 24 * 60 * 60 * 1000;
const TODO_DISPATCH_RECEIPT_MAX_ITEMS: usize = 400;
const TODO_DISPATCH_DRAIN_NOTIFY_DEDUPE_MS: u64 = 5_000;
const TODO_DISPATCH_ATTENTION_DEDUPE_MS: u64 = 120_000;

static TODO_DISPATCH_RECEIPTS_CACHE: OnceLock<StdMutex<HashMap<String, Value>>> = OnceLock::new();
static TODO_DISPATCH_DRAIN_NOTIFIED_AT: OnceLock<StdMutex<HashMap<String, u64>>> = OnceLock::new();
static TODO_DISPATCH_ATTENTION_NOTIFIED_AT: OnceLock<StdMutex<HashMap<String, u64>>> =
    OnceLock::new();

fn todo_dispatch_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn todo_dispatch_text(value: &Value, keys: &[&str]) -> String {
    let payload = value.get("payload").filter(|nested| nested.is_object());
    for key in keys {
        for source in [Some(value), payload].into_iter().flatten() {
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

/// Mirrors the frontend localStorage key sanitization so the ledger and the
/// webview mirror always agree on workspace identity.
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
        "sending",
        "submitted",
        "completed",
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

fn todo_dispatch_status_is_active(status: &str) -> bool {
    matches!(status, "queued" | "sending" | "submitted")
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
        .get("receivedAtMs")
        .and_then(Value::as_u64)
        .or_else(|| receipt.get("updatedAtMs").and_then(Value::as_u64))
        .unwrap_or(0);
    let updated_at_ms = receipt
        .get("updatedAtMs")
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
        "commandId": receipt
            .get("commandId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(key),
        "itemId": receipt.get("itemId").and_then(Value::as_str).unwrap_or_default(),
        "receivedAtMs": received_at_ms,
        "status": todo_dispatch_normalize_status(
            receipt.get("status").and_then(Value::as_str).unwrap_or_default(),
        ),
        "text": text,
        "updatedAtMs": updated_at_ms,
        "workspaceId": receipt.get("workspaceId").and_then(Value::as_str).unwrap_or_default(),
    });
    // Extra routing/identity fields survive in the Rust store: pane hints let
    // hook settlement match receipts to terminals; device ids keep every todo
    // attributable; status reasons and resume flags drive crash recovery.
    if let Some(object) = normalized.as_object_mut() {
        for key in [
            "paneId",
            "terminalIndex",
            "threadId",
            "deviceId",
            "originDeviceId",
            "targetDeviceId",
            "workspaceName",
            "statusReason",
            "resumePending",
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
            .get("updatedAtMs")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .cmp(&left.1.get("updatedAtMs").and_then(Value::as_u64).unwrap_or(0))
    });
    entries.truncate(TODO_DISPATCH_RECEIPT_MAX_ITEMS);
    Value::Object(entries.into_iter().collect())
}

fn todo_dispatch_load(workspace_id: &str) -> Value {
    let safe_id = todo_dispatch_safe_workspace_id(workspace_id);
    let cache = TODO_DISPATCH_RECEIPTS_CACHE.get_or_init(|| StdMutex::new(HashMap::new()));
    if let Some(cached) = cache
        .lock()
        .ok()
        .and_then(|map| map.get(&safe_id).cloned())
    {
        return cached;
    }
    let loaded = todo_dispatch_store_path(workspace_id)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
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
        if let Ok(bytes) = serde_json::to_vec(receipts) {
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
        "workspaceId": workspace_id,
        "workspace_id": workspace_id,
        "receipts": receipts,
        "reason": reason,
        "updatedAtMs": todo_dispatch_now_ms(),
    })
}

fn todo_dispatch_main_window_focused(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false)
}

/// Send a native notification unless the main window is focused (matching the
/// webview's `suppressWhenFocused` behavior).
fn todo_dispatch_native_notify(app: &AppHandle, title: &str, body: &str) {
    if todo_dispatch_main_window_focused(app) {
        return;
    }
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
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
            "workspaceId": workspace_id,
            "workspaceName": workspace_name,
            "lastTodoText": last_todo_text,
            "atMs": now,
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
        .get("commandId")
        .or_else(|| receipt.get("command_id"))
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
    merged.insert("commandId".to_string(), json!(command_id));
    merged.insert("workspaceId".to_string(), json!(workspace_id));
    merged.insert("updatedAtMs".to_string(), json!(now_ms));
    if !merged.contains_key("receivedAtMs") {
        merged.insert("receivedAtMs".to_string(), json!(now_ms));
    }
    // Every receipt carries the executing device id so todos are always
    // attributable to a device + workspace pair.
    let has_device_id = merged
        .get("deviceId")
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
            merged.insert("deviceId".to_string(), json!(device_id));
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
        .get("workspaceName")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let mut next = current.clone();
    if let Some(object) = next.as_object_mut() {
        object.insert(command_id.clone(), Value::Object(merged));
    }
    let next = todo_dispatch_prune(&next, now_ms);
    let after_active = todo_dispatch_active_count(&next);
    todo_dispatch_save(workspace_id, &next);

    if let Some(app) = app {
        let _ = app.emit(
            TODO_DISPATCH_RECEIPTS_UPDATED_EVENT,
            todo_dispatch_receipts_payload(workspace_id, &next, reason),
        );
        if before_active > 0 && after_active == 0 && status == "completed" {
            todo_dispatch_maybe_notify_drained(app, workspace_id, &workspace_name, &last_text);
        }
    }
    Ok(next)
}

/// Record remote command intake at the websocket loop, before the webview ever
/// sees the event. Create-task commands land in the ledger as `queued` and
/// raise the arrival notification even when no window is alive.
pub(crate) fn todo_dispatch_record_remote_intake(app: &AppHandle, event: &Value) {
    let command_kind = {
        let raw = todo_dispatch_text(
            event,
            &["command_kind", "commandKind", "action", "command"],
        );
        let kind = if raw.is_empty() {
            "create_task".to_string()
        } else {
            raw.to_ascii_lowercase()
        };
        kind.replace(['.', ' ', '-'], "_")
    };
    let is_create_task = matches!(
        command_kind.as_str(),
        "create_task"
            | "remote_command_create_task"
            | "task_create"
            | "todo_create"
    ) || command_kind.is_empty();
    if !is_create_task {
        return;
    }
    let command_id = todo_dispatch_text(event, &["command_id", "commandId"]);
    let workspace_id = todo_dispatch_text(event, &["workspace_id", "workspaceId"]);
    if command_id.is_empty() || workspace_id.is_empty() {
        return;
    }
    let text = todo_dispatch_text(event, &["body", "message", "prompt", "text"]);
    let workspace_name = todo_dispatch_text(event, &["workspace_name", "workspaceName"]);
    let origin_device_id = todo_dispatch_text(
        event,
        &[
            "todo_device_id",
            "todoDeviceId",
            "origin_device_id",
            "originDeviceId",
            "device_id",
            "deviceId",
        ],
    );
    let receipt = json!({
        "commandId": command_id,
        "itemId": command_id,
        "originDeviceId": origin_device_id,
        "status": "queued",
        "text": text.chars().take(180).collect::<String>(),
        "workspaceName": workspace_name.clone(),
    });
    let _ = todo_dispatch_record_receipt_internal(
        Some(app),
        &workspace_id,
        receipt,
        "remote_intake",
    );
    // Headless intake: the remote todo is appended into the Rust queue store
    // (matching the webview's commandId-keyed item id) so the background
    // dispatcher can submit it and a later webview mount adopts it from the
    // journal. A mounted TerminalView appends the same id itself and its next
    // queue sync rewrites the store — both paths converge on one item.
    {
        let queue_path = todo_dispatch_data_path("queues", &workspace_id);
        let already_queued = queue_path
            .as_deref()
            .map(|path| {
                todo_dispatch_queue_read(path)
                    .get("items")
                    .and_then(Value::as_array)
                    .is_some_and(|items| {
                        items.iter().any(|item| {
                            item.get("id").and_then(Value::as_str).map(str::trim)
                                == Some(command_id.as_str())
                                || todo_dispatch_queue_item_command_id(item) == command_id
                        })
                    })
            })
            .unwrap_or(false);
        if !already_queued && !text.trim().is_empty() {
            let now_iso = chrono_like_now_iso();
            let item = json!({
                "id": command_id,
                "kind": "todo",
                "text": text,
                "todoStatus": "queued",
                "status": "queued",
                "createdAt": now_iso,
                "updatedAt": now_iso,
                "workspaceId": workspace_id,
                "targetTerminalId": todo_dispatch_text(
                    event,
                    &["target_terminal_id", "targetTerminalId"],
                ),
                "targetThreadId": todo_dispatch_text(
                    event,
                    &["target_thread_id", "targetThreadId"],
                ),
                "targetAgentId": todo_dispatch_text(
                    event,
                    &["target_agent_id", "targetAgentId", "agent_id", "agentId"],
                ),
                "remoteCommand": {
                    "commandId": command_id,
                    "todoId": todo_dispatch_text(event, &["todo_id", "todoId"]),
                    "originDeviceId": origin_device_id,
                    "source": "remote_intake_headless",
                },
            });
            if let Some(path) = queue_path.as_deref() {
                let mut items = todo_dispatch_queue_read(path)
                    .get("items")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                items.push(item.clone());
                todo_dispatch_queue_write(&workspace_id, &items);
            }
            todo_dispatch_journal_append(
                &workspace_id,
                json!({
                    "kind": "remote_todo_created",
                    "itemId": command_id,
                    "commandId": command_id,
                    "item": item,
                    "at": chrono_like_now_iso(),
                }),
            );
            // Cloud convergence only when the webview cannot own it; a live
            // webview pushes a fresher snapshot from its own queue state.
            if !todo_dispatch_webview_dispatcher_active() {
                todo_dispatch_push_queue_snapshot(
                    app,
                    &workspace_id,
                    Vec::new(),
                    "remote_todo_intake_headless",
                );
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
    todo_dispatch_native_notify(app, &title, &body);
}

fn todo_dispatch_attention_should_notify(key: String) -> bool {
    let now = todo_dispatch_now_ms();
    let dedupe = TODO_DISPATCH_ATTENTION_NOTIFIED_AT.get_or_init(|| StdMutex::new(HashMap::new()));
    let Ok(mut map) = dedupe.lock() else {
        return true;
    };
    map.retain(|_, at| now.saturating_sub(*at) < TODO_DISPATCH_ATTENTION_DEDUPE_MS);
    if map.contains_key(&key) {
        return false;
    }
    map.insert(key, now);
    true
}

/// Observe terminal activity hook lifecycle payloads at their Rust emit site.
/// Handles: attention notifications (approval / user input required) and
/// settlement of submitted receipts on provider turn completion.
pub(crate) fn todo_dispatch_observe_activity_hook(
    app: &AppHandle,
    payload: &TerminalActivityHookPayload,
) {
    todo_dispatch_update_terminal_runtime(payload);
    let event_type = payload.event_type.trim().to_ascii_lowercase();

    let needs_attention = payload.manual_approval_required
        || payload.terminal_is_prompting_user
        || matches!(
            event_type.as_str(),
            "provider-manual-approval-required" | "provider-user-input-required"
        );
    if needs_attention {
        let dedupe_key = format!(
            "{}::{}::{}",
            payload.pane_id,
            event_type,
            payload
                .approval_id
                .as_deref()
                .or(payload.permission_request_id.as_deref())
                .or(payload.tool_use_id.as_deref())
                .unwrap_or("attention"),
        );
        if todo_dispatch_attention_should_notify(dedupe_key) {
            let workspace_name = payload.workspace_name.trim();
            let title = "Diff Forge: approval required";
            let body = if workspace_name.is_empty() {
                "A coding agent terminal is waiting on a tool approval.".to_string()
            } else {
                format!("A coding agent in {workspace_name} is waiting on a tool approval.")
            };
            todo_dispatch_native_notify(app, title, &body);
        }
    }

    let settle_status = match event_type.as_str() {
        "provider-turn-completed" => Some("completed"),
        "provider-turn-error" => Some("failed"),
        "provider-turn-interrupted" => Some("interrupted"),
        _ => None,
    };
    let Some(settle_status) = settle_status else {
        return;
    };
    let workspace_id = payload.workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return;
    }
    let receipts = todo_dispatch_load(&workspace_id);
    let Some(entries) = receipts.as_object() else {
        return;
    };
    let submitted = entries
        .iter()
        .filter(|(_, receipt)| {
            receipt.get("status").and_then(Value::as_str) == Some("submitted")
        })
        .collect::<Vec<_>>();
    if submitted.is_empty() {
        return;
    }
    let pane_id = payload.pane_id.trim();
    // Match conservatively: an explicit pane match, otherwise only when a
    // single submitted receipt exists for the workspace. The webview applies
    // richer thread-level matching when it is alive; this path exists so the
    // loop closes when it is not.
    let matched = submitted
        .iter()
        .find(|(_, receipt)| {
            !pane_id.is_empty()
                && receipt.get("paneId").and_then(Value::as_str).map(str::trim)
                    == Some(pane_id)
        })
        .or(if submitted.len() == 1 {
            submitted.first()
        } else {
            None
        })
        .map(|(command_id, receipt)| ((*command_id).clone(), (*receipt).clone()));
    let Some((command_id, receipt)) = matched else {
        return;
    };
    let mut update = receipt;
    if let Some(object) = update.as_object_mut() {
        object.insert("status".to_string(), json!(settle_status));
        if object
            .get("workspaceName")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .is_empty()
            && !payload.workspace_name.trim().is_empty()
        {
            object.insert(
                "workspaceName".to_string(),
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
    todo_dispatch_queue_mark_settled(&workspace_id, &command_id, settle_status);
    log_terminal_status_event(
        "backend.todo_dispatch.hook_settled",
        json!({
            "command_id": command_id,
            "event_type": event_type,
            "pane_id": payload.pane_id,
            "status": settle_status,
            "workspace_id": workspace_id,
        }),
    );
}

// ---------------------------------------------------------------------------
// Background dispatcher readiness: queue snapshots, terminal runtime
// registry, webview dispatcher lease, backend prompt submission, and the
// replay journal. The Rust dispatcher stays dormant while the webview
// heartbeats (it owns dispatch when alive); once background mode hides or
// destroys the window, Rust takes over queued-todo submission seamlessly.
// ---------------------------------------------------------------------------

const TODO_DISPATCH_DISPATCHER_LEASE_MS: u64 = 15_000;
const TODO_DISPATCH_BACKEND_TICK_MS: u64 = 5_000;
const TODO_DISPATCH_TERMINAL_RUNTIME_TTL_MS: u64 = 6 * 60 * 60 * 1000;
const TODO_DISPATCH_JOURNAL_MAX_ENTRIES: usize = 200;

static TODO_DISPATCH_WEBVIEW_HEARTBEAT_MS: AtomicU64 = AtomicU64::new(0);
static TODO_DISPATCH_TERMINAL_RUNTIME: OnceLock<StdMutex<HashMap<String, Value>>> =
    OnceLock::new();

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

fn todo_dispatch_queue_read(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or_else(|| json!({}))
}

fn todo_dispatch_queue_write(workspace_id: &str, items: &[Value]) {
    let Some(path) = todo_dispatch_data_path("queues", workspace_id) else {
        return;
    };
    let snapshot = json!({
        "workspaceId": workspace_id,
        "items": items,
        "updatedAtMs": todo_dispatch_now_ms(),
    });
    if let Ok(bytes) = serde_json::to_vec(&snapshot) {
        let _ = fs::write(path, bytes);
    }
}

/// Terminal runtime registry, fed by activity hook payloads: pane id ->
/// workspace, agent kind, thread, index, instance, and input-ready state.
/// This is what lets Rust pick a dispatch target without the webview.
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
            .get("updatedAtMs")
            .and_then(Value::as_u64)
            .is_some_and(|at| now.saturating_sub(at) < TODO_DISPATCH_TERMINAL_RUNTIME_TTL_MS)
    });
    map.insert(
        pane_id.to_string(),
        json!({
            "agentId": payload.agent_id,
            "agentKind": payload.agent_kind,
            "inputReady": payload.input_ready,
            "instanceId": payload.instance_id,
            "paneId": pane_id,
            "terminalIndex": payload.terminal_index,
            "threadId": payload.thread_id,
            "updatedAtMs": now,
            "workspaceId": payload.workspace_id.trim(),
            "workspaceName": payload.workspace_name.trim(),
        }),
    );
}

fn todo_dispatch_terminal_runtime_mark_busy(pane_id: &str) {
    let registry = TODO_DISPATCH_TERMINAL_RUNTIME.get_or_init(|| StdMutex::new(HashMap::new()));
    if let Ok(mut map) = registry.lock() {
        if let Some(entry) = map.get_mut(pane_id) {
            if let Some(object) = entry.as_object_mut() {
                object.insert("inputReady".to_string(), json!(false));
                object.insert("updatedAtMs".to_string(), json!(todo_dispatch_now_ms()));
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

fn todo_dispatch_queue_item_command_id(item: &Value) -> String {
    item.get("remoteCommand")
        .and_then(|remote| remote.get("commandId").or_else(|| remote.get("command_id")))
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

/// Settlement bridge from receipts into the queue snapshot: completed items
/// leave the queue (matching the webview's consume behavior); failures and
/// interruptions keep the item with its final status.
fn todo_dispatch_queue_mark_settled(workspace_id: &str, command_id: &str, status: &str) {
    let Some(path) = todo_dispatch_data_path("queues", workspace_id) else {
        return;
    };
    let snapshot = todo_dispatch_queue_read(&path);
    let Some(items) = snapshot.get("items").and_then(Value::as_array).cloned() else {
        return;
    };
    let mut changed = false;
    let now_iso = chrono_like_now_iso();
    let next_items = items
        .into_iter()
        .filter_map(|mut item| {
            if todo_dispatch_queue_item_command_id(&item) != command_id {
                return Some(item);
            }
            changed = true;
            if status == "completed" {
                return None;
            }
            if let Some(object) = item.as_object_mut() {
                object.insert("todoStatus".to_string(), json!(status));
                object.insert("status".to_string(), json!(status));
                object.insert("updatedAt".to_string(), json!(now_iso.clone()));
                object.insert("reason".to_string(), json!("todo_queue_backend_settled"));
            }
            Some(item)
        })
        .collect::<Vec<_>>();
    if changed {
        todo_dispatch_queue_write(workspace_id, &next_items);
    }
}

fn chrono_like_now_iso() -> String {
    crate::coordination::kernel::now_rfc3339()
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
        entry.get("workspaceId").and_then(Value::as_str) == Some(workspace_id)
            && entry.get("inputReady").and_then(Value::as_bool) == Some(false)
            && entry
                .get("updatedAtMs")
                .and_then(Value::as_u64)
                .is_some_and(|at| now.saturating_sub(at) < TODO_DISPATCH_TERMINAL_RUNTIME_TTL_MS)
    })
}

pub(crate) fn todo_dispatch_webview_dispatcher_active() -> bool {
    let heartbeat = TODO_DISPATCH_WEBVIEW_HEARTBEAT_MS.load(Ordering::Acquire);
    heartbeat != 0
        && todo_dispatch_now_ms().saturating_sub(heartbeat) < TODO_DISPATCH_DISPATCHER_LEASE_MS
}

/// Headless cloud convergence: push the Rust queue store as the authoritative
/// todo snapshot (plus explicit removals) after a Rust-side queue mutation.
/// Rides the durable outbox, so it also works offline.
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
    let workspace_id = workspace_id.to_string();
    let reason = reason.to_string();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<CloudMcpState>().inner().clone();
        let mut payload = json!({ "todos": items });
        if !removed_todo_ids.is_empty() {
            payload["removed_todo_ids"] = json!(removed_todo_ids.clone());
            payload["removedTodoIds"] = json!(removed_todo_ids);
        }
        let _ = cloud_mcp_sync_workspace_todos_internal(
            &state,
            String::new(),
            workspace_id,
            None,
            payload,
            Some(reason),
        )
        .await;
    });
}

/// Headless remote todo delete: applied directly to the Rust queue store so
/// the lever works with the window closed; the journal entry reconciles the
/// webview's localStorage mirror on restore. Idempotent next to the webview
/// path (both remove the same id).
pub(crate) fn todo_dispatch_apply_remote_delete(app: &AppHandle, event: &Value) {
    let command_kind = todo_dispatch_text(
        event,
        &["command_kind", "commandKind", "action", "command"],
    )
    .to_ascii_lowercase()
    .replace(['.', ' ', '-'], "_");
    if !matches!(
        command_kind.as_str(),
        "workspace_todo_delete" | "todo_delete" | "delete_todo" | "delete_task"
            | "remote_todo_delete"
    ) {
        return;
    }
    let workspace_id = todo_dispatch_text(event, &["workspace_id", "workspaceId"]);
    let todo_id = todo_dispatch_text(event, &["todo_id", "todoId", "item_id", "itemId"]);
    if workspace_id.is_empty() || todo_id.is_empty() {
        return;
    }
    let Some(path) = todo_dispatch_data_path("queues", &workspace_id) else {
        return;
    };
    let snapshot = todo_dispatch_queue_read(&path);
    let items = snapshot
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let before = items.len();
    let next_items = items
        .into_iter()
        .filter(|item| {
            let item_id = item
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            item_id != todo_id && todo_dispatch_queue_item_command_id(item) != todo_id
        })
        .collect::<Vec<_>>();
    let removed = next_items.len() != before;
    if removed {
        todo_dispatch_queue_write(&workspace_id, &next_items);
    }
    todo_dispatch_journal_append(
        &workspace_id,
        json!({
            "kind": "remote_todo_deleted",
            "itemId": todo_id,
            "commandId": todo_dispatch_text(event, &["command_id", "commandId"]),
            "at": chrono_like_now_iso(),
            "removedFromQueueStore": removed,
        }),
    );
    // Cloud convergence only when no webview dispatcher is alive: a mounted
    // TerminalView handles the same lever itself and pushes a fresher queue;
    // pushing the (possibly debounce-stale) file copy alongside it could
    // overwrite the webview's snapshot. Unmounted-workspace deletions converge
    // on the next mount via the journal entry above.
    if !todo_dispatch_webview_dispatcher_active() {
        todo_dispatch_push_queue_snapshot(
            app,
            &workspace_id,
            vec![todo_id],
            "remote_todo_delete_headless",
        );
    }
}

#[tauri::command]
fn todo_dispatch_dispatcher_heartbeat() -> Result<(), String> {
    TODO_DISPATCH_WEBVIEW_HEARTBEAT_MS.store(todo_dispatch_now_ms(), Ordering::Release);
    Ok(())
}

#[tauri::command]
async fn todo_dispatch_queue_sync(
    workspace_id: String,
    items: Value,
    reason: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_id = workspace_id.trim().to_string();
        if workspace_id.is_empty() {
            return Err("workspace_id is required.".to_string());
        }
        let items = items
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|item| item.is_object())
            .collect::<Vec<_>>();
        todo_dispatch_queue_write(&workspace_id, &items);
        Ok(json!({
            "workspaceId": workspace_id,
            "itemCount": items.len(),
            "reason": reason.unwrap_or_default(),
        }))
    })
    .await
    .map_err(|error| format!("Todo dispatch queue sync worker failed: {error}"))?
}

/// Returns and clears the backend-submission journal for a workspace so the
/// restored webview can reconcile statuses and thread state.
#[tauri::command]
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
        Ok(json!({ "entries": entries, "workspaceId": workspace_id }))
    })
    .await
    .map_err(|error| format!("Todo dispatch journal drain worker failed: {error}"))?
}

/// Full queue snapshot for one workspace, as last pushed by the webview (or
/// updated by backend dispatch/settlement). This is the local-first source
/// the Todos History view reads so listed todos show without any cloud
/// round-trip.
#[tauri::command]
async fn todo_dispatch_queue_get(workspace_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_id = workspace_id.trim().to_string();
        if workspace_id.is_empty() {
            return Err("workspace_id is required.".to_string());
        }
        let snapshot = todo_dispatch_data_path("queues", &workspace_id)
            .map(|path| todo_dispatch_queue_read(&path))
            .unwrap_or_else(|| json!({}));
        Ok(json!({
            "workspaceId": workspace_id,
            "items": snapshot.get("items").cloned().unwrap_or_else(|| json!([])),
            "updatedAtMs": snapshot.get("updatedAtMs").cloned().unwrap_or(json!(0)),
        }))
    })
    .await
    .map_err(|error| format!("Todo dispatch queue get worker failed: {error}"))?
}

/// Aggregated view of every workspace queue snapshot for the background
/// monitor window: items grouped by lifecycle bucket with workspace labels
/// resolved best-effort from the terminal runtime registry.
#[tauri::command]
async fn todo_dispatch_overview() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let workspace_names = TODO_DISPATCH_TERMINAL_RUNTIME
            .get_or_init(|| StdMutex::new(HashMap::new()))
            .lock()
            .map(|map| {
                map.values()
                    .filter_map(|entry| {
                        let workspace_id = entry.get("workspaceId").and_then(Value::as_str)?;
                        let workspace_name = entry
                            .get("workspaceName")
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
        for path in todo_dispatch_data_workspace_files("queues") {
            let snapshot = todo_dispatch_queue_read(&path);
            let workspace_id = snapshot
                .get("workspaceId")
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
                .unwrap_or_default()
                .into_iter()
                .map(|item| {
                    let status = item
                        .get("todoStatus")
                        .or_else(|| item.get("status"))
                        .and_then(Value::as_str)
                        .unwrap_or("listed")
                        .to_string();
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
                        "targetTerminalIndex": item.get("targetTerminalIndex").cloned().unwrap_or(Value::Null),
                        "text": item
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .chars()
                            .take(180)
                            .collect::<String>(),
                        "updatedAt": item.get("updatedAt").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect::<Vec<_>>();
            if items.is_empty() {
                continue;
            }
            workspaces.push(json!({
                "items": items,
                "workspaceId": workspace_id.clone(),
                "workspaceName": workspace_names.get(&workspace_id).cloned().unwrap_or_default(),
            }));
        }
        Ok(json!({
            "counts": { "listed": listed, "queued": queued, "running": running },
            "updatedAtMs": todo_dispatch_now_ms(),
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

fn todo_dispatch_backend_item_dispatchable(item: &Value) -> bool {
    let status = item
        .get("todoStatus")
        .or_else(|| item.get("status"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if status != "queued" {
        return false;
    }
    // Background policy: text-only todos (image attachments need the webview).
    if item.get("image").is_some() || item.get("images").is_some() {
        return false;
    }
    !todo_dispatch_backend_item_text(item).is_empty()
}

fn todo_dispatch_backend_pick_target(workspace_id: &str, item: &Value, busy: &HashSet<String>) -> Option<Value> {
    let registry = TODO_DISPATCH_TERMINAL_RUNTIME.get_or_init(|| StdMutex::new(HashMap::new()));
    let map = registry.lock().ok()?;
    let entries = map
        .values()
        .filter(|entry| {
            entry.get("workspaceId").and_then(Value::as_str) == Some(workspace_id)
                && entry.get("inputReady").and_then(Value::as_bool) == Some(true)
                && entry
                    .get("paneId")
                    .and_then(Value::as_str)
                    .is_some_and(|pane| !busy.contains(pane))
        })
        .cloned()
        .collect::<Vec<_>>();
    if entries.is_empty() {
        return None;
    }
    let target_pane = item
        .get("targetTerminalId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let target_thread = item
        .get("targetThreadId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let target_index = item.get("targetTerminalIndex").and_then(Value::as_u64);
    let target_agent = item
        .get("targetAgentId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let has_explicit_target = target_pane.is_some() || target_thread.is_some() || target_index.is_some();

    let matched = entries
        .iter()
        .find(|entry| {
            target_pane.is_some() && entry.get("paneId").and_then(Value::as_str) == target_pane
        })
        .or_else(|| {
            entries.iter().find(|entry| {
                target_thread.is_some()
                    && entry.get("threadId").and_then(Value::as_str) == target_thread
            })
        })
        .or_else(|| {
            entries.iter().find(|entry| {
                target_index.is_some()
                    && entry.get("terminalIndex").and_then(Value::as_u64) == target_index
            })
        })
        .or_else(|| {
            if has_explicit_target {
                // An explicit target that is not currently available: hold the
                // item instead of sending it somewhere else.
                None
            } else if let Some(agent) = target_agent {
                entries.iter().find(|entry| {
                    entry.get("agentId").and_then(Value::as_str) == Some(agent)
                        || entry.get("agentKind").and_then(Value::as_str) == Some(agent)
                })
            } else {
                entries.first()
            }
        });
    matched.cloned()
}

async fn todo_dispatch_backend_submit(
    app: &AppHandle,
    workspace_id: &str,
    item: &Value,
    target: &Value,
) -> bool {
    let pane_id = target
        .get("paneId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let target_instance_id = target.get("instanceId").and_then(Value::as_u64).unwrap_or(0);
    let prompt = todo_dispatch_backend_item_text(item);
    if pane_id.is_empty() || prompt.is_empty() {
        return false;
    }
    if prompt.len() + TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE.len() > MAX_TERMINAL_WRITE_BYTES {
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

    let item_id = item
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let command_id = todo_dispatch_queue_item_command_id(item);
    let todo_id = item
        .get("todoId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&item_id)
        .to_string();
    let dispatch_id = format!("backend-dispatch-{item_id}");
    let prompt_event_id = format!("backend-todo-{item_id}-{:x}", todo_dispatch_now_ms());
    let thread_id = target
        .get("threadId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let workspace_name = target
        .get("workspaceName")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    // Mirror the proven crash-resume backend submit mechanics: serialize on
    // the input queue, write the prompt, settle, then the submit sequence.
    let _input_guard = instance.input_queue.lock().await;
    {
        let mut writer = instance.writer.lock().await;
        if writer.write_all(prompt.as_bytes()).is_err() || writer.flush().is_err() {
            return false;
        }
    }
    sleep(Duration::from_millis(TERMINAL_PARKED_RESUME_SUBMIT_DELAY_MS)).await;
    {
        let still_current = {
            let guard = terminal_state.terminals.read().await;
            guard
                .get(&pane_id)
                .map(|current| current.id == instance.id)
                .unwrap_or(false)
        };
        if !still_current {
            return false;
        }
        let mut writer = instance.writer.lock().await;
        if writer
            .write_all(TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE.as_bytes())
            .is_err()
            || writer.flush().is_err()
        {
            return false;
        }
    }

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

    todo_dispatch_terminal_runtime_mark_busy(&pane_id);
    let _ = todo_dispatch_record_receipt_internal(
        Some(app),
        workspace_id,
        json!({
            "commandId": command_id,
            "itemId": item_id,
            "paneId": pane_id,
            "status": "submitted",
            "statusReason": "todo_queue_backend_submit",
            "text": prompt.chars().take(180).collect::<String>(),
            "threadId": thread_id,
            "workspaceName": workspace_name,
        }),
        "backend_dispatch",
    );
    todo_dispatch_journal_append(
        workspace_id,
        json!({
            "commandId": command_id,
            "dispatchId": dispatch_id,
            "itemId": item_id,
            "paneId": pane_id,
            "promptEventId": prompt_event_id,
            "submittedAt": submitted_at,
            "terminalIndex": target.get("terminalIndex").cloned().unwrap_or(Value::Null),
            "text": prompt.chars().take(500).collect::<String>(),
            "threadId": thread_id,
            "todoId": todo_id,
            "workspaceId": workspace_id,
        }),
    );

    // Mark the queue snapshot item running so restarts and the restored
    // webview see the dispatch.
    if let Some(path) = todo_dispatch_data_path("queues", workspace_id) {
        let snapshot = todo_dispatch_queue_read(&path);
        if let Some(items) = snapshot.get("items").and_then(Value::as_array) {
            let next_items = items
                .iter()
                .cloned()
                .map(|mut entry| {
                    if entry.get("id").and_then(Value::as_str) == Some(item_id.as_str()) {
                        if let Some(object) = entry.as_object_mut() {
                            object.insert("todoStatus".to_string(), json!("running"));
                            object.insert("status".to_string(), json!("running"));
                            object.insert("reason".to_string(), json!("todo_queue_backend_submit"));
                            object.insert("updatedAt".to_string(), json!(submitted_at.clone()));
                        }
                    }
                    entry
                })
                .collect::<Vec<_>>();
            todo_dispatch_queue_write(workspace_id, &next_items);
        }
    }

    log_terminal_status_event(
        "backend.todo_dispatch.backend_submitted",
        json!({
            "command_id": command_id,
            "item_id": item_id,
            "pane_id": pane_id,
            "workspace_id": workspace_id,
        }),
    );
    true
}

async fn todo_dispatch_backend_tick(app: &AppHandle) {
    let mut busy = HashSet::new();
    for path in todo_dispatch_data_workspace_files("queues") {
        let snapshot = todo_dispatch_queue_read(&path);
        let workspace_id = snapshot
            .get("workspaceId")
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
            let Some(target) = todo_dispatch_backend_pick_target(&workspace_id, &item, &busy)
            else {
                continue;
            };
            let pane_id = target
                .get("paneId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if todo_dispatch_backend_submit(app, &workspace_id, &item, &target).await {
                busy.insert(pane_id);
            }
        }
    }
}

/// Dormant while the webview dispatcher heartbeats; takes over queued-todo
/// submission when the webview goes silent (background/windowless mode).
pub(crate) fn todo_dispatch_start_background_dispatcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            sleep(Duration::from_millis(TODO_DISPATCH_BACKEND_TICK_MS)).await;
            if APP_SHUTDOWN_PHASE.load(Ordering::Acquire) != APP_SHUTDOWN_PHASE_RUNNING {
                continue;
            }
            let heartbeat = TODO_DISPATCH_WEBVIEW_HEARTBEAT_MS.load(Ordering::Acquire);
            if heartbeat == 0 {
                // No webview dispatcher has ever announced itself this
                // session; stay dormant until background mode hands over.
                continue;
            }
            let now = todo_dispatch_now_ms();
            if now.saturating_sub(heartbeat) < TODO_DISPATCH_DISPATCHER_LEASE_MS {
                continue;
            }
            todo_dispatch_backend_tick(&app).await;
        }
    });
}

fn todo_dispatch_store_workspace_ids() -> Vec<String> {
    let Some(root) = cloud_mcp_local_data_file_path("todo-dispatch").map(|root| root.join("receipts"))
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
                    Some("sending") | Some("submitted")
                )
            })
            .map(|(command_id, receipt)| (command_id.clone(), receipt.clone()))
            .collect::<Vec<_>>();
        for (command_id, receipt) in in_flight {
            let mut update = receipt;
            if let Some(object) = update.as_object_mut() {
                object.insert("status".to_string(), json!("interrupted"));
                object.insert("statusReason".to_string(), json!(reason));
                object.insert("resumePending".to_string(), json!(true));
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

#[tauri::command]
async fn todo_dispatch_receipts_get(workspace_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let receipts = todo_dispatch_load(&workspace_id);
        Ok(todo_dispatch_receipts_payload(&workspace_id, &receipts, "get"))
    })
    .await
    .map_err(|error| format!("Todo dispatch receipts worker failed: {error}"))?
}

#[tauri::command]
async fn todo_dispatch_receipt_record(
    app: AppHandle,
    workspace_id: String,
    receipt: Value,
    reason: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let receipts = todo_dispatch_record_receipt_internal(
            Some(&app),
            &workspace_id,
            receipt,
            reason.as_deref().unwrap_or("frontend_record"),
        )?;
        Ok(todo_dispatch_receipts_payload(&workspace_id, &receipts, "record"))
    })
    .await
    .map_err(|error| format!("Todo dispatch record worker failed: {error}"))?
}

/// One-time legacy import: merges the webview's localStorage receipts into the
/// Rust store, newest `updatedAtMs` wins per command id.
#[tauri::command]
async fn todo_dispatch_receipts_import(
    app: AppHandle,
    workspace_id: String,
    receipts: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let now_ms = todo_dispatch_now_ms();
        let current = todo_dispatch_load(&workspace_id);
        let mut next = current.clone();
        let mut imported = 0usize;
        if let (Some(target), Some(incoming)) = (next.as_object_mut(), receipts.as_object()) {
            for (key, receipt) in incoming {
                let Some(normalized) = todo_dispatch_normalize_receipt(key, receipt, now_ms) else {
                    continue;
                };
                let incoming_updated = normalized
                    .get("updatedAtMs")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                let existing_updated = target
                    .get(key)
                    .and_then(|existing| existing.get("updatedAtMs"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                if incoming_updated > existing_updated {
                    target.insert(key.clone(), normalized);
                    imported += 1;
                }
            }
        }
        let next = todo_dispatch_prune(&next, now_ms);
        if imported > 0 {
            todo_dispatch_save(&workspace_id, &next);
            let _ = app.emit(
                TODO_DISPATCH_RECEIPTS_UPDATED_EVENT,
                todo_dispatch_receipts_payload(&workspace_id, &next, "import"),
            );
        }
        Ok(todo_dispatch_receipts_payload(&workspace_id, &next, "import"))
    })
    .await
    .map_err(|error| format!("Todo dispatch import worker failed: {error}"))?
}

/// Frontend-driven drain notification (covers local, receipt-less todos).
/// Routed through Rust so notification policy and dedupe live in one place.
#[tauri::command]
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

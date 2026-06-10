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

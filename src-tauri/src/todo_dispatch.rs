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
        "running",
        "dispatching",
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
    let status = status
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' '], "_");
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
        "completed" | "failed" | "interrupted" | "cancelled" | "timed_out"
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
            "pane_id",
            "terminalIndex",
            "terminal_index",
            "terminalId",
            "terminal_id",
            "terminalInstanceId",
            "terminal_instance_id",
            "agentKind",
            "agent_kind",
            "providerSessionId",
            "provider_session_id",
            "sessionId",
            "session_id",
            "threadId",
            "thread_id",
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
            .cmp(
                &left
                    .1
                    .get("updatedAtMs")
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

/// Send a native notification unless the main window is focused (matching the
/// webview's `suppressWhenFocused` behavior).
fn todo_dispatch_native_notify(app: &AppHandle, title: &str, body: &str) {
    let _ = diffforge_native_notify(
        app,
        title,
        body,
        NativeNotificationUrgency::Normal,
        true,
    );
}

fn todo_dispatch_native_attention_notify(app: &AppHandle, title: &str, body: &str) {
    let _ = diffforge_native_notify(
        app,
        title,
        body,
        NativeNotificationUrgency::Attention,
        false,
    );
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
        let raw = todo_dispatch_text(event, &["command_kind", "commandKind", "action", "command"]);
        let kind = if raw.is_empty() {
            "create_task".to_string()
        } else {
            raw.to_ascii_lowercase()
        };
        kind.replace(['.', ' ', '-'], "_")
    };
    let is_create_task = matches!(
        command_kind.as_str(),
        "create_task" | "remote_command_create_task" | "task_create" | "todo_create"
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
    let _ =
        todo_dispatch_record_receipt_internal(Some(app), &workspace_id, receipt, "remote_intake");
    // Headless intake: the remote todo is appended into the Rust queue store
    // (matching the webview's commandId-keyed item id) so the background
    // dispatcher can submit it and a later webview mount adopts it from the
    // journal. A mounted TerminalView appends the same id itself and its next
    // queue sync rewrites the store — both paths converge on one item.
    {
        let queue_path = todo_dispatch_data_path("queues", &workspace_id);
        let tombstoned = todo_store_tombstone_ids(&workspace_id);
        let already_queued = tombstoned.contains(command_id.as_str())
            || queue_path
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

fn todo_dispatch_normalize_activity_hook_event_type(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(['_', ' '], "-")
}

/// Observe terminal activity hook lifecycle payloads at their Rust emit site.
/// Handles: attention notifications (approval / user input required) and
/// settlement of submitted receipts on provider turn completion.
pub(crate) fn todo_dispatch_observe_activity_hook(
    app: &AppHandle,
    payload: &TerminalActivityHookPayload,
) {
    todo_dispatch_update_terminal_runtime(payload);
    let event_type = todo_dispatch_normalize_activity_hook_event_type(&payload.event_type);

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
            todo_dispatch_native_attention_notify(app, title, &body);
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
            .map(|(command_id, receipt)| {
                let receipt_pane_id = receipt
                    .get("paneId")
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
                            "promptEventId",
                            "prompt_event_id",
                            "promptId",
                            "prompt_id",
                            "providerTurnId",
                            "provider_turn_id",
                            "turnId",
                            "turn_id",
                        ],
                    ),
                    command_id.clone(),
                ];
                let turn_score = if !turn_refs.is_empty()
                    && receipt_turn_refs.iter().any(|candidate| {
                        let candidate = candidate.trim();
                        !candidate.is_empty() && turn_refs.iter().any(|turn_ref| turn_ref == candidate)
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
        if matches.is_empty() && active.len() == 1 {
            matches = active.clone();
        }
        matches.sort_by(|left, right| {
            right
                .3
                .cmp(&left.3)
                .then_with(|| right.2.cmp(&left.2))
        });
        matches.first().cloned().map(|(command_id, receipt, _, score)| {
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
        let queue_candidates = todo_dispatch_active_queue_item_ids_for_pane(&workspace_id, pane_id);
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
                "commandId": command_id,
                "itemId": command_id,
                "paneId": pane_id,
                "status": "submitted",
                "text": payload.message.as_deref().or(payload.user_message.as_deref()).unwrap_or_default().chars().take(180).collect::<String>(),
                "workspaceId": workspace_id,
                "workspaceName": payload.workspace_name.trim(),
            }),
            "active_queue_pane_fallback".to_string(),
        )
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
static TODO_DISPATCH_TERMINAL_RUNTIME: OnceLock<StdMutex<HashMap<String, Value>>> = OnceLock::new();

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
    let items = todo_store_canonicalize_settled_items(items.iter().cloned().collect());
    let snapshot = json!({
        "workspaceId": workspace_id,
        "items": items,
        "updatedAtMs": todo_dispatch_now_ms(),
    });
    if let Ok(bytes) = serde_json::to_vec(&snapshot) {
        let _ = fs::write(path, bytes);
    }
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
            .get("updatedAtMs")
            .and_then(Value::as_u64)
            .is_some_and(|at| now.saturating_sub(at) < TODO_DISPATCH_TERMINAL_RUNTIME_TTL_MS)
    });
    map.insert(
        pane_id.to_string(),
        json!({
            "activityStatus": payload.activity_status.clone(),
            "activity_status": payload.activity_status.clone(),
            "agentId": payload.agent_id.clone(),
            "agentKind": payload.agent_kind.clone(),
            "commandPhase": payload.command_phase.clone(),
            "command_phase": payload.command_phase.clone(),
            "completedAt": payload.completed_at.clone(),
            "completed_at": payload.completed_at.clone(),
            "eventType": payload.event_type.clone(),
            "event_type": payload.event_type.clone(),
            "inputReady": payload.input_ready,
            "inputReadyAt": payload.input_ready_at.clone(),
            "input_ready_at": payload.input_ready_at.clone(),
            "instanceId": payload.instance_id,
            "paneId": pane_id,
            "pendingPromptId": payload.provider_turn_id.clone().or_else(|| payload.turn_id.clone()),
            "pending_prompt_id": payload.provider_turn_id.clone().or_else(|| payload.turn_id.clone()),
            "promptReadyAt": payload.prompt_ready_at.clone(),
            "prompt_ready_at": payload.prompt_ready_at.clone(),
            "provider": payload.provider.clone(),
            "providerSessionId": payload.provider_session_id.clone(),
            "provider_session_id": payload.provider_session_id.clone(),
            "providerTurnId": payload.provider_turn_id.clone(),
            "provider_turn_id": payload.provider_turn_id.clone(),
            "status": payload.status.clone(),
            "terminalIndex": payload.terminal_index,
            "threadId": payload.thread_id.clone(),
            "updatedAtMs": now,
            "workspaceId": payload.workspace_id.trim(),
            "workspaceName": payload.workspace_name.trim(),
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
            .get("updatedAtMs")
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

    entry.insert("activityStatus".to_string(), json!("thinking"));
    entry.insert("activity_status".to_string(), json!("thinking"));
    entry.insert("agentId".to_string(), json!(agent_id));
    entry.insert("agentKind".to_string(), json!(agent_kind));
    entry.insert("commandPhase".to_string(), json!("running"));
    entry.insert("command_phase".to_string(), json!("running"));
    entry.insert("eventType".to_string(), json!("message-submitted"));
    entry.insert("event_type".to_string(), json!("message-submitted"));
    entry.insert("inputReady".to_string(), json!(false));
    entry.insert("instanceId".to_string(), json!(instance_id));
    entry.insert("paneId".to_string(), json!(pane_id));
    entry.insert("source".to_string(), json!(source.trim()));
    entry.insert("status".to_string(), json!("active"));
    entry.insert("terminalIndex".to_string(), json!(terminal_index));
    entry.insert("threadId".to_string(), json!(thread_id));
    entry.insert("updatedAtMs".to_string(), json!(now));
    entry.insert("workspaceId".to_string(), json!(workspace_id));
    entry.insert("workspaceName".to_string(), json!(workspace_name.trim()));
    if let Some(prompt_event_id) = prompt_event_id {
        entry.insert("promptEventId".to_string(), json!(prompt_event_id));
        entry.insert("prompt_event_id".to_string(), json!(prompt_event_id));
        entry.insert("pendingPromptId".to_string(), json!(prompt_event_id));
        entry.insert("pending_prompt_id".to_string(), json!(prompt_event_id));
    }
    if let Some(submitted_at) = submitted_at {
        entry.insert("promptSubmittedAt".to_string(), json!(submitted_at));
        entry.insert("prompt_submitted_at".to_string(), json!(submitted_at));
    }
    map.insert(pane_id.to_string(), Value::Object(entry));
}

fn todo_dispatch_terminal_runtime_mark_busy(pane_id: &str) {
    let registry = TODO_DISPATCH_TERMINAL_RUNTIME.get_or_init(|| StdMutex::new(HashMap::new()));
    if let Ok(mut map) = registry.lock() {
        if let Some(entry) = map.get_mut(pane_id) {
            if let Some(object) = entry.as_object_mut() {
                object.insert("activityStatus".to_string(), json!("thinking"));
                object.insert("activity_status".to_string(), json!("thinking"));
                object.insert("commandPhase".to_string(), json!("running"));
                object.insert("command_phase".to_string(), json!("running"));
                object.insert("eventType".to_string(), json!("message-submitted"));
                object.insert("event_type".to_string(), json!("message-submitted"));
                object.insert("inputReady".to_string(), json!(false));
                object.insert("status".to_string(), json!("active"));
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
const TODO_STORE_ORPHAN_SWEEP_INTERVAL_SECS: u64 = 300;
const TODO_STORE_ORPHAN_SWEEP_INITIAL_DELAY_SECS: u64 = 90;
const TODO_STORE_ACTIVE_RUN_STATUSES: [&str; 2] = ["running", "sending"];

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
                "deletedAtMs": now_ms,
                "deletedAt": chrono_like_now_iso(),
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
                        .get("deletedAtMs")
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
            "workspaceId": workspace_id,
            "reason": reason,
            "origin": origin,
            "updatedAtMs": todo_dispatch_now_ms(),
        }),
    );
}

fn todo_store_item_matches_id(item: &Value, todo_id: &str) -> bool {
    if todo_id.is_empty() {
        return false;
    }
    let item_id = item
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    item_id == todo_id || todo_dispatch_queue_item_command_id(item) == todo_id
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
    todo_dispatch_text(item, &["todoStatus", "todo_status", "status"]).to_ascii_lowercase()
}

fn todo_store_item_status_stamp_ms(item: &Value) -> u64 {
    let stamp = todo_dispatch_text(
        item,
        &[
            "todoStatusUpdatedAt",
            "todo_status_updated_at",
            "statusUpdatedAt",
            "status_updated_at",
            "updatedAt",
            "updated_at",
        ],
    );
    todo_dispatch_parse_iso_ms(&stamp).unwrap_or(0)
}

fn todo_store_item_settled_status_evidence(item: &Value) -> Option<(String, String)> {
    let evidence_fields: [(&str, &[&str]); 6] = [
        (
            "completed",
            &[
                "todoCompletedAt",
                "todo_completed_at",
                "completedAt",
                "completed_at",
            ],
        ),
        (
            "cancelled",
            &[
                "todoCancelledAt",
                "todo_cancelled_at",
                "cancelledAt",
                "cancelled_at",
                "canceledAt",
                "canceled_at",
            ],
        ),
        (
            "failed",
            &["todoFailedAt", "todo_failed_at", "failedAt", "failed_at"],
        ),
        (
            "interrupted",
            &[
                "todoInterruptedAt",
                "todo_interrupted_at",
                "interruptedAt",
                "interrupted_at",
            ],
        ),
        (
            "timed_out",
            &[
                "todoTimedOutAt",
                "todo_timed_out_at",
                "timedOutAt",
                "timed_out_at",
                "timeoutAt",
                "timeout_at",
            ],
        ),
        (
            "deleted",
            &[
                "todoDeletedAt",
                "todo_deleted_at",
                "deletedAt",
                "deleted_at",
            ],
        ),
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
    let reason = todo_dispatch_text(
        item,
        &[
            "reason",
            "todoStatusReason",
            "todo_status_reason",
            "statusReason",
            "status_reason",
        ],
    );
    let reason = if reason.is_empty() {
        "todo_store_settled_evidence".to_string()
    } else {
        reason
    };
    let Some(object) = item.as_object_mut() else {
        return false;
    };
    object.insert("todoStatus".to_string(), json!(settled_status.clone()));
    object.insert("status".to_string(), json!(settled_status.clone()));
    object.insert("todoStatusReason".to_string(), json!(reason.clone()));
    object.insert("statusReason".to_string(), json!(reason));
    object.insert("todoStatusUpdatedAt".to_string(), json!(settled_at.clone()));
    object.insert("updatedAt".to_string(), json!(settled_at.clone()));
    match settled_status.as_str() {
        "completed" => {
            object.insert("todoCompletedAt".to_string(), json!(settled_at.clone()));
            object.insert("completedAt".to_string(), json!(settled_at.clone()));
        }
        "cancelled" => {
            object.insert("todoCancelledAt".to_string(), json!(settled_at.clone()));
            object.insert("cancelledAt".to_string(), json!(settled_at.clone()));
        }
        "failed" => {
            object.insert("todoFailedAt".to_string(), json!(settled_at.clone()));
            object.insert("failedAt".to_string(), json!(settled_at.clone()));
        }
        "interrupted" => {
            object.insert("todoInterruptedAt".to_string(), json!(settled_at.clone()));
            object.insert("interruptedAt".to_string(), json!(settled_at.clone()));
        }
        "timed_out" => {
            object.insert("todoTimedOutAt".to_string(), json!(settled_at.clone()));
            object.insert("timedOutAt".to_string(), json!(settled_at.clone()));
        }
        "deleted" => {
            object.insert("todoDeletedAt".to_string(), json!(settled_at.clone()));
            object.insert("deletedAt".to_string(), json!(settled_at.clone()));
        }
        _ => {}
    }
    if let Some(settled_ms) = todo_dispatch_parse_iso_ms(&settled_at) {
        object.insert("updatedAtMs".to_string(), json!(settled_ms));
    }
    true
}

fn todo_store_canonicalize_settled_items(items: Vec<Value>) -> Vec<Value> {
    items
        .into_iter()
        .map(|mut item| {
            todo_store_canonicalize_settled_evidence(&mut item);
            item
        })
        .collect()
}

fn todo_store_item_pane_id(item: &Value) -> String {
    todo_dispatch_text(
        item,
        &[
            "targetTerminalId",
            "target_terminal_id",
            "paneId",
            "pane_id",
        ],
    )
}

fn todo_store_set_item_status(item: &mut Value, status: &str, reason: &str) {
    let now_iso = chrono_like_now_iso();
    if let Some(object) = item.as_object_mut() {
        object.insert("todoStatus".to_string(), json!(status));
        object.insert("status".to_string(), json!(status));
        object.insert("todoStatusReason".to_string(), json!(reason));
        object.insert("statusReason".to_string(), json!(reason));
        object.insert("todoStatusUpdatedAt".to_string(), json!(now_iso.clone()));
        object.insert("updatedAt".to_string(), json!(now_iso.clone()));
        object.insert("updatedAtMs".to_string(), json!(todo_dispatch_now_ms()));
        match status {
            "completed" => {
                object.insert("todoCompletedAt".to_string(), json!(now_iso.clone()));
                object.insert("completedAt".to_string(), json!(now_iso));
            }
            "cancelled" => {
                object.insert("todoCancelledAt".to_string(), json!(now_iso.clone()));
                object.insert("cancelledAt".to_string(), json!(now_iso));
            }
            "failed" => {
                object.insert("todoFailedAt".to_string(), json!(now_iso.clone()));
                object.insert("failedAt".to_string(), json!(now_iso));
            }
            "interrupted" => {
                object.insert("todoInterruptedAt".to_string(), json!(now_iso.clone()));
                object.insert("interruptedAt".to_string(), json!(now_iso));
            }
            "timed_out" => {
                object.insert("todoTimedOutAt".to_string(), json!(now_iso.clone()));
                object.insert("timedOutAt".to_string(), json!(now_iso));
            }
            "deleted" => {
                object.insert("todoDeletedAt".to_string(), json!(now_iso.clone()));
                object.insert("deletedAt".to_string(), json!(now_iso));
            }
            _ => {}
        }
    }
}

fn todo_store_item_sync_id(item: &Value) -> String {
    todo_dispatch_text(
        item,
        &[
            "id",
            "todo_id",
            "todoId",
            "client_todo_id",
            "clientTodoId",
            "command_id",
            "commandId",
        ],
    )
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
    let item_count = items
        .into_iter()
        .filter(|item| item.is_object() && !todo_store_item_sync_id(item).is_empty())
        .count();
    if item_count == 0 {
        return;
    }
    let _ = app;
    log_terminal_status_event(
        "backend.todo_store.cloud_push_retired",
        json!({
            "itemCount": item_count,
            "reason": reason,
            "workspaceId": workspace_id,
        }),
    );
}

/// Local-only removal marker: `todo.sync`/`todo.content` own account sync now,
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
            "removedCount": removed_todo_ids.len(),
            "reason": reason,
            "workspaceId": workspace_id,
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
    // todo.sync/todo.content rather than the retired workspace todo events.
    if cloud_mcp_todo_mirror_apply_local_corrections(&items) > 0 {
        let _ = app.emit(
            CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT,
            json!({
                "reason": reason,
                "source": "todo_store_correction",
                "workspaceId": workspace_id,
            }),
        );
    }
    let workspace_id = workspace_id.to_string();
    todo_store_push_items(app, &workspace_id, items, reason);
}

/// Tombstone + queue-store removal + journal update in one
/// place. Every delete path (history view, webview list, remote lever) funnels
/// here so a deleted todo can never come back from any replica.
pub(crate) fn todo_store_delete_internal(
    app: &AppHandle,
    workspace_id: &str,
    todo_ids: &[String],
    reason: &str,
    origin: &str,
) -> Vec<String> {
    let tombstoned = todo_store_add_tombstones(workspace_id, todo_ids, reason, origin);
    let all_ids = todo_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if all_ids.is_empty() {
        return tombstoned;
    }
    if let Some(path) = todo_dispatch_data_path("queues", workspace_id) {
        let items = todo_dispatch_queue_read(&path)
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let before = items.len();
        let next_items = items
            .into_iter()
            .filter(|item| {
                !all_ids
                    .iter()
                    .any(|id| todo_store_item_matches_id(item, id))
            })
            .collect::<Vec<_>>();
        if next_items.len() != before {
            todo_dispatch_queue_write(workspace_id, &next_items);
        }
    }
    for todo_id in &all_ids {
        todo_dispatch_journal_append(
            workspace_id,
            json!({
                "kind": "remote_todo_deleted",
                "itemId": todo_id,
                "at": chrono_like_now_iso(),
                "reason": reason,
                "origin": origin,
            }),
        );
    }
    // Client-authoritative: purge the local mirror right away so every view
    // converges instantly; the cloud removal below syncs in the background.
    let purged = cloud_mcp_todo_mirror_purge_todo_ids(&all_ids);
    todo_store_push_removals(app, workspace_id, all_ids, reason);
    todo_store_emit_changed(app, workspace_id, reason, "store");
    if purged > 0 {
        let _ = app.emit(
            CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT,
            json!({
                "reason": reason,
                "source": "todo_store_delete",
                "workspaceId": workspace_id,
            }),
        );
    }
    tombstoned
}

#[tauri::command]
async fn todo_store_snapshot(workspace_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_id = workspace_id.trim().to_string();
        if workspace_id.is_empty() {
            return Err("workspace_id is required.".to_string());
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
            "workspaceId": workspace_id,
            "items": items,
            "tombstonedIds": tombstoned.into_iter().collect::<Vec<_>>(),
            "updatedAtMs": snapshot.get("updatedAtMs").and_then(Value::as_u64).unwrap_or(0),
        }))
    })
    .await
    .map_err(|error| format!("Todo store snapshot worker failed: {error}"))?
}

#[tauri::command]
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
    let tombstoned = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let workspace_id = workspace_id.clone();
        move || todo_store_delete_internal(&app, &workspace_id, &todo_ids, &reason, "user_delete")
    })
    .await
    .map_err(|error| format!("Todo store delete worker failed: {error}"))?;
    Ok(json!({ "workspaceId": workspace_id, "tombstonedIds": tombstoned }))
}

/// Cancel with a guaranteed outcome. If the todo's pane is mid-turn and a
/// webview is alive, the webview actuator is asked to interrupt the terminal;
/// in every case the store row (or, for rows that only exist in the cloud
/// mirror, a pushed correction) ends up `cancelled` so the UI can never show
/// a running todo that nothing can stop.
#[tauri::command]
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

    tauri::async_runtime::spawn_blocking(move || {
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
                let _ = app.emit(
                    TODO_STORE_CANCEL_REQUESTED_EVENT,
                    json!({
                        "workspaceId": workspace_id,
                        "itemId": item.get("id").cloned().unwrap_or(Value::Null),
                        "paneId": pane_id,
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
                        vec![item],
                        "todo_store_cancel_correction",
                    );
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
                    "todoId": reference,
                    "kind": "todo",
                    "workspaceId": workspace_id,
                });
                todo_store_set_item_status(&mut item, "cancelled", &reason);
                todo_store_push_corrections(
                    &app,
                    &workspace_id,
                    vec![item],
                    "todo_store_cancel_correction",
                );
                corrected = true;
            }
        }
        todo_store_emit_changed(&app, &workspace_id, "todo_store_cancel", "store");
        Ok(json!({
            "ok": true,
            "workspaceId": workspace_id,
            "status": "cancelled",
            "actuated": actuated,
            "corrected": corrected,
            "matchedInStore": matched_item.is_some(),
        }))
    })
    .await
    .map_err(|error| format!("Todo store cancel worker failed: {error}"))?
}

const TODO_DROP_IMAGE_MAX_BYTES: u64 = 16 * 1024 * 1024;

/// Reads an OS-dropped image file into a data URL so it can attach to a todo
/// (draft or existing). Restricted to image extensions with a size cap — this
/// is a UI attachment path, not a general file reader.
#[tauri::command]
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
    if clear_target {
        for key in [
            "targetColorSlot",
            "targetTerminalColor",
            "targetTerminalId",
            "targetTerminalIndex",
            "targetTerminalName",
            "targetThreadId",
        ] {
            object.remove(key);
        }
        return;
    }
    if let Some(index) = target_terminal_index {
        object.insert("targetTerminalIndex".to_string(), json!(index));
    }
    for (key, value) in [
        ("targetTerminalId", target_terminal_id),
        ("targetThreadId", target_thread_id),
        ("targetAgentId", target_agent_id),
    ] {
        if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
            object.insert(key.to_string(), json!(value));
        }
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn todo_store_set_status(
    app: AppHandle,
    workspace_id: String,
    todo_id: Option<String>,
    command_id: Option<String>,
    dispatch_id: Option<String>,
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
    let status = status.trim().to_ascii_lowercase();
    if !matches!(
        status.as_str(),
        "listed" | "queued" | "cancelled" | "interrupted" | "completed" | "failed"
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

    tauri::async_runtime::spawn_blocking(move || {
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
                    .unwrap_or_else(|| {
                        json!({
                            "id": refs[0],
                            "todoId": refs[0],
                            "kind": "todo",
                            "workspaceId": workspace_id,
                        })
                    });
                todo_store_set_item_status(&mut item, &status, &reason);
                apply_targets(&mut item);
                item
            }
        };
        todo_store_push_corrections(&app, &workspace_id, vec![correction], &reason);
        todo_store_emit_changed(&app, &workspace_id, &reason, "store");
        Ok(json!({
            "ok": true,
            "workspaceId": workspace_id,
            "status": status,
            "matchedInStore": matched_item.is_some(),
        }))
    })
    .await
    .map_err(|error| format!("Todo store set-status worker failed: {error}"))?
}

/// Standing orphan sweep: running/sending rows that nothing is actually
/// driving flip to `interrupted` instead of haunting every view forever.
/// Queue-store items are only swept while no webview owns the queue (a live
/// webview manages its own items); stale device-local mirror rows are healed
/// regardless, because nothing else will ever settle them.
async fn todo_store_orphan_sweep_tick(app: &AppHandle) {
    let webview_alive = todo_dispatch_webview_dispatcher_active();
    let now_ms = todo_dispatch_now_ms();

    if !webview_alive {
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
            let file_age_ms = now_ms.saturating_sub(
                snapshot
                    .get("updatedAtMs")
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
            todo_store_push_corrections(app, &workspace_id, flipped, "todo_store_orphan_sweep");
            todo_store_emit_changed(app, &workspace_id, "todo_store_orphan_sweep", "store");
        }
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
            // The queue-store pass above (or the live webview) owns this row.
            continue;
        }
        todo_store_set_item_status(&mut item, "interrupted", "todo_store_orphan_sweep");
        by_workspace.entry(workspace_id).or_default().push(item);
    }
    for (workspace_id, items) in by_workspace {
        todo_store_push_corrections(app, &workspace_id, items, "todo_store_orphan_sweep");
        todo_store_emit_changed(app, &workspace_id, "todo_store_orphan_sweep", "store");
    }
}

/// App-start sweep: everything still marked queued/sending/running in the
/// queue stores belonged to a process that no longer exists, so none of it
/// can legitimately dispatch again. Flip it all to interrupted before the
/// webview loads, and heal this device's mirror rows the same way so stale
/// "queued" claims don't outlive the restart anywhere on the account.
pub(crate) fn todo_store_startup_sweep(app: &AppHandle) {
    const SWEPT_STATUSES: [&str; 5] = ["queued", "sending", "submitted", "running", "dispatching"];
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
        let mut items = snapshot
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut flipped = Vec::new();
        for item in items.iter_mut() {
            let status = todo_store_item_status(item);
            if !SWEPT_STATUSES.contains(&status.as_str()) {
                continue;
            }
            todo_store_set_item_status(item, "interrupted", "app_restart");
            flipped.push(item.clone());
        }
        if flipped.is_empty() {
            continue;
        }
        todo_dispatch_queue_write(&workspace_id, &items);
        log_terminal_status_event(
            "backend.todo_store.startup_sweep",
            json!({ "workspace_id": workspace_id, "flipped": flipped.len() }),
        );
        todo_store_push_corrections(app, &workspace_id, flipped, "app_restart");
        todo_store_emit_changed(app, &workspace_id, "app_restart", "store");
    }

    // Device-authored mirror rows still claiming queued/running/sending from
    // the previous run: the queue-store pass above already corrected the ids
    // it tracks; everything else gets an interrupted correction now instead
    // of waiting out the 15-minute orphan cutoff.
    let stale =
        cloud_mcp_todo_mirror_device_items_in_statuses(&["queued", "running", "sending"], 0);
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
            continue;
        }
        todo_store_set_item_status(&mut item, "interrupted", "app_restart");
        by_workspace.entry(workspace_id).or_default().push(item);
    }
    for (workspace_id, items) in by_workspace {
        todo_store_push_corrections(app, &workspace_id, items, "app_restart");
        todo_store_emit_changed(app, &workspace_id, "app_restart", "store");
    }
}

pub(crate) fn todo_store_orphan_sweep_start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_secs(
            TODO_STORE_ORPHAN_SWEEP_INITIAL_DELAY_SECS,
        ))
        .await;
        loop {
            todo_store_orphan_sweep_tick(&app).await;
            sleep(Duration::from_secs(TODO_STORE_ORPHAN_SWEEP_INTERVAL_SECS)).await;
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

/// Sweep flips are sticky against stale replicas: a webview snapshot loaded
/// from localStorage before the startup/orphan sweep ran still claims
/// queued/running for items the store already settled. An incoming active
/// claim only wins over a sweep-settled row when its status timestamp is
/// strictly newer than the flip (a real user re-queue stamps a fresh one).
fn todo_store_keep_settled_sweep_flips_core(
    stored_items: Vec<Value>,
    items: Vec<Value>,
) -> Vec<Value> {
    let swept = stored_items
        .into_iter()
        .filter(|item| {
            let reason = todo_dispatch_text(item, &["todoStatusReason", "statusReason"]);
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
            let incoming_at = todo_dispatch_text(&item, &["todoStatusUpdatedAt"]);
            let swept_at = todo_dispatch_text(swept_item, &["todoStatusUpdatedAt"]);
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
// door the history view uses: queue-store rows (device truth, leading) merged
// with cloud-mirror rows (peer devices, titled rows), deduped by the todo's
// whole id family so one logical todo is always one history entry.
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
        "todoId",
        "command_id",
        "commandId",
        "dispatch_id",
        "dispatchId",
        "todo_dispatch_id",
        "todoDispatchId",
        "last_dispatch_id",
        "lastDispatchId",
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
    let command_id = todo_dispatch_queue_item_command_id(item);
    if !command_id.is_empty() && !tokens.iter().any(|token| token == &command_id) {
        tokens.push(command_id);
    }
    tokens
}

/// Best-effort updated-at in epoch ms, accepting both the numeric stamps the
/// store writes and the ISO strings replicas exchange.
fn todo_store_item_updated_ms(item: &Value) -> u64 {
    if let Some(ms) = item.get("updatedAtMs").and_then(Value::as_u64) {
        return ms;
    }
    for key in [
        "todoStatusUpdatedAt",
        "todo_status_updated_at",
        "updatedAt",
        "updated_at",
        "completedAt",
        "completed_at",
        "createdAt",
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
    match status {
        "queued" => 1,
        "sending" | "dispatching" | "running" => 2,
        "completed" | "cancelled" | "failed" | "interrupted" | "timed_out" | "deleted" | "done" => {
            3
        }
        _ => 0,
    }
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
            let item_id = item
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default()
                .to_string();
            if item_id.is_empty() {
                return item;
            }
            let Some(stored) = stored_items
                .iter()
                .find(|candidate| todo_store_item_matches_id(candidate, &item_id))
            else {
                return item;
            };
            let mut stored = stored.clone();
            todo_store_canonicalize_settled_evidence(&mut stored);
            let stored_status = todo_store_item_status(&stored);
            if stored_status.is_empty() {
                return item;
            }
            let stored_at = todo_dispatch_text(&stored, &["todoStatusUpdatedAt"]);
            let incoming_at = todo_dispatch_text(&item, &["todoStatusUpdatedAt"]);
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
            let store_wins_by_rank = todo_store_item_is_rust_owned(&stored)
                && todo_store_status_rank(&todo_store_item_status(&item))
                    < todo_store_status_rank(&stored_status);
            if !store_wins_by_stamp && !store_wins_by_rank {
                return item;
            }
            if let Some(object) = item.as_object_mut() {
                for key in [
                    "todoStatus",
                    "status",
                    "todoStatusReason",
                    "statusReason",
                    "todoStatusUpdatedAt",
                    "updatedAt",
                    "updatedAtMs",
                    "todoCompletedAt",
                    "completedAt",
                    "todoCancelledAt",
                    "cancelledAt",
                    "todoFailedAt",
                    "failedAt",
                    "todoInterruptedAt",
                    "interruptedAt",
                    "todoTimedOutAt",
                    "timedOutAt",
                    "todoDeletedAt",
                    "deletedAt",
                ] {
                    if let Some(value) = stored.get(key) {
                        object.insert(key.to_string(), value.clone());
                    }
                }
                // Targets travel with the flip (retarget / clear-target).
                for key in [
                    "targetAgentId",
                    "targetColorSlot",
                    "targetTerminalColor",
                    "targetTerminalId",
                    "targetTerminalIndex",
                    "targetThreadId",
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
    let source = todo_dispatch_text(item, &["source", "sourceKind", "source_kind"]);
    // "terminal_direct" is the Rust capture's own source; the webview's
    // prompt-submit bridge materializes the SAME item id with its
    // "tui-terminal-direct-input" source, and its full-snapshot echo replaces
    // the row wholesale — the rewritten row must stay recognizable as
    // Rust-owned or every downstream protection silently disarms.
    if source == "terminal_direct" || source.starts_with("tui-terminal-direct") {
        return true;
    }
    if todo_dispatch_text(item, &["todoStatusReason", "statusReason"])
        == "todo_queue_backend_submit"
    {
        return true;
    }
    item.get("remoteCommand")
        .and_then(|remote| remote.get("source"))
        .and_then(Value::as_str)
        == Some("remote_intake_headless")
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

/// One history list per workspace: queue-store rows lead (device truth),
/// mirror rows add peer-device todos and display enrichment (LLM titles,
/// device names). Anything tombstoned anywhere on this device is dropped no
/// matter which replica still carries it.
fn todo_store_history_merge(
    queue_items: Vec<Value>,
    mirror_items: Vec<Value>,
    tombstoned: &HashSet<String>,
) -> Vec<Value> {
    const ENRICH_KEYS: [&str; 10] = [
        "llmTitle",
        "llm_title",
        "deviceId",
        "device_id",
        "deviceName",
        "device_name",
        "workspaceName",
        "workspace_name",
        "completedAt",
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

/// The single read door for the Todos History view: every todo this workspace
/// knows about — listed, queued, running, AND finished — local-first, with
/// peer-device rows from the cloud mirror, one entry per logical todo.
#[tauri::command]
async fn todo_store_history(workspace_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_id = workspace_id.trim().to_string();
        if workspace_id.is_empty() {
            return Err("workspace_id is required.".to_string());
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
        let mirror_items =
            cloud_mcp_todo_mirror_history_items(&workspace_id, TODO_STORE_HISTORY_MAX_ITEMS);
        let items = todo_store_history_merge(queue_items, mirror_items, &tombstoned);
        Ok(json!({
            "workspaceId": workspace_id,
            "items": items,
            "updatedAtMs": todo_dispatch_now_ms(),
        }))
    })
    .await
    .map_err(|error| format!("Todo store history worker failed: {error}"))?
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

fn todo_dispatch_queue_item_active_for_settlement(item: &Value) -> bool {
    matches!(
        todo_store_item_status(item).as_str(),
        "queued" | "sending" | "submitted" | "running" | "dispatching" | "paused"
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
    [
        "submittedAt",
        "submitted_at",
        "updatedAt",
        "updated_at",
        "receivedAt",
        "received_at",
    ]
    .iter()
    .find_map(|key| {
        receipt
            .get(*key)
            .and_then(Value::as_str)
            .and_then(todo_dispatch_parse_iso_ms)
    })
    .or_else(|| receipt.get("updatedAtMs").and_then(Value::as_u64))
    .or_else(|| receipt.get("receivedAtMs").and_then(Value::as_u64))
    .unwrap_or(0)
}

fn todo_dispatch_active_queue_item_ids_for_pane_from_items(items: &[Value], pane_id: &str) -> Vec<String> {
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
                    object.insert("completedAt".to_string(), json!(now_iso.clone()));
                }
            }
            settled_items.push(item.clone());
            item
        })
        .collect::<Vec<_>>();
    if changed {
        todo_dispatch_queue_write(workspace_id, &next_items);
        if let Some(app) = app {
            todo_store_push_corrections(
                app,
                workspace_id,
                settled_items,
                "todo_queue_backend_settled",
            );
            todo_store_emit_changed(app, workspace_id, "todo_queue_backend_settled", "store");
        }
    }
    // The webview's visible queue consumes completed items; journal the prune
    // so a webview that mounts later drops its localStorage copy. The store
    // row itself stays (history retention) — the prune entry only governs the
    // webview list, and the next queue sync keeps settled rows via the
    // retention merge.
    if !completed_item_id.is_empty() {
        todo_dispatch_journal_append(
            workspace_id,
            json!({
                "kind": "remote_todo_deleted",
                "itemId": completed_item_id,
                "commandId": command_id,
                "at": now_iso,
                "reason": "todo_queue_backend_settled",
            }),
        );
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
                    && todo_dispatch_text(receipt, &["paneId", "pane_id"]) == pane_id
            })
            .map(|(command_id, receipt)| (command_id.clone(), receipt.clone()))
            .collect::<Vec<_>>();
        for (command_id, mut receipt) in receipt_matches {
            if let Some(object) = receipt.as_object_mut() {
                object.insert("status".to_string(), json!("interrupted"));
                object.insert("statusReason".to_string(), json!(reason));
                object.insert("interruptedAt".to_string(), json!(now_iso.clone()));
                object.insert("todoInterruptedAt".to_string(), json!(now_iso.clone()));
                object.insert("updatedAt".to_string(), json!(now_iso.clone()));
                object.insert("updatedAtMs".to_string(), json!(todo_dispatch_now_ms()));
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

    #[test]
    fn tombstone_filter_rejects_by_item_id_and_command_id() {
        let tombstoned: HashSet<String> =
            ["dead-id".to_string(), "dead-command".to_string()].into();
        let items = vec![
            json!({ "id": "alive", "text": "keep me" }),
            json!({ "id": "dead-id", "text": "ghost by id" }),
            json!({
                "id": "other",
                "remoteCommand": { "commandId": "dead-command" },
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
    fn item_matcher_covers_id_and_command_id_and_rejects_empty() {
        let item = json!({
            "id": "item-1",
            "remoteCommand": { "commandId": "command-1" },
        });
        assert!(todo_store_item_matches_id(&item, "item-1"));
        assert!(todo_store_item_matches_id(&item, "command-1"));
        assert!(!todo_store_item_matches_id(&item, "unrelated"));
        assert!(!todo_store_item_matches_id(&item, ""));
    }

    #[test]
    fn pane_settlement_fallback_picks_newest_active_item_for_pane() {
        let items = vec![
            json!({
                "id": "old-running",
                "status": "running",
                "targetTerminalId": "pane-a",
                "updatedAtMs": 100,
            }),
            json!({
                "id": "new-running",
                "remoteCommand": { "commandId": "command-new" },
                "status": "submitted",
                "targetTerminalId": "pane-a",
                "updatedAtMs": 300,
            }),
            json!({
                "id": "other-pane",
                "status": "running",
                "targetTerminalId": "pane-b",
                "updatedAtMs": 500,
            }),
            json!({
                "id": "done",
                "status": "completed",
                "targetTerminalId": "pane-a",
                "updatedAtMs": 900,
            }),
        ];

        assert_eq!(
            todo_dispatch_active_queue_item_ids_for_pane_from_items(&items, "pane-a"),
            vec!["command-new".to_string(), "old-running".to_string()]
        );
    }

    #[test]
    fn status_setter_stamps_both_field_families_and_timestamps() {
        let mut item = json!({
            "id": "item-1",
            "todoStatus": "running",
            "status": "running",
        });
        todo_store_set_item_status(&mut item, "cancelled", "todo_history_cancel");
        assert_eq!(item["todoStatus"], "cancelled");
        assert_eq!(item["status"], "cancelled");
        assert_eq!(item["todoStatusReason"], "todo_history_cancel");
        assert_eq!(item["statusReason"], "todo_history_cancel");
        assert!(item["updatedAtMs"].as_u64().unwrap() > 0);
        assert!(item["updatedAt"].as_str().unwrap().ends_with('Z'));
    }

    #[test]
    fn settled_evidence_overrides_stale_running_status_fields() {
        let mut item = json!({
            "id": "terminal-direct-1",
            "todoStatus": "running",
            "status": "running",
            "todoStatusReason": "todo_queue_backend_submit",
            "todoStatusUpdatedAt": "2026-06-12T18:52:33.543Z",
            "completedAt": "2026-06-12T18:53:48.276Z",
            "reason": "todo_queue_backend_settled",
        });
        assert_eq!(todo_store_item_status(&item), "completed");
        assert!(todo_store_canonicalize_settled_evidence(&mut item));
        assert_eq!(item["todoStatus"], "completed");
        assert_eq!(item["status"], "completed");
        assert_eq!(item["todoStatusReason"], "todo_queue_backend_settled");
        assert_eq!(item["statusReason"], "todo_queue_backend_settled");
        assert_eq!(item["todoStatusUpdatedAt"], "2026-06-12T18:53:48.276Z");
        assert_eq!(item["todoCompletedAt"], "2026-06-12T18:53:48.276Z");
        assert_eq!(item["completedAt"], "2026-06-12T18:53:48.276Z");
    }

    #[test]
    fn settled_evidence_does_not_override_fresh_requeue_status() {
        let mut item = json!({
            "id": "terminal-direct-1",
            "todoStatus": "queued",
            "status": "queued",
            "todoStatusReason": "todo_history_queue",
            "todoStatusUpdatedAt": "2026-06-12T18:55:00.000Z",
            "completedAt": "2026-06-12T18:53:48.276Z",
        });
        assert_eq!(todo_store_item_status(&item), "queued");
        assert!(!todo_store_canonicalize_settled_evidence(&mut item));
        assert_eq!(item["todoStatus"], "queued");
        assert_eq!(item["status"], "queued");
        assert_eq!(item["todoStatusUpdatedAt"], "2026-06-12T18:55:00.000Z");
    }

    #[test]
    fn newer_store_status_merge_copies_canonical_settled_fields() {
        let stored = vec![json!({
            "id": "terminal-direct-1",
            "source": "terminal_direct",
            "todoStatus": "running",
            "status": "running",
            "todoStatusReason": "todo_queue_backend_submit",
            "todoStatusUpdatedAt": "2026-06-12T18:52:33.543Z",
            "completedAt": "2026-06-12T18:53:48.276Z",
        })];
        let incoming = vec![json!({
            "id": "terminal-direct-1",
            "text": "hi",
            "todoStatus": "running",
            "status": "running",
            "todoStatusUpdatedAt": "2026-06-12T18:52:33.543Z",
        })];
        let merged = todo_store_apply_newer_store_status_core(&stored, incoming);
        assert_eq!(merged.len(), 1);
        assert_eq!(todo_store_item_status(&merged[0]), "completed");
        assert_eq!(merged[0]["todoStatus"], "completed");
        assert_eq!(merged[0]["status"], "completed");
        assert_eq!(merged[0]["completedAt"], "2026-06-12T18:53:48.276Z");
        assert_eq!(merged[0]["todoCompletedAt"], "2026-06-12T18:53:48.276Z");
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
            "todoStatus": "interrupted",
            "todoStatusReason": "app_restart",
            "todoStatusUpdatedAt": "2026-06-11T10:00:00.000Z",
        })];
        let incoming = vec![json!({
            "id": "todo-1",
            "todoStatus": "queued",
            "todoStatusUpdatedAt": "2026-06-11T09:00:00.000Z",
        })];
        let merged = todo_store_keep_settled_sweep_flips_core(stored, incoming);
        assert_eq!(merged.len(), 1);
        assert_eq!(todo_store_item_status(&merged[0]), "interrupted");
    }

    #[test]
    fn fresh_requeue_outranks_sweep_flip() {
        let stored = vec![json!({
            "id": "todo-1",
            "todoStatus": "interrupted",
            "todoStatusReason": "app_restart",
            "todoStatusUpdatedAt": "2026-06-11T10:00:00.000Z",
        })];
        let incoming = vec![json!({
            "id": "todo-1",
            "todoStatus": "queued",
            "todoStatusUpdatedAt": "2026-06-11T10:05:00.000Z",
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
                "todoStatus": "cancelled",
                "todoStatusReason": "todo_history_cancel",
                "todoStatusUpdatedAt": "2026-06-11T10:00:00.000Z",
            }),
            json!({
                "id": "todo-swept",
                "todoStatus": "interrupted",
                "todoStatusReason": "app_restart",
                "todoStatusUpdatedAt": "2026-06-11T10:00:00.000Z",
            }),
        ];
        let incoming = vec![
            json!({
                "id": "todo-user",
                "todoStatus": "queued",
                "todoStatusUpdatedAt": "2026-06-11T09:00:00.000Z",
            }),
            json!({
                "id": "todo-swept",
                "todoStatus": "listed",
                "todoStatusUpdatedAt": "2026-06-11T09:00:00.000Z",
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
            "todoStatus": "queued",
            "todoStatusReason": "todo_history_queue",
            "todoStatusUpdatedAt": "2026-06-11T10:05:00.000Z",
            "targetTerminalIndex": 2,
        })];
        let incoming = vec![json!({
            "id": "todo-1",
            "text": "edited text survives",
            "todoStatus": "listed",
            "todoStatusUpdatedAt": "2026-06-11T10:00:00.000Z",
        })];
        let merged = todo_store_apply_newer_store_status_core(&stored, incoming);
        assert_eq!(merged.len(), 1);
        assert_eq!(todo_store_item_status(&merged[0]), "queued");
        assert_eq!(merged[0]["targetTerminalIndex"], 2);
        // Non-status fields stay from the incoming row (text edits survive).
        assert_eq!(merged[0]["text"], "edited text survives");
    }

    #[test]
    fn newer_webview_claim_beats_older_store_status() {
        let stored = vec![json!({
            "id": "todo-1",
            "todoStatus": "queued",
            "todoStatusUpdatedAt": "2026-06-11T10:00:00.000Z",
        })];
        let incoming = vec![json!({
            "id": "todo-1",
            "todoStatus": "listed",
            "todoStatusUpdatedAt": "2026-06-11T10:05:00.000Z",
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
            "todoStatus": "running",
            "source": "terminal_direct",
        })];
        let incoming = vec![json!({
            "id": "direct-1",
            "text": "what do you think about balancer-diffforge?",
            "source": "tui-terminal-direct-input",
            "todoStatusUpdatedAt": "2026-06-11T10:05:00.000Z",
        })];
        let merged = todo_store_apply_newer_store_status_core(&stored, incoming);
        assert_eq!(todo_store_item_status(&merged[0]), "running");
        // The row stays recognizable as Rust-owned under the webview source.
        assert!(todo_store_item_is_rust_owned(&merged[0]));
    }

    #[test]
    fn rust_owned_forward_transition_from_webview_is_accepted() {
        // queued → running through the webview dispatcher is a legitimate
        // forward flip; the rank rule only blocks backward movement.
        let stored = vec![json!({
            "id": "remote-1",
            "todoStatus": "queued",
            "todoStatusReason": "todo_queue_backend_submit",
            "todoStatusUpdatedAt": "2026-06-11T10:00:00.000Z",
        })];
        let incoming = vec![json!({
            "id": "remote-1",
            "todoStatus": "running",
            "todoStatusUpdatedAt": "2026-06-11T10:05:00.000Z",
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
            "todoStatus": "queued",
            "todoStatusUpdatedAt": "2026-06-11T10:00:00.000Z",
        })];
        let incoming = vec![json!({
            "id": "ui-1",
            "todoStatus": "listed",
            "todoStatusUpdatedAt": "2026-06-11T10:05:00.000Z",
        })];
        let merged = todo_store_apply_newer_store_status_core(&stored, incoming);
        assert_eq!(todo_store_item_status(&merged[0]), "listed");
    }

    #[test]
    fn settled_retention_keeps_consumed_completed_rows() {
        let stored = vec![
            json!({
                "id": "todo-done",
                "todoStatus": "completed",
                "todoStatusUpdatedAt": "2026-06-11T10:00:00.000Z",
            }),
            json!({
                "id": "todo-live",
                "todoStatus": "queued",
            }),
        ];
        // The webview's snapshot omits the completed item (it consumed it)
        // and rewrites the live one.
        let incoming = vec![json!({ "id": "todo-live", "todoStatus": "queued" })];
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
                "todoStatus": "running",
                "todoStatusReason": "todo_queue_backend_submit",
            }),
            // Headless remote intake awaiting dispatch: must survive.
            json!({
                "id": "remote-cmd-1",
                "todoStatus": "queued",
                "remoteCommand": { "commandId": "remote-cmd-1", "source": "remote_intake_headless" },
            }),
            // Plain webview-owned active row missing from incoming: webview
            // replica is authoritative for these, so it drops.
            json!({ "id": "webview-owned", "todoStatus": "queued" }),
        ];
        let incoming = vec![json!({ "id": "other", "todoStatus": "listed" })];
        let merged = todo_store_retain_settled_items_core(stored, incoming, &HashSet::new());
        let ids = merged
            .iter()
            .map(|item| item["id"].as_str().unwrap_or_default())
            .collect::<Vec<_>>();
        assert!(ids.contains(&"terminal-direct-abc"));
        assert!(ids.contains(&"remote-cmd-1"));
        assert!(ids.contains(&"other"));
        assert!(!ids.contains(&"webview-owned"));
    }

    #[test]
    fn settled_retention_respects_tombstones_and_incoming_claims() {
        let stored = vec![
            json!({ "id": "todo-deleted", "todoStatus": "completed" }),
            json!({ "id": "todo-requeued", "todoStatus": "interrupted" }),
        ];
        let incoming = vec![json!({ "id": "todo-requeued", "todoStatus": "queued" })];
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
            "todoStatus": "running",
            "todoStatusUpdatedAt": "2026-06-11T10:00:00.000Z",
        })];
        let mirror_items = vec![
            json!({
                "todo_id": "todo-1",
                "last_dispatch_id": "dispatch-9",
                "llmTitle": "Ship the release",
                "deviceName": "MacBook",
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
        assert_eq!(lead["llmTitle"], "Ship the release");
        assert_eq!(lead["deviceName"], "MacBook");
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
        entry.get("workspaceId").and_then(Value::as_str) == Some(workspace_id)
            && entry.get("inputReady").and_then(Value::as_bool) == Some(false)
            && entry
                .get("updatedAtMs")
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
            let item_text_key = todo_dispatch_direct_prompt_text_key(&todo_dispatch_text(item, &["text"]));
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
    let prompt = prompt.trim();
    if workspace_id.is_empty() || prompt.is_empty() {
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
    let item = json!({
        "id": item_id,
        "kind": "todo",
        "text": prompt,
        "todoStatus": "running",
        "status": "running",
        // The stamp gives the running status LWW teeth against webview
        // snapshot echoes; the forward-only rank rule is the backstop.
        "todoStatusUpdatedAt": now_iso,
        // Backend-submit reason routes the item through the existing Rust
        // ledger settlement machinery (crash sweep exclusion, drain reconcile).
        "todoStatusReason": "todo_queue_backend_submit",
        "source": "terminal_direct",
        "promptEventId": prompt_event_id_value.clone(),
        "prompt_event_id": prompt_event_id_value.clone(),
        "createdAt": now_iso,
        "updatedAt": now_iso,
        "workspaceId": workspace_id,
        "targetTerminalId": pane_id,
        "targetTerminalIndex": terminal_index,
        "targetThreadId": thread_id,
        "targetAgentId": canonical_agent_kind,
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
            if todo_store_status_rank(&existing_status) < todo_store_status_rank("running") {
                todo_store_set_item_status(existing, "running", "todo_queue_backend_submit");
                sync_item = Some(existing.clone());
                capture_item = existing.clone();
                wrote = true;
            } else {
                capture_item = existing.clone();
            }
        } else {
            items.push(item.clone());
            sync_item = Some(item.clone());
            wrote = true;
        }
        if wrote {
            todo_dispatch_queue_write(workspace_id, &items);
            if let Some(sync_item) = sync_item {
                todo_store_push_items(
                    app,
                    workspace_id,
                    vec![sync_item],
                    "terminal_direct_submit",
                );
            }
        }
    }
    todo_dispatch_journal_append(
        workspace_id,
        json!({
            "kind": "remote_todo_created",
            "itemId": item_id,
            "commandId": item_id,
            "item": capture_item,
            "at": now_iso,
        }),
    );
    let receipt = json!({
        "commandId": item_id,
        "itemId": item_id,
        "paneId": pane_id,
        "promptEventId": prompt_event_id_value.clone(),
        "prompt_event_id": prompt_event_id_value.clone(),
        "submittedAt": now_iso,
        "status": "running",
        "text": prompt.chars().take(180).collect::<String>(),
        "workspaceId": workspace_id,
        "workspaceName": workspace_name,
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
            "workspaceId": workspace_id,
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
    let updated_at = entry.get("updatedAtMs").and_then(Value::as_u64)?;
    if todo_dispatch_now_ms().saturating_sub(updated_at) >= TODO_DISPATCH_TERMINAL_RUNTIME_TTL_MS {
        return None;
    }
    entry.get("inputReady").and_then(Value::as_bool)
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
    let _ = app;
    log_terminal_status_event(
        "backend.todo_dispatch.cloud_snapshot_retired",
        json!({
            "itemCount": items.len(),
            "reason": reason,
            "removedCount": removed_todo_ids.len(),
            "workspaceId": workspace_id,
        }),
    );
}

/// Headless remote todo delete: applied directly to the Rust queue store so
/// the lever works with the window closed; the journal entry reconciles the
/// webview's localStorage mirror on restore. Idempotent next to the webview
/// path (both remove the same id).
pub(crate) fn todo_dispatch_apply_remote_delete(app: &AppHandle, event: &Value) {
    let command_kind =
        todo_dispatch_text(event, &["command_kind", "commandKind", "action", "command"])
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
        return;
    }
    let workspace_id = todo_dispatch_text(event, &["workspace_id", "workspaceId"]);
    let todo_id = todo_dispatch_text(event, &["todo_id", "todoId", "item_id", "itemId"]);
    if workspace_id.is_empty() || todo_id.is_empty() {
        return;
    }
    // One funnel for every delete: tombstone, queue-store removal, and journal.
    // The removed legacy Cloud push was idempotent, but todo.sync/todo.content
    // now own account convergence.
    todo_store_delete_internal(
        app,
        &workspace_id,
        &[todo_id],
        "remote_todo_delete",
        "remote_command",
    );
}

#[tauri::command]
fn todo_dispatch_dispatcher_heartbeat(app: AppHandle) -> Result<(), String> {
    let now = todo_dispatch_now_ms();
    let previous = TODO_DISPATCH_WEBVIEW_HEARTBEAT_MS.swap(now, Ordering::AcqRel);
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
    }
    Ok(())
}

pub(crate) fn todo_dispatch_flush_deferred_remote_commands(app: &AppHandle) {
    let intents = app_local_state_read(app, "remote-intents");
    let pending = intents
        .get("pendingRemoteCommands")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if pending.is_empty() {
        return;
    }
    let _ = app_local_state_merge(
        app,
        "remote-intents",
        &json!({ "pendingRemoteCommands": Value::Null }),
    );
    for event in pending {
        let _ = app.emit(CLOUD_MCP_REMOTE_COMMAND_EVENT, event);
    }
}

#[tauri::command]
async fn todo_dispatch_queue_sync(
    app: AppHandle,
    workspace_id: String,
    items: Value,
    reason: Option<String>,
    removed_ids: Option<Vec<String>>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_id = workspace_id.trim().to_string();
        if workspace_id.is_empty() {
            return Err("workspace_id is required.".to_string());
        }
        let reason = reason.unwrap_or_default();
        // Webview removals become terminal tombstones first, so the incoming
        // snapshot (and every later writer) can never resurrect them.
        let removed_ids = removed_ids
            .unwrap_or_default()
            .into_iter()
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty())
            .collect::<Vec<_>>();
        if !removed_ids.is_empty() {
            todo_store_add_tombstones(&workspace_id, &removed_ids, &reason, "webview_sync");
        }
        let tombstoned = todo_store_tombstone_ids(&workspace_id);
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
        todo_store_push_items(&app, &workspace_id, changed_items, &reason);
        // Origin "webview": the webview's own changed-listener skips these to
        // avoid sync feedback loops; other windows still refresh.
        todo_store_emit_changed(&app, &workspace_id, &reason, "webview");
        Ok(json!({
            "workspaceId": workspace_id,
            "itemCount": items.len(),
            "rejectedIds": rejected_ids,
            "reason": reason,
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
        // Tombstones are terminal: a creation entry for a later-deleted todo
        // must never be re-adopted by the restored webview (this was the ghost
        // "delete it and it comes back listed" path).
        let tombstoned = todo_store_tombstone_ids(&workspace_id);
        let entries = entries
            .into_iter()
            .filter(|entry| {
                if entry.get("kind").and_then(Value::as_str) != Some("remote_todo_created") {
                    return true;
                }
                let item_id = entry
                    .get("itemId")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .unwrap_or_default();
                !tombstoned.contains(item_id)
            })
            .collect::<Vec<_>>();
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
        let items = todo_store_canonicalize_settled_items(
            snapshot
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        );
        Ok(json!({
            "workspaceId": workspace_id,
            "items": items,
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

fn todo_dispatch_backend_agent_value(value: &Value, keys: &[&str]) -> String {
    todo_dispatch_backend_agent_id(&todo_dispatch_text(value, keys))
}

fn todo_dispatch_backend_target_agent(item: &Value, target: &Value) -> String {
    [
        todo_dispatch_text(target, &["agentKind", "agent_kind"]),
        todo_dispatch_text(target, &["agentId", "agent_id", "provider", "targetAgentId"]),
        todo_dispatch_text(item, &["targetAgentId", "target_agent_id", "agentId", "agent_id"]),
    ]
    .into_iter()
    .map(|value| todo_dispatch_backend_agent_id(&value))
    .find(|value| !value.is_empty())
    .unwrap_or_default()
}

fn todo_dispatch_backend_submit_sequence(item: &Value, target: &Value) -> &'static str {
    let agent = todo_dispatch_backend_target_agent(item, target);
    if agent.contains("codex") {
        TERMINAL_ENTER_SEQUENCE
    } else {
        TERMINAL_PARKED_RESUME_SUBMIT_SEQUENCE
    }
}

#[cfg(test)]
mod todo_dispatch_backend_tests {
    use super::*;

    #[test]
    fn hook_managed_backend_targets_normalize_agent_names_and_submit_sequences() {
        assert_eq!(todo_dispatch_backend_agent_id("Claude Code"), "claude");
        assert_eq!(todo_dispatch_backend_agent_id("open-code"), "opencode");
        assert_eq!(todo_dispatch_backend_agent_id("OpenAI Codex"), "codex");

        let codex_item = json!({ "id": "todo-codex", "text": "ship it", "targetAgentId": "OpenAI Codex" });
        let claude_item = json!({ "id": "todo-claude", "text": "ship it", "targetAgentId": "Claude Code" });
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
    fn direct_prompt_capture_accepts_coding_agent_aliases_and_running_receipts() {
        assert_eq!(todo_dispatch_direct_prompt_agent_kind("OpenAI Codex"), Some("codex"));
        assert_eq!(todo_dispatch_direct_prompt_agent_kind("Claude Code"), Some("claude"));
        assert_eq!(todo_dispatch_direct_prompt_agent_kind("open-code"), Some("opencode"));
        assert_eq!(todo_dispatch_direct_prompt_agent_kind("bash"), None);
        assert_eq!(todo_dispatch_normalize_status("running"), "running");
        assert!(todo_dispatch_status_is_active("running"));
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
    if todo_dispatch_backend_item_text(&item).is_empty() {
        return Err("Todo text is required.".to_string());
    }

    let pane_id = todo_dispatch_text(target, &["paneId", "pane_id", "targetTerminalId"]);
    let thread_id = todo_dispatch_text(target, &["threadId", "thread_id", "targetThreadId"]);
    let target_agent = todo_dispatch_backend_target_agent(&item, target);
    let terminal_index = target
        .get("terminalIndex")
        .or_else(|| target.get("targetTerminalIndex"))
        .and_then(Value::as_i64);

    if let Some(object) = item.as_object_mut() {
        object.insert("id".to_string(), json!(item_id.clone()));
        object.insert("workspaceId".to_string(), json!(workspace_id));
        if !pane_id.is_empty() {
            object.insert("targetTerminalId".to_string(), json!(pane_id));
        }
        if !thread_id.is_empty() {
            object.insert("targetThreadId".to_string(), json!(thread_id));
        }
        if !target_agent.is_empty() {
            object.insert("targetAgentId".to_string(), json!(target_agent));
        }
        if let Some(index) = terminal_index {
            object.insert("targetTerminalIndex".to_string(), json!(index));
        }
        if let Some(prompt_event_id) = prompt_event_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            object.insert("promptEventId".to_string(), json!(prompt_event_id));
        }
    }

    todo_store_set_item_status(
        &mut item,
        "queued",
        "todo_queue_backend_submit_requested",
    );

    if let Some(path) = todo_dispatch_data_path("queues", workspace_id) {
        let snapshot = todo_dispatch_queue_read(&path);
        let mut items = snapshot
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut replaced = false;
        for existing in &mut items {
            if todo_store_item_matches_id(existing, &item_id) {
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

fn todo_dispatch_backend_pick_target(
    workspace_id: &str,
    item: &Value,
    busy: &HashSet<String>,
) -> Option<Value> {
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
    let has_non_id_terminal_hint = target_pane.is_none()
        && (item
            .get("targetThreadId")
            .and_then(Value::as_str)
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
            || item
                .get("targetTerminalIndex")
                .and_then(Value::as_u64)
                .is_some());
    let target_agent = todo_dispatch_backend_agent_value(
        item,
        &[
            "targetAgentId",
            "target_agent_id",
            "agentId",
            "agent_id",
            "agentKind",
            "agent_kind",
        ],
    );
    let target_agent = if target_agent.is_empty() {
        None
    } else {
        Some(target_agent)
    };
    let has_explicit_target = target_pane.is_some() || has_non_id_terminal_hint;

    let matched = entries
        .iter()
        .find(|entry| {
            target_pane.is_some() && entry.get("paneId").and_then(Value::as_str) == target_pane
        })
        .or_else(|| {
            if has_explicit_target {
                // An explicit terminal target must be a pane id. Legacy
                // thread/index hints are retained as metadata, but cannot
                // select an execution target.
                None
            } else if let Some(agent) = target_agent.as_deref() {
                entries.iter().find(|entry| {
                    todo_dispatch_backend_agent_value(entry, &["agentId", "agent_id"]) == agent
                        || todo_dispatch_backend_agent_value(entry, &["agentKind", "agent_kind"])
                            == agent
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
    let target_instance_id = target
        .get("instanceId")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let prompt = todo_dispatch_backend_item_text(item);
    if pane_id.is_empty() || prompt.is_empty() {
        return false;
    }
    let submit_sequence = todo_dispatch_backend_submit_sequence(item, target);
    if prompt.len() + submit_sequence.len() + 1 > MAX_TERMINAL_WRITE_BYTES {
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
    if todo_dispatch_pane_input_ready(&pane_id) == Some(false) {
        return false;
    }

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
    let prompt_event_id = todo_dispatch_text(item, &["promptEventId", "prompt_event_id"]);
    let prompt_event_id = if prompt_event_id.is_empty() {
        format!("backend-todo-{item_id}-{:x}", todo_dispatch_now_ms())
    } else {
        prompt_event_id
    };
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
        // Ctrl-U clears any stale TUI input left by a previous interrupted or
        // failed UI write before Rust submits the queued todo.
        if writer.write_all(b"\x15").is_err()
            || writer.write_all(prompt.as_bytes()).is_err()
            || writer.flush().is_err()
        {
            return false;
        }
    }
    sleep(Duration::from_millis(
        TERMINAL_PARKED_RESUME_SUBMIT_DELAY_MS,
    ))
    .await;
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
            .write_all(submit_sequence.as_bytes())
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
            "promptEventId": prompt_event_id.clone(),
            "prompt_event_id": prompt_event_id.clone(),
            "submittedAt": submitted_at.clone(),
            "status": "submitted",
            "statusReason": "todo_queue_backend_submit",
            "text": prompt.chars().take(180).collect::<String>(),
            "threadId": thread_id,
            "workspaceId": workspace_id,
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

#[tauri::command]
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

    let submitted = todo_dispatch_backend_submit(&app, &workspace_id, &item, &target).await;
    if !submitted {
        let pane_id = todo_dispatch_text(&target, &["paneId", "pane_id", "targetTerminalId"]);
        if !pane_id.is_empty() && todo_dispatch_pane_input_ready(&pane_id) == Some(false) {
            return Err("target_terminal_not_input_ready".to_string());
        }
        return Err("Unable to submit todo to the target terminal.".to_string());
    }

    Ok(json!({
        "ok": true,
        "itemId": todo_store_item_sync_id(&item),
        "promptEventId": prompt_event_id.unwrap_or_default(),
        "workspaceId": workspace_id,
    }))
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

pub(crate) fn todo_dispatch_wake_background_dispatcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(250)).await;
        if APP_SHUTDOWN_PHASE.load(Ordering::Acquire) != APP_SHUTDOWN_PHASE_RUNNING {
            return;
        }
        todo_dispatch_backend_tick(&app).await;
    });
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
            let now = todo_dispatch_now_ms();
            if !app_is_in_background_mode() {
                if heartbeat == 0 {
                    // No webview dispatcher has ever announced itself this
                    // session; stay dormant until background mode hands over.
                    continue;
                }
                if now.saturating_sub(heartbeat) < TODO_DISPATCH_DISPATCHER_LEASE_MS {
                    continue;
                }
            }
            todo_dispatch_backend_tick(&app).await;
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
        Ok(todo_dispatch_receipts_payload(
            &workspace_id,
            &receipts,
            "get",
        ))
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
        let command_id = receipt
            .get("commandId")
            .or_else(|| receipt.get("command_id"))
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
        Ok(todo_dispatch_receipts_payload(
            &workspace_id,
            &next,
            "import",
        ))
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

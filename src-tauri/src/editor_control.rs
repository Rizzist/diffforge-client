// Editor-control surface for the terminal orchestrator ("instruct pipe").
//
// `include!`d into lib.rs. Two halves:
//  1. A small in-process store the React editor publishes its LIVE selections to
//     (highlighted clips/regions, playhead, active generation form). The committed
//     project/timeline/media stays authoritative on disk (editor_get_project etc.);
//     only the genuinely-ephemeral UI selection needs a publish channel.
//  2. `editor_control_dispatch`: a single, token-efficient `{action, ...}` entry the
//     app-control MCP bridge routes to. It reuses the existing editor_* commands so
//     the orchestrator can organize assets, read exposed selections, edit timeline
//     areas via ops, generate, and export — all against the open project on disk.

/// Latest editor UI context published by the React app (selection/playhead/form).
struct EditorSelectionStore {
    inner: std::sync::Mutex<Value>,
}

impl EditorSelectionStore {
    fn new() -> Self {
        Self {
            inner: std::sync::Mutex::new(Value::Null),
        }
    }
}

/// The React editor calls this whenever its selection/playhead/generation form
/// changes, so the orchestrator MCP can read "exposed selections" without a UI
/// round-trip.
#[tauri::command]
fn editor_publish_context(
    state: tauri::State<'_, EditorSelectionStore>,
    context: Value,
) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Unable to lock editor selection store.".to_string())?;
    *guard = context;
    Ok(())
}

#[tauri::command]
fn editor_get_published_context(
    state: tauri::State<'_, EditorSelectionStore>,
) -> Result<Value, String> {
    let guard = state
        .inner
        .lock()
        .map_err(|_| "Unable to lock editor selection store.".to_string())?;
    Ok(guard.clone())
}

/// Read the published editor context from the app's managed store (for the MCP
/// bridge, which has an AppHandle but not the State guard).
fn editor_read_published_context(app: &AppHandle) -> Value {
    app.try_state::<EditorSelectionStore>()
        .and_then(|s| s.inner.lock().ok().map(|g| g.clone()))
        .unwrap_or(Value::Null)
}

fn editor_control_project_id(input: &Value) -> Option<String> {
    input
        .get("projectId")
        .or_else(|| input.get("id"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Route one orchestrator `editor_control` call to the matching editor command(s).
/// Returns the action's data on success.
async fn editor_control_dispatch(app: &AppHandle, input: &Value) -> Result<Value, String> {
    let action = input
        .get("action")
        .and_then(Value::as_str)
        .ok_or_else(|| "editor_control requires an 'action'.".to_string())?;
    match action {
        // Orientation: open-project selection + project list + (optionally) the doc.
        "get_context" => {
            let selection = editor_read_published_context(app);
            let pid = editor_control_project_id(input).or_else(|| {
                selection
                    .get("projectId")
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())
            });
            let (projects, project) = tauri::async_runtime::spawn_blocking(move || {
                let projects = editor_list_projects().unwrap_or_default();
                let project = pid.and_then(|p| editor_get_project(p).ok());
                (projects, project)
            })
            .await
            .map_err(|e| format!("editor task failed: {e}"))?;
            Ok(json!({
                "selection": selection,
                "projects": serde_json::to_value(projects).unwrap_or_else(|_| json!([])),
                "project": project,
            }))
        }
        // Just the live exposed selection (highlighted clips/region, playhead, form).
        "get_selection" => Ok(editor_read_published_context(app)),
        "list_projects" => {
            let projects = tauri::async_runtime::spawn_blocking(editor_list_projects)
                .await
                .map_err(|e| format!("editor task failed: {e}"))??;
            Ok(serde_json::to_value(projects).unwrap_or_else(|_| json!([])))
        }
        "get_project" => {
            let pid = editor_control_project_id(input)
                .ok_or_else(|| "projectId is required.".to_string())?;
            tauri::async_runtime::spawn_blocking(move || editor_get_project(pid))
                .await
                .map_err(|e| format!("editor task failed: {e}"))?
        }
        "list_media" => {
            let pid = editor_control_project_id(input)
                .ok_or_else(|| "projectId is required.".to_string())?;
            let subpath = input.get("subpath").and_then(Value::as_str).map(String::from);
            let media = tauri::async_runtime::spawn_blocking(move || editor_list_media(pid, subpath))
                .await
                .map_err(|e| format!("editor task failed: {e}"))??;
            Ok(serde_json::to_value(media).unwrap_or_else(|_| json!([])))
        }
        "create_folder" => {
            let pid = editor_control_project_id(input)
                .ok_or_else(|| "projectId is required.".to_string())?;
            let name = input
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| "name is required.".to_string())?
                .to_string();
            let subpath = input.get("subpath").and_then(Value::as_str).map(String::from);
            let entry =
                tauri::async_runtime::spawn_blocking(move || editor_create_folder(pid, subpath, name))
                    .await
                    .map_err(|e| format!("editor task failed: {e}"))??;
            Ok(serde_json::to_value(entry).unwrap_or_else(|_| json!(null)))
        }
        "import_media" => {
            let pid = editor_control_project_id(input)
                .ok_or_else(|| "projectId is required.".to_string())?;
            let sources = input
                .get("sources")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if sources.is_empty() {
                return Err("sources (absolute file paths) are required.".to_string());
            }
            let subpath = input.get("subpath").and_then(Value::as_str).map(String::from);
            let entries = editor_import_media(pid, sources, subpath).await?;
            Ok(serde_json::to_value(entries).unwrap_or_else(|_| json!([])))
        }
        "delete_media" => {
            let pid = editor_control_project_id(input)
                .ok_or_else(|| "projectId is required.".to_string())?;
            let path = input
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| "path is required.".to_string())?
                .to_string();
            let result = tauri::async_runtime::spawn_blocking(move || editor_delete_media(pid, path))
                .await
                .map_err(|e| format!("editor task failed: {e}"))??;
            Ok(serde_json::to_value(result).unwrap_or_else(|_| json!(null)))
        }
        // The powerful one: place/move/trim/split/delete clips + add/remove/rename/
        // mute/gain tracks. The orchestrator edits "highlighted areas" by deriving
        // ops from the exposed selection (selection.startMs/endMs, activeClipId).
        "apply_ops" => {
            let pid = editor_control_project_id(input)
                .ok_or_else(|| "projectId is required.".to_string())?;
            let ops = input
                .get("ops")
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| "ops (array) is required.".to_string())?;
            let result = tauri::async_runtime::spawn_blocking(move || editor_apply_ops(pid, ops))
                .await
                .map_err(|e| format!("editor task failed: {e}"))??;
            Ok(serde_json::to_value(result).unwrap_or_else(|_| json!(null)))
        }
        "generate" => {
            let pid = editor_control_project_id(input)
                .ok_or_else(|| "projectId is required.".to_string())?;
            let name = input
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("generation")
                .to_string();
            let source = input.get("source").and_then(Value::as_str).map(String::from);
            let entry = editor_stub_generation(pid, name, source).await?;
            Ok(serde_json::to_value(entry).unwrap_or_else(|_| json!(null)))
        }
        "export" => {
            let pid = editor_control_project_id(input)
                .ok_or_else(|| "projectId is required.".to_string())?;
            let job_id = format!("orchestrator-{}", editor_now_ms());
            let options = input.get("options").cloned().unwrap_or_else(|| json!({}));
            let result = editor_export_timeline(app.clone(), pid, job_id, options).await?;
            Ok(serde_json::to_value(result).unwrap_or_else(|_| json!(null)))
        }
        other => Err(format!("Unknown editor_control action: {other}")),
    }
}

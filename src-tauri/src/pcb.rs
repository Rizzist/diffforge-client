// PCB design panel backend.
//
// PCB boards are workspace-local agent artifacts: an agent edits a compact
// tscircuit source file under `<repo>/hardware/<board>/<board>.board.tsx`, the
// frontend renders it with @tscircuit/runframe, and a notify-based watcher
// emits `pcb-store-changed` so open panels (grid + popout windows) live-reload.
//
// This file is `include!`d into the crate root (see lib.rs), so it shares the
// crate-root module scope: crate helpers such as `resolve_workspace_root_directory`
// and `architecture_now_millis` are called directly, and to avoid duplicate
// `use` imports we reference everything with fully-qualified paths and keep any
// trait imports function-local.

const PCB_STORE_CHANGED_EVENT: &str = "pcb-store-changed";
const PCB_HARDWARE_DIR: &str = "hardware";
const PCB_BOARD_EXTENSION: &str = ".board.tsx";
const PCB_MANIFEST_DIR: &str = ".agents";
const PCB_MANIFEST_FILE: &str = "pcb-workspaces.json";
const PCB_VENDOR_FETCH_TIMEOUT_SECS: u64 = 20;
const PCB_VENDOR_FETCH_MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const PCB_VENDOR_FETCH_ALLOWED_HOSTS: &[&str] = &[
    "jlcsearch.tscircuit.com",
    "easyeda.com",
    "modules.easyeda.com",
    "modelcdn.tscircuit.com",
    "kicad-mod-cache.tscircuit.com",
];

// Per-workspace watch roots already wired up, so repeated `pcb_watch_start`
// calls from a remounting PcbView are idempotent.
static PCB_WATCH_ROOTS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
    std::sync::OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PcbVendorFetchRequest {
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PcbVendorFetchResponse {
    status: u16,
    status_text: String,
    headers: std::collections::HashMap<String, String>,
    body: String,
}

fn pcb_vendor_fetch_url(raw_url: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw_url)
        .map_err(|error| format!("Invalid PCB vendor fetch URL: {error}"))?;
    if url.scheme() != "https" {
        return Err("PCB vendor fetch URL must use HTTPS.".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "PCB vendor fetch URL is missing a host.".to_string())?;
    if !PCB_VENDOR_FETCH_ALLOWED_HOSTS.contains(&host) {
        return Err(format!("PCB vendor fetch host is not allowed: {host}"));
    }
    Ok(url)
}

fn pcb_vendor_fetch_should_forward_header(name: &str, value: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "host"
            | "authority"
            | "connection"
            | "content-length"
            | "transfer-encoding"
            | "accept-encoding"
    ) {
        return false;
    }
    if lower == "cookie" && value.contains("<PUT") {
        return false;
    }
    true
}

fn pcb_starter_source(board_name: &str) -> String {
    format!(
        r#"// {board_name} — tscircuit board. Edit components and traces; the panel
// renders Circuits (schematic), Wiring (PCB), and 3D live on save.
export default () => (
  <board width="12mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={{-3}} pcbY={{0}} />
    <led name="D1" footprint="0402" pcbX={{3}} pcbY={{0}} />
    <trace from=".R1 .pin2" to=".D1 .anode" />
  </board>
);
"#,
        board_name = board_name
    )
}

fn pcb_slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if (ch == '-' || ch == '_' || ch.is_whitespace()) && !slug.is_empty() && !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "board".to_string()
    } else {
        slug
    }
}

fn pcb_is_board_file(path: &std::path::Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.ends_with(PCB_BOARD_EXTENSION))
        .unwrap_or(false)
}

fn pcb_board_id(path: &std::path::Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.trim_end_matches(PCB_BOARD_EXTENSION).to_string())
        .unwrap_or_default()
}

// Repo-relative POSIX path for a board under the workspace root.
fn pcb_relative_path(root: &std::path::Path, abs: &std::path::Path) -> String {
    abs.strip_prefix(root)
        .unwrap_or(abs)
        .to_string_lossy()
        .replace('\\', "/")
}

fn pcb_hardware_root(repo_path: &str) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    let root = resolve_workspace_root_directory(Some(repo_path))?;
    let hardware = root.join(PCB_HARDWARE_DIR);
    Ok((root, hardware))
}

fn pcb_workspace_text(workspace_id: Option<String>) -> String {
    workspace_id
        .unwrap_or_default()
        .trim()
        .chars()
        .take(512)
        .collect::<String>()
}

fn pcb_workspace_token(workspace_id: &str) -> String {
    let mut token = workspace_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(10)
        .collect::<String>()
        .to_ascii_lowercase();
    if token.is_empty() {
        token = "workspace".to_string();
    }
    token
}

fn pcb_manifest_path(root: &std::path::Path) -> std::path::PathBuf {
    root.join(PCB_MANIFEST_DIR).join(PCB_MANIFEST_FILE)
}

fn pcb_read_manifest(root: &std::path::Path) -> Result<serde_json::Value, String> {
    let manifest_path = pcb_manifest_path(root);
    let raw = match std::fs::read_to_string(&manifest_path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(serde_json::json!({ "version": 1, "boards": {} }));
        }
        Err(error) => return Err(format!("Unable to read PCB workspace manifest: {error}")),
    };
    serde_json::from_str(&raw)
        .map_err(|error| format!("Unable to parse PCB workspace manifest: {error}"))
}

fn pcb_write_manifest(root: &std::path::Path, manifest: &serde_json::Value) -> Result<(), String> {
    let manifest_path = pcb_manifest_path(root);
    if let Some(parent) = manifest_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create PCB manifest directory: {error}"))?;
    }
    let raw = serde_json::to_string_pretty(manifest)
        .map_err(|error| format!("Unable to serialize PCB workspace manifest: {error}"))?;
    std::fs::write(&manifest_path, raw)
        .map_err(|error| format!("Unable to write PCB workspace manifest: {error}"))
}

fn pcb_manifest_boards_mut(
    manifest: &mut serde_json::Value,
) -> Option<&mut serde_json::Map<String, serde_json::Value>> {
    if !manifest.is_object() {
        *manifest = serde_json::json!({});
    }
    let object = manifest.as_object_mut()?;
    object
        .entry("version".to_string())
        .or_insert_with(|| serde_json::json!(1));
    let boards = object
        .entry("boards".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !boards.is_object() {
        *boards = serde_json::json!({});
    }
    boards.as_object_mut()
}

fn pcb_manifest_board_workspace(manifest: &serde_json::Value, board_path: &str) -> Option<String> {
    manifest
        .get("boards")
        .and_then(|value| value.as_object())
        .and_then(|boards| boards.get(board_path))
        .and_then(|entry| {
            entry
                .get("workspaceId")
                .and_then(|value| value.as_str())
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn pcb_manifest_set_board(
    manifest: &mut serde_json::Value,
    board_path: &str,
    workspace_id: &str,
) -> Result<(), String> {
    let Some(boards) = pcb_manifest_boards_mut(manifest) else {
        return Err("PCB workspace manifest is not writable.".to_string());
    };
    boards.insert(
        board_path.to_string(),
        serde_json::json!({
            "workspaceId": workspace_id,
            "updatedAtMs": architecture_now_millis(),
        }),
    );
    Ok(())
}

fn pcb_manifest_remove_board(
    manifest: &mut serde_json::Value,
    board_path: &str,
) -> Result<(), String> {
    let Some(boards) = pcb_manifest_boards_mut(manifest) else {
        return Err("PCB workspace manifest is not writable.".to_string());
    };
    boards.remove(board_path);
    Ok(())
}

fn pcb_source_is_default_starter(board_name: &str, source: &str) -> bool {
    source.trim() == pcb_starter_source(board_name).trim()
}

// Boards stay on disk when their workspace is deleted, but the manifest still
// names the dead workspace as owner, which stranded them: a workspace
// re-created at the same location could never see or open them. An owner
// missing from the local catalog (live entries across every scope file) is
// orphaned and reclaimable by the requesting workspace. `None` means the
// catalog could not be read — stay conservative and treat every owner as live.
fn pcb_live_workspace_ids(app: &tauri::AppHandle) -> Option<std::collections::HashSet<String>> {
    local_workspace_catalog_all_workspace_ids(app).ok()
}

fn pcb_owner_is_orphaned(
    owner: &str,
    live_workspace_ids: Option<&std::collections::HashSet<String>>,
) -> bool {
    live_workspace_ids
        .map(|ids| !ids.contains(owner))
        .unwrap_or(false)
}

// Reject path traversal / absolute escapes from a frontend-provided board path.
fn pcb_resolve_board_abs(
    root: &std::path::Path,
    board_path: &str,
) -> Result<std::path::PathBuf, String> {
    let trimmed = board_path.trim().replace('\\', "/");
    if trimmed.is_empty() {
        return Err("Board path is empty.".to_string());
    }
    let rel = std::path::Path::new(&trimmed);
    if rel.is_absolute() || trimmed.split('/').any(|seg| seg == "..") {
        return Err("Board path must stay inside the workspace.".to_string());
    }
    let abs = root.join(rel);
    let hardware = root.join(PCB_HARDWARE_DIR);
    if !abs.starts_with(&hardware) {
        return Err("Board path must live under the hardware/ directory.".to_string());
    }
    Ok(abs)
}

fn pcb_file_modified_ms(path: &std::path::Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|dur| dur.as_millis() as u64)
        .unwrap_or(0)
}

fn pcb_collect_boards(hardware: &std::path::Path, root: &std::path::Path, out: &mut Vec<serde_json::Value>) {
    let Ok(entries) = std::fs::read_dir(hardware) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if pcb_is_board_file(&path) {
                out.push(serde_json::json!({
                    "id": pcb_board_id(&path),
                    "name": pcb_board_id(&path),
                    "path": pcb_relative_path(root, &path),
                    "updated_at_ms": pcb_file_modified_ms(&path),
                }));
            }
        } else if path.is_dir() {
            // One level of nesting: hardware/<board>/<board>.board.tsx
            if let Ok(children) = std::fs::read_dir(&path) {
                for child in children.flatten() {
                    let child_path = child.path();
                    if child_path.is_file() && pcb_is_board_file(&child_path) {
                        out.push(serde_json::json!({
                            "id": pcb_board_id(&child_path),
                            "name": pcb_board_id(&child_path),
                            "path": pcb_relative_path(root, &child_path),
                            "updated_at_ms": pcb_file_modified_ms(&child_path),
                        }));
                    }
                }
            }
        }
    }
}

fn pcb_documents_list_blocking(
    repo_path: String,
    workspace_id: Option<String>,
    live_workspace_ids: Option<std::collections::HashSet<String>>,
) -> Result<serde_json::Value, String> {
    let (root, hardware) = pcb_hardware_root(repo_path.as_str())?;
    let workspace_text = pcb_workspace_text(workspace_id);
    let mut manifest = pcb_read_manifest(&root)?;
    let mut manifest_changed = false;
    let mut boards: Vec<serde_json::Value> = Vec::new();
    if hardware.is_dir() {
        pcb_collect_boards(&hardware, &root, &mut boards);
    }
    if !workspace_text.is_empty() {
        boards.retain(|board| {
            let Some(path) = board.get("path").and_then(|value| value.as_str()) else {
                return false;
            };
            match pcb_manifest_board_workspace(&manifest, path) {
                Some(owner) if owner == workspace_text => true,
                Some(owner) => {
                    if pcb_owner_is_orphaned(&owner, live_workspace_ids.as_ref())
                        && pcb_manifest_set_board(&mut manifest, path, &workspace_text).is_ok()
                    {
                        manifest_changed = true;
                        true
                    } else {
                        false
                    }
                }
                None => {
                    let Ok(abs) = pcb_resolve_board_abs(&root, path) else {
                        return false;
                    };
                    let Ok(source) = std::fs::read_to_string(&abs) else {
                        return false;
                    };
                    let board_name = pcb_board_id(&abs);
                    if pcb_source_is_default_starter(&board_name, &source) {
                        return false;
                    }
                    if pcb_manifest_set_board(&mut manifest, path, &workspace_text).is_ok() {
                        manifest_changed = true;
                        true
                    } else {
                        false
                    }
                }
            }
        });
    }
    if manifest_changed {
        pcb_write_manifest(&root, &manifest)?;
    }
    boards.sort_by(|a, b| {
        a.get("path")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .cmp(b.get("path").and_then(|v| v.as_str()).unwrap_or_default())
    });
    Ok(serde_json::json!({
        "repo_path": root.to_string_lossy(),
        "workspace_id": workspace_text,
        "boards": boards,
    }))
}

fn pcb_document_read_blocking(
    repo_path: String,
    board_path: String,
    workspace_id: Option<String>,
    live_workspace_ids: Option<std::collections::HashSet<String>>,
) -> Result<serde_json::Value, String> {
    let (root, _) = pcb_hardware_root(repo_path.as_str())?;
    let abs = pcb_resolve_board_abs(&root, board_path.as_str())?;
    let source = std::fs::read_to_string(&abs)
        .map_err(|error| format!("Unable to read board {board_path}: {error}"))?;
    let workspace_text = pcb_workspace_text(workspace_id);
    let rel_path = pcb_relative_path(&root, &abs);
    let board_name = pcb_board_id(&abs);
    let mut claimed = false;
    if !workspace_text.is_empty() {
        let mut manifest = pcb_read_manifest(&root)?;
        match pcb_manifest_board_workspace(&manifest, &rel_path) {
            Some(owner) if owner == workspace_text => {}
            Some(owner) => {
                if !pcb_owner_is_orphaned(&owner, live_workspace_ids.as_ref()) {
                    return Err("This PCB board belongs to a different workspace.".to_string());
                }
                pcb_manifest_set_board(&mut manifest, &rel_path, &workspace_text)?;
                pcb_write_manifest(&root, &manifest)?;
                claimed = true;
            }
            None => {
                if pcb_source_is_default_starter(&board_name, &source) {
                    return Err("This PCB board is not assigned to this workspace.".to_string());
                }
                pcb_manifest_set_board(&mut manifest, &rel_path, &workspace_text)?;
                pcb_write_manifest(&root, &manifest)?;
                claimed = true;
            }
        }
    }
    Ok(serde_json::json!({
        "claimed": claimed,
        "path": rel_path,
        "name": board_name,
        "repo_path": root.to_string_lossy(),
        "source": source,
        "workspace_id": workspace_text,
    }))
}

fn pcb_document_create_blocking(
    repo_path: String,
    name: String,
    workspace_id: Option<String>,
    live_workspace_ids: Option<std::collections::HashSet<String>>,
) -> Result<serde_json::Value, String> {
    let (root, hardware) = pcb_hardware_root(repo_path.as_str())?;
    let workspace_text = pcb_workspace_text(workspace_id);
    let mut manifest = pcb_read_manifest(&root)?;
    let slug = pcb_slugify(name.as_str());
    let mut dir = hardware.join(&slug);
    let mut file = dir.join(format!("{slug}{PCB_BOARD_EXTENSION}"));
    if !workspace_text.is_empty() {
        let owner_is_reclaimable = |owner: Option<&str>| {
            owner
                .map(|owner| {
                    owner == workspace_text
                        || pcb_owner_is_orphaned(owner, live_workspace_ids.as_ref())
                })
                .unwrap_or(false)
        };
        let base_rel = pcb_relative_path(&root, &file);
        let base_owner = pcb_manifest_board_workspace(&manifest, &base_rel);
        if file.exists() && !owner_is_reclaimable(base_owner.as_deref()) {
            let token = pcb_workspace_token(&workspace_text);
            let mut counter = 0usize;
            loop {
                let suffix = if counter == 0 {
                    token.clone()
                } else {
                    format!("{token}-{counter}")
                };
                dir = hardware.join(format!("{slug}-{suffix}"));
                file = dir.join(format!("{slug}{PCB_BOARD_EXTENSION}"));
                let rel = pcb_relative_path(&root, &file);
                let owner = pcb_manifest_board_workspace(&manifest, &rel);
                if !file.exists() || owner_is_reclaimable(owner.as_deref()) {
                    break;
                }
                counter += 1;
            }
        }
    }
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Unable to create board directory: {error}"))?;
    let source = if file.exists() {
        std::fs::read_to_string(&file)
            .map_err(|error| format!("Unable to read existing board: {error}"))?
    } else {
        let starter = pcb_starter_source(&slug);
        std::fs::write(&file, &starter)
            .map_err(|error| format!("Unable to write board: {error}"))?;
        starter
    };
    let rel_path = pcb_relative_path(&root, &file);
    if !workspace_text.is_empty() {
        pcb_manifest_set_board(&mut manifest, &rel_path, &workspace_text)?;
        pcb_write_manifest(&root, &manifest)?;
    }
    Ok(serde_json::json!({
        "path": rel_path,
        "name": slug,
        "repo_path": root.to_string_lossy(),
        "source": source,
        "workspace_id": workspace_text,
    }))
}

fn pcb_document_delete_blocking(
    repo_path: String,
    board_path: String,
    workspace_id: Option<String>,
    live_workspace_ids: Option<std::collections::HashSet<String>>,
) -> Result<serde_json::Value, String> {
    let (root, _) = pcb_hardware_root(repo_path.as_str())?;
    let abs = pcb_resolve_board_abs(&root, board_path.as_str())?;
    let rel_path = pcb_relative_path(&root, &abs);
    let workspace_text = pcb_workspace_text(workspace_id);
    let mut manifest = pcb_read_manifest(&root)?;
    if !workspace_text.is_empty() {
        if let Some(owner) = pcb_manifest_board_workspace(&manifest, &rel_path) {
            if owner != workspace_text
                && !pcb_owner_is_orphaned(&owner, live_workspace_ids.as_ref())
            {
                return Err("This PCB board belongs to a different workspace.".to_string());
            }
        } else {
            return Err("This PCB board is not assigned to this workspace.".to_string());
        }
    }
    std::fs::remove_file(&abs)
        .map_err(|error| format!("Unable to delete PCB board {rel_path}: {error}"))?;
    if let Some(parent) = abs.parent() {
        let hardware = root.join(PCB_HARDWARE_DIR);
        if parent.starts_with(&hardware) && parent != hardware {
            let _ = std::fs::remove_dir(parent);
        }
    }
    pcb_manifest_remove_board(&mut manifest, &rel_path)?;
    pcb_write_manifest(&root, &manifest)?;
    Ok(serde_json::json!({
        "deleted": true,
        "path": rel_path,
        "repo_path": root.to_string_lossy(),
        "workspace_id": workspace_text,
    }))
}

#[tauri::command(rename_all = "snake_case")]
async fn pcb_documents_list(
    app: tauri::AppHandle,
    repo_path: String,
    workspace_id: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let live_workspace_ids = pcb_live_workspace_ids(&app);
        pcb_documents_list_blocking(repo_path, workspace_id, live_workspace_ids)
    })
        .await
        .map_err(|error| format!("PCB document list worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn pcb_document_read(
    app: tauri::AppHandle,
    repo_path: String,
    board_path: String,
    workspace_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let app_for_worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let live_workspace_ids = pcb_live_workspace_ids(&app_for_worker);
        pcb_document_read_blocking(repo_path, board_path, workspace_id, live_workspace_ids)
    })
        .await
        .map_err(|error| format!("PCB document read worker failed: {error}"))??;
    if result.get("claimed").and_then(|value| value.as_bool()).unwrap_or(false) {
        let _ = app.emit(PCB_STORE_CHANGED_EVENT, serde_json::json!({
            "repo_path": result.get("repo_path").and_then(|value| value.as_str()).unwrap_or_default(),
            "workspace_id": result.get("workspace_id").and_then(|value| value.as_str()).unwrap_or_default(),
            "paths": [result.get("path").and_then(|value| value.as_str()).unwrap_or_default()],
            "changed_at_ms": architecture_now_millis(),
        }));
    }
    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
async fn pcb_document_create(
    app: tauri::AppHandle,
    repo_path: String,
    name: String,
    workspace_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let app_for_worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let live_workspace_ids = pcb_live_workspace_ids(&app_for_worker);
        pcb_document_create_blocking(repo_path, name, workspace_id, live_workspace_ids)
    })
        .await
        .map_err(|error| format!("PCB document create worker failed: {error}"))??;
    let _ = app.emit(PCB_STORE_CHANGED_EVENT, serde_json::json!({
        "repo_path": result.get("repo_path").and_then(|value| value.as_str()).unwrap_or_default(),
        "workspace_id": result.get("workspace_id").and_then(|value| value.as_str()).unwrap_or_default(),
        "paths": [result.get("path").and_then(|value| value.as_str()).unwrap_or_default()],
        "changed_at_ms": architecture_now_millis(),
    }));
    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
async fn pcb_document_delete(
    app: tauri::AppHandle,
    repo_path: String,
    board_path: String,
    workspace_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let app_for_worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let live_workspace_ids = pcb_live_workspace_ids(&app_for_worker);
        pcb_document_delete_blocking(repo_path, board_path, workspace_id, live_workspace_ids)
    })
        .await
        .map_err(|error| format!("PCB document delete worker failed: {error}"))??;
    let _ = app.emit(PCB_STORE_CHANGED_EVENT, serde_json::json!({
        "repo_path": result.get("repo_path").and_then(|value| value.as_str()).unwrap_or_default(),
        "workspace_id": result.get("workspace_id").and_then(|value| value.as_str()).unwrap_or_default(),
        "paths": [result.get("path").and_then(|value| value.as_str()).unwrap_or_default()],
        "deleted_paths": [result.get("path").and_then(|value| value.as_str()).unwrap_or_default()],
        "changed_at_ms": architecture_now_millis(),
    }));
    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
async fn pcb_vendor_fetch(request: PcbVendorFetchRequest) -> Result<PcbVendorFetchResponse, String> {
    let url = pcb_vendor_fetch_url(request.url.as_str())?;
    let method_text = request
        .method
        .as_deref()
        .unwrap_or("GET")
        .trim()
        .to_ascii_uppercase();
    let method = reqwest::Method::from_bytes(method_text.as_bytes())
        .map_err(|error| format!("Invalid PCB vendor fetch method: {error}"))?;
    let body = request.body.unwrap_or_default();
    if body.len() > PCB_VENDOR_FETCH_MAX_BODY_BYTES {
        return Err("PCB vendor fetch request body is too large.".to_string());
    }

    let client = http_client(std::time::Duration::from_secs(PCB_VENDOR_FETCH_TIMEOUT_SECS))?;
    let mut builder = client.request(method, url);
    if let Some(headers) = request.headers {
        for (name, value) in headers {
            if !pcb_vendor_fetch_should_forward_header(name.as_str(), value.as_str()) {
                continue;
            }
            let Ok(header_name) = reqwest::header::HeaderName::from_bytes(name.as_bytes()) else {
                continue;
            };
            let Ok(header_value) = reqwest::header::HeaderValue::from_str(value.as_str()) else {
                continue;
            };
            builder = builder.header(header_name, header_value);
        }
    }
    if !body.is_empty() {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("PCB vendor fetch failed: {error}"))?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or_default().to_string();
    let mut headers = std::collections::HashMap::new();
    for (name, value) in response.headers().iter() {
        if let Ok(text) = value.to_str() {
            headers.insert(name.as_str().to_string(), text.to_string());
        }
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Unable to read PCB vendor fetch response: {error}"))?;
    if bytes.len() > PCB_VENDOR_FETCH_MAX_BODY_BYTES {
        return Err("PCB vendor fetch response body is too large.".to_string());
    }
    let body = String::from_utf8_lossy(&bytes).to_string();

    Ok(PcbVendorFetchResponse {
        status: status.as_u16(),
        status_text,
        headers,
        body,
    })
}

// Ensure a debounced filesystem watcher is running for this workspace's
// hardware/ directory, emitting `pcb-store-changed` on any board edit. Mirrors
// architecture_store_watcher_start but scoped per workspace and started on demand.
#[tauri::command(rename_all = "snake_case")]
fn pcb_watch_start(app: tauri::AppHandle, repo_path: String) -> Result<(), String> {
    let (root, hardware) = pcb_hardware_root(repo_path.as_str())?;
    std::fs::create_dir_all(&hardware)
        .map_err(|error| format!("Unable to create hardware directory: {error}"))?;
    let key = hardware.to_string_lossy().to_string();
    let roots = PCB_WATCH_ROOTS.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()));
    {
        let mut guard = roots
            .lock()
            .map_err(|_| "PCB watch registry is poisoned.".to_string())?;
        if guard.contains(&key) {
            return Ok(());
        }
        guard.insert(key);
    }
    let repo_display = root.to_string_lossy().to_string();
    std::thread::spawn(move || {
        use notify::Watcher as _;
        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let Ok(mut watcher) = notify::recommended_watcher(tx) else {
            return;
        };
        if watcher
            .watch(&hardware, notify::RecursiveMode::Recursive)
            .is_err()
        {
            return;
        }
        let collect = |event: notify::Result<notify::Event>, paths: &mut std::collections::HashSet<String>| {
            let Ok(event) = event else {
                return;
            };
            for path in &event.paths {
                if pcb_is_board_file(path) {
                    paths.insert(pcb_relative_path(&root, path));
                }
            }
        };
        loop {
            let mut pending: std::collections::HashSet<String> = std::collections::HashSet::new();
            let Ok(first) = rx.recv() else {
                return;
            };
            collect(first, &mut pending);
            // Quiet-window debounce: absorb the write burst, emit once.
            loop {
                match rx.recv_timeout(std::time::Duration::from_millis(600)) {
                    Ok(event) => collect(event, &mut pending),
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => break,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            if pending.is_empty() {
                continue;
            }
            let paths = pending.into_iter().collect::<Vec<_>>();
            let _ = app.emit(
                PCB_STORE_CHANGED_EVENT,
                serde_json::json!({
                    "repo_path": repo_display,
                    "paths": paths,
                    "changed_at_ms": architecture_now_millis(),
                }),
            );
        }
    });
    Ok(())
}

// --- Popout breakout window -------------------------------------------------
// Hosts a single board in its own native window. Unlike the terminal popout
// there is no live process to multiplex: the window simply re-reads the same
// board file and subscribes to the same `pcb-store-changed` watcher, so it
// live-reloads independently alongside the grid panel.

const PCB_WINDOW_LABEL_PREFIX: &str = "pcb-window-";
const PCB_WINDOW_CLOSED_EVENT: &str = "pcb-window-closed";
const PCB_WINDOW_DEFAULT_WIDTH: f64 = 900.0;
const PCB_WINDOW_DEFAULT_HEIGHT: f64 = 680.0;
const PCB_PANEL_LABEL_PREFIX: &str = "pcb-panel-";
const PCB_PANEL_CLOSED_EVENT: &str = "pcb-panel-closed";
const PCB_PANEL_DEFAULT_WIDTH: f64 = 900.0;
const PCB_PANEL_DEFAULT_HEIGHT: f64 = 680.0;

#[derive(serde::Serialize)]
struct PcbPanelOpenResult {
    label: String,
}

fn pcb_label_hash(value: &str) -> String {
    use std::hash::{Hash as _, Hasher as _};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn pcb_safe_label_part(value: &str, fallback: &str, max_len: usize) -> String {
    let safe = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .take(max_len)
        .collect::<String>();
    if safe.is_empty() {
        fallback.to_string()
    } else {
        safe
    }
}

fn pcb_window_label(repo_path: &str, workspace_id: &str, board_path: &str) -> String {
    let workspace = pcb_safe_label_part(workspace_id, "workspace", 40);
    let board = pcb_safe_label_part(board_path, "board", 80);
    let scope = pcb_label_hash(&format!("{repo_path}\n{workspace_id}\n{board_path}"));
    format!("{PCB_WINDOW_LABEL_PREFIX}{workspace}-{scope}-{board}")
}

fn pcb_panel_safe_label_part(value: &str, fallback: &str) -> String {
    pcb_safe_label_part(value, fallback, 96)
}

fn pcb_panel_label(workspace_id: &str, pane_id: &str) -> String {
    format!(
        "{PCB_PANEL_LABEL_PREFIX}{}-{}",
        pcb_panel_safe_label_part(workspace_id, "workspace"),
        pcb_panel_safe_label_part(pane_id, "pane")
    )
}

fn emit_pcb_panel_closed(app: &tauri::AppHandle, workspace_id: &str, pane_id: &str, window_id: &str) {
    let _ = app.emit(
        PCB_PANEL_CLOSED_EVENT,
        serde_json::json!({
            "pane_id": pane_id,
            "window_id": window_id,
            "workspace_id": workspace_id,
        }),
    );
}

#[tauri::command(rename_all = "snake_case")]
async fn pcb_panel_open(
    app: tauri::AppHandle,
    repo_path: String,
    workspace_id: String,
    pane_id: String,
    theme: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<PcbPanelOpenResult, String> {
    let workspace_text = workspace_id.trim().chars().take(512).collect::<String>();
    let pane_text = pane_id.trim().chars().take(512).collect::<String>();
    if workspace_text.is_empty() {
        return Err("PCB panel workspace id is required.".to_string());
    }
    if pane_text.is_empty() {
        return Err("PCB panel pane id is required.".to_string());
    }

    let (root, hardware) = pcb_hardware_root(repo_path.as_str())?;
    std::fs::create_dir_all(&hardware)
        .map_err(|error| format!("Unable to create hardware directory: {error}"))?;
    let repo_text = root.to_string_lossy().to_string();
    let theme_text = theme
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let theme_text = if theme_text == "light" { "light" } else { "dark" };
    let label = pcb_panel_label(&workspace_text, &pane_text);

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(PcbPanelOpenResult { label });
    }

    let window_width = width
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(480.0, 2400.0))
        .unwrap_or(PCB_PANEL_DEFAULT_WIDTH);
    let window_height = height
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(360.0, 1600.0))
        .unwrap_or(PCB_PANEL_DEFAULT_HEIGHT);

    let url = format!(
        "index.html#/pcb-window?mode=panel&paneId={}&repoPath={}&theme={}&windowId={}&workspaceId={}",
        percent_encode_query_component(&pane_text),
        percent_encode_query_component(&repo_text),
        percent_encode_query_component(theme_text),
        percent_encode_query_component(&label),
        percent_encode_query_component(&workspace_text),
    );

    let window = WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::App(url.into()))
        .title("PCB - Diff Forge")
        .inner_size(window_width, window_height)
        .min_inner_size(480.0, 360.0)
        .resizable(true)
        .decorations(false)
        .focused(true)
        .accept_first_mouse(true)
        .transparent(true)
        .background_color(Color(2, 3, 4, 255))
        .shadow(true)
        .build()
        .map_err(|error| format!("Unable to create PCB panel window: {error}"))?;

    let app_for_events = app.clone();
    let workspace_for_events = workspace_text.clone();
    let pane_for_events = pane_text.clone();
    let label_for_events = label.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            emit_pcb_panel_closed(
                &app_for_events,
                &workspace_for_events,
                &pane_for_events,
                &label_for_events,
            );
        }
    });

    Ok(PcbPanelOpenResult { label })
}

#[tauri::command(rename_all = "snake_case")]
async fn pcb_panel_focus(app: tauri::AppHandle, workspace_id: String, pane_id: String) -> Result<bool, String> {
    let label = pcb_panel_label(&workspace_id, &pane_id);
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(false);
    };
    let _ = window.show();
    let _ = window.set_focus();
    Ok(true)
}

#[tauri::command(rename_all = "snake_case")]
async fn pcb_panel_close(app: tauri::AppHandle, workspace_id: String, pane_id: String) -> Result<(), String> {
    let workspace_text = workspace_id.trim().to_string();
    let pane_text = pane_id.trim().to_string();
    let label = pcb_panel_label(&workspace_text, &pane_text);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    } else {
        emit_pcb_panel_closed(&app, &workspace_text, &pane_text, &label);
    }
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
async fn pcb_window_open(
    app: tauri::AppHandle,
    repo_path: String,
    board_path: String,
    board_name: Option<String>,
    workspace_id: Option<String>,
    tab: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    // Validate the board lives under the workspace hardware/ tree before we
    // hand its path to a new window.
    let (root, _) = pcb_hardware_root(repo_path.as_str())?;
    let workspace_text = pcb_workspace_text(workspace_id);
    let repo_text = root.to_string_lossy().to_string();
    if workspace_text.is_empty() {
        let _ = pcb_resolve_board_abs(&root, board_path.as_str())?;
    } else {
        let _ = pcb_document_read_blocking(
            repo_text.clone(),
            board_path.clone(),
            Some(workspace_text.clone()),
            pcb_live_workspace_ids(&app),
        )?;
    }

    let label = pcb_window_label(&repo_text, &workspace_text, &board_path);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let name = board_name
        .map(|value| value.trim().chars().take(120).collect::<String>())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "PCB".to_string());
    let tab = tab
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "pcb".to_string());

    let url = format!(
        "index.html#/pcb-window?boardPath={}&repoPath={}&boardName={}&tab={}&workspaceId={}",
        percent_encode_query_component(&board_path),
        percent_encode_query_component(&repo_text),
        percent_encode_query_component(&name),
        percent_encode_query_component(&tab),
        percent_encode_query_component(&workspace_text),
    );

    let window_width = width
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(480.0, 2400.0))
        .unwrap_or(PCB_WINDOW_DEFAULT_WIDTH);
    let window_height = height
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(360.0, 1600.0))
        .unwrap_or(PCB_WINDOW_DEFAULT_HEIGHT);

    let window = WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::App(url.into()))
        .title(format!("{name} — PCB · Diff Forge"))
        .inner_size(window_width, window_height)
        .min_inner_size(480.0, 360.0)
        .resizable(true)
        .focused(true)
        .build()
        .map_err(|error| format!("Unable to create PCB window: {error}"))?;

    let app_for_events = app.clone();
    let board_for_events = board_path.clone();
    let repo_for_events = repo_text.clone();
    let workspace_for_events = workspace_text.clone();
    let label_for_events = label.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = app_for_events.emit(
                PCB_WINDOW_CLOSED_EVENT,
                serde_json::json!({
                    "board_path": board_for_events,
                    "repo_path": repo_for_events,
                    "window_id": label_for_events,
                    "workspace_id": workspace_for_events,
                }),
            );
        }
    });

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
async fn pcb_window_close(
    app: tauri::AppHandle,
    board_path: String,
    repo_path: Option<String>,
    workspace_id: Option<String>,
) -> Result<(), String> {
    let repo_text = repo_path
        .as_deref()
        .and_then(|value| pcb_hardware_root(value).ok().map(|(root, _)| root.to_string_lossy().to_string()))
        .unwrap_or_default();
    let workspace_text = pcb_workspace_text(workspace_id);
    let label = pcb_window_label(&repo_text, &workspace_text, &board_path);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }
    Ok(())
}

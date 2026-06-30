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

// Per-workspace watch roots already wired up, so repeated `pcb_watch_start`
// calls from a remounting PcbView are idempotent.
static PCB_WATCH_ROOTS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
    std::sync::OnceLock::new();

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
                        }));
                    }
                }
            }
        }
    }
}

fn pcb_documents_list_blocking(repo_path: String) -> Result<serde_json::Value, String> {
    let (root, hardware) = pcb_hardware_root(repo_path.as_str())?;
    let mut boards: Vec<serde_json::Value> = Vec::new();
    if hardware.is_dir() {
        pcb_collect_boards(&hardware, &root, &mut boards);
    }
    boards.sort_by(|a, b| {
        a.get("path")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .cmp(b.get("path").and_then(|v| v.as_str()).unwrap_or_default())
    });
    Ok(serde_json::json!({
        "repoPath": root.to_string_lossy(),
        "boards": boards,
    }))
}

fn pcb_document_read_blocking(repo_path: String, board_path: String) -> Result<serde_json::Value, String> {
    let (root, _) = pcb_hardware_root(repo_path.as_str())?;
    let abs = pcb_resolve_board_abs(&root, board_path.as_str())?;
    let source = std::fs::read_to_string(&abs)
        .map_err(|error| format!("Unable to read board {board_path}: {error}"))?;
    Ok(serde_json::json!({
        "path": pcb_relative_path(&root, &abs),
        "name": pcb_board_id(&abs),
        "source": source,
    }))
}

fn pcb_document_create_blocking(repo_path: String, name: String) -> Result<serde_json::Value, String> {
    let (root, hardware) = pcb_hardware_root(repo_path.as_str())?;
    let slug = pcb_slugify(name.as_str());
    let dir = hardware.join(&slug);
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Unable to create board directory: {error}"))?;
    let file = dir.join(format!("{slug}{PCB_BOARD_EXTENSION}"));
    let source = if file.exists() {
        std::fs::read_to_string(&file)
            .map_err(|error| format!("Unable to read existing board: {error}"))?
    } else {
        let starter = pcb_starter_source(&slug);
        std::fs::write(&file, &starter)
            .map_err(|error| format!("Unable to write board: {error}"))?;
        starter
    };
    Ok(serde_json::json!({
        "path": pcb_relative_path(&root, &file),
        "name": slug,
        "source": source,
    }))
}

#[tauri::command]
async fn pcb_documents_list(repo_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || pcb_documents_list_blocking(repo_path))
        .await
        .map_err(|error| format!("PCB document list worker failed: {error}"))?
}

#[tauri::command]
async fn pcb_document_read(repo_path: String, board_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || pcb_document_read_blocking(repo_path, board_path))
        .await
        .map_err(|error| format!("PCB document read worker failed: {error}"))?
}

#[tauri::command]
async fn pcb_document_create(repo_path: String, name: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || pcb_document_create_blocking(repo_path, name))
        .await
        .map_err(|error| format!("PCB document create worker failed: {error}"))?
}

// Ensure a debounced filesystem watcher is running for this workspace's
// hardware/ directory, emitting `pcb-store-changed` on any board edit. Mirrors
// architecture_store_watcher_start but scoped per workspace and started on demand.
#[tauri::command]
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
                    "repoPath": repo_display,
                    "paths": paths,
                    "changedAtMs": architecture_now_millis(),
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

fn pcb_window_label(board_path: &str) -> String {
    let safe = board_path
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
    format!("{PCB_WINDOW_LABEL_PREFIX}{safe}")
}

fn pcb_panel_safe_label_part(value: &str, fallback: &str) -> String {
    let safe = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .take(96)
        .collect::<String>();
    if safe.is_empty() {
        fallback.to_string()
    } else {
        safe
    }
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
            "paneId": pane_id,
            "windowId": window_id,
            "workspaceId": workspace_id,
        }),
    );
}

#[tauri::command]
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

#[tauri::command]
async fn pcb_panel_focus(app: tauri::AppHandle, workspace_id: String, pane_id: String) -> Result<bool, String> {
    let label = pcb_panel_label(&workspace_id, &pane_id);
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(false);
    };
    let _ = window.show();
    let _ = window.set_focus();
    Ok(true)
}

#[tauri::command]
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

#[tauri::command]
async fn pcb_window_open(
    app: tauri::AppHandle,
    repo_path: String,
    board_path: String,
    board_name: Option<String>,
    tab: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    // Validate the board lives under the workspace hardware/ tree before we
    // hand its path to a new window.
    let (root, _) = pcb_hardware_root(repo_path.as_str())?;
    let _ = pcb_resolve_board_abs(&root, board_path.as_str())?;

    let label = pcb_window_label(&board_path);
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
        "index.html#/pcb-window?boardPath={}&repoPath={}&boardName={}&tab={}",
        percent_encode_query_component(&board_path),
        percent_encode_query_component(&repo_path),
        percent_encode_query_component(&name),
        percent_encode_query_component(&tab),
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
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = app_for_events.emit(
                PCB_WINDOW_CLOSED_EVENT,
                serde_json::json!({ "boardPath": board_for_events }),
            );
        }
    });

    Ok(())
}

#[tauri::command]
async fn pcb_window_close(app: tauri::AppHandle, board_path: String) -> Result<(), String> {
    let label = pcb_window_label(&board_path);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }
    Ok(())
}

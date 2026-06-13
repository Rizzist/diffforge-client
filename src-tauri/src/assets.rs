const DIFFFORGE_UNTRACKED_ASSETS_UPDATED_EVENT: &str = "diffforge-untracked-assets-updated";
const DIFFFORGE_UNTRACKED_ASSET_DIR: &str = "untracked";
const DIFFFORGE_UNTRACKED_ASSET_MAX_ROWS: usize = 1000;
const DIFFFORGE_UNTRACKED_ASSET_MAX_DEPTH: usize = 8;
const DIFFFORGE_UNTRACKED_ASSET_WATCH_DEBOUNCE_MS: u64 = 180;
const DIFFFORGE_UNTRACKED_TEXT_ASSET_MAX_BYTES: usize = 16 * 1024 * 1024;
const DIFFFORGE_UNTRACKED_DATA_URL_ASSET_MAX_BYTES: usize = 96 * 1024 * 1024;

static DIFFFORGE_UNTRACKED_ASSET_WATCHER_STARTED: AtomicBool = AtomicBool::new(false);
static DIFFFORGE_UNTRACKED_ASSET_WATCHER: OnceLock<StdMutex<Option<notify::RecommendedWatcher>>> =
    OnceLock::new();

fn diffforge_untracked_asset_watcher_slot(
) -> &'static StdMutex<Option<notify::RecommendedWatcher>> {
    DIFFFORGE_UNTRACKED_ASSET_WATCHER.get_or_init(|| StdMutex::new(None))
}

fn diffforge_untracked_asset_root() -> Result<PathBuf, String> {
    Ok(cloud_mcp_managed_asset_root()?.join(DIFFFORGE_UNTRACKED_ASSET_DIR))
}

fn diffforge_clean_path(path: PathBuf) -> PathBuf {
    let mut cleaned = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => cleaned.push(prefix.as_os_str()),
            Component::RootDir => cleaned.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                cleaned.pop();
            }
            Component::Normal(value) => cleaned.push(value),
        }
    }
    cleaned
}

fn diffforge_absolute_asset_path(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    absolute
        .canonicalize()
        .unwrap_or_else(|_| diffforge_clean_path(absolute))
}

fn diffforge_path_is_inside_untracked_assets(path: &Path) -> Result<bool, String> {
    let root = diffforge_untracked_asset_root()?;
    let root = root
        .canonicalize()
        .unwrap_or_else(|_| diffforge_clean_path(root));
    let candidate = diffforge_absolute_asset_path(path);
    Ok(candidate == root || candidate.starts_with(&root))
}

fn diffforge_path_is_inside_managed_assets(path: &Path) -> Result<bool, String> {
    let root = cloud_mcp_managed_asset_root()?;
    let root = root
        .canonicalize()
        .unwrap_or_else(|_| diffforge_clean_path(root));
    let candidate = diffforge_absolute_asset_path(path);
    Ok(candidate == root || candidate.starts_with(&root))
}

fn diffforge_reject_untracked_asset_path_for_tracking(path: &Path, action: &str) -> Result<(), String> {
    if diffforge_path_is_inside_untracked_assets(path).unwrap_or(false) {
        return Err(format!(
            "Cannot {action} from the untracked asset scratch folder. Use Track in the Assets UI to promote it first."
        ));
    }
    Ok(())
}

fn diffforge_asset_group_is_untracked(group: &str) -> bool {
    cloud_mcp_sanitize_asset_filename(group, "generated").eq_ignore_ascii_case(DIFFFORGE_UNTRACKED_ASSET_DIR)
}

fn diffforge_prepare_untracked_asset_root() -> Result<PathBuf, String> {
    let root = diffforge_untracked_asset_root()?;
    for directory in [
        root.clone(),
        root.join("snips"),
        root.join("edits"),
        root.join("imports"),
        root.join(".meta"),
        root.join(".tmp"),
    ] {
        fs::create_dir_all(&directory).map_err(|error| {
            format!(
                "Unable to create untracked asset directory {}: {error}",
                directory.display()
            )
        })?;
    }
    Ok(root)
}

fn diffforge_system_time_ms(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
}

fn diffforge_untracked_asset_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("asset")
        .to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiffforgeSaveUntrackedTextAssetRequest {
    group: Option<String>,
    name: Option<String>,
    overwrite: Option<bool>,
    path: Option<String>,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiffforgeSaveUntrackedDataUrlAssetRequest {
    data_url: String,
    group: Option<String>,
    name: Option<String>,
}

fn diffforge_untracked_asset_target(
    root: &Path,
    group: Option<&str>,
    name: Option<&str>,
    fallback_name: &str,
) -> Result<PathBuf, String> {
    let group = group
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| cloud_mcp_sanitize_asset_filename(value, "exports"))
        .unwrap_or_else(|| "exports".to_string());
    let target_dir = root.join(group);
    fs::create_dir_all(&target_dir).map_err(|error| {
        format!(
            "Unable to create untracked asset directory {}: {error}",
            target_dir.display()
        )
    })?;
    let filename = name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| cloud_mcp_sanitize_asset_filename(value, fallback_name))
        .unwrap_or_else(|| fallback_name.to_string());
    Ok(cloud_mcp_available_asset_download_path(&target_dir, &filename))
}

fn diffforge_untracked_asset_item(root: &Path, path: &Path) -> Result<Value, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Unable to read untracked asset {}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("Untracked asset is not a file: {}", path.display()));
    }
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if !diffforge_path_is_inside_untracked_assets(&canonical)? {
        return Err(format!(
            "Untracked asset path is outside the scratch folder: {}",
            path.display()
        ));
    }
    let relative_path = path
        .strip_prefix(root)
        .ok()
        .map(|value| value.display().to_string())
        .unwrap_or_else(|| diffforge_untracked_asset_name(path));
    let name = diffforge_untracked_asset_name(path);
    let mime_type = cloud_mcp_asset_mime_for_path(path);
    let kind = cloud_mcp_asset_kind_for_mime(&mime_type);
    let modified_ms = metadata.modified().ok().and_then(diffforge_system_time_ms);
    let created_ms = metadata.created().ok().and_then(diffforge_system_time_ms);
    let group = path
        .strip_prefix(root)
        .ok()
        .and_then(|value| value.components().next())
        .and_then(|component| match component {
            Component::Normal(value) => value.to_str().map(str::to_string),
            _ => None,
        })
        .unwrap_or_else(|| "scratch".to_string());
    let id = format!("untracked-{}", cloud_mcp_short_hash(&relative_path));
    let local_path = canonical.display().to_string();
    Ok(json!({
        "id": id.clone(),
        "untracked_id": id.clone(),
        "untrackedId": id,
        "name": name.clone(),
        "filename": name,
        "kind": kind,
        "mime_type": mime_type.clone(),
        "mimeType": mime_type,
        "size_bytes": metadata.len(),
        "sizeBytes": metadata.len(),
        "local_path": local_path.clone(),
        "localPath": local_path.clone(),
        "path": local_path,
        "relative_path": relative_path.clone(),
        "relativePath": relative_path,
        "group": group,
        "cloud_status": "untracked",
        "cloudStatus": "untracked",
        "local_status": "untracked",
        "localStatus": "untracked",
        "tracking_status": "untracked",
        "trackingStatus": "untracked",
        "asset_scope": "untracked",
        "assetScope": "untracked",
        "untracked": true,
        "trackable": true,
        "modified_ms": modified_ms,
        "modifiedMs": modified_ms,
        "created_ms": created_ms,
        "createdMs": created_ms,
    }))
}

fn diffforge_should_skip_untracked_entry(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    name.is_empty() || name.starts_with('.') || matches!(name, ".meta" | ".tmp")
}

fn diffforge_collect_untracked_assets(
    root: &Path,
    directory: &Path,
    depth: usize,
    items: &mut Vec<Value>,
) -> Result<(), String> {
    if depth > DIFFFORGE_UNTRACKED_ASSET_MAX_DEPTH || items.len() >= DIFFFORGE_UNTRACKED_ASSET_MAX_ROWS {
        return Ok(());
    }
    let entries = fs::read_dir(directory).map_err(|error| {
        format!(
            "Unable to read untracked asset directory {}: {error}",
            directory.display()
        )
    })?;
    for entry in entries {
        if items.len() >= DIFFFORGE_UNTRACKED_ASSET_MAX_ROWS {
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if diffforge_should_skip_untracked_entry(&path) {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            diffforge_collect_untracked_assets(root, &path, depth + 1, items)?;
        } else if file_type.is_file() {
            if let Ok(item) = diffforge_untracked_asset_item(root, &path) {
                items.push(item);
            }
        }
    }
    Ok(())
}

fn diffforge_untracked_asset_library(limit: Option<u64>) -> Result<Value, String> {
    let root = diffforge_prepare_untracked_asset_root()?;
    let mut items = Vec::new();
    diffforge_collect_untracked_assets(&root, &root, 0, &mut items)?;
    items.sort_by(|left, right| {
        let left_ms = left
            .get("modified_ms")
            .or_else(|| left.get("modifiedMs"))
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let right_ms = right
            .get("modified_ms")
            .or_else(|| right.get("modifiedMs"))
            .and_then(Value::as_u64)
            .unwrap_or_default();
        right_ms.cmp(&left_ms)
    });
    let limit = limit
        .unwrap_or(DIFFFORGE_UNTRACKED_ASSET_MAX_ROWS as u64)
        .clamp(1, DIFFFORGE_UNTRACKED_ASSET_MAX_ROWS as u64) as usize;
    items.truncate(limit);
    let image_count = items
        .iter()
        .filter(|item| {
            item.get("mime_type")
                .or_else(|| item.get("mimeType"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .starts_with("image/")
        })
        .count();
    let count = items.len();
    let asset_root = cloud_mcp_managed_asset_root()?;
    Ok(json!({
        "kind": "untracked_assets",
        "version": 1,
        "source": "local_untracked_asset_directory",
        "asset_root": asset_root.display().to_string(),
        "assetRoot": asset_root.display().to_string(),
        "untracked_root": root.display().to_string(),
        "untrackedRoot": root.display().to_string(),
        "items": items.clone(),
        "assets": items,
        "count": count,
        "aggregate": {
            "status": "local_only",
            "count": count,
            "image_count": image_count,
            "imageCount": image_count,
            "syncable": false,
            "mcp_visible": false,
            "mcpVisible": false,
        }
    }))
}

fn diffforge_untracked_asset_file(path: &str) -> Result<PathBuf, String> {
    let raw_path = PathBuf::from(path);
    let canonical = raw_path
        .canonicalize()
        .map_err(|error| format!("Untracked asset does not exist: {path}: {error}"))?;
    if !canonical.is_file() {
        return Err(format!("Untracked asset is not a file: {}", canonical.display()));
    }
    if !diffforge_path_is_inside_untracked_assets(&canonical)? {
        return Err(format!(
            "Path is outside the untracked asset scratch folder: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn diffforge_local_asset_file(path: &str) -> Result<PathBuf, String> {
    let raw_path = PathBuf::from(path);
    let canonical = raw_path
        .canonicalize()
        .map_err(|error| format!("Asset does not exist: {path}: {error}"))?;
    if !canonical.is_file() {
        return Err(format!("Asset is not a file: {}", canonical.display()));
    }
    Ok(canonical)
}

fn diffforge_copy_image_file_to_clipboard(file: &Path) -> Result<Value, String> {
    let image = xcap::image::open(file)
        .map_err(|error| format!("Unable to read image {}: {error}", file.display()))?
        .into_rgba8();
    let width = image.width() as usize;
    let height = image.height() as usize;
    let bytes = image.into_raw();
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("Unable to open system clipboard: {error}"))?;
    clipboard
        .set_image(arboard::ImageData {
            width,
            height,
            bytes: std::borrow::Cow::Owned(bytes),
        })
        .map_err(|error| format!("Unable to copy image to clipboard: {error}"))?;

    Ok(json!({
        "kind": "asset_clipboard_image_copied",
        "path": file.display().to_string(),
        "width": width,
        "height": height,
    }))
}

fn diffforge_copy_image_data_url_to_clipboard_for(image_data_url: &str) -> Result<Value, String> {
    let encoded = image_data_url
        .split_once(',')
        .map(|(_, value)| value)
        .unwrap_or(image_data_url);
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("Unable to decode clipboard image: {error}"))?;
    let image = xcap::image::load_from_memory(&bytes)
        .map_err(|error| format!("Clipboard image is not a valid image: {error}"))?
        .into_rgba8();
    let width = image.width() as usize;
    let height = image.height() as usize;
    let bytes = image.into_raw();
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("Unable to open system clipboard: {error}"))?;
    clipboard
        .set_image(arboard::ImageData {
            width,
            height,
            bytes: std::borrow::Cow::Owned(bytes),
        })
        .map_err(|error| format!("Unable to copy image to clipboard: {error}"))?;

    Ok(json!({
        "kind": "asset_clipboard_image_copied",
        "width": width,
        "height": height,
    }))
}

fn diffforge_delete_tracked_asset_cache_row(asset_id: &str) -> Result<(), String> {
    let conn = cloud_mcp_open_asset_library_conn()?;
    conn.execute(
        "DELETE FROM account_asset_transfers WHERE asset_id=?1",
        rusqlite::params![asset_id],
    )
    .map_err(|error| format!("Unable to remove tracked asset transfers from cache: {error}"))?;
    conn.execute(
        "DELETE FROM account_asset_items WHERE asset_id=?1",
        rusqlite::params![asset_id],
    )
    .map_err(|error| format!("Unable to remove tracked asset from cache: {error}"))?;
    Ok(())
}

fn diffforge_remove_empty_untracked_parents(path: &Path) {
    let Ok(root) = diffforge_untracked_asset_root() else {
        return;
    };
    let root = root
        .canonicalize()
        .unwrap_or_else(|_| diffforge_clean_path(root));
    let mut current = path.parent().map(Path::to_path_buf);
    while let Some(directory) = current {
        if directory == root || !directory.starts_with(&root) {
            break;
        }
        if fs::remove_dir(&directory).is_err() {
            break;
        }
        current = directory.parent().map(Path::to_path_buf);
    }
}

fn diffforge_emit_untracked_assets_updated(app: &AppHandle, reason: &str, item: Option<Value>) {
    let mut payload = json!({
        "kind": "untracked_assets_updated",
        "event_kind": "untracked_assets_updated",
        "eventKind": "untracked_assets_updated",
        "reason": reason,
    });
    if let (Some(object), Some(item)) = (payload.as_object_mut(), item) {
        object.insert("item".to_string(), item);
    }
    let _ = app.emit(DIFFFORGE_UNTRACKED_ASSETS_UPDATED_EVENT, payload);
}

#[tauri::command]
fn diffforge_start_untracked_assets_watcher(app: AppHandle) -> Result<Value, String> {
    let root = diffforge_prepare_untracked_asset_root()?;
    if DIFFFORGE_UNTRACKED_ASSET_WATCHER_STARTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(json!({
            "ok": true,
            "already_running": true,
            "untracked_root": root.display().to_string(),
            "untrackedRoot": root.display().to_string(),
        }));
    }

    let app_for_watch = app.clone();
    let pending = Arc::new(AtomicBool::new(false));
    let pending_for_watch = pending.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else {
            return;
        };
        match event.kind {
            notify::event::EventKind::Any
            | notify::event::EventKind::Create(_)
            | notify::event::EventKind::Modify(_)
            | notify::event::EventKind::Remove(_) => {}
            _ => return,
        }
        if pending_for_watch
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        let app_for_emit = app_for_watch.clone();
        let pending_for_emit = pending_for_watch.clone();
        tauri::async_runtime::spawn(async move {
            sleep(Duration::from_millis(DIFFFORGE_UNTRACKED_ASSET_WATCH_DEBOUNCE_MS)).await;
            diffforge_emit_untracked_assets_updated(&app_for_emit, "file-change", None);
            pending_for_emit.store(false, Ordering::SeqCst);
        });
    })
    .map_err(|error| {
        DIFFFORGE_UNTRACKED_ASSET_WATCHER_STARTED.store(false, Ordering::SeqCst);
        format!("Unable to create untracked asset watcher: {error}")
    })?;
    notify::Watcher::watch(&mut watcher, &root, notify::RecursiveMode::Recursive)
        .map_err(|error| {
            DIFFFORGE_UNTRACKED_ASSET_WATCHER_STARTED.store(false, Ordering::SeqCst);
            format!(
                "Unable to watch untracked asset directory {}: {error}",
                root.display()
            )
        })?;
    let slot = diffforge_untracked_asset_watcher_slot();
    let mut guard = slot
        .lock()
        .map_err(|_| "Unable to lock untracked asset watcher state.".to_string())?;
    *guard = Some(watcher);
    Ok(json!({
        "ok": true,
        "already_running": false,
        "untracked_root": root.display().to_string(),
        "untrackedRoot": root.display().to_string(),
    }))
}

#[tauri::command]
fn diffforge_list_untracked_assets(limit: Option<u64>) -> Result<Value, String> {
    diffforge_untracked_asset_library(limit)
}

#[tauri::command]
fn diffforge_delete_untracked_asset(app: AppHandle, path: String) -> Result<Value, String> {
    let file = diffforge_untracked_asset_file(&path)?;
    fs::remove_file(&file).map_err(|error| {
        format!(
            "Unable to delete untracked asset {}: {error}",
            file.display()
        )
    })?;
    diffforge_remove_empty_untracked_parents(&file);
    snipping_handle_untracked_asset_deleted(&app, &file.display().to_string());
    diffforge_emit_untracked_assets_updated(&app, "deleted", None);
    Ok(json!({
        "kind": "untracked_asset_deleted",
        "path": file.display().to_string(),
        "library": diffforge_untracked_asset_library(None)?,
    }))
}

#[tauri::command]
fn diffforge_rename_untracked_asset(
    app: AppHandle,
    path: String,
    new_name: String,
) -> Result<Value, String> {
    let file = diffforge_untracked_asset_file(&path)?;
    let root = diffforge_prepare_untracked_asset_root()?;
    let filename = cloud_mcp_sanitize_asset_filename(&new_name, "asset");
    let parent = file
        .parent()
        .ok_or_else(|| "Untracked asset has no parent directory.".to_string())?;
    let target = cloud_mcp_available_asset_download_path(parent, &filename);
    if !diffforge_path_is_inside_untracked_assets(&target)? {
        return Err("Rename target is outside the untracked asset scratch folder.".to_string());
    }
    fs::rename(&file, &target).map_err(|error| {
        format!(
            "Unable to rename untracked asset {} to {}: {error}",
            file.display(),
            target.display()
        )
    })?;
    let item = diffforge_untracked_asset_item(&root, &target).ok();
    diffforge_emit_untracked_assets_updated(&app, "renamed", item.clone());
    Ok(json!({
        "kind": "untracked_asset_renamed",
        "path": target.display().to_string(),
        "old_path": file.display().to_string(),
        "oldPath": file.display().to_string(),
        "item": item,
        "library": diffforge_untracked_asset_library(None)?,
    }))
}

#[tauri::command]
fn diffforge_copy_asset_to_clipboard(path: String) -> Result<Value, String> {
    let file = diffforge_local_asset_file(&path)?;
    diffforge_copy_image_file_to_clipboard(&file)
}

#[tauri::command]
fn diffforge_save_untracked_text_asset(
    app: AppHandle,
    request: DiffforgeSaveUntrackedTextAssetRequest,
) -> Result<Value, String> {
    if request.text.len() > DIFFFORGE_UNTRACKED_TEXT_ASSET_MAX_BYTES {
        return Err(format!(
            "Text asset is too large. Keep exports under {} MB.",
            DIFFFORGE_UNTRACKED_TEXT_ASSET_MAX_BYTES / 1024 / 1024
        ));
    }

    let root = diffforge_prepare_untracked_asset_root()?;
    let tmp_dir = root.join(".tmp");
    let overwrite = request.overwrite.unwrap_or(false);
    let target = if overwrite {
        if let Some(path) = request
            .path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            diffforge_untracked_asset_file(path)?
        } else {
            return Err("An existing untracked asset path is required to overwrite.".to_string());
        }
    } else {
        let fallback_name = "hyperframe.html";
        let mut filename = request
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| cloud_mcp_sanitize_asset_filename(value, fallback_name))
            .unwrap_or_else(|| fallback_name.to_string());
        if Path::new(&filename).extension().is_none() {
            filename.push_str(".html");
        }
        diffforge_untracked_asset_target(
            &root,
            request.group.as_deref().or(Some("hyperframes")),
            Some(&filename),
            fallback_name,
        )?
    };

    if !diffforge_path_is_inside_untracked_assets(&target)? {
        return Err(format!(
            "Text asset target is outside the scratch folder: {}",
            target.display()
        ));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Unable to create text asset directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let tmp = tmp_dir.join(format!(
        ".text-asset-{}.tmp",
        uuid::Uuid::new_v4()
    ));
    fs::write(&tmp, request.text.as_bytes())
        .map_err(|error| format!("Unable to write text asset {}: {error}", tmp.display()))?;
    fs::rename(&tmp, &target).map_err(|error| {
        let _ = fs::remove_file(&tmp);
        format!(
            "Unable to move text asset {} to {}: {error}",
            tmp.display(),
            target.display()
        )
    })?;

    let item = diffforge_untracked_asset_item(&root, &target).ok();
    diffforge_emit_untracked_assets_updated(&app, "text-asset-saved", item.clone());
    Ok(json!({
        "kind": "untracked_text_asset_saved",
        "path": target.display().to_string(),
        "item": item,
        "library": diffforge_untracked_asset_library(None)?,
    }))
}

#[tauri::command]
fn diffforge_save_untracked_data_url_asset(
    app: AppHandle,
    request: DiffforgeSaveUntrackedDataUrlAssetRequest,
) -> Result<Value, String> {
    let encoded = request
        .data_url
        .split_once(',')
        .map(|(_, value)| value)
        .unwrap_or(request.data_url.as_str());
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("Unable to decode asset data URL: {error}"))?;
    if bytes.len() > DIFFFORGE_UNTRACKED_DATA_URL_ASSET_MAX_BYTES {
        return Err(format!(
            "Asset export is too large. Keep data URL exports under {} MB.",
            DIFFFORGE_UNTRACKED_DATA_URL_ASSET_MAX_BYTES / 1024 / 1024
        ));
    }
    let root = diffforge_prepare_untracked_asset_root()?;
    let target = diffforge_untracked_asset_target(
        &root,
        request.group.as_deref().or(Some("hyperframes")),
        request.name.as_deref(),
        "hyperframe-export.bin",
    )?;
    if !diffforge_path_is_inside_untracked_assets(&target)? {
        return Err(format!(
            "Asset export target is outside the scratch folder: {}",
            target.display()
        ));
    }
    let tmp_dir = root.join(".tmp");
    let tmp = tmp_dir.join(format!(
        ".data-url-asset-{}.tmp",
        uuid::Uuid::new_v4()
    ));
    fs::write(&tmp, &bytes)
        .map_err(|error| format!("Unable to write asset export {}: {error}", tmp.display()))?;
    fs::rename(&tmp, &target).map_err(|error| {
        let _ = fs::remove_file(&tmp);
        format!(
            "Unable to move asset export {} to {}: {error}",
            tmp.display(),
            target.display()
        )
    })?;
    let item = diffforge_untracked_asset_item(&root, &target).ok();
    diffforge_emit_untracked_assets_updated(&app, "data-url-asset-saved", item.clone());
    Ok(json!({
        "kind": "untracked_data_url_asset_saved",
        "path": target.display().to_string(),
        "item": item,
        "library": diffforge_untracked_asset_library(None)?,
    }))
}

#[tauri::command]
fn diffforge_copy_image_data_url_to_clipboard(image_data_url: String) -> Result<Value, String> {
    diffforge_copy_image_data_url_to_clipboard_for(&image_data_url)
}

#[tauri::command]
fn diffforge_untrack_account_asset(
    app: AppHandle,
    asset_id: String,
    path: Option<String>,
    name: Option<String>,
    delete_source: Option<bool>,
) -> Result<Value, String> {
    let asset_id = asset_id.trim().to_string();
    if asset_id.is_empty() {
        return Err("Asset id is required to untrack an asset.".to_string());
    }

    let row = cloud_mcp_asset_row_from_file(&asset_id)?;
    let local_path = path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| cloud_mcp_payload_text(&row, &["local_path", "localPath", "path"]))
        .ok_or_else(|| "Download the asset locally before untracking it.".to_string())?;
    let source = diffforge_local_asset_file(&local_path)?;
    if diffforge_path_is_inside_untracked_assets(&source).unwrap_or(false) {
        return Err("Asset is already in the untracked scratch folder.".to_string());
    }

    let root = diffforge_prepare_untracked_asset_root()?;
    let imports_dir = root.join("imports");
    fs::create_dir_all(&imports_dir).map_err(|error| {
        format!(
            "Unable to create untracked imports directory {}: {error}",
            imports_dir.display()
        )
    })?;
    let source_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("asset");
    let filename = cloud_mcp_sanitize_asset_filename(
        name.as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(source_name),
        "asset",
    );
    let target = cloud_mcp_available_asset_download_path(&imports_dir, &filename);
    fs::copy(&source, &target).map_err(|error| {
        format!(
            "Unable to copy tracked asset {} to untracked scratch {}: {error}",
            source.display(),
            target.display()
        )
    })?;
    let target = target
        .canonicalize()
        .unwrap_or_else(|_| target.to_path_buf());
    let item = diffforge_untracked_asset_item(&root, &target).ok();

    let should_delete_source = delete_source.unwrap_or(true)
        && diffforge_path_is_inside_managed_assets(&source).unwrap_or(false)
        && !diffforge_path_is_inside_untracked_assets(&source).unwrap_or(false);
    let removed_source = if should_delete_source {
        fs::remove_file(&source).map_err(|error| {
            format!(
                "Copied asset to untracked scratch, but removing tracked copy {} failed: {error}",
                source.display()
            )
        })?;
        true
    } else {
        false
    };
    diffforge_delete_tracked_asset_cache_row(&asset_id)?;
    diffforge_emit_untracked_assets_updated(&app, "untracked", item.clone());
    let _ = app.emit(
        CLOUD_MCP_ACCOUNT_ASSETS_UPDATED_EVENT,
        json!({
            "kind": "asset_library_untracked",
            "event_kind": "asset_library_untracked",
            "eventKind": "asset_library_untracked",
            "asset_id": asset_id.clone(),
            "assetId": asset_id.clone(),
            "local_path": local_path,
            "localPath": source.display().to_string(),
            "untracked_path": target.display().to_string(),
            "untrackedPath": target.display().to_string(),
            "source_removed": removed_source,
            "sourceRemoved": removed_source,
        }),
    );

    Ok(json!({
        "kind": "asset_library_untracked",
        "asset_id": asset_id,
        "assetId": asset_id,
        "path": target.display().to_string(),
        "local_path": target.display().to_string(),
        "localPath": target.display().to_string(),
        "item": item,
        "source_removed": removed_source,
        "sourceRemoved": removed_source,
        "library": diffforge_untracked_asset_library(None)?,
    }))
}

#[tauri::command]
fn diffforge_promote_untracked_asset(
    app: AppHandle,
    path: String,
    name: Option<String>,
    group: Option<String>,
    delete_source: Option<bool>,
) -> Result<Value, String> {
    let source = diffforge_untracked_asset_file(&path)?;
    let untracked_root = diffforge_prepare_untracked_asset_root()?;
    let (sha256, size_bytes) = cloud_mcp_file_sha256_and_size(&source)?;
    let req = cloud_mcp_asset_scope_request();
    let asset_id = format!(
        "asset-snip-{}",
        cloud_mcp_short_hash(&format!(
            "{}:{}:{}",
            source.display(),
            sha256,
            size_bytes
        ))
    );
    let group = group
        .as_deref()
        .map(|value| cloud_mcp_sanitize_asset_filename(value, "snips"))
        .filter(|value| !diffforge_asset_group_is_untracked(value))
        .unwrap_or_else(|| "snips".to_string());
    let fallback_name = diffforge_untracked_asset_name(&source);
    let filename = cloud_mcp_sanitize_asset_filename(
        name.as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&fallback_name),
        "snip",
    );
    let asset_root = cloud_mcp_managed_asset_root()?;
    let target_dir = asset_root.join(group).join(&asset_id);
    fs::create_dir_all(&target_dir).map_err(|error| {
        format!(
            "Unable to create tracked asset directory {}: {error}",
            target_dir.display()
        )
    })?;
    let candidate = target_dir.join(&filename);
    let target_path = match cloud_mcp_file_sha256_and_size(&candidate) {
        Ok((candidate_sha, candidate_size)) if candidate_sha == sha256 && candidate_size == size_bytes => candidate,
        Ok(_) => cloud_mcp_available_asset_download_path(&target_dir, &filename),
        Err(_) => candidate,
    };
    if diffforge_path_is_inside_untracked_assets(&target_path)? {
        return Err("Promotion target cannot be inside the untracked scratch folder.".to_string());
    }
    if !target_path.exists() {
        fs::copy(&source, &target_path).map_err(|error| {
            format!(
                "Unable to copy untracked asset {} to {}: {error}",
                source.display(),
                target_path.display()
            )
        })?;
    }
    let target_path = target_path
        .canonicalize()
        .unwrap_or_else(|_| target_path.to_path_buf());
    let relative_path = source
        .strip_prefix(&untracked_root)
        .ok()
        .map(|value| value.display().to_string())
        .unwrap_or_else(|| diffforge_untracked_asset_name(&source));
    let mime_type = cloud_mcp_asset_mime_for_path(&target_path);
    let now = cloud_mcp_rfc3339_now();
    let metadata = json!({
        "source": "untracked_assets",
        "sourceKind": "snip",
        "original_path": source.display().to_string(),
        "originalPath": source.display().to_string(),
        "original_relative_path": relative_path.clone(),
        "originalRelativePath": relative_path,
        "promoted_at": now.clone(),
        "promotedAt": now,
    });
    let input = json!({
        "asset_id": asset_id.clone(),
        "assetId": asset_id.clone(),
        "name": filename.clone(),
        "filename": filename,
        "kind": cloud_mcp_asset_kind_for_mime(&mime_type),
        "mime_type": mime_type.clone(),
        "mimeType": mime_type,
        "source_kind": "snip",
        "sourceKind": "snip",
        "metadata": metadata,
    });
    let row = cloud_mcp_asset_local_row_with_input(
        &req,
        "",
        None,
        &target_path,
        &input,
    )?;
    cloud_mcp_asset_store_local_row(&row)?;
    let removed_source = if delete_source.unwrap_or(true) {
        fs::remove_file(&source).map_err(|error| {
            format!(
                "Tracked asset was created, but removing untracked source {} failed: {error}",
                source.display()
            )
        })?;
        diffforge_remove_empty_untracked_parents(&source);
        true
    } else {
        false
    };
    diffforge_emit_untracked_assets_updated(&app, "promoted", None);
    let _ = app.emit(
        CLOUD_MCP_ACCOUNT_ASSETS_UPDATED_EVENT,
        json!({
            "kind": "asset_library_local_registered",
            "event_kind": "asset_library_local_registered",
            "eventKind": "asset_library_local_registered",
            "asset_id": asset_id.clone(),
            "assetId": asset_id.clone(),
            "payload": {
                "kind": "asset_library_local_registered",
                "asset": row.clone(),
                "assets": [row.clone()],
            }
        }),
    );
    Ok(json!({
        "kind": "untracked_asset_promoted",
        "source": "untracked_assets",
        "asset_id": asset_id.clone(),
        "assetId": asset_id,
        "asset": row,
        "local_path": target_path.display().to_string(),
        "localPath": target_path.display().to_string(),
        "source_path": source.display().to_string(),
        "sourcePath": source.display().to_string(),
        "source_removed": removed_source,
        "sourceRemoved": removed_source,
        "library": diffforge_untracked_asset_library(None)?,
    }))
}

const HYPERFRAME_TRANSCRIBABLE_MEDIA_EXTENSIONS: [&str; 12] = [
    "aac", "flac", "m4a", "m4v", "mov", "mp3", "mp4", "ogg", "opus", "wav", "webm", "wma",
];
const HYPERFRAME_TRANSCRIPT_SRT_SUFFIX: &str = "srt";
const HYPERFRAME_TRANSCRIPT_JSON_SUFFIX: &str = "transcript.json";
const HYPERFRAME_TRANSCRIPT_MAX_TEXT_BYTES: usize = 24 * 1024 * 1024;

fn hyperframe_validated_media_path(raw_path: &str) -> Result<PathBuf, String> {
    let cleaned = raw_path.trim();
    if cleaned.is_empty() {
        return Err("A media file path is required.".to_string());
    }
    let path = PathBuf::from(cleaned);
    if !path.is_absolute() {
        return Err("Media file paths must be absolute.".to_string());
    }
    if !path.is_file() {
        return Err("The media file no longer exists on disk.".to_string());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !HYPERFRAME_TRANSCRIBABLE_MEDIA_EXTENSIONS.contains(&extension.as_str()) {
        return Err("Transcripts can only be attached to audio or video files.".to_string());
    }
    Ok(path)
}

fn hyperframe_transcript_sidecar_paths(media_path: &Path) -> (PathBuf, PathBuf) {
    let file_name = media_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("media");
    let parent = media_path.parent().map(Path::to_path_buf).unwrap_or_default();
    (
        parent.join(format!("{file_name}.{HYPERFRAME_TRANSCRIPT_SRT_SUFFIX}")),
        parent.join(format!("{file_name}.{HYPERFRAME_TRANSCRIPT_JSON_SUFFIX}")),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HyperframeSaveMediaTranscriptRequest {
    media_path: String,
    srt_text: String,
    transcript_json: String,
}

#[tauri::command]
fn hyperframe_save_media_transcript(
    app: AppHandle,
    request: HyperframeSaveMediaTranscriptRequest,
) -> Result<Value, String> {
    let media_path = hyperframe_validated_media_path(&request.media_path)?;
    if request.srt_text.trim().is_empty() || request.transcript_json.trim().is_empty() {
        return Err("Transcript content is empty; nothing to save.".to_string());
    }
    if request.srt_text.len() > HYPERFRAME_TRANSCRIPT_MAX_TEXT_BYTES
        || request.transcript_json.len() > HYPERFRAME_TRANSCRIPT_MAX_TEXT_BYTES
    {
        return Err("Transcript content is too large to save.".to_string());
    }
    serde_json::from_str::<Value>(&request.transcript_json)
        .map_err(|error| format!("Transcript JSON is invalid: {error}"))?;

    let (srt_path, json_path) = hyperframe_transcript_sidecar_paths(&media_path);
    fs::write(&srt_path, request.srt_text.as_bytes())
        .map_err(|error| format!("Unable to save transcript SRT: {error}"))?;
    fs::write(&json_path, request.transcript_json.as_bytes())
        .map_err(|error| format!("Unable to save transcript JSON: {error}"))?;

    // Sidecars live next to the media file, so tracked/untracked/cloud scope always
    // matches the video automatically. Refresh the untracked library if applicable.
    if diffforge_path_is_inside_untracked_assets(&media_path).unwrap_or(false) {
        diffforge_emit_untracked_assets_updated(&app, "transcript-saved", None);
    }

    Ok(json!({
        "jsonPath": json_path.display().to_string(),
        "srtPath": srt_path.display().to_string(),
    }))
}

#[tauri::command]
fn hyperframe_media_transcript_status(media_path: String) -> Result<Value, String> {
    let media_path = hyperframe_validated_media_path(&media_path)?;
    let (srt_path, json_path) = hyperframe_transcript_sidecar_paths(&media_path);
    let srt_exists = srt_path.is_file();
    let json_exists = json_path.is_file();
    let updated_at_ms = json_path
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    Ok(json!({
        "exists": srt_exists && json_exists,
        "jsonPath": if json_exists { json_path.display().to_string() } else { String::new() },
        "srtPath": if srt_exists { srt_path.display().to_string() } else { String::new() },
        "updatedAtMs": updated_at_ms,
    }))
}

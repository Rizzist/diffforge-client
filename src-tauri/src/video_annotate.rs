// Photo annotations: the image counterpart of video transcripts. A sidecar
// JSON cache under media/.cache/annotations/ holds an LLM- or human-written
// description of an image asset. Upscaled derivatives inherit the original's
// annotation (identical content), mirroring how transcript inheritance works
// for converted media. Cloud describe runs a GPT vision model through the
// shared app websocket (`media_describe_request`), billed on the OpenAI
// meter; agents can also write annotations directly (for free) over MCP.

const VIDEO_ANNOTATIONS_DIR: &str = "annotations";
const VIDEO_DESCRIBE_JPEG_DIR: &str = "describe";
const VIDEO_DESCRIBE_PROGRESS_EVENT: &str = "video-describe-progress";
const VIDEO_ANNOTATION_UPDATED_EVENT: &str = "video-annotation-updated";
const VIDEO_DESCRIBE_TIMEOUT_SECS: u64 = 120;
const VIDEO_DESCRIBE_MAX_DIMENSION: u32 = 768;
const VIDEO_DESCRIBE_JPEG_LIMIT_BYTES: u64 = 4 * 1024 * 1024;
const VIDEO_ANNOTATION_BLURB_MAX_CHARS: usize = 280;
const VIDEO_ANNOTATION_DESCRIPTION_MAX_CHARS: usize = 4_000;
const VIDEO_ANNOTATION_OCR_MAX_CHARS: usize = 2_000;
const VIDEO_ANNOTATION_MAX_TAGS: usize = 24;
const VIDEO_ANNOTATION_TAG_MAX_CHARS: usize = 48;
const VIDEO_ANNOTATION_MAX_COLORS: usize = 8;

static VIDEO_DESCRIBE_JOBS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
> = std::sync::OnceLock::new();
// One describe per image at a time: manual describe, auto-describe, and a
// second pane racing the same path would each pass the cache check and bill
// the cloud twice. Keyed by repoPath|path as passed by the frontend.
static VIDEO_DESCRIBE_ACTIVE_PATHS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashSet<String>>,
> = std::sync::OnceLock::new();

fn video_describe_active_paths()
-> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    VIDEO_DESCRIBE_ACTIVE_PATHS
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

fn video_describe_claim_path(key: &str) -> Result<(), String> {
    let mut guard = video_describe_active_paths()
        .lock()
        .map_err(|_| "Describe job registry is unavailable.".to_string())?;
    if !guard.insert(key.to_string()) {
        return Err("This image is already being described.".to_string());
    }
    Ok(())
}

fn video_describe_release_path(key: &str) {
    if let Ok(mut guard) = video_describe_active_paths().lock() {
        guard.remove(key);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoAnnotationCache {
    blurb: String,
    description: String,
    tags: Vec<String>,
    dominant_colors: Vec<String>,
    ocr_text: String,
    orientation: String,
    // "llm" | "user" | "agent" — who wrote the current contents.
    source: String,
    model: String,
    // A human touched it: auto-describe must never overwrite (force only).
    edited: bool,
    created_at_ms: u64,
    updated_at_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoAnnotationUpdateInput {
    blurb: Option<String>,
    description: Option<String>,
    tags: Option<Vec<String>>,
    dominant_colors: Option<Vec<String>>,
    ocr_text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoAnnotationGetResponse {
    available: bool,
    inherited: bool,
    inherited_from: Option<String>,
    annotation: Option<VideoAnnotationCache>,
}

fn video_annotation_trimmed(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    trimmed.chars().take(max_chars).collect::<String>()
}

fn video_annotation_normalize_terms(
    values: &[String],
    max_items: usize,
    max_chars: usize,
) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut terms = Vec::new();
    for value in values {
        let term = video_annotation_trimmed(value, max_chars);
        if term.is_empty() || !seen.insert(term.to_ascii_lowercase()) {
            continue;
        }
        terms.push(term);
        if terms.len() >= max_items {
            break;
        }
    }
    terms
}

fn video_annotation_normalize(annotation: &mut VideoAnnotationCache) {
    annotation.blurb =
        video_annotation_trimmed(&annotation.blurb, VIDEO_ANNOTATION_BLURB_MAX_CHARS);
    annotation.description =
        video_annotation_trimmed(&annotation.description, VIDEO_ANNOTATION_DESCRIPTION_MAX_CHARS);
    annotation.ocr_text =
        video_annotation_trimmed(&annotation.ocr_text, VIDEO_ANNOTATION_OCR_MAX_CHARS);
    annotation.tags = video_annotation_normalize_terms(
        &annotation.tags,
        VIDEO_ANNOTATION_MAX_TAGS,
        VIDEO_ANNOTATION_TAG_MAX_CHARS,
    );
    annotation.dominant_colors = video_annotation_normalize_terms(
        &annotation.dominant_colors,
        VIDEO_ANNOTATION_MAX_COLORS,
        VIDEO_ANNOTATION_TAG_MAX_CHARS,
    );
    if !matches!(annotation.orientation.as_str(), "landscape" | "portrait" | "square") {
        annotation.orientation = String::new();
    }
}

fn video_annotation_orientation(width: Option<u32>, height: Option<u32>) -> String {
    match (width, height) {
        (Some(width), Some(height)) if width > 0 && height > 0 => {
            if width > height {
                "landscape".to_string()
            } else if height > width {
                "portrait".to_string()
            } else {
                "square".to_string()
            }
        }
        _ => String::new(),
    }
}

fn video_annotation_is_empty(annotation: &VideoAnnotationCache) -> bool {
    annotation.blurb.is_empty()
        && annotation.description.is_empty()
        && annotation.tags.is_empty()
        && annotation.ocr_text.is_empty()
}

// Everything an annotation says about an image, lowercased for search.
fn video_annotation_search_text(annotation: &VideoAnnotationCache) -> String {
    let mut parts = Vec::new();
    for part in [
        annotation.blurb.as_str(),
        annotation.description.as_str(),
        annotation.ocr_text.as_str(),
    ] {
        if !part.trim().is_empty() {
            parts.push(part.trim().to_string());
        }
    }
    if !annotation.tags.is_empty() {
        parts.push(annotation.tags.join(" "));
    }
    parts.join(" ").to_ascii_lowercase()
}

fn video_annotation_cache_path(
    media_root: &std::path::Path,
    rel_path: &str,
    metadata: &std::fs::Metadata,
) -> Result<std::path::PathBuf, String> {
    let path = media_root
        .join(VIDEO_CACHE_DIR)
        .join(VIDEO_ANNOTATIONS_DIR)
        .join(format!(
            "{}.json",
            video_media_cache_stem(rel_path, metadata)
        ));
    video_verify_canonical_contained(
        media_root,
        &path,
        "Video cache path must stay under media/.",
    )?;
    Ok(path)
}

fn video_read_annotation_cache_file(
    annotation_path: &std::path::Path,
) -> Result<Option<VideoAnnotationCache>, String> {
    match std::fs::read_to_string(annotation_path) {
        Ok(raw) => serde_json::from_str::<VideoAnnotationCache>(&raw)
            .map(Some)
            .map_err(|error| format!("Unable to parse image annotation cache: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Unable to read image annotation cache: {error}")),
    }
}

fn video_read_own_annotation_cache(
    root: &std::path::Path,
    media_root: &std::path::Path,
    rel_path: &str,
) -> Result<Option<VideoAnnotationCache>, String> {
    let abs = video_resolve_media_abs(root, media_root, rel_path)?;
    let metadata = match std::fs::metadata(&abs) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Unable to inspect video media path: {error}")),
    };
    if !metadata.is_file() {
        return Ok(None);
    }
    let Some(kind) = video_media_kind_for_extension(&abs) else {
        return Ok(None);
    };
    if kind != "image" {
        return Ok(None);
    }
    let resolved_path = video_relative_path(root, &abs);
    let annotation_path = video_annotation_cache_path(media_root, &resolved_path, &metadata)?;
    video_read_annotation_cache_file(&annotation_path)
}

// Upscaled images show the same content, so the original's annotation applies
// verbatim. Every other derivation (generate, hyperframes-render, …) produces
// NEW content, so only `via == "upscale"` edges are followed — in either
// direction is wrong; like transcripts, we only walk derived-from upward.
fn video_find_inherited_annotation(
    root: &std::path::Path,
    media_root: &std::path::Path,
    manifest: &VideoMediaManifest,
    rel_path: &str,
) -> Result<Option<(String, VideoAnnotationCache)>, String> {
    let mut visited = std::collections::HashSet::new();
    let mut queue = std::collections::VecDeque::from([(rel_path.to_string(), 0usize)]);
    visited.insert(rel_path.to_string());
    while let Some((current_path, depth)) = queue.pop_front() {
        if depth >= 3 {
            continue;
        }
        let Some(asset) = manifest.assets.get(&current_path) else {
            continue;
        };
        for relation in &asset.relations {
            if relation.relation_type != "derived-from"
                || relation.via != "upscale"
                || !visited.insert(relation.path.clone())
            {
                continue;
            }
            let relation_abs = video_resolve_media_abs(root, media_root, relation.path.as_str())?;
            if !relation_abs.is_file() {
                continue;
            }
            if let Some(cache) =
                video_read_own_annotation_cache(root, media_root, relation.path.as_str())?
            {
                return Ok(Some((relation.path.clone(), cache)));
            }
            queue.push_back((relation.path.clone(), depth + 1));
        }
    }
    Ok(None)
}

fn video_resolve_annotation_cache(
    root: &std::path::Path,
    media_root: &std::path::Path,
    manifest: &VideoMediaManifest,
    rel_path: &str,
    metadata: &std::fs::Metadata,
) -> Result<Option<(Option<String>, VideoAnnotationCache)>, String> {
    let annotation_path = video_annotation_cache_path(media_root, rel_path, metadata)?;
    if let Some(cache) = video_read_annotation_cache_file(&annotation_path)? {
        return Ok(Some((None, cache)));
    }
    Ok(
        video_find_inherited_annotation(root, media_root, manifest, rel_path)?
            .map(|(inherited_from, cache)| (Some(inherited_from), cache)),
    )
}

// Row fields for the media list: (hasAnnotation, annotationInherited, blurb).
fn video_annotation_row_fields(
    root: &std::path::Path,
    media_root: &std::path::Path,
    manifest: &VideoMediaManifest,
    kind: &str,
    rel_path: &str,
    metadata: &std::fs::Metadata,
) -> (bool, bool, Option<String>) {
    if kind != "image" {
        return (false, false, None);
    }
    let own = video_annotation_cache_path(media_root, rel_path, metadata)
        .ok()
        .and_then(|path| video_read_annotation_cache_file(&path).ok().flatten());
    if let Some(annotation) = own {
        let blurb = (!annotation.blurb.is_empty()).then(|| annotation.blurb);
        return (true, false, blurb);
    }
    match video_find_inherited_annotation(root, media_root, manifest, rel_path) {
        Ok(Some((_from, annotation))) => {
            let blurb = (!annotation.blurb.is_empty()).then(|| annotation.blurb);
            (true, true, blurb)
        }
        _ => (false, false, None),
    }
}

fn video_annotation_write(
    app: &tauri::AppHandle,
    root: &std::path::Path,
    media_root: &std::path::Path,
    rel_path: &str,
    metadata: &std::fs::Metadata,
    annotation: &VideoAnnotationCache,
) -> Result<(), String> {
    let annotation_path = video_annotation_cache_path(media_root, rel_path, metadata)?;
    video_write_json_cache(&annotation_path, annotation, "image annotation")?;
    let _ = app.emit(
        VIDEO_ANNOTATION_UPDATED_EVENT,
        serde_json::json!({
            "repoPath": root.to_string_lossy().to_string(),
            "path": rel_path,
        }),
    );
    let _ = app.emit(
        VIDEO_STORE_CHANGED_EVENT,
        serde_json::json!({
            "repoPath": root.to_string_lossy().to_string(),
            "paths": [rel_path],
            "changedAtMs": video_now_millis(),
        }),
    );
    Ok(())
}

// Merges a partial update onto the existing annotation (or a fresh one) and
// stamps provenance. Used by both the panel editor ("user") and MCP ("agent").
// When the asset has no own cache but inherits one (upscale), the inherited
// annotation seeds the merge — otherwise a partial update would write a
// sparse own cache that shadows the full inherited description.
fn video_annotation_apply_update(
    root: &std::path::Path,
    media_root: &std::path::Path,
    rel_path: &str,
    metadata: &std::fs::Metadata,
    input: VideoAnnotationUpdateInput,
    source: &str,
) -> Result<VideoAnnotationCache, String> {
    let annotation_path = video_annotation_cache_path(media_root, rel_path, metadata)?;
    let mut annotation = match video_read_annotation_cache_file(&annotation_path)? {
        Some(own) => own,
        None => {
            let manifest = video_read_media_manifest(&video_media_manifest_path(media_root));
            video_find_inherited_annotation(root, media_root, &manifest, rel_path)?
                .map(|(_from, inherited)| VideoAnnotationCache {
                    created_at_ms: 0,
                    ..inherited
                })
                .unwrap_or_default()
        }
    };
    if annotation.created_at_ms == 0 {
        annotation.created_at_ms = video_now_millis();
    }
    if let Some(blurb) = input.blurb {
        annotation.blurb = blurb;
    }
    if let Some(description) = input.description {
        annotation.description = description;
    }
    if let Some(tags) = input.tags {
        annotation.tags = tags;
    }
    if let Some(dominant_colors) = input.dominant_colors {
        annotation.dominant_colors = dominant_colors;
    }
    if let Some(ocr_text) = input.ocr_text {
        annotation.ocr_text = ocr_text;
    }
    video_annotation_normalize(&mut annotation);
    if video_annotation_is_empty(&annotation) {
        return Err("Annotation must include a blurb, description, tags, or text.".to_string());
    }
    annotation.source = source.to_string();
    annotation.edited = source != "llm";
    annotation.updated_at_ms = video_now_millis();
    Ok(annotation)
}

#[tauri::command]
async fn video_annotation_get(
    repo_path: String,
    path: String,
) -> Result<VideoAnnotationGetResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let (_abs, rel_path, kind, metadata) =
            video_resolve_existing_media_file(&root, &media_root, path.as_str())?;
        if kind != "image" {
            return Err("Annotations are only available for image media.".to_string());
        }
        let manifest = video_read_media_manifest(&video_media_manifest_path(&media_root));
        if let Some((inherited_from, cache)) =
            video_resolve_annotation_cache(&root, &media_root, &manifest, &rel_path, &metadata)?
        {
            return Ok(VideoAnnotationGetResponse {
                available: true,
                inherited: inherited_from.is_some(),
                inherited_from,
                annotation: Some(cache),
            });
        }
        Ok(VideoAnnotationGetResponse {
            available: false,
            inherited: false,
            inherited_from: None,
            annotation: None,
        })
    })
    .await
    .map_err(|error| format!("Image annotation cache worker failed: {error}"))?
}

#[tauri::command]
async fn video_annotation_update(
    app: tauri::AppHandle,
    repo_path: String,
    path: String,
    annotation: VideoAnnotationUpdateInput,
) -> Result<VideoAnnotationCache, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let (_abs, rel_path, kind, metadata) =
            video_resolve_existing_media_file(&root, &media_root, path.as_str())?;
        if kind != "image" {
            return Err("Annotations are only available for image media.".to_string());
        }
        let updated = video_annotation_apply_update(
            &root,
            &media_root,
            &rel_path,
            &metadata,
            annotation,
            "user",
        )?;
        video_annotation_write(&app, &root, &media_root, &rel_path, &metadata, &updated)?;
        Ok(updated)
    })
    .await
    .map_err(|error| format!("Image annotation update worker failed: {error}"))?
}

#[tauri::command]
async fn video_annotation_delete(
    app: tauri::AppHandle,
    repo_path: String,
    path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let (_abs, rel_path, kind, metadata) =
            video_resolve_existing_media_file(&root, &media_root, path.as_str())?;
        if kind != "image" {
            return Err("Annotations are only available for image media.".to_string());
        }
        let annotation_path = video_annotation_cache_path(&media_root, &rel_path, &metadata)?;
        match std::fs::remove_file(&annotation_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err("No annotation exists for this image.".to_string());
            }
            Err(error) => {
                return Err(format!("Unable to delete annotation: {error}"));
            }
        }
        let _ = app.emit(
            VIDEO_ANNOTATION_UPDATED_EVENT,
            serde_json::json!({
                "repoPath": root.to_string_lossy().to_string(),
                "path": rel_path,
                "deleted": true,
            }),
        );
        let _ = app.emit(
            VIDEO_STORE_CHANGED_EVENT,
            serde_json::json!({
                "repoPath": root.to_string_lossy().to_string(),
                "paths": [rel_path],
                "changedAtMs": video_now_millis(),
            }),
        );
        Ok(())
    })
    .await
    .map_err(|error| format!("Image annotation delete worker failed: {error}"))?
}

fn video_describe_jpeg_cache_path(
    media_root: &std::path::Path,
    rel_path: &str,
    metadata: &std::fs::Metadata,
) -> Result<std::path::PathBuf, String> {
    let path = media_root
        .join(VIDEO_CACHE_DIR)
        .join(VIDEO_DESCRIBE_JPEG_DIR)
        .join(format!(
            "{}.jpg",
            video_media_cache_stem(rel_path, metadata)
        ));
    video_verify_canonical_contained(
        media_root,
        &path,
        "Video cache path must stay under media/.",
    )?;
    Ok(path)
}

// Downscales the image into a small JPEG the vision model can read cheaply.
// Never upscales: min(768, iw/ih) keeps small images at native size.
fn video_describe_extract_jpeg_blocking(
    ffmpeg_path: String,
    input_abs: std::path::PathBuf,
    output_abs: std::path::PathBuf,
) -> Result<std::path::PathBuf, String> {
    if output_abs.is_file() {
        return Ok(output_abs);
    }
    if let Some(parent) = output_abs.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create describe cache directory: {error}"))?;
    }
    let temp_abs = output_abs.with_extension("tmp.jpg");
    let _ = std::fs::remove_file(&temp_abs);
    let dimension = VIDEO_DESCRIBE_MAX_DIMENSION;
    let scale = format!(
        "scale='min({dimension},iw)':'min({dimension},ih)':force_original_aspect_ratio=decrease"
    );
    let mut command = std::process::Command::new(&ffmpeg_path);
    apply_desktop_command_environment(&mut command);
    command
        .args([
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-i",
            input_abs.to_string_lossy().as_ref(),
            "-vf",
            scale.as_str(),
            "-frames:v",
            "1",
            "-q:v",
            "5",
            "-f",
            "mjpeg",
            temp_abs.to_string_lossy().as_ref(),
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command
        .output()
        .map_err(|error| format!("Unable to start ffmpeg describe extract: {error}"))?;
    if !output.status.success() || !temp_abs.is_file() {
        let detail = first_output_line(&String::from_utf8_lossy(&output.stderr));
        let _ = std::fs::remove_file(&temp_abs);
        return Err(if detail.is_empty() {
            "ffmpeg could not prepare the image for describe.".to_string()
        } else {
            format!("ffmpeg could not prepare the image for describe: {detail}")
        });
    }
    std::fs::rename(&temp_abs, &output_abs)
        .map_err(|error| format!("Unable to finalize describe image cache: {error}"))?;
    Ok(output_abs)
}

fn video_emit_describe_progress(
    app: &tauri::AppHandle,
    job_id: &str,
    path: &str,
    state: &str,
    percent: Option<f64>,
    done: bool,
    error: Option<&str>,
) {
    let _ = app.emit(
        VIDEO_DESCRIBE_PROGRESS_EVENT,
        serde_json::json!({
            "jobId": job_id,
            "path": path,
            "state": state,
            "percent": percent,
            "done": done,
            "error": error,
        }),
    );
}

fn video_describe_parse_annotation(
    data: &serde_json::Value,
    width: Option<u32>,
    height: Option<u32>,
) -> VideoAnnotationCache {
    let annotation_value = data
        .get("annotation")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| data.clone());
    let text_at = |keys: &[&str]| -> String {
        keys.iter()
            .find_map(|key| annotation_value.get(*key).and_then(serde_json::Value::as_str))
            .map(str::trim)
            .unwrap_or_default()
            .to_string()
    };
    let list_at = |keys: &[&str]| -> Vec<String> {
        keys.iter()
            .find_map(|key| annotation_value.get(*key).and_then(serde_json::Value::as_array))
            .map(|values| {
                values
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };
    let mut annotation = VideoAnnotationCache {
        blurb: text_at(&["blurb", "summary"]),
        description: text_at(&["description"]),
        tags: list_at(&["tags", "subjects"]),
        dominant_colors: list_at(&["dominantColors", "dominant_colors", "colors"]),
        ocr_text: text_at(&["ocrText", "ocr_text", "text"]),
        orientation: text_at(&["orientation"]),
        source: "llm".to_string(),
        model: data
            .get("model")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string(),
        edited: false,
        created_at_ms: video_now_millis(),
        updated_at_ms: video_now_millis(),
    };
    if annotation.orientation.is_empty() {
        annotation.orientation = video_annotation_orientation(width, height);
    }
    video_annotation_normalize(&mut annotation);
    annotation
}

async fn video_describe_worker(
    app: tauri::AppHandle,
    cloud_state: CloudMcpState,
    job_id: String,
    repo_path: String,
    path: String,
    force: bool,
    auto_describe: bool,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    dedupe_key: String,
) {
    let result = async {
        use base64::Engine as _;
        video_emit_describe_progress(&app, &job_id, &path, "preparing", Some(10.0), false, None);
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let (abs, rel_path, kind, metadata) =
            video_resolve_existing_media_file(&root, &media_root, path.as_str())?;
        if kind != "image" {
            return Err("Describe is only available for image media.".to_string());
        }
        let annotation_path = video_annotation_cache_path(&media_root, &rel_path, &metadata)?;
        if !force && annotation_path.is_file() {
            video_emit_describe_progress(
                &app,
                &job_id,
                &rel_path,
                "done",
                Some(100.0),
                true,
                None,
            );
            return Ok(());
        }
        let status = video_tools_status_for(&app);
        let ffmpeg_path = status.ffmpeg.path.ok_or_else(|| {
            "ffmpeg is required to prepare images for describe. Install video tools first."
                .to_string()
        })?;
        let jpeg_path = video_describe_jpeg_cache_path(&media_root, &rel_path, &metadata)?;
        if force {
            let _ = std::fs::remove_file(&jpeg_path);
        }
        let jpeg_abs = tauri::async_runtime::spawn_blocking({
            let abs = abs.clone();
            move || video_describe_extract_jpeg_blocking(ffmpeg_path, abs, jpeg_path)
        })
        .await
        .map_err(|error| format!("Describe extract worker failed: {error}"))??;
        if video_transcribe_cancelled(&cancel) {
            return Err("Image describe cancelled.".to_string());
        }
        let jpeg_metadata = std::fs::metadata(&jpeg_abs)
            .map_err(|error| format!("Unable to inspect describe image: {error}"))?;
        if jpeg_metadata.len() > VIDEO_DESCRIBE_JPEG_LIMIT_BYTES {
            return Err("Prepared describe image is unexpectedly large.".to_string());
        }
        video_emit_describe_progress(
            &app,
            &job_id,
            &rel_path,
            "uploading",
            Some(40.0),
            false,
            None,
        );
        let image_bytes = tauri::async_runtime::spawn_blocking({
            let jpeg_abs = jpeg_abs.clone();
            move || std::fs::read(&jpeg_abs)
        })
        .await
        .map_err(|error| format!("Describe image read worker failed: {error}"))?
        .map_err(|error| format!("Unable to read describe image: {error}"))?;
        let image_base64 = base64::engine::general_purpose::STANDARD.encode(image_bytes);
        let (width, height) = {
            let ffprobe_path = status.ffprobe.path.clone();
            match ffprobe_path {
                Some(ffprobe) => video_probe_media(&ffprobe, &abs)
                    .map(|probe| (probe.width, probe.height))
                    .unwrap_or((None, None)),
                None => (None, None),
            }
        };
        let request_id = format!(
            "video-describe-{}-{}",
            video_now_millis(),
            uuid::Uuid::new_v4()
        );
        let file_name = abs
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("image.jpg")
            .to_string();
        let payload = serde_json::json!({
            "kind": "media_describe_request",
            "requestId": request_id,
            "imageBase64": image_base64,
            "mimeType": "image/jpeg",
            "fileName": file_name,
            "width": width,
            "height": height,
            "autoDescribe": auto_describe,
        });
        video_emit_describe_progress(
            &app,
            &job_id,
            &rel_path,
            "describing",
            Some(70.0),
            false,
            None,
        );
        let response = cloud_mcp_ws_request_once_with_timeout(
            &cloud_state,
            "media_describe_request",
            &payload,
            std::time::Duration::from_secs(VIDEO_DESCRIBE_TIMEOUT_SECS),
        )
        .await?;
        if video_transcribe_cancelled(&cancel) {
            return Err("Image describe cancelled.".to_string());
        }
        let data = response
            .get("data")
            .cloned()
            .unwrap_or_else(|| response.clone());
        let ok = data
            .get("ok")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        if !ok {
            let message = data
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("Diff Forge Cloud could not describe this image.");
            return Err(message.to_string());
        }
        let annotation = video_describe_parse_annotation(&data, width, height);
        if video_annotation_is_empty(&annotation) {
            return Err("The vision model returned an empty description.".to_string());
        }
        video_annotation_write(&app, &root, &media_root, &rel_path, &metadata, &annotation)?;
        video_emit_describe_progress(&app, &job_id, &rel_path, "done", Some(100.0), true, None);
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = result {
        video_emit_describe_progress(&app, &job_id, &path, "error", Some(100.0), true, Some(&error));
    }
    video_describe_release_path(&dedupe_key);
    video_job_registry_remove(&VIDEO_DESCRIBE_JOBS, &job_id);
}

#[tauri::command]
async fn video_describe_start(
    app: tauri::AppHandle,
    cloud_state: tauri::State<'_, CloudMcpState>,
    repo_path: String,
    path: String,
    force: Option<bool>,
    auto_describe: Option<bool>,
) -> Result<VideoJobStartResult, String> {
    let dedupe_key = format!("{}|{}", repo_path.trim(), path.trim());
    video_describe_claim_path(&dedupe_key)?;
    let (job_id, cancel) = match video_job_registry_insert(&VIDEO_DESCRIBE_JOBS) {
        Ok(handle) => handle,
        Err(error) => {
            video_describe_release_path(&dedupe_key);
            return Err(error);
        }
    };
    tauri::async_runtime::spawn(video_describe_worker(
        app,
        cloud_state.inner().clone(),
        job_id.clone(),
        repo_path,
        path,
        force.unwrap_or(false),
        auto_describe.unwrap_or(false),
        cancel,
        dedupe_key,
    ));
    Ok(VideoJobStartResult { job_id })
}

#[tauri::command]
fn video_describe_cancel(job_id: String) -> Result<(), String> {
    video_job_registry_cancel(&VIDEO_DESCRIBE_JOBS, &job_id)
}

#[cfg(test)]
mod video_annotate_tests {
    use super::*;

    #[test]
    fn video_annotation_normalize_caps_and_dedupes() {
        let mut annotation = VideoAnnotationCache {
            blurb: "  A red vintage car parked outside a diner.  ".to_string(),
            tags: vec![
                "Car".to_string(),
                "car".to_string(),
                "  ".to_string(),
                "diner".to_string(),
            ],
            orientation: "sideways".to_string(),
            ..Default::default()
        };
        video_annotation_normalize(&mut annotation);
        assert_eq!(annotation.blurb, "A red vintage car parked outside a diner.");
        assert_eq!(annotation.tags, vec!["Car".to_string(), "diner".to_string()]);
        assert_eq!(annotation.orientation, "");
    }

    #[test]
    fn video_describe_parse_annotation_reads_nested_and_flat_shapes() {
        let nested = serde_json::json!({
            "ok": true,
            "model": "gpt-4o-mini",
            "annotation": {
                "blurb": "Golden retriever on a beach",
                "tags": ["dog", "beach"],
                "dominantColors": ["gold", "blue"],
                "ocrText": "",
            },
        });
        let annotation = video_describe_parse_annotation(&nested, Some(1920), Some(1080));
        assert_eq!(annotation.blurb, "Golden retriever on a beach");
        assert_eq!(annotation.tags, vec!["dog".to_string(), "beach".to_string()]);
        assert_eq!(annotation.orientation, "landscape");
        assert_eq!(annotation.model, "gpt-4o-mini");
        assert_eq!(annotation.source, "llm");
        assert!(!annotation.edited);

        let flat = serde_json::json!({
            "blurb": "City skyline at night",
            "orientation": "portrait",
        });
        let annotation = video_describe_parse_annotation(&flat, Some(800), Some(800));
        assert_eq!(annotation.blurb, "City skyline at night");
        assert_eq!(annotation.orientation, "portrait");
    }

    #[test]
    fn video_annotation_orientation_derives_from_dims() {
        assert_eq!(video_annotation_orientation(Some(1920), Some(1080)), "landscape");
        assert_eq!(video_annotation_orientation(Some(1080), Some(1920)), "portrait");
        assert_eq!(video_annotation_orientation(Some(512), Some(512)), "square");
        assert_eq!(video_annotation_orientation(None, Some(512)), "");
    }

    #[test]
    fn video_annotation_search_text_joins_all_fields() {
        let annotation = VideoAnnotationCache {
            blurb: "Red car".to_string(),
            description: "A vintage car outside a diner".to_string(),
            tags: vec!["automobile".to_string()],
            ocr_text: "Joe's Diner".to_string(),
            ..Default::default()
        };
        let text = video_annotation_search_text(&annotation);
        assert!(text.contains("red car"));
        assert!(text.contains("automobile"));
        assert!(text.contains("joe's diner"));
    }
}

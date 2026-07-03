// Video editor panel backend.
//
// This file is `include!`d into the crate root (see lib.rs), so it shares the
// crate-root module scope. Avoid top-level `use` imports; reference standard
// library and crate items with fully-qualified paths, and keep trait imports
// function-local.

const VIDEO_STORE_CHANGED_EVENT: &str = "video-store-changed";
const VIDEO_TOOLS_INSTALL_PROGRESS_EVENT: &str = "video-tools-install-progress";
const VIDEO_EXPORT_PROGRESS_EVENT: &str = "video-export-progress";
const VIDEO_GENERATE_PROGRESS_EVENT: &str = "video-generate-progress";
const VIDEO_TRANSCRIBE_PROGRESS_EVENT: &str = "video-transcribe-progress";
const VIDEO_LORA_PROGRESS_EVENT: &str = "video-lora-progress";
const VIDEO_PANEL_CLOSED_EVENT: &str = "video-panel-closed";

const VIDEO_MEDIA_DIR: &str = "media";
const VIDEO_ASSETS_DIR: &str = "assets";
const VIDEO_GENERATED_DIR: &str = "generated";
const VIDEO_EXPORTS_DIR: &str = "exports";
const VIDEO_PROJECTS_DIR: &str = "projects";
const VIDEO_CACHE_DIR: &str = ".cache";
const VIDEO_PROBE_CACHE_FILE: &str = "probe.json";
const VIDEO_THUMBS_DIR: &str = "thumbs";
const VIDEO_WAVEFORMS_DIR: &str = "waveforms";
const VIDEO_FILMSTRIPS_DIR: &str = "filmstrips";
const VIDEO_TRANSCRIBE_DIR: &str = "transcribe";
const VIDEO_TRANSCRIPTS_DIR: &str = "transcripts";
const VIDEO_PROJECT_EXTENSION: &str = ".video.pipe";
const VIDEO_PROJECT_LEGACY_EXTENSION: &str = ".video.json";
const VIDEO_TOOLS_DIR: &str = "video-tools";
const VIDEO_TOOLS_BIN_DIR: &str = "bin";
const VIDEO_LORA_REGISTRY_FILE: &str = "loras.json";
const VIDEO_PANEL_LABEL_PREFIX: &str = "video-panel-";
const VIDEO_PANEL_DEFAULT_WIDTH: f64 = 960.0;
const VIDEO_PANEL_DEFAULT_HEIGHT: f64 = 680.0;
const VIDEO_THUMBNAIL_LIMIT_PER_LIST: usize = 24;
const VIDEO_GENERATION_TIMEOUT_SECS: u64 = 15 * 60;
const VIDEO_TOOLS_INSTALL_TIMEOUT_SECS: u64 = 900;
const VIDEO_DOWNLOAD_TIMEOUT_SECS: u64 = 900;
const VIDEO_PROBE_TIMEOUT_SECS: u64 = 30;
const VIDEO_THUMB_TIMEOUT_SECS: u64 = 30;
const VIDEO_EXPORT_PROGRESS_INTERVAL_MS: u64 = 500;
const VIDEO_WAVEFORM_PCM_LIMIT_BYTES: usize = 60 * 1024 * 1024;
const VIDEO_TRANSCRIBE_MP3_LIMIT_BYTES: u64 = 20 * 1024 * 1024;
const VIDEO_TRANSCRIBE_TIMEOUT_SECS: u64 = 180;

const VIDEO_TOOL_DOWNLOAD_URLS: &[(&str, &str)] = &[
    ("macos-ffmpeg-zip", "https://evermeet.cx/ffmpeg/getrelease/zip"),
    (
        "macos-ffprobe-zip",
        "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip",
    ),
    (
        "windows-win64-zip",
        "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip",
    ),
    (
        "linux-x64-tar-xz",
        "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz",
    ),
    (
        "linux-arm64-tar-xz",
        "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linuxarm64-gpl.tar.xz",
    ),
];

static VIDEO_WATCH_ROOTS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
    std::sync::OnceLock::new();
static VIDEO_TOOLS_INSTALL_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> =
    std::sync::OnceLock::new();
static VIDEO_INSTALL_JOBS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
> = std::sync::OnceLock::new();
static VIDEO_EXPORT_JOBS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
> = std::sync::OnceLock::new();
static VIDEO_GENERATE_JOBS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
> = std::sync::OnceLock::new();
static VIDEO_TRANSCRIBE_JOBS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
> = std::sync::OnceLock::new();
static VIDEO_LORA_JOBS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
> = std::sync::OnceLock::new();

#[derive(Clone)]
struct VideoJobHandle {
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoJobStartResult {
    job_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoPanelOpenResult {
    label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoToolAvailability {
    installed: bool,
    path: Option<String>,
    version: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoToolsStatusResponse {
    platform: String,
    arch: String,
    installable: bool,
    install_hint: String,
    ffmpeg: VideoToolAvailability,
    ffprobe: VideoToolAvailability,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoMediaItem {
    path: String,
    abs_path: String,
    name: String,
    kind: String,
    folder: String,
    size_bytes: u64,
    modified_at_ms: u64,
    duration_ms: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
    has_audio: Option<bool>,
    has_transcript: bool,
    thumbnail_data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoMediaListResponse {
    repo_path: String,
    media_root: String,
    ffmpeg_ready: bool,
    items: Vec<VideoMediaItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoMediaImportResponse {
    imported: Vec<VideoMediaItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoMediaWaveformResponse {
    path: String,
    samples: usize,
    peaks: Vec<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoMediaFilmstripResponse {
    path: String,
    frames: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VideoTranscriptSegment {
    start_ms: u64,
    end_ms: u64,
    text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VideoTranscriptCache {
    language: Option<String>,
    text: String,
    segments: Vec<VideoTranscriptSegment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoTranscriptGetResponse {
    available: bool,
    language: Option<String>,
    text: String,
    segments: Vec<VideoTranscriptSegment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoFrameExtractResponse {
    item: VideoMediaItem,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoProjectSummary {
    name: String,
    path: String,
    updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoProjectsListResponse {
    projects: Vec<VideoProjectSummary>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoExportOptions {
    file_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<f64>,
    format: Option<String>,
    crf: Option<u8>,
    preset: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoGenerateRequest {
    provider_id: String,
    model: String,
    mode: String,
    prompt: String,
    input_asset_paths: Vec<String>,
    params: Option<VideoGenerateParams>,
    lora_id: Option<String>,
    auth: Option<VideoProviderAuth>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoGenerateParams {
    duration_sec: Option<f64>,
    aspect: Option<String>,
    resolution: Option<String>,
    seed: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoProviderAuth {
    api_key: Option<String>,
    secret_key: Option<String>,
    base_url: Option<String>,
}

#[derive(Clone)]
struct VideoProviderDefinition {
    id: &'static str,
    label: &'static str,
    kind: &'static str,
    default_base_url: &'static str,
    models: &'static [&'static str],
    requires_secret_key: bool,
}

const VIDEO_GENERATION_PROVIDERS: &[VideoProviderDefinition] = &[
    VideoProviderDefinition {
        id: "higgsfield",
        label: "Higgsfield",
        kind: "video",
        default_base_url: "https://platform.higgsfield.ai",
        models: &["higgsfield-standard"],
        requires_secret_key: true,
    },
    VideoProviderDefinition {
        id: "seedance",
        label: "Seedance",
        kind: "video",
        default_base_url: "https://ark.ap-southeast.bytepluses.com/api/v3",
        models: &["seedance-2.0", "seedance-2.5"],
        requires_secret_key: false,
    },
    VideoProviderDefinition {
        id: "kling",
        label: "Kling",
        kind: "video",
        default_base_url: "https://api-singapore.klingai.com",
        models: &["kling-v3"],
        requires_secret_key: true,
    },
    VideoProviderDefinition {
        id: "gpt-image-2",
        label: "GPT Image",
        kind: "image",
        default_base_url: "https://api.openai.com",
        models: &["gpt-image-2"],
        requires_secret_key: false,
    },
    VideoProviderDefinition {
        id: "nano-banana",
        label: "Nano Banana",
        kind: "image",
        default_base_url: "https://generativelanguage.googleapis.com",
        models: &["gemini-2.5-flash-image"],
        requires_secret_key: false,
    },
    VideoProviderDefinition {
        id: "flux-lora",
        label: "Flux LoRA",
        kind: "image",
        default_base_url: "https://queue.fal.run",
        models: &["flux-klein"],
        requires_secret_key: false,
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoLoraEntry {
    id: String,
    name: String,
    trigger_word: String,
    status: String,
    provider_ref: Option<String>,
    created_at_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoLoraTrainRequest {
    name: String,
    trigger_word: String,
    image_paths: Vec<String>,
    steps: Option<u32>,
    auth: Option<VideoProviderAuth>,
}

#[derive(Debug, Clone)]
struct VideoProbeSummary {
    duration_ms: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
    has_audio: Option<bool>,
}

#[derive(Debug, Clone)]
struct VideoExportMediaClip {
    input_index: usize,
    kind: String,
    abs_path: std::path::PathBuf,
    timeline_start_ms: u64,
    duration_ms: u64,
    source_in_ms: u64,
    speed: f64,
    gain_level: f64,
    gain_keyframes: Vec<(u64, f64)>,
    x: f64,
    y: f64,
    scale: f64,
    opacity: f64,
    has_audio: bool,
}

#[derive(Debug, Clone)]
struct VideoExportTextClip {
    text: String,
    timeline_start_ms: u64,
    duration_ms: u64,
    font_size: f64,
    color: String,
    background: Option<String>,
    outline_color: String,
    outline_width: f64,
    shadow: bool,
    uppercase: bool,
    x: f64,
    y: f64,
}

fn video_job_registry_insert(
    registry: &'static std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
    >,
) -> Result<(String, std::sync::Arc<std::sync::atomic::AtomicBool>), String> {
    let job_id = uuid::Uuid::new_v4().to_string();
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let handle = VideoJobHandle {
        cancel: cancel.clone(),
    };
    let jobs = registry.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    jobs.lock()
        .map_err(|_| "Video job registry is poisoned.".to_string())?
        .insert(job_id.clone(), handle);
    Ok((job_id, cancel))
}

fn video_job_registry_cancel(
    registry: &'static std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
    >,
    job_id: &str,
) -> Result<(), String> {
    let jobs = registry.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    if let Some(handle) = jobs
        .lock()
        .map_err(|_| "Video job registry is poisoned.".to_string())?
        .get(job_id)
    {
        handle
            .cancel
            .store(true, std::sync::atomic::Ordering::Release);
    }
    Ok(())
}

fn video_job_registry_remove(
    registry: &'static std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
    >,
    job_id: &str,
) {
    if let Some(jobs) = registry.get() {
        if let Ok(mut guard) = jobs.lock() {
            guard.remove(job_id);
        }
    }
}

fn video_now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn video_executable_name(binary: &str) -> String {
    #[cfg(windows)]
    {
        if binary.ends_with(".exe") {
            binary.to_string()
        } else {
            format!("{binary}.exe")
        }
    }
    #[cfg(not(windows))]
    {
        binary.to_string()
    }
}

fn video_tool_download_url(key: &str) -> &'static str {
    VIDEO_TOOL_DOWNLOAD_URLS
        .iter()
        .find(|(candidate, _)| *candidate == key)
        .map(|(_, url)| *url)
        .unwrap_or_default()
}

fn video_app_tools_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?
        .join(VIDEO_TOOLS_DIR))
}

fn video_app_tools_bin_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(video_app_tools_directory(app)?.join(VIDEO_TOOLS_BIN_DIR))
}

fn video_lora_registry_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(video_app_tools_directory(app)?.join(VIDEO_LORA_REGISTRY_FILE))
}

fn video_workspace_media_root(
    repo_path: &str,
) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    let root = resolve_workspace_root_directory(Some(repo_path))?;
    let media = root.join(VIDEO_MEDIA_DIR);
    Ok((root, media))
}

fn video_ensure_media_dirs(media_root: &std::path::Path) -> Result<(), String> {
    for dirname in [
        VIDEO_ASSETS_DIR,
        VIDEO_GENERATED_DIR,
        VIDEO_EXPORTS_DIR,
        VIDEO_PROJECTS_DIR,
        VIDEO_CACHE_DIR,
    ] {
        std::fs::create_dir_all(media_root.join(dirname))
            .map_err(|error| format!("Unable to create video media directory: {error}"))?;
    }
    std::fs::create_dir_all(media_root.join(VIDEO_CACHE_DIR).join(VIDEO_THUMBS_DIR))
        .map_err(|error| format!("Unable to create video thumbnail cache directory: {error}"))?;
    Ok(())
}

fn video_relative_path(root: &std::path::Path, abs: &std::path::Path) -> String {
    abs.strip_prefix(root)
        .unwrap_or(abs)
        .to_string_lossy()
        .replace('\\', "/")
}

fn video_normalize_relative_path(raw_path: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("Video path is required.".to_string());
    }
    let path = std::path::Path::new(trimmed);
    if path.is_absolute() {
        return Err("Video path must be workspace-relative.".to_string());
    }
    let mut normalized = std::path::PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(part) => normalized.push(part),
            std::path::Component::CurDir => {}
            _ => return Err("Video path cannot contain traversal.".to_string()),
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err("Video path is required.".to_string());
    }
    Ok(normalized)
}

fn video_resolve_media_abs(
    root: &std::path::Path,
    media_root: &std::path::Path,
    raw_path: &str,
) -> Result<std::path::PathBuf, String> {
    let normalized = video_normalize_relative_path(raw_path)?;
    let abs = root.join(normalized);
    if !abs.starts_with(media_root) {
        return Err("Video path must stay under media/.".to_string());
    }
    Ok(abs)
}

fn video_resolve_project_abs(
    root: &std::path::Path,
    media_root: &std::path::Path,
    project_path: &str,
) -> Result<std::path::PathBuf, String> {
    let abs = video_resolve_media_abs(root, media_root, project_path)?;
    if !abs.starts_with(media_root.join(VIDEO_PROJECTS_DIR)) {
        return Err("Video project path must stay under media/projects/.".to_string());
    }
    if !video_project_path_has_supported_extension(&abs) {
        return Err("Video project path must end with .video.pipe or .video.json.".to_string());
    }
    Ok(abs)
}

fn video_project_file_name(path: &std::path::Path) -> Option<&str> {
    path.file_name().and_then(|name| name.to_str())
}

fn video_project_path_is_pipe(path: &std::path::Path) -> bool {
    video_project_file_name(path)
        .map(|name| name.ends_with(VIDEO_PROJECT_EXTENSION))
        .unwrap_or(false)
}

fn video_project_path_is_legacy_json(path: &std::path::Path) -> bool {
    video_project_file_name(path)
        .map(|name| name.ends_with(VIDEO_PROJECT_LEGACY_EXTENSION))
        .unwrap_or(false)
}

fn video_project_path_has_supported_extension(path: &std::path::Path) -> bool {
    video_project_path_is_pipe(path) || video_project_path_is_legacy_json(path)
}

fn video_project_slug_from_file_name(name: &str) -> Option<String> {
    if name.ends_with(VIDEO_PROJECT_EXTENSION) {
        Some(name.trim_end_matches(VIDEO_PROJECT_EXTENSION).to_string())
    } else if name.ends_with(VIDEO_PROJECT_LEGACY_EXTENSION) {
        Some(name.trim_end_matches(VIDEO_PROJECT_LEGACY_EXTENSION).to_string())
    } else {
        None
    }
}

fn video_project_pipe_sibling_path(path: &std::path::Path) -> std::path::PathBuf {
    let Some(name) = video_project_file_name(path) else {
        return path.to_path_buf();
    };
    if name.ends_with(VIDEO_PROJECT_LEGACY_EXTENSION) {
        path.with_file_name(format!(
            "{}{}",
            name.trim_end_matches(VIDEO_PROJECT_LEGACY_EXTENSION),
            VIDEO_PROJECT_EXTENSION
        ))
    } else {
        path.to_path_buf()
    }
}

fn video_project_temp_sibling_path(path: &std::path::Path) -> std::path::PathBuf {
    let name = video_project_file_name(path).unwrap_or("project.video.pipe");
    path.with_file_name(format!("{name}.tmp"))
}

fn video_slugify_with_fallback(name: &str, fallback: &str) -> String {
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
        fallback.to_string()
    } else {
        slug
    }
}

fn video_safe_file_stem(name: &str, fallback: &str) -> String {
    let mut safe = String::new();
    let mut last_dash = false;
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            safe.push(ch);
            last_dash = false;
        } else if matches!(ch, '-' | '_' | '.' | ' ') && !safe.is_empty() && !last_dash {
            safe.push(if ch == '_' { '_' } else { '-' });
            last_dash = true;
        }
    }
    while safe.ends_with('-') || safe.ends_with('_') || safe.ends_with('.') {
        safe.pop();
    }
    if safe.is_empty() {
        fallback.to_string()
    } else {
        safe.chars().take(160).collect()
    }
}

fn video_media_kind_for_extension(path: &std::path::Path) -> Option<&'static str> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "mpg" | "mpeg" | "ts" => Some("video"),
        "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg" | "opus" => Some("audio"),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tiff" => Some("image"),
        _ => None,
    }
}

fn video_mime_for_path(path: &std::path::Path) -> &'static str {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "opus" => "audio/opus",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tiff" => "image/tiff",
        _ => "application/octet-stream",
    }
}

fn video_extension_for_mime(mime: &str) -> &'static str {
    let lower = mime.to_ascii_lowercase();
    if lower.contains("jpeg") || lower.contains("jpg") {
        "jpg"
    } else if lower.contains("webp") {
        "webp"
    } else if lower.contains("gif") {
        "gif"
    } else if lower.contains("mp4") {
        "mp4"
    } else if lower.contains("webm") {
        "webm"
    } else {
        "png"
    }
}

fn video_file_modified_ms(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn video_cache_key(path: &str, modified_at_ms: u64, size_bytes: u64) -> String {
    format!("{path}|{modified_at_ms}|{size_bytes}")
}

fn video_sha1_hex(value: &str) -> String {
    use sha1::Digest as _;
    let mut hasher = sha1::Sha1::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn video_read_probe_cache(cache_path: &std::path::Path) -> serde_json::Map<String, serde_json::Value> {
    std::fs::read_to_string(cache_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn video_write_probe_cache(
    cache_path: &std::path::Path,
    cache: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    if let Some(parent) = cache_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create video probe cache directory: {error}"))?;
    }
    let temp_path = cache_path.with_extension("json.tmp");
    let raw = serde_json::to_vec_pretty(&serde_json::Value::Object(cache.clone()))
        .map_err(|error| format!("Unable to serialize video probe cache: {error}"))?;
    std::fs::write(&temp_path, raw)
        .map_err(|error| format!("Unable to write video probe cache: {error}"))?;
    std::fs::rename(&temp_path, cache_path)
        .map_err(|error| format!("Unable to finalize video probe cache: {error}"))?;
    Ok(())
}

fn video_probe_from_cache(value: &serde_json::Value) -> VideoProbeSummary {
    VideoProbeSummary {
        duration_ms: value.get("durationMs").and_then(|value| value.as_u64()),
        width: value
            .get("width")
            .and_then(|value| value.as_u64())
            .and_then(|value| u32::try_from(value).ok()),
        height: value
            .get("height")
            .and_then(|value| value.as_u64())
            .and_then(|value| u32::try_from(value).ok()),
        has_audio: value.get("hasAudio").and_then(|value| value.as_bool()),
    }
}

fn video_probe_to_cache(summary: &VideoProbeSummary) -> serde_json::Value {
    serde_json::json!({
        "durationMs": summary.duration_ms,
        "width": summary.width,
        "height": summary.height,
        "hasAudio": summary.has_audio,
    })
}

fn video_parse_duration_ms(value: &serde_json::Value) -> Option<u64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
        .filter(|duration| duration.is_finite() && *duration >= 0.0)
        .map(|duration| (duration * 1000.0).round().max(0.0) as u64)
}

fn video_probe_media(ffprobe_path: &str, abs_path: &std::path::Path) -> Option<VideoProbeSummary> {
    let path_text = abs_path.to_string_lossy().to_string();
    let capture = run_command_capture(
        ffprobe_path,
        &[
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &path_text,
        ],
        None,
        std::time::Duration::from_secs(VIDEO_PROBE_TIMEOUT_SECS),
        None,
    )
    .ok()?;
    if capture.exit_code != Some(0) {
        return None;
    }
    let parsed = serde_json::from_str::<serde_json::Value>(&capture.stdout).ok()?;
    let duration_ms = parsed
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(video_parse_duration_ms);
    let mut width = None;
    let mut height = None;
    let mut has_audio = false;
    if let Some(streams) = parsed.get("streams").and_then(|value| value.as_array()) {
        for stream in streams {
            let codec_type = stream
                .get("codec_type")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            if codec_type == "video" && width.is_none() {
                width = stream
                    .get("width")
                    .and_then(|value| value.as_u64())
                    .and_then(|value| u32::try_from(value).ok());
                height = stream
                    .get("height")
                    .and_then(|value| value.as_u64())
                    .and_then(|value| u32::try_from(value).ok());
            } else if codec_type == "audio" {
                has_audio = true;
            }
        }
    }
    Some(VideoProbeSummary {
        duration_ms,
        width,
        height,
        has_audio: Some(has_audio),
    })
}

fn video_read_thumbnail_data_url(path: &std::path::Path) -> Option<String> {
    use base64::Engine as _;
    let bytes = std::fs::read(path).ok()?;
    Some(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn video_generate_thumbnail(
    ffmpeg_path: &str,
    abs_path: &std::path::Path,
    kind: &str,
    duration_ms: Option<u64>,
    thumb_path: &std::path::Path,
) -> Result<(), String> {
    if let Some(parent) = thumb_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create video thumbnail cache: {error}"))?;
    }
    let input = abs_path.to_string_lossy().to_string();
    let output = thumb_path.to_string_lossy().to_string();
    let mut args: Vec<String> = vec!["-y".to_string()];
    if kind == "video" {
        let seek = duration_ms
            .map(|duration| ((duration as f64 / 1000.0) / 2.0).min(0.5))
            .unwrap_or(0.5);
        args.push("-ss".to_string());
        args.push(format!("{seek:.3}"));
    }
    args.extend([
        "-i".to_string(),
        input,
        "-frames:v".to_string(),
        "1".to_string(),
        "-vf".to_string(),
        "scale=320:-2".to_string(),
        output,
    ]);
    let refs = args.iter().map(|value| value.as_str()).collect::<Vec<_>>();
    let capture = run_command_capture(
        ffmpeg_path,
        refs.as_slice(),
        None,
        std::time::Duration::from_secs(VIDEO_THUMB_TIMEOUT_SECS),
        None,
    )?;
    if capture.exit_code == Some(0) && thumb_path.is_file() {
        Ok(())
    } else {
        Err(first_output_line(&command_output_text(
            &capture.stdout,
            &capture.stderr,
        )))
    }
}

fn video_build_media_item(
    root: &std::path::Path,
    media_root: &std::path::Path,
    abs_path: &std::path::Path,
    folder: &str,
    ffmpeg_path: Option<&str>,
    ffprobe_path: Option<&str>,
    probe_cache: &mut serde_json::Map<String, serde_json::Value>,
    probe_cache_dirty: &mut bool,
    thumbnails_generated: &mut usize,
) -> Option<VideoMediaItem> {
    let kind = video_media_kind_for_extension(abs_path)?;
    let metadata = std::fs::metadata(abs_path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let size_bytes = metadata.len();
    let modified_at_ms = video_file_modified_ms(&metadata);
    let path = video_relative_path(root, abs_path);
    let cache_key = video_cache_key(&path, modified_at_ms, size_bytes);
    let probe = if let Some(cached) = probe_cache.get(&cache_key) {
        Some(video_probe_from_cache(cached))
    } else if let Some(ffprobe_path) = ffprobe_path {
        let summary = video_probe_media(ffprobe_path, abs_path);
        if let Some(summary) = &summary {
            probe_cache.insert(cache_key.clone(), video_probe_to_cache(summary));
            *probe_cache_dirty = true;
        }
        summary
    } else {
        None
    };
    let duration_ms = probe.as_ref().and_then(|probe| probe.duration_ms);
    let width = probe.as_ref().and_then(|probe| probe.width);
    let height = probe.as_ref().and_then(|probe| probe.height);
    let has_audio = probe.as_ref().and_then(|probe| probe.has_audio);
    let has_transcript = matches!(kind, "audio" | "video")
        && video_transcript_cache_path(media_root, &path, &metadata).is_file();
    let thumbnail_data_url = if matches!(kind, "video" | "image") {
        ffmpeg_path.and_then(|ffmpeg| {
            let thumb_path = media_root
                .join(VIDEO_CACHE_DIR)
                .join(VIDEO_THUMBS_DIR)
                .join(format!("{}.jpg", video_sha1_hex(&cache_key)));
            if !thumb_path.is_file() && *thumbnails_generated < VIDEO_THUMBNAIL_LIMIT_PER_LIST {
                if video_generate_thumbnail(ffmpeg, abs_path, kind, duration_ms, &thumb_path).is_ok() {
                    *thumbnails_generated += 1;
                }
            }
            video_read_thumbnail_data_url(&thumb_path)
        })
    } else {
        None
    };

    Some(VideoMediaItem {
        path,
        abs_path: abs_path.to_string_lossy().to_string(),
        name: abs_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string(),
        kind: kind.to_string(),
        folder: folder.to_string(),
        size_bytes,
        modified_at_ms,
        duration_ms,
        width,
        height,
        has_audio,
        has_transcript,
        thumbnail_data_url,
    })
}

fn video_resolve_existing_media_file(
    root: &std::path::Path,
    media_root: &std::path::Path,
    raw_path: &str,
) -> Result<(std::path::PathBuf, String, &'static str, std::fs::Metadata), String> {
    let abs = video_resolve_media_abs(root, media_root, raw_path)?;
    let metadata = std::fs::metadata(&abs)
        .map_err(|error| format!("Unable to inspect video media path: {error}"))?;
    if !metadata.is_file() {
        return Err("Video media path must be an existing file.".to_string());
    }
    let kind = video_media_kind_for_extension(&abs)
        .ok_or_else(|| "Unsupported video media extension.".to_string())?;
    Ok((abs.clone(), video_relative_path(root, &abs), kind, metadata))
}

fn video_cache_file_stem(
    rel_path: &str,
    metadata: &std::fs::Metadata,
    discriminator: usize,
) -> String {
    let modified_at_ms = video_file_modified_ms(metadata);
    let cache_key = format!(
        "{}|{}",
        video_cache_key(rel_path, modified_at_ms, metadata.len()),
        discriminator
    );
    video_sha1_hex(&cache_key)
}

fn video_media_cache_stem(rel_path: &str, metadata: &std::fs::Metadata) -> String {
    let modified_at_ms = video_file_modified_ms(metadata);
    video_sha1_hex(&video_cache_key(rel_path, modified_at_ms, metadata.len()))
}

fn video_transcribe_mp3_cache_path(
    media_root: &std::path::Path,
    rel_path: &str,
    metadata: &std::fs::Metadata,
) -> std::path::PathBuf {
    media_root
        .join(VIDEO_CACHE_DIR)
        .join(VIDEO_TRANSCRIBE_DIR)
        .join(format!("{}.mp3", video_media_cache_stem(rel_path, metadata)))
}

fn video_transcript_cache_path(
    media_root: &std::path::Path,
    rel_path: &str,
    metadata: &std::fs::Metadata,
) -> std::path::PathBuf {
    media_root
        .join(VIDEO_CACHE_DIR)
        .join(VIDEO_TRANSCRIPTS_DIR)
        .join(format!("{}.json", video_media_cache_stem(rel_path, metadata)))
}

fn video_write_json_cache<T: serde::Serialize>(
    cache_path: &std::path::Path,
    value: &T,
    label: &str,
) -> Result<(), String> {
    if let Some(parent) = cache_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create {label} cache directory: {error}"))?;
    }
    let temp_path = cache_path.with_extension("json.tmp");
    let raw = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Unable to serialize {label} cache: {error}"))?;
    std::fs::write(&temp_path, raw)
        .map_err(|error| format!("Unable to write {label} cache: {error}"))?;
    std::fs::rename(&temp_path, cache_path)
        .map_err(|error| format!("Unable to finalize {label} cache: {error}"))?;
    Ok(())
}

fn video_read_jpeg_data_url(path: &std::path::Path) -> Result<String, String> {
    use base64::Engine as _;
    let bytes = std::fs::read(path)
        .map_err(|error| format!("Unable to read video filmstrip frame: {error}"))?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn video_run_ffmpeg_stdout_limited(
    ffmpeg_path: &str,
    args: &[String],
    max_stdout_bytes: usize,
) -> Result<Vec<u8>, String> {
    let mut command = std::process::Command::new(ffmpeg_path);
    apply_desktop_command_environment(&mut command);
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Unable to start ffmpeg: {error}"))?;

    let stderr = child.stderr.take();
    let stderr_reader = stderr.map(|stderr| {
        std::thread::spawn(move || {
            use std::io::Read as _;
            let mut reader = std::io::BufReader::new(stderr);
            let mut buffer = [0u8; 8192];
            let mut output = Vec::new();
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        if output.len() < 64 * 1024 {
                            let remaining = (64 * 1024usize).saturating_sub(output.len());
                            output.extend_from_slice(&buffer[..read.min(remaining)]);
                        }
                    }
                    Err(_) => break,
                }
            }
            String::from_utf8_lossy(&output).to_string()
        })
    });

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Unable to read ffmpeg output.".to_string())?;
    let mut pcm = Vec::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut capped = false;
    loop {
        use std::io::Read as _;
        let read = stdout
            .read(&mut buffer)
            .map_err(|error| format!("Unable to read ffmpeg output: {error}"))?;
        if read == 0 {
            break;
        }
        let remaining = max_stdout_bytes.saturating_sub(pcm.len());
        if read >= remaining {
            pcm.extend_from_slice(&buffer[..remaining]);
            capped = true;
            let _ = child.kill();
            break;
        }
        pcm.extend_from_slice(&buffer[..read]);
    }

    let status = child
        .wait()
        .map_err(|error| format!("Unable to wait for ffmpeg: {error}"))?;
    let stderr = stderr_reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    if !capped && !status.success() {
        let detail = first_output_line(&command_output_text("", &stderr));
        return Err(if detail.is_empty() {
            "ffmpeg could not decode the media waveform.".to_string()
        } else {
            format!("ffmpeg could not decode the media waveform: {detail}")
        });
    }
    Ok(pcm)
}

fn video_waveform_peaks(pcm: &[u8], samples: usize) -> Vec<f32> {
    let total_pcm_samples = pcm.len() / 2;
    let mut peaks = vec![0.0f32; samples];
    if total_pcm_samples == 0 {
        return peaks;
    }
    for (index, chunk) in pcm.chunks_exact(2).enumerate() {
        let value = i16::from_le_bytes([chunk[0], chunk[1]]) as i32;
        let peak = ((value.abs().min(32768) as f32) / 32768.0).min(1.0);
        let bucket = (index * samples / total_pcm_samples).min(samples.saturating_sub(1));
        if peak > peaks[bucket] {
            peaks[bucket] = peak;
        }
    }
    peaks
        .into_iter()
        .map(|value| (value * 1000.0).round() / 1000.0)
        .collect()
}

fn video_scan_media_files(folder_root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    let Ok(entries) = std::fs::read_dir(folder_root) else {
        return files;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            files.push(path);
        } else if path.is_dir() {
            if let Ok(children) = std::fs::read_dir(&path) {
                for child in children.flatten() {
                    let child_path = child.path();
                    if child_path.is_file() {
                        files.push(child_path);
                    }
                }
            }
        }
    }
    files.sort();
    files
}

fn video_version_for_tool(path: &str) -> Option<String> {
    let capture = run_command_capture(
        path,
        &["-version"],
        None,
        std::time::Duration::from_secs(5),
        None,
    )
    .ok()?;
    if capture.exit_code != Some(0) {
        return None;
    }
    let first = first_output_line(&command_output_text(&capture.stdout, &capture.stderr));
    if first.is_empty() {
        None
    } else {
        Some(first)
    }
}

fn video_unix_executable(path: &std::path::Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        path.is_file()
            && std::fs::metadata(path)
                .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

fn video_find_common_tool(binary: &str) -> Option<String> {
    let executable = video_executable_name(binary);
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        dirs.extend([
            std::path::PathBuf::from("/opt/homebrew/bin"),
            std::path::PathBuf::from("/usr/local/bin"),
            std::path::PathBuf::from("/usr/bin"),
        ]);
    }
    #[cfg(target_os = "linux")]
    {
        dirs.extend([
            std::path::PathBuf::from("/opt/homebrew/bin"),
            std::path::PathBuf::from("/usr/local/bin"),
            std::path::PathBuf::from("/usr/bin"),
            std::path::PathBuf::from("/home/linuxbrew/.linuxbrew/bin"),
        ]);
    }
    #[cfg(windows)]
    {
        for key in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Ok(value) = std::env::var(key) {
                let base = std::path::PathBuf::from(value);
                dirs.extend([
                    base.join("ffmpeg").join("bin"),
                    base.join("FFmpeg").join("bin"),
                    base.join("ffmpeg-master-latest-win64-gpl").join("bin"),
                ]);
            }
        }
    }
    for dir in dirs {
        let candidate = dir.join(&executable);
        if video_unix_executable(&candidate) {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

fn video_detect_tool(app: &tauri::AppHandle, binary: &str) -> VideoToolAvailability {
    let executable = video_executable_name(binary);
    if let Ok(managed_dir) = video_app_tools_bin_directory(app) {
        let candidate = managed_dir.join(&executable);
        if video_unix_executable(&candidate) {
            let path = candidate.to_string_lossy().to_string();
            return VideoToolAvailability {
                installed: true,
                version: video_version_for_tool(&path),
                path: Some(path),
                source: Some("managed".to_string()),
            };
        }
    }
    if let Some(path) = tools_binary_on_path(&executable).or_else(|| tools_binary_on_path(binary)) {
        return VideoToolAvailability {
            installed: true,
            version: video_version_for_tool(&path),
            path: Some(path),
            source: Some("system".to_string()),
        };
    }
    if let Some(path) = video_find_common_tool(binary) {
        return VideoToolAvailability {
            installed: true,
            version: video_version_for_tool(&path),
            path: Some(path),
            source: Some("system".to_string()),
        };
    }
    VideoToolAvailability {
        installed: false,
        path: None,
        version: None,
        source: None,
    }
}

fn video_tools_status_for(app: &tauri::AppHandle) -> VideoToolsStatusResponse {
    let platform = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();
    let installable = matches!(platform.as_str(), "macos" | "windows" | "linux")
        && matches!(arch.as_str(), "x86_64" | "aarch64");
    let install_hint = match platform.as_str() {
        "macos" => "Install via Homebrew when available, otherwise download static ffmpeg and ffprobe builds.".to_string(),
        "windows" => "Download the latest BtbN win64 GPL static ffmpeg build.".to_string(),
        "linux" => "Download the latest BtbN static ffmpeg build for this architecture.".to_string(),
        _ => "Automatic ffmpeg install is not available for this platform.".to_string(),
    };
    VideoToolsStatusResponse {
        platform,
        arch,
        installable,
        install_hint,
        ffmpeg: video_detect_tool(app, "ffmpeg"),
        ffprobe: video_detect_tool(app, "ffprobe"),
    }
}

fn video_emit_tools_install_progress(
    app: &tauri::AppHandle,
    job_id: &str,
    state: &str,
    message: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<f64>,
    done: bool,
    error: Option<&str>,
) {
    let _ = app.emit(
        VIDEO_TOOLS_INSTALL_PROGRESS_EVENT,
        serde_json::json!({
            "jobId": job_id,
            "state": state,
            "message": message,
            "downloadedBytes": downloaded_bytes,
            "totalBytes": total_bytes,
            "percent": percent,
            "done": done,
            "error": error,
        }),
    );
}

async fn video_download_to_path(
    app: &tauri::AppHandle,
    job_id: &str,
    url: &str,
    target_path: &std::path::Path,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
    progress_message: &str,
) -> Result<(), String> {
    use std::io::Write as _;
    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create video tools directory: {error}"))?;
    }
    let temp_path = target_path.with_extension("download");
    let _ = std::fs::remove_file(&temp_path);
    let client = http_client(std::time::Duration::from_secs(VIDEO_DOWNLOAD_TIMEOUT_SECS))?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Unable to download video tool archive: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Video tool download returned HTTP {}.",
            response.status()
        ));
    }
    let total_bytes = response.content_length();
    let mut downloaded_bytes = 0u64;
    let mut file = std::fs::File::create(&temp_path)
        .map_err(|error| format!("Unable to write video tool download: {error}"))?;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Unable to read video tool download: {error}"))?
    {
        if cancel.load(std::sync::atomic::Ordering::Acquire) {
            let _ = std::fs::remove_file(&temp_path);
            return Err("Video tools install was cancelled.".to_string());
        }
        file.write_all(&chunk)
            .map_err(|error| format!("Unable to write video tool download: {error}"))?;
        downloaded_bytes += chunk.len() as u64;
        let percent = total_bytes
            .filter(|total| *total > 0)
            .map(|total| (downloaded_bytes as f64 / total as f64) * 100.0);
        video_emit_tools_install_progress(
            app,
            job_id,
            "downloading",
            progress_message,
            downloaded_bytes,
            total_bytes,
            percent,
            false,
            None,
        );
    }
    file.flush()
        .map_err(|error| format!("Unable to finalize video tool download: {error}"))?;
    std::fs::rename(&temp_path, target_path)
        .map_err(|error| format!("Unable to finalize video tool archive: {error}"))?;
    Ok(())
}

fn video_extract_zip_file(zip_path: &std::path::Path, destination: &std::path::Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path)
        .map_err(|error| format!("Unable to open video tool archive: {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Unable to read video tool archive: {error}"))?;
    std::fs::create_dir_all(destination)
        .map_err(|error| format!("Unable to prepare video tool extraction directory: {error}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Unable to extract video tool archive: {error}"))?;
        let enclosed_name = entry
            .enclosed_name()
            .ok_or_else(|| "Video tool archive contains an unsafe path.".to_string())?;
        let output_path = destination.join(enclosed_name);
        if entry.is_dir() {
            std::fs::create_dir_all(&output_path)
                .map_err(|error| format!("Unable to create video tool directory: {error}"))?;
            continue;
        }
        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Unable to prepare video tool directory: {error}"))?;
        }
        let mut output_file = std::fs::File::create(&output_path)
            .map_err(|error| format!("Unable to create video tool file: {error}"))?;
        std::io::copy(&mut entry, &mut output_file)
            .map_err(|error| format!("Unable to write video tool file: {error}"))?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn video_extract_tar_file(tar_path: &std::path::Path, destination: &std::path::Path) -> Result<(), String> {
    let file = std::fs::File::open(tar_path)
        .map_err(|error| format!("Unable to open video tool tar archive: {error}"))?;
    let mut archive = tar::Archive::new(file);
    std::fs::create_dir_all(destination)
        .map_err(|error| format!("Unable to prepare video tool extraction directory: {error}"))?;
    let entries = archive
        .entries()
        .map_err(|error| format!("Unable to read video tool tar archive: {error}"))?;
    for entry in entries {
        let mut entry = entry.map_err(|error| format!("Unable to extract video tool archive: {error}"))?;
        let entry_path = entry
            .path()
            .map_err(|error| format!("Unable to inspect video tool archive path: {error}"))?
            .into_owned();
        let mut safe_path = std::path::PathBuf::new();
        for component in entry_path.components() {
            match component {
                std::path::Component::Normal(part) => safe_path.push(part),
                std::path::Component::CurDir => {}
                _ => return Err("Video tool tar archive contains an unsafe path.".to_string()),
            }
        }
        if safe_path.as_os_str().is_empty() {
            continue;
        }
        let output_path = destination.join(safe_path);
        if !output_path.starts_with(destination) {
            return Err("Video tool tar archive contains an unsafe path.".to_string());
        }
        entry
            .unpack(&output_path)
            .map_err(|error| format!("Unable to unpack video tool archive: {error}"))?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn video_decompress_xz_to_tar(xz_path: &std::path::Path, tar_path: &std::path::Path) -> Result<(), String> {
    let input = std::fs::File::open(xz_path)
        .map_err(|error| format!("Unable to open video tool xz archive: {error}"))?;
    let output = std::fs::File::create(tar_path)
        .map_err(|error| format!("Unable to create video tool tar archive: {error}"))?;
    let mut reader = std::io::BufReader::new(input);
    let mut writer = std::io::BufWriter::new(output);
    lzma_rs::xz_decompress(&mut reader, &mut writer)
        .map_err(|error| format!("Unable to decompress video tool xz archive: {error}"))
}

fn video_find_executable_under(root: &std::path::Path, binary: &str) -> Option<std::path::PathBuf> {
    let executable = video_executable_name(binary);
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.eq_ignore_ascii_case(&executable))
                .unwrap_or(false)
            {
                return Some(path);
            }
        }
    }
    None
}

fn video_mark_executable(path: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let metadata = std::fs::metadata(path)
            .map_err(|error| format!("Unable to inspect video tool executable: {error}"))?;
        let mut permissions = metadata.permissions();
        permissions.set_mode(permissions.mode() | 0o755);
        std::fs::set_permissions(path, permissions)
            .map_err(|error| format!("Unable to mark video tool executable: {error}"))?;
    }
    Ok(())
}

fn video_copy_installed_tool(
    extracted_root: &std::path::Path,
    bin_dir: &std::path::Path,
    binary: &str,
) -> Result<(), String> {
    let source = video_find_executable_under(extracted_root, binary)
        .ok_or_else(|| format!("Video tool archive did not contain {binary}."))?;
    std::fs::create_dir_all(bin_dir)
        .map_err(|error| format!("Unable to create video tools bin directory: {error}"))?;
    let target = bin_dir.join(video_executable_name(binary));
    std::fs::copy(&source, &target)
        .map_err(|error| format!("Unable to install {binary}: {error}"))?;
    video_mark_executable(&target)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn video_homebrew_executable_path() -> Option<std::path::PathBuf> {
    if let Some(path) = tools_binary_on_path("brew") {
        return Some(std::path::PathBuf::from(path));
    }
    [
        std::path::PathBuf::from("/opt/homebrew/bin/brew"),
        std::path::PathBuf::from("/usr/local/bin/brew"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

#[cfg(target_os = "macos")]
fn video_install_with_homebrew(
    app: &tauri::AppHandle,
    job_id: &str,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<bool, String> {
    let Some(brew_path) = video_homebrew_executable_path() else {
        return Ok(false);
    };
    video_emit_tools_install_progress(
        app,
        job_id,
        "installing",
        "Installing ffmpeg with Homebrew.",
        0,
        None,
        None,
        false,
        None,
    );
    let cancel_for_command = cancel.clone();
    let capture = run_command_capture_with_cancel(
        &brew_path.to_string_lossy(),
        &["install", "ffmpeg"],
        None,
        std::time::Duration::from_secs(VIDEO_TOOLS_INSTALL_TIMEOUT_SECS),
        None,
        move || cancel_for_command.load(std::sync::atomic::Ordering::Acquire),
        "Video tools install was cancelled.",
    )
    .map_err(|error| format!("Unable to run Homebrew: {error}"))?;
    if capture.exit_code != Some(0) {
        let detail = first_output_line(&command_output_text(&capture.stdout, &capture.stderr));
        if detail.is_empty() {
            return Err("Homebrew could not install ffmpeg.".to_string());
        }
        return Err(format!("Homebrew could not install ffmpeg: {detail}"));
    }
    Ok(true)
}

async fn video_install_from_archives(
    app: &tauri::AppHandle,
    job_id: &str,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    let tools_dir = video_app_tools_directory(app)?;
    let bin_dir = video_app_tools_bin_directory(app)?;
    let downloads_dir = tools_dir.join("downloads");
    let extract_dir = tools_dir.join("extract");
    let _ = std::fs::remove_dir_all(&extract_dir);
    std::fs::create_dir_all(&downloads_dir)
        .map_err(|error| format!("Unable to prepare video tools download directory: {error}"))?;

    #[cfg(target_os = "macos")]
    {
        let ffmpeg_zip = downloads_dir.join("ffmpeg.zip");
        let ffprobe_zip = downloads_dir.join("ffprobe.zip");
        video_download_to_path(
            app,
            job_id,
            video_tool_download_url("macos-ffmpeg-zip"),
            &ffmpeg_zip,
            cancel,
            "Downloading ffmpeg.",
        )
        .await?;
        video_download_to_path(
            app,
            job_id,
            video_tool_download_url("macos-ffprobe-zip"),
            &ffprobe_zip,
            cancel,
            "Downloading ffprobe.",
        )
        .await?;
        video_emit_tools_install_progress(
            app,
            job_id,
            "extracting",
            "Extracting video tools.",
            0,
            None,
            None,
            false,
            None,
        );
        let ffmpeg_extract = extract_dir.join("ffmpeg");
        let ffprobe_extract = extract_dir.join("ffprobe");
        video_extract_zip_file(&ffmpeg_zip, &ffmpeg_extract)?;
        video_extract_zip_file(&ffprobe_zip, &ffprobe_extract)?;
        video_copy_installed_tool(&ffmpeg_extract, &bin_dir, "ffmpeg")?;
        video_copy_installed_tool(&ffprobe_extract, &bin_dir, "ffprobe")?;
    }

    #[cfg(windows)]
    {
        let archive_path = downloads_dir.join("ffmpeg-win64.zip");
        video_download_to_path(
            app,
            job_id,
            video_tool_download_url("windows-win64-zip"),
            &archive_path,
            cancel,
            "Downloading ffmpeg for Windows.",
        )
        .await?;
        video_emit_tools_install_progress(
            app,
            job_id,
            "extracting",
            "Extracting video tools.",
            0,
            None,
            None,
            false,
            None,
        );
        video_extract_zip_file(&archive_path, &extract_dir)?;
        video_copy_installed_tool(&extract_dir, &bin_dir, "ffmpeg")?;
        video_copy_installed_tool(&extract_dir, &bin_dir, "ffprobe")?;
    }

    #[cfg(target_os = "linux")]
    {
        let archive_url = if std::env::consts::ARCH == "aarch64" {
            video_tool_download_url("linux-arm64-tar-xz")
        } else {
            video_tool_download_url("linux-x64-tar-xz")
        };
        let xz_path = downloads_dir.join("ffmpeg-linux.tar.xz");
        let tar_path = downloads_dir.join("ffmpeg-linux.tar");
        video_download_to_path(
            app,
            job_id,
            archive_url,
            &xz_path,
            cancel,
            "Downloading ffmpeg for Linux.",
        )
        .await?;
        video_emit_tools_install_progress(
            app,
            job_id,
            "extracting",
            "Extracting video tools.",
            0,
            None,
            None,
            false,
            None,
        );
        video_decompress_xz_to_tar(&xz_path, &tar_path)?;
        video_extract_tar_file(&tar_path, &extract_dir)?;
        video_copy_installed_tool(&extract_dir, &bin_dir, "ffmpeg")?;
        video_copy_installed_tool(&extract_dir, &bin_dir, "ffprobe")?;
    }

    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = (app, job_id, cancel);
        return Err("Automatic video tools install is not available on this platform.".to_string());
    }

    Ok(())
}

async fn video_tools_install_worker(
    app: tauri::AppHandle,
    job_id: String,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    let result = async {
        let lock = VIDEO_TOOLS_INSTALL_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
        let _guard = lock.lock().await;
        if cancel.load(std::sync::atomic::Ordering::Acquire) {
            return Err("Video tools install was cancelled.".to_string());
        }
        video_emit_tools_install_progress(
            &app,
            &job_id,
            "starting",
            "Preparing video tools install.",
            0,
            None,
            Some(0.0),
            false,
            None,
        );
        let status = video_tools_status_for(&app);
        if status.ffmpeg.installed && status.ffprobe.installed {
            let message = status
                .ffmpeg
                .version
                .as_deref()
                .unwrap_or("ffmpeg is already installed.")
                .to_string();
            video_emit_tools_install_progress(
                &app,
                &job_id,
                "done",
                &message,
                0,
                None,
                Some(100.0),
                true,
                None,
            );
            return Ok(());
        }

        #[cfg(target_os = "macos")]
        if video_install_with_homebrew(&app, &job_id, &cancel)? {
            let status = video_tools_status_for(&app);
            if status.ffmpeg.installed && status.ffprobe.installed {
                let message = status
                    .ffmpeg
                    .version
                    .as_deref()
                    .unwrap_or("ffmpeg installed with Homebrew.")
                    .to_string();
                video_emit_tools_install_progress(
                    &app,
                    &job_id,
                    "done",
                    &message,
                    0,
                    None,
                    Some(100.0),
                    true,
                    None,
                );
                return Ok(());
            }
        }

        video_install_from_archives(&app, &job_id, &cancel).await?;
        let status = video_tools_status_for(&app);
        if !status.ffmpeg.installed || !status.ffprobe.installed {
            return Err("Video tools were installed but verification failed.".to_string());
        }
        let message = status
            .ffmpeg
            .version
            .as_deref()
            .unwrap_or("ffmpeg installed.")
            .to_string();
        video_emit_tools_install_progress(
            &app,
            &job_id,
            "done",
            &message,
            0,
            None,
            Some(100.0),
            true,
            None,
        );
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = result {
        video_emit_tools_install_progress(
            &app,
            &job_id,
            "error",
            &error,
            0,
            None,
            Some(100.0),
            true,
            Some(&error),
        );
    }
    video_job_registry_remove(&VIDEO_INSTALL_JOBS, &job_id);
}

#[tauri::command]
async fn video_tools_status(app: tauri::AppHandle) -> Result<VideoToolsStatusResponse, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(video_tools_status_for(&app)))
        .await
        .map_err(|error| format!("Video tools status worker failed: {error}"))?
}

#[tauri::command]
async fn video_tools_install(app: tauri::AppHandle) -> Result<VideoJobStartResult, String> {
    let (job_id, cancel) = video_job_registry_insert(&VIDEO_INSTALL_JOBS)?;
    tauri::async_runtime::spawn(video_tools_install_worker(app, job_id.clone(), cancel));
    Ok(VideoJobStartResult { job_id })
}

#[tauri::command]
fn video_tools_install_cancel(job_id: String) -> Result<(), String> {
    video_job_registry_cancel(&VIDEO_INSTALL_JOBS, &job_id)
}

#[tauri::command]
fn video_watch_start(app: tauri::AppHandle, repo_path: String) -> Result<(), String> {
    let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
    video_ensure_media_dirs(&media_root)?;
    let key = media_root.to_string_lossy().to_string();
    let roots = VIDEO_WATCH_ROOTS.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()));
    {
        let mut guard = roots
            .lock()
            .map_err(|_| "Video watch registry is poisoned.".to_string())?;
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
            .watch(&media_root, notify::RecursiveMode::Recursive)
            .is_err()
        {
            return;
        }
        let collect = |event: notify::Result<notify::Event>, paths: &mut std::collections::HashSet<String>| {
            let Ok(event) = event else {
                return;
            };
            for path in &event.paths {
                if path.starts_with(media_root.join(VIDEO_CACHE_DIR)) {
                    continue;
                }
                paths.insert(video_relative_path(&root, path));
            }
        };
        loop {
            let mut pending: std::collections::HashSet<String> = std::collections::HashSet::new();
            let Ok(first) = rx.recv() else {
                return;
            };
            collect(first, &mut pending);
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
                VIDEO_STORE_CHANGED_EVENT,
                serde_json::json!({
                    "repoPath": repo_display,
                    "paths": paths,
                    "changedAtMs": video_now_millis(),
                }),
            );
        }
    });
    Ok(())
}

#[tauri::command]
async fn video_media_list(
    app: tauri::AppHandle,
    repo_path: String,
) -> Result<VideoMediaListResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _span = BackendCpuSpan::new("video_media_list");
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let status = video_tools_status_for(&app);
        let ffmpeg_path = status.ffmpeg.path.as_deref();
        let ffprobe_path = status.ffprobe.path.as_deref();
        let mut items = Vec::new();
        let cache_path = media_root.join(VIDEO_CACHE_DIR).join(VIDEO_PROBE_CACHE_FILE);
        let mut probe_cache = video_read_probe_cache(&cache_path);
        let mut probe_cache_dirty = false;
        let mut thumbnails_generated = 0usize;
        for folder in [VIDEO_ASSETS_DIR, VIDEO_GENERATED_DIR] {
            for path in video_scan_media_files(&media_root.join(folder)) {
                if let Some(item) = video_build_media_item(
                    &root,
                    &media_root,
                    &path,
                    folder,
                    ffmpeg_path,
                    ffprobe_path,
                    &mut probe_cache,
                    &mut probe_cache_dirty,
                    &mut thumbnails_generated,
                ) {
                    items.push(item);
                }
            }
        }
        if probe_cache_dirty {
            let _ = video_write_probe_cache(&cache_path, &probe_cache);
        }
        items.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(VideoMediaListResponse {
            repo_path: root.to_string_lossy().to_string(),
            media_root: media_root.to_string_lossy().to_string(),
            ffmpeg_ready: status.ffmpeg.installed,
            items,
        })
    })
    .await
    .map_err(|error| format!("Video media list worker failed: {error}"))?
}

fn video_destination_with_collision(
    directory: &std::path::Path,
    file_name: &str,
) -> std::path::PathBuf {
    let source_path = std::path::Path::new(file_name);
    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| video_safe_file_stem(value, "asset"))
        .unwrap_or_else(|| "asset".to_string());
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut index = 0u32;
    loop {
        let name = if index == 0 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

#[tauri::command]
async fn video_media_import(
    app: tauri::AppHandle,
    repo_path: String,
    source_paths: Vec<String>,
) -> Result<VideoMediaImportResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _span = BackendCpuSpan::new("video_media_import");
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let assets_dir = media_root.join(VIDEO_ASSETS_DIR);
        let status = video_tools_status_for(&app);
        let mut probe_cache = video_read_probe_cache(&media_root.join(VIDEO_CACHE_DIR).join(VIDEO_PROBE_CACHE_FILE));
        let mut probe_cache_dirty = false;
        let mut thumbnails_generated = 0usize;
        let mut imported = Vec::new();
        let mut changed_paths = Vec::new();
        for source in source_paths {
            let source_path = std::path::PathBuf::from(source.trim());
            if !source_path.is_absolute() || !source_path.is_file() {
                return Err(format!("Video import source is not a file: {}", source_path.display()));
            }
            if video_media_kind_for_extension(&source_path).is_none() {
                return Err(format!(
                    "Unsupported video media extension: {}",
                    source_path.display()
                ));
            }
            let file_name = source_path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| "Video import source is missing a file name.".to_string())?;
            let destination = video_destination_with_collision(&assets_dir, file_name);
            std::fs::copy(&source_path, &destination)
                .map_err(|error| format!("Unable to import video media: {error}"))?;
            changed_paths.push(video_relative_path(&root, &destination));
            if let Some(item) = video_build_media_item(
                &root,
                &media_root,
                &destination,
                VIDEO_ASSETS_DIR,
                status.ffmpeg.path.as_deref(),
                status.ffprobe.path.as_deref(),
                &mut probe_cache,
                &mut probe_cache_dirty,
                &mut thumbnails_generated,
            ) {
                imported.push(item);
            }
        }
        if probe_cache_dirty {
            let _ = video_write_probe_cache(
                &media_root.join(VIDEO_CACHE_DIR).join(VIDEO_PROBE_CACHE_FILE),
                &probe_cache,
            );
        }
        if !changed_paths.is_empty() {
            let _ = app.emit(
                VIDEO_STORE_CHANGED_EVENT,
                serde_json::json!({
                    "repoPath": root.to_string_lossy().to_string(),
                    "paths": changed_paths,
                    "changedAtMs": video_now_millis(),
                }),
            );
        }
        Ok(VideoMediaImportResponse { imported })
    })
    .await
    .map_err(|error| format!("Video media import worker failed: {error}"))?
}

#[tauri::command]
async fn video_media_delete(
    app: tauri::AppHandle,
    repo_path: String,
    path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let abs = video_resolve_media_abs(&root, &media_root, path.as_str())?;
        if !abs.starts_with(media_root.join(VIDEO_ASSETS_DIR))
            && !abs.starts_with(media_root.join(VIDEO_GENERATED_DIR))
        {
            return Err("Only media/assets and media/generated files can be deleted.".to_string());
        }
        let rel_path = video_relative_path(&root, &abs);
        std::fs::remove_file(&abs)
            .map_err(|error| format!("Unable to delete video media: {error}"))?;
        let cache_path = media_root.join(VIDEO_CACHE_DIR).join(VIDEO_PROBE_CACHE_FILE);
        let mut cache = video_read_probe_cache(&cache_path);
        let keys = cache
            .keys()
            .filter(|key| key.starts_with(&format!("{rel_path}|")))
            .cloned()
            .collect::<Vec<_>>();
        for key in keys {
            cache.remove(&key);
            let thumb_path = media_root
                .join(VIDEO_CACHE_DIR)
                .join(VIDEO_THUMBS_DIR)
                .join(format!("{}.jpg", video_sha1_hex(&key)));
            let _ = std::fs::remove_file(thumb_path);
        }
        let _ = video_write_probe_cache(&cache_path, &cache);
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
    .map_err(|error| format!("Video media delete worker failed: {error}"))?
}

#[tauri::command]
async fn video_media_waveform(
    app: tauri::AppHandle,
    repo_path: String,
    path: String,
    samples: Option<usize>,
) -> Result<VideoMediaWaveformResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _span = BackendCpuSpan::new("video_media_waveform");
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let (abs, rel_path, kind, metadata) =
            video_resolve_existing_media_file(&root, &media_root, path.as_str())?;
        if !matches!(kind, "audio" | "video") {
            return Err("Waveforms can only be generated for audio or video media.".to_string());
        }
        let sample_count = samples.unwrap_or(600).clamp(100, 2000);
        let cache_path = media_root
            .join(VIDEO_CACHE_DIR)
            .join(VIDEO_WAVEFORMS_DIR)
            .join(format!(
                "{}.json",
                video_cache_file_stem(&rel_path, &metadata, sample_count)
            ));
        if let Ok(raw) = std::fs::read_to_string(&cache_path) {
            if let Ok(cached) = serde_json::from_str::<VideoMediaWaveformResponse>(&raw) {
                if cached.path == rel_path
                    && cached.samples == sample_count
                    && cached.peaks.len() == sample_count
                {
                    return Ok(cached);
                }
            }
        }
        let status = video_tools_status_for(&app);
        let ffmpeg_path = status
            .ffmpeg
            .path
            .ok_or_else(|| "ffmpeg is required to generate video media waveforms. Install video tools first.".to_string())?;
        let input = abs.to_string_lossy().to_string();
        let args = vec![
            "-nostdin".to_string(),
            "-v".to_string(),
            "error".to_string(),
            "-i".to_string(),
            input,
            "-vn".to_string(),
            "-ac".to_string(),
            "1".to_string(),
            "-ar".to_string(),
            "8000".to_string(),
            "-f".to_string(),
            "s16le".to_string(),
            "-".to_string(),
        ];
        let pcm = video_run_ffmpeg_stdout_limited(
            &ffmpeg_path,
            &args,
            VIDEO_WAVEFORM_PCM_LIMIT_BYTES,
        )?;
        let response = VideoMediaWaveformResponse {
            path: rel_path,
            samples: sample_count,
            peaks: video_waveform_peaks(&pcm, sample_count),
        };
        video_write_json_cache(&cache_path, &response, "video waveform")?;
        Ok(response)
    })
    .await
    .map_err(|error| format!("Video media waveform worker failed: {error}"))?
}

#[tauri::command]
async fn video_media_filmstrip(
    app: tauri::AppHandle,
    repo_path: String,
    path: String,
    frames: Option<usize>,
) -> Result<VideoMediaFilmstripResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _span = BackendCpuSpan::new("video_media_filmstrip");
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let (abs, rel_path, kind, metadata) =
            video_resolve_existing_media_file(&root, &media_root, path.as_str())?;
        if kind != "video" {
            return Err("Filmstrips can only be generated for video media.".to_string());
        }
        let frame_count = frames.unwrap_or(8).clamp(2, 16);
        let status = video_tools_status_for(&app);
        let ffmpeg_path = status
            .ffmpeg
            .path
            .ok_or_else(|| "ffmpeg is required to generate video filmstrips. Install video tools first.".to_string())?;
        let ffprobe_path = status
            .ffprobe
            .path
            .ok_or_else(|| "ffprobe is required to generate video filmstrips. Install video tools first.".to_string())?;
        let probe = video_probe_media(&ffprobe_path, &abs)
            .ok_or_else(|| "Unable to probe video duration for filmstrip generation.".to_string())?;
        let duration_ms = probe
            .duration_ms
            .filter(|duration| *duration > 0)
            .ok_or_else(|| "Video duration is required to generate a filmstrip.".to_string())?;
        let cache_dir = media_root.join(VIDEO_CACHE_DIR).join(VIDEO_FILMSTRIPS_DIR);
        std::fs::create_dir_all(&cache_dir)
            .map_err(|error| format!("Unable to create video filmstrip cache directory: {error}"))?;
        let cache_stem = video_cache_file_stem(&rel_path, &metadata, frame_count);
        let input = abs.to_string_lossy().to_string();
        let mut data_urls = Vec::with_capacity(frame_count);
        for index in 0..frame_count {
            let frame_path = cache_dir.join(format!("{cache_stem}-{index}.jpg"));
            if !frame_path.is_file() {
                let output = frame_path.to_string_lossy().to_string();
                let seconds = (duration_ms as f64 / 1000.0)
                    * ((index as f64 + 0.5) / frame_count as f64);
                let args = vec![
                    "-y".to_string(),
                    "-v".to_string(),
                    "error".to_string(),
                    "-ss".to_string(),
                    video_ffmpeg_number(seconds),
                    "-i".to_string(),
                    input.clone(),
                    "-frames:v".to_string(),
                    "1".to_string(),
                    "-vf".to_string(),
                    "scale=160:-2".to_string(),
                    output,
                ];
                let refs = args.iter().map(|value| value.as_str()).collect::<Vec<_>>();
                let capture = run_command_capture(
                    &ffmpeg_path,
                    refs.as_slice(),
                    None,
                    std::time::Duration::from_secs(VIDEO_THUMB_TIMEOUT_SECS),
                    None,
                )?;
                if capture.exit_code != Some(0) || !frame_path.is_file() {
                    let detail = first_output_line(&command_output_text(
                        &capture.stdout,
                        &capture.stderr,
                    ));
                    return Err(if detail.is_empty() {
                        "ffmpeg could not extract a video filmstrip frame.".to_string()
                    } else {
                        format!("ffmpeg could not extract a video filmstrip frame: {detail}")
                    });
                }
            }
            data_urls.push(video_read_jpeg_data_url(&frame_path)?);
        }
        Ok(VideoMediaFilmstripResponse {
            path: rel_path,
            frames: data_urls,
        })
    })
    .await
    .map_err(|error| format!("Video media filmstrip worker failed: {error}"))?
}

fn video_emit_transcribe_progress(
    app: &tauri::AppHandle,
    job_id: &str,
    path: &str,
    state: &str,
    percent: Option<f64>,
    done: bool,
    error: Option<&str>,
) {
    let _ = app.emit(
        VIDEO_TRANSCRIBE_PROGRESS_EVENT,
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

fn video_transcribe_cancelled(cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>) -> bool {
    cancel.load(std::sync::atomic::Ordering::Acquire)
}

fn video_extract_transcribe_mp3_blocking(
    ffmpeg_path: String,
    input_abs: std::path::PathBuf,
    output_abs: std::path::PathBuf,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<std::path::PathBuf, String> {
    if output_abs.is_file() {
        return Ok(output_abs);
    }
    if let Some(parent) = output_abs.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create video transcription cache directory: {error}"))?;
    }
    let temp_abs = output_abs.with_extension("tmp.mp3");
    let _ = std::fs::remove_file(&temp_abs);
    let input = input_abs.to_string_lossy().to_string();
    let output = temp_abs.to_string_lossy().to_string();
    let mut command = std::process::Command::new(&ffmpeg_path);
    apply_desktop_command_environment(&mut command);
    command
        .args([
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-i",
            input.as_str(),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            "48k",
            "-f",
            "mp3",
            output.as_str(),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Unable to start ffmpeg transcription extract: {error}"))?;
    let stderr = child.stderr.take();
    let stderr_reader = stderr.map(|stderr| {
        std::thread::spawn(move || {
            use std::io::Read as _;
            let mut reader = std::io::BufReader::new(stderr);
            let mut buffer = [0u8; 8192];
            let mut output = Vec::new();
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        if output.len() < 64 * 1024 {
                            let remaining = (64 * 1024usize).saturating_sub(output.len());
                            output.extend_from_slice(&buffer[..read.min(remaining)]);
                        }
                    }
                    Err(_) => break,
                }
            }
            String::from_utf8_lossy(&output).to_string()
        })
    });
    loop {
        if video_transcribe_cancelled(&cancel) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&temp_abs);
            return Err("Video transcription cancelled.".to_string());
        }
        match child
            .try_wait()
            .map_err(|error| format!("Unable to wait for ffmpeg transcription extract: {error}"))?
        {
            Some(status) => {
                let detail = stderr_reader
                    .and_then(|reader| reader.join().ok())
                    .unwrap_or_default();
                if !status.success() || !temp_abs.is_file() {
                    let detail = first_output_line(&detail);
                    let _ = std::fs::remove_file(&temp_abs);
                    return Err(if detail.is_empty() {
                        "ffmpeg could not extract transcription audio.".to_string()
                    } else {
                        format!("ffmpeg could not extract transcription audio: {detail}")
                    });
                }
                std::fs::rename(&temp_abs, &output_abs)
                    .map_err(|error| format!("Unable to finalize transcription audio cache: {error}"))?;
                return Ok(output_abs);
            }
            None => std::thread::sleep(std::time::Duration::from_millis(100)),
        }
    }
}

fn video_parse_transcript_segments(value: &serde_json::Value) -> Vec<VideoTranscriptSegment> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let text = item
                        .get("text")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    if text.is_empty() {
                        return None;
                    }
                    let start_ms = item
                        .get("startMs")
                        .or_else(|| item.get("start_ms"))
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0);
                    let end_ms = item
                        .get("endMs")
                        .or_else(|| item.get("end_ms"))
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(start_ms);
                    Some(VideoTranscriptSegment {
                        start_ms,
                        end_ms: end_ms.max(start_ms),
                        text,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn video_transcript_text(segments: &[VideoTranscriptSegment]) -> String {
    segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

async fn video_transcribe_worker(
    app: tauri::AppHandle,
    cloud_state: CloudMcpState,
    job_id: String,
    repo_path: String,
    path: String,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    let result = async {
        use base64::Engine as _;
        video_emit_transcribe_progress(
            &app,
            &job_id,
            &path,
            "extracting",
            Some(0.0),
            false,
            None,
        );
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let (abs, rel_path, kind, metadata) =
            video_resolve_existing_media_file(&root, &media_root, path.as_str())?;
        if !matches!(kind, "audio" | "video") {
            return Err("Transcription is only available for audio or video media.".to_string());
        }
        let transcript_path = video_transcript_cache_path(&media_root, &rel_path, &metadata);
        if transcript_path.is_file() {
            video_emit_transcribe_progress(
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
        if video_transcribe_cancelled(&cancel) {
            return Err("Video transcription cancelled.".to_string());
        }
        let audio_path = if abs
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("mp3"))
        {
            abs.clone()
        } else {
            let status = video_tools_status_for(&app);
            let ffmpeg_path = status
                .ffmpeg
                .path
                .ok_or_else(|| "ffmpeg is required to extract transcription audio. Install video tools first.".to_string())?;
            let cache_path = video_transcribe_mp3_cache_path(&media_root, &rel_path, &metadata);
            let cancel_for_extract = cancel.clone();
            tauri::async_runtime::spawn_blocking(move || {
                video_extract_transcribe_mp3_blocking(ffmpeg_path, abs, cache_path, cancel_for_extract)
            })
            .await
            .map_err(|error| format!("Video transcription extract worker failed: {error}"))??
        };
        if video_transcribe_cancelled(&cancel) {
            return Err("Video transcription cancelled.".to_string());
        }
        let audio_metadata = std::fs::metadata(&audio_path)
            .map_err(|error| format!("Unable to inspect transcription audio: {error}"))?;
        if audio_metadata.len() > VIDEO_TRANSCRIBE_MP3_LIMIT_BYTES {
            return Err(
                "Video media too long for cloud transcription; extracted MP3 exceeds 20MB. Trim the clip or use a shorter asset."
                    .to_string(),
            );
        }
        video_emit_transcribe_progress(
            &app,
            &job_id,
            &rel_path,
            "uploading",
            Some(35.0),
            false,
            None,
        );
        let audio_bytes = tauri::async_runtime::spawn_blocking({
            let audio_path = audio_path.clone();
            move || std::fs::read(&audio_path)
        })
        .await
        .map_err(|error| format!("Video transcription audio read worker failed: {error}"))?
        .map_err(|error| format!("Unable to read transcription audio: {error}"))?;
        if video_transcribe_cancelled(&cancel) {
            return Err("Video transcription cancelled.".to_string());
        }
        let audio_base64 = base64::engine::general_purpose::STANDARD.encode(audio_bytes);
        let request_id = format!("video-transcribe-{}-{}", video_now_millis(), uuid::Uuid::new_v4());
        let file_name = audio_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("audio.mp3")
            .to_string();
        let payload = serde_json::json!({
            "kind": "video_transcribe_request",
            "requestId": request_id,
            "audioBase64": audio_base64,
            "mimeType": "audio/mpeg",
            "fileName": file_name,
        });
        video_emit_transcribe_progress(
            &app,
            &job_id,
            &rel_path,
            "transcribing",
            Some(55.0),
            false,
            None,
        );
        let response = cloud_mcp_ws_request_once_with_timeout(
            &cloud_state,
            "video_transcribe_request",
            &payload,
            std::time::Duration::from_secs(VIDEO_TRANSCRIBE_TIMEOUT_SECS),
        )
        .await?;
        if video_transcribe_cancelled(&cancel) {
            return Err("Video transcription cancelled.".to_string());
        }
        let data = response
            .get("data")
            .cloned()
            .unwrap_or_else(|| response.clone());
        let segments = video_parse_transcript_segments(
            data.get("segments").unwrap_or(&serde_json::Value::Null),
        );
        let text = data
            .get("text")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| video_transcript_text(&segments));
        let language = data
            .get("language")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let transcript = VideoTranscriptCache {
            language,
            text,
            segments,
        };
        video_write_json_cache(&transcript_path, &transcript, "video transcript")?;
        video_emit_transcribe_progress(
            &app,
            &job_id,
            &rel_path,
            "done",
            Some(100.0),
            true,
            None,
        );
        let _ = app.emit(
            VIDEO_STORE_CHANGED_EVENT,
            serde_json::json!({
                "repoPath": root.to_string_lossy().to_string(),
                "paths": [rel_path],
                "changedAtMs": video_now_millis(),
            }),
        );
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = result {
        let state = "error";
        video_emit_transcribe_progress(
            &app,
            &job_id,
            &path,
            state,
            Some(100.0),
            true,
            Some(&error),
        );
    }
    video_job_registry_remove(&VIDEO_TRANSCRIBE_JOBS, &job_id);
}

#[tauri::command]
async fn video_transcribe_start(
    app: tauri::AppHandle,
    cloud_state: tauri::State<'_, CloudMcpState>,
    repo_path: String,
    path: String,
) -> Result<VideoJobStartResult, String> {
    let (job_id, cancel) = video_job_registry_insert(&VIDEO_TRANSCRIBE_JOBS)?;
    tauri::async_runtime::spawn(video_transcribe_worker(
        app,
        cloud_state.inner().clone(),
        job_id.clone(),
        repo_path,
        path,
        cancel,
    ));
    Ok(VideoJobStartResult { job_id })
}

#[tauri::command]
fn video_transcribe_cancel(job_id: String) -> Result<(), String> {
    video_job_registry_cancel(&VIDEO_TRANSCRIBE_JOBS, &job_id)
}

#[tauri::command]
async fn video_transcript_get(
    repo_path: String,
    path: String,
) -> Result<VideoTranscriptGetResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let (_abs, rel_path, kind, metadata) =
            video_resolve_existing_media_file(&root, &media_root, path.as_str())?;
        if !matches!(kind, "audio" | "video") {
            return Err("Transcripts are only available for audio or video media.".to_string());
        }
        let transcript_path = video_transcript_cache_path(&media_root, &rel_path, &metadata);
        match std::fs::read_to_string(&transcript_path) {
            Ok(raw) => {
                let cache = serde_json::from_str::<VideoTranscriptCache>(&raw)
                    .map_err(|error| format!("Unable to parse video transcript cache: {error}"))?;
                Ok(VideoTranscriptGetResponse {
                    available: true,
                    language: cache.language,
                    text: cache.text,
                    segments: cache.segments,
                })
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(VideoTranscriptGetResponse {
                    available: false,
                    language: None,
                    text: String::new(),
                    segments: Vec::new(),
                })
            }
            Err(error) => Err(format!("Unable to read video transcript cache: {error}")),
        }
    })
    .await
    .map_err(|error| format!("Video transcript cache worker failed: {error}"))?
}

#[tauri::command]
async fn video_frame_extract(
    app: tauri::AppHandle,
    repo_path: String,
    asset_path: String,
    at_ms: i64,
    name: Option<String>,
) -> Result<VideoFrameExtractResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _span = BackendCpuSpan::new("video_frame_extract");
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let (abs, _rel_path, kind, _) =
            video_resolve_existing_media_file(&root, &media_root, asset_path.as_str())?;
        if kind != "video" {
            return Err("Frames can only be extracted from video media.".to_string());
        }
        let status = video_tools_status_for(&app);
        let ffmpeg_path = status
            .ffmpeg
            .path
            .ok_or_else(|| "ffmpeg is required to extract video frames. Install video tools first.".to_string())?;
        let ffprobe_path = status
            .ffprobe
            .path
            .ok_or_else(|| "ffprobe is required to extract video frames. Install video tools first.".to_string())?;
        let probe = video_probe_media(&ffprobe_path, &abs)
            .ok_or_else(|| "Unable to probe video duration for frame extraction.".to_string())?;
        let duration_ms = probe
            .duration_ms
            .ok_or_else(|| "Video duration is required to extract a frame.".to_string())?;
        let requested_ms = if at_ms < 0 { 0 } else { at_ms as u64 };
        let seek_ms = requested_ms.min(duration_ms.saturating_sub(1));
        let source_stem = abs
            .file_stem()
            .and_then(|value| value.to_str())
            .map(|value| video_safe_file_stem(value, "asset"))
            .unwrap_or_else(|| "asset".to_string());
        let default_name = format!("{source_stem}-frame-{seek_ms}ms");
        let raw_name = name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(default_name.as_str());
        let name_stem = std::path::Path::new(raw_name)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(raw_name);
        let safe_name = video_safe_file_stem(name_stem, "frame");
        let assets_dir = media_root.join(VIDEO_ASSETS_DIR);
        let output_abs = video_destination_with_collision(
            &assets_dir,
            format!("{safe_name}.png").as_str(),
        );
        let input = abs.to_string_lossy().to_string();
        let output = output_abs.to_string_lossy().to_string();
        let args = vec![
            "-y".to_string(),
            "-v".to_string(),
            "error".to_string(),
            "-ss".to_string(),
            video_ffmpeg_seconds(seek_ms),
            "-i".to_string(),
            input,
            "-frames:v".to_string(),
            "1".to_string(),
            output,
        ];
        let refs = args.iter().map(|value| value.as_str()).collect::<Vec<_>>();
        let capture = run_command_capture(
            &ffmpeg_path,
            refs.as_slice(),
            None,
            std::time::Duration::from_secs(VIDEO_THUMB_TIMEOUT_SECS),
            None,
        )?;
        if capture.exit_code != Some(0) || !output_abs.is_file() {
            let detail = first_output_line(&command_output_text(
                &capture.stdout,
                &capture.stderr,
            ));
            return Err(if detail.is_empty() {
                "ffmpeg could not extract the video frame.".to_string()
            } else {
                format!("ffmpeg could not extract the video frame: {detail}")
            });
        }
        let mut probe_cache = video_read_probe_cache(
            &media_root.join(VIDEO_CACHE_DIR).join(VIDEO_PROBE_CACHE_FILE),
        );
        let mut probe_cache_dirty = false;
        let mut thumbnails_generated = 0usize;
        let item = video_build_media_item(
            &root,
            &media_root,
            &output_abs,
            VIDEO_ASSETS_DIR,
            Some(ffmpeg_path.as_str()),
            Some(ffprobe_path.as_str()),
            &mut probe_cache,
            &mut probe_cache_dirty,
            &mut thumbnails_generated,
        )
        .ok_or_else(|| "Extracted frame could not be added to the media store.".to_string())?;
        if probe_cache_dirty {
            let _ = video_write_probe_cache(
                &media_root.join(VIDEO_CACHE_DIR).join(VIDEO_PROBE_CACHE_FILE),
                &probe_cache,
            );
        }
        let _ = app.emit(
            VIDEO_STORE_CHANGED_EVENT,
            serde_json::json!({
                "repoPath": root.to_string_lossy().to_string(),
                "paths": [item.path.clone()],
                "changedAtMs": video_now_millis(),
            }),
        );
        Ok(VideoFrameExtractResponse { item })
    })
    .await
    .map_err(|error| format!("Video frame extract worker failed: {error}"))?
}

const VIDEO_PIPE_HEADER: &str = "#diffforge-video 1\n# syntax: project \"<name>\" <W>x<H> [fps=30] [bg=#000000]\n#   track <video|audio|text> \"<label>\" [muted] [locked]\n#   c <asset-path> at=<ms> dur=<ms> [in=<ms>] [speed=<f>] [gain=<f>] [kf=<ms>:<lvl>,...] [x=] [y=] [scale=] [opacity=]\n#   t \"<text>\" at=<ms> dur=<ms> [size=48] [color=#ffffff] [bg=] [outline=#000000] [outlinew=0] [shadow] [upper] [x=0.5] [y=0.85] [align=center] [plain] [font=]\n";

#[derive(Debug, Clone)]
struct VideoPipeTrackDraft {
    id: String,
    kind: String,
    label: String,
    muted: bool,
    locked: bool,
    clips: Vec<serde_json::Value>,
}

fn video_pipe_line_error(line_number: usize, message: &str) -> String {
    format!("Video pipe line {line_number}: {message}")
}

fn video_pipe_tokenize_line(line: &str, line_number: usize) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut token_started = false;
    let mut in_quote = false;
    let mut chars = line.chars();
    while let Some(ch) = chars.next() {
        if in_quote {
            match ch {
                '"' => in_quote = false,
                '\\' => {
                    let Some(escaped) = chars.next() else {
                        return Err(video_pipe_line_error(line_number, "unterminated escape sequence"));
                    };
                    match escaped {
                        '"' => current.push('"'),
                        '\\' => current.push('\\'),
                        'n' => current.push('\n'),
                        other => current.push(other),
                    }
                }
                other => current.push(other),
            }
        } else if ch.is_whitespace() {
            if token_started {
                tokens.push(std::mem::take(&mut current));
                token_started = false;
            }
        } else if ch == '"' {
            in_quote = true;
            token_started = true;
        } else {
            current.push(ch);
            token_started = true;
        }
    }
    if in_quote {
        return Err(video_pipe_line_error(line_number, "unterminated quoted string"));
    }
    if token_started {
        tokens.push(current);
    }
    Ok(tokens)
}

fn video_pipe_key_value(token: &str) -> Option<(&str, &str)> {
    token
        .split_once('=')
        .and_then(|(key, value)| if key.is_empty() { None } else { Some((key, value)) })
}

fn video_pipe_parse_u64(value: &str, key: &str, line_number: usize) -> Result<u64, String> {
    value
        .parse::<u64>()
        .map_err(|_| video_pipe_line_error(line_number, &format!("invalid {key}=<ms> value")))
}

fn video_pipe_parse_f64(value: &str, key: &str, line_number: usize) -> Result<f64, String> {
    value
        .parse::<f64>()
        .ok()
        .filter(|number| number.is_finite())
        .ok_or_else(|| video_pipe_line_error(line_number, &format!("invalid {key}=<num> value")))
}

fn video_pipe_parse_dimensions(value: &str, line_number: usize) -> Result<(u64, u64), String> {
    let Some((width, height)) = value.split_once('x') else {
        return Err(video_pipe_line_error(line_number, "project dimensions must be <W>x<H>"));
    };
    if width.is_empty() || height.is_empty() {
        return Err(video_pipe_line_error(line_number, "project dimensions must be <W>x<H>"));
    }
    let width = width
        .parse::<u64>()
        .map_err(|_| video_pipe_line_error(line_number, "invalid project width"))?;
    let height = height
        .parse::<u64>()
        .map_err(|_| video_pipe_line_error(line_number, "invalid project height"))?;
    Ok((width, height))
}

fn video_pipe_parse_keyframes(value: &str, line_number: usize) -> Result<Vec<(u64, f64)>, String> {
    if value.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut keyframes = Vec::new();
    for part in value.split(',') {
        let Some((at_ms, level)) = part.split_once(':') else {
            return Err(video_pipe_line_error(line_number, "invalid kf=<ms>:<level> entry"));
        };
        keyframes.push((
            video_pipe_parse_u64(at_ms, "kf", line_number)?,
            video_pipe_parse_f64(level, "kf", line_number)?,
        ));
    }
    Ok(keyframes)
}

fn video_pipe_track_id(kind: &str, video_count: u32, audio_count: u32, text_count: u32) -> String {
    match kind {
        "video" => format!("v{video_count}"),
        "audio" => format!("a{audio_count}"),
        "text" => format!("t{text_count}"),
        _ => "track".to_string(),
    }
}

fn video_pipe_parse_project(raw: &str) -> Result<serde_json::Value, String> {
    let mut project_seen = false;
    let mut project_name = String::new();
    let mut project_width = 1920u64;
    let mut project_height = 1080u64;
    let mut project_fps = 30.0f64;
    let mut project_background = "#000000".to_string();
    let mut tracks: Vec<VideoPipeTrackDraft> = Vec::new();
    let mut current_track_index: Option<usize> = None;
    let mut video_count = 0u32;
    let mut audio_count = 0u32;
    let mut text_count = 0u32;
    let mut clip_count = 0u64;

    for (line_index, line) in raw.lines().enumerate() {
        let line_number = line_index + 1;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let tokens = video_pipe_tokenize_line(trimmed, line_number)?;
        if tokens.is_empty() {
            continue;
        }
        if !project_seen {
            if tokens.first().map(String::as_str) != Some("project") {
                return Err(video_pipe_line_error(
                    line_number,
                    "project line must be the first non-comment line",
                ));
            }
            if tokens.len() < 3 {
                return Err(video_pipe_line_error(
                    line_number,
                    "project line requires a name and dimensions",
                ));
            }
            project_name = tokens[1].clone();
            let (width, height) = video_pipe_parse_dimensions(&tokens[2], line_number)?;
            project_width = width;
            project_height = height;
            for token in tokens.iter().skip(3) {
                if let Some((key, value)) = video_pipe_key_value(token) {
                    match key {
                        "fps" => project_fps = video_pipe_parse_f64(value, key, line_number)?,
                        "bg" => project_background = value.to_string(),
                        _ => {}
                    }
                }
            }
            project_seen = true;
            continue;
        }

        match tokens[0].as_str() {
            "project" => {
                return Err(video_pipe_line_error(
                    line_number,
                    "project line must be the first non-comment line",
                ));
            }
            "track" => {
                if tokens.len() < 3 {
                    return Err(video_pipe_line_error(
                        line_number,
                        "track line requires a kind and label",
                    ));
                }
                let kind = tokens[1].as_str();
                if !matches!(kind, "video" | "audio" | "text") {
                    return Err(video_pipe_line_error(
                        line_number,
                        "track kind must be video, audio, or text",
                    ));
                }
                let mut muted = false;
                let mut locked = false;
                for token in tokens.iter().skip(3) {
                    match token.as_str() {
                        "muted" => muted = true,
                        "locked" => locked = true,
                        _ => {}
                    }
                }
                match kind {
                    "video" => video_count += 1,
                    "audio" => audio_count += 1,
                    "text" => text_count += 1,
                    _ => {}
                }
                let id = video_pipe_track_id(kind, video_count, audio_count, text_count);
                tracks.push(VideoPipeTrackDraft {
                    id,
                    kind: kind.to_string(),
                    label: tokens[2].clone(),
                    muted,
                    locked,
                    clips: Vec::new(),
                });
                current_track_index = Some(tracks.len() - 1);
            }
            "c" => {
                let Some(track_index) = current_track_index else {
                    return Err(video_pipe_line_error(line_number, "media clip must follow a track"));
                };
                if !matches!(tracks[track_index].kind.as_str(), "video" | "audio") {
                    return Err(video_pipe_line_error(
                        line_number,
                        "media clip can only be used under video or audio tracks",
                    ));
                }
                if tokens.len() < 2 || tokens[1].trim().is_empty() {
                    return Err(video_pipe_line_error(line_number, "media clip requires an asset path"));
                }
                let mut timeline_start_ms: Option<u64> = None;
                let mut duration_ms: Option<u64> = None;
                let mut source_in_ms = 0u64;
                let mut speed = 1.0f64;
                let mut gain_level = 1.0f64;
                let mut gain_keyframes: Vec<(u64, f64)> = Vec::new();
                let mut x = 0.0f64;
                let mut y = 0.0f64;
                let mut scale = 1.0f64;
                let mut opacity = 1.0f64;
                for token in tokens.iter().skip(2) {
                    if let Some((key, value)) = video_pipe_key_value(token) {
                        match key {
                            "at" => timeline_start_ms = Some(video_pipe_parse_u64(value, key, line_number)?),
                            "dur" => duration_ms = Some(video_pipe_parse_u64(value, key, line_number)?),
                            "in" => source_in_ms = video_pipe_parse_u64(value, key, line_number)?,
                            "speed" => speed = video_pipe_parse_f64(value, key, line_number)?,
                            "gain" => gain_level = video_pipe_parse_f64(value, key, line_number)?,
                            "kf" => gain_keyframes = video_pipe_parse_keyframes(value, line_number)?,
                            "x" => x = video_pipe_parse_f64(value, key, line_number)?,
                            "y" => y = video_pipe_parse_f64(value, key, line_number)?,
                            "scale" => scale = video_pipe_parse_f64(value, key, line_number)?,
                            "opacity" => opacity = video_pipe_parse_f64(value, key, line_number)?,
                            _ => {}
                        }
                    }
                }
                let Some(timeline_start_ms) = timeline_start_ms else {
                    return Err(video_pipe_line_error(line_number, "media clip requires at=<ms>"));
                };
                let Some(duration_ms) = duration_ms else {
                    return Err(video_pipe_line_error(line_number, "media clip requires dur=<ms>"));
                };
                clip_count += 1;
                let keyframes = gain_keyframes
                    .into_iter()
                    .map(|(at_ms, level)| serde_json::json!({ "atMs": at_ms, "level": level }))
                    .collect::<Vec<_>>();
                tracks[track_index].clips.push(serde_json::json!({
                    "id": format!("c{clip_count}"),
                    "assetPath": tokens[1],
                    "timelineStartMs": timeline_start_ms,
                    "durationMs": duration_ms,
                    "sourceInMs": source_in_ms,
                    "speed": speed,
                    "gain": {
                        "level": gain_level,
                        "keyframes": keyframes,
                    },
                    "transform": {
                        "x": x,
                        "y": y,
                        "scale": scale,
                        "opacity": opacity,
                    },
                }));
            }
            "t" => {
                let Some(track_index) = current_track_index else {
                    return Err(video_pipe_line_error(line_number, "text clip must follow a track"));
                };
                if tracks[track_index].kind != "text" {
                    return Err(video_pipe_line_error(
                        line_number,
                        "text clip can only be used under text tracks",
                    ));
                }
                if tokens.len() < 2 {
                    return Err(video_pipe_line_error(line_number, "text clip requires text"));
                }
                let mut timeline_start_ms: Option<u64> = None;
                let mut duration_ms: Option<u64> = None;
                let mut font_size = 48.0f64;
                let mut color = "#ffffff".to_string();
                let mut background = String::new();
                let mut outline_color = "#000000".to_string();
                let mut outline_width = 0.0f64;
                let mut shadow = false;
                let mut uppercase = false;
                let mut x = 0.5f64;
                let mut y = 0.85f64;
                let mut align = "center".to_string();
                let mut bold = true;
                let mut font_family = "sans-serif".to_string();
                for token in tokens.iter().skip(2) {
                    if token == "plain" {
                        bold = false;
                        continue;
                    }
                    if token == "shadow" {
                        shadow = true;
                        continue;
                    }
                    if token == "upper" {
                        uppercase = true;
                        continue;
                    }
                    if let Some((key, value)) = video_pipe_key_value(token) {
                        match key {
                            "at" => timeline_start_ms = Some(video_pipe_parse_u64(value, key, line_number)?),
                            "dur" => duration_ms = Some(video_pipe_parse_u64(value, key, line_number)?),
                            "size" => font_size = video_pipe_parse_f64(value, key, line_number)?,
                            "color" => color = value.to_string(),
                            "bg" => background = value.to_string(),
                            "outline" => outline_color = value.to_string(),
                            "outlinew" => outline_width = video_pipe_parse_f64(value, key, line_number)?,
                            "x" => x = video_pipe_parse_f64(value, key, line_number)?,
                            "y" => y = video_pipe_parse_f64(value, key, line_number)?,
                            "align" => {
                                if !matches!(value, "left" | "center" | "right") {
                                    return Err(video_pipe_line_error(
                                        line_number,
                                        "align must be left, center, or right",
                                    ));
                                }
                                align = value.to_string();
                            }
                            "font" => font_family = value.to_string(),
                            _ => {}
                        }
                    }
                }
                let Some(timeline_start_ms) = timeline_start_ms else {
                    return Err(video_pipe_line_error(line_number, "text clip requires at=<ms>"));
                };
                let Some(duration_ms) = duration_ms else {
                    return Err(video_pipe_line_error(line_number, "text clip requires dur=<ms>"));
                };
                clip_count += 1;
                tracks[track_index].clips.push(serde_json::json!({
                    "id": format!("c{clip_count}"),
                    "text": tokens[1],
                    "timelineStartMs": timeline_start_ms,
                    "durationMs": duration_ms,
                    "style": {
                        "fontSize": font_size,
                        "color": color,
                        "background": background,
                        "outlineColor": outline_color,
                        "outlineWidth": outline_width,
                        "shadow": shadow,
                        "uppercase": uppercase,
                        "x": x,
                        "y": y,
                        "align": align,
                        "bold": bold,
                        "fontFamily": font_family,
                    },
                }));
            }
            _ => {
                return Err(video_pipe_line_error(
                    line_number,
                    "unknown video pipe line type",
                ));
            }
        }
    }

    if !project_seen {
        return Err("Video pipe line 1: project line is required".to_string());
    }

    let tracks = tracks
        .into_iter()
        .map(|track| {
            serde_json::json!({
                "id": track.id,
                "kind": track.kind,
                "label": track.label,
                "muted": track.muted,
                "locked": track.locked,
                "clips": track.clips,
            })
        })
        .collect::<Vec<_>>();

    Ok(serde_json::json!({
        "version": 1,
        "name": project_name,
        "settings": {
            "width": project_width,
            "height": project_height,
            "fps": project_fps,
            "background": project_background,
        },
        "tracks": tracks,
        "updatedAtMs": 0,
    }))
}

fn video_pipe_quote_string(value: &str) -> String {
    let mut quoted = String::from("\"");
    for ch in value.chars() {
        match ch {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            '\n' | '\r' => quoted.push_str("\\n"),
            other => quoted.push(other),
        }
    }
    quoted.push('"');
    quoted
}

fn video_pipe_token_value(value: &str) -> String {
    if value.is_empty()
        || value
            .chars()
            .any(|ch| ch.is_whitespace() || matches!(ch, '"' | '\\'))
    {
        video_pipe_quote_string(value)
    } else {
        value.to_string()
    }
}

fn video_pipe_format_f64(value: f64) -> String {
    let rounded = (value * 1000.0).round() / 1000.0;
    if rounded.abs() < 0.0005 {
        return "0".to_string();
    }
    let mut text = format!("{rounded:.3}");
    while text.contains('.') && text.ends_with('0') {
        text.pop();
    }
    if text.ends_with('.') {
        text.pop();
    }
    if text == "-0" {
        "0".to_string()
    } else {
        text
    }
}

fn video_pipe_f64_is_default(value: f64, default: f64) -> bool {
    (value - default).abs() < 0.0005
}

fn video_pipe_push_f64_key(line: &mut String, key: &str, value: f64, default: f64) {
    if !video_pipe_f64_is_default(value, default) {
        line.push(' ');
        line.push_str(key);
        line.push('=');
        line.push_str(&video_pipe_format_f64(value));
    }
}

fn video_pipe_push_u64_key(line: &mut String, key: &str, value: u64, default: u64) {
    if value != default {
        line.push(' ');
        line.push_str(key);
        line.push('=');
        line.push_str(&value.to_string());
    }
}

fn video_pipe_push_string_key(line: &mut String, key: &str, value: &str, default: &str) {
    if value != default {
        line.push(' ');
        line.push_str(key);
        line.push('=');
        line.push_str(&video_pipe_token_value(value));
    }
}

fn video_pipe_serialize_project(project: &serde_json::Value) -> Result<String, String> {
    if !project.is_object() {
        return Err("Video project must be a JSON object.".to_string());
    }

    let settings = project.get("settings").unwrap_or(&serde_json::Value::Null);
    let name = video_json_string(project, "name", "Untitled");
    let width = video_json_u64(settings, "width", 1920);
    let height = video_json_u64(settings, "height", 1080);
    let fps = video_json_f64(settings, "fps", 30.0);
    let background = video_json_string(settings, "background", "#000000");
    let mut output = VIDEO_PIPE_HEADER.to_string();
    let mut project_line = format!("project {} {width}x{height}", video_pipe_quote_string(&name));
    video_pipe_push_f64_key(&mut project_line, "fps", fps, 30.0);
    video_pipe_push_string_key(&mut project_line, "bg", &background, "#000000");
    output.push_str(&project_line);
    output.push('\n');

    let tracks = project
        .get("tracks")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    for track in tracks {
        let kind = video_json_string(&track, "kind", "");
        if !matches!(kind.as_str(), "video" | "audio" | "text") {
            return Err("Video project track kind must be video, audio, or text.".to_string());
        }
        let default_label = kind.to_ascii_uppercase();
        let label = video_json_string(&track, "label", &default_label);
        let mut track_line = format!("track {kind} {}", video_pipe_quote_string(&label));
        if track.get("muted").and_then(|value| value.as_bool()).unwrap_or(false) {
            track_line.push_str(" muted");
        }
        if track.get("locked").and_then(|value| value.as_bool()).unwrap_or(false) {
            track_line.push_str(" locked");
        }
        output.push_str(&track_line);
        output.push('\n');

        let mut clips = track
            .get("clips")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        clips.sort_by_key(|clip| video_json_u64(clip, "timelineStartMs", 0));
        for clip in clips {
            let timeline_start_ms = video_json_u64(&clip, "timelineStartMs", 0);
            let duration_ms = video_json_u64(&clip, "durationMs", 0);
            if kind == "text" {
                let style = clip.get("style").unwrap_or(&serde_json::Value::Null);
                let text = video_json_string(&clip, "text", "");
                let mut line = format!(
                    "t {} at={timeline_start_ms} dur={duration_ms}",
                    video_pipe_quote_string(&text)
                );
                video_pipe_push_f64_key(&mut line, "size", video_json_f64(style, "fontSize", 48.0), 48.0);
                video_pipe_push_string_key(
                    &mut line,
                    "color",
                    &video_json_string(style, "color", "#ffffff"),
                    "#ffffff",
                );
                video_pipe_push_string_key(
                    &mut line,
                    "bg",
                    &video_json_string(style, "background", ""),
                    "",
                );
                let outline_color = video_json_string(style, "outlineColor", "#000000");
                let outline_width = video_json_f64(style, "outlineWidth", 0.0).max(0.0);
                if outline_width > 0.0 || outline_color != "#000000" {
                    video_pipe_push_string_key(&mut line, "outline", &outline_color, "");
                }
                video_pipe_push_f64_key(&mut line, "outlinew", outline_width, 0.0);
                if style.get("shadow").and_then(|value| value.as_bool()).unwrap_or(false) {
                    line.push_str(" shadow");
                }
                if style.get("uppercase").and_then(|value| value.as_bool()).unwrap_or(false) {
                    line.push_str(" upper");
                }
                video_pipe_push_f64_key(&mut line, "x", video_json_f64(style, "x", 0.5), 0.5);
                video_pipe_push_f64_key(&mut line, "y", video_json_f64(style, "y", 0.85), 0.85);
                let align = video_json_string(style, "align", "center");
                if !matches!(align.as_str(), "left" | "center" | "right") {
                    return Err("Video text clip align must be left, center, or right.".to_string());
                }
                video_pipe_push_string_key(&mut line, "align", &align, "center");
                if !style.get("bold").and_then(|value| value.as_bool()).unwrap_or(true) {
                    line.push_str(" plain");
                }
                video_pipe_push_string_key(
                    &mut line,
                    "font",
                    &video_json_string(style, "fontFamily", "sans-serif"),
                    "sans-serif",
                );
                output.push_str(&line);
                output.push('\n');
                continue;
            }

            let asset_path = video_json_string(&clip, "assetPath", "");
            if asset_path.trim().is_empty() {
                return Err("Video media clip assetPath is required.".to_string());
            }
            let transform = clip.get("transform").unwrap_or(&serde_json::Value::Null);
            let gain = clip.get("gain").unwrap_or(&serde_json::Value::Null);
            let mut line = format!(
                "c {} at={timeline_start_ms} dur={duration_ms}",
                video_pipe_token_value(&asset_path)
            );
            video_pipe_push_u64_key(&mut line, "in", video_json_u64(&clip, "sourceInMs", 0), 0);
            video_pipe_push_f64_key(&mut line, "speed", video_json_f64(&clip, "speed", 1.0), 1.0);
            video_pipe_push_f64_key(&mut line, "gain", video_json_f64(gain, "level", 1.0), 1.0);
            let keyframe_parts = gain
                .get("keyframes")
                .and_then(|value| value.as_array())
                .map(|keyframes| {
                    keyframes
                        .iter()
                        .map(|keyframe| {
                            format!(
                                "{}:{}",
                                video_json_u64(keyframe, "atMs", 0),
                                video_pipe_format_f64(video_json_f64(keyframe, "level", 1.0))
                            )
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if !keyframe_parts.is_empty() {
                line.push_str(" kf=");
                line.push_str(&keyframe_parts.join(","));
            }
            video_pipe_push_f64_key(&mut line, "x", video_json_f64(transform, "x", 0.0), 0.0);
            video_pipe_push_f64_key(&mut line, "y", video_json_f64(transform, "y", 0.0), 0.0);
            video_pipe_push_f64_key(&mut line, "scale", video_json_f64(transform, "scale", 1.0), 1.0);
            video_pipe_push_f64_key(
                &mut line,
                "opacity",
                video_json_f64(transform, "opacity", 1.0),
                1.0,
            );
            output.push_str(&line);
            output.push('\n');
        }
    }

    Ok(output)
}

fn video_project_load_value(project_path: &std::path::Path) -> Result<serde_json::Value, String> {
    let raw = std::fs::read_to_string(project_path)
        .map_err(|error| format!("Unable to read video project: {error}"))?;
    let mut project = if video_project_path_is_pipe(project_path) {
        video_pipe_parse_project(&raw).map_err(|error| format!("Unable to parse video project: {error}"))?
    } else {
        serde_json::from_str::<serde_json::Value>(&raw)
            .map_err(|error| format!("Unable to parse video project: {error}"))?
    };
    let updated_at_ms = std::fs::metadata(project_path)
        .ok()
        .as_ref()
        .map(video_file_modified_ms)
        .unwrap_or(0);
    if let Some(object) = project.as_object_mut() {
        object.insert("updatedAtMs".to_string(), serde_json::json!(updated_at_ms));
    }
    Ok(project)
}

fn video_project_summary_name(path: &std::path::Path, fallback: &str) -> String {
    let Some(raw) = std::fs::read_to_string(path).ok() else {
        return fallback.to_string();
    };
    let parsed = if video_project_path_is_pipe(path) {
        video_pipe_parse_project(&raw).ok()
    } else {
        serde_json::from_str::<serde_json::Value>(&raw).ok()
    };
    parsed
        .and_then(|value| {
            value
                .get("name")
                .and_then(|name| name.as_str())
                .map(|name| name.to_string())
        })
        .unwrap_or_else(|| fallback.to_string())
}

#[tauri::command]
async fn video_projects_list(repo_path: String) -> Result<VideoProjectsListResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let mut projects_by_slug: std::collections::HashMap<String, (bool, VideoProjectSummary)> =
            std::collections::HashMap::new();
        let project_dir = media_root.join(VIDEO_PROJECTS_DIR);
        if let Ok(entries) = std::fs::read_dir(&project_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() || !video_project_path_has_supported_extension(&path) {
                    continue;
                }
                let Some(file_name) = video_project_file_name(&path) else {
                    continue;
                };
                let Some(slug) = video_project_slug_from_file_name(file_name) else {
                    continue;
                };
                let metadata = std::fs::metadata(&path).ok();
                let updated_at_ms = metadata.as_ref().map(video_file_modified_ms).unwrap_or(0);
                let is_pipe = video_project_path_is_pipe(&path);
                let summary = VideoProjectSummary {
                    name: video_project_summary_name(&path, &slug),
                    path: video_relative_path(&root, &path),
                    updated_at_ms,
                };
                match projects_by_slug.get(&slug) {
                    Some((existing_is_pipe, existing))
                        if *existing_is_pipe || (!is_pipe && existing.updated_at_ms >= updated_at_ms) => {}
                    _ => {
                        projects_by_slug.insert(slug, (is_pipe, summary));
                    }
                }
            }
        }
        let mut projects = projects_by_slug
            .into_values()
            .map(|(_, summary)| summary)
            .collect::<Vec<_>>();
        projects.sort_by(|left, right| right.updated_at_ms.cmp(&left.updated_at_ms));
        Ok(VideoProjectsListResponse { projects })
    })
    .await
    .map_err(|error| format!("Video projects list worker failed: {error}"))?
}

#[tauri::command]
async fn video_project_create(repo_path: String, name: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let projects_dir = media_root.join(VIDEO_PROJECTS_DIR);
        let slug = video_slugify_with_fallback(name.as_str(), "project");
        let mut index = 0u32;
        let project_path = loop {
            let project_slug = if index == 0 {
                slug.clone()
            } else {
                format!("{slug}-{index}")
            };
            let candidate = projects_dir.join(format!("{project_slug}{VIDEO_PROJECT_EXTENSION}"));
            let legacy_candidate =
                projects_dir.join(format!("{project_slug}{VIDEO_PROJECT_LEGACY_EXTENSION}"));
            if !candidate.exists() && !legacy_candidate.exists() {
                break candidate;
            }
            index += 1;
        };
        let project_slug = project_path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(video_project_slug_from_file_name)
            .unwrap_or_else(|| slug.clone());
        let mut project = serde_json::json!({
            "version": 1,
            "name": project_slug,
            "settings": {
                "width": 1920,
                "height": 1080,
                "fps": 30,
                "background": "#000000",
            },
            "tracks": [
                { "id": "v1", "kind": "video", "label": "V1", "muted": false, "locked": false, "clips": [] },
                { "id": "a1", "kind": "audio", "label": "A1", "muted": false, "locked": false, "clips": [] },
                { "id": "t1", "kind": "text", "label": "T1", "muted": false, "locked": false, "clips": [] },
            ],
            "updatedAtMs": 0,
        });
        let raw = video_pipe_serialize_project(&project)?;
        std::fs::write(&project_path, raw)
            .map_err(|error| format!("Unable to create video project: {error}"))?;
        let updated_at_ms = std::fs::metadata(&project_path)
            .ok()
            .as_ref()
            .map(video_file_modified_ms)
            .unwrap_or_else(video_now_millis);
        if let Some(object) = project.as_object_mut() {
            object.insert("updatedAtMs".to_string(), serde_json::json!(updated_at_ms));
        }
        Ok(serde_json::json!({
            "project": project,
            "path": video_relative_path(&root, &project_path),
        }))
    })
    .await
    .map_err(|error| format!("Video project create worker failed: {error}"))?
}

#[tauri::command]
async fn video_project_read(
    repo_path: String,
    project_path: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let abs = video_resolve_project_abs(&root, &media_root, project_path.as_str())?;
        let project = video_project_load_value(&abs)?;
        Ok(serde_json::json!({
            "project": project,
            "path": video_relative_path(&root, &abs),
        }))
    })
    .await
    .map_err(|error| format!("Video project read worker failed: {error}"))?
}

#[tauri::command]
async fn video_project_write(
    repo_path: String,
    project_path: String,
    project: serde_json::Value,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let abs = video_resolve_project_abs(&root, &media_root, project_path.as_str())?;
        if !project.is_object() {
            return Err("Video project must be a JSON object.".to_string());
        }
        let target_abs = video_project_pipe_sibling_path(&abs);
        let raw = video_pipe_serialize_project(&project)?;
        let temp_path = video_project_temp_sibling_path(&target_abs);
        std::fs::write(&temp_path, raw)
            .map_err(|error| format!("Unable to write video project: {error}"))?;
        std::fs::rename(&temp_path, &target_abs)
            .map_err(|error| format!("Unable to finalize video project: {error}"))?;
        if abs != target_abs && abs.exists() {
            std::fs::remove_file(&abs)
                .map_err(|error| format!("Unable to remove legacy video project: {error}"))?;
        }
        let updated_at_ms = std::fs::metadata(&target_abs)
            .ok()
            .as_ref()
            .map(video_file_modified_ms)
            .unwrap_or_else(video_now_millis);
        Ok(serde_json::json!({
            "ok": true,
            "updatedAtMs": updated_at_ms,
            "path": video_relative_path(&root, &target_abs),
        }))
    })
    .await
    .map_err(|error| format!("Video project write worker failed: {error}"))?
}

#[tauri::command]
async fn video_project_delete(repo_path: String, project_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let abs = video_resolve_project_abs(&root, &media_root, project_path.as_str())?;
        std::fs::remove_file(&abs)
            .map_err(|error| format!("Unable to delete video project: {error}"))
    })
    .await
    .map_err(|error| format!("Video project delete worker failed: {error}"))?
}

fn video_json_f64(value: &serde_json::Value, key: &str, default: f64) -> f64 {
    value
        .get(key)
        .and_then(|value| value.as_f64().or_else(|| value.as_i64().map(|value| value as f64)))
        .filter(|value| value.is_finite())
        .unwrap_or(default)
}

fn video_json_u64(value: &serde_json::Value, key: &str, default: u64) -> u64 {
    value.get(key).and_then(|value| value.as_u64()).unwrap_or(default)
}

fn video_json_string(value: &serde_json::Value, key: &str, default: &str) -> String {
    value
        .get(key)
        .and_then(|value| value.as_str())
        .unwrap_or(default)
        .to_string()
}

fn video_export_probe_has_audio(ffprobe_path: Option<&str>, abs_path: &std::path::Path, kind: &str) -> bool {
    if kind == "audio" {
        return true;
    }
    ffprobe_path
        .and_then(|path| video_probe_media(path, abs_path))
        .and_then(|probe| probe.has_audio)
        .unwrap_or(false)
}

fn video_collect_export_clips(
    root: &std::path::Path,
    media_root: &std::path::Path,
    project: &serde_json::Value,
    ffprobe_path: Option<&str>,
) -> Result<(Vec<VideoExportMediaClip>, Vec<VideoExportTextClip>, u64), String> {
    let mut media_clips = Vec::new();
    let mut text_clips = Vec::new();
    let mut total_ms = 0u64;
    let tracks = project
        .get("tracks")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "Video project tracks must be an array.".to_string())?;
    for track in tracks {
        let track_kind = video_json_string(track, "kind", "");
        let muted = track.get("muted").and_then(|value| value.as_bool()).unwrap_or(false);
        let clips = track
            .get("clips")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        let mut clips_sorted = clips;
        clips_sorted.sort_by_key(|clip| video_json_u64(clip, "timelineStartMs", 0));
        for clip in clips_sorted {
            let start = video_json_u64(&clip, "timelineStartMs", 0);
            let duration = video_json_u64(&clip, "durationMs", 0);
            if duration == 0 {
                continue;
            }
            total_ms = total_ms.max(start.saturating_add(duration));
            if track_kind == "text" {
                let style = clip.get("style").unwrap_or(&serde_json::Value::Null);
                text_clips.push(VideoExportTextClip {
                    text: video_json_string(&clip, "text", ""),
                    timeline_start_ms: start,
                    duration_ms: duration,
                    font_size: video_json_f64(style, "fontSize", 48.0).clamp(1.0, 512.0),
                    color: video_json_string(style, "color", "#ffffff"),
                    background: style
                        .get("background")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                        .filter(|value| !value.trim().is_empty()),
                    outline_color: video_json_string(style, "outlineColor", "#000000"),
                    outline_width: video_json_f64(style, "outlineWidth", 0.0).clamp(0.0, 64.0),
                    shadow: style.get("shadow").and_then(|value| value.as_bool()).unwrap_or(false),
                    uppercase: style
                        .get("uppercase")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false),
                    x: video_json_f64(style, "x", 0.5).clamp(0.0, 1.0),
                    y: video_json_f64(style, "y", 0.5).clamp(0.0, 1.0),
                });
                continue;
            }
            let Some(asset_path) = clip.get("assetPath").and_then(|value| value.as_str()) else {
                continue;
            };
            let abs = video_resolve_media_abs(root, media_root, asset_path)?;
            let Some(kind) = video_media_kind_for_extension(&abs) else {
                continue;
            };
            let transform = clip.get("transform").unwrap_or(&serde_json::Value::Null);
            let gain = clip.get("gain").unwrap_or(&serde_json::Value::Null);
            let mut gain_keyframes = Vec::new();
            if let Some(keyframes) = gain.get("keyframes").and_then(|value| value.as_array()) {
                for keyframe in keyframes {
                    gain_keyframes.push((
                        video_json_u64(keyframe, "atMs", 0),
                        video_json_f64(keyframe, "level", 1.0).max(0.0),
                    ));
                }
                gain_keyframes.sort_by_key(|(at_ms, _)| *at_ms);
            }
            media_clips.push(VideoExportMediaClip {
                input_index: media_clips.len(),
                kind: kind.to_string(),
                abs_path: abs.clone(),
                timeline_start_ms: start,
                duration_ms: duration,
                source_in_ms: video_json_u64(&clip, "sourceInMs", 0),
                speed: video_json_f64(&clip, "speed", 1.0).clamp(0.05, 100.0),
                gain_level: video_json_f64(gain, "level", 1.0).max(0.0),
                gain_keyframes,
                x: video_json_f64(transform, "x", 0.0).clamp(-4.0, 4.0),
                y: video_json_f64(transform, "y", 0.0).clamp(-4.0, 4.0),
                scale: video_json_f64(transform, "scale", 1.0).clamp(0.01, 20.0),
                opacity: video_json_f64(transform, "opacity", 1.0).clamp(0.0, 1.0),
                has_audio: !muted && video_export_probe_has_audio(ffprobe_path, &abs, kind),
            });
        }
    }
    Ok((media_clips, text_clips, total_ms))
}

fn video_ffmpeg_seconds(ms: u64) -> String {
    format!("{:.6}", ms as f64 / 1000.0)
}

fn video_ffmpeg_number(value: f64) -> String {
    if value.fract().abs() < 0.000001 {
        format!("{value:.0}")
    } else {
        format!("{value:.6}")
    }
}

fn video_escape_drawtext(value: &str) -> String {
    let mut escaped = String::new();
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '\'' => escaped.push_str("\\'"),
            ':' => escaped.push_str("\\:"),
            '%' => escaped.push_str("\\%"),
            ',' => escaped.push_str("\\,"),
            '\n' | '\r' => escaped.push(' '),
            _ => escaped.push(ch),
        }
    }
    escaped
}

fn video_escape_filter_color(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.starts_with('#') && (trimmed.len() == 7 || trimmed.len() == 4) {
        trimmed.to_string()
    } else {
        fallback.to_string()
    }
}

fn video_parse_background_for_box(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.eq_ignore_ascii_case("transparent") {
        return None;
    }
    if trimmed.starts_with('#') && trimmed.len() == 7 {
        return Some(format!("{trimmed}@0.65"));
    }
    if trimmed.to_ascii_lowercase().starts_with("rgba(") && trimmed.ends_with(')') {
        let inner = &trimmed[5..trimmed.len() - 1];
        let parts = inner.split(',').map(|part| part.trim()).collect::<Vec<_>>();
        if parts.len() == 4 {
            let r = parts[0].parse::<u8>().ok()?;
            let g = parts[1].parse::<u8>().ok()?;
            let b = parts[2].parse::<u8>().ok()?;
            let a = parts[3].parse::<f64>().ok()?.clamp(0.0, 1.0);
            return Some(format!("#{r:02x}{g:02x}{b:02x}@{a:.3}"));
        }
    }
    None
}

fn video_atempo_chain(speed: f64) -> Vec<String> {
    if (speed - 1.0).abs() < 0.0001 {
        return Vec::new();
    }
    let mut remaining = speed;
    let mut filters = Vec::new();
    while remaining > 2.0 {
        filters.push("atempo=2.0".to_string());
        remaining /= 2.0;
    }
    while remaining < 0.5 {
        filters.push("atempo=0.5".to_string());
        remaining /= 0.5;
    }
    filters.push(format!("atempo={}", video_ffmpeg_number(remaining)));
    filters
}

fn video_gain_expression(level: f64, keyframes: &[(u64, f64)]) -> String {
    if keyframes.is_empty() {
        return video_ffmpeg_number(level);
    }
    if keyframes.len() == 1 {
        return video_ffmpeg_number(level * keyframes[0].1);
    }
    let mut expr = video_ffmpeg_number(level * keyframes.last().map(|(_, value)| *value).unwrap_or(1.0));
    for pair in keyframes.windows(2).rev() {
        let (start_ms, start_level) = pair[0];
        let (end_ms, end_level) = pair[1];
        let start_s = start_ms as f64 / 1000.0;
        let end_s = end_ms as f64 / 1000.0;
        let span = (end_s - start_s).max(0.001);
        let segment = format!(
            "({}+({}-{})*(t-{})/{})",
            video_ffmpeg_number(level * start_level),
            video_ffmpeg_number(level * end_level),
            video_ffmpeg_number(level * start_level),
            video_ffmpeg_number(start_s),
            video_ffmpeg_number(span)
        );
        expr = format!(
            "if(lt(t,{}),{},if(lt(t,{}),{},{}))",
            video_ffmpeg_number(start_s),
            video_ffmpeg_number(level * start_level),
            video_ffmpeg_number(end_s),
            segment,
            expr
        );
    }
    expr.replace(',', "\\,")
}

fn video_build_export_filter(
    project: &serde_json::Value,
    media_clips: &[VideoExportMediaClip],
    text_clips: &[VideoExportTextClip],
    total_ms: u64,
    width: u32,
    height: u32,
    fps: f64,
) -> (String, String, String) {
    let duration = video_ffmpeg_seconds(total_ms);
    let background = project
        .get("settings")
        .and_then(|settings| settings.get("background"))
        .and_then(|value| value.as_str())
        .map(|value| video_escape_filter_color(value, "#000000"))
        .unwrap_or_else(|| "#000000".to_string());
    let mut parts = Vec::new();
    parts.push(format!(
        "color=c={}:s={}x{}:r={}:d={}[base]",
        background,
        width,
        height,
        video_ffmpeg_number(fps),
        duration
    ));
    let mut previous = "base".to_string();
    let mut overlay_index = 0usize;
    for clip in media_clips
        .iter()
        .filter(|clip| matches!(clip.kind.as_str(), "video" | "image"))
    {
        let label = format!("v{overlay_index}");
        let source_duration = (clip.duration_ms as f64 / 1000.0) * clip.speed;
        let target_width = ((width as f64) * clip.scale).round().max(1.0);
        let target_height = ((height as f64) * clip.scale).round().max(1.0);
        let mut filters = if clip.kind == "image" {
            vec![
                format!("[{}:v]scale=w={}:h={}:force_original_aspect_ratio=decrease", clip.input_index, target_width, target_height),
                "format=yuva420p".to_string(),
            ]
        } else {
            vec![
                format!("[{}:v]trim=start={}:duration={}", clip.input_index, video_ffmpeg_seconds(clip.source_in_ms), video_ffmpeg_number(source_duration)),
                format!("setpts=(PTS-STARTPTS)/{}", video_ffmpeg_number(clip.speed)),
                format!("scale=w={}:h={}:force_original_aspect_ratio=decrease", target_width, target_height),
                "format=yuva420p".to_string(),
            ]
        };
        if clip.opacity < 0.999 {
            filters.push(format!("colorchannelmixer=aa={}", video_ffmpeg_number(clip.opacity)));
        }
        filters.push(format!("setpts=PTS+{}/TB", video_ffmpeg_seconds(clip.timeline_start_ms)));
        let chain = format!("{}[{}]", filters.join(","), label);
        parts.push(chain);
        let output = format!("o{overlay_index}");
        let start = video_ffmpeg_seconds(clip.timeline_start_ms);
        let end = video_ffmpeg_seconds(clip.timeline_start_ms.saturating_add(clip.duration_ms));
        parts.push(format!(
            "[{}][{}]overlay=x='(W-w)/2+{}*W':y='(H-h)/2+{}*H':enable='between(t,{},{})'[{}]",
            previous,
            label,
            video_ffmpeg_number(clip.x),
            video_ffmpeg_number(clip.y),
            start,
            end,
            output
        ));
        previous = output;
        overlay_index += 1;
    }
    for (index, clip) in text_clips.iter().enumerate() {
        let output = format!("txt{index}");
        let text = if clip.uppercase {
            clip.text.to_uppercase()
        } else {
            clip.text.clone()
        };
        let mut draw = format!(
            "[{}]drawtext=text='{}':fontsize={}:fontcolor={}:x=(w-text_w)*{}:y=(h-text_h)*{}:enable='between(t,{},{})'",
            previous,
            video_escape_drawtext(&text),
            video_ffmpeg_number(clip.font_size),
            video_escape_filter_color(&clip.color, "#ffffff"),
            video_ffmpeg_number(clip.x),
            video_ffmpeg_number(clip.y),
            video_ffmpeg_seconds(clip.timeline_start_ms),
            video_ffmpeg_seconds(clip.timeline_start_ms.saturating_add(clip.duration_ms)),
        );
        if clip.outline_width > 0.0 {
            draw.push_str(&format!(
                ":borderw={}:bordercolor={}",
                video_ffmpeg_number(clip.outline_width),
                video_escape_filter_color(&clip.outline_color, "#000000")
            ));
        }
        if clip.shadow {
            draw.push_str(":shadowcolor=black@0.6:shadowx=2:shadowy=2");
        }
        if let Some(background) = clip
            .background
            .as_deref()
            .and_then(video_parse_background_for_box)
        {
            draw.push_str(&format!(":box=1:boxcolor={}:boxborderw=8", background));
        }
        draw.push_str(&format!("[{output}]"));
        parts.push(draw);
        previous = output;
    }
    let video_output = if previous == "base" {
        "vout".to_string()
    } else {
        "vout".to_string()
    };
    if previous != video_output {
        parts.push(format!("[{}]format=yuv420p[{}]", previous, video_output));
    }

    let mut audio_labels = Vec::new();
    for (index, clip) in media_clips
        .iter()
        .filter(|clip| clip.has_audio && clip.kind != "image")
        .enumerate()
    {
        let mut filters = vec![
            format!(
                "[{}:a]atrim=start={}:duration={}",
                clip.input_index,
                video_ffmpeg_seconds(clip.source_in_ms),
                video_ffmpeg_number((clip.duration_ms as f64 / 1000.0) * clip.speed)
            ),
            "asetpts=PTS-STARTPTS".to_string(),
        ];
        filters.extend(video_atempo_chain(clip.speed));
        if clip.gain_keyframes.is_empty() {
            filters.push(format!("volume={}", video_ffmpeg_number(clip.gain_level)));
        } else {
            filters.push(format!(
                "volume='{}':eval=frame",
                video_gain_expression(clip.gain_level, &clip.gain_keyframes)
            ));
        }
        filters.push(format!(
            "adelay={}|{}",
            clip.timeline_start_ms, clip.timeline_start_ms
        ));
        filters.push("apad".to_string());
        let label = format!("a{index}");
        parts.push(format!("{}[{}]", filters.join(","), label));
        audio_labels.push(label);
    }
    let audio_output = "aout".to_string();
    if audio_labels.is_empty() {
        parts.push(format!(
            "anullsrc=r=48000:cl=stereo,atrim=duration={}[{}]",
            duration, audio_output
        ));
    } else {
        let inputs = audio_labels
            .iter()
            .map(|label| format!("[{label}]"))
            .collect::<String>();
        parts.push(format!(
            "{}amix=inputs={}:duration=longest:normalize=0[{}]",
            inputs,
            audio_labels.len(),
            audio_output
        ));
    }

    (parts.join(";"), video_output, audio_output)
}

fn video_export_output_path(
    media_root: &std::path::Path,
    project: &serde_json::Value,
    options: &VideoExportOptions,
) -> std::path::PathBuf {
    let format = options
        .format
        .as_deref()
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| value == "webm" || value == "mp4")
        .unwrap_or_else(|| "mp4".to_string());
    let file_name = options
        .file_name
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| video_safe_file_stem(value.trim_end_matches(".mp4").trim_end_matches(".webm"), "export"))
        .unwrap_or_else(|| {
            let project_name = project
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("project");
            format!("{}-{}", video_safe_file_stem(project_name, "project"), video_now_millis())
        });
    media_root
        .join(VIDEO_EXPORTS_DIR)
        .join(format!("{file_name}.{format}"))
}

fn video_emit_export_progress(
    app: &tauri::AppHandle,
    job_id: &str,
    state: &str,
    percent: Option<f64>,
    out_time_ms: Option<u64>,
    total_ms: Option<u64>,
    message: &str,
    done: bool,
    error: Option<&str>,
    output_path: Option<&str>,
) {
    let _ = app.emit(
        VIDEO_EXPORT_PROGRESS_EVENT,
        serde_json::json!({
            "jobId": job_id,
            "state": state,
            "percent": percent,
            "outTimeMs": out_time_ms,
            "totalMs": total_ms,
            "message": message,
            "done": done,
            "error": error,
            "outputPath": output_path,
        }),
    );
}

fn video_parse_ffmpeg_progress_ms(line: &str) -> Option<u64> {
    if let Some(value) = line.strip_prefix("out_time_ms=") {
        return value.trim().parse::<u64>().ok().map(|value| value / 1000);
    }
    if let Some(value) = line.strip_prefix("out_time=") {
        let parts = value.trim().split(':').collect::<Vec<_>>();
        if parts.len() == 3 {
            let hours = parts[0].parse::<f64>().ok()?;
            let minutes = parts[1].parse::<f64>().ok()?;
            let seconds = parts[2].parse::<f64>().ok()?;
            return Some(((hours * 3600.0 + minutes * 60.0 + seconds) * 1000.0) as u64);
        }
    }
    None
}

fn video_run_export_blocking(
    app: tauri::AppHandle,
    job_id: String,
    repo_path: String,
    project_path: String,
    options: VideoExportOptions,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    let _span = BackendCpuSpan::new("video_export");
    let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
    video_ensure_media_dirs(&media_root)?;
    let status = video_tools_status_for(&app);
    let ffmpeg_path = status
        .ffmpeg
        .path
        .ok_or_else(|| "ffmpeg is required to export video projects.".to_string())?;
    let project_abs = video_resolve_project_abs(&root, &media_root, project_path.as_str())?;
    let project = video_project_load_value(&project_abs)?;
    let settings = project.get("settings").unwrap_or(&serde_json::Value::Null);
    let width = options
        .width
        .unwrap_or_else(|| video_json_u64(settings, "width", 1920) as u32)
        .clamp(16, 7680);
    let height = options
        .height
        .unwrap_or_else(|| video_json_u64(settings, "height", 1080) as u32)
        .clamp(16, 4320);
    let fps = options
        .fps
        .unwrap_or_else(|| video_json_f64(settings, "fps", 30.0))
        .clamp(1.0, 240.0);
    let format = options
        .format
        .as_deref()
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| value == "mp4" || value == "webm")
        .unwrap_or_else(|| "mp4".to_string());
    let crf = options.crf.unwrap_or(if format == "webm" { 32 } else { 23 }).clamp(0, 63);
    let preset = options
        .preset
        .as_deref()
        .unwrap_or("medium")
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-')
        .take(32)
        .collect::<String>();
    let preset = if preset.is_empty() { "medium".to_string() } else { preset };
    let (media_clips, text_clips, total_ms) =
        video_collect_export_clips(&root, &media_root, &project, status.ffprobe.path.as_deref())?;
    if total_ms == 0 {
        return Err("Video project has no clips to export.".to_string());
    }
    let output_abs = video_export_output_path(&media_root, &project, &options);
    if let Some(parent) = output_abs.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create video exports directory: {error}"))?;
    }
    let (filter_complex, video_output, audio_output) =
        video_build_export_filter(&project, &media_clips, &text_clips, total_ms, width, height, fps);
    let mut args: Vec<String> = Vec::new();
    for clip in &media_clips {
        if clip.kind == "image" {
            args.extend([
                "-loop".to_string(),
                "1".to_string(),
                "-t".to_string(),
                video_ffmpeg_seconds(clip.duration_ms),
            ]);
        }
        args.push("-i".to_string());
        args.push(clip.abs_path.to_string_lossy().to_string());
    }
    args.extend([
        "-filter_complex".to_string(),
        filter_complex,
        "-map".to_string(),
        format!("[{video_output}]"),
        "-map".to_string(),
        format!("[{audio_output}]"),
    ]);
    if format == "webm" {
        args.extend([
            "-c:v".to_string(),
            "libvpx-vp9".to_string(),
            "-crf".to_string(),
            crf.to_string(),
            "-b:v".to_string(),
            "0".to_string(),
            "-c:a".to_string(),
            "libopus".to_string(),
        ]);
    } else {
        args.extend([
            "-c:v".to_string(),
            "libx264".to_string(),
            "-preset".to_string(),
            preset,
            "-crf".to_string(),
            crf.to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "192k".to_string(),
            "-movflags".to_string(),
            "+faststart".to_string(),
        ]);
    }
    args.extend([
        "-r".to_string(),
        video_ffmpeg_number(fps),
        "-t".to_string(),
        video_ffmpeg_seconds(total_ms),
        "-progress".to_string(),
        "pipe:1".to_string(),
        "-nostats".to_string(),
        "-y".to_string(),
        output_abs.to_string_lossy().to_string(),
    ]);
    video_emit_export_progress(
        &app,
        &job_id,
        "rendering",
        Some(0.0),
        Some(0),
        Some(total_ms),
        "Rendering video.",
        false,
        None,
        None,
    );
    let mut child = std::process::Command::new(&ffmpeg_path)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to start ffmpeg export: {error}"))?;
    let stderr_lines = std::sync::Arc::new(std::sync::Mutex::new(std::collections::VecDeque::<String>::new()));
    if let Some(stderr) = child.stderr.take() {
        let stderr_lines_for_thread = stderr_lines.clone();
        std::thread::spawn(move || {
            use std::io::BufRead as _;
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines().flatten() {
                if let Ok(mut lines) = stderr_lines_for_thread.lock() {
                    lines.push_back(line);
                    while lines.len() > 40 {
                        lines.pop_front();
                    }
                }
            }
        });
    }
    let mut cancelled = false;
    let mut last_emit = std::time::Instant::now();
    if let Some(stdout) = child.stdout.take() {
        use std::io::BufRead as _;
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if cancel.load(std::sync::atomic::Ordering::Acquire) {
                let _ = child.kill();
                cancelled = true;
                break;
            }
            if let Some(out_ms) = video_parse_ffmpeg_progress_ms(&line) {
                if last_emit.elapsed() >= std::time::Duration::from_millis(VIDEO_EXPORT_PROGRESS_INTERVAL_MS) {
                    let percent = ((out_ms as f64 / total_ms as f64) * 100.0).clamp(0.0, 100.0);
                    video_emit_export_progress(
                        &app,
                        &job_id,
                        "rendering",
                        Some(percent),
                        Some(out_ms.min(total_ms)),
                        Some(total_ms),
                        "Rendering video.",
                        false,
                        None,
                        None,
                    );
                    last_emit = std::time::Instant::now();
                }
            }
        }
    }
    let status = child
        .wait()
        .map_err(|error| format!("Unable to wait for ffmpeg export: {error}"))?;
    if cancelled || cancel.load(std::sync::atomic::Ordering::Acquire) {
        let _ = std::fs::remove_file(&output_abs);
        video_emit_export_progress(
            &app,
            &job_id,
            "cancelled",
            Some(100.0),
            None,
            Some(total_ms),
            "Video export cancelled.",
            true,
            None,
            None,
        );
        return Ok(());
    }
    if !status.success() {
        let detail = stderr_lines
            .lock()
            .ok()
            .map(|lines| lines.iter().cloned().collect::<Vec<_>>().join("\n"))
            .unwrap_or_default();
        return Err(if detail.is_empty() {
            "ffmpeg export failed.".to_string()
        } else {
            format!("ffmpeg export failed: {detail}")
        });
    }
    let output_rel = video_relative_path(&root, &output_abs);
    video_emit_export_progress(
        &app,
        &job_id,
        "done",
        Some(100.0),
        Some(total_ms),
        Some(total_ms),
        "Video export finished.",
        true,
        None,
        Some(&output_rel),
    );
    let _ = app.emit(
        VIDEO_STORE_CHANGED_EVENT,
        serde_json::json!({
            "repoPath": root.to_string_lossy().to_string(),
            "paths": [output_rel],
            "changedAtMs": video_now_millis(),
        }),
    );
    Ok(())
}

async fn video_export_worker(
    app: tauri::AppHandle,
    job_id: String,
    repo_path: String,
    project_path: String,
    options: VideoExportOptions,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    video_emit_export_progress(
        &app,
        &job_id,
        "starting",
        Some(0.0),
        None,
        None,
        "Preparing video export.",
        false,
        None,
        None,
    );
    let app_for_worker = app.clone();
    let job_for_worker = job_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        video_run_export_blocking(app_for_worker, job_for_worker, repo_path, project_path, options, cancel)
    })
    .await
    .map_err(|error| format!("Video export worker failed: {error}"))
    .and_then(|value| value);
    if let Err(error) = result {
        video_emit_export_progress(
            &app,
            &job_id,
            "error",
            Some(100.0),
            None,
            None,
            &error,
            true,
            Some(&error),
            None,
        );
    }
    video_job_registry_remove(&VIDEO_EXPORT_JOBS, &job_id);
}

#[tauri::command]
async fn video_export_start(
    app: tauri::AppHandle,
    repo_path: String,
    project_path: String,
    options: VideoExportOptions,
) -> Result<VideoJobStartResult, String> {
    let (job_id, cancel) = video_job_registry_insert(&VIDEO_EXPORT_JOBS)?;
    tauri::async_runtime::spawn(video_export_worker(
        app,
        job_id.clone(),
        repo_path,
        project_path,
        options,
        cancel,
    ));
    Ok(VideoJobStartResult { job_id })
}

#[tauri::command]
fn video_export_cancel(job_id: String) -> Result<(), String> {
    video_job_registry_cancel(&VIDEO_EXPORT_JOBS, &job_id)
}

fn video_provider_definition(provider_id: &str) -> Option<&'static VideoProviderDefinition> {
    VIDEO_GENERATION_PROVIDERS
        .iter()
        .find(|provider| provider.id == provider_id)
}

fn video_provider_base_url(provider: &VideoProviderDefinition, auth: &Option<VideoProviderAuth>) -> String {
    auth.as_ref()
        .and_then(|auth| auth.base_url.as_deref())
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| provider.default_base_url.to_string())
}

fn video_auth_api_key(auth: &Option<VideoProviderAuth>) -> Result<String, String> {
    auth.as_ref()
        .and_then(|auth| auth.api_key.as_deref())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Provider API key is required.".to_string())
}

fn video_auth_secret_key(auth: &Option<VideoProviderAuth>) -> Result<String, String> {
    auth.as_ref()
        .and_then(|auth| auth.secret_key.as_deref())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Provider secret key is required.".to_string())
}

fn video_http_body_excerpt(body: &str) -> String {
    body.chars().take(300).collect::<String>()
}

async fn video_response_json(response: reqwest::Response, label: &str) -> Result<serde_json::Value, String> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("{label} response could not be read: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "{label} returned HTTP {}: {}",
            status,
            video_http_body_excerpt(&body)
        ));
    }
    serde_json::from_str::<serde_json::Value>(&body).map_err(|error| {
        format!(
            "{label} returned invalid JSON: {error}; body: {}",
            video_http_body_excerpt(&body)
        )
    })
}

fn video_json_path_string<'a>(value: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    let mut current = value;
    for key in keys {
        current = current.get(*key)?;
    }
    current.as_str()
}

fn video_asset_data_uri(
    root: &std::path::Path,
    media_root: &std::path::Path,
    input_path: &str,
) -> Result<(String, String, String, Vec<u8>), String> {
    use base64::Engine as _;
    let abs = video_resolve_media_abs(root, media_root, input_path)?;
    let bytes = std::fs::read(&abs).map_err(|error| format!("Unable to read input asset: {error}"))?;
    let mime = video_mime_for_path(&abs).to_string();
    let base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok((format!("data:{mime};base64,{base64}"), base64, mime, bytes))
}

fn video_emit_generate_progress(
    app: &tauri::AppHandle,
    job_id: &str,
    provider_id: &str,
    state: &str,
    percent: Option<f64>,
    message: &str,
    done: bool,
    error: Option<&str>,
    output_paths: &[String],
) {
    let _ = app.emit(
        VIDEO_GENERATE_PROGRESS_EVENT,
        serde_json::json!({
            "jobId": job_id,
            "providerId": provider_id,
            "state": state,
            "percent": percent,
            "message": message,
            "done": done,
            "error": error,
            "outputPaths": output_paths,
        }),
    );
}

async fn video_poll_sleep(cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>) -> Result<(), String> {
    for _ in 0..30 {
        if cancel.load(std::sync::atomic::Ordering::Acquire) {
            return Err("Video generation cancelled.".to_string());
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Ok(())
}

async fn video_download_generated_url(
    app: &tauri::AppHandle,
    job_id: &str,
    provider_id: &str,
    client: &reqwest::Client,
    url: &str,
    generated_dir: &std::path::Path,
    root: &std::path::Path,
    index: usize,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<String, String> {
    use std::io::Write as _;
    video_emit_generate_progress(
        app,
        job_id,
        provider_id,
        "downloading",
        None,
        "Downloading generated media.",
        false,
        None,
        &[],
    );
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Unable to download generated media: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Generated media download returned HTTP {}.",
            response.status()
        ));
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let extension = reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .path_segments()
                .and_then(|mut segments| segments.next_back())
                .and_then(|name| std::path::Path::new(name).extension())
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.trim_matches('.').to_ascii_lowercase())
        })
        .filter(|ext| !ext.is_empty() && ext.len() <= 8)
        .unwrap_or_else(|| video_extension_for_mime(&mime).to_string());
    std::fs::create_dir_all(generated_dir)
        .map_err(|error| format!("Unable to create generated media directory: {error}"))?;
    let output = generated_dir.join(format!(
        "{}-{}-{}.{}",
        provider_id,
        video_now_millis(),
        index + 1,
        extension
    ));
    let temp = output.with_extension(format!("{extension}.download"));
    let mut file = std::fs::File::create(&temp)
        .map_err(|error| format!("Unable to write generated media: {error}"))?;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Unable to read generated media download: {error}"))?
    {
        if cancel.load(std::sync::atomic::Ordering::Acquire) {
            let _ = std::fs::remove_file(&temp);
            return Err("Video generation cancelled.".to_string());
        }
        file.write_all(&chunk)
            .map_err(|error| format!("Unable to write generated media: {error}"))?;
    }
    file.flush()
        .map_err(|error| format!("Unable to finish generated media write: {error}"))?;
    std::fs::rename(&temp, &output)
        .map_err(|error| format!("Unable to finalize generated media: {error}"))?;
    Ok(video_relative_path(root, &output))
}

fn video_save_generated_bytes(
    provider_id: &str,
    generated_dir: &std::path::Path,
    root: &std::path::Path,
    index: usize,
    extension: &str,
    bytes: &[u8],
) -> Result<String, String> {
    std::fs::create_dir_all(generated_dir)
        .map_err(|error| format!("Unable to create generated media directory: {error}"))?;
    let output = generated_dir.join(format!(
        "{}-{}-{}.{}",
        provider_id,
        video_now_millis(),
        index + 1,
        extension
    ));
    std::fs::write(&output, bytes).map_err(|error| format!("Unable to write generated media: {error}"))?;
    Ok(video_relative_path(root, &output))
}

async fn video_download_provider_urls(
    app: &tauri::AppHandle,
    job_id: &str,
    provider_id: &str,
    client: &reqwest::Client,
    urls: Vec<String>,
    generated_dir: &std::path::Path,
    root: &std::path::Path,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<Vec<String>, String> {
    let mut output_paths = Vec::new();
    for (index, url) in urls.iter().enumerate() {
        output_paths.push(
            video_download_generated_url(
                app,
                job_id,
                provider_id,
                client,
                url,
                generated_dir,
                root,
                index,
                cancel,
            )
            .await?,
        );
    }
    Ok(output_paths)
}

async fn video_generate_higgsfield(
    app: &tauri::AppHandle,
    job_id: &str,
    request: &VideoGenerateRequest,
    provider: &VideoProviderDefinition,
    root: &std::path::Path,
    media_root: &std::path::Path,
    generated_dir: &std::path::Path,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<Vec<String>, String> {
    let client = http_client(std::time::Duration::from_secs(60))?;
    let base = video_provider_base_url(provider, &request.auth);
    let api_key = video_auth_api_key(&request.auth)?;
    let secret = video_auth_secret_key(&request.auth)?;
    let endpoint = if request.mode == "image-to-video" {
        "/v1/image2video"
    } else {
        "/v1/text2video"
    };
    let mut body = serde_json::json!({
        "prompt": request.prompt,
        "duration": request.params.as_ref().and_then(|params| params.duration_sec),
        "seed": request.params.as_ref().and_then(|params| params.seed),
    });
    if request.mode == "image-to-video" {
        let input = request
            .input_asset_paths
            .first()
            .ok_or_else(|| "Higgsfield image-to-video requires an input asset.".to_string())?;
        body["image"] = serde_json::json!(video_asset_data_uri(root, media_root, input)?.0);
    }
    let submit = client
        .post(format!("{base}{endpoint}"))
        .header("hf-api-key", api_key)
        .header("hf-secret", secret)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Unable to submit Higgsfield job: {error}"))?;
    let submit_json = video_response_json(submit, "Higgsfield submit").await?;
    let task_id = video_json_path_string(&submit_json, &["id"])
        .ok_or_else(|| format!("Higgsfield submit response did not include id: {submit_json}"))?
        .to_string();
    let started = std::time::Instant::now();
    loop {
        if started.elapsed() > std::time::Duration::from_secs(VIDEO_GENERATION_TIMEOUT_SECS) {
            return Err("Higgsfield generation timed out.".to_string());
        }
        video_poll_sleep(cancel).await?;
        video_emit_generate_progress(app, job_id, provider.id, "running", None, "Waiting for Higgsfield.", false, None, &[]);
        let poll = client
            .get(format!("{base}/v1/jobs/{task_id}"))
            .header("hf-api-key", video_auth_api_key(&request.auth)?)
            .header("hf-secret", video_auth_secret_key(&request.auth)?)
            .send()
            .await
            .map_err(|error| format!("Unable to poll Higgsfield job: {error}"))?;
        let poll_json = video_response_json(poll, "Higgsfield poll").await?;
        let status = video_json_path_string(&poll_json, &["status"]).unwrap_or_default();
        match status {
            "completed" => {
                let urls = poll_json
                    .get("results")
                    .and_then(|value| value.as_array())
                    .into_iter()
                    .flatten()
                    .filter_map(|item| item.get("url").and_then(|value| value.as_str()))
                    .map(|value| value.to_string())
                    .collect::<Vec<_>>();
                if urls.is_empty() {
                    return Err("Higgsfield job completed without result URLs.".to_string());
                }
                return video_download_provider_urls(app, job_id, provider.id, &client, urls, generated_dir, root, cancel).await;
            }
            "failed" => return Err(format!("Higgsfield job failed: {poll_json}")),
            _ => {}
        }
    }
}

async fn video_generate_seedance(
    app: &tauri::AppHandle,
    job_id: &str,
    request: &VideoGenerateRequest,
    provider: &VideoProviderDefinition,
    root: &std::path::Path,
    media_root: &std::path::Path,
    generated_dir: &std::path::Path,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<Vec<String>, String> {
    let client = http_client(std::time::Duration::from_secs(60))?;
    let base = video_provider_base_url(provider, &request.auth);
    let api_key = video_auth_api_key(&request.auth)?;
    let duration = request
        .params
        .as_ref()
        .and_then(|params| params.duration_sec)
        .unwrap_or(5.0);
    let mut content = vec![serde_json::json!({
        "type": "text",
        "text": format!("{} --duration {}", request.prompt, video_ffmpeg_number(duration)),
    })];
    if request.mode == "image-to-video" {
        let input = request
            .input_asset_paths
            .first()
            .ok_or_else(|| "Seedance image-to-video requires an input asset.".to_string())?;
        content.push(serde_json::json!({
            "type": "image_url",
            "image_url": { "url": video_asset_data_uri(root, media_root, input)?.0 },
        }));
    }
    let submit = client
        .post(format!("{base}/contents/generations/tasks"))
        .bearer_auth(api_key.clone())
        .json(&serde_json::json!({
            "model": if request.model.trim().is_empty() { provider.models[0] } else { request.model.as_str() },
            "content": content,
        }))
        .send()
        .await
        .map_err(|error| format!("Unable to submit Seedance job: {error}"))?;
    let submit_json = video_response_json(submit, "Seedance submit").await?;
    let task_id = video_json_path_string(&submit_json, &["id"])
        .ok_or_else(|| format!("Seedance submit response did not include id: {submit_json}"))?
        .to_string();
    let started = std::time::Instant::now();
    loop {
        if started.elapsed() > std::time::Duration::from_secs(VIDEO_GENERATION_TIMEOUT_SECS) {
            return Err("Seedance generation timed out.".to_string());
        }
        video_poll_sleep(cancel).await?;
        video_emit_generate_progress(app, job_id, provider.id, "running", None, "Waiting for Seedance.", false, None, &[]);
        let poll = client
            .get(format!("{base}/contents/generations/tasks/{task_id}"))
            .bearer_auth(api_key.clone())
            .send()
            .await
            .map_err(|error| format!("Unable to poll Seedance job: {error}"))?;
        let poll_json = video_response_json(poll, "Seedance poll").await?;
        let status = video_json_path_string(&poll_json, &["status"]).unwrap_or_default();
        match status {
            "succeeded" => {
                let url = video_json_path_string(&poll_json, &["content", "video_url"])
                    .ok_or_else(|| "Seedance job succeeded without video_url.".to_string())?
                    .to_string();
                return video_download_provider_urls(app, job_id, provider.id, &client, vec![url], generated_dir, root, cancel).await;
            }
            "failed" => return Err(format!("Seedance job failed: {poll_json}")),
            _ => {}
        }
    }
}

fn video_kling_jwt(api_key: &str, secret_key: &str) -> Result<String, String> {
    use base64::Engine as _;
    use hmac::Mac as _;
    let header = serde_json::json!({"alg":"HS256","typ":"JWT"}).to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("Unable to build Kling JWT: {error}"))?
        .as_secs();
    let claims = serde_json::json!({
        "iss": api_key,
        "exp": now + 1800,
        "nbf": now.saturating_sub(5),
    })
    .to_string();
    let encoder = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let signing_input = format!("{}.{}", encoder.encode(header), encoder.encode(claims));
    let mut mac = hmac::Hmac::<sha2::Sha256>::new_from_slice(secret_key.as_bytes())
        .map_err(|error| format!("Unable to build Kling JWT: {error}"))?;
    mac.update(signing_input.as_bytes());
    let signature = encoder.encode(mac.finalize().into_bytes());
    Ok(format!("{signing_input}.{signature}"))
}

async fn video_generate_kling(
    app: &tauri::AppHandle,
    job_id: &str,
    request: &VideoGenerateRequest,
    provider: &VideoProviderDefinition,
    root: &std::path::Path,
    media_root: &std::path::Path,
    generated_dir: &std::path::Path,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<Vec<String>, String> {
    let client = http_client(std::time::Duration::from_secs(60))?;
    let base = video_provider_base_url(provider, &request.auth);
    let api_key = video_auth_api_key(&request.auth)?;
    let secret = video_auth_secret_key(&request.auth)?;
    let jwt = video_kling_jwt(&api_key, &secret)?;
    let endpoint = if request.mode == "image-to-video" {
        "/v1/videos/image2video"
    } else {
        "/v1/videos/text2video"
    };
    let mut body = serde_json::json!({
        "model_name": if request.model.trim().is_empty() { provider.models[0] } else { request.model.as_str() },
        "prompt": request.prompt,
        "duration": video_ffmpeg_number(request.params.as_ref().and_then(|params| params.duration_sec).unwrap_or(5.0)),
    });
    if request.mode == "image-to-video" {
        let input = request
            .input_asset_paths
            .first()
            .ok_or_else(|| "Kling image-to-video requires an input asset.".to_string())?;
        body["image"] = serde_json::json!(video_asset_data_uri(root, media_root, input)?.1);
    }
    let submit = client
        .post(format!("{base}{endpoint}"))
        .bearer_auth(jwt.clone())
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Unable to submit Kling job: {error}"))?;
    let submit_json = video_response_json(submit, "Kling submit").await?;
    let task_id = video_json_path_string(&submit_json, &["data", "task_id"])
        .ok_or_else(|| format!("Kling submit response did not include task_id: {submit_json}"))?
        .to_string();
    let started = std::time::Instant::now();
    loop {
        if started.elapsed() > std::time::Duration::from_secs(VIDEO_GENERATION_TIMEOUT_SECS) {
            return Err("Kling generation timed out.".to_string());
        }
        video_poll_sleep(cancel).await?;
        video_emit_generate_progress(app, job_id, provider.id, "running", None, "Waiting for Kling.", false, None, &[]);
        let poll = client
            .get(format!("{base}{endpoint}/{task_id}"))
            .bearer_auth(video_kling_jwt(&api_key, &secret)?)
            .send()
            .await
            .map_err(|error| format!("Unable to poll Kling job: {error}"))?;
        let poll_json = video_response_json(poll, "Kling poll").await?;
        let status = video_json_path_string(&poll_json, &["data", "task_status"]).unwrap_or_default();
        match status {
            "succeed" => {
                let urls = poll_json
                    .get("data")
                    .and_then(|data| data.get("task_result"))
                    .and_then(|result| result.get("videos"))
                    .and_then(|value| value.as_array())
                    .into_iter()
                    .flatten()
                    .filter_map(|item| item.get("url").and_then(|value| value.as_str()))
                    .map(|value| value.to_string())
                    .collect::<Vec<_>>();
                if urls.is_empty() {
                    return Err("Kling job succeeded without result URLs.".to_string());
                }
                return video_download_provider_urls(app, job_id, provider.id, &client, urls, generated_dir, root, cancel).await;
            }
            "failed" => return Err(format!("Kling job failed: {poll_json}")),
            _ => {}
        }
    }
}

async fn video_generate_openai_image(
    request: &VideoGenerateRequest,
    provider: &VideoProviderDefinition,
    root: &std::path::Path,
    media_root: &std::path::Path,
    generated_dir: &std::path::Path,
) -> Result<Vec<String>, String> {
    use base64::Engine as _;
    let client = http_client(std::time::Duration::from_secs(120))?;
    let base = video_provider_base_url(provider, &request.auth);
    let api_key = video_auth_api_key(&request.auth)?;
    let response = if request.mode == "image-edit" {
        let input = request
            .input_asset_paths
            .first()
            .ok_or_else(|| "Image edit requires an input asset.".to_string())?;
        let abs = video_resolve_media_abs(root, media_root, input)?;
        let bytes = std::fs::read(&abs).map_err(|error| format!("Unable to read image edit input: {error}"))?;
        let filename = abs
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image.png")
            .to_string();
        let mime = video_mime_for_path(&abs);
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(filename)
            .mime_str(mime)
            .map_err(|error| format!("Unable to prepare image edit upload: {error}"))?;
        let form = reqwest::multipart::Form::new()
            .part("image", part)
            .text("prompt", request.prompt.clone())
            .text("model", if request.model.trim().is_empty() { provider.models[0].to_string() } else { request.model.clone() });
        client
            .post(format!("{base}/v1/images/edits"))
            .bearer_auth(api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|error| format!("Unable to submit OpenAI image edit: {error}"))?
    } else {
        client
            .post(format!("{base}/v1/images/generations"))
            .bearer_auth(api_key)
            .json(&serde_json::json!({
                "model": if request.model.trim().is_empty() { provider.models[0] } else { request.model.as_str() },
                "prompt": request.prompt,
                "size": request.params.as_ref().and_then(|params| params.resolution.as_deref()).unwrap_or("1024x1024"),
            }))
            .send()
            .await
            .map_err(|error| format!("Unable to submit OpenAI image generation: {error}"))?
    };
    let json = video_response_json(response, "OpenAI image").await?;
    let mut outputs = Vec::new();
    for (index, item) in json
        .get("data")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .enumerate()
    {
        if let Some(data) = item.get("b64_json").and_then(|value| value.as_str()) {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|error| format!("Unable to decode OpenAI image: {error}"))?;
            outputs.push(video_save_generated_bytes(provider.id, generated_dir, root, index, "png", &bytes)?);
        }
    }
    if outputs.is_empty() {
        return Err("OpenAI image response did not include b64_json data.".to_string());
    }
    Ok(outputs)
}

async fn video_generate_nano_banana(
    request: &VideoGenerateRequest,
    provider: &VideoProviderDefinition,
    root: &std::path::Path,
    media_root: &std::path::Path,
    generated_dir: &std::path::Path,
) -> Result<Vec<String>, String> {
    use base64::Engine as _;
    let client = http_client(std::time::Duration::from_secs(120))?;
    let base = video_provider_base_url(provider, &request.auth);
    let api_key = video_auth_api_key(&request.auth)?;
    let model = if request.model.trim().is_empty() {
        provider.models[0]
    } else {
        request.model.as_str()
    };
    let mut parts = vec![serde_json::json!({ "text": request.prompt })];
    for input in &request.input_asset_paths {
        let (_, base64, mime, _) = video_asset_data_uri(root, media_root, input)?;
        parts.push(serde_json::json!({
            "inline_data": {
                "mime_type": mime,
                "data": base64,
            },
        }));
    }
    let response = client
        .post(format!("{base}/v1beta/models/{model}:generateContent"))
        .header("x-goog-api-key", api_key)
        .json(&serde_json::json!({ "contents": [{ "parts": parts }] }))
        .send()
        .await
        .map_err(|error| format!("Unable to submit Gemini image generation: {error}"))?;
    let json = video_response_json(response, "Gemini image").await?;
    let mut outputs = Vec::new();
    let parts = json
        .get("candidates")
        .and_then(|value| value.as_array())
        .and_then(|candidates| candidates.first())
        .and_then(|candidate| candidate.get("content"))
        .and_then(|content| content.get("parts"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    for part in parts {
        let inline = part.get("inlineData").or_else(|| part.get("inline_data"));
        let Some(inline) = inline else {
            continue;
        };
        let mime = inline
            .get("mimeType")
            .or_else(|| inline.get("mime_type"))
            .and_then(|value| value.as_str())
            .unwrap_or("image/png");
        let Some(data) = inline.get("data").and_then(|value| value.as_str()) else {
            continue;
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|error| format!("Unable to decode Gemini image: {error}"))?;
        outputs.push(video_save_generated_bytes(
            provider.id,
            generated_dir,
            root,
            outputs.len(),
            video_extension_for_mime(mime),
            &bytes,
        )?);
    }
    if outputs.is_empty() {
        return Err("Gemini image response did not include inline image data.".to_string());
    }
    Ok(outputs)
}

fn video_flux_image_size(aspect: Option<&str>) -> &'static str {
    match aspect.unwrap_or_default() {
        "1:1" | "square" => "square_hd",
        "16:9" | "landscape" => "landscape_16_9",
        "9:16" | "portrait" => "portrait_16_9",
        "4:3" => "landscape_4_3",
        "3:4" => "portrait_4_3",
        _ => "square_hd",
    }
}

async fn video_fal_poll_response(
    client: &reqwest::Client,
    status_url: &str,
    response_url: &str,
    api_key: &str,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<serde_json::Value, String> {
    let started = std::time::Instant::now();
    loop {
        if started.elapsed() > std::time::Duration::from_secs(VIDEO_GENERATION_TIMEOUT_SECS) {
            return Err("fal.ai queue job timed out.".to_string());
        }
        video_poll_sleep(cancel).await?;
        let status_response = client
            .get(status_url)
            .header("Authorization", format!("Key {api_key}"))
            .send()
            .await
            .map_err(|error| format!("Unable to poll fal.ai queue: {error}"))?;
        let status_json = video_response_json(status_response, "fal.ai status").await?;
        let status = video_json_path_string(&status_json, &["status"]).unwrap_or_default();
        if status == "COMPLETED" {
            let response = client
                .get(response_url)
                .header("Authorization", format!("Key {api_key}"))
                .send()
                .await
                .map_err(|error| format!("Unable to fetch fal.ai response: {error}"))?;
            return video_response_json(response, "fal.ai response").await;
        }
        if status == "FAILED" {
            return Err(format!("fal.ai queue job failed: {status_json}"));
        }
    }
}

async fn video_generate_flux_lora(
    app: &tauri::AppHandle,
    job_id: &str,
    request: &VideoGenerateRequest,
    provider: &VideoProviderDefinition,
    root: &std::path::Path,
    generated_dir: &std::path::Path,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<Vec<String>, String> {
    let client = http_client(std::time::Duration::from_secs(120))?;
    let base = video_provider_base_url(provider, &request.auth);
    let api_key = video_auth_api_key(&request.auth)?;
    let loras = if let Some(lora_id) = request.lora_id.as_deref() {
        let registry = video_lora_read_registry(app)?;
        let entry = registry
            .iter()
            .find(|entry| entry.id == lora_id && entry.status == "ready")
            .ok_or_else(|| format!("LoRA is not ready or does not exist: {lora_id}"))?;
        vec![serde_json::json!({ "path": entry.provider_ref.clone().unwrap_or_default() })]
    } else {
        Vec::new()
    };
    let response = client
        .post(format!("{base}/fal-ai/flux-lora"))
        .header("Authorization", format!("Key {api_key}"))
        .json(&serde_json::json!({
            "prompt": request.prompt,
            "loras": loras,
            "image_size": video_flux_image_size(request.params.as_ref().and_then(|params| params.aspect.as_deref())),
            "seed": request.params.as_ref().and_then(|params| params.seed),
        }))
        .send()
        .await
        .map_err(|error| format!("Unable to submit fal.ai flux-lora job: {error}"))?;
    let submit_json = video_response_json(response, "fal.ai flux-lora submit").await?;
    let status_url = video_json_path_string(&submit_json, &["status_url"])
        .ok_or_else(|| format!("fal.ai submit response did not include status_url: {submit_json}"))?;
    let response_url = video_json_path_string(&submit_json, &["response_url"])
        .ok_or_else(|| format!("fal.ai submit response did not include response_url: {submit_json}"))?;
    let result = video_fal_poll_response(&client, status_url, response_url, &api_key, cancel).await?;
    let urls = result
        .get("images")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("url").and_then(|value| value.as_str()))
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    if urls.is_empty() {
        return Err("fal.ai flux-lora response did not include images.".to_string());
    }
    video_download_provider_urls(app, job_id, provider.id, &client, urls, generated_dir, root, cancel).await
}

async fn video_generate_worker(
    app: tauri::AppHandle,
    job_id: String,
    repo_path: String,
    request: VideoGenerateRequest,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    let provider_id = request.provider_id.clone();
    video_emit_generate_progress(&app, &job_id, &provider_id, "submitting", Some(0.0), "Submitting generation request.", false, None, &[]);
    let result = async {
        let provider = video_provider_definition(&request.provider_id)
            .ok_or_else(|| format!("Unknown video generation provider: {}", request.provider_id))?;
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let generated_dir = media_root.join(VIDEO_GENERATED_DIR);
        let output_paths = match provider.id {
            "higgsfield" => {
                video_emit_generate_progress(&app, &job_id, provider.id, "queued", None, "Generation queued.", false, None, &[]);
                video_generate_higgsfield(&app, &job_id, &request, provider, &root, &media_root, &generated_dir, &cancel).await?
            }
            "seedance" => {
                video_emit_generate_progress(&app, &job_id, provider.id, "queued", None, "Generation queued.", false, None, &[]);
                video_generate_seedance(&app, &job_id, &request, provider, &root, &media_root, &generated_dir, &cancel).await?
            }
            "kling" => {
                video_emit_generate_progress(&app, &job_id, provider.id, "queued", None, "Generation queued.", false, None, &[]);
                video_generate_kling(&app, &job_id, &request, provider, &root, &media_root, &generated_dir, &cancel).await?
            }
            "gpt-image-2" => video_generate_openai_image(&request, provider, &root, &media_root, &generated_dir).await?,
            "nano-banana" => video_generate_nano_banana(&request, provider, &root, &media_root, &generated_dir).await?,
            "flux-lora" => video_generate_flux_lora(&app, &job_id, &request, provider, &root, &generated_dir, &cancel).await?,
            _ => return Err(format!("Unsupported video generation provider: {}", provider.id)),
        };
        let _ = app.emit(
            VIDEO_STORE_CHANGED_EVENT,
            serde_json::json!({
                "repoPath": root.to_string_lossy().to_string(),
                "paths": output_paths,
                "changedAtMs": video_now_millis(),
            }),
        );
        Ok::<Vec<String>, String>(output_paths)
    }
    .await;
    match result {
        Ok(output_paths) => video_emit_generate_progress(
            &app,
            &job_id,
            &provider_id,
            "done",
            Some(100.0),
            "Generation finished.",
            true,
            None,
            &output_paths,
        ),
        Err(_error) if cancel.load(std::sync::atomic::Ordering::Acquire) => video_emit_generate_progress(
            &app,
            &job_id,
            &provider_id,
            "cancelled",
            Some(100.0),
            "Generation cancelled.",
            true,
            None,
            &[],
        ),
        Err(error) => video_emit_generate_progress(
            &app,
            &job_id,
            &provider_id,
            "error",
            Some(100.0),
            &error,
            true,
            Some(&error),
            &[],
        ),
    }
    video_job_registry_remove(&VIDEO_GENERATE_JOBS, &job_id);
}

#[tauri::command]
async fn video_generate_start(
    app: tauri::AppHandle,
    repo_path: String,
    request: VideoGenerateRequest,
) -> Result<VideoJobStartResult, String> {
    let (job_id, cancel) = video_job_registry_insert(&VIDEO_GENERATE_JOBS)?;
    tauri::async_runtime::spawn(video_generate_worker(app, job_id.clone(), repo_path, request, cancel));
    Ok(VideoJobStartResult { job_id })
}

// Cancels generation AND LoRA-training jobs: the frontend shows both in one
// jobs list and cancels either through this command.
#[tauri::command]
fn video_generate_cancel(job_id: String) -> Result<(), String> {
    if video_job_registry_cancel(&VIDEO_GENERATE_JOBS, &job_id).is_ok() {
        return Ok(());
    }
    video_job_registry_cancel(&VIDEO_LORA_JOBS, &job_id)
}

#[tauri::command]
fn video_generation_providers() -> Result<serde_json::Value, String> {
    Ok(serde_json::Value::Array(
        VIDEO_GENERATION_PROVIDERS
            .iter()
            .map(|provider| {
                serde_json::json!({
                    "id": provider.id,
                    "label": provider.label,
                    "kind": provider.kind,
                    "models": provider.models,
                    "defaultBaseUrl": provider.default_base_url,
                    "requiresSecretKey": provider.requires_secret_key,
                })
            })
            .collect(),
    ))
}

fn video_lora_read_registry(app: &tauri::AppHandle) -> Result<Vec<VideoLoraEntry>, String> {
    let path = video_lora_registry_path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<Vec<VideoLoraEntry>>(&raw)
            .map_err(|error| format!("Unable to parse LoRA registry: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("Unable to read LoRA registry: {error}")),
    }
}

fn video_lora_write_registry(app: &tauri::AppHandle, entries: &[VideoLoraEntry]) -> Result<(), String> {
    let path = video_lora_registry_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create LoRA registry directory: {error}"))?;
    }
    let temp_path = path.with_extension("json.tmp");
    let raw = serde_json::to_vec_pretty(entries)
        .map_err(|error| format!("Unable to serialize LoRA registry: {error}"))?;
    std::fs::write(&temp_path, raw)
        .map_err(|error| format!("Unable to write LoRA registry: {error}"))?;
    std::fs::rename(&temp_path, &path)
        .map_err(|error| format!("Unable to finalize LoRA registry: {error}"))?;
    Ok(())
}

#[tauri::command]
fn video_lora_list(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "loras": video_lora_read_registry(&app)? }))
}

#[tauri::command]
fn video_lora_delete(app: tauri::AppHandle, lora_id: String) -> Result<(), String> {
    let mut entries = video_lora_read_registry(&app)?;
    entries.retain(|entry| entry.id != lora_id);
    video_lora_write_registry(&app, &entries)
}

fn video_lora_set_entry(app: &tauri::AppHandle, updated: VideoLoraEntry) -> Result<(), String> {
    let mut entries = video_lora_read_registry(app)?;
    if let Some(entry) = entries.iter_mut().find(|entry| entry.id == updated.id) {
        *entry = updated;
    } else {
        entries.push(updated);
    }
    video_lora_write_registry(app, &entries)
}

fn video_lora_zip_images_blocking(
    root: std::path::PathBuf,
    media_root: std::path::PathBuf,
    image_paths: Vec<String>,
) -> Result<Vec<u8>, String> {
    use std::io::Write as _;
    let cursor = std::io::Cursor::new(Vec::<u8>::new());
    let mut writer = zip::ZipWriter::new(cursor);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (index, image_path) in image_paths.iter().enumerate() {
        let abs = video_resolve_media_abs(&root, &media_root, image_path)?;
        let kind = video_media_kind_for_extension(&abs)
            .ok_or_else(|| format!("Unsupported LoRA training image: {}", abs.display()))?;
        if kind != "image" {
            return Err("LoRA training inputs must be image assets.".to_string());
        }
        let extension = abs
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("png")
            .to_ascii_lowercase();
        let bytes = std::fs::read(&abs)
            .map_err(|error| format!("Unable to read LoRA training image: {error}"))?;
        writer
            .start_file(format!("image-{}.{}", index + 1, extension), options)
            .map_err(|error| format!("Unable to zip LoRA training images: {error}"))?;
        writer
            .write_all(&bytes)
            .map_err(|error| format!("Unable to zip LoRA training images: {error}"))?;
    }
    let cursor = writer
        .finish()
        .map_err(|error| format!("Unable to finish LoRA training zip: {error}"))?;
    let bytes = cursor.into_inner();
    if bytes.len() > 40 * 1024 * 1024 {
        return Err("LoRA training image zip exceeds 40MB. Use fewer or smaller images.".to_string());
    }
    Ok(bytes)
}

fn video_emit_lora_progress(
    app: &tauri::AppHandle,
    job_id: &str,
    lora_id: &str,
    state: &str,
    percent: Option<f64>,
    message: &str,
    done: bool,
    error: Option<&str>,
) {
    let _ = app.emit(
        VIDEO_LORA_PROGRESS_EVENT,
        serde_json::json!({
            "jobId": job_id,
            "loraId": lora_id,
            "state": state,
            "percent": percent,
            "message": message,
            "done": done,
            "error": error,
        }),
    );
}

async fn video_lora_train_worker(
    app: tauri::AppHandle,
    job_id: String,
    repo_path: String,
    request: VideoLoraTrainRequest,
    lora_id: String,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    let result = async {
        use base64::Engine as _;
        video_emit_lora_progress(&app, &job_id, &lora_id, "submitting", Some(0.0), "Preparing LoRA training images.", false, None);
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let zip_bytes = tauri::async_runtime::spawn_blocking({
            let root = root.clone();
            let media_root = media_root.clone();
            let image_paths = request.image_paths.clone();
            move || video_lora_zip_images_blocking(root, media_root, image_paths)
        })
        .await
        .map_err(|error| format!("LoRA zip worker failed: {error}"))??;
        if cancel.load(std::sync::atomic::Ordering::Acquire) {
            return Err("LoRA training cancelled.".to_string());
        }
        let provider = video_provider_definition("flux-lora").expect("flux provider");
        let base = request
            .auth
            .as_ref()
            .and_then(|auth| auth.base_url.as_deref())
            .map(|value| value.trim().trim_end_matches('/').to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| provider.default_base_url.to_string());
        let api_key = video_auth_api_key(&request.auth)?;
        let client = http_client(std::time::Duration::from_secs(120))?;
        let zip_data = base64::engine::general_purpose::STANDARD.encode(zip_bytes);
        let response = client
            .post(format!("{base}/fal-ai/flux-lora-fast-training"))
            .header("Authorization", format!("Key {api_key}"))
            .json(&serde_json::json!({
                "images_data_url": format!("data:application/zip;base64,{zip_data}"),
                "trigger_word": request.trigger_word,
                "steps": request.steps.unwrap_or(1000),
            }))
            .send()
            .await
            .map_err(|error| format!("Unable to submit LoRA training job: {error}"))?;
        let submit_json = video_response_json(response, "fal.ai LoRA submit").await?;
        let status_url = video_json_path_string(&submit_json, &["status_url"])
            .ok_or_else(|| format!("fal.ai LoRA submit response did not include status_url: {submit_json}"))?;
        let response_url = video_json_path_string(&submit_json, &["response_url"])
            .ok_or_else(|| format!("fal.ai LoRA submit response did not include response_url: {submit_json}"))?;
        video_emit_lora_progress(&app, &job_id, &lora_id, "queued", Some(10.0), "LoRA training queued.", false, None);
        let result = video_fal_poll_response(&client, status_url, response_url, &api_key, &cancel).await?;
        let provider_ref = video_json_path_string(&result, &["diffusers_lora_file", "url"])
            .or_else(|| video_json_path_string(&result, &["lora_file", "url"]))
            .ok_or_else(|| format!("LoRA training completed without lora file URL: {result}"))?
            .to_string();
        let entry = VideoLoraEntry {
            id: lora_id.clone(),
            name: request.name.clone(),
            trigger_word: request.trigger_word.clone(),
            status: "ready".to_string(),
            provider_ref: Some(provider_ref),
            created_at_ms: video_now_millis(),
        };
        video_lora_set_entry(&app, entry)?;
        Ok::<(), String>(())
    }
    .await;
    match result {
        Ok(()) => video_emit_lora_progress(&app, &job_id, &lora_id, "done", Some(100.0), "LoRA training finished.", true, None),
        Err(_error) if cancel.load(std::sync::atomic::Ordering::Acquire) => {
            if let Ok(mut entries) = video_lora_read_registry(&app) {
                if let Some(entry) = entries.iter_mut().find(|entry| entry.id == lora_id) {
                    entry.status = "error".to_string();
                }
                let _ = video_lora_write_registry(&app, &entries);
            }
            video_emit_lora_progress(&app, &job_id, &lora_id, "cancelled", Some(100.0), "LoRA training cancelled.", true, None);
        }
        Err(error) => {
            if let Ok(mut entries) = video_lora_read_registry(&app) {
                if let Some(entry) = entries.iter_mut().find(|entry| entry.id == lora_id) {
                    entry.status = "error".to_string();
                }
                let _ = video_lora_write_registry(&app, &entries);
            }
            video_emit_lora_progress(&app, &job_id, &lora_id, "error", Some(100.0), &error, true, Some(&error));
        }
    }
    video_job_registry_remove(&VIDEO_LORA_JOBS, &job_id);
}

#[tauri::command]
async fn video_lora_train_start(
    app: tauri::AppHandle,
    repo_path: String,
    request: VideoLoraTrainRequest,
) -> Result<VideoJobStartResult, String> {
    if request.image_paths.is_empty() {
        return Err("LoRA training requires at least one image.".to_string());
    }
    let lora_id = uuid::Uuid::new_v4().to_string();
    let entry = VideoLoraEntry {
        id: lora_id.clone(),
        name: if request.name.trim().is_empty() {
            "Untitled LoRA".to_string()
        } else {
            request.name.trim().chars().take(120).collect()
        },
        trigger_word: request.trigger_word.trim().chars().take(80).collect(),
        status: "training".to_string(),
        provider_ref: None,
        created_at_ms: video_now_millis(),
    };
    video_lora_set_entry(&app, entry)?;
    let (job_id, cancel) = video_job_registry_insert(&VIDEO_LORA_JOBS)?;
    tauri::async_runtime::spawn(video_lora_train_worker(
        app,
        job_id.clone(),
        repo_path,
        request,
        lora_id,
        cancel,
    ));
    Ok(VideoJobStartResult { job_id })
}

fn video_panel_safe_label_part(value: &str, fallback: &str) -> String {
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

fn video_panel_label(workspace_id: &str, pane_id: &str) -> String {
    format!(
        "{VIDEO_PANEL_LABEL_PREFIX}{}-{}",
        video_panel_safe_label_part(workspace_id, "workspace"),
        video_panel_safe_label_part(pane_id, "pane")
    )
}

fn emit_video_panel_closed(app: &tauri::AppHandle, workspace_id: &str, pane_id: &str, window_id: &str) {
    let _ = app.emit(
        VIDEO_PANEL_CLOSED_EVENT,
        serde_json::json!({
            "paneId": pane_id,
            "windowId": window_id,
            "workspaceId": workspace_id,
        }),
    );
}

#[tauri::command]
async fn video_panel_open(
    app: tauri::AppHandle,
    repo_path: String,
    workspace_id: String,
    pane_id: String,
    theme: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<VideoPanelOpenResult, String> {
    let workspace_text = workspace_id.trim().chars().take(512).collect::<String>();
    let pane_text = pane_id.trim().chars().take(512).collect::<String>();
    if workspace_text.is_empty() {
        return Err("Video panel workspace id is required.".to_string());
    }
    if pane_text.is_empty() {
        return Err("Video panel pane id is required.".to_string());
    }
    let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
    video_ensure_media_dirs(&media_root)?;
    let repo_text = root.to_string_lossy().to_string();
    let theme_text = theme
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let theme_text = if theme_text == "light" { "light" } else { "dark" };
    let label = video_panel_label(&workspace_text, &pane_text);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(VideoPanelOpenResult { label });
    }
    let window_width = width
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(480.0, 2400.0))
        .unwrap_or(VIDEO_PANEL_DEFAULT_WIDTH);
    let window_height = height
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(360.0, 1600.0))
        .unwrap_or(VIDEO_PANEL_DEFAULT_HEIGHT);
    let url = format!(
        "index.html#/video-window?mode=panel&paneId={}&repoPath={}&theme={}&windowId={}&workspaceId={}",
        percent_encode_query_component(&pane_text),
        percent_encode_query_component(&repo_text),
        percent_encode_query_component(theme_text),
        percent_encode_query_component(&label),
        percent_encode_query_component(&workspace_text),
    );
    let window = WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::App(url.into()))
        .title("Video Editor - Diff Forge")
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
        .map_err(|error| format!("Unable to create video panel window: {error}"))?;
    let app_for_events = app.clone();
    let workspace_for_events = workspace_text.clone();
    let pane_for_events = pane_text.clone();
    let label_for_events = label.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            emit_video_panel_closed(
                &app_for_events,
                &workspace_for_events,
                &pane_for_events,
                &label_for_events,
            );
        }
    });
    Ok(VideoPanelOpenResult { label })
}

#[tauri::command]
async fn video_panel_focus(app: tauri::AppHandle, workspace_id: String, pane_id: String) -> Result<bool, String> {
    let label = video_panel_label(&workspace_id, &pane_id);
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(false);
    };
    let _ = window.show();
    let _ = window.set_focus();
    Ok(true)
}

#[tauri::command]
async fn video_panel_close(app: tauri::AppHandle, workspace_id: String, pane_id: String) -> Result<(), String> {
    let workspace_text = workspace_id.trim().to_string();
    let pane_text = pane_id.trim().to_string();
    let label = video_panel_label(&workspace_text, &pane_text);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    } else {
        emit_video_panel_closed(&app, &workspace_text, &pane_text, &label);
    }
    Ok(())
}

#[cfg(test)]
mod video_pipe_tests {
    fn full_feature_project() -> serde_json::Value {
        serde_json::json!({
            "version": 1,
            "name": "Launch \"Cut\"\nBackslash \\",
            "settings": {
                "width": 1920,
                "height": 1080,
                "fps": 29.97,
                "background": "#101820",
            },
            "tracks": [
                {
                    "id": "custom-video",
                    "kind": "video",
                    "label": "Video Main",
                    "muted": false,
                    "locked": true,
                    "clips": [
                        {
                            "id": "ignored-late",
                            "assetPath": "media/assets/clip two.mp4",
                            "timelineStartMs": 4200,
                            "durationMs": 1800,
                            "sourceInMs": 0,
                            "speed": 1.0,
                            "gain": { "level": 1.0, "keyframes": [] },
                            "transform": { "x": 0.0, "y": 0.0, "scale": 1.0, "opacity": 1.0 }
                        },
                        {
                            "id": "ignored-early",
                            "assetPath": "media/assets/clip one.mp4",
                            "timelineStartMs": 500,
                            "durationMs": 3500,
                            "sourceInMs": 250,
                            "speed": 1.25,
                            "gain": {
                                "level": 0.8,
                                "keyframes": [
                                    { "atMs": 0, "level": 0.0 },
                                    { "atMs": 900, "level": 0.75 },
                                    { "atMs": 1800, "level": 1.0 }
                                ]
                            },
                            "transform": { "x": 0.125, "y": -0.25, "scale": 1.3333, "opacity": 0.875 }
                        }
                    ]
                },
                {
                    "id": "custom-audio",
                    "kind": "audio",
                    "label": "VO Bus",
                    "muted": true,
                    "locked": false,
                    "clips": [
                        {
                            "id": "ignored-audio",
                            "assetPath": "media/assets/voice.wav",
                            "timelineStartMs": 0,
                            "durationMs": 6400,
                            "sourceInMs": 1000,
                            "speed": 0.95,
                            "gain": {
                                "level": 0.55,
                                "keyframes": [
                                    { "atMs": 0, "level": 0.25 },
                                    { "atMs": 3000, "level": 0.9 }
                                ]
                            },
                            "transform": { "x": 0.0, "y": 0.0, "scale": 1.0, "opacity": 1.0 }
                        }
                    ]
                },
                {
                    "id": "custom-text",
                    "kind": "text",
                    "label": "Titles",
                    "muted": false,
                    "locked": false,
                    "clips": [
                        {
                            "id": "ignored-text-defaults",
                            "text": "Default title",
                            "timelineStartMs": 7000,
                            "durationMs": 900,
                            "style": {
                                "fontSize": 48,
                                "color": "#ffffff",
                                "background": "",
                                "outlineColor": "#000000",
                                "outlineWidth": 0,
                                "shadow": false,
                                "uppercase": false,
                                "x": 0.5,
                                "y": 0.85,
                                "align": "center",
                                "bold": true,
                                "fontFamily": "sans-serif"
                            }
                        },
                        {
                            "id": "ignored-text",
                            "text": "Hello \"pipe\"\nLine two \\ ok",
                            "timelineStartMs": 1200,
                            "durationMs": 2200,
                            "style": {
                                "fontSize": 63.5,
                                "color": "#ffeeaa",
                                "background": "#000000cc",
                                "outlineColor": "#111111",
                                "outlineWidth": 4,
                                "shadow": true,
                                "uppercase": true,
                                "x": 0.25,
                                "y": 0.75,
                                "align": "left",
                                "bold": false,
                                "fontFamily": "Open Sans"
                            }
                        }
                    ]
                }
            ],
            "updatedAtMs": 123456789,
        })
    }

    #[test]
    fn video_pipe_round_trip_is_byte_identical() {
        let project = full_feature_project();
        let pipe = super::video_pipe_serialize_project(&project).expect("serialize project");
        assert!(pipe.starts_with(super::VIDEO_PIPE_HEADER));
        assert!(pipe.contains("project \"Launch \\\"Cut\\\"\\nBackslash \\\\\" 1920x1080 fps=29.97 bg=#101820"));
        assert!(pipe.contains("track video \"Video Main\" locked"));
        assert!(pipe.contains("track audio \"VO Bus\" muted"));
        assert!(pipe.contains("c \"media/assets/clip one.mp4\" at=500 dur=3500 in=250 speed=1.25 gain=0.8 kf=0:0,900:0.75,1800:1 x=0.125 y=-0.25 scale=1.333 opacity=0.875"));
        assert!(pipe.contains("t \"Hello \\\"pipe\\\"\\nLine two \\\\ ok\" at=1200 dur=2200 size=63.5 color=#ffeeaa bg=#000000cc outline=#111111 outlinew=4 shadow upper x=0.25 y=0.75 align=left plain font=\"Open Sans\""));
        assert!(pipe.contains("t \"Default title\" at=7000 dur=900\n"));
        assert!(!pipe.contains("updatedAtMs"));
        assert!(!pipe.contains("sourceInMs"));
        assert!(!pipe.contains("fontFamily"));

        let parsed = super::video_pipe_parse_project(&pipe).expect("parse serialized pipe");
        assert_eq!(parsed["tracks"][0]["id"], "v1");
        assert_eq!(parsed["tracks"][1]["id"], "a1");
        assert_eq!(parsed["tracks"][2]["id"], "t1");
        assert_eq!(parsed["tracks"][0]["clips"][0]["id"], "c1");
        assert_eq!(parsed["tracks"][0]["clips"][1]["id"], "c2");
        assert_eq!(parsed["tracks"][1]["clips"][0]["id"], "c3");
        assert_eq!(parsed["tracks"][2]["clips"][0]["id"], "c4");
        assert_eq!(parsed["tracks"][2]["clips"][1]["id"], "c5");

        let pipe_again = super::video_pipe_serialize_project(&parsed).expect("serialize parsed project");
        assert_eq!(pipe, pipe_again);
    }

    #[test]
    fn video_pipe_minimal_parse_applies_defaults() {
        let raw = r#"
# ignored
project "Minimal" 640x360
track video "V"
c media/assets/a.mp4 at=0 dur=1000
track text "T"
t "Hello" at=10 dur=500
"#;
        let project = super::video_pipe_parse_project(raw).expect("parse minimal pipe");
        assert_eq!(project["name"], "Minimal");
        assert_eq!(project["settings"]["width"], 640);
        assert_eq!(project["settings"]["height"], 360);
        assert_eq!(project["settings"]["fps"], 30.0);
        assert_eq!(project["settings"]["background"], "#000000");
        assert_eq!(project["tracks"][0]["id"], "v1");
        assert_eq!(project["tracks"][1]["id"], "t1");

        let clip = &project["tracks"][0]["clips"][0];
        assert_eq!(clip["id"], "c1");
        assert_eq!(clip["sourceInMs"], 0);
        assert_eq!(clip["speed"], 1.0);
        assert_eq!(clip["gain"]["level"], 1.0);
        assert_eq!(clip["gain"]["keyframes"].as_array().unwrap().len(), 0);
        assert_eq!(clip["transform"]["x"], 0.0);
        assert_eq!(clip["transform"]["y"], 0.0);
        assert_eq!(clip["transform"]["scale"], 1.0);
        assert_eq!(clip["transform"]["opacity"], 1.0);

        let style = &project["tracks"][1]["clips"][0]["style"];
        assert_eq!(project["tracks"][1]["clips"][0]["id"], "c2");
        assert_eq!(style["fontSize"], 48.0);
        assert_eq!(style["color"], "#ffffff");
        assert_eq!(style["background"], "");
        assert_eq!(style["outlineColor"], "#000000");
        assert_eq!(style["outlineWidth"], 0.0);
        assert_eq!(style["shadow"], false);
        assert_eq!(style["uppercase"], false);
        assert_eq!(style["x"], 0.5);
        assert_eq!(style["y"], 0.85);
        assert_eq!(style["align"], "center");
        assert_eq!(style["bold"], true);
        assert_eq!(style["fontFamily"], "sans-serif");
    }

    #[test]
    fn video_pipe_malformed_line_reports_line_number() {
        let raw = r#"
# ignored
project "Bad" 1920x1080
track video "V"
c media/assets/a.mp4 at=0
"#;
        let error = super::video_pipe_parse_project(raw).expect_err("missing dur must fail");
        assert!(
            error.contains("line 5"),
            "expected line number in error, got {error}"
        );
    }

    #[test]
    fn video_pipe_legacy_json_loads_through_common_loader() {
        let root = std::env::temp_dir().join(format!(
            "diffforge-video-pipe-test-{}",
            uuid::Uuid::new_v4()
        ));
        let project_dir = root.join("media").join("projects");
        std::fs::create_dir_all(&project_dir).expect("create temp project dir");
        let project_path = project_dir.join("legacy.video.json");
        let project = serde_json::json!({
            "version": 1,
            "name": "Legacy",
            "settings": { "width": 320, "height": 180, "fps": 24, "background": "#000000" },
            "tracks": [],
            "updatedAtMs": 1,
        });
        std::fs::write(
            &project_path,
            serde_json::to_string_pretty(&project).expect("legacy json"),
        )
        .expect("write legacy json");

        let loaded = super::video_project_load_value(&project_path).expect("load legacy json");
        assert_eq!(loaded["name"], "Legacy");
        assert_eq!(loaded["settings"]["fps"], 24);
        assert_ne!(loaded["updatedAtMs"], 1);
        assert!(loaded["updatedAtMs"].as_u64().unwrap_or(0) > 0);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_pipe_is_at_least_three_times_smaller_than_pretty_json() {
        let project = full_feature_project();
        let pipe = super::video_pipe_serialize_project(&project).expect("serialize project");
        let pretty_json = serde_json::to_string_pretty(&project).expect("pretty json");
        println!(
            "video_pipe_size={} pretty_json_size={} ratio={:.2}",
            pipe.len(),
            pretty_json.len(),
            pretty_json.len() as f64 / pipe.len() as f64
        );
        assert!(
            pipe.len() * 3 <= pretty_json.len(),
            "pipe={} pretty_json={}",
            pipe.len(),
            pretty_json.len()
        );
    }
}

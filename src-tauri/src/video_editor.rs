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
const VIDEO_TRANSCRIPT_UPDATED_EVENT: &str = "video-transcript-updated";
const VIDEO_LORA_PROGRESS_EVENT: &str = "video-lora-progress";
const VIDEO_PANEL_CLOSED_EVENT: &str = "video-panel-closed";
const VIDEO_AGENT_EDITED_EVENT: &str = "video-agent-edited";
const VIDEO_AGENT_GUIDE: &str = include_str!("../docs/video-agent-guide.md");

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
const VIDEO_MEDIA_MANIFEST_FILE: &str = "manifest.json";
const VIDEO_PROJECT_EXTENSION: &str = ".video.pipe";
const VIDEO_PROJECT_LEGACY_EXTENSION: &str = ".video.json";
const VIDEO_TOOLS_DIR: &str = "video-tools";
const VIDEO_TOOLS_BIN_DIR: &str = "bin";
const VIDEO_LORA_REGISTRY_FILE: &str = "loras.json";
const VIDEO_GENERATION_JOBS_FILE: &str = "jobs.json";
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
const VIDEO_GENERATE_REGISTRY_WRITE_INTERVAL_MS: u64 = 500;
const VIDEO_RENDER_FRAME_WINDOW_MS: u64 = 1000;
const VIDEO_WAVEFORM_PCM_LIMIT_BYTES: usize = 60 * 1024 * 1024;
const VIDEO_TRANSCRIBE_MP3_LIMIT_BYTES: u64 = 20 * 1024 * 1024;
const VIDEO_TRANSCRIBE_TIMEOUT_SECS: u64 = 180;
const VIDEO_CLOUD_GENERATE_MAX_B64_BYTES: usize = 40 * 1024 * 1024;
const VIDEO_CLOUD_GENERATE_ACK_TIMEOUT_SECS: u64 = 45;
const VIDEO_DIRECT_UPSCALE_VIDEO_LIMIT_BYTES: u64 = 60 * 1024 * 1024;
const VIDEO_DIRECT_UPSCALE_IMAGE_LIMIT_BYTES: u64 = 25 * 1024 * 1024;
const VIDEO_MCP_MIN_CLIP_DURATION_MS: u64 = 80;
const VIDEO_MCP_REMOVE_WORDS_MERGE_GAP_MS: u64 = 80;
const VIDEO_MCP_LOOK_MAX_FRAMES: usize = 6;
const VIDEO_MCP_LOOK_JPEG_MAX_BASE64_BYTES: usize = 48 * 1024;
const VIDEO_MCP_MOMENT_SOURCE_NOTE: &str = "video_media search moments: momentSourceMs uses the asset's own timebase. Inherited transcript moments include inheritedFrom; inherited timing is valid for derived assets that preserve audio timing.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct VideoMcpLookJpegAttempt {
    max_width: u32,
    quality: u8,
}

const VIDEO_MCP_LOOK_JPEG_ATTEMPTS: [VideoMcpLookJpegAttempt; 4] = [
    VideoMcpLookJpegAttempt {
        max_width: 512,
        quality: 7,
    },
    VideoMcpLookJpegAttempt {
        max_width: 512,
        quality: 12,
    },
    VideoMcpLookJpegAttempt {
        max_width: 448,
        quality: 18,
    },
    VideoMcpLookJpegAttempt {
        max_width: 384,
        quality: 24,
    },
];

const VIDEO_TOOL_DOWNLOAD_URLS: &[(&str, &str)] = &[
    (
        "macos-ffmpeg-zip",
        "https://evermeet.cx/ffmpeg/getrelease/zip",
    ),
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
static VIDEO_EXPORT_STATUSES: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, serde_json::Value>>,
> = std::sync::OnceLock::new();
static VIDEO_GENERATE_JOBS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
> = std::sync::OnceLock::new();
static VIDEO_CLOUD_GENERATE_JOBS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, VideoCloudGenerateJobHandle>>,
> = std::sync::OnceLock::new();
static VIDEO_TRANSCRIBE_JOBS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
> = std::sync::OnceLock::new();
static VIDEO_TRANSCRIBE_TERMINAL_ERRORS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, String>>,
> = std::sync::OnceLock::new();
static VIDEO_LORA_JOBS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
> = std::sync::OnceLock::new();
static VIDEO_GENERATION_JOBS_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> =
    std::sync::OnceLock::new();
static VIDEO_MEDIA_MANIFEST_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> =
    std::sync::OnceLock::new();
static VIDEO_MEDIA_IMPORT_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> =
    std::sync::OnceLock::new();
static VIDEO_GENERATION_JOBS_WRITE_COUNTER: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);
static VIDEO_AGENT_STATES: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, VideoAgentState>>,
> = std::sync::OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoAgentRange {
    start_ms: u64,
    end_ms: u64,
}

#[derive(Debug, Clone)]
struct VideoAgentState {
    project_path: String,
    ranges: Vec<VideoAgentRange>,
    playhead_ms: u64,
    selected_clip_ids: Vec<String>,
    updated_at_ms: u64,
}

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
struct VideoGenerateStartResult {
    job_id: String,
    planned_paths: Vec<String>,
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
    folder_id: String,
    relations: Vec<VideoMediaRelation>,
    pending: bool,
    job_id: Option<String>,
    size_bytes: u64,
    modified_at_ms: u64,
    duration_ms: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
    has_audio: Option<bool>,
    has_transcript: bool,
    transcript_inherited: bool,
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoMediaFolder {
    id: String,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoMediaRelation {
    #[serde(rename = "type")]
    relation_type: String,
    path: String,
    via: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoMediaAssetManifest {
    folder_id: String,
    relations: Vec<VideoMediaRelation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct VideoMediaManifest {
    version: u32,
    folders: Vec<VideoMediaFolder>,
    assets: std::collections::BTreeMap<String, VideoMediaAssetManifest>,
}

impl Default for VideoMediaManifest {
    fn default() -> Self {
        Self {
            version: 1,
            folders: Vec::new(),
            assets: std::collections::BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoMediaManifestResponse {
    folders: Vec<VideoMediaFolder>,
    assets: std::collections::BTreeMap<String, VideoMediaAssetManifest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoMediaFolderCreateResponse {
    id: String,
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
struct VideoTranscriptWord {
    start_ms: u64,
    end_ms: u64,
    text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VideoTranscriptSegment {
    start_ms: u64,
    end_ms: u64,
    text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    words: Vec<VideoTranscriptWord>,
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
    inherited: bool,
    inherited_from: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoTranscriptUpdateInput {
    language: Option<String>,
    segments: Vec<VideoTranscriptSegment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoTranscriptExportResponse {
    output_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoFrameExtractResponse {
    item: VideoMediaItem,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoRenderFrameResponse {
    data_url: String,
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
    range_start_ms: Option<u64>,
    range_end_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoGenerateRequest {
    provider_id: String,
    model: String,
    mode: String,
    prompt: String,
    input_asset_paths: Vec<String>,
    audio_asset_paths: Vec<String>,
    params: Option<VideoGenerateParams>,
    lora_id: Option<String>,
    auth: Option<VideoProviderAuth>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoGenerateParams {
    duration_sec: Option<f64>,
    aspect: Option<String>,
    resolution: Option<String>,
    seed: Option<i64>,
    num_images: Option<u32>,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoProviderAuth {
    api_key: Option<String>,
    secret_key: Option<String>,
    base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoGenerateRecordedRequest {
    kind: String,
    model: String,
    mode: String,
    prompt: String,
    params: Option<VideoGenerateParams>,
    input_asset_paths: Vec<String>,
    audio_asset_paths: Vec<String>,
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
        id: "cloud",
        label: "Diff Forge Cloud",
        kind: "mixed",
        default_base_url: "",
        models: &[
            "kling3_0",
            "kling3_0_turbo",
            "kling2_6",
            "seedance_2_0",
            "seedance_1_5_pro",
            "veo3_1",
            "veo3_1_lite",
            "veo3",
            "wan2_7",
            "wan2_6",
            "minimax_hailuo",
            "grok_video_1_5",
            "higgsfield_dop_lite",
            "higgsfield_dop_turbo",
            "higgsfield_dop_standard",
            "kling_v2_5_turbo_pro_text_to_video",
            "kling_v2_5_turbo_pro_image_to_video",
            "kling_v2_1_pro_image_to_video",
            "seedance_v1_pro_image_to_video",
            "nano_banana_pro",
            "nano_banana_2",
            "flux_2",
            "higgsfield_soul_standard",
            "reve_text_to_image",
            "seedream_v4_text_to_image",
            "seedream_v4_edit",
            "flux_kontext",
            "gpt_image_2",
            "text2image_soul_v2",
            "seedream_v4_5",
            "seedream_v5_lite",
            "grok_image",
            "recraft_v4_1",
            "text2speech_v2",
            "sonilo_music",
            "mirelo_sfx",
            "higgsfield_speak",
            "seedvr2-video-upscaler",
            "esrgan-image-upscaler",
            "topaz-video-upscale",
            "topaz-image-upscale",
            "real-esrgan-replicate",
        ],
        requires_secret_key: false,
    },
    VideoProviderDefinition {
        id: "higgsfield",
        label: "Higgsfield",
        kind: "video",
        default_base_url: "https://platform.higgsfield.ai",
        models: &[
            "dop-turbo",
            "dop-standard",
            "dop-lite",
            "kling-video/v2.5-turbo/pro/text-to-video",
            "kling-video/v2.5-turbo/pro/image-to-video",
            "kling-video/v2.1/pro/image-to-video",
            "bytedance/seedance/v1/pro/image-to-video",
        ],
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
    VideoProviderDefinition {
        id: "fal",
        label: "fal.ai",
        kind: "mixed",
        default_base_url: "https://queue.fal.run",
        models: &[],
        requires_secret_key: false,
    },
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoPersistentGenerateJob {
    job_id: String,
    provider_id: String,
    model: String,
    mode: String,
    request: VideoGenerateRecordedRequest,
    state: String,
    percent: Option<f64>,
    planned_paths: Vec<String>,
    provider_ref: Option<serde_json::Value>,
    created_at_ms: u64,
    done: bool,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoJobsListResponse {
    jobs: Vec<VideoPersistentGenerateJob>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoGenerateResumeResponse {
    ok: bool,
}

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
    filter_keyframe_offset_ms: i64,
    overlay_keyframe_offset_ms: i64,
    opacity_keyframes: Vec<VideoExportPropertyKeyframe>,
    x_keyframes: Vec<VideoExportPropertyKeyframe>,
    y_keyframes: Vec<VideoExportPropertyKeyframe>,
    scale_keyframes: Vec<VideoExportPropertyKeyframe>,
    has_audio: bool,
}

#[derive(Debug, Clone)]
struct VideoExportPropertyKeyframe {
    at_ms: u64,
    value: f64,
    easing: String,
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
    let cancel = video_job_registry_insert_with_id(registry, &job_id)?;
    Ok((job_id, cancel))
}

fn video_job_registry_insert_with_id(
    registry: &'static std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
    >,
    job_id: &str,
) -> Result<std::sync::Arc<std::sync::atomic::AtomicBool>, String> {
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let handle = VideoJobHandle {
        cancel: cancel.clone(),
    };
    let jobs = registry.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    jobs.lock()
        .map_err(|_| "Video job registry is poisoned.".to_string())?
        .insert(job_id.to_string(), handle);
    Ok(cancel)
}

fn video_job_registry_cancel(
    registry: &'static std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
    >,
    job_id: &str,
) -> Result<(), String> {
    let jobs = registry.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    let guard = jobs
        .lock()
        .map_err(|_| "Video job registry is poisoned.".to_string())?;
    if let Some(handle) = guard.get(job_id) {
        handle
            .cancel
            .store(true, std::sync::atomic::Ordering::Release);
        return Ok(());
    }
    Err("Unknown job".to_string())
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

fn video_export_statuses()
-> &'static std::sync::Mutex<std::collections::HashMap<String, serde_json::Value>> {
    VIDEO_EXPORT_STATUSES.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn video_record_export_status(
    job_id: &str,
    state: &str,
    percent: Option<f64>,
    done: bool,
    error: Option<&str>,
    output_path: Option<&str>,
) {
    if let Ok(mut statuses) = video_export_statuses().lock() {
        statuses.insert(
            job_id.to_string(),
            serde_json::json!({
                "jobId": job_id,
                "state": state,
                "percent": percent,
                "done": done,
                "error": error,
                "outputPath": output_path,
            }),
        );
    }
}

fn video_mcp_export_status_value(job_id: &str) -> Result<serde_json::Value, String> {
    video_export_statuses()
        .lock()
        .map_err(|_| "Video export status registry is poisoned.".to_string())?
        .get(job_id)
        .cloned()
        .ok_or_else(|| format!("Video export job not found: {job_id}"))
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
    // .cache holds regenerable derived data (thumbs, filmstrips, waveforms,
    // probe/transcribe caches) — self-ignore it so it never dirties the
    // workspace's git status.
    let gitignore_path = media_root.join(VIDEO_CACHE_DIR).join(".gitignore");
    if !gitignore_path.exists() {
        std::fs::write(&gitignore_path, "*\n")
            .map_err(|error| format!("Unable to write media cache .gitignore: {error}"))?;
    }
    Ok(())
}

fn video_media_manifest_path(media_root: &std::path::Path) -> std::path::PathBuf {
    media_root.join(VIDEO_MEDIA_MANIFEST_FILE)
}

fn video_media_manifest_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    VIDEO_MEDIA_MANIFEST_LOCK
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .map_err(|_| "Video media manifest lock is poisoned.".to_string())
}

fn video_media_import_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    VIDEO_MEDIA_IMPORT_LOCK
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .map_err(|_| "Video media import lock is poisoned.".to_string())
}

fn video_read_media_manifest(path: &std::path::Path) -> VideoMediaManifest {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return VideoMediaManifest::default();
    };
    let Ok(mut manifest) = serde_json::from_str::<VideoMediaManifest>(&raw) else {
        return VideoMediaManifest::default();
    };
    manifest.version = 1;
    let valid_folders = manifest
        .folders
        .iter()
        .map(|folder| folder.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    for asset in manifest.assets.values_mut() {
        if !asset.folder_id.is_empty() && !valid_folders.contains(asset.folder_id.as_str()) {
            asset.folder_id.clear();
        }
        asset.relations.retain(|relation| {
            relation.relation_type == "derived-from"
                && !relation.path.trim().is_empty()
                && !relation.via.trim().is_empty()
        });
    }
    manifest
}

fn video_write_media_manifest(
    path: &std::path::Path,
    manifest: &VideoMediaManifest,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create video media manifest directory: {error}"))?;
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(VIDEO_MEDIA_MANIFEST_FILE);
    let temp_path = path.with_file_name(format!(
        "{file_name}.{}.{}.tmp",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let raw = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("Unable to serialize video media manifest: {error}"))?;
    std::fs::write(&temp_path, raw)
        .map_err(|error| format!("Unable to write video media manifest: {error}"))?;
    std::fs::rename(&temp_path, path)
        .map_err(|error| format!("Unable to finalize video media manifest: {error}"))?;
    Ok(())
}

fn video_manifest_asset_path(
    root: &std::path::Path,
    media_root: &std::path::Path,
    raw_path: &str,
) -> Result<String, String> {
    let abs = video_resolve_media_abs(root, media_root, raw_path)?;
    if !abs.starts_with(media_root.join(VIDEO_ASSETS_DIR))
        && !abs.starts_with(media_root.join(VIDEO_GENERATED_DIR))
    {
        return Err(
            "Video media manifest assets must stay under media/assets or media/generated."
                .to_string(),
        );
    }
    Ok(video_relative_path(root, &abs))
}

fn video_manifest_folder_exists(manifest: &VideoMediaManifest, folder_id: &str) -> bool {
    folder_id.is_empty() || manifest.folders.iter().any(|folder| folder.id == folder_id)
}

fn video_manifest_asset<'a>(
    manifest: &'a VideoMediaManifest,
    rel_path: &str,
) -> Option<&'a VideoMediaAssetManifest> {
    manifest.assets.get(rel_path)
}

fn video_manifest_asset_owned(
    manifest: &VideoMediaManifest,
    rel_path: &str,
) -> VideoMediaAssetManifest {
    video_manifest_asset(manifest, rel_path)
        .cloned()
        .unwrap_or_default()
}

fn video_manifest_slug_unique(manifest: &VideoMediaManifest, name: &str) -> String {
    let base = video_slugify_with_fallback(name, "folder");
    let mut candidate = base.clone();
    let mut index = 1u32;
    while manifest.folders.iter().any(|folder| folder.id == candidate) {
        candidate = format!("{base}-{index}");
        index = index.saturating_add(1);
    }
    candidate
}

fn video_emit_manifest_changed(
    app: &tauri::AppHandle,
    root: &std::path::Path,
    manifest_path: &std::path::Path,
) {
    let manifest_rel = video_relative_path(root, manifest_path);
    let _ = app.emit(
        VIDEO_STORE_CHANGED_EVENT,
        serde_json::json!({
            "repoPath": root.to_string_lossy().to_string(),
            "paths": [manifest_rel.clone()],
            "manifestPath": manifest_rel,
            "changedAtMs": video_now_millis(),
        }),
    );
}

fn video_manifest_set_asset_folder(
    manifest: &mut VideoMediaManifest,
    rel_path: &str,
    folder_id: &str,
) {
    let entry = manifest.assets.entry(rel_path.to_string()).or_default();
    entry.folder_id = folder_id.to_string();
}

fn video_manifest_add_relation(
    manifest: &mut VideoMediaManifest,
    output_path: &str,
    source_path: &str,
    via: &str,
    folder_id: Option<&str>,
) -> bool {
    let entry = manifest.assets.entry(output_path.to_string()).or_default();
    let mut changed = false;
    if let Some(folder_id) = folder_id {
        if entry.folder_id != folder_id {
            entry.folder_id = folder_id.to_string();
            changed = true;
        }
    }
    let exists = entry.relations.iter().any(|relation| {
        relation.relation_type == "derived-from"
            && relation.path == source_path
            && relation.via == via
    });
    if !exists {
        entry.relations.push(VideoMediaRelation {
            relation_type: "derived-from".to_string(),
            path: source_path.to_string(),
            via: via.to_string(),
        });
        changed = true;
    }
    changed
}

fn video_record_cloud_generation_relations(
    context: &VideoGenerateJobContext,
    output_paths: &[String],
) -> Result<bool, String> {
    if output_paths.is_empty() {
        return Ok(false);
    }
    let source_path = context
        .request
        .input_asset_paths
        .first()
        .map(|path| video_manifest_asset_path(&context.root, &context.media_root, path))
        .transpose()?;
    let audio_path = if context.model == "higgsfield_speak" {
        context
            .request
            .audio_asset_paths
            .first()
            .map(|path| video_manifest_asset_path(&context.root, &context.media_root, path))
            .transpose()?
    } else {
        None
    };
    if source_path.is_none() && audio_path.is_none() {
        return Ok(false);
    }
    let manifest_path = video_media_manifest_path(&context.media_root);
    let _guard = video_media_manifest_guard()?;
    let mut manifest = video_read_media_manifest(&manifest_path);
    let via = if context.mode == "upscale-video" || context.mode == "upscale-image" {
        "upscale"
    } else {
        "generate"
    };
    let source_folder = source_path.as_ref().and_then(|source_path| {
        if via == "upscale" {
            video_manifest_asset(&manifest, source_path).map(|asset| asset.folder_id.clone())
        } else {
            None
        }
    });
    let mut changed = false;
    for output_path in output_paths {
        let output_path =
            video_manifest_asset_path(&context.root, &context.media_root, output_path)?;
        if let Some(source_path) = source_path.as_deref() {
            changed |= video_manifest_add_relation(
                &mut manifest,
                &output_path,
                source_path,
                via,
                source_folder.as_deref(),
            );
        }
        if let Some(audio_path) = audio_path.as_deref() {
            changed |= video_manifest_add_relation(
                &mut manifest,
                &output_path,
                audio_path,
                "generate",
                None,
            );
        }
    }
    if changed {
        video_write_media_manifest(&manifest_path, &manifest)?;
    }
    Ok(changed)
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

fn video_canonicalize_deepest_existing(
    path: &std::path::Path,
    label: &str,
) -> Result<std::path::PathBuf, String> {
    let mut missing = Vec::<std::path::PathBuf>::new();
    let mut current = path;
    loop {
        match std::fs::canonicalize(current) {
            Ok(mut canonical) => {
                for component in missing.iter().rev() {
                    canonical.push(component);
                }
                return Ok(canonical);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let Some(name) = current.file_name() else {
                    return Err(format!("Unable to resolve {label}: {error}"));
                };
                missing.push(std::path::PathBuf::from(name));
                current = current
                    .parent()
                    .ok_or_else(|| format!("Unable to resolve {label}: {error}"))?;
            }
            Err(error) => return Err(format!("Unable to resolve {label}: {error}")),
        }
    }
}

fn video_verify_canonical_contained(
    root: &std::path::Path,
    candidate: &std::path::Path,
    error_message: &str,
) -> Result<(), String> {
    let canonical_root = std::fs::canonicalize(root)
        .map_err(|error| format!("Unable to resolve video root: {error}"))?;
    let canonical_candidate = video_canonicalize_deepest_existing(candidate, "video path")?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(error_message.to_string());
    }
    Ok(())
}

fn video_resolve_media_abs(
    root: &std::path::Path,
    media_root: &std::path::Path,
    raw_path: &str,
) -> Result<std::path::PathBuf, String> {
    let normalized = video_normalize_relative_path(raw_path)?;
    let abs = root.join(normalized);
    video_verify_canonical_contained(media_root, &abs, "Video path must stay under media/.")?;
    Ok(abs)
}

fn video_resolve_project_abs(
    root: &std::path::Path,
    media_root: &std::path::Path,
    project_path: &str,
) -> Result<std::path::PathBuf, String> {
    let abs = video_resolve_media_abs(root, media_root, project_path)?;
    video_verify_canonical_contained(
        &media_root.join(VIDEO_PROJECTS_DIR),
        &abs,
        "Video project path must stay under media/projects/.",
    )?;
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
        Some(
            name.trim_end_matches(VIDEO_PROJECT_LEGACY_EXTENSION)
                .to_string(),
        )
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
        "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg" | "oga" | "opus" | "weba" => Some("audio"),
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
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "weba" => "audio/webm",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tiff" => "image/tiff",
        _ => "application/octet-stream",
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

fn video_read_probe_cache(
    cache_path: &std::path::Path,
) -> serde_json::Map<String, serde_json::Value> {
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
    manifest: &VideoMediaManifest,
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
    let manifest_asset = video_manifest_asset_owned(manifest, &path);
    let has_own_transcript = matches!(kind, "audio" | "video")
        && video_transcript_cache_path(media_root, &path, &metadata)
            .map(|path| path.is_file())
            .unwrap_or(false);
    let transcript_inherited = if has_own_transcript || !matches!(kind, "audio" | "video") {
        false
    } else {
        video_find_inherited_transcript(root, media_root, manifest, &path)
            .ok()
            .flatten()
            .is_some()
    };
    let has_transcript = has_own_transcript || transcript_inherited;
    let thumbnail_data_url = if matches!(kind, "video" | "image") {
        ffmpeg_path.and_then(|ffmpeg| {
            let thumb_path = media_root
                .join(VIDEO_CACHE_DIR)
                .join(VIDEO_THUMBS_DIR)
                .join(format!("{}.jpg", video_sha1_hex(&cache_key)));
            if !thumb_path.is_file() && *thumbnails_generated < VIDEO_THUMBNAIL_LIMIT_PER_LIST {
                if video_generate_thumbnail(ffmpeg, abs_path, kind, duration_ms, &thumb_path)
                    .is_ok()
                {
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
        folder_id: manifest_asset.folder_id,
        relations: manifest_asset.relations,
        pending: false,
        job_id: None,
        size_bytes,
        modified_at_ms,
        duration_ms,
        width,
        height,
        has_audio,
        has_transcript,
        transcript_inherited,
        thumbnail_data_url,
    })
}

fn video_pending_generated_media_items(
    root: &std::path::Path,
    media_root: &std::path::Path,
) -> Vec<VideoMediaItem> {
    let jobs =
        video_read_generation_jobs(&video_generation_jobs_path(media_root)).unwrap_or_default();
    let mut items = Vec::new();
    for job in jobs {
        // Errored jobs must not leave ghost tiles in the library; a resume
        // clears the error and the tile comes back.
        if job.done || job.error.is_some() {
            continue;
        }
        for planned_path in &job.planned_paths {
            let Ok(normalized) = video_normalize_relative_path(planned_path) else {
                continue;
            };
            let abs = root.join(normalized);
            if abs.exists() || !abs.starts_with(media_root.join(VIDEO_GENERATED_DIR)) {
                continue;
            }
            let Some(kind) = video_media_kind_for_extension(&abs) else {
                continue;
            };
            items.push(VideoMediaItem {
                path: planned_path.clone(),
                abs_path: abs.to_string_lossy().to_string(),
                name: abs
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_string(),
                kind: kind.to_string(),
                folder: VIDEO_GENERATED_DIR.to_string(),
                folder_id: String::new(),
                relations: Vec::new(),
                pending: true,
                job_id: Some(job.job_id.clone()),
                size_bytes: 0,
                modified_at_ms: job.created_at_ms,
                duration_ms: None,
                width: None,
                height: None,
                has_audio: None,
                has_transcript: false,
                transcript_inherited: false,
                thumbnail_data_url: None,
            });
        }
    }
    items
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
) -> Result<std::path::PathBuf, String> {
    let path = media_root
        .join(VIDEO_CACHE_DIR)
        .join(VIDEO_TRANSCRIBE_DIR)
        .join(format!(
            "{}.mp3",
            video_media_cache_stem(rel_path, metadata)
        ));
    video_verify_canonical_contained(
        media_root,
        &path,
        "Video cache path must stay under media/.",
    )?;
    Ok(path)
}

fn video_transcript_cache_path(
    media_root: &std::path::Path,
    rel_path: &str,
    metadata: &std::fs::Metadata,
) -> Result<std::path::PathBuf, String> {
    let path = media_root
        .join(VIDEO_CACHE_DIR)
        .join(VIDEO_TRANSCRIPTS_DIR)
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

fn video_read_transcript_cache_file(
    transcript_path: &std::path::Path,
) -> Result<Option<VideoTranscriptCache>, String> {
    match std::fs::read_to_string(transcript_path) {
        Ok(raw) => serde_json::from_str::<VideoTranscriptCache>(&raw)
            .map(Some)
            .map_err(|error| format!("Unable to parse video transcript cache: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Unable to read video transcript cache: {error}")),
    }
}

fn video_read_own_transcript_cache(
    root: &std::path::Path,
    media_root: &std::path::Path,
    rel_path: &str,
) -> Result<Option<VideoTranscriptCache>, String> {
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
    if !matches!(kind, "audio" | "video") {
        return Ok(None);
    }
    let resolved_path = video_relative_path(root, &abs);
    let transcript_path = video_transcript_cache_path(media_root, &resolved_path, &metadata)?;
    video_read_transcript_cache_file(&transcript_path)
}

fn video_find_inherited_transcript(
    root: &std::path::Path,
    media_root: &std::path::Path,
    manifest: &VideoMediaManifest,
    rel_path: &str,
) -> Result<Option<(String, VideoTranscriptCache)>, String> {
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
            if relation.relation_type != "derived-from" || !visited.insert(relation.path.clone()) {
                continue;
            }
            let relation_abs = video_resolve_media_abs(root, media_root, relation.path.as_str())?;
            if !relation_abs.is_file() {
                continue;
            }
            if let Some(cache) =
                video_read_own_transcript_cache(root, media_root, relation.path.as_str())?
            {
                return Ok(Some((relation.path.clone(), cache)));
            }
            queue.push_back((relation.path.clone(), depth + 1));
        }
    }
    Ok(None)
}

fn video_resolve_transcript_cache(
    root: &std::path::Path,
    media_root: &std::path::Path,
    manifest: &VideoMediaManifest,
    rel_path: &str,
    metadata: &std::fs::Metadata,
) -> Result<Option<(Option<String>, VideoTranscriptCache)>, String> {
    let transcript_path = video_transcript_cache_path(media_root, rel_path, metadata)?;
    if let Some(cache) = video_read_transcript_cache_file(&transcript_path)? {
        return Ok(Some((None, cache)));
    }
    Ok(
        video_find_inherited_transcript(root, media_root, manifest, rel_path)?
            .map(|(inherited_from, cache)| (Some(inherited_from), cache)),
    )
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

fn video_run_ffmpeg_binary_stdout(
    ffmpeg_path: &str,
    args: &[String],
    timeout: std::time::Duration,
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
        .map_err(|error| format!("Unable to start ffmpeg frame render: {error}"))?;
    let stdout = child.stdout.take();
    let stdout_reader = stdout.map(|stdout| {
        std::thread::spawn(move || {
            use std::io::Read as _;
            let mut reader = std::io::BufReader::new(stdout);
            let mut output = Vec::new();
            let _ = reader.read_to_end(&mut output);
            output
        })
    });
    let stderr = child.stderr.take();
    let stderr_reader = stderr.map(|stderr| {
        std::thread::spawn(move || {
            use std::io::Read as _;
            let mut reader = std::io::BufReader::new(stderr);
            let mut output = Vec::new();
            let _ = reader.read_to_end(&mut output);
            String::from_utf8_lossy(&output).to_string()
        })
    });
    let started = std::time::Instant::now();
    let status = loop {
        match child
            .try_wait()
            .map_err(|error| format!("Unable to wait for ffmpeg frame render: {error}"))?
        {
            Some(status) => break status,
            None if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("ffmpeg frame render timed out.".to_string());
            }
            None => std::thread::sleep(std::time::Duration::from_millis(50)),
        }
    };
    let stdout = stdout_reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    let stderr = stderr_reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    if !status.success() || stdout.is_empty() {
        let detail = first_output_line(&stderr);
        return Err(if detail.is_empty() {
            "ffmpeg could not render the video frame.".to_string()
        } else {
            format!("ffmpeg could not render the video frame: {detail}")
        });
    }
    Ok(stdout)
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
    if first.is_empty() { None } else { Some(first) }
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

fn video_extract_zip_file(
    zip_path: &std::path::Path,
    destination: &std::path::Path,
) -> Result<(), String> {
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
fn video_extract_tar_file(
    tar_path: &std::path::Path,
    destination: &std::path::Path,
) -> Result<(), String> {
    let file = std::fs::File::open(tar_path)
        .map_err(|error| format!("Unable to open video tool tar archive: {error}"))?;
    let mut archive = tar::Archive::new(file);
    std::fs::create_dir_all(destination)
        .map_err(|error| format!("Unable to prepare video tool extraction directory: {error}"))?;
    let entries = archive
        .entries()
        .map_err(|error| format!("Unable to read video tool tar archive: {error}"))?;
    for entry in entries {
        let mut entry =
            entry.map_err(|error| format!("Unable to extract video tool archive: {error}"))?;
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
fn video_decompress_xz_to_tar(
    xz_path: &std::path::Path,
    tar_path: &std::path::Path,
) -> Result<(), String> {
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
    let roots =
        VIDEO_WATCH_ROOTS.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()));
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
        let collect = |event: notify::Result<notify::Event>,
                       paths: &mut std::collections::HashSet<String>| {
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
        let cache_path = media_root
            .join(VIDEO_CACHE_DIR)
            .join(VIDEO_PROBE_CACHE_FILE);
        let mut probe_cache = video_read_probe_cache(&cache_path);
        let mut probe_cache_dirty = false;
        let mut thumbnails_generated = 0usize;
        let manifest = video_read_media_manifest(&video_media_manifest_path(&media_root));
        for folder in [VIDEO_ASSETS_DIR, VIDEO_GENERATED_DIR] {
            for path in video_scan_media_files(&media_root.join(folder)) {
                if let Some(item) = video_build_media_item(
                    &root,
                    &media_root,
                    &manifest,
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
        items.extend(video_pending_generated_media_items(&root, &media_root));
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

#[tauri::command]
async fn video_media_manifest_get(repo_path: String) -> Result<VideoMediaManifestResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let manifest = video_read_media_manifest(&video_media_manifest_path(&media_root));
        Ok(VideoMediaManifestResponse {
            folders: manifest.folders,
            assets: manifest.assets,
        })
    })
    .await
    .map_err(|error| format!("Video media manifest get worker failed: {error}"))?
}

#[tauri::command]
async fn video_media_folder_create(
    app: tauri::AppHandle,
    repo_path: String,
    name: String,
) -> Result<VideoMediaFolderCreateResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err("Video media folder name is required.".to_string());
        }
        let manifest_path = video_media_manifest_path(&media_root);
        let _guard = video_media_manifest_guard()?;
        let mut manifest = video_read_media_manifest(&manifest_path);
        let id = video_manifest_slug_unique(&manifest, trimmed_name);
        manifest.folders.push(VideoMediaFolder {
            id: id.clone(),
            name: trimmed_name.to_string(),
        });
        video_write_media_manifest(&manifest_path, &manifest)?;
        video_emit_manifest_changed(&app, &root, &manifest_path);
        Ok(VideoMediaFolderCreateResponse { id })
    })
    .await
    .map_err(|error| format!("Video media folder create worker failed: {error}"))?
}

#[tauri::command]
async fn video_media_folder_rename(
    app: tauri::AppHandle,
    repo_path: String,
    folder_id: String,
    name: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let folder_id = folder_id.trim();
        let trimmed_name = name.trim();
        if folder_id.is_empty() || trimmed_name.is_empty() {
            return Err("Video media folder id and name are required.".to_string());
        }
        let manifest_path = video_media_manifest_path(&media_root);
        let _guard = video_media_manifest_guard()?;
        let mut manifest = video_read_media_manifest(&manifest_path);
        let folder = manifest
            .folders
            .iter_mut()
            .find(|folder| folder.id == folder_id)
            .ok_or_else(|| format!("Video media folder not found: {folder_id}"))?;
        folder.name = trimmed_name.to_string();
        video_write_media_manifest(&manifest_path, &manifest)?;
        video_emit_manifest_changed(&app, &root, &manifest_path);
        Ok(())
    })
    .await
    .map_err(|error| format!("Video media folder rename worker failed: {error}"))?
}

#[tauri::command]
async fn video_media_folder_delete(
    app: tauri::AppHandle,
    repo_path: String,
    folder_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let folder_id = folder_id.trim();
        if folder_id.is_empty() {
            return Err("Video media folder id is required.".to_string());
        }
        let manifest_path = video_media_manifest_path(&media_root);
        let _guard = video_media_manifest_guard()?;
        let mut manifest = video_read_media_manifest(&manifest_path);
        let before = manifest.folders.len();
        manifest.folders.retain(|folder| folder.id != folder_id);
        if manifest.folders.len() == before {
            return Err(format!("Video media folder not found: {folder_id}"));
        }
        let empty_assets = manifest
            .assets
            .iter_mut()
            .filter_map(|(path, asset)| {
                if asset.folder_id == folder_id {
                    asset.folder_id.clear();
                }
                (asset.folder_id.is_empty() && asset.relations.is_empty()).then(|| path.clone())
            })
            .collect::<Vec<_>>();
        for path in empty_assets {
            manifest.assets.remove(&path);
        }
        video_write_media_manifest(&manifest_path, &manifest)?;
        video_emit_manifest_changed(&app, &root, &manifest_path);
        Ok(())
    })
    .await
    .map_err(|error| format!("Video media folder delete worker failed: {error}"))?
}

#[tauri::command]
async fn video_media_set_folder(
    app: tauri::AppHandle,
    repo_path: String,
    path: String,
    folder_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let (_abs, rel_path, _kind, _metadata) =
            video_resolve_existing_media_file(&root, &media_root, path.as_str())?;
        let rel_path = video_manifest_asset_path(&root, &media_root, rel_path.as_str())?;
        let folder_id = folder_id.trim().to_string();
        let manifest_path = video_media_manifest_path(&media_root);
        let _guard = video_media_manifest_guard()?;
        let mut manifest = video_read_media_manifest(&manifest_path);
        if !video_manifest_folder_exists(&manifest, folder_id.as_str()) {
            return Err(format!("Video media folder not found: {folder_id}"));
        }
        video_manifest_set_asset_folder(&mut manifest, &rel_path, folder_id.as_str());
        if manifest
            .assets
            .get(&rel_path)
            .is_some_and(|asset| asset.folder_id.is_empty() && asset.relations.is_empty())
        {
            manifest.assets.remove(&rel_path);
        }
        video_write_media_manifest(&manifest_path, &manifest)?;
        video_emit_manifest_changed(&app, &root, &manifest_path);
        Ok(())
    })
    .await
    .map_err(|error| format!("Video media set folder worker failed: {error}"))?
}

fn video_destination_candidate(
    directory: &std::path::Path,
    file_name: &str,
    index: u32,
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
    let name = if index == 0 {
        format!("{stem}.{extension}")
    } else {
        format!("{stem}-{index}.{extension}")
    };
    directory.join(name)
}

fn video_destination_with_collision(
    directory: &std::path::Path,
    file_name: &str,
) -> std::path::PathBuf {
    let mut index = 0u32;
    loop {
        let candidate = video_destination_candidate(directory, file_name, index);
        if !candidate.exists() {
            return candidate;
        }
        index = index.saturating_add(1);
    }
}

fn video_copy_to_unique_destination(
    source_path: &std::path::Path,
    directory: &std::path::Path,
    file_name: &str,
) -> Result<std::path::PathBuf, String> {
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to create video media import directory: {error}"))?;
    let _guard = video_media_import_guard()?;
    for index in 0..10_000u32 {
        let destination = video_destination_candidate(directory, file_name, index);
        let mut output = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
        {
            Ok(output) => output,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Unable to import video media: {error}")),
        };
        let copy_result = (|| -> Result<(), std::io::Error> {
            let mut input = std::fs::File::open(source_path)?;
            std::io::copy(&mut input, &mut output)?;
            Ok(())
        })();
        if let Err(error) = copy_result {
            let _ = std::fs::remove_file(&destination);
            return Err(format!("Unable to import video media: {error}"));
        }
        return Ok(destination);
    }
    Err("Unable to import video media: too many destination name collisions.".to_string())
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
        let mut probe_cache = video_read_probe_cache(
            &media_root
                .join(VIDEO_CACHE_DIR)
                .join(VIDEO_PROBE_CACHE_FILE),
        );
        let mut probe_cache_dirty = false;
        let mut thumbnails_generated = 0usize;
        let manifest = video_read_media_manifest(&video_media_manifest_path(&media_root));
        let mut imported = Vec::new();
        let mut changed_paths = Vec::new();
        for source in source_paths {
            let source_path = std::path::PathBuf::from(source.trim());
            if !source_path.is_absolute() || !source_path.is_file() {
                return Err(format!(
                    "Video import source is not a file: {}",
                    source_path.display()
                ));
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
            let destination =
                video_copy_to_unique_destination(&source_path, &assets_dir, file_name)?;
            changed_paths.push(video_relative_path(&root, &destination));
            if let Some(item) = video_build_media_item(
                &root,
                &media_root,
                &manifest,
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
                &media_root
                    .join(VIDEO_CACHE_DIR)
                    .join(VIDEO_PROBE_CACHE_FILE),
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
        let manifest_path = video_media_manifest_path(&media_root);
        let _guard = video_media_manifest_guard()?;
        let mut manifest = video_read_media_manifest(&manifest_path);
        let mut manifest_changed = manifest.assets.remove(&rel_path).is_some();
        let mut empty_assets = Vec::new();
        for (asset_path, asset) in manifest.assets.iter_mut() {
            let before = asset.relations.len();
            asset.relations.retain(|relation| relation.path != rel_path);
            if asset.relations.len() != before {
                manifest_changed = true;
            }
            if asset.folder_id.is_empty() && asset.relations.is_empty() {
                empty_assets.push(asset_path.clone());
            }
        }
        for asset_path in empty_assets {
            if manifest.assets.remove(&asset_path).is_some() {
                manifest_changed = true;
            }
        }
        if manifest_changed {
            video_write_media_manifest(&manifest_path, &manifest)?;
        }
        let cache_path = media_root
            .join(VIDEO_CACHE_DIR)
            .join(VIDEO_PROBE_CACHE_FILE);
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
        let paths = if manifest_changed {
            vec![rel_path.clone(), video_relative_path(&root, &manifest_path)]
        } else {
            vec![rel_path.clone()]
        };
        let _ = app.emit(
            VIDEO_STORE_CHANGED_EVENT,
            serde_json::json!({
                "repoPath": root.to_string_lossy().to_string(),
                "paths": paths,
                "manifestPath": manifest_changed.then(|| video_relative_path(&root, &manifest_path)),
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
        let ffmpeg_path = status.ffmpeg.path.ok_or_else(|| {
            "ffmpeg is required to generate video media waveforms. Install video tools first."
                .to_string()
        })?;
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
        let pcm =
            video_run_ffmpeg_stdout_limited(&ffmpeg_path, &args, VIDEO_WAVEFORM_PCM_LIMIT_BYTES)?;
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
        let ffmpeg_path = status.ffmpeg.path.ok_or_else(|| {
            "ffmpeg is required to generate video filmstrips. Install video tools first."
                .to_string()
        })?;
        let ffprobe_path = status.ffprobe.path.ok_or_else(|| {
            "ffprobe is required to generate video filmstrips. Install video tools first."
                .to_string()
        })?;
        let probe = video_probe_media(&ffprobe_path, &abs).ok_or_else(|| {
            "Unable to probe video duration for filmstrip generation.".to_string()
        })?;
        let duration_ms = probe
            .duration_ms
            .filter(|duration| *duration > 0)
            .ok_or_else(|| "Video duration is required to generate a filmstrip.".to_string())?;
        let cache_dir = media_root.join(VIDEO_CACHE_DIR).join(VIDEO_FILMSTRIPS_DIR);
        std::fs::create_dir_all(&cache_dir).map_err(|error| {
            format!("Unable to create video filmstrip cache directory: {error}")
        })?;
        let cache_stem = video_cache_file_stem(&rel_path, &metadata, frame_count);
        let input = abs.to_string_lossy().to_string();
        let mut data_urls = Vec::with_capacity(frame_count);
        for index in 0..frame_count {
            let frame_path = cache_dir.join(format!("{cache_stem}-{index}.jpg"));
            if !frame_path.is_file() {
                let output = frame_path.to_string_lossy().to_string();
                let seconds =
                    (duration_ms as f64 / 1000.0) * ((index as f64 + 0.5) / frame_count as f64);
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
                    let detail =
                        first_output_line(&command_output_text(&capture.stdout, &capture.stderr));
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

fn video_transcribe_terminal_errors()
-> &'static std::sync::Mutex<std::collections::HashMap<String, String>> {
    VIDEO_TRANSCRIBE_TERMINAL_ERRORS
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn video_transcribe_terminal_error_key(root: &std::path::Path, rel_path: &str) -> String {
    format!("{}|{}", root.to_string_lossy(), rel_path.replace('\\', "/"))
}

fn video_transcribe_clear_terminal_error(root: &std::path::Path, rel_path: &str) {
    if let Ok(mut guard) = video_transcribe_terminal_errors().lock() {
        guard.remove(&video_transcribe_terminal_error_key(root, rel_path));
    }
}

fn video_transcribe_record_terminal_error(root: &std::path::Path, rel_path: &str, error: &str) {
    if let Ok(mut guard) = video_transcribe_terminal_errors().lock() {
        guard.insert(
            video_transcribe_terminal_error_key(root, rel_path),
            error.to_string(),
        );
    }
}

fn video_transcribe_terminal_error(root: &std::path::Path, rel_path: &str) -> Option<String> {
    video_transcribe_terminal_errors()
        .lock()
        .ok()
        .and_then(|guard| {
            guard
                .get(&video_transcribe_terminal_error_key(root, rel_path))
                .cloned()
        })
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
        std::fs::create_dir_all(parent).map_err(|error| {
            format!("Unable to create video transcription cache directory: {error}")
        })?;
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
                std::fs::rename(&temp_abs, &output_abs).map_err(|error| {
                    format!("Unable to finalize transcription audio cache: {error}")
                })?;
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
                    let words = item
                        .get("words")
                        .and_then(|value| value.as_array())
                        .map(|words| {
                            words
                                .iter()
                                .filter_map(|word| {
                                    let text = word
                                        .get("text")
                                        .and_then(serde_json::Value::as_str)
                                        .unwrap_or_default()
                                        .trim()
                                        .to_string();
                                    if text.is_empty() {
                                        return None;
                                    }
                                    let start_ms = word
                                        .get("startMs")
                                        .or_else(|| word.get("start_ms"))
                                        .and_then(serde_json::Value::as_u64)
                                        .unwrap_or(0);
                                    let end_ms = word
                                        .get("endMs")
                                        .or_else(|| word.get("end_ms"))
                                        .and_then(serde_json::Value::as_u64)
                                        .unwrap_or(start_ms);
                                    Some(VideoTranscriptWord {
                                        start_ms,
                                        end_ms: end_ms.max(start_ms),
                                        text,
                                    })
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    Some(VideoTranscriptSegment {
                        start_ms,
                        end_ms: end_ms.max(start_ms),
                        text,
                        words,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn video_validate_transcript_segments(segments: &[VideoTranscriptSegment]) -> Result<(), String> {
    for segment in segments {
        if segment.start_ms > segment.end_ms {
            return Err(
                "Transcript segment startMs must be less than or equal to endMs.".to_string(),
            );
        }
        for word in &segment.words {
            if word.start_ms > word.end_ms {
                return Err(
                    "Transcript word startMs must be less than or equal to endMs.".to_string(),
                );
            }
        }
    }
    Ok(())
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
    force: bool,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    let terminal_root = resolve_workspace_root_directory(Some(repo_path.as_str())).ok();
    if let Some(root) = terminal_root.as_deref() {
        video_transcribe_clear_terminal_error(root, &path);
    }
    let result = async {
        use base64::Engine as _;
        video_emit_transcribe_progress(
            &app,
            &job_id,
            &path,
            "extracting",
            Some(12.0),
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
        let transcript_path = video_transcript_cache_path(&media_root, &rel_path, &metadata)?;
        if force {
            match std::fs::remove_file(&transcript_path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!("Unable to remove cached transcript: {error}"));
                }
            }
        } else if transcript_path.is_file() {
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
            let cache_path = video_transcribe_mp3_cache_path(&media_root, &rel_path, &metadata)?;
            if force {
                match std::fs::remove_file(&cache_path) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => {
                        return Err(format!(
                            "Unable to remove cached transcription audio: {error}"
                        ));
                    }
                }
            }
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
            Some(38.0),
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
            "kind": "media_transcribe_request",
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
            Some(66.0),
            false,
            None,
        );
        let response = cloud_mcp_ws_request_once_with_timeout(
            &cloud_state,
            "media_transcribe_request",
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
        if let Some(root) = terminal_root.as_deref() {
            video_transcribe_record_terminal_error(root, &path, &error);
        }
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
    force: Option<bool>,
) -> Result<VideoJobStartResult, String> {
    if let Ok((root, _media_root)) = video_workspace_media_root(repo_path.as_str()) {
        video_transcribe_clear_terminal_error(&root, &path);
    }
    let (job_id, cancel) = video_job_registry_insert(&VIDEO_TRANSCRIBE_JOBS)?;
    tauri::async_runtime::spawn(video_transcribe_worker(
        app,
        cloud_state.inner().clone(),
        job_id.clone(),
        repo_path,
        path,
        force.unwrap_or(false),
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
        let manifest = video_read_media_manifest(&video_media_manifest_path(&media_root));
        if let Some((inherited_from, cache)) =
            video_resolve_transcript_cache(&root, &media_root, &manifest, &rel_path, &metadata)?
        {
            return Ok(VideoTranscriptGetResponse {
                available: true,
                language: cache.language,
                text: cache.text,
                segments: cache.segments,
                inherited: inherited_from.is_some(),
                inherited_from,
            });
        }
        Ok(VideoTranscriptGetResponse {
            available: false,
            language: None,
            text: String::new(),
            segments: Vec::new(),
            inherited: false,
            inherited_from: None,
        })
    })
    .await
    .map_err(|error| format!("Video transcript cache worker failed: {error}"))?
}

#[tauri::command]
async fn video_transcript_update(
    app: tauri::AppHandle,
    repo_path: String,
    path: String,
    transcript: VideoTranscriptUpdateInput,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let (_abs, rel_path, kind, metadata) =
            video_resolve_existing_media_file(&root, &media_root, path.as_str())?;
        if !matches!(kind, "audio" | "video") {
            return Err("Transcripts are only available for audio or video media.".to_string());
        }
        video_validate_transcript_segments(&transcript.segments)?;
        let transcript_path = video_transcript_cache_path(&media_root, &rel_path, &metadata)?;
        let cache = VideoTranscriptCache {
            language: transcript
                .language
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            text: video_transcript_text(&transcript.segments),
            segments: transcript.segments,
        };
        video_write_json_cache(&transcript_path, &cache, "video transcript")?;
        let _ = app.emit(
            VIDEO_TRANSCRIPT_UPDATED_EVENT,
            serde_json::json!({
                "repoPath": root.to_string_lossy().to_string(),
                "path": rel_path,
            }),
        );
        Ok(())
    })
    .await
    .map_err(|error| format!("Video transcript update worker failed: {error}"))?
}

// Removes a media file's cached transcript entirely (the media itself is
// untouched). hasTranscript flips false on the next media list.
#[tauri::command]
async fn video_transcript_delete(
    app: tauri::AppHandle,
    repo_path: String,
    path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let (_abs, rel_path, kind, metadata) =
            video_resolve_existing_media_file(&root, &media_root, path.as_str())?;
        if !matches!(kind, "audio" | "video") {
            return Err("Transcripts are only available for audio or video media.".to_string());
        }
        let transcript_path = video_transcript_cache_path(&media_root, &rel_path, &metadata)?;
        match std::fs::remove_file(&transcript_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err("No transcript exists for this media.".to_string());
            }
            Err(error) => {
                return Err(format!("Unable to delete transcript: {error}"));
            }
        }
        let _ = app.emit(
            VIDEO_TRANSCRIPT_UPDATED_EVENT,
            serde_json::json!({
                "repoPath": root.to_string_lossy().to_string(),
                "path": rel_path,
                "deleted": true,
            }),
        );
        Ok(())
    })
    .await
    .map_err(|error| format!("Video transcript delete worker failed: {error}"))?
}

fn video_format_subtitle_time(ms: u64, separator: char) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1000;
    let millis = ms % 1000;
    format!("{hours:02}:{minutes:02}:{seconds:02}{separator}{millis:03}")
}

fn video_render_transcript_srt(segments: &[VideoTranscriptSegment]) -> String {
    let mut output = String::new();
    for (index, segment) in segments.iter().enumerate() {
        output.push_str(&(index + 1).to_string());
        output.push('\n');
        output.push_str(&format!(
            "{} --> {}\n",
            video_format_subtitle_time(segment.start_ms, ','),
            video_format_subtitle_time(segment.end_ms, ',')
        ));
        output.push_str(segment.text.as_str());
        output.push_str("\n\n");
    }
    output
}

fn video_render_transcript_vtt(segments: &[VideoTranscriptSegment]) -> String {
    let mut output = String::from("WEBVTT\n\n");
    for segment in segments {
        output.push_str(&format!(
            "{} --> {}\n",
            video_format_subtitle_time(segment.start_ms, '.'),
            video_format_subtitle_time(segment.end_ms, '.')
        ));
        output.push_str(segment.text.as_str());
        output.push_str("\n\n");
    }
    output
}

#[tauri::command]
async fn video_transcript_export(
    repo_path: String,
    path: String,
    format: String,
) -> Result<VideoTranscriptExportResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let (abs, rel_path, kind, metadata) =
            video_resolve_existing_media_file(&root, &media_root, path.as_str())?;
        if !matches!(kind, "audio" | "video") {
            return Err("Transcripts are only available for audio or video media.".to_string());
        }
        let manifest = video_read_media_manifest(&video_media_manifest_path(&media_root));
        let (_inherited_from, cache) =
            video_resolve_transcript_cache(&root, &media_root, &manifest, &rel_path, &metadata)?
                .ok_or_else(|| "No transcript exists for this media.".to_string())?;
        let extension = match format.trim().to_ascii_lowercase().as_str() {
            "srt" => "srt",
            "vtt" => "vtt",
            _ => return Err("Transcript export format must be srt or vtt.".to_string()),
        };
        let source_stem = abs
            .file_stem()
            .and_then(|value| value.to_str())
            .map(|value| video_safe_file_stem(value, "transcript"))
            .unwrap_or_else(|| "transcript".to_string());
        let output_abs = video_destination_with_collision(
            &media_root.join(VIDEO_EXPORTS_DIR),
            format!("{source_stem}.{extension}").as_str(),
        );
        if let Some(parent) = output_abs.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!("Unable to create transcript export directory: {error}")
            })?;
        }
        let body = if extension == "srt" {
            video_render_transcript_srt(&cache.segments)
        } else {
            video_render_transcript_vtt(&cache.segments)
        };
        std::fs::write(&output_abs, body)
            .map_err(|error| format!("Unable to write transcript export: {error}"))?;
        Ok(VideoTranscriptExportResponse {
            output_path: output_abs.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|error| format!("Video transcript export worker failed: {error}"))?
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
        let ffmpeg_path = status.ffmpeg.path.ok_or_else(|| {
            "ffmpeg is required to extract video frames. Install video tools first.".to_string()
        })?;
        let ffprobe_path = status.ffprobe.path.ok_or_else(|| {
            "ffprobe is required to extract video frames. Install video tools first.".to_string()
        })?;
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
        let output_abs =
            video_destination_with_collision(&assets_dir, format!("{safe_name}.png").as_str());
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
            let detail = first_output_line(&command_output_text(&capture.stdout, &capture.stderr));
            return Err(if detail.is_empty() {
                "ffmpeg could not extract the video frame.".to_string()
            } else {
                format!("ffmpeg could not extract the video frame: {detail}")
            });
        }
        let mut probe_cache = video_read_probe_cache(
            &media_root
                .join(VIDEO_CACHE_DIR)
                .join(VIDEO_PROBE_CACHE_FILE),
        );
        let mut probe_cache_dirty = false;
        let mut thumbnails_generated = 0usize;
        let manifest = video_read_media_manifest(&video_media_manifest_path(&media_root));
        let item = video_build_media_item(
            &root,
            &media_root,
            &manifest,
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
                &media_root
                    .join(VIDEO_CACHE_DIR)
                    .join(VIDEO_PROBE_CACHE_FILE),
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

const VIDEO_PIPE_HEADER: &str = "#diffforge-video 1\n# syntax: project \"<name>\" <W>x<H> [fps=30] [bg=#000000]\n#   track <video|audio|text> \"<label>\" [muted] [locked]\n#   c <asset-path> at=<ms> dur=<ms> [in=<ms>] [speed=<f>] [gain=<f>] [kf=<ms>:<lvl>,...] [kfo=<ms>:<value>[:l|h|s],...] [kfx=...] [kfy=...] [kfs=...] [link=<id>] [x=] [y=] [scale=] [opacity=]\n#   t \"<text>\" at=<ms> dur=<ms> [cap=<id>] [size=48] [color=#ffffff] [bg=] [outline=#000000] [outlinew=0] [shadow] [upper] [x=0.5] [y=0.85] [align=center] [plain] [font=]\n";

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
                        return Err(video_pipe_line_error(
                            line_number,
                            "unterminated escape sequence",
                        ));
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
        return Err(video_pipe_line_error(
            line_number,
            "unterminated quoted string",
        ));
    }
    if token_started {
        tokens.push(current);
    }
    Ok(tokens)
}

fn video_pipe_key_value(token: &str) -> Option<(&str, &str)> {
    token.split_once('=').and_then(|(key, value)| {
        if key.is_empty() {
            None
        } else {
            Some((key, value))
        }
    })
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
        return Err(video_pipe_line_error(
            line_number,
            "project dimensions must be <W>x<H>",
        ));
    };
    if width.is_empty() || height.is_empty() {
        return Err(video_pipe_line_error(
            line_number,
            "project dimensions must be <W>x<H>",
        ));
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
            return Err(video_pipe_line_error(
                line_number,
                "invalid kf=<ms>:<level> entry",
            ));
        };
        keyframes.push((
            video_pipe_parse_u64(at_ms, "kf", line_number)?,
            video_pipe_parse_f64(level, "kf", line_number)?,
        ));
    }
    Ok(keyframes)
}

fn video_pipe_easing_from_code(value: &str, line_number: usize) -> Result<&'static str, String> {
    match value {
        "" | "l" => Ok("linear"),
        "h" => Ok("hold"),
        "s" => Ok("smooth"),
        _ => Err(video_pipe_line_error(
            line_number,
            "keyframe easing must be l, h, or s",
        )),
    }
}

fn video_pipe_easing_code(value: &str) -> &'static str {
    match value {
        "hold" => "h",
        "smooth" => "s",
        _ => "l",
    }
}

fn video_pipe_parse_property_keyframes(
    value: &str,
    key: &str,
    line_number: usize,
) -> Result<Vec<serde_json::Value>, String> {
    if value.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut keyframes = Vec::new();
    for part in value.split(',') {
        let fields = part.split(':').collect::<Vec<_>>();
        if !(fields.len() == 2 || fields.len() == 3) {
            return Err(video_pipe_line_error(
                line_number,
                &format!("invalid {key}=<ms>:<value>[:e] entry"),
            ));
        }
        let at_ms = video_pipe_parse_u64(fields[0], key, line_number)?;
        let value = video_pipe_parse_f64(fields[1], key, line_number)?;
        let easing =
            video_pipe_easing_from_code(fields.get(2).copied().unwrap_or(""), line_number)?;
        keyframes.push(serde_json::json!({
            "atMs": at_ms,
            "value": value,
            "easing": easing,
        }));
    }
    keyframes.sort_by_key(|keyframe| video_json_u64(keyframe, "atMs", 0));
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
                    return Err(video_pipe_line_error(
                        line_number,
                        "media clip must follow a track",
                    ));
                };
                if !matches!(tracks[track_index].kind.as_str(), "video" | "audio") {
                    return Err(video_pipe_line_error(
                        line_number,
                        "media clip can only be used under video or audio tracks",
                    ));
                }
                if tokens.len() < 2 || tokens[1].trim().is_empty() {
                    return Err(video_pipe_line_error(
                        line_number,
                        "media clip requires an asset path",
                    ));
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
                let mut link_id = String::new();
                let mut kf = serde_json::Map::<String, serde_json::Value>::new();
                for token in tokens.iter().skip(2) {
                    if let Some((key, value)) = video_pipe_key_value(token) {
                        match key {
                            "at" => {
                                timeline_start_ms =
                                    Some(video_pipe_parse_u64(value, key, line_number)?)
                            }
                            "dur" => {
                                duration_ms = Some(video_pipe_parse_u64(value, key, line_number)?)
                            }
                            "in" => source_in_ms = video_pipe_parse_u64(value, key, line_number)?,
                            "speed" => speed = video_pipe_parse_f64(value, key, line_number)?,
                            "gain" => gain_level = video_pipe_parse_f64(value, key, line_number)?,
                            "kf" => {
                                gain_keyframes = video_pipe_parse_keyframes(value, line_number)?
                            }
                            "x" => x = video_pipe_parse_f64(value, key, line_number)?,
                            "y" => y = video_pipe_parse_f64(value, key, line_number)?,
                            "scale" => scale = video_pipe_parse_f64(value, key, line_number)?,
                            "opacity" => opacity = video_pipe_parse_f64(value, key, line_number)?,
                            "kfo" => {
                                kf.insert(
                                    "opacity".to_string(),
                                    serde_json::Value::Array(video_pipe_parse_property_keyframes(
                                        value,
                                        key,
                                        line_number,
                                    )?),
                                );
                            }
                            "kfx" => {
                                kf.insert(
                                    "x".to_string(),
                                    serde_json::Value::Array(video_pipe_parse_property_keyframes(
                                        value,
                                        key,
                                        line_number,
                                    )?),
                                );
                            }
                            "kfy" => {
                                kf.insert(
                                    "y".to_string(),
                                    serde_json::Value::Array(video_pipe_parse_property_keyframes(
                                        value,
                                        key,
                                        line_number,
                                    )?),
                                );
                            }
                            "kfs" => {
                                kf.insert(
                                    "scale".to_string(),
                                    serde_json::Value::Array(video_pipe_parse_property_keyframes(
                                        value,
                                        key,
                                        line_number,
                                    )?),
                                );
                            }
                            "link" => link_id = value.to_string(),
                            _ => {}
                        }
                    }
                }
                let Some(timeline_start_ms) = timeline_start_ms else {
                    return Err(video_pipe_line_error(
                        line_number,
                        "media clip requires at=<ms>",
                    ));
                };
                let Some(duration_ms) = duration_ms else {
                    return Err(video_pipe_line_error(
                        line_number,
                        "media clip requires dur=<ms>",
                    ));
                };
                clip_count += 1;
                let keyframes = gain_keyframes
                    .into_iter()
                    .map(|(at_ms, level)| serde_json::json!({ "atMs": at_ms, "level": level }))
                    .collect::<Vec<_>>();
                let mut clip = serde_json::json!({
                    "id": format!("c{clip_count}"),
                    "assetPath": tokens[1],
                    "timelineStartMs": timeline_start_ms,
                    "durationMs": duration_ms,
                    "sourceInMs": source_in_ms,
                    "speed": speed,
                    "linkId": link_id,
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
                });
                if !kf.is_empty() {
                    if let Some(object) = clip.as_object_mut() {
                        object.insert("kf".to_string(), serde_json::Value::Object(kf));
                    }
                }
                tracks[track_index].clips.push(clip);
            }
            "t" => {
                let Some(track_index) = current_track_index else {
                    return Err(video_pipe_line_error(
                        line_number,
                        "text clip must follow a track",
                    ));
                };
                if tracks[track_index].kind != "text" {
                    return Err(video_pipe_line_error(
                        line_number,
                        "text clip can only be used under text tracks",
                    ));
                }
                if tokens.len() < 2 {
                    return Err(video_pipe_line_error(
                        line_number,
                        "text clip requires text",
                    ));
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
                let mut caption_group = String::new();
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
                            "at" => {
                                timeline_start_ms =
                                    Some(video_pipe_parse_u64(value, key, line_number)?)
                            }
                            "dur" => {
                                duration_ms = Some(video_pipe_parse_u64(value, key, line_number)?)
                            }
                            "size" => font_size = video_pipe_parse_f64(value, key, line_number)?,
                            "color" => color = value.to_string(),
                            "bg" => background = value.to_string(),
                            "outline" => outline_color = value.to_string(),
                            "outlinew" => {
                                outline_width = video_pipe_parse_f64(value, key, line_number)?
                            }
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
                            "cap" => caption_group = value.to_string(),
                            _ => {}
                        }
                    }
                }
                let Some(timeline_start_ms) = timeline_start_ms else {
                    return Err(video_pipe_line_error(
                        line_number,
                        "text clip requires at=<ms>",
                    ));
                };
                let Some(duration_ms) = duration_ms else {
                    return Err(video_pipe_line_error(
                        line_number,
                        "text clip requires dur=<ms>",
                    ));
                };
                clip_count += 1;
                tracks[track_index].clips.push(serde_json::json!({
                    "id": format!("c{clip_count}"),
                    "text": tokens[1],
                    "captionGroup": caption_group,
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
    if text == "-0" { "0".to_string() } else { text }
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

fn video_pipe_property_keyframe_parts(keyframes: &serde_json::Value) -> Vec<String> {
    let mut entries = keyframes
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|keyframe| {
            let at_ms = video_json_u64(&keyframe, "atMs", 0);
            let value = video_pipe_format_f64(video_json_f64(&keyframe, "value", 0.0));
            let easing = video_pipe_easing_code(
                keyframe
                    .get("easing")
                    .and_then(|value| value.as_str())
                    .unwrap_or("linear"),
            );
            (at_ms, value, easing)
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|(at_ms, _, _)| *at_ms);
    entries
        .into_iter()
        .map(|(at_ms, value, easing)| {
            if easing == "l" {
                format!("{at_ms}:{value}")
            } else {
                format!("{at_ms}:{value}:{easing}")
            }
        })
        .collect()
}

fn video_pipe_push_property_keyframes(
    line: &mut String,
    key: &str,
    kf: &serde_json::Value,
    property: &str,
) {
    let parts = kf
        .get(property)
        .map(video_pipe_property_keyframe_parts)
        .unwrap_or_default();
    if !parts.is_empty() {
        line.push(' ');
        line.push_str(key);
        line.push('=');
        line.push_str(&parts.join(","));
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
    let mut project_line = format!(
        "project {} {width}x{height}",
        video_pipe_quote_string(&name)
    );
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
        if track
            .get("muted")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
        {
            track_line.push_str(" muted");
        }
        if track
            .get("locked")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
        {
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
                video_pipe_push_string_key(
                    &mut line,
                    "cap",
                    &video_json_string(&clip, "captionGroup", ""),
                    "",
                );
                video_pipe_push_f64_key(
                    &mut line,
                    "size",
                    video_json_f64(style, "fontSize", 48.0),
                    48.0,
                );
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
                if style
                    .get("shadow")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
                {
                    line.push_str(" shadow");
                }
                if style
                    .get("uppercase")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
                {
                    line.push_str(" upper");
                }
                video_pipe_push_f64_key(&mut line, "x", video_json_f64(style, "x", 0.5), 0.5);
                video_pipe_push_f64_key(&mut line, "y", video_json_f64(style, "y", 0.85), 0.85);
                let align = video_json_string(style, "align", "center");
                if !matches!(align.as_str(), "left" | "center" | "right") {
                    return Err("Video text clip align must be left, center, or right.".to_string());
                }
                video_pipe_push_string_key(&mut line, "align", &align, "center");
                if !style
                    .get("bold")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(true)
                {
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
            let kf = clip.get("kf").unwrap_or(&serde_json::Value::Null);
            video_pipe_push_property_keyframes(&mut line, "kfo", kf, "opacity");
            video_pipe_push_property_keyframes(&mut line, "kfx", kf, "x");
            video_pipe_push_property_keyframes(&mut line, "kfy", kf, "y");
            video_pipe_push_property_keyframes(&mut line, "kfs", kf, "scale");
            video_pipe_push_string_key(
                &mut line,
                "link",
                &video_json_string(&clip, "linkId", ""),
                "",
            );
            video_pipe_push_f64_key(&mut line, "x", video_json_f64(transform, "x", 0.0), 0.0);
            video_pipe_push_f64_key(&mut line, "y", video_json_f64(transform, "y", 0.0), 0.0);
            video_pipe_push_f64_key(
                &mut line,
                "scale",
                video_json_f64(transform, "scale", 1.0),
                1.0,
            );
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
        video_pipe_parse_project(&raw)
            .map_err(|error| format!("Unable to parse video project: {error}"))?
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
                        if *existing_is_pipe
                            || (!is_pipe && existing.updated_at_ms >= updated_at_ms) => {}
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
async fn video_project_create(
    repo_path: String,
    name: String,
) -> Result<serde_json::Value, String> {
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

fn video_mcp_default_settings() -> serde_json::Value {
    serde_json::json!({
        "width": 1920,
        "height": 1080,
        "fps": 30,
        "background": "#000000",
    })
}

fn video_mcp_default_speed() -> f64 {
    1.0
}

fn video_mcp_default_gain_level() -> f64 {
    1.0
}

fn video_mcp_default_transform_scale() -> f64 {
    1.0
}

fn video_mcp_default_transform_opacity() -> f64 {
    1.0
}

fn video_mcp_default_duration() -> u64 {
    1000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct VideoMcpProject {
    version: u64,
    name: String,
    settings: serde_json::Value,
    tracks: Vec<VideoMcpTrack>,
    updated_at_ms: u64,
}

impl Default for VideoMcpProject {
    fn default() -> Self {
        Self {
            version: 1,
            name: "untitled".to_string(),
            settings: video_mcp_default_settings(),
            tracks: Vec::new(),
            updated_at_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct VideoMcpTrack {
    id: String,
    kind: String,
    label: String,
    muted: bool,
    locked: bool,
    clips: Vec<VideoMcpClip>,
}

impl Default for VideoMcpTrack {
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: "video".to_string(),
            label: String::new(),
            muted: false,
            locked: false,
            clips: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct VideoMcpClip {
    id: String,
    asset_path: String,
    text: String,
    timeline_start_ms: u64,
    #[serde(default = "video_mcp_default_duration")]
    duration_ms: u64,
    source_in_ms: u64,
    #[serde(default = "video_mcp_default_speed")]
    speed: f64,
    link_id: String,
    gain: VideoMcpGain,
    transform: VideoMcpTransform,
    kf: std::collections::BTreeMap<String, Vec<VideoMcpPropKeyframe>>,
    style: serde_json::Value,
    caption_group: String,
}

impl Default for VideoMcpClip {
    fn default() -> Self {
        Self {
            id: String::new(),
            asset_path: String::new(),
            text: String::new(),
            timeline_start_ms: 0,
            duration_ms: video_mcp_default_duration(),
            source_in_ms: 0,
            speed: video_mcp_default_speed(),
            link_id: String::new(),
            gain: VideoMcpGain::default(),
            transform: VideoMcpTransform::default(),
            kf: std::collections::BTreeMap::new(),
            style: serde_json::Value::Null,
            caption_group: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct VideoMcpGain {
    #[serde(default = "video_mcp_default_gain_level")]
    level: f64,
    keyframes: Vec<VideoMcpGainKeyframe>,
}

impl Default for VideoMcpGain {
    fn default() -> Self {
        Self {
            level: video_mcp_default_gain_level(),
            keyframes: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoMcpGainKeyframe {
    at_ms: u64,
    #[serde(default = "video_mcp_default_gain_level")]
    level: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct VideoMcpTransform {
    x: f64,
    y: f64,
    #[serde(default = "video_mcp_default_transform_scale")]
    scale: f64,
    #[serde(default = "video_mcp_default_transform_opacity")]
    opacity: f64,
}

impl Default for VideoMcpTransform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            scale: video_mcp_default_transform_scale(),
            opacity: video_mcp_default_transform_opacity(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct VideoMcpPropKeyframe {
    at_ms: u64,
    value: f64,
    easing: String,
}

impl Default for VideoMcpPropKeyframe {
    fn default() -> Self {
        Self {
            at_ms: 0,
            value: 0.0,
            easing: "linear".to_string(),
        }
    }
}

#[derive(Debug)]
struct VideoMcpEditState {
    next_clip_seq: u64,
    next_link_seq: u64,
    changed_clip_ids: std::collections::BTreeSet<String>,
    summaries: Vec<String>,
}

fn video_agent_state_key(repo_path: &str) -> Result<(std::path::PathBuf, String), String> {
    let root = resolve_workspace_root_directory(Some(repo_path))?;
    Ok((root.clone(), root.to_string_lossy().to_string()))
}

fn video_agent_states()
-> &'static std::sync::Mutex<std::collections::HashMap<String, VideoAgentState>> {
    VIDEO_AGENT_STATES.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn video_agent_state_for_key(key: &str) -> Option<VideoAgentState> {
    video_agent_states()
        .lock()
        .ok()
        .and_then(|guard| guard.get(key).cloned())
}

#[tauri::command]
async fn video_agent_state_set(
    repo_path: String,
    project_path: String,
    ranges: Vec<VideoAgentRange>,
    playhead_ms: u64,
    selected_clip_ids: Vec<String>,
) -> Result<(), String> {
    let (_root, key) = video_agent_state_key(repo_path.as_str())?;
    let mut guard = video_agent_states()
        .lock()
        .map_err(|_| "Video agent state lock is poisoned.".to_string())?;
    if project_path.trim().is_empty() {
        guard.remove(&key);
        return Ok(());
    }
    let ranges = ranges
        .into_iter()
        .filter_map(|range| {
            let start_ms = range.start_ms.min(range.end_ms);
            let end_ms = range.start_ms.max(range.end_ms);
            (end_ms > start_ms).then_some(VideoAgentRange { start_ms, end_ms })
        })
        .collect::<Vec<_>>();
    guard.insert(
        key,
        VideoAgentState {
            project_path,
            ranges,
            playhead_ms,
            selected_clip_ids,
            updated_at_ms: video_now_millis(),
        },
    );
    Ok(())
}

fn video_workspace_has_media(repo_path: &str) -> bool {
    video_workspace_media_root(repo_path)
        .map(|(_root, media_root)| media_root.is_dir())
        .unwrap_or(false)
}

fn video_mcp_project_to_value(project: &VideoMcpProject) -> Result<serde_json::Value, String> {
    serde_json::to_value(project)
        .map_err(|error| format!("Unable to serialize video project: {error}"))
}

fn video_mcp_project_from_value(value: &serde_json::Value) -> Result<VideoMcpProject, String> {
    serde_json::from_value::<VideoMcpProject>(value.clone())
        .map_err(|error| format!("Unable to decode video project: {error}"))
}

fn video_mcp_resolve_project_abs_from_raw(
    root: &std::path::Path,
    media_root: &std::path::Path,
    raw_path: &str,
) -> Result<std::path::PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("Video project path is required.".to_string());
    }
    let candidate = std::path::Path::new(trimmed);
    if candidate.is_absolute() {
        let abs = candidate.to_path_buf();
        video_verify_canonical_contained(
            &media_root.join(VIDEO_PROJECTS_DIR),
            &abs,
            "Video project path must stay under media/projects/.",
        )?;
        if !video_project_path_has_supported_extension(&abs) {
            return Err("Video project path must end with .video.pipe or .video.json.".to_string());
        }
        return Ok(abs);
    }
    video_resolve_project_abs(root, media_root, trimmed)
}

fn video_mcp_latest_project_abs(
    media_root: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    let projects_dir = media_root.join(VIDEO_PROJECTS_DIR);
    video_verify_canonical_contained(
        media_root,
        &projects_dir,
        "Video project path must stay under media/projects/.",
    )?;
    let mut candidates = Vec::<(u64, bool, std::path::PathBuf)>::new();
    let entries = std::fs::read_dir(&projects_dir)
        .map_err(|_| "No video project found in media/projects/.".to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !video_project_path_has_supported_extension(&path) {
            continue;
        }
        video_verify_canonical_contained(
            &projects_dir,
            &path,
            "Video project path must stay under media/projects/.",
        )?;
        let modified_at_ms = std::fs::metadata(&path)
            .ok()
            .as_ref()
            .map(video_file_modified_ms)
            .unwrap_or(0);
        candidates.push((modified_at_ms, video_project_path_is_pipe(&path), path));
    }
    candidates.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| right.1.cmp(&left.1)));
    candidates
        .into_iter()
        .map(|(_, _, path)| path)
        .next()
        .ok_or_else(|| "No video project found in media/projects/.".to_string())
}

fn video_mcp_resolve_project_abs(
    root: &std::path::Path,
    media_root: &std::path::Path,
    repo_key: &str,
    explicit_project_path: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    if let Some(project_path) = explicit_project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return video_mcp_resolve_project_abs_from_raw(root, media_root, project_path);
    }
    if let Some(state) = video_agent_state_for_key(repo_key) {
        if !state.project_path.trim().is_empty() {
            if let Ok(path) =
                video_mcp_resolve_project_abs_from_raw(root, media_root, &state.project_path)
            {
                if path.is_file() {
                    return Ok(path);
                }
            }
        }
    }
    video_mcp_latest_project_abs(media_root)
}

fn video_mcp_load_project_and_pipe(
    project_abs: &std::path::Path,
) -> Result<(VideoMcpProject, String), String> {
    let raw = std::fs::read_to_string(project_abs)
        .map_err(|error| format!("Unable to read video project: {error}"))?;
    let (mut project_value, pipe) = if video_project_path_is_pipe(project_abs) {
        let project_value = video_pipe_parse_project(&raw)
            .map_err(|error| format!("Unable to parse video project: {error}"))?;
        (project_value, raw)
    } else {
        let legacy_value = serde_json::from_str::<serde_json::Value>(&raw)
            .map_err(|error| format!("Unable to parse video project: {error}"))?;
        let pipe = video_pipe_serialize_project(&legacy_value)?;
        let project_value = video_pipe_parse_project(&pipe)
            .map_err(|error| format!("Unable to parse serialized legacy project: {error}"))?;
        (project_value, pipe)
    };
    let updated_at_ms = std::fs::metadata(project_abs)
        .ok()
        .as_ref()
        .map(video_file_modified_ms)
        .unwrap_or(0);
    if let Some(object) = project_value.as_object_mut() {
        object.insert("updatedAtMs".to_string(), serde_json::json!(updated_at_ms));
    }
    Ok((video_mcp_project_from_value(&project_value)?, pipe))
}

fn video_mcp_write_project_atomic(
    root: &std::path::Path,
    project_abs: &std::path::Path,
    project: &VideoMcpProject,
) -> Result<(std::path::PathBuf, String), String> {
    let target_abs = video_project_pipe_sibling_path(project_abs);
    let project_value = video_mcp_project_to_value(project)?;
    let raw = video_pipe_serialize_project(&project_value)?;
    let temp_path = video_project_temp_sibling_path(&target_abs);
    std::fs::write(&temp_path, raw.as_bytes())
        .map_err(|error| format!("Unable to write video project: {error}"))?;
    std::fs::rename(&temp_path, &target_abs)
        .map_err(|error| format!("Unable to finalize video project: {error}"))?;
    if project_abs != target_abs && project_abs.exists() {
        std::fs::remove_file(project_abs)
            .map_err(|error| format!("Unable to remove legacy video project: {error}"))?;
    }
    let _ = root;
    Ok((target_abs, raw))
}

fn video_mcp_clip_end(clip: &VideoMcpClip) -> u64 {
    clip.timeline_start_ms.saturating_add(clip.duration_ms)
}

fn video_mcp_project_clip_count(project: &VideoMcpProject) -> u64 {
    project
        .tracks
        .iter()
        .map(|track| track.clips.len() as u64)
        .sum()
}

fn video_mcp_find_clip_indices(project: &VideoMcpProject, clip_id: &str) -> Option<(usize, usize)> {
    for (track_index, track) in project.tracks.iter().enumerate() {
        for (clip_index, clip) in track.clips.iter().enumerate() {
            if clip.id == clip_id {
                return Some((track_index, clip_index));
            }
        }
    }
    None
}

fn video_mcp_sort_track(track: &mut VideoMcpTrack) {
    track.clips.sort_by_key(|clip| clip.timeline_start_ms);
}

fn video_mcp_sort_tracks(project: &mut VideoMcpProject) {
    for track in &mut project.tracks {
        video_mcp_sort_track(track);
    }
}

fn video_mcp_is_media_track(track: &VideoMcpTrack) -> bool {
    track.kind != "text"
}

fn video_mcp_asset_paths_for_project(project: &VideoMcpProject) -> Vec<String> {
    let mut paths = std::collections::BTreeSet::new();
    for track in &project.tracks {
        if !video_mcp_is_media_track(track) {
            continue;
        }
        for clip in &track.clips {
            if !clip.asset_path.trim().is_empty() {
                paths.insert(clip.asset_path.clone());
            }
        }
    }
    paths.into_iter().collect()
}

fn video_mcp_asset_paths_for_ranges(
    project: &VideoMcpProject,
    ranges: &[VideoAgentRange],
) -> Vec<String> {
    let mut paths = std::collections::BTreeSet::new();
    for range in ranges {
        for track in &project.tracks {
            if !video_mcp_is_media_track(track) {
                continue;
            }
            for clip in &track.clips {
                if clip.timeline_start_ms < range.end_ms
                    && video_mcp_clip_end(clip) > range.start_ms
                    && !clip.asset_path.trim().is_empty()
                {
                    paths.insert(clip.asset_path.clone());
                }
            }
        }
    }
    paths.into_iter().collect()
}

fn video_mcp_transcript_status_json(
    root: &std::path::Path,
    media_root: &std::path::Path,
    manifest: &VideoMediaManifest,
    asset_path: &str,
) -> serde_json::Value {
    let result = (|| {
        let (_abs, rel_path, kind, metadata) =
            video_resolve_existing_media_file(root, media_root, asset_path)?;
        if !matches!(kind, "audio" | "video") {
            return Ok((rel_path, false, false));
        }
        let resolved =
            video_resolve_transcript_cache(root, media_root, manifest, &rel_path, &metadata)?;
        Ok::<_, String>((
            rel_path,
            resolved.is_some(),
            resolved
                .as_ref()
                .map(|(inherited_from, _cache)| inherited_from.is_some())
                .unwrap_or(false),
        ))
    })();
    match result {
        Ok((rel_path, has_transcript, inherited)) => serde_json::json!({
            "assetPath": rel_path,
            "hasTranscript": has_transcript,
            "inherited": inherited,
        }),
        Err(_) => serde_json::json!({
            "assetPath": asset_path,
            "hasTranscript": false,
            "inherited": false,
        }),
    }
}

fn video_mcp_selection_json(
    project: &VideoMcpProject,
    state: Option<&VideoAgentState>,
) -> serde_json::Value {
    let ranges = state.map(|state| state.ranges.clone()).unwrap_or_default();
    let selected_clip_ids = state
        .map(|state| state.selected_clip_ids.clone())
        .unwrap_or_default();
    let playhead_ms = state.map(|state| state.playhead_ms).unwrap_or(0);
    let mut per_range = Vec::new();
    for range in &ranges {
        let mut clips = Vec::new();
        for track in &project.tracks {
            for clip in &track.clips {
                let clip_end = video_mcp_clip_end(clip);
                if clip.timeline_start_ms >= range.end_ms || clip_end <= range.start_ms {
                    continue;
                }
                let overlap_start = clip.timeline_start_ms.max(range.start_ms);
                let overlap_end = clip_end.min(range.end_ms);
                let (source_start, source_end) = if video_mcp_is_media_track(track) {
                    let speed = clip.speed.max(0.0001);
                    (
                        Some(clip.source_in_ms.saturating_add(video_mcp_round_u64(
                            (overlap_start - clip.timeline_start_ms) as f64 * speed,
                        ))),
                        Some(clip.source_in_ms.saturating_add(video_mcp_round_u64(
                            (overlap_end - clip.timeline_start_ms) as f64 * speed,
                        ))),
                    )
                } else {
                    (None, None)
                };
                clips.push(serde_json::json!({
                    "clipId": clip.id,
                    "trackLabel": track.label,
                    "trackKind": track.kind,
                    "assetPath": clip.asset_path,
                    "timelineStartMs": overlap_start,
                    "timelineEndMs": overlap_end,
                    "sourceStartMs": source_start,
                    "sourceEndMs": source_end,
                }));
            }
        }
        per_range.push(serde_json::json!({
            "startMs": range.start_ms,
            "endMs": range.end_ms,
            "clips": clips,
        }));
    }
    serde_json::json!({
        "ranges": ranges,
        "playheadMs": playhead_ms,
        "selectedClipIds": selected_clip_ids,
        "idNote": "clip ids are stable until the next edit; re-fetch after edits",
        "perRange": per_range,
    })
}

fn video_mcp_jobs_json(media_root: &std::path::Path) -> Vec<serde_json::Value> {
    video_read_generation_jobs(&video_generation_jobs_path(media_root))
        .unwrap_or_default()
        .into_iter()
        .filter(|job| !job.done || job.error.is_some() || job.state == "error")
        .map(|job| {
            serde_json::json!({
                "id": job.job_id,
                "model": job.model,
                "state": job.state,
                "percent": job.percent,
                "error": job.error,
            })
        })
        .collect()
}

fn video_mcp_generate_models(kind: Option<&str>) -> Vec<serde_json::Value> {
    // Keep in sync with src/video/generationCatalog.js.
    let rows = vec![
        serde_json::json!({"id":"higgsfield_dop_turbo","kind":"video","name":"DoP Turbo","caps":{"requiresStartFrame":true,"maxReferenceImages":0},"estUsdPerSecond":0.08}),
        serde_json::json!({"id":"higgsfield_dop_standard","kind":"video","name":"DoP Standard","caps":{"requiresStartFrame":true,"maxReferenceImages":0},"estUsdPerSecond":0.10}),
        serde_json::json!({"id":"higgsfield_dop_lite","kind":"video","name":"DoP Lite","caps":{"requiresStartFrame":true,"maxReferenceImages":0},"estUsdPerSecond":0.05}),
        serde_json::json!({"id":"kling_v2_5_turbo_pro_text_to_video","kind":"video","name":"Kling 2.5 Turbo Pro","caps":{"durations":[5,10],"maxReferenceImages":0},"estUsdPerSecond":0.08}),
        serde_json::json!({"id":"kling_v2_5_turbo_pro_image_to_video","kind":"video","name":"Kling 2.5 Turbo Pro I2V","caps":{"durations":[5,10],"requiresStartFrame":true,"maxReferenceImages":0},"estUsdPerSecond":0.08}),
        serde_json::json!({"id":"kling_v2_1_pro_image_to_video","kind":"video","name":"Kling 2.1 Pro I2V","caps":{"durations":[5,10],"requiresStartFrame":true,"maxReferenceImages":0},"estUsdPerSecond":0.08}),
        serde_json::json!({"id":"seedance_v1_pro_image_to_video","kind":"video","name":"Seedance v1 Pro I2V","caps":{"durations":[5,10],"requiresStartFrame":true,"maxReferenceImages":0},"estUsdPerSecond":0.08}),
        serde_json::json!({"id":"kling3_0","kind":"video","name":"Kling 3.0","caps":{"durations":[5,10],"resolutions":["720p","1080p"],"aspects":["16:9","9:16","1:1","4:3"],"maxReferenceImages":0},"estUsdPerSecond":0.09}),
        serde_json::json!({"id":"kling3_0_turbo","kind":"video","name":"Kling 3.0 Turbo","caps":{"durations":[5,10],"resolutions":["720p","1080p"],"aspects":["16:9","9:16","1:1","4:3"],"maxReferenceImages":0},"estUsdPerSecond":0.05}),
        serde_json::json!({"id":"kling2_6","kind":"video","name":"Kling 2.6","caps":{"durations":[5,10],"resolutions":["720p","1080p"],"aspects":["16:9","9:16","1:1","4:3"],"maxReferenceImages":0},"estUsdPerSecond":0.04}),
        serde_json::json!({"id":"seedance_2_0","kind":"video","name":"Seedance 2.0","caps":{"durations":[4,5,8,10,12,15],"resolutions":["480p","720p","1080p"],"aspects":["16:9","9:16","1:1","4:3"],"maxReferenceImages":4,"supportsSound":true},"estUsdPerSecond":0.05}),
        serde_json::json!({"id":"seedance_1_5_pro","kind":"video","name":"Seedance 1.5 Pro","caps":{"durations":[5,10],"resolutions":["480p","720p","1080p"],"aspects":["16:9","9:16","1:1","4:3"],"maxReferenceImages":0},"estUsdPerSecond":0.04}),
        serde_json::json!({"id":"veo3_1","kind":"video","name":"Veo 3.1","caps":{"durations":[4,6,8],"resolutions":["720p","1080p"],"aspects":["16:9","9:16"],"maxReferenceImages":3,"sound":true},"estUsdPerSecond":0.40}),
        serde_json::json!({"id":"veo3_1_lite","kind":"video","name":"Veo 3.1 Lite","caps":{"durations":[4,6,8],"resolutions":["720p","1080p"],"aspects":["16:9","9:16"],"maxReferenceImages":3,"sound":true},"estUsdPerSecond":0.15}),
        serde_json::json!({"id":"wan2_7","kind":"video","name":"Wan 2.7","caps":{"durations":[5,10],"resolutions":["720p","1080p"],"aspects":["16:9","9:16","1:1","4:3"],"maxReferenceImages":0,"sound":true},"estUsdPerSecond":0.05}),
        serde_json::json!({"id":"minimax_hailuo","kind":"video","name":"MiniMax Hailuo","caps":{"durations":[6,10],"resolutions":["720p","1080p"],"aspects":["16:9","9:16","1:1"],"maxReferenceImages":0},"estUsdPerSecond":0.045}),
        serde_json::json!({"id":"grok_video_1_5","kind":"video","name":"Grok Video 1.5","caps":{"durations":[6],"resolutions":["720p"],"aspects":["16:9","9:16"],"maxReferenceImages":0,"sound":true},"estUsdPerSecond":0.05}),
        serde_json::json!({"id":"higgsfield_speak","kind":"video","name":"Higgsfield Speak","caps":{"requiresStartFrame":true,"requiresInputAudio":true,"maxReferenceImages":0},"estUsdPerSecond":0.10}),
        serde_json::json!({"id":"higgsfield_soul_standard","kind":"image","name":"Soul Standard","caps":{"resolutions":["2K","4K"],"aspects":["16:9","9:16","1:1","3:4","4:3","2:3","3:2"],"maxReferenceImages":0},"estUsdPerImage":0.05}),
        serde_json::json!({"id":"seedream_v4_text_to_image","kind":"image","name":"Seedream 4","caps":{"resolutions":["1K","2K","4K"],"aspects":["16:9","9:16","1:1","3:4","4:3","2:3","3:2"],"maxReferenceImages":0},"estUsdPerImage":0.04}),
        serde_json::json!({"id":"seedream_v4_edit","kind":"image","name":"Seedream 4 Edit","caps":{"resolutions":["1K","2K","4K"],"aspects":["16:9","9:16","1:1","3:4","4:3","2:3","3:2"],"maxReferenceImages":1},"estUsdPerImage":0.05}),
        serde_json::json!({"id":"reve_text_to_image","kind":"image","name":"Reve","caps":{"aspects":["16:9","9:16","1:1","3:4","4:3","2:3","3:2"],"maxReferenceImages":0},"estUsdPerImage":0.04}),
        serde_json::json!({"id":"nano_banana_pro","kind":"image","name":"Nano Banana Pro","caps":{"resolutions":["1k","2k","4k"],"aspects":["16:9","9:16","1:1","3:4","4:3","2:3","3:2"],"maxReferenceImages":4},"estUsdPerImage":0.14}),
        serde_json::json!({"id":"nano_banana_2","kind":"image","name":"Nano Banana 2","caps":{"resolutions":["1k","2k"],"aspects":["16:9","9:16","1:1","3:4","4:3","2:3","3:2"],"maxReferenceImages":4},"estUsdPerImage":0.04}),
        serde_json::json!({"id":"flux_2","kind":"image","name":"FLUX.2","caps":{"resolutions":["1k","2k"],"aspects":["16:9","9:16","1:1","3:4","4:3","2:3","3:2"],"maxReferenceImages":4},"estUsdPerImage":0.05}),
        serde_json::json!({"id":"flux_kontext","kind":"image","name":"FLUX Kontext","caps":{"aspects":["16:9","9:16","1:1","3:4","4:3","2:3","3:2"],"maxReferenceImages":1},"estUsdPerImage":0.06}),
        serde_json::json!({"id":"gpt_image_2","kind":"image","name":"GPT Image 2","caps":{"qualities":["low","medium","high"],"aspects":["1:1","3:2","2:3"],"maxReferenceImages":4},"estUsdPerImage":0.08}),
        serde_json::json!({"id":"text2image_soul_v2","kind":"image","name":"Soul V2","caps":{"qualities":["standard","hd"],"aspects":["1:1","3:4"],"maxReferenceImages":0},"estUsdPerImage":0.05}),
        serde_json::json!({"id":"seedream_v4_5","kind":"image","name":"Seedream 4.5","caps":{"resolutions":["2k","4k"],"aspects":["16:9","9:16","1:1","3:4","4:3","2:3","3:2"],"maxReferenceImages":4},"estUsdPerImage":0.04}),
        serde_json::json!({"id":"seedream_v5_lite","kind":"image","name":"Seedream V5 Lite","caps":{"resolutions":["1k","2k"],"aspects":["16:9","9:16","1:1","3:4","4:3","2:3","3:2"],"maxReferenceImages":4},"estUsdPerImage":0.02}),
        serde_json::json!({"id":"grok_image","kind":"image","name":"Grok Image","caps":{"aspects":["16:9","9:16","1:1"],"maxReferenceImages":0},"estUsdPerImage":0.03}),
        serde_json::json!({"id":"recraft_v4_1","kind":"image","name":"Recraft V4.1","caps":{"aspects":["16:9","9:16","1:1","3:4","4:3","2:3","3:2"],"maxReferenceImages":1},"estUsdPerImage":0.04}),
        serde_json::json!({"id":"text2speech_v2","kind":"audio","name":"Text to Speech","caps":{"voices":["elevenlabs","minimax","seed_speech","vibe_voice","cozy_voice"]},"estUsdPerImage":0.03}),
        serde_json::json!({"id":"sonilo_music","kind":"audio","name":"Sonilo Music","caps":{"durations":[10,20,30,60]},"estUsdPerSecond":0.01}),
        serde_json::json!({"id":"mirelo_sfx","kind":"audio","name":"Mirelo SFX","caps":{"durations":[5,10,15]},"estUsdPerSecond":0.015}),
    ];
    match kind {
        Some(kind) => rows
            .into_iter()
            .filter(|row| row.get("kind").and_then(serde_json::Value::as_str) == Some(kind))
            .collect(),
        None => rows,
    }
}

fn video_mcp_generate_model_for_kind(kind: &str, model: &str) -> Result<serde_json::Value, String> {
    if !matches!(kind, "video" | "image" | "audio") {
        return Err("kind must be video, image, or audio.".to_string());
    }
    let models = video_mcp_generate_models(Some(kind));
    if let Some(row) = models
        .iter()
        .find(|row| row.get("id").and_then(serde_json::Value::as_str) == Some(model))
    {
        return Ok(row.clone());
    }
    let valid_ids = models
        .iter()
        .filter_map(|row| row.get("id").and_then(serde_json::Value::as_str))
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Unknown {kind} generation model: {model}. Valid {kind} model ids: {valid_ids}"
    ))
}

fn video_mcp_generate_model_cap(model: &serde_json::Value, cap: &str) -> bool {
    model
        .get("caps")
        .and_then(|caps| caps.get(cap))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn video_mcp_validate_generate_asset_paths(
    root: &std::path::Path,
    media_root: &std::path::Path,
    input_asset_paths: &[String],
    audio_asset_paths: &[String],
) -> Result<(), String> {
    for path in input_asset_paths {
        video_resolve_existing_media_file(root, media_root, path)
            .map_err(|error| format!("Invalid inputAssetPaths entry {path}: {error}"))?;
    }
    for path in audio_asset_paths {
        let (_abs, _rel_path, kind, _metadata) =
            video_resolve_existing_media_file(root, media_root, path)
                .map_err(|error| format!("Invalid audioAssetPaths entry {path}: {error}"))?;
        if kind != "audio" {
            return Err(format!(
                "Invalid audioAssetPaths entry {path}: audio inputs must be audio assets under media/."
            ));
        }
    }
    Ok(())
}

fn video_mcp_validate_generate_start(
    root: &std::path::Path,
    media_root: &std::path::Path,
    kind: &str,
    model: &str,
    input_asset_paths: &[String],
    audio_asset_paths: &[String],
) -> Result<(), String> {
    let model_row = video_mcp_generate_model_for_kind(kind, model)?;
    if video_mcp_generate_model_cap(&model_row, "requiresStartFrame")
        && input_asset_paths.first().is_none()
    {
        return Err(format!(
            "{model} requires inputAssetPaths[0] as a start frame."
        ));
    }
    if video_mcp_generate_model_cap(&model_row, "requiresInputAudio")
        && audio_asset_paths.first().is_none()
    {
        return Err(format!(
            "{model} requires audioAssetPaths[0] as input audio."
        ));
    }
    video_mcp_validate_generate_asset_paths(root, media_root, input_asset_paths, audio_asset_paths)
}

fn video_mcp_generate_job_json(job: &VideoPersistentGenerateJob) -> serde_json::Value {
    let output_paths = if job.done && job.error.is_none() {
        job.planned_paths.clone()
    } else {
        Vec::new()
    };
    serde_json::json!({
        "jobId": job.job_id,
        "state": job.state,
        "percent": job.percent,
        "done": job.done,
        "error": job.error,
        "outputPaths": output_paths,
        "plannedPaths": job.planned_paths,
    })
}

fn video_mcp_generate_status_value(
    media_root: &std::path::Path,
    job_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    let mut jobs = video_read_generation_jobs(&video_generation_jobs_path(media_root))?;
    if let Some(job_id) = job_id {
        return jobs
            .iter()
            .find(|job| job.job_id == job_id)
            .map(video_mcp_generate_job_json)
            .ok_or_else(|| format!("Video generation job not found: {job_id}"));
    }
    jobs.sort_by_key(|job| job.created_at_ms);
    let mut rows = jobs
        .iter()
        .filter(|job| !job.done)
        .map(video_mcp_generate_job_json)
        .collect::<Vec<_>>();
    let mut done = jobs
        .iter()
        .filter(|job| job.done)
        .rev()
        .take(5)
        .map(video_mcp_generate_job_json)
        .collect::<Vec<_>>();
    done.reverse();
    rows.extend(done);
    Ok(serde_json::json!({ "jobs": rows }))
}

fn video_mcp_clamp_look_times(mut times_ms: Vec<u64>) -> (Vec<u64>, bool) {
    let clamped = times_ms.len() > VIDEO_MCP_LOOK_MAX_FRAMES;
    times_ms.truncate(VIDEO_MCP_LOOK_MAX_FRAMES);
    (times_ms, clamped)
}

fn video_mcp_jpeg_base64_within_budget(
    bytes: &[u8],
    max_base64_bytes: usize,
) -> Option<(String, usize)> {
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    let len = b64.len();
    (len <= max_base64_bytes).then_some((b64, len))
}

async fn video_mcp_render_look_frame_b64(
    app: tauri::AppHandle,
    repo_path: String,
    project_path: String,
    at_ms: u64,
) -> Result<(String, VideoMcpLookJpegAttempt, usize), String> {
    let at_i64 = at_ms.min(i64::MAX as u64) as i64;
    let mut last_len = 0usize;
    for attempt in VIDEO_MCP_LOOK_JPEG_ATTEMPTS {
        let bytes = video_render_frame_jpeg_bytes(
            app.clone(),
            repo_path.clone(),
            project_path.clone(),
            at_i64,
            Some(attempt.max_width),
            attempt.quality,
        )
        .await?;
        last_len = bytes.len().saturating_add(2) / 3 * 4;
        if let Some((b64, len)) =
            video_mcp_jpeg_base64_within_budget(&bytes, VIDEO_MCP_LOOK_JPEG_MAX_BASE64_BYTES)
        {
            return Ok((b64, attempt, len));
        }
    }
    Err(format!(
        "video_look frame at {at_ms}ms exceeds 48KB JPEG budget after 384px fallback ({last_len} base64 bytes)."
    ))
}

async fn video_mcp_look(
    app: tauri::AppHandle,
    repo_path: String,
    project_path: Option<String>,
    times_ms: Vec<u64>,
) -> Result<serde_json::Value, String> {
    let (times_ms, clamped) = video_mcp_clamp_look_times(times_ms);
    if times_ms.is_empty() {
        return Err("At least one video_look timestamp is required.".to_string());
    }
    let repo_for_project = repo_path.clone();
    let project_path = tauri::async_runtime::spawn_blocking(move || {
        let (root, repo_key) = video_agent_state_key(repo_for_project.as_str())?;
        let (_root, media_root) = video_workspace_media_root(repo_for_project.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let project_abs =
            video_mcp_resolve_project_abs(&root, &media_root, &repo_key, project_path.as_deref())?;
        Ok::<_, String>(video_relative_path(&root, &project_abs))
    })
    .await
    .map_err(|error| format!("Video MCP look project worker failed: {error}"))??;

    let mut frames = Vec::new();
    let mut budget_notes = Vec::new();
    for at_ms in &times_ms {
        let (b64, attempt, len) = video_mcp_render_look_frame_b64(
            app.clone(),
            repo_path.clone(),
            project_path.clone(),
            *at_ms,
        )
        .await?;
        if attempt != VIDEO_MCP_LOOK_JPEG_ATTEMPTS[0] {
            budget_notes.push(format!(
                "{}ms q{} {}px {}B",
                *at_ms, attempt.quality, attempt.max_width, len
            ));
        }
        frames.push(serde_json::json!({
            "atMs": *at_ms,
            "b64Jpeg": b64,
        }));
    }
    let rendered = times_ms
        .iter()
        .map(|at_ms| format!("{at_ms}ms"))
        .collect::<Vec<_>>()
        .join(", ");
    let note = if clamped {
        format!("rendered {rendered}; clamped to {VIDEO_MCP_LOOK_MAX_FRAMES} frames")
    } else {
        format!("rendered {rendered}")
    };
    let note = if budget_notes.is_empty() {
        format!("{note}; JPEG budget <=48KB/frame")
    } else {
        format!(
            "{note}; JPEG budget <=48KB/frame; compressed {}",
            budget_notes.join(", ")
        )
    };
    Ok(serde_json::json!({
        "frames": frames,
        "note": note,
    }))
}

fn video_mcp_media_row(item: &VideoMediaItem) -> serde_json::Value {
    let mut row = serde_json::Map::new();
    row.insert("path".to_string(), serde_json::json!(item.path));
    row.insert("kind".to_string(), serde_json::json!(item.kind));
    if let Some(duration_ms) = item.duration_ms {
        row.insert("durationMs".to_string(), serde_json::json!(duration_ms));
    }
    if let Some(width) = item.width {
        row.insert("width".to_string(), serde_json::json!(width));
    }
    if let Some(height) = item.height {
        row.insert("height".to_string(), serde_json::json!(height));
    }
    row.insert(
        "hasTranscript".to_string(),
        serde_json::json!(item.has_transcript),
    );
    row.insert("folderId".to_string(), serde_json::json!(item.folder_id));
    row.insert("pending".to_string(), serde_json::json!(item.pending));
    serde_json::Value::Object(row)
}

fn video_mcp_media_rows(items: &[VideoMediaItem]) -> Vec<serde_json::Value> {
    items.iter().map(video_mcp_media_row).collect()
}

fn video_mcp_input_text(input: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| input.get(*key).and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn video_mcp_media_kind_filter(input: &serde_json::Value) -> Option<String> {
    video_mcp_input_text(input, &["kind"])
        .and_then(|kind| matches!(kind.as_str(), "video" | "audio" | "image").then_some(kind))
}

fn video_mcp_media_folder_filter(input: &serde_json::Value) -> Option<String> {
    input
        .get("folderId")
        .or_else(|| input.get("folder_id"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .map(ToOwned::to_owned)
}

fn video_mcp_media_item_matches_filters(
    item: &VideoMediaItem,
    kind_filter: Option<&str>,
    folder_filter: Option<&str>,
) -> bool {
    if kind_filter.is_some_and(|kind| item.kind != kind) {
        return false;
    }
    if folder_filter.is_some_and(|folder_id| item.folder_id != folder_id) {
        return false;
    }
    true
}

fn video_mcp_collect_media_items(
    root: &std::path::Path,
    media_root: &std::path::Path,
    manifest: &VideoMediaManifest,
    ffprobe_path: Option<&str>,
    include_pending: bool,
) -> Vec<VideoMediaItem> {
    let cache_path = media_root
        .join(VIDEO_CACHE_DIR)
        .join(VIDEO_PROBE_CACHE_FILE);
    let mut probe_cache = video_read_probe_cache(&cache_path);
    let mut probe_cache_dirty = false;
    let mut thumbnails_generated = 0usize;
    let mut items = Vec::new();
    for folder in [VIDEO_ASSETS_DIR, VIDEO_GENERATED_DIR] {
        for path in video_scan_media_files(&media_root.join(folder)) {
            if let Some(item) = video_build_media_item(
                root,
                media_root,
                manifest,
                &path,
                folder,
                None,
                ffprobe_path,
                &mut probe_cache,
                &mut probe_cache_dirty,
                &mut thumbnails_generated,
            ) {
                items.push(item);
            }
        }
    }
    if include_pending {
        items.extend(video_pending_generated_media_items(root, media_root));
    }
    if probe_cache_dirty {
        let _ = video_write_probe_cache(&cache_path, &probe_cache);
    }
    items.sort_by(|left, right| left.path.cmp(&right.path));
    items
}

fn video_mcp_excerpt(text: &str, query: &str) -> String {
    let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.chars().count() <= 120 {
        return clean;
    }
    let lower = clean.to_ascii_lowercase();
    let match_char = lower
        .find(query)
        .map(|byte| lower[..byte].chars().count())
        .unwrap_or(0);
    let total_chars = clean.chars().count();
    let mut start = match_char.saturating_sub(40);
    if total_chars.saturating_sub(start) < 120 {
        start = total_chars.saturating_sub(120);
    }
    clean.chars().skip(start).take(120).collect()
}

fn video_mcp_media_search_moments(
    root: &std::path::Path,
    media_root: &std::path::Path,
    manifest: &VideoMediaManifest,
    items: &[VideoMediaItem],
    query: &str,
    kind_filter: Option<&str>,
) -> Vec<serde_json::Value> {
    let mut moments = Vec::new();
    for item in items {
        if moments.len() >= 20 {
            break;
        }
        if kind_filter.is_some_and(|kind| item.kind != kind) {
            continue;
        }
        if !matches!(item.kind.as_str(), "audio" | "video") || item.pending {
            continue;
        }
        let Ok((_abs, rel_path, _kind, metadata)) =
            video_resolve_existing_media_file(root, media_root, &item.path)
        else {
            continue;
        };
        let Ok(Some((inherited_from, cache))) =
            video_resolve_transcript_cache(root, media_root, manifest, &rel_path, &metadata)
        else {
            continue;
        };
        for segment in cache.segments {
            if moments.len() >= 20 {
                break;
            }
            let text = segment.text.trim();
            if text.is_empty() || !text.to_ascii_lowercase().contains(query) {
                continue;
            }
            let mut moment = serde_json::Map::new();
            moment.insert("path".to_string(), serde_json::json!(rel_path));
            moment.insert(
                "momentSourceMs".to_string(),
                serde_json::json!([segment.start_ms, segment.end_ms]),
            );
            moment.insert(
                "excerpt".to_string(),
                serde_json::json!(video_mcp_excerpt(text, query)),
            );
            if let Some(inherited_from) = inherited_from.as_deref() {
                moment.insert(
                    "inheritedFrom".to_string(),
                    serde_json::json!(inherited_from),
                );
                moment.insert(
                    "description".to_string(),
                    serde_json::json!(VIDEO_MCP_MOMENT_SOURCE_NOTE),
                );
            }
            moments.push(serde_json::Value::Object(moment));
        }
    }
    moments
}

fn video_mcp_media_import_items(
    app: &tauri::AppHandle,
    root: &std::path::Path,
    media_root: &std::path::Path,
    source_paths: Vec<String>,
    ffprobe_path: Option<&str>,
) -> Result<Vec<VideoMediaItem>, String> {
    let assets_dir = media_root.join(VIDEO_ASSETS_DIR);
    let cache_path = media_root
        .join(VIDEO_CACHE_DIR)
        .join(VIDEO_PROBE_CACHE_FILE);
    let mut probe_cache = video_read_probe_cache(&cache_path);
    let mut probe_cache_dirty = false;
    let mut thumbnails_generated = 0usize;
    let manifest = video_read_media_manifest(&video_media_manifest_path(media_root));
    let mut imported = Vec::new();
    let mut changed_paths = Vec::new();
    for source in source_paths {
        let source_path = std::path::PathBuf::from(source.trim());
        if !source_path.is_absolute() || !source_path.is_file() {
            return Err(format!(
                "Video import source is not a file: {}",
                source_path.display()
            ));
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
        let destination = video_copy_to_unique_destination(&source_path, &assets_dir, file_name)?;
        changed_paths.push(video_relative_path(root, &destination));
        if let Some(item) = video_build_media_item(
            root,
            media_root,
            &manifest,
            &destination,
            VIDEO_ASSETS_DIR,
            None,
            ffprobe_path,
            &mut probe_cache,
            &mut probe_cache_dirty,
            &mut thumbnails_generated,
        ) {
            imported.push(item);
        }
    }
    if probe_cache_dirty {
        let _ = video_write_probe_cache(&cache_path, &probe_cache);
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
    Ok(imported)
}

async fn video_mcp_media(
    app: tauri::AppHandle,
    repo_path: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let action = input
            .get("action")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "video_media action is required.".to_string())?;
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let status = video_tools_status_for(&app);
        let ffprobe_path = status.ffprobe.path.as_deref();
        match action {
            "list" => {
                let manifest = video_read_media_manifest(&video_media_manifest_path(&media_root));
                let kind_filter = video_mcp_media_kind_filter(&input);
                let folder_filter = video_mcp_media_folder_filter(&input);
                let items = video_mcp_collect_media_items(
                    &root,
                    &media_root,
                    &manifest,
                    ffprobe_path,
                    true,
                )
                .into_iter()
                .filter(|item| {
                    video_mcp_media_item_matches_filters(
                        item,
                        kind_filter.as_deref(),
                        folder_filter.as_deref(),
                    )
                })
                .collect::<Vec<_>>();
                Ok(serde_json::json!({ "items": video_mcp_media_rows(&items) }))
            }
            "search" => {
                let query = video_mcp_input_text(&input, &["query"])
                    .ok_or_else(|| "video_media search query is required.".to_string())?;
                let query_lower = query.to_ascii_lowercase();
                let manifest = video_read_media_manifest(&video_media_manifest_path(&media_root));
                let kind_filter = video_mcp_media_kind_filter(&input);
                let items = video_mcp_collect_media_items(
                    &root,
                    &media_root,
                    &manifest,
                    ffprobe_path,
                    true,
                );
                let filename_matches = items
                    .iter()
                    .filter(|item| {
                        kind_filter
                            .as_deref()
                            .map_or(true, |kind| item.kind == kind)
                            && (item.path.to_ascii_lowercase().contains(&query_lower)
                                || item.name.to_ascii_lowercase().contains(&query_lower))
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                let moments = video_mcp_media_search_moments(
                    &root,
                    &media_root,
                    &manifest,
                    &items,
                    &query_lower,
                    kind_filter.as_deref(),
                );
                Ok(serde_json::json!({
                    "items": video_mcp_media_rows(&filename_matches),
                    "moments": moments,
                }))
            }
            "import" => {
                let source_paths = input
                    .get("sourcePaths")
                    .or_else(|| input.get("source_paths"))
                    .and_then(serde_json::Value::as_array)
                    .ok_or_else(|| "sourcePaths must be an array".to_string())?
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>();
                if source_paths.is_empty() {
                    return Err("sourcePaths must include at least one path.".to_string());
                }
                let imported = video_mcp_media_import_items(
                    &app,
                    &root,
                    &media_root,
                    source_paths,
                    ffprobe_path,
                )?;
                Ok(serde_json::json!({ "imported": video_mcp_media_rows(&imported) }))
            }
            "folders" => {
                let manifest = video_read_media_manifest(&video_media_manifest_path(&media_root));
                Ok(serde_json::json!({ "folders": manifest.folders }))
            }
            "createFolder" => {
                let name = video_mcp_input_text(&input, &["name"])
                    .ok_or_else(|| "Video media folder name is required.".to_string())?;
                let manifest_path = video_media_manifest_path(&media_root);
                let _guard = video_media_manifest_guard()?;
                let mut manifest = video_read_media_manifest(&manifest_path);
                let id = video_manifest_slug_unique(&manifest, &name);
                let folder = VideoMediaFolder { id, name };
                manifest.folders.push(folder.clone());
                video_write_media_manifest(&manifest_path, &manifest)?;
                video_emit_manifest_changed(&app, &root, &manifest_path);
                Ok(serde_json::json!({ "folder": folder }))
            }
            "setFolder" => {
                let path = video_mcp_input_text(&input, &["path"])
                    .ok_or_else(|| "Video media path is required.".to_string())?;
                let folder_id = input
                    .get("folderId")
                    .or_else(|| input.get("folder_id"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .unwrap_or("")
                    .to_string();
                let (_abs, rel_path, _kind, _metadata) =
                    video_resolve_existing_media_file(&root, &media_root, path.as_str())?;
                let rel_path = video_manifest_asset_path(&root, &media_root, rel_path.as_str())?;
                let manifest_path = video_media_manifest_path(&media_root);
                let _guard = video_media_manifest_guard()?;
                let mut manifest = video_read_media_manifest(&manifest_path);
                if !video_manifest_folder_exists(&manifest, folder_id.as_str()) {
                    return Err(format!("Video media folder not found: {folder_id}"));
                }
                video_manifest_set_asset_folder(&mut manifest, &rel_path, folder_id.as_str());
                if manifest
                    .assets
                    .get(&rel_path)
                    .is_some_and(|asset| asset.folder_id.is_empty() && asset.relations.is_empty())
                {
                    manifest.assets.remove(&rel_path);
                }
                video_write_media_manifest(&manifest_path, &manifest)?;
                video_emit_manifest_changed(&app, &root, &manifest_path);
                Ok(serde_json::json!({ "path": rel_path, "folderId": folder_id }))
            }
            _ => Err(format!("Unknown video_media action: {action}")),
        }
    })
    .await
    .map_err(|error| format!("Video MCP media worker failed: {error}"))?
}

fn video_mcp_context_guide_value(include: &[String]) -> serde_json::Value {
    if include.iter().any(|value| value == "help") {
        serde_json::json!(video_mcp_context_guide_text())
    } else {
        serde_json::json!("include:[\"help\"] returns the agent guide")
    }
}

fn video_mcp_context_guide_text() -> String {
    format!("{VIDEO_AGENT_GUIDE}\n\n{VIDEO_MCP_MOMENT_SOURCE_NOTE}")
}

async fn video_mcp_context(
    app: tauri::AppHandle,
    repo_path: String,
    include: Vec<String>,
) -> Result<serde_json::Value, String> {
    let _ = app;
    if include.iter().any(|value| value == "help") {
        return Ok(serde_json::json!(video_mcp_context_guide_text()));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (root, repo_key) = video_agent_state_key(repo_path.as_str())?;
        let (_root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        let include_all = include.is_empty();
        let includes = |section: &str| include_all || include.iter().any(|value| value == section);
        let state = video_agent_state_for_key(&repo_key);
        let project_abs = video_mcp_resolve_project_abs(&root, &media_root, &repo_key, None)?;
        let (project, pipe) = video_mcp_load_project_and_pipe(&project_abs)?;
        let mut output = serde_json::Map::new();
        output.insert(
            "project".to_string(),
            serde_json::json!({
                "path": project_abs.to_string_lossy().to_string(),
                "relativePath": video_relative_path(&root, &project_abs),
                "name": project.name,
            }),
        );
        output.insert(
            "idNote".to_string(),
            serde_json::json!("clip ids are stable until the next edit; re-fetch after edits"),
        );
        output.insert("guide".to_string(), video_mcp_context_guide_value(&include));
        if includes("timeline") {
            output.insert("pipe".to_string(), serde_json::json!(pipe));
            output.insert(
                "pipePath".to_string(),
                serde_json::json!(project_abs.to_string_lossy().to_string()),
            );
        }
        if includes("selection") {
            output.insert(
                "selection".to_string(),
                video_mcp_selection_json(&project, state.as_ref()),
            );
        }
        if includes("transcripts") {
            let manifest = video_read_media_manifest(&video_media_manifest_path(&media_root));
            let asset_paths = state
                .as_ref()
                .filter(|state| !state.ranges.is_empty())
                .map(|state| video_mcp_asset_paths_for_ranges(&project, &state.ranges))
                .filter(|paths| !paths.is_empty())
                .unwrap_or_else(|| video_mcp_asset_paths_for_project(&project));
            let transcripts = asset_paths
                .iter()
                .map(|asset_path| {
                    video_mcp_transcript_status_json(&root, &media_root, &manifest, asset_path)
                })
                .collect::<Vec<_>>();
            output.insert("transcripts".to_string(), serde_json::json!(transcripts));
        }
        if includes("jobs") {
            output.insert(
                "jobs".to_string(),
                serde_json::json!(video_mcp_jobs_json(&media_root)),
            );
        }
        Ok(serde_json::Value::Object(output))
    })
    .await
    .map_err(|error| format!("Video MCP context worker failed: {error}"))?
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

fn video_mcp_round_u64(value: f64) -> u64 {
    if !value.is_finite() || value <= 0.0 {
        0
    } else if value >= u64::MAX as f64 {
        u64::MAX
    } else {
        value.round() as u64
    }
}

fn video_mcp_diff_i64(left: u64, right: u64) -> i64 {
    let diff = left as i128 - right as i128;
    diff.clamp(i64::MIN as i128, i64::MAX as i128) as i64
}

fn video_mcp_add_i64(value: u64, delta: i64) -> u64 {
    if delta < 0 {
        value.saturating_sub(delta.unsigned_abs())
    } else {
        value.saturating_add(delta as u64)
    }
}

fn video_mcp_value_f64(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|value| value as f64))
        .filter(|value| value.is_finite())
}

fn video_mcp_value_u64(value: &serde_json::Value) -> Option<u64> {
    if let Some(value) = value.as_u64() {
        return Some(value);
    }
    video_mcp_value_f64(value).map(video_mcp_round_u64)
}

fn video_mcp_op_str<'a>(op: &'a serde_json::Value, key: &str) -> Result<&'a str, String> {
    op.get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{key} is required"))
}

fn video_mcp_op_u64(op: &serde_json::Value, key: &str) -> Result<u64, String> {
    op.get(key)
        .and_then(video_mcp_value_u64)
        .ok_or_else(|| format!("{key} is required"))
}

fn video_mcp_clamp_gain(level: f64) -> f64 {
    level.clamp(0.0, 4.0)
}

fn video_mcp_clamp_speed(speed: f64) -> f64 {
    speed.clamp(0.1, 8.0)
}

fn video_mcp_clamp_prop_value(prop: &str, value: f64) -> f64 {
    match prop {
        "opacity" => value.clamp(0.0, 1.0),
        "scale" => value.clamp(0.05, 8.0),
        "x" | "y" => value.clamp(-4.0, 4.0),
        _ => value,
    }
}

fn video_mcp_normalize_gain_frames(frames: &[VideoMcpGainKeyframe]) -> Vec<VideoMcpGainKeyframe> {
    let mut frames = frames
        .iter()
        .map(|frame| VideoMcpGainKeyframe {
            at_ms: frame.at_ms,
            level: video_mcp_clamp_gain(frame.level),
        })
        .collect::<Vec<_>>();
    frames.sort_by_key(|frame| frame.at_ms);
    frames
}

fn video_mcp_normalize_prop_frames(
    frames: &[VideoMcpPropKeyframe],
    prop: &str,
) -> Vec<VideoMcpPropKeyframe> {
    let mut frames = frames
        .iter()
        .map(|frame| VideoMcpPropKeyframe {
            at_ms: frame.at_ms,
            value: video_mcp_clamp_prop_value(prop, frame.value),
            easing: if matches!(frame.easing.as_str(), "linear" | "hold" | "smooth") {
                frame.easing.clone()
            } else {
                "linear".to_string()
            },
        })
        .collect::<Vec<_>>();
    frames.sort_by_key(|frame| frame.at_ms);
    frames
}

fn video_mcp_gain_at_ms(gain: &VideoMcpGain, at_ms: u64) -> f64 {
    let frames = video_mcp_normalize_gain_frames(&gain.keyframes);
    if frames.is_empty() {
        return video_mcp_clamp_gain(gain.level);
    }
    if at_ms <= frames[0].at_ms {
        return frames[0].level;
    }
    let last = frames.last().expect("gain frames not empty");
    if at_ms >= last.at_ms {
        return last.level;
    }
    for pair in frames.windows(2) {
        let from = &pair[0];
        let to = &pair[1];
        if at_ms >= from.at_ms && at_ms <= to.at_ms {
            let span = to.at_ms.saturating_sub(from.at_ms);
            if span == 0 {
                return to.level;
            }
            let ratio = (at_ms - from.at_ms) as f64 / span as f64;
            return from.level + (to.level - from.level) * ratio;
        }
    }
    video_mcp_clamp_gain(gain.level)
}

fn video_mcp_smoothstep(value: f64) -> f64 {
    value * value * (3.0 - 2.0 * value)
}

fn video_mcp_kf_value_at_ms(frames: &[VideoMcpPropKeyframe], at_ms: u64, fallback: f64) -> f64 {
    if frames.is_empty() {
        return fallback;
    }
    if at_ms <= frames[0].at_ms {
        return frames[0].value;
    }
    let last = frames.last().expect("property frames not empty");
    if at_ms >= last.at_ms {
        return last.value;
    }
    for pair in frames.windows(2) {
        let from = &pair[0];
        let to = &pair[1];
        if at_ms >= from.at_ms && at_ms <= to.at_ms {
            let span = to.at_ms.saturating_sub(from.at_ms);
            if span == 0 {
                return if from.easing == "hold" {
                    from.value
                } else {
                    to.value
                };
            }
            if from.easing == "hold" {
                return from.value;
            }
            let mut ratio = (at_ms - from.at_ms) as f64 / span as f64;
            if from.easing == "smooth" {
                ratio = video_mcp_smoothstep(ratio);
            }
            return from.value + (to.value - from.value) * ratio;
        }
    }
    fallback
}

fn video_mcp_spanning_easing(frames: &[VideoMcpPropKeyframe], offset: u64) -> String {
    let mut easing = "linear".to_string();
    for frame in frames {
        if frame.at_ms <= offset {
            easing = if matches!(frame.easing.as_str(), "linear" | "hold" | "smooth") {
                frame.easing.clone()
            } else {
                "linear".to_string()
            };
        } else {
            break;
        }
    }
    easing
}

fn video_mcp_partition_envelopes_at(
    left: &mut VideoMcpClip,
    mut right: Option<&mut VideoMcpClip>,
    offset: u64,
) {
    let gain_frames = video_mcp_normalize_gain_frames(&left.gain.keyframes);
    if !gain_frames.is_empty() {
        let cut_level = video_mcp_gain_at_ms(&left.gain, offset);
        left.gain.keyframes = gain_frames
            .iter()
            .filter(|frame| frame.at_ms < offset)
            .cloned()
            .chain(std::iter::once(VideoMcpGainKeyframe {
                at_ms: offset,
                level: cut_level,
            }))
            .collect();
        if let Some(right_clip) = right.as_deref_mut() {
            right_clip.gain.keyframes = std::iter::once(VideoMcpGainKeyframe {
                at_ms: 0,
                level: cut_level,
            })
            .chain(
                gain_frames
                    .iter()
                    .filter(|frame| frame.at_ms > offset)
                    .map(|frame| VideoMcpGainKeyframe {
                        at_ms: frame.at_ms - offset,
                        level: frame.level,
                    }),
            )
            .collect();
        }
    }

    for prop in ["opacity", "x", "y", "scale"] {
        let Some(raw_frames) = left.kf.get(prop).cloned() else {
            continue;
        };
        let prop_frames = video_mcp_normalize_prop_frames(&raw_frames, prop);
        if prop_frames.is_empty() {
            continue;
        }
        let cut_value = video_mcp_kf_value_at_ms(&prop_frames, offset, prop_frames[0].value);
        let easing = video_mcp_spanning_easing(&prop_frames, offset);
        left.kf.insert(
            prop.to_string(),
            prop_frames
                .iter()
                .filter(|frame| frame.at_ms < offset)
                .cloned()
                .chain(std::iter::once(VideoMcpPropKeyframe {
                    at_ms: offset,
                    value: cut_value,
                    easing: easing.clone(),
                }))
                .collect(),
        );
        if let Some(right_clip) = right.as_deref_mut() {
            right_clip.kf.insert(
                prop.to_string(),
                std::iter::once(VideoMcpPropKeyframe {
                    at_ms: 0,
                    value: cut_value,
                    easing: easing.clone(),
                })
                .chain(
                    prop_frames
                        .iter()
                        .filter(|frame| frame.at_ms > offset)
                        .map(|frame| VideoMcpPropKeyframe {
                            at_ms: frame.at_ms - offset,
                            value: frame.value,
                            easing: frame.easing.clone(),
                        }),
                )
                .collect(),
            );
        }
    }
}

fn video_mcp_rebase_envelopes_from(clip: &mut VideoMcpClip, cut_ms: u64) {
    let gain_frames = video_mcp_normalize_gain_frames(&clip.gain.keyframes);
    if !gain_frames.is_empty() {
        let cut_level = video_mcp_gain_at_ms(&clip.gain, cut_ms);
        clip.gain.keyframes = std::iter::once(VideoMcpGainKeyframe {
            at_ms: 0,
            level: cut_level,
        })
        .chain(
            gain_frames
                .iter()
                .filter(|frame| frame.at_ms > cut_ms)
                .map(|frame| VideoMcpGainKeyframe {
                    at_ms: frame.at_ms - cut_ms,
                    level: frame.level,
                }),
        )
        .collect();
    }
    for prop in ["opacity", "x", "y", "scale"] {
        let Some(raw_frames) = clip.kf.get(prop).cloned() else {
            continue;
        };
        let prop_frames = video_mcp_normalize_prop_frames(&raw_frames, prop);
        if prop_frames.is_empty() {
            continue;
        }
        let cut_value = video_mcp_kf_value_at_ms(&prop_frames, cut_ms, prop_frames[0].value);
        let easing = video_mcp_spanning_easing(&prop_frames, cut_ms);
        clip.kf.insert(
            prop.to_string(),
            std::iter::once(VideoMcpPropKeyframe {
                at_ms: 0,
                value: cut_value,
                easing,
            })
            .chain(
                prop_frames
                    .iter()
                    .filter(|frame| frame.at_ms > cut_ms)
                    .map(|frame| VideoMcpPropKeyframe {
                        at_ms: frame.at_ms - cut_ms,
                        value: frame.value,
                        easing: frame.easing.clone(),
                    }),
            )
            .collect(),
        );
    }
}

fn video_mcp_next_clip_id(project: &VideoMcpProject, state: &mut VideoMcpEditState) -> String {
    loop {
        let id = format!("c{}", state.next_clip_seq);
        state.next_clip_seq += 1;
        if video_mcp_find_clip_indices(project, &id).is_none() {
            return id;
        }
    }
}

fn video_mcp_next_link_id(project: &VideoMcpProject, state: &mut VideoMcpEditState) -> String {
    loop {
        let id = format!("link-mcp-{}", state.next_link_seq);
        state.next_link_seq += 1;
        let exists = project
            .tracks
            .iter()
            .flat_map(|track| track.clips.iter())
            .any(|clip| clip.link_id == id);
        if !exists {
            return id;
        }
    }
}

fn video_mcp_linked_clip_ids(project: &VideoMcpProject, clip_id: &str) -> Vec<String> {
    let Some((track_index, clip_index)) = video_mcp_find_clip_indices(project, clip_id) else {
        return vec![clip_id.to_string()];
    };
    let link_id = project.tracks[track_index].clips[clip_index]
        .link_id
        .clone();
    if link_id.is_empty() {
        return vec![clip_id.to_string()];
    }
    let ids = project
        .tracks
        .iter()
        .flat_map(|track| track.clips.iter())
        .filter(|clip| clip.link_id == link_id)
        .map(|clip| clip.id.clone())
        .collect::<Vec<_>>();
    if ids.is_empty() {
        vec![clip_id.to_string()]
    } else {
        ids
    }
}

fn video_mcp_expand_with_links(project: &VideoMcpProject, clip_ids: &[String]) -> Vec<String> {
    let mut expanded = std::collections::BTreeSet::new();
    for clip_id in clip_ids {
        for id in video_mcp_linked_clip_ids(project, clip_id) {
            expanded.insert(id);
        }
    }
    expanded.into_iter().collect()
}

fn video_mcp_split_clip_core(
    project: &mut VideoMcpProject,
    clip_id: &str,
    at_timeline_ms: u64,
    state: &mut VideoMcpEditState,
) -> Result<String, String> {
    let (track_index, clip_index) = video_mcp_find_clip_indices(project, clip_id)
        .ok_or_else(|| format!("clip {clip_id} not found"))?;
    if project.tracks[track_index].locked {
        return Err(format!("clip {clip_id} is on a locked track"));
    }
    let clip_start = project.tracks[track_index].clips[clip_index].timeline_start_ms;
    let clip_duration = project.tracks[track_index].clips[clip_index].duration_ms;
    let offset = video_mcp_diff_i64(at_timeline_ms, clip_start);
    if offset < VIDEO_MCP_MIN_CLIP_DURATION_MS as i64
        || offset > clip_duration.saturating_sub(VIDEO_MCP_MIN_CLIP_DURATION_MS) as i64
    {
        return Err("split point is too close to a clip edge".to_string());
    }
    let offset = offset as u64;
    let right_id = video_mcp_next_clip_id(project, state);
    let track_is_media = video_mcp_is_media_track(&project.tracks[track_index]);
    let mut right = project.tracks[track_index].clips[clip_index].clone();
    right.id = right_id.clone();
    right.timeline_start_ms = clip_start.saturating_add(offset);
    right.duration_ms = clip_duration.saturating_sub(offset);
    {
        let left = &mut project.tracks[track_index].clips[clip_index];
        left.duration_ms = offset;
        if track_is_media {
            let speed = left.speed.max(0.0001);
            right.source_in_ms = left
                .source_in_ms
                .saturating_add(video_mcp_round_u64(offset as f64 * speed));
            right.link_id.clear();
            video_mcp_partition_envelopes_at(left, Some(&mut right), offset);
        }
    }
    project.tracks[track_index].clips.push(right);
    video_mcp_sort_track(&mut project.tracks[track_index]);
    state.changed_clip_ids.insert(clip_id.to_string());
    state.changed_clip_ids.insert(right_id.clone());
    Ok(right_id)
}

fn video_mcp_split(
    project: &mut VideoMcpProject,
    clip_id: &str,
    at_timeline_ms: u64,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    let ids = video_mcp_expand_with_links(project, &[clip_id.to_string()]);
    let mut right_ids = Vec::new();
    for id in ids {
        right_ids.push(video_mcp_split_clip_core(
            project,
            &id,
            at_timeline_ms,
            state,
        )?);
    }
    if right_ids.len() >= 2 {
        let link_id = video_mcp_next_link_id(project, state);
        for right_id in &right_ids {
            if let Some((track_index, clip_index)) = video_mcp_find_clip_indices(project, right_id)
            {
                project.tracks[track_index].clips[clip_index].link_id = link_id.clone();
            }
        }
    }
    state.summaries.push(format!("split {clip_id}"));
    Ok(())
}

fn video_mcp_trim_clip_start(clip: &mut VideoMcpClip, track_kind: &str, delta_ms: i64) {
    let max_delta = clip
        .duration_ms
        .saturating_sub(VIDEO_MCP_MIN_CLIP_DURATION_MS) as i64;
    let min_delta = -(clip.timeline_start_ms as i64);
    let source_floor = if track_kind == "text" {
        min_delta
    } else {
        let speed = clip.speed.max(0.0001);
        (-(clip.source_in_ms as f64 / speed)).ceil() as i64
    };
    let applied = delta_ms.max(min_delta.max(source_floor)).min(max_delta);
    clip.timeline_start_ms = video_mcp_add_i64(clip.timeline_start_ms, applied);
    if applied >= 0 {
        clip.duration_ms = clip.duration_ms.saturating_sub(applied as u64);
    } else {
        clip.duration_ms = clip.duration_ms.saturating_add(applied.unsigned_abs());
    }
    if track_kind != "text" {
        let new_source =
            (clip.source_in_ms as f64 + applied as f64 * clip.speed.max(0.0001)).max(0.0);
        clip.source_in_ms = video_mcp_round_u64(new_source);
    }
}

fn video_mcp_trim_clip_end(clip: &mut VideoMcpClip, delta_ms: i64) {
    let next = video_mcp_add_i64(clip.duration_ms, delta_ms);
    clip.duration_ms = next.max(VIDEO_MCP_MIN_CLIP_DURATION_MS);
}

fn video_mcp_trim_single(
    project: &mut VideoMcpProject,
    clip_id: &str,
    edge: &str,
    delta_ms: i64,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    let (track_index, clip_index) = video_mcp_find_clip_indices(project, clip_id)
        .ok_or_else(|| format!("clip {clip_id} not found"))?;
    if project.tracks[track_index].locked {
        return Err(format!("clip {clip_id} is on a locked track"));
    }
    let track_kind = project.tracks[track_index].kind.clone();
    let clip = &mut project.tracks[track_index].clips[clip_index];
    match edge {
        "start" => video_mcp_trim_clip_start(clip, &track_kind, delta_ms),
        "end" => video_mcp_trim_clip_end(clip, delta_ms),
        _ => return Err("edge must be start or end".to_string()),
    }
    video_mcp_sort_track(&mut project.tracks[track_index]);
    state.changed_clip_ids.insert(clip_id.to_string());
    Ok(())
}

fn video_mcp_trim(
    project: &mut VideoMcpProject,
    clip_id: &str,
    edge: &str,
    delta_ms: i64,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    let affected_ids = video_mcp_expand_with_links(project, &[clip_id.to_string()]);
    for id in affected_ids {
        video_mcp_trim_single(project, &id, edge, delta_ms, state)?;
    }
    Ok(())
}

fn video_mcp_ripple_trim(
    project: &mut VideoMcpProject,
    clip_id: &str,
    edge: &str,
    delta_ms: i64,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    let (before_track, before_clip) = video_mcp_find_clip_indices(project, clip_id)
        .ok_or_else(|| format!("clip {clip_id} not found"))?;
    let before_duration = project.tracks[before_track].clips[before_clip].duration_ms;
    let before_end = video_mcp_clip_end(&project.tracks[before_track].clips[before_clip]);
    let affected_ids = video_mcp_expand_with_links(project, &[clip_id.to_string()]);
    let mut original_starts = std::collections::HashMap::new();
    for id in &affected_ids {
        if let Some((track_index, clip_index)) = video_mcp_find_clip_indices(project, id) {
            original_starts.insert(
                id.clone(),
                project.tracks[track_index].clips[clip_index].timeline_start_ms,
            );
        }
    }
    for id in &affected_ids {
        video_mcp_trim_single(project, id, edge, delta_ms, state)?;
    }
    let Some((after_track, after_clip)) = video_mcp_find_clip_indices(project, clip_id) else {
        return Err(format!("clip {clip_id} not found after trim"));
    };
    let after_duration = project.tracks[after_track].clips[after_clip].duration_ms;
    let duration_delta = video_mcp_diff_i64(after_duration, before_duration);
    let mut track_ids = std::collections::BTreeSet::new();
    for id in &affected_ids {
        if let Some((track_index, _clip_index)) = video_mcp_find_clip_indices(project, id) {
            track_ids.insert(project.tracks[track_index].id.clone());
        }
    }
    if edge == "start" {
        for id in &affected_ids {
            if let Some(original_start) = original_starts.get(id).copied() {
                if let Some((track_index, clip_index)) = video_mcp_find_clip_indices(project, id) {
                    project.tracks[track_index].clips[clip_index].timeline_start_ms =
                        original_start;
                }
            }
        }
    }
    if duration_delta != 0 {
        for track in &mut project.tracks {
            if track.locked || !track_ids.contains(&track.id) {
                continue;
            }
            for clip in &mut track.clips {
                if affected_ids.iter().any(|id| id == &clip.id) {
                    continue;
                }
                if clip.timeline_start_ms >= before_end {
                    clip.timeline_start_ms =
                        video_mcp_add_i64(clip.timeline_start_ms, duration_delta);
                    state.changed_clip_ids.insert(clip.id.clone());
                }
            }
            video_mcp_sort_track(track);
        }
    }
    for id in affected_ids {
        state.changed_clip_ids.insert(id);
    }
    state.summaries.push(format!("ripple trimmed {clip_id}"));
    Ok(())
}

fn video_mcp_first_free_position_on_track(
    track: &VideoMcpTrack,
    start_ms: u64,
    duration_ms: u64,
    ignore_ids: &std::collections::HashSet<String>,
) -> u64 {
    let mut clips = track
        .clips
        .iter()
        .filter(|clip| !ignore_ids.contains(&clip.id))
        .collect::<Vec<_>>();
    clips.sort_by_key(|clip| clip.timeline_start_ms);
    let mut candidate = start_ms;
    for clip in clips {
        if candidate.saturating_add(duration_ms) <= clip.timeline_start_ms {
            break;
        }
        let clip_end = video_mcp_clip_end(clip);
        if candidate < clip_end {
            candidate = clip_end;
        }
    }
    candidate
}

#[derive(Debug, Clone)]
struct VideoMcpAssetInfo {
    rel_path: String,
    kind: &'static str,
    duration_ms: Option<u64>,
    has_audio: bool,
}

fn video_mcp_probe_asset_info(
    root: &std::path::Path,
    media_root: &std::path::Path,
    asset_path: &str,
    ffprobe_path: Option<&str>,
) -> Result<VideoMcpAssetInfo, String> {
    let (abs, rel_path, kind, metadata) =
        video_resolve_existing_media_file(root, media_root, asset_path)?;
    let rel_path = video_manifest_asset_path(root, media_root, &rel_path)?;
    let cache_key = video_cache_key(&rel_path, video_file_modified_ms(&metadata), metadata.len());
    let cache_path = media_root
        .join(VIDEO_CACHE_DIR)
        .join(VIDEO_PROBE_CACHE_FILE);
    let mut probe_cache = video_read_probe_cache(&cache_path);
    let mut probe_cache_dirty = false;
    let probe = if let Some(cached) = probe_cache.get(&cache_key) {
        Some(video_probe_from_cache(cached))
    } else if let Some(ffprobe_path) = ffprobe_path {
        let summary = video_probe_media(ffprobe_path, &abs);
        if let Some(summary) = &summary {
            probe_cache.insert(cache_key, video_probe_to_cache(summary));
            probe_cache_dirty = true;
        }
        summary
    } else {
        None
    };
    if probe_cache_dirty {
        let _ = video_write_probe_cache(&cache_path, &probe_cache);
    }
    if matches!(kind, "audio" | "video")
        && probe.as_ref().and_then(|probe| probe.duration_ms).is_none()
    {
        return Err(format!(
            "addClip: could not probe {rel_path} — is ffmpeg installed?"
        ));
    }
    Ok(VideoMcpAssetInfo {
        rel_path,
        kind,
        duration_ms: probe.as_ref().and_then(|probe| probe.duration_ms),
        has_audio: probe
            .as_ref()
            .and_then(|probe| probe.has_audio)
            .unwrap_or(false),
    })
}

fn video_mcp_track_label(project: &VideoMcpProject, kind: &str) -> String {
    let count = project
        .tracks
        .iter()
        .filter(|track| track.kind == kind)
        .count()
        + 1;
    let prefix = match kind {
        "audio" => "A",
        "text" => "T",
        _ => "V",
    };
    format!("{prefix}{count}")
}

fn video_mcp_first_unlocked_track_or_create(project: &mut VideoMcpProject, kind: &str) -> usize {
    if let Some(index) = project
        .tracks
        .iter()
        .position(|track| track.kind == kind && !track.locked)
    {
        return index;
    }
    let label = video_mcp_track_label(project, kind);
    video_mcp_add_track(project, kind, &label)
}

fn video_mcp_audio_track_with_slot_or_create(
    project: &mut VideoMcpProject,
    start_ms: u64,
    duration_ms: u64,
) -> usize {
    let ignore = std::collections::HashSet::new();
    if let Some(index) = project.tracks.iter().position(|track| {
        track.kind == "audio"
            && !track.locked
            && video_mcp_first_free_position_on_track(track, start_ms, duration_ms, &ignore)
                == start_ms
    }) {
        return index;
    }
    let label = video_mcp_track_label(project, "audio");
    video_mcp_add_track(project, "audio", &label)
}

fn video_mcp_clip_duration_for_asset(
    info: &VideoMcpAssetInfo,
    source_in_ms: u64,
    requested_duration_ms: Option<u64>,
) -> Result<u64, String> {
    if info.kind == "image" {
        return Ok(requested_duration_ms
            .unwrap_or(4000)
            .max(VIDEO_MCP_MIN_CLIP_DURATION_MS));
    }
    let fallback_duration = info.duration_ms.unwrap_or(3000);
    if let Some(asset_duration) = info.duration_ms {
        if source_in_ms >= asset_duration {
            return Err("sourceInMs is beyond the asset duration".to_string());
        }
        let available = asset_duration.saturating_sub(source_in_ms);
        if available < VIDEO_MCP_MIN_CLIP_DURATION_MS {
            return Err("sourceInMs leaves less than the minimum clip duration".to_string());
        }
        return Ok(requested_duration_ms
            .unwrap_or(available)
            .max(VIDEO_MCP_MIN_CLIP_DURATION_MS)
            .min(available));
    }
    Ok(requested_duration_ms
        .unwrap_or(fallback_duration)
        .max(VIDEO_MCP_MIN_CLIP_DURATION_MS))
}

fn video_mcp_add_clip(
    project: &mut VideoMcpProject,
    root: &std::path::Path,
    media_root: &std::path::Path,
    asset_path: &str,
    at_ms: u64,
    source_in_ms: u64,
    duration_ms: Option<u64>,
    track_hint: Option<&str>,
    ffprobe_path: Option<&str>,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    let info = video_mcp_probe_asset_info(root, media_root, asset_path, ffprobe_path)?;
    let wanted_kind = if info.kind == "audio" {
        "audio"
    } else {
        "video"
    };
    if let Some(track_hint) = track_hint {
        if !matches!(track_hint, "audio" | "video") {
            return Err("trackHint must be video or audio".to_string());
        }
        if track_hint != wanted_kind {
            return Err(format!(
                "{info_kind} assets must be added to {wanted_kind} tracks",
                info_kind = info.kind
            ));
        }
    }
    let duration_ms = video_mcp_clip_duration_for_asset(&info, source_in_ms, duration_ms)?;
    let track_index = video_mcp_first_unlocked_track_or_create(project, wanted_kind);
    let ignore = std::collections::HashSet::new();
    let start_ms = video_mcp_first_free_position_on_track(
        &project.tracks[track_index],
        at_ms,
        duration_ms,
        &ignore,
    );
    let clip_id = video_mcp_next_clip_id(project, state);
    let wants_linked_audio = info.kind == "video" && info.has_audio;
    let mut clip = VideoMcpClip {
        id: clip_id.clone(),
        asset_path: info.rel_path.clone(),
        timeline_start_ms: start_ms,
        duration_ms,
        source_in_ms,
        speed: 1.0,
        ..VideoMcpClip::default()
    };
    if wants_linked_audio {
        clip.gain.level = 0.0;
    }
    project.tracks[track_index].clips.push(clip);
    video_mcp_sort_track(&mut project.tracks[track_index]);
    state.changed_clip_ids.insert(clip_id.clone());

    let mut audio_clip_id = None;
    if wants_linked_audio {
        let audio_track_index =
            video_mcp_audio_track_with_slot_or_create(project, start_ms, duration_ms);
        let audio_id = video_mcp_next_clip_id(project, state);
        project.tracks[audio_track_index].clips.push(VideoMcpClip {
            id: audio_id.clone(),
            asset_path: info.rel_path,
            timeline_start_ms: start_ms,
            duration_ms,
            source_in_ms,
            speed: 1.0,
            ..VideoMcpClip::default()
        });
        video_mcp_sort_track(&mut project.tracks[audio_track_index]);
        let link_id = video_mcp_next_link_id(project, state);
        if let Some((video_track_index, video_clip_index)) =
            video_mcp_find_clip_indices(project, &clip_id)
        {
            project.tracks[video_track_index].clips[video_clip_index].link_id = link_id.clone();
        }
        if let Some((audio_track_index, audio_clip_index)) =
            video_mcp_find_clip_indices(project, &audio_id)
        {
            project.tracks[audio_track_index].clips[audio_clip_index].link_id = link_id;
        }
        state.changed_clip_ids.insert(audio_id.clone());
        audio_clip_id = Some(audio_id);
    }
    match audio_clip_id {
        Some(audio_id) => state
            .summaries
            .push(format!("added {clip_id} with linked audio {audio_id}")),
        None => state.summaries.push(format!("added {clip_id}")),
    }
    Ok(())
}

fn video_mcp_move_clips(
    project: &mut VideoMcpProject,
    clip_ids: &[String],
    delta_ms: i64,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    let id_set = clip_ids
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let mut targets = Vec::new();
    for (track_index, track) in project.tracks.iter().enumerate() {
        if track.locked {
            continue;
        }
        for (clip_index, clip) in track.clips.iter().enumerate() {
            if id_set.contains(&clip.id) {
                targets.push((track_index, clip_index, clip.id.clone()));
            }
        }
    }
    if targets.is_empty() {
        return Err("no movable clips found".to_string());
    }
    let min_start = targets
        .iter()
        .map(|(track_index, clip_index, _)| {
            project.tracks[*track_index].clips[*clip_index].timeline_start_ms
        })
        .min()
        .unwrap_or(0);
    let mut applied = delta_ms.max(-(min_start as i64));
    for _ in 0..10 {
        let mut push = 0i64;
        for (track_index, clip_index, _) in &targets {
            let clip = &project.tracks[*track_index].clips[*clip_index];
            let proposed = video_mcp_add_i64(clip.timeline_start_ms, applied);
            let proposed_end = proposed.saturating_add(clip.duration_ms);
            for other in &project.tracks[*track_index].clips {
                if id_set.contains(&other.id) {
                    continue;
                }
                if proposed < video_mcp_clip_end(other) && proposed_end > other.timeline_start_ms {
                    push = push.max(video_mcp_diff_i64(video_mcp_clip_end(other), proposed));
                }
            }
        }
        if push == 0 {
            break;
        }
        applied = applied.saturating_add(push);
    }
    for (track_index, clip_index, clip_id) in targets {
        project.tracks[track_index].clips[clip_index].timeline_start_ms = video_mcp_add_i64(
            project.tracks[track_index].clips[clip_index].timeline_start_ms,
            applied,
        );
        state.changed_clip_ids.insert(clip_id);
    }
    video_mcp_sort_tracks(project);
    Ok(())
}

fn video_mcp_move_clip_to_track(
    project: &mut VideoMcpProject,
    clip_id: &str,
    target_track_index: usize,
    to_start_ms: u64,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    if target_track_index >= project.tracks.len() {
        return Err("toTrackIndex is out of range".to_string());
    }
    let (source_track_index, source_clip_index) = video_mcp_find_clip_indices(project, clip_id)
        .ok_or_else(|| format!("clip {clip_id} not found"))?;
    if project.tracks[source_track_index].locked || project.tracks[target_track_index].locked {
        return Err("source or target track is locked".to_string());
    }
    let source_is_text = project.tracks[source_track_index].kind == "text";
    let target_is_text = project.tracks[target_track_index].kind == "text";
    if source_is_text != target_is_text {
        return Err("clip can only move to a track in the same media family".to_string());
    }
    let mut clip = project.tracks[source_track_index]
        .clips
        .remove(source_clip_index);
    let ignore = std::collections::HashSet::new();
    clip.timeline_start_ms = video_mcp_first_free_position_on_track(
        &project.tracks[target_track_index],
        to_start_ms,
        clip.duration_ms,
        &ignore,
    );
    project.tracks[target_track_index].clips.push(clip);
    video_mcp_sort_tracks(project);
    state.changed_clip_ids.insert(clip_id.to_string());
    Ok(())
}

fn video_mcp_move(
    project: &mut VideoMcpProject,
    clip_id: &str,
    to_start_ms: u64,
    to_track_index: Option<usize>,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    let (track_index, clip_index) = video_mcp_find_clip_indices(project, clip_id)
        .ok_or_else(|| format!("clip {clip_id} not found"))?;
    let current_start = project.tracks[track_index].clips[clip_index].timeline_start_ms;
    let linked_ids = video_mcp_expand_with_links(project, &[clip_id.to_string()]);
    if let Some(target_track_index) = to_track_index {
        if linked_ids.len() > 1 && target_track_index != track_index {
            return Err("toTrackIndex is only supported for unlinked clips".to_string());
        }
        if linked_ids.len() == 1 {
            video_mcp_move_clip_to_track(project, clip_id, target_track_index, to_start_ms, state)?;
            state.summaries.push(format!("moved {clip_id}"));
            return Ok(());
        }
    }
    video_mcp_move_clips(
        project,
        &linked_ids,
        video_mcp_diff_i64(to_start_ms, current_start),
        state,
    )?;
    state.summaries.push(format!("moved {clip_id}"));
    Ok(())
}

fn video_mcp_remove_clips(
    project: &mut VideoMcpProject,
    clip_ids: &[String],
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    let expanded = video_mcp_expand_with_links(project, clip_ids);
    if expanded.is_empty() {
        return Err("clipIds is empty".to_string());
    }
    let ids = expanded
        .into_iter()
        .collect::<std::collections::HashSet<_>>();
    let mut removed = 0usize;
    for track in &mut project.tracks {
        if track.locked {
            continue;
        }
        let before = track.clips.len();
        track.clips.retain(|clip| !ids.contains(&clip.id));
        removed += before.saturating_sub(track.clips.len());
    }
    if removed == 0 {
        return Err("no removable clips found".to_string());
    }
    for id in ids {
        state.changed_clip_ids.insert(id);
    }
    state.summaries.push(format!("removed {removed} clip(s)"));
    Ok(())
}

fn video_mcp_ripple_delete_range(
    project: &mut VideoMcpProject,
    start_ms: u64,
    end_ms: u64,
    state: &mut VideoMcpEditState,
) -> Result<Vec<String>, String> {
    let from = start_ms.min(end_ms);
    let to = start_ms.max(end_ms);
    let gap = to.saturating_sub(from);
    if gap == 0 {
        return Err("rippleDeleteRange requires a non-empty range".to_string());
    }
    let mut changed = std::collections::BTreeSet::new();
    for track_index in 0..project.tracks.len() {
        if project.tracks[track_index].locked {
            continue;
        }
        let track_kind = project.tracks[track_index].kind.clone();
        let old_clips = std::mem::take(&mut project.tracks[track_index].clips);
        let mut kept = Vec::new();
        for clip in old_clips {
            let start = clip.timeline_start_ms;
            let end = video_mcp_clip_end(&clip);
            if end <= from {
                kept.push(clip);
                continue;
            }
            if start >= to {
                let mut shifted = clip;
                shifted.timeline_start_ms = shifted.timeline_start_ms.saturating_sub(gap);
                changed.insert(shifted.id.clone());
                kept.push(shifted);
                continue;
            }
            changed.insert(clip.id.clone());
            if start < from {
                let mut head = clip.clone();
                head.duration_ms = from - start;
                if head.duration_ms >= VIDEO_MCP_MIN_CLIP_DURATION_MS {
                    if track_kind != "text" {
                        let head_duration = head.duration_ms;
                        video_mcp_partition_envelopes_at(&mut head, None, head_duration);
                    }
                    kept.push(head);
                }
            }
            if end > to {
                let mut tail = clip.clone();
                let cut = to - start;
                tail.id = video_mcp_next_clip_id(project, state);
                tail.timeline_start_ms = from;
                tail.duration_ms = end - to;
                if track_kind != "text" {
                    tail.source_in_ms = clip
                        .source_in_ms
                        .saturating_add(video_mcp_round_u64(cut as f64 * clip.speed.max(0.0001)));
                    video_mcp_rebase_envelopes_from(&mut tail, cut);
                    tail.link_id.clear();
                }
                if tail.duration_ms >= VIDEO_MCP_MIN_CLIP_DURATION_MS {
                    changed.insert(tail.id.clone());
                    kept.push(tail);
                }
            }
        }
        project.tracks[track_index].clips = kept;
        video_mcp_sort_track(&mut project.tracks[track_index]);
    }
    for id in &changed {
        state.changed_clip_ids.insert(id.clone());
    }
    state.summaries.push(format!("ripple deleted {from}..{to}"));
    Ok(changed.into_iter().collect())
}

fn video_mcp_text_style(style: Option<&serde_json::Value>) -> serde_json::Value {
    let raw = style.unwrap_or(&serde_json::Value::Null);
    let mut output = serde_json::Map::new();
    let font_size = raw
        .get("fontSize")
        .and_then(video_mcp_value_f64)
        .unwrap_or(48.0)
        .clamp(8.0, 400.0);
    output.insert("fontSize".to_string(), serde_json::json!(font_size));
    output.insert(
        "color".to_string(),
        serde_json::json!(
            raw.get("color")
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .unwrap_or("#ffffff")
        ),
    );
    output.insert(
        "background".to_string(),
        serde_json::json!(
            raw.get("background")
                .and_then(|value| value.as_str())
                .unwrap_or("")
        ),
    );
    output.insert(
        "x".to_string(),
        serde_json::json!(
            raw.get("x")
                .and_then(video_mcp_value_f64)
                .unwrap_or(0.5)
                .clamp(0.0, 1.0)
        ),
    );
    output.insert(
        "y".to_string(),
        serde_json::json!(
            raw.get("y")
                .and_then(video_mcp_value_f64)
                .unwrap_or(0.85)
                .clamp(0.0, 1.0)
        ),
    );
    let align = raw
        .get("align")
        .and_then(|value| value.as_str())
        .filter(|value| matches!(*value, "left" | "center" | "right"))
        .unwrap_or("center");
    output.insert("align".to_string(), serde_json::json!(align));
    output.insert(
        "bold".to_string(),
        serde_json::json!(
            raw.get("bold")
                .and_then(|value| value.as_bool())
                .unwrap_or(true)
        ),
    );
    output.insert(
        "fontFamily".to_string(),
        serde_json::json!(
            raw.get("fontFamily")
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .unwrap_or("sans-serif")
        ),
    );
    output.insert(
        "outlineColor".to_string(),
        serde_json::json!(
            raw.get("outlineColor")
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .unwrap_or("#000000")
        ),
    );
    output.insert(
        "outlineWidth".to_string(),
        serde_json::json!(
            raw.get("outlineWidth")
                .and_then(video_mcp_value_f64)
                .unwrap_or(0.0)
                .clamp(0.0, 40.0)
        ),
    );
    output.insert(
        "shadow".to_string(),
        serde_json::json!(
            raw.get("shadow")
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
        ),
    );
    output.insert(
        "uppercase".to_string(),
        serde_json::json!(
            raw.get("uppercase")
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
        ),
    );
    serde_json::Value::Object(output)
}

fn video_mcp_caption_style() -> serde_json::Value {
    video_mcp_text_style(Some(&serde_json::json!({
        "fontSize": 34,
        "color": "#ffffff",
        "background": "rgba(0, 0, 0, 0.55)",
        "x": 0.5,
        "y": 0.92,
        "align": "center",
        "bold": true,
        "fontFamily": "sans-serif",
    })))
}

fn video_mcp_add_track(project: &mut VideoMcpProject, kind: &str, label: &str) -> usize {
    let count = project
        .tracks
        .iter()
        .filter(|track| track.kind == kind)
        .count()
        + 1;
    let id = match kind {
        "audio" => format!("a{count}"),
        "text" => format!("t{count}"),
        _ => format!("v{count}"),
    };
    project.tracks.push(VideoMcpTrack {
        id,
        kind: kind.to_string(),
        label: label.to_string(),
        muted: false,
        locked: false,
        clips: Vec::new(),
    });
    project.tracks.len() - 1
}

fn video_mcp_first_text_track_or_create(project: &mut VideoMcpProject, label: &str) -> usize {
    if let Some(index) = project
        .tracks
        .iter()
        .position(|track| track.kind == "text" && !track.locked)
    {
        return index;
    }
    video_mcp_add_track(project, "text", label)
}

fn video_mcp_captions_track_or_create(project: &mut VideoMcpProject) -> usize {
    if let Some(index) = project
        .tracks
        .iter()
        .position(|track| track.kind == "text" && track.label == "Captions" && !track.locked)
    {
        return index;
    }
    video_mcp_add_track(project, "text", "Captions")
}

fn video_mcp_add_text(
    project: &mut VideoMcpProject,
    text: String,
    at_ms: u64,
    duration_ms: u64,
    style: Option<&serde_json::Value>,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    let track_index = video_mcp_first_text_track_or_create(project, "Text");
    let id = video_mcp_next_clip_id(project, state);
    let clip = VideoMcpClip {
        id: id.clone(),
        text: if text.trim().is_empty() {
            "Text".to_string()
        } else {
            text
        },
        timeline_start_ms: at_ms,
        duration_ms: duration_ms.max(VIDEO_MCP_MIN_CLIP_DURATION_MS),
        style: video_mcp_text_style(style),
        ..VideoMcpClip::default()
    };
    project.tracks[track_index].clips.push(clip);
    video_mcp_sort_track(&mut project.tracks[track_index]);
    state.changed_clip_ids.insert(id);
    state.summaries.push("added text".to_string());
    Ok(())
}

fn video_mcp_resolve_transcript_for_asset(
    root: &std::path::Path,
    media_root: &std::path::Path,
    manifest: &VideoMediaManifest,
    asset_path: &str,
) -> Result<(String, Option<String>, VideoTranscriptCache), String> {
    let (_abs, rel_path, kind, metadata) =
        video_resolve_existing_media_file(root, media_root, asset_path)?;
    if !matches!(kind, "audio" | "video") {
        return Err("Transcripts are only available for audio or video media.".to_string());
    }
    let (inherited_from, cache) = video_resolve_transcript_cache(
        root, media_root, manifest, &rel_path, &metadata,
    )?
    .ok_or_else(|| {
        format!(
            "No transcript for {rel_path}; call video_transcribe before editing words or captions."
        )
    })?;
    Ok((rel_path, inherited_from, cache))
}

fn video_mcp_add_captions(
    project: &mut VideoMcpProject,
    root: &std::path::Path,
    media_root: &std::path::Path,
    manifest: &VideoMediaManifest,
    clip_id: &str,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    let (track_index, clip_index) = video_mcp_find_clip_indices(project, clip_id)
        .ok_or_else(|| format!("clip {clip_id} not found"))?;
    if !video_mcp_is_media_track(&project.tracks[track_index]) {
        return Err("captions require a media clip".to_string());
    }
    let source_clip = project.tracks[track_index].clips[clip_index].clone();
    let (_rel_path, _inherited_from, cache) = video_mcp_resolve_transcript_for_asset(
        root,
        media_root,
        manifest,
        &source_clip.asset_path,
    )?;
    let caption_group = format!("cap-{}", source_clip.id);
    for track in &mut project.tracks {
        if track.kind == "text" {
            track
                .clips
                .retain(|clip| clip.caption_group != caption_group);
        }
    }
    let captions_track = video_mcp_captions_track_or_create(project);
    let speed = source_clip.speed.max(0.0001);
    let source_from = source_clip.source_in_ms;
    let source_to =
        source_from.saturating_add(video_mcp_round_u64(source_clip.duration_ms as f64 * speed));
    let mut count = 0usize;
    for segment in cache.segments {
        if segment.end_ms <= source_from || segment.start_ms >= source_to {
            continue;
        }
        let text = segment.text.trim().to_string();
        if text.is_empty() {
            continue;
        }
        let start_src = segment.start_ms.max(source_from);
        let end_src = segment.end_ms.min(source_to);
        if end_src.saturating_sub(start_src) < VIDEO_MCP_MIN_CLIP_DURATION_MS {
            continue;
        }
        let id = video_mcp_next_clip_id(project, state);
        let timeline_start = source_clip
            .timeline_start_ms
            .saturating_add(video_mcp_round_u64(
                (start_src - source_from) as f64 / speed,
            ));
        let duration_ms = video_mcp_round_u64((end_src - start_src) as f64 / speed)
            .max(VIDEO_MCP_MIN_CLIP_DURATION_MS);
        project.tracks[captions_track].clips.push(VideoMcpClip {
            id: id.clone(),
            text,
            timeline_start_ms: timeline_start,
            duration_ms,
            style: video_mcp_caption_style(),
            caption_group: caption_group.clone(),
            ..VideoMcpClip::default()
        });
        state.changed_clip_ids.insert(id);
        count += 1;
    }
    video_mcp_sort_track(&mut project.tracks[captions_track]);
    state.changed_clip_ids.insert(clip_id.to_string());
    state.summaries.push(format!("added {count} caption(s)"));
    Ok(())
}

fn video_mcp_remove_word_spans(
    project: &mut VideoMcpProject,
    asset_path: &str,
    mut spans: Vec<(u64, u64)>,
    state: &mut VideoMcpEditState,
) -> Result<Vec<(u64, u64)>, String> {
    if spans.is_empty() {
        return Err("no transcript word spans selected".to_string());
    }
    spans.sort_by_key(|span| span.0);
    let mut merged = Vec::<(u64, u64)>::new();
    for span in spans {
        if let Some(last) = merged.last_mut() {
            if span.0.saturating_sub(last.1) < VIDEO_MCP_REMOVE_WORDS_MERGE_GAP_MS {
                last.1 = last.1.max(span.1);
                continue;
            }
        }
        merged.push(span);
    }
    let mut timeline_ranges = Vec::<(u64, u64)>::new();
    for track in &project.tracks {
        for clip in &track.clips {
            if clip.asset_path != asset_path {
                continue;
            }
            let speed = clip.speed.max(0.0001);
            let source_from = clip.source_in_ms;
            let source_to =
                source_from.saturating_add(video_mcp_round_u64(clip.duration_ms as f64 * speed));
            for (span_start, span_end) in &merged {
                let from = (*span_start).max(source_from);
                let to = (*span_end).min(source_to);
                if to.saturating_sub(from) < 40 {
                    continue;
                }
                timeline_ranges.push((
                    clip.timeline_start_ms
                        .saturating_add(video_mcp_round_u64((from - source_from) as f64 / speed)),
                    clip.timeline_start_ms
                        .saturating_add(video_mcp_round_u64((to - source_from) as f64 / speed)),
                ));
            }
        }
    }
    if timeline_ranges.is_empty() {
        return Err("selected words are outside all clips using this asset".to_string());
    }
    timeline_ranges.sort_by_key(|range| range.0);
    for (start, end) in timeline_ranges.iter().rev().copied() {
        video_mcp_ripple_delete_range(project, start, end, state)?;
    }
    Ok(timeline_ranges)
}

fn video_mcp_remove_words(
    project: &mut VideoMcpProject,
    root: &std::path::Path,
    media_root: &std::path::Path,
    manifest: &VideoMediaManifest,
    asset_path: &str,
    words_value: &serde_json::Value,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    let (rel_path, _inherited_from, cache) =
        video_mcp_resolve_transcript_for_asset(root, media_root, manifest, asset_path)?;
    let words = words_value
        .as_array()
        .ok_or_else(|| "words must be an array".to_string())?;
    let mut spans = Vec::<(u64, u64)>::new();
    for word_ref in words {
        let segment_index = word_ref
            .get("segment")
            .and_then(|value| value.as_u64())
            .ok_or_else(|| "word segment index is required".to_string())?
            as usize;
        let word_index = word_ref
            .get("word")
            .and_then(|value| value.as_u64())
            .ok_or_else(|| "word index is required".to_string())? as usize;
        let segment = cache
            .segments
            .get(segment_index)
            .ok_or_else(|| format!("transcript segment {segment_index} not found"))?;
        let word = segment
            .words
            .get(word_index)
            .ok_or_else(|| format!("transcript word {segment_index}:{word_index} not found"))?;
        if word.end_ms > word.start_ms {
            spans.push((word.start_ms, word.end_ms));
        }
    }
    let timeline_ranges = video_mcp_remove_word_spans(project, &rel_path, spans, state)?;
    state
        .summaries
        .push(format!("removed {} word range(s)", timeline_ranges.len()));
    Ok(())
}

fn video_mcp_apply_gain_patch(clip: &mut VideoMcpClip, gain: &serde_json::Value) {
    if let Some(level) = gain.get("level").and_then(video_mcp_value_f64) {
        clip.gain.level = video_mcp_clamp_gain(level);
    }
    if let Some(keyframes) = gain.get("keyframes").and_then(|value| value.as_array()) {
        clip.gain.keyframes = keyframes
            .iter()
            .filter_map(|frame| {
                Some(VideoMcpGainKeyframe {
                    at_ms: frame.get("atMs").and_then(video_mcp_value_u64)?,
                    level: video_mcp_clamp_gain(frame.get("level").and_then(video_mcp_value_f64)?),
                })
            })
            .collect();
        clip.gain.keyframes = video_mcp_normalize_gain_frames(&clip.gain.keyframes);
    }
}

fn video_mcp_apply_transform_patch(clip: &mut VideoMcpClip, transform: &serde_json::Value) {
    if let Some(value) = transform.get("x").and_then(video_mcp_value_f64) {
        clip.transform.x = value;
    }
    if let Some(value) = transform.get("y").and_then(video_mcp_value_f64) {
        clip.transform.y = value;
    }
    if let Some(value) = transform.get("scale").and_then(video_mcp_value_f64) {
        clip.transform.scale = value.clamp(0.05, 8.0);
    }
    if let Some(value) = transform.get("opacity").and_then(video_mcp_value_f64) {
        clip.transform.opacity = value.clamp(0.0, 1.0);
    }
}

fn video_mcp_apply_kf_patch(clip: &mut VideoMcpClip, kf: &serde_json::Value) {
    for prop in ["opacity", "x", "y", "scale"] {
        let Some(list) = kf.get(prop).and_then(|value| value.as_array()) else {
            continue;
        };
        let frames = list
            .iter()
            .filter_map(|frame| {
                let easing = frame
                    .get("easing")
                    .and_then(|value| value.as_str())
                    .filter(|value| matches!(*value, "linear" | "hold" | "smooth"))
                    .unwrap_or("linear");
                Some(VideoMcpPropKeyframe {
                    at_ms: frame.get("atMs").and_then(video_mcp_value_u64)?,
                    value: video_mcp_clamp_prop_value(
                        prop,
                        frame.get("value").and_then(video_mcp_value_f64)?,
                    ),
                    easing: easing.to_string(),
                })
            })
            .collect::<Vec<_>>();
        let frames = video_mcp_normalize_prop_frames(&frames, prop);
        if frames.is_empty() {
            clip.kf.remove(prop);
        } else {
            clip.kf.insert(prop.to_string(), frames);
        }
    }
}

fn video_mcp_merge_text_style(
    existing: &serde_json::Value,
    patch: &serde_json::Value,
) -> serde_json::Value {
    let mut merged = existing.as_object().cloned().unwrap_or_default();
    if let Some(object) = patch.as_object() {
        for key in [
            "fontSize",
            "color",
            "background",
            "x",
            "y",
            "align",
            "bold",
            "outlineColor",
            "outlineWidth",
            "shadow",
            "uppercase",
            "fontFamily",
        ] {
            if let Some(value) = object.get(key) {
                merged.insert(key.to_string(), value.clone());
            }
        }
    }
    video_mcp_text_style(Some(&serde_json::Value::Object(merged)))
}

fn video_mcp_set_props(
    project: &mut VideoMcpProject,
    clip_id: &str,
    patch: &serde_json::Value,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    let (track_index, clip_index) = video_mcp_find_clip_indices(project, clip_id)
        .ok_or_else(|| format!("clip {clip_id} not found"))?;
    if project.tracks[track_index].locked {
        return Err(format!("clip {clip_id} is on a locked track"));
    }
    let track_kind = project.tracks[track_index].kind.clone();
    let clip = &mut project.tracks[track_index].clips[clip_index];
    if track_kind == "text" {
        if let Some(text) = patch.get("text").and_then(|value| value.as_str()) {
            clip.text = text.to_string();
        }
        if let Some(style) = patch.get("style") {
            clip.style = video_mcp_merge_text_style(&clip.style, style);
        }
    } else {
        if let Some(speed) = patch.get("speed").and_then(video_mcp_value_f64) {
            clip.speed = video_mcp_clamp_speed(speed);
        }
        if let Some(gain) = patch.get("gain") {
            video_mcp_apply_gain_patch(clip, gain);
        }
        if let Some(transform) = patch.get("transform") {
            video_mcp_apply_transform_patch(clip, transform);
        }
        if let Some(kf) = patch.get("kf") {
            video_mcp_apply_kf_patch(clip, kf);
        }
    }
    state.changed_clip_ids.insert(clip_id.to_string());
    state.summaries.push(format!("set props for {clip_id}"));
    Ok(())
}

fn video_mcp_apply_ops(
    project: &mut VideoMcpProject,
    root: &std::path::Path,
    media_root: &std::path::Path,
    ops: &[serde_json::Value],
    ffprobe_path: Option<&str>,
) -> Result<VideoMcpEditState, String> {
    let manifest = video_read_media_manifest(&video_media_manifest_path(media_root));
    let mut state = VideoMcpEditState {
        next_clip_seq: video_mcp_project_clip_count(project).saturating_add(1),
        next_link_seq: 1,
        changed_clip_ids: std::collections::BTreeSet::new(),
        summaries: Vec::new(),
    };
    for (index, op_value) in ops.iter().enumerate() {
        let op_name = op_value
            .get("op")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let result = (|| -> Result<(), String> {
            match op_name {
                "split" => {
                    let clip_id = video_mcp_op_str(op_value, "clipId")?;
                    let at_ms = video_mcp_op_u64(op_value, "atMs")?;
                    video_mcp_split(project, clip_id, at_ms, &mut state)
                }
                "trim" => {
                    let clip_id = video_mcp_op_str(op_value, "clipId")?;
                    let edge = video_mcp_op_str(op_value, "edge")?;
                    let to_ms = video_mcp_op_u64(op_value, "toMs")?;
                    let (track_index, clip_index) =
                        video_mcp_find_clip_indices(project, clip_id)
                            .ok_or_else(|| format!("clip {clip_id} not found"))?;
                    let clip = &project.tracks[track_index].clips[clip_index];
                    let delta = if edge == "start" {
                        video_mcp_diff_i64(to_ms, clip.timeline_start_ms)
                    } else if edge == "end" {
                        video_mcp_diff_i64(to_ms, video_mcp_clip_end(clip))
                    } else {
                        return Err("edge must be start or end".to_string());
                    };
                    if op_value
                        .get("ripple")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false)
                    {
                        video_mcp_ripple_trim(project, clip_id, edge, delta, &mut state)
                    } else {
                        video_mcp_trim(project, clip_id, edge, delta, &mut state)
                    }
                }
                "move" => {
                    let clip_id = video_mcp_op_str(op_value, "clipId")?;
                    let to_start_ms = video_mcp_op_u64(op_value, "toStartMs")?;
                    let to_track_index = op_value
                        .get("toTrackIndex")
                        .and_then(|value| value.as_u64())
                        .map(|value| value as usize);
                    video_mcp_move(project, clip_id, to_start_ms, to_track_index, &mut state)
                }
                "remove" => {
                    let clip_ids = op_value
                        .get("clipIds")
                        .and_then(|value| value.as_array())
                        .ok_or_else(|| "clipIds must be an array".to_string())?
                        .iter()
                        .filter_map(|value| value.as_str().map(str::to_string))
                        .collect::<Vec<_>>();
                    if op_value
                        .get("ripple")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false)
                    {
                        let mut ranges = Vec::<(u64, u64)>::new();
                        for clip_id in video_mcp_expand_with_links(project, &clip_ids) {
                            if let Some((track_index, clip_index)) =
                                video_mcp_find_clip_indices(project, &clip_id)
                            {
                                if !project.tracks[track_index].locked {
                                    let clip = &project.tracks[track_index].clips[clip_index];
                                    ranges.push((clip.timeline_start_ms, video_mcp_clip_end(clip)));
                                }
                            }
                        }
                        ranges.sort();
                        ranges.dedup();
                        if ranges.is_empty() {
                            Err("no removable clips found".to_string())
                        } else {
                            for (start, end) in ranges.iter().rev().copied() {
                                video_mcp_ripple_delete_range(project, start, end, &mut state)?;
                            }
                            state
                                .summaries
                                .push(format!("ripple removed {} range(s)", ranges.len()));
                            Ok(())
                        }
                    } else {
                        video_mcp_remove_clips(project, &clip_ids, &mut state)
                    }
                }
                "rippleDeleteRange" => {
                    let start_ms = video_mcp_op_u64(op_value, "startMs")?;
                    let end_ms = video_mcp_op_u64(op_value, "endMs")?;
                    video_mcp_ripple_delete_range(project, start_ms, end_ms, &mut state).map(|_| ())
                }
                "addClip" => {
                    let asset_path = video_mcp_op_str(op_value, "assetPath")?;
                    let at_ms = video_mcp_op_u64(op_value, "atMs")?;
                    let source_in_ms = op_value
                        .get("sourceInMs")
                        .or_else(|| op_value.get("source_in_ms"))
                        .and_then(video_mcp_value_u64)
                        .unwrap_or(0);
                    let duration_ms = op_value
                        .get("durationMs")
                        .or_else(|| op_value.get("duration_ms"))
                        .and_then(video_mcp_value_u64);
                    let track_hint = op_value
                        .get("trackHint")
                        .or_else(|| op_value.get("track_hint"))
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty());
                    video_mcp_add_clip(
                        project,
                        root,
                        media_root,
                        asset_path,
                        at_ms,
                        source_in_ms,
                        duration_ms,
                        track_hint,
                        ffprobe_path,
                        &mut state,
                    )
                }
                "removeWords" => {
                    let asset_path = video_mcp_op_str(op_value, "assetPath")?;
                    let words = op_value
                        .get("words")
                        .ok_or_else(|| "words is required".to_string())?;
                    video_mcp_remove_words(
                        project, root, media_root, &manifest, asset_path, words, &mut state,
                    )
                }
                "addText" => {
                    let text = op_value
                        .get("text")
                        .and_then(|value| value.as_str())
                        .unwrap_or("Text")
                        .to_string();
                    let at_ms = video_mcp_op_u64(op_value, "atMs")?;
                    let duration_ms = video_mcp_op_u64(op_value, "durationMs")?;
                    video_mcp_add_text(
                        project,
                        text,
                        at_ms,
                        duration_ms,
                        op_value.get("style"),
                        &mut state,
                    )
                }
                "addCaptions" => {
                    let clip_id = video_mcp_op_str(op_value, "clipId")?;
                    video_mcp_add_captions(
                        project, root, media_root, &manifest, clip_id, &mut state,
                    )
                }
                "setProps" => {
                    let clip_id = video_mcp_op_str(op_value, "clipId")?;
                    let patch = op_value
                        .get("patch")
                        .ok_or_else(|| "patch is required".to_string())?;
                    video_mcp_set_props(project, clip_id, patch, &mut state)
                }
                _ => Err("unknown op".to_string()),
            }
        })();
        if let Err(error) = result {
            let name = if op_name.is_empty() {
                "unknown"
            } else {
                op_name
            };
            return Err(format!("op[{index}] {name}: {error}"));
        }
    }
    Ok(state)
}

fn video_mcp_apply_ops_atomically(
    project: &VideoMcpProject,
    root: &std::path::Path,
    media_root: &std::path::Path,
    ops: &[serde_json::Value],
    ffprobe_path: Option<&str>,
) -> Result<(VideoMcpProject, VideoMcpEditState), String> {
    let mut next_project = project.clone();
    let state = video_mcp_apply_ops(&mut next_project, root, media_root, ops, ffprobe_path)?;
    Ok((next_project, state))
}

fn video_mcp_clip_match_key(track_index: usize, clip: &VideoMcpClip) -> (usize, u64, u64, String) {
    let identity = if clip.asset_path.trim().is_empty() {
        clip.text.clone()
    } else {
        clip.asset_path.clone()
    };
    (
        track_index,
        clip.timeline_start_ms,
        clip.duration_ms,
        identity,
    )
}

fn video_mcp_reparsed_clip_id_map(
    mutated: &VideoMcpProject,
    reparsed: &VideoMcpProject,
) -> std::collections::BTreeMap<String, String> {
    let mut reparsed_by_key = std::collections::BTreeMap::<
        (usize, u64, u64, String),
        std::collections::VecDeque<String>,
    >::new();
    for (track_index, track) in reparsed.tracks.iter().enumerate() {
        for clip in &track.clips {
            reparsed_by_key
                .entry(video_mcp_clip_match_key(track_index, clip))
                .or_default()
                .push_back(clip.id.clone());
        }
    }

    let mut id_map = std::collections::BTreeMap::new();
    for (track_index, track) in mutated.tracks.iter().enumerate() {
        for clip in &track.clips {
            if let Some(ids) = reparsed_by_key.get_mut(&video_mcp_clip_match_key(track_index, clip))
            {
                if let Some(reparsed_id) = ids.pop_front() {
                    id_map.insert(clip.id.clone(), reparsed_id);
                }
            }
        }
    }
    id_map
}

fn video_mcp_reparsed_changed_clip_ids(
    changed_clip_ids: &std::collections::BTreeSet<String>,
    id_map: &std::collections::BTreeMap<String, String>,
) -> Vec<String> {
    changed_clip_ids
        .iter()
        .filter_map(|id| id_map.get(id).cloned())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn video_mcp_summary_id_boundary(byte: Option<u8>) -> bool {
    byte.map(|value| !value.is_ascii_alphanumeric() && value != b'_' && value != b'-')
        .unwrap_or(true)
}

fn video_mcp_rewrite_summary_ids(
    summary: &str,
    id_map: &std::collections::BTreeMap<String, String>,
) -> String {
    let mut replacements = id_map.iter().collect::<Vec<_>>();
    replacements.sort_by(|left, right| right.0.len().cmp(&left.0.len()));
    let bytes = summary.as_bytes();
    let mut output = String::new();
    let mut index = 0usize;
    while index < summary.len() {
        let mut matched = false;
        for (from, to) in &replacements {
            let end = index.saturating_add(from.len());
            if end <= summary.len()
                && &summary[index..end] == from.as_str()
                && video_mcp_summary_id_boundary(index.checked_sub(1).map(|before| bytes[before]))
                && video_mcp_summary_id_boundary(bytes.get(end).copied())
            {
                output.push_str(to);
                index = end;
                matched = true;
                break;
            }
        }
        if !matched {
            let ch = summary[index..]
                .chars()
                .next()
                .expect("index is within summary");
            output.push(ch);
            index += ch.len_utf8();
        }
    }
    output
}

async fn video_mcp_edit(
    app: tauri::AppHandle,
    repo_path: String,
    project_path: Option<String>,
    ops: serde_json::Value,
    include_pipe: bool,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, repo_key) = video_agent_state_key(repo_path.as_str())?;
        let (_root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        let status = video_tools_status_for(&app);
        let project_abs =
            video_mcp_resolve_project_abs(&root, &media_root, &repo_key, project_path.as_deref())?;
        let (project, _pipe) = video_mcp_load_project_and_pipe(&project_abs)?;
        let ops = ops
            .as_array()
            .ok_or_else(|| "ops must be an array".to_string())?
            .clone();
        let (project, state) = video_mcp_apply_ops_atomically(
            &project,
            &root,
            &media_root,
            &ops,
            status.ffprobe.path.as_deref(),
        )?;
        let (target_abs, pipe) = video_mcp_write_project_atomic(&root, &project_abs, &project)?;
        let reparsed_value = video_pipe_parse_project(&pipe)
            .map_err(|error| format!("Unable to parse serialized video project: {error}"))?;
        let reparsed_project = video_mcp_project_from_value(&reparsed_value)?;
        let id_map = video_mcp_reparsed_clip_id_map(&project, &reparsed_project);
        let changed_clip_ids =
            video_mcp_reparsed_changed_clip_ids(&state.changed_clip_ids, &id_map);
        let summary = if state.summaries.is_empty() {
            format!("applied {} video edit op(s)", ops.len())
        } else {
            video_mcp_rewrite_summary_ids(&state.summaries.join("; "), &id_map)
        };
        let project_path = video_relative_path(&root, &target_abs);
        let _ = app.emit(
            VIDEO_STORE_CHANGED_EVENT,
            serde_json::json!({
                "repoPath": root.to_string_lossy().to_string(),
                "paths": [project_path.clone()],
                "changedAtMs": video_now_millis(),
            }),
        );
        let _ = app.emit(
            VIDEO_AGENT_EDITED_EVENT,
            serde_json::json!({
                "projectPath": project_path.clone(),
                "summary": summary.clone(),
                "changedClipIds": changed_clip_ids.clone(),
            }),
        );
        let mut output = serde_json::Map::new();
        output.insert("applied".to_string(), serde_json::json!(ops.len()));
        output.insert(
            "changedClipIds".to_string(),
            serde_json::json!(changed_clip_ids),
        );
        output.insert("summary".to_string(), serde_json::json!(summary));
        output.insert(
            "idNote".to_string(),
            serde_json::json!("clip ids are stable until the next edit; re-fetch after edits"),
        );
        output.insert("projectPath".to_string(), serde_json::json!(project_path));
        if include_pipe {
            output.insert("pipe".to_string(), serde_json::json!(pipe));
        }
        Ok(serde_json::Value::Object(output))
    })
    .await
    .map_err(|error| format!("Video MCP edit worker failed: {error}"))?
}

fn video_mcp_transcript_segments_json(
    segments: &[VideoTranscriptSegment],
    from_ms: Option<u64>,
    to_ms: Option<u64>,
) -> Vec<serde_json::Value> {
    let from = from_ms.unwrap_or(0);
    let to = to_ms.unwrap_or(u64::MAX);
    segments
        .iter()
        .enumerate()
        .filter_map(|(segment_index, segment)| {
            if segment.end_ms <= from || segment.start_ms >= to {
                return None;
            }
            let words = segment
                .words
                .iter()
                .enumerate()
                .filter_map(|(word_index, word)| {
                    if word.end_ms <= from || word.start_ms >= to {
                        return None;
                    }
                    Some(serde_json::json!({
                        "i": word_index,
                        "startMs": word.start_ms.max(from),
                        "endMs": word.end_ms.min(to),
                        "text": word.text,
                    }))
                })
                .collect::<Vec<_>>();
            Some(serde_json::json!({
                "i": segment_index,
                "startMs": segment.start_ms.max(from),
                "endMs": segment.end_ms.min(to),
                "text": segment.text,
                "words": words,
            }))
        })
        .collect()
}

fn video_mcp_transcript_result_json(
    asset_path: &str,
    status: &str,
    cache: Option<VideoTranscriptCache>,
    from_ms: Option<u64>,
    to_ms: Option<u64>,
    error: Option<String>,
) -> serde_json::Value {
    match cache {
        Some(cache) => serde_json::json!({
            "assetPath": asset_path,
            "status": status,
            "language": cache.language,
            "segments": video_mcp_transcript_segments_json(&cache.segments, from_ms, to_ms),
        }),
        None => {
            let mut output = serde_json::Map::new();
            output.insert("assetPath".to_string(), serde_json::json!(asset_path));
            output.insert("status".to_string(), serde_json::json!(status));
            output.insert("language".to_string(), serde_json::Value::Null);
            output.insert("segments".to_string(), serde_json::json!([]));
            if let Some(error) = error {
                output.insert("error".to_string(), serde_json::json!(error));
            }
            serde_json::Value::Object(output)
        }
    }
}

fn video_mcp_resolve_transcript_optional(
    root: &std::path::Path,
    media_root: &std::path::Path,
    manifest: &VideoMediaManifest,
    asset_path: &str,
) -> Result<(String, Option<VideoTranscriptCache>), String> {
    let (_abs, rel_path, kind, metadata) =
        video_resolve_existing_media_file(root, media_root, asset_path)?;
    if !matches!(kind, "audio" | "video") {
        return Err("Transcription is only available for audio or video media.".to_string());
    }
    let cache = video_resolve_transcript_cache(root, media_root, manifest, &rel_path, &metadata)?
        .map(|(_inherited_from, cache)| cache);
    Ok((rel_path, cache))
}

fn video_mcp_transcribe_paths_from_project(
    project: &VideoMcpProject,
    state: Option<&VideoAgentState>,
    scope_selection: bool,
) -> Vec<String> {
    if scope_selection {
        if let Some(state) = state {
            if !state.ranges.is_empty() {
                let paths = video_mcp_asset_paths_for_ranges(project, &state.ranges);
                if !paths.is_empty() {
                    return paths;
                }
            }
        }
    }
    video_mcp_asset_paths_for_project(project)
}

async fn video_mcp_wait_for_transcript_cache(
    root: std::path::PathBuf,
    media_root: std::path::PathBuf,
    rel_path: String,
) -> Result<Option<VideoTranscriptCache>, String> {
    let start = std::time::Instant::now();
    loop {
        if let Some(error) = video_transcribe_terminal_error(&root, &rel_path) {
            return Err(error);
        }
        let manifest = video_read_media_manifest(&video_media_manifest_path(&media_root));
        match video_mcp_resolve_transcript_optional(&root, &media_root, &manifest, &rel_path) {
            Ok((_rel_path, Some(cache))) => return Ok(Some(cache)),
            Ok((_rel_path, None)) => {}
            Err(error) => return Err(error),
        }
        if start.elapsed() >= std::time::Duration::from_secs(VIDEO_TRANSCRIBE_TIMEOUT_SECS) {
            return Ok(None);
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

async fn video_mcp_transcribe(
    app: tauri::AppHandle,
    repo_path: String,
    paths: Vec<String>,
    scope_selection: bool,
    wait: bool,
    from_ms: Option<u64>,
    to_ms: Option<u64>,
) -> Result<serde_json::Value, String> {
    let (root, repo_key) = video_agent_state_key(repo_path.as_str())?;
    let (_root, media_root) = video_workspace_media_root(repo_path.as_str())?;
    video_ensure_media_dirs(&media_root)?;
    let mut requested = paths
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect::<Vec<_>>();
    if requested.is_empty() {
        let state = video_agent_state_for_key(&repo_key);
        let project_abs = video_mcp_resolve_project_abs(&root, &media_root, &repo_key, None)?;
        let (project, _pipe) = video_mcp_load_project_and_pipe(&project_abs)?;
        requested =
            video_mcp_transcribe_paths_from_project(&project, state.as_ref(), scope_selection);
    }
    let mut deduped = std::collections::BTreeSet::new();
    for path in requested {
        deduped.insert(path);
    }
    let cloud_state = app.state::<CloudMcpState>().inner().clone();
    let mut results = Vec::new();
    for raw_path in deduped {
        let manifest = video_read_media_manifest(&video_media_manifest_path(&media_root));
        let (rel_path, cache) =
            match video_mcp_resolve_transcript_optional(&root, &media_root, &manifest, &raw_path) {
                Ok(value) => value,
                Err(error) => {
                    results.push(video_mcp_transcript_result_json(
                        &raw_path,
                        "error",
                        None,
                        from_ms,
                        to_ms,
                        Some(error),
                    ));
                    continue;
                }
            };
        if let Some(cache) = cache {
            results.push(video_mcp_transcript_result_json(
                &rel_path,
                "ready",
                Some(cache),
                from_ms,
                to_ms,
                None,
            ));
            continue;
        }
        let (job_id, cancel) = match video_job_registry_insert(&VIDEO_TRANSCRIBE_JOBS) {
            Ok(value) => value,
            Err(error) => {
                results.push(video_mcp_transcript_result_json(
                    &rel_path,
                    "error",
                    None,
                    from_ms,
                    to_ms,
                    Some(error),
                ));
                continue;
            }
        };
        video_transcribe_clear_terminal_error(&root, &rel_path);
        tauri::async_runtime::spawn(video_transcribe_worker(
            app.clone(),
            cloud_state.clone(),
            job_id,
            repo_path.clone(),
            rel_path.clone(),
            false,
            cancel,
        ));
        if !wait {
            results.push(video_mcp_transcript_result_json(
                &rel_path, "pending", None, from_ms, to_ms, None,
            ));
            continue;
        }
        match video_mcp_wait_for_transcript_cache(
            root.clone(),
            media_root.clone(),
            rel_path.clone(),
        )
        .await
        {
            Ok(Some(cache)) => results.push(video_mcp_transcript_result_json(
                &rel_path,
                "ready",
                Some(cache),
                from_ms,
                to_ms,
                None,
            )),
            Ok(None) => results.push(video_mcp_transcript_result_json(
                &rel_path,
                "error",
                None,
                from_ms,
                to_ms,
                Some("Timed out waiting for transcription.".to_string()),
            )),
            Err(error) => results.push(video_mcp_transcript_result_json(
                &rel_path,
                "error",
                None,
                from_ms,
                to_ms,
                Some(error),
            )),
        }
    }
    Ok(serde_json::json!({ "assets": results }))
}

fn video_json_f64(value: &serde_json::Value, key: &str, default: f64) -> f64 {
    value
        .get(key)
        .and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_i64().map(|value| value as f64))
        })
        .filter(|value| value.is_finite())
        .unwrap_or(default)
}

fn video_json_u64(value: &serde_json::Value, key: &str, default: u64) -> u64 {
    value
        .get(key)
        .and_then(|value| value.as_u64())
        .unwrap_or(default)
}

fn video_json_string(value: &serde_json::Value, key: &str, default: &str) -> String {
    value
        .get(key)
        .and_then(|value| value.as_str())
        .unwrap_or(default)
        .to_string()
}

fn video_collect_property_keyframes(
    clip: &serde_json::Value,
    property: &str,
    min_value: f64,
    max_value: f64,
) -> Vec<VideoExportPropertyKeyframe> {
    let mut keyframes = clip
        .get("kf")
        .and_then(|kf| kf.get(property))
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    let easing = item
                        .get("easing")
                        .and_then(|value| value.as_str())
                        .filter(|value| matches!(*value, "linear" | "hold" | "smooth"))
                        .unwrap_or("linear")
                        .to_string();
                    VideoExportPropertyKeyframe {
                        at_ms: video_json_u64(item, "atMs", 0),
                        value: video_json_f64(item, "value", 0.0).clamp(min_value, max_value),
                        easing,
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    keyframes.sort_by_key(|keyframe| keyframe.at_ms);
    keyframes
}

fn video_export_probe_has_audio(
    ffprobe_path: Option<&str>,
    abs_path: &std::path::Path,
    kind: &str,
) -> bool {
    if kind == "audio" {
        return true;
    }
    ffprobe_path
        .and_then(|path| video_probe_media(path, abs_path))
        .and_then(|probe| probe.has_audio)
        .unwrap_or(false)
}

fn video_export_track_media_kind(
    track_kind: &str,
    asset_kind: &'static str,
) -> Option<&'static str> {
    match track_kind {
        "audio" if matches!(asset_kind, "audio" | "video") => Some("audio"),
        "video" if matches!(asset_kind, "video" | "image") => Some(asset_kind),
        _ => None,
    }
}

fn video_export_gain_has_signal(gain_level: f64, keyframes: &[(u64, f64)]) -> bool {
    gain_level > 0.0 || keyframes.iter().any(|(_at_ms, level)| *level > 0.0)
}

fn video_export_gain_at_ms(gain_level: f64, keyframes: &[(u64, f64)], at_ms: u64) -> f64 {
    if keyframes.is_empty() {
        return gain_level;
    }
    if at_ms <= keyframes[0].0 {
        return keyframes[0].1;
    }
    let last = keyframes.last().expect("gain keyframes not empty");
    if at_ms >= last.0 {
        return last.1;
    }
    for pair in keyframes.windows(2) {
        let (from_ms, from_level) = pair[0];
        let (to_ms, to_level) = pair[1];
        if at_ms >= from_ms && at_ms <= to_ms {
            let span = to_ms.saturating_sub(from_ms);
            if span == 0 {
                return to_level;
            }
            let ratio = (at_ms - from_ms) as f64 / span as f64;
            return from_level + (to_level - from_level) * ratio;
        }
    }
    gain_level
}

fn video_export_rebase_gain_keyframes(
    gain_level: f64,
    keyframes: &[(u64, f64)],
    offset_ms: u64,
) -> Vec<(u64, f64)> {
    if keyframes.is_empty() || offset_ms == 0 {
        return keyframes.to_vec();
    }
    let boundary = video_export_gain_at_ms(gain_level, keyframes, offset_ms);
    std::iter::once((0, boundary))
        .chain(
            keyframes
                .iter()
                .filter(|(at_ms, _level)| *at_ms > offset_ms)
                .map(|(at_ms, level)| (at_ms - offset_ms, *level)),
        )
        .collect()
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
        let muted = track
            .get("muted")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
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
                    shadow: style
                        .get("shadow")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false),
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
            let Some(asset_kind) = video_media_kind_for_extension(&abs) else {
                continue;
            };
            let Some(kind) = video_export_track_media_kind(&track_kind, asset_kind) else {
                continue;
            };
            let transform = clip.get("transform").unwrap_or(&serde_json::Value::Null);
            let gain = clip.get("gain").unwrap_or(&serde_json::Value::Null);
            let opacity_keyframes = video_collect_property_keyframes(&clip, "opacity", 0.0, 1.0);
            let x_keyframes = video_collect_property_keyframes(&clip, "x", -4.0, 4.0);
            let y_keyframes = video_collect_property_keyframes(&clip, "y", -4.0, 4.0);
            let scale_keyframes = video_collect_property_keyframes(&clip, "scale", 0.01, 20.0);
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
            let gain_level = video_json_f64(gain, "level", 1.0).max(0.0);
            let has_audio = !muted
                && video_export_gain_has_signal(gain_level, &gain_keyframes)
                && video_export_probe_has_audio(ffprobe_path, &abs, asset_kind);
            media_clips.push(VideoExportMediaClip {
                input_index: media_clips.len(),
                kind: kind.to_string(),
                abs_path: abs.clone(),
                timeline_start_ms: start,
                duration_ms: duration,
                source_in_ms: video_json_u64(&clip, "sourceInMs", 0),
                speed: video_json_f64(&clip, "speed", 1.0).clamp(0.05, 100.0),
                gain_level,
                gain_keyframes,
                x: video_json_f64(transform, "x", 0.0).clamp(-4.0, 4.0),
                y: video_json_f64(transform, "y", 0.0).clamp(-4.0, 4.0),
                scale: video_json_f64(transform, "scale", 1.0).clamp(0.01, 20.0),
                opacity: video_json_f64(transform, "opacity", 1.0).clamp(0.0, 1.0),
                filter_keyframe_offset_ms: 0,
                overlay_keyframe_offset_ms: i64::try_from(start).unwrap_or(i64::MAX),
                opacity_keyframes,
                x_keyframes,
                y_keyframes,
                scale_keyframes,
                has_audio,
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
    let mut expr =
        video_ffmpeg_number(level * keyframes.last().map(|(_, value)| *value).unwrap_or(1.0));
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

fn video_property_keyframe_expression(
    fallback_value: f64,
    keyframes: &[VideoExportPropertyKeyframe],
    timeline_offset_ms: i64,
) -> String {
    if keyframes.is_empty() {
        return video_ffmpeg_number(fallback_value);
    }
    let value_for = |value: f64| video_ffmpeg_number(value);
    if keyframes.len() == 1 {
        return value_for(keyframes[0].value);
    }
    let mut expr = value_for(
        keyframes
            .last()
            .map(|keyframe| keyframe.value)
            .unwrap_or(0.0),
    );
    for pair in keyframes.windows(2).rev() {
        let start = &pair[0];
        let end = &pair[1];
        let start_s = (timeline_offset_ms as f64 + start.at_ms as f64) / 1000.0;
        let end_s = (timeline_offset_ms as f64 + end.at_ms as f64) / 1000.0;
        let start_value = value_for(start.value);
        let end_value = value_for(end.value);
        let span = (end_s - start_s).max(0.001);
        let segment = if start.easing == "hold" {
            start_value.clone()
        } else if start.easing == "smooth" {
            let ratio = format!(
                "((t-{})/{})",
                video_ffmpeg_number(start_s),
                video_ffmpeg_number(span)
            );
            format!(
                "({}+({}-{})*({}*{}*(3-2*{})))",
                start_value, end_value, start_value, ratio, ratio, ratio
            )
        } else {
            format!(
                "({}+({}-{})*(t-{})/{})",
                start_value,
                end_value,
                value_for(start.value),
                video_ffmpeg_number(start_s),
                video_ffmpeg_number(span)
            )
        };
        expr = format!(
            "if(lt(t,{}),{},if(lt(t,{}),{},{}))",
            video_ffmpeg_number(start_s),
            value_for(start.value),
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
    include_audio: bool,
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
            if clip.scale_keyframes.is_empty() {
                vec![
                    format!(
                        "[{}:v]scale=w={}:h={}:force_original_aspect_ratio=decrease",
                        clip.input_index, target_width, target_height
                    ),
                    "format=yuva420p".to_string(),
                ]
            } else {
                vec![
                    format!(
                        "[{}:v]scale=w='{}*({})':h='{}*({})':force_original_aspect_ratio=decrease:eval=frame",
                        clip.input_index,
                        video_ffmpeg_number(width as f64),
                        video_property_keyframe_expression(
                            clip.scale,
                            &clip.scale_keyframes,
                            clip.filter_keyframe_offset_ms
                        ),
                        video_ffmpeg_number(height as f64),
                        video_property_keyframe_expression(
                            clip.scale,
                            &clip.scale_keyframes,
                            clip.filter_keyframe_offset_ms
                        ),
                    ),
                    "format=yuva420p".to_string(),
                ]
            }
        } else {
            let mut filters = vec![
                format!(
                    "[{}:v]trim=start={}:duration={}",
                    clip.input_index,
                    video_ffmpeg_seconds(clip.source_in_ms),
                    video_ffmpeg_number(source_duration)
                ),
                format!("setpts=(PTS-STARTPTS)/{}", video_ffmpeg_number(clip.speed)),
            ];
            if clip.scale_keyframes.is_empty() {
                filters.push(format!(
                    "scale=w={}:h={}:force_original_aspect_ratio=decrease",
                    target_width, target_height
                ));
            } else {
                filters.push(format!(
                    "scale=w='{}*({})':h='{}*({})':force_original_aspect_ratio=decrease:eval=frame",
                    video_ffmpeg_number(width as f64),
                    video_property_keyframe_expression(
                        clip.scale,
                        &clip.scale_keyframes,
                        clip.filter_keyframe_offset_ms
                    ),
                    video_ffmpeg_number(height as f64),
                    video_property_keyframe_expression(
                        clip.scale,
                        &clip.scale_keyframes,
                        clip.filter_keyframe_offset_ms
                    )
                ));
            }
            filters.push("format=yuva420p".to_string());
            filters
        };
        if !clip.opacity_keyframes.is_empty() {
            filters.push(format!(
                "colorchannelmixer=aa='{}'",
                video_property_keyframe_expression(
                    clip.opacity,
                    &clip.opacity_keyframes,
                    clip.filter_keyframe_offset_ms
                )
            ));
        } else if clip.opacity < 0.999 {
            filters.push(format!(
                "colorchannelmixer=aa={}",
                video_ffmpeg_number(clip.opacity)
            ));
        }
        filters.push(format!(
            "setpts=PTS+{}/TB",
            video_ffmpeg_seconds(clip.timeline_start_ms)
        ));
        let chain = format!("{}[{}]", filters.join(","), label);
        parts.push(chain);
        let output = format!("o{overlay_index}");
        let start = video_ffmpeg_seconds(clip.timeline_start_ms);
        let end = video_ffmpeg_seconds(clip.timeline_start_ms.saturating_add(clip.duration_ms));
        if clip.x_keyframes.is_empty() && clip.y_keyframes.is_empty() {
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
        } else {
            let x_expr = if clip.x_keyframes.is_empty() {
                video_ffmpeg_number(clip.x)
            } else {
                video_property_keyframe_expression(
                    clip.x,
                    &clip.x_keyframes,
                    clip.overlay_keyframe_offset_ms,
                )
            };
            let y_expr = if clip.y_keyframes.is_empty() {
                video_ffmpeg_number(clip.y)
            } else {
                video_property_keyframe_expression(
                    clip.y,
                    &clip.y_keyframes,
                    clip.overlay_keyframe_offset_ms,
                )
            };
            parts.push(format!(
                "[{}][{}]overlay=x='(W-w)/2+({})*W':y='(H-h)/2+({})*H':enable='between(t,{},{})'[{}]",
                previous,
                label,
                x_expr,
                y_expr,
                start,
                end,
                output
            ));
        }
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

    let audio_output = "aout".to_string();
    if include_audio {
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
    }

    (parts.join(";"), video_output, audio_output)
}

fn video_render_frame_window_clips(
    media_clips: &[VideoExportMediaClip],
    text_clips: &[VideoExportTextClip],
    seek_ms: u64,
) -> (
    Vec<VideoExportMediaClip>,
    Vec<VideoExportTextClip>,
    Vec<u64>,
    u64,
    u64,
) {
    let window_start_ms = seek_ms.saturating_sub(VIDEO_RENDER_FRAME_WINDOW_MS);
    let window_end_ms = seek_ms
        .saturating_add(VIDEO_RENDER_FRAME_WINDOW_MS)
        .max(window_start_ms.saturating_add(1));
    let render_seek_ms = seek_ms.saturating_sub(window_start_ms);
    let mut window_media_clips = Vec::new();
    let mut input_seek_ms = Vec::new();
    for clip in media_clips
        .iter()
        .filter(|clip| matches!(clip.kind.as_str(), "video" | "image"))
    {
        let clip_start_ms = clip.timeline_start_ms;
        let clip_end_ms = clip.timeline_start_ms.saturating_add(clip.duration_ms);
        if seek_ms < clip_start_ms || seek_ms > clip_end_ms {
            continue;
        }
        let windowed_start_ms = clip_start_ms.max(window_start_ms);
        let windowed_end_ms = clip_end_ms.min(window_end_ms);
        if windowed_end_ms <= windowed_start_ms {
            continue;
        }
        let timeline_delta_ms = windowed_start_ms.saturating_sub(clip_start_ms);
        let source_delta_ms = ((timeline_delta_ms as f64) * clip.speed).round().max(0.0) as u64;
        let source_start_ms = clip.source_in_ms.saturating_add(source_delta_ms);
        let input_seek = if clip.kind == "video" {
            source_start_ms.saturating_sub(VIDEO_RENDER_FRAME_WINDOW_MS)
        } else {
            0
        };
        let mut window_clip = clip.clone();
        window_clip.input_index = window_media_clips.len();
        window_clip.timeline_start_ms = windowed_start_ms.saturating_sub(window_start_ms);
        window_clip.duration_ms = windowed_end_ms.saturating_sub(windowed_start_ms);
        window_clip.source_in_ms = source_start_ms.saturating_sub(input_seek);
        window_clip.filter_keyframe_offset_ms =
            -i64::try_from(timeline_delta_ms).unwrap_or(i64::MAX);
        window_clip.overlay_keyframe_offset_ms = i64::try_from(clip_start_ms)
            .unwrap_or(i64::MAX)
            .saturating_sub(i64::try_from(window_start_ms).unwrap_or(i64::MAX));
        window_media_clips.push(window_clip);
        input_seek_ms.push(input_seek);
    }

    let mut window_text_clips = Vec::new();
    for clip in text_clips {
        let clip_start_ms = clip.timeline_start_ms;
        let clip_end_ms = clip.timeline_start_ms.saturating_add(clip.duration_ms);
        if seek_ms < clip_start_ms || seek_ms > clip_end_ms {
            continue;
        }
        let windowed_start_ms = clip_start_ms.max(window_start_ms);
        let windowed_end_ms = clip_end_ms.min(window_end_ms);
        if windowed_end_ms <= windowed_start_ms {
            continue;
        }
        let mut window_clip = clip.clone();
        window_clip.timeline_start_ms = windowed_start_ms.saturating_sub(window_start_ms);
        window_clip.duration_ms = windowed_end_ms.saturating_sub(windowed_start_ms);
        window_text_clips.push(window_clip);
    }

    (
        window_media_clips,
        window_text_clips,
        input_seek_ms,
        render_seek_ms,
        window_end_ms.saturating_sub(window_start_ms),
    )
}

fn video_export_window_clips_for_range(
    media_clips: &[VideoExportMediaClip],
    text_clips: &[VideoExportTextClip],
    start_ms: u64,
    end_ms: u64,
) -> Result<(Vec<VideoExportMediaClip>, Vec<VideoExportTextClip>, u64), String> {
    if end_ms <= start_ms {
        return Err("Export range endMs must be greater than startMs.".to_string());
    }
    let mut window_media_clips = Vec::new();
    for clip in media_clips {
        let clip_start_ms = clip.timeline_start_ms;
        let clip_end_ms = clip.timeline_start_ms.saturating_add(clip.duration_ms);
        if clip_start_ms >= end_ms || clip_end_ms <= start_ms {
            continue;
        }
        let windowed_start_ms = clip_start_ms.max(start_ms);
        let windowed_end_ms = clip_end_ms.min(end_ms);
        if windowed_end_ms <= windowed_start_ms {
            continue;
        }
        let timeline_delta_ms = windowed_start_ms.saturating_sub(clip_start_ms);
        let source_delta_ms = ((timeline_delta_ms as f64) * clip.speed).round().max(0.0) as u64;
        let mut window_clip = clip.clone();
        window_clip.input_index = window_media_clips.len();
        window_clip.timeline_start_ms = windowed_start_ms.saturating_sub(start_ms);
        window_clip.duration_ms = windowed_end_ms.saturating_sub(windowed_start_ms);
        window_clip.source_in_ms = clip.source_in_ms.saturating_add(source_delta_ms);
        window_clip.filter_keyframe_offset_ms =
            -i64::try_from(timeline_delta_ms).unwrap_or(i64::MAX);
        window_clip.overlay_keyframe_offset_ms = i64::try_from(clip_start_ms)
            .unwrap_or(i64::MAX)
            .saturating_sub(i64::try_from(start_ms).unwrap_or(i64::MAX));
        if timeline_delta_ms > 0 {
            window_clip.gain_keyframes = video_export_rebase_gain_keyframes(
                window_clip.gain_level,
                &window_clip.gain_keyframes,
                timeline_delta_ms,
            );
        }
        window_media_clips.push(window_clip);
    }

    let mut window_text_clips = Vec::new();
    for clip in text_clips {
        let clip_start_ms = clip.timeline_start_ms;
        let clip_end_ms = clip.timeline_start_ms.saturating_add(clip.duration_ms);
        if clip_start_ms >= end_ms || clip_end_ms <= start_ms {
            continue;
        }
        let windowed_start_ms = clip_start_ms.max(start_ms);
        let windowed_end_ms = clip_end_ms.min(end_ms);
        if windowed_end_ms <= windowed_start_ms {
            continue;
        }
        let mut window_clip = clip.clone();
        window_clip.timeline_start_ms = windowed_start_ms.saturating_sub(start_ms);
        window_clip.duration_ms = windowed_end_ms.saturating_sub(windowed_start_ms);
        window_text_clips.push(window_clip);
    }

    Ok((
        window_media_clips,
        window_text_clips,
        end_ms.saturating_sub(start_ms),
    ))
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
        .map(|value| {
            video_safe_file_stem(
                value.trim_end_matches(".mp4").trim_end_matches(".webm"),
                "export",
            )
        })
        .unwrap_or_else(|| {
            let project_name = project
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("project");
            format!(
                "{}-{}",
                video_safe_file_stem(project_name, "project"),
                video_now_millis()
            )
        });
    media_root
        .join(VIDEO_EXPORTS_DIR)
        .join(format!("{file_name}.{format}"))
}

fn video_emit_export_progress(
    app: &tauri::AppHandle,
    repo_path: &str,
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
    video_record_export_status(job_id, state, percent, done, error, output_path);
    let _ = app.emit(
        VIDEO_EXPORT_PROGRESS_EVENT,
        serde_json::json!({
            "repoPath": repo_path,
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
    let repo_display = root.to_string_lossy().to_string();
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
    let crf = options
        .crf
        .unwrap_or(if format == "webm" { 32 } else { 23 })
        .clamp(0, 63);
    let preset = options
        .preset
        .as_deref()
        .unwrap_or("medium")
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-')
        .take(32)
        .collect::<String>();
    let preset = if preset.is_empty() {
        "medium".to_string()
    } else {
        preset
    };
    let (mut media_clips, mut text_clips, mut total_ms) =
        video_collect_export_clips(&root, &media_root, &project, status.ffprobe.path.as_deref())?;
    if let (Some(start_ms), Some(end_ms)) = (options.range_start_ms, options.range_end_ms) {
        let windowed =
            video_export_window_clips_for_range(&media_clips, &text_clips, start_ms, end_ms)?;
        media_clips = windowed.0;
        text_clips = windowed.1;
        total_ms = windowed.2;
    }
    if total_ms == 0 {
        return Err("Video project has no clips to export.".to_string());
    }
    let output_abs = video_export_output_path(&media_root, &project, &options);
    if let Some(parent) = output_abs.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create video exports directory: {error}"))?;
    }
    let (filter_complex, video_output, audio_output) = video_build_export_filter(
        &project,
        &media_clips,
        &text_clips,
        total_ms,
        width,
        height,
        fps,
        true,
    );
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
        &repo_display,
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
    let stderr_lines = std::sync::Arc::new(std::sync::Mutex::new(std::collections::VecDeque::<
        String,
    >::new()));
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
                if last_emit.elapsed()
                    >= std::time::Duration::from_millis(VIDEO_EXPORT_PROGRESS_INTERVAL_MS)
                {
                    let percent = ((out_ms as f64 / total_ms as f64) * 100.0).clamp(0.0, 100.0);
                    video_emit_export_progress(
                        &app,
                        &repo_display,
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
            &repo_display,
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
        &repo_display,
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
    let progress_repo_path = resolve_workspace_root_directory(Some(repo_path.as_str()))
        .map(|root| root.to_string_lossy().to_string())
        .unwrap_or_else(|_| repo_path.clone());
    video_emit_export_progress(
        &app,
        &progress_repo_path,
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
    let repo_path_for_worker = repo_path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        video_run_export_blocking(
            app_for_worker,
            job_for_worker,
            repo_path_for_worker,
            project_path,
            options,
            cancel,
        )
    })
    .await
    .map_err(|error| format!("Video export worker failed: {error}"))
    .and_then(|value| value);
    if let Err(error) = result {
        video_emit_export_progress(
            &app,
            &progress_repo_path,
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
    video_record_export_status(&job_id, "starting", Some(0.0), false, None, None);
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

fn video_mcp_export_range(
    input: &serde_json::Value,
    required: bool,
) -> Result<Option<(u64, u64)>, String> {
    let Some(range) = input.get("range") else {
        return if required {
            Err("video_export draft requires range.startMs and range.endMs.".to_string())
        } else {
            Ok(None)
        };
    };
    let start_ms = range
        .get("startMs")
        .or_else(|| range.get("start_ms"))
        .and_then(video_mcp_value_u64)
        .ok_or_else(|| "range.startMs is required.".to_string())?;
    let end_ms = range
        .get("endMs")
        .or_else(|| range.get("end_ms"))
        .and_then(video_mcp_value_u64)
        .ok_or_else(|| "range.endMs is required.".to_string())?;
    if end_ms <= start_ms {
        return Err("range.endMs must be greater than range.startMs.".to_string());
    }
    Ok(Some((start_ms, end_ms)))
}

fn video_mcp_even_dimension(value: u32) -> u32 {
    let value = value.clamp(16, 7680);
    value - (value % 2)
}

fn video_mcp_export_dimensions(
    project: &serde_json::Value,
    resolution: &str,
) -> Result<(Option<u32>, Option<u32>), String> {
    let Some(target) = (match resolution {
        "" | "source" => None,
        "480p" => Some(480u32),
        "720p" => Some(720u32),
        "1080p" => Some(1080u32),
        _ => return Err("resolution must be 480p, 720p, 1080p, or source.".to_string()),
    }) else {
        return Ok((None, None));
    };
    let settings = project.get("settings").unwrap_or(&serde_json::Value::Null);
    let source_width = video_json_u64(settings, "width", 1920).max(16) as f64;
    let source_height = video_json_u64(settings, "height", 1080).max(16) as f64;
    if source_width >= source_height {
        let height = video_mcp_even_dimension(target);
        let width = video_mcp_even_dimension(
            ((target as f64) * source_width / source_height).round() as u32,
        );
        Ok((Some(width), Some(height)))
    } else {
        let width = video_mcp_even_dimension(target);
        let height = video_mcp_even_dimension(
            ((target as f64) * source_height / source_width).round() as u32,
        );
        Ok((Some(width), Some(height)))
    }
}

async fn video_mcp_export(
    app: tauri::AppHandle,
    repo_path: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let action = input
        .get("action")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "video_export action is required.".to_string())?;
    match action {
        "status" => {
            let job_id = video_mcp_input_text(&input, &["jobId", "job_id"])
                .ok_or_else(|| "video_export status requires jobId.".to_string())?;
            video_mcp_export_status_value(&job_id)
        }
        "export" | "draft" => {
            let is_draft = action == "draft";
            let range = video_mcp_export_range(&input, is_draft)?;
            let requested_resolution = if is_draft {
                "480p".to_string()
            } else {
                video_mcp_input_text(&input, &["resolution"])
                    .unwrap_or_else(|| "source".to_string())
            };
            let explicit_project_path =
                video_mcp_input_text(&input, &["projectPath", "project_path"]);
            let repo_for_project = repo_path.clone();
            let (project_path, width, height, file_name) =
                tauri::async_runtime::spawn_blocking(move || {
                    let (root, repo_key) = video_agent_state_key(repo_for_project.as_str())?;
                    let (_root, media_root) =
                        video_workspace_media_root(repo_for_project.as_str())?;
                    video_ensure_media_dirs(&media_root)?;
                    let project_abs = video_mcp_resolve_project_abs(
                        &root,
                        &media_root,
                        &repo_key,
                        explicit_project_path.as_deref(),
                    )?;
                    let project = video_project_load_value(&project_abs)?;
                    let (width, height) =
                        video_mcp_export_dimensions(&project, &requested_resolution)?;
                    let file_name = if is_draft {
                        Some(format!("draft-{}", video_now_millis()))
                    } else {
                        None
                    };
                    Ok::<_, String>((
                        video_relative_path(&root, &project_abs),
                        width,
                        height,
                        file_name,
                    ))
                })
                .await
                .map_err(|error| format!("Video MCP export project worker failed: {error}"))??;
            let options = VideoExportOptions {
                file_name,
                width,
                height,
                fps: None,
                format: Some("mp4".to_string()),
                crf: None,
                preset: None,
                range_start_ms: range.map(|(start_ms, _end_ms)| start_ms),
                range_end_ms: range.map(|(_start_ms, end_ms)| end_ms),
            };
            let result = video_export_start(app, repo_path, project_path, options).await?;
            Ok(serde_json::json!({ "jobId": result.job_id }))
        }
        _ => Err(format!("Unknown video_export action: {action}")),
    }
}

fn video_render_frame_jpeg_bytes_blocking(
    app: &tauri::AppHandle,
    repo_path: &str,
    project_path: &str,
    at_ms: i64,
    max_width: Option<u32>,
    jpeg_quality: u8,
) -> Result<Vec<u8>, String> {
    let _span = BackendCpuSpan::new("video_render_frame");
    let (root, media_root) = video_workspace_media_root(repo_path)?;
    video_ensure_media_dirs(&media_root)?;
    let status = video_tools_status_for(app);
    let ffmpeg_path = status.ffmpeg.path.ok_or_else(|| {
        "ffmpeg is required to render video timeline frames. Install video tools first.".to_string()
    })?;
    let project_abs = video_resolve_project_abs(&root, &media_root, project_path)?;
    let project = video_project_load_value(&project_abs)?;
    let settings = project.get("settings").unwrap_or(&serde_json::Value::Null);
    let width = (video_json_u64(settings, "width", 1920) as u32).clamp(16, 7680);
    let height = (video_json_u64(settings, "height", 1080) as u32).clamp(16, 4320);
    let fps = video_json_f64(settings, "fps", 30.0).clamp(1.0, 240.0);
    let seek_ms = if at_ms < 0 { 0 } else { at_ms as u64 };
    let (media_clips, text_clips, _total_ms) =
        video_collect_export_clips(&root, &media_root, &project, status.ffprobe.path.as_deref())?;
    let (media_clips, text_clips, input_seek_ms, render_seek_ms, render_total_ms) =
        video_render_frame_window_clips(&media_clips, &text_clips, seek_ms);
    let render_total_ms = render_total_ms.max(render_seek_ms.saturating_add(1)).max(1);
    let (mut filter_complex, video_output, _) = video_build_export_filter(
        &project,
        &media_clips,
        &text_clips,
        render_total_ms,
        width,
        height,
        fps,
        false,
    );
    let longest = max_width.unwrap_or(960).clamp(240, 1920);
    filter_complex.push_str(&format!(
        ";[{}]scale=w='if(gte(iw,ih),min(iw,{}),-2)':h='if(gte(iw,ih),-2,min(ih,{}))'[frameout]",
        video_output, longest, longest
    ));
    let mut args: Vec<String> = Vec::new();
    args.extend([
        "-nostdin".to_string(),
        "-v".to_string(),
        "error".to_string(),
    ]);
    for (clip, input_seek) in media_clips.iter().zip(input_seek_ms.iter()) {
        if clip.kind != "image" && *input_seek > 0 {
            args.extend(["-ss".to_string(), video_ffmpeg_seconds(*input_seek)]);
        }
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
        "[frameout]".to_string(),
        "-ss".to_string(),
        video_ffmpeg_seconds(render_seek_ms),
        "-frames:v".to_string(),
        "1".to_string(),
        "-q:v".to_string(),
        jpeg_quality.clamp(2, 31).to_string(),
        "-f".to_string(),
        "image2pipe".to_string(),
        "-vcodec".to_string(),
        "mjpeg".to_string(),
        "pipe:1".to_string(),
    ]);
    video_run_ffmpeg_binary_stdout(&ffmpeg_path, &args, std::time::Duration::from_secs(30))
}

async fn video_render_frame_jpeg_bytes(
    app: tauri::AppHandle,
    repo_path: String,
    project_path: String,
    at_ms: i64,
    max_width: Option<u32>,
    jpeg_quality: u8,
) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        video_render_frame_jpeg_bytes_blocking(
            &app,
            repo_path.as_str(),
            project_path.as_str(),
            at_ms,
            max_width,
            jpeg_quality,
        )
    })
    .await
    .map_err(|error| format!("Video frame render worker failed: {error}"))?
}

#[tauri::command]
async fn video_render_frame(
    app: tauri::AppHandle,
    repo_path: String,
    project_path: String,
    at_ms: i64,
    max_width: Option<u32>,
) -> Result<VideoRenderFrameResponse, String> {
    use base64::Engine as _;
    let bytes =
        video_render_frame_jpeg_bytes(app, repo_path, project_path, at_ms, max_width, 4).await?;
    Ok(VideoRenderFrameResponse {
        data_url: format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
    })
}

fn video_provider_definition(provider_id: &str) -> Option<&'static VideoProviderDefinition> {
    VIDEO_GENERATION_PROVIDERS
        .iter()
        .find(|provider| provider.id == provider_id)
}

fn video_provider_base_url(
    provider: &VideoProviderDefinition,
    auth: &Option<VideoProviderAuth>,
) -> String {
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

async fn video_response_json(
    response: reqwest::Response,
    label: &str,
) -> Result<serde_json::Value, String> {
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

fn video_direct_payload_mb(bytes: u64) -> String {
    format!("{:.1}", bytes as f64 / 1024.0 / 1024.0)
}

fn video_asset_data_uri(
    root: &std::path::Path,
    media_root: &std::path::Path,
    input_path: &str,
) -> Result<(String, String, String, Vec<u8>), String> {
    video_asset_data_uri_with_limit(root, media_root, input_path, None, "", 0)
}

fn video_asset_data_uri_with_limit(
    root: &std::path::Path,
    media_root: &std::path::Path,
    input_path: &str,
    max_bytes: Option<u64>,
    error_label: &str,
    display_limit_mb: u64,
) -> Result<(String, String, String, Vec<u8>), String> {
    use base64::Engine as _;
    let abs = video_resolve_media_abs(root, media_root, input_path)?;
    if let Some(max_bytes) = max_bytes {
        let metadata = std::fs::metadata(&abs)
            .map_err(|error| format!("Unable to inspect input asset: {error}"))?;
        if metadata.len() > max_bytes {
            return Err(format!(
                "{error_label} ({}MB > {}MB limit) — trim or export a smaller clip first.",
                video_direct_payload_mb(metadata.len()),
                display_limit_mb
            ));
        }
    }
    let bytes =
        std::fs::read(&abs).map_err(|error| format!("Unable to read input asset: {error}"))?;
    let mime = video_mime_for_path(&abs).to_string();
    let base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok((format!("data:{mime};base64,{base64}"), base64, mime, bytes))
}

#[derive(Clone)]
struct VideoGenerateJobContext {
    app: tauri::AppHandle,
    root: std::path::PathBuf,
    media_root: std::path::PathBuf,
    generated_dir: std::path::PathBuf,
    job_id: String,
    provider_id: String,
    model: String,
    mode: String,
    request: VideoGenerateRecordedRequest,
    planned_paths: Vec<String>,
    created_at_ms: u64,
    registry_path: std::path::PathBuf,
    last_registry_write_ms: std::sync::Arc<std::sync::Mutex<u64>>,
}

#[derive(Clone)]
struct VideoCloudGenerateJobHandle {
    context: VideoGenerateJobContext,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Clone)]
struct VideoGeneratedOutputSource {
    url: String,
    mime_type: Option<String>,
}

fn video_generation_jobs_path(media_root: &std::path::Path) -> std::path::PathBuf {
    media_root
        .join(VIDEO_CACHE_DIR)
        .join(VIDEO_GENERATION_JOBS_FILE)
}

fn video_read_generation_jobs(
    path: &std::path::Path,
) -> Result<Vec<VideoPersistentGenerateJob>, String> {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<Vec<VideoPersistentGenerateJob>>(&raw)
            .map_err(|error| format!("Unable to parse video generation job registry: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!(
            "Unable to read video generation job registry: {error}"
        )),
    }
}

fn video_generation_jobs_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    VIDEO_GENERATION_JOBS_LOCK
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .map_err(|_| "Video generation job registry lock is poisoned.".to_string())
}

fn video_write_generation_jobs(
    path: &std::path::Path,
    jobs: &mut Vec<VideoPersistentGenerateJob>,
) -> Result<(), String> {
    jobs.sort_by_key(|job| job.created_at_ms);
    while jobs.len() > 60 {
        if let Some(index) = jobs.iter().position(|job| job.done) {
            jobs.remove(index);
        } else {
            jobs.remove(0);
        }
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!("Unable to create video generation job registry directory: {error}")
        })?;
    }
    let counter =
        VIDEO_GENERATION_JOBS_WRITE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(VIDEO_GENERATION_JOBS_FILE);
    let temp_path = path.with_file_name(format!(
        "{file_name}.{}.{}.tmp",
        std::process::id(),
        counter
    ));
    let raw = serde_json::to_vec_pretty(jobs)
        .map_err(|error| format!("Unable to serialize video generation job registry: {error}"))?;
    std::fs::write(&temp_path, raw)
        .map_err(|error| format!("Unable to write video generation job registry: {error}"))?;
    std::fs::rename(&temp_path, path)
        .map_err(|error| format!("Unable to finalize video generation job registry: {error}"))?;
    Ok(())
}

fn video_upsert_generation_job(
    path: &std::path::Path,
    job: VideoPersistentGenerateJob,
) -> Result<(), String> {
    let _guard = video_generation_jobs_guard()?;
    let mut jobs = video_read_generation_jobs(path)?;
    if let Some(existing) = jobs
        .iter_mut()
        .find(|existing| existing.job_id == job.job_id)
    {
        *existing = job;
    } else {
        jobs.push(job);
    }
    video_write_generation_jobs(path, &mut jobs)
}

fn video_update_generation_job(
    context: &VideoGenerateJobContext,
    state: &str,
    percent: Option<f64>,
    done: bool,
    error: Option<&str>,
    provider_ref: Option<serde_json::Value>,
    force: bool,
) -> Result<(), String> {
    let now = video_now_millis();
    if !force {
        let mut last = context
            .last_registry_write_ms
            .lock()
            .map_err(|_| "Video generation job registry timer is poisoned.".to_string())?;
        if now.saturating_sub(*last) < VIDEO_GENERATE_REGISTRY_WRITE_INTERVAL_MS {
            return Ok(());
        }
        *last = now;
    } else if let Ok(mut last) = context.last_registry_write_ms.lock() {
        *last = now;
    }
    let _guard = video_generation_jobs_guard()?;
    let mut jobs = video_read_generation_jobs(&context.registry_path)?;
    let mut found = false;
    for job in &mut jobs {
        if job.job_id == context.job_id {
            job.state = state.to_string();
            job.percent = percent;
            if provider_ref.is_some() {
                job.provider_ref = provider_ref.clone();
            }
            job.done = done;
            job.error = error.map(str::to_string);
            found = true;
            break;
        }
    }
    if !found {
        jobs.push(VideoPersistentGenerateJob {
            job_id: context.job_id.clone(),
            provider_id: context.provider_id.clone(),
            model: context.model.clone(),
            mode: context.mode.clone(),
            request: context.request.clone(),
            state: state.to_string(),
            percent,
            planned_paths: context.planned_paths.clone(),
            provider_ref,
            created_at_ms: context.created_at_ms,
            done,
            error: error.map(str::to_string),
        });
    }
    video_write_generation_jobs(&context.registry_path, &mut jobs)
}

fn video_set_generation_provider_ref(
    context: &VideoGenerateJobContext,
    provider_ref: serde_json::Value,
) -> Result<(), String> {
    let _guard = video_generation_jobs_guard()?;
    let mut jobs = video_read_generation_jobs(&context.registry_path)?;
    for job in &mut jobs {
        if job.job_id == context.job_id {
            job.provider_ref = Some(provider_ref);
            return video_write_generation_jobs(&context.registry_path, &mut jobs);
        }
    }
    jobs.push(VideoPersistentGenerateJob {
        job_id: context.job_id.clone(),
        provider_id: context.provider_id.clone(),
        model: context.model.clone(),
        mode: context.mode.clone(),
        request: context.request.clone(),
        state: "queued".to_string(),
        percent: None,
        planned_paths: context.planned_paths.clone(),
        provider_ref: Some(provider_ref),
        created_at_ms: context.created_at_ms,
        done: false,
        error: None,
    });
    video_write_generation_jobs(&context.registry_path, &mut jobs)
}

fn video_update_generation_job_planned_path(
    context: &VideoGenerateJobContext,
    index: usize,
    planned_path: &str,
) -> Result<(), String> {
    let _guard = video_generation_jobs_guard()?;
    let mut jobs = video_read_generation_jobs(&context.registry_path)?;
    let Some(job) = jobs.iter_mut().find(|job| job.job_id == context.job_id) else {
        return Ok(());
    };
    let Some(existing) = job.planned_paths.get_mut(index) else {
        return Ok(());
    };
    if existing == planned_path {
        return Ok(());
    }
    *existing = planned_path.to_string();
    video_write_generation_jobs(&context.registry_path, &mut jobs)
}

fn video_emit_generate_progress(
    context: &VideoGenerateJobContext,
    state: &str,
    percent: Option<f64>,
    message: &str,
    done: bool,
    error: Option<&str>,
    output_paths: &[String],
) {
    let _ = video_update_generation_job(
        context,
        state,
        percent,
        done,
        error,
        None,
        done || error.is_some(),
    );
    video_emit_generate_progress_event(
        &context.app,
        &context.job_id,
        &context.provider_id,
        state,
        percent,
        message,
        done,
        error,
        output_paths,
        &context.model,
        &context.planned_paths,
    );
}

fn video_emit_generate_progress_event(
    app: &tauri::AppHandle,
    job_id: &str,
    provider_id: &str,
    state: &str,
    percent: Option<f64>,
    message: &str,
    done: bool,
    error: Option<&str>,
    output_paths: &[String],
    model: &str,
    planned_paths: &[String],
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
            "model": model,
            // Lets the frontend clean up placeholder clips when a job errors.
            "plannedPaths": planned_paths,
        }),
    );
}

fn video_cloud_model_is_audio(model: &str) -> bool {
    matches!(model, "text2speech_v2" | "sonilo_music" | "mirelo_sfx")
}

fn video_generate_request_kind(
    provider: &VideoProviderDefinition,
    model: &str,
    request: &VideoGenerateRequest,
) -> &'static str {
    if request.mode == "upscale-video" || request.mode == "upscale-image" {
        "upscale"
    } else if provider.id == "cloud" && model == "higgsfield_speak" {
        "video"
    } else if provider.id == "cloud" && video_cloud_model_is_audio(model) {
        "audio"
    } else if request.mode.contains("audio")
        || request.mode.contains("music")
        || request.mode.contains("sfx")
        || request.mode.contains("speech")
    {
        "audio"
    } else if provider.kind == "video" || request.mode.contains("video") {
        "video"
    } else {
        "image"
    }
}

fn video_recorded_generate_request(
    kind: &str,
    model: &str,
    request: &VideoGenerateRequest,
) -> VideoGenerateRecordedRequest {
    VideoGenerateRecordedRequest {
        kind: kind.to_string(),
        model: model.to_string(),
        mode: request.mode.clone(),
        prompt: request.prompt.clone(),
        params: request.params.clone(),
        input_asset_paths: request.input_asset_paths.clone(),
        audio_asset_paths: request.audio_asset_paths.clone(),
    }
}

fn video_generate_output_extension(
    provider: &VideoProviderDefinition,
    request: &VideoGenerateRequest,
    kind: &str,
) -> &'static str {
    if kind == "audio" {
        // Audio jobs reserve .mp3 paths; downloads keep provider bytes as-is,
        // even when a result URL ends in .wav.
        return "mp3";
    }
    if request.mode == "upscale-video" {
        return "mp4";
    }
    if request.mode == "upscale-image" {
        return "png";
    }
    if provider.kind == "video" || request.mode.contains("video") {
        "mp4"
    } else {
        "png"
    }
}

fn video_generate_planned_count(
    provider: &VideoProviderDefinition,
    request: &VideoGenerateRequest,
    kind: &str,
) -> usize {
    let requested = request
        .params
        .as_ref()
        .and_then(|params| params.num_images)
        .unwrap_or(1)
        .clamp(1, 16) as usize;
    if matches!(kind, "audio" | "video" | "upscale")
        || provider.kind == "video"
        || request.mode == "upscale-video"
        || request.mode.contains("video")
    {
        1
    } else {
        requested
    }
}

fn video_plan_generated_paths(
    root: &std::path::Path,
    media_root: &std::path::Path,
    provider: &VideoProviderDefinition,
    request: &VideoGenerateRequest,
    kind: &str,
    created_at_ms: u64,
) -> Vec<String> {
    let extension = video_generate_output_extension(provider, request, kind);
    let count = video_generate_planned_count(provider, request, kind);
    let mut timestamp = created_at_ms;
    loop {
        let planned = (0..count)
            .map(|index| {
                media_root.join(VIDEO_GENERATED_DIR).join(format!(
                    "{}-{}-{}.{}",
                    provider.id,
                    timestamp,
                    index + 1,
                    extension
                ))
            })
            .collect::<Vec<_>>();
        if planned.iter().all(|path| !path.exists()) {
            return planned
                .iter()
                .map(|path| video_relative_path(root, path))
                .collect();
        }
        timestamp = timestamp.saturating_add(1);
    }
}

fn video_planned_output_abs(
    root: &std::path::Path,
    media_root: &std::path::Path,
    planned_paths: &[String],
    index: usize,
) -> Result<std::path::PathBuf, String> {
    let planned = planned_paths
        .get(index)
        .ok_or_else(|| "Provider returned more outputs than were planned.".to_string())?;
    let normalized = video_normalize_relative_path(planned)?;
    let output = root.join(normalized);
    if !output.starts_with(media_root.join(VIDEO_GENERATED_DIR)) {
        return Err("Planned generated media path must stay under media/generated/.".to_string());
    }
    Ok(output)
}

fn video_audio_extension_from_mime(mime_type: &str) -> Option<&'static str> {
    let mime = mime_type
        .split(';')
        .next()
        .unwrap_or(mime_type)
        .trim()
        .to_ascii_lowercase();
    match mime.as_str() {
        "audio/mpeg" | "audio/mp3" => Some("mp3"),
        "audio/wav" | "audio/x-wav" | "audio/wave" | "audio/vnd.wave" => Some("wav"),
        "audio/ogg" | "application/ogg" => Some("ogg"),
        "audio/mp4" | "audio/x-m4a" => Some("m4a"),
        "audio/webm" => Some("weba"),
        "audio/aac" => Some("aac"),
        "audio/flac" => Some("flac"),
        "audio/opus" => Some("opus"),
        _ => None,
    }
}

fn video_url_extension(url: &str) -> Option<String> {
    let without_query = url.split('?').next().unwrap_or(url);
    let without_fragment = without_query.split('#').next().unwrap_or(without_query);
    std::path::Path::new(without_fragment)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
}

fn video_audio_extension_from_url(url: &str) -> Option<&'static str> {
    match video_url_extension(url)?.as_str() {
        "mp3" => Some("mp3"),
        "wav" => Some("wav"),
        "ogg" => Some("ogg"),
        "oga" => Some("oga"),
        "m4a" => Some("m4a"),
        "weba" => Some("weba"),
        "aac" => Some("aac"),
        "flac" => Some("flac"),
        "opus" => Some("opus"),
        _ => None,
    }
}

fn video_corrected_audio_output_abs(
    context: &VideoGenerateJobContext,
    planned_output: &std::path::Path,
    mime_type: Option<&str>,
    response_mime_type: Option<&str>,
    url: &str,
) -> Result<std::path::PathBuf, String> {
    if video_media_kind_for_extension(planned_output) != Some("audio") {
        return Ok(planned_output.to_path_buf());
    }
    let mime_extension = mime_type.and_then(video_audio_extension_from_mime);
    let response_extension = response_mime_type.and_then(video_audio_extension_from_mime);
    let url_extension = video_audio_extension_from_url(url);
    let extension = [mime_extension, response_extension, url_extension]
        .into_iter()
        .flatten()
        .find(|extension| *extension != "mp3")
        .or(mime_extension)
        .or(response_extension)
        .or(url_extension)
        .unwrap_or("mp3");
    let current_extension = planned_output
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if current_extension == extension {
        return Ok(planned_output.to_path_buf());
    }
    let corrected = planned_output.with_extension(extension);
    if !corrected.starts_with(context.media_root.join(VIDEO_GENERATED_DIR)) {
        return Err("Corrected generated media path must stay under media/generated/.".to_string());
    }
    if corrected.exists() {
        return Err(format!(
            "Corrected generated media path already exists: {}",
            corrected.display()
        ));
    }
    Ok(corrected)
}

async fn video_poll_sleep(
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    for _ in 0..30 {
        if cancel.load(std::sync::atomic::Ordering::Acquire) {
            return Err("Video generation cancelled.".to_string());
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Ok(())
}

async fn video_download_generated_url(
    context: &VideoGenerateJobContext,
    client: &reqwest::Client,
    url: &str,
    mime_type: Option<&str>,
    index: usize,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<String, String> {
    use std::io::Write as _;
    video_emit_generate_progress(
        context,
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
    let response_mime_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    std::fs::create_dir_all(&context.generated_dir)
        .map_err(|error| format!("Unable to create generated media directory: {error}"))?;
    let planned_output = video_planned_output_abs(
        &context.root,
        &context.media_root,
        &context.planned_paths,
        index,
    )?;
    let output = video_corrected_audio_output_abs(
        context,
        &planned_output,
        mime_type,
        response_mime_type.as_deref(),
        url,
    )?;
    let output_path = video_relative_path(&context.root, &output);
    if output != planned_output {
        video_update_generation_job_planned_path(context, index, &output_path)?;
    }
    let extension = output
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("media")
        .to_string();
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
    Ok(output_path)
}

fn video_save_generated_bytes(
    context: &VideoGenerateJobContext,
    index: usize,
    bytes: &[u8],
) -> Result<String, String> {
    std::fs::create_dir_all(&context.generated_dir)
        .map_err(|error| format!("Unable to create generated media directory: {error}"))?;
    let output = video_planned_output_abs(
        &context.root,
        &context.media_root,
        &context.planned_paths,
        index,
    )?;
    std::fs::write(&output, bytes)
        .map_err(|error| format!("Unable to write generated media: {error}"))?;
    Ok(video_relative_path(&context.root, &output))
}

async fn video_download_provider_urls(
    context: &VideoGenerateJobContext,
    client: &reqwest::Client,
    urls: Vec<String>,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<Vec<String>, String> {
    let mut output_paths = Vec::new();
    for (index, url) in urls.iter().enumerate() {
        output_paths
            .push(video_download_generated_url(context, client, url, None, index, cancel).await?);
    }
    Ok(output_paths)
}

async fn video_download_provider_outputs(
    context: &VideoGenerateJobContext,
    client: &reqwest::Client,
    outputs: Vec<VideoGeneratedOutputSource>,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<Vec<String>, String> {
    let mut output_paths = Vec::new();
    for (index, output) in outputs.iter().enumerate() {
        output_paths.push(
            video_download_generated_url(
                context,
                client,
                output.url.as_str(),
                output.mime_type.as_deref(),
                index,
                cancel,
            )
            .await?,
        );
    }
    Ok(output_paths)
}

fn video_cloud_generate_jobs()
-> &'static std::sync::Mutex<std::collections::HashMap<String, VideoCloudGenerateJobHandle>> {
    VIDEO_CLOUD_GENERATE_JOBS
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn video_cloud_register_generation_job(
    cloud_job_id: &str,
    context: VideoGenerateJobContext,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    video_cloud_generate_jobs()
        .lock()
        .map_err(|_| "Video cloud generation registry is poisoned.".to_string())?
        .insert(
            cloud_job_id.to_string(),
            VideoCloudGenerateJobHandle { context, cancel },
        );
    Ok(())
}

fn video_cloud_generation_handle(cloud_job_id: &str) -> Option<VideoCloudGenerateJobHandle> {
    video_cloud_generate_jobs()
        .lock()
        .ok()
        .and_then(|jobs| jobs.get(cloud_job_id).cloned())
}

fn video_cloud_remove_generation_job(cloud_job_id: &str) -> Option<VideoCloudGenerateJobHandle> {
    video_cloud_generate_jobs()
        .lock()
        .ok()
        .and_then(|mut jobs| jobs.remove(cloud_job_id))
}

fn video_cloud_cancel_generation_job(job_id: &str) -> bool {
    let found = video_cloud_generate_jobs()
        .lock()
        .ok()
        .and_then(|mut jobs| {
            let cloud_job_id = jobs
                .iter()
                .find(|(_, handle)| handle.context.job_id == job_id)
                .map(|(cloud_job_id, _)| cloud_job_id.clone())?;
            jobs.remove(&cloud_job_id)
                .map(|handle| (cloud_job_id, handle))
        });
    let Some((_cloud_job_id, handle)) = found else {
        return false;
    };
    handle
        .cancel
        .store(true, std::sync::atomic::Ordering::Release);
    // Cloud generation v1 has no remote cancel contract. This only cancels
    // local downloads and stops handling future pushes for this job.
    video_emit_generate_progress(
        &handle.context,
        "cancelled",
        Some(100.0),
        "Generation cancelled.",
        true,
        None,
        &[],
    );
    video_job_registry_remove(&VIDEO_GENERATE_JOBS, job_id);
    true
}

fn video_cloud_event_text(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    })
}

fn video_cloud_job_id_from_provider_ref(provider_ref: &serde_json::Value) -> Option<String> {
    video_cloud_event_text(
        provider_ref,
        &["cloudJobId", "cloud_job_id", "jobId", "job_id"],
    )
}

fn video_cloud_event_error(value: &serde_json::Value) -> String {
    value
        .get("error")
        .and_then(|error| {
            error.as_str().map(str::to_string).or_else(|| {
                error
                    .get("message")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
        })
        .unwrap_or_else(|| "Cloud media generation failed.".to_string())
}

fn video_cloud_generation_event_kind(event: &serde_json::Value) -> Option<String> {
    video_cloud_event_text(event, &["event_kind", "eventKind", "kind"])
}

fn video_cloud_generate_progress_event(event: &serde_json::Value) {
    let Some(cloud_job_id) = video_cloud_event_text(event, &["jobId", "job_id"]) else {
        return;
    };
    let Some(handle) = video_cloud_generation_handle(&cloud_job_id) else {
        return;
    };
    if handle.cancel.load(std::sync::atomic::Ordering::Acquire) {
        return;
    }
    let state = video_cloud_event_text(event, &["state"]).unwrap_or_else(|| "running".to_string());
    let percent = event.get("percent").and_then(serde_json::Value::as_f64);
    let message = video_cloud_event_text(event, &["message"]).unwrap_or_else(|| {
        match state.as_str() {
            "queued" => "Cloud generation queued.",
            "downloading" => "Cloud is preparing generated media.",
            "done" => "Cloud generation finished.",
            "error" => "Cloud generation failed.",
            _ => "Cloud generation running.",
        }
        .to_string()
    });
    video_emit_generate_progress(&handle.context, &state, percent, &message, false, None, &[]);
}

fn video_cloud_output_mime(output: &serde_json::Value) -> Option<String> {
    [
        "mimeType",
        "mime_type",
        "mime",
        "contentType",
        "content_type",
    ]
    .iter()
    .find_map(|key| {
        output
            .get(*key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn video_cloud_generate_outputs(event: &serde_json::Value) -> Vec<VideoGeneratedOutputSource> {
    event
        .get("outputs")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|output| {
            let url = output
                .get("url")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|url| !url.is_empty())?;
            Some(VideoGeneratedOutputSource {
                url: url.to_string(),
                mime_type: video_cloud_output_mime(output),
            })
        })
        .collect()
}

async fn video_cloud_generate_result_worker(
    cloud_job_id: String,
    handle: VideoCloudGenerateJobHandle,
    event: serde_json::Value,
) {
    if handle.cancel.load(std::sync::atomic::Ordering::Acquire) {
        video_cloud_remove_generation_job(&cloud_job_id);
        video_job_registry_remove(&VIDEO_GENERATE_JOBS, &handle.context.job_id);
        return;
    }
    let ok = event
        .get("ok")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    if !ok {
        let error = video_cloud_event_error(&event);
        video_emit_generate_progress(
            &handle.context,
            "error",
            Some(100.0),
            &error,
            true,
            Some(&error),
            &[],
        );
        video_cloud_remove_generation_job(&cloud_job_id);
        video_job_registry_remove(&VIDEO_GENERATE_JOBS, &handle.context.job_id);
        return;
    }
    let outputs = video_cloud_generate_outputs(&event);
    let result = async {
        if outputs.is_empty() {
            return Err("Cloud media generation completed without output URLs.".to_string());
        }
        let client = http_client(std::time::Duration::from_secs(VIDEO_DOWNLOAD_TIMEOUT_SECS))?;
        video_download_provider_outputs(&handle.context, &client, outputs, &handle.cancel).await
    }
    .await;
    match result {
        Ok(output_paths) => {
            let manifest_changed =
                video_record_cloud_generation_relations(&handle.context, &output_paths)
                    .unwrap_or(false);
            let mut changed_paths = output_paths.clone();
            if manifest_changed {
                changed_paths.push(video_relative_path(
                    &handle.context.root,
                    &video_media_manifest_path(&handle.context.media_root),
                ));
            }
            let _ = handle.context.app.emit(
                VIDEO_STORE_CHANGED_EVENT,
                serde_json::json!({
                    "repoPath": handle.context.root.to_string_lossy().to_string(),
                    "paths": changed_paths,
                    "manifestPath": manifest_changed.then(|| video_relative_path(
                        &handle.context.root,
                        &video_media_manifest_path(&handle.context.media_root),
                    )),
                    "changedAtMs": video_now_millis(),
                }),
            );
            video_emit_generate_progress(
                &handle.context,
                "done",
                Some(100.0),
                "Generation finished.",
                true,
                None,
                &output_paths,
            );
        }
        Err(_error) if handle.cancel.load(std::sync::atomic::Ordering::Acquire) => {
            video_emit_generate_progress(
                &handle.context,
                "cancelled",
                Some(100.0),
                "Generation cancelled.",
                true,
                None,
                &[],
            );
        }
        Err(error) => {
            video_emit_generate_progress(
                &handle.context,
                "error",
                Some(100.0),
                &error,
                true,
                Some(&error),
                &[],
            );
        }
    }
    video_cloud_remove_generation_job(&cloud_job_id);
    video_job_registry_remove(&VIDEO_GENERATE_JOBS, &handle.context.job_id);
}

fn video_cloud_generate_result_event(event: serde_json::Value) {
    let Some(cloud_job_id) = video_cloud_event_text(&event, &["jobId", "job_id"]) else {
        return;
    };
    let Some(handle) = video_cloud_generation_handle(&cloud_job_id) else {
        return;
    };
    tauri::async_runtime::spawn(video_cloud_generate_result_worker(
        cloud_job_id,
        handle,
        event,
    ));
}

fn video_cloud_handle_generation_event(event: serde_json::Value) {
    match video_cloud_generation_event_kind(&event).as_deref() {
        Some("media_generate_progress") => video_cloud_generate_progress_event(&event),
        Some("media_generate_result") => video_cloud_generate_result_event(event),
        _ => {}
    }
}

fn video_cloud_generation_events_start(app: tauri::AppHandle, cloud_state: CloudMcpState) {
    let mut events = cloud_state.global_ws_events.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match events.recv().await {
                Ok(event) => video_cloud_handle_generation_event(event),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
        drop(app);
    });
}

fn video_cloud_append_b64_asset(
    root: &std::path::Path,
    media_root: &std::path::Path,
    input_path: &str,
    total_b64: &mut usize,
) -> Result<(String, String), String> {
    let (_data_uri, b64, mime, _bytes) = video_asset_data_uri(root, media_root, input_path)?;
    *total_b64 = total_b64.saturating_add(b64.len());
    if *total_b64 > VIDEO_CLOUD_GENERATE_MAX_B64_BYTES {
        return Err(
            "Cloud media generation input exceeds the 40MB base64 payload limit.".to_string(),
        );
    }
    Ok((b64, mime))
}

fn video_cloud_append_audio_b64_asset(
    root: &std::path::Path,
    media_root: &std::path::Path,
    input_path: &str,
    total_b64: &mut usize,
) -> Result<(String, String), String> {
    let abs = video_resolve_media_abs(root, media_root, input_path)?;
    if video_media_kind_for_extension(&abs) != Some("audio") {
        return Err("Cloud audio inputs must be audio assets under media/.".to_string());
    }
    let bytes = std::fs::read(&abs)
        .map_err(|error| format!("Unable to read audio input asset: {error}"))?;
    let mime = video_mime_for_path(&abs).to_string();
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    *total_b64 = total_b64.saturating_add(b64.len());
    if *total_b64 > VIDEO_CLOUD_GENERATE_MAX_B64_BYTES {
        return Err(
            "Cloud media generation input exceeds the 40MB base64 payload limit.".to_string(),
        );
    }
    Ok((b64, mime))
}

fn video_cloud_generate_payload(
    context: &VideoGenerateJobContext,
    request: &VideoGenerateRequest,
) -> Result<serde_json::Value, String> {
    let mut input = serde_json::Map::new();
    let prompt = request.prompt.trim();
    if !prompt.is_empty() {
        input.insert("prompt".to_string(), serde_json::json!(prompt));
    }
    if let Some(params) = request.params.as_ref() {
        if let Some(duration_sec) = params.duration_sec {
            input.insert("durationSec".to_string(), serde_json::json!(duration_sec));
        }
        if let Some(aspect) = params
            .aspect
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            input.insert("aspectRatio".to_string(), serde_json::json!(aspect));
        }
        if let Some(resolution) = params
            .resolution
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            input.insert("resolution".to_string(), serde_json::json!(resolution));
        }
        if let Some(num_images) = params.num_images {
            input.insert("numImages".to_string(), serde_json::json!(num_images));
        }
        if let Some(quality) = params
            .extra
            .get("quality")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            input.insert("quality".to_string(), serde_json::json!(quality));
        }
        if let Some(sound) = params
            .extra
            .get("sound")
            .and_then(serde_json::Value::as_bool)
        {
            input.insert("sound".to_string(), serde_json::json!(sound));
        }
        if let Some(voice) = params
            .extra
            .get("voice")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            input.insert("voice".to_string(), serde_json::json!(voice));
        }
        if let Some(provider_mode) = params
            .extra
            .get("providerMode")
            .or_else(|| params.extra.get("provider_mode"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            input.insert("providerMode".to_string(), serde_json::json!(provider_mode));
        }
    }
    input.insert("mode".to_string(), serde_json::json!(request.mode.clone()));

    let mut total_b64 = 0usize;
    if context.model == "higgsfield_speak" {
        let start_path = request
            .input_asset_paths
            .first()
            .ok_or_else(|| "Cloud Higgsfield Speak requires a face image asset.".to_string())?;
        let audio_path = request
            .audio_asset_paths
            .first()
            .ok_or_else(|| "Cloud Higgsfield Speak requires an input audio asset.".to_string())?;
        let (b64, mime) = video_cloud_append_b64_asset(
            &context.root,
            &context.media_root,
            start_path,
            &mut total_b64,
        )?;
        input.insert("startFrameB64".to_string(), serde_json::json!(b64));
        input.insert("startFrameMime".to_string(), serde_json::json!(mime));
        let (b64, mime) = video_cloud_append_audio_b64_asset(
            &context.root,
            &context.media_root,
            audio_path,
            &mut total_b64,
        )?;
        input.insert("inputAudioB64".to_string(), serde_json::json!(b64));
        input.insert("inputAudioMime".to_string(), serde_json::json!(mime));
    } else if request.mode == "upscale-video" || request.mode == "upscale-image" {
        let source_path = request
            .input_asset_paths
            .first()
            .ok_or_else(|| format!("Cloud {} requires an input asset.", request.mode))?;
        let (b64, mime) = video_cloud_append_b64_asset(
            &context.root,
            &context.media_root,
            source_path,
            &mut total_b64,
        )?;
        input.insert("sourceB64".to_string(), serde_json::json!(b64));
        input.insert("sourceMime".to_string(), serde_json::json!(mime));
    } else if request.mode == "image-to-video" {
        let start_path = request
            .input_asset_paths
            .first()
            .ok_or_else(|| "Cloud image-to-video requires a start frame asset.".to_string())?;
        let (b64, mime) = video_cloud_append_b64_asset(
            &context.root,
            &context.media_root,
            start_path,
            &mut total_b64,
        )?;
        input.insert("startFrameB64".to_string(), serde_json::json!(b64));
        input.insert("startFrameMime".to_string(), serde_json::json!(mime));
        if let Some(end_path) = request.input_asset_paths.get(1) {
            let (b64, mime) = video_cloud_append_b64_asset(
                &context.root,
                &context.media_root,
                end_path,
                &mut total_b64,
            )?;
            input.insert("endFrameB64".to_string(), serde_json::json!(b64));
            input.insert("endFrameMime".to_string(), serde_json::json!(mime));
        }
    } else if !request.input_asset_paths.is_empty() {
        let mut reference_images = Vec::new();
        for input_path in &request.input_asset_paths {
            let (b64, mime) = video_cloud_append_b64_asset(
                &context.root,
                &context.media_root,
                input_path,
                &mut total_b64,
            )?;
            reference_images.push(serde_json::json!({
                "b64": b64,
                "mime": mime,
            }));
        }
        input.insert(
            "referenceImagesB64".to_string(),
            serde_json::Value::Array(reference_images),
        );
    }
    if context.model != "higgsfield_speak" && !request.audio_asset_paths.is_empty() {
        let mut reference_audios = Vec::new();
        for input_path in &request.audio_asset_paths {
            let (b64, mime) = video_cloud_append_audio_b64_asset(
                &context.root,
                &context.media_root,
                input_path,
                &mut total_b64,
            )?;
            reference_audios.push(serde_json::json!({
                "b64": b64,
                "mime": mime,
            }));
        }
        input.insert(
            "referenceAudiosB64".to_string(),
            serde_json::Value::Array(reference_audios),
        );
    }

    Ok(serde_json::json!({
        "requestId": format!("video-generate-{}-{}", video_now_millis(), uuid::Uuid::new_v4()),
        "model": context.model.clone(),
        "kind": context.request.kind.clone(),
        "input": serde_json::Value::Object(input),
    }))
}

async fn video_generate_cloud(
    context: &VideoGenerateJobContext,
    request: &VideoGenerateRequest,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    if cancel.load(std::sync::atomic::Ordering::Acquire) {
        return Err("Video generation cancelled.".to_string());
    }
    let payload = video_cloud_generate_payload(context, request)?;
    let cloud_state = context.app.state::<CloudMcpState>().inner().clone();
    let response = cloud_mcp_ws_request_once_with_timeout(
        &cloud_state,
        "media_generate_request",
        &payload,
        std::time::Duration::from_secs(VIDEO_CLOUD_GENERATE_ACK_TIMEOUT_SECS),
    )
    .await?;
    let data = response
        .get("data")
        .cloned()
        .unwrap_or_else(|| response.clone());
    if data.get("ok").and_then(serde_json::Value::as_bool) != Some(true) {
        return Err(video_cloud_event_error(&data));
    }
    let cloud_job_id = video_cloud_event_text(&data, &["jobId", "job_id"])
        .ok_or_else(|| "Cloud media generation ack omitted jobId.".to_string())?;
    video_set_generation_provider_ref(
        context,
        serde_json::json!({
            "cloudJobId": cloud_job_id.clone(),
            "requestId": data.get("requestId").or_else(|| data.get("request_id")).cloned().unwrap_or(serde_json::Value::Null),
        }),
    )?;
    video_cloud_register_generation_job(&cloud_job_id, context.clone(), cancel.clone())?;
    video_emit_generate_progress(
        context,
        "queued",
        Some(0.0),
        "Cloud generation queued.",
        false,
        None,
        &[],
    );
    Ok(())
}

async fn video_higgsfield_upload_asset(
    client: &reqwest::Client,
    base: &str,
    auth_header: &str,
    root: &std::path::Path,
    media_root: &std::path::Path,
    input_path: &str,
) -> Result<String, String> {
    let (_data_uri, _b64, mime, bytes) = video_asset_data_uri(root, media_root, input_path)?;
    let upload = client
        .post(format!(
            "{}/files/generate-upload-url",
            base.trim_end_matches('/')
        ))
        .header("Authorization", auth_header)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "content_type": mime }))
        .send()
        .await
        .map_err(|error| format!("Unable to prepare Higgsfield upload: {error}"))?;
    let upload_json = video_response_json(upload, "Higgsfield upload URL").await?;
    let public_url = video_json_path_string(&upload_json, &["public_url"])
        .or_else(|| video_json_path_string(&upload_json, &["publicUrl"]))
        .or_else(|| video_json_path_string(&upload_json, &["url"]))
        .or_else(|| video_json_path_string(&upload_json, &["data", "public_url"]))
        .or_else(|| video_json_path_string(&upload_json, &["data", "publicUrl"]))
        .ok_or_else(|| format!("Higgsfield upload response omitted public_url: {upload_json}"))?
        .to_string();
    let upload_url = video_json_path_string(&upload_json, &["upload_url"])
        .or_else(|| video_json_path_string(&upload_json, &["uploadUrl"]))
        .or_else(|| video_json_path_string(&upload_json, &["data", "upload_url"]))
        .or_else(|| video_json_path_string(&upload_json, &["data", "uploadUrl"]))
        .ok_or_else(|| format!("Higgsfield upload response omitted upload_url: {upload_json}"))?;
    let put = client
        .put(upload_url)
        .header("Content-Type", mime)
        .body(bytes)
        .send()
        .await
        .map_err(|error| format!("Unable to upload Higgsfield input asset: {error}"))?;
    let status = put.status();
    if !status.is_success() {
        let body = put
            .text()
            .await
            .unwrap_or_else(|_| "<unable to read response body>".to_string());
        return Err(format!(
            "Higgsfield input upload returned HTTP {}: {}",
            status,
            video_http_body_excerpt(&body)
        ));
    }
    Ok(public_url)
}

fn video_higgsfield_output_urls(result: &serde_json::Value) -> Vec<String> {
    let mut urls = Vec::new();
    for path in [
        &["video", "url"][..],
        &["image", "url"][..],
        &["audio", "url"][..],
        &["output", "url"][..],
        &["results", "raw", "url"][..],
    ] {
        if let Some(url) = video_json_path_string(result, path) {
            urls.push(url.to_string());
        }
    }
    if let Some(url) = result.get("output").and_then(serde_json::Value::as_str) {
        urls.push(url.to_string());
    }
    for key in ["videos", "images", "audios", "results"] {
        urls.extend(
            result
                .get(key)
                .and_then(|value| value.as_array())
                .into_iter()
                .flatten()
                .filter_map(|item| {
                    item.get("url")
                        .or_else(|| item.get("raw").and_then(|raw| raw.get("url")))
                        .and_then(serde_json::Value::as_str)
                })
                .map(|value| value.to_string()),
        );
    }
    urls.sort();
    urls.dedup();
    urls
}

async fn video_generate_higgsfield(
    context: &VideoGenerateJobContext,
    request: &VideoGenerateRequest,
    provider: &VideoProviderDefinition,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<Vec<String>, String> {
    let client = http_client(std::time::Duration::from_secs(60))?;
    let base = video_provider_base_url(provider, &request.auth);
    let api_key = video_auth_api_key(&request.auth)?;
    let secret = video_auth_secret_key(&request.auth)?;
    let auth_header = format!("Key {api_key}:{secret}");
    let endpoint_raw = request
        .model
        .trim()
        .trim_start_matches('/')
        .trim_end_matches('/')
        .trim();
    let endpoint = if endpoint_raw.is_empty() {
        provider.models[0]
    } else {
        endpoint_raw
    };
    let (endpoint, dop_model) = match endpoint {
        "dop-lite" | "higgsfield-ai/dop/lite" => ("v1/image2video/dop", Some("dop-lite")),
        "dop-turbo" | "higgsfield-ai/dop/turbo" => ("v1/image2video/dop", Some("dop-turbo")),
        "dop-standard" | "higgsfield-ai/dop/standard" => {
            ("v1/image2video/dop", Some("dop-standard"))
        }
        value => (value, None),
    };
    let is_image_to_video_endpoint =
        dop_model.is_some() || endpoint.contains("/image-to-video") || endpoint.contains("/dop/");
    let mut body = serde_json::json!({
        "prompt": request.prompt,
    });
    if let Some(params) = request.params.as_ref() {
        if let Some(duration) = params.duration_sec {
            body["duration"] = serde_json::json!((duration.round() as i64).clamp(5, 10));
        }
        if let Some(seed) = params.seed {
            body["seed"] = serde_json::json!(seed.clamp(1, 1_000_000));
        }
        if let Some(provider_mode) = params
            .extra
            .get("providerMode")
            .or_else(|| params.extra.get("provider_mode"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            body["mode"] = serde_json::json!(provider_mode);
        }
    }
    if let Some(dop_model) = dop_model {
        body["model"] = serde_json::json!(dop_model);
        body.as_object_mut().map(|object| {
            object.remove("duration");
            object.remove("mode");
        });
    }
    if is_image_to_video_endpoint {
        let input = request
            .input_asset_paths
            .first()
            .ok_or_else(|| "Higgsfield image-to-video requires an input asset.".to_string())?;
        let start_image_url = video_higgsfield_upload_asset(
            &client,
            &base,
            &auth_header,
            &context.root,
            &context.media_root,
            input,
        )
        .await?;
        let end_image_url = if let Some(end_input) = request.input_asset_paths.get(1) {
            Some(
                video_higgsfield_upload_asset(
                    &client,
                    &base,
                    &auth_header,
                    &context.root,
                    &context.media_root,
                    end_input,
                )
                .await?,
            )
        } else {
            None
        };
        if dop_model.is_some() {
            let mut input_images = vec![serde_json::json!({
                "type": "image_url",
                "image_url": start_image_url,
            })];
            if let Some(end_image_url) = end_image_url {
                input_images.push(serde_json::json!({
                    "type": "image_url",
                    "image_url": end_image_url,
                }));
            }
            body["input_images"] = serde_json::Value::Array(input_images);
        } else {
            body["image_url"] = serde_json::json!(start_image_url);
            if let Some(end_image_url) = end_image_url {
                body["end_image_url"] = serde_json::json!(end_image_url);
            }
        }
    } else {
        body.as_object_mut().map(|object| {
            object.remove("image_url");
            object.remove("end_image_url");
            object.remove("input_images");
        });
    }
    let submit = client
        .post(format!("{base}/{endpoint}"))
        .header("Authorization", auth_header.clone())
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Unable to submit Higgsfield job: {error}"))?;
    let submit_json = video_response_json(submit, "Higgsfield submit").await?;
    let task_id = video_json_path_string(&submit_json, &["request_id"])
        .or_else(|| video_json_path_string(&submit_json, &["requestId"]))
        .or_else(|| video_json_path_string(&submit_json, &["id"]))
        .ok_or_else(|| {
            format!("Higgsfield submit response did not include request_id: {submit_json}")
        })?
        .to_string();
    video_set_generation_provider_ref(
        context,
        serde_json::json!({
            "taskId": task_id,
            "baseUrl": base,
            "endpoint": endpoint,
        }),
    )?;
    let started = std::time::Instant::now();
    loop {
        if started.elapsed() > std::time::Duration::from_secs(VIDEO_GENERATION_TIMEOUT_SECS) {
            return Err("Higgsfield generation timed out.".to_string());
        }
        video_poll_sleep(cancel).await?;
        video_emit_generate_progress(
            context,
            "running",
            None,
            "Waiting for Higgsfield.",
            false,
            None,
            &[],
        );
        let poll = client
            .get(format!("{base}/requests/{task_id}/status"))
            .header("Authorization", auth_header.clone())
            .send()
            .await
            .map_err(|error| format!("Unable to poll Higgsfield job: {error}"))?;
        let poll_json = video_response_json(poll, "Higgsfield poll").await?;
        let status = video_json_path_string(&poll_json, &["status"]).unwrap_or_default();
        match status {
            "completed" | "succeeded" | "success" => {
                let urls = video_higgsfield_output_urls(&poll_json);
                if urls.is_empty() {
                    return Err("Higgsfield job completed without result URLs.".to_string());
                }
                return video_download_provider_urls(context, &client, urls, cancel).await;
            }
            "failed" | "error" => return Err(format!("Higgsfield job failed: {poll_json}")),
            "nsfw" => return Err("Higgsfield job was rejected by moderation.".to_string()),
            _ => {}
        }
    }
}

async fn video_generate_seedance(
    context: &VideoGenerateJobContext,
    request: &VideoGenerateRequest,
    provider: &VideoProviderDefinition,
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
            "image_url": { "url": video_asset_data_uri(&context.root, &context.media_root, input)?.0 },
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
    video_set_generation_provider_ref(
        context,
        serde_json::json!({
            "taskId": task_id,
            "baseUrl": base,
        }),
    )?;
    let started = std::time::Instant::now();
    loop {
        if started.elapsed() > std::time::Duration::from_secs(VIDEO_GENERATION_TIMEOUT_SECS) {
            return Err("Seedance generation timed out.".to_string());
        }
        video_poll_sleep(cancel).await?;
        video_emit_generate_progress(
            context,
            "running",
            None,
            "Waiting for Seedance.",
            false,
            None,
            &[],
        );
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
                return video_download_provider_urls(context, &client, vec![url], cancel).await;
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
    context: &VideoGenerateJobContext,
    request: &VideoGenerateRequest,
    provider: &VideoProviderDefinition,
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
        body["image"] =
            serde_json::json!(video_asset_data_uri(&context.root, &context.media_root, input)?.1);
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
    video_set_generation_provider_ref(
        context,
        serde_json::json!({
            "taskId": task_id,
            "baseUrl": base,
            "endpoint": endpoint,
        }),
    )?;
    let started = std::time::Instant::now();
    loop {
        if started.elapsed() > std::time::Duration::from_secs(VIDEO_GENERATION_TIMEOUT_SECS) {
            return Err("Kling generation timed out.".to_string());
        }
        video_poll_sleep(cancel).await?;
        video_emit_generate_progress(
            context,
            "running",
            None,
            "Waiting for Kling.",
            false,
            None,
            &[],
        );
        let poll = client
            .get(format!("{base}{endpoint}/{task_id}"))
            .bearer_auth(video_kling_jwt(&api_key, &secret)?)
            .send()
            .await
            .map_err(|error| format!("Unable to poll Kling job: {error}"))?;
        let poll_json = video_response_json(poll, "Kling poll").await?;
        let status =
            video_json_path_string(&poll_json, &["data", "task_status"]).unwrap_or_default();
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
                return video_download_provider_urls(context, &client, urls, cancel).await;
            }
            "failed" => return Err(format!("Kling job failed: {poll_json}")),
            _ => {}
        }
    }
}

async fn video_generate_openai_image(
    context: &VideoGenerateJobContext,
    request: &VideoGenerateRequest,
    provider: &VideoProviderDefinition,
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
        let abs = video_resolve_media_abs(&context.root, &context.media_root, input)?;
        let bytes = std::fs::read(&abs)
            .map_err(|error| format!("Unable to read image edit input: {error}"))?;
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
            .text(
                "model",
                if request.model.trim().is_empty() {
                    provider.models[0].to_string()
                } else {
                    request.model.clone()
                },
            );
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
                "n": request.params.as_ref().and_then(|params| params.num_images).unwrap_or(1).clamp(1, 16),
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
            outputs.push(video_save_generated_bytes(context, index, &bytes)?);
        }
    }
    if outputs.is_empty() {
        return Err("OpenAI image response did not include b64_json data.".to_string());
    }
    Ok(outputs)
}

async fn video_generate_nano_banana(
    context: &VideoGenerateJobContext,
    request: &VideoGenerateRequest,
    provider: &VideoProviderDefinition,
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
        let (_, base64, mime, _) = video_asset_data_uri(&context.root, &context.media_root, input)?;
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
        let Some(data) = inline.get("data").and_then(|value| value.as_str()) else {
            continue;
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|error| format!("Unable to decode Gemini image: {error}"))?;
        outputs.push(video_save_generated_bytes(context, outputs.len(), &bytes)?);
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
    context: &VideoGenerateJobContext,
    request: &VideoGenerateRequest,
    provider: &VideoProviderDefinition,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<Vec<String>, String> {
    let client = http_client(std::time::Duration::from_secs(120))?;
    let base = video_provider_base_url(provider, &request.auth);
    let api_key = video_auth_api_key(&request.auth)?;
    let loras = if let Some(lora_id) = request.lora_id.as_deref() {
        let registry = video_lora_read_registry(&context.app)?;
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
    let status_url = video_json_path_string(&submit_json, &["status_url"]).ok_or_else(|| {
        format!("fal.ai submit response did not include status_url: {submit_json}")
    })?;
    let response_url =
        video_json_path_string(&submit_json, &["response_url"]).ok_or_else(|| {
            format!("fal.ai submit response did not include response_url: {submit_json}")
        })?;
    video_set_generation_provider_ref(
        context,
        serde_json::json!({
            "statusUrl": status_url,
            "responseUrl": response_url,
        }),
    )?;
    let result =
        video_fal_poll_response(&client, status_url, response_url, &api_key, cancel).await?;
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
    video_download_provider_urls(context, &client, urls, cancel).await
}

fn video_generate_params_body(
    params: Option<&VideoGenerateParams>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut body = params
        .and_then(|params| serde_json::to_value(params).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    body.retain(|_, value| !value.is_null());
    body
}

fn video_fal_output_urls(result: &serde_json::Value) -> Vec<String> {
    let mut urls = Vec::new();
    if let Some(url) = video_json_path_string(result, &["video", "url"]) {
        urls.push(url.to_string());
    }
    if let Some(url) = video_json_path_string(result, &["image", "url"]) {
        urls.push(url.to_string());
    }
    for key in ["videos", "images"] {
        urls.extend(
            result
                .get(key)
                .and_then(|value| value.as_array())
                .into_iter()
                .flatten()
                .filter_map(|item| item.get("url").and_then(|value| value.as_str()))
                .map(|value| value.to_string()),
        );
    }
    urls
}

async fn video_generate_fal(
    context: &VideoGenerateJobContext,
    request: &VideoGenerateRequest,
    provider: &VideoProviderDefinition,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<Vec<String>, String> {
    let model = request.model.trim().trim_matches('/');
    if model.is_empty() {
        return Err("fal provider requires a full model queue path.".to_string());
    }
    let client = http_client(std::time::Duration::from_secs(120))?;
    let base = video_provider_base_url(provider, &request.auth);
    let api_key = video_auth_api_key(&request.auth)?;
    let mut body = video_generate_params_body(request.params.as_ref());
    if !request.prompt.trim().is_empty() {
        body.insert("prompt".to_string(), serde_json::json!(request.prompt));
    }
    match request.mode.as_str() {
        "upscale-video" => {
            let input = request
                .input_asset_paths
                .first()
                .ok_or_else(|| "fal upscale-video requires an input asset.".to_string())?;
            body.insert(
                "video_url".to_string(),
                serde_json::json!(
                    video_asset_data_uri_with_limit(
                        &context.root,
                        &context.media_root,
                        input,
                        Some(VIDEO_DIRECT_UPSCALE_VIDEO_LIMIT_BYTES),
                        "Video too large for direct upscale",
                        60,
                    )?
                    .0
                ),
            );
        }
        "upscale-image" | "image-to-image" | "image-edit" | "image-to-video" => {
            let input = request
                .input_asset_paths
                .first()
                .ok_or_else(|| format!("fal {} requires an input asset.", request.mode))?;
            body.insert(
                "image_url".to_string(),
                serde_json::json!(
                    video_asset_data_uri_with_limit(
                        &context.root,
                        &context.media_root,
                        input,
                        Some(VIDEO_DIRECT_UPSCALE_IMAGE_LIMIT_BYTES),
                        "Image too large for direct upscale",
                        25,
                    )?
                    .0
                ),
            );
        }
        _ => {}
    }
    let submit = client
        .post(format!("{base}/{model}"))
        .header("Authorization", format!("Key {api_key}"))
        .json(&serde_json::Value::Object(body))
        .send()
        .await
        .map_err(|error| format!("Unable to submit fal.ai job: {error}"))?;
    let submit_json = video_response_json(submit, "fal.ai submit").await?;
    let status_url = video_json_path_string(&submit_json, &["status_url"]).ok_or_else(|| {
        format!("fal.ai submit response did not include status_url: {submit_json}")
    })?;
    let response_url =
        video_json_path_string(&submit_json, &["response_url"]).ok_or_else(|| {
            format!("fal.ai submit response did not include response_url: {submit_json}")
        })?;
    video_set_generation_provider_ref(
        context,
        serde_json::json!({
            "statusUrl": status_url,
            "responseUrl": response_url,
        }),
    )?;
    let result =
        video_fal_poll_response(&client, status_url, response_url, &api_key, cancel).await?;
    let urls = video_fal_output_urls(&result);
    if urls.is_empty() {
        return Err(format!(
            "fal.ai response did not include downloadable outputs: {result}"
        ));
    }
    video_download_provider_urls(context, &client, urls, cancel).await
}

async fn video_generate_worker(
    context: VideoGenerateJobContext,
    request: VideoGenerateRequest,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    video_emit_generate_progress(
        &context,
        "submitting",
        Some(0.0),
        "Submitting generation request.",
        false,
        None,
        &[],
    );
    let result = async {
        let provider = video_provider_definition(&request.provider_id)
            .ok_or_else(|| format!("Unknown video generation provider: {}", request.provider_id))?;
        let output_paths = match provider.id {
            "cloud" => {
                video_generate_cloud(&context, &request, &cancel).await?;
                Vec::new()
            }
            "higgsfield" => {
                video_emit_generate_progress(
                    &context,
                    "queued",
                    None,
                    "Generation queued.",
                    false,
                    None,
                    &[],
                );
                video_generate_higgsfield(&context, &request, provider, &cancel).await?
            }
            "seedance" => {
                video_emit_generate_progress(
                    &context,
                    "queued",
                    None,
                    "Generation queued.",
                    false,
                    None,
                    &[],
                );
                video_generate_seedance(&context, &request, provider, &cancel).await?
            }
            "kling" => {
                video_emit_generate_progress(
                    &context,
                    "queued",
                    None,
                    "Generation queued.",
                    false,
                    None,
                    &[],
                );
                video_generate_kling(&context, &request, provider, &cancel).await?
            }
            "gpt-image-2" => video_generate_openai_image(&context, &request, provider).await?,
            "nano-banana" => video_generate_nano_banana(&context, &request, provider).await?,
            "flux-lora" => video_generate_flux_lora(&context, &request, provider, &cancel).await?,
            "fal" => {
                video_emit_generate_progress(
                    &context,
                    "queued",
                    None,
                    "Generation queued.",
                    false,
                    None,
                    &[],
                );
                video_generate_fal(&context, &request, provider, &cancel).await?
            }
            _ => {
                return Err(format!(
                    "Unsupported video generation provider: {}",
                    provider.id
                ));
            }
        };
        if provider.id != "cloud" {
            let _ = context.app.emit(
                VIDEO_STORE_CHANGED_EVENT,
                serde_json::json!({
                    "repoPath": context.root.to_string_lossy().to_string(),
                    "paths": output_paths,
                    "changedAtMs": video_now_millis(),
                }),
            );
        }
        Ok::<Vec<String>, String>(output_paths)
    }
    .await;
    let keep_cloud_job_active = context.provider_id == "cloud" && result.is_ok();
    match result {
        Ok(output_paths) if context.provider_id == "cloud" && output_paths.is_empty() => {}
        Ok(output_paths) => video_emit_generate_progress(
            &context,
            "done",
            Some(100.0),
            "Generation finished.",
            true,
            None,
            &output_paths,
        ),
        Err(_error) if cancel.load(std::sync::atomic::Ordering::Acquire) => {
            video_emit_generate_progress(
                &context,
                "cancelled",
                Some(100.0),
                "Generation cancelled.",
                true,
                None,
                &[],
            )
        }
        Err(error) => video_emit_generate_progress(
            &context,
            "error",
            Some(100.0),
            &error,
            true,
            Some(&error),
            &[],
        ),
    }
    if !keep_cloud_job_active {
        video_job_registry_remove(&VIDEO_GENERATE_JOBS, &context.job_id);
    }
}

#[tauri::command]
async fn video_generate_start(
    app: tauri::AppHandle,
    repo_path: String,
    request: VideoGenerateRequest,
) -> Result<VideoGenerateStartResult, String> {
    let provider = video_provider_definition(&request.provider_id)
        .ok_or_else(|| format!("Unknown video generation provider: {}", request.provider_id))?;
    let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
    video_ensure_media_dirs(&media_root)?;
    let (job_id, cancel) = video_job_registry_insert(&VIDEO_GENERATE_JOBS)?;
    let created_at_ms = video_now_millis();
    let model = if request.model.trim().is_empty() {
        provider
            .models
            .first()
            .copied()
            .unwrap_or_default()
            .to_string()
    } else {
        request.model.clone()
    };
    let kind = video_generate_request_kind(provider, &model, &request);
    let recorded_request = video_recorded_generate_request(kind, &model, &request);
    let planned_paths =
        video_plan_generated_paths(&root, &media_root, provider, &request, kind, created_at_ms);
    let registry_path = video_generation_jobs_path(&media_root);
    let entry = VideoPersistentGenerateJob {
        job_id: job_id.clone(),
        provider_id: provider.id.to_string(),
        model: model.clone(),
        mode: request.mode.clone(),
        request: recorded_request.clone(),
        state: "submitting".to_string(),
        percent: Some(0.0),
        planned_paths: planned_paths.clone(),
        provider_ref: None,
        created_at_ms,
        done: false,
        error: None,
    };
    video_upsert_generation_job(&registry_path, entry)?;
    let context = VideoGenerateJobContext {
        app,
        root,
        media_root: media_root.clone(),
        generated_dir: media_root.join(VIDEO_GENERATED_DIR),
        job_id: job_id.clone(),
        provider_id: provider.id.to_string(),
        model,
        mode: request.mode.clone(),
        request: recorded_request,
        planned_paths: planned_paths.clone(),
        created_at_ms,
        registry_path,
        last_registry_write_ms: std::sync::Arc::new(std::sync::Mutex::new(created_at_ms)),
    };
    tauri::async_runtime::spawn(video_generate_worker(context, request, cancel));
    Ok(VideoGenerateStartResult {
        job_id,
        planned_paths,
    })
}

async fn video_generate_resume_from_ref(
    context: &VideoGenerateJobContext,
    job: &VideoPersistentGenerateJob,
    auth: Option<VideoProviderAuth>,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<Vec<String>, String> {
    let provider = video_provider_definition(&job.provider_id)
        .ok_or_else(|| format!("Unknown video generation provider: {}", job.provider_id))?;
    let provider_ref = job
        .provider_ref
        .as_ref()
        .ok_or_else(|| "Video generation job cannot be resumed without providerRef.".to_string())?;
    let client = http_client(std::time::Duration::from_secs(120))?;
    match provider.id {
        "higgsfield" => {
            let task_id = video_json_path_string(provider_ref, &["taskId"])
                .ok_or_else(|| "Higgsfield resume providerRef is missing taskId.".to_string())?;
            let base = video_json_path_string(provider_ref, &["baseUrl"])
                .map(str::to_string)
                .unwrap_or_else(|| video_provider_base_url(provider, &auth));
            let api_key = video_auth_api_key(&auth)?;
            let secret = video_auth_secret_key(&auth)?;
            let auth_header = format!("Key {api_key}:{secret}");
            let started = std::time::Instant::now();
            loop {
                if started.elapsed() > std::time::Duration::from_secs(VIDEO_GENERATION_TIMEOUT_SECS)
                {
                    return Err("Higgsfield generation timed out.".to_string());
                }
                video_poll_sleep(cancel).await?;
                video_emit_generate_progress(
                    context,
                    "running",
                    None,
                    "Waiting for Higgsfield.",
                    false,
                    None,
                    &[],
                );
                let poll = client
                    .get(format!("{base}/requests/{task_id}/status"))
                    .header("Authorization", auth_header.clone())
                    .send()
                    .await
                    .map_err(|error| format!("Unable to poll Higgsfield job: {error}"))?;
                let poll_json = video_response_json(poll, "Higgsfield poll").await?;
                match video_json_path_string(&poll_json, &["status"]).unwrap_or_default() {
                    "completed" | "succeeded" | "success" => {
                        let urls = video_higgsfield_output_urls(&poll_json);
                        if urls.is_empty() {
                            return Err("Higgsfield job completed without result URLs.".to_string());
                        }
                        return video_download_provider_urls(context, &client, urls, cancel).await;
                    }
                    "failed" | "error" => {
                        return Err(format!("Higgsfield job failed: {poll_json}"));
                    }
                    "nsfw" => return Err("Higgsfield job was rejected by moderation.".to_string()),
                    _ => {}
                }
            }
        }
        "seedance" => {
            let task_id = video_json_path_string(provider_ref, &["taskId"])
                .ok_or_else(|| "Seedance resume providerRef is missing taskId.".to_string())?;
            let base = video_json_path_string(provider_ref, &["baseUrl"])
                .map(str::to_string)
                .unwrap_or_else(|| video_provider_base_url(provider, &auth));
            let api_key = video_auth_api_key(&auth)?;
            let started = std::time::Instant::now();
            loop {
                if started.elapsed() > std::time::Duration::from_secs(VIDEO_GENERATION_TIMEOUT_SECS)
                {
                    return Err("Seedance generation timed out.".to_string());
                }
                video_poll_sleep(cancel).await?;
                video_emit_generate_progress(
                    context,
                    "running",
                    None,
                    "Waiting for Seedance.",
                    false,
                    None,
                    &[],
                );
                let poll = client
                    .get(format!("{base}/contents/generations/tasks/{task_id}"))
                    .bearer_auth(api_key.clone())
                    .send()
                    .await
                    .map_err(|error| format!("Unable to poll Seedance job: {error}"))?;
                let poll_json = video_response_json(poll, "Seedance poll").await?;
                match video_json_path_string(&poll_json, &["status"]).unwrap_or_default() {
                    "succeeded" => {
                        let url = video_json_path_string(&poll_json, &["content", "video_url"])
                            .ok_or_else(|| "Seedance job succeeded without video_url.".to_string())?
                            .to_string();
                        return video_download_provider_urls(context, &client, vec![url], cancel)
                            .await;
                    }
                    "failed" => return Err(format!("Seedance job failed: {poll_json}")),
                    _ => {}
                }
            }
        }
        "kling" => {
            let task_id = video_json_path_string(provider_ref, &["taskId"])
                .ok_or_else(|| "Kling resume providerRef is missing taskId.".to_string())?;
            let endpoint = video_json_path_string(provider_ref, &["endpoint"])
                .unwrap_or("/v1/videos/text2video");
            let base = video_json_path_string(provider_ref, &["baseUrl"])
                .map(str::to_string)
                .unwrap_or_else(|| video_provider_base_url(provider, &auth));
            let api_key = video_auth_api_key(&auth)?;
            let secret = video_auth_secret_key(&auth)?;
            let started = std::time::Instant::now();
            loop {
                if started.elapsed() > std::time::Duration::from_secs(VIDEO_GENERATION_TIMEOUT_SECS)
                {
                    return Err("Kling generation timed out.".to_string());
                }
                video_poll_sleep(cancel).await?;
                video_emit_generate_progress(
                    context,
                    "running",
                    None,
                    "Waiting for Kling.",
                    false,
                    None,
                    &[],
                );
                let poll = client
                    .get(format!("{base}{endpoint}/{task_id}"))
                    .bearer_auth(video_kling_jwt(&api_key, &secret)?)
                    .send()
                    .await
                    .map_err(|error| format!("Unable to poll Kling job: {error}"))?;
                let poll_json = video_response_json(poll, "Kling poll").await?;
                match video_json_path_string(&poll_json, &["data", "task_status"])
                    .unwrap_or_default()
                {
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
                        return video_download_provider_urls(context, &client, urls, cancel).await;
                    }
                    "failed" => return Err(format!("Kling job failed: {poll_json}")),
                    _ => {}
                }
            }
        }
        "fal" | "flux-lora" => {
            let status_url = video_json_path_string(provider_ref, &["statusUrl"])
                .or_else(|| video_json_path_string(provider_ref, &["status_url"]))
                .ok_or_else(|| "fal resume providerRef is missing statusUrl.".to_string())?;
            let response_url = video_json_path_string(provider_ref, &["responseUrl"])
                .or_else(|| video_json_path_string(provider_ref, &["response_url"]))
                .ok_or_else(|| "fal resume providerRef is missing responseUrl.".to_string())?;
            let api_key = video_auth_api_key(&auth)?;
            video_emit_generate_progress(
                context,
                "running",
                None,
                "Waiting for fal.ai.",
                false,
                None,
                &[],
            );
            let result =
                video_fal_poll_response(&client, status_url, response_url, &api_key, cancel)
                    .await?;
            let urls = video_fal_output_urls(&result);
            if urls.is_empty() {
                return Err(format!(
                    "fal.ai response did not include downloadable outputs: {result}"
                ));
            }
            video_download_provider_urls(context, &client, urls, cancel).await
        }
        _ => Err(format!(
            "Video generation provider cannot be resumed: {}",
            provider.id
        )),
    }
}

fn video_generate_resume_error_is_terminal(error: &str) -> bool {
    error.contains("job failed:")
        || error.contains("queue job failed:")
        || error.contains("completed without")
        || error.contains("succeeded without")
        || error.contains("response did not include downloadable outputs")
}

async fn video_generate_resume_preflight(
    job: &VideoPersistentGenerateJob,
    auth: &Option<VideoProviderAuth>,
) -> Result<(), String> {
    let provider = video_provider_definition(&job.provider_id)
        .ok_or_else(|| format!("Unknown video generation provider: {}", job.provider_id))?;
    let provider_ref = job
        .provider_ref
        .as_ref()
        .ok_or_else(|| "Video generation job cannot be resumed without providerRef.".to_string())?;
    let client = http_client(std::time::Duration::from_secs(30))?;
    match provider.id {
        "higgsfield" => {
            let task_id = video_json_path_string(provider_ref, &["taskId"])
                .ok_or_else(|| "Higgsfield resume providerRef is missing taskId.".to_string())?;
            let base = video_json_path_string(provider_ref, &["baseUrl"])
                .map(str::to_string)
                .unwrap_or_else(|| video_provider_base_url(provider, auth));
            let api_key = video_auth_api_key(auth)?;
            let secret = video_auth_secret_key(auth)?;
            let auth_header = format!("Key {api_key}:{secret}");
            let poll = client
                .get(format!("{base}/requests/{task_id}/status"))
                .header("Authorization", auth_header)
                .send()
                .await
                .map_err(|error| format!("Unable to poll Higgsfield job: {error}"))?;
            let _ = video_response_json(poll, "Higgsfield poll").await?;
            Ok(())
        }
        "seedance" => {
            let task_id = video_json_path_string(provider_ref, &["taskId"])
                .ok_or_else(|| "Seedance resume providerRef is missing taskId.".to_string())?;
            let base = video_json_path_string(provider_ref, &["baseUrl"])
                .map(str::to_string)
                .unwrap_or_else(|| video_provider_base_url(provider, auth));
            let api_key = video_auth_api_key(auth)?;
            let poll = client
                .get(format!("{base}/contents/generations/tasks/{task_id}"))
                .bearer_auth(api_key)
                .send()
                .await
                .map_err(|error| format!("Unable to poll Seedance job: {error}"))?;
            let _ = video_response_json(poll, "Seedance poll").await?;
            Ok(())
        }
        "kling" => {
            let task_id = video_json_path_string(provider_ref, &["taskId"])
                .ok_or_else(|| "Kling resume providerRef is missing taskId.".to_string())?;
            let endpoint = video_json_path_string(provider_ref, &["endpoint"])
                .unwrap_or("/v1/videos/text2video");
            let base = video_json_path_string(provider_ref, &["baseUrl"])
                .map(str::to_string)
                .unwrap_or_else(|| video_provider_base_url(provider, auth));
            let api_key = video_auth_api_key(auth)?;
            let secret = video_auth_secret_key(auth)?;
            let poll = client
                .get(format!("{base}{endpoint}/{task_id}"))
                .bearer_auth(video_kling_jwt(&api_key, &secret)?)
                .send()
                .await
                .map_err(|error| format!("Unable to poll Kling job: {error}"))?;
            let _ = video_response_json(poll, "Kling poll").await?;
            Ok(())
        }
        "fal" | "flux-lora" => {
            let status_url = video_json_path_string(provider_ref, &["statusUrl"])
                .or_else(|| video_json_path_string(provider_ref, &["status_url"]))
                .ok_or_else(|| "fal resume providerRef is missing statusUrl.".to_string())?;
            let _response_url = video_json_path_string(provider_ref, &["responseUrl"])
                .or_else(|| video_json_path_string(provider_ref, &["response_url"]))
                .ok_or_else(|| "fal resume providerRef is missing responseUrl.".to_string())?;
            let api_key = video_auth_api_key(auth)?;
            let poll = client
                .get(status_url)
                .header("Authorization", format!("Key {api_key}"))
                .send()
                .await
                .map_err(|error| format!("Unable to poll fal.ai queue: {error}"))?;
            let _ = video_response_json(poll, "fal.ai status").await?;
            Ok(())
        }
        _ => Err(format!(
            "Video generation provider cannot be resumed: {}",
            provider.id
        )),
    }
}

async fn video_generate_resume_worker(
    context: VideoGenerateJobContext,
    job: VideoPersistentGenerateJob,
    auth: Option<VideoProviderAuth>,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    let result = video_generate_resume_from_ref(&context, &job, auth, &cancel).await;
    match result {
        Ok(output_paths) => {
            let _ = context.app.emit(
                VIDEO_STORE_CHANGED_EVENT,
                serde_json::json!({
                    "repoPath": context.root.to_string_lossy().to_string(),
                    "paths": output_paths,
                    "changedAtMs": video_now_millis(),
                }),
            );
            video_emit_generate_progress(
                &context,
                "done",
                Some(100.0),
                "Generation finished.",
                true,
                None,
                &output_paths,
            );
        }
        Err(_error) if cancel.load(std::sync::atomic::Ordering::Acquire) => {
            video_emit_generate_progress(
                &context,
                "cancelled",
                Some(100.0),
                "Generation cancelled.",
                true,
                None,
                &[],
            );
        }
        Err(error) => {
            let done = video_generate_resume_error_is_terminal(&error);
            video_emit_generate_progress(
                &context,
                "error",
                Some(100.0),
                &error,
                done,
                Some(&error),
                &[],
            );
        }
    }
    video_job_registry_remove(&VIDEO_GENERATE_JOBS, &context.job_id);
}

#[tauri::command]
async fn video_jobs_list(repo_path: String) -> Result<VideoJobsListResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        video_ensure_media_dirs(&media_root)?;
        Ok(VideoJobsListResponse {
            jobs: video_read_generation_jobs(&video_generation_jobs_path(&media_root))?,
        })
    })
    .await
    .map_err(|error| format!("Video jobs list worker failed: {error}"))?
}

#[tauri::command]
async fn video_generate_resume(
    app: tauri::AppHandle,
    repo_path: String,
    job_id: String,
    auth: Option<VideoProviderAuth>,
) -> Result<VideoGenerateResumeResponse, String> {
    let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
    video_ensure_media_dirs(&media_root)?;
    let registry_path = video_generation_jobs_path(&media_root);
    let jobs = video_read_generation_jobs(&registry_path)?;
    let job = jobs
        .into_iter()
        .find(|job| job.job_id == job_id)
        .ok_or_else(|| format!("Video generation job not found: {job_id}"))?;
    if job.done {
        return Err("Video generation job is already done.".to_string());
    }
    if job.provider_ref.is_none() {
        return Err("Video generation job does not have a providerRef to resume.".to_string());
    }
    if job.provider_id == "cloud" {
        let cloud_job_id = job
            .provider_ref
            .as_ref()
            .and_then(video_cloud_job_id_from_provider_ref)
            .ok_or_else(|| "Cloud generation providerRef is missing cloudJobId.".to_string())?;
        let cancel = video_job_registry_insert_with_id(&VIDEO_GENERATE_JOBS, &job.job_id)?;
        let context = VideoGenerateJobContext {
            app,
            root,
            media_root: media_root.clone(),
            generated_dir: media_root.join(VIDEO_GENERATED_DIR),
            job_id: job.job_id.clone(),
            provider_id: job.provider_id.clone(),
            model: job.model.clone(),
            mode: job.mode.clone(),
            request: job.request.clone(),
            planned_paths: job.planned_paths.clone(),
            created_at_ms: job.created_at_ms,
            registry_path,
            last_registry_write_ms: std::sync::Arc::new(std::sync::Mutex::new(0)),
        };
        video_cloud_register_generation_job(&cloud_job_id, context.clone(), cancel)?;
        video_emit_generate_progress(
            &context,
            "running",
            None,
            "Waiting for Diff Forge Cloud.",
            false,
            None,
            &[],
        );
        return Ok(VideoGenerateResumeResponse { ok: true });
    }
    video_generate_resume_preflight(&job, &auth).await?;
    let cancel = video_job_registry_insert_with_id(&VIDEO_GENERATE_JOBS, &job.job_id)?;
    let context = VideoGenerateJobContext {
        app,
        root,
        media_root: media_root.clone(),
        generated_dir: media_root.join(VIDEO_GENERATED_DIR),
        job_id: job.job_id.clone(),
        provider_id: job.provider_id.clone(),
        model: job.model.clone(),
        mode: job.mode.clone(),
        request: job.request.clone(),
        planned_paths: job.planned_paths.clone(),
        created_at_ms: job.created_at_ms,
        registry_path,
        last_registry_write_ms: std::sync::Arc::new(std::sync::Mutex::new(0)),
    };
    tauri::async_runtime::spawn(video_generate_resume_worker(context, job, auth, cancel));
    Ok(VideoGenerateResumeResponse { ok: true })
}

// Cancels generation AND LoRA-training jobs: the frontend shows both in one
// jobs list and cancels either through this command.
#[tauri::command]
fn video_generate_cancel(job_id: String) -> Result<(), String> {
    match video_job_registry_cancel(&VIDEO_GENERATE_JOBS, &job_id) {
        Ok(()) => {
            let _ = video_cloud_cancel_generation_job(&job_id);
            Ok(())
        }
        Err(error) if error == "Unknown job" => {
            video_job_registry_cancel(&VIDEO_LORA_JOBS, &job_id).map_err(|lora_error| {
                if lora_error == "Unknown job" {
                    "Unknown job".to_string()
                } else {
                    lora_error
                }
            })
        }
        Err(error) => Err(error),
    }
}

fn video_mcp_string_array(input: &serde_json::Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .find_map(|key| input.get(*key).and_then(serde_json::Value::as_array))
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn video_mcp_generate_default_mode(
    kind: &str,
    input_asset_paths: &[String],
    _audio_asset_paths: &[String],
) -> String {
    match kind {
        "audio" => "text-to-audio".to_string(),
        "image" if input_asset_paths.is_empty() => "text-to-image".to_string(),
        "image" => "image-edit".to_string(),
        "video" if input_asset_paths.is_empty() => "text-to-video".to_string(),
        "video" => "image-to-video".to_string(),
        _ => "text-to-video".to_string(),
    }
}

fn video_mcp_prepare_generate_start_request(
    repo_path: &str,
    input: &serde_json::Value,
) -> Result<VideoGenerateRequest, String> {
    let model = video_mcp_input_text(input, &["model"])
        .ok_or_else(|| "video_generate start requires model.".to_string())?;
    let kind = video_mcp_input_text(input, &["kind"]).unwrap_or_else(|| "video".to_string());
    let prompt = input
        .get("prompt")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let input_asset_paths =
        video_mcp_string_array(input, &["inputAssetPaths", "input_asset_paths"]);
    let audio_asset_paths =
        video_mcp_string_array(input, &["audioAssetPaths", "audio_asset_paths"]);
    let mode = video_mcp_input_text(input, &["mode"]).unwrap_or_else(|| {
        video_mcp_generate_default_mode(&kind, &input_asset_paths, &audio_asset_paths)
    });
    let (root, media_root) = video_workspace_media_root(repo_path)?;
    video_ensure_media_dirs(&media_root)?;
    video_mcp_validate_generate_start(
        &root,
        &media_root,
        &kind,
        &model,
        &input_asset_paths,
        &audio_asset_paths,
    )?;
    let params = input
        .get("params")
        .cloned()
        .map(serde_json::from_value::<VideoGenerateParams>)
        .transpose()
        .map_err(|error| format!("Unable to decode video_generate params: {error}"))?;
    Ok(VideoGenerateRequest {
        provider_id: "cloud".to_string(),
        model,
        mode,
        prompt,
        input_asset_paths,
        audio_asset_paths,
        params,
        lora_id: None,
        auth: Some(VideoProviderAuth::default()),
    })
}

async fn video_mcp_generate(
    app: tauri::AppHandle,
    repo_path: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let action = input
        .get("action")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "video_generate action is required.".to_string())?;
    match action {
        "models" => {
            let kind = video_mcp_input_text(&input, &["kind"]);
            if let Some(kind) = kind.as_deref() {
                if !matches!(kind, "video" | "image" | "audio") {
                    return Err("kind must be video, image, or audio.".to_string());
                }
            }
            Ok(serde_json::json!({ "models": video_mcp_generate_models(kind.as_deref()) }))
        }
        "start" => {
            let request = video_mcp_prepare_generate_start_request(repo_path.as_str(), &input)?;
            let result = video_generate_start(app, repo_path, request).await?;
            Ok(serde_json::json!({
                "jobId": result.job_id,
                "plannedPaths": result.planned_paths,
            }))
        }
        "status" => {
            let job_id = video_mcp_input_text(&input, &["jobId", "job_id"]);
            let (_root, media_root) = video_workspace_media_root(repo_path.as_str())?;
            video_mcp_generate_status_value(&media_root, job_id.as_deref())
        }
        "cancel" => {
            let job_id = video_mcp_input_text(&input, &["jobId", "job_id"])
                .ok_or_else(|| "video_generate cancel requires jobId.".to_string())?;
            video_generate_cancel(job_id.clone())?;
            Ok(serde_json::json!({ "ok": true, "jobId": job_id }))
        }
        _ => Err(format!("Unknown video_generate action: {action}")),
    }
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

fn video_lora_write_registry(
    app: &tauri::AppHandle,
    entries: &[VideoLoraEntry],
) -> Result<(), String> {
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
        return Err(
            "LoRA training image zip exceeds 40MB. Use fewer or smaller images.".to_string(),
        );
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
        video_emit_lora_progress(
            &app,
            &job_id,
            &lora_id,
            "submitting",
            Some(0.0),
            "Preparing LoRA training images.",
            false,
            None,
        );
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
        let status_url =
            video_json_path_string(&submit_json, &["status_url"]).ok_or_else(|| {
                format!("fal.ai LoRA submit response did not include status_url: {submit_json}")
            })?;
        let response_url =
            video_json_path_string(&submit_json, &["response_url"]).ok_or_else(|| {
                format!("fal.ai LoRA submit response did not include response_url: {submit_json}")
            })?;
        video_emit_lora_progress(
            &app,
            &job_id,
            &lora_id,
            "queued",
            Some(10.0),
            "LoRA training queued.",
            false,
            None,
        );
        let result =
            video_fal_poll_response(&client, status_url, response_url, &api_key, &cancel).await?;
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
        Ok(()) => video_emit_lora_progress(
            &app,
            &job_id,
            &lora_id,
            "done",
            Some(100.0),
            "LoRA training finished.",
            true,
            None,
        ),
        Err(_error) if cancel.load(std::sync::atomic::Ordering::Acquire) => {
            if let Ok(mut entries) = video_lora_read_registry(&app) {
                if let Some(entry) = entries.iter_mut().find(|entry| entry.id == lora_id) {
                    entry.status = "error".to_string();
                }
                let _ = video_lora_write_registry(&app, &entries);
            }
            video_emit_lora_progress(
                &app,
                &job_id,
                &lora_id,
                "cancelled",
                Some(100.0),
                "LoRA training cancelled.",
                true,
                None,
            );
        }
        Err(error) => {
            if let Ok(mut entries) = video_lora_read_registry(&app) {
                if let Some(entry) = entries.iter_mut().find(|entry| entry.id == lora_id) {
                    entry.status = "error".to_string();
                }
                let _ = video_lora_write_registry(&app, &entries);
            }
            video_emit_lora_progress(
                &app,
                &job_id,
                &lora_id,
                "error",
                Some(100.0),
                &error,
                true,
                Some(&error),
            );
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

fn emit_video_panel_closed(
    app: &tauri::AppHandle,
    workspace_id: &str,
    pane_id: &str,
    window_id: &str,
) {
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
    let theme_text = if theme_text == "light" {
        "light"
    } else {
        "dark"
    };
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
async fn video_panel_focus(
    app: tauri::AppHandle,
    workspace_id: String,
    pane_id: String,
) -> Result<bool, String> {
    let label = video_panel_label(&workspace_id, &pane_id);
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(false);
    };
    let _ = window.show();
    let _ = window.set_focus();
    Ok(true)
}

#[tauri::command]
async fn video_panel_close(
    app: tauri::AppHandle,
    workspace_id: String,
    pane_id: String,
) -> Result<(), String> {
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
mod video_mcp_tests {
    fn project_with_clip(overrides: serde_json::Value) -> super::VideoMcpProject {
        let mut clip = serde_json::json!({
            "id": "clip-1",
            "assetPath": "media/assets/a.mp4",
            "timelineStartMs": 1000,
            "durationMs": 4000,
            "sourceInMs": 500,
            "speed": 1,
            "gain": { "level": 1, "keyframes": [] },
            "transform": { "x": 0, "y": 0, "scale": 1, "opacity": 1 },
            "kf": {},
            "linkId": "",
        });
        if let (Some(base), Some(extra)) = (clip.as_object_mut(), overrides.as_object()) {
            for (key, value) in extra {
                base.insert(key.clone(), value.clone());
            }
        }
        super::video_mcp_project_from_value(&serde_json::json!({
            "version": 1,
            "name": "test",
            "settings": {
                "width": 1920,
                "height": 1080,
                "fps": 30,
                "background": "#000000",
            },
            "tracks": [
                {
                    "id": "v1",
                    "kind": "video",
                    "label": "V1",
                    "muted": false,
                    "locked": false,
                    "clips": [clip],
                },
                {
                    "id": "a1",
                    "kind": "audio",
                    "label": "A1",
                    "muted": false,
                    "locked": false,
                    "clips": [],
                },
                {
                    "id": "t1",
                    "kind": "text",
                    "label": "T1",
                    "muted": false,
                    "locked": false,
                    "clips": [],
                },
            ],
            "updatedAtMs": 0,
        }))
        .expect("project decodes")
    }

    fn empty_project() -> super::VideoMcpProject {
        super::video_mcp_project_from_value(&serde_json::json!({
            "version": 1,
            "name": "test",
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
        }))
        .expect("project decodes")
    }

    fn edit_state(project: &super::VideoMcpProject) -> super::VideoMcpEditState {
        super::VideoMcpEditState {
            next_clip_seq: super::video_mcp_project_clip_count(project).saturating_add(1),
            next_link_seq: 1,
            changed_clip_ids: std::collections::BTreeSet::new(),
            summaries: Vec::new(),
        }
    }

    fn clips<'a>(project: &'a super::VideoMcpProject, kind: &str) -> &'a [super::VideoMcpClip] {
        project
            .tracks
            .iter()
            .find(|track| track.kind == kind)
            .map(|track| track.clips.as_slice())
            .unwrap_or(&[])
    }

    fn temp_video_root() -> (std::path::PathBuf, std::path::PathBuf) {
        let root =
            std::env::temp_dir().join(format!("diffforge-video-mcp-test-{}", uuid::Uuid::new_v4()));
        let media_root = root.join("media");
        std::fs::create_dir_all(media_root.join("assets")).expect("create media assets dir");
        (root, media_root)
    }

    fn write_probe_cache(
        media_root: &std::path::Path,
        rel_path: &str,
        metadata: &std::fs::Metadata,
        summary: serde_json::Value,
    ) {
        let key = super::video_cache_key(
            rel_path,
            super::video_file_modified_ms(metadata),
            metadata.len(),
        );
        let mut cache = serde_json::Map::new();
        cache.insert(key, summary);
        super::video_write_probe_cache(
            &media_root
                .join(super::VIDEO_CACHE_DIR)
                .join(super::VIDEO_PROBE_CACHE_FILE),
            &cache,
        )
        .expect("write probe cache");
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() <= 1e-9,
            "expected {actual} to be close to {expected}"
        );
    }

    #[test]
    fn video_mcp_split_envelope_partitioning_matches_spec() {
        let mut project = project_with_clip(serde_json::json!({
            "gain": {
                "level": 1,
                "keyframes": [
                    { "atMs": 0, "level": 1 },
                    { "atMs": 4000, "level": 0 }
                ]
            },
            "kf": {
                "opacity": [
                    { "atMs": 0, "value": 1, "easing": "linear" },
                    { "atMs": 4000, "value": 0, "easing": "linear" }
                ]
            }
        }));
        let mut state = edit_state(&project);
        super::video_mcp_split(&mut project, "clip-1", 3000, &mut state).expect("split");
        let video = clips(&project, "video");
        assert_eq!(video.len(), 2);
        let left = &video[0];
        let right = &video[1];
        assert_eq!(left.duration_ms, 2000);
        assert_eq!(right.timeline_start_ms, 3000);
        assert_eq!(right.duration_ms, 2000);
        assert_eq!(right.source_in_ms, 2500);
        assert_close(
            super::video_mcp_gain_at_ms(&left.gain, left.duration_ms),
            0.5,
        );
        assert_close(super::video_mcp_gain_at_ms(&right.gain, 0), 0.5);
        assert_close(
            super::video_mcp_gain_at_ms(&right.gain, right.duration_ms),
            0.0,
        );
        assert_close(
            super::video_mcp_kf_value_at_ms(
                left.kf.get("opacity").expect("left opacity"),
                left.duration_ms,
                9.0,
            ),
            0.5,
        );
        assert_close(
            super::video_mcp_kf_value_at_ms(
                right.kf.get("opacity").expect("right opacity"),
                0,
                9.0,
            ),
            0.5,
        );
    }

    #[test]
    fn video_mcp_trim_start_source_in_scales_with_speed() {
        let mut project = project_with_clip(serde_json::json!({ "speed": 2 }));
        let mut state = edit_state(&project);
        super::video_mcp_trim(&mut project, "clip-1", "start", 1000, &mut state)
            .expect("trim start");
        let clip = &clips(&project, "video")[0];
        assert_eq!(clip.timeline_start_ms, 2000);
        assert_eq!(clip.duration_ms, 3000);
        assert_eq!(clip.source_in_ms, 2500);
    }

    #[test]
    fn video_mcp_trim_start_extension_restores_earlier_source_material() {
        let mut project = project_with_clip(serde_json::json!({
            "sourceInMs": 900,
            "speed": 1.5
        }));
        let mut state = edit_state(&project);
        super::video_mcp_trim(&mut project, "clip-1", "start", -500, &mut state)
            .expect("extend trim start");
        let clip = &clips(&project, "video")[0];
        assert_eq!(clip.timeline_start_ms, 500);
        assert_eq!(clip.duration_ms, 4500);
        assert_eq!(clip.source_in_ms, 150);

        let mut project = project_with_clip(serde_json::json!({
            "sourceInMs": 200,
            "speed": 2
        }));
        let mut state = edit_state(&project);
        super::video_mcp_trim(&mut project, "clip-1", "start", -500, &mut state)
            .expect("clamped trim start extension");
        let clip = &clips(&project, "video")[0];
        assert_eq!(clip.timeline_start_ms, 900);
        assert_eq!(clip.duration_ms, 4100);
        assert_eq!(clip.source_in_ms, 0);
    }

    #[test]
    fn video_mcp_linked_non_ripple_trim_end_trims_all_partners() {
        let mut project = project_with_clip(serde_json::json!({ "linkId": "link-1" }));
        project.tracks[1].clips.push(super::VideoMcpClip {
            id: "audio-1".to_string(),
            asset_path: "media/assets/a.mp3".to_string(),
            timeline_start_ms: 1000,
            duration_ms: 4000,
            source_in_ms: 500,
            link_id: "link-1".to_string(),
            ..super::VideoMcpClip::default()
        });
        let mut state = edit_state(&project);
        super::video_mcp_trim(&mut project, "clip-1", "end", -1000, &mut state)
            .expect("linked trim end");
        assert_eq!(clips(&project, "video")[0].duration_ms, 3000);
        assert_eq!(clips(&project, "audio")[0].duration_ms, 3000);
        assert!(state.changed_clip_ids.contains("clip-1"));
        assert!(state.changed_clip_ids.contains("audio-1"));
    }

    #[test]
    fn video_mcp_split_before_existing_clip_returns_reparse_stable_right_id() {
        let mut project = project_with_clip(serde_json::json!({}));
        project.tracks[0].clips.push(super::VideoMcpClip {
            id: "existing".to_string(),
            asset_path: "media/assets/b.mp4".to_string(),
            timeline_start_ms: 6000,
            duration_ms: 1000,
            source_in_ms: 0,
            ..super::VideoMcpClip::default()
        });
        let mut state = edit_state(&project);
        super::video_mcp_split(&mut project, "clip-1", 3000, &mut state).expect("split");
        assert!(state.changed_clip_ids.contains("c3"));

        let project_value = super::video_mcp_project_to_value(&project).expect("project value");
        let pipe = super::video_pipe_serialize_project(&project_value).expect("serialize pipe");
        let reparsed_value = super::video_pipe_parse_project(&pipe).expect("parse pipe");
        let reparsed_project =
            super::video_mcp_project_from_value(&reparsed_value).expect("reparsed project");
        let id_map = super::video_mcp_reparsed_clip_id_map(&project, &reparsed_project);
        let changed_ids =
            super::video_mcp_reparsed_changed_clip_ids(&state.changed_clip_ids, &id_map);
        assert_eq!(changed_ids, vec!["c1".to_string(), "c2".to_string()]);
        assert_eq!(
            super::video_mcp_rewrite_summary_ids(&state.summaries.join("; "), &id_map),
            "split c1"
        );
    }

    #[test]
    fn video_mcp_set_props_allows_font_family() {
        let mut project = project_with_clip(serde_json::json!({}));
        project.tracks[2].clips.push(super::VideoMcpClip {
            id: "text-1".to_string(),
            text: "Title".to_string(),
            timeline_start_ms: 0,
            duration_ms: 1000,
            style: serde_json::json!({ "fontFamily": "sans-serif" }),
            ..super::VideoMcpClip::default()
        });
        let mut state = edit_state(&project);
        super::video_mcp_set_props(
            &mut project,
            "text-1",
            &serde_json::json!({ "style": { "fontFamily": "Open Sans" } }),
            &mut state,
        )
        .expect("set text props");
        assert_eq!(clips(&project, "text")[0].style["fontFamily"], "Open Sans");
    }

    #[test]
    fn video_mcp_ripple_delete_range_straddler_and_downstream_shift() {
        let mut project = project_with_clip(serde_json::json!({}));
        project.tracks[1].clips.push(super::VideoMcpClip {
            id: "audio-1".to_string(),
            asset_path: "media/assets/a.mp3".to_string(),
            timeline_start_ms: 0,
            duration_ms: 6000,
            source_in_ms: 0,
            ..super::VideoMcpClip::default()
        });
        let mut state = edit_state(&project);
        super::video_mcp_ripple_delete_range(&mut project, 2000, 3000, &mut state)
            .expect("ripple delete range");
        let video = clips(&project, "video");
        assert_eq!(video.len(), 2);
        assert_eq!(video[0].duration_ms, 1000);
        assert_eq!(video[1].timeline_start_ms, 2000);
        assert_eq!(video[1].duration_ms, 2000);
        assert_eq!(video[1].source_in_ms, 2500);
        let audio_total: u64 = clips(&project, "audio")
            .iter()
            .map(|clip| clip.duration_ms)
            .sum();
        assert_eq!(audio_total, 5000);
    }

    #[test]
    fn video_mcp_remove_words_two_adjacent_words_merge_into_one_ripple() {
        let mut project = project_with_clip(serde_json::json!({}));
        let mut state = edit_state(&project);
        let ranges = super::video_mcp_remove_word_spans(
            &mut project,
            "media/assets/a.mp4",
            vec![(1500, 1700), (1750, 1900)],
            &mut state,
        )
        .expect("remove word spans");
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].0, 2000);
        let total: u64 = clips(&project, "video")
            .iter()
            .map(|clip| clip.duration_ms)
            .sum();
        assert_eq!(total, 3600);
    }

    #[test]
    fn video_mcp_move_collision_slides_to_first_free_position() {
        let mut project = project_with_clip(serde_json::json!({}));
        project.tracks[0].clips.push(super::VideoMcpClip {
            id: "clip-2".to_string(),
            asset_path: "media/assets/b.mp4".to_string(),
            timeline_start_ms: 5000,
            duration_ms: 2000,
            source_in_ms: 0,
            ..super::VideoMcpClip::default()
        });
        let mut state = edit_state(&project);
        super::video_mcp_move(&mut project, "clip-2", 1500, None, &mut state).expect("move clip");
        let video = clips(&project, "video");
        assert_eq!(video[1].id, "clip-2");
        assert_eq!(video[1].timeline_start_ms, 5000);
    }

    #[test]
    fn video_mcp_add_clip_links_video_audio_and_slides_overlap() {
        let (root, media_root) = temp_video_root();
        super::video_ensure_media_dirs(&media_root).expect("media dirs");
        let rel_path = "media/assets/linked.mp4";
        let asset_abs = root.join(rel_path);
        std::fs::write(&asset_abs, b"fake mp4").expect("write fake media");
        let metadata = std::fs::metadata(&asset_abs).expect("asset metadata");
        write_probe_cache(
            &media_root,
            rel_path,
            &metadata,
            serde_json::json!({
                "durationMs": 2000,
                "width": 1280,
                "height": 720,
                "hasAudio": true,
            }),
        );

        let project = project_with_clip(serde_json::json!({}));
        let ops = vec![serde_json::json!({
            "op": "addClip",
            "assetPath": rel_path,
            "atMs": 1500,
        })];
        let (project, state) =
            super::video_mcp_apply_ops_atomically(&project, &root, &media_root, &ops, None)
                .expect("add clip");
        let video_clip = clips(&project, "video")
            .iter()
            .find(|clip| clip.asset_path == rel_path)
            .expect("inserted video clip");
        assert_eq!(video_clip.timeline_start_ms, 5000);
        assert_eq!(video_clip.duration_ms, 2000);
        assert_eq!(video_clip.source_in_ms, 0);
        assert_eq!(video_clip.gain.level, 0.0);
        assert!(!video_clip.link_id.is_empty());

        let audio_clip = clips(&project, "audio")
            .iter()
            .find(|clip| clip.asset_path == rel_path)
            .expect("linked audio clip");
        assert_eq!(audio_clip.timeline_start_ms, video_clip.timeline_start_ms);
        assert_eq!(audio_clip.duration_ms, video_clip.duration_ms);
        assert_eq!(audio_clip.source_in_ms, video_clip.source_in_ms);
        assert_eq!(audio_clip.link_id, video_clip.link_id);
        assert!(state.changed_clip_ids.contains(&video_clip.id));
        assert!(state.changed_clip_ids.contains(&audio_clip.id));
        assert!(
            state.summaries.join("; ").contains("linked audio"),
            "{:?}",
            state.summaries
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_mcp_linked_audio_partner_same_mp4_is_single_visual_layer() {
        let (root, media_root) = temp_video_root();
        super::video_ensure_media_dirs(&media_root).expect("media dirs");
        let rel_path = "media/assets/linked-render.mp4";
        let asset_abs = root.join(rel_path);
        std::fs::write(&asset_abs, b"fake mp4").expect("write fake media");
        let metadata = std::fs::metadata(&asset_abs).expect("asset metadata");
        write_probe_cache(
            &media_root,
            rel_path,
            &metadata,
            serde_json::json!({
                "durationMs": 2000,
                "width": 1280,
                "height": 720,
                "hasAudio": true,
            }),
        );

        let project = empty_project();
        let ops = vec![serde_json::json!({
            "op": "addClip",
            "assetPath": rel_path,
            "atMs": 0,
        })];
        let (mut project, _state) =
            super::video_mcp_apply_ops_atomically(&project, &root, &media_root, &ops, None)
                .expect("add linked clip");
        let video_clip_id = clips(&project, "video")[0].id.clone();
        let (track_index, clip_index) =
            super::video_mcp_find_clip_indices(&project, &video_clip_id)
                .expect("video clip indices");
        project.tracks[track_index].clips[clip_index].transform.x = 0.2;
        project.tracks[track_index].clips[clip_index]
            .transform
            .scale = 1.25;

        let project_value = super::video_mcp_project_to_value(&project).expect("project value");
        let (media_clips, _text_clips, _total_ms) =
            super::video_collect_export_clips(&root, &media_root, &project_value, None)
                .expect("collect export clips");
        let visual_layers = media_clips
            .iter()
            .filter(|clip| {
                clip.abs_path == asset_abs && matches!(clip.kind.as_str(), "video" | "image")
            })
            .collect::<Vec<_>>();
        assert_eq!(visual_layers.len(), 1);
        assert_close(visual_layers[0].x, 0.2);
        assert_close(visual_layers[0].scale, 1.25);
        assert_eq!(
            media_clips
                .iter()
                .filter(|clip| clip.abs_path == asset_abs && clip.kind == "audio")
                .count(),
            1
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_mcp_add_clip_probe_cache_miss_errors_without_ffprobe() {
        let (root, media_root) = temp_video_root();
        super::video_ensure_media_dirs(&media_root).expect("media dirs");
        let rel_path = "media/assets/missing-probe.mp4";
        let asset_abs = root.join(rel_path);
        std::fs::write(&asset_abs, b"fake mp4").expect("write fake media");

        let project = empty_project();
        let ops = vec![serde_json::json!({
            "op": "addClip",
            "assetPath": rel_path,
            "atMs": 0,
        })];
        let error = super::video_mcp_apply_ops_atomically(&project, &root, &media_root, &ops, None)
            .expect_err("probe cache miss without ffprobe must fail");
        assert!(error.contains("addClip: could not probe"), "{error}");
        assert!(error.contains("is ffmpeg installed?"), "{error}");
        assert!(clips(&project, "video").is_empty());
        assert!(clips(&project, "audio").is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_mcp_media_search_returns_cached_transcript_moment() {
        let (root, media_root) = temp_video_root();
        super::video_ensure_media_dirs(&media_root).expect("media dirs");
        let rel_path = "media/assets/search.mp4";
        let asset_abs = root.join(rel_path);
        std::fs::write(&asset_abs, b"fake mp4").expect("write fake media");
        let metadata = std::fs::metadata(&asset_abs).expect("asset metadata");
        let transcript_path = super::video_transcript_cache_path(&media_root, rel_path, &metadata)
            .expect("transcript path");
        let cache = super::VideoTranscriptCache {
            language: Some("en".to_string()),
            text: "cached transcript needle".to_string(),
            segments: vec![super::VideoTranscriptSegment {
                start_ms: 1000,
                end_ms: 2500,
                text: "A cached transcript Needle match appears here.".to_string(),
                words: Vec::new(),
            }],
        };
        super::video_write_json_cache(&transcript_path, &cache, "video transcript")
            .expect("write transcript cache");
        let manifest = super::VideoMediaManifest::default();
        let items =
            super::video_mcp_collect_media_items(&root, &media_root, &manifest, None, false);
        assert_eq!(items.len(), 1);
        assert!(items[0].has_transcript);
        let moments = super::video_mcp_media_search_moments(
            &root,
            &media_root,
            &manifest,
            &items,
            "needle",
            None,
        );
        assert_eq!(moments.len(), 1);
        assert_eq!(moments[0]["path"], rel_path);
        assert_eq!(moments[0]["momentSourceMs"][0], 1000);
        assert_eq!(moments[0]["momentSourceMs"][1], 2500);
        let excerpt = moments[0]["excerpt"].as_str().expect("excerpt");
        assert!(excerpt.to_ascii_lowercase().contains("needle"));
        assert!(excerpt.chars().count() <= 120);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_mcp_media_search_marks_inherited_transcript_moment() {
        let (root, media_root) = temp_video_root();
        super::video_ensure_media_dirs(&media_root).expect("media dirs");
        let source_path = "media/assets/source.mp4";
        let derived_path = "media/generated/upscaled.mp4";
        let source_abs = root.join(source_path);
        let derived_abs = root.join(derived_path);
        std::fs::create_dir_all(derived_abs.parent().expect("derived parent"))
            .expect("create generated dir");
        std::fs::write(&source_abs, b"source mp4").expect("write source media");
        std::fs::write(&derived_abs, b"derived mp4").expect("write derived media");
        let source_metadata = std::fs::metadata(&source_abs).expect("source metadata");
        let transcript_path =
            super::video_transcript_cache_path(&media_root, source_path, &source_metadata)
                .expect("transcript path");
        let cache = super::VideoTranscriptCache {
            language: Some("en".to_string()),
            text: "inherited needle".to_string(),
            segments: vec![super::VideoTranscriptSegment {
                start_ms: 1200,
                end_ms: 2600,
                text: "Inherited Needle timing survives the upscale.".to_string(),
                words: Vec::new(),
            }],
        };
        super::video_write_json_cache(&transcript_path, &cache, "video transcript")
            .expect("write transcript cache");
        let mut manifest = super::VideoMediaManifest::default();
        manifest.assets.insert(
            derived_path.to_string(),
            super::VideoMediaAssetManifest {
                folder_id: String::new(),
                relations: vec![super::VideoMediaRelation {
                    relation_type: "derived-from".to_string(),
                    path: source_path.to_string(),
                    via: "upscale".to_string(),
                }],
            },
        );
        let items =
            super::video_mcp_collect_media_items(&root, &media_root, &manifest, None, false);
        let moments = super::video_mcp_media_search_moments(
            &root,
            &media_root,
            &manifest,
            &items,
            "needle",
            None,
        );
        let derived = moments
            .iter()
            .find(|moment| moment["path"] == derived_path)
            .expect("derived inherited moment");
        assert_eq!(derived["inheritedFrom"], source_path);
        assert_eq!(derived["momentSourceMs"][0], 1200);
        assert_eq!(derived["momentSourceMs"][1], 2600);
        assert!(
            derived["description"]
                .as_str()
                .expect("description")
                .contains("momentSourceMs uses the asset's own timebase")
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_mcp_look_times_clamp_to_six_frames() {
        let (times, clamped) = super::video_mcp_clamp_look_times(vec![0, 1, 2, 3, 4, 5, 6, 7]);
        assert!(clamped);
        assert_eq!(times, vec![0, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn video_mcp_look_jpeg_ladder_uses_512_then_384_fallback() {
        assert_eq!(
            super::VIDEO_MCP_LOOK_JPEG_ATTEMPTS[0],
            super::VideoMcpLookJpegAttempt {
                max_width: 512,
                quality: 7,
            }
        );
        assert_eq!(super::VIDEO_MCP_LOOK_JPEG_ATTEMPTS.len(), 4);
        assert_eq!(
            super::VIDEO_MCP_LOOK_JPEG_ATTEMPTS
                .last()
                .expect("last look attempt")
                .max_width,
            384
        );
    }

    #[test]
    fn video_mcp_look_jpeg_base64_budget_is_enforced() {
        let cap = super::VIDEO_MCP_LOOK_JPEG_MAX_BASE64_BYTES;
        let under = vec![7u8; (cap / 4 * 3).saturating_sub(3)];
        let accepted = super::video_mcp_jpeg_base64_within_budget(&under, cap)
            .expect("under-budget jpeg accepted");
        assert!(accepted.1 <= cap);
        assert_eq!(accepted.0.len(), accepted.1);

        let over = vec![7u8; cap];
        assert!(super::video_mcp_jpeg_base64_within_budget(&over, cap).is_none());
    }

    #[test]
    fn video_media_import_copy_reserves_unique_destinations_concurrently() {
        let (root, media_root) = temp_video_root();
        super::video_ensure_media_dirs(&media_root).expect("media dirs");
        let source_dir = root.join("source");
        std::fs::create_dir_all(&source_dir).expect("create source dir");
        let source = source_dir.join("same.mp4");
        std::fs::write(&source, b"same media").expect("write source");
        let assets_dir = media_root.join("assets");
        std::fs::write(assets_dir.join("same.mp4"), b"existing").expect("write existing");

        let handles = (0..4)
            .map(|_| {
                let source = source.clone();
                let assets_dir = assets_dir.clone();
                std::thread::spawn(move || {
                    super::video_copy_to_unique_destination(&source, &assets_dir, "same.mp4")
                        .expect("copy to unique destination")
                })
            })
            .collect::<Vec<_>>();
        let mut destinations = handles
            .into_iter()
            .map(|handle| handle.join().expect("copy thread"))
            .collect::<Vec<_>>();
        destinations.sort();
        destinations.dedup();
        assert_eq!(destinations.len(), 4);
        assert!(assets_dir.join("same.mp4").is_file());
        assert_eq!(
            std::fs::read(assets_dir.join("same.mp4")).expect("read existing"),
            b"existing"
        );
        for destination in destinations {
            assert_eq!(
                std::fs::read(destination).expect("read imported"),
                b"same media"
            );
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_mcp_linked_split_relinks_right_halves() {
        let mut project = project_with_clip(serde_json::json!({ "linkId": "link-1" }));
        project.tracks[1].clips.push(super::VideoMcpClip {
            id: "audio-1".to_string(),
            asset_path: "media/assets/a.mp3".to_string(),
            timeline_start_ms: 1000,
            duration_ms: 4000,
            source_in_ms: 500,
            link_id: "link-1".to_string(),
            ..super::VideoMcpClip::default()
        });
        let mut state = edit_state(&project);
        super::video_mcp_split(&mut project, "clip-1", 3000, &mut state).expect("linked split");
        let video = clips(&project, "video");
        let audio = clips(&project, "audio");
        assert_eq!(video.len(), 2);
        assert_eq!(audio.len(), 2);
        assert_eq!(video[0].link_id, "link-1");
        assert_eq!(audio[0].link_id, "link-1");
        assert!(!video[1].link_id.is_empty());
        assert_eq!(video[1].link_id, audio[1].link_id);
        assert_ne!(video[1].link_id, video[0].link_id);
    }

    #[test]
    fn video_mcp_ops_atomicity_bad_second_op_leaves_project_unchanged() {
        let project = project_with_clip(serde_json::json!({}));
        let before = super::video_mcp_project_to_value(&project).expect("project to value");
        let ops = vec![
            serde_json::json!({
                "op": "setProps",
                "clipId": "clip-1",
                "patch": { "speed": 2 }
            }),
            serde_json::json!({
                "op": "split",
                "clipId": "missing",
                "atMs": 2000
            }),
        ];
        let error = super::video_mcp_apply_ops_atomically(
            &project,
            std::path::Path::new("."),
            std::path::Path::new("."),
            &ops,
            None,
        )
        .expect_err("second op should fail");
        assert!(error.starts_with("op[1] split:"), "{error}");
        let after = super::video_mcp_project_to_value(&project).expect("project to value");
        assert_eq!(before, after);
    }

    #[test]
    fn video_mcp_generate_models_returns_kling3_0() {
        let models = super::video_mcp_generate_models(Some("video"));
        assert!(
            models.iter().any(
                |model| model.get("id").and_then(serde_json::Value::as_str) == Some("kling3_0")
            )
        );
    }

    #[test]
    fn video_mcp_generate_unknown_model_lists_valid_kind_ids() {
        let error = super::video_mcp_generate_model_for_kind("video", "missing_model")
            .expect_err("unknown model must fail");
        assert!(error.contains("Unknown video generation model"), "{error}");
        assert!(error.contains("kling3_0"), "{error}");
        assert!(!error.contains("gpt_image_2"), "{error}");
    }

    #[test]
    fn video_mcp_generate_higgsfield_speak_requires_start_frame_before_job_write() {
        let (root, media_root) = temp_video_root();
        super::video_ensure_media_dirs(&media_root).expect("media dirs");
        let jobs_path = super::video_generation_jobs_path(&media_root);
        assert!(!jobs_path.exists());

        let error = super::video_mcp_prepare_generate_start_request(
            root.to_str().expect("temp root utf8"),
            &serde_json::json!({
                "action": "start",
                "kind": "video",
                "model": "higgsfield_speak",
                "prompt": "talk"
            }),
        )
        .expect_err("higgsfield_speak without start frame must fail");
        assert!(error.contains("inputAssetPaths[0]"), "{error}");
        assert!(!jobs_path.exists(), "preflight must not persist a job");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_mcp_export_draft_without_range_errors() {
        let error = super::video_mcp_export_range(&serde_json::json!({}), true)
            .expect_err("draft without range must fail");
        assert!(error.contains("requires range"), "{error}");
    }

    #[test]
    fn video_mcp_export_status_unknown_job_id_errors() {
        let job_id = format!("missing-{}", uuid::Uuid::new_v4());
        let error = super::video_mcp_export_status_value(&job_id)
            .expect_err("unknown export job must fail");
        assert!(error.contains("not found"), "{error}");
    }

    #[test]
    fn video_mcp_context_include_help_returns_non_empty_guide() {
        let guide = super::video_mcp_context_guide_value(&["help".to_string()]);
        let guide = guide.as_str().expect("guide text");
        assert!(guide.contains("Video Agent Guide"));
        assert!(guide.len() > 100);
    }
}

#[cfg(test)]
mod video_pipe_tests {
    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() <= 1e-9,
            "expected {actual} to be close to {expected}"
        );
    }

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
                            "linkId": "",
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
                            "linkId": "av-sync-1",
                            "gain": {
                                "level": 0.8,
                                "keyframes": [
                                    { "atMs": 0, "level": 0.0 },
                                    { "atMs": 900, "level": 0.75 },
                                    { "atMs": 1800, "level": 1.0 }
                                ]
                            },
                            "kf": {
                                "opacity": [
                                    { "atMs": 0, "value": 1.0, "easing": "linear" },
                                    { "atMs": 500, "value": 0.5, "easing": "hold" },
                                    { "atMs": 1000, "value": 0.75, "easing": "smooth" }
                                ],
                                "x": [
                                    { "atMs": 0, "value": 0.0, "easing": "linear" },
                                    { "atMs": 800, "value": 0.1, "easing": "hold" }
                                ],
                                "y": [
                                    { "atMs": 0, "value": 0.0, "easing": "smooth" },
                                    { "atMs": 900, "value": -0.2, "easing": "linear" }
                                ],
                                "scale": [
                                    { "atMs": 0, "value": 1.0, "easing": "linear" },
                                    { "atMs": 700, "value": 1.2, "easing": "hold" },
                                    { "atMs": 1400, "value": 0.8, "easing": "smooth" }
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
                            "linkId": "av-sync-1",
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
                            "captionGroup": "",
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
                            "captionGroup": "captions-main",
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
        assert!(pipe.contains(
            "project \"Launch \\\"Cut\\\"\\nBackslash \\\\\" 1920x1080 fps=29.97 bg=#101820"
        ));
        assert!(pipe.contains("track video \"Video Main\" locked"));
        assert!(pipe.contains("track audio \"VO Bus\" muted"));
        assert!(pipe.contains("c \"media/assets/clip one.mp4\" at=500 dur=3500 in=250 speed=1.25 gain=0.8 kf=0:0,900:0.75,1800:1 kfo=0:1,500:0.5:h,1000:0.75:s kfx=0:0,800:0.1:h kfy=0:0:s,900:-0.2 kfs=0:1,700:1.2:h,1400:0.8:s link=av-sync-1 x=0.125 y=-0.25 scale=1.333 opacity=0.875"));
        assert!(pipe.contains("t \"Hello \\\"pipe\\\"\\nLine two \\\\ ok\" at=1200 dur=2200 cap=captions-main size=63.5 color=#ffeeaa bg=#000000cc outline=#111111 outlinew=4 shadow upper x=0.25 y=0.75 align=left plain font=\"Open Sans\""));
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
        assert_eq!(parsed["tracks"][0]["clips"][0]["linkId"], "av-sync-1");
        assert_eq!(
            parsed["tracks"][0]["clips"][0]["kf"]["opacity"][1]["easing"],
            "hold"
        );
        assert_eq!(
            parsed["tracks"][0]["clips"][0]["kf"]["opacity"][2]["easing"],
            "smooth"
        );
        assert_eq!(
            parsed["tracks"][0]["clips"][0]["kf"]["x"][0]["easing"],
            "linear"
        );
        assert_eq!(parsed["tracks"][0]["clips"][0]["kf"]["y"][1]["value"], -0.2);
        assert_eq!(
            parsed["tracks"][0]["clips"][0]["kf"]["scale"][2]["value"],
            0.8
        );
        assert_eq!(
            parsed["tracks"][2]["clips"][0]["captionGroup"],
            "captions-main"
        );

        let pipe_again =
            super::video_pipe_serialize_project(&parsed).expect("serialize parsed project");
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
        assert_eq!(clip["linkId"], "");
        assert!(clip.get("kf").is_none());
        assert_eq!(clip["gain"]["level"], 1.0);
        assert_eq!(clip["gain"]["keyframes"].as_array().unwrap().len(), 0);
        assert_eq!(clip["transform"]["x"], 0.0);
        assert_eq!(clip["transform"]["y"], 0.0);
        assert_eq!(clip["transform"]["scale"], 1.0);
        assert_eq!(clip["transform"]["opacity"], 1.0);

        let style = &project["tracks"][1]["clips"][0]["style"];
        assert_eq!(project["tracks"][1]["clips"][0]["id"], "c2");
        assert_eq!(project["tracks"][1]["clips"][0]["captionGroup"], "");
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
    fn video_pipe_export_keyframes_are_absolute_and_smooth() {
        let keyframes = vec![
            super::VideoExportPropertyKeyframe {
                at_ms: 0,
                value: 0.25,
                easing: "smooth".to_string(),
            },
            super::VideoExportPropertyKeyframe {
                at_ms: 1000,
                value: 0.75,
                easing: "linear".to_string(),
            },
        ];
        let expression = super::video_property_keyframe_expression(0.9, &keyframes, 0);
        assert!(expression.contains("0.25"));
        assert!(expression.contains("0.75"));
        assert!(expression.contains("*(3-2*"));
        assert!(!expression.contains("0.9"));
    }

    #[test]
    fn video_pipe_export_animated_scale_uses_project_fit_basis() {
        let clip = super::VideoExportMediaClip {
            input_index: 0,
            kind: "image".to_string(),
            abs_path: std::path::PathBuf::from("media/assets/still.png"),
            timeline_start_ms: 0,
            duration_ms: 1000,
            source_in_ms: 0,
            speed: 1.0,
            gain_level: 1.0,
            gain_keyframes: Vec::new(),
            x: 0.5,
            y: -0.5,
            scale: 2.0,
            opacity: 0.2,
            filter_keyframe_offset_ms: 0,
            overlay_keyframe_offset_ms: 0,
            opacity_keyframes: vec![super::VideoExportPropertyKeyframe {
                at_ms: 0,
                value: 0.8,
                easing: "linear".to_string(),
            }],
            x_keyframes: vec![super::VideoExportPropertyKeyframe {
                at_ms: 0,
                value: 0.1,
                easing: "linear".to_string(),
            }],
            y_keyframes: Vec::new(),
            scale_keyframes: vec![super::VideoExportPropertyKeyframe {
                at_ms: 0,
                value: 1.0,
                easing: "linear".to_string(),
            }],
            has_audio: false,
        };
        let (filter, _, _) = super::video_build_export_filter(
            &serde_json::json!({ "settings": { "background": "#000000" } }),
            &[clip],
            &[],
            1000,
            1920,
            1080,
            30.0,
            false,
        );
        assert!(filter.contains(
            "scale=w='1920*(1)':h='1080*(1)':force_original_aspect_ratio=decrease:eval=frame"
        ));
        assert!(filter.contains("colorchannelmixer=aa='0.800000'"));
        assert!(filter.contains("overlay=x='(W-w)/2+(0.100000)*W'"));
        assert!(!filter.contains("iw*"));
        assert!(!filter.contains("colorchannelmixer=aa='0.160000'"));
        assert!(!filter.contains("(0.600000)*W"));
    }

    #[test]
    fn video_pipe_render_frame_window_seeks_late_clip() {
        let clip = super::VideoExportMediaClip {
            input_index: 0,
            kind: "video".to_string(),
            abs_path: std::path::PathBuf::from("media/assets/long.mp4"),
            timeline_start_ms: 0,
            duration_ms: 3_600_000,
            source_in_ms: 0,
            speed: 1.0,
            gain_level: 1.0,
            gain_keyframes: Vec::new(),
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            opacity: 1.0,
            filter_keyframe_offset_ms: 0,
            overlay_keyframe_offset_ms: 0,
            opacity_keyframes: Vec::new(),
            x_keyframes: Vec::new(),
            y_keyframes: Vec::new(),
            scale_keyframes: Vec::new(),
            has_audio: false,
        };
        let (clips, _texts, input_seek_ms, render_seek_ms, total_ms) =
            super::video_render_frame_window_clips(&[clip], &[], 3_000_000);
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].timeline_start_ms, 0);
        assert_eq!(clips[0].duration_ms, 2000);
        assert_eq!(clips[0].source_in_ms, 1000);
        assert_eq!(clips[0].filter_keyframe_offset_ms, -2_999_000);
        assert_eq!(clips[0].overlay_keyframe_offset_ms, -2_999_000);
        assert_eq!(input_seek_ms, vec![2_998_000]);
        assert_eq!(render_seek_ms, 1000);
        assert_eq!(total_ms, 2000);
    }

    #[test]
    fn video_pipe_range_export_rebases_gain_with_boundary_keyframe() {
        let clip = super::VideoExportMediaClip {
            input_index: 0,
            kind: "video".to_string(),
            abs_path: std::path::PathBuf::from("media/assets/gain.mp4"),
            timeline_start_ms: 0,
            duration_ms: 2000,
            source_in_ms: 0,
            speed: 1.0,
            gain_level: 1.0,
            gain_keyframes: vec![(0, 0.0), (1000, 1.0)],
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            opacity: 1.0,
            filter_keyframe_offset_ms: 0,
            overlay_keyframe_offset_ms: 0,
            opacity_keyframes: Vec::new(),
            x_keyframes: Vec::new(),
            y_keyframes: Vec::new(),
            scale_keyframes: Vec::new(),
            has_audio: true,
        };

        let (clips, texts, total_ms) =
            super::video_export_window_clips_for_range(&[clip], &[], 500, 1500)
                .expect("range window");
        assert!(texts.is_empty());
        assert_eq!(total_ms, 1000);
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].timeline_start_ms, 0);
        assert_eq!(clips[0].duration_ms, 1000);
        assert_eq!(clips[0].source_in_ms, 500);
        assert_eq!(clips[0].gain_keyframes.len(), 2);
        assert_eq!(clips[0].gain_keyframes[0].0, 0);
        assert_close(clips[0].gain_keyframes[0].1, 0.5);
        assert_eq!(clips[0].gain_keyframes[1].0, 500);
        assert_close(clips[0].gain_keyframes[1].1, 1.0);
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

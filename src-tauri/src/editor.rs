// Local-only WebM media editor backend.
//
// This module powers the Editor tab: device-local projects (never cloud-synced)
// living under <data_root>/editor-projects/<id>/, plus a pure-Rust WebM decode
// path (matroska-demuxer -> shiguredo_libvpx VP9 decode -> yuvutils I420->RGBA)
// for probing media, generating thumbnails, and producing scrub-preview frames.
//
// Export (VP9/Opus re-encode) is intentionally NOT implemented here yet — these
// commands cover Steps 1-3 (projects, import/decode, timeline + preview).
//
// This file is `include!`d into lib.rs and shares its flat crate namespace, so
// imports are limited to uniquely-named items to avoid duplicate-import clashes.

use matroska_demuxer::{Frame as MkvFrame, MatroskaFile, TrackType};
use shiguredo_libvpx::{Decoder as VpxDecoder, DecoderCodec, DecoderConfig};
use yuvutils_rs::{yuv420_to_rgba, YuvPlanarImage, YuvRange, YuvStandardMatrix};

const EDITOR_SCHEMA_VERSION: u32 = 2;
const EDITOR_THUMBNAIL_MAX_DIM: u32 = 320;
const EDITOR_MIN_CLIP_MS: u64 = 200;
const EDITOR_FRAME_CACHE_CAP: usize = 32;
const EDITOR_MEDIA_CONVERSION_EVENT: &str = "diffforge-editor-media-conversion-progress";
const EDITOR_MEDIA_CONVERSION_WS_PATH: &str = "/v1/media/convert/ws";
const EDITOR_MEDIA_CONVERSION_CHUNK_BYTES: usize = 256 * 1024;

fn editor_schema_version() -> u32 {
    EDITOR_SCHEMA_VERSION
}

fn editor_default_fps() -> f64 {
    30.0
}
fn editor_default_width() -> u32 {
    1280
}
fn editor_default_height() -> u32 {
    720
}
fn editor_default_gain() -> f64 {
    1.0
}

fn editor_default_timeline() -> Value {
    serde_json::to_value(EditorTimelineDoc::default())
        .unwrap_or_else(|_| json!({ "revision": 0, "clips": [] }))
}

/// Project-level canvas + frame-rate settings. fps drives keyboard frame-nudge
/// and (later) export timing.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorTimelineSettings {
    #[serde(default = "editor_default_width")]
    width: u32,
    #[serde(default = "editor_default_height")]
    height: u32,
    #[serde(default = "editor_default_fps")]
    fps: f64,
}

impl Default for EditorTimelineSettings {
    fn default() -> Self {
        Self {
            width: editor_default_width(),
            height: editor_default_height(),
            fps: editor_default_fps(),
        }
    }
}

/// Where a clip's pixels/samples come from. `media_ref` is project-relative
/// ("media/<file>") unless the media lives outside the project, in which case it
/// is an absolute path with `external = true`.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorClipSource {
    media_ref: String,
    #[serde(default)]
    external: bool,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    duration_ms: u64,
    #[serde(default)]
    has_audio: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorClip {
    id: String,
    track: String,
    source: EditorClipSource,
    start_ms: u64,
    in_ms: u64,
    out_ms: u64,
    #[serde(default = "editor_default_gain")]
    gain: f64,
}

/// The canonical, persisted timeline document. `revision` increments on every
/// committed mutation (drives change events / undo, no concurrency enforcement
/// in this step).
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct EditorTimelineDoc {
    #[serde(default)]
    revision: u64,
    #[serde(default)]
    settings: EditorTimelineSettings,
    #[serde(default)]
    clips: Vec<EditorClip>,
}

/// Returned by every validated write (apply_ops / save_timeline): the new
/// revision, the enriched timeline (clips carry resolved absolute paths), and any
/// non-fatal warnings.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorApplyResult {
    revision: u64,
    timeline: Value,
    warnings: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct EditorWaveform {
    peaks: Vec<f32>,
    peaks_per_second: u32,
    duration_ms: u64,
    channels: u32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorProject {
    #[serde(default = "editor_schema_version")]
    schema_version: u32,
    id: String,
    name: String,
    #[serde(default)]
    created_at_ms: u64,
    #[serde(default)]
    updated_at_ms: u64,
    #[serde(default = "editor_default_timeline")]
    timeline: Value,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorProjectSummary {
    id: String,
    name: String,
    created_at_ms: u64,
    updated_at_ms: u64,
    clip_count: u64,
    media_count: u64,
    location: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorMediaEntry {
    name: String,
    path: String,
    /// Path relative to the project's media root (forward slashes); used to
    /// navigate folders.
    rel: String,
    size: u64,
    modified_ms: u64,
    is_dir: bool,
    kind: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorMediaProbe {
    duration_ms: u64,
    width: u32,
    height: u32,
    has_video: bool,
    has_audio: bool,
    fps: f64,
    codec: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorImageData {
    data_url: String,
    width: u32,
    height: u32,
}

fn editor_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Project ids are server-generated UUIDs; reject anything that could escape the
/// editor root before it ever reaches the filesystem.
fn editor_valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn editor_projects_root() -> Result<PathBuf, String> {
    let root = cloud_mcp_local_data_file_path("editor-projects")
        .ok_or_else(|| "Unable to resolve the local data directory".to_string())?;
    fs::create_dir_all(&root).map_err(|error| format!("Unable to create editor root: {error}"))?;
    Ok(root)
}

/// Projects normally live under the managed root, but the user may choose a
/// custom directory at creation time. `index.json` in the managed root maps a
/// project id to its absolute directory so every other command can resolve a
/// project by id regardless of where it lives.
fn editor_index_path() -> Result<PathBuf, String> {
    Ok(editor_projects_root()?.join("index.json"))
}

fn editor_read_index() -> std::collections::BTreeMap<String, String> {
    let path = match editor_index_path() {
        Ok(path) => path,
        Err(_) => return std::collections::BTreeMap::new(),
    };
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn editor_write_index(index: &std::collections::BTreeMap<String, String>) -> Result<(), String> {
    let path = editor_index_path()?;
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_vec_pretty(index)
        .map_err(|error| format!("Unable to serialize project index: {error}"))?;
    fs::write(&tmp, &data).map_err(|error| format!("Unable to write project index: {error}"))?;
    fs::rename(&tmp, &path)
        .map_err(|error| format!("Unable to finalize project index: {error}"))?;
    Ok(())
}

fn editor_project_dir(id: &str) -> Result<PathBuf, String> {
    if !editor_valid_id(id) {
        return Err("Invalid project id".to_string());
    }
    if let Some(custom) = editor_read_index().get(id) {
        return Ok(PathBuf::from(custom));
    }
    Ok(editor_projects_root()?.join(id))
}

/// A filesystem-safe folder name derived from the project name, used only for the
/// initial folder created under a user-chosen location.
fn editor_safe_folder_name(name: &str) -> String {
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let safe = safe.trim().trim_matches('-').to_string();
    if safe.is_empty() {
        "project".to_string()
    } else {
        safe
    }
}

/// Every distinct project directory: registered custom locations plus a scan of
/// the managed root (for legacy/default projects), de-duplicated by path.
fn editor_all_project_dirs() -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let mut dirs = Vec::new();
    for dir in editor_read_index().into_values() {
        if seen.insert(dir.clone()) {
            dirs.push(PathBuf::from(dir));
        }
    }
    if let Ok(root) = editor_projects_root() {
        if let Ok(entries) = fs::read_dir(&root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let key = path.to_string_lossy().to_string();
                    if seen.insert(key) {
                        dirs.push(path);
                    }
                }
            }
        }
    }
    dirs
}

fn editor_read_project(dir: &Path) -> Result<EditorProject, String> {
    let path = dir.join("project.json");
    let raw =
        fs::read_to_string(&path).map_err(|error| format!("Unable to read project: {error}"))?;
    serde_json::from_str(&raw).map_err(|error| format!("Unable to parse project: {error}"))
}

fn editor_write_project(dir: &Path, project: &EditorProject) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|error| format!("Unable to create project dir: {error}"))?;
    let path = dir.join("project.json");
    let tmp = dir.join("project.json.tmp");
    let data = serde_json::to_vec_pretty(project)
        .map_err(|error| format!("Unable to serialize project: {error}"))?;
    fs::write(&tmp, &data).map_err(|error| format!("Unable to write project: {error}"))?;
    fs::rename(&tmp, &path).map_err(|error| format!("Unable to finalize project: {error}"))?;
    Ok(())
}

// --------------------------------------------------- timeline model + engine

fn editor_json_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn editor_json_u64(v: &Value, key: &str) -> u64 {
    if let Some(n) = v.get(key).and_then(|x| x.as_u64()) {
        return n;
    }
    v.get(key)
        .and_then(|x| x.as_f64())
        .map(|f| if f < 0.0 { 0 } else { f.round() as u64 })
        .unwrap_or(0)
}

fn editor_json_f64(v: &Value, key: &str, default: f64) -> f64 {
    v.get(key).and_then(|x| x.as_f64()).unwrap_or(default)
}

fn editor_json_bool(v: &Value, key: &str) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(false)
}

/// Derive a project-relative media reference. Media copied into `<dir>/media/` is
/// stored relative (portable); anything else is kept absolute + external.
fn editor_media_ref_for(media_path: &str, dir: &Path) -> (String, bool) {
    let media_dir = dir.join("media");
    if let Ok(rel) = Path::new(media_path).strip_prefix(&media_dir) {
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        (format!("media/{rel_str}"), false)
    } else {
        (media_path.to_string(), true)
    }
}

fn editor_resolve_media_path(source: &EditorClipSource, dir: &Path) -> String {
    if source.external {
        source.media_ref.clone()
    } else {
        dir.join(&source.media_ref).to_string_lossy().to_string()
    }
}

fn editor_clip_name(source: &EditorClipSource) -> String {
    Path::new(&source.media_ref)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("clip")
        .to_string()
}

/// Parse one clip from JSON, accepting both the canonical nested `source` shape
/// and the legacy/enriched flat shape (absolute `mediaPath` + top-level fields).
fn editor_clip_from_value(v: &Value, dir: &Path) -> Option<EditorClip> {
    let id = editor_json_str(v, "id")
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let track = editor_json_str(v, "track").unwrap_or_else(|| "video".to_string());
    let start_ms = editor_json_u64(v, "startMs");
    let in_ms = editor_json_u64(v, "inMs");
    let mut out_ms = editor_json_u64(v, "outMs");

    let source = if let Some(src) = v.get("source").filter(|s| s.is_object()) {
        let media_ref = editor_json_str(src, "mediaRef")?;
        EditorClipSource {
            media_ref,
            external: editor_json_bool(src, "external"),
            kind: editor_json_str(src, "kind").unwrap_or_else(|| track.clone()),
            duration_ms: editor_json_u64(src, "durationMs"),
            has_audio: editor_json_bool(src, "hasAudio"),
        }
    } else {
        let media_path = editor_json_str(v, "mediaPath")?;
        let (media_ref, external) = editor_media_ref_for(&media_path, dir);
        let duration_ms = {
            let d = editor_json_u64(v, "durationMs");
            if d > 0 {
                d
            } else {
                out_ms
            }
        };
        EditorClipSource {
            media_ref,
            external,
            kind: editor_json_str(v, "kind").unwrap_or_else(|| track.clone()),
            duration_ms,
            has_audio: editor_json_bool(v, "hasAudio"),
        }
    };

    if out_ms == 0 {
        out_ms = source.duration_ms;
    }
    Some(EditorClip {
        id,
        track,
        source,
        start_ms,
        in_ms,
        out_ms,
        gain: editor_json_f64(v, "gain", 1.0),
    })
}

/// Build the canonical, migrated doc from whatever is stored (legacy `{clips:[]}`
/// or the v2 shape).
fn editor_doc_from_value(timeline: &Value, dir: &Path) -> EditorTimelineDoc {
    let revision = editor_json_u64(timeline, "revision");
    let settings = timeline
        .get("settings")
        .and_then(|s| serde_json::from_value::<EditorTimelineSettings>(s.clone()).ok())
        .unwrap_or_default();
    let clips = timeline
        .get("clips")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| editor_clip_from_value(v, dir))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    EditorTimelineDoc {
        revision,
        settings,
        clips,
    }
}

fn editor_doc_to_value(doc: &EditorTimelineDoc) -> Value {
    serde_json::to_value(doc).unwrap_or_else(|_| json!({ "revision": doc.revision, "clips": [] }))
}

/// The frontend-facing shape: clips flattened with resolved absolute `mediaPath`
/// + display `name`, so the existing UI/decoder code keeps working unchanged.
fn editor_clip_to_enriched(clip: &EditorClip, dir: &Path) -> Value {
    json!({
        "id": clip.id,
        "track": clip.track,
        "mediaRef": clip.source.media_ref,
        "mediaPath": editor_resolve_media_path(&clip.source, dir),
        "name": editor_clip_name(&clip.source),
        "kind": clip.source.kind,
        "hasAudio": clip.source.has_audio,
        "external": clip.source.external,
        "durationMs": clip.source.duration_ms,
        "startMs": clip.start_ms,
        "inMs": clip.in_ms,
        "outMs": clip.out_ms,
        "gain": clip.gain,
    })
}

fn editor_doc_to_enriched(doc: &EditorTimelineDoc, dir: &Path) -> Value {
    json!({
        "revision": doc.revision,
        "settings": serde_json::to_value(&doc.settings).unwrap_or_else(|_| json!({})),
        "clips": doc.clips.iter().map(|c| editor_clip_to_enriched(c, dir)).collect::<Vec<_>>(),
    })
}

/// Reject structurally-impossible documents; collect non-fatal warnings (missing
/// media, overlaps, out > source duration).
fn editor_validate_doc(doc: &EditorTimelineDoc, dir: &Path) -> Result<Vec<String>, String> {
    let mut warnings = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for clip in &doc.clips {
        if !ids.insert(clip.id.clone()) {
            return Err(format!("Duplicate clip id: {}", clip.id));
        }
        if clip.track != "video" && clip.track != "audio" {
            return Err(format!("Invalid track: {}", clip.track));
        }
        if clip.in_ms >= clip.out_ms {
            return Err(format!("Clip {} has an empty or inverted range", clip.id));
        }
        if clip.out_ms - clip.in_ms < EDITOR_MIN_CLIP_MS {
            return Err(format!("Clip {} is below the minimum length", clip.id));
        }
        if clip.source.duration_ms > 0 && clip.out_ms > clip.source.duration_ms {
            warnings.push(format!(
                "Clip {} out point exceeds source duration",
                clip.id
            ));
        }
        if !Path::new(&editor_resolve_media_path(&clip.source, dir)).is_file() {
            warnings.push(format!("Missing media for clip {}", clip.id));
        }
    }
    for track in ["video", "audio"] {
        let mut ranges: Vec<(u64, u64)> = doc
            .clips
            .iter()
            .filter(|c| c.track == track)
            .map(|c| (c.start_ms, c.start_ms + c.out_ms.saturating_sub(c.in_ms)))
            .collect();
        ranges.sort_by_key(|r| r.0);
        if ranges.windows(2).any(|w| w[1].0 < w[0].1) {
            warnings.push(format!("Overlapping clips on the {track} track"));
        }
    }
    Ok(warnings)
}

fn editor_split_clip(doc: &mut EditorTimelineDoc, clip_id: &str, at_ms: u64) -> Result<(), String> {
    let idx = doc
        .clips
        .iter()
        .position(|c| c.id == clip_id)
        .ok_or_else(|| "Clip not found".to_string())?;
    let clip = doc.clips[idx].clone();
    let len = clip.out_ms.saturating_sub(clip.in_ms);
    let clip_end = clip.start_ms + len;
    if at_ms <= clip.start_ms + EDITOR_MIN_CLIP_MS
        || at_ms >= clip_end.saturating_sub(EDITOR_MIN_CLIP_MS)
    {
        return Err("Split point is too close to a clip edge".to_string());
    }
    let offset = at_ms - clip.start_ms;
    let mut left = clip.clone();
    left.out_ms = clip.in_ms + offset;
    let mut right = clip.clone();
    right.id = uuid::Uuid::new_v4().to_string();
    right.in_ms = clip.in_ms + offset;
    right.start_ms = at_ms;
    doc.clips[idx] = left;
    doc.clips.insert(idx + 1, right);
    Ok(())
}

/// Lift-delete a time range: blank [start,end) within affected clips, leaving all
/// other clip positions unchanged (no ripple).
fn editor_delete_range(doc: &mut EditorTimelineDoc, start: u64, end: u64, track: Option<&str>) {
    if end <= start {
        return;
    }
    let mut result: Vec<EditorClip> = Vec::new();
    for clip in doc.clips.drain(..) {
        let applies = track.map(|t| t == clip.track).unwrap_or(true);
        if !applies {
            result.push(clip);
            continue;
        }
        let len = clip.out_ms.saturating_sub(clip.in_ms);
        let c_start = clip.start_ms;
        let c_end = clip.start_ms + len;
        if c_end <= start || c_start >= end {
            result.push(clip);
            continue;
        }
        let left_keep = start > c_start;
        let right_keep = end < c_end;
        // Track whether the left half is actually pushed: the right half only
        // needs a fresh id when the left half kept the original one (avoids both
        // duplicate ids AND losing the original id when the left is dropped).
        let mut left_pushed = false;
        if left_keep {
            let mut l = clip.clone();
            l.out_ms = clip.in_ms + (start - c_start);
            if l.out_ms.saturating_sub(l.in_ms) >= EDITOR_MIN_CLIP_MS {
                result.push(l);
                left_pushed = true;
            }
        }
        if right_keep {
            let mut r = clip.clone();
            r.in_ms = clip.in_ms + (end - c_start);
            r.start_ms = end;
            if left_pushed {
                r.id = uuid::Uuid::new_v4().to_string();
            }
            if r.out_ms.saturating_sub(r.in_ms) >= EDITOR_MIN_CLIP_MS {
                result.push(r);
            }
        }
    }
    doc.clips = result;
}

fn editor_apply_one_op(doc: &mut EditorTimelineDoc, op: &Value, dir: &Path) -> Result<(), String> {
    let op_type = editor_json_str(op, "type").ok_or_else(|| "Op missing type".to_string())?;
    match op_type.as_str() {
        "place_clip" => {
            let media_path = editor_json_str(op, "mediaPath")
                .ok_or_else(|| "place_clip missing mediaPath".to_string())?;
            let track = editor_json_str(op, "track").unwrap_or_else(|| "video".to_string());
            let (media_ref, external) = editor_media_ref_for(&media_path, dir);
            let duration_ms = editor_json_u64(op, "durationMs");
            let in_ms = editor_json_u64(op, "inMs");
            let out_ms = {
                let o = editor_json_u64(op, "outMs");
                if o > 0 {
                    o
                } else if duration_ms > 0 {
                    duration_ms
                } else {
                    EDITOR_MIN_CLIP_MS
                }
            };
            doc.clips.push(EditorClip {
                id: editor_json_str(op, "id")
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                track: track.clone(),
                source: EditorClipSource {
                    media_ref,
                    external,
                    kind: editor_json_str(op, "kind").unwrap_or(track),
                    duration_ms,
                    has_audio: editor_json_bool(op, "hasAudio"),
                },
                start_ms: editor_json_u64(op, "startMs"),
                in_ms,
                out_ms,
                gain: editor_json_f64(op, "gain", 1.0),
            });
        }
        "move_clip" => {
            let clip_id = editor_json_str(op, "clipId")
                .ok_or_else(|| "move_clip missing clipId".to_string())?;
            let start_ms = editor_json_u64(op, "startMs");
            let track = editor_json_str(op, "track");
            if let Some(c) = doc.clips.iter_mut().find(|c| c.id == clip_id) {
                c.start_ms = start_ms;
                if let Some(t) = track {
                    if t == "video" || t == "audio" {
                        c.track = t;
                    }
                }
            }
        }
        "trim_clip" => {
            let clip_id = editor_json_str(op, "clipId")
                .ok_or_else(|| "trim_clip missing clipId".to_string())?;
            if let Some(c) = doc.clips.iter_mut().find(|c| c.id == clip_id) {
                if let Some(new_in) = op.get("inMs").and_then(|x| x.as_u64()) {
                    let max_in = c.out_ms.saturating_sub(EDITOR_MIN_CLIP_MS);
                    c.in_ms = new_in.min(max_in);
                }
                if let Some(new_out) = op.get("outMs").and_then(|x| x.as_u64()) {
                    let min_out = c.in_ms + EDITOR_MIN_CLIP_MS;
                    let cap = if c.source.duration_ms > 0 {
                        c.source.duration_ms.max(min_out)
                    } else {
                        new_out.max(min_out)
                    };
                    c.out_ms = new_out.max(min_out).min(cap);
                }
                if let Some(s) = op.get("startMs").and_then(|x| x.as_u64()) {
                    c.start_ms = s;
                }
            }
        }
        "set_gain" => {
            let clip_id = editor_json_str(op, "clipId")
                .ok_or_else(|| "set_gain missing clipId".to_string())?;
            let gain = editor_json_f64(op, "gain", 1.0).clamp(0.0, 4.0);
            if let Some(c) = doc.clips.iter_mut().find(|c| c.id == clip_id) {
                c.gain = gain;
            }
        }
        "remove_clip" => {
            let clip_id = editor_json_str(op, "clipId")
                .ok_or_else(|| "remove_clip missing clipId".to_string())?;
            doc.clips.retain(|c| c.id != clip_id);
        }
        "split_clip" => {
            let clip_id = editor_json_str(op, "clipId")
                .ok_or_else(|| "split_clip missing clipId".to_string())?;
            editor_split_clip(doc, &clip_id, editor_json_u64(op, "atMs"))?;
        }
        "delete_range" => {
            editor_delete_range(
                doc,
                editor_json_u64(op, "startMs"),
                editor_json_u64(op, "endMs"),
                editor_json_str(op, "track").as_deref(),
            );
        }
        "ripple_delete_range" => {
            let start = editor_json_u64(op, "startMs");
            let end = editor_json_u64(op, "endMs");
            let track = editor_json_str(op, "track");
            // Lift the slice, then pull everything at/after the range end leftward to
            // close the gap (the right-split remnant starts exactly at `end`, so it
            // collapses back onto the range start).
            editor_delete_range(doc, start, end, track.as_deref());
            if end > start {
                let gap = end - start;
                for clip in doc.clips.iter_mut() {
                    let applies = track.as_deref().map(|t| t == clip.track).unwrap_or(true);
                    if applies && clip.start_ms >= end {
                        clip.start_ms = clip.start_ms.saturating_sub(gap);
                    }
                }
            }
        }
        other => return Err(format!("Unknown op: {other}")),
    }
    Ok(())
}

/// Load a project + migrate its timeline; persist the migration once when the
/// stored schema is older (no `updated_at` bump for a pure migration).
fn editor_load_doc(id: &str) -> Result<(PathBuf, EditorProject, EditorTimelineDoc), String> {
    let dir = editor_project_dir(id)?;
    let mut project = editor_read_project(&dir)?;
    let original_clip_count = project
        .timeline
        .get("clips")
        .and_then(|c| c.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let doc = editor_doc_from_value(&project.timeline, &dir);
    // Persist the migration only when no clip was lost in parsing; otherwise keep
    // the original file intact (still serve the parsed doc for this session) so a
    // partially-unparseable timeline is never silently overwritten lossily.
    if project.schema_version < EDITOR_SCHEMA_VERSION && doc.clips.len() == original_clip_count {
        project.schema_version = EDITOR_SCHEMA_VERSION;
        project.timeline = editor_doc_to_value(&doc);
        let _ = editor_write_project(&dir, &project);
    }
    Ok((dir, project, doc))
}

fn editor_media_kind(name: &str) -> String {
    let lower = name.to_lowercase();
    let is_video = [".webm", ".mp4", ".mov", ".mkv", ".m4v"]
        .iter()
        .any(|ext| lower.ends_with(ext));
    let is_audio = [".opus", ".ogg", ".oga", ".wav", ".mp3", ".m4a", ".flac"]
        .iter()
        .any(|ext| lower.ends_with(ext));
    let is_image = [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif", ".svg",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext));
    if is_video {
        "video".to_string()
    } else if is_audio {
        "audio".to_string()
    } else if is_image {
        "image".to_string()
    } else {
        "other".to_string()
    }
}

fn editor_rel_path(path: &Path, media_dir: &Path) -> String {
    path.strip_prefix(media_dir)
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

fn editor_entry_for(path: &Path, media_dir: &Path, is_dir: bool) -> EditorMediaEntry {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let meta = fs::metadata(path).ok();
    let size = if is_dir {
        0
    } else {
        meta.as_ref().map(|m| m.len()).unwrap_or(0)
    };
    let modified_ms = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let kind = if is_dir {
        "folder".to_string()
    } else {
        editor_media_kind(&name)
    };
    EditorMediaEntry {
        name,
        path: path.to_string_lossy().to_string(),
        rel: editor_rel_path(path, media_dir),
        size,
        modified_ms,
        is_dir,
        kind,
    }
}

/// Resolve a media subpath safely (rejecting `..` traversal); returns the absolute
/// directory under the project's media root.
fn editor_media_subdir(media_dir: &Path, subpath: Option<&str>) -> Result<PathBuf, String> {
    let sub = subpath.map(str::trim).filter(|s| !s.is_empty());
    match sub {
        None => Ok(media_dir.to_path_buf()),
        Some(rel) => {
            let candidate = media_dir.join(rel);
            let has_parent = Path::new(rel)
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir));
            if has_parent || !candidate.starts_with(media_dir) {
                return Err("Invalid media folder".to_string());
            }
            Ok(candidate)
        }
    }
}

fn editor_count_media(dir: &Path) -> u64 {
    let media = dir.join("media");
    fs::read_dir(&media)
        .map(|rd| {
            rd.filter(|e| e.as_ref().map(|e| e.path().is_file()).unwrap_or(false))
                .count() as u64
        })
        .unwrap_or(0)
}

// ----------------------------------------------------------------- project CRUD

#[tauri::command]
fn editor_list_projects() -> Result<Vec<EditorProjectSummary>, String> {
    let mut out = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();
    for dir in editor_all_project_dirs() {
        let project = match editor_read_project(&dir) {
            Ok(project) => project,
            Err(_) => continue,
        };
        if !seen_ids.insert(project.id.clone()) {
            continue;
        }
        let clip_count = project
            .timeline
            .get("clips")
            .and_then(|clips| clips.as_array())
            .map(|clips| clips.len() as u64)
            .unwrap_or(0);
        out.push(EditorProjectSummary {
            id: project.id,
            name: project.name,
            created_at_ms: project.created_at_ms,
            updated_at_ms: project.updated_at_ms,
            clip_count,
            media_count: editor_count_media(&dir),
            location: dir.to_string_lossy().to_string(),
        });
    }
    out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    Ok(out)
}

#[tauri::command]
fn editor_create_project(name: String, location: Option<String>) -> Result<EditorProject, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Project name is required".to_string());
    }
    let id = uuid::Uuid::new_v4().to_string();

    // Default to the managed root; if the user chose a directory, scaffold a
    // readable subfolder there and remember it in the index.
    let custom = location
        .as_deref()
        .map(str::trim)
        .filter(|loc| !loc.is_empty());
    let dir = match custom {
        Some(loc) => {
            let base = PathBuf::from(loc);
            if !base.is_dir() {
                return Err("The chosen location is not a folder".to_string());
            }
            let stem = editor_safe_folder_name(&name);
            let mut target = base.join(&stem);
            if target.exists() {
                target = base.join(format!("{stem}-{}", &id[..8]));
            }
            target
        }
        None => editor_projects_root()?.join(&id),
    };

    for sub in ["media", "thumbnails", "exports"] {
        fs::create_dir_all(dir.join(sub))
            .map_err(|error| format!("Unable to scaffold project: {error}"))?;
    }
    let now = editor_now_ms();
    let project = EditorProject {
        schema_version: EDITOR_SCHEMA_VERSION,
        id: id.clone(),
        name,
        created_at_ms: now,
        updated_at_ms: now,
        timeline: editor_default_timeline(),
    };
    editor_write_project(&dir, &project)?;

    let mut index = editor_read_index();
    index.insert(id, dir.to_string_lossy().to_string());
    editor_write_index(&index)?;

    Ok(project)
}

#[tauri::command]
fn editor_get_project(id: String) -> Result<Value, String> {
    let (dir, project, doc) = editor_load_doc(&id)?;
    Ok(json!({
        "schemaVersion": project.schema_version,
        "id": project.id,
        "name": project.name,
        "createdAtMs": project.created_at_ms,
        "updatedAtMs": project.updated_at_ms,
        "timeline": editor_doc_to_enriched(&doc, &dir),
    }))
}

#[tauri::command]
fn editor_rename_project(id: String, name: String) -> Result<EditorProject, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Project name is required".to_string());
    }
    let dir = editor_project_dir(&id)?;
    let mut project = editor_read_project(&dir)?;
    project.name = name;
    project.updated_at_ms = editor_now_ms();
    editor_write_project(&dir, &project)?;
    Ok(project)
}

#[tauri::command]
fn editor_delete_project(id: String) -> Result<(), String> {
    let dir = editor_project_dir(&id)?;
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|error| format!("Unable to delete project: {error}"))?;
    }
    let mut index = editor_read_index();
    if index.remove(&id).is_some() {
        editor_write_index(&index)?;
    }
    Ok(())
}

/// Validated full-replace of the timeline (used by undo/redo restore and bulk
/// writes). Parses whatever shape it's given, validates, bumps the revision.
#[tauri::command]
fn editor_save_timeline(id: String, timeline: Value) -> Result<EditorApplyResult, String> {
    let (dir, mut project, current) = editor_load_doc(&id)?;
    let mut doc = editor_doc_from_value(&timeline, &dir);
    let warnings = editor_validate_doc(&doc, &dir)?;
    doc.revision = current.revision.wrapping_add(1);
    project.timeline = editor_doc_to_value(&doc);
    project.updated_at_ms = editor_now_ms();
    editor_write_project(&dir, &project)?;
    Ok(EditorApplyResult {
        revision: doc.revision,
        timeline: editor_doc_to_enriched(&doc, &dir),
        warnings,
    })
}

/// The authoritative mutation path: apply an ordered batch of validated ops in
/// one atomic write. The UI commits one op per gesture here; the future agent
/// uses the same entry point.
#[tauri::command]
fn editor_apply_ops(id: String, ops: Vec<Value>) -> Result<EditorApplyResult, String> {
    let (dir, mut project, mut doc) = editor_load_doc(&id)?;
    let base_revision = doc.revision;
    for op in &ops {
        editor_apply_one_op(&mut doc, op, &dir)?;
    }
    let warnings = editor_validate_doc(&doc, &dir)?;
    doc.revision = base_revision.wrapping_add(1);
    project.timeline = editor_doc_to_value(&doc);
    project.updated_at_ms = editor_now_ms();
    editor_write_project(&dir, &project)?;
    Ok(EditorApplyResult {
        revision: doc.revision,
        timeline: editor_doc_to_enriched(&doc, &dir),
        warnings,
    })
}

// ----------------------------------------------------------------------- media

#[tauri::command]
fn editor_list_media(id: String, subpath: Option<String>) -> Result<Vec<EditorMediaEntry>, String> {
    let dir = editor_project_dir(&id)?;
    let media = dir.join("media");
    if !media.is_dir() {
        return Ok(Vec::new());
    }
    let base = editor_media_subdir(&media, subpath.as_deref())?;
    if !base.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&base).map_err(|error| format!("Unable to read media: {error}"))? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        let hidden = path
            .file_name()
            .map(|n| n.to_string_lossy().starts_with('.'))
            .unwrap_or(false);
        if hidden {
            continue;
        }
        if path.is_dir() {
            out.push(editor_entry_for(&path, &media, true));
        } else if path.is_file() {
            out.push(editor_entry_for(&path, &media, false));
        }
    }
    // Folders first, then files, each alphabetical.
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

#[tauri::command]
fn editor_create_folder(
    id: String,
    subpath: Option<String>,
    name: String,
) -> Result<EditorMediaEntry, String> {
    let name = editor_safe_folder_name(&name);
    let dir = editor_project_dir(&id)?;
    let media = dir.join("media");
    let base = editor_media_subdir(&media, subpath.as_deref())?;
    fs::create_dir_all(&base).map_err(|error| format!("Unable to create media dir: {error}"))?;
    let mut target = base.join(&name);
    if target.exists() {
        target = base.join(format!("{name}-{}", editor_now_ms()));
    }
    fs::create_dir(&target).map_err(|error| format!("Unable to create folder: {error}"))?;
    Ok(editor_entry_for(&target, &media, true))
}

fn editor_import_media_blocking(
    id: &str,
    sources: &[String],
    subpath: Option<&str>,
) -> Result<Vec<EditorMediaEntry>, String> {
    let dir = editor_project_dir(id)?;
    let media = dir.join("media");
    let base = editor_media_subdir(&media, subpath)?;
    fs::create_dir_all(&base).map_err(|error| format!("Unable to create media dir: {error}"))?;
    let mut out = Vec::new();
    for src in sources {
        let src_path = PathBuf::from(src);
        if !src_path.is_file() {
            continue;
        }
        let stem = src_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("clip");
        let ext = src_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("webm");
        let safe_stem: String = stem
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '-'
                }
            })
            .collect();
        let safe_stem = if safe_stem.is_empty() {
            "clip".to_string()
        } else {
            safe_stem
        };
        let mut dest = base.join(format!("{safe_stem}.{ext}"));
        if dest.exists() {
            dest = base.join(format!("{safe_stem}-{}.{ext}", editor_now_ms()));
        }
        fs::copy(&src_path, &dest)
            .map_err(|error| format!("Unable to import {}: {error}", src_path.display()))?;
        out.push(editor_entry_for(&dest, &media, false));
    }
    Ok(out)
}

#[tauri::command]
async fn editor_import_media(
    id: String,
    sources: Vec<String>,
    subpath: Option<String>,
) -> Result<Vec<EditorMediaEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        editor_import_media_blocking(&id, &sources, subpath.as_deref())
    })
    .await
    .map_err(|error| format!("Import task failed: {error}"))?
}

fn editor_emit_media_conversion(app: &AppHandle, payload: Value) {
    let _ = app.emit(EDITOR_MEDIA_CONVERSION_EVENT, payload);
}

fn editor_emit_media_conversion_state(
    app: &AppHandle,
    job_id: &str,
    source_path: &Path,
    target_path: &Path,
    subpath: Option<&str>,
    phase: &str,
    status: &str,
    progress: Option<f64>,
    bytes: Option<u64>,
    total_bytes: Option<u64>,
    message: Option<&str>,
) {
    editor_emit_media_conversion(
        app,
        json!({
            "jobId": job_id,
            "sourcePath": source_path.to_string_lossy().to_string(),
            "targetPath": target_path.to_string_lossy().to_string(),
            "subpath": subpath,
            "phase": phase,
            "status": status,
            "progress": progress,
            "bytes": bytes,
            "totalBytes": total_bytes,
            "message": message,
        }),
    );
}

fn editor_hex_digest(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

fn editor_unique_webm_target(source: &Path) -> Result<PathBuf, String> {
    let parent = source
        .parent()
        .ok_or_else(|| "Unable to resolve MP4 parent folder.".to_string())?;
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("converted");
    let mut candidate = parent.join(format!("{stem}.webm"));
    if !candidate.exists() {
        return Ok(candidate);
    }
    for index in 2..10_000 {
        candidate = parent.join(format!("{stem}-{index}.webm"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Unable to choose an available WebM filename.".to_string())
}

fn editor_partial_webm_target(target: &Path, job_id: &str) -> PathBuf {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("converted.webm");
    let short_job = job_id.chars().take(12).collect::<String>();
    parent.join(format!("{name}.{short_job}.part"))
}

fn editor_media_conversion_error_message(value: &Value) -> String {
    value
        .get("message")
        .or_else(|| value.pointer("/error/message"))
        .and_then(Value::as_str)
        .unwrap_or("Cloud media conversion failed.")
        .to_string()
}

fn editor_media_conversion_progress(value: &Value) -> Option<f64> {
    value
        .get("progress")
        .and_then(Value::as_f64)
        .or_else(|| {
            value
                .get("percent")
                .and_then(Value::as_f64)
                .map(|value| value / 100.0)
        })
        .map(|value| value.clamp(0.0, 1.0))
}

fn editor_media_conversion_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_u64))
}

async fn editor_media_conversion_open_ws(
    state: &CloudMcpState,
) -> Result<
    (
        futures_util::stream::SplitSink<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
            Message,
        >,
        futures_util::stream::SplitStream<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
        >,
    ),
    String,
> {
    let base_url = cloud_mcp_base_url();
    let target =
        cloud_mcp_resolve_ws_target(state, &base_url, EDITOR_MEDIA_CONVERSION_WS_PATH).await?;
    let auth_bearer = cloud_mcp_authorization_bearer(state).await?;
    let device_profile = cloud_mcp_desktop_device_profile();
    let device_id = cloud_mcp_payload_text(&device_profile, &["device_id", "deviceId"])
        .unwrap_or_else(|| "desktop-primary".to_string());
    let (billing_scope_type, _team_id) = cloud_mcp_account_scope(state).await;
    let (plan_name, device_limit) = cloud_mcp_account_plan(state).await;
    let mut request = target
        .ws_url
        .as_str()
        .into_client_request()
        .map_err(|error| format!("Unable to create Cloud media conversion request: {error}"))?;
    request.headers_mut().insert(
        "sec-websocket-protocol",
        HeaderValue::from_static("diffforge.media_convert.v1"),
    );
    request.headers_mut().insert(
        "x-diffforge-client-id",
        HeaderValue::from_static(CLOUD_MCP_RUST_CLIENT_ID),
    );
    request.headers_mut().insert(
        "x-diffforge-actor",
        HeaderValue::from_static(CLOUD_MCP_RUST_CLIENT_ID),
    );
    request.headers_mut().insert(
        "user-agent",
        HeaderValue::from_static(CLOUD_MCP_DESKTOP_USER_AGENT),
    );
    request.headers_mut().insert(
        "x-diffforge-device-id",
        HeaderValue::from_str(&device_id)
            .map_err(|error| format!("Invalid Cloud MCP device id header: {error}"))?,
    );
    request.headers_mut().insert(
        "x-diffforge-billing-scope-type",
        HeaderValue::from_str(&billing_scope_type)
            .map_err(|error| format!("Invalid Cloud MCP billing scope header: {error}"))?,
    );
    request.headers_mut().insert(
        "x-diffforge-scope-type",
        HeaderValue::from_str(&billing_scope_type)
            .map_err(|error| format!("Invalid Cloud MCP scope header: {error}"))?,
    );
    request.headers_mut().insert(
        "x-diffforge-plan-name",
        HeaderValue::from_str(&plan_name)
            .map_err(|error| format!("Invalid Cloud MCP plan header: {error}"))?,
    );
    if let Some(device_limit) = device_limit {
        request.headers_mut().insert(
            "x-diffforge-device-limit",
            HeaderValue::from_str(&device_limit.to_string())
                .map_err(|error| format!("Invalid Cloud MCP device limit header: {error}"))?,
        );
    }
    cloud_mcp_apply_ws_auth_headers(
        &mut request,
        auth_bearer.as_deref(),
        target.route_token.as_deref(),
    )?;
    let (stream, _response) = connect_async(request).await.map_err(|error| {
        format!(
            "Unable to open Cloud media conversion websocket: {}",
            cloud_mcp_ws_handshake_error_text(&error)
        )
    })?;
    Ok(stream.split())
}

async fn editor_media_conversion_wait_ready<R>(read: &mut R) -> Result<(), String>
where
    R: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    while let Some(message) = read.next().await {
        match message.map_err(|error| format!("Cloud media conversion receive failed: {error}"))? {
            Message::Text(text) => {
                let value = serde_json::from_str::<Value>(text.as_str()).map_err(|error| {
                    format!("Cloud media conversion sent invalid JSON: {error}")
                })?;
                match value.get("kind").and_then(Value::as_str).unwrap_or("") {
                    "media_convert_ready" => return Ok(()),
                    "media_convert_error" => {
                        return Err(editor_media_conversion_error_message(&value))
                    }
                    _ => {}
                }
            }
            Message::Close(_) => return Err("Cloud media conversion socket closed.".to_string()),
            _ => {}
        }
    }
    Err("Cloud media conversion socket closed before it was ready.".to_string())
}

async fn editor_media_conversion_send_upload<W>(
    write: &mut W,
    app: &AppHandle,
    job_id: &str,
    source_path: &Path,
    target_path: &Path,
    subpath: Option<&str>,
    size_bytes: u64,
) -> Result<String, String>
where
    W: futures_util::Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    let mut input = tokio::fs::File::open(source_path)
        .await
        .map_err(|error| format!("Unable to open MP4 for conversion: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; EDITOR_MEDIA_CONVERSION_CHUNK_BYTES];
    let mut sent = 0u64;
    loop {
        let read = input
            .read(&mut buffer)
            .await
            .map_err(|error| format!("Unable to read MP4 for conversion: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        write
            .send(Message::Binary(buffer[..read].to_vec().into()))
            .await
            .map_err(|error| format!("Unable to upload MP4 conversion chunk: {error}"))?;
        sent = sent.saturating_add(read as u64);
        editor_emit_media_conversion_state(
            app,
            job_id,
            source_path,
            target_path,
            subpath,
            "upload",
            "running",
            Some(if size_bytes == 0 {
                0.0
            } else {
                (sent as f64 / size_bytes as f64).clamp(0.0, 1.0)
            }),
            Some(sent),
            Some(size_bytes),
            None,
        );
    }
    let sha256 = editor_hex_digest(&hasher.finalize());
    write
        .send(Message::Text(
            json!({
                "kind": "media_convert_upload_complete",
                "jobId": job_id,
                "bytes": sent,
                "sha256": sha256,
            })
            .to_string()
            .into(),
        ))
        .await
        .map_err(|error| format!("Unable to finalize MP4 conversion upload: {error}"))?;
    let _ = cloud_mcp_record_diffforge_editor_media_conversion_transfer_credit(
        job_id,
        "upload",
        sent.min(i64::MAX as u64) as i64,
    );
    Ok(sha256)
}

async fn editor_media_conversion_receive_download<R>(
    read: &mut R,
    app: &AppHandle,
    job_id: &str,
    source_path: &Path,
    target_path: &Path,
    partial_path: &Path,
    subpath: Option<&str>,
) -> Result<(), String>
where
    R: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    let mut output: Option<tokio::fs::File> = None;
    let mut expected_size: Option<u64> = None;
    let mut expected_sha256: Option<String> = None;
    let mut downloaded = 0u64;
    let mut hasher = Sha256::new();

    while let Some(message) = read.next().await {
        match message.map_err(|error| format!("Cloud media conversion receive failed: {error}"))? {
            Message::Text(text) => {
                let value = serde_json::from_str::<Value>(text.as_str()).map_err(|error| {
                    format!("Cloud media conversion sent invalid JSON: {error}")
                })?;
                match value.get("kind").and_then(Value::as_str).unwrap_or("") {
                    "media_convert_upload_complete" => {
                        editor_emit_media_conversion_state(
                            app,
                            job_id,
                            source_path,
                            target_path,
                            subpath,
                            "render",
                            "running",
                            Some(0.0),
                            None,
                            None,
                            None,
                        );
                    }
                    "media_convert_render_start" => {
                        editor_emit_media_conversion_state(
                            app,
                            job_id,
                            source_path,
                            target_path,
                            subpath,
                            "render",
                            "running",
                            Some(0.0),
                            None,
                            None,
                            None,
                        );
                    }
                    "media_convert_render_progress" => {
                        editor_emit_media_conversion_state(
                            app,
                            job_id,
                            source_path,
                            target_path,
                            subpath,
                            "render",
                            "running",
                            editor_media_conversion_progress(&value),
                            None,
                            None,
                            None,
                        );
                    }
                    "media_convert_download_start" => {
                        expected_size = editor_media_conversion_u64(
                            &value,
                            &["sizeBytes", "size_bytes", "totalBytes", "total_bytes"],
                        );
                        expected_sha256 = value
                            .get("sha256")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(str::to_string);
                        output = Some(tokio::fs::File::create(partial_path).await.map_err(
                            |error| format!("Unable to create converted WebM: {error}"),
                        )?);
                        editor_emit_media_conversion_state(
                            app,
                            job_id,
                            source_path,
                            target_path,
                            subpath,
                            "download",
                            "running",
                            Some(0.0),
                            Some(0),
                            expected_size,
                            None,
                        );
                    }
                    "media_convert_download_progress" => {
                        let bytes = editor_media_conversion_u64(&value, &["bytes"]);
                        let total = editor_media_conversion_u64(
                            &value,
                            &["totalBytes", "total_bytes", "sizeBytes", "size_bytes"],
                        )
                        .or(expected_size);
                        editor_emit_media_conversion_state(
                            app,
                            job_id,
                            source_path,
                            target_path,
                            subpath,
                            "download",
                            "running",
                            editor_media_conversion_progress(&value),
                            bytes,
                            total,
                            None,
                        );
                    }
                    "media_convert_complete" => {
                        let mut output = output.take().ok_or_else(|| {
                            "Cloud completed conversion before sending WebM bytes.".to_string()
                        })?;
                        output
                            .flush()
                            .await
                            .map_err(|error| format!("Unable to finish converted WebM: {error}"))?;
                        drop(output);
                        if let Some(expected) = expected_size {
                            if downloaded != expected {
                                return Err(format!(
                                    "Converted WebM download ended early: received {downloaded} of {expected} bytes."
                                ));
                            }
                        }
                        let actual_sha256 = editor_hex_digest(&hasher.finalize());
                        if let Some(expected) = expected_sha256.as_deref() {
                            if !actual_sha256.eq_ignore_ascii_case(expected) {
                                return Err(
                                    "Converted WebM checksum did not match the server manifest."
                                        .to_string(),
                                );
                            }
                        }
                        if target_path.exists() {
                            return Err(
                                "Target WebM path already exists; retry conversion.".to_string()
                            );
                        }
                        tokio::fs::rename(partial_path, target_path)
                            .await
                            .map_err(|error| format!("Unable to save converted WebM: {error}"))?;
                        let _ = cloud_mcp_record_diffforge_editor_media_conversion_transfer_credit(
                            job_id,
                            "download",
                            downloaded.min(i64::MAX as u64) as i64,
                        );
                        editor_emit_media_conversion(
                            app,
                            json!({
                                "jobId": job_id,
                                "sourcePath": source_path.to_string_lossy().to_string(),
                                "targetPath": target_path.to_string_lossy().to_string(),
                                "outputPath": target_path.to_string_lossy().to_string(),
                                "subpath": subpath,
                                "phase": "complete",
                                "status": "complete",
                                "progress": 1.0,
                                "bytes": downloaded,
                                "totalBytes": expected_size.unwrap_or(downloaded),
                            }),
                        );
                        return Ok(());
                    }
                    "media_convert_error" => {
                        return Err(editor_media_conversion_error_message(&value))
                    }
                    _ => {}
                }
            }
            Message::Binary(bytes) => {
                let output = output.as_mut().ok_or_else(|| {
                    "Cloud sent WebM bytes before a download manifest.".to_string()
                })?;
                output
                    .write_all(&bytes)
                    .await
                    .map_err(|error| format!("Unable to write converted WebM: {error}"))?;
                hasher.update(&bytes);
                downloaded = downloaded.saturating_add(bytes.len() as u64);
                let progress = expected_size.map(|total| {
                    if total == 0 {
                        0.0
                    } else {
                        (downloaded as f64 / total as f64).clamp(0.0, 1.0)
                    }
                });
                editor_emit_media_conversion_state(
                    app,
                    job_id,
                    source_path,
                    target_path,
                    subpath,
                    "download",
                    "running",
                    progress,
                    Some(downloaded),
                    expected_size,
                    None,
                );
            }
            Message::Close(_) => return Err("Cloud media conversion socket closed.".to_string()),
            _ => {}
        }
    }
    Err("Cloud media conversion socket closed before completion.".to_string())
}

#[tauri::command]
async fn editor_convert_mp4_to_webm(
    app: AppHandle,
    state: State<'_, CloudMcpState>,
    id: String,
    path: String,
    subpath: Option<String>,
    job_id: Option<String>,
) -> Result<EditorMediaEntry, String> {
    if !editor_valid_id(&id) {
        return Err("Invalid project id".to_string());
    }
    let dir = editor_project_dir(&id)?;
    let media_dir = dir.join("media");
    let media_root = media_dir
        .canonicalize()
        .map_err(|error| format!("Unable to resolve project media folder: {error}"))?;
    let source = PathBuf::from(&path);
    let source = source
        .canonicalize()
        .map_err(|error| format!("Unable to resolve selected MP4: {error}"))?;
    if !source.is_file() || !source.starts_with(&media_root) {
        return Err("Selected MP4 must live inside the project media folder.".to_string());
    }
    let is_mp4 = source
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("mp4"));
    if !is_mp4 {
        return Err("Only MP4 media can be converted to WebM.".to_string());
    }
    let size_bytes = tokio::fs::metadata(&source)
        .await
        .map_err(|error| format!("Unable to inspect selected MP4: {error}"))?
        .len();
    let target = editor_unique_webm_target(&source)?;
    let job_id = job_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let partial = editor_partial_webm_target(&target, &job_id);
    let subpath_ref = subpath
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    editor_emit_media_conversion_state(
        &app,
        &job_id,
        &source,
        &target,
        subpath_ref,
        "preparing",
        "running",
        Some(0.0),
        Some(0),
        Some(size_bytes),
        None,
    );

    let result = async {
        let (mut write, mut read) = editor_media_conversion_open_ws(state.inner()).await?;
        let filename = source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("input.mp4");
        write
            .send(Message::Text(
                json!({
                    "kind": "media_convert_start",
                    "jobId": job_id.clone(),
                    "filename": filename,
                    "sizeBytes": size_bytes,
                    "mimeType": "video/mp4",
                })
                .to_string()
                .into(),
            ))
            .await
            .map_err(|error| format!("Unable to start MP4 conversion upload: {error}"))?;
        editor_media_conversion_wait_ready(&mut read).await?;
        editor_emit_media_conversion_state(
            &app,
            &job_id,
            &source,
            &target,
            subpath_ref,
            "upload",
            "running",
            Some(0.0),
            Some(0),
            Some(size_bytes),
            None,
        );
        let _upload_sha = editor_media_conversion_send_upload(
            &mut write,
            &app,
            &job_id,
            &source,
            &target,
            subpath_ref,
            size_bytes,
        )
        .await?;
        editor_media_conversion_receive_download(
            &mut read,
            &app,
            &job_id,
            &source,
            &target,
            &partial,
            subpath_ref,
        )
        .await?;
        Ok::<(), String>(())
    }
    .await;

    if let Err(error) = result {
        let _ = tokio::fs::remove_file(&partial).await;
        editor_emit_media_conversion_state(
            &app,
            &job_id,
            &source,
            &target,
            subpath_ref,
            "failed",
            "failed",
            None,
            None,
            None,
            Some(&error),
        );
        return Err(error);
    }

    Ok(editor_entry_for(&target, &media_root, false))
}

// ----------------------------------------------------- generation (Phase 1 stub)

/// Phase-1 placeholder for cloud generation: produces a REAL asset in the project's
/// `media/generations/` folder so the whole UI flow (generate -> result tile ->
/// reuse/drag) is exercised end-to-end with no cloud. If a `source` image is given
/// (e.g. a chosen start frame) it is copied in as the "result"; otherwise a gradient
/// placeholder PNG is written. Phase 2 replaces this with a Rust->cloud job.
fn editor_stub_generation_blocking(
    id: &str,
    name: &str,
    source: Option<&str>,
) -> Result<EditorMediaEntry, String> {
    let dir = editor_project_dir(id)?;
    let media = dir.join("media");
    let gen = media.join("generations");
    fs::create_dir_all(&gen)
        .map_err(|error| format!("Unable to create generations folder: {error}"))?;

    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let safe = if safe.trim_matches('-').is_empty() {
        "generation".to_string()
    } else {
        safe
    };

    if let Some(src) = source {
        let src_path = PathBuf::from(src);
        if src_path.is_file() {
            let ext = src_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("png");
            let mut dest = gen.join(format!("{safe}.{ext}"));
            if dest.exists() {
                dest = gen.join(format!("{safe}-{}.{ext}", editor_now_ms()));
            }
            fs::copy(&src_path, &dest)
                .map_err(|error| format!("Unable to write result: {error}"))?;
            return Ok(editor_entry_for(&dest, &media, false));
        }
    }

    let (w, h) = (1280u32, 720u32);
    let mut img = image::RgbaImage::new(w, h);
    for (x, y, px) in img.enumerate_pixels_mut() {
        let r = (40 + x * 120 / w) as u8;
        let g = (28 + y * 90 / h) as u8;
        let b = (96 + x * 110 / w) as u8;
        *px = image::Rgba([r, g, b, 255]);
    }
    let mut dest = gen.join(format!("{safe}.png"));
    if dest.exists() {
        dest = gen.join(format!("{safe}-{}.png", editor_now_ms()));
    }
    img.save(&dest)
        .map_err(|error| format!("Unable to write placeholder: {error}"))?;
    Ok(editor_entry_for(&dest, &media, false))
}

#[tauri::command]
async fn editor_stub_generation(
    id: String,
    name: String,
    source: Option<String>,
) -> Result<EditorMediaEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        editor_stub_generation_blocking(&id, &name, source.as_deref())
    })
    .await
    .map_err(|error| format!("Generation task failed: {error}"))?
}

/// Delete a media file from the project and drop any timeline clips that
/// referenced it. Refuses to touch anything outside the project's media folder.
#[tauri::command]
fn editor_delete_media(id: String, path: String) -> Result<EditorApplyResult, String> {
    let (dir, mut project, mut doc) = editor_load_doc(&id)?;
    let media_dir = dir.join("media");
    let target = PathBuf::from(&path);
    // Reject any `..` traversal (Path::starts_with is component-based and does NOT
    // normalize parent-dir segments) AND require lexical containment in media/.
    let has_parent = target
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir));
    if has_parent || !target.starts_with(&media_dir) || target == media_dir {
        return Err("Refusing to delete media outside the project".to_string());
    }
    if target.is_dir() {
        // Folder delete: remove recursively and drop every clip that referenced
        // any media inside it.
        fs::remove_dir_all(&target).map_err(|error| format!("Unable to delete folder: {error}"))?;
        let mut prefix = editor_media_ref_for(&path, &dir).0;
        if !prefix.ends_with('/') {
            prefix.push('/');
        }
        doc.clips
            .retain(|c| !c.source.media_ref.starts_with(&prefix));
    } else {
        if target.is_file() {
            fs::remove_file(&target).map_err(|error| format!("Unable to delete media: {error}"))?;
        }
        let removed_ref = editor_media_ref_for(&path, &dir).0;
        doc.clips.retain(|c| c.source.media_ref != removed_ref);
    }
    let warnings = editor_validate_doc(&doc, &dir)?;
    doc.revision = doc.revision.wrapping_add(1);
    project.timeline = editor_doc_to_value(&doc);
    project.updated_at_ms = editor_now_ms();
    editor_write_project(&dir, &project)?;
    Ok(EditorApplyResult {
        revision: doc.revision,
        timeline: editor_doc_to_enriched(&doc, &dir),
        warnings,
    })
}

// ------------------------------------------------------------- decode pipeline

fn editor_probe_blocking(path: &str) -> Result<EditorMediaProbe, String> {
    let file =
        std::fs::File::open(path).map_err(|error| format!("Unable to open media: {error}"))?;
    let mut mkv =
        MatroskaFile::open(file).map_err(|error| format!("Unable to read WebM: {error}"))?;
    let scale = mkv.info().timestamp_scale().get();

    let mut width = 0u32;
    let mut height = 0u32;
    let mut has_video = false;
    let mut has_audio = false;
    let mut fps = 0.0f64;
    let mut codec = String::new();
    let mut video_track = 0u64;

    for track in mkv.tracks() {
        match track.track_type() {
            TrackType::Video => {
                if !has_video {
                    has_video = true;
                    codec = track.codec_id().to_string();
                    video_track = track.track_number().get();
                    if let Some(video) = track.video() {
                        width = video.pixel_width().get() as u32;
                        height = video.pixel_height().get() as u32;
                    }
                    if let Some(default_duration) = track.default_duration() {
                        let ns = default_duration.get() as f64;
                        if ns > 0.0 {
                            fps = 1_000_000_000.0 / ns;
                        }
                    }
                }
            }
            TrackType::Audio => has_audio = true,
            _ => {}
        }
    }

    let mut duration_ms = mkv
        .info()
        .duration()
        .map(|ticks| (ticks * scale as f64 / 1_000_000.0) as u64)
        .unwrap_or(0);

    if duration_ms == 0 {
        // No header duration — scan blocks for the max video timestamp.
        let mut frame = MkvFrame::default();
        let mut max_ts = 0u64;
        while mkv
            .next_frame(&mut frame)
            .map_err(|error| format!("Unable to scan WebM: {error}"))?
        {
            if frame.track == video_track && frame.timestamp > max_ts {
                max_ts = frame.timestamp;
            }
        }
        duration_ms = (max_ts as u128 * scale as u128 / 1_000_000) as u64;
    }

    Ok(EditorMediaProbe {
        duration_ms,
        width,
        height,
        has_video,
        has_audio,
        fps,
        codec,
    })
}

#[tauri::command]
async fn editor_probe_media(path: String) -> Result<EditorMediaProbe, String> {
    tauri::async_runtime::spawn_blocking(move || editor_probe_blocking(&path))
        .await
        .map_err(|error| format!("Probe task failed: {error}"))?
}

fn editor_decoded_to_rgba(
    img: &shiguredo_libvpx::DecodedFrame<'_>,
) -> Result<(Vec<u8>, u32, u32), String> {
    if img.is_high_depth() {
        return Err("10-bit video is not supported yet".to_string());
    }
    let width = img.width() as u32;
    let height = img.height() as u32;
    if width == 0 || height == 0 {
        return Err("Decoded frame had invalid dimensions".to_string());
    }
    let mut rgba = vec![0u8; (width as usize) * (height as usize) * 4];
    let planar = YuvPlanarImage {
        y_plane: img.y_plane(),
        y_stride: img.y_stride() as u32,
        u_plane: img.u_plane(),
        u_stride: img.u_stride() as u32,
        v_plane: img.v_plane(),
        v_stride: img.v_stride() as u32,
        width,
        height,
    };
    yuv420_to_rgba(
        &planar,
        &mut rgba,
        width * 4,
        YuvRange::Limited,
        YuvStandardMatrix::Bt709,
    )
    .map_err(|error| format!("YUV conversion failed: {error:?}"))?;
    Ok((rgba, width, height))
}

fn editor_open_video(path: &str) -> Result<(MatroskaFile<std::fs::File>, u64, u64), String> {
    let file =
        std::fs::File::open(path).map_err(|error| format!("Unable to open media: {error}"))?;
    let mkv = MatroskaFile::open(file).map_err(|error| format!("Unable to read WebM: {error}"))?;
    let scale = mkv.info().timestamp_scale().get();
    let video = mkv
        .tracks()
        .iter()
        .find(|track| track.track_type() == TrackType::Video)
        .ok_or_else(|| "No video track found".to_string())?;
    let codec = video.codec_id().to_string();
    if !codec.to_uppercase().contains("VP9") {
        return Err(format!(
            "Unsupported video codec: {codec} (only VP9 WebM is supported)"
        ));
    }
    let track_num = video.track_number().get();
    Ok((mkv, scale, track_num))
}

fn editor_new_vp9_decoder() -> Result<VpxDecoder, String> {
    VpxDecoder::new(DecoderConfig::new(DecoderCodec::Vp9))
        .map_err(|error| format!("Unable to create VP9 decoder: {error}"))
}

/// Decode forward from the demuxer's current position up to `target_ticks`,
/// returning the last decoded frame. VP9 decoding must start from a keyframe to
/// initialize its reference buffers, so non-keyframe frames are skipped until
/// the first keyframe is seen (unless `force_start`, used when decoding from the
/// very start of the file where the first frame is always a keyframe). Returns
/// Ok(None) when no keyframe could be established or the decoder rejects the
/// stream — the caller then falls back to decoding from the file start.
fn editor_decode_forward(
    mkv: &mut MatroskaFile<std::fs::File>,
    decoder: &mut VpxDecoder,
    track_num: u64,
    target_ticks: u64,
    force_start: bool,
) -> Result<Option<(Vec<u8>, u32, u32)>, String> {
    let mut frame = MkvFrame::default();
    let mut started = false;
    let mut reached = false;
    let mut last: Option<(Vec<u8>, u32, u32)> = None;

    while mkv
        .next_frame(&mut frame)
        .map_err(|error| format!("Unable to read frame: {error}"))?
    {
        if frame.track != track_num {
            continue;
        }
        if !started {
            if force_start || frame.is_keyframe == Some(true) {
                started = true;
            } else {
                continue;
            }
        }
        let ts = frame.timestamp;
        if decoder.decode(&frame.data).is_err() {
            // We started from a point the decoder can't use — signal a fallback.
            return Ok(None);
        }
        loop {
            match decoder
                .next_frame()
                .map_err(|error| format!("Unable to pull frame: {error}"))?
            {
                Some(img) => last = Some(editor_decoded_to_rgba(&img)?),
                None => break,
            }
        }
        if ts >= target_ticks {
            reached = true;
            break;
        }
    }

    if !started {
        return Ok(None);
    }
    if !reached {
        let _ = decoder.finish();
        loop {
            match decoder
                .next_frame()
                .map_err(|error| format!("Unable to flush frame: {error}"))?
            {
                Some(img) => last = Some(editor_decoded_to_rgba(&img)?),
                None => break,
            }
        }
    }
    Ok(last)
}

/// Decode the video frame at (or just after) `time_ms` into an RGBA buffer.
fn editor_decode_rgba_at(path: &str, time_ms: u64) -> Result<(Vec<u8>, u32, u32), String> {
    let (mut mkv, scale, track_num) = editor_open_video(path)?;
    let target_ticks: u64 = if time_ms == 0 {
        0
    } else {
        ((time_ms as u128 * 1_000_000) / scale as u128) as u64
    };

    // Fast path: jump to a keyframe a few seconds before the target, then decode
    // forward. The margin covers the recorder's ~2s keyframe interval.
    if target_ticks > 0 {
        let margin_ticks: u64 = ((3000u128 * 1_000_000) / scale as u128) as u64;
        let seek_ticks = target_ticks.saturating_sub(margin_ticks);
        if mkv.seek(seek_ticks).is_ok() {
            let mut decoder = editor_new_vp9_decoder()?;
            if let Some(result) =
                editor_decode_forward(&mut mkv, &mut decoder, track_num, target_ticks, false)?
            {
                return Ok(result);
            }
        }
    }

    // Fallback: re-open and decode from the start of the file (first frame is a
    // keyframe). Correct for any GOP length or non-SimpleBlock files.
    let (mut mkv, _scale, track_num) = editor_open_video(path)?;
    let mut decoder = editor_new_vp9_decoder()?;
    editor_decode_forward(&mut mkv, &mut decoder, track_num, target_ticks, true)?
        .ok_or_else(|| "No frame could be decoded".to_string())
}

fn editor_rgba_to_png_data_url(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    max_dim: Option<u32>,
) -> Result<EditorImageData, String> {
    use image::ImageEncoder;

    let source = image::RgbaImage::from_raw(width, height, rgba)
        .ok_or_else(|| "Invalid RGBA buffer".to_string())?;

    let (out_image, out_w, out_h) = match max_dim {
        Some(md) if md > 0 && width.max(height) > md => {
            let scale = md as f32 / width.max(height) as f32;
            let nw = ((width as f32 * scale).round() as u32).max(1);
            let nh = ((height as f32 * scale).round() as u32).max(1);
            (
                image::imageops::resize(&source, nw, nh, image::imageops::FilterType::Triangle),
                nw,
                nh,
            )
        }
        _ => (source, width, height),
    };

    let mut bytes: Vec<u8> = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut bytes);
    encoder
        .write_image(
            out_image.as_raw(),
            out_w,
            out_h,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|error| format!("PNG encode failed: {error}"))?;

    let data_url = format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(&bytes)
    );
    Ok(EditorImageData {
        data_url,
        width: out_w,
        height: out_h,
    })
}

// ---------------------------------------------------------------- frame cache

type EditorFrameCache = std::sync::Mutex<(
    u64,
    std::collections::HashMap<String, (u64, EditorImageData)>,
)>;

/// A small process-wide LRU of rendered frames keyed by (kind, path, time). Keyed
/// on the source — trims/moves/gain never invalidate it; only a different media
/// path (re-import renames on collision) produces a new key.
fn editor_frame_cache() -> &'static EditorFrameCache {
    static CACHE: std::sync::OnceLock<EditorFrameCache> = std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new((0, std::collections::HashMap::new())))
}

fn editor_frame_cache_get(key: &str) -> Option<EditorImageData> {
    let mut guard = editor_frame_cache().lock().ok()?;
    let (seq, map) = &mut *guard;
    if let Some((stamp, data)) = map.get_mut(key) {
        *seq += 1;
        *stamp = *seq;
        return Some(data.clone());
    }
    None
}

fn editor_frame_cache_put(key: String, data: EditorImageData) {
    if let Ok(mut guard) = editor_frame_cache().lock() {
        let (seq, map) = &mut *guard;
        *seq += 1;
        let stamp = *seq;
        map.insert(key, (stamp, data));
        if map.len() > EDITOR_FRAME_CACHE_CAP {
            if let Some(oldest) = map
                .iter()
                .min_by_key(|(_, (s, _))| *s)
                .map(|(k, _)| k.clone())
            {
                map.remove(&oldest);
            }
        }
    }
}

#[tauri::command]
async fn editor_thumbnail(path: String, time_ms: u64) -> Result<EditorImageData, String> {
    let key = format!("thumb|{path}|{time_ms}");
    if let Some(cached) = editor_frame_cache_get(&key) {
        return Ok(cached);
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let (rgba, width, height) = editor_decode_rgba_at(&path, time_ms)?;
        editor_rgba_to_png_data_url(rgba, width, height, Some(EDITOR_THUMBNAIL_MAX_DIM))
    })
    .await
    .map_err(|error| format!("Thumbnail task failed: {error}"))??;
    editor_frame_cache_put(key, result.clone());
    Ok(result)
}

#[tauri::command]
async fn editor_decode_frame(path: String, time_ms: u64) -> Result<EditorImageData, String> {
    let key = format!("full|{path}|{time_ms}");
    if let Some(cached) = editor_frame_cache_get(&key) {
        return Ok(cached);
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let (rgba, width, height) = editor_decode_rgba_at(&path, time_ms)?;
        editor_rgba_to_png_data_url(rgba, width, height, None)
    })
    .await
    .map_err(|error| format!("Decode task failed: {error}"))??;
    editor_frame_cache_put(key, result.clone());
    Ok(result)
}

// ------------------------------------------------------------------- waveforms

fn editor_cache_dir() -> Option<PathBuf> {
    let dir = cloud_mcp_local_data_file_path("editor-cache")?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Cache key includes mtime + size so a re-imported/overwritten file re-computes.
fn editor_waveform_cache_file(path: &str) -> Option<PathBuf> {
    let meta = fs::metadata(path).ok()?;
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    size.hash(&mut hasher);
    mtime.hash(&mut hasher);
    Some(editor_cache_dir()?.join(format!("wave-{:016x}.json", hasher.finish())))
}

/// Decode the embedded Opus audio track to 48 kHz f32 and reduce to abs-peak
/// buckets. Any failure (no audio, non-Opus, decode error) yields empty peaks so
/// the UI simply shows no waveform — it never breaks the editor.
fn editor_compute_waveform(path: &str) -> Result<EditorWaveform, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open: {e}"))?;
    let mut mkv = MatroskaFile::open(file).map_err(|e| format!("read: {e}"))?;

    let mut audio_track = 0u64;
    let mut channels = 1u32;
    let mut is_opus = false;
    for track in mkv.tracks() {
        if track.track_type() == TrackType::Audio {
            audio_track = track.track_number().get();
            if let Some(a) = track.audio() {
                channels = a.channels().get() as u32;
            }
            is_opus = track.codec_id().to_uppercase().contains("OPUS");
            break;
        }
    }
    if audio_track == 0 || !is_opus {
        return Err("no Opus audio track".to_string());
    }

    let dec_channels = channels.clamp(1, 2) as i32;
    let mut err: i32 = 0;
    let decoder = unsafe { unsafe_libopus::opus_decoder_create(48000, dec_channels, &mut err) };
    if decoder.is_null() || err != 0 {
        return Err("opus decoder create failed".to_string());
    }
    struct DecGuard(*mut unsafe_libopus::OpusDecoder);
    impl Drop for DecGuard {
        fn drop(&mut self) {
            unsafe { unsafe_libopus::opus_decoder_destroy(self.0) };
        }
    }
    let _guard = DecGuard(decoder);

    const MAX_FRAME: usize = 5760; // 120 ms @ 48 kHz
    let mut pcm = vec![0f32; MAX_FRAME * dec_channels as usize];

    let peaks_per_second: u32 = 60;
    let samples_per_bucket = (48000 / peaks_per_second).max(1) as usize;
    let mut peaks: Vec<f32> = Vec::new();
    let mut bucket_max = 0f32;
    let mut bucket_count = 0usize;
    let mut total_samples: u64 = 0;

    let mut frame = MkvFrame::default();
    while mkv
        .next_frame(&mut frame)
        .map_err(|e| format!("read frame: {e}"))?
    {
        if frame.track != audio_track {
            continue;
        }
        let decoded = unsafe {
            unsafe_libopus::opus_decode_float(
                decoder,
                frame.data.as_ptr(),
                frame.data.len() as i32,
                pcm.as_mut_ptr(),
                MAX_FRAME as i32,
                0,
            )
        };
        if decoded <= 0 {
            continue;
        }
        let decoded = decoded as usize;
        let ch = dec_channels as usize;
        for i in 0..decoded {
            let mut s = 0f32;
            for c in 0..ch {
                let v = pcm[i * ch + c].abs();
                if v > s {
                    s = v;
                }
            }
            if s > bucket_max {
                bucket_max = s;
            }
            bucket_count += 1;
            if bucket_count >= samples_per_bucket {
                peaks.push(bucket_max.min(1.0));
                bucket_max = 0.0;
                bucket_count = 0;
            }
        }
        total_samples += decoded as u64;
    }
    if bucket_count > 0 {
        peaks.push(bucket_max.min(1.0));
    }

    Ok(EditorWaveform {
        peaks,
        peaks_per_second,
        duration_ms: total_samples * 1000 / 48000,
        // Report the channel count actually decoded (clamped to 1-2), so it always
        // matches the produced peaks rather than a multichannel source header.
        channels: dec_channels as u32,
    })
}

fn editor_waveform_blocking(path: &str) -> EditorWaveform {
    let cache_file = editor_waveform_cache_file(path);
    if let Some(ref cf) = cache_file {
        if let Ok(raw) = fs::read_to_string(cf) {
            if let Ok(cached) = serde_json::from_str::<EditorWaveform>(&raw) {
                return cached;
            }
        }
    }
    let computed = editor_compute_waveform(path).unwrap_or_default();
    if let Some(ref cf) = cache_file {
        if let Ok(data) = serde_json::to_vec(&computed) {
            let _ = fs::write(cf, data);
        }
    }
    computed
}

#[tauri::command]
async fn editor_waveform(path: String) -> Result<EditorWaveform, String> {
    tauri::async_runtime::spawn_blocking(move || editor_waveform_blocking(&path))
        .await
        .map_err(|error| format!("Waveform task failed: {error}"))
}

// ----------------------------------------------------------- audio PCM (preview)

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct EditorAudioPcm {
    sample_rate: u32,
    channels: u32,
    frames: u64,
    has_audio: bool,
    /// Interleaved f32 little-endian samples, base64-encoded. Empty when the clip
    /// has no decodable Opus audio.
    data: String,
}

/// Decode a clip's embedded Opus audio to interleaved 48 kHz f32 PCM (base64) for
/// Web Audio playback. Mirrors the waveform decoder but keeps every sample. Capped
/// to a safe duration; returns empty audio on any failure so playback degrades to
/// video-only rather than erroring.
fn editor_decode_audio_pcm_compute(path: &str) -> Result<EditorAudioPcm, String> {
    const MAX_FRAMES: u64 = 48_000 * 600; // 10 minutes safety cap
    let file = std::fs::File::open(path).map_err(|e| format!("open: {e}"))?;
    let mut mkv = MatroskaFile::open(file).map_err(|e| format!("read: {e}"))?;

    let mut audio_track = 0u64;
    let mut channels = 1u32;
    let mut is_opus = false;
    for track in mkv.tracks() {
        if track.track_type() == TrackType::Audio {
            audio_track = track.track_number().get();
            if let Some(a) = track.audio() {
                channels = a.channels().get() as u32;
            }
            is_opus = track.codec_id().to_uppercase().contains("OPUS");
            break;
        }
    }
    if audio_track == 0 || !is_opus {
        return Err("no Opus audio track".to_string());
    }

    let dec_channels = channels.clamp(1, 2) as i32;
    let mut err: i32 = 0;
    let decoder = unsafe { unsafe_libopus::opus_decoder_create(48000, dec_channels, &mut err) };
    if decoder.is_null() || err != 0 {
        return Err("opus decoder create failed".to_string());
    }
    struct DecGuard(*mut unsafe_libopus::OpusDecoder);
    impl Drop for DecGuard {
        fn drop(&mut self) {
            unsafe { unsafe_libopus::opus_decoder_destroy(self.0) };
        }
    }
    let _guard = DecGuard(decoder);

    const MAX_FRAME: usize = 5760; // 120 ms @ 48 kHz
    let mut pcm = vec![0f32; MAX_FRAME * dec_channels as usize];
    let mut samples: Vec<f32> = Vec::new();
    let mut total_frames: u64 = 0;

    let mut frame = MkvFrame::default();
    while mkv
        .next_frame(&mut frame)
        .map_err(|e| format!("read frame: {e}"))?
    {
        if frame.track != audio_track {
            continue;
        }
        let decoded = unsafe {
            unsafe_libopus::opus_decode_float(
                decoder,
                frame.data.as_ptr(),
                frame.data.len() as i32,
                pcm.as_mut_ptr(),
                MAX_FRAME as i32,
                0,
            )
        };
        if decoded <= 0 {
            continue;
        }
        let decoded = decoded as usize;
        let count = decoded * dec_channels as usize;
        samples.extend_from_slice(&pcm[..count]);
        total_frames += decoded as u64;
        if total_frames >= MAX_FRAMES {
            break;
        }
    }

    let mut bytes = Vec::with_capacity(samples.len() * 4);
    for sample in &samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    Ok(EditorAudioPcm {
        sample_rate: 48000,
        channels: dec_channels as u32,
        frames: total_frames,
        has_audio: total_frames > 0,
        data: general_purpose::STANDARD.encode(&bytes),
    })
}

#[tauri::command]
async fn editor_decode_audio_pcm(path: String) -> Result<EditorAudioPcm, String> {
    tauri::async_runtime::spawn_blocking(move || {
        editor_decode_audio_pcm_compute(&path).unwrap_or_default()
    })
    .await
    .map_err(|error| format!("Audio decode task failed: {error}"))
}

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

const EDITOR_SCHEMA_VERSION: u32 = 1;
const EDITOR_THUMBNAIL_MAX_DIM: u32 = 320;

fn editor_schema_version() -> u32 {
    EDITOR_SCHEMA_VERSION
}

fn editor_default_timeline() -> Value {
    json!({ "clips": [] })
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
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorMediaEntry {
    name: String,
    path: String,
    size: u64,
    modified_ms: u64,
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
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn editor_projects_root() -> Result<PathBuf, String> {
    let root = cloud_mcp_local_data_file_path("editor-projects")
        .ok_or_else(|| "Unable to resolve the local data directory".to_string())?;
    fs::create_dir_all(&root).map_err(|error| format!("Unable to create editor root: {error}"))?;
    Ok(root)
}

fn editor_project_dir(id: &str) -> Result<PathBuf, String> {
    if !editor_valid_id(id) {
        return Err("Invalid project id".to_string());
    }
    Ok(editor_projects_root()?.join(id))
}

fn editor_read_project(dir: &Path) -> Result<EditorProject, String> {
    let path = dir.join("project.json");
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read project: {error}"))?;
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

fn editor_media_kind(name: &str) -> String {
    let lower = name.to_lowercase();
    let is_video = [".webm", ".mp4", ".mov", ".mkv", ".m4v"]
        .iter()
        .any(|ext| lower.ends_with(ext));
    let is_audio = [".opus", ".ogg", ".oga", ".wav", ".mp3", ".m4a", ".flac"]
        .iter()
        .any(|ext| lower.ends_with(ext));
    if is_video {
        "video".to_string()
    } else if is_audio {
        "audio".to_string()
    } else {
        "other".to_string()
    }
}

fn editor_entry_for(path: &Path) -> EditorMediaEntry {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let meta = fs::metadata(path).ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified_ms = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let kind = editor_media_kind(&name);
    EditorMediaEntry {
        name,
        path: path.to_string_lossy().to_string(),
        size,
        modified_ms,
        kind,
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
    let root = editor_projects_root()?;
    let mut out = Vec::new();
    let entries = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(_) => return Ok(out),
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let project = match editor_read_project(&dir) {
            Ok(project) => project,
            Err(_) => continue,
        };
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
        });
    }
    out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    Ok(out)
}

#[tauri::command]
fn editor_create_project(name: String) -> Result<EditorProject, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Project name is required".to_string());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let dir = editor_project_dir(&id)?;
    for sub in ["media", "thumbnails", "exports"] {
        fs::create_dir_all(dir.join(sub))
            .map_err(|error| format!("Unable to scaffold project: {error}"))?;
    }
    let now = editor_now_ms();
    let project = EditorProject {
        schema_version: EDITOR_SCHEMA_VERSION,
        id,
        name,
        created_at_ms: now,
        updated_at_ms: now,
        timeline: editor_default_timeline(),
    };
    editor_write_project(&dir, &project)?;
    Ok(project)
}

#[tauri::command]
fn editor_get_project(id: String) -> Result<EditorProject, String> {
    let dir = editor_project_dir(&id)?;
    editor_read_project(&dir)
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
    Ok(())
}

#[tauri::command]
fn editor_save_timeline(id: String, timeline: Value) -> Result<EditorProject, String> {
    let dir = editor_project_dir(&id)?;
    let mut project = editor_read_project(&dir)?;
    project.timeline = timeline;
    project.updated_at_ms = editor_now_ms();
    editor_write_project(&dir, &project)?;
    Ok(project)
}

// ----------------------------------------------------------------------- media

#[tauri::command]
fn editor_list_media(id: String) -> Result<Vec<EditorMediaEntry>, String> {
    let dir = editor_project_dir(&id)?;
    let media = dir.join("media");
    if !media.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&media).map_err(|error| format!("Unable to read media: {error}"))? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.is_file() && !path.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(false) {
            out.push(editor_entry_for(&path));
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

fn editor_import_media_blocking(id: &str, sources: &[String]) -> Result<Vec<EditorMediaEntry>, String> {
    let dir = editor_project_dir(id)?;
    let media = dir.join("media");
    fs::create_dir_all(&media).map_err(|error| format!("Unable to create media dir: {error}"))?;
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
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
            .collect();
        let safe_stem = if safe_stem.is_empty() { "clip".to_string() } else { safe_stem };
        let mut dest = media.join(format!("{safe_stem}.{ext}"));
        if dest.exists() {
            dest = media.join(format!("{safe_stem}-{}.{ext}", editor_now_ms()));
        }
        fs::copy(&src_path, &dest)
            .map_err(|error| format!("Unable to import {}: {error}", src_path.display()))?;
        out.push(editor_entry_for(&dest));
    }
    Ok(out)
}

#[tauri::command]
async fn editor_import_media(id: String, sources: Vec<String>) -> Result<Vec<EditorMediaEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || editor_import_media_blocking(&id, &sources))
        .await
        .map_err(|error| format!("Import task failed: {error}"))?
}

// ------------------------------------------------------------- decode pipeline

fn editor_probe_blocking(path: &str) -> Result<EditorMediaProbe, String> {
    let file = std::fs::File::open(path).map_err(|error| format!("Unable to open media: {error}"))?;
    let mut mkv = MatroskaFile::open(file).map_err(|error| format!("Unable to read WebM: {error}"))?;
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
    let file = std::fs::File::open(path).map_err(|error| format!("Unable to open media: {error}"))?;
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
        .write_image(out_image.as_raw(), out_w, out_h, image::ExtendedColorType::Rgba8)
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

#[tauri::command]
async fn editor_thumbnail(path: String, time_ms: u64) -> Result<EditorImageData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (rgba, width, height) = editor_decode_rgba_at(&path, time_ms)?;
        editor_rgba_to_png_data_url(rgba, width, height, Some(EDITOR_THUMBNAIL_MAX_DIM))
    })
    .await
    .map_err(|error| format!("Thumbnail task failed: {error}"))?
}

#[tauri::command]
async fn editor_decode_frame(path: String, time_ms: u64) -> Result<EditorImageData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (rgba, width, height) = editor_decode_rgba_at(&path, time_ms)?;
        editor_rgba_to_png_data_url(rgba, width, height, None)
    })
    .await
    .map_err(|error| format!("Decode task failed: {error}"))?
}

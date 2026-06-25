// Pure-Rust WebM export + multi-track frame compositing for the Editor tab.
//
// `include!`d into lib.rs (shares editor.rs's flat namespace + imports). Reuses the
// existing decode path (editor_open_video / editor_decode_forward / editor_decoded_to_rgba)
// and the VP9-encode + WebM-mux pattern proven in snipping.rs, adding: multi-layer
// video compositing, RGBA->I420 (yuvutils rgba_to_yuv420), an Opus encode bus
// (unsafe-libopus), and A/V interleaved muxing (webm crate add_audio_track/add_frame).
//
// Hard constraint honoured: 100% pure-Rust, statically linked, no ffmpeg/sidecars.

const EDITOR_EXPORT_EVENT: &str = "diffforge-editor-export-progress";
const EDITOR_EXPORT_NS_PER_SEC: u64 = 1_000_000_000;
const EDITOR_EXPORT_SAMPLE_RATE: u32 = 48_000;
const EDITOR_EXPORT_OPUS_FRAME: usize = 960; // 20 ms @ 48 kHz, per channel
// Opus encoder lookahead at 48 kHz (samples) — written as OpusHead pre-skip so the
// decoder trims the encoder's warm-up and audio stays in sync with video.
const EDITOR_EXPORT_OPUS_PRESKIP: u16 = 312;

/// Removes a half-written export file unless explicitly disarmed on success.
struct EditorPartialFileGuard {
    path: std::path::PathBuf,
    armed: bool,
}

impl Drop for EditorPartialFileGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Convert a timeline/source millisecond position to demuxer ticks for `scale`
/// (nanoseconds per tick). Mirrors editor_decode_rgba_at's conversion.
fn editor_ms_to_ticks(ms: u64, scale: u64) -> u64 {
    if ms == 0 || scale == 0 {
        0
    } else {
        ((ms as u128 * 1_000_000) / scale as u128) as u64
    }
}

/// A clip's playable length on the timeline (out - in), in ms.
fn editor_clip_span_ms(clip: &EditorClip) -> u64 {
    clip.out_ms.saturating_sub(clip.in_ms)
}

/// A clip's end position on the timeline, in ms.
fn editor_clip_end_ms(clip: &EditorClip) -> u64 {
    clip.start_ms.saturating_add(editor_clip_span_ms(clip))
}

fn editor_export_emit(
    app: &AppHandle,
    job_id: &str,
    phase: &str,
    status: &str,
    progress: f64,
    message: &str,
) {
    let _ = app.emit(
        EDITOR_EXPORT_EVENT,
        json!({
            "jobId": job_id,
            "phase": phase,
            "status": status,
            "progress": progress.clamp(0.0, 1.0),
            "message": message,
        }),
    );
}

/// Forward-only video frame reader for ONE clip. Source time advances monotonically
/// as the export playhead moves through the clip, so a single decoder advanced
/// forward (no per-frame re-seek) is both correct and far faster than re-opening the
/// file every output frame.
struct EditorClipVideoReader {
    path: String,
    mkv: MatroskaFile<std::fs::File>,
    scale: u64,
    track_num: u64,
    decoder: VpxDecoder,
    started: bool,
    force_start: bool,
    last: Option<(Vec<u8>, u32, u32)>,
    last_ts: u64,
    eof: bool,
    fallback_done: bool,
}

impl EditorClipVideoReader {
    fn open(path: &str, start_source_ms: u64) -> Result<Self, String> {
        let (mut mkv, scale, track_num) = editor_open_video(path)?;
        let mut force_start = true;
        if start_source_ms > 0 {
            let target = editor_ms_to_ticks(start_source_ms, scale);
            let margin = editor_ms_to_ticks(3000, scale);
            if mkv.seek(target.saturating_sub(margin)).is_ok() {
                // Seeked into the file: wait for a keyframe before decoding.
                force_start = false;
            } else {
                // Seek unsupported: reopen so we start cleanly at the file head.
                let (m2, _s2, _t2) = editor_open_video(path)?;
                mkv = m2;
            }
        }
        let decoder = editor_new_vp9_decoder()?;
        Ok(Self {
            path: path.to_string(),
            mkv,
            scale,
            track_num,
            decoder,
            started: false,
            force_start,
            last: None,
            last_ts: 0,
            eof: false,
            fallback_done: false,
        })
    }

    /// Reopen the file at its head and reset the decoder (the fallback when a seek
    /// landed without a usable keyframe before the target).
    fn reopen_from_start(&mut self) -> Result<(), String> {
        let (mkv, scale, track_num) = editor_open_video(&self.path)?;
        self.mkv = mkv;
        self.scale = scale;
        self.track_num = track_num;
        self.decoder = editor_new_vp9_decoder()?;
        self.started = false;
        self.force_start = true;
        self.eof = false;
        Ok(())
    }

    /// Decode forward to `target` ticks, updating the held frame. A single bad packet
    /// only forces a re-sync at the next keyframe (it does NOT kill the clip), and
    /// `last_ts` only advances when a frame is actually produced.
    fn decode_until(&mut self, target: u64) -> Result<(), String> {
        if self.eof {
            return Ok(());
        }
        let mut frame = MkvFrame::default();
        loop {
            let has = self
                .mkv
                .next_frame(&mut frame)
                .map_err(|e| format!("Unable to read frame: {e}"))?;
            if !has {
                self.eof = true;
                break;
            }
            if frame.track != self.track_num {
                continue;
            }
            if !self.started {
                if self.force_start || frame.is_keyframe == Some(true) {
                    self.started = true;
                } else {
                    continue;
                }
            }
            let ts = frame.timestamp;
            if self.decoder.decode(&frame.data).is_err() {
                // Lost the reference chain — wait for the next keyframe to resync.
                self.started = false;
                continue;
            }
            let mut drained = false;
            loop {
                match self
                    .decoder
                    .next_frame()
                    .map_err(|e| format!("Unable to pull frame: {e}"))?
                {
                    Some(img) => {
                        self.last = Some(editor_decoded_to_rgba(&img)?);
                        drained = true;
                    }
                    None => break,
                }
            }
            if drained {
                self.last_ts = ts;
            }
            if ts >= target {
                break;
            }
        }
        Ok(())
    }

    /// The decoded RGBA frame at (or just before) `source_ms`. Falls back to decoding
    /// from the file head once if a seek-based start never produced a frame (so an
    /// imported clip whose seek missed its keyframes still renders instead of going
    /// black).
    fn frame_at(&mut self, source_ms: u64) -> Result<Option<(Vec<u8>, u32, u32)>, String> {
        let target = editor_ms_to_ticks(source_ms, self.scale);
        if self.last.is_some() && target <= self.last_ts {
            return Ok(self.last.clone());
        }
        self.decode_until(target)?;
        if self.last.is_none() && !self.fallback_done {
            self.fallback_done = true;
            self.reopen_from_start()?;
            self.decode_until(target)?;
        }
        Ok(self.last.clone())
    }
}

/// Alpha-composite `src` (its own w/h) onto `canvas` (cw x ch), scaled to fit
/// ("contain") and centered. Opaque sources fully cover the area they occupy.
fn editor_blit_contain(canvas: &mut image::RgbaImage, src_rgba: &[u8], sw: u32, sh: u32) {
    if sw == 0 || sh == 0 {
        return;
    }
    let src = match image::RgbaImage::from_raw(sw, sh, src_rgba.to_vec()) {
        Some(img) => img,
        None => return,
    };
    let cw = canvas.width();
    let ch = canvas.height();
    let scale = (cw as f32 / sw as f32).min(ch as f32 / sh as f32);
    let nw = ((sw as f32 * scale).round() as u32).max(1).min(cw);
    let nh = ((sh as f32 * scale).round() as u32).max(1).min(ch);
    let resized = if nw == sw && nh == sh {
        src
    } else {
        image::imageops::resize(&src, nw, nh, image::imageops::FilterType::Triangle)
    };
    let ox = ((cw - nw) / 2) as i64;
    let oy = ((ch - nh) / 2) as i64;
    image::imageops::overlay(canvas, &resized, ox, oy);
}

/// Composite an ordered list of RGBA layers (BOTTOM-first) onto an opaque black
/// canvas of `cw x ch`, returning packed RGBA.
fn editor_composite_layers(
    layers: &[(Vec<u8>, u32, u32)],
    cw: u32,
    ch: u32,
) -> Vec<u8> {
    let mut canvas = image::RgbaImage::from_pixel(cw, ch, image::Rgba([0, 0, 0, 255]));
    for (rgba, sw, sh) in layers {
        editor_blit_contain(&mut canvas, rgba, *sw, *sh);
    }
    canvas.into_raw()
}

/// Decode a clip's embedded Opus audio to interleaved 48 kHz f32 PCM (raw samples +
/// channel count). The export-side sibling of editor_decode_audio_pcm_compute.
fn editor_decode_audio_samples(path: &str) -> Result<(Vec<f32>, u32), String> {
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
        let count = decoded as usize * dec_channels as usize;
        samples.extend_from_slice(&pcm[..count]);
    }
    Ok((samples, dec_channels as u32))
}

/// Mix every audio-contributing clip (audio tracks + video-with-audio, honouring
/// per-track mute/gain x per-clip gain) into a single interleaved stereo 48 kHz bus
/// spanning [0, total_ms].
fn editor_export_mix_audio(
    doc: &EditorTimelineDoc,
    dir: &Path,
    total_ms: u64,
) -> Vec<f32> {
    let total_samples = ((total_ms as u128 * EDITOR_EXPORT_SAMPLE_RATE as u128) / 1000) as usize;
    let mut bus = vec![0f32; total_samples * 2];
    if total_samples == 0 {
        return bus;
    }
    for clip in &doc.clips {
        let track = match doc.tracks.iter().find(|t| t.id == clip.track) {
            Some(t) => t,
            None => continue,
        };
        let contributes = track.kind == "audio" || (track.kind == "video" && clip.source.has_audio);
        if !contributes || track.muted {
            continue;
        }
        let path = editor_resolve_media_path(&clip.source, dir);
        let (samples, ch) = match editor_decode_audio_samples(&path) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if samples.is_empty() || ch == 0 {
            continue;
        }
        let gain = (clip.gain * track.gain) as f32;
        let in_sample = (clip.in_ms as u128 * EDITOR_EXPORT_SAMPLE_RATE as u128 / 1000) as usize;
        let span_samples =
            (editor_clip_span_ms(clip) as u128 * EDITOR_EXPORT_SAMPLE_RATE as u128 / 1000) as usize;
        let start_sample =
            (clip.start_ms as u128 * EDITOR_EXPORT_SAMPLE_RATE as u128 / 1000) as usize;
        let src_frames = samples.len() / ch as usize;
        for k in 0..span_samples {
            let dst = start_sample + k;
            if dst >= total_samples {
                break;
            }
            let src = in_sample + k;
            if src >= src_frames {
                break;
            }
            let (l, r) = if ch >= 2 {
                (samples[src * ch as usize], samples[src * ch as usize + 1])
            } else {
                let m = samples[src];
                (m, m)
            };
            bus[dst * 2] += l * gain;
            bus[dst * 2 + 1] += r * gain;
        }
    }
    // Guard against inter-track summation clipping.
    for s in bus.iter_mut() {
        *s = s.clamp(-1.0, 1.0);
    }
    bus
}

/// Encode the stereo mix bus to Opus packets: (timestamp_ns, packet_bytes).
fn editor_export_encode_audio(bus: &[f32]) -> Result<Vec<(u64, Vec<u8>)>, String> {
    let mut enc_err: i32 = 0;
    let enc = unsafe {
        unsafe_libopus::opus_encoder_create(
            48000,
            2,
            unsafe_libopus::OPUS_APPLICATION_AUDIO,
            &mut enc_err,
        )
    };
    if enc.is_null() || enc_err != 0 {
        return Err("opus encoder create failed".to_string());
    }
    struct EncGuard(*mut unsafe_libopus::OpusEncoder);
    impl Drop for EncGuard {
        fn drop(&mut self) {
            unsafe { unsafe_libopus::opus_encoder_destroy(self.0) };
        }
    }
    let _guard = EncGuard(enc);

    let frame_vals = EDITOR_EXPORT_OPUS_FRAME * 2; // interleaved stereo per packet
    let frames = bus.len().div_ceil(frame_vals);
    let mut out = vec![0u8; 4000];
    let mut packets: Vec<(u64, Vec<u8>)> = Vec::with_capacity(frames);
    let mut input = vec![0f32; frame_vals];
    for fi in 0..frames {
        let start = fi * frame_vals;
        let avail = bus.len().saturating_sub(start).min(frame_vals);
        for v in input.iter_mut() {
            *v = 0.0;
        }
        input[..avail].copy_from_slice(&bus[start..start + avail]);
        let n = unsafe {
            unsafe_libopus::opus_encode_float(
                enc,
                input.as_ptr(),
                EDITOR_EXPORT_OPUS_FRAME as i32,
                out.as_mut_ptr(),
                out.len() as i32,
            )
        };
        if n < 0 {
            return Err(format!("opus encode failed ({n})"));
        }
        let ts = fi as u64 * 20 * 1_000_000; // 20 ms in ns
        packets.push((ts, out[..n as usize].to_vec()));
    }
    Ok(packets)
}

fn editor_opus_codec_private() -> Vec<u8> {
    let mut head = Vec::with_capacity(19);
    head.extend_from_slice(b"OpusHead");
    head.push(1); // version
    head.push(2); // channel count (stereo bus)
    head.extend_from_slice(&EDITOR_EXPORT_OPUS_PRESKIP.to_le_bytes()); // pre-skip
    head.extend_from_slice(&48_000u32.to_le_bytes()); // input sample rate
    head.extend_from_slice(&0i16.to_le_bytes()); // output gain
    head.push(0); // channel mapping family
    head
}

fn editor_export_vp9_config(
    width: u32,
    height: u32,
    fps: u32,
) -> Result<shiguredo_libvpx::EncoderConfig, String> {
    let w = usize::try_from(width).map_err(|_| "Export width too large".to_string())?;
    let h = usize::try_from(height).map_err(|_| "Export height too large".to_string())?;
    let fps = fps.max(1);
    let threads = std::thread::available_parallelism()
        .ok()
        .and_then(|t| std::num::NonZeroUsize::new(t.get().min(8)));
    let mut vp9 = shiguredo_libvpx::Vp9Config::default();
    vp9.row_mt = true;
    let mut config = shiguredo_libvpx::EncoderConfig::new(
        w,
        h,
        shiguredo_libvpx::ImageFormat::I420,
        shiguredo_libvpx::CodecConfig::Vp9(vp9),
    );
    config.fps_numerator = fps as usize;
    config.fps_denominator = 1;
    // ~0.1 bits/pixel/frame, clamped to a sane band.
    let bitrate = ((w as f64 * h as f64 * fps as f64) * 0.1)
        .clamp(500_000.0, 20_000_000.0) as usize;
    config.target_bitrate = bitrate;
    config.deadline = shiguredo_libvpx::EncodingDeadline::Good;
    config.rate_control = shiguredo_libvpx::RateControlMode::Vbr;
    config.cpu_used = Some(3);
    config.threads = threads;
    config.keyframe_interval =
        std::num::NonZeroUsize::new(usize::try_from(fps.saturating_mul(2)).unwrap_or(60));
    Ok(config)
}

/// RGBA -> tightly-packed I420 (requires even dimensions, which the caller guarantees).
fn editor_rgba_to_i420(rgba: &[u8], w: u32, h: u32) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), String> {
    let mut yuv = yuvutils_rs::YuvPlanarImageMut::<u8>::alloc(
        w,
        h,
        yuvutils_rs::YuvChromaSubsampling::Yuv420,
    );
    yuvutils_rs::rgba_to_yuv420(
        &mut yuv,
        rgba,
        w * 4,
        YuvRange::Limited,
        YuvStandardMatrix::Bt709,
        yuvutils_rs::YuvConversionMode::Balanced,
    )
    .map_err(|e| format!("RGBA->YUV failed: {e:?}"))?;
    Ok((
        yuv.y_plane.borrow().to_vec(),
        yuv.u_plane.borrow().to_vec(),
        yuv.v_plane.borrow().to_vec(),
    ))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorExportResult {
    path: String,
    name: String,
    duration_ms: u64,
    width: u32,
    height: u32,
}

/// Render the whole timeline to a WebM (VP9 + Opus) on disk. Composites all video
/// tracks (z-order: earlier track = on top) per frame, mixes all audio tracks, and
/// muxes A/V interleaved. Emits EDITOR_EXPORT_EVENT progress.
fn editor_export_compute(
    app: &AppHandle,
    id: &str,
    job_id: &str,
    options: &Value,
) -> Result<EditorExportResult, String> {
    use std::io::Write;

    let (dir, project, doc) = editor_load_doc(id)?;
    if doc.clips.is_empty() {
        return Err("Timeline is empty — nothing to export.".to_string());
    }

    // Output canvas + fps (settings, overridable; even dims required for I420).
    let opt_u32 = |k: &str, d: u32| -> u32 {
        options.get(k).and_then(|v| v.as_u64()).map(|v| v as u32).filter(|v| *v > 0).unwrap_or(d)
    };
    let mut width = opt_u32("width", doc.settings.width.max(2));
    let mut height = opt_u32("height", doc.settings.height.max(2));
    width &= !1;
    height &= !1;
    width = width.max(2);
    height = height.max(2);
    let fps = options
        .get("fps")
        .and_then(|v| v.as_f64())
        .filter(|v| *v > 0.0)
        .unwrap_or(doc.settings.fps)
        .clamp(1.0, 120.0)
        .round() as u32;

    let total_ms = doc.clips.iter().map(editor_clip_end_ms).max().unwrap_or(0);
    if total_ms == 0 {
        return Err("Timeline has no duration.".to_string());
    }

    let has_video = doc
        .clips
        .iter()
        .any(|c| doc.tracks.iter().any(|t| t.id == c.track && t.kind == "video"));

    editor_export_emit(app, job_id, "preparing", "running", 0.0, "Preparing export…");

    // ---- audio (decode + mix + Opus) ----
    editor_export_emit(app, job_id, "audio", "running", 0.02, "Mixing audio…");
    let bus = editor_export_mix_audio(&doc, &dir, total_ms);
    let has_audio = bus.iter().any(|s| *s != 0.0);
    let audio_packets = if has_audio {
        editor_export_encode_audio(&bus)?
    } else {
        Vec::new()
    };
    drop(bus);

    // ---- output file + muxer ----
    let exports_dir = dir.join("exports");
    std::fs::create_dir_all(&exports_dir)
        .map_err(|e| format!("Unable to create exports folder: {e}"))?;
    let file_name = format!("export-{}.webm", editor_now_ms());
    let out_path = exports_dir.join(&file_name);
    let file = std::fs::File::create(&out_path)
        .map_err(|e| format!("Unable to create export file: {e}"))?;
    // Remove the half-written file on ANY early return (decode/encode/mux error or
    // panic); disarmed only after a successful finalize + flush.
    let mut partial_guard = EditorPartialFileGuard {
        path: out_path.clone(),
        armed: true,
    };
    let writer = webm::mux::Writer::new(std::io::BufWriter::new(file));
    let builder = webm::mux::SegmentBuilder::new(writer)
        .map_err(|e| format!("WebM init failed: {e:?}"))?
        .set_writing_app("Diff Forge")
        .map_err(|e| format!("WebM init failed: {e:?}"))?
        .set_mode(webm::mux::SegmentMode::File)
        .map_err(|e| format!("WebM init failed: {e:?}"))?;
    let (builder, video_track) = if has_video {
        let (b, vt) = builder
            .add_video_track(width, height, webm::mux::VideoCodecId::VP9, None)
            .map_err(|e| format!("WebM video track failed: {e:?}"))?;
        (b, Some(vt))
    } else {
        (builder, None)
    };
    let (builder, audio_track) = if !audio_packets.is_empty() {
        let (b, at) = builder
            .add_audio_track(48_000, 2, webm::mux::AudioCodecId::Opus, None)
            .map_err(|e| format!("WebM audio track failed: {e:?}"))?;
        let b = b
            .set_codec_private(at, &editor_opus_codec_private())
            .map_err(|e| format!("WebM Opus header failed: {e:?}"))?;
        (b, Some(at))
    } else {
        (builder, None)
    };
    let mut segment = builder.build();

    // Audio cursor: flushed up to each video frame's pts so output stays ordered.
    let mut audio_cursor = 0usize;
    let mut flush_audio_until = |segment: &mut webm::mux::Segment<std::io::BufWriter<std::fs::File>>,
                                 until_ns: u64|
     -> Result<(), String> {
        if let Some(at) = audio_track {
            while audio_cursor < audio_packets.len() && audio_packets[audio_cursor].0 <= until_ns {
                let (ts, data) = &audio_packets[audio_cursor];
                segment
                    .add_frame(at, data, *ts, true)
                    .map_err(|e| format!("WebM audio write failed: {e:?}"))?;
                audio_cursor += 1;
            }
        }
        Ok(())
    };

    // ---- video (composite + VP9 encode + interleaved mux) ----
    if let Some(vt) = video_track {
        let mut encoder = shiguredo_libvpx::Encoder::new(editor_export_vp9_config(width, height, fps)?)
            .map_err(|e| format!("VP9 encoder init failed: {e}"))?;
        let total_frames = ((total_ms as u128 * fps as u128) / 1000).max(1) as u64;
        let progress_step = (total_frames / 100).max(1);
        let mut readers: std::collections::HashMap<String, EditorClipVideoReader> =
            std::collections::HashMap::new();
        let mut pending_pts: std::collections::VecDeque<u64> = std::collections::VecDeque::new();
        let mut emitted = 0u64;

        // Video track ids ordered BOTTOM-first for compositing (doc order: top-first).
        let video_track_ids: Vec<String> = doc
            .tracks
            .iter()
            .filter(|t| t.kind == "video")
            .map(|t| t.id.clone())
            .rev()
            .collect();

        for frame_index in 0..total_frames {
            let t_ms = (frame_index as u128 * 1000 / fps as u128) as u64;

            // Build composite layers bottom-first.
            let mut layers: Vec<(Vec<u8>, u32, u32)> = Vec::new();
            for track_id in &video_track_ids {
                // Topmost clip covering t on this track (latest start wins).
                let clip = doc
                    .clips
                    .iter()
                    .filter(|c| {
                        &c.track == track_id
                            && c.start_ms <= t_ms
                            && t_ms < editor_clip_end_ms(c)
                    })
                    .max_by_key(|c| c.start_ms);
                if let Some(clip) = clip {
                    let source_ms = clip.in_ms + (t_ms - clip.start_ms);
                    let reader = match readers.get_mut(&clip.id) {
                        Some(r) => r,
                        None => {
                            let path = editor_resolve_media_path(&clip.source, &dir);
                            let r = EditorClipVideoReader::open(&path, clip.in_ms)?;
                            readers.insert(clip.id.clone(), r);
                            readers.get_mut(&clip.id).unwrap()
                        }
                    };
                    if let Some((rgba, w, h)) = reader.frame_at(source_ms)? {
                        layers.push((rgba, w, h));
                    }
                }
            }

            let composed = editor_composite_layers(&layers, width, height);
            let (y, u, v) = editor_rgba_to_i420(&composed, width, height)?;
            let image = shiguredo_libvpx::ImageData::I420 {
                y: &y,
                u: &u,
                v: &v,
            };
            let force_keyframe = frame_index == 0;
            let pts = (frame_index as u128 * EDITOR_EXPORT_NS_PER_SEC as u128 / fps as u128) as u64;
            pending_pts.push_back(pts);
            encoder
                .encode(&image, &shiguredo_libvpx::EncodeOptions { force_keyframe })
                .map_err(|e| format!("VP9 encode failed: {e}"))?;
            while let Some(frame) = encoder.next_frame() {
                let frame_pts = pending_pts
                    .pop_front()
                    .ok_or_else(|| "VP9 produced an unexpected frame".to_string())?;
                flush_audio_until(&mut segment, frame_pts)?;
                segment
                    .add_frame(vt, frame.data(), frame_pts, frame.is_keyframe())
                    .map_err(|e| format!("WebM video write failed: {e:?}"))?;
            }

            // Drop readers for clips that have ended to bound memory.
            readers.retain(|cid, _| {
                doc.clips
                    .iter()
                    .any(|c| &c.id == cid && t_ms < editor_clip_end_ms(c))
            });

            if frame_index / progress_step > emitted {
                emitted = frame_index / progress_step;
                let progress = 0.05 + 0.9 * (frame_index as f64 / total_frames as f64);
                editor_export_emit(
                    app,
                    job_id,
                    "video",
                    "running",
                    progress,
                    &format!("Encoding frame {} / {}", frame_index + 1, total_frames),
                );
            }
        }

        // Flush the encoder's remaining frames.
        encoder
            .finish()
            .map_err(|e| format!("VP9 flush failed: {e}"))?;
        while let Some(frame) = encoder.next_frame() {
            let frame_pts = pending_pts
                .pop_front()
                .ok_or_else(|| "VP9 produced an unexpected frame".to_string())?;
            flush_audio_until(&mut segment, frame_pts)?;
            segment
                .add_frame(vt, frame.data(), frame_pts, frame.is_keyframe())
                .map_err(|e| format!("WebM video write failed: {e:?}"))?;
        }
    }

    // Flush any remaining audio packets.
    editor_export_emit(app, job_id, "muxing", "running", 0.97, "Finalizing…");
    flush_audio_until(&mut segment, u64::MAX)?;

    let writer = match segment.finalize(Some(total_ms.max(1))) {
        Ok(writer) => writer,
        Err(writer) => {
            drop(writer);
            let _ = std::fs::remove_file(&out_path);
            return Err("Unable to finalize export.".to_string());
        }
    };
    let mut writer = writer.into_inner();
    writer
        .flush()
        .map_err(|e| format!("Unable to flush export file: {e}"))?;
    drop(writer);

    partial_guard.armed = false; // success: keep the file
    let _ = project; // (project metadata not modified by export)
    editor_export_emit(app, job_id, "done", "done", 1.0, "Export complete.");
    Ok(EditorExportResult {
        path: out_path.to_string_lossy().to_string(),
        name: file_name,
        duration_ms: total_ms,
        width,
        height,
    })
}

#[tauri::command]
async fn editor_export_timeline(
    app: AppHandle,
    id: String,
    job_id: String,
    options: Value,
) -> Result<EditorExportResult, String> {
    let app_for_task = app.clone();
    let job_for_task = job_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        editor_export_compute(&app_for_task, &id, &job_for_task, &options)
    })
    .await
    .map_err(|e| format!("Export task failed: {e}"))?;
    if let Err(message) = &result {
        editor_export_emit(&app, &job_id, "error", "failed", 0.0, message);
    }
    result
}

/// Composite multiple video layers into ONE preview PNG (used only when 2+ video
/// tracks overlap at the playhead; the single-layer case keeps using
/// editor_decode_frame). `layers` are {path, timeMs} ordered BOTTOM-first.
#[tauri::command]
async fn editor_decode_composite_frame(
    layers: Vec<Value>,
    width: u32,
    height: u32,
) -> Result<EditorImageData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cw = (width.max(2)) & !1;
        let ch = (height.max(2)) & !1;
        let mut decoded: Vec<(Vec<u8>, u32, u32)> = Vec::new();
        for layer in &layers {
            let path = match editor_json_str(layer, "path") {
                Some(p) => p,
                None => continue,
            };
            let time_ms = editor_json_u64(layer, "timeMs");
            if let Ok((rgba, w, h)) = editor_decode_rgba_at(&path, time_ms) {
                decoded.push((rgba, w, h));
            }
        }
        if decoded.is_empty() {
            return Err("No layers could be decoded".to_string());
        }
        let composed = editor_composite_layers(&decoded, cw, ch);
        editor_rgba_to_png_data_url(composed, cw, ch, None)
    })
    .await
    .map_err(|e| format!("Composite decode task failed: {e}"))?
}
